// Structure lab: the settled pile as a voxel grid. Everything here is plain computation on the simulated pile:
// voxelise the boxes, exact Euclidean distance transform, Betti numbers of the solid (and of the solid thickened by r),
// and the persistence of each pocket of air: how wide its widest way in is, and how big a sphere fits inside.
// Grid layout: index = x + nx * (z + nz * y). Layer y = 0 is the ground slab, so the ground is part of the solid.

export function quatAxes(q) { // columns of the rotation matrix
  const [x, y, z, w] = q;
  return [[1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)], [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)], [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]];
}
export function pieceBoxes(piece, poses) { // world-space oriented boxes of one piece
  const o = piece.idx * 7, q = [poses[o + 3], poses[o + 4], poses[o + 5], poses[o + 6]], A = quatAxes(q);
  return piece.boxes.map((b) => ({ c: [poses[o] + A[0][0] * b.o[0] + A[1][0] * b.o[1] + A[2][0] * b.o[2], poses[o + 1] + A[0][1] * b.o[0] + A[1][1] * b.o[1] + A[2][1] * b.o[2], poses[o + 2] + A[0][2] * b.o[0] + A[1][2] * b.o[1] + A[2][2] * b.o[2]], A, h: b.h }));
}

export function voxelise(pile, poses, { res = 0.1, pad = 0.7, maxVox = 1.6e6 } = {}) {
  const boxes = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = 0;
  for (const p of pile.pieces) {
    if (!p.alive) continue;
    for (const b of pieceBoxes(p, poses)) {
      const ex = Math.abs(b.A[0][0]) * b.h[0] + Math.abs(b.A[1][0]) * b.h[1] + Math.abs(b.A[2][0]) * b.h[2];
      const ey = Math.abs(b.A[0][1]) * b.h[0] + Math.abs(b.A[1][1]) * b.h[1] + Math.abs(b.A[2][1]) * b.h[2];
      const ez = Math.abs(b.A[0][2]) * b.h[0] + Math.abs(b.A[1][2]) * b.h[1] + Math.abs(b.A[2][2]) * b.h[2];
      b.e = [ex, ey, ez]; b.piece = p.idx; boxes.push(b);
      if (b.c[1] + ey < 0.02) continue;
      x0 = Math.min(x0, b.c[0] - ex); x1 = Math.max(x1, b.c[0] + ex); z0 = Math.min(z0, b.c[2] - ez); z1 = Math.max(z1, b.c[2] + ez); y1 = Math.max(y1, b.c[1] + ey);
    }
  }
  x0 -= pad; x1 += pad; z0 -= pad; z1 += pad; y1 += pad;
  while ((x1 - x0) * (z1 - z0) * (y1 + res) / (res * res * res) > maxVox) res += 0.01;
  const nx = Math.ceil((x1 - x0) / res), nz = Math.ceil((z1 - z0) / res), ny = Math.ceil(y1 / res) + 1, n = nx * ny * nz, sl = nx * nz;
  const solid = new Uint8Array(n), owner = new Int16Array(n);
  solid.fill(1, 0, sl); owner.fill(-1, 0, sl);                         // the ground slab
  const eps = res * 0.2;
  for (const b of boxes) {
    const i0 = Math.max(0, Math.floor((b.c[0] - b.e[0] - x0) / res)), i1 = Math.min(nx - 1, Math.floor((b.c[0] + b.e[0] - x0) / res));
    const k0 = Math.max(0, Math.floor((b.c[2] - b.e[2] - z0) / res)), k1 = Math.min(nz - 1, Math.floor((b.c[2] + b.e[2] - z0) / res));
    const j0 = Math.max(1, Math.floor((b.c[1] - b.e[1]) / res) + 1), j1 = Math.min(ny - 1, Math.floor((b.c[1] + b.e[1]) / res) + 1);
    const [ax, ay, az] = b.A, hx = b.h[0] + eps, hy = b.h[1] + eps, hz = b.h[2] + eps;
    for (let j = j0; j <= j1; j++) { const dy = (j - 0.5) * res - b.c[1];
      for (let k = k0; k <= k1; k++) { const dz = z0 + (k + 0.5) * res - b.c[2]; let id = i0 + nx * (k + nz * j);
        for (let i = i0; i <= i1; i++, id++) { const dx = x0 + (i + 0.5) * res - b.c[0];
          if (Math.abs(dx * ax[0] + dy * ax[1] + dz * ax[2]) <= hx && Math.abs(dx * ay[0] + dy * ay[1] + dz * ay[2]) <= hy && Math.abs(dx * az[0] + dy * az[1] + dz * az[2]) <= hz) { solid[id] = 1; owner[id] = b.piece + 1; }
        } } }
  }
  const g = { res, nx, ny, nz, n, sl, x0, z0, solid, owner };
  g.pos = (id) => { const y = Math.floor(id / sl), r = id - y * sl, z = Math.floor(r / nx), x = r - z * nx; return [x0 + (x + 0.5) * res, (y - 0.5) * res, z0 + (z + 0.5) * res]; };
  g.at = (p) => { const x = Math.floor((p[0] - x0) / res), z = Math.floor((p[2] - z0) / res), y = Math.floor(p[1] / res) + 1; return (x < 0 || z < 0 || y < 0 || x >= nx || z >= nz || y >= ny) ? -1 : x + nx * (z + nz * y); };
  return g;
}

