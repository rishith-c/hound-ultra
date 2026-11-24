// The radio physics behind the Radio twin: a 2.4 GHz ray tracer for building B.
//
//   walls       every standing wall of world.WALLS is a uniform slab. Its complex reflection and transmission
//               coefficients come from the slab Fresnel equations (electric field vertical, so parallel to the wall:
//               TE), with permittivity and conductivity from ITU-R P.2040-4. Thicknesses are ASSUMED.
//   paths       image-source method in plan: exact specular paths with up to 'order' wall reflections, any number of
//               walls crossed on the way (each one costs its transmission coefficient at that angle).
//   diffraction one bend at a free wall end (a door jamb), amplitude from the knife-edge approximation of
//               ITU-R P.526-16 eq. 31. Not the full uniform theory of diffraction.
//   rays        shooting-and-bouncing rays in 3-D (walls, floor, ceiling) for drawing. Numbers come from the paths.
// Not modelled: floor and ceiling bounces in the path list, furniture, scattering from rough surfaces, antenna
// patterns other than a vertical dipole, polarisation changes. Rubble is an assumed 6 dB per metre.
import { LAMBDA, KW, F0 } from './lab.js';

const K0 = (2 * Math.PI) / LAMBDA, EPS0 = 8.8541878128e-12, FGHZ = F0 / 1e9;
export const FRIIS = LAMBDA / (4 * Math.PI);                 // amplitude at 1 m between unit-gain antennas
export const RUBBLE_DB_PER_M = 6;                            // assumed
export const MATERIALS = {
  concrete: { label: 'Concrete', a: 5.24, c: 0.0462, d: 0.7822, thick: 0.20 },
  drywall: { label: 'Plasterboard partition', a: 2.73, c: 0.0085, d: 0.9395, thick: 0.10 },
};

// ---- complex helpers on [re, im] ----
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const csqrt = (a) => { const m = Math.hypot(a[0], a[1]), re = Math.sqrt((m + a[0]) / 2), im = Math.sqrt(Math.max(0, (m - a[0]) / 2)); return [re, a[1] < 0 ? -im : im]; };
const cexp = (a) => { const e = Math.exp(a[0]); return [e * Math.cos(a[1]), e * Math.sin(a[1])]; };

// Reflection R and transmission T of a uniform slab at incidence angle acos(cosT). T is referenced to free space
// over the same thickness, so a path's length stays its geometric length.
export function slab(matName, cosT) {
  const m = MATERIALS[matName] || MATERIALS.drywall;
  const sigma = m.c * Math.pow(FGHZ, m.d), eps = [m.a, -sigma / (2 * Math.PI * F0 * EPS0)];
  const cos = Math.max(1e-4, Math.min(1, cosT)), sin2 = 1 - cos * cos;
  const q = csqrt([eps[0] - sin2, eps[1]]);                                 // Im(q) < 0: the wave decays in the slab
  const r = cdiv([cos - q[0], -q[1]], [cos + q[0], q[1]]);
  const kd = K0 * m.thick;
  const e1 = cexp([kd * q[1], -kd * q[0]]), e2 = cmul(e1, e1), r2 = cmul(r, r);
  const den = [1 - (r2[0] * e2[0] - r2[1] * e2[1]), -(r2[0] * e2[1] + r2[1] * e2[0])];
  const R = cdiv(cmul(r, [1 - e2[0], -e2[1]]), den);
  const T = cmul(cdiv(cmul([1 - r2[0], -r2[1]], e1), den), [Math.cos(kd * cos), Math.sin(kd * cos)]);
  return { R, T, eps, sigma };
}
const NTAB = 256, tables = {};
function table(mat) {
  if (tables[mat]) return tables[mat];
  const t = new Float64Array(NTAB * 4);
  for (let i = 0; i < NTAB; i++) { const s = slab(mat, (i + 0.5) / NTAB); t.set([s.R[0], s.R[1], s.T[0], s.T[1]], i * 4); }
  return (tables[mat] = t);
}
const tabIndex = (cos) => Math.min(NTAB - 1, Math.max(0, Math.floor(cos * NTAB))) * 4;
export function wallLossDb(mat, cos = 1) { const t = table(mat), i = tabIndex(cos); return -10 * Math.log10(t[i + 2] ** 2 + t[i + 3] ** 2); }
export function wallReflDb(mat, cos = 1) { const t = table(mat), i = tabIndex(cos); return -10 * Math.log10(t[i] ** 2 + t[i + 1] ** 2); }

