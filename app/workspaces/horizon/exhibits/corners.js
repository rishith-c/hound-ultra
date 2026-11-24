// Seeing around corners: non-line-of-sight imaging in plan view, with the real mathematics.
// A pulse is fired at a wall the sensor can see. Light scatters into the hidden room, off whatever is there, back
// to the wall, and a single-photon detector times the echoes. Everything below is computed in the page: the
// transient histograms (three-bounce light transport with occlusion, 1/r^4 falloff, timing jitter, Poisson photon
// noise, ambient counts), the reconstruction (filtered backprojection, or f-k migration after Lindell et al. 2019),
// a matched filter that looks for a body-shaped contour, and the comparison with the simulated truth.
//
// Numbers taken from the literature (checked November 2026):
//   2 m x 2 m scanned wall, 32 ps histogram bins, exposures of 10 to 180 min for 512 x 512 points, 32 x 32 points
//   at 4 frames a second for a retroreflective target: Lindell, Wetzstein, O'Toole 2019 (data notes of the paper's
//   code release, github.com/computational-imaging/nlos-fk).
//   About 60 ps combined jitter of detector and laser, 64 x 64 scan points, 0.1 to 1 s per point: Heide et al.,
//   "Non-line-of-sight imaging with partial occluders and surface normals", arXiv:1711.07134.
//   Streak camera precision of up to 2 ps, hidden volume 40 cm across: Velten et al. 2012.
// Assumed (not from a source): 16 ps bins, albedos, photon and ambient counts, the room and everything in it.
import * as L from '../lib.js';
const { TAU, clamp } = L;

const C = 0.299792458;                 // metres per nanosecond
const DT = 0.016, NT = 1536;           // histogram: 16 ps bins (assumed), 24.6 ns long
const XW = 2.6;                        // the relay wall is the line x = XW; the hidden room lies at x < XW
const ROOM = { w: 2.6, h: 2.8 };       // hidden room, metres
const REC = { x0: 0.3, y0: 0.1, w: 2.0, h: 2.6 };   // the area that is reconstructed
const CELL = 0.008;                    // reconstruction grid, metres (16 mm while dragging and in the sweep)
const AP_C = 1.4;                      // centre of the scanned length along the wall
const SENSOR = { x: 2.1, y: 3.56 };
const DOOR_X = 2.0, LINTEL = [2.8, 2.92];
const ALB = [0.5, 0.35, 0.6];          // person (clothing), concrete slab, painted wall stub: all assumed
const NAMES = ['person', 'slab', 'wall stub'];
const SWEEP_J = [20, 28, 40, 57, 80, 113, 160, 226, 320, 453, 640, 800], SWEEP_SEEDS = 3;
const T_VIEW = [1.5, 23.5];

const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + ' M' : n >= 1e4 ? Math.round(n / 1e3) + ' k' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' k' : String(Math.round(n)));
const fmtCm = (m) => { const c = m * 100; return c < 9.95 ? c.toFixed(1) : String(Math.round(c)); };

// ---------- the hidden scene: surfaces as dense point samples with outward normals ----------
// A person lying on the floor, seen from above: a union of capsules. Body frame: u from the pelvis to the head, v sideways.
const BODY = [
  [0, 0, 0.48, 0, 0.16], [0.5, -0.17, 0.5, 0.17, 0.065], [0.52, 0, 0.68, 0, 0.055], [0.75, 0, 0.75, 0, 0.1],
  [0.5, 0.2, 0.27, 0.37, 0.05], [0.27, 0.37, 0.43, 0.55, 0.042], [0.5, -0.2, 0.2, -0.27, 0.05], [0.2, -0.27, -0.05, -0.3, 0.042],
  [-0.02, 0.09, -0.42, 0.24, 0.078], [-0.42, 0.24, -0.86, 0.13, 0.055], [-0.02, -0.09, -0.46, -0.12, 0.078], [-0.46, -0.12, -0.9, -0.14, 0.055],
  [-0.86, 0.13, -0.95, 0.18, 0.045], [-0.9, -0.14, -0.99, -0.19, 0.045],
].map((p) => p.map((v) => v * 0.93));   // 1.71 m head to heel
const TILT = (10 * Math.PI) / 180, BU = [Math.sin(TILT), -Math.cos(TILT)], BV = [Math.cos(TILT), Math.sin(TILT)];
const CLUTTER = [{ cx: 0.6, cy: 0.82, len: 0.95, th: 0.1, ang: (76 * Math.PI) / 180, obj: 1 }, { cx: 0.78, cy: 2.3, len: 0.72, th: 0.09, ang: (-32 * Math.PI) / 180, obj: 2 }];
const DS = 0.0025;                      // spacing of the surface samples

function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy); }
function buildBody() {   // points relative to the pelvis, already turned into room axes; lines: the outline of the union, for drawing
  const prim = BODY.map(([u0, v0, u1, v1, r]) => ({ ax: u0 * BU[0] + v0 * BV[0], ay: u0 * BU[1] + v0 * BV[1], bx: u1 * BU[0] + v1 * BV[0], by: u1 * BU[1] + v1 * BV[1], r }));
  const pts = [], lines = [];
  prim.forEach((p, pi) => {
    const dx = p.bx - p.ax, dy = p.by - p.ay, len = Math.hypot(dx, dy), tx = len ? dx / len : 1, ty = len ? dy / len : 0, nx = -ty, ny = tx, loop = [];
    const nS = Math.max(0, Math.round(len / DS)), nC = Math.max(8, Math.round((Math.PI * p.r) / DS));
    for (let i = 0; i < nS; i++) { const s = ((i + 0.5) / nS) * len; loop.push([p.ax + nx * p.r + tx * s, p.ay + ny * p.r + ty * s, nx, ny, len / nS]); }
    for (let i = 0; i < nC; i++) { const a = Math.PI / 2 - ((i + 0.5) / nC) * Math.PI, ux = tx * Math.cos(a) + nx * Math.sin(a), uy = ty * Math.cos(a) + ny * Math.sin(a); loop.push([p.bx + ux * p.r, p.by + uy * p.r, ux, uy, (Math.PI * p.r) / nC]); }
    for (let i = 0; i < nS; i++) { const s = (1 - (i + 0.5) / nS) * len; loop.push([p.ax - nx * p.r + tx * s, p.ay - ny * p.r + ty * s, -nx, -ny, len / nS]); }
    for (let i = 0; i < nC; i++) { const a = -Math.PI / 2 - ((i + 0.5) / nC) * Math.PI, ux = tx * Math.cos(a) + nx * Math.sin(a), uy = ty * Math.cos(a) + ny * Math.sin(a); loop.push([p.ax + ux * p.r, p.ay + uy * p.r, ux, uy, (Math.PI * p.r) / nC]); }
    let run = null;
    const keep = loop.map((q) => !prim.some((o, oi) => oi !== pi && segDist(q[0], q[1], o.ax, o.ay, o.bx, o.by) < o.r - 1e-4));
    loop.forEach((q, i) => { if (keep[i]) { pts.push(q); if (!run) { run = []; lines.push(run); } if (i % 3 === 0) run.push(q[0], q[1]); } else run = null; });
  });
  return { pts, lines };
}
function buildRect({ cx, cy, len, th, ang }) {
  const c = Math.cos(ang), s = Math.sin(ang), hx = len / 2, hy = th / 2, cor = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([a, b]) => [cx + a * c - b * s, cy + a * s + b * c]), pts = [];
  for (let e = 0; e < 4; e++) { const a = cor[e], b = cor[(e + 1) % 4], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), n = Math.max(1, Math.round(l / DS)), nx = dy / l, ny = -dx / l; for (let i = 0; i < n; i++) { const f = (i + 0.5) / n; pts.push([a[0] + dx * f, a[1] + dy * f, nx, ny, l / n]); } }
  return { pts, cor };
}

