// Shared helpers for the twin's world builders. Everything random is seeded from world.SEED, so the site is
// identical on every load. World [x, y] (metres, x east, y north) maps to three.js (x, height, -y).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/geometry.js';
import { SEED } from '../core/world.js';

export const v3 = (p, h = 0) => new THREE.Vector3(p[0], h, -p[1]);

function hashStr(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
// A named random stream: rng('rubble') always gives the same numbers, whatever else was built before it.
export function rng(name) {
  const r = mulberry32((SEED ^ hashStr(String(name))) >>> 0);
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  r.gauss = () => (r() + r() + r() + r() - 2) / 2;
  return r;
}

// Smooth value noise in 2-D, 0..1, and a fractal sum of it.
export function makeNoise(name) {
  const r = rng('noise:' + name), N = 256, tab = new Float32Array(N * N);
  for (let i = 0; i < tab.length; i++) tab[i] = r();
  const at = (x, y) => tab[((y & 255) << 8) | (x & 255)];
  const n = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  n.fbm = (x, y, oct = 4, gain = 0.5) => { let s = 0, a = 0.5, f = 1, t = 0; for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); t += a; a *= gain; f *= 2.03; } return s / t; };
  return n;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export function xform(geo, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z);
  if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  return geo.applyMatrix4(_m.compose(_p, _q, _s));
}
export function matrix(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z);
  if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(_p, _q, _s);
}
// A box whose base sits at height y (not its centre), already moved into place.
export function box(w, h, d, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0);
  return xform(g, x, y, z, ry, rx, rz);
}
export function cyl(rTop, rBot, h, x = 0, y = 0, z = 0, seg = 12, ry = 0, rx = 0, rz = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg); g.translate(0, h / 2, 0);
  return xform(g, x, y, z, ry, rx, rz);
}

// Texture coordinates in metres taken from where the geometry is in the world, so a texture runs continuously
// across every piece of a wall. Horizontal faces use (x, z); vertical faces use (distance along the face, height).
export function worldUV(geo, su = 1, sv = su) {
  if (geo.index) { const ni = geo.toNonIndexed(); geo.dispose(); geo = ni; }
  const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    let u, v;
    if (ny > nx && ny > nz) { u = p.getX(i); v = p.getZ(i); } else if (nx > nz) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * su; uv[i * 2 + 1] = v * sv;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// Paint a whole geometry one colour (vertex colours), so many differently coloured parts can share one material
// and one draw call.
const _c = new THREE.Color();
export function tint(geo, color, jitter = 0, r = null) {
  _c.set(color);
  if (jitter && r) { const k = 1 + (r() - 0.5) * 2 * jitter; _c.multiplyScalar(k); }
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

// Merge geometries of any kind into one. Attributes that not every piece has are dropped or filled in.
export function merge(list, { keepUV = true, keepColor = null } = {}) {
  list = list.filter(Boolean);
  if (!list.length) return new THREE.BufferGeometry();
  const wantColor = keepColor ?? list.some((g) => g.attributes.color);
  const out = list.map((g) => {
    let q = g.index ? g.toNonIndexed() : g;
    if (q !== g) g.dispose();
    if (!q.attributes.normal) q.computeVertexNormals();
    if (keepUV && !q.attributes.uv) q.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2));
    if (!keepUV && q.attributes.uv) q.deleteAttribute('uv');
    if (wantColor && !q.attributes.color) tint(q, 0xffffff);
    if (!wantColor && q.attributes.color) q.deleteAttribute('color');
    for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) q.deleteAttribute(k);
    return q;
  });
  const m = mergeGeometries(out, false);
  out.forEach((g) => g.dispose());
  return m;
}

export function mesh(geo, mat, { cast = true, receive = true, name = '' } = {}) {
  const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = receive; m.name = name; m.matrixAutoUpdate = false; m.updateMatrix();
  return m;
}
export function instanced(geo, mat, matrices, { colors = null, cast = true, receive = true, name = '' } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, matrices.length);
  for (let i = 0; i < matrices.length; i++) { im.setMatrixAt(i, matrices[i]); if (colors) im.setColorAt(i, _c.set(colors[i])); }
  im.instanceMatrix.needsUpdate = true; if (colors) im.instanceColor.needsUpdate = true;
  im.castShadow = cast; im.receiveShadow = receive; im.name = name; im.matrixAutoUpdate = false; im.updateMatrix();
  im.computeBoundingSphere(); im.computeBoundingBox();
  return im;
}

