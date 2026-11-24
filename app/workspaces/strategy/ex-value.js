// Exhibit 5: the value of a sensor. The same generated worlds, the same greedy planner, one change to the sensors at
// a time. Every figure is a paired difference with a 95 % confidence interval, computed in the page by workers.
import { runPool } from './pool.js';
import { exhibitBrief, demoOverlay, makeLoop, tok, rgba, ci, paired, niceTicks, clamp, fmtPct } from './common.js';

const FIRST = 60001;
const HALF = { f: 0.0555, fFan: 0.0395, fNoFan: 0.065 };
export const CASES = [
  { id: 'base', label: 'As modelled', note: 'All four sensors', s: {} },
  { id: 'noth', label: 'No thermal camera', note: 'Thermal rates assumed', s: { thermal: { on: false } } },
  { id: 'noradar', label: 'No radar', note: 'Radar rates assumed', s: { radar: { on: false }, micro: { on: false } } },
  { id: 'wide', label: 'Double Wi-Fi range', note: '13 m, one wall', s: { csi: { range: 13 } } },
  { id: 'two', label: 'Wi-Fi through two walls', note: 'Rates behind it assumed', s: { csi: { maxWalls: 2 } } },
  { id: 'half', label: 'Half the Wi-Fi false alarms', note: '11.1 % to 5.6 %', s: { csi: HALF } },
  { id: 'still', label: 'Twice the still detection', note: '21 % to 43 %', s: { csi: { dStill: 0.428, depth: [[1.4, 0.57], [2.3, 0.38], [1e9, 0.334]] } } },
];

