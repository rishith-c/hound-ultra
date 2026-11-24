// Breath plume: a concept, and an honest one. A person breathes out about a quarter of a litre of carbon dioxide
// a minute. In a sealed void it builds up and leaks out through cracks. Could a rover with a cheap CO2 sensor
// follow that leak back to its source? This is a small 2-D model of the idea, seen from above:
//   air flow    potential flow around the rubble (Laplace's equation, solved once by over-relaxation)
//   gas         advection (first-order upwind, finite volume) + turbulent diffusion, explicit time steps
//   rover       reads one noisy, slow sensor, fits a plane to its last few readings and drives up the slope
// Every number is assumed. Real plumes are patchy and turbulent; this smooth model flatters the idea.
import { pointInPoly, mulberry32, dist } from '../../core/geometry.js';
import { C, surface, slider, seg, intro, text, rgba, clamp, gauss } from './util.js';

const LX = 18, LY = 14, DX = 0.1, NX = 180, NY = 140, DT = 0.04, OY = 1.5;
const up = (pts) => pts.map(([x, y]) => [x, y + OY]);
const BLOCK = up([[1.4, 2.8], [4.2, 2.2], [7.0, 2.9], [7.6, 5.0], [7.2, 7.6], [5.2, 8.8], [2.2, 8.4], [1.2, 6.0]]);
const VOID = up([[3.2, 5.0], [4.2, 4.7], [5.3, 5.1], [5.5, 5.9], [4.6, 6.5], [3.4, 6.3], [3.0, 5.6]]);
const CRACK = up([[5.2, 5.35], [7.7, 4.85], [7.7, 5.2], [5.2, 5.7]]);
const DEBRIS = [[[10, 7.2], [11.6, 7.0], [11.9, 8.3], [10.3, 8.6]], [[12.2, 2.0], [13.8, 2.4], [13.5, 3.6], [12.0, 3.3]], [[9.0, 3.4], [9.9, 3.2], [10.1, 4.2], [9.2, 4.4]], [[14.6, 5.9], [15.6, 5.6], [16.0, 6.9], [14.8, 7.2]], [[11.2, 10.4], [12.6, 10.1], [12.9, 11.2], [11.5, 11.5]]].map(up);
const PERSON = [4.2, 5.6 + OY], MOUTH = [7.75, 5.0 + OY], START = [16.4, 3.6];
const FLEET = [[16.8, 2.2], [16.8, 4.6], [16.8, 7.0], [16.8, 9.4], [16.8, 11.8], [13.5, 1.2], [10.5, 1.2], [13.5, 12.8], [10.5, 12.8], [8.6, 1.4], [8.6, 12.6], [15.4, 12.6]];
const SRC = 4.2e-6 / (9 * DX * DX * 1.0) * 1e6; // ppm per second in each of 9 source cells: 0.25 L/min into a 1 m deep layer (assumed)
const TAU = 3;                                   // sensor response time, s (assumed; cheap sensors are slower)

