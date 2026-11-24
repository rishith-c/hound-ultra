// Exhibit 6. Hearing the shape of a void: one chirp, four microphones, and the walls come back as echoes.
// Forward model: image sources up to second order inside the void's polygon, frequency-flat walls, a soft scatterer for
// the person, microphone noise. Inverse: matched filter, echo peaks, then echo sorting: a set of peaks, one per
// microphone, is a wall only if one image point explains all of them (the Euclidean-distance idea of Dokmanic et al.).
import { WORLD } from './model.js';
import * as L from './lib.js';

const C = 343, FS = 96000, N = 8192;                // m/s, samples a second, samples (85 ms)
const F0 = 2000, F1 = 18000, TC = 0.006;            // the chirp: hertz, hertz, seconds
const R_WALL = 0.82, MICR = 0.16;                   // reflection, microphone offset m (assumed)

export default function create(env) {
  const { h } = env, ui = env.ui;
  const P = { void: 'A', noise: 0.02, t: 1, playing: false, person: true };
  let pile, poly, src = { x: 0, z: 0 }, mics = [], rec = [], env_ = [], truthW = [], found = [], imgs = [], outline = null, M = {}, drag = false, peaks = [];

  const V = () => pile.voids.find((v) => v.id === P.void);
  function setPile(p) { pile = p; place(); P.t = 1; P.playing = false; }
  function place() { const v = V(); poly = v.poly.map((q) => [q[0], q[1]]); const t = P.void === 'A' ? [0.2, 0.32] : [0.42, 0.45]; let lo = [1e9, 1e9], hi = [-1e9, -1e9]; for (const q of poly) { lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])]; hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])]; } src = { x: lo[0] + (hi[0] - lo[0]) * t[0], z: lo[1] + (hi[1] - lo[1]) * t[1] }; listen(); }
  const edges = () => { let cx = 0, cz = 0; for (const q of poly) { cx += q[0] / poly.length; cz += q[1] / poly.length; } return poly.map((a, i) => { const b = poly[(i + 1) % poly.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); let nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l; if (nx * (cx - a[0]) + nz * (cz - a[1]) < 0) { nx = -nx; nz = -nz; } return { a, b, l, nx, nz, d: nx * a[0] + nz * a[1] }; }); };
  const mirror = (p, e) => { const s = 2 * (e.nx * p.x + e.nz * p.z - e.d); return { x: p.x - s * e.nx, z: p.z - s * e.nz }; };
  const hits = (p, m, e) => { const u0 = e.nx * p.x + e.nz * p.z - e.d, u1 = e.nx * m.x + e.nz * m.z - e.d; if (u0 * u1 >= 0) return null; const u = u0 / (u0 - u1), x = p.x + (m.x - p.x) * u, z = p.z + (m.z - p.z) * u, k = ((x - e.a[0]) * (e.b[0] - e.a[0]) + (z - e.a[1]) * (e.b[1] - e.a[1])) / (e.l * e.l); return k >= 0 && k <= 1 ? { x, z } : null; };
  function listen() {
    const E = edges(); mics = [[1, 0.2], [-0.3, 1], [-0.9, -0.45], [0.35, -0.95]].map(([a, b]) => ({ x: src.x + a * MICR, z: src.z + b * MICR }));
    truthW = E; const paths = []; imgs = [];
    E.forEach((e, i) => { const p = mirror(src, e); imgs.push({ ...p, i }); paths.push({ p, g: R_WALL, chk: (m) => hits(p, m, e) });
      E.forEach((f, j) => { if (j === i) return; const q = mirror(p, f); paths.push({ p: q, g: R_WALL * R_WALL, chk: (m) => { const b = hits(q, m, f); return b && hits(p, b, e); } }); }); });
    const r = L.rng(pile.seed * 271 + 5 + (P.void === 'A' ? 0 : 9)), chirp = []; for (let k = 0; k < TC * FS; k++) { const t = k / FS, w = Math.sin(Math.PI * t / TC) ** 2; chirp.push(w * Math.sin(2 * Math.PI * (F0 * t + (F1 - F0) * t * t / (2 * TC)))); }
    const nf = 16384, CF = [new Float64Array(nf), new Float64Array(nf)]; chirp.forEach((v, k) => { CF[0][k] = v; }); L.fft(CF[0], CF[1]);
    rec = mics.map((m) => {
      const y = new Float64Array(nf), im = new Float64Array(nf), add = (d, g) => { const s = d / C * FS, k = Math.floor(s), u = s - k; if (k + 1 < N) { y[k] += g * (1 - u); y[k + 1] += g * u; } };
      for (const q of paths) if (q.chk(m)) { const d = Math.hypot(q.p.x - m.x, q.p.z - m.z); add(d, q.g / (d + 0.2)); }
      if (P.void === 'A' && P.person) for (const b of [pile.person.head, ...pile.person.parts]) { const d = Math.hypot(b[0] - src.x, b[1] - src.z) + Math.hypot(b[0] - m.x, b[1] - m.z); add(d, 0.05 / (d + 0.2)); }
      L.fft(y, im); for (let k = 0; k < nf; k++) { const a = y[k] * CF[0][k] - im[k] * CF[1][k], b = y[k] * CF[1][k] + im[k] * CF[0][k]; y[k] = a; im[k] = b; } L.fft(y, im, true);
      for (let k = 0; k < nf; k++) { y[k] += P.noise * r.gauss(); im[k] = 0; }
      const raw = Float32Array.from(y.subarray(0, N)); // what the microphone heard
      L.fft(y, im); for (let k = 0; k < nf; k++) { const a = y[k] * CF[0][k] + im[k] * CF[1][k], b = im[k] * CF[0][k] - y[k] * CF[1][k], pos = k === 0 ? 1 : k < nf / 2 ? 2 : 0; y[k] = a * pos; im[k] = b * pos; } L.fft(y, im, true); // matched filter, as an envelope
      const e = new Float32Array(N); for (let k = 0; k < N; k++) e[k] = Math.hypot(y[k], im[k]) / 144; return { raw, e };
    });
    locate();
  }
  function locate() {
    peaks = rec.map((q) => { const out = [], sd = [...q.e].sort((a, b) => a - b)[N >> 1] + 1e-9; for (let k = 40; k < 4600; k++) { const v = q.e[k]; if (v > 6 * sd && v > 0.03 && v >= q.e[k - 1] && v > q.e[k + 1] && v >= Math.max(...q.e.subarray(k - 14, k + 15))) { const d = (q.e[k - 1] - q.e[k + 1]) / (2 * (q.e[k - 1] - 2 * v + q.e[k + 1]) || 1); out.push({ d: (k + d) / FS * C, v }); } } return out.sort((a, b) => b.v - a.v).slice(0, 14); });
    // echo sorting: try every set of peaks whose spread could fit the array, keep the ones a single image point explains
    const cand = []; const [p0, p1, p2, p3] = peaks, span = 2 * MICR + 0.03;
    for (const a of p0) for (const b of p1) { if (Math.abs(a.d - b.d) > span) continue; for (const c of p2) { if (Math.abs(a.d - c.d) > span) continue; for (const d of p3) { if (Math.abs(a.d - d.d) > span) continue;
      const D = [a.d, b.d, c.d, d.d]; let sx = 0, sz = 0; // direction from the differences, then Gauss-Newton on the image point
      for (let i = 0; i < 4; i++) { sx += (D[0] - D[i]) * (mics[i].x - mics[0].x); sz += (D[0] - D[i]) * (mics[i].z - mics[0].z); }
      const l = Math.hypot(sx, sz) || 1, dm = (D[0] + D[1] + D[2] + D[3]) / 4; let x = src.x + sx / l * dm, z = src.z + sz / l * dm, res = 0;
      for (let it = 0; it < 6; it++) { let h11 = 1e-6, h12 = 0, h22 = 1e-6, g1 = 0, g2 = 0; res = 0; for (let i = 0; i < 4; i++) { const ux = x - mics[i].x, uz = z - mics[i].z, rr = Math.hypot(ux, uz) + 1e-9, e = D[i] - rr, jx = ux / rr, jz = uz / rr; h11 += jx * jx; h12 += jx * jz; h22 += jz * jz; g1 += jx * e; g2 += jz * e; res += e * e; } const det = h11 * h22 - h12 * h12; x += (h22 * g1 - h12 * g2) / det; z += (h11 * g2 - h12 * g1) / det; }
      res = Math.sqrt(res / 4); if (res < 0.006) cand.push({ x, z, res, v: (a.v + b.v + c.v + d.v) / 4, d: dm }); } } }
    cand.sort((a, b) => a.d - b.d); found = []; outline = box();
    for (const q of cand) { // nearest first: a wall must still cut the room found so far, and not be an echo of an echo
      const dx = src.x - q.x, dz = src.z - q.z, l = Math.hypot(dx, dz); if (l < 0.2) continue; const w = { nx: dx / l, nz: dz / l, mx: (src.x + q.x) / 2, mz: (src.z + q.z) / 2, dist: l / 2, res: q.res, v: q.v, x: q.x, z: q.z }; w.d = w.nx * w.mx + w.nz * w.mz;
      if (found.some((f) => Math.hypot(f.x - q.x, f.z - q.z) < 0.25)) continue;
      let second = false; for (const f of found) for (const g of found) if (f !== g) { const p = mirror({ x: f.x, z: f.z }, g); if (Math.hypot(p.x - q.x, p.z - q.z) < 0.2) second = true; } if (second) continue;
      const cut = clip(outline, w); if (area(outline) - area(cut) < 0.05 * area(cut) || area(cut) < 0.3) continue;
      const base = found.length ? Math.max(...found.map((f) => f.v * f.dist)) : 0; if (q.v * l / 2 < 0.3 * base) continue;
      found.push(w); outline = cut;
    }
    M = { walls: truthW.map((e) => { const td = Math.abs(e.nx * src.x + e.nz * src.z - e.d); let b = null; for (const f of found) { const dot = f.nx * e.nx + f.nz * e.nz, er = Math.abs(f.dist - td); if (dot > 0.95 && er < 0.4 && (!b || er < b.er)) b = { er, f, ang: Math.acos(Math.min(1, dot)) * 57.3 }; } return { e, td, m: b }; }), area: area(outline), true: area(poly) };
    M.hit = M.walls.filter((w) => w.m).length; M.err = M.hit ? M.walls.reduce((a, w) => a + (w.m ? w.m.er : 0), 0) / M.hit : NaN; M.extra = found.length - new Set(M.walls.filter((w) => w.m).map((w) => w.m.f)).size;
    M.iou = iou();
  }
  const box = () => [[src.x - 6, src.z - 5], [src.x + 6, src.z - 5], [src.x + 6, src.z + 5], [src.x - 6, src.z + 5]];
  const area = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a / 2); };
  function clip(p, w) { const out = []; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], sa = w.nx * a[0] + w.nz * a[1] - w.d, sb = w.nx * b[0] + w.nz * b[1] - w.d; if (sa >= 0) out.push(a); if (sa * sb < 0) { const u = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); } } return out; }
  function iou() { let a = 0, b = 0; const v = V(); for (let x = src.x - 5; x < src.x + 5; x += 0.06) for (let z = src.z - 4; z < src.z + 4; z += 0.06) { const t = pile.inPoly(v.poly, x, z), f = outline.length > 2 && pile.inPoly(outline, x, z); if (t && f) a++; if (t || f) b++; } return b ? a / b : 0; }
  function controls() {
    const go = ui.button({ label: 'Chirp', ico: 'play', primary: true, title: 'Send one chirp and watch the echoes come back', onclick: () => { P.t = 0; P.playing = true; } });
    const vs = ui.seg({ label: 'Which void', value: P.void, options: [{ v: 'A', l: 'Lean-to (A)' }, { v: 'B', l: 'V-shape (B)' }, { v: 'D', l: 'Cellar (D)' }], onchange: (v) => { P.void = v; place(); env.refresh(); } });
    const ns = ui.slider({ label: 'Background noise at the microphones', min: 0, max: 100, value: P.noise * 100, fmt: (v) => v + ' %', hint: 'Against the loudness of the chirp.', oninput: (v) => { P.noise = v / 100; listen(); env.refresh(); } });
    return h('div.ds-controls', null, h('div.ds-row', null, go), vs, ns, h('p.ds-hint', null, 'Drag the probe around inside the void.'));
  }
  const TMAX = 0.032;
  function tick(dt) { if (!P.playing) return false; if (env.reduced()) { P.t = 1; P.playing = false; env.refresh(); return false; } P.t = Math.min(1, P.t + dt / 5); if (P.t >= 1) { P.playing = false; env.refresh(); } return true; }
  function trace(c, S, p) { c.beginPath(); p.forEach((q, i) => { if (i) c.lineTo(S.X(q[0]), S.Z(q[1])); else c.moveTo(S.X(q[0]), S.Z(q[1])); }); c.closePath(); }
  function drawStage(S) {
    const { c } = S, done = P.t >= 1, rad = P.t * TMAX * C;
    c.save();
    if (!done) { c.save(); trace(c, S, poly); c.clip(); const ring = (x, z, a) => { c.beginPath(); c.arc(S.X(x), S.Z(z), rad * S.s, 0, 6.2832); c.strokeStyle = L.col('--accent', a); c.lineWidth = 2; c.stroke(); }; ring(src.x, src.z, 0.95); for (const p of imgs) ring(p.x, p.z, 0.6); c.restore(); }
    if (done && outline.length > 2) { trace(c, S, outline); c.fillStyle = L.col('--accent', 0.14); c.fill(); c.strokeStyle = L.tok('--accent'); c.lineWidth = S.thumb ? 1.25 : 2; c.stroke();
      if (!S.thumb) for (const f of found) { const x = src.x - f.nx * f.dist, z = src.z - f.nz * f.dist; c.setLineDash([3, 4]); c.strokeStyle = L.col('--accent', 0.5); c.lineWidth = 1; c.beginPath(); c.moveTo(S.X(src.x), S.Z(src.z)); c.lineTo(S.X(x), S.Z(z)); c.stroke(); c.setLineDash([]); L.tagLabel(c, S.X((src.x + x) / 2), S.Z((src.z + z) / 2), f.dist.toFixed(2) + ' m', { dx: 8, dy: 0, color: '--text' }); } }
    c.fillStyle = L.tok('--text'); c.beginPath(); c.arc(S.X(src.x), S.Z(src.z), S.thumb ? 2 : 4, 0, 6.283); c.fill(); if (!S.thumb) for (const m of mics) { c.fillStyle = L.tok('--accent'); c.beginPath(); c.arc(S.X(m.x), S.Z(m.z), 3, 0, 6.283); c.fill(); }
    c.restore();
  }
  function drawReadout(R) {
    const { c, w, h: hh } = R, l = 46, r = w - 16, n = rec.length, top = 14, bot = hh - 34, rh = (bot - top) / n, DM = 11, X = (d) => l + d / DM * (r - l), now = P.t * TMAX * C;
    c.save(); c.font = L.font(11); for (let d = 0; d <= DM; d += 1) { const x = Math.round(X(d)) + 0.5; c.strokeStyle = L.col('--line', 1); c.lineWidth = 1; c.beginPath(); c.moveTo(x, top); c.lineTo(x, bot); c.stroke(); c.fillStyle = L.tok('--text-3'); c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(d + (d ? '' : ' m'), x, bot + 4); }
    c.fillText('distance the sound travelled', (l + r) / 2, bot + 18); let mx = 0; for (const q of rec) for (let k = 60; k < 3200; k++) mx = Math.max(mx, q.e[k]);
    rec.forEach((q, i) => { const y0 = top + (i + 1) * rh - 4; c.beginPath(); c.moveTo(l, y0); for (let k = 0; k < DM / C * FS; k++) { const d = k / FS * C; if (d > now) break; c.lineTo(X(d), y0 - q.e[k] / mx * (rh - 10)); } const last = Math.min(DM, now); c.lineTo(X(last), y0); c.closePath(); c.fillStyle = L.col('--accent', 0.2); c.fill(); c.strokeStyle = L.col('--accent', 0.95); c.lineWidth = 1; c.stroke();
      c.fillStyle = L.tok('--text-2'); c.font = L.font(11, 600); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('Mic ' + (i + 1), 4, y0 - rh / 2 + 6);
      for (const f of found) { const d = Math.hypot(f.x - mics[i].x, f.z - mics[i].z); if (d > now) continue; c.fillStyle = L.tok('--text'); c.beginPath(); c.moveTo(X(d) - 4, y0 + 4); c.lineTo(X(d) + 4, y0 + 4); c.lineTo(X(d), y0 - 2); c.fill(); }
      if (R.truth) for (const p of imgs) { const d = Math.hypot(p.x - mics[i].x, p.z - mics[i].z); if (d > now) continue; c.strokeStyle = L.col('--warn', 0.8); c.setLineDash([2, 3]); c.beginPath(); c.moveTo(X(d), y0); c.lineTo(X(d), y0 - rh + 8); c.stroke(); c.setLineDash([]); } });
    c.restore();
  }
  function pointer(kind, p) { if (kind === 'hover') return Math.hypot(src.x - p.x, src.z - p.z) < 0.4; if (kind === 'down') return (drag = Math.hypot(src.x - p.x, src.z - p.z) < 0.4); if (kind === 'move' && drag && p.x !== undefined) { let ok = pile.inPoly(poly, p.x, p.z); for (const e of truthW) if (e.nx * p.x + e.nz * p.z - e.d < 0.25) ok = false; if (ok) { src = { x: p.x, z: p.z }; P.t = 1; listen(); } } if (kind === 'up') drag = false; return true; }
  function view() { const v = V(); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const q of v.poly) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); } return { x0: x0 - 1.4, x1: x1 + 1.4, z0: z0 - 0.7, z1: z1 + 0.8 }; }
  function verdicts() { const out = {}; for (const v of pile.voids) out[v.id] = v.id === P.void ? { state: M.hit >= Math.min(3, M.walls.length) ? 'seen' : M.hit >= 2 ? 'hint' : 'missed', text: M.hit + ' of ' + M.walls.length + ' walls', why: 'A wall counts when its distance is within 0.4 m and its angle within 18 degrees of the truth.' } : { state: 'na', text: 'not inside it', why: 'The probe must already be inside the void.' }; out.person = { state: 'na', text: 'too soft', why: 'A person scatters a weak echo that this method does not use.' }; return out; }
  return {
    title: 'Hearing the shape of a void', hardware: 'A speaker and four microphones on a probe. The parts are ordinary; the probe is a concept.',
    lede: 'Clap in a room and the walls answer, each after the time sound takes to reach it and come back. With four microphones the echoes can be sorted into walls, and the walls draw the room.',
    honest: 'the probe has to be inside the void first, the walls here are flat and the section is closed, and real rubble is rough, leaky and full of furniture. Whether sorting still works on broken concrete is unknown.',
    assumed: 'Assumed: sound at 343 m/s, walls reflect 82 % of the pressure, four microphones 0.16 m from the speaker, a 2 to 18 kHz chirp, echoes up to second order, a convex void.',
    sources: [{ who: 'Dokmanić et al., PNAS 110 (2013).', what: 'Acoustic echoes reveal room shape: the echo-sorting idea used here.', url: 'https://doi.org/10.1073/pnas.1221464110' }],
    setPile, controls, drawStage, drawReadout, tick, verdicts, pointer, view, hideLabels: true,
    _demo: () => ({ src, mics, imgs, found, outline, poly, M, P, rec, peaks }),
    stageTitle: () => (P.t < 1 ? 'A chirp and its echoes' : 'The room, drawn from its echoes'), stageNote: () => (P.t < 1 ? (P.t * TMAX * 1000).toFixed(0) + ' ms after the chirp, slowed 160 times' : 'void ' + P.void + ' · overlap with the truth ' + (M.iou * 100).toFixed(0) + ' %'),
    readoutTitle: () => ['Each wall is a spike at every microphone', 'Matched-filter output. White marks: echoes sorted into walls. Amber: where the true first echoes are.'],
    results: () => [
      { k: 'Walls recovered', v: M.hit + ' of ' + M.walls.length, sub: M.extra ? M.extra + ' false wall' + (M.extra > 1 ? 's' : '') : 'no false walls', tone: M.hit >= 3 && !M.extra ? 'ok' : M.hit >= 2 ? 'warn' : 'bad' },
      { k: 'Distance error', v: isNaN(M.err) ? 'none found' : (M.err * 100).toFixed(1) + ' cm', sub: 'average over those walls', tone: M.err < 0.05 ? 'ok' : 'warn' },
      { k: 'Area heard', v: M.area > 30 ? 'open' : M.area.toFixed(1) + ' m²', sub: 'true ' + M.true.toFixed(1) + ' m²' },
      { k: 'Overlap with truth', v: (M.iou * 100).toFixed(0) + ' %', sub: 'shared area ÷ combined area', tone: M.iou > 0.8 ? 'ok' : M.iou > 0.5 ? 'warn' : 'bad' },
    ],
    row: { sees: 'The size and shape of the space the probe is in.', range: 'One room', time: 'A tenth of a second', cost: 'Low', costNote: 'speaker and microphones', ready: 2, readyNote: 'Shown in real rooms in research. Not in rubble.' },
    summary: () => M.hit + ' of ' + M.walls.length + ' walls of void ' + P.void + ', overlap ' + (M.iou * 100).toFixed(0) + ' %',
  };
}
