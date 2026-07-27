/**
 * admin/js/api.js
 * 管理者画面用の LIFF 認証 + GAS API 通信。
 * 管理者も LINE でログインして IDトークンを取得する。
 * 権限（role=admin）の最終判定は GAS 側で行う。
 */
window.AdminApi = (function () {
  var _idToken = null;
  var cfg = window.ADMIN_CONFIG || {};

  function setLoading(on, text) {
    var l = document.getElementById('loading');
    if (text) document.getElementById('loading-text').textContent = text;
    if (l) l.style.display = on ? 'flex' : 'none';
  }

  function withTimeout(promise, ms, msg) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error(msg || 'タイムアウトしました。')); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function resolveLiffId() {
    if (cfg.LIFF_ID) return Promise.resolve(cfg.LIFF_ID);
    if (!cfg.API_URL) return Promise.reject(new Error('API_URL が未設定です。'));
    return fetch(cfg.API_URL + '?action=getConfig')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.success && j.data && j.data.liffId) return j.data.liffId;
        throw new Error('LIFF ID を取得できませんでした。');
      });
  }

  function init() {
    if (typeof liff === 'undefined') return Promise.reject(new Error('LIFF SDK を読み込めませんでした。'));
    return withTimeout(
      resolveLiffId()
        .then(function (id) { return liff.init({ liffId: id }); })
        .then(function () {
          if (!liff.isLoggedIn()) { liff.login(); return new Promise(function () {}); }
          _idToken = liff.getIDToken();
          if (!_idToken) throw new Error('IDトークンを取得できませんでした。');
          return true;
        }),
      cfg.INIT_TIMEOUT_MS || 12000, 'LIFF 初期化がタイムアウトしました。'
    );
  }

  function call(action, payload, opts) {
    opts = opts || {};
    if (!opts.silent) setLoading(true, '通信中...');
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, cfg.TIMEOUT_MS || 20000);
    return fetch(cfg.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, idToken: _idToken, payload: payload || {} }),
      signal: controller.signal, redirect: 'follow'
    }).then(function (res) {
      clearTimeout(timer);
      return res.text();
    }).then(function (text) {
      var json;
      try { json = JSON.parse(text); } catch (e) { throw new Error('サーバー応答を解析できませんでした。'); }
      if (!json.success) {
        var err = new Error(json.error ? json.error.message : 'エラーが発生しました。');
        err.code = json.error && json.error.code;
        throw err;
      }
      return json.data;
    }).catch(function (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('通信がタイムアウトしました。');
      throw e;
    }).finally(function () {
      if (!opts.silent) setLoading(false);
    });
  }

  return { init: init, call: call, setLoading: setLoading };
})();
