// Live algorithms on a point cloud. Nothing here knows what the scene contains: the input is only x, y, z.
//   1. groundModel   a terrain surface under buildings and rubble (progressive morphological filter)
//   2. classify      ground / structure / rubble / vegetation from height above ground and the shape of each
//                    neighbourhood (eigenvalues of the covariance of the points in a voxel and its 26 neighbours)
//   3. findVoids     voxelise, flood-fill the free space a 0.6 m probe can reach from open air, keep the reachable
//                    space that has cover above it inside the collapsed zone, and measure each pocket
//   4. occupancy     a 0.5 m map: floor seen and clear / something in the way / never seen
// Worker-safe: no DOM in this file.

export const CLASSES = ['Ground', 'Structure', 'Rubble', 'Vegetation'];

export function bounds(pos, n) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { const v = pos[i * 3 + a]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; }
  return { min, max };
}

// ---------------------------------------------------------------- 1. ground
function morph(src, w, h, r, isMin) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let m = src[j * w + i]; for (let d = Math.max(0, i - r); d <= Math.min(w - 1, i + r); d++) { const v = src[j * w + d]; if (isMin ? v < m : v > m) m = v; } tmp[j * w + i] = m; }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let m = tmp[j * w + i]; for (let d = Math.max(0, j - r); d <= Math.min(h - 1, j + r); d++) { const v = tmp[d * w + i]; if (isMin ? v < m : v > m) m = v; } out[j * w + i] = m; }
  return out;
}
export function groundModel(pos, n, B) {
  const res = 1, x0 = Math.floor(B.min[0]), y0 = Math.floor(B.min[1]), w = Math.max(2, Math.ceil(B.max[0] - x0) + 1), h = Math.max(2, Math.ceil(B.max[1] - y0) + 1);
  const A = new Float32Array(w * h).fill(Infinity), cnt = new Uint32Array(w * h);
  for (let i = 0; i < n; i++) { const k = ((pos[i * 3 + 1] - y0) | 0) * w + ((pos[i * 3] - x0) | 0), z = pos[i * 3 + 2]; cnt[k]++; if (z < A[k]) A[k] = z; }
  const known = new Uint8Array(w * h); let area = 0;
  for (let k = 0; k < w * h; k++) if (cnt[k]) { known[k] = 1; area++; }
  const fill = (Z, ok) => { // grow values into cells that have none, a ring at a time, then relax them
    const todo = new Uint8Array(w * h); let left = 0;
    for (let k = 0; k < w * h; k++) if (!ok[k]) { todo[k] = 1; left++; }
    const done = Uint8Array.from(ok);
    for (let guard = 0; left > 0 && guard < w + h; guard++) {
      const add = [];
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + i; if (done[k]) continue; let s = 0, c = 0; if (i > 0 && done[k - 1]) { s += Z[k - 1]; c++; } if (i < w - 1 && done[k + 1]) { s += Z[k + 1]; c++; } if (j > 0 && done[k - w]) { s += Z[k - w]; c++; } if (j < h - 1 && done[k + w]) { s += Z[k + w]; c++; } if (c) add.push(k, s / c); }
      if (!add.length) break;
      for (let q = 0; q < add.length; q += 2) { Z[add[q]] = add[q + 1]; done[add[q]] = 1; left--; }
    }
    for (let it = 0; it < 24; it++) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + i; if (!todo[k]) continue; Z[k] = (Z[i > 0 ? k - 1 : k] + Z[i < w - 1 ? k + 1 : k] + Z[j > 0 ? k - w : k] + Z[j < h - 1 ? k + w : k]) / 4; }
  };
  fill(A, known);
  let last = A; const flagged = new Uint8Array(w * h);
  for (const r of [1, 2, 4, 8, 16]) {
    if (r * 2 + 1 > Math.max(w, h)) break;
    const op = morph(morph(last, w, h, r, true), w, h, r, false), thr = 0.15 * r * res + 0.22;
    for (let k = 0; k < w * h; k++) if (last[k] - op[k] > thr) flagged[k] = 1;
    last = op;
  }
  const G = Float32Array.from(A), ok = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) ok[k] = flagged[k] ? 0 : 1;
  fill(G, ok);
  // one light smoothing pass, so the surface does not step from cell to cell
  const Z = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let s = 0, c = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= w || b >= h) continue; const wt = di || dj ? 1 : 4; s += G[b * w + a] * wt; c += wt; } Z[j * w + i] = s / c; }
  return { res, x0, y0, w, h, z: Z, cnt, area };
}
export function groundZ(g, x, y) {
  let fx = (x - g.x0) / g.res - 0.5, fy = (y - g.y0) / g.res - 0.5;
  if (fx < 0) fx = 0; else if (fx > g.w - 1.001) fx = g.w - 1.001; if (fy < 0) fy = 0; else if (fy > g.h - 1.001) fy = g.h - 1.001;
  const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * g.w + i, z = g.z;
  return z[k] * (1 - u) * (1 - v) + z[k + 1] * u * (1 - v) + z[k + g.w] * (1 - u) * v + z[k + g.w + 1] * u * v;
}

