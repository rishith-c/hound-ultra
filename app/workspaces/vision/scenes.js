// Vision lab, Demo scenes 03 and 04: one photo to 3-D, and the pulse landscape.
import * as THREE from 'three';
import { asset, loadImage } from './common.js';
export { events } from './scene-events.js';
export { skin } from './scene-skin.js';
export { voice } from './scene-voice.js';

// ---------- 03 one photo to 3-D ----------
export async function relief(env) {
  const { ui, ease, span, lerp, pointer, clamp } = env;
  const [im, dm, meta] = await Promise.all([loadImage(asset('assets/img/gen/scene-corridor.jpg')), loadImage(asset('assets/img/vision/depth-corridor.png')), fetch(asset('data/vision/hero-depth.json')).then((r) => r.json())]);
  const w = dm.naturalWidth, h = dm.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(dm, 0, 0); const px = g.getImageData(0, 0, w, h).data, n = w * h;
  const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / 65535;
  // the layer behind: the farthest depth within 11 samples, so a moved camera sees wall where a chair was, not a hole
  const r = 11, a = new Float32Array(n), far = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 9; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { const v = d[y * w + k]; if (v < m) m = v; } a[y * w + x] = m; }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { let m = 9; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { const v = a[k * w + x]; if (v < m) m = v; } far[y * w + x] = m; }
  const mk = (src) => { const u = new Uint16Array(n); for (let i = 0; i < n; i++) u[i] = THREE.DataUtils.toHalfFloat(src[i]); const t = new THREE.DataTexture(u, w, h, THREE.RedFormat, THREE.HalfFloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };
  const photo = new THREE.Texture(im); photo.flipY = false; photo.colorSpace = THREE.SRGBColorSpace; photo.minFilter = THREE.LinearMipmapLinearFilter; photo.anisotropy = 8; photo.needsUpdate = true;
  const U = { tD: { value: mk(d) }, tF: { value: mk(far) }, tP: { value: photo }, uTan: { value: 0.4 }, uSweep: { value: -1 }, uPts: { value: 0 }, uT: { value: 0 }, uPx: { value: 1 }, uOpen: { value: 0 } };
  const GEO = `uniform sampler2D tD, tF; uniform float uTan; float zOf(float q){ return min(15., 1. / (.052 + .948 * q)); }
    vec3 place(vec2 uv, float z){ vec2 nd = vec2(uv.x * 2. - 1., 1. - uv.y * 2.); return vec3(nd.x * uTan * 1.7778 * z, nd.y * uTan * z, -z); }`;
  const GRADE = `vec3 fin(vec3 col){ col *= 1.08; col = clamp((col * (2.51 * col + .03)) / (col * (2.43 * col + .59) + .14), 0., 1.); return pow(col, vec3(1. / 2.2)); }`;
  const GX = 462, GY = 259, plane = new THREE.PlaneGeometry(1, 1, GX, GY);
  const meshOf = (fill) => { const m = new THREE.Mesh(plane, new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide, transparent: false,
    vertexShader: GEO + `varying vec2 vUv; varying float vZ, vE; void main(){ vec2 q = vec2(uv.x, 1. - uv.y); vUv = q; float z = zOf(texture2D(${fill ? 'tF' : 'tD'}, q).r); vec2 e = vec2(1. / 462., 1. / 259.);
      float l = log(z); vE = max(max(abs(l - log(zOf(texture2D(${fill ? 'tF' : 'tD'}, q + vec2(e.x, 0.)).r))), abs(l - log(zOf(texture2D(${fill ? 'tF' : 'tD'}, q - vec2(e.x, 0.)).r)))), max(abs(l - log(zOf(texture2D(${fill ? 'tF' : 'tD'}, q + vec2(0., e.y)).r))), abs(l - log(zOf(texture2D(${fill ? 'tF' : 'tD'}, q - vec2(0., e.y)).r)))));
      vZ = z; vec3 p = place(q, z${fill ? ' * 1.015 + .02' : ''}); gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }`,
    fragmentShader: GRADE + `uniform sampler2D tP; uniform float uSweep, uPts, uT, uOpen; varying vec2 vUv; varying float vZ, vE; float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){ ${fill ? 'if (vE > .42) discard;' : 'if (uOpen > .02 && vE > .16) discard;'} if (h(floor(vUv * 900.)) < uPts * 1.05) discard;
        vec3 col = texture2D(tP, vUv${fill ? ', 4.' : ''}).rgb${fill ? ' * .8' : ''}; float fw = fwidth(log(vZ)) + 1e-4, lz = log(vZ);
        float sw = exp(-pow((lz - uSweep) * 9., 2.)), iso = 1. - smoothstep(0., 1.3, abs(fract(lz * 7.) - .5) * 2. / (fw * 14.)); float trail = smoothstep(.9, 0., uSweep - lz) * step(lz, uSweep);
        ${fill ? '' : 'col += vec3(.16, .46, 1.) * (sw * .5 + iso * trail * .35);'} gl_FragColor = vec4(fin(col), 1.); }` })); m.frustumCulled = false; return m; };
  const front = meshOf(false), back = meshOf(true);
  const pts = new THREE.Points(plane, new THREE.ShaderMaterial({ uniforms: U, vertexShader: GEO + `uniform float uPx, uPts; varying vec3 vC; uniform sampler2D tP; uniform float uT; void main(){ vec2 q = vec2(uv.x, 1. - uv.y); float z = zOf(texture2D(tD, q).r); vec3 p = place(q, z); vC = texture2D(tP, q).rgb; float s = exp(-pow((log(z) - mod(uT * .55, 3.4) + .4) * 5., 2.)); vC = vC * 1.15 + vec3(.16, .46, 1.) * s * .5; vec4 v = modelViewMatrix * vec4(p, 1.); gl_PointSize = uPts * max(1.1, uPx * z * .0031 / -v.z); if (z > 11.) v = vec4(0., 0., 9., 1.); gl_Position = projectionMatrix * v; }`, fragmentShader: GRADE + 'varying vec3 vC; void main(){ gl_FragColor = vec4(fin(vC), 1.); }' })); pts.frustumCulled = false;
  // the edge of the photograph, drawn as the pyramid the camera saw
  const fr = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x5aa9ff, transparent: true, opacity: 0 })); fr.frustumCulled = false;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x07090c); scene.add(back, front, pts, fr);
  const camera = new THREE.PerspectiveCamera(42, 1.8, 0.05, 60), P = new THREE.Vector3(), Q = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Vector3();
  const fig = meta['scene-corridor'];
  return { scene, camera, still: 8.5,
    resize(W, H) { const t = Math.tan(camera.fov * Math.PI / 360); U.uTan.value = Math.max(t, t * (W / H) / 1.7778) * 1.02; U.uPx.value = H * env.ratio / (2 * t); const T = U.uTan.value, z = 5, X = T * 1.7778 * z, Y = T * z, v = []; for (const [x, y] of [[-X, Y], [X, Y], [X, -Y], [-X, -Y]]) v.push(0, 0, 0, x, y, -z); const cs = [[-X, Y], [X, Y], [X, -Y], [-X, -Y]]; for (let i = 0; i < 4; i++) v.push(...cs[i], -z, ...cs[(i + 1) % 4], -z); fr.geometry.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); },
    update(dt, t) {
      const k = t % 24; U.uT.value = t;
      U.uSweep.value = k < 5.2 ? lerp(-0.4, 4.2, ease(span(k, 1, 5))) : -1; U.uOpen.value = span(k, 2, 3);
      const out = ease(span(k, 11.5, 14.8)) * (1 - ease(span(k, 18.8, 22.2))), fly = ease(span(k, 3.2, 7)) * (1 - ease(span(k, 10.2, 12)));
      U.uPts.value = ease(span(k, 11.4, 12.8)) * (1 - ease(span(k, 22, 23.6))); front.visible = U.uPts.value < 0.98; back.visible = U.uOpen.value > 0.01 && out < 0.12; pts.visible = U.uPts.value > 0.01; fr.material.opacity = U.uPts.value * 0.35;
      const sw = Math.sin((k - 3.2) * 0.85) * 0.2 * fly;
      P.set(sw + pointer.yaw * 0.45, -0.03 * fly + pointer.pitch * -0.3, -0.75 * fly); Q.set(sw * 0.25, 0, -4);
      const o = Math.sin((k - 11) * 0.28) * 0.5; P.lerp(p.set(5.4 + o + pointer.yaw * 2, 1.9 - pointer.pitch * 3, 2.2 - o), out); Q.lerp(q.set(0.1, -0.2, -4.6), out);
      camera.position.copy(P); camera.lookAt(Q); camera.updateMatrixWorld();
      ui.say(k < 3.4 ? 'One flat picture.' : k < 11 ? 'Now the camera can move. What was hidden is filled in, not seen.' : k < 20 ? 'From the side: the shape the network imagined. Distances are relative.' : 'Back to the photo.');
      ui.fig(0, '1', '', 'picture used'); ui.fig(1, '479', 'k', 'depth samples'); ui.fig(2, '0.3', 's', 'a run, after the first');
    }, };
}

