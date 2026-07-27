/**
 * Util.gs
 * 副作用のない純粋関数を集約する（テスト容易性のため）。
 * 日付は Asia/Tokyo・yyyy-MM-dd を基本とする。
 */

/** UUID v4 生成 */
function uuid() {
  return Utilities.getUuid();
}

/** 現在時刻の ISO 8601 文字列 */
function nowIso() {
  return new Date().toISOString();
}

/** Date -> yyyy-MM-dd（タイムゾーン考慮） */
function formatDate(date) {
  return Utilities.formatDate(date, tz(), 'yyyy-MM-dd');
}

/** yyyy-MM-dd 文字列を Date（正午JST）へ。厳密な形式チェック付き。 */
function parseYmd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) {
    throw new AppError(ERROR_CODES.VALIDATION, '日付の形式が正しくありません（yyyy-MM-dd）。');
  }
  var p = s.split('-');
  // 正午にすることでタイムゾーン境界のズレを避ける
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
}

/** 日数加算した yyyy-MM-dd を返す */
function addDaysYmd(ymd, days) {
  var d = parseYmd(ymd);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

/** HH:mm 形式チェック */
function isValidTime(s) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
}

/**
 * 氏名の正規化：前後空白除去 + 連続空白を1つへ。
 * 全角/半角スペースを対象にする。
 */
function normalizeName(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[　\s]+/g, ' ')
    .trim();
}

/** 氏名バリデーション。正常なら {ok:true, value}、異常なら {ok:false, message} */
function validateName(raw) {
  var name = normalizeName(raw);
  if (name.length === 0) {
    return { ok: false, message: '氏名を入力してください。' };
  }
  // サロゲートペアを考慮した文字数カウント
  var len = Array.from(name).length;
  if (len < 2 || len > 50) {
    return { ok: false, message: '氏名は2文字以上50文字以内で入力してください。' };
  }
  return { ok: true, value: name };
}

/**
 * スプレッドシート数式注入対策。
 * = + - @ で始まる文字列の先頭にアポストロフィを付け、数式として解釈させない。
 */
function sanitizeCell(value) {
  if (value === null || value === undefined) return '';
  var s = String(value);
  if (/^[=+\-@]/.test(s)) {
    return "'" + s;
  }
  return s;
}

/** HTMLエスケープ */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 曜日番号(0=日..6=土) -> 3文字略称 */
function weekdayAbbr(dow) {
  return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][dow];
}

/**
 * REGULAR_WORK_DAYS 設定文字列を判定に使うため配列へ。
 * 例: "MON,TUE,WED,THU,FRI" -> ['MON',...]
 */
function parseWorkDays(csv) {
  return String(csv || '')
    .split(',')
    .map(function (x) { return x.trim().toUpperCase(); })
    .filter(function (x) { return x.length > 0; });
}

/**
 * 代休を古い順（work_date昇順、同日ならexpiration_date昇順）に並べる比較関数。
 */
function compareLeaveOldestFirst(a, b) {
  if (a.work_date < b.work_date) return -1;
  if (a.work_date > b.work_date) return 1;
  if (a.expiration_date < b.expiration_date) return -1;
  if (a.expiration_date > b.expiration_date) return 1;
  return 0;
}

/** ある日付(ymd)が期限(ymd)を過ぎているか（today基準、境界含まず＝期限日当日は有効） */
function isExpired(expirationYmd, todayYmd) {
  return todayYmd > expirationYmd;
}