// ---------------------------------------------------------------- 2. classification
// Eigenvalues (l1 >= l2 >= l3) of a symmetric 3x3 matrix and the direction of least spread (the surface normal).
const E = { l1: 0, l2: 0, l3: 0, nz: 0 };
function eig3(a00, a01, a02, a11, a12, a22) {
  const p1 = a01 * a01 + a02 * a02 + a12 * a12, q = (a00 + a11 + a22) / 3;
  const b00 = a00 - q, b11 = a11 - q, b22 = a22 - q, p2 = b00 * b00 + b11 * b11 + b22 * b22 + 2 * p1;
  if (p2 < 1e-18) { E.l1 = E.l2 = E.l3 = q; E.nz = 1; return; }
  const p = Math.sqrt(p2 / 6), r = (b00 * (b11 * b22 - a12 * a12) - a01 * (a01 * b22 - a12 * a02) + a02 * (a01 * a12 - b11 * a02)) / (2 * p * p * p);
  const phi = r <= -1 ? Math.PI / 3 : r >= 1 ? 0 : Math.acos(r) / 3;
  const l1 = q + 2 * p * Math.cos(phi), l3 = q + 2 * p * Math.cos(phi + 2.0943951023931953), l2 = 3 * q - l1 - l3;
  E.l1 = l1; E.l2 = l2; E.l3 = l3 < 0 ? 0 : l3;
  const r0x = a00 - l3, r0y = a01, r0z = a02, r1x = a01, r1y = a11 - l3, r1z = a12, r2x = a02, r2y = a12, r2z = a22 - l3;
  let bx = r0y * r1z - r0z * r1y, by = r0z * r1x - r0x * r1z, bz = r0x * r1y - r0y * r1x, bn = bx * bx + by * by + bz * bz;
  let cx = r0y * r2z - r0z * r2y, cy = r0z * r2x - r0x * r2z, cz = r0x * r2y - r0y * r2x, cn = cx * cx + cy * cy + cz * cz;
  if (cn > bn) { bx = cx; by = cy; bz = cz; bn = cn; }
  cx = r1y * r2z - r1z * r2y; cy = r1z * r2x - r1x * r2z; cz = r1x * r2y - r1y * r2x; cn = cx * cx + cy * cy + cz * cz;
  if (cn > bn) { bz = cz; bn = cn; }
  E.nz = bn > 0 ? Math.abs(bz) / Math.sqrt(bn) : 1;
}

