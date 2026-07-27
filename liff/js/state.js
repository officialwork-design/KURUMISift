/**
 * state.js
 * アプリ全体の状態を保持する軽量ストア。
 */
window.AppState = (function () {
  var state = {
    profile: null,       // { displayName, pictureUrl }
    employee: null,      // 社員DTO
    registered: false,
    requests: [],
    leaves: [],
    calendar: null,      // { year, month, days }
    currentYear: null,
    currentMonth: null,
    loading: false,
    error: null,
    screen: 'loading'    // loading|error|register|home|calendar|holidayWork|compLeave|history
  };

  var listeners = [];

  return {
    get: function () { return state; },
    set: function (patch) {
      Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
      listeners.forEach(function (fn) { fn(state); });
    },
    subscribe: function (fn) { listeners.push(fn); }
  };
})();