// ---------- 04 pulse ----------
export async function pulse(env) {
  const { ui, ease, span, lerp, pointer, lab } = env;
  const ROWS = 46, N = 320, FS = 30, TRUE = 72, rand = lab.rng(20261123), gs = () => lab.gauss(rand);
  const SHAPE = new Float32Array(512); { let mean = 0, mn = 9, mx = -9; const dd = (x, b) => { x -= b; return x - Math.round(x); }; for (let i = 0; i < 512; i++) { const f = i / 512; SHAPE[i] = Math.exp(-0.5 * (dd(f, 0.18) / 0.07) ** 2) + 0.42 * Math.exp(-0.5 * (dd(f, 0.47) / 0.1) ** 2); mean += SHAPE[i] / 512; mn = Math.min(mn, SHAPE[i]); mx = Math.max(mx, SHAPE[i]); } for (let i = 0; i < 512; i++) SHAPE[i] = (SHAPE[i] - mean) / (mx - mn); }
  // 46 patches of a simulated face in a frame: the middle ones are skin, the rest is wall. Each sample is a patch mean with sensor noise.
  const amp = new Float32Array(ROWS), filt = [], drift = new Float32Array(ROWS); for (let i = 0; i < ROWS; i++) { const u = (i - 21) / 11; amp[i] = 0.0060 * Math.exp(-u * u * u * u) * (0.75 + 0.5 * rand()); filt.push(lab.dsp.bandpass(FS, 0.7, 3)); }
  const data = new Float32Array(N * ROWS), tex = new THREE.DataTexture(data, N, ROWS, THREE.RedFormat, THREE.FloatType); tex.minFilter = tex.magFilter = THREE.NearestFilter;
  const mean = new Float64Array(N); let head = 0, acc = 0, ph = 0, total = 0, est = null, lastEst = 0;
  function sample() {
    ph += TRUE / 60 / FS; const s = SHAPE[((ph % 1) * 512) | 0]; let m = 0, ws = 0;
    for (let i = 0; i < ROWS; i++) { drift[i] += gs() * 0.00035; drift[i] *= 0.998; const x = 0.5 + amp[i] * s + drift[i] + gs() * 0.0011, y = filt[i](x - 0.5); data[i * N + head] = y; const wgt = amp[i] / 0.006; m += wgt * y; ws += wgt; }
    mean[head] = m / ws; head = (head + 1) % N; total++;
  }
  function estimate() { const x = new Float64Array(Math.min(N, total)); for (let i = 0; i < x.length; i++) x[i] = mean[(head - x.length + i + N) % N]; const { power, df } = lab.dsp.spectrum(x, FS, 4096); let b = 0; for (let i = Math.ceil(0.7 / df); i < 3 / df; i++) if (power[i] > power[b] || !b) b = i; const a = Math.log(power[b - 1]), c = Math.log(power[b]), e = Math.log(power[b + 1]); est = (b + 0.5 * (a - e) / (a - 2 * c + e)) * df * 60; }
  const pos = [], idx = []; for (let r = 0; r < ROWS; r++) for (let i = 0; i < N; i++) pos.push(i, r, 1, i, r, 0);
  for (let r = 0; r < ROWS; r++) for (let i = 0; i < N - 1; i++) { const b = (r * N + i) * 2; idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const U = { tX: { value: tex }, uHead: { value: 0 }, uFrac: { value: 0 }, uGain: { value: 0 }, uBeat: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide, vertexShader: `uniform sampler2D tX; uniform float uHead, uFrac, uGain; varying float vD, vSkin, vAge, vH, vRow; 
      float at(float i, float r){ return texture2D(tX, vec2((mod(i + uHead, ${N}.) + .5) / ${N}., (r + .5) / ${ROWS}.)).r; }
      void main(){ float i = position.x, r = position.y, k = min(i + uFrac, ${N - 1}.), i0 = min(floor(k), ${N - 2}.); float y = mix(at(i0, r), at(i0 + 1., r), k - i0);
        vAge = i / ${N - 1}.; float taper = smoothstep(0., .12, vAge) * smoothstep(1., .985, vAge); float h = y * uGain * taper; vH = h; float u = (r - 21.) / 11.; vSkin = exp(-u * u * u * u); vRow = r / ${ROWS}.;
        vec3 p = vec3((vAge - .5) * 27., h, (r - 23.) * .38); vD = 0.; if (position.z < .5) { p.y = -2.2; vD = h + 2.2; } gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }`,
    fragmentShader: `varying float vD, vSkin, vAge, vH, vRow; uniform float uBeat; void main(){ float w = fwidth(vD) + 1e-5, line = 1. - smoothstep(.9, 2.1, vD / w); vec3 cold = vec3(.40, .48, .58), warm = mix(vec3(1., .42, .27), vec3(1., .86, .74), smoothstep(.25, 1.1, vH)); vec3 c = mix(cold * .5, warm, vSkin);
      float edge = smoothstep(0., .14, vAge), near = exp(-(1. - vAge) * 16.) * uBeat * vSkin; vec3 bg = vec3(.024, .031, .039); vec3 fill = bg + c * exp(-vD * 3.2) * (.05 + .2 * smoothstep(0., .8, vH)) * vSkin; vec3 col = mix(fill, c * (.55 + .45 * vSkin + near * 1.2), line * edge * (.5 + .5 * vSkin)); float fog = smoothstep(.45, 1., 1. - vRow); col = mix(col, bg, fog * .55); gl_FragColor = vec4(col, 1.); }` });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; const scene = new THREE.Scene(); scene.background = new THREE.Color(0.024, 0.031, 0.039); scene.add(mesh);
  const camera = new THREE.PerspectiveCamera(30, 1.8, 0.1, 120), P = new THREE.Vector3();
  return { scene, camera, still: 9,
    enter() { if (!total) { for (let i = 0; i < N; i++) sample(); estimate(); tex.needsUpdate = true; } },
    update(dt, t) {
      acc += dt * FS; let k = 0; while (acc >= 1 && k < 6) { sample(); acc -= 1; k++; } if (k) tex.needsUpdate = true; U.uHead.value = head; U.uFrac.value = acc;
      if (t - lastEst > 0.5 || t < lastEst) { lastEst = t; estimate(); }
      const c = t % 22, up = ease(span(c, 1.2, 4.5)) * (1 - ease(span(c, 19.5, 21.5))), gain = lerp(4, 420, up); U.uGain.value = gain; U.uBeat.value = Math.max(0, SHAPE[((ph % 1) * 512) | 0]);
      const a = 0.32 + Math.sin(t * 0.09) * 0.22 + pointer.yaw, el = lerp(0.30, 0.42, up) + pointer.pitch, D = lerp(27, 23.5, up); P.set(Math.sin(a) * Math.cos(el) * D + 1.5, Math.sin(el) * D, Math.cos(a) * Math.cos(el) * D); camera.position.copy(P); camera.lookAt(0.6, -0.9, 0); camera.updateMatrixWorld();
      ui.say(c < 1.6 || c > 21 ? 'What the sensor records, before amplifying.' : up < 0.98 && c < 5 ? 'Amplifying the pulse band, 0.7 to 3 hertz.' : 'Orange rows are skin, beating together. Grey rows are the wall.', up > 0.9 ? 'person' : '');
      ui.fig(0, est ? est.toFixed(1) : '–', 'bpm', 'estimated here', 'person'); ui.fig(1, TRUE.toFixed(1), 'bpm', 'simulated truth'); ui.fig(2, '×' + Math.round(gain / 4), '', 'amplified');
    }, };
}
