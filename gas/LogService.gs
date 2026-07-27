/**
 * LogService.gs
 * 操作ログ・エラーログの保存。before/after は JSON 文字列で保存する。
 */

/** 安全な JSON 文字列化（循環参照でも落ちない） */
function safeStringify(obj) {
  if (obj === null || obj === undefined) return '';
  try {
    return JSON.stringify(obj);
  } catch (e) {
    try {
      var seen = [];
      return JSON.stringify(obj, function (k, v) {
        if (typeof v === 'object' && v !== null) {
          if (seen.indexOf(v) !== -1) return '[Circular]';
          seen.push(v);
        }
        return v;
      });
    } catch (e2) {
      return String(obj);
    }
  }
}

/**
 * 操作ログを保存する。ログ保存自体の失敗は握りつぶし（本処理を止めない）。
 */
function logAction(actorEmployeeId, actionType, targetType, targetId, beforeData, afterData) {
  try {
    appendRow(SHEET.LOGS, {
      log_id: uuid(),
      actor_employee_id: actorEmployeeId || '',
      action_type: actionType || '',
      target_type: targetType || '',
      target_id: targetId || '',
      before_data: safeStringify(beforeData),
      after_data: safeStringify(afterData),
      created_at: nowIso()
    });
  } catch (e) {
    console.error('logAction failed: ' + (e && e.message));
  }
}

/** エラーログ保存 */
function logError(actorEmployeeId, context, error) {
  var payload = {
    context: context,
    code: error && error.code ? error.code : null,
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : null
  };
  try {
    appendRow(SHEET.LOGS, {
      log_id: uuid(),
      actor_employee_id: actorEmployeeId || '',
      action_type: ACTION_TYPE.ERROR,
      target_type: context || '',
      target_id: '',
      before_data: '',
      after_data: safeStringify(payload),
      created_at: nowIso()
    });
  } catch (e) {
    console.error('logError failed: ' + (e && e.message));
  }
}

/** 操作ログ一覧（新しい順、上限件数） */
function listLogs(limit) {
  var rows = findRows(SHEET.LOGS, function () { return true; });
  rows.sort(function (a, b) {
    return String(b.data.created_at).localeCompare(String(a.data.created_at));
  });
  var lim = limit || 200;
  return rows.slice(0, lim).map(function (r) { return r.data; });
}
