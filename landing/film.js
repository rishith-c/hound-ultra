// The opening film: four stills joined into one move. Each still has a depth map (Depth Anything V2 small, run once
// when the page was made), so the camera can push into it, look around it with the cursor, and dissolve through fog
// to the next. One full-screen WebGL 2 quad; the plain <img> underneath is the first paint and the fallback.
import { clamp, lerp } from './shared.js';

const VERT = `#version 300 es
in vec2 a; out vec2 v; void main(){ v = vec2(a.x * 0.5 + 0.5, 0.5 - a.y * 0.5); gl_Position = vec4(a, 0.0, 1.0); }`;
const FRAG = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D iA, dA, iB, dB;
uniform vec2 uRes, uMouse, uLight;
uniform vec4 oA, oB;          // origin.xy of the framing, focal point.xy of the push
uniform vec4 kA, kB;          // scale, mist, rain, dust
uniform float pA, pB, uMix, uTime, uPulse;
const float ASP = 1.7778;
const vec3 MIST = vec3(0.60, 0.65, 0.68);

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.9375; }
vec2 cover(vec2 uv){
  float rs = uRes.x / uRes.y;
  vec2 s = rs > ASP ? vec2(1.0, ASP / rs) : vec2(rs / ASP, 1.0);
  return (1.0 - s) * vec2(0.5, 0.42) + uv * s;
}
float rain(vec2 uv, float cols, float speed, float len){
  vec2 p = vec2(uv.x * uRes.x / uRes.y + uv.y * 0.13, uv.y);
  float c = floor(p.x * cols), r = hash(vec2(c, 7.0));
  float y = fract(p.y * (0.55 + r * 0.5) - uTime * speed * (0.7 + r * 0.6) + r * 13.0);
  float x = abs(fract(p.x * cols) - 0.5);
  return smoothstep(0.09, 0.0, x) * smoothstep(len, 0.0, y) * step(0.62, hash(vec2(c, 3.0)));
}
float dust(vec2 uv, float n, float sp){
  vec2 p = vec2(uv.x * uRes.x / uRes.y, uv.y) * n + vec2(uTime * sp, -uTime * sp * 0.6);
  vec2 i = floor(p), f = fract(p) - 0.5; vec2 q = vec2(hash(i), hash(i + 9.1)) - 0.5;
  float r = length(f - q * 0.7);
  return smoothstep(0.07, 0.0, r) * step(0.72, hash(i + 4.7)) * (0.4 + 0.6 * sin(uTime * 0.9 + hash(i) * 40.0));
}

