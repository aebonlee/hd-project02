/**
 * hd-supabase.js — 여러 사람이 함께 쓰기 위한 공통 연결 모듈
 *
 * 이 파일이 하는 일은 하나다: **브라우저에만 있던 데이터를 서버로 옮기는 것.**
 * 협력업체 응답·팀 업무공유·이슈 접수처럼 여럿이 주고받아야 하는 화면은
 * 각자 브라우저에 저장하면 목적 자체가 성립하지 않는다.
 *
 * 설계
 *  - **읽기는 시작할 때 한 번**에 받아 메모리에 올린다. 화면 계산이 전부 동기 함수라
 *    이 방식이 코드가 훨씬 단순하고, 이 규모(수백~수천 행)에서는 충분히 가볍다.
 *  - **쓰기는 그때그때** 보낸다. 실패하면 조용히 넘기지 않고 화면에 알린다.
 *  - 연결이 안 되면 **화면을 비우지 않고** 기존 localStorage 로 내려간다.
 *    스키마를 아직 안 올렸거나 사내망이 막힌 상황에서 통째로 못 쓰게 되는 것보다 낫다.
 *
 * 쓰는 쪽에서 할 일
 *    HD.boot({ tables:[…], onReady(db){…}, onFallback(err){…} })
 */
(function (root) {
  'use strict';

  var CFG = root.APP_CONFIG || {};
  var client = null;
  var mode = 'demo';          // 'demo' | 'supabase'
  var lastError = null;

  /* ------------------------------------------------------------------ 상태 */

  function available() {
    return !!(CFG.USE_SUPABASE && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY
      && root.supabase && typeof root.supabase.createClient === 'function');
  }

  function db() {
    if (client) return client;
    client = root.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    return client;
  }

  function getMode() { return mode; }
  function error() { return lastError; }

  /* -------------------------------------------------------------- 로그인 */

  /**
   * 업체코드처럼 이메일이 아닌 것으로 로그인하는 화면을 위해,
   * 코드 → 가상 이메일로 바꿔 Supabase Auth 를 쓴다.
   * (관리자가 계정을 만들 때 같은 규칙으로 만들어 두면 된다)
   */
  function codeToEmail(code, domainHint) {
    var d = domainHint || CFG.AUTH_EMAIL_DOMAIN || 'vendor.hd.example.com';
    return String(code).replace(/[^A-Za-z0-9._-]/g, '') + '@' + d;
  }

  function signIn(idOrCode, password, opts) {
    var o = opts || {};
    var email = o.asEmail ? idOrCode : codeToEmail(idOrCode, o.domain);
    return db().auth.signInWithPassword({ email: email, password: password });
  }

  function signOut() { return db().auth.signOut(); }

  function currentUser() {
    return db().auth.getUser().then(function (r) { return r.data && r.data.user; });
  }

  /* ---------------------------------------------------------------- 조회 */

  /**
   * 여러 표를 한 번에 받아 { 표이름: 행배열 } 로 돌려준다.
   * @param {Array} tables [{ name, order, limit, eq }]
   */
  function fetchAll(tables) {
    var reqs = (tables || []).map(function (t) {
      var q = db().from(t.name).select(t.select || '*');
      if (t.eq) Object.keys(t.eq).forEach(function (k) { q = q.eq(k, t.eq[k]); });
      if (t.order) q = q.order(t.order.column, { ascending: t.order.ascending !== false });
      if (t.limit) q = q.limit(t.limit);
      return q;
    });
    return Promise.all(reqs).then(function (res) {
      var bad = res.filter(function (r) { return r.error; });
      if (bad.length) throw bad[0].error;
      var out = {};
      (tables || []).forEach(function (t, i) { out[t.name] = res[i].data || []; });
      return out;
    });
  }

  /* ---------------------------------------------------------------- 저장 */

  /**
   * ⚠ onConflict 를 반드시 지정한다.
   *   생략하면 기본 키(id) 기준이 되는데 id 를 보내지 않는 경우가 많아
   *   매번 INSERT 가 되고, UNIQUE 제약에 걸려 **저장이 통째로 실패**한다.
   *   그런데 화면에는 아무 일도 안 일어난 것처럼 보인다.
   */
  function upsert(table, rows, onConflict) {
    if (!onConflict) {
      return Promise.reject(new Error(
        'upsert 에 onConflict 를 지정해야 합니다 (' + table + '). ' +
        '생략하면 중복 저장이 조용히 실패합니다.'));
    }
    var list = Array.isArray(rows) ? rows : [rows];
    if (!list.length) return Promise.resolve({ count: 0 });
    return db().from(table).upsert(list, { onConflict: onConflict })
      .then(function (r) {
        if (r.error) throw r.error;
        return { count: list.length };
      });
  }

  function insert(table, rows) {
    var list = Array.isArray(rows) ? rows : [rows];
    if (!list.length) return Promise.resolve({ count: 0 });
    return db().from(table).insert(list).then(function (r) {
      if (r.error) throw r.error;
      return { count: list.length };
    });
  }

  function update(table, patch, match) {
    var q = db().from(table).update(patch);
    Object.keys(match || {}).forEach(function (k) { q = q.eq(k, match[k]); });
    return q.then(function (r) { if (r.error) throw r.error; return r; });
  }

  function remove(table, match) {
    var q = db().from(table).delete();
    Object.keys(match || {}).forEach(function (k) { q = q.eq(k, match[k]); });
    return q.then(function (r) { if (r.error) throw r.error; return r; });
  }

  /* ------------------------------------------------- 저장 실패를 알린다 */

  /**
   * 저장이 실패했는데 화면이 그대로면 사용자는 저장된 줄 안다.
   * 그 상태로 브라우저를 닫으면 입력한 내용이 사라진다.
   * 그래서 실패는 **반드시 눈에 보이게** 한다.
   */
  function guard(promise, what) {
    return promise.catch(function (err) {
      lastError = err;
      var msg = (err && err.message) || String(err);
      notify('저장하지 못했습니다 — ' + what + '\n' + msg +
             '\n화면의 값은 아직 서버에 반영되지 않았습니다.', true);
      throw err;
    });
  }

  var notifyFn = null;
  function onNotify(fn) { notifyFn = fn; }
  function notify(msg, isError) {
    if (notifyFn) { try { notifyFn(msg, isError); return; } catch (e) { /* 아래로 */ } }
    if (isError) { try { root.alert(msg); } catch (e) {} }
  }

  /* ---------------------------------------------------------------- 배너 */

  /** 지금 어느 모드인지 화면 위쪽에 그대로 적는다. 모르고 쓰면 데이터가 어디 있는지 헷갈린다. */
  function banner(state, detail) {
    var el = root.document && root.document.getElementById('hd-conn-banner');
    if (!el) {
      if (!root.document || !root.document.body) return;
      el = root.document.createElement('div');
      el.id = 'hd-conn-banner';
      el.setAttribute('role', 'status');
      root.document.body.insertBefore(el, root.document.body.firstChild);
    }
    var map = {
      connecting: ['서버에 연결하는 중…', '#e8edf3', '#334155'],
      supabase:   ['서버에 연결됨 — 입력한 내용이 팀 전체에 공유됩니다.', '#e3f4ec', '#0a6045'],
      demo:       ['이 브라우저에만 저장됩니다 — 다른 사람에게는 보이지 않고, 브라우저를 정리하면 사라집니다.', '#fdf4e3', '#7a4f00']
    };
    var m = map[state] || map.demo;
    el.style.cssText = 'padding:8px 16px;font-size:13px;line-height:1.5;text-align:center;'
      + 'background:' + m[1] + ';color:' + m[2] + ';border-bottom:1px solid rgba(0,0,0,.08)';
    el.textContent = m[0] + (detail ? ' ' + detail : '');
    syncOffsets();
  }

  /**
   * 띠와 헤더의 **실제 높이**를 재서 CSS 변수로 알려 준다.
   *
   * 화면 위에 붙박이(position:fixed)로 놓인 것들은 보통 `top: 52px` 처럼
   * 헤더 높이를 숫자로 박아 둔다. 그 위에 띠가 하나 끼어들거나 헤더 여백이
   * 바뀌면 그 숫자가 틀려져 **붙박이 요소가 헤더를 덮는다.**
   * 실제로 hd-project05 의 왼쪽 메뉴가 그렇게 덮였다.
   * 숫자를 고쳐 박는 대신 잰 값을 넘겨, 무엇이 바뀌어도 따라오게 한다.
   */
  function syncOffsets() {
    if (!root.document || !root.document.documentElement) return;
    var el = root.document.getElementById('hd-conn-banner');
    var header = root.document.querySelector('body > header');
    var bh = el ? Math.round(el.getBoundingClientRect().height) : 0;
    var hh = header ? Math.round(header.getBoundingClientRect().height) : 0;
    var st = root.document.documentElement.style;
    st.setProperty('--hd-banner-h', bh + 'px');
    st.setProperty('--hd-header-h', hh + 'px');
    st.setProperty('--hd-chrome-h', (bh + hh) + 'px');
  }

  // 글꼴이 늦게 오거나 창 크기가 바뀌면 높이도 바뀐다
  if (root.addEventListener) {
    root.addEventListener('resize', function () { syncOffsets(); });
    if (root.document && root.document.fonts && root.document.fonts.ready) {
      root.document.fonts.ready.then(function () { syncOffsets(); });
    }
  }


  /* ---------------------------------------------------------------- 시작 */

  /**
   * @param {object} opts
   *   tables      : fetchAll 에 넘길 표 목록
   *   requireAuth : true 면 로그인 세션이 없을 때 데모로 내려가지 않고 onAuthNeeded 를 부른다
   *   onReady(db) : 서버에서 받아온 데이터로 화면을 띄운다
   *   onFallback(err) : 연결 실패 — 기존 localStorage 로 화면을 띄운다
   *   onAuthNeeded()  : 로그인 화면을 띄운다
   */
  function boot(opts) {
    var o = opts || {};
    if (!available()) {
      mode = 'demo';
      banner('demo');
      if (o.onFallback) o.onFallback(null);
      return;
    }
    banner('connecting');

    var start = o.requireAuth
      ? db().auth.getSession().then(function (r) {
          if (!(r.data && r.data.session)) {
            mode = 'supabase';
            banner('supabase', '로그인이 필요합니다.');
            if (o.onAuthNeeded) o.onAuthNeeded();
            return null;              // 로그인 화면으로
          }
          return fetchAll(o.tables);
        })
      : fetchAll(o.tables);

    start.then(function (data) {
      if (data === null) return;      // 로그인 대기
      mode = 'supabase';
      banner('supabase');
      if (o.onReady) o.onReady(data);
    }).catch(function (err) {
      lastError = err;
      mode = 'demo';
      var hint = /relation .* does not exist|schema cache/i.test((err && err.message) || '')
        ? ' supabase/schema.sql 을 SQL Editor 에서 실행했는지 확인하세요.'
        : '';
      banner('demo', '(연결 실패: ' + ((err && err.message) || err) + ')' + hint);
      if (o.onFallback) o.onFallback(err);
    });
  }

  root.HD = {
    available: available, mode: getMode, error: error, client: db,
    signIn: signIn, signOut: signOut, currentUser: currentUser, codeToEmail: codeToEmail,
    fetchAll: fetchAll, upsert: upsert, insert: insert, update: update, remove: remove,
    guard: guard, onNotify: onNotify, banner: banner, boot: boot
  };
})(typeof self !== 'undefined' ? self : this);
