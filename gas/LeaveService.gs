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
  var expiryDays = parseInt(getSetting('COMP_LEAVE_EXPIRY_DAYS', '60'), 10) || 60;
  var now = nowIso();
  var leave = {
    leave_id: uuid(),
    employee_id: employeeId,
    holiday_work_request_id: holidayWorkRequestId,
    work_date: workDate,
    granted_days: 1,
    expiration_date: addDaysYmd(workDate, expiryDays),
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
  var today = formatDate(new Date());
  var rows = findRows(SHEET.LEAVES, function (l) {
    return String(l.employee_id) === String(employeeId) &&
           String(l.status) === LEAVE_STATUS.AVAILABLE;
  }).map(function (r) { return r.data; });

  var valid = [];
  rows.forEach(function (l) {
    if (isExpired(String(l.expiration_date), today)) {
      // 遅延的に期限切れへ更新
      try {
        updateRowById(SHEET.LEAVES, 'leave_id', l.leave_id, { status: LEAVE_STATUS.EXPIRED, updated_at: nowIso() });
        logAction(employeeId, ACTION_TYPE.EXPIRE_LEAVE, 'leave', l.leave_id, l, null);
      } catch (e) { logError(employeeId, 'listAvailableLeaves.expire', e); }
    } else {
      valid.push(l);
    }
  });
  valid.sort(compareLeaveOldestFirst);
  return valid;
}

/** 代休を「申請中」に（二重申請防止）。available のみ許可。 */
function setLeavePending(leaveId, compRequestId) {
  var leave = getLeaveById(leaveId);
  if (!leave) throw new AppError(ERROR_CODES.NOT_FOUND, '対象の代休が見つかりません。');
  if (String(leave.status) !== LEAVE_STATUS.AVAILABLE) {
    throw new AppError(ERROR_CODES.LEAVE_UNAVAILABLE, 'この代休は利用できません（既に申請中/使用済み/期限切れ）。');
  }
  if (isExpired(String(leave.expiration_date), formatDate(new Date()))) {
    updateRowById(SHEET.LEAVES, 'leave_id', leaveId, { status: LEAVE_STATUS.EXPIRED, updated_at: nowIso() });
    throw new AppError(ERROR_CODES.LEAVE_EXPIRED, 'この代休は有効期限を過ぎています。');
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
    rows = rows.filter(function (l) {
      return String(l.status) === LEAVE_STATUS.EXPIRED ||
        (String(l.status) === LEAVE_STATUS.AVAILABLE && isExpired(String(l.expiration_date), today));
    });
  }
  return rows;
}

/** 期限切れ判定バッチ（時間主導トリガー等から利用可）。available で期限超過を expired に。 */
function expireLeaves() {
  var today = formatDate(new Date());
  var rows = findRows(SHEET.LEAVES, function (l) {
    return String(l.status) === LEAVE_STATUS.AVAILABLE;
  });
  var count = 0;
  rows.forEach(function (r) {
    if (isExpired(String(r.data.expiration_date), today)) {
      updateRowById(SHEET.LEAVES, 'leave_id', r.data.leave_id, { status: LEAVE_STATUS.EXPIRED, updated_at: nowIso() });
      logAction(r.data.employee_id, ACTION_TYPE.EXPIRE_LEAVE, 'leave', r.data.leave_id, r.data, null);
      count++;
    }
  });
  return count;
}

/** 本人の代休残数（available かつ未期限） */
function countAvailableLeaves(employeeId) {
  return listAvailableLeaves(employeeId).length;
}

/** 本人の、期限まで days 日以内の available 代休数 */
function countLeavesExpiringWithin(employeeId, days) {
  var today = new Date();
  var limit = formatDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, 12));
  var todayYmd = formatDate(today);
  return listAvailableLeaves(employeeId).filter(function (l) {
    return String(l.expiration_date) >= todayYmd && String(l.expiration_date) <= limit;
  }).length;
}
