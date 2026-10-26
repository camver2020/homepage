(function () {
  /* 페이지 안 이동 막대: 지금 보고 있는 구역 표시 */
  var nav = document.querySelector('.localnav');
  if (!nav || !('IntersectionObserver' in window)) return;
  var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
  var map = {};
  links.forEach(function (a) { var el = document.getElementById(a.getAttribute('href').slice(1)); if (el) map[el.id] = a; });
  var visible = {};
  function mark() {
    var best = null, top = Infinity;
    Object.keys(visible).forEach(function (id) { if (visible[id] < top) { top = visible[id]; best = id; } });
    if (!best) return;
    links.forEach(function (a) { var on = a === map[best]; a.classList.toggle('is-on', on); if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    var on = map[best];
    if (on && on.parentNode.scrollWidth > on.parentNode.clientWidth) {
      on.parentNode.scrollTo({ left: on.offsetLeft - 20, behavior: 'smooth' });
    }
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) visible[e.target.id] = e.boundingClientRect.top; else delete visible[e.target.id];
    });
    mark();
  }, { rootMargin: '-30% 0px -60% 0px' });
  Object.keys(map).forEach(function (id) { io.observe(document.getElementById(id)); });
  if (links[0]) links[0].classList.add('is-on');
})();

(function () {
  /* 폼: 칸을 벗어날 때 확인하고, 오류 문구를 칸과 연결(aria-describedby), 보내는 중 → 완료/실패 상태.
     window.CAMVER_FORM_ENDPOINT(src/config.json 의 form_endpoint)에 Apps Script 웹앱 주소가 있으면 실제로 보냄.
     Apps Script 가 읽을 수 있게 x-www-form-urlencoded 로 보내고, 첨부 파일은 file_name·file_type·file_data(base64)로 나눠 보냄.
     주소가 없으면(시안) 전송 흉내만 내고 완료 문구를 보여 줌. */
  var uid = 0;
  function toParams(form) {
    var fd = new FormData(form), p = new URLSearchParams(), files = [];
    fd.forEach(function (v, k) { if (typeof v === 'string') p.append(k, v); else if (v && v.size) files.push([k, v]); });
    p.append('form', form.getAttribute('data-form') || 'contact');
    p.append('page', location.href);
    return Promise.all(files.map(function (kv) {
      return new Promise(function (res, rej) {
        var r = new FileReader();
        r.onload = function () { var s = String(r.result); p.append(kv[0] + '_name', kv[1].name); p.append(kv[0] + '_type', kv[1].type || ''); p.append(kv[0] + '_data', s.slice(s.indexOf(',') + 1)); res(); };
        r.onerror = rej;
        r.readAsDataURL(kv[1]);
      });
    })).then(function () { return p; });
  }
  Array.prototype.slice.call(document.querySelectorAll('form.js-form')).forEach(function (form) {
    var done = form.querySelector('.done');
    var fail = form.querySelector('.fail');
    if (!fail) {
      fail = document.createElement('div');
      fail.className = 'fail'; fail.setAttribute('role', 'alert');
      fail.innerHTML = '<strong>보내지 못했습니다.</strong>잠시 후 다시 보내 주시거나 02-576-6776으로 전화 주세요.';
      form.appendChild(fail);
    }
    var submit = form.querySelector('[type=submit]');
    var label = submit ? submit.textContent : '';
    var inputs = Array.prototype.slice.call(form.querySelectorAll('input[required], textarea[required], select[required], input[type=email], input[type=file][data-max-mb]'));

    inputs.forEach(function (i) {
      var f = i.closest('.field'); var err = f && f.querySelector('.err');
      if (err) {
        if (!err.id) err.id = 'err-' + (++uid);
        var d = i.getAttribute('aria-describedby');
        if (!d || d.indexOf(err.id) < 0) i.setAttribute('aria-describedby', ((d ? d + ' ' : '') + err.id));
      }
    });
    function check(input) {
      var f = input.closest('.field');
      if (input.type === 'file' && input.getAttribute('data-max-mb')) {
        var file = input.files && input.files[0];
        input.setCustomValidity(file && file.size > Number(input.getAttribute('data-max-mb')) * 1048576 ? '파일이 너무 큽니다' : '');
      }
      var bad = !input.checkValidity();
      if (bad) { f.setAttribute('data-invalid', ''); input.setAttribute('aria-invalid', 'true'); }
      else { f.removeAttribute('data-invalid'); input.removeAttribute('aria-invalid'); }
      return !bad;
    }
    function recheck(e) {
      var f = e.target.closest && e.target.closest('.field');
      if (f && f.hasAttribute('data-invalid')) check(e.target);
    }
    form.addEventListener('input', recheck);
    form.addEventListener('change', function (e) { if (e.target.type === 'file') check(e.target); else recheck(e); });
    /* 칸에서 나갈 때 확인: 뭔가 적었다가 틀린 경우에만 (빈칸은 보낼 때 확인) */
    form.addEventListener('focusout', function (e) {
      var t = e.target;
      if (inputs.indexOf(t) < 0 || t.type === 'radio' || t.type === 'checkbox') return;
      if (t.value) check(t);
    });
    function busy(on) {
      if (!submit) return;
      submit.classList.toggle('is-busy', on);
      submit.setAttribute('aria-busy', on ? 'true' : 'false');
      submit.disabled = on;
      submit.textContent = on ? '보내는 중…' : label;
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true, first = null;
      inputs.forEach(function (i) { if (!check(i)) { ok = false; if (!first) first = i; } });
      done && done.classList.remove('show'); fail.classList.remove('show');
      if (!ok) { first.focus(); return; }
      var url = form.getAttribute('data-endpoint') || window.CAMVER_FORM_ENDPOINT;
      busy(true);
      var finish = function (good) {
        busy(false);
        if (good) { form.reset(); done && done.classList.add('show'); done && done.focus && done.setAttribute('tabindex', '-1'); done && done.focus(); }
        else { fail.classList.add('show'); }
      };
      if (!url || !window.fetch) { setTimeout(function () { finish(true); }, 700); return; }
      var ctrl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 40000);
      toParams(form)
        .then(function (body) { return fetch(url, { method: 'POST', body: body, signal: ctrl ? ctrl.signal : undefined }); })
        .then(function (r) { return r.json(); })
        .then(function (j) { clearTimeout(timer); finish(!!(j && j.ok)); })
        .catch(function () { clearTimeout(timer); finish(false); });
    });
  });
})();

