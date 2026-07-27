/**
 * LineService.gs
 * LINE Messaging API プッシュ通知 と LIFF IDトークン検証。
 * 通知失敗は本処理をロールバックせず、ログに記録して継続する。
 */

/** チャネルアクセストークン取得（スクリプトプロパティ） */
function getChannelAccessToken() {
  return getProp(PROP.LINE_CHANNEL_ACCESS_TOKEN);
}

/**
 * 単一ユーザーへプッシュ通知。
 * @return {boolean} 成功可否（失敗しても例外を投げない）
 */
function pushMessage(lineUserId, text) {
  var token = getChannelAccessToken();
  if (!token) {
    logError('', 'LineService.pushMessage', new AppError('LINE_NO_TOKEN', 'LINE_CHANNEL_ACCESS_TOKEN 未設定'));
    return false;
  }
  if (!lineUserId) return false;
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({
        to: lineUserId,
        messages: [{ type: 'text', text: String(text).slice(0, 4900) }]
      })
    });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      logError('', 'LineService.pushMessage', new AppError('LINE_API_' + code, res.getContentText()));
      return false;
    }
    return true;
  } catch (e) {
    logError('', 'LineService.pushMessage', e);
    return false;
  }
}

/** role=admin の在籍社員全員へ通知 */
function notifyAdmins(text) {
  try {
    var admins = findRows(SHEET.EMPLOYEES, function (e) {
      return String(e.role) === ROLE.ADMIN && String(e.status) === EMP_STATUS.ACTIVE;
    });
    admins.forEach(function (a) {
      if (a.data.line_user_id) pushMessage(a.data.line_user_id, text);
    });
  } catch (e) {
    logError('', 'LineService.notifyAdmins', e);
  }
}

/**
 * LIFF IDトークンを検証し、payload を返す。
 * channel_id（LINE_CHANNEL_ID）を client_id として LINE の verify エンドポイントを利用。
 * 失敗時は INVALID_TOKEN 例外。
 */
function verifyIdToken(idToken) {
  if (!idToken) throw new AppError(ERROR_CODES.UNAUTHENTICATED, 'IDトークンがありません。再ログインしてください。');
  var channelId = getProp(PROP.LINE_CHANNEL_ID);
  if (!channelId) {
    // 検証用のチャネルIDが未設定の場合は、検証不能として拒否（本番は必ず設定すること）
    throw new AppError(ERROR_CODES.CONFIG_MISSING, 'LINE_CHANNEL_ID が未設定のためトークン検証ができません。');
  }
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'post',
      muteHttpExceptions: true,
      payload: { id_token: idToken, client_id: channelId }
    });
    var code = res.getResponseCode();
    var body = JSON.parse(res.getContentText() || '{}');
    if (code !== 200 || !body.sub) {
      var detail = body.error_description || body.error || ('HTTP ' + code);
      throw new AppError(ERROR_CODES.INVALID_TOKEN,
        'IDトークンの検証に失敗しました（' + detail + '）。再ログインしてください。');
    }
    // body.sub が LINE ユーザーID
    return {
      lineUserId: body.sub,
      displayName: body.name || '',
      pictureUrl: body.picture || ''
    };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(ERROR_CODES.INVALID_TOKEN, 'IDトークンの検証に失敗しました。');
  }
}

/**
 * LIFF アクセストークンを検証し、プロフィール（ユーザーID等）を返す。
 * アクセストークンは liff が自動更新するため、IDトークンより失効しにくい（推奨）。
 * 1) /oauth2/v2.1/verify?access_token=... で有効性と client_id を確認
 * 2) /v2/profile でユーザーID・表示名・画像を取得
 * 失敗時は INVALID_TOKEN / UNAUTHENTICATED 例外。
 */
function verifyAccessToken(accessToken) {
  if (!accessToken) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, 'アクセストークンがありません。再ログインしてください。');
  }
  // 同一トークンの検証結果を短時間キャッシュ（LINEへの2回の問い合わせを省略し高速化）
  var cache = CacheService.getScriptCache();
  var cacheKey = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, accessToken));
  var hit = cache.get(cacheKey);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) {}
  }
  try {
    var vr = UrlFetchApp.fetch(
      'https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(accessToken),
      { method: 'get', muteHttpExceptions: true });
    var vc = vr.getResponseCode();
    var vb = JSON.parse(vr.getContentText() || '{}');
    if (vc !== 200) {
      var d = vb.error_description || vb.error || ('HTTP ' + vc);
      throw new AppError(ERROR_CODES.INVALID_TOKEN,
        'アクセストークンの検証に失敗しました（' + d + '）。再ログインしてください。');
    }
    // チャネルID整合性チェック（設定があれば）
    var channelId = getProp(PROP.LINE_CHANNEL_ID);
    if (channelId && vb.client_id && String(vb.client_id) !== String(channelId)) {
      throw new AppError(ERROR_CODES.INVALID_TOKEN,
        'アクセストークンのチャネルIDが一致しません（client_id=' + vb.client_id + '）。');
    }
    // プロフィール取得
    var pr = UrlFetchApp.fetch('https://api.line.me/v2/profile', {
      method: 'get', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + accessToken }
    });
    var pc = pr.getResponseCode();
    var pb = JSON.parse(pr.getContentText() || '{}');
    if (pc !== 200 || !pb.userId) {
      var pd = pb.message || ('HTTP ' + pc);
      throw new AppError(ERROR_CODES.INVALID_TOKEN, 'プロフィール取得に失敗しました（' + pd + '）。');
    }
    var profile = {
      lineUserId: pb.userId,
      displayName: pb.displayName || '',
      pictureUrl: pb.pictureUrl || ''
    };
    try { cache.put(cacheKey, JSON.stringify(profile), 300); } catch (e) {} // 5分キャッシュ
    return profile;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(ERROR_CODES.INVALID_TOKEN, 'アクセストークンの検証に失敗しました。');
  }
}
