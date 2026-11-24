// The Demo hero: building B at night, seen in radio.
//   the wave       fdtd.js, a live 2-D wave-equation solve at 2.437 GHz through the real walls, drawn as light
//   the person     a second solve without them runs beside it; the difference is what the body scattered (orange)
//   the channel    rf.js traced paths plus the body's echoes on the 51 subcarriers, 100 packets a second
//   the score      the real network, on the last ten seconds of those packets (nnworker.js, same code and weights)
// The building, furniture, rubble and rover are the twin's own builders (read only), lit by the field itself.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as U from '../../twin/util.js';
import * as rf from './rf.js';
import { createField } from './fdtd.js';
import { BODY, TX as TX0, RX as RX0, RIPPLE, buildBody, toWindow, normalise } from './person.js';
import { F0, DF, C0 } from './lab.js';

const RECT = [61.4, 41.4, 84.4, 58.6], HZ = 100, KEEP = 10.6, STEPS = 4, NS = 10;
const DK = (2 * Math.PI * DF) / C0, KC = (2 * Math.PI * F0) / C0, PARAM = { wall: 0.5, ref: 0.3 };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- the person: an articulated figure, the only warm thing in the frame ----------
function makeFigure(colPerson, colHot) {
  const uniforms = { uC: { value: colPerson }, uH: { value: colHot }, uA: { value: 1 }, uBreath: { value: 0 } };
  const vs = 'varying vec3 vN; varying vec3 vV; uniform float uBreath; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
  const solid = new THREE.ShaderMaterial({ uniforms, vertexShader: vs, transparent: true, fragmentShader: 'varying vec3 vN; varying vec3 vV; uniform vec3 uC, uH; uniform float uA; void main(){ vec3 n = normalize(vN), v = normalize(vV); float d = max(dot(n, v), 0.0); float rim = pow(1.0 - d, 2.6); float top = 0.5 + 0.5 * n.y; vec3 c = uC * (0.10 + 0.34 * d * top) + uC * rim * 1.5 + uH * pow(d, 5.0) * 0.16; gl_FragColor = vec4(c * uA, uA); }' });
  const ghost = new THREE.ShaderMaterial({ uniforms, vertexShader: vs, transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth, blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, fragmentShader: 'varying vec3 vN; varying vec3 vV; uniform vec3 uC; uniform float uA; void main(){ float d = max(dot(normalize(vN), normalize(vV)), 0.0); gl_FragColor = vec4(uC * (0.34 + 0.75 * pow(1.0 - d, 2.0)) * uA, 0.0); }' });
  const root = new THREE.Group(), meshes = [];
  const put = (parent, geo, x, y, z, sx = 1, sy = 1, sz = 1) => { for (const m of [solid, ghost]) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.renderOrder = m === ghost ? 6 : 1; parent.add(o); meshes.push(o); } };
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
      for (const [hp, kn, s] of legs) { hp.rotation.x = s * 0.52 * walk * Math.sin(phase); hp.rotation.z = s * 0.03; kn.rotation.x = walk * Math.max(0, 0.75 * Math.sin(phase * 1 + (s > 0 ? Math.PI : 0) + Math.PI + 0.9)) + 0.03; }
    },
  };
}