export default async function (pane, ctx) {
  const { h, icon, fitCanvas, reducedMotion } = ctx.kit, demo = () => ctx.mode === 'demo';
  let rows = new Map(), hist = new Map(), pool = null, ran = false, visible = false, N = 600, metric = 'hour', err = '', sel = 'noth';
  const val = (r) => (metric === 'hour' ? r.perMin * 60 : metric === 'found' ? r.found : r.falseChases);
  const M = { hour: ['people found per hour', 2], found: ['people found per world', 3], false: ['false alarms chased per world', 3] };
  const left = h('div.strategy-col.left.adv-only'), right = h('div.strategy-col.right.adv-only'), cv = h('canvas.strategy-tree', { role: 'img', 'aria-label': 'Change in the chosen measure for each sensor change, narrowing as more worlds are run' });
  const overlay = demoOverlay(ctx.kit, { title: 'What a better sensor is worth', sentence: 'The same simulated buildings, searched again with one sensor changed.', tags: ['live-algo', 'sim'], action: { label: 'Measure again', icon: 'reset', run: () => run() } });
  overlay.el.classList.add('demo-only');
  pane.append(h('div.strategy-ex.wide-side', null, left, h('div.strategy-main', null, h('div.strategy-treewrap', null, cv), overlay.el), right));
  const seg = h('div.btn-group', { role: 'group', 'aria-label': 'Measure' }, ...[['hour', 'Per hour'], ['found', 'Found'], ['false', 'False alarms']].map(([id, t]) => h('button.btn.btn-sm', { type: 'button', 'aria-pressed': String(id === metric), onclick: (e) => { metric = id; for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); hist.clear(); rebuild(); draw(true); } }, t)));
  const status = h('p', { 'aria-live': 'polite' }), runBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => (pool ? stop() : run()) }, 'Measure again'), body = h('tbody'), point = h('p.strategy-point', null, 'Measuring.');
  left.append(exhibitBrief(ctx.kit, { n: 5, title: 'The value of a sensor', sentences: ['A sensor is worth what it changes: who is found, how soon, and how many empty rooms the team is sent into.', 'So the page searches the same buildings again with one thing changed and measures the difference.'], sources: ['howard', 'koopman'], tags: ['live-algo', 'sim'], field: 'Rates must be measured on the real sensor. The Wi-Fi rates come from simulated windows, the radar and thermal rates are assumed.', unknown: 'How rates change in wet, steel or furnished buildings. Sensors are treated as independent, which flatters every addition.' }),
    h('section.strategy-sec', null, h('h3', null, 'Measure'), seg, h('p', null, 'The planner is the greedy rule of exhibit 3, with the stopping threshold tuned for “as modelled” and kept for every case. A better sensor with its own threshold could do better.')));
  right.append(h('section.strategy-sec', null, h('h3', null, 'Measured what-ifs'), status, h('div.strategy-actions', null, runBtn)), h('section.strategy-sec', null, point, h('table.strategy-table', null, h('thead', null, h('tr', null, h('th', null, 'Sensors'), h('th.num', null, 'Per hour'), h('th.num', null, 'Change'), h('th.num', null, 'Found'), h('th.num', null, 'False'))), body), h('p.strategy-fine', null, 'Per hour: mean over worlds of people found divided by mission time. Change: paired difference on the same worlds, 95 % interval, in the chosen measure. Found: share of the people present. False: rooms the team entered with no one in them, per world. Seeds 60001 onward, not used for tuning. Six comparisons are made, so one in twenty intervals is expected to miss.')));
  const get = (id) => rows.get(id) || rows.set(id, new Map()).get(id);
  function pairs(id) { const A = get(id), B = get('base'), a = [], b = []; for (let s = FIRST; s < FIRST + N; s++) if (A.has(s) && B.has(s)) { a.push(val(A.get(s))); b.push(val(B.get(s))); } return [a, b]; }
  function snap() { for (const k of CASES) if (k.id !== 'base') { const [a, b] = pairs(k.id), d = paired(a, b), H = hist.get(k.id) || hist.set(k.id, []).get(k.id); if (d.n > 8 && (!H.length || d.n > H[H.length - 1].n)) H.push(d); } }
  function rebuild() { for (const k of CASES) if (k.id !== 'base') { const [a, b] = pairs(k.id), H = []; for (let n = 20; n <= a.length; n += 20) H.push(paired(a.slice(0, n), b.slice(0, n))); if (a.length % 20) H.push(paired(a, b)); hist.set(k.id, H); } }
  let last = 0;
  function draw(force) {
    const now = performance.now(); if (!force && now - last < 250) return; last = now;
    const n = Math.min(...CASES.map((k) => get(k.id).size)); status.textContent = err || (pool ? n + ' of ' + N + ' worlds' : n ? n + ' worlds each, seeds ' + FIRST + ' to ' + (FIRST + n - 1) + '.' : 'Not run yet.'); runBtn.textContent = pool ? 'Stop' : 'Measure again';
    let best = null; body.replaceChildren(...CASES.map((k) => { const R = [...get(k.id).values()], ph = ci(R.map((r) => r.perMin * 60)), f = R.reduce((s, r) => s + r.found, 0), p = R.reduce((s, r) => s + r.people, 0), fc = ci(R.map((r) => r.falseChases)), [a, b] = pairs(k.id), d = paired(a, b); if (k.id !== 'base' && d.n > 30 && (d.lo > 0 || d.hi < 0) && (!best || Math.abs(d.mean) > Math.abs(best.d.mean))) best = { k, d }; const good = metric === 'false' ? d.hi < 0 : d.lo > 0, bad = metric === 'false' ? d.lo > 0 : d.hi < 0;
      return h('tr', null, h('td', null, k.label), h('td.num', null, ph.n > 1 ? ph.mean.toFixed(2) : '–'), h('td.num', { class: k.id === 'base' ? '' : good ? 'up' : bad ? 'down' : 'flat' }, k.id === 'base' || d.n < 2 ? '–' : (d.mean >= 0 ? '+' : '−') + Math.abs(d.mean).toFixed(2) + ' ± ' + d.half.toFixed(2)), h('td.num', null, p ? fmtPct(f / p) : '–'), h('td.num', null, fc.n ? fc.mean.toFixed(2) : '–')); }));
    point.textContent = n < 30 ? 'Measuring.' : best ? best.k.label + ' changes ' + M[metric][0] + ' most' : 'No change is clear of the noise';
    overlay.caption(n < 30 ? 'Searching the first worlds.' : best ? best.k.label + ': ' + (best.d.mean > 0 ? '+' : '−') + Math.abs(best.d.mean).toFixed(2) + ' ' + M[metric][0] + ', over ' + n + ' worlds.' : 'No change is clear of the noise yet.');
  }
  function run() { pool?.cancel(); rows = new Map(); hist = new Map(); err = ''; const p = runPool({ jobs: CASES.map((k) => ({ key: k.id, policies: ['greedy'], sensors: k.s })), seeds: Array.from({ length: N }, (_, i) => FIRST + i), onRows: (key, rs) => { const m = get(key); for (const r of rs) m.set(r.seed, r); draw(); snap(); }, size: 3, chunk: 12 }); pool = p; draw(true); p.done.then(() => { if (pool !== p) return; pool = null; rebuild(); draw(true); paint(); }, (e) => { if (pool !== p) return; pool = null; err = 'Stopped: ' + e.message; draw(true); }); }
  function stop() { pool?.cancel(); pool = null; draw(true); }

  // ---------- funnels: each case is drawn from few worlds (top) to all worlds (bottom) ----------
  let c = null, W = 0, H = 0, span = [-1, 1];
  fitCanvas(cv, (c2, w, hh) => { c = c2; W = w; H = hh; paint(); });
  function paint() {
    if (!c || W < 60) return; c.clearRect(0, 0, W, H); const d = demo(), L = d ? W * 0.34 : 190, R = d ? W - 190 : W - 110, T = d ? 96 : 34, B = d ? H - 190 : H - 64, list = CASES.filter((k) => k.id !== 'base');
    let lo = -0.2, hi = 0.2; for (const k of list) { const q = hist.get(k.id); if (q && q.length) { const e = q[q.length - 1]; lo = Math.min(lo, e.lo * 1.5); hi = Math.max(hi, e.hi * 1.5); } }
    if (reducedMotion() || !loop.running) span = [lo, hi]; span[0] += (lo - span[0]) * 0.08; span[1] += (hi - span[1]) * 0.08;
    const x = (v) => clamp(L + ((v - span[0]) / (span[1] - span[0])) * (R - L), L - 4, R + 4), rh = (B - T) / list.length;
    c.font = '400 11px ' + tok('--mono'); c.textAlign = 'center'; c.textBaseline = 'top';
    for (const v of niceTicks(span[0], span[1], 7)) { c.strokeStyle = v === 0 ? tok('--text-3') : tok('--line'); c.lineWidth = 1; c.beginPath(); c.moveTo(Math.round(x(v)) + 0.5, T - 8); c.lineTo(Math.round(x(v)) + 0.5, B + 4); c.stroke(); c.fillStyle = tok('--text-3'); c.fillText((v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(span[1] - span[0] < 1 ? 2 : 1), x(v), B + 10); }
    c.font = '500 12px ' + tok('--font'); c.fillStyle = tok('--text-2'); c.textAlign = 'right'; c.fillText('change in ' + M[metric][0], R, B + 28);
    list.forEach((k, i) => {
      const y0 = T + i * rh + 8, y1 = T + (i + 1) * rh - 8, q = hist.get(k.id) || [], e = q[q.length - 1], clear = e && (e.lo > 0 || e.hi < 0), good = e && (metric === 'false' ? e.mean < 0 : e.mean > 0), col = !clear ? '--text-3' : good ? '--ok' : '--danger', yy = (n) => y0 + (n / N) * (y1 - y0);
      c.textAlign = 'right'; c.textBaseline = 'middle'; c.font = '500 ' + (d ? 16 : 13) + 'px ' + tok('--font'); c.fillStyle = tok('--text'); c.fillText(k.label, L - 22, (y0 + y1) / 2 - (d ? 9 : 8)); c.font = '400 ' + (d ? 13 : 11) + 'px ' + tok('--font'); c.fillStyle = tok('--text-3'); c.fillText(k.note, L - 22, (y0 + y1) / 2 + (d ? 12 : 9));
      if (!q.length) return;
      c.beginPath(); q.forEach((s, j) => (j ? c.lineTo(x(s.hi), yy(s.n)) : c.moveTo(x(s.hi), yy(s.n)))); for (let j = q.length - 1; j >= 0; j--) c.lineTo(x(q[j].lo), yy(q[j].n)); c.closePath(); c.fillStyle = rgba(col, 0.2); c.fill();
      c.strokeStyle = tok(col); c.lineWidth = 1.5; c.beginPath(); q.forEach((s, j) => (j ? c.lineTo(x(s.mean), yy(s.n)) : c.moveTo(x(s.mean), yy(s.n)))); c.stroke();
      const ye = yy(e.n); c.fillStyle = tok(col); c.fillRect(x(e.lo), ye - 1.5, Math.max(1, x(e.hi) - x(e.lo)), 3); c.fillRect(x(e.mean) - 2, ye - 6, 4, 12);
      c.textAlign = 'left'; c.font = '500 ' + (d ? 16 : 12) + 'px ' + tok('--mono'); c.fillStyle = clear ? tok('--text') : tok('--text-3'); c.fillText((e.mean >= 0 ? '+' : '−') + Math.abs(e.mean).toFixed(2), R + 18, (y0 + y1) / 2 - (d ? 8 : 7)); c.font = '400 11px ' + tok('--mono'); c.fillStyle = tok('--text-3'); c.fillText('± ' + e.half.toFixed(2), R + 18, (y0 + y1) / 2 + (d ? 10 : 8));
    });
  }
  const loop = makeLoop(() => paint());
  const offMode = ctx.bus.on('mode', () => paint());
  return { show() { visible = true; loop.start(); if (!ran) { ran = true; run(); } }, hide() { visible = false; loop.stop(); if (pool) { stop(); ran = false; } }, restyle() { paint(); draw(true); }, _off: offMode };
}