// ---- the scene: wall segments grouped into lines, free wall ends, rubble ----
export function buildScene(world) {
  const segs = world.WALLS.filter((w) => w.state !== 'collapsed').map((w, i) => {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = Math.hypot(dx, dy);
    return { i, id: w.id, a: w.a, b: w.b, mat: MATERIALS[w.mat] ? w.mat : 'drywall', state: w.state, len, u: [dx / len, dy / len], n: [-dy / len, dx / len], tab: null, line: -1 };
  });
  const lines = [];
  for (const s of segs) {
    s.tab = table(s.mat);
    let n = s.n; if (n[0] < -1e-9 || (Math.abs(n[0]) < 1e-9 && n[1] < 0)) n = [-n[0], -n[1]];
    const c = n[0] * s.a[0] + n[1] * s.a[1];
    let L = lines.find((l) => Math.abs(l.n[0] - n[0]) < 1e-6 && Math.abs(l.n[1] - n[1]) < 1e-6 && Math.abs(l.c - c) < 1e-6);
    if (!L) { L = { i: lines.length, n, c, u: [-n[1], n[0]], segs: [] }; lines.push(L); }
    s.line = L.i; s.t0 = Math.min(L.u[0] * s.a[0] + L.u[1] * s.a[1], L.u[0] * s.b[0] + L.u[1] * s.b[1]); s.t1 = s.t0 + s.len; L.segs.push(s);
  }
  // free ends: a wall end that no other wall touches (door jambs and the ends left by the collapse)
  const edges = [];
  for (const s of segs) for (const [p, o] of [[s.a, s.b], [s.b, s.a]]) {
    const touched = segs.some((q) => q !== s && distSeg(p, q.a, q.b) < 0.02);
    if (!touched) edges.push({ p, seg: s, u: [(o[0] - p[0]) / s.len, (o[1] - p[1]) / s.len] });
  }
  const rubble = world.OBSTACLES.filter((o) => o.kind === 'rubble' && !o.passable).map((o) => o.poly);
  const r = world.BUILDING.rect;
  return { segs, lines, edges, rubble, rect: r, height: world.BUILDING.wallHeight };
}
function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

// Multiply acc (complex, in place) by everything the straight leg p -> q passes through. Returns walls crossed.
function leg(scene, px, py, qx, qy, acc, skipSeg) {
  const dx = qx - px, dy = qy - py, L = Math.hypot(dx, dy); if (L < 1e-9) return 0;
  let n = 0;
  const segs = scene.segs;
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k]; if (s === skipSeg) continue;
    const ex = s.b[0] - s.a[0], ey = s.b[1] - s.a[1], den = dx * ey - dy * ex;
    if (den > -1e-12 && den < 1e-12) continue;
    const wx = s.a[0] - px, wy = s.a[1] - py;
    const u = (wx * ey - wy * ex) / den; if (u <= 1e-6 || u >= 1 - 1e-6) continue;
    const v = (wx * dy - wy * dx) / den; if (v < 0 || v > 1) continue;
    const cos = Math.abs(dx * s.n[0] + dy * s.n[1]) / L, i = tabIndex(cos), tr = s.tab[i + 2], ti = s.tab[i + 3];
    const ar = acc[0] * tr - acc[1] * ti; acc[1] = acc[0] * ti + acc[1] * tr; acc[0] = ar; n++;
  }
  for (const poly of scene.rubble) {                                         // chord inside each rubble pile
    let lo = Infinity, hi = -Infinity, hits = 0;
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1], den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const u = ((a[0] - px) * ey - (a[1] - py) * ex) / den, v = ((a[0] - px) * dy - (a[1] - py) * dx) / den;
      if (v < 0 || v > 1 || u < 0 || u > 1) continue;
      lo = Math.min(lo, u); hi = Math.max(hi, u); hits++;
    }
    if (hits >= 2) { const g = Math.pow(10, (-RUBBLE_DB_PER_M * (hi - lo) * L) / 20); acc[0] *= g; acc[1] *= g; }
  }
  return n;
}

