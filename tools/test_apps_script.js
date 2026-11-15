// deploy/apps-script/Code.gs 를 구글 서비스 흉내(메모리 속 시트·드라이브·메일)로 돌려 보는 점검 스크립트.
// 실행: node tools/test_apps_script.js   (실패하면 어느 항목에서 틀렸는지 찍고 종료 코드 1)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const CLIENT = 'test-client.apps.googleusercontent.com';
const NEWS_ID = '1XLl6xyv0A507Kjf3uErwg9RL-TMhQgY-TIg9V_KwIeo';
let src = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'apps-script', 'Code.gs'), 'utf8');
src = src.replace(/const CLIENT_ID = '[^']*';/, `const CLIENT_ID = '${CLIENT}';`);

// ── 날짜 ──
const KST = 9 * 3600000;
function kst(d) { const t = new Date(d.getTime() + KST); return { y: t.getUTCFullYear(), M: t.getUTCMonth() + 1, d: t.getUTCDate(), H: t.getUTCHours(), m: t.getUTCMinutes(), s: t.getUTCSeconds() }; }
const pad = (n, w = 2) => String(n).padStart(w, '0');
function formatDate(d, tz, f) {
  const k = kst(d);
  return f.replace('yyyy', k.y).replace('yy', String(k.y).slice(2)).replace('MM', pad(k.M)).replace('dd', pad(k.d))
    .replace('HH', pad(k.H)).replace('mm', pad(k.m)).replace('ss', pad(k.s));
}
// 한국어 시트가 날짜 칸을 보여주는 모양 흉내: 2026. 11. 14 오후 3:05:09
function koDisplay(d) { const k = kst(d); const pm = k.H >= 12; const h = k.H % 12 || 12; return `${k.y}. ${k.M}. ${k.d} ${pm ? '오후' : '오전'} ${h}:${pad(k.m)}:${pad(k.s)}`; }

// ── 시트 흉내 ──
// 시트가 돌려주는 날짜는 Code.gs 쪽(vm 안) Date 여야 instanceof Date 가 맞음
const isDate = v => v != null && typeof v === 'object' && typeof v.getTime === 'function';
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  _each(fn) { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(fn(this.r + i, this.c + j)); out.push(row); } return out; }
  getValues() { return this._each((r, c) => this.sh.get(r, c)); }
  getDisplayValues() { return this._each((r, c) => { const v = this.sh.get(r, c); return isDate(v) ? koDisplay(v) : String(v); }); }
  getDisplayValue() { return this.getDisplayValues()[0][0]; }
  getNumberFormats() { return this._each((r, c) => this.sh.fmt[`${r},${c}`] || ''); }
  setNumberFormat(f) { this._each((r, c) => { this.sh.fmt[`${r},${c}`] = f; }); return this; }
  setNumberFormats(fs2) { this._each((r, c) => { this.sh.fmt[`${r},${c}`] = fs2[r - this.r][c - this.c]; }); return this; }
  setValue(v) { this._each((r, c) => this.sh.put(r, c, v)); return this; }
  setValues(vs) { assert.strictEqual(vs.length, this.nr, 'setValues 줄 수'); vs.forEach(row => assert.strictEqual(row.length, this.nc, 'setValues 칸 수')); this._each((r, c) => this.sh.put(r, c, vs[r - this.r][c - this.c])); return this; }
  setFontWeight() { return this; }
}
class Sheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.rows = []; this.fmt = {}; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  get(r, c) { const row = this.rows[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined || v === null ? '' : v; }
  // 시트에 값을 넣을 때의 자동 변환 흉내: ' 로 시작하면 글자, 날짜 모양이면 날짜, 숫자 모양이면 숫자(앞 0 사라짐)
  put(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    const text = this.fmt[`${r},${c}`] === '@';
    if (typeof v === 'string' && !text) {
      if (v.startsWith("'")) v = v.slice(1);
      else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) v = new this.ss.realm.D(v.replace(' ', 'T') + '+09:00');
      else if (/^\d+$/.test(v) && v.length < 15) v = Number(v);
    }
    row[c - 1] = v;
  }
  getLastRow() { for (let i = this.rows.length; i > 0; i--) if ((this.rows[i - 1] || []).some(v => v !== '' && v != null)) return i; return 0; }
  getLastColumn() { let m = 0; this.rows.forEach(r => r.forEach((v, j) => { if (v !== '' && v != null) m = Math.max(m, j + 1); })); return m; }
  getRange(r, c, nr = 1, nc = 1) { assert(r >= 1 && c >= 1 && nr >= 1 && nc >= 1, `getRange(${r},${c},${nr},${nc})`); return new Range(this, r, c, nr, nc); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(vals) { const r = this.getLastRow() + 1; vals.forEach((v, j) => this.put(r, j + 1, v)); return this; }
  insertRowBefore(r) { this.rows.splice(r - 1, 0, []); this._shiftFmt(r, 1); return this; }
  deleteRow(r) { this.rows.splice(r - 1, 1); this._shiftFmt(r, -1); return this; }
  _shiftFmt(from, d) { const n = {}; Object.keys(this.fmt).forEach(k => { const [r, c] = k.split(',').map(Number); if (d < 0 && r === from) return; n[`${r >= from ? r + d : r},${c}`] = this.fmt[k]; }); this.fmt = n; }
  setFrozenRows() { return this; }
  table() { return this.rows.map(r => r.slice()); }
}
class Spreadsheet {
  constructor(id, name, realm) { this.id = id; this.name = name; this.realm = realm; this.sheets = [new Sheet(this, '시트1')]; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(this, n); this.sheets.push(s); return s; }
}