// An irregular rock or broken chunk: a low-poly sphere pushed around, flat shaded.
export function rock(r, name, { flat = 1, detail = 1 } = {}) {
  const R = typeof name === 'function' ? name : rng('rock:' + name);
  const src = new THREE.IcosahedronGeometry(1, detail), g0 = src.toNonIndexed(); src.dispose();
  const p = g0.attributes.position, seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
    let k = seen.get(key); if (k === undefined) { k = 0.72 + R() * 0.5; seen.set(key, k); }
    p.setXYZ(i, p.getX(i) * k * r, p.getY(i) * k * r * flat, p.getZ(i) * k * r);
  }
  g0.computeVertexNormals();
  return worldUV(g0, 0.6);
}

// A slab of broken concrete: an extruded jagged outline.
export function slab(w, d, th, R, jag = 0.18) {
  const pts = [], n = 7 + Math.floor(R() * 4);
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, k = 1 - jag + R() * jag * 2; pts.push(new THREE.Vector2(Math.cos(a) * w * 0.5 * k * (0.9 + 0.2 * Math.abs(Math.cos(a))), Math.sin(a) * d * 0.5 * k * (0.9 + 0.2 * Math.abs(Math.sin(a))))); }
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: th, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return worldUV(g, 0.5);
}

export function tube(points, radius, { radial = 5, segs = null, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.5);
  return new THREE.TubeGeometry(curve, segs ?? Math.max(4, points.length * 4), radius, radial, closed);
}

export function polyCentroid(poly) { let x = 0, y = 0; for (const p of poly) { x += p[0]; y += p[1]; } return [x / poly.length, y / poly.length]; }
export function polyBounds(poly) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of poly) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); } return [a, b, c, d]; }
// A corrugated iron sheet lying in x/z, ridges along z: bent, creased, dented, with torn edges. Its texture coordinates
// are in metres (0.912 m = 12 ridges of 76 mm across, 2.4 m along), so the ridges have the same pitch on every sheet.
export function ironSheet(w, l, R, { bend = 0.14, dent = 0.05, tear = 0.07, segs = [Math.ceil(w / 0.13), Math.ceil(l / 0.16)] } = {}) {
  const [nx, nz] = segs, g = new THREE.PlaneGeometry(w, l, nx, nz).rotateX(-Math.PI / 2), p = g.attributes.position, uv = g.attributes.uv, ou = Math.floor(R() * 12) / 12, ov = R();
  const curl = R.gauss() * bend, twist = R.gauss() * bend * 0.6, k = 0.25 + R() * 0.5, kink = R.gauss() * bend * 1.6, skew = R.gauss() * 0.3, dents = Array.from({ length: 4 }, () => [(R() - 0.5) * w, (R() - 0.5) * l, 0.12 + R() * 0.3, (R() - 0.65) * dent * 2]);
  const bite = [0, 1, 2].map(() => [R() * l - l / 2, R.sign(), 0.08 + R() * 0.2, tear * (1 + R() * 3)]);
  for (let i = 0; i < p.count; i++) {
    const ix = i % (nx + 1), iz = Math.floor(i / (nx + 1)); let x = p.getX(i), z = p.getZ(i); uv.setXY(i, x / 0.912 + ou, z / 2.4 + ov);
    if (iz === 0 || iz === nz) z -= Math.sign(z) * R() * R() * tear * 1.1;
    if (ix === 0 || ix === nx) { x -= Math.sign(x) * R() * R() * tear; for (const b of bite) if (Math.sign(x) === b[1] && Math.abs(z - b[0]) < b[2]) x -= Math.sign(x) * b[3] * R(); }
    const u = x / w, v = z / l; let y = curl * v * v * l + twist * u * v * l + Math.max(0, v + 0.5 - k + u * skew) * kink * l + (Math.abs(u) > 0.4 && Math.abs(v) > 0.42 ? R() * tear * 1.5 : 0);
    for (const d of dents) y += d[3] * Math.exp(-((x - d[0]) ** 2 + (z - d[1]) ** 2) / (d[2] * d[2]));
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals(); return g;
}
// Put metric sheet coordinates on a plane made elsewhere (w across the ridges, l along them).
export function ironUV(g, w, l) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 0.912, uv.getY(i) * l / 2.4); return g; }
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt);

export function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) { for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); } m.dispose?.(); }
  });
}
export { THREE };
