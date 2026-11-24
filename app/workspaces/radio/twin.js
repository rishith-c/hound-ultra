// Exhibit 01. The radio digital twin: a ray tracer for 2.4 GHz Wi-Fi in building B, drawn in 3-D.
// Numbers (paths, channel, delay profile, field) come from rf.js; the launched rays are the same physics, for the eye.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import * as rf from './rf.js';
import { SUB, F0, DF, LAMBDA, C0 } from './lab.js';

export const meta = {
  title: 'The radio digital twin',
  labels: ['live-algo', { text: 'Planning tool: concept', cls: 'tag-sim', title: 'HOUND Command does not plan with a ray tracer today. This exhibit shows what one would give it.' }],
  labelNote: 'The tracer runs here, now. The building is the simulated exercise; no radio measurement was taken.',
  plain: [
    'A Wi-Fi packet reaches the receiver along many paths at once: straight through walls, bounced off them, bent round door frames. This exhibit traces those paths through building B, so you can see where a signal will reach before the rover drives there.',
    'Drag the two radios. The paths, the field on the floor and the channel on the receiver’s 51 subcarriers are traced again as you move.',
  ],
  cites: [
    { by: 'Hoydis et al. (NVIDIA)', year: 2023, title: 'Sionna RT: differentiable ray tracing for radio propagation modeling', venue: 'arXiv 2303.11103', url: 'https://arxiv.org/abs/2303.11103' },
    { by: 'Aït Aoudia et al. (NVIDIA)', year: 2025, title: 'Sionna RT: technical report (shooting-and-bouncing rays with the image method)', venue: 'arXiv 2504.21719', url: 'https://arxiv.org/abs/2504.21719' },
    { by: 'ITU-R P.2040-4', year: 2025, title: 'Effects of building materials and structures on radio-wave propagation: the wall permittivities used here', url: 'https://www.itu.int/rec/R-REC-P.2040-4-202509-I/en' },
    { by: 'ITU-R P.526-16', year: 2025, title: 'Propagation by diffraction: the knife-edge formula used at door frames', url: 'https://www.itu.int/rec/R-REC-P.526-16-202511-I/en' },
  ],
  honest: 'The twin is only as good as its map: wall positions to a few centimetres and the real material of every wall. Differentiable tracers such as Sionna RT can fit materials to measurements, but someone has to take those measurements in a flooded building first.',
  unknown: 'how well a plan-view tracer with uniform walls predicts the channel in wet rubble. Nothing here has been compared with a real radio.',
};

const FIELD = { x0: 40, y0: 26, x1: 88, y1: 62, res: 0.3 };               // metres; the floor area that gets a field
const DB_LO = -104, DB_HI = -30;                                           // path gain range of the floor ramp
const TX_H = 0.8, RX_H = 0.45;                                             // antenna heights from the rover project (ml/geometry.py)
const TX_DBM = 20;                                                         // assumed transmit power