function makeWorld(code = src) {
  const realm = { D: Date };
  const books = {};
  const props = {};
  const cache = {};
  const files = {};
  const mails = [];
  const fetches = [];
  let seq = 0;
  const tokens = {
    good: { aud: CLIENT, email: 'camver2020@gmail.com', email_verified: 'true', iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 3000) },
    other: { aud: CLIENT, email: 'someone@gmail.com', email_verified: 'true', iss: 'accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 3000) },
    wrongaud: { aud: 'x', email: 'camver2020@gmail.com', email_verified: 'true', iss: 'accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 3000) },
    expired: { aud: CLIENT, email: 'camver2020@gmail.com', email_verified: 'true', iss: 'accounts.google.com', exp: String(Math.floor(Date.now() / 1000) - 10) },
  };
  const blob = (bytes, type, name) => ({ bytes: Buffer.from(bytes), type, name, getBytes() { return Array.from(this.bytes); }, getContentType() { return this.type; }, getName() { return this.name; } });
  const g = {
    console: { log() {}, error() {} },
    SpreadsheetApp: {
      create(name) { const id = 'ss' + (++seq); books[id] = new Spreadsheet(id, name, realm); return books[id]; },
      openById(id) { if (!books[id]) throw new Error('no sheet ' + id); return books[id]; },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    UrlFetchApp: {
      fetch(url) {
        fetches.push(url);
        const tk = decodeURIComponent(url.split('id_token=')[1] || '');
        const t = tokens[tk];
        return { getResponseCode: () => (t ? 200 : 400), getContentText: () => JSON.stringify(t || { error: 'invalid_token' }) };
      },
    },
    Utilities: {
      formatDate,
      base64Decode: s => Array.from(Buffer.from(s, 'base64')),
      base64Encode: b => Buffer.from(b).toString('base64'),
      base64EncodeWebSafe: b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s).digest()),
      DigestAlgorithm: { SHA_256: 'sha256' },
      newBlob: blob,
    },
    DriveApp: {
      createFolder(name) { return { getId: () => 'folder1', createFile(b) { const id = 'FILE' + 'x'.repeat(24) + (++seq); files[id] = { blob: b, created: new Date(), trashed: false }; return { setDescription() { return { getUrl: () => `https://drive.google.com/file/d/${id}/view?usp=drivesdk` }; } }; }, getFiles() { const ids = Object.keys(files); let i = 0; return { hasNext: () => i < ids.length, next: () => { const f = files[ids[i++]]; return { getDateCreated: () => f.created, setTrashed: v => { f.trashed = v; } }; } }; } }; },
      getFolderById() { return this.createFolder(); },
      getFileById(id) { const f = files[id]; if (!f) throw new Error('no file'); return { getName: () => f.blob.name, getBlob: () => f.blob }; },
    },
    MailApp: { sendEmail(m) { mails.push(m); } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => { const t = { timeBased: () => t, everyDays: () => t, atHour: () => t, inTimezone: () => t, create: () => t }; return t; } },
  };
  // 소식 시트: 지금 쓰는 모양(날짜, 제목, 출처, 링크) 그대로
  const ctx = vm.createContext(g);
  realm.D = vm.runInContext('Date', ctx);
  const news = new Spreadsheet(NEWS_ID, '캠버 홈페이지 소식', realm);
  books[NEWS_ID] = news;
  const ns = news.sheets[0];
  [['날짜', '제목', '출처', '링크'],
   ['2026.09.04', 'Fleet AI OS 출시', '보도자료', 'https://example.com/a'],
   ['2025.06.08', '캠핑카 수익형 자산', '언론 보도', ''],
   ['2025.05.30', '샌드박스 과제 승인', '언론 보도', '']].forEach(r => ns.appendRow(r));
  ns.put(3, 1, new realm.D('2025-06-08T00:00:00+09:00'));  // 날짜 칸이 진짜 날짜로 들어간 경우
  vm.runInContext(code, ctx, { filename: 'Code.gs' });
  return { g, ctx, books, props, files, mails, fetches, news: ns };
}

