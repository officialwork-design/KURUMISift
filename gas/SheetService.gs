/**
 * SheetService.gs
 * スプレッドシートアクセスの単一窓口。
 * - 列番号はヘッダー名から解決（ハードコード禁止）。
 * - 書き込みは LockService で排他制御。
 * - 1シート単位の読み込み。全シートを毎回読み込まない。
 */

var _ssCache = null;
var _valuesCache = {}; // sheetName -> 2D array（実行内キャッシュ、書込時に破棄）

/** スプレッドシート取得 */
function getSpreadsheet() {
  if (_ssCache) return _ssCache;
  var id = requireProp(PROP.SPREADSHEET_ID);
  try {
    _ssCache = SpreadsheetApp.openById(id);
  } catch (e) {
    throw new AppError(ERROR_CODES.CONFIG_MISSING, 'スプレッドシートを開けません。SPREADSHEET_IDを確認してください。');
  }
  return _ssCache;
}

/** シート取得（存在必須） */
function getSheet(name) {
  var sh = getSpreadsheet().getSheetByName(name);
  if (!sh) {
    throw new AppError(ERROR_CODES.SHEET_MISSING, 'シートが存在しません: ' + name + '。setupSpreadsheet() を実行してください。');
  }
  return sh;
}

/** シート存在確認 */
function sheetExists(name) {
  return !!getSpreadsheet().getSheetByName(name);
}

/** 期待ヘッダー取得 */
function expectedHeaders(name) {
  var h = SCHEMA[name];
  if (!h) throw new AppError(ERROR_CODES.INTERNAL, 'スキーマ未定義: ' + name);
  return h;
}

var _SHEET_CACHE_TTL = 30; // 秒。読み取りI/O削減用。書き込み時は即無効化。

/** シート全値（実行内キャッシュ＋CacheServiceで実行をまたいだ短時間キャッシュ） */
function _readAll(name) {
  if (_valuesCache[name]) return _valuesCache[name];

  // 実行をまたぐキャッシュ（他リクエストの読み取り結果を再利用）
  var cache = CacheService.getScriptCache();
  var ck = 'sheet_' + name;
  var cached = cache.get(ck);
  if (cached) {
    try {
      var v = JSON.parse(cached);
      _valuesCache[name] = v;
      return v;
    } catch (e) { /* 壊れていたら読み直す */ }
  }

  var sh = getSheet(name);
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  var values;
  if (lastRow === 0 || lastCol === 0) {
    values = [];
  } else {
    values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  }
  _valuesCache[name] = values;
  // Date は JSON で ISO 文字列になるが、normalizeCellValue が復元するので問題なし
  try {
    var s = JSON.stringify(values);
    if (s.length < 90000) cache.put(ck, s, _SHEET_CACHE_TTL);
  } catch (e) { /* サイズ超過等は諦める */ }
  return values;
}

function _invalidate(name) {
  delete _valuesCache[name];
  try { CacheService.getScriptCache().remove('sheet_' + name); } catch (e) {}
}

/** 実ヘッダー行（1行目） */
function getHeaders(name) {
  var all = _readAll(name);
  return all.length > 0 ? all[0].map(function (x) { return String(x).trim(); }) : [];
}

/** ヘッダー検証。不足があれば例外。 */
function validateHeaders(name) {
  var exp = expectedHeaders(name);
  var actual = getHeaders(name);
  var missing = exp.filter(function (h) { return actual.indexOf(h) === -1; });
  if (missing.length > 0) {
    throw new AppError(ERROR_CODES.HEADER_MISMATCH,
      'シート「' + name + '」のヘッダーが不足しています: ' + missing.join(', '));
  }
  return true;
}

/** ヘッダー配列から列インデックス(0始まり)を返す */
function colIndex(headers, col) {
  var i = headers.indexOf(col);
  if (i === -1) throw new AppError(ERROR_CODES.HEADER_MISMATCH, '列が見つかりません: ' + col);
  return i;
}

/** 時刻として保持する列（Sheetsが時刻値=Dateにするため読み取り時にHH:mmへ戻す） */
var TIME_COLUMNS = { start_time: true, end_time: true };
/** 日付として保持する列（Sheetsが日付値=Dateにするため読み取り時にyyyy-MM-ddへ戻す） */
var DATE_COLUMNS = {
  target_date: true, work_date: true, expiration_date: true,
  used_date: true, preferred_compensatory_date: true
};

/**
 * Sheetsが日付/時刻に自動変換したDate値、および過去に文字列として保存された
 * ISO日時（例 "1899-12-30T01:00:00.000Z"）を、想定の文字列形式へ正規化する。
 */
