/* Baseline homepage animations: a live schedule board, drifting timelines and a team wall. */
'use strict';
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // Example OT jobs (fictional). `short` is used on the bars, `name` in the legend.
  const PROJECTS = [
    { name: 'Water Treatment SCADA', short: 'WTP SCADA', color: '#ff5a1f' },
    { name: 'Substation Automation', short: 'Substation', color: '#d4ff3a' },
    { name: 'Packaging Line PLC', short: 'Packaging PLC', color: '#f3efe6' },
    { name: 'Mine Site Telemetry', short: 'Mine Telemetry', color: '#ff2e88' },
    { name: 'Pump Station Upgrades', short: 'Pump Stations', color: '#ffb000' },
    { name: 'Service & Support', short: 'Service', color: '#a69f90' },
  ];
  const PHASES = ['Design', 'Integration', 'FAT', 'IFAT', 'Commissioning', 'SAT'];
  const PEOPLE = [
    ['Ava Thompson', 'Controls', '#ff5a1f'], ['Liam Carter', 'Electrical', '#d4ff3a'], ['Noah Patel', 'Controls', '#ffb000'],
    ['Mia Chen', 'SCADA', '#ff2e88'], ['Ethan Brooks', 'Network', '#f3efe6'], ['Lucas Kim', 'Commissioning', '#ff8a5c'],
    ['Sofia Rossi', 'Project Mgmt', '#b6e02e'], ['Zoe Martin', 'Project Mgmt', '#e8d9b0'], ['Omar Haddad', 'Controls', '#ffc94d'],
  ];
  const initials = (n) => n.split(' ').map((w) => w[0]).join('');

  // Canvas helper: keeps the backing store sharp on high-DPI screens.
  function setupCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const state = { ctx, w: 0, h: 0 };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.w = r.width; state.h = r.height;
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    new ResizeObserver(resize).observe(canvas);
    return state;
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // Runs a frame loop only while the element is on screen.
  function loopWhileVisible(el, frame) {
    let visible = false, raf = 0, last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      frame(dt, now / 1000);
      if (visible) raf = requestAnimationFrame(tick);
    };
    new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = entry.isIntersecting;
      if (visible && !was) { last = performance.now(); raf = requestAnimationFrame(tick); }
      if (!visible) cancelAnimationFrame(raf);
    }).observe(el);
    frame(0, performance.now() / 1000); // first paint, also the only one with reduced motion
  }

  // ------------------------------------------------------------------ nav
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ------------------------------------------------------------------ reveal on scroll
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.15 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  // ------------------------------------------------------------------ drifting timelines (hero + CTA backgrounds)
  function streams(canvas, { lanes = 22, alpha = 0.16, speed = 1 } = {}) {
    const c = setupCanvas(canvas);
    const rows = Array.from({ length: lanes }, (_, i) => ({
      i, speed: rand(14, 46) * speed, bars: [],
    }));
    const fill = (row) => {
      let x = row.bars.length ? row.bars[row.bars.length - 1].x + row.bars[row.bars.length - 1].w + rand(10, 90) : rand(-200, 0);
      while (x < c.w + 200) {
        const w = rand(40, 220);
        row.bars.push({ x, w, color: pick(PROJECTS).color });
        x += w + rand(12, 110);
      }
    };
    loopWhileVisible(canvas, (dt) => {
      const { ctx, w, h } = c;
      ctx.clearRect(0, 0, w, h);
      const laneH = h / lanes;
      for (const row of rows) {
        fill(row);
        const y = row.i * laneH + laneH * 0.3;
        const bh = Math.max(4, laneH * 0.38);
        for (const b of row.bars) {
          b.x -= row.speed * dt;
          ctx.globalAlpha = alpha * (0.55 + 0.45 * Math.sin((row.i + b.x / 300) * 0.9) ** 2);
          ctx.fillStyle = b.color;
          roundRect(ctx, b.x, y, b.w, bh, bh / 2);
          ctx.fill();
        }
        while (row.bars.length && row.bars[0].x + row.bars[0].w < -20) row.bars.shift();
      }
      ctx.globalAlpha = 1;
    });
  }
  streams(document.getElementById('heroBg'), { lanes: 26, alpha: 0.13 });
  streams(document.getElementById('ctaBg'), { lanes: 14, alpha: 0.35, speed: 1.3 });

  // ------------------------------------------------------------------ live board
  const legend = document.getElementById('boardLegend');
  legend.innerHTML = PROJECTS.map((p) => `<span><i style="background:${p.color}"></i>${p.name}</span>`).join('');

  (function board() {
    const canvas = document.getElementById('board');
    const c = setupCanvas(canvas);
    const HEAD = 36, PAD_TOP = 6, PAD_BOTTOM = 22;
    const today = new Date();
    let t = 0;                          // time in days since the board started
    let moved = 0;
    const rows = PEOPLE.map(([name, disc, color]) => ({ name, disc, color, bars: [], next: [rand(-4, 0), rand(-2, 3)], util: 0.6 }));
    let uid = 0;

    const geom = () => {
      const narrow = c.w < 560;
      const side = narrow ? 104 : 168;
      const days = narrow ? 9 : 15;
      const dayW = (c.w - side) / days;
      const rowH = (c.h - HEAD - PAD_TOP - PAD_BOTTOM) / rows.length;
      return { side, days, dayW, rowH, narrow };
    };
    const laneFree = (row, lane, s, e, ignore) => row.bars.every((b) => b === ignore || b.lane !== lane || b.start + b.len <= s || b.start >= e);

    function generate(until) {
      for (const row of rows) {
        while (row.next[0] < until) { // main lane: mostly back-to-back work
          const len = randInt(2, 7);
          row.bars.push({ id: uid++, start: row.next[0], len, p: randInt(0, PROJECTS.length - 1), phase: pick(PHASES), lane: 0, h: pick([4, 6, 8, 8]) });
          row.next[0] += len + (Math.random() < 0.55 ? 0 : randInt(1, 2));
        }
        while (row.next[1] < until) { // second lane: occasional overlapping work
          const len = randInt(2, 5);
          const start = row.next[1] + randInt(1, 6);
          row.bars.push({ id: uid++, start, len, p: randInt(0, PROJECTS.length - 1), phase: pick(PHASES), lane: 1, h: pick([2, 2, 4]) });
          row.next[1] = start + len;
        }
      }
    }

    // A scripted "drag": the cursor glides to a booking, lifts it, carries it to another person and drops it.
    let drag = null, cursor = { x: 0, y: 0, shown: false }, toast = null, nextDragAt = 0.25;
    function planDrag(g) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const fromRow = pick(rows);
        const candidates = fromRow.bars.filter((b) => b.start > t + 1 && b.start + b.len < t + g.days - 1);
        if (!candidates.length) continue;
        const bar = pick(candidates);
        const toRow = pick(rows.filter((r) => r !== fromRow));
        const shift = randInt(-1, 2);
        const s = bar.start + shift, e = s + bar.len;
        const lane = [0, 1].find((l) => laneFree(toRow, l, s, e, bar));
        if (lane === undefined || s < t + 0.5 || e > t + g.days - 0.5) continue;
        return { bar, fromRow, toRow, toStart: s, toLane: lane, phase: 0, clock: 0 };
      }
      return null;
    }
    const STEPS = [0.7, 0.22, 1.0, 0.25]; // drag steps: approach, lift, carry, drop

    function rowY(i, g) { return HEAD + PAD_TOP + i * g.rowH; }
    function barRect(b, rowIndex, g) {
      const laneH = (g.rowH - 10) / 2;
      return { x: g.side + (b.start - t) * g.dayW + 2, y: rowY(rowIndex, g) + 4 + b.lane * (laneH + 2), w: b.len * g.dayW - 4, h: laneH };
    }

    function update(dt, g) {
      t += dt * 0.32;
      generate(t + g.days + 6);
      for (const row of rows) row.bars = row.bars.filter((b) => b.start + b.len > t - 1);

      if (!drag && t > nextDragAt && !reduceMotion) {
        drag = planDrag(g);
        nextDragAt = t + rand(0.9, 1.4);
      }
      if (drag) {
        drag.clock += dt;
        while (drag && drag.clock >= STEPS[drag.phase]) {
          drag.clock -= STEPS[drag.phase];
          drag.phase++;
          if (drag.phase === 2) drag.fromRow.bars = drag.fromRow.bars.filter((b) => b !== drag.bar); // picked up
          if (drag.phase === 4) {
            Object.assign(drag.bar, { start: drag.toStart, lane: drag.toLane });
            drag.toRow.bars.push(drag.bar);
            moved++;
            toast = { text: `Moved to ${drag.toRow.name.split(' ')[0]}`, row: rows.indexOf(drag.toRow), bar: drag.bar, life: 1.6 };
            drag = null;
          }
        }
      }
      if (toast) { toast.life -= dt; if (toast.life <= 0) toast = null; }

      for (const row of rows) row.util = lerp(row.util, utilTarget(row), Math.min(1, dt * 3));
    }
    // Utilization over the next ~2 weeks: booked hours against an 8h day.
    function utilTarget(row) {
      let hours = 0;
      const s = t, e = t + 10;
      for (const b of row.bars) hours += Math.max(0, Math.min(e, b.start + b.len) - Math.max(s, b.start)) * b.h;
      return hours / (10 * 8);
    }

    function draw(g) {
      const { ctx, w, h } = c;
      ctx.clearRect(0, 0, w, h);
      ctx.font = '600 11px Archivo, system-ui, sans-serif';
      ctx.textBaseline = 'middle';

      // day columns + header
      const first = Math.floor(t);
      for (let d = first; d <= t + g.days + 1; d++) {
        const x = g.side + (d - t) * g.dayW;
        const date = new Date(today.getTime() + d * 86400000);
        const dow = date.getDay();
        if (dow === 0 || dow === 6) {
          ctx.fillStyle = 'rgba(255,255,255,0.035)';
          ctx.fillRect(x, HEAD, g.dayW, h - HEAD);
        }
        ctx.fillStyle = dow === 1 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)';
        ctx.fillRect(x, HEAD, 1, h - HEAD);
        ctx.fillStyle = dow === 0 || dow === 6 ? 'rgba(243,239,230,0.4)' : 'rgba(243,239,230,0.8)';
        ctx.textAlign = 'center';
        ctx.font = '500 9.5px Archivo, system-ui, sans-serif';
        if (g.dayW > 26) ctx.fillText('SMTWTFS'[dow], x + g.dayW / 2, 12);
        ctx.font = '700 12px Archivo, system-ui, sans-serif';
        ctx.fillText(String(date.getDate()), x + g.dayW / 2, 26);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(0, HEAD - 1, w, 1);

      // rows
      ctx.textAlign = 'left';
      rows.forEach((row, i) => {
        const y = rowY(i, g);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(0, y + g.rowH - 1, w, 1);
        for (const b of row.bars) {
          const r = barRect(b, i, g);
          if (r.x + r.w < g.side - 4 || r.x > w) continue;
          drawBar(ctx, r, b, 1, g);
        }
      });

      // "now" line
      const nowX = g.side + 1.5 * g.dayW;
      const grad = ctx.createLinearGradient(0, HEAD, 0, h);
      grad.addColorStop(0, 'rgba(212,255,58,0.95)'); grad.addColorStop(1, 'rgba(212,255,58,0.06)');
      ctx.fillStyle = grad;
      ctx.fillRect(nowX, HEAD, 2, h - HEAD);
      ctx.fillStyle = '#d4ff3a';
      roundRect(ctx, nowX - 15, h - 20, 32, 15, 7); ctx.fill();
      ctx.fillStyle = '#0e0e0c'; ctx.textAlign = 'center'; ctx.font = '700 9.5px Archivo, system-ui, sans-serif';
      ctx.fillText('NOW', nowX + 1, h - 12.5);

      // sidebar (drawn over bars so they slide underneath)
      ctx.fillStyle = '#1a1916';
      ctx.fillRect(0, 0, g.side, h);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(g.side - 1, 0, 1, h);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(243,239,230,0.55)'; ctx.font = '600 10.5px Archivo, system-ui, sans-serif';
      ctx.fillText(g.narrow ? 'Engineers' : `Engineers · ${moved} moved`, 14, HEAD / 2 + 1);
      rows.forEach((row, i) => {
        const y = rowY(i, g), cy = y + g.rowH / 2;
        const rad = Math.min(13, g.rowH / 2 - 5);
        ctx.fillStyle = row.color;
        ctx.beginPath(); ctx.arc(14 + rad, cy, rad, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0e0e0c'; ctx.font = '800 9.5px Archivo, system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(initials(row.name), 14 + rad, cy + 0.5);
        ctx.textAlign = 'left';
        const tx = 14 + rad * 2 + 9;
        ctx.fillStyle = '#f3efe6'; ctx.font = '600 11.5px Archivo, system-ui, sans-serif';
        ctx.fillText(g.narrow ? row.name.split(' ')[0] : row.name, tx, cy - 7);
        // utilization meter
        const mw = g.side - tx - (g.narrow ? 12 : 44);
        const u = row.util;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        roundRect(ctx, tx, cy + 5, mw, 4, 2); ctx.fill();
        ctx.fillStyle = u > 1.02 ? '#ff2e4d' : u > 0.97 ? '#ff5a1f' : '#d4ff3a';
        roundRect(ctx, tx, cy + 5, Math.max(4, mw * Math.min(1, u)), 4, 2); ctx.fill();
        if (!g.narrow) {
          ctx.fillStyle = u > 1.02 ? '#ff6b81' : 'rgba(243,239,230,0.7)'; ctx.font = '700 10px Archivo, system-ui, sans-serif';
          ctx.fillText(`${Math.round(u * 100)}%`, tx + mw + 6, cy + 7.5);
        }
      });

      // drag in progress
      if (drag) {
        const fromI = rows.indexOf(drag.fromRow), toI = rows.indexOf(drag.toRow);
        const a = barRect(drag.bar, fromI, g);
        const b = barRect({ ...drag.bar, start: drag.toStart, lane: drag.toLane }, toI, g);
        let r = a, lift = 0, target;
        const p = drag.clock / STEPS[drag.phase];
        if (drag.phase === 0) {
          target = { x: a.x + Math.min(30, a.w / 2), y: a.y + a.h / 2 };
          cursor.x = lerp(cursor.x, target.x, ease(Math.min(1, p * 1.2)));
          cursor.y = lerp(cursor.y, target.y, ease(Math.min(1, p * 1.2)));
        } else {
          let k = 0;
          if (drag.phase === 1) { lift = p; k = 0; }
          if (drag.phase === 2) { lift = 1; k = ease(p); }
          if (drag.phase === 3) { lift = 1 - p; k = 1; }
          r = { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) - 5 * lift - Math.sin(Math.PI * k) * 10, w: a.w, h: a.h };
          cursor.x = r.x + Math.min(30, a.w / 2); cursor.y = r.y + r.h / 2;
          if (drag.phase >= 2) {
            // ghost slot showing where it will land
            ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.2;
            roundRect(ctx, b.x, b.y, b.w, b.h, 5); ctx.stroke(); ctx.setLineDash([]);
          }
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 18 * lift; ctx.shadowOffsetY = 8 * lift;
          drawBar(ctx, r, drag.bar, 1, g, 1 + 0.04 * lift);
          ctx.restore();
        }
        cursor.shown = true;
      }
      if (cursor.shown) drawCursor(ctx, cursor.x, cursor.y, drag && drag.phase >= 1);

      // "moved" toast
      if (toast) {
        const r = barRect(toast.bar, toast.row, g);
        const alpha = Math.min(1, toast.life * 2);
        ctx.globalAlpha = alpha;
        ctx.font = '700 11px Archivo, system-ui, sans-serif';
        const tw = ctx.measureText(toast.text).width + 18;
        const tx = clamp(r.x, g.side + 4, w - tw - 4), ty = r.y - 22 - (1.6 - toast.life) * 6;
        ctx.fillStyle = '#d4ff3a';
        roundRect(ctx, tx, ty, tw, 19, 9.5); ctx.fill();
        ctx.fillStyle = '#0e0e0c'; ctx.textAlign = 'left';
        ctx.fillText(toast.text, tx + 9, ty + 10);
        ctx.globalAlpha = 1;
      }
    }

    function drawBar(ctx, r, b, alpha, g, scale = 1) {
      const p = PROJECTS[b.p];
      const x = r.x - (r.w * (scale - 1)) / 2, y = r.y - (r.h * (scale - 1)) / 2, wd = r.w * scale, ht = r.h * scale;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      roundRect(ctx, x, y, wd, ht, 5); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      roundRect(ctx, x, y, wd, ht / 2, 5); ctx.fill();
      if (wd > 46 && ht >= 12) {
        ctx.save();
        ctx.beginPath(); ctx.rect(x + 6, y, wd - 10, ht); ctx.clip();
        ctx.fillStyle = '#0e0e0c'; ctx.font = `800 ${ht > 15 ? 11 : 10}px Archivo, system-ui, sans-serif`; ctx.textAlign = 'left';
        const label = wd > 150 ? `${p.short} · ${b.phase} · ${b.h}h/d` : wd > 96 ? `${p.short} · ${b.phase}` : p.short;
        ctx.fillText(label, x + 7, y + ht / 2 + 0.5);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    function drawCursor(ctx, x, y, pressed) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(pressed ? 0.9 : 1, pressed ? 0.9 : 1);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, 17); ctx.lineTo(4.5, 13); ctx.lineTo(7.5, 19.5); ctx.lineTo(10, 18.4); ctx.lineTo(7.2, 12); ctx.lineTo(12.5, 12); ctx.closePath();
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#0e0e0c'; ctx.lineWidth = 1.3;
      ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
      ctx.fill(); ctx.shadowColor = 'transparent'; ctx.stroke();
      if (pressed) {
        ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(212,255,58,0.95)'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.restore();
    }

    const g0 = geom();
    generate(g0.days + 6);
    cursor.x = c.w * 0.7; cursor.y = c.h * 0.6;
    for (const row of rows) row.util = utilTarget(row);
    loopWhileVisible(canvas, (dt) => {
      const g = geom();
      update(reduceMotion ? 0 : dt, g);
      draw(g);
    });
  })();

  // ------------------------------------------------------------------ lifecycle stepper
  (function lifecycle() {
    const board = document.getElementById('lifecycleBoard');
    if (!board) return;
    const steps = [...board.querySelectorAll('.lc-step')];
    const fill = board.querySelector('.lc-fill'), token = board.querySelector('.lc-token');
    let i = 0, timer = 0;
    const show = (n) => {
      steps.forEach((el, k) => { el.classList.toggle('done', k < n); el.classList.toggle('active', k === n); });
      const pctDone = (n / (steps.length - 1)) * 100;
      fill.style.width = `${pctDone}%`;
      token.style.left = `${pctDone}%`;
    };
    show(reduceMotion ? 2 : 0);
    if (reduceMotion) return;
    // Hovering a phase jumps to it and pauses; leaving resumes the cycle.
    steps.forEach((el, k) => {
      el.addEventListener('mouseenter', () => { clearInterval(timer); timer = 0; i = k; show(k); });
      el.addEventListener('mouseleave', () => start());
    });
    const start = () => { if (!timer) timer = setInterval(() => { i = (i + 1) % steps.length; show(i); }, 1900); };
    new IntersectionObserver(([e]) => { if (e.isIntersecting) start(); else { clearInterval(timer); timer = 0; } }, { threshold: 0.3 }).observe(board);
  })();

  // ------------------------------------------------------------------ team wall
  (function crowd() {
    const wall = document.getElementById('crowd');
    const FIRST = ['Ava', 'Liam', 'Noah', 'Mia', 'Ethan', 'Lucas', 'Sofia', 'Zoe', 'Omar', 'Priya', 'Jack', 'Chloe', 'Leo', 'Isla', 'Ruby', 'Kai',
      'Grace', 'Hugo', 'Aria', 'Finn', 'Maya', 'Theo', 'Nina', 'Sam', 'Ella', 'Max', 'Lily', 'Arjun', 'Hana', 'Oscar', 'Ivy', 'Ben',
      'Zara', 'Eli', 'Tara', 'Luca', 'Amir', 'Jade', 'Remy', 'Sana'];
    const LAST = 'ABCDEFGHJKLMNPRSTW';
    const COLORS = ['#ff5a1f', '#d4ff3a', '#ffb000', '#ff2e88', '#f3efe6', '#ff8a5c', '#b6e02e', '#e8d9b0', '#ffc94d', '#ff7aa8'];
    const C = 2 * Math.PI * 22;
    const people = FIRST.map((f, i) => ({ initials: f[0] + LAST[i % LAST.length], color: COLORS[i % COLORS.length], u: rand(0.35, 0.95) }));
    wall.innerHTML = people.map((p, i) => `
      <div class="av" data-i="${i}" title="${p.initials}">
        <svg viewBox="0 0 50 50" aria-hidden="true"><circle class="track-ring" cx="25" cy="25" r="22"/><circle class="ring" cx="25" cy="25" r="22" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
        <b style="--c:${p.color}">${p.initials}</b>
      </div>`).join('');
    const els = [...wall.querySelectorAll('.av')];
    const paint = (i) => {
      const u = people[i].u;
      const el = els[i];
      el.querySelector('.ring').style.strokeDashoffset = String(C * (1 - Math.min(1, u)));
      el.classList.toggle('over', u > 1.02);
      el.classList.toggle('full', u > 0.97 && u <= 1.02);
    };
    // Rings fill in once the wall scrolls into view.
    new IntersectionObserver(([e], obs) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      els.forEach((_, i) => setTimeout(() => paint(i), reduceMotion ? 0 : i * 25));
      if (!reduceMotion) start();
    }, { threshold: 0.3 }).observe(wall);

    function start() {
      let visible = true;
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(wall);
      // Work flies from one person to another; their loads change to match.
      setInterval(() => {
        if (!visible || document.hidden) return;
        let from = randInt(0, people.length - 1), to = randInt(0, people.length - 1);
        if (from === to) to = (to + 7) % people.length;
        if (people[from].u < 0.4) [from, to] = [to, from];
        fly(from, to);
      }, 650);
      // Ambient drift so the wall never looks frozen.
      setInterval(() => {
        if (!visible || document.hidden) return;
        const i = randInt(0, people.length - 1);
        people[i].u = clamp(people[i].u + rand(-0.15, 0.15), 0.15, 1.15);
        paint(i);
      }, 400);
    }
    function center(el) {
      const w = wall.getBoundingClientRect(), r = el.getBoundingClientRect();
      return { x: r.left - w.left + r.width / 2, y: r.top - w.top + r.height / 2 };
    }
    function fly(from, to) {
      const a = center(els[from]), b = center(els[to]);
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.style.background = pick(PROJECTS).color;
      wall.appendChild(chip);
      const amount = rand(0.08, 0.2);
      people[from].u = clamp(people[from].u - amount, 0.1, 1.2);
      paint(from);
      const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 40 };
      const anim = chip.animate([
        { transform: `translate(${a.x - 21}px, ${a.y - 7}px) scale(.4)`, opacity: 0 },
        { transform: `translate(${a.x - 21}px, ${a.y - 7}px) scale(1)`, opacity: 1, offset: 0.15 },
        { transform: `translate(${mid.x - 21}px, ${mid.y - 7}px) scale(1.1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${b.x - 21}px, ${b.y - 7}px) scale(.5)`, opacity: 0 },
      ], { duration: 1100, easing: 'cubic-bezier(.45,.05,.35,1)' });
      anim.onfinish = () => {
        chip.remove();
        people[to].u = clamp(people[to].u + amount, 0.1, 1.2);
        paint(to);
        els[to].classList.remove('bump'); void els[to].offsetWidth; els[to].classList.add('bump');
      };
    }
  })();
})();
