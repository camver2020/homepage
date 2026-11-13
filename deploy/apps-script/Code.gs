/**
 * 캠버 홈페이지 문의 접수기 + 관리자 화면 서버 (Google Apps Script 웹앱)
 *
 * 1) 문의 접수: 고객센터의 두 폼(도입·제휴 문의 / 입사 지원·파트너 제휴)을 받아
 *    접수 시트에 한 줄 쌓고, 첨부 파일은 드라이브에 저장하고, 알림 메일을 보냄.
 * 2) 관리자 화면(www.camver.ai.kr/manage/): 구글 로그인으로 들어온 허용 계정만
 *    문의 상태·메모 처리, 첨부 열람, 소식 편집, 알림 메일·재생목록 설정을 할 수 있음.
 *    데이터는 지금 쓰는 구글 시트 2개(문의 접수 시트, 소식 시트)에 그대로 남고, 따로 서버나 DB를 두지 않음.
 *
 * 처음 설치 (camver2020@gmail.com 계정으로 로그인해서)
 *  1. script.google.com → 새 프로젝트 → 이 파일 내용 통째로 붙여넣기 → 저장
 *  2. 함수 목록에서 setup 선택 → 실행 → 권한 허용 (시트·드라이브·메일·외부 요청 권한)
 *  3. 배포 → 새 배포 → 유형: 웹 앱 / 다음 사용자로 실행: 나 / 액세스 권한: 모든 사용자
 *  4. 나온 웹 앱 URL 을 홈페이지 src/config.json 의 form_endpoint 에 넣고 다시 빌드
 *
 * 이미 쓰고 있는 스크립트를 이 버전으로 바꿀 때
 *  1. 이 파일 내용으로 통째로 바꿔 붙여넣기 → 아래 CLIENT_ID 채우기 → 저장
 *  2. setup 한 번 실행 → 새로 뜨는 권한 허용 (관리자 로그인 확인용 '외부 요청' 권한이 추가됨)
 *     → 기존 접수 줄에 접수번호·상태 칸이 붙고, '작업 기록' 탭과 소식 시트 '설정' 탭이 생김. 기존 데이터는 안 지움
 *  3. 배포 → 배포 관리 → 연필 → 버전 '새 버전' → 배포 (URL 은 그대로 유지됨)
 */

const TO = 'camver2020@gmail.com';            // 알림 받을 기본 주소 (관리자 화면 설정에서 바꾸면 그 값이 우선)
const SHEET_NAME = '캠버 홈페이지 문의 접수';
const FOLDER_NAME = '캠버 홈페이지 첨부파일';
const MAX_FILE_MB = 10;                        // 홈페이지 폼의 제한과 같게
const KEEP_DAYS = 365;                         // 개인정보 처리방침의 보유 기간(접수일부터 1년)
const SOON_DAYS = 30;                          // 보관 현황의 '삭제 예정': 앞으로 이 날짜 수 안에 지워질 건

// ── 관리자 화면 ─────────────────────────────────────────────
const CLIENT_ID = '';                          // 구글 로그인 클라이언트 ID (…apps.googleusercontent.com). 홈페이지 config.json 의 google_client_id 와 같은 값
const ADMINS = ['camver2020@gmail.com'];       // 관리자 화면에 들어올 수 있는 구글 계정
const NEWS_SHEET_ID = '1XLl6xyv0A507Kjf3uErwg9RL-TMhQgY-TIg9V_KwIeo';  // '캠버 홈페이지 소식' 시트 (홈페이지가 CSV 로 읽는 시트)
const MANAGE_URL = 'https://www.camver.ai.kr/manage/';
const LOG_TAB = '작업 기록';                    // 문의 접수 시트 안
const SETTINGS_TAB = '설정';                    // 소식 시트 안. 홈페이지가 공개로 읽는 값(재생목록 링크)만 둠
const STATUSES = ['접수', '처리중', '완료'];
const HIDDEN = /^(숨김|비공개|n|no|false|x|0)$/i;  // 소식 시트 '공개' 칸에 이 값이면 홈페이지에 안 보임
// 접수 시트 오른쪽에 붙는 관리용 칸
const EXTRA = [['접수번호', 'id'], ['상태', 'status'], ['담당자 메모', 'memo'], ['최근 처리자', 'by'], ['최근 처리 시각', 'at']];
// 고객센터 '사용법 영상' 칸 순서대로. 설정 탭이 없을 때 쓰는 처음 값
const PLAYLISTS = [
  ['현대자동차 스타리아 캠핑카', 'https://www.youtube.com/playlist?list=PLmKu3aHEivj75ksBEdG01Y_6DP_Vs3rv0', 'nXkg7gmPuVM'],
  ['현대엔지니어링 스타리아 캠핑카', 'https://www.youtube.com/playlist?list=PLmKu3aHEivj5WGW1HWsqMv8snFJXzC29C', 'ck01uUKowlk'],
  ['포레스트 캠핑카', 'https://www.youtube.com/playlist?list=PLmKu3aHEivj5Ii1EkORJMLrvNuekNHWIo', 'IGd3-BVDTHw'],
  ['스타렉스 캠핑카', 'https://www.youtube.com/playlist?list=PLmKu3aHEivj4k1Vk4fthbSHkxpkxINZTy', 'mZ7SuGdvFYI'],
  ['레이 캠핑카', 'https://www.youtube.com/playlist?list=PLmKu3aHEivj59NUVFPBDLFNn6-Z_5oIF0', 'OpkNIpBJ6iw'],
];

