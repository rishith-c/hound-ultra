// The 3-D viewer for the scan: one WebGL canvas.
//   pass 1  every point, through a custom shader (size falls off with distance; colour by height above ground,
//           intensity, class or capture time; section plane; replay reveal), into an off-screen target with depth
//   pass 2  eye-dome lighting: each pixel is darkened by how far it sits behind its neighbours, which gives a
//           cloud of unlit dots the look of a solid, shaded surface. Depth is written back so that…
//   pass 3  …the overlays (voids, flight path, scanner fan, routes, section frame) are hidden by the points in front.
// World [x east, y north, z up] maps to three.js (x, z, -y).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { poseAt } from './scene.js';

const V3 = (x, y, z) => new THREE.Vector3(x, z, -y);
const hex = (c) => new THREE.Color(c);

const POINT_VS = /* glsl */ `
attribute float aI; attribute float aC; attribute float aT; attribute float aH; attribute float aS; attribute vec3 aRGB;
uniform int uMode; uniform float uSize, uScale, uMinPx, uMaxPx, uTime, uFlash, uH0, uH1, uDur, uSect, uSlab;
uniform sampler2D uRamp; uniform vec3 uCls[4]; uniform float uOn[4]; uniform vec4 uPlane; uniform vec3 uGlow;
varying vec3 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  int c = int(aC + 0.5);
  float hide = aT > uTime ? 1.0 : 0.0;
  if (uOn[c] < 0.5) hide = 1.0;
  float glow = 0.0;
  if (uSect > 0.5) {
    float sd = dot(uPlane.xyz, position) + uPlane.w;
    if (sd > 0.0) hide = 1.0;
    if (uSlab > 0.0 && sd < -uSlab) hide = 1.0;
    glow = smoothstep(0.14, 0.0, -sd);
  }
  vec3 col;
  float tex = 0.66 + 0.56 * aI;
  if (uMode == 0) col = texture2D(uRamp, vec2(clamp((aH - uH0) / (uH1 - uH0), 0.0, 1.0), 0.25)).rgb * tex;
  else if (uMode == 1) col = mix(vec3(0.05, 0.065, 0.09), vec3(0.88, 0.94, 1.0), pow(aI, 0.75));
  else if (uMode == 2) col = uCls[c] * (0.55 + 0.62 * aI);
  else if (uMode == 3) col = texture2D(uRamp, vec2(clamp(aT / uDur, 0.0, 1.0), 0.75)).rgb * (0.7 + 0.4 * aI);
  else col = aRGB;
  float fresh = uFlash * exp(-max(0.0, uTime - aT) * 2.2);
  col = mix(col, uGlow, clamp(fresh + glow * 0.85, 0.0, 1.0));
  vCol = col;
  float s = clamp(uSize * aS * 0.002 * uScale / -mv.z, uMinPx, uMaxPx) * (1.0 + 0.9 * fresh + 0.5 * glow);
  gl_PointSize = s;
  if (hide > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; }
}`;
const POINT_FS = /* glsl */ `
varying vec3 vCol;
void main() { vec2 p = gl_PointCoord - 0.5; if (dot(p, p) > 0.25) discard; gl_FragColor = vec4(vCol, 1.0); }`;
const EDL_FS = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uPx; uniform float uNear, uFar, uStrength, uRadius, uFog; uniform vec3 uBg0, uBg1;
varying vec2 vUv;
float lz(vec2 uv) { float d = texture2D(tDepth, uv).x; if (d >= 0.999999) return -1.0; return log2((2.0 * uNear * uFar) / (uFar + uNear - (2.0 * d - 1.0) * (uFar - uNear))); }
void main() {
  float d = texture2D(tDepth, vUv).x;
  vec2 q = vUv - vec2(0.5, 0.42);
  vec3 bg = mix(uBg1, uBg0, smoothstep(0.0, 0.75, length(q * vec2(1.0, 1.25))));
  if (d >= 0.999999) { gl_FragColor = vec4(bg, 1.0); gl_FragDepth = 1.0; return; }
  float l = lz(vUv), s = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982;
    float n = lz(vUv + vec2(cos(a), sin(a)) * uPx * uRadius);
    if (n > 0.0) s += max(0.0, l - n);
  }
  float shade = exp(-s * 37.5 * uStrength);
  vec3 col = texture2D(tColor, vUv).rgb * (0.22 + 0.78 * shade);
  col = mix(col, bg, 1.0 - exp(-exp2(l) * uFog));
  gl_FragColor = vec4(col, 1.0); gl_FragDepth = d;
}`;
const QUAD_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const VOID_VS = 'varying vec3 vN; varying vec3 vV; varying float vY; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; vY = position.y; gl_Position = projectionMatrix * mv; }';
const VOID_FS = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float band = smoothstep(0.9, 1.0, fract(vY / 0.25));
  gl_FragColor = vec4(uColor * (0.75 + 0.7 * f), uAlpha * (0.16 + 0.7 * f + 0.22 * band));
}`;
const FAN_VS = 'attribute float aA; varying float vA; void main() { vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const FAN_FS = 'uniform vec3 uColor; varying float vA; void main() { gl_FragColor = vec4(uColor, vA); }';

