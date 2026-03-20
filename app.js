(function () {
  'use strict';

  const STORAGE_QUOTE = 'schedule_quote';
  const STORAGE_CALENDAR_MEMO = 'schedule_calendar_memo';
  const STORAGE_TODOS = 'schedule_todos';
  const STORAGE_TODOS_COMPLETED = 'schedule_todos_completed';
  const STORAGE_REPEATING = 'schedule_repeating';
  const STORAGE_REPEATING_DAY_OVERRIDES = 'schedule_repeating_day_overrides';
  const STORAGE_MEMOS = 'schedule_memos';
  const STORAGE_MEMO_TABS = 'schedule_memo_tabs';
  const STORAGE_DELETED_MEMO_TABS = 'schedule_deleted_memo_tabs';
  const STORAGE_SPECIAL_DATES = 'schedule_special_dates';
  const STORAGE_CALENDAR_TYPE = 'schedule_calendar_type';
  const STORAGE_TODO_SECTION_NOTES = 'schedule_todo_section_notes';

  const FIREBASE_DB_URL = 'https://zaf-todo-default-rtdb.firebaseio.com';
  const FIREBASE_BASE_PATH = '/schedule_v1';

  const memoryStore = {};
  /** 키별 로컬 수정 세대. fetch 완료 시 이전 값이면 서버 응답으로 덮어쓰지 않음(로딩 중 입력 유지). */
  const memoryStoreMutationGen = {};

  async function syncKeyFromFirebase(key) {
    try {
      const genAtStart = memoryStoreMutationGen[key] || 0;
      const res = await fetch(FIREBASE_DB_URL + FIREBASE_BASE_PATH + '/' + encodeURIComponent(key) + '.json');
      if (!res.ok) return;
      const data = await res.json();
      if (data === null || data === undefined) return;
      if ((memoryStoreMutationGen[key] || 0) !== genAtStart) return;
      memoryStore[key] = data;
    } catch (_) {}
  }

  async function syncKeyToFirebase(key, value) {
    try {
      await fetch(FIREBASE_DB_URL + FIREBASE_BASE_PATH + '/' + encodeURIComponent(key) + '.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value)
      });
    } catch (_) {}
  }

  function getFromStore(key) { return memoryStore[key] ?? null; }
  function setToStore(key, value) {
    memoryStoreMutationGen[key] = (memoryStoreMutationGen[key] || 0) + 1;
    memoryStore[key] = value;
    syncKeyToFirebase(key, value);
  }
  const DEFAULT_MEMO_TABS = ['개인', '시타마치', '슈가맨워크', '부동산투자', '인공지능(AI)', '기타'];
  const MEMO_PASTEL_COLORS = ['#dceefc', '#fffcc0', '#c8e8c9', '#fcd4df', '#b8ecf3', '#e8ccec', '#ffe9c4', '#b8e3df', '#ffd9cc', '#d4dae0'];
  const MEMO_PASTEL_COLOR_NAMES = ['하늘색', '노란색', '연두색', '분홍색', '청록색', '연보라', '주황색', '민트색', '산호색', '연회색'];
  const SECTION_COLOR_INDEX = { morning: 0, lunch: 1, afternoon: 2, evening: 3 };

  function getColorSwatchTooltipEl() {
    let el = document.getElementById('memo-swatch-tooltip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'memo-swatch-tooltip';
      el.className = 'memo-swatch-tooltip';
      document.body.appendChild(el);
    }
    return el;
  }
  function bindColorSwatchTooltip(btn, colorName) {
    const tooltip = getColorSwatchTooltipEl();
    let moveFn = null;
    btn.addEventListener('mouseenter', function (e) {
      tooltip.textContent = colorName;
      tooltip.style.display = 'block';
      moveFn = function (ev) {
        const x = ev.clientX;
        const y = ev.clientY;
        const w = tooltip.offsetWidth;
        const h = tooltip.offsetHeight;
        tooltip.style.left = Math.max(4, Math.min(x - w / 2, document.documentElement.clientWidth - w - 4)) + 'px';
        tooltip.style.top = (y - h - 10) + 'px';
      };
      moveFn(e);
      document.addEventListener('mousemove', moveFn);
    });
    btn.addEventListener('mouseleave', function () {
      tooltip.style.display = 'none';
      if (moveFn) document.removeEventListener('mousemove', moveFn);
    });
  }

  function getMemoTabById(tabId) {
    if (!tabId || !state.memoTabs || !state.memoTabs.length) return null;
    return state.memoTabs.find(x => x.id === tabId) || null;
  }

  /** 종료일이 있고 오늘이 그 다음 날 이후면 true (당일까지는 유효) */
  function isMemoTabExpired(tab) {
    if (!tab || !tab.endDate || String(tab.endDate).length < 10) return false;
    return todayKey() > tab.endDate;
  }

  /** 오늘이 [시작일, 종료일] 구간 안에 있으면 true. 날짜 미입력은 제한 없음. */
  function isMemoTabInActivePeriod(tab) {
    if (!tab || isDeletedTabId(tab.id)) return false;
    const today = todayKey();
    if (tab.startDate && String(tab.startDate).length >= 10 && today < tab.startDate) return false;
    if (tab.endDate && String(tab.endDate).length >= 10 && today > tab.endDate) return false;
    return true;
  }

  function isTodoMemoTabActive(todo) {
    let tid = todo.memoTabId;
    if (tid === undefined || tid === null || tid === '') tid = getPersonalTabId();
    if (!tid) return false;
    const tab = getMemoTabById(tid);
    if (!tab) return false;
    return isMemoTabInActivePeriod(tab);
  }

  function repeatingTodoMemoTabActive(rep) {
    if (!rep) return false;
    let tid = rep.memoTabId;
    if (tid === undefined || tid === null || tid === '') tid = getPersonalTabId();
    const tab = getMemoTabById(tid);
    if (!tab) return false;
    return isMemoTabInActivePeriod(tab);
  }

  function getPersonalTabId() {
    if (!state.memoTabs || !state.memoTabs.length) return null;
    const usable = state.memoTabs.filter(t => isMemoTabInActivePeriod(t));
    if (!usable.length) return null;
    const personal = usable.find(x => x.name === '개인');
    return personal ? personal.id : usable[0].id;
  }

  function isDeletedTabId(tabId) {
    if (!tabId) return false;
    return (state.deletedMemoTabs || []).some(t => t.id === tabId);
  }

  function getTodoColorIndex(todo, section) {
    const tabId = todo.memoTabId || getPersonalTabId();
    if (tabId && state.memoTabs && state.memoTabs.length) {
      const tab = state.memoTabs.find(x => x.id === tabId);
      if (tab && typeof tab.colorIndex === 'number' && tab.colorIndex >= 0 && tab.colorIndex <= 9) return tab.colorIndex;
    }
    return SECTION_COLOR_INDEX[section] ?? 0;
  }

  let state = {
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth(),
    selectedDate: null,
    todos: {},
    repeatingTodos: [],
    repeatingDayOverrides: {},
    memoTabs: [],
    deletedMemoTabs: [],
    activeMemoTabId: null,
    memos: {},
    editingTodoId: null,
    editingMemoTabId: null,
    editingMemoTabIdForColor: null,
    viewAllMemos: true,
    dragMemoTabId: null,
    todoDropTarget: null,
    draggedTodoPayload: null,
    todoToMemoDropTarget: null,
    draggedMemoPayload: null,
    memoToTodoDropTarget: null,
    memoDropTarget: null,
    /** 같은 탭 내 드래그 시 미완료 개수 n (insertBefore ∈ [0,n]) */
    memoIncompleteCount: null,
    memoReorderDropTarget: null,
    draggingMemoReorder: false,
    repeatDeleteTarget: null,
    completedRepeatingInstances: {},
    viewMode: 'todo',
    todoViewCenterDate: null,
    calendarFullYear: new Date().getFullYear(),
    calendarFullMonth: new Date().getMonth(),
    specialDates: [],
    calendarType: 'solar',
    memoTabModalRestrictPeriod: false,
    todoSectionHeaderNotes: { morning: [], lunch: [], afternoon: [], evening: [] }
  };

  function dateKey(d) {
    if (typeof d === 'string') return d;
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** 할일 3열 .todo-day-col의 YYYY-MM-DD (dataset / 속성 폴백) */
  function normalizeTodoColDateKey(colEl) {
    if (!colEl) return '';
    var s = (colEl.dataset && colEl.dataset.date != null) ? String(colEl.dataset.date) : '';
    if (!s || String(s).trim().length < 10) {
      var attr = colEl.getAttribute && colEl.getAttribute('data-date');
      s = attr != null ? String(attr) : '';
    }
    s = String(s).trim();
    return s.length >= 10 ? s.slice(0, 10) : '';
  }

  function todayKey() {
    return dateKey(new Date());
  }

  function getSectionHeaderNoteForDate(dkey, section) {
    const arr = (state.todoSectionHeaderNotes && state.todoSectionHeaderNotes[section]) || [];
    const dk = dkey && String(dkey).length >= 10 ? String(dkey).slice(0, 10) : '';
    if (!arr.length || !dk) return '';
    let best = '';
    let bestFrom = '';
    for (var i = 0; i < arr.length; i++) {
      const e = arr[i];
      if (!e || !e.from) continue;
      const fk = String(e.from).slice(0, 10);
      if (fk.length < 10) continue;
      if (fk <= dk && fk >= bestFrom) {
        bestFrom = fk;
        best = typeof e.text === 'string' ? e.text : '';
      }
    }
    return best;
  }

  function applySectionHeaderNoteSave(section, viewDateKey, rawText) {
    pushUndoSnapshotCoalesced('applySecNote', 400);
    /** 입력한 열의 날짜부터 같은 날·이후 날짜에 바로 반영 */
    const from = viewDateKey && String(viewDateKey).length >= 10 ? String(viewDateKey).slice(0, 10) : null;
    if (!from || !section || section === 'completed') return;
    const keys = ['morning', 'lunch', 'afternoon', 'evening'];
    if (keys.indexOf(section) < 0) return;
    if (!state.todoSectionHeaderNotes) state.todoSectionHeaderNotes = { morning: [], lunch: [], afternoon: [], evening: [] };
    let arr = state.todoSectionHeaderNotes[section] || (state.todoSectionHeaderNotes[section] = []);
    const trimmed = (rawText == null ? '' : String(rawText)).trim();
    const idx = arr.findIndex(function (e) {
      return e && String(e.from || '').slice(0, 10) === from;
    });
    if (trimmed === '') {
      if (idx >= 0) arr.splice(idx, 1);
    } else {
      if (idx >= 0) arr[idx].text = trimmed;
      else {
        arr.push({ from: from, text: trimmed });
        arr.sort(function (a, b) { return (a.from || '').localeCompare(b.from || ''); });
      }
    }
    saveTodoSectionHeaderNotes();
  }

  var todoFieldDebounceByKey = Object.create(null);
  function flushTodoFieldDebounceForLi(li) {
    if (!li || !li.dataset || !li.dataset.dateKey || !li.dataset.id) return;
    var debKey = li.dataset.dateKey + '\x1e' + li.dataset.id;
    clearTimeout(todoFieldDebounceByKey[debKey]);
    todoFieldDebounceByKey[debKey] = null;
  }

  /** 할일 제목·내용: 상태 기준으로 3열의 같은 항목 입력칸만 갱신(포커스 중인 input 제외) */
  function refreshTodoItemInputsFromState() {
    var root = document.getElementById('todo-three-col');
    if (!root) return;
    root.querySelectorAll('li.todo-item[data-date-key][data-id]').forEach(function (li) {
      var dk = li.dataset.dateKey;
      var tid = li.dataset.id;
      if (!dk || !tid) return;
      var bySec = getTodosForDate(dk);
      var found = null;
      ['morning', 'lunch', 'afternoon', 'evening'].forEach(function (s) {
        (bySec[s] || []).forEach(function (t) {
          if (t.id === tid) found = t;
        });
      });
      if (!found) return;
      var titleInp = li.querySelector('.todo-item-title-input');
      var descInp = li.querySelector('.todo-item-desc-input');
      if (titleInp && document.activeElement !== titleInp) titleInp.value = found.title != null ? found.title : '';
      if (descInp && document.activeElement !== descInp) descInp.value = found.desc != null ? found.desc : '';
    });
  }

  /** 주제 입력 중 전체 렌더 없이 다른 날짜 열의 같은 구간 입력값만 동기화(포커스 유지) */
  function refreshOtherSectionHeaderNoteInputs(activeInput) {
    var root = document.getElementById('todo-three-col');
    if (!root) return;
    root.querySelectorAll('.todo-day-col').forEach(function (colEl) {
      var dk = normalizeTodoColDateKey(colEl);
      if (!dk) return;
      ['morning', 'lunch', 'afternoon', 'evening'].forEach(function (section) {
        var secEl = colEl.querySelector('.todo-section.section-' + section);
        var inp = secEl && secEl.querySelector('.section-header-note');
        if (!inp || inp === activeInput) return;
        var want = getSectionHeaderNoteForDate(dk, section);
        if (document.activeElement !== inp) inp.value = want;
      });
    });
  }

  function loadTodoSectionHeaderNotes() {
    try {
      const raw = getFromStore(STORAGE_TODO_SECTION_NOTES);
      var o = null;
      if (raw != null && raw !== '') {
        if (typeof raw === 'string') {
          try {
            o = JSON.parse(raw);
            if (typeof o === 'string') o = JSON.parse(o);
          } catch (_) {
            o = null;
          }
        } else if (typeof raw === 'object' && !Array.isArray(raw)) {
          o = raw;
        }
      }
      const base = { morning: [], lunch: [], afternoon: [], evening: [] };
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        ['morning', 'lunch', 'afternoon', 'evening'].forEach(function (s) {
          if (!Array.isArray(o[s])) return;
          base[s] = o[s]
            .filter(function (e) { return e && e.from && String(e.from).length >= 10; })
            .map(function (e) {
              return { from: String(e.from).slice(0, 10), text: typeof e.text === 'string' ? e.text : (e.text == null ? '' : String(e.text)) };
            })
            .sort(function (a, b) { return a.from.localeCompare(b.from); });
        });
      }
      state.todoSectionHeaderNotes = base;
    } catch (_) {
      state.todoSectionHeaderNotes = { morning: [], lunch: [], afternoon: [], evening: [] };
    }
  }

  function saveTodoSectionHeaderNotes() {
    setToStore(STORAGE_TODO_SECTION_NOTES, JSON.stringify(state.todoSectionHeaderNotes));
  }

  function loadSpecialDates() {
    try {
      const raw = getFromStore(STORAGE_SPECIAL_DATES);
      state.specialDates = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.specialDates)) state.specialDates = [];
      state.specialDates.forEach(function (s, i) {
        if (!s.id) s.id = 'sd_legacy_' + i + '_' + Date.now();
        if (!s.repeat) s.repeat = 'none';
        if (s.repeat === 'range' && (s.rangeStart === undefined || s.rangeEnd === undefined)) { s.rangeStart = s.rangeStart || ''; s.rangeEnd = s.rangeEnd || ''; }
        if (!s.memoTabId && state.memoTabs && state.memoTabs.length) {
          var _pid = getPersonalTabId();
          if (_pid) s.memoTabId = _pid;
        }
        if (s.isLunar === undefined) s.isLunar = false;
      });
    } catch (_) {
      state.specialDates = [];
    }
  }
  function saveSpecialDates() {
    setToStore(STORAGE_SPECIAL_DATES, JSON.stringify(state.specialDates));
  }
  function specialDateAppliesToDate(s, dkey) {
    if (!s.dateKey || dkey.length < 10) return s.dateKey === dkey;
    var date = new Date(dkey);
    var origin = new Date(s.dateKey);
    if (isNaN(date.getTime()) || isNaN(origin.getTime())) return s.dateKey === dkey;
    var start = s.rangeStart ? new Date(s.rangeStart) : null;
    var end = s.rangeEnd ? new Date(s.rangeEnd) : null;
    if (start && date < start) return false;
    if (end && date > end) return false;
    if (!s.repeat || s.repeat === 'none') return s.dateKey === dkey;
    if (s.repeat === 'range') {
      var rd = s.rangeDays;
      if (rd && (rd.mon || rd.tue || rd.wed || rd.thu || rd.fri || rd.sat || rd.sun || rd.holiday)) {
        var day = date.getDay();
        var isHoliday = !!getHolidayName(dkey);
        return (day === 1 && (rd.mon !== false)) || (day === 2 && (rd.tue !== false)) || (day === 3 && (rd.wed !== false)) || (day === 4 && (rd.thu !== false)) || (day === 5 && (rd.fri !== false)) || (day === 6 && (rd.sat !== false)) || (day === 0 && (rd.sun !== false)) || (isHoliday && (rd.holiday !== false));
      }
      return true;
    }
    if (s.isLunar) {
      var lunarD = solarToLunar(dkey);
      var lunarS = solarToLunar(s.dateKey);
      if (!lunarD || !lunarS) return s.dateKey === dkey;
      if (s.repeat === 'daily') return true;
      if (s.repeat === 'weekly') return date.getDay() === origin.getDay();
      if (s.repeat === 'monthly') return lunarD.day === lunarS.day;
      if (s.repeat === 'yearly') return lunarD.month === lunarS.month && lunarD.day === lunarS.day;
      return false;
    }
    if (s.repeat === 'daily') return true;
    if (s.repeat === 'weekly') return date.getDay() === origin.getDay();
    if (s.repeat === 'monthly') return date.getDate() === origin.getDate();
    if (s.repeat === 'monthly_last') return date.getDate() === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    if (s.repeat === 'yearly') return s.dateKey.slice(5, 10) === dkey.slice(5, 10);
    return false;
  }
  function getSpecialDateLabels(dkey) {
    if (!state.specialDates || !state.specialDates.length) return [];
    return state.specialDates.filter(function (s) { return specialDateAppliesToDate(s, dkey); }).map(function (s) { return s.label || ''; }).filter(Boolean);
  }

  const FIXED_HOLIDAYS = {
    '01-01': '신정',
    '03-01': '삼일절',
    '05-05': '어린이날',
    '06-06': '현충일',
    '08-15': '광복절',
    '10-03': '개천절',
    '10-09': '한글날',
    '12-25': '크리스마스'
  };

  const LUNAR_HOLIDAYS_BY_YEAR = {
    2024: [['02-09', '설날'], ['02-10', '설날'], ['02-11', '설날'], ['09-16', '추석'], ['09-17', '추석'], ['09-18', '추석'], ['05-15', '부처님오신날']],
    2025: [['01-28', '설날'], ['01-29', '설날'], ['01-30', '설날'], ['10-05', '추석'], ['10-06', '추석'], ['10-07', '추석'], ['05-12', '부처님오신날']],
    2026: [['02-16', '설날'], ['02-17', '설날'], ['02-18', '설날'], ['09-24', '추석'], ['09-25', '추석'], ['09-26', '추석'], ['05-24', '부처님오신날']],
    2027: [['02-06', '설날'], ['02-07', '설날'], ['02-08', '설날'], ['09-23', '추석'], ['09-24', '추석'], ['09-25', '추석'], ['05-13', '부처님오신날']],
    2028: [['01-26', '설날'], ['01-27', '설날'], ['01-28', '설날'], ['10-11', '추석'], ['10-12', '추석'], ['10-13', '추석'], ['05-02', '부처님오신날']],
    2029: [['02-13', '설날'], ['02-14', '설날'], ['02-15', '설날'], ['09-30', '추석'], ['10-01', '추석'], ['10-02', '추석'], ['05-21', '부처님오신날']],
    2030: [['02-02', '설날'], ['02-03', '설날'], ['02-04', '설날'], ['09-19', '추석'], ['09-20', '추석'], ['09-21', '추석'], ['05-10', '부처님오신날']]
  };

  var LUNAR_1_1_SOLAR = { 2024: '2024-02-09', 2025: '2025-01-28', 2026: '2026-02-16', 2027: '2027-02-06', 2028: '2028-01-26', 2029: '2029-02-13', 2030: '2030-02-02' };

  function solarToLunar(dkey) {
    if (!dkey || dkey.length < 10) return null;
    var y = parseInt(dkey.slice(0, 4), 10);
    var lunar11 = LUNAR_1_1_SOLAR[y];
    if (!lunar11) return null;
    var solarDate = new Date(dkey);
    var lunar11Date = new Date(lunar11);
    var daysDiff = Math.round((solarDate - lunar11Date) / (24 * 60 * 60 * 1000));
    if (daysDiff < 0) {
      y--;
      lunar11 = LUNAR_1_1_SOLAR[y];
      if (!lunar11) return null;
      lunar11Date = new Date(lunar11);
      daysDiff = Math.round((solarDate - lunar11Date) / (24 * 60 * 60 * 1000));
    }
    var avgMonth = 29.530588;
    var month = 1 + Math.floor(daysDiff / avgMonth);
    var day = 1 + Math.round(daysDiff % avgMonth);
    if (day > 30) { day = 1; month++; }
    if (month > 12) month = 12;
    return { year: y, month: month, day: day };
  }

  function getLunarDisplayString(dkey) {
    var lun = solarToLunar(dkey);
    if (!lun) return '';
    return '음 ' + lun.month + '.' + lun.day;
  }

  function getHolidayName(dkey) {
    const mmdd = dkey.slice(5);
    if (FIXED_HOLIDAYS[mmdd]) return FIXED_HOLIDAYS[mmdd];
    const y = parseInt(dkey.slice(0, 4), 10);
    const arr = LUNAR_HOLIDAYS_BY_YEAR[y];
    if (!arr) return null;
    const found = arr.find(([d]) => d === mmdd);
    return found ? found[1] : null;
  }

  function loadQuote() {
    try {
      const raw = getFromStore(STORAGE_QUOTE);
      if (raw) {
        const arr = JSON.parse(raw);
        document.querySelectorAll('.quote-line').forEach((el, i) => {
          if (arr[i] !== undefined) el.innerHTML = arr[i];
        });
      }
    } catch (_) {}
  }

  function saveQuote() {
    const lines = Array.from(document.querySelectorAll('.quote-line')).map(el => el.innerHTML.trim());
    setToStore(STORAGE_QUOTE, JSON.stringify(lines));
  }

  function loadCalendarMemo() {
    try {
      var el = document.getElementById('calendar-memo');
      if (!el) return;
      var raw = getFromStore(STORAGE_CALENDAR_MEMO);
      if (raw && typeof raw === 'string' && raw.trim()) el.innerHTML = raw;
    } catch (_) {}
  }

  function saveCalendarMemo() {
    try {
      var el = document.getElementById('calendar-memo');
      if (el) setToStore(STORAGE_CALENDAR_MEMO, el.innerHTML || '');
    } catch (_) {}
  }

  function looksLikeMemoHtml(s) {
    if (s == null || s === '') return false;
    return /<[a-z][\s\S]*>/i.test(String(s));
  }
  function memoContentToPlain(html) {
    if (html == null || html === '') return '';
    var s = String(html);
    if (!looksLikeMemoHtml(s)) return s;
    var d = document.createElement('div');
    d.innerHTML = s;
    return (d.textContent || d.innerText || '').trim();
  }
  /** 전체보기 호버 팝업: 본문과 동일하게 br·블록·목록 줄바꿈 유지 (innerText, 화면 밖 측정) */
  function memoHtmlToPlainWithLineBreaks(html) {
    if (html == null || html === '') return '';
    var s = String(html);
    if (!looksLikeMemoHtml(s)) return s;
    var w = document.createElement('div');
    w.setAttribute('aria-hidden', 'true');
    w.style.cssText = 'position:fixed;left:-10000px;top:0;width:300px;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.2;font-family:inherit;';
    w.innerHTML = s;
    document.body.appendChild(w);
    var t = w.innerText != null ? w.innerText : w.textContent;
    if (w.parentNode) document.body.removeChild(w);
    if (t == null) return '';
    return String(t).replace(/\u00a0/g, ' ');
  }
  function setMemoItemContentHtml(el, raw) {
    if (!el) return;
    if (raw == null || raw === '') {
      el.innerHTML = '';
      return;
    }
    var s = String(raw);
    if (looksLikeMemoHtml(s)) el.innerHTML = s;
    else {
      el.innerHTML = s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\n/g, '<br>');
    }
  }
  function getRichMemoEditorContaining(node) {
    if (!node) return null;
    var el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== document.body) {
      if (el.id === 'calendar-memo') return el;
      if (el.classList && el.classList.contains('memo-item-content-rich')) return el;
      el = el.parentElement;
    }
    return null;
  }
  function getRichMemoEditorFromSelection() {
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return getRichMemoEditorContaining(sel.getRangeAt(0).commonAncestorContainer);
  }
  function getRichMemoEditorForApplyFormat() {
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount > 0) {
      var ed = getRichMemoEditorContaining(sel.getRangeAt(0).commonAncestorContainer);
      if (ed) return ed;
    }
    if (calendarMemoSavedNonCollapsedRange) {
      try {
        var ed2 = getRichMemoEditorContaining(calendarMemoSavedNonCollapsedRange.commonAncestorContainer);
        if (ed2) return ed2;
    } catch (_) {}
    }
    return document.getElementById('calendar-memo');
  }
  function saveRichMemoEditorIfNeeded(editor) {
    if (!editor) return;
    if (editor.id === 'calendar-memo') {
      saveCalendarMemo();
      return;
    }
    var tabId = editor.dataset.tabId;
    var itemId = editor.dataset.itemId;
    if (tabId == null || itemId == null) return;
    var items = state.memos[tabId];
    if (!items) return;
    var it = items.find(function (x) { return String(x.id) === String(itemId); });
    if (it) {
      it.content = editor.innerHTML;
      saveMemos();
    }
  }

  /** 크기 셀렉트 클릭 시 selection이 풀리므로, 마지막 텍스트 선택 범위를 보관 */
  var calendarMemoSavedNonCollapsedRange = null;

  function getCalendarMemoSelectionRangeForFormat(editor) {
    if (!editor) return null;
    var sel = window.getSelection ? window.getSelection() : null;
    if (sel && sel.rangeCount > 0) {
      var r = sel.getRangeAt(0);
      if (!r.collapsed && editor.contains(r.commonAncestorContainer)) return r.cloneRange();
    }
    if (calendarMemoSavedNonCollapsedRange) {
      try {
        var r2 = calendarMemoSavedNonCollapsedRange.cloneRange();
        if (!r2.collapsed && editor.contains(r2.commonAncestorContainer)) return r2;
    } catch (_) {}
    }
    return null;
  }

  /**
   * 글자 크기 적용. span 안에 div/ul 등 블록을 넣지 않음(브라우저가 노드를 삭제하는 문제 방지).
   * 블록은 인라인만 자식일 때만 안쪽 span, 블록 자식이 있으면 요소에 font-size.
   */
  function insertCalendarMemoFontSizeNodes(range, n) {
    var contents = range.extractContents();
    var tmp = document.createElement('div');
    tmp.appendChild(contents);
    if (!tmp.firstChild) return;

    var px = n + 'px';
    var out = document.createDocumentFragment();

    function hasBlockChild(el) {
      var ch = el.firstChild;
      while (ch) {
        if (ch.nodeType === 1 && /^(DIV|UL|OL|P|LI|H[1-6]|BLOCKQUOTE|PRE|TABLE)$/i.test(ch.tagName)) return true;
        ch = ch.nextSibling;
      }
      return false;
    }

    function wrapInlineOnlyBlock(el) {
      var innerSpan = document.createElement('span');
      innerSpan.style.fontSize = px;
      while (el.firstChild) innerSpan.appendChild(el.firstChild);
      el.appendChild(innerSpan);
    }

    while (tmp.firstChild) {
      var node = tmp.removeChild(tmp.firstChild);
      if (node.nodeType === 1 && /^(UL|OL)$/i.test(node.tagName)) {
        node.style.fontSize = px;
        out.appendChild(node);
      } else if (node.nodeType === 1 && /^(DIV|P)$/i.test(node.tagName)) {
        if (!hasBlockChild(node)) wrapInlineOnlyBlock(node);
        else node.style.fontSize = px;
        out.appendChild(node);
      } else if (node.nodeType === 1 && /^LI$/i.test(node.tagName)) {
        node.style.fontSize = px;
        out.appendChild(node);
      } else if (node.nodeType === 1 && /^(H[1-6]|BLOCKQUOTE|PRE)$/i.test(node.tagName)) {
        if (!hasBlockChild(node)) wrapInlineOnlyBlock(node);
        else node.style.fontSize = px;
        out.appendChild(node);
      } else {
        var span = document.createElement('span');
        span.style.fontSize = px;
        span.appendChild(node);
        out.appendChild(span);
      }
    }
    range.insertNode(out);
  }

  /** 달력 아래 메모 선택 영역에 px 단위 글자 크기 적용 (굵게 등 인라인 서식 유지) */
  function applyCalendarMemoSelectionFontSize(px) {
    var editor = getRichMemoEditorForApplyFormat();
    if (!editor) return;
    var n = parseInt(px, 10);
    if (isNaN(n) || n < 8 || n > 40) return;
    var range = getCalendarMemoSelectionRangeForFormat(editor);
    if (!range || range.collapsed) return;
    var holder = document.createElement('div');
    holder.appendChild(range.cloneContents());
    var inner = holder.innerHTML;
    if (!inner || !String(inner).replace(/\s|&nbsp;/g, '')) return;
    editor.focus();
    var sel = window.getSelection();
    sel.removeAllRanges();
    try {
      sel.addRange(range);
      } catch (_) {
      return;
    }
    insertCalendarMemoFontSizeNodes(sel.getRangeAt(0), n);
    calendarMemoSavedNonCollapsedRange = null;
    saveRichMemoEditorIfNeeded(editor);
  }

  /** 선택 영역에서 글자 크기만 제거(에디터 기본 크기로), DOM 구조 유지 */
  function resetCalendarMemoSelectionFontSize() {
    var editor = getRichMemoEditorForApplyFormat();
    if (!editor) return;
    var range = getCalendarMemoSelectionRangeForFormat(editor);
    if (!range || range.collapsed) return;
    var holder = document.createElement('div');
    holder.appendChild(range.cloneContents());
    var inner = holder.innerHTML;
    if (!inner) return;
    editor.focus();
    var sel = window.getSelection();
    sel.removeAllRanges();
    try {
      sel.addRange(range);
      } catch (_) {
      return;
    }
    range = sel.getRangeAt(0);
    var contents = range.extractContents();
    holder = document.createElement('div');
    holder.appendChild(contents);
    var els = holder.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.style && el.style.fontSize) el.style.removeProperty('font-size');
      var st = el.getAttribute('style');
      if (st !== null && String(st).trim() === '') el.removeAttribute('style');
      if (el.tagName === 'FONT' && el.hasAttribute('size')) el.removeAttribute('size');
    }
    var frag = document.createDocumentFragment();
    while (holder.firstChild) frag.appendChild(holder.firstChild);
    range.insertNode(frag);
    calendarMemoSavedNonCollapsedRange = null;
    saveRichMemoEditorIfNeeded(editor);
  }

  /** 글자 색 팝업: 5색 (표시·선택 전용) */
  var CAL_MEMO_FONT_COLOR_PALETTE = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#9333ea'];

  function calendarMemoColorToHex(color) {
    if (!color || !String(color).trim()) return null;
    var s = String(color).trim().toLowerCase();
    if (s.startsWith('#')) {
      if (s.length === 4 && /^#[0-9a-f]{3}$/i.test(s)) {
        return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
      }
      return s.length >= 7 ? s.slice(0, 7) : s;
    }
    var m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      var r = (+m[1]).toString(16).padStart(2, '0');
      var g = (+m[2]).toString(16).padStart(2, '0');
      var b = (+m[3]).toString(16).padStart(2, '0');
      return ('#' + r + g + b).toLowerCase();
    }
    return null;
  }

  /** 선택 시작 지점 기준 글자 색(계산) */
  function getCalendarMemoRangeStartForeColor(editor, range) {
    if (!editor || !range) return '#111827';
    var node = range.startContainer;
    var el = node.nodeType === 3 ? node.parentElement : node;
    if (!el || !editor.contains(el)) el = editor;
    var cur = el;
    while (cur && cur !== editor) {
      if (cur.nodeType === 1 && cur.style && cur.style.color) {
        var hx = calendarMemoColorToHex(cur.style.color);
        if (hx) return hx;
      }
      cur = cur.parentElement;
    }
    var compEl = node.nodeType === 3 ? node.parentElement : (node.nodeType === 1 ? node : null);
    if (!compEl || !editor.contains(compEl)) compEl = editor;
    var hx2 = calendarMemoColorToHex(window.getComputedStyle(compEl).color);
    return hx2 || '#111827';
  }

  /** 선택 범위 시작 지점 기준 글자 크기(px, 반올림). 인라인 font-size 우선, 없으면 계산된 스타일 */
  function getCalendarMemoRangeStartFontSizePx(editor, range) {
    if (!editor || !range) return null;
    var node = range.startContainer;
    var el = node.nodeType === 3 ? node.parentElement : node;
    if (!el || !editor.contains(el)) el = editor;
    var cur = el;
    while (cur && cur !== editor) {
      if (cur.nodeType === 1 && cur.style && cur.style.fontSize) {
        var m = String(cur.style.fontSize).trim().match(/^([\d.]+)\s*px/i);
        if (m) {
          var n = Math.round(parseFloat(m[1]));
          return isNaN(n) ? null : n;
        }
      }
      cur = cur.parentElement;
    }
    var compEl = node.nodeType === 3 ? node.parentElement : (node.nodeType === 1 ? node : null);
    if (!compEl || !editor.contains(compEl)) compEl = editor;
    var fs = window.getComputedStyle(compEl).fontSize;
    var m2 = fs && String(fs).match(/^([\d.]+)px/i);
    if (!m2) return null;
    var px = Math.round(parseFloat(m2[1]));
    return isNaN(px) ? null : px;
  }

  /** 플로팅 툴바 글자 크기 셀렉트에 선택 시작 위치의 px 표시 */
  function updateCalendarMemoSelectionFontSizeSelect() {
    var editor = getRichMemoEditorFromSelection();
    var bar = document.getElementById('calendar-memo-selection-toolbar');
    var sizeSel = bar && bar.querySelector('#calendar-memo-selection-font-size');
    if (!editor || !sizeSel) return;
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    var range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;

    var dynamics = sizeSel.querySelectorAll('option[data-calendar-memo-dynamic-size]');
    for (var di = 0; di < dynamics.length; di++) {
      dynamics[di].parentNode.removeChild(dynamics[di]);
    }

    var px = getCalendarMemoRangeStartFontSizePx(editor, range);
    if (px == null || isNaN(px)) {
      sizeSel.value = '';
      return;
    }
    var str = String(px);
    var matched = sizeSel.querySelector('option[value="' + str + '"]');
    if (!matched) {
      var opt = document.createElement('option');
      opt.value = str;
      opt.textContent = str + 'px';
      opt.setAttribute('data-calendar-memo-dynamic-size', '1');
      var after = sizeSel.querySelector('option[value="reset"]');
      if (after && after.nextSibling) {
        after.parentNode.insertBefore(opt, after.nextSibling);
      } else {
        sizeSel.appendChild(opt);
      }
    }
    sizeSel.value = str;
  }

  /** 플로팅 툴바: B/U/S·목록 등 현재 선택 구간에 적용된 서식 버튼 강조 */
  function updateCalendarMemoSelectionToolbarActiveStates() {
    var bar = document.getElementById('calendar-memo-selection-toolbar');
    if (!bar || !bar.classList.contains('show')) return;
    var editor = getRichMemoEditorFromSelection();
    var sns = window.getSelection && window.getSelection();
    if (!editor || !sns || sns.rangeCount === 0) return;
    var range = sns.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    bar.querySelectorAll('.calendar-memo-selection-btn[data-cmd]').forEach(function (btn) {
      var cmd = btn.getAttribute('data-cmd');
      if (!cmd || cmd === 'removeFormat') {
        btn.classList.remove('calendar-memo-selection-btn--active');
        btn.removeAttribute('aria-pressed');
        return;
      }
      var active = false;
      try {
        active = document.queryCommandState(cmd);
      } catch (_) {}
      btn.classList.toggle('calendar-memo-selection-btn--active', !!active);
      if (active) btn.setAttribute('aria-pressed', 'true');
      else btn.removeAttribute('aria-pressed');
    });
  }

  function updateCalendarMemoSelectionFontColorSwatch() {
    var editor = getRichMemoEditorFromSelection();
    var sw = document.getElementById('calendar-memo-color-swatch');
    if (!editor || !sw) return;
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    var range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    var hex = getCalendarMemoRangeStartForeColor(editor, range);
    sw.style.backgroundColor = hex;
    var light = /^#f/i.test(hex) || hex === '#ffffff' || hex === '#fff';
    sw.style.boxShadow = light ? 'inset 0 0 0 1px rgba(0,0,0,.2)' : 'none';
  }

  function closeCalendarMemoColorPickerPop() {
    var pop = document.getElementById('calendar-memo-color-picker-pop');
    var tr = document.getElementById('calendar-memo-color-trigger');
    if (pop) pop.hidden = true;
    if (tr) tr.setAttribute('aria-expanded', 'false');
  }

  function getCalendarMemoSelectionToolbar() {
    var bar = document.getElementById('calendar-memo-selection-toolbar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'calendar-memo-selection-toolbar';
    bar.className = 'calendar-memo-selection-toolbar';
    var sizeOpts = '';
    for (var s = 8; s <= 32; s += 2) {
      sizeOpts += '<option value="' + s + '">' + s + 'px</option>';
    }
    bar.innerHTML = ''
      + '<span class="calendar-memo-toolbar-item calendar-memo-selection-size-label" data-tooltip="글자 크기(목록에서 px 또는 기본 선택)">'
      + '<select class="calendar-memo-selection-font-size" id="calendar-memo-selection-font-size" aria-label="글자 크기">'
      + '<option value="">크기</option>'
      + '<option value="reset">기본(14px)</option>'
      + sizeOpts
      + '</select></span>'
      + '<span class="calendar-memo-toolbar-item" data-tooltip="굵게"><button type="button" class="calendar-memo-selection-btn" data-cmd="bold" aria-label="굵게"><b>B</b></button></span>'
      + '<span class="calendar-memo-toolbar-item" data-tooltip="밑줄"><button type="button" class="calendar-memo-selection-btn" data-cmd="underline" aria-label="밑줄"><u>U</u></button></span>'
      + '<span class="calendar-memo-toolbar-item" data-tooltip="취소선"><button type="button" class="calendar-memo-selection-btn" data-cmd="strikeThrough" aria-label="취소선"><s>S</s></button></span>'
      + '<span class="calendar-memo-toolbar-item calendar-memo-selection-color-wrap" data-tooltip="글자 색">'
      + '<button type="button" class="calendar-memo-color-trigger" id="calendar-memo-color-trigger" aria-label="글자 색 선택" aria-haspopup="listbox" aria-expanded="false">'
      + '<span class="calendar-memo-color-swatch" id="calendar-memo-color-swatch"></span></button>'
      + '<div class="calendar-memo-color-picker-pop" id="calendar-memo-color-picker-pop" role="listbox" aria-label="글자 색" hidden></div>'
      + '</span>'
      + '<span class="calendar-memo-toolbar-item" data-tooltip="글머리 기호 목록"><button type="button" class="calendar-memo-selection-btn" data-cmd="insertUnorderedList" aria-label="글머리 기호">•</button></span>'
      + '<span class="calendar-memo-toolbar-item" data-tooltip="번호 목록"><button type="button" class="calendar-memo-selection-btn" data-cmd="insertOrderedList" aria-label="번호 목록">1.</button></span>'
      + '<span class="calendar-memo-toolbar-item" data-tooltip="서식 지우기"><button type="button" class="calendar-memo-selection-btn" data-cmd="removeFormat" aria-label="서식 지우기">Tx</button></span>';
    document.body.appendChild(bar);
    var colorPop = bar.querySelector('#calendar-memo-color-picker-pop');
    if (colorPop) {
      CAL_MEMO_FONT_COLOR_PALETTE.forEach(function (hex) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'calendar-memo-color-opt';
        b.style.backgroundColor = hex;
        b.dataset.hex = hex;
        b.setAttribute('role', 'option');
        b.setAttribute('aria-label', hex);
        b.title = hex;
        colorPop.appendChild(b);
      });
    }
    bar.addEventListener('mousedown', function (e) {
      if (e.target.closest('.calendar-memo-selection-font-size') || e.target.closest('.calendar-memo-selection-size-label') || e.target.closest('.calendar-memo-selection-color-wrap')) return;
      e.preventDefault();
    });
    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-cmd]');
      if (!btn) return;
      var cmd = btn.getAttribute('data-cmd');
      if (!cmd) return;
      var edBefore = getRichMemoEditorFromSelection();
      try {
        document.execCommand(cmd, false, null);
      } catch (_) {}
      saveRichMemoEditorIfNeeded(edBefore || getRichMemoEditorFromSelection());
      requestAnimationFrame(updateCalendarMemoSelectionToolbarPosition);
    });
    var colorTrigger = bar.querySelector('#calendar-memo-color-trigger');
    if (colorTrigger && colorPop) {
      colorTrigger.addEventListener('click', function (e) {
        e.stopPropagation();
          e.preventDefault();
        var open = colorPop.hidden;
        if (open) {
          colorPop.hidden = false;
          colorTrigger.setAttribute('aria-expanded', 'true');
        } else {
          closeCalendarMemoColorPickerPop();
        }
      });
      colorPop.addEventListener('mousedown', function (e) {
        var opt = e.target.closest('.calendar-memo-color-opt');
        if (!opt) return;
        e.preventDefault();
        e.stopPropagation();
        var hexPick = opt.dataset.hex || '#111827';
        var edBefore = getRichMemoEditorFromSelection();
        try {
          document.execCommand('foreColor', false, hexPick);
        } catch (_) {}
        saveRichMemoEditorIfNeeded(edBefore || getRichMemoEditorFromSelection());
        closeCalendarMemoColorPickerPop();
        var sw = document.getElementById('calendar-memo-color-swatch');
        if (sw) {
          sw.style.backgroundColor = hexPick;
          sw.style.boxShadow = /^#f/i.test(hexPick) || hexPick === '#ffffff' ? 'inset 0 0 0 1px rgba(0,0,0,.2)' : 'none';
        }
        requestAnimationFrame(updateCalendarMemoSelectionToolbarPosition);
      });
    }
    document.addEventListener('mousedown', function calMemoColorPopOutside(e) {
      var wrap = document.querySelector('#calendar-memo-selection-toolbar .calendar-memo-selection-color-wrap');
      var pop = document.getElementById('calendar-memo-color-picker-pop');
      if (!wrap || !pop || pop.hidden) return;
      if (wrap.contains(e.target)) return;
      closeCalendarMemoColorPickerPop();
    }, true);
    var sizeSel = bar.querySelector('#calendar-memo-selection-font-size');
    if (sizeSel) {
      sizeSel.addEventListener('change', function () {
        var v = this.value;
        if (v === 'reset') {
          resetCalendarMemoSelectionFontSize();
        } else if (v) {
          applyCalendarMemoSelectionFontSize(v);
        }
        requestAnimationFrame(updateCalendarMemoSelectionToolbarPosition);
      });
    }
    return bar;
  }

  function hideCalendarMemoSelectionToolbar() {
    var bar = document.getElementById('calendar-memo-selection-toolbar');
    if (bar) bar.classList.remove('show');
  }

  function updateCalendarMemoSelectionToolbarPosition() {
    var editor = getRichMemoEditorFromSelection();
    var bar = document.getElementById('calendar-memo-selection-toolbar');
    if (!editor || !bar) {
      hideCalendarMemoSelectionToolbar();
      return;
    }
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      hideCalendarMemoSelectionToolbar();
      return;
    }
    var range = sel.getRangeAt(0);
    var anchorNode = sel.anchorNode;
    var focusNode = sel.focusNode;
    if (!anchorNode || !focusNode || !editor.contains(anchorNode) || !editor.contains(focusNode)) {
      hideCalendarMemoSelectionToolbar();
      return;
    }
    var rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      hideCalendarMemoSelectionToolbar();
      return;
    }
    bar.classList.add('show');
    var margin = 8;
    var top = rect.top + window.scrollY - bar.offsetHeight - margin;
    var left = rect.left + window.scrollX + (rect.width / 2) - (bar.offsetWidth / 2);
    var minLeft = window.scrollX + 8;
    var maxLeft = window.scrollX + document.documentElement.clientWidth - bar.offsetWidth - 8;
    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = maxLeft;
    var minTop = window.scrollY + 8;
    if (top < minTop) top = rect.bottom + window.scrollY + margin;
    bar.style.left = Math.round(left) + 'px';
    bar.style.top = Math.round(top) + 'px';
    updateCalendarMemoSelectionFontSizeSelect();
    updateCalendarMemoSelectionFontColorSwatch();
    updateCalendarMemoSelectionToolbarActiveStates();
  }

  function onRichMemoSelectionChange() {
    var ed = getRichMemoEditorFromSelection();
    var sel = window.getSelection ? window.getSelection() : null;
    if (ed && sel && sel.rangeCount > 0) {
      var r = sel.getRangeAt(0);
      if (ed.contains(r.commonAncestorContainer)) {
        if (!r.collapsed) {
          try {
            calendarMemoSavedNonCollapsedRange = r.cloneRange();
          } catch (_) {}
        } else {
          calendarMemoSavedNonCollapsedRange = null;
        }
      } else {
        calendarMemoSavedNonCollapsedRange = null;
      }
    } else {
      calendarMemoSavedNonCollapsedRange = null;
    }
    updateCalendarMemoSelectionToolbarPosition();
  }

  function initRichMemoToolbarGlobalListeners() {
    if (document.documentElement.dataset.richMemoToolbarGlob === '1') return;
    document.documentElement.dataset.richMemoToolbarGlob = '1';
    document.addEventListener('selectionchange', onRichMemoSelectionChange);
    document.addEventListener('keyup', function (e) {
      if (e.target.closest && e.target.closest('#calendar-memo, .memo-item-content-rich')) {
        updateCalendarMemoSelectionToolbarPosition();
      }
    });
    document.addEventListener('mouseup', function (e) {
      if (e.target.closest && e.target.closest('#calendar-memo, .memo-item-content-rich')) {
        updateCalendarMemoSelectionToolbarPosition();
      }
    });
    document.addEventListener('focusout', function (e) {
      if (e.target && e.target.closest && e.target.closest('#calendar-memo, .memo-item-content-rich')) {
        setTimeout(updateCalendarMemoSelectionToolbarPosition, 0);
      }
    });
    window.addEventListener('resize', updateCalendarMemoSelectionToolbarPosition);
    window.addEventListener('scroll', updateCalendarMemoSelectionToolbarPosition, true);
  }

  function bindCalendarMemoSelectionToolbar() {
    var editor = document.getElementById('calendar-memo');
    if (!editor) return;
    getCalendarMemoSelectionToolbar();
    if (editor.dataset.selectionToolbarBound === '1') return;
    editor.dataset.selectionToolbarBound = '1';
    initRichMemoToolbarGlobalListeners();
  }

  function initCalendarMemo() {
    var el = document.getElementById('calendar-memo');
    if (!el || el.querySelector('.ql-container')) return;
    el.spellcheck = false;
    el.setAttribute('spellcheck', 'false');
    el.addEventListener('input', saveCalendarMemo);
    el.addEventListener('blur', saveCalendarMemo);
    bindCalendarMemoSelectionToolbar();
      window.addEventListener('beforeunload', saveCalendarMemo);
  }

  function loadTodos() {
    try {
      const raw = getFromStore(STORAGE_TODOS);
      state.todos = raw ? JSON.parse(raw) : {};
      Object.keys(state.todos).forEach(k => {
        (state.todos[k] || []).forEach(t => {
          if (t.important === true) t.important = 'red';
          if (t.important !== false && t.important !== 'blue' && t.important !== 'red') t.important = false;
        });
      });
    } catch (_) {
      state.todos = {};
    }
    try {
      const raw = getFromStore(STORAGE_TODOS_COMPLETED);
      state.completedRepeatingInstances = raw ? JSON.parse(raw) : {};
    } catch (_) {
      state.completedRepeatingInstances = {};
    }
  }

  function saveTodos() {
    setToStore(STORAGE_TODOS, JSON.stringify(state.todos));
  }

  function saveCompletedRepeating() {
    setToStore(STORAGE_TODOS_COMPLETED, JSON.stringify(state.completedRepeatingInstances));
  }

  /* ---------- 실행 취소 (Ctrl+Z) / 다시 실행 (Ctrl+Shift+Z, Ctrl+Y) ---------- */
  const UNDO_STACK_MAX = 50;
  var globalUndoStack = [];
  var globalRedoStack = [];
  var globalUndoTransactionDepth = 0;
  var globalUndoCoalesceUntil = Object.create(null);

  function deepCloneStateJson(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (_) {
      return obj;
    }
  }

  function captureGlobalUndoPayload() {
    return {
      todos: deepCloneStateJson(state.todos),
      completedRepeatingInstances: deepCloneStateJson(state.completedRepeatingInstances),
      repeatingTodos: deepCloneStateJson(state.repeatingTodos),
      repeatingDayOverrides: deepCloneStateJson(state.repeatingDayOverrides),
      memos: deepCloneStateJson(state.memos),
      memoTabs: deepCloneStateJson(state.memoTabs),
      deletedMemoTabs: deepCloneStateJson(state.deletedMemoTabs),
      specialDates: deepCloneStateJson(state.specialDates),
      todoSectionHeaderNotes: deepCloneStateJson(state.todoSectionHeaderNotes),
      calendarType: state.calendarType === 'lunar' ? 'lunar' : 'solar',
      quoteLines: Array.from(document.querySelectorAll('.quote-line')).map(function (el) { return el.innerHTML; }),
      calendarMemoHtml: (function () {
        var el = document.getElementById('calendar-memo');
        return el ? el.innerHTML : '';
      })()
    };
  }

  function pushUndoSnapshotToStack(json) {
    if (globalUndoStack.length && globalUndoStack[globalUndoStack.length - 1] === json) return;
    globalUndoStack.push(json);
    if (globalUndoStack.length > UNDO_STACK_MAX) globalUndoStack.shift();
    globalRedoStack.length = 0;
  }

  /** 변경 직전 상태를 스택에 넣음(복합 작업은 트랜잭션 사용) */
  var globalUndoCoalescePending = false;
  function pushUndoSnapshot() {
    if (globalUndoCoalescePending) return;
    if (globalUndoTransactionDepth > 0) return;
    pushUndoSnapshotToStack(JSON.stringify(captureGlobalUndoPayload()));
  }

  /** 연속 입력마다 한 번만 스냅샷 (beforeinput과 함께 사용) */
  function pushUndoSnapshotCoalesced(coalesceKey, ms) {
    if (globalUndoTransactionDepth > 0) return;
    coalesceKey = coalesceKey || 'default';
    ms = typeof ms === 'number' ? ms : 420;
    var now = Date.now();
    if (globalUndoCoalesceUntil[coalesceKey] && now < globalUndoCoalesceUntil[coalesceKey]) return;
    globalUndoCoalescePending = true;
    try {
      pushUndoSnapshotToStack(JSON.stringify(captureGlobalUndoPayload()));
    } finally {
      globalUndoCoalescePending = false;
    }
    globalUndoCoalesceUntil[coalesceKey] = now + ms;
  }

  function beginUndoTransaction() {
    if (globalUndoTransactionDepth === 0) {
      pushUndoSnapshotToStack(JSON.stringify(captureGlobalUndoPayload()));
    }
    globalUndoTransactionDepth++;
  }

  function endUndoTransaction() {
    globalUndoTransactionDepth = Math.max(0, globalUndoTransactionDepth - 1);
  }

  function applyGlobalUndoPayload(jsonStr) {
    var snap = JSON.parse(jsonStr);
    state.todos = snap.todos || {};
    state.completedRepeatingInstances = snap.completedRepeatingInstances || {};
    state.repeatingTodos = Array.isArray(snap.repeatingTodos) ? snap.repeatingTodos : [];
    state.repeatingDayOverrides = snap.repeatingDayOverrides && typeof snap.repeatingDayOverrides === 'object' ? snap.repeatingDayOverrides : {};
    state.memos = snap.memos || {};
    state.memoTabs = Array.isArray(snap.memoTabs) ? snap.memoTabs : [];
    state.deletedMemoTabs = Array.isArray(snap.deletedMemoTabs) ? snap.deletedMemoTabs : [];
    state.specialDates = Array.isArray(snap.specialDates) ? snap.specialDates : [];
    state.todoSectionHeaderNotes = snap.todoSectionHeaderNotes && typeof snap.todoSectionHeaderNotes === 'object'
      ? snap.todoSectionHeaderNotes
      : { morning: [], lunch: [], afternoon: [], evening: [] };
    state.calendarType = snap.calendarType === 'lunar' ? 'lunar' : 'solar';

    setToStore(STORAGE_TODOS, JSON.stringify(state.todos));
    setToStore(STORAGE_TODOS_COMPLETED, JSON.stringify(state.completedRepeatingInstances));
    setToStore(STORAGE_REPEATING, JSON.stringify(state.repeatingTodos));
    setToStore(STORAGE_REPEATING_DAY_OVERRIDES, JSON.stringify(state.repeatingDayOverrides));
    setToStore(STORAGE_MEMOS, JSON.stringify(state.memos));
    setToStore(STORAGE_MEMO_TABS, JSON.stringify(state.memoTabs));
    setToStore(STORAGE_DELETED_MEMO_TABS, JSON.stringify(state.deletedMemoTabs));
    setToStore(STORAGE_SPECIAL_DATES, JSON.stringify(state.specialDates));
    setToStore(STORAGE_TODO_SECTION_NOTES, JSON.stringify(state.todoSectionHeaderNotes));
    setToStore(STORAGE_CALENDAR_TYPE, state.calendarType);
    setToStore(STORAGE_QUOTE, JSON.stringify(snap.quoteLines || []));
    setToStore(STORAGE_CALENDAR_MEMO, snap.calendarMemoHtml != null ? String(snap.calendarMemoHtml) : '');

    var lines = snap.quoteLines || [];
    document.querySelectorAll('.quote-line').forEach(function (el, i) {
      if (lines[i] !== undefined) el.innerHTML = lines[i];
    });
    var calMemoEl = document.getElementById('calendar-memo');
    if (calMemoEl) calMemoEl.innerHTML = snap.calendarMemoHtml != null ? snap.calendarMemoHtml : '';

    renderMemoTabs();
    showMemoContent();
    renderCalendar();
    renderTodos();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
    updateCalendarTypeUI();
    renderCategoryManageList();
    updateMemoCompletedTotalFooter();
    loadQuote();
  }

  function performGlobalUndo() {
    if (globalUndoStack.length < 1) return;
    var cur = JSON.stringify(captureGlobalUndoPayload());
    var prev = globalUndoStack.pop();
    globalRedoStack.push(cur);
    applyGlobalUndoPayload(prev);
  }

  function performGlobalRedo() {
    if (globalRedoStack.length < 1) return;
    var cur = JSON.stringify(captureGlobalUndoPayload());
    var next = globalRedoStack.pop();
    globalUndoStack.push(cur);
    applyGlobalUndoPayload(next);
  }

  function initGlobalUndoListeners() {
    document.addEventListener('beforeinput', function (e) {
      if (e.isComposing) return;
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('#calendar-memo')) {
        pushUndoSnapshotCoalesced('calMemo', 450);
        return;
      }
      if (t.closest('.memo-item-content-rich')) {
        pushUndoSnapshotCoalesced('memoRich', 450);
        return;
      }
      if (t.closest('.memo-item-title')) {
        pushUndoSnapshotCoalesced('memoTitle', 450);
        return;
      }
      if (t.closest('.quote-line')) {
        pushUndoSnapshotCoalesced('quote', 450);
        return;
      }
      if (t.closest('.todo-item-title-input, .todo-item-desc-input')) {
        pushUndoSnapshotCoalesced('todoTxt', 450);
        return;
      }
      if (t.closest('.cal-full-todo-title-input')) {
        pushUndoSnapshotCoalesced('todoFullTxt', 450);
        return;
      }
      if (t.closest('#todo-title, #todo-desc')) {
        pushUndoSnapshotCoalesced('todoModalTxt', 450);
        return;
      }
      if (t.closest('.section-header-note')) {
        pushUndoSnapshotCoalesced('secHdr', 450);
        return;
      }
      if (t.closest('.memo-reorder-name')) {
        pushUndoSnapshotCoalesced('memoTabName', 450);
      }
      if (t.closest('.special-dates-item-label-input')) {
        pushUndoSnapshotCoalesced('specialDateLabel', 450);
      }
    }, true);

    document.addEventListener('keydown', function (e) {
      var ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      var k = e.key;
      if (k !== 'z' && k !== 'Z' && k !== 'y' && k !== 'Y') return;
      /* 입력칸·contenteditable에서도 전역 되돌리기 (브라우저 기본 Ctrl+Z 대신) */
      if (k === 'y' || k === 'Y') {
        e.preventDefault();
        e.stopPropagation();
        performGlobalRedo();
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        performGlobalRedo();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      performGlobalUndo();
    }, true);
  }

  function loadRepeating() {
    try {
      const raw = getFromStore(STORAGE_REPEATING);
      state.repeatingTodos = raw ? JSON.parse(raw) : [];
      state.repeatingTodos.forEach((t, idx) => {
        if (t.important === true) t.important = 'red';
        if (t.important !== false && t.important !== 'blue' && t.important !== 'red') t.important = false;
        if (typeof t.order !== 'number' || isNaN(t.order)) t.order = idx * 10000;
        if (t.contentRevisions != null && !Array.isArray(t.contentRevisions)) delete t.contentRevisions;
        if (Array.isArray(t.contentRevisions)) {
          t.contentRevisions = t.contentRevisions.filter(function (r) {
            return r && r.fromKey && String(r.fromKey).length >= 10;
          }).map(function (r) {
            return {
              fromKey: String(r.fromKey).slice(0, 10),
              title: r.title != null ? r.title : '',
              desc: r.desc != null ? r.desc : ''
            };
          });
          if (t.contentRevisions.length === 0) delete t.contentRevisions;
          else t.contentRevisions.sort(function (a, b) { return a.fromKey.localeCompare(b.fromKey); });
        }
      });
    } catch (_) {
      state.repeatingTodos = [];
    }
  }

  function saveRepeating() {
    setToStore(STORAGE_REPEATING, JSON.stringify(state.repeatingTodos));
  }

  function loadRepeatingDayOverrides() {
    try {
      const raw = getFromStore(STORAGE_REPEATING_DAY_OVERRIDES);
      const p = raw ? JSON.parse(raw) : {};
      state.repeatingDayOverrides = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    } catch (_) {
      state.repeatingDayOverrides = {};
    }
  }

  function saveRepeatingDayOverrides() {
    setToStore(STORAGE_REPEATING_DAY_OVERRIDES, JSON.stringify(state.repeatingDayOverrides));
  }

  /** 반복 일정 삭제 시 해당 id의 날짜별 배치/순서 덮어쓰기 제거 */
  function removeRepeatingDayOverridesForRealId(realId) {
    if (!realId) return;
    let touched = false;
    Object.keys(state.repeatingDayOverrides || {}).forEach(function (dkey) {
      const m = state.repeatingDayOverrides[dkey];
      if (m && m[realId]) {
        delete m[realId];
        touched = true;
        if (Object.keys(m).length === 0) delete state.repeatingDayOverrides[dkey];
      }
    });
    if (touched) saveRepeatingDayOverrides();
  }

  function parseLocalDate(dateStr) {
    if (!dateStr || String(dateStr).length < 10) return null;
    var s = String(dateStr).replace(/\./g, '-');
    var parts = s.split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  function repeatingAppliesToDate(t, key) {
    if (t.repeat === 'none') return false;
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const start = parseLocalDate(t.rangeStart) || (t.originKey ? parseLocalDate(t.originKey) : null);
    const end = parseLocalDate(t.rangeEnd);
    if (start && date < start) return false;
    if (end && date > end) return false;
    const origin = t.originKey ? new Date(t.originKey) : date;
    if (t.repeat === 'daily') return true;
    if (t.repeat === 'weekly') return date.getDay() === origin.getDay() && (!start || date >= start);
    if (t.repeat === 'monthly') return date.getDate() === origin.getDate();
    if (t.repeat === 'monthly_last') return date.getDate() === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() && (!start || date >= start) && (!end || date <= end);
    if (t.repeat === 'range') {
      const rd = t.rangeDays;
      if (rd && (rd.mon || rd.tue || rd.wed || rd.thu || rd.fri || rd.sat || rd.sun || rd.holiday)) {
        const day = date.getDay();
        const isHoliday = !!getHolidayName(key);
        var onHoliday = isHoliday && (rd.holiday !== false);
        return (day === 1 && (rd.mon !== false)) || (day === 2 && (rd.tue !== false)) || (day === 3 && (rd.wed !== false)) || (day === 4 && (rd.thu !== false)) || (day === 5 && (rd.fri !== false)) || (day === 6 && (rd.sat !== false)) || (day === 0 && (rd.sun !== false)) || onHoliday;
      }
      return true;
    }
    return true;
  }

  /** 반복 할일: dateKey 기준으로 표시할 제목·내용 (contentRevisions 없으면 r.title/desc) */
  function getRepeatingContentForDate(r, dateKey) {
    if (!r || !dateKey) return { title: r ? (r.title || '') : '', desc: r ? (r.desc || '') : '' };
    const revs = r.contentRevisions;
    if (!revs || !Array.isArray(revs) || revs.length === 0) {
      return { title: r.title != null ? r.title : '', desc: r.desc != null ? r.desc : '' };
    }
    let best = null;
    for (let i = 0; i < revs.length; i++) {
      const rev = revs[i];
      if (!rev || rev.fromKey == null) continue;
      const fk = String(rev.fromKey).slice(0, 10);
      if (fk <= dateKey) {
        if (!best || fk > String(best.fromKey).slice(0, 10)) best = rev;
      }
    }
    if (!best) return { title: r.title != null ? r.title : '', desc: r.desc != null ? r.desc : '' };
    return {
      title: best.title != null ? best.title : '',
      desc: best.desc != null ? best.desc : ''
    };
  }

  /** 반복 할일: fromKey 날짜부터 이후 모든 occurrence 에 새 제목·내용 적용 (이전 날짜는 기존 대로) */
  function applyRepeatingTitleDescFromDate(r, fromKey, newTitle, newDesc) {
    if (!r || !fromKey) return;
    const fk = String(fromKey).slice(0, 10);
    const origin = String(r.originKey || '1970-01-01').slice(0, 10);
    let revs = (r.contentRevisions && Array.isArray(r.contentRevisions) && r.contentRevisions.length)
      ? r.contentRevisions.map(function (x) {
        return {
          fromKey: String(x.fromKey || '').slice(0, 10),
          title: x.title != null ? x.title : '',
          desc: x.desc != null ? x.desc : ''
        };
      })
      : [{ fromKey: origin, title: r.title != null ? r.title : '', desc: r.desc != null ? r.desc : '' }];
    revs = revs.filter(function (rev) { return rev.fromKey < fk; });
    revs.push({
      fromKey: fk,
      title: newTitle != null ? newTitle : '',
      desc: newDesc != null ? newDesc : ''
    });
    revs.sort(function (a, b) { return a.fromKey.localeCompare(b.fromKey); });
    r.contentRevisions = revs;
    r.title = newTitle != null ? newTitle : '';
    r.desc = newDesc != null ? newDesc : '';
  }

  function todoSortOrder(a, b) {
    if (a.completed !== b.completed) return (a.completed ? 1 : 0) - (b.completed ? 1 : 0);
    const ao = typeof a.order === 'number' && !isNaN(a.order) ? a.order : null;
    const bo = typeof b.order === 'number' && !isNaN(b.order) ? b.order : null;
    if (ao !== null && bo !== null) {
      if (ao !== bo) return ao - bo;
      return String(a.id).localeCompare(String(b.id));
    }
    if (ao !== null) return -1;
    if (bo !== null) return 1;
    const ar = !!(a.repeat && a.repeat !== 'none');
    const br = !!(b.repeat && b.repeat !== 'none');
    const c = (br ? 1 : 0) - (ar ? 1 : 0);
    if (c !== 0) return c;
    return String(a.id).localeCompare(String(b.id));
  }
  function getTodosForDate(key) {
    let list = (state.todos[key] || []).slice();
    state.repeatingTodos.forEach(t => {
      if (repeatingAppliesToDate(t, key)) {
        const instanceId = t.id + '_' + key;
        const ov = (state.repeatingDayOverrides[key] || {})[t.id] || {};
        const effSection = ov.section != null && ov.section !== '' ? ov.section : (t.section || 'morning');
        const text = getRepeatingContentForDate(t, key);
        const inst = {
          ...t,
          id: instanceId,
          section: effSection,
          title: text.title,
          desc: text.desc,
          completed: !!state.completedRepeatingInstances[instanceId]
        };
        if (typeof ov.order === 'number' && !isNaN(ov.order)) inst.order = ov.order;
        list.push(inst);
      }
    });
    list = list.filter(t => !isDeletedTabId(t.memoTabId) && isTodoMemoTabActive(t));
    const out = { morning: [], lunch: [], afternoon: [], evening: [] };
    list.forEach(t => {
      if (out[t.section]) out[t.section].push(t);
    });
    ['morning', 'lunch', 'afternoon', 'evening'].forEach(s => {
      if (out[s].length) out[s].sort(todoSortOrder);
    });
    return out;
  }

  /** ⊕로 추가할 때: 해당 날짜·섹션 미완료 중 가장 뒤(최대 order 이후) */
  function getNextTodoOrderAppendToSection(key, section) {
    const by = getTodosForDate(key);
    const items = (by[section] || []).filter(t => !t.completed);
    let maxO = -Infinity;
    items.forEach(function (t) {
      if (typeof t.order === 'number' && !isNaN(t.order)) maxO = Math.max(maxO, t.order);
    });
    if (maxO === -Infinity) return Math.max(0, items.length * 1000);
    return maxO + 1000;
  }

  const TODO_SECTIONS = ['morning', 'lunch', 'afternoon', 'evening'];

  /** 신규 반복 할일: 해당 날짜·섹션(오전/점심/오후/저녁) 미완료 목록 맨 위에 오도록 order. 이후 드래그 시 repeatingDayOverrides.order 로 조정 */
  function getOrderForNewRepeatingTodoAtSectionTop(key, section, excludeTodoId) {
    if (!key || !TODO_SECTIONS.includes(section)) return 0;
    const by = getTodosForDate(key);
    const items = (by[section] || []).filter(t => !t.completed && (!excludeTodoId || String(t.id) !== String(excludeTodoId)));
    let minO = Infinity;
    items.forEach(function (t) {
      if (typeof t.order === 'number' && !isNaN(t.order)) minO = Math.min(minO, t.order);
    });
    if (minO === Infinity) return 0;
    return minO - 1000;
  }

  function clearRepeatingDayOrderOverride(key, realId) {
    if (!key || !realId || !state.repeatingDayOverrides[key]) return;
    const cur = state.repeatingDayOverrides[key][realId];
    if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, 'order')) return;
    const next = { ...cur };
    delete next.order;
    if (Object.keys(next).length === 0) {
      delete state.repeatingDayOverrides[key][realId];
      if (Object.keys(state.repeatingDayOverrides[key]).length === 0) {
        delete state.repeatingDayOverrides[key];
      }
    } else {
      state.repeatingDayOverrides[key][realId] = next;
    }
    saveRepeatingDayOverrides();
  }

  function isTodoRepeatingInstanceId(id) {
    return /_\d{4}-\d{2}-\d{2}$/.test(String(id));
  }

  function stripRepeatingInstanceSuffix(id) {
    return String(id).replace(/_\d{4}-\d{2}-\d{2}$/, '');
  }

  /** 미완료만: 반복 인스턴스·일반 할일 포함, 화면과 동일한 순서 */
  function getVisibleSectionTodosForMove(key, section) {
    const by = getTodosForDate(key);
    return (by[section] || []).filter(t => !t.completed);
  }

  function getSectionTodoListForMove(key, section) {
    return getVisibleSectionTodosForMove(key, section);
  }

  function normalizeOrdersInSection(key, section) {
    const vis = getVisibleSectionTodosForMove(key, section);
    let dayOvChanged = false;
    vis.forEach((t, i) => {
      const o = i * 1000;
      if (isTodoRepeatingInstanceId(t.id)) {
        const realId = stripRepeatingInstanceSuffix(t.id);
        if (!state.repeatingDayOverrides[key]) state.repeatingDayOverrides[key] = {};
        const cur = state.repeatingDayOverrides[key][realId] || {};
        state.repeatingDayOverrides[key][realId] = { ...cur, order: o };
        dayOvChanged = true;
      } else {
        const t0 = (state.todos[key] || []).find(x => x.id === t.id);
        if (t0) t0.order = o;
      }
    });
    if (dayOvChanged) saveRepeatingDayOverrides();
  }

  /** 드롭 앵커 행 기준, 항목 제거 전 섹션 내 삽입 인덱스(0…len) */
  function computeTodoSectionInsertIndexBeforeRemoval(key, section, targetEl, insertAbove) {
    const arr = getVisibleSectionTodosForMove(key, section);
    if (!targetEl || !targetEl.dataset || !targetEl.dataset.id) return arr.length;
    const pos = arr.findIndex(t => t.id === targetEl.dataset.id);
    if (pos < 0) return arr.length;
    return insertAbove ? pos : pos + 1;
  }

  function cleanupTodoDragVisualState() {
    var _tdt = document.getElementById('todo-desc-tooltip');
    if (_tdt) _tdt.style.display = 'none';
    if (todoDescTooltipHideTimer) {
      clearTimeout(todoDescTooltipHideTimer);
      todoDescTooltipHideTimer = null;
    }
    document.querySelectorAll('.todo-item, .cal-full-day-todo:not(.cal-full-more)').forEach(el => {
      el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
    });
    document.querySelectorAll('.cal-full-day').forEach(el => el.classList.remove('cal-full-day-drag-over'));
    document.querySelectorAll('.todo-section').forEach(s => s.classList.remove('todo-section-drop-zone'));
    document.querySelectorAll('.memo-all-block').forEach(b => b.classList.remove('memo-all-block-drop-over', 'memo-all-block-drop-line'));
    document.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
  }

  /** 같은 날짜 내: 반복(인스턴스 id)·일반 할일 모두 섹션·순서 이동 */
  function moveTodoSmart(key, dragId, toSection, toIndexInSection) {
    if (!key || !TODO_SECTIONS.includes(toSection)) return;
    pushUndoSnapshot();
    let fromSection = null;
    for (const s of TODO_SECTIONS) {
      if (getVisibleSectionTodosForMove(key, s).some(t => t.id === dragId)) {
        fromSection = s;
        break;
      }
    }
    if (!fromSection) return;

    normalizeOrdersInSection(key, fromSection);
    if (toSection !== fromSection) normalizeOrdersInSection(key, toSection);

    if (toSection !== fromSection) {
      if (isTodoRepeatingInstanceId(dragId)) {
        const realId = stripRepeatingInstanceSuffix(dragId);
        const tmpl = state.repeatingTodos.find(x => x.id === realId);
        if (tmpl) {
          if (!state.repeatingDayOverrides[key]) state.repeatingDayOverrides[key] = {};
          const cur = state.repeatingDayOverrides[key][realId] || {};
          const defSec = tmpl.section || 'morning';
          if (toSection === defSec) {
            const next = { ...cur };
            delete next.section;
            if (Object.keys(next).length === 0) delete state.repeatingDayOverrides[key][realId];
            else state.repeatingDayOverrides[key][realId] = next;
          } else {
            state.repeatingDayOverrides[key][realId] = { ...cur, section: toSection };
          }
          if (state.repeatingDayOverrides[key] && Object.keys(state.repeatingDayOverrides[key]).length === 0) {
            delete state.repeatingDayOverrides[key];
          }
          saveRepeatingDayOverrides();
        }
      } else {
        const t = (state.todos[key] || []).find(x => x.id === dragId);
        if (t) t.section = toSection;
      }
    }

    const toVis = getVisibleSectionTodosForMove(key, toSection).slice();
    const dragPos = toVis.findIndex(t => t.id === dragId);
    if (dragPos < 0) return;

    const [item] = toVis.splice(dragPos, 1);
    let insertAt = toIndexInSection;
    if (dragPos < insertAt) insertAt -= 1;
    insertAt = Math.max(0, Math.min(insertAt, toVis.length));
    toVis.splice(insertAt, 0, item);

    toVis.forEach((t, i) => {
      const o = i * 1000;
      if (isTodoRepeatingInstanceId(t.id)) {
        const realId = stripRepeatingInstanceSuffix(t.id);
        if (!state.repeatingDayOverrides[key]) state.repeatingDayOverrides[key] = {};
        const cur = state.repeatingDayOverrides[key][realId] || {};
        state.repeatingDayOverrides[key][realId] = { ...cur, order: o };
      } else {
        const t0 = (state.todos[key] || []).find(x => x.id === t.id);
        if (t0) t0.order = o;
      }
    });

    if (toSection !== fromSection) {
      const fromVis = getVisibleSectionTodosForMove(key, fromSection);
      fromVis.forEach((t, i) => {
        const o = i * 1000;
        if (isTodoRepeatingInstanceId(t.id)) {
          const realId = stripRepeatingInstanceSuffix(t.id);
          if (!state.repeatingDayOverrides[key]) state.repeatingDayOverrides[key] = {};
          const cur = state.repeatingDayOverrides[key][realId] || {};
          state.repeatingDayOverrides[key][realId] = { ...cur, order: o };
        } else {
          const t0 = (state.todos[key] || []).find(x => x.id === t.id);
          if (t0) t0.order = o;
        }
      });
    }

    saveRepeatingDayOverrides();
    ensureTodoOrderForKey(key);
    saveTodos();
    renderTodos();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
  }

  function moveTodo(key, todoId, toSection, toIndexInSection) {
    moveTodoSmart(key, todoId, toSection, toIndexInSection);
  }

  function moveTodoToDate(fromKey, todoId, toKey, toSection, toIndexInSection) {
    const isRepeatingInstance = (id) => /_\d{4}-\d{2}-\d{2}$/.test(String(id));
    if (!fromKey || !toKey || !TODO_SECTIONS.includes(toSection)) return;
    const fromAll = state.todos[fromKey] || [];
    const fromIndex = fromAll.findIndex(t => t.id === todoId);
    if (fromIndex < 0) return;
    pushUndoSnapshot();
    const [moved] = fromAll.splice(fromIndex, 1);
    state.todos[fromKey] = fromAll.length ? fromAll : [];
    ensureTodoOrderForKey(fromKey);
    moved.section = toSection;
    const toAll = state.todos[toKey] || [];
    const toNonRepeat = toAll.filter(t => !isRepeatingInstance(t.id));
    const bySec = { morning: [], lunch: [], afternoon: [], evening: [] };
    toNonRepeat.forEach(t => { if (bySec[t.section]) bySec[t.section].push(t); });
    const targetList = bySec[toSection] || [];
    const insertAt = Math.max(0, Math.min(toIndexInSection, targetList.length));
    targetList.splice(insertAt, 0, moved);
    bySec[toSection] = targetList;
    const nonRepeatingOrdered = TODO_SECTIONS.flatMap(s => bySec[s] || []);
    const repeatingTo = toAll.filter(t => isRepeatingInstance(t.id));
    const bySecWithRepeat = { morning: [], lunch: [], afternoon: [], evening: [] };
    nonRepeatingOrdered.forEach(t => { if (bySecWithRepeat[t.section]) bySecWithRepeat[t.section].push(t); });
    repeatingTo.forEach(t => { if (bySecWithRepeat[t.section]) bySecWithRepeat[t.section].push(t); });
    state.todos[toKey] = TODO_SECTIONS.flatMap(s => bySecWithRepeat[s] || []);
    saveTodos();
    renderTodos();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
  }

  function ensureTodoOrderForKey(key) {
    if (!state.todos[key]) state.todos[key] = [];
    const bySection = { morning: [], lunch: [], afternoon: [], evening: [] };
    state.todos[key].forEach(t => {
      if (bySection[t.section]) bySection[t.section].push(t);
    });
    state.todos[key] = TODO_SECTIONS.flatMap(s => bySection[s] || []);
    saveTodos();
  }

  function addTodoAtKey(key, section, indexInSection, fields) {
    if (!key || !TODO_SECTIONS.includes(section)) return;
    pushUndoSnapshot();
    const tid = fields.memoTabId || getPersonalTabId();
    const mtab = getMemoTabById(tid);
    if (!mtab || !isMemoTabInActivePeriod(mtab)) {
      alert('사용 기간이 아닌 분류에는 일정을 추가할 수 없습니다.');
      return;
    }
    if (!state.todos[key]) state.todos[key] = [];
    const id = 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const newTodo = {
      id,
      title: fields.title || '',
      desc: fields.desc || '',
      section,
      repeat: 'none',
      rangeStart: '',
      rangeEnd: '',
      important: false,
      completed: false,
      order: state.todos[key].length,
      memoTabId: fields.memoTabId || getPersonalTabId() || undefined
    };
    const bySec = { morning: [], lunch: [], afternoon: [], evening: [] };
    (state.todos[key] || []).forEach(t => {
      if (bySec[t.section]) bySec[t.section].push(t);
    });
    const list = bySec[section] || [];
    const insertAt = Math.max(0, Math.min(indexInSection, list.length));
    if (insertAt >= list.length) {
      newTodo.order = getNextTodoOrderAppendToSection(key, section);
    }
    list.splice(insertAt, 0, newTodo);
    bySec[section] = list;
    state.todos[key] = TODO_SECTIONS.flatMap(s => bySec[s] || []);
    saveTodos();
    renderTodos();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
  }

  function convertTodoToMemo(todoKey, todoId, targetTabId, insertIndex) {
    if (!isMemoTabInActivePeriod(getMemoTabById(targetTabId))) return;
    const list = state.todos[todoKey] || [];
    const isRepeating = /_\d{4}-\d{2}-\d{2}$/.test(String(todoId));
    if (isRepeating) return;
    const t = list.find(x => x.id === todoId);
    if (!t) return;
    beginUndoTransaction();
    try {
    const items = ensureMemoItems(targetTabId);
    const incomplete = items.filter(m => !m.completed);
    const completed = items.filter(m => m.completed);
    const title = [t.title, t.desc].filter(Boolean).join(' ');
    const newMemo = { id: 'mi_' + Date.now(), title: title || '(제목 없음)', completed: false, content: '', important: false };
    const at = typeof insertIndex === 'number' && insertIndex >= 0 && insertIndex <= incomplete.length ? insertIndex : incomplete.length;
    const newIncomplete = [...incomplete.slice(0, at), newMemo, ...incomplete.slice(at)];
    state.memos[targetTabId] = [...newIncomplete, ...completed];
    saveMemos();
    deleteTodo(todoId, todoKey);
    } finally {
      endUndoTransaction();
    }
    if (state.viewAllMemos) showMemoContent(); else if (state.activeMemoTabId === targetTabId) renderMemoItemList(targetTabId);
  }

  function convertMemoToTodo(tabId, itemId, targetKey, targetSection, targetIndexInSection) {
    if (!isMemoTabInActivePeriod(getMemoTabById(tabId))) return;
    const items = ensureMemoItems(tabId);
    const m = items.find(x => x.id === itemId);
    if (!m) return;
    beginUndoTransaction();
    try {
      addTodoAtKey(targetKey, targetSection, targetIndexInSection, { title: m.title || '', desc: memoContentToPlain(m.content || ''), memoTabId: tabId });
    state.memos[tabId] = items.filter(x => x.id !== itemId);
    saveMemos();
    } finally {
      endUndoTransaction();
    }
    if (state.viewAllMemos) showMemoContent(); else if (state.activeMemoTabId === tabId) renderMemoItemList(tabId);
  }

  function addTodoInline(section) {
    const key = dateKey(state.selectedDate);
    if (!key) return;
    if (!getPersonalTabId()) {
      alert('사용 가능한 분류가 없습니다. 분류 구성에서 기간(시작·종료일)을 확인하세요.');
      return;
    }
    pushUndoSnapshot();
    if (!state.todos[key]) state.todos[key] = [];
    const sec = section || 'morning';
    const id = 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const newTodo = {
      id,
      title: '',
      desc: '',
      section: sec,
      repeat: 'none',
      rangeStart: '',
      rangeEnd: '',
      important: false,
      completed: false,
      order: getNextTodoOrderAppendToSection(key, sec),
      memoTabId: getPersonalTabId() || undefined
    };
    state.todos[key].push(newTodo);
    ensureTodoOrderForKey(key);
    renderTodos();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
  }

  /** 달력 전체 보기 ⊕: 해당 날짜 목록(오전→…→저녁) 시각적 맨 아래에 추가 */
  function addTodoAtBottomOfCalendarDay(dateKey) {
    const key = dateKey && String(dateKey).length >= 10 ? String(dateKey).slice(0, 10) : '';
    if (!key) return;
    if (!getPersonalTabId()) {
      alert('사용 가능한 분류가 없습니다. 분류 구성에서 기간(시작·종료일)을 확인하세요.');
      return;
    }
    pushUndoSnapshot();
    if (!state.todos[key]) state.todos[key] = [];
    const by = getTodosForDate(key);
    const sectionOrder = ['morning', 'lunch', 'afternoon', 'evening'];
    const todosAll = sectionOrder.flatMap(function (s) {
      return (by[s] || []).filter(function (t) { return !t.completed; });
    });
    var sec = 'morning';
    if (todosAll.length > 0) {
      var last = todosAll[todosAll.length - 1];
      sec = (last && last.section) || 'morning';
      if (TODO_SECTIONS.indexOf(sec) < 0) sec = 'morning';
    }
    const id = 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const newTodo = {
      id,
      title: '',
      desc: '',
      section: sec,
      repeat: 'none',
      rangeStart: '',
      rangeEnd: '',
      important: false,
      completed: false,
      order: getNextTodoOrderAppendToSection(key, sec),
      memoTabId: getPersonalTabId() || undefined
    };
    state.todos[key].push(newTodo);
    ensureTodoOrderForKey(key);
    renderTodos();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
  }

  function updateTodoFields(id, fields, fromKey, opts) {
    opts = opts || {};
    const skipListReRender = !!opts.skipListReRender;
    const key = fromKey !== undefined ? fromKey : dateKey(state.selectedDate);
    if (!key) return;
    const isRepeatingInstance = /_\d{4}-\d{2}-\d{2}$/.test(String(id));
    const realId = isRepeatingInstance ? String(id).replace(/_\d{4}-\d{2}-\d{2}$/, '') : id;
    if (!isRepeatingInstance && state.todos[key]) {
      const t = state.todos[key].find(x => x.id === id);
      if (t) {
        if (!isTodoMemoTabActive(t)) return;
        if (fields.memoTabId !== undefined) {
          const nid = fields.memoTabId || getPersonalTabId();
          const nt = getMemoTabById(nid);
          if (!nt || !isMemoTabInActivePeriod(nt)) return;
        }
        if (fields.title !== undefined) t.title = fields.title;
        if (fields.desc !== undefined) t.desc = fields.desc;
        if (fields.memoTabId !== undefined) t.memoTabId = fields.memoTabId || undefined;
        if (fields.title !== undefined || fields.desc !== undefined) {
          const kn = String(key).slice(0, 10);
          if (kn.length >= 10) {
            Object.keys(state.todos).forEach(function (d2) {
              if (!d2 || String(d2).length < 10 || d2 <= kn) return;
              const list = state.todos[d2];
              if (!list || !list.length) return;
              const t2 = list.find(function (x) { return x.id === id; });
              if (t2) {
                if (fields.title !== undefined) t2.title = fields.title;
                if (fields.desc !== undefined) t2.desc = fields.desc;
              }
            });
          }
        }
        saveTodos();
        if (fields.title !== undefined || fields.desc !== undefined) {
          if (!skipListReRender) {
            renderTodos();
            if (state.viewMode === 'calendarFull') renderCalendarFull();
          }
        }
        return;
      }
    }
    const r = state.repeatingTodos.find(x => x.id === realId);
    if (r) {
      if (!repeatingTodoMemoTabActive(r)) return;
      if (fields.memoTabId !== undefined) {
        const nid = fields.memoTabId || getPersonalTabId();
        const nt = getMemoTabById(nid);
        if (!nt || !isMemoTabInActivePeriod(nt)) return;
      }
      if (fields.title !== undefined || fields.desc !== undefined) {
        const cur = getRepeatingContentForDate(r, key);
        const nt = fields.title !== undefined ? fields.title : cur.title;
        const nd = fields.desc !== undefined ? fields.desc : cur.desc;
        applyRepeatingTitleDescFromDate(r, key, nt, nd);
      }
      if (fields.memoTabId !== undefined) r.memoTabId = fields.memoTabId || undefined;
      saveRepeating();
      if (fields.title !== undefined || fields.desc !== undefined) {
        if (!skipListReRender) {
          renderTodos();
          if (state.viewMode === 'calendarFull') renderCalendarFull();
        }
      }
    }
  }

  function addOrUpdateTodo(payload) {
    const key = dateKey(state.selectedDate);
    if (!state.todos[key]) state.todos[key] = [];
    function effectiveMemoTabIdForPayload() {
      let mid = payload.memoTabId;
      if (payload.id) {
        const idx0 = state.todos[key].findIndex(t => t.id === payload.id);
        if (idx0 >= 0) {
          const ex = state.todos[key][idx0];
          if (mid === undefined) mid = ex.memoTabId;
        } else {
          const realId = String(payload.id).replace(/_\d{4}-\d{2}-\d{2}$/, '');
          const rep = state.repeatingTodos.find(r => r.id === realId || r.id === payload.id);
          if (rep && mid === undefined) mid = rep.memoTabId;
        }
      }
      mid = mid || getPersonalTabId();
      return mid;
    }
    const effMid = effectiveMemoTabIdForPayload();
    const effTab = getMemoTabById(effMid);
    if (!effTab || !isMemoTabInActivePeriod(effTab)) {
      alert('사용 기간이 아닌 분류에는 일정을 추가·수정할 수 없습니다.');
      return;
    }
    pushUndoSnapshot();
    if (payload.id) {
      const idx = state.todos[key].findIndex(t => t.id === payload.id);
      if (idx >= 0) {
        const updated = { ...state.todos[key][idx], ...payload };
        if (updated.repeat && updated.repeat !== 'none') {
          const repIdx = state.repeatingTodos.findIndex(r => r.id === payload.id);
          const originKey = (state.repeatingTodos[repIdx] && state.repeatingTodos[repIdx].originKey) || key;
          const sec = updated.section || 'morning';
          if (repIdx >= 0) {
            const ex = state.repeatingTodos[repIdx];
            if (payload.title !== undefined || payload.desc !== undefined) {
              const curDisp = getRepeatingContentForDate(ex, key);
              applyRepeatingTitleDescFromDate(ex, key,
                payload.title !== undefined ? payload.title : curDisp.title,
                payload.desc !== undefined ? payload.desc : curDisp.desc);
            }
            state.repeatingTodos[repIdx] = { ...ex, ...payload, originKey };
        } else {
            const topOrder = getOrderForNewRepeatingTodoAtSectionTop(key, sec, payload.id);
            state.repeatingTodos.push({ ...updated, originKey, order: topOrder });
            clearRepeatingDayOrderOverride(key, payload.id);
          }
          state.todos[key].splice(idx, 1);
        } else {
          state.todos[key][idx] = updated;
          state.repeatingTodos = state.repeatingTodos.filter(r => r.id !== payload.id);
        }
        saveTodos();
        saveRepeating();
        renderTodos();
        return;
      }
      const repIdx = state.repeatingTodos.findIndex(r => r.id === payload.id);
      if (repIdx >= 0) {
        const prev = state.repeatingTodos[repIdx];
        const updated = { ...prev, ...payload };
        const originKey = prev.originKey || key;
        const noRepeat = !updated.repeat || updated.repeat === 'none';
        if (noRepeat) {
          const textAtKey = getRepeatingContentForDate(prev, key);
          state.repeatingTodos = state.repeatingTodos.filter(r => r.id !== payload.id);
        saveRepeating();
          const instanceId = String(payload.id) + '_' + key;
          const wasCompleted = !!state.completedRepeatingInstances[instanceId];
          const pref = String(payload.id) + '_';
          Object.keys(state.completedRepeatingInstances).forEach(k => {
            if (k.startsWith(pref)) delete state.completedRepeatingInstances[k];
          });
          saveCompletedRepeating();
          if (!state.todos[key]) state.todos[key] = [];
          const plain = {
            id: payload.id,
            title: updated.title != null ? updated.title : textAtKey.title,
            desc: updated.desc != null ? updated.desc : textAtKey.desc,
            section: updated.section || 'morning',
            repeat: 'none',
            rangeStart: '',
            rangeEnd: '',
            important: updated.important !== undefined && updated.important !== null ? updated.important : false,
            completed: wasCompleted,
            order: (state.todos[key] || []).length,
            memoTabId: updated.memoTabId || getPersonalTabId() || undefined
          };
          const existingIdx = state.todos[key].findIndex(t => t.id === payload.id);
          if (existingIdx >= 0) {
            state.todos[key][existingIdx] = plain;
          } else {
            state.todos[key].push(plain);
          }
          ensureTodoOrderForKey(key);
          saveTodos();
        renderTodos();
          if (state.viewMode === 'calendarFull') renderCalendarFull();
          return;
        }
        if (payload.title !== undefined || payload.desc !== undefined) {
          const curDisp = getRepeatingContentForDate(prev, key);
          applyRepeatingTitleDescFromDate(prev, key,
            payload.title !== undefined ? payload.title : curDisp.title,
            payload.desc !== undefined ? payload.desc : curDisp.desc);
        }
        state.repeatingTodos[repIdx] = { ...prev, ...payload, originKey };
        saveRepeating();
        renderTodos();
        if (state.viewMode === 'calendarFull') renderCalendarFull();
        return;
      }
    }
    const id = 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const defaultRangeDays = { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true, holiday: true };
    const rangeDays = payload.repeat === 'range' && payload.rangeDays
      ? payload.rangeDays
      : (payload.repeat === 'range' ? defaultRangeDays : undefined);
    const newTodo = {
      id,
      title: payload.title || '',
      desc: payload.desc || '',
      section: payload.section || 'morning',
      repeat: payload.repeat || 'none',
      rangeStart: payload.rangeStart || '',
      rangeEnd: payload.rangeEnd || '',
      rangeDays: rangeDays,
      important: (payload.important === 'blue' || payload.important === 'red') ? payload.important : false,
      completed: false,
      order: state.todos[key].length,
      memoTabId: payload.memoTabId || undefined
    };
    state.todos[key].push(newTodo);
    if (newTodo.repeat && newTodo.repeat !== 'none') {
      const topOrder = getOrderForNewRepeatingTodoAtSectionTop(key, newTodo.section || 'morning', newTodo.id);
      state.repeatingTodos.push({ ...newTodo, originKey: key, order: topOrder });
      saveRepeating();
    }
    saveTodos();
    renderTodos();
  }

  function nextImportant(current) {
    if (!current || current === '0' || current === 'false') return 'blue';
    if (current === 'blue') return 'red';
    return false;
  }
  function setTodoImportant(id, important, fromKey) {
    const key = fromKey !== undefined ? fromKey : dateKey(state.selectedDate);
    if (!key) return;
    pushUndoSnapshot();
    const isRepeatingInstance = /_\d{4}-\d{2}-\d{2}$/.test(String(id));
    const realId = isRepeatingInstance ? String(id).replace(/_\d{4}-\d{2}-\d{2}$/, '') : id;
    if (!isRepeatingInstance && state.todos[key]) {
      const t = state.todos[key].find(x => x.id === id);
      if (t) {
        if (!isTodoMemoTabActive(t)) return;
        t.important = important;
        saveTodos();
        renderTodos();
        return;
      }
    }
    const r = state.repeatingTodos.find(x => x.id === realId);
    if (r) {
      if (!repeatingTodoMemoTabActive(r)) return;
      r.important = important;
      saveRepeating();
      renderTodos();
    }
  }

  function setTodoCompleted(id, completed, fromKey) {
    const key = fromKey !== undefined ? fromKey : dateKey(state.selectedDate);
    pushUndoSnapshot();
    const isRepeatingInstance = /_\d{4}-\d{2}-\d{2}$/.test(String(id));
    if (isRepeatingInstance) {
      const realId = String(id).replace(/_\d{4}-\d{2}-\d{2}$/, '');
      const r = state.repeatingTodos.find(x => x.id === realId);
      if (!repeatingTodoMemoTabActive(r)) return;
      if (completed) state.completedRepeatingInstances[id] = true;
      else delete state.completedRepeatingInstances[id];
      saveCompletedRepeating();
    } else if (key && state.todos[key]) {
      const t = state.todos[key].find(x => x.id === id);
      if (t) {
        if (!isTodoMemoTabActive(t)) return;
        t.completed = !!completed;
        saveTodos();
      }
    }
    renderTodos();
  }

  function openRepeatDeleteModal(instanceId, key) {
    const modal = document.getElementById('repeat-delete-modal');
    if (!modal) {
      deleteTodoConfirm(instanceId, key, 'all');
      return;
    }
    state.repeatDeleteTarget = { id: instanceId, key };
    const radios = modal.querySelectorAll('input[name="repeat-delete-scope"]');
    radios.forEach(r => { if (r.value === 'single') r.checked = true; });
    modal.classList.add('show');
  }

  function closeRepeatDeleteModal() {
    const modal = document.getElementById('repeat-delete-modal');
    if (modal) modal.classList.remove('show');
    state.repeatDeleteTarget = null;
  }

  function deleteTodoConfirm(id, fromKey, scope) {
    const key = fromKey !== undefined ? fromKey : dateKey(state.selectedDate);
    const isRepeatingInstance = /_\d{4}-\d{2}-\d{2}$/.test(String(id));
    const realId = isRepeatingInstance ? String(id).replace(/_\d{4}-\d{2}-\d{2}$/, '') : id;

    if (isRepeatingInstance) {
      const rep = state.repeatingTodos.find(r => r.id === realId);
      if (!repeatingTodoMemoTabActive(rep)) {
        alert('사용 기간이 지난 분류의 일정은 삭제할 수 없습니다.');
        return;
      }
      pushUndoSnapshot();
      if (scope === 'single') {
        state.completedRepeatingInstances[id] = true;
        saveCompletedRepeating();
      } else if (scope === 'after') {
        if (rep) {
          const cur = new Date(key);
          const end = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - 1);
          const endKey = dateKey(end);
          if (!rep.rangeEnd || rep.rangeEnd > endKey) {
            rep.rangeEnd = endKey;
            saveRepeating();
          }
        }
      } else {
      state.repeatingTodos = state.repeatingTodos.filter(r => r.id !== realId);
      saveRepeating();
        removeRepeatingDayOverridesForRealId(realId);
        Object.keys(state.completedRepeatingInstances).forEach(k => {
          if (k.startsWith(realId + '_')) delete state.completedRepeatingInstances[k];
        });
        saveCompletedRepeating();
    }
    } else if (key && state.todos[key]) {
      const td = state.todos[key].find(x => x.id === id);
      if (td && !isTodoMemoTabActive(td)) {
        alert('사용 기간이 지난 분류의 일정은 삭제할 수 없습니다.');
        return;
      }
      pushUndoSnapshot();
      state.todos[key] = state.todos[key].filter(t => t.id !== id);
      saveTodos();
    }

    renderTodos();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
  }

  function deleteTodo(id, fromKey) {
    const key = fromKey !== undefined ? fromKey : dateKey(state.selectedDate);
    const isRepeatingInstance = /_\d{4}-\d{2}-\d{2}$/.test(String(id));
    if (isRepeatingInstance) {
      const realId = String(id).replace(/_\d{4}-\d{2}-\d{2}$/, '');
      const rep = state.repeatingTodos.find(r => r.id === realId);
      if (!repeatingTodoMemoTabActive(rep)) {
        alert('사용 기간이 지난 분류의 일정은 삭제할 수 없습니다.');
        return;
      }
      openRepeatDeleteModal(id, key);
      return;
    }
    deleteTodoConfirm(id, key, 'all');
  }

  function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const head = ['일','월','화','수','목','금','토'];
    grid.innerHTML = head.map((h, i) => {
      const headClass = i === 0 ? 'cal-day-head cal-head-sun' : i === 6 ? 'cal-day-head cal-head-sat' : 'cal-day-head';
      return `<div class="${headClass}">${h}</div>`;
    }).join('');

    const y = state.currentYear, m = state.currentMonth;
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const startDay = first.getDay();
    const daysInMonth = last.getDate();
    const today = todayKey();

    let dayCount = 0;
    let nextMonthDay = 0;
    const totalCells = Math.ceil((startDay + daysInMonth) / 7) * 7;
    const weekCount = Math.max(4, Math.round(totalCells / 7)); // 4~6주 중 실제 표시 주차 수
    // calendar-grid 높이가 고정이면 memo 에디터 높이가 같이 고정됩니다.
    // 주차 수에 맞게 calendar-grid 높이를 조절해 memo 에디터가 유동적으로 늘/줄어들게 합니다.
    const baseGridHeight = 260; // 기존 CSS 기본값에 맞춘 기준 높이
    grid.style.height = `${Math.round(baseGridHeight * (weekCount / 6))}px`;
    grid.style.gridTemplateRows = `auto repeat(${weekCount}, minmax(0, 1fr))`;
    function hasTodosOnDate(dkey) {
      const list = (state.todos[dkey] || []).filter(t => !isDeletedTabId(t.memoTabId) && isTodoMemoTabActive(t));
      const repCount = state.repeatingTodos.filter(r => repeatingAppliesToDate(r, dkey) && !isDeletedTabId(r.memoTabId) && repeatingTodoMemoTabActive(r)).length;
      return list.length + repCount > 0;
    }
    function setCellContent(cell, num, dkey) {
      const holidayName = getHolidayName(dkey);
      const specialLabels = getSpecialDateLabels(dkey);
      const specialCount = Math.min(specialLabels.length, 3);
      const repeatCount = holidayName ? 0 : state.repeatingTodos.filter(function (r) { return repeatingAppliesToDate(r, dkey) && !isDeletedTabId(r.memoTabId) && repeatingTodoMemoTabActive(r); }).length;
      const repeatDotsCount = Math.min(repeatCount, 3);
      var above = specialCount > 0 ? '<span class="cal-day-dots cal-day-dots-special" aria-hidden="true">' + '\u2022'.repeat(specialCount) + '</span>' : '';
      var below = '';
      if (holidayName) below = '<span class="cal-holiday-name">' + (holidayName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')) + '</span>';
      if (state.calendarType === 'lunar') {
        var lunarStr = getLunarDisplayString(dkey);
        if (lunarStr) below = (below ? below + '<span class="cal-lunar-date">' + lunarStr + '</span>' : '<span class="cal-lunar-date">' + lunarStr + '</span>');
      }
      if (repeatDotsCount > 0) below = below + (below ? ' ' : '') + '<span class="cal-day-dots cal-day-dots-repeat" aria-hidden="true">' + '\u2022'.repeat(repeatDotsCount) + '</span>';
      var html = '<div class="cal-day-inner"><div class="cal-day-above">' + above + '</div><div class="cal-day-num-wrap"><span class="cal-num">' + num + '</span></div><div class="cal-day-below">' + below + '</div></div>';
      cell.innerHTML = html;
    }
    for (let i = 0; i < totalCells; i++) {
      const cell = document.createElement('div');
      const dow = i % 7;
      if (i < startDay) {
        const prevMonth = new Date(y, m, -(startDay - 1 - i));
        const dkey = dateKey(prevMonth);
        cell.className = 'cal-day other-month';
        if (dow === 0) cell.classList.add('cal-sun');
        else if (dow === 6) cell.classList.add('cal-sat');
        setCellContent(cell, prevMonth.getDate(), dkey);
        cell.dataset.date = dkey;
        if (getHolidayName(dkey)) cell.classList.add('cal-holiday');
        if (hasTodosOnDate(dkey)) cell.classList.add('has-todos');
      } else if (dayCount < daysInMonth) {
        dayCount++;
        const dkey = `${y}-${String(m + 1).padStart(2, '0')}-${String(dayCount).padStart(2, '0')}`;
        cell.className = 'cal-day';
        if (dow === 0) cell.classList.add('cal-sun');
        else if (dow === 6) cell.classList.add('cal-sat');
        if (dkey === today) cell.classList.add('today');
        if (state.selectedDate && dateKey(state.selectedDate) === dkey) cell.classList.add('selected');
        if (getHolidayName(dkey)) cell.classList.add('cal-holiday');
        if (hasTodosOnDate(dkey)) cell.classList.add('has-todos');
        setCellContent(cell, dayCount, dkey);
        cell.dataset.date = dkey;
      } else {
        nextMonthDay++;
        const nextMonth = new Date(y, m + 1, nextMonthDay);
        const dkey = dateKey(nextMonth);
        cell.className = 'cal-day other-month';
        if (dow === 0) cell.classList.add('cal-sun');
        else if (dow === 6) cell.classList.add('cal-sat');
        setCellContent(cell, nextMonth.getDate(), dkey);
        cell.dataset.date = dkey;
        if (getHolidayName(dkey)) cell.classList.add('cal-holiday');
        if (hasTodosOnDate(dkey)) cell.classList.add('has-todos');
      }
      grid.appendChild(cell);
    }

    document.getElementById('cal-month-year').textContent = `${y}년 ${m + 1}월`;
  }

  function setSelectedDate(d) {
    state.selectedDate = d;
    if (state.viewMode === 'todo') state.todoViewCenterDate = d;
    renderCalendar();
    const el = document.getElementById('selected-date');
    if (el) el.textContent = d ? dateKey(d) : '';
    renderTodos();
    updateTodoViewCaption();
  }

  function renderCalendarFull() {
    const grid = document.getElementById('calendar-full-grid');
    if (!grid) return;
    const head = ['일','월','화','수','목','금','토'];
    const headRow = document.createElement('div');
    headRow.className = 'calendar-full-head-row';
    headRow.innerHTML = head.map((h, i) => {
      const headClass = i === 0 ? 'cal-day-head cal-head-sun' : i === 6 ? 'cal-day-head cal-head-sat' : 'cal-day-head';
      return `<div class="${headClass}">${h}</div>`;
    }).join('');

    const body = document.createElement('div');
    body.className = 'calendar-full-body';

    const y = state.calendarFullYear, m = state.calendarFullMonth;
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const startDay = first.getDay();
    const daysInMonth = last.getDate();
    const today = todayKey();
    const isRepeatingInstance = (id) => /_\d{4}-\d{2}-\d{2}$/.test(String(id));

    let dayCount = 0;
    let nextMonthDay = 0;
    const totalCells = Math.ceil((startDay + daysInMonth) / 7) * 7;
    function fullDayHeadHtml(num, dkey, addBtn) {
      const holidayName = getHolidayName(dkey);
      const specialLabels = getSpecialDateLabels(dkey);
      var parts = [];
      if (holidayName) parts.push('<span class="cal-full-holiday-name">' + (holidayName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')) + '</span>');
      if (specialLabels.length > 0) {
        var escapedSpecial = specialLabels.map(function (l) { return (l || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }).join(', ');
        parts.push('<span class="cal-full-special-date-name">' + escapedSpecial + '</span>');
      }
      if (state.calendarType === 'lunar') {
        var lunarStr = getLunarDisplayString(dkey);
        if (lunarStr) parts.push('<span class="cal-full-lunar-date">' + lunarStr + '</span>');
      }
      var belowHtml = parts.length > 0 ? '<div class="cal-full-day-head-labels cal-full-day-head-labels-below">' + parts.join(' / ') + '</div>' : '';
      let h = '<div class="cal-full-day-head"><div class="cal-full-day-head-center"><span class="cal-full-num">' + num + '</span>' + belowHtml + '</div>';
      if (addBtn) h += '<button type="button" class="cal-full-add" data-date="' + dkey + '" aria-label="할일 추가">⊕</button>';
      h += '</div><div class="cal-full-todos-wrap"><ul class="cal-full-todos" data-date="' + dkey + '"' + (addBtn ? ' data-section="morning"' : '') + '></ul></div>';
      return h;
    }
    for (let i = 0; i < totalCells; i++) {
      const cell = document.createElement('div');
      const dow = i % 7;
      const isPrevMonth = i < startDay;
      const isNextMonth = i >= startDay + daysInMonth;
      cell.className = 'cal-full-day' + (dow === 0 ? ' cal-sun' : dow === 6 ? ' cal-sat' : '') + (isPrevMonth || isNextMonth ? ' other-month' : '');
      let dkey;
      if (isPrevMonth) {
        const prevMonth = new Date(y, m, -(startDay - 1 - i));
        dkey = dateKey(prevMonth);
        if (getHolidayName(dkey)) cell.classList.add('cal-holiday');
        cell.dataset.date = dkey;
        cell.innerHTML = fullDayHeadHtml(prevMonth.getDate(), dkey, false);
      } else if (dayCount < daysInMonth) {
        dayCount++;
        dkey = `${y}-${String(m + 1).padStart(2, '0')}-${String(dayCount).padStart(2, '0')}`;
        if (getHolidayName(dkey)) cell.classList.add('cal-holiday');
        if (dkey === today) cell.classList.add('today');
        cell.dataset.date = dkey;
        cell.innerHTML = fullDayHeadHtml(dayCount, dkey, true);
      } else {
        nextMonthDay++;
        const nextMonth = new Date(y, m + 1, nextMonthDay);
        dkey = dateKey(nextMonth);
        if (getHolidayName(dkey)) cell.classList.add('cal-holiday');
        cell.dataset.date = dkey;
        cell.innerHTML = fullDayHeadHtml(nextMonth.getDate(), dkey, false);
      }

      const ul = cell.querySelector('.cal-full-todos');
      const bySection = getTodosForDate(dkey);
      const sectionOrder = ['morning', 'lunch', 'afternoon', 'evening'];
      /** 할일 보기와 동일: 섹션 순(오전→점심→오후→저녁), 각 섹션 내 순서는 getTodosForDate·todoSortOrder 결과 유지 */
      const todosActive = sectionOrder.flatMap(s => (bySection[s] || []).filter(t => !t.completed));
      const todosCompleted = sectionOrder.flatMap(s => (bySection[s] || []).filter(t => !!t.completed));
      // 미완료를 먼저 렌더링하고, 완료는 해당 날짜의 할일들 '아래'로 표시
      const todosAll = todosActive.concat(todosCompleted);
      if (ul && todosAll.length > 0) {
        todosAll.forEach((t, idx) => {
          const section = t.section || 'morning';
          const colorIdx = getTodoColorIndex(t, section);
          const completed = !!t.completed;
          const li = document.createElement('li');
          li.className = 'cal-full-day-todo todo-item cal-full-todo-' + section + ' todo-bg-' + colorIdx +
            (completed ? ' cal-full-todo-completed todo-item-completed' : '') +
            (t.important === 'blue' ? ' cal-full-todo-important-blue' : t.important === 'red' ? ' cal-full-todo-important-red' : '') +
            (t.repeat && t.repeat !== 'none' ? ' cal-full-todo-repeat-on' : '');
          li.draggable = !completed;
          li.dataset.id = t.id;
          li.dataset.dateKey = dkey;
          li.dataset.section = section;
          li.dataset.index = String(idx);
          li.dataset.completed = completed ? '1' : '0';
          li.dataset.important = t.important || '0';
          const realId = String(t.id).includes('_') ? String(t.id).split('_').slice(0, -1).join('_') : t.id;
          li.dataset.realId = realId;
          const title = (t.title || '제목').slice(0, 18) + ((t.title || '').length > 18 ? '…' : '');
          const emptyTitleCls = !(t.title && t.title.trim()) ? ' cal-full-todo-title-empty' : '';
          const importantIcon = (t.important === 'blue' || t.important === 'red') ? '★' : '☆';
          const repeatIcon = (t.repeat && t.repeat !== 'none') ? '↻' : '↺';
          const completeIcon = completed ? '✓' : '☐';
          const importantCls = t.important === 'blue' ? ' cal-full-todo-important-blue' : t.important === 'red' ? ' cal-full-todo-important-red' : '';
          const repeatCls = (t.repeat && t.repeat !== 'none') ? ' cal-full-todo-repeat-on' : '';
          const completeCls = completed ? ' cal-full-todo-complete-on' : '';
          li.innerHTML = `<span class="cal-full-todo-icons" aria-hidden="true"><button type="button" class="cal-full-todo-complete${completeCls}" title="${completed ? '완료 (클릭 취소)' : '미완료'}">${completeIcon}</button><button type="button" class="cal-full-todo-important${importantCls}" title="${t.important === 'red' ? '중요 빨강 (클릭 해제)' : t.important === 'blue' ? '중요 파랑 (클릭 시 빨강)' : '중요 표시'}">${importantIcon}</button><button type="button" class="cal-full-todo-repeat${repeatCls}" title="${t.repeat && t.repeat !== 'none' ? '반복 설정됨 (클릭하여 변경)' : '반복'}">${repeatIcon}</button></span><span class="cal-full-todo-title${emptyTitleCls}" data-full-title="${escapeHtml(t.title || '')}" title="${escapeHtml(t.title || '')}">${escapeHtml(title)}</span><button type="button" class="cal-full-todo-del" data-id="${t.id}" data-date="${dkey}" aria-label="삭제">×</button>`;
          ul.appendChild(li);
          var descTrimFull = (t.desc || '').trim();
          var titleTrimFull = (t.title || '').trim();
          li.addEventListener('mouseenter', function (e) {
            var titleEl = e.target && e.target.closest && e.target.closest('.cal-full-todo-title');
            if (titleEl) {
              if (!isCalFullTodoTitleClipped(titleEl)) return;
              var tx = (titleEl.dataset && titleEl.dataset.fullTitle != null) ? String(titleEl.dataset.fullTitle).trim() : titleTrimFull;
              if (!tx) return;
              showTodoDescTooltip(tx, titleEl.getBoundingClientRect());
              return;
            }
            if (!descTrimFull) return;
            var titleRef = li.querySelector('.cal-full-todo-title');
            if (!titleRef) return;
            if (!isTodoTextWiderThanPx(descTrimFull, titleRef.clientWidth, titleRef)) return;
            showTodoDescTooltip(descTrimFull, li.getBoundingClientRect());
          });
          li.addEventListener('mouseleave', hideTodoDescTooltip);
        });
      }
      body.appendChild(cell);
    }

    grid.innerHTML = '';
    grid.appendChild(headRow);
    grid.appendChild(body);

    var fullTypeLabel = state.calendarType === 'lunar' ? ' (음력)' : ' (양력)';
    document.getElementById('cal-full-month-year').textContent = `${y}년 ${m + 1}월${fullTypeLabel}`;
    updateTodoViewCaption();

    grid.querySelectorAll('.cal-full-day-todo:not(.cal-full-more)').forEach(li => {
      li.addEventListener('dragstart', (e) => {
        if (e.target.closest('button')) return;
        if (li.dataset.completed === '1') return; // 완료는 드래그 이동 제외
        const dkey = li.dataset.dateKey;
        state.draggedTodoPayload = { key: dkey, id: li.dataset.id, section: li.dataset.section || 'morning', index: parseInt(li.dataset.index, 10) };
        state.todoDropTarget = null;
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/json', JSON.stringify(state.draggedTodoPayload));
        e.dataTransfer.setData('text/plain', JSON.stringify(state.draggedTodoPayload));
        try {
          e.dataTransfer.setDragImage(li, 0, 0);
        } catch (_) {}
      });
      li.addEventListener('dragend', () => {
        cleanupTodoDragVisualState();
        state.draggedTodoPayload = null;
        state.todoDropTarget = null;
      });
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (state.draggedTodoPayload) e.dataTransfer.dropEffect = 'move';
        updateTodoDropLine(e);
      });
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!state.draggedTodoPayload) return;
        const payload = state.draggedTodoPayload;
        const rect = li.getBoundingClientRect();
        const insertAbove = e.clientY < rect.top + rect.height / 2;
        const toKey = li.dataset.dateKey;
        const toSection = li.dataset.section || 'morning';
        const toIndex = computeTodoSectionInsertIndexBeforeRemoval(toKey, toSection, li, insertAbove);
        document.querySelectorAll('.cal-full-day').forEach(el => el.classList.remove('cal-full-day-drag-over'));
        document.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
        document.querySelectorAll('.cal-full-day-todo').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
        state.draggedTodoPayload = null;
        state.todoDropTarget = null;
        if (payload.key !== toKey) {
          moveTodoToDate(payload.key, payload.id, toKey, toSection, toIndex);
        } else {
          moveTodo(payload.key, payload.id, toSection, toIndex);
        }
      });
    });
  }

  function renderTodoItem(ul, t, section, idx, options) {
    const completed = !!t.completed;
    const opts = options || {};
    const li = document.createElement('li');
    const colorIdx = getTodoColorIndex(t, section);
    li.className = 'todo-item todo-bg-' + colorIdx + (completed ? ' todo-item-completed' : '') + (t.important === 'blue' ? ' todo-item-important-blue' : t.important === 'red' ? ' todo-item-important-red' : '');
    li.dataset.id = t.id;
    li.dataset.section = section;
    li.dataset.index = String(idx);
    li.dataset.realId = String(t.id).includes('_') ? t.id.split('_').slice(0, -1).join('_') : t.id;
    if (opts.dateKey) li.dataset.dateKey = opts.dateKey;
    const fromKey = opts.dateKey || li.dataset.dateKey;
    const repeatBtn = document.createElement('button');
    repeatBtn.type = 'button';
    repeatBtn.className = 'todo-repeat-toggle' + (t.repeat && t.repeat !== 'none' ? ' is-active' : '');
    repeatBtn.dataset.id = t.id;
    repeatBtn.title = t.repeat && t.repeat !== 'none' ? '반복 설정됨 (클릭하여 변경)' : '반복 설정';
    repeatBtn.textContent = t.repeat && t.repeat !== 'none' ? '↻' : '↺';
    const realId = String(t.id).includes('_') ? t.id.replace(/_\d{4}-\d{2}-\d{2}$/, '') : t.id;
    repeatBtn.dataset.realId = realId;
    repeatBtn.draggable = false;
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'todo-item-title-input';
    titleInput.value = t.title || '';
    titleInput.placeholder = '제목';
    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.className = 'todo-item-desc-input';
    descInput.value = t.desc || '';
    descInput.placeholder = '내용';
    const completeBtn = document.createElement('button');
    completeBtn.type = 'button';
    completeBtn.className = 'todo-complete-toggle' + (completed ? ' is-completed' : '');
    completeBtn.dataset.id = t.id;
    completeBtn.title = completed ? '완료 취소' : '완료';
    completeBtn.textContent = completed ? '✓' : '☐';
    completeBtn.draggable = false;
    const importantBtn = document.createElement('button');
    importantBtn.type = 'button';
    importantBtn.className = 'todo-important-toggle' + (t.important === 'blue' ? ' important-blue' : t.important === 'red' ? ' important-red' : '');
    importantBtn.dataset.id = t.id;
    importantBtn.dataset.important = t.important || 'false';
    importantBtn.title = t.important === 'red' ? '중요 빨강 (클릭 해제)' : t.important === 'blue' ? '중요 파랑 (클릭 시 빨강)' : '중요 표시';
    importantBtn.setAttribute('aria-label', '중요');
    importantBtn.draggable = false;
    importantBtn.textContent = (t.important === 'blue' || t.important === 'red') ? '★' : '☆';
    const categorySelect = document.createElement('select');
    categorySelect.className = 'todo-category-select';
    categorySelect.title = '분류(분류관리)';
    categorySelect.draggable = false;
    (state.memoTabs || []).forEach(tab => {
      if (!isMemoTabInActivePeriod(tab)) return;
      const opt = document.createElement('option');
      opt.value = tab.id;
      opt.textContent = tab.name || '(이름 없음)';
      if (tab.id === (t.memoTabId || getPersonalTabId() || '')) opt.selected = true;
      categorySelect.appendChild(opt);
    });
    const anyActiveMemoTab = state.memoTabs && state.memoTabs.some(function (x) { return isMemoTabInActivePeriod(x); });
    categorySelect.disabled = !(state.memoTabs && state.memoTabs.length) || !anyActiveMemoTab;
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'todo-delete';
    delBtn.dataset.id = t.id;
delBtn.title = '삭제';
        delBtn.textContent = '';
        delBtn.draggable = false;
        titleInput.draggable = false;
    descInput.draggable = false;
    const iconWrap = document.createElement('span');
    iconWrap.className = 'todo-item-icons';
    iconWrap.appendChild(completeBtn);
    iconWrap.appendChild(importantBtn);
    iconWrap.appendChild(repeatBtn);
    li.draggable = !opts.noDrag;
    li.appendChild(iconWrap);
    li.appendChild(titleInput);
    li.appendChild(descInput);
    const actions = document.createElement('span');
    actions.className = 'todo-item-actions';
    actions.appendChild(categorySelect);
    actions.appendChild(delBtn);
    li.appendChild(actions);
    ul.appendChild(li);

    function saveTodoFields() {
      flushTodoFieldDebounceForLi(li);
      updateTodoFields(t.id, { title: titleInput.value.trim(), desc: descInput.value.trim() }, fromKey);
    }
    titleInput.addEventListener('change', saveTodoFields);
    titleInput.addEventListener('blur', saveTodoFields);
    titleInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
    });
    titleInput.addEventListener('dblclick', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openTodoModalFromTitleInput(this);
    });
    titleInput.addEventListener('mouseenter', function () {
      if (!isTodoTextInputHorizontallyClipped(titleInput)) return;
      var tit = (titleInput.value || '').trim();
      if (!tit) return;
      showTodoDescTooltip(tit, titleInput.getBoundingClientRect());
    });
    titleInput.addEventListener('mouseleave', hideTodoDescTooltip);
    descInput.addEventListener('change', saveTodoFields);
    descInput.addEventListener('blur', saveTodoFields);
    descInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
    });
    descInput.addEventListener('mouseenter', function () {
      if (!isTodoTextInputHorizontallyClipped(descInput)) return;
      var d = (descInput.value || '').trim();
      if (!d) return;
      showTodoDescTooltip(d, descInput.getBoundingClientRect());
    });
    descInput.addEventListener('mouseleave', hideTodoDescTooltip);
    delBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 3열(어제/오늘/내일)에서 클릭한 항목만 정확히 지우기 위해,
      // 해당 li가 가진 dateKey(fromKey)를 deleteTodo에 전달한다.
      const fromKey = li.dataset.dateKey || opts.dateKey;
      deleteTodo(t.id, fromKey);
    });
    repeatBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRepeatOnlyModal(repeatBtn.dataset.realId, fromKey);
    });
    completeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setTodoCompleted(t.id, !completed, fromKey);
    });
    categorySelect.addEventListener('change', function () {
      pushUndoSnapshot();
      const val = this.value || undefined;
      updateTodoFields(t.id, { memoTabId: val }, fromKey);
      renderTodos();
      if (state.viewMode === 'calendarFull') renderCalendarFull();
    });
  }

  function getTodoDayHeaderText(key) {
    if (!key || key.length < 10) return '';
    const d = new Date(key);
    if (isNaN(d.getTime())) return key;
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    const wd = weekdays[d.getDay()];
    const holidayName = getHolidayName(key);
    const specialLabels = getSpecialDateLabels(key);
    let text = (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + wd + ')';
    if (holidayName) text += ' 【 ' + holidayName + ' 】';
    if (specialLabels.length > 0) text += ' ' + specialLabels.join(', ');
    return text;
  }

  function renderTodos() {
    if (state.viewMode !== 'todo') return;
    const centerDate = state.todoViewCenterDate || new Date();
    state.todoViewCenterDate = centerDate;
    state.selectedDate = centerDate;
    const centerKey = dateKey(centerDate);
    const leftDate = new Date(centerDate.getTime() - 86400000);
    const rightDate = new Date(centerDate.getTime() + 86400000);
    const leftKey = dateKey(leftDate);
    const rightKey = dateKey(rightDate);
    const cols = [
      { id: 'todo-day-col-left', key: leftKey, header: getTodoDayHeaderText(leftKey) },
      { id: 'todo-day-col-center', key: centerKey, header: getTodoDayHeaderText(centerKey) },
      { id: 'todo-day-col-right', key: rightKey, header: getTodoDayHeaderText(rightKey) }
    ];
    cols.forEach(function (col) {
      const colEl = document.getElementById(col.id);
      if (!colEl) return;
      colEl.dataset.date = col.key;
      colEl.classList.remove('todo-day-sat', 'todo-day-sun', 'todo-day-holiday');
      const d = new Date(col.key);
      if (isNaN(d.getTime())) { /* no date class */ } else {
        const isHoliday = !!getHolidayName(col.key);
        if (isHoliday) colEl.classList.add('todo-day-holiday');
        else if (d.getDay() === 6) colEl.classList.add('todo-day-sat');
        else if (d.getDay() === 0) colEl.classList.add('todo-day-sun');
      }
      const headerEl = colEl.querySelector('.todo-day-header');
      if (headerEl) headerEl.textContent = col.header;
      const bySection = getTodosForDate(col.key);
      ['morning', 'lunch', 'afternoon', 'evening'].forEach(function (section) {
        const ul = colEl.querySelector('.todo-items[data-section="' + section + '"]');
      if (!ul) return;
      ul.innerHTML = '';
        (bySection[section] || []).forEach(function (t, idx) {
        if (t.completed) return;
          renderTodoItem(ul, t, section, idx, { dateKey: col.key });
      });
    });
      const completedUl = colEl.querySelector('.todo-items[data-section="completed"]');
    if (completedUl) {
      completedUl.innerHTML = '';
      const sectionOrder = ['morning', 'lunch', 'afternoon', 'evening'];
        const completedItems = sectionOrder.flatMap(function (s) { return (bySection[s] || []).filter(function (t) { return t.completed; }); });
        completedItems.forEach(function (t, idx) {
          renderTodoItem(completedUl, t, t.section, idx, { noDrag: true, dateKey: col.key });
        });
      }
      ['morning', 'lunch', 'afternoon', 'evening'].forEach(function (section) {
        const secEl = colEl.querySelector('.todo-section.section-' + section);
        const inp = secEl && secEl.querySelector('.section-header-note');
        if (!inp) return;
        const want = getSectionHeaderNoteForDate(col.key, section);
        if (document.activeElement !== inp) inp.value = want;
      });
    });
    initTodoButtons();
  }

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  var todoDescTooltipHideTimer = null;

  /** 한 줄 텍스트가 박스 너비를 넘겨 잘릴 때만 true (풍선말 표시 조건) */
  function isTodoTextInputHorizontallyClipped(inputEl) {
    if (!inputEl || inputEl.nodeName !== 'INPUT') return false;
    var typ = String(inputEl.type || 'text').toLowerCase();
    if (typ !== 'text' && typ !== 'search') return false;
    var v = inputEl.value;
    if (v == null || String(v).length === 0) return false;
    return inputEl.scrollWidth > inputEl.clientWidth + 1;
  }

  /** 참조 요소와 동일 폰트로 한 줄 너비 측정 (달력 셀 등 input 없는 영역) */
  function isTodoTextWiderThanPx(text, maxPx, fontRefEl) {
    if (text == null || !String(text).trim() || !fontRefEl || !(maxPx > 0)) return false;
    var cs = window.getComputedStyle(fontRefEl);
    var div = document.createElement('div');
    div.setAttribute('aria-hidden', 'true');
    div.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:nowrap;visibility:hidden;pointer-events:none;font-size:' + cs.fontSize + ';font-family:' + cs.fontFamily + ';font-weight:' + cs.fontWeight + ';';
    div.textContent = String(text);
    document.body.appendChild(div);
    var w = div.offsetWidth;
    document.body.removeChild(div);
    return w > maxPx + 1;
  }

  function isCalFullTodoTitleClipped(titleEl) {
    if (!titleEl) return false;
    try {
      return titleEl.scrollWidth > titleEl.clientWidth + 1;
    } catch (_) {
      return false;
    }
  }

  function getTodoDescTooltipEl() {
    var el = document.getElementById('todo-desc-tooltip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'todo-desc-tooltip';
      el.className = 'todo-desc-tooltip';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    return el;
  }
  function showTodoDescTooltip(text, anchorRect) {
    var t = (text || '').trim();
    if (!t) return;
    var tooltipEl = getTodoDescTooltipEl();
    if (todoDescTooltipHideTimer) {
      clearTimeout(todoDescTooltipHideTimer);
      todoDescTooltipHideTimer = null;
    }
    tooltipEl.textContent = t;
    tooltipEl.style.display = 'block';
    var gap = 6;
    var tw = tooltipEl.offsetWidth;
    var th = tooltipEl.offsetHeight;
    var viewW = window.innerWidth;
    var viewH = window.innerHeight;
    var left = anchorRect.left;
    var top = anchorRect.top - th - gap;
    if (left + tw > viewW - 8) left = Math.max(8, viewW - tw - 8);
    if (left < 8) left = 8;
    if (top < 8) {
      top = anchorRect.bottom + gap;
    }
    if (top + th > viewH - 8) {
      top = Math.max(8, viewH - th - 8);
    }
    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + 'px';
  }
  function hideTodoDescTooltip() {
    todoDescTooltipHideTimer = setTimeout(function () {
      getTodoDescTooltipEl().style.display = 'none';
    }, 120);
  }

  function updateTodoDropLine(e) {
    if (!state.draggedTodoPayload) return;
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    let overItem = null;
    for (const el of els) {
      const li = el.closest && el.closest('.todo-item');
      if (li && !li.classList.contains('todo-item-completed') && !li.classList.contains('dragging')) {
        overItem = li;
        break;
      }
      const calLi = el.closest && el.closest('.cal-full-day-todo:not(.cal-full-more)');
      if (calLi && !calLi.classList.contains('dragging')) {
        overItem = calLi;
        break;
      }
    }
    const overUl = els.find(el => el.classList && el.classList.contains('todo-items') && el.dataset.section && el.dataset.section !== 'completed');
    const overCalFullDay = els.find(el => el.classList && el.classList.contains('cal-full-day') && el.dataset.date);
    document.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
    document.querySelectorAll('.cal-full-day').forEach(el => el.classList.remove('cal-full-day-drag-over'));
    if (overItem) {
      const rect = overItem.getBoundingClientRect();
      const insertAbove = e.clientY < rect.top + rect.height / 2;
      overItem.classList.toggle('drag-over-top', insertAbove);
      overItem.classList.toggle('drag-over-bottom', !insertAbove);
      const key = overItem.dataset.dateKey || (state.selectedDate ? dateKey(state.selectedDate) : null);
      state.todoDropTarget = { el: overItem, insertAbove, section: overItem.dataset.section || 'morning', index: parseInt(overItem.dataset.index, 10) || 0, key };
    } else if (overUl) {
      const key = (overUl.closest && overUl.closest('[data-date]') && overUl.closest('[data-date]').dataset.date) || (state.selectedDate ? dateKey(state.selectedDate) : null);
      const sec = overUl.dataset.section || 'morning';
      const appendIdx = key ? getSectionTodoListForMove(key, sec).length : 0;
      state.todoDropTarget = { el: null, insertAbove: false, section: sec, index: appendIdx, key };
    } else if (overCalFullDay) {
      const key = overCalFullDay.dataset.date;
      overCalFullDay.classList.add('cal-full-day-drag-over');
      const appendSection = 'morning';
      const appendIdx = key ? getSectionTodoListForMove(key, appendSection).length : 0;
      state.todoDropTarget = { el: null, insertAbove: false, section: appendSection, index: appendIdx, key };
    } else {
      state.todoDropTarget = null;
    }
  }

  /** 같은 탭·미완료 n개 기준 insertBefore ∈ [0,n] (드래그 행 포함, 화면 Y로 계산) */
  function computeMemoInsertBefore(clientY, tabIdStr, nIncomplete) {
    var n = nIncomplete | 0;
    if (n < 1) return 0;
    var rows = Array.from(document.querySelectorAll('.memo-item-row')).filter(function (r) {
      return String(r.dataset.tabId || '') === String(tabIdStr);
    });
    if (!rows.length) return 0;
    rows.sort(function (a, b) {
      return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    });
    var y = clientY;
    var firstR = rows[0].getBoundingClientRect();
    var lastR = rows[rows.length - 1].getBoundingClientRect();
    if (y < firstR.top) return 0;
    if (y > lastR.bottom) return n;
    var i;
    for (i = 0; i < rows.length; i++) {
      var rect = rows[i].getBoundingClientRect();
      if (y < rect.top) {
        return parseInt(rows[i].dataset.index, 10) || 0;
      }
      if (y <= rect.bottom) {
        var idx = parseInt(rows[i].dataset.index, 10);
        if (isNaN(idx)) idx = 0;
        return y < rect.top + rect.height / 2 ? idx : idx + 1;
      }
    }
    for (i = 0; i < rows.length - 1; i++) {
      var ra = rows[i].getBoundingClientRect();
      var rb = rows[i + 1].getBoundingClientRect();
      if (y > ra.bottom && y < rb.top) {
        var mid = (ra.bottom + rb.top) / 2;
        var ia = parseInt(rows[i].dataset.index, 10);
        var ib = parseInt(rows[i + 1].dataset.index, 10);
        if (isNaN(ia)) ia = 0;
        if (isNaN(ib)) ib = ia + 1;
        return y < mid ? ia + 1 : ib;
      }
    }
    return n;
  }

  function paintMemoReorderIndicator(insertBefore, tabIdStr, nIncomplete) {
    var n = nIncomplete | 0;
    if (n < 1) return;
    var ib = Math.max(0, Math.min(insertBefore | 0, n));
    function rowByIndex(ix) {
      return Array.from(document.querySelectorAll('.memo-item-row')).find(function (r) {
        return String(r.dataset.tabId || '') === String(tabIdStr) && parseInt(r.dataset.index, 10) === ix;
      });
    }
    if (ib <= 0) {
      var r0 = rowByIndex(0);
      if (r0) r0.classList.add('memo-item-over-top');
    } else if (ib >= n) {
      var rL = rowByIndex(n - 1);
      if (rL) rL.classList.add('memo-item-over-bottom');
    } else {
      var rK = rowByIndex(ib);
      if (rK) rK.classList.add('memo-item-over-top');
    }
  }

  /** 제거 후 incomplete 배열에서의 삽입 인덱스 (reorderMemoItems 두 번째 인자) */
  function memoReorderDestAfterRemove(fromIndex, insertBefore, nIncomplete) {
    var n = nIncomplete | 0;
    if (n < 2 || fromIndex < 0 || fromIndex >= n) return null;
    var ib = Math.max(0, Math.min(insertBefore | 0, n));
    var dest = ib > fromIndex ? ib - 1 : ib;
    dest = Math.max(0, Math.min(dest, n - 1));
    if (dest === fromIndex) return null;
    return dest;
  }

  function updateMemoDropLine(e) {
    if (state.dragMemoTabId == null || state.dragMemoTabId === '') return;
    const dragTabStr = String(state.dragMemoTabId);
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    document.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
    document.querySelectorAll('.memo-all-block').forEach(b => b.classList.remove('memo-all-block-drop-over', 'memo-all-block-drop-line'));
    var block = els.find(el => el.classList && el.classList.contains('memo-all-block'));
    /* 전체 보기: 다른 분류 블록으로 이동 */
    if (block && block.dataset.tabId != null && block.dataset.tabId !== '' && String(block.dataset.tabId) !== dragTabStr) {
      var rows = block.querySelectorAll('.memo-item-row');
      var lastRow = rows.length ? rows[rows.length - 1] : null;
      if (lastRow) {
        lastRow.classList.add('memo-item-over-bottom');
        state.memoDropTarget = { el: lastRow, insertAbove: false, tabId: String(block.dataset.tabId) };
      } else {
        block.classList.add('memo-all-block-drop-line');
        state.memoDropTarget = { el: null, insertAbove: true, tabId: String(block.dataset.tabId) };
      }
      return;
    }
    /* 같은 분류 내 순서: 드래그 중 행 포함 전체 행으로 Y → insertBefore 만 사용 */
    var rowsAll = Array.from(document.querySelectorAll('.memo-item-row')).filter(function (r) {
      return String(r.dataset.tabId || '') === dragTabStr;
    });
    if (!rowsAll.length) {
      state.memoDropTarget = null;
      return;
    }
    var nIncomplete = state.memoIncompleteCount;
    if (nIncomplete == null || nIncomplete < 1) {
      nIncomplete = rowsAll.length;
    }
    var insertBefore = computeMemoInsertBefore(e.clientY, dragTabStr, nIncomplete);
    insertBefore = Math.max(0, Math.min(insertBefore | 0, nIncomplete));
    paintMemoReorderIndicator(insertBefore, dragTabStr, nIncomplete);
    state.memoDropTarget = { insertBefore: insertBefore, tabId: dragTabStr };
  }

  function updateTodoToMemoDropTarget(e) {
    if (!state.draggedTodoPayload) return;
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    const memoBlock = els.find(el => el.classList && el.classList.contains('memo-all-block') && el.dataset.tabId);
    const memoRow = els.find(el => el.classList && el.classList.contains('memo-item-row') && el.dataset.tabId);
    document.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
    document.querySelectorAll('.memo-all-block').forEach(b => b.classList.remove('memo-all-block-drop-over', 'memo-all-block-drop-line'));
    if (memoRow) {
      const tabId = memoRow.dataset.tabId;
      const rect = memoRow.getBoundingClientRect();
      const insertAbove = e.clientY < rect.top + rect.height / 2;
      memoRow.classList.add(insertAbove ? 'memo-item-over-top' : 'memo-item-over-bottom');
      const rowIndex = parseInt(memoRow.dataset.index, 10);
      state.todoToMemoDropTarget = { tabId, index: insertAbove ? rowIndex : rowIndex + 1 };
      const block = memoRow.closest('.memo-all-block') || document.querySelector('.memo-all-block[data-tab-id="' + tabId + '"]');
      if (block) block.classList.add('memo-all-block-drop-over');
    } else if (memoBlock) {
      const rows = memoBlock.querySelectorAll('.memo-item-row');
      state.todoToMemoDropTarget = { tabId: memoBlock.dataset.tabId, index: rows.length };
      memoBlock.classList.add('memo-all-block-drop-over');
    } else {
      state.todoToMemoDropTarget = null;
    }
  }

  function updateMemoToTodoDropTarget(e) {
    if (!state.draggedMemoPayload) return;
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    const overItem = els.find(el => el.closest && el.closest('.todo-item') && !el.closest('.todo-item').classList.contains('todo-item-completed'));
    const overUl = els.find(el => el.classList && el.classList.contains('todo-items') && el.dataset.section && el.dataset.section !== 'completed');
    const overCalFullDay = els.find(el => el.classList && el.classList.contains('cal-full-day') && el.dataset.date);
    document.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
    document.querySelectorAll('.todo-section').forEach(s => s.classList.remove('todo-section-drop-zone'));
    document.querySelectorAll('.cal-full-day').forEach(el => el.classList.remove('cal-full-day-drag-over'));
    if (overItem) {
      const li = overItem.closest('.todo-item');
      const rect = li.getBoundingClientRect();
      const insertAbove = e.clientY < rect.top + rect.height / 2;
      li.classList.add(insertAbove ? 'drag-over-top' : 'drag-over-bottom');
      const key = li.dataset.dateKey || (state.selectedDate ? dateKey(state.selectedDate) : todayKey());
      const section = li.dataset.section || 'morning';
      const index = parseInt(li.dataset.index, 10);
      state.memoToTodoDropTarget = { key, section, index: insertAbove ? index : index + 1 };
    } else if (overUl) {
      const sectionEl = overUl.closest('.todo-section');
      if (sectionEl) sectionEl.classList.add('todo-section-drop-zone');
      const wrap = document.getElementById('todo-list-wrap');
      const key = (wrap && wrap.dataset.date) || (state.selectedDate ? dateKey(state.selectedDate) : todayKey());
      const section = overUl.dataset.section || 'morning';
      const index = overUl.querySelectorAll('.todo-item').length;
      state.memoToTodoDropTarget = { key, section, index };
    } else if (overCalFullDay) {
      overCalFullDay.classList.add('cal-full-day-drag-over');
      const key = overCalFullDay.dataset.date;
      const list = overCalFullDay.querySelectorAll('.cal-full-day-todo:not(.cal-full-more)');
      state.memoToTodoDropTarget = { key, section: 'morning', index: list.length };
    } else {
      state.memoToTodoDropTarget = null;
    }
  }

  function updateMemoReorderDropLine(e) {
    if (!state.draggingMemoReorder) return;
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    const other = els.find(el => el.classList && el.classList.contains('memo-reorder-item') && !el.classList.contains('memo-reorder-dragging') && !el.classList.contains('memo-reorder-item-expired') && !el.classList.contains('memo-reorder-item-deleted'));
    document.querySelectorAll('.memo-reorder-item').forEach(el => el.classList.remove('memo-reorder-over-top', 'memo-reorder-over-bottom'));
    if (!other) return;
    const rect = other.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const insertAbove = e.clientY < mid;
    other.classList.toggle('memo-reorder-over-top', insertAbove);
    other.classList.toggle('memo-reorder-over-bottom', !insertAbove);
    state.memoReorderDropTarget = { el: other, insertAbove };
  }

  /** 제목 입력란 더블클릭 시 할일 수정 모달 */
  function openTodoModalFromTitleInput(titleInput) {
    if (!titleInput || !titleInput.isConnected) return;
    var li = titleInput.closest('.todo-item, .cal-full-day-todo');
    if (!li || !li.dataset.id) return;
    var dk = li.dataset.dateKey;
    if (!dk || String(dk).length < 10) return;
    if (li.classList.contains('todo-item')) flushTodoFieldDebounceForLi(li);
    state.selectedDate = new Date(parseInt(dk.slice(0, 4), 10), parseInt(dk.slice(5, 7), 10) - 1, parseInt(dk.slice(8, 10), 10));
    titleInput.blur();
    openTodoModal(li.dataset.id);
  }

  function initTodoButtons() {
    document.querySelectorAll('.todo-important-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.id;
        const current = btn.dataset.important === 'false' ? false : btn.dataset.important;
        const next = nextImportant(current);
        const li = btn.closest('.todo-item');
        const fromKey = li && li.dataset ? (li.dataset.dateKey || undefined) : undefined;
        setTodoImportant(id, next, fromKey);
      });
    });
  }

  function openTodoModal(editId, defaultSection) {
    document.getElementById('todo-modal-title').textContent = editId ? '할일 수정' : '할일 추가';
    const modal = document.getElementById('todo-modal');
    document.getElementById('todo-range-group').style.display = 'none';

    const categorySelect = document.getElementById('todo-memo-category');
    if (categorySelect) {
      categorySelect.innerHTML = '';
      (state.memoTabs || []).forEach(tab => {
        if (!isMemoTabInActivePeriod(tab)) return;
        const opt = document.createElement('option');
        opt.value = tab.id;
        opt.textContent = tab.name;
        categorySelect.appendChild(opt);
      });
    }

    if (editId && state.selectedDate) {
      const key = dateKey(state.selectedDate);
      const isRepeatingInstance = /_\d{4}-\d{2}-\d{2}$/.test(String(editId));
      const realId = isRepeatingInstance ? String(editId).replace(/_\d{4}-\d{2}-\d{2}$/, '') : editId;
      state.editingTodoId = realId;
      let t = (state.todos[key] || []).find(x => x.id === editId);
      if (!t) t = state.repeatingTodos.find(x => x.id === realId);
      if (t) {
        const disp = (t.repeat && t.repeat !== 'none' && key)
          ? getRepeatingContentForDate(t, key)
          : { title: t.title || '', desc: t.desc || '' };
        document.getElementById('todo-title').value = disp.title || '';
        document.getElementById('todo-desc').value = disp.desc || '';
        document.getElementById('todo-section').value = t.section || 'morning';
        document.getElementById('todo-repeat').value = t.repeat || 'none';
        document.getElementById('todo-range-start').value = t.rangeStart || '';
        document.getElementById('todo-range-end').value = t.rangeEnd || '';
        const rd = t.rangeDays || { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true, holiday: true };
        ['mon','tue','wed','thu','fri','sat','sun','holiday'].forEach(function (d) { var el = document.getElementById('todo-range-' + (d === 'holiday' ? 'holiday' : d)); if (el) el.checked = !!rd[d === 'holiday' ? 'holiday' : d]; });
        if (categorySelect) {
          const want = t.memoTabId || getPersonalTabId() || '';
          const hasOpt = Array.from(categorySelect.options).some(function (o) { return o.value === want; });
          categorySelect.value = hasOpt ? want : (getPersonalTabId() || '');
        }
        if (t.repeat === 'range') document.getElementById('todo-range-group').style.display = 'block';
      } else {
        state.editingTodoId = null;
      }
    } else {
      state.editingTodoId = null;
      document.getElementById('todo-title').value = '';
      document.getElementById('todo-desc').value = '';
      document.getElementById('todo-section').value = defaultSection || 'morning';
      document.getElementById('todo-repeat').value = 'none';
      document.getElementById('todo-range-start').value = '';
      document.getElementById('todo-range-end').value = '';
      ['mon','tue','wed','thu','fri','sat','sun','holiday'].forEach(function (d) { var el = document.getElementById('todo-range-' + (d === 'holiday' ? 'holiday' : d)); if (el) el.checked = true; });
      if (categorySelect) categorySelect.value = getPersonalTabId() || '';
    }
    modal.classList.add('show');
  }

  function closeTodoModal() {
    document.getElementById('todo-modal').classList.remove('show');
    state.editingTodoId = null;
  }

  document.getElementById('todo-repeat').addEventListener('change', () => {
    document.getElementById('todo-range-group').style.display =
      document.getElementById('todo-repeat').value === 'range' ? 'block' : 'none';
  });

  document.getElementById('todo-save').addEventListener('click', () => {
    const title = document.getElementById('todo-title').value.trim();
    const section = document.getElementById('todo-section').value;
    const repeat = document.getElementById('todo-repeat').value;
    const rangeStart = document.getElementById('todo-range-start').value;
    const rangeEnd = document.getElementById('todo-range-end').value;
    const memoTabIdEl = document.getElementById('todo-memo-category');
    const memoTabId = (memoTabIdEl && memoTabIdEl.value) ? memoTabIdEl.value : (getPersonalTabId() || '');
    const catTab = getMemoTabById(memoTabId);
    if (!catTab || !isMemoTabInActivePeriod(catTab)) {
      alert('사용 기간이 아닌 분류는 선택할 수 없습니다.');
      return;
    }

    if (!title) {
      alert('제목을 입력하세요.');
      return;
    }
    if (!state.selectedDate) {
      alert('날짜를 선택하세요.');
      return;
    }

    const rangeDays = repeat === 'range' ? {
      mon: !!(document.getElementById('todo-range-mon') && document.getElementById('todo-range-mon').checked),
      tue: !!(document.getElementById('todo-range-tue') && document.getElementById('todo-range-tue').checked),
      wed: !!(document.getElementById('todo-range-wed') && document.getElementById('todo-range-wed').checked),
      thu: !!(document.getElementById('todo-range-thu') && document.getElementById('todo-range-thu').checked),
      fri: !!(document.getElementById('todo-range-fri') && document.getElementById('todo-range-fri').checked),
      sat: !!(document.getElementById('todo-range-sat') && document.getElementById('todo-range-sat').checked),
      sun: !!(document.getElementById('todo-range-sun') && document.getElementById('todo-range-sun').checked),
      holiday: !!(document.getElementById('todo-range-holiday') && document.getElementById('todo-range-holiday').checked)
    } : undefined;
    const payload = {
      title,
      desc: document.getElementById('todo-desc').value.trim(),
      section,
      repeat: repeat === 'range' ? 'range' : repeat,
      rangeStart: repeat === 'range' ? rangeStart : '',
      rangeEnd: repeat === 'range' ? rangeEnd : '',
      rangeDays,
      memoTabId: memoTabId || getPersonalTabId() || undefined
    };
    if (state.editingTodoId) payload.id = state.editingTodoId;
    addOrUpdateTodo(payload);
    closeTodoModal();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
  });

  document.getElementById('todo-cancel').addEventListener('click', closeTodoModal);

  let editingTodoIdForRepeat = null;
  let editingTodoKeyForRepeat = null;
  function openRepeatOnlyModal(realId, fromKey) {
    editingTodoIdForRepeat = realId;
    const key = fromKey || dateKey(state.selectedDate);
    editingTodoKeyForRepeat = key;
    let t = null;
    if (key && state.todos[key]) t = state.todos[key].find(x => x.id === realId);
    if (!t && realId) t = state.repeatingTodos.find(x => x.id === realId);
    const repeatTitleEl = document.getElementById('todo-repeat-modal-todo-name');
    if (repeatTitleEl) {
      if (!t) repeatTitleEl.textContent = '';
      else {
        const tx = t.repeat && t.repeat !== 'none' && key ? getRepeatingContentForDate(t, key).title : (t.title || '');
        const raw = typeof tx === 'string' ? tx.trim() : '';
        repeatTitleEl.textContent = raw || '(제목 없음)';
      }
    }
    document.getElementById('todo-repeat-only-range-group').style.display = 'none';
    if (t) {
      document.getElementById('todo-repeat-only').value = t.repeat || 'none';
      document.getElementById('todo-repeat-only-range-start').value = t.rangeStart || '';
      document.getElementById('todo-repeat-only-range-end').value = t.rangeEnd || '';
      const rd = t.rangeDays || { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true, holiday: true };
      ['mon','tue','wed','thu','fri','sat','sun','holiday'].forEach(function (d) { var el = document.getElementById('todo-repeat-only-range-' + (d === 'holiday' ? 'holiday' : d)); if (el) el.checked = !!rd[d === 'holiday' ? 'holiday' : d]; });
      if (t.repeat === 'range') document.getElementById('todo-repeat-only-range-group').style.display = 'block';
    } else {
      document.getElementById('todo-repeat-only').value = 'none';
      document.getElementById('todo-repeat-only-range-start').value = '';
      document.getElementById('todo-repeat-only-range-end').value = '';
      ['mon','tue','wed','thu','fri','sat','sun','holiday'].forEach(function (d) { var el = document.getElementById('todo-repeat-only-range-' + (d === 'holiday' ? 'holiday' : d)); if (el) el.checked = true; });
    }
    document.getElementById('todo-repeat-modal').classList.add('show');
  }
  function closeRepeatOnlyModal() {
    document.getElementById('todo-repeat-modal').classList.remove('show');
    const repeatTitleEl = document.getElementById('todo-repeat-modal-todo-name');
    if (repeatTitleEl) repeatTitleEl.textContent = '';
    editingTodoIdForRepeat = null;
    editingTodoKeyForRepeat = null;
  }
  document.getElementById('todo-repeat-only').addEventListener('change', () => {
    document.getElementById('todo-repeat-only-range-group').style.display =
      document.getElementById('todo-repeat-only').value === 'range' ? 'block' : 'none';
  });
  document.getElementById('todo-repeat-only-save').addEventListener('click', () => {
    if (!editingTodoIdForRepeat || !editingTodoKeyForRepeat) {
      closeRepeatOnlyModal();
      return;
    }
    const prevSelectedDate = state.selectedDate;
    state.selectedDate = parseLocalDate(editingTodoKeyForRepeat) || prevSelectedDate;
    const repeat = document.getElementById('todo-repeat-only').value;
    const rangeStart = document.getElementById('todo-repeat-only-range-start').value;
    const rangeEnd = document.getElementById('todo-repeat-only-range-end').value;
    const rangeDays = repeat === 'range' ? {
      mon: !!(document.getElementById('todo-repeat-only-range-mon') && document.getElementById('todo-repeat-only-range-mon').checked),
      tue: !!(document.getElementById('todo-repeat-only-range-tue') && document.getElementById('todo-repeat-only-range-tue').checked),
      wed: !!(document.getElementById('todo-repeat-only-range-wed') && document.getElementById('todo-repeat-only-range-wed').checked),
      thu: !!(document.getElementById('todo-repeat-only-range-thu') && document.getElementById('todo-repeat-only-range-thu').checked),
      fri: !!(document.getElementById('todo-repeat-only-range-fri') && document.getElementById('todo-repeat-only-range-fri').checked),
      sat: !!(document.getElementById('todo-repeat-only-range-sat') && document.getElementById('todo-repeat-only-range-sat').checked),
      sun: !!(document.getElementById('todo-repeat-only-range-sun') && document.getElementById('todo-repeat-only-range-sun').checked),
      holiday: !!(document.getElementById('todo-repeat-only-range-holiday') && document.getElementById('todo-repeat-only-range-holiday').checked)
    } : undefined;
    addOrUpdateTodo({
      id: editingTodoIdForRepeat,
      repeat: repeat === 'range' ? 'range' : repeat,
      rangeStart: repeat === 'range' ? rangeStart : '',
      rangeEnd: repeat === 'range' ? rangeEnd : '',
      rangeDays
    });
    closeRepeatOnlyModal();
    state.selectedDate = prevSelectedDate;
    if (state.viewMode === 'calendarFull') renderCalendarFull();
    renderTodos();
  });
  document.getElementById('todo-repeat-only-cancel').addEventListener('click', closeRepeatOnlyModal);

  function loadMemoTabs() {
    try {
      const raw = getFromStore(STORAGE_MEMO_TABS);
      const parsed = raw ? JSON.parse(raw) : [];
      state.memoTabs = parsed.map((t, i) => {
        const tab = typeof t === 'string' ? { id: 'tab_' + i, name: t } : { id: t.id || 'tab_' + i, name: t.name || '' };
        const colorIndex = typeof t === 'object' && typeof t.colorIndex === 'number' && t.colorIndex >= 0 && t.colorIndex <= 9 ? t.colorIndex : i % 10;
        const startDate = typeof t === 'object' && t.startDate ? String(t.startDate).slice(0, 10) : '';
        const endDate = typeof t === 'object' && t.endDate ? String(t.endDate).slice(0, 10) : '';
        return { ...tab, colorIndex, startDate, endDate };
      }).filter(t => t.name);
      if (!state.memoTabs.length) state.memoTabs = DEFAULT_MEMO_TABS.map((name, i) => ({ id: 'tab_' + i, name, colorIndex: i % 10, startDate: '', endDate: '' }));
    } catch (_) {
      state.memoTabs = DEFAULT_MEMO_TABS.map((name, i) => ({ id: 'tab_' + i, name, colorIndex: i % 10, startDate: '', endDate: '' }));
    }
    if (!state.memoTabs.some(t => t.name === '개인')) {
      const idx = state.memoTabs.length;
      state.memoTabs.push({ id: 'tab_' + idx, name: '개인', colorIndex: idx % 10, startDate: '', endDate: '' });
    }
    try {
      const rawDeleted = getFromStore(STORAGE_DELETED_MEMO_TABS);
      const parsedDeleted = rawDeleted ? JSON.parse(rawDeleted) : [];
      state.deletedMemoTabs = Array.isArray(parsedDeleted) ? parsedDeleted.map((t, i) => {
        const tab = typeof t === 'string' ? { id: 'tab_del_' + i, name: t } : { id: t.id || 'tab_del_' + i, name: t.name || '' };
        const colorIndex = typeof t === 'object' && typeof t.colorIndex === 'number' && t.colorIndex >= 0 && t.colorIndex <= 9 ? t.colorIndex : 0;
        const startDate = typeof t === 'object' && t.startDate ? String(t.startDate).slice(0, 10) : '';
        const endDate = typeof t === 'object' && t.endDate ? String(t.endDate).slice(0, 10) : '';
        return { ...tab, colorIndex, startDate, endDate };
      }).filter(t => t.name) : [];
    } catch (_) {
      state.deletedMemoTabs = [];
    }
    saveMemoTabs();
    saveDeletedMemoTabs();
    renderMemoTabs();
    renderCategoryManageList();
  }

  function renderCategoryManageList() {
    const listEl = document.getElementById('calendar-category-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    (state.memoTabs || []).forEach(tab => {
      if (!isMemoTabInActivePeriod(tab)) return;
      const item = document.createElement('div');
      item.className = 'calendar-category-item';
      const idx = typeof tab.colorIndex === 'number' && tab.colorIndex >= 0 && tab.colorIndex <= 9 ? tab.colorIndex : 0;
      item.style.backgroundColor = MEMO_PASTEL_COLORS[idx];
      const name = document.createElement('span');
      name.className = 'calendar-category-name';
      name.textContent = tab.name || '(이름 없음)';
      item.appendChild(name);
      listEl.appendChild(item);
    });
  }

  function saveMemoTabs() {
    setToStore(STORAGE_MEMO_TABS, JSON.stringify(state.memoTabs));
  }

  function saveDeletedMemoTabs() {
    setToStore(STORAGE_DELETED_MEMO_TABS, JSON.stringify(state.deletedMemoTabs));
  }

  function normalizeMemoItems(data) {
    if (Array.isArray(data)) {
      const seen = new Set();
      return data.map((x, i) => {
        let id = x.id;
        if (id === undefined || id === null || id === '') id = 'mi_' + i;
        if (seen.has(String(id))) id = 'mi_' + i + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        seen.add(String(id));
        return {
          id,
          title: typeof x.title === 'string' ? x.title : (typeof x.text === 'string' ? x.text : ''),
          completed: !!x.completed,
          content: typeof x.content === 'string' ? x.content : '',
          important: (x.important === 'blue' || x.important === 'red') ? x.important : (x.important === true ? 'red' : false)
        };
      });
    }
    if (typeof data === 'string') {
      const lines = data.split('\n').filter(s => s.trim() !== '');
      return lines.length ? lines.map((s, i) => ({ id: 'mi_' + i, title: s.trim(), completed: false, content: '', important: false })) : [{ id: 'mi_0', title: '', completed: false, content: '', important: false }];
    }
    return [{ id: 'mi_0', title: '', completed: false, content: '', important: false }];
  }

  function loadMemos() {
    try {
      const raw = getFromStore(STORAGE_MEMOS);
      const parsed = raw ? JSON.parse(raw) : {};
      state.memos = {};
      for (const k of Object.keys(parsed)) {
        state.memos[k] = normalizeMemoItems(parsed[k]);
      }
    } catch (_) {
      state.memos = {};
    }
  }

  function saveMemos() {
    setToStore(STORAGE_MEMOS, JSON.stringify(state.memos));
  }

  /** 메모 본문: textarea 또는 contenteditable 높이 자동 조절 */
  function adjustMemoItemContentHeight(el) {
    if (!el) return;
    if (el.tagName === 'TEXTAREA') {
      el.style.overflowY = 'hidden';
      el.style.height = '0';
      el.style.height = el.scrollHeight + 'px';
      return;
    }
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      el.style.overflowY = 'hidden';
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }

  function bindMemoItemContentAutosize(el) {
    function onInput() {
      adjustMemoItemContentHeight(el);
    }
    el.addEventListener('input', onInput);
    if (el.tagName === 'TEXTAREA') {
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(onInput);
          } else {
            setTimeout(onInput, 0);
          }
        }
      });
    }
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(onInput);
    } else {
      setTimeout(onInput, 0);
    }
  }

  (function setupMemoContentResizeReflow() {
    var memoResizeTimer = null;
    window.addEventListener('resize', function () {
      if (memoResizeTimer) clearTimeout(memoResizeTimer);
      memoResizeTimer = setTimeout(function () {
        document.querySelectorAll('textarea.memo-item-content, .memo-item-content-rich').forEach(adjustMemoItemContentHeight);
      }, 150);
    });
  })();

  function ensureMemoItems(tabId) {
    if (!state.memos[tabId] || !Array.isArray(state.memos[tabId])) {
      state.memos[tabId] = [];
    }
    return state.memos[tabId];
  }

  function getAllCompletedMemoCount() {
    var n = 0;
    (state.memoTabs || []).forEach(function (tab) {
      if (!isMemoTabInActivePeriod(tab)) return;
      ensureMemoItems(tab.id).forEach(function (m) {
        if (m && m.completed) n += 1;
      });
    });
    return n;
  }

  function updateMemoCompletedTotalFooter() {
    var el = document.getElementById('memo-completed-total-btn');
    if (el) el.textContent = '완료 전체 ' + getAllCompletedMemoCount();
  }

  function setMemoItemImportant(tabId, itemId, important) {
    const tab = getMemoTabById(tabId);
    if (!tab || !isMemoTabInActivePeriod(tab)) return;
    const items = state.memos[tabId];
    if (!items) return;
    const m = items.find(x => x.id === itemId);
    if (m) {
      pushUndoSnapshot();
      m.important = important;
      saveMemos();
      if (state.viewAllMemos) showMemoContent();
      else if (state.activeMemoTabId === tabId) renderMemoItemList(tabId);
    }
  }

  function sortMemoItemsCompletedLast(items) {
    return [...items].sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0));
  }

  function fillMemoCompletedModalCategorySelect(selectedTabId) {
    const select = document.getElementById('memo-completed-modal-category');
    if (!select) return;
    select.innerHTML = '';
    (state.memoTabs || []).forEach(function (tab) {
      if (!isMemoTabInActivePeriod(tab)) return;
      const completedCount = ensureMemoItems(tab.id).reduce(function (acc, m) {
        return acc + (m && m.completed ? 1 : 0);
      }, 0);
      const opt = document.createElement('option');
      opt.value = tab.id;
      opt.textContent = completedCount > 0 ? (tab.name + '\u2002\u2002\u2002' + completedCount) : tab.name;
      select.appendChild(opt);
    });
    const want = selectedTabId && getMemoTabById(selectedTabId) && isMemoTabInActivePeriod(getMemoTabById(selectedTabId))
      ? String(selectedTabId)
      : '';
    if (want && Array.prototype.some.call(select.options, function (o) { return o.value === want; })) {
      select.value = want;
    } else if (select.options.length) {
      select.selectedIndex = 0;
    }
  }

  function renderMemoCompletedModalList(tabId) {
    const modal = document.getElementById('memo-completed-modal');
    const listEl = document.getElementById('memo-completed-modal-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!tabId) {
      const empty = document.createElement('p');
      empty.className = 'memo-completed-modal-empty';
      empty.textContent = '선택할 분류가 없습니다.';
      listEl.appendChild(empty);
      return;
    }
    const tab = getMemoTabById(tabId);
    if (!tab || !isMemoTabInActivePeriod(tab)) {
      const empty = document.createElement('p');
      empty.className = 'memo-completed-modal-empty';
      empty.textContent = '완료된 메모가 없습니다.';
      listEl.appendChild(empty);
      return;
    }
    if (modal) modal.dataset.memoTabId = String(tabId);
    const completed = sortMemoItemsCompletedLast(ensureMemoItems(tabId)).filter(function (m) { return m.completed; });
    completed.forEach(function (m) {
      const card = document.createElement('div');
      card.className = 'memo-completed-modal-item';
      const head = document.createElement('div');
      head.className = 'memo-completed-modal-item-head';
      const titleDiv = document.createElement('div');
      titleDiv.className = 'memo-completed-modal-title-text';
      titleDiv.textContent = (m.title && String(m.title).trim()) ? m.title : '(제목 없음)';
      const actions = document.createElement('span');
      actions.className = 'memo-completed-modal-item-actions';
      const unBtn = document.createElement('button');
      unBtn.type = 'button';
      unBtn.className = 'memo-completed-modal-uncomplete';
      unBtn.textContent = '미완료';
      unBtn.dataset.tabId = String(tabId);
      unBtn.dataset.itemId = String(m.id);
      unBtn.title = '다시 미완료 목록으로';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'memo-completed-modal-delete';
      delBtn.textContent = '×';
      delBtn.dataset.tabId = String(tabId);
      delBtn.dataset.itemId = String(m.id);
      delBtn.title = '삭제';
      delBtn.setAttribute('aria-label', '삭제');
      actions.appendChild(unBtn);
      actions.appendChild(delBtn);
      head.appendChild(titleDiv);
      head.appendChild(actions);
      const body = document.createElement('div');
      body.className = 'memo-completed-modal-body';
      body.textContent = memoContentToPlain(m.content || '');
      card.appendChild(head);
      card.appendChild(body);
      listEl.appendChild(card);
    });
    if (!completed.length) {
      const empty = document.createElement('p');
      empty.className = 'memo-completed-modal-empty';
      empty.textContent = '완료된 메모가 없습니다.';
      listEl.appendChild(empty);
    }
  }

  function openMemoCompletedModal(tabId) {
    const modal = document.getElementById('memo-completed-modal');
    const select = document.getElementById('memo-completed-modal-category');
    if (!modal) return;
    fillMemoCompletedModalCategorySelect(tabId);
    const effectiveTabId = (select && select.value) ? select.value : tabId;
    modal.classList.add('show');
    renderMemoCompletedModalList(effectiveTabId);
  }

  function closeMemoCompletedModal() {
    const modal = document.getElementById('memo-completed-modal');
    if (modal) modal.classList.remove('show');
  }

  function renderMemoTabs() {
    const select = document.getElementById('memo-category-select');
    if (!select) return;
    const firstActive = state.memoTabs.find(t => isMemoTabInActivePeriod(t));
    let currentValue = state.viewAllMemos ? '' : (state.activeMemoTabId || (firstActive ? firstActive.id : ''));
    if (currentValue && !isMemoTabInActivePeriod(getMemoTabById(currentValue))) {
      currentValue = firstActive ? firstActive.id : '';
    }
    select.innerHTML = '';
    const optEmpty = document.createElement('option');
    optEmpty.value = '';
    optEmpty.textContent = '전체';
    select.appendChild(optEmpty);
    state.memoTabs.forEach(tab => {
      if (!isMemoTabInActivePeriod(tab)) return;
      const opt = document.createElement('option');
      opt.value = tab.id;
      opt.textContent = tab.name;
      select.appendChild(opt);
    });
    select.value = currentValue;
    const viewAllBtn = document.getElementById('memo-view-all-btn');
    if (viewAllBtn) viewAllBtn.classList.toggle('active', !!state.viewAllMemos);
  }

  function selectMemoTab(tabId) {
    if (tabId === '' || tabId == null) {
      state.viewAllMemos = true;
      state.activeMemoTabId = null;
      document.querySelector('.memo-col').classList.add('memo-view-all');
    } else {
      const selTab = getMemoTabById(tabId);
      if (!isMemoTabInActivePeriod(selTab)) {
        alert('사용 기간이 아닌 분류는 선택할 수 없습니다.');
        return;
      }
      state.viewAllMemos = false;
      state.activeMemoTabId = tabId;
      document.querySelector('.memo-col').classList.remove('memo-view-all');
    }
    const viewAllBtn = document.getElementById('memo-view-all-btn');
    if (viewAllBtn) viewAllBtn.classList.toggle('active', !!state.viewAllMemos);
    renderMemoTabs();
    showMemoContent();
  }

  function setMemoItemCompleted(tabId, itemId, completed) {
    const tab = getMemoTabById(tabId);
    if (!tab || !isMemoTabInActivePeriod(tab)) return;
    pushUndoSnapshot();
    const items = ensureMemoItems(tabId).slice();
    const idx = items.findIndex(m => m.id === itemId || String(m.id) === String(itemId));
    if (idx < 0) return;
    const item = items[idx];
    item.completed = completed;
    items.splice(idx, 1);
    items.push(item);
    state.memos[tabId] = items;
    saveMemos();
  }

  function showMemoContent() {
    /* 선택된 분류가 없거나 유효하지 않으면 전체 보기 */
    const hasValidSelection = state.activeMemoTabId && state.memoTabs.some(t => t.id === state.activeMemoTabId && isMemoTabInActivePeriod(t));
    if (!hasValidSelection) {
      state.viewAllMemos = true;
      state.activeMemoTabId = null;
      document.querySelector('.memo-col').classList.add('memo-view-all');
      renderMemoTabs();
    }
    document.querySelectorAll('.memo-editor').forEach(el => el.classList.remove('active'));
    const allContent = document.getElementById('memo-view-all-content');
    if (state.viewAllMemos && allContent) {
      allContent.style.display = 'block';
      allContent.innerHTML = '';
      state.memoTabs.forEach((tab, catIndex) => {
        if (!isMemoTabInActivePeriod(tab)) return;
        const allItems = ensureMemoItems(tab.id);
        const incompleteItems = allItems.filter(m => !m.completed);
        const completedItems = allItems.filter(m => m.completed);
        const items = incompleteItems;
        const block = document.createElement('div');
        const colorIdx = typeof tab.colorIndex === 'number' && tab.colorIndex >= 0 && tab.colorIndex <= 9 ? tab.colorIndex : catIndex % 10;
        block.className = 'memo-all-block memo-all-block-color-' + colorIdx;
        block.dataset.tabId = tab.id;
        const headerRow = document.createElement('div');
        headerRow.className = 'memo-all-block-header';
        const nameEl = document.createElement('div');
        nameEl.className = 'memo-all-category-name';
        nameEl.textContent = tab.name;
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'memo-all-add-btn';
        addBtn.title = '메모 추가';
        addBtn.textContent = '⊕';
        addBtn.dataset.tabId = tab.id;
        addBtn.addEventListener('click', () => {
          addMemoItem(tab.id);
          showMemoContent();
        });
        headerRow.appendChild(nameEl);
        headerRow.appendChild(addBtn);
        block.appendChild(headerRow);
        const contentWrap = document.createElement('div');
        contentWrap.className = 'memo-all-category-content';
        if (items.length > 0) {
          const listEl = document.createElement('ul');
          listEl.className = 'memo-item-list';
          incompleteItems.forEach((m, arrayIndex) => {
            const li = document.createElement('li');
            li.className = 'memo-item-row' + (m.important === 'blue' ? ' memo-item-important-blue' : m.important === 'red' ? ' memo-item-important-red' : '');
            li.draggable = true;
            li.dataset.tabId = String(tab.id);
            li.dataset.itemId = String(m.id);
            li.dataset.index = String(arrayIndex);
            const body = document.createElement('div');
            body.className = 'memo-item-body';
            const titleRow = document.createElement('div');
            titleRow.className = 'memo-item-title-row';
            const dragLead = document.createElement('span');
            dragLead.className = 'memo-item-drag-lead';
            dragLead.setAttribute('aria-hidden', 'true');
            dragLead.title = '끌어서 순서 이동';
            const label = document.createElement('label');
            label.className = 'memo-item-label';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'memo-item-check';
            cb.dataset.tabId = tab.id;
            cb.dataset.itemId = m.id;
            cb.draggable = false;
            const importantBtn = document.createElement('button');
            importantBtn.type = 'button';
            importantBtn.className = 'memo-item-important-toggle' + (m.important === 'blue' ? ' important-blue' : m.important === 'red' ? ' important-red' : '');
            importantBtn.dataset.tabId = tab.id;
            importantBtn.dataset.itemId = m.id;
            importantBtn.title = m.important === 'red' ? '중요 빨강 (클릭 해제)' : m.important === 'blue' ? '중요 파랑 (클릭 시 빨강)' : '중요 표시';
            importantBtn.setAttribute('aria-label', '중요');
            importantBtn.textContent = (m.important === 'blue' || m.important === 'red') ? '★' : '☆';
            importantBtn.draggable = false;
            const titleInput = document.createElement('input');
            titleInput.type = 'text';
            titleInput.className = 'memo-item-title';
            titleInput.value = m.title || '';
            titleInput.placeholder = '제목';
            titleInput.dataset.tabId = tab.id;
            titleInput.dataset.itemId = m.id;
            titleInput.draggable = false;
            label.appendChild(cb);
            titleRow.appendChild(dragLead);
            titleRow.appendChild(label);
            titleRow.appendChild(importantBtn);
            titleRow.appendChild(titleInput);
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'memo-item-delete-btn';
            delBtn.title = '삭제';
            delBtn.textContent = '';
            delBtn.dataset.tabId = String(tab.id);
            delBtn.dataset.itemId = String(m.id);
            delBtn.draggable = false;
            titleRow.appendChild(delBtn);
            const dragTail = document.createElement('span');
            dragTail.className = 'memo-item-drag-tail';
            dragTail.setAttribute('aria-hidden', 'true');
            dragTail.title = '끌어서 순서 이동';
            titleRow.appendChild(dragTail);
            const contentInput = document.createElement('div');
            contentInput.className = 'memo-item-content memo-item-content-rich calendar-memo-contenteditable';
            contentInput.contentEditable = 'true';
            contentInput.spellcheck = false;
            contentInput.setAttribute('spellcheck', 'false');
            contentInput.setAttribute('autocorrect', 'off');
            contentInput.setAttribute('autocomplete', 'off');
            contentInput.setAttribute('data-placeholder', '내용');
            setMemoItemContentHtml(contentInput, m.content || '');
            contentInput.dataset.tabId = tab.id;
            contentInput.dataset.itemId = m.id;
            contentInput.draggable = false;
            body.appendChild(titleRow);
            body.appendChild(contentInput);
            li.appendChild(body);
            listEl.appendChild(li);

            cb.addEventListener('change', function () {
              setMemoItemCompleted(this.dataset.tabId, this.dataset.itemId, true);
              showMemoContent();
            });
            importantBtn.addEventListener('click', function (e) {
              e.preventDefault();
              e.stopPropagation();
              const it = state.memos[tab.id].find(x => x.id === m.id);
              const current = it && (it.important === 'blue' || it.important === 'red') ? it.important : false;
              setMemoItemImportant(tab.id, m.id, nextImportant(current));
            });
            function saveMemoFieldsAll() {
              const it = state.memos[tab.id].find(x => x.id === m.id);
              if (it) {
                it.title = titleInput.value.trim();
                it.content = contentInput.innerHTML;
                saveMemos();
              }
            }
            titleInput.addEventListener('change', saveMemoFieldsAll);
            titleInput.addEventListener('blur', saveMemoFieldsAll);
            titleInput.addEventListener('keydown', function (e) {
              if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
            });
            contentInput.addEventListener('input', function () {
              saveMemoFieldsAll();
              adjustMemoItemContentHeight(contentInput);
            });
            contentInput.addEventListener('blur', saveMemoFieldsAll);
            bindMemoItemContentAutosize(contentInput);
            delBtn.addEventListener('click', function (e) {
              e.preventDefault();
              e.stopPropagation();
              const btn = e.currentTarget;
              const tabId = btn.dataset.tabId;
              const itemId = btn.dataset.itemId;
              if (tabId != null && itemId != null) deleteMemoItem(tabId, itemId);
              showMemoContent();
            });
            /* dragstart의 e.target은 보통 li라 자식(여백/라벨) 판별 불가 → pointerdown/mousedown 기준 */
            let memoDragPointerTarget = null;
            const setMemoDragDownTarget = e => {
              if (e.button !== 0) return;
              memoDragPointerTarget = e.target;
            };
            li.addEventListener('pointerdown', setMemoDragDownTarget, true);
            li.addEventListener('mousedown', setMemoDragDownTarget, true);
            li.addEventListener('dragstart', e => {
              const startEl = memoDragPointerTarget;
              memoDragPointerTarget = null;
              if (!startEl || !startEl.closest) {
                e.preventDefault();
                return;
              }
              const onDragMargin = startEl.closest('.memo-item-drag-lead, .memo-item-drag-tail');
              const onMemoTitle = startEl.closest('.memo-item-title');
              const onBlocked = startEl.closest('input, textarea, button, label, [contenteditable="true"]');
              /* 제목 입력란: input 이지만 행 드래그(순서 이동) 허용 */
              if (!onDragMargin && !onMemoTitle && onBlocked) {
                e.preventDefault();
                return;
              }
              state.dragMemoTabId = String(tab.id);
              state.draggedMemoPayload = { tabId: tab.id, itemId: m.id, index: arrayIndex };
              state.memoIncompleteCount = incompleteItems.length;
              state.memoDropTarget = null;
              state.memoToTodoDropTarget = null;
              li.classList.add('memo-item-dragging');
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(arrayIndex));
              e.dataTransfer.setData('application/json', JSON.stringify({
                tabId: tab.id,
                index: arrayIndex,
                itemId: m.id,
                nIncomplete: incompleteItems.length
              }));
              e.dataTransfer.setDragImage(li, 0, 0);
            });
            li.addEventListener('dragend', () => {
              memoDragPointerTarget = null;
              state.dragMemoTabId = null;
              state.draggedMemoPayload = null;
              state.memoIncompleteCount = null;
              state.memoDropTarget = null;
              state.memoToTodoDropTarget = null;
              li.classList.remove('memo-item-dragging');
              listEl.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
              document.querySelectorAll('.memo-all-block').forEach(b => b.classList.remove('memo-all-block-drop-over', 'memo-all-block-drop-line'));
              document.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
              document.querySelectorAll('.todo-section').forEach(s => s.classList.remove('todo-section-drop-zone'));
              document.querySelectorAll('.cal-full-day').forEach(el => el.classList.remove('cal-full-day-drag-over'));
            });
          });
          function onMemoAllBlockListDragOver(e) {
            if (state.dragMemoTabId == null || String(state.dragMemoTabId) !== String(tab.id)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              updateMemoDropLine(e);
          }
          function onMemoAllBlockListDrop(e) {
              e.preventDefault();
            e.stopPropagation();
              let dragPayload;
              try {
                dragPayload = JSON.parse(e.dataTransfer.getData('application/json'));
              } catch (_) { return; }
            if (String(dragPayload.tabId) !== String(tab.id)) return;
              const fromIndex = dragPayload.index;
            const t = state.memoDropTarget && String(state.memoDropTarget.tabId) === String(tab.id) ? state.memoDropTarget : null;
            if (!t || typeof t.insertBefore !== 'number') return;
            var nInc = state.memoIncompleteCount;
            if ((nInc == null || nInc < 1) && dragPayload.nIncomplete != null) nInc = dragPayload.nIncomplete;
            if (nInc == null || nInc < 1) return;
              listEl.querySelectorAll('.memo-item-row').forEach(el => {
                el.classList.remove('memo-item-over-top', 'memo-item-over-bottom');
              });
              state.memoDropTarget = null;
            const dest = memoReorderDestAfterRemove(fromIndex, t.insertBefore, nInc);
            if (dest == null) return;
            reorderMemoItems(tab.id, fromIndex, dest);
          }
          listEl.addEventListener('dragover', onMemoAllBlockListDragOver);
          listEl.addEventListener('drop', onMemoAllBlockListDrop);
          if (listEl.parentElement) {
            listEl.parentElement.addEventListener('dragover', onMemoAllBlockListDragOver);
            listEl.parentElement.addEventListener('drop', onMemoAllBlockListDrop);
          }
          listEl.querySelectorAll('.memo-item-row').forEach(li => {
            li.addEventListener('dragover', onMemoAllBlockListDragOver);
            li.addEventListener('dragleave', function (ev) {
              var rel = ev.relatedTarget;
              if (rel && ev.currentTarget.contains(rel)) return;
              ev.currentTarget.classList.remove('memo-item-over-top', 'memo-item-over-bottom');
            });
            li.addEventListener('drop', onMemoAllBlockListDrop);
          });
          contentWrap.appendChild(listEl);
        }
        if (completedItems.length > 0) {
          const allCompletedBtn = document.createElement('button');
          allCompletedBtn.type = 'button';
          allCompletedBtn.className = 'memo-all-completed-count-btn';
          allCompletedBtn.textContent = '완료 ' + completedItems.length;
          allCompletedBtn.setAttribute('aria-label', '완료된 메모 보기');
          allCompletedBtn.addEventListener('click', function () {
            openMemoCompletedModal(tab.id);
          });
          contentWrap.appendChild(allCompletedBtn);
        }
        block.appendChild(contentWrap);
        allContent.appendChild(block);

        function onBlockDragover(e) {
          if (!state.dragMemoTabId || String(state.dragMemoTabId) === String(tab.id)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
        function onBlockDragleave(e) {
          if (!e.relatedTarget || !block.contains(e.relatedTarget)) {
            block.classList.remove('memo-all-block-drop-line');
            block.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
          }
        }
        function onBlockDrop(e) {
          let payload;
          try {
            payload = JSON.parse(e.dataTransfer.getData('application/json'));
          } catch (_) { return; }
          if (payload.tabId === tab.id) return;
          if (!payload.itemId) return;
          e.preventDefault();
          e.stopPropagation();
          block.classList.remove('memo-all-block-drop-line');
          block.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
          var insertIndex;
          var t = state.memoDropTarget && String(state.memoDropTarget.tabId) === String(tab.id) ? state.memoDropTarget : null;
          if (t && t.el) {
            var toIndex = parseInt(t.el.dataset.index, 10);
            insertIndex = t.insertAbove ? toIndex : toIndex + 1;
          } else if (t && !t.el && t.insertAbove) {
            insertIndex = 0;
          } else {
            insertIndex = undefined;
          }
          moveMemoItemToTab(payload.tabId, payload.itemId, tab.id, insertIndex);
          state.memoDropTarget = null;
          state.dragMemoTabId = null;
          state.memoIncompleteCount = null;
          state.draggedMemoPayload = null;
        }
        block.addEventListener('dragover', onBlockDragover);
        block.addEventListener('dragleave', onBlockDragleave);
        block.addEventListener('drop', onBlockDrop);
      });
      /* 전체보기: 제목에 마우스 올릴 때만 내용 팝업(제목 위쪽) */
      (function initMemoContentTooltip() {
        var tooltipEl = document.getElementById('memo-content-tooltip');
        if (!tooltipEl) {
          tooltipEl = document.createElement('div');
          tooltipEl.id = 'memo-content-tooltip';
          tooltipEl.className = 'memo-content-tooltip';
          tooltipEl.setAttribute('aria-hidden', 'true');
          document.body.appendChild(tooltipEl);
        }
        var hideTimer = null;
        function positionMemoContentTooltip(anchorRect) {
          var gap = 6;
          tooltipEl.style.display = 'block';
          var tw = tooltipEl.offsetWidth;
          var th = tooltipEl.offsetHeight;
          var viewW = window.innerWidth;
          var viewH = window.innerHeight;
          var left = anchorRect.left;
          var top = anchorRect.top - th - gap;
          if (left + tw > viewW - 8) left = Math.max(8, viewW - tw - 8);
          if (left < 8) left = 8;
          if (top < 8) {
            top = anchorRect.bottom + gap;
          }
          if (top + th > viewH - 8) {
            top = Math.max(8, viewH - th - 8);
          }
          tooltipEl.style.left = left + 'px';
          tooltipEl.style.top = top + 'px';
        }
        allContent.querySelectorAll('.memo-item-row').forEach(function (row) {
          var contentEl = row.querySelector('.memo-item-content');
          var titleEl = row.querySelector('.memo-item-title');
          if (!contentEl || !titleEl) return;
          titleEl.addEventListener('mouseenter', function () {
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
            var tabId = row.dataset.tabId;
            var itemId = row.dataset.itemId;
            var html = '';
            if (tabId != null && itemId != null && state.memos[tabId]) {
              var found = state.memos[tabId].find(function (x) { return String(x.id) === String(itemId); });
              if (found) html = found.content || '';
            }
            if (!html && contentEl) html = contentEl.innerHTML || '';
            var text = memoHtmlToPlainWithLineBreaks(html);
            if (!String(text).trim()) { tooltipEl.style.display = 'none'; return; }
            tooltipEl.textContent = text;
            positionMemoContentTooltip(titleEl.getBoundingClientRect());
          });
          titleEl.addEventListener('mouseleave', function () {
            hideTimer = setTimeout(function () { tooltipEl.style.display = 'none'; }, 120);
          });
        });
      })();
      updateMemoCompletedTotalFooter();
      return;
    }
    if (allContent) allContent.style.display = 'none';
    const contentArea = document.getElementById('memo-content-area');
    const memoTabBar = document.querySelector('.memo-tab-bar');
    const colorClasses = ['memo-color-0', 'memo-color-1', 'memo-color-2', 'memo-color-3', 'memo-color-4', 'memo-color-5', 'memo-color-6', 'memo-color-7', 'memo-color-8', 'memo-color-9'];
    if (contentArea) {
      contentArea.classList.remove(...colorClasses);
      if (state.activeMemoTabId) {
        const tab = state.memoTabs.find(t => t.id === state.activeMemoTabId);
        if (tab && typeof tab.colorIndex === 'number' && tab.colorIndex >= 0 && tab.colorIndex <= 9) contentArea.classList.add('memo-color-' + tab.colorIndex);
      }
    }
    if (memoTabBar) {
      memoTabBar.classList.remove(...colorClasses);
      if (state.activeMemoTabId) {
        const tab = state.memoTabs.find(t => t.id === state.activeMemoTabId);
        if (tab && typeof tab.colorIndex === 'number' && tab.colorIndex >= 0 && tab.colorIndex <= 9) memoTabBar.classList.add('memo-color-' + tab.colorIndex);
      }
    }
    if (state.activeMemoTabId) {
      const editor = document.getElementById('memo-editor');
      editor.classList.add('active');
      renderMemoItemList(state.activeMemoTabId);
    }
    updateMemoCompletedTotalFooter();
  }

  function renderMemoItemList(tabId) {
    const listEl = document.getElementById('memo-item-list');
    const countBtn = document.getElementById('memo-completed-count-btn');
    if (!listEl) return;
    const tabMeta = getMemoTabById(tabId);
    if (!tabMeta || !isMemoTabInActivePeriod(tabMeta)) {
    listEl.innerHTML = '';
      if (countBtn) {
        countBtn.hidden = true;
        countBtn.textContent = '완료 0';
      }
      updateMemoCompletedTotalFooter();
      return;
    }
    const sorted = sortMemoItemsCompletedLast(ensureMemoItems(tabId));
    const incompleteItems = sorted.filter(m => !m.completed);
    const completedItems = sorted.filter(m => m.completed);
    listEl.innerHTML = '';
    if (countBtn) {
      if (completedItems.length === 0) {
        countBtn.hidden = true;
        countBtn.textContent = '완료 0';
      } else {
        countBtn.hidden = false;
        countBtn.textContent = '완료 ' + completedItems.length;
        countBtn.onclick = function () {
          openMemoCompletedModal(tabId);
        };
      }
    }
    incompleteItems.forEach((m, index) => {
      const li = document.createElement('li');
      li.className = 'memo-item-row' + (m.important === 'blue' ? ' memo-item-important-blue' : m.important === 'red' ? ' memo-item-important-red' : '');
      li.draggable = true;
      li.dataset.itemId = String(m.id);
      li.dataset.index = String(index);
      li.dataset.tabId = String(tabId);
      const body = document.createElement('div');
      body.className = 'memo-item-body';
      const titleRow = document.createElement('div');
      titleRow.className = 'memo-item-title-row';
      const dragLead = document.createElement('span');
      dragLead.className = 'memo-item-drag-lead';
      dragLead.setAttribute('aria-hidden', 'true');
      dragLead.title = '끌어서 순서 이동';
      const label = document.createElement('label');
      label.className = 'memo-item-label';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = m.completed;
      cb.className = 'memo-item-check';
      cb.draggable = false;
      const importantBtn = document.createElement('button');
      importantBtn.type = 'button';
      importantBtn.className = 'memo-item-important-toggle' + (m.important === 'blue' ? ' important-blue' : m.important === 'red' ? ' important-red' : '');
      importantBtn.dataset.tabId = tabId;
      importantBtn.dataset.itemId = m.id;
      importantBtn.title = m.important === 'red' ? '중요 빨강 (클릭 해제)' : m.important === 'blue' ? '중요 파랑 (클릭 시 빨강)' : '중요 표시';
      importantBtn.setAttribute('aria-label', '중요');
      importantBtn.textContent = (m.important === 'blue' || m.important === 'red') ? '★' : '☆';
      importantBtn.draggable = false;
      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'memo-item-title';
      titleInput.value = m.title || '';
      titleInput.placeholder = '제목';
      titleInput.draggable = false;
      label.appendChild(cb);
      titleRow.appendChild(dragLead);
      titleRow.appendChild(label);
      titleRow.appendChild(importantBtn);
      titleRow.appendChild(titleInput);
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'memo-item-delete-btn';
      delBtn.title = '삭제';
      delBtn.textContent = '';
      delBtn.draggable = false;
      delBtn.dataset.tabId = String(tabId);
      delBtn.dataset.itemId = String(m.id);
      titleRow.appendChild(delBtn);
      const dragTail = document.createElement('span');
      dragTail.className = 'memo-item-drag-tail';
      dragTail.setAttribute('aria-hidden', 'true');
      dragTail.title = '끌어서 순서 이동';
      titleRow.appendChild(dragTail);
      const contentInput = document.createElement('div');
      contentInput.className = 'memo-item-content memo-item-content-rich calendar-memo-contenteditable';
      contentInput.contentEditable = 'true';
      contentInput.spellcheck = false;
      contentInput.setAttribute('spellcheck', 'false');
      contentInput.setAttribute('autocorrect', 'off');
      contentInput.setAttribute('autocomplete', 'off');
      contentInput.setAttribute('data-placeholder', '내용');
      setMemoItemContentHtml(contentInput, m.content || '');
      contentInput.draggable = false;
      contentInput.dataset.tabId = String(tabId);
      contentInput.dataset.itemId = String(m.id);
      body.appendChild(titleRow);
      body.appendChild(contentInput);
      li.appendChild(body);
      listEl.appendChild(li);

      importantBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const current = (m.important === 'blue' || m.important === 'red') ? m.important : false;
        setMemoItemImportant(tabId, m.id, nextImportant(current));
      });
      let memoDragPointerTarget = null;
      const setMemoDragDownTarget = e => {
        if (e.button !== 0) return;
        memoDragPointerTarget = e.target;
      };
      li.addEventListener('pointerdown', setMemoDragDownTarget, true);
      li.addEventListener('mousedown', setMemoDragDownTarget, true);
      li.addEventListener('dragstart', e => {
        const startEl = memoDragPointerTarget;
        memoDragPointerTarget = null;
        if (!startEl || !startEl.closest) {
          e.preventDefault();
          return;
        }
        const onDragMargin = startEl.closest('.memo-item-drag-lead, .memo-item-drag-tail');
        const onMemoTitle = startEl.closest('.memo-item-title');
        const onBlocked = startEl.closest('input, textarea, button, label, [contenteditable="true"]');
        if (!onDragMargin && !onMemoTitle && onBlocked) {
          e.preventDefault();
          return;
        }
        state.dragMemoTabId = String(tabId);
        state.draggedMemoPayload = { tabId, itemId: m.id, index };
        state.memoIncompleteCount = incompleteItems.length;
        state.memoDropTarget = null;
        state.memoToTodoDropTarget = null;
        li.classList.add('memo-item-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        e.dataTransfer.setData('application/json', JSON.stringify({ tabId, itemId: m.id, index, nIncomplete: incompleteItems.length }));
        e.dataTransfer.setDragImage(li, 0, 0);
      });
      li.addEventListener('dragend', () => {
        memoDragPointerTarget = null;
        state.dragMemoTabId = null;
        state.draggedMemoPayload = null;
        state.memoIncompleteCount = null;
        state.memoDropTarget = null;
        state.memoToTodoDropTarget = null;
        li.classList.remove('memo-item-dragging');
        const body = listEl.closest('.memo-list-body');
        if (body) body.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
        document.querySelectorAll('.memo-all-block').forEach(b => b.classList.remove('memo-all-block-drop-line'));
        document.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
        document.querySelectorAll('.todo-section').forEach(s => s.classList.remove('todo-section-drop-zone'));
        document.querySelectorAll('.cal-full-day').forEach(el => el.classList.remove('cal-full-day-drag-over'));
      });
      cb.addEventListener('change', function () {
        setMemoItemCompleted(tabId, m.id, this.checked);
        renderMemoItemList(tabId);
      });
      function saveMemoFields() {
        const it = state.memos[tabId].find(x => x.id === m.id);
        if (it) {
          it.title = titleInput.value.trim();
          it.content = contentInput.innerHTML;
          saveMemos();
        }
      }
      titleInput.addEventListener('change', saveMemoFields);
      titleInput.addEventListener('blur', saveMemoFields);
      titleInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
      });
      contentInput.addEventListener('input', function () {
        saveMemoFields();
        adjustMemoItemContentHeight(contentInput);
      });
      contentInput.addEventListener('blur', saveMemoFields);
      bindMemoItemContentAutosize(contentInput);
      delBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const btn = e.currentTarget;
        const tabId = btn.dataset.tabId;
        const itemId = btn.dataset.itemId;
        if (tabId != null && itemId != null) deleteMemoItem(tabId, itemId);
      });
    });
    const listBody = listEl.closest('.memo-list-body');
    const allRows = listBody ? listBody.querySelectorAll('.memo-item-row') : listEl.querySelectorAll('.memo-item-row');
    function onMemoCategoryListDragOver(e) {
      if (state.dragMemoTabId == null || String(state.dragMemoTabId) !== String(tabId)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        updateMemoDropLine(e);
    }
    function onMemoCategoryListDrop(e) {
      if (state.dragMemoTabId == null || String(state.dragMemoTabId) !== String(tabId)) return;
        e.preventDefault();
      e.stopPropagation();
        const t = state.memoDropTarget;
      if (!t || typeof t.insertBefore !== 'number' || String(t.tabId) !== String(tabId)) return;
        if (listBody) listBody.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
        else listEl.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
        state.memoDropTarget = null;
      var fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
      var dragMeta = null;
      try {
        dragMeta = JSON.parse(e.dataTransfer.getData('application/json'));
      } catch (_) {}
      if (isNaN(fromIndex) && dragMeta && typeof dragMeta.index === 'number') fromIndex = dragMeta.index;
      var nInc = state.memoIncompleteCount;
      if ((nInc == null || nInc < 1) && dragMeta && dragMeta.nIncomplete != null) nInc = dragMeta.nIncomplete;
      if (isNaN(fromIndex) || nInc == null || nInc < 1) return;
      const dest = memoReorderDestAfterRemove(fromIndex, t.insertBefore, nInc);
      if (dest == null) return;
      reorderMemoItems(tabId, fromIndex, dest);
    }
    listEl.addEventListener('dragover', onMemoCategoryListDragOver);
    listEl.addEventListener('drop', onMemoCategoryListDrop);
    var memoIncWrap = listEl.closest('.memo-incomplete-wrap');
    if (memoIncWrap) {
      memoIncWrap.addEventListener('dragover', onMemoCategoryListDragOver);
      memoIncWrap.addEventListener('drop', onMemoCategoryListDrop);
    }
    allRows.forEach(li => {
      li.addEventListener('dragover', onMemoCategoryListDragOver);
      li.addEventListener('dragleave', function (ev) {
        var rel = ev.relatedTarget;
        if (rel && ev.currentTarget.contains(rel)) return;
        ev.currentTarget.classList.remove('memo-item-over-top', 'memo-item-over-bottom');
      });
      li.addEventListener('drop', onMemoCategoryListDrop);
    });
    updateMemoCompletedTotalFooter();
  }

  function deleteMemoItem(tabId, itemId) {
    if (tabId == null || itemId == null) return;
    if (!isMemoTabInActivePeriod(getMemoTabById(tabId))) return;
    pushUndoSnapshot();
    const items = ensureMemoItems(tabId);
    const itemIdStr = String(itemId);
    const idx = items.findIndex(m => m != null && (m.id === itemId || String(m.id) === itemIdStr));
    if (idx >= 0) {
      items.splice(idx, 1);
      saveMemos();
      if (state.viewAllMemos) showMemoContent();
      else if (state.activeMemoTabId === tabId) renderMemoItemList(tabId);
    }
  }

  function moveMemoItemToTab(sourceTabId, itemId, targetTabId, insertIndex) {
    if (!isMemoTabInActivePeriod(getMemoTabById(sourceTabId)) || !isMemoTabInActivePeriod(getMemoTabById(targetTabId))) return;
    if (sourceTabId === targetTabId) return;
    const srcItems = ensureMemoItems(sourceTabId).slice();
    const itemIndex = srcItems.findIndex(m => m.id === itemId);
    if (itemIndex < 0) return;
    pushUndoSnapshot();
    const item = srcItems[itemIndex];
    srcItems.splice(itemIndex, 1);
    state.memos[sourceTabId] = srcItems;
    const tgtItems = ensureMemoItems(targetTabId);
    const incomplete = tgtItems.filter(m => !m.completed);
    const completed = tgtItems.filter(m => m.completed);
    var at = typeof insertIndex === 'number' && insertIndex >= 0 && insertIndex <= incomplete.length ? insertIndex : incomplete.length;
    incomplete.splice(at, 0, { ...item, completed: false });
    state.memos[targetTabId] = [...incomplete, ...completed];
    saveMemos();
    showMemoContent();
  }

  function reorderMemoItems(tabId, fromIndex, toIndex) {
    if (!isMemoTabInActivePeriod(getMemoTabById(tabId))) return;
    /* UI 인덱스는 미완료 목록 기준이므로, 완료 항목과 섞인 저장 배열이 아니라 미완료/완료 분리 후 순서 변경 */
    const sorted = sortMemoItemsCompletedLast(ensureMemoItems(tabId).slice());
    const incomplete = sorted.filter(m => !m.completed);
    const completed = sorted.filter(m => m.completed);
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= incomplete.length || toIndex >= incomplete.length) return;
    pushUndoSnapshot();
    const [moved] = incomplete.splice(fromIndex, 1);
    incomplete.splice(toIndex, 0, moved);
    state.memos[tabId] = [...incomplete, ...completed];
    saveMemos();
    if (state.viewAllMemos) showMemoContent();
    else renderMemoItemList(tabId);
  }

  function addMemoItem(tabId) {
    if (!isMemoTabInActivePeriod(getMemoTabById(tabId))) {
      alert('사용 기간이 아닌 분류에는 메모를 추가할 수 없습니다.');
      return;
    }
    pushUndoSnapshot();
    const items = ensureMemoItems(tabId);
    const id = 'mi_' + Date.now();
    const completedItems = items.filter(m => m.completed);
    const incompleteItems = items.filter(m => !m.completed);
    state.memos[tabId] = [...incompleteItems, { id, title: '', completed: false, content: '', important: false }, ...completedItems];
    saveMemos();
    renderMemoItemList(tabId);
  }

  function openMemoTabModal(editId, modalOpts) {
    modalOpts = modalOpts || {};
    state.memoTabModalRestrictPeriod = !!modalOpts.restrictPeriodOnly;
    state.editingMemoTabId = editId || null;
    const titleEl = document.getElementById('memo-tab-modal-title');
    const input = document.getElementById('memo-tab-name');
    const startEl = document.getElementById('memo-tab-start');
    const endEl = document.getElementById('memo-tab-end');
    const colorGroup = document.getElementById('memo-tab-color-group');
    const periodGroup = document.getElementById('memo-tab-period-group');
    if (state.memoTabModalRestrictPeriod) {
      titleEl.textContent = '기간 연장';
    } else {
      titleEl.textContent = editId ? '분류 수정' : '분류 추가';
    }
    const pickerEl = document.getElementById('memo-color-picker');
    if (editId) {
      const t = state.memoTabs.find(x => x.id === editId);
      input.value = t ? t.name : '';
      state.editingMemoTabColorIndex = t && typeof t.colorIndex === 'number' ? t.colorIndex : 0;
      if (startEl) startEl.value = (t && t.startDate) ? String(t.startDate).slice(0, 10) : '';
      if (endEl) endEl.value = (t && t.endDate) ? String(t.endDate).slice(0, 10) : '';
    } else {
      input.value = '';
      state.editingMemoTabColorIndex = (state.memoTabs.length) % 10;
      if (startEl) startEl.value = '';
      if (endEl) endEl.value = '';
    }
    if (state.memoTabModalRestrictPeriod) {
      input.readOnly = true;
      if (colorGroup) colorGroup.style.display = 'none';
      if (periodGroup) periodGroup.style.display = '';
    } else {
      input.readOnly = false;
      if (colorGroup) colorGroup.style.display = '';
      if (periodGroup) periodGroup.style.display = '';
    }
    if (pickerEl) {
      pickerEl.innerHTML = '';
      MEMO_PASTEL_COLORS.forEach((hex, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'memo-color-swatch' + (state.editingMemoTabColorIndex === i ? ' selected' : '');
        btn.style.backgroundColor = hex;
        btn.title = (MEMO_PASTEL_COLOR_NAMES[i] || '색 ' + (i + 1)) + ' (' + hex + ')';
        btn.dataset.index = String(i);
        bindColorSwatchTooltip(btn, MEMO_PASTEL_COLOR_NAMES[i] || '색 ' + (i + 1));
        btn.addEventListener('click', () => {
          state.editingMemoTabColorIndex = i;
          pickerEl.querySelectorAll('.memo-color-swatch').forEach((b, j) => b.classList.toggle('selected', j === i));
        });
        pickerEl.appendChild(btn);
      });
    }
    document.getElementById('memo-tab-modal').classList.add('show');
  }

  function closeMemoTabModal() {
    document.getElementById('memo-tab-modal').classList.remove('show');
    state.editingMemoTabId = null;
    state.memoTabModalRestrictPeriod = false;
    const input = document.getElementById('memo-tab-name');
    if (input) input.readOnly = false;
    const colorGroup = document.getElementById('memo-tab-color-group');
    if (colorGroup) colorGroup.style.display = '';
  }

  function openMemoReorderModal() {
    state.fromReorderModal = true;
    refreshMemoReorderList();
    document.getElementById('memo-reorder-modal').classList.add('show');
  }

  function openMemoColorModal(tabId) {
    const tabPre = state.memoTabs.find(t => t.id === tabId);
    if (!tabPre || isMemoTabExpired(tabPre)) return;
    state.editingMemoTabIdForColor = tabId;
    const pickerEl = document.getElementById('memo-color-modal-picker');
    if (pickerEl) {
      const tab = state.memoTabs.find(t => t.id === tabId);
      const current = tab && typeof tab.colorIndex === 'number' ? tab.colorIndex : 0;
      pickerEl.innerHTML = '';
      MEMO_PASTEL_COLORS.forEach((hex, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'memo-color-swatch' + (current === i ? ' selected' : '');
        btn.style.backgroundColor = hex;
        btn.title = (MEMO_PASTEL_COLOR_NAMES[i] || '색 ' + (i + 1)) + ' (' + hex + ')';
        btn.dataset.index = String(i);
        bindColorSwatchTooltip(btn, MEMO_PASTEL_COLOR_NAMES[i] || '색 ' + (i + 1));
        btn.addEventListener('click', () => {
          if (state.editingMemoTabIdForColor) {
            const t = state.memoTabs.find(x => x.id === state.editingMemoTabIdForColor);
            if (t) {
              pushUndoSnapshot();
              t.colorIndex = i;
              saveMemoTabs();
            }
          }
          closeMemoColorModal();
          refreshMemoReorderList();
          initMemoReorderDragDrop(document.getElementById('memo-reorder-list'));
        });
        pickerEl.appendChild(btn);
      });
    }
    document.getElementById('memo-color-modal').classList.add('show');
  }

  function closeMemoColorModal() {
    document.getElementById('memo-color-modal').classList.remove('show');
    state.editingMemoTabIdForColor = null;
  }

  function refreshMemoReorderList() {
    const listEl = document.getElementById('memo-reorder-list');
    if (!listEl) return;
    const parent = listEl.parentNode;
    const footer = parent && parent.querySelector ? parent.querySelector('.memo-reorder-footer') : null;
    listEl.innerHTML = '';
    state.memoTabs.filter(function (t) { return !isMemoTabExpired(t); }).forEach(function (tab) {
      const li = document.createElement('li');
      li.className = 'memo-reorder-item';
      li.dataset.tabId = tab.id;
      li.draggable = true;
      li.title = '드래그하여 순서 변경';
      const colorIndex = typeof tab.colorIndex === 'number' && tab.colorIndex >= 0 && tab.colorIndex <= 9 ? tab.colorIndex : 0;
      li.style.backgroundColor = MEMO_PASTEL_COLORS[colorIndex];
      const nameSpan = document.createElement('span');
      nameSpan.className = 'memo-reorder-name';
      nameSpan.contentEditable = 'true';
      nameSpan.textContent = tab.name;
      nameSpan.title = '클릭하여 분류명 직접 수정';
      const periodBtn = document.createElement('button');
      periodBtn.type = 'button';
      periodBtn.className = 'memo-reorder-period-btn';
      periodBtn.title = '시작·종료일';
      periodBtn.setAttribute('aria-label', '사용 기간');
      const periodIcon = document.createElement('span');
      periodIcon.className = 'memo-reorder-period-icon';
      periodIcon.setAttribute('aria-hidden', 'true');
      periodIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
      periodBtn.appendChild(periodIcon);
      const colorBtn = document.createElement('button');
      colorBtn.type = 'button';
      colorBtn.className = 'memo-reorder-color-btn';
      colorBtn.title = '바탕색 변경';
      colorBtn.setAttribute('aria-label', '바탕색 변경');
      colorBtn.innerHTML = '<span class="memo-reorder-palette-icon" aria-hidden="true">🎨</span>';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'memo-reorder-delete btn-icon';
      delBtn.title = '분류 삭제';
      delBtn.textContent = '';
      li.appendChild(nameSpan);
      li.appendChild(periodBtn);
      li.appendChild(colorBtn);
      li.appendChild(delBtn);
      listEl.appendChild(li);

      periodBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        state.fromReorderModal = true;
        openMemoTabModal(tab.id);
      });
      nameSpan.addEventListener('blur', () => {
        const next = nameSpan.textContent.trim();
        if (next && next !== tab.name) {
          pushUndoSnapshot();
          tab.name = next;
          saveMemoTabs();
        } else {
          nameSpan.textContent = tab.name;
        }
      });
      nameSpan.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); nameSpan.blur(); }
      });
      colorBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        openMemoColorModal(tab.id);
      });
      delBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm(`"${tab.name}" 분류를 삭제할까요? 삭제된 분류는 아래에서 취소하거나 완전 삭제할 수 있습니다.`)) return;
        pushUndoSnapshot();
        state.memoTabs = state.memoTabs.filter(t => t.id !== tab.id);
        state.deletedMemoTabs = state.deletedMemoTabs.concat([{
          id: tab.id,
          name: tab.name,
          colorIndex: typeof tab.colorIndex === 'number' ? tab.colorIndex : 0,
          startDate: tab.startDate || '',
          endDate: tab.endDate || ''
        }]);
        if (state.activeMemoTabId === tab.id) {
          state.activeMemoTabId = null;
          state.viewAllMemos = true;
          document.querySelector('.memo-col').classList.add('memo-view-all');
        }
        saveMemoTabs();
        saveDeletedMemoTabs();
        refreshMemoReorderList();
        initMemoReorderDragDrop(listEl);
      });
    });

    const expSec = document.getElementById('memo-reorder-expired-section');
    const expList = document.getElementById('memo-reorder-expired-list');
    if (expList) expList.innerHTML = '';
    var expiredTabs = state.memoTabs.filter(isMemoTabExpired);
    if (expSec) {
      if (!expiredTabs.length) expSec.hidden = true;
      else {
        expSec.hidden = false;
        expiredTabs.forEach(function (tab) {
          var eli = document.createElement('li');
          eli.className = 'memo-reorder-item memo-reorder-item-expired';
          eli.dataset.tabId = tab.id;
          eli.draggable = false;
          var nspan = document.createElement('span');
          nspan.className = 'memo-reorder-name';
          nspan.contentEditable = 'false';
          nspan.textContent = tab.name || '(이름 없음)';
          var meta = document.createElement('span');
          meta.className = 'memo-reorder-expired-meta';
          var sd = (tab.startDate && String(tab.startDate).length >= 10) ? tab.startDate : '\u2014';
          var ed = (tab.endDate && String(tab.endDate).length >= 10) ? tab.endDate : '\u2014';
          meta.textContent = sd + ' ~ ' + ed;
          var extendBtn = document.createElement('button');
          extendBtn.type = 'button';
          extendBtn.className = 'btn-secondary memo-reorder-extend-btn';
          extendBtn.textContent = '기간 연장';
          extendBtn.title = '종료일을 연장하면 다시 일정·메모에서 사용할 수 있습니다';
          extendBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            state.fromReorderModal = true;
            openMemoTabModal(tab.id, { restrictPeriodOnly: true });
          });
          eli.appendChild(nspan);
          eli.appendChild(meta);
          eli.appendChild(extendBtn);
          expList.appendChild(eli);
        });
      }
    }

    const prevDeleted = parent.querySelector('.memo-reorder-deleted-wrap');
    if (prevDeleted) prevDeleted.remove();
    if (state.deletedMemoTabs && state.deletedMemoTabs.length > 0) {
      const deletedWrap = document.createElement('div');
      deletedWrap.className = 'memo-reorder-deleted-wrap';
      const deletedTitle = document.createElement('div');
      deletedTitle.className = 'memo-reorder-deleted-title';
      deletedTitle.textContent = '삭제된 분류';
      deletedWrap.appendChild(deletedTitle);
      const deletedList = document.createElement('ul');
      deletedList.className = 'memo-reorder-list memo-reorder-deleted-list';
      state.deletedMemoTabs.forEach(tab => {
        const li = document.createElement('li');
        li.className = 'memo-reorder-item memo-reorder-item-deleted';
        li.dataset.tabId = tab.id;
        li.draggable = false;
        const colorIndex = typeof tab.colorIndex === 'number' && tab.colorIndex >= 0 && tab.colorIndex <= 9 ? tab.colorIndex : 0;
        li.style.backgroundColor = MEMO_PASTEL_COLORS[colorIndex];
        const nameSpan = document.createElement('span');
        nameSpan.className = 'memo-reorder-name';
        nameSpan.textContent = tab.name || '(이름 없음)';
        const label = document.createElement('span');
        label.className = 'memo-reorder-deleted-label';
        label.textContent = '삭제됨';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn-secondary memo-reorder-restore-btn';
        cancelBtn.textContent = '취소';
        cancelBtn.title = '분류 삭제 취소';
        const permDelBtn = document.createElement('button');
        permDelBtn.type = 'button';
        permDelBtn.className = 'memo-reorder-perm-delete btn-icon';
        permDelBtn.title = '완전삭제';
        permDelBtn.textContent = '🗑';
        li.appendChild(nameSpan);
        li.appendChild(label);
        li.appendChild(cancelBtn);
        li.appendChild(permDelBtn);
        deletedList.appendChild(li);

        cancelBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          pushUndoSnapshot();
          state.deletedMemoTabs = state.deletedMemoTabs.filter(t => t.id !== tab.id);
          state.memoTabs = state.memoTabs.concat([{
            id: tab.id,
            name: tab.name,
            colorIndex: tab.colorIndex,
            startDate: tab.startDate || '',
            endDate: tab.endDate || ''
          }]);
          saveMemoTabs();
          saveDeletedMemoTabs();
          refreshMemoReorderList();
          initMemoReorderDragDrop(listEl);
        });
        permDelBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          if (!confirm(`"${tab.name}" 분류를 완전히 삭제할까요? 메모도 모두 삭제됩니다.`)) return;
          pushUndoSnapshot();
          state.deletedMemoTabs = state.deletedMemoTabs.filter(t => t.id !== tab.id);
          delete state.memos[tab.id];
          saveDeletedMemoTabs();
          saveMemos();
          refreshMemoReorderList();
          initMemoReorderDragDrop(listEl);
        });
      });
      deletedWrap.appendChild(deletedList);
      if (footer) parent.insertBefore(deletedWrap, footer);
      else parent.appendChild(deletedWrap);
    }

    initMemoReorderDragDrop(listEl);
  }

  function initMemoReorderDragDrop(listEl) {
    const items = listEl.querySelectorAll('.memo-reorder-item');
    items.forEach((item, index) => {
      item.addEventListener('dragstart', e => {
        if (e.target.closest('.memo-reorder-name') || e.target.closest('.memo-reorder-color-btn') || e.target.closest('.memo-reorder-period-btn') || e.target.closest('.btn-icon')) return;
        state.draggingMemoReorder = true;
        state.memoReorderDropTarget = null;
        item.classList.add('memo-reorder-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index);
        e.dataTransfer.setDragImage(item, 0, 0);
      });
      item.addEventListener('dragend', () => {
        state.draggingMemoReorder = false;
        state.memoReorderDropTarget = null;
        item.classList.remove('memo-reorder-dragging');
        document.querySelectorAll('.memo-reorder-item').forEach(el => el.classList.remove('memo-reorder-over-top', 'memo-reorder-over-bottom'));
      });
      item.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        updateMemoReorderDropLine(e);
      });
      item.addEventListener('dragleave', () => {
        items.forEach(el => {
          el.classList.remove('memo-reorder-over-top', 'memo-reorder-over-bottom');
        });
      });
      item.addEventListener('drop', e => {
        e.preventDefault();
        const t = state.memoReorderDropTarget;
        const toItem = t ? t.el : e.target.closest('.memo-reorder-item');
        const dropOnBottom = t ? !t.insertAbove : (toItem && toItem.classList.contains('memo-reorder-over-bottom'));
        items.forEach(el => el.classList.remove('memo-reorder-over-top', 'memo-reorder-over-bottom'));
        state.memoReorderDropTarget = null;
        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (!toItem) return;
        let toIndex = Array.from(listEl.children).indexOf(toItem);
        if (dropOnBottom) toIndex += 1;
        if (fromIndex === toIndex || fromIndex === toIndex - 1) return;
        pushUndoSnapshot();
        const idOrder = Array.from(listEl.children).map(el => el.dataset.tabId);
        const [movedId] = idOrder.splice(fromIndex, 1);
        const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
        idOrder.splice(insertIndex, 0, movedId);
        const newActiveOrder = idOrder.map(id => state.memoTabs.find(t => t.id === id)).filter(Boolean);
        const expiredOrdered = state.memoTabs.filter(isMemoTabExpired);
        state.memoTabs = newActiveOrder.concat(expiredOrdered);
        saveMemoTabs();
        refreshMemoReorderList();
      });
    });
  }

  const memoViewAllBtn = document.getElementById('memo-view-all-btn');
  if (memoViewAllBtn) {
    memoViewAllBtn.addEventListener('click', () => {
      selectMemoTab('');
    });
  }

  const memoCategorySelect = document.getElementById('memo-category-select');
  if (memoCategorySelect) {
    memoCategorySelect.addEventListener('change', function () {
      selectMemoTab(this.value);
    });
  }

  const calendarCategoryEdit = document.getElementById('calendar-category-edit');
  if (calendarCategoryEdit) calendarCategoryEdit.addEventListener('click', openMemoReorderModal);
  const memoCategoryEditBtn = document.getElementById('memo-category-edit-btn');
  if (memoCategoryEditBtn) memoCategoryEditBtn.addEventListener('click', openMemoReorderModal);

  const memoAddNextToReorder = document.getElementById('memo-add-next-to-reorder');
  if (memoAddNextToReorder) {
    memoAddNextToReorder.addEventListener('click', () => {
      const select = document.getElementById('memo-category-select');
      const tabId = (select && select.value) || state.activeMemoTabId || getPersonalTabId();
      if (tabId) {
        if (state.viewAllMemos) {
          state.viewAllMemos = false;
          state.activeMemoTabId = tabId;
          if (select) select.value = tabId;
          showMemoContent();
        }
        addMemoItem(tabId);
      } else {
        alert('먼저 분류를 추가하거나 선택하세요.');
      }
    });
  }

  document.getElementById('memo-reorder-add').addEventListener('click', () => {
    state.fromReorderModal = true;
    openMemoTabModal(null);
  });

  document.getElementById('memo-reorder-close').addEventListener('click', () => {
    document.getElementById('memo-reorder-modal').classList.remove('show');
    state.fromReorderModal = false;
    renderMemoTabs();
    showMemoContent();
    renderCategoryManageList();
  });

  document.getElementById('memo-color-modal-cancel').addEventListener('click', closeMemoColorModal);

  (function setupMemoCompletedModal() {
    const modal = document.getElementById('memo-completed-modal');
    const closeBtn = document.getElementById('memo-completed-modal-close');
    const listEl = document.getElementById('memo-completed-modal-list');
    const catSelect = document.getElementById('memo-completed-modal-category');
    if (closeBtn) closeBtn.addEventListener('click', closeMemoCompletedModal);
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeMemoCompletedModal();
      });
    }
    if (catSelect) {
      catSelect.addEventListener('change', function () {
        renderMemoCompletedModalList(this.value);
      });
    }
    var totalBtn = document.getElementById('memo-completed-total-btn');
    if (totalBtn) {
      totalBtn.addEventListener('click', function () {
        var tabs = state.memoTabs || [];
        var id = state.activeMemoTabId;
        if (!id || !getMemoTabById(id) || !isMemoTabInActivePeriod(getMemoTabById(id))) {
          var first = tabs.find(function (t) { return isMemoTabInActivePeriod(t); });
          id = first ? first.id : null;
        }
        if (id) openMemoCompletedModal(id);
      });
    }
    if (listEl) {
      listEl.addEventListener('click', function (e) {
        const del = e.target.closest('.memo-completed-modal-delete');
        if (del) {
          e.preventDefault();
          e.stopPropagation();
          const tid = del.dataset.tabId;
          const iid = del.dataset.itemId;
          if (tid == null || iid == null) return;
          deleteMemoItem(tid, iid);
          updateMemoCompletedTotalFooter();
          const sel = document.getElementById('memo-completed-modal-category');
          if (sel && sel.value) {
            fillMemoCompletedModalCategorySelect(sel.value);
            renderMemoCompletedModalList(sel.value);
          }
          return;
        }
        const btn = e.target.closest('.memo-completed-modal-uncomplete');
        if (!btn) return;
        e.preventDefault();
        const tid = btn.dataset.tabId;
        const iid = btn.dataset.itemId;
        if (tid == null || iid == null) return;
        setMemoItemCompleted(tid, iid, false);
        if (state.viewAllMemos) showMemoContent();
        else if (state.activeMemoTabId === tid) renderMemoItemList(tid);
        const sel = document.getElementById('memo-completed-modal-category');
        if (sel && sel.value) {
          fillMemoCompletedModalCategorySelect(sel.value);
          renderMemoCompletedModalList(sel.value);
        }
        updateMemoCompletedTotalFooter();
      });
    }
  })();

  document.getElementById('memo-tab-save').addEventListener('click', () => {
    const startEl = document.getElementById('memo-tab-start');
    const endEl = document.getElementById('memo-tab-end');
    const startDate = (startEl && startEl.value) ? startEl.value.trim().slice(0, 10) : '';
    const endDate = (endEl && endEl.value) ? endEl.value.trim().slice(0, 10) : '';
    if (startDate && endDate && startDate > endDate) {
      alert('시작일은 종료일과 같거나 이전이어야 합니다.');
      return;
    }
    if (state.memoTabModalRestrictPeriod && state.editingMemoTabId) {
      pushUndoSnapshot();
      const t = state.memoTabs.find(x => x.id === state.editingMemoTabId);
      if (t) {
        t.startDate = startDate;
        t.endDate = endDate;
      }
      saveMemoTabs();
      closeMemoTabModal();
      if (state.fromReorderModal) {
        refreshMemoReorderList();
        initMemoReorderDragDrop(document.getElementById('memo-reorder-list'));
      }
      renderMemoTabs();
      showMemoContent();
      renderCategoryManageList();
      if (state.viewMode === 'calendarFull') renderCalendarFull();
      renderTodos();
      renderCalendar();
      return;
    }
    const name = document.getElementById('memo-tab-name').value.trim();
    if (!name) { alert('분류 이름을 입력하세요.'); return; }
    pushUndoSnapshot();
    const colorIndex = typeof state.editingMemoTabColorIndex === 'number' ? state.editingMemoTabColorIndex : 0;
    if (state.editingMemoTabId) {
      const t = state.memoTabs.find(x => x.id === state.editingMemoTabId);
      if (t) {
        t.name = name;
        t.colorIndex = colorIndex;
        t.startDate = startDate;
        t.endDate = endDate;
      }
    } else {
      state.memoTabs.push({ id: 'tab_' + Date.now(), name, colorIndex, startDate, endDate });
      state.activeMemoTabId = state.memoTabs[state.memoTabs.length - 1].id;
    }
    saveMemoTabs();
    closeMemoTabModal();
    if (state.fromReorderModal) {
      refreshMemoReorderList();
      initMemoReorderDragDrop(document.getElementById('memo-reorder-list'));
    } else {
      renderMemoTabs();
      showMemoContent();
    }
    renderCategoryManageList();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
    renderTodos();
    renderCalendar();
  });
  document.getElementById('memo-tab-cancel').addEventListener('click', () => {
    closeMemoTabModal();
    state.fromReorderModal = false;
  });

  (function setupRepeatDeleteModal() {
    const modal = document.getElementById('repeat-delete-modal');
    if (!modal) return;
    const confirmBtn = document.getElementById('repeat-delete-confirm');
    const cancelBtn = document.getElementById('repeat-delete-cancel');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        if (!state.repeatDeleteTarget) { closeRepeatDeleteModal(); return; }
        const { id, key } = state.repeatDeleteTarget;
        const radios = modal.querySelectorAll('input[name="repeat-delete-scope"]');
        let scope = 'single';
        radios.forEach(r => { if (r.checked) scope = r.value; });
        deleteTodoConfirm(id, key, scope);
        closeRepeatDeleteModal();
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        closeRepeatDeleteModal();
      });
    }
  })();

  document.getElementById('memo-item-add-zone').addEventListener('click', () => {
    if (state.activeMemoTabId) addMemoItem(state.activeMemoTabId);
  });

  const memoAddTopBtn = document.getElementById('memo-add-top-btn');
  if (memoAddTopBtn) memoAddTopBtn.addEventListener('click', () => {
    const tabId = state.activeMemoTabId || getPersonalTabId();
    if (tabId) {
      if (!state.activeMemoTabId) {
        state.viewAllMemos = false;
        state.activeMemoTabId = tabId;
        showMemoContent();
      }
      addMemoItem(tabId);
    }
  });

  document.querySelectorAll('.quote-line').forEach(el => {
    el.addEventListener('blur', saveQuote);
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      const html = e.clipboardData.getData('text/html');
      const text = e.clipboardData.getData('text/plain');
      if (html) {
        document.execCommand('insertHTML', false, html);
      } else {
        document.execCommand('insertText', false, text);
      }
      saveQuote();
    });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCalendarMemo);
  } else {
    initCalendarMemo();
  }

  document.getElementById('cal-year-prev').addEventListener('click', () => {
    state.currentYear--;
    renderCalendar();
  });
  document.getElementById('cal-prev').addEventListener('click', () => {
    state.currentMonth--;
    if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    state.currentMonth++;
    if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
    renderCalendar();
  });
  document.getElementById('cal-year-next').addEventListener('click', () => {
    state.currentYear++;
    renderCalendar();
  });
  document.getElementById('cal-today').addEventListener('click', () => {
    const today = new Date();
    state.currentYear = today.getFullYear();
    state.currentMonth = today.getMonth();
    renderCalendar();
    setSelectedDate(today);
  });

  document.getElementById('calendar-grid').addEventListener('click', e => {
    const cell = e.target.closest('.cal-day');
    if (!cell || !cell.dataset.date) return;
    const [y, m, d] = cell.dataset.date.split('-').map(Number);
    setSelectedDate(new Date(y, m - 1, d));
    setViewMode('todo');
  });

  function openSpecialDatesModal() {
    const modal = document.getElementById('special-dates-modal');
    if (!modal) return;
    var categoryEl = document.getElementById('special-date-category');
    if (categoryEl) {
      categoryEl.innerHTML = '';
      if (state.memoTabs && state.memoTabs.length) {
        state.memoTabs.forEach(function (tab) {
          if (isDeletedTabId(tab.id)) return;
          if (!isMemoTabInActivePeriod(tab)) return;
          var opt = document.createElement('option');
          opt.value = tab.id;
          opt.textContent = tab.name || '(이름 없음)';
          categoryEl.appendChild(opt);
        });
        var firstAct = state.memoTabs.find(function (t) { return isMemoTabInActivePeriod(t); });
        categoryEl.value = getPersonalTabId() || (firstAct ? firstAct.id : '');
      } else {
        var defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '(분류 없음)';
        categoryEl.appendChild(defaultOpt);
        categoryEl.value = '';
      }
    }
    var repeatEl = document.getElementById('special-date-repeat');
    var rangeGroup = document.getElementById('special-dates-range-group');
    if (rangeGroup) {
      if (repeatEl && repeatEl.value === 'range') { rangeGroup.removeAttribute('hidden'); rangeGroup.style.display = ''; }
      else { rangeGroup.setAttribute('hidden', ''); rangeGroup.style.display = 'none'; }
    }
    var dateInput = document.getElementById('special-date-input');
    var dateDisplay = document.getElementById('special-date-selected-display');
    if (dateInput && (!dateInput.value || !String(dateInput.value).trim()) && state.selectedDate) {
      dateInput.value = dateKey(state.selectedDate);
    }
    if (dateDisplay) dateDisplay.textContent = (dateInput && dateInput.value) ? dateInput.value : '';
    renderSpecialDatesList();
    modal.classList.add('show');
    var content = document.getElementById('special-dates-modal-content');
    if (content) {
      content.style.setProperty('width', '380px', 'important');
      content.style.setProperty('max-width', '90vw', 'important');
    }
  }
  function closeSpecialDatesModal() {
    const modal = document.getElementById('special-dates-modal');
    if (modal) modal.classList.remove('show');
  }
  var REPEAT_ORDER = { none: 0, daily: 1, weekly: 2, monthly: 3, yearly: 4, range: 5 };
  function formatRangeDays(rd) {
    if (!rd || (!rd.mon && !rd.tue && !rd.wed && !rd.thu && !rd.fri && !rd.sat && !rd.sun && !rd.holiday)) return '전체';
    var labels = [];
    if (rd.mon) labels.push('월');
    if (rd.tue) labels.push('화');
    if (rd.wed) labels.push('수');
    if (rd.thu) labels.push('목');
    if (rd.fri) labels.push('금');
    if (rd.sat) labels.push('토');
    if (rd.sun) labels.push('일');
    if (rd.holiday) labels.push('공휴일');
    return labels.join('·');
  }
  function renderSpecialDatesList() {
    const listEl = document.getElementById('special-dates-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    var list = (state.specialDates || []).slice();
    list.sort(function (a, b) {
      var ra = (a.repeat && a.repeat !== 'none') ? a.repeat : 'none';
      var rb = (b.repeat && b.repeat !== 'none') ? b.repeat : 'none';
      return ((REPEAT_ORDER[ra] ?? 9) - (REPEAT_ORDER[rb] ?? 9));
    });
    list.forEach(function (s) {
      var tabForRow = state.memoTabs && s.memoTabId ? state.memoTabs.find(function (t) { return t.id === s.memoTabId; }) : null;
      if (s.memoTabId && (!tabForRow || !isMemoTabInActivePeriod(tabForRow))) return;
      const li = document.createElement('li');
      li.className = 'special-dates-item';
      var tab = tabForRow;
      var categoryName = (tab && tab.name) ? tab.name : '(분류 없음)';
      var repeatType = (s.repeat && s.repeat !== 'none') ? s.repeat : 'none';
      var repeatDisplay = { none: '없음', daily: '매일', weekly: '매주', monthly: '매월', monthly_last: '매월 말일', yearly: '매년', range: '기간' };
      var repeatLabel = (repeatDisplay[repeatType] || repeatType);
      var sid = (s.id || '').replace(/"/g, '&quot;');
      var repeatText = '<span class="special-dates-item-repeat" data-id="' + sid + '" data-repeat="' + repeatType + '" title="클릭하여 반복주기 수정">' + (repeatLabel.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</span>';
      var lunarBadge = s.isLunar ? ' <span class="special-dates-item-lunar">음력</span>' : '';
      var row1 = '<span class="special-dates-item-category" data-id="' + sid + '" title="클릭하여 분류 수정">' + (categoryName || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span> <span class="special-dates-item-label" data-id="' + sid + '" title="클릭하여 수정">' + (s.label || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span> <span class="special-dates-item-date" data-id="' + sid + '" title="클릭하여 등록일 수정">' + (s.dateKey || '') + '</span> ';
      if (repeatType === 'range') {
        li.classList.add('special-dates-item--range');
        var rangeDatesText = (s.rangeStart || '') + ' ~ ' + (s.rangeEnd || '');
        var rangeDaysLabel = formatRangeDays(s.rangeDays);
        var titleRow = row1 + repeatText + lunarBadge + '<button type="button" class="btn-icon special-dates-item-del" data-id="' + (s.id || '').replace(/"/g, '&quot;') + '" aria-label="삭제">×</button>';
        var rangeLine = '<span class="special-dates-item-range-days" data-id="' + (s.id || '').replace(/"/g, '&quot;') + '" title="클릭하여 반복요일 수정">[' + (rangeDaysLabel.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')) + ']</span> <span class="special-dates-item-range-dates" data-id="' + (s.id || '').replace(/"/g, '&quot;') + '" title="클릭하여 반복날짜 수정">' + (rangeDatesText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</span>';
        li.innerHTML = '<div class="special-dates-item-title-row">' + titleRow + '</div><div class="special-dates-item-range-line">' + rangeLine + '</div>';
      } else {
        li.innerHTML = row1 + repeatText + lunarBadge + '<button type="button" class="btn-icon special-dates-item-del" data-id="' + sid + '" aria-label="삭제">×</button>';
      }
      listEl.appendChild(li);
    });
  }
  document.getElementById('cal-special-dates-btn').addEventListener('click', openSpecialDatesModal);
  var calTypeToggle = document.getElementById('cal-type-toggle');
  if (calTypeToggle) calTypeToggle.addEventListener('click', toggleCalendarType);
  var calFullTypeToggle = document.getElementById('cal-full-type-toggle');
  if (calFullTypeToggle) calFullTypeToggle.addEventListener('click', toggleCalendarType);
  document.getElementById('special-dates-close').addEventListener('click', closeSpecialDatesModal);

  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.classList || !e.target.classList.contains('modal') || !e.target.classList.contains('show')) return;
    var id = e.target.id;
    if (id === 'todo-modal') closeTodoModal();
    else if (id === 'todo-repeat-modal') closeRepeatOnlyModal();
    else if (id === 'special-dates-modal') closeSpecialDatesModal();
    else if (id === 'memo-reorder-modal') {
      e.target.classList.remove('show');
      state.fromReorderModal = false;
      renderMemoTabs();
      showMemoContent();
      renderCategoryManageList();
    } else if (id === 'memo-color-modal') closeMemoColorModal();
    else if (id === 'memo-tab-modal') { closeMemoTabModal(); state.fromReorderModal = false; }
    else if (id === 'repeat-delete-modal') closeRepeatDeleteModal();
    else e.target.classList.remove('show');
  });

  function updateSpecialDatesRangeVisibility() {
    var repeatEl = document.getElementById('special-date-repeat');
    var rangeGroup = document.getElementById('special-dates-range-group');
    if (!rangeGroup || !repeatEl) return;
    if (repeatEl.value === 'range') {
      rangeGroup.removeAttribute('hidden');
      rangeGroup.style.display = 'block';
    } else {
      rangeGroup.setAttribute('hidden', '');
      rangeGroup.style.display = 'none';
    }
  }
  var specialDateRepeatEl = document.getElementById('special-date-repeat');
  if (specialDateRepeatEl) {
    specialDateRepeatEl.addEventListener('change', updateSpecialDatesRangeVisibility);
    specialDateRepeatEl.addEventListener('input', updateSpecialDatesRangeVisibility);
  }
  var specialDateInput = document.getElementById('special-date-input');
  var specialDateDisplay = document.getElementById('special-date-selected-display');
  if (specialDateInput && specialDateDisplay) {
    specialDateInput.addEventListener('change', function () { specialDateDisplay.textContent = this.value || ''; });
    specialDateInput.addEventListener('input', function () { specialDateDisplay.textContent = this.value || ''; });
  }
  var specialDateAddBtn = document.getElementById('special-date-add-btn');
  if (specialDateAddBtn) {
    specialDateAddBtn.addEventListener('click', function () {
      const dateInput = document.getElementById('special-date-input');
      const labelInput = document.getElementById('special-date-label');
      const categoryEl = document.getElementById('special-date-category');
      const repeatEl = document.getElementById('special-date-repeat');
      const rangeStartEl = document.getElementById('special-date-range-start');
      const rangeEndEl = document.getElementById('special-date-range-end');
      const dateVal = dateInput && dateInput.value ? dateInput.value.trim() : (state.selectedDate ? dateKey(state.selectedDate) : '');
      const labelVal = labelInput && labelInput.value ? labelInput.value.trim() : '';
      var firstActiveCat = (state.memoTabs || []).find(function (t) { return isMemoTabInActivePeriod(t); });
      const memoTabId = (categoryEl && categoryEl.value) ? categoryEl.value : (getPersonalTabId() || (firstActiveCat ? firstActiveCat.id : ''));
      const tabForAdd = getMemoTabById(memoTabId);
      if (!tabForAdd || !isMemoTabInActivePeriod(tabForAdd)) {
        alert('사용 기간이 아닌 분류에는 이름날을 등록할 수 없습니다.');
        return;
      }
      const repeatVal = (repeatEl && repeatEl.value) ? repeatEl.value : 'none';
      let rangeStartVal = (repeatVal === 'range' && rangeStartEl && rangeStartEl.value) ? rangeStartEl.value.trim() : '';
      let rangeEndVal = (repeatVal === 'range' && rangeEndEl && rangeEndEl.value) ? rangeEndEl.value.trim() : '';
      if (!labelVal) { alert('명칭을 입력해 주세요.'); if (labelInput) labelInput.focus(); return; }
      if (!dateVal || !/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) { alert('시작일을 선택해 주세요.'); if (dateInput) dateInput.focus(); return; }
      if (repeatVal === 'range') {
        if (!rangeStartVal) rangeStartVal = dateVal;
        if (!rangeEndVal) rangeEndVal = dateVal;
      }
      var rangeDaysVal = undefined;
      if (repeatVal === 'range') {
        rangeDaysVal = {
          mon: !!(document.getElementById('special-date-range-mon') && document.getElementById('special-date-range-mon').checked),
          tue: !!(document.getElementById('special-date-range-tue') && document.getElementById('special-date-range-tue').checked),
          wed: !!(document.getElementById('special-date-range-wed') && document.getElementById('special-date-range-wed').checked),
          thu: !!(document.getElementById('special-date-range-thu') && document.getElementById('special-date-range-thu').checked),
          fri: !!(document.getElementById('special-date-range-fri') && document.getElementById('special-date-range-fri').checked),
          sat: !!(document.getElementById('special-date-range-sat') && document.getElementById('special-date-range-sat').checked),
          sun: !!(document.getElementById('special-date-range-sun') && document.getElementById('special-date-range-sun').checked),
          holiday: !!(document.getElementById('special-date-range-holiday') && document.getElementById('special-date-range-holiday').checked)
        };
      }
      const id = 'sd_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      state.specialDates = state.specialDates || [];
      var isLunar = false;
      pushUndoSnapshot();
      state.specialDates.push({ id: id, dateKey: dateVal, label: labelVal, memoTabId: memoTabId || undefined, repeat: repeatVal, rangeStart: rangeStartVal, rangeEnd: rangeEndVal, rangeDays: rangeDaysVal, isLunar: isLunar });
      saveSpecialDates();
      renderCalendar();
      if (state.viewMode === 'calendarFull') renderCalendarFull();
      renderSpecialDatesList();
      labelInput.value = '';
      var dateDisplay = document.getElementById('special-date-selected-display');
      if (dateDisplay) dateDisplay.textContent = dateVal || '';
      if (rangeStartEl) rangeStartEl.value = '';
      if (rangeEndEl) rangeEndEl.value = '';
    });
  }
  function closeSpecialDatesRangePopover() {
    var pop = document.getElementById('special-dates-range-edit-popover');
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
    document.removeEventListener('click', specialDatesRangePopoverOutside);
  }
  function specialDatesRangePopoverOutside(e) {
    var pop = document.getElementById('special-dates-range-edit-popover');
    if (pop && !pop.contains(e.target) && !e.target.closest('.special-dates-item-range-days') && !e.target.closest('.special-dates-item-range-dates')) {
      closeSpecialDatesRangePopover();
    }
  }
  function openRangeDaysEditor(specialId, anchor) {
    closeSpecialDatesRangePopover();
    var item = (state.specialDates || []).find(function (s) { return s.id === specialId; });
    if (!item || item.repeat !== 'range') return;
    var rd = item.rangeDays || { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true, holiday: true };
    var days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'holiday'];
    var dayLabels = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일', holiday: '공휴일' };
    var wrap = document.createElement('div');
    wrap.id = 'special-dates-range-edit-popover';
    wrap.className = 'special-dates-range-edit-popover';
    var html = '<div class="special-dates-range-edit-popover-inner"><div class="range-days-wrap" style="margin:0">';
    days.forEach(function (d) {
      var checked = rd[d] !== false ? ' checked' : '';
      var id = 'special-dates-range-edit-' + d;
      html += '<label class="range-day-cb"><input type="checkbox" id="' + id + '"' + checked + '> ' + dayLabels[d] + '</label>';
    });
    html += '</div><button type="button" class="btn-primary btn-small special-dates-range-edit-apply">적용</button></div>';
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    var rect = anchor.getBoundingClientRect();
    var popWidth = wrap.offsetWidth || 200;
    wrap.style.left = Math.min(rect.left, window.innerWidth - popWidth - 8) + 'px';
    wrap.style.top = (rect.bottom + 4) + 'px';
    wrap.querySelector('.special-dates-range-edit-apply').addEventListener('click', function (ev) {
      ev.stopPropagation();
      var newRd = {};
      days.forEach(function (d) {
        var el = document.getElementById('special-dates-range-edit-' + d);
        newRd[d] = !!(el && el.checked);
      });
      pushUndoSnapshot();
      item.rangeDays = newRd;
      saveSpecialDates();
      renderCalendar();
      if (state.viewMode === 'calendarFull') renderCalendarFull();
      renderSpecialDatesList();
      closeSpecialDatesRangePopover();
    });
    setTimeout(function () { document.addEventListener('click', specialDatesRangePopoverOutside); }, 0);
  }
  function openRangeDatesEditor(specialId, anchor) {
    closeSpecialDatesRangePopover();
    var item = (state.specialDates || []).find(function (s) { return s.id === specialId; });
    if (!item || item.repeat !== 'range') return;
    var wrap = document.createElement('div');
    wrap.id = 'special-dates-range-edit-popover';
    wrap.className = 'special-dates-range-edit-popover';
    var startVal = item.rangeStart || '';
    var endVal = item.rangeEnd || '';
    wrap.innerHTML = '<div class="special-dates-range-edit-popover-inner"><div class="range-period-row" style="margin:0"><label>반복 기간</label><span class="range-period-inputs"><input type="date" id="special-dates-range-edit-start" value="' + (startVal.replace(/"/g, '&quot;')) + '"><span class="range-period-sep"> ~ </span><input type="date" id="special-dates-range-edit-end" value="' + (endVal.replace(/"/g, '&quot;')) + '"></span></div><button type="button" class="btn-primary btn-small special-dates-range-edit-apply">적용</button></div>';
    document.body.appendChild(wrap);
    var rect = anchor.getBoundingClientRect();
    var popWidth = wrap.offsetWidth || 260;
    wrap.style.left = Math.min(rect.left, window.innerWidth - popWidth - 8) + 'px';
    wrap.style.top = (rect.bottom + 4) + 'px';
    wrap.querySelector('.special-dates-range-edit-apply').addEventListener('click', function (ev) {
      ev.stopPropagation();
      var startEl = document.getElementById('special-dates-range-edit-start');
      var endEl = document.getElementById('special-dates-range-edit-end');
      var newStart = (startEl && startEl.value) ? startEl.value.trim() : '';
      var newEnd = (endEl && endEl.value) ? endEl.value.trim() : '';
      pushUndoSnapshot();
      item.rangeStart = newStart;
      item.rangeEnd = newEnd;
      saveSpecialDates();
      renderCalendar();
      if (state.viewMode === 'calendarFull') renderCalendarFull();
      renderSpecialDatesList();
      closeSpecialDatesRangePopover();
    });
    setTimeout(function () { document.addEventListener('click', specialDatesRangePopoverOutside); }, 0);
  }
  function openSpecialDateFieldEditor(specialId, anchor, type) {
    closeSpecialDatesRangePopover();
    var item = (state.specialDates || []).find(function (s) { return s.id === specialId; });
    if (!item) return;
    var wrap = document.createElement('div');
    wrap.id = 'special-dates-range-edit-popover';
    wrap.className = 'special-dates-range-edit-popover';
    if (type === 'date') {
      var val = (item.dateKey || '').replace(/\./g, '-');
      wrap.innerHTML = '<div class="special-dates-range-edit-popover-inner"><div class="range-period-row" style="margin:0"><label>등록일</label><input type="date" id="special-dates-edit-date" value="' + (val.replace(/"/g, '&quot;')) + '"></div><button type="button" class="btn-primary btn-small special-dates-range-edit-apply">적용</button></div>';
      document.body.appendChild(wrap);
      var rect = anchor.getBoundingClientRect();
      wrap.style.left = Math.min(rect.left, window.innerWidth - (wrap.offsetWidth || 200) - 8) + 'px';
      wrap.style.top = (rect.bottom + 4) + 'px';
      wrap.querySelector('.special-dates-range-edit-apply').addEventListener('click', function (ev) {
        ev.stopPropagation();
        var el = document.getElementById('special-dates-edit-date');
        var newVal = (el && el.value) ? el.value.trim() : '';
        if (newVal && /^\d{4}-\d{2}-\d{2}$/.test(newVal)) {
          pushUndoSnapshot();
          item.dateKey = newVal;
          if (item.repeat === 'range' && (!item.rangeStart || item.rangeStart < newVal)) item.rangeStart = item.rangeStart || newVal;
          if (item.repeat === 'range' && (!item.rangeEnd || item.rangeEnd > newVal)) item.rangeEnd = item.rangeEnd || newVal;
          saveSpecialDates();
          renderCalendar();
          if (state.viewMode === 'calendarFull') renderCalendarFull();
          renderSpecialDatesList();
        }
        closeSpecialDatesRangePopover();
      });
    } else if (type === 'category') {
      var tabs = (state.memoTabs || []).filter(function (t) { return !isDeletedTabId(t.id) && isMemoTabInActivePeriod(t); });
      var currentId = item.memoTabId || getPersonalTabId() || (tabs[0] && tabs[0].id) || '';
      var opts = tabs.map(function (t) {
        var sel = t.id === currentId ? ' selected' : '';
        return '<option value="' + (t.id || '').replace(/"/g, '&quot;') + '"' + sel + '>' + (t.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</option>';
      }).join('');
      wrap.innerHTML = '<div class="special-dates-range-edit-popover-inner"><div class="range-period-row" style="margin:0"><label>분류</label><select id="special-dates-edit-category">' + opts + '</select></div><button type="button" class="btn-primary btn-small special-dates-range-edit-apply">적용</button></div>';
      document.body.appendChild(wrap);
      var rect = anchor.getBoundingClientRect();
      wrap.style.left = Math.min(rect.left, window.innerWidth - (wrap.offsetWidth || 180) - 8) + 'px';
      wrap.style.top = (rect.bottom + 4) + 'px';
      wrap.querySelector('.special-dates-range-edit-apply').addEventListener('click', function (ev) {
        ev.stopPropagation();
        var el = document.getElementById('special-dates-edit-category');
        pushUndoSnapshot();
        if (el) item.memoTabId = el.value || undefined;
        saveSpecialDates();
        renderCalendar();
        if (state.viewMode === 'calendarFull') renderCalendarFull();
        renderSpecialDatesList();
        closeSpecialDatesRangePopover();
      });
    } else if (type === 'repeat') {
      var repeatOptions = [
        { value: 'none', label: '반복 없음' },
        { value: 'daily', label: '매일' },
        { value: 'weekly', label: '매주' },
        { value: 'monthly', label: '매월' },
        { value: 'monthly_last', label: '매월 말일' },
        { value: 'yearly', label: '매년' },
        { value: 'range', label: '기간' }
      ];
      var currentRepeat = (item.repeat && item.repeat !== 'none') ? item.repeat : 'none';
      var opts = repeatOptions.map(function (r) {
        var sel = r.value === currentRepeat ? ' selected' : '';
        return '<option value="' + r.value + '"' + sel + '>' + r.label + '</option>';
      }).join('');
      wrap.innerHTML = '<div class="special-dates-range-edit-popover-inner"><div class="range-period-row" style="margin:0"><label>반복주기</label><select id="special-dates-edit-repeat">' + opts + '</select></div><button type="button" class="btn-primary btn-small special-dates-range-edit-apply">적용</button></div>';
      document.body.appendChild(wrap);
      var rect = anchor.getBoundingClientRect();
      wrap.style.left = Math.min(rect.left, window.innerWidth - (wrap.offsetWidth || 160) - 8) + 'px';
      wrap.style.top = (rect.bottom + 4) + 'px';
      wrap.querySelector('.special-dates-range-edit-apply').addEventListener('click', function (ev) {
        ev.stopPropagation();
        var el = document.getElementById('special-dates-edit-repeat');
        var newRepeat = (el && el.value) ? el.value : 'none';
        if (newRepeat === 'none') newRepeat = 'none';
        pushUndoSnapshot();
        item.repeat = newRepeat;
        if (newRepeat === 'range') {
          if (!item.rangeStart) item.rangeStart = item.dateKey || '';
          if (!item.rangeEnd) item.rangeEnd = item.dateKey || '';
          if (!item.rangeDays) item.rangeDays = { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true, holiday: true };
        } else {
          item.rangeStart = '';
          item.rangeEnd = '';
          item.rangeDays = undefined;
        }
        saveSpecialDates();
        renderCalendar();
        if (state.viewMode === 'calendarFull') renderCalendarFull();
        renderSpecialDatesList();
        closeSpecialDatesRangePopover();
      });
    }
    setTimeout(function () { document.addEventListener('click', specialDatesRangePopoverOutside); }, 0);
  }
  document.getElementById('special-dates-list').addEventListener('click', function (e) {
    const btn = e.target.closest('.special-dates-item-del');
    if (btn && btn.dataset.id) {
      pushUndoSnapshot();
      state.specialDates = (state.specialDates || []).filter(function (s) { return s.id !== btn.dataset.id; });
      saveSpecialDates();
      renderCalendar();
      if (state.viewMode === 'calendarFull') renderCalendarFull();
      renderSpecialDatesList();
      return;
    }
    const rangeDaysEl = e.target.closest('.special-dates-item-range-days');
    if (rangeDaysEl && rangeDaysEl.dataset.id) {
      e.preventDefault();
      e.stopPropagation();
      openRangeDaysEditor(rangeDaysEl.dataset.id, rangeDaysEl);
      return;
    }
    const rangeDatesEl = e.target.closest('.special-dates-item-range-dates');
    if (rangeDatesEl && rangeDatesEl.dataset.id) {
      e.preventDefault();
      e.stopPropagation();
      openRangeDatesEditor(rangeDatesEl.dataset.id, rangeDatesEl);
      return;
    }
    const categoryEl = e.target.closest('.special-dates-item-category');
    if (categoryEl && categoryEl.dataset.id) {
      e.preventDefault();
      e.stopPropagation();
      openSpecialDateFieldEditor(categoryEl.dataset.id, categoryEl, 'category');
      return;
    }
    const dateEl = e.target.closest('.special-dates-item-date');
    if (dateEl && dateEl.dataset.id) {
      e.preventDefault();
      e.stopPropagation();
      openSpecialDateFieldEditor(dateEl.dataset.id, dateEl, 'date');
      return;
    }
    const repeatEl = e.target.closest('.special-dates-item-repeat');
    if (repeatEl && repeatEl.dataset.id) {
      e.preventDefault();
      e.stopPropagation();
      openSpecialDateFieldEditor(repeatEl.dataset.id, repeatEl, 'repeat');
      return;
    }
    const labelEl = e.target.closest('.special-dates-item-label');
    if (!labelEl || !labelEl.dataset.id || labelEl.querySelector('input.special-dates-item-label-input')) return;
    var id = labelEl.dataset.id;
    var currentText = (labelEl.textContent || '').trim();
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'special-dates-item-label-input';
    input.value = currentText;
    input.maxLength = 20;
    input.dataset.id = id;
    labelEl.textContent = '';
    labelEl.appendChild(input);
    input.focus();
    input.select();
    function finishEdit() {
      var newVal = (input.value || '').trim();
      var item = (state.specialDates || []).find(function (s) { return s.id === id; });
      if (item) {
        if (String(item.label || '').trim() !== newVal) pushUndoSnapshot();
        item.label = newVal || '';
        saveSpecialDates();
        renderCalendar();
        if (state.viewMode === 'calendarFull') renderCalendarFull();
      }
      labelEl.removeChild(input);
      labelEl.textContent = newVal || '';
      labelEl.title = '클릭하여 수정';
    }
    input.addEventListener('blur', function () { finishEdit(); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        labelEl.removeChild(input);
        labelEl.textContent = currentText;
        labelEl.title = '클릭하여 수정';
      }
    });
  });

  const todoListWrap = document.getElementById('todo-list-wrap');
  if (todoListWrap) {
    todoListWrap.addEventListener('dragover', e => {
      if (state.draggedMemoPayload) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        updateMemoToTodoDropTarget(e);
      }
    });
  }
  const calendarFullWrap = document.getElementById('calendar-full-wrap');
  const viewToggleCal = document.getElementById('view-toggle-cal');
  const viewToggleTodo = document.getElementById('view-toggle-todo');
  const calendarFullHeaderInline = document.getElementById('calendar-full-header-inline');
  const todoViewHeaderInline = document.getElementById('todo-view-header-inline');
  const todoViewCaptionEl = document.getElementById('todo-view-caption');

  function updateTodoViewCaption() {
    if (!calendarFullHeaderInline || !todoViewCaptionEl) return;
    if (state.viewMode === 'calendarFull') {
      calendarFullHeaderInline.style.display = 'flex';
      if (todoViewHeaderInline) todoViewHeaderInline.style.display = 'none';
      const y = state.calendarFullYear, m = state.calendarFullMonth;
      const monthYearEl = document.getElementById('cal-full-month-year');
      if (monthYearEl) monthYearEl.textContent = y + '년 ' + (m + 1) + '월';
    } else {
      calendarFullHeaderInline.style.display = 'none';
      if (todoViewHeaderInline) todoViewHeaderInline.style.display = 'flex';
      if (state.selectedDate) {
        const d = state.selectedDate;
        const key = dateKey(d);
        const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
        const wd = weekdays[d.getDay()];
        const holidayName = getHolidayName(key);
        const specialLabels = getSpecialDateLabels(key);
        const dateStr = d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + wd + ')';
        var firstLine = '<span class="caption-date">' + dateStr + '</span>';
        if (holidayName) {
          firstLine += '   <span class="caption-holiday">【 ' + (holidayName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')) + ' 】</span>    ';
          todoViewCaptionEl.classList.remove('caption-no-holiday');
        } else {
          todoViewCaptionEl.classList.add('caption-no-holiday');
        }
        if (specialLabels.length > 0) {
          firstLine += (holidayName ? '' : '     ') + '<span class="caption-special-dates">' + specialLabels.map(function (l) {
            return '<span class="caption-special-date-name">' + (l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')) + '</span>';
          }).join(' / ') + '</span>';
        }
        todoViewCaptionEl.innerHTML = '<div class="caption-first-line">' + firstLine + '</div>';
        todoViewCaptionEl.classList.remove('caption-sat', 'caption-sun-holiday', 'has-caption-repeat');
        if (holidayName) {
          todoViewCaptionEl.classList.add('caption-sun-holiday');
        } else if (d.getDay() === 6) {
          todoViewCaptionEl.classList.add('caption-sat');
        } else if (d.getDay() === 0) {
          todoViewCaptionEl.classList.add('caption-sun-holiday');
        }
      } else {
        todoViewCaptionEl.textContent = '';
        todoViewCaptionEl.classList.remove('caption-sat', 'caption-sun-holiday');
      }
    }
  }

  function setViewMode(mode) {
    state.viewMode = mode;
    if (mode === 'calendarFull') {
      state.calendarFullYear = state.currentYear;
      state.calendarFullMonth = state.currentMonth;
      if (todoListWrap) todoListWrap.style.display = 'none';
      if (calendarFullWrap) { calendarFullWrap.style.display = ''; renderCalendarFull(); }
      if (viewToggleCal) viewToggleCal.classList.add('active');
      if (viewToggleTodo) viewToggleTodo.classList.remove('active');
    } else {
      if (state.todoViewCenterDate == null) state.todoViewCenterDate = new Date();
      if (todoListWrap) todoListWrap.style.display = '';
      if (calendarFullWrap) calendarFullWrap.style.display = 'none';
      if (viewToggleCal) viewToggleCal.classList.remove('active');
      if (viewToggleTodo) viewToggleTodo.classList.add('active');
      renderTodos();
    }
    updateTodoViewCaption();
  }

  if (viewToggleCal) {
    viewToggleCal.addEventListener('click', () => { setViewMode('calendarFull'); });
  }
  if (viewToggleTodo) {
    viewToggleTodo.addEventListener('click', () => { setViewMode('todo'); });
  }
  const todoThreeColPrev = document.getElementById('todo-three-col-prev');
  const todoThreeColNext = document.getElementById('todo-three-col-next');
  if (todoThreeColPrev) {
    todoThreeColPrev.addEventListener('click', () => {
      if (state.viewMode !== 'todo') return;
      const d = state.todoViewCenterDate || new Date();
      state.todoViewCenterDate = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
      state.selectedDate = state.todoViewCenterDate;
      renderTodos();
      updateTodoViewCaption();
      renderCalendar();
    });
  }
  if (todoThreeColNext) {
    todoThreeColNext.addEventListener('click', () => {
      if (state.viewMode !== 'todo') return;
      const d = state.todoViewCenterDate || new Date();
      state.todoViewCenterDate = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      state.selectedDate = state.todoViewCenterDate;
      renderTodos();
      updateTodoViewCaption();
      renderCalendar();
    });
  }
  const todoThreeColToday = document.getElementById('todo-three-col-today');
  if (todoThreeColToday) {
    todoThreeColToday.addEventListener('click', () => {
      if (state.viewMode !== 'todo') return;
      state.todoViewCenterDate = new Date();
      state.selectedDate = state.todoViewCenterDate;
      renderTodos();
      updateTodoViewCaption();
      renderCalendar();
    });
  }
  /* 주제(구간 헤더) 리스너는 Firebase await 이전에 붙여야 초기 로딩 직후 입력도 저장됨 */
  bindTodoSectionHeaderNoteListenersOnce();
  bindTodoItemTitleDescLiveSyncOnce();
  setViewMode(state.viewMode);

  todoListWrap.addEventListener('click', e => {
    const btn = e.target.closest('.section-add-btn');
    if (!btn) return;
    e.preventDefault();
    const dayCol = btn.closest('.todo-day-col');
    if (dayCol && dayCol.dataset.date) {
      const [y, m, d] = dayCol.dataset.date.split('-').map(Number);
      state.selectedDate = new Date(y, m - 1, d);
    }
    if (!state.selectedDate) {
      alert('달력에서 날짜를 먼저 선택하세요.');
      return;
    }
    addTodoInline(btn.dataset.section);
  });

  document.getElementById('cal-full-year-prev').addEventListener('click', () => {
    state.calendarFullYear--;
    renderCalendarFull();
  });
  document.getElementById('cal-full-prev').addEventListener('click', () => {
    state.calendarFullMonth--;
    if (state.calendarFullMonth < 0) { state.calendarFullMonth = 11; state.calendarFullYear--; }
    renderCalendarFull();
  });
  document.getElementById('cal-full-next').addEventListener('click', () => {
    state.calendarFullMonth++;
    if (state.calendarFullMonth > 11) { state.calendarFullMonth = 0; state.calendarFullYear++; }
    renderCalendarFull();
  });
  document.getElementById('cal-full-year-next').addEventListener('click', () => {
    state.calendarFullYear++;
    renderCalendarFull();
  });
  document.getElementById('cal-full-today').addEventListener('click', () => {
    const today = new Date();
    state.calendarFullYear = today.getFullYear();
    state.calendarFullMonth = today.getMonth();
    renderCalendarFull();
  });

  const CAL_FULL_TITLE_CLICK_DELAY_MS = 280;
  var calFullTitleSingleClickTimer = null;
  const calendarFullGrid = document.getElementById('calendar-full-grid');
  if (calendarFullGrid) {
    calendarFullGrid.addEventListener('dblclick', function (e) {
      var titleSpan = e.target.closest('.cal-full-todo-title');
      if (!titleSpan || titleSpan.querySelector('input')) return;
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(calFullTitleSingleClickTimer);
      calFullTitleSingleClickTimer = null;
      var li = titleSpan.closest('.cal-full-day-todo');
      if (!li || !li.dataset.id) return;
      var dk = li.dataset.dateKey;
      if (!dk || String(dk).length < 10) return;
      state.selectedDate = new Date(parseInt(dk.slice(0, 4), 10), parseInt(dk.slice(5, 7), 10) - 1, parseInt(dk.slice(8, 10), 10));
      openTodoModal(li.dataset.id);
    });
    calendarFullGrid.addEventListener('click', (e) => {
      const addBtn = e.target.closest('.cal-full-add');
      if (addBtn) {
        e.preventDefault();
        const dkey = addBtn.dataset.date;
        if (dkey) {
          state.selectedDate = new Date(parseInt(dkey.slice(0, 4), 10), parseInt(dkey.slice(5, 7), 10) - 1, parseInt(dkey.slice(8, 10), 10));
          addTodoAtBottomOfCalendarDay(dkey);
        }
        return;
      }
      const delBtn = e.target.closest('.cal-full-todo-del');
      if (delBtn) {
        e.preventDefault();
        e.stopPropagation();
        const dkey = delBtn.dataset.date;
        if (dkey) state.selectedDate = new Date(parseInt(dkey.slice(0, 4), 10), parseInt(dkey.slice(5, 7), 10) - 1, parseInt(dkey.slice(8, 10), 10));
        deleteTodo(delBtn.dataset.id);
        return;
      }
      const completeBtn = e.target.closest('.cal-full-todo-complete');
      if (completeBtn) {
        e.preventDefault();
        e.stopPropagation();
        const li = completeBtn.closest('.cal-full-day-todo');
        if (li) {
          const dkey = li.dataset.dateKey;
          if (dkey) state.selectedDate = new Date(parseInt(dkey.slice(0, 4), 10), parseInt(dkey.slice(5, 7), 10) - 1, parseInt(dkey.slice(8, 10), 10));
          setTodoCompleted(li.dataset.id, li.dataset.completed !== '1');
          renderCalendarFull();
        }
        return;
      }
      const importantBtn = e.target.closest('.cal-full-todo-important');
      if (importantBtn) {
        e.preventDefault();
        e.stopPropagation();
        const li = importantBtn.closest('.cal-full-day-todo');
        if (li) {
          const dkey = li.dataset.dateKey;
          if (dkey) state.selectedDate = new Date(parseInt(dkey.slice(0, 4), 10), parseInt(dkey.slice(5, 7), 10) - 1, parseInt(dkey.slice(8, 10), 10));
          const current = li.dataset.important === '0' ? false : li.dataset.important;
          setTodoImportant(li.dataset.id, nextImportant(current));
          renderCalendarFull();
        }
        return;
      }
      const repeatBtn = e.target.closest('.cal-full-todo-repeat');
      if (repeatBtn) {
        e.preventDefault();
        e.stopPropagation();
        const li = repeatBtn.closest('.cal-full-day-todo');
        if (li) {
          const dkey = li.dataset.dateKey;
          if (dkey) state.selectedDate = new Date(parseInt(dkey.slice(0, 4), 10), parseInt(dkey.slice(5, 7), 10) - 1, parseInt(dkey.slice(8, 10), 10));
          openRepeatOnlyModal(li.dataset.realId);
        }
        return;
      }
      const titleSpan = e.target.closest('.cal-full-todo-title');
      if (titleSpan && !titleSpan.querySelector('input')) {
        e.preventDefault();
        e.stopPropagation();
        const li = titleSpan.closest('.cal-full-day-todo');
        if (li) {
          const dkey = li.dataset.dateKey;
          if (dkey) state.selectedDate = new Date(parseInt(dkey.slice(0, 4), 10), parseInt(dkey.slice(5, 7), 10) - 1, parseInt(dkey.slice(8, 10), 10));
          const fullTitle = titleSpan.dataset.fullTitle || titleSpan.getAttribute('title') || '';
          clearTimeout(calFullTitleSingleClickTimer);
          calFullTitleSingleClickTimer = setTimeout(function () {
            calFullTitleSingleClickTimer = null;
            if (!titleSpan.isConnected || titleSpan.querySelector('input')) return;
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'cal-full-todo-title-input';
            input.value = fullTitle;
            input.dataset.id = li.dataset.id;
            titleSpan.replaceWith(input);
            input.focus();
            try {
              var len = (input.value || '').length;
              if (typeof input.setSelectionRange === 'function') input.setSelectionRange(len, len);
            } catch (_) {}
            input.addEventListener('blur', function () {
              const id = input.dataset.id;
              const val = input.value.trim();
              if (id && val !== fullTitle) {
                updateTodoFields(id, { title: val || '제목 없음' }, dkey);
                saveTodos();
                saveRepeating();
              }
              renderCalendarFull();
            });
            input.addEventListener('keydown', function (ev) {
              if (ev.key === 'Enter') {
                ev.preventDefault();
                input.blur();
              } else if (ev.key === 'Escape') {
                ev.preventDefault();
                renderCalendarFull();
              }
            });
            input.addEventListener('dblclick', function (ev) {
              ev.preventDefault();
              ev.stopPropagation();
              openTodoModalFromTitleInput(this);
            });
          }, CAL_FULL_TITLE_CLICK_DELAY_MS);
        }
        return;
      }
      const li = e.target.closest('.cal-full-day-todo:not(.cal-full-more)');
      if (li && !e.target.closest('.cal-full-todo-del') && !e.target.closest('.cal-full-todo-icons') && !e.target.closest('.cal-full-todo-title') && !e.target.closest('.cal-full-todo-title-input')) {
        const id = li.dataset.id;
        const dkey = li.dataset.dateKey;
        if (id && dkey) {
          state.selectedDate = new Date(parseInt(dkey.slice(0, 4), 10), parseInt(dkey.slice(5, 7), 10) - 1, parseInt(dkey.slice(8, 10), 10));
          openTodoModal(id);
        }
        return;
      }
      if (e.target.closest('.cal-full-day-todo')) return;
      /* 날짜 빈칸 클릭으로 할일 추가 — 제거(추가는 .cal-full-add 버튼만) */
    });
  }

  var todoItemTitleDescLiveBound = false;
  function bindTodoItemTitleDescLiveSyncOnce() {
    if (todoItemTitleDescLiveBound) return;
    todoItemTitleDescLiveBound = true;
    document.addEventListener('input', function (e) {
      if (!e.target || e.target.nodeName !== 'INPUT') return;
      if (!e.target.closest('#todo-three-col')) return;
      if (!e.target.classList ||
          (!e.target.classList.contains('todo-item-title-input') && !e.target.classList.contains('todo-item-desc-input'))) {
        return;
      }
      if (state.viewMode !== 'todo') return;
      var li = e.target.closest('.todo-item');
      if (!li || !li.dataset.dateKey || !li.dataset.id) return;
      var debKey = li.dataset.dateKey + '\x1e' + li.dataset.id;
      clearTimeout(todoFieldDebounceByKey[debKey]);
      var titleInp = li.querySelector('.todo-item-title-input');
      var descInp = li.querySelector('.todo-item-desc-input');
      todoFieldDebounceByKey[debKey] = setTimeout(function () {
        todoFieldDebounceByKey[debKey] = null;
        if (!li.isConnected) return;
        updateTodoFields(li.dataset.id, {
          title: (titleInp && titleInp.value || '').trim(),
          desc: (descInp && descInp.value || '').trim()
        }, li.dataset.dateKey, { skipListReRender: true });
        refreshTodoItemInputsFromState();
      }, 200);
    }, true);
  }

  var todoSectionNoteListenersBound = false;
  function bindTodoSectionHeaderNoteListenersOnce() {
    if (todoSectionNoteListenersBound) return;
    todoSectionNoteListenersBound = true;
    /** 날짜+구간별 디바운스(전역 타이머면 다른 칸 입력이 서로 취소되어 동기화가 깨짐) */
    var sectionNoteDebounceByKey = Object.create(null);
    function sectionNoteDebounceKey(dkey, section) {
      return String(dkey).slice(0, 10) + '\x1e' + String(section);
    }
    /* Firebase 동기화 전에도 주제 입력이 동작하도록 document 캡처 위임 (3열 내부만) */
    document.addEventListener('input', function (e) {
      if (!e.target || e.target.nodeName !== 'INPUT') return;
      if (!e.target.classList || !e.target.classList.contains('section-header-note')) return;
      if (!e.target.closest('#todo-three-col')) return;
      var col = e.target.closest('.todo-day-col');
      var secEl = e.target.closest('.todo-section');
      if (!col || !secEl) return;
      var dkey = normalizeTodoColDateKey(col);
      var section = secEl.dataset.section;
      if (!dkey || !section || section === 'completed') return;
      var inp = e.target;
      var dk = sectionNoteDebounceKey(dkey, section);
      clearTimeout(sectionNoteDebounceByKey[dk]);
      sectionNoteDebounceByKey[dk] = setTimeout(function () {
        sectionNoteDebounceByKey[dk] = null;
        if (!inp.isConnected) return;
        applySectionHeaderNoteSave(section, dkey, inp.value);
        refreshOtherSectionHeaderNoteInputs(inp);
      }, 200);
    }, true);
    document.addEventListener('focusout', function (e) {
      if (!e.target || e.target.nodeName !== 'INPUT') return;
      if (!e.target.classList || !e.target.classList.contains('section-header-note')) return;
      if (!e.target.closest('#todo-three-col')) return;
      var col = e.target.closest('.todo-day-col');
      var secEl = e.target.closest('.todo-section');
      if (!col || !secEl) return;
      var dkey = normalizeTodoColDateKey(col);
      var section = secEl.dataset.section;
      if (!dkey || !section || section === 'completed') return;
      var dk = sectionNoteDebounceKey(dkey, section);
      clearTimeout(sectionNoteDebounceByKey[dk]);
      sectionNoteDebounceByKey[dk] = null;
      var newVal = (e.target.value || '').trim();
      var oldEff = (getSectionHeaderNoteForDate(dkey, section) || '').trim();
      if (newVal === oldEff) return;
      applySectionHeaderNoteSave(section, dkey, e.target.value);
      renderTodos();
    }, true);
  }

  async function initFromFirebase() {
    await Promise.all([
      syncKeyFromFirebase(STORAGE_QUOTE),
      syncKeyFromFirebase(STORAGE_CALENDAR_MEMO),
      syncKeyFromFirebase(STORAGE_TODOS),
      syncKeyFromFirebase(STORAGE_TODOS_COMPLETED),
      syncKeyFromFirebase(STORAGE_REPEATING),
      syncKeyFromFirebase(STORAGE_REPEATING_DAY_OVERRIDES),
      syncKeyFromFirebase(STORAGE_MEMOS),
      syncKeyFromFirebase(STORAGE_MEMO_TABS),
      syncKeyFromFirebase(STORAGE_DELETED_MEMO_TABS),
      syncKeyFromFirebase(STORAGE_SPECIAL_DATES),
      syncKeyFromFirebase(STORAGE_CALENDAR_TYPE),
      syncKeyFromFirebase(STORAGE_TODO_SECTION_NOTES)
    ]);

  loadQuote();
  loadTodos();
  loadRepeating();
  loadRepeatingDayOverrides();
    loadSpecialDates();
    loadTodoSectionHeaderNotes();
    loadCalendarMemo();
    var savedCalType = getFromStore(STORAGE_CALENDAR_TYPE);
    if (savedCalType === 'lunar' || savedCalType === 'solar') state.calendarType = savedCalType;

  loadMemoTabs();
    var specialDatesChanged = false;
    (state.specialDates || []).forEach(function (s) {
      if (!s.memoTabId && state.memoTabs && state.memoTabs.length) {
        var _pid2 = getPersonalTabId();
        if (_pid2) { s.memoTabId = _pid2; specialDatesChanged = true; }
      }
    });
    if (specialDatesChanged) saveSpecialDates();
  loadMemos();

  /* 메모 처음에는 전체 메뉴가 모두 보이도록 */
  state.viewAllMemos = true;
  state.activeMemoTabId = null;
  const memoCol = document.querySelector('.memo-col');
  if (memoCol) memoCol.classList.add('memo-view-all');
  renderMemoTabs();
  showMemoContent();

  state.selectedDate = new Date();

  bindTodoSectionHeaderNoteListenersOnce();
  renderCalendar();
  renderTodos();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
  updateTodoViewCaption();
    updateCalendarTypeUI();
  }

  function updateCalendarTypeUI() {
    var type = state.calendarType || 'solar';
    var label = type === 'lunar' ? '음력' : '양력';
    var toggleBtn = document.getElementById('cal-type-toggle');
    var fullToggleBtn = document.getElementById('cal-full-type-toggle');
    if (toggleBtn) { toggleBtn.textContent = label; toggleBtn.setAttribute('title', '클릭 시 양력↔음력 전환'); }
    if (fullToggleBtn) { fullToggleBtn.textContent = label; fullToggleBtn.setAttribute('title', '클릭 시 양력↔음력 전환'); }
  }
  function setCalendarType(type) {
    if (type !== 'solar' && type !== 'lunar') return;
    pushUndoSnapshot();
    state.calendarType = type;
    setToStore(STORAGE_CALENDAR_TYPE, type);
    updateCalendarTypeUI();
    renderCalendar();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
  }
  function toggleCalendarType() {
    setCalendarType(state.calendarType === 'lunar' ? 'solar' : 'lunar');
  }

  initFromFirebase();
  initGlobalUndoListeners();

  /** HTML title: 브라우저 기본 즉시 툴팁 대신, 잠시 후 커스텀 툴팁 */
  (function initDelayedTitleTooltips() {
    var SHOW_DELAY_MS = 1000;
    var HIDE_DELAY_MS = 150;
    var showTimer = null;
    var hideTimer = null;
    var anchor = null;
    var storedTitle = '';
    var tipEl = null;

    function getTip() {
      if (!tipEl) {
        tipEl = document.createElement('div');
        tipEl.id = 'global-delayed-tooltip';
        tipEl.className = 'global-delayed-tooltip';
        tipEl.setAttribute('role', 'tooltip');
        document.body.appendChild(tipEl);
      }
      return tipEl;
    }

    function clearShowTimer() {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
    }
    function clearHideTimer() {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    }

    function realHide() {
      clearShowTimer();
      clearHideTimer();
      var tip = document.getElementById('global-delayed-tooltip');
      if (tip) {
        tip.style.display = 'none';
        tip.textContent = '';
      }
      if (anchor && storedTitle !== '') {
        anchor.setAttribute('title', storedTitle);
      }
      anchor = null;
      storedTitle = '';
    }

    function scheduleHide() {
      clearHideTimer();
      hideTimer = setTimeout(function () {
        hideTimer = null;
        realHide();
      }, HIDE_DELAY_MS);
    }

    function positionTip(rect) {
      var tip = getTip();
      var margin = 8;
      tip.style.display = 'block';
      var tw = tip.offsetWidth;
      var th = tip.offsetHeight;
      var left = rect.left + rect.width / 2 - tw / 2;
      var top = rect.bottom + margin;
      if (left < 8) left = 8;
      if (left + tw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - tw - 8);
      if (top + th > window.innerHeight - 8) top = rect.top - th - margin;
      tip.style.left = left + 'px';
      tip.style.top = Math.max(8, top) + 'px';
    }

    document.addEventListener('mouseover', function (e) {
      clearHideTimer();
      var el = e.target.closest('[title]');
      if (el && el.closest && el.closest('.no-delayed-tooltip')) return;

      if (!el && anchor && anchor.contains(e.target)) {
        return;
      }

      if (anchor && anchor !== el) {
        realHide();
      }

      el = e.target.closest('[title]');
      if (!el) return;
      if (el.closest && el.closest('.no-delayed-tooltip')) return;
      var raw = el.getAttribute('title');
      if (raw == null || !String(raw).trim()) return;
      if (el.id === 'global-delayed-tooltip') return;

      anchor = el;
      storedTitle = raw;
      el.removeAttribute('title');

      clearShowTimer();
      showTimer = setTimeout(function () {
        showTimer = null;
        if (!anchor || anchor !== el) return;
        var tip = getTip();
        tip.textContent = storedTitle;
        positionTip(anchor.getBoundingClientRect());
      }, SHOW_DELAY_MS);
    }, true);

    document.addEventListener('mouseout', function (e) {
      if (!anchor) return;
      var related = e.relatedTarget;
      if (related && anchor.contains(related)) return;
      if (!anchor.contains(e.target)) return;
      scheduleHide();
    }, true);

    document.addEventListener('scroll', function () { realHide(); }, true);
    window.addEventListener('blur', realHide);
  })();

  document.addEventListener('dragover', e => {
    if (state.draggedTodoPayload) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      updateTodoDropLine(e);
      updateTodoToMemoDropTarget(e);
    } else if (state.dragMemoTabId || state.draggedMemoPayload) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      updateMemoDropLine(e);
      updateMemoToTodoDropTarget(e);
    } else if (state.draggingMemoReorder) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      updateMemoReorderDropLine(e);
    }
  }, true);

  document.addEventListener('drop', e => {
    const memoBlock = e.target.closest && e.target.closest('.memo-all-block');

    if (state.draggedTodoPayload) {
      e.preventDefault();
      e.stopPropagation();
      const payload = state.draggedTodoPayload;
      document.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
      document.querySelectorAll('.cal-full-day').forEach(el => el.classList.remove('cal-full-day-drag-over'));
      document.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
      document.querySelectorAll('.memo-all-block').forEach(b => b.classList.remove('memo-all-block-drop-over', 'memo-all-block-drop-line'));
      if (state.todoToMemoDropTarget && state.todoToMemoDropTarget.tabId) {
        const t = state.todoToMemoDropTarget;
        convertTodoToMemo(payload.key, payload.id, t.tabId, t.index);
        state.draggedTodoPayload = null;
        state.todoDropTarget = null;
        state.todoToMemoDropTarget = null;
        return;
      }
      const target = state.todoDropTarget;
      state.draggedTodoPayload = null;
      state.todoDropTarget = null;
      if (!target || !target.key) return;
      const toKey = target.key;
      const fromKey = payload.key;
      const toSection = target.section || 'morning';
      let toIndexInSection;
      if (target.el) {
        if (payload.id === target.el.dataset.id && fromKey === toKey && (payload.section || 'morning') === toSection) {
        return;
      }
        toIndexInSection = computeTodoSectionInsertIndexBeforeRemoval(toKey, toSection, target.el, target.insertAbove);
      } else {
        toIndexInSection = getSectionTodoListForMove(toKey, toSection).length;
      }
      if (fromKey !== toKey) {
        moveTodoToDate(fromKey, payload.id, toKey, toSection, toIndexInSection);
        return;
      }
      moveTodo(payload.key, payload.id, toSection, toIndexInSection);
      return;
    }

    if (state.draggedMemoPayload && state.memoToTodoDropTarget) {
      e.preventDefault();
      e.stopPropagation();
      const t = state.memoToTodoDropTarget;
      convertMemoToTodo(state.draggedMemoPayload.tabId, state.draggedMemoPayload.itemId, t.key, t.section, t.index);
      state.draggedMemoPayload = null;
      state.memoToTodoDropTarget = null;
      state.dragMemoTabId = null;
      state.memoIncompleteCount = null;
      state.memoDropTarget = null;
      document.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
      document.querySelectorAll('.memo-all-block').forEach(b => b.classList.remove('memo-all-block-drop-over', 'memo-all-block-drop-line'));
      document.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
      document.querySelectorAll('.todo-section').forEach(s => s.classList.remove('todo-section-drop-zone'));
      document.querySelectorAll('.cal-full-day').forEach(el => el.classList.remove('cal-full-day-drag-over'));
    }
  }, true);

  todoListWrap.addEventListener('dragstart', e => {
    if (e.target.closest('input, button')) return;
    const li = e.target.closest('.todo-item');
    if (!li || li.classList.contains('todo-item-completed')) return;
    const key = li.dataset.dateKey || (state.selectedDate ? dateKey(state.selectedDate) : null);
    if (!key) return;
    const section = li.dataset.section;
    const idx = parseInt(li.dataset.index, 10);
    const payload = { key, id: li.dataset.id, section, index: idx };
    state.draggedTodoPayload = payload;
    state.todoDropTarget = null;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    try {
      e.dataTransfer.setDragImage(li, 0, 0);
    } catch (_) {}
  });

  todoListWrap.addEventListener('dragend', () => {
    cleanupTodoDragVisualState();
      state.draggedTodoPayload = null;
      state.todoDropTarget = null;
      state.todoToMemoDropTarget = null;
  });
})();