vec3 shot(sampler2D tI, sampler2D tD, vec4 org, vec4 k, float push, float pulse){
  vec2 uv = (v - org.xy) / k.x + org.xy;
  vec2 b = cover(uv), q = b; float d = 0.0;
  for (int i = 0; i < 3; i++){
    d = texture(tD, q).r;
    q = org.zw + (b - org.zw) / (1.0 + push * (0.03 + 0.15 * d)) + (d - 0.25) * uMouse * vec2(-0.015, -0.010);
  }
  d = texture(tD, q).r;
  vec3 c = texture(tI, q).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 0.82); c = pow(c, vec3(1.06)) * 1.0; c *= vec3(0.975, 1.0, 1.025);

  // fog sits between the planes: thick far away, thin wisps crossing in front
  float t = uTime, far = fbm(vec2(q.x * 2.6 - t * 0.012, q.y * 4.2 + t * 0.004));
  far = smoothstep(0.4, 0.85, far) * smoothstep(0.4, 0.05, d);
  float near = fbm(vec2(q.x * 1.3 + t * 0.024, q.y * 2.1 - t * 0.006) + 31.0);
  near = smoothstep(0.5, 0.9, near) * smoothstep(0.1, 0.6, d) * 0.5;
  c = mix(c, MIST, clamp(far * 0.5 + near * 0.32, 0.0, 0.62) * k.y);

  // the light that follows the cursor
  vec2 g = (v - uLight) * vec2(uRes.x / uRes.y, 1.0);
  float glow = exp(-dot(g, g) / 0.085);
  c *= 1.0 + glow * 0.45; c += glow * 0.03 * MIST;

  if (k.z > 0.0) c += (rain(v, 150.0, 1.9, 0.10) * 0.10 + rain(v + 3.7, 70.0, 2.7, 0.16) * 0.13) * vec3(0.78, 0.84, 0.9) * (0.55 + glow * 0.9) * k.z;
  if (k.w > 0.0) c += (dust(v, 16.0, 0.10) * 0.30 + dust(v + 5.0, 34.0, 0.16) * 0.16) * vec3(1.0, 0.94, 0.84) * (0.25 + smoothstep(0.45, 0.0, length((v - vec2(0.58, 0.48)) * vec2(1.6, 1.0)))) * k.w;

  // the pulse: wavefronts that leave the antenna and travel over the shape of the scene, tracing what they touch
  if (pulse > 0.001){
    vec2 px = vec2(1.6 / 384.0, 1.6 / 216.0);
    float ds = (d * 2.0 + texture(tD, q + vec2(px.x, 0.0)).r + texture(tD, q - vec2(px.x, 0.0)).r + texture(tD, q + vec2(0.0, px.y)).r + texture(tD, q - vec2(0.0, px.y)).r) / 6.0;
    vec2 f2 = (q - vec2(0.387, 0.235)) * vec2(ASP, 1.0);
    float D = sqrt(dot(f2, f2) + pow((ds - 0.36) * 1.15, 2.0)), w = 0.0, e2 = 0.0;
    float gx = texture(tD, q + vec2(px.x, 0.0)).r - texture(tD, q - vec2(px.x, 0.0)).r, gy = texture(tD, q + vec2(0.0, px.y)).r - texture(tD, q - vec2(0.0, px.y)).r;
    float ed = smoothstep(0.05, 0.28, length(vec2(gx, gy)));
    for (int i = 0; i < 2; i++){
      float T = fract(uTime / 5.6 + float(i) * 0.5), r = 1.45 * T, fade = smoothstep(0.0, 0.06, T) * smoothstep(1.0, 0.6, T), back = r - D;
      float env = step(0.0, back) * exp(-back * 5.0) * smoothstep(0.0, 0.012, back);      // the wave train: crests behind the front
      float crest = pow(0.5 + 0.5 * cos(back * 105.0), 4.0);
      w += fade * (env * (crest * 0.85 + 0.10) + exp(-pow(back / 0.006, 2.0)) * 0.9);
      e2 += fade * step(0.0, back) * exp(-back * 3.2) * ed;
    }
    c *= 1.0 - 0.18 * pulse;
    c += pulse * vec3(0.46, 0.72, 1.0) * (w * (0.34 + 1.1 * l) + e2 * 0.75);
  }
  return c;
}
void main(){
  vec3 c;
  if (uMix <= 0.0) c = shot(iA, dA, oA, kA, pA, 0.0 + uPulse);
  else {
    // dissolve through a bank of fog that rolls across the frame
    float n = fbm(vec2(v.x * 2.1 + uTime * 0.02, v.y * 2.6)) * 0.7 + (1.0 - v.x) * 0.3;
    float m = smoothstep(n - 0.22, n + 0.22, uMix * 1.5 - 0.25);
    c = mix(shot(iA, dA, oA, kA, pA, 0.0), shot(iB, dB, oB, kB, pB, uPulse), m);
    float bank = 4.0 * m * (1.0 - m);
    c = mix(c, MIST * (0.42 + 0.5 * n), bank * 0.55 * smoothstep(0.0, 0.2, uMix) * smoothstep(1.0, 0.8, uMix));
  }
  vec2 e = v - 0.5; c *= 1.0 - dot(e, e) * 0.5;
  c += (hash(v * uRes + fract(uTime) * 91.0) - 0.5) * 0.026;
  o = vec4(c, 1.0);
}`;

// framing of each still: origin x,y (which corner the crop holds), focal point of the push, then scale, mist, rain, dust
export const SHOTS = [
  { image: 'hero.webp', depth: 'hero-depth.png', o: [0, 1, 0.47, 0.40], k: [1.14, 1, 1, 0] },
  { image: 'hero-block.webp', depth: 'block-depth.png', o: [0.6, 0.9, 0.62, 0.50], k: [1.06, 0.8, 1, 0] },
  { image: 'scene-corridor.webp', depth: 'corridor-depth.png', o: [0.2, 0.6, 0.665, 0.42], k: [1.05, 0.45, 0.0, 0.35] },
  { image: 'scene-rover.webp', depth: 'rover-depth.png', o: [1, 0.5, 0.45, 0.50], k: [1.10, 0.18, 0, 1] },
];
// where each dissolve happens, in screens scrolled
export const CUTS = [[0.50, 0.98], [1.78, 2.22], [2.92, 3.36]];
export const END = 4.1;

const loadImage = (src) => new Promise((resolve, reject) => { const im = new Image(); im.decoding = 'async'; im.onload = () => resolve(im); im.onerror = () => reject(new Error('could not load ' + src)); im.src = src; });

export async function startFilm(canvas, base) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL 2 is not available');
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const U = {}; for (const n of ['iA', 'dA', 'iB', 'dB', 'uRes', 'uMouse', 'uLight', 'oA', 'oB', 'kA', 'kB', 'pA', 'pB', 'uMix', 'uTime', 'uPulse']) U[n] = gl.getUniformLocation(prog, n);
  gl.uniform1i(U.iA, 0); gl.uniform1i(U.dA, 1); gl.uniform1i(U.iB, 2); gl.uniform1i(U.dB, 3);
  const tex = (im) => {
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
    for (const [p, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, val);
    return t;
  };
  const loaded = [];
  const load = async (i) => { if (loaded[i]) return; const [im, dp] = await Promise.all([loadImage(base + SHOTS[i].image), loadImage(base + SHOTS[i].depth)]); loaded[i] = { im: tex(im), dp: tex(dp) }; };
  await load(0);
  const rest = (async () => { for (let i = 1; i < SHOTS.length; i++) await load(i); })().catch((e) => console.warn('[landing] film', e.message));

  const REST = [0.47, 0.42];
  const st = { x: 0, sx: 0, mx: 0, my: 0, tx: 0, ty: 0, lx: REST[0], ly: REST[1], tlx: REST[0], tly: REST[1], visible: true, raf: 0, last: 0, t0: performance.now(), scale: 1, slow: 0, n: 0 };
  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(1.5, window.devicePixelRatio || 1) * st.scale;
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); gl.uniform2f(U.uRes, w, h); }
  }
  new ResizeObserver(resize).observe(canvas); resize();
  addEventListener('pointermove', (e) => { const x = clamp(e.clientX / innerWidth), y = clamp(e.clientY / innerHeight); st.tx = x * 2 - 1; st.ty = y * 2 - 1; st.tlx = x; st.tly = y; }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { st.tx = 0; st.ty = 0; st.tlx = REST[0]; st.tly = REST[1]; });
  const bind = (unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
  const span = (i) => [i ? CUTS[i - 1][0] : 0, i < CUTS.length ? CUTS[i][1] : END + 0.6];
  const push = (i, x) => { const [p, q] = span(i); return clamp((x - p) / (q - p)); };

  function draw(now) {
    const x = st.sx; let i = 0, mix = 0;
    while (i < CUTS.length && x >= CUTS[i][1]) i++;
    if (i < CUTS.length && x > CUTS[i][0] && loaded[i + 1]) mix = (x - CUTS[i][0]) / (CUTS[i][1] - CUTS[i][0]);
    while (i > 0 && !loaded[i]) i--;
    const t = (now - st.t0) / 1000, A = SHOTS[i], B = SHOTS[Math.min(SHOTS.length - 1, i + 1)];
    const drift = 0.08 - 0.08 * Math.cos(t * 0.11);      // the camera never quite stops
    bind(0, loaded[i].im); bind(1, loaded[i].dp); gl.uniform4fv(U.oA, A.o); gl.uniform4fv(U.kA, A.k); gl.uniform1f(U.pA, push(i, x) + drift);
    if (mix > 0) { bind(2, loaded[i + 1].im); bind(3, loaded[i + 1].dp); gl.uniform4fv(U.oB, B.o); gl.uniform4fv(U.kB, B.k); gl.uniform1f(U.pB, push(i + 1, x) + drift); }
    else { bind(2, loaded[i].im); bind(3, loaded[i].dp); }
    gl.uniform1f(U.uMix, mix); gl.uniform1f(U.uTime, t);
    gl.uniform1f(U.uPulse, clamp((x - 3.25) / 0.35));
    gl.uniform2f(U.uMouse, st.mx + Math.sin(t * 0.19) * 0.35, st.my + Math.sin(t * 0.13 + 1) * 0.25); gl.uniform2f(U.uLight, st.lx, st.ly);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function frame(now) {
    st.raf = 0;
    if (!st.visible || document.hidden) return;
    const raw = now - st.last, dt = Math.min(0.05, raw / 1000 || 0.016); st.last = now;
    // keep it smooth on slow graphics: drop the resolution if frames stay long
    if (raw < 200 && ++st.n > 40) { st.slow = st.slow * 0.95 + (raw > 21 ? 0.05 : 0); if (st.slow > 0.4 && st.scale > 0.5) { st.scale *= 0.8; st.slow = 0; st.n = 0; resize(); } }
    const k = 1 - Math.exp(-dt * 3.2), kl = 1 - Math.exp(-dt * 5.5), ks = 1 - Math.exp(-dt * 9);   // follow without overshoot
    st.mx = lerp(st.mx, st.tx, k); st.my = lerp(st.my, st.ty, k); st.lx = lerp(st.lx, st.tlx, kl); st.ly = lerp(st.ly, st.tly, kl); st.sx = lerp(st.sx, st.x, ks);
    draw(now);
    st.raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!st.raf && st.visible && !document.hidden) { st.last = performance.now(); st.raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', kick);
  new IntersectionObserver((es) => { st.visible = es[es.length - 1].isIntersecting; kick(); }).observe(canvas);
  kick();
  return { set(x) { st.x = x; if (Math.abs(x - st.sx) > 1.2) st.sx = x; }, rest, shots: () => loaded.filter(Boolean).length };
}
