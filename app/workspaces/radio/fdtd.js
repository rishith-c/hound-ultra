// The wave itself: a live finite-difference time-domain solve of the 2-D wave equation at 2.437 GHz, on the GPU.
//
//   E+ = (2E - (1 - s)E- + (c dt/dx)^2 / er * lap E) / (1 + s),   s = sigma dt / (2 e0 er)
//
// E is the vertical electric field in a horizontal slice (the same polarisation rf.js uses). Walls are slabs with the
// ITU-R P.2040-4 permittivity and conductivity used by the ray tracer, thickness ASSUMED (rf.MATERIALS). The edge of the
// grid is an absorbing sponge. Two fields are solved side by side with identical arithmetic: one with the person in it
// and one without, so their difference is exactly the energy the body scattered.
// Limits: a 2-D slice (a line source: amplitude falls as 1/sqrt(r), not 1/r), 7.7 cells per wavelength in air and about
// 3.4 inside concrete, furniture left out. It is for the eye; every number on the screen comes from rf.js or the network.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { C0, F0 } from './lab.js';
import { MATERIALS } from './rf.js';

const EPS0 = 8.8541878128e-12, S = 0.6;
export const BODY_EPS = 50, BODY_SIGMA = 1.7;                          // assumed: water-like tissue at 2.4 GHz
const VERT = 'in vec3 position; void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
const raw = (fs, uniforms) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: 'precision highp float; precision highp int; precision highp sampler2D;\n' + fs, uniforms, depthTest: false, depthWrite: false });

