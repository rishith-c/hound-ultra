// Vision lab, Demo scene 06: skin by its spectrum.
import * as THREE from 'three';
import { asset, loadImage } from './common.js';

const crop = (im, x, y, w, h, W, H) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(im, x, y, w, h, 0, 0, W, H); return c; };
const texOf = (c) => { const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
const FIN = 'vec3 fin(vec3 c){ c = clamp((c * (2.51 * c + .03)) / (c * (2.43 * c + .59) + .14), 0., 1.); return pow(c, vec3(1. / 2.2)); }';

// ---------- 06 skin by its spectrum ----------
export async function skin(env) {
  const { ui, ease, span, lerp, pointer } = env;
  const im = await loadImage(asset('assets/img/gen/aerial-01.jpg')), CX = 300, CY = 430, CW = 720, CH = 405, W = 720, H = 405, c = crop(im, CX, CY, CW, CH, W, H), px = c.getContext('2d').getImageData(0, 0, W, H).data;
  // material map: skin is placed by hand on the visible hands and faces; the rest follows colour. Simulated, not measured.
  const hits = [0, 0, 0, 0, 0], SK = [[907, 587, 8], [401, 573, 6.5], [384, 541, 5], [940, 664, 4], [937, 624, 3.5]], mat = new Uint8Array(W * H * 4); let nSkin = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2], ix = CX + x, iy = CY + y; let m = 1;                   // 0 skin 1 mud 2 concrete 3 leaf 4 cloth
    const lum = (r + g + b) / 3; if (g > r * 1.06 && g > b * 1.12) m = 3; else if (b > r * 1.25 || r > g * 1.75) m = 4; else if (lum > 112) m = 2;
    SK.forEach(([sx, sy, sr], s) => { if (Math.hypot(ix - sx, iy - sy) < sr && r > g && lum > 96 && r > b * 1.14) { m = 0; nSkin++; hits[s]++; } });
    mat[i] = m * 50; mat[i + 1] = Math.min(255, lum * 1.4); mat[i + 3] = 255;
  }
  const sk8 = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) sk8[i] = mat[i * 4] === 0 ? 255 : 0; { const c0 = sk8.slice(); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { let s = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) s += c0[(y + a) * W + x + b]; sk8[y * W + x] = s / 9; } } const skT = new THREE.DataTexture(sk8, W, H, THREE.RedFormat, THREE.UnsignedByteType); skT.unpackAlignment = 1; skT.magFilter = skT.minFilter = THREE.LinearFilter; skT.needsUpdate = true;
  const mt = new THREE.DataTexture(mat, W, H); mt.magFilter = mt.minFilter = THREE.NearestFilter; mt.needsUpdate = true;
  const LAM = [450, 550, 650, 800, 950, 1080, 1200, 1300, 1450, 1580, 1700], R = { 0: [.22, .28, .48, .60, .56, .56, .40, .41, .07, .14, .17], 1: [.06, .09, .13, .18, .21, .24, .23, .24, .10, .19, .22], 2: [.25, .30, .34, .37, .38, .39, .39, .40, .35, .40, .41], 3: [.04, .09, .05, .46, .46, .45, .36, .37, .12, .24, .22], 4: [.14, .10, .24, .52, .56, .58, .58, .58, .52, .55, .54] };
  const at = (m, l) => { let i = 0; while (i < LAM.length - 2 && LAM[i + 1] < l) i++; const u = (l - LAM[i]) / (LAM[i + 1] - LAM[i]); return R[m][i] * (1 - u) + R[m][i + 1] * u; };
  const B = 30, lam = Array.from({ length: B }, (_, i) => 450 + i * (1700 - 450) / (B - 1)), near = (l) => lam.reduce((b, v, i) => (Math.abs(v - l) < Math.abs(lam[b] - l) ? i : b), 0), I1 = near(1080), I2 = near(1580);
  const ndsi = (m) => (at(m, 1080) - at(m, 1580)) / (at(m, 1080) + at(m, 1580));
  const photo = texOf(c); photo.minFilter = THREE.LinearMipmapLinearFilter; const PW = 9.6, PH = 5.4, planes = [], geo = new THREE.PlaneGeometry(PW, PH);
  const VS = 'varying vec2 vUv; void main(){ vUv = vec2(uv.x, 1. - uv.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }';
  const COMMON = FIN + 'uniform sampler2D tP, tM; varying vec2 vUv; float pick(float m, float a[5]){ return m < .5 ? a[0] : m < 1.5 ? a[1] : m < 2.5 ? a[2] : m < 3.5 ? a[3] : a[4]; } ';
  // blackbody-like false colour for the infrared bands: cool to pale, never warm (warm is kept for people)
  for (let i = 0; i < B; i++) {
    const refl = [0, 1, 2, 3, 4].map((m) => at(m, lam[i])), vis = lam[i] < 700, hue = vis ? new THREE.Color().setHSL(lerp(0.66, 0, (lam[i] - 450) / 250), 0.5, 0.62) : new THREE.Color().setHSL(lerp(0.56, 0.62, (lam[i] - 700) / 1000), 0.22, 0.72);
    const u = { tP: { value: photo }, tM: { value: mt }, uR: { value: refl }, uH: { value: hue }, uA: { value: 1 }, uL: { value: 1 } };
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexShader: VS, fragmentShader: COMMON + 'uniform float uR[5], uA, uL; uniform vec3 uH; void main(){ float m = texture2D(tM, vUv).r * 255. / 50.; vec3 c = texture2D(tP, vUv).rgb; float l = dot(c, vec3(.3, .59, .11)), d = clamp(l / .16, .25, 2.1); float r = pick(m, uR) * mix(1., d, .75); vec2 e = min(vUv, 1. - vUv) * vec2(9.6, 5.4); float edge = 1. - smoothstep(0., .035, min(e.x, e.y)); gl_FragColor = vec4(fin(uH * r * 1.5 * uL + edge * uH * .7), uA * mix(1., .9, edge)); }' }));
    m.userData = { u, i }; planes.push(m);
  }
  const bu = { tP: { value: photo }, tM: { value: mt }, tS: { value: skT }, uR: { value: [0, 1, 2, 3, 4].map(ndsi) }, uOn: { value: 0 } };
  const base = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: bu, transparent: true, side: THREE.DoubleSide, vertexShader: VS, fragmentShader: COMMON + 'uniform sampler2D tS; uniform float uR[5], uOn; void main(){ float m = texture2D(tM, vUv).r * 255. / 50.; vec3 c = texture2D(tP, vUv).rgb; float l = dot(c, vec3(.3, .59, .11)); float n = pick(m, uR); float sweep = smoothstep(0., .02, uOn * 1.1 - vUv.x); vec3 dark = vec3(l) * vec3(.5, .56, .62) * .42 + vec3(.02, .035, .05) * n; float hit = smoothstep(.3, .6, texture2D(tS, vUv).r) * step(.45, uR[0]); vec3 nd = dark; float ring = exp(-abs(uOn * 1.1 - vUv.x) * 60.) * step(.001, uOn) * step(uOn, .999); vec3 o = fin(mix(c * 1.2, nd, sweep) + vec3(.16, .46, 1.) * ring); gl_FragColor = vec4(mix(o, vec3(1., .416, .27) * (.75 + .6 * l), hit * sweep), 1.); }' }));
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0.02, 0.026, 0.034); scene.add(base); planes.forEach((p) => scene.add(p));
  const halo = SK.filter((s, i) => s[2] > 4.5 && hits[i] > 8).map(([x, y, r]) => { const m = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.416, 0.27), transparent: true, opacity: 0, side: THREE.DoubleSide, depthTest: false })); m.position.set(((x - CX) / CW - 0.5) * PW, (0.5 - (y - CY) / CH) * PH, 0.03); m.userData = { r: 0.16 + r * 0.01 }; m.renderOrder = 70; scene.add(m); return m; });
  const camera = new THREE.PerspectiveCamera(32, 1.8, 0.1, 100), P = new THREE.Vector3(), T = new THREE.Vector3(), PIN = new THREE.Vector3();
  const nS = ndsi(0).toFixed(2), nM = ndsi(1).toFixed(2), nL = ndsi(3).toFixed(2);
  return { scene, camera, still: 13.5,
    update(dt, t) {
      const k = t % 21, ex = ease(span(k, 1.2, 4.2)) * (1 - ease(span(k, 8.6, 10.6))), pickT = ease(span(k, 5, 6.6)) * (1 - ease(span(k, 8.4, 9.6))), on = ease(span(k, 10.6, 12.6)) * (1 - span(k, 20.2, 20.9));
      planes.forEach((p, i) => { const z = (B - 1 - i), chosen = i === I1 || i === I2; p.position.z = -0.02 - (i * 0.36) * ex; p.position.y = chosen ? pickT * 2.5 : 0; p.position.x = chosen ? pickT * (i === I1 ? -0.6 : 0.6) : 0; p.userData.u.uA.value = ex * (chosen ? 1 : lerp(0.9, 0.16, pickT)) * ease(span(k, 1, 2)); p.userData.u.uL.value = chosen ? 1 + pickT * 0.25 : 1; p.renderOrder = chosen && pickT > 0.4 ? 10 + (i === I1 ? 1 : 0) : z * -1 + 0; p.renderOrder = chosen && pickT > 0.4 ? p.renderOrder : B - i; p.visible = p.userData.u.uA.value > 0.01; });
      base.renderOrder = 60; base.visible = true; base.material.opacity = 1; base.position.z = 0.02; base.position.x = -ex * 0; base.scale.setScalar(1); bu.uOn.value = on;
      const a = 0.78 * ex + Math.sin(t * 0.16) * 0.07 + pointer.yaw, el = 0.2 * ex + 0.03 + pointer.pitch, D = lerp(9.0, 17.2, ex) - on * 1.3; T.set(lerp(0, 1.5, ex), lerp(0, 0.35, ex), lerp(0, -3.6, ex));
      P.set(T.x - Math.sin(a) * Math.cos(el) * D * -1, T.y + Math.sin(el) * D, T.z + Math.cos(a) * Math.cos(el) * D); camera.position.copy(P); camera.lookAt(T); camera.updateMatrixWorld();
      halo.forEach((m, i) => { const s = span(k, 12.2 + i * 0.25, 13.2 + i * 0.25); m.material.opacity = on > 0.9 ? ease(s) * 0.95 : 0; m.scale.setScalar(m.userData.r * lerp(5, 1, ease(s))); });
      ui.say(k < 1.6 ? 'What a colour camera sees.' : k < 5 ? 'The same view in 30 bands, from blue to short-wave infrared.' : k < 10 ? 'Water in skin darkens 1580 nm and leaves 1080 nm bright.' : 'One normalised difference of two bands marks the skin we placed.', k > 11 && k < 20.5 ? 'person' : '');
      ui.fig(0, k > 10.6 ? nS : '–', '', 'skin index, simulated', k > 10.6 ? 'person' : ''); ui.fig(1, k > 10.6 ? nM : '–', '', 'wet mud'); ui.fig(2, k > 10.6 ? nL : '–', '', 'leaves');
      if (k > 13.4 && k < 20) { PIN.copy(halo[0].position); ui.pin(PIN, 'A hand', 'person'); } else ui.pin(null);
    }, };
}