// Exact squared Euclidean distance (in voxels) from every voxel to the nearest solid voxel. Felzenszwalb and Huttenlocher's
// lower-envelope method, one pass per axis.
export function distanceTransform(g) {
  const { nx, ny, nz, n, sl, solid } = g, BIG = 1e9;
  const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = solid[i] ? 0 : BIG;
  const m = Math.max(nx, ny, nz), f = new Float64Array(m), o = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  const pass = (len, start, stride) => {
    for (let q = 0; q < len; q++) f[q] = d[start + q * stride];
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let p = v[k], s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
      while (s <= z[k]) { k--; p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; o[q] = dq * dq + f[v[k]]; }
    for (let q = 0; q < len; q++) d[start + q * stride] = o[q];
  };
  for (let y = 0; y < ny; y++) for (let zz = 0; zz < nz; zz++) pass(nx, nx * (zz + nz * y), 1);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) pass(nz, x + sl * y, nx);
  for (let zz = 0; zz < nz; zz++) for (let x = 0; x < nx; x++) pass(ny, x + nx * zz, sl);
  g.d2 = d;
  // roofed: is there solid somewhere above this voxel?
  const roofed = new Uint8Array(n);
  for (let zz = 0; zz < nz; zz++) for (let x = 0; x < nx; x++) { let seen = 0; for (let y = ny - 1; y >= 0; y--) { const id = x + nx * (zz + nz * y); if (solid[id] && y > 0) seen = 1; else roofed[id] = seen; } }
  g.roofed = roofed;
  return g;
}
export const clearance = (g, id) => Math.sqrt(g.d2[id]) * g.res - g.res / 2;      // free radius around a voxel centre, metres

