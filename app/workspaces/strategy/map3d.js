// The probability landscape: the site at dusk, and over it a lit relief whose height is the chance that a person is
// there. One WebGL canvas, shared by the demo race and exhibits 1 and 2. World [x, y] metres -> three (x, height, -y).
//
// Each frame a small "composite" pass blends the old and new belief into one height texture (so a look can press the
// map down as a wave leaving the rover), and the relief mesh is displaced and shaded from that texture: slope normals,
// self-shadow marched towards the key light, contact darkening, contour lines at real values.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { tok, makeLoop } from './common.js';
import { mulberry32, pointInPoly } from '../../core/geometry.js';

const col = (name) => new THREE.Color(tok(name));
// Physical surface colours of the dusk set (linear-ish albedos, not interface colours).
const MAT = { mud: 0x3a342d, mudWet: 0x1d1b19, concrete: 0x7d7a74, slab: 0x55534f, roof: 0x3d3e40, glass: 0x10161c, steel: 0x8b9299, rubble: 0x6a635a, sky: 0x0b0f14, haze: 0x141a20 };
const KEY = new THREE.Vector3(-0.62, 0.5, 0.42).normalize();

const NOISE = /* glsl */ `
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; } return s; }
`;
// Give a standard material real surface detail in world space: tone variation, roughness variation, a bump.
function weather(mat, { scale = 1, tone = 0.4, bump = 0.5, wet = null, joints = 0 }) {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uWet = { value: new THREE.Color(wet ?? 0) };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvec4 wpp = vec4(transformed, 1.0);\nvec3 wnn = objectNormal;\n#ifdef USE_INSTANCING\nwpp = instanceMatrix * wpp; wnn = mat3(instanceMatrix) * wnn;\n#endif\nvWp = (modelMatrix * wpp).xyz; vWn = mat3(modelMatrix) * wnn;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn; uniform vec3 uWet;\n' + NOISE +
      'vec2 wuv() { vec3 a = abs(normalize(vWn)); return a.y > 0.6 ? vWp.xz : a.x > a.z ? vWp.zy : vWp.xy; }\nfloat wh(vec2 p) { return fbm(p) * 0.75 + vn(p * 9.0) * 0.18; }')
      .replace('#include <color_fragment>', '#include <color_fragment>\nvec2 wp2 = wuv() * ' + scale.toFixed(2) + '; float n0 = fbm(wp2), n1 = fbm(wp2 * 0.13 + 7.0);\ndiffuseColor.rgb *= 1.0 + ' + tone.toFixed(2) + ' * (n0 - 0.48) * 2.0;\nfloat streak = fbm(vec2(wuv().x * 2.4, wuv().y * 0.22)); diffuseColor.rgb *= 0.86 + 0.28 * streak;' +
        (wet != null ? 'float wetK = smoothstep(0.50, 0.64, n1); diffuseColor.rgb = mix(diffuseColor.rgb, uWet, wetK * 0.85);' : '') +
        (joints ? 'vec2 jg = abs(fract(vWp.xz / ' + joints.toFixed(2) + ' - 0.5) - 0.5) * ' + joints.toFixed(2) + '; float jt = 1.0 - smoothstep(0.015, 0.05, min(jg.x, jg.y)); diffuseColor.rgb *= 1.0 - 0.45 * jt;' : ''))
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (n0 - 0.5) * 0.25' + (wet != null ? ' - wetK * 0.62' : '') + ', 0.08, 1.0);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n{ float e = 0.02; vec2 q = wuv() * ' + scale.toFixed(2) + '; float b0 = wh(q), bx = wh(q + vec2(e, 0.0)) - b0, by = wh(q + vec2(0.0, e)) - b0; float k = ' + bump.toFixed(2) + (wet != null ? ' * (1.0 - wetK * 0.95)' : '') + '; normal = normalize(normal - k * (bx * dFdx(vWp.x) + by * dFdy(vWp.z)) * 0.0 - k * vec3(bx, by, 0.0) * 6.0); }');
  };
  return mat;
}

