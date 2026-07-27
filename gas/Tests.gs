/**
 * Tests.gs
 * GASエディタから runAllTests() を実行して結果を Logger で確認する。
 * 純粋関数（Util）の単体テストを中心に構成。
 * シートを伴う結合テストは、テスト用スプレッドシートで別途行うこと。
 */

function runAllTests() {
  var results = [];
  function assert(name, cond) { results.push({ name: name, pass: !!cond }); }
  function eq(name, a, b) { results.push({ name: name, pass: a === b, got: a, want: b }); }

  // normalizeName
  eq('normalizeName trims', normalizeName('  山田 太郎  '), '山田 太郎');
  eq('normalizeName collapses spaces', normalizeName('山田　　太郎'), '山田 太郎');

  // validateName
  assert('validateName rejects empty', validateName('   ').ok === false);
  assert('validateName rejects 1 char', validateName('あ').ok === false);
  assert('validateName accepts normal', validateName('山田 太郎').ok === true);
  assert('validateName rejects >50', validateName(new Array(60).join('あ')).ok === false);

  // sanitizeCell
  eq('sanitizeCell escapes =', sanitizeCell('=1+1'), "'=1+1");
  eq('sanitizeCell escapes @', sanitizeCell('@cmd'), "'@cmd");
  eq('sanitizeCell keeps normal', sanitizeCell('山田'), '山田');

  // isValidTime
  assert('time 10:00 valid', isValidTime('10:00') === true);
  assert('time 25:00 invalid', isValidTime('25:00') === false);

  // addDaysYmd
  eq('addDaysYmd +60', addDaysYmd('2026-01-01', 60), '2026-03-02');
  eq('addDaysYmd -7', addDaysYmd('2026-03-02', -7), '2026-02-23');

  // isExpired
  assert('isExpired past', isExpired('2026-01-01', '2026-01-02') === true);
  assert('isExpired sameday not expired', isExpired('2026-01-02', '2026-01-02') === false);

  // compareLeaveOldestFirst
  var arr = [
    { work_date: '2026-02-10', expiration_date: '2026-04-10' },
    { work_date: '2026-01-05', expiration_date: '2026-03-05' }
  ];
  arr.sort(compareLeaveOldestFirst);
  eq('oldest first sort', arr[0].work_date, '2026-01-05');

  // 結果集計
  var passed = results.filter(function (r) { return r.pass; }).length;
  Logger.log('TESTS: ' + passed + '/' + results.length + ' passed');
  results.forEach(function (r) {
    if (!r.pass) Logger.log('FAIL: ' + r.name + ' got=' + r.got + ' want=' + r.want);
  });
  return { passed: passed, total: results.length, results: results };
}