// ---------------------------------------------------------------- Betti numbers
// The solid is a union of closed unit cubes. b0 counts its pieces (26-connectivity), b2 counts sealed cavities (pockets of
// air with no 6-connected way out), and b1, the tunnels, follows from the Euler characteristic: chi = b0 - b1 + b2.
// chi itself is counted exactly: vertices - edges + faces - cubes of the complex, by a 256-entry table over 2x2x2 blocks.
let LUT = null;
function eulerLUT() {
  if (LUT) return LUT; LUT = new Int8Array(256);
  // bit index of cube (dx, dy, dz) in {-1, 0}^3 around a lattice vertex: (dx + 1) + 2 (dy + 1) + 4 (dz + 1); the cube "at" the vertex is bit 7
  const bit = (x, y, z) => 1 << (x + 2 * y + 4 * z);
  const edge = [[bit(1, 0, 0), bit(1, 1, 0), bit(1, 0, 1), bit(1, 1, 1)], [bit(0, 1, 0), bit(1, 1, 0), bit(0, 1, 1), bit(1, 1, 1)], [bit(0, 0, 1), bit(1, 0, 1), bit(0, 1, 1), bit(1, 1, 1)]];
  const face = [[bit(1, 1, 0), bit(1, 1, 1)], [bit(1, 0, 1), bit(1, 1, 1)], [bit(0, 1, 1), bit(1, 1, 1)]];
  for (let c = 0; c < 256; c++) {
    let chi = c ? 1 : 0;
    for (const e of edge) if (c & (e[0] | e[1] | e[2] | e[3])) chi--;
    for (const fc of face) if (c & (fc[0] | fc[1])) chi++;
    if (c & bit(1, 1, 1)) chi--;
    LUT[c] = chi;
  }
  return LUT;
}
function makeUF(n) { const p = new Int32Array(n); for (let i = 0; i < n; i++) p[i] = i; const find = (a) => { while (p[a] !== a) { p[a] = p[p[a]]; a = p[a]; } return a; }; return { p, find, union(a, b) { a = find(a); b = find(b); if (a !== b) p[b] = a; } }; }

