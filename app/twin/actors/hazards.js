// Hazard zones. Each kind is a physical surface lit by the scene (cracked ground, creeping wet mud, drifting gas) under
// a thin, quiet hatch that only reads along the border; a new hazard arrives with falling debris and dust.
// Driven by world.HAZARDS (static) and state.hazards (added during the mission). Everything here is simulated.
import { palette, Y, damp, clamp, stateWatcher, polyGeometry, polyCentroid, disposeTree, decalMaterial, mulberry32, dist2 } from './common.js';

const MAXP = 10;
const KIND_LABEL = { collapse: ['Collapse risk', 'no entry'], mud: ['Deep mud', ''], slope: ['Unstable slope', ''], gas: ['Possible gas leak', 'concept sensor'] };
const FLOW = [-0.74, -0.67];          // the flood and the slide came from the north-east: everything wet creeps south-west
const NEW_LABEL_S = 8;                // Demo: how long the label of a new hazard stays

const VERT = /* glsl */ `
varying vec2 vW;
void main() { vW = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const POLY_FN = /* glsl */ `
uniform vec2 uPts[${MAXP}]; uniform int uN;
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h); }
float edgeDist(vec2 p) { float d = 1e5; for (int i = 0; i < ${MAXP}; i++) { if (i >= uN) break; int j = (i + 1 == uN) ? 0 : i + 1; d = min(d, sdSeg(p, uPts[i], uPts[j])); } return d; }`;

// The marking: fine diagonal hatch that fades within a metre or two of the border, and a thin broken boundary line.
const FILL_FRAG = /* glsl */ `
${POLY_FN}
uniform vec3 uColor; uniform float uBlock, uWipe, uSel, uQuiet; uniform vec2 uDiag;
varying vec2 vW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float d = edgeDist(vW), wd = fwidth(d), n = noise(vW * 2.3) * 0.6 + noise(vW * 9.0) * 0.4;
  float period = 0.42, h = (vW.x + vW.y) * 0.70710678 / period, wh = fwidth(h);
  float duty = 0.0065 / period, hw = max(duty, wh * 0.6);
  float stripe = (1.0 - smoothstep(hw - wh * 0.5, hw + wh * 0.5, abs(fract(h) - 0.5))) * min(1.0, duty / hw * 1.6 + 0.1);
  stripe = mix(stripe, duty * 2.0, smoothstep(0.35, 0.8, wh));                     // far away: the average, not shimmer
  float inner = exp(-d / mix(0.5, 0.8, uBlock));
  float hatch = stripe * inner * mix(0.2, 0.3, uBlock) * (0.55 + 0.9 * n);
  float along = (vW.x - vW.y) * 0.5 / 0.9, lw = max(0.007, wd * 0.6);
  float broken = smoothstep(0.3, 0.45, noise(vec2(along * 1.7, 3.0)));
  float border = (1.0 - smoothstep(lw, lw + wd + 0.012, d)) * broken * mix(0.3, 0.42, uBlock) * min(1.0, 0.012 / lw + 0.35);
  float veil = exp(-d / 0.55) * mix(0.02, 0.035, uBlock);
  hatch *= 1.0 - smoothstep(0.02, 0.07, fwidth(vW.x + vW.y)) * 0.55;
  float a = max(border, hatch + veil);
  float k = (vW.x + vW.y - uDiag.x) / max(uDiag.y - uDiag.x, 1e-3);
  a *= 1.0 - smoothstep(uWipe * 1.15 - 0.15, uWipe * 1.15, k);
  a *= mix(1.0, 0.5, uQuiet * (1.0 - uSel)) * (1.0 + uSel * 0.8);
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(uColor, vec3(0.5, 0.42, 0.4), 0.3) * 0.5, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

