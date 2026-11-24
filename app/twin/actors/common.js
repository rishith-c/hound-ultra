// Shared helpers for the twin's actors (twin-actors). Nothing here creates a renderer or touches the camera.
//
// Conventions used by every actor:
//   world [x, y] metres  ->  three.js (x, height, -y)        use t.v3(p, h)
//   world heading (rad, 0 = east, counter-clockwise)  ->  object.rotation.y = heading (model faces local +x)
//   ground decals sit at t.groundY + Y.<layer> so they never z-fight with each other
//   colours come from the design tokens through palette(t); they follow the colour-blind palette live

// Drawn larger than life so they read from an overview camera. Said plainly in the report: not to scale.
export const SCALE = { rover: 1.5, drone: 4 };

// Height above the ground for each kind of floor decal, in metres. Higher = drawn on top.
export const Y = { fog: 0.035, coverage: 0.045, swath: 0.055, hazard: 0.065, trail: 0.075, path: 0.085, route: 0.095, marker: 0.11, ring: 0.12, select: 0.13 };

export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif';
export const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const TOKENS = { person: ['--person', '#ff6a45'], warn: ['--warn', '#ffb224'], accent: ['--accent', '#5aa9ff'], ok: ['--ok', '#41d6a0'], danger: ['--danger', '#ff4d5e'], sim: ['--sim', '#b79cff'], text: ['--text', '#e9edf2'], dim: ['--text-3', '#74808e'] };
const pals = new WeakMap();

// palette(t) -> { person, warn, accent, ok, danger, sim, text, dim, scan, css: { person: '#…', … } }
// The THREE.Color objects are shared and are updated in place when the user switches palette, so put the SAME
// object in a shader uniform ({ value: pal.person }) or call material.color.copy(pal.person) each frame if needed.
export function palette(t) {
  let pal = pals.get(t.ctx);
  if (pal) return pal;
  const { THREE } = t;
  pal = { css: {} };
  for (const k of Object.keys(TOKENS)) pal[k] = new THREE.Color();
  pal.scan = new THREE.Color('#bfe3ff'); pal.css.scan = '#bfe3ff';   // cool white-blue: scan lines, sensing
  pal.heat = ['#10151c', '#2b3f6b', '#7a3f8f', '#d8504d', '#ffb24a', '#fff3c4'];
  const read = () => {
    for (const [k, [name, fallback]] of Object.entries(TOKENS)) {
      let v = '';
      try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch { /* no DOM */ }
      if (!/^#[0-9a-f]{6}$/i.test(v)) v = fallback;
      pal[k].set(v); pal.css[k] = v;
    }
  };
  read();
  try { t.ctx.bus?.on('prefs', () => setTimeout(read, 0)); } catch { /* no bus: fixed palette */ }
  pals.set(t.ctx, pal);
  return pal;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, k) => a + (b - a) * k;
export const smoothstep = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
// Frame-rate independent easing toward a target. lambda = how fast (1/s); 8 is gentle, 20 is snappy.
export const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
export function dampAngle(cur, target, lambda, dt) {
  let d = (target - cur) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return cur + d * (1 - Math.exp(-lambda * dt));
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
export const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// True on the first call and whenever sim.state is a new object (after 'reset' or 'seek'): rebuild, do not animate.
export function stateWatcher() { let last = null; return (state) => { const changed = state !== last; last = state; return changed; }; }

// ---------- 2-D paths ----------
export function pathLength(path) { let s = 0; for (let i = 1; i < path.length; i++) s += dist2(path[i - 1], path[i]); return s; }
// Drop points that sit on a straight line between their neighbours.
export function simplifyPath(path, eps = 0.02) {
  if (path.length < 3) return path.map((p) => p.slice());
  const out = [path[0].slice()];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1], b = path[i], c = path[i + 1];
    const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (cross / Math.max(1e-6, dist2(a, c)) > eps) out.push(b.slice());
  }
  out.push(path[path.length - 1].slice());
  return out;
}
// Round the corners (Chaikin corner cutting, limited to "radius" metres so walls are still respected).
export function smoothPath(path, { iterations = 2, radius = 0.6 } = {}) {
  let pts = simplifyPath(path);
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) break;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const la = dist2(a, b), lc = dist2(b, c), r = radius / (it + 1);
      const ka = Math.min(0.25, r / Math.max(la, 1e-6)), kc = Math.min(0.25, r / Math.max(lc, 1e-6));
      out.push([b[0] + (a[0] - b[0]) * ka, b[1] + (a[1] - b[1]) * ka], [b[0] + (c[0] - b[0]) * kc, b[1] + (c[1] - b[1]) * kc]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}
// The part of a path that is still ahead of pos: [pos, …rest].
export function pathAhead(path, pos) {
  if (!path || path.length < 2) return null;
  let best = 0, bd = Infinity, bt = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const k = l2 ? clamp(((pos[0] - a[0]) * dx + (pos[1] - a[1]) * dy) / l2, 0, 1) : 0;
    const d = Math.hypot(pos[0] - (a[0] + dx * k), pos[1] - (a[1] + dy * k));
    if (d < bd - 1e-9) { bd = d; best = i; bt = k; }
  }
  const out = [pos.slice()];
  if (bt < 1 - 1e-6) out.push(...path.slice(best).map((p) => p.slice())); else out.push(...path.slice(best + 1).map((p) => p.slice()));
  return out.length > 1 ? out : null;
}
// Point and heading at distance d along a path.
export function pointAlong(path, d) {
  for (let i = 1; i < path.length; i++) {
    const l = dist2(path[i - 1], path[i]);
    if (d <= l || i === path.length - 1) {
      const k = l === 0 ? 0 : clamp(d / l, 0, 1);
      return { pos: [lerp(path[i - 1][0], path[i][0], k), lerp(path[i - 1][1], path[i][1], k)], heading: Math.atan2(path[i][1] - path[i - 1][1], path[i][0] - path[i - 1][0]) };
    }
    d -= l;
  }
  return { pos: path[path.length - 1].slice(), heading: 0 };
}
export function polyCentroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]; a += f; cx += (poly[j][0] + poly[i][0]) * f; cy += (poly[j][1] + poly[i][1]) * f; }
  if (Math.abs(a) < 1e-9) return poly[0].slice();
  return [cx / (3 * a), cy / (3 * a)];
}

