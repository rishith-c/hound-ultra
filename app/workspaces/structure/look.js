// Structure lab: the look. Procedural concrete, brick, rust and timber; chipped geometry with real hollow cores; a dusk sky;
// particles that run on a clock (so a recording can play backwards); and the post chain: shadow-marched light shafts,
// ambient occlusion, haze, bloom and grade. Nothing here measures anything.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------ tileable noise and packed textures (R albedo, G mask, BA normal)
function tileNoise(N, cells, seed) {
  const r = rng(seed), g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(N * N), s = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < N; y++) { const fy = y / N * cells, iy = Math.floor(fy), ty = s(fy - iy), y0 = iy % cells, y1 = (iy + 1) % cells;
    for (let x = 0; x < N; x++) { const fx = x / N * cells, ix = Math.floor(fx), tx = s(fx - ix), x0 = ix % cells, x1 = (ix + 1) % cells;
      const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1]; out[y * N + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty; } }
  return out;
}
function fbm(N, base, oct, seed, gain = 0.5) { const out = new Float32Array(N * N); let amp = 1, sum = 0; for (let o = 0; o < oct; o++) { const n = tileNoise(N, base << o, seed + o * 17); for (let i = 0; i < out.length; i++) out[i] += n[i] * amp; sum += amp; amp *= gain; } for (let i = 0; i < out.length; i++) out[i] /= sum; return out; }
function pack(N, alb, mask, hgt, bump) {
  const d = new Uint8Array(N * N * 4), c = (v) => Math.max(0, Math.min(255, v * 255 | 0));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x, xl = y * N + (x + N - 1) % N, xr = y * N + (x + 1) % N, yu = ((y + N - 1) % N) * N + x, yd = ((y + 1) % N) * N + x;
    d[i * 4] = c(alb[i]); d[i * 4 + 1] = c(mask[i]); d[i * 4 + 2] = c(0.5 - (hgt[xr] - hgt[xl]) * bump); d[i * 4 + 3] = c(0.5 - (hgt[yd] - hgt[yu]) * bump); }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t;
}
function concreteTex(seed, { coarse = 0, board = 0, cracks = 4 } = {}) {
  const N = 512, a = fbm(N, 4, 6, seed), f = fbm(N, 32, 4, seed + 91), st = fbm(N, 3, 3, seed + 333), alb = new Float32Array(N * N), m = new Float32Array(N * N), h = new Float32Array(N * N), r = rng(seed + 5);
  for (let i = 0; i < N * N; i++) { h[i] = a[i] * 0.5 + f[i] * (0.35 + coarse); alb[i] = 0.5 + (a[i] - 0.5) * 0.55 + (f[i] - 0.5) * 0.34 - Math.max(0, st[i] - 0.56) * 0.9; m[i] = a[i]; }
  const dot = (x, y, R, fn) => { for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) { const q = (i * i + j * j) / (R * R + 0.01); if (q < 1) fn((((y + j) % N + N) % N) * N + ((x + i) % N + N) % N, 1 - q); } };
  for (let k = 0; k < 420; k++) dot(r() * N | 0, r() * N | 0, 1 + r() * r() * 5 | 0, (i, w) => { h[i] -= 0.5 * w; alb[i] -= 0.22 * w; });        // bug holes
  for (let k = 0; k < 1500 * (0.25 + coarse * 3); k++) { const t = r() - 0.45; dot(r() * N | 0, r() * N | 0, 2 + r() * 6 | 0, (i, w) => { h[i] += 0.5 * w * coarse; alb[i] += t * 0.35 * w; }); } // aggregate
  if (board) for (let y = 0; y < N; y++) { const k = y % 64; if (k < 2) for (let x = 0; x < N; x++) { h[y * N + x] -= 0.35; alb[y * N + x] -= 0.12; } }
  for (let k = 0; k < cracks; k++) { let x = r() * N, y = r() * N, an = r() * 6.28; for (let s = 0; s < 420; s++) { an += (r() - 0.5) * 0.55; x += Math.cos(an); y += Math.sin(an); const i = (((y | 0) % N + N) % N) * N + ((x | 0) % N + N) % N; h[i] -= 0.9; alb[i] -= 0.3; if (r() < 0.5) { const j = (((y | 0) % N + N) % N) * N + ((x + 1 | 0) % N + N) % N; h[j] -= 0.5; alb[j] -= 0.18; } } }
  return pack(N, alb, m, h, 1.5);
}
function brickTex(seed) {
  const N = 512, f = fbm(N, 24, 4, seed), a = fbm(N, 4, 4, seed + 9), alb = new Float32Array(N * N), m = new Float32Array(N * N), h = new Float32Array(N * N), r = rng(seed), tone = []; for (let i = 0; i < 512; i++) tone.push(r());
  const bh = N / 16, bw = N / 8;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const row = Math.floor(y / bh), xx = (x + (row % 2) * bw / 2) % N, col = Math.floor(xx / bw), u = xx % bw, v = y % bh, e = Math.min(u, bw - u, v, bh - v) + (f[y * N + x] - 0.5) * 3, b = Math.max(0, Math.min(1, (e - 1.2) / 1.6)), i = y * N + x;
    m[i] = b; h[i] = b * 0.8 + f[i] * 0.4; alb[i] = b ? 0.34 + tone[(row * 8 + col) % 512] * 0.34 + (f[i] - 0.5) * 0.4 + (a[i] - 0.5) * 0.3 : 0.62 + (f[i] - 0.5) * 0.4; }
  return pack(N, alb, m, h, 1.6);
}
function woodTex(seed) {
  const N = 512, f = fbm(N, 16, 4, seed), alb = new Float32Array(N * N), m = new Float32Array(N * N), h = new Float32Array(N * N), w = fbm(N, 2, 3, seed + 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x, g = 0.5 + 0.5 * Math.sin((x / N * 44 + w[i] * 5) * 6.283), fi = f[(y >> 4) * N + x]; alb[i] = 0.46 + g * 0.16 + (fi - 0.5) * 0.4; m[i] = g; h[i] = g * 0.2 + fi * 0.4; }
  return pack(N, alb, m, h, 1);
}
let TX = null;
export function textures() { if (!TX) TX = { conc: concreteTex(3, { board: 0, cracks: 6 }), form: concreteTex(8, { board: 1, cracks: 3 }), rough: concreteTex(21, { coarse: 0.5, cracks: 5 }), brick: brickTex(5), wood: woodTex(4), soil: concreteTex(44, { coarse: 0.28, cracks: 0 }) }; return TX; }

