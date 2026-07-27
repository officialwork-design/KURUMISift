/**
 * Config.gs
 * 秘密情報・設定はスクリプトプロパティから取得する。コードへ直書きしない。
 * 併せて、シートスキーマ・列定義・状態定数・APIアクション名を集中管理する。
 */

/** スクリプトプロパティ名 */
var PROP = {
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  LIFF_ID: 'LIFF_ID',
  LINE_CHANNEL_ID: 'LINE_CHANNEL_ID',
  LINE_CHANNEL_ACCESS_TOKEN: 'LINE_CHANNEL_ACCESS_TOKEN',
  GAS_WEB_APP_URL: 'GAS_WEB_APP_URL',
  INITIAL_ADMIN_LINE_USER_ID: 'INITIAL_ADMIN_LINE_USER_ID',
  APP_ENV: 'APP_ENV'
};

/** 1回の実行内でプロパティをキャッシュ */
var _propCache = null;
function _props() {
  if (!_propCache) {
    _propCache = PropertiesService.getScriptProperties().getProperties() || {};
  }
  return _propCache;
}

/** プロパティ取得（無ければ既定値、既定も無ければ null） */
function getProp(key, defaultValue) {
  var v = _props()[key];
  if (v === undefined || v === null || v === '') {
    return defaultValue === undefined ? null : defaultValue;
  }
  return v;
}

/** 必須プロパティ取得。無ければ例外。 */
function requireProp(key) {
  var v = getProp(key);
  if (v === null) {
    throw new AppError(ERROR_CODES.CONFIG_MISSING, '設定が不足しています: ' + key);
  }
  return v;
}

/** 本番環境か */
function isProd() {
  return getProp(PROP.APP_ENV, 'development') === 'production';
}

/** シート名 */
var SHEET = {
  EMPLOYEES: '社員マスター',
  REQUESTS: '申請一覧',
  LEAVES: '代休台帳',
  SCHEDULE: '勤務カレンダー',
  SETTINGS: '設定',
  LOGS: '操作ログ'
};

/**
 * シートスキーマ。列順はここで固定する。
 * 各サービスは列番号をハードコードせず、ヘッダー名から解決すること。
 */
var SCHEMA = {};
SCHEMA[SHEET.EMPLOYEES] = [
  'employee_id', 'line_user_id', 'line_display_name', 'line_picture_url',
  'real_name', 'department', 'role', 'status',
  'created_at', 'updated_at', 'last_login_at'
];
SCHEMA[SHEET.REQUESTS] = [
  'request_id', 'employee_id', 'request_type', 'target_date',
  'start_time', 'end_time', 'reason', 'preferred_compensatory_date',
  'selected_leave_id', 'remarks', 'status', 'rejection_reason',
  'approved_by', 'requested_at', 'approved_at', 'updated_at'
];
SCHEMA[SHEET.LEAVES] = [
  'leave_id', 'employee_id', 'holiday_work_request_id', 'work_date',
  'granted_days', 'expiration_date', 'used_date', 'compensatory_request_id',
  'status', 'created_at', 'updated_at'
];
SCHEMA[SHEET.SCHEDULE] = [
  'schedule_id', 'employee_id', 'work_date', 'work_type',
  'start_time', 'end_time', 'request_id', 'remarks',
  'created_at', 'updated_at'
];
SCHEMA[SHEET.SETTINGS] = [
  'setting_key', 'setting_value', 'description', 'updated_at'
];
SCHEMA[SHEET.LOGS] = [
  'log_id', 'actor_employee_id', 'action_type', 'target_type',
  'target_id', 'before_data', 'after_data', 'created_at'
];

/** 設定シート初期値 */
var SETTINGS_DEFAULTS = [
  ['REGULAR_WORK_DAYS', 'MON,TUE,WED,THU,FRI', '通常勤務曜日'],
  ['REGULAR_START_TIME', '10:00', '通常勤務開始時刻'],
  ['REGULAR_END_TIME', '19:00', '通常勤務終了時刻'],
  ['COMP_LEAVE_EXPIRY_DAYS', '60', '代休有効期限（休日出勤日からの日数）'],
  ['TIMEZONE', 'Asia/Tokyo', 'タイムゾーン'],
  ['APP_NAME', 'KURUMI Shift', 'アプリ名'],
  ['AUTO_APPROVE_REQUESTS', 'true', '申請を自動承認して即カレンダー反映するか（true/false）']
];

/** 役割 */
var ROLE = { EMPLOYEE: 'employee', ADMIN: 'admin' };