// ---- image-source paths ----
const MAXO = 6;
const scratch = { ix: new Float64Array(MAXO + 1), iy: new Float64Array(MAXO + 1), qx: new Float64Array(MAXO + 2), qy: new Float64Array(MAXO + 2), seq: new Int32Array(MAXO), hit: new Array(MAXO) };
// Validate one image sequence (scratch.seq[0..n), images in scratch.ix/iy) for a receiver at (rx, ry).
// Returns the complex amplitude through out[0..1], the length through out[2], walls crossed out[3]; false if invalid.
function validate(scene, n, tx, ty, rx, ry, out) {
  const S = scratch; let px = rx, py = ry; out[0] = 1; out[1] = 0;
  S.qx[n + 1] = rx; S.qy[n + 1] = ry;
  for (let k = n - 1; k >= 0; k--) {
    const L = scene.lines[S.seq[k]], ix = S.ix[k + 1], iy = S.iy[k + 1];
    const dx = px - ix, dy = py - iy, den = L.n[0] * dx + L.n[1] * dy; if (den > -1e-9 && den < 1e-9) return false;
    const t = (L.c - L.n[0] * ix - L.n[1] * iy) / den; if (t <= 1e-6 || t >= 1 - 1e-6) return false;
    const qx = ix + t * dx, qy = iy + t * dy, along = L.u[0] * qx + L.u[1] * qy;
    let hit = null; for (const s of L.segs) if (along >= s.t0 && along <= s.t1) { hit = s; break; }
    if (!hit) return false;
    const cos = Math.abs(den) / Math.hypot(dx, dy), i = tabIndex(cos), rr = hit.tab[i], ri = hit.tab[i + 1];
    const ar = out[0] * rr - out[1] * ri; out[1] = out[0] * ri + out[1] * rr; out[0] = ar;
    S.qx[k + 1] = qx; S.qy[k + 1] = qy; S.hit[k] = hit; px = qx; py = qy;
  }
  S.qx[0] = tx; S.qy[0] = ty;
  let walls = 0;
  for (let k = 0; k <= n; k++) {
    walls += leg(scene, S.qx[k], S.qy[k], S.qx[k + 1], S.qy[k + 1], out, null);
    if (out[0] * out[0] + out[1] * out[1] < 1e-16) return false;
  }
  out[2] = Math.hypot(rx - S.ix[n], ry - S.iy[n]); out[3] = walls;
  return true;
}
function eachSequence(scene, tx, order, fn) {
  const S = scratch; S.ix[0] = tx[0]; S.iy[0] = tx[1];
  const rec = (n) => {
    fn(n);
    if (n === order) return;
    for (const L of scene.lines) {
      if (n && S.seq[n - 1] === L.i) continue;
      const d = L.n[0] * S.ix[n] + L.n[1] * S.iy[n] - L.c; if (d > -1e-9 && d < 1e-9) continue;
      S.seq[n] = L.i; S.ix[n + 1] = S.ix[n] - 2 * d * L.n[0]; S.iy[n + 1] = S.iy[n] - 2 * d * L.n[1];
      rec(n + 1);
    }
  };
  rec(0);
}
// Knife-edge loss (dB) for Fresnel parameter v, ITU-R P.526-16 eq. 31 (valid for v > -0.78).
export const knifeDb = (v) => 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) * (v - 0.1) + 1) + v - 0.1);
function diffracted(scene, tx, rx, fn) {
  const acc = [1, 0];
  for (const e of scene.edges) {
    const s = e.seg, L = scene.lines[s.line];
    const s1 = L.n[0] * tx[0] + L.n[1] * tx[1] - L.c, s2 = L.n[0] * rx[0] + L.n[1] * rx[1] - L.c;
    if (s1 * s2 >= 0) continue;                                              // both on one side: this wall does not shadow
    const t = s1 / (s1 - s2), xx = tx[0] + t * (rx[0] - tx[0]), xy = tx[1] + t * (rx[1] - tx[1]);
    const w = (xx - e.p[0]) * e.u[0] + (xy - e.p[1]) * e.u[1]; if (w <= 0 || w > s.len) continue;   // direct line misses this wall
    const d1 = Math.hypot(e.p[0] - tx[0], e.p[1] - tx[1]), d2 = Math.hypot(rx[0] - e.p[0], rx[1] - e.p[1]); if (d1 < 0.05 || d2 < 0.05) continue;
    const dd = Math.hypot(rx[0] - tx[0], rx[1] - tx[1]);
    const hgt = Math.abs((rx[0] - tx[0]) * (tx[1] - e.p[1]) - (tx[0] - e.p[0]) * (rx[1] - tx[1])) / dd;
    const v = hgt * Math.sqrt((2 * (d1 + d2)) / (LAMBDA * d1 * d2)); if (v > 12) continue;
    const g = Math.pow(10, -knifeDb(v) / 20);
    acc[0] = g * Math.SQRT1_2; acc[1] = -g * Math.SQRT1_2;                    // knife-edge field lags by about 45 degrees
    const walls = leg(scene, tx[0], tx[1], e.p[0], e.p[1], acc, s) + leg(scene, e.p[0], e.p[1], rx[0], rx[1], acc, s);
    fn(e, acc, d1, d2, walls, v);
  }
}