// ---------- signal processing ----------
// Gaussian blur along time of M rows: a direct kernel when narrow, three box passes when wide (the same to within about 3 %).
function gaussRows(src, M, sigma) {
  const out = new Float32Array(src.length); if (sigma < 0.05) { out.set(src); return out; }
  if (sigma < 2.5) { const K = Math.ceil(3.2 * sigma), ker = new Float32Array(2 * K + 1); let s = 0; for (let k = -K; k <= K; k++) s += ker[k + K] = Math.exp((-0.5 * k * k) / (sigma * sigma)); for (let k = 0; k <= 2 * K; k++) ker[k] /= s;
    for (let i = 0; i < M; i++) { const o = i * NT; for (let t = 0; t < NT; t++) { let a = 0; const lo = Math.max(0, t - K), hi = Math.min(NT - 1, t + K); for (let q = lo; q <= hi; q++) a += src[o + q] * ker[q - t + K]; out[o + t] = a; } } return out; }
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2)), w = 2 * r + 1; let a = new Float32Array(src), b = out;
  for (let pass = 0; pass < 3; pass++) { for (let i = 0; i < M; i++) { const o = i * NT; let s = 0; for (let q = 0; q <= r && q < NT; q++) s += a[o + q]; for (let t = 0; t < NT; t++) { b[o + t] = s / w; const add = t + r + 1, sub = t - r; if (add < NT) s += a[o + add]; if (sub >= 0) s -= a[o + sub]; } } const sw = a; a = b; b = sw; }
  if (a !== out) out.set(a); return out;
}
function fft2(re, im, rows, cols, inverse) {
  for (let r = 0; r < rows; r++) L.fft(re.subarray(r * cols, (r + 1) * cols), im.subarray(r * cols, (r + 1) * cols), inverse);
  const cr = new Float64Array(rows), ci = new Float64Array(rows);
  for (let c = 0; c < cols; c++) { for (let r = 0; r < rows; r++) { cr[r] = re[r * cols + c]; ci[r] = im[r * cols + c]; } L.fft(cr, ci, inverse); for (let r = 0; r < rows; r++) { re[r * cols + c] = cr[r]; im[r * cols + c] = ci[r]; } }
}

