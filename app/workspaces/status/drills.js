// Fault drills (Advanced): each fault switched on in the live mission, with the response read from its own log.
import { drawPlan } from './plan2d.js';
import { MODE_WORDS } from './film.js';
const R1 = 'HOUND-01';

export function createDrillPanel(ctx) {
  const { h, icon, panel, fmt, fitCanvas, cssVar, realityTag } = ctx.kit, rows = new Map(), LIST = [...Object.keys(ctx.FAULTS), 'newHazard'];
  const INFO = { ...ctx.FAULTS, newHazard: { label: 'A second slide', does: 'Debris closes part of a route. Every route in use is planned again; if there is no safe way, the unit holds and says so.' } };
  const WATCH = { linkLoss: ['FAULT', 'FAULT_CLEARED'], csiDropout: ['FAULT', 'WINDOW_REJECTED', 'CSI_UNAVAILABLE', 'FAULT_CLEARED'], badWindow: ['FAULT', 'WINDOW_REJECTED', 'CSI_UNAVAILABLE', 'FAULT_CLEARED'], thermalFail: ['FAULT', 'FAULT_CLEARED'], lowBattery: ['FAULT', 'BATTERY_LOW', 'BATTERY_SWAPPED', 'FAULT_CLEARED'], newHazard: ['NEW_HAZARD', 'REPLANNED', 'NO_PATH', 'ROUTE_PLANNED'] };
  const WHEN = { linkLoss: 'Acts at once, while the rover is out.', csiDropout: 'Acts at the next listening stop.', badWindow: 'Acts at the next listening stop.', thermalFail: 'Acts at the next reading.', lowBattery: 'Acts before the next stop.', newHazard: 'Acts at once, if a route crosses it.' };
  const SLIDES = [null, { poly: [[30, 8], [33, 8], [33, 15], [30, 15]], name: 'Another slide: debris by staging' }, { poly: [[46, 14], [49, 14], [49, 22], [46, 22]], name: 'A third slide: debris in the yard' }];
  let picked = 'linkLoss', pc = null, sc = null, offs = [], shown = false, lastLog = '', lastT = 0; const hist = [];
  const list = h('div.status-drills', { role: 'list' });
  for (const id of LIST) {
    const btn = h('button.btn', { onclick: () => run(id) }), st = h('span.status'), row = h('div.status-drill', { role: 'listitem' }, h('button.status-drill-pick', { 'aria-label': 'Show the log lines about: ' + INFO[id].label, onclick: () => { picked = id; refresh(); } }, h('b', null, INFO[id].label), h('span', null, INFO[id].does), h('small', null, WHEN[id])), h('div.status-drill-act', null, st, btn));
    rows.set(id, { row, btn, st }); list.append(row);
  }
  function run(id) {
    picked = id; const S = ctx.sim.state;
    if (id === 'newHazard') { if (S.hazards.length >= SLIDES.length) { ctx.shell.toast('Three slides are already on the map. Restart the mission to clear them.', { level: 'warn' }); return; } ctx.sim.command('newHazard', SLIDES[S.hazards.length] || {}); }
    else ctx.sim.command(S.faults[id] ? 'clearFault' : 'injectFault', { id });
    if (!ctx.sim.state.running && ctx.sim.state.phase !== 'complete') ctx.sim.play(); refresh();
  }
  const log = h('ol.status-log', { 'aria-label': 'What the system did', tabindex: '0' }), what = h('div.status-now'), cv = h('canvas', { role: 'img', 'aria-label': 'Plan of the site with the rover, its route and any new debris' }), strip = h('canvas', { role: 'img', 'aria-label': 'Speed, link and battery of the rover over the last three minutes of simulated time' });
  const restart = h('button.btn.btn-sm', { onclick: async () => { if (await ctx.shell.confirm({ title: 'Restart the mission?', body: 'The live mission starts again from the beginning, with no faults and no extra debris.', confirmLabel: 'Restart', danger: true })) { ctx.sim.reset(); ctx.sim.play(); } } }, icon('reset'), 'Restart');
  const jump = h('button.btn.btn-sm', { title: 'Jump to the moment the rover is driving in', onclick: () => { ctx.sim.seek(120); ctx.sim.play(); } }, icon('skip-forward'), 'Jump to the drive in');
  const el = h('div.status-drillview', null,
    panel('Break something', { tag: realityTag('live-algo'), flush: true }, list, h('p.status-foot', null, 'These act on the live mission. Each one is safe to run at any time: a fault can hold or turn back a unit, never send one forward.')),
    h('div.status-col', null, panel('What the rover is doing', { actions: [jump, restart], flush: true }, what, h('div.status-planbox', null, cv)), panel('Speed, link and battery over the last three minutes', { flush: true }, h('div.status-stripbox', null, strip))),
    panel('What the system did', { flush: true, tag: h('span.caption', null, 'mission log, newest first') }, log));
  function refresh() {
    const S = ctx.sim.state, u = S.units[R1];
    for (const [id, r] of rows) {
      const haz = id === 'newHazard', on = haz ? S.hazards.length > 0 : !!S.faults[id]; r.row.classList.toggle('on', on); r.row.classList.toggle('picked', picked === id);
      r.btn.textContent = haz ? 'Drop it' : on ? 'Clear' : 'Break it'; r.btn.className = 'btn btn-sm' + (on && !haz ? ' btn-primary' : ''); r.btn.setAttribute('aria-label', (haz ? 'Drop' : on ? 'Clear' : 'Inject') + ': ' + INFO[id].label);
      r.st.className = 'status ' + (on ? 'warn live' : 'off'); r.st.textContent = on ? (haz ? S.hazards.length + ' on the map' : 'On') : 'Off';
    }
    what.replaceChildren(h('b', null, S.hold ? 'All stop' : MODE_WORDS[u.mode] || u.mode), h('span', null, u.stop && u.mode === 'listen' ? 'at ' + u.stop : ctx.PHASE_INFO[S.phase].label), h('span.num', null, u.v.toFixed(2) + ' m/s'), h('span.num', { class: u.link <= 0.05 ? 'bad' : '' }, 'link ' + (u.link * 100).toFixed(0) + ' %'), h('span.num', { class: u.battery <= 0.15 ? 'bad' : '' }, 'battery ' + (u.battery * 100).toFixed(0) + ' %'), h('span.num', null, 'T+' + fmt.clock(S.t)));
    const codes = new Set(WATCH[picked]), key = picked + S.events.length + (S.events[S.events.length - 1]?.id || '');
    if (key !== lastLog) { lastLog = key; const all = S.events.slice(-60).reverse(); log.replaceChildren(...(all.length ? all.map((e) => h('li', { class: 'lv-' + e.level + (codes.has(e.code) && (!e.fault || e.fault === picked) ? ' hit' : '') }, h('span.num', null, fmt.clock(e.t)), h('span', null, e.text))) : [h('li.none', null, 'Nothing yet. Press play, or jump to the drive in.')])); }
  }
  function paint() { if (pc) { const r = cv.getBoundingClientRect(); drawPlan(pc, r.width, r.height, { world: ctx.world, S: ctx.sim.state, css: cssVar, view: [14, 4, 108, 66] }); } if (sc) paintStrip(); }
  function paintStrip() {
    const r = strip.getBoundingClientRect(), w = r.width, hh = r.height, c = sc, L = 62, Rt = 12, T0 = 10, B = 22, T = ctx.sim.state.t, X = (t) => L + ((t - (T - 180)) / 180) * (w - L - Rt), lane = (hh - T0 - B) / 3;
    c.clearRect(0, 0, w, hh); c.font = '500 11px ' + cssVar('--mono'); c.textBaseline = 'middle'; c.fillStyle = cssVar('--warn-soft');
    for (let i = 1; i < hist.length; i++) if (hist[i].f && hist[i].t >= T - 180) c.fillRect(X(Math.max(hist[i - 1].t, T - 180)), T0, X(hist[i].t) - X(Math.max(hist[i - 1].t, T - 180)) + 0.5, hh - T0 - B);
    [['speed', 'v', 0.5], ['link', 'l', 1], ['battery', 'b', 1]].forEach(([name, k, mx], i) => { const y0 = T0 + lane * (i + 1) - 4, y1 = T0 + lane * i + 4; c.strokeStyle = cssVar('--line'); c.lineWidth = 1; c.beginPath(); c.moveTo(L, y0 + 0.5); c.lineTo(w - Rt, y0 + 0.5); c.stroke(); c.fillStyle = cssVar('--text-3'); c.textAlign = 'right'; c.fillText(name, L - 8, (y0 + y1) / 2); c.strokeStyle = cssVar('--accent'); c.lineWidth = 1.5; c.beginPath(); let st = false; for (const p of hist) { if (p.t < T - 180) continue; const x = X(p.t), y = y0 + ((y1 - y0) * p[k]) / mx; if (st) c.lineTo(x, y); else c.moveTo(x, y); st = true; } c.stroke(); });
    c.fillStyle = cssVar('--text-3'); c.textAlign = 'center'; for (const s of [-180, -120, -60, 0]) c.fillText(s ? s + ' s' : 'now', Math.min(w - 22, X(T + s)), hh - 10);
  }
  const tick = (S) => { const u = S.units[R1]; if (hist.length && S.t < hist[hist.length - 1].t) hist.length = 0; if (!hist.length || S.t - hist[hist.length - 1].t > 0.4) { hist.push({ t: S.t, v: u.v, l: u.link, b: u.battery, f: Object.values(S.faults).some(Boolean) }); while (hist.length && hist[0].t < S.t - 190) hist.shift(); } const now = performance.now(); if (now - lastT < 60) return; lastT = now; refresh(); paint(); };
  const clear = () => { hist.length = 0; lastLog = ''; refresh(); paint(); };
  return {
    el,
    show() { if (shown) return; shown = true; offs = [fitCanvas(cv, (c) => { pc = c; paint(); }), fitCanvas(strip, (c) => { sc = c; paint(); }), ctx.bus.on('tick', tick), ctx.bus.on('fault', refresh), ctx.bus.on('reset', clear), ctx.bus.on('seek', clear)]; refresh(); paint(); },
    hide() { if (!shown) return; shown = false; offs.forEach((f) => f()); offs = []; },
  };
}
