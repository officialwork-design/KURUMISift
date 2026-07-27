/**
 * api.js
 * GAS Web アプリとの通信。
 * - Content-Type: text/plain で送り CORS プリフライトを回避。
 * - タイムアウト・JSON解析失敗・ネットワーク失敗時の1回リトライ。
 * - 統一エラー形式を日本語メッセージへ。
 */
window.Api = (function () {

  function endpoint() {
    var url = (window.APP_CONFIG || {}).API_URL;
    if (!url) throw new Error('API_URL が未設定です（config.js を確認してください）。');
    return url;
  }

  function timeout() { return (window.APP_CONFIG || {}).TIMEOUT_MS || 15000; }

  function fetchOnce(body) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeout());
    return fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'follow'
    }).then(function (res) {
      clearTimeout(timer);
      return res.text().then(function (text) {
        try {
          return JSON.parse(text);
        } catch (e) {
          throw new Error('サーバー応答を解析できませんでした。時間をおいて再度お試しください。');
        }
      });
    }).catch(function (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('通信がタイムアウトしました。再度お試しください。');
      throw e;
    });
  }

  /**
   * action を呼び出す。idToken は LiffClient から付与。
   * @param {string} action
   * @param {object} payload
   * @param {object} opts { silent:boolean }（ローディングを出さない）
   */
  function call(action, payload, opts) {
    opts = opts || {};
    if (!opts.silent) window.AppState.set({ loading: true });
    var body = {
      action: action,
      idToken: window.LiffClient.getIdToken(),
      payload: payload || {}
    };

    return fetchOnce(body)
      .catch(function (err) {
        // ネットワーク系のみ1回リトライ
        if (err && /タイムアウト|Failed to fetch|NetworkError/.test(err.message)) {
          return fetchOnce(body);
        }
        throw err;
      })
      .then(function (json) {
        if (!json || typeof json.success === 'undefined') {
          throw new Error('サーバー応答が不正です。');
        }
        if (!json.success) {
          var err = new Error(json.error && json.error.message ? json.error.message : 'エラーが発生しました。');
          err.code = json.error && json.error.code;
          throw err;
        }
        return json.data;
      })
      .finally(function () {
        if (!opts.silent) window.AppState.set({ loading: false });
      });
  }

  return { call: call };
})();
