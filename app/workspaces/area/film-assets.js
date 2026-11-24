// Procedural assets for the valley film: detail noise, tree sprites, buildings, and fields derived from the elevation grid.
import * as THREE from 'three';

export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// 512 x 512 tiling detail texture. R, G: surface tilt of a rough rock height field. B: that height. A: clumpy foliage height.
export function detailTexture(renderer) {
  const N = 512, out = new Uint8Array(N * N * 4), rand = rng(7);
  const lattice = (cells) => { const g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = rand(); return g; };
  const addOctave = (dst, cells, amp, ridge) => {
    const g = lattice(cells), s = cells / N;
    for (let y = 0; y < N; y++) {
      const fy = y * s, y0 = fy | 0, ty = fy - y0, wy = ty * ty * (3 - 2 * ty), r0 = (y0 % cells) * cells, r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < N; x++) {
        const fx = x * s, x0 = fx | 0, tx = fx - x0, wx = tx * tx * (3 - 2 * tx), a = x0 % cells, b = (x0 + 1) % cells;
        let v = (g[r0 + a] * (1 - wx) + g[r0 + b] * wx) * (1 - wy) + (g[r1 + a] * (1 - wx) + g[r1 + b] * wx) * wy;
        if (ridge) v = 1 - Math.abs(v * 2 - 1);
        dst[y * N + x] += v * amp;
      }
    }
  };
  const rock = new Float32Array(N * N), leaf = new Float32Array(N * N);
  addOctave(rock, 6, 0.36, true); addOctave(rock, 13, 0.26, true); addOctave(rock, 29, 0.17, true); addOctave(rock, 61, 0.11, false); addOctave(rock, 127, 0.07, false); addOctave(rock, 256, 0.04, false);
  // foliage: rounded clumps (distance to the nearest of many points), three sizes
  const clump = (count, amp) => {
    const cells = Math.round(Math.sqrt(count)), px = new Float32Array(cells * cells), py = new Float32Array(cells * cells), w = N / cells;
    for (let i = 0; i < px.length; i++) { px[i] = rand(); py[i] = rand(); }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const cx = (x / w) | 0, cy = (y / w) | 0; let best = 9;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const k = ((cy + j + cells) % cells) * cells + ((cx + i + cells) % cells), dx = cx + i + px[k] - x / w, dy = cy + j + py[k] - y / w, d = dx * dx + dy * dy; if (d < best) best = d;
      }
      leaf[y * N + x] += amp * Math.max(0, 1 - best * 1.35);
    }
  };
  clump(144, 0.5); clump(900, 0.32); clump(4096, 0.18);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = y * N + x, p = k * 4, R = rock[y * N + ((x + 1) % N)], L = rock[y * N + ((x + N - 1) % N)], D = rock[((y + 1) % N) * N + x], U = rock[((y + N - 1) % N) * N + x];
    out[p] = Math.max(0, Math.min(255, 127.5 + (L - R) * 1500)); out[p + 1] = Math.max(0, Math.min(255, 127.5 + (U - D) * 1500));
    out[p + 2] = Math.max(0, Math.min(255, rock[k] * 255)); out[p + 3] = Math.max(0, Math.min(255, leaf[k] * 255));
  }
  const t = new THREE.DataTexture(out, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); t.needsUpdate = true;
  return t;
}

// Height texture plus a map of surface tilt (RG), ambient light (B: open ridge 1, deep gully 0) from an n x n grid.
export function heightTextures(data, n, cs) {
  const h = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.FloatType);
  h.minFilter = h.magFilter = THREE.LinearFilter; h.needsUpdate = true;
  const blur = boxBlur(data, n, Math.max(2, Math.round(70 / cs))), wide = boxBlur(blur, n, Math.max(3, Math.round(260 / cs)));
  const px = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, l = i ? k - 1 : k, r = i < n - 1 ? k + 1 : k, u = j ? k - n : k, d = j < n - 1 ? k + n : k;
    let nx = (data[l] - data[r]) / (2 * cs), nz = (data[u] - data[d]) / (2 * cs); const q = 1 / Math.hypot(nx, 1, nz); nx *= q; nz *= q;
    const open = 0.5 + (data[k] - blur[k]) / 46 + (blur[k] - wide[k]) / 300, p = k * 4;
    px[p] = 127.5 + nx * 127.5; px[p + 1] = 127.5 + nz * 127.5; px[p + 2] = Math.max(0, Math.min(255, open * 255)); px[p + 3] = 255;
  }
  const t = new THREE.DataTexture(px, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.needsUpdate = true;
  return { h, nrm: t };
}
export function boxBlur(src, n, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), w = 1 / (2 * r + 1);
  for (let j = 0; j < n; j++) { let sum = 0; const o = j * n; for (let i = -r; i <= r; i++) sum += src[o + Math.max(0, Math.min(n - 1, i))]; for (let i = 0; i < n; i++) { tmp[o + i] = sum * w; sum += src[o + Math.min(n - 1, i + r + 1)] - src[o + Math.max(0, i - r)]; } }
  for (let i = 0; i < n; i++) { let sum = 0; for (let j = -r; j <= r; j++) sum += tmp[Math.max(0, Math.min(n - 1, j)) * n + i]; for (let j = 0; j < n; j++) { out[j * n + i] = sum * w; sum += tmp[Math.min(n - 1, j + r + 1) * n + i] - tmp[Math.max(0, j - r) * n + i]; } }
  return out;
}

