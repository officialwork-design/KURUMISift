/**
 * Api.gs
 * JSON APIルーター。リクエスト/レスポンス形式を統一する。
 * 認証は LIFF IDトークンの検証で行い、クライアントの line_user_id を無検証で信用しない。
 * 権限・状態の最終検証は必ずここ（GAS側）で行う。
 */

/** 成功レスポンス */
function apiOk(data) {
  return { success: true, data: data === undefined ? {} : data, error: null };
}

/** エラーレスポンス */
function apiErr(code, message) {
  return { success: false, data: null, error: { code: code, message: message } };
}

/**
 * リクエストを解釈して {action, idToken, payload} を返す。
 * POST(JSON, text/plain) を主とし、GET パラメータもフォールバックで受ける。
 */
function parseRequest(e) {
  var body = {};
  if (e && e.postData && e.postData.contents) {
    try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
  }
  var p = (e && e.parameter) ? e.parameter : {};
  return {
    action: body.action || p.action || '',
    accessToken: body.accessToken || p.accessToken || '',
    idToken: body.idToken || p.idToken || '',
    payload: body.payload || {}
  };
}

/**
 * セッション確立。IDトークンを検証し、プロフィールと社員レコードを返す。
 * employee は未登録なら null。
 */
function buildSession(req) {
  // アクセストークン優先（自動更新で失効しにくい）。無ければ IDトークンにフォールバック。
  var profile = req.accessToken
    ? verifyAccessToken(req.accessToken)
    : verifyIdToken(req.idToken);
  var employee = findEmployeeByLineUserId(profile.lineUserId);
  return { profile: profile, employee: employee };
}

/** 登録済み & 在籍中を要求し、last_login を更新して employee を返す */
function requireActiveEmployee(session) {
  if (!session.employee) throw new AppError(ERROR_CODES.NOT_REGISTERED, '社員登録が必要です。');
  assertActive(session.employee);
  touchLastLogin(session.employee.employee_id);
  return session.employee;
}

/**
 * メインディスパッチ。action ごとに処理を振り分ける。
 */
function dispatch(req) {
  var A = ACTIONS;
  var action = req.action;

  // --- 認証を伴う全アクションでトークン検証 ---
  var session = buildSession(req);
  var payload = req.payload || {};

  switch (action) {
    // セッション確立：登録有無を返す。登録済み＆在籍中ならホーム＋当月カレンダーも同梱（往復1回で完結）
    case A.BOOTSTRAP: {
      var e = session.employee;
      var active = e ? String(e.status) === EMP_STATUS.ACTIVE : false;
      var resp = {
        registered: !!e,
        active: active,
        employee: e ? employeeDto(e) : null,
        profile: { displayName: session.profile.displayName, pictureUrl: session.profile.pictureUrl }
      };
      if (e && active) {
        touchLastLogin(e.employee_id);
        var bnow = new Date();
        resp.home = buildHome(e);
        resp.calendar = getMonthlySchedule(e.employee_id, bnow.getFullYear(), bnow.getMonth() + 1);
      }
      return apiOk(resp);
    }

    // 初回登録
    case A.REGISTER_EMPLOYEE: {
      var emp = registerEmployee(session.profile, payload.real_name);
      return apiOk({ employee: employeeDto(emp) });
    }

    case A.GET_ME: {
      var me = requireActiveEmployee(session);
      return apiOk({ employee: employeeDto(me) });
    }

    // --- 社員向け ---
    case A.GET_HOME: {
      var meH = requireActiveEmployee(session);
      return apiOk(buildHome(meH));
    }
    case A.GET_CALENDAR: {
      var meC = requireActiveEmployee(session);
      var y = parseInt(payload.year, 10), m = parseInt(payload.month, 10);
      return apiOk(getMonthlySchedule(meC.employee_id, y, m));
    }
    // ホーム集計 + 指定月カレンダーを1回のリクエストで返す（往復と認証コストを削減）
    case A.GET_HOME_CALENDAR: {
      var meHC = requireActiveEmployee(session);
      var now = new Date();
      var hcY = parseInt(payload.year, 10) || now.getFullYear();
      var hcM = parseInt(payload.month, 10) || (now.getMonth() + 1);
      return apiOk({
        home: buildHome(meHC),
        calendar: getMonthlySchedule(meHC.employee_id, hcY, hcM)
      });
    }
    case A.CREATE_HOLIDAY_WORK: {
      var meHW = requireActiveEmployee(session);
      return apiOk({ request: createHolidayWorkRequest(meHW, payload) });
    }
    case A.CREATE_COMP_LEAVE: {
      var meCL = requireActiveEmployee(session);
      return apiOk({ request: createCompLeaveRequest(meCL, payload) });
    }
    case A.GET_MY_REQUESTS: {
      var meR = requireActiveEmployee(session);
      return apiOk({ requests: listMyRequests(meR.employee_id, payload.status || 'all') });
    }
    case A.GET_AVAILABLE_LEAVES: {
      var meL = requireActiveEmployee(session);
      return apiOk({ leaves: listAvailableLeaves(meL.employee_id) });
    }

    // --- 管理者向け ---
    case A.ADMIN_LIST_EMPLOYEES: {
      var adm1 = requireActiveEmployee(session); requireAdmin(adm1);
      return apiOk({ employees: listEmployees() });
    }
    case A.ADMIN_UPDATE_EMPLOYEE: {
      var adm2 = requireActiveEmployee(session); requireAdmin(adm2);
      return apiOk({ employee: adminUpdateEmployee(payload.employee_id, payload.patch || {}) });
    }
    case A.ADMIN_SET_EMPLOYEE_STATUS: {
      var adm3 = requireActiveEmployee(session); requireAdmin(adm3);
      return apiOk({ employee: adminSetEmployeeStatus(payload.employee_id, payload.status) });
    }
    case A.ADMIN_LIST_REQUESTS: {
      var adm4 = requireActiveEmployee(session); requireAdmin(adm4);
      return apiOk({ requests: enrichRequests(listAllRequests(payload.status || 'all')) });
    }
    case A.ADMIN_APPROVE_REQUEST: {
      var adm5 = requireActiveEmployee(session); requireAdmin(adm5);
      return apiOk({ request: approveRequest(adm5, payload.request_id) });
    }
    case A.ADMIN_REJECT_REQUEST: {
      var adm6 = requireActiveEmployee(session); requireAdmin(adm6);
      return apiOk({ request: rejectRequest(adm6, payload.request_id, payload.reason) });
    }
    case A.ADMIN_GET_CALENDAR: {
      var adm7 = requireActiveEmployee(session); requireAdmin(adm7);
      return apiOk(getMonthlySchedule(payload.employee_id, parseInt(payload.year, 10), parseInt(payload.month, 10)));
    }
    case A.ADMIN_LIST_LEAVES: {
      var adm8 = requireActiveEmployee(session); requireAdmin(adm8);
      return apiOk({ leaves: listLeaves(payload.filter || 'all') });
    }
    case A.ADMIN_DASHBOARD: {
      var adm9 = requireActiveEmployee(session); requireAdmin(adm9);
      return apiOk(buildAdminDashboard());
    }
    case A.ADMIN_LIST_LOGS: {
      var adm10 = requireActiveEmployee(session); requireAdmin(adm10);
      return apiOk({ logs: listLogs(parseInt(payload.limit, 10) || 200) });
    }
    case A.ADMIN_GET_SETTINGS: {
      var adm11 = requireActiveEmployee(session); requireAdmin(adm11);
      return apiOk({ settings: getAllSettings() });
    }
    case A.ADMIN_UPDATE_SETTING: {
      var adm12 = requireActiveEmployee(session); requireAdmin(adm12);
      return apiOk({ setting: setSetting(payload.key, payload.value) });
    }

    default:
      throw new AppError(ERROR_CODES.UNKNOWN_ACTION, '未定義のアクションです: ' + action);
  }
}