function out(res) { return JSON.parse(res.s); }
function post(w, params) { return out(w.ctx.doPost({ parameter: params })); }
function admin(w, op, body = {}, token = 'good') { return post(w, { action: 'admin', payload: JSON.stringify(Object.assign({ token, actor: '맹현호', op }, body)) }); }

let passed = 0;
function check(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e).split('\n').slice(0, 3).join('\n       ')); process.exitCode = 1; } }

const w = makeWorld();
// 예전 Code.gs 로 쌓인 접수 시트 흉내: 관리용 칸 없이, 접수 시각은 날짜로 저장돼 있음
(function legacy() {
  const ss = w.g.SpreadsheetApp.create('캠버 홈페이지 문의 접수');
  w.props.SHEET_ID = ss.getId();
  const a = ss.sheets[0].setName('도입·제휴 문의');
  a.appendRow(['접수 시각', '문의 유형', '회사·기관명', '담당자 이름', '연락처', '이메일', '문의 내용', '보낸 페이지']);
  a.appendRow(['2025-12-01 10:00:00', '기타', '오래된회사', '김옛날', "'01011112222", 'old@x.com', '예전 문의', 'https://www.camver.ai.kr/cs.html']);
  a.appendRow(['2026-11-01 09:30:00', 'Fleet AI OS 도입', '가나물류', '이가나', "'01022223333", 'ga@x.com', '전기 화물차 30대', 'https://www.camver.ai.kr/cs.html']);
  const b = ss.insertSheet('입사 지원·파트너 제휴');
  b.appendRow(['접수 시각', '신청 구분', '이름·회사명', '분야', '연락처', '이메일', '소개', '첨부 파일', '보낸 페이지']);
})();

console.log('Code.gs 점검');