// The field as light, injected into every lit material of the scene: surfaces glow where the wave is, floors carry its
// crests, and standing walls turn to glass while it passes through them.
const FIELD_GLSL = `
uniform sampler2D uZ, uAmp; uniform vec4 uRect; uniform float uPh, uGain, uWarmG; uniform vec3 uCool, uCore, uWarm, uTxw;
float rfIn(vec2 u){ vec2 e = min(u, 1.0 - u) * uRect.zw; return smoothstep(0.5, 2.2, min(e.x, e.y)); }
float rfDb(float a, float ref, float span){ return clamp(1.0 + log(max(a, 1e-6) / ref) * 8.685889 / span, 0.0, 1.0); }
float rfTone(float a){ float t = rfDb(a, uGain, 40.0); return t * t; }
float rfWarm(float a){ float t = rfDb(a, uWarmG, 30.0); return t * t; }
`;
function patch(mat, shared, glass) {
  if (mat.userData.radioPatched) return; mat.userData.radioPatched = true;
  const prev = mat.onBeforeCompile, key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r); Object.assign(sh.uniforms, shared);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FIELD_GLSL).replace('#include <opaque_fragment>', `
      vec3 rw = transpose(mat3(viewMatrix)) * (-vViewPosition) + cameraPosition; vec2 ru = (vec2(rw.x, -rw.z) - uRect.xy) / uRect.zw;
      float rin = rfIn(ru); vec2 rA = textureLod(uAmp, ru, 4.0).xy; float rT = rfTone(rA.x) * rin, rD = rfWarm(rA.y) * rin;
      vec3 rAl = min(diffuseColor.rgb, vec3(0.42)); if (!(dot(outgoingLight, vec3(1.0)) >= 0.0)) outgoingLight = vec3(0.0);
      outgoingLight += rAl * (uCool * rT * 1.1 + uWarm * rD * 1.1) * (0.25 + 0.75 * exp(-max(rw.y, 0.0) * 0.55));
      if (rw.y < 0.05 && rin > 0.0) {
        vec4 rz = texture2D(uZ, ru); vec2 ra = texture2D(uAmp, ru).xy; vec2 rp = vec2(cos(uPh), sin(uPh));
        float cT = dot(rz.xy, rp), cD = dot(rz.zw, rp); float wet = 0.45 + 0.55 * (1.0 - roughnessFactor);
        outgoingLight += (uCool * rfTone(max(cT, 0.0)) * 1.1 + uWarm * rfWarm(max(cD, 0.0)) * 1.5) * rin * wet * 0.6;
      }
      ${glass ? 'float rg = smoothstep(0.10, 0.75, rT) * smoothstep(0.12, 0.5, rw.y); diffuseColor.a = 1.0 - 0.80 * rg; outgoingLight += uCool * rg * 0.05;' : ''}
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => key() + '|radio' + (glass ? 'g' : '');
  if (glass) mat.alphaToCoverage = true;
  mat.needsUpdate = true;
}

export async function createHero(host, ctx, lab) {
  const { h } = lab, world = ctx.world, kit = ctx.kit, reduced = () => kit.reducedMotion();
  const col = (name) => new THREE.Color(...lab.rgb(lab.tok(name)).map((v) => v / 255)).convertSRGBToLinear();

  // ---------- DOM ----------
  const canvas = h('canvas.radio-hero-canvas', { role: 'img', tabindex: '0', 'aria-label': 'Building B at night, with a Wi-Fi wave washing through the rooms and a person walking behind a wall. Drag the person or a radio. Space pauses, R replays.' });
  const pins = h('div.radio-hero-pins', { 'aria-hidden': 'true' });
  const band = h('canvas.radio-hero-band', { role: 'img', 'aria-label': 'Change on each of the 51 Wi-Fi subcarriers, live' });
  const cap = h('p.radio-hero-cap', { 'aria-live': 'polite' }, '');
  const fNs = h('b.num', null, '0'), fCh = h('b.num', null, '0.0'), fP = h('b.num', null, '–'), fPcap = h('span', null, 'network score');
  const replay = h('button.btn.btn-primary', { type: 'button', onclick: () => restart() }, lab.icon('reset', 14), 'Replay');
  const text = h('div.radio-hero-text', null,
    h('div.radio-hero-tags', null, Object.assign(kit.realityTag('live-algo'), { title: 'A 2-D wave equation at 2.437 GHz, solved live on this computer’s graphics chip through the real wall plan (assumed wall thickness). Crests are slowed again so the eye can follow them. The person is not slowed.' }), Object.assign(kit.realityTag('live-ai'), { title: 'The project’s trained Wi-Fi network, running here on packets synthesised in this page. A demonstration, not an evaluation.' }), h('span.tag.tag-sim', { title: 'The building, the person and every reading are simulated. HOUND has not recorded a real person with its Wi-Fi radios.' }, 'Simulated person')),
    h('h2', null, 'Radio walks through the wall'), cap, replay);
  const figs = h('div.radio-hero-figs', null,
    h('div', null, h('div', null, fNs, h('small', null, 'ns')), h('span', null, 'since the radio spoke')),
    h('div', null, h('div', null, fCh, h('small', null, '%')), h('span', null, 'change on the link')),
    h('div.radio-hero-score', null, h('div', null, fP), fPcap));
  host.append(canvas, pins, h('div.radio-hero-shade'), band, text, figs);
  const pin = (t, cls) => { const el = h('div.radio-hero-pin.' + cls, null, h('i'), h('span', null, t)); pins.append(el); return { el, p: new THREE.Vector3(), a: -1, x: -1, y: -1 }; };
  const pinTx = pin('Probe radio', 'tx'), pinRx = pin('HOUND-01', 'rx'), pinP = pin('Person', 'person');

  // ---------- renderer ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.autoClear = false;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene(); const night = new THREE.Color(0.0045, 0.0062, 0.0095); scene.background = night; scene.fog = new THREE.FogExp2(night, 0.021);
  const camera = new THREE.PerspectiveCamera(35, 1.8, 0.3, 300); camera.position.set(70.6, 8.6, -40.2);
  const controls = new OrbitControls(camera, canvas); controls.target.set(75.2, 0.5, -50.6); controls.enableDamping = true; controls.dampingFactor = 0.06; controls.minDistance = 4; controls.maxDistance = 34; controls.maxPolarAngle = 1.36; controls.minPolarAngle = 0.12; controls.zoomSpeed = 0.6; controls.enablePan = false;
  const { createPost } = await import('../../twin/post.js');
  const post = createPost(renderer, scene, camera, { quality: 'high' }); post.setAO(false);
  post.bloom.strength = 0.34; post.bloom.radius = 0.6; post.bloom.threshold = 0.9;

  // light: one cold moon from the north-east, a faint sky; the field does the rest
  const moon = new THREE.DirectionalLight(0xbcd0f2, 1.25); moon.position.set(96, 30, -78); moon.target.position.set(72, 0, -48); moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048); const sc = moon.shadow.camera; sc.left = -26; sc.right = 26; sc.top = 24; sc.bottom = -24; sc.near = 5; sc.far = 90; moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.03; scene.add(moon, moon.target);
  scene.add(new THREE.HemisphereLight(0x9fb0cc, 0x1d1e21, 0.36));
  const fill = new THREE.DirectionalLight(0xc9d4e6, 0.26); fill.position.set(60, 18, -20); fill.target.position.set(76, 0, -52); scene.add(fill, fill.target);
  { const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js'); const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(new RoomEnvironment(), 0.05); scene.environment = rt.texture; scene.environmentIntensity = 0.1; pm.dispose(); renderer.setRenderTarget(null); }

  // ---------- the field ----------
  const field = createField(renderer, world, { rect: RECT });
  const shared = { uZ: { value: field.tex[0] }, uAmp: { value: field.tex[1] }, uRect: { value: new THREE.Vector4(RECT[0], RECT[1], RECT[2] - RECT[0], RECT[3] - RECT[1]) }, uPh: { value: 0 }, uGain: { value: 0.46 }, uWarmG: { value: 0.14 }, uCool: { value: new THREE.Color(0.22, 0.56, 1.0) }, uCore: { value: new THREE.Color(0.75, 0.88, 1) }, uWarm: { value: col('--person') }, uTxw: { value: new THREE.Vector3() } };
  // the wave in the air: thin sheets of light at ten heights; the crests are drawn as domes round the transmitter
  const sheetGeo = new THREE.InstancedBufferGeometry(); { const p = new THREE.PlaneGeometry(RECT[2] - RECT[0], RECT[3] - RECT[1]).rotateX(-Math.PI / 2); sheetGeo.index = p.index; sheetGeo.setAttribute('position', p.attributes.position); const z = new Float32Array(NS); for (let i = 0; i < NS; i++) z[i] = 0.1 + i * 0.17; sheetGeo.setAttribute('aH', new THREE.InstancedBufferAttribute(z, 1)); sheetGeo.instanceCount = NS; }
  const sheetMat = new THREE.ShaderMaterial({ uniforms: { ...shared, uK: { value: 2 * Math.PI * F0 / C0 }, uTxh: { value: TX0[2] }, uN: { value: NS } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'attribute float aH; varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); w.y += aH; vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: FIELD_GLSL + `varying vec3 vW; uniform float uK, uTxh;
      void main(){ vec2 u = (vec2(vW.x, -vW.z) - uRect.xy) / uRect.zw; float rin = rfIn(u); if (rin <= 0.0) discard;
        vec4 z = texture2D(uZ, u); vec2 a = texture2D(uAmp, u).xy; vec2 am = textureLod(uAmp, u, 2.5).xy;
        float dz = vW.y - uTxh, r = length(vec2(vW.x - uTxw.x, vW.z - uTxw.z)), ex = uK * (sqrt(r * r + dz * dz) - r); ex = min(ex, 14.0);
        vec2 p = vec2(cos(uPh - ex), sin(uPh - ex)), p0 = vec2(cos(uPh), sin(uPh));
        float cT = max(dot(z.xy, p), 0.0), cD = max(dot(z.zw, p0), 0.0);
        float hg = exp(-dz * dz * 0.62) ; float near = smoothstep(0.1, 1.5, r);
        float sT = rfTone(am.x) * 0.16 + pow(rfTone(cT), 1.7) * 0.84, sD = rfWarm(am.y) * 0.14 + pow(rfWarm(cD), 1.3);
        vec3 c = mix(uCool, uCore, 0.55 * smoothstep(0.55, 1.0, sT)) * sT * mix(0.35, 1.0, near) + uWarm * sD * 1.25;
        gl_FragColor = vec4(c * hg * rin * 0.19, 1.0); }` });
  const sheets = new THREE.Mesh(sheetGeo, sheetMat); sheets.position.set((RECT[0] + RECT[2]) / 2, 0, -(RECT[1] + RECT[3]) / 2); sheets.frustumCulled = false; sheets.renderOrder = 5; scene.add(sheets);

  // ---------- stand-in building until the real one is ready, so the wave is on screen at once ----------
  const standIn = new THREE.Group(); scene.add(standIn);
  { const m = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.9 }); patch(m, shared, true);
    for (const w of world.WALLS) { if (w.state === 'collapsed') continue; const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], g = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(dx, dy), w.h, rf.MATERIALS[w.mat]?.thick || 0.1), m); g.position.set((w.a[0] + w.b[0]) / 2, w.h / 2, -(w.a[1] + w.b[1]) / 2); g.rotation.y = Math.atan2(dy, dx); standIn.add(g); }
    const f = new THREE.Mesh(new THREE.PlaneGeometry(40, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.55 })); patch(f.material, shared, false); f.position.set(64, 0.005, -44); standIn.add(f); }

  // ---------- radios and person ----------
  const fig = makeFigure(col('--person'), new THREE.Color(1, 0.86, 0.66)); scene.add(fig.root); fig.root.visible = false;
  const probe = new THREE.Group(); scene.add(probe);
  { const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.4 }), shell = new THREE.MeshStandardMaterial({ color: 0xd5d9dd, roughness: 0.45 }), al = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.35, metalness: 0.9 });
    const add = (g, m, x, y, z, rx = 0, rz = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); o.castShadow = true; probe.add(o); return o; };
    for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.283 + 0.4, l = add(new THREE.CylinderGeometry(0.008, 0.011, 0.74, 10), dark, Math.cos(a) * 0.14, 0.33, Math.sin(a) * 0.14); l.rotation.set(Math.sin(a) * -0.39, 0, Math.cos(a) * 0.39); }
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 16), al, 0, 0.66, 0); add(new THREE.BoxGeometry(0.13, 0.07, 0.085), shell, 0, 0.74, 0); add(new THREE.BoxGeometry(0.134, 0.012, 0.089), dark, 0, 0.74, 0); add(new THREE.CylinderGeometry(0.006, 0.007, 0.12, 12), dark, 0.045, 0.83, 0); add(new THREE.CylinderGeometry(0.006, 0.007, 0.12, 12), dark, -0.045, 0.83, 0);
    const led = add(new THREE.SphereGeometry(0.007, 10, 8), new THREE.MeshBasicMaterial({ color: col('--accent').multiplyScalar(4) }), 0.04, 0.752, 0.044); led.castShadow = false; }
  let rover = null; const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.25, envMapIntensity: 4 }), lamp = new THREE.MeshBasicMaterial({ color: col('--ok') });
  const roverState = { units: { 'HOUND-01': { pos: RX0.slice(0, 2), heading: 0, mode: 'sensing', odo: 0, battery: 1 } }, faults: {}, hold: false, phase: 'search' };

  // ---------- handles you can drag ----------
  const st = { tx: TX0.slice(0, 2), rx: RX0.slice(0, 2), person: [82.4, 48.2], on: 0, walk: 0, heading: Math.PI, auto: true, paused: false, T: 0, freeUntil: 0, drag: null };
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
    shared.uTxw.value.set(st.tx[0], 0, -st.tx[1]); probe.position.set(st.tx[0], 0, -st.tx[1]); roverState.units['HOUND-01'].pos = st.rx.slice();
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
    let e = 0; for (let k = 0; k < 51; k++) { const d = Math.hypot(H.re[k], H.im[k]) / base.amp[k] - 1; dev[k] += (100 * d - dev[k]) * 0.35; e += Math.hypot(H.re[k] - base.re[k], H.im[k] - base.im[k]) / base.amp[k]; } change += ((100 * e) / 51 - change) * 0.06;
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

  // ---------- the subcarrier band: every column one subcarrier, the last two seconds rising behind it ----------
  const bc = band.getContext('2d'), HIST = 72, hist = new Float32Array(HIST * 51); let histAt = 0, bw = 0, bh = 0, bd = 1; const order = Array.from({ length: 51 }, (_, i) => i).sort((a, b) => rowSub(a) - rowSub(b)); function rowSub(k) { return k < 25 ? k + 2 : k - 51; }
  const tile = document.createElement('canvas'); tile.width = 51; tile.height = HIST; const tc = tile.getContext('2d'), timg = tc.createImageData(51, HIST);
  const cP = lab.rgb(lab.tok('--person')), cA = lab.rgb(lab.tok('--accent')); let scale = 1;
  function drawBand() {
    if (!bw) return; let mx = 0.4; for (let k = 0; k < 51; k++) mx = Math.max(mx, Math.abs(dev[k])); scale += (Math.max(mx * 1.15, 1) - scale) * (mx * 1.15 > scale ? 0.2 : 0.01);
    histAt = (histAt + 1) % HIST; for (let i = 0; i < 51; i++) hist[histAt * 51 + i] = dev[order[i]];
    for (let r = 0; r < HIST; r++) { const src = ((histAt - (HIST - 1 - r)) % HIST + HIST) % HIST, age = r / (HIST - 1); for (let i = 0; i < 51; i++) { const v = hist[src * 51 + i] / scale, m = Math.min(1, Math.abs(v)), w = Math.min(1, m * 1.5), o = (r * 51 + i) * 4; timg.data[o] = cA[0] + (cP[0] - cA[0]) * w; timg.data[o + 1] = cA[1] + (cP[1] - cA[1]) * w; timg.data[o + 2] = cA[2] + (cP[2] - cA[2]) * w; timg.data[o + 3] = 255 * age * age * (0.05 + 0.75 * m); } }
    tc.putImageData(timg, 0, 0);
    bc.setTransform(bd, 0, 0, bd, 0, 0); bc.clearRect(0, 0, bw, bh); bc.imageSmoothingEnabled = false; const mid = bh - 34, cw = bw / 51; bc.globalAlpha = 0.9; bc.drawImage(tile, 0, 0, bw, mid); bc.globalAlpha = 1;
    bc.globalCompositeOperation = 'destination-out'; for (let i = 0; i <= 51; i++) bc.fillRect(Math.round(i * cw) - 2, 0, 4, mid); bc.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 51; i++) { const v = dev[order[i]] / scale, m = Math.min(1, Math.abs(v)), w = Math.min(1, m * 1.5), x = Math.round(i * cw) + 2, wd = Math.round((i + 1) * cw) - 2 - x; bc.fillStyle = 'rgb(' + Math.round(cA[0] + (cP[0] - cA[0]) * w) + ',' + Math.round(cA[1] + (cP[1] - cA[1]) * w) + ',' + Math.round(cA[2] + (cP[2] - cA[2]) * w) + ')'; const hh = Math.max(1.5, m * 24); bc.fillRect(x, v > 0 ? mid - 0 + 0 : mid, wd, 1.5); bc.globalAlpha = 0.95; bc.fillRect(x, mid + 3, wd, hh); bc.globalAlpha = 1; }
  }

  // ---------- the story ----------
  const WAY = [[82.4, 48.2], [79.2, 49.4], [76.5, 51.3], [77.6, 50.5], [76.25, 51.1]];
  const ENTER = 8.5; let captionKey = '', held = 0;
  const loss = { dry: rf.wallLossDb('drywall', 1), con: rf.wallLossDb('concrete', 1) };
  const say = (k, t) => { if (captionKey === k) return; captionKey = k; cap.style.opacity = '0'; setTimeout(() => { cap.textContent = t; cap.style.opacity = '1'; }, captionKey && cap.textContent ? 220 : 0); };
  function restart() { st.T = 0; st.auto = true; st.person = WAY[0].slice(); st.on = 0; st.walk = 0; st.leg = 0; st.phase = 0; st.paused = false; st.tx = TX0.slice(0, 2); st.rx = RX0.slice(0, 2); st.dragTo = null; st.resetting = false; relink(); field.reset(); scale = 1; prefill(); fade = 1; captionKey = ''; }
  function prefill() { const on = st.on; st.on = 0; ringT.fill(0); for (let i = 0; i < KEEP * HZ; i++) packet(); st.on = on; score = shown = NaN; inferAt = 0; change = 0; dev.fill(0); hist.fill(0); }
  let fade = 1; const END = 33, marks = [['start', performance.now()]];
  function story(dt) {
    const T = st.T;
    if (st.auto) {
      if (T > ENTER) {
        st.on = Math.min(1, st.on + dt * 1.2);
        if (st.leg < WAY.length - 1) { const b = WAY[st.leg + 1], dx = b[0] - st.person[0], dy = b[1] - st.person[1], d = Math.hypot(dx, dy), v = 0.78; if (d < 0.02) st.leg++; else { const s = Math.min(d, v * dt); st.person[0] += (dx / d) * s; st.person[1] += (dy / d) * s; const want = Math.atan2(dx, -dy); let e = want - st.heading; e = Math.atan2(Math.sin(e), Math.cos(e)); st.heading += e * (1 - Math.exp(-6 * dt)); st.walk += (1 - st.walk) * (1 - Math.exp(-6 * dt)); } } else st.walk *= Math.exp(-4 * dt);
      }
      const who = Number.isFinite(score) ? score : null;
      if (T < 2.6) say('a', 'The probe radio speaks. Its wave is slowed ' + slowText() + ' times.');
      else if (T < ENTER) say('b', 'A partition takes ' + loss.dry.toFixed(1) + ' dB. Concrete takes ' + loss.con.toFixed(1) + '. The rest goes on.');
      else if (T < 16) say('c', 'Someone moves behind the wall. Orange is the energy their body throws back.');
      else if (st.leg < WAY.length - 1) say('d', 'Fifty-one subcarriers bend with every step.');
      else if (who !== null) say(who > thr ? 'e1' : 'e0', who > thr ? 'HOUND’s network reads ten seconds of it: person.' : 'HOUND’s network is not sure. That happens too.');
      if (T > END) st.resetting = true;
    } else {
      if (st.dragTo) { const dx = st.dragTo[0] - st.person[0], dy = st.dragTo[1] - st.person[1], k = 1 - Math.exp(-10 * dt), v = Math.hypot(dx, dy) * k / Math.max(dt, 0.001); st.person[0] += dx * k; st.person[1] += dy * k; st.walk += (Math.min(1, v / 0.8) - st.walk) * (1 - Math.exp(-8 * dt)); } else st.walk *= Math.exp(-4 * dt);
      const home = Math.hypot(st.tx[0] - TX0[0], st.tx[1] - TX0[1]) + Math.hypot(st.rx[0] - RX0[0], st.rx[1] - RX0[1]) < 0.3;
      say(home ? 'f1' : 'f2', home ? 'Yours to move. The wave, the channel and the network follow.' : 'Radios moved: the network was never trained on this layout.');
    }
    if (st.resetting) { fade = Math.max(0, fade - dt * 1.4); if (fade <= 0) { restart(); fade = 0; } } else fade = Math.min(1, fade + dt * 1.2);
    st.phase = (st.phase || 0) + st.walk * dt * 2 * Math.PI * 0.92;
  }
  const perFrame = () => STEPS * field.dt;                                   // seconds of wave per frame
  const slowText = () => { const s = (1 / 60) / perFrame(); return Math.round(s / 1e6 / 10) * 10 + ' million'; };

  // ---------- frame ----------
  let W = 0, HH = 0, pr = 1, ms = 16, slow = 0, time = 0, frames = 0, loaded = false, drift = 0; st.now = 0;
  function resize() {
    const w = Math.max(2, host.clientWidth), hh = Math.max(2, host.clientHeight); if (w === W && hh === HH) return;
    W = w; HH = hh; camera.aspect = w / hh; camera.setViewOffset(w, hh, -w * 0.06, h2(hh), w, hh); camera.updateProjectionMatrix(); setPr();
    bd = Math.min(2, window.devicePixelRatio || 1); bw = band.clientWidth; bh = band.clientHeight; band.width = Math.round(bw * bd); band.height = Math.round(bh * bd);
  }
  const h2 = (hh) => hh * 0.055;
  function setPr() { renderer.setPixelRatio(1); renderer.setSize(Math.round(W * pr), Math.round(HH * pr), false); post.setSize(W, HH, pr); }
  pr = Math.min(1.5, window.devicePixelRatio || 1);
  const ro = new ResizeObserver(() => { resize(); if (!run.running) frame(0, 0); }); ro.observe(host);
  const v = new THREE.Vector3();
  function place(pn, x, y, z, a) { v.set(x, y, z).project(camera); const px = ((v.x + 1) / 2) * W, py = ((1 - v.y) / 2) * HH; pn.el.style.transform = 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0)'; if (Math.abs(a - pn.a) > 0.02) { pn.a = a; pn.el.style.opacity = a.toFixed(2); } }
  let lastTxt = 0;
  const set = (el, s) => { if (el.textContent !== s) el.textContent = s; };
  function frame(now, dt) {
    if (host.clientWidth < 2) return; resize(); frames++; time += dt; st.now = time;
    if (dt && loaded) { ms += (dt * 1000 - ms) * 0.05; if (ms > 21 && ++slow > 90 && pr > 0.8) { pr = Math.max(0.8, pr - 0.15); slow = 0; setPr(); } else if (ms < 18) slow = Math.max(0, slow - 1); }
    if (dt && !st.paused) {
      st.T += dt; story(dt);
      let n = Math.min(12, Math.floor((st.T * HZ + (st.off ??= 0)) - (st.sent || 0))); st.sent = st.sent > st.T * HZ + 5 ? st.T * HZ : st.sent || 0; n = Math.min(12, Math.max(0, Math.floor(st.T * HZ - st.sent))); st.sent += n; for (let i = 0; i < n; i++) packet();
      if (st.T > inferAt) { inferAt = st.T + 0.5; infer(); }
      field.step(STEPS, st.tx, st.on > 0.02 ? [st.person[0], st.person[1], st.on] : null); field.resolve();
      shared.uPh.value = (time * 5.2) % (2 * Math.PI); drawBand();
    }
    // camera: one slow drift, only while nobody is steering
    if (dt && !reduced() && time > st.freeUntil && !st.drag) { drift += dt; const a = Math.sin(drift * 0.11) * 0.00042, ca = Math.cos(a), sa = Math.sin(a), dx = camera.position.x - controls.target.x, dz = camera.position.z - controls.target.z; camera.position.x = controls.target.x + dx * ca - dz * sa; camera.position.z = controls.target.z + dx * sa + dz * ca; }
    controls.update();
    fig.root.visible = st.on > 0.01; fig.uniforms.uA.value = st.on; fig.root.position.set(st.person[0], 0, -st.person[1]); fig.root.rotation.y = st.heading; fig.pose(st.walk, st.phase || 0, time);
    if (rover) { const u = roverState.units['HOUND-01']; u.pos[0] = st.rx[0]; u.pos[1] = st.rx[1]; try { rover.update(roverState, Math.max(dt, 0.001), time); } catch (e) { rover = null; console.warn('[radio] rover', e); } }
    const rk = st.drag || hoverKey; ring.material.opacity += ((rk ? 0.8 : 0) - ring.material.opacity) * 0.2; if (rk) ring.position.set(st[rk][0], 0.03, -st[rk][1]);
    renderer.toneMappingExposure = 1.0 * fade; post.render(time);
    place(pinTx, st.tx[0], 0.95, -st.tx[1], 0.9); place(pinRx, st.rx[0], 0.75, -st.rx[1], 0.9); place(pinP, st.person[0], 1.86, -st.person[1], st.on);
    if (time - lastTxt > 0.09 || !dt) { lastTxt = time; set(fNs, field.ns.toFixed(0)); set(fCh, change.toFixed(change < 1 ? 2 : 1)); if (Number.isFinite(score)) { shown = Number.isFinite(shown) ? shown + (score - shown) * 0.35 : score; set(fP, shown.toFixed(2)); const on = score > thr; if (figs.lastChild.dataset.on !== String(on)) figs.lastChild.dataset.on = String(on); set(fPcap, on ? 'network: person' : 'network: nobody'); } }
  }
  const run = lab.loop(frame);

  relink(); field.reset(); restart(); renderer.shadowMap.needsUpdate = true;
  if (reduced()) { field.step(1500, st.tx, null); }

  // ---------- the real building, a piece at a time ----------
  (async () => {
    const next = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    try {
      await next(); const [{ createTextures }, { createMaterials }] = await Promise.all([import('../../twin/textures.js'), import('../../twin/materials.js')]);
      const tex = createTextures(world, Math.min(16, renderer.capabilities.getMaxAnisotropy())); await next(); const mats = createMaterials(tex); marks.push(['mats', performance.now()]); await next();
      const stub = new Proxy(function () {}, { get: (o, k) => (k === 'then' ? undefined : stub), apply: () => stub, set: () => true });
      const t = { THREE, scene, camera, renderer, ctx, world, quality: 'high', v3: U.v3, groundY: 0, reduced: reduced(), pickable: (o) => o, unpickable() {}, label: () => stub, glow: (o) => o, addUpdate: () => () => {}, heightAt: () => 0 };
      const env = { ...t, t, tex, mats, U, rng: U.rng, environment: { heightAt: () => 0 }, layer: (id) => id !== 'roof' && id !== 'walls-xray' };
      const real = new THREE.Group(); const groups = [];
      for (const id of ['building', 'rubble', 'interior']) { const before = new Set(scene.children); const mod = await import('../../twin/' + id + '.js'); await next(); const p = mod.build(env); p?.setLayer?.('roof', false); p?.setLayer?.('labels', false); marks.push([id, performance.now()]); if (p?.group) { p.group.visible = false; if (!p.group.parent) scene.add(p.group); groups.push(p); } for (const o of scene.children) if (!before.has(o) && o !== p?.group) o.visible = false, groups.push({ group: o }); for (let i = 0; i < 3; i++) p?.update?.(1, 1, { phase: 'search', units: {} }, { pose: { dist: 20 } }); await next(); }
      const gmat = mats.mud.clone(); gmat.color.set(0x23262a); gmat.roughness = 0.7; const gg = new THREE.Mesh(U.worldUV(new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2), 0.4), gmat); gg.position.set(64, -0.03, -44); gg.receiveShadow = true; gg.visible = false; scene.add(gg); groups.push({ group: gg });
      try { const mod = await import('../../twin/actors/rover.js'), had = new Set(scene.children); rover = mod.default.create(t); for (const o of [...scene.children]) if (!had.has(o) && o.name !== 'HOUND-01') scene.remove(o); rover.update(roverState, 0.016, 0); scene.traverse((o) => { if (o.name !== 'HOUND-01') return; const off = []; o.traverse((m) => { if (m.isLight || m.isPoints || m.material?.isShaderMaterial) off.push(m); }); for (const m of off) m.parent.remove(m); /* headlights stay off: this is radio light only */ o.traverse((m) => { const n = m.geometry?.attributes?.normal; if (n) { for (let i = 0; i < n.count; i++) { const x = n.getX(i), y = n.getY(i), z = n.getZ(i); if (!(x * x + y * y + z * z > 0.01)) n.setXYZ(i, 0, 1, 0); } n.needsUpdate = true; } if (m.isMesh) { m.material = m.geometry.attributes.color ? body : m.material.isMeshBasicMaterial ? lamp : m.material; if (m.material === body || m.material === lamp) m.castShadow = true; else if (m.material.isMeshStandardMaterial) patch(m.material, shared, false); } }); }); patch(body, shared, false); } catch (e) { rover = null; console.warn('[radio] rover model left out', e); }
      const glass = new Set([mats.inner, mats.plaster, mats.cut, mats.concrete, mats.paint, mats.wood].slice(0, 4));
      for (const g of groups) g.group.traverse((o) => { for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) if (m.isMeshStandardMaterial) patch(m, shared, glass.has(m)); });
      probe.traverse((o) => { if (o.material?.isMeshStandardMaterial) patch(o.material, shared, false); });
      for (const g of groups) { g.group.visible = true; } 
      try { await renderer.compileAsync(scene, camera); } catch { /* compiled on first draw instead */ }
      marks.push(['real', performance.now()]); standIn.visible = false; renderer.shadowMap.needsUpdate = true; loaded = true; if (!run.running) frame(0, 0);
    } catch (e) { console.error('[radio] the detailed building could not be built; the plain one stays', e); loaded = true; }
  })();

  return {
    onShow() { resize(); run.start(); }, onHide() { run.stop(); },
    debug: { marks, st, field, camera, controls, renderer, scene, shared, sheetMat, post, get score() { return score; }, get log() { return scoreLog; }, restart, frame, loop: run, get ms() { return ms; }, get pr() { return pr; }, moon },
  };
}