// S is a Uint8Array mask of the solid on an nx*ny*nz grid whose outer shell (except the ground side) is empty.
export function betti(S, nx, ny, nz) {
  const sl = nx * nz, n = S.length, lut = eulerLUT();
  let chi = 0;
  const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) ? 0 : S[x + nx * (z + nz * y)];
  for (let y = 0; y <= ny; y++) for (let z = 0; z <= nz; z++) for (let x = 0; x <= nx; x++) {
    const c = get(x - 1, y - 1, z - 1) | (get(x, y - 1, z - 1) << 1) | (get(x - 1, y, z - 1) << 2) | (get(x, y, z - 1) << 3) | (get(x - 1, y - 1, z) << 4) | (get(x, y - 1, z) << 5) | (get(x - 1, y, z) << 6) | (get(x, y, z) << 7);
    if (c) chi += lut[c];
  }
  const uf = makeUF(n);
  // solid: 26-connectivity, 13 forward neighbours
  const fw = []; for (let dy = 0; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { if (dy === 0 && (dz < 0 || (dz === 0 && dx <= 0))) continue; fw.push([dx, dy, dz]); }
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const id = x + nx * (z + nz * y);
    if (S[id]) { for (const [dx, dy, dz] of fw) { const X = x + dx, Y = y + dy, Z = z + dz; if (X < 0 || X >= nx || Y >= ny || Z < 0 || Z >= nz) continue; const j = X + nx * (Z + nz * Y); if (S[j]) uf.union(id, j); } }
    else { if (x + 1 < nx && !S[id + 1]) uf.union(id, id + 1); if (z + 1 < nz && !S[id + nx]) uf.union(id, id + nx); if (y + 1 < ny && !S[id + sl]) uf.union(id, id + sl); }
  }
  const out = uf.find(n - 1);                                           // a top corner: always open air
  let b0 = 0, b2 = 0; const cav = [];
  for (let i = 0; i < n; i++) if (uf.p[i] === i) { if (S[i]) b0++; else if (i !== out) { b2++; cav.push(i); } }
  return { b0, b1: b0 + b2 - chi, b2, chi, cavRoots: cav, find: uf.find };
}
// Known shapes with known answers; run once and shown in the page.
export function selfTest() {
  const make = (fn) => { const N = 9, S = new Uint8Array(N * N * N); for (let y = 0; y < N; y++) for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) S[x + N * (z + N * y)] = fn(x, y, z) ? 1 : 0; const r = betti(S, N, N, N); return [r.b0, r.b1, r.b2]; };
  const inb = (a, lo, hi) => a >= lo && a <= hi;
  const cases = [
    { name: 'solid block', want: [1, 0, 0], got: make((x, y, z) => inb(x, 2, 6) && inb(y, 2, 6) && inb(z, 2, 6)) },
    { name: 'hollow box', want: [1, 0, 1], got: make((x, y, z) => inb(x, 2, 6) && inb(y, 2, 6) && inb(z, 2, 6) && !(inb(x, 3, 5) && inb(y, 3, 5) && inb(z, 3, 5))) },
    { name: 'ring', want: [1, 1, 0], got: make((x, y, z) => y === 4 && inb(x, 2, 6) && inb(z, 2, 6) && !(inb(x, 3, 5) && inb(z, 3, 5))) },
    { name: 'two blocks', want: [2, 0, 0], got: make((x, y, z) => inb(y, 3, 5) && inb(z, 3, 5) && (inb(x, 1, 2) || inb(x, 6, 7))) },
    { name: 'box with a doorway', want: [1, 0, 0], got: make((x, y, z) => inb(x, 2, 6) && inb(y, 2, 6) && inb(z, 2, 6) && !(inb(x, 3, 5) && inb(y, 3, 5) && inb(z, 3, 5)) && !(x === 6 && y === 4 && z === 4)) },
    { name: 'box with two doorways', want: [1, 1, 0], got: make((x, y, z) => inb(x, 2, 6) && inb(y, 2, 6) && inb(z, 2, 6) && !(inb(x, 3, 5) && inb(y, 3, 5) && inb(z, 3, 5)) && !((x === 6 || x === 2) && y === 4 && z === 4)) },
  ];
  for (const c of cases) c.ok = c.got.join() === c.want.join();
  return { cases, ok: cases.every((c) => c.ok) };
}
// Betti numbers of the pile thickened by r (every voxel within r of the solid counts as solid). A generator: one radius per step.
export function* bettiCurve(g, radii) {
  const { n, nx, ny, nz, d2, res } = g, S = new Uint8Array(n), out = [];
  for (const r of radii) {
    const t = (r + res / 2) / res, t2 = r === 0 ? 0.5 : t * t;
    for (let i = 0; i < n; i++) S[i] = d2[i] < t2 ? 1 : 0;
    const b = betti(S, nx, ny, nz);
    out.push({ r, b0: b.b0, b1: b.b1, b2: b.b2, chi: b.chi });
    yield out;
  }
  return out;
}

