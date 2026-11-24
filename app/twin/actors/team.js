// Rescue team 1: three rescuers at true scale. Skinned figures (one draw call each) with a walk cycle whose feet are
// planted in world space (two-bone leg IK: a foot on the ground does not move), kneeling work by a person, and a
// sledgehammer swung at the wall on a "break through" leg. Driven by state.units['TEAM-1'] and state.routes.rescue.
// The team is simulated.
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { damp, dampAngle, clamp, lerp, smoothstep, stateWatcher, disposeTree, dist2 } from './common.js';
import { moundHeight } from './routes.js';

const LT = 0.42, LS = 0.41, ANK = 0.09, HIP = 0.92;     // thigh, shank, ankle height, hip height (m)
const REST = 0.897;                                      // hip height when standing easy
const STANCE = 0.6;                                      // share of a stride a foot is on the ground
const BACK = [0, 1.45, 3.3], LAT = [0, 0.16, -0.12];     // file: metres behind the lead, and to the left
const FORM = [[0, 0], [-0.95, 0.75], [-1.25, -0.6]];     // standing group at home: [back, left] offsets
const HIPS = 0, SPINE = 1, CHEST = 2, NECK = 3, HEAD = 4, UAL = 5, FAL = 6, HAL = 7, UAR = 8, FAR = 9, HAR = 10, THL = 11, SHL = 12, FTL = 13, THR = 14, SHR = 15, FTR = 16;

const DUST_VERT = /* glsl */ `
attribute vec3 aVel; attribute float aSeed; uniform float uAge, uPx; varying float vA;
void main() {
  float k = clamp(uAge / (0.7 + aSeed * 0.4), 0.0, 1.0);
  vec3 p = position + aVel * (1.0 - exp(-3.0 * uAge)) / 3.0; p.y -= 0.25 * uAge * uAge;
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.12 + 0.6 * k) * (0.6 + aSeed) * uPx / max(-mv.z, 0.1);
  vA = smoothstep(0.0, 0.1, k) * pow(1.0 - k, 1.5) * 0.22;
}`;
const DUST_FRAG = /* glsl */ `
varying float vA;
void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = vA * exp(-r * r * 3.0) * (1.0 - smoothstep(0.85, 1.0, r)); if (a < 0.003) discard;
  gl_FragColor = vec4(vec3(0.3, 0.285, 0.26), a);
  #include <colorspace_fragment>
}`;