const FORMS = {
  contact: {
    tab: '도입·제휴 문의',
    prefix: 'C',
    cols: [['접수 시각', 'ts'], ['문의 유형', 'type'], ['회사·기관명', 'org'], ['담당자 이름', 'name'], ['연락처', 'tel'], ['이메일', 'email'], ['문의 내용', 'message'], ['보낸 페이지', 'page']],
    subject: p => `[홈페이지 문의] ${p.type || '기타'} · ${p.org || p.name}`,
  },
  join: {
    tab: '입사 지원·파트너 제휴',
    prefix: 'J',
    cols: [['접수 시각', 'ts'], ['신청 구분', 'kind'], ['이름·회사명', 'name'], ['분야', 'field'], ['연락처', 'tel'], ['이메일', 'email'], ['소개', 'message'], ['첨부 파일', 'fileUrl'], ['보낸 페이지', 'page']],
    subject: p => `[홈페이지 ${p.kind || '입사·제휴'}] ${p.name}`,
  },
};

function doPost(e) {
  const p = Object.assign({}, (e && e.parameter) || {});
  if (p.action === 'admin') return admin_(p);
  return submit_(p);
}

// 주소를 브라우저로 열었을 때 살아 있는지 확인용
function doGet() {
  return json({ ok: true, service: 'camver-form' });
}

// ── 1. 홈페이지 폼 접수 ─────────────────────────────────────

function submit_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (p.website) return json({ ok: true });  // 스팸 봇이 숨은 칸을 채운 경우: 저장하지 않음
    const kind = FORMS[p.form] ? p.form : 'contact';
    const def = FORMS[kind];
    if (!p.name || !p.tel) return json({ ok: false, error: 'missing' });

    p.ts = now_();
    let blob = null;
    if (p.file_data && p.file_name) {
      const bytes = Utilities.base64Decode(p.file_data);
      if (bytes.length <= MAX_FILE_MB * 1024 * 1024) {
        blob = Utilities.newBlob(bytes, p.file_type || 'application/octet-stream', p.file_name);
        p.fileUrl = folder_().createFile(blob).setDescription(`${p.ts} ${p.name}`).getUrl();
      } else {
        p.fileUrl = `(${MAX_FILE_MB}MB 넘어서 저장 안 함: ${p.file_name})`;
      }
    }

    const t = table_(kind);
    p.id = newId_(def, p.ts);
    p.status = '접수';
    // 연락처는 01012345678 처럼 숫자만 오면 시트가 앞의 0을 지우므로 글자로 저장
    t.sh.appendRow(t.head.map(label => {
      const key = t.key[label];
      if (!key) return '';
      return (key === 'tel' && /^\d/.test(p.tel || '') ? "'" : '') + clean_(p[key]);
    }));

    const lines = def.cols.filter(([, key]) => key !== 'ts' && p[key]).map(([label, key]) => `${label}: ${p[key]}`);
    const mail = {
      to: notify_().join(','),
      subject: def.subject(p),
      body: lines.join('\n\n') + `\n\n접수번호: ${p.id}\n접수 시각: ${p.ts}\n관리자 화면: ${MANAGE_URL}\n접수 시트: ${ss_().getUrl()}`,
      name: '캠버 홈페이지',
    };
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email || '')) mail.replyTo = p.email;
    if (blob) mail.attachments = [blob];
    // 메일 한도(무료 지메일 하루 100통)를 넘어도 접수는 시트에 남았으니 성공으로 돌려줌
    try { MailApp.sendEmail(mail); } catch (mailErr) { console.error('알림 메일 실패', mailErr); }

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ── 2. 관리자 화면 ──────────────────────────────────────────
// 관리자 화면은 action=admin, payload=JSON 으로 보냄. payload.token 은 구글 로그인 ID 토큰,
// payload.actor 는 로그인할 때 적은 담당자 이름(같은 계정을 여럿이 써서 기록에 이름을 남김)