export function classify(pos, n, B, g, truth) {
  const hag = new Float32Array(n), cls = new Uint8Array(n);
  const GROUND = 0.18;
  for (let i = 0; i < n; i++) hag[i] = pos[i * 3 + 2] - groundZ(g, pos[i * 3], pos[i * 3 + 1]);
  // voxel grid; grow the voxel if the cloud is huge
  let vs = 0.5; const ext = [B.max[0] - B.min[0], B.max[1] - B.min[1], B.max[2] - B.min[2]];
  while ((ext[0] / vs + 2) * (ext[1] / vs + 2) * (ext[2] / vs + 2) > 9e6) vs *= 1.26;
  const nx = Math.floor(ext[0] / vs) + 1, ny = Math.floor(ext[1] / vs) + 1, nz = Math.floor(ext[2] / vs) + 1, inv = 1 / vs;
  const slotOf = new Int32Array(nx * ny * nz).fill(-1), vox = new Int32Array(n);
  let ns = 0; const key = [];
  for (let i = 0; i < n; i++) {
    if (hag[i] < GROUND) { vox[i] = -1; continue; }
    const k = (((pos[i * 3 + 2] - B.min[2]) * inv) | 0) * nx * ny + (((pos[i * 3 + 1] - B.min[1]) * inv) | 0) * nx + (((pos[i * 3] - B.min[0]) * inv) | 0);
    let s = slotOf[k]; if (s < 0) { s = slotOf[k] = ns++; key.push(k); }
    vox[i] = s;
  }
  const M = new Float64Array(ns * 10), hsum = new Float32Array(ns);
  for (let i = 0; i < n; i++) {
    const s = vox[i]; if (s < 0) continue;
    const x = pos[i * 3] - B.min[0], y = pos[i * 3 + 1] - B.min[1], z = pos[i * 3 + 2] - B.min[2], o = s * 10;
    M[o]++; M[o + 1] += x; M[o + 2] += y; M[o + 3] += z; M[o + 4] += x * x; M[o + 5] += x * y; M[o + 6] += x * z; M[o + 7] += y * y; M[o + 8] += y * z; M[o + 9] += z * z; hsum[s] += hag[i];
  }
  // per 1 m column: the highest return above ground, and whether a flat or upright surface was seen in it
  const cw = g.w, colTop = new Float32Array(g.w * g.h), colPlanar = new Uint8Array(g.w * g.h), colWall = new Uint8Array(g.w * g.h);
  const colOf = (x, y) => Math.min(g.h - 1, Math.max(0, (y - g.y0) | 0)) * cw + Math.min(g.w - 1, Math.max(0, (x - g.x0) | 0));
  for (let i = 0; i < n; i++) { const c = colOf(pos[i * 3], pos[i * 3 + 1]); if (hag[i] > colTop[c]) colTop[c] = hag[i]; }
  // shape of each neighbourhood
  const kind = new Uint8Array(ns); // 0 sparse, 1 flat, 2 upright, 3 tilted plane, 4 rough, 5 thin line
  const mh = new Float32Array(ns), m = new Float64Array(10);
  for (let s = 0; s < ns; s++) {
    const k = key[s], iz = (k / (nx * ny)) | 0, iy = ((k - iz * nx * ny) / nx) | 0, ix = k - iz * nx * ny - iy * nx;
    m.fill(0);
    for (let dz = -1; dz <= 1; dz++) { const z = iz + dz; if (z < 0 || z >= nz) continue; for (let dy = -1; dy <= 1; dy++) { const y = iy + dy; if (y < 0 || y >= ny) continue; for (let dx = -1; dx <= 1; dx++) { const x = ix + dx; if (x < 0 || x >= nx) continue; const t = slotOf[(z * ny + y) * nx + x]; if (t < 0) continue; const o = t * 10; for (let q = 0; q < 10; q++) m[q] += M[o + q]; } } }
    mh[s] = hsum[s] / M[s * 10];
    const c = m[0];
    if (c < 6) { kind[s] = 0; continue; }
    const mx = m[1] / c, my = m[2] / c, mz = m[3] / c;
    eig3(m[4] / c - mx * mx, m[5] / c - mx * my, m[6] / c - mx * mz, m[7] / c - my * my, m[8] / c - my * mz, m[9] / c - mz * mz);
    const sum = E.l1 + E.l2 + E.l3 || 1e-9, rough = E.l3 / sum;
    // A wall scanned from both sides, or a roof seen from above and below, is two sheets a hand apart: still a plane.
    if (E.l2 / (E.l1 || 1e-9) < 0.035) kind[s] = 5;
    else if (E.nz < 0.3 && rough < 0.05) kind[s] = 2;
    else if (E.nz > 0.966 && rough < (mh[s] > 2.2 ? 0.03 : 0.0075)) kind[s] = 1;
    else if (rough < 0.012) kind[s] = 3;
    else kind[s] = 4;
    if (kind[s] === 1 || kind[s] === 2) { const cx = ((B.min[0] + (ix + 0.5) * vs - g.x0) | 0), cy = ((B.min[1] + (iy + 0.5) * vs - g.y0) | 0); if (cx >= 0 && cy >= 0 && cx < g.w && cy < g.h) { colPlanar[cy * cw + cx] = 1; if (kind[s] === 2) colWall[cy * cw + cx] = 1; } }
  }
  // first label per voxel: 1 structure, 2 rubble, 3 vegetation
  const lab = new Uint8Array(ns);
  for (let s = 0; s < ns; s++) {
    const k = key[s], iz = (k / (nx * ny)) | 0, iy = ((k - iz * nx * ny) / nx) | 0, ix = k - iz * nx * ny - iy * nx;
    const c = colOf(B.min[0] + (ix + 0.5) * vs, B.min[1] + (iy + 0.5) * vs), h = mh[s], kd = kind[s];
    if (kd === 2) lab[s] = 1;                                              // upright plane: a wall
    else if (kd === 1) lab[s] = h > 0.3 && h < 2.3 ? 2 : 1;                 // flat: a roof or ceiling; low down, a fallen slab or a table top
    else if (kd === 3) lab[s] = h < 3.4 ? 2 : 1;                            // tilted plane: a displaced slab, or a pitched roof if high
    else if (kd === 5) lab[s] = colTop[c] > 4 && !colPlanar[c] ? 3 : 1;     // thin line: a trunk under a crown, or a pole
    else if (kd === 4) lab[s] = h > 3.2 ? (colPlanar[c] ? 1 : 3) : colTop[c] > 4.2 && !colPlanar[c] ? 3 : colWall[c] && h > 1.0 ? 1 : 2; // rough: foliage if high and nothing flat nearby; the top of a wall where it meets a ceiling; else rubble
    else lab[s] = h > 3.4 && !colPlanar[c] ? 3 : h > 2.2 || colPlanar[c] ? 1 : 2;
  }
  // two rounds of voting among neighbours tidy the edges (a wall's corner is not rubble)
  for (let round = 0; round < 2; round++) {
    const next = new Uint8Array(ns), v = [0, 0, 0, 0];
    for (let s = 0; s < ns; s++) {
      const k = key[s], iz = (k / (nx * ny)) | 0, iy = ((k - iz * nx * ny) / nx) | 0, ix = k - iz * nx * ny - iy * nx;
      v[1] = v[2] = v[3] = 0;
      for (let dz = -1; dz <= 1; dz++) { const z = iz + dz; if (z < 0 || z >= nz) continue; for (let dy = -1; dy <= 1; dy++) { const y = iy + dy; if (y < 0 || y >= ny) continue; for (let dx = -1; dx <= 1; dx++) { const x = ix + dx; if (x < 0 || x >= nx) continue; const t = slotOf[(z * ny + y) * nx + x]; if (t < 0) continue; v[lab[t]] += Math.sqrt(M[t * 10]) * (t === s ? 2.5 : 1); } } }
      next[s] = v[1] >= v[2] && v[1] >= v[3] ? 1 : v[2] >= v[3] ? 2 : 3;
    }
    lab.set(next);
  }
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) { const c = vox[i] < 0 ? 0 : lab[vox[i]]; cls[i] = c; counts[c]++; }
  // local point spacing (for drawing each point just big enough to close the surface): stored as metres x 500
  const sp = new Uint8Array(n), a2 = vs * vs;
  for (let i = 0; i < n; i++) { const s = vox[i] < 0 ? 1 / Math.sqrt(g.cnt[colOf(pos[i * 3], pos[i * 3 + 1])] || 1) : Math.sqrt(a2 / M[vox[i] * 10]); sp[i] = Math.max(8, Math.min(150, Math.round(s * 500))); }
  let confusion = null, accuracy = null;
  if (truth) { // check against the simulator's own labels. Row = what it really is, column = what the algorithm said.
    confusion = Array.from({ length: 5 }, () => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) confusion[truth[i]][cls[i]]++;
    let ok = 0, tot = 0; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { tot += confusion[r][c]; if (r === c) ok += confusion[r][c]; }
    accuracy = ok / tot;
  }
  return { hag, cls, sp, counts, confusion, accuracy, voxel: vs, voxels: ns };
}

