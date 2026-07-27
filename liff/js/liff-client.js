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
            // 無限ログインループ防止：一度リダイレクトして戻っても未ログインなら中断する。
            var attempted = false;
            try { attempted = sessionStorage.getItem('liff_login_attempted') === '1'; } catch (e) {}
            if (attempted) {
              try { sessionStorage.removeItem('liff_login_attempted'); } catch (e) {}
              throw new Error(
                'LINEログインが完了できませんでした。\n' +
                'このページは LINE アプリ内、または LIFF URL（https://liff.line.me/…）から開いてください。\n' +
                '通常ブラウザで開く場合は、Cookie／トラッキング防止（シークレットモード等）でログイン状態が保持できないことがあります。'
              );
            }
            try { sessionStorage.setItem('liff_login_attempted', '1'); } catch (e) {}
            // ログインへリダイレクト（戻り先を現在のURLに明示）
            liff.login({ redirectUri: window.location.href });
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
    isInClient: function () { return typeof liff !== 'undefined' && liff.isInClient && liff.isInClient(); }
  };
})();
