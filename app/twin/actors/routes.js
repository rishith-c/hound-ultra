// Routes on the ground: the rover's path ahead, its tyre ruts, the team's boot prints, and the rescue route: light that
// falls on the mud, bends visibly around hazards and draws itself outward from the entrance when it is planned.
// Driven by state.units[..].path / .trail, state.routes.rescue and the hazards. Simulated.
import { palette, Y, SCALE, damp, clamp, smoothstep, stateWatcher, ribbonGeometry, groundText, smoothPath, disposeTree, decalMaterial, dist2, FONT } from './common.js';

const REVEAL_S = 3.2;                 // how long the rescue route takes to draw itself
const HAZ_NEAR = 2.6;                 // metres from a hazard at which the route shows that it is being pushed

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Rover path: a hair-thin soft line that never gets thinner than a pixel; only the next few metres show.
const PATH_FRAG = /* glsl */ `
uniform vec3 uColor, uHot; uniform float uDriven, uLen, uPulse, uPulseAmt, uOpacity;
varying vec2 vUv;
void main() {
  float s = vUv.x, y = abs(vUv.y) * 0.25, fw = fwidth(vUv.y) * 0.25, ahead = s - uDriven;
  float hw = max(0.02, fw * 0.8);
  float line = exp(-y * y / (hw * hw)) * min(1.0, 0.02 / hw + 0.3);
  float a = line * 0.6 + exp(-y * y / 0.006) * 0.07;
  a *= smoothstep(0.55, 1.4, ahead) * (1.0 - smoothstep(2.5, 8.5, ahead)) * (1.0 - smoothstep(uLen - 0.5, uLen - 0.1, s));
  float p = exp(-pow((s - uPulse) / 0.7, 2.0)) * uPulseAmt;
  gl_FragColor = vec4(mix(uColor, uHot, p * 0.5) * (0.62 + p * 0.25), clamp(a * (1.0 + p * 0.5) * uOpacity, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

const RING_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity;
varying vec2 vUv;
void main() {
  float r = length(vUv) , w = fwidth(r);
  float ring = smoothstep(0.86 - w, 0.86 + w * 0.5, r) * (1.0 - smoothstep(0.91 - w * 0.5, 0.91 + w, r));
  float dot_ = 1.0 - smoothstep(0.06 - w, 0.06 + w, r);
  gl_FragColor = vec4(uColor * 0.7, clamp(max(ring, dot_) * 0.5, 0.0, 1.0) * uOpacity);
  #include <colorspace_fragment>
}`;

// Tyre ruts: two pressed tracks with the oblique print of mecanum rollers, lit by the scene. uv = metres along, across.
const RUT_PARS = /* glsl */ `
varying vec2 vR; uniform float uEnd, uTrack;
float rutH, rutIn, rutA;
float rh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(rh(i), rh(i + vec2(1, 0)), f.x), mix(rh(i + vec2(0, 1)), rh(i + vec2(1, 1)), f.x), f.y); }`;
const RUT_MAP = /* glsl */ `
{
  float s = vR.x, sg = vR.y > 0.0 ? 1.0 : -1.0, b = abs(vR.y) - uTrack, fw = fwidth(vR.y);
  b += (rn(vec2(s * 1.3, sg * 9.0)) - 0.5) * 0.012;
  float hw = max(0.036, fw * 0.7), ab = abs(b);
  float rag = (rn(vec2(s * 22.0, b * 40.0 + sg * 5.0)) - 0.5) * 0.014;
  rutIn = 1.0 - smoothstep(hw - 0.006 - fw * 0.4, hw + 0.006 + fw * 0.4, ab + rag);
  float lip = exp(-pow((ab + rag - hw - 0.014) / 0.013, 2.0));
  float u = (s + b * sg * 1.0) / 0.047, wu = fwidth(u);
  float tr = mix(0.5 + 0.5 * cos(6.2831853 * u), 0.5, smoothstep(0.25, 0.7, wu));
  float wear = smoothstep(0.18, 0.5, rn(vec2(s * 0.9, sg * 3.0)) * 0.7 + rn(vR * vec2(4.0, 12.0)) * 0.3);
  rutH = -rutIn * (0.007 + 0.006 * tr) * wear + lip * 0.006 * wear + (rn(vR * 70.0) - 0.5) * 0.0016 * rutIn;
  vec3 c = mix(vec3(0.05, 0.043, 0.035), vec3(0.018, 0.016, 0.014), rutIn * (0.4 + 0.6 * tr));
  diffuseColor.rgb = mix(c, vec3(0.16, 0.14, 0.115), lip * (1.0 - rutIn) * 0.8);
  rutA = max(rutIn * (0.45 + 0.33 * tr), lip * 0.3) * (0.3 + 0.7 * wear);
  diffuseColor.a *= rutA * min(1.0, 0.036 / hw + 0.25) * (1.0 - smoothstep(uEnd - 0.5, uEnd - 0.05, s)) * smoothstep(0.0, 0.8, s) * mix(0.62, 1.0, exp(-max(uEnd - s, 0.0) / 30.0));
  if (diffuseColor.a < 0.01) discard;
}`;
const RUT_NORMAL = /* glsl */ `
{
  vec3 sp = -vViewPosition, dx = dFdx(sp), dy = dFdy(sp), r1 = cross(dy, normal), r2 = cross(normal, dx);
  float det = dot(dx, r1); vec3 gr = sign(det) * (dFdx(rutH) * r1 + dFdy(rutH) * r2), nb = abs(det) * normal - gr * (1.0 - smoothstep(0.004, 0.011, max(length(dx), length(dy)))); float ln = length(nb);
  if (ln > 1e-9) normal = nb / ln;
}`;