// ---------------------------------------------------------------- 3. survivable voids
const DIRS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
export const compass = (dx, dy) => DIRS[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];

// Naive surface nets on a block of voxels (1 = inside), then a little smoothing: a soft skin instead of cubes.
function skin(mask, nx, ny, nz, ox, oy, oz, v) {
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 0 : mask[(z * ny + y) * nx + x]);
  const cx = nx + 1, cy = ny + 1, cz = nz + 1, vid = new Int32Array(cx * cy * cz).fill(-1), P = [], idx = [];
  for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) {
    let c = 0, sx = 0, sy = 0, sz = 0, cnt = 0;
    const f = [at(x - 1, y - 1, z - 1), at(x, y - 1, z - 1), at(x - 1, y, z - 1), at(x, y, z - 1), at(x - 1, y - 1, z), at(x, y - 1, z), at(x - 1, y, z), at(x, y, z)];
    for (let q = 0; q < 8; q++) c += f[q];
    if (c === 0 || c === 8) continue;
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) { const d = a ^ b; if ((d === 1 || d === 2 || d === 4) && f[a] !== f[b]) { sx += ((a & 1) + (b & 1)) / 2; sy += (((a >> 1) & 1) + ((b >> 1) & 1)) / 2; sz += ((a >> 2) + (b >> 2)) / 2; cnt++; } }
    vid[(z * cy + y) * cx + x] = P.length / 3;
    P.push(x - 1 + sx / cnt + 0.5, y - 1 + sy / cnt + 0.5, z - 1 + sz / cnt + 0.5);
  }
  const V = (x, y, z) => vid[(z * cy + y) * cx + x];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const a = at(x, y, z);
    if (a !== at(x + 1, y, z)) { const q = [V(x + 1, y, z), V(x + 1, y + 1, z), V(x + 1, y + 1, z + 1), V(x + 1, y, z + 1)]; if (a) idx.push(q[0], q[1], q[2], q[0], q[2], q[3]); else idx.push(q[0], q[2], q[1], q[0], q[3], q[2]); }
    if (a !== at(x, y + 1, z)) { const q = [V(x, y + 1, z), V(x, y + 1, z + 1), V(x + 1, y + 1, z + 1), V(x + 1, y + 1, z)]; if (a) idx.push(q[0], q[1], q[2], q[0], q[2], q[3]); else idx.push(q[0], q[2], q[1], q[0], q[3], q[2]); }
    if (a !== at(x, y, z + 1)) { const q = [V(x, y, z + 1), V(x + 1, y, z + 1), V(x + 1, y + 1, z + 1), V(x, y + 1, z + 1)]; if (a) idx.push(q[0], q[1], q[2], q[0], q[2], q[3]); else idx.push(q[0], q[2], q[1], q[0], q[3], q[2]); }
  }
  // boundary faces on the low side of the block
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) if (at(0, y, z)) { const q = [V(0, y, z), V(0, y, z + 1), V(0, y + 1, z + 1), V(0, y + 1, z)]; idx.push(q[0], q[1], q[2], q[0], q[2], q[3]); }
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) if (at(x, 0, z)) { const q = [V(x, 0, z), V(x + 1, 0, z), V(x + 1, 0, z + 1), V(x, 0, z + 1)]; idx.push(q[0], q[1], q[2], q[0], q[2], q[3]); }
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (at(x, y, 0)) { const q = [V(x, y, 0), V(x, y + 1, 0), V(x + 1, y + 1, 0), V(x + 1, y, 0)]; idx.push(q[0], q[1], q[2], q[0], q[2], q[3]); }
  const nv = P.length / 3, acc = new Float32Array(nv * 3), deg = new Uint16Array(nv);
  for (let it = 0; it < 3; it++) {
    acc.fill(0); deg.fill(0);
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], b = idx[t + ((e + 1) % 3)]; acc[a * 3] += P[b * 3]; acc[a * 3 + 1] += P[b * 3 + 1]; acc[a * 3 + 2] += P[b * 3 + 2]; deg[a]++; }
    for (let i = 0; i < nv; i++) if (deg[i]) for (let a = 0; a < 3; a++) P[i * 3 + a] = P[i * 3 + a] * 0.45 + (acc[i * 3 + a] / deg[i]) * 0.55;
  }
  const out = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) { out[i * 3] = ox + P[i * 3] * v; out[i * 3 + 1] = oy + P[i * 3 + 1] * v; out[i * 3 + 2] = oz + P[i * 3 + 2] * v; }
  return { pos: out, idx: Uint32Array.from(idx) };
}