check('폼 접수: 관리용 칸이 붙고 접수번호·상태가 채워짐, 연락처 앞 0 유지', () => {
  const r = post(w, { form: 'contact', type: '이동형 안전 쉼터', org: '=수식회사', name: '박담당', tel: '01033334444', email: 'park@x.com', message: '견적 문의', page: 'https://www.camver.ai.kr/cs.html', agree: 'on' });
  assert.deepStrictEqual(r, { ok: true });
  const sh = w.books[w.props.SHEET_ID].getSheetByName('도입·제휴 문의');
  const head = sh.table()[0];
  assert.deepStrictEqual(head.slice(8), ['접수번호', '상태', '담당자 메모', '최근 처리자', '최근 처리 시각']);
  const last = sh.table()[sh.getLastRow() - 1];
  assert.strictEqual(last[4], '01033334444');
  assert.strictEqual(last[2], '=수식회사');  // ' 덕분에 글자로 들어감
  assert.match(String(last[8]), /^C\d{6}-[2-9A-Z]{4}$/);
  assert.strictEqual(last[9], '접수');
  const m = w.mails.pop();
  assert.strictEqual(m.to, 'camver2020@gmail.com');
  assert.match(m.body, /접수번호: C\d{6}-/);
  assert.match(m.body, /관리자 화면: https:\/\/www\.camver\.ai\.kr\/manage\//);
});

check('폼 접수: 스팸 숨은 칸, 필수값 없음', () => {
  assert.deepStrictEqual(post(w, { form: 'contact', website: 'spam', name: 'a', tel: '1' }), { ok: true });
  assert.strictEqual(post(w, { form: 'contact', name: '', tel: '' }).ok, false);
});

check('입사 지원 접수: 첨부 파일이 드라이브에 저장되고 링크가 남음', () => {
  const r = post(w, { form: 'join', kind: '입사 지원', name: '최지원', field: 'IT 기술', tel: '010-5555-6666', email: 'choi@x.com', message: '지원합니다', file_name: '이력서.pdf', file_type: 'application/pdf', file_data: Buffer.from('%PDF-1.4 test').toString('base64') });
  assert.strictEqual(r.ok, true);
  const sh = w.books[w.props.SHEET_ID].getSheetByName('입사 지원·파트너 제휴');
  const last = sh.table()[sh.getLastRow() - 1];
  assert.match(String(last[7]), /^https:\/\/drive\.google\.com\/file\/d\//);
  assert.match(String(last[9]), /^J\d{6}-/);
  assert.strictEqual(w.mails.pop().attachments.length, 1);
});

check('관리자: 토큰 없음·남의 계정·다른 앱·만료 토큰은 막힘', () => {
  assert.strictEqual(admin(w, 'load', {}, '').error, 'auth');
  assert.strictEqual(admin(w, 'load', {}, 'other').error, 'forbidden');
  assert.strictEqual(admin(w, 'load', {}, 'wrongaud').error, 'auth');
  assert.strictEqual(admin(w, 'load', {}, 'expired').error, 'auth');
  assert.strictEqual(admin(w, 'load', {}, 'garbage').error, 'auth');
  assert.strictEqual(post(w, { action: 'admin', payload: '{bad json' }).error, 'bad');
});

let contact, join;
check('관리자 로그인: 전체 목록, 예전 줄 접수번호 채움, 로그인 기록', () => {
  const r = admin(w, 'login');
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.deepStrictEqual(r.me, { email: 'camver2020@gmail.com', name: '맹현호' });
  assert.strictEqual(r.contact.length, 3);
  assert.strictEqual(r.contact[0].name, '박담당');  // 최근 접수가 위
  assert.strictEqual(r.contact[2].name, '김옛날');
  r.contact.forEach(c => { assert.match(c.id, /^C\d{6}-/); assert.strictEqual(c.status, '접수'); assert.match(c.ts, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/); });
  assert.strictEqual(r.contact[2].id.slice(1, 7), '251201');
  assert.strictEqual(r.contact[1].tel, '01022223333');
  assert.strictEqual(r.join.length, 1);
  assert.strictEqual(r.logs[0].action, '로그인');
  assert.strictEqual(r.logs[0].name, '맹현호');
  assert.strictEqual(r.news.length, 3);
  assert.strictEqual(r.news[1].date, '2025.06.08');  // 날짜 칸이 날짜로 들어가 있어도 같은 모양
  assert(r.news.every(n => n.visible));
  assert.strictEqual(r.settings.playlists.length, 5);
  assert.deepStrictEqual(r.settings.notify, ['camver2020@gmail.com']);
  const c = r.retention.tabs.find(t => t.kind === 'contact');
  assert.strictEqual(c.total, 3);
  assert.strictEqual(c.soon, 1, '2025-12-01 접수는 30일 안에 지워질 예정');
  contact = r.contact; join = r.join;
  // 토큰 확인은 한 번만 하고 다음부터는 캐시
  const n = w.fetches.length; admin(w, 'load'); assert.strictEqual(w.fetches.length, n);
});

check('상태·메모 변경: 처리자·시각·작업 기록 남김, 안 바뀌면 기록 없음', () => {
  const id = contact[1].id;
  const r = admin(w, 'update', { tab: 'contact', id, status: '처리중', memo: '11/15 통화 예정' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.item.status, '처리중');
  assert.strictEqual(r.item.memo, '11/15 통화 예정');
  assert.strictEqual(r.item.by, '맹현호');
  assert.match(r.item.at, /^\d{4}-\d{2}-\d{2} /);
  assert.strictEqual(r.log.detail, '상태 접수 → 처리중, 메모 작성');
  assert.strictEqual(r.log.target, id);
  const again = admin(w, 'update', { tab: 'contact', id, status: '처리중', memo: '11/15 통화 예정' });
  assert.strictEqual(again.log, null);
  assert.strictEqual(admin(w, 'update', { tab: 'contact', id, status: '보류' }).error, 'bad');
  assert.strictEqual(admin(w, 'update', { tab: 'contact', id: 'C000000-NONE', status: '완료' }).error, 'notfound');
  assert.strictEqual(admin(w, 'update', { tab: 'nope', id, status: '완료' }).error, 'bad');
  const done = admin(w, 'update', { tab: 'contact', id, status: '완료' });
  assert.strictEqual(done.log.detail, '상태 처리중 → 완료');
});

check('첨부 열람: 로그인한 관리자에게 파일 내용을 넘기고 기록 남김(파일 이름은 기록에 안 남김)', () => {
  const r = admin(w, 'file', { id: join[0].id });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.name, '이력서.pdf');
  assert.strictEqual(r.type, 'application/pdf');
  assert.strictEqual(Buffer.from(r.data, 'base64').toString(), '%PDF-1.4 test');
  assert.strictEqual(r.log.action, '첨부 열람');
  assert(!/이력서/.test(r.log.detail));
  assert.strictEqual(admin(w, 'file', { id: 'J000000-NONE' }).error, 'notfound');
});

check('소식: 등록(맨 위)·수정·숨김·순서·삭제, 시트 공개 칸', () => {
  let r = admin(w, 'news.save', { item: { date: '2026-11-14', title: '관리자 화면 오픈', source: '공지', url: '', visible: true } });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.news[0].title, '관리자 화면 오픈');
  assert.strictEqual(r.news[0].date, '2026.11.14');
  assert.strictEqual(w.news.get(1, 5), '공개');
  assert.strictEqual(w.news.get(2, 1), '2026.11.14');  // 글자로 저장(날짜로 바뀌지 않음)
  const top = r.news[0];
  assert.strictEqual(admin(w, 'news.save', { row: top.row, sig: 'x|y', item: { title: 'a' } }).error, 'stale');
  r = admin(w, 'news.save', { row: top.row, sig: top.date + '|' + top.title, item: { date: top.date, title: '관리자 화면 오픈 안내', source: '공지', url: 'https://www.camver.ai.kr', visible: true } });
  assert.strictEqual(r.news[0].title, '관리자 화면 오픈 안내');
  assert.strictEqual(r.news.length, 4);
  let x = r.news[0];
  r = admin(w, 'news.move', { row: x.row, sig: x.date + '|' + x.title, dir: 1 });
  assert.strictEqual(r.news[1].title, '관리자 화면 오픈 안내');
  assert.strictEqual(r.news[0].title, 'Fleet AI OS 출시');
  assert.match(r.log.detail, /1 → 2번째/);
  x = r.news[1];
  r = admin(w, 'news.move', { row: x.row, sig: x.date + '|' + x.title, dir: -1 });
  assert.strictEqual(r.news[0].title, '관리자 화면 오픈 안내');
  x = r.news[0];
  r = admin(w, 'news.move', { row: x.row, sig: x.date + '|' + x.title, dir: -1 });
  assert.strictEqual(r.log, null, '맨 위에서 위로는 그대로');
  x = r.news[2];
  r = admin(w, 'news.visible', { row: x.row, sig: x.date + '|' + x.title, visible: false });
  assert.strictEqual(r.news[2].visible, false);
  assert.strictEqual(w.news.get(x.row, 5), '숨김');
  assert.strictEqual(r.log.action, '소식 숨김');
  x = r.news[3];
  r = admin(w, 'news.delete', { row: x.row, sig: x.date + '|' + x.title });
  assert.strictEqual(r.news.length, 3);
  assert(!r.news.some(n => n.title === '샌드박스 과제 승인'));
  assert.strictEqual(admin(w, 'news.save', { item: { title: '', url: '' } }).error, 'notitle');
  assert.strictEqual(admin(w, 'news.save', { item: { title: 'a', url: 'javascript:alert(1)' } }).error, 'badurl');
});

check('설정: 알림 메일 바꾸면 다음 접수부터 그 주소로, 잘못된 주소는 막음', () => {
  assert.strictEqual(admin(w, 'settings.save', { notify: 'not-an-email' }).error, 'bademail');
  let r = admin(w, 'settings.save', { notify: 'a@camver.ai.kr, b@camver.ai.kr' });
  assert.deepStrictEqual(r.settings.notify, ['a@camver.ai.kr', 'b@camver.ai.kr']);
  assert.strictEqual(r.logs[0].action, '알림 메일 변경');
  post(w, { form: 'contact', type: '기타', name: '홍길동', tel: '01000000000', message: 'x' });
  assert.strictEqual(w.mails.pop().to, 'a@camver.ai.kr,b@camver.ai.kr');
  r = admin(w, 'settings.save', { notify: '' });
  assert.deepStrictEqual(r.settings.notify, ['camver2020@gmail.com']);
});

check('설정: 재생목록 링크·썸네일 교체, 유튜브 아닌 주소는 막음', () => {
  const r0 = admin(w, 'load');
  const pl = r0.settings.playlists.map(p => Object.assign({}, p));
  pl[2].url = 'https://www.youtube.com/playlist?list=PLNEW';
  pl[2].thumb = 'https://www.youtube.com/watch?v=abcdefghijk&t=3';
  const r = admin(w, 'settings.save', { playlists: pl });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.settings.playlists[2].url, 'https://www.youtube.com/playlist?list=PLNEW');
  assert.strictEqual(r.settings.playlists[2].thumb, 'abcdefghijk');
  assert.strictEqual(r.logs[0].detail, '포레스트 캠핑카');
  const same = admin(w, 'settings.save', { playlists: r.settings.playlists });
  assert.strictEqual(same.logs.length, 0);
  pl[0].url = 'https://evil.example.com/x';
  assert.strictEqual(admin(w, 'settings.save', { playlists: pl }).error, 'badurl');
});

