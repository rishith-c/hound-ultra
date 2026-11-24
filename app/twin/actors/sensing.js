// Sensing: what the rover senses, drawn only while it is sensing (a 10 s Wi-Fi window in progress).
//   a) Wi-Fi wavefronts on the floor that pass through walls and lose strength at every wall they cross
//   b) the radar's field of view with range arcs, and the targets of the last reading at this stop
//   c) the thermal camera's view, clipped at the first wall, with its 32 x 24 image projected onto what it sees
//   d) a short pulse from the rover to each detection a reading just touched
// Everything is simulated. Display conventions (not sensed): the radar sweep line and the ring spacing.
import { palette, Y, clamp, stateWatcher, ringGeometry, decalMaterial, disposeTree, mulberry32 } from './common.js';

const ROVER = 'HOUND-01';
const MAST_H = 0.6, CAM_H = 0.45, CAM_FWD = 0.3;
const TAU = Math.PI * 2;

const WIFI_VERT = /* glsl */ `
varying vec2 vP;
void main() { vP = vec2(position.x, -position.z); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const WIFI_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uVis, uPhase, uRange, uSpacing, uProgress, uAtten;
uniform vec4 uWalls[MAXW]; uniform int uCount;
varying vec2 vP;
float crossings(vec2 p) {
  float n = 0.0;
  for (int i = 0; i < MAXW; i++) {
    if (i >= uCount) break;
    vec2 a = uWalls[i].xy, s = uWalls[i].zw - uWalls[i].xy;
    float den = p.x * s.y - p.y * s.x;
    if (abs(den) < 1e-6) continue;
    float tt = (a.x * s.y - a.y * s.x) / den, u = (a.x * p.y - a.y * p.x) / den;
    if (tt > 0.0 && tt < 1.0 && u > 0.0 && u < 1.0) n += 1.0;
  }
  return n;
}
void main() {
  float d = length(vP);
  if (d > uRange + 0.25) discard;
  float n = crossings(vP);
  float att = n < 0.5 ? 1.0 : (n < 1.5 ? uAtten : 0.05 * pow(0.35, n - 2.0));
  float aa = fwidth(d);
  // evenly spaced wavefronts moving outward, each with a short soft wake on its inner side
  float x = d / uSpacing - uPhase, f = fract(x);
  float dm = min(f, 1.0 - f) * uSpacing, w = max(0.016, aa * 0.75);
  float line = 1.0 - smoothstep(w * 0.5, w * 1.6, dm);
  float wake = pow(f, 7.0) * 0.10;
  float env = pow(clamp(1.0 - d / uRange, 0.0, 1.0), 0.85) * smoothstep(0.3, 0.9, d);
  float a = env * att * (line * 0.46 + wake + 0.016);
  // the edge of reach, and how much of the 10 s window has been heard (clockwise from north)
  float wr = max(0.02, aa * 0.9), ring = 1.0 - smoothstep(wr * 0.5, wr * 1.5, abs(d - uRange));
  float ang = fract(atan(vP.x, vP.y) / 6.2831853 + 1.0);
  float done = 1.0 - smoothstep(uProgress - 0.004, uProgress + 0.004, ang);
  a += ring * mix(0.10, 0.5, done);
  gl_FragColor = vec4(uColor, a * uVis);
  #include <colorspace_fragment>
}`;

const SHELL_VERT = /* glsl */ `
attribute float aK;
uniform float uPhase, uRange, uMast, uShells;
varying vec3 vN; varying vec3 vV; varying float vR;
void main() {
  float rr = fract(uPhase / 8.0 + aK / uShells);
  vR = rr;
  vec3 p = position * (rr * uRange) + vec3(0.0, uMast, 0.0);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * position);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uVis;
varying vec3 vN; varying vec3 vV; varying float vR;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 5.0);
  float fade = pow(1.0 - vR, 1.3) * smoothstep(0.03, 0.14, vR);
  gl_FragColor = vec4(uColor, fres * fade * 0.15 * uVis);
  #include <colorspace_fragment>
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
  gl_FragColor = vec4(uColor * 1.8, a * uVis);
  #include <colorspace_fragment>
}`;