export function create(root, ctx) {
  const { h, realityTag, fmt, reducedMotion } = ctx.kit;
  const n = NX * NY, open = new Uint8Array(n), c = new Float32Array(n), c2 = new Float32Array(n);
  const gxX = new Float32Array(n), gyX = new Float32Array(n), gxY = new Float32Array(n), gyY = new Float32Array(n);
  const cell = (p) => clamp(Math.floor(p[1] / DX), 0, NY - 1) * NX + clamp(Math.floor(p[0] / DX), 0, NX - 1);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const p = [(i + 0.5) * DX, (j + 0.5) * DX]; const solid = (pointInPoly(p, BLOCK) && !pointInPoly(p, VOID) && !pointInPoly(p, CRACK)) || DEBRIS.some((d) => pointInPoly(p, d)); open[j * NX + i] = solid ? 0 : 1; }
  // potential flow for a unit wind along x and along y; any wind is a mix of the two
  function potential(axis) {
    const phi = new Float32Array(n); for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) phi[j * NX + i] = (axis ? j : i) * DX;
    for (let it = 0; it < 500; it++) for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) { const k = j * NX + i; if (!open[k]) continue; let s = 0, m = 0; if (open[k - 1]) { s += phi[k - 1]; m++; } if (open[k + 1]) { s += phi[k + 1]; m++; } if (open[k - NX]) { s += phi[k - NX]; m++; } if (open[k + NX]) { s += phi[k + NX]; m++; } if (m) phi[k] += 1.9 * (s / m - phi[k]); }
    return phi;
  }
  let ready = false;
  function build() {
    const px = potential(0), py = potential(1);
    for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) { const k = j * NX + i; if (!open[k]) continue; if (open[k + 1]) { gxX[k] = (px[k + 1] - px[k]) / DX; gxY[k] = (py[k + 1] - py[k]) / DX; } if (open[k + NX]) { gyX[k] = (px[k + NX] - px[k]) / DX; gyY[k] = (py[k + NX] - py[k]) / DX; } }
    ready = true;
  }

  // ----- state -----
  let windDir = 0.12, windSpeed = 0.08, sigma = 2, speed = 16, time = 0, shown = false, raf = 0, lastT = 0, warm = 0;
  const rng = mulberry32(77), srcCells = []; { const k0 = cell([4.7, 5.6 + OY]); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) srcCells.push(k0 + a + b * NX); }
  let rover = null, fleet = [], start = START.slice(), hist = [], tracers = [];
  const wind = () => { const th = windDir + 0.3 * Math.sin(time / 11) + 0.15 * Math.sin(time / 3.7 + 1), u = windSpeed * (1 + 0.2 * Math.sin(time / 6.1)); return [u * Math.cos(th), u * Math.sin(th)]; };
  function step() {
    const [ux, uy] = wind(), D = 0.012 + 0.06 * windSpeed, kd = (D * DT) / (DX * DX), ka = DT / DX; // eddy mixing grows with wind (assumed)
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const k = j * NX + i; if (!open[k]) { c2[k] = 0; continue; }
      const v = c[k], fe = ux * gxX[k] + uy * gxY[k], fw = ux * gxX[k - 1] + uy * gxY[k - 1], fn = ux * gyX[k] + uy * gyY[k], fs = ux * gyX[k - NX] + uy * gyY[k - NX];
      const adv = (fe > 0 ? fe * v : fe * c[k + 1]) - (fw > 0 ? fw * c[k - 1] : fw * v) + (fn > 0 ? fn * v : fn * c[k + NX]) - (fs > 0 ? fs * c[k - NX] : fs * v);
      const dif = open[k + 1] * (c[k + 1] - v) + open[k - 1] * (c[k - 1] - v) + open[k + NX] * (c[k + NX] - v) + open[k - NX] * (c[k - NX] - v);
      c2[k] = v - ka * adv + kd * dif;
    }
    for (const k of srcCells) c2[k] += SRC * DT;
    c.set(c2); time += DT;
  }
  const sample = (p) => { const fx = clamp(p[0] / DX - 0.5, 0, NX - 1.001), fy = clamp(p[1] / DX - 0.5, 0, NY - 1.001), i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j, k = j * NX + i; return c[k] * (1 - a) * (1 - b) + c[k + 1] * a * (1 - b) + c[k + NX] * (1 - a) * b + c[k + NX + 1] * a * b; };
  const blocked = (p) => { if (p[0] < 0.4 || p[1] < 0.4 || p[0] > LX - 0.4 || p[1] > LY - 0.4) return true; for (const [a, b] of [[0, 0], [0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]]) if (!open[cell([p[0] + a, p[1] + b])]) return true; return false; };

  // ----- the rover: one sensor, a plane fitted to its recent readings, drive up the slope -----
  const make = (p) => ({ p: p.slice(), th: Math.PI, target: Math.PI, lag: sample(p), reading: 0, sm: 0, samples: [], trail: [p.slice()], odo: 0, t0: time, next: time, best: { v: -1, p: p.slice(), t: time }, mode: 'search', grad: null, done: null, cast: 1, leg: 0, legMax: 3, quiet: 0 });
  function release() { fleet = []; rover = make(start); hist = []; relBtn.textContent = 'Release again'; renderStats(); }
  function releaseFleet() { rover = null; hist = []; fleet = FLEET.filter((p) => !blocked(p)).map(make); renderStats(); }
  function roverStep(r, dt) {
    if (!r || r.done) return;
    if (time >= r.next) { // a reading twice a second
      r.next += 0.5; r.lag += (sample(r.p) - r.lag) * (1 - Math.exp(-0.5 / TAU)); r.reading = Math.max(0, r.lag + sigma * gauss(rng));
      r.samples.push({ p: r.p.slice(), v: r.reading }); if (r.samples.length > 18) r.samples.shift();
      const sm = (r.sm = r.samples.slice(-5).reduce((a, s) => a + s.v, 0) / Math.min(5, r.samples.length)), last = r.samples.slice(-12), slow = last.reduce((a, s) => a + s.v, 0) / last.length;
      if (r === rover) hist.push({ t: time - r.t0, v: r.reading, sm });
      if (sm > r.best.v) r.best = { v: sm, p: r.p.slice(), t: time };
      // least-squares plane through the recent readings: v = a + gx (x - mx) + gy (y - my)
      const S = r.samples, m = S.length; r.grad = null;
      if (m >= 8) {
        let mx = 0, my = 0, mv = 0; for (const s of S) { mx += s.p[0]; my += s.p[1]; mv += s.v; } mx /= m; my /= m; mv /= m;
        let sxx = 0, sxy = 0, syy = 0, sxv = 0, syv = 0; for (const s of S) { const x = s.p[0] - mx, y = s.p[1] - my, v = s.v - mv; sxx += x * x; sxy += x * y; syy += y * y; sxv += x * v; syv += y * v; }
        const det = sxx * syy - sxy * sxy;
        if (det > 1e-4) { const gx = (sxv * syy - syv * sxy) / det, gy = (syv * sxx - sxv * sxy) / det, spread = Math.sqrt((sxx + syy) / m), strength = (Math.hypot(gx, gy) * spread * Math.sqrt(m)) / sigma; if (strength > 2.5) r.grad = [gx, gy, strength]; }
      }
      const [ux, uy] = wind(), upwind = Math.atan2(-uy, -ux);
      r.quiet = last.length >= 6 && slow > 1.1 * sigma ? 0 : r.quiet + 0.5; // seconds since the 6-second mean last stood clear of the noise
      if (r.mode !== 'return') {
        if (r.grad && r.quiet < 4) { // in the plume with a slope: up the slope, leaning into the wind while the slope is faint
          const w = Math.min(4, r.grad[2] / 3), n = Math.hypot(r.grad[0], r.grad[1]) || 1; r.mode = 'climb'; r.target = Math.atan2((w * r.grad[1]) / n + Math.sin(upwind), (w * r.grad[0]) / n + Math.cos(upwind)); }
        else if (r.quiet < 4) { r.mode = 'hold'; r.target = upwind; }   // in the plume, no clear slope: into the wind
        else { if (r.mode !== 'search') { r.leg = 0; r.legMax = 1; r.cast = -r.cast; r.lost = true; } r.mode = 'search'; r.target = upwind; } // nothing: sweep across the wind (it carries a wind vane)
        if (r.best.v > 6 * sigma && time - r.best.t > 30) r.mode = 'return';
      }
      if (time - r.t0 > 480) r.done = { ok: false, took: 480 };
    }
    const v = 0.3, stepLen = v * dt; let moved = false, want;
    if (r.mode === 'search') { // casting: longer and longer legs across the wind, creeping upwind
      const lean = r.lost ? 1.52 : 1.3; want = r.target + r.cast * lean; r.leg += stepLen; // just lost it: stay put and widen the sweep
      const ahead = [r.p[0] + Math.cos(want) * 0.7, r.p[1] + Math.sin(want) * 0.7];
      if (r.leg > r.legMax || blocked(ahead)) { r.cast = -r.cast; r.leg = 0; r.legMax = Math.min(11, r.legMax + (r.lost ? 1.5 : 2)); want = r.target + r.cast * lean; }
    } else if (r.mode === 'return') { const d = dist(r.p, r.best.p); if (d < 0.25 || time - r.best.t > 90) { r.done = { ok: true, at: r.p.slice(), toMouth: dist(r.p, MOUTH), toPerson: dist(r.p, PERSON), took: time - r.t0 }; return; } want = Math.atan2(r.best.p[1] - r.p[1], r.best.p[0] - r.p[0]); }
    else want = r.target + 0.65 * Math.sin(((time - r.t0) * 6.2832) / 5); // weave, so the readings span two directions
    for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0, 2.7, -2.7]) { const th = want + off, q = [r.p[0] + Math.cos(th) * stepLen, r.p[1] + Math.sin(th) * stepLen]; if (!blocked(q)) { let d = th - r.th; d = Math.atan2(Math.sin(d), Math.cos(d)); r.th += clamp(d, -3 * dt, 3 * dt); r.p = q; r.odo += stepLen; moved = true; break; } }
    if (moved && dist(r.p, r.trail[r.trail.length - 1]) > 0.12) { r.trail.push(r.p.slice()); if (r.trail.length > 1500) r.trail.shift(); }
  }

  // ----- layout -----
  const map = surface('signals-canvas', () => draw());
  map.canvas.tabIndex = 0; map.canvas.setAttribute('role', 'application'); map.canvas.setAttribute('aria-label', 'Top view of a rubble field with a carbon dioxide plume leaking from a void, and a rover following it. Click to choose where the rover starts.');
  const dial = surface('signals-dial', () => drawDial()); dial.canvas.tabIndex = 0; dial.canvas.setAttribute('role', 'slider'); dial.canvas.setAttribute('aria-label', 'Wind direction'); dial.canvas.setAttribute('aria-valuemin', 0); dial.canvas.setAttribute('aria-valuemax', 359);
  const sWind = slider({ label: 'Wind speed', min: 0.03, max: 0.5, step: 0.01, value: windSpeed, format: (v) => v.toFixed(2) + ' m/s', onInput: (v) => { windSpeed = v; } });
  const sNoise = slider({ label: 'Sensor noise', min: 1, max: 30, step: 1, value: sigma, format: (v) => '±' + v + ' ppm', hint: 'Short-term noise of a low-cost CO2 sensor. Assumed.', onInput: (v) => { sigma = v; } });
  const spSeg = seg([{ id: '4', label: '4×' }, { id: '16', label: '16×' }, { id: '48', label: '48×' }], '16', (v) => { speed = +v; }, 'Simulation speed');
  const relBtn = h('button.btn.btn-primary', { type: 'button', onclick: () => release() }, 'Release the rover');
  const fleetBtn = h('button.btn.btn-sm', { type: 'button', title: 'Twelve rovers start from twelve places at once. How many end up at the crack is the score for this wind and this sensor.', onclick: () => releaseFleet() }, 'Try 12 rovers at once');
  const resetBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => { c.fill(0); time = 0; rover = null; fleet = []; hist = []; warm = 150; relBtn.textContent = 'Release the rover'; renderStats(); } }, 'Clear the air');
  const rail = h('section.panel.signals-rail', { 'aria-label': 'Breath plume' }, h('div.panel-body', null,
    intro(realityTag('concept'), 'A trapped person breathes out carbon dioxide, which builds up in the void and leaks through cracks. A rover with a cheap gas sensor might follow that leak upstream, the way a search dog follows a scent.'),
    h('div.signals-group', null, relBtn, h('div.signals-btnrow', null, fleetBtn, resetBtn), h('p.signals-hint', null, 'Click the map to choose where the rover starts. Then raise the wind or the sensor noise and see how it responds.')),
    h('div.signals-group', null, h('div.row', { style: { gap: '12px', alignItems: 'center' } }, dial.canvas, h('div.col.grow', null, h('span.muted', { style: { fontSize: '12px' } }, 'Wind direction: drag the dial'), sWind.el)), sNoise.el, h('div.row', null, h('span.grow.muted', { style: { fontSize: '12px' } }, 'Simulation speed'), spSeg.el)),
    h('div.note.warn', { style: { marginTop: 'auto' } }, h('span', null, h('b', null, 'A concept. '), 'Real plumes are torn into patches by turbulence, other sources add CO2, and low-cost sensors take tens of seconds to respond. Search dogs do this job today.')),
    h('p.signals-hint', null, 'Assumed: 0.25 L of CO2 a minute, a 1 m deep layer of air, smooth flow around the rubble, a sensor that settles in 3 s. In a steady breeze the whole plume is only a few parts per million, which is why the default here is nearly still air.')));
  const mapPanel = h('section.panel', { 'aria-label': 'Plume map' }, h('header.panel-head', null, h('h3', null, 'From above: exhaled CO2 leaking from a void and drifting downwind'), realityTag('sim')), h('div.signals-fill', null, map.canvas),
    h('div.signals-legend', null, h('span', null, h('i', { style: { background: 'var(--person)' } }), 'person in the void'), h('span', null, h('i', { style: { background: 'var(--accent)' } }), 'rover and its track'), h('span', null, h('i.sq', { style: { background: 'linear-gradient(90deg, var(--heat-1), var(--heat-3), var(--heat-5))', width: '46px' } }), 'CO2 above normal air, 1 to 3,000 ppm (log scale)'), h('span', null, h('i.ln', { style: { background: 'var(--text-3)' } }), 'air flow')));
  const trace = surface('signals-canvas', () => drawTrace());
  trace.canvas.setAttribute('role', 'img'); trace.canvas.setAttribute('aria-label', 'The rover’s CO2 reading over time');
  const tracePanel = h('section.panel', { 'aria-label': 'Sensor reading', style: { flex: '1 1 220px' } }, h('header.panel-head', null, h('h3', null, 'One noisy number is all it has'), realityTag('live-algo')), h('div.signals-fill', null, trace.canvas));
  const statLabels = ['reading above normal air', 'what it is doing', 'simulated time since release', 'distance driven'].map((t) => h('span', null, t));
  const stRead = h('b', null, '–'), stTime = h('b', null, '–'), stOdo = h('b', null, '–'), stMode = h('b', null, '–'), verdict = h('p.signals-verdict');
  const statPanel = h('section.panel', { 'aria-label': 'Rover' }, h('header.panel-head', null, h('h3', null, 'Rover')), h('div.panel-body', { style: { flex: 'none' } },
    h('div.signals-stats', null, h('div.stat', null, stRead, statLabels[0]), h('div.stat', null, stMode, statLabels[1]), h('div.stat', null, stTime, statLabels[2]), h('div.stat', null, stOdo, statLabels[3])),
    h('div', { style: { marginTop: '12px' } }, verdict)));
  root.append(rail, mapPanel, h('div.signals-col', null, statPanel, tracePanel));

  const MODE = { search: 'sweeping', climb: 'climbing', hold: 'holding course', return: 'going back' };
  function renderStats() {
    const r = rover;
    if (fleet.length) {
      const done = fleet.filter((q) => q.done), hit = done.filter((q) => q.done.ok && q.done.toMouth < 1.5).length, wrong = done.filter((q) => q.done.ok && q.done.toMouth >= 1.5).length, lost = done.length - hit - wrong, t = time - fleet[0].t0;
      stRead.replaceChildren(String(hit), h('small', null, 'of ' + fleet.length)); stMode.textContent = done.length < fleet.length ? 'running' : 'finished'; stTime.textContent = fmt.clock(Math.min(480, t)); stOdo.replaceChildren(String(wrong + lost), h('small', null, 'failed'));
      statLabels[0].textContent = 'set a flag within 1.5 m of the crack'; statLabels[3].textContent = wrong + ' flagged the wrong place, ' + lost + ' gave up';
      verdict.replaceChildren(done.length < fleet.length ? 'Twelve rovers, twelve starting points, the same wind and sensor. ' + (fleet.length - done.length) + ' still searching.' : h('span', null, h('b', null, hit + ' of ' + fleet.length + ' found the crack'), ' in wind of ' + windSpeed.toFixed(2) + ' m/s with ±' + sigma + ' ppm of sensor noise. Scored against the simulation’s truth; not a real-world result.'));
      return;
    }
    statLabels[0].textContent = 'reading above normal air'; statLabels[3].textContent = 'distance driven';
    if (!r) { stRead.textContent = '–'; stTime.textContent = '–'; stOdo.textContent = '–'; stMode.textContent = warm > 0 ? 'waiting' : 'parked'; verdict.textContent = warm > 0 ? 'The void is filling and the plume is forming…' : 'Press “Release the rover”.'; return; }
    stRead.replaceChildren(r.reading.toFixed(0), h('small', null, 'ppm')); stTime.textContent = fmt.clock((r.done?.took) ?? (time - r.t0)); stOdo.replaceChildren(r.odo.toFixed(1), h('small', null, 'm'));
    stMode.textContent = r.done ? (r.done.ok ? 'flag set' : 'gave up') : MODE[r.mode];
    if (r.done?.ok) verdict.replaceChildren(h('b', null, 'Flag set at its strongest reading, '), r.done.toMouth.toFixed(1) + ' m from the crack and ' + r.done.toPerson.toFixed(1) + ' m from the person (distances known only because this is a simulation). It marks where to dig or listen, not a person.');
    else if (r.done) verdict.replaceChildren(h('b', null, 'Lost. '), 'After 8 minutes it had not found a slope it could trust. With this wind and this much sensor noise the idea fails.');
    else verdict.textContent = r.mode === 'search' ? 'Nothing above the noise, so it sweeps across the wind in longer and longer legs, creeping upwind.' : r.mode === 'climb' ? 'Its last readings rise in one direction. It steers that way, weaving so the readings span two directions.' : r.mode === 'return' ? 'The reading stopped rising. It is going back to where it was strongest.' : 'The slope is too weak to trust against the noise. It keeps its heading.';
  }

  // ----- drawing -----
  const img = document.createElement('canvas'); img.width = NX; img.height = NY; const ictx = img.getContext('2d'), idata = ictx.createImageData(NX, NY);
  let tf = { s: 1, ox: 0, oy: 0 };
  const PX = (p) => [tf.ox + p[0] * tf.s, tf.oy + (LY - p[1]) * tf.s];
  const poly = (cx, pts) => { cx.beginPath(); pts.forEach((q, i) => { const [x, y] = PX(q); i ? cx.lineTo(x, y) : cx.moveTo(x, y); }); cx.closePath(); };
  const slabs = []; { const r = mulberry32(5); for (let i = 0; i < 46; i++) slabs.push([1.2 + r() * 6.4, 2.2 + OY + r() * 6.6, 0.5 + r() * 1.5, 0.2 + r() * 0.5, r() * 3.14, r()]); }
  function draw() {
    const { c: g, w, h: H } = map; if (!w) return; g.clearRect(0, 0, w, H);
    const s = Math.min((w - 12) / LX, (H - 12) / LY); tf = { s, ox: (w - LX * s) / 2, oy: (H - LY * s) / 2 };
    const px = idata.data, lut = C.lut;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const v = c[j * NX + i], u = v <= 1 ? 0 : clamp(Math.log10(v) / 3.48, 0, 1), q = Math.round(u * 255) * 4, o = ((NY - 1 - j) * NX + i) * 4; px[o] = lut[q]; px[o + 1] = lut[q + 1]; px[o + 2] = lut[q + 2]; px[o + 3] = 255; }
    ictx.putImageData(idata, 0, 0); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(img, tf.ox, tf.oy, LX * s, LY * s);
    // air flow tracers
    g.strokeStyle = rgba(C.text, 0.22); g.lineWidth = 1; g.beginPath(); for (const tr of tracers) { const a = PX(tr.q), b = PX(tr.p); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); } g.stroke();
    // rubble: the collapsed block with its void and crack, and loose debris
    g.save(); poly(g, BLOCK); g.clip(); g.fillStyle = C.bg3; g.fillRect(0, 0, w, H);
    for (const [x, y, len, wd, rot, k] of slabs) { const [a, b] = PX([x, y]); g.save(); g.translate(a, b); g.rotate(rot); g.fillStyle = rgba(C.text, 0.03 + k * 0.06); g.fillRect(-len * s / 2, -wd * s / 2, len * s, wd * s); g.strokeStyle = rgba(C.bg0, 0.6); g.strokeRect(-len * s / 2, -wd * s / 2, len * s, wd * s); g.restore(); }
    // inside the block, show the gas only where there is air: the void and the crack
    poly(g, VOID); g.save(); g.clip(); g.drawImage(img, tf.ox, tf.oy, LX * s, LY * s); g.restore(); poly(g, CRACK); g.save(); g.clip(); g.drawImage(img, tf.ox, tf.oy, LX * s, LY * s); g.restore();
    g.restore();
    poly(g, BLOCK); g.strokeStyle = C.line2; g.lineWidth = 1.5; g.stroke(); poly(g, VOID); g.strokeStyle = rgba(C.text, 0.35); g.lineWidth = 1; g.stroke();
    for (const d of DEBRIS) { poly(g, d); g.fillStyle = C.bg3; g.fill(); g.strokeStyle = C.line2; g.lineWidth = 1.5; g.stroke(); }
    // the person, lying in the void
    const [hx, hy] = PX([4.75, 5.6 + OY]), [bx, by] = PX([4.0, 5.6 + OY]); g.fillStyle = C.person; g.beginPath(); g.arc(hx, hy, 0.16 * s, 0, 6.2832); g.fill(); g.beginPath(); g.ellipse(bx, by, 0.52 * s, 0.2 * s, 0, 0, 6.2832); g.fill();
    lab(g, 'person in a void', PX([3.0, 7.25 + OY])[0], PX([3.0, 7.25 + OY])[1], C.person); lab(g, 'crack', PX([7.0, 4.35 + OY])[0], PX([7.0, 4.35 + OY])[1], C.text2); lab(g, 'collapsed slabs', PX([3.4, 3.2 + OY])[0], PX([3.4, 3.2 + OY])[1], C.text3);
    // start marker
    const [sx, sy] = PX(start); g.strokeStyle = rgba(C.accent, 0.8); g.setLineDash([3, 3]); g.lineWidth = 1.5; g.beginPath(); g.arc(sx, sy, 9, 0, 6.2832); g.stroke(); g.setLineDash([]); if (!rover && !fleet.length) lab(g, 'rover starts here', sx, sy - 20, C.accent);
    for (const q of fleet) { // the twelve: thin tracks, a tick where each one finished
      g.beginPath(); q.trail.forEach((p, i) => { const [x, y] = PX(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.strokeStyle = rgba(C.accent, 0.75); g.lineWidth = 1.2; g.lineJoin = 'round'; g.stroke();
      const [x, y] = PX(q.p), good = q.done?.ok && q.done.toMouth < 1.5; g.beginPath(); g.arc(x, y, 5, 0, 6.2832); g.fillStyle = q.done ? (good ? C.ok : C.bg3) : C.accent; g.fill(); g.strokeStyle = q.done && !good ? C.text2 : C.bg0; g.lineWidth = 1.5; g.stroke();
      const [x0, y0] = PX(q.trail[0]); g.beginPath(); g.arc(x0, y0, 3, 0, 6.2832); g.strokeStyle = rgba(C.accent, 0.8); g.lineWidth = 1; g.stroke();
    }
    // rover
    const r = rover;
    if (r) {
      g.beginPath(); r.trail.forEach((q, i) => { const [x, y] = PX(q); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.strokeStyle = C.accent; g.lineWidth = 1.8; g.lineJoin = 'round'; g.stroke();
      const [rx, ry] = PX(r.p);
      if (r.grad && !r.done) { const a = Math.atan2(r.grad[1], r.grad[0]), L = 34; g.strokeStyle = C.text; g.lineWidth = 1.5; g.beginPath(); g.moveTo(rx, ry); g.lineTo(rx + Math.cos(a) * L, ry - Math.sin(a) * L); g.stroke(); g.beginPath(); g.moveTo(rx + Math.cos(a) * L, ry - Math.sin(a) * L); g.lineTo(rx + Math.cos(a + 2.7) * -8 + Math.cos(a) * L, ry - Math.sin(a + 2.7) * -8 - Math.sin(a) * L); g.stroke(); }
      g.save(); g.translate(rx, ry); g.rotate(-r.th); g.fillStyle = C.accent; g.strokeStyle = C.bg0; g.lineWidth = 1.5; g.beginPath(); g.roundRect(-0.27 * s, -0.2 * s, 0.54 * s, 0.4 * s, 3); g.fill(); g.stroke(); g.fillStyle = C.bg0; g.fillRect(0.12 * s, -0.05 * s, 0.1 * s, 0.1 * s); g.restore();
      if (r.done?.ok) { const [fx, fy] = PX(r.done.at); g.strokeStyle = C.ok; g.lineWidth = 2; g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx, fy - 26); g.stroke(); g.fillStyle = C.ok; g.beginPath(); g.moveTo(fx, fy - 26); g.lineTo(fx + 14, fy - 21); g.lineTo(fx, fy - 16); g.fill(); lab(g, 'strongest reading: dig or listen here', fx + 8, fy - 40, C.ok); }
      else if (!r.done) lab(g, r.reading.toFixed(0) + ' ppm', rx, ry - 22, C.text);
    }
    // wind arrow and scale
    const [ux, uy] = wind(), wa = Math.atan2(uy, ux), ax = tf.ox + LX * s - 62, ay = tf.oy + 40; g.strokeStyle = C.text; g.lineWidth = 2; g.beginPath(); g.moveTo(ax - Math.cos(wa) * 18, ay + Math.sin(wa) * 18); g.lineTo(ax + Math.cos(wa) * 18, ay - Math.sin(wa) * 18); g.stroke();
    g.beginPath(); g.moveTo(ax + Math.cos(wa) * 18, ay - Math.sin(wa) * 18); g.lineTo(ax + Math.cos(wa + 2.6) * 9 + Math.cos(wa) * 18, ay - Math.sin(wa + 2.6) * 9 - Math.sin(wa) * 18); g.moveTo(ax + Math.cos(wa) * 18, ay - Math.sin(wa) * 18); g.lineTo(ax + Math.cos(wa - 2.6) * 9 + Math.cos(wa) * 18, ay - Math.sin(wa - 2.6) * 9 - Math.sin(wa) * 18); g.stroke();
    text(g, 'wind ' + Math.hypot(ux, uy).toFixed(2) + ' m/s', ax, ay + 38, { align: 'center', color: C.text2, mono: true });
    const sb = PX([LX - 3.4, 0.5]); g.fillStyle = C.text2; g.fillRect(sb[0], sb[1], 2 * s, 1.5); g.fillRect(sb[0], sb[1] - 3, 1.5, 6); g.fillRect(sb[0] + 2 * s - 1.5, sb[1] - 3, 1.5, 6); text(g, '2 m', sb[0] + s, sb[1] - 7, { align: 'center', color: C.text2, mono: true });
    text(g, fmt.clock(time) + ' simulated', tf.ox + 10, tf.oy + 18, { color: C.text2, mono: true });
    if (warm > 0) lab(g, 'The void is filling and the plume is forming…', tf.ox + LX * s / 2, tf.oy + 24, C.text);
  }
  function lab(g, str, x, y, color) { g.font = '500 11px ' + C.font; const tw = g.measureText(str).width; g.fillStyle = rgba(C.bg0, 0.78); g.beginPath(); g.roundRect(x - tw / 2 - 5, y - 9, tw + 10, 18, 4); g.fill(); text(g, str, x - tw / 2, y + 0.5, { base: 'middle', color, weight: 500 }); }
  function drawDial() {
    const { c: g, w } = dial; if (!w) return; g.clearRect(0, 0, w, w); const r = w / 2 - 6, cx = w / 2;
    g.beginPath(); g.arc(cx, cx, r, 0, 6.2832); g.fillStyle = C.bg1; g.fill(); g.strokeStyle = C.line2; g.lineWidth = 1; g.stroke();
    for (let k = 0; k < 16; k++) { const a = (k / 16) * 6.2832; g.strokeStyle = k % 4 ? C.line2 : C.text3; g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - (k % 4 ? 4 : 7)), cx + Math.sin(a) * (r - (k % 4 ? 4 : 7))); g.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r); g.stroke(); }
    text(g, 'N', cx, 17, { align: 'center', color: C.text3, size: 10 });
    const a = windDir, x1 = cx + Math.cos(a) * (r - 12), y1 = cx - Math.sin(a) * (r - 12), x0 = cx - Math.cos(a) * (r - 12), y0 = cx + Math.sin(a) * (r - 12);
    g.strokeStyle = C.accent; g.lineWidth = 2.5; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 + Math.cos(a + 2.6) * 10, y1 - Math.sin(a + 2.6) * 10); g.moveTo(x1, y1); g.lineTo(x1 + Math.cos(a - 2.6) * 10, y1 - Math.sin(a - 2.6) * 10); g.stroke(); g.lineCap = 'butt';
    dial.canvas.setAttribute('aria-valuenow', Math.round(((90 - (a * 180) / Math.PI) % 360 + 360) % 360)); dial.canvas.setAttribute('aria-valuetext', 'blowing towards ' + ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'][Math.round((((a % 6.2832) + 6.2832) % 6.2832) / 0.7854) % 8]);
  }
  function drawTrace() {
    const { c: g, w, h: H } = trace; if (!w) return; g.clearRect(0, 0, w, H);
    const pl = 44, pr = 12, pt = 12, pb = 32, pw = w - pl - pr, ph = H - pt - pb; g.fillStyle = C.bg1; g.fillRect(pl, pt, pw, ph);
    let vm = 4 * sigma + 2; for (const q of hist) if (q.v > vm) vm = q.v; const vmax = vm * 1.15, tmax = Math.max(60, hist.length ? hist[hist.length - 1].t : 0), X = (t) => pl + (t / tmax) * pw, Y = (v) => pt + ph - (clamp(v, 0, vmax) / vmax) * ph;
    const stepV = [5, 10, 20, 50, 100, 200, 500, 1000].find((q) => vmax / q <= 5) || 2000; let lastY = 1e9;
    for (let v = 0; v <= vmax; v += stepV) { const y = Y(v); lastY = y; g.fillStyle = rgba(C.text, 0.07); g.fillRect(pl, Math.round(y), pw, 1); text(g, String(v), pl - 6, y + 4, { align: 'right', color: C.text3, mono: true }); }
    g.fillStyle = rgba(C.text3, 0.2); g.fillRect(pl, Y(3 * sigma), pw, pt + ph - Y(3 * sigma)); text(g, 'inside the noise (3× ' + sigma + ' ppm)', pl + pw - 6, Y(3 * sigma) - 5, { align: 'right', color: C.text3 });
    if (hist.length > 1) {
      g.beginPath(); hist.forEach((q, i) => { const x = X(q.t), y = Y(q.v); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.strokeStyle = rgba(C.accent, 0.35); g.lineWidth = 1; g.stroke();
      g.beginPath(); hist.forEach((q, i) => { const x = X(q.t), y = Y(q.sm); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.strokeStyle = C.accent; g.lineWidth = 1.8; g.stroke();
      text(g, 'bold: mean of the last 5 readings', pl + 6, pt + 13, { color: C.accent });
    } else text(g, fleet.length ? 'Release one rover to see its readings.' : 'Readings appear here once it is released.', pl + pw / 2, pt + ph * 0.3, { align: 'center', color: C.text3 });
    for (let t = 0; t <= tmax; t += tmax > 240 ? 120 : 60) text(g, fmt.clock(t), X(t), pt + ph + 14, { align: t === 0 ? 'left' : X(t) > pl + pw - 20 ? 'right' : 'center', color: C.text3, mono: true });
    text(g, 'simulated time since release', pl + pw / 2, H - 6, { align: 'center', color: C.text3 });
    g.save(); g.translate(11, pt + ph / 2); g.rotate(-Math.PI / 2); text(g, 'ppm above normal air', 0, 0, { align: 'center', color: C.text3 }); g.restore();
  }

  // ----- motion -----
  let statT = 0, lastDraw = 0;
  function tick(ts) {
    raf = 0; const dt = Math.min(0.05, (ts - lastT) / 1000 || 0.016); lastT = ts;
    if (!ready) { build(); warm = 150; }
    let steps = Math.min(40, Math.round((dt * speed) / DT)); if (warm > 0) steps = 70;
    const all = fleet.length && fleet.some((q) => !q.done); if (all && warm <= 0) steps = Math.max(steps, 28); // the twelve run fast
    for (let i = 0; i < steps; i++) { step(); if (warm > 0) { warm -= DT; if (warm <= 0 && !rover && !fleet.length) release(); } else { roverStep(rover, DT); for (const q of fleet) roverStep(q, DT); } }
    if (!reducedMotion()) {
      while (tracers.length < 170) { const p = [rng() * LX, rng() * LY]; tracers.push({ p, q: p.slice(), age: rng() * 3 }); }
      const [ux, uy] = wind();
      for (const tr of tracers) { const k = cell(tr.p); tr.q = tr.p.slice(); const vx = ux * gxX[k] + uy * gxY[k], vy = ux * gyX[k] + uy * gyY[k]; tr.p = [tr.p[0] + vx * dt * 6, tr.p[1] + vy * dt * 6]; tr.age -= dt; if (tr.age < 0 || !open[cell(tr.p)] || tr.p[0] < 0 || tr.p[0] > LX || tr.p[1] < 0 || tr.p[1] > LY || pointInPoly(tr.p, BLOCK)) { tr.p = [rng() * LX, rng() * LY]; tr.q = tr.p.slice(); tr.age = 2 + rng() * 3; } }
    } else tracers.length = 0;
    if (!reducedMotion() || ts - lastDraw > 500) { lastDraw = ts; draw(); drawTrace(); } if (ts - statT > 250) { statT = ts; renderStats(); }
    if (shown) raf = requestAnimationFrame(tick);
  }
  const at = (e) => { const r = map.canvas.getBoundingClientRect(); return [(e.clientX - r.left - tf.ox) / tf.s, LY - (e.clientY - r.top - tf.oy) / tf.s]; };
  map.canvas.addEventListener('click', (e) => { const p = at(e); if (p[0] > 0 && p[0] < LX && p[1] > 0 && p[1] < LY && !blocked(p)) { start = p; rover = null; fleet = []; hist = []; relBtn.textContent = 'Release the rover'; renderStats(); } else ctx.shell.toast('The rover cannot start inside rubble. Pick open ground.', { level: 'warn' }); });
  map.canvas.addEventListener('pointermove', (e) => { const p = at(e); map.canvas.style.cursor = p[0] > 0 && p[0] < LX && p[1] > 0 && p[1] < LY && !blocked(p) ? 'crosshair' : 'not-allowed'; });
  map.canvas.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); release(); } });
  let dd = false; const setDial = (e) => { const r = dial.canvas.getBoundingClientRect(); windDir = Math.atan2(-(e.clientY - r.top - r.height / 2), e.clientX - r.left - r.width / 2); drawDial(); };
  dial.canvas.addEventListener('pointerdown', (e) => { dd = true; dial.canvas.setPointerCapture(e.pointerId); setDial(e); }); dial.canvas.addEventListener('pointermove', (e) => { if (dd) setDial(e); }); dial.canvas.addEventListener('pointerup', () => { dd = false; });
  dial.canvas.addEventListener('keydown', (e) => { const d = { ArrowLeft: 0.2, ArrowUp: 0.2, ArrowRight: -0.2, ArrowDown: -0.2 }[e.key]; if (d) { e.preventDefault(); windDir += d; drawDial(); } });

  renderStats();
  return {
    show() { shown = true; lastT = performance.now(); if (!raf) raf = requestAnimationFrame(tick); },
    hide() { shown = false; cancelAnimationFrame(raf); raf = 0; },
    repaint() { draw(); drawDial(); drawTrace(); },
    debug: () => ({ rover, fleet, releaseFleet, time, max: Math.max(...c), mouth: sample(MOUTH), at: (p) => sample(p), setWind: (d, s) => { windDir = d; windSpeed = s; }, setSpeed: (v) => { speed = v; } }),
  };
}