// Wet mud, as a lit surface: lobes and folds that creep downhill, water standing in the low places, an uneven shore.
const MUD_PARS = /* glsl */ `
${POLY_FN}
varying vec2 vPW; uniform sampler2D uNoise; uniform float uT, uFold, uWipe; uniform vec4 uKeep; uniform vec2 uFlow;
vec2 mudN; float mudWet, mudH;`;
const MUD_MAP = /* glsl */ `
{
  vec2 fp = vec2(-uFlow.y, uFlow.x), q = vec2(dot(vPW, uFlow), dot(vPW, fp));
  vec4 a = texture2D(uNoise, vec2(q.x * 0.085 - uT * 0.0016, q.y * 0.12));
  vec4 b = texture2D(uNoise, vec2(q.x * mix(0.3, 0.46, uFold) - uT * 0.008, q.y * mix(0.3, 0.17, uFold)) + a.rg * 0.1);
  vec4 c = texture2D(uNoise, q * 1.35 + b.rg * 0.06 - vec2(uT * 0.011, 0.0));
  vec4 e = texture2D(uNoise, q * 5.3 + 0.37);
  mudH = a.r * 0.5 + b.r * 0.34 + c.r * 0.16;
  mudWet = smoothstep(0.5, 0.4, mudH);
  vec2 nq = (a.ba - 0.5) * 0.35 + (b.ba - 0.5) * mix(0.6, 1.25, uFold) + (c.ba - 0.5) * 0.28 + (e.ba - 0.5) * 0.1;
  nq = mix(nq, (c.ba - 0.5) * 0.05, mudWet);
  mudN = uFlow * nq.x + fp * nq.y;
  float d = edgeDist(vPW);
  float shore = smoothstep(0.12, 0.34, d + (a.r - 0.5) * 3.2 + (b.r - 0.5) * 1.8 - 0.55 + (e.r - 0.5) * 0.25);
  vec2 kc = abs(vPW - (uKeep.xy + uKeep.zw) * 0.5) - (uKeep.zw - uKeep.xy) * 0.5;
  shore *= smoothstep(0.0, 0.5, max(kc.x, kc.y) + (c.r - 0.5) * 0.3);
  vec3 col = mix(vec3(0.026, 0.0215, 0.017), vec3(0.07, 0.059, 0.047), smoothstep(0.44, 0.72, mudH) * (0.6 + 0.8 * e.r));
  diffuseColor.rgb = mix(col, vec3(0.012, 0.011, 0.01), mudWet * 0.8) * (0.55 + 0.45 * smoothstep(0.3, 0.7, shore));
  diffuseColor.a = shore * 0.97 * uWipe;
  if (diffuseColor.a < 0.01) discard;
}`;

// Ground cracks: every crack is a ribbon whose inside is found along the view ray (opposite wall or dark floor), so
// it has real depth as the camera moves. Edges are ragged; the walls catch the scene's light.
const CRACK_VERT_PARS = /* glsl */ `
attribute vec3 aCrack; attribute vec2 aAcr; varying vec2 vC; varying float vHW; varying float vOrd; varying vec2 vAcr; varying vec3 vWP;`;
const CRACK_VERT = /* glsl */ `
vC = uv; vHW = aCrack.x; vOrd = aCrack.y; vAcr = aAcr; vWP = (modelMatrix * vec4(position, 1.0)).xyz;`;
const CRACK_PARS = /* glsl */ `
varying vec2 vC; varying float vHW; varying float vOrd; varying vec2 vAcr; varying vec3 vWP; uniform float uGrow;
float crIn, crWall, crLip;
float ch(float n) { return fract(sin(n * 91.345) * 47453.5453); }
float cn(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(ch(i), ch(i + 1.0), f); }
float ch2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(ch2(i), ch2(i + vec2(1, 0)), f.x), mix(ch2(i + vec2(0, 1)), ch2(i + vec2(1, 1)), f.x), f.y); }`;
const CRACK_MAP = /* glsl */ `
{
  float grow = smoothstep(vOrd - 0.02, vOrd + 0.12, uGrow);
  float hw = vHW * grow, side = vC.y > 0.0 ? 17.0 : 53.0;
  float rag = 0.45 + 0.75 * cn(vC.x * 9.0 + side) + 0.3 * (cn(vC.x * 41.0 + side) - 0.5);
  float w = hw * rag, ay = abs(vC.y), fw = fwidth(vC.y);
  crIn = 1.0 - smoothstep(w - fw * 0.5, w + fw * 0.5, ay);
  crIn *= smoothstep(0.0, 0.004, hw) * min(1.0, w / max(fw * 0.8, 1e-4));
  vec3 V = normalize(cameraPosition - vWP);
  float slope = -dot(V.xz, vAcr) / max(V.y, 0.08);
  float target = slope > 0.0 ? w : -w, dep = abs(target - vC.y) / max(abs(slope), 0.02), maxD = hw * 5.0 + 0.02;
  crWall = (slope > 0.0 ? -1.0 : 1.0) * step(dep, maxD);
  float grit = 0.65 + 0.7 * cn2(vec2(vC.x * 30.0, dep * 60.0));
  vec3 inside = mix(vec3(0.004, 0.0038, 0.0035), vec3(0.05, 0.043, 0.035) * grit * exp(-dep * 16.0), step(dep, maxD));
  float e = max(ay - w, 0.0);
  crLip = exp(-e / (0.02 + hw * 0.5)) * (1.0 - smoothstep(0.1, 0.24, ay)) * (0.35 + 0.9 * cn2(vWP.xz * 24.0)) * smoothstep(0.0, 0.01, hw);
  diffuseColor.rgb = mix(vec3(0.05, 0.044, 0.037), inside, crIn);
  diffuseColor.a = max(crIn, crLip * 0.55);
  if (diffuseColor.a < 0.01) discard;
}`;

