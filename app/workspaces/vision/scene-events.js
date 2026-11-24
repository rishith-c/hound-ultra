// Vision lab, Demo scene 05: event camera.
import * as THREE from 'three';
import { asset, loadImage } from './common.js';

const crop = (im, x, y, w, h, W, H) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(im, x, y, w, h, 0, 0, W, H); return c; };
const texOf = (c) => { const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
const FIN = 'vec3 fin(vec3 c){ c = clamp((c * (2.51 * c + .03)) / (c * (2.43 * c + .59) + .14), 0., 1.); return pow(c, vec3(1. / 2.2)); }';

// ---------- 05 event camera ----------
// A synthesised clip: a hovering drone above frame A, the person's hand waving. Every pixel compares log brightness with the
// value at its last event and reports a change of 18 per cent. The cloud is those reports, in x, y and time.
export async function events(env) {
  const { ui, ease, span, lerp, pointer, lab } = env;
  const im = await loadImage(asset('assets/img/gen/aerial-01.jpg')), CX = 722, CY = 524, CW = 384, CH = 216, W = 300, H = 169, K = CW / W, MG = 24;
  const src = crop(im, CX - MG, CY - MG, CW + 2 * MG, CH + 2 * MG, CW + 2 * MG, CH + 2 * MG), sw = src.width, sh = src.height, px = src.getContext('2d').getImageData(0, 0, sw, sh).data, L = new Float32Array(sw * sh);
  for (let i = 0; i < L.length; i++) L[i] = Math.pow((0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2]) / 255, 2.2);
  const HX = 907 - CX, HY = 590 - CY, EY = 608 - CY, C = 0.18, N = W * H, ref = new Float32Array(N), CAP = 1 << 18, buf = new Float32Array(CAP * 4); let head = 0, now = 0, counted = 0, rate = 0, rateT = 0; buf.fill(-1e3);
  const st = { ox: 0, oy: 0, A: 0 };
  const lum = (x, y) => {                                         // x, y in crop pixels
    const dx = (x - HX) / 17, dy = (y - HY) / 24, g = Math.exp(-(dx * dx + dy * dy) * 1.1), lever = Math.max(0, Math.min(1.3, (EY - y) / 22)); x += st.ox - st.A * g * lever; y += st.oy;
    x += MG; y += MG; if (x < 0) x = 0; if (y < 0) y = 0; if (x > sw - 2) x = sw - 2; if (y > sh - 2) y = sh - 2; const i = x | 0, j = y | 0, u = x - i, v = y - j, o = j * sw + i;
    return (L[o] * (1 - u) + L[o + 1] * u) * (1 - v) + (L[o + sw] * (1 - u) + L[o + sw + 1] * u) * v;
  };
  const pose = (t, drift) => { st.A = 11 * Math.sin(t * 2 * Math.PI * 1.3); st.ox = drift * 14 * Math.sin(t * 1.9); st.oy = drift * 9 * Math.sin(t * 2.7 + 1); };
  pose(0, 0); for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) ref[j * W + i] = Math.log(lum(i * K, j * K) + 0.02);
  const bx0 = Math.max(0, ((HX - 46) / K) | 0), bx1 = Math.min(W, ((HX + 46) / K) | 0), by0 = Math.max(0, ((HY - 50) / K) | 0), by1 = Math.min(H, ((HY + 44) / K) | 0);
  const geo = new THREE.BufferGeometry(), attr = new THREE.BufferAttribute(buf, 4); attr.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('position', new THREE.BufferAttribute(new Uint8Array(CAP * 3), 3));
  function step(dt, drift, full) {
    now += dt; pose(now, drift); const x0 = full ? 0 : bx0, x1 = full ? W : bx1, y0 = full ? 0 : by0, y1 = full ? H : by1; const h0 = head; let made = 0;
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) {
      const p = j * W + i, l = Math.log(lum(i * K, j * K) + 0.02); let d = l - ref[p], c = 0; 
      while ((d > C || d < -C) && c < 4) { const s = d > 0 ? 1 : -1; ref[p] += s * C; d -= s * C; c++; const o = head * 4, hand = !full; buf[o] = i; buf[o + 1] = j; buf[o + 2] = now - dt * lab_r(); buf[o + 3] = s * (hand ? 2 : 1); head = (head + 1) % CAP; made++; }
    }
    counted += made; if (head === h0) return; if (head > h0) attr.addUpdateRange(h0 * 4, (head - h0) * 4); else { attr.addUpdateRange(h0 * 4, (CAP - h0) * 4); attr.addUpdateRange(0, head * 4); } attr.needsUpdate = true;
  }
  const lab_r = lab.rng(77);
  const U = { uNow: { value: 0 }, uPx: { value: 1 }, uMono: { value: 1 } };
  const PW = 9.6, PH = 5.4, SP = 15;
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uNow, uPx; varying vec3 vC; varying float vA; attribute vec4 ev; void main(){ float age = uNow - ev.z; vec3 p = vec3((ev.x / ${W}. - .5) * ${PW}, (.5 - ev.y / ${H}.) * ${PH}, -age * ${SP}.); vec4 v = modelViewMatrix * vec4(p, 1.); float hand = step(1.5, abs(ev.w)), on = step(0., ev.w);
    vC = mix(mix(vec3(.10, .24, .52), vec3(.52, .74, 1.), on), mix(vec3(.75, .16, .06), vec3(1., .52, .34), on), hand); vA = (age < 0. || age > .95) ? 0. : (.18 + .82 * pow(1. - age / .95, 1.4)) * mix(.42, 1., hand); gl_PointSize = uPx * mix(.030, .045, hand) / -v.z; if (vA <= 0.) v = vec4(0., 0., 9., 1.); gl_Position = projectionMatrix * v; }`,
    fragmentShader: 'varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; gl_FragColor = vec4(vC * vA * smoothstep(.5, .25, d), 1.); }' }));
  geo.setAttribute('ev', attr); geo.setDrawRange(0, CAP); pts.frustumCulled = false;
  const pu = { tP: { value: texOf(crop(im, CX, CY, CW, CH, CW * 3, CH * 3)) }, uA: { value: 0 }, uO: { value: new THREE.Vector2() }, uDim: { value: 0.4 } };
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.ShaderMaterial({ uniforms: pu, side: THREE.DoubleSide, vertexShader: 'varying vec2 vUv; void main(){ vUv = vec2(uv.x, 1. - uv.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: FIN + `uniform sampler2D tP; uniform float uA, uDim; uniform vec2 uO; varying vec2 vUv; void main(){ vec2 p = vUv * vec2(${CW}., ${CH}.); vec2 d = (p - vec2(${HX}., ${HY}.)) / vec2(17., 24.); float g = exp(-dot(d, d) * 1.1), lv = clamp((${EY}. - p.y) / 22., 0., 1.3); p += uO; p.x -= uA * g * lv; vec3 c = texture2D(tP, p / vec2(${CW}., ${CH}.)).rgb; float l = dot(c, vec3(.3, .59, .11)); gl_FragColor = vec4(fin(mix(vec3(l), c, .55) * uDim), 1.); }` }));
  photo.position.z = -0.02;
  const lines = []; const X = PW / 2, Y = PH / 2; for (let k = 0; k <= 9; k++) { const z = -k * 0.1 * SP; lines.push(-X, -Y, z, X, -Y, z, -X, -Y, z, -X, -Y - 0.12, z); } for (const [x, y] of [[-X, -Y], [X, -Y], [-X, Y], [X, Y]]) lines.push(x, y, 0, x, y, -0.95 * SP); lines.push(-X, -Y, 0, X, -Y, 0, X, -Y, 0, X, Y, 0, X, Y, 0, -X, Y, 0, -X, Y, 0, -X, -Y, 0);
  const box = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)), new THREE.LineBasicMaterial({ color: 0x6b7b8e, transparent: true, opacity: 0.6 }));
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0.02, 0.026, 0.034); scene.add(box, photo, pts);
  const camera = new THREE.PerspectiveCamera(32, 1.8, 0.1, 100), P = new THREE.Vector3(), T = new THREE.Vector3(); const SLOW = 0.3; let wasFull = false;
  return { scene, camera, still: 4,
    resize(Wd, Hd) { U.uPx.value = Hd * env.ratio / (2 * Math.tan(camera.fov * Math.PI / 360)); },
    enter() { for (let i = 0; i < 120; i++) step(0.008, 0, false); },
    update(dt, t) {
      const k = t % 20, drift = ease(span(k, 8.5, 10)) * (1 - ease(span(k, 14, 15.5))), full = drift > 0.0005;
      if (dt > 0) step(dt * SLOW, drift, full || wasFull); wasFull = full; U.uNow.value = now; rateT += dt * SLOW; if (rateT > 0.12) { rate = counted / rateT; counted = 0; rateT = 0; }
      pu.uA.value = st.A; pu.uO.value.set(st.ox, st.oy); pu.uDim.value = lerp(0.95, 0.34, ease(span(t, 0.4, 2.5)));
      const op = ease(span(t, 0.8, 3.6)), a = lerp(0, 0.86 + Math.sin(t * 0.11) * 0.2, op) + pointer.yaw, el = lerp(0.02, 0.52, op) + pointer.pitch, D = lerp(10.2, 13.6, op); T.set(lerp(0, 1.0, op), lerp(0, 0.3, op), lerp(0, -4.6, op));
      P.set(T.x + Math.sin(a) * Math.cos(el) * D, T.y + Math.sin(el) * D, T.z + Math.cos(a) * Math.cos(el) * D); camera.position.copy(P); camera.lookAt(T); camera.updateMatrixWorld();
      ui.say(t < 2 ? 'The drone hovers. Nothing else moves.' : drift > 0.3 ? 'The drone drifts, and every edge of the rubble reports at once.' : 'Still drone: one waving hand, drawn through time.', drift > 0.3 || t < 2 ? '' : 'person');
      const share = rate / (N * 30); ui.fig(0, rate < 1000 ? String(Math.round(rate)) : (rate / 1000).toFixed(rate < 1e5 ? 1 : 0), rate < 1000 ? '' : 'k', 'events each second', drift > 0.3 ? '' : 'person'); ui.fig(1, (share * 100).toFixed(share < 0.1 ? 1 : 0), '%', 'of the pixels a 30 Hz camera sends'); ui.fig(2, '0.95', 's', 'of time shown');
    }, };
}

