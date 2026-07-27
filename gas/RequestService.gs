/**
 * RequestService.gs
 * 休日出勤申請・代休申請の作成、一覧、承認、却下。
 * 承認・却下は状態遷移を検証し、二重処理を防止する。
 */

function getRequestById(requestId) {
  var row = findOne(SHEET.REQUESTS, { request_id: requestId });
  return row ? row.data : null;
}

/**
 * 休日出勤申請の作成。
 * payload: {target_date, start_time, end_time, reason, preferred_compensatory_date, remarks}
 */
function createHolidayWorkRequest(emp, payload) {
  var targetDate = String(payload.target_date || '');
  parseYmd(targetDate); // 形式チェック（不正なら例外）
  if (!isValidTime(payload.start_time) || !isValidTime(payload.end_time)) {
    throw new AppError(ERROR_CODES.VALIDATION, '開始/終了時刻の形式が正しくありません（HH:mm）。');
  }
  if (payload.end_time <= payload.start_time) {
    throw new AppError(ERROR_CODES.VALIDATION, '終了時刻は開始時刻より後にしてください。');
  }
  if (!String(payload.reason || '').trim()) {
    throw new AppError(ERROR_CODES.VALIDATION, '出勤理由を入力してください。');
  }
  if (payload.preferred_compensatory_date) parseYmd(String(payload.preferred_compensatory_date));

  // 同一社員・同一対象日の重複申請防止（pending/approved のみ対象）
  var dup = findRows(SHEET.REQUESTS, function (r) {
    return String(r.employee_id) === String(emp.employee_id) &&
      String(r.request_type) === REQUEST_TYPE.HOLIDAY_WORK &&
      String(r.target_date) === targetDate &&
      (String(r.status) === REQUEST_STATUS.PENDING || String(r.status) === REQUEST_STATUS.APPROVED);
  });
  if (dup.length > 0) {
    throw new AppError(ERROR_CODES.DUPLICATE_REQUEST, 'この日付の休日出勤申請は既に存在します。');
  }

  var now = nowIso();
  var req = {
    request_id: uuid(),
    employee_id: emp.employee_id,
    request_type: REQUEST_TYPE.HOLIDAY_WORK,
    target_date: targetDate,
    start_time: payload.start_time,
    end_time: payload.end_time,
    reason: payload.reason,
    preferred_compensatory_date: payload.preferred_compensatory_date || '',
    selected_leave_id: '',
    remarks: payload.remarks || '',
    status: REQUEST_STATUS.PENDING,
    rejection_reason: '',
    approved_by: '',
    requested_at: now,
    approved_at: '',
    updated_at: now
  };
  appendRow(SHEET.REQUESTS, req);
  logAction(emp.employee_id, ACTION_TYPE.CREATE_REQUEST, 'request', req.request_id, null, req);
  notifyAdmins('【休日出勤申請】' + emp.real_name + ' さんが ' + targetDate + ' の休日出勤を申請しました。');
  return req;
}

/**
 * 代休申請の作成。
 * payload: {target_date(取得希望日), selected_leave_id, remarks}
 */
function createCompLeaveRequest(emp, payload) {
  var targetDate = String(payload.target_date || '');
  parseYmd(targetDate);
  var leaveId = String(payload.selected_leave_id || '');
  if (!leaveId) throw new AppError(ERROR_CODES.VALIDATION, '使用する代休を選択してください。');

  var leave = getLeaveById(leaveId);
  if (!leave || String(leave.employee_id) !== String(emp.employee_id)) {
    throw new AppError(ERROR_CODES.NOT_FOUND, '指定された代休が見つかりません。');
  }

  var now = nowIso();
  var req = {
    request_id: uuid(),
    employee_id: emp.employee_id,
    request_type: REQUEST_TYPE.COMP_LEAVE,
    target_date: targetDate,
    start_time: '',
    end_time: '',
    reason: '',
    preferred_compensatory_date: '',
    selected_leave_id: leaveId,
    remarks: payload.remarks || '',
    status: REQUEST_STATUS.PENDING,
    rejection_reason: '',
    approved_by: '',
    requested_at: now,
    approved_at: '',
    updated_at: now
  };
  // 代休を申請中へ（available でなければ例外＝二重申請防止）
  setLeavePending(leaveId, req.request_id);
  try {
    appendRow(SHEET.REQUESTS, req);
  } catch (e) {
    // 申請作成に失敗したら代休を戻す
    revertLeaveToAvailable(leaveId);
    throw e;
  }
  logAction(emp.employee_id, ACTION_TYPE.CREATE_REQUEST, 'request', req.request_id, null, req);
  notifyAdmins('【代休申請】' + emp.real_name + ' さんが ' + targetDate + ' の代休を申請しました。');
  return req;
}