// Gas: soft, almost colourless wisps that hang low and drift; they fade into the floor and into each other.
const GAS_VERT = /* glsl */ `
attribute vec4 aOff; attribute vec3 aSize; uniform float uT; uniform vec4 uBox;
varying vec2 vUv; varying float vA; varying float vH; varying float vSeed;
void main() {
  vUv = uv; vSeed = aOff.w; float life = fract(uT * aSize.z + aOff.w);
  vec3 c = aOff.xyz; c.x += (life - 0.5) * 1.7 + sin(uT * 0.13 + aOff.w * 40.0) * 0.22; c.z += (life - 0.5) * 0.8 + cos(uT * 0.11 + aOff.w * 23.0) * 0.2; c.y += life * 0.22;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  vec2 o = position.xy * aSize.xy * (0.75 + 0.5 * life); mv.xy += o;
  vH = c.y + o.y * viewMatrix[1][1];
  vA = smoothstep(0.0, 0.3, life) * (1.0 - smoothstep(0.6, 1.0, life)) * smoothstep(0.8, 2.5, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const GAS_FRAG = /* glsl */ `
uniform sampler2D uNoise; uniform float uT, uSel; varying vec2 vUv; varying float vA; varying float vH; varying float vSeed;
void main() {
  vec2 q = vUv - 0.5; float r = length(q * vec2(1.0, 1.2)) * 2.0;
  vec2 w = texture2D(uNoise, vUv * 0.21 + vSeed * 7.0 + vec2(uT * 0.006, -uT * 0.011)).rg - 0.5;
  float n = texture2D(uNoise, vUv * vec2(0.62, 0.34) + w * 0.5 + vSeed * 3.0 - vec2(0.0, uT * 0.013)).r;
  float a = (1.0 - smoothstep(0.1, 1.0, r)) * smoothstep(0.38, 0.85, n) * vA * smoothstep(0.02, 0.35, vH) * (1.0 - smoothstep(0.9, 1.7, vH)) * 0.17 * (1.0 + uSel * 0.5);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vec3(0.3, 0.295, 0.25), a);
  #include <colorspace_fragment>
}`;

// Dust sifting down: a few thin falls that start and stop.
const SIFT_VERT = /* glsl */ `
attribute vec2 aSeed; uniform float uT, uPx; varying float vA;
void main() {
  float cyc = uT / 13.0 + aSeed.y, k = fract(cyc), tt = k * 13.0 - aSeed.x * 2.6, fall = 2.2, f = clamp(tt / fall, 0.0, 1.0);
  vec3 p = position; p.y *= 1.0 - f * (0.35 + 0.65 * f); p.x += f * 0.16 * sin(aSeed.x * 50.0) + f * 0.1; p.z += f * 0.14 * cos(aSeed.x * 37.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.02 + 0.22 * f * f) * uPx / max(-mv.z, 0.1);
  vA = (tt > 0.0 && tt < fall) ? smoothstep(0.0, 0.08, f) * pow(1.0 - f, 0.8) * 0.16 : 0.0;
  if (vA <= 0.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;

const DUST_VERT = /* glsl */ `
attribute vec3 aVel; attribute vec2 aSeed;
uniform float uAge, uPx;
varying float vA;
void main() {
  float age = uAge - aSeed.x * 0.8, life = 1.6;
  float k = clamp(age / life, 0.0, 1.0);
  vec3 p = position + aVel * (1.0 - exp(-2.4 * max(age, 0.0))) / 2.4;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.7 + 2.3 * k) * (0.6 + aSeed.y * 0.8) * uPx / max(-mv.z, 0.1);
  vA = age < 0.0 ? 0.0 : smoothstep(0.0, 0.12, k) * pow(1.0 - k, 1.6) * 0.34;
}`;
const DUST_FRAG = /* glsl */ `
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = vA * exp(-r * r * 3.2) * (1.0 - smoothstep(0.85, 1.0, r));
  if (a < 0.003) discard;
  gl_FragColor = vec4(vec3(0.33, 0.29, 0.25), a);
  #include <colorspace_fragment>
}`;

// Tileable noise: r = height, g = a second height, ba = the slope of r.
function noiseTexture(THREE, size) {
  const h = [new Float32Array(size * size), new Float32Array(size * size)], rnd = mulberry32(40961);
  for (const f of h) {
    let amp = 1;
    for (let cells = 4; cells <= 64; cells *= 2, amp *= 0.5) {
      const g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = rnd();
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const u = (x / size) * cells, v = (y / size) * cells, i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), i1 = (i + 1) % cells, j1 = (j + 1) % cells;
        const a = g[j * cells + i], b = g[j * cells + i1], c = g[j1 * cells + i], d = g[j1 * cells + i1];
        f[y * size + x] += amp * (a + (b - a) * sx + (c + (d - c) * sx - a - (b - a) * sx) * sy);
      }
    }
    let lo = Infinity, hi = -Infinity; for (const v of f) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) / (hi - lo);
  }
  const px = new Uint8Array(size * size * 4), H = h[0], k = size / 16;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, dx = H[y * size + ((x + 1) % size)] - H[y * size + ((x + size - 1) % size)], dy = H[((y + 1) % size) * size + x] - H[((y + size - 1) % size) * size + x];
    px[i * 4] = H[i] * 255; px[i * 4 + 1] = h[1][i] * 255; px[i * 4 + 2] = clamp(127.5 + dx * k * 127, 0, 255); px[i * 4 + 3] = clamp(127.5 + dy * k * 127, 0, 255);
  }
  const tx = new THREE.DataTexture(px, size, size, THREE.RGBAFormat); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.generateMipmaps = true; tx.minFilter = THREE.LinearMipmapLinearFilter; tx.magFilter = THREE.LinearFilter; tx.anisotropy = 8; tx.needsUpdate = true;
  return tx;
}