// Tree sprites: three kinds side by side, painted leaf by leaf. One canvas holds shade and coverage, one holds which way
// each leaf faces, so the sprites take the same sunlight as the ground.
export function treeAtlas(renderer) {
  const S = 256, K = 3, mk = () => { const c = document.createElement('canvas'); c.width = S * K; c.height = S; return c; };
  const col = mk(), nor = mk(), a = col.getContext('2d'), b = nor.getContext('2d'), rand = rng(19);
  b.fillStyle = 'rgb(128,128,255)'; b.fillRect(0, 0, S * K, S);
  const leaf = (x, y, r, shade, nx, ny, rot, sq) => {
    const v = Math.round(255 * Math.max(0, Math.min(1, shade))), nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
    for (const [g, fill] of [[a, 'rgb(' + v + ',' + v + ',' + v + ')'], [b, 'rgb(' + Math.round(127.5 + nx * 127) + ',' + Math.round(127.5 - ny * 127) + ',' + Math.round(127.5 + nz * 127) + ')']]) { g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, r, r * sq, rot, 0, 6.2832); g.fill(); }
  };
  for (let t = 0; t < K; t++) {
    const ox = t * S; for (const g of [a, b]) { g.save(); g.beginPath(); g.rect(ox + 2, 2, S - 4, S - 4); g.clip(); }
    a.fillStyle = 'rgb(58,52,46)'; a.fillRect(ox + S / 2 - 4, S * 0.62, 8, S * 0.36);
    if (t === 1) { // a conifer: whorls from the bottom up, each shorter
      for (let w = 0; w < 17; w++) { const f = w / 16, y = S * (0.9 - 0.84 * f), half = S * (0.27 * (1 - f) + 0.012) * (0.85 + rand() * 0.3);
        for (let q = 0; q < 70 - 40 * f; q++) { const u = rand() * 2 - 1, x = ox + S / 2 + u * half, yy = y + Math.abs(u) * half * 0.42 + (rand() - 0.5) * 9, nx = u * 0.8; leaf(x, yy, 3 + rand() * 4.5, 0.36 + 0.3 * f + rand() * 0.3 - Math.abs(u) * 0.06 - (yy - y) * 0.006, nx, 0.35 + rand() * 0.3, u * 0.9, 0.4); } }
    } else { // broadleaf: clusters on a rounded crown, back clusters first
      const cl = []; const count = t === 0 ? 30 : 22;
      for (let q = 0; q < count; q++) { const ang = rand() * 6.283, rr = Math.sqrt(rand()), z = rand() * 2 - 1; cl.push([ang, rr, z]); }
      cl.sort((p, q) => p[2] - q[2]);
      const cx = ox + S / 2, cy = S * (t === 0 ? 0.43 : 0.46), RX = S * (t === 0 ? 0.33 : 0.29), RY = S * (t === 0 ? 0.31 : 0.36);
      for (const [ang, rr, z] of cl) { const x = cx + Math.cos(ang) * rr * RX, y = cy + Math.sin(ang) * rr * RY, R = S * (0.085 + rand() * 0.055);
        for (let q = 0; q < 120; q++) { const aa = rand() * 6.283, r = Math.sqrt(rand()), lx = Math.cos(aa) * r, ly = Math.sin(aa) * r, X = x + lx * R, Y = y + ly * R;
          const gx = (X - cx) / (RX + R), gy = (Y - cy) / (RY + R), up = -(ly * 0.6 + gy * 0.7);
          leaf(X, Y, 1.8 + rand() * 3.4, 0.42 + up * 0.26 + z * 0.1 + (rand() - 0.5) * 0.26, Math.max(-0.95, Math.min(0.95, gx * 0.65 + lx * 0.4)), Math.max(-0.95, Math.min(0.95, -(gy * 0.6 + ly * 0.45))), rand() * 3, 0.65); } }
    }
    for (const g of [a, b]) g.restore();
  }
  const tex = (c) => { const x = new THREE.CanvasTexture(c); x.colorSpace = THREE.NoColorSpace; x.generateMipmaps = true; x.minFilter = THREE.LinearMipmapLinearFilter; x.anisotropy = 4; x.premultiplyAlpha = false; return x; };
  return { col: tex(col), nor: tex(nor) };
}

// Extruded footprints in one geometry. list: [{ ring: [[x, z], ...] (closed or open), h, base, id, kind }]
export function extrude(list) {
  const pos = [], nor = [], inf = [], uvw = [];   // inf: random, kind (0 roof, 1 wall, 2 block B roof, 3 block B wall), base, height
  const put = (x, y, z, nx, ny, nz, r, k, b, h, u, v) => { pos.push(x, y, z); nor.push(nx, ny, nz); inf.push(r, k, b, h); uvw.push(u, v); };
  for (const o of list) {
    let ring = o.ring.map((p) => p.slice()); if (ring.length > 3 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 0.05) ring.pop();
    if (ring.length < 3) continue;
    let area = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; area += p[0] * q[1] - q[0] * p[1]; }
    if (area < 0) ring.reverse();
    const r = ((o.id * 2654435761) >>> 0) / 4294967296, k = o.kind ? 2 : 0, top = o.base + o.h, low = o.base - 7;
    let run = 0;
    for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz) || 1, nx = dz / len, nz = -dx / len;
      const A = [p, low, run, -7], B = [q, low, run + len, -7], C = [q, top, run + len, o.h], D = [p, top, run, o.h];
      for (const [pt, y, u, v] of [A, C, B, A, D, C]) put(pt[0], y, pt[1], nx, 0, nz, r, k + 1, o.base, o.h, u, v);
      run += len; }
    const tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const t of tris) for (const i of [t[0], t[2], t[1]]) put(ring[i][0], top, ring[i][1], 0, 1, 0, r, k, o.base, o.h, ring[i][0], ring[i][1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aInf', new THREE.Float32BufferAttribute(inf, 4)); g.setAttribute('aUv', new THREE.Float32BufferAttribute(uvw, 2));
  return g;
}
