/**
 * liff-client.js
 * LIFF SDK の初期化・ログイン・プロフィール/IDトークン取得。
 * タイムアウトを設けて「起動中から進まない」状態を防ぐ。
 */
window.LiffClient = (function () {
  var _idToken = null;
  var _profile = null;

  function withTimeout(promise, ms, message) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error(message || 'タイムアウトしました。'));
      }, ms);
      promise.then(function (v) { clearTimeout(timer); resolve(v); },
                   function (e) { clearTimeout(timer); reject(e); });
    });
  }

  /** 診断情報を1行にまとめる（原因切り分け用） */
  function collectDiagnostics() {
    var parts = [];
    try { parts.push('inLINE=' + (liff.isInClient ? liff.isInClient() : '?')); } catch (e) { parts.push('inLINE=err'); }
    try { parts.push('os=' + (liff.getOS ? liff.getOS() : '?')); } catch (e) {}
    try { parts.push('liffVer=' + (liff.getVersion ? liff.getVersion() : '?')); } catch (e) {}
    try {
      var q = new URLSearchParams(window.location.search);
      parts.push('hasCode=' + (q.get('code') ? 'yes' : 'no'));
      parts.push('hasLiffState=' + (q.get('liff.state') || q.get('liffRedirectUri') ? 'yes' : 'no'));
    } catch (e) {}
    var ss = 'ng';
    try { sessionStorage.setItem('__t', '1'); sessionStorage.removeItem('__t'); ss = 'ok'; } catch (e) { ss = 'blocked'; }
    parts.push('sessionStorage=' + ss);
    var cookie = 'ng';
    try { cookie = navigator.cookieEnabled ? 'ok' : 'blocked'; } catch (e) {}
    parts.push('cookie=' + cookie);
    parts.push('url=' + window.location.href);
    return '[診断] ' + parts.join(' , ');
  }

  /** LIFF ID を解決（config or GAS getConfig） */
  function resolveLiffId() {
    var cfg = window.APP_CONFIG || {};
    if (cfg.LIFF_ID) return Promise.resolve(cfg.LIFF_ID);
    if (!cfg.API_URL) {
      return Promise.reject(new Error('API_URL が設定されていません（config.js を確認してください）。'));
    }
    return fetch(cfg.API_URL + '?action=getConfig', { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.success && j.data && j.data.liffId) return j.data.liffId;
        throw new Error('LIFF ID を取得できませんでした（GAS の LIFF_ID を設定してください）。');
      });
  }

  return {
    /** 初期化してログイン状態・プロフィール・IDトークンを確立 */
    init: function () {
      var cfg = window.APP_CONFIG || {};
      if (typeof liff === 'undefined') {
        return Promise.reject(new Error('LIFF SDK を読み込めませんでした。通信環境をご確認ください。'));
      }
      return withTimeout(
        resolveLiffId().then(function (liffId) {
          return liff.init({ liffId: liffId });
        }).then(function () {
          if (!liff.isLoggedIn()) {
            // LINE ログイン失敗時、LINE は URL に error / error_description を付けて戻す。
            var q;
            try { q = new URLSearchParams(window.location.search); } catch (e) { q = null; }
            var lineErr = q ? q.get('error') : null;
            var lineErrDesc = q ? q.get('error_description') : null;

            // 無限ログインループ防止：一度リダイレクトして戻っても未ログインなら中断する。
            var attempted = false;
            try { attempted = sessionStorage.getItem('liff_login_attempted') === '1'; } catch (e) {}

            if (attempted || lineErr) {
              try { sessionStorage.removeItem('liff_login_attempted'); } catch (e) {}
              throw new Error(
                'LINEログインが完了できませんでした。\n' +
                'このページは LINE アプリ内、または LIFF URL（https://liff.line.me/2010856238-fSE3RDyL）から開いてください。\n' +
                '通常ブラウザで開く場合は、Cookie／トラッキング防止（シークレットモード等）でログイン状態が保持できないことがあります。' +
                (lineErr ? ('\n\n[LINEからのエラー] ' + lineErr +
                  (lineErrDesc ? ' / ' + decodeURIComponent(lineErrDesc) : '')) : '') +
                '\n\n' + collectDiagnostics()
              );
            }
            try { sessionStorage.setItem('liff_login_attempted', '1'); } catch (e) {}
            // ログインへリダイレクト（既定の戻り先＝現在のエンドポイントURL）
            liff.login();
            return new Promise(function () {}); // リダイレクト待ち
          }
          // ログイン成功。ループ防止フラグを解除。
          try { sessionStorage.removeItem('liff_login_attempted'); } catch (e) {}
          _idToken = liff.getIDToken();
          return liff.getProfile();
        }).then(function (profile) {
          _profile = profile ? {
            displayName: profile.displayName,
            pictureUrl: profile.pictureUrl
          } : null;
          if (!_idToken) throw new Error('IDトークンを取得できませんでした。再ログインしてください。');
          return { idToken: _idToken, profile: _profile };
        }),
        cfg.INIT_TIMEOUT_MS || 12000,
        'LIFF の初期化がタイムアウトしました。'
      );
    },
    getIdToken: function () { return _idToken; },
    getProfile: function () { return _profile; },
    isInClient: function () { return typeof liff !== 'undefined' && liff.isInClient && liff.isInClient(); },
    /** IDトークン失効時などに、ログインし直して新しいトークンを取得する */
    relogin: function () {
      try { sessionStorage.removeItem('liff_login_attempted'); } catch (e) {}
      if (typeof liff !== 'undefined' && liff.login) {
        liff.login();
      } else {
        location.reload();
      }
    }
  };
})();