function admin_(p) {
  let q;
  try { q = JSON.parse(p.payload || '{}'); } catch (e) { return json({ ok: false, error: 'bad' }); }
  let who;
  try { who = auth_(q); } catch (e) { return json({ ok: false, error: e.code || 'auth' }); }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const out = run_(q, who) || {};
    out.ok = true;
    return json(out);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: e.code || 'server', message: e.code ? '' : String(e && e.message || e) });
  } finally {
    lock.releaseLock();
  }
}

function run_(q, who) {
  switch (q.op) {
    case 'login':
      log_(who, '로그인', '', '');
      return load_(who);
    case 'load':
      return load_(who);
    case 'update':
      return update_(q, who);
    case 'file':
      return file_(q, who);
    case 'news.save':
    case 'news.move':
    case 'news.visible':
    case 'news.delete':
      return newsOp_(q, who);
    case 'settings.save':
      return saveSettings_(q, who);
    default:
      throw err_('bad');
  }
}

// 구글 로그인 ID 토큰을 구글에 확인하고, 허용 계정인지 봄. 확인 결과는 토큰이 살아 있는 동안 캐시
function auth_(q) {
  if (!CLIENT_ID) throw err_('setup');
  const token = String(q.token || '');
  if (!token) throw err_('auth');
  const cache = CacheService.getScriptCache();
  const key = 'idt:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 43);
  let email = cache.get(key);
  if (!email) {
    const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw err_('auth');
    const t = JSON.parse(res.getContentText());
    const left = Number(t.exp) - Math.floor(Date.now() / 1000);
    const iss = String(t.iss || '');
    if (t.aud !== CLIENT_ID || String(t.email_verified) !== 'true' || !(iss === 'accounts.google.com' || iss === 'https://accounts.google.com') || !(left > 0)) {
      throw err_('auth');
    }
    email = String(t.email || '').toLowerCase();
    cache.put(key, email, Math.max(1, Math.min(left, 21600)));
  }
  if (ADMINS.map(s => s.toLowerCase()).indexOf(email) < 0) throw err_('forbidden');
  const name = String(q.actor || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 20);
  return { email: email, name: name || email.split('@')[0] };
}

function load_(who) {
  const c = table_('contact');
  const j = table_('join');
  fill_(c);
  fill_(j);
  return {
    me: who,
    contact: items_(c),
    join: items_(j),
    news: newsList_(news_()),
    logs: logs_(300),
    settings: settings_(),
    retention: retention_([c, j]),
    statuses: STATUSES,
    now: now_(),
  };
}

// 상태·메모 바꾸기. 바뀐 게 있을 때만 처리자·시각·작업 기록을 남김
function update_(q, who) {
  const kind = FORMS[q.tab] ? q.tab : null;
  if (!kind) throw err_('bad');
  const t = table_(kind);
  const row = findRow_(t, q.id);
  if (!row) throw err_('notfound');
  const cur = itemAt_(t, row);
  const changes = [];
  if (q.status != null) {
    if (STATUSES.indexOf(q.status) < 0) throw err_('bad');
    const before = cur.status || '접수';
    if (before !== q.status) {
      setCell_(t, row, 'status', q.status);
      changes.push(`상태 ${before} → ${q.status}`);
    }
  }
  if (q.memo != null) {
    const memo = String(q.memo).slice(0, 2000);
    if (memo !== (cur.memo || '')) {
      setCell_(t, row, 'memo', clean_(memo));
      changes.push(cur.memo ? '메모 수정' : '메모 작성');
    }
  }
  let log = null;
  if (changes.length) {
    setCell_(t, row, 'by', who.name);
    setCell_(t, row, 'at', now_());
    log = log_(who, kind === 'join' ? '신청 처리' : '문의 처리', q.id, changes.join(', '));
  }
  return { item: itemAt_(t, row), log: log };
}