/** ホーム画面用の集計（代休一覧は1回だけ読む） */
function buildHome(emp) {
  var now = new Date();
  var y = now.getFullYear(), m = now.getMonth() + 1;
  var s = summarizeMonth(emp.employee_id, y, m);
  var avail = listAvailableLeaves(emp.employee_id);
  return {
    employee: employeeDto(emp),
    year: y, month: m,
    regularWorkDays: s.regularWorkDays,
    holidayWorkDays: s.holidayWorkDays,
    availableLeaves: avail.length,
    paidLeaveBalance: Number(emp.paid_leave_balance || 0),
    leavesExpiringSoon: 0 // 期限の仕組みは廃止
  };
}

/** 管理者ダッシュボード集計 */
function buildAdminDashboard() {
  var today = formatDate(new Date());
  var todaySched = findRows(SHEET.SCHEDULE, function (s) { return String(s.work_date) === today; })
    .map(function (r) { return r.data; });
  var attending = todaySched.filter(function (s) {
    return s.work_type === WORK_TYPE.REGULAR || s.work_type === WORK_TYPE.HOLIDAY_WORK;
  }).length;
  var offToday = todaySched.filter(function (s) {
    return s.work_type === WORK_TYPE.COMP_LEAVE || s.work_type === WORK_TYPE.PAID_LEAVE;
  }).length;

  var allLeaves = findRows(SHEET.LEAVES, function () { return true; }).map(function (r) { return r.data; });
  var unused = allLeaves.filter(function (l) { return String(l.status) === LEAVE_STATUS.AVAILABLE; });
  // 期限の仕組みは廃止。期限間近は0、期限切れは過去の(旧)EXPIREDのみ集計。
  var expired = allLeaves.filter(function (l) { return String(l.status) === LEAVE_STATUS.EXPIRED; }).length;

  return {
    todayAttending: attending,
    todayOff: offToday,
    pendingRequests: listAllRequests(REQUEST_STATUS.PENDING).length,
    unusedLeaves: unused.length,
    leavesExpiringWithin7: 0,
    expiredLeaves: expired
  };
}

/** 管理者用申請一覧に社員名を付与 */
function enrichRequests(requests) {
  return requests.map(function (r) {
    var emp = findEmployeeById(r.employee_id);
    r.employee_name = emp ? emp.real_name : '(不明)';
    return r;
  });
}
