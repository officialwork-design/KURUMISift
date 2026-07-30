/**
 * Setup.gs
 * 初期化・構成検証・初期管理者設定・期限通知トリガー。
 * GASエディタから手動実行することを想定。
 */

/**
 * 不足シートとヘッダーを作成し、設定シートの初期値を補完する。
 * 既存データは破壊しない。
 * @return {Object} 実行結果サマリ
 */
function setupSpreadsheet() {
  var result = ensureSheetsAndHeaders();

  // 設定初期値を補完（既存キーは上書きしない）
  var existing = {};
  findRows(SHEET.SETTINGS, function () { return true; }).forEach(function (r) {
    if (r.data.setting_key) existing[String(r.data.setting_key)] = true;
  });
  var added = [];
  SETTINGS_DEFAULTS.forEach(function (row) {
    if (!existing[row[0]]) {
      appendRow(SHEET.SETTINGS, {
        setting_key: row[0], setting_value: row[1], description: row[2], updated_at: nowIso()
      });
      added.push(row[0]);
    }
  });
  result.settingsAdded = added;
  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * 必須スクリプトプロパティの不足を返す。
 * @return {Object} { ok:boolean, missing:[...], present:[...] }
 */
function validateConfiguration() {
  var required = [
    PROP.SPREADSHEET_ID, PROP.LIFF_ID, PROP.LINE_CHANNEL_ID,
    PROP.LINE_CHANNEL_ACCESS_TOKEN, PROP.GAS_WEB_APP_URL,
    PROP.INITIAL_ADMIN_LINE_USER_ID, PROP.APP_ENV
  ];
  var missing = [], present = [];
  required.forEach(function (k) {
    if (getProp(k) === null) missing.push(k); else present.push(k);
  });
  var res = { ok: missing.length === 0, missing: missing, present: present };
  Logger.log(JSON.stringify(res));
  return res;
}

/**
 * 初期管理者を設定する。
 * INITIAL_ADMIN_LINE_USER_ID の社員が既に登録済みなら role=admin に更新。
 * 未登録なら、その LINEユーザーID は初回登録時に自動で admin になる（EmployeeService参照）。
 */
function createInitialAdmin() {
  var adminLineId = getProp(PROP.INITIAL_ADMIN_LINE_USER_ID);
  if (!adminLineId) {
    var msg = 'INITIAL_ADMIN_LINE_USER_ID が未設定です。';
    Logger.log(msg);
    return { ok: false, message: msg };
  }
  var emp = findEmployeeByLineUserId(adminLineId);
  if (emp) {
    if (String(emp.role) !== ROLE.ADMIN) {
      adminUpdateEmployee(emp.employee_id, { role: ROLE.ADMIN });
    }
    var m1 = '既存社員を管理者に設定しました: ' + emp.real_name;
    Logger.log(m1);
    return { ok: true, message: m1, employeeId: emp.employee_id };
  }
  var m2 = '対象はまだ未登録です。初回登録時に自動的に管理者になります。';
  Logger.log(m2);
  return { ok: true, message: m2, pending: true };
}

/* ---------------- 代休期限通知（時間主導トリガー） ---------------- */

/**
 * 【廃止】代休の有効期限をなくしたため、期限通知は行わない。
 * トリガーが残っていても何もしないよう、先頭で return する。
 */
function sendCompensatoryLeaveExpiryNotifications() {
  return 0; // 期限の仕組みは廃止

  /* eslint-disable no-unreachable */
  var today = formatDate(new Date());
  var targets = [14, 7];
  var sent = 0;

  var leaves = findRows(SHEET.LEAVES, function (l) {
    return String(l.status) === LEAVE_STATUS.AVAILABLE;
  }).map(function (r) { return r.data; });

  leaves.forEach(function (l) {
    targets.forEach(function (days) {
      var noticeDate = addDaysYmd(String(l.expiration_date), -days);
      if (noticeDate !== today) return;

      var dedupeId = l.leave_id + ':' + days + ':' + today;
      if (_alreadyNotified(dedupeId)) return;

      var emp = findEmployeeById(l.employee_id);
      if (emp && emp.line_user_id && String(emp.status) === EMP_STATUS.ACTIVE) {
        var ok = pushMessage(emp.line_user_id,
          '【代休の期限が近づいています】\n' +
          '休日出勤日 ' + l.work_date + ' 分の代休が、あと ' + days + ' 日（' +
          l.expiration_date + '）で期限切れになります。お早めにご申請ください。');
        if (ok) {
          logAction(emp.employee_id, ACTION_TYPE.NOTIFY, 'leave_expiry', dedupeId, null, { days: days });
          sent++;
        }
      }
    });
  });
  Logger.log('expiry notifications sent: ' + sent);
  return sent;
}

/** 通知重複判定（操作ログの target_id で判定） */
function _alreadyNotified(dedupeId) {
  var row = findOne(SHEET.LOGS, function (log) {
    return String(log.action_type) === ACTION_TYPE.NOTIFY &&
      String(log.target_id) === dedupeId;
  });
  return !!row;
}

/** 日次トリガーを設置（手動実行）。既存の同名トリガーがあれば追加しない。 */
function installExpiryTrigger() {
  var fn = 'sendCompensatoryLeaveExpiryNotifications';
  var exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === fn;
  });
  if (exists) return { ok: true, message: '既にトリガーが存在します。' };
  ScriptApp.newTrigger(fn).timeBased().everyDays(1).atHour(9).create();
  return { ok: true, message: '毎日9時台に実行するトリガーを設置しました。' };
}

/* ---------------- キープウォーム（コールドスタート軽減） ---------------- */

/**
 * アプリを温める。スプレッドシート接続を維持し、Webアプリの doGet 経路も自分でpingする。
 * 5分ごとの時間主導トリガーから呼ぶ。
 */
function keepWarm() {
  try { getAllSettings(); } catch (e) {}
  try {
    var url = getProp(PROP.GAS_WEB_APP_URL);
    if (url) {
      UrlFetchApp.fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'action=getConfig&warm=1',
        { method: 'get', muteHttpExceptions: true });
    }
  } catch (e) {}
  return 'warmed';
}

/** キープウォームの5分ごとトリガーを設置（手動実行）。重複設置しない。 */
function installKeepWarmTrigger() {
  var fn = 'keepWarm';
  var exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === fn;
  });
  if (exists) return { ok: true, message: '既にキープウォームのトリガーがあります。' };
  ScriptApp.newTrigger(fn).timeBased().everyMinutes(5).create();
  return { ok: true, message: '5分ごとのキープウォームを設置しました。' };
}

/** キープウォームのトリガーを削除（手動実行）。 */
function removeKeepWarmTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'keepWarm') { ScriptApp.deleteTrigger(t); removed++; }
  });
  return { ok: true, removed: removed };
}
