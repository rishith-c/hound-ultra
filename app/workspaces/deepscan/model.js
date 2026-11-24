// The shared cross-section: one collapsed building, cut through, 24 m wide. Every exhibit looks at this same pile.
// It is generated from a seed. The layout follows the void types rescue teams are taught to look for
// (lean-to, V-shape, pancake, a cellar under the slab); the dimensions are invented.
import { rng, clamp, ss, col, tok, font } from './lib.js';

export const WORLD = { x0: 0, x1: 24, z0: -3, z1: 7.5, res: 0.1, nx: 240, nz: 105 };
export const MAT = { SKY: 0, SOIL: 1, RUBBLE: 2, SLAB: 3, STEEL: 4, VOID: 5, PERSON: 6 };
// Assumed, textbook-order material values. rho g/cm3; eps relative permittivity; vp P-wave speed m/s; loss radar loss weight.
export const PROPS = [
  { name: 'open air', rho: 0, eps: 1, vp: 343, loss: 0 },
  { name: 'soil', rho: 1.8, eps: 12, vp: 500, loss: 1.6 },
  { name: 'loose rubble', rho: 1.7, eps: 5, vp: 900, loss: 1 },
  { name: 'concrete slab', rho: 2.4, eps: 7, vp: 3800, loss: 1.2 },
  { name: 'steel', rho: 7.85, eps: 81, vp: 5900, loss: 30 },
  { name: 'air-filled void', rho: 0, eps: 1, vp: 343, loss: 0 },
  { name: 'person', rho: 1.0, eps: 50, vp: 1500, loss: 8 },
];
export const RHO_REF = 1.8; // what a rescuer would assume for "solid pile" before looking inside (assumed)

const inPoly = (p, x, z) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const areaOf = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a) / 2; };
const centroid = (p) => { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; };
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
// A slab seen edge-on: from p1 to p2 along its underside, thickness t upward.
function bar(p1, p2, t) { const dx = p2[0] - p1[0], dz = p2[1] - p1[1], L = Math.hypot(dx, dz); let nx = -dz / L, nz = dx / L; if (nz < 0) { nx = -nx; nz = -nz; } return [p1, p2, [p2[0] + nx * t, p2[1] + nz * t], [p1[0] + nx * t, p1[1] + nz * t]]; }