/** 在籍状態 */
var EMP_STATUS = { ACTIVE: 'active', SUSPENDED: 'suspended', RETIRED: 'retired' };

/** 申請種別 */
var REQUEST_TYPE = { HOLIDAY_WORK: 'holiday_work', COMP_LEAVE: 'compensatory_leave' };

/** 申請状態 */
var REQUEST_STATUS = {
  PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected', CANCELLED: 'cancelled'
};

/** 代休状態 */
var LEAVE_STATUS = {
  AVAILABLE: 'available', PENDING: 'pending', USED: 'used',
  EXPIRED: 'expired', CANCELLED: 'cancelled'
};

/** 勤務区分 */
var WORK_TYPE = {
  REGULAR: 'regular_work', HOLIDAY: 'holiday', HOLIDAY_WORK: 'holiday_work',
  COMP_LEAVE: 'compensatory_leave', PAID_LEAVE: 'paid_leave', ABSENCE: 'absence'
};

/** 操作ログ action_type */
var ACTION_TYPE = {
  REGISTER_EMPLOYEE: 'register_employee',
  UPDATE_EMPLOYEE: 'update_employee',
  CREATE_REQUEST: 'create_request',
  APPROVE_REQUEST: 'approve_request',
  REJECT_REQUEST: 'reject_request',
  GRANT_LEAVE: 'grant_leave',
  USE_LEAVE: 'use_leave',
  EXPIRE_LEAVE: 'expire_leave',
  NOTIFY: 'notify',
  ERROR: 'error'
};

/** APIアクション名（フロントと共有する契約） */
var ACTIONS = {
  // 認証・社員
  BOOTSTRAP: 'bootstrap',                 // ログイン直後のセッション確立
  REGISTER_EMPLOYEE: 'registerEmployee',
  GET_ME: 'getMe',
  // 社員向け
  GET_HOME: 'getHome',
  GET_CALENDAR: 'getCalendar',
  CREATE_HOLIDAY_WORK: 'createHolidayWork',
  CREATE_COMP_LEAVE: 'createCompLeave',
  GET_MY_REQUESTS: 'getMyRequests',
  GET_AVAILABLE_LEAVES: 'getAvailableLeaves',
  // 管理者向け
  ADMIN_LIST_EMPLOYEES: 'adminListEmployees',
  ADMIN_UPDATE_EMPLOYEE: 'adminUpdateEmployee',
  ADMIN_SET_EMPLOYEE_STATUS: 'adminSetEmployeeStatus',
  ADMIN_LIST_REQUESTS: 'adminListRequests',
  ADMIN_APPROVE_REQUEST: 'adminApproveRequest',
  ADMIN_REJECT_REQUEST: 'adminRejectRequest',
  ADMIN_GET_CALENDAR: 'adminGetCalendar',
  ADMIN_LIST_LEAVES: 'adminListLeaves',
  ADMIN_DASHBOARD: 'adminDashboard',
  ADMIN_LIST_LOGS: 'adminListLogs',
  ADMIN_GET_SETTINGS: 'adminGetSettings',
  ADMIN_UPDATE_SETTING: 'adminUpdateSetting'
};

/** エラーコード */
var ERROR_CODES = {
  CONFIG_MISSING: 'CONFIG_MISSING',
  SHEET_MISSING: 'SHEET_MISSING',
  HEADER_MISMATCH: 'HEADER_MISMATCH',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  FORBIDDEN: 'FORBIDDEN',
  NOT_REGISTERED: 'NOT_REGISTERED',
  ALREADY_REGISTERED: 'ALREADY_REGISTERED',
  EMPLOYEE_SUSPENDED: 'EMPLOYEE_SUSPENDED',
  VALIDATION: 'VALIDATION',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  INVALID_STATE: 'INVALID_STATE',
  LEAVE_EXPIRED: 'LEAVE_EXPIRED',
  LEAVE_UNAVAILABLE: 'LEAVE_UNAVAILABLE',
  NOT_FOUND: 'NOT_FOUND',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  INTERNAL: 'INTERNAL'
};

/** アプリ内共通例外 */
function AppError(code, message) {
  this.name = 'AppError';
  this.code = code || ERROR_CODES.INTERNAL;
  this.message = message || '内部エラーが発生しました。';
}
AppError.prototype = Object.create(Error.prototype);

/** タイムゾーン（設定 or 既定） */
function tz() {
  return getProp('TIMEZONE', 'Asia/Tokyo') || 'Asia/Tokyo';
}
