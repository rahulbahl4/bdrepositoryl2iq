/* Baseline — a lightweight team resource scheduler.
 * Plain JS, no dependencies. Data is stored in localStorage. */
'use strict';
(() => {
  // ---------------------------------------------------------------- constants
  const STORE_KEY = 'baseline:data:v1';
  const UI_KEY = 'baseline:ui:v1';
  // The app used to be called Crewplan: carry saved data over to the new keys once.
  try {
    for (const [oldKey, newKey] of [['crewplan:data:v1', STORE_KEY], ['crewplan:ui:v1', UI_KEY]]) {
      const old = localStorage.getItem(oldKey);
      if (old !== null && localStorage.getItem(newKey) === null) localStorage.setItem(newKey, old);
    }
  } catch { /* storage unavailable */ }
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
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
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
    scenario: 'confirmed', // 'confirmed' | 'all' | 'weighted' (how pipeline projects are counted)
    reportStart: monthStart(todayStr()),
    reportEnd: monthEnd(todayStr()),
  }, loadUI());
  ui.viewStart = startOfWeek(ui.viewStart);
  if (!['none', 'discipline', 'project'].includes(ui.groupBy)) ui.groupBy = ui.groupByDept === false ? 'none' : 'discipline';
  delete ui.groupByDept;
  if (!['confirmed', 'all', 'weighted'].includes(ui.scenario)) ui.scenario = 'confirmed';
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
      // Pipeline fields: a project is confirmed, a pipeline bid (with a win chance), or lost.
      if (!['confirmed', 'pipeline', 'lost'].includes(pr.status)) pr.status = 'confirmed';
      pr.winChance = Number.isFinite(+pr.winChance) ? clamp(Math.round(+pr.winChance), 0, 100) : 50;
      if (!['Bidding', 'Shortlisted'].includes(pr.stage)) pr.stage = 'Bidding';
      pr.decisionDate = pr.decisionDate || '';
    }
    // An allocation with no person is an unfilled slot: demand for a discipline, not yet named.
    for (const a of d.allocations) {
      if (!a.personId) a.personId = null;
      if (a.personId || a.type !== 'task') delete a.disciplineId;
      else a.disciplineId = d.disciplines.some((x) => x.id === a.disciplineId) ? a.disciplineId : '';
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
    const { view, zoom, groupBy, viewStart, scenario, fcWeeks } = ui;
    try { localStorage.setItem(UI_KEY, JSON.stringify({ view, zoom, groupBy, viewStart, scenario, fcWeeks })); } catch { /* ignore */ }
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
    const disciplines = ['Controls Engineering', 'SCADA & Software', 'Electrical Design', 'Commissioning', 'Project Management'].map((name) => ({ id: uid(), name }));
    const D = (name) => disciplines.find((x) => x.name === name).id;
    const P = (name, role, disc, region, capacity = 8) => ({ id: uid(), name, role, disciplineId: D(disc), region, capacity });
    const people = [
      P('Ava Thompson', 'Lead Controls Engineer', 'Controls Engineering', 'NSW'),
      P('Liam Carter', 'Electrical Designer', 'Electrical Design', 'VIC'),
      P('Noah Patel', 'PLC Programmer', 'Controls Engineering', 'VIC'),
      P('Mia Chen', 'SCADA Engineer', 'SCADA & Software', 'NSW'),
      P('Ethan Brooks', 'OT Network Engineer', 'SCADA & Software', 'QLD', 6),
      P('Lucas Kim', 'Commissioning Engineer', 'Commissioning', 'VIC'),
      P('Sofia Rossi', 'Project Manager', 'Project Management', 'NSW'),
      P('Zoe Martin', 'Project Coordinator', 'Project Management', 'QLD', 4),
    ];
    const w = startOfWeek(todayStr());
    const Ph = (name, s, e) => ({ id: uid(), name, start: addDays(w, s), end: addDays(w, e) });
    const Pr = (name, client, color, billable = true, extra = {}) => ({
      id: uid(), name, client, color, billable, archived: false, start: '', end: '', budgetHours: null, phases: [], ...extra,
    });
    const projects = [
      // Fictional clients and jobs, phased the way OT projects usually run.
      Pr('Water Treatment SCADA Upgrade', 'Riverbend Water', COLORS[0], true, {
        start: addDays(w, -7), end: addDays(w, 41), budgetHours: 900,
        phases: [Ph('Design', -7, 8), Ph('Integration', 7, 25), Ph('FAT', 28, 32), Ph('Commissioning', 35, 38), Ph('SAT', 39, 41)],
      }),
      Pr('Substation Automation', 'Southgate Energy', COLORS[1], true, {
        start: addDays(w, -7), end: addDays(w, 60), budgetHours: 1400,
        phases: [Ph('Design', -7, 11), Ph('Integration', 14, 32), Ph('FAT', 35, 39), Ph('IFAT', 42, 46), Ph('Commissioning', 49, 55), Ph('SAT', 56, 60)],
      }),
      Pr('Packaging Line PLC Retrofit', 'Coastal Foods', COLORS[2], true, {
        start: addDays(w, 7), end: addDays(w, 32), budgetHours: 200,
        phases: [Ph('Design', 7, 13), Ph('Integration', 14, 25), Ph('FAT', 28, 32)],
      }),
      Pr('Mine Site Telemetry', 'Red Ridge Mining', COLORS[4], true, { budgetHours: 600 }),
      Pr('Pump Station Upgrades', 'Metro Water', COLORS[3]),
      Pr('Service & Support', 'In-house', COLORS[9], false),
      // Pipeline bids: modelled with unfilled slots, not yet confirmed.
      Pr('Desalination Plant Controls', 'Coastal Water', COLORS[5], true, {
        status: 'pipeline', winChance: 60, stage: 'Shortlisted', decisionDate: addDays(todayStr(), 12),
        start: addDays(w, 21), end: addDays(w, 88), budgetHours: 1100,
        phases: [Ph('Design', 21, 39), Ph('Integration', 42, 67), Ph('FAT', 70, 74), Ph('SAT', 81, 88)],
      }),
      Pr('Hospital BMS Integration', 'St Clare Health', COLORS[8], true, {
        status: 'pipeline', winChance: 80, stage: 'Shortlisted', decisionDate: addDays(todayStr(), 5),
        start: addDays(w, 14), end: addDays(w, 53), budgetHours: 420,
        phases: [Ph('Design', 14, 25), Ph('Integration', 28, 46), Ph('SAT', 49, 53)],
      }),
      Pr('Airport Baggage PLC Upgrade', 'Metro Airports', COLORS[7], true, {
        status: 'pipeline', winChance: 30, stage: 'Bidding', decisionDate: addDays(todayStr(), 26),
        start: addDays(w, 35), end: addDays(w, 102), budgetHours: 1300,
        phases: [Ph('Design', 35, 53), Ph('Integration', 56, 88), Ph('FAT', 91, 95), Ph('SAT', 98, 102)],
      }),
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
      A(0, 0, -7, 19, 6, { notes: 'Control philosophy and functional design spec' }), A(0, 2, 14, 12, 8), A(0, 5, -7, 12, 2),
      A(1, 0, -7, 12, 8), A(1, 2, 7, 19, 6), A(1, 4, 28, 12, 8, { tentative: true }),
      A(2, 0, 0, 26, 8, { notes: 'PLC code and HMI screens, ready for FAT' }), A(2, 1, 28, 19, 8),
      A(3, 3, -7, 33, 6), A(3, 1, 0, 12, 4),
      A(4, 1, -7, 26, 6), A(4, 5, 21, 12, 3),
      A(5, 0, 14, 12, 4), A(5, 1, 7, 26, 4), A(5, 3, 35, 12, 8, { tentative: true }),
      A(6, 0, -7, 47, 2), A(6, 1, -7, 47, 2), A(6, 3, -7, 47, 2),
      A(7, 4, 0, 19, 4), A(7, 2, 21, 12, 2),
      T(2, 30, 5), T(6, 14, 3, 'Conference'), T(4, 7, 1, 'Sick day'), T(0, 42, 5),
      // Pipeline staffing: some named (tentative), the rest unfilled slots by discipline.
      A(2, 6, 42, 26, 6, { notes: 'Pencilled in for PLC work if we win' }), A(3, 7, 28, 19, 6),
    ];
    const S = (disc, pj, s, len, h, notes = '') => ({
      id: uid(), type: 'task', personId: null, disciplineId: D(disc), projectId: projects[pj].id,
      start: addDays(w, s), end: addDays(w, s + len - 1), hoursPerDay: h, notes, tentative: false,
    });
    allocations.push(
      S('Controls Engineering', 6, 21, 19, 8, 'Lead controls engineer'), S('Controls Engineering', 6, 42, 26, 8),
      S('Electrical Design', 6, 21, 19, 6), S('SCADA & Software', 6, 42, 26, 6), S('Commissioning', 6, 81, 8, 8),
      S('Commissioning', 7, 49, 5, 8), S('Electrical Design', 7, 14, 12, 4),
      S('Controls Engineering', 8, 35, 19, 8), S('Controls Engineering', 8, 56, 33, 8), S('Controls Engineering', 8, 56, 33, 8),
      S('SCADA & Software', 8, 56, 33, 6), S('Commissioning', 8, 98, 5, 8),
    );
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

  // ----- pipeline: how much each booking counts under the chosen view
  const SCENARIOS = [['confirmed', 'Confirmed only'], ['all', 'Confirmed + pipeline'], ['weighted', 'Weighted by win chance']];
  const isSlot = (a) => a.type === 'task' && !a.personId;
  const isPipeline = (pr) => !!pr && pr.status === 'pipeline';
  // Is a project shown on the schedule at all? Lost projects never are; pipeline ones only when the view includes them.
  const projVisible = (pr) => !pr || (pr.status !== 'lost' && (pr.status !== 'pipeline' || ui.scenario !== 'confirmed'));
  function projWeight(pr, scenario = ui.scenario) {
    if (!pr || pr.status === 'confirmed') return 1;
    if (pr.status === 'lost') return 0;
    return scenario === 'all' ? 1 : scenario === 'weighted' ? (pr.winChance || 0) / 100 : 0;
  }
  const allocWeight = (a, scenario) => (a.type === 'timeoff' ? 1 : projWeight(findProject(a.projectId), scenario));
  const allocVisible = (a) => a.type === 'timeoff' || projVisible(findProject(a.projectId));
  const allocDiscipline = (a) => (a.personId ? (findPerson(a.personId) || {}).disciplineId || '' : a.disciplineId || '');
  const discNameById = (id) => (findDiscipline(id) || {}).name || '';
  const scenarioSelect = () => `<label class="toggle">Show <select id="scenario" title="How pipeline projects are counted">
      ${SCENARIOS.map(([v, l]) => `<option value="${v}" ${ui.scenario === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  const pipelineTag = (pr) => (pr.status === 'pipeline' ? `<span class="tag pipe" title="Pipeline · ${pr.stage}${pr.decisionDate ? ` · decision ${shortDate(pr.decisionDate)}` : ''}">Pipeline · ${pr.winChance}%</span>`
    : pr.status === 'lost' ? '<span class="tag lost">Lost</span>' : '');

  // Day-by-day load for one person. weightOf(a) says how much each booking counts (0 = ignore).
  function personDays(p, s, e, weightOf, skipId) {
    const cap = +p.capacity || 0;
    const allocs = state.allocations.filter((a) => a.personId === p.id && a.id !== skipId && a.end >= s && a.start <= e);
    const out = [];
    for (let d = s; d <= e; d = addDays(d, 1)) {
      if (isWeekend(d)) continue;
      const closed = closureFor(p, d);
      let load = 0, off = 0;
      for (const a of allocs) {
        if (d < a.start || d > a.end) continue;
        if (a.type === 'timeoff') off += +a.hoursPerDay || 0;
        else load += (+a.hoursPerDay || 0) * weightOf(a);
      }
      out.push({ d, closed, load, off, avail: closed ? 0 : Math.max(0, cap - off) });
    }
    return out;
  }
  // How well would `hoursPerDay` over s..e fit this person (under the current view)?
  function fitCheck(p, s, e, hoursPerDay, skipId) {
    const days = personDays(p, s, e, (a) => allocWeight(a), skipId);
    let free = 0, cap = 0, overDays = 0, leaveDays = 0, closedDays = 0;
    for (const x of days) {
      if (x.closed) { closedDays++; continue; }
      if (x.off >= (+p.capacity || 0) && x.off > 0) leaveDays++;
      cap += +p.capacity || 0;
      free += Math.max(0, x.avail - x.load);
      if (x.load + hoursPerDay > x.avail + 1e-9) overDays++;
    }
    return { free, freePct: cap ? (free / cap) * 100 : 0, overDays, leaveDays, closedDays, workdays: days.length - closedDays };
  }
  // People who'd be overbooked if this pipeline project wins (its bookings counted in full, other bids ignored).
  function projectClashes(pr) {
    const out = [];
    const people = new Set(state.allocations.filter((a) => a.projectId === pr.id && a.personId).map((a) => a.personId));
    for (const id of people) {
      const p = findPerson(id);
      if (!p) continue;
      const mine = state.allocations.filter((a) => a.projectId === pr.id && a.personId === id);
      const s = mine.reduce((m, a) => minS(m, a.start), mine[0].start), e = mine.reduce((m, a) => maxS(m, a.end), mine[0].end);
      const days = personDays(p, s, e, (a) => (a.projectId === pr.id ? 1 : projWeight(findProject(a.projectId), 'confirmed')));
      const over = days.filter((x) => !x.closed && x.load > x.avail + 1e-9).length;
      if (over) out.push({ p, days: over });
    }
    return out;
  }

  function personStats(p, s, e, scenario = ui.scenario) {
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
        const pr = findProject(a.projectId);
        const wh = h * projWeight(pr, scenario);
        scheduled += wh;
        if (a.tentative) tentative += wh;
        if (closed) closedWork += wh;
        if (pr && pr.billable) billable += wh;
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
    else if (ui.view === 'pipeline') renderPipeline();
    else if (ui.view === 'capacity') renderCapacity();
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
    const projOpts = state.projects.filter((p) => (!p.archived && p.status !== 'lost') || p.id === ui.projectFilter)
      .map((p) => `<option value="${p.id}" ${p.id === ui.projectFilter ? 'selected' : ''}>${esc(p.name)}${isPipeline(p) ? ` (pipeline ${p.winChance}%)` : ''}</option>`).join('');
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
      ${scenarioSelect()}
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
      // Unfilled slots sit with their discipline (or in their own group when not grouping).
      const slots = ui.search.trim() ? [] : visibleSlots(ctx);
      const slotKey = (a) => discNameById(a.disciplineId) || 'No discipline';
      const groups = new Map();
      for (const p of people) {
        const key = ui.groupBy === 'discipline' ? (discName(p) || 'No discipline') : '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
      }
      if (ui.groupBy === 'discipline') for (const a of slots) if (!groups.has(slotKey(a))) groups.set(slotKey(a), []);
      const keys = [...groups.keys()].sort((a, b) => (a === 'No discipline') - (b === 'No discipline') || a.localeCompare(b));
      for (const key of keys) {
        const members = groups.get(key);
        if (ui.groupBy === 'discipline') rows += `<div class="group"><div class="group-side">${esc(key)}<span>${members.length}</span></div><div style="width:${width}px"></div></div>`;
        for (const p of members) rows += renderRow(p, ctx);
        if (ui.groupBy === 'discipline') {
          const mine = slots.filter((a) => slotKey(a) === key);
          if (mine.length) rows += renderSlotRow(mine, ctx, { disciplineId: mine[0].disciplineId, label: `Unfilled · ${key}` });
        }
      }
      if (ui.groupBy === 'none' && slots.length) {
        rows += `<div class="group"><div class="group-side">Unfilled slots<span>${slots.length}</span></div><div style="width:${width}px"></div></div>`;
        const byDisc = new Map();
        for (const a of slots) { const k = slotKey(a); if (!byDisc.has(k)) byDisc.set(k, []); byDisc.get(k).push(a); }
        for (const [k, list] of [...byDisc].sort((a, b) => a[0].localeCompare(b[0]))) rows += renderSlotRow(list, ctx, { disciplineId: list[0].disciplineId, label: `Unfilled · ${k}` });
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
          <div class="corner">${people.length} ${people.length === 1 ? 'person' : 'people'} · utilization${ui.scenario === 'all' ? ' incl. pipeline' : ui.scenario === 'weighted' ? ' (weighted)' : ''}</div>
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
      if (!projVisible(pr)) return false;
      const booked = state.allocations.some((a) => a.projectId === pr.id && inView(a));
      const datesInView = !pr.archived && (pr.start || pr.end) && (pr.end || '9999') >= vs && (pr.start || '0000') <= rangeEnd;
      return booked || datesInView;
    }).sort((a, b) => a.name.localeCompare(b.name));
    let out = '';
    for (const pr of projects) {
      const members = people.filter((p) => state.allocations.some((a) => a.personId === p.id && a.projectId === pr.id && inView(a)));
      const slots = searching ? [] : visibleSlots(ctx).filter((a) => a.projectId === pr.id);
      if (searching && !members.length) continue;
      out += renderProjectHeader(pr, members.length, ctx);
      for (const p of members) out += renderRow(p, ctx, pr.id);
      if (slots.length) out += renderSlotRow(slots, ctx, { projectId: pr.id, label: 'Unfilled slots' });
    }
    if (!ui.projectFilter) {
      const free = people.filter((p) => visible.has(p.id) && !state.allocations.some((a) => a.personId === p.id && a.type === 'task' && allocVisible(a) && inView(a)));
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
          ${isPipeline(pr) ? `<div>${pipelineTag(pr)}</div>` : ''}
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
    const allAllocs = state.allocations.filter((a) => a.personId === p.id && a.end >= vs && a.start <= rangeEnd && allocVisible(a));
    const scoped = projectId === undefined ? allAllocs : allAllocs.filter((a) => a.type === 'timeoff' || a.projectId === projectId);
    const { lanes, count } = assignLanes(scoped);
    const height = Math.max(MIN_ROW, PAD * 2 + LOAD_SPACE + Math.max(1, count) * LANE - 4);

    // daily load
    const sched = new Array(days).fill(0), off = new Array(days).fill(0);
    for (const a of allAllocs) {
      const s = maxS(a.start, vs), e = minS(a.end, rangeEnd);
      for (let i = diffDays(vs, s), n = diffDays(vs, e); i <= n; i++) {
        if (isWeekend(dayList[i])) continue;
        if (a.type === 'timeoff') off[i] += +a.hoursPerDay || 0; else sched[i] += (+a.hoursPerDay || 0) * allocWeight(a);
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

  function visibleSlots({ vs, rangeEnd }) {
    return state.allocations.filter((a) => isSlot(a) && a.end >= vs && a.start <= rangeEnd && allocVisible(a)
      && (!ui.projectFilter || a.projectId === ui.projectFilter));
  }
  // A row of unfilled slots. Dragging a slot onto a person assigns it; drawing on this row adds a slot.
  function renderSlotRow(slots, { width, bgStyle, todayIdx, days, dayW, vs, rangeEnd }, { disciplineId, projectId, label }) {
    const { lanes, count } = assignLanes(slots);
    const height = Math.max(MIN_ROW - 8, PAD * 2 + Math.max(1, count) * LANE - 4);
    const total = slots.reduce((sum, a) => sum + hoursInRange(a, a.start, a.end), 0);
    const today = todayIdx >= 0 && todayIdx < days ? `<div class="today-col" style="left:${todayIdx * dayW}px;width:${dayW}px"></div>` : '';
    const attrs = `${disciplineId !== undefined ? ` data-discipline="${disciplineId}"` : ''}${projectId !== undefined ? ` data-project="${projectId}"` : ''}`;
    return `
      <div class="row slot-row">
        <div class="side slot-side" title="Slots for people you haven't named yet. Click one to see who could fill it, or drag it onto a person.">
          <div class="avatar slot-avatar">?</div>
          <div class="who">
            <div class="name">${esc(label)}</div>
            <div class="role">${slots.length} slot${slots.length === 1 ? '' : 's'} · ${hrs(total)}</div>
          </div>
        </div>
        <div class="track slot-track" data-slot="1"${attrs} style="width:${width}px;height:${height}px;${bgStyle}">
          ${today}${slots.map((a) => renderBar(a, lanes.get(a.id), { dayW, vs, rangeEnd })).join('')}
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
    const slot = isSlot(a);
    const pipe = isPipeline(pr);
    const title = isOff ? (a.notes || 'Time off') : slot ? (discNameById(a.disciplineId) || 'Unfilled slot') : (pr ? pr.name : 'Unknown project');
    const total = hoursInRange(a, a.start, a.end);
    const sub = isOff ? 'Time off' : slot ? `${pr ? pr.name : ''} · ${round1(a.hoursPerDay)}h/d` : `${round1(a.hoursPerDay)}h/d${g.width > 150 ? ` · ${hrs(total)}` : ''}`;
    const dim = ui.projectFilter && a.projectId !== ui.projectFilter;
    const outside = outsideProject(a, pr);
    const cls = ['bar', isOff ? 'timeoff' : '', a.tentative ? 'tentative' : '', pipe ? 'pipeline' : '', slot ? 'slot' : '',
      g.clipL ? 'clip-l' : '', g.clipR ? 'clip-r' : '', dim ? 'dim' : '', outside ? 'outside' : ''].join(' ');
    const tip = `${slot ? `Unfilled slot: ${title}\n${pr ? pr.name : ''}` : `${title}${pr && pr.client ? ` (${pr.client})` : ''}`}\n${rangeLabel(a.start, a.end)} · ${round1(a.hoursPerDay)}h/day · ${hrs(total)} total${a.tentative ? '\nTentative' : ''}`
      + `${pipe ? `\nPipeline · ${pr.winChance}% chance${pr.decisionDate ? ` · decision ${shortDate(pr.decisionDate)}` : ''}` : ''}`
      + `${slot ? '\nClick to see who could fill it, or drag it onto a person' : ''}`
      + `${outside ? `\n⚠ Outside project dates (${projectDatesLabel(pr)})` : ''}${a.notes && !isOff ? `\n${a.notes}` : ''}`;
    return `<div class="${cls}" data-id="${a.id}" title="${esc(tip)}"
      style="left:${g.left}px;width:${g.width}px;top:${PAD + lane * LANE}px;--pc:${color};${isOff || slot ? '' : `background-color:${color}`}">
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
    const rows = state.projects.filter((p) => ui.showArchived || (!p.archived && p.status !== 'lost')).map((p) => {
      const allocs = state.allocations.filter((a) => a.projectId === p.id);
      const open = allocs.filter(isSlot).length;
      const total = allocs.reduce((s, a) => s + hoursInRange(a, a.start, a.end), 0);
      const upcoming = allocs.reduce((s, a) => s + hoursInRange(a, today, a.end), 0);
      const people = new Set(allocs.filter((a) => a.personId).map((a) => a.personId)).size;
      const outsideN = allocs.filter((a) => outsideProject(a, p)).length;
      return `<tr>
        <td><span class="dot" style="background:${p.color}"></span><b>${esc(p.name)}</b> ${pipelineTag(p)} ${p.archived ? '<span class="tag">Archived</span>' : ''}</td>
        <td>${esc(p.client || '—')}</td>
        <td>${p.billable ? '<span class="tag ok">Billable</span>' : '<span class="tag">Non-billable</span>'}</td>
        <td class="num">${people}${open ? ` <span class="tag slot-tag" title="Unfilled slots">+${open} open</span>` : ''}</td>
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
      <button class="btn" data-act="new-discipline">+ Discipline</button>
      <span class="spacer"></span>${scenarioSelect()}`;
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
      </div>
      <span class="spacer"></span>${scenarioSelect()}`;
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

    // People's hours only (unfilled slots aren't anyone's time yet), weighted by the chosen view.
    const projHours = state.projects.map((p) => {
      const list = state.allocations.filter((a) => a.projectId === p.id && a.personId);
      const w = projWeight(p);
      return { p, h: list.reduce((sum, a) => sum + hoursInRange(a, s, e), 0) * w, people: new Set(list.filter((a) => hoursInRange(a, s, e) > 0).map((a) => a.personId)).size };
    }).filter((x) => x.h > 0).sort((a, b) => b.h - a.h);
    const maxH = Math.max(1, ...projHours.map((x) => x.h));
    const projRows = projHours.map(({ p, h, people }) => `<tr>
      <td><span class="dot" style="background:${p.color}"></span>${esc(p.name)} ${pipelineTag(p)}</td><td>${esc(p.client || '—')}</td>
      <td class="num">${people}</td>
      <td><div class="hbar"><div class="meter"><i style="width:${(h / maxH) * 100}%;background:${p.color}"></i></div><span>${hrs(h)}</span></div></td>
      <td class="num">${totals.scheduled ? pct((h / totals.scheduled) * 100) : '—'}</td></tr>`).join('');

    const util = totals.capacity ? (totals.scheduled / totals.capacity) * 100 : 0;
    const tile = (k, v) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    main.innerHTML = `<div class="page">
      <h2>Report</h2><p class="lede">${rangeLabel(s, e)} · ${workdays(s, e)} working days · ${SCENARIOS.find((x) => x[0] === ui.scenario)[1].toLowerCase()}</p>
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

  // ----- pipeline (potential wins)
  function projectNeed(pr) {
    const allocs = state.allocations.filter((a) => a.projectId === pr.id && a.type === 'task');
    let total = 0, filled = 0;
    const byDisc = new Map();
    for (const a of allocs) {
      const h = hoursInRange(a, a.start, a.end);
      total += h;
      if (a.personId) filled += h;
      const k = discNameById(allocDiscipline(a)) || 'No discipline';
      byDisc.set(k, (byDisc.get(k) || 0) + h);
    }
    return { total, filled, open: total - filled, slots: allocs.filter(isSlot).length, byDisc: [...byDisc].sort((a, b) => b[1] - a[1]) };
  }
  function renderPipeline() {
    $('#schedule')?.remove();
    main.className = '';
    toolbar.innerHTML = `<button class="btn primary" data-act="new-pipeline">+ Pipeline project</button>
      <button class="btn" data-act="see-capacity">See capacity vs demand →</button>
      <span class="spacer"></span><span class="hint">Model potential wins without changing anyone's real workload.</span>`;
    const today = todayStr();
    const bids = state.projects.filter((p) => p.status === 'pipeline').sort((a, b) => (a.decisionDate || '9999') < (b.decisionDate || '9999') ? -1 : 1);
    const lost = state.projects.filter((p) => p.status === 'lost');
    let tAll = 0, tWeighted = 0, tOpen = 0;
    const clashPeople = new Set();
    const rows = bids.map((p) => {
      const need = projectNeed(p);
      const clashes = projectClashes(p);
      clashes.forEach((c) => clashPeople.add(c.p.id));
      tAll += need.total; tWeighted += need.total * (p.winChance / 100); tOpen += need.open;
      const filledPct = need.total ? (need.filled / need.total) * 100 : 0;
      const days = p.decisionDate ? diffDays(today, p.decisionDate) : null;
      const when = days === null ? '<span class="hint">Not set</span>'
        : `${shortDate(p.decisionDate)} <span class="${days < 0 ? 'over-text' : 'hint'}">${days < 0 ? `${-days}d overdue` : days === 0 ? 'today' : `in ${days}d`}</span>`;
      const chips = need.byDisc.slice(0, 3).map(([k, h]) => `<span class="need-chip">${esc(k)} ${hrs(h)}</span>`).join('')
        + (need.byDisc.length > 3 ? `<span class="need-chip">+${need.byDisc.length - 3}</span>` : '');
      return `<tr>
        <td><span class="dot" style="background:${p.color}"></span><b>${esc(p.name)}</b><div class="hint">${esc(p.client || '')}${p.client ? ' · ' : ''}${esc(p.stage)}</div></td>
        <td><div class="hbar win"><div class="meter"><i style="width:${p.winChance}%"></i></div><span>${p.winChance}%</span></div></td>
        <td>${when}</td>
        <td>${projectDatesLabel(p) || '<span class="hint">Not set</span>'}</td>
        <td><div class="need">${chips || '<span class="hint">No slots yet</span>'}</div></td>
        <td><div class="hbar" title="${hrs(need.filled)} of ${hrs(need.total)} assigned to people"><div class="meter ${filledPct >= 99.5 ? 'full' : ''}"><i style="width:${filledPct}%"></i></div><span>${pct(filledPct)}</span></div>
          ${need.slots ? `<span class="hint">${need.slots} open slot${need.slots === 1 ? '' : 's'} · ${hrs(need.open)}</span>` : ''}</td>
        <td>${clashes.length ? `<span class="tag danger-tag" title="${esc(clashes.map((c) => `${c.p.name}: overbooked ${c.days} day${c.days === 1 ? '' : 's'}`).join('\n'))}">${clashes.length} ${clashes.length === 1 ? 'person' : 'people'}</span>` : '<span class="tag ok">None</span>'}</td>
        <td><div class="actions pipe-actions">
          <button class="btn sm" data-act="view-project" data-id="${p.id}">Schedule</button>
          <button class="btn sm" data-act="edit-project" data-id="${p.id}">Edit</button>
          <button class="btn sm won-btn" data-act="win-project" data-id="${p.id}">Won</button>
          <button class="btn sm" data-act="lose-project" data-id="${p.id}">Lost</button>
        </div></td></tr>`;
    }).join('');
    const tile = (k, v, hint = '') => `<div class="tile" ${hint ? `title="${esc(hint)}"` : ''}><div class="k">${k}</div><div class="v">${v}</div></div>`;
    main.innerHTML = `<div class="page">
      <h2>Pipeline</h2>
      <p class="lede">Potential wins. Plan the people each one needs with unfilled slots, try names in them, then mark a project as won to make it real.
        Use <b>Show</b> on the Schedule to see the effect on everyone's workload.</p>
      <div class="tiles">
        ${tile('Open bids', bids.length)}
        ${tile('Hours if all win', hrs(tAll))}
        ${tile('Weighted hours', hrs(tWeighted), 'Each bid counted by its win chance')}
        ${tile('Unfilled hours', hrs(tOpen), 'Hours in slots with nobody named yet')}
        ${tile('People with clashes', clashPeople.size, 'People who would be overbooked if their bid wins')}
      </div>
      <div class="card"><div class="table-wrap"><table class="pipe-table">
        <thead><tr><th>Project</th><th>Win chance</th><th>Decision</th><th>Dates</th><th>Hours needed</th><th>Filled</th><th>Clashes</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8"><div class="empty-state" style="padding:30px"><h3>No pipeline projects yet</h3>
          <p>Add a potential win, then add unfilled slots for the disciplines it needs.</p>
          <button class="btn primary" data-act="new-pipeline">+ Pipeline project</button></div></td></tr>`}</tbody>
      </table></div></div>
      ${lost.length ? `<div class="card"><h3>Lost</h3><div class="table-wrap"><table>
        <thead><tr><th>Project</th><th>Client</th><th>Decision</th><th class="num">Hours modelled</th><th></th></tr></thead>
        <tbody>${lost.map((p) => `<tr><td><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</td><td>${esc(p.client || '—')}</td>
          <td>${p.decisionDate ? shortDate(p.decisionDate) : '—'}</td><td class="num">${hrs(projectNeed(p).total)}</td>
          <td><div class="actions"><button class="btn sm" data-act="reopen-project" data-id="${p.id}">Reopen</button></div></td></tr>`).join('')}</tbody>
      </table></div></div>` : ''}
    </div>`;
  }

  function openWinModal(pr) {
    const allocs = state.allocations.filter((a) => a.projectId === pr.id);
    const oldStart = pr.start || (allocs.length ? allocs.reduce((m, a) => minS(m, a.start), allocs[0].start) : '');
    const need = projectNeed(pr);
    modal({
      title: `Mark "${pr.name}" as won`,
      body: `
        <p style="margin:0">It becomes a confirmed project, and its bookings become firm.</p>
        <label class="field">Start date${oldStart ? '' : ' (optional)'}<input type="date" name="start" value="${oldStart}"></label>
        <p class="summary" id="winSummary"></p>`,
      footer: saveFooter().replace('>Save<', '>Mark as won<'),
      mount(form) {
        const sync = () => {
          const ns = form.start.value;
          const shift = oldStart && ns ? diffDays(oldStart, ns) : 0;
          let msg = shift ? `Moves the project, its ${pr.phases.length} phase${pr.phases.length === 1 ? '' : 's'} and ${allocs.length} booking${allocs.length === 1 ? '' : 's'} ${Math.abs(shift)} day${Math.abs(shift) === 1 ? '' : 's'} ${shift > 0 ? 'later' : 'earlier'}.`
            : 'Dates stay as they are. Change the start date if the award has moved it.';
          if (need.slots) msg += `<br><span class="hol-note">${need.slots} unfilled slot${need.slots === 1 ? '' : 's'} (${hrs(need.open)}) will still need people.</span>`;
          $('#winSummary', form).innerHTML = msg;
        };
        form.addEventListener('input', sync);
        sync();
      },
      onSubmit(fd) {
        const ns = fd.get('start');
        const shift = oldStart && ns ? diffDays(oldStart, ns) : 0;
        const mv = (d) => (d ? addDays(d, shift) : d);
        commit((st) => {
          const x = st.projects.find((y) => y.id === pr.id);
          x.status = 'confirmed';
          x.start = mv(x.start); x.end = mv(x.end);
          x.phases.forEach((ph) => { ph.start = mv(ph.start); ph.end = mv(ph.end); });
          for (const a of st.allocations) if (a.projectId === pr.id) { a.start = mv(a.start); a.end = mv(a.end); a.tentative = false; }
        });
        toast(need.slots ? `Won! ${need.slots} unfilled slot${need.slots === 1 ? '' : 's'} still need people` : 'Won! Now a confirmed project');
      },
    });
  }
  function markLost(pr) {
    if (!confirm(`Mark "${pr.name}" as lost?\n\nIts bookings are kept for the record but no longer appear on the schedule or count towards anyone's workload. You can reopen it later.`)) return;
    commit((st) => { st.projects.find((y) => y.id === pr.id).status = 'lost'; });
    if (ui.projectFilter === pr.id) ui.projectFilter = '';
    toast('Marked as lost — Ctrl+Z to undo');
  }

  // ----- capacity vs demand (forecast by discipline, week by week)
  const FC_RANGES = [[12, 'Next 12 weeks'], [26, 'Next 26 weeks'], [52, 'Next 52 weeks']];
  const fcExcluded = () => new Set(ui.fcExclude || []);
  // How much a project's work counts in the forecast: confirmed in full, bids by the Show switch, unless switched off here.
  function fcWeight(pr, excluded) {
    if (!pr || pr.status === 'lost') return 0;
    if (pr.status === 'pipeline' && excluded.has(pr.id)) return 0;
    return projWeight(pr);
  }
  function forecast(weeks) {
    const excluded = fcExcluded();
    const discs = [...sortedDisciplines(), { id: '', name: 'No discipline' }];
    const blank = () => weeks.map((ws) => ({ ws, cap: 0, confirmed: 0, pipeline: 0, unfilled: 0, bids: new Map() }));
    const rows = new Map(discs.map((d) => [d.id, { id: d.id, name: d.name, people: 0, weeks: blank() }]));
    const total = { id: '*', name: 'All disciplines', people: state.people.length, weeks: blank() };
    const first = weeks[0], last = addDays(weeks[weeks.length - 1], 6);
    for (const p of state.people) {
      const row = rows.get(rows.has(p.disciplineId) ? p.disciplineId : '');
      row.people++;
      weeks.forEach((ws, i) => {
        const c = personStats(p, ws, addDays(ws, 6), 'confirmed').capacity;
        row.weeks[i].cap += c; total.weeks[i].cap += c;
      });
    }
    for (const a of state.allocations) {
      if (a.type !== 'task' || a.end < first || a.start > last) continue;
      const pr = findProject(a.projectId);
      const w = fcWeight(pr, excluded);
      if (!w) continue;
      const d = allocDiscipline(a);
      const row = rows.get(rows.has(d) ? d : '');
      const bucket = isSlot(a) ? 'unfilled' : pr.status === 'pipeline' ? 'pipeline' : 'confirmed';
      weeks.forEach((ws, i) => {
        const h = hoursInRange(a, ws, addDays(ws, 6)) * w;
        if (!h) return;
        for (const wk of [row.weeks[i], total.weeks[i]]) {
          wk[bucket] += h;
          if (pr.status === 'pipeline') wk.bids.set(pr.id, (wk.bids.get(pr.id) || 0) + h);
        }
      });
    }
    const list = [...rows.values()].filter((r) => r.people || r.weeks.some((x) => x.confirmed + x.pipeline + x.unfilled > 0));
    return { total, list };
  }
  const demandOf = (x) => x.confirmed + x.pipeline + x.unfilled;
  function shortfall(row) {
    const short = row.weeks.filter((x) => demandOf(x) > x.cap + 0.05);
    const hoursShort = short.reduce((sum, x) => sum + demandOf(x) - x.cap, 0);
    const bids = new Map();
    for (const x of short) for (const [id, h] of x.bids) bids.set(id, (bids.get(id) || 0) + h);
    return { weeks: short, hours: hoursShort, bids: [...bids].sort((a, b) => b[1] - a[1]) };
  }
  // Axis top = 4 round steps (e.g. 0/25/50/75/100 or 0/50/100/150/200), so tick labels stay whole numbers.
  function niceMax(v) {
    if (v <= 0) return 20;
    const raw = v / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return 4 * m * p;
    return 40 * p;
  }
  // Stacked weekly demand (confirmed, named pipeline, unfilled) against a capacity step line, all on one hours axis.
  function fcChart(row, { height = 220, key, width = 760 }) {
    const W = Math.max(280, Math.round(width)), H = height, L = 46, Rm = 10, T = 22, B = 26;
    const n = row.weeks.length, band = (W - L - Rm) / n, bw = Math.max(3, band * 0.62);
    const max = niceMax(Math.max(...row.weeks.map((x) => Math.max(x.cap, demandOf(x)))) * 1.08);
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
    let svg = `<svg class="fc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(row.name)}: weekly demand against capacity">`;
    for (const t of ticks) {
      svg += `<line class="fc-gl${t === 0 ? ' base' : ''}" x1="${L}" x2="${W - Rm}" y1="${y(t)}" y2="${y(t)}"/>`
        + `<text class="fc-tick" x="${L - 6}" y="${y(t) + 3.5}" text-anchor="end">${Math.round(t)}h</text>`;
    }
    const every = Math.max(1, Math.ceil(54 / band));
    row.weeks.forEach((x, i) => {
      const x0 = L + i * band, bx = x0 + (band - bw) / 2;
      const segs = [['confirmed', x.confirmed], ['pipeline', x.pipeline], ['unfilled', x.unfilled]].filter((sg) => sg[1] > 0);
      let acc = 0;
      segs.forEach(([k, v], j) => {
        const top = y(acc + v), bottom = y(acc) - (j > 0 ? 2 : 0); // 2px surface gap between stacked segments
        acc += v;
        const h = bottom - top;
        if (h <= 0.5) return;
        const r = j === segs.length - 1 ? Math.min(4, h / 2, bw / 2) : 0; // rounded data end on the top segment only
        svg += `<path class="fc-seg fc-${k}" d="M${bx},${bottom} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + bw - r} Q${bx + bw},${top} ${bx + bw},${top + r} V${bottom} Z"/>`;
      });
      const gap = demandOf(x) - x.cap;
      if (gap > 0.05 && band >= 26) {
        svg += `<text class="fc-short" x="${x0 + band / 2}" y="${Math.max(11, y(Math.max(demandOf(x), x.cap)) - 6)}" text-anchor="middle">▲ ${Math.round(gap)}h</text>`;
      }
      if (i % every === 0) svg += `<text class="fc-tick" x="${x0 + band / 2}" y="${H - 8}" text-anchor="middle">${shortDate(x.ws)}</text>`;
      svg += `<rect class="fc-hit" data-fc="${key}" data-i="${i}" x="${x0}" y="${T}" width="${band}" height="${H - T - B}"/>`;
    });
    let d = '';
    row.weeks.forEach((x, i) => { const x0 = L + i * band, x1 = x0 + band; d += `${i ? 'V' : 'M' + x0 + ','}${y(x.cap)} H${x1} `; });
    svg += `<path class="fc-cap" d="${d}"/>`;
    return svg + '</svg>';
  }
  function fcTable(row) {
    return `<details class="fc-table"><summary>Show data table</summary><div class="table-wrap"><table>
      <thead><tr><th>Week of</th><th class="num">Capacity</th><th class="num">Confirmed</th><th class="num">Pipeline (named)</th><th class="num">Unfilled slots</th><th class="num">Total demand</th><th class="num">Gap</th></tr></thead>
      <tbody>${row.weeks.map((x) => { const g = x.cap - demandOf(x); return `<tr><td>${shortDate(x.ws)}</td><td class="num">${hrs(x.cap)}</td><td class="num">${hrs(x.confirmed)}</td>
        <td class="num">${hrs(x.pipeline)}</td><td class="num">${hrs(x.unfilled)}</td><td class="num">${hrs(demandOf(x))}</td>
        <td class="num ${g < -0.05 ? 'over-text' : ''}">${g < -0.05 ? `${hrs(-g)} short` : `${hrs(g)} spare`}</td></tr>`; }).join('')}</tbody></table></div></details>`;
  }
  function fcSummary(row) {
    const sf = shortfall(row);
    if (!sf.weeks.length) {
      const spare = row.weeks.reduce((sum, x) => sum + Math.max(0, x.cap - demandOf(x)), 0);
      return `<p class="fc-sum ok"><span class="fc-icon ok" aria-hidden="true">✓</span><span><b>Enough people.</b> ${hrs(spare)} spare across these weeks.</span></p>`;
    }
    const range = sf.weeks.length === 1 ? `in the week of ${shortDate(sf.weeks[0].ws)}` : `over ${sf.weeks.length} weeks between ${shortDate(sf.weeks[0].ws)} and ${shortDate(addDays(sf.weeks[sf.weeks.length - 1].ws, 6))}`;
    const bids = sf.bids.slice(0, 3).map(([id, h]) => `${esc((findProject(id) || {}).name || '')} (${hrs(h)})`).join(', ');
    return `<p class="fc-sum bad"><span class="fc-icon bad" aria-hidden="true">!</span><span><b>${hrs(sf.hours)} short</b> ${range}.${bids ? ` Bids adding to it: ${bids}.` : ''}</span></p>`;
  }
  let fcRows = {};
  function renderCapacity() {
    $('#schedule')?.remove();
    main.className = '';
    const n = ui.fcWeeks || 12;
    const start = startOfWeek(todayStr());
    const weeks = Array.from({ length: n }, (_, i) => addDays(start, i * 7));
    const bids = state.projects.filter(isPipeline);
    const excluded = fcExcluded();
    toolbar.innerHTML = `<label class="toggle">Range <select id="fcWeeks">${FC_RANGES.map(([v, l]) => `<option value="${v}" ${v === n ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${scenarioSelect()}<span class="spacer"></span>
      <button class="btn" data-act="fc-csv">Export CSV</button>`;
    const { total, list } = forecast(weeks);
    fcRows = { '*': total };
    list.forEach((r) => { fcRows[r.id || '_none'] = r; });
    const legend = `<div class="fc-legend" aria-label="Legend">
      <span><i class="sw fc-confirmed"></i>Confirmed work</span>
      ${ui.scenario === 'confirmed' ? '' : '<span><i class="sw fc-pipeline"></i>Pipeline (named people)</span>'}
      <span><i class="sw fc-unfilled"></i>Unfilled slots</span>
      <span><i class="ln"></i>Capacity (after leave &amp; holidays)</span>
      <span><b class="fc-short-key">▲</b>Hours short</span></div>`;
    const bidChips = bids.length ? `<div class="fc-bids"><span class="hint">Bids included:</span>
      ${bids.map((pr) => `<button class="chip-toggle ${excluded.has(pr.id) ? '' : 'on'}" data-act="fc-toggle-bid" data-id="${pr.id}" aria-pressed="${!excluded.has(pr.id)}"
        ${ui.scenario === 'confirmed' ? 'disabled title="Change Show to include pipeline work"' : ''}><span class="dot" style="background:${pr.color}"></span>${esc(pr.name)} · ${pr.winChance}%</button>`).join('')}
      ${ui.scenario === 'confirmed' ? '<span class="hint">Set <b>Show</b> to include pipeline work to test bids.</span>' : ''}</div>` : '';
    const ranked = [...list].sort((a, b) => shortfall(b).hours - shortfall(a).hours || a.name.localeCompare(b.name));
    main.innerHTML = `<div class="page">
      <h2>Capacity vs demand</h2>
      <p class="lede">Each discipline's available hours (after leave and public holidays) against the work booked or planned for it, week by week.
        Use <b>Show</b> and the bid buttons to test what happens if particular bids win.</p>
      ${bidChips}${legend}
      <div class="card fc-card"><h3>All disciplines · ${total.people} people</h3>${fcSummary(total)}<div class="fc-chart" data-key="*" data-h="260"></div>${fcTable(total)}</div>
      <div class="fc-grid">${ranked.map((r) => `<div class="card fc-card"><h3>${esc(r.name)} · ${r.people} ${r.people === 1 ? 'person' : 'people'}</h3>
        ${fcSummary(r)}<div class="fc-chart" data-key="${r.id || '_none'}" data-h="210"></div>${fcTable(r)}</div>`).join('')}</div>
    </div>
    <div class="fc-tip" id="fcTip" hidden></div>`;
    drawFcCharts();
  }
  // Charts are drawn at their real on-screen width so text stays the same size at any width.
  function drawFcCharts() {
    document.querySelectorAll('.fc-chart').forEach((el) => {
      el.innerHTML = fcChart(fcRows[el.dataset.key], { key: el.dataset.key, height: +el.dataset.h, width: el.clientWidth });
    });
  }
  let fcResize = 0;
  window.addEventListener('resize', () => { clearTimeout(fcResize); fcResize = setTimeout(() => { if (ui.view === 'capacity') drawFcCharts(); }, 120); });
  function fcTooltip(e) {
    const tip = $('#fcTip');
    if (!tip) return;
    const hit = e.target.closest && e.target.closest('.fc-hit');
    document.querySelectorAll('.fc-hit.on').forEach((el) => { if (el !== hit) el.classList.remove('on'); });
    if (!hit) { tip.hidden = true; return; }
    hit.classList.add('on');
    const row = fcRows[hit.dataset.fc], x = row.weeks[+hit.dataset.i];
    const gap = x.cap - demandOf(x);
    const bidLines = [...x.bids].sort((a, b) => b[1] - a[1]).map(([id, h]) => `<div class="fc-tip-sub">${esc((findProject(id) || {}).name || '')}: ${hrs(h)}</div>`).join('');
    tip.innerHTML = `<b>${esc(row.name)} · week of ${shortDate(x.ws)}</b>
      <div><span>Capacity</span><b>${hrs(x.cap)}</b></div>
      <div><span><i class="sw fc-confirmed"></i>Confirmed</span><b>${hrs(x.confirmed)}</b></div>
      ${ui.scenario === 'confirmed' ? '' : `<div><span><i class="sw fc-pipeline"></i>Pipeline (named)</span><b>${hrs(x.pipeline)}</b></div>`}
      <div><span><i class="sw fc-unfilled"></i>Unfilled slots</span><b>${hrs(x.unfilled)}</b></div>
      ${bidLines ? `<div class="fc-tip-head">From bids</div>${bidLines}` : ''}
      <div class="fc-tip-gap ${gap < -0.05 ? 'bad' : ''}"><span>${gap < -0.05 ? '▲ Short' : 'Spare'}</span><b>${hrs(Math.abs(gap))}</b></div>`;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = e.clientX + 14, top = e.clientY + 14;
    if (left + r.width > window.innerWidth - 8) left = e.clientX - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = e.clientY - r.height - 14;
    tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  }
  main.addEventListener('mousemove', (e) => { if (ui.view === 'capacity') fcTooltip(e); });
  main.addEventListener('mouseleave', () => { const t = $('#fcTip'); if (t) t.hidden = true; });
  function fcCsv() {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Discipline', 'Week of', 'Capacity', 'Confirmed', 'Pipeline (named)', 'Unfilled slots', 'Total demand', 'Gap'].join(',')];
    for (const r of Object.values(fcRows)) for (const x of r.weeks) {
      lines.push([r.name, x.ws, round1(x.cap), round1(x.confirmed), round1(x.pipeline), round1(x.unfilled), round1(demandOf(x)), round1(x.cap - demandOf(x))].map(q).join(','));
    }
    download(`baseline-capacity-${todayStr()}.csv`, lines.join('\n'), 'text/csv');
    toast('Capacity CSV exported');
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
    // personId === null means an unfilled slot: demand for a discipline before anyone is named.
    const slotMode = input.personId === null;
    const person = slotMode ? null : findPerson(input.personId) || state.people[0];
    const a = { type: 'task', projectId: '', hoursPerDay: person ? person.capacity : 8, notes: '', tentative: false, start: todayStr(), end: todayStr(), disciplineId: '',
      ...input, personId: person ? person.id : '' };
    if (!a.projectId) a.projectId = (state.projects.find((p) => !p.archived && p.status !== 'lost') || {}).id || '';
    const projects = state.projects.filter((p) => (!p.archived && p.status !== 'lost') || p.id === a.projectId);
    const personOpts = `<option value="" ${slotMode ? 'selected' : ''}>— Unfilled slot (name someone later) —</option>`
      + state.people.map((p) => `<option value="${p.id}" ${p.id === a.personId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    const projOpts = projects.map((p) => `<option value="${p.id}" ${p.id === a.projectId ? 'selected' : ''}>${esc(p.name)}${p.client ? ` — ${esc(p.client)}` : ''}${isPipeline(p) ? ` (pipeline ${p.winChance}%)` : ''}</option>`).join('');
    const discOpts = `<option value="">Any discipline</option>${sortedDisciplines().map((d) => `<option value="${d.id}" ${d.id === a.disciplineId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}`;
    modal({
      title: isNew ? (slotMode ? 'Add unfilled slot' : 'Schedule work') : (a.type === 'timeoff' ? 'Edit time off' : slotMode ? 'Unfilled slot' : 'Edit allocation'),
      wide: true,
      body: `
        <div class="seg">
          <label><input type="radio" name="type" value="task" ${a.type === 'task' ? 'checked' : ''}> Project work</label>
          <label><input type="radio" name="type" value="timeoff" ${a.type === 'timeoff' ? 'checked' : ''}> Time off</label>
        </div>
        <label class="field">Person<select name="personId">${personOpts}</select></label>
        <div class="grid2 slot-only">
          <label class="field">Discipline needed<select name="disciplineId">${discOpts}</select></label>
          ${isNew ? '<label class="field">How many people<input type="number" name="count" min="1" max="20" step="1" value="1"></label>' : '<span></span>'}
        </div>
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
        <p class="summary" id="allocSummary"></p>
        <div class="field slot-only"><span>Who could fill it</span><div class="suggest" id="suggest"></div></div>`,
      footer: saveFooter(isNew ? '' : `<button type="button" class="btn danger" id="delAlloc">Delete</button><button type="button" class="btn" id="dupAlloc">Duplicate</button>`),
      mount(form) {
        const sync = () => {
          const fd = new FormData(form);
          const off = fd.get('type') === 'timeoff';
          const slot = !off && !fd.get('personId');
          form.querySelectorAll('.proj-only').forEach((el) => { el.style.display = off ? 'none' : ''; });
          form.querySelectorAll('.slot-only').forEach((el) => { el.style.display = slot ? '' : 'none'; });
          $('.notes-label', form).textContent = off ? 'Reason' : 'Notes';
          let s = fd.get('start'), e = fd.get('end');
          if (s && e) {
            if (e < s) [s, e] = [e, s];
            const wd = workdays(s, e), h = +fd.get('hoursPerDay') || 0;
            const p = findPerson(fd.get('personId'));
            const n = slot && isNew ? clamp(Math.round(+fd.get('count') || 1), 1, 20) : 1;
            let msg = `${wd} working day${wd === 1 ? '' : 's'} · <b>${hrs(wd * h * n)}</b> total${n > 1 ? ` (${n} people)` : ''}`;
            if (slot) renderSuggestions(form, s, e, h, fd.get('disciplineId'));
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
              const after = projectUsed(pr) - selfTotal + wd * h * n;
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
        // "Assign" on a suggestion: save the form as a booking for that person.
        $('#suggest', form).addEventListener('click', (ev) => {
          const btn = ev.target.closest('[data-assign]');
          if (!btn) return;
          const data = collect(new FormData(form));
          if (typeof data === 'string') { const err = $('.error', form); err.textContent = data; err.hidden = false; return; }
          const who = findPerson(btn.dataset.assign);
          const booking = { ...data, personId: who.id };
          delete booking.disciplineId;
          commit((st) => {
            if (isNew) st.allocations.push({ id: uid(), ...booking });
            else { const x = st.allocations.find((y) => y.id === a.id); Object.assign(x, booking); delete x.disciplineId; }
          });
          closeModal(); toast(`Assigned to ${who.name}`);
        });
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
        const data = collect(fd);
        if (typeof data === 'string') return data;
        const n = !data.personId && isNew ? clamp(Math.round(+fd.get('count') || 1), 1, 20) : 1;
        commit((st) => {
          if (isNew) for (let i = 0; i < n; i++) st.allocations.push({ id: uid(), ...data });
          else {
            const x = st.allocations.find((y) => y.id === a.id);
            Object.assign(x, data);
            if (data.personId) delete x.disciplineId;
          }
        });
        toast(isNew ? (data.personId ? 'Scheduled' : `${n} unfilled slot${n === 1 ? '' : 's'} added`) : 'Saved');
      },
    });
    // Reads the form into a booking, or returns an error message.
    function collect(fd) {
      const type = fd.get('type');
      let start = fd.get('start'), end = fd.get('end');
      const hoursPerDay = +fd.get('hoursPerDay');
      const personId = fd.get('personId') || null;
      if (!start || !end) return 'Please choose start and end dates.';
      if (end < start) [start, end] = [end, start];
      if (!(hoursPerDay > 0) || hoursPerDay > 24) return 'Hours per day must be between 0.25 and 24.';
      if (type === 'task' && !fd.get('projectId')) return 'Please choose or create a project.';
      if (type === 'timeoff' && !personId) return 'Time off needs a person.';
      const data = {
        type, personId, projectId: type === 'task' ? fd.get('projectId') : null,
        start, end, hoursPerDay, notes: (fd.get('notes') || '').trim(), tentative: type === 'task' && fd.get('tentative') === 'on',
      };
      if (!personId) data.disciplineId = fd.get('disciplineId') || '';
      return data;
    }
    // People ranked by how well they'd fit: matching discipline first, then most free.
    function renderSuggestions(form, s, e, h, disciplineId) {
      const box = $('#suggest', form);
      const ranked = state.people.map((p) => ({ p, fit: fitCheck(p, s, e, h, isNew ? undefined : a.id), match: !disciplineId || p.disciplineId === disciplineId }))
        .sort((x, y) => (y.match - x.match) || (y.fit.freePct - x.fit.freePct));
      const shown = ranked; // matching discipline first, then the best of everyone else
      if (!shown.length) { box.innerHTML = '<p class="hint" style="margin:0">No people yet.</p>'; return; }
      box.innerHTML = shown.slice(0, 8).map(({ p, fit, match }) => {
        const notes = [];
        if (fit.leaveDays) notes.push(`on leave ${fit.leaveDays} day${fit.leaveDays === 1 ? '' : 's'}`);
        if (fit.closedDays) notes.push(`${fit.closedDays} holiday day${fit.closedDays === 1 ? '' : 's'}`);
        const status = fit.overDays ? `<span class="s-bad">would be overbooked on ${fit.overDays} day${fit.overDays === 1 ? '' : 's'}</span>` : '<span class="s-ok">fits</span>';
        return `<div class="s-row">
          <div class="avatar" style="background:${p.color || hashColor(p.name)}">${esc(initials(p.name))}</div>
          <div class="s-who"><b>${esc(p.name)}</b><span>${esc(discName(p) || 'No discipline')}${match ? '' : ' · different discipline'}</span></div>
          <div class="s-fit"><div class="meter ${fit.freePct < 20 ? 'over' : ''}"><i style="width:${Math.min(100, fit.freePct)}%"></i></div>
            <span>${pct(fit.freePct)} free · ${status}${notes.length ? ` · ${notes.join(', ')}` : ''}</span></div>
          <button type="button" class="btn sm" data-assign="${p.id}">Assign</button>
        </div>`;
      }).join('') + (shown.length > 8 ? `<p class="hint" style="margin:4px 0 0">${shown.length - 8} more not shown.</p>` : '')
        + (ui.scenario === 'confirmed' ? '' : `<p class="hint" style="margin:4px 0 0">Free time is based on "${SCENARIOS.find((x) => x[0] === ui.scenario)[1]}".</p>`);
    }
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

  function openProjectModal(p, defaults = {}) {
    const isNew = !p;
    p = p || { name: '', client: '', color: COLORS[state.projects.length % COLORS.length], billable: true, archived: false, start: '', end: '', budgetHours: null, phases: [],
      status: 'confirmed', winChance: 50, stage: 'Bidding', decisionDate: '', ...defaults };
    const templates = state.projects.filter((x) => x.phases.length || state.allocations.some((a) => a.projectId === x.id && a.type === 'task'));
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
      title: isNew ? (p.status === 'pipeline' ? 'New pipeline project' : 'New project') : 'Edit project',
      wide: true,
      body: `
        <div class="seg">
          <label><input type="radio" name="status" value="confirmed" ${p.status === 'confirmed' ? 'checked' : ''}> Confirmed</label>
          <label><input type="radio" name="status" value="pipeline" ${p.status === 'pipeline' ? 'checked' : ''}> Pipeline (potential win)</label>
          ${p.status === 'lost' ? '<label><input type="radio" name="status" value="lost" checked> Lost</label>' : ''}
        </div>
        <label class="field">Project name<input name="name" value="${esc(p.name)}" required placeholder="e.g. Pump Station Upgrade"></label>
        <div class="grid3 pipe-only">
          <label class="field">Win chance (%)<input type="number" name="winChance" min="0" max="100" step="5" value="${p.winChance}"></label>
          <label class="field">Decision expected<input type="date" name="decisionDate" value="${p.decisionDate}"></label>
          <label class="field">Stage<select name="stage">${['Bidding', 'Shortlisted'].map((x) => `<option ${x === p.stage ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        </div>
        ${isNew && templates.length ? `<label class="field">Copy phases and staffing from (optional)<select name="template">
            <option value="">— Start blank —</option>${templates.map((x) => `<option value="${x.id}">${esc(x.name)}${x.client ? ` — ${esc(x.client)}` : ''}</option>`).join('')}</select>
          <span class="hint" style="font-weight:400">Phases are copied, and each booking becomes an unfilled slot for that person's discipline, moved to your start date.</span></label>` : ''}
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
        const syncStatus = () => {
          const pipe = new FormData(form).get('status') === 'pipeline';
          form.querySelectorAll('.pipe-only').forEach((el) => { el.style.display = pipe ? '' : 'none'; });
        };
        form.addEventListener('change', syncStatus);
        syncStatus();
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
        const status = fd.get('status') || 'confirmed';
        const winChance = clamp(Math.round(+fd.get('winChance') || 0), 0, 100);
        const data = { name, client: (fd.get('client') || '').trim(), color: fd.get('color') || COLORS[0], billable: fd.get('billable') === 'on', archived: fd.get('archived') === 'on',
          start, end, budgetHours: budgetHours || null, phases,
          status, winChance, stage: fd.get('stage') || 'Bidding', decisionDate: fd.get('decisionDate') || '' };
        // Optional template: copy its phases, and turn its bookings into unfilled slots, shifted to this start date.
        const src = isNew && fd.get('template') ? findProject(fd.get('template')) : null;
        const id = isNew ? uid() : p.id;
        let slots = [];
        if (src) {
          const srcAllocs = state.allocations.filter((a) => a.projectId === src.id && a.type === 'task');
          const srcStart = src.start || (srcAllocs.length ? srcAllocs.reduce((m, a) => minS(m, a.start), srcAllocs[0].start) : '');
          const offset = data.start && srcStart ? diffDays(srcStart, data.start) : 0;
          if (!data.start && srcStart) data.start = srcStart;
          if (!data.end && src.end) data.end = addDays(src.end, offset);
          if (!data.budgetHours) data.budgetHours = src.budgetHours;
          if (!data.phases.length) data.phases = src.phases.map((ph) => ({ id: uid(), name: ph.name, start: addDays(ph.start, offset), end: addDays(ph.end, offset) }));
          slots = srcAllocs.map((a) => ({ id: uid(), type: 'task', personId: null, disciplineId: allocDiscipline(a), projectId: id,
            start: addDays(a.start, offset), end: addDays(a.end, offset), hoursPerDay: a.hoursPerDay, notes: a.notes || '', tentative: false }));
        }
        commit((st) => {
          if (isNew) st.projects.push({ id, ...data }); else Object.assign(st.projects.find((x) => x.id === p.id), data);
          st.allocations.push(...slots);
        });
        toast(isNew ? (src ? `Created with ${slots.length} unfilled slot${slots.length === 1 ? '' : 's'} from ${src.name}` : 'Project created') : 'Saved');
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
      for (const a of st.allocations) if (a.disciplineId === id) a.disciplineId = '';
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
      drag = { mode: 'create', track, personId: track.dataset.slot ? null : track.dataset.person, disciplineId: track.dataset.discipline,
        projectId: track.dataset.project || '', d0: d, d1: d, x0: e.clientX, y0: e.clientY, moved: false };
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
      if (d.personId === null && d.disciplineId) extra.disciplineId = d.disciplineId;
      openAllocModal({ personId: d.personId, start: addDays(ui.viewStart, s), end: addDays(ui.viewStart, en), ...extra }, true);
      return;
    }
    if (!d.moved) { openAllocModal(d.a, false); return; }
    // Where did it land? A person's row assigns it to them; an unfilled-slot row turns it back into a slot.
    const toSlotRow = d.mode === 'move' && !!d.targetTrack.dataset.slot;
    if (toSlotRow && d.a.type === 'timeoff') { render(); toast('Time off stays with its person'); return; }
    const personId = d.mode !== 'move' ? d.a.personId : toSlotRow ? null : d.targetTrack.dataset.person;
    const disciplineId = personId ? undefined
      : toSlotRow && d.targetTrack.dataset.discipline !== undefined ? d.targetTrack.dataset.discipline : allocDiscipline(d.a);
    // Dropping onto a row under another project (Group by: Project) moves the booking to that project.
    const targetProject = d.mode === 'move' && d.a.type === 'task' ? d.targetTrack.dataset.project : '';
    const projectId = targetProject || d.a.projectId;
    if (d.newStart === d.a.start && d.newEnd === d.a.end && personId === d.a.personId && projectId === d.a.projectId
      && (personId || disciplineId === d.a.disciplineId)) { render(); return; }
    const copy = d.mode === 'move' && e.altKey;
    const orig = { personId: d.a.personId, projectId: d.a.projectId }; // d.a is mutated by the commit below
    const changes = { personId, projectId, start: d.newStart, end: d.newEnd };
    commit((st) => {
      const target = copy ? { ...d.a, id: uid() } : st.allocations.find((x) => x.id === d.a.id);
      Object.assign(target, changes);
      if (personId) delete target.disciplineId; else target.disciplineId = disciplineId || '';
      if (copy) st.allocations.push(target);
    });
    const who = findPerson(personId);
    const pr = findProject(projectId);
    toast(copy ? 'Copied'
      : !orig.personId && personId ? `Assigned to ${who ? who.name : 'person'}`
        : orig.personId && !personId ? 'Now an unfilled slot'
          : projectId !== orig.projectId ? `Moved to ${pr ? pr.name : 'project'}`
            : personId !== orig.personId ? `Moved to ${who ? who.name : 'person'}` : `Rescheduled to ${rangeLabel(d.newStart, d.newEnd)}`);
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
      case 'view-project': {
        const pr = findProject(t.dataset.id);
        ui.projectFilter = t.dataset.id; ui.view = 'schedule';
        if (isPipeline(pr) && ui.scenario === 'confirmed') { ui.scenario = 'all'; toast('Showing confirmed + pipeline work'); }
        render();
        break;
      }
      case 'new-pipeline': openProjectModal(null, { status: 'pipeline' }); break;
      case 'fc-toggle-bid': {
        const set = fcExcluded();
        if (set.has(t.dataset.id)) set.delete(t.dataset.id); else set.add(t.dataset.id);
        ui.fcExclude = [...set];
        render();
        break;
      }
      case 'fc-csv': fcCsv(); break;
      case 'see-capacity': ui.view = 'capacity'; if (ui.scenario === 'confirmed') ui.scenario = 'weighted'; render(); break;
      case 'win-project': openWinModal(findProject(t.dataset.id)); break;
      case 'lose-project': markLost(findProject(t.dataset.id)); break;
      case 'reopen-project': commit((st) => { st.projects.find((y) => y.id === t.dataset.id).status = 'pipeline'; }); toast('Back in the pipeline'); break;
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
    if (id === 'projectFilter') {
      ui.projectFilter = e.target.value;
      if (isPipeline(findProject(ui.projectFilter)) && ui.scenario === 'confirmed') { ui.scenario = 'all'; toast('Showing confirmed + pipeline work'); }
      render();
    }
    else if (id === 'scenario') { ui.scenario = e.target.value; render(); }
    else if (id === 'fcWeeks') { ui.fcWeeks = +e.target.value; render(); }
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
    if (action === 'export') { download(`baseline-${todayStr()}.json`, JSON.stringify(state, null, 2), 'application/json'); toast('Exported'); }
    else if (action === 'import') $('#importFile').click();
    else if (action === 'csv') {
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['Person', 'Discipline', 'Type', 'Project', 'Project status', 'Win chance', 'Client', 'Start', 'End', 'Hours/day', 'Total hours', 'Tentative', 'Notes'].join(',')];
      for (const a of [...state.allocations].sort((x, y) => (x.start < y.start ? -1 : 1))) {
        const p = findPerson(a.personId) || {}, pr = findProject(a.projectId) || {};
        lines.push([isSlot(a) ? 'Unfilled slot' : p.name, discNameById(allocDiscipline(a)), a.type === 'timeoff' ? 'Time off' : isSlot(a) ? 'Unfilled slot' : 'Project',
          pr.name, pr.status || '', pr.status === 'pipeline' ? `${pr.winChance}%` : '', pr.client, a.start, a.end, a.hoursPerDay, hoursInRange(a, a.start, a.end), a.tentative ? 'yes' : '', a.notes].map(q).join(','));
      }
      download(`baseline-schedule-${todayStr()}.csv`, lines.join('\n'), 'text/csv'); toast('CSV exported');
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
    } catch { toast('That file is not valid Baseline data'); }
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