check('자동 삭제: 1년 지난 접수만 지움, 삭제 예정 건수는 그대로', () => {
  const sh = w.books[w.props.SHEET_ID].getSheetByName('도입·제휴 문의');
  const t = new Date(Date.now() - 400 * 86400000);
  const stamp = w.g.Utilities.formatDate(t, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  sh.appendRow([stamp, '기타', '아주옛날', '정오래', "'01099990000", '', '1년 넘은 문의', '']);
  assert(admin(w, 'load').contact.some(c => c.name === '정오래'));
  w.ctx.cleanup();
  const r = admin(w, 'load');
  assert(!r.contact.some(c => c.name === '정오래'));
  assert(r.contact.some(c => c.name === '김옛날'));
  assert(r.contact.some(c => c.name === '이가나'));
  assert.strictEqual(r.retention.tabs[0].soon, 1);
});

check('setup: 다시 실행해도 탭·칸이 겹치지 않음', () => {
  w.ctx.setup(); w.ctx.setup();
  const ss = w.books[w.props.SHEET_ID];
  assert.strictEqual(ss.sheets.filter(s => s.name === '작업 기록').length, 1);
  const head = ss.getSheetByName('도입·제휴 문의').table()[0];
  assert.strictEqual(head.filter(h => h === '상태').length, 1);
  assert.strictEqual(w.books[NEWS_ID].sheets.filter(s => s.name === '설정').length, 1);
});

check('CLIENT_ID 가 비어 있으면 관리자 요청은 setup 오류, 폼 접수는 그대로', () => {
  const w2 = makeWorld(src.replace(`const CLIENT_ID = '${CLIENT}';`, "const CLIENT_ID = '';"));
  const ctx2 = w2.ctx;
  assert.strictEqual(out(ctx2.doPost({ parameter: { action: 'admin', payload: JSON.stringify({ token: 'good', op: 'load' }) } })).error, 'setup');
  assert.strictEqual(out(ctx2.doPost({ parameter: { form: 'contact', name: 'a', tel: '010' } })).ok, true);
});

console.log(`\n${passed}개 통과` + (process.exitCode ? ' · 실패 있음' : ''));
