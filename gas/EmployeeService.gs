/**
 * EmployeeService.gs
 * 社員マスターに関する操作。
 */

/** LINEユーザーIDで社員検索（無ければ null） */
function findEmployeeByLineUserId(lineUserId) {
  if (!lineUserId) return null;
  var row = findOne(SHEET.EMPLOYEES, { line_user_id: lineUserId });
  return row ? row.data : null;
}

/** 社員IDで検索（無ければ null） */
function findEmployeeById(employeeId) {
  if (!employeeId) return null;
  var row = findOne(SHEET.EMPLOYEES, { employee_id: employeeId });
  return row ? row.data : null;
}

/**
 * 初回社員登録。
 * @param profile {lineUserId, displayName, pictureUrl}（IDトークン検証済み）
 * @param realName 本名（生入力）
 */
function registerEmployee(profile, realName) {
  // 重複登録禁止
  if (findEmployeeByLineUserId(profile.lineUserId)) {
    throw new AppError(ERROR_CODES.ALREADY_REGISTERED, 'この LINE アカウントは既に登録済みです。');
  }
  var v = validateName(realName);
  if (!v.ok) throw new AppError(ERROR_CODES.VALIDATION, v.message);

  // 初期管理者判定：スクリプトプロパティの LINEユーザーID と一致すれば admin
  var initialAdmin = getProp(PROP.INITIAL_ADMIN_LINE_USER_ID);
  var role = (initialAdmin && initialAdmin === profile.lineUserId) ? ROLE.ADMIN : ROLE.EMPLOYEE;

  var now = nowIso();
  var emp = {
    employee_id: uuid(),
    line_user_id: profile.lineUserId,
    line_display_name: profile.displayName || '',
    line_picture_url: profile.pictureUrl || '',
    real_name: v.value,
    department: '',
    role: role,
    status: EMP_STATUS.ACTIVE,
    created_at: now,
    updated_at: now,
    last_login_at: now,
    paid_leave_balance: 0
  };
  appendRow(SHEET.EMPLOYEES, emp);
  logAction(emp.employee_id, ACTION_TYPE.REGISTER_EMPLOYEE, 'employee', emp.employee_id, null, emp);
  return emp;
}

/** 最終ログイン日時更新（失敗しても致命的ではない） */
function touchLastLogin(employeeId) {
  try {
    updateRowById(SHEET.EMPLOYEES, 'employee_id', employeeId, { last_login_at: nowIso() });
  } catch (e) {
    logError(employeeId, 'touchLastLogin', e);
  }
}

/** 社員一覧（管理者用） */
function listEmployees() {
  return findRows(SHEET.EMPLOYEES, function () { return true; }).map(function (r) { return r.data; });
}

/** 社員情報更新（管理者用）。real_name もここでのみ変更可。 */
function adminUpdateEmployee(employeeId, patch) {
  var allowed = ['real_name', 'department', 'role', 'status', 'paid_leave_balance'];
  var clean = {};
  allowed.forEach(function (k) {
    if (patch[k] !== undefined) clean[k] = patch[k];
  });
  if (clean.paid_leave_balance !== undefined) {
    var pv = Number(clean.paid_leave_balance);
    if (isNaN(pv) || pv < 0) throw new AppError(ERROR_CODES.VALIDATION, '有給残日数は0以上の数値で入力してください。');
    clean.paid_leave_balance = pv;
  }
  if (clean.real_name !== undefined) {
    var v = validateName(clean.real_name);
    if (!v.ok) throw new AppError(ERROR_CODES.VALIDATION, v.message);
    clean.real_name = v.value;
  }
  if (clean.role !== undefined && [ROLE.EMPLOYEE, ROLE.ADMIN].indexOf(clean.role) === -1) {
    throw new AppError(ERROR_CODES.VALIDATION, 'role の値が不正です。');
  }
  if (clean.status !== undefined &&
      [EMP_STATUS.ACTIVE, EMP_STATUS.SUSPENDED, EMP_STATUS.RETIRED].indexOf(clean.status) === -1) {
    throw new AppError(ERROR_CODES.VALIDATION, 'status の値が不正です。');
  }
  var before = findEmployeeById(employeeId);
  if (!before) throw new AppError(ERROR_CODES.NOT_FOUND, '社員が見つかりません。');
  clean.updated_at = nowIso();
  var after = updateRowById(SHEET.EMPLOYEES, 'employee_id', employeeId, clean);
  logAction(null, ACTION_TYPE.UPDATE_EMPLOYEE, 'employee', employeeId, before, after);
  return after;
}

/** 在籍状態の切り替え（管理者用） */
function adminSetEmployeeStatus(employeeId, status) {
  return adminUpdateEmployee(employeeId, { status: status });
}

/** 管理者権限を要求。違反時は FORBIDDEN。 */
function requireAdmin(emp) {
  if (!emp || String(emp.role) !== ROLE.ADMIN) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'この操作を行う権限がありません。');
  }
}

/** 在籍(active)を要求。停止・退職は拒否。 */
function assertActive(emp) {
  if (!emp) throw new AppError(ERROR_CODES.NOT_REGISTERED, '社員登録が必要です。');
  if (String(emp.status) !== EMP_STATUS.ACTIVE) {
    throw new AppError(ERROR_CODES.EMPLOYEE_SUSPENDED, 'アカウントが停止中です。管理者にお問い合わせください。');
  }
}

/** 社員の公開用DTO（本人・管理者どちらにも安全な範囲） */
function employeeDto(emp) {
  if (!emp) return null;
  return {
    employee_id: emp.employee_id,
    real_name: emp.real_name,
    line_display_name: emp.line_display_name,
    line_picture_url: emp.line_picture_url,
    department: emp.department,
    role: emp.role,
    status: emp.status,
    last_login_at: emp.last_login_at,
    paid_leave_balance: Number(emp.paid_leave_balance || 0)
  };
}
