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
              ['使用する代休', leave ? ('休日出勤日 ' + leave.work_date) : ''],
              ['期限', leave ? leave.expiration_date : '']
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

  // 起動
  window.addEventListener('DOMContentLoaded', boot);
})();