export function buildPile(seed = 7) {
  const r = rng(seed * 7919 + 13), { nx, nz, res, x0, z0 } = WORLD;
  const j = (v, d) => v + r.range(-d, d);
  // --- structure ---
  const wx = j(6.2, 0.35), wh = j(3.9, 0.25), ax = wx + 0.35, zt = wh - 0.5, fx = Math.min(11.9, ax + j(4.5, 0.35));
  const slabs = [], voids = [];
  slabs.push({ kind: 'ground slab', poly: rect(4.5, -0.25, 20.6, 0) });
  slabs.push({ kind: 'standing wall', poly: rect(wx, 0, ax, wh) });
  slabs.push({ kind: 'leaning floor slab', poly: bar([ax, zt], [fx, 0.25], 0.28) });
  const zuA = (x) => zt + (0.25 - zt) * (x - ax) / (fx - ax), bx = ax + (0.45 - zt) / (0.25 - zt) * (fx - ax);
  voids.push({ id: 'A', kind: 'lean-to void', note: 'under a floor slab leaning on a wall', poly: [[ax, 0], [ax, zt - 0.04], [bx, zuA(bx) - 0.02], [bx, 0]] });
  const p0 = r.range(0, 0.5), cL = 12.2 + p0, cR = 19.9 + p0, vb = j(16.2, 0.5) + p0;
  slabs.push({ kind: 'column stub', poly: rect(cL, 0, cL + 0.4, 2.5) }, { kind: 'column stub', poly: rect(cR, 0, cR + 0.4, 2.3) });
  slabs.push({ kind: 'pancaked floor', poly: bar([cL + 0.5, 0.42], [cR - 0.1, 0.55], 0.24) });
  const vz = j(1.05, 0.08);
  slabs.push({ kind: 'broken floor (V)', poly: bar([cL + 0.4, 2.35], [vb, vz], 0.24) }, { kind: 'broken floor (V)', poly: bar([vb, vz], [cR, 2.15], 0.24) });
  const zuB = (x) => vz + (2.15 - vz) * (x - vb) / (cR - vb), bxB = vb + (cR - vb) * 0.36;
  voids.push({ id: 'B', kind: 'V-shape void', note: 'under one half of a floor that broke in the middle', poly: [[cR - 0.05, 0.84], [cR - 0.05, zuB(cR - 0.05) - 0.03], [bxB, zuB(bxB) - 0.03], [bxB, 0.82]] });
  slabs.push({ kind: 'roof slab', poly: bar([cL + 0.1, 3.25], [cR + 0.5, 2.85], 0.26) });
  const cx = j(4.45, 0.25), cz = j(0.95, 0.1);
  slabs.push({ kind: 'slab fragment', poly: bar([cx - 0.8, cz + 0.6], [cx + 0.85, cz + 0.28], 0.2) });
  voids.push({ id: 'C', kind: 'small pocket', note: 'a gap under a slab fragment', poly: [[cx - 0.5, cz - 0.2], [cx - 0.22, cz + 0.36], [cx + 0.42, cz + 0.24], [cx + 0.58, cz - 0.15], [cx + 0.05, cz - 0.36]] });
  const dx0 = j(13.6, 0.3) + p0, dx1 = dx0 + j(2.8, 0.25), dzb = j(-2.05, 0.08);
  slabs.push({ kind: 'cellar wall', poly: rect(dx0 - 0.25, dzb - 0.22, dx0, -0.25) }, { kind: 'cellar wall', poly: rect(dx1, dzb - 0.22, dx1 + 0.25, -0.25) }, { kind: 'cellar floor', poly: rect(dx0 - 0.25, dzb - 0.22, dx1 + 0.25, dzb) });
  voids.push({ id: 'D', kind: 'cellar', note: 'an intact cellar under the ground slab', poly: rect(dx0, dzb, dx1, -0.25) });
  const beam = { kind: 'steel beam', poly: rect(16.9 + p0, 3.52, 17.16 + p0, 3.86) };
  // --- the person: lying on the floor of void A, head towards the wall ---
  const px = ax + r.range(0.45, 0.8);
  const person = { x: px + 0.85, z: 0.16, head: [px, 0.14, 0.115], parts: [[px + 0.55, 0.15, 0.36, 0.14], [px + 1.12, 0.13, 0.36, 0.105], [px + 1.5, 0.1, 0.3, 0.075]], // ellipses: cx, cz, rx, rz
    span: [px - 0.12, px + 1.8] };
  const inPerson = (x, z) => { const hd = person.head; if (Math.hypot(x - hd[0], z - hd[1]) < hd[2]) return true; for (const e of person.parts) { const u = (x - e[0]) / e[2], v = (z - e[1]) / e[3]; if (u * u + v * v < 1) return true; } return false; };
  // --- heap envelope: the debris that buries all of it ---
  const ph = [r.range(0, 6.28), r.range(0, 6.28), r.range(0, 6.28), r.range(0, 6.28)];
  const tops = [...slabs.map((s) => s.poly), beam.poly];
  const surf = new Float32Array(nx);
  for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * res;
    let h = (4.7 - 0.55 * ss((x - 11) / 3)) * ss((x - 1.0) / 5.0) * ss((23.0 - x) / 3.2);
    h += (0.13 * Math.sin(0.9 * x + ph[0]) + 0.08 * Math.sin(2.3 * x + ph[1]) + 0.05 * Math.sin(5.1 * x + ph[2]) + 0.03 * Math.sin(11 * x + ph[3])) * ss(h / 0.8);
    for (const p of tops) { let lo = 1e9, hi = -1e9, top = -1e9; for (const q of p) { lo = Math.min(lo, q[0]); hi = Math.max(hi, q[0]); top = Math.max(top, q[1]); } if (x > lo - 0.3 && x < hi + 0.3 && top > 0.1) h = Math.max(h, top + 0.3); }
    surf[i] = Math.max(0, h);
  }
  for (let k = 0; k < 3; k++) for (let i = 1; i < nx - 1; i++) surf[i] = Math.max(surf[i], (surf[i - 1] + surf[i + 1]) / 2 - 0.02); // no overhangs sharper than the cover
  const surfAt = (x) => { const f = (x - x0) / res - 0.5, i = clamp(Math.floor(f), 0, nx - 2), u = clamp(f - i, 0, 1); return surf[i] * (1 - u) + surf[i + 1] * u; };
  // --- rubble density texture (value noise, 1.4 m cells): the "geological noise" every method has to live with ---
  const gn = 20, gm = 10, gv = new Float32Array(gn * gm); for (let i = 0; i < gv.length; i++) gv[i] = r.range(-1, 1);
  const noise = (x, z) => { const fx2 = clamp(x / 1.4, 0, gn - 1.001), fz = clamp((z + 3) / 1.4, 0, gm - 1.001), i = Math.floor(fx2), k = Math.floor(fz), u = ss(fx2 - i), v = ss(fz - k);
    return (gv[k * gn + i] * (1 - u) + gv[k * gn + i + 1] * u) * (1 - v) + (gv[(k + 1) * gn + i] * (1 - u) + gv[(k + 1) * gn + i + 1] * u) * v; };
  // --- rasterise ---
  const mat = new Uint8Array(nx * nz), rho = new Float32Array(nx * nz), voidId = new Uint8Array(nx * nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * res, z = z0 + (k + 0.5) * res, q = k * nx + i;
    let m = z < 0 ? MAT.SOIL : z < surf[i] ? MAT.RUBBLE : MAT.SKY;
    if (m !== MAT.SKY) {
      for (let vi = 0; vi < voids.length; vi++) if (inPoly(voids[vi].poly, x, z)) { m = MAT.VOID; voidId[q] = vi + 1; break; }
      if (m === MAT.VOID && inPerson(x, z)) m = MAT.PERSON;
      if (m !== MAT.VOID && m !== MAT.PERSON) { for (const s of slabs) if (inPoly(s.poly, x, z)) { m = MAT.SLAB; break; } if (inPoly(beam.poly, x, z)) m = MAT.STEEL; }
    }
    mat[q] = m; rho[q] = m === MAT.RUBBLE ? 1.7 + 0.22 * noise(x, z) : PROPS[m].rho;
  }
  for (const v of voids) { v.area = areaOf(v.poly); v.c = centroid(v.poly); v.depth = surfAt(v.c[0]) - v.c[1]; let top = -1e9; for (const q of v.poly) top = Math.max(top, q[1]); v.roof = top; }
  // --- rubble pieces, for drawing only ---
  const chunks = [];
  for (let n = 0; n < 1500; n++) {
    const x = r.range(0.8, 23.2), z = r.range(-0.05, 5.4); if (z > surfAt(x) - 0.06) continue;
    const i = clamp(Math.floor((x - x0) / res), 0, nx - 1), k = clamp(Math.floor((z - z0) / res), 0, nz - 1), m = mat[k * nx + i];
    const rad = r.range(0.07, 0.24) * (r() < 0.12 ? 1.8 : 1), nv = 4 + Math.floor(r() * 3), a0 = r.range(0, 6.28), pts = [];
    for (let v = 0; v < nv; v++) { const a = a0 + v / nv * 6.283, rr = rad * r.range(0.6, 1.1); pts.push([x + Math.cos(a) * rr * 1.25, z + Math.sin(a) * rr * 0.8]); }
    chunks.push({ pts, rubble: m === MAT.RUBBLE, shade: r() });
  }
  const outline = []; for (let i = 0; i < nx; i++) if (surf[i] > 0.01) outline.push([x0 + (i + 0.5) * res, surf[i]]);
  const cellAt = (x, z) => clamp(Math.floor((z - z0) / res), 0, nz - 1) * nx + clamp(Math.floor((x - x0) / res), 0, nx - 1);
  return { seed, slabs, voids, beam, person, surf, surfAt, mat, rho, voidId, chunks, outline, cellAt, inPoly, tunnelZ: -2.72,
    matAt: (x, z) => mat[cellAt(x, z)], extent: [outline[0][0], outline[outline.length - 1][0]] };
}

