// Sensing: what the rover senses, drawn only while it is sensing (a 10 s Wi-Fi window in progress).
//   a) Wi-Fi waves leave the mast. They light the walls they pass and weaken at every wall they cross
//   b) a person already suspected or found scatters them: the floor shows the scattered wave leaving the body, and
//      a bundle of threads (subcarriers) carries the disturbed signal back to the receiver
//   c) when a reading lands, one bright return runs from each detection it touched to the mast
//   d) radar and thermal fields of view with the last reading at this stop (Advanced mode only)
// Everything is simulated. Display conventions: waves are drawn at 4 times the real 12.5 cm wavelength and very
// slowly; scattering is drawn only from detections the sensors have already made.
import { palette, Y, clamp, damp, stateWatcher, ringGeometry, decalMaterial, disposeTree, mulberry32 } from './common.js';

const ROVER = 'HOUND-01';
const MAST_H = 0.74, MAST_BACK = 0.2, CAM_H = 0.46, CAM_FWD = 0.15;   // antennas behind the centre, thermal camera on the sweep bridge
const TAU = Math.PI * 2;

const WIFI_VERT = /* glsl */ `
varying vec2 vP;
void main() { vP = vec2(position.x, -position.z); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const WIFI_FRAG = /* glsl */ `
uniform vec3 uColor, uWarm; uniform float uVis, uPhase, uRange, uFront, uProgress, uAtten;
uniform vec4 uWalls[MAXW]; uniform int uCount; uniform vec2 uMast; uniform vec4 uDet[4];       // det: x, y, strength, locked
varying vec2 vP;
float gs(float x) { return exp(-x * x); }
float crossings(vec2 o, vec2 p) {
  float n = 0.0; vec2 r = p - o;
  for (int i = 0; i < MAXW; i++) {
    if (i >= uCount) break;
    vec2 a = uWalls[i].xy - o, s = uWalls[i].zw - uWalls[i].xy;
    float den = r.x * s.y - r.y * s.x;
    if (abs(den) < 1e-6) continue;
    float tt = (a.x * s.y - a.y * s.x) / den, u = (a.x * r.y - a.y * r.x) / den;
    if (tt > 0.0 && tt < 1.0 && u > 0.0 && u < 1.0) n += 1.0;
  }
  return n;
}
void main() {
  vec2 q = vP - uMast; float d = length(q);
  if (d > uRange + 0.3 || d > uFront + 0.2) discard;
  float n = crossings(uMast, vP), att = exp(-0.8 * n), k = 6.2831853 / 0.5, w = 6.2831853 * uPhase;
  float env = exp(-d / (uRange * 0.5)) * smoothstep(uRange, uRange * 0.55, d) * smoothstep(0.25, 0.8, d);
  float fw = fwidth(d), far = smoothstep(0.2, 0.05, fw);
  float crest = pow(0.5 + 0.5 * cos(k * d - w) + 1e-4, 14.0), carrier = 0.6 + 0.4 * cos(k * 5.0 * d - w * 2.0);
  float cool = (crest * carrier * 0.3 * far + 0.04) * env * att;
  // the scattered wave: a second, warmer set of crests that starts at the body when the direct wave reaches it, torn by its motion
  float warm = 0.0;
  for (int i = 0; i < 4; i++) {
    float sA = uDet[i].z; if (sA <= 0.002) continue;
    vec2 c = vP - uDet[i].xy; float r = length(c), D = length(uDet[i].xy - uMast);
    float tear = 0.75 + 0.25 * sin(atan(c.y, c.x) * 9.0 + sin(w * 0.35) * 2.0 + r * 4.0);
    float cs = pow(0.5 + 0.5 * cos(k * 1.15 * r - w) + 1e-4, 16.0) * tear * mix(1.0, 0.25, far < 0.2 ? 1.0 : 0.0);
    warm += sA * smoothstep(D - 0.5, D + 0.5, uFront - 0.6) * exp(-r / 1.1) * smoothstep(0.2, 0.7, r) * (cs * 0.42 * far + 0.03);
  }
  float front = gs((d - uFront) * 6.0) * step(d, uRange) * (0.35 + 0.65 * att) * smoothstep(uRange + 0.4, uRange * 0.5, uFront);
  float a = cool + warm + front * 0.3;
  gl_FragColor = vec4((uColor * 0.8 * (cool + front * 0.3) + uWarm * warm) / max(a, 1e-4), clamp(a, 0.0, 0.6) * uVis);
}`;

// The same waves where they meet the walls of block B. (twin-core turns the walls near a listening rover to glass;
// this only adds the light of the passing wavefronts to them.)
const GLASS_VERT = /* glsl */ `
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const GLASS_FRAG = /* glsl */ `
uniform vec3 uColor, uC; uniform float uRange, uVis, uPhase, uFront;
varying vec3 vW;
float gs(float x) { return exp(-x * x); }
void main() {
  float d3 = distance(vW, uC); if (d3 > uRange || d3 > uFront + 0.8) discard;
  float c = 0.5 + 0.5 * cos(6.2831853 * (d3 / 0.5 - uPhase));
  float wave = pow(clamp(c, 0.0, 1.0) + 1e-5, 12.0) * exp(-d3 / 3.2) * smoothstep(0.2, 0.05, fwidth(d3));
  float front = gs((d3 - uFront) * 5.0) * smoothstep(uRange + 0.4, uRange * 0.5, uFront);
  float a = (wave * 0.3 + front * 0.34) * smoothstep(uRange, uRange * 0.6, d3); if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * 0.85, clamp(a, 0.0, 0.6) * uVis);
}`;

