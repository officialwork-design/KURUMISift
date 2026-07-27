/**
 * ScheduleService.gs
 * 勤務カレンダーの生成・取得。日本の祝日判定は Google の日本の祝日カレンダーを利用する。
 * 外部APIキーは不要。取得失敗時は土日のみ休日とするフォールバックを行う。
 */

var JP_HOLIDAY_CALENDAR_ID = 'ja.japanese#holiday@group.v.calendar.google.com';
var _holidayCache = {}; // 'yyyy-MM' -> { 'yyyy-MM-dd': true }

/**
 * 指定年月の祝日集合を取得する（キャッシュ）。
 */
function getHolidaysForMonth(year, month) {
  var key = year + '-' + ('0' + month).slice(-2);
  if (_holidayCache[key]) return _holidayCache[key];
  var map = {};
  try {
    var cal = CalendarApp.getCalendarById(JP_HOLIDAY_CALENDAR_ID);
    if (cal) {
      var start = new Date(year, month - 1, 1);
      var end = new Date(year, month, 1);
      var events = cal.getEvents(start, end);
      events.forEach(function (ev) {
        map[formatDate(ev.getStartTime())] = ev.getTitle();
      });
    }
  } catch (e) {
    logError('', 'getHolidaysForMonth', e); // フォールバック（土日のみ）
  }
  _holidayCache[key] = map;
  return map;
}

/** ある日付(ymd)が祝日か */
function isHolidayYmd(ymd) {
  var p = ymd.split('-');
  var map = getHolidaysForMonth(Number(p[0]), Number(p[1]));
  return !!map[ymd];
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

    // 申請中があれば表示上の状態を pending に
    if (pendingByDate[ymd]) {
      day.status = 'pending';
      day.pending_type = pendingByDate[ymd].request_type;
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
