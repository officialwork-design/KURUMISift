/**
 * ScheduleService.gs
 * 勤務カレンダーの生成・取得。
 * 日本の祝日は法令ルールで算出する（国民の祝日・振替休日・国民の休日）。
 * 七夕・節分などの「年中行事」は祝日ではないため含めない。外部API/カレンダー依存なし。
 * 算出式は概ね 1980〜2099 年に有効。
 */

var _holidayCache = {}; // year -> { 'yyyy-MM-dd': '祝日名' }

function _pad2(n) { return (n < 10 ? '0' : '') + n; }
function _mkYmd(y, m, d) { return y + '-' + _pad2(m) + '-' + _pad2(d); }

/** 指定年月の第n月曜の「日」を返す */
function _nthMonday(year, month, n) {
  var dow = new Date(year, month - 1, 1).getDay(); // 0=日..6=土
  var firstMonday = 1 + ((8 - dow) % 7);
  return firstMonday + (n - 1) * 7;
}

/** 春分の日（日） */
function _shunbunDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
/** 秋分の日（日） */
function _shubunDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/** その年の「国民の祝日」（固定日・ハッピーマンデー・春分/秋分）を map で返す */
function _baseHolidays(year) {
  var h = {};
  function set(m, d, name) { h[_mkYmd(year, m, d)] = name; }
  set(1, 1, '元日');
  set(1, _nthMonday(year, 1, 2), '成人の日');
  set(2, 11, '建国記念の日');
  set(2, 23, '天皇誕生日'); // 2020年以降
  set(3, _shunbunDay(year), '春分の日');
  set(4, 29, '昭和の日');
  set(5, 3, '憲法記念日');
  set(5, 4, 'みどりの日');
  set(5, 5, 'こどもの日');
  set(7, _nthMonday(year, 7, 3), '海の日');
  set(8, 11, '山の日'); // 2016年以降
  set(9, _nthMonday(year, 9, 3), '敬老の日');
  set(9, _shubunDay(year), '秋分の日');
  set(10, _nthMonday(year, 10, 2), 'スポーツの日');
  set(11, 3, '文化の日');
  set(11, 23, '勤労感謝の日');
  return h;
}

/**
 * その年の全休日 map（国民の祝日 + 振替休日 + 国民の休日）を返す（キャッシュ）。
 */
function getYearHolidays(year) {
  if (_holidayCache[year]) return _holidayCache[year];
  var base = _baseHolidays(year);
  var result = {};
  Object.keys(base).forEach(function (k) { result[k] = base[k]; });

  var oneDay = 24 * 60 * 60 * 1000;

  // 振替休日：国民の祝日が日曜なら、その後の「祝日でない日」を振替休日にする（2007年以降ルール）
  Object.keys(base).forEach(function (k) {
    var p = k.split('-');
    var dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (dt.getDay() === 0) { // 日曜
      var cur = new Date(dt.getTime() + oneDay);
      while (base[_mkYmd(cur.getFullYear(), cur.getMonth() + 1, cur.getDate())]) {
        cur = new Date(cur.getTime() + oneDay);
      }
      var key = _mkYmd(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
      if (!result[key]) result[key] = '振替休日';
    }
  });

  // 国民の休日：前日・翌日が国民の祝日で、自身が祝日でない日を休日にする
  Object.keys(base).forEach(function (k) {
    var p = k.split('-');
    var dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var next2 = new Date(dt.getTime() + 2 * oneDay);
    var mid = new Date(dt.getTime() + oneDay);
    var midKey = _mkYmd(mid.getFullYear(), mid.getMonth() + 1, mid.getDate());
    var next2Key = _mkYmd(next2.getFullYear(), next2.getMonth() + 1, next2.getDate());
    if (base[next2Key] && !base[midKey] && !result[midKey]) {
      result[midKey] = '国民の休日';
    }
  });

  _holidayCache[year] = result;
  return result;
}

/**
 * 指定年月の祝日集合 { 'yyyy-MM-dd': '祝日名' } を返す。
 */
function getHolidaysForMonth(year, month) {
  var all = getYearHolidays(year);
  var prefix = year + '-' + _pad2(month);
  var map = {};
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(prefix) === 0) map[k] = all[k];
  });
  return map;
}

/** ある日付(ymd)が祝日か */
function isHolidayYmd(ymd) {
  var p = ymd.split('-');
  return !!getYearHolidays(Number(p[0]))[ymd];
}

/** 曜日から通常勤務日か（設定の REGULAR_WORK_DAYS を使用） */
function isRegularWorkDay(ymd) {
  var workDays = parseWorkDays(getSetting('REGULAR_WORK_DAYS', 'MON,TUE,WED,THU,FRI'));
  var d = parseYmd(ymd);
  return workDays.indexOf(weekdayAbbr(d.getDay())) !== -1;
}

