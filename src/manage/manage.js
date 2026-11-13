/* 캠버 홈페이지 관리 화면
   - 데이터는 문의 접수 시트·소식 시트에 있고, Apps Script(deploy/apps-script/Code.gs)가 읽고 씀
   - 로그인은 구글 로그인(허용 계정만) → ID 토큰을 Apps Script 가 구글에 확인
   - window.CAMVER_MANAGE = { endpoint, clientId, demo } 는 tools/build.py 가 src/config.json 값으로 넣어 줌
   - demo 가 켜져 있으면 서버 없이 화면 안의 예시 데이터로 똑같이 돌아감(미리보기용) */
(function () {
  'use strict';

  var CFG = window.CAMVER_MANAGE || {};
  var DEMO = !!CFG.demo;
  var KEY_TOKEN = 'camver:manage:token';
  var KEY_ACTOR = 'camver:manage:actor';
  var STATUSES = ['접수', '처리중', '완료'];
  var CONTACT_TYPES = ['Fleet AI OS 도입', '휴양소·위탁 운영', '이동형 안전 쉼터', '차량 제작·개조', '스테이션 개설', '기타'];
  var JOIN_KINDS = ['입사 지원', '파트너 제휴'];

  // ── 작은 도구 ─────────────────────────────────────────────
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function safeUrl(u) { u = String(u || '').trim(); return /^https?:\/\//i.test(u) ? u : ''; }
  function kstNow(offsetMin) { return new Date(Date.now() + 9 * 3600000 - (offsetMin || 0) * 60000).toISOString().slice(0, 19).replace('T', ' '); }
  function toDate(ts) { var d = new Date(String(ts || '').replace(' ', 'T') + '+09:00'); return isNaN(d) ? null : d; }
  function day(ts) { return String(ts || '').slice(0, 10); }
  function short(ts) { ts = String(ts || ''); return ts.length >= 16 ? ts.slice(2, 10).replace(/-/g, '.') + ' ' + ts.slice(11, 16) : ts; }
  function ago(ts) {
    var d = toDate(ts); if (!d) return ts || '';
    var m = Math.round((Date.now() - d.getTime()) / 60000);
    if (m < 1) return '방금';
    if (m < 60) return m + '분 전';
    if (m < 60 * 24) return Math.floor(m / 60) + '시간 전';
    if (m < 60 * 48) return '어제';
    if (m < 60 * 24 * 14) return Math.floor(m / 1440) + '일 전';
    return short(ts).slice(0, 8);
  }
  function dotDate(s) { var m = String(s || '').match(/^(\d{4})[.\-](\d{2})[.\-](\d{2})/); return m ? m[1] + '-' + m[2] + '-' + m[3] : ''; }
  function chip(st) { st = STATUSES.indexOf(st) > -1 ? st : '접수'; return '<span class="st st-' + st + '">' + st + '</span>'; }
  function svgArrow() { return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg>'; }
  function actor() { try { return localStorage.getItem(KEY_ACTOR) || ''; } catch (e) { return ''; } }
  function setActor(v) { try { localStorage.setItem(KEY_ACTOR, v); } catch (e) {} }

  var ERR = {
    auth: '로그인 시간이 지났습니다. 다시 로그인해 주세요.',
    forbidden: '관리자로 허용된 구글 계정이 아닙니다. camver2020 계정으로 로그인해 주세요.',
    setup: 'Apps Script 에 구글 로그인 설정(CLIENT_ID)이 아직 없습니다.',
    stale: '그사이 소식 시트가 바뀌었습니다. 새 목록을 불러왔으니 다시 해 주세요.',
    notfound: '해당 접수를 찾지 못했습니다. 보관 기간이 지나 자동 삭제됐을 수 있습니다.',
    nofile: '첨부 파일이 없거나 링크가 잘못됐습니다.',
    toolarge: '파일이 커서 화면에서 열 수 없습니다. 드라이브에서 열어 주세요.',
    notitle: '제목을 적어 주세요.',
    badurl: '링크 주소를 확인해 주세요. https:// 로 시작해야 하고, 재생목록은 유튜브 주소만 됩니다.',
    bademail: '메일 주소 형식을 확인해 주세요. 최대 5개까지 넣을 수 있습니다.',
    network: '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.',
    bad: '요청이 잘못됐습니다. 새로고침 후 다시 해 주세요.',
    server: '처리하지 못했습니다. 잠시 후 다시 해 주세요.'
  };
  function apiErr(code, message) { var e = new Error(message || code); e.code = code; return e; }

  // ── 상태 ─────────────────────────────────────────────────
  var S = {
    me: null, contact: [], join: [], news: [], logs: [], settings: null, retention: null, now: '',
    view: '', open: null,
    f: {
      contact: { st: '', q: '', from: '', to: '', sub: '' },
      join: { st: '', q: '', from: '', to: '', sub: '' },
      logs: { k: '', q: '' }
    }
  };
  var session = { token: '', exp: 0 };
  var pendingToken = '';

  // ── 서버 요청 ─────────────────────────────────────────────
  function api(op, body) {
    if (DEMO) return demoApi(op, body || {});
    var payload = Object.assign({ token: session.token, actor: actor(), op: op }, body || {});
    var p = new URLSearchParams();
    p.append('action', 'admin');
    p.append('payload', JSON.stringify(payload));
    return fetch(CFG.endpoint, { method: 'POST', body: p })
      .catch(function () { throw apiErr('network'); })
      .then(function (r) { return r.json().catch(function () { throw apiErr('server'); }); })
      .then(function (j) { if (!j || !j.ok) throw apiErr((j && j.error) || 'server', j && j.message); return j; });
  }

  // 공통 실패 처리: 로그인 문제면 로그인 화면으로, 나머지는 알림
  function fail(e) {
    var code = (e && e.code) || 'server';
    if (code === 'auth' || code === 'forbidden' || code === 'setup') { toLogin(ERR[code]); return; }
    toast(ERR[code] || ERR.server, true);
    if (code === 'stale') reload(true);
  }
  function busy(btn, on) { if (!btn) return; btn.classList.toggle('busy', on); btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false'); }

  // ── 로그인 ───────────────────────────────────────────────
  var loginEl = $('#login'), appEl = $('#app'), msgEl = $('#loginMsg'), actorEl = $('#actor');

  function decodeJwt(t) {
    try {
      var s = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      s += '==='.slice((s.length + 3) % 4);
      return JSON.parse(decodeURIComponent(atob(s).split('').map(function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join('')));
    } catch (e) { return {}; }
  }

  function boot() {
    actorEl.value = actor();
    if (DEMO) {
      $('#demoGo').hidden = false;
      $('#demoFlag').hidden = false;
      $('#loginNote').textContent = '미리보기용 데모입니다. 구글 로그인 없이 예시 데이터로 둘러봅니다.';
    } else if (!CFG.clientId || !CFG.endpoint) {
      $('#loginNote').textContent = '구글 로그인 설정 전입니다. src/config.json 의 google_client_id 와 Apps Script 의 CLIENT_ID 를 채우면 열립니다.';
    } else {
      loadGis();
    }
    // 같은 탭에서 새로고침하면 로그인 유지 (토큰이 살아 있는 동안)
    try {
      var saved = JSON.parse(sessionStorage.getItem(KEY_TOKEN) || 'null');
      if (saved && saved.token && saved.exp * 1000 > Date.now() + 60000 && actor()) { session = saved; enter('load'); return; }
    } catch (e) {}
    actorEl.focus();
  }

  function loadGis() {
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = function () {
      google.accounts.id.initialize({ client_id: CFG.clientId, callback: onCredential, ux_mode: 'popup', auto_select: false, context: 'signin', login_hint: 'camver2020@gmail.com' });
      google.accounts.id.renderButton($('#gbtn'), { type: 'standard', theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular', logo_alignment: 'left', width: 320, locale: 'ko' });
    };
    s.onerror = function () { msgEl.textContent = '구글 로그인 버튼을 불러오지 못했습니다. 인터넷 연결이나 광고 차단 설정을 확인해 주세요.'; };
    document.head.appendChild(s);
  }

  function actorOk() {
    var v = actorEl.value.replace(/[<>]/g, '').trim();
    actorEl.setAttribute('aria-invalid', v ? 'false' : 'true');
    return v;
  }

  function onCredential(resp) {
    var tok = resp && resp.credential;
    if (!tok) return;
    if (!actorOk()) { pendingToken = tok; msgEl.textContent = '담당자 이름을 적고 Enter 를 눌러 주세요.'; actorEl.focus(); return; }
    signIn(tok);
  }

  function signIn(tok) {
    var name = actorOk();
    setActor(name);
    var p = DEMO ? { exp: Date.now() / 1000 + 3600 } : decodeJwt(tok);
    session = { token: tok, exp: Number(p.exp) || 0 };
    try { sessionStorage.setItem(KEY_TOKEN, JSON.stringify(session)); } catch (e) {}
    pendingToken = '';
    msgEl.textContent = '';
    enter('login');
  }

  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!actorOk()) { msgEl.textContent = '담당자 이름을 적어 주세요.'; actorEl.focus(); return; }
    if (DEMO) { signIn('demo'); return; }
    if (pendingToken) { signIn(pendingToken); return; }
    msgEl.textContent = '아래 구글 로그인 버튼을 눌러 주세요.';
  });
  actorEl.addEventListener('input', function () { if (actorEl.value.trim()) { actorEl.removeAttribute('aria-invalid'); if (msgEl.textContent.indexOf('담당자') === 0) msgEl.textContent = ''; } });

  function enter(op) {
    loginEl.hidden = true;
    appEl.hidden = false;
    $('#view').innerHTML = '<p class="loading">시트에서 불러오는 중</p>';
    setTitle('불러오는 중', 'LOADING');
    api(op).then(function (r) {
      apply(r);
      S.view = '';
      route();
      if (op === 'login') toast((S.me && S.me.name ? S.me.name + ' 님, ' : '') + '들어왔습니다.');
    }).catch(function (e) {
      var code = (e && e.code) || 'server';
      toLogin(ERR[code] || ERR.server);
    });
  }

  function toLogin(message) {
    session = { token: '', exp: 0 };
    try { sessionStorage.removeItem(KEY_TOKEN); } catch (e) {}
    closeDrawer(true);
    appEl.hidden = true;
    loginEl.hidden = false;
    msgEl.textContent = message || '';
    actorEl.value = actor();
    actorEl.focus();
  }

  function logout() {
    if (!DEMO && window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    toLogin('로그아웃했습니다.');
  }

  function apply(r) {
    ['contact', 'join', 'news', 'logs'].forEach(function (k) { if (r[k]) S[k] = r[k]; });
    if (r.me) S.me = r.me;
    if (r.settings) S.settings = r.settings;
    if (r.retention) S.retention = r.retention;
    S.now = r.now || kstNow();
    $('#whoName').textContent = S.me ? S.me.name : '';
    $('#whoMail').textContent = S.me ? S.me.email : '';
    $('#syncAt').textContent = '불러온 시각 ' + short(S.now);
    counts();
  }

  function counts() {
    ['contact', 'join'].forEach(function (k) {
      var n = S[k].filter(function (x) { return x.status === '접수'; }).length;
      var el = $('[data-cnt="' + k + '"]');
      el.textContent = n ? String(n) : '';
      el.setAttribute('aria-label', n ? '새 ' + n + '건' : '');
    });
  }

  function reload(quiet) {
    var btn = $('[data-act="reload"]');
    busy(btn, true);
    return api('load').then(function (r) {
      apply(r);
      var open = S.open;
      renderView(S.view);
      if (open && open.kind !== 'news') openItem(open.kind, open.id, true);
      if (!quiet) toast('시트의 최신 내용으로 바꿨습니다.');
    }).catch(fail).then(function () { busy(btn, false); });
  }

  // ── 화면 이동 ────────────────────────────────────────────
  var VIEWS = {
    home: { title: '한눈에 보기', crumb: 'OVERVIEW', render: renderHome },
    contact: { title: '도입·제휴 문의', crumb: 'INQUIRIES', render: function (v) { renderList('contact', v); } },
    join: { title: '입사 지원·제휴 신청', crumb: 'APPLICATIONS', render: function (v) { renderList('join', v); } },
    news: { title: '소식', crumb: 'NEWS', render: renderNews },
    logs: { title: '작업 기록', crumb: 'AUDIT LOG', render: renderLogs },
    settings: { title: '설정', crumb: 'SETTINGS', render: renderSettings }
  };

  function setTitle(t, crumb) {
    $('#viewTitle').innerHTML = '<span class="mark">' + esc(t) + '</span>';
    $('#crumb').textContent = 'CAMVER.AI / CONSOLE / ' + crumb;
    document.title = t + ' | 홈페이지 관리';
  }

  function route() {
    if (appEl.hidden) return;
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    var v = VIEWS[parts[0]] ? parts[0] : 'home';
    var id = parts[1] ? decodeURIComponent(parts[1]) : '';
    if (v !== S.view) renderView(v);
    if (id && (v === 'contact' || v === 'join')) openItem(v, id);
    else if (S.open && S.open.kind !== 'news') closeDrawer(true);
  }

  function renderView(v) {
    S.view = v;
    setTitle(VIEWS[v].title, VIEWS[v].crumb);
    var nav = $('#nav');
    $$('a', nav).forEach(function (a) {
      if (a.getAttribute('data-v') !== v) { a.removeAttribute('aria-current'); return; }
      a.setAttribute('aria-current', 'page');
      // 좁은 화면에서 메뉴가 가로로 넘칠 때 지금 메뉴가 보이게
      if (nav.scrollWidth > nav.clientWidth + 4) nav.scrollTo({ left: Math.max(0, a.offsetLeft - 16), behavior: 'smooth' });
    });
    var box = $('#view');
    box.innerHTML = '';
    VIEWS[v].render(box);
    $$(':scope > *', box).forEach(function (el, i) { el.style.setProperty('--i', i); });
  }

  function go(view, filter) {
    if (filter && S.f[view]) Object.assign(S.f[view], { st: '', q: '', from: '', to: '', sub: '' }, filter);
    if (location.hash === '#/' + view) renderView(view); else location.hash = '#/' + view;
  }

  window.addEventListener('hashchange', route);

  // ── 한눈에 보기 ──────────────────────────────────────────
  function renderHome(box) {
    var month = kstNow().slice(0, 7);
    var c = S.contact, j = S.join;
    var is = function (st) { return function (x) { return x.status === st; }; };
    var nNew = c.filter(is('접수')).length, nJoin = j.filter(is('접수')).length;
    var nIng = c.filter(is('처리중')).length + j.filter(is('처리중')).length;
    var mc = c.filter(function (x) { return x.ts.slice(0, 7) === month; }).length;
    var mj = j.filter(function (x) { return x.ts.slice(0, 7) === month; }).length;
    var soon = S.retention ? S.retention.tabs.reduce(function (a, t) { return a + t.soon; }, 0) : 0;
    var fig = function (go, label, n, sub, hot) {
      return '<a class="fig' + (hot ? ' hot' : '') + '" href="#" data-go="' + go + '"><span>' + label + '</span><b>' + n + '</b><small>' + sub + '</small></a>';
    };
    var queue = c.filter(is('접수')).map(function (x) { return { k: 'contact', x: x }; })
      .concat(j.filter(is('접수')).map(function (x) { return { k: 'join', x: x }; }))
      .sort(function (a, b) { return a.x.ts < b.x.ts ? 1 : -1; }).slice(0, 7);
    var visible = S.news.filter(function (n) { return n.visible; }).length;

    box.innerHTML =
      '<div class="figs">' +
        fig('contact:접수', '새 도입·제휴 문의', nNew, nNew ? '확인이 필요한 문의' : '모두 확인함', nNew > 0) +
        fig('contact:처리중', '처리중', nIng, '문의 ' + c.filter(is('처리중')).length + ' · 신청 ' + j.filter(is('처리중')).length) +
        fig('contact:', '이번 달 접수', mc + mj, '문의 ' + mc + ' · 입사·제휴 ' + mj) +
        fig('join:접수', '새 입사 지원·제휴', nJoin, nJoin ? '이력서·제안 확인 필요' : '모두 확인함', nJoin > 0) +
        fig('settings:', '30일 안 자동 삭제', soon, '접수일부터 1년 지난 건') +
      '</div>' +
      '<div class="cols sec">' +
        '<section><div class="sec-h"><h2>확인 안 한 접수</h2><a href="#/contact">전체 문의 보기</a></div><div class="panel">' +
          (queue.length ? '<ul class="queue">' + queue.map(function (q) {
            var x = q.x, main = q.k === 'contact' ? (x.org || x.name) : x.name;
            var sub = q.k === 'contact' ? (x.type + (x.org ? ' · ' + x.name : '')) : (x.kind + (x.field ? ' · ' + x.field : ''));
            return '<li><a href="#/' + q.k + '/' + encodeURIComponent(x.id) + '"><span class="q-when">' + esc(ago(x.ts)) + '</span><span class="q-main"><b>' + esc(main) + '</b><span>' + esc(sub) + '</span></span>' + chip(x.status) + '</a></li>';
          }).join('') + '</ul>' : '<p class="empty">확인 안 한 접수가 없습니다.</p>') +
        '</div></section>' +
        '<section><div class="sec-h"><h2>최근 작업</h2><a href="#/logs">작업 기록</a></div><div class="panel">' +
          (S.logs.length ? '<ul class="feed">' + S.logs.slice(0, 7).map(function (l) {
            return '<li><div><b>' + esc(l.action) + '</b>' + (l.detail || l.target ? '<p>' + esc([l.target, l.detail].filter(Boolean).join(' · ')) + '</p>' : '') + '<time>' + esc(short(l.at)) + ' · ' + esc(l.name) + '</time></div></li>';
          }).join('') + '</ul>' : '<p class="empty">아직 기록이 없습니다.</p>') +
        '</div></section>' +
      '</div>' +
      '<div class="strip sec"><span>홈페이지 소식 공개 <b>' + visible + '</b> · 숨김 <b>' + (S.news.length - visible) + '</b></span>' +
        '<span>새 문의 알림 <b>' + esc((S.settings ? S.settings.notify : []).join(', ')) + '</b></span>' +
        '<span>보관 기간 <b>1년</b> · 매일 03:00 자동 삭제</span></div>';

    $$('[data-go]', box).forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var p = a.getAttribute('data-go').split(':');
        go(p[0], p[0] === 'settings' ? null : { st: p[1] || '' });
      });
    });
  }

  // ── 문의·신청 목록 ───────────────────────────────────────
  function filtered(kind) {
    var f = S.f[kind], q = f.q.trim().toLowerCase(), qd = digits(q);
    return S[kind].filter(function (x) {
      if (f.st && x.status !== f.st) return false;
      if (f.sub && (kind === 'contact' ? x.type : x.kind) !== f.sub) return false;
      if (f.from && day(x.ts) < f.from) return false;
      if (f.to && day(x.ts) > f.to) return false;
      if (!q) return true;
      if ([x.name, x.org, x.email, x.id, x.field].some(function (s) { return String(s || '').toLowerCase().indexOf(q) > -1; })) return true;
      return qd.length >= 3 && digits(x.tel).indexOf(qd) > -1;
    });
  }

  function renderList(kind, box) {
    var f = S.f[kind];
    var subs = kind === 'contact' ? CONTACT_TYPES : JOIN_KINDS;
    S[kind].forEach(function (x) { var v = kind === 'contact' ? x.type : x.kind; if (v && subs.indexOf(v) < 0) subs = subs.concat(v); });
    box.innerHTML =
      '<div class="tabs" role="group" aria-label="상태로 거르기" id="stTabs"></div>' +
      '<div class="tools">' +
        '<div><label class="lbl" for="fq">검색</label><input class="in" id="fq" type="search" placeholder="이름 · 회사 · 연락처 · 이메일 · 접수번호" value="' + esc(f.q) + '"></div>' +
        '<div><span class="lbl" id="fr-l">접수 기간</span><div class="range" role="group" aria-labelledby="fr-l"><input class="in" id="ffrom" type="date" aria-label="시작일" value="' + esc(f.from) + '"><span>~</span><input class="in" id="fto" type="date" aria-label="종료일" value="' + esc(f.to) + '"></div></div>' +
        '<div><label class="lbl" for="fsub">' + (kind === 'contact' ? '문의 유형' : '신청 구분') + '</label><select class="in" id="fsub"><option value="">전체</option>' +
          subs.map(function (s) { return '<option' + (s === f.sub ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></div>' +
        '<div class="acts"><button class="btn ghost" type="button" id="freset">초기화</button><button class="btn dark" type="button" id="fcsv"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10M6 9l4 4 4-4M4 16h12"/></svg>엑셀 내려받기</button></div>' +
      '</div>' +
      '<div class="count" id="fcount"></div>' +
      '<div class="tbl-wrap"><table class="tbl" id="ftbl"><thead><tr>' +
        (kind === 'contact'
          ? '<th scope="col">접수번호</th><th scope="col">접수 시각</th><th scope="col">문의 유형</th><th scope="col">회사 · 담당자</th><th scope="col">연락처</th><th scope="col">상태</th>'
          : '<th scope="col">접수번호</th><th scope="col">접수 시각</th><th scope="col">구분</th><th scope="col">이름 · 회사</th><th scope="col">분야</th><th scope="col">첨부</th><th scope="col">상태</th>') +
      '</tr></thead><tbody></tbody></table></div>';

    var upd = function () { drawRows(kind); };
    $('#fq', box).addEventListener('input', function (e) { f.q = e.target.value; upd(); });
    $('#ffrom', box).addEventListener('change', function (e) { f.from = e.target.value; upd(); });
    $('#fto', box).addEventListener('change', function (e) { f.to = e.target.value; upd(); });
    $('#fsub', box).addEventListener('change', function (e) { f.sub = e.target.value; upd(); });
    $('#freset', box).addEventListener('click', function () { Object.assign(f, { st: '', q: '', from: '', to: '', sub: '' }); renderView(kind); });
    $('#fcsv', box).addEventListener('click', function () { exportCsv(kind); });
    $('#ftbl tbody', box).addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-id]');
      if (tr) location.hash = '#/' + kind + '/' + encodeURIComponent(tr.getAttribute('data-id'));
    });
    $('#ftbl tbody', box).addEventListener('keydown', function (e) {
      var tr = e.target.closest('tr[data-id]');
      if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tr.click(); }
    });
    upd();
  }

  function drawRows(kind) {
    var f = S.f[kind];
    var tabs = $('#stTabs');
    if (!tabs) return;
    var base = S[kind];
    tabs.innerHTML = [''].concat(STATUSES).map(function (st) {
      var n = st ? base.filter(function (x) { return x.status === st; }).length : base.length;
      return '<button type="button" data-st="' + st + '" aria-pressed="' + (f.st === st) + '">' + (st || '전체') + '<span class="n">' + n + '</span></button>';
    }).join('');
    $$('button', tabs).forEach(function (b) { b.addEventListener('click', function () { f.st = b.getAttribute('data-st'); drawRows(kind); }); });

    var rows = filtered(kind);
    $('#fcount').innerHTML = '<span><b>' + rows.length + '</b>건' + (rows.length !== base.length ? ' · 전체 ' + base.length + '건' : '') + '</span><span>최근 접수 순 · 접수일부터 1년 보관</span>';
    var open = S.open && S.open.kind === kind ? S.open.id : '';
    $('#ftbl tbody').innerHTML = rows.length ? rows.map(function (x) {
      var cls = (x.status === '접수' ? 'new' : '') + (x.id === open ? ' is-open' : '');
      var lead = '<tr data-id="' + esc(x.id) + '" class="' + cls + '" tabindex="0" aria-label="' + esc((x.org || x.name) + ' 상세 보기') + '">' +
        '<td class="c-id">' + esc(x.id) + '</td><td class="c-ts">' + esc(short(x.ts)) + '</td>';
      if (kind === 'contact') {
        return lead + '<td class="c-kind">' + esc(x.type) + '</td>' +
          '<td class="c-main"><b>' + esc(x.org || x.name) + '</b><span>' + esc(x.org ? x.name : (x.email || '')) + '</span></td>' +
          '<td class="c-tel">' + esc(x.tel) + '</td><td class="c-st">' + chip(x.status) + '</td></tr>';
      }
      var hasFile = /^https?:/.test(x.fileUrl || '');
      return lead + '<td class="c-kind">' + esc(x.kind) + '</td>' +
        '<td class="c-main"><b>' + esc(x.name) + '</b><span>' + esc(x.email) + '</span></td>' +
        '<td class="c-extra">' + esc(x.field || '—') + '</td>' +
        '<td class="c-file">' + (hasFile ? '<svg viewBox="0 0 20 20" role="img" aria-label="첨부 있음"><path d="M13.5 6.5 8 12a1.8 1.8 0 0 1-2.5-2.5l6-6a3 3 0 0 1 4.2 4.2l-6.3 6.3a4.2 4.2 0 0 1-6-6L9 2.5"/></svg>' : '<span aria-label="첨부 없음">—</span>') + '</td>' +
        '<td class="c-st">' + chip(x.status) + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">조건에 맞는 접수가 없습니다.</td></tr>';
  }

  // 엑셀에서 바로 열리는 CSV (UTF-8 BOM). 수식으로 실행될 수 있는 값은 앞에 ' 를 붙임
  function exportCsv(kind) {
    var rows = filtered(kind);
    if (!rows.length) { toast('내려받을 접수가 없습니다.', true); return; }
    var cols = kind === 'contact'
      ? [['접수번호', 'id'], ['접수 시각', 'ts'], ['문의 유형', 'type'], ['회사·기관명', 'org'], ['담당자 이름', 'name'], ['연락처', 'tel'], ['이메일', 'email'], ['문의 내용', 'message'], ['상태', 'status'], ['담당자 메모', 'memo'], ['최근 처리자', 'by'], ['최근 처리 시각', 'at']]
      : [['접수번호', 'id'], ['접수 시각', 'ts'], ['신청 구분', 'kind'], ['이름·회사명', 'name'], ['분야', 'field'], ['연락처', 'tel'], ['이메일', 'email'], ['소개', 'message'], ['첨부 파일', 'fileUrl'], ['상태', 'status'], ['담당자 메모', 'memo'], ['최근 처리자', 'by'], ['최근 처리 시각', 'at']];
    var cell = function (v) {
      v = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
      return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var text = '﻿' + [cols.map(function (c) { return c[0]; })].concat(rows.map(function (x) { return cols.map(function (c) { return x[c[1]]; }); }))
      .map(function (r) { return r.map(cell).join(','); }).join('\r\n');
    var name = '캠버_' + (kind === 'contact' ? '도입제휴문의' : '입사지원제휴') + '_' + kstNow().slice(0, 10).replace(/-/g, '') + '.csv';
    download(new Blob([text], { type: 'text/csv;charset=utf-8' }), name);
    toast(rows.length + '건을 내려받았습니다.');
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // ── 상세 패널 ────────────────────────────────────────────
  var drawer = $('#drawer'), panel = $('#drawerPanel'), lastFocus = null;

  function showDrawer() {
    if (drawer.hidden) lastFocus = document.activeElement;
    drawer.hidden = false;
    document.body.style.overflow = 'hidden';
    panel.scrollTop = 0;
    setTimeout(function () { panel.focus(); }, 30);
  }

  function closeDrawer(silent) {
    if (drawer.hidden) { S.open = null; return; }
    drawer.hidden = true;
    document.body.style.overflow = '';
    var was = S.open;
    S.open = null;
    $$('#ftbl tr.is-open').forEach(function (tr) { tr.classList.remove('is-open'); });
    // 주소에 붙은 접수번호만 떼어 냄(목록은 그대로 두고, 같은 줄을 다시 누르면 다시 열리게)
    if (!silent && was && (was.kind === 'contact' || was.kind === 'join') && location.hash.split('/').length > 2) {
      history.replaceState(null, '', '#/' + was.kind);
    }
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  }

  drawer.addEventListener('click', function (e) { if (e.target.closest('[data-act="close"]')) closeDrawer(); });
  document.addEventListener('keydown', function (e) {
    if (drawer.hidden) return;
    if (e.key === 'Escape') { closeDrawer(); return; }
    if (e.key === 'Tab') {
      var f = $$('a[href], button:not([disabled]), input, select, textarea, [tabindex="0"]', panel).filter(function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && (document.activeElement === f[0] || document.activeElement === panel)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  function field(label, value, mono) {
    if (!value) return '';
    return '<dt>' + label + '</dt><dd' + (mono ? ' class="mono"' : '') + '>' + value + '</dd>';
  }

  function openItem(kind, id, keepScroll) {
    var x = S[kind].find(function (i) { return i.id === id; });
    if (!x) { toast(ERR.notfound, true); history.replaceState(null, '', '#/' + kind); return; }
    S.open = { kind: kind, id: id };
    $$('#ftbl tr').forEach(function (tr) { tr.classList.toggle('is-open', tr.getAttribute('data-id') === id); });
    var top = panel.scrollTop;
    var title = kind === 'contact' ? (x.org || x.name) : x.name;
    var hasFile = /^https?:/.test(x.fileUrl || '');
    var telD = digits(x.tel);
    var mailSubj = encodeURIComponent('[캠버] ' + (kind === 'contact' ? '문의' : '신청') + ' 회신 (' + x.id + ')');
    var hist = S.logs.filter(function (l) { return l.target === x.id; });
    panel.innerHTML =
      '<header class="d-head"><span class="mono">' + esc(x.id) + '</span>' + chip(x.status) +
        '<button class="btn icon ghost" type="button" data-act="close" aria-label="닫기"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg></button></header>' +
      '<div class="d-body">' +
        '<h2 class="d-title" id="drawerTitle">' + esc(title) + '</h2>' +
        '<p class="d-sub">' + esc(kind === 'contact' ? x.type : x.kind) + ' · <span class="mono">' + esc(x.ts) + '</span> · ' + esc(ago(x.ts)) + '</p>' +
        '<div class="d-quick">' +
          (telD ? '<a class="btn sm" href="tel:' + esc(telD) + '">전화 걸기</a>' : '') +
          (x.email ? '<a class="btn sm" href="mailto:' + esc(x.email) + '?subject=' + mailSubj + '">메일 쓰기</a>' : '') +
          (hasFile ? '<button class="btn sm dark" type="button" data-file="' + esc(x.id) + '"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.5 6.5 8 12a1.8 1.8 0 0 1-2.5-2.5l6-6a3 3 0 0 1 4.2 4.2l-6.3 6.3a4.2 4.2 0 0 1-6-6L9 2.5"/></svg>첨부 파일 열기</button>' : '') +
        '</div>' +
        '<dl class="dl">' +
          (kind === 'contact'
            ? field('회사·기관', esc(x.org)) + field('담당자', esc(x.name)) + field('문의 유형', esc(x.type))
            : field('이름·회사', esc(x.name)) + field('신청 구분', esc(x.kind)) + field('관심 분야', esc(x.field))) +
          field('연락처', esc(x.tel), true) +
          field('이메일', x.email ? '<a href="mailto:' + esc(x.email) + '">' + esc(x.email) + '</a>' : '') +
          (kind === 'join' && x.fileUrl && !hasFile ? field('첨부 파일', esc(x.fileUrl)) : '') +
          field('보낸 페이지', safeUrl(x.page) ? '<a href="' + esc(x.page) + '" target="_blank" rel="noopener">' + esc(x.page.replace(/^https?:\/\//, '')) + '</a>' : esc(x.page)) +
        '</dl>' +
        '<div class="msg">' + esc(x.message || '(내용 없음)') + '</div>' +
        '<form class="box" id="procForm"><h3>처리</h3>' +
          '<div class="seg" role="radiogroup" aria-label="상태">' + STATUSES.map(function (st, i) {
            return '<input type="radio" name="status" id="st' + i + '" value="' + st + '"' + (x.status === st ? ' checked' : '') + '><label for="st' + i + '">' + st + '</label>';
          }).join('') + '</div>' +
          '<div class="field" style="margin-top:16px"><label class="lbl" for="memo">담당자 메모</label><textarea class="in" id="memo" name="memo" maxlength="2000" placeholder="통화 내용, 다음 할 일, 견적 진행 상황">' + esc(x.memo) + '</textarea></div>' +
          '<div class="d-foot"><small>' + (x.by ? '최근 처리 ' + esc(x.by) + ' · <span class="mono">' + esc(short(x.at)) + '</span>' : '아직 처리 기록 없음') + '</small><button class="btn primary" type="submit">저장</button></div>' +
        '</form>' +
        '<section class="sec"><div class="sec-h"><h2>처리 이력</h2><p>' + hist.length + '건</p></div>' +
          (hist.length ? '<ul class="hist">' + hist.map(function (l) { return '<li><time>' + esc(short(l.at)) + '</time><span><b>' + esc(l.name) + '</b> · ' + esc(l.action) + (l.detail ? ' · ' + esc(l.detail) : '') + '</span></li>'; }).join('') + '</ul>' : '<p class="note">아직 처리 이력이 없습니다.</p>') +
        '</section>' +
      '</div>';
    if (keepScroll) panel.scrollTop = top;

    $('#procForm', panel).addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('button[type=submit]', e.target);
      var st = ($('input[name=status]:checked', e.target) || {}).value;
      var memo = $('#memo', e.target).value;
      if (st === x.status && memo === (x.memo || '')) { toast('바뀐 내용이 없습니다.'); return; }
      busy(btn, true);
      api('update', { tab: kind, id: x.id, status: st, memo: memo }).then(function (r) {
        replaceItem(kind, r.item);
        if (r.log) S.logs.unshift(r.log);
        counts();
        drawRows(kind);
        flashRow(x.id);
        openItem(kind, x.id, true);
        toast(r.log ? '저장했습니다. ' + r.log.detail : '바뀐 내용이 없습니다.');
      }).catch(fail).then(function () { busy(btn, false); });
    });
    var fb = $('[data-file]', panel);
    if (fb) fb.addEventListener('click', function () { openFile(x.id, fb); });
    if (drawer.hidden) showDrawer();
  }

  function replaceItem(kind, item) {
    var i = S[kind].findIndex(function (x) { return x.id === item.id; });
    if (i > -1) S[kind][i] = item;
  }

  function flashRow(id) {
    var tr = $('#ftbl tr[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!tr) return;
    tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash');
  }

  // 첨부 파일: Apps Script 가 드라이브에서 꺼내 준 내용을 브라우저에서 바로 엶. PDF·사진은 새 탭, 나머지는 내려받기
  function openFile(id, btn) {
    var win = null;
    try { win = window.open('', '_blank'); if (win) win.document.write('<p style="font:15px sans-serif;padding:24px">첨부 파일을 불러오는 중…</p>'); } catch (e) { win = null; }
    busy(btn, true);
    api('file', { id: id }).then(function (r) {
      var bin = atob(r.data), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var blob = new Blob([bytes], { type: r.type || 'application/octet-stream' });
      if (r.log) S.logs.unshift(r.log);
      if (/pdf|image\//.test(r.type) && win && !win.closed) {
        win.location.href = URL.createObjectURL(blob);
      } else {
        if (win && !win.closed) win.close();
        download(blob, r.name || '첨부파일');
      }
      toast('첨부 파일을 열었습니다. 작업 기록에 남았습니다.');
    }).catch(function (e) { if (win && !win.closed) win.close(); fail(e); }).then(function () { busy(btn, false); });
  }

  // ── 소식 ────────────────────────────────────────────────
  function renderNews(box) {
    box.innerHTML =
      '<div class="news-tools"><p class="note">맨 위부터 홈 첫 화면에 4개, 고객센터에 30개까지 나옵니다. 숨긴 소식은 홈페이지에 안 나옵니다. 저장하면 바로 반영됩니다.</p>' +
        '<button class="btn primary" type="button" id="newsAdd"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>새 소식 등록</button></div>' +
      '<ol class="news-list" id="newsList"></ol>';
    $('#newsAdd', box).addEventListener('click', function () { editNews(null); });
    $('#newsList', box).addEventListener('click', onNewsClick);
    $('#newsList', box).addEventListener('change', function (e) {
      var sw = e.target.closest('input[data-vis]');
      if (!sw) return;
      var it = newsAt(sw);
      newsOp('news.visible', it, { visible: sw.checked }, sw);
    });
    drawNews();
  }

  function newsAt(el) {
    var li = el.closest('li[data-row]');
    var row = Number(li.getAttribute('data-row'));
    return S.news.find(function (n) { return n.row === row; });
  }

  function drawNews(flashTitle) {
    var list = $('#newsList');
    if (!list) return;
    var shown = 0;
    list.innerHTML = S.news.length ? S.news.map(function (n, i) {
      var cut = n.visible && shown < 4; if (n.visible) shown++;
      var url = safeUrl(n.url);
      return '<li data-row="' + n.row + '" class="' + (n.visible ? '' : 'off') + (cut ? ' cut' : '') + '">' +
        '<span class="n-no">' + ('0' + (i + 1)).slice(-2) + '</span>' +
        '<div class="n-main"><b>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(n.title) + '</a>' : esc(n.title)) + (n.visible ? '' : '<span class="n-tag">숨김</span>') + '</b>' +
          '<span><time>' + esc(n.date) + '</time>' + esc(n.source || '') + (url ? '' : '<em style="font-style:normal">링크 없음</em>') + '</span></div>' +
        '<div class="n-acts">' +
          '<label class="sw"><input type="checkbox" data-vis' + (n.visible ? ' checked' : '') + ' aria-label="' + esc(n.title) + ' 공개"><i></i>공개</label>' +
          '<button class="btn icon" type="button" data-move="-1" aria-label="위로"' + (i === 0 ? ' disabled' : '') + '><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V5M5.5 9.5 10 5l4.5 4.5"/></svg></button>' +
          '<button class="btn icon" type="button" data-move="1" aria-label="아래로"' + (i === S.news.length - 1 ? ' disabled' : '') + '><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5.5 10.5 10 15l4.5-4.5"/></svg></button>' +
          '<button class="btn sm" type="button" data-edit>수정</button>' +
          '<button class="btn sm danger" type="button" data-del>삭제</button>' +
        '</div></li>';
    }).join('') : '<li><p class="empty">등록된 소식이 없습니다.</p></li>';
    if (flashTitle) {
      var t = S.news.find(function (n) { return n.title === flashTitle; });
      var li = t && $('li[data-row="' + t.row + '"]', list);
      if (li) { li.classList.add('flash'); }
    }
  }

  function onNewsClick(e) {
    var b = e.target.closest('button');
    if (!b) return;
    var it = newsAt(b);
    if (!it) return;
    if (b.hasAttribute('data-edit')) { editNews(it); return; }
    if (b.hasAttribute('data-move')) { newsOp('news.move', it, { dir: Number(b.getAttribute('data-move')) }, b, it.title); return; }
    if (b.hasAttribute('data-del')) {
      if (!b.classList.contains('arm')) {
        b.classList.add('arm'); b.textContent = '삭제 확인';
        setTimeout(function () { if (document.contains(b)) { b.classList.remove('arm'); b.textContent = '삭제'; } }, 3200);
        return;
      }
      newsOp('news.delete', it, {}, b);
    }
  }

  function newsOp(op, it, extra, btn, flashTitle) {
    busy(btn, true);
    return api(op, Object.assign({ row: it.row, sig: it.date + '|' + it.title }, extra)).then(function (r) {
      S.news = r.news;
      if (r.log) S.logs.unshift(r.log);
      drawNews(flashTitle);
      if (r.log) toast(r.log.action + ' · ' + r.log.detail);
      return r;
    }).catch(function (e) { busy(btn, false); drawNews(); fail(e); });
  }

  function editNews(it) {
    S.open = { kind: 'news' };
    var sources = [];
    S.news.forEach(function (n) { if (n.source && sources.indexOf(n.source) < 0) sources.push(n.source); });
    var d = it ? dotDate(it.date) : kstNow().slice(0, 10);
    panel.innerHTML =
      '<header class="d-head"><span class="mono">' + (it ? 'NEWS / EDIT' : 'NEWS / NEW') + '</span>' +
        '<button class="btn icon ghost" type="button" data-act="close" aria-label="닫기"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg></button></header>' +
      '<form class="d-body" id="newsForm" novalidate>' +
        '<h2 class="d-title" id="drawerTitle">' + (it ? '소식 수정' : '새 소식 등록') + '</h2>' +
        '<p class="d-sub">' + (it ? '저장하면 홈페이지 목록이 바로 바뀝니다.' : '새 소식은 맨 위에 들어갑니다. 순서는 목록에서 바꿀 수 있습니다.') + '</p>' +
        '<div class="field" style="margin-top:22px"><label class="lbl" for="nTitle">제목</label><input class="in" id="nTitle" name="title" maxlength="200" required value="' + esc(it ? it.title : '') + '"></div>' +
        '<div class="field"><label class="lbl" for="nDate">날짜</label><input class="in mono" id="nDate" name="date" type="date" value="' + esc(d) + '" style="max-width:200px"></div>' +
        '<div class="field"><label class="lbl" for="nSrc">출처</label><input class="in" id="nSrc" name="source" maxlength="80" list="nSrcList" placeholder="언론 보도, 보도자료, 공지" value="' + esc(it ? it.source : '') + '">' +
          '<datalist id="nSrcList">' + sources.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist></div>' +
        '<div class="field"><label class="lbl" for="nUrl">기사 링크</label><input class="in" id="nUrl" name="url" type="url" inputmode="url" placeholder="https://" value="' + esc(it ? it.url : '') + '"><p class="help">비워 두면 제목만 보이고 눌러도 이동하지 않습니다.</p></div>' +
        '<div class="field"><label class="sw"><input type="checkbox" name="visible"' + (!it || it.visible ? ' checked' : '') + '><i></i>홈페이지에 공개</label></div>' +
        '<div class="preview"><span class="lbl">홈페이지에 이렇게 보임</span><div class="preview-row" id="nPrev"></div></div>' +
      '</form>' +
      '<div class="d-actions"><button class="btn" type="button" data-act="close">취소</button><button class="btn primary" type="submit" form="newsForm">' + (it ? '수정 저장' : '등록') + '</button></div>';
    var form = $('#newsForm', panel);
    // form.title 은 폼 자체의 title 속성과 겹쳐서 칸을 id 로 잡음
    var F = { title: $('#nTitle', panel), date: $('#nDate', panel), source: $('#nSrc', panel), url: $('#nUrl', panel), visible: $('input[name=visible]', panel) };
    var prev = function () {
      var t = F.title.value.trim() || '제목', dd = F.date.value ? F.date.value.replace(/-/g, '.') : '', s = F.source.value.trim();
      $('#nPrev', panel).innerHTML = '<b>' + esc(t) + '</b><time>' + esc(dd) + '</time><span>' + esc(s) + (F.visible.checked ? '' : ' · 숨김 상태라 안 보임') + '</span>';
    };
    form.addEventListener('input', prev);
    prev();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('.d-actions .btn.primary', panel);
      var item = { title: F.title.value.trim(), date: F.date.value, source: F.source.value.trim(), url: F.url.value.trim(), visible: F.visible.checked };
      if (!item.title) { toast(ERR.notitle, true); F.title.focus(); return; }
      if (item.url && !safeUrl(item.url)) { toast(ERR.badurl, true); F.url.focus(); return; }
      busy(btn, true);
      var body = { item: item };
      if (it) { body.row = it.row; body.sig = it.date + '|' + it.title; }
      api('news.save', body).then(function (r) {
        S.news = r.news;
        if (r.log) S.logs.unshift(r.log);
        closeDrawer(true);
        drawNews(item.title);
        toast(it ? '소식을 수정했습니다.' : '소식을 맨 위에 등록했습니다.');
      }).catch(fail).then(function () { busy(btn, false); });
    });
    showDrawer();
    setTimeout(function () { F.title.focus(); }, 60);
  }

  // ── 작업 기록 ────────────────────────────────────────────
  var LOG_KINDS = [
    ['', '전체'], ['login', '로그인'], ['status', '문의·신청 처리'], ['file', '첨부 열람'], ['news', '소식'], ['settings', '설정']
  ];
  function logKind(a) {
    if (a === '로그인') return 'login';
    if (a === '문의 처리' || a === '신청 처리') return 'status';
    if (a === '첨부 열람') return 'file';
    if (/^소식/.test(a)) return 'news';
    return 'settings';
  }

  function renderLogs(box) {
    var f = S.f.logs;
    box.innerHTML =
      '<div class="log-tools"><div class="chips" role="group" aria-label="작업 종류" id="logChips">' +
        LOG_KINDS.map(function (k) { return '<button type="button" data-k="' + k[0] + '" aria-pressed="' + (f.k === k[0]) + '">' + k[1] + '</button>'; }).join('') +
      '</div><input class="in" type="search" id="logQ" placeholder="담당자 · 접수번호 · 내용" aria-label="작업 기록 검색" value="' + esc(f.q) + '"></div>' +
      '<div class="count" id="logCount"></div>' +
      '<div class="tbl-wrap"><table class="tbl logs"><thead><tr><th scope="col">시각</th><th scope="col">담당자</th><th scope="col">작업</th><th scope="col">대상</th><th scope="col">내용</th></tr></thead><tbody id="logRows"></tbody></table></div>';
    $$('#logChips button', box).forEach(function (b) {
      b.addEventListener('click', function () { f.k = b.getAttribute('data-k'); $$('#logChips button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawLogs(); });
    });
    $('#logQ', box).addEventListener('input', function (e) { f.q = e.target.value; drawLogs(); });
    drawLogs();
  }

  function drawLogs() {
    var f = S.f.logs, q = f.q.trim().toLowerCase();
    var rows = S.logs.filter(function (l) {
      if (f.k && logKind(l.action) !== f.k) return false;
      return !q || [l.name, l.email, l.target, l.detail, l.action].some(function (s) { return String(s || '').toLowerCase().indexOf(q) > -1; });
    });
    $('#logCount').innerHTML = '<span><b>' + rows.length + '</b>건</span><span>최근 300건 · 시트 \'작업 기록\' 탭에 전부 남음</span>';
    $('#logRows').innerHTML = rows.length ? rows.map(function (l) {
      var target = l.target;
      var link = /^C\d{6}-/.test(target) ? '#/contact/' : /^J\d{6}-/.test(target) ? '#/join/' : '';
      return '<tr><td class="c-ts">' + esc(short(l.at)) + '</td>' +
        '<td class="c-main"><b>' + esc(l.name) + '</b><span class="mono" style="font-size:11.5px">' + esc(l.email) + '</span></td>' +
        '<td><span class="act k-' + logKind(l.action) + '">' + esc(l.action) + '</span></td>' +
        '<td class="c-id">' + (link ? '<a href="' + link + encodeURIComponent(target) + '">' + esc(target) + '</a>' : esc(target || '—')) + '</td>' +
        '<td>' + esc(l.detail || '') + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="empty">해당하는 기록이 없습니다.</td></tr>';
  }

  // ── 설정 ────────────────────────────────────────────────
  function ytId(v) {
    var s = String(v || '').trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    var m = s.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/vi\/)([\w-]{11})/);
    return m ? m[1] : '';
  }

  function renderSettings(box) {
    var st = S.settings || { notify: [], notifyDefault: '', playlists: [] };
    var rt = S.retention || { tabs: [] };
    box.innerHTML =
      '<div class="cards">' +
        '<section class="card"><div class="card-h"><h2>새 문의 알림 메일</h2><span class="tag">NOTIFY</span></div>' +
          '<form id="notifyForm"><div class="card-b">' +
            '<label class="lbl" for="notifyIn">받을 주소</label><input class="in mono" id="notifyIn" value="' + esc(st.notify.join(', ')) + '" placeholder="' + esc(st.notifyDefault) + '">' +
            '<p class="help">쉼표로 나눠 최대 5개. 비워 두면 ' + esc(st.notifyDefault) + ' 로 받습니다. 문의·입사 지원이 들어올 때마다 이 주소로 메일이 갑니다.</p>' +
            '<div class="mails">' + st.notify.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') + '</div>' +
          '</div><div class="card-f"><button class="btn primary" type="submit">저장</button></div></form></section>' +

        '<section class="card"><div class="card-h"><h2>개인정보 보관 현황</h2><span class="tag">RETENTION</span></div><div class="card-b">' +
          '<table class="keep"><thead><tr><th scope="col">구분</th><th scope="col">보관 중</th><th scope="col">' + (rt.soonDays || 30) + '일 안 삭제 예정</th><th scope="col">가장 오래된 접수</th></tr></thead><tbody>' +
            rt.tabs.map(function (t) {
              return '<tr><th scope="row" style="font-size:14px;color:var(--ink)">' + esc(t.tab) + '</th><td class="tnum">' + t.total + '건</td><td><span class="soon' + (t.soon ? ' has' : '') + '">' + t.soon + '건</span></td><td class="tnum">' + esc(day(t.oldest) || '—') + '</td></tr>';
            }).join('') +
          '</tbody></table>' +
          '<p class="help" style="margin-top:12px">접수일부터 1년이 지나면 ' + esc(rt.runs || '매일 03:00') + ' 에 시트의 줄과 첨부 파일이 자동으로 지워집니다. 알림 메일은 메일함에서 따로 지워야 합니다.</p>' +
        '</div></section>' +

        '<section class="card wide"><div class="card-h"><h2>사용법 영상 재생목록</h2><span class="tag">PLAYLIST</span></div>' +
          '<form id="plForm"><div class="card-b">' +
            st.playlists.map(function (p, i) {
              var id = ytId(p.thumb);
              return '<div class="pl"><div class="pl-thumb" data-thumb="' + i + '"' + (id ? ' style="background-image:url(https://i.ytimg.com/vi/' + esc(id) + '/mqdefault.jpg)"' : '') + '></div>' +
                '<div><h3>' + esc(p.title) + '</h3><div class="row2">' +
                  '<div><label class="lbl" for="plu' + i + '">재생목록 링크</label><input class="in mono" id="plu' + i + '" data-i="' + i + '" data-k="url" value="' + esc(p.url) + '" placeholder="https://www.youtube.com/playlist?list=…"></div>' +
                  '<div><label class="lbl" for="plt' + i + '">썸네일로 쓸 영상</label><input class="in mono" id="plt' + i + '" data-i="' + i + '" data-k="thumb" value="' + esc(p.thumb) + '" placeholder="영상 주소나 ID"></div>' +
                '</div></div></div>';
            }).join('') +
            '<p class="help">고객센터 \'Guide Videos\' 칸 순서대로입니다. 썸네일은 영상 주소를 넣으면 그 영상의 대표 이미지를 씁니다.</p>' +
          '</div><div class="card-f"><button class="btn primary" type="submit">재생목록 저장</button></div></form></section>' +

        '<section class="card"><div class="card-h"><h2>관리자 계정</h2><span class="tag">ACCESS</span></div><div class="card-b">' +
          '<div class="acct"><span class="ava">C2</span><div><b>' + esc(S.me ? S.me.email : '') + '</b><span>구글 로그인 허용 계정 · 이 계정만 들어올 수 있습니다</span></div></div>' +
          '<p class="help" style="margin-top:14px">허용 계정을 바꾸려면 Apps Script 의 ADMINS 값을 고치고 새 버전으로 배포해야 합니다.</p>' +
        '</div></section>' +

        '<section class="card"><div class="card-h"><h2>지금 담당자</h2><span class="tag">OPERATOR</span></div>' +
          '<form id="actorForm"><div class="card-b">' +
            '<label class="lbl" for="actorIn">작업 기록에 남는 이름</label><input class="in" id="actorIn" maxlength="20" value="' + esc(actor()) + '">' +
            '<p class="help">같은 계정을 여럿이 쓰므로, 이 이름이 상태 변경·메모·소식 수정 기록에 계정과 같이 남습니다. 이 브라우저에만 저장됩니다.</p>' +
          '</div><div class="card-f"><button class="btn" type="submit">이름 바꾸기</button></div></form></section>' +
      '</div>';

    $('#notifyForm', box).addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('button[type=submit]', e.target);
      var v = $('#notifyIn', box).value;
      var list = v.split(/[,\s]+/).filter(Boolean);
      if (list.length > 5 || list.some(function (m) { return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m); })) { toast(ERR.bademail, true); return; }
      busy(btn, true);
      api('settings.save', { notify: list.join(',') }).then(function (r) {
        S.settings = r.settings;
        (r.logs || []).forEach(function (l) { S.logs.unshift(l); });
        renderView('settings');
        toast(r.logs && r.logs.length ? '알림 메일 주소를 바꿨습니다.' : '바뀐 내용이 없습니다.');
      }).catch(fail).then(function () { busy(btn, false); });
    });

    $('#plForm', box).addEventListener('input', function (e) {
      var inp = e.target;
      if (inp.getAttribute('data-k') !== 'thumb') return;
      var id = ytId(inp.value), th = $('[data-thumb="' + inp.getAttribute('data-i') + '"]', box);
      th.style.backgroundImage = id ? 'url(https://i.ytimg.com/vi/' + id + '/mqdefault.jpg)' : '';
    });
    $('#plForm', box).addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('button[type=submit]', e.target);
      var pls = st.playlists.map(function (p, i) {
        return { title: p.title, url: $('#plu' + i, box).value.trim(), thumb: ytId($('#plt' + i, box).value) };
      });
      if (pls.some(function (p) { return p.url && !/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(p.url); })) { toast(ERR.badurl, true); return; }
      busy(btn, true);
      api('settings.save', { playlists: pls }).then(function (r) {
        S.settings = r.settings;
        (r.logs || []).forEach(function (l) { S.logs.unshift(l); });
        renderView('settings');
        toast(r.logs && r.logs.length ? '재생목록을 바꿨습니다. ' + r.logs[0].detail : '바뀐 내용이 없습니다.');
      }).catch(fail).then(function () { busy(btn, false); });
    });

    $('#actorForm', box).addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('#actorIn', box).value.replace(/[<>]/g, '').trim();
      if (!v) { toast('담당자 이름을 적어 주세요.', true); return; }
      setActor(v);
      if (S.me) S.me.name = v;
      $('#whoName').textContent = v;
      toast('이제부터 ' + v + ' 이름으로 기록됩니다.');
    });
  }

  // ── 알림 ────────────────────────────────────────────────
  var toastEl = $('#toast'), toastTimer = 0;
  function toast(text, bad) {
    toastEl.textContent = text;
    toastEl.classList.toggle('bad', !!bad);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, bad ? 5200 : 3200);
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]');
    if (!a) return;
    var act = a.getAttribute('data-act');
    if (act === 'logout') logout();
    if (act === 'reload') reload();
  });

  // ── 데모: 서버 없이 똑같이 돌아가는 예시 데이터 ───────────────
  var demoApi = (function () {
    if (!DEMO) return null;
    var who = function () { return { email: 'camver2020@gmail.com', name: actor() || '담당자' }; };
    var mk = function (prefix, mins) { var t = kstNow(mins); var abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', r = ''; for (var i = 0; i < 4; i++) r += abc.charAt(Math.floor(Math.random() * abc.length)); return { id: prefix + t.slice(2, 10).replace(/-/g, '') + '-' + r, ts: t }; };
    var c = function (mins, type, org, name, tel, email, message, status, memo, by, byMins) {
      var b = mk('C', mins);
      return { id: b.id, ts: b.ts, type: type, org: org, name: name, tel: tel, email: email, message: message, page: 'https://www.camver.ai.kr/cs.html', status: status, memo: memo || '', by: by || '', at: by ? kstNow(byMins) : '' };
    };
    var jn = function (mins, kind, name, field, tel, email, message, file, status, memo, by, byMins) {
      var b = mk('J', mins);
      return { id: b.id, ts: b.ts, kind: kind, name: name, field: field, tel: tel, email: email, message: message, fileUrl: file ? 'https://drive.google.com/file/d/1DemoAttachmentFileId000000000/view' : '', page: 'https://www.camver.ai.kr/cs.html', status: status, memo: memo || '', by: by || '', at: by ? kstNow(byMins) : '' };
    };
    var H = 60, D = 1440;
    var DB = {
      contact: [
        c(38, 'Fleet AI OS 도입', '한빛물류', '정민수', '010-2481-7735', 'ms.jung@hanbit-logis.example', '전기 화물차 1톤 24대를 운영하고 있습니다.\n배터리 이상 징후 알림이 실시간으로 오는지, 지금 쓰는 차량 단말과 같이 쓸 수 있는지 궁금합니다.', '접수'),
        c(5 * H, '이동형 안전 쉼터', '서해건설 안전팀', '오세린', '010-7710-2093', '', '12월부터 3개월 동안 현장 두 곳에 쉼터 설치를 검토 중입니다. 견적과 설치까지 걸리는 기간을 알려 주세요.', '접수'),
        c(D + 3 * H, '휴양소·위탁 운영', '대한정밀 총무팀', '김도현', '02-3456-7812', 'dh.kim@daehan-precision.example', '임직원 휴양소용 캠핑카 위탁 운영을 알아보고 있습니다. 강원·경북 두 지역, 성수기 기준 10대 정도입니다.', '처리중', '11/20 방문 미팅 잡음. 운영 제안서 먼저 메일로 보냄', '맹현호', D),
        c(2 * D, '차량 제작·개조', '그린모빌', '이하준', '010-3390-1288', 'hajun@greenmobil.example', 'PV5 기반 이동 사무실 개조 가능한지 문의드립니다. 6대 예정.', '처리중', '도면 요청함. 회신 기다리는 중', '맹현호', 2 * D - 4 * H),
        c(3 * D + 2 * H, '기타', '', '한지우', '010-6020-4471', 'jiwoo.h@mail.example', '홈페이지에 있는 캠핑카 사용법 영상 말고 PDF 매뉴얼도 받을 수 있을까요?', '접수'),
        c(6 * D, 'Fleet AI OS 도입', '다온렌터카', '최유진', '031-778-2040', 'yj.choi@daon-rent.example', '렌터카 80대에 관제 도입 검토 중입니다. 데모 일정 잡고 싶습니다.', '완료', '11/10 데모 진행. 견적서 발송 완료', '김주성', 4 * D),
        c(9 * D, '스테이션 개설', '', '박서연', '010-8874-3310', 'seoyeon.park@mail.example', '양평에 부지가 있는데 스테이션 개설 조건이 궁금합니다.', '완료', '전화로 조건 안내함', '김주성', 8 * D),
        c(18 * D, '이동형 안전 쉼터', '하나플랜트', '윤상철', '010-2201-5584', 'sc.yoon@hana-plant.example', '여름철 폭염 대비 쉼터 렌털 가능한지요?', '처리중', '내년 5월 재연락 요청', '맹현호', 15 * D),
        c(342 * D, '휴양소·위탁 운영', '세림전자', '문가영', '02-6677-1020', 'gy.moon@serim.example', '직원 복지용 캠핑카 운영 문의', '완료', '계약 불발', '김주성', 330 * D)
      ],
      join: [
        jn(3 * H, '입사 지원', '윤태호', 'IT 기술', '010-5150-2297', 'taeho.yoon@mail.example', '백엔드 개발 5년차입니다. 차량 관제 데이터 처리 경험이 있습니다.', true, '접수'),
        jn(D + 6 * H, '파트너 제휴', '주식회사 오름캠핑', '캠핑장', '033-251-7781', 'biz@oreum-camp.example', '강원 홍천 캠핑장 3곳을 운영합니다. 스테이션 제휴 제안서 첨부합니다.', true, '처리중', '제안서 검토 중. 다음 주 회신', '맹현호', D),
        jn(4 * D, '파트너 제휴', '바다카라반', '카라반', '010-9980-1123', 'sea@badacaravan.example', '카라반 위탁 정비 제휴 문의드립니다.', true, '접수'),
        jn(12 * D, '입사 지원', '서민아', '재무회계', '010-4417-6633', 'mina.seo@mail.example', '회계 실무 3년, 정부지원사업 정산 경험 있습니다.', false, '완료', '면접 진행 후 결과 안내함', '김주성', 9 * D)
      ],
      news: [
        ['2026.09.04', "캠버, 전기차 배터리 위험을 미리 감지하는 예측 안전 플랫폼 'Fleet AI OS' 출시", '보도자료 · 미국 6개 매체', 'https://www.abc12.com/online_features/press_releases/camver-launches-fleet-ai-os-a-predictive-safety-platform-that-detects-ev-battery-hazards-before/article_dd0b2ad6-c917-5c4a-91ff-1f5e2d6b97a5.html', true],
        ['2025.06.08', '연 1000만원↑…"캠핑카, 이제는 수익형 자산"', '언론 보도', '', true],
        ['2025.05.30', '주차부터 충전까지 무선으로…정부, 66개 샌드박스 과제 심의', '언론 보도', '', true],
        ['2025.05.30', '자율주행 전기차 충전 무인화 시동…규제샌드박스 과제 66개 승인', '언론 보도', '', true],
        ['2025.05.11', "스마트 캠핑카 플랫폼 '캠버' 글로벌 진출 '신호탄'", '언론 보도', '', true],
        ['2025.04.19', '(주)후경파트너와 (주)캠버, 업무협약 통해 지역 관광 다양성 강화 및 경제 활성화', '언론 보도', '', true],
        ['2024.03.20', '캠핑장 찾기 문제 없어요…정밀 주소 기반 캠핑여행플랫폼 개발', '언론 보도', '', false]
      ].map(function (r) { return { date: r[0], title: r[1], source: r[2], url: r[3], visible: r[4] }; }),
      logs: [],
      notify: [],
      playlists: [
        ['현대자동차 스타리아 캠핑카', 'https://www.youtube.com/playlist?list=PLmKu3aHEivj75ksBEdG01Y_6DP_Vs3rv0', 'nXkg7gmPuVM'],
        ['현대엔지니어링 스타리아 캠핑카', 'https://www.youtube.com/playlist?list=PLmKu3aHEivj5WGW1HWsqMv8snFJXzC29C', 'ck01uUKowlk'],
        ['포레스트 캠핑카', 'https://www.youtube.com/playlist?list=PLmKu3aHEivj5Ii1EkORJMLrvNuekNHWIo', 'IGd3-BVDTHw'],
        ['스타렉스 캠핑카', 'https://www.youtube.com/playlist?list=PLmKu3aHEivj4k1Vk4fthbSHkxpkxINZTy', 'mZ7SuGdvFYI'],
        ['레이 캠핑카', 'https://www.youtube.com/playlist?list=PLmKu3aHEivj59NUVFPBDLFNn6-Z_5oIF0', 'OpkNIpBJ6iw']
      ].map(function (r) { return { title: r[0], url: r[1], thumb: r[2] }; })
    };
    // 예시 작업 기록
    var L = function (mins, name, action, target, detail) { return { at: kstNow(mins), email: 'camver2020@gmail.com', name: name, action: action, target: target || '', detail: detail || '' }; };
    DB.logs = [
      L(D, '맹현호', '문의 처리', DB.contact[2].id, '상태 접수 → 처리중, 메모 작성'),
      L(D, '맹현호', '신청 처리', DB.join[1].id, '상태 접수 → 처리중, 메모 작성'),
      L(D + 10, '맹현호', '첨부 열람', DB.join[1].id, '첨부 파일 열람'),
      L(D + 30, '맹현호', '로그인'),
      L(2 * D - 4 * H, '맹현호', '문의 처리', DB.contact[3].id, '상태 접수 → 처리중, 메모 작성'),
      L(3 * D, '김주성', '소식 숨김', '', DB.news[6].title),
      L(4 * D, '김주성', '문의 처리', DB.contact[5].id, '상태 처리중 → 완료, 메모 수정'),
      L(4 * D + 20, '김주성', '로그인'),
      L(8 * D, '김주성', '문의 처리', DB.contact[6].id, '상태 접수 → 완료, 메모 작성'),
      L(9 * D, '김주성', '신청 처리', DB.join[3].id, '상태 처리중 → 완료, 메모 작성'),
      L(15 * D, '맹현호', '문의 처리', DB.contact[7].id, '상태 접수 → 처리중, 메모 작성')
    ];
    var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
    var newsRows = function () { return DB.news.map(function (n, i) { return Object.assign({ row: i + 2 }, n); }); };
    var settings = function () { return { notify: DB.notify.length ? DB.notify.slice() : ['camver2020@gmail.com'], notifyDefault: 'camver2020@gmail.com', playlists: clone(DB.playlists) }; };
    var retention = function () {
      var lim = Date.now() - 335 * 86400000;
      return { keepDays: 365, soonDays: 30, runs: '매일 03:00', tabs: [['contact', '도입·제휴 문의'], ['join', '입사 지원·파트너 제휴']].map(function (t) {
        var list = DB[t[0]], oldest = list.reduce(function (a, x) { return !a || x.ts < a ? x.ts : a; }, '');
        return { kind: t[0], tab: t[1], total: list.length, soon: list.filter(function (x) { var d = toDate(x.ts); return d && d.getTime() < lim; }).length, oldest: oldest };
      }) };
    };
    var log = function (action, target, detail) { var w = who(); var e = { at: kstNow(), email: w.email, name: w.name, action: action, target: target || '', detail: detail || '' }; DB.logs.unshift(e); return clone(e); };
    var pdf = (function () {
      var body = 'BT /F1 22 Tf 72 760 Td (CAMVER demo attachment) Tj /F1 12 Tf 0 -34 Td (Sample file for the homepage admin demo.) Tj ET';
      var s = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ' + body.length + '>>stream\n' + body + '\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
      return btoa(s);
    })();

    function run(op, b) {
      switch (op) {
        case 'login':
          log('로그인');
          // falls through
        case 'load':
          return { ok: true, me: who(), contact: clone(DB.contact), join: clone(DB.join), news: newsRows(), logs: clone(DB.logs.slice(0, 300)), settings: settings(), retention: retention(), statuses: STATUSES, now: kstNow() };
        case 'update': {
          var list = DB[b.tab];
          if (!list) throw apiErr('bad');
          var x = list.find(function (i) { return i.id === b.id; });
          if (!x) throw apiErr('notfound');
          var ch = [];
          if (b.status != null) { if (STATUSES.indexOf(b.status) < 0) throw apiErr('bad'); if (b.status !== x.status) { ch.push('상태 ' + x.status + ' → ' + b.status); x.status = b.status; } }
          if (b.memo != null) { var m = String(b.memo).slice(0, 2000); if (m !== x.memo) { ch.push(x.memo ? '메모 수정' : '메모 작성'); x.memo = m; } }
          var e = null;
          if (ch.length) { x.by = who().name; x.at = kstNow(); e = log(b.tab === 'join' ? '신청 처리' : '문의 처리', x.id, ch.join(', ')); }
          return { ok: true, item: clone(x), log: e };
        }
        case 'file': {
          var j = DB.join.find(function (i) { return i.id === b.id; });
          if (!j) throw apiErr('notfound');
          if (!j.fileUrl) throw apiErr('nofile');
          return { ok: true, name: j.name + '_첨부.pdf', type: 'application/pdf', data: pdf, log: log('첨부 열람', j.id, '첨부 파일 열람') };
        }
        case 'news.save': case 'news.move': case 'news.visible': case 'news.delete': {
          var at = b.row ? b.row - 2 : -1;
          var cur = at >= 0 ? DB.news[at] : null;
          if (op !== 'news.save' || b.row) { if (!cur || cur.date + '|' + cur.title !== b.sig) throw apiErr('stale'); }
          var lg = null;
          if (op === 'news.save') {
            var it = b.item || {};
            var title = String(it.title || '').trim();
            if (!title) throw apiErr('notitle');
            if (it.url && !/^https?:\/\//i.test(it.url)) throw apiErr('badurl');
            var d = (String(it.date || '').match(/^(\d{4})[.\-](\d{2})[.\-](\d{2})/) || []).slice(1).join('.') || kstNow().slice(0, 10).replace(/-/g, '.');
            var n = { date: d, title: title, source: String(it.source || '').trim(), url: String(it.url || '').trim(), visible: it.visible !== false };
            if (cur) { DB.news[at] = n; lg = log('소식 수정', '', title); } else { DB.news.unshift(n); lg = log('소식 등록', '', title); }
          } else if (op === 'news.move') {
            var to = at + (b.dir < 0 ? -1 : 1);
            if (to >= 0 && to < DB.news.length) { DB.news[at] = DB.news[to]; DB.news[to] = cur; lg = log('소식 순서 변경', '', cur.title + ' (' + (at + 1) + ' → ' + (to + 1) + '번째)'); }
          } else if (op === 'news.visible') {
            cur.visible = !!b.visible; lg = log(cur.visible ? '소식 공개' : '소식 숨김', '', cur.title);
          } else {
            DB.news.splice(at, 1); lg = log('소식 삭제', '', cur.title);
          }
          return { ok: true, news: newsRows(), log: lg };
        }
        case 'settings.save': {
          var done = [];
          if (b.notify != null) {
            var ls = String(b.notify).split(/[,\s]+/).filter(Boolean);
            if (ls.length > 5 || ls.some(function (s) { return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); })) throw apiErr('bademail');
            var before = settings().notify.join(', ');
            DB.notify = ls;
            var after = settings().notify.join(', ');
            if (before !== after) done.push(log('알림 메일 변경', '', after));
          }
          if (Array.isArray(b.playlists)) {
            var changed = [];
            DB.playlists.forEach(function (p, i) {
              var nx = b.playlists[i] || p;
              if (nx.url && !/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(nx.url)) throw apiErr('badurl');
              var th = ytId(nx.thumb);
              if (nx.url !== p.url || th !== p.thumb) { changed.push(p.title); p.url = nx.url; p.thumb = th; }
            });
            if (changed.length) done.push(log('재생목록 링크 변경', '', changed.join(', ')));
          }
          return { ok: true, settings: settings(), logs: done };
        }
      }
      throw apiErr('bad');
    }

    return function (op, b) {
      return new Promise(function (res, rej) {
        setTimeout(function () { try { res(run(op, clone(b))); } catch (e) { rej(e); } }, 320 + Math.random() * 280);
      });
    };
  })();

  boot();
})();