// ---------------------------------------------------------------- pockets of air, by persistence
// Sweep the clearance from large to small and grow the air back in (superlevel sets of the distance function). A pocket is
// born at its widest point and dies when it first connects to an older pocket or to the open air: that level is its throat.
// By Alexander duality these are the cavities of the thickened solid, so (throat, inscribed radius) is its H2 persistence pair.
export function findVoids(g, { minRadius = 0.2, minPersist = 0.1, minVolume = 0.05 } = {}) {
  const { n, nx, ny, nz, sl, d2, solid, res, roofed } = g;
  // counting sort of the air voxels by squared distance, descending
  let maxD = 0; for (let i = 0; i < n; i++) if (!solid[i] && d2[i] > maxD) maxD = d2[i];
  const B = Math.min(1 << 20, Math.ceil(maxD) + 2), cnt = new Int32Array(B + 1);
  for (let i = 0; i < n; i++) if (!solid[i]) cnt[Math.min(B - 1, d2[i] | 0)]++;
  let acc = 0; const startAt = new Int32Array(B + 1); for (let b = B - 1; b >= 0; b--) { startAt[b] = acc; acc += cnt[b]; }
  const order = new Int32Array(acc), fill = startAt.slice();
  for (let i = 0; i < n; i++) if (!solid[i]) order[fill[Math.min(B - 1, d2[i] | 0)]++] = i;
  const parent = new Int32Array(n).fill(-1), peak = new Int32Array(n), size = new Int32Array(n), outside = new Uint8Array(n);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const dead = [];
  const nb = [1, -1, nx, -nx, sl, -sl];
  for (let q = 0; q < order.length; q++) {
    const v = order[q], y = Math.floor(v / sl), r = v - y * sl, z = Math.floor(r / nx), x = r - z * nx;
    parent[v] = v; peak[v] = v; size[v] = 1; outside[v] = (y === ny - 1 || x === 0 || x === nx - 1 || z === 0 || z === nz - 1) ? 1 : 0;
    for (let k = 0; k < 6; k++) {
      if ((k === 0 && x === nx - 1) || (k === 1 && x === 0) || (k === 2 && z === nz - 1) || (k === 3 && z === 0) || (k === 4 && y === ny - 1) || (k === 5 && y === 0)) continue;
      const u = v + nb[k]; if (parent[u] < 0) continue;
      let a = find(v), b = find(u); if (a === b) continue;
      // b dies into a unless b is the open air or is older (has the wider peak)
      if ((outside[b] && !outside[a]) || (outside[a] === outside[b] && d2[peak[b]] > d2[peak[a]])) { const t = a; a = b; b = t; }
      if (!outside[b] && d2[peak[b]] > d2[v]) dead.push({ peak: peak[b], throatD2: d2[v], saddle: v, size: size[b] });
      parent[b] = a; size[a] += size[b];
    }
  }
  for (let q = 0; q < order.length; q++) { const v = order[q]; if (parent[v] === v && !outside[v]) dead.push({ peak: peak[v], throatD2: 0, saddle: -1, size: size[v], sealed: true }); }
  const cl = (dd) => Math.sqrt(dd) * res - res / 2;
  const cand = dead.map((c) => ({ ...c, inscribed: cl(d2[c.peak]), throat: c.sealed ? 0 : cl(c.throatD2) })).filter((c) => c.inscribed >= minRadius && c.inscribed - c.throat >= minPersist && roofed[c.peak]);
  cand.sort((a, b) => b.size - a.size);
  const claimed = new Uint8Array(n), voids = []; let chambers = 0;
  for (const c of cand) {
    if (claimed[c.peak]) { chambers++; continue; }
    // the pocket's own voxels: flood from the peak through air strictly wider than the throat
    const stack = [c.peak], mine = []; const seen = new Set([c.peak]); let roof = 0, sx = 0, sy = 0, sz = 0, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    while (stack.length && mine.length < 120000) {
      const v = stack.pop(); mine.push(v);
      const y = Math.floor(v / sl), r = v - y * sl, z = Math.floor(r / nx), x = r - z * nx;
      roof += roofed[v]; const p = g.pos(v); sx += p[0]; sy += p[1]; sz += p[2];
      for (let a = 0; a < 3; a++) { if (p[a] < mn[a]) mn[a] = p[a]; if (p[a] > mx[a]) mx[a] = p[a]; }
      for (let k = 0; k < 6; k++) {
        if ((k === 0 && x === nx - 1) || (k === 1 && x === 0) || (k === 2 && z === nz - 1) || (k === 3 && z === 0) || (k === 4 && y === ny - 1) || (k === 5 && y === 0)) continue;
        const u = v + nb[k]; if (solid[u] || seen.has(u) || d2[u] <= c.throatD2) continue; seen.add(u); stack.push(u);
      }
    }
    const vol = mine.length * res * res * res;
    if (vol < minVolume || roof / mine.length < 0.5) continue;
    for (const v of mine) claimed[v] = 1;
    voids.push({ peak: c.peak, center: g.pos(c.peak), centroid: [sx / mine.length, sy / mine.length, sz / mine.length], inscribed: c.inscribed, throat: c.throat, sealed: !!c.sealed, saddle: c.saddle >= 0 ? g.pos(c.saddle) : null,
      volume: vol, voxels: Int32Array.from(mine), min: mn.map((a) => a - res / 2), max: mx.map((a) => a + res / 2), roofed: roof / mine.length });
  }
  voids.sort((a, b) => b.volume - a.volume);
  voids.forEach((v, i) => { v.id = 'V' + (i + 1); v.person = v.inscribed >= 0.25 && v.volume >= 0.3; });
  return { voids, chambers, raw: dead.length, pairs: dead.filter((c) => !c.sealed || true).map((c) => [c.sealed ? 0 : cl(c.throatD2), cl(d2[c.peak]), roofed[c.peak]]).filter((p) => p[1] - p[0] >= 0.05 && p[1] >= 0.1) };
}

