/**
 * admin/js/admin.js
 * 管理者画面のUIと操作。承認・却下の二重送信を防止する。
 */
(function () {
  var main = function () { return document.getElementById('admin-main'); };

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toast(msg, err) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast show' + (err ? ' error' : '');
    setTimeout(function () { t.className = 'toast'; }, 3200);
  }
  function fail(e) {
    main().innerHTML = '<div class="panel"><h2>エラー</h2><p class="muted">' + esc(e.message) +
      '</p><button class="btn" onclick="location.reload()">再読み込み</button></div>';
  }

  var STATUS_LABEL = { pending: '申請中', approved: '承認済み', rejected: '却下', cancelled: '取消' };
  var TYPE_LABEL = { holiday_work: '休日出勤', compensatory_leave: '代休' };
  var LEAVE_LABEL = { available: '未使用', pending: '申請中', used: '使用済み', expired: '期限切れ', cancelled: '取消' };
  var EMP_STATUS_LABEL = { active: '有効', suspended: '停止', retired: '退職' };

  /* ---- 起動 ---- */
  function boot() {
    AdminApi.init()
      .then(function () { return AdminApi.call('bootstrap', {}, { silent: true }); })
      .then(function (data) {
        if (!data.registered) { throw new Error('社員登録が必要です。まず社員用画面から登録してください。'); }
        if (!data.employee || data.employee.role !== 'admin') {
          throw new Error('管理者権限がありません。');
        }
        document.getElementById('admin-name').textContent = data.employee.real_name + ' さん';
        document.getElementById('tabs').style.display = 'flex';
        wireTabs();
        AdminApi.setLoading(false);
        showDashboard();
      })
      .catch(function (e) { AdminApi.setLoading(false); fail(e); });
  }

  function wireTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('.atab'), function (t) {
      t.addEventListener('click', function () {
        document.querySelectorAll('.atab').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        var tab = t.getAttribute('data-tab');
        ({ dashboard: showDashboard, requests: showRequests, employees: showEmployees,
           leaves: showLeaves, settings: showSettings, logs: showLogs }[tab])();
      });
    });
  }

  /* ---- ダッシュボード ---- */
  function showDashboard() {
    AdminApi.call('adminDashboard', {}).then(function (d) {
      main().innerHTML = '<div class="panel"><h2>ダッシュボード</h2><div class="metric-grid">' +
        metric('本日の出勤予定者数', d.todayAttending) +
        metric('本日の休暇者数', d.todayOff) +
        metric('未承認申請数', d.pendingRequests, d.pendingRequests > 0) +
        metric('未取得代休数', d.unusedLeaves) +
        metric('期限7日以内の代休', d.leavesExpiringWithin7, d.leavesExpiringWithin7 > 0) +
        metric('期限切れ代休', d.expiredLeaves, d.expiredLeaves > 0) +
        '</div></div>';
    }).catch(fail);
  }
  function metric(cap, val, warn) {
    return '<div class="metric' + (warn ? ' warn' : '') + '"><span class="m-val">' + esc(val) +
      '</span><span class="m-cap">' + esc(cap) + '</span></div>';
  }

  /* ---- 申請一覧 ---- */
  var reqFilter = 'pending';
  function showRequests() {
    AdminApi.call('adminListRequests', { status: reqFilter }).then(function (data) {
      var filters = [['pending', '未承認'], ['all', '全件'], ['approved', '承認済み'], ['rejected', '却下']];
      var tabs = filters.map(function (f) {
        return '<button class="chip' + (f[0] === reqFilter ? ' active' : '') + '" data-f="' + f[0] + '">' + f[1] + '</button>';
      }).join('');
      var rows = data.requests.map(function (r) {
        var actions = r.status === 'pending'
          ? '<button class="btn sm ok" data-approve="' + esc(r.request_id) + '">承認</button>' +
            '<button class="btn sm no" data-reject="' + esc(r.request_id) + '">却下</button>'
          : '<span class="muted">—</span>';
        return '<tr>' +
          '<td>' + esc((r.requested_at || '').slice(0, 10)) + '</td>' +
          '<td>' + esc(r.employee_name) + '</td>' +
          '<td>' + esc(TYPE_LABEL[r.request_type] || r.request_type) + '</td>' +
          '<td>' + esc(r.target_date) + (r.start_time ? '<br><span class="muted small">' + esc(r.start_time) + '〜' + esc(r.end_time) + '</span>' : '') + '</td>' +
          '<td><span class="pill st-' + esc(r.status) + '">' + esc(STATUS_LABEL[r.status] || r.status) + '</span></td>' +
          '<td class="detail">' + esc(r.reason || r.remarks || '') + (r.rejection_reason ? '<br><span class="reject">却下:' + esc(r.rejection_reason) + '</span>' : '') + '</td>' +
          '<td class="act">' + actions + '</td>' +
          '</tr>';
      }).join('');
      main().innerHTML = '<div class="panel"><h2>申請一覧</h2><div class="chips">' + tabs + '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>申請日</th><th>社員名</th><th>種別</th><th>対象日</th><th>状態</th><th>詳細</th><th>操作</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="7" class="muted center">申請はありません。</td></tr>') + '</tbody></table></div></div>';

      document.querySelectorAll('.chip').forEach(function (c) {
        c.addEventListener('click', function () { reqFilter = c.getAttribute('data-f'); showRequests(); });
      });
      document.querySelectorAll('[data-approve]').forEach(function (b) {
        b.addEventListener('click', function () { doApprove(b, b.getAttribute('data-approve')); });
      });
      document.querySelectorAll('[data-reject]').forEach(function (b) {
        b.addEventListener('click', function () { doReject(b, b.getAttribute('data-reject')); });
      });
    }).catch(fail);
  }

  function doApprove(btn, id) {
    if (btn.disabled) return;
    btn.disabled = true; // 二重送信防止
    AdminApi.call('adminApproveRequest', { request_id: id })
      .then(function () { toast('承認しました。'); showRequests(); })
      .catch(function (e) { btn.disabled = false; toast(e.message, true); });
  }
  function doReject(btn, id) {
    if (btn.disabled) return;
    var reason = window.prompt('却下理由を入力してください（任意）:', '');
    if (reason === null) return; // キャンセル
    btn.disabled = true;
    AdminApi.call('adminRejectRequest', { request_id: id, reason: reason })
      .then(function () { toast('却下しました。'); showRequests(); })
      .catch(function (e) { btn.disabled = false; toast(e.message, true); });
  }

  /* ---- 社員一覧 ---- */
  function showEmployees() {
    AdminApi.call('adminListEmployees', {}).then(function (data) {
      var rows = data.employees.map(function (e) {
        return '<tr>' +
          '<td>' + esc(e.real_name) + '</td>' +
          '<td>' + esc(e.department || '') + '</td>' +
          '<td>' + esc(e.role) + '</td>' +
          '<td><span class="pill emp-' + esc(e.status) + '">' + esc(EMP_STATUS_LABEL[e.status] || e.status) + '</span></td>' +
          '<td class="muted small">' + esc((e.last_login_at || '').slice(0, 10)) + '</td>' +
          '<td class="act"><button class="btn sm" data-edit="' + esc(e.employee_id) + '">編集</button></td>' +
          '</tr>';
      }).join('');
      main().innerHTML = '<div class="panel"><h2>社員一覧</h2><div class="table-wrap"><table>' +
        '<thead><tr><th>氏名</th><th>部署</th><th>権限</th><th>状態</th><th>最終ログイン</th><th>操作</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div></div>';
      document.querySelectorAll('[data-edit]').forEach(function (b) {
        b.addEventListener('click', function () {
          var emp = data.employees.filter(function (x) { return x.employee_id === b.getAttribute('data-edit'); })[0];
          editEmployee(emp);
        });
      });
    }).catch(fail);
  }

  function editEmployee(emp) {
    var name = window.prompt('氏名（本名）:', emp.real_name);
    if (name === null) return;
    var dept = window.prompt('部署:', emp.department || '');
    if (dept === null) return;
    var role = window.prompt('権限 (employee / admin):', emp.role);
    if (role === null) return;
    var status = window.prompt('状態 (active / suspended / retired):', emp.status);
    if (status === null) return;
    AdminApi.call('adminUpdateEmployee', {
      employee_id: emp.employee_id,
      patch: { real_name: name, department: dept, role: role, status: status }
    }).then(function () { toast('更新しました。'); showEmployees(); })
      .catch(function (e) { toast(e.message, true); });
  }

  /* ---- 代休台帳 ---- */
  var leaveFilter = 'all';
  function showLeaves() {
    AdminApi.call('adminListLeaves', { filter: leaveFilter }).then(function (data) {
      var filters = [['all', '全件'], ['unused', '未取得'], ['expired', '期限切れ']];
      var chips = filters.map(function (f) {
        return '<button class="chip' + (f[0] === leaveFilter ? ' active' : '') + '" data-lf="' + f[0] + '">' + f[1] + '</button>';
      }).join('');
      var rows = data.leaves.map(function (l) {
        return '<tr><td>' + esc(l.work_date) + '</td><td>' + esc(l.granted_days) + '</td>' +
          '<td>' + esc(l.expiration_date) + '</td><td>' + esc(l.used_date || '') + '</td>' +
          '<td><span class="pill lv-' + esc(l.status) + '">' + esc(LEAVE_LABEL[l.status] || l.status) + '</span></td></tr>';
      }).join('');
      main().innerHTML = '<div class="panel"><h2>代休台帳</h2><div class="chips">' + chips + '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>休日出勤日</th><th>付与</th><th>有効期限</th><th>使用日</th><th>状態</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="5" class="muted center">該当なし</td></tr>') + '</tbody></table></div></div>';
      document.querySelectorAll('[data-lf]').forEach(function (c) {
        c.addEventListener('click', function () { leaveFilter = c.getAttribute('data-lf'); showLeaves(); });
      });
    }).catch(fail);
  }

  /* ---- 設定 ---- */
  function showSettings() {
    AdminApi.call('adminGetSettings', {}).then(function (data) {
      var rows = Object.keys(data.settings).map(function (k) {
        return '<tr><td>' + esc(k) + '</td><td><input class="input sm" id="set-' + esc(k) + '" value="' + esc(data.settings[k]) + '"></td>' +
          '<td><button class="btn sm" data-save="' + esc(k) + '">保存</button></td></tr>';
      }).join('');
      main().innerHTML = '<div class="panel"><h2>設定</h2><div class="table-wrap"><table>' +
        '<thead><tr><th>キー</th><th>値</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
      document.querySelectorAll('[data-save]').forEach(function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-save');
          var v = document.getElementById('set-' + k).value;
          AdminApi.call('adminUpdateSetting', { key: k, value: v })
            .then(function () { toast('保存しました。'); })
            .catch(function (e) { toast(e.message, true); });
        });
      });
    }).catch(fail);
  }

  /* ---- 操作ログ ---- */
  function showLogs() {
    AdminApi.call('adminListLogs', { limit: 200 }).then(function (data) {
      var rows = data.logs.map(function (l) {
        return '<tr><td class="muted small">' + esc((l.created_at || '').replace('T', ' ').slice(0, 19)) + '</td>' +
          '<td>' + esc(l.action_type) + '</td><td>' + esc(l.target_type) + '</td>' +
          '<td class="detail small">' + esc((l.after_data || '').slice(0, 120)) + '</td></tr>';
      }).join('');
      main().innerHTML = '<div class="panel"><h2>操作ログ（最新200件）</h2><div class="table-wrap"><table>' +
        '<thead><tr><th>日時</th><th>操作</th><th>対象</th><th>内容</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    }).catch(fail);
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
