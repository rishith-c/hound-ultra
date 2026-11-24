// The living probability map: the site as a 3-D relief where height and colour are the chance that a person is
// there. Drawn with three.js: the belief is a data texture, the surface is displaced and shaded on the GPU.
// One WebGL canvas, shared by exhibits 1 and 2. World [x, y] in metres maps to three.js (x, height, -y).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { tok, hexRgb, heatStops, makeLoop } from './common.js';

const col = (name) => new THREE.Color(tok(name));
function rampTexture(stops) {
  const n = 256, data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(x)), f = x - k; for (let c = 0; c < 3; c++) data[i * 4 + c] = stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f; data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
}
const fieldTexture = (w, h) => { const t = new THREE.DataTexture(new Float32Array(w * h), w, h, THREE.RedFormat, THREE.FloatType); t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };

const VERT = /* glsl */ `
uniform sampler2D uA, uB, uG; uniform vec2 uSize, uGSize; uniform float uT, uMode, uHmax, uRes, uGRes;
varying float vVal, vBel, vGain; varying vec3 vN; varying vec2 vXY; varying float vH;
float samp(sampler2D t, vec2 sz, vec2 c) {
  vec2 p = c - 0.5, i = floor(p), f = p - i;
  ivec2 i0 = ivec2(clamp(i, vec2(0.0), sz - 1.0)), i1 = ivec2(clamp(i + 1.0, vec2(0.0), sz - 1.0));
  float a = texelFetch(t, i0, 0).r, b = texelFetch(t, ivec2(i1.x, i0.y), 0).r, c2 = texelFetch(t, ivec2(i0.x, i1.y), 0).r, d = texelFetch(t, i1, 0).r;
  return mix(mix(a, b, f.x), mix(c2, d, f.x), f.y);
}
float bel(vec2 xy) { vec2 c = xy / uRes; return mix(samp(uA, uSize, c), samp(uB, uSize, c), uT); }
float gain(vec2 xy) { return samp(uG, uGSize, xy / uGRes); }
float val(vec2 xy) { return mix(bel(xy), gain(xy), uMode); }
float hgt(float v) { return uHmax * pow(v, 1.7); }
void main() {
  vec2 xy = vec2(position.x, -position.z);
  vBel = bel(xy); vGain = gain(xy); vVal = mix(vBel, vGain, uMode);
  float e = 0.5, h = hgt(vVal);
  float hx = hgt(val(xy + vec2(e, 0.0))) - hgt(val(xy - vec2(e, 0.0))), hy = hgt(val(xy + vec2(0.0, e))) - hgt(val(xy - vec2(0.0, e)));
  vN = normalize(vec3(-hx, 2.0 * e, hy)); vXY = xy; vH = h;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, h + 0.03, position.z, 1.0);
}`;
const FRAG = /* glsl */ `
uniform sampler2D uRamp, uRampG, uPod; uniform vec2 uSize; uniform float uMode, uRes, uPodOn, uLevels, uTime; uniform vec3 uPodCol, uLine;
varying float vVal, vBel, vGain; varying vec3 vN; varying vec2 vXY; varying float vH;
void main() {
  vec3 c = mix(texture2D(uRamp, vec2(vBel, 0.5)).rgb, texture2D(uRampG, vec2(vGain, 0.5)).rgb, uMode);
  vec3 n = normalize(vN);
  float diff = clamp(dot(n, normalize(vec3(-0.45, 0.8, 0.4))), 0.0, 1.0), rim = pow(1.0 - clamp(n.y, 0.0, 1.0), 2.0);
  c *= 0.62 + 0.55 * diff; c += rim * 0.10;
  // iso-lines: one per decade of density (belief) or per tenth of the best gain
  float lv = vVal * uLevels, w = fwidth(lv);
  float line = 1.0 - smoothstep(0.0, 1.4, abs(fract(lv - 0.5) - 0.5) / max(w, 1e-5));
  float lv2 = lv * 2.0, line2 = (1.0 - smoothstep(0.0, 1.2, abs(fract(lv2 - 0.5) - 0.5) / max(fwidth(lv2), 1e-5))) * 0.35;
  c = mix(c, uLine, max(line * 0.55, line2 * 0.4) * smoothstep(0.04, 0.2, vVal));
  // a 1 m survey grid draped on the relief
  vec2 g = abs(fract(vXY - 0.5) - 0.5) / fwidth(vXY); float grid = 1.0 - min(min(g.x, g.y), 1.0);
  c += grid * 0.035;
  float a = smoothstep(0.015, 0.14, vVal) * 0.95;
  // sensor reach of the probed stop: each cell tinted by its probability of detection
  if (uPodOn > 0.5) {
    ivec2 cell = ivec2(clamp(floor(vXY / uRes), vec2(0.0), uSize - 1.0));
    float pod = texelFetch(uPod, cell, 0).r;
    float hatch = step(0.5, fract((vXY.x - vXY.y) * 1.0 + uTime * 0.25));
    float k = pod * (0.30 + 0.30 * hatch);
    c = mix(c, uPodCol, clamp(k * 1.2, 0.0, 0.8)); a = max(a, clamp(pod * (0.22 + 0.34 * hatch), 0.0, 0.7));
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;
const GROUND_FRAG = /* glsl */ `
uniform vec3 uBase, uGrid, uFar; uniform vec2 uSite; varying vec2 vXY;
void main() {
  vec2 g1 = abs(fract(vXY - 0.5) - 0.5) / fwidth(vXY), g10 = abs(fract(vXY / 10.0 - 0.5) - 0.5) / fwidth(vXY / 10.0);
  float l1 = 1.0 - min(min(g1.x, g1.y), 1.0), l10 = 1.0 - min(min(g10.x, g10.y), 1.0);
  vec2 d = max(vec2(0.0), max(-vXY, vXY - uSite)); float out_ = length(d);
  float inside = 1.0 - smoothstep(0.0, 0.5, out_);
  vec3 c = mix(uFar, uBase, inside);
  c = mix(c, uGrid, (l1 * 0.10 + l10 * 0.34) * (0.25 + 0.75 * inside));
  float fade = 1.0 - smoothstep(18.0, 60.0, out_);
  gl_FragColor = vec4(mix(uFar, c, fade), 1.0);
  #include <colorspace_fragment>
}`;

export function createMap3D(host, ctx) {
  const { h } = ctx.kit, world = ctx.world, SITE = world.SITE;
  const canvas = h('canvas.gl', { tabindex: '0', role: 'img', 'aria-label': 'Three-dimensional probability map of the site. Drag to orbit, scroll to zoom, click the floor to test a listening stop there.' });
  const labelLayer = h('div.strategy-labels', { 'aria-hidden': 'true' });
  host.append(canvas, labelLayer);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { canvas.remove(); labelLayer.remove(); throw new Error('This browser could not start WebGL, which the 3-D map needs.'); }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 900);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.09; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 14; controls.maxDistance = 260; controls.zoomSpeed = 0.8; controls.rotateSpeed = 0.6; controls.screenSpacePanning = false;
  const VIEWS = {
    building: { pos: [45, 39, 4], target: [64.5, 1.5, -45] },
    site: { pos: [22, 72, 26], target: [66, 0, -48] },
    top: { pos: [64, 92, -43.9], target: [64, 0, -44] },
  };
  let userMoved = false, camAnim = null, baseAz = 0;
  controls.addEventListener('start', () => { userMoved = true; camAnim = null; });
  const v3 = (p, y = 0) => new THREE.Vector3(p[0], y, -p[1]);

  // ---- ground ----
  const groundMat = new THREE.ShaderMaterial({ uniforms: { uBase: { value: col('--bg-2') }, uGrid: { value: col('--line-3') }, uFar: { value: col('--bg-0') }, uSite: { value: new THREE.Vector2(SITE.w, SITE.h) } },
    vertexShader: 'varying vec2 vXY; void main() { vXY = vec2(position.x, -position.z); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: GROUND_FRAG });
  const gg = new THREE.PlaneGeometry(SITE.w + 160, SITE.h + 160); gg.rotateX(-Math.PI / 2); gg.translate(SITE.w / 2, 0, -SITE.h / 2);
  scene.add(new THREE.Mesh(gg, groundMat));

  // ---- the relief ----
  const RES = 0.5, GW = Math.round(SITE.w / RES), GH = Math.round(SITE.h / RES), GRES = 1, QW = SITE.w / GRES, QH = SITE.h / GRES;
  const texA = fieldTexture(GW, GH), texB = fieldTexture(GW, GH), texG = fieldTexture(QW, QH), texPod = fieldTexture(GW, GH);
  let rampHeat = rampTexture(heatStops()), rampGain = rampTexture([hexRgb(tok('--bg-2')), hexRgb(tok('--heat-1')), hexRgb(tok('--accent')), hexRgb(tok('--accent-2')), hexRgb(tok('--text'))]);
  const uniforms = { uA: { value: texA }, uB: { value: texB }, uG: { value: texG }, uPod: { value: texPod }, uRamp: { value: rampHeat }, uRampG: { value: rampGain }, uSize: { value: new THREE.Vector2(GW, GH) }, uGSize: { value: new THREE.Vector2(QW, QH) },
    uT: { value: 1 }, uMode: { value: 0 }, uHmax: { value: 11 }, uRes: { value: RES }, uGRes: { value: GRES }, uPodOn: { value: 0 }, uLevels: { value: 4 }, uTime: { value: 0 }, uPodCol: { value: col('--accent-2') }, uLine: { value: col('--text') } };
  const step = 0.25, nx = Math.round(SITE.w / step), ny = Math.round(SITE.h / step);
  const tg = new THREE.PlaneGeometry(SITE.w, SITE.h, nx, ny); tg.rotateX(-Math.PI / 2); tg.translate(SITE.w / 2, 0, -SITE.h / 2);
  const terrain = new THREE.Mesh(tg, new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: true, side: THREE.DoubleSide }));
  terrain.frustumCulled = false; terrain.renderOrder = 2; scene.add(terrain);

  // ---- the static world: walls of building B, other buildings, rubble, hazards ----
  const stat = new THREE.Group(); scene.add(stat);
  function buildStatic() {
    stat.clear();
    const WH = 1.5, wallMat = new THREE.MeshBasicMaterial({ color: col('--text-2'), transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide });
    const edge = [], base = [], gone = [];
    for (const w of world.WALLS) {
      const a = v3(w.a), b = v3(w.b);
      if (w.state === 'collapsed') { gone.push(a.x, 0.04, a.z, b.x, 0.04, b.z); continue; }
      const len = a.distanceTo(b), m = new THREE.Mesh(new THREE.BoxGeometry(len, WH, w.mat === 'concrete' ? 0.3 : 0.14), wallMat);
      m.position.set((a.x + b.x) / 2, WH / 2, (a.z + b.z) / 2); m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x); m.renderOrder = 3; stat.add(m);
      edge.push(a.x, WH, a.z, b.x, WH, b.z, a.x, 0, a.z, a.x, WH, a.z, b.x, 0, b.z, b.x, WH, b.z); base.push(a.x, 0.03, a.z, b.x, 0.03, b.z);
    }
    const seg = (arr, color, opacity, dashed) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); const l = new THREE.LineSegments(g, dashed ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.6, gapSize: 0.5 }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity })); if (dashed) l.computeLineDistances(); l.renderOrder = 4; stat.add(l); return l; };
    seg(edge, col('--text'), 0.5); seg(base, col('--text-2'), 0.55); if (gone.length) seg(gone, col('--danger'), 0.7, true);
    const loop = (poly, y) => { const a = []; poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; a.push(p[0], y, -p[1], q[0], y, -q[1]); }); return a; };
    const fill = (poly, y, color, opacity) => { const s = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1]))), g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })); m.position.y = y; m.renderOrder = 1; stat.add(m); };
    for (const o of world.OBSTACLES) {
      if (o.kind === 'building') { const s = new THREE.Shape(o.poly.map((p) => new THREE.Vector2(p[0], p[1]))), g = new THREE.ExtrudeGeometry(s, { depth: 0.8, bevelEnabled: false }); g.rotateX(-Math.PI / 2); stat.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col('--bg-3') }))); seg([...loop(o.poly, 0.82), ...loop(o.poly, 0.02)], col('--line-3'), 0.9); }
      else { fill(o.poly, 0.02, col('--bg-4'), o.kind === 'furniture' ? 0.9 : 0.75); seg(loop(o.poly, 0.05), col('--text-3'), 0.8); }
    }
    for (const hz of world.HAZARDS) seg(loop(hz.poly, 0.06), col('--danger'), 0.5, true);
    seg(loop([[0, 0], [SITE.w, 0], [SITE.w, SITE.h], [0, SITE.h]], 0.02), col('--line-3'), 0.9);
  }
  buildStatic();

  // ---- markers (rebuilt whenever the mission changes) ----
  const marks = new THREE.Group(); scene.add(marks);
  let labels = [];
  const addLabel = (cls, pos, y, html, lead = 14) => { const el = h('div.strategy-lab.' + cls, { html, style: { '--lead': lead + 'px' } }); labelLayer.append(el); labels.push({ el, p: v3(pos, y) }); return el; };
  const line = (pts, color, opacity = 1, dashed = false) => { const g = new THREE.BufferGeometry().setFromPoints(pts); const l = new THREE.Line(g, dashed ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.5, gapSize: 0.4 }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity })); if (dashed) l.computeLineDistances(); l.renderOrder = 5; marks.add(l); return l; };
  const ring = (pos, r, color, opacity = 1, y = 0.07, w = 0.09) => { const g = new THREE.RingGeometry(r - w, r + w, 48); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide })); m.position.set(pos[0], y, -pos[1]); m.renderOrder = 5; marks.add(m); return m; };
  const gem = (pos, y, color, s = 0.34) => { const m = new THREE.Mesh(new THREE.OctahedronGeometry(s), new THREE.MeshBasicMaterial({ color })); m.position.set(pos[0], y, -pos[1]); m.renderOrder = 6; marks.add(m); return m; };
  let pulse = [];
  function setMarkers(M) {
    marks.clear(); labelLayer.replaceChildren(); labels = []; pulse = [];
    for (const r of M.rooms || []) addLabel('room', r.pos, 0.1, r.html, 0);
    if (M.trail && M.trail.length > 1) line(M.trail.map((p) => v3(p, 0.09)), col('--text-2'), 0.55);
    for (const s of M.looks || []) { ring(s.pos, 0.55, col('--text'), 0.9); ring(s.pos, 0.22, col('--text'), 0.9, 0.07, 0.22); }
    for (const s of M.stops || []) { line([v3(s.pos, 0.05), v3(s.pos, 4.2)], col('--text-2'), 0.8); gem(s.pos, 4.2, col('--text'), 0.26); addLabel('stop', s.pos, 4.6, s.html, 6); if (!s.done) ring(s.pos, 0.55, col('--text-2'), 0.7); }
    for (const s of M.best || []) { line([v3(s.pos, 0.05), v3(s.pos, s.h || 6)], col('--accent'), 0.95); gem(s.pos, s.h || 6, col('--accent'), 0.4); ring(s.pos, 0.7, col('--accent'), 0.95); addLabel(s.first ? 'best' : 'stop', s.pos, (s.h || 6) + 0.5, s.html, 6); }
    if (M.path && M.path.length > 1) line(M.path.map((p) => v3(p, 0.12)), col('--accent'), 0.9, true);
    for (const d of M.leads || []) { const c = col(d.person ? '--person' : '--warn'); line([v3(d.pos, 0.05), v3(d.pos, d.h + 2.2)], c, 0.9); pulse.push(ring(d.pos, Math.max(0.5, d.sigma || 0.6), c, 0.8)); addLabel(d.person ? 'person' : 'lead', d.pos, d.h + 2.5, d.html, 6); }
    for (const t of M.truth || []) { ring(t.pos, 1.0, col('--sim'), 0.95, 0.1, 0.06); line([v3(t.pos, 0.05), v3(t.pos, 8.5)], col('--sim'), 0.8, true); addLabel('truth', t.pos, 8.8, t.html, 6); }
    if (M.rover) { const g = new THREE.ConeGeometry(0.55, 1.5, 4); g.rotateX(Math.PI / 2); g.rotateY(Math.PI / 2); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col('--text') })); m.position.set(M.rover.pos[0], 0.5, -M.rover.pos[1]); m.rotation.y = M.rover.heading; m.scale.y = 0.5; m.renderOrder = 6; marks.add(m); addLabel('stop', M.rover.pos, 1.4, 'HOUND-01', 8); }
    if (M.probe) { line([v3(M.probe.pos, 0.05), v3(M.probe.pos, 5)], col('--accent-2'), 1); ring(M.probe.pos, 0.5, col('--accent-2'), 1); ring(M.probe.pos, M.probe.range, col('--accent-2'), 0.35, 0.06, 0.04); addLabel('best', M.probe.pos, 5.4, M.probe.html, 6); }
  }

  // ---- data ----
  let tween = 1;
  function setBelief(values, animate = true) { // values: Float32Array GW*GH, already mapped to 0..1
    texA.image.data.set(texB.image.data); texA.needsUpdate = true; texB.image.data.set(values); texB.needsUpdate = true;
    tween = animate && !ctx.kit.reducedMotion() ? 0 : 1; uniforms.uT.value = tween;
  }
  function setGain(values) { if (values) { texG.image.data.set(values); } else texG.image.data.fill(0); texG.needsUpdate = true; }
  let modeTarget = 0;
  function setMode(m) { modeTarget = m === 'gain' ? 1 : 0; uniforms.uLevels.value = m === 'gain' ? 10 : 4; if (ctx.kit.reducedMotion()) uniforms.uMode.value = modeTarget; }
  function setPod(values) { if (values) { texPod.image.data.set(values); texPod.needsUpdate = true; uniforms.uPodOn.value = 1; } else uniforms.uPodOn.value = 0; }

  // ---- camera ----
  function setView(name, instant = false) {
    const v = VIEWS[name] || VIEWS.building;
    if (instant || ctx.kit.reducedMotion()) { camera.position.set(...v.pos); controls.target.set(...v.target); controls.update(); camAnim = null; }
    else camAnim = { t: 0, p0: camera.position.clone(), q0: controls.target.clone(), p1: new THREE.Vector3(...v.pos), q1: new THREE.Vector3(...v.target) };
    userMoved = name !== 'building';
  }
  setView('building', true);

  // ---- picking ----
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  let onPick = null, onHover = null, down = null;
  const toWorld = (ev) => { const r = canvas.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera); return ray.ray.intersectPlane(plane, hit) ? [hit.x, -hit.z] : null; };
  canvas.addEventListener('pointerdown', (ev) => { down = [ev.clientX, ev.clientY]; });
  canvas.addEventListener('pointerup', (ev) => { if (down && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) < 5) { const p = toWorld(ev); if (p && onPick) onPick(p); } down = null; });
  canvas.addEventListener('pointermove', (ev) => { if (onHover && !down) onHover(toWorld(ev)); });
  canvas.addEventListener('pointerleave', () => { if (onHover) onHover(null); });
  canvas.addEventListener('keydown', (ev) => {
    const k = ev.key, st = 0.08;
    if (k === 'ArrowLeft' || k === 'ArrowRight') { const off = camera.position.clone().sub(controls.target); off.applyAxisAngle(new THREE.Vector3(0, 1, 0), k === 'ArrowLeft' ? st : -st); camera.position.copy(controls.target).add(off); }
    else if (k === '+' || k === '=' || k === '-') { const off = camera.position.clone().sub(controls.target).multiplyScalar(k === '-' ? 1.12 : 0.89); camera.position.copy(controls.target).add(off); }
    else return;
    ev.preventDefault(); userMoved = true;
  });

  // ---- frame ----
  const proj = new THREE.Vector3();
  let W = 0, H = 0;
  function resize() { const r = host.getBoundingClientRect(); if (!r.width || !r.height) return; W = r.width; H = r.height; renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(host);
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function frame(dt, time) {
    if (!W) resize(); if (!W) return;
    if (tween < 1) { tween = Math.min(1, tween + dt / 0.7); uniforms.uT.value = ease(tween); }
    const m = uniforms.uMode.value; if (m !== modeTarget) uniforms.uMode.value = Math.abs(modeTarget - m) < 0.01 ? modeTarget : m + (modeTarget - m) * Math.min(1, dt * 7);
    uniforms.uTime.value = ctx.kit.reducedMotion() ? 0 : time;
    if (camAnim) { camAnim.t = Math.min(1, camAnim.t + dt / 0.8); const e = ease(camAnim.t); camera.position.lerpVectors(camAnim.p0, camAnim.p1, e); controls.target.lerpVectors(camAnim.q0, camAnim.q1, e); if (camAnim.t >= 1) camAnim = null; }
    else if (!userMoved && !ctx.kit.reducedMotion()) { // a slow drift until the visitor takes the camera
      const az = Math.sin(time * 0.11) * 0.16, off = new THREE.Vector3(...VIEWS.building.pos).sub(new THREE.Vector3(...VIEWS.building.target)); off.applyAxisAngle(new THREE.Vector3(0, 1, 0), az - baseAz * 0); camera.position.copy(new THREE.Vector3(...VIEWS.building.target)).add(off); controls.target.set(...VIEWS.building.target);
    }
    controls.update();
    if (!ctx.kit.reducedMotion()) for (const p of pulse) { const s = 1 + 0.12 * Math.sin(time * 3); p.scale.set(s, 1, s); }
    renderer.render(scene, camera);
    for (const l of labels) { proj.copy(l.p).project(camera); const vis = proj.z < 1 && proj.x > -1.1 && proj.x < 1.1 && proj.y > -1.1 && proj.y < 1.1; l.el.classList.toggle('is-hidden', !vis); if (vis) l.el.style.transform = 'translate(' + ((proj.x * 0.5 + 0.5) * W).toFixed(1) + 'px,' + ((-proj.y * 0.5 + 0.5) * H).toFixed(1) + 'px) translate(-50%, calc(-100% - var(--lead, 14px)))'; }
  }
  const loop = makeLoop(frame);
  return {
    GW, GH, RES, QW, QH, GRES, setBelief, setGain, setMode, setPod, setMarkers, setView,
    onPick(fn) { onPick = fn; }, onHover(fn) { onHover = fn; },
    start() { resize(); loop.start(); }, stop() { loop.stop(); },
    restyle() { rampHeat.dispose(); rampGain.dispose(); uniforms.uRamp.value = rampHeat = rampTexture(heatStops()); uniforms.uRampG.value = rampGain = rampTexture([hexRgb(tok('--bg-2')), hexRgb(tok('--heat-1')), hexRgb(tok('--accent')), hexRgb(tok('--accent-2')), hexRgb(tok('--text'))]); uniforms.uPodCol.value = col('--accent-2'); uniforms.uLine.value = col('--text'); groundMat.uniforms.uBase.value = col('--bg-2'); groundMat.uniforms.uGrid.value = col('--line-3'); groundMat.uniforms.uFar.value = col('--bg-0'); buildStatic(); },
    renderOnce() { frame(0.016, performance.now() / 1000); },
    dispose() { loop.stop(); ro.disconnect(); controls.dispose(); renderer.dispose(); },
  };
}
