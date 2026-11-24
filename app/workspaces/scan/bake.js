// The Demo film's scan, baked. encode() is run once, in a page, on a live result from compute.js (see the report for the
// command); decode() gives the film what it needs without computing anything. The film draws a subset of the points,
// thinned most where the camera never goes; counts shown on screen come from the full scan's own table.
const KNOTS = 1024, STEP = 0.02;
const clamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// how much a point sits on an edge: far from the middle of its own neighbourhood. Flat surface 0, a rim or a corner 1.
function edges(d) {
  const { pos, n, cls, bounds: B } = d, o = [B.min[0] - 1, B.min[1] - 1, B.min[2] - 1], v = 0.1, vx = Math.ceil((B.max[0] - o[0] + 1) / v), vy = Math.ceil((B.max[1] - o[1] + 1) / v), vz = Math.ceil((B.max[2] - o[2] + 1) / v);
  const bits = new Uint8Array(Math.ceil((vx * vy * vz) / 8)), u = [];
  for (let i = 0; i < n; i++) { if (cls[i] === 3) continue; const k = (((pos[i * 3 + 2] - o[2]) / v) | 0) * vx * vy + (((pos[i * 3 + 1] - o[1]) / v) | 0) * vx + (((pos[i * 3] - o[0]) / v) | 0); const q = Math.floor(k / 8), m = 1 << (k % 8); if (bits[q] & m) continue; bits[q] |= m; u.push(i); }
  const c = 0.42, cx = Math.ceil((vx * v) / c) + 1, cy = Math.ceil((vy * v) / c) + 1, cz = Math.ceil((vz * v) / c) + 1, head = new Int32Array(cx * cy * cz).fill(-1), next = new Int32Array(u.length);
  const cell = (i) => (((pos[i * 3 + 2] - o[2]) / c) | 0) * cx * cy + (((pos[i * 3 + 1] - o[1]) / c) | 0) * cx + (((pos[i * 3] - o[0]) / c) | 0);
  u.forEach((i, q) => { const k = cell(i); next[q] = head[k]; head[k] = q; });
  const E = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (cls[i] !== 1 && cls[i] !== 2) continue;
    const X = pos[i * 3], Y = pos[i * 3 + 1], Z = pos[i * 3 + 2], k0 = cell(i); let sx = 0, sy = 0, sz = 0, m = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) for (let q = head[k0 + (a * cy + b) * cx + e] ?? -1; q >= 0; q = next[q]) { const j = u[q], dx = pos[j * 3] - X, dy = pos[j * 3 + 1] - Y, dz = pos[j * 3 + 2] - Z; if (dx * dx + dy * dy + dz * dz < c * c) { sx += dx; sy += dy; sz += dz; m++; } }
    if (m > 8) { const s = clamp((Math.hypot(sx, sy, sz) / m / c - 0.20) / 0.20); E[i] = s * s * (3 - 2 * s); }
  }
  return E;
}
const hash = (x, y, z) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647 ^ 0x5bd1e995); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function noise(x, y, z) { const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), u = x - i, v = y - j, w = z - k, s = (t) => t * t * (3 - 2 * t), L = (a, b, t) => a + (b - a) * t; return L(L(L(hash(i, j, k), hash(i + 1, j, k), s(u)), L(hash(i, j + 1, k), hash(i + 1, j + 1, k), s(u)), s(v)), L(L(hash(i, j, k + 1), hash(i + 1, j, k + 1), s(u)), L(hash(i, j + 1, k + 1), hash(i + 1, j + 1, k + 1), s(u)), s(v)), s(w)); }