// ------------------------------------------------------------ the one surface material
const TRI = `
uniform sampler2D uTex; uniform float uS, uBump, uDust, uGhost, uMask; uniform vec3 uTint, uTint2; uniform vec4 uHeat; uniform mat3 normalMatrix;
varying vec3 vOP; varying vec3 vON; varying vec3 vWP;
vec4 gT; vec3 gDN; float gM;
void triSample(){ vec3 bw = pow(abs(normalize(vON)), vec3(6.0)); bw /= (bw.x + bw.y + bw.z);
  vec4 a = texture2D(uTex, vOP.zy * uS), b = texture2D(uTex, vOP.xz * uS), c = texture2D(uTex, vOP.xy * uS); gT = a * bw.x + b * bw.y + c * bw.z;
  vec2 na = a.ba * 2.0 - 1.0, nb = b.ba * 2.0 - 1.0, nc = c.ba * 2.0 - 1.0;
  gDN = vec3(0.0, na.y, na.x) * bw.x + vec3(nb.x, 0.0, nb.y) * bw.y + vec3(nc.x, nc.y, 0.0) * bw.z;
  gM = texture2D(uTex, vOP.xz * uS * 0.17 + vOP.y * 0.07).r; }
`;
export function surface({ tex, scale = 0.8, bump = 0.9, dust = 0.75, tint = 0xffffff, tint2 = null, rough = 0.92, metal = 0, clip = null, side = THREE.FrontSide }) {
  const u = { uTex: { value: tex }, uS: { value: scale }, uBump: { value: bump }, uDust: { value: dust }, uGhost: { value: 0 }, uMask: { value: tint2 == null ? 0 : 1 }, uTint: { value: new THREE.Color(tint) }, uTint2: { value: new THREE.Color(tint2 ?? tint) }, uHeat: { value: new THREE.Vector4(0, 0, 0, 0) }, uOff: { value: new THREE.Vector3() } };
  const m = new THREE.MeshStandardMaterial({ roughness: rough, metalness: metal, side }); m.userData.u = u; if (clip) { m.clippingPlanes = [clip]; m.clipShadows = true; }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec3 uOff; varying vec3 vOP; varying vec3 vON; varying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position + uOff; vON = normal; vWP = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + TRI)
      .replace('#include <map_fragment>', `triSample(); { vec3 base = mix(uTint, mix(uTint2, uTint, gT.g), uMask); float al = gT.r * 1.75; diffuseColor.rgb *= base * al * (0.62 + 0.76 * gM); }`)
      .replace('#include <normal_fragment_maps>', `{ vec3 on = normalize(vON) + gDN * uBump; vec3 vn = normalize(normalMatrix * on); normal = normalize(mix(normal, vn * (gl_FrontFacing ? 1.0 : -1.0), 1.0)); }
        { vec3 wn = inverseTransformDirection(normal, viewMatrix); float du = smoothstep(0.3, 0.95, wn.y) * uDust * smoothstep(0.2, 0.62, gT.r + gM * 0.5 - 0.12); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.33, 0.30, 0.265) * (0.8 + 0.5 * gT.r), du); roughnessFactor = min(1.0, roughnessFactor + du * 0.2); }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (gT.r - 0.5) * 0.18, 0.05, 1.0);')
      .replace('#include <emissivemap_fragment>', `{ float nv = 1.0 - abs(dot(normalize(vViewPosition), normal)); totalEmissiveRadiance += uHeat.rgb * uHeat.a * (0.25 + 1.1 * pow(nv, 2.0) + 0.45 * smoothstep(0.42, 0.2, gT.r)); if (uGhost > 0.001) diffuseColor.a = mix(1.0, 0.05 + 0.34 * pow(nv, 1.6), uGhost); }`);
  };
  m.customProgramCacheKey = () => 'structure-surface';
  return m;
}
export const rustMat = (clip) => { const m = new THREE.MeshStandardMaterial({ color: 0x7a4527, roughness: 0.82, metalness: 0.3 }); if (clip) m.clippingPlanes = [clip]; return m; };

// ------------------------------------------------------------ chipped geometry
const h3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y, z) { const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), s = (t) => t * t * (3 - 2 * t), u = s(x - ix), v = s(y - iy), w = s(z - iz); let r = 0; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) r += h3(ix + a, iy + b, iz + c) * (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w); return r; }
// wear: how deep edges chip (m). ragged: list of [axis, sign, depth] faces that broke.
function wear(geo, h, seed, amp, ragged = []) {
  const p = geo.attributes.position, v = [0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    v[0] = p.getX(i); v[1] = p.getY(i); v[2] = p.getZ(i); const d = [h[0] - Math.abs(v[0]), h[1] - Math.abs(v[1]), h[2] - Math.abs(v[2])], on = d.map((q) => q < 1e-3);
    const n1 = vnoise(v[0] * 5 + seed, v[1] * 5, v[2] * 5), n2 = vnoise(v[0] * 17 + seed, v[1] * 17, v[2] * 17 + seed);
    const faces = on[0] + on[1] + on[2];
    if (faces >= 2) { const k = amp * Math.max(0, n1 * 1.5 - 0.42) + amp * 0.55 * n2 * n2; for (let a = 0; a < 3; a++) if (on[a]) v[a] -= Math.sign(v[a]) * k * (0.6 + 0.8 * h3(v[a], seed, a)); }
    else if (faces === 1) for (let a = 0; a < 3; a++) if (on[a]) v[a] -= Math.sign(v[a]) * 0.006 * n2;
    for (const [ax, sg, depth] of ragged) { const t = sg * v[ax] / h[ax]; if (t > 0.7) v[ax] -= sg * (t - 0.7) / 0.3 * depth * (n1 * 0.75 + n2 * 0.6); }
    p.setXYZ(i, v[0], v[1], v[2]);
  }
  const g = geo.index ? geo.toNonIndexed() : geo; g.deleteAttribute('uv'); g.computeVertexNormals(); return g;
}
export function chipBox(h, seed, { amp = 0.03, step = 0.35, edge = 0.05, ragged = [] } = {}) {
  const seg = h.map((q) => Math.max(1, Math.min(14, Math.round(2 * q / step))) + 2), g = new THREE.BoxGeometry(2 * h[0], 2 * h[1], 2 * h[2], seg[0], seg[1], seg[2]), p = g.attributes.position;
  const remap = (x, a) => { const n = seg[a], i = Math.round((x / (2 * h[a]) + 0.5) * n), e = Math.min(edge, h[a] * 0.4); if (i === 0) return -h[a]; if (i === n) return h[a]; return -h[a] + e + (i - 1) / Math.max(1, n - 2) * (2 * h[a] - 2 * e); };
  for (let i = 0; i < p.count; i++) p.setXYZ(i, remap(p.getX(i), 0), remap(p.getY(i), 1), remap(p.getZ(i), 2));
  return wear(g, h, seed * 7.31, amp, ragged);
}
// a hollow-core plank: its cross-section with five real cores, extruded along z
export function plankGeo(h, seed) {
  const s = new THREE.Shape(), [hx, hy, hz] = h, pts = [], e = 0.04; const run = (x0, y0, x1, y1, n) => { for (let i = 0; i < n; i++) pts.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]); };
  run(-hx, -hy, -hx + e, -hy, 1); run(-hx + e, -hy, hx - e, -hy, 5); run(hx - e, -hy, hx, -hy, 1); run(hx, -hy, hx, hy, 3); run(hx, hy, hx - e, hy, 1); run(hx - e, hy, -hx + e, hy, 5); run(-hx + e, hy, -hx, hy, 1); run(-hx, hy, -hx, -hy, 3);
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath();
  for (let i = 0; i < 5; i++) { const c = new THREE.Path(), cx = -hx + 2 * hx * (i + 0.5) / 5; c.absellipse(cx, 0, 2 * hx / 5 * 0.36, hy * 0.66, 0, Math.PI * 2, true); s.holes.push(c); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 2 * hz, steps: 12, bevelEnabled: false, curveSegments: 7 }); g.translate(0, 0, -hz);
  return wear(g, h, seed * 3.77, 0.034, [[2, 1, 0.16], [2, -1, 0.1]]);
}
// bent bars growing out of a face
export function bars(list, seed) {
  const r = rng(seed * 97 + 3), gs = [];
  for (const [x, y, z, dx, dy, dz, rad, len] of list) {
    const L = len * (0.45 + r() * 0.9), bend = (r() - 0.35) * 1.1, a = r() * 6.28, side = new THREE.Vector3(Math.cos(a), Math.sin(a), Math.cos(a * 1.7)), d = new THREE.Vector3(dx, dy, dz); side.addScaledVector(d, -side.dot(d)).normalize();
    const p0 = new THREE.Vector3(x, y, z), p1 = p0.clone().addScaledVector(d, L * 0.5).addScaledVector(side, bend * L * 0.12), p2 = p0.clone().addScaledVector(d, L * 0.92).addScaledVector(side, bend * L * 0.55); p2.y -= L * 0.2 * r();
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([p0.clone().addScaledVector(d, -0.05), p1, p2]), 7, rad, 5, false); g.deleteAttribute('uv'); gs.push(g);
  }
  return gs.length ? mergeGeometries(gs) : null;
}

// ------------------------------------------------------------ the person: a smooth-union of capsules, meshed with surface nets
export function personGeo() {
  // lying on the back, head toward +x, 1.72 m long, one knee bent, one arm across the chest
  const C = [ // ax ay az bx by bz ra rb
    [0.74, 0.02, 0.0, 0.78, 0.03, 0.0, 0.1, 0.1], [0.62, 0.0, 0, 0.5, 0, 0, 0.055, 0.07], [0.47, 0.0, 0.15, 0.47, 0.0, -0.15, 0.085, 0.085], [0.42, 0.01, 0.06, 0.02, 0.0, 0.05, 0.12, 0.105], [0.42, 0.01, -0.06, 0.02, 0.0, -0.05, 0.12, 0.105], [0.02, 0, 0.07, -0.06, 0, -0.07, 0.11, 0.11],
    [-0.06, 0, 0.09, -0.36, 0.2, 0.13, 0.085, 0.066], [-0.36, 0.2, 0.13, -0.62, -0.03, 0.12, 0.06, 0.045], [-0.62, -0.05, 0.12, -0.72, 0.0, 0.15, 0.045, 0.04], [-0.06, -0.01, -0.09, -0.46, -0.03, -0.12, 0.085, 0.062], [-0.46, -0.03, -0.12, -0.82, -0.05, -0.13, 0.058, 0.044], [-0.82, -0.05, -0.13, -0.86, 0.06, -0.16, 0.045, 0.036],
    [0.46, 0.0, 0.2, 0.2, -0.01, 0.3, 0.056, 0.046], [0.2, -0.01, 0.3, 0.16, 0.13, 0.08, 0.042, 0.036], [0.46, 0.0, -0.2, 0.22, -0.05, -0.31, 0.056, 0.046], [0.22, -0.05, -0.31, -0.02, -0.07, -0.34, 0.042, 0.036] ];
  const sd = (x, y, z) => { let d = 9; for (const [ax, ay, az, bx, by, bz, ra, rb] of C) { const px = x - ax, py = y - ay, pz = z - az, ex = bx - ax, ey = by - ay, ez = bz - az, t = Math.max(0, Math.min(1, (px * ex + py * ey + pz * ez) / (ex * ex + ey * ey + ez * ez))), q = Math.hypot(px - ex * t, py - ey * t, pz - ez * t) - (ra + (rb - ra) * t), k = 0.045, w = Math.max(0, Math.min(1, 0.5 + 0.5 * (d - q) / k)); d = d + (q - d) * w - k * w * (1 - w); } return d + (vnoise(x * 22, y * 22, z * 22) - 0.5) * 0.012; };
  const nx = 88, ny = 24, nz = 44, s = 0.0225, ox = -0.99, oy = -0.2, oz = -0.5, F = new Float32Array(nx * ny * nz); for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) F[i + nx * (j + ny * k)] = sd(ox + i * s, oy + j * s, oz + k * s);
  const vi = new Int32Array(F.length).fill(-1), pos = [], idx = [], at = (i, j, k) => F[i + nx * (j + ny * k)];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { let sx = 0, sy = 0, sz = 0, n = 0; const E = [[0,0,0,1,0,0],[0,1,0,1,1,0],[0,0,1,1,0,1],[0,1,1,1,1,1],[0,0,0,0,1,0],[1,0,0,1,1,0],[0,0,1,0,1,1],[1,0,1,1,1,1],[0,0,0,0,0,1],[1,0,0,1,0,1],[0,1,0,0,1,1],[1,1,0,1,1,1]];
    for (const [a, b, c, d, e, f] of E) { const u = at(i + a, j + b, k + c), v = at(i + d, j + e, k + f); if ((u < 0) !== (v < 0)) { const t = u / (u - v); sx += a + (d - a) * t; sy += b + (e - b) * t; sz += c + (f - c) * t; n++; } }
    if (n) { vi[i + nx * (j + ny * k)] = pos.length / 3; pos.push(ox + (i + sx / n) * s, oy + (j + sy / n) * s, oz + (k + sz / n) * s); } }
  const V = (i, j, k) => vi[i + nx * (j + ny * k)], quad = (a, b, c, d, f) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; f ? idx.push(a, b, c, a, c, d) : idx.push(a, c, b, a, d, c); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { const a = at(i, j, k) < 0; if (a !== at(i + 1, j, k) < 0) quad(V(i, j - 1, k - 1), V(i, j, k - 1), V(i, j, k), V(i, j - 1, k), a); if (a !== at(i, j + 1, k) < 0) quad(V(i - 1, j, k - 1), V(i - 1, j, k), V(i, j, k), V(i, j, k - 1), a); if (a !== at(i, j, k + 1) < 0) quad(V(i - 1, j - 1, k), V(i, j - 1, k), V(i, j, k), V(i - 1, j, k), a); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const col = new Float32Array(pos.length); for (let i = 0; i < pos.length / 3; i++) { const x = pos[i * 3], z = pos[i * 3 + 2], y = pos[i * 3 + 1]; const skin = (x > 0.6 && x < 0.86 && y > -0.02) || (Math.abs(z) > 0.28 && x < 0.1 && x > -0.1) || (x > 0.1 && x < 0.22 && z < 0.12 && z > 0.02 && y > 0.1); const c = skin ? [0.62, 0.36, 0.25] : x > 0.6 ? [0.06, 0.04, 0.03] : x > -0.02 ? [0.66, 0.24, 0.06] : x > -0.66 ? [0.07, 0.085, 0.12] : [0.05, 0.045, 0.04]; col.set(c, i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
}

// ------------------------------------------------------------ sky, sun and surroundings
export const SUN_DIR = new THREE.Vector3(-0.86, 0.265, 0.44).normalize();
const SKY = `
vec3 skyCol(vec3 d, vec3 sun){ float h = max(d.y, 0.0), m = max(dot(d, sun), 0.0);
  vec3 zen = vec3(0.045, 0.085, 0.16), mid = vec3(0.21, 0.235, 0.285), hor = vec3(0.86, 0.47, 0.215);
  vec3 c = mix(mid, zen, smoothstep(0.08, 0.62, h)); c = mix(c, hor * (0.35 + 0.9 * pow(m, 2.0)), exp(-h * 8.5));
  c += vec3(1.0, 0.5, 0.18) * pow(m, 9.0) * 0.3; c += vec3(1.0, 0.66, 0.32) * pow(m, 90.0) * 1.6; return c; }
float hs(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float ns(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hs(i), hs(i + vec2(1, 0)), f.x), mix(hs(i + vec2(0, 1)), hs(i + vec2(1, 1)), f.x), f.y); }
float fb(vec2 p){ float a = 0.0, w = 0.5; for (int i = 0; i < 5; i++) { a += w * ns(p); p = p * 2.03 + 7.1; w *= 0.5; } return a; }
`;
export const SKY_GLSL = SKY;
export function makeSky() {
  const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { uSun: { value: SUN_DIR }, uGain: { value: 1 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = (modelMatrix * vec4(position, 0.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uSun; uniform float uGain; varying vec3 vD;' + SKY + `void main(){ vec3 d = normalize(vD); vec3 c = skyCol(d, uSun); float m = max(dot(d, uSun), 0.0);
      vec2 p = d.xz / (abs(d.y) + 0.14) * 1.25; float cl = smoothstep(0.46, 0.86, fb(p * vec2(0.55, 1.3) + 3.0)); vec3 cc = mix(vec3(0.13, 0.13, 0.155), vec3(1.15, 0.52, 0.22), pow(m, 1.6) * 0.85 + 0.12 * exp(-d.y * 5.0)); c = mix(c, cc, cl * 0.72 * smoothstep(0.015, 0.13, d.y));
      if (d.y < 0.0) c = mix(c, vec3(0.05, 0.045, 0.04), smoothstep(0.0, -0.06, d.y)); gl_FragColor = vec4(c * uGain, 1.0); }` });
  const m = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 32), mat); m.frustumCulled = false; m.renderOrder = -10; return m;
}
export function makeSurroundings(T) {
  const g = new THREE.Group(), r = rng(77);
  // ground: crushed yard, wet in the hollows away from the bay
  const gm = surface({ tex: T.soil, scale: 0.21, bump: 1.15, dust: 0, tint: 0x6a6259, rough: 0.96 }); const base = gm.onBeforeCompile;
  gm.onBeforeCompile = (sh) => { base(sh); sh.fragmentShader = sh.fragmentShader.replace('roughnessFactor = clamp(', `float far = smoothstep(6.5, 11.0, length(vWP.xz)); float wet = smoothstep(0.5, 0.42, texture2D(uTex, vWP.xz * 0.024 + 0.31).r) * far; diffuseColor.rgb *= mix(1.0, 0.32, wet); gDN *= 1.0 - wet * 0.96; float lt = smoothstep(9.0, 3.0, length(vWP.xz * vec2(0.8, 0.95))); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.5, 1.45, 1.38) + 0.012, lt); roughnessFactor = mix(roughnessFactor, 0.06, wet); roughnessFactor = clamp(`); };
  gm.customProgramCacheKey = () => 'structure-ground';
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), gm); ground.receiveShadow = true; ground.position.y = -0.004; g.add(ground);
  // neighbouring blocks in the haze, a few windows still lit
  const bm = new THREE.MeshStandardMaterial({ color: 0x3b3b3e, roughness: 0.95 });
  bm.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vP; varying vec3 vNN; varying float vId;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = (instanceMatrix * vec4(position, 1.0)).xyz; vNN = normal; vId = instanceMatrix[3].x;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vP; varying vec3 vNN; varying float vId; float hh(vec2 p){ return fract(sin(dot(p, vec2(12.98, 78.23))) * 43758.5453); }').replace('#include <emissivemap_fragment>', `if (abs(vNN.y) < 0.5) { vec2 uv = vec2(abs(vNN.x) > 0.5 ? vP.z : vP.x, vP.y) / vec2(2.4, 3.1); vec2 c = floor(uv), f = fract(uv); float w = step(0.24, f.x) * step(f.x, 0.76) * step(0.3, f.y) * step(f.y, 0.78); float fl = step(f.y, 0.06); diffuseColor.rgb *= mix(1.0, 0.16, w) * (1.0 + 0.5 * fl) * (0.8 + 0.4 * hh(c + vId)); roughnessFactor = mix(roughnessFactor, 0.2, w); totalEmissiveRadiance += w * step(0.972, hh(c * 1.7 + vId)) * vec3(1.0, 0.55, 0.22) * 0.55; }`); };
  const nb = 64, city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bm, nb), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0); let k = 0;
  while (k < nb) { const a = r() * 6.283, d = 34 + r() * 110; p.set(Math.cos(a) * d, 0, Math.sin(a) * d); const hgt = 7 + r() * 13 + (d > 80 ? r() * 18 : 0); s.set(9 + r() * 13, hgt, 9 + r() * 12); if (p.x * SUN_DIR.x + p.z * SUN_DIR.z > d * 0.93 && d < 90) continue; p.y = hgt / 2 - 0.2; q.setFromAxisAngle(up, Math.round(r() * 4) * 0.3926 + (r() - 0.5) * 0.1); m4.compose(p, q, s); city.setMatrixAt(k++, m4); }
  city.receiveShadow = false; g.add(city);
  // utility poles and sagging wire
  const dark = new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.95 }), wires = []; const poles = [[-17, 15], [-21, -4], [-25, -24], [-13, 34]];
  poles.sort((a, b) => a[1] - b[1]).forEach(([x, z], i, A) => { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 8.6, 8), dark); pole.position.set(x, 4.3, z); pole.rotation.z = (r() - 0.5) * 0.1; const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.2), dark); arm.position.set(x, 8, z); arm.rotation.y = 1.45; g.add(pole, arm);
    if (i) { const [x0, z0] = A[i - 1]; for (const o of [-0.9, 0, 0.9]) { const c = new THREE.CatmullRomCurve3([new THREE.Vector3(x0 + o, 8.05, z0), new THREE.Vector3((x0 + x) / 2 + o, 7.1, (z0 + z) / 2), new THREE.Vector3(x + o, 8.05, z)]); wires.push(new THREE.TubeGeometry(c, 24, 0.018, 4)); } } });
  if (wires.length) g.add(new THREE.Mesh(mergeGeometries(wires), dark));
  return { group: g, ground };
}

// ------------------------------------------------------------ particles on a clock: dust sprites and thrown chunks
// Each particle stores where, when and how fast it started; the vertex shader works out where it is at time t. Running the
// clock backwards runs the dust backwards.
export function makeDust(N = 5200, groups = 4) {
  const g = new THREE.BufferGeometry(), A = (n, s) => { const b = new THREE.BufferAttribute(new Float32Array(N * s), s); g.setAttribute(n, b); return b; };
  const pos = A('position', 3), vel = A('aVel', 3), td = A('aT', 4); td.array.fill(-999); let next = 0;
  const clocks = []; for (let i = 0; i < groups; i++) clocks.push(-100);
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: { uClock: { value: clocks }, uScale: { value: 500 }, tDepth: { value: null }, uNF: { value: new THREE.Vector2(0.1, 500) }, uRes: { value: new THREE.Vector2(1, 1) }, uSunDir: { value: SUN_DIR }, tShadow: { value: null }, uSM: { value: new THREE.Matrix4() }, uGain: { value: 1 }, uMul: { value: 1 } },
    vertexShader: `attribute vec3 aVel; attribute vec4 aT; uniform float uClock[${groups}]; uniform float uScale; uniform sampler2D tShadow; uniform mat4 uSM; varying float vA, vZ, vL, vF, vRot; uniform vec3 uSunDir;
      float unpackD(vec4 v){ return dot(v, vec4(1.0, 1.0/256.0, 1.0/65536.0, 1.0/16777216.0)) ; }
      void main(){ int gi = int(aT.w); float ck = uClock[0]; ${Array.from({ length: groups - 1 }, (_, i) => `if (gi == ${i + 1}) ck = uClock[${i + 1}];`).join(' ')}
        float t = ck - aT.x, a = t / aT.y; vA = a; if (t < 0.0 || a >= 1.0 || aT.x < -900.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        float k = 1.55, e = (1.0 - exp(-k * t)) / k; vec3 p = position + aVel * e; p.y += 0.045 * t * t * (1.0 - a * 0.6) + 0.02; p.x += 0.10 * t; p.y = max(p.y, 0.05); p += 0.10 * sin(vec3(1.7, 1.1, 1.3) * t + position.zxy * 5.0) * min(1.0, t);
        vec4 wp = vec4(p, 1.0), mv = viewMatrix * wp; vZ = -mv.z; vec4 sc = uSM * wp; vec3 sp = sc.xyz / sc.w; vL = 1.0; if (sp.x > 0.0 && sp.x < 1.0 && sp.y > 0.0 && sp.y < 1.0 && sp.z < 1.0) { vL = 0.0; for (int i = 0; i < 4; i++) { vec2 o = (vec2(i == 0 || i == 2 ? -1.0 : 1.0, i < 2 ? -1.0 : 1.0)) * 0.009; vL += step(sp.z - 0.004, unpackRGBAToDepth(textureLod(tShadow, sp.xy + o, 0.0))) * 0.25; } }
        vec3 vd = normalize(cameraPosition - p); float c = dot(-vd, uSunDir); vF = 0.35 + 1.9 * pow(max(c, 0.0), 4.0) + 0.35 * c * c; vRot = position.x * 13.0 + position.z * 7.0 + t * 0.12;
        gl_PointSize = min(260.0, aT.z * (0.45 + 2.1 * (1.0 - exp(-1.2 * t))) * uScale / vZ); gl_Position = projectionMatrix * mv; }`.replace('float unpackD', '#include <packing>\nfloat unpackD'),
    fragmentShader: `uniform sampler2D tDepth; uniform vec2 uNF, uRes; uniform float uGain, uMul; varying float vA, vZ, vL, vF, vRot;
      float hs(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); } float ns(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hs(i), hs(i + vec2(1, 0)), f.x), mix(hs(i + vec2(0, 1)), hs(i + vec2(1, 1)), f.x), f.y); }
      void main(){ vec2 d = gl_PointCoord * 2.0 - 1.0; float c = cos(vRot), s = sin(vRot); d = mat2(c, -s, s, c) * d; float r = dot(d, d); if (r > 1.0) discard; float n = ns(d * 2.2 + vRot) * 0.6 + ns(d * 5.0 - vRot) * 0.4; float den = smoothstep(1.0, 0.0, r + (n - 0.5) * 0.9);
        float z = texture2D(tDepth, gl_FragCoord.xy / uRes).x; float lin = uNF.x * uNF.y / (uNF.y - z * (uNF.y - uNF.x)); float soft = clamp((lin - vZ) / 0.5, 0.0, 1.0) * smoothstep(0.4, 1.6, vZ);
        float a = den * soft * smoothstep(0.0, 0.05, vA) * pow(1.0 - vA, 1.5) * 0.19 * uMul; vec3 lit = vec3(1.0, 0.62, 0.33) * (0.06 + vL * vF * 1.15) + vec3(0.10, 0.125, 0.16) * 0.95; gl_FragColor = vec4(lit * a * uGain, a); }` });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
  return { points: pts, mat, clocks, setClock(i, t) { clocks[i] = t; },
    emit(gi, t, x, y, z, s, r, seed = Math.random() * 1e6) { const rr = rng(seed), n = Math.round(4 + 15 * s); for (let i = 0; i < n; i++) { const k = next; next = (next + 1) % N; const a = rr() * 6.283, q = rr() * r * 0.75, sp = 0.4 + rr() * 2.6 * (0.4 + s); pos.setXYZ(k, x + Math.cos(a) * q, Math.max(0.06, y + rr() * 0.3), z + Math.sin(a) * q); vel.setXYZ(k, Math.cos(a) * sp, 0.15 + rr() * 1.5 * (0.5 + s), Math.sin(a) * sp); td.setXYZW(k, t, 2.4 + rr() * 4.2, 0.5 + rr() * 1.0, gi); } },
    flush() { pos.needsUpdate = vel.needsUpdate = td.needsUpdate = true; }, clear() { td.array.fill(-999); next = 0; td.needsUpdate = true; } };
}
export function makeChunks(T, N = 2600, groups = 4) {
  const base = new THREE.IcosahedronGeometry(1, 1).toNonIndexed(); { const p = base.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.55 + 0.75 * vnoise(x * 1.9 + 4, y * 1.9, z * 1.9); p.setXYZ(i, x * k, y * k * 0.72, z * k * 0.9); } base.deleteAttribute('uv'); base.computeVertexNormals(); }
  const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', base.attributes.position); g.setAttribute('normal', base.attributes.normal);
  const A = (n, s) => { const b = new THREE.InstancedBufferAttribute(new Float32Array(N * s), s); g.setAttribute(n, b); return b; };
  const P0 = A('iP', 3), V = A('iV', 3), Q = A('iT', 4), W = A('iR', 4); g.instanceCount = N; Q.array.fill(-999); let next = 0; const clocks = []; for (let i = 0; i < groups; i++) clocks.push(-100);
  const uClock = { value: clocks };
  const head = 'attribute vec3 iP, iV; attribute vec4 iT, iR; uniform float uClock[' + groups + ']; mat3 rotM(vec3 a, float t){ float c = cos(t), s = sin(t), o = 1.0 - c; return mat3(o*a.x*a.x+c, o*a.x*a.y+a.z*s, o*a.x*a.z-a.y*s, o*a.x*a.y-a.z*s, o*a.y*a.y+c, o*a.y*a.z+a.x*s, o*a.x*a.z+a.y*s, o*a.y*a.z-a.x*s, o*a.z*a.z+c); }\n';
  const body = 'int gi = int(iT.w); float ck = uClock[0]; ' + Array.from({ length: groups - 1 }, (_, i) => 'if (gi == ' + (i + 1) + ') ck = uClock[' + (i + 1) + '];').join(' ') + ' float tt = ck - iT.x; float tc = clamp(tt, 0.0, iT.y); mat3 RM = rotM(normalize(iR.xyz), iR.w * (0.4 + tc)); float sc = (tt > 0.0 && iT.x > -900.0) ? iT.z : 0.0; vec3 off = iP + iV * tc + vec3(0.0, -4.905 * tc * tc, 0.0); ';
  const mat = surface({ tex: T.rough, scale: 1.4, bump: 0.8, dust: 0.5, tint: 0xa9a196 }); const b0 = mat.onBeforeCompile;
  const patch = (sh) => { sh.uniforms.uClock = uClock; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + head); };
  mat.onBeforeCompile = (sh) => { b0(sh); patch(sh); sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', body + '\nvec3 objectNormal = RM * normal;').replace('#include <begin_vertex>', 'vec3 transformed = RM * position * sc + off;').replace('vOP = position + uOff', 'vOP = position * iT.z + iP'); };
  mat.customProgramCacheKey = () => 'structure-chunks';
  // begin_vertex was already replaced by the surface patch, so do it by hand
  mat.onBeforeCompile = (sh) => { b0(sh); patch(sh); sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', body + '\nvec3 objectNormal = RM * normal;').replace('#include <begin_vertex>', 'vec3 transformed = RM * position * sc + off;').replace('vOP = position + uOff; vON = normal; vWP = (modelMatrix * vec4(position, 1.0)).xyz;', 'vOP = position * iT.z + iP * 0.37; vON = normal; vWP = off;'); };
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); depth.onBeforeCompile = (sh) => { patch(sh); sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', body + '\nvec3 transformed = RM * position * sc + off;'); };
  const mesh = new THREE.Mesh(g, mat); mesh.customDepthMaterial = depth; mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true;
  const put = (k, gi, t0, p, v, size, seed) => { const r = rng(seed); const disc = v[1] * v[1] + 2 * 9.81 * Math.max(0, p[1] - size * 0.35), tl = (v[1] + Math.sqrt(disc)) / 9.81; P0.setXYZ(k, ...p); V.setXYZ(k, ...v); Q.setXYZW(k, t0, tl, size, gi); W.setXYZW(k, r() - 0.5, r() - 0.5, r() - 0.5 + 0.01, 2 + r() * 9); };
  return { mesh, mat, clocks, setClock(i, t) { clocks[i] = t; },
    emit(gi, t, x, y, z, s, r, seed = Math.random() * 1e6) { const rr = rng(seed + 11), n = Math.round(1 + 8 * s); for (let i = 0; i < n; i++) { const a = rr() * 6.283, q = rr() * r * 0.6, sp = 0.3 + rr() * 2.6 * (0.3 + s); put(next, gi, t, [x + Math.cos(a) * q, y + rr() * 0.2, z + Math.sin(a) * q], [Math.cos(a) * sp, rr() * 1.8, Math.sin(a) * sp], 0.018 + 0.085 * Math.pow(rr(), 3.2), rr() * 1e6); next = (next + 1) % N; } },
    scatter(n, r0, r1, seed) { const rr = rng(seed); for (let i = 0; i < n; i++) { const a = rr() * 6.283, d = r0 + (r1 - r0) * Math.pow(rr(), 1.6); put(next, 0, -100 + 0.001, [Math.cos(a) * d * 1.05, 0.02, Math.sin(a) * d], [0, 0, 0], 0.012 + 0.07 * Math.pow(rr(), 4), rr() * 1e6); next = (next + 1) % N; } },
    flush() { for (const b of [P0, V, Q, W]) b.needsUpdate = true; }, clear() { Q.array.fill(-999); next = 0; Q.needsUpdate = true; } };
}

// ------------------------------------------------------------ post: occlusion, shafts and haze, bloom, grade
const FS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
export function makePost(renderer) {
  const H = THREE.HalfFloatType, rt = (t = H, o = {}) => new THREE.WebGLRenderTarget(4, 4, { type: t, depthBuffer: false, ...o });
  const main = new THREE.WebGLRenderTarget(4, 4, { type: H, samples: 4 }); main.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
  const ao = rt(THREE.UnsignedByteType), atm = rt(), comp = rt(), blooms = [rt(), rt(), rt(), rt(), rt()];
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; const qs = new THREE.Scene(); qs.add(quad);
  const mk = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: FS, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
  const DEP = 'uniform sampler2D tDepth; uniform vec2 uNF; uniform mat4 uPI, uVI; float lin(float z){ return uNF.x * uNF.y / (uNF.y - z * (uNF.y - uNF.x)); } vec3 vpos(vec2 uv, float z){ vec4 p = uPI * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); return p.xyz / p.w; }\n';
  const common = () => ({ tDepth: { value: main.depthTexture }, uNF: { value: new THREE.Vector2() }, uPI: { value: new THREE.Matrix4() }, uVI: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2() } });
  const mAO = mk(DEP + `varying vec2 vUv; uniform vec2 uRes; uniform float uProj; float hs(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
    void main(){ float z = texture2D(tDepth, vUv).x; if (z > 0.99999) { gl_FragColor = vec4(1.0); return; } vec3 P = vpos(vUv, z); vec2 px = 1.0 / uRes;
      vec3 r = vpos(vUv + vec2(px.x, 0.0), texture2D(tDepth, vUv + vec2(px.x, 0.0)).x) - P, l = P - vpos(vUv - vec2(px.x, 0.0), texture2D(tDepth, vUv - vec2(px.x, 0.0)).x), u = vpos(vUv + vec2(0.0, px.y), texture2D(tDepth, vUv + vec2(0.0, px.y)).x) - P, d = P - vpos(vUv - vec2(0.0, px.y), texture2D(tDepth, vUv - vec2(0.0, px.y)).x);
      vec3 N = normalize(cross(abs(r.z) < abs(l.z) ? r : l, abs(u.z) < abs(d.z) ? u : d)); float a0 = hs(gl_FragCoord.xy) * 6.2831, occ = 0.0, w = 0.0;
      for (int s = 0; s < 2; s++) { float R = s == 0 ? 0.22 : 0.85, rp = R * uProj / -P.z; for (int i = 0; i < 7; i++) { float fi = (float(i) + 0.5) / 7.0, an = a0 + float(i) * 2.39996 + float(s) * 1.3; vec2 o = vec2(cos(an), sin(an)) * sqrt(fi) * rp * px; vec2 q = vUv + o; float zz = texture2D(tDepth, q).x; vec3 D = vpos(q, zz) - P; float L = length(D); float k = max(0.0, dot(N, D) / (L + 1e-4) - 0.06 - 0.0012 * -P.z) ; occ += k * smoothstep(R * 1.8, R * 0.4, L); w += 1.0; } }
      float ao = clamp(1.0 - 1.75 * occ / w, 0.0, 1.0); gl_FragColor = vec4(vec3(pow(ao, 1.25)), 1.0); }`, { ...common(), uProj: { value: 1 } });
  const mAtm = mk(DEP + '#include <packing>\n' + SKY + `varying vec2 vUv; uniform vec3 uCam, uSun; uniform sampler2D tShadow; uniform mat4 uSM; uniform float uHaze, uShaft, uTime, uGain; uniform vec3 uPocket; uniform float uPk;
    float ig(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
    void main(){ float z = texture2D(tDepth, vUv).x; vec4 w = uVI * vec4(vpos(vUv, z), 1.0); vec3 rd = w.xyz - uCam; float L = length(rd); rd /= L; bool sky = z > 0.99999; float D = min(L, 40.0), st = D / 22.0, t = st * ig(gl_FragCoord.xy); float T = 1.0; vec3 acc = vec3(0.0); float c = max(dot(rd, uSun), 0.0); float ph = 0.2 + 1.35 * pow(c, 6.0) + 0.4 * pow(c, 2.0);
      for (int i = 0; i < 22; i++) { vec3 p = uCam + rd * t; float hgt = exp(-max(p.y, 0.0) * 0.28); float nse = 0.65 + 0.7 * ns(p.xz * 0.55 + vec2(uTime * 0.06, p.y * 0.8)); float den = uHaze * hgt * nse; float lit = 1.0; vec4 sc = uSM * vec4(p, 1.0); vec3 sp = sc.xyz / sc.w; if (sp.x > 0.0 && sp.x < 1.0 && sp.y > 0.0 && sp.y < 1.0 && sp.z < 1.0) lit = step(sp.z - 0.002, unpackRGBAToDepth(textureLod(tShadow, sp.xy, 0.0)));
        float s = den * st; acc += T * s * (vec3(1.0, 0.58, 0.27) * lit * ph * uShaft + vec3(0.10, 0.12, 0.155)); T *= exp(-s); t += st; }
      float far = max(0.0, (sky ? 260.0 : L) - 22.0); float ft = 1.0 - exp(-far * 0.0062 * exp(-max(uCam.y + rd.y * min(L, 120.0), 0.0) * 0.035)); if (sky) ft *= exp(-max(rd.y, 0.0) * 10.0) * 0.55; vec3 fc = skyCol(normalize(vec3(rd.x, 0.03, rd.z)), uSun) * 0.4; acc += T * ft * fc * uGain; T *= 1.0 - ft; gl_FragColor = vec4(acc, T); }`, { ...common(), uCam: { value: new THREE.Vector3() }, uSun: { value: SUN_DIR }, tShadow: { value: null }, uSM: { value: new THREE.Matrix4() }, uHaze: { value: 0.012 }, uShaft: { value: 1.6 }, uTime: { value: 0 }, uGain: { value: 1 }, uPocket: { value: new THREE.Vector3() }, uPk: { value: 0 } });
  const mComp = mk(DEP + `varying vec2 vUv; uniform sampler2D tMain, tAO, tAtm; uniform vec2 uHalf; uniform float uAO;
    void main(){ float z0 = lin(texture2D(tDepth, vUv).x); vec2 px = 1.0 / uHalf; float a = 0.0, w = 0.0; vec4 at = vec4(0.0); float wa = 0.0;
      for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) { vec2 q = vUv + vec2(float(i), float(j)) * px * 0.8; float z = lin(texture2D(tDepth, q).x); float k = exp(-abs(z - z0) / (0.04 * z0 + 0.02)); a += texture2D(tAO, q).x * k; w += k; float k2 = k * 0.9 + 0.1; at += texture2D(tAtm, q) * k2; wa += k2; }
      vec3 c = texture2D(tMain, vUv).rgb * mix(1.0, a / max(w, 1e-4), uAO); at /= wa; gl_FragColor = vec4(c * at.a + at.rgb, 1.0); }`, { ...common(), tMain: { value: main.texture }, tAO: { value: ao.texture }, tAtm: { value: atm.texture }, uHalf: { value: new THREE.Vector2() }, uAO: { value: 1 } });
  const mDown = mk('varying vec2 vUv; uniform sampler2D t; uniform vec2 px; uniform float th; void main(){ vec3 c = vec3(0.0); for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) c += min(texture2D(t, vUv + vec2(float(i), float(j)) * px * 1.1).rgb, vec3(12.0)); c /= 9.0; if (th > 0.0) { float l = max(c.r, max(c.g, c.b)); c *= max(0.0, l - th) / max(l, 1e-3); } gl_FragColor = vec4(c, 1.0); }', { t: { value: null }, px: { value: new THREE.Vector2() }, th: { value: 0 } });
  const mUp = mk('varying vec2 vUv; uniform sampler2D t; uniform vec2 px; void main(){ vec3 c = vec3(0.0); for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) c += texture2D(t, vUv + vec2(float(i), float(j)) * px).rgb; gl_FragColor = vec4(c / 9.0 * 0.85, 1.0); }', { t: { value: null }, px: { value: new THREE.Vector2() } }, { blending: THREE.AdditiveBlending, transparent: true });
  const mFin = mk(`varying vec2 vUv; uniform sampler2D t, tB; uniform float uTime, uVig, uRew, uExp, uBloom, uCool; uniform vec2 uRes; float hs(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    void main(){ vec2 uv = vUv, c2 = uv - 0.5; vec3 c; if (uRew > 0.001) { float k = uRew * 0.0028; c = vec3(texture2D(t, uv + c2 * k * 2.0).r, texture2D(t, uv).g, texture2D(t, uv - c2 * k * 2.0).b); } else c = texture2D(t, uv).rgb;
      c += texture2D(tB, uv).rgb * uBloom; c *= uExp; float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(c, vec3(l), uRew * 0.55); c = aces(c * 0.92); l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(c + vec3(-0.004, 0.0, 0.007) * (1.0 - smoothstep(0.0, 0.45, l)), c, 0.2); c = mix(vec3(l), c, 1.04); c = pow(c, vec3(0.97)); c *= 1.0 - uVig * smoothstep(0.32, 0.92, length(c2 * vec2(1.0, 0.82)) * 1.12); 
      c = mix(12.92 * c, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); c += (hs(uv * uRes + fract(uTime) * 61.0) - 0.5) * 0.018; gl_FragColor = vec4(c, 1.0); }`, { t: { value: comp.texture }, tB: { value: blooms[0].texture }, uTime: { value: 0 }, uVig: { value: 0.55 }, uRew: { value: 0 }, uExp: { value: 1 }, uBloom: { value: 0.55 }, uCool: { value: 0 }, uRes: { value: new THREE.Vector2() } });
  let W = 4, Hh = 4, hw = 2, hh = 2;
  const pass = (mat, target, clear = true) => { quad.material = mat; renderer.setRenderTarget(target); renderer.autoClear = clear; renderer.render(qs, cam); };
  return { main, uni: { atm: mAtm.uniforms, fin: mFin.uniforms, comp: mComp.uniforms },
    setSize(w, h) { W = Math.max(4, w | 0); Hh = Math.max(4, h | 0); hw = W >> 1; hh = Hh >> 1; main.setSize(W, Hh); comp.setSize(W, Hh); ao.setSize(hw, hh); atm.setSize(hw, hh); let a = hw, b = hh; for (const q of blooms) { q.setSize(Math.max(2, a), Math.max(2, b)); a >>= 1; b >>= 1; } mFin.uniforms.uRes.value.set(W, Hh); mComp.uniforms.uHalf.value.set(hw, hh); },
    render(scene, camera, sun, dustScene, dustMat, time) {
      const auto = renderer.autoClear; renderer.autoClear = true; renderer.setRenderTarget(main); renderer.render(scene, camera);
      for (const m of [mAO, mAtm, mComp]) { m.uniforms.uNF.value.set(camera.near, camera.far); m.uniforms.uPI.value.copy(camera.projectionMatrixInverse); m.uniforms.uVI.value.copy(camera.matrixWorld); m.uniforms.uRes.value.set(hw, hh); }
      mAO.uniforms.uProj.value = hh * 0.5 * camera.projectionMatrix.elements[5]; renderer.shadowMap.autoUpdate = false; pass(mAO, ao);
      const sm = sun.shadow.map; mAtm.uniforms.tShadow.value = sm ? sm.texture : null; mAtm.uniforms.uSM.value.copy(sun.shadow.matrix); mAtm.uniforms.uCam.value.copy(camera.position); mAtm.uniforms.uTime.value = time; pass(mAtm, atm);
      if (dustScene) { const u = dustMat.uniforms; u.tDepth.value = main.depthTexture; u.uNF.value.set(camera.near, camera.far); u.uRes.value.set(hw, hh); u.tShadow.value = sm ? sm.texture : null; u.uSM.value.copy(sun.shadow.matrix); u.uScale.value = hh * 0.5 * camera.projectionMatrix.elements[5]; renderer.setRenderTarget(atm); renderer.autoClear = false; renderer.render(dustScene, camera); }
      pass(mComp, comp); mDown.uniforms.t.value = comp.texture; mDown.uniforms.px.value.set(1 / W, 1 / Hh); mDown.uniforms.th.value = 0.95; pass(mDown, blooms[0]); mDown.uniforms.th.value = 0;
      for (let i = 1; i < blooms.length; i++) { mDown.uniforms.t.value = blooms[i - 1].texture; mDown.uniforms.px.value.set(1 / blooms[i - 1].width, 1 / blooms[i - 1].height); pass(mDown, blooms[i]); }
      for (let i = blooms.length - 1; i > 0; i--) { mUp.uniforms.t.value = blooms[i].texture; mUp.uniforms.px.value.set(1 / blooms[i].width, 1 / blooms[i].height); pass(mUp, blooms[i - 1], false); }
      mFin.uniforms.uTime.value = time; pass(mFin, null); renderer.autoClear = auto; renderer.shadowMap.autoUpdate = true;
    },
    dispose() { for (const q of [main, ao, atm, comp, ...blooms]) q.dispose(); } };
}