// origin(time, out) gives the scanner position for a point, when the scan recorded it (the simulated scan does).
export function findVoids(pos, n, cls, hag, g, B, { minH = 0.5, minL = 1.2, whole = false, time = null, origin = null } = {}) {
  const V = 0.2, PROBE = 0.6;
  // the collapsed zone: 1 m columns where most of what stands above the ground is rubble
  const cw = g.w, ch = g.h, nR = new Uint16Array(cw * ch), nA = new Uint16Array(cw * ch);
  for (let i = 0; i < n; i++) { if (cls[i] === 0 || cls[i] === 3) continue; const k = Math.min(ch - 1, (pos[i * 3 + 1] - g.y0) | 0) * cw + Math.min(cw - 1, (pos[i * 3] - g.x0) | 0); if (nA[k] < 65535) nA[k]++; if (cls[i] === 2 && nR[k] < 65535) nR[k]++; }
  let zone = new Uint8Array(cw * ch);
  for (let k = 0; k < cw * ch; k++) zone[k] = whole ? (g.cnt[k] ? 1 : 0) : nR[k] >= 10 && nR[k] >= 0.45 * nA[k] ? 1 : 0;
  const grow = (src, r) => { const o = new Uint8Array(cw * ch); for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) { let v = 0; for (let dj = -r; dj <= r && !v; dj++) for (let di = -r; di <= r; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < cw && b < ch && src[b * cw + a]) { v = 1; break; } } o[j * cw + i] = v; } return o; };
  // connected patches of zone, at least 8 m2 each
  const comp = new Int32Array(cw * ch).fill(-1), patches = [];
  const z1 = whole ? zone : grow(zone, 1);
  for (let s = 0; s < cw * ch; s++) {
    if (!z1[s] || comp[s] >= 0) continue;
    const id = patches.length, st = [s]; comp[s] = id; let x0 = cw, x1 = 0, y0 = ch, y1 = 0, cells = 0, core = 0;
    while (st.length) { const k = st.pop(), i = k % cw, j = (k / cw) | 0; cells++; if (zone[k]) core++; if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j;
      if (i > 0 && z1[k - 1] && comp[k - 1] < 0) { comp[k - 1] = id; st.push(k - 1); } if (i < cw - 1 && z1[k + 1] && comp[k + 1] < 0) { comp[k + 1] = id; st.push(k + 1); } if (j > 0 && z1[k - cw] && comp[k - cw] < 0) { comp[k - cw] = id; st.push(k - cw); } if (j < ch - 1 && z1[k + cw] && comp[k + cw] < 0) { comp[k + cw] = id; st.push(k + cw); } }
    patches.push({ id, x0, x1, y0, y1, cells, core, keep: whole || core >= 12 }); // smaller than 12 m2 is a vehicle or a pile of furniture, not a collapse
  }
  const zones = [], voids = []; let rejected = 0, zoneArea = 0, voxels = 0;
  const tmpO = [0, 0, 0];
  for (const p of patches) {
    if (!p.keep) continue;
    zoneArea += p.core;
    const m = whole ? 0 : 3, bx0 = Math.max(0, p.x0 - m), bx1 = Math.min(cw - 1, p.x1 + m), by0 = Math.max(0, p.y0 - m), by1 = Math.min(ch - 1, p.y1 + m);
    const wx0 = g.x0 + bx0, wy0 = g.y0 + by0, wx1 = g.x0 + bx1 + 1, wy1 = g.y0 + by1 + 1;
    zones.push({ x0: g.x0 + p.x0 - 1, y0: g.y0 + p.y0 - 1, x1: g.x0 + p.x1 + 2, y1: g.y0 + p.y1 + 2, area: p.core });
    // the block of voxels around this patch
    let gz0 = Infinity, gz1 = -Infinity;
    for (let j = by0; j <= by1; j++) for (let i = bx0; i <= bx1; i++) { const z = g.z[j * cw + i]; if (z < gz0) gz0 = z; if (z > gz1) gz1 = z; }
    const wz0 = gz0 - 0.4, wz1 = Math.min(B.max[2] + 0.4, gz1 + 5.2);
    let nx = Math.ceil((wx1 - wx0) / V), ny = Math.ceil((wy1 - wy0) / V), nz = Math.ceil((wz1 - wz0) / V);
    if (nx * ny * nz > 14e6) continue; // far too large to search at this resolution (only with "whole scan" on a big file)
    voxels += nx * ny * nz;
    const N = nx * ny * nz, sxy = nx * ny, raw = new Uint8Array(N), solid = new Uint8Array(N), inv = 1 / V; // raw: 1 = a return, 2 = a return classed as rubble
    for (let i = 0; i < n; i++) {
      if (cls[i] === 3) continue;
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (x < wx0 || y < wy0 || z < wz0 || x >= wx1 || y >= wy1 || z >= wz1) continue;
      if (hag[i] < 0.12) continue; // the floor itself is added below, as solid ground
      const k = (((z - wz0) * inv) | 0) * sxy + (((y - wy0) * inv) | 0) * nx + (((x - wx0) * inv) | 0);
      if (cls[i] === 2 || whole) raw[k] = 2; else if (!raw[k]) raw[k] = 1;
    }
    // ground is solid; then thicken everything by one voxel: what is left is where the centre of a 0.6 m probe fits
    const gcol = new Int16Array(sxy);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { const gz = groundZ(g, wx0 + (x + 0.5) * V, wy0 + (y + 0.5) * V), top = Math.max(0, Math.min(nz, Math.floor((gz + 0.06 - wz0) * inv) + 1)); gcol[y * nx + x] = top; for (let z = 0; z < top; z++) solid[z * sxy + y * nx + x] = 1; }
    const bar = new Uint8Array(N);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = z * sxy + y * nx + x; if (!raw[k] && !solid[k]) continue;
      for (let dz = -1; dz <= 1; dz++) { const c = z + dz; if (c < 0 || c >= nz) continue; for (let dy = -1; dy <= 1; dy++) { const b = y + dy; if (b < 0 || b >= ny) continue; for (let dx = -1; dx <= 1; dx++) { const a = x + dx; if (a < 0 || a >= nx) continue; bar[c * sxy + b * nx + a] = 1; } } }
    }
    // cover: displaced material (rubble class) higher up in the same column, within 3.2 m. A roof still in place does not count.
    const covered = new Uint8Array(N), maxUp = Math.round(3.2 / V);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { let lastOcc = -1; const c = y * nx + x; for (let z = nz - 1; z >= gcol[c]; z--) { const k = z * sxy + c; if (raw[k] === 2) lastOcc = z; else if (!raw[k] && lastOcc >= 0 && lastOcc - z <= maxUp) covered[k] = 1; } }
    // flood fill: start in open air (free, nothing overhead), spread through free space, remember the way back
    const dist = new Int32Array(N).fill(-1), prev = new Int32Array(N).fill(-1), queue = new Int32Array(N); let qh = 0, qt = 0;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { const c = y * nx + x; for (let z = nz - 1; z >= 0; z--) { const k = z * sxy + c; if (bar[k]) break; if (covered[k]) break; dist[k] = 0; queue[qt++] = k; } }
    while (qh < qt) {
      const k = queue[qh++], z = (k / sxy) | 0, r = k - z * sxy, y = (r / nx) | 0, x = r - y * nx, d = dist[k] + 1;
      if (x > 0 && dist[k - 1] < 0 && !bar[k - 1]) { dist[k - 1] = d; prev[k - 1] = k; queue[qt++] = k - 1; }
      if (x < nx - 1 && dist[k + 1] < 0 && !bar[k + 1]) { dist[k + 1] = d; prev[k + 1] = k; queue[qt++] = k + 1; }
      if (y > 0 && dist[k - nx] < 0 && !bar[k - nx]) { dist[k - nx] = d; prev[k - nx] = k; queue[qt++] = k - nx; }
      if (y < ny - 1 && dist[k + nx] < 0 && !bar[k + nx]) { dist[k + nx] = d; prev[k + nx] = k; queue[qt++] = k + nx; }
      if (z > 0 && dist[k - sxy] < 0 && !bar[k - sxy]) { dist[k - sxy] = d; prev[k - sxy] = k; queue[qt++] = k - sxy; }
      if (z < nz - 1 && dist[k + sxy] < 0 && !bar[k + sxy]) { dist[k + sxy] = d; prev[k + sxy] = k; queue[qt++] = k + sxy; }
    }
    // sheltered space the probe reaches, inside the zone (grown by 1.5 m so the edge of a pocket is not cut off)
    const zmask = whole ? null : grow(zone, 2), core = new Uint8Array(N);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) { const cj = Math.min(ch - 1, ((wy0 + (y + 0.5) * V - g.y0) | 0)); for (let x = 0; x < nx; x++) { const k = z * sxy + y * nx + x; if (dist[k] <= 0 || !covered[k]) continue; if (zmask) { const ci = Math.min(cw - 1, ((wx0 + (x + 0.5) * V - g.x0) | 0)); if (!zmask[cj * cw + ci]) continue; } core[k] = 1; } }
    // give back the voxel of margin the probe took, wherever the scan has no return
    const vol = new Uint8Array(N);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = z * sxy + y * nx + x; if (!core[k]) continue;
      for (let dz = -1; dz <= 1; dz++) { const c = z + dz; if (c < 0 || c >= nz) continue; for (let dy = -1; dy <= 1; dy++) { const b = y + dy; if (b < 0 || b >= ny) continue; for (let dx = -1; dx <= 1; dx++) { const a = x + dx; if (a < 0 || a >= nx) continue; const q = c * sxy + b * nx + a; if (!raw[q] && !solid[q] && (covered[q] || core[q])) vol[q] = 1; } } }
    }
    // which voxels did a beam actually pass through? (only when the scan recorded where the scanner was)
    let seen = null;
    if (time && origin) {
      seen = new Uint8Array(N);
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        if (x < wx0 || y < wy0 || z < wz0 || x >= wx1 || y >= wy1 || z >= wz1) continue;
        origin(time[i], tmpO);
        let dx = tmpO[0] - x, dy = tmpO[1] - y, dz = tmpO[2] - z; const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
        for (let t = V * 1.2; t < L; t += V * 0.7) { const a = ((x + dx * t - wx0) * inv) | 0, b = ((y + dy * t - wy0) * inv) | 0, c = ((z + dz * t - wz0) * inv) | 0; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) break; seen[c * sxy + b * nx + a] = 1; }
      }
    }
    // pockets: connected pieces of 'vol'
    const cid = new Int32Array(N).fill(-1), stack = [];
    for (let s = 0; s < N; s++) {
      if (!vol[s] || cid[s] >= 0) continue;
      const id = s, cells = []; cid[s] = id; stack.push(s);
      while (stack.length) { const k = stack.pop(); cells.push(k); const z = (k / sxy) | 0, r = k - z * sxy, y = (r / nx) | 0, x = r - y * nx;
        if (x > 0 && vol[k - 1] && cid[k - 1] < 0) { cid[k - 1] = id; stack.push(k - 1); } if (x < nx - 1 && vol[k + 1] && cid[k + 1] < 0) { cid[k + 1] = id; stack.push(k + 1); }
        if (y > 0 && vol[k - nx] && cid[k - nx] < 0) { cid[k - nx] = id; stack.push(k - nx); } if (y < ny - 1 && vol[k + nx] && cid[k + nx] < 0) { cid[k + nx] = id; stack.push(k + nx); }
        if (z > 0 && vol[k - sxy] && cid[k - sxy] < 0) { cid[k - sxy] = id; stack.push(k - sxy); } if (z < nz - 1 && vol[k + sxy] && cid[k + sxy] < 0) { cid[k + sxy] = id; stack.push(k + sxy); } }
      if (cells.length < 12) continue;
      // measure it
      let x0 = nx, x1 = 0, y0 = ny, y1 = 0, zb = nz, zt = 0, sx = 0, sy = 0, sz = 0, nSeen = 0, wallF = 0, openF = 0;
      const colRun = new Map();
      for (const k of cells) {
        const z = (k / sxy) | 0, r = k - z * sxy, y = (r / nx) | 0, x = r - y * nx;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < zb) zb = z; if (z > zt) zt = z; sx += x; sy += y; sz += z;
        colRun.set(r, (colRun.get(r) || 0) + 1);
        if (seen && seen[k]) nSeen++;
        for (const q of [x > 0 ? k - 1 : -1, x < nx - 1 ? k + 1 : -1, y > 0 ? k - nx : -1, y < ny - 1 ? k + nx : -1, z > 0 ? k - sxy : -1, z < nz - 1 ? k + sxy : -1]) { if (q < 0 || vol[q]) continue; if (raw[q] || solid[q] || bar[q]) wallF++; else openF++; }
      }
      const nC = cells.length, cx = wx0 + (sx / nC + 0.5) * V, cy = wy0 + (sy / nC + 0.5) * V, cz = wz0 + (sz / nC + 0.5) * V;
      // floor area with enough headroom, and its length and width along its own long axis
      const need = Math.max(1, Math.round(minH / V)), fp = []; const runs = [];
      for (const [r, c] of colRun) { runs.push(c); if (c >= need) fp.push(r % nx, (r / nx) | 0); }
      runs.sort((a, b) => a - b);
      const clear = runs[Math.min(runs.length - 1, Math.floor(runs.length * 0.9))] * V;
      let len = 0, wid = 0, ang = 0;
      if (fp.length >= 4) {
        let mx = 0, my = 0; const m = fp.length / 2; for (let q = 0; q < fp.length; q += 2) { mx += fp[q]; my += fp[q + 1]; } mx /= m; my /= m;
        let sxx = 0, sxy2 = 0, syy = 0; for (let q = 0; q < fp.length; q += 2) { const a = fp[q] - mx, b = fp[q + 1] - my; sxx += a * a; sxy2 += a * b; syy += b * b; }
        ang = 0.5 * Math.atan2(2 * sxy2, sxx - syy); const ca = Math.cos(ang), sa = Math.sin(ang);
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity; for (let q = 0; q < fp.length; q += 2) { const a = (fp[q] - mx) * ca + (fp[q + 1] - my) * sa, b = -(fp[q] - mx) * sa + (fp[q + 1] - my) * ca; if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b; }
        len = (a1 - a0 + 1) * V; wid = (b1 - b0 + 1) * V;
      }
      const area = (fp.length / 2) * V * V;
      if (clear < minH - 1e-6 || len < minL - 1e-6 || wid < 0.5 || area < 0.8) { rejected++; continue; }
      // the probe position nearest the middle of the pocket: the flood fill knows the way from there to open air
      let best = -1, bestD = 0; { let bd = Infinity; const mx = sx / nC, my = sy / nC, mz = sz / nC; for (const k of cells) { if (!core[k]) continue; const z = (k / sxy) | 0, r = k - z * sxy, d = (r % nx - mx) ** 2 + (((r / nx) | 0) - my) ** 2 + (z - mz) ** 2; if (d < bd) { bd = d; best = k; } } if (best >= 0) bestD = dist[best]; }
      // the way in: follow the flood fill back from the pocket's most reachable voxel to open air
      let access = null;
      if (best >= 0) {
        let k = best, steps = 0; const path = [];
        while (k >= 0 && dist[k] > 0 && steps++ < 4000) { if (steps % 3 === 1) { const z = (k / sxy) | 0, r = k - z * sxy; path.push([wx0 + ((r % nx) + 0.5) * V, wy0 + (((r / nx) | 0) + 0.5) * V, wz0 + (z + 0.5) * V]); } k = prev[k]; }
        if (k >= 0) {
          const z = (k / sxy) | 0, r = k - z * sxy, mx = wx0 + ((r % nx) + 0.5) * V, my = wy0 + (((r / nx) | 0) + 0.5) * V, mz = wz0 + (z + 0.5) * V; path.push([mx, my, mz]);
          const horiz = Math.hypot(mx - cx, my - cy), above = mz - cz > horiz * 1.2 && horiz < Math.max(len, wid) * 0.5;
          access = { pos: [mx, my, mz], from: above ? 'above' : compass(mx - cx, my - cy), crawl: bestD * V, path };
        }
      }
      // the roof of the pocket: how steeply it slopes tells a lean-to from a flat, low pocket
      let slope = 0;
      { let n2 = 0, mx = 0, my = 0, mz = 0; const pts = []; for (const [r, c] of colRun) { if (c < 2) continue; const x = r % nx, y = (r / nx) | 0; let top = 0; for (let z = zt; z >= zb; z--) if (cid[z * sxy + r] === id) { top = z; break; } pts.push(x, y, top); mx += x; my += y; mz += top; n2++; }
        if (n2 > 8) { mx /= n2; my /= n2; mz /= n2; let a = 0, b = 0, c = 0, d = 0, e = 0; for (let q = 0; q < pts.length; q += 3) { const X = pts[q] - mx, Y = pts[q + 1] - my, Z = pts[q + 2] - mz; a += X * X; b += X * Y; c += Y * Y; d += X * Z; e += Y * Z; } const det = a * c - b * b; if (Math.abs(det) > 1e-9) { const gx = (d * c - e * b) / det, gy = (a * e - b * d) / det; slope = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI; } } }
      const kindOf = slope > 14 ? 'Lean-to: a slab propped at one edge' : clear < 1.0 ? 'Low pocket under a flat slab' : 'Sheltered space under standing cover';
      // skin for drawing
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1, bd = zt - zb + 1, mask = new Uint8Array(bw * bh * bd);
      for (const k of cells) { const z = (k / sxy) | 0, r = k - z * sxy, y = (r / nx) | 0, x = r - y * nx; mask[((z - zb) * bh + (y - y0)) * bw + (x - x0)] = 1; }
      const mesh = skin(mask, bw, bh, bd, wx0 + x0 * V, wy0 + y0 * V, wz0 + zb * V, V);
      voids.push({ volume: nC * V * V * V, clear, length: len, width: wid, area, angle: ang, centre: [cx, cy, cz], floorZ: wz0 + zb * V, topZ: wz0 + (zt + 1) * V,
        box: [wx0 + x0 * V, wy0 + y0 * V, wx0 + (x1 + 1) * V, wy0 + (y1 + 1) * V], enclosure: wallF / Math.max(1, wallF + openF), seen: seen ? nSeen / nC : null, access, slope, kind: kindOf, mesh });
    }
  }
  voids.sort((a, b) => b.volume - a.volume);
  voids.forEach((v, i) => { v.id = 'Void ' + String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ''); });
  return { list: voids, rejected, zones, zoneArea, voxel: V, probe: PROBE, voxels, params: { minH, minL, whole } };
}