// 입사 지원 첨부 파일을 꺼내 줌. 드라이브 공유를 걸지 않아도 로그인한 관리자만 볼 수 있음
function file_(q, who) {
  const t = table_('join');
  const row = findRow_(t, q.id);
  if (!row) throw err_('notfound');
  const url = itemAt_(t, row).fileUrl || '';
  const m = url.match(/\/d\/([-\w]{20,})/) || url.match(/[?&]id=([-\w]{20,})/);
  if (!m) throw err_('nofile');
  const f = DriveApp.getFileById(m[1]);
  const blob = f.getBlob();
  const bytes = blob.getBytes();
  if (bytes.length > 15 * 1024 * 1024) throw err_('toolarge');
  const log = log_(who, '첨부 열람', q.id, '첨부 파일 열람');
  return { name: f.getName(), type: blob.getContentType() || 'application/octet-stream', data: Utilities.base64Encode(bytes), log: log };
}

// ── 접수 시트 다루기 ──

// 탭을 열고 칸 제목을 확인. 관리용 칸(접수번호·상태…)이 없으면 오른쪽 끝에 붙임
function table_(kind) {
  const def = FORMS[kind];
  const sh = tab_(def);
  const want = def.cols.concat(EXTRA);
  const head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getDisplayValues()[0].map(s => String(s).trim());
  while (head.length && !head[head.length - 1]) head.pop();
  want.forEach(([label]) => {
    if (head.indexOf(label) < 0) {
      head.push(label);
      sh.getRange(1, head.length).setValue(label).setFontWeight('bold');
    }
  });
  const key = {};
  want.forEach(([label, k]) => { key[label] = k; });
  return { kind: kind, def: def, sh: sh, head: head, key: key, idx: k => head.findIndex(l => key[l] === k) };
}

// 예전에 들어온 줄에 접수번호·상태가 비어 있으면 채움
function fill_(t) {
  const n = t.sh.getLastRow() - 1;
  if (n < 1) return;
  const iId = t.idx('id'), iSt = t.idx('status'), iTs = t.idx('ts');
  const vals = t.sh.getRange(2, 1, n, t.head.length).getValues();
  let needId = false, needSt = false;
  const ids = vals.map(r => [r[iId]]), sts = vals.map(r => [r[iSt]]);
  vals.forEach((r, i) => {
    const empty = r.every(v => v === '' || v == null);
    if (empty) return;
    if (!r[iId]) { ids[i] = [newId_(t.def, ts_(r[iTs]))]; needId = true; }
    if (!r[iSt]) { sts[i] = ['접수']; needSt = true; }
  });
  if (needId) t.sh.getRange(2, iId + 1, n, 1).setValues(ids);
  if (needSt) t.sh.getRange(2, iSt + 1, n, 1).setValues(sts);
}

function items_(t) {
  const n = t.sh.getLastRow() - 1;
  if (n < 1) return [];
  const rng = t.sh.getRange(2, 1, n, t.head.length);
  const raw = rng.getValues(), dsp = rng.getDisplayValues();
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = toItem_(t, i + 2, raw[i], dsp[i]);
    if (o.ts || o.name) out.push(o);
  }
  return out.reverse();  // 최근 접수가 위로
}

function itemAt_(t, row) {
  const rng = t.sh.getRange(row, 1, 1, t.head.length);
  return toItem_(t, row, rng.getValues()[0], rng.getDisplayValues()[0]);
}

function toItem_(t, row, raw, dsp) {
  const o = { row: row };
  t.head.forEach((label, c) => {
    const k = t.key[label];
    if (!k) return;
    o[k] = (k === 'ts' || k === 'at') ? (ts_(raw[c]) || String(dsp[c] || '').trim()) : String(dsp[c] == null ? '' : dsp[c]).trim();
  });
  if (!o.status) o.status = '접수';
  return o;
}