// ---------- geometry lying on the ground (local y = 0; position the mesh at t.groundY + Y.something) ----------
// A flat ribbon along a world path. uv.x = metres from the start, uv.y = -1 (left edge) … +1 (right edge).
// geometry.userData.length = total length in metres.
export function ribbonGeometry(THREE, path, width) {
  const n = path.length, pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
  let s = 0; const hw = width / 2;
  for (let i = 0; i < n; i++) {
    const p = path[i], a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    if (i > 0) s += dist2(path[i - 1], p);
    let d0x = p[0] - a[0], d0y = p[1] - a[1], d1x = b[0] - p[0], d1y = b[1] - p[1];
    const l0 = Math.hypot(d0x, d0y) || 1, l1 = Math.hypot(d1x, d1y) || 1;
    d0x /= l0; d0y /= l0; d1x /= l1; d1y /= l1;
    if (i === 0) { d0x = d1x; d0y = d1y; } if (i === n - 1) { d1x = d0x; d1y = d0y; }
    let tx = d0x + d1x, ty = d0y + d1y; const tl = Math.hypot(tx, ty);
    if (tl < 1e-6) { tx = d1x; ty = d1y; } else { tx /= tl; ty /= tl; }
    const nx = -ty, ny = tx;                                   // left normal
    const miter = Math.min(2.2, 1 / Math.max(0.35, nx * -d1y + ny * d1x));
    const ox = nx * hw * miter, oy = ny * hw * miter;
    pos.set([p[0] + ox, 0, -(p[1] + oy), p[0] - ox, 0, -(p[1] - oy)], i * 6);
    uv.set([s, -1, s, 1], i * 4);
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.userData.length = s;
  return g;
}
// A filled polygon on the ground. uv = world [x, y] in metres (so hatching can be in world space).
export function polyGeometry(THREE, poly) {
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1])));
  const sg = new THREE.ShapeGeometry(shape), src = sg.attributes.position;
  const pos = new Float32Array(src.count * 3), uv = new Float32Array(src.count * 2);
  for (let i = 0; i < src.count; i++) { const x = src.getX(i), y = src.getY(i); pos.set([x, 0, -y], i * 3); uv.set([x, y], i * 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const ix = Array.from(sg.index.array);                        // flip winding so the face points up
  for (let i = 0; i < ix.length; i += 3) { const k = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = k; }
  g.setIndex(ix); sg.dispose();
  return g;
}
// A closed outline of a polygon as a ribbon (uv as in ribbonGeometry).
export function outlineGeometry(THREE, poly, width) { return ribbonGeometry(THREE, [...poly, poly[0]].map((p) => p.slice()), width); }
// A flat ring (or arc) on the ground, centred on the origin. uv.x = 0..1 around, uv.y = 0 inner … 1 outer.
export function ringGeometry(THREE, r0, r1, segments = 64, start = 0, length = Math.PI * 2) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segments; i++) {
    const k = i / segments, a = start + length * k, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * r0, 0, -s * r0, c * r1, 0, -s * r1); uv.push(k, 0, k, 1);
    if (i < segments) { const j = i * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ---------- text ----------
// A canvas you can draw text on, as a texture. redraw((ctx2d, w, h) => { … }) repaints it (call only on change).
export function canvasTexture(THREE, w, h) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const c2 = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { canvas, ctx: c2, texture: tex, redraw(fn) { c2.clearRect(0, 0, w, h); fn(c2, w, h); tex.needsUpdate = true; } };
}
// Text painted flat on the ground, w by h metres, read from the south (its top edge points north).
// Returns { mesh, redraw(fn), dispose() }. Position mesh with mesh.position.copy(t.v3(p, t.groundY + Y.marker)).
export function groundText(THREE, w, h, pxPerM = 96, { opacity = 1 } = {}) {
  const ct = canvasTexture(THREE, Math.round(w * pxPerM), Math.round(h * pxPerM));
  const geo = new THREE.PlaneGeometry(w, h); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: ct.texture, transparent: true, depthWrite: false, toneMapped: false, opacity, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 6;
  return { mesh, redraw: ct.redraw, material: mat, dispose() { geo.dispose(); mat.dispose(); ct.texture.dispose(); } };
}
// A camera-facing sprite with canvas text. size = world height in metres.
export function textSprite(THREE, w, h, size, { depthTest = false } = {}) {
  const ct = canvasTexture(THREE, w, h);
  const mat = new THREE.SpriteMaterial({ map: ct.texture, transparent: true, depthWrite: false, depthTest, toneMapped: false });
  const sprite = new THREE.Sprite(mat); sprite.scale.set(size * w / h, size, 1); sprite.renderOrder = 20;
  return { sprite, redraw: ct.redraw, material: mat, dispose() { mat.dispose(); ct.texture.dispose(); } };
}

// Free every geometry, material and texture under root, and take root out of its parent.
export function disposeTree(root) {
  if (!root) return;
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u.value && u.value.isTexture) u.value.dispose(); m.dispose(); }
  });
  root.parent?.remove(root);
}

// A flat transparent material for ground decals with sane defaults (no depth write, polygon offset, not tone mapped).
export function decalMaterial(THREE, params) {
  return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide, ...params });
}