// Boot prints: sole and heel with lugs, pressed dark.
const BOOT_VERT = /* glsl */ `
attribute float aIdx; uniform float uCount; varying vec2 vP; varying float vFade; varying float vD; varying float vSeed;
void main() {
  vP = uv - 0.5; vSeed = fract(aIdx * 0.6180); vFade = 0.45 + 0.55 * exp(-max(uCount - aIdx, 0.0) / 60.0);
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv;
}`;
const BOOT_FRAG = /* glsl */ `
varying vec2 vP; varying float vFade; varying float vD; varying float vSeed;
void main() {
  vec2 p = vP * vec2(0.3, 0.115);
  float hw = 0.036 + 0.012 * smoothstep(-0.02, 0.07, p.x) - 0.011 * smoothstep(-0.02, -0.06, p.x) * 0.5;
  float sole = max(length(vec2(max(abs(p.x - 0.045) - 0.05, 0.0), p.y)) - hw, 0.0), heel = max(length(vec2(max(abs(p.x + 0.095) - 0.012, 0.0), p.y)) - 0.034, 0.0);
  float m = 1.0 - smoothstep(0.0, 0.007, min(sole, heel));
  float lug = smoothstep(0.25, 0.5, abs(fract((p.x + abs(p.y) * 0.45) / 0.021 + 0.2) - 0.5) * 2.0);
  float a = m * mix(0.34 + 0.3 * lug, 0.5, smoothstep(5.0, 11.0, vD)) * vFade * (0.6 + 0.4 * vSeed) * (1.0 - smoothstep(16.0, 34.0, vD));
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.017, 0.0155, 0.0135), a);
  #include <colorspace_fragment>
}`;

// ---- light on the ground ----
// These decals are blended as  result = light + ground * gain:  the ground's own detail is lifted as if lit, and only a
// little colour is added. So they read as light falling on mud and concrete instead of paint lying over it.
const lightBlend = (THREE) => ({ blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
const NOISE = /* glsl */ `
float nh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(nh(i), nh(i + vec2(1, 0)), f.x), mix(nh(i + vec2(0, 1)), nh(i + vec2(1, 1)), f.x), f.y); }`;
const RESCUE_VERT = /* glsl */ `
attribute float aHaz; varying vec2 vUv; varying float vHaz; varying vec2 vP; varying float vD;
void main() { vUv = uv; vHaz = aHaz; vP = position.xz; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`;
const RESCUE_FRAG = /* glsl */ `
${NOISE}
uniform vec3 uColor, uOk, uHaz; uniform float uLen, uOff, uFront, uBack, uHead, uDone, uFlow, uFlowAmt, uRank, uCalm, uPlanned, uFadeIn;
varying vec2 vUv; varying float vHaz; varying vec2 vP; varying float vD;
void main() {
  float s = vUv.x, S = s + uOff, y = vUv.y, ay = abs(y), fy = fwidth(y);
  float shown = smoothstep(uBack - 0.2, uBack + 0.9, S) * (1.0 - smoothstep(uFront - 0.9, uFront + 0.2, S));
  if (shown < 0.002) discard;
  float n = nn(vP * 1.7) * 0.4 + nn(vP * 6.5) * 0.35 + nn(vP * 23.0) * 0.25;
  float sig = mix(0.2, 0.12, uRank); sig = max(sig, fy * 0.9);
  float core = exp(-y * y / (2.0 * sig * sig)), skirt = exp(-y * y / (2.0 * sig * sig * 5.0));
  float lw = max(0.02, fy * 0.6), spine = exp(-y * y / (2.0 * lw * lw)) * min(1.0, 0.02 / lw + 0.25);
  float I = core * (0.5 + 1.0 * n) + skirt * 0.16 * (0.4 + 1.2 * n) + spine * 0.3 * (0.6 + 0.8 * n);

  float left = s - uDone, done = 1.0 - smoothstep(-1.2, 0.2, left);
  float lead = (1.0 - smoothstep(0.0, 9.0, max(left, 0.0))) * (1.0 - done) * uFlowAmt;       // brightest just ahead of the team
  float q = fract((s - uFlow) / 6.5), pulse = exp(-pow((q - 0.5) * 6.5 / 0.42, 2.0)) * uFlowAmt * (1.0 - done);
  float head = (exp(-abs(S - uFront) / 0.9) + exp(-abs(S - uBack) / 0.9)) * uHead;
  I *= (1.0 + 0.55 * lead + 1.1 * pulse * core + 2.2 * head) * mix(1.0, 0.22, done);

  float u = (s + ay * 0.8 - uFlow * 0.5) / 1.5, wu = fwidth(u);                              // chevrons, only close up
  float chev = (1.0 - smoothstep(0.016, 0.016 + wu + 0.012, abs(fract(u) - 0.5))) * (1.0 - smoothstep(0.1, 0.16, ay)) * smoothstep(0.0, 0.02, ay + 0.02);
  chev *= (1.0 - smoothstep(6.0, 17.0, vD)) * (1.0 - done) * (1.0 - uRank * 0.7);
  I += chev * 0.6;

  // Where a hazard is near, its distance field shows as fine lines between the route and the hazard, and the near
  // side of the light takes a little of the hazard's colour: the route is being pushed.
  float near = smoothstep(${HAZ_NEAR.toFixed(1)}, 0.5, vHaz), inside = smoothstep(0.1, -0.5, vHaz);
  float iu = vHaz / 0.3, wi = fwidth(iu), iso = (1.0 - smoothstep(0.03, 0.03 + wi * 1.3, abs(fract(iu) - 0.5))) * (1.0 - smoothstep(0.35, 0.8, wi));
  iso *= near * (1.0 - inside) * smoothstep(0.25, 0.5, ay) * (1.0 - smoothstep(0.95, 1.6, ay)) * (1.0 - smoothstep(14.0, 40.0, vD) * 0.6);
  float edge = near * (1.0 - inside) * skirt * smoothstep(0.02, 0.3, ay) * 0.5;

  float k = shown * mix(1.0, 0.42, uRank) * mix(1.0, 0.8, uPlanned) * mix(1.0, 0.3, uCalm);
  k *= mix(1.0, smoothstep(0.0, 1.2, s), uFadeIn) * (1.0 - smoothstep(uLen - 0.9, uLen - 0.1, s));
  vec3 col = mix(mix(uColor, vec3(0.8, 0.9, 1.0), 0.22 + 0.3 * min(1.0, head + chev)), uOk, uCalm * 0.3);
  col = mix(col, uHaz, inside * 0.1);
  vec3 light = col * I * 0.23 * k + mix(uHaz, vec3(0.5, 0.42, 0.4), 0.35) * (iso * 0.055 + edge * 0.045) * (0.5 + n) * k * (1.0 - done);
  gl_FragColor = vec4(light, 1.0 + I * 0.6 * k);
}`;
const POOL_FRAG = /* glsl */ `
${NOISE}
uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; varying vec2 vPw;
void main() {
  float r = length(vUv), n = nn(vPw * 2.1) * 0.5 + nn(vPw * 9.0) * 0.5;
  float I = exp(-r * r * 3.4) * (1.0 - smoothstep(0.75, 1.0, r)) * (0.55 + 0.9 * n) * uOpacity;
  gl_FragColor = vec4(mix(uColor, vec3(0.85, 0.92, 1.0), 0.55) * I * 0.05, 1.0 + I * 0.75);
}`;
const POOL_VERT = /* glsl */ `varying vec2 vUv; varying vec2 vPw;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vPw = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;

// The door-sized outline standing on the wall: dashed sides, solid corner brackets.
const DOOR_FRAG = /* glsl */ `
uniform vec3 uColor; uniform vec2 uSize; uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * (uSize + 0.16), hs = uSize * 0.5, q = abs(p) - hs;
  float d = abs(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0)), w = fwidth(d);
  vec2 c = hs - abs(p);
  float corner = step(max(c.x, c.y), 0.26);
  float along = (c.x < c.y) ? p.y : p.x;
  float dash = step(abs(fract(along / 0.2) - 0.5), 0.27);
  float lw = mix(0.004, 0.009, corner);
  float line = (1.0 - smoothstep(lw, lw + w * 1.4, d)) * mix(dash * 0.35, 0.95, corner);
  float fill = step(max(q.x, q.y), 0.0) * (0.015 + 0.11 * exp(-min(c.x, c.y) / 0.1)) + exp(-d / 0.03) * 0.05;
  gl_FragColor = vec4(mix(uColor, vec3(0.85, 0.92, 1.0), line * 0.35) * 0.75, clamp(max(line, fill), 0.0, 1.0) * uOpacity);
  #include <colorspace_fragment>
}`;
// Floor chevrons in front of the wall (uv.x = metres toward the wall) and the dotted line through it.
const FLOOR_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity, uLen, uDots;
varying vec2 vUv;
void main() {
  float s = vUv.x, ay = abs(vUv.y), a;
  if (uDots > 0.5) {
    vec2 p = vec2((fract(s / 0.34) - 0.5) * 0.34, vUv.y * 0.07);
    float d = length(p), w = fwidth(d), hw = max(0.016, w * 0.8);
    a = (1.0 - smoothstep(hw - w, hw + w, d)) * 0.55;
  } else {
    float u = (s + ay * 0.26) / 0.36, wu = fwidth(u);
    a = (1.0 - smoothstep(0.03, 0.03 + wu * 1.2, abs(fract(u) - 0.5))) * (1.0 - smoothstep(0.35, 0.6, ay));
    a *= smoothstep(0.0, 0.25, s) * (0.06 + 0.22 * s / uLen) * step(s, uLen - 0.02);
  }
  gl_FragColor = vec4(uColor * 0.75, clamp(a, 0.0, 1.0) * uOpacity);
  #include <colorspace_fragment>
}`;

