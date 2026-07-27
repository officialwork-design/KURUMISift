/**
 * Code.gs
 * Webアプリのエントリポイント。
 * - doGet: 公開設定の取得・JSON API・ランディングHTMLを返す。
 * - doPost: JSON API（フロントエンドの主経路）。
 * 例外は Api の統一フォーマットで返し、本番ではスタックトレースを含めない。
 */

function doGet(e) {
  // 公開設定（トークン不要）: フロントの LIFF 初期化用
  if (e && e.parameter && e.parameter.action === 'getConfig') {
    return jsonOutput(apiOk(getPublicConfig()));
  }
  // GET でのAPI呼び出し（デバッグ・単純取得用）
  if (e && e.parameter && e.parameter.action) {
    return handleJson(e);
  }
  // それ以外はランディング/ヘルスHTML
  return renderLanding();
}

function doPost(e) {
  return handleJson(e);
}

/** JSON API の共通ハンドラ（例外を統一フォーマットへ） */
function handleJson(e) {
  var actorId = '';
  try {
    var req = parseRequest(e);
    var res = dispatch(req);
    return jsonOutput(res);
  } catch (err) {
    var code = (err && err.code) ? err.code : ERROR_CODES.INTERNAL;
    var message = (err && err.message) ? err.message : '内部エラーが発生しました。';
    // 予期しない例外はログへ（スタックはログのみ、レスポンスには含めない）
    if (!(err instanceof AppError)) {
      logError(actorId, 'handleJson', err);
      message = isProd() ? '内部エラーが発生しました。' : message;
    }
    return jsonOutput(apiErr(code, message));
  }
}

/** ContentService で JSON を返す */
function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 公開してよい設定のみ返す */
function getPublicConfig() {
  return {
    liffId: getProp(PROP.LIFF_ID, ''),
    appName: getSettingSafe('APP_NAME', 'KURUMI Shift'),
    env: getProp(PROP.APP_ENV, 'development'),
    version: APP_BUILD,
    autoApprove: getSettingSafe('AUTO_APPROVE_REQUESTS', 'true')
  };
}

/** 設定シート未初期化でも落ちない設定取得 */
function getSettingSafe(key, def) {
  try { return getSetting(key, def); } catch (e) { return def; }
}

/** ランディング/ヘルスページ */
function renderLanding() {
  var appName = escapeHtml(getSettingSafe('APP_NAME', 'KURUMI Shift'));
  var html = '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + appName + ' API</title>' +
    '<style>body{font-family:sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#222}' +
    'h1{color:#06c755}code{background:#f2f2f2;padding:2px 6px;border-radius:4px}</style></head><body>' +
    '<h1>' + appName + '</h1>' +
    '<p>このURLは Web アプリ（JSON API）のエンドポイントです。</p>' +
    '<p>社員用画面（LIFF）・管理者用画面は静的ホスティング（例: GitHub Pages）から配信し、' +
    'このURLを <code>GAS_WEB_APP_URL</code> として設定してください。</p>' +
    '<p>詳細は README を参照してください。</p>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