function rampTexture(height, time) {
  const w = 256, data = new Uint8Array(w * 2 * 4);
  const fill = (row, stops) => { for (let i = 0; i < w; i++) { const t = i / (w - 1); let k = 0; while (k < stops.length - 2 && t > stops[k + 1][0]) k++; const a = stops[k], b = stops[k + 1], u = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))), ca = hex(a[1]), cb = hex(b[1]); const o = (row * w + i) * 4; data[o] = (ca.r + (cb.r - ca.r) * u) * 255; data[o + 1] = (ca.g + (cb.g - ca.g) * u) * 255; data[o + 2] = (ca.b + (cb.b - ca.b) * u) * 255; data[o + 3] = 255; } };
  THREE.ColorManagement.enabled = false; fill(0, height); fill(1, time); THREE.ColorManagement.enabled = true;
  const t = new THREE.DataTexture(data, w, 2); t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t;
}
export const HEIGHT_RAMP = [[0, '#2a425f'], [0.1, '#2f5f8c'], [0.28, '#3f8fb5'], [0.48, '#7cc7c0'], [0.68, '#d9e3a6'], [0.86, '#ffcf7a'], [1, '#fff3c4']];
export const TIME_RAMP = [[0, '#2b3f6b'], [0.35, '#3d79c4'], [0.7, '#73c0f5'], [1, '#e4f4ff']];