(function () {
  /* 소식 시트 연동: window.CAMVER_NEWS_CSV(src/config.json 의 news_csv)에 구글 시트 CSV 주소가 있으면
     열 순서(날짜, 제목, 출처, 링크)대로 목록을 다시 그림. 시트에 적은 순서 그대로, data-limit 만큼만 보여줌.
     시트는 '링크가 있는 모든 사용자 - 뷰어'로 공유돼 있어야 읽힘. 못 읽으면 페이지에 적힌 기본 목록이 그대로 남음. */
  var url = window.CAMVER_NEWS_CSV;
  var list = document.getElementById('newsList');
  if (!url || !list || !window.fetch) return;
  var limit = Number(list.getAttribute('data-limit')) || 50;
  fetch(url).then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (csv) {
    if (/^\s*</.test(csv)) return; /* 공유 안 된 시트면 CSV 대신 로그인 화면(HTML)이 옴 */
    var rows = csv.trim().split(/\r?\n/).slice(1).map(function (line) {
      var out = [], cur = '', q = false;
      for (var i = 0; i < line.length; i++) {
        var c = line[i];
        if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (c === ',' && !q) { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      var d = (out[0] || '').trim().match(/^(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
      out[0] = d ? d[1] + '.' + ('0' + d[2]).slice(-2) + '.' + ('0' + d[3]).slice(-2) : (out[0] || '').trim();
      out[1] = (out[1] || '').trim(); out[3] = (out[3] || '').trim();
      if (out[3] && !/^https?:\/\//i.test(out[3])) out[3] = '';
      return out;
    }).filter(function (r) { return r[0] && r[1]; }).slice(0, limit);
    if (!rows.length) return;
    list.textContent = '';
    rows.forEach(function (r) {
      var li = document.createElement('li');
      var el = document.createElement(r[3] ? 'a' : 'div');
      if (r[3]) { el.href = r[3]; el.target = '_blank'; el.rel = 'noopener'; } else el.className = 'row';
      var h = document.createElement('span'); h.className = 'news-title'; h.textContent = r[1];
      var t = document.createElement('time'); t.textContent = r[0]; if (/^\d{4}\.\d{2}\.\d{2}$/.test(r[0])) t.setAttribute('datetime', r[0].replace(/\./g, '-'));
      var s = document.createElement('span'); s.className = 'news-src'; s.textContent = r[2] || '';
      el.append(h, t, s); li.append(el); list.append(li);
    });
  }).catch(function () {});
})();

(function () {
  /* 움직임: 스크롤 등장(마스크·슬라이드·페이드), 목록 순차 등장, 숫자 카운트업, 큰 사진 패럴랙스.
     지금 화면 밖에 있는 요소만 숨겼다가 들어올 때 보여준다. 움직임 줄이기 설정이면 아무것도 안 함 */
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;
  var main = document.getElementById('main');
  if (!main) return;
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var vh = window.innerHeight || 800;
  var SKIP = '.mv, .subhero, .localnav, .marquee';

  var vw = window.innerWidth || 1200;
  /* 아래쪽 화면 밖만 대상. 가로로 넘기는 목록에서 옆으로 빠져 있는 칸은 건드리지 않음 */
  function below(el) { var r = el.getBoundingClientRect(); return r.height > 0 && r.top > vh * 0.9 && r.left < vw && r.right > 0; }
  function inMarked(el) { for (var p = el.parentElement; p && p !== main; p = p.parentElement) if (p.classList.contains('rv')) return true; return false; }
  function mark(el, kind, force) {
    if (el.classList.contains('rv') || el.closest(SKIP) || !below(el)) return;
    if (!force && inMarked(el)) return;
    el.classList.add('rv', 'rv-' + kind, 'rv-no');
  }

  /* 1. 사진과 글이 나란한 블록: 사진은 아래에서 열리고, 글은 자기 쪽에서 밀려 들어옴 */
  $$('.split, .sol-split').forEach(function (s) {
    var photo = s.querySelector(':scope > .photo');
    var text = s.querySelector(':scope > .split-text, :scope > .sol-text');
    if (photo) mark(photo, 'wipe');
    if (text) {
      var fromLeft = photo ? text.getBoundingClientRect().left < photo.getBoundingClientRect().left : false;
      mark(text, fromLeft ? 'l' : 'r');
    }
  });
  $$('.about > .photo').forEach(function (p) { mark(p, 'wipe-x'); });
  $$('.about-text').forEach(function (t) { mark(t, 'r'); });

  /* 2. 목록은 하나씩 차례로 */
  $$('.grid-3 > *, .grid-4 > *, .svc > *, .cols > li, .figs > *, .thumbs > li, .logos > li, .timeline > .year, .steps > li, ' +
     '.stations > li, .models > div, .ptypes > li, .news-list > li, .flow > li, .ways > div').forEach(function (el) { mark(el, 'up'); });

  /* 3. 제목 묶음과 나머지 블록 */
  $$('.sec-head, .ttl, .sub-h').forEach(function (el) { mark(el, 'up'); });
  $$('main .wrap > *').forEach(function (el) {
    if (!el.querySelector('.rv')) { mark(el, 'up'); return; }
    $$(':scope > *', el).forEach(function (c) { if (!c.querySelector('.rv')) mark(c, 'up'); });
  });

  /* 4. 영문 타이틀은 바깥 블록과 별개로 마스크 등장 */
  $$('main h2.en').forEach(function (h) { mark(h, 'title', true); });

  /* 숨김 상태는 전환 없이 바로 적용하고, 그다음 프레임부터 전환을 켬 */
  void main.offsetHeight;
  requestAnimationFrame(function () { $$('.rv-no').forEach(function (el) { el.classList.remove('rv-no'); }); });

  var io = new IntersectionObserver(function (entries) {
    var batch = entries.filter(function (e) { return e.isIntersecting; }).map(function (e) { return e.target; });
    batch.sort(function (a, b) { return a.compareDocumentPosition(b) & 4 ? -1 : 1; });
    batch.forEach(function (el, i) {
      el.style.setProperty('--i', Math.min(i, 6));
      el.classList.add('in');
      io.unobserve(el);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
  $$('.rv').forEach(function (el) { io.observe(el); });
  window.addEventListener('beforeprint', function () { $$('.rv').forEach(function (el) { el.classList.add('in'); }); });

  /* 숫자 카운트업: 0에서 실제 값까지, 끝은 원래 글자 그대로 */
  function countUp(el) {
    var txt = el.textContent;
    var m = txt.match(/^(\D*?)(\d[\d,]*(?:\.\d+)?)([\s\S]*)$/);
    if (!m) return;
    var pre = m[1], raw = m[2], post = m[3];
    var comma = raw.indexOf(',') > -1, dec = (raw.split('.')[1] || '').length, end = parseFloat(raw.replace(/,/g, ''));
    if (getComputedStyle(el).display === 'inline') {
      el.style.display = 'inline-block';
      el.style.minWidth = el.getBoundingClientRect().width + 'px';
    }
    var D = 1600, t0 = 0;
    function fmt(v) {
      var s = v.toFixed(dec);
      if (comma) { var p = s.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); s = p.join('.'); }
      return pre + s + post;
    }
    function step(t) {
      if (!t0) t0 = t;
      var p = Math.min(1, (t - t0) / D), e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      el.textContent = p === 1 ? txt : fmt(end * e);
      if (p < 1) requestAnimationFrame(step);
    }
    el.textContent = fmt(0);
    requestAnimationFrame(step);
  }
  var cio = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { cio.unobserve(e.target); countUp(e.target); } });
  }, { threshold: 0.6 });
  $$('.figs b, .proof b, .facts b').forEach(function (el) { if (/\d/.test(el.textContent)) cio.observe(el); });

  /* 패럴랙스: 큰 사진이 박스보다 느리게 움직여 깊이감. 화면에 보일 때만 계산 */
  var pxs = $$('.subhero > img, .join > img, .about > .photo > img');
  if (pxs.length) {
    var live = [];
    var ticking = false;
    var update = function () {
      ticking = false;
      var h = window.innerHeight;
      live.forEach(function (img) {
        var r = img.parentElement.getBoundingClientRect();
        var p = (r.top + r.height / 2 - h / 2) / (h / 2 + r.height / 2);
        p = Math.max(-1, Math.min(1, p));
        img.style.setProperty('--py', (-p * r.height * 0.05).toFixed(1) + 'px');
      });
    };
    var tick = function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    var pio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var img = e.target.querySelector(':scope > img, :scope > .photo > img');
        var at = live.indexOf(img);
        if (e.isIntersecting && at < 0) live.push(img);
        if (!e.isIntersecting && at > -1) live.splice(at, 1);
      });
      tick();
    }, { rootMargin: '15% 0px' });
    pxs.forEach(function (img) {
      img.classList.add('px');
      pio.observe(img.closest('.subhero, .join, .about'));
    });
    window.addEventListener('scroll', tick, { passive: true });
    window.addEventListener('resize', tick);
    tick();
  }
})();

(function () {
  /* 로고 흐름(마키): 멈춤 버튼, 마우스·포커스가 올라가면 멈춤, 화면 밖이면 멈춤 */
  Array.prototype.slice.call(document.querySelectorAll('[data-marquee]')).forEach(function (box) {
    var btn = box.querySelector('.mq-toggle');
    if (btn) btn.addEventListener('click', function () {
      var paused = box.classList.toggle('is-paused');
      btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
      btn.querySelector('span').textContent = paused ? '로고 흐름 재생' : '로고 흐름 멈춤';
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { box.classList.toggle('is-off', !es[0].isIntersecting); }).observe(box);
    }
  });
})();