// All paths from tx to rx: [{ kind: 'direct'|'reflected'|'diffracted', order, walls, d, a: [re, im], gainDb, pts, src, extra }]
// a already includes the 1/d spreading (FRIIS / d); the phase of each subcarrier is added by channel().
export function tracePaths(scene, tx, rx, { order = 3, diffraction = true, minDb = -140 } = {}) {
  const paths = [], out = [0, 0, 0, 0], S = scratch, floor = Math.pow(10, minDb / 20);
  eachSequence(scene, tx, Math.min(order, MAXO), (n) => {
    if (!validate(scene, n, tx[0], tx[1], rx[0], rx[1], out)) return;
    const d = Math.max(out[2], 0.05), g = FRIIS / d, a = [out[0] * g, out[1] * g], mag = Math.hypot(a[0], a[1]); if (mag < floor) return;
    const pts = []; for (let k = 0; k <= n + 1; k++) pts.push([S.qx[k], S.qy[k]]);
    paths.push({ kind: n ? 'reflected' : 'direct', order: n, walls: out[3], d, a, gainDb: 20 * Math.log10(mag), pts, src: [S.ix[n], S.iy[n]], extra: 0, hits: Array.from({ length: n }, (_, k) => S.hit[k].mat) });
  });
  if (diffraction) diffracted(scene, tx, rx, (e, acc, d1, d2, walls, v) => {
    const d = d1 + d2, g = FRIIS / d, a = [acc[0] * g, acc[1] * g], mag = Math.hypot(a[0], a[1]); if (mag < floor) return;
    paths.push({ kind: 'diffracted', order: 1, walls, d, a, gainDb: 20 * Math.log10(mag), pts: [tx.slice(), e.p.slice(), rx.slice()], src: e.p, extra: d1, v, hits: [] });
  });
  paths.sort((p, q) => q.gainDb - p.gainDb);
  return paths;
}
// Sum of path powers at a point (no interference): what a coverage map shows. Order is capped for speed.
export function powerAt(scene, tx, p, { order = 2, diffraction = true } = {}) {
  let sum = 0; const out = [0, 0, 0, 0];
  eachSequence(scene, tx, order, (n) => {
    if (!validate(scene, n, tx[0], tx[1], p[0], p[1], out)) return;
    const g = FRIIS / Math.max(out[2], 0.3); sum += (out[0] * out[0] + out[1] * out[1]) * g * g;
  });
  if (diffraction) diffracted(scene, tx, p, (e, acc, d1, d2) => { const g = FRIIS / (d1 + d2); sum += (acc[0] * acc[0] + acc[1] * acc[1]) * g * g; });
  return sum;
}
// The channel on the 51 subcarriers (lab.SUB order): H[k] = sum over paths of a * exp(-j * KW[k] * d).
export function channel(paths, scale = 1) {
  const n = KW.length, re = new Float64Array(n), im = new Float64Array(n);
  for (const p of paths) for (let k = 0; k < n; k++) { const ph = -KW[k] * p.d, c = Math.cos(ph), s = Math.sin(ph); re[k] += scale * (p.a[0] * c - p.a[1] * s); im[k] += scale * (p.a[0] * s + p.a[1] * c); }
  return { re, im };
}
// Link numbers from a path list.
export function linkStats(paths) {
  let p = 0, m1 = 0, m2 = 0, strongest = 0;
  for (const q of paths) { const w = q.a[0] * q.a[0] + q.a[1] * q.a[1], tau = q.d / 0.299792458; p += w; m1 += w * tau; m2 += w * tau * tau; strongest = Math.max(strongest, w); }
  const mean = p ? m1 / p : 0;
  return { powerDb: 10 * Math.log10(Math.max(p, 1e-30)), meanDelayNs: mean, spreadNs: p ? Math.sqrt(Math.max(0, m2 / p - mean * mean)) : 0, kDb: p > strongest ? 10 * Math.log10(strongest / (p - strongest)) : Infinity, n: paths.length };
}
// The coherent field around the receiver (the standing-wave pattern), from the same paths: each path is a point
// source at its image (or at the diffracting edge). Returns |E| in dB, n x n, row 0 at the top (north).
export function fringe(paths, rx, half = 0.75, n = 150) {
  const out = new Float32Array(n * n), re = new Float32Array(n * n), im = new Float32Array(n * n);
  for (const p of paths) {
    const mag = Math.hypot(p.a[0], p.a[1]) * p.d, ph0 = Math.atan2(p.a[1], p.a[0]);
    for (let j = 0; j < n; j++) { const y = rx[1] + half - ((j + 0.5) / n) * 2 * half;
      for (let i = 0; i < n; i++) { const x = rx[0] - half + ((i + 0.5) / n) * 2 * half, d = Math.hypot(x - p.src[0], y - p.src[1]) + p.extra, ph = ph0 - K0 * d, a = mag / Math.max(d, 0.05); re[j * n + i] += a * Math.cos(ph); im[j * n + i] += a * Math.sin(ph); } }
  }
  for (let i = 0; i < n * n; i++) out[i] = 10 * Math.log10(re[i] * re[i] + im[i] * im[i] + 1e-30);
  return out;
}

