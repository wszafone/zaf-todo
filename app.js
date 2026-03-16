(function () {
  'use strict';

  const STORAGE_QUOTE = 'schedule_quote';
  const STORAGE_CALENDAR_MEMO = 'schedule_calendar_memo';
  const STORAGE_TODOS = 'schedule_todos';
  const STORAGE_TODOS_COMPLETED = 'schedule_todos_completed';
  const STORAGE_REPEATING = 'schedule_repeating';
  const STORAGE_MEMOS = 'schedule_memos';
  const STORAGE_MEMO_TABS = 'schedule_memo_tabs';
  const STORAGE_DELETED_MEMO_TABS = 'schedule_deleted_memo_tabs';
  const memoryStore = {};
  function getFromStore(key) { return memoryStore[key] ?? null; }
  function setToStore(key, value) { memoryStore[key] = value; }
  const DEFAULT_MEMO_TABS = ['개인', '시타마치', '슈가맨워크', '부동산투자', '인공지능(AI)', '기타'];
  const MEMO_PASTEL_COLORS = ['#B3E5FC', '#FFF59D', '#C8E6C9', '#F8BBD9', '#B2EBF2', '#E1BEE7', '#FFCC80', '#B2DFDB', '#FFAB91', '#CFD8DC'];
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

  function getPersonalTabId() {
    if (!state.memoTabs || !state.memoTabs.length) return null;
    const personal = state.memoTabs.find(x => x.name === '개인');
    return personal ? personal.id : (state.memoTabs[0] ? state.memoTabs[0].id : null);
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
    memoReorderDropTarget: null,
    draggingMemoReorder: false,
    completedRepeatingInstances: {},
    viewMode: 'todo',
    calendarFullYear: new Date().getFullYear(),
    calendarFullMonth: new Date().getMonth()
  };

  function dateKey(d) {
    if (typeof d === 'string') return d;
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function todayKey() {
    return dateKey(new Date());
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
  }

  function saveCalendarMemo() {
    try {
      const quill = window.calendarMemoQuill;
      if (quill && quill.root) {
        setToStore(STORAGE_CALENDAR_MEMO, quill.root.innerHTML || '');
      }
    } catch (_) {}
  }

  function initCalendarMemoQuill() {
    const container = document.getElementById('calendar-memo');
    if (!container || container.querySelector('.ql-container')) return;
    var QuillGlobal = typeof Quill !== 'undefined' ? Quill : (typeof window !== 'undefined' && window.Quill);
    if (!QuillGlobal) return;
    try {
      var sizeValues = [];
      for (var i = 8; i <= 32; i += 2) sizeValues.push(i + 'px');
      try {
        var SizeStyle = QuillGlobal.import('attributors/style/size');
        if (SizeStyle) { SizeStyle.whitelist = sizeValues; QuillGlobal.register(SizeStyle, true); }
      } catch (_) {
        try {
          var Parchment = QuillGlobal.import('parchment');
          if (Parchment && Parchment.Attributor && Parchment.Attributor.Style) {
            var Sa = new Parchment.Attributor.Style('size', 'font-size', { scope: Parchment.Scope.INLINE });
            Sa.whitelist = sizeValues;
            QuillGlobal.register(Sa, true);
          }
        } catch (__) {
          var Inline = QuillGlobal.import('blots/inline');
          var SizeBlot = function (node) { Inline.call(this, node); };
          SizeBlot.prototype = Object.create(Inline.prototype);
          SizeBlot.prototype.constructor = SizeBlot;
          SizeBlot.blotName = 'size';
          SizeBlot.tagName = 'SPAN';
          SizeBlot.create = function (value) {
            var node = document.createElement('SPAN');
            if (value && sizeValues.indexOf(value) !== -1) node.style.fontSize = value;
            return node;
          };
          SizeBlot.formats = function (domNode) {
            var s = domNode.style && domNode.style.fontSize;
            return s && sizeValues.indexOf(s) !== -1 ? s : undefined;
          };
          QuillGlobal.register(SizeBlot, true);
        }
      }
      try {
        var Underline = QuillGlobal.import('formats/underline');
        if (Underline) QuillGlobal.register(Underline, true);
      } catch (_) {}
      var toolbarOpts = [
        [{ 'size': sizeValues }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'color': [] }, { 'background': [] }],
        [{ 'list': 'ordered' }, { 'list': 'bullet' }],
        ['link'],
        ['clean']
      ];
      window.calendarMemoQuill = new QuillGlobal(container, {
        theme: 'bubble',
        placeholder: '달력 아래 메모를 입력하세요',
        modules: {
          toolbar: toolbarOpts
        }
      });
      var q = window.calendarMemoQuill;
      var lastRange = null;
      q.on('selection-change', function (range) {
        if (range) lastRange = { index: range.index, length: range.length };
        else lastRange = null;
      });
      var applyUnderline = function () {
        var r = lastRange || q.getSelection(true);
        if (!r || r.length === 0) return;
        q.focus();
        setTimeout(function () {
          q.setSelection(r.index, r.length);
          var fmt = q.getFormat(r);
          q.format('underline', !fmt.underline);
        }, 0);
      };
      var applyStrike = function () {
        var r = lastRange || q.getSelection(true);
        if (!r || r.length === 0) return;
        q.focus();
        setTimeout(function () {
          q.setSelection(r.index, r.length);
          var fmt = q.getFormat(r);
          q.format('strike', !fmt.strike);
        }, 0);
      };
      q.root.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.key === 'u') {
          e.preventDefault();
          applyUnderline();
        }
      });
      function onToolbarUnderline(e) {
        if (!e.target.closest('.ql-underline')) return;
        e.preventDefault();
        e.stopPropagation();
        applyUnderline();
      }
      function onToolbarStrike(e) {
        if (!e.target.closest('.ql-strike')) return;
        e.preventDefault();
        e.stopPropagation();
        applyStrike();
      }
      document.addEventListener('mousedown', onToolbarUnderline, true);
      document.addEventListener('mousedown', onToolbarStrike, true);
      var raw = getFromStore(STORAGE_CALENDAR_MEMO);
      if (raw && raw.trim()) {
        window.calendarMemoQuill.root.innerHTML = raw;
      }
      window.calendarMemoQuill.on('text-change', function () { saveCalendarMemo(); });
      window.addEventListener('beforeunload', saveCalendarMemo);
    } catch (e) {
      console.warn('Quill init failed', e);
    }
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

  function loadRepeating() {
    try {
      const raw = getFromStore(STORAGE_REPEATING);
      state.repeatingTodos = raw ? JSON.parse(raw) : [];
      state.repeatingTodos.forEach(t => {
        if (t.important === true) t.important = 'red';
        if (t.important !== false && t.important !== 'blue' && t.important !== 'red') t.important = false;
      });
    } catch (_) {
      state.repeatingTodos = [];
    }
  }

  function saveRepeating() {
    setToStore(STORAGE_REPEATING, JSON.stringify(state.repeatingTodos));
  }

  function repeatingAppliesToDate(t, key) {
    if (t.repeat === 'none') return false;
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const start = t.rangeStart ? new Date(t.rangeStart) : (t.originKey ? new Date(t.originKey) : null);
    const end = t.rangeEnd ? new Date(t.rangeEnd) : null;
    if (start && date < start) return false;
    if (end && date > end) return false;
    const origin = t.originKey ? new Date(t.originKey) : date;
    if (t.repeat === 'daily') return true;
    if (t.repeat === 'weekly') return date.getDay() === origin.getDay() && (!start || date >= start);
    if (t.repeat === 'monthly') return date.getDate() === origin.getDate();
    if (t.repeat === 'range') return true;
    return true;
  }

  function todoSortOrder(a, b) {
    if (a.completed !== b.completed) return (a.completed ? 1 : 0) - (b.completed ? 1 : 0);
    const ar = !!(a.repeat && a.repeat !== 'none');
    const br = !!(b.repeat && b.repeat !== 'none');
    return (br ? 1 : 0) - (ar ? 1 : 0);
  }
  function getTodosForDate(key) {
    let list = (state.todos[key] || []).slice();
    state.repeatingTodos.forEach(t => {
      if (repeatingAppliesToDate(t, key)) {
        const instanceId = t.id + '_' + key;
        list.push({ ...t, id: instanceId, completed: !!state.completedRepeatingInstances[instanceId] });
      }
    });
    list = list.filter(t => !isDeletedTabId(t.memoTabId));
    const out = { morning: [], lunch: [], afternoon: [], evening: [] };
    list.forEach(t => {
      if (out[t.section]) out[t.section].push(t);
    });
    ['morning', 'lunch', 'afternoon', 'evening'].forEach(s => {
      if (out[s].length) out[s].sort(todoSortOrder);
    });
    return out;
  }

  const TODO_SECTIONS = ['morning', 'lunch', 'afternoon', 'evening'];

  function moveTodo(key, todoId, toSection, toIndexInSection) {
    const all = state.todos[key] || [];
    const isRepeatingInstance = (id) => /_\d{4}-\d{2}-\d{2}$/.test(String(id));
    const repeating = all.filter(t => isRepeatingInstance(t.id));
    const list = all.filter(t => !isRepeatingInstance(t.id));
    const fromIndex = list.findIndex(t => t.id === todoId);
    if (fromIndex < 0) return;
    if (!TODO_SECTIONS.includes(toSection)) return;
    const [moved] = list.splice(fromIndex, 1);
    moved.section = toSection;
    const bySec = { morning: [], lunch: [], afternoon: [], evening: [] };
    list.forEach(t => {
      if (bySec[t.section]) bySec[t.section].push(t);
    });
    const targetList = bySec[toSection] || [];
    const insertAt = Math.max(0, Math.min(toIndexInSection, targetList.length));
    targetList.splice(insertAt, 0, moved);
    bySec[toSection] = targetList;
    const nonRepeatingOrdered = TODO_SECTIONS.flatMap(s => bySec[s] || []);
    const bySecWithRepeat = { morning: [], lunch: [], afternoon: [], evening: [] };
    nonRepeatingOrdered.forEach(t => { if (bySecWithRepeat[t.section]) bySecWithRepeat[t.section].push(t); });
    repeating.forEach(t => { if (bySecWithRepeat[t.section]) bySecWithRepeat[t.section].push(t); });
    state.todos[key] = TODO_SECTIONS.flatMap(s => bySecWithRepeat[s] || []);
    saveTodos();
    renderTodos();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
  }

  function moveTodoToDate(fromKey, todoId, toKey, toSection, toIndexInSection) {
    const isRepeatingInstance = (id) => /_\d{4}-\d{2}-\d{2}$/.test(String(id));
    if (!fromKey || !toKey || !TODO_SECTIONS.includes(toSection)) return;
    const fromAll = state.todos[fromKey] || [];
    const fromIndex = fromAll.findIndex(t => t.id === todoId);
    if (fromIndex < 0) return;
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
    list.splice(insertAt, 0, newTodo);
    bySec[section] = list;
    state.todos[key] = TODO_SECTIONS.flatMap(s => bySec[s] || []);
    saveTodos();
    renderTodos();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
  }

  function convertTodoToMemo(todoKey, todoId, targetTabId, insertIndex) {
    const list = state.todos[todoKey] || [];
    const isRepeating = /_\d{4}-\d{2}-\d{2}$/.test(String(todoId));
    if (isRepeating) return;
    const t = list.find(x => x.id === todoId);
    if (!t) return;
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
    if (state.viewAllMemos) showMemoContent(); else if (state.activeMemoTabId === targetTabId) renderMemoItemList(targetTabId);
  }

  function convertMemoToTodo(tabId, itemId, targetKey, targetSection, targetIndexInSection) {
    const items = ensureMemoItems(tabId);
    const m = items.find(x => x.id === itemId);
    if (!m) return;
    addTodoAtKey(targetKey, targetSection, targetIndexInSection, { title: m.title || '', desc: m.content || '', memoTabId: tabId });
    state.memos[tabId] = items.filter(x => x.id !== itemId);
    saveMemos();
    if (state.viewAllMemos) showMemoContent(); else if (state.activeMemoTabId === tabId) renderMemoItemList(tabId);
  }

  function addTodoInline(section) {
    const key = dateKey(state.selectedDate);
    if (!key) return;
    if (!state.todos[key]) state.todos[key] = [];
    const id = 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const newTodo = {
      id,
      title: '',
      desc: '',
      section: section || 'morning',
      repeat: 'none',
      rangeStart: '',
      rangeEnd: '',
      important: false,
      completed: false,
      order: state.todos[key].length,
      memoTabId: getPersonalTabId() || undefined
    };
    state.todos[key].push(newTodo);
    ensureTodoOrderForKey(key);
    renderTodos();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
  }

  function updateTodoFields(id, fields) {
    const key = dateKey(state.selectedDate);
    if (!key) return;
    const isRepeatingInstance = /_\d{4}-\d{2}-\d{2}$/.test(String(id));
    const realId = isRepeatingInstance ? String(id).replace(/_\d{4}-\d{2}-\d{2}$/, '') : id;
    if (!isRepeatingInstance && state.todos[key]) {
      const t = state.todos[key].find(x => x.id === id);
      if (t) {
        if (fields.title !== undefined) t.title = fields.title;
        if (fields.desc !== undefined) t.desc = fields.desc;
        if (fields.memoTabId !== undefined) t.memoTabId = fields.memoTabId || undefined;
        saveTodos();
        return;
      }
    }
    const r = state.repeatingTodos.find(x => x.id === realId);
    if (r) {
      if (fields.title !== undefined) r.title = fields.title;
      if (fields.desc !== undefined) r.desc = fields.desc;
      if (fields.memoTabId !== undefined) r.memoTabId = fields.memoTabId || undefined;
      saveRepeating();
    }
  }

  function addOrUpdateTodo(payload) {
    const key = dateKey(state.selectedDate);
    if (!state.todos[key]) state.todos[key] = [];
    if (payload.id) {
      const idx = state.todos[key].findIndex(t => t.id === payload.id);
      if (idx >= 0) {
        const updated = { ...state.todos[key][idx], ...payload };
        state.todos[key][idx] = updated;
        if (updated.repeat && updated.repeat !== 'none') {
          const repIdx = state.repeatingTodos.findIndex(r => r.id === payload.id);
          const originKey = (state.repeatingTodos[repIdx] && state.repeatingTodos[repIdx].originKey) || key;
          if (repIdx >= 0) state.repeatingTodos[repIdx] = { ...updated, originKey };
          else state.repeatingTodos.push({ ...updated, originKey });
        } else {
          state.repeatingTodos = state.repeatingTodos.filter(r => r.id !== payload.id);
        }
        saveTodos();
        saveRepeating();
        renderTodos();
        return;
      }
      const repIdx = state.repeatingTodos.findIndex(r => r.id === payload.id);
      if (repIdx >= 0) {
        const updated = { ...state.repeatingTodos[repIdx], ...payload };
        const originKey = state.repeatingTodos[repIdx].originKey || key;
        state.repeatingTodos[repIdx] = { ...updated, originKey };
        saveRepeating();
        renderTodos();
        return;
      }
    }
    const id = 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const newTodo = {
      id,
      title: payload.title || '',
      desc: payload.desc || '',
      section: payload.section || 'morning',
      repeat: payload.repeat || 'none',
      rangeStart: payload.rangeStart || '',
      rangeEnd: payload.rangeEnd || '',
      important: (payload.important === 'blue' || payload.important === 'red') ? payload.important : false,
      completed: false,
      order: state.todos[key].length,
      memoTabId: payload.memoTabId || undefined
    };
    state.todos[key].push(newTodo);
    if (newTodo.repeat && newTodo.repeat !== 'none') {
      state.repeatingTodos.push({ ...newTodo, originKey: key });
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
  function setTodoImportant(id, important) {
    const key = dateKey(state.selectedDate);
    if (!key) return;
    const isRepeatingInstance = /_\d{4}-\d{2}-\d{2}$/.test(String(id));
    const realId = isRepeatingInstance ? String(id).replace(/_\d{4}-\d{2}-\d{2}$/, '') : id;
    if (!isRepeatingInstance && state.todos[key]) {
      const t = state.todos[key].find(x => x.id === id);
      if (t) {
        t.important = important;
        saveTodos();
        renderTodos();
        return;
      }
    }
    const r = state.repeatingTodos.find(x => x.id === realId);
    if (r) {
      r.important = important;
      saveRepeating();
      renderTodos();
    }
  }

  function setTodoCompleted(id, completed) {
    const key = dateKey(state.selectedDate);
    const isRepeatingInstance = /_\d{4}-\d{2}-\d{2}$/.test(String(id));
    if (isRepeatingInstance) {
      if (completed) state.completedRepeatingInstances[id] = true;
      else delete state.completedRepeatingInstances[id];
      saveCompletedRepeating();
    } else if (key && state.todos[key]) {
      const t = state.todos[key].find(x => x.id === id);
      if (t) {
        t.completed = !!completed;
        saveTodos();
      }
    }
    renderTodos();
  }

  function deleteTodo(id, fromKey) {
    const key = fromKey !== undefined ? fromKey : dateKey(state.selectedDate);
    const isRepeatingInstance = /_\d{4}-\d{2}-\d{2}$/.test(String(id));
    const realId = isRepeatingInstance ? String(id).replace(/_\d{4}-\d{2}-\d{2}$/, '') : id;
    if (!isRepeatingInstance && key && state.todos[key]) {
      state.todos[key] = state.todos[key].filter(t => t.id !== id);
      saveTodos();
    }
    if (isRepeatingInstance) {
      state.repeatingTodos = state.repeatingTodos.filter(r => r.id !== realId);
      saveRepeating();
    }
    renderTodos();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
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
    function hasTodosOnDate(dkey) {
      const list = (state.todos[dkey] || []).filter(t => !isDeletedTabId(t.memoTabId));
      const repCount = state.repeatingTodos.filter(r => repeatingAppliesToDate(r, dkey) && !isDeletedTabId(r.memoTabId)).length;
      return list.length + repCount > 0;
    }
    function setCellContent(cell, num, dkey) {
      const holidayName = getHolidayName(dkey);
      if (holidayName) {
        cell.innerHTML = `<span class="cal-num">${num}</span><span class="cal-holiday-name">${holidayName}</span>`;
      } else {
        cell.innerHTML = `<span class="cal-num">${num}</span>`;
      }
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
    renderCalendar();
    const el = document.getElementById('selected-date');
    if (el) el.textContent = d ? dateKey(d) : '';
    renderTodos();
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
        const holidayNamePrev = getHolidayName(dkey);
        if (holidayNamePrev) cell.classList.add('cal-holiday');
        cell.dataset.date = dkey;
        cell.innerHTML = `<div class="cal-full-day-head"><span class="cal-full-num">${prevMonth.getDate()}</span>${holidayNamePrev ? `<span class="cal-full-holiday-name">${holidayNamePrev}</span>` : ''}</div><div class="cal-full-todos-wrap"><ul class="cal-full-todos" data-date="${dkey}"></ul></div>`;
      } else if (dayCount < daysInMonth) {
        dayCount++;
        dkey = `${y}-${String(m + 1).padStart(2, '0')}-${String(dayCount).padStart(2, '0')}`;
        const holidayNameCur = getHolidayName(dkey);
        if (dkey === today) cell.classList.add('today');
        if (holidayNameCur) cell.classList.add('cal-holiday');
        cell.dataset.date = dkey;
        cell.innerHTML = `<div class="cal-full-day-head"><span class="cal-full-num">${dayCount}</span>${holidayNameCur ? `<span class="cal-full-holiday-name">${holidayNameCur}</span>` : ''}<button type="button" class="cal-full-add" data-date="${dkey}" aria-label="할일 추가">⊕</button></div><div class="cal-full-todos-wrap"><ul class="cal-full-todos" data-date="${dkey}" data-section="morning"></ul></div>`;
      } else {
        nextMonthDay++;
        const nextMonth = new Date(y, m + 1, nextMonthDay);
        dkey = dateKey(nextMonth);
        const holidayNameNext = getHolidayName(dkey);
        if (holidayNameNext) cell.classList.add('cal-holiday');
        cell.dataset.date = dkey;
        cell.innerHTML = `<div class="cal-full-day-head"><span class="cal-full-num">${nextMonth.getDate()}</span>${holidayNameNext ? `<span class="cal-full-holiday-name">${holidayNameNext}</span>` : ''}</div><div class="cal-full-todos-wrap"><ul class="cal-full-todos" data-date="${dkey}"></ul></div>`;
      }

      const bySection = getTodosForDate(dkey);
      const sectionOrder = ['morning', 'lunch', 'afternoon', 'evening'];
      const todosAll = sectionOrder.flatMap(s => {
        const items = (bySection[s] || []).filter(t => !t.completed);
        return items.slice().sort((a, b) => {
          const ar = !!(a.repeat && a.repeat !== 'none');
          const br = !!(b.repeat && b.repeat !== 'none');
          return (br ? 1 : 0) - (ar ? 1 : 0);
        });
      });
      const ul = cell.querySelector('.cal-full-todos');
      if (ul && todosAll.length > 0) {
        todosAll.forEach((t, idx) => {
          const section = t.section || 'morning';
          const colorIdx = getTodoColorIndex(t, section);
          const completed = !!t.completed;
          const li = document.createElement('li');
          li.className = 'cal-full-day-todo todo-item cal-full-todo-' + section + ' todo-bg-' + colorIdx + (completed ? ' cal-full-todo-completed' : '') + (t.important === 'blue' ? ' cal-full-todo-important-blue' : t.important === 'red' ? ' cal-full-todo-important-red' : '');
          li.draggable = true;
          li.dataset.id = t.id;
          li.dataset.dateKey = dkey;
          li.dataset.section = section;
          li.dataset.index = String(idx);
          li.dataset.completed = completed ? '1' : '0';
          li.dataset.important = t.important || '0';
          const realId = String(t.id).includes('_') ? String(t.id).split('_').slice(0, -1).join('_') : t.id;
          li.dataset.realId = realId;
          const title = (t.title || '제목 없음').slice(0, 18) + ((t.title || '').length > 18 ? '…' : '');
          const importantIcon = (t.important === 'blue' || t.important === 'red') ? '★' : '☆';
          const repeatIcon = (t.repeat && t.repeat !== 'none') ? '↻' : '↺';
          const completeIcon = completed ? '✓' : '☐';
          const importantCls = t.important === 'blue' ? ' cal-full-todo-important-blue' : t.important === 'red' ? ' cal-full-todo-important-red' : '';
          const repeatCls = (t.repeat && t.repeat !== 'none') ? ' cal-full-todo-repeat-on' : '';
          const completeCls = completed ? ' cal-full-todo-complete-on' : '';
          li.innerHTML = `<span class="cal-full-todo-icons" aria-hidden="true"><button type="button" class="cal-full-todo-complete${completeCls}" title="${completed ? '완료 (클릭 취소)' : '미완료'}">${completeIcon}</button><button type="button" class="cal-full-todo-important${importantCls}" title="${t.important === 'red' ? '중요 빨강 (클릭 해제)' : t.important === 'blue' ? '중요 파랑 (클릭 시 빨강)' : '중요 표시'}">${importantIcon}</button><button type="button" class="cal-full-todo-repeat${repeatCls}" title="${t.repeat && t.repeat !== 'none' ? '반복 설정됨 (클릭하여 변경)' : '반복'}">${repeatIcon}</button></span><span class="cal-full-todo-title" data-full-title="${escapeHtml(t.title || '')}" title="${escapeHtml(t.title || '')}">${escapeHtml(title)}</span><button type="button" class="cal-full-todo-del" data-id="${t.id}" data-date="${dkey}" aria-label="삭제">×</button>`;
          ul.appendChild(li);
        });
      }
      body.appendChild(cell);
    }

    grid.innerHTML = '';
    grid.appendChild(headRow);
    grid.appendChild(body);

    document.getElementById('cal-full-month-year').textContent = `${y}년 ${m + 1}월`;
    updateTodoViewCaption();

    grid.querySelectorAll('.cal-full-day-todo:not(.cal-full-more)').forEach(li => {
      li.addEventListener('dragstart', (e) => {
        if (e.target.closest('button')) return;
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
        state.draggedTodoPayload = null;
        state.todoDropTarget = null;
        li.classList.remove('dragging');
        document.querySelectorAll('.cal-full-day').forEach(el => el.classList.remove('cal-full-day-drag-over'));
        document.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
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
        const target = state.todoDropTarget;
        const toKey = (target && target.key) || li.dataset.dateKey;
        const toSection = (target && target.section) || li.dataset.section || 'morning';
        const toIndex = target ? (target.insertAbove ? target.index : (target.el ? target.index + 1 : target.index)) : 0;
        document.querySelectorAll('.cal-full-day').forEach(el => el.classList.remove('cal-full-day-drag-over'));
        document.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
        state.draggedTodoPayload = null;
        state.todoDropTarget = null;
        if (payload.key !== toKey) {
          moveTodoToDate(payload.key, payload.id, toKey, toSection, toIndex);
        } else {
          moveTodo(payload.key, payload.id, toSection, toIndex);
        }
        renderCalendarFull();
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
      const opt = document.createElement('option');
      opt.value = tab.id;
      opt.textContent = tab.name || '(이름 없음)';
      if (tab.id === (t.memoTabId || getPersonalTabId() || '')) opt.selected = true;
      categorySelect.appendChild(opt);
    });
    if (!(state.memoTabs && state.memoTabs.length)) categorySelect.disabled = true;
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
      updateTodoFields(t.id, { title: titleInput.value.trim(), desc: descInput.value.trim() });
    }
    titleInput.addEventListener('change', saveTodoFields);
    titleInput.addEventListener('blur', saveTodoFields);
    titleInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
    });
    descInput.addEventListener('change', saveTodoFields);
    descInput.addEventListener('blur', saveTodoFields);
    descInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
    });
    delBtn.addEventListener('click', () => {
      deleteTodo(t.id);
    });
    repeatBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTodoModal(repeatBtn.dataset.realId);
    });
    completeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setTodoCompleted(t.id, !completed);
    });
    categorySelect.addEventListener('change', function () {
      const val = this.value || undefined;
      updateTodoFields(t.id, { memoTabId: val });
      renderTodos();
      if (state.viewMode === 'calendarFull') renderCalendarFull();
    });
  }

  function renderTodos() {
    const key = state.selectedDate ? dateKey(state.selectedDate) : null;
    const wrap = document.getElementById('todo-list-wrap');
    if (wrap) { if (key) wrap.dataset.date = key; else delete wrap.dataset.date; }
    const bySection = key ? getTodosForDate(key) : { morning: [], lunch: [], afternoon: [], evening: [] };

    ['morning', 'lunch', 'afternoon', 'evening'].forEach(section => {
      const ul = document.querySelector(`.todo-items[data-section="${section}"]`);
      if (!ul) return;
      ul.innerHTML = '';
      const items = bySection[section] || [];
      items.forEach((t, idx) => {
        if (t.completed) return;
        renderTodoItem(ul, t, section, idx, {});
      });
    });

    const completedUl = document.querySelector('.todo-items[data-section="completed"]');
    if (completedUl) {
      completedUl.innerHTML = '';
      const sectionOrder = ['morning', 'lunch', 'afternoon', 'evening'];
      const completedItems = sectionOrder.flatMap(section => (bySection[section] || []).filter(t => t.completed));
      completedItems.forEach((t, idx) => {
        renderTodoItem(completedUl, t, t.section, idx, { noDrag: true });
      });
    }

    initTodoButtons();
  }

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
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
      const key = overItem.dataset.dateKey || state.selectedDate ? dateKey(state.selectedDate) : null;
      state.todoDropTarget = { el: overItem, insertAbove, section: overItem.dataset.section, index: parseInt(overItem.dataset.index, 10), key };
    } else if (overUl) {
      const key = (overUl.closest && overUl.closest('[data-date]') && overUl.closest('[data-date]').dataset.date) || (state.selectedDate ? dateKey(state.selectedDate) : null);
      state.todoDropTarget = { el: null, insertAbove: false, section: overUl.dataset.section, index: overUl.querySelectorAll('.todo-item').length, key };
    } else if (overCalFullDay) {
      const key = overCalFullDay.dataset.date;
      const list = overCalFullDay.querySelectorAll('.cal-full-day-todo');
      overCalFullDay.classList.add('cal-full-day-drag-over');
      state.todoDropTarget = { el: null, insertAbove: false, section: 'morning', index: list.length, key };
    } else {
      state.todoDropTarget = null;
    }
  }

  function updateMemoDropLine(e) {
    if (!state.dragMemoTabId) return;
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    document.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
    document.querySelectorAll('.memo-all-block').forEach(b => b.classList.remove('memo-all-block-drop-over', 'memo-all-block-drop-line'));
    var block = els.find(el => el.classList && el.classList.contains('memo-all-block'));
    var targetTabId = block && block.dataset.tabId ? block.dataset.tabId : state.dragMemoTabId;
    var rowUnderCursor = els.find(el => el.classList && el.classList.contains('memo-item-row') && !el.classList.contains('memo-item-dragging') && el.dataset.tabId === targetTabId);
    if (rowUnderCursor) {
      const rect = rowUnderCursor.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const insertAbove = e.clientY < mid;
      rowUnderCursor.classList.toggle('memo-item-over-top', insertAbove);
      rowUnderCursor.classList.toggle('memo-item-over-bottom', !insertAbove);
      state.memoDropTarget = { el: rowUnderCursor, insertAbove, tabId: targetTabId };
      return;
    }
    if (block && block.dataset.tabId && block.dataset.tabId !== state.dragMemoTabId) {
      var rows = block.querySelectorAll('.memo-item-row');
      var lastRow = rows.length ? rows[rows.length - 1] : null;
      if (lastRow) {
        lastRow.classList.add('memo-item-over-bottom');
        state.memoDropTarget = { el: lastRow, insertAbove: false, tabId: block.dataset.tabId };
      } else {
        block.classList.add('memo-all-block-drop-line');
        state.memoDropTarget = { el: null, insertAbove: true, tabId: block.dataset.tabId };
      }
    } else {
      state.memoDropTarget = null;
    }
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
    const other = els.find(el => el.classList && el.classList.contains('memo-reorder-item') && !el.classList.contains('memo-reorder-dragging'));
    document.querySelectorAll('.memo-reorder-item').forEach(el => el.classList.remove('memo-reorder-over-top', 'memo-reorder-over-bottom'));
    if (!other) return;
    const rect = other.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const insertAbove = e.clientY < mid;
    other.classList.toggle('memo-reorder-over-top', insertAbove);
    other.classList.toggle('memo-reorder-over-bottom', !insertAbove);
    state.memoReorderDropTarget = { el: other, insertAbove };
  }

  function initTodoButtons() {
    document.querySelectorAll('.todo-important-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.id;
        const current = btn.dataset.important === 'false' ? false : btn.dataset.important;
        const next = nextImportant(current);
        setTodoImportant(id, next);
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
        document.getElementById('todo-title').value = t.title || '';
        document.getElementById('todo-desc').value = t.desc || '';
        document.getElementById('todo-section').value = t.section || 'morning';
        document.getElementById('todo-repeat').value = t.repeat || 'none';
        document.getElementById('todo-range-start').value = t.rangeStart || '';
        document.getElementById('todo-range-end').value = t.rangeEnd || '';
        if (categorySelect) categorySelect.value = t.memoTabId || getPersonalTabId() || '';
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
      if (categorySelect) categorySelect.value = getPersonalTabId() || (state.memoTabs[0] ? state.memoTabs[0].id : '');
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

    if (!title) {
      alert('제목을 입력하세요.');
      return;
    }
    if (!state.selectedDate) {
      alert('날짜를 선택하세요.');
      return;
    }

    const payload = {
      title,
      desc: document.getElementById('todo-desc').value.trim(),
      section,
      repeat: repeat === 'range' ? 'range' : repeat,
      rangeStart: repeat === 'range' ? rangeStart : '',
      rangeEnd: repeat === 'range' ? rangeEnd : '',
      memoTabId: memoTabId || getPersonalTabId() || undefined
    };
    if (state.editingTodoId) payload.id = state.editingTodoId;
    addOrUpdateTodo(payload);
    closeTodoModal();
    if (state.viewMode === 'calendarFull') renderCalendarFull();
  });

  document.getElementById('todo-cancel').addEventListener('click', closeTodoModal);

  let editingTodoIdForRepeat = null;
  function openRepeatOnlyModal(realId) {
    editingTodoIdForRepeat = realId;
    const key = dateKey(state.selectedDate);
    let t = null;
    if (key && state.todos[key]) t = state.todos[key].find(x => x.id === realId);
    if (!t && realId) t = state.repeatingTodos.find(x => x.id === realId);
    document.getElementById('todo-repeat-only-range-group').style.display = 'none';
    if (t) {
      document.getElementById('todo-repeat-only').value = t.repeat || 'none';
      document.getElementById('todo-repeat-only-range-start').value = t.rangeStart || '';
      document.getElementById('todo-repeat-only-range-end').value = t.rangeEnd || '';
      if (t.repeat === 'range') document.getElementById('todo-repeat-only-range-group').style.display = 'block';
    } else {
      document.getElementById('todo-repeat-only').value = 'none';
      document.getElementById('todo-repeat-only-range-start').value = '';
      document.getElementById('todo-repeat-only-range-end').value = '';
    }
    document.getElementById('todo-repeat-modal').classList.add('show');
  }
  function closeRepeatOnlyModal() {
    document.getElementById('todo-repeat-modal').classList.remove('show');
    editingTodoIdForRepeat = null;
  }
  document.getElementById('todo-repeat-only').addEventListener('change', () => {
    document.getElementById('todo-repeat-only-range-group').style.display =
      document.getElementById('todo-repeat-only').value === 'range' ? 'block' : 'none';
  });
  document.getElementById('todo-repeat-only-save').addEventListener('click', () => {
    if (!editingTodoIdForRepeat || !state.selectedDate) {
      closeRepeatOnlyModal();
      return;
    }
    const repeat = document.getElementById('todo-repeat-only').value;
    const rangeStart = document.getElementById('todo-repeat-only-range-start').value;
    const rangeEnd = document.getElementById('todo-repeat-only-range-end').value;
    addOrUpdateTodo({
      id: editingTodoIdForRepeat,
      repeat: repeat === 'range' ? 'range' : repeat,
      rangeStart: repeat === 'range' ? rangeStart : '',
      rangeEnd: repeat === 'range' ? rangeEnd : ''
    });
    closeRepeatOnlyModal();
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
        return { ...tab, colorIndex };
      }).filter(t => t.name);
      if (!state.memoTabs.length) state.memoTabs = DEFAULT_MEMO_TABS.map((name, i) => ({ id: 'tab_' + i, name, colorIndex: i % 10 }));
    } catch (_) {
      state.memoTabs = DEFAULT_MEMO_TABS.map((name, i) => ({ id: 'tab_' + i, name, colorIndex: i % 10 }));
    }
    if (!state.memoTabs.some(t => t.name === '개인')) {
      const idx = state.memoTabs.length;
      state.memoTabs.push({ id: 'tab_' + idx, name: '개인', colorIndex: idx % 10 });
    }
    try {
      const rawDeleted = getFromStore(STORAGE_DELETED_MEMO_TABS);
      const parsedDeleted = rawDeleted ? JSON.parse(rawDeleted) : [];
      state.deletedMemoTabs = Array.isArray(parsedDeleted) ? parsedDeleted.map((t, i) => {
        const tab = typeof t === 'string' ? { id: 'tab_del_' + i, name: t } : { id: t.id || 'tab_del_' + i, name: t.name || '' };
        const colorIndex = typeof t === 'object' && typeof t.colorIndex === 'number' && t.colorIndex >= 0 && t.colorIndex <= 9 ? t.colorIndex : 0;
        return { ...tab, colorIndex };
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

  function ensureMemoItems(tabId) {
    if (!state.memos[tabId] || !Array.isArray(state.memos[tabId])) {
      state.memos[tabId] = [];
    }
    return state.memos[tabId];
  }

  function setMemoItemImportant(tabId, itemId, important) {
    const items = state.memos[tabId];
    if (!items) return;
    const m = items.find(x => x.id === itemId);
    if (m) {
      m.important = important;
      saveMemos();
      if (state.viewAllMemos) showMemoContent();
      else if (state.activeMemoTabId === tabId) renderMemoItemList(tabId);
    }
  }

  function sortMemoItemsCompletedLast(items) {
    return [...items].sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0));
  }

  function renderMemoTabs() {
    const select = document.getElementById('memo-category-select');
    if (!select) return;
    const currentValue = state.viewAllMemos ? '' : (state.activeMemoTabId || (state.memoTabs[0] ? state.memoTabs[0].id : ''));
    select.innerHTML = '';
    const optEmpty = document.createElement('option');
    optEmpty.value = '';
    optEmpty.textContent = '전체';
    select.appendChild(optEmpty);
    state.memoTabs.forEach(tab => {
      const opt = document.createElement('option');
      opt.value = tab.id;
      opt.textContent = tab.name;
      select.appendChild(opt);
    });
    select.value = currentValue;
  }

  function selectMemoTab(tabId) {
    if (tabId === '' || tabId == null) {
      state.viewAllMemos = true;
      state.activeMemoTabId = null;
      document.querySelector('.memo-col').classList.add('memo-view-all');
    } else {
      state.viewAllMemos = false;
      state.activeMemoTabId = tabId;
      document.querySelector('.memo-col').classList.remove('memo-view-all');
    }
    renderMemoTabs();
    showMemoContent();
  }

  function setMemoItemCompleted(tabId, itemId, completed) {
    const items = ensureMemoItems(tabId).slice();
    const idx = items.findIndex(m => m.id === itemId);
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
    const hasValidSelection = state.activeMemoTabId && state.memoTabs.some(t => t.id === state.activeMemoTabId);
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
            const contentInput = document.createElement('textarea');
            contentInput.className = 'memo-item-content';
            contentInput.placeholder = '내용';
            contentInput.value = m.content || '';
            contentInput.rows = 2;
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
                it.content = contentInput.value;
                saveMemos();
              }
            }
            titleInput.addEventListener('change', saveMemoFieldsAll);
            titleInput.addEventListener('blur', saveMemoFieldsAll);
            titleInput.addEventListener('keydown', function (e) {
              if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
            });
            contentInput.addEventListener('change', saveMemoFieldsAll);
            contentInput.addEventListener('blur', saveMemoFieldsAll);
            contentInput.addEventListener('keydown', function (e) {
              if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
            });
            delBtn.addEventListener('click', function (e) {
              e.preventDefault();
              e.stopPropagation();
              const btn = e.currentTarget;
              const tabId = btn.dataset.tabId;
              const itemId = btn.dataset.itemId;
              if (tabId != null && itemId != null) deleteMemoItem(tabId, itemId);
              showMemoContent();
            });
            li.addEventListener('dragstart', e => {
              if (e.target.closest('input, textarea, button, label')) return;
              state.dragMemoTabId = tab.id;
              state.draggedMemoPayload = { tabId: tab.id, itemId: m.id, index: arrayIndex };
              state.memoDropTarget = null;
              state.memoToTodoDropTarget = null;
              li.classList.add('memo-item-dragging');
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('application/json', JSON.stringify({ tabId: tab.id, index: arrayIndex, itemId: m.id }));
              e.dataTransfer.setDragImage(li, 0, 0);
            });
            li.addEventListener('dragend', () => {
              state.dragMemoTabId = null;
              state.draggedMemoPayload = null;
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
          listEl.querySelectorAll('.memo-item-row').forEach(li => {
            li.addEventListener('dragover', e => {
              e.preventDefault();
              if (state.dragMemoTabId !== tab.id) return;
              e.dataTransfer.dropEffect = 'move';
              updateMemoDropLine(e);
            });
            li.addEventListener('dragleave', () => {
              listEl.querySelectorAll('.memo-item-row').forEach(el => {
                el.classList.remove('memo-item-over-top', 'memo-item-over-bottom');
              });
            });
            li.addEventListener('drop', e => {
              e.preventDefault();
              let dragPayload;
              try {
                dragPayload = JSON.parse(e.dataTransfer.getData('application/json'));
              } catch (_) { return; }
              if (dragPayload.tabId !== tab.id) return;
              const fromIndex = dragPayload.index;
              const t = state.memoDropTarget && state.memoDropTarget.tabId === tab.id ? state.memoDropTarget : null;
              const toLi = t ? t.el : e.target.closest('.memo-item-row');
              if (!toLi) return;
              const toIndex = parseInt(toLi.dataset.index, 10);
              const dropBottom = t ? !t.insertAbove : toLi.classList.contains('memo-item-over-bottom');
              listEl.querySelectorAll('.memo-item-row').forEach(el => {
                el.classList.remove('memo-item-over-top', 'memo-item-over-bottom');
              });
              state.memoDropTarget = null;
              const insertAt = dropBottom ? toIndex + 1 : toIndex;
              const toIndexAfterRemove = fromIndex < insertAt ? insertAt - 1 : insertAt;
              if (fromIndex === toIndexAfterRemove || fromIndex === toIndexAfterRemove + 1) return;
              reorderMemoItems(tab.id, fromIndex, toIndexAfterRemove);
            });
          });
          contentWrap.appendChild(listEl);
        }
        block.appendChild(contentWrap);
        allContent.appendChild(block);

        function onBlockDragover(e) {
          if (!state.dragMemoTabId || state.dragMemoTabId === tab.id) return;
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
          var t = state.memoDropTarget && state.memoDropTarget.tabId === tab.id ? state.memoDropTarget : null;
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
          state.draggedMemoPayload = null;
        }
        block.addEventListener('dragover', onBlockDragover);
        block.addEventListener('dragleave', onBlockDragleave);
        block.addEventListener('drop', onBlockDrop);
      });
      /* 전체보기: 제목 호버 시 내용 팝업 */
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
        allContent.querySelectorAll('.memo-item-row').forEach(function (row) {
          var contentEl = row.querySelector('.memo-item-content');
          if (!contentEl) return;
          row.addEventListener('mouseenter', function () {
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
            var text = (contentEl.value || '').trim();
            if (!text) { tooltipEl.style.display = 'none'; return; }
            tooltipEl.textContent = text;
            tooltipEl.style.display = 'block';
            var rect = row.getBoundingClientRect();
            var left = rect.left;
            var top = rect.bottom + 2;
            var viewW = window.innerWidth;
            var viewH = window.innerHeight;
            if (left + 320 > viewW) left = viewW - 324;
            if (left < 8) left = 8;
            if (top + 200 > viewH) top = Math.max(8, rect.top - 202);
            tooltipEl.style.left = left + 'px';
            tooltipEl.style.top = top + 'px';
          });
          row.addEventListener('mouseleave', function () {
            hideTimer = setTimeout(function () { tooltipEl.style.display = 'none'; }, 150);
          });
        });
      })();
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
  }

  function renderMemoItemList(tabId) {
    const listEl = document.getElementById('memo-item-list');
    const completedEl = document.getElementById('memo-item-list-completed');
    if (!listEl) return;
    const items = sortMemoItemsCompletedLast(ensureMemoItems(tabId));
    listEl.innerHTML = '';
    if (completedEl) completedEl.innerHTML = '';
    items.forEach((m, index) => {
      const targetList = m.completed && completedEl ? completedEl : listEl;
      const li = document.createElement('li');
      li.className = 'memo-item-row' + (m.completed ? ' memo-item-completed' : '') + (m.important === 'blue' ? ' memo-item-important-blue' : m.important === 'red' ? ' memo-item-important-red' : '');
      li.draggable = true;
      li.dataset.itemId = String(m.id);
      li.dataset.index = String(index);
      li.dataset.tabId = String(tabId);
      const body = document.createElement('div');
      body.className = 'memo-item-body';
      const titleRow = document.createElement('div');
      titleRow.className = 'memo-item-title-row';
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
      const contentInput = document.createElement('textarea');
      contentInput.className = 'memo-item-content';
      contentInput.placeholder = '내용';
      contentInput.value = m.content || '';
      contentInput.rows = 2;
      contentInput.draggable = false;
      body.appendChild(titleRow);
      body.appendChild(contentInput);
      li.appendChild(body);
      targetList.appendChild(li);

      importantBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const current = (m.important === 'blue' || m.important === 'red') ? m.important : false;
        setMemoItemImportant(tabId, m.id, nextImportant(current));
      });
      li.addEventListener('dragstart', e => {
        if (e.target.closest('input, textarea, button, label')) return;
        state.dragMemoTabId = tabId;
        state.draggedMemoPayload = { tabId, itemId: m.id, index };
        state.memoDropTarget = null;
        state.memoToTodoDropTarget = null;
        li.classList.add('memo-item-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        e.dataTransfer.setData('application/json', JSON.stringify({ tabId, itemId: m.id, index }));
        e.dataTransfer.setDragImage(li, 0, 0);
      });
      li.addEventListener('dragend', () => {
        state.dragMemoTabId = null;
        state.draggedMemoPayload = null;
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
          it.content = contentInput.value;
          saveMemos();
        }
      }
      titleInput.addEventListener('change', saveMemoFields);
      titleInput.addEventListener('blur', saveMemoFields);
      titleInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
      });
      contentInput.addEventListener('change', saveMemoFields);
      contentInput.addEventListener('blur', saveMemoFields);
      contentInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
      });
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
    allRows.forEach(li => {
      li.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        updateMemoDropLine(e);
      });
      li.addEventListener('dragleave', () => {
        if (listBody) listBody.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
        else listEl.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
      });
      li.addEventListener('drop', e => {
        e.preventDefault();
        const t = state.memoDropTarget;
        const toLi = t ? t.el : e.target.closest('.memo-item-row');
        if (!toLi) return;
        const dropBottom = t ? !t.insertAbove : toLi.classList.contains('memo-item-over-bottom');
        if (listBody) listBody.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
        else listEl.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
        state.memoDropTarget = null;
        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const toIndex = parseInt(toLi.dataset.index, 10);
        const insertAt = dropBottom ? toIndex + 1 : toIndex;
        const toIndexAfterRemove = fromIndex < insertAt ? insertAt - 1 : insertAt;
        if (fromIndex === toIndexAfterRemove || fromIndex === toIndexAfterRemove + 1) return;
        reorderMemoItems(tabId, fromIndex, toIndexAfterRemove);
      });
    });
  }

  function deleteMemoItem(tabId, itemId) {
    if (tabId == null || itemId == null) return;
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
    if (sourceTabId === targetTabId) return;
    const srcItems = ensureMemoItems(sourceTabId).slice();
    const itemIndex = srcItems.findIndex(m => m.id === itemId);
    if (itemIndex < 0) return;
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
    const items = ensureMemoItems(tabId).slice();
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) return;
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    state.memos[tabId] = items;
    saveMemos();
    if (state.viewAllMemos) showMemoContent();
    else renderMemoItemList(tabId);
  }

  function addMemoItem(tabId) {
    const items = ensureMemoItems(tabId);
    const id = 'mi_' + Date.now();
    const completedItems = items.filter(m => m.completed);
    const incompleteItems = items.filter(m => !m.completed);
    state.memos[tabId] = [...incompleteItems, { id, title: '', completed: false, content: '', important: false }, ...completedItems];
    saveMemos();
    renderMemoItemList(tabId);
  }

  function openMemoTabModal(editId) {
    state.editingMemoTabId = editId || null;
    document.getElementById('memo-tab-modal-title').textContent = editId ? '분류명 수정' : '분류 추가';
    const input = document.getElementById('memo-tab-name');
    const pickerEl = document.getElementById('memo-color-picker');
    if (editId) {
      const t = state.memoTabs.find(x => x.id === editId);
      input.value = t ? t.name : '';
      state.editingMemoTabColorIndex = t && typeof t.colorIndex === 'number' ? t.colorIndex : 0;
    } else {
      input.value = '';
      state.editingMemoTabColorIndex = (state.memoTabs.length) % 10;
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
  }

  function openMemoReorderModal() {
    state.fromReorderModal = true;
    refreshMemoReorderList();
    document.getElementById('memo-reorder-modal').classList.add('show');
  }

  function openMemoColorModal(tabId) {
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
            if (t) { t.colorIndex = i; saveMemoTabs(); }
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
    listEl.innerHTML = '';
    state.memoTabs.forEach(tab => {
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
      li.appendChild(colorBtn);
      li.appendChild(delBtn);
      listEl.appendChild(li);

      nameSpan.addEventListener('blur', () => {
        const next = nameSpan.textContent.trim();
        if (next && next !== tab.name) {
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
        state.memoTabs = state.memoTabs.filter(t => t.id !== tab.id);
        state.deletedMemoTabs = state.deletedMemoTabs.concat([{ id: tab.id, name: tab.name, colorIndex: typeof tab.colorIndex === 'number' ? tab.colorIndex : 0 }]);
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

    const parent = listEl.parentNode;
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
          state.deletedMemoTabs = state.deletedMemoTabs.filter(t => t.id !== tab.id);
          state.memoTabs = state.memoTabs.concat([{ id: tab.id, name: tab.name, colorIndex: tab.colorIndex }]);
          saveMemoTabs();
          saveDeletedMemoTabs();
          refreshMemoReorderList();
          initMemoReorderDragDrop(listEl);
        });
        permDelBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          if (!confirm(`"${tab.name}" 분류를 완전히 삭제할까요? 메모도 모두 삭제됩니다.`)) return;
          state.deletedMemoTabs = state.deletedMemoTabs.filter(t => t.id !== tab.id);
          delete state.memos[tab.id];
          saveDeletedMemoTabs();
          saveMemos();
          refreshMemoReorderList();
          initMemoReorderDragDrop(listEl);
        });
      });
      deletedWrap.appendChild(deletedList);
      parent.insertBefore(deletedWrap, listEl.nextElementSibling);
    }

    initMemoReorderDragDrop(listEl);
  }

  function initMemoReorderDragDrop(listEl) {
    const items = listEl.querySelectorAll('.memo-reorder-item');
    items.forEach((item, index) => {
      item.addEventListener('dragstart', e => {
        if (e.target.closest('.memo-reorder-name') || e.target.closest('.memo-reorder-color-btn') || e.target.closest('.btn-icon')) return;
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
        const idOrder = Array.from(listEl.children).map(el => el.dataset.tabId);
        const [movedId] = idOrder.splice(fromIndex, 1);
        const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
        idOrder.splice(insertIndex, 0, movedId);
        state.memoTabs = idOrder.map(id => state.memoTabs.find(t => t.id === id)).filter(Boolean);
        saveMemoTabs();
        refreshMemoReorderList();
      });
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
      if (state.activeMemoTabId) addMemoItem(state.activeMemoTabId);
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

  document.getElementById('memo-tab-save').addEventListener('click', () => {
    const name = document.getElementById('memo-tab-name').value.trim();
    if (!name) { alert('분류 이름을 입력하세요.'); return; }
    const colorIndex = typeof state.editingMemoTabColorIndex === 'number' ? state.editingMemoTabColorIndex : 0;
    if (state.editingMemoTabId) {
      const t = state.memoTabs.find(x => x.id === state.editingMemoTabId);
      if (t) { t.name = name; t.colorIndex = colorIndex; }
    } else {
      state.memoTabs.push({ id: 'tab_' + Date.now(), name, colorIndex });
      state.activeMemoTabId = state.memoTabs[state.memoTabs.length - 1].id;
    }
    saveMemoTabs();
    closeMemoTabModal();
    if (state.fromReorderModal) {
      refreshMemoReorderList();
    } else {
      renderMemoTabs();
      showMemoContent();
    }
    renderCategoryManageList();
  });
  document.getElementById('memo-tab-cancel').addEventListener('click', () => {
    closeMemoTabModal();
    state.fromReorderModal = false;
  });


  document.getElementById('memo-item-add-zone').addEventListener('click', () => {
    if (state.activeMemoTabId) addMemoItem(state.activeMemoTabId);
  });

  const memoAddTopBtn = document.getElementById('memo-add-top-btn');
  if (memoAddTopBtn) memoAddTopBtn.addEventListener('click', () => {
    const tabId = state.activeMemoTabId || getPersonalTabId() || (state.memoTabs[0] && state.memoTabs[0].id);
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
    document.addEventListener('DOMContentLoaded', initCalendarMemoQuill);
  } else {
    initCalendarMemoQuill();
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

  const todoListEl = document.getElementById('todo-list');
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
  const todoViewCaptionEl = document.getElementById('todo-view-caption');

  function updateTodoViewCaption() {
    if (!calendarFullHeaderInline || !todoViewCaptionEl) return;
    if (state.viewMode === 'calendarFull') {
      calendarFullHeaderInline.style.display = 'flex';
      todoViewCaptionEl.style.display = 'none';
      const y = state.calendarFullYear, m = state.calendarFullMonth;
      const monthYearEl = document.getElementById('cal-full-month-year');
      if (monthYearEl) monthYearEl.textContent = y + '년 ' + (m + 1) + '월';
    } else {
      calendarFullHeaderInline.style.display = 'none';
      todoViewCaptionEl.style.display = '';
      if (state.selectedDate) {
        const d = state.selectedDate;
        const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
        const wd = weekdays[d.getDay()];
        const holidayName = getHolidayName(dateKey(d));
        const dateStr = d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + wd + ')   ';
        if (holidayName) {
          todoViewCaptionEl.innerHTML = '<span class="caption-date">' + dateStr + '</span><span class="caption-holiday">&lt;' + holidayName + '&gt;</span>';
          todoViewCaptionEl.classList.remove('caption-no-holiday');
        } else {
          todoViewCaptionEl.textContent = dateStr.trim();
          todoViewCaptionEl.classList.add('caption-no-holiday');
        }
        todoViewCaptionEl.classList.remove('caption-sat', 'caption-sun-holiday');
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
  if (viewToggleTodo) viewToggleTodo.classList.add('active');

  todoListEl.addEventListener('click', e => {
    const btn = e.target.closest('.section-add-btn');
    if (!btn) return;
    e.preventDefault();
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

  const calendarFullGrid = document.getElementById('calendar-full-grid');
  if (calendarFullGrid) {
    calendarFullGrid.addEventListener('click', (e) => {
      const addBtn = e.target.closest('.cal-full-add');
      if (addBtn) {
        e.preventDefault();
        const dkey = addBtn.dataset.date;
        if (dkey) {
          state.selectedDate = new Date(parseInt(dkey.slice(0, 4), 10), parseInt(dkey.slice(5, 7), 10) - 1, parseInt(dkey.slice(8, 10), 10));
          addTodoInline('morning');
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
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'cal-full-todo-title-input';
          input.value = fullTitle;
          input.dataset.id = li.dataset.id;
          titleSpan.replaceWith(input);
          input.focus();
          input.select();
          input.addEventListener('blur', () => {
            const id = input.dataset.id;
            const val = input.value.trim();
            if (id && val !== fullTitle) {
              updateTodoFields(id, { title: val || '제목 없음' });
              saveTodos();
              saveRepeating();
            }
            renderCalendarFull();
          });
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              input.blur();
            } else if (ev.key === 'Escape') {
              ev.preventDefault();
              renderCalendarFull();
            }
          });
        }
        return;
      }
      const li = e.target.closest('.cal-full-day-todo:not(.cal-full-more)');
      if (li && !e.target.closest('.cal-full-todo-del') && !e.target.closest('.cal-full-todo-icons') && !e.target.closest('.cal-full-todo-title')) {
        const id = li.dataset.id;
        const dkey = li.dataset.dateKey;
        if (id && dkey) {
          state.selectedDate = new Date(parseInt(dkey.slice(0, 4), 10), parseInt(dkey.slice(5, 7), 10) - 1, parseInt(dkey.slice(8, 10), 10));
          openTodoModal(id);
        }
      }
    });
  }

  loadQuote();
  loadTodos();
  loadRepeating();

  loadMemoTabs();
  loadMemos();

  /* 메모 처음에는 전체 메뉴가 모두 보이도록 */
  state.viewAllMemos = true;
  state.activeMemoTabId = null;
  const memoCol = document.querySelector('.memo-col');
  if (memoCol) memoCol.classList.add('memo-view-all');
  renderMemoTabs();
  showMemoContent();

  state.selectedDate = new Date();

  renderCalendar();
  renderTodos();
  updateTodoViewCaption();

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
      if (fromKey !== toKey) {
        const toIndexInSection = target.insertAbove ? target.index : (target.el != null ? target.index + 1 : target.index);
        moveTodoToDate(fromKey, payload.id, toKey, target.section || 'morning', toIndexInSection);
        return;
      }
      if (payload.section === target.section && payload.id === target.el?.dataset?.id) {
        if (target.insertAbove && target.index === payload.index) return;
        if (!target.insertAbove && target.index === payload.index - 1) return;
      }
      const toIndexInSection = target.insertAbove ? target.index : (target.el != null ? target.index + 1 : target.index);
      moveTodo(payload.key, payload.id, target.section, toIndexInSection);
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
      state.memoDropTarget = null;
      document.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
      document.querySelectorAll('.memo-all-block').forEach(b => b.classList.remove('memo-all-block-drop-over', 'memo-all-block-drop-line'));
      document.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
      document.querySelectorAll('.todo-section').forEach(s => s.classList.remove('todo-section-drop-zone'));
      document.querySelectorAll('.cal-full-day').forEach(el => el.classList.remove('cal-full-day-drag-over'));
    }
  }, true);

  todoListEl.addEventListener('dragstart', e => {
    if (e.target.closest('input, button')) return;
    const li = e.target.closest('.todo-item');
    if (!li || li.classList.contains('todo-item-completed')) return;
    const key = state.selectedDate ? dateKey(state.selectedDate) : null;
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

  todoListEl.addEventListener('dragend', () => {
    if (state.draggedTodoPayload) {
      document.querySelectorAll('.todo-item').forEach(el => {
        el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
      });
      document.querySelectorAll('.memo-all-block').forEach(b => b.classList.remove('memo-all-block-drop-over', 'memo-all-block-drop-line'));
      document.querySelectorAll('.memo-item-row').forEach(el => el.classList.remove('memo-item-over-top', 'memo-item-over-bottom'));
      state.draggedTodoPayload = null;
      state.todoDropTarget = null;
      state.todoToMemoDropTarget = null;
    }
  });
})();
