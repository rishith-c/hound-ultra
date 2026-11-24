// Satellites that see millimetres: radar interferometry and damage proxy maps, on the real terrain around Timure.
// Everything is computed here: three simulated radar images (complex speckle with the right statistics), the
// interferogram, the coherence estimate, phase unwrapping, and the comparison with the simulated ground truth.
import * as L from '../lib.js';
const { TAU, clamp } = L;
const N = 256, BLOCK = { z: 14, x0: 12075, y0: 6849, n: 4 }, SITE = { lon: 85.36667, lat: 28.25285 };
const BANDS = { X: { lam: 0.031, name: 'X band, 3.1 cm' }, C: { lam: 0.0555, name: 'C band, 5.6 cm' }, L: { lam: 0.236, name: 'L band, 23.6 cm' } };
const INC = (39 * Math.PI) / 180;

async function loadDem() {
  try {
    const res = await fetch(new URL('../../area/data/dem512.bin', import.meta.url)); if (!res.ok) throw new Error('no file');
    const raw = new Uint16Array(await res.arrayBuffer()); if (raw.length !== 512 * 512) throw new Error('unexpected size');
    const z = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = 2 * j * 512 + 2 * i; z[j * N + i] = (raw[k] + raw[k + 1] + raw[k + 512] + raw[k + 513]) / 40; }
    return { z, real: true };
  } catch { // no elevation file: an invented valley, and the figure says so
    const R = L.rng(5), z = new Float32Array(N * N), c = Array.from({ length: 81 }, () => R());
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const u = (i / N) * 8, v = (j / N) * 8, a = u | 0, b = v | 0, fu = L.smooth(u - a), fv = L.smooth(v - b); const n = L.lerp(L.lerp(c[b * 9 + a], c[b * 9 + a + 1], fu), L.lerp(c[b * 9 + 9 + a], c[b * 9 + 10 + a], fu), fv); z[j * N + i] = 1600 + 1900 * Math.abs(i / N - 0.5 - 0.15 * Math.sin(j / 40)) * 2 + 500 * n; }
    return { z, real: false };
  }
}
function boxMean(src, r) { // separable (2r+1) square mean, edges clamped
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N), w = 2 * r + 1;
  for (let j = 0; j < N; j++) { let s = 0; for (let i = -r; i <= r; i++) s += src[j * N + clamp(i, 0, N - 1)]; for (let i = 0; i < N; i++) { tmp[j * N + i] = s / w; s += src[j * N + Math.min(N - 1, i + r + 1)] - src[j * N + Math.max(0, i - r)]; } }
  for (let i = 0; i < N; i++) { let s = 0; for (let j = -r; j <= r; j++) s += tmp[clamp(j, 0, N - 1) * N + i]; for (let j = 0; j < N; j++) { out[j * N + i] = s / w; s += tmp[Math.min(N - 1, j + r + 1) * N + i] - tmp[Math.max(0, j - r) * N + i]; } }
  return out;
}
function smoothNoise(R, cells, amp) { // bilinear value noise on a coarse lattice
  const m = cells + 2, c = Float32Array.from({ length: m * m }, () => R.n()), out = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const u = (i / N) * cells, v = (j / N) * cells, a = u | 0, b = v | 0, fu = L.smooth(u - a), fv = L.smooth(v - b); out[j * N + i] = amp * L.lerp(L.lerp(c[b * m + a], c[b * m + a + 1], fu), L.lerp(c[b * m + m + a], c[b * m + m + a + 1], fu), fv); }
  return out;
}