// A thin camera-facing ribbon from A to B with a small arch and a bright head that travels along it.
const PULSE_VERT = /* glsl */ `
uniform vec3 uA, uB; uniform float uArch;
varying vec2 vUv;
void main() {
  float u = position.x, s = position.y;
  vec3 p = mix(uA, uB, u) + vec3(0.0, uArch * 4.0 * u * (1.0 - u), 0.0);
  vec3 tg = (uB - uA) + vec3(0.0, uArch * 4.0 * (1.0 - 2.0 * u), 0.0);
  vec3 toCam = cameraPosition - p;
  float wd = max(0.022, length(toCam) * 0.0016);
  p += normalize(cross(tg, toCam)) * s * wd;
  vUv = vec2(u, s);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const PULSE_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uHead, uAlpha;
varying vec2 vUv;
void main() {
  float tail = smoothstep(uHead - 0.45, uHead, vUv.x) * (1.0 - smoothstep(uHead, uHead + 0.015, vUv.x));
  float across = 1.0 - vUv.y * vUv.y;
  float a = (tail * tail * 0.9 + 0.07 * (1.0 - smoothstep(uHead, uHead + 0.015, vUv.x))) * across;
  gl_FragColor = vec4(uColor * (1.0 + 1.2 * tail), a * uAlpha);
  #include <colorspace_fragment>
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
    const low = t.quality === 'low', reduced = !!t.reduced;
    const RANGE = S.csi.range, SPACING = RANGE / 8;
    const R_FOV = S.radar.fovDeg * Math.PI / 180, R_RANGE = S.radar.range;
    const T_FOV = S.thermal.fovDeg * Math.PI / 180, T_RANGE = S.thermal.range, PX = S.thermal.px[0], PY = S.thermal.px[1];
    const T_VFOV = T_FOV * PY / PX, T_STEP = T_FOV / PX;
    const MAXW = low ? 16 : 32, SHELLS = low ? 2 : 4;
    const wallH = world.BUILDING.wallHeight;
    // Everything a thermal ray can stop on: standing walls, and obstacles tall enough to block the view.
    const blockers = [];
    for (const w of world.WALLS) if (w.state !== 'collapsed') blockers.push({ a: w.a, b: w.b, h: w.h || wallH });
    for (const o of world.OBSTACLES) if (o.h >= 1.2) for (let i = 0; i < o.poly.length; i++) blockers.push({ a: o.poly[i], b: o.poly[(i + 1) % o.poly.length], h: o.h });

    const root = new THREE.Group(); root.name = 'sensing'; root.visible = false; t.scene.add(root);
    const fx = new THREE.Group(); fx.name = 'sensing-pulses'; fx.visible = false; t.scene.add(fx);
    const vis = { value: 0 };

    // a) Wi-Fi wavefronts
    const walls = Array.from({ length: MAXW }, () => new THREE.Vector4());
    const half = RANGE + 0.3;
    const wifiMat = decalMaterial(THREE, { defines: { MAXW }, vertexShader: WIFI_VERT, fragmentShader: WIFI_FRAG,
      uniforms: { uColor: { value: pal.scan }, uVis: vis, uPhase: { value: 0 }, uRange: { value: RANGE }, uSpacing: { value: SPACING }, uProgress: { value: 0 }, uAtten: { value: 0.3 }, uWalls: { value: walls }, uCount: { value: 0 } } });
    const wifi = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2).rotateX(-Math.PI / 2), wifiMat);
    wifi.position.y = Y.ring + 0.006; wifi.renderOrder = 7; wifi.frustumCulled = false; root.add(wifi);

    const sg = new THREE.SphereGeometry(1, low ? 28 : 56, low ? 8 : 16, 0, TAU, 0, Math.PI / 2);
    const sCount = sg.attributes.position.count, sIdx = sg.index.array;
    const sPos = new Float32Array(sCount * 3 * SHELLS), sK = new Float32Array(sCount * SHELLS), sI = new Uint32Array(sIdx.length * SHELLS);
    for (let k = 0; k < SHELLS; k++) { sPos.set(sg.attributes.position.array, k * sCount * 3); sK.fill(k, k * sCount, (k + 1) * sCount); for (let i = 0; i < sIdx.length; i++) sI[k * sIdx.length + i] = sIdx[i] + k * sCount; }
    sg.dispose();
    const shellGeo = new THREE.BufferGeometry();
    shellGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3)); shellGeo.setAttribute('aK', new THREE.BufferAttribute(sK, 1)); shellGeo.setIndex(new THREE.BufferAttribute(sI, 1));
    const shellMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG,
      uniforms: { uColor: { value: pal.scan }, uVis: vis, uPhase: { value: 0 }, uRange: { value: RANGE }, uMast: { value: MAST_H }, uShells: { value: SHELLS } } });
    const shells = new THREE.Mesh(shellGeo, shellMat); shells.frustumCulled = false; shells.renderOrder = 8; root.add(shells);

    // b) radar
    const R0 = 0.3;
    const radarMat = decalMaterial(THREE, { vertexShader: RADAR_VERT, fragmentShader: RADAR_FRAG,
      uniforms: { uColor: { value: pal.scan }, uVis: vis, uR0: { value: R0 }, uR1: { value: R_RANGE }, uFov: { value: R_FOV }, uSweep: { value: 0.5 }, uDir: { value: 1 }, uSweepOn: { value: reduced ? 0 : 1 } } });
    const radar = new THREE.Mesh(ringGeometry(THREE, R0, R_RANGE, low ? 24 : 64, -R_FOV / 2, R_FOV), radarMat);
    radar.position.y = Y.ring + 0.003; radar.renderOrder = 7; radar.frustumCulled = false; root.add(radar);

    const quad = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const mkBlip = (parent, kind) => {
      const mat = decalMaterial(THREE, { depthTest: false, vertexShader: BLIP_VERT, fragmentShader: BLIP_FRAG,
        uniforms: { uColor: { value: pal.scan }, uVis: { value: 1 }, uKind: { value: kind }, uAge: { value: 9 }, uSpin: { value: 0 } } });
      const m = new THREE.Mesh(quad, mat); m.renderOrder = 30; m.visible = false; m.frustumCulled = false; parent.add(m); t.glow(m); return m;
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
      uniforms: { uTex: { value: tTex }, uCam: { value: camW }, uHeading: { value: 0 }, uFov: { value: T_FOV }, uVfov: { value: T_VFOV }, uVis: vis } });
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

    // d) pulses and bursts
    const ribbon = new THREE.PlaneGeometry(1, 2, 24, 1).translate(0.5, 0, 0);
    const PULSES = 4, pulses = [];
    for (let i = 0; i < PULSES; i++) {
      const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide, vertexShader: PULSE_VERT, fragmentShader: PULSE_FRAG,
        uniforms: { uColor: { value: pal.scan }, uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uArch: { value: 0.4 }, uHead: { value: 0 }, uAlpha: { value: 0 } } });
      const line = new THREE.Mesh(ribbon, mat); line.frustumCulled = false; line.renderOrder = 31; line.visible = false; fx.add(line); t.glow(line);
      const burst = mkBlip(fx, 2);
      pulses.push({ line, burst, age: -1 });
    }

    // ---------- state ----------
    const watch = stateWatcher();
    let layerOn = true, level = 0, hold = 0, phase = 0, sweepT = 0, lastProg = -1, lastWin = -1;
    let lastAt = null, curStop = null, placedKey = '', resultKey = '', belongs = false, resultAge = 9, fault = false, nBlips = 0, nPulses = 0;
    const rp = [0, 0]; let rh = 0;

    function place(pos, heading) {
      rp[0] = pos[0]; rp[1] = pos[1]; rh = heading;
      root.position.set(pos[0], t.groundY, -pos[1]);
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

    function firePulses(state) {
      const at = state.sensors.at; let n = 0;
      for (const d of state.detections) {
        if (n >= PULSES) break;
        if (d.updated !== at || !d.pos) continue;
        const ev = d.evidence; let touched = false;
        for (let i = ev.length - 1; i >= 0 && ev[i].t === at; i--) { touched = true; break; }
        if (!touched || Math.hypot(d.pos[0] - rp[0], d.pos[1] - rp[1]) > RANGE + 2.5) continue;
        const p = pulses[n++], u = p.line.material.uniforms;
        u.uA.value.set(rp[0], t.groundY + MAST_H, -rp[1]); u.uB.value.set(d.pos[0], t.groundY + 0.22, -d.pos[1]);
        u.uArch.value = 0.25 + 0.09 * Math.hypot(d.pos[0] - rp[0], d.pos[1] - rp[1]);
        p.burst.position.set(d.pos[0], t.groundY + Y.select + 0.014, -d.pos[1]); p.burst.scale.setScalar(1.2);
        p.age = 0;
      }
      nPulses = n;
    }
    function stopPulses() { for (const p of pulses) { p.age = -1; p.line.visible = false; p.burst.visible = false; } nPulses = 0; fx.visible = false; }

    function update(state, dt) {
      const fresh = watch(state), sn = state.sensors, L = sn.listen, rover = state.units[ROVER];
      if (fresh) { lastAt = sn.at; level = L ? 1 : 0; hold = 0; stopPulses(); belongs = false; resultKey = ''; lastProg = L ? L.progress : -1; lastWin = L ? L.window : -1; if (!L) curStop = null; }
      let landed = false;
      if (sn.at !== lastAt) { lastAt = sn.at; landed = !fresh && sn.stop === curStop && level > 0; if (landed) belongs = true; }
      if (L && rover) {
        const key = L.stop + '|' + rover.pos[0].toFixed(2) + '|' + rover.pos[1].toFixed(2) + '|' + rover.heading.toFixed(2);
        if (key !== placedKey) { placedKey = key; curStop = L.stop; place(rover.pos, rover.heading); resultKey = ''; }
        if (!landed) belongs = sn.stop === L.stop && sn.at != null && (L.window > 1 || sn.at >= state.t - L.progress * L.dur - 0.5);
        hold = 0.35; level = Math.min(1, level + dt / 0.3);
        // the wavefronts move only while the window is really advancing (not when paused, held or the link is down)
        const adv = L.progress !== lastProg || L.window !== lastWin; lastProg = L.progress; lastWin = L.window;
        if (adv && !reduced) { phase += dt * 1.5; sweepT += dt * 1.5; }
        wifiMat.uniforms.uProgress.value = L.progress;
      } else if (level > 0) {
        if (hold > 0) hold -= dt; else level = Math.max(0, level - dt / 0.55);
        if (level > 0 && !reduced) phase += dt * 1.5;
      }
      if (landed && !reduced) firePulses(state);
      const on = layerOn && level > 0;
      root.visible = on; blipGroup.visible = on;
      if (on) {
        const k = level * level * (3 - 2 * level); vis.value = k;
        const rk = (curStop || '') + '|' + sn.at + '|' + belongs + '|' + placedKey;
        if (rk !== resultKey) { resultKey = rk; showResults(state, fresh || reduced || !landed); }
        fault = !!(state.faults && state.faults.thermalFail) || (belongs && sn.thermal && sn.thermal.ok === false);
        therm.visible = !fault;
        lines.material = fault ? dashMat : lineMat; lines.material.opacity = (fault ? 0.7 : 0.42) * k;
        wifiMat.uniforms.uPhase.value = phase % 8; shellMat.uniforms.uPhase.value = reduced ? 5.2 : phase % 8;
        const s = Math.sin(sweepT * 0.9); radarMat.uniforms.uSweep.value = 0.5 + 0.47 * s; radarMat.uniforms.uDir.value = Math.cos(sweepT * 0.9) >= 0 ? 1 : -1;
        if (nBlips) { resultAge += dt; for (let i = 0; i < BLIPS; i++) { const b = blips[i]; if (!b.visible) continue; const u = b.material.uniforms; u.uVis.value = k; u.uAge.value = resultAge; if (!reduced) u.uSpin.value = phase * 0.8; } }
      }
      if (nPulses) {
        let alive = 0;
        for (const p of pulses) {
          if (p.age < 0) continue;
          p.age += dt;
          if (p.age > 1.2 || !layerOn) { p.age = -1; p.line.visible = false; p.burst.visible = false; continue; }
          alive++;
          const a = clamp(p.age / 0.55, 0, 1), u = p.line.material.uniforms;
          u.uHead.value = (1 - Math.pow(1 - a, 2.2)) * 1.02; u.uAlpha.value = 1 - clamp((p.age - 0.5) / 0.35, 0, 1);
          p.line.visible = p.age < 0.85;
          const bk = (p.age - 0.45) / 0.75; p.burst.visible = bk > 0; p.burst.material.uniforms.uAge.value = bk;
        }
        nPulses = alive; fx.visible = alive > 0;
      }
    }

    return {
      update,
      setLayer(id, on) { if (id === 'sensing') { layerOn = !!on; if (!on) { root.visible = false; blipGroup.visible = false; stopPulses(); } } },
      onSelect() {},
      dispose() { disposeTree(root); disposeTree(fx); disposeTree(blipGroup); quad.dispose(); ribbon.dispose(); tTex.dispose(); lineMat.dispose(); dashMat.dispose(); },
    };
  },
};