export function createField(renderer, world, { rect, dx = 0.016, sponge = 1.1 }) {
  const [x0, y0, x1, y1] = rect, nx = Math.round((x1 - x0) / dx), ny = Math.round((y1 - y0) / dx);
  const dt = (S * dx) / C0, w = 2 * Math.PI * F0, wdt = w * dt;
  const mat = new Float32Array(nx * ny * 2);
  const C2 = S * S;
  // ---- paint the materials, with one-cell soft edges ----
  const eps = new Float32Array(nx * ny).fill(1), sig = new Float32Array(nx * ny);
  const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c; return c; };
  for (const o of world.OBSTACLES) {
    if (o.kind !== 'rubble' || o.passable) continue;
    const xs = o.poly.map((p) => p[0]), ys = o.poly.map((p) => p[1]);
    for (let j = Math.max(0, Math.floor((Math.min(...ys) - y0) / dx)); j < Math.min(ny, (Math.max(...ys) - y0) / dx); j++) for (let i = Math.max(0, Math.floor((Math.min(...xs) - x0) / dx)); i < Math.min(nx, (Math.max(...xs) - x0) / dx); i++)
      if (inPoly([x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dx], o.poly)) { eps[j * nx + i] = 1.6; sig[j * nx + i] = 0.0046; }        // 6 dB per metre, assumed (rf.js)
  }
  for (const wl of world.WALLS) {
    if (wl.state === 'collapsed') continue;
    const m = MATERIALS[wl.mat] || MATERIALS.drywall, sg = m.c * Math.pow(F0 / 1e9, m.d), hor = Math.abs(wl.b[0] - wl.a[0]) > Math.abs(wl.b[1] - wl.a[1]), th = m.thick / 2, ext = wl.mat === 'concrete' ? th : 0;
    const ax = Math.min(wl.a[0], wl.b[0]), bx = Math.max(wl.a[0], wl.b[0]), ay = Math.min(wl.a[1], wl.b[1]), by = Math.max(wl.a[1], wl.b[1]);
    const r = hor ? [ax - ext, ay - th, bx + ext, by + th] : [ax - th, ay - ext, bx + th, by + ext];
    for (let j = Math.max(0, Math.floor((r[1] - y0) / dx) - 1); j < Math.min(ny, (r[3] - y0) / dx + 1); j++) for (let i = Math.max(0, Math.floor((r[0] - x0) / dx) - 1); i < Math.min(nx, (r[2] - x0) / dx + 1); i++) {
      const cx = x0 + (i + 0.5) * dx, cy = y0 + (j + 0.5) * dx, cover = Math.max(0, Math.min(1, (Math.min(cx - r[0], r[2] - cx)) / dx + 0.5)) * Math.max(0, Math.min(1, (Math.min(cy - r[1], r[3] - cy)) / dx + 0.5));
      const k = j * nx + i; eps[k] = Math.max(eps[k], 1 + (m.a - 1) * cover); sig[k] = Math.max(sig[k], sg * cover);
    }
  }
  const sp = sponge / dx;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, d = Math.min(i, j, nx - 1 - i, ny - 1 - j), e = Math.max(0, 1 - d / sp);
    mat[k * 2] = C2 / eps[k]; mat[k * 2 + 1] = (sig[k] * dt) / (2 * EPS0 * eps[k]) + 0.32 * e * e * e;
  }
  const tM = new THREE.DataTexture(mat, nx, ny, THREE.RGFormat, THREE.FloatType); tM.needsUpdate = true;
  const mk = () => new THREE.WebGLRenderTarget(nx, ny, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false });
  let A = mk(), B = mk();
  const out = new THREE.WebGLRenderTarget(nx, ny, { count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false, stencilBuffer: false });
  for (const t of out.textures) { t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
  const step = raw(`
    uniform sampler2D tS, tM; uniform vec2 uTx; uniform vec3 uBody; uniform float uDrive, uOn; layout(location = 0) out vec4 o;
    void main(){ ivec2 p = ivec2(gl_FragCoord.xy); vec4 c = texelFetch(tS, p, 0);
      vec2 E = c.xz, P = c.yw;
      vec2 lap = texelFetch(tS, p + ivec2(1, 0), 0).xz + texelFetch(tS, p - ivec2(1, 0), 0).xz + texelFetch(tS, p + ivec2(0, 1), 0).xz + texelFetch(tS, p - ivec2(0, 1), 0).xz - 4.0 * E;
      vec2 m = texelFetch(tM, p, 0).rg;
      vec2 q = gl_FragCoord.xy; float d = length((q - uBody.xy) / vec2(1.0, 1.5)) - uBody.z;
      float b = uOn * clamp(0.5 - d * 0.5, 0.0, 1.0);
      vec2 k = vec2(mix(m.r, ${(C2 / BODY_EPS).toFixed(6)}, b), m.r), s = vec2(mix(m.g, ${((BODY_SIGMA * dt) / (2 * EPS0 * BODY_EPS)).toFixed(6)} + 0.05, b), m.g);
      vec2 N = (2.0 * E - (1.0 - s) * P + k * lap) / (1.0 + s);
      vec2 t = q - uTx; N += uDrive * exp(-dot(t, t) * 0.35);
      o = vec4(N.x, E.x, N.y, E.y); }`, { tS: { value: null }, tM: { value: tM }, uTx: { value: new THREE.Vector2() }, uBody: { value: new THREE.Vector3() }, uDrive: { value: 0 }, uOn: { value: 0 } });
  // analytic signal from E and the previous step, carrier removed, with and without the body
  const demod = raw(`
    uniform sampler2D tS; uniform vec2 uRot; layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
    void main(){ vec4 c = texelFetch(tS, ivec2(gl_FragCoord.xy), 0);
      vec2 a = vec2(c.x, (c.x * ${Math.cos(wdt).toFixed(8)} - c.y) * ${(1 / Math.sin(wdt)).toFixed(8)}), b = vec2(c.z, (c.z * ${Math.cos(wdt).toFixed(8)} - c.w) * ${(1 / Math.sin(wdt)).toFixed(8)}), d = a - b;
      mat2 r = mat2(uRot.x, uRot.y, -uRot.y, uRot.x); a = r * a; d = r * d;
      o0 = vec4(a, d); o1 = vec4(length(a), length(d), length(b), 1.0); }`, { tS: { value: null }, uRot: { value: new THREE.Vector2(1, 0) } });
  const quad = new FullScreenQuad(step);
  const clear = () => { const c = new THREE.Color(), a = renderer.getClearAlpha(); renderer.getClearColor(c); renderer.setClearColor(0, 0); for (const t of [A, B, out]) { renderer.setRenderTarget(t); renderer.clear(true, false, false); } renderer.setRenderTarget(null); renderer.setClearColor(c, a); };
  let n = 0;
  const api = {
    rect, nx, ny, dx, dt, tex: out.textures, get ns() { return n * dt * 1e9; }, get steps() { return n; },
    reset() { n = 0; clear(); },
    step(count, tx, body) {
      const u = step.uniforms; u.uTx.value.set((tx[0] - x0) / dx, (tx[1] - y0) / dx);
      if (body) { u.uBody.value.set((body[0] - x0) / dx, (body[1] - y0) / dx, 0.14 / dx); u.uOn.value = body[2] ?? 1; } else u.uOn.value = 0;
      quad.material = step;
      for (let i = 0; i < count; i++) {
        n++; u.uDrive.value = 0.35 * Math.sin((n * wdt) % (2 * Math.PI)) * (1 - Math.exp(-n / 40));
        u.tS.value = A.texture; renderer.setRenderTarget(B); quad.render(renderer); const t = A; A = B; B = t;
      }
    },
    resolve() { const ph = (n * wdt) % (2 * Math.PI); demod.uniforms.tS.value = A.texture; demod.uniforms.uRot.value.set(Math.cos(ph), Math.sin(ph)); quad.material = demod; renderer.setRenderTarget(out); quad.render(renderer); renderer.setRenderTarget(null); },
    // amplitude along a row or column, read back: only for the self test
    probe(x, y, wN = 1, hN = 1) { const b = new Float32Array(wN * hN * 4); renderer.readRenderTargetPixels(A, Math.round((x - x0) / dx), Math.round((y - y0) / dx), wN, hN, b); return b; },
    wdt,
    dispose() { A.dispose(); B.dispose(); out.dispose(); tM.dispose(); step.dispose(); demod.dispose(); quad.dispose(); },
  };
  return api;
}
