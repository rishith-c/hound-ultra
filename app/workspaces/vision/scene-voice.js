// Vision lab, Demo scene 07: hear a voice.
import * as THREE from 'three';
import { asset, loadImage } from './common.js';

const crop = (im, x, y, w, h, W, H) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(im, x, y, w, h, 0, 0, W, H); return c; };
const texOf = (c) => { const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
const FIN = 'vec3 fin(vec3 c){ c = clamp((c * (2.51 * c + .03)) / (c * (2.43 * c + .59) + .14), 0., 1.); return pow(c, vec3(1. / 2.2)); }';

// ---------- 07 hear a voice ----------
export async function voice(env) {
  const { ui, ease, span, lerp, pointer, lab } = env;
  const [rec, stems] = await Promise.all(['data/vision/hero-voice.json', 'data/vision/voice-stems.json'].map((u) => fetch(asset(u)).then((r) => r.json())));
  const NT = 420, NF = 110, FN = 512, HOP = 160;
  const beats = [];
  for (const [id, say, cls] of [['de', 'German. Every word came back right.', 'person'], ['en', 'English, named and written down.', 'person'], ['ja', 'Japanese. The plea intact.', 'person'], ['hi', 'Hindi, named. A language is a lead.', 'person']]) {
    const s = stems.speech.find((x) => x.id === id), b = await (await fetch(asset('data/vision/' + s.file))).arrayBuffer(), pcm = (await new OfflineAudioContext(1, 16000, 16000).decodeAudioData(b)).getChannelData(0), u = new Float32Array(NT * NF), re = new Float64Array(FN), im = new Float64Array(FN); let mx = 1e-9;
    const T = Math.min(NT, Math.floor((pcm.length - FN) / HOP)); const E = new Float32Array(NT * NF);
    for (let t = 0; t < T; t++) { for (let i = 0; i < FN; i++) { re[i] = pcm[t * HOP + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / FN)); im[i] = 0; } lab.dsp.fft(re, im); for (let f = 0; f < NF; f++) { const hz = 90 * Math.pow(5200 / 90, f / (NF - 1)), q = hz / 31.25, a = q | 0, w = q - a; const p = (Math.hypot(re[a], im[a]) * (1 - w) + Math.hypot(re[a + 1], im[a + 1]) * w) * Math.pow(hz / 400, 0.35); E[f * NT + t] = p; if (p > mx) mx = p; } }
    for (let i = 0; i < u.length; i++) u[i] = Math.max(0, 1 + 20 * Math.log10(E[i] / mx + 1e-6) / 46);
    // a light blur so ridges read as terrain
    const v = new Float32Array(u.length); for (let f = 0; f < NF; f++) for (let t = 0; t < NT; t++) { let s2 = 0, w2 = 0; for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) { const ff = f + j, tt = t + k; if (ff < 0 || tt < 0 || ff >= NF || tt >= NT) continue; const w = (j || k) ? (j && k ? 0.06 : 0.22) : 1; s2 += w * u[ff * NT + tt]; w2 += w; } v[f * NT + t] = s2 / w2; }
    const tx = new THREE.DataTexture(Uint16Array.from(v, (x) => THREE.DataUtils.toHalfFloat(x)), NT, NF, THREE.RedFormat, THREE.HalfFloatType); tx.magFilter = tx.minFilter = THREE.LinearFilter; tx.needsUpdate = true;
    const r = rec.whisper.clips[id]; beats.push({ id, say, cls, tx, T, dur: s.dur, text: r.text.trim(), lang: s.language, p: r.pr[0][1], ms: r.detectMs, said: s.text });
  }
  const U = { tA: { value: beats[0].tx }, tB: { value: beats[0].tx }, uMix: { value: 1 }, uPlay: { value: 0 }, uLen: { value: 1 }, uT: { value: 0 }, uFade: { value: 1 } };
  const geo = new THREE.PlaneGeometry(1, 1, NT - 1, NF * 2 - 1), WX = 25, WZ = 11;
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide, vertexShader: `uniform sampler2D tA; uniform float uPlay, uFade; varying vec2 vUv; varying float vH; varying vec3 vW; void main(){ vUv = uv; float s = texture2D(tA, uv).r, grow = smoothstep(0., .035, uPlay - uv.x); float h = pow(s, 1.7) * grow * uFade; vH = h; vec3 p = vec3((uv.x - .5) * ${WX}., h * 2.3, -(uv.y - .5) * ${WZ}.); vW = p; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }`,
    fragmentShader: FIN + `uniform sampler2D tA; uniform float uPlay, uFade; varying vec2 vUv; varying float vH; varying vec3 vW; void main(){ vec2 e = vec2(1. / ${NT}., 1. / ${NF}.); float g = uFade; float hx = (pow(texture2D(tA, vUv + vec2(e.x, 0.)).r, 1.7) - pow(texture2D(tA, vUv - vec2(e.x, 0.)).r, 1.7)) * g * 2.3 * step(vUv.x, uPlay - .02), hy = (pow(texture2D(tA, vUv + vec2(0., e.y)).r, 1.7) - pow(texture2D(tA, vUv - vec2(0., e.y)).r, 1.7)) * g * 2.3 * step(vUv.x, uPlay - .02);
      vec3 N = normalize(vec3(-hx / (2. * e.x * ${WX}.), 1., hy / (2. * e.y * ${WZ}.))), Lg = normalize(vec3(-.7, .5, .35)), V = normalize(cameraPosition - vW); float nl = max(dot(N, Lg), 0.), sp = pow(max(dot(normalize(Lg + V), N), 0.), 50.), rim = pow(1. - max(dot(N, V), 0.), 3.);
      vec3 slate = vec3(.030, .037, .046), ember = vec3(1., .24, .08), pale = vec3(1., .78, .56); float k = smoothstep(.16, .7, vH); vec3 alb = mix(slate, mix(ember, pale, smoothstep(.55, .95, vH)), k);
      vec3 col = alb * (.10 + 1.15 * nl) + sp * (.05 + .16 * k) * vec3(1., .9, .8) + rim * mix(vec3(.05, .08, .12), ember * .3, k); col *= .82; float q = vH * 13., lw = fwidth(q) + 1e-4, iso = 1. - smoothstep(.6, 1.6, abs(fract(q) - .5) / lw); iso *= smoothstep(.02, .12, vH) * (1. - smoothstep(.25, .5, lw)); col = mix(col, mix(vec3(.10, .13, .17), vec3(1., .62, .36), k), iso * .5); col += ember * k * .06;
      float head = exp(-abs(vUv.x - uPlay) * 120.) * step(.003, uPlay) * step(uPlay, .998); col += vec3(.16, .46, 1.) * head * .9;
      vec2 ed = min(vUv, 1. - vUv); col *= smoothstep(0., .05, ed.x) * smoothstep(0., .06, ed.y); float fog = 1. - exp(-pow(max(0., length(cameraPosition - vW) - 12.) / 22., 1.6)); col = mix(col, vec3(.0055, .0072, .0095), fog); gl_FragColor = vec4(fin(col), 1.); }` })); mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a0d11); scene.background.setRGB(0.028, 0.035, 0.044); scene.add(mesh);
  const camera = new THREE.PerspectiveCamera(32, 1.8, 0.1, 100), P = new THREE.Vector3(); let i = 0, b = beats[0], t0 = 0;
  const start = (k, t) => { i = k; b = beats[k]; t0 = t; U.tA.value = b.tx; };
  return { scene, camera, still: 5.5,
    enter() { start(0, 0); },
    update(dt, t) {
      let k = t - t0; if (k > 9) { start((i + 1) % beats.length, t); k = 0; }
      const L = (b.T + 8) / NT, pl = span(k, 0.4, 0.4 + b.dur); U.uPlay.value = pl * L + (pl >= 1 ? 0.06 : 0); U.uFade.value = 1 - ease(span(k, 8.2, 8.95));
      const a = Math.sin(t * 0.1) * 0.28 + 0.18 + pointer.yaw, el = 0.46 + pointer.pitch, D = 21.5 - ease(span(k, 0, 6)) * 3; P.set(Math.sin(a) * Math.cos(el) * D - 1.2, Math.sin(el) * D, Math.cos(a) * Math.cos(el) * D); camera.position.copy(P); camera.lookAt(-1.2 + (b.T / NT - 0.6) * 6, 0.1, 0.4); camera.updateMatrixWorld();
      const heard = span(k, b.dur + 0.5, b.dur + 1.9), n = Math.floor(heard * b.text.length); ui.title(k < b.dur + 0.5 ? 'Listening' : '“' + b.text.slice(0, n) + (n === b.text.length ? '”' : '')); ui.long?.(true); ui.caret(k < b.dur + 2);
      ui.say(k > b.dur + 2 ? b.say : k > b.dur + 0.4 ? 'Writing down what it heard.' : 'A synthetic voice, with the energy of each pitch as height.', k > b.dur + 2 ? b.cls : '');
      ui.fig(0, k > b.dur ? b.lang : '–', '', 'language heard', k > b.dur ? (b.cls === 'person' ? 'person' : '') : ''); ui.fig(1, k > b.dur ? b.p.toFixed(3) : '–', '', 'confidence'); ui.fig(2, '41', 'MB', 'the whole model');
    },
    leave() { ui.long?.(false); }, };
}