// ---------------------------------------------------------------- the collapse pattern, from the geometry
// FEMA's four textbook patterns are read from where the floor planks ended up: how far they dropped, how steeply they lie,
// which way they dip, and whether a level plank has lost the support under one end.
export const PATTERNS = {
  pancake: { label: 'Pancake', voids: 'Small voids between the stacked floors, where contents and broken columns hold them apart.', fema: 'Shoring is usually needed under the floors; victims may be found under the floors.' },
  leanto: { label: 'Lean-to', voids: 'One large triangular void under the leaning floor, against the side that is still standing.', fema: 'Victims may be found under the suspended floor and on top of it at its low end.' },
  vshape: { label: 'V-shape', voids: 'Two triangular voids, one under each half of the floor, against the outer walls.', fema: 'Victims may be found under the two suspended floor pieces and on the floor in the middle of the V.' },
  cantilever: { label: 'Cantilever', voids: 'Voids under the hanging floor, as in a pancake. The unsupported end overhead is the hazard.', fema: 'Similar to the pancake pattern; victims may be found as in a pancake condition.' },
};
export function classify(pile, poses, g) {
  const planks = [];
  for (const p of pile.pieces) {
    if (p.kind !== 'plank' || !p.alive) continue;
    const o = p.idx * 7, A = quatAxes([poses[o + 3], poses[o + 4], poses[o + 5], poses[o + 6]]), up = A[1], ax = A[2];
    const tilt = Math.acos(Math.min(1, Math.abs(up[1]))) * 180 / Math.PI, y = poses[o + 1], drop = p.home[1] - y, L = p.boxes[0].h[2];
    const s = ax[1] > 0 ? -1 : 1, hl = Math.hypot(ax[0], ax[2]) || 1, dip = [s * ax[0] / hl, s * ax[2] / hl];
    const ends = [1, -1].map((e) => [poses[o] + ax[0] * e * (L - 0.05), y + ax[1] * e * (L - 0.05), poses[o + 2] + ax[2] * e * (L - 0.05)]);
    let cls = 'other';
    if (tilt < 15 && drop > 1.2) cls = 'flatLow'; else if (tilt < 15 && drop < 0.45) cls = 'flatHigh'; else if (tilt >= 15 && tilt <= 72) cls = 'inclined'; else if (tilt > 72) cls = 'hanging';
    let cant = false;
    if (cls === 'flatHigh' && g) { const sup = ends.map((e) => { for (let k = 1; k <= 4; k++) { const id = g.at([e[0], e[1] - 0.1 - k * g.res, e[2]]); if (id >= 0 && g.solid[id] && g.owner[id] !== p.idx + 1) return true; } return false; }); cant = sup[0] !== sup[1]; }
    planks.push({ idx: p.idx, tilt, drop, dip, cls, cant, pos: [poses[o], y, poses[o + 2]], level: p.level, L, w: p.boxes[0].h[0] });
  }
  const n = planks.length || 1, count = (f) => planks.filter(f).length;
  const lean = planks.filter((p) => p.cls === 'inclined' || p.cls === 'hanging');
  let mx = 0, mz = 0, c2 = 0, s2 = 0;
  for (const p of lean) { mx += p.dip[0]; mz += p.dip[1]; const a = Math.atan2(p.dip[1], p.dip[0]); c2 += Math.cos(2 * a); s2 += Math.sin(2 * a); }
  const R = lean.length ? Math.hypot(mx, mz) / lean.length : 0, axisA = Math.atan2(s2, c2) / 2, axis = [Math.cos(axisA), Math.sin(axisA)];
  const pos = lean.filter((p) => p.dip[0] * axis[0] + p.dip[1] * axis[1] > 0), neg = lean.filter((p) => p.dip[0] * axis[0] + p.dip[1] * axis[1] <= 0);
  const mean = (arr) => { const m = [0, 0]; for (const p of arr) { m[0] += p.pos[0]; m[1] += p.pos[2]; } return arr.length ? [m[0] / arr.length, m[1] / arr.length] : m; };
  const two = Math.min(pos.length, neg.length) >= 0.25 * lean.length && lean.length > 0;
  const Pp = mean(pos), Pn = mean(neg), toward = two && ((Pn[0] - Pp[0]) * axis[0] + (Pn[1] - Pp[1]) * axis[1]) > 0;
  const fLean = lean.length / n, fFlat = count((p) => p.cls === 'flatLow') / n, fCant = count((p) => p.cant) / n;
  const scores = { pancake: fFlat, leanto: fLean * R * R, vshape: two && toward ? fLean * (1 - R) : 0, cantilever: Math.min(1, 2.5 * fCant) };
  const order = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const sum = order.reduce((a, b) => a + b[1], 0) || 1;
  const verdict = order[0][1] < 0.15 ? 'mixed' : order[0][0];
  // where the textbook says the voids are, located on this pile
  const zones = []; const zoneOf = (arr, label) => { if (!arr.length) return; let a = [1e9, 1e9], b = [-1e9, -1e9], top = 0; for (const p of arr) { const ext = p.L * Math.cos(p.tilt * Math.PI / 180) + 0.1; a[0] = Math.min(a[0], p.pos[0] - (Math.abs(p.dip[0]) * ext + p.w)); b[0] = Math.max(b[0], p.pos[0] + Math.abs(p.dip[0]) * ext + p.w); a[1] = Math.min(a[1], p.pos[2] - (Math.abs(p.dip[1]) * ext + p.w)); b[1] = Math.max(b[1], p.pos[2] + Math.abs(p.dip[1]) * ext + p.w); top = Math.max(top, p.pos[1]); } zones.push({ label, min: [a[0], 0, a[1]], max: [b[0], top, b[1]] }); };
  const lvl1 = (arr) => arr.filter((p) => p.level === 1);
  if (verdict === 'vshape') { zoneOf(lvl1(pos), 'Under the suspended floor'); zoneOf(lvl1(neg), 'Under the suspended floor'); }
  else if (verdict === 'leanto') zoneOf(lvl1(lean).length ? lvl1(lean) : lean, 'Under the suspended floor');
  else if (verdict === 'cantilever') { zoneOf(planks.filter((p) => p.cant), 'Under the hanging floor'); }
  else if (verdict === 'pancake') zoneOf(planks.filter((p) => p.cls === 'flatLow'), 'Between the stacked floors');
  const tilts = lean.map((p) => p.tilt).sort((a, b) => a - b);
  return { verdict, scores, confidence: order[0][1] / sum, planks, zones,
    evidence: { n: planks.length, inclined: count((p) => p.cls === 'inclined'), hanging: count((p) => p.cls === 'hanging'), flatLow: count((p) => p.cls === 'flatLow'), standing: count((p) => p.cls === 'flatHigh' && !p.cant), cantilevered: count((p) => p.cant), other: count((p) => p.cls === 'other'), R, twoSided: two, toward, tiltMin: tilts[0] || 0, tiltMax: tilts[tilts.length - 1] || 0, dipAxis: axisA } };
}
