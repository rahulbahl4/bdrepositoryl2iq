/* Crewplan — a lightweight team resource scheduler.
 * Plain JS, no dependencies. Data is stored in localStorage. */
'use strict';
(() => {
  // ---------------------------------------------------------------- constants
  const STORE_KEY = 'crewplan:data:v1';
  const UI_KEY = 'crewplan:ui:v1';
  const COLORS = ['#3b6cf6', '#00a389', '#f2994a', '#e05252', '#9b51e0', '#2d9cdb', '#27ae60', '#c99410', '#d94f9c', '#5b6b7f'];
  const AVATAR_COLORS = ['#5b7cfa', '#13a383', '#e48a3c', '#c85a8e', '#7b61d9', '#2f8fc9', '#4c9a50', '#b8862a'];
  const LANE = 30, PAD = 7, LOAD_SPACE = 10, MIN_ROW = 52;
  const ZOOMS = [{ label: 'Days', w: 64 }, { label: 'Weeks', w: 34 }, { label: 'Months', w: 16 }];
  const DAY = 86400000;

  // ---------------------------------------------------------------- dates (UTC, ISO "YYYY-MM-DD")
  const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fmt = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => fmt(new Date(toDate(s).getTime() + n * DAY));
  const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
  const dow = (s) => toDate(s).getUTCDay();
  const isWeekend = (s) => { const w = dow(s); return w === 0 || w === 6; };
  const startOfWeek = (s) => addDays(s, -((dow(s) + 6) % 7));
  const todayStr = () => { const n = new Date(); return fmt(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))); };
  const monthStart = (s) => s.slice(0, 8) + '01';
  const addMonths = (s, n) => { const d = toDate(monthStart(s)); return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))); };
  const monthEnd = (s) => addDays(addMonths(s, 1), -1);
  const minS = (a, b) => (a < b ? a : b);
  const maxS = (a, b) => (a > b ? a : b);
  const fmtDate = (s, opts) => toDate(s).toLocaleDateString('en', { timeZone: 'UTC', ...opts });
  const shortDate = (s) => fmtDate(s, { month: 'short', day: 'numeric' });
  const rangeLabel = (s, e) => {
    if (s === e) return shortDate(s);
    const sameYear = s.slice(0, 4) === e.slice(0, 4);
    return `${shortDate(s)} – ${fmtDate(e, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };
  function workdays(s, e) {
    if (s > e) return 0;
    let n = 0;
    for (let d = s; d <= e; d = addDays(d, 1)) if (!isWeekend(d)) n++;
    return n;
  }

  // ---------------------------------------------------------------- helpers
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const round1 = (n) => Math.round(n * 10) / 10;
  const hrs = (n) => `${round1(n)}h`;
  const pct = (n) => `${Math.round(n)}%`;
  const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const hashColor = (str) => { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0; return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]; };

  // ---------------------------------------------------------------- state
  let state = loadData() || seed();
  const ui = Object.assign({
    view: 'schedule',
    viewStart: addDays(startOfWeek(todayStr()), -7),
    weeks: 12,
    zoom: 0,
    search: '',
    projectFilter: '',
    groupBy: 'discipline', // 'none' | 'discipline' | 'project'
    reportStart: monthStart(todayStr()),
    reportEnd: monthEnd(todayStr()),
  }, loadUI());
  ui.viewStart = startOfWeek(ui.viewStart);
  if (!['none', 'discipline', 'project'].includes(ui.groupBy)) ui.groupBy = ui.groupByDept === false ? 'none' : 'discipline';
  delete ui.groupByDept;
  normalize(state);
  function normalize(d) {
    if (!Array.isArray(d.holidays)) d.holidays = [];
    if (!Array.isArray(d.shutdowns)) d.shutdowns = [];
    if (!Array.isArray(d.disciplines)) d.disciplines = [];
    // Older data stored a free-text "dept" on each person; turn those into disciplines.
    for (const person of d.people) {
      if ('dept' in person) {
        const name = (person.dept || '').trim();
        if (name && !person.disciplineId) {
          let disc = d.disciplines.find((x) => x.name.toLowerCase() === name.toLowerCase());
          if (!disc) { disc = { id: uid(), name }; d.disciplines.push(disc); }
          person.disciplineId = disc.id;
        }
        delete person.dept;
      }
      if (person.disciplineId && !d.disciplines.some((x) => x.id === person.disciplineId)) person.disciplineId = '';
    }
    for (const pr of d.projects) {
      if (!Array.isArray(pr.phases)) pr.phases = [];
      if (!(pr.budgetHours > 0)) pr.budgetHours = null;
      pr.start = pr.start || '';
      pr.end = pr.end || '';
    }
    return d;
  }
  const undoStack = [], redoStack = [];

  function loadData() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY));
      return validData(d) ? d : null;
    } catch { return null; }
  }
  function validData(d) {
    return d && Array.isArray(d.people) && Array.isArray(d.projects) && Array.isArray(d.allocations);
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ } }
  function loadUI() { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; } }
  function saveUI() {
    const { view, zoom, groupBy, viewStart } = ui;
    try { localStorage.setItem(UI_KEY, JSON.stringify({ view, zoom, groupBy, viewStart })); } catch { /* ignore */ }
  }
  function commit(mutator, { rerender = true } = {}) {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    mutator(state);
    save();
    if (rerender) render();
    updateUndoButtons();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(state));
    state = JSON.parse(undoStack.pop());
    save(); render(); toast('Undone');
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(state));
    state = JSON.parse(redoStack.pop());
    save(); render(); toast('Redone');
  }
  function updateUndoButtons() {
    $('#undoBtn').disabled = !undoStack.length;
    $('#redoBtn').disabled = !redoStack.length;
  }

  const findPerson = (id) => state.people.find((p) => p.id === id);
  const findProject = (id) => state.projects.find((p) => p.id === id);
  const findAlloc = (id) => state.allocations.find((a) => a.id === id);

  // ---------------------------------------------------------------- sample data
  function seed() {
    const disciplines = ['Design', 'Engineering', 'Project Management', 'QA', 'Marketing'].map((name) => ({ id: uid(), name }));
    const D = (name) => disciplines.find((x) => x.name === name).id;
    const P = (name, role, disc, region, capacity = 8) => ({ id: uid(), name, role, disciplineId: D(disc), region, capacity });
    const people = [
      P('Ava Thompson', 'Design Lead', 'Design', 'NSW'),
      P('Liam Carter', 'Product Designer', 'Design', 'VIC'),
      P('Noah Patel', 'Frontend Engineer', 'Engineering', 'VIC'),
      P('Mia Chen', 'Backend Engineer', 'Engineering', 'NSW'),
      P('Ethan Brooks', 'Full-stack Engineer', 'Engineering', 'QLD', 6),
      P('Lucas Kim', 'QA Engineer', 'QA', 'VIC'),
      P('Sofia Rossi', 'Project Manager', 'Project Management', 'NSW'),
      P('Zoe Martin', 'Content Strategist', 'Marketing', 'QLD', 4),
    ];
    const w = startOfWeek(todayStr());
    const Ph = (name, s, e) => ({ id: uid(), name, start: addDays(w, s), end: addDays(w, e) });
    const Pr = (name, client, color, billable = true, extra = {}) => ({
      id: uid(), name, client, color, billable, archived: false, start: '', end: '', budgetHours: null, phases: [], ...extra,
    });
    const projects = [
      Pr('Website Redesign', 'Northwind', COLORS[0], true, {
        start: addDays(w, -7), end: addDays(w, 41), budgetHours: 900,
        phases: [Ph('Discovery', -7, 4), Ph('Design', 0, 18), Ph('Build', 7, 32), Ph('Launch', 35, 41)],
      }),
      Pr('Mobile App v2', 'Globex', COLORS[1], true, {
        start: addDays(w, -7), end: addDays(w, 60), budgetHours: 1400,
        phases: [Ph('Alpha', -7, 18), Ph('Beta', 21, 46), Ph('Release', 49, 60)],
      }),
      Pr('Brand Refresh', 'Initech', COLORS[2], true, { start: addDays(w, 7), end: addDays(w, 32), budgetHours: 200, phases: [Ph('Concepts', 7, 18), Ph('Refinement', 21, 32)] }),
      Pr('Data Platform', 'Umbrella', COLORS[4], true, { budgetHours: 600 }),
      Pr('Launch Campaign', 'Northwind', COLORS[3]),
      Pr('Internal Tools', 'In-house', COLORS[9], false),
    ];
    const A = (pi, pj, s, len, h, extra = {}) => ({
      id: uid(), type: 'task', personId: people[pi].id, projectId: projects[pj].id,
      start: addDays(w, s), end: addDays(w, s + len - 1), hoursPerDay: h, notes: '', tentative: false, ...extra,
    });
    const T = (pi, s, len, notes = 'Vacation') => ({
      id: uid(), type: 'timeoff', personId: people[pi].id, projectId: null,
      start: addDays(w, s), end: addDays(w, s + len - 1), hoursPerDay: people[pi].capacity, notes, tentative: false,
    });
    const allocations = [
      A(0, 0, -7, 19, 6, { notes: 'Design system + key pages' }), A(0, 2, 14, 12, 8), A(0, 5, -7, 12, 2),
      A(1, 0, -7, 12, 8), A(1, 2, 7, 19, 6), A(1, 4, 28, 12, 8, { tentative: true }),
      A(2, 0, 0, 26, 8, { notes: 'Build marketing pages' }), A(2, 1, 28, 19, 8),
      A(3, 3, -7, 33, 6), A(3, 1, 0, 12, 4),
      A(4, 1, -7, 26, 6), A(4, 5, 21, 12, 3),
      A(5, 0, 14, 12, 4), A(5, 1, 7, 26, 4), A(5, 3, 35, 12, 8, { tentative: true }),
      A(6, 0, -7, 47, 2), A(6, 1, -7, 47, 2), A(6, 3, -7, 47, 2),
      A(7, 4, 0, 19, 4), A(7, 2, 21, 12, 2),
      T(2, 30, 5), T(6, 14, 3, 'Conference'), T(4, 7, 1, 'Sick day'), T(0, 42, 5),
    ];
    // Example holidays: a few fixed-date ones that repeat yearly, plus a state-only one
    // (first Tuesday of November, Victoria) so the regional behaviour is visible.
    const year = todayStr().slice(0, 4);
    const nov1 = `${year}-11-01`;
    const firstTueNov = addDays(nov1, (2 - dow(nov1) + 7) % 7);
    const H = (name, date, region = '', recurring = false) => ({ id: uid(), name, date, region, recurring });
    const holidays = [
      H("New Year's Day", `${year}-01-01`, '', true),
      H('Christmas Day', `${year}-12-25`, '', true),
      H('Boxing Day', `${year}-12-26`, '', true),
      H('Melbourne Cup Day', firstTueNov, 'VIC'),
      H('Sample QLD holiday', addDays(w, 23), 'QLD'),
    ];
    const shutdowns = [
      { id: uid(), name: 'End-of-year shutdown', start: `${year}-12-24`, end: `${+year + 1}-01-02`, region: '' },
    ];
    return { people, projects, allocations, holidays, shutdowns, disciplines };
  }

  // ---------------------------------------------------------------- calculations
  function hoursInRange(a, s, e) {
    const st = maxS(a.start, s), en = minS(a.end, e);
    return st > en ? 0 : workdays(st, en) * (+a.hoursPerDay || 0);
  }
  // ----- public holidays & shutdowns
  // A holiday or shutdown with region '' applies to everyone; otherwise only to people in that region.
  // They remove capacity but never block scheduling: work placed on them still counts.
  const appliesTo = (ev, person) => !ev.region || (person && ev.region === person.region);
  function closuresOn(day) {
    const out = [];
    for (const h of state.holidays) {
      if (h.date === day || (h.recurring && h.date.slice(5) === day.slice(5) && h.date <= day)) out.push({ kind: 'holiday', name: h.name, region: h.region });
    }
    for (const sd of state.shutdowns) if (day >= sd.start && day <= sd.end) out.push({ kind: 'shutdown', name: sd.name, region: sd.region });
    return out;
  }
  const closureFor = (person, day) => closuresOn(day).find((c) => appliesTo(c, person)) || null;
  const closureLabel = (c) => `${c.kind === 'shutdown' ? 'Shutdown' : 'Public holiday'}: ${c.name}${c.region ? ` (${c.region})` : ''}`;
  // ----- disciplines & project budgets
  const findDiscipline = (id) => state.disciplines.find((x) => x.id === id);
  const discName = (p) => (findDiscipline(p.disciplineId) || {}).name || '';
  const sortedDisciplines = () => [...state.disciplines].sort((a, b) => a.name.localeCompare(b.name));
  const projectUsed = (pr) => state.allocations.reduce((sum, a) => sum + (a.projectId === pr.id && a.type === 'task' ? hoursInRange(a, a.start, a.end) : 0), 0);
  const outsideProject = (a, pr) => !!pr && a.type === 'task' && ((pr.start && a.start < pr.start) || (pr.end && a.end > pr.end));
  const projectDatesLabel = (pr) => (pr.start && pr.end ? rangeLabel(pr.start, pr.end) : pr.start ? `From ${shortDate(pr.start)}` : pr.end ? `Until ${shortDate(pr.end)}` : '');
  function budgetMeter(pr, used = projectUsed(pr)) {
    if (!pr.budgetHours) return `<span class="hint">${hrs(used)} · no budget</span>`;
    const u = (used / pr.budgetHours) * 100;
    return `<div class="hbar" title="${hrs(used)} scheduled of ${hrs(pr.budgetHours)} budget"><div class="meter ${u > 100.5 ? 'over' : u >= 99.5 ? 'full' : ''}"><i style="width:${Math.min(100, u)}%"></i></div>`
      + `<span class="${u > 100.5 ? 'over-text' : ''}">${round1(used)} / ${round1(pr.budgetHours)}h</span></div>`;
  }

  // All Australian states and territories are always offered; any other regions in use are added after them.
  const AU_REGIONS = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];
  function allRegions() {
    const used = [...state.people.map((p) => p.region), ...state.holidays.map((h) => h.region), ...state.shutdowns.map((x) => x.region)].filter(Boolean);
    return [...AU_REGIONS, ...[...new Set(used)].filter((r) => !AU_REGIONS.includes(r)).sort()];
  }
  const regionSelect = (value, emptyLabel) => `<select name="region" data-region-select data-prev="${esc(value || '')}">
      <option value="">${esc(emptyLabel)}</option>
      ${allRegions().map((r) => `<option value="${esc(r)}" ${r === value ? 'selected' : ''}>${esc(r)}</option>`).join('')}
      <option value="__other">Other…</option>
    </select>`;

  function personStats(p, s, e) {
    let capacity = 0, scheduled = 0, billable = 0, timeoff = 0, tentative = 0, closedHours = 0, closedWork = 0, closedDays = 0;
    const cap = +p.capacity || 0;
    const allocs = state.allocations.filter((a) => a.personId === p.id && a.end >= s && a.start <= e);
    for (let d = s; d <= e; d = addDays(d, 1)) {
      if (isWeekend(d)) continue;
      const closed = !!closureFor(p, d);
      let off = 0;
      for (const a of allocs) {
        if (d < a.start || d > a.end) continue;
        const h = +a.hoursPerDay || 0;
        if (a.type === 'timeoff') { if (!closed) off += h; continue; }
        scheduled += h;
        if (a.tentative) tentative += h;
        if (closed) closedWork += h;
        const pr = findProject(a.projectId);
        if (pr && pr.billable) billable += h;
      }
      if (closed) { closedHours += cap; closedDays++; } else { timeoff += off; capacity += Math.max(0, cap - off); }
    }
    const util = capacity ? (scheduled / capacity) * 100 : (scheduled ? 999 : 0);
    return { capacity, scheduled, billable, timeoff, tentative, closedHours, closedWork, closedDays, util, available: capacity - scheduled };
  }
  function assignLanes(list) {
    const sorted = [...list].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? 1 : -1));
    const laneEnds = [];
    const lanes = new Map();
    for (const a of sorted) {
      let lane = laneEnds.findIndex((end) => end < a.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(a.end); } else laneEnds[lane] = a.end;
      lanes.set(a.id, lane);
    }
    return { lanes, count: laneEnds.length };
  }

  // ---------------------------------------------------------------- rendering
  const main = $('#main');
  const toolbar = $('#toolbar');

  function render() {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === ui.view));
    if (ui.view === 'schedule') renderSchedule();
    else if (ui.view === 'projects') renderProjects();
    else if (ui.view === 'people') renderPeople();
    else if (ui.view === 'holidays') renderHolidays();
    else renderReport();
    updateUndoButtons();
    saveUI();
  }

  // ----- schedule
  function visiblePeople() {
    const q = ui.search.trim().toLowerCase();
    let list = state.people.filter((p) => !q || `${p.name} ${p.role} ${discName(p)}`.toLowerCase().includes(q));
    if (ui.projectFilter) {
      const ids = new Set(state.allocations.filter((a) => a.projectId === ui.projectFilter).map((a) => a.personId));
      list = list.filter((p) => ids.has(p.id));
    }
    return list;
  }

  function renderScheduleToolbar(rangeEnd) {
    const projOpts = state.projects.filter((p) => !p.archived || p.id === ui.projectFilter)
      .map((p) => `<option value="${p.id}" ${p.id === ui.projectFilter ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    toolbar.innerHTML = `
      <button class="btn primary" data-act="new-alloc">+ Schedule</button>
      <div class="btn-group">
        <button class="btn" data-act="prev" title="Earlier">&#8249;</button>
        <button class="btn" data-act="today">Today</button>
        <button class="btn" data-act="next" title="Later">&#8250;</button>
      </div>
      <span class="range-label">${rangeLabel(ui.viewStart, rangeEnd)}</span>
      <div class="btn-group">${ZOOMS.map((z, i) => `<button class="btn ${i === ui.zoom ? 'on' : ''}" data-zoom="${i}">${z.label}</button>`).join('')}</div>
      <span class="spacer"></span>
      <input type="search" id="searchInput" placeholder="Search people…" value="${esc(ui.search)}">
      <select id="projectFilter"><option value="">All projects</option>${projOpts}</select>
      <label class="toggle">Group by <select id="groupBy">
        ${[['none', 'None'], ['discipline', 'Discipline'], ['project', 'Project']].map(([v, l]) => `<option value="${v}" ${ui.groupBy === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>`;
  }

  function renderSchedule() {
    const dayW = ZOOMS[ui.zoom].w;
    const days = ui.weeks * 7;
    const vs = ui.viewStart;
    const rangeEnd = addDays(vs, days - 1);
    const dayList = Array.from({ length: days }, (_, i) => addDays(vs, i));
    const today = todayStr();
    const todayIdx = diffDays(vs, today);
    const width = days * dayW;

    // keep focus/caret in search when re-rendering toolbar
    const searchFocused = document.activeElement && document.activeElement.id === 'searchInput';
    renderScheduleToolbar(rangeEnd);
    if (searchFocused) { const s = $('#searchInput'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }

    let sched = $('#schedule');
    if (!sched) {
      main.className = 'no-scroll';
      main.innerHTML = '<div class="schedule" id="schedule"></div>';
      sched = $('#schedule');
    }
    const keepLeft = sched.scrollLeft, keepTop = sched.scrollTop;

    // header
    let months = '';
    for (let i = 0; i < days;) {
      const m = dayList[i].slice(0, 7);
      let j = i;
      while (j < days && dayList[j].slice(0, 7) === m) j++;
      months += `<div class="hm" style="width:${(j - i) * dayW}px"><span>${(j - i) * dayW > 60 ? fmtDate(dayList[i], { month: 'long', year: 'numeric' }) : ''}</span></div>`;
      i = j;
    }
    const dayCells = dayList.map((d, i) => {
      const w = dow(d);
      const cl = closuresOn(d);
      const cls = ['hd', isWeekend(d) ? 'we' : '', w === 1 ? 'mon' : '', d === today ? 'today' : '',
        cl.length ? (cl.some((c) => c.kind === 'shutdown') ? 'has-shut' : 'has-hol') : ''].join(' ');
      const tip = fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' }) + cl.map((c) => `\n${closureLabel(c)}`).join('');
      let inner = '';
      const num = +d.slice(8);
      if (dayW >= 40) inner = `<span>${fmtDate(d, { weekday: 'short' })}</span><b>${num}</b>`;
      else if (dayW >= 28) inner = `<span>${fmtDate(d, { weekday: 'narrow' })}</span><b>${num}</b>`;
      else if (w === 1) inner = `<b style="margin-left:${dayW * 3}px">${num}</b>`;
      return `<div class="${cls}" style="width:${dayW}px" title="${esc(tip)}" data-i="${i}">${inner}</div>`;
    }).join('');

    const people = visiblePeople();
    const bgStyle = `background-image: repeating-linear-gradient(to right, var(--gridline) 0 1px, transparent 1px ${dayW}px), linear-gradient(to right, transparent 0 ${5 * dayW}px, var(--weekend) ${5 * dayW}px ${7 * dayW}px); background-size: ${dayW}px 100%, ${7 * dayW}px 100%;`;
    const ctx = { dayW, days, vs, rangeEnd, dayList, todayIdx, width, bgStyle };
    let rows = '';
    if (ui.groupBy === 'project') rows = renderProjectGroups(people, ctx);
    else {
      const groups = new Map();
      for (const p of people) {
        const key = ui.groupBy === 'discipline' ? (discName(p) || 'No discipline') : '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
      }
      const keys = [...groups.keys()].sort((a, b) => (a === 'No discipline') - (b === 'No discipline') || a.localeCompare(b));
      for (const key of keys) {
        const members = groups.get(key);
        if (ui.groupBy === 'discipline') rows += `<div class="group"><div class="group-side">${esc(key)}<span>${members.length}</span></div><div style="width:${width}px"></div></div>`;
        for (const p of members) rows += renderRow(p, ctx);
      }
    }
    if (!state.people.length) {
      rows = `<div class="empty-state"><h3>No people yet</h3><p>Add your team to start scheduling.</p><button class="btn primary" data-act="new-person">+ Add person</button></div>`;
    } else if (!people.length) {
      rows = `<div class="empty-state"><h3>No matches</h3><p>No one matches the current filters.</p></div>`;
    }


    sched.innerHTML = `
      <div class="grid" style="width:calc(var(--side) + ${width}px)">
        <div class="ghead">
          <div class="corner">${people.length} ${people.length === 1 ? 'person' : 'people'} · utilization</div>
          <div class="timehead" style="width:${width}px">
            <div class="hm-row">${months}</div>
            <div class="hd-row">${dayCells}</div>
          </div>
        </div>
        <div class="rows">${rows}</div>
      </div>`;
    sched.scrollLeft = keepLeft;
    sched.scrollTop = keepTop;
  }

  // Project grouping: a heading per project (dates, phases, budget), then each person booked on it.
  function renderProjectGroups(people, ctx) {
    const { vs, rangeEnd, width } = ctx;
    const inView = (a) => a.end >= vs && a.start <= rangeEnd;
    const visible = new Set(people.map((p) => p.id));
    const searching = !!ui.search.trim();
    const projects = state.projects.filter((pr) => {
      if (ui.projectFilter && pr.id !== ui.projectFilter) return false;
      const booked = state.allocations.some((a) => a.projectId === pr.id && inView(a));
      const datesInView = !pr.archived && (pr.start || pr.end) && (pr.end || '9999') >= vs && (pr.start || '0000') <= rangeEnd;
      return booked || datesInView;
    }).sort((a, b) => a.name.localeCompare(b.name));
    let out = '';
    for (const pr of projects) {
      const members = people.filter((p) => state.allocations.some((a) => a.personId === p.id && a.projectId === pr.id && inView(a)));
      if (searching && !members.length) continue;
      out += renderProjectHeader(pr, members.length, ctx);
      for (const p of members) out += renderRow(p, ctx, pr.id);
    }
    if (!ui.projectFilter) {
      const free = people.filter((p) => visible.has(p.id) && !state.allocations.some((a) => a.personId === p.id && a.type === 'task' && inView(a)));
      if (free.length) {
        out += `<div class="group"><div class="group-side">Not on a project in this view<span>${free.length}</span></div><div style="width:${width}px"></div></div>`;
        for (const p of free) out += renderRow(p, ctx, '');
      }
    }
    return out || '<div class="empty-state"><h3>No projects in view</h3><p>Nothing is booked in these dates.</p></div>';
  }

  function renderProjectHeader(pr, count, ctx) {
    const { width, bgStyle, todayIdx, days, dayW } = ctx;
    const band = (pr.start || pr.end) ? barGeom(pr.start || ctx.vs, pr.end || ctx.rangeEnd, ctx) : null;
    const { lanes, count: laneCount } = assignLanes(pr.phases);
    const height = 34 + Math.max(0, laneCount) * 22;
    const phases = pr.phases.map((ph) => {
      const g = barGeom(ph.start, ph.end, ctx);
      if (!g) return '';
      const outside = (pr.start && ph.start < pr.start) || (pr.end && ph.end > pr.end);
      return `<div class="phase ${outside ? 'outside' : ''}" style="left:${g.left}px;width:${g.width}px;top:${32 + lanes.get(ph.id) * 22}px;--pc:${pr.color}"
        title="${esc(`Phase: ${ph.name}\n${rangeLabel(ph.start, ph.end)} · ${workdays(ph.start, ph.end)} working days${outside ? '\nOutside the project dates' : ''}`)}">${esc(ph.name)}</div>`;
    }).join('');
    const today = todayIdx >= 0 && todayIdx < days ? `<div class="today-col" style="left:${todayIdx * dayW}px;width:${dayW}px"></div>` : '';
    return `
      <div class="group proj-group">
        <div class="group-side proj-side" data-project-edit="${pr.id}" title="Edit ${esc(pr.name)}">
          <div class="proj-name"><span class="dot" style="background:${pr.color}"></span>${esc(pr.name)}<span>${count}</span></div>
          <div class="proj-meta">${esc(pr.client || '')}${pr.client && projectDatesLabel(pr) ? ' · ' : ''}${projectDatesLabel(pr)}</div>
          ${budgetMeter(pr)}
        </div>
        <div class="ptrack" style="width:${width}px;height:${height}px;${bgStyle}">
          ${today}
          ${band ? `<div class="proj-band ${band.clipL ? 'clip-l' : ''} ${band.clipR ? 'clip-r' : ''}" style="left:${band.left}px;width:${band.width}px;--pc:${pr.color}" title="${esc(`${pr.name}: ${projectDatesLabel(pr)}`)}">${esc(projectDatesLabel(pr))}</div>` : '<div class="proj-nodates">No project dates set</div>'}
          ${phases}
        </div>
      </div>`;
  }

  function renderRow(p, { dayW, days, vs, rangeEnd, dayList, todayIdx, width, bgStyle }, projectId) {
    // Load and capacity always use all of a person's bookings; when shown under a project, only
    // that project's bookings (plus time off) are drawn.
    const allAllocs = state.allocations.filter((a) => a.personId === p.id && a.end >= vs && a.start <= rangeEnd);
    const scoped = projectId === undefined ? allAllocs : allAllocs.filter((a) => a.type === 'timeoff' || a.projectId === projectId);
    const { lanes, count } = assignLanes(scoped);
    const height = Math.max(MIN_ROW, PAD * 2 + LOAD_SPACE + Math.max(1, count) * LANE - 4);

    // daily load
    const sched = new Array(days).fill(0), off = new Array(days).fill(0);
    for (const a of allAllocs) {
      const s = maxS(a.start, vs), e = minS(a.end, rangeEnd);
      for (let i = diffDays(vs, s), n = diffDays(vs, e); i <= n; i++) {
        if (isWeekend(dayList[i])) continue;
        if (a.type === 'timeoff') off[i] += +a.hoursPerDay || 0; else sched[i] += +a.hoursPerDay || 0;
      }
    }
    let loadHtml = '';
    for (let i = 0; i < days; i++) {
      if (isWeekend(dayList[i])) continue;
      const h = sched[i];
      const dayName = fmtDate(dayList[i], { weekday: 'short', month: 'short', day: 'numeric' });
      const closure = closureFor(p, dayList[i]);
      if (closure) {
        // Non-working day for this person: shade it, but still allow (and count) any work placed here.
        loadHtml += `<div class="closed-col ${closure.kind}" style="left:${i * dayW}px;width:${dayW}px"></div>`;
        if (h > 0) loadHtml += `<div class="load hol" style="left:${i * dayW + 3}px;width:${dayW - 6}px"></div>`;
        const t = `${dayName}: ${closureLabel(closure)}${h > 0 ? ` · ${hrs(h)} scheduled anyway` : ''}`;
        loadHtml += `<div class="load-hit" style="left:${i * dayW}px;width:${dayW}px" title="${esc(t)}"></div>`;
        continue;
      }
      const cap = Math.max(0, (+p.capacity || 0) - off[i]);
      const title = `${dayName}: ${hrs(h)} scheduled of ${hrs(cap)} available`;
      if (h > cap + 1e-9) {
        loadHtml += `<div class="over-col" style="left:${i * dayW}px;width:${dayW}px"></div>`;
        loadHtml += `<div class="load over" style="left:${i * dayW + 3}px;width:${dayW - 6}px"></div>`;
      } else if (h > 0) {
        const ratio = cap ? h / cap : 1;
        loadHtml += `<div class="load ${ratio >= 1 - 1e-9 ? 'full' : 'under'}" style="left:${i * dayW + 3}px;width:${Math.max(2, (dayW - 6) * ratio)}px"></div>`;
      }
      loadHtml += `<div class="load-hit" style="left:${i * dayW}px;width:${dayW}px" title="${esc(title)}"></div>`;
    }

    const bars = scoped.map((a) => renderBar(a, lanes.get(a.id), { dayW, vs, rangeEnd })).join('');
    const today = todayIdx >= 0 && todayIdx < days ? `<div class="today-col" style="left:${todayIdx * dayW}px;width:${dayW}px"></div>` : '';

    const st = personStats(p, vs, rangeEnd);
    const meterCls = st.util > 100.5 ? 'over' : st.util >= 99.5 ? 'full' : '';
    const color = p.color || hashColor(p.name);
    return `
      <div class="row" data-person="${p.id}">
        <div class="side" data-person-edit="${p.id}" title="Edit ${esc(p.name)}">
          <div class="avatar" style="background:${color}">${esc(initials(p.name))}</div>
          <div class="who">
            <div class="name">${esc(p.name)}</div>
            <div class="role">${esc(p.role || discName(p))}${p.role || discName(p) ? ' · ' : ''}${p.region ? `${esc(p.region)} · ` : ''}${round1(p.capacity)}h/day</div>
            <div class="util" title="${hrs(st.scheduled)} scheduled of ${hrs(st.capacity)} capacity in view">
              <div class="meter ${meterCls}"><i style="width:${Math.min(100, st.util)}%"></i></div>
              <b class="${meterCls === 'over' ? 'over' : ''}">${pct(Math.min(st.util, 999))}</b>
            </div>
          </div>
        </div>
        <div class="track" data-person="${p.id}"${projectId !== undefined ? ` data-project="${projectId}"` : ''} style="width:${width}px;height:${height}px;${bgStyle}">
          ${today}${loadHtml}${bars}
        </div>
      </div>`;
  }

  function barGeom(start, end, { dayW, vs, rangeEnd }) {
    const s = maxS(start, vs), e = minS(end, rangeEnd);
    if (s > e) return null;
    return { left: diffDays(vs, s) * dayW + 2, width: (diffDays(s, e) + 1) * dayW - 4, clipL: start < vs, clipR: end > rangeEnd };
  }

  function renderBar(a, lane, ctx) {
    const g = barGeom(a.start, a.end, ctx);
    if (!g) return '';
    const isOff = a.type === 'timeoff';
    const pr = isOff ? null : findProject(a.projectId);
    const color = pr ? pr.color : '#888';
    const title = isOff ? (a.notes || 'Time off') : (pr ? pr.name : 'Unknown project');
    const total = hoursInRange(a, a.start, a.end);
    const sub = isOff ? 'Time off' : `${round1(a.hoursPerDay)}h/d${g.width > 150 ? ` · ${hrs(total)}` : ''}`;
    const dim = ui.projectFilter && a.projectId !== ui.projectFilter;
    const outside = outsideProject(a, pr);
    const cls = ['bar', isOff ? 'timeoff' : '', a.tentative ? 'tentative' : '', g.clipL ? 'clip-l' : '', g.clipR ? 'clip-r' : '', dim ? 'dim' : '', outside ? 'outside' : ''].join(' ');
    const tip = `${title}${pr && pr.client ? ` (${pr.client})` : ''}\n${rangeLabel(a.start, a.end)} · ${round1(a.hoursPerDay)}h/day · ${hrs(total)} total${a.tentative ? '\nTentative' : ''}`
      + `${outside ? `\n⚠ Outside project dates (${projectDatesLabel(pr)})` : ''}${a.notes && !isOff ? `\n${a.notes}` : ''}`;
    return `<div class="${cls}" data-id="${a.id}" title="${esc(tip)}"
      style="left:${g.left}px;width:${g.width}px;top:${PAD + lane * LANE}px;${isOff ? '' : `background-color:${color}`}">
      ${outside ? '<span class="warn-ic" aria-label="Outside project dates">!</span>' : ''}<span class="bar-title">${esc(title)}</span><span class="bar-sub">${esc(sub)}</span>
      <span class="h h-l"></span><span class="h h-r"></span>
    </div>`;
  }

  // ----- projects
  function renderProjects() {
    $('#schedule')?.remove();
    main.className = '';
    toolbar.innerHTML = `<button class="btn primary" data-act="new-project">+ New project</button>
      <span class="spacer"></span>
      <label class="toggle"><input type="checkbox" id="showArchived" ${ui.showArchived ? 'checked' : ''}> Show archived</label>`;
    const today = todayStr();
    const rows = state.projects.filter((p) => ui.showArchived || !p.archived).map((p) => {
      const allocs = state.allocations.filter((a) => a.projectId === p.id);
      const total = allocs.reduce((s, a) => s + hoursInRange(a, a.start, a.end), 0);
      const upcoming = allocs.reduce((s, a) => s + hoursInRange(a, today, a.end), 0);
      const people = new Set(allocs.map((a) => a.personId)).size;
      const outsideN = allocs.filter((a) => outsideProject(a, p)).length;
      return `<tr>
        <td><span class="dot" style="background:${p.color}"></span><b>${esc(p.name)}</b> ${p.archived ? '<span class="tag">Archived</span>' : ''}</td>
        <td>${esc(p.client || '—')}</td>
        <td>${p.billable ? '<span class="tag ok">Billable</span>' : '<span class="tag">Non-billable</span>'}</td>
        <td class="num">${people}</td>
        <td>${projectDatesLabel(p) || '<span class="hint">Not set</span>'}${outsideN ? ` <span class="tag warn" title="Bookings outside the project dates">${outsideN} outside</span>` : ''}</td>
        <td>${p.phases.length ? `<span title="${esc(p.phases.map((ph) => `${ph.name}: ${rangeLabel(ph.start, ph.end)}`).join('\n'))}">${p.phases.length}</span>` : '—'}</td>
        <td>${budgetMeter(p, total)}</td>
        <td class="num">${hrs(upcoming)}</td>
        <td><div class="actions">
          <button class="btn sm" data-act="view-project" data-id="${p.id}">View schedule</button>
          <button class="btn sm" data-act="edit-project" data-id="${p.id}">Edit</button>
        </div></td></tr>`;
    }).join('');
    main.innerHTML = `<div class="page">
      <h2>Projects</h2><p class="lede">Everything your team is working on: dates, phases, and scheduled hours against budget.</p>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Project</th><th>Client</th><th>Type</th><th class="num">People</th><th>Dates</th><th>Phases</th><th>Budget used</th><th class="num">Upcoming</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" class="empty-state">No projects yet.</td></tr>'}</tbody>
      </table></div></div></div>`;
  }

  // ----- people
  function renderPeople() {
    $('#schedule')?.remove();
    main.className = '';
    toolbar.innerHTML = `<button class="btn primary" data-act="new-person">+ Add person</button>
      <button class="btn" data-act="new-discipline">+ Discipline</button>`;
    const wk = startOfWeek(todayStr());
    const rows = [...state.people].sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
      const thisWeek = personStats(p, wk, addDays(wk, 6));
      const next4 = personStats(p, addDays(wk, 7), addDays(wk, 34));
      const meter = (u) => `<div class="hbar"><div class="meter ${u > 100.5 ? 'over' : u >= 99.5 ? 'full' : ''}"><i style="width:${Math.min(100, u)}%"></i></div><span>${pct(Math.min(u, 999))}</span></div>`;
      return `<tr>
        <td><div class="cell-person"><div class="avatar" style="background:${p.color || hashColor(p.name)}">${esc(initials(p.name))}</div><b>${esc(p.name)}</b></div></td>
        <td>${esc(p.role || '—')}</td>
        <td>${esc(discName(p) || '—')}</td>
        <td>${esc(p.region || '—')}</td>
        <td class="num">${round1(p.capacity)}h</td>
        <td>${meter(thisWeek.util)}</td>
        <td>${meter(next4.util)}</td>
        <td class="num">${hrs(Math.max(0, next4.available))}</td>
        <td><div class="actions"><button class="btn sm" data-act="edit-person" data-id="${p.id}">Edit</button></div></td></tr>`;
    }).join('');
    main.innerHTML = `<div class="page">
      <h2>People</h2><p class="lede">Your team, their capacity, and how booked they are.</p>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Role</th><th>Discipline</th><th>State / region</th><th class="num">Capacity/day</th><th>This week</th><th>Next 4 weeks</th><th class="num">Free (4 wks)</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" class="empty-state">No people yet.</td></tr>'}</tbody>
      </table></div></div>
      <div class="card"><h3>Disciplines</h3><div class="table-wrap"><table>
        <thead><tr><th>Discipline</th><th class="num">People</th><th></th></tr></thead>
        <tbody>${sortedDisciplines().map((d) => `<tr><td><b>${esc(d.name)}</b></td>
          <td class="num">${state.people.filter((p) => p.disciplineId === d.id).length}</td>
          <td><div class="actions"><button class="btn sm" data-act="rename-discipline" data-id="${d.id}">Rename</button>
            <button class="btn sm danger" data-act="delete-discipline" data-id="${d.id}">Delete</button></div></td></tr>`).join('')
          || '<tr><td colspan="3" class="hint">No disciplines yet. Add one, e.g. Design or Engineering.</td></tr>'}</tbody>
      </table></div></div></div>`;
  }

  // ----- report
  function renderReport() {
    $('#schedule')?.remove();
    main.className = '';
    const s = ui.reportStart, e = ui.reportEnd;
    toolbar.innerHTML = `
      <label class="toggle">From <input type="date" id="repStart" value="${s}"></label>
      <label class="toggle">to <input type="date" id="repEnd" value="${e}"></label>
      <div class="btn-group">
        <button class="btn" data-preset="week">This week</button>
        <button class="btn" data-preset="month">This month</button>
        <button class="btn" data-preset="next">Next month</button>
        <button class="btn" data-preset="quarter">This quarter</button>
      </div>`;
    const totals = { capacity: 0, scheduled: 0, billable: 0, timeoff: 0, tentative: 0, closedHours: 0, closedWork: 0 };
    const peopleRows = [...state.people].sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
      const st = personStats(p, s, e);
      for (const k in totals) totals[k] += st[k];
      return `<tr>
        <td><div class="cell-person"><div class="avatar" style="background:${p.color || hashColor(p.name)}">${esc(initials(p.name))}</div>${esc(p.name)}</div></td>
        <td class="num">${hrs(st.capacity)}</td><td class="num">${hrs(st.scheduled)}</td><td class="num">${hrs(st.billable)}</td>
        <td class="num">${hrs(st.scheduled - st.billable)}</td><td class="num">${hrs(st.timeoff)}</td>
        <td class="num" title="${st.closedDays} day(s) of capacity removed">${hrs(st.closedHours)}</td>
        <td class="num">${st.closedWork ? `<span class="hol-note">${hrs(st.closedWork)}</span>` : '0h'}</td>
        <td><div class="hbar"><div class="meter ${st.util > 100.5 ? 'over' : st.util >= 99.5 ? 'full' : ''}"><i style="width:${Math.min(100, st.util)}%"></i></div><span>${pct(Math.min(st.util, 999))}</span></div></td></tr>`;
    }).join('');

    const projHours = state.projects.map((p) => {
      const list = state.allocations.filter((a) => a.projectId === p.id);
      return { p, h: list.reduce((sum, a) => sum + hoursInRange(a, s, e), 0), people: new Set(list.filter((a) => hoursInRange(a, s, e) > 0).map((a) => a.personId)).size };
    }).filter((x) => x.h > 0).sort((a, b) => b.h - a.h);
    const maxH = Math.max(1, ...projHours.map((x) => x.h));
    const projRows = projHours.map(({ p, h, people }) => `<tr>
      <td><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</td><td>${esc(p.client || '—')}</td>
      <td class="num">${people}</td>
      <td><div class="hbar"><div class="meter"><i style="width:${(h / maxH) * 100}%;background:${p.color}"></i></div><span>${hrs(h)}</span></div></td>
      <td class="num">${totals.scheduled ? pct((h / totals.scheduled) * 100) : '—'}</td></tr>`).join('');

    const util = totals.capacity ? (totals.scheduled / totals.capacity) * 100 : 0;
    const tile = (k, v) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    main.innerHTML = `<div class="page">
      <h2>Report</h2><p class="lede">${rangeLabel(s, e)} · ${workdays(s, e)} working days</p>
      <div class="tiles">
        ${tile('Capacity', hrs(totals.capacity))}${tile('Scheduled', hrs(totals.scheduled))}
        ${tile('Billable', hrs(totals.billable))}${tile('Non-billable', hrs(totals.scheduled - totals.billable))}
        ${tile('Time off', hrs(totals.timeoff))}${tile('Holidays &amp; shutdowns', hrs(totals.closedHours))}
        ${tile('Worked on holidays', hrs(totals.closedWork))}${tile('Utilization', pct(util))}
      </div>
      <div class="card"><h3>By person</h3><div class="table-wrap"><table>
        <thead><tr><th>Person</th><th class="num">Capacity</th><th class="num">Scheduled</th><th class="num">Billable</th><th class="num">Non-billable</th><th class="num">Time off</th><th class="num">Holidays &amp; shutdowns</th><th class="num">Worked on those days</th><th>Utilization</th></tr></thead>
        <tbody>${peopleRows || '<tr><td colspan="9">No people.</td></tr>'}</tbody></table></div></div>
      <div class="card"><h3>By project</h3><div class="table-wrap"><table>
        <thead><tr><th>Project</th><th>Client</th><th class="num">People</th><th>Hours</th><th class="num">Share</th></tr></thead>
        <tbody>${projRows || '<tr><td colspan="5">Nothing scheduled in this range.</td></tr>'}</tbody></table></div></div>
    </div>`;
  }

  // ----- holidays & shutdowns
  function renderHolidays() {
    $('#schedule')?.remove();
    main.className = '';
    const regions = allRegions();
    const f = ui.holRegion || '';
    toolbar.innerHTML = `<button class="btn primary" data-act="new-holiday">+ Public holiday</button>
      <button class="btn" data-act="bulk-holidays">Paste a list…</button>
      <button class="btn" data-act="new-shutdown">+ Shutdown</button>
      <span class="spacer"></span>
      <label class="toggle">Show <select id="holRegion"><option value="">All states / regions</option>
        ${regions.map((r) => `<option value="${esc(r)}" ${r === f ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>`;
    const match = (ev) => !f || !ev.region || ev.region === f;
    const affected = (ev) => state.people.filter((p) => appliesTo(ev, p)).length;
    const regionCell = (r) => (r ? `<span class="tag">${esc(r)}</span>` : '<span class="tag ok">Everyone</span>');
    const hol = state.holidays.filter(match).sort((a, b) => (a.date < b.date ? -1 : 1)).map((h) => `<tr>
        <td>${fmtDate(h.date, h.recurring ? { month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}${h.recurring ? ' <span class="tag">Every year</span>' : ''}</td>
        <td><span class="dot hol-dot"></span><b>${esc(h.name)}</b></td>
        <td>${regionCell(h.region)}</td>
        <td class="num">${affected(h)}</td>
        <td><div class="actions"><button class="btn sm" data-act="edit-holiday" data-id="${h.id}">Edit</button></div></td></tr>`).join('');
    const shut = state.shutdowns.filter(match).sort((a, b) => (a.start < b.start ? -1 : 1)).map((x) => `<tr>
        <td>${rangeLabel(x.start, x.end)}</td>
        <td><span class="dot shut-dot"></span><b>${esc(x.name)}</b></td>
        <td>${regionCell(x.region)}</td>
        <td class="num">${workdays(x.start, x.end)}</td>
        <td class="num">${affected(x)}</td>
        <td><div class="actions"><button class="btn sm" data-act="edit-shutdown" data-id="${x.id}">Edit</button></div></td></tr>`).join('');
    main.innerHTML = `<div class="page">
      <h2>Holidays &amp; shutdowns</h2>
      <p class="lede">These days are taken out of capacity for the people they apply to. Set each person's state or region on the People page.
        They <b>don't block scheduling</b>: you can still put work on these days and it counts, marked in amber on the schedule.</p>
      <div class="card"><h3>Public holidays</h3><div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Holiday</th><th>Applies to</th><th class="num">People</th><th></th></tr></thead>
        <tbody>${hol || '<tr><td colspan="5" class="hint">No public holidays yet. Add one, or paste a list.</td></tr>'}</tbody></table></div></div>
      <div class="card"><h3>Shutdowns</h3><div class="table-wrap"><table>
        <thead><tr><th>Dates</th><th>Name</th><th>Applies to</th><th class="num">Working days</th><th class="num">People</th><th></th></tr></thead>
        <tbody>${shut || '<tr><td colspan="6" class="hint">No shutdowns yet, e.g. an end-of-year office closure.</td></tr>'}</tbody></table></div></div>
    </div>`;
  }

  const regionField = (value) => `
    <label class="field">Applies to state / territory${regionSelect(value, 'Everyone (all states)')}</label>
    <p class="hint" style="margin:0">Choose a state or territory to apply it only to people there.</p>`;

  function openHolidayModal(h) {
    const isNew = !h;
    h = h || { name: '', date: todayStr(), region: ui.holRegion || '', recurring: false };
    modal({
      title: isNew ? 'Add public holiday' : 'Edit public holiday',
      body: `
        <label class="field">Name<input name="name" value="${esc(h.name)}" required placeholder="e.g. Labour Day"></label>
        <div class="grid2">
          <label class="field">Date<input type="date" name="date" value="${h.date}" required></label>
          <label class="check"><input type="checkbox" name="recurring" ${h.recurring ? 'checked' : ''}> Same date every year</label>
        </div>
        ${regionField(h.region)}`,
      footer: saveFooter(isNew ? '' : '<button type="button" class="btn danger" id="delHol">Delete</button>'),
      mount(form) {
        if (isNew) return;
        $('#delHol', form).addEventListener('click', () => {
          commit((st) => { st.holidays = st.holidays.filter((x) => x.id !== h.id); });
          closeModal(); toast('Holiday deleted — Ctrl+Z to undo');
        });
      },
      onSubmit(fd) {
        const name = (fd.get('name') || '').trim(), date = fd.get('date');
        if (!name) return 'Name is required.';
        if (!date) return 'Please choose a date.';
        const data = { name, date, region: (fd.get('region') || '').trim(), recurring: fd.get('recurring') === 'on' };
        commit((st) => { if (isNew) st.holidays.push({ id: uid(), ...data }); else Object.assign(st.holidays.find((x) => x.id === h.id), data); });
        toast(isNew ? 'Holiday added' : 'Saved');
      },
    });
  }

  function openBulkHolidayModal() {
    modal({
      title: 'Paste public holidays',
      wide: true,
      body: `
        <p class="hint" style="margin:0">One per line: <code>date, name, state/region</code>. Leave the region off to apply to everyone.
          Dates can be YYYY-MM-DD or DD/MM/YYYY.</p>
        <label class="field">Holidays<textarea name="list" rows="9" placeholder="2027-01-26, Australia Day\n2027-03-08, Labour Day, VIC\n2027-03-08, Canberra Day, ACT"></textarea></label>`,
      footer: saveFooter(),
      onSubmit(fd) {
        const items = [], bad = [];
        for (const raw of String(fd.get('list') || '').split(/\r?\n/)) {
          const line = raw.trim();
          if (!line) continue;
          const [d, name, region = ''] = line.split(/\s*[,\t;]\s*/);
          let date = null;
          if (/^\d{4}-\d{2}-\d{2}$/.test(d || '')) date = d;
          else { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d || ''); if (m) date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
          if (!date || isNaN(toDate(date)) || !name) { bad.push(line); continue; }
          items.push({ id: uid(), date, name, region: region.trim(), recurring: false });
        }
        if (bad.length) return `Couldn't read ${bad.length} line(s), e.g. "${bad[0]}".`;
        if (!items.length) return 'Paste at least one holiday.';
        const key = (x) => `${x.date}|${x.name.toLowerCase()}|${x.region}`;
        const existing = new Set(state.holidays.map(key));
        const fresh = items.filter((x) => !existing.has(key(x)));
        commit((st) => st.holidays.push(...fresh));
        toast(`Added ${fresh.length} holiday${fresh.length === 1 ? '' : 's'}${items.length > fresh.length ? ` (${items.length - fresh.length} already existed)` : ''}`);
      },
    });
  }

  function openShutdownModal(x) {
    const isNew = !x;
    x = x || { name: '', start: todayStr(), end: addDays(todayStr(), 4), region: '' };
    modal({
      title: isNew ? 'Add shutdown' : 'Edit shutdown',
      body: `
        <label class="field">Name<input name="name" value="${esc(x.name)}" required placeholder="e.g. End-of-year shutdown"></label>
        <div class="grid2">
          <label class="field">First day<input type="date" name="start" value="${x.start}" required></label>
          <label class="field">Last day<input type="date" name="end" value="${x.end}" required></label>
        </div>
        ${regionField(x.region)}`,
      footer: saveFooter(isNew ? '' : '<button type="button" class="btn danger" id="delShut">Delete</button>'),
      mount(form) {
        if (isNew) return;
        $('#delShut', form).addEventListener('click', () => {
          commit((st) => { st.shutdowns = st.shutdowns.filter((y) => y.id !== x.id); });
          closeModal(); toast('Shutdown deleted — Ctrl+Z to undo');
        });
      },
      onSubmit(fd) {
        const name = (fd.get('name') || '').trim();
        let start = fd.get('start'), end = fd.get('end');
        if (!name) return 'Name is required.';
        if (!start || !end) return 'Please choose both dates.';
        if (end < start) [start, end] = [end, start];
        const data = { name, start, end, region: (fd.get('region') || '').trim() };
        commit((st) => { if (isNew) st.shutdowns.push({ id: uid(), ...data }); else Object.assign(st.shutdowns.find((y) => y.id === x.id), data); });
        toast(isNew ? 'Shutdown added' : 'Saved');
      },
    });
  }

  // ---------------------------------------------------------------- modals
  const modalRoot = $('#modalRoot');
  function closeModal() { modalRoot.innerHTML = ''; }
  function modal({ title, body, footer, onSubmit, mount, wide }) {
    modalRoot.innerHTML = `<div class="backdrop"><form class="dialog" novalidate ${wide ? 'style="max-width:560px"' : ''}>
      <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">&times;</button></header>
      <div class="dialog-body">${body}<p class="error" hidden></p></div>
      <footer>${footer}</footer></form></div>`;
    const form = $('form', modalRoot);
    const err = $('.error', form);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const res = onSubmit(new FormData(form), form);
      if (typeof res === 'string') { err.textContent = res; err.hidden = false; } else closeModal();
    });
    $('.backdrop', modalRoot).addEventListener('pointerdown', (ev) => { if (ev.target.classList.contains('backdrop')) closeModal(); });
    modalRoot.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
    if (mount) mount(form);
    const first = form.querySelector('.dialog-body input:not([type=radio]):not([type=hidden]), .dialog-body select');
    if (first) first.focus();
  }
  const saveFooter = (extra = '') => `${extra}<span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button>`;

  function openAllocModal(input, isNew) {
    if (!state.people.length) { toast('Add a person first'); openPersonModal(null); return; }
    const person = findPerson(input.personId) || state.people[0];
    const a = { type: 'task', projectId: '', hoursPerDay: person.capacity, notes: '', tentative: false, start: todayStr(), end: todayStr(), ...input, personId: person.id };
    if (!a.projectId) a.projectId = (state.projects.find((p) => !p.archived) || {}).id || '';
    const projects = state.projects.filter((p) => !p.archived || p.id === a.projectId);
    const personOpts = state.people.map((p) => `<option value="${p.id}" ${p.id === a.personId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    const projOpts = projects.map((p) => `<option value="${p.id}" ${p.id === a.projectId ? 'selected' : ''}>${esc(p.name)}${p.client ? ` — ${esc(p.client)}` : ''}</option>`).join('');
    modal({
      title: isNew ? 'Schedule work' : (a.type === 'timeoff' ? 'Edit time off' : 'Edit allocation'),
      body: `
        <div class="seg">
          <label><input type="radio" name="type" value="task" ${a.type === 'task' ? 'checked' : ''}> Project work</label>
          <label><input type="radio" name="type" value="timeoff" ${a.type === 'timeoff' ? 'checked' : ''}> Time off</label>
        </div>
        <label class="field">Person<select name="personId">${personOpts}</select></label>
        <div class="field proj-only"><span>Project</span>
          <div class="inline"><select name="projectId">${projOpts || '<option value="">No projects — create one</option>'}</select>
          <button type="button" class="btn" id="quickProject" title="Create a project">+ New</button></div>
        </div>
        <div class="grid2">
          <label class="field">Start<input type="date" name="start" value="${a.start}" required></label>
          <label class="field">End<input type="date" name="end" value="${a.end}" required></label>
        </div>
        <div class="grid2">
          <label class="field">Hours per day<input type="number" name="hoursPerDay" min="0.25" max="24" step="0.25" value="${a.hoursPerDay}"></label>
          <label class="check proj-only"><input type="checkbox" name="tentative" ${a.tentative ? 'checked' : ''}> Tentative</label>
        </div>
        <label class="field"><span class="notes-label">Notes</span><textarea name="notes" rows="2" placeholder="Optional details">${esc(a.notes)}</textarea></label>
        <p class="summary" id="allocSummary"></p>`,
      footer: saveFooter(isNew ? '' : `<button type="button" class="btn danger" id="delAlloc">Delete</button><button type="button" class="btn" id="dupAlloc">Duplicate</button>`),
      mount(form) {
        const sync = () => {
          const fd = new FormData(form);
          const off = fd.get('type') === 'timeoff';
          form.querySelectorAll('.proj-only').forEach((el) => { el.style.display = off ? 'none' : ''; });
          $('.notes-label', form).textContent = off ? 'Reason' : 'Notes';
          let s = fd.get('start'), e = fd.get('end');
          if (s && e) {
            if (e < s) [s, e] = [e, s];
            const wd = workdays(s, e), h = +fd.get('hoursPerDay') || 0;
            const p = findPerson(fd.get('personId'));
            let msg = `${wd} working day${wd === 1 ? '' : 's'} · <b>${hrs(wd * h)}</b> total`;
            if (p && !off) {
              const st = personStats(p, s, e);
              const self = isNew ? null : findAlloc(a.id);
              const selfHours = self && self.personId === p.id && self.type === 'task' ? hoursInRange(self, s, e) : 0;
              const free = st.capacity - (st.scheduled - selfHours);
              msg += ` · ${esc(p.name.split(' ')[0])} has <b>${hrs(Math.max(0, free))}</b> free in this range`;
              if ((wd - st.closedDays) * h > free + 1e-9) msg += ' <span style="color:var(--danger)">(over capacity)</span>';
            }
            const pr = !off && findProject(fd.get('projectId'));
            if (pr) {
              const self = isNew ? null : findAlloc(a.id);
              const selfTotal = self && self.type === 'task' && self.projectId === pr.id ? hoursInRange(self, self.start, self.end) : 0;
              const after = projectUsed(pr) - selfTotal + wd * h;
              if (pr.budgetHours) {
                const over = after > pr.budgetHours + 1e-9;
                msg += `<br>${esc(pr.name)} budget: <b>${hrs(after)}</b> of ${hrs(pr.budgetHours)} after this booking`
                  + (over ? ` <span style="color:var(--danger)">(${hrs(after - pr.budgetHours)} over budget)</span>` : ` · ${hrs(pr.budgetHours - after)} left`);
              }
              if (outsideProject({ type: 'task', start: s, end: e }, pr)) {
                msg += `<br><span class="hol-note">⚠ Outside the project dates (${esc(projectDatesLabel(pr))}). You can still save it.</span>`;
              }
              const ph = pr.phases.filter((x) => x.start <= e && x.end >= s).map((x) => x.name);
              if (ph.length) msg += `<br>Phase${ph.length > 1 ? 's' : ''}: ${ph.map(esc).join(', ')}`;
            }
            if (p) {
              const names = [];
              for (let d = s; d <= e; d = addDays(d, 1)) {
                const c = !isWeekend(d) && closureFor(p, d);
                if (c && !names.includes(c.name)) names.push(c.name);
              }
              if (names.length) {
                msg += `<br><span class="hol-note">Includes ${names.map(esc).join(', ')} for ${esc(p.name.split(' ')[0])}.`
                  + (off ? '' : ' You can still schedule work on those days, and those hours are counted.') + '</span>';
              }
            }
            $('#allocSummary', form).innerHTML = msg;
          }
        };
        form.addEventListener('input', sync);
        form.addEventListener('change', (ev) => {
          if (ev.target.name === 'type' && ev.target.value === 'timeoff') {
            const p = findPerson(new FormData(form).get('personId'));
            if (p) form.hoursPerDay.value = p.capacity;
          }
          sync();
        });
        sync();
        $('#quickProject', form).addEventListener('click', () => {
          const name = prompt('New project name');
          if (!name || !name.trim()) return;
          const p = { id: uid(), name: name.trim(), client: '', color: COLORS[state.projects.length % COLORS.length], billable: true, archived: false, start: '', end: '', budgetHours: null, phases: [] };
          commit((st) => st.projects.push(p));
          const sel = form.projectId;
          if (sel.options.length === 1 && !sel.options[0].value) sel.innerHTML = '';
          sel.insertAdjacentHTML('beforeend', `<option value="${p.id}">${esc(p.name)}</option>`);
          sel.value = p.id;
        });
        if (!isNew) {
          $('#delAlloc', form).addEventListener('click', () => {
            commit((st) => { st.allocations = st.allocations.filter((x) => x.id !== a.id); });
            closeModal(); toast('Deleted — Ctrl+Z to undo');
          });
          $('#dupAlloc', form).addEventListener('click', () => {
            const len = diffDays(a.start, a.end) + 1;
            commit((st) => st.allocations.push({ ...findAlloc(a.id), id: uid(), start: addDays(a.start, len), end: addDays(a.end, len) }));
            closeModal(); toast('Duplicated after the original');
          });
        }
      },
      onSubmit(fd) {
        const type = fd.get('type');
        let start = fd.get('start'), end = fd.get('end');
        const hoursPerDay = +fd.get('hoursPerDay');
        if (!start || !end) return 'Please choose start and end dates.';
        if (end < start) [start, end] = [end, start];
        if (!(hoursPerDay > 0) || hoursPerDay > 24) return 'Hours per day must be between 0.25 and 24.';
        if (type === 'task' && !fd.get('projectId')) return 'Please choose or create a project.';
        const data = {
          type, personId: fd.get('personId'), projectId: type === 'task' ? fd.get('projectId') : null,
          start, end, hoursPerDay, notes: (fd.get('notes') || '').trim(), tentative: type === 'task' && fd.get('tentative') === 'on',
        };
        commit((st) => {
          if (isNew) st.allocations.push({ id: uid(), ...data });
          else Object.assign(st.allocations.find((x) => x.id === a.id), data);
        });
        toast(isNew ? 'Scheduled' : 'Saved');
      },
    });
  }

  function openPersonModal(p) {
    const isNew = !p;
    p = p || { name: '', role: '', disciplineId: '', capacity: 8 };
    const discOpts = () => `<option value="">No discipline</option>${sortedDisciplines().map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}`;
    modal({
      title: isNew ? 'Add person' : 'Edit person',
      body: `
        <label class="field">Name<input name="name" value="${esc(p.name)}" required placeholder="e.g. Jordan Lee"></label>
        <div class="grid2">
          <label class="field">Role<input name="role" value="${esc(p.role)}" placeholder="e.g. Designer"></label>
          <div class="field"><span>Discipline</span><div class="inline"><select name="disciplineId">${discOpts()}</select>
            <button type="button" class="btn" id="quickDisc" title="Add a discipline">+ New</button></div></div>
        </div>
        <label class="field">State / territory (for public holidays)${regionSelect(p.region || '', 'None (company-wide holidays only)')}</label>
        <label class="field">Work hours per day (Mon–Fri)<input type="number" name="capacity" min="0" max="24" step="0.5" value="${p.capacity}"></label>`,
      footer: saveFooter(isNew ? '' : `<button type="button" class="btn danger" id="delPerson">Delete</button>`),
      mount(form) {
        form.disciplineId.value = p.disciplineId || '';
        $('#quickDisc', form).addEventListener('click', () => {
          const d = addDiscipline();
          if (!d) return;
          form.disciplineId.innerHTML = discOpts();
          form.disciplineId.value = d.id;
        });
        if (isNew) return;
        $('#delPerson', form).addEventListener('click', () => {
          const n = state.allocations.filter((a) => a.personId === p.id).length;
          if (!confirm(`Delete ${p.name}${n ? ` and their ${n} allocation${n === 1 ? '' : 's'}` : ''}?`)) return;
          commit((st) => { st.people = st.people.filter((x) => x.id !== p.id); st.allocations = st.allocations.filter((a) => a.personId !== p.id); });
          closeModal(); toast('Person deleted — Ctrl+Z to undo');
        });
      },
      onSubmit(fd) {
        const name = (fd.get('name') || '').trim();
        const capacity = +fd.get('capacity');
        if (!name) return 'Name is required.';
        if (!(capacity >= 0 && capacity <= 24)) return 'Hours per day must be between 0 and 24.';
        const data = { name, role: (fd.get('role') || '').trim(), disciplineId: fd.get('disciplineId') || '', region: (fd.get('region') || '').trim(), capacity };
        commit((st) => { if (isNew) st.people.push({ id: uid(), ...data }); else Object.assign(st.people.find((x) => x.id === p.id), data); });
        toast(isNew ? 'Person added' : 'Saved');
      },
    });
  }

  function openProjectModal(p) {
    const isNew = !p;
    p = p || { name: '', client: '', color: COLORS[state.projects.length % COLORS.length], billable: true, archived: false, start: '', end: '', budgetHours: null, phases: [] };
    const used = isNew ? 0 : projectUsed(p);
    const phaseRow = (ph = { id: '', name: '', start: '', end: '' }) => `
      <div class="phase-row" data-id="${ph.id}">
        <input class="input" data-k="name" value="${esc(ph.name)}" placeholder="Phase name, e.g. Discovery (required)" aria-label="Phase name">
        <input class="input" type="date" data-k="start" value="${ph.start}" aria-label="Phase start">
        <input class="input" type="date" data-k="end" value="${ph.end}" aria-label="Phase end">
        <button type="button" class="icon-btn" data-remove-phase title="Remove phase">&times;</button>
      </div>`;
    const clients = [...new Set(state.projects.map((x) => x.client).filter(Boolean))];
    modal({
      title: isNew ? 'New project' : 'Edit project',
      wide: true,
      body: `
        <label class="field">Project name<input name="name" value="${esc(p.name)}" required placeholder="e.g. Website Redesign"></label>
        <label class="field">Client<input name="client" value="${esc(p.client)}" list="clientList" placeholder="Optional"></label>
        <datalist id="clientList">${clients.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        <div class="grid2">
          <label class="field">Start date<input type="date" name="start" value="${p.start}"></label>
          <label class="field">End date<input type="date" name="end" value="${p.end}"></label>
        </div>
        <label class="field">Budgeted hours<input type="number" name="budgetHours" min="0" step="1" value="${p.budgetHours || ''}" placeholder="Optional, e.g. 400"></label>
        <p class="summary" id="projSummary"></p>
        <div class="field"><span>Phases</span>
          <div id="phaseList" class="phase-list">${p.phases.map(phaseRow).join('')}</div>
          <button type="button" class="btn sm" id="addPhase" style="justify-self:start">+ Add phase</button>
        </div>
        <div class="field"><span>Color</span><div class="swatches">
          ${COLORS.map((c) => `<label style="background:${c}" title="${c}"><input type="radio" name="color" value="${c}" ${c === p.color ? 'checked' : ''}></label>`).join('')}
        </div></div>
        <div class="grid2">
          <label class="check"><input type="checkbox" name="billable" ${p.billable ? 'checked' : ''}> Billable</label>
          <label class="check"><input type="checkbox" name="archived" ${p.archived ? 'checked' : ''}> Archived</label>
        </div>`,
      footer: saveFooter(isNew ? '' : `<button type="button" class="btn danger" id="delProject">Delete</button>`),
      mount(form) {
        const list = $('#phaseList', form);
        const sum = () => {
          const b = +form.budgetHours.value;
          const outsideN = isNew ? 0 : state.allocations.filter((a) => a.projectId === p.id && outsideProject(a, { start: form.start.value, end: form.end.value })).length;
          let msg = `<b>${hrs(used)}</b> scheduled so far`;
          if (b > 0) msg += used > b ? ` · <span style="color:var(--danger)">${hrs(used - b)} over budget</span>` : ` · ${hrs(b - used)} of ${hrs(b)} left`;
          if (outsideN) msg += `<br><span class="hol-note">⚠ ${outsideN} booking${outsideN === 1 ? ' falls' : 's fall'} outside these dates. They're kept, just flagged.</span>`;
          $('#projSummary', form).innerHTML = msg;
        };
        form.addEventListener('input', sum);
        sum();
        $('#addPhase', form).addEventListener('click', () => {
          const last = [...list.querySelectorAll('[data-k="end"]')].map((i) => i.value).filter(Boolean).sort().pop();
          const start = last ? addDays(last, 1) : (form.start.value || todayStr());
          let end = addDays(start, 13);
          if (form.end.value && end > form.end.value && form.end.value >= start) end = form.end.value;
          list.insertAdjacentHTML('beforeend', phaseRow({ id: '', name: '', start, end }));
          list.lastElementChild.querySelector('input').focus();
        });
        list.addEventListener('click', (ev) => { if (ev.target.closest('[data-remove-phase]')) ev.target.closest('.phase-row').remove(); });
        if (isNew) return;
        $('#delProject', form).addEventListener('click', () => {
          const n = state.allocations.filter((a) => a.projectId === p.id).length;
          if (!confirm(`Delete "${p.name}"${n ? ` and its ${n} allocation${n === 1 ? '' : 's'}` : ''}?`)) return;
          commit((st) => { st.projects = st.projects.filter((x) => x.id !== p.id); st.allocations = st.allocations.filter((a) => a.projectId !== p.id); });
          if (ui.projectFilter === p.id) ui.projectFilter = '';
          closeModal(); toast('Project deleted — Ctrl+Z to undo');
        });
      },
      onSubmit(fd) {
        const name = (fd.get('name') || '').trim();
        if (!name) return 'Project name is required.';
        let start = fd.get('start') || '', end = fd.get('end') || '';
        if (start && end && end < start) [start, end] = [end, start];
        const budgetRaw = fd.get('budgetHours');
        const budgetHours = budgetRaw === '' || budgetRaw === null ? null : +budgetRaw;
        if (budgetHours !== null && !(budgetHours >= 0)) return 'Budgeted hours must be a positive number.';
        const phases = [];
        for (const row of $('#phaseList', modalRoot).querySelectorAll('.phase-row')) {
          const get = (k) => row.querySelector(`[data-k="${k}"]`).value.trim();
          let ph = { id: row.dataset.id || uid(), name: get('name'), start: get('start'), end: get('end') };
          if (!ph.name) continue; // unnamed rows (e.g. added by mistake) are ignored
          if (!ph.start || !ph.end) return `Phase "${ph.name}" needs a start and end date.`;
          if (ph.end < ph.start) ph = { ...ph, start: ph.end, end: ph.start };
          phases.push(ph);
        }
        phases.sort((a, b) => (a.start < b.start ? -1 : 1));
        const data = { name, client: (fd.get('client') || '').trim(), color: fd.get('color') || COLORS[0], billable: fd.get('billable') === 'on', archived: fd.get('archived') === 'on',
          start, end, budgetHours: budgetHours || null, phases };
        commit((st) => { if (isNew) st.projects.push({ id: uid(), ...data }); else Object.assign(st.projects.find((x) => x.id === p.id), data); });
        toast(isNew ? 'Project created' : 'Saved');
      },
    });
  }

  function addDiscipline() {
    const name = (prompt('New discipline name, e.g. Design') || '').trim();
    if (!name) return null;
    const existing = state.disciplines.find((d) => d.name.toLowerCase() === name.toLowerCase());
    if (existing) { toast(`"${existing.name}" already exists`); return existing; }
    const d = { id: uid(), name };
    commit((st) => st.disciplines.push(d));
    toast('Discipline added');
    return d;
  }
  function renameDiscipline(id) {
    const d = findDiscipline(id);
    if (!d) return;
    const name = (prompt('Rename discipline', d.name) || '').trim();
    if (!name || name === d.name) return;
    if (state.disciplines.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) { toast(`"${name}" already exists`); return; }
    commit((st) => { st.disciplines.find((x) => x.id === id).name = name; });
    toast('Discipline renamed');
  }
  function deleteDiscipline(id) {
    const d = findDiscipline(id);
    if (!d) return;
    const n = state.people.filter((p) => p.disciplineId === id).length;
    if (!confirm(`Delete "${d.name}"?${n ? ` ${n} ${n === 1 ? 'person' : 'people'} will have no discipline.` : ''}`)) return;
    commit((st) => {
      st.disciplines = st.disciplines.filter((x) => x.id !== id);
      for (const p of st.people) if (p.disciplineId === id) p.disciplineId = '';
    });
    toast('Discipline deleted — Ctrl+Z to undo');
  }

  // ---------------------------------------------------------------- toast
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------------------------------------------------------------- schedule interactions (drag to create / move / resize)
  let drag = null;
  const dayAt = (track, clientX) => {
    const days = ui.weeks * 7, dayW = ZOOMS[ui.zoom].w;
    return Math.max(0, Math.min(days - 1, Math.floor((clientX - track.getBoundingClientRect().left) / dayW)));
  };

  main.addEventListener('pointerdown', (e) => {
    if (ui.view !== 'schedule' || e.button !== 0) return;
    const bar = e.target.closest('.bar');
    const track = e.target.closest('.track');
    const sched = $('#schedule');
    if (bar) {
      const a = findAlloc(bar.dataset.id);
      if (!a) return;
      const mode = e.target.classList.contains('h-l') ? 'resize-l' : e.target.classList.contains('h-r') ? 'resize-r' : 'move';
      drag = { mode, a, bar, track, targetTrack: track, x0: e.clientX, y0: e.clientY, scroll0: sched.scrollLeft, moved: false, newStart: a.start, newEnd: a.end };
      e.preventDefault();
    } else if (track) {
      const d = dayAt(track, e.clientX);
      drag = { mode: 'create', track, personId: track.dataset.person, projectId: track.dataset.project || '', d0: d, d1: d, x0: e.clientX, y0: e.clientY, moved: false };
      e.preventDefault();
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const sched = $('#schedule');
    if (!sched) { drag = null; return; }
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; if (drag.bar) drag.bar.classList.add('dragging'); }

    // edge auto-scroll
    const r = sched.getBoundingClientRect();
    const sideW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--side')) || 230;
    if (e.clientX > r.right - 40) sched.scrollLeft += 18;
    else if (e.clientX < r.left + sideW + 30) sched.scrollLeft -= 18;
    if (e.clientY > r.bottom - 30) sched.scrollTop += 14;
    else if (e.clientY < r.top + 70) sched.scrollTop -= 14;

    const dayW = ZOOMS[ui.zoom].w;
    if (drag.mode === 'create') {
      drag.d1 = dayAt(drag.track, e.clientX);
      if (!drag.sel) { drag.sel = document.createElement('div'); drag.sel.className = 'sel'; drag.track.appendChild(drag.sel); }
      const s = Math.min(drag.d0, drag.d1), en = Math.max(drag.d0, drag.d1);
      drag.sel.style.left = `${s * dayW + 2}px`;
      drag.sel.style.width = `${(en - s + 1) * dayW - 4}px`;
      return;
    }
    const dd = Math.round((dx + sched.scrollLeft - drag.scroll0) / dayW);
    const a = drag.a;
    const ctx = { dayW, vs: ui.viewStart, rangeEnd: addDays(ui.viewStart, ui.weeks * 7 - 1) };
    if (drag.mode === 'move') {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const row = el && el.closest('.row');
      if (row) drag.targetTrack = $('.track', row);
      const yOff = drag.targetTrack.getBoundingClientRect().top - drag.track.getBoundingClientRect().top;
      drag.bar.style.transform = `translate(${dd * dayW}px, ${yOff}px)`;
      drag.newStart = addDays(a.start, dd); drag.newEnd = addDays(a.end, dd);
    } else {
      if (drag.mode === 'resize-l') { drag.newStart = minS(addDays(a.start, dd), a.end); drag.newEnd = a.end; }
      else { drag.newEnd = maxS(addDays(a.end, dd), a.start); drag.newStart = a.start; }
      const g = barGeom(drag.newStart, drag.newEnd, ctx);
      if (g) { drag.bar.style.left = `${g.left}px`; drag.bar.style.width = `${g.width}px`; }
    }
    const sub = $('.bar-sub', drag.bar);
    if (sub) sub.textContent = `${rangeLabel(drag.newStart, drag.newEnd)}${e.altKey && drag.mode === 'move' ? ' · copy' : ''}`;
  });

  window.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.mode === 'create') {
      if (d.sel) d.sel.remove();
      const s = Math.min(d.d0, d.d1), en = Math.max(d.d0, d.d1);
      const extra = d.projectId ? { projectId: d.projectId } : {};
      openAllocModal({ personId: d.personId, start: addDays(ui.viewStart, s), end: addDays(ui.viewStart, en), ...extra }, true);
      return;
    }
    if (!d.moved) { openAllocModal(d.a, false); return; }
    const personId = d.mode === 'move' ? d.targetTrack.dataset.person : d.a.personId;
    // Dropping onto a person's row under another project (Group by: Project) moves the booking to that project.
    const targetProject = d.mode === 'move' && d.a.type === 'task' ? d.targetTrack.dataset.project : '';
    const projectId = targetProject || d.a.projectId;
    if (d.newStart === d.a.start && d.newEnd === d.a.end && personId === d.a.personId && projectId === d.a.projectId) { render(); return; }
    const copy = d.mode === 'move' && e.altKey;
    const orig = { personId: d.a.personId, projectId: d.a.projectId }; // d.a is mutated by the commit below
    commit((st) => {
      if (copy) st.allocations.push({ ...d.a, id: uid(), personId, projectId, start: d.newStart, end: d.newEnd });
      else Object.assign(st.allocations.find((x) => x.id === d.a.id), { personId, projectId, start: d.newStart, end: d.newEnd });
    });
    const who = findPerson(personId);
    const pr = findProject(projectId);
    toast(copy ? 'Copied' : projectId !== orig.projectId ? `Moved to ${pr ? pr.name : 'project'}` : personId !== orig.personId ? `Moved to ${who ? who.name : 'person'}` : `Rescheduled to ${rangeLabel(d.newStart, d.newEnd)}`);
  });
  window.addEventListener('pointercancel', () => { if (drag) { drag.sel?.remove(); drag = null; render(); } });

  // ---------------------------------------------------------------- other events
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-person-edit], [data-project-edit]');
    if (!t) { $('#menuPop').hidden = true; return; }
    if (t.id !== 'menuBtn' && !t.closest('#menuPop')) $('#menuPop').hidden = true;

    if (t.dataset.view) { ui.view = t.dataset.view; render(); return; }
    if (t.dataset.personEdit) { openPersonModal(findPerson(t.dataset.personEdit)); return; }
    if (t.dataset.projectEdit) { openProjectModal(findProject(t.dataset.projectEdit)); return; }
    if (t.dataset.zoom !== undefined) { ui.zoom = +t.dataset.zoom; render(); return; }
    if (t.dataset.preset) { setReportPreset(t.dataset.preset); return; }
    if (t.dataset.action) { menuAction(t.dataset.action); $('#menuPop').hidden = true; return; }

    switch (t.dataset.act || t.id) {
      case 'new-alloc': openAllocModal({ start: todayStr(), end: addDays(todayStr(), 4) }, true); break;
      case 'prev': ui.viewStart = addDays(ui.viewStart, -28); render(); break;
      case 'next': ui.viewStart = addDays(ui.viewStart, 28); render(); break;
      case 'today': {
        ui.viewStart = addDays(startOfWeek(todayStr()), -7);
        render();
        const s = $('#schedule'); if (s) s.scrollLeft = 0;
        break;
      }
      case 'new-person': openPersonModal(null); break;
      case 'new-discipline': addDiscipline(); break;
      case 'rename-discipline': renameDiscipline(t.dataset.id); break;
      case 'delete-discipline': deleteDiscipline(t.dataset.id); break;
      case 'edit-person': openPersonModal(findPerson(t.dataset.id)); break;
      case 'new-project': openProjectModal(null); break;
      case 'edit-project': openProjectModal(findProject(t.dataset.id)); break;
      case 'new-holiday': openHolidayModal(null); break;
      case 'edit-holiday': openHolidayModal(state.holidays.find((h) => h.id === t.dataset.id)); break;
      case 'bulk-holidays': openBulkHolidayModal(); break;
      case 'new-shutdown': openShutdownModal(null); break;
      case 'edit-shutdown': openShutdownModal(state.shutdowns.find((x) => x.id === t.dataset.id)); break;
      case 'view-project': ui.projectFilter = t.dataset.id; ui.view = 'schedule'; render(); break;
      case 'undoBtn': undo(); break;
      case 'redoBtn': redo(); break;
      case 'menuBtn': $('#menuPop').hidden = !$('#menuPop').hidden; break;
      default: break;
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'searchInput') { ui.search = e.target.value; render(); }
  });
  document.addEventListener('change', (e) => {
    const id = e.target.id;
    if (e.target.matches('select[data-region-select]')) {
      const sel = e.target;
      if (sel.value === '__other') {
        const name = (prompt('State, territory or region name') || '').trim();
        if (!name) { sel.value = sel.dataset.prev; return; }
        let opt = [...sel.options].find((o) => o.value.toLowerCase() === name.toLowerCase());
        if (!opt) { opt = new Option(name, name); sel.insertBefore(opt, sel.querySelector('option[value="__other"]')); }
        sel.value = opt.value;
      }
      sel.dataset.prev = sel.value;
      return;
    }
    if (id === 'projectFilter') { ui.projectFilter = e.target.value; render(); }
    else if (id === 'groupBy') { ui.groupBy = e.target.value; render(); }
    else if (id === 'holRegion') { ui.holRegion = e.target.value; render(); }
    else if (id === 'showArchived') { ui.showArchived = e.target.checked; render(); }
    else if (id === 'repStart' || id === 'repEnd') {
      const s = $('#repStart').value, en = $('#repEnd').value;
      if (s && en) { ui.reportStart = minS(s, en); ui.reportEnd = maxS(s, en); render(); }
    }
  });

  function setReportPreset(p) {
    const t = todayStr();
    if (p === 'week') { ui.reportStart = startOfWeek(t); ui.reportEnd = addDays(ui.reportStart, 6); }
    else if (p === 'month') { ui.reportStart = monthStart(t); ui.reportEnd = monthEnd(t); }
    else if (p === 'next') { ui.reportStart = addMonths(t, 1); ui.reportEnd = monthEnd(ui.reportStart); }
    else if (p === 'quarter') {
      const m = toDate(t).getUTCMonth();
      ui.reportStart = addMonths(t, -(m % 3)); ui.reportEnd = monthEnd(addMonths(ui.reportStart, 2));
    }
    render();
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function menuAction(action) {
    if (action === 'export') { download(`crewplan-${todayStr()}.json`, JSON.stringify(state, null, 2), 'application/json'); toast('Exported'); }
    else if (action === 'import') $('#importFile').click();
    else if (action === 'csv') {
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['Person', 'Discipline', 'Type', 'Project', 'Client', 'Start', 'End', 'Hours/day', 'Total hours', 'Tentative', 'Notes'].join(',')];
      for (const a of [...state.allocations].sort((x, y) => (x.start < y.start ? -1 : 1))) {
        const p = findPerson(a.personId) || {}, pr = findProject(a.projectId) || {};
        lines.push([p.name, p.id ? discName(p) : '', a.type === 'timeoff' ? 'Time off' : 'Project', pr.name, pr.client, a.start, a.end, a.hoursPerDay, hoursInRange(a, a.start, a.end), a.tentative ? 'yes' : '', a.notes].map(q).join(','));
      }
      download(`crewplan-schedule-${todayStr()}.csv`, lines.join('\n'), 'text/csv'); toast('CSV exported');
    } else if (action === 'sample') {
      if (!confirm('Replace current data with sample data?')) return;
      commit((st) => Object.assign(st, normalize(seed()))); toast('Sample data loaded — Ctrl+Z to undo');
    } else if (action === 'clear') {
      if (!confirm('Delete all people, projects and allocations?')) return;
      commit((st) => Object.assign(st, { people: [], projects: [], allocations: [], holidays: [], shutdowns: [], disciplines: [] })); toast('Cleared — Ctrl+Z to undo');
    }
  }

  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!validData(data)) throw new Error('bad shape');
      commit((st) => Object.assign(st, normalize({ people: data.people, projects: data.projects, allocations: data.allocations, holidays: data.holidays, shutdowns: data.shutdowns, disciplines: data.disciplines })));
      toast('Data imported');
    } catch { toast('That file is not valid Crewplan data'); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (drag) { drag.sel?.remove(); drag = null; render(); return; }
      if (modalRoot.innerHTML) { closeModal(); return; }
      $('#menuPop').hidden = true;
    }
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inField) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !inField) {
      e.preventDefault(); redo();
    }
  });

  save();
  render();
})();