/** 本人の申請一覧（statusFilter: all/pending/approved/rejected） */
function listMyRequests(employeeId, statusFilter) {
  var rows = findRows(SHEET.REQUESTS, function (r) {
    return String(r.employee_id) === String(employeeId) &&
      (!statusFilter || statusFilter === 'all' || String(r.status) === statusFilter);
  }).map(function (r) { return r.data; });
  rows.sort(function (a, b) { return String(b.requested_at).localeCompare(String(a.requested_at)); });
  return rows;
}

/** 全申請一覧（管理者用） */
function listAllRequests(statusFilter) {
  var rows = findRows(SHEET.REQUESTS, function (r) {
    return (!statusFilter || statusFilter === 'all' || String(r.status) === statusFilter);
  }).map(function (r) { return r.data; });
  rows.sort(function (a, b) { return String(b.requested_at).localeCompare(String(a.requested_at)); });
  return rows;
}

/** 承認可能な状態か検証（pending のみ）。二重承認/再承認を拒否。 */
function _assertPending(req) {
  if (!req) throw new AppError(ERROR_CODES.NOT_FOUND, '申請が見つかりません。');
  if (String(req.status) !== REQUEST_STATUS.PENDING) {
    throw new AppError(ERROR_CODES.INVALID_STATE, 'この申請は既に処理済みです（' + req.status + '）。');
  }
}

/**
 * 申請承認。二重処理防止のためロック内で状態を再確認する。
 */
function approveRequest(admin, requestId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var req = getRequestById(requestId);
    _assertPending(req);
    var emp = findEmployeeById(req.employee_id);
    var now = nowIso();

    if (String(req.request_type) === REQUEST_TYPE.HOLIDAY_WORK) {
      // 状態を先に承認済みへ（冪等性確保）
      var after = updateRowById(SHEET.REQUESTS, 'request_id', requestId, {
        status: REQUEST_STATUS.APPROVED, approved_by: admin.employee_id, approved_at: now, updated_at: now
      });
      // 勤務カレンダーへ休日出勤を登録
      addScheduleEntry(req.employee_id, req.target_date, WORK_TYPE.HOLIDAY_WORK,
        req.start_time, req.end_time, requestId, req.remarks);
      // 代休を1日付与（冪等：request_id で重複防止）
      grantLeave(req.employee_id, requestId, req.target_date);
      logAction(admin.employee_id, ACTION_TYPE.APPROVE_REQUEST, 'request', requestId, req, after);
      if (emp) pushMessage(emp.line_user_id,
        '【承認】' + req.target_date + ' の休日出勤申請が承認されました。代休を1日付与しました。');
      return after;

    } else if (String(req.request_type) === REQUEST_TYPE.COMP_LEAVE) {
      var after2 = updateRowById(SHEET.REQUESTS, 'request_id', requestId, {
        status: REQUEST_STATUS.APPROVED, approved_by: admin.employee_id, approved_at: now, updated_at: now
      });
      // 対象代休を使用済みへ
      setLeaveUsed(req.selected_leave_id, req.target_date);
      // 勤務カレンダーへ代休を登録
      addScheduleEntry(req.employee_id, req.target_date, WORK_TYPE.COMP_LEAVE, '', '', requestId, req.remarks);
      logAction(admin.employee_id, ACTION_TYPE.APPROVE_REQUEST, 'request', requestId, req, after2);
      if (emp) pushMessage(emp.line_user_id, '【承認】' + req.target_date + ' の代休申請が承認されました。');
      return after2;
    }
    throw new AppError(ERROR_CODES.VALIDATION, '不明な申請種別です。');
  } finally {
    lock.releaseLock();
  }
}

/**
 * 申請却下。
 */
function rejectRequest(admin, requestId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var req = getRequestById(requestId);
    _assertPending(req);
    var emp = findEmployeeById(req.employee_id);
    var now = nowIso();

    var after = updateRowById(SHEET.REQUESTS, 'request_id', requestId, {
      status: REQUEST_STATUS.REJECTED,
      rejection_reason: reason || '',
      approved_by: admin.employee_id,
      approved_at: now,
      updated_at: now
    });

    // 代休申請の却下時は対象代休を未使用へ戻す
    if (String(req.request_type) === REQUEST_TYPE.COMP_LEAVE && req.selected_leave_id) {
      revertLeaveToAvailable(req.selected_leave_id);
    }
    logAction(admin.employee_id, ACTION_TYPE.REJECT_REQUEST, 'request', requestId, req, after);

    var label = String(req.request_type) === REQUEST_TYPE.HOLIDAY_WORK ? '休日出勤' : '代休';
    if (emp) pushMessage(emp.line_user_id,
      '【却下】' + req.target_date + ' の' + label + '申請が却下されました。' +
      (reason ? '\n理由: ' + reason : ''));
    return after;
  } finally {
    lock.releaseLock();
  }
}
