// Vision lab, Demo: the drone frame as a lit piece of ground. The photograph is draped over the relief that Depth Anything
// estimated for it, cut into 64 x 64 columns, and every column can rise. What makes it rise is a recorded model output:
// the similarity of that patch to the words (MobileCLIP-S0), or the outline from one click (SlimSAM).
import * as THREE from 'three';
import { asset, loadImage } from './common.js';

const CELLS = 64, SUB = 6;
export const SIZE = 24.855;                                   // metres across (assumed: drone at 30 m, 45 degree field of view)

function columns() {
  const top = (SUB + 1) ** 2, side = 4 * (SUB + 1) * 2, per = top + side, n = CELLS * CELLS;
  const pos = new Float32Array(n * per * 3), cell = new Float32Array(n * per * 2), idx = new Uint32Array(n * (SUB * SUB * 6 + 4 * SUB * 6));
  let v = 0, k = 0;
  for (let cy = 0; cy < CELLS; cy++) for (let cx = 0; cx < CELLS; cx++) {
    const u0 = cx / CELLS, v0 = cy / CELLS, d = 1 / CELLS, base = v;
    const put = (a, b, s) => { pos[v * 3] = u0 + a * d; pos[v * 3 + 1] = v0 + b * d; pos[v * 3 + 2] = s; cell[v * 2] = u0 + d / 2; cell[v * 2 + 1] = v0 + d / 2; v++; };
    for (let j = 0; j <= SUB; j++) for (let i = 0; i <= SUB; i++) put(i / SUB, j / SUB, 0);
    for (let j = 0; j < SUB; j++) for (let i = 0; i < SUB; i++) { const a = base + j * (SUB + 1) + i, b = a + 1, c = a + SUB + 1, e = c + 1; idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = e; }
    for (let s = 0; s < 4; s++) {
      const f = s === 0 ? (t) => [t, 0] : s === 1 ? (t) => [1, t] : s === 2 ? (t) => [1 - t, 1] : (t) => [0, 1 - t], b0 = v;
      for (let i = 0; i <= SUB; i++) { const [a, b] = f(i / SUB); put(a, b, 1 + s * 0.1); put(a, b, 2 + s * 0.1); }
      for (let i = 0; i < SUB; i++) { const a = b0 + i * 2; idx[k++] = a; idx[k++] = a + 2; idx[k++] = a + 1; idx[k++] = a + 1; idx[k++] = a + 2; idx[k++] = a + 3; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCell', new THREE.BufferAttribute(cell, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}

// 16-bit depth in the red and green channels -> half-float texture, tilt removed, 0..1
async function depthTexture(src) {
  const im = await loadImage(asset(src)), w = im.naturalWidth, h = im.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); const px = g.getImageData(0, 0, w, h).data, n = w * h, d = new Float32Array(n);
  let sx = 0, sy = 0, sxx = 0, syy = 0, m = 0;
  for (let i = 0; i < n; i++) { d[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / 65535; m += d[i]; } m /= n;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const X = x / w - 0.5, Y = y / h - 0.5, v = d[y * w + x] - m; sx += X * v; sy += Y * v; sxx += X * X; syy += Y * Y; }
  const ax = sx / sxx, ay = sy / syy; let lo = 9, hi = -9;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; d[i] -= m + ax * (x / w - 0.5) + ay * (y / h - 0.5); if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
  const u = new Uint16Array(n); for (let i = 0; i < n; i++) u[i] = THREE.DataUtils.toHalfFloat((d[i] - lo) / (hi - lo));
  const t = new THREE.DataTexture(u, w, h, THREE.RedFormat, THREE.HalfFloatType); t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; t.userData = { d, w, h, lo, hi };
  return t;
}
async function photoTexture(src, renderer) {
  const t = new THREE.Texture(await loadImage(asset(src))); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true; return t;
}
export function liftTexture(u8, side, smooth) {
  const t = new THREE.DataTexture(u8, side, side, THREE.RedFormat, THREE.UnsignedByteType); t.minFilter = t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter; t.unpackAlignment = 1; t.needsUpdate = true; return t;
}
export async function maskTexture(src) {
  const im = await loadImage(asset(src)), c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const px = g.getImageData(0, 0, 256, 256).data, u = new Uint8Array(65536);
  for (let i = 0; i < 65536; i++) u[i] = px[i * 4];
  return liftTexture(u, 256, true);
}
export const frames = {};
export async function loadFrame(id, renderer) {
  const P = { a: 'aerial-01', d: 'aerial-05', e: 'aerial-03' };
  frames[id] ||= Promise.all([photoTexture('assets/img/gen/' + P[id] + '.jpg', renderer), depthTexture('assets/img/vision/depth-' + id + '.png')]).then(([photo, depth]) => ({ id, photo, depth }));
  return frames[id];
}

const HEIGHT = `
uniform sampler2D dA, dB, lA, lB; uniform float uRelief, uLift, uSmooth, uWave, uMixW, uTime; uniform vec2 uFocus;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float mixAt(vec2 cell){ return smoothstep(0., 1., uMixW * 2.2 - cell.x * .8 - cell.y * .2 - hash(cell) * .2); }
float reliefAt(vec2 uv, vec2 cell){ return (mix(texture2D(dA, uv).r, texture2D(dB, uv).r, mixAt(cell)) - .35) * uRelief; }
float scoreAt(vec2 uv, vec2 cell){
  vec2 p = mix(cell, uv, uSmooth); float s = texture2D(lA, p).r;
  s = mix(s, smoothstep(.47, .53, s), uSmooth);
  float w = smoothstep(0., 1., uWave * 1.9 - distance(p, uFocus) * .9);
  return s * w;
}
float liftAt(vec2 uv, vec2 cell){ float s = scoreAt(uv, cell); return uLift * mix(pow(s, 1.25), s, uSmooth); }
float edgeDrop(vec2 cell){ float e = min(min(cell.x, 1. - cell.x), min(cell.y, 1. - cell.y)); return pow(1. - smoothstep(0., .07, e - hash(cell * 7.) * .035), 2.) * -5.; }
vec2 cellOf(vec2 uv){ return (floor(uv * ${CELLS}.) + .5) / ${CELLS}.; }
float roll(vec2 cell){ float m = mixAt(cell); return -sin(m * 3.14159) * (.5 + hash(cell * 3.) * 1.1); }
float total(vec2 uv){ vec2 c = cellOf(uv); return reliefAt(uv, c) + liftAt(uv, c) + edgeDrop(c) + roll(c); }
`;

export function makeTerrain() {
  const blank = liftTexture(new Uint8Array([0, 0, 0, 0]), 1, false);
  const U = { pA: { value: null }, pB: { value: null }, dA: { value: null }, dB: { value: null }, lA: { value: blank }, uRelief: { value: 3.2 }, uLift: { value: 0 }, uSmooth: { value: 0 }, uWave: { value: 0 }, uMixW: { value: 0 }, uTime: { value: 0 },
    uFocus: { value: new THREE.Vector2(0.5, 0.5) }, uTint: { value: new THREE.Color('#ff6a45') }, uSun: { value: new THREE.Vector3(-0.62, 0.52, -0.42).normalize() }, uDim: { value: 0 }, uScan: { value: -1 }, uClick: { value: new THREE.Vector3(0, 0, -1) }, uFog: { value: new THREE.Color(0x0a0d11) }, uGlow: { value: 1 } };
  const mat = new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide,
    vertexShader: HEIGHT.replace('lA, lB', 'lA') + `
      attribute vec2 aCell; varying vec2 vUv; varying vec2 vCell; varying float vSide, vDepth, vLift, vScore, vFace; varying vec3 vW;
      void main(){ vFace = fract(position.z) * 10.;
        vec2 uv = position.xy; float k = position.z; vUv = uv; vCell = aCell; vSide = k;
        float r = reliefAt(uv, aCell) + edgeDrop(aCell) + roll(aCell), l = liftAt(uv, aCell); vScore = scoreAt(uv, aCell); vLift = l;
        float y = r + l; vDepth = 0.;
        if (k > 1.95) { y = r - 1.6; vDepth = l + 1.6; }
        vec3 w = vec3((uv.x - .5) * ${SIZE}, y, (uv.y - .5) * ${SIZE}); vW = w;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
      }`,
    fragmentShader: HEIGHT.replace('lA, lB', 'lA') + `
      uniform sampler2D pA, pB; uniform vec3 uTint, uSun, uFog, uClick; uniform float uDim, uScan, uGlow;
      varying vec2 vUv; varying vec2 vCell; varying float vSide, vDepth, vLift, vScore, vFace; varying vec3 vW;
      vec3 aces(vec3 x){ return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }
      float shadow(vec2 uv, float y){
        float s = 1., t = .06 + .07 * hash(gl_FragCoord.xy * .013);
        for (int i = 0; i < 18; i++) { vec2 p = uv + uSun.xz * t / ${SIZE}; float hh = total(p), c = y + uSun.y * t; s = min(s, 1. - smoothstep(-.02, .12 + t * .16, hh - c)); t *= 1.24; t += .05; if (s < .02) break; }
        return s;
      }
      void main(){
        float m = mixAt(vCell);
        vec3 ph = mix(texture2D(pA, vUv).rgb, texture2D(pB, vUv).rgb, m);
        float top = step(vSide, .5), lum = dot(ph, vec3(.2126, .7152, .0722));
        float e = 1. / 518.;
        float hx = reliefAt(vUv + vec2(e, 0.), vCell) - reliefAt(vUv - vec2(e, 0.), vCell), hy = reliefAt(vUv + vec2(0., e), vCell) - reliefAt(vUv - vec2(0., e), vCell);
        vec3 px = mix(texture2D(pA, vUv + vec2(.0012, 0.)).rgb, texture2D(pB, vUv + vec2(.0012, 0.)).rgb, m), py = mix(texture2D(pA, vUv + vec2(0., .0012)).rgb, texture2D(pB, vUv + vec2(0., .0012)).rgb, m);
        vec2 b = vec2(dot(px, vec3(.33)) - dot(ph, vec3(.33)), dot(py, vec3(.33)) - dot(ph, vec3(.33)));
        vec3 N = normalize(vec3(-hx / (2. * e * ${SIZE}) * .9 - b.x * 5., 1., -hy / (2. * e * ${SIZE}) * .9 - b.y * 5.));
        float s = clamp(vScore, 0., 1.);
        float on = mix(smoothstep(.06, .6, s), smoothstep(.3, .7, s), uSmooth);
        vec3 col;
        if (top > .5) {
          float sh = shadow(vUv, vW.y + .02), nl = max(dot(N, uSun), 0.);
          float ao = 0.; for (int i = 0; i < 6; i++) { float a = float(i) * 1.047 + .4; vec2 d = vec2(cos(a), sin(a)); ao += max(0., total(vUv + d * .011) - vW.y) + .6 * max(0., total(vUv + d * .028) - vW.y); } ao = exp(-ao * .16);
          vec3 sun = vec3(1.28, 1.16, 1.0), sky = vec3(.36, .43, .52);
          vec3 grey = mix(vec3(lum), ph, .38) * .62;
          vec3 alb = mix(mix(ph, grey, uDim), ph * 1.16, on);
          col = alb * (sun * nl * sh * 1.55 + sky * ao * (.55 + .45 * N.y));
          vec2 H = normalize(vec2(1.)); float spec = pow(max(dot(normalize(uSun + normalize(cameraPosition - vW)), N), 0.), 42.) * smoothstep(.1, .34, lum) * sh; col += spec * .10 * sun;
          // the edges between patches: a hairline where the meaning rises, and the outline itself for a click
          vec2 f = abs(fract(vUv * ${CELLS}.) - .5); float line = smoothstep(.5 - fwidth(vUv.x * ${CELLS}.) * 1.3, .5, max(f.x, f.y));
          col += uTint * line * on * (1. - uSmooth) * .35 * uGlow;
          float raw = texture2D(lA, vUv).r, fw = fwidth(raw) + 1e-4; float iso = 1. - smoothstep(0., 1.6, abs(raw - .5) / fw); col += uTint * iso * uSmooth * uGlow * smoothstep(0., .2, uWave) * 2.2;
          col += uTint * on * .05 * uGlow;
        } else {
          float side = vFace; vec3 n = side < .5 ? vec3(0., 0., -1.) : side < 1.5 ? vec3(1., 0., 0.) : side < 2.5 ? vec3(0., 0., 1.) : vec3(-1., 0., 0.);
          float strata = .5 + .5 * sin(vDepth * 15. + sin(vUv.x * 190.) * .7 + sin(vUv.y * 170.) * .7), gr = hash(floor(vec2((vUv.x + vUv.y) * 900., vDepth * 36.)));
          vec3 earth = mix(vec3(.055, .05, .046), vec3(.135, .115, .095), strata * .55 + gr * .35);
          earth = mix(earth, ph * .62, exp(-vDepth * 7.));
          float l = .28 + .9 * max(dot(n, uSun), 0.);
          col = earth * l * exp(-vDepth * .16) + uTint * on * uGlow * (exp(-vDepth * 12.) * 1.1 + exp(-vDepth * 1.5) * .12);
          col *= step(.03, vLift + abs(edgeDrop(vCell)) + abs(roll(vCell)));
        }
        if (uScan > -.5) { float bnd = exp(-abs(vUv.y + hash(vCell) * .02 - uScan) * 60.); vec2 f = abs(fract(vUv * 32.) - .5); col += vec3(.35, .6, .95) * bnd * (.12 + .5 * step(.485, max(f.x, f.y))); }
        if (uClick.z > 0.) { float d = distance(vUv, uClick.xy) * ${SIZE}, r = uClick.z * 2.4; float ring = exp(-abs(d - r) * 16.) * (1. - smoothstep(1.2, 2.6, r)) + (1. - smoothstep(.06, .11, d)) * .9; col += uTint * ring * 1.3; }
        float edge = min(min(vCell.x, 1. - vCell.x), min(vCell.y, 1. - vCell.y)); col *= smoothstep(-.01, .12, edge);
        float dist = length(cameraPosition - vW); float fog = 1. - exp(-pow(max(0., dist - 8.) / 24., 1.7)); col = mix(col, uFog, fog);
        col = aces(col * 1.22); col = pow(col, vec3(1. / 2.2));
        col += (hash(gl_FragCoord.xy + fract(uTime) * 61.) - .5) * .016;
        gl_FragColor = vec4(col, 1.);
      }` });
  const mesh = new THREE.Mesh(columns(), mat); mesh.frustumCulled = false;
  // height of the ground (without lift) at a point, for pins and beams
  const ground = (f, u, v) => { const { d, w, h, lo, hi } = f.depth.userData, i = Math.min(h - 1, v * h | 0) * w + Math.min(w - 1, u * w | 0); return ((d[i] - lo) / (hi - lo) - 0.35) * U.uRelief.value; };
  return { mesh, U, ground, blank, at: (u, v, y = 0) => new THREE.Vector3((u - 0.5) * SIZE, y, (v - 0.5) * SIZE) };
}

// A soft additive column of light and slow dust, shared by the scenes.
export function makeBeam() {
  const g = new THREE.CylinderGeometry(0.55, 0.3, 9, 40, 1, true); g.translate(0, 4.5, 0);
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uC: { value: new THREE.Color('#ff6a45') }, uA: { value: 0 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN, vV; void main(){ vUv = uv; vec4 p = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = normalize(-p.xyz); gl_Position = projectionMatrix * p; }',
    fragmentShader: 'uniform vec3 uC; uniform float uA; varying vec2 vUv; varying vec3 vN, vV; void main(){ float f = pow(abs(dot(vN, vV)), 1.6); gl_FragColor = vec4(uC, f * pow(1. - vUv.y, 2.4) * .3 * uA); }' });
  const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 5; return { mesh, U: m.uniforms };
}
export function makeDust(n = 700, R = 11) {
  const p = new Float32Array(n * 3), s = new Float32Array(n); let a = 7; const r = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) { p[i * 3] = (r() - 0.5) * 2 * R; p[i * 3 + 1] = r() * 7; p[i * 3 + 2] = (r() - 0.5) * 2 * R; s[i] = r(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aS', new THREE.BufferAttribute(s, 1));
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 }, uP: { value: 1 } },
    vertexShader: 'attribute float aS; uniform float uT, uP; varying float vA; void main(){ vec3 q = position; q.x += sin(uT * .13 + aS * 30.) * .7; q.y = mod(q.y + uT * .05 * (.3 + aS), 7.); q.z += cos(uT * .11 + aS * 50.) * .7; vec4 v = modelViewMatrix * vec4(q, 1.); vA = (.1 + .25 * aS) * smoothstep(1., 3., -v.z) * (1. - smoothstep(10., 18., -v.z)); gl_PointSize = uP * (1. + aS * 2.) * 9. / -v.z; gl_Position = projectionMatrix * v; }',
    fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(.75, .8, .86), vA * smoothstep(.5, .1, d)); }' });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; return { mesh: pts, U: m.uniforms };
}