// Line integral of a per-cell field from a to b (straight ray), in field-units x metres.
export function rayIntegral(field, xa, za, xb, zb, step = 0.05) {
  const { nx, nz, res, x0, z0 } = WORLD, L = Math.hypot(xb - xa, zb - za), n = Math.max(1, Math.ceil(L / step)), ds = L / n;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n, x = xa + (xb - xa) * u, z = za + (zb - za) * u;
    const ci = Math.floor((x - x0) / res), ck = Math.floor((z - z0) / res);
    if (ci < 0 || ck < 0 || ci >= nx || ck >= nz) continue;
    s += field[ck * nx + ci];
  }
  return s * ds;
}

// First-arrival travel times from one point through a slowness field (s/m per cell): Dijkstra on the grid with a
// 16-neighbour stencil. This is what lets a tap's wave bend around a void instead of crossing it.
const NB = []; for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1], [2, 1], [1, 2], [2, -1], [1, -2]]) { NB.push([dx, dz, Math.hypot(dx, dz)], [-dx, -dz, Math.hypot(dx, dz)]); }
export function eikonal(slow, sx, sz) {
  const { nx, nz, res, x0, z0 } = WORLD, T = new Float32Array(nx * nz).fill(Infinity), done = new Uint8Array(nx * nz);
  const hk = [], hv = []; // binary heap of (time, cell)
  const push = (t, q) => { let i = hk.length; hk.push(t); hv.push(q); while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= t) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = t; hv[i] = q; };
  const pop = () => { const q = hv[0], t = hk.pop(), v = hv.pop(), n = hk.length; if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && hk[c + 1] < hk[c]) c++; if (hk[c] >= t) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; } hk[i] = t; hv[i] = v; } return q; };
  const si = clamp(Math.floor((sx - x0) / res), 0, nx - 1), sk = clamp(Math.floor((sz - z0) / res), 0, nz - 1), s0 = sk * nx + si;
  T[s0] = 0; push(0, s0);
  while (hk.length) {
    const q = pop(); if (done[q]) continue; done[q] = 1; const t0 = T[q];
    const i = q % nx, k = (q - i) / nx, sq = slow[q];
    for (let n = 0; n < NB.length; n++) {
      const ii = i + NB[n][0], kk = k + NB[n][1]; if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
      const p = kk * nx + ii; if (done[p]) continue;
      const t = t0 + NB[n][2] * res * 0.5 * (sq + slow[p]);
      if (t < T[p]) { T[p] = t; push(t, p); }
    }
  }
  return T;
}
export function sampleGrid(G, x, z) { // bilinear
  const { nx, nz, res, x0, z0 } = WORLD, fx = clamp((x - x0) / res - 0.5, 0, nx - 1.001), fz = clamp((z - z0) / res - 0.5, 0, nz - 1.001), i = Math.floor(fx), k = Math.floor(fz), u = fx - i, v = fz - k;
  return (G[k * nx + i] * (1 - u) + G[k * nx + i + 1] * u) * (1 - v) + (G[(k + 1) * nx + i] * (1 - u) + G[(k + 1) * nx + i + 1] * u) * v;
}

