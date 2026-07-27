/**
 * app.js
 * 画面遷移と各機能の初期化。
 */
(function () {
  var S = window.AppState;

  // ローディング状態をUIへ反映
  S.subscribe(function (state) { UI.setLoading(state.loading, state.loadingText); });

  function fail(err) {
    var msg = (err && err.message) ? err.message : 'エラーが発生しました。';
    var code = err && err.code;

    // IDトークン失効/未認証は、一度だけ自動で再ログインしてトークンを取り直す
    if (code === 'INVALID_TOKEN' || code === 'UNAUTHENTICATED') {
      var tried = false;
      try { tried = sessionStorage.getItem('token_relogin_done') === '1'; } catch (e) {}
      if (!tried) {
        try { sessionStorage.setItem('token_relogin_done', '1'); } catch (e) {}
        UI.setLoading(true, '再ログインしています...');
        LiffClient.relogin();
        return;
      }
    }
    UI.renderError(msg, function () {
      try { sessionStorage.removeItem('token_relogin_done'); } catch (e) {}
      boot();
    });
  }

  /* ---- 起動 ---- */
  function boot() {
    UI.setLoading(true, 'LINEと接続しています...');
    LiffClient.init()
      .then(function (res) {
        S.set({ profile: res.profile });
        return Api.call('bootstrap', {}, { silent: true });
      })
      .then(function (data) {
        // 認証成功。再ログインガードを解除。
        try { sessionStorage.removeItem('token_relogin_done'); } catch (e) {}
        S.set({ registered: data.registered, employee: data.employee, profile: data.profile || S.get().profile });
        UI.setLoading(false);
        if (!data.registered) return showRegister();
        if (!data.active) return UI.renderError('アカウントが停止中です。管理者にお問い合わせください。', boot);
        // bootstrap がホーム＋カレンダーを同梱していれば、追加リクエストなしで即描画（高速）
        if (data.home && data.calendar) {
          var now = new Date();
          var y = now.getFullYear(), m = now.getMonth() + 1;
          _availableLeaves = data.home.availableLeaves || 0;
          S.set({ employee: data.home.employee, calendar: data.calendar, currentYear: y, currentMonth: m, screen: 'home' });
          return UI.renderHome(data.home, data.calendar, homeHandlers(y, m));
        }
        return showHome();
      })
      .catch(function (err) { UI.setLoading(false); fail(err); });
  }

  /* ---- 初回登録 ---- */
  function showRegister() {
    UI.renderRegister(function (rawName) {
      var name = String(rawName || '').replace(/[　\s]+/g, ' ').trim();
      if (name.length < 2 || Array.from(name).length > 50) {
        UI.toast('氏名は2文字以上50文字以内で入力してください。', true);
        return;
      }
      UI.renderRegisterConfirm(name, function onConfirm() {
        Api.call('registerEmployee', { real_name: name })
          .then(function (data) {
            S.set({ registered: true, employee: data.employee });
            UI.toast('登録が完了しました。');
            showHome();
          })
          .catch(function (err) { UI.toast(err.message, true); showRegister(); });
      }, function onEdit() { showRegister(); });
    });
  }

  /* ---- ホーム（勤務カレンダーを内包） ---- */
  function showHome() {
    var now = new Date();
    renderHomeFor(now.getFullYear(), now.getMonth() + 1);
  }

  var _availableLeaves = 0; // 代休残（残ゼロ時の案内に使用）

  // ホーム本体＋当月カレンダーを1回のAPIで取得して描画（往復削減で安定化）
  function renderHomeFor(year, month) {
    Api.call('getHomeCalendar', { year: year, month: month })
      .then(function (res) {
        var home = res.home, cal = res.calendar;
        _availableLeaves = home.availableLeaves || 0;
        S.set({ employee: home.employee, calendar: cal, currentYear: year, currentMonth: month, screen: 'home' });
        UI.renderHome(home, cal, homeHandlers(year, month));
      })
      .catch(fail);
  }

  // カレンダーの月移動時は、カレンダー領域だけ差し替え
  function reloadHomeCalendar(year, month) {
    Api.call('getCalendar', { year: year, month: month })
      .then(function (cal) {
        S.set({ calendar: cal, currentYear: year, currentMonth: month });
        UI.updateHomeCalendar(cal, homeHandlers(year, month));
      })
      .catch(fail);
  }

  function homeHandlers(year, month) {
    return {
      availableLeaves: _availableLeaves,
      onHistory: function () { showHistory('all'); },
      onAdmin: function () { showAdminMenu(); },
      onAddHolidayWork: function (date) { showHolidayWork(date); },
      onAddCompLeave: function (date) { showCompLeave(date); },
      onPrevMonth: function () { var m = shift(year, month, -1); reloadHomeCalendar(m.y, m.m); },
      onNextMonth: function () { var m = shift(year, month, 1); reloadHomeCalendar(m.y, m.m); }
    };
  }

  function shift(y, m, d) {
    var idx = (y * 12 + (m - 1)) + d;
    return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
  }

  /* ---- 休日出勤申請 ---- */
  function showHolidayWork(defaultDate) {
    S.set({ screen: 'holidayWork' });
    UI.renderHolidayWorkForm({ date: defaultDate || '', start: '10:00', end: '19:00' }, {
      onBack: showHome,
      onSubmit: function (payload) {
        if (!payload.target_date) return UI.toast('対象日を選択してください。', true);
        if (!payload.reason.trim()) return UI.toast('出勤理由を入力してください。', true);
        if (payload.end_time <= payload.start_time) return UI.toast('終了時刻は開始時刻より後にしてください。', true);
        UI.confirmDialog([
          ['対象日', payload.target_date],
          ['時間', payload.start_time + ' 〜 ' + payload.end_time],
          ['理由', payload.reason],
          ['代休希望日', payload.preferred_compensatory_date || '（なし）']
        ], function (done) {
          Api.call('createHolidayWork', payload)
            .then(function (res) {
              done();
              var applied = res && res.request && res.request.status === 'approved';
              UI.renderDone(applied
                ? '休日出勤を勤務カレンダーに登録しました。代休を1日付与しました。'
                : '休日出勤申請を送信しました。承認をお待ちください。', showHome);
            })
            .catch(function (err) { UI.closeModal(); UI.toast(err.message, true); });
        });
      }
    });
  }

  /* ---- 代休申請 ---- */
  function showCompLeave(defaultDate) {
    Api.call('getAvailableLeaves', {})
      .then(function (data) {
        S.set({ leaves: data.leaves, screen: 'compLeave' });
        if (!data.leaves.length) {
          UI.toast('利用可能な代休がありません。まず休日出勤で代休を取得してください。', true);
        }
        UI.renderCompLeaveForm(data.leaves, {
          onBack: showHome,
          onSubmit: function (payload) {
            if (!payload.selected_leave_id) return UI.toast('使用する代休を選択してください。', true);
            if (!payload.target_date) return UI.toast('取得希望日を選択してください。', true);
            var leave = data.leaves.filter(function (l) { return l.leave_id === payload.selected_leave_id; })[0];
            UI.confirmDialog([
              ['取得希望日', payload.target_date],
              ['使用する代休', leave ? ('休日出勤日 ' + leave.work_date) : '']
            ], function (done) {
              Api.call('createCompLeave', payload)
                .then(function (res) {
                  done();
                  var applied = res && res.request && res.request.status === 'approved';
                  UI.renderDone(applied
                    ? '代休を勤務カレンダーに登録しました。'
                    : '代休申請を送信しました。承認をお待ちください。', showHome);
                })
                .catch(function (err) { UI.closeModal(); UI.toast(err.message, true); });
            });
          }
        }, defaultDate);
      })
      .catch(fail);
  }

  /* ---- 申請履歴 ---- */
  function showHistory(filter) {
    Api.call('getMyRequests', { status: filter })
      .then(function (data) {
        S.set({ requests: data.requests, screen: 'history' });
        UI.renderHistory(data.requests, filter, {
          onBack: showHome,
          onFilter: function (f) { showHistory(f); }
        });
      })
      .catch(fail);
  }

  /* ---- 管理者（LIFF内に統合。role=admin のみ。GAS側でも権限検証） ---- */
  function showAdminMenu() {
    S.set({ screen: 'adminMenu' });
    UI.renderAdminMenu({
      onBack: showHome,
      onDashboard: showAdminDashboard,
      onRequests: function () { showAdminRequests('pending'); },
      onEmployees: showAdminEmployees,
      onLeaves: function () { showAdminLeaves('all'); },
      onSettings: showAdminSettings,
      onLogs: showAdminLogs
    });
  }
  function showAdminDashboard() {
    Api.call('adminDashboard', {}).then(function (d) {
      UI.renderAdminDashboard(d, { onBack: showAdminMenu });
    }).catch(fail);
  }
  function showAdminRequests(filter) {
    Api.call('adminListRequests', { status: filter }).then(function (data) {
      UI.renderAdminRequests(data.requests, filter, {
        onBack: showAdminMenu,
        onFilter: function (f) { showAdminRequests(f); },
        onApprove: function (id) {
          Api.call('adminApproveRequest', { request_id: id })
            .then(function () { UI.toast('承認しました。'); showAdminRequests(filter); })
            .catch(function (e) { UI.toast(e.message, true); showAdminRequests(filter); });
        },
        onReject: function (id) {
          var r = window.prompt('却下理由（任意）:', ''); if (r === null) return;
          Api.call('adminRejectRequest', { request_id: id, reason: r })
            .then(function () { UI.toast('却下しました。'); showAdminRequests(filter); })
            .catch(function (e) { UI.toast(e.message, true); showAdminRequests(filter); });
        }
      });
    }).catch(fail);
  }
  function showAdminEmployees() {
    Api.call('adminListEmployees', {}).then(function (data) {
      UI.renderAdminEmployees(data.employees, {
        onBack: showAdminMenu,
        onEdit: function (emp) {
          var paid = window.prompt('有給残日数（0以上）:', emp.paid_leave_balance != null ? emp.paid_leave_balance : 0);
          if (paid === null) return;
          var role = window.prompt('権限 (employee / admin):', emp.role); if (role === null) return;
          var status = window.prompt('状態 (active / suspended / retired):', emp.status); if (status === null) return;
          Api.call('adminUpdateEmployee', {
            employee_id: emp.employee_id,
            patch: { paid_leave_balance: paid, role: role, status: status }
          }).then(function () { UI.toast('更新しました。'); showAdminEmployees(); })
            .catch(function (e) { UI.toast(e.message, true); });
        }
      });
    }).catch(fail);
  }
  function showAdminLeaves(filter) {
    Api.call('adminListLeaves', { filter: filter }).then(function (data) {
      UI.renderAdminLeaves(data.leaves, filter, {
        onBack: showAdminMenu,
        onFilter: function (f) { showAdminLeaves(f); }
      });
    }).catch(fail);
  }
  function showAdminSettings() {
    Api.call('adminGetSettings', {}).then(function (data) {
      UI.renderAdminSettings(data.settings, {
        onBack: showAdminMenu,
        onSave: function (key, val) {
          Api.call('adminUpdateSetting', { key: key, value: val })
            .then(function () { UI.toast('保存しました。'); })
            .catch(function (e) { UI.toast(e.message, true); });
        }
      });
    }).catch(fail);
  }
  function showAdminLogs() {
    Api.call('adminListLogs', { limit: 100 }).then(function (data) {
      UI.renderAdminLogs(data.logs, { onBack: showAdminMenu });
    }).catch(fail);
  }

  // 起動（DOMContentLoaded が既に発火済みでも確実に起動する）
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