function inPoly(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function hashId(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function shortName(name) {
  let s = String(name || 'New hazard').replace(/\s*\(.*?\)/g, '').replace(/\s*:\s*/, ' · ');
  if (s.length > 26) { const cut = s.lastIndexOf(' ', 26); s = s.slice(0, cut > 8 ? cut : 26); }
  return s;
}

export default {
  id: 'hazards', layers: ['hazards'],
  create(t) {
    const { THREE } = t, pal = palette(t), low = t.quality === 'low';
    const root = new THREE.Group(); root.name = 'hazards'; t.scene.add(root);
    const uT = { value: 0 }, uQuiet = { value: 0 }, noiseTex = { value: noiseTexture(THREE, low ? 128 : 256) };
    let clock = 0, rate = 0, demo = false;
    const zones = new Map();          // id -> zone
    const placed = [];                // label anchors already used, so labels of overlapping zones do not stack
    const watch = stateWatcher();
    let layerOn = true, selId = t.ctx.selection?.type === 'hazard' ? t.ctx.selection.id : null, lastCount = -1;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), ax = new THREE.Vector3();

    function labelAnchor(poly) {
      const c = polyCentroid(poly);
      const clash = placed.find((p) => dist2(p, c) < 5);
      if (!clash) { placed.push(c); return c; }
      let best = c, bd = -1;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const p = [c[0] + (m[0] - c[0]) * 0.62, c[1] + (m[1] - c[1]) * 0.62];
        let d = Infinity; for (const o of placed) d = Math.min(d, dist2(o, p));
        if (d > bd) { bd = d; best = p; }
      }
      placed.push(best); return best;
    }

    function upNormals(g) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a[i * 3 + 1] = 1; g.setAttribute('normal', new THREE.BufferAttribute(a, 3)); return g; }

    function mudSurface(hz, poly, shared) {
      const K = t.world.BUILDING.rect, mat = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.4, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        // the picture's alpha channel tells the reflection pass how much a surface mirrors: wet mud mirrors a little
        blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ConstantAlphaFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendAlpha: 0.82 });
      const U = { ...shared, uNoise: noiseTex, uFold: { value: hz.kind === 'slope' ? 1 : 0 }, uFlow: { value: new THREE.Vector2(FLOW[0], FLOW[1]) }, uKeep: { value: new THREE.Vector4(K[0], K[1], 75.15, K[3] + 0.15) } };   // the dry rooms of block B
      mat.onBeforeCompile = (sh) => {
        for (const k of ['uPts', 'uN', 'uT', 'uWipe', 'uNoise', 'uFold', 'uFlow', 'uKeep']) sh.uniforms[k] = U[k];
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPW = uv;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + MUD_PARS).replace('#include <map_fragment>', MUD_MAP)
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(mix(0.24, 0.5, smoothstep(0.5, 0.78, mudH)), 0.13, mudWet);')
          .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(-mudN.x, 1.0, mudN.y, 0.0)).xyz);');
      };
      mat.customProgramCacheKey = () => 'hound-mud';
      const m = new THREE.Mesh(upNormals(polyGeometry(THREE, poly)), mat); m.position.y = t.groundY + 0.02 + (hz.kind === 'slope' ? 0.004 : 0); m.receiveShadow = true; m.renderOrder = 1; return m;
    }

    // Branching cracks: a few run out from the middle, some follow the rim the way undercut ground lets go.
    function crackLines(poly, rnd) {
      const c = polyCentroid(poly); let R = 0; for (const p of poly) R += dist2(p, c) / poly.length;
      const lines = [], B = t.world.BUILDING.rect, indoors = (x, y) => x > B[0] && x < B[2] && y > B[1] && y < B[3];
      const ring = poly.some((p) => !indoors(p[0], p[1])), ok = (x, y) => inPoly([x, y], poly) || (ring && !indoors(x, y) && Math.hypot(x - c[0], y - c[1]) < R * 1.75);   // outdoors the ground goes on cracking past the edge
      function walk(x, y, a, len, w, ord, depth) {
        const pts = [[x, y, w, ord]], step = 0.16; let s = 0, drift = (rnd() - 0.5) * 0.25;
        while (s < len) {
          if (rnd() < 0.3) drift = (rnd() - 0.5) * 0.9; a += drift * 0.35 + (rnd() - 0.5) * 0.5;
          x += Math.cos(a) * step; y += Math.sin(a) * step; s += step;
          if (!ok(x, y)) break;
          const k = 1 - s / len; pts.push([x, y, w * Math.pow(Math.max(k, 0), 0.7), ord + s / (R * 2.2)]);
          if (depth < 3 && rnd() < 0.085 && k > 0.2) walk(x, y, a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.7), len * k * (0.35 + rnd() * 0.4), w * k * 0.6, ord + s / (R * 2.2), depth + 1);
        }
        if (pts.length > 3) lines.push(pts);
      }
      const n = low ? 4 : 7, a0 = rnd() * 6.28;
      for (let i = 0; i < n; i++) walk(c[0] + (rnd() - 0.5) * 0.5, c[1] + (rnd() - 0.5) * 0.5, a0 + (i + rnd() * 0.6) * 6.283 / n, R * (0.7 + rnd() * 0.5), 0.028 + rnd() * 0.03, 0, 0);
      for (let i = 0; i < (low ? 3 : 7); i++) {                       // along the rim
        const e = Math.floor(rnd() * poly.length), p = poly[e], q2 = poly[(e + 1) % poly.length], k = 0.15 + rnd() * 0.5, f = 0.74 + rnd() * 0.2;
        const x = c[0] + (p[0] + (q2[0] - p[0]) * k - c[0]) * f, y = c[1] + (p[1] + (q2[1] - p[1]) * k - c[1]) * f;
        walk(x, y, Math.atan2(q2[1] - p[1], q2[0] - p[0]) + (rnd() - 0.5) * 0.4 + (rnd() < 0.5 ? Math.PI : 0), R * (0.45 + rnd() * 0.6), 0.02 + rnd() * 0.024, 0.35, 1);
      }
      if (ring) for (let i = 0; i < (low ? 6 : 13); i++) {            // outward from the edge
        const e = Math.floor(rnd() * poly.length), p = poly[e], q2 = poly[(e + 1) % poly.length], k = rnd(), x = p[0] + (q2[0] - p[0]) * k, y = p[1] + (q2[1] - p[1]) * k;
        if (!indoors(x, y)) walk(x, y, Math.atan2(y - c[1], x - c[0]) + (rnd() - 0.5) * 1.3, 1.4 + rnd() * 2.8, 0.022 + rnd() * 0.03, 0.5, 0);
      }
      return lines;
    }
    function crackSurface(lines, grow) {
      const pos = [], nor = [], uv = [], cr = [], ac = [], idx = [];
      for (const L of lines) {
        let s = L[0][0] * 7.3 + L[0][1]; const base = pos.length / 3;
        for (let i = 0; i < L.length; i++) {
          const p = L[i], a = L[Math.max(0, i - 1)], b = L[Math.min(L.length - 1, i + 1)]; let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
          if (i) s += Math.hypot(p[0] - L[i - 1][0], p[1] - L[i - 1][1]);
          const hw = 0.06 + p[2] * 3.2, ox = -dy, oy = dx;
          pos.push(p[0] - ox * hw, 0, -(p[1] - oy * hw), p[0] + ox * hw, 0, -(p[1] + oy * hw)); nor.push(0, 1, 0, 0, 1, 0);
          uv.push(s, -hw, s, hw); cr.push(p[2], p[3], 0, p[2], p[3], 0); ac.push(ox, -oy, ox, -oy);
          if (i < L.length - 1) { const k = base + i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('aCrack', new THREE.Float32BufferAttribute(cr, 3)); g.setAttribute('aAcr', new THREE.Float32BufferAttribute(ac, 2)); g.setIndex(idx);
      const mat = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uGrow = grow;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + CRACK_VERT_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + CRACK_VERT);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + CRACK_PARS).replace('#include <map_fragment>', CRACK_MAP)
          .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(mix(vec3(0.0, 1.0, 0.0), vec3(vAcr.x * crWall, 0.35, vAcr.y * crWall), crIn * abs(crWall)), 0.0)).xyz);');
      };
      mat.customProgramCacheKey = () => 'hound-crack';
      const m = new THREE.Mesh(g, mat); m.position.y = t.groundY + 0.03; m.receiveShadow = true; m.renderOrder = 2; m.frustumCulled = false; return m;
    }
    const px = () => t.renderer.domElement.height * t.camera.projectionMatrix.elements[5] * 0.5;
    function siftDust(poly, rnd) {
      const c = polyCentroid(poly), n = low ? 30 : 90, pos = new Float32Array(n * 3), sd = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const j = i % 3, e = poly[(j * 2 + 1) % poly.length], k = 0.35 + j * 0.16;
        pos.set([c[0] + (e[0] - c[0]) * k + (rnd() - 0.5) * 0.35, 1.5 + rnd() * 0.5 + j * 0.15, -(c[1] + (e[1] - c[1]) * k + (rnd() - 0.5) * 0.14)], i * 3); sd.set([rnd(), j * 0.37], i * 2);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 2));
      const m = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: SIFT_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, uniforms: { uT, uPx: { value: 500 } } }));
      m.frustumCulled = false; m.renderOrder = 9; m.position.y = t.groundY; m.onBeforeRender = () => { m.material.uniforms.uPx.value = px(); }; return m;
    }
    function gasWisps(poly, [x0, x1, y0, y1], shared) {
      const n = low ? 9 : 22, rnd = mulberry32(771), q0 = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry(); g.index = q0.index; g.setAttribute('position', q0.attributes.position); g.setAttribute('uv', q0.attributes.uv);
      const o = new Float32Array(n * 4), s = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { o.set([x0 + 0.7 + rnd() * (x1 - x0 - 1.4), t.groundY + 0.22 + rnd() * 0.5, -(y0 + 0.6 + rnd() * (y1 - y0 - 1.2)), rnd()], i * 4); s.set([1.7 + rnd() * 1.9, 0.7 + rnd() * 0.8, 0.03 + rnd() * 0.035], i * 3); }
      g.setAttribute('aOff', new THREE.InstancedBufferAttribute(o, 4)); g.setAttribute('aSize', new THREE.InstancedBufferAttribute(s, 3)); g.instanceCount = n;
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: GAS_VERT, fragmentShader: GAS_FRAG, transparent: true, depthWrite: false, uniforms: { uT, uNoise: noiseTex, uSel: shared.uSel } }));
      m.frustumCulled = false; m.renderOrder = 8; return m;
    }

    function makeZone(hz, isNew, burst) {
      const poly = hz.poly.slice(0, MAXP), block = hz.block ? 1 : 0;
      const pts = []; for (let i = 0; i < MAXP; i++) { const p = poly[Math.min(i, poly.length - 1)]; pts.push(new THREE.Vector2(p[0], p[1])); }
      let d0 = Infinity, d1 = -Infinity, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of poly) { d0 = Math.min(d0, p[0] + p[1]); d1 = Math.max(d1, p[0] + p[1]); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      const group = new THREE.Group(); group.name = 'hazard ' + hz.id; root.add(group);
      const shared = { uPts: { value: pts }, uN: { value: poly.length }, uColor: { value: pal.danger }, uBlock: { value: block }, uWipe: { value: burst ? 0 : 1 }, uSel: { value: 0 }, uT, uQuiet };
      const fill = new THREE.Mesh(polyGeometry(THREE, poly), decalMaterial(THREE, { vertexShader: VERT, fragmentShader: FILL_FRAG, uniforms: { ...shared, uDiag: { value: new THREE.Vector2(d0, d1) } } }));
      fill.position.y = t.groundY + Y.hazard + (block ? 0.004 : 0) + (isNew ? 0.006 : 0); fill.renderOrder = 3 + block;
      group.add(fill); t.pickable(fill, { type: 'hazard', id: hz.id });
      const rnd = mulberry32(hashId(hz.id) ^ 0x5bd1), grow = { value: burst ? 0 : 2 }; let lines = null;
      if (hz.kind === 'gas') group.add(gasWisps(poly, [x0, x1, y0, y1], shared));
      else if (hz.kind === 'mud' || hz.kind === 'slope') group.add(mudSurface(hz, poly, shared));
      else { lines = crackLines(poly, rnd); group.add(crackSurface(lines, grow), siftDust(poly, rnd)); }
      const anchor = labelAnchor(poly);
      const words = (!isNew && KIND_LABEL[hz.kind]) || shortName(hz.name).split(' · ');
      const label = t.label(words[0], { tone: 'danger', sub: words[1] || '', priority: 4, sel: { type: 'hazard', id: hz.id } });
      if (!label.setSub && words[1]) label.setText(words[0] + ' · ' + words[1]);
      label.setPosition(t.v3(anchor, t.groundY + (block ? 1.5 : 1.0)));
      const z = { id: hz.id, group, shared, grow, fill, label, anchor, burst: null, labelOn: null, isNew, age: 0 };
      if (isNew) addDebris(z, hz, poly, [x0, x1, y0, y1], burst); else if (lines) addCrumbs(z, lines, rnd);
      syncLabel(z);
      return z;
    }

    // Small stones and crumbs loosened along the cracks.
    function addCrumbs(z, lines, rnd) {
      const n = low ? 40 : 150, mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 0.96, flatShading: true }), n), col = new THREE.Color(), e = new THREE.Euler();
      for (let i = 0; i < n; i++) {
        const L = lines[Math.floor(rnd() * lines.length)], p = L[Math.floor(rnd() * L.length)], s = 0.012 + Math.pow(rnd(), 3) * 0.075;
        m4.compose(v.set(p[0] + (rnd() - 0.5) * 0.4, t.groundY + 0.02 + s * 0.2, -(p[1] + (rnd() - 0.5) * 0.4)), q.setFromEuler(e.set(rnd() * 6, rnd() * 6, rnd() * 6)), sc.set(s * (0.8 + rnd() * 0.7), s * (0.5 + rnd() * 0.4), s));
        mesh.setMatrixAt(i, m4); const g = 0.7 + rnd() * 0.5; mesh.setColorAt(i, col.setRGB(g, g * 0.96, g * 0.9));
      }
      mesh.receiveShadow = true; mesh.castShadow = !low; mesh.frustumCulled = false; z.group.add(mesh);
    }

    // Debris of a new slide. Same seeded resting places every time; with "burst" the chunks fall in and dust rises.
    function addDebris(z, hz, poly, [x0, x1, y0, y1], burst) {
      const rnd = mulberry32(hashId(hz.id)), n = low ? 12 : 36;
      const chunks = [];
      for (let i = 0, guard = 0; i < n && guard < 2000; guard++) {
        const p = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)];
        if (!inPoly(p, poly)) continue;
        const big = rnd() < 0.2, s = big ? 0.34 + rnd() * 0.3 : 0.1 + rnd() * 0.2;
        const c = { x: p[0], z: -p[1], sx: s * (0.8 + rnd() * 0.6), sy: s * (0.45 + rnd() * 0.4), sz: s * (0.7 + rnd() * 0.6),
          rest: new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.5, rnd() * 6.28, (rnd() - 0.5) * 0.5)),
          axis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), spin: 2 + rnd() * 5,
          delay: rnd() * 0.5, h: 3 + rnd() * 2, dx: (rnd() - 0.5) * 0.9, dz: (rnd() - 0.5) * 0.9 };
        c.tf = Math.sqrt((2 * c.h) / 9.81); c.vb = 0.26 * 9.81 * c.tf; c.tb = (2 * c.vb) / 9.81;
        chunks.push(c); i++;
      }
      const geo = new THREE.DodecahedronGeometry(0.5, 0);
      const mat = new THREE.MeshStandardMaterial({ color: 0x6d655c, roughness: 0.96, metalness: 0, flatShading: true });
      const mesh = new THREE.InstancedMesh(geo, mat, chunks.length); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      const col = new THREE.Color();
      chunks.forEach((c, i) => { const g = 0.75 + rnd() * 0.45; mesh.setColorAt(i, col.setRGB(g, g * (0.94 + rnd() * 0.05), g * (0.86 + rnd() * 0.08))); });
      z.group.add(mesh); z.chunks = chunks; z.debris = mesh;
      placeDebris(z, burst ? 0 : 99);
      if (!burst) return;
      const m = low ? 24 : 70, pos = new Float32Array(m * 3), vel = new Float32Array(m * 3), seed = new Float32Array(m * 2), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      for (let i = 0; i < m; i++) {
        const c = chunks[i % chunks.length], a = Math.atan2(-c.z - cy, c.x - cx) + (rnd() - 0.5) * 1.6, sp = 0.6 + rnd() * 1.8;
        pos.set([c.x + (rnd() - 0.5) * 0.6, t.groundY + 0.15 + rnd() * 0.3, c.z + (rnd() - 0.5) * 0.6], i * 3);
        vel.set([Math.cos(a) * sp, 0.5 + rnd() * 1.6, -Math.sin(a) * sp], i * 3);
        seed.set([rnd(), rnd()], i * 2);
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); dg.setAttribute('aVel', new THREE.BufferAttribute(vel, 3)); dg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
      const dust = new THREE.Points(dg, new THREE.ShaderMaterial({ vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, toneMapped: false,
        uniforms: { uAge: { value: 0 }, uPx: { value: t.renderer.domElement.height * t.camera.projectionMatrix.elements[5] * 0.5 } } }));
      dust.frustumCulled = false; dust.renderOrder = 9; z.group.add(dust);
      z.burst = { age: 0, dust };
    }

    function placeDebris(z, age) {
      const mesh = z.debris;
      for (let i = 0; i < z.chunks.length; i++) {
        const c = z.chunks[i], rest = t.groundY + c.sy * 0.36, a = age - c.delay;
        let y = rest, k = 0, s = 1;                                  // k = how far from rest (1 = just released)
        if (a < 0) { s = 0; }
        else if (a < c.tf) { y = rest + c.h - 4.905 * a * a; k = 1 - (a / (c.tf + c.tb)); }
        else if (a < c.tf + c.tb) { const b = a - c.tf; y = rest + c.vb * b - 4.905 * b * b; k = 1 - (a / (c.tf + c.tb)); }
        q.copy(c.rest);
        if (k > 0) { q2.setFromAxisAngle(ax.copy(c.axis), c.spin * k * k * 1.2); q.multiply(q2); }
        v.set(c.x - c.dx * k, y, c.z - c.dz * k); sc.set(c.sx * s, c.sy * s, c.sz * s);
        mesh.setMatrixAt(i, m4.compose(v, q, sc));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    // Demo shows a hazard's label only while it is news or selected.
    function syncLabel(z) { const want = layerOn && (!demo || z.id === selId || (z.isNew && z.age < NEW_LABEL_S)); if (want !== z.labelOn) { z.labelOn = want; z.label.setVisible(want); } }
    function removeZone(z) { t.unpickable?.(z.fill); disposeTree(z.group); z.label.remove(); const i = placed.indexOf(z.anchor); if (i >= 0) placed.splice(i, 1); zones.delete(z.id); }

    // Static zones: no-entry zones first so they get the centroid for their label.
    for (const hz of [...t.world.HAZARDS].sort((a, b) => (b.block ? 1 : 0) - (a.block ? 1 : 0))) zones.set(hz.id, makeZone(hz, false, false));
    const staticIds = new Set(t.world.HAZARDS.map((h) => h.id));

    function sync(state, fresh) {
      const list = state.hazards || [];
      for (const z of [...zones.values()]) if (!staticIds.has(z.id) && !list.some((h) => h.id === z.id)) removeZone(z);
      for (const hz of list) {
        if (zones.has(hz.id) || !hz.poly || hz.poly.length < 3) continue;
        const burst = !fresh && !t.reduced && state.t - (hz.t ?? -1e9) < 6;
        const z = makeZone(hz, true, burst); if (!burst) z.age = state.t - (hz.t ?? -1e9); zones.set(hz.id, z);
      }
      lastCount = list.length;
    }

    return {
      update(state, dt, time) {
        const fresh = watch(state);
        if (fresh) for (const z of [...zones.values()]) if (!staticIds.has(z.id)) removeZone(z);   // rebuild at rest, no burst
        if (fresh || (state.hazards?.length || 0) !== lastCount) sync(state, fresh);
        if (!layerOn) return;
        demo = t.ctx.mode === 'demo';
        uQuiet.value = fresh ? (demo ? 1 : 0) : damp(uQuiet.value, demo ? 1 : 0, 4, dt);
        rate = damp(rate, t.reduced || !state.running ? 0 : 1, 3, dt); clock += dt * rate; uT.value = 40 + clock;   // the mission clock stops: so does the mud
        for (const z of zones.values()) {
          if (z.isNew) z.age += dt;
          syncLabel(z);
          const target = z.id === selId ? 1 : 0, u = z.shared.uSel;
          if (u.value !== target) { u.value = damp(u.value, target, 12, dt); if (Math.abs(u.value - target) < 0.004) u.value = target; }
          const b = z.burst; if (!b) continue;
          b.age += dt;
          const w = clamp(b.age / 1.0, 0, 1); z.shared.uWipe.value = w * w * (3 - 2 * w);
          const gk = clamp((b.age - 0.15) / 1.9, 0, 1); z.grow.value = 2 * gk * gk * (3 - 2 * gk);
          placeDebris(z, b.age);
          b.dust.material.uniforms.uAge.value = b.age;
          if (b.age > 2.6) { z.shared.uWipe.value = 1; z.grow.value = 2; placeDebris(z, 99); disposeTree(b.dust); z.burst = null; }
        }
      },
      setLayer(id, on) { if (id !== 'hazards') return; layerOn = on; root.visible = on; for (const z of zones.values()) syncLabel(z); },
      onSelect(sel) { selId = sel && sel.type === 'hazard' ? sel.id : null; for (const z of zones.values()) { z.label.setSelected?.(z.id === selId); syncLabel(z); } },
      dispose() { for (const z of [...zones.values()]) z.label.remove(); zones.clear(); disposeTree(root); noiseTex.value.dispose(); },
    };
  },
};