// Distance from p to a polygon's edge, negative inside.
function polyDist(p, poly) {
  let d = Infinity, c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], dx = b[0] - a[0], dy = b[1] - a[1], k = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    d = Math.min(d, Math.hypot(p[0] - a[0] - dx * k, p[1] - a[1] - dy * k));
    if ((b[1] > p[1]) !== (a[1] > p[1]) && p[0] < ((a[0] - b[0]) * (p[1] - b[1])) / (a[1] - b[1]) + b[0]) c = !c;
  }
  return c ? -d : d;
}
// Points about "step" apart along a path.
function resample(path, step) {
  const out = [path[0].slice()]; let left = step;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], l = dist2(a, b); let d = left;
    while (d <= l) { out.push([a[0] + (b[0] - a[0]) * d / l, a[1] + (b[1] - a[1]) * d / l]); d += step; }
    left = d - l;
  }
  const e = path[path.length - 1]; if (dist2(out[out.length - 1], e) > step * 0.3) out.push(e.slice()); else out[out.length - 1] = e.slice();
  return out;
}
// Height of the mud mounds above the floor at a world point (0 elsewhere). The mounds are regular grids of vertices.
export function moundHeight(t) {
  const grids = [];
  for (const name of ['corridor-mud', 'ne-mud', 'field-mud']) {
    const m = t.scene.getObjectByName(name); if (!m) continue;
    const p = m.geometry.attributes.position; m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox;
    const res = Math.max(Math.abs(p.getZ(1) - p.getZ(0)), Math.abs(p.getX(1) - p.getX(0))), nx = Math.round((b.max.x - b.min.x) / res) + 1, nz = Math.round((b.max.z - b.min.z) / res) + 1, h = new Float32Array(nx * nz);
    for (let i = 0; i < p.count; i++) h[Math.round((p.getZ(i) - b.min.z) / res) * nx + Math.round((p.getX(i) - b.min.x) / res)] = p.getY(i);
    grids.push({ x: b.min.x, z: b.min.z, res, nx, nz, h });
  }
  return (x, y) => {
    let top = 0;
    for (const g of grids) {
      const u = (x - g.x) / g.res, w = (-y - g.z) / g.res, i = Math.floor(u), j = Math.floor(w); if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.nz - 1) continue;
      const k = j * g.nx + i, a = u - i, b = w - j;
      top = Math.max(top, (g.h[k] * (1 - a) + g.h[k + 1] * a) * (1 - b) + (g.h[k + g.nx] * (1 - a) + g.h[k + g.nx + 1] * a) * b);
    }
    return top;
  };
}
// The route's ribbon: seven columns across (the outer ones carry the hazard distance), uv = metres along and across.
const COLS = [-1.65, -0.8, -0.4, 0, 0.4, 0.8, 1.65];
function routeGeometry(THREE, pts, hazards, mound) {
  const n = pts.length, C = COLS.length, pos = new Float32Array(n * C * 3), uv = new Float32Array(n * C * 2), hz = new Float32Array(n * C), idx = []; let s = 0;
  const p = [0, 0];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    if (i) s += dist2(pts[i - 1], pts[i]);
    for (let c = 0; c < C; c++) {
      const k = i * C + c; p[0] = pts[i][0] - dy * COLS[c]; p[1] = pts[i][1] + dx * COLS[c];
      const up = mound(p[0], p[1]); pos.set([p[0], up + Math.min(0.03, up), -p[1]], k * 3); uv.set([s, COLS[c]], k * 2);
      let d = 9; for (const h of hazards) { const q = polyDist(p, h.poly); if (Math.abs(q) < Math.abs(d) || (q < 0 && d > 0)) d = q; } hz[k] = d;
      if (i < n - 1 && c < C - 1) idx.push(k, k + C, k + 1, k + 1, k + C, k + C + 1);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aHaz', new THREE.BufferAttribute(hz, 1)); g.setIndex(idx); g.userData.length = s; return g;
}

// Where the segment p->q crosses the segment a->b: fraction along p->q, or -1.
function segHit(p, q, a, b) {
  const rx = q[0] - p[0], ry = q[1] - p[1], sx = b[0] - a[0], sy = b[1] - a[1], den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const k = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / den, m = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / den;
  return k >= 0 && k <= 1 && m >= 0 && m <= 1 ? k : -1;
}

export default {
  id: 'routes', layers: ['route', 'trail'],
  create(t) {
    const { THREE } = t, pal = palette(t), low = t.quality === 'low';
    const root = new THREE.Group(); root.name = 'routes'; t.scene.add(root);
    const routeG = new THREE.Group(), trailG = new THREE.Group(); root.add(routeG, trailG);
    const watch = stateWatcher(), mound = moundHeight(t);
    const on = { route: true, trail: true }; let demo = false;
    const white = new THREE.Color(1, 1, 1), m4 = new THREE.Matrix4();

    // ---------- rover path ----------
    const pathU = { uColor: { value: new THREE.Color() }, uHot: { value: white }, uDriven: { value: 0 }, uLen: { value: 1 }, uPulse: { value: 0 }, uPulseAmt: { value: 0 }, uOpacity: { value: 1 } };
    const pathMesh = new THREE.Mesh(new THREE.BufferGeometry(), decalMaterial(THREE, { vertexShader: VERT, fragmentShader: PATH_FRAG, uniforms: pathU }));
    pathMesh.position.y = t.groundY + 0.02; pathMesh.renderOrder = 5; pathMesh.visible = false; pathMesh.frustumCulled = false; routeG.add(pathMesh);
    const goalG = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); { const uv = goalG.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 - 1, uv.getY(i) * 2 - 1); }
    const goal = new THREE.Mesh(goalG, decalMaterial(THREE, { vertexShader: VERT, fragmentShader: RING_FRAG, uniforms: { uColor: pathU.uColor, uOpacity: { value: 1 } } }));
    goal.scale.setScalar(0.8); goal.renderOrder = 5; goal.visible = false; routeG.add(goal);
    const P = { n: -1, x0: 0, y0: 0, x1: 0, y1: 0, cum: null, seg: 1, pulse: 0 };
    function syncPath(state, dt, fresh) {
      const u = state.units['HOUND-01'], p = u && u.path;
      if (!p || p.length < 2) { if (pathMesh.visible) { pathMesh.visible = goal.visible = false; P.n = -1; } return; }
      const a = p[0], b = p[p.length - 1];
      if (P.n !== p.length || P.x0 !== a[0] || P.y0 !== a[1] || P.x1 !== b[0] || P.y1 !== b[1]) {
        pathMesh.geometry.dispose(); pathMesh.geometry = ribbonGeometry(THREE, p, 0.5);
        P.n = p.length; P.x0 = a[0]; P.y0 = a[1]; P.x1 = b[0]; P.y1 = b[1];
        P.cum = new Float32Array(p.length); for (let i = 1; i < p.length; i++) P.cum[i] = P.cum[i - 1] + dist2(p[i - 1], p[i]);
        P.seg = 0; pathU.uLen.value = P.cum[p.length - 1]; P.pulse = 0;
        goal.position.copy(t.v3(b, t.groundY + Y.path)); pathMesh.visible = goal.visible = true;
      }
      // distance already driven: closest point, searched near where the rover was last frame
      const lo = P.seg ? Math.max(1, P.seg - 1) : 1, hi = P.seg ? Math.min(p.length - 1, P.seg + 8) : p.length - 1;
      let bd = Infinity, bs = 0, bi = lo;
      for (let i = lo; i <= hi; i++) {
        const q0 = p[i - 1], q1 = p[i], dx = q1[0] - q0[0], dy = q1[1] - q0[1], l2 = dx * dx + dy * dy;
        const k = l2 ? clamp(((u.pos[0] - q0[0]) * dx + (u.pos[1] - q0[1]) * dy) / l2, 0, 1) : 0;
        const d = Math.hypot(u.pos[0] - q0[0] - dx * k, u.pos[1] - q0[1] - dy * k);
        if (d < bd) { bd = d; bi = i; bs = P.cum[i - 1] + Math.sqrt(l2) * k; }
      }
      P.seg = bi; pathU.uDriven.value = bs;
      const moving = !t.reduced && u.v > 0 && state.running;
      pathU.uPulseAmt.value = damp(pathU.uPulseAmt.value, moving ? 1 : 0, 5, dt);
      const left = pathU.uLen.value - bs;
      if (pathU.uPulseAmt.value > 0.01) { P.pulse += dt * Math.max(7, left / 2.4); if (P.pulse > left + 6) P.pulse = 0; }
      pathU.uPulse.value = bs + P.pulse;
    }

    // ---------- tyre ruts ----------
    // Rows of the ribbon are added as the trail grows; only the last two metres (which still bend) are rewritten.
    const SUB = 4, RCAP = low ? 260 : 600, HALF = 0.46, RROWS = RCAP * SUB + 1;
    const ruts = (() => {
      const pos = new Float32Array(RROWS * 6), nor = new Float32Array(RROWS * 6), uv = new Float32Array(RROWS * 4), ix = new Uint32Array((RROWS - 1) * 6);
      for (let i = 0; i < RROWS; i++) { nor[i * 6 + 1] = nor[i * 6 + 4] = 1; if (i < RROWS - 1) { const k = i * 2; ix.set([k, k + 2, k + 1, k + 1, k + 2, k + 3], i * 6); } }
      const g = new THREE.BufferGeometry(), ap = new THREE.BufferAttribute(pos, 3), au = new THREE.BufferAttribute(uv, 2); ap.setUsage(THREE.DynamicDrawUsage); au.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', ap); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', au); g.setIndex(new THREE.BufferAttribute(ix, 1)); g.setDrawRange(0, 0);
      const uEnd = { value: 0 }, mat = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uEnd = uEnd; sh.uniforms.uTrack = { value: 0.212 * SCALE.rover };
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vR;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvR = uv;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + RUT_PARS).replace('#include <map_fragment>', RUT_MAP)
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.92, 0.62, rutIn);').replace('#include <normal_fragment_maps>', RUT_NORMAL);
      };
      mat.customProgramCacheKey = () => 'hound-ruts';
      const mesh = new THREE.Mesh(g, mat); mesh.position.y = t.groundY + 0.014; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.renderOrder = 4; trailG.add(mesh);
      return { mesh, pos, uv, ap, au, uEnd, src: 0, cum: new Float32Array(RROWS), lx: NaN, ly: NaN };
    })();
    function rutPoint(tr, pos, i) { return i < 0 ? tr[0] : i < tr.length ? tr[i] : pos; }
    function syncRuts(state, fresh) {
      const u = state.units['HOUND-01'], tr = u && u.trail; if (!tr) return;
      const segs = Math.min(tr.length, RCAP);
      if (!fresh && segs === ruts.src && u.pos[0] === ruts.lx && u.pos[1] === ruts.ly) return;
      const first = fresh || segs < ruts.src ? 0 : Math.max(0, Math.min(ruts.src, segs) - 2);
      const P0 = ruts.pos, UV = ruts.uv, rows = segs * SUB + 1;
      for (let r = first * SUB; r < rows; r++) {
        const g = Math.min(segs - 1, Math.floor(r / SUB)), k = (r - g * SUB) / SUB, k2 = k * k, k3 = k2 * k;
        const a = rutPoint(tr, u.pos, g - 1), b = rutPoint(tr, u.pos, g), c = rutPoint(tr, u.pos, g + 1), d = rutPoint(tr, u.pos, g + 2);
        const x = 0.5 * (2 * b[0] + (c[0] - a[0]) * k + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * k2 + (3 * b[0] - a[0] - 3 * c[0] + d[0]) * k3);
        const y = 0.5 * (2 * b[1] + (c[1] - a[1]) * k + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * k2 + (3 * b[1] - a[1] - 3 * c[1] + d[1]) * k3);
        let dx = 0.5 * ((c[0] - a[0]) + 2 * (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * k + 3 * (3 * b[0] - a[0] - 3 * c[0] + d[0]) * k2), dy = 0.5 * ((c[1] - a[1]) + 2 * (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * k + 3 * (3 * b[1] - a[1] - 3 * c[1] + d[1]) * k2);
        const l = Math.hypot(dx, dy); if (l > 1e-4) { dx /= l; dy /= l; } else { dx = Math.cos(u.heading); dy = Math.sin(u.heading); }
        const j = r * 6, w = r * 4; let s = 0;
        if (r) { const mx = (P0[j - 6] + P0[j - 3]) / 2, mz = (P0[j - 4] + P0[j - 1]) / 2; s = ruts.cum[r - 1] + Math.hypot(x - mx, -y - mz); }
        ruts.cum[r] = s;
        P0[j] = x + dy * HALF; P0[j + 1] = 0; P0[j + 2] = -(y - dx * HALF); P0[j + 3] = x - dy * HALF; P0[j + 4] = 0; P0[j + 5] = -(y + dx * HALF);
        UV[w] = s; UV[w + 1] = -HALF; UV[w + 2] = s; UV[w + 3] = HALF;
      }
      const r0 = first * SUB; ruts.ap.clearUpdateRanges(); ruts.au.clearUpdateRanges(); ruts.ap.addUpdateRange(r0 * 6, (rows - r0) * 6); ruts.au.addUpdateRange(r0 * 4, (rows - r0) * 4); ruts.ap.needsUpdate = ruts.au.needsUpdate = true;
      ruts.mesh.geometry.setDrawRange(0, (rows - 1) * 6); ruts.uEnd.value = ruts.cum[rows - 1]; ruts.src = segs; ruts.lx = u.pos[0]; ruts.ly = u.pos[1];
    }

    // ---------- boot prints of the team ----------
    const PCAP = low ? 240 : 900, PER = 4;                 // prints per metre of trail, three people in file
    const boots = (() => {
      const g = new THREE.PlaneGeometry(0.3, 0.115).rotateX(-Math.PI / 2), idx = new Float32Array(PCAP); for (let i = 0; i < PCAP; i++) idx[i] = i;
      g.setAttribute('aIdx', new THREE.InstancedBufferAttribute(idx, 1));
      const m = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({ vertexShader: BOOT_VERT, fragmentShader: BOOT_FRAG, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, uniforms: { uCount: { value: 0 } } }), PCAP);
      m.count = 0; m.frustumCulled = false; m.renderOrder = 4; trailG.add(m); return { mesh: m, src: 0 };
    })();
    function syncBoots(state, fresh) {
      const tr = state.units['TEAM-1']?.trail; if (!tr || (!fresh && tr.length === boots.src)) return;
      let i = fresh || tr.length < boots.src ? 1 : Math.max(1, boots.src); if (boots.src === 0) i = 1;
      for (; i < tr.length; i++) {
        const a = tr[i - 1], b = tr[i], h = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(h), s = Math.sin(h);
        for (let j = 0; j < PER; j++) {
          const k = (i - 1) * PER + j; if (k >= PCAP) break;
          const r1 = Math.sin(k * 12.9898) * 43758.5453, r2 = Math.sin(k * 78.233) * 12543.123, q = (j + 0.8 * (r1 - Math.floor(r1))) / PER, side = (k % 2 ? 1 : -1) * 0.1 + (r2 - Math.floor(r2) - 0.5) * 0.22;
          m4.makeRotationY(h - (k % 2 ? -1 : 1) * 0.1 + (r2 - Math.floor(r2) - 0.5) * 0.2); const bx = a[0] + (b[0] - a[0]) * q - s * side, by = a[1] + (b[1] - a[1]) * q + c * side; m4.setPosition(bx, t.groundY + 0.015 + mound(bx, by), -by); boots.mesh.setMatrixAt(k, m4);
        }
      }
      boots.src = tr.length; boots.mesh.count = Math.min(PCAP, Math.max(0, (tr.length - 1) * PER - 3)); boots.mesh.material.uniforms.uCount.value = boots.mesh.count; boots.mesh.instanceMatrix.needsUpdate = true;
    }

    // ---------- rescue route ----------
    const poolU = { uColor: { value: pal.accent }, uOpacity: { value: 0 } };
    const poolG = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); { const uv = poolG.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 - 1, uv.getY(i) * 2 - 1); }
    const pool = new THREE.Mesh(poolG, decalMaterial(THREE, { vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, uniforms: poolU, ...lightBlend(THREE) }));
    pool.scale.setScalar(4.2); pool.position.y = t.groundY + 0.016; pool.renderOrder = 5; pool.visible = false; routeG.add(pool);
    let rescue = null;       // { key, legs: [...], extras: Group, total, reveal }
    function routeKey(r) {
      if (!r || !r.legs) return 0;
      let k = 1 + (r.plannedAt || 0) * 13 + r.legs.length * 1009;
      for (const l of r.legs) k += l.ok ? l.path.length * 7 + l.length * 3.1 + l.path[l.path.length - 1][0] : 0.5;
      return k;
    }
    function clearRescue() {
      if (!rescue) return;
      for (const L of rescue.legs) { L.label?.remove(); L.num.dispose(); }
      disposeTree(rescue.group); rescue = null;
    }
    function paintNumber(c, w, h, n, metres) {
      const u = w / 1.5;
      c.beginPath(); c.arc(w / 2, 0.62 * u, 0.5 * u, 0, Math.PI * 2); c.fillStyle = 'rgba(7,12,20,0.82)'; c.fill();
      c.lineWidth = 0.03 * u; c.strokeStyle = pal.css.accent; c.stroke();
      c.fillStyle = '#c9d2dc'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '600 ' + Math.round(0.62 * u) + 'px ' + FONT; c.fillText(String(n), w / 2, 0.65 * u);
      c.font = '500 ' + Math.round(0.3 * u) + 'px ' + FONT;
      c.lineWidth = 0.07 * u; c.strokeStyle = 'rgba(7,12,20,0.85)'; c.lineJoin = 'round'; c.strokeText(metres, w / 2, 1.42 * u);
      c.fillStyle = '#b9c2cc'; c.fillText(metres, w / 2, 1.42 * u);
    }
    function buildRescue(r, state, animate) {
      clearRescue();
      const group = new THREE.Group(); group.name = 'rescue route'; routeG.add(group);
      rescue = { key: routeKey(r), group, legs: [], total: 0, origin: 0, k: animate ? 0 : 1, palKey: pal.css.accent };
      const hazards = [...t.world.HAZARDS, ...(state.hazards || [])].filter((h) => h.poly && h.poly.length > 2);
      let n = 0, first = true;
      for (const leg of r.legs) {
        if (!leg.ok || !leg.path || leg.path.length < 2) continue;
        n++;
        const pts = resample(smoothPath(leg.path, { iterations: 3, radius: 1.0 }), low ? 0.6 : 0.35);
        const geo = routeGeometry(THREE, pts, hazards, mound), len = geo.userData.length;
        const U = { uColor: { value: pal.accent }, uOk: { value: pal.ok }, uHaz: { value: pal.danger }, uLen: { value: len }, uOff: { value: rescue.total }, uFront: { value: 1e6 }, uBack: { value: -1e6 }, uHead: { value: 0 }, uDone: { value: -1e3 }, uFlow: { value: 0 }, uFlowAmt: { value: 0 }, uRank: { value: first ? 0 : 1 }, uPlanned: { value: r.status === 'planned' ? 1 : 0 }, uCalm: { value: leg.arrivedAt != null || r.status === 'done' ? 1 : 0 }, uFadeIn: { value: first ? 1 : 0 } };
        const mesh = new THREE.Mesh(geo, decalMaterial(THREE, { vertexShader: RESCUE_VERT, fragmentShader: RESCUE_FRAG, uniforms: U, ...lightBlend(THREE) }));
        mesh.position.y = t.groundY + 0.018 + n * 0.001; mesh.renderOrder = 5; mesh.frustumCulled = false; group.add(mesh);
        const cum = new Float32Array(pts.length); for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + dist2(pts[i - 1], pts[i]);
        if (first) { let bd = Infinity; for (let i = 0; i < pts.length; i++) { const d = dist2(pts[i], t.world.SITE.entrance); if (d < bd) { bd = d; rescue.origin = cum[i]; } } }
        // number and length, beside the end of the leg (not on top of the person)
        const end = pts[pts.length - 1], prev = pts[Math.max(0, pts.length - 4)];
        let dx = end[0] - prev[0], dy = end[1] - prev[1]; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        let at = [end[0] + dy * 1.7 - dx * 0.9, end[1] - dx * 1.7 - dy * 0.9];
        if (t.world.wallsCrossed(end, at).length) at = [end[0] - dy * 1.7 - dx * 0.9, end[1] + dx * 1.7 - dy * 0.9];
        if (t.world.wallsCrossed(end, at).length) at = [end[0] - dx * 1.5, end[1] - dy * 1.5];
        const num = groundText(THREE, 0.9, 1.14, 160); const metres = Math.round(leg.length) + ' m', nn = n;
        num.redraw((c, w, h) => paintNumber(c, w, h, nn, metres));
        num.mesh.position.copy(t.v3(at, t.groundY + Y.marker)); num.mesh.renderOrder = 6; num.material.opacity = animate ? 0 : 1; group.add(num.mesh);
        const L = { mesh, U, len, pts, cum, seg: 0, offset: rescue.total, num, n: nn, metres, label: null, extras: null, det: leg.det };
        if (leg.kind === 'break through') buildBreak(L, leg, state, group);
        rescue.legs.push(L); rescue.total += len; first = false;
      }
      applyLayer();
    }
    function buildBreak(L, leg, state, group) {
      const det = state.detections.find((d) => d.id === leg.det), a = leg.access;
      if (!det || !det.pos || !a) return;
      const b = det.pos, dl = dist2(a, b) || 1, ux = (b[0] - a[0]) / dl, uy = (b[1] - a[1]) / dl;
      let hit = null, hk = 2;
      for (const w of t.world.wallsCrossed(a, b)) { const k = segHit(a, b, w.a, w.b); if (k >= 0 && k < hk) { hk = k; hit = w; } }
      let x, nx, ny, thick = 0.2;                         // x = point on the wall, n = wall normal toward the access point
      if (hit) {
        x = [a[0] + (b[0] - a[0]) * hk, a[1] + (b[1] - a[1]) * hk];
        const wl = dist2(hit.a, hit.b) || 1, wx = (hit.b[0] - hit.a[0]) / wl, wy = (hit.b[1] - hit.a[1]) / wl;
        nx = -wy; ny = wx; if (nx * (a[0] - x[0]) + ny * (a[1] - x[1]) < 0) { nx = -nx; ny = -ny; }
        // keep the outline on the wall: at least 0.7 m from either end where the wall is long enough
        const along = (x[0] - hit.a[0]) * wx + (x[1] - hit.a[1]) * wy, c = wl > 1.5 ? clamp(along, 0.7, wl - 0.7) : wl / 2;
        x = [hit.a[0] + wx * c, hit.a[1] + wy * c]; thick = hit.mat === 'concrete' ? 0.19 : 0.11;
      } else { x = [a[0] + ux * 0.6, a[1] + uy * 0.6]; nx = -ux; ny = -uy; thick = 0.02; }
      const g = new THREE.Group(); group.add(g);
      const U = { uColor: { value: pal.accent }, uOpacity: { value: 1 } };
      const mk = (geo, frag, uniforms) => { const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide, uniforms: { ...U, ...uniforms } })); m.renderOrder = 30; m.frustumCulled = false; g.add(m); return m; };
      const door = mk(new THREE.PlaneGeometry(1.1 + 0.16, 1.9 + 0.16), DOOR_FRAG, { uSize: { value: new THREE.Vector2(1.1, 1.9) } });
      door.position.copy(t.v3([x[0] + nx * (thick + 0.02), x[1] + ny * (thick + 0.02)], t.groundY + 0.95 + 0.03)); door.rotation.y = Math.atan2(nx, -ny);
      const cLen = 1.5, c0 = [x[0] + nx * (thick + cLen), x[1] + ny * (thick + cLen)], c1 = [x[0] + nx * thick, x[1] + ny * thick];
      const chev = mk(ribbonGeometry(THREE, [c0, c1], 1.0), FLOOR_FRAG, { uLen: { value: cLen }, uDots: { value: 0 } }); chev.position.y = t.groundY + Y.marker;
      const dots = mk(ribbonGeometry(THREE, [a, b], 0.14), FLOOR_FRAG, { uLen: { value: dl }, uDots: { value: 1 } }); dots.position.y = t.groundY + Y.marker + 0.004;
      L.extras = g; L.breakU = U;
      { const sub = (leg.gap ?? dl).toFixed(1) + ' m to the person', probe = t.label('Break through here', { tone: 'accent', sub, priority: 6, sel: { type: 'detection', id: leg.det } });
        if (!probe.setSub) probe.setText('Break through here · ' + sub); L.label = probe; }
      L.label.setPosition(t.v3([x[0] + nx * thick, x[1] + ny * thick], t.groundY + 2.15));
    }
    function syncRescue(state, dt, fresh) {
      const r = state.routes && state.routes.rescue, key = routeKey(r);
      if (!r) { if (rescue) clearRescue(); pool.visible = false; return; }
      if (!rescue || rescue.key !== key || rescue.palKey !== pal.css.accent) buildRescue(r, state, !fresh && !t.reduced && (!rescue || rescue.key !== key));
      if (!on.route) return;
      const R = rescue, done = r.status === 'done', u = state.units['TEAM-1'];
      if (R.k < 1) R.k = t.reduced ? 1 : Math.min(1, R.k + dt / REVEAL_S);
      const e = R.k * R.k * (3 - 2 * R.k), drawing = R.k < 1, head = drawing ? Math.min(1, R.k * 8) * (1 - smoothstep(0.85, 1, R.k)) : 0;
      const front = drawing ? R.origin + (R.total + 1 - R.origin) * e : 1e6, back = drawing ? R.origin - (R.origin + 1) * e : -1e6;
      const flowing = r.status === 'approved' && !t.reduced && state.running && !state.hold;
      let i = 0, active = -1;
      for (const leg of r.legs) {
        if (!leg.ok || !leg.path || leg.path.length < 2) continue;
        const L = R.legs[i]; if (!L) break;
        const U = L.U, calm = done || leg.arrivedAt != null ? 1 : 0, planned = r.status === 'planned' ? 1 : 0, k = fresh ? 1e3 : 3;
        if (!calm && active < 0) active = i;
        const isActive = i === active;
        U.uPlanned.value = damp(U.uPlanned.value, planned, k, dt); U.uCalm.value = damp(U.uCalm.value, calm, fresh ? 1e3 : 1.6, dt);
        U.uRank.value = damp(U.uRank.value, isActive || calm ? 0 : 1, k, dt);
        U.uFlowAmt.value = damp(U.uFlowAmt.value, isActive && !planned && !done ? 1 : 0, k, dt);
        if (flowing && isActive) U.uFlow.value = (U.uFlow.value + dt * 1.5) % 39;
        U.uFront.value = front; U.uBack.value = back; U.uHead.value = head;
        if (calm) U.uDone.value = 1e3;
        else if (isActive && !planned && u) { U.uDone.value = progress(L, u.pos); if (fresh) U.uDone.value = progress(L, u.pos, true); }
        else U.uDone.value = -1e3;
        const shown = front > L.offset + L.len ? 1 : 0, mo = L.num.material;
        mo.opacity = damp(mo.opacity, demo ? 0 : shown * (calm ? 0.35 : isActive ? 0.9 : 0.55), fresh ? 1e3 : 5, dt); L.num.mesh.visible = mo.opacity > 0.01;
        if (L.breakU) { const bo = L.breakU.uOpacity; bo.value = damp(bo.value, shown * (done ? 0.12 : calm ? 0.9 : isActive ? 1 : 0.5), fresh ? 1e3 : 4, dt); }
        if (L.label) { const want = on.route && (!demo || (isActive && !done)); if (want !== L.labelOn) { L.labelOn = want; showLabel(L.label, want); } }
        i++;
      }
      // the pool of light that leads the team along the active leg
      const L = active >= 0 ? R.legs[active] : null, want = L && r.status === 'approved' && u && u.v > 0 ? 1 : 0;
      poolU.uOpacity.value = damp(poolU.uOpacity.value, want, fresh ? 1e3 : 3, dt);
      if (want) {
        const d = Math.min(L.len, L.U.uDone.value + 2.4); let a = Math.max(1, L.seg); while (a < L.pts.length - 1 && L.cum[a] < d) a++;
        const p = L.pts[a - 1], q = L.pts[a], k = clamp((d - L.cum[a - 1]) / Math.max(1e-4, L.cum[a] - L.cum[a - 1]), 0, 1), kk = fresh ? 1 : 1 - Math.exp(-8 * dt);
        pool.position.x += (p[0] + (q[0] - p[0]) * k - pool.position.x) * kk; pool.position.z += (-(p[1] + (q[1] - p[1]) * k) - pool.position.z) * kk;
      }
      pool.visible = poolU.uOpacity.value > 0.01;
    }
    // Distance along leg L nearest to pos, searched near where it was last frame.
    function progress(L, pos, wide = false) {
      const p = L.pts, lo = wide ? 1 : Math.max(1, L.seg - 3), hi = wide ? p.length - 1 : Math.min(p.length - 1, L.seg + 40); let bd = Infinity, bs = 0, bi = lo;
      for (let i = lo; i <= hi; i++) {
        const a = p[i - 1], b = p[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, k = clamp(((pos[0] - a[0]) * dx + (pos[1] - a[1]) * dy) / l2, 0, 1), d = Math.hypot(pos[0] - a[0] - dx * k, pos[1] - a[1] - dy * k);
        if (d < bd - 1e-6) { bd = d; bi = i; bs = L.cum[i - 1] + Math.sqrt(l2) * k; }
      }
      L.seg = bi; return bs;
    }

    function showLabel(l, v) { if (!l) return; if (l.setVisible) l.setVisible(v); else if (l.el) l.el.style.visibility = v ? '' : 'hidden'; }
    function applyLayer() { routeG.visible = on.route; trailG.visible = on.trail; if (rescue) for (const L of rescue.legs) if (L.label) { L.labelOn = null; showLabel(L.label, on.route && !demo); } }

    return {
      update(state, dt, time) {
        const fresh = watch(state);
        demo = t.ctx.mode === 'demo';
        pathU.uColor.value.copy(pal.scan).lerp(pal.accent, 0.25);
        goal.material.uniforms.uOpacity.value = damp(goal.material.uniforms.uOpacity.value, demo ? 0 : 1, 4, dt);
        syncPath(state, dt, fresh);
        syncRuts(state, fresh); syncBoots(state, fresh);
        syncRescue(state, dt, fresh);
      },
      setLayer(id, v) { if (id in on) { on[id] = v; applyLayer(); } },
      onSelect() {},
      dispose() { clearRescue(); disposeTree(root); },
    };
  },
};