export default {
  id: 'corners', title: 'Seeing around corners', short: 'Corners',
  readiness: 0.38, readinessNote: 'Shown in optics laboratories on still scenes a metre or two across. No one has imaged a person inside a real collapse this way. HOUND has no such sensor.',
  standoff: [1.5, 12],
  labels: ['concept', 'live-algo'],
  labelNote: 'The room, the person, the echoes and the photon noise are simulated. The reconstruction and the search for a body shape are computed in this page, from the noisy photon counts alone, then compared with the simulated truth.',
  sentences: [
    'Fire a very short laser pulse at a wall you can see: light scatters into the room you cannot see, off whatever is there, and back, and a single-photon detector times each returning photon to tens of picoseconds.',
    'From those echoes of light a picture of the hidden room can be computed, so a rescuer could look into a void around a corner without anyone going in.',
  ],
  needs: 'A wall or slab the sensor can see that also faces the void. Near darkness, or a detector gated to ignore daylight. Seconds to minutes of exposure with nothing moving: the published room-sized scans took 10 to 180 minutes. Clean air, because dust and smoke scatter the pulse before it gets there.',
  unknown: 'Whether any of this survives a real collapse: rough, dusty, dark surfaces, and almost no photons coming back from skin and cloth. Laboratories have imaged mannequins, statues and people in reflective suits in still rooms. Nobody has imaged a trapped person. This exhibit is one flat slice of an invented room.',
  sources: [
    { who: 'Velten et al., MIT Media Lab', year: 2012, title: 'Recovering three-dimensional shape around a corner using ultrafast time-of-flight imaging', where: 'Nature Communications 3, 745', url: 'https://doi.org/10.1038/ncomms1747' },
    { who: "O'Toole, Lindell and Wetzstein, Stanford", year: 2018, title: 'Confocal non-line-of-sight imaging based on the light-cone transform', where: 'Nature 555, 338–341', url: 'https://doi.org/10.1038/nature25489' },
    { who: "Lindell, Wetzstein and O'Toole, Stanford", year: 2019, title: 'Wave-based non-line-of-sight imaging using fast f-k migration', where: 'ACM Transactions on Graphics 38(4), article 116', url: 'https://www.computationalimaging.org/publications/nlos-fk/' },
  ],
  glyph(g, s, t, c) {
    const u = s / 34; g.beginPath(); g.moveTo(9 * u, -13 * u); g.lineTo(9 * u, 13 * u); g.moveTo(-14 * u, 4 * u); g.lineTo(1 * u, 4 * u); g.stroke();
    g.save(); g.beginPath(); g.rect(-17 * u, -17 * u, 26 * u, 21 * u); g.clip(); g.strokeStyle = c.accent;
    for (let k = 0; k < 2; k++) { const f = (t * 0.22 + k / 2) % 1; g.globalAlpha = 0.9 * (1 - f); g.beginPath(); g.arc(9 * u, -3 * u, f * 22 * u, 0, TAU); g.stroke(); }
    g.restore(); g.globalAlpha = 1; g.fillStyle = c.person; g.beginPath(); g.arc(-6 * u, -4 * u, 2.4 * u, 0, TAU); g.fill();
    g.fillStyle = c.ink; g.fillRect(3.5 * u, 9 * u, 3 * u, 3 * u);
  },

  create({ stage, controls, readout }) {
    L.layout(stage, { cols: 'minmax(0, 1.08fr) minmax(0, 1fr)', rows: 'minmax(0, 1.12fr) minmax(0, 1fr)', areas: ['hero ras', 'hero sweep'] });
    const fHero = L.figure({ area: 'hero', title: 'Scanning the wall…' });
    const fRas = L.figure({ area: 'ras', title: 'What the detector records' });
    const fSw = L.figure({ area: 'sweep', title: 'How the answer depends on time resolution' });
    stage.append(fHero.el, fRas.el, fSw.el);
    const T = L.tokens();

    const P = { jit: 70, M: 64, ph: 3162, len: 2.0, amb: 316, method: 'bp', curves: true, seed: 5, px: 1.3, py: 1.36 };
    const body = buildBody(), rects = CLUTTER.map(buildRect);
    const nB = body.pts.length, nP = nB + rects.reduce((a, r) => a + r.pts.length, 0);
    const SX = new Float32Array(nP), SY = new Float32Array(nP), SNX = new Float32Array(nP), SNY = new Float32Array(nP), SA = new Float32Array(nP), SO = new Uint8Array(nP);
    { let k = nB; body.pts.forEach((q, i) => { SNX[i] = q[2]; SNY[i] = q[3]; SA[i] = ALB[0] * q[4]; }); rects.forEach((r, ri) => r.pts.forEach((q) => { SX[k] = q[0]; SY[k] = q[1]; SNX[k] = q[2]; SNY[k] = q[3]; SA[k] = ALB[CLUTTER[ri].obj] * q[4]; SO[k] = CLUTTER[ri].obj; k++; })); }
    const placeBody = () => { for (let i = 0; i < nB; i++) { SX[i] = P.px + body.pts[i][0]; SY[i] = P.py + body.pts[i][1]; } };
    // The contour a sensor could ever see: the side of the body that faces the relay wall. The matched filter looks for this shape.
    const TPL = (() => { const top = new Map(), out = []; body.pts.forEach((q) => { if (q[2] < 0.2) return; const b = Math.round(q[1] / 0.01); if (!top.has(b) || top.get(b) < q[0]) top.set(b, q[0]); });
      let last = null; body.pts.forEach((q) => { if (q[2] < 0.2) return; if (q[0] < top.get(Math.round(q[1] / 0.01)) - 0.03) return; if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.014) return; last = q; out.push([q[0], q[1]]); }); return out; })();
    const bodyBox = body.pts.reduce((b, q) => [Math.min(b[0], q[0]), Math.max(b[1], q[0]), Math.min(b[2], q[1]), Math.max(b[3], q[1])], [9, -9, 9, -9]);

    const relayY = (M, len) => Float32Array.from({ length: M }, (_, i) => AP_C - len / 2 + ((i + 0.5) / M) * len);
    // Which surface samples one relay point can see: facing it, and nothing nearer along the same direction.
    const NB = 256, zb = new Float32Array(NB + 2), vr = new Float32Array(nP), vb = new Int16Array(nP);
    function visible(yi) {
      zb.fill(1e9);
      for (let k = 0; k < nP; k++) { const dx = XW - SX[k], dy = yi - SY[k], r = Math.sqrt(dx * dx + dy * dy); if (SNX[k] * dx + SNY[k] * dy <= 0) { vb[k] = -1; continue; } const b = 1 + ((((-dy / (Math.abs(dy) + dx)) + 1) * 0.5 * NB) | 0); vb[k] = b; vr[k] = r; if (r < zb[b]) zb[b] = r; }
      for (let k = 0; k < nP; k++) { const b = vb[k]; if (b < 0) continue; if (vr[k] > Math.min(zb[b - 1], zb[b], zb[b + 1]) + 0.03) vb[k] = -1; }
    }
    // The noise-free echoes: for each relay point, every visible surface sample returns light at t = 2 r / c,
    // weakened by 1 / r^4 and by the cosines at the wall and at the surface (confocal, three bounces, diffuse).
    function simulate() {
      placeBody();
      const M = P.M, ys = relayY(M, P.len), clean = new Float32Array(M * NT), tArr = [0, 1, 2].map(() => new Float32Array(M).fill(NaN)), seen = new Float32Array(nP), kb = 2 / (C * DT); let tot = 0;
      for (let i = 0; i < M; i++) { visible(ys[i]); const o = i * NT;
        for (let k = 0; k < nP; k++) { if (vb[k] < 0) continue; const r = vr[k], dx = XW - SX[k], dy = ys[i] - SY[k], cw = dx / r, cp = (SNX[k] * dx + SNY[k] * dy) / r, w = (SA[k] * cw * cw * cp * cp) / (r * r * r * r), tb = r * kb, j = tb | 0; if (j >= NT - 1) continue;
          clean[o + j] += w * (1 - (tb - j)); clean[o + j + 1] += w * (tb - j); tot += w; seen[k] += 1 / M; const t = (2 * r) / C, ta = tArr[SO[k]]; if (!(ta[i] <= t)) ta[i] = t; } }
      const sc = tot > 0 ? M / tot : 0; for (let q = 0; q < clean.length; q++) clean[q] *= sc;   // mean photons per relay point = 1, before the budget
      return { M, ys, clean, tArr, seen: Float32Array.from(seen), len: P.len, px: P.px, py: P.py };
    }
    function measure(sim, jit, ph, amb, seed) {
      const R = L.rng(seed * 7919 + 13), lam = gaussRows(sim.clean, sim.M, jit / 2.3548 / (DT * 1000)), bg = amb / NT, e0 = Math.exp(-bg), n = lam.length; let sig = 0, tot = 0;
      for (let q = 0; q < n; q++) { const s = ph * lam[q], l = s + bg; let c;
        if (l < 24) { const e = s > 1e-7 ? Math.exp(-l) : e0; c = 0; let p = R(); while (p > e) { c++; p *= R(); } } else c = Math.max(0, Math.round(l + Math.sqrt(l) * R.n()));
        lam[q] = c; tot += c; sig += s; }
      return { counts: lam, total: tot, signal: sig };
    }
    const grid = (cell) => ({ cell, gx: Math.round(REC.w / cell), gy: Math.round(REC.h / cell) });
    // Filtered backprojection. The histogram is smoothed and its second derivative taken along time (a Laplacian of
    // Gaussian), then every bin is smeared back over the circle of points at that distance from its relay point.
    function filterBP(counts, M, jit, cell) { const sig = Math.max((0.7 * jit) / 2.3548 / (DT * 1000), (0.45 * cell) / ((C * DT) / 2), 1), s = gaussRows(counts, M, sig), f = new Float32Array(s.length); for (let i = 0; i < M; i++) { const o = i * NT; for (let t = 1; t < NT - 1; t++) f[o + t] = 2 * s[o + t] - s[o + t - 1] - s[o + t + 1]; } return f; }
    function backproject(f, ys, i0, i1, acc, G) {
      const kb = 2 / (C * DT), dz = Float32Array.from({ length: G.gx }, (_, a) => XW - (REC.x0 + (a + 0.5) * G.cell));
      for (let i = i0; i < i1; i++) { const off = i * NT, yi = ys[i];
        for (let b = 0, o = 0; b < G.gy; b++) { const dy = REC.y0 + (b + 0.5) * G.cell - yi, dy2 = dy * dy;
          for (let a = 0; a < G.gx; a++, o++) { const r2 = dz[a] * dz[a] + dy2, tb = Math.sqrt(r2) * kb, j = tb | 0, v = f[off + j]; acc[o] += (v + (f[off + j + 1] - v) * (tb - j)) * r2 * r2; } } }
    }
    // f-k migration (Stolt), after Lindell et al. 2019: treat the echoes as a wave field recorded on the wall, Fourier
    // transform it in position and time, re-map temporal frequency to depth frequency, transform back.
    const FK = { ny: 128, nt: 1024, dy: 0.025, y0: -0.2, dz: C * DT };   // 32 ps time samples, as in the published hardware
    function fkMigrate(counts, M, ys, G) {
      const { ny, nt, dy, y0, dz } = FK, n = ny * nt, re = new Float64Array(n), im = new Float64Array(n), hits = new Uint16Array(ny);
      let bg = 0; for (let i = 0; i < M; i++) for (let t = 0; t < 96; t++) bg += counts[i * NT + t]; bg = (bg / (M * 96)) * 2;
      for (let i = 0; i < M; i++) { const r = Math.round((ys[i] - y0) / dy - 0.5); if (r < 0 || r >= ny) continue; hits[r]++; const o = r * nt, s = i * NT; for (let t = 0; t < NT / 2; t++) { const v = counts[s + 2 * t] + counts[s + 2 * t + 1] - bg; re[o + t] += v * t * t * 1e-4; } }
      for (let r = 0; r < ny; r++) if (hits[r] > 1) { const o = r * nt; for (let t = 0; t < nt; t++) re[o + t] /= hits[r]; }
      fft2(re, im, ny, nt, false);
      const or = new Float64Array(n), oi = new Float64Array(n), s2 = ((nt * dz) / (ny * dy)) ** 2, half = nt / 2;
      for (let a = 0; a < ny; a++) { const na = a < ny / 2 ? a : a - ny, k2 = s2 * na * na, o = a * nt;
        for (let b = 1; b < nt; b++) { const nz = b < half ? b : b - nt, nf = Math.sqrt(nz * nz + k2); if (nf >= half - 1) continue; const f0 = nf | 0, fr = nf - f0, w = Math.abs(nz) / nf;
          let q0, q1; if (nz > 0) { q0 = f0; q1 = f0 + 1; } else { q0 = (nt - f0) % nt; q1 = nt - f0 - 1; }
          or[o + b] = w * (re[o + q0] * (1 - fr) + re[o + q1] * fr); oi[o + b] = w * (im[o + q0] * (1 - fr) + im[o + q1] * fr); } }
      fft2(or, oi, ny, nt, true);
      const out = new Float32Array(G.gx * G.gy);
      for (let b = 0, o = 0; b < G.gy; b++) { const fy = (REC.y0 + (b + 0.5) * G.cell - y0) / dy - 0.5, r0 = clamp(fy | 0, 0, ny - 2), ry = clamp(fy - r0);
        for (let a = 0; a < G.gx; a++, o++) { const z = XW - (REC.x0 + (a + 0.5) * G.cell), fz = z / dz - 0.25, c0 = fz | 0, cz = fz - c0, xs = (Math.PI * fz) / nt, apo = (Math.sin(xs) / xs) ** 2;
          const m = (q) => or[q] * or[q] + oi[q] * oi[q], q = r0 * nt + c0;
          out[o] = ((m(q) * (1 - cz) + m(q + 1) * cz) * (1 - ry) + (m(q + nt) * (1 - cz) + m(q + nt + 1) * cz) * ry) / (apo * apo); } }
      return out;
    }
    function normalise(acc) { let mx = 0; for (let q = 0; q < acc.length; q++) { if (acc[q] < 0) acc[q] = 0; else if (acc[q] > mx) mx = acc[q]; } if (mx > 0) for (let q = 0; q < acc.length; q++) acc[q] /= mx; return mx; }
    function reconstruct(sim, meas, jit, method, cell) {
      const G = grid(cell); let img;
      if (method === 'fk') img = fkMigrate(meas.counts, sim.M, sim.ys, G); else { img = new Float32Array(G.gx * G.gy); backproject(filterBP(meas.counts, sim.M, jit, cell), sim.ys, 0, sim.M, img, G); }
      const peak = normalise(img); return { img, G, peak };
    }
    // Matched filter: slide the wall-facing contour of a lying body over the picture; bright along the contour and
    // dark just in front of and behind it scores high. The best place is the estimate. The pose is assumed known.
    function locate(rec) {
      const { img, G } = rec, { cell, gx, gy } = G, n = TPL.length, ta = new Int32Array(n), tb = new Int32Array(n), dl = Math.round(0.06 / cell);
      TPL.forEach((q, k) => { ta[k] = Math.round(q[0] / cell); tb[k] = Math.round(q[1] / cell); });
      const a0 = Math.ceil(-bodyBox[0] / cell) + 1, a1 = gx - Math.ceil(bodyBox[1] / cell) - dl - 1, b0 = Math.ceil(-bodyBox[2] / cell) + 1, b1 = gy - Math.ceil(bodyBox[3] / cell) - 1;
      const score = (a, b) => { let s = 0; for (let k = 0; k < n; k++) { const o = (b + tb[k]) * gx + a + ta[k]; s += img[o] - 0.5 * (img[o + dl] + img[o - dl]); } return s / n; };
      let best = -1e9, ba = a0, bb = b0; const st = Math.max(1, Math.round(0.024 / cell));
      for (let b = b0; b <= b1; b += st) for (let a = a0; a <= a1; a += st) { const s = score(a, b); if (s > best) { best = s; ba = a; bb = b; } }
      const ca = ba, cb = bb; for (let b = Math.max(b0, cb - st); b <= Math.min(b1, cb + st); b++) for (let a = Math.max(a0, ca - st); a <= Math.min(a1, ca + st); a++) { const s = score(a, b); if (s > best) { best = s; ba = a; bb = b; } }
      return { x: REC.x0 + (ba + 0.5) * cell, y: REC.y0 + (bb + 0.5) * cell, score: best };
    }
    // Match with truth: correlation between the picture and the surfaces that light from the wall could reach, blurred by 1.2 cm.
    function truthMap(sim, G) {
      const { cell, gx, gy } = G, m = new Float32Array(gx * gy);
      for (let k = 0; k < nP; k++) { if (sim.seen[k] <= 0) continue; const a = ((SX[k] - REC.x0) / cell) | 0, b = ((SY[k] - REC.y0) / cell) | 0; if (a < 0 || b < 0 || a >= gx || b >= gy) continue; m[b * gx + a] += sim.seen[k] * SA[k]; }
      const rad = Math.max(1, Math.round(0.012 / cell)), tmp = new Float32Array(gx * gy);
      for (let pass = 0; pass < 2; pass++) { for (let b = 0; b < gy; b++) for (let a = 0; a < gx; a++) { let s = 0; for (let d = -rad; d <= rad; d++) { const q = a + d; if (q >= 0 && q < gx) s += m[b * gx + q]; } tmp[b * gx + a] = s; }
        for (let b = 0; b < gy; b++) for (let a = 0; a < gx; a++) { let s = 0; for (let d = -rad; d <= rad; d++) { const q = b + d; if (q >= 0 && q < gy) s += tmp[q * gx + a]; } m[b * gx + a] = s; } }
      return m;
    }
    function match(img, tm) { let ab = 0, aa = 0, bb = 0; for (let q = 0; q < img.length; q++) { ab += img[q] * tm[q]; aa += img[q] * img[q]; bb += tm[q] * tm[q]; } return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0; }
    // Resolution bound of a confocal scan (the form given by O'Toole et al. 2018): two points a distance dx apart at depth z
    // differ in round-trip time by at most 2 dx w / (c sqrt(w^2 + z^2)) as seen from the edge of a scan of half-width w.
    const gammaEff = (jit) => Math.hypot(jit, 0.68 * DT * 1000) / 1000;   // ns; the 16 ps bin adds a little
    const resLat = (jit, z, len) => (C * gammaEff(jit) * Math.hypot(len / 2, z)) / len;
    const resAx = (jit) => (C * gammaEff(jit)) / 2;

    // ---------- state ----------
    let S = null, quick = false, pulse = null, build = null, nextAuto = 0, shown = false, hv = null, rv = null, nearBody = false, dragOff = null, fireN = 0;
    let recR = null, recKey = '';
    const lut = (() => { const a = new Uint8Array(256 * 3); for (let i = 0; i < 256; i++) { const c = L.heat(0.06 + 0.94 * (i / 255)); a[3 * i] = c[0]; a[3 * i + 1] = c[1]; a[3 * i + 2] = c[2]; } return a; })();
    let rasR = null;
    const SW = { key: '', err: [], ncc: [], n: 0, sim: null, tm: null, id: 0 };

    function paintRec(img, G, gain = 1) {
      if (!recR || recKey !== G.gx + 'x' + G.gy) { recR = L.raster(G.gx, G.gy); recKey = G.gx + 'x' + G.gy; }
      const d = recR.data; for (let q = 0, p = 0; q < img.length; q++, p += 4) { const v = clamp(img[q] * gain), i = (Math.sqrt(v) * 255) | 0; d[p] = lut[3 * i]; d[p + 1] = lut[3 * i + 1]; d[p + 2] = lut[3 * i + 2]; d[p + 3] = (255 * L.smooth((v - 0.02) / 0.16)) | 0; }
      recR.commit();
    }
    const RT = 400;
    function paintRas() {
      const M = S.sim.M, c = S.meas.counts, b0 = T_VIEW[0] / DT, bs = (T_VIEW[1] - T_VIEW[0]) / DT / RT, v = new Float32Array(M * RT); let mx = 0; const hist = new Uint32Array(4096);
      for (let i = 0; i < M; i++) for (let r = 0; r < RT; r++) { let s = 0; const q0 = (b0 + r * bs) | 0, q1 = (b0 + (r + 1) * bs) | 0; for (let q = q0; q < q1; q++) s += c[i * NT + q]; v[i * RT + r] = s; if (s > mx) mx = s; }
      for (let q = 0; q < v.length; q++) hist[Math.min(4095, ((v[q] / (mx || 1)) * 4095) | 0)]++;
      let acc = 0, top = 4095; for (; top > 0; top--) { acc += hist[top]; if (acc > v.length * 0.0015) break; } const ref = Math.max(1, ((top + 1) / 4096) * mx);
      if (!rasR || rasR.w !== M) rasR = L.raster(M, RT);
      const d = rasR.data; for (let r = 0; r < RT; r++) for (let i = 0; i < M; i++) { const p = 4 * (r * M + i), k = (Math.sqrt(clamp(v[i * RT + r] / ref)) * 255) | 0; d[p] = lut[3 * k]; d[p + 1] = lut[3 * k + 1]; d[p + 2] = lut[3 * k + 2]; d[p + 3] = 255; }
      rasR.commit(); S.rasRef = ref / bs;
    }

    function compute() {
      const cell = quick ? 2 * CELL : CELL, simKey = [P.M, P.len, P.px, P.py].join();
      const sim = S && S.simKey === simKey ? S.sim : simulate();
      const meas = measure(sim, P.jit, P.ph, P.amb, P.seed);
      const rec = reconstruct(sim, meas, P.jit, P.method, cell), est = locate(rec), tm = truthMap(sim, rec.G);
      const z = XW - est.x, err = Math.hypot(est.x - P.px, est.y - P.py);
      let on = 'the person'; if (err > 0.25) { on = 'empty floor'; CLUTTER.forEach((r, i) => { if (rects[i].pts.some((q, k) => k % 8 === 0 && Math.hypot(q[0] - est.x - 0.2, q[1] - est.y) < 0.45)) on = 'the ' + NAMES[r.obj]; }); }
      S = { sim, simKey, meas, rec, est, err, on, ncc: match(rec.img, tm), lat: resLat(P.jit, z, P.len), ax: resAx(P.jit), cell };
      build = null; paintRec(rec.img, rec.G); paintRas(); report(); redrawAll();
      if (!quick) startSweep();
    }
    const recompute = L.soon(compute);
    const redrawAll = () => { fHero.redraw(); fRas.redraw(); fSw.redraw(); };

    // ---------- the sweep: the same pipeline at twelve time resolutions and three draws of noise, a few runs per frame ----------
    function startSweep() {
      const key = [P.M, P.len, P.px, P.py, P.ph, P.amb, P.method, P.seed].join(); if (SW.key === key) { sweepTitle(); return; }
      cancelAnimationFrame(SW.id); SW.key = key; SW.n = 0; SW.err = SWEEP_J.map(() => []); SW.ncc = SWEEP_J.map(() => []); SW.sim = S.sim; SW.tm = truthMap(S.sim, grid(2 * CELL));
      if (shown) SW.id = requestAnimationFrame(sweepTick); sweepTitle();
    }
    function sweepTick() {
      const t0 = performance.now(), total = SWEEP_J.length * SWEEP_SEEDS, still = L.reduced();
      while (SW.n < total && (still || performance.now() - t0 < 9)) { const j = SW.n % SWEEP_J.length, sd = (SW.n / SWEEP_J.length) | 0, jit = SWEEP_J[j];
        const meas = measure(SW.sim, jit, P.ph, P.amb, P.seed * 31 + sd + 101), rec = reconstruct(SW.sim, meas, jit, P.method, 2 * CELL), est = locate(rec);
        SW.err[j].push(Math.hypot(est.x - SW.sim.px, est.y - SW.sim.py)); SW.ncc[j].push(match(rec.img, SW.tm)); SW.n++; }
      sweepTitle(); fSw.redraw();
      if (SW.n < total && shown) SW.id = requestAnimationFrame(sweepTick);
    }
    const med = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[(s.length - 1) >> 1]; };
    function sweepTitle() {
      const total = SWEEP_J.length * SWEEP_SEEDS, m = SW.err.map(med); let last = -1; for (let j = 0; j < m.length; j++) { if (m[j] <= 0.1) last = j; else if (Number.isFinite(m[j])) break; }
      if (SW.n < SWEEP_J.length) fSw.setTitle('Trying twelve time resolutions on this scene…');
      else if (last < 0) fSw.setTitle('With this scan the person is not found at any time resolution');
      else if (last === m.length - 1) fSw.setTitle('With this scan the person is found to within 10 cm at every time resolution tried');
      else fSw.setTitle('The person is found up to about ' + SWEEP_J[last] + ' ps. Coarser than that, the estimate leaves the body');
      fSw.setNote((SW.n < total ? 'Run ' + SW.n + ' of ' + total + '. ' : '') + 'Each dot is the middle of ' + SWEEP_SEEDS + ' draws of photon noise, with everything else as set; bars span the draws. Computed on a 1.6 cm grid.');
    }

    // ---------- hero ----------
    const WB = { x0: -0.14, x1: 3.02, y0: -0.14, y1: 3.94 };
    fHero.draw = (g, w, hh) => {
      if (!S) return;
      const s = Math.min(w / (WB.x1 - WB.x0), hh / (WB.y1 - WB.y0)), ox = (w - s * (WB.x1 - WB.x0)) / 2 - WB.x0 * s, oy = (hh - s * (WB.y1 - WB.y0)) / 2 - WB.y0 * s, X = (x) => ox + x * s, Y = (y) => oy + y * s; hv = { s, ox, oy };
      const box = (x0, y0, x1, y1) => [X(x0), Y(y0), (x1 - x0) * s, (y1 - y0) * s], ys = S.sim.ys, M = S.sim.M;
      // floor
      g.fillStyle = T.bg1; g.fillRect(...box(0, 0, ROOM.w, ROOM.h)); g.fillRect(...box(1.7, LINTEL[0], XW, WB.y1));
      g.strokeStyle = L.rgba('text3', 0.1); g.lineWidth = 1; g.beginPath(); for (let v = 0.5; v < ROOM.w; v += 0.5) { g.moveTo(Math.round(X(v)) + 0.5, Y(0)); g.lineTo(Math.round(X(v)) + 0.5, Y(ROOM.h)); } for (let v = 0.5; v < ROOM.h; v += 0.5) { g.moveTo(X(0), Math.round(Y(v)) + 0.5); g.lineTo(X(ROOM.w), Math.round(Y(v)) + 0.5); } g.stroke();
      // what the sensor cannot see directly
      const sl = (DOOR_X - SENSOR.x) / (LINTEL[1] - SENSOR.y), xTop = DOOR_X + sl * (0 - LINTEL[1]);
      g.fillStyle = L.rgba('bg0', 0.45); g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(xTop), Y(0)); g.lineTo(X(DOOR_X), Y(LINTEL[0])); g.lineTo(X(0), Y(LINTEL[0])); g.closePath(); g.fill();
      // reconstruction, in place
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; if (recR) g.drawImage(recR.canvas, ...box(REC.x0, REC.y0, REC.x0 + REC.w, REC.y0 + REC.h));
      g.strokeStyle = L.rgba('text3', 0.35); g.setLineDash([2, 4]); g.strokeRect(...box(REC.x0, REC.y0, REC.x0 + REC.w, REC.y0 + REC.h).map((v, i) => (i < 2 ? Math.round(v) + 0.5 : Math.round(v)))); g.setLineDash([]);
      // walls
      g.fillStyle = T.bg3; g.strokeStyle = T.line3; g.lineWidth = 1;
      const wall = (x0, y0, x1, y1) => { g.fillRect(...box(x0, y0, x1, y1)); };
      wall(-0.12, -0.12, XW + 0.12, 0); wall(-0.12, 0, 0, WB.y1); wall(XW, 0, XW + 0.12, WB.y1); wall(0, LINTEL[0], DOOR_X, LINTEL[1]); wall(0, LINTEL[1], 1.7, WB.y1);
      g.save(); g.beginPath(); g.rect(...box(0, LINTEL[1], 1.7, WB.y1)); g.clip(); g.strokeStyle = L.rgba('text3', 0.13); g.beginPath(); for (let v = -2; v < 3; v += 0.07) { g.moveTo(X(v), Y(WB.y1)); g.lineTo(X(v + 1.3), Y(LINTEL[1])); } g.stroke(); g.restore();
      g.strokeStyle = T.line3; g.beginPath(); g.moveTo(X(0), Y(WB.y1)); g.lineTo(X(0), Y(0)); g.lineTo(X(XW), Y(0)); g.lineTo(X(XW), Y(WB.y1)); g.moveTo(X(1.7), Y(WB.y1)); g.lineTo(X(1.7), Y(LINTEL[1])); g.lineTo(X(DOOR_X), Y(LINTEL[1])); g.lineTo(X(DOOR_X), Y(LINTEL[0])); g.lineTo(X(0), Y(LINTEL[0])); g.stroke();
      // sight line
      g.strokeStyle = L.rgba('text2', 0.5); g.setLineDash([5, 5]); g.beginPath(); g.moveTo(X(SENSOR.x), Y(SENSOR.y)); g.lineTo(X(xTop), Y(0)); g.stroke(); g.setLineDash([]);
      // scan fan and relay points
      g.strokeStyle = L.rgba('accent', M > 48 ? 0.07 : 0.12); g.beginPath(); for (let i = 0; i < M; i++) { g.moveTo(X(SENSOR.x), Y(SENSOR.y)); g.lineTo(X(XW), Y(ys[i])); } g.stroke();
      g.fillStyle = T.accent; const tk = Math.max(1, Math.min(3, (P.len / M) * s * 0.6)); for (let i = 0; i < M; i++) g.fillRect(X(XW) - 4, Y(ys[i]) - tk / 2, 4, tk);
      const yA = AP_C - P.len / 2, yB = AP_C + P.len / 2, bx = X(XW + 0.12) + 9; g.strokeStyle = L.rgba('accent', 0.9); g.beginPath(); g.moveTo(bx - 4, Y(yA) + 0.5); g.lineTo(bx, Y(yA) + 0.5); g.lineTo(bx, Y(yB) + 0.5); g.lineTo(bx - 4, Y(yB) + 0.5); g.stroke();
      g.save(); g.translate(bx + 13, Y(AP_C)); g.rotate(-Math.PI / 2); L.text(g, 'relay wall: ' + M + ' scan points over ' + P.len.toFixed(1) + ' m', 0, 0, { color: 'accent2', size: 11, align: 'center' }); g.restore();
      // clutter and the person: truth
      g.lineWidth = 1; g.strokeStyle = L.rgba('text2', 0.8); rects.forEach((r) => { g.beginPath(); r.cor.forEach((c, i) => (i ? g.lineTo(X(c[0]), Y(c[1])) : g.moveTo(X(c[0]), Y(c[1])))); g.closePath(); g.stroke(); });
      g.strokeStyle = T.person; g.lineWidth = nearBody || dragOff ? 2 : 1.25; g.lineJoin = 'round'; g.beginPath(); for (const ln of body.lines) for (let q = 0; q < ln.length; q += 2) { const px = X(P.px + ln[q]), py = Y(P.py + ln[q + 1]); if (q) g.lineTo(px, py); else g.moveTo(px, py); } g.stroke();
      // estimate
      const done = !build, e = S.est;
      if (done) { g.strokeStyle = T.accent; g.lineWidth = 1.5; g.setLineDash([1, 3]); g.lineCap = 'round'; g.beginPath(); TPL.forEach((q, k) => { const px = X(e.x + q[0]), py = Y(e.y + q[1]); if (k && Math.hypot(q[0] - TPL[k - 1][0], q[1] - TPL[k - 1][1]) < 0.05) g.lineTo(px, py); else g.moveTo(px, py); }); g.stroke(); g.setLineDash([]); g.lineCap = 'butt';
        g.lineWidth = 1; g.beginPath(); g.moveTo(X(P.px), Y(P.py)); g.lineTo(X(e.x), Y(e.y)); g.stroke();
        g.fillStyle = T.person; g.beginPath(); g.arc(X(P.px), Y(P.py), 2.5, 0, TAU); g.fill();
        g.strokeStyle = T.accent; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(e.x) - 7, Y(e.y)); g.lineTo(X(e.x) + 7, Y(e.y)); g.moveTo(X(e.x), Y(e.y) - 7); g.lineTo(X(e.x), Y(e.y) + 7); g.stroke(); }
      // pulse
      if (pulse) drawPulse(g, X, Y, s);
      if (build) { const yi = ys[Math.min(M - 1, build.i)]; g.strokeStyle = L.rgba('accent2', 0.9); g.lineWidth = 1; g.beginPath(); g.moveTo(X(SENSOR.x), Y(SENSOR.y)); g.lineTo(X(XW), Y(yi)); g.stroke(); }
      // sensor
      const ang = Math.atan2(AP_C - SENSOR.y, XW - SENSOR.x); g.save(); g.translate(X(SENSOR.x), Y(SENSOR.y)); g.rotate(ang); g.fillStyle = T.bg4; g.strokeStyle = T.text2; g.lineWidth = 1; g.beginPath(); g.rect(-13, -8, 22, 16); g.fill(); g.stroke(); g.fillStyle = T.accent; g.fillRect(9, -5, 3, 4); g.fillStyle = T.text2; g.fillRect(9, 1, 3, 4); g.restore();
      // labels
      const lab = (str, x, y, tx, ty, color = 'text2') => L.callout(g, str, X(x), Y(y), X(x) + tx, Y(y) + ty, { color });
      lab('laser and detector (concept)', SENSOR.x - 0.06, SENSOR.y + 0.02, -24, -36, 'text2');
      const headX = P.px + 0.75 * 0.93 * BU[0], headY = P.py + 0.75 * 0.93 * BU[1];
      lab('person: truth (simulated)', headX + 0.07, headY - 0.07, 22, -24, 'person');
      lab('slab', CLUTTER[0].cx - 0.03, CLUTTER[0].cy - 0.4, -14, -22, 'text2'); lab('wall stub', CLUTTER[1].cx - 0.2, CLUTTER[1].cy + 0.14, -8, 24, 'text2');
      L.text(g, 'no direct line of sight left of this line', X(xTop) + 6, Y(0) + 14, { color: 'text3', size: 10.5, halo: true });
      L.text(g, 'hidden room', X(0) + 8, Y(ROOM.h) - 8, { color: 'text3', size: 11 });
      L.text(g, 'corridor', X(1.7) + 6, Y(WB.y1) - 8, { color: 'text3', size: 11 });
      if (done) { const far = S.err > 0.25; L.callout(g, 'estimate, ' + fmtCm(S.err) + ' cm off', X(e.x), Y(e.y), X(e.x) + (e.x > 1.5 ? -26 : 30), Y(e.y) + 34, { color: far ? 'warn' : 'accent', dot: false }); }
      if (!dragOff && !pulse && !build) L.text(g, 'drag the person', X(P.px + bodyBox[0]) - 6, Y(P.py + 0.28), { color: 'accent2', size: 11, align: 'right', halo: true });
      // key, on the solid ground
      const kx = X(0) + 14, ky = Y(LINTEL[1]) + 22, kw = Math.min(150, 1.7 * s - 28);
      L.colorbar(g, kx, ky, kw, (t) => L.heat(0.06 + 0.94 * t), 'none', 'strong', 'reconstructed echo strength');
      L.scaleBar(g, kx, ky + 54, s, { metres: 0.5 });
      // the blur predicted for this depth, drawn to scale
      const rx = kx + 0.5 * s + 34, ry = ky + 48, la = S.lat * s, axp = S.ax * s; g.strokeStyle = T.text; g.lineWidth = 1; g.beginPath(); g.ellipse(rx + Math.max(4, axp / 2), ry - Math.max(2, la / 2) + 4, Math.max(0.75, axp / 2), Math.max(0.75, la / 2), 0, 0, TAU); g.stroke();
      L.text(g, 'predicted blur, to scale', kx, ky + 80, { color: 'text2', size: 11 });
      L.text(g, fmtCm(S.lat) + ' cm across, ' + fmtCm(S.ax) + ' cm deep', kx, ky + 95, { color: 'text', size: 11, mono: true, weight: 400 });
      if (pulse && pulse.tau > 0) { L.text(g, 'light clock ' + pulse.tau.toFixed(1) + ' ns', kx, ky + 122, { color: 'accent2', size: 11, mono: true }); L.text(g, 'slowed ' + (pulse.slow / 1e6).toFixed(0) + ' million times', kx, ky + 137, { color: 'text3', size: 10.5 }); }
      else if (build) L.text(g, 'adding scan point ' + Math.min(M, build.i + 1) + ' of ' + M, kx, ky + 122, { color: 'accent2', size: 11 });
    };
    function drawPulse(g, X, Y, s) {
      const p = pulse, yi = p.y, bx = X(XW), by = Y(yi), sx = X(SENSOR.x), sy = Y(SENSOR.y), f = clamp(p.T / 0.35);
      g.strokeStyle = L.rgba('accent2', p.tau > 0 ? 0.35 : 0.95); g.lineWidth = 1.25; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + (bx - sx) * f, sy + (by - sy) * f); g.stroke();
      if (p.tau <= 0) return;
      g.save(); g.beginPath(); g.rect(X(0), Y(0), ROOM.w * s, ROOM.h * s); g.clip();
      const rho = p.tau * C;   // the outgoing front
      for (let k = 0; k < 3; k++) { const r = rho - k * 0.035; if (r <= 0) continue; g.strokeStyle = L.rgba('accent2', (0.85 - 0.25 * k) * clamp(1.5 / (1 + r * r))); g.lineWidth = k ? 1 : 1.5; g.beginPath(); g.arc(bx, by, r * s, Math.PI / 2, (3 * Math.PI) / 2); g.stroke(); }
      // surfaces light up as the front passes
      for (let q = 0; q < p.vis.length; q += 3) { const k = p.vis[q], d = rho - p.r[q]; if (d < 0 || d > 0.5) continue; g.fillStyle = L.rgba('text', 0.9 * (1 - d / 0.5)); g.fillRect(X(SX[k]) - 1, Y(SY[k]) - 1, 2, 2); }
      // echoes: each surface re-radiates; the nearest point of each object is drawn
      p.echo.forEach((e) => { const dt = p.tau - e.r / C; if (dt <= 0) return; const r = dt * C; if (r > e.r) return; g.strokeStyle = L.rgba(e.obj === 0 ? 'person' : 'text', 0.75 * (1 - 0.6 * (r / e.r))); g.lineWidth = 1; g.beginPath(); g.arc(X(e.x), Y(e.y), r * s, 0, TAU); g.stroke(); });
      g.restore();
      p.echo.forEach((e) => { const dt = p.tau - (2 * e.r) / C; if (dt < 0 || dt > 1.2) return; g.strokeStyle = L.rgba(e.obj === 0 ? 'person' : 'text', 0.9 * (1 - dt / 1.2)); g.lineWidth = 1.5; g.beginPath(); g.arc(bx, by, 3 + dt * 7, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(bx, by); g.lineTo(sx, sy); g.stroke(); });
    }
    function firePulse() {
      if (!S || L.reduced()) return; const M = S.sim.M, i = Math.round(M * [0.3, 0.72, 0.5][fireN++ % 3]), yi = S.sim.ys[clamp(i, 0, M - 1)];
      placeBody(); visible(yi); const vis = [], rr = [], echo = [null, null, null];
      for (let k = 0; k < nP; k++) if (vb[k] >= 0) { vis.push(k); rr.push(vr[k]); const o = SO[k]; if (!echo[o] || vr[k] < echo[o].r) echo[o] = { x: SX[k], y: SY[k], r: vr[k], obj: o }; }
      const ec = echo.filter(Boolean), tEnd = Math.min(T_VIEW[1], Math.max(8, ...ec.map((e) => (2 * e.r) / C)) + 1.6), dur = 4.2;
      pulse = { i: clamp(i, 0, M - 1), y: yi, T: 0, tau: 0, tEnd, dur, slow: dur / (tEnd * 1e-9), vis, r: rr, echo: ec };
    }
    fHero.onPointer((ev) => {
      if (!hv || !S) return; const wx = (ev.x - hv.ox) / hv.s, wy = (ev.y - hv.oy) / hv.s;
      const inside = wx > P.px + bodyBox[0] - 0.06 && wx < P.px + bodyBox[1] + 0.06 && wy > P.py + bodyBox[2] - 0.06 && wy < P.py + bodyBox[3] + 0.06;
      if (ev.type === 'down' && inside) { dragOff = [wx - P.px, wy - P.py]; quick = true; pulse = null; build = null; }
      if (ev.type === 'drag' && dragOff) { P.px = clamp(wx - dragOff[0], REC.x0 - bodyBox[0] + 0.08, 1.62); P.py = clamp(wy - dragOff[1], REC.y0 - bodyBox[2] + 0.04, REC.y0 + REC.h - bodyBox[3] - 0.04); recompute(); }
      if ((ev.type === 'up' || ev.type === 'leave') && dragOff) { dragOff = null; quick = false; recompute(); }
      if (nearBody !== inside) { nearBody = inside; if (!dragOff) fHero.redraw(); }
      fHero.canvas.style.cursor = dragOff ? 'grabbing' : inside ? 'grab' : 'default';
    });

    // ---------- the transient raster ----------
    fRas.draw = (g, w, hh) => {
      if (!S || !rasR) return; const M = S.sim.M, ys = S.sim.ys, stripW = Math.min(110, Math.max(70, w * 0.17));
      const B = L.pad(w, hh, { l: 46, t: 18, b: 34, r: stripW + 22 }), ya = AP_C - S.sim.len / 2, yb = AP_C + S.sim.len / 2;
      const yt = [2, 6, 10, 14, 18, 22], Pl = L.plot(g, B, { xd: [ya, yb], yd: [T_VIEW[1], T_VIEW[0]], yticks: yt, xlabel: 'position of the scan point along the wall, m', ylabel: 'time after the pulse, ns', grid: false, xfmt: (v) => v.toFixed(1) });
      g.imageSmoothingEnabled = false; g.drawImage(rasR.canvas, B.x, B.y, B.w, B.h); g.imageSmoothingEnabled = true;
      g.strokeStyle = T.line2; g.strokeRect(B.x + 0.5, B.y + 0.5, B.w - 1, B.h - 1);
      if (P.curves) { g.save(); g.beginPath(); g.rect(B.x, B.y, B.w, B.h); g.clip();
        S.sim.tArr.forEach((ta, o) => { g.strokeStyle = o === 0 ? T.person : L.rgba('text', 0.85); g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); let pen = false; for (let i = 0; i < M; i++) { if (!Number.isFinite(ta[i])) { pen = false; continue; } const px = Pl.X(ys[i]), py = Pl.Y(ta[i]) - 3; if (pen) g.lineTo(px, py); else g.moveTo(px, py); pen = true; } g.stroke(); });
        g.restore(); g.setLineDash([]);
        const at = [0.8, 0.14, 0.9]; S.sim.tArr.forEach((ta, o) => { let i = Math.round(at[o] * (M - 1)), n = 0; while (!Number.isFinite(ta[i]) && n++ < M) i = (i + 1) % M; if (!Number.isFinite(ta[i])) return; const px = Pl.X(ys[i]), py = Pl.Y(ta[i]) - 3, up = py - B.y > 40; L.callout(g, o === 0 ? 'first light from the person' : 'from the ' + NAMES[o], px, py, px + (o === 1 ? 16 : -18), py + (up ? -22 : 24), { color: o === 0 ? 'person' : 'text', dot: false }); }); }
      // one detector trace, beside the raster
      const ti = pulse ? pulse.i : rv?.hover ?? Math.round(M * 0.3), sx0 = B.x + B.w + 12, c = S.meas.counts, b0 = T_VIEW[0] / DT, nb = (T_VIEW[1] - T_VIEW[0]) / DT, grp = 4; let mx = 1;
      const tr = []; for (let q = 0; q + grp <= nb; q += grp) { let sum = 0; for (let k = 0; k < grp; k++) sum += c[ti * NT + ((b0 + q + k) | 0)]; tr.push(sum); if (sum > mx) mx = sum; }
      g.strokeStyle = T.line2; g.beginPath(); g.moveTo(sx0 + 0.5, B.y); g.lineTo(sx0 + 0.5, B.y + B.h); g.stroke();
      g.strokeStyle = T.text; g.lineWidth = 1; g.beginPath(); tr.forEach((v, q) => { const px = sx0 + 1 + (v / mx) * (stripW - 4), py = B.y + ((q + 0.5) / tr.length) * B.h; if (q) g.lineTo(px, py); else g.moveTo(px, py); }); g.stroke();
      L.text(g, 'one scan point', sx0, B.y - 6, { color: 'text2', size: 11 });
      L.text(g, '0', sx0 + 1, B.y + B.h + 15, { color: 'text3', size: 10.5, mono: true, weight: 400 }); L.text(g, String(mx), sx0 + stripW - 2, B.y + B.h + 15, { color: 'text3', size: 10.5, mono: true, weight: 400, align: 'right' });
      L.text(g, 'photons', sx0 + stripW - 2, B.y + B.h + 28, { color: 'text3', size: 11, align: 'right' });
      const cx = Pl.X(ys[ti]); g.strokeStyle = L.rgba('accent2', 0.9); g.lineWidth = 1; g.beginPath(); g.moveTo(cx, B.y - 5); g.lineTo(cx - 4, B.y - 11); g.lineTo(cx + 4, B.y - 11); g.closePath(); g.stroke(); g.setLineDash([2, 4]); g.beginPath(); g.moveTo(Math.round(cx) + 0.5, B.y); g.lineTo(Math.round(cx) + 0.5, B.y + B.h); g.stroke(); g.setLineDash([]);
      if (pulse && pulse.tau > T_VIEW[0]) { const py = Math.round(Pl.Y(Math.min(pulse.tau, T_VIEW[1]))) + 0.5; g.strokeStyle = T.accent2; g.beginPath(); g.moveTo(B.x, py); g.lineTo(sx0 + stripW, py); g.stroke(); L.text(g, pulse.tau.toFixed(1) + ' ns', B.x + 5, py - 5, { color: 'accent2', size: 10.5, mono: true, halo: true }); }
      rv = { ...rv, B, Pl };
    };
    fRas.onPointer((ev) => { if (!rv?.B || !S || pulse) return; const { B } = rv, M = S.sim.M; if (ev.type === 'leave') { if (rv.hover != null) { rv.hover = null; fRas.redraw(); } return; } if (ev.x < B.x || ev.x > B.x + B.w || ev.y < B.y || ev.y > B.y + B.h) return; const i = clamp(Math.floor(((ev.x - B.x) / B.w) * M), 0, M - 1); if (i !== rv.hover) { rv.hover = i; fRas.redraw(); } });

    // ---------- the sweep chart ----------
    fSw.draw = (g, w, hh) => {
      if (!S) return; const gap = 20, B0 = L.pad(w, hh, { l: 50, t: 18, b: 34, r: 16 }), h1 = Math.round((B0.h - gap) * 0.6), Ba = { ...B0, h: h1 }, Bb = { ...B0, y: B0.y + h1 + gap, h: B0.h - h1 - gap };
      const xt = [20, 50, 100, 200, 400, 800], xd = [17, 940], z = XW - S.est.x;
      const Pa = L.plot(g, Ba, { xd, yd: [0.3, 300], xlog: true, ylog: true, xticks: xt, yticks: [1, 10, 100], xfmt: () => '', ylabel: 'distance from truth, cm' });
      const Pb = L.plot(g, Bb, { xd, yd: [0, 1], xlog: true, xticks: xt, yticks: [0, 0.5, 1], xlabel: 'time resolution of the detector, ps', ylabel: 'match with truth' });
      const js = [], la = []; for (let j = 17; j <= 940; j *= 1.12) { js.push(j); la.push(resLat(j, z, P.len) * 100); }
      L.trace(g, Pa, js, la, { color: 'text2', dash: [4, 3], width: 1.25 });
      const li = js.findIndex((j) => j > 330); L.text(g, 'predicted blur across', Pa.X(js[li]) - 14, Pa.Y(la[li]) + 18, { color: 'text2', size: 10.5, align: 'left', halo: true });
      L.rule(g, Pa, { y: 10, color: 'warn', label: 'off the body beyond 10 cm' });
      for (const [Pp, arr, sc] of [[Pa, SW.err, 100], [Pb, SW.ncc, 1]]) { const xs = [], ms = []; g.strokeStyle = L.rgba('accent', 0.45); g.lineWidth = 1; g.beginPath();
        arr.forEach((a, j) => { if (!a.length) return; const lo = Math.max(Math.min(...a) * sc, Pp === Pa ? 0.3 : 0), hi = Math.min(Math.max(...a) * sc, Pp === Pa ? 300 : 1), px = Math.round(Pp.X(SWEEP_J[j])) + 0.5; g.moveTo(px, Pp.Y(lo)); g.lineTo(px, Pp.Y(hi)); xs.push(SWEEP_J[j]); ms.push(clamp(med(a) * sc, Pp === Pa ? 0.3 : 0, Pp === Pa ? 300 : 1)); });
        g.stroke(); L.trace(g, Pp, xs, ms, { color: 'accent', width: 1.5 }); L.dots(g, Pp, xs, ms, { color: 'accent', r: 2.5 }); }
      // the current setting, from the full-resolution picture on the left
      const px = Math.round(Pa.X(P.jit)) + 0.5; g.strokeStyle = L.rgba('text', 0.7); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(px, Ba.y); g.lineTo(px, Bb.y + Bb.h); g.stroke(); g.setLineDash([]);
      const right = P.jit < 300; L.text(g, 'now: ' + Math.round(P.jit) + ' ps', px + (right ? 6 : -6), Ba.y + 10, { color: 'text', size: 10.5, align: right ? 'left' : 'right', halo: true });
      g.fillStyle = T.bg0; g.strokeStyle = T.text; g.lineWidth = 1.5; for (const [Pp, v] of [[Pa, clamp(S.err * 100, 0.3, 300)], [Pb, clamp(S.ncc)]]) { g.beginPath(); g.arc(px, Pp.Y(v), 4, 0, TAU); g.fill(); g.stroke(); }
    };

    // ---------- readouts and titles ----------
    const sErr = L.stat('person located to', { unit: 'cm' }), sLat = L.stat('predicted blur across', { unit: 'cm' }), sAx = L.stat('predicted blur in depth', { unit: 'cm' }), sPh = L.stat('photons detected'), sNcc = L.stat('match with truth', { hint: 'Correlation between the picture and the surfaces light from the wall can reach, 0 to 1.' });
    readout.append(L.h('h4', null, 'Measured against the simulated truth'), sErr.el, sNcc.el, sLat.el, sAx.el, sPh.el);
    function report() {
      const e = S.err, good = e <= 0.1, frac = S.meas.total ? S.meas.signal / S.meas.total : 0;
      sErr.set(fmtCm(e)); sErr.tone(good ? 'ok' : e <= 0.25 ? 'warn' : 'danger'); sNcc.set(S.ncc.toFixed(2)); sNcc.tone(S.ncc > 0.5 ? 'ok' : S.ncc > 0.25 ? 'warn' : 'danger');
      sLat.set(fmtCm(S.lat)); sAx.set(fmtCm(S.ax)); sPh.set(fmtN(S.meas.total), 'photons detected, ' + L.pct(frac) + ' % from the hidden room');
      fHero.setTitle(good ? 'Around the corner, the person is placed ' + fmtCm(e) + ' cm from the simulated truth, using ' + fmtN(S.meas.signal) + ' photons that made the round trip'
        : e <= 0.25 ? 'The picture is blurring: the estimate is ' + fmtCm(e) + ' cm from where the person really is'
        : 'At these settings the search lands on ' + S.on + ', ' + fmtCm(e) + ' cm from the person');
      fHero.setNote('Plan view, one slice at floor height; an invented room. The picture inside the dotted frame is computed from the noisy photon counts alone, by ' + (P.method === 'fk' ? 'f-k migration' : 'filtered backprojection') + ' on a ' + (S.cell * 1000).toFixed(0) + ' mm grid. Only the side of each object that faces the wall comes back. Room walls are left out of the echo (assumed gated out).');
      fRas.setTitle('Each hidden surface draws one curved streak: ' + S.sim.M + ' scan points, ' + fmtN(S.meas.total / S.sim.M) + ' photons each, blurred by ' + Math.round(P.jit) + ' ps');
      fRas.setNote('Photon counts, simulated: square-root colour scale, 16 ps bins (assumed). The top of a streak is the nearest point of that surface; its curve gives the depth. Hover to read one scan point.');
    }

    // ---------- controls ----------
    const any = (fn) => (v) => { fn(v); recompute(); };
    const fire = () => { P.seed++; compute(); if (L.reduced()) return; if (P.method === 'bp') { const f = filterBP(S.meas.counts, S.sim.M, P.jit, CELL), G = S.rec.G; build = { i: 0, f, acc: new Float32Array(G.gx * G.gy), tmp: new Float32Array(G.gx * G.gy), G, peak: S.rec.peak, carry: 0 }; paintRec(build.acc, G); } firePulse(); redrawAll(); };
    controls.append(
      L.slider({ label: 'Time resolution of the detector', min: 1.3, max: 2.905, step: 0.005, value: Math.log10(P.jit), unit: 'ps', format: (v) => String(Math.round(10 ** v)), hint: 'Full width at half maximum of the timing jitter. Published single-photon systems report about 60 ps; a streak camera reaches 2 ps.', onInput: any((v) => { P.jit = 10 ** v; }) }).el,
      L.slider({ label: 'Scan points along the wall', min: 8, max: 128, step: 4, value: P.M, onInput: any((v) => { P.M = v; }) }).el,
      L.slider({ label: 'Photons per scan point (exposure)', min: 1.5, max: 5, step: 0.05, value: Math.log10(P.ph), format: (v) => fmtN(10 ** v), hint: 'Mean photons returning from the hidden room at each scan point. Assumed: no published budget for a person.', onInput: any((v) => { P.ph = 10 ** v; }) }).el,
      L.slider({ label: 'Length of wall scanned', min: 0.4, max: 2.4, step: 0.1, value: P.len, unit: 'm', format: (v) => v.toFixed(1), hint: 'The published room-sized scans cover 2 m of wall.', onInput: any((v) => { P.len = v; }) }).el,
      L.slider({ label: 'Ambient light and dark counts', min: 1, max: 5.5, step: 0.05, value: Math.log10(P.amb), format: (v) => fmtN(10 ** v) + ' per point', hint: 'Counts at each scan point that did not come from the pulse.', onInput: any((v) => { P.amb = 10 ** v; }) }).el,
      L.seg({ label: 'Reconstruction', value: P.method, options: [{ value: 'bp', label: 'Filtered backprojection', hint: 'Smear every time bin back over the circle of places it could have come from.' }, { value: 'fk', label: 'f-k migration', hint: 'Treat the echoes as a wave field and run it backwards in the frequency domain (Lindell et al. 2019).' }], onChange: any((v) => { P.method = v; }) }).el,
      L.toggle({ label: 'Show the true arrival times', value: P.curves, onChange: (v) => { P.curves = v; fRas.redraw(); } }).el,
      L.row(L.button({ label: 'Fire again', icon: 'reset', primary: true, hint: 'A new draw of photon noise, and one pulse in slow motion.', onClick: fire })));

    // ---------- animation ----------
    const anim = L.loop((dt, t) => {
      let dirty = false;
      if (pulse) { pulse.T += dt; pulse.tau = pulse.T > 0.35 ? ((pulse.T - 0.35) / pulse.dur) * pulse.tEnd : 0; if (pulse.tau >= pulse.tEnd) { pulse = null; nextAuto = t + 9; } dirty = true; }
      if (build) { build.carry += dt * (S.sim.M / 2.6); const n = Math.min(S.sim.M - build.i, build.carry | 0);
        if (n > 0) { build.carry -= n; backproject(build.f, S.sim.ys, build.i, build.i + n, build.acc, build.G); build.i += n; const a = build.acc, m = build.tmp, g = 1 / build.peak; for (let q = 0; q < a.length; q++) m[q] = a[q] > 0 ? a[q] * g : 0; paintRec(m, build.G); }
        if (build.i >= S.sim.M) { build = null; paintRec(S.rec.img, S.rec.G); } dirty = true; }
      if (!pulse && !build && !dragOff && S && nextAuto && t > nextAuto) { nextAuto = 0; firePulse(); }
      if (dirty) { fHero.redraw(); fRas.redraw(); }
    });

    compute();
    return {
      start() { shown = true; if (S && SW.n < SWEEP_J.length * SWEEP_SEEDS) { cancelAnimationFrame(SW.id); SW.id = requestAnimationFrame(sweepTick); } redrawAll(); if (!L.reduced()) { if (!pulse) firePulse(); anim.start(); } },
      stop() { shown = false; anim.stop(); cancelAnimationFrame(SW.id); pulse = null; if (build) { build = null; if (S) paintRec(S.rec.img, S.rec.G); } },
    };
  },
};