export function createView(host, { colors, reduced = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.autoClear = false; renderer.setClearColor(0x07090c, 1);
  const canvas = renderer.domElement; canvas.className = 'scan-canvas'; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Point cloud of the scan. Drag to orbit, scroll to zoom, right-drag to pan.'); canvas.tabIndex = 0;
  const labels = document.createElement('div'); labels.className = 'scan-labels';
  host.append(canvas, labels);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 900);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.09; controls.maxPolarAngle = Math.PI * 0.497; controls.minDistance = 2.5; controls.maxDistance = 420; controls.zoomSpeed = 0.9; controls.rotateSpeed = 0.75; controls.screenSpacePanning = false; controls.autoRotateSpeed = 0.28;
  controls.listenToKeyEvents(canvas); controls.keyPanSpeed = 18;
  const pScene = new THREE.Scene(), oScene = new THREE.Scene(), qScene = new THREE.Scene(), qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let rt = null;
  const C = { glow: '#cfe9ff', accent: '#5aa9ff', warn: '#ffb224', person: '#ff6a45', ok: '#41d6a0', text3: '#74808e', bg0: '#07090c', bg1: '#10151c', ...colors };

  const U = {
    uMode: { value: 0 }, uSize: { value: 1.7 }, uScale: { value: 1000 }, uMinPx: { value: 1.6 }, uMaxPx: { value: 26 }, uTime: { value: 1e9 }, uFlash: { value: 0 }, uH0: { value: 0 }, uH1: { value: 7.5 }, uDur: { value: 1 },
    uSect: { value: 0 }, uSlab: { value: 0 }, uPlane: { value: new THREE.Vector4(0, 1, 0, -3) }, uGlow: { value: hex(C.glow) }, uRamp: { value: rampTexture(HEIGHT_RAMP, TIME_RAMP) },
    uCls: { value: [hex('#6a7684'), hex('#8fb8e8'), hex(C.warn), hex(C.ok)] }, uOn: { value: [1, 1, 1, 1] },
  };
  const pMat = new THREE.ShaderMaterial({ vertexShader: POINT_VS, fragmentShader: POINT_FS, uniforms: U });
  let points = null, data = null, posT = null, count = 0;
  const E = { tColor: { value: null }, tDepth: { value: null }, uPx: { value: new THREE.Vector2() }, uNear: { value: camera.near }, uFar: { value: camera.far }, uStrength: { value: 1 }, uRadius: { value: 1.6 }, uFog: { value: 0.0016 }, uBg0: { value: hex(C.bg0) }, uBg1: { value: hex(C.bg1) } };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: EDL_FS, uniforms: E, depthFunc: THREE.AlwaysDepth, depthWrite: true, depthTest: true }));
  quad.frustumCulled = false; qScene.add(quad);

  // ---------- small helpers
  const listeners = {};
  const emit = (t, v) => (listeners[t] || []).forEach((f) => f(v));
  const gz = (x, y) => { const g = data && data.ground; if (!g) return 0; let fx = x - g.x0 - 0.5, fy = y - g.y0 - 0.5; fx = Math.min(g.w - 1.001, Math.max(0, fx)); fy = Math.min(g.h - 1.001, Math.max(0, fy)); const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * g.w + i; return g.z[k] * (1 - u) * (1 - v) + g.z[k + 1] * u * (1 - v) + g.z[k + g.w] * (1 - u) * v + g.z[k + g.w + 1] * u * v; };
  const lineMat = (color, opacity = 1, extra = {}) => new THREE.LineBasicMaterial({ color, transparent: opacity < 1 || !!extra.transparent, opacity, ...extra });
  const drape = (path, lift = 0.25, step = 1) => { const out = []; for (let i = 0; i < path.length; i++) { const a = path[i]; if (i) { const b = path[i - 1], d = Math.hypot(a[0] - b[0], a[1] - b[1]), n = Math.max(1, Math.round(d / step)); for (let q = 1; q < n; q++) { const x = b[0] + ((a[0] - b[0]) * q) / n, y = b[1] + ((a[1] - b[1]) * q) / n; out.push(V3(x, y, gz(x, y) + lift)); } } out.push(V3(a[0], a[1], gz(a[0], a[1]) + lift)); } return out; };
  const groups = {}; for (const k of ['frame', 'flight', 'voids', 'leads', 'routes', 'zones', 'occ', 'section', 'measure', 'access']) { groups[k] = new THREE.Group(); oScene.add(groups[k]); }
  const clear = (g) => { for (const o of [...g.children]) { g.remove(o); o.traverse?.((m) => { m.geometry?.dispose?.(); if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); }); } };
  const tags = new Map(); // key -> { el, v: Vector3, group }
  function tag(key, group, cls, v, html, opts = {}) {
    let t = tags.get(key);
    if (!t) { const el = document.createElement(opts.button ? 'button' : 'div'); el.className = 'scan-tag ' + cls; if (opts.button) el.type = 'button'; labels.append(el); t = { el, v: new THREE.Vector3(), group }; tags.set(key, t); if (opts.onclick) el.addEventListener('click', opts.onclick); }
    t.v.copy(v); if (html != null && t.html !== html) { t.el.innerHTML = html; t.html = html; } t.el.className = 'scan-tag ' + cls; t.hidden = false; return t;
  }
  const dropTags = (group) => { for (const [k, t] of tags) if (t.group === group) { t.el.remove(); tags.delete(k); } };
  const tmp = new THREE.Vector3();
  function placeTags() {
    const w = host.clientWidth, h = host.clientHeight;
    for (const t of tags.values()) {
      tmp.copy(t.v).project(camera);
      const vis = !t.hidden && tmp.z < 1 && tmp.z > -1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
      t.el.style.display = vis ? '' : 'none';
      if (vis) t.el.style.transform = 'translate(' + ((tmp.x * 0.5 + 0.5) * w).toFixed(1) + 'px,' + ((-tmp.y * 0.5 + 0.5) * h).toFixed(1) + 'px)';
    }
  }

  // ---------- the cloud
  function setCloud(d) {
    data = d;
    if (points) { pScene.remove(points); points.geometry.dispose(); }
    for (const g of Object.values(groups)) clear(g);
    for (const k of [...tags.keys()]) { tags.get(k).el.remove(); tags.delete(k); }
    measure.a = measure.b = null; sel = -1; voidMeshes = [];
    if (!d) { points = null; count = 0; return; }
    const n = d.n; posT = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { posT[i * 3] = d.pos[i * 3]; posT[i * 3 + 1] = d.pos[i * 3 + 2]; posT[i * 3 + 2] = -d.pos[i * 3 + 1]; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(posT, 3));
    g.setAttribute('aI', new THREE.BufferAttribute(d.inten, 1, true));
    g.setAttribute('aC', new THREE.BufferAttribute(d.cls, 1, false));
    g.setAttribute('aT', new THREE.BufferAttribute(d.time || new Float32Array(n), 1));
    g.setAttribute('aH', new THREE.BufferAttribute(d.hag, 1));
    g.setAttribute('aS', new THREE.BufferAttribute(d.sp, 1, false));
    g.setAttribute('aRGB', d.rgb ? new THREE.BufferAttribute(d.rgb, 3, true) : new THREE.BufferAttribute(new Uint8Array(n * 3), 3, true));
    points = new THREE.Points(g, pMat); points.frustumCulled = false; pScene.add(points);
    count = n; U.uDur.value = d.duration || 1; U.uTime.value = 1e9;
    const ext = d.extent, span = Math.max(ext[0], ext[1]);
    U.uH1.value = Math.min(9, Math.max(2.5, ext[2] * 0.62));
    controls.maxDistance = Math.max(60, span * 3.2); controls.minDistance = Math.max(0.6, span * 0.012);
    E.uFog.value = 0.22 / Math.max(30, span * 1.6);
    buildFrame(); buildFlight();
    home(false);
  }
  function buildFrame() { // the site's footprint, ticks every 10 m, its two dimensions
    clear(groups.frame); dropTags('frame');
    const b = data.bounds, x0 = b.min[0], x1 = b.max[0], y0 = b.min[1], y1 = b.max[1], z = b.min[2] - 0.05, P = [];
    const seg = (ax, ay, bx, by) => P.push(ax, z, -ay, bx, z, -by);
    seg(x0, y0, x1, y0); seg(x1, y0, x1, y1); seg(x1, y1, x0, y1); seg(x0, y1, x0, y0);
    const span = Math.max(x1 - x0, y1 - y0), tick = span > 60 ? 10 : span > 12 ? 2 : 0.5, tl = span * 0.012;
    for (let x = Math.ceil(x0 / tick) * tick; x <= x1; x += tick) { seg(x, y0, x, y0 - tl); seg(x, y1, x, y1 + tl); }
    for (let y = Math.ceil(y0 / tick) * tick; y <= y1; y += tick) { seg(x0, y, x0 - tl, y); seg(x1, y, x1 + tl, y); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    groups.frame.add(new THREE.LineSegments(g, lineMat(C.text3, 0.55)));
    const fm = (v) => (v >= 20 ? v.toFixed(0) : v.toFixed(1)) + ' m';
    tag('dim-x', 'frame', 'scan-tag-dim', V3((x0 + x1) / 2, y0 - tl * 3.2, z), fm(x1 - x0));
    tag('dim-y', 'frame', 'scan-tag-dim', V3(x1 + tl * 3.2, (y0 + y1) / 2, z), fm(y1 - y0));
    tag('north', 'frame', 'scan-tag-dim scan-tag-n', V3((x0 + x1) / 2, y1 + tl * 3.4, z), 'N');
  }

  // ---------- capture replay: flight path, scanner, fan of beams
  let flight = null;
  const FAN = 150;
  function buildFlight() {
    clear(groups.flight); dropTags('flight'); flight = null;
    if (!data.traj) return;
    const P = [], T = [];
    for (const s of data.traj) { if (!P.length) { P.push(V3(...s.a)); T.push(s.t0); } P.push(V3(...s.b)); T.push(s.t1); }
    const geo = new THREE.BufferGeometry().setFromPoints(P);
    const dim = new THREE.Line(geo, lineMat(C.glow, 0.16)), lit = new THREE.Line(geo.clone(), lineMat(C.glow, 0.85));
    const drone = new THREE.Group(), body = new THREE.MeshBasicMaterial({ color: C.glow });
    drone.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), body));
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.05, 0.07), body); arm.position.set(sx * 0.32, 0, sz * 0.32); arm.rotation.y = (sx * sz > 0 ? -1 : 1) * Math.PI / 4; const rotor = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 20), new THREE.MeshBasicMaterial({ color: C.glow, transparent: true, opacity: 0.55, side: THREE.DoubleSide })); rotor.rotation.x = -Math.PI / 2; rotor.position.set(sx * 0.6, 0.06, sz * 0.6); drone.add(arm, rotor); }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FAN * 6), 3)); fg.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(FAN * 2), 1));
    const fan = new THREE.LineSegments(fg, new THREE.ShaderMaterial({ vertexShader: FAN_VS, fragmentShader: FAN_FS, uniforms: { uColor: { value: hex(C.glow) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    fan.frustumCulled = false;
    const plumb = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat(C.glow, 0.3)); plumb.frustumCulled = false;
    groups.flight.add(dim, lit, drone, fan, plumb);
    flight = { T, lit, drone, fan, plumb, n: P.length };
    setReplay(null);
  }
  const pose = [0, 0, 0];
  let replayT = null;
  // t = seconds into the capture, or null for the finished scan
  function setReplay(t) {
    replayT = t;
    if (!data) return;
    const live = t != null && data.time;
    if (!live) { count = data.n; U.uTime.value = 1e9; U.uFlash.value = 0; }
    else { let lo = 0, hi = data.n; const tm = data.time; while (lo < hi) { const m = (lo + hi) >> 1; if (tm[m] <= t) lo = m + 1; else hi = m; } count = lo; U.uTime.value = t; U.uFlash.value = 1; }
    if (points) points.geometry.setDrawRange(0, count);
    if (!flight) return;
    const f = flight; f.drone.visible = f.fan.visible = f.plumb.visible = !!live; f.lit.visible = !!live;
    const tg = tags.get('drone'); if (tg) tg.hidden = !live;
    if (!live) return;
    let k = 0; while (k < f.n - 1 && f.T[k + 1] <= t) k++; f.lit.geometry.setDrawRange(0, Math.min(f.n, k + 2));
    poseAt(data.traj, t, pose); const p = V3(pose[0], pose[1], pose[2]);
    { const a = f.lit.geometry.attributes.position; if (k + 1 < f.n) { a.setXYZ(k + 1, p.x, p.y, p.z); a.needsUpdate = true; f.litFix = k + 1; } }
    f.drone.position.copy(p); const sc = Math.max(1.4, camera.position.distanceTo(p) * 0.012); f.drone.scale.setScalar(sc);
    const gp = V3(pose[0], pose[1], gz(pose[0], pose[1])); f.plumb.geometry.setFromPoints([p, gp]);
    const pa = f.fan.geometry.attributes.position, aa = f.fan.geometry.attributes.aA; let m = 0;
    for (let i = count - 1; i >= 0 && m < FAN; i -= 2) { const age = t - data.time[i]; if (age > 0.35) break; pa.setXYZ(m * 2, p.x, p.y, p.z); pa.setXYZ(m * 2 + 1, posT[i * 3], posT[i * 3 + 1], posT[i * 3 + 2]); const al = 0.42 * (1 - age / 0.35); aa.setX(m * 2, al * 0.9); aa.setX(m * 2 + 1, al * 0.25); m++; }
    f.fan.geometry.setDrawRange(0, m * 2); pa.needsUpdate = true; aa.needsUpdate = true;
    const pass = data.passes.find((q) => t >= q.t0 && t <= q.t1);
    tag('drone', 'flight', 'scan-tag-drone', p, 'Scanner · ' + (pose[2] - gz(pose[0], pose[1])).toFixed(pose[2] < 5 ? 1 : 0) + ' m up' + (pass ? '' : ' · in transit'));
  }

  // ---------- voids
  let voidMeshes = [], sel = -1, voidsOn = true;
  function setVoids(list) {
    clear(groups.voids); clear(groups.access); dropTags('voids'); voidMeshes = []; sel = -1;
    (list || []).forEach((v, i) => {
      const P = new Float32Array(v.mesh.pos.length); for (let q = 0; q < P.length; q += 3) { P[q] = v.mesh.pos[q]; P[q + 1] = v.mesh.pos[q + 2]; P[q + 2] = -v.mesh.pos[q + 1]; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(new THREE.BufferAttribute(v.mesh.idx, 1)); g.computeVertexNormals();
      const mk = (depthTest, a) => new THREE.ShaderMaterial({ vertexShader: VOID_VS, fragmentShader: VOID_FS, uniforms: { uColor: { value: hex(C.warn) }, uAlpha: { value: a } }, transparent: true, depthWrite: false, depthTest, side: THREE.DoubleSide });
      const solid = new THREE.Mesh(g, mk(true, 0.85)), ghost = new THREE.Mesh(g, mk(false, 0.3)); ghost.renderOrder = 5; solid.renderOrder = 6; solid.userData.i = ghost.userData.i = i;
      groups.voids.add(ghost, solid); voidMeshes.push({ solid, ghost, v });
      tag('void' + i, 'voids', 'scan-tag-void', V3(v.centre[0], v.centre[1], v.topZ + 0.5), '<b>' + v.id.replace('Void ', '') + '</b><span>' + v.volume.toFixed(1) + ' m³</span>', { button: true, onclick: () => emit('void', i) }).el.setAttribute('aria-label', v.id + ', ' + v.volume.toFixed(1) + ' cubic metres. Select.');
    });
    setVoidsVisible(voidsOn);
  }
  function setVoidsVisible(on) { voidsOn = on; groups.voids.visible = on; groups.access.visible = on; for (const [k, t] of tags) if (t.group === 'voids') t.hidden = !on; }
  function selectVoid(i) {
    sel = i; clear(groups.access);
    voidMeshes.forEach((m, q) => { m.solid.material.uniforms.uAlpha.value = q === i ? 1.25 : i < 0 ? 0.85 : 0.45; m.ghost.material.uniforms.uAlpha.value = q === i ? 0.5 : 0.22; const t = tags.get('void' + q); if (t) t.el.classList.toggle('on', q === i), (t.sel = q === i); });
    const m = voidMeshes[i]; if (!m || !m.v.access) return;
    // the way in, from open air to the middle of the pocket
    const pts = m.v.access.path.slice().reverse().map((p) => V3(p[0], p[1], p[2]));
    if (pts.length > 1) { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(C.accent, 1, { depthTest: false, transparent: true })); l.renderOrder = 9; groups.access.add(l);
      const a = pts[0], b = pts[Math.min(pts.length - 1, 2)], cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 14), new THREE.MeshBasicMaterial({ color: C.accent, depthTest: false, transparent: true })); cone.position.copy(a); cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); cone.renderOrder = 9; groups.access.add(cone); }
  }

  // ---------- leads, routes, zones, the map overlay
  function setLeads(list) {
    clear(groups.leads); dropTags('leads');
    (list || []).forEach((l, i) => {
      const z = gz(l.pos[0], l.pos[1]), col = l.confirmed ? C.person : C.warn, base = V3(l.pos[0], l.pos[1], z + 0.06), top = V3(l.pos[0], l.pos[1], z + 3.6);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 40), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false })); ring.rotation.x = -Math.PI / 2; ring.position.copy(base); ring.renderOrder = 8;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.7, l.sigma || 1), 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.13, depthTest: false, side: THREE.DoubleSide })); disc.rotation.x = -Math.PI / 2; disc.position.copy(base); disc.renderOrder = 7;
      const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([base, top]), lineMat(col, 0.8, { depthTest: false, transparent: true })); stem.renderOrder = 8;
      groups.leads.add(disc, ring, stem);
      tag('lead' + i, 'leads', 'scan-tag-lead' + (l.confirmed ? ' person' : ''), top, l.label);
    });
  }
  function setRoutes(list) {
    clear(groups.routes);
    for (const r of list || []) {
      const pts = drape(r.path, 0.3);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), r.dashed ? new THREE.LineDashedMaterial({ color: r.color || C.accent, dashSize: 1.1, gapSize: 0.8, transparent: true, opacity: 0.8, depthTest: false }) : lineMat(r.color || C.accent, 1, { depthTest: false, transparent: true }));
      if (r.dashed) line.computeLineDistances(); line.renderOrder = 8; groups.routes.add(line);
    }
  }
  function setZones(zones) {
    clear(groups.zones);
    for (const z of zones || []) { const pts = drape([[z.x0, z.y0], [z.x1, z.y0], [z.x1, z.y1], [z.x0, z.y1], [z.x0, z.y0]], 0.15, 0.5); const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: C.warn, dashSize: 0.6, gapSize: 0.45, transparent: true, opacity: 0.75 })); l.computeLineDistances(); groups.zones.add(l); }
  }
  let occMesh = null;
  function setOccOverlay(canvas2d, rect) { // rect: [x0, y0, x1, y1] in world metres
    clear(groups.occ); occMesh = null;
    if (!canvas2d) return;
    const [x0, y0, x1, y1] = rect, nx = Math.max(2, Math.round((x1 - x0) / 2)), ny = Math.max(2, Math.round((y1 - y0) / 2)), P = [], UV = [], I = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const x = x0 + ((x1 - x0) * i) / nx, y = y0 + ((y1 - y0) * j) / ny; P.push(x, gz(x, y) + 0.12, -y); UV.push(i / nx, j / ny); }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i; I.push(a, a + 1, a + nx + 2, a, a + nx + 2, a + nx + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I);
    const tex = new THREE.CanvasTexture(canvas2d); tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.colorSpace = THREE.SRGBColorSpace;
    occMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.86, depthWrite: false, depthTest: false, side: THREE.DoubleSide })); occMesh.renderOrder = 2; groups.occ.add(occMesh);
  }

  // ---------- section plane
  const section = { on: false, axis: 'z', value: 2.6, slab: 0, dragging: false };
  let secFrame = null, secFill = null;
  function sectionRange() { const b = data.bounds; return section.axis === 'z' ? [b.min[2] + 0.1, b.max[2] + 0.2] : section.axis === 'x' ? [b.min[0], b.max[0]] : [b.min[1], b.max[1]]; }
  function setSection(s) {
    Object.assign(section, s);
    if (data) { const r = sectionRange(); section.value = Math.min(r[1], Math.max(r[0], section.value)); }
    U.uSect.value = section.on ? 1 : 0; U.uSlab.value = section.slab || 0;
    clear(groups.section); secFrame = null;
    const t = tags.get('section'); if (t) t.hidden = !section.on;
    if (!section.on || !data) return;
    secFrame = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]), lineMat(C.glow, 0.9)); secFrame.frustumCulled = false;
    secFill = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]), new THREE.MeshBasicMaterial({ color: C.glow, transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false })); secFill.geometry.setIndex([0, 1, 2, 0, 2, 3]); secFill.frustumCulled = false;
    groups.section.add(secFill, secFrame);
    updateSection();
  }
  const secHandle = new THREE.Vector3(), secAxis = new THREE.Vector3();
  function updateSection() {
    if (!section.on || !data || !secFrame) return;
    const b = data.bounds, v = section.value, m = 1.5, x0 = b.min[0] - m, x1 = b.max[0] + m, y0 = b.min[1] - m, y1 = b.max[1] + m, z0 = b.min[2] - 0.3, z1 = Math.min(b.max[2], b.min[2] + 14) + 0.5;
    let c; const cam = camera.position;
    if (section.axis === 'z') { c = [V3(x0, y0, v), V3(x1, y0, v), V3(x1, y1, v), V3(x0, y1, v)]; U.uPlane.value.set(0, 1, 0, -v); secAxis.set(0, 1, 0); }
    else if (section.axis === 'x') { c = [V3(v, y0, z0), V3(v, y1, z0), V3(v, y1, z1), V3(v, y0, z1)]; const s = cam.x > v ? 1 : -1; U.uPlane.value.set(s, 0, 0, -s * v); secAxis.set(1, 0, 0); }
    else { c = [V3(x0, v, z0), V3(x1, v, z0), V3(x1, v, z1), V3(x0, v, z1)]; const s = cam.z > -v ? 1 : -1; U.uPlane.value.set(0, 0, s, s * v); secAxis.set(0, 0, -1); }
    const a = secFrame.geometry.attributes.position, f = secFill.geometry.attributes.position; c.forEach((p, i) => { a.setXYZ(i, p.x, p.y, p.z); f.setXYZ(i, p.x, p.y, p.z); }); a.needsUpdate = f.needsUpdate = true;
    if (!section.dragging) { // the handle sits on the corner of the frame nearest the camera
      let best = 0, bd = Infinity; c.forEach((p, i) => { const d = p.distanceToSquared(cam); if (d < bd) { bd = d; best = i; } }); secHandle.copy(c[best]);
    } else { if (section.axis === 'z') secHandle.y = v; else if (section.axis === 'x') secHandle.x = v; else secHandle.z = -v; }
    const name = section.axis === 'z' ? 'Cut at ' + (v - gz((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2)).toFixed(2) + ' m' : section.axis === 'x' ? 'Cut at ' + v.toFixed(1) + ' m east' : 'Cut at ' + v.toFixed(1) + ' m north';
    const t = tag('section', 'section', 'scan-tag-handle' + (section.dragging ? ' on' : ''), secHandle, '<i></i>' + name, { button: true });
    if (!t.bound) { t.bound = true; t.el.setAttribute('aria-label', 'Section plane. Drag, or use the arrow keys, to move it through the scan.');
      t.el.addEventListener('pointerdown', (e) => { e.preventDefault(); t.el.setPointerCapture(e.pointerId); section.dragging = true; controls.enabled = false; idle = false; });
      t.el.addEventListener('pointermove', (e) => { if (!section.dragging) return; const r = canvas.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera); const w = ray.ray.origin.clone().sub(secHandle), bb = ray.ray.direction.dot(secAxis), den = 1 - bb * bb; if (den < 1e-4) return; const tt = (secAxis.dot(w) - bb * ray.ray.direction.dot(w)) / den, rg = sectionRange(); section.value = Math.min(rg[1], Math.max(rg[0], section.value + tt)); emit('section', section.value); });
      const end = () => { if (!section.dragging) return; section.dragging = false; controls.enabled = tool === 'orbit' || true; };
      t.el.addEventListener('pointerup', end); t.el.addEventListener('pointercancel', end);
      t.el.addEventListener('keydown', (e) => { const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; e.preventDefault(); const rg = sectionRange(); section.value = Math.min(rg[1], Math.max(rg[0], section.value + d * (e.shiftKey ? 1 : section.axis === 'z' ? 0.1 : 0.5))); emit('section', section.value); });
    }
  }

  // ---------- picking and measuring
  const ray = new THREE.Raycaster(), M4 = new THREE.Matrix4();
  function pick(cx, cy) {
    if (!data) return -1;
    const r = canvas.getBoundingClientRect(), W = r.width, H = r.height, px = cx - r.left, py = cy - r.top;
    const m = M4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements, on = U.uOn.value, cl = data.cls, pl = U.uPlane.value, sect = section.on, slab = section.slab;
    let best = -1, bw = Infinity, near = -1, nd = 81;
    for (let i = 0; i < count; i++) {
      const x = posT[i * 3], y = posT[i * 3 + 1], z = posT[i * 3 + 2], w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 0.3) continue;
      const dx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * W - px; if (dx > 9 || dx < -9) continue;
      const dy = (-(m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5 + 0.5) * H - py; if (dy > 9 || dy < -9) continue;
      if (!on[cl[i]]) continue;
      if (sect) { const sd = pl.x * x + pl.y * y + pl.z * z + pl.w; if (sd > 0 || (slab > 0 && sd < -slab)) continue; }
      const d2 = dx * dx + dy * dy;
      if (d2 < 20 && w < bw) { bw = w; best = i; }
      if (d2 < nd) { nd = d2; near = i; }
    }
    return best >= 0 ? best : near;
  }
  const P3 = (i) => new THREE.Vector3(posT[i * 3], posT[i * 3 + 1], posT[i * 3 + 2]);
  let tool = 'orbit';
  const measure = { a: null, b: null, hover: null };
  function drawMeasure() {
    clear(groups.measure); dropTags('measure');
    const { a, b, hover } = measure;
    if (tool === 'measure' && hover && !(a && b)) tag('m-hover', 'measure', 'scan-tag-dot hover', hover, '');
    if (a) tag('m-a', 'measure', 'scan-tag-dot', a, '');
    const end = b || (a && tool === 'measure' ? hover : null);
    if (a && end) {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, end]), lineMat(C.glow, b ? 1 : 0.55, { depthTest: false, transparent: true })); l.renderOrder = 10; groups.measure.add(l);
      const d = a.distanceTo(end), rise = end.y - a.y, run = Math.hypot(end.x - a.x, end.z - a.z);
      if (b) tag('m-b', 'measure', 'scan-tag-dot', b, '');
      tag('m-l', 'measure', 'scan-tag-measure', a.clone().add(end).multiplyScalar(0.5), '<b>' + d.toFixed(2) + ' m</b><span>across ' + run.toFixed(2) + ' · ' + (rise >= 0 ? 'up ' : 'down ') + Math.abs(rise).toFixed(2) + '</span>');
      if (b) emit('measure', { d, rise, run });
    }
  }
  function setTool(t) { tool = t; canvas.style.cursor = t === 'measure' ? 'crosshair' : ''; if (t !== 'measure') measure.hover = null; drawMeasure(); }
  function clearMeasure() { measure.a = measure.b = measure.hover = null; drawMeasure(); emit('measure', null); }
  let down = null, hoverXY = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; idle = false; lastInput = performance.now(); });
  canvas.addEventListener('pointermove', (e) => { if (tool === 'measure') hoverXY = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) { down = null; return; }
    down = null;
    if (tool === 'measure') { const i = pick(e.clientX, e.clientY); if (i < 0) return; const p = P3(i); if (!measure.a || measure.b) { measure.a = p; measure.b = null; emit('measure', null); } else measure.b = p; drawMeasure(); return; }
    if (voidsOn && voidMeshes.length) { const r = canvas.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera); const hit = ray.intersectObjects(voidMeshes.map((m) => m.ghost), false)[0]; if (hit) emit('void', hit.object.userData.i); }
  });
  canvas.addEventListener('wheel', () => { idle = false; lastInput = performance.now(); }, { passive: true });
  canvas.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tool === 'measure') clearMeasure(); idle = false; lastInput = performance.now(); });

  // ---------- camera moves
  let fly = null, idle = true, lastInput = 0;
  const sph = (target, dist, az, el) => { const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180; return new THREE.Vector3(target.x + dist * Math.sin(a) * Math.cos(e), target.y + dist * Math.sin(e), target.z - dist * Math.cos(a) * Math.cos(e)); };
  function flyTo({ target, dist, az, el }, animate = true) {
    const T = V3(target[0], target[1], target[2] ?? 0), to = sph(T, dist, az, el);
    if (!animate || reduced) { controls.target.copy(T); camera.position.copy(to); controls.update(); fly = null; return; }
    const o0 = camera.position.clone().sub(controls.target), d0 = o0.length(), el0 = Math.asin(Math.min(1, Math.max(-1, o0.y / d0))) * 180 / Math.PI; let az0 = Math.atan2(o0.x, -o0.z) * 180 / Math.PI;
    let daz = ((az - az0 + 540) % 360) - 180;
    fly = { t0: performance.now(), ms: 1100, T0: controls.target.clone(), T1: T, d0, d1: dist, az0, daz, el0, el1: el };
  }
  function home(animate = true) { if (!data) return; const b = data.bounds, e = data.extent, span = Math.max(e[0], e[1] * 1.25); flyTo({ target: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2 - e[1] * 0.1, b.min[2] + 1], dist: span * 1.5 + 8, az: 205, el: 38 }, animate); }
  function topView() { if (!data) return; const b = data.bounds, e = data.extent, a = host.clientWidth / Math.max(1, host.clientHeight), fit = Math.max(e[1], e[0] / a) / (2 * Math.tan((camera.fov * Math.PI) / 360)); flyTo({ target: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]], dist: fit * 1.12 + 4, az: 180, el: 89.4 }); }
  controls.addEventListener('start', () => { fly = null; idle = false; lastInput = performance.now(); });

  // ---------- frame loop
  let raf = 0, running = false, lastT = 0, fps = 60, acc = 0, frames = 0;
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const dw = renderer.domElement.width, dh = renderer.domElement.height;
    if (rt) { rt.depthTexture.dispose(); rt.dispose(); }
    rt = new THREE.WebGLRenderTarget(dw, dh, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, depthTexture: new THREE.DepthTexture(dw, dh, THREE.UnsignedIntType) });
    E.tColor.value = rt.texture; E.tDepth.value = rt.depthTexture; E.uPx.value.set(1 / dw, 1 / dh); E.uRadius.value = 1.1 * renderer.getPixelRatio() + 0.3;
    U.uScale.value = dh / (2 * Math.tan((camera.fov * Math.PI) / 360));
    U.uMinPx.value = 1.25 * renderer.getPixelRatio(); U.uMaxPx.value = 20 * renderer.getPixelRatio();
  }
  const ro = new ResizeObserver(() => { resize(); if (!running) renderOnce(); }); ro.observe(host);
  function renderOnce() {
    if (!rt) return;
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(pScene, camera);
    renderer.setRenderTarget(null); renderer.clear(); renderer.render(qScene, qCam); renderer.render(oScene, camera);
    placeTags();
  }
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - lastT) / 1000 || 0.016); lastT = now;
    acc += dt; frames++; if (acc >= 0.5) { fps = frames / acc; acc = 0; frames = 0; emit('fps', fps); }
    if (fly) { const u = Math.min(1, (now - fly.t0) / fly.ms), k = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; controls.target.lerpVectors(fly.T0, fly.T1, k); camera.position.copy(sph(controls.target, fly.d0 + (fly.d1 - fly.d0) * k, fly.az0 + fly.daz * k, fly.el0 + (fly.el1 - fly.el0) * k)); if (u >= 1) fly = null; }
    if (!idle && !reduced && now - lastInput > 14000 && !fly && tool === 'orbit' && !section.dragging) idle = true;
    controls.autoRotate = idle && !reduced && !fly && autoOrbit;
    controls.update(dt);
    emit('frame', dt);
    if (section.on) updateSection();
    if (tool === 'measure' && hoverXY) { const i = pick(hoverXY[0], hoverXY[1]); hoverXY = null; measure.hover = i >= 0 ? P3(i) : null; drawMeasure(); }
    if (replayT != null && flight) { const p = flight.drone.position; flight.drone.scale.setScalar(Math.max(1.4, camera.position.distanceTo(p) * 0.012)); }
    renderOnce();
    // scale bar: metres per pixel where the camera is looking
    const dist = camera.position.distanceTo(controls.target), mpp = (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, host.clientHeight);
    const o = camera.position.clone().sub(controls.target); emit('view', { mpp, az: Math.atan2(o.x, -o.z), dist });
  }
  let autoOrbit = true;
  const api = {
    canvas, on(t, f) { (listeners[t] = listeners[t] || []).push(f); return api; },
    setCloud, setReplay, setVoids, selectVoid, setVoidsVisible, setLeads, setRoutes, setZones, setOccOverlay, setSection, setTool, clearMeasure, flyTo, home, topView, pick,
    get section() { return section; }, get tool() { return tool; }, get data() { return data; }, sectionRange,
    setMode(m) { U.uMode.value = ['height', 'intensity', 'class', 'time', 'rgb'].indexOf(m); },
    setClassVisible(i, on) { U.uOn.value[i] = on ? 1 : 0; },
    setClassColors(list) { list.forEach((c, i) => U.uCls.value[i].set(c)); },
    setPointSize(v) { U.uSize.value = v; }, get pointSize() { return U.uSize.value; },
    setShading(v) { E.uStrength.value = v; }, setAutoOrbit(v) { autoOrbit = v; }, setHeightRange(h1) { U.uH1.value = h1; }, get heightMax() { return U.uH1.value; },
    setLayer(name, on) { if (groups[name]) groups[name].visible = on; for (const t of tags.values()) if (t.group === name) t.hidden = !on; },
    start() { if (running) return; running = true; lastT = performance.now(); lastInput = lastT; resize(); raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    renderOnce, resize,
    screenshot() { renderOnce(); return canvas; },
    focusVoid(i) { const m = voidMeshes[i]; if (!m) return; const v = m.v, size = Math.max(v.length, v.width, 2); let az = 200; if (v.access && v.access.from !== 'above') az = (Math.atan2(v.access.pos[0] - v.centre[0], v.access.pos[1] - v.centre[1]) * 180) / Math.PI; flyTo({ target: [v.centre[0], v.centre[1], v.centre[2]], dist: size * 2.1 + 9, az, el: 30 }); },
    dispose() { api.stop(); ro.disconnect(); controls.dispose(); if (points) points.geometry.dispose(); pMat.dispose(); if (rt) { rt.depthTexture.dispose(); rt.dispose(); } renderer.dispose(); canvas.remove(); labels.remove(); },
  };
  return api;
}