export async function encode(d, limit = 3.9e6) {
  const E = edges(d), top = [...d.voids.list].sort((a, b) => b.volume - a.volume).slice(0, 4), C = d.cut, P = new Float32Array(d.n);
  for (let i = 0; i < d.n; i++) {
    const x = d.pos[i * 3], y = d.pos[i * 3 + 1], z = d.pos[i * 3 + 2], c = d.cls[i]; let p = c === 0 ? 0.30 : c === 3 ? 0.0 : 0.66;
    if (x > C.x0 - 5 && x < C.x1 + 5 && y > C.y0 - 5 && y < C.y1 + 5) p = c === 0 ? 0.42 : 0.74;
    for (const v of top) { const r = Math.hypot(x - v.centre[0], y - v.centre[1]); if (r < 10) p = Math.max(p, c === 0 ? 0.75 : 0.97); }
    if (c === 3) { const s = noise(x * 0.85, y * 0.85, z * 1.05) * 0.7 + noise(x * 2.3, y * 2.3, z * 2.3) * 0.3; p = s > 0.56 ? 0.55 : s > 0.5 ? 0.12 : 0.015; } // crowns: ragged clumps with sky between them
    if (E[i] > 0.4) p = Math.max(p, 0.92);
    P[i] = p;
  }
  const R = new Float32Array(d.n); { let s = 0x9e3779b9; for (let i = 0; i < d.n; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; R[i] = (s >>> 0) / 4294967296; } }
  let k = 1;
  for (let tries = 0; tries < 6; tries++) { const out = await pack(d, E, (i) => P[i] * k, R, top); if (out.length < limit) return out; k *= Math.min(0.97, (limit / out.length) * 0.985); }
  throw new Error('The bake does not fit.');
}
async function pack(d, E, prob, R, top) {
  const keep = []; for (let i = 0; i < d.n; i++) if (R[i] < prob(i)) keep.push(i);
  const n = keep.length, B = d.bounds, plane = () => new Uint8Array(n), pl = []; // planes
  for (let a = 0; a < 3; a++) { const lo = plane(), hi = plane(); let prev = 0; for (let q = 0; q < n; q++) { const v = Math.round((d.pos[keep[q] * 3 + a] - B.min[a]) / STEP), e = v - prev; prev = v; const z = ((e << 1) ^ (e >> 31)) & 0xffff; lo[q] = z & 255; hi[q] = z >> 8; } pl.push(lo, hi); }
  const p1 = plane(), p2 = plane(), p3 = plane(), p4 = plane(), p5 = plane();
  for (let q = 0; q < n; q++) {
    const i = keep[q], N = d.lightN, L = d.lightL; let x = N[i * 4] / 127, y = N[i * 4 + 1] / 127, z = N[i * 4 + 2] / 127; const s = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1; x /= s; y /= s; z /= s;
    if (z < 0) { const ox = x; x = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1); y = (1 - Math.abs(ox)) * (y >= 0 ? 1 : -1); }
    p1[q] = Math.min(63, Math.round((x * 0.5 + 0.5) * 63)) | (d.cls[i] << 6); p2[q] = Math.min(63, Math.round((y * 0.5 + 0.5) * 63)) | (Math.round((L[i * 4] / 255) * 3) << 6);
    p3[q] = Math.round((Math.max(0, N[i * 4 + 3]) / 127) * 11) | (Math.round((L[i * 4 + 2] / 255) * 11) << 4);
    const sp = (d.sp[i] * 0.002) / Math.sqrt(Math.max(0.15, prob(i))); p4[q] = Math.max(0, Math.min(15, Math.round(Math.log2(Math.max(0.012, sp) / 0.012) * 3.2))) | (Math.round((L[i * 4 + 1] / 255) * 3) << 4);
    p5[q] = Math.round((d.inten[i] / 255) * 31) | (Math.round(E[i] * 7) << 5);
  }
  pl.push(p1, p2, p3, p4, p5);
  const rd = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : Array.isArray(v) ? v.map(rd) : ArrayBuffer.isView(v) ? Array.from(v, rd) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, rd(b)])) : v);
  const at = (q) => keep[Math.min(n - 1, Math.round((q / KNOTS) * (n - 1)))], T = [], F = []; for (let q = 0; q <= KNOTS; q++) { T.push(rd(d.time[at(q)])); F.push(at(q)); }
  const meshes = [], list = d.voids.list.map((v) => { const { mesh, samp, ...rest } = v, o = rd(rest); if (top.includes(v)) { o.mesh = { p: Array.from(mesh.pos, (x) => Math.round(x * 100)), i: Array.from(mesh.idx) }; } return o; });
  const head = new TextEncoder().encode(JSON.stringify({ n, full: d.n, rays: d.rays, duration: d.duration, kind: d.kind, bounds: rd(d.bounds), extent: rd(d.extent), cut: rd(d.cut), passes: rd(d.passes), traj: rd(d.traj), ground: { x0: d.ground.x0, y0: d.ground.y0, w: d.ground.w, h: d.ground.h, z: Array.from(d.ground.z, (z) => Math.round(z * 100)) }, T, F, list, accuracy: d.classes.accuracy }));
  const all = new Uint8Array(4 + head.length + n * pl.length); new DataView(all.buffer).setUint32(0, head.length, true); all.set(head, 4); pl.forEach((p, q) => all.set(p, 4 + head.length + q * n));
  return new Uint8Array(await new Response(new Blob([all]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}

export async function decode(response) {
  const all = new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()), hl = new DataView(all.buffer).getUint32(0, true), H = JSON.parse(new TextDecoder().decode(all.subarray(4, 4 + hl))), n = H.n;
  const pl = []; for (let q = 0; q < 11; q++) pl.push(all.subarray(4 + hl + q * n, 4 + hl + (q + 1) * n));
  const pos = new Float32Array(n * 3), time = new Float32Array(n), hag = new Float32Array(n), cls = new Uint8Array(n), sp = new Uint8Array(n), inten = new Uint8Array(n), edge = new Uint8Array(n), N = new Int8Array(n * 4), L = new Uint8Array(n * 4), b = H.bounds.min, gz = H.ground, gw = gz.w, gh = gz.h; gz.z = Float32Array.from(gz.z, (z) => z / 100);
  const spT = Float32Array.from({ length: 16 }, (_, i) => Math.min(255, (0.012 * Math.pow(2, i / 3.2)) / 0.002)); let vx = 0, vy = 0, vz = 0, rs = 0x2545f491;
  for (let q = 0; q < n; q++) {
    let z = pl[0][q] | (pl[1][q] << 8); vx += (z >>> 1) ^ -(z & 1); z = pl[2][q] | (pl[3][q] << 8); vy += (z >>> 1) ^ -(z & 1); z = pl[4][q] | (pl[5][q] << 8); vz += (z >>> 1) ^ -(z & 1);
    rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; // spread the rounding, so flat walls do not band
    const X = b[0] + (vx + ((rs & 255) / 255 - 0.5) * 0.9) * STEP, Y = b[1] + (vy + (((rs >>> 8) & 255) / 255 - 0.5) * 0.9) * STEP, Z = b[2] + (vz + (((rs >>> 16) & 255) / 255 - 0.5) * 0.9) * STEP, o = q * 3, k = q * 4;
    pos[o] = X; pos[o + 1] = Y; pos[o + 2] = Z;
    const u = (q / (n - 1)) * KNOTS, j = Math.min(KNOTS - 1, u | 0); time[q] = H.T[j] + (H.T[j + 1] - H.T[j]) * (u - j);
    let fx = Math.min(gw - 1.001, Math.max(0, X - gz.x0 - 0.5)), fy = Math.min(gh - 1.001, Math.max(0, Y - gz.y0 - 0.5)); const gi = fx | 0, gj = fy | 0; fx -= gi; fy -= gj; const g = gj * gw + gi;
    hag[q] = Z - (gz.z[g] * (1 - fx) * (1 - fy) + gz.z[g + 1] * fx * (1 - fy) + gz.z[g + gw] * (1 - fx) * fy + gz.z[g + gw + 1] * fx * fy);
    const a = pl[6][q], c = pl[7][q], ao = pl[8][q], s = pl[9][q], e = pl[10][q]; cls[q] = a >> 6;
    let nx = ((a & 63) / 63) * 2 - 1, ny = ((c & 63) / 63) * 2 - 1; const nz = 1 - Math.abs(nx) - Math.abs(ny), t = Math.max(0, -nz); nx += nx >= 0 ? -t : t; ny += ny >= 0 ? -t : t; const l = Math.hypot(nx, ny, nz) || 1;
    N[k] = (nx / l) * 127; N[k + 1] = (ny / l) * 127; N[k + 2] = (nz / l) * 127; N[k + 3] = ((ao & 15) / 11) * 127; L[k] = (c >> 6) * 85; L[k + 1] = (s >> 4) * 85; L[k + 2] = ((ao >> 4) / 11) * 255; L[k + 3] = (rs >>> 24) & 255;
    sp[q] = spT[s & 15]; inten[q] = ((e & 31) / 31) * 255; edge[q] = ((e >> 5) / 7) * 255;
  }
  for (const v of H.list) v.mesh = v.mesh ? { pos: Float32Array.from(v.mesh.p, (x) => x / 100), idx: Uint32Array.from(v.mesh.i) } : { pos: new Float32Array(0), idx: new Uint32Array(0) };
  const fullAt = (c) => { const u = Math.min(1, c / n) * KNOTS, j = Math.min(KNOTS - 1, u | 0); return c >= n ? H.full : Math.round(H.F[j] + (H.F[j + 1] - H.F[j]) * (u - j)); };
  return { kind: H.kind, baked: true, n, full: H.full, fullAt, rays: H.rays, duration: H.duration, bounds: H.bounds, extent: H.extent, cut: H.cut, passes: H.passes, traj: H.traj, ground: gz, pos, time, hag, cls, sp, inten, edge, rgb: null, lightN: N, lightL: L, voids: { list: H.list, zones: [] }, classes: { accuracy: H.accuracy } };
}
