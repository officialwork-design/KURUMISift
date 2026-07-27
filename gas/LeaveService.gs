/**
 * LeaveService.gs
 * 代休台帳の操作。半日代休は扱わない（初期版）。
 */

function getLeaveById(leaveId) {
  var row = findOne(SHEET.LEAVES, { leave_id: leaveId });
  return row ? row.data : null;
}

/**
 * 代休付与（休日出勤承認時）。
 * 同一 holiday_work_request_id に対して既に付与済みなら二重付与しない（冪等）。
 */
function grantLeave(employeeId, holidayWorkRequestId, workDate) {
  var existing = findOne(SHEET.LEAVES, { holiday_work_request_id: holidayWorkRequestId });
  if (existing) {
    return existing.data; // 二重付与防止
  }
  var now = nowIso();
  var leave = {
    leave_id: uuid(),
    employee_id: employeeId,
    holiday_work_request_id: holidayWorkRequestId,
    work_date: workDate,
    granted_days: 1,
    expiration_date: '', // 無期限（期限の仕組みは廃止）
    used_date: '',
    compensatory_request_id: '',
    status: LEAVE_STATUS.AVAILABLE,
    created_at: now,
    updated_at: now
  };
  appendRow(SHEET.LEAVES, leave);
  logAction(employeeId, ACTION_TYPE.GRANT_LEAVE, 'leave', leave.leave_id, null, leave);
  return leave;
}

/**
 * 利用可能な代休一覧（本人）。期限切れは除外し、見つけたら status を expired へ更新。
 * 古い代休から使うため昇順ソートして返す。
 */
function listAvailableLeaves(employeeId) {
  // 期限の仕組みは廃止。available の代休をそのまま返す（読み取りのみ＝高速）。
  var valid = findRows(SHEET.LEAVES, function (l) {
    return String(l.employee_id) === String(employeeId) &&
           String(l.status) === LEAVE_STATUS.AVAILABLE;
  }).map(function (r) { return r.data; });
  valid.sort(compareLeaveOldestFirst);
  return valid;
}

/** 代休を「申請中」に（二重申請防止）。available のみ許可。 */
function setLeavePending(leaveId, compRequestId) {
  var leave = getLeaveById(leaveId);
  if (!leave) throw new AppError(ERROR_CODES.NOT_FOUND, '対象の代休が見つかりません。');
  if (String(leave.status) !== LEAVE_STATUS.AVAILABLE) {
    throw new AppError(ERROR_CODES.LEAVE_UNAVAILABLE, 'この代休は利用できません（既に申請中/使用済み）。');
  }
  return updateRowById(SHEET.LEAVES, 'leave_id', leaveId, {
    status: LEAVE_STATUS.PENDING,
    compensatory_request_id: compRequestId,
    updated_at: nowIso()
  });
}

/** 代休を「使用済み」に（承認時）。pending のみ許可。 */
function setLeaveUsed(leaveId, usedDate) {
  var leave = getLeaveById(leaveId);
  if (!leave) throw new AppError(ERROR_CODES.NOT_FOUND, '対象の代休が見つかりません。');
  if (String(leave.status) !== LEAVE_STATUS.PENDING) {
    throw new AppError(ERROR_CODES.INVALID_STATE, '代休の状態が不正です（申請中ではありません）。');
  }
  var after = updateRowById(SHEET.LEAVES, 'leave_id', leaveId, {
    status: LEAVE_STATUS.USED,
    used_date: usedDate,
    updated_at: nowIso()
  });
  logAction(leave.employee_id, ACTION_TYPE.USE_LEAVE, 'leave', leaveId, leave, after);
  return after;
}

/** 却下時：代休を「未使用(available)」へ戻す。pending のみ許可。 */
function revertLeaveToAvailable(leaveId) {
  var leave = getLeaveById(leaveId);
  if (!leave) return null;
  if (String(leave.status) !== LEAVE_STATUS.PENDING) return leave;
  return updateRowById(SHEET.LEAVES, 'leave_id', leaveId, {
    status: LEAVE_STATUS.AVAILABLE,
    compensatory_request_id: '',
    updated_at: nowIso()
  });
}

/** 全代休（管理者用、任意フィルタ） */
function listLeaves(filter) {
  var today = formatDate(new Date());
  var rows = findRows(SHEET.LEAVES, function () { return true; }).map(function (r) { return r.data; });
  if (filter === 'unused') {
    rows = rows.filter(function (l) { return String(l.status) === LEAVE_STATUS.AVAILABLE; });
  } else if (filter === 'expired') {
    // 期限の仕組みは廃止。旧データの EXPIRED のみ表示。
    rows = rows.filter(function (l) { return String(l.status) === LEAVE_STATUS.EXPIRED; });
  }
  return rows;
}

/** 期限の仕組みは廃止したため何もしない（後方互換のため関数は残置）。 */
function expireLeaves() {
  return 0;
}

/** 本人の代休残数 */
function countAvailableLeaves(employeeId) {
  return listAvailableLeaves(employeeId).length;
}

/** 期限の仕組みは廃止（常に0）。 */
function countLeavesExpiringWithin(employeeId, days) {
  return 0;
}