const COMP_FRAG = /* glsl */ `
uniform sampler2D uA, uB; uniform vec2 uSize, uC; uniform float uT, uWave, uFront, uMix;
varying vec2 vUv;
vec2 bspline(sampler2D t, vec2 uv) { // cubic B-spline from four bilinear taps: C2-smooth between the 0.5 m cells
  vec2 p = uv * uSize - 0.5, i = floor(p), f = p - i, g = 1.0 - f;
  vec2 w0 = g * g * g / 6.0, w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0, w2 = (4.0 - 6.0 * g * g + 3.0 * g * g * g) / 6.0, w3 = f * f * f / 6.0;
  vec2 s0 = w0 + w1, s1 = w2 + w3, o0 = (i - 0.5 + w1 / s0 + 0.0) , o1 = (i + 1.5 + w3 / s1);
  vec2 a = (o0 + 0.5) / uSize, b = (o1 + 0.5) / uSize;
  return (texture2D(t, vec2(a.x, a.y)).rg * s0.x + texture2D(t, vec2(b.x, a.y)).rg * s1.x) * s0.y + (texture2D(t, vec2(a.x, b.y)).rg * s0.x + texture2D(t, vec2(b.x, b.y)).rg * s1.x) * s1.y;
}
void main() {
  vec2 xy = vUv * vec2(120.0, 90.0); float d = distance(xy, uC);
  float k = mix(uT, smoothstep(0.0, 1.0, (uWave - d) / 2.6 + 0.5), uFront);
  vec2 a = bspline(uA, vUv), b = bspline(uB, vUv), v = mix(a, b, k);
  float ring = uFront * exp(-pow((d - uWave) / 0.55, 2.0)) * smoothstep(9.0, 3.0, uWave) ;
  gl_FragColor = vec4(v.r + ring * 0.12, v.g, ring, abs(b.r - a.r) * k * (1.0 - uT));
}`;
const VERT = /* glsl */ `
uniform sampler2D uH; varying vec2 vUvS; varying vec3 vW; varying float vFogD;
void main() { vUvS = vec2(position.x / 120.0, -position.z / 90.0); float h = texture2D(uH, vUvS).r; vec3 p = vec3(position.x, h * 1.0 - 0.05, position.z); vW = p; vec4 mv = modelViewMatrix * vec4(p, 1.0); vFogD = -mv.z; gl_Position = projectionMatrix * mv; }`;
const FRAG = /* glsl */ `
uniform sampler2D uH, uPod; uniform vec3 uKey, uKeyCol, uSkyCol, uLow, uMid, uHot, uTip, uPodCol, uFog, uGainLo, uGainHi, uFrontCol; uniform float uPodOn, uTime, uGain, uStep, uDim, uCut;
varying vec2 vUvS; varying vec3 vW; varying float vFogD;
float H(vec2 uv) { return texture2D(uH, uv).r; }
void main() {
  vec4 s = texture2D(uH, vUvS); float h = s.r, heat = s.g;
  float alpha = smoothstep(uCut, uCut + 0.10, h);
  vec2 xy = vUvS * vec2(120.0, 90.0);
  float podv = 0.0; if (uPodOn > 0.5) podv = texture2D(uPod, vUvS).r;
  if (alpha < 0.01 && podv < 0.01) discard;
  vec2 e = vec2(0.22 / 120.0, 0.22 / 90.0);
  float hx = H(vUvS + vec2(e.x, 0.0)) - H(vUvS - vec2(e.x, 0.0)), hy = H(vUvS + vec2(0.0, e.y)) - H(vUvS - vec2(0.0, e.y));
  vec3 n = normalize(vec3(-hx, 0.44, hy)), V = normalize(cameraPosition - vW);
  // self-shadow and contact darkening from the height texture
  float sh = 1.0, t = 0.25; vec2 ld = vec2(uKey.x / 120.0, -uKey.z / 90.0);
  for (int i = 0; i < 14; i++) { float y = h + uKey.y * t - H(vUvS + ld * t); sh = min(sh, clamp(0.5 + 3.5 * y / t, 0.0, 1.0)); t *= 1.32; }
  vec2 w = vec2(0.9 / 120.0, 0.9 / 90.0);
  float avg = (H(vUvS + vec2(w.x, 0.0)) + H(vUvS - vec2(w.x, 0.0)) + H(vUvS + vec2(0.0, w.y)) + H(vUvS - vec2(0.0, w.y))) * 0.25;
  float ao = clamp(1.0 - 0.55 * (avg - h), 0.35, 1.15);
  // material: cold graphite low down, ember where the chance concentrates
  vec3 base = mix(uLow, uMid, smoothstep(0.05, 0.42, heat)); base = mix(base, uHot, smoothstep(0.38, 0.8, heat)); base = mix(base, uTip, smoothstep(0.78, 1.0, heat));
  base = mix(base, mix(uGainLo, uGainHi, smoothstep(0.1, 1.0, heat)), uGain);
  float nl = max(dot(n, uKey), 0.0) * sh; vec3 hv = normalize(uKey + V);
  float spec = pow(max(dot(n, hv), 0.0), 46.0) * sh * 0.55, fr = pow(1.0 - max(dot(n, V), 0.0), 3.5);
  vec3 c = base * (uKeyCol * nl * 1.55 + uSkyCol * (0.36 + 0.34 * n.y) * ao) + uKeyCol * spec + uSkyCol * fr * 0.55 * ao;
  float hot = smoothstep(0.45, 1.0, heat); c += base * hot * hot * 1.1;                      // the peaks carry their own light
  // contour lines at equal steps of chance
  float lv = h / uStep, fw = fwidth(lv), ln = 1.0 - smoothstep(0.6, 1.5, abs(fract(lv - 0.5) - 0.5) / max(fw, 1e-4));
  ln *= smoothstep(0.9, 0.25, fw); c = mix(c, c * 1.9 + vec3(0.05), ln * 0.55);
  c += uFrontCol * s.b * 0.85;
  if (uPodOn > 0.5) { float hatch = step(0.5, fract((xy.x - xy.y) * 0.8 + uTime * 0.2)); float k = podv * (0.22 + 0.28 * hatch); c = mix(c, uPodCol, clamp(k, 0.0, 0.7)); alpha = max(alpha, k); }
  c *= uDim;
  c = mix(c, uFog, 1.0 - exp(-pow(vFogD * 0.0072, 2.0)));
  gl_FragColor = vec4(c, alpha * 0.97);
}`;