function findRow_(t, id) {
  id = String(id || '').trim();
  const n = t.sh.getLastRow() - 1;
  if (!id || n < 1) return 0;
  const col = t.sh.getRange(2, t.idx('id') + 1, n, 1).getDisplayValues();
  for (let i = 0; i < n; i++) if (String(col[i][0]).trim() === id) return i + 2;
  return 0;
}

function setCell_(t, row, key, value) {
  t.sh.getRange(row, t.idx(key) + 1).setValue(value);
}

// 접수번호: C(도입·제휴)/J(입사·제휴) + 접수일 6자리 + 임의 4자리. 예) C261114-7K3M
function newId_(def, ts) {
  const d = String(ts || '').replace(/[^\d]/g, '').slice(2, 8) || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd');
  const abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let r = '';
  for (let i = 0; i < 4; i++) r += abc.charAt(Math.floor(Math.random() * abc.length));
  return `${def.prefix}${d}-${r}`;
}

// 보관 현황: 탭별 보관 중인 건수, 앞으로 SOON_DAYS 안에 자동 삭제될 건수, 가장 오래된 접수일
function retention_(tables) {
  const now = Date.now();
  const soonLimit = now - (KEEP_DAYS - SOON_DAYS) * 86400000;
  return {
    keepDays: KEEP_DAYS,
    soonDays: SOON_DAYS,
    runs: '매일 03:00',
    tabs: tables.map(t => {
      const n = t.sh.getLastRow() - 1;
      let total = 0, soon = 0, oldest = '';
      if (n > 0) {
        const col = t.sh.getRange(2, t.idx('ts') + 1, n, 1).getValues();
        col.forEach(([v]) => {
          const d = toDate_(v);
          if (!d) return;
          total++;
          if (d.getTime() < soonLimit) soon++;
          const s = ts_(d);
          if (!oldest || s < oldest) oldest = s;
        });
      }
      return { kind: t.kind, tab: t.def.tab, total: total, soon: soon, oldest: oldest };
    }),
  };
}

// ── 작업 기록 ──

function logTab_() {
  const ss = ss_();
  let sh = ss.getSheetByName(LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(LOG_TAB, ss.getSheets().length);
    sh.appendRow(['시각', '계정', '담당자', '작업', '대상', '내용']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 6).setFontWeight('bold');
  }
  return sh;
}

function log_(who, action, target, detail) {
  const e = { at: now_(), email: who.email, name: who.name, action: action, target: String(target || ''), detail: String(detail || '') };
  logTab_().appendRow([e.at, e.email, clean_(e.name), e.action, clean_(e.target), clean_(e.detail)]);
  return e;
}

function logs_(limit) {
  const sh = logTab_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const take = Math.min(n, limit);
  const rng = sh.getRange(sh.getLastRow() - take + 1, 1, take, 6);
  const raw = rng.getValues(), dsp = rng.getDisplayValues();
  const out = [];
  for (let i = take - 1; i >= 0; i--) {
    out.push({ at: ts_(raw[i][0]) || dsp[i][0], email: dsp[i][1], name: dsp[i][2], action: dsp[i][3], target: dsp[i][4], detail: dsp[i][5] });
  }
  return out;
}

// ── 소식 시트 (홈페이지가 CSV 로 읽음: 날짜, 제목, 출처, 링크, 공개) ──

function news_() {
  const sh = newsSs_().getSheets()[0];
  if (!String(sh.getRange(1, 5).getDisplayValue()).trim()) sh.getRange(1, 5).setValue('공개').setFontWeight('bold');
  return sh;
}

function newsList_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const v = sh.getRange(2, 1, n, 5).getDisplayValues();
  const out = [];
  v.forEach((r, i) => {
    const x = { row: i + 2, date: normDate_(r[0]), title: String(r[1]).trim(), source: String(r[2]).trim(), url: String(r[3]).trim(), visible: !HIDDEN.test(String(r[4]).trim()) };
    if (x.date || x.title || x.source || x.url) out.push(x);
  });
  return out;
}

function newsSig_(x) { return x.date + '|' + x.title; }

