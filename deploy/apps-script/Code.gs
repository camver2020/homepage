/**
 * 캠버 홈페이지 문의 접수기 (Google Apps Script 웹앱)
 *
 * 홈페이지 고객센터의 두 폼(도입·제휴 문의 / 입사 지원·파트너 제휴)이 여기로 보냄.
 * 1) 접수 시트에 한 줄 쌓고  2) 첨부 파일은 드라이브 폴더에 저장하고  3) TO 주소로 알림 메일을 보냄.
 *
 * 설치 (camver2020@gmail.com 계정으로 로그인해서)
 *  1. script.google.com → 새 프로젝트 → 이 파일 내용 통째로 붙여넣기 → 저장
 *  2. 함수 목록에서 setup 선택 → 실행 → 권한 허용 (시트·드라이브·메일 권한)
 *     → '캠버 홈페이지 문의 접수' 시트와 '캠버 홈페이지 첨부파일' 폴더가 생기고, 1년 지난 접수를 매일 지우는 예약이 걸림
 *  3. 배포 → 새 배포 → 유형: 웹 앱
 *     - 다음 사용자로 실행: 나
 *     - 액세스 권한이 있는 사용자: 모든 사용자
 *  4. 나온 웹 앱 URL(https://script.google.com/macros/s/…/exec)을 홈페이지 src/config.json 의 form_endpoint 에 넣고 다시 빌드
 *
 * 코드를 고치면: 배포 → 배포 관리 → 연필 → 버전 '새 버전' → 배포 (URL 은 그대로 유지됨)
 */

const TO = 'camver2020@gmail.com';            // 알림 받을 주소
const SHEET_NAME = '캠버 홈페이지 문의 접수';
const FOLDER_NAME = '캠버 홈페이지 첨부파일';
const MAX_FILE_MB = 10;                        // 홈페이지 폼의 제한과 같게
const KEEP_DAYS = 365;                         // 개인정보 처리방침의 보유 기간(접수일부터 1년)

const FORMS = {
  contact: {
    tab: '도입·제휴 문의',
    cols: [['접수 시각', 'ts'], ['문의 유형', 'type'], ['회사·기관명', 'org'], ['담당자 이름', 'name'], ['연락처', 'tel'], ['이메일', 'email'], ['문의 내용', 'message'], ['보낸 페이지', 'page']],
    subject: p => `[홈페이지 문의] ${p.type || '기타'} · ${p.org || p.name}`,
  },
  join: {
    tab: '입사 지원·파트너 제휴',
    cols: [['접수 시각', 'ts'], ['신청 구분', 'kind'], ['이름·회사명', 'name'], ['분야', 'field'], ['연락처', 'tel'], ['이메일', 'email'], ['소개', 'message'], ['첨부 파일', 'fileUrl'], ['보낸 페이지', 'page']],
    subject: p => `[홈페이지 ${p.kind || '입사·제휴'}] ${p.name}`,
  },
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const p = Object.assign({}, (e && e.parameter) || {});
    if (p.website) return json({ ok: true });  // 스팸 봇이 숨은 칸을 채운 경우: 저장하지 않음
    const kind = FORMS[p.form] ? p.form : 'contact';
    const def = FORMS[kind];
    if (!p.name || !p.tel) return json({ ok: false, error: 'missing' });

    p.ts = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
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

    const sh = tab_(def);
    // 연락처는 01012345678 처럼 숫자만 오면 시트가 앞의 0을 지우므로 글자로 저장
    sh.appendRow(def.cols.map(([, key]) => (key === 'tel' && /^\d/.test(p.tel || '') ? "'" : '') + clean_(p[key])));

    const lines = def.cols.filter(([, key]) => key !== 'ts' && p[key]).map(([label, key]) => `${label}: ${p[key]}`);
    const mail = {
      to: TO,
      subject: def.subject(p),
      body: lines.join('\n\n') + `\n\n접수 시각: ${p.ts}\n접수 시트: ${ss_().getUrl()}`,
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

// 주소를 브라우저로 열었을 때 살아 있는지 확인용
function doGet() {
  return json({ ok: true, service: 'camver-form' });
}

// 처음 한 번 실행: 시트·폴더 만들고, 매일 새벽 3시에 오래된 접수를 지우는 예약 등록
function setup() {
  Object.keys(FORMS).forEach(k => tab_(FORMS[k]));
  folder_();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'cleanup').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('cleanup').timeBased().everyDays(1).atHour(3).inTimezone('Asia/Seoul').create();
  console.log('시트: ' + ss_().getUrl());
}

// 보유 기간(KEEP_DAYS)이 지난 접수 행과 첨부 파일을 지움. 알림 메일은 지메일에서 따로 지워야 함
function cleanup() {
  const limit = new Date(Date.now() - KEEP_DAYS * 86400000);
  Object.keys(FORMS).forEach(k => {
    const sh = tab_(FORMS[k]);
    const rows = sh.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      const v = rows[i][0];  // 시트가 접수 시각을 날짜로 바꿔 저장하는 경우가 많음
      const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T') + '+09:00');
      if (!isNaN(d) && d < limit) sh.deleteRow(i + 1);
    }
  });
  const files = folder_().getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.getDateCreated() < limit) f.setTrashed(true);
  }
}

function ss_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create(SHEET_NAME);
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function tab_(def) {
  const ss = ss_();
  let sh = ss.getSheetByName(def.tab);
  if (!sh) {
    const blank = ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0 ? ss.getSheets()[0] : null;
    sh = blank ? blank.setName(def.tab) : ss.insertSheet(def.tab);
    sh.appendRow(def.cols.map(([label]) => label));
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, def.cols.length).setFontWeight('bold');
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

// 시트에 '=' 로 시작하는 값이 수식으로 실행되지 않게 막음
function clean_(v) {
  v = v == null ? '' : String(v).slice(0, 5000);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
