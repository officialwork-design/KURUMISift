/**
 * tests/pure.test.js
 * GAS の Util.gs に実装した純粋関数のロジックを Node 上で検証する。
 * GAS 依存（Utilities 等）が無いロジックのみをここに写し、同一挙動を確認する。
 * 実行: `node tests/pure.test.js`
 *
 * 注意: これは Util.gs のロジックの回帰テストです。Util.gs を変更したら
 * こちらの写し（下記）も合わせて更新してください（AGENTS.md 参照）。
 */

/* ---- Util.gs から写したロジック（TZ 非依存部分） ---- */

function normalizeName(raw) {
  return String(raw == null ? '' : raw).replace(/[　\s]+/g, ' ').trim();
}
function validateName(raw) {
  var name = normalizeName(raw);
  if (name.length === 0) return { ok: false, message: '氏名を入力してください。' };
  var len = Array.from(name).length;
  if (len < 2 || len > 50) return { ok: false, message: '2〜50文字' };
  return { ok: true, value: name };
}
function sanitizeCell(value) {
  if (value === null || value === undefined) return '';
  var s = String(value);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function isValidTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || '')); }
function parseYmd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) throw new Error('bad date');
  var p = s.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function addDaysYmd(ymd, days) { var d = parseYmd(ymd); d.setDate(d.getDate() + days); return fmt(d); }
function isExpired(exp, today) { return today > exp; }
function compareLeaveOldestFirst(a, b) {
  if (a.work_date < b.work_date) return -1;
  if (a.work_date > b.work_date) return 1;
  if (a.expiration_date < b.expiration_date) return -1;
  if (a.expiration_date > b.expiration_date) return 1;
  return 0;
}

/* ---- 簡易テストランナー ---- */
var pass = 0, fail = 0;
function eq(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; }
  else { fail++; console.error('FAIL ' + name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL ' + name); } }

/* ---- 氏名 ---- */
eq('normalizeName trims/collapses', normalizeName('  山田　　太郎  '), '山田 太郎');
ok('validateName rejects empty', validateName('   ').ok === false);
ok('validateName rejects 1 char', validateName('あ').ok === false);
ok('validateName accepts 2 chars', validateName('山田').ok === true);
ok('validateName rejects >50', validateName(Array(60).join('あ')).ok === false);

/* ---- 数式注入対策 ---- */
eq('sanitize =', sanitizeCell('=SUM(A1)'), "'=SUM(A1)");
eq('sanitize +', sanitizeCell('+1'), "'+1");
eq('sanitize -', sanitizeCell('-1'), "'-1");
eq('sanitize @', sanitizeCell('@x'), "'@x");
eq('sanitize normal', sanitizeCell('山田 太郎'), '山田 太郎');

/* ---- 時刻 ---- */
ok('time valid 10:00', isValidTime('10:00'));
ok('time valid 23:59', isValidTime('23:59'));
ok('time invalid 24:00', !isValidTime('24:00'));
ok('time invalid 9:0', !isValidTime('9:0'));

/* ---- 日付計算（代休期限60日など） ---- */
eq('addDays +60', addDaysYmd('2026-01-01', 60), '2026-03-02');
eq('addDays notice -14', addDaysYmd('2026-03-02', -14), '2026-02-16');
eq('addDays month boundary', addDaysYmd('2026-01-31', 1), '2026-02-01');

/* ---- 期限切れ判定（当日は有効） ---- */
ok('expired: past', isExpired('2026-01-01', '2026-01-02') === true);
ok('expired: same day valid', isExpired('2026-01-02', '2026-01-02') === false);
ok('expired: future valid', isExpired('2026-02-01', '2026-01-02') === false);

/* ---- 古い代休順ソート ---- */
var leaves = [
  { work_date: '2026-02-10', expiration_date: '2026-04-10' },
  { work_date: '2026-01-05', expiration_date: '2026-03-05' },
  { work_date: '2026-01-05', expiration_date: '2026-03-01' }
];
leaves.sort(compareLeaveOldestFirst);
eq('oldest first: first date', leaves[0].work_date, '2026-01-05');
eq('oldest first: tie by expiry', leaves[0].expiration_date, '2026-03-01');

/* ---- 結果 ---- */
console.log('\n=== pure.test.js: ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail === 0 ? 0 : 1);
