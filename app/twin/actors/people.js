// People: detections drawn as they are KNOWN, not as they are.
//   possible   a faint volume of noise that has not decided on a shape, drifting inside a hairline ellipse the size of posSigma
//   confirmed  the noise has resolved into a warm figure, seen through walls; a hairline arc as long as the fused probability
//   rejected   a small grey cross
// How far the figure has resolved is a function of the detection's probability and nothing else.
// Display conventions (posture is not sensed): a person the sensors call "moving" is drawn standing, anyone else
// is drawn lying, with a fixed yaw taken from the detection id. Everything here is simulated.
// The 'truth' layer (off by default) is the only place ground truth is drawn.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRUTH } from '../../core/world.js';
import { palette, Y, clamp, lerp, damp, smoothstep, stateWatcher, decalMaterial, disposeTree, mulberry32 } from './common.js';

const FIG_R = 1.0;                 // ring radius around a confirmed person, m
const TAU = Math.PI * 2;

const RING_VERT = /* glsl */ `
uniform float uHalf;
varying vec2 vP;
void main() { vP = vec2(position.x, -position.z) * uHalf; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RING_FRAG = /* glsl */ `
uniform vec3 uWarn, uPerson, uOk;
uniform float uR, uP, uConf, uReach, uAlpha, uSel, uPulse, uStretch;
varying vec2 vP;
float band(float d, float w) { return 1.0 - smoothstep(w * 0.4, w * 1.3, abs(d)); }
void main() {
  float c = cos(0.6), s = sin(0.6); vec2 q = vec2(c * vP.x + s * vP.y, (-s * vP.x + c * vP.y) * mix(1.22, 1.0, uConf));   // an ellipse while it is uncertain
  float r = length(q), aa = fwidth(r), w = max(0.005, aa * 0.8);
  float ang = fract(atan(vP.x, vP.y) / 6.2831853 + 1.0);
  vec3 col = mix(mix(uWarn, uPerson, 0.35 + 0.65 * uConf), uOk, uReach * 0.8);
  float line = band(r - uR, w) * mix(0.5, 0.22, uConf);
  float iso = (band(r - uR * 0.68, w * 0.8) * 0.22 + band(r - uR * 0.4, w * 0.8) * 0.16) * (1.0 - uConf);
  float fill = exp(-r * r / (uR * uR) * 2.2) * mix(0.07, 0.16, uConf);
  float aaA = fwidth(ang) * 1.2 + 1e-4;
  float arc = band(r - uR, w * 1.5) * (1.0 - smoothstep(uP - aaA, uP, ang)) * step(0.0005, uP) * uConf * 0.75;
  float sel = band(r - uR - max(0.06, aa * 4.0), w) * uSel * 0.7;
  float pk = 1.0 - uPulse, pe = 1.0 - pow(1.0 - pk, 3.0);
  float pulse = (band(r - uR - pe * 1.5, w * 2.2) * 0.9 + exp(-(r - uR - pe * 1.5) * (r - uR - pe * 1.5) * 25.0) * 0.2) * uPulse * uPulse * step(0.001, uPulse);
  float a = max(max(line, arc), iso) + fill + sel + pulse;
  gl_FragColor = vec4(col * (0.85 + 0.35 * uSel + 0.5 * pulse), clamp(a, 0.0, 1.0) * uAlpha);
}`;

// A ray-marched body of warm air. One signed distance field (a person made of soft capsules) and one shapeless
// ellipsoid; uK morphs between them while the noise that tears the surface dies away.
const VOL_VERT = /* glsl */ `
varying vec3 vL; varying vec3 vCam;
void main() { vL = position; vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const VOL_FRAG = /* glsl */ `
uniform vec3 uWarn, uPerson, uHot; uniform float uK, uAlpha, uTime, uSeed, uBreath, uCalm, uFlash, uLie;
uniform vec3 uBox;
varying vec3 vL; varying vec3 vCam;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y), mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float cap(vec3 p, vec3 a, vec3 b, float r0, float r1) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - mix(r0, r1, h); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
// feet on y = 0, facing +z, 1.72 m tall. Lying people draw one knee up and one arm across the body.
float body(vec3 p) {
  float br = uBreath;
  vec3 q = p;
  float d = length((q - vec3(0.0, 1.585, 0.02)) / vec3(0.88, 1.12, 1.0)) - 0.098;
  d = smin(d, cap(q, vec3(0.0, 1.4, 0.0), vec3(0.0, 1.52, 0.01), 0.056, 0.05), 0.03);
  float tr = cap(vec3(q.x * 0.66, q.y, q.z), vec3(0.0, 1.31, 0.0), vec3(0.0, 1.13, 0.005), 0.118 + br, 0.1 + br);
  tr = smin(tr, cap(vec3(q.x * 0.74, q.y, q.z), vec3(0.0, 1.06, 0.0), vec3(0.0, 0.93, 0.0), 0.098, 0.112), 0.07);
  d = smin(d, tr, 0.05);
  d = smin(d, cap(q, vec3(-0.155, 1.375, 0.0), vec3(0.155, 1.375, 0.0), 0.066, 0.066), 0.06);
  vec3 eL = mix(vec3(0.25, 1.11, -0.02), vec3(0.27, 1.13, 0.06), uLie), hL = mix(vec3(0.27, 0.86, 0.05), vec3(0.08, 1.08, 0.17), uLie);
  vec3 eR = mix(vec3(-0.25, 1.11, -0.02), vec3(-0.33, 1.14, -0.02), uLie), hR = mix(vec3(-0.27, 0.86, 0.05), vec3(-0.42, 0.93, 0.02), uLie);
  d = smin(d, cap(q, vec3(0.19, 1.365, 0.0), eL, 0.056, 0.044), 0.045); d = smin(d, cap(q, eL, hL, 0.043, 0.034), 0.03); d = smin(d, length(q - hL - normalize(hL - eL) * 0.07) - 0.044, 0.04);
  d = smin(d, cap(q, vec3(-0.19, 1.365, 0.0), eR, 0.056, 0.044), 0.045); d = smin(d, cap(q, eR, hR, 0.043, 0.034), 0.03); d = smin(d, length(q - hR - normalize(hR - eR) * 0.07) - 0.044, 0.04);
  vec3 kL = mix(vec3(0.1, 0.5, 0.015), vec3(0.13, 0.56, 0.27), uLie), fL = mix(vec3(0.1, 0.09, 0.0), vec3(0.12, 0.26, 0.02), uLie);
  vec3 kR = mix(vec3(-0.1, 0.5, 0.015), vec3(-0.14, 0.49, 0.03), uLie), fR = mix(vec3(-0.1, 0.09, 0.0), vec3(-0.19, 0.08, 0.0), uLie);
  d = smin(d, cap(q, vec3(0.092, 0.9, 0.0), kL, 0.09, 0.062), 0.06); d = smin(d, cap(q, kL, fL, 0.06, 0.043), 0.03); d = smin(d, cap(q, fL + vec3(0.0, -0.03, 0.0), fL + vec3(0.01, -0.05, 0.13), 0.042, 0.03), 0.03);
  d = smin(d, cap(q, vec3(-0.092, 0.9, 0.0), kR, 0.09, 0.062), 0.06); d = smin(d, cap(q, kR, fR, 0.06, 0.043), 0.03); d = smin(d, cap(q, fR + vec3(0.0, -0.03, 0.0), fR + vec3(-0.01, -0.05, 0.13), 0.042, 0.03), 0.03);
  return d;
}
void main() {
  vec3 ro = vCam, rd = normalize(vL - vCam), inv = 1.0 / rd, c = vec3(0.0, 0.86, 0.08);
  vec3 t0 = (c - uBox - ro) * inv, t1 = (c + uBox - ro) * inv, mn = min(t0, t1), mx = max(t0, t1);
  float a = max(max(mn.x, mn.y), max(mn.z, 0.0)), b = min(mx.x, min(mx.y, mx.z)); if (b <= a) discard;
  float st = (b - a) / float(STEPS), j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float un = 1.0 - uK, morph = smoothstep(0.0, 0.85, uK), lockK = smoothstep(0.55, 1.0, uK); vec3 sum = vec3(0.0); float tr = 1.0;
  vec3 drift = vec3(uSeed + sin(uTime * 0.21) * 0.9, cos(uTime * 0.17) * 0.5, sin(uTime * 0.13) * 0.8); bool got = false;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (a + st * (float(i) + j));
    float e = (length((p - vec3(0.0, 0.86, 0.03)) / vec3(0.42, 0.86, 0.24)) - 1.0) * 0.24, d = uK < 0.03 ? e : mix(e, body(p), morph);
    if (d < 0.28) {
      float n = un > 0.01 ? noise(p * 5.5 + drift) * 0.6 + noise(p * 13.0 - drift * 1.7) * 0.4 : 0.5;
      d += un * (n - 0.42) * 0.62;
      float tick = un > 0.02 ? step(0.5 * un, hash(floor(p * 34.0) + floor(uTime * 9.0) * 0.37 + uSeed)) : 1.0;       // the estimate flickers until it is sure
      // the skin, once there is one: found between two steps, lit by its own warmth and the angle it is seen at
      if (!got && lockK > 0.01 && d < 0.0) {
        got = true; vec3 h = p - rd * st * 0.5; for (int s = 0; s < 4; s++) { h += rd * body(h) * 0.8; }
        vec2 ee = vec2(0.006, -0.006);
        vec3 N = normalize(ee.xyy * body(h + ee.xyy) + ee.yyx * body(h + ee.yyx) + ee.yxy * body(h + ee.yxy) + ee.xxx * body(h + ee.xxx));
        float ndv = clamp(-dot(N, rd), 0.0, 1.0), rim = pow(1.0 - ndv, 2.5);
        float trunk = smoothstep(0.42, 0.1, abs(h.x)) * smoothstep(0.75, 1.1, h.y) * smoothstep(1.75, 1.62, h.y), face = smoothstep(1.46, 1.56, h.y);
        float cloth = 0.82 + 0.18 * noise(h * vec3(22.0, 9.0, 22.0)) ;
        float T = (0.2 + 0.5 * max(trunk, face)) * pow(ndv, 1.3) * cloth + 0.1 * noise(h * 11.0 + vec3(0.0, uTime * 0.15, 0.0));
        vec3 ember = vec3(uPerson.r * 0.42, uPerson.g * 0.22, uPerson.b * 0.16);
        vec3 sk = mix(ember, uPerson, smoothstep(0.02, 0.36, T)); sk = mix(sk, uHot, smoothstep(0.3, 0.72, T) * 0.75 * (1.0 - 0.35 * uCalm));
        sk += uPerson * rim * 0.55; sk += uPerson * 0.05 * step(0.92, fract(h.y * 46.0 - uTime * 0.5));
        sum += tr * lockK * sk; tr *= 1.0 - 0.94 * lockK;
      }
      float heat = smoothstep(0.06, -0.06, d), halo = exp(-max(d, 0.0) * mix(9.0, 26.0, uK)) * mix(0.1, 0.05, uK);
      float dens = (heat * mix(0.85, 5.0, uK) * (1.0 - lockK * 0.9) + halo) * mix(1.0, tick, un * 0.85);
      vec3 col = mix(mix(vec3(0.62, 0.6, 0.58), uPerson, 0.3 + 0.25 * heat), uPerson, uK);
      float k = 1.0 - exp(-dens * st * mix(1.6, 3.4, uK)); sum += tr * k * col * mix(0.55, 1.0, heat); tr *= 1.0 - k * 0.8;
      if (tr < 0.04) break;
    }
  }
  float al = (1.0 - tr) * uAlpha; if (al < 0.003) discard;
  gl_FragColor = vec4(sum * uAlpha * mix(0.9, 1.0, uK) * (1.0 + 0.7 * uFlash), al);
}`;

const FLAT_VERT = /* glsl */ `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FLAT_FRAG = /* glsl */ `uniform vec3 uColor; uniform float uAlpha; void main() { gl_FragColor = vec4(uColor, uAlpha); 
  #include <colorspace_fragment>
}`;

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const toward = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

// A standing body 1.7 m tall, feet on y = 0, facing +z. detail = radial segments.
function bodyGeometry(THREE, detail) {
  const parts = [], up = new THREE.Vector3(0, 1, 0), a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), q = new THREE.Quaternion(), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  const cap = Math.max(2, detail >> 2);
  const tag = (g, heat, chest) => { const n = g.attributes.position.count, arr = new Float32Array(n * 2); for (let i = 0; i < n; i++) { arr[i * 2] = heat; arr[i * 2 + 1] = chest; } g.setAttribute('aBody', new THREE.BufferAttribute(arr, 2)); g.deleteAttribute('uv'); parts.push(g); };
  const limb = (p0, p1, r, heat) => {
    a.fromArray(p0); b.fromArray(p1); d.subVectors(b, a); const len = d.length();
    const g = new THREE.CapsuleGeometry(r, len, cap, detail);
    q.setFromUnitVectors(up, d.normalize()); a.add(b).multiplyScalar(0.5); g.applyMatrix4(m.compose(a, q, one)); tag(g, heat, 0);
  };
  const blob = (c, r, heat, chest = 0) => { const g = new THREE.SphereGeometry(1, detail, Math.max(4, detail - 2)); g.scale(r[0], r[1], r[2]); g.translate(c[0], c[1], c[2]); tag(g, heat, chest); };
  blob([0, 1.585, 0.005], [0.094, 0.115, 0.104], 0.95);                      // head
  limb([0, 1.42, 0], [0, 1.5, 0], 0.048, 0.9);                               // neck
  blob([0, 1.245, 0], [0.185, 0.215, 0.112], 1, 1);                          // chest
  limb([-0.15, 1.385, 0], [0.15, 1.385, 0], 0.062, 0.95);                    // shoulders
  blob([0, 1.03, 0.005], [0.155, 0.17, 0.104], 1, 0.5);                      // abdomen
  blob([0, 0.895, 0], [0.168, 0.115, 0.11], 0.9);                            // pelvis
  for (const s of [-1, 1]) {
    limb([s * 0.215, 1.37, 0], [s * 0.26, 1.1, -0.01], 0.047, 0.7);          // upper arm
    limb([s * 0.26, 1.1, -0.01], [s * 0.275, 0.86, 0.03], 0.039, 0.55);      // forearm
    blob([s * 0.28, 0.79, 0.04], [0.036, 0.066, 0.028], 0.4);                // hand
    limb([s * 0.092, 0.87, 0], [s * 0.1, 0.5, 0.012], 0.073, 0.75);          // thigh
    limb([s * 0.1, 0.5, 0.012], [s * 0.1, 0.105, 0], 0.052, 0.55);           // shin
    blob([s * 0.1, 0.042, 0.055], [0.046, 0.042, 0.115], 0.35);              // foot
  }
  const g = mergeGeometries(parts); for (const p of parts) p.dispose();
  return g;
}

export default {
  id: 'people',
  layers: ['heat', 'truth'],
  create(t) {
    const { THREE } = t, pal = palette(t);
    const low = t.quality === 'low';
    const root = new THREE.Group(); root.name = 'people'; t.scene.add(root);
    const hot = new THREE.Color(pal.heat[pal.heat.length - 1]);

    // shared geometry
    const quad = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const BOX = new THREE.Vector3(0.64, 1.1, 0.56), volGeo = new THREE.BoxGeometry(BOX.x * 2, BOX.y * 2, BOX.z * 2).translate(0, 0.86, 0.08);
    const bar = new THREE.PlaneGeometry(0.52, 0.045).rotateX(-Math.PI / 2);
    const crossGeo = mergeGeometries([bar.clone().rotateY(Math.PI / 4), bar.clone().rotateY(-Math.PI / 4)]); bar.dispose();
    const pickGeo = new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0);
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    const none = () => {};

    const visuals = new Map();
    let heatOn = true, truthOn = false, selType = null, selId = null, frame = 0;
    try { const s = t.ctx.selection; if (s) { selType = s.type; selId = s.id; } } catch { /* no selection yet */ }

    function build(id) {
      const group = new THREE.Group(); group.name = 'detection-' + id; root.add(group);
      const ringMat = decalMaterial(THREE, { depthTest: false, vertexShader: RING_VERT, fragmentShader: RING_FRAG,
        uniforms: { uWarn: { value: pal.warn }, uPerson: { value: pal.person }, uOk: { value: pal.ok }, uHalf: { value: 1 }, uR: { value: 1 }, uP: { value: 0 }, uConf: { value: 0 }, uReach: { value: 0 }, uAlpha: { value: 0 }, uSel: { value: 0 }, uPulse: { value: 0 } } });
      const ring = new THREE.Mesh(quad, ringMat); ring.position.y = t.groundY + Y.ring; ring.renderOrder = 8; ring.raycast = none; group.add(ring);
      const fig = new THREE.Group(), pose = new THREE.Group(); fig.add(pose); group.add(fig);
      const volMat = new THREE.ShaderMaterial({ defines: { STEPS: low ? 18 : 34 }, transparent: true, premultipliedAlpha: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, depthWrite: false, depthTest: false, side: THREE.BackSide, vertexShader: VOL_VERT, fragmentShader: VOL_FRAG,
        uniforms: { uWarn: { value: pal.warn }, uPerson: { value: pal.person }, uHot: { value: hot }, uK: { value: 0 }, uAlpha: { value: 0 }, uTime: { value: 0 }, uSeed: { value: (hashStr(id) % 97) * 0.37 }, uBreath: { value: 0 }, uCalm: { value: 0 }, uFlash: { value: 0 }, uLie: { value: 1 }, uBox: { value: BOX } } });
      const vol = new THREE.Mesh(volGeo, volMat); vol.renderOrder = 24; vol.raycast = none; pose.add(vol);
      const crossMat = decalMaterial(THREE, { vertexShader: FLAT_VERT, fragmentShader: FLAT_FRAG, uniforms: { uColor: { value: pal.dim }, uAlpha: { value: 0 } } });
      const cross = new THREE.Mesh(crossGeo, crossMat); cross.position.y = t.groundY + Y.marker; cross.renderOrder = 7; cross.raycast = none; group.add(cross);
      const pick = new THREE.Mesh(pickGeo, pickMat); group.add(pick);
      t.pickable(group, { type: 'detection', id });
      const label = t.label('', { tone: 'warn', priority: 5, sel: { type: 'detection', id } }); label.setVisible?.(false);
      const rng = mulberry32(hashStr('yaw' + id));
      return { id, group, ring, ringMat, fig, pose, vol, volMat, cross, crossMat, pick, label, labelOn: false,
        x: 0, y: 0, sigma: 1, kFig: 0, kRes: 0, kCross: 0, kSh: 0, appear: 0, pulse: 0, reach: 0, lying: -1, status: '', text: '', sub: '', tone: '', yaw: rng() * TAU, bph: rng() * TAU, seen: 0, lp: new THREE.Vector3() };
    }

    function setPose(v, lying) {
      if (v.lying === lying) return; v.lying = lying;
      if (lying) { v.pose.rotation.set(-Math.PI / 2, 0, 0); v.pose.position.set(0, 0.125, 0.85); v.fig.rotation.y = v.yaw; }
      else { v.pose.rotation.set(0, 0, 0); v.pose.position.set(0, 0, 0); v.fig.rotation.y = v.yaw; }
    }

    // ---------- ground truth (debug layer, off by default) ----------
    const truth = new THREE.Group(); truth.name = 'ground-truth'; truth.visible = false; root.add(truth);
    const truthLabels = [], truthDefs = [];
    {
      const white = new THREE.Color('#ffffff');
      const lineMat = new THREE.LineBasicMaterial({ color: white, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false, toneMapped: false });
      const faintMat = new THREE.LineBasicMaterial({ color: white, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false, toneMapped: false });
      const lowBody = bodyGeometry(THREE, 6), bodyEdges = new THREE.EdgesGeometry(lowBody, 32); lowBody.dispose();
      const circle = (r, n = 40) => { const p = []; for (let i = 0; i < n; i++) { const a0 = i / n * TAU, a1 = (i + 1) / n * TAU; p.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); return g; };
      const segs = (arr) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); return g; };
      const add = (parent, geo, mat) => { const l = new THREE.LineSegments(geo, mat); l.renderOrder = 40; l.raycast = none; parent.add(l); return l; };
      for (const p of TRUTH.people) {
        const g = new THREE.Group(); g.position.copy(t.v3(p.pos, t.groundY)); truth.add(g);
        const lying = p.posture === 'lying', body = add(g, bodyEdges, lineMat);
        if (lying) { const r = mulberry32(hashStr('truth' + p.id)); body.rotation.set(-Math.PI / 2, 0, 0); body.position.set(0, 0.115, 0.85); g.rotation.y = r() * TAU; }
        add(g, circle(lying ? 1.0 : 0.45), faintMat).position.y = Y.select + 0.02;
        truthDefs.push({ text: 'Ground truth: person, ' + (lying ? 'lying' : 'standing') + (p.motion === 'still' ? ' still' : ', moving'), pos: t.v3(p.pos, t.groundY + (lying ? 0.75 : 1.95)) });
      }
      for (const x of TRUTH.decoys) {
        const g = new THREE.Group(); g.position.copy(t.v3(x.pos, t.groundY)); truth.add(g);
        if (x.kind === 'fan') {
          const a = []; const r = 0.2, cy = 0.62;
          a.push(0, 0, 0, 0, cy - r, 0, -0.14, 0, 0, 0.14, 0, 0);
          for (let i = 0; i < 4; i++) { const an = i / 4 * TAU + 0.4; a.push(0, cy, 0, Math.cos(an) * r * 0.9, cy + Math.sin(an) * r * 0.9, 0); }
          add(g, segs(a), lineMat);
          const c = add(g, circle(r, 28), lineMat); c.rotation.x = Math.PI / 2; c.position.y = cy;
        } else {
          const a = [], y0 = 0.45, r = 0.06, L = 0.55;
          for (let i = 0; i < 6; i++) { const an = i / 6 * TAU, c = Math.cos(an) * r, s = Math.sin(an) * r; a.push(-L, y0 + c, s, L, y0 + c, s); }
          for (const xx of [-L, L]) for (let i = 0; i < 6; i++) { const a0 = i / 6 * TAU, a1 = (i + 1) / 6 * TAU; a.push(xx, y0 + Math.cos(a0) * r, Math.sin(a0) * r, xx, y0 + Math.cos(a1) * r, Math.sin(a1) * r); }
          add(g, segs(a), lineMat);
        }
        add(g, circle(0.45), faintMat).position.y = Y.select + 0.02;
        truthDefs.push({ text: 'Ground truth: ' + (x.kind === 'fan' ? 'desk fan' : 'hot water pipe'), pos: t.v3(x.pos, t.groundY + 1.0) });
      }
    }
    function setTruth(on) {
      truthOn = !!on; truth.visible = truthOn;
      if (truthOn && !truthLabels.length) for (const d of truthDefs) { const l = t.label(d.text, { tone: 'muted', priority: 2 }); l.setPosition(d.pos); truthLabels.push(l); }
      else if (!truthOn) { for (const l of truthLabels) l.remove(); truthLabels.length = 0; }
    }

    function isSelected(d) { return (selType === 'detection' && selId === d.id) || (selType === 'survivor' && selId != null && selId === d.survivorId); }

    function update(state, dt, time) {
      const fresh = watch(state), reduced = t.reduced; frame++;
      const dets = state.detections;
      for (let i = 0; i < dets.length; i++) {
        const d = dets[i]; if (!d.pos) continue;
        let v = visuals.get(d.id), born = false;
        if (!v) { v = build(d.id); visuals.set(d.id, v); born = true; }
        if (v.seen !== frame - 1) born = true;                         // back after a reset or seek
        v.seen = frame;
        const st = d.status, conf = st === 'confirmed', rej = st === 'rejected';
        const sv = d.survivorId ? state.survivors[d.survivorId] : null;
        const sigma = clamp(d.posSigma || 1, 0.3, 8), tf = conf ? 1 : 0, tc = rej ? 1 : 0, tr = sv && sv.status === 'reached' ? 1 : 0;
        const res = conf ? 1 : rej ? 0 : 0.06 + 0.6 * smoothstep(0.35, 0.9, d.p);      // how much of a body the probability allows
        if (born || fresh) { v.x = d.pos[0]; v.y = d.pos[1]; v.sigma = sigma; v.appear = fresh || rej || reduced ? 1 : 0; v.pulse = 0; v.kFig = tf; v.kCross = tc; v.reach = tr; v.kRes = fresh || reduced ? res : 0; v.kSh = rej ? 0 : 1; }
        else {
          const f = reduced ? 1e3 : 1;
          v.x = damp(v.x, d.pos[0], 3.2 * f, dt); v.y = damp(v.y, d.pos[1], 3.2 * f, dt); v.sigma = damp(v.sigma, sigma, 2.4 * f, dt); v.appear = toward(v.appear, 1, dt * f / 1.1);
          v.kFig = toward(v.kFig, tf, dt * f / 1.3); v.kCross = toward(v.kCross, tc, dt * f / 0.9); v.kSh = toward(v.kSh, rej ? 0 : 1, dt * f / 0.9); v.reach = toward(v.reach, tr, dt * f / 1.2);
          const was = v.kRes; v.kRes = damp(v.kRes, res, (conf ? 1.9 : 1.2) * f, dt); if (conf && v.kRes > 0.985) v.kRes = 1;
          if (!reduced && conf && was < 0.93 && v.kRes >= 0.93) v.pulse = 1;         // the moment it locks: one quiet pulse
        }
        v.status = st;
        if (v.pulse > 0) v.pulse = Math.max(0, v.pulse - dt / 1.5);
        const ap = v.appear * v.appear * (3 - 2 * v.appear), sel = isSelected(d), lying = !(sv && sv.motion === 'moving');
        // While it is uncertain the volume wanders inside its own error ellipse.
        const loose = reduced ? 0 : (1 - v.kRes) * Math.min(v.sigma, 2.5) * 0.42;
        v.group.visible = true; v.group.position.set(v.x, 0, -v.y);
        v.fig.position.set(loose * (Math.sin(time * 0.31 + v.bph) * 0.7 + Math.sin(time * 0.83 + v.bph * 3) * 0.3), 0, loose * (Math.cos(time * 0.27 + v.bph * 2) * 0.7 + Math.sin(time * 0.71) * 0.3));

        // error ellipse, confidence arc
        const R = lerp(v.sigma, lying ? FIG_R : 0.62, v.kFig * smoothstep(0.5, 1, v.kRes)), u = v.ringMat.uniforms, halfQ = R * 1.3 + 1.8;
        v.ring.scale.set(halfQ, 1, halfQ); u.uHalf.value = halfQ; u.uR.value = R; u.uP.value = d.p * smoothstep(0.6, 1, v.kRes); u.uConf.value = v.kFig; u.uReach.value = v.reach;
        u.uAlpha.value = ap * v.kSh * (sel ? 1 : 0.8); u.uSel.value = sel ? 1 : 0; u.uPulse.value = v.pulse;
        v.ring.visible = u.uAlpha.value > 0.004;

        // the volume
        const show = heatOn && v.kSh > 0.004; v.fig.visible = show;
        if (show) {
          setPose(v, lying);
          const vu = v.volMat.uniforms, br = reduced ? 0 : Math.sin(time * 1.55 + v.bph);
          vu.uK.value = v.kRes * v.kRes * (3 - 2 * v.kRes); vu.uAlpha.value = ap * v.kSh * lerp(0.62, 1, v.kRes); vu.uTime.value = reduced ? 1 : time % 600; vu.uBreath.value = br * 0.006 * v.kRes; vu.uCalm.value = v.reach; vu.uFlash.value = v.pulse * v.pulse; vu.uLie.value = lying ? 1 : 0;
          if (!lying && !reduced) { const sw = (1 - v.reach) * Math.sin(time * 0.62 + v.bph); v.pose.rotation.z = sw * 0.022; v.pose.position.x = sw * 0.012; }
        }
        const domeH = 1;

        // rejected: a small grey cross
        v.cross.visible = v.kCross > 0.004; v.crossMat.uniforms.uAlpha.value = v.kCross * 0.5;
        v.cross.rotation.y = 0;

        // pick volume
        const pr = conf ? (v.lying === true ? 0.95 : 0.5) : rej ? 0.4 : clamp(v.sigma, 0.5, 1.3);
        v.pick.scale.set(pr, conf ? (v.lying === true ? 0.5 : 1.8) : rej ? 0.2 : Math.min(domeH, 1.6), pr);

        // label
        const want = !rej;
        if (want !== v.labelOn) { v.labelOn = want; v.label.setVisible?.(want); if (!v.label.setVisible) v.label.el.style.visibility = want ? '' : 'hidden'; }
        if (want) {
          const sub = Math.round(d.p * 100) + ' %', text = conf ? (tr ? 'Person reached' : 'Person') : 'Possible person', tone = conf ? (tr ? 'ok' : 'person') : 'warn';
          if (text !== v.text || sub !== v.sub) {
            v.text = text; v.sub = sub;
            if (v.label.setSub) { v.label.setText(text); v.label.setSub(sub); } else v.label.setText(text + ' · ' + sub);
          }
          if (tone !== v.tone) { v.tone = tone; v.label.setTone?.(tone); v.label.setPriority?.(conf ? 8 : 5); }
          const ly = conf ? lerp(1.6, v.lying === true ? 0.75 : 1.95, v.kFig) : clamp(domeH * 0.55, 0.8, 1.35) + 0.5;
          v.lp.set(v.x, t.groundY + ly, -v.y); v.label.setPosition(v.lp);
          v.label.setSelected?.(sel);
        }
      }
      // anything not in this state (after a reset or seek) disappears at once
      if (visuals.size !== dets.length || fresh) for (const v of visuals.values()) if (v.seen !== frame && v.group.visible) { v.group.visible = false; v.labelOn = false; v.label.setVisible?.(false); if (!v.label.setVisible) v.label.el.style.visibility = 'hidden'; v.status = ''; }
    }
    const watch = stateWatcher();

    return {
      update,
      setLayer(id, on) { if (id === 'heat') heatOn = !!on; else if (id === 'truth') setTruth(on); },
      onSelect(sel) { selType = sel ? sel.type : null; selId = sel ? sel.id : null; },
      dispose() {
        for (const v of visuals.values()) v.label.remove();
        visuals.clear(); for (const l of truthLabels) l.remove(); truthLabels.length = 0;
        disposeTree(root); quad.dispose(); volGeo.dispose(); crossGeo.dispose(); pickGeo.dispose(); pickMat.dispose();
      },
    };
  },
};