function roverModel(main) {
  const g = new THREE.Group(), std = (c, r = 0.5, m = 0.5, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...o });
  const body = main ? std(0xc9ccd0, 0.42, 0.25) : std(0x5a6068, 0.6, 0.3), dark = std(0x15181b, 0.75, 0.2), metal = std(MAT.steel, 0.35, 0.85);
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
  const deck = new THREE.Shape(); deck.moveTo(-0.62, 0); deck.lineTo(0.5, 0); deck.lineTo(0.68, 0.12); deck.lineTo(0.6, 0.3); deck.lineTo(-0.55, 0.3); deck.lineTo(-0.66, 0.16); deck.closePath();
  const dg = new THREE.ExtrudeGeometry(deck, { depth: 0.56, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 1 }); dg.translate(0, 0.24, -0.28); add(dg, body, 0, 0, 0);
  add(new THREE.BoxGeometry(0.7, 0.03, 0.46), dark, -0.04, 0.58, 0);
  for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.015, 0.02, 0.44), metal, -0.3 + i * 0.13, 0.602, 0);
  const wg = new THREE.CylinderGeometry(0.2, 0.2, 0.17, 22), hub = new THREE.CylinderGeometry(0.09, 0.09, 0.185, 10), tread = new THREE.BoxGeometry(0.03, 0.18, 0.05); wg.rotateX(Math.PI / 2); hub.rotateX(Math.PI / 2);
  const wheels = [];
  for (const x of [-0.5, 0, 0.5]) for (const z of [-0.44, 0.44]) { const w = new THREE.Group(); w.add(new THREE.Mesh(wg, dark), new THREE.Mesh(hub, metal)); for (let i = 0; i < 12; i++) { const t = new THREE.Mesh(tread, dark), a = (i / 12) * 6.283; t.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0); t.rotation.set(Math.PI / 2, 0, 0); t.rotation.order = 'ZXY'; t.rotation.z = a; w.add(t); } w.position.set(x, 0.2, z); g.add(w); wheels.push(w); add(new THREE.BoxGeometry(0.06, 0.06, 0.2), metal, x, 0.28, z * 0.72); }
  add(new THREE.CylinderGeometry(0.025, 0.035, 0.62, 10), metal, -0.36, 0.9, 0);
  add(new THREE.BoxGeometry(0.16, 0.13, 0.34), body, -0.34, 1.24, 0);
  for (const z of [-0.1, 0.1]) { const l = add(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16), std(0x05070a, 0.1, 0.9), -0.25, 1.25, z, 0, 0, Math.PI / 2); l.renderOrder = 1; }
  for (const z of [-0.22, 0.22]) add(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 6), dark, -0.58, 0.82, z);
  if (main) { const lamp = std(0xffffff, 0.4, 0, { emissive: 0xdfeaff, emissiveIntensity: 3 }); for (const z of [-0.2, 0.2]) add(new THREE.BoxGeometry(0.03, 0.05, 0.1), lamp, 0.66, 0.42, z); }
  g.userData.wheels = wheels; g.scale.setScalar(1.25); return g;
}