// Cloth folds, weave, wet mud from the boots up, scuffs, retro-reflective tape and the lamp lens, all in rest-pose
// space so nothing swims as the body moves. aMat = roughness, cloth, tape, lens.
const FIG_PARS = /* glsl */ `
varying vec4 vMat; varying vec3 vRest; float figH, figN; uniform float uLamp;
float fh(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.17, 0.13)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fn(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fh(i), fh(i + vec3(1, 0, 0)), f.x), mix(fh(i + vec3(0, 1, 0)), fh(i + vec3(1, 1, 0)), f.x), f.y), mix(mix(fh(i + vec3(0, 0, 1)), fh(i + vec3(1, 0, 1)), f.x), mix(fh(i + vec3(0, 1, 1)), fh(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`;
const FIG_COLOR = /* glsl */ `
#include <color_fragment>
{
  figN = fn(vRest * vec3(11.0, 9.0, 11.0)) * 0.6 + fn(vRest * 37.0) * 0.4;
  float warp = fn(vRest * 4.0) * 1.6;
  float fold = fn(vec3(vRest.x * 5.0 + warp, vRest.y * 15.0 + warp * 2.5, vRest.z * 5.0)), crease = fn(vec3(vRest.x * 14.0, vRest.y * 34.0 + warp * 4.0, vRest.z * 14.0));
  figH = vMat.y * (fold * 0.02 + crease * 0.0075 + fn(vRest * 260.0) * 0.0005) + (1.0 - vMat.y) * fn(vRest * 120.0) * 0.0003;
  diffuseColor.rgb *= mix(0.8 + 0.4 * figN, (0.55 + 0.75 * fold) * (0.75 + 0.5 * crease) * (0.8 + 0.4 * figN), vMat.y);
  float mud = smoothstep(0.62, 0.06, vRest.y + (figN - 0.5) * 0.5) * step(0.0, 1.2 - vRest.y);
  mud = max(mud, smoothstep(0.66, 0.8, fn(vRest * vec3(13.0, 8.0, 13.0) + 4.0)) * 0.4 * (1.0 - smoothstep(0.9, 1.6, vRest.y)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.072, 0.058) * (0.5 + 1.0 * figN), mud * (0.35 + 0.5 * smoothstep(0.35, 0.65, figN)));
}`;
const FIG_NORMAL = /* glsl */ `
{
  vec3 sp = -vViewPosition, dx = dFdx(sp), dy = dFdy(sp), r1 = cross(dy, normal), r2 = cross(normal, dx);
  float det = dot(dx, r1); vec3 gr = sign(det) * (dFdx(figH) * r1 + dFdy(figH) * r2), nb = abs(det) * normal - gr * (1.0 - smoothstep(0.009, 0.03, length(dx))); float ln = length(nb);
  if (ln > 1e-9) normal = nb / ln;
}`;
const FIG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  float facing = max(dot(normal, normalize(vViewPosition)), 0.0);
  vec2 hx = vRest.zy * 160.0; float cell = 0.8 + 0.2 * step(0.2, abs(fract(hx.x + floor(hx.y) * 0.5) - 0.5) * 2.0) * step(0.2, abs(fract(hx.y) - 0.5) * 2.0);
  totalEmissiveRadiance += vec3(0.72, 0.76, 0.78) * vMat.z * cell * (0.004 + 0.06 * facing * facing * facing);
  totalEmissiveRadiance += vec3(1.0, 0.95, 0.86) * vMat.w * uLamp * (0.35 + 1.9 * pow(facing, 5.0));
}`;

// Head-lamp beams (soft cones that only catch haze) and the pools they make on the ground; contact shadows.
const BEAM_VERT = /* glsl */ `varying float vX; varying vec3 vN; varying vec3 vV;
void main() { vX = position.x; mat4 m = modelViewMatrix * instanceMatrix; vec4 mv = m * vec4(position, 1.0); vN = normalize(mat3(m) * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const BEAM_FRAG = /* glsl */ `uniform float uOpacity; varying float vX; varying vec3 vN; varying vec3 vV;
void main() { float f = abs(dot(normalize(vN), normalize(vV))); float a = pow(f, 2.2) * exp(-vX * 1.1) * smoothstep(0.0, 0.12, vX) * (1.0 - smoothstep(2.2, 3.0, vX)) * smoothstep(0.5, 1.6, length(vV)) * uOpacity;
  gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * a * 0.075, 1.0); }`;
const GROUND_VERT = /* glsl */ `attribute float aKind; varying vec2 vUv; varying float vKind; varying vec2 vPw;
void main() { vUv = uv * 2.0 - 1.0; vKind = aKind; vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vPw = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;
// result = light + ground * gain: gain below 1 is a contact shadow, above 1 a pool of lamp light.
const GROUND_FRAG = /* glsl */ `uniform float uLamp; varying vec2 vUv; varying float vKind; varying vec2 vPw;
float gh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() { float r2 = dot(vUv, vUv), m = exp(-r2 * 3.2) * (1.0 - smoothstep(0.7, 1.0, sqrt(r2)));
  if (vKind < 0.0) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 + vKind * m);
  else gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * m * 0.012 * uLamp, 1.0 + m * 0.35 * vKind * uLamp); }`;

function segHit(p, q, a, b) {
  const rx = q[0] - p[0], ry = q[1] - p[1], sx = b[0] - a[0], sy = b[1] - a[1], den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const k = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / den, m = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / den;
  return k >= 0 && k <= 1 && m >= 0 && m <= 1 ? k : -1;
}

// ---------- the model ----------
// Everything is gathered into one vertex list in rest pose (facing +x, left = -z) with per-vertex bone weights.
function buildFigure(THREE, V, low) {
  const P = [], N = [], C = [], M = [], SI = [], SW = [], IX = [];
  const seg = low ? 10 : 20, col = new THREE.Color();
  const CLOTH = [0.88, 1, 0, 0], NYLON = [0.62, 0.45, 0, 0], PLASTIC = [0.36, 0, 0, 0], RUBBER = [0.74, 0, 0, 0], SKIN = [0.56, 0, 0, 0], TAPE = [0.42, 0.06, 1, 0], LENS = [0.18, 0, 0, 1], METAL = [0.34, 0, 0, 0], GLASS = [0.06, 0, 0, 0], LEATHER = [0.6, 0.12, 0, 0];
  const on = (...b) => () => [b[0], 1, b[1] || 0, 0];
  function push(g, hex, mat, wf) {
    const base = P.length / 3, p = g.attributes.position, n = g.attributes.normal; col.set(hex);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), w = wf(x, y, z);
      P.push(x, y, z); N.push(n.getX(i), n.getY(i), n.getZ(i)); C.push(col.r, col.g, col.b); M.push(mat[0], mat[1], mat[2], mat[3]); SI.push(w[0], w[2], 0, 0); SW.push(w[1], w[3], 0, 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) IX.push(base + g.index.getX(i)); else for (let i = 0; i < p.count; i++) IX.push(base + i);
    g.dispose();
  }
  // rings: [y, cx, cz, rx, rz], bottom to top. n = superellipse exponent (2 = ellipse).
  function loft(rings, { n = 2, sub = 3, caps = true, s = seg } = {}) {
    const R = [];
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < (low ? 1 : sub); k++) {
      const u = k / (low ? 1 : sub), a = rings[Math.max(0, i - 1)], b = rings[i], c = rings[i + 1], d = rings[Math.min(rings.length - 1, i + 2)];
      R.push(b.map((_, j) => 0.5 * (2 * b[j] + (c[j] - a[j]) * u + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * u * u + (3 * b[j] - a[j] - 3 * c[j] + d[j]) * u * u * u)));
    }
    R.push(rings[rings.length - 1]);
    const pos = [], idx = [], pw = 2 / n, pz = (v) => Math.sign(v) * Math.pow(Math.abs(v), pw);
    for (const r of R) for (let j = 0; j < s; j++) { const a = (j / s) * Math.PI * 2; pos.push(r[1] + pz(Math.cos(a)) * Math.max(r[3], 1e-4), r[0], r[2] + pz(Math.sin(a)) * Math.max(r[4], 1e-4)); }
    for (let i = 0; i < R.length - 1; i++) for (let j = 0; j < s; j++) { const a = i * s + j, b = a + s, c = i * s + (j + 1) % s, d = c + s; idx.push(a, b, c, c, b, d); }
    if (caps) { const t0 = pos.length / 3, a = R[0], b = R[R.length - 1]; pos.push(a[1], a[0], a[2], b[1], b[0], b[2]); const o = (R.length - 1) * s; for (let j = 0; j < s; j++) idx.push(t0, j, (j + 1) % s, t0 + 1, o + (j + 1) % s, o + j); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  // The same rings, cut to [y0, y1] and grown by "g": tape, belts and bands that follow the garment under them.
  function band(rings, y0, y1, grow, o = {}) {
    const at = (y) => { let i = 0; while (i < rings.length - 2 && rings[i + 1][0] < y) i++; const a = rings[i], b = rings[i + 1], k = clamp((y - a[0]) / (b[0] - a[0]), 0, 1); return [y, lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k) + grow, lerp(a[4], b[4], k) + grow]; };
    const a = at(y0), b = at(y1), m = at((y0 + y1) / 2), s = (r, d) => [r[0], r[1], r[2], r[3] + d, r[4] + d];
    return loft([s(a, -grow - 0.002), s([a[0] + 0.002, ...a.slice(1)], 0), m, s([b[0] - 0.002, ...b.slice(1)], 0), s(b, -grow - 0.002)], { sub: 1, caps: false, ...o });
  }
  const rbox = (x, y, z, r, px, py, pz, rx = 0, ry = 0, rz = 0) => { const g = new RoundedBoxGeometry(x, y, z, low ? 1 : 3, Math.min(r, x / 2, y / 2, z / 2)); g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(px, py, pz); return g; };
  const cyl = (r0, r1, h, px, py, pz, rx = 0, rz = 0, s = low ? 7 : 14) => { const g = new THREE.CylinderGeometry(r0, r1, h, s); g.rotateX(rx); g.rotateZ(rz); g.translate(px, py, pz); return g; };
  const ball = (x, y, z, px, py, pz, s = low ? 8 : 16) => { const g = new THREE.SphereGeometry(1, s, s - 4); g.scale(x, y, z); g.computeVertexNormals(); g.translate(px, py, pz); return g; };
  const tube = (pts, r, k = low ? 4 : 7) => { const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), low ? 8 : 18, r, k); return g; };
  const caps = (r, h, px, py, pz, rx = 0, rz = 0) => { const g = new THREE.CapsuleGeometry(r, h, low ? 2 : 4, low ? 6 : 10); g.rotateX(rx); g.rotateZ(rz); g.translate(px, py, pz); return g; };

  // trunk
  const trunkW = (x, y) => y < 1.0 ? [HIPS, 1, 0, 0] : y < 1.12 ? [HIPS, 1 - (y - 1.0) / 0.12, SPINE, (y - 1.0) / 0.12] : y < 1.28 ? [SPINE, 1 - (y - 1.12) / 0.16, CHEST, (y - 1.12) / 0.16] : [CHEST, 1, 0, 0];
  push(loft([[0.8, 0, 0, 0.05, 0.09], [0.83, 0, 0, 0.088, 0.142], [0.87, -0.004, 0, 0.11, 0.17], [0.94, -0.01, 0, 0.115, 0.172], [1.0, -0.006, 0, 0.105, 0.162]], { n: 2.3 }), V.trouser, CLOTH, on(HIPS));
  const J = [[0.878, -0.004, 0, 0.116, 0.176], [0.892, -0.004, 0, 0.13, 0.19], [0.96, -0.006, 0, 0.128, 0.186], [1.04, -0.002, 0, 0.116, 0.172], [1.1, 0.002, 0, 0.117, 0.173], [1.2, 0.006, 0, 0.128, 0.187], [1.3, 0.004, 0, 0.136, 0.2], [1.37, -0.002, 0, 0.13, 0.205], [1.42, -0.006, 0, 0.112, 0.186], [1.455, -0.008, 0, 0.09, 0.14], [1.485, -0.006, 0, 0.074, 0.094], [1.5, -0.004, 0, 0.066, 0.076]];
  push(loft(J, { n: 2.35 }), V.jacket, CLOTH, trunkW);
  push(band(J, 1.152, 1.186, 0.0035, { n: 2.35 }), '#767b7a', TAPE, trunkW);
  push(band(J, 1.142, 1.152, 0.003, { n: 2.35 }), V.accent, CLOTH, trunkW); push(band(J, 1.186, 1.196, 0.003, { n: 2.35 }), V.accent, CLOTH, trunkW);
  push(band(J, 0.925, 0.952, 0.003, { n: 2.35 }), '#767b7a', TAPE, trunkW);
  push(band(J, 1.02, 1.062, 0.007, { n: 2.35 }), '#15171a', NYLON, trunkW);                                                   // hip belt and its buckle
  push(rbox(0.016, 0.044, 0.07, 0.006, 0.126, 1.041, 0), '#0f1113', PLASTIC, trunkW);
  push(rbox(0.05, 0.085, 0.07, 0.014, 0.085, 1.0, -0.15, 0, -0.6), '#191c20', NYLON, on(HIPS)); push(rbox(0.045, 0.07, 0.09, 0.014, 0.02, 0.995, 0.187), '#191c20', NYLON, on(HIPS));
  push(rbox(0.008, 0.52, 0.02, 0.004, 0.134, 1.17, 0, 0, 0, 0.015), '#14161a', NYLON, trunkW);                                  // zip flap
  push(rbox(0.018, 0.095, 0.1, 0.008, 0.129, 1.3, 0.098, 0, 0.3), V.jacket, CLOTH, on(CHEST)); push(rbox(0.02, 0.026, 0.104, 0.006, 0.132, 1.345, 0.098, 0, 0.3), V.jacket, CLOTH, on(CHEST));
  push(rbox(0.018, 0.1, 0.1, 0.008, 0.112, 0.975, 0.085, 0, 0.3), V.jacket, CLOTH, on(HIPS)); push(rbox(0.018, 0.1, 0.1, 0.008, 0.112, 0.975, -0.085, 0, -0.3), V.jacket, CLOTH, on(HIPS));
  push(loft([[1.46, -0.008, 0, 0.086, 0.104], [1.5, -0.002, 0, 0.078, 0.088], [1.535, 0.004, 0, 0.073, 0.079], [1.545, 0.004, 0, 0.066, 0.071], [1.53, 0.004, 0, 0.056, 0.06]], { caps: false }), V.jacket, CLOTH, on(CHEST));
  push(rbox(0.032, 0.1, 0.056, 0.01, 0.137, 1.335, -0.1, 0, -0.35), '#101215', PLASTIC, on(CHEST)); push(cyl(0.005, 0.006, 0.13, 0.135, 1.44, -0.115), '#0c0d0f', RUBBER, on(CHEST));   // radio
  push(tube([[0.14, 1.33, -0.08], [0.16, 1.28, -0.04], [0.145, 1.33, 0.01], [0.11, 1.43, 0.02]], 0.0045, 5), '#0c0d0f', RUBBER, on(CHEST));

  // head
  push(loft([[1.45, -0.012, 0, 0.056, 0.06], [1.52, -0.002, 0, 0.054, 0.056], [1.58, 0.006, 0, 0.054, 0.055]]), V.skin, SKIN, (x, y) => y < 1.5 ? [CHEST, 1, 0, 0] : [NECK, 0.5, HEAD, 0.5]);
  push(loft([[1.548, 0.05, 0, 0.012, 0.012], [1.556, 0.045, 0, 0.036, 0.034], [1.575, 0.034, 0, 0.06, 0.052], [1.605, 0.023, 0, 0.078, 0.062], [1.64, 0.015, 0, 0.09, 0.07], [1.675, 0.01, 0, 0.096, 0.074], [1.71, 0.006, 0, 0.098, 0.076], [1.75, 0, 0, 0.09, 0.07], [1.78, 0, 0, 0.06, 0.05]], { n: 2.15 }), V.skin, SKIN, on(HEAD));
  push(ball(0.02, 0.026, 0.014, 0.103, 1.648, 0), V.skin, SKIN, on(HEAD)); push(ball(0.014, 0.011, 0.014, 0.114, 1.634, 0), V.skin, SKIN, on(HEAD));
  for (const s of [-1, 1]) { push(ball(0.018, 0.03, 0.011, -0.002, 1.652, s * 0.077), V.skin, SKIN, on(HEAD)); push(ball(0.02, 0.008, 0.02, 0.094, 1.694, s * 0.033), '#2a211b', SKIN, on(HEAD)); }
  if (V.mask) { push(ball(0.044, 0.04, 0.05, 0.078, 1.607, 0), '#5f6260', [0.85, 0.25, 0, 0], on(HEAD)); push(cyl(0.014, 0.016, 0.014, 0.117, 1.6, 0.022, 0, Math.PI / 2), '#55585a', PLASTIC, on(HEAD)); for (const s of [-1, 1]) push(tube([[0.07, 1.61, s * 0.048], [0.02, 1.625, s * 0.074], [-0.07, 1.65, s * 0.06]], 0.003, 4), '#24272a', NYLON, on(HEAD)); }
  else push(loft([[1.52, 0.004, 0, 0.066, 0.066], [1.545, 0.016, 0, 0.066, 0.06], [1.575, 0.03, 0, 0.068, 0.058], [1.61, 0.022, 0, 0.087, 0.07], [1.645, 0.018, 0, 0.1, 0.079], [1.66, 0.016, 0, 0.102, 0.08], [1.664, 0.016, 0, 0.094, 0.073]], { n: 2.1, caps: false }), V.buff, CLOTH, (x, y) => y < 1.55 ? [NECK, 1, 0, 0] : [HEAD, 1, 0, 0]);   // neck gaiter pulled up
  push(rbox(0.026, 0.036, 0.142, 0.012, 0.096, 1.68, 0), '#0b0d10', GLASS, on(HEAD)); for (const s of [-1, 1]) push(rbox(0.1, 0.008, 0.005, 0.002, 0.045, 1.684, s * 0.076), '#101214', PLASTIC, on(HEAD));
  // helmet, brim, ribs, side rails, strap, head lamp
  const H = [[1.7, -0.006, 0, 0.126, 0.102], [1.715, -0.006, 0, 0.13, 0.106], [1.745, -0.006, 0, 0.129, 0.106], [1.785, -0.006, 0, 0.118, 0.098], [1.818, -0.006, 0, 0.096, 0.08], [1.842, -0.006, 0, 0.062, 0.053], [1.853, -0.006, 0, 0.012, 0.01]];
  push(loft(H, { n: 2.1 }), V.helmet, PLASTIC, on(HEAD));
  push(band(H, 1.699, 1.711, 0.004, { n: 2.1 }), V.helmet, PLASTIC, on(HEAD));
  { const g = new THREE.SphereGeometry(1, low ? 10 : 20, 8, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(0.058, 0.014, 0.086); g.computeVertexNormals(); g.rotateZ(-0.16); g.translate(0.108, 1.704, 0); push(g, V.helmet, PLASTIC, on(HEAD)); }
  for (const z of [-0.036, 0, 0.036]) push(tube([[0.1, 1.784 - Math.abs(z) * 0.15, z], [0.052, 1.838 - Math.abs(z) * 0.28, z], [-0.01, 1.8545 - Math.abs(z) * 0.3, z], [-0.07, 1.836 - Math.abs(z) * 0.28, z], [-0.118, 1.776 - Math.abs(z) * 0.15, z]], 0.0055, 6), V.helmet, PLASTIC, on(HEAD));
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) push(rbox(0.026, 0.007, 0.006, 0.003, -0.02 + (k - 1) * 0.036, 1.79, s * 0.0975, s * 0.35), '#1b1d20', PLASTIC, on(HEAD));   // vents
    push(tube([[0.032, 1.706, s * 0.098], [0.04, 1.65, s * 0.083], [0.05, 1.585, s * 0.057], [0.052, 1.546, s * 0.018], [0.053, 1.543, 0]], 0.0052, 5), '#17191c', NYLON, on(HEAD));
    push(tube([[-0.06, 1.706, s * 0.094], [-0.02, 1.655, s * 0.086], [0.04, 1.6, s * 0.066]], 0.0045, 5), '#17191c', NYLON, on(HEAD));
    push(rbox(0.03, 0.022, 0.003, 0.001, -0.075, 1.745, s * 0.0905, 0, s * 0.5), '#767b7a', TAPE, on(HEAD));
  }
  push(band(H, 1.722, 1.742, 0.0025, { n: 2.1 }), '#1a1c1f', NYLON, on(HEAD));
  push(rbox(0.03, 0.036, 0.056, 0.009, 0.134, 1.737, 0), '#141619', PLASTIC, on(HEAD)); push(cyl(0.0155, 0.0175, 0.012, 0.152, 1.738, 0, 0, Math.PI / 2), '#2a2d31', METAL, on(HEAD));
  push(cyl(0.0135, 0.0135, 0.004, 0.1585, 1.738, 0, 0, Math.PI / 2), '#e9e4d6', LENS, on(HEAD)); push(rbox(0.028, 0.034, 0.066, 0.009, -0.142, 1.735, 0), '#141619', PLASTIC, on(HEAD));

  // arms and gloves
  for (const s of [-1, 1]) {
    const U = s < 0 ? UAL : UAR, F = s < 0 ? FAL : FAR, HD = s < 0 ? HAL : HAR, e = 1.13;
    const armW = (x, y) => y > 1.385 ? [U, 1 - 0.45 * smoothstep(1.385, 1.46, y), CHEST, 0.45 * smoothstep(1.385, 1.46, y)] : y > e + 0.05 ? [U, 1, 0, 0] : y < e - 0.05 ? [F, 1, 0, 0] : [U, (y - e + 0.05) / 0.1, F, 1 - (y - e + 0.05) / 0.1];
    const A = [[0.872, 0.004, s * 0.214, 0.036, 0.033], [0.884, 0.004, s * 0.214, 0.043, 0.04], [0.92, 0.002, s * 0.214, 0.044, 0.041], [1.0, -0.002, s * 0.213, 0.05, 0.047], [1.07, -0.006, s * 0.212, 0.053, 0.05], [e, -0.01, s * 0.21, 0.052, 0.05], [1.2, -0.01, s * 0.208, 0.058, 0.055], [1.29, -0.01, s * 0.204, 0.064, 0.06], [1.36, -0.01, s * 0.198, 0.071, 0.064], [1.41, -0.01, s * 0.19, 0.073, 0.062], [1.445, -0.01, s * 0.172, 0.06, 0.052], [1.462, -0.01, s * 0.15, 0.03, 0.03]];
    push(loft(A), V.jacket, CLOTH, armW);
    push(band(A, 1.262, 1.288, 0.003), '#767b7a', TAPE, armW); push(band(A, 1.254, 1.262, 0.0025), V.accent, CLOTH, armW); push(band(A, 1.288, 1.296, 0.0025), V.accent, CLOTH, armW);
    push(band(A, 0.94, 0.958, 0.003), '#767b7a', TAPE, armW); push(band(A, 0.888, 0.904, 0.003), '#121417', NYLON, armW);
    push(ball(0.012, 0.045, 0.042, -0.06, e, s * 0.21), '#17191c', [0.8, 0.3, 0, 0], armW);                                                                       // elbow patch
    const gl = V.glove, W = on(HD);
    push(loft([[0.845, 0.004, s * 0.214, 0.033, 0.024], [0.87, 0.004, s * 0.214, 0.031, 0.027], [0.905, 0.003, s * 0.214, 0.04, 0.037]]), gl, LEATHER, W);
    push(rbox(0.084, 0.098, 0.034, 0.015, 0.006, 0.822, s * 0.213, s * 0.08), gl, LEATHER, W); push(rbox(0.07, 0.05, 0.014, 0.006, 0.006, 0.826, s * 0.231, s * 0.08), '#2c2f33', RUBBER, W);
    for (let k = 0; k < 4; k++) { const x = -0.026 + k * 0.0215, l = [0.032, 0.04, 0.044, 0.036][k]; push(caps(0.0108, l * 0.6, x, 0.764, s * 0.206, s * 0.35), gl, LEATHER, W); push(caps(0.0102, l * 0.5, x, 0.735, s * 0.19, s * 0.95), gl, LEATHER, W); }
    push(caps(0.012, 0.034, 0.05, 0.805, s * 0.203, s * 0.3, 0.45), gl, LEATHER, W);
  }

  // legs and boots
  for (const s of [-1, 1]) {
    const T = s < 0 ? THL : THR, S = s < 0 ? SHL : SHR, F = s < 0 ? FTL : FTR, k0 = 0.5, z = s * 0.097;
    const legW = (x, y) => y > 0.86 ? [T, 1 - 0.5 * smoothstep(0.86, 0.95, y), HIPS, 0.5 * smoothstep(0.86, 0.95, y)] : y > k0 + 0.06 ? [T, 1, 0, 0] : y < k0 - 0.06 ? [S, 1, 0, 0] : [T, (y - k0 + 0.06) / 0.12, S, 1 - (y - k0 + 0.06) / 0.12];
    const L = [[0.185, -0.004, z, 0.062, 0.056], [0.196, -0.004, z, 0.072, 0.066], [0.24, -0.006, z, 0.073, 0.067], [0.31, -0.012, z, 0.072, 0.066], [0.39, -0.012, z, 0.071, 0.067], [k0 - 0.04, -0.002, z, 0.065, 0.062], [k0, 0.004, z, 0.067, 0.064], [0.57, 0.002, z, 0.072, 0.069], [0.68, 0, z, 0.083, 0.078], [0.8, -0.002, s * 0.095, 0.095, 0.086], [0.88, -0.004, s * 0.09, 0.1, 0.086], [0.93, -0.006, s * 0.085, 0.085, 0.075], [0.95, -0.006, s * 0.08, 0.05, 0.05]];
    push(loft(L), V.trouser, CLOTH, legW);
    push(band(L, 0.325, 0.36, 0.003), '#767b7a', TAPE, legW); push(band(L, 0.317, 0.325, 0.0025), V.accent, CLOTH, legW);
    push(loft([[0.435, 0.03, z, 0.02, 0.034], [0.45, 0.032, z, 0.044, 0.05], [0.5, 0.034, z, 0.047, 0.054], [0.545, 0.032, z, 0.044, 0.05], [0.56, 0.03, z, 0.02, 0.034]], { n: 2.6, sub: 2 }), '#16181b', RUBBER, legW);   // knee pad
    push(rbox(0.13, 0.15, 0.028, 0.012, 0.0, 0.69, s * 0.176), V.trouser, CLOTH, legW); push(rbox(0.134, 0.034, 0.034, 0.008, 0.0, 0.752, s * 0.177), V.trouser, CLOTH, legW);                                           // cargo pocket
    const bootW = (x, y) => y > 0.13 ? [S, 1, 0, 0] : y < 0.08 ? [F, 1, 0, 0] : [S, (y - 0.08) / 0.05, F, 1 - (y - 0.08) / 0.05];
    push(loft([[0.04, -0.012, z, 0.052, 0.042], [0.09, -0.008, z, 0.056, 0.046], [0.14, -0.006, z, 0.058, 0.051], [0.21, -0.004, z, 0.062, 0.056], [0.225, -0.004, z, 0.052, 0.046]]), V.boot, LEATHER, bootW);
    push(band([[0.04, -0.012, z, 0.052, 0.042], [0.09, -0.008, z, 0.056, 0.046], [0.14, -0.006, z, 0.058, 0.051], [0.21, -0.004, z, 0.062, 0.056]], 0.185, 0.2, 0.004), '#0d0e10', NYLON, bootW);
    const vamp = loft([[-0.082, -0.04, 0, 0.016, 0.024], [-0.074, -0.044, 0, 0.034, 0.037], [-0.03, -0.054, 0, 0.044, 0.042], [0.03, -0.058, 0, 0.046, 0.043], [0.08, -0.052, 0, 0.038, 0.046], [0.13, -0.045, 0, 0.031, 0.047], [0.17, -0.041, 0, 0.026, 0.04], [0.188, -0.038, 0, 0.012, 0.022]], { n: 2.3 }); vamp.rotateZ(-Math.PI / 2); vamp.translate(0, 0, z); push(vamp, V.boot, LEATHER, on(F));
    const toe = loft([[0.122, -0.044, 0, 0.0335, 0.0475], [0.15, -0.043, 0, 0.031, 0.0455], [0.174, -0.04, 0, 0.026, 0.038], [0.19, -0.037, 0, 0.012, 0.02]], { n: 2.3 }); toe.rotateZ(-Math.PI / 2); toe.translate(0, 0, z); push(toe, '#101113', RUBBER, on(F));
    for (let k = 0; k < 4; k++) push(tube([[0.03 + k * 0.022, 0.092 - k * 0.0075, z - 0.028], [0.034 + k * 0.022, 0.105 - k * 0.0085, z], [0.03 + k * 0.022, 0.092 - k * 0.0075, z + 0.028]], 0.0035, 4), '#3a3a36', NYLON, on(F));   // laces
    const sh = new THREE.Shape(); sh.moveTo(-0.085, 0); sh.bezierCurveTo(-0.085, 0.05, -0.02, 0.034, 0.02, 0.038); sh.bezierCurveTo(0.08, 0.042, 0.12, 0.056, 0.17, 0.042); sh.bezierCurveTo(0.2, 0.03, 0.2, -0.03, 0.17, -0.042); sh.bezierCurveTo(0.12, -0.056, 0.08, -0.042, 0.02, -0.038); sh.bezierCurveTo(-0.02, -0.034, -0.085, -0.05, -0.085, 0);
    const sole = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2, curveSegments: low ? 4 : 10 }); sole.rotateX(-Math.PI / 2); sole.translate(0, 0.005, z); push(sole, '#0b0c0d', RUBBER, on(F));
    for (let k = 0; k < 7; k++) push(rbox(0.012, 0.011, 0.088, 0.003, -0.065 + k * 0.037, 0.005, z, 0, k % 2 ? 0.25 : -0.25), '#0b0c0d', RUBBER, on(F));
  }

  // pack, straps, and what each person carries
  const B = on(CHEST), pk = V.pack;
  push(loft([[0.985, -0.19, 0, 0.06, 0.12], [1.0, -0.195, 0, 0.082, 0.145], [1.15, -0.21, 0, 0.096, 0.158], [1.32, -0.208, 0, 0.092, 0.155], [1.44, -0.195, 0, 0.076, 0.142], [1.47, -0.19, 0, 0.055, 0.12]], { n: 3.2 }), pk, NYLON, B);
  push(loft([[1.43, -0.2, 0, 0.088, 0.15], [1.47, -0.198, 0, 0.09, 0.15], [1.505, -0.19, 0, 0.066, 0.12], [1.515, -0.19, 0, 0.03, 0.06]], { n: 2.8 }), V.pack2, NYLON, B);
  push(rbox(0.06, 0.2, 0.2, 0.026, -0.305, 1.14, 0), V.pack2, NYLON, B); push(rbox(0.012, 0.016, 0.16, 0.004, -0.338, 1.2, 0), '#111316', NYLON, B); push(rbox(0.006, 0.022, 0.12, 0.002, -0.3, 1.36, 0), '#767b7a', TAPE, B);
  for (const s of [-1, 1]) {
    push(caps(0.04, 0.13, -0.2, 1.12, s * 0.175), V.pack2, NYLON, B);
    push(tube([[-0.115, 1.43, s * 0.09], [-0.03, 1.492, s * 0.108], [0.07, 1.446, s * 0.112], [0.128, 1.36, s * 0.108], [0.142, 1.25, s * 0.122], [0.1, 1.13, s * 0.163], [-0.06, 1.07, s * 0.18], [-0.13, 1.06, s * 0.15]], 0.0155, 7), '#16181c', NYLON, (x, y, z2) => y > 1.3 ? [CHEST, 1, 0, 0] : trunkW(x, y, z2));
    push(rbox(0.012, 0.022, 0.03, 0.004, 0.15, 1.27, s * 0.12), '#2a2d31', PLASTIC, B);
    push(rbox(0.2, 0.012, 0.006, 0.002, -0.21, 1.28, s * 0.16), '#111316', NYLON, B); push(rbox(0.2, 0.012, 0.006, 0.002, -0.21, 1.08, s * 0.165), '#111316', NYLON, B);
  }
  push(rbox(0.008, 0.016, 0.22, 0.003, 0.146, 1.292, 0), '#16181c', NYLON, B);                                                   // sternum strap
  if (V.kit === 'rope') {
    for (let k = 0; k < 6; k++) { const g = new THREE.TorusGeometry(0.1 + (k % 3) * 0.007, 0.0105, low ? 5 : 8, low ? 14 : 30); g.scale(0.9, 1.3, 1); g.computeVertexNormals(); g.rotateY(Math.PI / 2 + (k - 2.5) * 0.02); g.translate(-0.35 + (k - 2.5) * 0.0085, 1.22, 0.012 * (k % 2)); push(g, k % 2 ? '#8b8576' : '#7d7869', [0.9, 0.6, 0, 0], B); }
    push(caps(0.022, 0.05, -0.352, 1.35, 0), '#6f6a5c', [0.9, 0.6, 0, 0], B); push(caps(0.05, 0.24, -0.2, 1.555, 0, Math.PI / 2), '#34373a', CLOTH, B);
  } else if (V.kit === 'stretcher') {
    for (const s of [-1, 1]) { push(cyl(0.0135, 0.0135, 1.16, -0.335, 1.3, s * 0.06, 0, 0), '#80868b', METAL, B); push(cyl(0.017, 0.017, 0.12, -0.335, 1.86, s * 0.06), '#111316', RUBBER, B); push(cyl(0.017, 0.017, 0.12, -0.335, 0.74, s * 0.06), '#111316', RUBBER, B); }
    push(caps(0.056, 0.74, -0.345, 1.3, 0), '#4b4433', CLOTH, B); for (const y of [1.02, 1.3, 1.56]) push(cyl(0.06, 0.06, 0.026, -0.345, y, 0), '#141619', NYLON, B);
  } else {
    push(cyl(0.011, 0.011, 0.78, -0.3, 1.3, 0.125, 0.06), '#2a2d30', METAL, B); push(rbox(0.07, 0.024, 0.03, 0.006, -0.28, 1.69, 0.102), '#3a3e42', METAL, B); push(rbox(0.03, 0.09, 0.016, 0.004, -0.31, 0.9, 0.148, 0.3), '#3a3e42', METAL, B);   // pry bar
    push(caps(0.056, 0.22, -0.2, 1.56, 0, Math.PI / 2), '#3b3a31', CLOTH, B);
  }
  if (V.sledge) { const W = on(HAR), y = 0.765, z = 0.205; push(cyl(0.0135, 0.016, 0.82, 0.16, y, z, 0, Math.PI / 2), '#6b5a43', [0.7, 0.1, 0, 0], W); push(rbox(0.058, 0.15, 0.058, 0.009, 0.555, y, z), '#4a4e52', METAL, W); push(cyl(0.019, 0.019, 0.16, -0.17, y, z, 0, Math.PI / 2), '#141619', RUBBER, W); push(rbox(0.06, 0.012, 0.06, 0.003, 0.555, y + 0.077, z), '#8f9498', [0.28, 0, 0, 0], W); push(rbox(0.06, 0.012, 0.06, 0.003, 0.555, y - 0.077, z), '#8f9498', [0.28, 0, 0, 0], W); }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('aMat', new THREE.Float32BufferAttribute(M, 4));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4)); g.setIndex(IX); return g;
}

// Muted, worn, real colours. The only accent is a faded orange edge on the tape.
const WEAR = [
  { jacket: '#333942', trouser: '#30353a', boot: '#2c2925', helmet: '#8f8d85', pack: '#434a4b', pack2: '#363d3f', accent: '#8a5233', skin: '#5f4d43', buff: '#33373a', glove: '#23262a', mask: false, kit: 'rope' },
  { jacket: '#44473a', trouser: '#37382f', boot: '#322c26', helmet: '#85837b', pack: '#45483c', pack2: '#383b32', accent: '#82502f', skin: '#533f35', glove: '#3a3228', mask: true, kit: 'bar', sledge: true },
  { jacket: '#3b4046', trouser: '#36393d', boot: '#2a2a29', helmet: '#979489', pack: '#4b483c', pack2: '#3b3932', accent: '#8a5233', skin: '#69574c', glove: '#26292c', mask: true, kit: 'stretcher' },
];

export default {
  id: 'team', layers: [],
  create(t) {
    const { THREE } = t, low = t.quality === 'low', N = 3;
    const root = new THREE.Group(); root.name = 'team'; t.scene.add(root);
    const uLamp = { value: 1 };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uLamp = uLamp;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aMat; varying vec4 vMat; varying vec3 vRest;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat; vRest = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FIG_PARS).replace('#include <color_fragment>', FIG_COLOR)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(vMat.x + (figN - 0.5) * 0.22, 0.05, 1.0);').replace('#include <normal_fragment_maps>', FIG_NORMAL).replace('#include <emissivemap_fragment>', FIG_EMISSIVE);
    };
    mat.customProgramCacheKey = () => 'hound-rescuer';

    // ---------- rigs ----------
    function makeFig(i) {
      const b = []; const bone = (id, parent, x, y, z) => { const o = new THREE.Bone(); if (parent >= 0) { const p = b[parent].userData.rest; o.position.set(x - p[0], y - p[1], z - p[2]); b[parent].add(o); } else o.position.set(x, y, z); o.userData.rest = [x, y, z]; b[id] = o; };
      bone(HIPS, -1, 0, HIP, 0); bone(SPINE, HIPS, 0, 1.04, 0); bone(CHEST, SPINE, 0, 1.22, 0); bone(NECK, CHEST, -0.008, 1.49, 0); bone(HEAD, NECK, 0, 1.57, 0);
      bone(UAL, CHEST, -0.01, 1.41, -0.19); bone(FAL, UAL, -0.01, 1.13, -0.21); bone(HAL, FAL, 0.004, 0.88, -0.214); bone(UAR, CHEST, -0.01, 1.41, 0.19); bone(FAR, UAR, -0.01, 1.13, 0.21); bone(HAR, FAR, 0.004, 0.88, 0.214);
      bone(THL, HIPS, 0, HIP, -0.097); bone(SHL, THL, 0, HIP - LT, -0.097); bone(FTL, SHL, 0, ANK, -0.097); bone(THR, HIPS, 0, HIP, 0.097); bone(SHR, THR, 0, HIP - LT, 0.097); bone(FTR, SHR, 0, ANK, 0.097);
      const mesh = new THREE.SkinnedMesh(buildFigure(THREE, WEAR[i], low), mat); mesh.name = 'rescuer ' + (i + 1); mesh.add(b[HIPS]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(b));
      mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.scale.setScalar([1, 1.015, 0.965][i]); root.add(mesh);
      b[FTL].rotation.order = b[FTR].rotation.order = 'YZX'; b[HEAD].rotation.order = b[SPINE].rotation.order = b[CHEST].rotation.order = 'YZX';
      const lamp = new THREE.Object3D(); lamp.position.set(0.16, 0.168, 0); lamp.rotation.z = -0.2; b[HEAD].add(lamp);
      const proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.85, 8), new THREE.MeshBasicMaterial({ visible: false })); proxy.position.y = 0.92;
      const hit = new THREE.Group(); hit.add(proxy); root.add(hit); t.pickable(hit, { type: 'unit', id: 'TEAM-1' });
      const foot = () => ({ x: 0, y: 0, h: 0, fx: 0, fy: 0, fh: 0, k: 0, swing: false, pitch: 0, lift: 0 });
      return { i, mesh, b, lamp, hit, x: 0, y: 0, g: 0, h: 0, sp: 0, w: 0, kn: 0, phase: i * 0.37, feet: [foot(), foot()], q: new Float32Array(16), seed: i * 2.3 };
    }
    const figs = [0, 1, 2].map(makeFig);
    const home = (t.world.UNITS.find((u) => u.id === 'TEAM-1') || {}).home || [22, 9];
    const BR = t.world.BUILDING.rect, homeHeading = Math.atan2((BR[1] + BR[3]) / 2 - home[1], (BR[0] + BR[2]) / 2 - home[0]);

    // beams, ground (contact shadows + lamp pools), one real light on the lead's lamp
    const blend = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, transparent: true, depthWrite: false, toneMapped: false };
    const cone = new THREE.CylinderGeometry(0.62, 0.02, 3, low ? 14 : 28, 1, true).rotateZ(-Math.PI / 2).translate(1.5, 0, 0);
    const beam = new THREE.InstancedMesh(cone, new THREE.ShaderMaterial({ vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, side: THREE.DoubleSide, uniforms: { uOpacity: { value: 1 } }, ...blend }), N); beam.frustumCulled = false; beam.renderOrder = 10; root.add(beam);
    const GN = N * 4, gq = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), kind = new Float32Array(GN); for (let i = 0; i < N; i++) { kind[i * 4] = -0.45; kind[i * 4 + 1] = kind[i * 4 + 2] = -0.78; kind[i * 4 + 3] = i ? 1 : low ? 1 : 0.35; }
    gq.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
    const ground = new THREE.InstancedMesh(gq, new THREE.ShaderMaterial({ vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, uniforms: { uLamp }, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, ...blend }), GN); ground.frustumCulled = false; ground.renderOrder = 6; root.add(ground);
    let spot = null; if (!low) { spot = new THREE.SpotLight(0xfff4e2, 5, 9, 0.4, 0.9, 1.6); spot.castShadow = false; root.add(spot, spot.target); }

    // impact dust for the tool
    const DN = low ? 4 : 14, dpos = new Float32Array(DN * 3), dvel = new Float32Array(DN * 3), dseed = new Float32Array(DN);
    for (let i = 0; i < DN; i++) dseed[i] = (i * 0.618) % 1;
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3)); dg.setAttribute('aVel', new THREE.BufferAttribute(dvel, 3)); dg.setAttribute('aSeed', new THREE.BufferAttribute(dseed, 1));
    const dust = new THREE.Points(dg, new THREE.ShaderMaterial({ vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, toneMapped: false, uniforms: { uAge: { value: 9 }, uPx: { value: 500 } } }));
    dust.frustumCulled = false; dust.visible = false; dust.renderOrder = 9; root.add(dust);
    function puff(x, y, nx, ny) {
      for (let i = 0; i < DN; i++) {
        const s = dseed[i], a = s * 6.283 * 3.0, sp = 0.5 + s * 1.1, j = i * 3;
        dpos[j] = x; dpos[j + 1] = t.groundY + 1.05 + Math.sin(a) * 0.12; dpos[j + 2] = -y;
        dvel[j] = nx * sp + Math.cos(a * 1.7) * 0.5; dvel[j + 1] = 0.3 + Math.sin(a) * 0.6; dvel[j + 2] = -(ny * sp + Math.sin(a * 2.3) * 0.5);
      }
      dg.attributes.position.needsUpdate = dg.attributes.aVel.needsUpdate = true;
      dust.material.uniforms.uAge.value = 0; dust.material.uniforms.uPx.value = t.renderer.domElement.height * t.camera.projectionMatrix.elements[5] * 0.5; dust.visible = true;
    }

    const label = t.label('Rescue team 1', { priority: 6, sub: '', sel: { type: 'unit', id: 'TEAM-1' } });

    // The point d metres back along [trail..., pos]. Returns how much of d the history could not cover.
    const bk = { x: 0, y: 0, h: 0 };
    function back(trail, pos, d) {
      let px = pos[0], py = pos[1], left = d; bk.h = NaN;
      for (let i = trail.length - 1; i >= 0; i--) {
        const q = trail[i], l = Math.hypot(px - q[0], py - q[1]);
        if (l < 1e-4) continue;
        if (bk.h !== bk.h || l > 0.2) bk.h = Math.atan2(py - q[1], px - q[0]);
        if (l >= left) { const k = left / l; bk.x = px + (q[0] - px) * k; bk.y = py + (q[1] - py) * k; return 0; }
        left -= l; px = q[0]; py = q[1];
      }
      bk.x = px; bk.y = py; return left;
    }
    function findWall(leg, det) {
      const a = leg.access, b = det.pos; let hk = 2, hit = null;
      for (const w of t.world.wallsCrossed(a, b)) { const k = segHit(a, b, w.a, w.b); if (k >= 0 && k < hk) { hk = k; hit = w; } }
      const dl = dist2(a, b) || 1, ux = (b[0] - a[0]) / dl, uy = (b[1] - a[1]) / dl;
      return hit ? { x: a[0] + (b[0] - a[0]) * hk - ux * 0.15, y: a[1] + (b[1] - a[1]) * hk - uy * 0.15, nx: -ux, ny: -uy } : { x: a[0] + ux * 0.6, y: a[1] + uy * 0.6, nx: -ux, ny: -uy };
    }
    // Where the three stand around a stop: computed once per stop. Nobody is put on the far side of a wall.
    const spots = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; let stopKey = '', wall = null;
    function placeStop(leg, det, u, mode) {
      const A = [u.pos[0], u.pos[1]], set = (i, cx, cy, fx, fy) => {
        let x = cx, y = cy; for (let k = 0; k < 4 && t.world.wallsCrossed(A, [x, y]).length; k++) { x = (x + A[0]) / 2; y = (y + A[1]) / 2; }
        if (t.world.wallsCrossed(A, [x, y]).length) { x = A[0]; y = A[1]; }
        spots[i][0] = x; spots[i][1] = y; spots[i][2] = Math.atan2(fy - y, fx - x);
      };
      if (mode === 'break') {
        wall = findWall(leg, det); const px = -wall.ny, py = wall.nx, bx = wall.x + wall.nx * 0.95, by = wall.y + wall.ny * 0.95;
        set(1, bx, by, wall.x, wall.y); set(0, bx + px * 1.25 + wall.nx * 0.3, by + py * 1.25 + wall.ny * 0.3, wall.x, wall.y); set(2, bx - px * 0.8 + wall.nx * 1.2, by - py * 0.8 + wall.ny * 1.2, wall.x, wall.y);
      } else {
        back(u.trail || [], u.pos, 2); const p = det.pos; let dx = bk.x - p[0], dy = bk.y - p[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        set(0, p[0] + dx * 0.85, p[1] + dy * 0.85, p[0], p[1]);
        set(2, p[0] + dx * 0.25 - dy * 0.95, p[1] + dy * 0.25 + dx * 0.95, p[0], p[1]); set(1, p[0] + dx * 1.7 + dy * 0.9, p[1] + dy * 1.7 - dx * 0.9, p[0], p[1]);
      }
    }

    const watch = stateWatcher(), mound = moundHeight(t), v = new THREE.Vector3(), v2 = new THREE.Vector3(), q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), sc = new THREE.Vector3(), eu = new THREE.Euler(), qg = new THREE.Quaternion();
    const T = new Float32Array(16);
    let swing = 0, lastStrike = 0, workT = 0, labelSub = '';

    function neutral(f, s, kn, out) {                              // where foot s (0 left, 1 right) rests for this stance
      const side = s ? -1 : 1, fw = kn ? (s ? -0.46 : 0.27) : (s ? -0.03 : 0.04) + (f.i === 1 ? (s ? -0.12 : 0.14) : 0), lt = side * (kn ? 0.1 : 0.115), c = Math.cos(f.h), n = Math.sin(f.h);
      out.x = f.x + c * fw - n * lt; out.y = f.y + n * fw + c * lt; out.h = f.h + side * (kn ? 0.05 : 0.16);
    }
    const nt = { x: 0, y: 0, h: 0 };
    function stepFeet(f, moved, dt, fresh, walking, kneel) {
      const L = clamp(0.45 + 0.5 * f.sp, 0.65, 2.6), st = lerp(STANCE, 0.36, clamp((f.sp - 1.6) / 3, 0, 1));
      const c = Math.cos(f.h), n = Math.sin(f.h), fast = f.sp > 4.2;
      if (fresh || t.reduced) { for (let s = 0; s < 2; s++) { const F = f.feet[s]; neutral(f, s, kneel, nt); F.x = nt.x; F.y = nt.y; F.h = nt.h; F.swing = false; F.pitch = kneel && s ? -1.2 : 0; F.lift = 0; } return; }
      if (walking) f.phase += Math.min(moved / L, dt * 2.6);
      for (let s = 0; s < 2; s++) {
        const F = f.feet[s], lt = (s ? -1 : 1) * 0.088; let fp = f.phase + (s ? 0.5 : 0); fp -= Math.floor(fp);
        if (walking) {
          if (fast) { const r = fp < st ? lerp(0.5, -0.5, fp / st) * st * L : lerp(-0.5, 0.5, (fp - st) / (1 - st)) * st * L, rr = clamp(r, -0.5, 0.5); F.x = f.x + c * rr - n * lt; F.y = f.y + n * rr + c * lt; F.h = f.h; F.swing = fp >= st; F.k = F.swing ? (fp - st) / (1 - st) : 0; }
          else if (fp < st) { F.swing = false; F.k = 0; }
          else {
            if (!F.swing) { F.swing = true; F.fx = F.x; F.fy = F.y; F.fh = F.h; }
            const k = (fp - st) / (1 - st), e = k * k * (3 - 2 * k), ah = (1 - fp) * L + st * L * 0.5;
            F.k = k; F.x = lerp(F.fx, f.x + c * ah - n * lt, e); F.y = lerp(F.fy, f.y + n * ah + c * lt, e); F.h = dampAngle(F.fh, f.h + (s ? -0.07 : 0.07), e * 8, 1);
          }
          const a = fp / st, heel = F.swing ? 0.3 * smoothstep(0.5, 1, F.k) : 0.3 * (1 - smoothstep(0, 0.16, a)), toe = F.swing ? 0.58 * (1 - smoothstep(0, 0.5, F.k)) : 0.58 * smoothstep(0.6, 1, a);
          F.pitch = heel - toe; F.lift = F.swing ? Math.sin(Math.PI * F.k) * 0.05 : 0;
        } else {
          neutral(f, s, kneel, nt); const o = f.feet[1 - s], d = Math.hypot(nt.x - F.x, nt.y - F.y); let da = (nt.h - F.h) % 6.283; if (da > Math.PI) da -= 6.283; if (da < -Math.PI) da += 6.283;
          if (!F.swing && !o.swing && (d > 0.09 || Math.abs(da) > 0.5)) { F.swing = true; F.k = 0; F.fx = F.x; F.fy = F.y; F.fh = F.h; }
          if (F.swing) { F.k += dt / (0.34 + Math.min(0.3, d * 0.4)); const k = Math.min(1, F.k), e = k * k * (3 - 2 * k); F.x = lerp(F.fx, nt.x, e); F.y = lerp(F.fy, nt.y, e); F.h = F.fh + (dampAngle(F.fh, nt.h, 30, 1) - F.fh) * e; F.lift = Math.sin(Math.PI * k) * 0.05; if (F.k >= 1) { F.swing = false; F.lift = 0; } }
          else F.lift = 0;
          F.pitch = damp(F.pitch, kneel && s ? -1.2 : 0, 8, dt);
        }
      }
    }

    function legIK(f, s) {
      const F = f.feet[s], b = f.b, TH = b[s ? THR : THL], SH = b[s ? SHR : SHL], FT = b[s ? FTR : FTL], k = f.mesh.scale.x, hips = b[HIPS];
      const c = Math.cos(f.h), n = Math.sin(f.h), wx = (F.x - f.x) / k, wy = (F.y - f.y) / k, p = F.pitch;
      // ankle in the figure's frame; the foot pivots on its ball when the heel is up, on its heel when the toe is up
      let ax, ay; if (p < 0) { const sp = Math.sin(-p), cp = Math.cos(p); ax = 0.13 - 0.13 * cp + ANK * sp; ay = 0.13 * sp + ANK * cp; } else { const sp = Math.sin(p), cp = Math.cos(p); ax = -0.06 + 0.06 * cp - ANK * sp; ay = 0.06 * sp + ANK * cp; }
      let dh = (F.h - f.h) % 6.283; if (dh > Math.PI) dh -= 6.283; if (dh < -Math.PI) dh += 6.283; dh = clamp(dh, -0.7, 0.7);
      v.set(c * wx + n * wy + ax * Math.cos(dh), ay + F.lift + (mound(F.x, F.y) - f.g) / k, -(-n * wx + c * wy + ax * Math.sin(dh)));
      v.sub(hips.position).applyQuaternion(q.copy(hips.quaternion).invert()).sub(TH.position);
      const d = clamp(v.length(), 0.3, LT + LS - 0.002); v.normalize();
      const bd = Math.asin(clamp(v.x, -1, 1)), a = Math.atan2(-v.z, -v.y), al = Math.acos(clamp((LT * LT + d * d - LS * LS) / (2 * LT * d), -1, 1)), kn = Math.PI - Math.acos(clamp((LT * LT + LS * LS - d * d) / (2 * LT * LS), -1, 1));
      TH.rotation.set(a, 0, bd + al); SH.rotation.z = -kn; FT.rotation.set(0, dh, p - (bd + al - kn) - hips.rotation.z);
    }

    function pose(f, mode, dt, fresh, time) {
      const b = f.b, w = f.w, i = f.i, TAU = Math.PI * 2, cL = Math.cos(TAU * f.phase), m = Math.cos(TAU * (f.phase - STANCE / 2)), still = t.reduced ? 0 : 1 - w, br = Math.sin(time * 1.5 + f.seed) * 0.5 * still, sway = Math.sin(time * 0.42 + f.seed * 3) * still;
      const run = clamp((f.sp - 1.6) / 3, 0, 1), A = w * (0.4 + 0.3 * run);
      // T: 0 uaL.z 1 uaL.x 2 faL 3 uaR.z 4 uaR.x 5 faR 6 lean 7 chestYaw 8 headYaw 9 headPitch 10 chestRoll 11 hipsDrop 12 handR 13 headRoll
      T[0] = -A * cL + 0.04; T[1] = 0.1; T[2] = 0.24 + w * (0.12 + 0.2 * Math.max(0, cL)) + run * 0.7; T[3] = A * cL + 0.04; T[4] = -0.1; T[5] = 0.24 + w * (0.12 + 0.2 * Math.max(0, -cL)) + run * 0.7;
      T[6] = 0.05 + 0.05 * w + 0.1 * run + br * 0.01; T[7] = w * 0.13 * cL; T[8] = 0.28 * Math.sin(time * 0.37 + f.seed) * Math.sin(time * 0.23 + f.seed * 2) * (t.reduced ? 0 : 1); T[9] = -0.1 - 0.06 * w; T[10] = -0.03 * m * w + sway * 0.012; T[11] = 0; T[12] = 0; T[13] = 0; T[14] = -0.12; T[15] = 0.12;
      if (i === 1) { T[3] = A * cL * 0.45 + 0.02; T[5] = 0.12 + 0.06 * w; T[12] = 0.2; T[15] = 0; }                                                                     // carries the sledgehammer at his side
      if (i === 0 && mode === 'walk' && w < 0.4) { T[0] = 0.32; T[2] = 2.0; T[1] = 0.12; T[14] = -0.8; }                                                          // hand to the radio while standing
      if (i === 2 && w < 0.4) { T[0] = -0.05; T[3] = 0.2; T[5] = 1.95; T[4] = -0.14; T[15] = 0.75; }                                                                    // thumb on the pack strap
      const work = mode === 'kneel' && i !== 1 && f.kn > 0.4, wk = workT + f.seed;
      if (work) {
        const g = t.reduced ? 0 : 1;
        T[6] = i ? 0.42 : 0.5; T[9] = -0.42; T[8] = 0.12 * Math.sin(wk * 0.7) * g; T[7] = 0.06 * Math.sin(wk * 0.9) * g;
        T[0] = 1.0 + 0.1 * Math.sin(wk * 1.7) * g; T[1] = -0.1; T[2] = 0.55 + 0.16 * Math.sin(wk * 1.7 + 0.8) * g; T[14] = -0.3; T[15] = 0.3; T[3] = 0.86 + 0.13 * Math.sin(wk * 1.3 + 2) * g; T[4] = 0.12; T[5] = 0.75 + 0.18 * Math.sin(wk * 1.3 + 2.8) * g;
      }
      let rate = 7;
      if (mode === 'break' && i === 1 && w < 0.5) { const up = strike; T[0] = lerp(0.75, 1.95, up); T[1] = -0.42; T[2] = lerp(0.35, 1.0, up); T[3] = lerp(0.7, 2.1, up); T[4] = 0.28; T[5] = lerp(0.3, 0.95, up); T[6] = lerp(0.32, -0.04, up); T[7] = lerp(-0.25, 0.4, up); T[9] = -0.05; T[8] = 0; T[12] = lerp(0.25, 0.7, up); T[14] = -0.5; T[15] = 0.25; rate = 24; }
      const k = fresh ? 1 : 1 - Math.exp(-rate * dt), p = f.q;
      for (let j = 0; j < 16; j++) p[j] += (T[j] - p[j]) * k;
      // walking terms are exact functions of the phase, so they must not lag behind the feet
      const wa = (mode === 'break' && i === 1) || work ? 0 : w;
      if (wa > 0.4) { p[7] = lerp(p[7], T[7], 0.6); }
      const H = b[HIPS];
      H.position.set(0.012 * w - 0.02 * f.kn, REST - 0.013 * w * (1 + run * 3) + 0.016 * Math.cos(2 * TAU * (f.phase - STANCE / 2)) * w - (REST - 0.49) * f.kn, -0.024 * m * w + sway * 0.014);
      H.rotation.set(0.055 * m * w + sway * 0.02, -0.1 * cL * w, -0.04 * w);
      b[SPINE].rotation.set(-0.03 * m * w + p[10], p[7] * 0.6 + 0.1 * cL * w * 0.5, -p[6] * 0.55); b[CHEST].rotation.set(-0.02 * m * w, p[7] * 0.6 + 0.1 * cL * w * 0.5, -p[6] * 0.45 + br * 0.012);
      b[NECK].rotation.z = p[6] * 0.35; b[HEAD].rotation.set(0, p[8] - p[7], p[6] * 0.45 + 0.04 * w + p[9]);
      b[UAL].rotation.set(p[1], p[14], p[0]); b[FAL].rotation.z = p[2]; b[UAR].rotation.set(p[4], p[15], p[3]); b[FAR].rotation.z = p[5]; b[HAR].rotation.z = -p[12]; b[HAL].rotation.z = 0.12;
      legIK(f, 0); legIK(f, 1);
    }
    let strike = 0.25;

    return {
      update(state, dt, time) {
        const fresh = watch(state), u = state.units['TEAM-1'];
        if (!u) { root.visible = false; return; }
        root.visible = true;
        const r = state.routes && state.routes.rescue, trail = u.trail || [];
        // what the team is doing, from state
        let act = null, mode = 'walk', last = null;
        if (r && u.v === 0) for (const leg of r.legs) if (leg.ok && leg.arrivedAt != null) { last = leg; if (state.t - leg.arrivedAt < 4.3) act = leg; }
        if (!act && state.phase === 'complete') act = last;                     // they stay with the last person
        const det = act && state.detections.find((d) => d.id === act.det);
        if (act && det && det.pos && det.status !== 'rejected') { mode = act.kind === 'break through' ? 'break' : 'kneel'; if (stopKey !== act.det) { stopKey = act.det; placeStop(act, det, u, mode); } } else stopKey = '';
        const sub = mode === 'break' ? 'breaking through' : mode === 'kneel' ? 'with the person' : u.v > 0 && r && r.status === 'approved' ? 'walking in' : '';
        if (sub !== labelSub) { labelSub = sub; label.setSub(sub); }

        // the work runs in real time, only while the mission clock runs
        const live = !t.reduced && state.running && !state.hold;
        if (live) workT += dt;
        if (mode === 'break') {
          strike = 0.25;
          if (live && figs[1].sp < 0.15) {
            swing += dt * 0.85; const p = swing % 1;
            strike = p < 0.64 ? (1 - Math.cos((p / 0.64) * Math.PI)) / 2 : 1 - Math.pow((p - 0.64) / 0.36, 2.4);
            if (Math.floor(swing) > lastStrike) { lastStrike = Math.floor(swing); puff(wall.x, wall.y, wall.nx, wall.ny); }
          }
        } else { swing = 0; lastStrike = 0; }
        if (dust.visible) { const ua = dust.material.uniforms.uAge; ua.value += dt; if (ua.value > 1.3 || fresh) dust.visible = false; }

        const atHome = u.odo < 0.05 && trail.length <= 1, vmax = Math.max(1.7, (u.v || 0) * (state.speed || 1) * 1.7) * dt;
        for (let i = 0; i < N; i++) {
          const f = figs[i];
          let tx, ty, th;
          if (mode !== 'walk') { tx = spots[i][0]; ty = spots[i][1]; th = spots[i][2]; }
          else {
            const d = BACK[i], left = d ? back(trail, u.pos, d) : 0, fr = d ? left / d : 0;
            if (!d) { bk.x = u.pos[0]; bk.y = u.pos[1]; bk.h = atHome ? homeHeading : u.heading; }
            const c = Math.cos(homeHeading), s = Math.sin(homeHeading), ob = FORM[i][0] * fr, ol = FORM[i][1] * fr;
            th = fr > 0.5 || bk.h !== bk.h ? homeHeading : bk.h;
            const lat = LAT[i] * (1 - fr);
            tx = bk.x + c * ob - s * ol - Math.sin(th) * lat; ty = bk.y + s * ob + c * ol + Math.cos(th) * lat;
          }
          let moved = 0;
          if (fresh) { f.x = tx; f.y = ty; f.h = th; f.w = 0; f.sp = 0; f.kn = mode === 'kneel' && i !== 1 ? 1 : 0; }
          else {
            const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy), st = Math.min(d * (1 - Math.exp(-9 * dt)), vmax);
            if (d > 1e-5) { f.x += (dx / d) * st; f.y += (dy / d) * st; moved = st; }
            const turn = mode !== 'walk' && d > 0.3 ? Math.atan2(dy, dx) : th;      // walk to the spot facing it, then turn to the person
            f.h = dampAngle(f.h, turn, 5, dt);
          }
          f.sp = damp(f.sp, dt > 0 ? moved / dt : 0, 8, dt);
          const walking = !t.reduced && f.sp > 0.14, kneel = mode === 'kneel' && i !== 1 && f.sp < 0.2;
          if (walking && f.w < 0.05) f.phase = STANCE - 0.01;                          // the left foot leaves first
          f.w = fresh ? 0 : damp(f.w, walking ? 1 : 0, walking ? 5 : 7, dt);
          f.kn = fresh ? f.kn : damp(f.kn, kneel ? 1 : 0, 3.2, dt);
          stepFeet(f, moved, dt, fresh, walking, kneel ? 1 : 0);
          const g0 = mound(f.feet[0].x, f.feet[0].y), g1 = mound(f.feet[1].x, f.feet[1].y), gt = Math.min(g0, g1) * 0.7 + Math.max(g0, g1) * 0.3;   // the body rides nearer the lower foot
          f.g = fresh ? gt : damp(f.g, gt, 9, dt); const gy = t.groundY + f.g;
          pose(f, mode, dt, fresh, time);
          const M = f.mesh; M.position.set(f.x, gy, -f.y); M.rotation.y = f.h; M.updateMatrixWorld(true);
          f.hit.position.set(f.x, gy, -f.y);
          // lamp: beam, pool on the ground, the lead's real light
          beam.setMatrixAt(i, f.lamp.matrixWorld);
          v.setFromMatrixPosition(f.lamp.matrixWorld); v2.set(1, 0, 0).transformDirection(f.lamp.matrixWorld);
          const reach = v2.y < -0.08 ? Math.min(5, (v.y - gy) / -v2.y) : 5, hx = v.x + v2.x * reach, hz = v.z + v2.z * reach;
          ground.setMatrixAt(i * 4 + 3, m4.compose(sc.set(hx, t.groundY + mound(hx, -hz) + 0.02, hz), qg.setFromEuler(eu.set(0, Math.atan2(-v2.z, v2.x), 0)), v2.set(Math.min(4.6, 1.2 + reach * 0.8), 1, Math.min(2.4, 0.8 + reach * 0.35))));
          if (i === 0 && spot) { spot.position.copy(v); spot.target.position.set(hx, gy, hz); spot.target.updateMatrixWorld(); spot.updateMatrixWorld(); }
          // contact shadows
          qg.setFromEuler(eu.set(0, f.h, 0)); const kn = f.kn;
          ground.setMatrixAt(i * 4, m4.compose(v.set(f.x, t.groundY + mound(f.x, f.y) + 0.017, -f.y), qg, v2.set(1.0 + kn * 0.2, 1, 0.85)));
          for (let s = 0; s < 2; s++) { const F = f.feet[s], g = 1 - F.lift * 6; ground.setMatrixAt(i * 4 + 1 + s, m4.compose(v.set(F.x + Math.cos(F.h) * 0.05, t.groundY + mound(F.x, F.y) + 0.019, -(F.y + Math.sin(F.h) * 0.05)), qg.setFromEuler(eu.set(0, F.h, 0)), v2.set(0.46 * g, 1, 0.28 * g))); }
        }
        beam.instanceMatrix.needsUpdate = true; ground.instanceMatrix.needsUpdate = true;
        label.setPosition(v.set(figs[0].x, t.groundY + figs[0].g + 2.05, -figs[0].y));
      },
      setLayer() {},
      onSelect(sel) { label.setSelected?.(!!sel && sel.type === 'unit' && sel.id === 'TEAM-1'); },
      dispose() { label.remove(); for (const f of figs) { f.mesh.skeleton.dispose(); t.unpickable?.(f.hit); } spot?.dispose(); beam.dispose(); ground.dispose(); disposeTree(root); },
    };
  },
};
