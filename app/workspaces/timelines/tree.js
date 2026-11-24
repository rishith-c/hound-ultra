// Timelines: the branching timeline. One lane per world, time left to right, every fork drawn where the decision
// was taken. The band around each lane is a "river": it widens as people are located (amber: possible, orange:
// confirmed, bright: reached by the team), so the shape of a lane is the story of that world.
import { clock, phases, river, PHASE_INFO, span } from './model.js';

const ROW = 48, CY = 31, PAD = 14, U = 4.2;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const COLS = [
  { id: 'reached', label: 'Reached', tip: 'People the rescue team has reached by the end', get: (r) => r.metrics.reached, good: 1 },
  { id: 'bySensors', label: 'Sensors', tip: 'Confirmed by the rover and drone sensors alone, before anyone walks in', get: (r) => r.metrics.bySensors, good: 1 },
  { id: 'byTeam', label: 'Team', tip: 'Uncertain leads handed to the rescue team to check in person', get: (r) => r.metrics.byTeam, good: 0 },
  { id: 'open', label: 'Open', tip: 'Leads still "possible" at the end that nobody checked', get: (r) => r.metrics.open, good: -1 },
  { id: 'time', label: 'Time', tip: 'Simulated mission time, minutes:seconds', get: (r) => r.metrics.endT, fmt: (v, r) => (r.metrics.done ? clock(v) : 'stalled'), delta: (d) => span(d), good: 0, min: 1 },
  { id: 'route', label: 'Route', tip: 'Length of the rescue route that was walked, metres', get: (r) => r.metrics.routeLen, fmt: (v) => v.toFixed(0) + ' m', delta: (d) => Math.abs(d).toFixed(0), good: 0, min: 1 },
  { id: 'hazard', label: 'In hazard', tip: 'Metres of that route inside a marked hazard area', get: (r) => r.metrics.hazardM, fmt: (v) => v.toFixed(0) + ' m', delta: (d) => Math.abs(d).toFixed(0), good: -1, min: 1 },
];
export const TRUTH_COLS = [
  { id: 'missed', label: 'Not reached', tip: 'Ground truth: people really there whom the team never reached', get: (r) => r.truth.missed, good: -1, truth: true },
  { id: 'false', label: 'False leads', tip: 'Ground truth: leads that were not a person and still cost a second look or a team visit', get: (r) => r.truth.falseChased, good: -1, truth: true },
];