export default {
  id: 'insar', title: 'Satellites that see millimetres', short: 'InSAR',
  readiness: 2.85, readinessNote: 'Damage proxy maps from radar satellites are produced after real earthquakes and handed to responders. HOUND does not make them.',
  standoff: [5e5, 8e5],
  labels: ['concept', 'live-algo'],
  labelNote: 'The radar images are simulated on the real elevation of the valley. The block, the damage, the air and the ground motion are invented, and the scatterer motion, noise and damage levels are assumed values that we tuned until the unwrapping worked. The interferometry, the unwrapping and the damage map are computed in this page.',
  sentences: [
    'A radar satellite about 700 km up measures its distance to the ground on two passes; the difference shows the ground moving by centimetres, as coloured fringes.',
    'Where buildings have collapsed, the echo stops matching itself between passes, and that loss of coherence is how damage proxy maps are drawn in the days after a real earthquake.',
  ],
  needs: 'A pass before and a pass after on the same orbit track, and ground that still looks the same to the radar. Forest, snow and steep slopes that fold over in the radar image (all three are in this valley) break that.',
  unknown: 'Whether a map with pixels tens of metres wide, arriving a day or more later, can steer a team to one building rather than one neighbourhood. Here the blocks, the damage and the ground shift are all invented.',
  sources: [
    { who: 'Yun et al., NASA JPL and Caltech', year: 2015, title: 'Rapid damage mapping for the 2015 Mw 7.8 Gorkha earthquake using synthetic aperture radar data from COSMO-SkyMed and ALOS-2 satellites', where: 'Seismological Research Letters 86(6)', url: 'https://doi.org/10.1785/0220150152' },
    { who: 'Massonnet et al.', year: 1993, title: 'The displacement field of the Landers earthquake mapped by radar interferometry', where: 'Nature 364', url: 'https://doi.org/10.1038/364138a0' },
  ],
  glyph(g, s, t) { for (let k = 0; k < 4; k++) { const r = ((k + (t * 0.25) % 1) / 4) * s * 0.52; g.globalAlpha = 1 - r / (s * 0.52); g.beginPath(); g.ellipse(-2, 1, r * 1.15, r * 0.8, -0.5, 0, TAU); g.stroke(); } g.globalAlpha = 1; },

  create({ stage, controls, readout }) {
    L.layout(stage, { cols: 'minmax(0, 1.22fr) minmax(0, 1fr)', rows: '1fr 1fr', areas: ['map profile', 'map blocks'] });
    const fMap = L.figure({ area: 'map', title: 'Loading the elevation of the valley…' });
    const fPro = L.figure({ area: 'profile', title: 'Recovered ground shift against the truth' });
    const fBlk = L.figure({ area: 'blocks', title: 'Damaged blocks lose coherence' });
    stage.append(fMap.el, fPro.el, fBlk.el);
    fPro.legend([{ label: 'simulated truth', color: 'text2', kind: 'dash' }, { label: 'recovered from the fringes', color: 'accent', kind: 'line' }]);
    fBlk.legend([{ label: 'damaged (truth)', color: 'danger', kind: 'dot' }, { label: 'intact', color: 'text3', kind: 'dot' }]);

    const P = { band: 'C', peak: 18, depth: 2.6, look: 'asc', atm: 0.8, thr: 0.22, view: 'fringes', seed: 11, cx: 0.44, cy: 0.5 };
    let dem = null, S = null, W = null, dragging = false;
    const img = L.raster(N, N);

    // ---- static terrain products ----
    function terrain() {
      const z = dem.z, cs = (40075016.686 * Math.cos((28.25 * Math.PI) / 180)) / 2 ** BLOCK.z * BLOCK.n / N;
      const gE = new Float32Array(N * N), gN = new Float32Array(N * N), shade = new Float32Array(N * N), slope = new Float32Array(N * N);
      let zmin = Infinity, zmax = -Infinity;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i, l = z[j * N + Math.max(0, i - 1)], r = z[j * N + Math.min(N - 1, i + 1)], u = z[Math.max(0, j - 1) * N + i], d = z[Math.min(N - 1, j + 1) * N + i];
        gE[k] = (r - l) / (2 * cs); gN[k] = (u - d) / (2 * cs); slope[k] = Math.atan(Math.hypot(gE[k], gN[k]));
        const nx = -gE[k], ny = -gN[k], nl = Math.hypot(nx, ny, 1); shade[k] = clamp((nx * -0.5 + ny * 0.5 + 0.72) / nl / 1.0, 0, 1); if (z[k] < zmin) zmin = z[k]; if (z[k] > zmax) zmax = z[k]; }
      const tiles = 2 ** BLOCK.z, sx = ((SITE.lon + 180) / 360) * tiles, sy = ((1 - Math.asinh(Math.tan((SITE.lat * Math.PI) / 180)) / Math.PI) / 2) * tiles;
      const site = [((sx - BLOCK.x0) / BLOCK.n) * N, ((sy - BLOCK.y0) / BLOCK.n) * N];
      // settlement blocks: 3 x 3 cells on gentle ground low in the valley (invented; the exercise site is one of them)
      const R = L.rng(3), blocks = [{ i: Math.round(site[0]), j: Math.round(site[1]), site: true }], cand = [];
      for (let j = 6; j < N - 6; j += 2) for (let i = 6; i < N - 6; i += 2) { const k = j * N + i; if (slope[k] < 0.3 && z[k] < zmin + 0.42 * (zmax - zmin)) cand.push([i, j, slope[k]]); }
      let guard = 0; while (blocks.length < 54 && guard++ < 6000 && cand.length) { const c = R.pick(cand); if (blocks.every((b) => Math.abs(b.i - c[0]) > 4 || Math.abs(b.j - c[1]) > 4)) blocks.push({ i: c[0], j: c[1] }); }
      const urban = new Uint8Array(N * N); blocks.forEach((b, n) => { for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) urban[(b.j + dj) * N + b.i + di] = n + 1; });
      const patch = smoothNoise(L.rng(9), 14, 1), veg = new Float32Array(N * N);
      for (let k = 0; k < N * N; k++) veg[k] = clamp(L.smooth((slope[k] - 0.12) / 0.5) * 0.85 + 0.25 * patch[k] + 0.1, 0, 1);
      return { cs, gE, gN, shade, slope, zmin, zmax, site, blocks, urban, veg };
    }

    // ---- the simulation and the processing ----
    function compute() {
      const R = L.rng(P.seed), lam = BANDS[P.band].lam, k4 = (2 * TAU) / lam, az = ((P.look === 'asc' ? 78 : 282) * Math.PI) / 180;
      const e = [-Math.sin(INC) * Math.sin(az), -Math.sin(INC) * Math.cos(az), Math.cos(INC)], a = [Math.sin(az), Math.cos(az)];
      const { cs, gE, gN, slope, blocks, urban, veg } = W, n2 = N * N;
      // truth: two buried pressure sources (Mogi), one lifting and one dropping the ground, as seen along the line of sight
      const los = new Float32Array(n2), D = P.depth * 1000, sep = D * 1.5, ax = Math.cos(0.6), ay = Math.sin(0.6);
      const src = [[P.cx * N * cs + ax * sep / 2, P.cy * N * cs - ay * sep / 2, 1], [P.cx * N * cs - ax * sep / 2, P.cy * N * cs + ay * sep / 2, -0.8]];
      let peak = 0;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let d = 0; for (const s of src) { const dx = i * cs - s[0], dyN = -(j * cs - s[1]), r3 = (dx * dx + dyN * dyN + D * D) ** 1.5; d += (s[2] * (dx * e[0] + dyN * e[1] + D * e[2])) / r3; } los[j * N + i] = d; if (Math.abs(d) > peak) peak = Math.abs(d); }
      const scale = P.peak / 100 / peak; for (let k = 0; k < n2; k++) los[k] *= scale;
      // radar geometry: slopes steeper than the look angle fold over (layover) or fall in shadow
      const geo = new Uint8Array(n2); let nGeo = 0;
      for (let k = 0; k < n2; k++) { const beta = Math.atan(gE[k] * a[0] + gN[k] * a[1]); if (beta > INC) geo[k] = 1; else if (beta < -(Math.PI / 2 - INC)) geo[k] = 2; if (geo[k]) nGeo++; }
      // damage: blocks nearer the source are more likely to be damaged
      const cxm = P.cx * N, cym = P.cy * N;
      blocks.forEach((b) => { const d = Math.hypot(b.i - cxm, b.j - cym) * cs; b.dmg = R() < clamp(0.9 * Math.exp(-((d / (0.75 * D + 700)) ** 2)) + 0.05, 0, 1); });
      // atmosphere: an extra path delay, part turbulent, part following the height of the terrain
      const turb = smoothNoise(R, 5, 1), atm = new Float32Array(n2), zmid = (W.zmin + W.zmax) / 2;
      for (let k = 0; k < n2; k++) atm[k] = (P.atm / 100) * (0.8 * turb[k] + 0.5 * ((dem.z[k] - zmid) / 1000));
      // coherence: scatterers that moved between passes (Zebker and Villasenor 1992), geometry, fringe rate, damage
      const cohPre = new Float32Array(n2), cohCo = new Float32Array(n2), phi = new Float32Array(n2);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i, sig = urban[k] ? 0.002 : L.lerp(0.0022, 0.0062, veg[k]);
        let c = 0.95 * Math.exp(-0.5 * (k4 * sig) ** 2); if (geo[k]) c = 0.03;
        phi[k] = -k4 * (los[k] - atm[k]);
        const gr = Math.hypot(k4 * (los[j * N + Math.min(N - 1, i + 1)] - los[k]), k4 * (los[Math.min(N - 1, j + 1) * N + i] - los[k]));
        cohPre[k] = c; cohCo[k] = c * clamp(1 - gr / Math.PI) * (urban[k] && blocks[urban[k] - 1].dmg ? 0.28 : 1); }
      // three radar images as complex speckle; image 2 is shared by the before pair and the across-the-event pair
      const pair = (coh, ph) => { const re = new Float32Array(n2), im = new Float32Array(n2), p1 = new Float32Array(n2), p2 = new Float32Array(n2);
        for (let k = 0; k < n2; k++) { const ar = R.n(), ai = R.n(), br = R.n(), bi = R.n(), c = coh[k], q = Math.sqrt(1 - c * c), co = Math.cos(ph ? ph[k] : 0), si = Math.sin(ph ? ph[k] : 0);
          const zr = c * (ar * co - ai * si) + q * br, zi = c * (ar * si + ai * co) + q * bi; re[k] = ar * zr + ai * zi; im[k] = ai * zr - ar * zi; p1[k] = ar * ar + ai * ai; p2[k] = zr * zr + zi * zi; }
        return { re, im, p1, p2 }; };
      const est = (pr, r) => { const sr = boxMean(pr.re, r), si = boxMean(pr.im, r), s1 = boxMean(pr.p1, r), s2 = boxMean(pr.p2, r), c = new Float32Array(n2), ph = new Float32Array(n2); for (let k = 0; k < n2; k++) { c[k] = Math.hypot(sr[k], si[k]) / Math.sqrt(s1[k] * s2[k] + 1e-12); ph[k] = Math.atan2(-si[k], sr[k]); } return { c, ph }; };
      const pre = est(pair(cohPre, null), 2), coPair = pair(cohCo, phi), co = est(coPair, 2), psi = co.ph;   // psi: wrapped phase, 25 looks
      // unwrap by region growing, best coherence first
      const un = new Float32Array(n2), done = new Uint8Array(n2), heap = [], QMIN = 0.24;
      const push = (k) => { heap.push(k); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (co.c[heap[p]] >= co.c[heap[c]]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let p = 0; for (;;) { let m = p; const l = 2 * p + 1, r = l + 1; if (l < heap.length && co.c[heap[l]] > co.c[heap[m]]) m = l; if (r < heap.length && co.c[heap[r]] > co.c[heap[m]]) m = r; if (m === p) break; [heap[p], heap[m]] = [heap[m], heap[p]]; p = m; } } return top; };
      // reference point: good coherence, far from the source, where the analyst assumes the ground did not move
      let ref = -1, best = -1; for (let j = 4; j < N - 4; j += 3) for (let i = 4; i < N - 4; i += 3) { const k = j * N + i; if (co.c[k] < 0.55 || geo[k]) continue; const s = Math.hypot(i - cxm, j - cym) * (0.5 + co.c[k]); if (s > best) { best = s; ref = k; } }
      if (ref < 0) { ref = 0; for (let k = 1; k < n2; k++) if (co.c[k] > co.c[ref]) ref = k; }
      done[ref] = 1; un[ref] = psi[ref]; push(ref); let nUn = 0;
      while (heap.length) { const k = pop(), i = k % N, j = (k / N) | 0; nUn++;
        for (const q of [i > 0 ? k - 1 : -1, i < N - 1 ? k + 1 : -1, j > 0 ? k - N : -1, j < N - 1 ? k + N : -1]) { if (q < 0 || done[q] || co.c[q] < QMIN) continue; let d = psi[q] - psi[k]; d -= TAU * Math.round(d / TAU); un[q] = un[k] + d; done[q] = 1; push(q); } }
      const rec = new Float32Array(n2), err = new Float32Array(n2); let se = 0;
      for (let k = 0; k < n2; k++) { if (!done[k]) { rec[k] = NaN; err[k] = NaN; continue; } rec[k] = -(un[k] - un[ref]) / k4; err[k] = rec[k] - (los[k] - los[ref]); se += err[k] * err[k]; }
      // damage proxy: coherence before minus coherence across the event, averaged over each block
      let tp = 0, fp = 0, fn = 0;
      blocks.forEach((b) => { let p = 0, c = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const k = (b.j + dj) * N + b.i + di; p += pre.c[k]; c += co.c[k]; } b.pre = p / 9; b.co = c / 9; b.flag = b.pre - b.co > P.thr; if (b.flag && b.dmg) tp++; else if (b.flag) fp++; else if (b.dmg) fn++; });
      S = { lam, k4, los, psi, co: co.c, pre: pre.c, rec, err, done, geo, ref, a, src, D, sep, ax, ay, rms: Math.sqrt(se / Math.max(1, nUn)), unFrac: nUn / n2, geoFrac: nGeo / n2, tp, fp, fn, losRef: los[ref] };
      paint(); report();
    }
    function flags() { let tp = 0, fp = 0, fn = 0; W.blocks.forEach((b) => { b.flag = b.pre - b.co > P.thr; if (b.flag && b.dmg) tp++; else if (b.flag) fp++; else if (b.dmg) fn++; }); Object.assign(S, { tp, fp, fn }); }

    function paint() {
      const sh = W.shade, v = P.view, lim = P.peak / 100, T = L.tokens().rgb;
      img.paint((k) => {
        const s = 0.25 + 0.75 * sh[k]; let c, mix = 0.82;
        if (v === 'fringes') { c = L.cyclic(S.psi[k] / TAU + 0.5); mix = S.geo[k] ? 0.08 : 0.92 * L.smooth((S.co[k] - 0.18) / 0.3); }
        else if (v === 'shift') { if (!S.done[k]) { c = T.bg3; mix = 0.5; } else c = L.diverge(0.5 + (0.5 * S.rec[k]) / lim); }
        else if (v === 'error') { if (!S.done[k]) { c = T.bg3; mix = 0.5; } else c = L.heat(Math.min(1, Math.abs(S.err[k]) / 0.02)); }
        else if (v === 'coherence') c = L.heat(S.co[k] * 0.92);
        else { c = L.heat(clamp((S.pre[k] - S.co[k]) * 1.6)); mix = 0.8; }
        const b = 10 + 120 * s * s, lit = 0.5 + 0.5 * s; return [c[0] * mix * lit + b * (1 - mix) * 0.5, c[1] * mix * lit + b * (1 - mix) * 0.53, c[2] * mix * lit + b * (1 - mix) * 0.58];
      });
      fMap.redraw(); fPro.redraw(); fBlk.redraw();
    }

    const TITLES = { fringes: () => 'Each full colour cycle is ' + L.fix(S.lam * 50, 1) + ' cm of ground movement toward or away from the satellite', shift: () => 'Unwrapped: the fringes counted back into a ground shift, in centimetres', error: () => 'Where the recovered shift is wrong, and by how much', coherence: () => 'Coherence across the event: bright ground still matches itself', damage: () => 'Coherence lost across the event: the damage proxy' };
    let geomMap = null;
    fMap.draw = (g, w, hh) => {
      if (!S) { L.text(g, 'Reading the elevation grid…', w / 2, hh / 2, { align: 'center', color: 'text3', size: 12 }); return; }
      const side = Math.floor(Math.min(w, hh - 96)), x0 = Math.floor((w - side) / 2), y0 = Math.max(0, Math.floor((hh - side - 70) / 2)), px = side / N; geomMap = { x0, y0, px, side };
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(img.canvas, x0, y0, side, side);
      g.strokeStyle = L.tokens().line2; g.strokeRect(x0 + 0.5, y0 + 0.5, side - 1, side - 1);
      const at = (i, j) => [x0 + (i + 0.5) * px, y0 + (j + 0.5) * px];
      // blocks
      const showBlocks = P.view === 'damage' || P.view === 'coherence';
      for (const b of W.blocks) { const [bx, by] = at(b.i, b.j), r = Math.max(3, 1.5 * px);
        if (showBlocks) { g.lineWidth = b.flag ? 1.5 : 1; g.strokeStyle = b.flag ? L.tokens().warn : L.rgba('text', 0.45); g.strokeRect(bx - r, by - r, 2 * r, 2 * r); if (b.dmg) { g.strokeStyle = L.tokens().danger; g.beginPath(); g.moveTo(bx - r - 2, by - r - 2); g.lineTo(bx - r + 3, by - r - 2); g.moveTo(bx - r - 2, by - r - 2); g.lineTo(bx - r - 2, by - r + 3); g.moveTo(bx + r + 2, by + r + 2); g.lineTo(bx + r - 3, by + r + 2); g.moveTo(bx + r + 2, by + r + 2); g.lineTo(bx + r + 2, by + r - 3); g.stroke(); } }
        else if (b.site) { g.strokeStyle = L.rgba('text', 0.8); g.lineWidth = 1; g.strokeRect(bx - r, by - r, 2 * r, 2 * r); } }
      const sb = W.blocks[0], [sx, sy] = at(sb.i, sb.j); L.callout(g, 'exercise site, Timure', sx, sy, sx + 34, sy - 30, { color: 'text', dot: false });
      // profile line, source handle, reference point
      const c = at(P.cx * N, P.cy * N), ex = (S.sep * 1.6) / W.cs * px;
      g.strokeStyle = L.rgba('text', 0.75); g.lineWidth = 1; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(c[0] - S.ax * ex, c[1] + S.ay * ex); g.lineTo(c[0] + S.ax * ex, c[1] - S.ay * ex); g.stroke(); g.setLineDash([]);
      L.text(g, 'A', c[0] - S.ax * ex - 10, c[1] + S.ay * ex + 4, { color: 'text', size: 11, weight: 600, halo: true }); L.text(g, 'B', c[0] + S.ax * ex + 4, c[1] - S.ay * ex + 4, { color: 'text', size: 11, weight: 600, halo: true });
      g.fillStyle = L.tokens().bg0; g.strokeStyle = L.tokens().accent; g.lineWidth = 2; g.beginPath(); g.arc(c[0], c[1], dragging ? 8 : 6, 0, TAU); g.fill(); g.stroke();
      L.text(g, 'drag to move the ground shift', c[0] + 12, c[1] + 18, { color: 'accent2', size: 11, halo: true });
      const rf = at(S.ref % N, (S.ref / N) | 0); g.strokeStyle = L.tokens().ok; g.lineWidth = 1.5; g.beginPath(); g.moveTo(rf[0] - 5, rf[1]); g.lineTo(rf[0] + 5, rf[1]); g.moveTo(rf[0], rf[1] - 5); g.lineTo(rf[0], rf[1] + 5); g.stroke();
      L.callout(g, 'reference: assumed still', rf[0], rf[1], rf[0] + (rf[0] > x0 + side / 2 ? -26 : 26), rf[1] + (rf[1] > y0 + side / 2 ? -20 : 20), { color: 'ok', dot: false });
      L.scaleBar(g, x0 + 12, y0 + side - 12, px / W.cs, { metres: 1000 });
      // key under the map: colour scale, look direction, what the radar cannot see
      const ky = y0 + side + 28, kx = x0, kw = Math.min(150, side * 0.26);
      if (P.view === 'fringes') L.colorbar(g, kx, ky, kw, (t) => L.cyclic(t), '0', L.fix(S.lam * 50, 1) + ' cm', 'one fringe of movement');
      else if (P.view === 'shift') L.colorbar(g, kx, ky, kw, L.diverge, '-' + P.peak, '+' + P.peak + ' cm', 'toward the satellite');
      else if (P.view === 'error') L.colorbar(g, kx, ky, kw, L.heat, '0', '20 mm', 'absolute error');
      else if (P.view === 'coherence') L.colorbar(g, kx, ky, kw, L.heat, '0', '1', 'coherence');
      else L.colorbar(g, kx, ky, kw, L.heat, '0', '0.6', 'coherence lost');
      const cx = kx + kw + 58, cy = ky + 14, hd = ((P.look === 'asc' ? -12 : 192) * Math.PI) / 180;
      g.strokeStyle = L.tokens().line3; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, 24, 0, TAU); g.stroke(); L.text(g, 'N', cx, cy - 28, { align: 'center', color: 'text3', size: 10.5 });
      const arrow = (ang, len, col, wd) => { const dx = Math.sin(ang), dy = -Math.cos(ang); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = wd; g.beginPath(); g.moveTo(cx - dx * len * 0.2, cy - dy * len * 0.2); g.lineTo(cx + dx * len, cy + dy * len); g.stroke(); g.beginPath(); g.moveTo(cx + dx * (len + 5), cy + dy * (len + 5)); g.lineTo(cx + dx * len - dy * 3.5, cy + dy * len + dx * 3.5); g.lineTo(cx + dx * len + dy * 3.5, cy + dy * len - dx * 3.5); g.fill(); };
      arrow(hd, 16, L.tokens().text3, 1); arrow(Math.atan2(S.a[0], S.a[1]), 16, L.tokens().accent, 1.5);
      let tx = cx + 40; L.text(g, 'satellite flies', tx, ky + 8, { color: 'text3', size: 11 }); L.text(g, 'radar looks, 39° off vertical', tx, ky + 23, { color: 'accent', size: 11 });
      tx += 176;
      if (tx + 150 < x0 + side) { if (showBlocks) { g.strokeStyle = L.tokens().warn; g.lineWidth = 1.5; g.strokeRect(tx + 0.5, ky - 1, 9, 9); L.text(g, 'flagged by the map', tx + 16, ky + 8, { size: 11 }); g.strokeStyle = L.tokens().danger; g.beginPath(); g.moveTo(tx, ky + 15); g.lineTo(tx + 5, ky + 15); g.moveTo(tx, ky + 15); g.lineTo(tx, ky + 20); g.stroke(); L.text(g, 'damaged (truth)', tx + 16, ky + 23, { size: 11 }); }
        else { L.text(g, L.pct(S.geoFrac) + ' % of the valley folds over or lies in', tx, ky + 8, { color: 'text3', size: 11 }); L.text(g, 'radar shadow (dark): no signal there', tx, ky + 23, { color: 'text3', size: 11 }); } }
    };
    fMap.onPointer((ev) => {
      if (!geomMap || !S) return; const u = (ev.x - geomMap.x0) / geomMap.side, v = (ev.y - geomMap.y0) / geomMap.side;
      const near = Math.hypot(u - P.cx, v - P.cy) * geomMap.side < 16;
      if (ev.type === 'down' && u >= 0 && u <= 1 && v >= 0 && v <= 1) dragging = true;
      if (ev.type === 'up' || ev.type === 'leave') { if (dragging) { dragging = false; fMap.redraw(); } }
      if (dragging && (ev.type === 'drag' || ev.type === 'down')) { P.cx = clamp(u, 0.12, 0.88); P.cy = clamp(v, 0.12, 0.88); recompute(); }
      fMap.canvas.style.cursor = dragging ? 'grabbing' : near ? 'grab' : 'crosshair';
    });

    fPro.draw = (g, w, hh) => {
      if (!S) return; const n = 140, xs = [], tr = [], rc = [], half = S.sep * 1.6, lim = P.peak * 1.15;
      for (let q = 0; q < n; q++) { const s = (q / (n - 1)) * 2 - 1, i = Math.round(P.cx * N + (S.ax * s * half) / W.cs), j = Math.round(P.cy * N - (S.ay * s * half) / W.cs); xs.push(((s + 1) * half) / 1000); if (i < 0 || j < 0 || i >= N || j >= N) { tr.push(NaN); rc.push(NaN); continue; } const k = j * N + i; tr.push((S.los[k] - S.losRef) * 100); rc.push(S.done[k] ? S.rec[k] * 100 : NaN); }
      const B = L.pad(w, hh, { l: 44, t: 16, b: 34 }), Pl = L.plot(g, B, { xd: [0, (2 * half) / 1000], yd: [-lim, lim], xlabel: 'distance along A to B, km', ylabel: 'shift toward the satellite, cm' });
      L.rule(g, Pl, { y: 0, color: 'line3', dash: [] });
      const seg = (ys, opt) => { let a = -1; for (let q = 0; q <= n; q++) { const ok = q < n && Number.isFinite(ys[q]); if (ok && a < 0) a = q; if (!ok && a >= 0) { L.trace(g, Pl, xs.slice(a, q), ys.slice(a, q), opt); a = -1; } } };
      seg(tr, { color: 'text2', dash: [4, 3], width: 1.25 }); seg(rc, { color: 'accent', width: 2 });
      let gaps = 0; rc.forEach((v2, q) => { if (!Number.isFinite(v2) && Number.isFinite(tr[q])) { gaps++; g.fillStyle = L.rgba('text3', 0.12); g.fillRect(Pl.X(xs[q]) - B.w / n / 2, B.y, B.w / n + 0.5, B.h); } });
      if (gaps > n * 0.08) L.text(g, 'grey: no usable signal', B.x + B.w - 4, B.y + B.h - 6, { color: 'text3', size: 10.5, align: 'right' });
    };
    fBlk.draw = (g, w, hh) => {
      if (!S) return; const B = L.pad(w, hh, { l: 44, t: 16, b: 34 }), Pl = L.plot(g, B, { xd: [0, 1], yd: [0, 1], xlabel: 'coherence before the event', ylabel: 'coherence across the event', frame: true });
      g.save(); g.beginPath(); g.rect(B.x, B.y, B.w, B.h); g.clip();
      g.fillStyle = L.rgba('warn', 0.07); g.beginPath(); g.moveTo(Pl.X(P.thr), Pl.Y(0)); g.lineTo(Pl.X(1), Pl.Y(1 - P.thr)); g.lineTo(Pl.X(1), Pl.Y(0)); g.closePath(); g.fill();
      g.strokeStyle = L.tokens().line3; g.lineWidth = 1; g.beginPath(); g.moveTo(Pl.X(0), Pl.Y(0)); g.lineTo(Pl.X(1), Pl.Y(1)); g.stroke();
      g.strokeStyle = L.tokens().warn; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(Pl.X(P.thr), Pl.Y(0)); g.lineTo(Pl.X(1), Pl.Y(1 - P.thr)); g.stroke(); g.restore();
      L.text(g, 'no change', Pl.X(0.62), Pl.Y(0.62) - 8, { color: 'text3', size: 10.5, align: 'right' });
      L.text(g, 'flagged below this line', Pl.X(1) - 6, Pl.Y(Math.max(0.04, 1 - P.thr - 0.12)), { color: 'warn', size: 10.5, align: 'right', halo: true });
      for (const d of [false, true]) for (const b of W.blocks) if (b.dmg === d) { g.beginPath(); g.arc(Pl.X(b.pre), Pl.Y(b.co), 3.5, 0, TAU); g.fillStyle = d ? L.tokens().danger : L.rgba('text3', 0.9); g.fill(); if (b.site) { g.strokeStyle = L.tokens().text; g.lineWidth = 1; g.beginPath(); g.arc(Pl.X(b.pre), Pl.Y(b.co), 6.5, 0, TAU); g.stroke(); } }
    };

    // ---- controls and readouts ----
    const sFr = L.stat('fringes at the peak'), sRms = L.stat('error against truth (RMS)', { unit: 'mm' }), sUn = L.stat('of the scene unwrapped', { unit: '%' }), sDm = L.stat('damaged blocks flagged'), sFa = L.stat('false alarms');
    readout.append(L.h('h4', null, 'Measured against the simulated truth'), sRms.el, sUn.el, sDm.el, sFa.el, sFr.el);
    function report() {
      const nd = S.tp + S.fn;
      sFr.set(L.fix((P.peak / 100) / (S.lam / 2), 1)); sRms.set(L.fix(S.rms * 1000, 1)); sRms.tone(S.rms * 1000 < 12 ? 'ok' : S.rms * 1000 < 30 ? 'warn' : 'danger'); sUn.set(L.pct(S.unFrac)); sUn.tone(S.unFrac > 0.5 ? null : 'warn');
      sDm.set(S.tp + ' of ' + nd); sFa.set(String(S.fp), 'false alarms, of ' + (W.blocks.length - nd) + ' intact blocks'); sFa.tone(S.fp > 3 ? 'warn' : null);
      fMap.setTitle(TITLES[P.view]());
      fMap.setNote((dem.real ? 'Real elevation around Timure, Nepal (8.6 km across, north up). ' : 'The elevation file did not load: this is an invented valley. ') + 'The ground shift, the blocks and the damage are invented; no real event is shown.');
      fPro.setTitle('Along A to B, the fringes give the shift back to within ' + L.fix(S.rms * 1000, 0) + ' mm, over the ' + L.pct(S.unFrac) + ' % that could be unwrapped');
      fPro.setNote('Scatterer motion, noise and air delay are assumed. Atmosphere and unwrapping mistakes are the error. Raise the delay, or switch to X band, to watch it fail.');
      fBlk.setTitle(nd ? 'Coherence loss flags ' + S.tp + ' of ' + nd + ' damaged blocks, with ' + S.fp + ' false alarm' + (S.fp === 1 ? '' : 's') : 'No block was damaged in this draw');
      fBlk.setNote(W.blocks.length + ' invented blocks, each a 3 by 3 cell average. The ringed dot is the exercise site.');
    }
    const recompute = L.soon(compute);
    const views = L.seg({ label: 'Show', value: P.view, options: [{ value: 'fringes', label: 'Fringes' }, { value: 'shift', label: 'Shift' }, { value: 'error', label: 'Error' }, { value: 'coherence', label: 'Coherence' }, { value: 'damage', label: 'Damage' }], onChange: (v) => { P.view = v; if (S) { paint(); report(); } } });
    controls.append(views.el,
      L.seg({ label: 'Radar wavelength', value: P.band, options: Object.entries(BANDS).map(([k, b]) => ({ value: k, label: k, hint: b.name })), onChange: (v) => { P.band = v; recompute(); } }).el,
      L.slider({ label: 'Peak ground shift', min: 2, max: 60, step: 1, value: P.peak, unit: 'cm', onInput: (v) => { P.peak = v; recompute(); } }).el,
      L.slider({ label: 'Depth of the source', min: 1, max: 5, step: 0.1, value: P.depth, unit: 'km', format: (v) => v.toFixed(1), onInput: (v) => { P.depth = v; recompute(); } }).el,
      L.slider({ label: 'Atmospheric delay', min: 0, max: 4, step: 0.1, value: P.atm, unit: 'cm', format: (v) => v.toFixed(1), hint: 'Water vapour slows the radar signal by a different amount on each pass.', onInput: (v) => { P.atm = v; recompute(); } }).el,
      L.slider({ label: 'Damage threshold (coherence lost)', min: 0.05, max: 0.6, step: 0.01, value: P.thr, format: (v) => v.toFixed(2), onInput: (v) => { P.thr = v; if (S) { flags(); report(); fMap.redraw(); fBlk.redraw(); } } }).el,
      L.row(L.seg({ label: 'Orbit pass', value: P.look, options: [{ value: 'asc', label: 'Ascending', hint: 'Flying north, looking east' }, { value: 'desc', label: 'Descending', hint: 'Flying south, looking west' }], onChange: (v) => { P.look = v; recompute(); } }).el),
      L.row(L.button({ label: 'New draw of noise and damage', icon: 'reset', onClick: () => { P.seed++; recompute(); } })));

    loadDem().then((d) => { dem = d; W = terrain(); compute(); });
    return { start() { if (S) paint(); }, stop() {} };
  },
};