const RADAR_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RADAR_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uVis, uR0, uR1, uFov, uSweep, uDir, uSweepOn;
varying vec2 vUv;
void main() {
  float r = mix(uR0, uR1, vUv.y), aa = fwidth(r), w = max(0.014, aa * 0.7);
  float edgeFade = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
  float a = 0.07 * (1.0 - 0.65 * vUv.y) * edgeFade;                       // soft fill, strongest near the radar
  float m = mod(r, 2.0), dm = min(m, 2.0 - m);                              // range arcs every 2 m
  a += (1.0 - smoothstep(w * 0.5, w * 1.6, dm)) * step(1.0, r) * 0.34;
  float side = min(vUv.x, 1.0 - vUv.x) * uFov * r;                          // the two edges of the field of view
  a += (1.0 - smoothstep(w * 0.5, w * 1.6, side)) * 0.30 * (1.0 - 0.5 * vUv.y);
  float da = (vUv.x - uSweep) * uFov;                                       // sweep line with a short trail behind it
  float lineD = abs(da) * r;
  float sweep = (1.0 - smoothstep(w * 0.6, w * 2.0, lineD)) * 0.7;
  float behind = max(0.0, -da * uDir);
  sweep += exp(-behind * 9.0) * step(0.0, -da * uDir) * 0.16;
  a += sweep * uSweepOn * (1.0 - 0.45 * vUv.y);
  a *= smoothstep(uR0, uR0 + 0.35, r);
  gl_FragColor = vec4(uColor, a * uVis);
  #include <colorspace_fragment>
}`;

// One small ground quad, three looks: 0 = moving target, 1 = periodic (machine-like) target, 2 = ring burst.
const BLIP_VERT = /* glsl */ `
varying vec2 vP;
void main() { vP = vec2(position.x, -position.z); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BLIP_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uVis, uKind, uAge, uSpin;
varying vec2 vP;
float band(float d, float w) { return 1.0 - smoothstep(w * 0.5, w * 1.6, abs(d)); }
void main() {
  float r = length(vP), aa = fwidth(r), w = max(0.02, aa * 0.9), a = 0.0;
  if (uKind < 0.5) {
    float k = clamp(uAge / 0.7, 0.0, 1.0), e = 1.0 - pow(1.0 - k, 3.0);
    a = (1.0 - smoothstep(0.07, 0.07 + max(0.03, aa), r)) * 0.95;           // solid core
    a += band(r - 0.24, w) * 0.75;                                           // fixed ring
    a += band(r - mix(0.24, 0.62, e), w) * (1.0 - k) * 0.6;                  // one ping when it appears
    a += (1.0 - smoothstep(0.0, 0.45, r)) * 0.10;
  } else if (uKind < 1.5) {
    float ang = atan(vP.y, vP.x) + uSpin;
    float dash = smoothstep(0.42, 0.5, abs(fract(ang / 6.2831853 * 6.0) - 0.5) * 2.0 * 0.5 + 0.25);
    a = band(r - 0.24, w * 1.3) * dash * 0.8;                                // toothed ring: a steady, repeating motion
    a += band(r - 0.11, w) * 0.5;
  } else {
    float k = clamp(uAge, 0.0, 1.0), e = 1.0 - pow(1.0 - k, 2.5);
    a = band(r - mix(0.15, 0.92, e), w * 1.2) * (1.0 - k) * (1.0 - k) * 0.9;
    a += band(r - mix(0.1, 0.55, e), w) * (1.0 - k) * 0.35;
  }
  gl_FragColor = vec4(uColor * 1.05, a * 0.75 * uVis);
  #include <colorspace_fragment>
}`;

// Threads: a bundle of thin camera-facing strands per detection, calm on the way out, rippled on the way back.
const THREAD_VERT = /* glsl */ `
attribute vec4 aS;                                     // detection, strand -1..1, direction (0 out, 1 back), seed
uniform vec3 uA, uB[4]; uniform vec4 uAmp[4];          // amp: strength, cycle 0..1, landing flash, locked
uniform float uT, uLen;
varying float vU; varying float vDir; varying float vA; varying float vCyc; varying float vFl; varying float vS;
vec3 at(float u, vec3 B, float s, float dir, float k, float seed) {
  vec3 p = mix(uA, B, u), ax = (B - uA) / max(distance(uA, B), 1e-3), up0 = vec3(0.0, 1.0, 0.0) - ax * ax.y, up = up0 / max(length(up0), 1e-4), sd = cross(ax, up);
  float L = distance(uA, B), env = sin(3.14159 * u);
  p.y += env * (0.1 + 0.02 * L) * (dir > 0.5 ? 1.0 : -0.2);
  float calm = sin(u * L * 7.0 - uT * 5.0 + s * 1.4) * 0.016;
  float rip = (sin(u * L * 5.0 + uT * 4.0 + s * 5.0 + seed) * 0.05 + sin(u * L * 13.0 + uT * 7.0 - s * 9.0) * 0.02) * k * (0.6 + 0.4 * sin(uT * 1.55));
  p += up * (s * (0.05 + 0.12 * env) + (dir > 0.5 ? rip : calm) * env) + sd * (cos(s * 4.0) * 0.07 * env + (dir > 0.5 ? rip : calm) * 0.5 * env);
  return p;
}
void main() {
  int i = int(aS.x + 0.5); vec3 B = uB[i]; vec4 am = uAmp[i]; float u = position.x;
  vec3 p = at(u, B, aS.y, aS.z, am.x, aS.w), p2 = at(u + 0.01, B, aS.y, aS.z, am.x, aS.w);
  vec3 toCam = cameraPosition - p; float wd = max(0.0032, length(toCam) * 0.00062) * (1.0 + 0.8 * am.z);
  vec3 sv = cross(p2 - p, toCam); p += sv / max(length(sv), 1e-6) * position.y * 2.0 * wd;
  vU = u; vDir = aS.z; vA = am.x * step(0.001, am.x); vCyc = am.y; vFl = am.z; vS = aS.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const THREAD_FRAG = /* glsl */ `
uniform vec3 uColor, uWarm; uniform float uVis;
varying float vU; varying float vDir; varying float vA; varying float vCyc; varying float vFl; varying float vS;
float gs(float x) { return exp(-x * x); }
void main() {
  if (vA < 0.002) discard;
  float lag = abs(vS) * 0.05, out1 = clamp((vCyc - lag) / 0.36, 0.0, 1.0), back = clamp((vCyc - 0.4 - lag) / 0.42, 0.0, 1.0);
  float headO = mix(-0.1, 1.15, out1), headB = mix(1.15, -0.15, back), h = vDir < 0.5 ? headO : headB;
  float on = vDir < 0.5 ? step(0.001, out1) * step(out1, 0.999) : step(0.001, back) * step(back, 0.999);
  float beh = vDir < 0.5 ? h - vU : vU - h;                                      // distance behind the head
  float pulse = (step(0.0, beh) * exp(-beh * 4.5) + gs(beh * 34.0) * 0.8) * on;
  float base = (vDir > 0.5 ? 0.24 : 0.06) * vA;
  float ends = smoothstep(0.0, 0.03, vU) * smoothstep(1.0, 0.97, vU);
  vec3 c = vDir < 0.5 ? uColor : mix(uColor, uWarm, 0.35 + 0.5 * vU);
  float g = pulse * (vDir > 0.5 ? 1.0 : 0.55) * (0.5 + 0.5 * vA) * (1.0 + 0.8 * vFl);
  gl_FragColor = vec4(c * (0.85 + 0.75 * g), clamp(base + g * 0.8, 0.0, 1.0) * ends * uVis);
}`;

// The thermal image, projected from the camera onto whatever each pixel's ray lands on (wall or floor).
const THERM_VERT = /* glsl */ `
attribute float aSurf;
varying vec3 vW; varying float vSurf;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vSurf = aSurf; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const THERM_FRAG = /* glsl */ `
uniform sampler2D uTex; uniform vec3 uCam; uniform float uHeading, uFov, uVfov, uVis;
varying vec3 vW; varying float vSurf;
void main() {
  vec3 rel = vW - uCam;
  vec3 fwd = vec3(cos(uHeading), 0.0, -sin(uHeading)), lft = vec3(-sin(uHeading), 0.0, -cos(uHeading));
  float az = atan(dot(rel, lft), dot(rel, fwd)), el = atan(rel.y, length(rel.xz));
  vec2 uv = vec2(0.5 + az / uFov, 0.5 + el / uVfov);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  vec4 tx = texture2D(uTex, uv);
  vec2 g = fract(uv * vec2(32.0, 24.0)), fw = fwidth(uv * vec2(32.0, 24.0));
  vec2 e = smoothstep(vec2(0.0), fw * 1.2 + 0.03, g) * smoothstep(vec2(0.0), fw * 1.2 + 0.03, 1.0 - g);
  float cell = mix(0.55, 1.0, e.x * e.y);                                  // visible pixels
  float a = tx.a * cell * mix(0.5, 1.0, vSurf);
  gl_FragColor = vec4(tx.rgb, a * uVis);
  #include <colorspace_fragment>
}`;

function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
// Distance along the ray o + t (dx, dy) to segment a-b, or Infinity.
function raySeg(ox, oy, dx, dy, a, b) {
  const sx = b[0] - a[0], sy = b[1] - a[1], den = dx * sy - dy * sx;
  if (Math.abs(den) < 1e-9) return Infinity;
  const ax = a[0] - ox, ay = a[1] - oy, tt = (ax * sy - ay * sx) / den, u = (ax * dy - ay * dx) / den;
  return tt > 0 && u >= 0 && u <= 1 ? tt : Infinity;
}
function distSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const k = l2 ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (a[0] + dx * k), py - (a[1] + dy * k));
}

export default {
  id: 'sensing',
  layers: ['sensing'],
  create(t) {
    const { THREE, world } = t, pal = palette(t), S = world.SENSORS;
    const low = t.quality === 'low';
    const RANGE = S.csi.range;
    const R_FOV = S.radar.fovDeg * Math.PI / 180, R_RANGE = S.radar.range;
    const T_FOV = S.thermal.fovDeg * Math.PI / 180, T_RANGE = S.thermal.range, PX = S.thermal.px[0], PY = S.thermal.px[1];
    const T_VFOV = T_FOV * PY / PX, T_STEP = T_FOV / PX;
    const MAXW = low ? 14 : 28;
    const wallH = world.BUILDING.wallHeight;
    // Everything a thermal ray can stop on: standing walls, and obstacles tall enough to block the view.
    const blockers = [];
    for (const w of world.WALLS) if (w.state !== 'collapsed') blockers.push({ a: w.a, b: w.b, h: w.h || wallH });
    for (const o of world.OBSTACLES) if (o.h >= 1.2) for (let i = 0; i < o.poly.length; i++) blockers.push({ a: o.poly[i], b: o.poly[(i + 1) % o.poly.length], h: o.h });

    const root = new THREE.Group(); root.name = 'sensing'; root.visible = false; t.scene.add(root);
    const fx = new THREE.Group(); fx.name = 'sensing-pulses'; fx.visible = false; t.scene.add(fx);
    const vis = { value: 0 }, visAdv = { value: 0 }, uPhase = { value: 0 }, uFront = { value: 0 };

    // a) Wi-Fi wavefronts
    const walls = Array.from({ length: MAXW }, () => new THREE.Vector4());
    const half = RANGE + 0.3;
    const dets = Array.from({ length: 4 }, () => new THREE.Vector4());
    const wifiMat = decalMaterial(THREE, { defines: { MAXW }, vertexShader: WIFI_VERT, fragmentShader: WIFI_FRAG,
      uniforms: { uColor: { value: pal.scan }, uWarm: { value: pal.person }, uVis: vis, uPhase, uFront, uRange: { value: RANGE }, uProgress: { value: 0 }, uAtten: { value: 0.45 }, uWalls: { value: walls }, uCount: { value: 0 }, uMast: { value: new THREE.Vector2() }, uDet: { value: dets } } });
    const wifi = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2).rotateX(-Math.PI / 2), wifiMat);
    wifi.position.y = Y.ring + 0.006; wifi.renderOrder = 7; wifi.frustumCulled = false; root.add(wifi);

    // wavefronts crossing the walls: the walls' own geometry, borrowed by name
    const gC = { value: new THREE.Vector3(0, -99, 0) }, glass = new THREE.Group(); glass.name = 'sensing-walls'; glass.visible = false; t.scene.add(glass);
    const glassMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG,
      uniforms: { uColor: { value: pal.scan }, uC: gC, uVis: vis, uPhase, uFront, uRange: { value: RANGE } } });
    let wallsFound = false;
    function findWalls() {
      if (wallsFound) return; wallsFound = true;
      t.scene.traverse((o) => { if (!o.isMesh || !/^walls-(plaster|inner)$/.test(o.name)) return; const g = new THREE.Mesh(o.geometry, glassMat); g.matrixAutoUpdate = false; o.updateWorldMatrix(true, false); g.matrix.copy(o.matrixWorld); g.renderOrder = 8; g.raycast = () => {}; glass.userData.list = (glass.userData.list || []).concat(g); });
      for (const g of glass.userData.list || []) glass.add(g);
    }

    // b) radar
    const R0 = 0.3;
    const radarMat = decalMaterial(THREE, { vertexShader: RADAR_VERT, fragmentShader: RADAR_FRAG,
      uniforms: { uColor: { value: pal.scan }, uVis: visAdv, uR0: { value: R0 }, uR1: { value: R_RANGE }, uFov: { value: R_FOV }, uSweep: { value: 0.5 }, uDir: { value: 1 }, uSweepOn: { value: 1 } } });
    const radar = new THREE.Mesh(ringGeometry(THREE, R0, R_RANGE, low ? 24 : 64, -R_FOV / 2, R_FOV), radarMat);
    radar.position.y = Y.ring + 0.003; radar.renderOrder = 7; radar.frustumCulled = false; root.add(radar);

    const quad = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const mkBlip = (parent, kind) => {
      const mat = decalMaterial(THREE, { depthTest: false, vertexShader: BLIP_VERT, fragmentShader: BLIP_FRAG,
        uniforms: { uColor: { value: pal.scan }, uVis: { value: 1 }, uKind: { value: kind }, uAge: { value: 9 }, uSpin: { value: 0 } } });
      const m = new THREE.Mesh(quad, mat); m.renderOrder = 30; m.visible = false; m.frustumCulled = false; parent.add(m); return m;
    };
    const BLIPS = 4, blipGroup = new THREE.Group(); t.scene.add(blipGroup); blipGroup.visible = false;
    const blips = Array.from({ length: BLIPS }, () => mkBlip(blipGroup, 0));

    // c) thermal
    const N_V = PX * 7, tPos = new Float32Array(N_V * 3), tSurf = new Float32Array(N_V), tIdx = [];
    for (let i = 0; i < PX; i++) { const k = i * 7; tIdx.push(k, k + 1, k + 2, k, k + 2, k + 3, k + 4, k + 5, k + 6); tSurf.set([1, 1, 1, 1, 0, 0, 0], k); }
    const thermGeo = new THREE.BufferGeometry();
    thermGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3)); thermGeo.setAttribute('aSurf', new THREE.BufferAttribute(tSurf, 1)); thermGeo.setIndex(tIdx);
    const tData = new Uint8Array(PX * PY * 4);
    const tTex = new THREE.DataTexture(tData, PX, PY, THREE.RGBAFormat); tTex.magFilter = tTex.minFilter = THREE.NearestFilter; tTex.colorSpace = THREE.SRGBColorSpace; tTex.needsUpdate = true;
    const camW = new THREE.Vector3();
    const thermMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, vertexShader: THERM_VERT, fragmentShader: THERM_FRAG,
      uniforms: { uTex: { value: tTex }, uCam: { value: camW }, uHeading: { value: 0 }, uFov: { value: T_FOV }, uVfov: { value: T_VFOV }, uVis: visAdv } });
    const therm = new THREE.Mesh(thermGeo, thermMat); therm.frustumCulled = false; therm.renderOrder = 9; root.add(therm);
    const N_L = (4 + 2 * (PX * 2 - 1)) * 2, lPos = new Float32Array(N_L * 3);
    const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3));
    const lineMat = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }); lineMat.color = pal.scan;
    const dashMat = new THREE.LineDashedMaterial({ transparent: true, depthWrite: false, toneMapped: false, opacity: 0, dashSize: 0.16, gapSize: 0.14 }); dashMat.color = pal.warn;
    const lines = new THREE.LineSegments(lineGeo, lineMat); lines.frustumCulled = false; lines.renderOrder = 10; root.add(lines);
    const ramp = pal.heat.map(hexRgb);
    const rampAt = (v, out, o) => { const x = clamp(v, 0, 1) * (ramp.length - 1), i = Math.min(ramp.length - 2, Math.floor(x)), k = x - i, a = ramp[i], b = ramp[i + 1]; out[o] = a[0] + (b[0] - a[0]) * k; out[o + 1] = a[1] + (b[1] - a[1]) * k; out[o + 2] = a[2] + (b[2] - a[2]) * k; };
    const heatOf = (c) => clamp((c - 17) / 23, 0, 1);       // 17 C = bottom of the ramp, 40 C and above = top
    function paintThermal(th, show, heading, seed) {
      const rng = mulberry32(seed), amb = heatOf(th && th.ok ? th.ambientC : 19.5);
      const bl = [];
      if (show && th && th.ok) for (const b of th.blobs) {
        let az = (b.bearing - heading) % TAU; if (az > Math.PI) az -= TAU; else if (az < -Math.PI) az += TAU;
        // The simulator does not model the camera's field of view: a blob outside it is drawn at the nearest edge.
        az = clamp(az, -T_FOV / 2 + 1.5 * T_STEP, T_FOV / 2 - 1.5 * T_STEP);
        bl.push({ x: (0.5 + az / T_FOV) * PX - 0.5, y: (0.5 + Math.atan2(0.5 - CAM_H, b.dist) / T_VFOV) * PY - 0.5, s: Math.max(1.5, Math.atan2(0.34, b.dist) / T_STEP), v: heatOf(b.tempC) });
      }
      for (let j = 0; j < PY; j++) for (let i = 0; i < PX; i++) {
        let v = amb + (rng() - 0.5) * 0.07 + 0.03 * (1 - j / PY);          // cool noise, floor a touch warmer
        for (const b of bl) { const dx = i - b.x, dy = (j - b.y) * 0.8, g = Math.exp(-(dx * dx + dy * dy) / (2 * b.s * b.s)); v = Math.max(v, amb + (b.v - amb) * g + (rng() - 0.5) * 0.03); }
        const o = (j * PX + i) * 4; rampAt(v, tData, o);
        tData[o + 3] = 255 * (0.26 + 0.66 * clamp((v - amb - 0.03) / 0.22, 0, 1));
      }
      tTex.needsUpdate = true;
    }

    // threads
    const STR = low ? 5 : 9, NT = 4 * STR * 2, tg0 = new THREE.PlaneGeometry(1, 1, low ? 28 : 56, 1).translate(0.5, 0, 0), threadGeo = new THREE.InstancedBufferGeometry();
    threadGeo.index = tg0.index; threadGeo.setAttribute('position', tg0.attributes.position);
    { const a = new Float32Array(NT * 4); let k = 0; for (let d = 0; d < 4; d++) for (let dir = 0; dir < 2; dir++) for (let s = 0; s < STR; s++) { a.set([d, STR > 1 ? (s / (STR - 1)) * 2 - 1 : 0, dir, (d * 7 + s * 3.7) % 6.28], k * 4); k++; } threadGeo.setAttribute('aS', new THREE.InstancedBufferAttribute(a, 4)); threadGeo.instanceCount = NT; }
    const tA = new THREE.Vector3(), tB = Array.from({ length: 4 }, () => new THREE.Vector3()), tAmp = Array.from({ length: 4 }, () => new THREE.Vector4());
    const threadMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, vertexShader: THREAD_VERT, fragmentShader: THREAD_FRAG,
      uniforms: { uColor: { value: pal.scan }, uWarm: { value: pal.person }, uVis: { value: 1 }, uA: { value: tA }, uB: { value: tB }, uAmp: { value: tAmp }, uT: { value: 0 }, uLen: { value: 1 } } });
    const threads = new THREE.Mesh(threadGeo, threadMat); threads.frustumCulled = false; threads.renderOrder = 23; fx.add(threads);
    const slots = [null, null, null, null], amp = [0, 0, 0, 0], flash = [-1, -1, -1, -1];

    // ---------- state ----------
    const watch = stateWatcher();
    let layerOn = true, level = 0, hold = 0, phase = 0, sweepT = 0, lastProg = -1, lastWin = -1, front = 0, cyc = 0, tClock = 0, adv = 1;
    let lastAt = null, curStop = null, placedKey = '', resultKey = '', belongs = false, resultAge = 9, fault = false, nBlips = 0;
    const rp = [0, 0]; let rh = 0;

    function place(pos, heading) {
      rp[0] = pos[0]; rp[1] = pos[1]; rh = heading;
      root.position.set(pos[0], t.groundY, -pos[1]);
      const mx = -Math.cos(heading) * MAST_BACK, my = -Math.sin(heading) * MAST_BACK;
      wifiMat.uniforms.uMast.value.set(mx, my); gC.value.set(pos[0] + mx, t.groundY + MAST_H, -(pos[1] + my)); tA.copy(gC.value);
      radar.rotation.y = heading;
      // walls near enough to matter to the Wi-Fi rings, nearest first
      const near = [];
      for (const w of world.WALLS) { if (w.state === 'collapsed') continue; const d = distSeg(pos[0], pos[1], w.a, w.b); if (d <= RANGE + 0.5) near.push([d, w]); }
      near.sort((a, b) => a[0] - b[0]);
      const n = Math.min(MAXW, near.length);
      for (let i = 0; i < n; i++) { const w = near[i][1]; walls[i].set(w.a[0] - pos[0], w.a[1] - pos[1], w.b[0] - pos[0], w.b[1] - pos[1]); }
      wifiMat.uniforms.uCount.value = n;
      // thermal: where each column's two edge rays stop
      const cx = pos[0] + Math.cos(heading) * CAM_FWD, cy = pos[1] + Math.sin(heading) * CAM_FWD;
      camW.set(cx, t.groundY + CAM_H, -cy); thermMat.uniforms.uHeading.value = heading;
      const lx = cx - pos[0], lz = -(cy - pos[1]), eps = T_STEP * 0.02, tanV = Math.tan(T_VFOV / 2), fy = Y.ring + 0.009;
      let li = 0;
      const seg = (x0, y0, z0, x1, y1, z1) => { lPos[li++] = x0; lPos[li++] = y0; lPos[li++] = z0; lPos[li++] = x1; lPos[li++] = y1; lPos[li++] = z1; };
      const hit = (ang, out) => {
        const dx = Math.cos(ang), dy = Math.sin(ang); let best = T_RANGE, h = 2.4;
        for (const b of blockers) { const d = raySeg(cx, cy, dx, dy, b.a, b.b); if (d < best) { best = d; h = b.h; } }
        const d = Math.max(0.35, best - 0.1);
        out[0] = lx + dx * d; out[1] = lz - dy * d; out[2] = Math.max(0.3, Math.min(h, CAM_H + d * tanV));
      };
      const L = [0, 0, 0], Rr = [0, 0, 0], prev = [0, 0, 0];
      for (let i = 0; i < PX; i++) {
        hit(heading + T_FOV / 2 - i * T_STEP - eps, L); hit(heading + T_FOV / 2 - (i + 1) * T_STEP + eps, Rr);
        const k = i * 21;
        tPos.set([L[0], 0.03, L[1], Rr[0], 0.03, Rr[1], Rr[0], Rr[2], Rr[1], L[0], L[2], L[1], lx, fy, lz, L[0], fy, L[1], Rr[0], fy, Rr[1]], k);
        if (i === 0) { seg(lx, CAM_H, lz, L[0], 0.03, L[1]); seg(lx, CAM_H, lz, L[0], L[2], L[1]); }
        else { seg(prev[0], prev[2], prev[1], L[0], L[2], L[1]); seg(prev[0], 0.03, prev[1], L[0], 0.03, L[1]); }
        seg(L[0], L[2], L[1], Rr[0], Rr[2], Rr[1]); seg(L[0], 0.03, L[1], Rr[0], 0.03, Rr[1]);
        if (i === PX - 1) { seg(lx, CAM_H, lz, Rr[0], 0.03, Rr[1]); seg(lx, CAM_H, lz, Rr[0], Rr[2], Rr[1]); }
        prev[0] = Rr[0]; prev[1] = Rr[1]; prev[2] = Rr[2];
      }
      thermGeo.attributes.position.needsUpdate = true; lineGeo.attributes.position.needsUpdate = true;
      lines.computeLineDistances();
    }

    function showResults(state, instant) {
      const sn = state.sensors, th = sn.thermal;
      paintThermal(th, belongs, rh, hashStr(curStop || ''));
      nBlips = 0;
      const tg = belongs && sn.radar && sn.radar.targets ? sn.radar.targets : [];
      for (let i = 0; i < BLIPS; i++) {
        const b = blips[i], tr = tg[i];
        b.visible = !!tr; if (!tr) continue;
        b.position.set(tr.pos[0], t.groundY + Y.select + 0.012, -tr.pos[1]);
        b.material.uniforms.uKind.value = tr.kind === 'periodic' ? 1 : 0; nBlips++;
      }
      resultAge = instant ? 9 : 0;
    }

    // The detections whose echo is drawn: the ones already made, not rejected, within the sensor's reach of this stop.
    function pickDets(state) {
      for (let k = 0; k < 4; k++) if (slots[k]) { const d = state.detections.find((x) => x.id === slots[k]); if (!d || !d.pos || d.status === 'rejected' || !reach(d.pos)) slots[k] = null; }
      for (const d of state.detections) { if (!d.pos || d.status === 'rejected' || slots.includes(d.id) || !reach(d.pos)) continue; const k = slots.indexOf(null); if (k >= 0) slots[k] = d.id; }
    }
    const pa = [0, 0], reach = (p) => { pa[0] = p[0]; pa[1] = p[1]; return Math.hypot(p[0] - rp[0], p[1] - rp[1]) <= RANGE && world.wallsCrossed(rp, pa).length <= S.csi.maxWalls; };
    function land(state) {                                       // one bright return per detection this reading touched
      const at = state.sensors.at; pickDets(state); cyc = 0.38;
      for (let k = 0; k < 4; k++) { const d = slots[k] && state.detections.find((x) => x.id === slots[k]); flash[k] = d && d.updated === at && d.evidence.length && d.evidence[d.evidence.length - 1].t === at ? 0 : -1; }
    }

    function update(state, dt) {
      const fresh = watch(state), sn = state.sensors, L = sn.listen, rover = state.units[ROVER], reduced = t.reduced, demo = t.ctx.mode === 'demo';
      if (fresh) { lastAt = sn.at; level = L ? 1 : 0; front = L ? RANGE + 1 : 0; hold = 0; belongs = false; resultKey = ''; lastProg = L ? L.progress : -1; lastWin = L ? L.window : -1; slots.fill(null); amp.fill(0); flash.fill(-1); placedKey = ''; if (!L) curStop = null; }
      adv = damp(adv, demo ? 0 : 1, 6, dt);
      let landed = false;
      if (sn.at !== lastAt) { lastAt = sn.at; landed = !fresh && sn.stop === curStop && level > 0; if (landed) belongs = true; }
      let moving = false;
      if (L && rover) {
        const key = L.stop + '|' + rover.pos[0].toFixed(2) + '|' + rover.pos[1].toFixed(2) + '|' + rover.heading.toFixed(2);
        if (key !== placedKey) { placedKey = key; curStop = L.stop; place(rover.pos, rover.heading); resultKey = ''; slots.fill(null); pickDets(state); if (level < 0.05) { front = reduced ? RANGE + 1 : 0; cyc = 0; } }
        if (!landed) belongs = sn.stop === L.stop && sn.at != null && (L.window > 1 || sn.at >= state.t - L.progress * L.dur - 0.5);
        hold = 0.6; level = reduced ? 1 : Math.min(1, level + dt / 0.9);
        // the waves move only while the window is really advancing (not when paused, held or the link is down)
        moving = (L.progress !== lastProg || L.window !== lastWin) && !reduced;
        if (L.window !== lastWin && lastWin >= 0 && !reduced) front = 0;                                       // a new window: a new sweep
        lastProg = L.progress; lastWin = L.window;
      } else if (level > 0) {
        if (hold > 0) hold -= dt; else level = reduced ? 0 : Math.max(0, level - dt / 1.1);
        moving = level > 0 && !reduced; if (level === 0) { front = 0; lastWin = -1; }
      }
      if (moving) { phase += dt * 1.15; sweepT += dt; tClock += dt; cyc += dt / 2.8; if (cyc >= 1) { cyc -= 1; pickDets(state); } front = Math.min(RANGE + 1, front + dt * 2.6); }
      if (landed) land(state);
      const on = layerOn && level > 0;
      root.visible = on; blipGroup.visible = on && adv > 0.02; glass.visible = on; fx.visible = on;
      const k = level * level * (3 - 2 * level);
      if (on) {
        findWalls(); vis.value = k; visAdv.value = k * adv * 0.45;
        radar.visible = adv > 0.02;
        const rk = (curStop || '') + '|' + sn.at + '|' + belongs + '|' + placedKey;
        if (rk !== resultKey) { resultKey = rk; showResults(state, fresh || reduced || !landed); }
        fault = !!(state.faults && state.faults.thermalFail) || (belongs && sn.thermal && sn.thermal.ok === false);
        therm.visible = !fault && adv > 0.02; lines.visible = adv > 0.02;
        lines.material = fault ? dashMat : lineMat; lines.material.opacity = (fault ? 0.5 : 0.14) * k * adv;
        uPhase.value = phase % 64; uFront.value = front; wifiMat.uniforms.uProgress.value = L ? L.progress : 1;
        const s = Math.sin(sweepT * 0.55); radarMat.uniforms.uSweepOn.value = reduced ? 0 : 1; radarMat.uniforms.uSweep.value = 0.5 + 0.47 * s; radarMat.uniforms.uDir.value = Math.cos(sweepT * 0.55) >= 0 ? 1 : -1;
        if (nBlips) { resultAge += dt; for (let i = 0; i < BLIPS; i++) { const b = blips[i]; if (!b.visible) continue; const u = b.material.uniforms; u.uVis.value = k * adv; u.uAge.value = resultAge; if (!reduced) u.uSpin.value = phase * 0.8; } }
        threadMat.uniforms.uT.value = reduced ? 1 : tClock % 400; threadMat.uniforms.uVis.value = k;
        for (let i = 0; i < 4; i++) {
          let d = null; if (slots[i]) for (let n = 0; n < state.detections.length; n++) if (state.detections[n].id === slots[i]) { d = state.detections[n]; break; }
          const reached = d && front > Math.hypot(d.pos[0] - rp[0], d.pos[1] - rp[1]) - 0.3, want = d && reached ? clamp(0.25 + 0.8 * d.p, 0, 1) : 0;
          amp[i] = fresh || reduced ? want : damp(amp[i], want, 3, dt);
          if (flash[i] >= 0) { flash[i] += dt / 2.2; if (flash[i] > 1) flash[i] = -1; }
          if (d) { dets[i].set(d.pos[0] - rp[0], d.pos[1] - rp[1], amp[i], d.status === 'confirmed' ? 1 : 0); tB[i].set(d.pos[0], t.groundY + 0.28, -d.pos[1]); } else dets[i].z = amp[i];
          tAmp[i].set(amp[i] < 0.004 ? 0 : amp[i], cyc, flash[i] >= 0 && !reduced ? 1 - flash[i] : 0, 0);
        }
      }
    }

    return {
      update,
      setLayer(id, on) { if (id === 'sensing') { layerOn = !!on; if (!on) { root.visible = blipGroup.visible = glass.visible = fx.visible = false; } } },
      onSelect() {},
      dispose() {
        glass.parent?.remove(glass); glassMat.dispose(); tg0.dispose();       // the glass borrows the walls' own geometry: do not dispose it
        disposeTree(root); disposeTree(fx); disposeTree(blipGroup); quad.dispose(); tTex.dispose(); lineMat.dispose(); dashMat.dispose();
      },
    };
  },
};