// ---------------------------------------------------------------- 4. occupancy map
export const OCC = { UNSEEN: 0, FREE: 1, BLOCKED: 2, COVERED: 3 };
// res 0.5 m. If 'like' is given (the planner's grid) the map uses exactly its cells, so the two can be compared.
export function occupancy(pos, n, hag, g, B, like) {
  const res = 0.5, x0 = like ? 0 : g.x0, y0 = like ? 0 : g.y0, w = like ? like.w : g.w * 2, h = like ? like.h : g.h * 2;
  const nG = new Uint16Array(w * h), nO = new Uint16Array(w * h), nH = new Uint16Array(w * h);
  for (let i = 0; i < n; i++) {
    const a = ((pos[i * 3] - x0) / res) | 0, b = ((pos[i * 3 + 1] - y0) / res) | 0; if (a < 0 || b < 0 || a >= w || b >= h) continue;
    const k = b * w + a, hg = hag[i];
    if (hg < 0.2) { if (nG[k] < 65535) nG[k]++; } else if (hg <= 1.9) { if (nO[k] < 65535) nO[k]++; } else if (nH[k] < 65535) nH[k]++;
  }
  const state = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) state[k] = nO[k] >= 2 ? OCC.BLOCKED : nG[k] >= 1 ? OCC.FREE : nH[k] ? OCC.COVERED : OCC.UNSEEN;
  // a single unseen cell ringed by clear floor is a gap between scan lines, not a hole in the map
  const out = Uint8Array.from(state);
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) { const k = j * w + i; if (state[k] !== OCC.UNSEEN) continue; let f = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (state[k + dj * w + di] === OCC.FREE) f++; if (f >= 6) out[k] = OCC.FREE; }
  const areas = [0, 0, 0, 0]; for (let k = 0; k < w * h; k++) areas[out[k]] += res * res;
  return { res, x0, y0, w, h, state: out, areas };
}