// ---- drawing the section ----
// S: { c, X(x), Z(z), s (pixels per metre), w, h, pile, truth, thumb }
const path = (c, S, pts) => { c.beginPath(); for (let i = 0; i < pts.length; i++) { const x = S.X(pts[i][0]), y = S.Z(pts[i][1]); if (i) c.lineTo(x, y); else c.moveTo(x, y); } c.closePath(); };
export function pilePath(c, S) { const o = S.pile.outline; c.beginPath(); c.moveTo(S.X(o[0][0]), S.Z(0)); for (const p of o) c.lineTo(S.X(p[0]), S.Z(p[1])); c.lineTo(S.X(o[o.length - 1][0]), S.Z(0)); c.closePath(); }
export function drawPile(S, { interior = S.truth, dim = 1 } = {}) {
  const { c, pile } = S, gx0 = S.X(WORLD.x0) - 40, gx1 = S.X(WORLD.x1) + 40, gy = S.Z(0), s = S.s;
  c.save(); c.lineJoin = 'round';
  // soil
  const g = c.createLinearGradient(0, gy, 0, S.Z(WORLD.z0)); g.addColorStop(0, col('--bg-3', 0.95 * dim)); g.addColorStop(1, col('--bg-1', 0.9 * dim));
  c.fillStyle = g; c.fillRect(gx0, gy, gx1 - gx0, S.Z(WORLD.z0) - gy + 60);
  if (!S.thumb) { c.save(); c.beginPath(); c.rect(gx0, gy, gx1 - gx0, S.Z(WORLD.z0) - gy + 60); c.clip(); c.strokeStyle = col('--line-2', 0.5 * dim); c.lineWidth = 1; c.beginPath();
    for (let k = 0; k < 150; k++) { const hx = ((k * 0.6180339) % 1) * 25 - 0.5, hz = -0.25 - ((k * 0.3819) % 1) * 2.9, L = 0.12 + ((k * 0.77) % 1) * 0.2; c.moveTo(S.X(hx), S.Z(hz)); c.lineTo(S.X(hx + L), S.Z(hz + L * 0.5)); } c.stroke(); c.restore(); }
  // the pile body
  pilePath(c, S); c.fillStyle = col('--bg-4', dim); c.fill();
  c.save(); pilePath(c, S); c.clip();
  if (s > 9) { for (const ch of pile.chunks) { if (interior && !ch.rubble) continue; path(c, S, ch.pts); c.fillStyle = col(ch.shade > 0.5 ? '--bg-5' : '--bg-3', (0.55 + ch.shade * 0.4) * dim); c.fill(); if (s > 22) { c.strokeStyle = col('--line-3', 0.28 * dim); c.lineWidth = 0.8; c.stroke(); } } }
  c.restore();
  if (interior) {
    for (const v of pile.voids) { path(c, S, v.poly); c.fillStyle = tok('--bg-0'); c.fill(); }
    for (const sl of pile.slabs) { path(c, S, sl.poly); c.fillStyle = col('--line-3', 0.92 * dim); c.fill(); c.strokeStyle = col('--text-3', 0.75 * dim); c.lineWidth = 1; c.stroke();
      if (s > 26) { const p = sl.poly, m = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; const a = m(p[0], p[3], 0.5), b = m(p[1], p[2], 0.5); // rebar
        c.setLineDash([s * 0.12, s * 0.08]); c.strokeStyle = col('--bg-1', 0.6); c.beginPath(); c.moveTo(S.X(a[0]), S.Z(a[1])); c.lineTo(S.X(b[0]), S.Z(b[1])); c.stroke(); c.setLineDash([]); } }
    path(c, S, pile.beam.poly); c.fillStyle = tok('--text-2'); c.fill();
    for (const v of pile.voids) { path(c, S, v.poly); c.strokeStyle = col('--text-2', 0.55 * dim); c.lineWidth = 1; c.stroke(); }
    drawPerson(S, dim);
  }
  // surface and ground line
  const o = pile.outline; c.beginPath(); c.moveTo(gx0, gy + 0.5); c.lineTo(S.X(o[0][0]), gy + 0.5); for (const p of o) c.lineTo(S.X(p[0]), S.Z(p[1])); c.lineTo(S.X(o[o.length - 1][0]), gy + 0.5); c.lineTo(gx1, gy + 0.5);
  c.strokeStyle = col('--text-2', 0.8 * dim); c.lineWidth = S.thumb ? 1 : 1.25; c.stroke();
  c.restore();
}
export function drawPerson(S, dim = 1) {
  const { c, pile } = S, p = pile.person, e = (cx, cz, rx, rz) => { c.beginPath(); c.ellipse(S.X(cx), S.Z(cz), rx * S.s, rz * S.s, 0, 0, 6.2832); c.fill(); };
  c.save(); c.fillStyle = col('--person', dim); c.shadowColor = col('--person', 0.55 * dim); c.shadowBlur = S.thumb ? 3 : 10;
  e(p.head[0], p.head[1], p.head[2], p.head[2]); for (const q of p.parts) e(q[0], q[1], q[2], q[3]);
  c.restore();
}
export function voidLabels(S, verdicts) {
  const { c, pile } = S; c.save(); c.font = font(11, 600); c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const v of pile.voids) {
    const x = S.X(v.c[0]), y = S.Z(v.c[1] + (v.id === 'A' ? 0.5 : 0)), st = verdicts?.[v.id]?.state;
    const color = st === 'seen' ? '--ok' : st === 'hint' ? '--warn' : st === 'missed' ? '--text-3' : '--text-2';
    c.fillStyle = col('--bg-1', 0.9); c.fillRect(x - 9, y - 9, 18, 18); c.strokeStyle = col(color, 0.8); c.lineWidth = 1; c.strokeRect(x - 8.5, y - 8.5, 17, 17);
    c.fillStyle = tok(color); c.fillText(v.id, x, y + 0.5);
  }
  c.restore();
}
// Scale bar and depth ruler, drawn once per stage.
export function drawScale(S) {
  const { c } = S; c.save(); c.font = font(11); c.fillStyle = tok('--text-3'); c.strokeStyle = col('--line-3', 0.8); c.lineWidth = 1; c.textBaseline = 'middle';
  const x = S.X(WORLD.x0) + 6; c.textAlign = 'left';
  for (let z = Math.ceil(S.zr[0]); z <= S.zr[1]; z += S.s > 60 ? 0.5 : S.s > 24 ? 1 : 2) { const y = Math.round(S.Z(z)) + 0.5; if (y < 8 || y > S.h - 8) continue; c.beginPath(); c.moveTo(0, y); c.lineTo(5, y); c.stroke(); c.fillText((z > 0 ? '+' : '') + z + (z === 0 ? ' m, street level' : ''), 9, y); }
  const len = S.s > 120 ? 0.5 : S.s > 50 ? 1 : 2, bx = S.w - 18 - len * S.s, by = S.h - 16;
  c.strokeStyle = tok('--text-2'); c.beginPath(); c.moveTo(bx, by - 4); c.lineTo(bx, by); c.lineTo(bx + len * S.s, by); c.lineTo(bx + len * S.s, by - 4); c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillStyle = tok('--text-2'); c.fillText(len + ' m', bx + len * S.s / 2, by - 4);
  c.restore();
}