export async function create(stage, side, ctx, lab) {
  const { h, icon } = lab, world = ctx.world;
  const scene2 = rf.buildScene(world);
  const st = { tx: [70.6, 46.9], rx: world.STOPS[3].pos.slice(), order: 3, diffraction: true, show: { rays: true, field: true, paths: true }, follow: false, rayCount: 3200 };
  let paths = [], stats = null, H = null, trunc = null, fringeImg = null, hoverPath = -1, front = 0, hold = 0, dragging = null;

  // ---------- layout ----------
  const view = h('div.radio-twin-view.crop'), labels = h('div.radio-twin-labels', { 'aria-hidden': 'true' });
  const hudClock = h('div.radio-twin-clock.glass', null, h('span', null, 'Wavefront'), h('b.num', null, '0.0 ns'), h('i.num', null, '0.00 m from the transmitter'));
  const probe = h('div.radio-twin-probe.glass', { hidden: true });
  const camSeg = lab.seg([['orbit', 'Orbit'], ['top', 'Plan'], ['low', 'Inside']], 'orbit', (v) => setCamera(v), { label: 'Camera' });
  const legend = h('div.radio-twin-legend.glass', null, h('span', null, 'Path gain on the floor'), h('div.radio-twin-ramp'), h('div.radio-twin-ramp-ticks.num', null, ...[-100, -80, -60, -40].map((v) => h('i', { style: { left: ((v - DB_LO) / (DB_HI - DB_LO)) * 100 + '%' } }, v))), h('span.dim', null, 'dB, sum of path powers, contours every 10 dB'));
  view.append(labels, hudClock, h('div.radio-twin-cam.glass', null, camSeg), legend, probe,
    h('div.radio-twin-hint', null, 'Drag the transmitter or the receiver. Drag elsewhere to orbit, scroll to zoom.'));
  const figH = lab.figure('Multipath carves the channel differently on every subcarrier', { caption: 'Channel 6, 2437 MHz. The 51 subcarriers HOUND records, 312.5 kHz apart.' });
  const figP = lab.figure('Each path arrives at its own nanosecond', { caption: 'Impulse response from the traced paths. It fills in as the wavefront above arrives.' });
  const figF = lab.figure('Standing waves at the receiver');
  const strip = h('div.radio-twin-strip', null, figH, figP, figF);
  stage.append(view, strip);

  // ---------- three.js ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'radio-twin-canvas'; renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', '3-D view of building B with traced radio rays between the transmitter and the receiver');
  view.prepend(renderer.domElement);
  const col = (name) => new THREE.Color(...lab.rgb(lab.tok(name)).map((v) => v / 255)).convertSRGBToLinear();
  const scene = new THREE.Scene(); scene.background = col('--bg-0'); scene.fog = new THREE.Fog(scene.background, 70, 170);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 4; controls.maxDistance = 110;
  controls.autoRotateSpeed = 0.22; controls.zoomSpeed = 0.7;
  const v3 = (p, y = 0) => new THREE.Vector3(p[0], y, -p[1]);
  const CAMS = { orbit: { pos: [89, 27, -9], tgt: [65, 0, -43] }, top: { pos: [64, 62, -43.2], tgt: [64, 0, -44] }, low: { pos: [st.rx[0] - 9, 2.4, -(st.rx[1] - 9.5)], tgt: [st.rx[0], 0.8, -st.rx[1]] } };
  let camGoal = null;
  function setCamera(name, instant) {
    const c = name === 'low' ? { pos: [st.rx[0] - 8, 2.6, -(st.rx[1] - 10)], tgt: [st.rx[0], 0.6, -st.rx[1]] } : CAMS[name];
    camGoal = { pos: new THREE.Vector3(...c.pos), tgt: new THREE.Vector3(...c.tgt), t: 0 };
    if (instant || lab.reducedMotion()) { camera.position.copy(camGoal.pos); controls.target.copy(camGoal.tgt); camGoal = null; controls.update(); }
    idleAt = performance.now();
  }
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x0a0c10, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(40, 60, 20); scene.add(sun);

  // ground and grid
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: col('--bg-0') }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(64, -0.03, -44); scene.add(ground);
  const grid1 = new THREE.GridHelper(200, 200, col('--line'), col('--line')); grid1.position.set(60, -0.02, -40); grid1.material.transparent = true; grid1.material.opacity = 0.35; scene.add(grid1);
  const grid5 = new THREE.GridHelper(200, 40, col('--line-2'), col('--line-2')); grid5.position.set(60, -0.015, -40); grid5.material.transparent = true; grid5.material.opacity = 0.5; scene.add(grid5);

  // the field on the floor: path gain in dB in an 8-bit texture, coloured and contoured in the shader
  const gw = Math.round((FIELD.x1 - FIELD.x0) / FIELD.res), gh = Math.round((FIELD.y1 - FIELD.y0) / FIELD.res);
  const fieldDb = new Float32Array(gw * gh).fill(DB_LO), fieldTex8 = new Uint8Array(gw * gh);
  const fieldTex = new THREE.DataTexture(fieldTex8, gw, gh, THREE.RedFormat, THREE.UnsignedByteType); fieldTex.magFilter = fieldTex.minFilter = THREE.LinearFilter;
  const lutData = new Uint8Array(256 * 4); { const l = lab.rampLut(); for (let i = 0; i < 256; i++) lutData.set([l[i * 3], l[i * 3 + 1], l[i * 3 + 2], 255], i * 4); }
  const lutTex = new THREE.DataTexture(lutData, 256, 1, THREE.RGBAFormat); lutTex.magFilter = lutTex.minFilter = THREE.LinearFilter; lutTex.needsUpdate = true; lutTex.colorSpace = THREE.SRGBColorSpace;
  const fieldMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: fieldTex }, uLut: { value: lutTex }, uLo: { value: DB_LO }, uHi: { value: DB_HI }, uOpacity: { value: 0.72 } }, transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform sampler2D uMap; uniform sampler2D uLut; uniform float uLo; uniform float uHi; uniform float uOpacity; varying vec2 vUv;',
      'void main(){ float t = texture2D(uMap, vUv).r; float dbv = mix(uLo, uHi, t);',
      '  vec3 c = texture2D(uLut, vec2(clamp(t, 0.004, 0.996), 0.5)).rgb;',
      '  float f = dbv / 10.0; float w = fwidth(f); float line = 1.0 - smoothstep(0.0, 1.5 * w, abs(fract(f + 0.5) - 0.5));',
      '  c = mix(c, c * 1.9 + 0.06, line * 0.55);',
      '  vec2 e = min(vUv, 1.0 - vUv); float edge = smoothstep(0.0, 0.03, min(e.x, e.y));',
      '  gl_FragColor = vec4(c, uOpacity * edge * (0.35 + 0.65 * smoothstep(0.0, 0.25, t))); }'].join('\n'),
  });
  const fieldMesh = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.x1 - FIELD.x0, FIELD.y1 - FIELD.y0), fieldMat);
  fieldMesh.rotation.x = -Math.PI / 2; fieldMesh.position.set((FIELD.x0 + FIELD.x1) / 2, 0.01, -(FIELD.y0 + FIELD.y1) / 2); scene.add(fieldMesh);

  // walls: slabs you can see through, with a lit top edge
  const wallMats = {
    concrete: new THREE.MeshStandardMaterial({ color: col('--text-3'), roughness: 0.9, metalness: 0, transparent: true, opacity: 0.36, depthWrite: false }),
    drywall: new THREE.MeshStandardMaterial({ color: col('--text-2'), roughness: 0.8, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false }),
  };
  const edgeMat = new THREE.LineBasicMaterial({ color: col('--text-2'), transparent: true, opacity: 0.55 }), edgeDim = new THREE.LineBasicMaterial({ color: col('--text-3'), transparent: true, opacity: 0.4 });
  const wallGroup = new THREE.Group(); scene.add(wallGroup);
  for (const w of world.WALLS) {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = Math.hypot(dx, dy), collapsed = w.state === 'collapsed';
    const hgt = collapsed ? 0.45 : w.state === 'damaged' ? w.h * 0.82 : w.h, thick = rf.MATERIALS[w.mat]?.thick || 0.1;
    const geo = new THREE.BoxGeometry(len, hgt, thick), mesh = new THREE.Mesh(geo, wallMats[w.mat] || wallMats.drywall);
    mesh.position.set((w.a[0] + w.b[0]) / 2, hgt / 2, -(w.a[1] + w.b[1]) / 2); mesh.rotation.y = Math.atan2(dy, dx); mesh.renderOrder = 2;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), collapsed ? edgeDim : edgeMat); mesh.add(edges); wallGroup.add(mesh);
  }
  const rubMat = new THREE.MeshStandardMaterial({ color: col('--text-3'), roughness: 1, flatShading: true });
  const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c; return c; };
  for (const o of world.OBSTACLES) {
    if (o.kind === 'building') continue;
    if (o.kind === 'rubble') {                                               // a pile of broken pieces, seeded so it never changes
      const xs = o.poly.map((p) => p[0]), ys = o.poly.map((p) => p[1]), bx = [Math.min(...xs), Math.max(...xs)], by = [Math.min(...ys), Math.max(...ys)];
      const cx = (bx[0] + bx[1]) / 2, cy = (by[0] + by[1]) / 2, rad = Math.max(bx[1] - bx[0], by[1] - by[0]) / 2, n = Math.round((bx[1] - bx[0]) * (by[1] - by[0]) * 9);
      const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), rubMat, n), R = lab.rng(o.id.length * 977 + n), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      let k = 0;
      for (let tries = 0; k < n && tries < n * 6; tries++) {
        const p = [R.range(bx[0], bx[1]), R.range(by[0], by[1])]; if (!inPoly(p, o.poly)) continue;
        const fall = Math.max(0.15, 1 - Math.hypot(p[0] - cx, p[1] - cy) / rad), s = R.range(0.12, 0.42);
        e.set(R() * 6.3, R() * 6.3, R() * 6.3); q.setFromEuler(e);
        m.compose(new THREE.Vector3(p[0], R() * o.h * 0.75 * fall + s * 0.4, -p[1]), q, new THREE.Vector3(s * R.range(0.8, 1.6), s * R.range(0.4, 0.9), s * R.range(0.8, 1.4))); inst.setMatrixAt(k++, m);
      }
      inst.count = k; scene.add(inst); continue;
    }
    const shape = new THREE.Shape(o.poly.map((p) => new THREE.Vector2(p[0], p[1])));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: o.h, bevelEnabled: false });
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col('--bg-5'), roughness: 0.9 })); mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.01;
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeDim)); scene.add(mesh);
  }

  // launched rays
  const rayGeo = new THREE.BufferGeometry();
  const rayMat = new THREE.ShaderMaterial({
    uniforms: { uFront: { value: 0 }, uSteady: { value: 0.085 }, uLo: { value: -92 }, uHi: { value: -40 }, uCol: { value: col('--accent') }, uHot: { value: new THREE.Color(1, 1, 1) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float aDist; attribute float aPow; varying float vDist; varying float vPow; void main(){ vDist = aDist; vPow = aPow; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform float uFront; uniform float uSteady; uniform float uLo; uniform float uHi; uniform vec3 uCol; uniform vec3 uHot; varying float vDist; varying float vPow;',
      'void main(){ float p = clamp((vPow - uLo) / (uHi - uLo), 0.0, 1.0); float p2 = p * p;',
      '  float ahead = vDist - uFront; float pulse = exp(-ahead * ahead / 0.28); float wake = ahead < 0.0 ? exp(ahead / 9.0) : 0.0;',
      '  float a = p2 * (uSteady + 0.2 * wake) + pulse * (0.05 + 0.42 * p);',
      '  vec3 c = mix(uCol, uHot, clamp(pulse * 0.85 + p2 * 0.25, 0.0, 1.0));',
      '  gl_FragColor = vec4(c * a, 1.0); }'].join('\n'),
  });
  const rayLines = new THREE.LineSegments(rayGeo, rayMat); rayLines.frustumCulled = false; rayLines.renderOrder = 3; scene.add(rayLines);

  // the exact paths, as fat lines, and a bead that rides each one with the wavefront
  const mkFat = (dashed) => { const m = new LineMaterial({ linewidth: 1.5, vertexColors: true, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, dashed, dashSize: 0.28, gapSize: 0.2 }); const o = new LineSegments2(new LineSegmentsGeometry(), m); o.frustumCulled = false; o.renderOrder = 5; scene.add(o); return o; };
  const fatSolid = mkFat(false), fatDash = mkFat(true), fatHover = mkFat(false); fatHover.material.linewidth = 4; fatHover.renderOrder = 6;
  const beadTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.8)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const MAXB = 80, beadGeo = new THREE.BufferGeometry(); beadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXB * 3), 3));
  const beads = new THREE.Points(beadGeo, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, map: beadTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, color: 0xffffff })); beads.frustumCulled = false; beads.renderOrder = 7; scene.add(beads);
  const bounceGeo = new THREE.BufferGeometry(); const bounces = new THREE.Points(bounceGeo, new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, map: beadTex, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, color: col('--accent-2') })); bounces.frustumCulled = false; bounces.renderOrder = 6; scene.add(bounces);

  // the two radios
  const metal = new THREE.MeshStandardMaterial({ color: col('--text-2'), roughness: 0.45, metalness: 0.6 }), dark = new THREE.MeshStandardMaterial({ color: col('--bg-5'), roughness: 0.7, metalness: 0.2 });
  const glowA = new THREE.MeshBasicMaterial({ color: col('--accent') }), glowW = new THREE.MeshBasicMaterial({ color: 0xffffff });
  function ring(color, r) { const m = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.045, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false })); m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.renderOrder = 4; return m; }
  const txObj = new THREE.Group(), rxObj = new THREE.Group();
  { // probe radio on a small tripod
    for (let k = 0; k < 3; k++) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.72, 6), metal), a = (k / 3) * Math.PI * 2; leg.position.set(Math.cos(a) * 0.13, 0.34, Math.sin(a) * 0.13); leg.rotation.z = Math.cos(a) * 0.36; leg.rotation.x = -Math.sin(a) * 0.36; txObj.add(leg); }
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.16), dark); box.position.y = 0.7; txObj.add(box);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), glowW); ant.position.y = TX_H + 0.02; txObj.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), glowW); tip.position.y = TX_H + 0.1; txObj.add(tip);
    txObj.add(ring(0xffffff, 0.42)); txObj.pulse = ring(0xffffff, 0.42); txObj.add(txObj.pulse);
  }
  { // the rover: frame, four mecanum wheels, mast with the receiving antenna
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.1, 0.34), metal); body.position.y = 0.13; rxObj.add(body);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.24), dark); deck.position.y = 0.215; rxObj.add(deck);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 14), dark); wh.rotation.x = Math.PI / 2; wh.position.set(sx * 0.16, 0.04, sz * 0.2); rxObj.add(wh); }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.24, 6), metal); mast.position.y = 0.33; rxObj.add(mast);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), glowA); tip.position.y = RX_H; rxObj.add(tip);
    rxObj.add(ring(col('--accent'), 0.5));
  }
  scene.add(txObj, rxObj);
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, col('--ok'), 0.28, 0.16); arrow.line.material.depthTest = false; arrow.cone.material.depthTest = false; arrow.renderOrder = 8; scene.add(arrow);

  // HTML labels pinned to 3-D points
  const pins = [];
  const pin = (text, pos, cls = '') => { const el = h('span.radio-twin-pin' + (cls ? '.' + cls : ''), null, text); labels.append(el); const p = { el, pos }; pins.push(p); return p; };
  for (const r of world.ROOMS) pin(r.corridor ? r.name : r.id, v3([(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2], 0.02), 'room');
  const txPin = pin('Probe radio · transmits', v3(st.tx, 1.25), 'tx'), rxPin = pin('HOUND-01 · receives', v3(st.rx, 0.95), 'rx'), gradPin = pin('', v3(st.rx, 0.3), 'grad');

  // ---------- compute ----------
  function buildPathLines() {
    const solid = [], sc = [], dash = [], dc = [], bp = [];
    const top = paths.length ? paths[0].gainDb : 0, cW = [1, 1, 1], cA = lab.rgb(lab.tok('--accent')).map((v) => v / 255), cD = lab.rgb(lab.tok('--accent-2')).map((v) => v / 255);
    const shown = st.show.paths ? paths.filter((p) => p.gainDb > top - 42).slice(0, MAXB) : [];
    for (const p of shown) {
      const k = 0.75 * Math.max(0.1, 1 - (top - p.gainDb) / 46) ** 2.2, c = p.kind === 'direct' ? cW : p.kind === 'reflected' ? cA : cD;
      const arr = p.kind === 'diffracted' ? dash : solid, carr = p.kind === 'diffracted' ? dc : sc;
      let s = 0; const hs = p.pts.map((q, i) => { if (i) s += Math.hypot(q[0] - p.pts[i - 1][0], q[1] - p.pts[i - 1][1]); return s; });
      for (let i = 0; i < p.pts.length - 1; i++) {
        const a = p.pts[i], b = p.pts[i + 1], ha = TX_H + (RX_H - TX_H) * (hs[i] / s), hb = TX_H + (RX_H - TX_H) * (hs[i + 1] / s);
        arr.push(a[0], ha, -a[1], b[0], hb, -b[1]); carr.push(c[0] * k, c[1] * k, c[2] * k, c[0] * k, c[1] * k, c[2] * k);
        if (i) bp.push(a[0], ha, -a[1]);
      }
    }
    const put = (o, pos, colr) => { o.visible = pos.length > 0; if (!pos.length) return; o.geometry.dispose(); o.geometry = new LineSegmentsGeometry(); o.geometry.setPositions(pos); o.geometry.setColors(colr); o.computeLineDistances(); };
    put(fatSolid, solid, sc); put(fatDash, dash, dc);
    bounceGeo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); bounces.visible = bp.length > 0;
    buildPathLines.shown = shown; setHover(hoverPath);
  }
  function setHover(i) {
    hoverPath = i; const p = i >= 0 ? paths[i] : null;
    fatHover.visible = !!p; if (!p) return;
    const pos = [], colr = []; for (let k = 0; k < p.pts.length - 1; k++) { const a = p.pts[k], b = p.pts[k + 1]; pos.push(a[0], 0.7, -a[1], b[0], 0.7, -b[1]); colr.push(1, 1, 1, 1, 1, 1); }
    fatHover.geometry.dispose(); fatHover.geometry = new LineSegmentsGeometry(); fatHover.geometry.setPositions(pos); fatHover.geometry.setColors(colr);
  }
  function buildRays(fast) {
    if (!st.show.rays) { rayLines.visible = false; return; }
    const r = rf.shootRays(scene2, [st.tx[0], st.tx[1], TX_H], { n: fast ? 900 : st.rayCount, depth: 3 });
    const pos = new Float32Array(r.count * 6);
    for (let i = 0; i < r.count * 2; i++) { pos[i * 3] = r.pos[i * 3]; pos[i * 3 + 1] = r.pos[i * 3 + 2]; pos[i * 3 + 2] = -r.pos[i * 3 + 1]; }
    rayGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rayGeo.setAttribute('aDist', new THREE.BufferAttribute(r.dist.slice(0, r.count * 2), 1));
    rayGeo.setAttribute('aPow', new THREE.BufferAttribute(r.pow.slice(0, r.count * 2), 1));
    rayLines.visible = true; rayStat.set(r.count.toLocaleString('en-US'));
  }
  // field: coarse to fine, a few milliseconds per frame
  let fieldJob = null;
  function startField(fast) {
    const order = Math.min(st.order, fast ? 1 : 2);
    fieldJob = { strides: fast ? [8] : [8, 4, 2, 1], si: 0, j: 0, order, tx: st.tx.slice(), fast };
    stepField(14);
  }
  function stepField(budgetMs) {
    const J = fieldJob; if (!J) return;
    const t0 = performance.now(), opt = { order: J.order, diffraction: st.diffraction && !J.fast };
    while (J.si < J.strides.length) {
      const s = J.strides[J.si], first = J.si === 0;
      for (; J.j < gh; J.j += s) {
        if (performance.now() - t0 > budgetMs) { uploadField(); return; }
        for (let i = 0; i < gw; i += s) {
          if (!first && J.j % (2 * s) === 0 && i % (2 * s) === 0) continue;
          const p = [FIELD.x0 + (i + 0.5) * FIELD.res, FIELD.y0 + (J.j + 0.5) * FIELD.res];
          const v = Math.max(DB_LO, Math.min(DB_HI, 10 * Math.log10(rf.powerAt(scene2, J.tx, p, opt) + 1e-30)));
          for (let b = 0; b < s && J.j + b < gh; b++) for (let a = 0; a < s && i + a < gw; a++) fieldDb[(J.j + b) * gw + i + a] = v;
        }
      }
      J.si++; J.j = 0;
    }
    fieldJob = null; uploadField(); fieldStat.set('order ' + J.order, ''); updateGradient();
  }
  function uploadField() {
    const k = 255 / (DB_HI - DB_LO);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) fieldTex8[j * gw + i] = Math.round((fieldDb[j * gw + i] - DB_LO) * k);
    fieldTex.needsUpdate = true;
    if (fieldJob) fieldStat.set(['8', '4', '2', '1'][fieldJob.si] ? 'refining, ' + (FIELD.res * fieldJob.strides[fieldJob.si]).toFixed(1) + ' m cells' : '…', 'warn');
  }
  function updateGradient() {
    // which way to nudge the receiver for a stronger link: central differences on the summed path power
    const e = 0.3, o = { order: Math.min(st.order, 2), diffraction: st.diffraction }, P = (dx, dy) => 10 * Math.log10(rf.powerAt(scene2, st.tx, [st.rx[0] + dx, st.rx[1] + dy], o) + 1e-30);
    const gx = (P(e, 0) - P(-e, 0)) / (2 * e), gy = (P(0, e) - P(0, -e)) / (2 * e), g = Math.hypot(gx, gy);
    arrow.visible = g > 0.05 && st.show.paths; gradPin.el.hidden = !arrow.visible;
    if (!arrow.visible) { gradStat.set('flat'); return; }
    const len = Math.min(1.6, 0.5 + g * 0.25); arrow.position.set(st.rx[0], 0.08, -st.rx[1]); arrow.setDirection(new THREE.Vector3(gx / g, 0, -gy / g)); arrow.setLength(len, 0.26, 0.15);
    gradPin.pos.set(st.rx[0] + (gx / g) * (len + 0.25), 0.1, -(st.rx[1] + (gy / g) * (len + 0.25)));
    const dir = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'][((Math.round(Math.atan2(gy, gx) / (Math.PI / 4)) % 8) + 8) % 8];
    gradPin.el.textContent = '+' + g.toFixed(1) + ' dB per metre'; gradStat.set(lab.sgn(g, 1) + ' dB/m ' + dir, 'ok');
  }
  let slow = 0;
  function retrace({ fast = false, txMoved = true } = {}) {
    paths = rf.tracePaths(scene2, st.tx, st.rx, { order: st.order, diffraction: st.diffraction });
    stats = rf.linkStats(paths); H = rf.channel(paths);
    txObj.position.set(st.tx[0], 0, -st.tx[1]); rxObj.position.set(st.rx[0], 0, -st.rx[1]);
    txPin.pos.set(st.tx[0], 1.25, -st.tx[1]); rxPin.pos.set(st.rx[0], 0.95, -st.rx[1]);
    buildPathLines();
    if (txMoved) { buildRays(fast); startField(fast); }
    clearTimeout(slow);
    if (fast) { trunc = null; arrow.visible = false; gradPin.el.hidden = true; } else slow = setTimeout(slowPass, 30);
    readouts(); figH.cv.redraw(); figP.cv.redraw();
  }
  function slowPass() {
    const ref = rf.channel(rf.tracePaths(scene2, st.tx, st.rx, { order: 5, diffraction: st.diffraction }));
    let e = 0, p = 0; for (let k = 0; k < 51; k++) { e += (H.re[k] - ref.re[k]) ** 2 + (H.im[k] - ref.im[k]) ** 2; p += ref.re[k] ** 2 + ref.im[k] ** 2; }
    trunc = 10 * Math.log10(e / p + 1e-12);
    const top = paths.length ? paths[0].gainDb : 0, strong = paths.filter((q) => q.gainDb > top - 34).slice(0, 48);
    const N = 150, f = rf.fringe(strong, st.rx, 0.75, N); let mx = -Infinity; for (const v of f) if (v > mx) mx = v;
    fringeImg = { cv: lab.heatImage(f, N, N, mx - 30, mx), max: mx, n: strong.length };
    if (!fieldJob) updateGradient();
    readouts(); figF.cv.redraw();
  }

  // ---------- read-outs and controls ----------
  const gainStat = lab.stat('Path gain', 'dB', { title: 'Sum of the powers of all traced paths, between unit-gain antennas' }), rssiStat = lab.stat('Received power', 'dBm', { title: 'With ' + TX_DBM + ' dBm transmitted (assumed)' });
  const nStat = lab.stat('Paths found'), dsStat = lab.stat('Delay spread', 'ns', { title: 'Power-weighted spread of the arrival times' });
  const kStat = lab.stat('Strongest vs rest', 'dB', { title: 'Power of the strongest path over all the others together (Rician K)' }), truncStat = lab.stat('Left out by stopping here', 'dB', { title: 'Channel error against the same trace taken to 5 reflections, as a share of its power' });
  const rayStat = lab.stat('Ray segments drawn'), fieldStat = lab.stat('Floor field'), gradStat = lab.stat('Best nudge', '', { title: 'Direction in which the summed path power at the receiver rises fastest. Sionna RT gets such gradients exactly, by automatic differentiation; here it is a finite difference.' });
  const tbody = h('tbody');
  const table = h('table.table.dense.radio-twin-table', null, h('thead', null, h('tr', null, h('th', null, 'Path'), h('th.num', null, 'Walls'), h('th.num', null, 'Length'), h('th.num', null, 'Delay'), h('th.num', null, 'Gain'))), tbody);
  function readouts() {
    gainStat.set(lab.fx(stats.powerDb, 1)); rssiStat.set(lab.fx(stats.powerDb + TX_DBM, 1), stats.powerDb + TX_DBM > -75 ? 'ok' : stats.powerDb + TX_DBM > -88 ? 'warn' : 'danger');
    nStat.set(String(stats.n)); dsStat.set(lab.fx(stats.spreadNs, 1)); kStat.set(Number.isFinite(stats.kDb) ? lab.sgn(stats.kDb, 1) : 'one path');
    truncStat.set(trunc == null ? '…' : trunc < -80 ? 'nothing' : lab.fx(trunc, 1));
    tbody.replaceChildren(...paths.slice(0, 7).map((p, i) => h('tr', { tabindex: '0', onmouseenter: () => setHover(i), onmouseleave: () => setHover(-1), onfocus: () => setHover(i), onblur: () => setHover(-1) },
      h('td', null, p.kind === 'direct' ? (p.walls ? 'Straight, through wall' : 'Straight, clear') : p.kind === 'diffracted' ? 'Bent at a door frame' : p.order + (p.order === 1 ? ' bounce' : ' bounces')),
      h('td.num', null, String(p.walls)), h('td.num', null, p.d.toFixed(2) + ' m'), h('td.num', null, (p.d / 0.299792458).toFixed(1) + ' ns'), h('td.num', null, p.gainDb.toFixed(1)))));
  }
  const orderSeg = lab.seg([[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4']], st.order, (v) => { st.order = +v; retrace({ txMoved: true }); }, { label: 'Reflections traced' });
  const place = (i) => { const s = world.STOPS[i]; st.rx = s.pos.slice(); st.tx = [[59.4, 44.3], [50.4, 44.3], [70.6, 41.2], [70.6, 46.9]][i]; followT.input.checked = st.follow = false; retrace(); };
  const followT = lab.toggle('Receiver follows HOUND-01 in the mission', false, (on) => { st.follow = on; if (on) follow(true); }, { title: 'Uses the rover’s simulated position whenever it is inside or beside building B' });
  function follow(force) {
    if (!st.follow) return; const p = ctx.sim.state.units['HOUND-01'].pos;
    if (p[0] < FIELD.x0 || p[0] > FIELD.x1 || p[1] < FIELD.y0 || p[1] > FIELD.y1) { if (force) ctx.shell.toast('HOUND-01 is not at building B yet. The receiver stays where it is until the rover arrives.', { level: 'info' }); return; }
    if (force || Math.hypot(p[0] - st.rx[0], p[1] - st.rx[1]) > 0.15) { st.rx = p.slice(); retrace({ txMoved: false, fast: ctx.sim.state.running }); }
  }
  const nudgeBtn = (which, text) => h('button.btn.btn-sm', { type: 'button', title: 'Focus this, then use the arrow keys to move it 25 cm at a time', onkeydown: (ev) => {
    const d = { ArrowLeft: [-0.25, 0], ArrowRight: [0.25, 0], ArrowUp: [0, 0.25], ArrowDown: [0, -0.25] }[ev.key]; if (!d) return; ev.preventDefault();
    st[which] = clampPos([st[which][0] + d[0], st[which][1] + d[1]]); if (which === 'rx') followT.input.checked = st.follow = false; retrace({ txMoved: which === 'tx' });
  } }, icon('move'), text);
  const matRow = (m) => h('tr', null, h('td', null, rf.MATERIALS[m].label + ', ' + rf.MATERIALS[m].thick * 100 + ' cm'), h('td.num', null, rf.wallLossDb(m).toFixed(1)), h('td.num', null, rf.wallReflDb(m).toFixed(1)));
  side.append(
    lab.group('This link', h('div.radio-stats', null, gainStat, rssiStat, nStat, dsStat, kStat, truncStat), h('div.radio-stats', null, gradStat, fieldStat)),
    lab.group('Strongest paths', table, h('p.dim', null, 'Point at a row to pick that path out in the building.')),
    lab.group('Tracer',
      h('div.radio-row', null, h('span.radio-row-label', null, 'Reflections traced'), orderSeg),
      lab.toggle('Bend round door frames (knife-edge diffraction)', st.diffraction, (on) => { st.diffraction = on; retrace(); }),
      lab.toggle('Launched rays', true, (on) => { st.show.rays = on; buildRays(false); }), lab.toggle('Field on the floor', true, (on) => { st.show.field = on; fieldMesh.visible = on; legend.hidden = !on; }), lab.toggle('Exact paths and best nudge', true, (on) => { st.show.paths = on; buildPathLines(); updateGradient(); }),
      h('div.radio-stats', null, rayStat)),
    lab.group('Place the radios',
      h('div.radio-row', null, ...world.STOPS.map((s, i) => h('button.btn.btn-sm', { type: 'button', title: s.label, onclick: () => place(i) }, 'Stop ' + (i + 1)))),
      h('div.radio-row', null, nudgeBtn('tx', 'Transmitter'), nudgeBtn('rx', 'Receiver'), h('span.kbd-hint', null, h('kbd', null, '←'), h('kbd', null, '→'), h('kbd', null, '↑'), h('kbd', null, '↓'))),
      followT),
    lab.group('Walls, as the tracer sees them',
      h('table.table.dense.radio-twin-table', null, h('thead', null, h('tr', null, h('th', null, 'Slab'), h('th.num', null, 'Through, dB'), h('th.num', null, 'Reflected, dB'))), h('tbody', null, matRow('drywall'), matRow('concrete'))),
      h('p.dim', null, 'Loss at head-on incidence, from the slab equations with ITU-R P.2040-4 permittivity. Thicknesses are assumed. Rubble: ' + rf.RUBBLE_DB_PER_M + ' dB per metre, assumed.')));

  // ---------- 2-D figures ----------
  const order = SUB.map((s, i) => [s, i]).sort((a, b) => a[0] - b[0]);
  figH.cv = lab.canvas(figH.body, (c, w, hh) => {
    if (!H) return; const amp = order.map(([s, i]) => [s, 10 * Math.log10(H.re[i] ** 2 + H.im[i] ** 2 + 1e-30)]);
    let lo = Infinity, hi = -Infinity; for (const [, v] of amp) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const pad = Math.max(1.5, (hi - lo) * 0.2); lo = Math.floor((lo - pad) / 2) * 2; hi = Math.ceil((hi + pad) / 2) * 2; const stepY = hi - lo > 24 ? 10 : hi - lo > 10 ? 5 : 2;
    const yt = []; for (let v = Math.ceil(lo / stepY) * stepY; v <= hi; v += stepY) yt.push(v);
    const S = lab.plot(c, { x: 40, y: 20, w: w - 52, h: hh - 56, xd: [-27, 27], yd: [lo, hi], xt: [-26, -13, 0, 13, 26], yt, xl: 'subcarrier (−26 is ' + ((F0 - 26 * DF) / 1e6).toFixed(1) + ' MHz, +26 is ' + ((F0 + 26 * DF) / 1e6).toFixed(1) + ' MHz)', yl: '|H|, dB', ylx: 34 });
    const direct = paths.find((p) => p.kind === 'direct'); if (direct) { const y = S.Y(direct.gainDb); if (y > 20 && y < hh - 36) { lab.line(c, [[40, y], [w - 12, y]], lab.tok('--text-3'), 1, [3, 3]); lab.label(c, 'straight path alone', w - 16, y - 7, { align: 'right', color: lab.tok('--text-3') }); } }
    const neg = amp.filter(([s]) => s < 0).map(([s, v]) => [S.X(s), S.Y(v)]), pos = amp.filter(([s]) => s > 0).map(([s, v]) => [S.X(s), S.Y(v)]);
    for (const seg of [neg, pos]) { c.save(); c.beginPath(); c.moveTo(seg[0][0], hh - 36); for (const p of seg) c.lineTo(p[0], p[1]); c.lineTo(seg[seg.length - 1][0], hh - 36); const g = c.createLinearGradient(0, 20, 0, hh - 36); g.addColorStop(0, lab.rgba('--accent', 0.28)); g.addColorStop(1, lab.rgba('--accent', 0)); c.fillStyle = g; c.fill(); c.restore(); lab.line(c, seg, lab.tok('--accent'), 1.6); }
    c.fillStyle = lab.tok('--text'); for (const p of [...neg, ...pos]) c.fillRect(p[0] - 1, p[1] - 1, 2, 2);
    lab.label(c, 'ripple ' + (Math.max(...amp.map((a) => a[1])) - Math.min(...amp.map((a) => a[1]))).toFixed(1) + ' dB across 16 MHz', 46, 29, { color: lab.tok('--text-2'), bg: true });
  }, { label: 'Channel amplitude on the 51 subcarriers' });
  figP.cv = lab.canvas(figP.body, (c, w, hh) => {
    if (!paths.length) { lab.label(c, 'No path reaches the receiver above the floor.', w / 2, hh / 2, { align: 'center' }); return; }
    const top = paths[0].gainDb, shown = paths.filter((p) => p.gainDb > top - 50), tmax = Math.max(40, Math.ceil(Math.max(...shown.map((p) => p.d)) / 0.299792458 / 20) * 20);
    const hi = Math.ceil((top + 4) / 10) * 10, lo = hi - 60, xt = []; for (let t = 0; t <= tmax; t += tmax > 120 ? 40 : 20) xt.push(t);
    const S = lab.plot(c, { x: 40, y: 20, w: w - 52, h: hh - 56, xd: [0, tmax], yd: [lo, hi], xt, yt: [lo, lo + 20, lo + 40, hi], xl: 'arrival time, ns (30 cm of path per ns)', yl: 'gain, dB', ylx: 34 });
    const tNow = front / 0.299792458, still = lab.reducedMotion();
    for (const p of shown) {
      const x = S.X(p.d / 0.299792458), y = S.Y(Math.max(lo, p.gainDb)), arrived = still || p.d <= front, colr = p.kind === 'direct' ? lab.tok('--text') : p.kind === 'reflected' ? lab.tok('--accent') : lab.tok('--accent-2');
      c.globalAlpha = arrived ? 1 : 0.22; c.strokeStyle = colr; c.lineWidth = p.kind === 'direct' ? 2 : 1.3; if (p.kind === 'diffracted') c.setLineDash([3, 2]);
      c.beginPath(); c.moveTo(x, S.Y(lo)); c.lineTo(x, y); c.stroke(); c.setLineDash([]); c.fillStyle = colr; c.fillRect(x - 1.5, y - 1.5, 3, 3);
      if (arrived && !still && front - p.d < 1.2) { c.globalAlpha = 1 - (front - p.d) / 1.2; c.beginPath(); c.arc(x, y, 6, 0, 7); c.strokeStyle = lab.tok('--text'); c.lineWidth = 1; c.stroke(); }
    }
    c.globalAlpha = 1;
    if (!still && tNow < tmax) lab.line(c, [[S.X(tNow), 20], [S.X(tNow), hh - 36]], lab.rgba('--text', 0.55), 1);
    let lx = 46; for (const [t, colr, dash] of [['straight', '--text'], ['bounced', '--accent'], ['bent at a door frame', '--accent-2', true]]) { c.strokeStyle = lab.tok(colr); c.lineWidth = 2; if (dash) c.setLineDash([3, 2]); c.beginPath(); c.moveTo(lx, 29); c.lineTo(lx + 12, 29); c.stroke(); c.setLineDash([]); lab.label(c, t, lx + 16, 29); lx += 22 + c.measureText(t).width + 12; }
  }, { label: 'Power delay profile of the traced paths' });
  figF.cv = lab.canvas(figF.body, (c, w, hh) => {
    if (!fringeImg) { lab.label(c, 'Tracing…', w / 2, hh / 2, { align: 'center' }); return; }
    const s = Math.min(w - 16, hh - 16), x = (w - s) / 2, y = (hh - s) / 2;
    c.imageSmoothingEnabled = true; c.drawImage(fringeImg.cv, x, y, s, s); c.strokeStyle = lab.tok('--line-2'); c.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    const cx = x + s / 2, cy = y + s / 2; c.strokeStyle = lab.tok('--text'); c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, 5, 0, 7); c.moveTo(cx - 10, cy); c.lineTo(cx - 3, cy); c.moveTo(cx + 3, cy); c.lineTo(cx + 10, cy); c.moveTo(cx, cy - 10); c.lineTo(cx, cy - 3); c.moveTo(cx, cy + 3); c.lineTo(cx, cy + 10); c.stroke();
    lab.label(c, 'receiver', cx + 9, cy - 11, { bg: true, color: lab.tok('--text') });
    const px = (LAMBDA / 2 / 1.5) * s, bx = x + 8, by = y + s - 10; c.strokeStyle = lab.tok('--text'); c.beginPath(); c.moveTo(bx, by - 3); c.lineTo(bx, by); c.lineTo(bx + px, by); c.lineTo(bx + px, by - 3); c.stroke();
    lab.label(c, 'half a wavelength, ' + (LAMBDA * 50).toFixed(1) + ' cm', bx + px + 6, by - 1, { bg: true });
    lab.label(c, '30 dB range, ' + fringeImg.n + ' paths', x + s - 6, y + 11, { align: 'right', bg: true });
  }, { label: 'Standing-wave pattern around the receiver' });

  // ---------- pointer: drag the radios, probe the floor ----------
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitPt = new THREE.Vector3(), ndc = new THREE.Vector2();
  const clampPos = (p) => [lab.clamp(p[0], FIELD.x0 + 0.5, FIELD.x1 - 0.5), lab.clamp(p[1], FIELD.y0 + 0.5, FIELD.y1 - 0.5)];
  function floorAt(ev) { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.ray.intersectPlane(plane, hitPt) ? [hitPt.x, -hitPt.z] : null; }
  function near(ev) { const r = renderer.domElement.getBoundingClientRect(); let best = null, bd = 26; for (const [k, p, hy] of [['tx', st.tx, 0.5], ['rx', st.rx, 0.25]]) { const v = v3(p, hy).project(camera), d = Math.hypot(((v.x + 1) / 2) * r.width - (ev.clientX - r.left), ((1 - v.y) / 2) * r.height - (ev.clientY - r.top)); if (d < bd) { bd = d; best = k; } } return best; }
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', (ev) => { idleAt = performance.now(); controls.autoRotate = false; const k = near(ev); if (!k) return; dragging = k; controls.enabled = false; cv.setPointerCapture(ev.pointerId); cv.style.cursor = 'grabbing'; probe.hidden = true; if (k === 'rx') followT.input.checked = st.follow = false; ev.preventDefault(); });
  let moveQueued = null;
  cv.addEventListener('pointermove', (ev) => {
    if (dragging) { const p = floorAt(ev); if (p) { moveQueued = { which: dragging, p: clampPos(p) }; } return; }
    cv.style.cursor = near(ev) ? 'grab' : '';
    const p = floorAt(ev); if (!p || p[0] < FIELD.x0 || p[0] >= FIELD.x1 || p[1] < FIELD.y0 || p[1] >= FIELD.y1 || !st.show.field || ev.buttons) { probe.hidden = true; return; }
    const i = Math.floor((p[0] - FIELD.x0) / FIELD.res), j = Math.floor((p[1] - FIELD.y0) / FIELD.res), v = fieldDb[j * gw + i], room = world.roomAt(p), r = view.getBoundingClientRect();
    probe.hidden = false; probe.style.transform = 'translate(' + Math.round(ev.clientX - r.left + 14) + 'px,' + Math.round(ev.clientY - r.top + 12) + 'px)';
    probe.replaceChildren(h('b.num', null, (v <= DB_LO ? 'below ' : '') + v.toFixed(1) + ' dB'), h('span', null, (room ? room.name : 'Outside') + ' · ' + p[0].toFixed(1) + ', ' + p[1].toFixed(1) + ' m'));
  });
  const endDrag = (ev) => { if (!dragging) return; dragging = null; controls.enabled = true; cv.style.cursor = ''; try { cv.releasePointerCapture(ev.pointerId); } catch { /* already released */ } retrace({ txMoved: true }); };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag); cv.addEventListener('pointerleave', () => { probe.hidden = true; });
  cv.addEventListener('wheel', () => { idleAt = performance.now(); controls.autoRotate = false; }, { passive: true });

  // ---------- frame ----------
  let idleAt = performance.now(), size = [0, 0];
  const ro = new ResizeObserver(() => resize());
  function resize() { const r = view.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return; size = [r.width, r.height]; renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); for (const o of [fatSolid, fatDash, fatHover]) o.material.resolution.set(r.width, r.height); }
  const tmp = new THREE.Vector3(), RANGE = 46;
  const run = lab.loop((t, dt) => {
    if (moveQueued) { const m = moveQueued; moveQueued = null; st[m.which] = m.p; retrace({ fast: true, txMoved: m.which === 'tx' }); }
    if (fieldJob && !dragging) stepField(7);
    const still = lab.reducedMotion();
    if (still) front = 1e6; else if (!dragging) { if (hold > 0) { hold -= dt; if (hold <= 0) front = 0; } else { front += dt * (4.2 + front * 0.42); if (front > RANGE) { front = RANGE + 100; hold = 2.2; } } }
    rayMat.uniforms.uFront.value = front; rayMat.uniforms.uSteady.value = still || hold > 0 ? 0.3 : 0.07;
    const shownFront = Math.min(front, RANGE);
    hudClock.children[1].textContent = still ? 'steady state' : hold > 0 ? 'all arrived' : (shownFront / 0.299792458).toFixed(1) + ' ns';
    hudClock.children[2].textContent = still || hold > 0 ? stats.n + ' paths at the receiver' : shownFront.toFixed(2) + ' m from the transmitter';
    // beads
    const bp = beadGeo.attributes.position.array, shown = buildPathLines.shown || []; let nb = 0;
    if (!still && hold <= 0) for (const p of shown) {
      if (front > p.d || nb >= MAXB) continue; let s = front;
      for (let i = 0; i < p.pts.length - 1; i++) { const a = p.pts[i], b = p.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (s <= L) { const f = s / L; bp[nb * 3] = a[0] + (b[0] - a[0]) * f; bp[nb * 3 + 1] = TX_H + (RX_H - TX_H) * (front / p.d); bp[nb * 3 + 2] = -(a[1] + (b[1] - a[1]) * f); nb++; break; } s -= L; }
    }
    beadGeo.setDrawRange(0, nb); beadGeo.attributes.position.needsUpdate = true;
    const pu = still ? 0 : (t * 0.9) % 1; txObj.pulse.scale.setScalar(1 + pu * 2.2); txObj.pulse.material.opacity = 0.7 * (1 - pu);
    if (camGoal) { camGoal.t = Math.min(1, camGoal.t + dt / 0.9); const k = 1 - Math.pow(1 - camGoal.t, 3) > 0.999 ? 1 : 0.09; camera.position.lerp(camGoal.pos, k); controls.target.lerp(camGoal.tgt, k); if (camGoal.t >= 1 && camera.position.distanceTo(camGoal.pos) < 0.05) camGoal = null; }
    else if (!still && !dragging && performance.now() - idleAt > 9000 && camSeg.get() === 'orbit') controls.autoRotate = true;
    controls.update();
    renderer.render(scene, camera);
    for (const p of pins) { tmp.copy(p.pos).project(camera); const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05 && !p.el.hidden; p.el.style.opacity = vis ? '' : '0'; if (vis) p.el.style.transform = 'translate(' + (((tmp.x + 1) / 2) * size[0]).toFixed(1) + 'px,' + (((1 - tmp.y) / 2) * size[1]).toFixed(1) + 'px)'; }
    if (!still) figP.cv.redraw();
  });
  controls.addEventListener('start', () => { idleAt = performance.now(); controls.autoRotate = false; camGoal = null; });
  const offTick = ctx.bus.on('tick', () => follow(false));
  ctx.bus.on('reset', () => follow(false)); ctx.bus.on('seek', () => follow(false));

  ro.observe(view); resize(); setCamera('orbit', true); retrace();
  return {
    onShow() { resize(); retintIfNeeded(); run.start(); if (lab.reducedMotion()) { while (fieldJob) stepField(50); renderer.render(scene, camera); } figH.cv.redraw(); figP.cv.redraw(); figF.cv.redraw(); },
    onHide() { run.stop(); controls.autoRotate = false; },
    dispose() { run.stop(); offTick(); ro.disconnect(); renderer.dispose(); },
    debug: { st, retrace, get paths() { return paths; }, get stats() { return stats; }, get trunc() { return trunc; } },
  };
  function retintIfNeeded() { const l = lab.rampLut(); for (let i = 0; i < 256; i++) lutData.set([l[i * 3], l[i * 3 + 1], l[i * 3 + 2], 255], i * 4); lutTex.needsUpdate = true; rayMat.uniforms.uCol.value = col('--accent'); if (fringeImg) slowPass(); buildPathLines(); }
}
