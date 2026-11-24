// The hero image, alive: a 2.5-D push with a depth map, drifting mist, rain, and a light that follows the cursor.
// One full-screen WebGL quad. The plain <img> stays underneath for first paint and as the fallback.
import { clamp, lerp } from './shared.js';

const VERT = 'attribute vec2 a; varying vec2 v; void main(){ v = vec2(a.x * 0.5 + 0.5, 0.5 - a.y * 0.5); gl_Position = vec4(a, 0.0, 1.0); }';
const FRAG = `
precision highp float;
varying vec2 v;
uniform sampler2D uImg, uDepth;
uniform vec2 uRes, uImgRes, uMouse, uLight;
uniform float uTime, uScroll;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }

vec2 cover(vec2 uv){
  float rs = uRes.x / uRes.y, ri = uImgRes.x / uImgRes.y;
  vec2 s = rs > ri ? vec2(1.0, ri / rs) : vec2(rs / ri, 1.0);
  return (1.0 - s) * vec2(0.5, 0.42) + uv * s;
}
float rain(vec2 uv, float cols, float speed, float len){
  vec2 p = vec2(uv.x * uRes.x / uRes.y + uv.y * 0.13, uv.y);
  float col = floor(p.x * cols), r = hash(vec2(col, 7.0));
  float y = fract(p.y * (0.55 + r * 0.5) - uTime * speed * (0.7 + r * 0.6) + r * 13.0);
  float x = abs(fract(p.x * cols) - 0.5);
  return smoothstep(0.09, 0.0, x) * smoothstep(len, 0.0, y) * step(0.62, hash(vec2(col, 3.0)));
}
void main(){
  vec2 c = vec2(0.0, 1.0);                                  // same framing as the <img> underneath (landing.css)
  vec2 uv = (v - c) / (1.14 + uScroll * 0.08) + c;
  vec2 iuv = cover(uv);
  float d = texture2D(uDepth, iuv).r;                       // 1 = near the camera
  iuv += (d - 0.42) * (uMouse * vec2(-0.011, -0.007) + vec2(0.0, uScroll * 0.018));
  d = texture2D(uDepth, iuv).r;
  vec3 col = texture2D(uImg, iuv).rgb;

  // grade: quieter colour, a little more weight
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, 0.8);
  col = pow(col, vec3(1.08)) * 0.88;
  col *= vec3(0.97, 1.0, 1.03);

  // mist: thick in the far valley, thin wisps crossing the near slope
  float t = uTime;
  float far = fbm(vec2(iuv.x * 2.6 - t * 0.010, iuv.y * 4.2 + t * 0.004));
  far = smoothstep(0.42, 0.85, far) * smoothstep(0.75, 0.15, d) * smoothstep(0.02, 0.2, iuv.y);
  float near = fbm(vec2(iuv.x * 1.3 + t * 0.022, iuv.y * 2.1 - t * 0.006) + 31.0);
  near = smoothstep(0.5, 0.9, near) * smoothstep(0.35, 0.95, d) * 0.5;
  vec3 mist = vec3(0.66, 0.71, 0.73);
  col = mix(col, mist, clamp(far * 0.5 + near * 0.3, 0.0, 0.62));

  // the light that follows the cursor: lifts what it passes over
  vec2 q = (v - uLight) * vec2(uRes.x / uRes.y, 1.0);
  float glow = exp(-dot(q, q) / 0.085);
  col *= 1.0 + glow * 0.5;
  col += glow * 0.035 * mist;

  // rain: two sheets, nearer one faster and longer
  float r = rain(v, 150.0, 1.9, 0.10) * 0.10 + rain(v + 3.7, 70.0, 2.7, 0.16) * 0.13;
  col += r * vec3(0.78, 0.84, 0.9) * (0.55 + glow * 0.9);

  // lens: vignette and grain
  vec2 e = v - 0.5;
  col *= 1.0 - dot(e, e) * 0.62;
  col += (hash(v * uRes + fract(t) * 91.0) - 0.5) * 0.028;
  gl_FragColor = vec4(col, 1.0);
}`;

function loadImage(src) {
  return new Promise((resolve, reject) => { const im = new Image(); im.decoding = 'async'; im.onload = () => resolve(im); im.onerror = () => reject(new Error('could not load ' + src)); im.src = src; });
}

export async function startAtmosphere(canvas, { image, depth }) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL is not available');
  const [img, dep] = await Promise.all([loadImage(image), loadImage(depth)]);
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const tex = (unit, im) => {
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  tex(0, img); tex(1, dep);
  const U = (n) => gl.getUniformLocation(prog, n);
  gl.uniform1i(U('uImg'), 0); gl.uniform1i(U('uDepth'), 1); gl.uniform2f(U('uImgRes'), img.naturalWidth, img.naturalHeight);
  const uRes = U('uRes'), uMouse = U('uMouse'), uLight = U('uLight'), uTime = U('uTime'), uScroll = U('uScroll');

  const rest = [0.47, 0.42];                    // the light rests on the village until the cursor moves
  const st = { scroll: 0, mx: 0, my: 0, tx: 0, ty: 0, lx: rest[0], ly: rest[1], tlx: rest[0], tly: rest[1], visible: true, raf: 0, t0: performance.now(), last: 0 };
  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    gl.uniform2f(uRes, w, h);
  }
  new ResizeObserver(resize).observe(canvas); resize();
  window.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    if (e.clientY > r.bottom) return;
    const x = clamp((e.clientX - r.left) / r.width), y = clamp((e.clientY - r.top) / r.height);
    st.tx = x * 2 - 1; st.ty = y * 2 - 1; st.tlx = x; st.tly = y;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { st.tx = 0; st.ty = 0; st.tlx = rest[0]; st.tly = rest[1]; });

  function frame(now) {
    st.raf = 0;
    if (!st.visible || document.hidden) return;
    const dt = Math.min(0.05, (now - st.last) / 1000 || 0.016); st.last = now;
    const k = 1 - Math.exp(-dt * 3.2), kl = 1 - Math.exp(-dt * 5.5);   // critically damped follow: no overshoot
    st.mx = lerp(st.mx, st.tx, k); st.my = lerp(st.my, st.ty, k);
    st.lx = lerp(st.lx, st.tlx, kl); st.ly = lerp(st.ly, st.tly, kl);
    gl.uniform1f(uTime, (now - st.t0) / 1000); gl.uniform1f(uScroll, st.scroll);
    gl.uniform2f(uMouse, st.mx, st.my); gl.uniform2f(uLight, st.lx, st.ly);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    st.raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!st.raf && st.visible && !document.hidden) { st.last = performance.now(); st.raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', kick);
  kick();
  return {
    setScroll(p) { st.scroll = p; const vis = p < 0.985; if (vis !== st.visible) { st.visible = vis; kick(); } },
    frameOnce() { frame(performance.now()); },
  };
}
