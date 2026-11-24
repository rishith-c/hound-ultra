// Light for the cloud, worked out from the points alone (runs in the worker): a surface normal per point, how open the
// point is to the sky, and whether the sun reaches it. Nothing here knows how the scene was made, so it works on any scan.
import { poseAt } from './scene.js';

export const SUN = (() => { const v = [-0.70, 0.46, 0.50], l = Math.hypot(...v); return v.map((x) => x / l); })();
const DIRS = (() => { const out = []; for (let i = 0; i < 11; i++) { const z = 0.12 + 0.86 * ((i + 0.5) / 11), r = Math.sqrt(1 - z * z), a = i * 2.39996; out.push([r * Math.cos(a), r * Math.sin(a), z]); } return out; })();

// smallest-eigenvalue direction of a symmetric 3x3, by a few Jacobi sweeps. Returns [planarity 0..1].
const A = new Float64Array(9), V = new Float64Array(9), out = new Float64Array(4);
function plane(xx, xy, xz, yy, yz, zz) {
  A[0] = xx; A[1] = A[3] = xy; A[2] = A[6] = xz; A[4] = yy; A[5] = A[7] = yz; A[8] = zz; V.fill(0); V[0] = V[4] = V[8] = 1;
  for (let s = 0; s < 5; s++) for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
    const apq = A[p * 3 + q]; if (Math.abs(apq) < 1e-12) continue;
    const th = (A[q * 3 + q] - A[p * 3 + p]) / (2 * apq), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), sn = t * c;
    for (let k = 0; k < 3; k++) { const kp = A[k * 3 + p], kq = A[k * 3 + q]; A[k * 3 + p] = c * kp - sn * kq; A[k * 3 + q] = sn * kp + c * kq; }
    for (let k = 0; k < 3; k++) { const pk = A[p * 3 + k], qk = A[q * 3 + k]; A[p * 3 + k] = c * pk - sn * qk; A[q * 3 + k] = sn * pk + c * qk; }
    for (let k = 0; k < 3; k++) { const kp = V[k * 3 + p], kq = V[k * 3 + q]; V[k * 3 + p] = c * kp - sn * kq; V[k * 3 + q] = sn * kp + c * kq; }
  }
  let m = 0; if (A[4] < A[m * 4]) m = 1; if (A[8] < A[m * 4]) m = 2;
  const tr = A[0] + A[4] + A[8], lo = Math.max(0, A[m * 4]), a = A[((m + 1) % 3) * 4], b = A[((m + 2) % 3) * 4], mid = Math.min(a, b);
  out[0] = V[m]; out[1] = V[3 + m]; out[2] = V[6 + m]; out[3] = tr > 0 ? Math.max(0, Math.min(1, 1 - lo / Math.max(1e-9, mid) * 2.2)) : 0;
}