function newsOp_(q, who) {
  const sh = news_();
  const list = newsList_(sh);
  const at = q.row ? list.findIndex(x => x.row === Number(q.row)) : -1;
  if (q.op !== 'news.save' || q.row) {
    // 다른 사람이 시트를 먼저 고쳤으면 엉뚱한 줄을 건드리지 않게 막음
    if (at < 0 || newsSig_(list[at]) !== q.sig) throw err_('stale');
  }
  const cur = at >= 0 ? list[at] : null;
  let log;
  if (q.op === 'news.save') {
    const it = cleanNews_(q.item || {});
    const values = [[it.date, clean_(it.title), clean_(it.source), it.url, it.visible ? '공개' : '숨김']];
    if (cur) {
      const r = sh.getRange(cur.row, 1, 1, 5);
      r.setNumberFormat('@');
      r.setValues(values);
      log = log_(who, '소식 수정', '', it.title);
    } else {
      sh.insertRowBefore(2);
      const r = sh.getRange(2, 1, 1, 5);
      r.setNumberFormat('@');
      r.setValues(values);
      log = log_(who, '소식 등록', '', it.title);
    }
  } else if (q.op === 'news.move') {
    const to = at + (Number(q.dir) < 0 ? -1 : 1);
    if (to >= 0 && to < list.length) {
      const a = sh.getRange(list[at].row, 1, 1, 5), b = sh.getRange(list[to].row, 1, 1, 5);
      const av = a.getValues(), bv = b.getValues(), af = a.getNumberFormats(), bf = b.getNumberFormats();
      a.setNumberFormats(bf); a.setValues(bv);
      b.setNumberFormats(af); b.setValues(av);
      log = log_(who, '소식 순서 변경', '', `${cur.title} (${at + 1} → ${to + 1}번째)`);
    }
  } else if (q.op === 'news.visible') {
    const on = !!q.visible;
    sh.getRange(cur.row, 5).setValue(on ? '공개' : '숨김');
    log = log_(who, on ? '소식 공개' : '소식 숨김', '', cur.title);
  } else if (q.op === 'news.delete') {
    sh.deleteRow(cur.row);
    log = log_(who, '소식 삭제', '', cur.title);
  }
  return { news: newsList_(sh), log: log || null };
}

function cleanNews_(it) {
  const title = String(it.title || '').trim().slice(0, 200);
  if (!title) throw err_('notitle');
  const url = String(it.url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) throw err_('badurl');
  return {
    date: normDate_(it.date) || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy.MM.dd'),
    title: title,
    source: String(it.source || '').trim().slice(0, 80),
    url: url.slice(0, 1000),
    visible: it.visible !== false,
  };
}

// 2026-09-04, 2026.9.4, 2026. 9. 4, 2026년 9월 4일 → 2026.09.04
function normDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy.MM.dd');
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
  return m ? `${m[1]}.${('0' + m[2]).slice(-2)}.${('0' + m[3]).slice(-2)}` : s;
}

// ── 설정: 알림 메일(스크립트 속성, 비공개) / 재생목록(소식 시트 '설정' 탭, 홈페이지가 공개로 읽음) ──

function notify_() {
  const v = PropertiesService.getScriptProperties().getProperty('NOTIFY_TO');
  const list = String(v || '').split(/[,\s]+/).filter(Boolean);
  return list.length ? list : [TO];
}