function normalizeCellValue(header, v) {
  var isDate = Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());

  if (TIME_COLUMNS[header]) {
    if (isDate) return Utilities.formatDate(v, tz(), 'HH:mm');
    var ts = String(v == null ? '' : v);
    if (ts.indexOf('T') !== -1) { // ISO日時っぽい文字列（過去の不正データ）
      var td = new Date(ts);
      if (!isNaN(td.getTime())) return Utilities.formatDate(td, tz(), 'HH:mm');
    }
    return ts; // 既に "HH:mm" 等
  }

  if (DATE_COLUMNS[header]) {
    if (isDate) return Utilities.formatDate(v, tz(), 'yyyy-MM-dd');
    var ds = String(v == null ? '' : v);
    if (ds.indexOf('T') !== -1) {
      var dd = new Date(ds);
      if (!isNaN(dd.getTime())) return Utilities.formatDate(dd, tz(), 'yyyy-MM-dd');
    }
    return ds;
  }

  if (isDate) return v.toISOString(); // その他のDateはISO文字列に
  return v;
}

/** 行配列 -> オブジェクト（日付/時刻セルを正規化） */
function rowToObject(headers, row) {
  var o = {};
  for (var i = 0; i < headers.length; i++) {
    o[headers[i]] = normalizeCellValue(headers[i], row[i]);
  }
  return o;
}

/**
 * 条件検索。match は {列名:値} の完全一致、または (obj)=>boolean。
 * 返り値は {rowNumber, data} の配列。rowNumber はシート行番号(1始まり)。
 */
function findRows(name, match) {
  var all = _readAll(name);
  if (all.length < 2) return [];
  var headers = all[0].map(function (x) { return String(x).trim(); });
  var out = [];
  for (var r = 1; r < all.length; r++) {
    var obj = rowToObject(headers, all[r]);
    var hit;
    if (typeof match === 'function') {
      hit = match(obj);
    } else {
      hit = Object.keys(match).every(function (k) {
        return String(obj[k]) === String(match[k]);
      });
    }
    if (hit) out.push({ rowNumber: r + 1, data: obj });
  }
  return out;
}

/** 1件検索（無ければ null） */
function findOne(name, match) {
  var rows = findRows(name, match);
  return rows.length ? rows[0] : null;
}

/** オブジェクト -> 行配列（数式注入対策付き） */
function objectToRow(headers, obj) {
  return headers.map(function (h) {
    var v = obj[h];
    return v === undefined || v === null ? '' : sanitizeCell(v);
  });
}

/** 行追加（排他制御）。obj はヘッダー名キー。 */
function appendRow(name, obj) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet(name);
    var headers = getHeaders(name);
    sh.appendRow(objectToRow(headers, obj));
    _invalidate(name);
    return obj;
  } finally {
    lock.releaseLock();
  }
}

/**
 * ID列で1行を更新（排他制御）。
 * patch はヘッダー名キーの部分更新。存在しなければ NOT_FOUND。
 */
function updateRowById(name, idField, idValue, patch) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet(name);
    var headers = getHeaders(name);
    // ロック取得後に最新を読む
    _invalidate(name);
    var row = findOne(name, _kv(idField, idValue));
    if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, '対象データが見つかりません: ' + idValue);
    Object.keys(patch).forEach(function (k) {
      var ci = colIndex(headers, k);
      var v = patch[k];
      sh.getRange(row.rowNumber, ci + 1).setValue(v === undefined || v === null ? '' : sanitizeCell(v));
    });
    _invalidate(name);
    return findOne(name, _kv(idField, idValue)).data;
  } finally {
    lock.releaseLock();
  }
}

function _kv(k, v) { var o = {}; o[k] = v; return o; }

/**
 * 不足シートとヘッダーを作成する。既存データは破壊しない。
 * Setup.setupSpreadsheet() から呼ばれる。
 */
function ensureSheetsAndHeaders() {
  var ss = getSpreadsheet();
  var created = [];
  var fixed = [];
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      created.push(name);
    }
    var headers = SCHEMA[name];
    var firstRow = sh.getLastColumn() > 0
      ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim(); })
      : [];
    var needsHeader = headers.some(function (h, i) { return firstRow[i] !== h; });
    if (needsHeader) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
      fixed.push(name);
    }
  });
  _valuesCache = {};
  return { created: created, headersFixed: fixed };
}

/* ---- 設定シートアクセサ ---- */

var _settingsCache = null;

/** 全設定を {key:value} で取得（キャッシュ付き） */
function getAllSettings() {
  if (_settingsCache) return _settingsCache;
  _settingsCache = {};
  var rows = findRows(SHEET.SETTINGS, function () { return true; });
  rows.forEach(function (r) {
    if (r.data.setting_key) _settingsCache[String(r.data.setting_key)] = r.data.setting_value;
  });
  return _settingsCache;
}

/** 設定値取得（無ければ defaultValue） */
function getSetting(key, defaultValue) {
  var all = getAllSettings();
  var v = all[key];
  return (v === undefined || v === null || v === '') ? defaultValue : v;
}

/** 設定値更新（無ければ追加）。管理者用。 */
function setSetting(key, value, description) {
  var row = findOne(SHEET.SETTINGS, { setting_key: key });
  if (row) {
    updateRowById(SHEET.SETTINGS, 'setting_key', key, {
      setting_value: value, updated_at: nowIso()
    });
  } else {
    appendRow(SHEET.SETTINGS, {
      setting_key: key, setting_value: value,
      description: description || '', updated_at: nowIso()
    });
  }
  _settingsCache = null;
  return { setting_key: key, setting_value: value };
}