export function bakeLight(pos, n, B, { time, traj, cut }) {
  const ex = B.max[0] - B.min[0] + 0.6, ey = B.max[1] - B.min[1] + 0.6, ez = B.max[2] - B.min[2] + 0.6, ox = B.min[0] - 0.3, oy = B.min[1] - 0.3, oz = B.min[2] - 0.3;
  // ---- normals on a coarse grid, then per point from the nearby planes that fit it
  const c1 = Math.max(0.36, Math.cbrt((ex * ey * ez) / 5e6)), w1 = Math.ceil(ex / c1) + 1, h1 = Math.ceil(ey / c1) + 1, d1 = Math.ceil(ez / c1) + 1, id = new Int32Array(w1 * h1 * d1).fill(-1);
  let m = 0; for (let i = 0; i < n; i++) { const k = (((pos[i * 3 + 2] - oz) / c1 | 0) * h1 + ((pos[i * 3 + 1] - oy) / c1 | 0)) * w1 + ((pos[i * 3] - ox) / c1 | 0); if (id[k] < 0) id[k] = m++; }
  const M = new Float32Array(m * 10), key = new Int32Array(m);
  for (let i = 0; i < n; i++) {
    const X = pos[i * 3] - ox, Y = pos[i * 3 + 1] - oy, Z = pos[i * 3 + 2] - oz, k = ((Z / c1 | 0) * h1 + (Y / c1 | 0)) * w1 + (X / c1 | 0), o = id[k] * 10; key[id[k]] = k;
    const ix = X - ((X / c1 | 0) + 0.5) * c1, iy = Y - ((Y / c1 | 0) + 0.5) * c1, iz = Z - ((Z / c1 | 0) + 0.5) * c1; // local to the cell, for precision
    M[o]++; M[o + 1] += ix; M[o + 2] += iy; M[o + 3] += iz; M[o + 4] += ix * ix; M[o + 5] += ix * iy; M[o + 6] += ix * iz; M[o + 7] += iy * iy; M[o + 8] += iy * iz; M[o + 9] += iz * iz;
  }
  const NV = new Float32Array(m * 7); // normal, planarity, centroid
  for (let q = 0; q < m; q++) {
    const k = key[q], kx = k % w1, ky = ((k / w1) | 0) % h1, kz = (k / (w1 * h1)) | 0;
    let s = 0, sx = 0, sy = 0, sz = 0, xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const a = kx + dx, b = ky + dy, c = kz + dz; if (a < 0 || b < 0 || c < 0 || a >= w1 || b >= h1 || c >= d1) continue;
      const j = id[(c * h1 + b) * w1 + a]; if (j < 0) continue;
      const wt = dx || dy || dz ? (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1 ? 0.12 : 0.35) : 1, o = j * 10, cn = M[o] * wt, tx = dx * c1, ty = dy * c1, tz = dz * c1, mx = M[o + 1] * wt, my = M[o + 2] * wt, mz = M[o + 3] * wt;
      s += cn; sx += mx + cn * tx; sy += my + cn * ty; sz += mz + cn * tz;
      xx += M[o + 4] * wt + 2 * tx * mx + cn * tx * tx; yy += M[o + 7] * wt + 2 * ty * my + cn * ty * ty; zz += M[o + 9] * wt + 2 * tz * mz + cn * tz * tz;
      xy += M[o + 5] * wt + tx * my + ty * mx + cn * tx * ty; xz += M[o + 6] * wt + tx * mz + tz * mx + cn * tx * tz; yz += M[o + 8] * wt + ty * mz + tz * my + cn * ty * tz;
    }
    const ux = sx / s, uy = sy / s, uz = sz / s, o = q * 7;
    plane(xx / s - ux * ux, xy / s - ux * uy, xz / s - ux * uz, yy / s - uy * uy, yz / s - uy * uz, zz / s - uz * uz);
    NV[o] = out[0]; NV[o + 1] = out[1]; NV[o + 2] = out[2]; NV[o + 3] = s < 5 ? 0 : out[3];
    NV[o + 4] = ox + (kx + 0.5) * c1 + ux; NV[o + 5] = oy + (ky + 0.5) * c1 + uy; NV[o + 6] = oz + (kz + 0.5) * c1 + uz;
  }
  // ---- what blocks light
  const c2 = Math.max(0.22, Math.cbrt((ex * ey * ez) / 1.6e7)), w2 = Math.ceil(ex / c2) + 2, h2 = Math.ceil(ey / c2) + 2, d2 = Math.ceil(ez / c2) + 2, sl = w2 * h2, occ = new Uint8Array(sl * d2);
  for (let i = 0; i < n; i++) { const X = pos[i * 3], Y = pos[i * 3 + 1], Z = pos[i * 3 + 2], k = ((Z - oz) / c2 | 0) * sl + ((Y - oy) / c2 | 0) * w2 + ((X - ox) / c2 | 0); occ[k] |= cut && X > cut.x0 && X < cut.x1 && Y > cut.y0 && Y < cut.y1 && Z > cut.z ? 1 : 3; } // bit 1: anything; bit 2: still there once the top is cut away
  const at = (x, y, z) => { const i = (x - ox) * i1, j = (y - oy) * i1, k = (z - oz) * i1; return i < 0 || j < 0 || k < 0 || i >= w2 || j >= h2 || k >= d2 ? 0 : occ[(k | 0) * sl + (j | 0) * w2 + (i | 0)]; };
  const N = new Int8Array(n * 4), L = new Uint8Array(n * 4), p3 = [0, 0, 0], rays = n > 4e5 ? 2 : 4, i1 = 1 / c2, T1 = B.max[2] + 0.3;
  let rs = 0x2545f491; const rnd = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296; };
  for (let i = 0; i < n; i++) {
    const X = pos[i * 3], Y = pos[i * 3 + 1], Z = pos[i * 3 + 2];
    const fx = (X - ox) / c1 - 0.5, fy = (Y - oy) / c1 - 0.5, fz = (Z - oz) / c1 - 0.5, bx = Math.floor(fx), by = Math.floor(fy), bz = Math.floor(fz);
    let nx = 0, ny = 0, nz = 0, pl = 0, sw = 0, cx = 0, cy = 0, cz = 0, rx = 0, ry = 0, rz = 0;
    if (traj && time) { poseAt(traj, time[i], p3); rx = p3[0] - X; ry = p3[1] - Y; rz = p3[2] - Z; } else rz = 1;
    for (let q = 0; q < 8; q++) {
      const a = bx + (q & 1), b = by + ((q >> 1) & 1), c = bz + (q >> 2); if (a < 0 || b < 0 || c < 0 || a >= w1 || b >= h1 || c >= d1) continue;
      const j = id[(c * h1 + b) * w1 + a]; if (j < 0) continue;
      const o = j * 7, dist = NV[o] * (X - NV[o + 4]) + NV[o + 1] * (Y - NV[o + 5]) + NV[o + 2] * (Z - NV[o + 6]);
      const tri = (q & 1 ? fx - bx : 1 - fx + bx) * (q & 2 ? fy - by : 1 - fy + by) * (q & 4 ? fz - bz : 1 - fz + bz), w = (tri + 0.02) * Math.exp(-dist * dist * 160) * (0.15 + NV[o + 3]), sg = NV[o] * rx + NV[o + 1] * ry + NV[o + 2] * rz < 0 ? -w : w;
      nx += NV[o] * sg; ny += NV[o + 1] * sg; nz += NV[o + 2] * sg; pl += NV[o + 3] * w; cx += NV[o + 4] * w; cy += NV[o + 5] * w; cz += NV[o + 6] * w; sw += w;
    }
    let l = Math.hypot(nx, ny, nz); if (l > 1e-6) { nx /= l; ny /= l; nz /= l; } else { nx = 0; ny = 0; nz = 1; }
    if (sw > 0) { pl /= sw; if (pl < 0.45) { // loose or leafy: shade it like the outside of a soft clump
      const k = 1 - pl / 0.45; let ux = X - cx / sw, uy = Y - cy / sw, uz = Z - cz / sw + 0.08; const ul = Math.hypot(ux, uy, uz) || 1; nx = nx * (1 - k) + (ux / ul) * k; ny = ny * (1 - k) + (uy / ul) * k; nz = nz * (1 - k) + (uz / ul) * k; l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; } }
    const gx = X + nx * c2 * 1.7, gy = Y + ny * c2 * 1.7, gz = Z + nz * c2 * 1.7;
    let o1 = 0, o2 = 0; // openness to the sky
    for (let q = 0; q < DIRS.length; q++) {
      const D = DIRS[q]; let dx = D[0], dy = D[1], dz = D[2]; const dn = dx * nx + dy * ny + dz * nz; if (dn < 0) { dx -= 2 * dn * nx; dy -= 2 * dn * ny; dz -= 2 * dn * nz; }
      let a = 1, b = 1; for (let s = 0; s < 5 && (a || b); s++) { const r = c2 * (0.6 + s * s * 0.75 + s * 0.6), f = at(gx + dx * r, gy + dy * r, gz + dz * r); if (f & 1) a = 0; if (f & 2) b = 0; }
      o1 += a; o2 += b;
    }
    let s1 = 0, s2 = 0; // the sun, with a soft edge
    if (nx * SUN[0] + ny * SUN[1] + nz * SUN[2] > -0.12) for (let q = 0; q < rays; q++) {
      const jx = SUN[0] + (rnd() - 0.5) * 0.05, jy = SUN[1] + (rnd() - 0.5) * 0.05, jz = SUN[2] + (rnd() - 0.5) * 0.04; let a = 1, b = 1, x = gx + jx * c2 * rnd(), y = gy + jy * c2 * rnd(), z = gz + jz * c2 * rnd();
      for (let s = 0; s < 130 && z < T1 && (a || b); s++) { const f = at(x, y, z); if (f & 1) a = 0; if (f & 2) b = 0; x += jx * c2; y += jy * c2; z += jz * c2; }
      s1 += a; s2 += b;
    }
    const k = i * 4; N[k] = nx * 127; N[k + 1] = nz * 127; N[k + 2] = -ny * 127; N[k + 3] = (o1 / DIRS.length) * 127; // already in three.js axes
    L[k] = (s1 / rays) * 255; L[k + 1] = (s2 / rays) * 255; L[k + 2] = (o2 / DIRS.length) * 255; L[k + 3] = rnd() * 255;
  }
  return { N, L };
}
