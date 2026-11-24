// The live proof: HOUND's real Wi-Fi network (app/core/nn.js) running in this page on held-out test windows.
// Nothing here is recorded or faked: every probability, tick, cross and millisecond is computed when you see it.
import { reduced, clamp, el, getNN, drawHeat, fmtClock } from './shared.js';
import { createEngine } from '../app/core/sim.js';
import { LR, PRIOR, THRESHOLDS } from '../app/core/fusion.js';

const $ = (s, r = document) => r.querySelector(s);
const CATS = [
  { key: 'Empty room', label: 'Empty room', sub: 'No one behind the wall', person: false },
  { key: 'Empty room + fan', label: 'Empty room, fan on', sub: 'Something else that moves', person: false },
  { key: 'Person moving', label: 'Person walking', sub: '0.3 to 1.0 m/s', person: true },
  { key: 'Person standing still', label: 'Person standing still', sub: 'Breathing only', person: true },
  { key: 'Person lying still', label: 'Person lying still', sub: 'Breathing only', person: true },
];
const catOf = (key) => CATS.find((c) => c.key === key) || { label: key, sub: '', person: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inView = (node, cb, opts) => new IntersectionObserver((es) => cb(es[0].isIntersecting), opts).observe(node);

function verdict(out) { return out.says ? (out.moving > 0.5 ? 'Person, moving' : 'Person, still') : 'No one'; }
function explain(cat) {
  return 'In this window: ' + cat.label.toLowerCase() + '.';
}

export async function startProof({ onScene }) {
  const host = $('#proof');
  let nn;
  try { nn = await getNN(); }
  catch (e) {
    host.replaceChildren(el('p.proof-wait', { role: 'alert' }, 'The network file did not load (' + e.message + '). Reload the page to try again.'));
    $('#hp-what').textContent = 'The network did not load'; $('#ladder').replaceChildren();
    return;
  }
  const thr = nn.threshold;
  // Run all 30 once, so the match with Python is known straight away.
  const all = nn.samples.map((_, i) => nn.inferSample(i));
  const nMatch = all.filter((o) => o.matchesPython).length;

  startHeroChip(nn, all, onScene);
  startLadder(nn);

  // ----- build the instrument -----
  const cells = [];
  const grid = el('div.pf-grid', null, CATS.map((c) => el('div.pf-cat', null,
    el('span', null, c.label, el('small', null, c.sub)),
    el('div.pf-cells', null, (nn.byCat[c.key] || []).map((i, k) => {
      const b = el('button.pf-cell', { type: 'button', 'aria-pressed': 'false', 'aria-label': `${c.label}, window ${k + 1}.`, onclick: () => { setAuto(false); pick(i); } });
      cells[i] = b; return b;
    })))));
  const autoBtn = el('button.lbtn.lbtn-line.pf-auto', { type: 'button', 'aria-pressed': String(!reduced), onclick: () => setAuto(!auto) }, reduced ? 'Step through all 30' : 'Stop stepping through');
  const csi = el('canvas', { id: 'pf-csi', width: 200, height: 52, role: 'img', 'aria-label': 'The Wi-Fi window as a heat map: 52 rows of signal strength over 200 time steps' });
  const LAYERS = [
    { id: 'c1', name: 'Convolution 1', dim: '24 filters \u00d7 192 steps' },
    { id: 'c2', name: 'Convolution 2', dim: '24 \u00d7 40' },
    { id: 'c3', name: 'Convolution 3', dim: '24 \u00d7 12' },
    { id: 'hidden', name: 'Dense', dim: '32 units' },
  ].map((l) => { l.canvas = el('canvas', { 'aria-hidden': 'true' }); l.node = el('div.pf-layer', null, l.canvas, el('span', null, el('b', null, l.name), l.dim)); return l; });
  const vEl = el('div.pf-verdict', { 'aria-live': 'polite' }, '\u00a0');
  const gauge = (label) => {
    const val = el('span.num', null, ''), bar = el('i'), wrap = el('div.pf-gauge', null, el('label', null, el('span', null, label), val), el('div.pf-track', null, bar));
    return { wrap, val, bar, track: wrap.lastChild };
  };
  const gP = gauge('Someone is there'), gM = gauge('They are moving');
  gP.track.append(el('u', { style: `left:${(thr * 100).toFixed(1)}%`, 'data-l': 'alarm above ' + thr.toFixed(2) }));
  const kv = { truth: el('dd'), py: el('dd.num'), js: el('dd.num'), ms: el('dd.num') };
  const truthline = el('p.pf-truthline', null, '');
  host.replaceChildren(el('div.pf', null,
    el('section', { 'aria-label': 'Pick a test window' },
      el('h3', null, 'Pick a window', el('span', null, '30 held-out, simulated')),
      el('p.pf-sub', null, 'Five situations, six windows each. Press a square to run the network on it.'),
      grid,
      el('div.pf-score', null,
        el('div', null, el('span', null, 'Same answer as the Python original'), el('span.num', null, `${nMatch} of ${all.length}`))),
      autoBtn),
    el('section.pf-mid', { 'aria-label': 'The signal and the network layers' },
      el('h3', null, 'What the receiver on the rover measured', el('span', null, '10 seconds through a wall')),
      el('div.pf-canvas-wrap', null, csi),
      el('div.pf-axis', null, el('span', null, '0 s'), el('span', null, '52 rows of signal strength, one column per time step'), el('span', null, '10 s')),
      el('div.pf-layers', null, LAYERS.map((l) => l.node))),
    el('section.pf-out', { 'aria-label': 'The network\u2019s answer' },
      el('h3', null, 'The network\u2019s answer', el('span', null, '23,372 parameters')),
      vEl, gP.wrap, gM.wrap,
      el('dl.pf-kv', null,
        el('div', null, el('dt', null, 'What is really in the window'), kv.truth),
        el('div', null, el('dt', null, 'Python reference'), kv.py),
        el('div', null, el('dt', null, 'This browser'), kv.js),
        el('div', null, el('dt', null, 'Time on this computer'), kv.ms)),
      truthline)));

  let current = -1, run = 0, auto = !reduced, visible = false, timer = 0;
  const order = Array.from({ length: all.length }, (_, k) => (12 + k * 7) % all.length);   // starts on a walking person
  let step = 0;
  function setAuto(on) { auto = on; autoBtn.setAttribute('aria-pressed', String(on)); autoBtn.textContent = on ? 'Stop stepping through' : 'Step through all 30'; schedule(); }
  function schedule() { clearTimeout(timer); if (auto && visible) timer = setTimeout(() => { pick(order[++step % order.length]); }, 4200); }

  const ridge = startRidge();
  async function pick(i) {
    const id = ++run; current = i;
    ridge(nn.samples[i].x, catOf(nn.samples[i].cat).label);
    cells.forEach((b, k) => b && b.setAttribute('aria-pressed', String(k === i)));
    const s = nn.samples[i], cat = catOf(s.cat);
    const out = nn.inferSample(i, { trace: true });
    // timing: the traced pass allocates more, so time a plain pass (median of 5)
    const times = []; for (let k = 0; k < 5; k++) times.push(nn.inferSample(i).ms); times.sort((a, b) => a - b);
    const ms = times[2];
    LAYERS.forEach((l) => l.node.classList.remove('on'));
    vEl.textContent = '\u00a0'; gP.bar.style.width = '0'; gM.bar.style.width = '0'; gP.val.textContent = gM.val.textContent = '';
    truthline.textContent = ''; truthline.className = 'pf-truthline'; truthline.hidden = true;
    kv.truth.textContent = cat.label; kv.py.textContent = kv.js.textContent = kv.ms.textContent = '';
    if (reduced) drawHeat(csi, s.x, -1.6, 1.6);
    else {                                              // the window is read left to right, as it was received
      const t0 = performance.now(), dur = 620;
      await new Promise((res) => { const f = (now) => { if (id !== run) return res(); const t = clamp((now - t0) / dur); drawHeat(csi, s.x, -1.6, 1.6, { upto: Math.round(t * 200) }); t < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
    }
    if (id !== run) return;
    for (const l of LAYERS) {
      const data = l.id === 'hidden' ? Array.from({ length: 8 }, (_, r) => out.layers.hidden.slice(r * 4, r * 4 + 4)) : out.layers[l.id];
      let hi = 0; for (const r of data) for (const v of r) if (v > hi) hi = v;
      drawHeat(l.canvas, data, 0, hi * 0.85 || 1);
      l.node.classList.add('on');
      if (!reduced) { await sleep(110); if (id !== run) return; }
    }
    vEl.replaceChildren(verdict(out), el('small', null, out.says ? 'Output above the alarm level.' : 'Output below the alarm level.'));
    gP.bar.style.width = (out.person * 100).toFixed(1) + '%'; gP.val.textContent = out.person.toFixed(3);
    gP.bar.style.background = out.says ? 'var(--person)' : '';
    gM.bar.style.width = (out.moving * 100).toFixed(1) + '%'; gM.val.textContent = out.moving.toFixed(3);
    gM.wrap.style.opacity = out.says ? '1' : '0.45';
    kv.py.textContent = s.ref[0].toFixed(4); kv.js.textContent = out.person.toFixed(4);
    kv.js.className = 'num ' + (out.matchesPython ? 'ok' : 'warn'); kv.js.title = out.matchesPython ? 'Matches the Python output' : 'Differs from the Python output';
    kv.ms.textContent = ms < 0.1 ? 'under 0.1 ms' : ms.toFixed(1) + ' ms';
    truthline.textContent = explain(cat); truthline.hidden = false;
    schedule();
  }
  inView(host, (on) => { visible = on; if (on && current < 0) pick(order[0]); else schedule(); }, { threshold: 0.05 });
}

// ---------- the window being read, drawn as 52 ridges behind the section title ----------
function startRidge() {
  const cv = $('#net-ridge'), cap = $('#net-ridge-cap'), c = cv.getContext('2d');
  let rows = null, prev = null, t0 = 0, raf = 0, W = 0, H = 0;
  // light smoothing over time so a ridge reads as a line; the numbers are the window's own
  const smooth = (x) => x.map((r) => r.map((_, j) => { let s = 0, n = 0; for (let k = -2; k <= 2; k++) { const v = r[j + k]; if (v !== undefined) { const w = 3 - Math.abs(k); s += v * w; n += w; } } return s / n; }));
  function size() { const r = cv.getBoundingClientRect(), d = Math.min(1.5, devicePixelRatio || 1); W = r.width; H = r.height; cv.width = Math.round(W * d); cv.height = Math.round(H * d); c.setTransform(d, 0, 0, d, 0, 0); if (rows) draw(1); }
  function draw(u) {
    c.clearRect(0, 0, W, H);
    const n = rows.length, m = rows[0].length, top = 120, gap = (H - top - 60) / n, head = u * 1.08 * m;
    for (let i = 0; i < n; i++) {
      const y = top + i * gap, z = i / (n - 1), inset = (1 - z) * W * 0.16, span = W - inset * 1.2, A = 8 + z * 10;
      const path = new Path2D();
      for (let j = 0; j < m; j++) {
        const v = j <= head ? rows[i][j] : prev ? prev[i][j] : 0, win = Math.sin(Math.PI * j / (m - 1));
        const px = inset + (j / (m - 1)) * span, py = y - Math.max(-0.6, Math.min(2.6, v)) * A * (0.35 + 0.65 * win);
        j ? path.lineTo(px, py) : path.moveTo(px, py);
      }
      c.strokeStyle = `rgba(${Math.round(150 + 100 * z)},${Math.round(190 - 30 * z)},${Math.round(235 - 110 * z)},${0.16 + 0.5 * z})`; c.lineWidth = 1;
      const ridgeLine = new Path2D(path); path.lineTo(inset + span, y + 24); path.lineTo(inset, y + 24); path.closePath();
      c.fillStyle = '#06080a'; c.fill(path); c.stroke(ridgeLine);
    }
  }
  new ResizeObserver(size).observe(cv);
  return (x, label) => {
    prev = rows; rows = smooth(x); cap.textContent = 'The window being read below, as 52 ridges over ten seconds: ' + label.toLowerCase() + '. Simulated.';
    if (!W) size();
    if (reduced) return draw(1);
    t0 = performance.now(); cancelAnimationFrame(raf);
    const f = (now) => { const u = Math.min(1, (now - t0) / 1500); draw(u); if (u < 1) raf = requestAnimationFrame(f); };
    raf = requestAnimationFrame(f);
  };
}

// ---------- the small instrument in the hero ----------
function startHeroChip(nn, all, onScene) {
  const canvas = $('#hp-canvas'), what = $('#hp-what'), msEl = $('#hp-ms'), says = $('#hp-says'), pEl = $('#hp-p'), bar = $('#hp-bar'), truth = $('#hp-truth');
  $('#hp-thr').style.left = (nn.threshold * 100).toFixed(1) + '%';
  // Every one of the 30 windows plays once. Right answers first, then wrong ones in their true proportion (one in three).
  const right0 = [], wrong0 = [];
  for (const c of ['Person moving', 'Empty room', 'Empty room + fan', 'Person standing still', 'Person lying still']) (nn.byCat[c] || []).forEach((i, n) => (all[i].says === all[i].truthPerson ? right0 : wrong0).push([n, i]));
  const mixed = (a) => a.sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  const R0 = mixed(right0), W0 = mixed(wrong0), order = ['Person moving', 'Empty room', 'Person standing still', 'Empty room + fan'].map((c) => R0.find((i) => nn.samples[i].cat === c)).filter((i) => i != null);   // one of each kind opens
  for (const i of order) R0.splice(R0.indexOf(i), 1);
  while (R0.length || W0.length) order.push(...R0.splice(0, 2), ...W0.splice(0, 1));
  let k = 0, visible = true, timer = 0, run = 0;
  async function show() {
    const id = ++run, i = order[k++ % order.length], s = nn.samples[i], cat = catOf(s.cat);
    const out = nn.inferSample(i);
    what.textContent = `Test window ${i + 1} of ${all.length}`; msEl.textContent = '';
    says.textContent = 'Reading 10 s of signal'; says.style.color = 'var(--text-3)'; pEl.textContent = ''; bar.style.width = '0'; truth.textContent = '\u00a0';
    if (!reduced) {
      const t0 = performance.now();
      await new Promise((res) => { const f = (now) => { if (id !== run) return res(); const t = clamp((now - t0) / 700); drawHeat(canvas, s.x, -1.6, 1.6, { upto: Math.round(t * 200) }); t < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
      if (id !== run) return;
    } else drawHeat(canvas, s.x, -1.6, 1.6);
    says.textContent = verdict(out); says.style.color = out.says ? 'var(--person)' : '';
    pEl.textContent = 'p = ' + out.person.toFixed(2); msEl.textContent = out.ms < 0.1 ? '< 0.1 ms' : out.ms.toFixed(1) + ' ms';
    bar.style.width = (out.person * 100).toFixed(1) + '%'; bar.style.background = out.says ? 'var(--person)' : '';
    truth.textContent = `In this window: ${cat.label.toLowerCase()}.`;
    if (!reduced) timer = setTimeout(() => { if (visible) show(); }, 3400);
  }
  onScene('film', (p, u, spanVh) => { const v = u * spanVh < 0.6; if (v && !visible) { visible = true; clearTimeout(timer); show(); } else if (!v) { visible = false; clearTimeout(timer); } });
  show();
}

// ---------- a worked example of fusion, taken from the scripted mission ----------
// The mission is run once, off screen, with the real network, planner and fusion code. The table is one
// detection's own record of how its probability was reached.
function startLadder(nn) {
  const host = $('#ladder');
  let det = null, S = null;
  try {
    const eng = createEngine({ nn, keep: { autoplay: true } });
    let guard = 0; while (!eng.done && guard++ < 40000) eng.step();
    S = eng.state;
    const inside = S.detections.filter((d) => !d.outdoor && d.status === 'confirmed' && d.steps.length >= 3);
    const missedFirst = (d) => d.steps.some((s) => s.sensor === 'csi' && s.result === 'neg');
    det = inside.find(missedFirst) || inside.sort((a, b) => b.steps.length - a.steps.length)[0] || S.detections.sort((a, b) => b.steps.length - a.steps.length)[0];
  } catch (e) { console.error('[landing] worked example failed', e); }
  if (!det) { host.replaceChildren(el('p.proof-wait', { role: 'alert' }, 'The worked example could not be computed here. It is shown step by step in the console, under Fusion.')); return; }
  window.__landing && (window.__landing.example = det, window.__landing.final = S);

  const RESULT = { none: 'no moving target', pos: 'says person', neg: 'says no one', faint: 'faint warm shape', machine: 'steady, like a machine', tooHot: 'too hot to be a person', blind: 'could not see' };
  const steps = det.steps;
  const LAST = 4;                                        // the chart has every reading, the table the last few
  const rows = steps.map((s, i) => el('div.ld-row.' + (s.lr > 1.001 ? 'up' : s.lr < 0.999 ? 'down' : 'flat'), null,
    el('span.t', null, s.t != null && (i === 0 || i === steps.length - LAST || steps[i - 1].t !== s.t) ? fmtClock(s.t) : ''),
    el('span', null, LR[s.sensor]?.label || s.sensor, s.repeat ? el('small', { style: 'display:block;color:var(--text-3);font-size:12px' }, 'second reading, half weight') : null),
    el('span.r', null, RESULT[s.result] || s.result),
    el('span.lr', null, '\u00d7 ' + s.lr.toFixed(2), el('small' + (s.assumed ? '' : '.m'), null, s.assumed ? 'design value' : 'measured')),
    el('span.p', null, (s.p * 100).toFixed(1) + ' %')));
  const chart = el('canvas', { role: 'img', 'aria-label': `Probability after each reading, from ${(PRIOR * 100).toFixed(0)} percent to ${(det.p * 100).toFixed(0)} percent` });
  const room = det.room ? 'room ' + det.room : 'the site';
  host.replaceChildren(
    el('div.ld-head', null,
      el('h4', null, `Worked example: the person in ${room}`),
      el('p', null, `Computed in this page.${steps.length > LAST ? ` The table has the last ${LAST} of ${steps.length} readings.` : ''}`),
      el('span.rl.rl-live-algo', null, 'Live algorithm'), el('span.rl.rl-sim', null, 'Simulated readings')),
    el('div.ld-body', null,
      el('div.ld-chart', null,
        el('h5', null, `From ${(PRIOR * 100).toFixed(0)} % to ${(det.p * 100).toFixed(0)} % in ${steps.length} readings.`),
        chart),
      el('div.ld-table', null,
        el('div.ld-row.ld-h', null, el('span', null, 'Time'), el('span', null, 'Sensor'), el('span', null, 'Reading'), el('span', { style: 'text-align:right' }, 'Odds'), el('span', { style: 'text-align:right' }, 'Chance')),
        rows.slice(-LAST))),
    el('p.ld-foot', null, 'Each reading multiplies the odds by its likelihood ratio. The Wi-Fi ratios are measured on the 955 simulated test windows. The radar, thermal, drone and rescue-team ratios are design values and are marked so. Above ',
      (THRESHOLDS.confirmed * 100).toFixed(0), ' % a finding is confirmed; down to ', (THRESHOLDS.possible * 100).toFixed(0), ' % it stays open as a lead.'));

  const draw = (grow = 1) => {
    const r = chart.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (!r.width) return;
    chart.width = Math.round(r.width * dpr); chart.height = Math.round(r.height * dpr);
    const c = chart.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height, L = 40, R = 14, T = 12, B = 26, pts = [PRIOR, ...steps.map((s) => s.p)];
    const X = (i) => L + (W - L - R) * (i / (pts.length - 1 || 1)), Y = (p) => T + (H - T - B) * (1 - p);
    c.font = '11.5px "Geist Mono", ui-monospace, Menlo, monospace'; c.textBaseline = 'middle';
    for (const g of [0, 0.25, 0.5, 0.75, 1]) { c.strokeStyle = 'rgba(233,237,242,0.08)'; c.beginPath(); c.moveTo(L, Y(g) + 0.5); c.lineTo(W - R, Y(g) + 0.5); c.stroke(); c.fillStyle = '#74808e'; c.textAlign = 'right'; c.fillText((g * 100) + '%', L - 8, Y(g)); }
    const band = (p, col, label) => { c.setLineDash([3, 4]); c.strokeStyle = col; c.beginPath(); c.moveTo(L, Y(p) + 0.5); c.lineTo(W - R, Y(p) + 0.5); c.stroke(); c.setLineDash([]); c.fillStyle = col; c.textAlign = 'right'; c.font = '11.5px "Instrument Sans", system-ui, sans-serif'; c.fillText(label, W - R, Y(p) - 9); c.font = '11.5px "Geist Mono", ui-monospace, Menlo, monospace'; };
    band(THRESHOLDS.confirmed, '#ff6a45', 'confirmed'); band(THRESHOLDS.possible, '#ffb224', 'kept open as a lead');
    const upto = grow * (pts.length - 1);
    c.strokeStyle = '#e9edf2'; c.lineWidth = 1.5; c.lineJoin = 'miter'; c.beginPath(); c.moveTo(X(0), Y(pts[0]));
    for (let i = 1; i < pts.length; i++) {
      const f = clamp(upto - (i - 1)); if (f <= 0) break;
      c.lineTo(X(i - 1) + (X(i) - X(i - 1)) * Math.min(1, f * 2), Y(pts[i - 1]));          // steps: flat, then up or down
      if (f > 0.5) c.lineTo(X(i), Y(pts[i - 1]) + (Y(pts[i]) - Y(pts[i - 1])) * (f - 0.5) * 2);
    }
    c.stroke(); c.lineWidth = 1;
    pts.forEach((p, i) => { if (i > upto + 0.001) return; c.fillStyle = p >= THRESHOLDS.confirmed ? '#ff6a45' : p >= THRESHOLDS.possible ? '#ffb224' : '#e9edf2'; c.fillRect(X(i) - 3, Y(p) - 3, 6, 6); c.fillStyle = '#74808e'; c.textAlign = 'center'; c.fillText(i === 0 ? 'prior' : String(i), X(i), H - 10); });
  };
  let shown = false;
  new ResizeObserver(() => draw(shown || reduced ? 1 : 0)).observe(chart);
  inView(chart, (on) => {
    if (!on || shown) return; shown = true;
    if (reduced) return draw(1);
    const t0 = performance.now(), dur = 1500; const f = (now) => { const t = clamp((now - t0) / dur); draw(1 - Math.pow(1 - t, 3)); if (t < 1) requestAnimationFrame(f); }; requestAnimationFrame(f);
  }, { threshold: 0.4 });
}
