// Exhibit 2. Gravity gradiometry: a void is missing mass, and missing mass bends gravity very slightly.
// Forward model: the vertical gravity gradient over the true density model, as an atom-interferometer gradiometer
// measures it (two clouds 1 m apart). Inverse: depth-weighted, bounded least squares for the missing density.
import { WORLD, MAT, RHO_REF } from './model.js';
import * as L from './lib.js';

const G = 6.674e-11, LY = 2;                 // half-length of everything along the unseen axis, m (assumed)
const CR = 0.4, CNX = 62, CNZ = 27;          // inversion cells
const SENS = 466;                            // E per root-hertz: Stray et al. 2022, measured outdoors
// downward pull (m/s2) at (x, z) from a rod of lam kg/m at (cx, cz), half-length LY, seen from its mid-plane
function gzRod(x, z, cx, cz, lam) { const dx = cx - x, dz = z - cz, r2 = dx * dx + dz * dz + 1e-3, r = Math.sqrt(r2); return G * lam * 2 * LY / (r * Math.sqrt(r2 + LY * LY)) * (dz / r); }

export default function create(env) {
  const { h } = env, ui = env.ui;
  const P = { sigma: 20, sp: 0.5, draw: 1, sweep: 1, sweeping: false };
  let pile, st = [], sig, parts, clutter, noise, data, K, W, active, cells, m = new Float32Array(CNX * CNZ), truthC, fit, img = null, M = {};

  function survey() {
    const { nx, nz, res, x0, z0 } = WORLD;
    st = []; for (let x = pile.extent[0] - 1.5; x <= pile.extent[1] + 1.5 + 1e-6; x += P.sp) st.push({ x, z: pile.surfAt(x) + 0.5 });
    const n = st.length; sig = new Float32Array(n); clutter = new Float32Array(n); parts = pile.voids.map(() => new Float32Array(n));
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const q = k * nx + i, mt = pile.mat[q]; if (mt === MAT.SKY) continue;
      const z = z0 + (k + 0.5) * res, x = x0 + (i + 0.5) * res, ref = z < 0 ? 1.8 : RHO_REF, dr = pile.rho[q] - ref; if (Math.abs(dr) < 1e-3) continue;
      const vi = mt === MAT.VOID || mt === MAT.PERSON ? (pile.voidId[q] || 1) : 0, lam = dr * 10, lamV = (pile.rho[q] - 1.7) * 10;
      for (let s = 0; s < n; s++) { const a = st[s], e = (gzRod(a.x, a.z, x, z, 1) - gzRod(a.x, a.z + 1, x, z, 1)) * 1e9; sig[s] += e * lam; if (vi) { parts[vi - 1][s] += e * lamV; clutter[s] += e * (1.7 - ref) * 10; } else clutter[s] += e * lam; }
    }
    // the inversion's own view of the physics: coarse cells, each a block of missing density
    active = new Uint8Array(CNX * CNZ); cells = []; truthC = new Float32Array(CNX * CNZ);
    for (let k = 0; k < CNZ; k++) for (let i = 0; i < CNX; i++) { const x = x0 + (i + 0.5) * CR, z = z0 + (k + 0.5) * CR, q = k * CNX + i; if (z < pile.surfAt(x) - 0.1 && z > -2.7 && x > pile.extent[0] && x < pile.extent[1]) { active[q] = 1; cells.push(q); }
      let s = 0; for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) { const c = pile.cellAt(x + (a - 1.5) * 0.1, z + (b - 1.5) * 0.1), zz = z + (b - 1.5) * 0.1; s += pile.mat[c] === MAT.SKY ? 0 : (zz < 0 ? 1.8 : RHO_REF) - pile.rho[c]; } truthC[q] = s / 16; }
    K = new Float32Array(n * cells.length); W = new Float32Array(cells.length);
    cells.forEach((q, j) => { const i = q % CNX, k = (q - i) / CNX, x = x0 + (i + 0.5) * CR, z = z0 + (k + 0.5) * CR; W[j] = Math.pow(Math.max(0.4, pile.surfAt(x) + 0.5 - z), 0.9);
      for (let s = 0; s < n; s++) { let e = 0; for (const ox of [-0.1, 0.1]) for (const oz of [-0.1, 0.1]) e += gzRod(st[s].x, st[s].z, x + ox, z + oz, -40) - gzRod(st[s].x, st[s].z + 1, x + ox, z + oz, -40); K[s * cells.length + j] = e * 1e9; } });
    M.clutter = Math.sqrt(clutter.reduce((a, v) => a + v * v, 0) / n);
    measure();
  }
  function measure() {
    const r = L.rng(pile.seed * 977 + P.draw * 31 + Math.round(P.sp * 10)), n = st.length;
    noise = new Float32Array(n); for (let s = 0; s < n; s++) noise[s] = r.gauss();
    invert();
  }
  function invert() {
    const n = st.length, nc = cells.length, nUse = Math.max(2, Math.round(P.sweep * n));
    data = new Float32Array(n); for (let s = 0; s < n; s++) data[s] = sig[s] + noise[s] * P.sigma;
    // A = K W ; minimise |A u - d|^2 + alpha |u|^2 with m = W u kept inside physical bounds (projected, accelerated gradient)
    const A = (u, out) => { for (let s = 0; s < nUse; s++) { let a = 0; const o = s * nc; for (let j = 0; j < nc; j++) a += K[o + j] * W[j] * u[j]; out[s] = a; } };
    let v = new Float32Array(nc).fill(1), tmp = new Float32Array(n), lam = 1;
    for (let it = 0; it < 10; it++) { A(v, tmp); const w = new Float32Array(nc); for (let s = 0; s < nUse; s++) { const o = s * nc, t = tmp[s]; for (let j = 0; j < nc; j++) w[j] += K[o + j] * W[j] * t; } lam = Math.sqrt(w.reduce((a, x) => a + x * x, 0)); for (let j = 0; j < nc; j++) v[j] = w[j] / lam; }
    const alpha = lam * (0.0015 + Math.pow(P.sigma / 260, 2)), tau = 1 / (lam + alpha);
    let u = new Float32Array(nc), y = new Float32Array(nc), tk = 1; const g = new Float32Array(nc);
    for (let it = 0; it < 260; it++) {
      A(y, tmp); g.fill(0);
      for (let s = 0; s < nUse; s++) { const o = s * nc, r = tmp[s] - data[s]; for (let j = 0; j < nc; j++) g[j] += K[o + j] * W[j] * r; }
      const un = new Float32Array(nc); for (let j = 0; j < nc; j++) un[j] = L.clamp((y[j] - tau * (g[j] + alpha * y[j])) * W[j], -0.6, 1.8) / W[j];
      const tn = (1 + Math.sqrt(1 + 4 * tk * tk)) / 2, b = (tk - 1) / tn; for (let j = 0; j < nc; j++) y[j] = un[j] + b * (un[j] - u[j]); u = un; tk = tn;
    }
    m.fill(0); cells.forEach((q, j) => { m[q] = u[j] * W[j]; });
    fit = new Float32Array(n); for (let s = 0; s < n; s++) { let a = 0; const o = s * nc; for (let j = 0; j < nc; j++) a += K[o + j] * m[cells[j]]; fit[s] = a; }
    let se = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, res = 0;
    for (const q of cells) { const a = m[q], b = truthC[q]; se += (a - b) ** 2; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; }
    for (let s = 0; s < nUse; s++) res += (fit[s] - data[s]) ** 2;
    M.rms = Math.sqrt(se / nc); M.corr = (sab - sa * sb / nc) / Math.sqrt(Math.max(1e-9, (saa - sa * sa / nc) * (sbb - sb * sb / nc))); M.misfit = Math.sqrt(res / nUse);
    img = L.gridImage(img, m, CNX, CNZ, 'scan', 0.06, 1.1, { mask: active });
  }
  const perStation = () => (SENS / P.sigma) ** 2;                    // seconds of averaging to reach this noise
  const surveyHours = () => st.length * (perStation() + 120) / 3600; // plus two minutes to move and level (assumed)

  const toS = (v) => 2 * Math.pow(100, v / 1000), toV = (s) => Math.log(s / 2) / Math.log(100) * 1000;
  function controls() {
    const sl = ui.slider({ label: 'Sensor noise at each station', min: 0, max: 1000, value: toV(P.sigma), fmt: (v) => toS(v).toFixed(toS(v) < 10 ? 1 : 0) + ' E', marks: [{ v: toV(20), l: '20 E: Birmingham 2022', t: 'Stray et al. reached 20 E in ten minutes at one spot' }],
      hint: 'One eötvös (E) is a change in gravity of a ten-billionth of g per metre. Less noise means waiting longer at every station.', oninput: (v) => { P.sigma = toS(v); invert(); env.refresh(); } });
    const sp = ui.seg({ label: 'Distance between stations', value: P.sp, options: [{ v: 0.5, l: '0.5 m' }, { v: 1, l: '1 m' }, { v: 2, l: '2 m' }], onchange: (v) => { P.sp = v; survey(); env.refresh(); } });
    const go = ui.button({ label: 'Walk the survey', ico: 'play', primary: true, title: 'Carry the gradiometer across the pile, one station at a time, and watch the picture form', onclick: () => { P.draw++; P.sweep = 0; P.sweeping = true; measure(); } });
    return h('div.ds-controls', null, sl, sp, h('div.ds-row', null, go));
  }
  function tick(dt) {
    if (!P.sweeping) return false;
    P.sweep = env.reduced() ? 1 : Math.min(1, P.sweep + dt / 4.5); if (P.sweep >= 1) P.sweeping = false;
    invert(); env.refresh(); return true;
  }
  function drawStage(S) {
    const { c } = S;
    if (img) { c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.globalAlpha = S.truth ? 0.82 : 0.95; c.drawImage(img, S.X(WORLD.x0), S.Z(WORLD.z0 + CNZ * CR), CNX * CR * S.s, CNZ * CR * S.s); c.restore(); }
    const nUse = Math.max(1, Math.round(P.sweep * st.length));
    c.save();
    st.forEach((a, s) => { const x = S.X(a.x), y = S.Z(a.z - 0.5); c.fillStyle = s < nUse ? L.tok('--accent') : L.col('--text-3', 0.6); c.fillRect(Math.round(x) - 1, y - (S.thumb ? 3 : 5), 2, S.thumb ? 3 : 5); });
    if (!S.thumb) { // the instrument: two clouds of cold atoms in free fall, one metre apart
      const a = st[Math.min(st.length - 1, nUse - 1)], x = S.X(a.x), y0 = S.Z(a.z - 0.5), yl = S.Z(a.z), yu = S.Z(a.z + 1), top = S.Z(a.z + 1.35);
      c.strokeStyle = L.col('--text-2', 0.9); c.lineWidth = 1; c.strokeRect(x - 5.5, top + 0.5, 11, y0 - top - 3);
      c.strokeStyle = L.col('--danger', 0.55); c.beginPath(); c.moveTo(x + 0.5, top + 3); c.lineTo(x + 0.5, y0 - 5); c.stroke();
      for (const yy of [yl, yu]) { const g = c.createRadialGradient(x, yy, 0, x, yy, 9); g.addColorStop(0, 'rgba(240,248,255,0.95)'); g.addColorStop(0.35, L.col('--accent', 0.7)); g.addColorStop(1, L.col('--accent', 0)); c.fillStyle = g; c.beginPath(); c.arc(x, yy, 9, 0, 6.283); c.fill(); }
      L.tagLabel(c, x + 6, yu, 'two atom clouds, 1 m apart', { dx: 16, dy: -16, color: '--text-2', align: a.x > 16 ? 'right' : 'left' });
    }
    c.restore();
  }
  function drawReadout(R) {
    const { c, w, h: hh } = R, X = R.SX, t = 14, b = hh - 30, n = st.length, nUse = Math.max(1, Math.round(P.sweep * n));
    let lo = -3 * P.sigma, hi = 3 * P.sigma; for (let s = 0; s < n; s++) { lo = Math.min(lo, data[s] - P.sigma, sig[s]); hi = Math.max(hi, data[s] + P.sigma, sig[s]); } const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const Y = (v) => t + (hi - v) / (hi - lo) * (b - t), l = Math.max(0, X(st[0].x) - 14), r = Math.min(w, X(st[n - 1].x) + 14);
    c.save(); c.font = L.font(11); c.lineWidth = 1;
    for (const v of L.ticks(lo, hi, 5)) { const y = Math.round(Y(v)) + 0.5; c.strokeStyle = L.col('--line', 1); c.beginPath(); c.moveTo(l, y); c.lineTo(r, y); c.stroke(); c.fillStyle = L.tok('--text-3'); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText((v > 0 ? '+' : '') + v + (v === 0 ? ' E' : ''), l - 6, y); }
    for (let xm = 2; xm <= 22; xm += 2) { const x = Math.round(X(xm)) + 0.5; c.strokeStyle = L.tok('--line-2'); c.beginPath(); c.moveTo(x, b); c.lineTo(x, b + 4); c.stroke(); c.fillStyle = L.tok('--text-3'); c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(xm + ' m', x, b + 6); }
    c.strokeStyle = L.tok('--line-2'); c.strokeRect(Math.round(l) + 0.5, t + 0.5, Math.round(r - l), b - t);
    // the band noise alone can fill
    c.fillStyle = L.col('--text', 0.045); c.fillRect(l + 1, Y(3 * P.sigma), r - l - 2, Y(-3 * P.sigma) - Y(3 * P.sigma));
    c.fillStyle = L.tok('--text-3'); c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText('inside this band, noise alone could do it (±3σ)', r - 8, Y(-3 * P.sigma) - 3);
    const line = (arr, style, width, dash) => { c.beginPath(); for (let s = 0; s < n; s++) { const x = X(st[s].x), y = Y(arr[s]); if (s) c.lineTo(x, y); else c.moveTo(x, y); } c.strokeStyle = style; c.lineWidth = width; c.setLineDash(dash || []); c.stroke(); c.setLineDash([]); };
    if (R.truth) { pile.voids.forEach((v, vi) => { line(parts[vi], L.col('--text-2', 0.55), 1, [3, 3]); let k = 0; for (let s = 1; s < n; s++) if (parts[vi][s] < parts[vi][k]) k = s; c.fillStyle = L.tok('--text-2'); c.font = L.font(11, 600); c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(v.id, X(st[k].x), Y(parts[vi][k]) + 4); });
      line(sig, L.col('--text', 0.75), 1.25); }
    c.beginPath(); for (let s = 0; s < nUse; s++) { const x = X(st[s].x), y = Y(fit[s]); if (s) c.lineTo(x, y); else c.moveTo(x, y); } c.strokeStyle = L.tok('--accent'); c.lineWidth = 1.75; c.stroke();
    for (let s = 0; s < nUse; s++) { const x = X(st[s].x), y = Y(data[s]); c.strokeStyle = L.col('--text-2', 0.6); c.lineWidth = 1; c.beginPath(); c.moveTo(x, Y(data[s] - P.sigma)); c.lineTo(x, Y(data[s] + P.sigma)); c.stroke(); c.fillStyle = L.tok('--text'); c.beginPath(); c.arc(x, y, 2.2, 0, 6.283); c.fill(); }
    // direct labels
    c.font = L.font(11); c.textAlign = 'left'; c.textBaseline = 'top'; let lx = l + 10;
    for (const [name, colr, show] of [['measured, ±1σ', '--text', true], ['what the rebuilt picture predicts', '--accent', true], ['true signal, no noise', '--text-2', R.truth], ['each void alone (dashed)', '--text-3', R.truth]]) { if (!show) continue; c.fillStyle = L.tok(colr); c.fillRect(lx, t + 11, 10, 2); c.fillText(name, lx + 15, t + 6); lx += c.measureText(name).width + 34; }
    c.restore();
  }
  function verdicts() {
    const out = {}, n = st.length, den = Math.hypot(P.sigma, M.clutter);
    pile.voids.forEach((v, vi) => { let e = 0, pk = 0; for (let s = 0; s < n; s++) { e += parts[vi][s] ** 2; pk = Math.min(pk, parts[vi][s]); } const snr = Math.sqrt(e) / den;
      out[v.id] = { state: snr >= 5 ? 'seen' : snr >= 2.5 ? 'hint' : 'missed', text: 'dip ' + Math.abs(pk).toFixed(0) + ' E · ' + snr.toFixed(1) + 'σ', why: 'Signal-to-noise of the whole dip, counting sensor noise (' + P.sigma.toFixed(0) + ' E) and the pull of the unknown slabs and uneven rubble (' + M.clutter.toFixed(0) + ' E) as noise.' }; });
    out.person = { state: 'na', text: 'under 1 E', why: 'A person in a void changes the gradient at the surface by far less than one eötvös.' };
    return out;
  }
  return {
    title: 'Quantum gravity mapping', hardware: 'One research gradiometer has done this outdoors. It is the size of a cart.',
    lede: 'A void is missing mass, so gravity directly above it is a few parts in ten billion weaker. A gradiometer drops two clouds of laser-cooled atoms a metre apart and compares how they fall, which cancels vibration and leaves the pull of what is underneath.',
    honest: 'the instrument must stand still and upright for minutes at every station on a surface that is rubble, the outer shape and average density of the pile must be known to subtract them, and a heavy slab pulls the reading the other way. The unknown slabs are the largest error here, larger than the sensor.',
    assumed: 'Assumed: everything extends 2 m either side of the section; the pile surface is known and subtracted at 1.8 g/cm³; averaging time follows the published 466 E/√Hz; two minutes to move between stations. Sensor heights (0.5 m and 1.5 m) follow the Birmingham instrument.',
    sources: [{ who: 'Stray et al., Nature 602 (2022).', what: 'University of Birmingham: an atom-interferometer gravity gradiometer finds a 2 m tunnel under a road, 20 E in ten minutes.', url: 'https://doi.org/10.1038/s41586-021-04315-3' }],
    _demo: () => ({ P, st, sig, data, fit, noise, parts, m, M, active, CR, CNX, CNZ, invert, measure, survey, surveyHours }),
    setPile(p) { pile = p; P.sweep = 1; P.sweeping = false; survey(); }, controls, drawStage, drawReadout, tick, verdicts,
    stageTitle: () => 'Missing mass, rebuilt from the gravity gradient', stageNote: () => st.length + ' stations · ' + L.fmtDur(surveyHours()) + ' on site',
    readoutTitle: () => ['A void is a dip in the gravity gradient, if the dip is deeper than the noise', 'Vertical gradient, eötvös, after removing a solid pile. Each point sits under its station.'],
    results: () => [
      { k: 'Time on site', v: L.fmtDur(surveyHours()), sub: st.length + ' stations × ' + L.fmtDur((perStation() + 120) / 3600) },
      { k: 'Structure clutter', v: M.clutter.toFixed(0) + ' E', sub: 'pull of slabs and uneven rubble', tone: M.clutter > P.sigma ? 'warn' : '' },
      { k: 'Image error', v: M.rms.toFixed(2) + ' g/cm³', sub: 'RMS against the true deficit' },
      { k: 'Match to truth', v: 'r = ' + M.corr.toFixed(2), sub: 'depth is poorly pinned by gravity', tone: M.corr > 0.5 ? 'ok' : M.corr > 0.25 ? 'warn' : 'bad' },
    ],
    row: { sees: 'Missing mass. Big, shallow voids. Depth stays ambiguous.', range: 'About as deep as the void is wide', time: 'Hours: minutes at every station', cost: 'Very high', costNote: 'laboratory prototype', ready: 1, readyNote: 'One outdoor demonstration over a tunnel, 2022.' },
    summary: () => { const V = verdicts(); return pile.voids.filter((v) => V[v.id].state === 'seen').length + ' of 4 voids at ' + P.sigma.toFixed(0) + ' E, ' + L.fmtDur(surveyHours()) + ' on site'; },
  };
}
