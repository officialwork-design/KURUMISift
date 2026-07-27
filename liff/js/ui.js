/**
 * ui.js
 * 画面描画とUI部品。値は必ずエスケープしてHTMLへ挿入する。
 * 状態は色とテキストの両方で表現する（色のみに依存しない）。
 */
window.UI = (function () {

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var REQUEST_STATUS_LABEL = {
    pending: '申請中', approved: '承認済み', rejected: '却下', cancelled: '取消'
  };
  var REQUEST_TYPE_LABEL = { holiday_work: '休日出勤', compensatory_leave: '代休' };
  var WORK_TYPE_LABEL = {
    regular_work: '通常勤務', holiday: '休日', holiday_work: '休日出勤',
    compensatory_leave: '代休', paid_leave: '有給', absence: '欠勤'
  };

  var app = function () { return document.getElementById('app'); };
  var modalRoot = function () { return document.getElementById('modal-root'); };

  function setLoading(on, text) {
    var l = document.getElementById('loading');
    document.getElementById('loading-text').textContent = text || '読み込み中...';
    l.style.display = on ? 'flex' : 'none';
  }

  function toast(message, isError) {
    var t = document.getElementById('toast');
    t.textContent = message;
    t.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(function () { t.className = 'toast'; }, 3200);
  }

  function renderError(message, onRetry) {
    app().innerHTML =
      '<section class="screen center">' +
      '<div class="card error-card">' +
      '<div class="error-icon">!</div>' +
      '<h2>エラー</h2>' +
      '<p class="muted">' + esc(message) + '</p>' +
      '<button id="retry-btn" class="btn btn-primary">再読み込み</button>' +
      '</div></section>';
    var b = document.getElementById('retry-btn');
    if (b && onRetry) b.addEventListener('click', onRetry);
  }

  function renderLoginPrompt(onLogin) {
    app().innerHTML =
      '<section class="screen center"><div class="card">' +
      '<h2>ログインが必要です</h2>' +
      '<p class="muted">LINE でログインしてください。</p>' +
      '<button id="login-btn" class="btn btn-primary">ログイン</button>' +
      '</div></section>';
    document.getElementById('login-btn').addEventListener('click', onLogin);
  }

  /* ---- 初回登録 ---- */
  function renderRegister(onSubmit) {
    app().innerHTML =
      '<section class="screen"><div class="card">' +
      '<h2>社員情報の登録</h2>' +
      '<p class="muted">シフト管理に使用するため、LINEの表示名ではなく、社内で使用している本名を入力してください。</p>' +
      '<p class="example">例：山田 太郎</p>' +
      '<label class="field-label" for="real-name">氏名</label>' +
      '<input id="real-name" class="input" type="text" inputmode="text" maxlength="50" placeholder="山田 太郎" autocomplete="off" />' +
      '<p class="note">※登録後の氏名変更は管理者への申請が必要です。</p>' +
      '<button id="reg-next" class="btn btn-primary">確認する</button>' +
      '</div></section>';
    document.getElementById('reg-next').addEventListener('click', function () {
      var v = document.getElementById('real-name').value;
      onSubmit(v);
    });
  }

  function renderRegisterConfirm(name, onConfirm, onEdit) {
    modalRoot().innerHTML =
      '<div class="modal-backdrop">' +
      '<div class="modal">' +
      '<p>以下の氏名で登録します。</p>' +
      '<p class="confirm-name">' + esc(name) + '</p>' +
      '<p class="muted">お間違いありませんか？</p>' +
      '<div class="modal-actions">' +
      '<button id="cf-edit" class="btn btn-ghost">修正する</button>' +
      '<button id="cf-ok" class="btn btn-primary">登録する</button>' +
      '</div></div></div>';
    document.getElementById('cf-ok').addEventListener('click', function () { closeModal(); onConfirm(); });
    document.getElementById('cf-edit').addEventListener('click', function () { closeModal(); if (onEdit) onEdit(); });
  }

  function closeModal() { modalRoot().innerHTML = ''; }

  /* ---- ホーム（勤務カレンダーを内包。遷移するのは申請履歴のみ） ---- */
  function renderHome(home, cal, handlers) {
    var e = home.employee || {};
    app().innerHTML =
      '<section class="screen">' +
      '<h2 class="greeting">こんにちは、' + esc(e.real_name) + ' さん</h2>' +
      (e.role === 'admin' ? '<p class="badge badge-admin">管理者</p>' : '') +
      '<div class="stat-highlight">' +
        '<span class="stat-num">' + esc(home.availableLeaves) + '</span>' +
        '<span class="stat-cap">取得可能な代休（日）</span>' +
        (home.leavesExpiringSoon > 0 ?
          '<span class="warn">期限が近い代休: ' + esc(home.leavesExpiringSoon) + ' 日</span>' : '') +
      '</div>' +
      '<div class="stat-grid">' +
        stat('今月の通常勤務', home.regularWorkDays + ' 日') +
        stat('今月の休日出勤', home.holidayWorkDays + ' 日') +
        stat('有給残', (home.paidLeaveBalance || 0) + ' 日') +
      '</div>' +
      '<h3 class="section-title">勤務カレンダー</h3>' +
      '<div id="home-cal"></div>' +
      '<div class="btn-stack">' +
        '<button id="h-hist" class="btn btn-outline">申請履歴</button>' +
        (e.role === 'admin' ? '<button id="h-admin" class="btn btn-primary">管理者メニュー</button>' : '') +
      '</div></section>';
    document.getElementById('h-hist').addEventListener('click', handlers.onHistory);
    var adminBtn = document.getElementById('h-admin');
    if (adminBtn && handlers.onAdmin) adminBtn.addEventListener('click', handlers.onAdmin);
    // カレンダーへ代休残数を渡す（残ゼロ時の案内に使用）
    handlers.availableLeaves = home.availableLeaves;
    renderCalendarInto('home-cal', cal, handlers);
  }

  /** ホーム内カレンダーの月切り替え時に、カレンダー領域だけ再描画 */
  function updateHomeCalendar(cal, handlers) {
    renderCalendarInto('home-cal', cal, handlers);
  }

  function stat(cap, val) {
    return '<div class="stat"><span class="stat-cap">' + esc(cap) + '</span>' +
      '<span class="stat-val">' + esc(val) + '</span></div>';
  }

  function backBar(title, onBack) {
    return '<div class="topbar"><button class="back" id="back-btn" aria-label="戻る">‹ 戻る</button>' +
      '<span class="topbar-title">' + esc(title) + '</span></div>';
  }
  function wireBack(onBack) {
    var b = document.getElementById('back-btn');
    if (b) b.addEventListener('click', onBack);
  }

  /* ---- カレンダー（指定コンテナ内に描画。ホームに内包する） ---- */
  function renderCalendarInto(containerId, cal, handlers) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var cells = '';
    var first = new Date(cal.year, cal.month - 1, 1).getDay();
    for (var i = 0; i < first; i++) cells += '<div class="cal-cell empty"></div>';
    cal.days.forEach(function (d) {
      var dayNum = parseInt(d.date.split('-')[2], 10);
      var cls = 'cal-cell wt-' + d.work_type + (d.status === 'pending' ? ' pending' : '');
      cells += '<button class="' + cls + '" data-date="' + esc(d.date) + '">' +
        '<span class="cal-day">' + dayNum + '</span>' +
        '<span class="cal-tag">' + esc(shortLabel(d)) + '</span>' +
        '</button>';
    });
    container.innerHTML =
      '<div class="cal-nav">' +
        '<button id="cal-prev" class="btn btn-ghost">‹ 前月</button>' +
        '<span class="cal-title">' + cal.year + '年 ' + cal.month + '月</span>' +
        '<button id="cal-next" class="btn btn-ghost">翌月 ›</button>' +
      '</div>' +
      '<div class="cal-weekhead"><span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span></div>' +
      '<div class="cal-grid">' + cells + '</div>' +
      '<p class="cal-hint">日付をタップすると、その日に休日出勤・代休を申請できます。</p>' +
      '<div id="day-detail" class="day-detail"></div>' +
      '<div class="legend">' + legend() + '</div>';
    var prev = container.querySelector('#cal-prev');
    var next = container.querySelector('#cal-next');
    if (prev && handlers.onPrevMonth) prev.addEventListener('click', handlers.onPrevMonth);
    if (next && handlers.onNextMonth) next.addEventListener('click', handlers.onNextMonth);
    Array.prototype.forEach.call(container.querySelectorAll('.cal-cell[data-date]'), function (btn) {
      btn.addEventListener('click', function () {
        var date = btn.getAttribute('data-date');
        var day = cal.days.filter(function (x) { return x.date === date; })[0];
        showDayDetail(day, handlers);
      });
    });
  }

  function shortLabel(d) {
    if (d.status === 'pending') return '申請中';
    if (d.work_type === 'regular_work') return '勤務';
    if (d.work_type === 'holiday') return d.holiday_name ? '祝' : '休';
    return WORK_TYPE_LABEL[d.work_type] || '';
  }

  function showDayDetail(d, handlers) {
    if (!d) return;
    var box = document.getElementById('day-detail');

    // すでに休日出勤/代休が入っている、または申請中なら追加不可
    var alreadySet = (d.work_type === 'holiday_work' || d.work_type === 'compensatory_leave');
    var isPending = (d.status === 'pending');

    var hasLeaves = !handlers || Number(handlers.availableLeaves || 0) > 0;
    var actions = '';
    if (isPending) {
      actions = '<p class="muted small">この日は申請中です。</p>';
    } else if (alreadySet) {
      actions = '<p class="muted small">この日は' + esc(WORK_TYPE_LABEL[d.work_type]) + 'として登録済みです。</p>';
    } else {
      var clBtn = hasLeaves
        ? '<button id="add-cl" class="btn btn-outline" data-date="' + esc(d.date) + '">この日に代休を申請</button>'
        : '<button id="add-cl-disabled" class="btn btn-outline btn-disabled" disabled>代休を申請（残 0 日）</button>' +
          '<p class="muted small">代休がありません。先に「この日に休日出勤を申請」で休日出勤を登録すると、代休が1日付与されます。</p>';
      actions =
        '<div class="detail-actions">' +
        '<button id="add-hw" class="btn btn-primary" data-date="' + esc(d.date) + '">この日に休日出勤を申請</button>' +
        clBtn +
        '</div>';
    }

    box.innerHTML =
      '<h3>' + esc(d.date) + '</h3>' +
      '<p>区分: ' + esc(WORK_TYPE_LABEL[d.work_type] || d.work_type) +
        (d.holiday_name ? '（' + esc(d.holiday_name) + '）' : '') + '</p>' +
      (d.start_time ? '<p>時間: ' + esc(d.start_time) + ' 〜 ' + esc(d.end_time) + '</p>' : '') +
      '<p>状態: ' + (d.status === 'pending' ? '申請中' : '確定') + '</p>' +
      (d.remarks ? '<p>備考: ' + esc(d.remarks) + '</p>' : '') +
      actions;

    if (handlers) {
      var hw = document.getElementById('add-hw');
      if (hw && handlers.onAddHolidayWork) {
        hw.addEventListener('click', function () { handlers.onAddHolidayWork(d.date); });
      }
      var cl = document.getElementById('add-cl');
      if (cl && handlers.onAddCompLeave) {
        cl.addEventListener('click', function () { handlers.onAddCompLeave(d.date); });
      }
    }
    // タップした日の詳細・申請ボタンが画面外にならないよう表示位置へスクロール
    try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
  }

  function legend() {
    return [
      ['wt-regular_work', '通常勤務'], ['wt-holiday', '休日'],
      ['wt-holiday_work', '休日出勤'], ['wt-compensatory_leave', '代休'],
      ['wt-paid_leave', '有給'], ['pending', '申請中']
    ].map(function (x) {
      return '<span class="legend-item"><span class="swatch ' + x[0] + '"></span>' + x[1] + '</span>';
    }).join('');
  }

  /* ---- 休日出勤申請 ---- */
  function renderHolidayWorkForm(defaults, handlers) {
    app().innerHTML =
      backBar('休日出勤申請') +
      '<section class="screen"><div class="card">' +
      field('対象日', '<input id="hw-date" class="input" type="date" value="' + esc(defaults.date || '') + '">') +
      field('開始時刻', '<input id="hw-start" class="input" type="time" value="' + esc(defaults.start || '10:00') + '">') +
      field('終了時刻', '<input id="hw-end" class="input" type="time" value="' + esc(defaults.end || '19:00') + '">') +
      field('出勤理由', '<textarea id="hw-reason" class="input" rows="2"></textarea>') +
      field('代休希望日（任意）', '<input id="hw-pref" class="input" type="date">') +
      field('備考（任意）', '<textarea id="hw-remarks" class="input" rows="2"></textarea>') +
      '<button id="hw-submit" class="btn btn-primary">確認する</button>' +
      '</div></section>';
    wireBack(handlers.onBack);
    document.getElementById('hw-submit').addEventListener('click', function () {
      handlers.onSubmit({
        target_date: document.getElementById('hw-date').value,
        start_time: document.getElementById('hw-start').value,
        end_time: document.getElementById('hw-end').value,
        reason: document.getElementById('hw-reason').value,
        preferred_compensatory_date: document.getElementById('hw-pref').value,
        remarks: document.getElementById('hw-remarks').value
      });
    });
  }

  /* ---- 代休申請 ---- */
  function renderCompLeaveForm(leaves, handlers, defaultDate) {
    var options = leaves.length
      ? leaves.map(function (l) {
          return '<label class="leave-opt"><input type="radio" name="leave" value="' + esc(l.leave_id) + '">' +
            '<span>休日出勤日 ' + esc(l.work_date) + ' / 付与 ' + esc(l.granted_days) + '日</span></label>';
        }).join('')
      : '<p class="muted">利用可能な代休がありません。</p>';
    app().innerHTML =
      backBar('代休申請') +
      '<section class="screen"><div class="card">' +
      '<label class="field-label">使用する代休</label>' +
      '<div class="leave-list">' + options + '</div>' +
      field('取得希望日', '<input id="cl-date" class="input" type="date" value="' + esc(defaultDate || '') + '">') +
      field('備考（任意）', '<textarea id="cl-remarks" class="input" rows="2"></textarea>') +
      '<button id="cl-submit" class="btn btn-primary"' + (leaves.length ? '' : ' disabled') + '>確認する</button>' +
      '</div></section>';
    wireBack(handlers.onBack);
    var sb = document.getElementById('cl-submit');
    if (sb && leaves.length) sb.addEventListener('click', function () {
      var sel = document.querySelector('input[name="leave"]:checked');
      handlers.onSubmit({
        selected_leave_id: sel ? sel.value : '',
        target_date: document.getElementById('cl-date').value,
        remarks: document.getElementById('cl-remarks').value
      });
    });
  }

  function field(label, inner) {
    return '<label class="field-label">' + esc(label) + '</label>' + inner;
  }

  /* ---- 確認ダイアログ ---- */
  function confirmDialog(lines, onOk) {
    modalRoot().innerHTML =
      '<div class="modal-backdrop"><div class="modal">' +
      '<p>以下の内容で申請します。</p>' +
      '<div class="confirm-lines">' + lines.map(function (l) {
        return '<div><span class="cl-k">' + esc(l[0]) + '</span><span class="cl-v">' + esc(l[1]) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="modal-actions">' +
      '<button id="dlg-cancel" class="btn btn-ghost">修正する</button>' +
      '<button id="dlg-ok" class="btn btn-primary">送信する</button>' +
      '</div></div></div>';
    document.getElementById('dlg-cancel').addEventListener('click', closeModal);
    var ok = document.getElementById('dlg-ok');
    ok.addEventListener('click', function () {
      ok.disabled = true; // 二重送信防止
      onOk(function done() { closeModal(); });
    });
  }

  function renderDone(message, onHome) {
    app().innerHTML =
      '<section class="screen center"><div class="card">' +
      '<div class="done-icon">✓</div>' +
      '<h2>送信完了</h2>' +
      '<p class="muted">' + esc(message) + '</p>' +
      '<button id="done-home" class="btn btn-primary">ホームへ戻る</button>' +
      '</div></section>';
    document.getElementById('done-home').addEventListener('click', onHome);
  }

  /* ---- 申請履歴 ---- */
  function renderHistory(requests, currentFilter, handlers) {
    var filters = [['all', '全件'], ['pending', '申請中'], ['approved', '承認済み'], ['rejected', '却下']];
    var tabs = filters.map(function (f) {
      return '<button class="tab' + (f[0] === currentFilter ? ' active' : '') +
        '" data-filter="' + f[0] + '">' + f[1] + '</button>';
    }).join('');
    var list = requests.length ? requests.map(historyCard).join('')
      : '<p class="muted center">該当する申請はありません。</p>';
    app().innerHTML =
      backBar('申請履歴') +
      '<section class="screen">' +
      '<div class="tabs">' + tabs + '</div>' +
      '<div class="hist-list">' + list + '</div>' +
      '</section>';
    wireBack(handlers.onBack);
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () { handlers.onFilter(t.getAttribute('data-filter')); });
    });
  }

  function historyCard(r) {
    return '<div class="hist-card status-' + esc(r.status) + '">' +
      '<div class="hist-head">' +
        '<span class="hist-type">' + esc(REQUEST_TYPE_LABEL[r.request_type] || r.request_type) + '</span>' +
        '<span class="status-pill st-' + esc(r.status) + '">' + esc(REQUEST_STATUS_LABEL[r.status] || r.status) + '</span>' +
      '</div>' +
      '<div class="hist-body">' +
        '<p>対象日: ' + esc(r.target_date) + '</p>' +
        (r.start_time ? '<p>時間: ' + esc(r.start_time) + '〜' + esc(r.end_time) + '</p>' : '') +
        (r.reason ? '<p>理由: ' + esc(r.reason) + '</p>' : '') +
        (r.rejection_reason ? '<p class="reject">却下理由: ' + esc(r.rejection_reason) + '</p>' : '') +
        '<p class="muted small">申請日時: ' + esc((r.requested_at || '').replace('T', ' ').slice(0, 16)) + '</p>' +
      '</div></div>';
  }

  /* ============ 管理者画面（LIFF内に統合） ============ */

  var LEAVE_STATUS_LABEL = {
    available: '未使用', pending: '申請中', used: '使用済み', expired: '期限切れ', cancelled: '取消'
  };
  var EMP_STATUS_LABEL = { active: '有効', suspended: '停止', retired: '退職' };

  function renderAdminMenu(handlers) {
    app().innerHTML =
      backBar('管理者メニュー') +
      '<section class="screen"><div class="btn-stack">' +
      '<button id="a-dash" class="btn btn-outline">ダッシュボード</button>' +
      '<button id="a-req" class="btn btn-outline">申請一覧</button>' +
      '<button id="a-emp" class="btn btn-outline">社員一覧</button>' +
      '<button id="a-lv" class="btn btn-outline">代休台帳</button>' +
      '<button id="a-set" class="btn btn-outline">設定</button>' +
      '<button id="a-log" class="btn btn-outline">操作ログ</button>' +
      '</div></section>';
    wireBack(handlers.onBack);
    document.getElementById('a-dash').addEventListener('click', handlers.onDashboard);
    document.getElementById('a-req').addEventListener('click', handlers.onRequests);
    document.getElementById('a-emp').addEventListener('click', handlers.onEmployees);
    document.getElementById('a-lv').addEventListener('click', handlers.onLeaves);
    document.getElementById('a-set').addEventListener('click', handlers.onSettings);
    document.getElementById('a-log').addEventListener('click', handlers.onLogs);
  }

  function renderAdminDashboard(d, handlers) {
    function m(cap, val) {
      return '<div class="stat"><span class="stat-cap">' + esc(cap) + '</span>' +
        '<span class="stat-val">' + esc(val) + '</span></div>';
    }
    app().innerHTML =
      backBar('ダッシュボード') +
      '<section class="screen"><div class="stat-grid">' +
      m('本日の出勤予定', d.todayAttending + ' 人') +
      m('本日の休暇', d.todayOff + ' 人') +
      m('未承認申請', d.pendingRequests + ' 件') +
      m('未取得代休', d.unusedLeaves + ' 件') +
      '</div></section>';
    wireBack(handlers.onBack);
  }

  function renderAdminRequests(requests, filter, handlers) {
    var filters = [['pending', '未承認'], ['all', '全件'], ['approved', '承認済み'], ['rejected', '却下']];
    var tabs = filters.map(function (f) {
      return '<button class="tab' + (f[0] === filter ? ' active' : '') + '" data-f="' + f[0] + '">' + f[1] + '</button>';
    }).join('');
    var list = requests.length ? requests.map(function (r) {
      var actions = r.status === 'pending'
        ? '<div class="detail-actions"><button class="btn btn-primary" data-ap="' + esc(r.request_id) + '">承認</button>' +
          '<button class="btn btn-ghost" data-rj="' + esc(r.request_id) + '">却下</button></div>'
        : '';
      return '<div class="hist-card status-' + esc(r.status) + '">' +
        '<div class="hist-head"><span class="hist-type">' + esc(r.employee_name) + '：' +
        esc(REQUEST_TYPE_LABEL[r.request_type] || r.request_type) + '</span>' +
        '<span class="status-pill st-' + esc(r.status) + '">' + esc(REQUEST_STATUS_LABEL[r.status] || r.status) + '</span></div>' +
        '<div class="hist-body"><p>対象日: ' + esc(r.target_date) + '</p>' +
        (r.start_time ? '<p>時間: ' + esc(r.start_time) + '〜' + esc(r.end_time) + '</p>' : '') +
        (r.reason ? '<p>理由: ' + esc(r.reason) + '</p>' : '') + actions + '</div></div>';
    }).join('') : '<p class="muted center">該当する申請はありません。</p>';
    app().innerHTML = backBar('申請一覧') +
      '<section class="screen"><div class="tabs">' + tabs + '</div><div class="hist-list">' + list + '</div></section>';
    wireBack(handlers.onBack);
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () { handlers.onFilter(t.getAttribute('data-f')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-ap]'), function (b) {
      b.addEventListener('click', function () { b.disabled = true; handlers.onApprove(b.getAttribute('data-ap')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-rj]'), function (b) {
      b.addEventListener('click', function () { handlers.onReject(b.getAttribute('data-rj')); });
    });
  }

  function renderAdminEmployees(employees, handlers) {
    var list = employees.map(function (e) {
      return '<div class="hist-card">' +
        '<div class="hist-head"><span class="hist-type">' + esc(e.real_name) + '</span>' +
        '<span class="status-pill emp-' + esc(e.status) + '">' + esc(EMP_STATUS_LABEL[e.status] || e.status) + '</span></div>' +
        '<div class="hist-body"><p>権限: ' + esc(e.role) + ' / 有給残: ' + esc(e.paid_leave_balance != null ? e.paid_leave_balance : 0) + ' 日</p>' +
        '<button class="btn btn-outline" data-edit="' + esc(e.employee_id) + '">編集</button></div></div>';
    }).join('');
    app().innerHTML = backBar('社員一覧') + '<section class="screen"><div class="hist-list">' + list + '</div></section>';
    wireBack(handlers.onBack);
    Array.prototype.forEach.call(document.querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () {
        var emp = employees.filter(function (x) { return x.employee_id === b.getAttribute('data-edit'); })[0];
        handlers.onEdit(emp);
      });
    });
  }

  function renderAdminLeaves(leaves, filter, handlers) {
    var filters = [['all', '全件'], ['unused', '未取得'], ['expired', '期限切れ']];
    var chips = filters.map(function (f) {
      return '<button class="tab' + (f[0] === filter ? ' active' : '') + '" data-lf="' + f[0] + '">' + f[1] + '</button>';
    }).join('');
    var list = leaves.length ? leaves.map(function (l) {
      return '<div class="hist-card"><div class="hist-body">' +
        '<p>休日出勤日: ' + esc(l.work_date) + ' / 付与: ' + esc(l.granted_days) + '日</p>' +
        '<p>状態: ' + esc(LEAVE_STATUS_LABEL[l.status] || l.status) + (l.used_date ? ' / 使用日: ' + esc(l.used_date) : '') + '</p>' +
        '</div></div>';
    }).join('') : '<p class="muted center">該当なし</p>';
    app().innerHTML = backBar('代休台帳') +
      '<section class="screen"><div class="tabs">' + chips + '</div><div class="hist-list">' + list + '</div></section>';
    wireBack(handlers.onBack);
    Array.prototype.forEach.call(document.querySelectorAll('[data-lf]'), function (t) {
      t.addEventListener('click', function () { handlers.onFilter(t.getAttribute('data-lf')); });
    });
  }

  function renderAdminSettings(settings, handlers) {
    var rows = Object.keys(settings).map(function (k) {
      return '<div class="card" style="margin-bottom:8px">' +
        '<label class="field-label">' + esc(k) + '</label>' +
        '<input class="input" id="set-' + esc(k) + '" value="' + esc(settings[k]) + '">' +
        '<button class="btn btn-outline" data-save="' + esc(k) + '">保存</button></div>';
    }).join('');
    app().innerHTML = backBar('設定') + '<section class="screen">' + rows + '</section>';
    wireBack(handlers.onBack);
    Array.prototype.forEach.call(document.querySelectorAll('[data-save]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-save');
        handlers.onSave(k, document.getElementById('set-' + k).value);
      });
    });
  }

  function renderAdminLogs(logs, handlers) {
    var list = logs.length ? logs.map(function (l) {
      return '<div class="hist-card"><div class="hist-body">' +
        '<p class="muted small">' + esc((l.created_at || '').replace('T', ' ').slice(0, 19)) + '</p>' +
        '<p>' + esc(l.action_type) + ' / ' + esc(l.target_type) + '</p>' +
        '<p class="muted small">' + esc((l.after_data || '').slice(0, 100)) + '</p></div></div>';
    }).join('') : '<p class="muted center">ログがありません。</p>';
    app().innerHTML = backBar('操作ログ') + '<section class="screen"><div class="hist-list">' + list + '</div></section>';
    wireBack(handlers.onBack);
  }

  return {
    esc: esc, setLoading: setLoading, toast: toast,
    renderError: renderError, renderLoginPrompt: renderLoginPrompt,
    renderRegister: renderRegister, renderRegisterConfirm: renderRegisterConfirm,
    renderHome: renderHome, updateHomeCalendar: updateHomeCalendar,
    renderHolidayWorkForm: renderHolidayWorkForm, renderCompLeaveForm: renderCompLeaveForm,
    confirmDialog: confirmDialog, renderDone: renderDone, renderHistory: renderHistory,
    renderAdminMenu: renderAdminMenu, renderAdminDashboard: renderAdminDashboard,
    renderAdminRequests: renderAdminRequests, renderAdminEmployees: renderAdminEmployees,
    renderAdminLeaves: renderAdminLeaves, renderAdminSettings: renderAdminSettings,
    renderAdminLogs: renderAdminLogs,
    closeModal: closeModal,
    labels: { REQUEST_STATUS_LABEL: REQUEST_STATUS_LABEL, WORK_TYPE_LABEL: WORK_TYPE_LABEL }
  };
})();