/**
 * 勤務カレンダーへ1件登録。同一 request_id の重複登録は防止する。
 */
function addScheduleEntry(employeeId, workDate, workType, startTime, endTime, requestId, remarks) {
  if (requestId) {
    var existing = findOne(SHEET.SCHEDULE, { request_id: requestId });
    if (existing) return existing.data;
  }
  var now = nowIso();
  var entry = {
    schedule_id: uuid(),
    employee_id: employeeId,
    work_date: workDate,
    work_type: workType,
    start_time: startTime || '',
    end_time: endTime || '',
    request_id: requestId || '',
    remarks: remarks || '',
    created_at: now,
    updated_at: now
  };
  appendRow(SHEET.SCHEDULE, entry);
  return entry;
}

/**
 * 月間勤務予定を返す。
 * ベース（通常勤務/休日）を算出し、勤務カレンダーの明示エントリと申請中を重ねる。
 * @return {days:[{date, work_type, start_time, end_time, status, remarks, holiday_name}], ...}
 */
function getMonthlySchedule(employeeId, year, month) {
  var startTimeDef = getSetting('REGULAR_START_TIME', '10:00');
  var endTimeDef = getSetting('REGULAR_END_TIME', '19:00');
  var holidayMap = getHolidaysForMonth(year, month);
  var daysInMonth = new Date(year, month, 0).getDate();

  // 明示的な勤務エントリ
  var prefix = year + '-' + ('0' + month).slice(-2);
  var entries = findRows(SHEET.SCHEDULE, function (s) {
    return String(s.employee_id) === String(employeeId) &&
      String(s.work_date).indexOf(prefix) === 0;
  }).map(function (r) { return r.data; });
  var entryByDate = {};
  entries.forEach(function (e) { entryByDate[e.work_date] = e; });

  // 申請中（この月が対象日のもの）
  var pending = findRows(SHEET.REQUESTS, function (r) {
    return String(r.employee_id) === String(employeeId) &&
      String(r.status) === REQUEST_STATUS.PENDING &&
      String(r.target_date).indexOf(prefix) === 0;
  }).map(function (r) { return r.data; });
  var pendingByDate = {};
  pending.forEach(function (p) { pendingByDate[p.target_date] = p; });

  var days = [];
  for (var d = 1; d <= daysInMonth; d++) {
    var ymd = prefix + '-' + ('0' + d).slice(-2);
    var dow = new Date(year, month - 1, d).getDay();
    var isWeekend = (dow === 0 || dow === 6);
    var holidayName = holidayMap[ymd] || '';
    var isHol = isWeekend || !!holidayName || !isRegularWorkDay(ymd);

    var day = {
      date: ymd,
      work_type: isHol ? WORK_TYPE.HOLIDAY : WORK_TYPE.REGULAR,
      start_time: isHol ? '' : startTimeDef,
      end_time: isHol ? '' : endTimeDef,
      status: 'confirmed',
      remarks: '',
      holiday_name: holidayName
    };

    // 明示エントリで上書き（承認済みの休日出勤/代休など）
    if (entryByDate[ymd]) {
      var e = entryByDate[ymd];
      day.work_type = e.work_type;
      day.start_time = e.start_time;
      day.end_time = e.end_time;
      day.remarks = e.remarks;
      day.status = 'confirmed';
    }

    // 申請中があれば、承認前でも申請内容をカレンダーへ反映する（種別つき・状態は申請中）
    if (pendingByDate[ymd]) {
      var pr = pendingByDate[ymd];
      day.status = 'pending';
      day.pending_type = pr.request_type;
      if (String(pr.request_type) === REQUEST_TYPE.HOLIDAY_WORK) {
        day.work_type = WORK_TYPE.HOLIDAY_WORK;
        day.start_time = pr.start_time || '';
        day.end_time = pr.end_time || '';
      } else if (String(pr.request_type) === REQUEST_TYPE.COMP_LEAVE) {
        day.work_type = WORK_TYPE.COMP_LEAVE;
        day.start_time = '';
        day.end_time = '';
      }
      if (pr.remarks) day.remarks = pr.remarks;
    }

    days.push(day);
  }

  return { year: year, month: month, days: days };
}

/** 今月の通常勤務日数・休日出勤日数を集計（ホーム表示用） */
function summarizeMonth(employeeId, year, month) {
  var sched = getMonthlySchedule(employeeId, year, month);
  var regular = 0, holidayWork = 0;
  sched.days.forEach(function (d) {
    if (d.work_type === WORK_TYPE.REGULAR) regular++;
    if (d.work_type === WORK_TYPE.HOLIDAY_WORK) holidayWork++;
  });
  return { regularWorkDays: regular, holidayWorkDays: holidayWork };
}
