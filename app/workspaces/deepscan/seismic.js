// Exhibit 5. Seismic tap location: a handful of geophones hear the same knock at slightly different times.
// Forward model: first arrivals bent through the true pile (eikonal), then scattering coda and site noise.
// Inverse: GCC-PHAT between every pair of sensors, then the point whose delays agree best (SRP-PHAT), then a
// covariance ellipse from the timing residuals.
import { WORLD, eikonal, sampleGrid } from './model.js';
import * as L from './lib.js';
import * as W from './waves.js';

const FS = 16000, N = 2048, PRE = 0.02;             // samples a second, samples, seconds of quiet before the tap
const FC = 600;                                    // hertz, the middle of the knock's band (assumed)
const SIG = 0.0006;                                 // seconds: a pair further off than this is distrusted
const CR = 0.2, CNX = 120, CNZ = 40;               // search cells, z from -3 m to +5 m
const LEVEL = { quiet: 0.02, work: 0.05, engine: 0.4 }; // noise against a tap heard at 1 m (assumed)

export default function create(env) {
  const { h } = env, ui = env.ui;
  const P = { n: 8, noise: 'work', taps: 12, speed: 'plan', t: 1, playing: false, pair: 0 };
  let pile, slow, T, tap, geo = [], sig = [], gcc = [], pairs = [], field = new Float32Array(CNX * CNZ), cv = null, M = {}, drag = null, vcal = 900, tab = [];

  function layout() { const a = pile.extent[0] + 1.6, b = pile.extent[1] - 1.6; geo = Array.from({ length: P.n }, (_, i) => ({ x: a + (b - a) * i / (P.n - 1) })); geo.forEach((g) => { g.z = pile.surfAt(g.x) - 0.05; }); }
  function setPile(p) { pile = p; slow = W.slowness(p); tap = W.tapPoint(p); layout(); rebuild(); P.t = 1; P.playing = false; }
  function rebuild() { // travel times, hammer calibration
    T = W.travel(slow, tap.x, tap.z);
    if (P.speed === 'one') { let sxx = 0, sxy = 0; // one hammer blow beside each sensor, heard by all the others: a straight-line speed fit
    for (const g of geo) { const t = W.travel(slow, g.x, g.z - 0.1); for (const q of geo) if (q !== g) { const d = Math.hypot(q.x - g.x, q.z - g.z); sxx += d * d; sxy += d * t[pile.cellAt(q.x, q.z - 0.1)]; } }
    vcal = sxx / sxy; }
    tables(); measure();
  }
  function measure() {
    const r = L.rng(pile.seed * 613 + 7), lev = LEVEL[P.noise] / Math.sqrt(P.taps);
    sig = geo.map((g, i) => {
      const t0 = PRE + T[pile.cellAt(g.x, g.z - 0.1)], d = Math.hypot(g.x - tap.x, g.z - tap.z), amp = Math.exp(-d / 9) / Math.sqrt(1 + d), y = new Float32Array(N), coda = [];
      const rc = L.rng(pile.seed * 97 + i * 31 + 1); for (let k = 0; k < 26; k++) coda.push([0.002 + 0.03 * rc() * rc(), rc.gauss() * 0.22]);
      let lp = 0; for (let k = 0; k < N; k++) { const t = k / FS; let v = amp * W.knock(t - t0, FC); for (const c of coda) v += amp * c[1] * Math.exp(-c[0] * 45) * W.knock(t - t0 - c[0], FC * 0.8); lp = lp * 0.55 + r.gauss() * 0.83; y[k] = v + lev * 0.4 * lp; }
      return { y, t0, amp, snr: amp * 0.6 / (lev * 0.4) };
    });
    solve();
  }
  // Predicted travel time from every point to every sensor. 'One speed' is distance over the hammer-blow average;
  // 'plan' bends the wave through the two things a rescuer knows: street level and the floor slab on the drawings.
  function tables() {
    const { nx, nz, res, x0, z0 } = WORLD;
    if (P.speed === 'one') { tab = geo.map((g) => { const t = new Float32Array(nx * nz); for (let q = 0; q < t.length; q++) { const i = q % nx; t[q] = Math.hypot(x0 + (i + 0.5) * res - g.x, z0 + ((q - i) / nx + 0.5) * res - g.z) / vcal; } return t; }); return; }
    const f = W.planField(pile);
    tab = geo.map((g) => eikonal(f, g.x, g.z - 0.1));
  }
  function solve() {
    pairs = []; gcc = []; const F = sig.map((s) => { const re = Float64Array.from({ length: 2 * N }, (_, k) => (k < N ? s.y[k] : 0)), im = new Float64Array(2 * N); L.fft(re, im); return [re, im]; });
    for (let a = 0; a < geo.length; a++) for (let b = a + 1; b < geo.length; b++) {
      const re = new Float64Array(2 * N), im = new Float64Array(2 * N), [ar, ai] = F[a], [br, bi] = F[b];
      for (let k = 0; k < 2 * N; k++) { const f = Math.min(k, 2 * N - k) * FS / (2 * N); if (f < 120 || f > 1500) continue; const cr = ar[k] * br[k] + ai[k] * bi[k], ci = ai[k] * br[k] - ar[k] * bi[k], m = Math.hypot(cr, ci) + 1e-9; re[k] = cr / m; im[k] = ci / m; } // keep the phase, drop the loudness
      L.fft(re, im, true); let mx = 1e-9; const g = new Float32Array(2 * N); for (let k = 0; k < 2 * N; k++) { g[k] = re[k]; mx = Math.max(mx, Math.abs(re[k])); } for (let k = 0; k < 2 * N; k++) g[k] /= mx;
      // a smooth envelope, so the search does not lock on to one cycle of the knock
      const env2 = new Float32Array(2 * N); for (let k = 0; k < 2 * N; k++) { let e = 0; for (let o = -4; o <= 4; o++) { const v = g[(k + o + 2 * N) % (2 * N)]; e = Math.max(e, Math.abs(v) * (1 - Math.abs(o) / 6)); } env2[k] = e; }
      let best = 0, bk = 0; for (let k = 0; k < 2 * N; k++) { const lag = k < N ? k : k - 2 * N; if (Math.abs(lag) / FS > 0.03) continue; if (g[k] > best) { best = g[k]; bk = lag; } }
      pairs.push([a, b, bk / FS, sig[a].t0 - sig[b].t0]); gcc.push({ raw: g, env: env2 });
    }
    let bs = -1, at = { x: 12, z: 0 }; const best = new Float32Array(CNX * CNZ);
    for (let k = 0; k < CNZ; k++) for (let i = 0; i < CNX; i++) {
      const x = (i + 0.5) * CR, z = WORLD.z0 + (k + 0.5) * CR; if (z > pile.surfAt(x) || z < -0.3 || x < pile.extent[0] || x > pile.extent[1]) continue;
      let s = 0; const tt = tab.map((t) => t[pile.cellAt(x, z)]);
      for (let n = 0; n < pairs.length; n++) { const lag = Math.round((tt[pairs[n][0]] - tt[pairs[n][1]]) * FS); s += gcc[n].env[(lag + 2 * N) % (2 * N)]; }
      s /= pairs.length; const q = k * CNX + i; best[q] = s; if (s > bs) { bs = s; at = { x, z }; }
    }
    // refine with the measured delays themselves, trusting each pair less the further it disagrees
    const cost = (x, z) => { const tt = tab.map((t) => sampleGrid(t, x, z)); let s = 0; for (const p of pairs) { const e = p[2] - tt[p[0]] + tt[p[1]]; s += Math.log(1 + (e / SIG) ** 2); } return s; };
    let x = at.x, z = at.z, c0 = Infinity; const peaks = [], taken = best.slice();
    for (let n = 0; n < 8; n++) { let bq = -1, bv = 0; for (let q = 0; q < taken.length; q++) if (taken[q] > bv) { bv = taken[q]; bq = q; } if (bq < 0) break; const bi = bq % CNX, bk = (bq - bi) / CNX; peaks.push([(bi + 0.5) * CR, WORLD.z0 + (bk + 0.5) * CR]); for (let k = 0; k < CNZ; k++) for (let i = 0; i < CNX; i++) if (Math.hypot(i - bi, k - bk) * CR < 1.4) taken[k * CNX + i] = 0; }
    for (const [px, pz] of peaks) { // several starts: a tap along one slab has look-alikes
      let ux = px, uz = pz, cu = cost(ux, uz);
      for (let st = 0.4; st > 0.02; st *= 0.6) for (let n = 0; n < 12; n++) { let moved = false; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) { const nx2 = ux + a * st, nz2 = uz + b * st; if (nz2 > pile.surfAt(nx2) - 0.1 || nz2 < -0.3) continue; const cc = cost(nx2, nz2); if (cc < cu - 1e-9) { cu = cc; ux = nx2; uz = nz2; moved = true; } } if (!moved) break; }
      if (cu < c0) { c0 = cu; x = ux; z = uz; }
    }
    const tt = tab.map((t) => sampleGrid(t, x, z)), ex = 0.15, jac = tab.map((t) => [(sampleGrid(t, x + ex, z) - sampleGrid(t, x - ex, z)) / (2 * ex), (sampleGrid(t, x, z + ex) - sampleGrid(t, x, z - ex)) / (2 * ex)]);
    let a11 = 1e-9, a12 = 0, a22 = 1e-9, sw = 0, se = 0; const rs = pairs.map((p) => { const e = p[2] - tt[p[0]] + tt[p[1]], w = 1 / (1 + (e / SIG) ** 2), jx = jac[p[0]][0] - jac[p[1]][0], jz = jac[p[0]][1] - jac[p[1]][1]; a11 += w * jx * jx; a12 += w * jx * jz; a22 += w * jz * jz; sw += w; se += w * e * e; return { e, w }; });
    const s2 = se / Math.max(1, sw) * (geo.length / 2), det = Math.max(1e-30, a11 * a22 - a12 * a12), H = [a22 / det, -a12 / det, a11 / det], v = vcal;
    let mx = 0, mn = 1; for (const q of best) if (q > 0) { mx = Math.max(mx, q); mn = Math.min(mn, q); } for (let q = 0; q < field.length; q++) field[q] = best[q] > 0 ? Math.pow((best[q] - mn) / (mx - mn || 1), 4) : 0;
    cv = L.gridImage(cv, field, CNX, CNZ, 'scan', 0.15, 1);
    M = { x, z, v, score: bs, cov: [H[0] * s2, H[1] * s2, H[2] * s2], sig: Math.sqrt(s2), err: Math.hypot(x - tap.x, z - tap.z), good: rs.filter((r) => Math.abs(r.e) < 0.001).length, dt: Math.sqrt(pairs.reduce((a, p) => a + (p[2] - p[3]) ** 2, 0) / pairs.length) };
    M.ok = M.err < 1.5 && M.score > 0.42;
  }
  function controls() {
    const go = ui.button({ label: 'Tap', ico: 'play', primary: true, title: 'Send one knock through the pile and watch it reach each sensor', onclick: () => { P.t = 0; P.playing = true; } });
    const n = ui.seg({ label: 'Sensors on the surface', value: P.n, options: [4, 6, 8].map((v) => ({ v, l: String(v) })), onchange: (v) => { P.n = v; P.pair = 0; layout(); rebuild(); env.refresh(); } });
    const noise = ui.seg({ label: 'Site noise', value: P.noise, options: [{ v: 'quiet', l: 'All quiet' }, { v: 'work', l: 'Hand work' }, { v: 'engine', l: 'Engines on' }], hint: 'This is why rescue teams call for silence before they listen.', onchange: (v) => { P.noise = v; measure(); env.refresh(); } });
    const taps = ui.slider({ label: 'Knocks added together', min: 1, max: 30, value: P.taps, fmt: (v) => String(v), oninput: (v) => { P.taps = v; measure(); env.refresh(); } });
    const sp = ui.seg({ label: 'What the solver assumes about speed', value: P.speed, options: [{ v: 'one', l: 'One average speed' }, { v: 'plan', l: 'Known floor slab' }], hint: 'A tap races through concrete four times faster than through rubble. With the building’s drawings, the solver can allow for the floor slab.', onchange: (v) => { P.speed = v; rebuild(); env.refresh(); } });
    return h('div.ds-controls', null, h('div.ds-row', null, go), n, noise, taps, sp, h('p.ds-hint', null, 'Drag a sensor along the surface, or drag the tap to another place.'));
  }
  const TMAX = 0.036;
  function tick(dt) { if (!P.playing) return false; if (env.reduced()) { P.t = 1; P.playing = false; env.refresh(); return false; } P.t = Math.min(1, P.t + dt / 4.2); if (P.t >= 1) { P.playing = false; env.refresh(); } return true; }
  function drawStage(S) {
    const { c } = S, now = P.t * TMAX, done = P.t >= 1;
    if (done) W.drawField(S, cv, field, CR, CNX, CNZ, S.truth ? 0.6 : 0.9); else W.drawFront(S, T, now);
    geo.forEach((g, i) => { const x = S.X(g.x), y = S.Z(g.z), heard = now > sig[i].t0 - PRE; c.save(); if (done && !S.thumb) { c.strokeStyle = L.col('--accent', 0.28); c.lineWidth = 1; c.setLineDash([2, 4]); c.beginPath(); c.moveTo(x, y); c.lineTo(S.X(M.x), S.Z(M.z)); c.stroke(); c.setLineDash([]); }
      c.fillStyle = L.tok(heard ? '--accent' : '--text-3'); c.beginPath(); c.moveTo(x - 6, y - 12); c.lineTo(x + 6, y - 12); c.lineTo(x, y); c.closePath(); c.fill(); c.restore();
      if (!S.thumb) { c.font = L.font(11, 600); c.fillStyle = L.tok('--text-2'); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText('S' + (i + 1), x, y - 15); } });
    if (S.truth) W.cross(S, tap.x, tap.z, '--person', done ? null : 'tap', { dx: 12, dy: 24 });
    if (done) { W.ellipse(S, M.x, M.z, M.cov, 2, '--accent'); W.cross(S, M.x, M.z, '--accent', 'solved: ' + M.err.toFixed(1) + ' m from the tap', { dx: 20, dy: 34 }); }
  }
  function drawReadout(R) {
    const { c, w, h: hh } = R, n = geo.length, l = 34, tr = Math.round(w * 0.62) - l, top = 16, bot = hh - 34, rowH = (bot - top) / n, t0 = 0.012, t1 = PRE + TMAX + 0.012, X = (t) => l + (t - t0) / (t1 - t0) * tr, now = PRE + P.t * (t1 - PRE);
    c.save(); c.font = L.font(11); c.lineWidth = 1;
    for (let ms = 0; ms <= 40; ms += 10) { const x = Math.round(X(PRE + ms / 1000)) + 0.5; c.strokeStyle = L.col('--line', 1); c.beginPath(); c.moveTo(x, top); c.lineTo(x, bot); c.stroke(); c.fillStyle = L.tok('--text-3'); c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(ms + (ms ? '' : ' ms'), x, bot + 4); }
    c.textAlign = 'center'; c.fillText('time after the tap', l + tr / 2, bot + 18);
    sig.forEach((s, i) => { const y0 = top + (i + 0.5) * rowH; let mx = 0; for (const v of s.y) mx = Math.max(mx, Math.abs(v)); const k0 = Math.floor(t0 * FS), k1 = Math.min(N, Math.ceil(Math.min(now, t1) * FS));
      c.strokeStyle = L.col('--text-2', 0.95); c.lineWidth = 1; c.beginPath(); for (let k = k0; k < k1; k++) { const x = X(k / FS), y = y0 - s.y[k] / mx * rowH * 0.44; if (k > k0) c.lineTo(x, y); else c.moveTo(x, y); } c.stroke();
      c.fillStyle = L.tok('--text-2'); c.font = L.font(11, 600); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('S' + (i + 1), 8, y0);
      if (R.truth && now > s.t0) { const x = X(s.t0); c.strokeStyle = L.tok('--person'); c.beginPath(); c.moveTo(x, y0 - rowH * 0.42); c.lineTo(x, y0 + rowH * 0.42); c.stroke(); } });
    // one pair's cross-correlation, the pair closest to the solved point's two nearest sensors
    const l2 = l + tr + 54, w2 = w - l2 - 16; c.restore(); if (w2 < 120) return;
    const half = Math.round(0.025 * FS), ax = L.plot(c, { l: l2, t: 34, w: w2, h: bot - 34 }, { x: [-25, 25], y: [-1, 1], xl: 'delay between the two sensors, ms', yTicks: [-1, 0, 1], xt: 5 });
    const g = gcc[P.pair], p = pairs[P.pair]; c.save(); c.strokeStyle = L.col('--accent', 0.95); c.lineWidth = 1.25; c.beginPath(); for (let k = -half; k <= half; k++) { const x = ax.X(k / FS * 1000), y = ax.Y(g.raw[(k + 2 * N) % (2 * N)]); if (k > -half) c.lineTo(x, y); else c.moveTo(x, y); } c.stroke();
    const mark = (ms, colr) => { c.strokeStyle = L.tok(colr); c.setLineDash([3, 3]); c.beginPath(); c.moveTo(ax.X(ms), 35); c.lineTo(ax.X(ms), bot - 1); c.stroke(); c.setLineDash([]); };
    mark(p[2] * 1000, '--accent'); if (R.truth) mark(p[3] * 1000, '--person');
    c.font = L.font(11, 600); c.fillStyle = L.tok('--text'); c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText('S' + (p[0] + 1) + ' against S' + (p[1] + 1) + ': measured ' + (p[2] * 1000).toFixed(1) + ' ms' + (R.truth ? ', true ' + (p[3] * 1000).toFixed(1) : ''), l2, 26); c.restore();
  }
  function pointer(kind, p) {
    if (kind === 'down' || kind === 'hover') { const hit = geo.findIndex((g) => Math.hypot(p.S.X(g.x) - p.S.X(p.x), p.S.Z(g.z) - p.S.Z(p.z) - 6) < 13), onTap = Math.hypot(tap.x - p.x, tap.z - p.z) * p.S.s < 14; if (kind === 'hover') return hit >= 0 || onTap; drag = hit >= 0 ? hit : onTap ? 'tap' : null; return drag !== null; }
    if (kind === 'move' && drag !== null && p.x !== undefined) { if (drag === 'tap') { const x = L.clamp(p.x, pile.extent[0] + 1, pile.extent[1] - 1); tap = { x, z: L.clamp(p.z, -0.15, pile.surfAt(x) - 0.4) }; T = W.travel(slow, tap.x, tap.z); measure(); } else { const g = geo[drag]; g.x = L.clamp(p.x, pile.extent[0] + 0.6, pile.extent[1] - 0.6); g.z = pile.surfAt(g.x) - 0.05; measure(); } P.t = 1; }
    if (kind === 'up') { if (drag !== null && drag !== 'tap') rebuild(); drag = null; }
    return true;
  }
  function verdicts() {
    const out = {}, inV = pile.voids.find((v) => pile.inPoly(v.poly, tap.x, tap.z + 0.3));
    for (const v of pile.voids) out[v.id] = { state: 'na', text: v === inV ? 'only by its sound' : 'silent', why: 'This method hears people, not spaces. An empty void makes no sound.' };
    out.person = M.ok ? { state: 'seen', text: M.err.toFixed(1) + ' m off', why: 'Distance from the solved point to the true tap.' } : { state: M.err < 3 ? 'hint' : 'missed', text: M.err < 3 ? M.err.toFixed(1) + ' m off' : 'wrong place', why: 'The solved point is too far from the true tap, or the sensors do not agree.' };
    return out;
  }
  return {
    title: 'Seismic tap location', hardware: 'Rescue teams already carry listening sets. Solving for a position in the rubble is the concept part.',
    lede: 'A knock on a slab travels through the rubble and reaches each sensor a few thousandths of a second apart. Lining the recordings up two at a time gives the delays, and only one place in the pile fits all of them.',
    honest: 'someone has to be awake and knocking, the site has to go quiet, and the solver has to know how fast the pile carries sound. Switch to one average speed to see how much that costs. With six sensors and five knocks, three of the six piles we tried were misplaced by more than 4 m. The search stays above the floor slab, so a tap from the cellar would be misplaced. Surface waves, sensor coupling and people walking on the pile are not modelled.',
    assumed: 'Assumed: wave speed 900 m/s in loose rubble, 3,800 in slab, 500 in soil; a 600 Hz knock; scattering coda of about 30 ms; noise levels. First arrivals bend through the true pile.',
    sources: [
      { who: 'Delsar Life Detector, Firehouse product page.', what: 'A fielded set: sensors that turn the collapsed structure “into a large sensitive microphone”; used by FEMA and UKSAR teams.', url: 'https://www.firehouse.com/rescue/technical-rescue/structural-collapse/product/10181928/con-space-communications-delsar-life-detector' },
      { who: 'Knapp and Carter, IEEE Trans. ASSP 24 (1976).', what: 'The generalised correlation method, the source of the PHAT weighting used here.', url: 'https://doi.org/10.1109/TASSP.1976.1162830' },
    ],
    setPile, controls, drawStage, drawReadout, tick, verdicts, pointer,
    _demo: () => ({ tables, solve, T, tap, geo, sig, pairs, field, M, P, CR, CNX, CNZ, PRE }),
    stageTitle: () => (P.t < 1 ? 'A knock crossing the pile' : 'Where the delays agree'), stageNote: () => (P.t < 1 ? (P.t * TMAX * 1000).toFixed(0) + ' ms after the tap, slowed about 120 times' : 'solved ' + M.err.toFixed(1) + ' m from the true tap'),
    readoutTitle: () => ['The same knock arrives a few milliseconds apart', 'Left: each sensor’s recording; orange marks the true arrival. Right: one pair lined up by phase (GCC-PHAT).'],
    results: () => [
      { k: 'Position error', v: M.err.toFixed(2) + ' m', sub: 'solved point to true tap', tone: M.err < 1 ? 'ok' : M.err < 2 ? 'warn' : 'bad' },
      { k: 'Ellipse (2σ)', v: '±' + (2 * Math.sqrt(Math.max(M.cov[0], M.cov[2]))).toFixed(1) + ' m', sub: 'from the timing residuals alone' },
      { k: 'Speed model', v: P.speed === 'plan' ? 'floor slab' : M.v.toFixed(0) + ' m/s', sub: P.speed === 'plan' ? 'rubble 900 m/s, slab 3,800 (assumed)' : 'one average, from hammer blows' },
      { k: 'Delay error', v: (M.dt * 1000).toFixed(1) + ' ms', sub: 'RMS over ' + pairs.length + ' pairs' },
    ],
    row: { sees: 'A person who knocks. Not a silent person, not an empty void.', range: 'Metres to tens of metres, less with engines running', time: 'Minutes, after a call for silence', cost: 'Medium', costNote: 'commercial listening sets', ready: 5, readyNote: 'Listening sets are fielded. Automatic positioning is not part of the product cited.' },
    summary: () => (M.ok ? 'the tap, ' + M.err.toFixed(1) + ' m off' : 'the tap is misplaced by ' + M.err.toFixed(1) + ' m'),
  };
}