// ---- shooting and bouncing rays in 3-D, for drawing ----
// Returns { pos: Float32Array(6 per segment, world x, y, z), dist: Float32Array(2 per segment, metres travelled),
//           pow: Float32Array(2 per segment, dB), count, launched }.
export function shootRays(scene, tx, { n = 2400, depth = 3, maxLen = 46, floorDb = -92, maxSegs = 60000 } = {}) {
  const pos = new Float32Array(maxSegs * 6), dist = new Float32Array(maxSegs * 2), pow = new Float32Array(maxSegs * 2);
  const H = scene.height, [x0, y0, x1, y1] = scene.rect, conc = table('concrete');
  let count = 0; const stack = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let r = 0; r < n; r++) {
    const z = (1 - (2 * (r + 0.5)) / n) * 0.62, rad = Math.sqrt(1 - z * z), th = golden * r;
    stack.push([tx[0], tx[1], tx[2], rad * Math.cos(th), rad * Math.sin(th), z, 1.5 * rad * rad, 0, 0, null]);   // dipole pattern
    while (stack.length && count < maxSegs) {
      const [ox, oy, oz, dx, dy, dz, g, s0, dep, from] = stack.pop();
      let tBest = maxLen - s0, kind = 0, hitSeg = null; if (tBest <= 0) continue;
      const hxy = Math.hypot(dx, dy);
      for (const s of scene.segs) {
        if (s === from) continue;
        const ex = s.b[0] - s.a[0], ey = s.b[1] - s.a[1], den = dx * ey - dy * ex; if (Math.abs(den) < 1e-12) continue;
        const wx = s.a[0] - ox, wy = s.a[1] - oy, t = (wx * ey - wy * ex) / den; if (t <= 1e-5 || t >= tBest) continue;
        const v = (wx * dy - wy * dx) / den; if (v < 0 || v > 1) continue;
        const zz = oz + t * dz; if (zz < 0 || zz > H) continue;
        tBest = t; kind = 1; hitSeg = s;
      }
      if (dz < -1e-6) { const t = -oz / dz; if (t > 1e-5 && t < tBest) { tBest = t; kind = 2; hitSeg = null; } }
      if (dz > 1e-6) { const t = (H - oz) / dz, hx = ox + t * dx, hy = oy + t * dy; if (t > 1e-5 && t < tBest && hx > x0 && hx < x1 && hy > y0 && hy < y1 && !(hx > 78 && hy > 50)) { tBest = t; kind = 3; hitSeg = null; } }
      const ex = ox + tBest * dx, ey = oy + tBest * dy, ez = oz + tBest * dz, s1 = s0 + tBest;
      const p0 = 10 * Math.log10(g) + 20 * Math.log10(FRIIS / Math.max(s0, 0.5)), p1 = 10 * Math.log10(g) + 20 * Math.log10(FRIIS / Math.max(s1, 0.5));
      pos.set([ox, oy, oz, ex, ey, ez], count * 6); dist.set([s0, s1], count * 2); pow.set([p0, p1], count * 2); count++;
      if (!kind || dep >= depth) continue;
      if (kind === 1) {
        const cos = Math.abs(dx * hitSeg.n[0] + dy * hitSeg.n[1]), i = tabIndex(cos * (hxy > 1e-9 ? 1 : 0)), t = hitSeg.tab;
        const gr = g * (t[i] * t[i] + t[i + 1] * t[i + 1]), gt = g * (t[i + 2] * t[i + 2] + t[i + 3] * t[i + 3]);
        const dn = dx * hitSeg.n[0] + dy * hitSeg.n[1];
        const spread = 20 * Math.log10(FRIIS / Math.max(s1, 0.5));
        if (10 * Math.log10(gt) + spread > floorDb) stack.push([ex, ey, ez, dx, dy, dz, gt, s1, dep + 1, hitSeg]);
        if (10 * Math.log10(gr) + spread > floorDb) stack.push([ex, ey, ez, dx - 2 * dn * hitSeg.n[0], dy - 2 * dn * hitSeg.n[1], dz, gr, s1, dep + 1, hitSeg]);
      } else {
        const i = tabIndex(Math.abs(dz)), gr = g * (conc[i] * conc[i] + conc[i + 1] * conc[i + 1]);
        if (10 * Math.log10(gr) + 20 * Math.log10(FRIIS / Math.max(s1, 0.5)) > floorDb) stack.push([ex, ey, ez, dx, dy, -dz, gr, s1, dep + 1, null]);
      }
    }
  }
  return { pos, dist, pow, count, launched: n };
}
