// The Demo hero, "the idea": a Wi-Fi wave crosses a partition, a person moves, the wave comes back changed.
//   the wave       fdtd.js, a live 2-D wave-equation solve at 2.437 GHz through the real walls, drawn as light
//   the person     a second solve without them runs beside it; the difference is what the body scattered (orange)
//   the channel    rf.js traced paths plus the body's echoes on the 51 subcarriers, 100 packets a second
//   the score      the real network, on the last ten seconds of those packets (nnworker.js, same code and weights)
// The set (stage.js) is the plan of classrooms 111 and 112. It is built in slices; the first picture comes before the post passes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as rf from './rf.js';
import { createField } from './fdtd.js';
import { buildStage, patch, noiseTexture } from './stage.js';
import { BODY, TX as TX0, RX as RX0, RIPPLE, buildBody, toWindow, normalise } from './person.js';
import { F0, DF, C0 } from './lab.js';
import roverActor from '../../twin/actors/rover.js';

const RECT = [66.4, 43.2, 83.6, 59.2], HZ = 100, KEEP = 10.6, STEPS = 5, DRAWN = 100;
const DK = (2 * Math.PI * DF) / C0, KC = (2 * Math.PI * F0) / C0, PARAM = { wall: 0.5, ref: 0.3 };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- the person: an articulated figure, the only warm thing in the frame ----------
function makeFigure(colPerson, colHot) {
  const uniforms = { uC: { value: colPerson }, uH: { value: colHot }, uA: { value: 1 }, uBreath: { value: 0 } };
  const J = Array.from({ length: 20 }, () => new THREE.Vector3()), uni = { ...uniforms, uJ: { value: J }, uLamp: { value: new THREE.Vector3(71.6, 3.6, -46.2) }, uMoon: { value: new THREE.Vector3(0.82, 0.42, -0.4).normalize() } };
  const proxy = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.0, 1.5), new THREE.ShaderMaterial({ uniforms: uni, transparent: true, side: THREE.BackSide,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec3 vW; uniform vec3 uJ[20], uC, uH, uLamp, uMoon; uniform float uA, uBreath; uniform mat4 projectionMatrix;
      float sm(float a, float b, float k){ float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
      float cp(vec3 p, vec3 a, vec3 b, float r0, float r1){ vec3 d = b - a; float h = clamp(dot(p - a, d) / max(dot(d, d), 1e-6), 0.0, 1.0); return length(p - a - d * h) - mix(r0, r1, h); }
      float map(vec3 p){
        vec3 ch = uJ[1], pe = uJ[0], lat = normalize(uJ[5] - uJ[4] + 1e-5), fwd = normalize(cross(lat, vec3(0.0, 1.0, 0.0)));
        vec3 q = p - ch; float f = dot(q, fwd); vec3 pf = p + fwd * f * 0.28;                                     // the trunk is flatter than it is wide
        float d = cp(pf, pe - lat * 0.065, pe + lat * 0.065, 0.118, 0.118);
        d = sm(d, cp(pf, pe + vec3(0.0, 0.06, 0.0), ch, 0.122, 0.132), 0.10);
        d = sm(d, cp(pf, ch + vec3(0.0, 0.05, 0.0) - lat * 0.075, ch + vec3(0.0, 0.05, 0.0) + lat * 0.075, 0.128 + uBreath, 0.128 + uBreath), 0.10);
        d = sm(d, cp(p, uJ[4], uJ[5], 0.06, 0.06), 0.09);
        d = sm(d, cp(p, uJ[2] - vec3(0.0, 0.06, 0.0), uJ[3] - vec3(0.0, 0.03, 0.0), 0.058, 0.048), 0.06);
        float hd = cp(p, uJ[3] + vec3(0.0, 0.045, 0.0) - fwd * 0.012, uJ[3] - vec3(0.0, 0.055, 0.0) + fwd * 0.02, 0.092, 0.062); d = sm(d, hd, 0.035);
        for (int s = 0; s < 2; s++) { int o = 4 + s;
          float a = cp(p, uJ[o], uJ[o + 2], 0.060, 0.044); a = sm(a, cp(p, uJ[o + 2], uJ[o + 4], 0.045, 0.030), 0.03); a = sm(a, cp(p, uJ[o + 4], uJ[o + 6], 0.033, 0.026), 0.03); d = sm(d, a, 0.045);
          float l = cp(p, uJ[o + 8], uJ[o + 10], 0.098, 0.064); l = sm(l, cp(p, mix(uJ[o + 10], uJ[o + 12], 0.02), uJ[o + 12], 0.064, 0.042), 0.04); l = sm(l, cp(p, uJ[o + 12] - vec3(0.0, 0.035, 0.0), uJ[o + 14], 0.044, 0.034), 0.04); d = sm(d, l, 0.05); }
        return d; }
      void main(){ vec3 ro = cameraPosition, rd = normalize(vW - ro); float tb = length(vW - ro), t = max(tb - 2.7, 0.0), best = 1.0, tb0 = t, d = 1.0; bool hit = false;
        for (int i = 0; i < 80; i++) { d = map(ro + rd * t); if (d < best) { best = d; tb0 = t; } if (d < 0.0012) { hit = true; break; } t += d * 0.6; if (t > tb) break; }
        float px = t * fwidth(rd.x + rd.y) * 0.9 + 0.0015, al = hit ? 1.0 : 1.0 - smoothstep(0.0, px, best); if (al <= 0.01) discard; if (!hit) t = tb0;
        vec3 p = ro + rd * t; vec2 e = vec2(0.0035, -0.0035); vec3 n = normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
        float ao = clamp(map(p + n * 0.07) / 0.07, 0.0, 1.0) * 0.6 + 0.4, v = max(dot(n, -rd), 0.0), rim = pow(1.0 - v, 2.4);
        float lk = max(dot(n, normalize(uLamp - p)) * 0.6 + 0.4, 0.0), mk = max(dot(n, uMoon), 0.0), weave = 0.94 + 0.06 * sin(p.y * 260.0);
        vec3 c = uC * (0.045 + 0.46 * lk * lk) * ao * weave + uC * vec3(1.0, 0.9, 0.8) * pow(mk, 1.4) * 0.75 * ao + uH * pow(mk, 6.0) * 0.25 + uC * rim * 1.15 + uH * rim * rim * 0.25;
        vec4 k = projectionMatrix * viewMatrix * vec4(p, 1.0); gl_FragDepth = clamp(k.z / k.w * 0.5 + 0.5, 0.0, 1.0); gl_FragColor = vec4(c, uA * al); }` })); body.position.y = 0.98; body.renderOrder = 1; body.frustumCulled = false;
  const root = new THREE.Group(), meshes = [];
  const put = (parent, geo, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, proxy); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = true; parent.add(o); meshes.push(o); }; root.add(body);
  const pivot = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  const taper = (r0, r1, len) => { const p = []; for (let i = 0; i <= 5; i++) { const a = (i / 5) * Math.PI / 2; p.push(new THREE.Vector2(r1 * Math.sin(a), -len - r1 * Math.cos(a) + 0)); } for (let i = 1; i <= 5; i++) { const t = i / 5; p.push(new THREE.Vector2(r1 + (r0 - r1) * t + 0.1 * r0 * Math.sin(t * Math.PI), -len * (1 - t))); } for (let i = 1; i <= 5; i++) { const a = (i / 5) * Math.PI / 2; p.push(new THREE.Vector2(r0 * Math.cos(a), r0 * Math.sin(a))); } return new THREE.LatheGeometry(p, 24); };
  const hips = pivot(root, 0, 0.93, 0), spine = pivot(hips, 0, 0.06, 0);
  const trunk = new THREE.LatheGeometry([[0.001, -0.14], [0.11, -0.12], [0.155, -0.04], [0.15, 0.05], [0.138, 0.16], [0.152, 0.28], [0.172, 0.38], [0.165, 0.45], [0.11, 0.505], [0.06, 0.53], [0.05, 0.6], [0.001, 0.61]].map((p) => new THREE.Vector2(...p)), 32);
  put(spine, trunk, 0, 0, 0, 1, 1, 0.66);
  const head = pivot(spine, 0, 0.69, 0.015), skull = new THREE.SphereGeometry(1, 28, 20); put(head, skull, 0, 0, 0, 0.078, 0.112, 0.095); put(head, skull, 0, -0.045, 0.02, 0.058, 0.072, 0.07);
  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const sh = pivot(spine, s * 0.19, 0.44, 0); put(sh, skull, 0, 0, 0, 0.066, 0.064, 0.064); put(sh, taper(0.05, 0.039, 0.28), 0, 0, 0); const el = pivot(sh, 0, -0.29, 0); put(el, taper(0.041, 0.028, 0.24), 0, 0, 0); put(el, skull, 0, -0.31, 0.008, 0.03, 0.07, 0.042); arms.push([sh, el, s]);
    const hp = pivot(hips, s * 0.09, -0.03, 0); put(hp, taper(0.086, 0.055, 0.4), 0, 0, 0); const kn = pivot(hp, 0, -0.42, 0); put(kn, taper(0.056, 0.036, 0.38), 0, 0, 0); put(kn, skull, 0, -0.44, 0.055, 0.044, 0.04, 0.12); legs.push([hp, kn, s]);
  }
  return {
    root, uniforms, meshes,
    pose(walk, phase, t) {
      const b = Math.sin(t * 1.7) * 0.008;
      hips.position.y = 0.93 - 0.02 * walk * Math.abs(Math.cos(phase)) ; spine.rotation.x = 0.06 * walk + b * 0.6; spine.rotation.y = 0.12 * walk * Math.sin(phase); hips.rotation.y = -0.1 * walk * Math.sin(phase); head.rotation.y = -0.06 * walk * Math.sin(phase);
      for (const [sh, el, s] of arms) { sh.rotation.x = -s * 0.5 * walk * Math.sin(phase) - 0.04; sh.rotation.z = s * (0.11 + b); el.rotation.x = -0.18 - 0.3 * walk * (0.5 - 0.5 * s * Math.sin(phase)); }
      for (const [hp, kn, s] of legs) { hp.rotation.x = s * 0.42 * walk * Math.sin(phase); hp.rotation.z = s * 0.03; kn.rotation.x = walk * Math.max(0, 0.75 * Math.sin(phase * 1 + (s > 0 ? Math.PI : 0) + Math.PI + 0.9)) + 0.03; }
      // joints in world space, for the ray-marched body
      root.updateMatrixWorld(true); uniforms.uBreath.value = 0.006 * Math.sin(t * 1.57); const at = (o, i, x, y, z) => J[i].set(x, y, z).applyMatrix4(o.matrixWorld);
      at(hips, 0, 0, 0.0, 0); at(spine, 1, 0, 0.3, 0); at(spine, 2, 0, 0.56, 0); at(head, 3, 0, 0.01, 0);
      for (let q = 0; q < 2; q++) { const [sh, el] = arms[q], [hp, kn] = legs[q]; at(sh, 4 + q, 0, 0, 0); at(el, 6 + q, 0, 0, 0); at(el, 8 + q, 0, -0.25, 0); at(el, 10 + q, 0, -0.36, 0.012); at(hp, 12 + q, 0, 0.02, 0); at(kn, 14 + q, 0, 0, 0); at(kn, 16 + q, 0, -0.4, 0); at(kn, 18 + q, 0, -0.46, 0.14); }
    },
  };
}

export async function createHero(host, ctx, lab) {
  const { h } = lab, world = ctx.world, kit = ctx.kit, reduced = () => kit.reducedMotion();
  const col = (name) => new THREE.Color(...lab.rgb(lab.tok(name)).map((v) => v / 255)).convertSRGBToLinear();

  // ---------- DOM ----------
  const canvas = h('canvas.radio-hero-canvas', { role: 'img', tabindex: '0', 'aria-label': 'Building B at night, with a Wi-Fi wave washing through the rooms and a person walking behind a wall. Drag the person or a radio. Space pauses, R replays.' });
  const pins = h('div.radio-hero-pins', { 'aria-hidden': 'true' });
  const band = h('canvas.radio-hero-band', { role: 'img', 'aria-label': 'Received strength of each of the 51 Wi-Fi channels, live, with the change drawn ' + DRAWN + ' times larger' });
  const cap = h('p.radio-hero-cap', { 'aria-live': 'polite' }, '');
  const fNs = h('b.num', null, '0'), fCh = h('b.num', null, '0.0'), fP = h('b.num', null, '–'), fPcap = h('span', null, 'network score');
  const text = h('div.radio-hero-text', null,
    h('div.radio-hero-tags', null, Object.assign(kit.realityTag('live-algo'), { title: 'A 2-D wave equation at 2.437 GHz, solved live on this computer’s graphics chip through the wall plan. The partition is drawn whole, as the solver treats it. Crests are slowed again so the eye can follow them. The person is not slowed.' }), Object.assign(kit.realityTag('live-ai'), { title: 'The project’s trained Wi-Fi network, running here on packets synthesised in this page. Its test results are in Advanced, Wi-Fi AI, Test set.' }), h('span.tag.tag-sim', { title: 'The building, the person and every reading are simulated.' }, 'Simulated person')),
    h('h2', null, 'Wi-Fi passes through walls. A living body changes it.'), cap);
  const figs = h('div.radio-hero-figs', null,
    h('div', null, h('div', null, fNs, h('small', null, 'ns')), h('span', null, 'since the radio spoke')),
    h('div', null, h('div', null, fCh, h('small', null, '%')), h('span', null, 'change on the link')),
    h('div.radio-hero-score', null, h('div', null, fP), fPcap));
  host.append(canvas, pins, h('div.radio-hero-shade'), h('div.radio-hero-inst', null, h('div.radio-hero-insthead', null, h('p.radio-hero-bandcap', null, '51 Wi-Fi channels, live', h('span', null, 'change drawn ' + DRAWN + '×, no receiver noise')), figs), band), text);
  let t0 = performance.now(), worst = 0; const marks = [['start', t0]];
  const slice = async (force) => { const n = performance.now(); if (force || n - t0 > 9) { worst = Math.max(worst, n - t0); await new Promise((r) => setTimeout(r, 0)); t0 = performance.now(); } };
  await slice(true);
  const pin = (t, cls) => { const el = h('div.radio-hero-pin.' + cls, null, h('i'), h('span', null, t)); pins.append(el); return { el, p: new THREE.Vector3(), a: -1, x: -1, y: -1 }; };
  const pinTx = pin('Probe radio', 'tx'), pinRx = pin('HOUND-01', 'rx'), pinP = pin('Person', 'person');

  // ---------- renderer ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.autoClear = false;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  marks.push(['renderer', performance.now()]); await slice(true);
  const scene = new THREE.Scene(); const night = new THREE.Color(0.0035, 0.005, 0.008); scene.background = night; scene.fog = new THREE.FogExp2(night, 0.02);
  // a long lens at 25 degrees, along the partition from room 111; one slow push while the story runs
  const FOV = 20, AZ = 0.61, EL = 0.40, ANCHOR = new THREE.Vector3(75, 0.15, -50.2), D0 = 12.6, D1 = 11.3;
  const camera = new THREE.PerspectiveCamera(FOV, 1.8, 0.5, 80), goal = new THREE.Vector3();
  const pose = (k, az) => { const D = D0 + (D1 - D0) * k, a = AZ + az; goal.set(ANCHOR.x - D * Math.cos(EL) * Math.sin(a), ANCHOR.y + D * Math.sin(EL), ANCHOR.z + D * Math.cos(EL) * Math.cos(a)); };
  pose(0, 0); camera.position.copy(goal);
  const controls = new OrbitControls(camera, canvas); controls.target.copy(ANCHOR); controls.enableDamping = true; controls.dampingFactor = 0.06; controls.minDistance = 5; controls.maxDistance = 18; controls.maxPolarAngle = 1.36; controls.minPolarAngle = 0.12; controls.zoomSpeed = 0.6; controls.enablePan = false;

  // light: a warm work lamp on the two radios, a cold moon behind, a faint sky; the field does the rest
  const moon = new THREE.DirectionalLight(0xb4caf2, 2.1); moon.position.set(90, 13, -57); moon.target.position.set(75.5, 0, -50.5); moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048); { const sc = moon.shadow.camera; sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sc.near = 2; sc.far = 40; } moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.02; scene.add(moon, moon.target);
  scene.add(new THREE.HemisphereLight(0x93a9c9, 0x26231f, 0.75));
  const lamp = new THREE.SpotLight(0xffa35a, 250, 14, 0.27, 0.9, 2); lamp.position.set(71.6, 3.6, -46.2); lamp.target.position.set(74.7, 0.3, -50.3); lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.camera.near = 1; lamp.shadow.camera.far = 12; lamp.shadow.bias = -0.0005; lamp.shadow.normalBias = 0.015; scene.add(lamp, lamp.target);
  const fill = new THREE.DirectionalLight(0x9db7de, 0.95); fill.position.set(66, 9, -41); fill.target.position.set(75, 0, -51); scene.add(fill, fill.target);

  // ---------- the field ----------
  const field = await createField(renderer, world, { rect: RECT, dx: 0.0145, slice }); marks.push(['field', performance.now()]); await slice(true);
  const shared = { uZ: { value: field.tex[0] }, uAmp: { value: field.tex[1] }, uNoise: { value: noiseTexture() }, uRect: { value: new THREE.Vector4(RECT[0], RECT[1], RECT[2] - RECT[0], RECT[3] - RECT[1]) }, uPh: { value: 0 }, uGain: { value: 0.13 }, uWarmG: { value: 0.024 }, uCool: { value: new THREE.Color(0.16, 0.50, 1.0) }, uCore: { value: new THREE.Color(0.72, 0.88, 1) }, uWarm: { value: col('--person') }, uTxw: { value: new THREE.Vector3() } };
  const set = await buildStage({ scene, shared, slice, K: 2 * Math.PI * F0 / C0 }); marks.push(['stage', performance.now()]); await slice(true);

  // ---------- radios and person ----------
  const fig = makeFigure(col('--person'), new THREE.Color(1, 0.86, 0.66)); scene.add(fig.root); fig.root.visible = false;
  const probe = new THREE.Group(); scene.add(probe);
  { const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.4 }), shell = new THREE.MeshStandardMaterial({ color: 0xd5d9dd, roughness: 0.45 }), al = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.35, metalness: 0.9 });
    const add = (g, m, x, y, z, rx = 0, rz = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); o.castShadow = true; probe.add(o); return o; };
    for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.283 + 0.4, l = add(new THREE.CylinderGeometry(0.008, 0.011, 0.74, 10), dark, Math.cos(a) * 0.14, 0.33, Math.sin(a) * 0.14); l.rotation.set(Math.sin(a) * -0.39, 0, Math.cos(a) * 0.39); }
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 16), al, 0, 0.66, 0); add(new THREE.BoxGeometry(0.13, 0.07, 0.085), shell, 0, 0.74, 0); add(new THREE.BoxGeometry(0.134, 0.012, 0.089), dark, 0, 0.74, 0); add(new THREE.CylinderGeometry(0.006, 0.007, 0.12, 12), dark, 0.045, 0.83, 0); add(new THREE.CylinderGeometry(0.006, 0.007, 0.12, 12), dark, -0.045, 0.83, 0);
    const led = add(new THREE.SphereGeometry(0.007, 10, 8), new THREE.MeshBasicMaterial({ color: col('--accent').multiplyScalar(4) }), 0.04, 0.752, 0.044); led.castShadow = false; for (const m of [dark, shell, al]) patch(m, shared, 'plain'); }
  // the rover: the same machine as in The rover and The search (its real CAD), standing still and listening
  const rover = new THREE.Group(); rover.scale.setScalar(0.86); scene.add(rover);
  const still = { setPosition() {}, setText() {}, setSub() {}, setTone() {}, remove() {} };
  const machine = roverActor.create({ THREE, scene: rover, quality: 'low', ctx, world, renderer, groundY: 0, reduced: reduced(), glow() {}, pickable() {}, label: () => still });
  const machineState = { units: { 'HOUND-01': { pos: [0, 0], heading: 0.35, mode: 'listen', odo: 1 } }, sensors: { listen: {} }, hold: false, faults: {}, phase: 'search' };
  // the probe's antenna glows as it speaks
  const halo = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(140,190,255,.5)'); gr.addColorStop(1, 'rgba(60,120,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })); s.renderOrder = 7; scene.add(s); return s; })();
  await slice(true);

  // ---------- handles you can drag ----------
  const st = { tx: TX0.slice(0, 2), rx: RX0.slice(0, 2), person: [78.4, 50.9], on: 0, walk: 0, heading: Math.PI, auto: true, paused: false, T: 0, freeUntil: 0, drag: null };
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.45, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col('--text'), transparent: true, opacity: 0, depthTest: false })); ring.renderOrder = 9; scene.add(ring);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.4), hit = new THREE.Vector3();
  const ground = (e) => { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2); ray.setFromCamera(ndc, camera); return ray.ray.intersectPlane(plane, hit) ? [hit.x, -hit.z] : null; };
  const nearest = (p) => { if (!p) return null; let best = null, bd = 0.95; for (const k of ['person', 'tx', 'rx']) { if (k === 'person' && !st.on) continue; const d = Math.hypot(st[k][0] - p[0], st[k][1] - p[1]); if (d < bd) { bd = d; best = k; } } return best; };
  let hoverKey = null;
  canvas.addEventListener('pointerdown', (e) => { const k = nearest(ground(e)); if (!k || e.button) { st.freeUntil = st.now + 20; return; } st.drag = k; controls.enabled = false; try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events have no pointer to capture */ } e.stopPropagation(); }, true);
  canvas.addEventListener('pointermove', (e) => {
    const p = ground(e); if (!p) return;
    if (!st.drag) { hoverKey = nearest(p); canvas.style.cursor = hoverKey ? 'grab' : ''; return; }
    canvas.style.cursor = 'grabbing'; const q = [lab.clamp(p[0], RECT[0] + 1.6, RECT[2] - 1.6), lab.clamp(p[1], RECT[1] + 1.6, RECT[3] - 1.6)];
    if (st.drag === 'person') { const dx = q[0] - st.person[0], dy = q[1] - st.person[1]; if (Math.hypot(dx, dy) > 0.01) st.heading = Math.atan2(dx, -dy); st.dragTo = q; } else { st[st.drag] = q; relink(); }
    st.auto = false;
  });
  const drop = () => { if (!st.drag) return; st.drag = null; controls.enabled = true; canvas.style.cursor = ''; };
  canvas.addEventListener('pointerup', drop); canvas.addEventListener('pointercancel', drop);
  canvas.addEventListener('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); st.paused = !st.paused; } else if (e.key === 'r' || e.key === 'R') restart(); else if (e.key.startsWith('Arrow') && st.on) { e.preventDefault(); const d = { ArrowLeft: [-0.2, 0], ArrowRight: [0.2, 0], ArrowUp: [0, 0.2], ArrowDown: [0, -0.2] }[e.key]; st.auto = false; st.dragTo = [lab.clamp(st.person[0] + d[0], RECT[0] + 1.6, RECT[2] - 1.6), lab.clamp(st.person[1] + d[1], RECT[1] + 1.6, RECT[3] - 1.6)]; st.heading = Math.atan2(d[0], -d[1]); } });

  // ---------- the link: static channel, packets, window, network ----------
  const scene2 = rf.buildScene(world), bodyPts = buildBody('standing'), rnd = lab.rng(20261121);
  const base = { re: new Float64Array(51), im: new Float64Array(51), amp: new Float64Array(51) }, H = { re: new Float64Array(51), im: new Float64Array(51) };
  const row51 = (s) => (s >= 2 ? s - 2 : s <= -1 ? s + 51 : -1);
  function relink() {
    const T = [...st.tx, TX0[2]], Rr = [...st.rx, RX0[2]], paths = rf.tracePaths(scene2, st.tx, st.rx, { order: 3 }), d = paths.find((p) => p.kind === 'direct') || paths[0]; if (!d) return;
    const c = rf.channel(paths, 0.8 / Math.hypot(d.a[0], d.a[1]) / Math.max(1, Math.hypot(T[0] - Rr[0], T[1] - Rr[1]) / 1.5));
    for (let k = 0; k < 51; k++) { base.re[k] = c.re[k]; base.im[k] = c.im[k]; base.amp[k] = Math.hypot(c.re[k], c.im[k]); }
    let m = 0; for (let k = 0; k < 51; k++) m += base.amp[k]; st.gain = 30 / (m / 51);
    shared.uTxw.value.set(st.tx[0], 0, -st.tx[1]); halo.position.set(st.tx[0], 0.88, -st.tx[1]); probe.position.set(st.tx[0], 0, -st.tx[1]); rover.position.set(st.rx[0], 0, -st.rx[1]);
  }
  function packetChannel(t) {
    H.re.set(base.re); H.im.set(base.im); if (!st.on) return;
    const px0 = st.person[0], py0 = st.person[1], n1 = world.wallsCrossed(st.tx, st.person).length, n2 = world.wallsCrossed(st.rx, st.person).length, loss = Math.pow(PARAM.wall, (n1 + n2) / 2) * st.on;
    const hd = st.heading, dirx = Math.sin(hd), diry = -Math.cos(hd), ch = 0.003 * Math.sin(2 * Math.PI * 0.25 * t), sway = 0.003 * Math.sin(1.1 * t) + 0.002 * Math.sin(2.3 * t + 1);
    for (let q = 0; q < bodyPts.length; q++) {
      const p = bodyPts[q]; let x = px0 + p.x + sway, y = py0 + p.y, z = p.z;
      if (p.part === 0) { x += p.n[0] * ch; y += p.n[1] * ch; }
      if (st.walk > 0) { z += 0.02 * st.walk * Math.sin(2 * st.phase); if (p.part >= 2) { const s = Math.sign(p.x * -diry + p.y * dirx + 1e-9), sw = 0.15 * st.walk * Math.sin(st.phase) * s; x += sw * dirx; y += sw * diry; } }
      const ax = x - st.tx[0], ay = y - st.tx[1], az = z - TX0[2], bx = x - st.rx[0], by = y - st.rx[1], bz = z - RX0[2], d1 = Math.sqrt(ax * ax + ay * ay + az * az), d2 = Math.sqrt(bx * bx + by * by + bz * bz);
      const f = -(p.n[0] * (ax / d1 + bx / d2) + p.n[1] * (ay / d1 + by / d2) + p.n[2] * (az / d1 + bz / d2)) / 2; if (f <= 0) continue;
      const amp = ((BODY * p.area * f) / PARAM.ref / Math.max(d1 * d2, 0.25)) * loss, d = d1 + d2, cr = Math.cos(KC * d), ci = -Math.sin(KC * d), sr = Math.cos(DK * d), si = -Math.sin(DK * d);
      let ur = cr, ui = ci; for (let s = 1; s <= 26; s++) { const nr = ur * sr - ui * si; ui = ur * si + ui * sr; ur = nr; if (s > 1) { H.re[s - 2] += amp * ur; H.im[s - 2] += amp * ui; } }
      ur = cr; ui = ci; for (let s = -1; s >= -26; s--) { const nr = ur * sr + ui * si; ui = ui * sr - ur * si; ur = nr; H.re[s + 51] += amp * ur; H.im[s + 51] += amp * ui; }
    }
  }
  const CAP = Math.ceil(KEEP * HZ) + 8, ringT = new Float64Array(CAP), ringA = Array.from({ length: CAP }, () => new Float32Array(51)); let head = 0, tPk = 0, agcAt = 6, agc = 1;
  const dev = new Float32Array(51); let change = 0;
  function packet() {
    tPk += 1 / HZ; packetChannel(tPk);
    if (tPk > agcAt) { agc = rnd.range(0.85, 1.2); agcAt = tPk - 14 * Math.log(1 - rnd()); }
    let e = 0; for (let k = 0; k < 51; k++) { dev[k] += (100 * (Math.hypot(H.re[k], H.im[k]) / base.amp[k] - 1) - dev[k]) * 0.22; e += Math.hypot(H.re[k] - base.re[k], H.im[k] - base.im[k]) / base.amp[k]; } change += ((100 * e) / 51 - change) * 0.06;
    if (rnd() < 0.05) return;                                                // lost packets, as the ESP32 model has
    const row = ringA[head], g = st.gain * agc * (1 + 0.015 * Math.sin(tPk / 20)); ringT[head] = tPk + rnd() * 0.004;
    for (let k = 0; k < 51; k++) { const s = g * RIPPLE[k], I = Math.max(-127, Math.min(127, Math.round(H.re[k] * s + 0.15 * rnd.normal()))), Q = Math.max(-127, Math.min(127, Math.round(H.im[k] * s + 0.15 * rnd.normal()))); row[k] = Math.sqrt(I * I + Q * Q); }
    head = (head + 1) % CAP;
  }
  let worker = null, busy = false, score = NaN, shown = NaN, moving = NaN, thr = ctx.nn?.threshold ?? 0.53, inferAt = 0, runs = 0, scoreLog = [];
  const answer = (o) => { busy = false; if (o.error) { console.error('[radio] network worker: ' + o.error); return; } score = o.person; moving = o.moving; thr = o.threshold ?? thr; runs++; if (scoreLog.length < 400) scoreLog.push([+st.T.toFixed(1), +o.person.toFixed(3)]); };
  try { worker = new Worker(new URL('./nnworker.js', import.meta.url), { type: 'module' }); worker.onmessage = (e) => answer(e.data); worker.onerror = () => { worker = null; busy = false; }; } catch { worker = null; }
  function infer() {
    if (busy) return; const idx = []; for (let i = 0; i < CAP; i++) { const j = (head + i) % CAP; if (ringT[j] > 0 && ringT[j] > tPk - KEEP) idx.push(j); }
    const W = toWindow(idx.map((j) => ringT[j]), idx.map((j) => ringA[j]), tPk); if (!W) return; const x = normalise(W); busy = true;
    if (worker) worker.postMessage({ id: runs, x }); else answer(ctx.nn.infer(x));
  }

  // ---------- the instrument: 51 bars, one per subcarrier. Height = received strength; its change is drawn DRAWN times larger ----------
  const bc = band.getContext('2d'); let bw = 0, bh = 0, bd = 1, gCool = null, gWarm = null; const order = Array.from({ length: 51 }, (_, i) => i).sort((a, b) => rowSub(a) - rowSub(b)); function rowSub(k) { return k < 25 ? k + 2 : k - 51; }
  const rgbS = (v, a) => 'rgba(' + v.map(Math.round).join(',') + ',' + a + ')', cP = lab.rgb(lab.tok('--person')), cA = lab.rgb(lab.tok('--accent')), cT = lab.rgb(lab.tok('--text')), mixc = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
  const sAc = rgbS(cA, 1), sPe = rgbS(cP, 1), sTick = rgbS(cT, 0.55), sCapC = rgbS(mixc(cA, [255, 255, 255], 0.72), 1), sCapW = rgbS(mixc(cP, [255, 255, 255], 0.6), 1), peak = new Float32Array(51);
  function bandSize() { bd = Math.min(2, window.devicePixelRatio || 1); bw = band.clientWidth; bh = band.clientHeight; if (!bw || !bh) return; band.width = Math.round(bw * bd); band.height = Math.round(bh * bd); const g = (c) => { const q = bc.createLinearGradient(0, 0, 0, bh); q.addColorStop(0, rgbS(mixc(c, [255, 255, 255], 0.35), 1)); q.addColorStop(0.45, rgbS(c, 0.9)); q.addColorStop(1, rgbS(c, 0.06)); return q; }; gCool = g(cA); gWarm = g(cP); }
  function drawBand() {
    if (!bw || !gCool) return; let mean = 0; for (let k = 0; k < 51; k++) mean += base.amp[k] * RIPPLE[k]; mean /= 51;
    bc.setTransform(bd, 0, 0, bd, 0, 0); bc.clearRect(0, 0, bw, bh); const cw = bw / 51, wd = Math.max(3, Math.round(cw * 0.34)), H0 = bh * 0.58;
    for (let i = 0; i < 51; i++) {
      const k = order[i], b0 = Math.min(1.45, Math.max(0.3, (base.amp[k] * RIPPLE[k]) / mean)) * H0, v = (dev[k] / 100) * DRAWN, up = smooth(0.15 + i * 0.016, 0.9 + i * 0.016, st.T), hh = Math.max(3, Math.min(bh - 4, b0 * (1 + v) * up)), w = Math.min(1, Math.max(0, Math.abs(v) - 0.03) * 4.5) , x = Math.round((i + 0.5) * cw - wd / 2), y = bh - hh;
      peak[i] = Math.max(hh, peak[i] - 0.6);
      bc.globalAlpha = 0.10 * (1 - w); bc.fillStyle = sAc; bc.fillRect(x - 4, y - 3, wd + 8, hh + 3); bc.globalAlpha = 0.20 * w; bc.fillStyle = sPe; bc.fillRect(x - 4, y - 3, wd + 8, hh + 3);
      bc.globalAlpha = 1 - w; bc.fillStyle = gCool; bc.fillRect(x, y, wd, hh); bc.globalAlpha = w; bc.fillStyle = gWarm; bc.fillRect(x, y, wd, hh);
      bc.globalAlpha = 1 - w; bc.fillStyle = sCapC; bc.fillRect(x, y, wd, 2); bc.globalAlpha = w; bc.fillStyle = sCapW; bc.fillRect(x, y, wd, 2);
      bc.globalAlpha = 0.30; bc.fillStyle = sPe; if (peak[i] - hh > 3) bc.fillRect(x, bh - peak[i], wd, 1);
      bc.globalAlpha = 0.6; bc.fillStyle = sTick; bc.fillRect(x - 2, bh - b0, wd + 4, 1);
    }
    bc.globalAlpha = 1;
  }

  // ---------- the story ----------
  const WAY = [[78.4, 50.9], [77.7, 50.7], [76.45, 50.0], [77.7, 49.9], [76.7, 50.6]];
  const ENTER = 6.2; let captionKey = '', held = 0;
  const say = (k, t) => { if (captionKey === k) return; captionKey = k; cap.style.opacity = '0'; setTimeout(() => { cap.textContent = t; cap.style.opacity = '1'; }, captionKey && cap.textContent ? 220 : 0); };
  function restart() { st.T = 0; st.auto = true; st.person = WAY[0].slice(); st.on = 0; st.walk = 0; st.leg = 0; st.phase = 0; st.paused = false; st.tx = TX0.slice(0, 2); st.rx = RX0.slice(0, 2); st.dragTo = null; st.resetting = false; relink(); field.reset(); prefill(); fade = 1; captionKey = ''; }
  function prefill() { const on = st.on; st.on = 0; ringT.fill(0); for (let i = 0; i < KEEP * HZ; i++) packet(); st.on = on; score = shown = NaN; inferAt = 0; change = 0; dev.fill(0); peak.fill(0); }
  let fade = 1; const END = 33;
  function story(dt) {
    const T = st.T;
    if (st.auto) {
      if (T > ENTER) {
        st.on = Math.min(1, st.on + dt * 1.2);
        if (st.leg < WAY.length - 1) { const b = WAY[st.leg + 1], dx = b[0] - st.person[0], dy = b[1] - st.person[1], d = Math.hypot(dx, dy), v = 0.78; if (d < 0.02) st.leg = st.leg + 2 < WAY.length ? st.leg + 1 : 0; else { const s = Math.min(d, v * dt); st.person[0] += (dx / d) * s; st.person[1] += (dy / d) * s; const want = Math.atan2(dx, -dy); let e = want - st.heading; e = Math.atan2(Math.sin(e), Math.cos(e)); st.heading += e * (1 - Math.exp(-6 * dt)); st.walk += (1 - st.walk) * (1 - Math.exp(-6 * dt)); } } else st.walk *= Math.exp(-4 * dt);
      }
      const who = Number.isFinite(score) ? score : null;
      if (T < 2.2) say('a', 'The radio speaks.');
      else if (T < ENTER + 0.8) say('b', 'The wave goes through the wall.');
      else if (who !== null && who > thr && T > 14) say('d', 'The network hears the change.');
      else if (captionKey !== 'd') say('c', 'Someone moves. The wave comes back changed.');
      if (T > END) st.resetting = true;
    } else {
      if (st.dragTo) { const dx = st.dragTo[0] - st.person[0], dy = st.dragTo[1] - st.person[1], k = 1 - Math.exp(-10 * dt), v = Math.hypot(dx, dy) * k / Math.max(dt, 0.001); st.person[0] += dx * k; st.person[1] += dy * k; st.walk += (Math.min(1, v / 0.8) - st.walk) * (1 - Math.exp(-8 * dt)); } else st.walk *= Math.exp(-4 * dt);
      const home = Math.hypot(st.tx[0] - TX0[0], st.tx[1] - TX0[1]) + Math.hypot(st.rx[0] - RX0[0], st.rx[1] - RX0[1]) < 0.3;
      say(home ? 'f1' : 'f2', home ? 'Yours to move. The wave, the channel and the network follow.' : 'Radios moved: a new layout for the network.');
    }
    if (st.resetting) { fade = Math.max(0, fade - dt * 1.4); if (fade <= 0) { restart(); fade = 0; } } else fade = Math.min(1, fade + dt * 1.2);
    st.phase = (st.phase || 0) + st.walk * dt * 2 * Math.PI * 0.92;
  }
  // ---------- frame ----------
  let post = null, W = 0, HH = 0, pr = 1, ms = 16, slow = 0, time = 0, frames = 0, loaded = false, drift = 0, easeBack = 1; st.now = 0;
  function resize() {
    const w = Math.max(2, host.clientWidth), hh = Math.max(2, host.clientHeight); if (w === W && hh === HH) return;
    W = w; HH = hh; camera.aspect = w / hh; camera.setViewOffset(w, hh, w * 0.02, -hh * 0.112, w, hh); camera.updateProjectionMatrix(); setPr(); bandSize();
  }
  function setPr() { if (!post) return; renderer.setPixelRatio(1); renderer.setSize(Math.round(W * pr), Math.round(HH * pr), false); post.setSize(W, HH, pr); }
  pr = Math.min(1.5, window.devicePixelRatio || 1);
  const ro = new ResizeObserver(() => { resize(); if (!run.running) frame(0, 0); }); ro.observe(host);
  const v = new THREE.Vector3();
  function place(pn, x, y, z, a) { v.set(x, y, z).project(camera); const px = ((v.x + 1) / 2) * W, py = ((1 - v.y) / 2) * HH; pn.el.style.transform = 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0)'; if (Math.abs(a - pn.a) > 0.02) { pn.a = a; pn.el.style.opacity = a.toFixed(2); } }
  let lastTxt = 0;
  const put = (el, s) => { if (el.textContent !== s) el.textContent = s; };
  function frame(now, dt) {
    if (host.clientWidth < 2 || !loaded) return; resize(); frames++; time += dt; st.now = time;
    if (dt && loaded) { ms += (dt * 1000 - ms) * 0.05; if (ms > 21 && ++slow > 90 && pr > 0.8) { pr = Math.max(0.8, pr - 0.15); slow = 0; setPr(); } else if (ms < 18) slow = Math.max(0, slow - 1); }
    if (dt && !st.paused) {
      st.T += dt; story(dt);
      let n = Math.min(12, Math.floor((st.T * HZ + (st.off ??= 0)) - (st.sent || 0))); st.sent = st.sent > st.T * HZ + 5 ? st.T * HZ : st.sent || 0; n = Math.min(12, Math.max(0, Math.floor(st.T * HZ - st.sent))); st.sent += n; for (let i = 0; i < n; i++) packet();
      if (st.T > inferAt) { inferAt = st.T + 0.5; infer(); }
      field.step(STEPS, st.tx, st.on > 0.02 ? [st.person[0], st.person[1], st.on] : null); field.resolve();
      shared.uPh.value = (time * 5.2) % (2 * Math.PI); drawBand();
    }
    // camera: one slow push along the story, only while nobody is steering
    if (dt && !reduced()) { drift += dt; if (time > st.freeUntil && !st.drag) { easeBack = Math.min(1, easeBack + dt * 0.4); const k = smooth(0, END, st.auto ? st.T : END); pose(k, Math.sin(drift * 0.16) * 0.02); camera.position.lerp(goal, easeBack >= 1 ? 1 : 1 - Math.exp(-2.2 * dt * easeBack)); } else easeBack = 0; }
    controls.update(); machine.update(machineState, dt, time);
    fig.root.visible = st.on > 0.01; fig.uniforms.uA.value = st.on; fig.root.position.set(st.person[0], 0, -st.person[1]); fig.root.rotation.y = st.heading; fig.pose(st.walk, st.phase || 0, time);
    const rk = st.drag || hoverKey; ring.material.opacity += ((rk ? 0.8 : 0) - ring.material.opacity) * 0.2; if (rk) ring.position.set(st[rk][0], 0.03, -st[rk][1]);
    { const b = 0.5 + 0.5 * Math.sin(shared.uPh.value); halo.scale.setScalar(0.34 + 0.16 * b); halo.material.opacity = 0.35 + 0.45 * b; }
    if (st.on > 0.01 || st.drag || frames < 4) { renderer.shadowMap.needsUpdate = true; if (st.drag || frames < 4) lamp.shadow.needsUpdate = true; }
    renderer.toneMappingExposure = 1.0 * fade; post.render(time);
    place(pinTx, st.tx[0], 0.98, -st.tx[1], 1); place(pinRx, st.rx[0], 0.62, -st.rx[1], 1); place(pinP, st.person[0], 1.84, -st.person[1], st.on);
    if (time - lastTxt > 0.09 || !dt) { lastTxt = time; put(fNs, field.ns.toFixed(0)); put(fCh, change.toFixed(change < 1 ? 2 : 1)); if (Number.isFinite(score)) { shown = Number.isFinite(shown) ? shown + (score - shown) * 0.35 : score; put(fP, shown.toFixed(2)); const on = score > thr; if (figs.lastChild.dataset.on !== String(on)) figs.lastChild.dataset.on = String(on); put(fPcap, on ? 'network: person' : 'network: nobody'); } }
  }
  const run = lab.loop(frame);

  await slice(true); relink(); marks.push(['link', performance.now()]); await slice(true); restart(); marks.push(['packets', performance.now()]); await slice(true);
  // compile before the first draw, off the main thread where the browser can, so nothing stalls on a shader
  const { createPost } = await import('../../twin/post.js'); await slice(true);
  post = createPost(renderer, scene, camera, { quality: 'medium' }); post.sceneRT.samples = 4; post.bloom.strength = 0.42; post.bloom.radius = 0.62; post.bloom.threshold = 0.85; resize(); setPr(); marks.push(['post', performance.now()]); await slice(true);
  // waits until the graphics chip has caught up, without blocking the page
  const gl = renderer.getContext(), drained = async () => { const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); for (let i = 0; i < 600 && gl.getSyncParameter(s, gl.SYNC_STATUS) !== gl.SIGNALED; i++) await new Promise((r) => setTimeout(r, 4)); gl.deleteSync(s); t0 = performance.now(); };
  { const g = new THREE.PlaneGeometry(1, 1), jobs = [], draw = renderer.render; fig.root.visible = true;
    // a dry run of the passes: each draw call is noted instead of made, then every shader is compiled in parallel, a few at a time
    renderer.render = (s) => { jobs.push([s.isScene ? scene : s.material, renderer.getRenderTarget()]); };
    try { post.render(0); } finally { delete renderer.render; if (renderer.render !== draw) renderer.render = draw; renderer.setRenderTarget(null); }
    const waits = []; for (const m of field.materials) jobs.push([m, null]);
    for (const [m, rt] of jobs) { let s = scene; if (m !== scene) { s = new THREE.Scene(); s.add(new THREE.Mesh(g, m)); } renderer.setRenderTarget(rt); try { waits.push(renderer.compileAsync(s, camera).catch(() => {})); } catch { /* compiled on first draw instead */ } renderer.setRenderTarget(null); await slice(); }
    await Promise.all(waits); await drained(); marks.push(['compiled', performance.now()]);
    // first draws one object at a time: a driver builds each pipeline on its first draw
    const leaves = []; scene.traverse((o) => { if (o.isMesh || o.isSprite) { if (o.visible) { leaves.push(o); o.visible = false; } } }); const seen = new Set();
    renderer.shadowMap.needsUpdate = false;
    for (const o of leaves) { const key = o.material.uuid + (o.isInstancedMesh ? 'i' : ''); if (!seen.has(key)) { seen.add(key); o.visible = true; renderer.setRenderTarget(post.sceneRT); renderer.render(scene, camera); renderer.setRenderTarget(null); o.visible = false; await drained(); } }
    for (const o of leaves) o.visible = true;
    for (const l of [moon, lamp]) l.shadow.autoUpdate = false;
    for (const l of [moon, lamp]) { l.shadow.needsUpdate = true; renderer.shadowMap.needsUpdate = true; renderer.setRenderTarget(post.sceneRT); renderer.render(scene, camera); renderer.setRenderTarget(null); await drained(); }
    moon.shadow.autoUpdate = true;                                           // the lamp lights the radios only: redrawn when one is moved
    { const s = new THREE.Scene(), q = new THREE.Mesh(g, null), done = new Set(); q.frustumCulled = false; s.add(q); for (const [m, rt] of jobs) if (m !== scene && !done.has(m)) { done.add(m); q.material = m; renderer.setRenderTarget(rt); renderer.render(s, camera); renderer.setRenderTarget(null); await drained(); } }
    marks.push(['draws', performance.now()]);
    field.reset(); await drained(); field.step(1, st.tx, null); field.resolve(); await drained(); }
  marks.push(['shaders', performance.now()]); field.reset(); if (reduced()) { field.step(1500, st.tx, null); field.resolve(); }
  renderer.shadowMap.needsUpdate = true; await drained(); loaded = true; frame(0, 0); host.classList.add('live'); marks.push(['picture', performance.now()]);

  return {
    onShow() { resize(); run.start(); }, onHide() { run.stop(); },
    debug: { bounds() { const o = {}; for (const k of ['person', 'tx', 'rx']) { const p = st[k], top = k === 'person' ? 1.8 : k === 'tx' ? 0.9 : 0.6, hw = k === 'person' ? 0.32 : 0.25; let a = 9, b = -9, c = 9, d = -9; for (const y of [0, top]) for (const s of [-hw, hw]) { v.set(p[0] + s, y, -p[1]).project(camera); a = Math.min(a, (v.x + 1) / 2); b = Math.max(b, (v.x + 1) / 2); c = Math.min(c, (1 - v.y) / 2); d = Math.max(d, (1 - v.y) / 2); } o[k] = [a, b, c, d].map((x) => +x.toFixed(3)); } return o; }, marks, dev, st, field, camera, controls, renderer, scene, shared, post, lamp, set, get worst() { return worst; }, get score() { return score; }, get log() { return scoreLog; }, restart, frame, loop: run, get ms() { return ms; }, get pr() { return pr; }, moon },
  };
}