export function createTree(host, { kit, onCursor, onCompare, onDelete, onKey }) {
  const { h, icon } = kit;
  const head = h('div.tl-tree-head'), body = h('div.tl-tree-body', { tabindex: '0', role: 'group', 'aria-label': 'Branching timeline. Arrow keys move the cursor in time and between branches. F forks at the cursor.' });
  const tip = h('div.tooltip.tl-tip');
  host.append(head, body, tip);
  let rows = [], tMax = 660, truth = false, base = null, cursor = { id: null, t: 0 }, compareId = null, liveT = null, laneW = 0, cols = COLS, built = false;
  const X = (t) => PAD + (Math.min(t, tMax) / tMax) * (laneW - PAD * 2);
  const T = (x) => Math.max(0, Math.min(tMax, ((x - PAD) / (laneW - PAD * 2)) * tMax));
  const rowOf = (id) => rows.findIndex((r) => r.b.id === id);
  const ro = new ResizeObserver(() => { if (built) render(); }); ro.observe(host);

  function riverPath(b, level) { // level 0: reached, 1: + confirmed, 2: + possible
    const rv = b.river, n = b.run.frames.n, i0 = b.parent ? Math.max(0, Math.floor(b.forkT)) : 0, up = [], dn = [];
    const hAt = (i) => { let c = 0; for (let k = 0; k <= level; k++) c += rv[i * 3 + k]; return c ? Math.min(13, 1 + (c * U) / 2 + (level === 2 ? 0.5 : 0)) : 0; };
    let prev = -1;
    for (let i = i0; i < n; i++) {
      const x = X(i === n - 1 ? b.run.endT : i), hh = hAt(i);
      if (hh !== prev) { if (prev >= 0) { up.push(x.toFixed(1) + ',' + (CY - prev).toFixed(1)); dn.push(x.toFixed(1) + ',' + (CY + prev).toFixed(1)); } up.push(x.toFixed(1) + ',' + (CY - hh).toFixed(1)); dn.push(x.toFixed(1) + ',' + (CY + hh).toFixed(1)); prev = hh; }
      if (i === n - 1) { up.push(x.toFixed(1) + ',' + (CY - hh).toFixed(1)); dn.push(x.toFixed(1) + ',' + (CY + hh).toFixed(1)); }
    }
    return up.length ? 'M' + up.join('L') + 'L' + dn.reverse().join('L') + 'Z' : '';
  }

  function render(next) {
    if (next) ({ rows, tMax, truth, base } = next);
    built = true;
    cols = truth ? [...COLS, ...TRUTH_COLS] : COLS;
    const cellsW = cols.length * 62 + 64;
    host.style.setProperty('--tl-cells', cellsW + 'px');
    laneW = Math.max(240, host.clientWidth - cellsW);
    const A = rows.find((r) => r.b.id === cursor.id)?.b, Arun = A && A.run ? A : rows[0]?.b;
    // ---- header: phases of the selected branch, minute ticks, column names ----
    let hs = '<svg class="tl-axis" width="' + laneW + '" height="38" aria-hidden="true">';
    if (Arun && Arun.run) for (const p of Arun.phases) {
      const x0 = X(p.t0), x1 = X(p.t1); if (x1 - x0 < 1) continue;
      hs += '<line class="tl-phase-tick" x1="' + x0.toFixed(1) + '" x2="' + x0.toFixed(1) + '" y1="2" y2="16"/>';
      if (x1 - x0 > 46) hs += '<text class="tl-phase-name" x="' + (x0 + 5).toFixed(1) + '" y="12">' + esc(x1 - x0 > PHASE_INFO[p.phase].label.length * 6.2 + 8 ? PHASE_INFO[p.phase].label : PHASE_INFO[p.phase].label.split(' ')[0]) + '</text>';
    }
    for (let m = 0; m * 60 <= tMax; m++) { const x = X(m * 60); hs += '<line class="tl-tick" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + (m % 2 ? 31 : 28) + '" y2="38"/>'; if (m % 2 === 0) hs += '<text class="tl-tick-t" x="' + (x + 3).toFixed(1) + '" y="33">' + m + ':00</text>'; }
    hs += '</svg>';
    head.innerHTML = hs;
    head.append(h('div.tl-cells.tl-cells-head', null, ...cols.map((c) => h('span', { class: c.truth ? 'tl-truthcol' : '', title: c.tip }, c.label)), h('span.tl-actions')));
    // ---- body ----
    const Hh = rows.length * ROW;
    let s = '<svg class="tl-tree-svg" width="' + laneW + '" height="' + Hh + '" aria-hidden="true">';
    for (let m = 0; m * 60 <= tMax; m += 2) s += '<line class="tl-grid" x1="' + X(m * 60).toFixed(1) + '" x2="' + X(m * 60).toFixed(1) + '" y1="0" y2="' + Hh + '"/>';
    rows.forEach((r, i) => {
      const b = r.b, y = i * ROW, pi = b.parent ? rowOf(b.parent) : -1, fx = X(b.forkT || 0);
      if (pi >= 0) { // the fork: leaves the parent lane where the decision was taken
        const py = pi * ROW + CY, cy = y + CY, rr = 9;
        s += '<path class="tl-fork" d="M' + fx.toFixed(1) + ',' + py + 'V' + (cy - rr) + 'Q' + fx.toFixed(1) + ',' + cy + ' ' + (fx + rr).toFixed(1) + ',' + cy + '"/>';
        s += '<circle class="tl-node" cx="' + fx.toFixed(1) + '" cy="' + py + '" r="3.5"/>';
      }
      s += '<g transform="translate(0,' + y + ')">';
      if (b.run) {
        const x0 = pi >= 0 ? fx + 9 : X(0), x1 = X(b.run.endT);
        for (const [lv, cls] of [[2, 'tl-rv-possible'], [1, 'tl-rv-confirmed'], [0, 'tl-rv-reached']]) { const d = riverPath(b, lv); if (d) s += '<path class="' + cls + '" d="' + d + '"/>'; }
        const dx = b.firstDiff != null && pi >= 0 ? Math.max(x0, X(b.firstDiff)) : x0;
        if (dx > x0 + 1) s += '<line class="tl-lane tl-lane-same" x1="' + x0.toFixed(1) + '" x2="' + dx.toFixed(1) + '" y1="' + CY + '" y2="' + CY + '"/>';
        s += '<line class="tl-lane" x1="' + dx.toFixed(1) + '" x2="' + x1.toFixed(1) + '" y1="' + CY + '" y2="' + CY + '"/>';
        for (const p of b.phases) if (p.t0 > (pi >= 0 ? b.forkT : 0) + 1) s += '<line class="tl-lane-phase" x1="' + X(p.t0).toFixed(1) + '" x2="' + X(p.t0).toFixed(1) + '" y1="' + (CY - 4) + '" y2="' + (CY + 4) + '"/>';
        for (const e of b.run.events) {
          if (pi >= 0 && e.t < b.forkT - 0.05) continue;
          const x = X(e.t).toFixed(1);
          if (e.code === 'FAULT' || e.code === 'NEW_HAZARD' || e.code === 'ALL_STOP' || e.code === 'NO_PATH' || e.code === 'BATTERY_LOW') s += '<path class="tl-g-danger" transform="translate(' + x + ',' + (CY + 14) + ')" d="M0,-4L4,0L0,4L-4,0Z"><title>' + esc(clock(e.t) + '  ' + e.text) + '</title></path>';
          else if (e.code === 'LEAD_CLOSED') s += '<path class="tl-g-ok" transform="translate(' + x + ',' + (CY + 14) + ')" d="M-3,-3L3,3M3,-3L-3,3"><title>' + esc(clock(e.t) + '  ' + e.text) + '</title></path>';
          else if (e.code === 'ROUTE_APPROVED') s += '<path class="tl-g-accent" transform="translate(' + x + ',' + (CY + 14) + ')" d="M-3,-3.5L3,0L-3,3.5Z"><title>' + esc(clock(e.t) + '  ' + e.text) + '</title></path>';
        }
        if (b.run.done) s += '<line class="tl-end" x1="' + x1.toFixed(1) + '" x2="' + x1.toFixed(1) + '" y1="' + (CY - 7) + '" y2="' + (CY + 7) + '"/>';
        else s += '<path class="tl-stall" d="M' + (x1 - 10).toFixed(1) + ',' + CY + 'l3,-5l4,10l3,-5"/>';
      } else {
        const x0 = pi >= 0 ? fx + 9 : X(0), x1 = X(base ? base.endT : tMax), pr = b.progress || 0;
        s += '<line class="tl-lane tl-lane-wait" x1="' + x0.toFixed(1) + '" x2="' + x1.toFixed(1) + '" y1="' + CY + '" y2="' + CY + '"/>';
        if (b.status === 'running') s += '<line class="tl-lane-run" x1="' + x0.toFixed(1) + '" x2="' + (x0 + (x1 - x0) * pr).toFixed(1) + '" y1="' + CY + '" y2="' + CY + '"/>';
      }
      s += '</g>';
    });
    s += '</svg>';
    body.innerHTML = s;
    rows.forEach((r, i) => {
      const b = r.b, fx = X(b.forkT || 0), leftSide = !b.parent || fx < laneW * 0.46;
      const state = b.status === 'done' ? null : b.status === 'error' ? h('span.c-danger', null, 'failed: ' + b.error) : b.status === 'invalid' ? h('span.c-warn', null, 'no longer applies') : h('span.dim', null, b.status === 'running' ? 'running ' + Math.round((b.progress || 0) * 100) + ' %' : 'queued');
      const ver = b.verify === 'ok' ? h('span.tl-ver', { title: 'Replay verified: run twice, identical fingerprint ' + b.run.hash }, icon('check', 11)) : b.verify === 'fail' ? h('span.tl-ver.bad', { title: 'The two runs differ. This should never happen: please report it.' }, icon('alert', 11)) : null;
      const lab = h('button.tl-label', { type: 'button', style: leftSide ? { left: (b.parent ? fx + 14 : PAD) + 'px', maxWidth: Math.max(120, laneW - (b.parent ? fx + 14 : PAD) - 8) + 'px' } : { right: laneW - fx + 8 + 'px', maxWidth: Math.max(120, fx - 16) + 'px', textAlign: 'right' }, title: b.detail || b.label, onclick: () => onCursor(b.id, Math.max(cursor.t, 0)) },
        h('b.tl-name', null, b.name), h('span.tl-what', null, b.label), b.parent ? h('span.tl-at.num', null, clock(b.forkT)) : null, ver, state);
      const cells = h('div.tl-cells', null, ...cols.map((c) => {
        if (!b.run) return h('span.dim', null, '·');
        const v = c.get(b.run), txt = c.fmt ? c.fmt(v, b.run) : String(v), d = base && b.parent ? v - c.get(base) : 0, show = Math.abs(d) >= (c.min || 0.5);
        return h('span', { class: c.truth ? 'tl-truthcol' : '' }, h('b.num', null, txt), show ? h('i.num', { class: c.good === 0 ? '' : (d > 0) === (c.good > 0) ? 'up' : 'down' }, (d > 0 ? '+' : '−') + (c.delta ? c.delta(d) : Math.abs(d))) : null);
      }), h('span.tl-actions', null,
        h('button.btn.btn-ghost.btn-sm.btn-icon.tl-cmp', { type: 'button', 'aria-label': 'Compare ' + b.name + ' with the selected branch', 'aria-pressed': String(compareId === b.id), title: 'Show this branch as world B', onclick: (e) => { e.stopPropagation(); onCompare(b.id); } }, 'B'),
        b.parent ? h('button.btn.btn-ghost.btn-sm.btn-icon', { type: 'button', 'aria-label': 'Remove ' + b.name, title: 'Remove this branch', onclick: (e) => { e.stopPropagation(); onDelete(b.id); } }, icon('close', 12)) : h('span.tl-actions-gap')));
      body.append(h('div.tl-row', { 'data-id': b.id, style: { top: i * ROW + 'px', height: ROW + 'px' } }, lab, cells));
    });
    body.append(h('div.tl-cursor'), h('div.tl-dot.a'), h('div.tl-dot.b'), h('div.tl-live', null, h('span', null, 'live')), h('div.tl-height', { style: { height: Hh + 'px' } }));
    head.append(h('div.tl-flag.num'));
    place();
  }

  function place() {
    if (!built) return;
    const x = X(cursor.t), ia = rowOf(cursor.id), ib = rowOf(compareId), q = (c) => body.querySelector(c);
    const cur = q('.tl-cursor'); if (cur) { cur.style.transform = 'translateX(' + x + 'px)'; cur.style.height = rows.length * ROW + 'px'; }
    const flag = head.querySelector('.tl-flag'); if (flag) { flag.textContent = clock(cursor.t); flag.style.transform = 'translateX(' + Math.max(0, Math.min(laneW - 46, x - 23)) + 'px)'; }
    const da = q('.tl-dot.a'), db = q('.tl-dot.b');
    if (da) { da.hidden = ia < 0; da.style.transform = 'translate(' + (x - 5) + 'px,' + (ia * ROW + CY - 5) + 'px)'; }
    if (db) { db.hidden = ib < 0 || ib === ia; db.style.transform = 'translate(' + (x - 5) + 'px,' + (ib * ROW + CY - 5) + 'px)'; }
    const lv = q('.tl-live'); if (lv) { lv.hidden = liveT == null || !rows.length; lv.style.transform = 'translate(' + X(liveT || 0) + 'px,' + (CY - 13) + 'px)'; }
    body.querySelectorAll('.tl-row').forEach((el) => { el.classList.toggle('is-a', el.dataset.id === cursor.id); el.classList.toggle('is-b', el.dataset.id === compareId && compareId !== cursor.id); const c = el.querySelector('.tl-cmp'); if (c) c.setAttribute('aria-pressed', String(el.dataset.id === compareId)); });
  }

  // ---- pointer: hover reads a world, click or drag moves the cursor ----
  function hit(ev) { const r = body.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top + body.scrollTop; if (x > laneW) return null; const i = Math.floor(y / ROW); if (i < 0 || i >= rows.length) return null; return { b: rows[i].b, t: T(x), x, y: ev.clientY - host.getBoundingClientRect().top }; }
  let drag = false;
  body.addEventListener('pointerdown', (ev) => { if (ev.target.closest('button')) return; const q = hit(ev); if (!q || !q.b.run) return; drag = true; body.setPointerCapture(ev.pointerId); onCursor(q.b.id, Math.min(q.t, q.b.run.endT)); });
  body.addEventListener('pointermove', (ev) => {
    const q = hit(ev);
    if (drag && q) { const b = rows.find((r) => r.b.id === cursor.id)?.b; if (b && b.run) onCursor(b.id, Math.min(q.t, b.run.endT)); }
    if (!q || !q.b.run || ev.target.closest('button')) { tip.classList.remove('show'); return; }
    const run = q.b.run, t = Math.min(q.t, run.endT), i = Math.min(run.frames.n - 1, Math.round(t)), rv = q.b.river;
    let near = null, nd = 9; for (const e of run.events) { const d = Math.abs(X(e.t) - q.x); if (d < nd) { nd = d; near = e; } }
    tip.replaceChildren(h('b', null, q.b.name + ' at ' + clock(t)), h('div.dim', null, [rv[i * 3] ? rv[i * 3] + ' reached' : '', rv[i * 3 + 1] ? rv[i * 3 + 1] + ' confirmed' : '', rv[i * 3 + 2] ? rv[i * 3 + 2] + ' possible' : ''].filter(Boolean).join(' · ') || 'no one located yet'), near ? h('div', null, clock(near.t) + '  ' + near.text) : null);
    tip.style.left = Math.min(host.clientWidth - 300, q.x + 14) + 'px'; tip.style.top = q.y + 14 + 'px'; tip.classList.add('show');
  });
  const end = () => { drag = false; };
  body.addEventListener('pointerup', end); body.addEventListener('pointercancel', end); body.addEventListener('pointerleave', () => tip.classList.remove('show'));
  body.addEventListener('keydown', (ev) => {
    if (ev.target !== body) return;
    const i = rowOf(cursor.id), b = rows[i]?.b; if (!b || !b.run) return;
    const step = ev.shiftKey ? 30 : 5; let handled = true;
    if (ev.key === 'ArrowRight') onCursor(b.id, Math.min(b.run.endT, cursor.t + step));
    else if (ev.key === 'ArrowLeft') onCursor(b.id, Math.max(0, cursor.t - step));
    else if (ev.key === 'Home') onCursor(b.id, 0);
    else if (ev.key === 'End') onCursor(b.id, b.run.endT);
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { let j = i; do { j += ev.key === 'ArrowDown' ? 1 : -1; } while (rows[j] && !rows[j].b.run); if (rows[j]) onCursor(rows[j].b.id, Math.min(cursor.t, rows[j].b.run.endT)); }
    else handled = !!onKey?.(ev, b);
    if (handled) ev.preventDefault();
  });

  return {
    render,
    setCursor(c, cmp) { const changedA = c.id !== cursor.id; cursor = { ...c }; compareId = cmp; if (changedA && built) render(); else place(); },
    setLive(t) { liveT = t; place(); },
    focus() { body.focus(); },
    dispose() { ro.disconnect(); },
  };
}