function settingsTab_() {
  const ss = newsSs_();
  let sh = ss.getSheetByName(SETTINGS_TAB);
  if (!sh) {
    sh = ss.insertSheet(SETTINGS_TAB, ss.getSheets().length);  // 맨 끝에. 홈페이지는 첫 번째 탭을 소식으로 읽음
    sh.getRange(1, 1, 1, 3).setValues([['사용법 영상', '재생목록 링크', '썸네일 영상']]).setFontWeight('bold');
    sh.getRange(2, 1, PLAYLISTS.length, 3).setValues(PLAYLISTS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function settings_() {
  const sh = settingsTab_();
  const n = Math.max(0, sh.getLastRow() - 1);
  const rows = n ? sh.getRange(2, 1, n, 3).getDisplayValues() : [];
  return {
    notify: notify_(),
    notifyDefault: TO,
    playlists: PLAYLISTS.map((d, i) => {
      const r = rows[i] || d;
      return { title: String(r[0] || d[0]).trim(), url: String(r[1] || '').trim(), thumb: String(r[2] || '').trim() };
    }),
  };
}

function saveSettings_(q, who) {
  const done = [];
  if (q.notify != null) {
    const list = String(q.notify).split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    if (list.length > 5 || list.some(s => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))) throw err_('bademail');
    const before = notify_().join(', ');
    const props = PropertiesService.getScriptProperties();
    if (list.length) props.setProperty('NOTIFY_TO', list.join(',')); else props.deleteProperty('NOTIFY_TO');
    const after = notify_().join(', ');
    if (before !== after) done.push(log_(who, '알림 메일 변경', '', after));
  }
  if (Array.isArray(q.playlists)) {
    const sh = settingsTab_();
    const cur = settings_().playlists;
    const rows = PLAYLISTS.map((d, i) => {
      const p = q.playlists[i] || cur[i];
      const url = String(p.url || '').trim();
      if (url && !/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(url)) throw err_('badurl');
      return [cur[i].title, url, ytId_(p.thumb) || ''];
    });
    const changed = rows.filter((r, i) => r[1] !== cur[i].url || r[2] !== (ytId_(cur[i].thumb) || '')).map(r => r[0]);
    if (changed.length) {
      sh.getRange(2, 1, rows.length, 3).setValues(rows);
      done.push(log_(who, '재생목록 링크 변경', '', changed.join(', ')));
    }
  }
  return { settings: settings_(), logs: done };
}

// 유튜브 주소나 영상 ID 에서 11자리 영상 ID 만
function ytId_(v) {
  const s = String(v || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/vi\/)([\w-]{11})/);
  return m ? m[1] : '';
}

// ── 공통 ──

// 처음 한 번 실행(코드를 바꿨을 때도 한 번): 시트·폴더·탭을 만들고, 매일 새벽 3시에 오래된 접수를 지우는 예약 등록
function setup() {
  Object.keys(FORMS).forEach(k => fill_(table_(k)));
  folder_();
  logTab_();
  news_();
  settingsTab_();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'cleanup').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('cleanup').timeBased().everyDays(1).atHour(3).inTimezone('Asia/Seoul').create();
  // 관리자 로그인 확인에 쓰는 '외부 요청' 권한을 여기서 미리 받아 둠
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=setup', { muteHttpExceptions: true });
  console.log('접수 시트: ' + ss_().getUrl());
  if (!CLIENT_ID) console.log('관리자 화면을 쓰려면 CLIENT_ID 를 채우고 다시 배포해야 함');
}

// 보유 기간(KEEP_DAYS)이 지난 접수 행과 첨부 파일을 지움. 알림 메일은 지메일에서 따로 지워야 함
function cleanup() {
  const limit = new Date(Date.now() - KEEP_DAYS * 86400000);
  Object.keys(FORMS).forEach(k => {
    const t = table_(k);
    const iTs = t.idx('ts');
    const rows = t.sh.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      const d = toDate_(rows[i][iTs]);
      if (d && d < limit) t.sh.deleteRow(i + 1);
    }
  });
  const files = folder_().getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.getDateCreated() < limit) f.setTrashed(true);
  }
}

// 한 번 실행하는 동안 같은 시트를 여러 번 열지 않게 기억해 둠
let SS_ = null, NEWS_SS_ = null;

function ss_() {
  if (SS_) return SS_;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  if (id) return (SS_ = SpreadsheetApp.openById(id));
  SS_ = SpreadsheetApp.create(SHEET_NAME);
  props.setProperty('SHEET_ID', SS_.getId());
  return SS_;
}

function newsSs_() {
  return NEWS_SS_ || (NEWS_SS_ = SpreadsheetApp.openById(NEWS_SHEET_ID));
}

function tab_(def) {
  const ss = ss_();
  let sh = ss.getSheetByName(def.tab);
  if (!sh) {
    const blank = ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0 ? ss.getSheets()[0] : null;
    sh = blank ? blank.setName(def.tab) : ss.insertSheet(def.tab);
    const head = def.cols.concat(EXTRA).map(([label]) => label);
    sh.appendRow(head);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
  }
  return sh;
}

function folder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  const f = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}

function now_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
}

// 시트가 접수 시각을 날짜로 바꿔 저장하는 경우가 많아서 둘 다 받음
function toDate_(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v || '').trim();
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : '+09:00'));
  return isNaN(d) ? null : d;
}

function ts_(v) {
  if (v instanceof Date) return isNaN(v) ? '' : Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  return String(v == null ? '' : v).trim();
}

function err_(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

// 시트에 '=' 로 시작하는 값이 수식으로 실행되지 않게 막음
function clean_(v) {
  v = v == null ? '' : String(v).slice(0, 5000);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