export function createMap3D(host, ctx) {
  const { h } = ctx.kit, world = ctx.world, SITE = world.SITE, rm = () => ctx.kit.reducedMotion();
  const canvas = h('canvas.gl', { tabindex: '0', role: 'img', 'aria-label': 'Three-dimensional probability landscape of the site. Drag to orbit, scroll to zoom, arrow keys to turn.' });
  const labelLayer = h('div.strategy-labels', { 'aria-hidden': 'true' });
  host.append(canvas, labelLayer);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }); }
  catch (e) { canvas.remove(); labelLayer.remove(); throw new Error('This browser could not start WebGL, which the 3-D map needs.'); }
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  let pr = Math.min(1.5, window.devicePixelRatio || 1); renderer.setPixelRatio(pr);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(MAT.sky); scene.fog = new THREE.FogExp2(MAT.haze, 0.0072);
  const pm = new THREE.PMREMGenerator(renderer), envScene = new RoomEnvironment(); scene.environment = pm.fromScene(envScene, 0.04).texture; scene.environmentIntensity = 0.16; pm.dispose();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 600);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.46; controls.minDistance = 12; controls.maxDistance = 190; controls.zoomSpeed = 0.7; controls.rotateSpeed = 0.55; controls.screenSpacePanning = false;
  let lastUser = -1e9; controls.addEventListener('start', () => { lastUser = performance.now(); camAnim = null; }); controls.addEventListener('end', () => { lastUser = performance.now(); });
  const v3 = (p, y = 0) => new THREE.Vector3(p[0], y, -p[1]);

  // ---- light: one low sun from the west, a cold sky ----
  const sun = new THREE.DirectionalLight(0xffd9b0, 2.5); sun.position.copy(KEY).multiplyScalar(120).add(new THREE.Vector3(62, 0, -45)); sun.target.position.set(62, 0, -45); sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096); Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 60, bottom: -60, near: 10, far: 260 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; sun.shadow.radius = 3;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0x7f97b5, 0x1b1712, 0.55));

  // ---- the static set ----
  const stat = new THREE.Group(); scene.add(stat);
  const rng = mulberry32(4107);
  (function buildSet() {
    const mud = weather(new THREE.MeshStandardMaterial({ color: MAT.mud, roughness: 0.95, metalness: 0 }), { scale: 0.55, tone: 0.5, bump: 0.35, wet: MAT.mudWet });
    const gg = new THREE.PlaneGeometry(420, 420); gg.rotateX(-Math.PI / 2); gg.translate(60, -0.02, -45); const ground = new THREE.Mesh(gg, mud); ground.receiveShadow = true; stat.add(ground);
    const concrete = weather(new THREE.MeshStandardMaterial({ color: MAT.concrete, roughness: 0.88 }), { scale: 1.3, tone: 0.34, bump: 0.35 });
    const slab = weather(new THREE.MeshStandardMaterial({ color: MAT.slab, roughness: 0.8 }), { scale: 0.9, tone: 0.45, bump: 0.15, wet: 0x26251f, joints: 1.2 });
    const R = world.BUILDING.rect, sl = new THREE.Mesh(new THREE.BoxGeometry(R[2] - R[0] + 1.2, 0.3, R[3] - R[1] + 1.2), slab); sl.position.set((R[0] + R[2]) / 2, -0.14, -(R[1] + R[3]) / 2); sl.receiveShadow = true; stat.add(sl);
    const WH = 1.35, cap = new THREE.MeshStandardMaterial({ color: 0xa9a69e, roughness: 0.8 });
    for (const w of world.WALLS) {
      if (w.state === 'collapsed') continue;
      const a = v3(w.a), b = v3(w.b), len = a.distanceTo(b), th = w.mat === 'concrete' ? 0.34 : 0.2, m = new THREE.Mesh(new THREE.BoxGeometry(len + th * 0.9, WH, th), concrete);
      m.position.set((a.x + b.x) / 2, WH / 2, (a.z + b.z) / 2); m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x); m.castShadow = m.receiveShadow = true; stat.add(m);
      const c = new THREE.Mesh(new THREE.BoxGeometry(len + th * 0.9 + 0.02, 0.05, th + 0.02), cap); c.position.copy(m.position); c.position.y = WH; c.rotation.copy(m.rotation); stat.add(c);
    }
    // the two other buildings: storeys, recessed windows, parapet
    const glass = new THREE.MeshStandardMaterial({ color: MAT.glass, roughness: 0.12, metalness: 0.4 }), roof = weather(new THREE.MeshStandardMaterial({ color: MAT.roof, roughness: 0.95 }), { scale: 0.8, tone: 0.5, bump: 0.3 }), winG = new THREE.BoxGeometry(1.25, 1.15, 0.12), sillG = new THREE.BoxGeometry(1.5, 0.08, 0.28);
    const wins = [];
    for (const o of world.OBSTACLES.filter((q) => q.kind === 'building')) {
      const xs = o.poly.map((p) => p[0]), ys = o.poly.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), w = x1 - x0, d = y1 - y0;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, o.h, d), concrete); b.position.set((x0 + x1) / 2, o.h / 2, -(y0 + y1) / 2); b.castShadow = b.receiveShadow = true; stat.add(b);
      const rf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.7, 0.1, d - 0.7), roof); rf.position.set(b.position.x, o.h + 0.06, b.position.z); rf.receiveShadow = true; stat.add(rf);
      for (const [px, pz, sx, sz] of [[0, d / 2, w, 0.35], [0, -d / 2, w, 0.35], [w / 2, 0, 0.35, d], [-w / 2, 0, 0.35, d]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.7, sz), concrete); p.position.set(b.position.x + px * 0.988, o.h + 0.35, b.position.z + pz * 0.988); p.castShadow = p.receiveShadow = true; stat.add(p); }
      for (let i = 0; i < 4; i++) { const s = 0.8 + rng() * 1.6, p = new THREE.Mesh(new THREE.BoxGeometry(s, 0.7 + rng() * 0.7, s * 0.8), cap); p.position.set(x0 + 3 + rng() * (w - 6), o.h + 0.5, -(y0 + 3 + rng() * (d - 6))); p.castShadow = true; stat.add(p); }
      for (let f = 0; f < Math.floor(o.h / 3.1); f++) { const y = 1.7 + f * 3.1; for (let x = x0 + 2; x < x1 - 1; x += 2.7) wins.push([x, y, -y0, 0], [x, y, -y1, 0]); for (let yy = y0 + 2; yy < y1 - 1; yy += 2.7) wins.push([x0, y, -yy, Math.PI / 2], [x1, y, -yy, Math.PI / 2]); }
    }
    const wi = new THREE.InstancedMesh(winG, glass, wins.length), si = new THREE.InstancedMesh(sillG, cap, wins.length), o3 = new THREE.Object3D();
    wins.forEach((q, i) => { o3.position.set(q[0], q[1], q[2]); o3.rotation.set(0, q[3], 0); o3.scale.setScalar(1); o3.updateMatrix(); wi.setMatrixAt(i, o3.matrix); o3.position.y -= 0.64; o3.updateMatrix(); si.setMatrixAt(i, o3.matrix); }); wi.receiveShadow = true; stat.add(wi, si);
    // rubble, slabs, stones, splintered timber: instanced, sitting in the real debris polygons
    const rubbleM = weather(new THREE.MeshStandardMaterial({ color: MAT.rubble, roughness: 0.95, flatShading: true }), { scale: 2.2, tone: 0.5, bump: 0.4 });
    const stone = new THREE.IcosahedronGeometry(1, 1), sp = stone.attributes.position; for (let i = 0; i < sp.count; i++) { const k = 0.74 + 0.26 * Math.abs(Math.sin(sp.getX(i) * 7.1 + sp.getY(i) * 5.3 + sp.getZ(i) * 9.7)); sp.setXYZ(i, sp.getX(i) * k, sp.getY(i) * k * 0.8, sp.getZ(i) * k); } stone.computeVertexNormals();
    const piles = []; const fillPoly = (poly, n, hgt, smin, smax) => { const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); for (let k = 0, g = 0; k < n && g < n * 20; g++) { const x = x0 + rng() * (x1 - x0), y = y0 + rng() * (y1 - y0); if (!pointInPoly([x, y], poly)) continue; piles.push([x, y, rng() * rng() * hgt, smin + rng() * rng() * (smax - smin)]); k++; } };
    for (const o of world.OBSTACLES) if (o.kind === 'rubble') fillPoly(o.poly, o.passable ? 520 : 260, o.passable ? 0.25 : o.h * 0.8, 0.12, o.passable ? 0.75 : 0.85);
    for (let i = 0; i < 700; i++) { const x = -30 + rng() * 180, y = -50 + rng() * 170; if ((x > 43 && x < 85 && y > 29 && y < 59) || (x > 7 && x < 35 && y > 39 && y < 71) || (x > 91 && x < 113 && y > 19 && y < 47)) continue; piles.push([x, y, -0.05, 0.06 + rng() * rng() * 0.5]); }
    const ri = new THREE.InstancedMesh(stone, rubbleM, piles.length), cc = new THREE.Color();
    piles.forEach((p, i) => { o3.position.set(p[0], p[2] + p[3] * 0.25, -p[1]); o3.rotation.set(rng() * 6, rng() * 6, rng() * 6); o3.scale.set(p[3], p[3] * (0.5 + rng() * 0.5), p[3] * (0.7 + rng() * 0.6)); o3.updateMatrix(); ri.setMatrixAt(i, o3.matrix); ri.setColorAt(i, cc.setHSL(0.08, 0.08 + rng() * 0.08, 0.36 + rng() * 0.3)); }); ri.castShadow = ri.receiveShadow = true; stat.add(ri);
    const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.14, 0.2), weather(new THREE.MeshStandardMaterial({ color: 0x4b3a2a, roughness: 0.9 }), { scale: 2, tone: 0.5, bump: 0.3 }), 90); let bi = 0;
    for (const o of world.OBSTACLES) if (o.kind === 'rubble') for (let k = 0; k < 30; k++) { const c = o.poly[k % o.poly.length], q = o.poly[(k + 2) % o.poly.length], f = rng(); o3.position.set(c[0] + (q[0] - c[0]) * f, 0.2 + rng() * o.h * 0.5, -(c[1] + (q[1] - c[1]) * f)); o3.rotation.set(0, rng() * 6, (rng() - 0.5) * 0.8); o3.scale.set(1 + rng() * 2.6, 1, 1); o3.updateMatrix(); if (bi < 90) beams.setMatrixAt(bi++, o3.matrix); } beams.count = bi; beams.castShadow = true; stat.add(beams);
    const desk = world.OBSTACLES.find((o) => o.kind === 'furniture'); if (desk) { const dm = new THREE.MeshStandardMaterial({ color: 0x6b5844, roughness: 0.7 }); for (let i = 0; i < 5; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.05, 0.55), dm); t.position.set(desk.poly[0][0] + 0.5 + i * 0.9, 0.35 + rng() * 0.25, -(desk.poly[0][1] + 0.5)); t.rotation.set(rng() * 1.4 - 0.2, rng() * 2, rng() * 0.8); t.castShadow = true; stat.add(t); } }
    // the valley: ridges that hold the horizon
    for (const [rad, hgt, shade] of [[150, 26, 0x12171c], [215, 62, 0x10151a]]) { const pts = 140, g = new THREE.BufferGeometry(), pos = [], idx = []; for (let i = 0; i <= pts; i++) { const a = (i / pts) * Math.PI * 2, n = 0.45 + 0.3 * Math.sin(a * 3 + rad) + 0.16 * Math.sin(a * 7.3) + 0.1 * Math.sin(a * 17.1 + 2) + 0.05 * Math.sin(a * 41); pos.push(60 + Math.cos(a) * rad, -2, -45 + Math.sin(a) * rad, 60 + Math.cos(a) * rad * 1.12, Math.max(4, n * hgt), -45 + Math.sin(a) * rad * 1.12); if (i < pts) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); } g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); stat.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: shade, side: THREE.DoubleSide, fog: false }))); }
  })();
  stat.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });

  // ---- the relief ----
  const RES = 0.5, GW = Math.round(SITE.w / RES), GH = Math.round(SITE.h / RES), N = GW * GH;
  const half = THREE.DataUtils.toHalfFloat;
  const fieldTex = (w, hh, fmt, n) => { const t = new THREE.DataTexture(new Uint16Array(w * hh * n), w, hh, fmt, THREE.HalfFloatType); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
  let texA = fieldTex(GW, GH, THREE.RGFormat, 2), texB = fieldTex(GW, GH, THREE.RGFormat, 2); const texPod = fieldTex(GW, GH, THREE.RedFormat, 1);
  const rtH = new THREE.WebGLRenderTarget(960, 720, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, depthBuffer: false });
  const compU = { uA: { value: texA }, uB: { value: texB }, uSize: { value: new THREE.Vector2(GW, GH) }, uC: { value: new THREE.Vector2(64, 44) }, uT: { value: 1 }, uWave: { value: 0 }, uFront: { value: 0 } };
  const compScene = new THREE.Scene(), compCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  compScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: compU, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false })));
  const U = { uH: { value: rtH.texture }, uPod: { value: texPod }, uKey: { value: KEY }, uKeyCol: { value: new THREE.Color(0xffd2a1) }, uSkyCol: { value: new THREE.Color(0x6f87a6) },
    uLow: { value: new THREE.Color(0x2a3038) }, uMid: { value: new THREE.Color(0x4a3a3a) }, uHot: { value: new THREE.Color() }, uTip: { value: new THREE.Color(0xffd9a8) }, uGainLo: { value: new THREE.Color(0x1d2a3a) }, uGainHi: { value: new THREE.Color() }, uFrontCol: { value: new THREE.Color(0xcfe4ff) }, uPodCol: { value: new THREE.Color() }, uFog: { value: new THREE.Color(MAT.haze) },
    uPodOn: { value: 0 }, uTime: { value: 0 }, uGain: { value: 0 }, uStep: { value: 0.5 }, uDim: { value: 1 }, uCut: { value: 0.06 } };
  const tg = new THREE.PlaneGeometry(SITE.w, SITE.h, 480, 360); tg.rotateX(-Math.PI / 2); tg.translate(SITE.w / 2, 0, -SITE.h / 2);
  const terrain = new THREE.Mesh(tg, new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, transparent: true, side: THREE.DoubleSide })); terrain.frustumCulled = false; terrain.renderOrder = 2; scene.add(terrain);
  function paint() { U.uHot.value.copy(col('--person')); U.uGainHi.value.copy(col('--accent')); U.uPodCol.value.copy(col('--accent-2')); }
  paint();

  // ---- movers: the searcher, the fixed-route searcher, the next look, the person ----
  const actors = new THREE.Group(); scene.add(actors);
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.32)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const flat = (r, color, op, blend = THREE.AdditiveBlending) => { const g = new THREE.PlaneGeometry(r * 2, r * 2); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, opacity: op, depthWrite: false, blending: blend, fog: false })); m.renderOrder = 3; return m; };
  const rovers = [roverModel(true), roverModel(false)]; for (const r of rovers) { const s = flat(1.1, 0x000000, 0.75, THREE.NormalBlending); s.position.y = 0.04; r.add(s); r.visible = false; actors.add(r); }
  const pool = flat(3.4, 0xbfd6ff, 0.16); pool.position.set(2.4, 0.09, 0); rovers[0].add(pool);
  const ringGeo = new THREE.RingGeometry(0.985, 1, 160); ringGeo.rotateX(-Math.PI / 2);
  const mkRing = (c, op) => { const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false })); m.renderOrder = 6; m.visible = false; actors.add(m); return m; };
  const rings = [mkRing(0xdfeaff, 0.5), mkRing(0xdfeaff, 0.5), mkRing(0xdfeaff, 0.5)];
  const beamMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uC: { value: new THREE.Color(0xd6e8ff) }, uO: { value: 1 } }, vertexShader: 'varying vec2 vUv; varying vec3 vN, vV; void main() { vUv = uv; vec4 m = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-m.xyz); gl_Position = projectionMatrix * m; }', fragmentShader: 'uniform vec3 uC; uniform float uO; varying vec2 vUv; varying vec3 vN, vV; void main() { float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.2); gl_FragColor = vec4(uC, f * pow(1.0 - vUv.y, 1.5) * uO); }' });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 13, 24, 1, true), beamMat); beam.renderOrder = 7; beam.visible = false; actors.add(beam);
  const beamPool = flat(2.6, 0xd6e8ff, 0.55); beamPool.material.depthTest = false; beamPool.visible = false; actors.add(beamPool);
  const person = new THREE.Group(); { const pmat = new THREE.MeshStandardMaterial({ color: 0x2a0d05, emissive: col('--person'), emissiveIntensity: 2.4, roughness: 0.6 }); const add = (g, x, y, z, rx = 0, rz = 0) => { const m = new THREE.Mesh(g, pmat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); person.add(m); };
    add(new THREE.SphereGeometry(0.15, 18, 14), 0, 1.0, 0.02); add(new THREE.CapsuleGeometry(0.19, 0.42, 6, 14), 0, 0.55, -0.02, -0.12); for (const s of [-1, 1]) { add(new THREE.CapsuleGeometry(0.085, 0.36, 4, 10), s * 0.13, 0.3, 0.26, -1.15); add(new THREE.CapsuleGeometry(0.075, 0.36, 4, 10), s * 0.13, 0.16, 0.5, 0.35); add(new THREE.CapsuleGeometry(0.06, 0.34, 4, 10), s * 0.27, 0.56, 0.12, -0.8, s * 0.25); }
    const pl = flat(3.2, col('--person'), 0.75); pl.position.y = 0.1; person.add(pl); person.userData.pool = pl; person.scale.setScalar(1.5); person.visible = false; actors.add(person); }
  const plight = new THREE.PointLight(col('--person'), 0, 16, 1.8); plight.position.y = 1.4; actors.add(plight);
  // trails: fixed-size buffers, grown by draw range
  const mkTrail = (c, op, dashed) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 3000), 3)); g.setDrawRange(0, 0); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: op, depthTest: false, fog: false })); l.frustumCulled = false; l.renderOrder = 5; actors.add(l); return { l, n: 0, last: [1e9, 0] }; };
  const trails = [mkTrail(0xeef4ff, 0.75), mkTrail(0x8d97a3, 0.5)];
  const route = mkTrail(0xd6e8ff, 0.85);
  const setLine = (T, pts, y) => { const a = T.l.geometry.attributes.position; T.n = Math.min(3000, pts.length); for (let i = 0; i < T.n; i++) a.setXYZ(i, pts[i][0], y, -pts[i][1]); a.needsUpdate = true; T.l.geometry.setDrawRange(0, T.n); };
  const stage = {
    rover(i, pos, heading, show = true) { const r = rovers[i]; r.visible = show; if (!show) return; const dx = pos[0] - r.position.x, dz = -pos[1] - r.position.z, d = Math.hypot(dx, dz); for (const w of r.userData.wheels) w.rotation.z -= Math.min(d, 1) / 0.25; r.position.set(pos[0], 0.02, -pos[1]); if (heading != null) r.rotation.y = heading; const T = trails[i]; if (Math.hypot(pos[0] - T.last[0], pos[1] - T.last[1]) > 0.2 && T.n < 3000) { const a = T.l.geometry.attributes.position; a.setXYZ(T.n, pos[0], 0.1, -pos[1]); a.needsUpdate = true; T.n++; T.l.geometry.setDrawRange(0, T.n); T.last[0] = pos[0]; T.last[1] = pos[1]; } },
    clear() { for (const T of [...trails, route]) { T.n = 0; T.last[0] = 1e9; T.l.geometry.setDrawRange(0, 0); } person.visible = false; plight.intensity = 0; beam.visible = beamPool.visible = false; rings.forEach((r) => (r.visible = false)); },
    next(pos, path) { beam.visible = beamPool.visible = !!pos; if (pos) { beam.position.set(pos[0], 6.5, -pos[1]); beamPool.position.set(pos[0], 0.12, -pos[1]); } setLine(route, path || [], 0.12); },
    listen(pos, p) { rings.forEach((r, i) => { const q = p == null ? -1 : p * 2.2 - i * 0.42; r.visible = q > 0 && q < 1; if (r.visible) { const R = 0.6 + q * 6.4; r.position.set(pos[0], 0.5, -pos[1]); r.scale.set(R, 1, R); r.material.opacity = 0.55 * (1 - q); } }); },
    person(pos, k) { person.visible = k > 0.01; if (k > 0.01) { person.position.set(pos[0], 0.05, -pos[1]); person.rotation.y = 0.7; person.userData.pool.material.opacity = 0.75 * k; plight.position.set(pos[0], 1.5, -pos[1]); plight.intensity = 60 * k; } else plight.intensity = 0; },
    hide() { rovers.forEach((r) => (r.visible = false)); this.clear(); },
  };

  // ---- analysis marks for the advanced exhibits ----
  const marks = new THREE.Group(); scene.add(marks);
  let labels = [];
  const addLabel = (cls, pos, y, html, lead = 14) => { const el = h('div.strategy-lab.' + cls, { html, style: { '--lead': lead + 'px' } }); labelLayer.append(el); labels.push({ el, p: v3(pos, y), hid: null }); return el; };
  const line = (pts, color, opacity = 1, dashed = false) => { const g = new THREE.BufferGeometry().setFromPoints(pts), l = new THREE.Line(g, dashed ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.5, gapSize: 0.4, depthTest: false }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false })); if (dashed) l.computeLineDistances(); l.renderOrder = 8; marks.add(l); };
  const ring = (pos, r, color, opacity = 1, y = 0.09, w = 0.07) => { const g = new THREE.RingGeometry(Math.max(0.01, r - w), r + w, 64); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false, side: THREE.DoubleSide })); m.position.set(pos[0], y, -pos[1]); m.renderOrder = 8; marks.add(m); };
  const post = (pos, y, color, op = 0.9) => line([v3(pos, 0.05), v3(pos, y)], color, op);
  function setMarkers(M) {
    marks.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); marks.clear(); labelLayer.replaceChildren(); labels = [];
    for (const r of M.rooms || []) addLabel('room', r.pos, 0.1, r.html, 0);
    if (M.trail && M.trail.length > 1) line(M.trail.map((p) => v3(p, 0.1)), col('--text-2'), 0.6);
    for (const s of M.looks || []) { ring(s.pos, 0.5, col('--text'), 0.9); ring(s.pos, 0.14, col('--text'), 0.9, 0.09, 0.14); }
    for (const s of M.stops || []) { post(s.pos, 3.6, col('--text-2')); addLabel('stop', s.pos, 3.6, s.html, 0); ring(s.pos, 0.5, col('--text-2'), 0.7); }
    for (const s of M.best || []) { post(s.pos, s.h || 5, col('--accent')); ring(s.pos, 0.6, col('--accent'), 0.95); addLabel(s.first ? 'best' : 'stop', s.pos, s.h || 5, s.html, 0); }
    if (M.path && M.path.length > 1) line(M.path.map((p) => v3(p, 0.12)), col('--accent'), 0.95, true);
    for (const d of M.leads || []) { const c = col(d.person ? '--person' : '--warn'); post(d.pos, d.h + 2, c); ring(d.pos, Math.max(0.5, d.sigma || 0.6), c, 0.85); addLabel(d.person ? 'person' : 'lead', d.pos, d.h + 2, d.html, 0); }
    for (const t of M.truth || []) { ring(t.pos, 0.95, col('--sim'), 0.95, 0.1, 0.05); line([v3(t.pos, 0.05), v3(t.pos, 7.5)], col('--sim'), 0.8, true); addLabel('truth', t.pos, 7.5, t.html, 0); }
    if (M.probe) { post(M.probe.pos, 4.5, col('--accent-2')); ring(M.probe.pos, 0.5, col('--accent-2')); ring(M.probe.pos, M.probe.range, col('--accent-2'), 0.4, 0.06, 0.03); addLabel('best', M.probe.pos, 4.5, M.probe.html, 0); }
  }

  // ---- data ----
  // values: height in metres and heat 0..1 per 0.5 m cell. With { from: [x, y] } the change leaves that point as a wave.
  let tween = 1, wave = null;
  function setField(hgt, heat, { from = null, instant = false, secs = 0.7 } = {}) {
    const t = texA; texA = texB; texB = t; compU.uA.value = texA; compU.uB.value = texB;
    const d = texB.image.data; for (let i = 0; i < N; i++) { d[i * 2] = half(hgt[i]); d[i * 2 + 1] = half(heat[i]); } texB.needsUpdate = true;
    tween = instant || rm() ? 1 : 0; compU.uT.value = tween; tweenSecs = secs; wave = null; compU.uFront.value = 0;
    if (from && tween < 1) { wave = { r: 0, speed: 11 / secs }; compU.uFront.value = 1; compU.uC.value.set(from[0], from[1]); compU.uWave.value = -2; }
  }
  let tweenSecs = 0.7;
  function setPod(values) { if (values) { const d = texPod.image.data; for (let i = 0; i < N; i++) d[i] = half(values[i]); texPod.needsUpdate = true; U.uPodOn.value = 1; } else U.uPodOn.value = 0; }
  let gainTarget = 0; const setMode = (m) => { gainTarget = m === 'gain' ? 1 : 0; };
  const setContours = (stepM) => { U.uStep.value = stepM; };

  // ---- camera: spherical goals, eased; the visitor can take it at any time ----
  const VIEWS = { building: { az: -0.52, el: 0.6, d: 78, t: [65, 0.5, -43] }, site: { az: -0.4, el: 0.62, d: 138, t: [62, 0, -46] }, top: { az: 0, el: 1.45, d: 96, t: [64, 0, -44] } };
  const cur = { az: -0.75, el: 0.5, d: 104, t: new THREE.Vector3(64, 0, -44) }, goal = { az: -0.52, el: 0.6, d: 78, t: new THREE.Vector3(65, 0.5, -43) };
  let camAnim = null, film = false, framePad = 0;
  const place = (c) => { camera.position.set(c.t.x + Math.sin(c.az) * Math.cos(c.el) * c.d, c.t.y + Math.sin(c.el) * c.d, c.t.z + Math.cos(c.az) * Math.cos(c.el) * c.d); controls.target.copy(c.t); };
  function readCam() { const o = camera.position.clone().sub(controls.target); cur.d = o.length(); cur.el = Math.asin(o.y / cur.d); cur.az = Math.atan2(o.x, o.z); cur.t.copy(controls.target); }
  function setView(name, instant = false) { const v = VIEWS[name] || VIEWS.building; film = false; readCam(); goal.az = v.az; goal.el = v.el; goal.d = v.d; goal.t.set(...v.t); lastUser = -1e9; if (instant || rm()) { cur.az = v.az; cur.el = v.el; cur.d = v.d; cur.t.copy(goal.t); place(cur); camAnim = null; } else camAnim = { slow: 3.2, left: 1.8 }; }
  function shot(az, el, d, tx, tz, y = 0.5) { goal.az = az; goal.el = el; goal.d = d; goal.t.set(tx, y, -tz); if (!film) { film = true; readCam(); } }
  place(cur);

  // ---- picking and keys ----
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(), nd = new THREE.Vector2();
  let onPick = null, down = null;
  const toWorld = (ev) => { const r = canvas.getBoundingClientRect(); ray.setFromCamera(nd.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera); return ray.ray.intersectPlane(plane, hit) ? [hit.x, -hit.z] : null; };
  canvas.addEventListener('pointerdown', (ev) => { down = [ev.clientX, ev.clientY]; });
  canvas.addEventListener('pointerup', (ev) => { if (down && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) < 5) { const p = toWorld(ev); if (p && onPick) onPick(p); } down = null; });
  canvas.addEventListener('keydown', (ev) => {
    const k = ev.key; if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'].includes(k)) return;
    readCam(); if (k === 'ArrowLeft') cur.az -= 0.09; else if (k === 'ArrowRight') cur.az += 0.09; else if (k === 'ArrowUp') cur.el = Math.min(1.45, cur.el + 0.06); else if (k === 'ArrowDown') cur.el = Math.max(0.14, cur.el - 0.06); else cur.d = Math.min(190, Math.max(12, cur.d * (k === '-' ? 1.1 : 0.91)));
    place(cur); lastUser = performance.now(); camAnim = null; ev.preventDefault(); ev.stopPropagation(); if (!loop.running) renderOnce();
  });

  // ---- post ----
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt); composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.34, 0.55, 0.92); composer.addPass(bloom); composer.addPass(new OutputPass());
  const grade = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } }, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv; float r(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); } void main() { vec3 c = texture2D(tDiffuse, vUv).rgb; vec2 q = vUv - 0.5; c *= 1.0 - 0.75 * dot(q, q); c += (r(vUv * 917.0 + fract(uTime)) - 0.5) * 0.018; gl_FragColor = vec4(c, 1.0); }' });
  composer.addPass(grade);

  // ---- frame ----
  const proj = new THREE.Vector3(); let W = 0, H = 0, acc = 0, cnt = 0, needShadow = true, onFrame = null;
  function resize() { const r = host.getBoundingClientRect(); if (!r.width || !r.height) return; W = r.width; H = r.height; renderer.setPixelRatio(pr); renderer.setSize(W, H, false); composer.setPixelRatio(pr); composer.setSize(W, H); bloom.setSize(W * pr * 0.5, H * pr * 0.5); camera.aspect = W / H; camera.updateProjectionMatrix(); applyPad(); if (!loop.running) renderOnce(); }
  function applyPad() { if (framePad && W) camera.setViewOffset(W, H, framePad * W, 0, W, H); else camera.clearViewOffset(); }
  const ro = new ResizeObserver(() => resize()); ro.observe(host);
  function update(dt, time) {
    if (tween < 1) { tween = Math.min(1, tween + dt / tweenSecs); if (wave) { compU.uWave.value = -2 + tween * 13; if (tween >= 1) { wave = null; compU.uFront.value = 0; } } compU.uT.value = wave ? 0 : 1 - Math.pow(1 - tween, 3); }
    const g = U.uGain.value; if (g !== gainTarget) U.uGain.value = Math.abs(gainTarget - g) < 0.01 || rm() ? gainTarget : g + (gainTarget - g) * Math.min(1, dt * 6);
    U.uTime.value = rm() ? 0 : time; grade.uniforms.uTime.value = rm() ? 0 : time;
    const idle = performance.now() - lastUser > 6000;
    if (camAnim || (film && idle)) { const k = 1 - Math.exp(-dt * (film ? 0.85 : 3.4)); let da = goal.az - cur.az; da = Math.atan2(Math.sin(da), Math.cos(da)); cur.az += da * k; cur.el += (goal.el - cur.el) * k; cur.d += (goal.d - cur.d) * k; cur.t.lerp(goal.t, k); place(cur); if (camAnim && (camAnim.left -= dt) < 0) camAnim = null; camera.lookAt(controls.target); camera.updateMatrixWorld(); }
    else { controls.update(); if (film) readCam(); }
    if (beam.visible) beamMat.uniforms.uO.value = 0.5 + (rm() ? 0 : 0.14 * Math.sin(time * 2.4));
  }
  function draw() {
    if (!W) resize(); if (!W) return;
    if (needShadow) { renderer.shadowMap.needsUpdate = true; needShadow = false; }
    renderer.setRenderTarget(rtH); renderer.render(compScene, compCam); renderer.setRenderTarget(null);
    composer.render();
    for (const l of labels) { proj.copy(l.p).project(camera); const x = (proj.x * 0.5 + 0.5) * W, y = (-proj.y * 0.5 + 0.5) * H, off = proj.z > 1 || x < 0 || x > W || y < 18 || y > H; if (off !== l.hid) { l.el.classList.toggle('is-hidden', off); l.hid = off; } if (!off) l.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%, calc(-100% - var(--lead, 14px)))'; }
  }
  function frame(dt, time) {
    if (onFrame) onFrame(dt, time);
    update(dt, time); draw();
    acc += dt; if (++cnt === 40) { const ms = (acc / cnt) * 1000; acc = 0; cnt = 0; if (ms > 19.5 && pr > 0.8) { pr = Math.max(0.8, pr - 0.15); resize(); } }
  }
  const loop = makeLoop(frame);
  function renderOnce() { update(1, 0); draw(); }
  return { GW, GH, RES, N, stage, setField, setPod, setMode, setMarkers, setView, setContours, shot, loop,
    setDim(k) { U.uDim.value = k; }, setFramePad(f) { framePad = f; applyPad(); }, set onFrame(f) { onFrame = f; }, onPick(fn) { onPick = fn; },
    freeCamera() { film = false; }, project(pos, y, out) { proj.set(pos[0], y, -pos[1]).project(camera); out[0] = (proj.x * 0.5 + 0.5) * W; out[1] = (-proj.y * 0.5 + 0.5) * H; return proj.z < 1; },
    start() { resize(); loop.start(); }, stop() { loop.stop(); }, renderOnce, restyle() { paint(); if (!loop.running) renderOnce(); },
    get pixelRatio() { return pr; }, info: () => ({ ...renderer.info.render, pr }),
    dispose() { loop.stop(); ro.disconnect(); controls.dispose(); composer.dispose(); renderer.dispose(); } };
}
