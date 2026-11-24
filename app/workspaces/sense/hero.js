// Demo mode. One ten-second window becomes a relief of steel pins; a scan head reads it; the real activations light the
// six layers behind it in turn; and the answer comes out of a concrete wall, filled to its score against the alarm line.
// When it is an alarm, warm light runs back to the cells that pushed the answer towards "person" (gradient x activation).
// Every height, thread and colour is computed in this page from the real weights. Every window is simulated.
import { clamp, tok } from './common.js';
import { compile } from './fastnet.js';
import { attribute } from './attribution.js';
import { inputScale, createAnatomy } from './anatomy.js';

const GROUPS = [
  { name: 'Moving', cat: 'Person moving', list: [14, 15, 17, 12] },
  { name: 'Empty', cat: 'Empty room', list: [3, 0, 1, 5] },
  { name: 'Fan', cat: 'Empty room + fan', list: [9, 7, 10] },
  { name: 'Standing', cat: 'Person standing still', list: [22, 18, 20] },
  { name: 'Lying', cat: 'Person lying still', list: [24, 29, 25] },
];
const ORDER = [0, 1, 2, 3, 4];
const U = 0.11, LEN = 8.8, SWAP = 0.8;
// rows, columns, samples per column, centre of column 0, pitch across rows, base height, travel, name, time the light arrives, time it leaves
const L = [
  { id: 'x', R: 52, T: 200, s: 1, c0: 0.5, pz: 0.11, base: 0.5, H: 0.44, t0: 0.9, t1: 2.9, name: 'Ten seconds of Wi-Fi', dims: '52 x 200' },
  { id: 'c1', R: 24, T: 192, s: 1, c0: 4.5, pz: 0.15, base: 0.1, H: 1.1, t0: 2.0, t1: 3.2, name: 'Convolution 1', dims: '24 x 192' },
  { id: 'p1', R: 24, T: 48, s: 4, c0: 6, pz: 0.15, base: 0.1, H: 1.15, t0: 2.7, t1: 3.6, name: 'Average pool', dims: '24 x 48' },
  { id: 'c2', R: 24, T: 40, s: 4, c0: 22, pz: 0.15, base: 0.1, H: 1.3, t0: 3.2, t1: 4.1, name: 'Convolution 2', dims: '24 x 40' },
  { id: 'p2', R: 24, T: 20, s: 8, c0: 24, pz: 0.15, base: 0.1, H: 1.4, t0: 3.7, t1: 4.5, name: 'Average pool', dims: '24 x 20' },
  { id: 'c3', R: 24, T: 12, s: 8, c0: 56, pz: 0.15, base: 0.1, H: 1.55, t0: 4.1, t1: 4.9, name: 'Convolution 3', dims: '24 x 12' },
  { id: 'feat', R: 2, T: 24, w: 0.37, pz: 0.62, base: 0.1, H: 1.7, t0: 4.6, t1: 5.1, name: 'Mean and peak', dims: '48' },
  { id: 'hidden', R: 2, T: 16, w: 0.44, pz: 0.62, base: 0.1, H: 1.9, t0: 4.9, t1: 5.4, name: 'Dense layer', dims: '32' },
];
{ let z = 0; L.forEach((l, k) => { l.k = k; l.depth = l.R * l.pz; l.z1 = z; l.z0 = z - l.depth; z = l.z0 - (k < 5 ? 1.2 : 1); l.y = 0.34 + 0.42 * k; l.wx = l.w || l.s * U; l.cx = (t) => (l.w ? (t - (l.T - 1) / 2) * l.w : (l.c0 + t * l.s - 100) * U); l.cz = (r) => l.z0 + (r + 0.5) * l.pz; }); }
const WALL = L[7].z0 - 4.6, WY = 5.9, EM = 4.3, CAP = 0.7 * EM;
const ease = (x) => { x = clamp(x, 0, 1); return x * x * x * (x * (6 * x - 15) + 10); };
const span = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const SAY = [[0.9, 'Ten seconds of radio, from behind a wall'], [2.6, '24 filters slide along it'], [3.7, 'Each cell now hears 2.2 seconds'], [4.3, 'Each cell now hears 5.6 seconds'], [5.0, '32 units weigh the evidence'], [5.6, '']];

export async function create(host, ctx) {
  const { h, icon, realityTag } = ctx.kit, nn = ctx.nn, net = compile(nn.weights), reduced = () => ctx.kit.reducedMotion();
  const stage = h('div.sense-hero-stage'), now = h('div.sense-hero-now', { role: 'status', 'aria-live': 'polite' }), tip = h('div.sense-hero-tip.glass', { hidden: true });
  const word = h('div.word', null, h('b', null, ''), h('span.num', null, '')), gauge = h('div.gauge', null, h('i'), h('u'), h('em', null, 'alarm above ' + nn.threshold.toFixed(2)));
  gauge.style.setProperty('--mark', nn.threshold);
  const truth = h('div.truth.late');
  const stepBtns = GROUPS.map((g, i) => h('button', { 'aria-pressed': 'false', title: g.cat, onclick: () => pick(i) }, g.name, h('s')));
  const hold = h('button.hold', { 'aria-label': 'Pause', 'aria-pressed': 'false', onclick: () => setHold(!held) }, icon('pause', 14));
  host.classList.add('sense-hero');
  host.append(stage, h('div.sense-hero-veil'),
    h('div.sense-hero-title', null, h('div.tags', null, realityTag('live-ai'), h('span.tag.tag-sim', null, 'Simulated windows')), h('h2', null, 'Hearing a person through a wall'), h('p', null, 'HOUND’s real neural network, running in this page.')),
    now,
    h('div.sense-hero-answer', null, h('span.says', null, 'The network says'), word, gauge, truth, h('div.sense-hero-steps', { role: 'group', 'aria-label': 'Choose a situation' }, stepBtns, hold)),
    tip);

  const cache = new Map();
  function study(i) { // one window: forward pass, back-propagation, and what to say about it
    if (cache.has(i)) return cache.get(i);
    const s = nn.samples[i], t0 = performance.now(), out = nn.infer(s.x, { trace: true }), ms = performance.now() - t0;
    const tr = net.forward(s.x, true), at = attribute(net, s.x, tr), fires = out.person > nn.threshold, right = fires === !!s.person;
    const place = s.person ? { 'Person moving': 'A person was moving', 'Person standing still': 'A person stood still', 'Person lying still': 'A person lay still' }[s.cat] + ', ' + s.depth.toFixed(1) + ' m behind the wall.' : s.cat === 'Empty room' ? 'The room was empty.' : 'The room was empty, with a fan running.';
    const d = { i, s, out, tr, at, ms, fires, right, verdict: fires ? (out.moving > 0.5 ? 'Person, moving' : 'Person, still') : 'No person', truth: (right ? 'Right. ' : s.person ? 'HOUND listens again, with radar and heat. ' : 'Radar and heat are asked next. ') + place };
    cache.set(i, d); return d;
  }

  let cur = null, group = 0, T = SWAP, held = false, running = false, raf = 0, last = 0, pending = null, three = null, flat = null, said = -1, shownTruth = false;
  const turn = GROUPS.map(() => 0);
  const nextOf = (g) => { const l = GROUPS[g].list; return l[turn[g]++ % l.length]; };
  function pick(g, sample) { // go to a situation now: the standing pins sink, then the new window rises
    pending = { g, i: sample ?? nextOf(g) };
    if (reduced() || !three) { adopt(); T = LEN - 0.4; paint(); }
    else { if (T > SWAP) T = cur ? 0 : SWAP; if (held) setHold(false); }
  }
  function adopt() {
    const p = pending; pending = null; group = p.g; cur = study(p.i); said = -1; shownTruth = false;
    stepBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === group)));
    truth.classList.add('late'); word.classList.remove('alarm'); gauge.classList.remove('alarm'); gauge.style.setProperty('--v', 0);
    word.firstChild.textContent = 'Listening'; word.lastChild.textContent = '';
    three?.load(cur); flat?.setData({ x: cur.s.x, out: cur.tr, threshold: nn.threshold, weights: nn.weights, scale: inputScale(cur.s.x) });
  }
  function setHold(v) { held = v; hold.setAttribute('aria-pressed', String(v)); hold.setAttribute('aria-label', v ? 'Play' : 'Pause'); hold.replaceChildren(icon(v ? 'play' : 'pause', 14)); if (running) kick(); }
  function say(text) { if (now.dataset.t === text) return; now.dataset.t = text; now.classList.add('swap'); setTimeout(() => { if (now.dataset.t === text) { now.textContent = text; now.classList.remove('swap'); } }, 200); }
  function beats() { // words change only at beats, never per frame
    if (!cur) return;
    let n = -1; for (let k = 0; k < SAY.length; k++) if (T >= SAY[k][0]) n = k;
    if (T < SWAP) { if (said !== -2) { said = -2; say(''); truth.classList.add('late'); } return; }
    if (!shownTruth && n !== said && n >= 0 && n < SAY.length - 1) { said = n; say(SAY[n][1]); }
    if (T >= 5.5 && !shownTruth) {
      shownTruth = true; said = 99; say(cur.fires ? 'Warm pins pushed the answer towards a person' : 'Nothing crossed the alarm line');
      word.firstChild.textContent = cur.verdict; word.lastChild.textContent = cur.out.person.toFixed(2); word.classList.toggle('alarm', cur.fires); gauge.classList.toggle('alarm', cur.fires); gauge.style.setProperty('--v', cur.out.person);
      truth.className = 'truth ' + (cur.right ? 'right' : 'again'); truth.replaceChildren(icon(cur.right ? 'check' : 'reset', 16), h('span', null, cur.truth));
    }
  }
  function paint() { beats(); three?.pose(T, 0); three?.render(0.016); }
  function kick() { if (!raf && running) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function frame(t) {
    raf = 0; if (!running) return;
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    const still = reduced();
    if (!held && !still) {
      T += dt;
      if (T >= LEN) { T = 0; if (!pending) { const g = ORDER[(ORDER.indexOf(group) + 1) % ORDER.length]; pending = { g, i: nextOf(g) }; } }
      if (T >= SWAP && pending) { adopt(); T = SWAP; }
      if (pending && T < SWAP === false && T > SWAP) T = 0;
      stepBtns[group].lastChild.style.transform = 'scaleX(' + span(T, SWAP, LEN).toFixed(3) + ')';
    } else if (still) T = LEN - 0.4;
    for (let k = 0; k < stepBtns.length; k++) if (k !== group) { const st = stepBtns[k].lastChild.style; if (st.transform !== 'scaleX(0)') st.transform = 'scaleX(0)'; }
    beats();
    if (three) { three.pose(T, dt); three.render(dt); }
    if (three || flat) raf = requestAnimationFrame(frame);
  }

  try { three = await build(); }
  catch (e) {
    console.warn('[sense] demo 3-D unavailable, using the flat view:', e.message || e);
    stage.replaceChildren(); const box = h('div.sense-hero-flat'); stage.append(box);
    flat = await createAnatomy(box, ctx); flat.setMode('flat'); flat.setStage(9, { silent: true });
  }
  const want = ctx.params?.sample;
  const start = want != null && nn.samples[want] ? { g: Math.max(0, GROUPS.findIndex((g) => g.cat === nn.samples[want].cat)), i: +want } : { g: 0, i: nextOf(0) };
  pending = start; adopt();
  for (const g of ORDER) { study(GROUPS[g].list[0]); await new Promise((r) => setTimeout(r)); } // the first round is ready before it plays
  three?.prime();
  paint();

  return {
    onShow() { running = true; three?.resize(); kick(); },
    onHide() { running = false; cancelAnimationFrame(raf); raf = 0; },
    onParams(p) { if (p.sample != null) { const s = nn.samples[p.sample]; if (!s) { ctx.shell.toast?.('There is no window ' + p.sample + '. The bundled windows are 0 to ' + (nn.samples.length - 1) + '.'); return; } pick(Math.max(0, GROUPS.findIndex((g) => g.cat === s.cat)), +p.sample); } },
    get three() { return three; }, get time() { return T; }, seek(t) { T = t; paint(); }, hold: setHold, study,
  };

  // ------------------------------------------------------------------ the set --------------------------------------
  async function build() {
    const probe = document.createElement('canvas'); if (!probe.getContext('webgl2')) throw new Error('WebGL is not available');
    const [THREE, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }, { RoomEnvironment }, d3] = await Promise.all([
      import('three'), import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'), import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js'), import('three/addons/postprocessing/ShaderPass.js'), import('three/addons/environments/RoomEnvironment.js'), import('d3')]);
    await Promise.all([document.fonts.load('400 200px "Instrument Serif"'), document.fonts.load('500 24px "Instrument Sans"')]).catch(() => {});
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const dom = renderer.domElement; dom.tabIndex = 0; dom.setAttribute('role', 'img'); dom.setAttribute('aria-label', 'The Wi-Fi window and the six layers of the network as lit relief, ending in the answer. Drag or use the arrow keys to orbit.');
    stage.append(dom);
    const scene = new THREE.Scene(), BG = new THREE.Color('#0a0e13'); scene.background = BG; scene.fog = new THREE.FogExp2(BG, 0.0125);
    const camera = new THREE.PerspectiveCamera(31, 1.9, 0.3, 160);
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.05).texture; scene.environmentIntensity = 0.2; pm.dispose();
    const PERSON = new THREE.Color(tok('--person')), COOL = new THREE.Color('#2f7fd8'), ICE = new THREE.Color('#d6ecff');

    // light: one hard key from the left, a cool rim from the back right, and the answer itself
    const key = new THREE.DirectionalLight('#e6edf6', 3.6); key.position.set(-26, 13, -4); key.target.position.set(0, 0, -15); key.castShadow = true;
    key.shadow.mapSize.set(3072, 3072); Object.assign(key.shadow.camera, { left: -26, right: 22, top: 20, bottom: -14, near: 1, far: 70 }); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    const rim = new THREE.DirectionalLight('#6ea3da', 0.22); rim.position.set(20, 9, -34); rim.target.position.set(0, 0, -8);
    const hemi = new THREE.HemisphereLight('#8fa6c0', '#0a0c0f', 0.10);
    const glowLight = new THREE.PointLight(PERSON, 0, 60, 1.35); glowLight.position.set(0, WY + 0.4, WALL + 6.5);
    const graze = new THREE.SpotLight('#c9dcf2', 1500, 70, 0.62, 0.95, 1.5); graze.position.set(-27, 24, WALL + 5); graze.target.position.set(6, 3, WALL + 0.5);
    const headLight = new THREE.PointLight('#cfe6ff', 0, 9, 1.6);
    const fill = new THREE.DirectionalLight('#9db4cf', 0.32); fill.position.set(-8, 7, 20); scene.add(fill);
    scene.add(graze, graze.target, key, key.target, rim, rim.target, hemi, glowLight, headLight);

    // concrete: a few octaves of value noise, stains, board joints and tie holes
    function concrete(size, joints, seed) {
      const N = 512, g = new Float32Array(N * N), rnd = (x, y, s) => { const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7 + seed) * 43758.5453; return n - Math.floor(n); };
      for (let o = 0, f = 4, a = 0.5; o < 6; o++, f *= 2, a *= 0.56) {
        const grid = new Float32Array(f * f); for (let y = 0; y < f; y++) for (let x = 0; x < f; x++) grid[y * f + x] = rnd(x, y, o);
        for (let y = 0; y < N; y++) { const v = y / N * f, y0 = v | 0, fy = v - y0, sy = fy * fy * (3 - 2 * fy), y1 = (y0 + 1) % f; for (let x = 0; x < N; x++) { const u = x / N * f, x0 = u | 0, fx = u - x0, sx = fx * fx * (3 - 2 * fx), x1 = (x0 + 1) % f; const p = grid[y0 * f + x0], q = grid[y0 * f + x1], r = grid[y1 * f + x0], s = grid[y1 * f + x1]; g[y * N + x] += a * (p + (q - p) * sx + (r - p) * sy + (p - q - r + s) * sx * sy); } }
      }
      const c = document.createElement('canvas'); c.width = c.height = N; const cc = c.getContext('2d'), im = cc.createImageData(N, N);
      for (let k = 0; k < N * N; k++) { const v = clamp(96 + (g[k] - 0.55) * 130, 20, 200); im.data[k * 4] = v; im.data[k * 4 + 1] = v * 1.01; im.data[k * 4 + 2] = v * 1.03; im.data[k * 4 + 3] = 255; }
      cc.putImageData(im, 0, 0);
      const pit = (n, rad, al) => { for (let k = 0; k < n; k++) { cc.fillStyle = 'rgba(6,8,10,' + al * (0.4 + rnd(k, 3, 9) * 0.6) + ')'; cc.beginPath(); cc.arc(rnd(k, 1, 5) * N, rnd(k, 2, 5) * N, rad * (0.3 + rnd(k, 4, 2)), 0, 7); cc.fill(); } };
      pit(260, 1.3, 0.6);
      if (joints) { cc.fillStyle = 'rgba(5,7,9,0.85)'; cc.fillRect(0, 0, N, 3); cc.fillRect(0, 0, 3, N); cc.fillStyle = 'rgba(255,255,255,0.10)'; cc.fillRect(0, 3, N, 1); cc.fillRect(3, 0, 1, N); for (const [x, y] of [[96, 110], [416, 110], [96, 402], [416, 402]]) { cc.fillStyle = 'rgba(4,6,8,0.9)'; cc.beginPath(); cc.arc(x, y, 8, 0, 7); cc.fill(); cc.strokeStyle = 'rgba(255,255,255,0.10)'; cc.beginPath(); cc.arc(x, y, 9.5, 0.3, 2.6); cc.stroke(); } }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.set(1 / size, 1 / size); return t;
    }
    const wallTex = concrete(7.5, true, 1.7); wallTex.offset.y = 0.44; const floorTex = concrete(6, true, 8.3);
    const planeUV = (geo, w, hh) => { const uv = geo.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w, uv.getY(k) * hh); return geo; };
    const wall = new THREE.Mesh(planeUV(new THREE.PlaneGeometry(260, 40), 260, 40), new THREE.MeshStandardMaterial({ map: wallTex, bumpMap: wallTex, bumpScale: 3.2, roughness: 0.92, metalness: 0, color: '#70777f' }));
    wall.position.set(0, 20, WALL); wall.receiveShadow = true; scene.add(wall);
    const floor = new THREE.Mesh(planeUV(new THREE.PlaneGeometry(260, 130), 260, 130), new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: floorTex, bumpScale: 1.4, roughness: 0.78, metalness: 0.1, color: '#4e555d' }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, WALL + 64); floor.receiveShadow = true; scene.add(floor);

    // the plinths: dark steel, bevelled, each with its name etched in the riser
    const steel = new THREE.MeshStandardMaterial({ color: '#2e353e', roughness: 0.4, metalness: 0.6 });
    const etch = (text, sub) => { const c = document.createElement('canvas'); c.width = 1024; c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.font = '500 34px "Instrument Sans", sans-serif'; x.fillText(text, 4, 34); const w = x.measureText(text).width; x.globalAlpha = 0.55; x.fillText(sub.replace('x', '×'), w + 28, 34); const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t; };
    const plates = [];
    for (const l of L) {
      const w = l.T * l.wx + 0.5, d = l.depth + 0.4, hgt = l.y, sh = new THREE.Shape(); const a = w / 2, b = d / 2; sh.moveTo(-a, -b); sh.lineTo(a, -b); sh.lineTo(a, b); sh.lineTo(-a, b); sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, { depth: hgt - 0.03, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }); geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, steel); const mid = l.w ? 0 : l.cx((l.T - 1) / 2); m.position.set(mid, 0, (l.z0 + l.z1) / 2); m.castShadow = m.receiveShadow = true; scene.add(m);
      const lw = 5, t = new THREE.Mesh(new THREE.PlaneGeometry(lw, lw / 16), new THREE.MeshBasicMaterial({ map: etch(l.name, l.dims), transparent: true, opacity: 0.46, depthWrite: false, color: '#b9c6d4' })); plates.push(t.material);
      t.position.set(mid - w / 2 + 0.16 + lw / 2, l.y - 0.2, (l.z0 + l.z1) / 2 + b + 0.036); scene.add(t);
    }

    // the pins: one instanced mesh per layer; all motion happens in the vertex shader
    const pinGeo = (() => {
      const c = 0.13, P = [], rings = [[0.5, 0], [0.5, 0.5], [0.5 - c, 1]], at = (r, k) => [[-1, -1], [1, -1], [1, 1], [-1, 1]][k % 4].map((s) => s * r[0]);
      const tri = (...v) => v.forEach((p) => P.push(...p));
      for (let q = 0; q < 2; q++) for (let k = 0; k < 4; k++) { const a = at(rings[q], k), b = at(rings[q], k + 1), e = at(rings[q + 1], k), f = at(rings[q + 1], k + 1), A = [a[0], rings[q][1], a[1]], B = [b[0], rings[q][1], b[1]], E = [e[0], rings[q + 1][1], e[1]], F = [f[0], rings[q + 1][1], f[1]]; tri(A, E, B, B, E, F); }
      const t = [0, 1, 2, 3].map((k) => { const a = at(rings[2], k); return [a[0], 1, a[1]]; }); tri(t[0], t[2], t[1], t[0], t[3], t[2]);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g;
    })();
    const VHEAD = 'attribute float aV; attribute float aC; attribute float aP; uniform float uR, uAmp, uBase, uH, uCh; varying float vV, vC, vFl, vOn, vNy, vH, vP;\n';
    const VBODY = 'float q = (uR * 1.2 - aP) / 0.17; float on = smoothstep(0.0, 1.0, q) * uAmp; float hh = uBase + aV * uH * on; vec3 transformed = position; transformed.y = position.y < 0.25 ? 0.0 : hh - uCh * (1.0 - position.y) * 2.0;\n';
    const layers = L.map((l) => {
      const n = l.R * l.T, u = { uR: { value: 0 }, uAmp: { value: 0 }, uBase: { value: l.base }, uH: { value: l.H }, uCh: { value: Math.min(0.06, l.pz * 0.3) }, uB: { value: 0 }, uPerson: { value: PERSON }, uCool: { value: COOL }, uIce: { value: ICE }, uSign: { value: l.k === 0 ? 1 : 0 }, uGain: { value: l.k === 0 ? 1.7 : 2.1 } };
      const geo = pinGeo.clone(), v = new THREE.InstancedBufferAttribute(new Float32Array(n), 1), c = new THREE.InstancedBufferAttribute(new Float32Array(n), 1), p = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      for (let r = 0; r < l.R; r++) for (let t = 0; t < l.T; t++) p.array[r * l.T + t] = t / (l.T - 1 || 1);
      geo.setAttribute('aV', v); geo.setAttribute('aC', c); geo.setAttribute('aP', p);
      const mat = new THREE.MeshStandardMaterial({ color: '#69727d', roughness: 0.5, metalness: 0.5 });
      mat.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, u);
        s.vertexShader = VHEAD + s.vertexShader.replace('#include <begin_vertex>', VBODY + 'vV = aV; vC = aC; vP = aP; vOn = on; vFl = q > 0.0 ? exp(-q * 1.7) * step(uR, 1.45) * uAmp : 0.0; vNy = normal.y; vH = transformed.y / max(hh, 0.001);');
        s.fragmentShader = 'uniform vec3 uPerson, uCool, uIce; uniform float uB, uSign, uGain; varying float vV, vC, vFl, vOn, vNy, vH, vP;\n' + s.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix(0.12, 1.0, smoothstep(0.0, 0.95, vH));')
          .replace('#include <emissivemap_fragment>', [
            'float mag = pow(min(abs(vV), 1.0), 1.5) * vOn;',
            'float face = 0.06 + 0.34 * vH * vH * vH + 0.80 * smoothstep(0.35, 0.95, vNy);',
            'float w = clamp(vC, 0.0, 1.0) * uB;',
            'vec3 cool = mix(uCool * 0.55, uIce, mag * mag) * mag * uGain * (1.0 - 0.62 * uB);',
            'if (uSign > 0.5 && vV < 0.0) cool *= 0.42;',
            'vec3 hot = mix(uPerson, vec3(1.0, 0.62, 0.36), w * 0.55) * (0.35 + 2.1 * w) * w;',
            'totalEmissiveRadiance += (cool * (1.0 - w) + hot) * face + uIce * vFl * (0.10 + 0.75 * face);',
          ].join('\n'));
      };
      const mesh = new THREE.InstancedMesh(geo, mat, n); mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true;
      const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); dm.onBeforeCompile = (s) => { Object.assign(s.uniforms, u); s.vertexShader = VHEAD + s.vertexShader.replace('#include <begin_vertex>', VBODY); }; mesh.customDepthMaterial = dm;
      const m4 = new THREE.Matrix4(), gap = l.k < 2 ? 0.004 : Math.max(0.014, l.wx * 0.06);
      for (let r = 0; r < l.R; r++) for (let t = 0; t < l.T; t++) { m4.makeScale(l.wx - gap, 1, l.pz * (l.R === 2 ? 0.6 : 0.88)); m4.setPosition(l.cx(t), l.y, l.cz(r)); mesh.setMatrixAt(r * l.T + t, m4); }
      scene.add(mesh);
      return { l, u, mesh, v, c };
    });

    // the threads: the strongest weight x input products between neighbouring layers
    const RN = 1400, SEG = 22, rib = new THREE.InstancedBufferGeometry();
    { const P = [], I = []; for (let k = 0; k <= SEG; k++) P.push(k / SEG, -1, 0, k / SEG, 1, 0); for (let k = 0; k < SEG; k++) { const a = k * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } rib.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); rib.setIndex(I); }
    const rA = new THREE.InstancedBufferAttribute(new Float32Array(RN * 3), 3), rB = new THREE.InstancedBufferAttribute(new Float32Array(RN * 3), 3), rD = new THREE.InstancedBufferAttribute(new Float32Array(RN * 4), 4);
    rib.setAttribute('aA', rA); rib.setAttribute('aB', rB); rib.setAttribute('aD', rD); rib.instanceCount = 0;
    const ru = { uF: { value: new Float32Array(8) }, uBk: { value: new Float32Array(8) }, uAmp: { value: 0 }, uRes: { value: new THREE.Vector2(1680, 888) }, uPerson: { value: PERSON }, uCool: { value: new THREE.Color('#69b1ff') }, uIce: { value: ICE }, uTime: { value: 0 } };
    const ribbons = new THREE.Mesh(rib, new THREE.ShaderMaterial({
      uniforms: ru, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute vec3 aA, aB; attribute vec4 aD; uniform float uF[8]; uniform float uBk[8]; uniform vec2 uRes; varying float vU, vS, vF, vK, vSeed; varying float vW; varying float vDepth;' +
        'vec3 at(float u){ float l = length(aB - aA); vec3 c = (aA + aB) * 0.5 + vec3(0.0, 0.55 + l * 0.20 + aD.z * 0.5, 0.0); return mix(mix(aA, c, u), mix(c, aB, u), u); }' +
        'void main(){ int k = int(aD.y + 0.5); vU = position.x; vS = aD.x; vSeed = aD.z; vF = uF[k]; vK = uBk[k]; vec4 p = projectionMatrix * modelViewMatrix * vec4(at(vU), 1.0); vec4 q = projectionMatrix * modelViewMatrix * vec4(at(vU + 0.02), 1.0);' +
        'vec2 d = normalize((q.xy / q.w - p.xy / p.w) * uRes + 1e-5); float px = clamp(0.022 * (0.35 + abs(aD.x)) * projectionMatrix[1][1] * uRes.y / p.w, 1.0, 2.6 * uRes.y / 888.0); vW = position.y; vDepth = p.w; p.xy += vec2(-d.y, d.x) * position.y * px / uRes * p.w; gl_Position = p; }',
      fragmentShader: 'uniform vec3 uPerson, uCool, uIce; uniform float uAmp; varying float vU, vS, vF, vK, vSeed, vW, vDepth; void main(){ float s = abs(vS); float edge = 1.0 - vW * vW; float go = smoothstep(0.0, 0.03, vF); float head = vF * 1.5 - vSeed * 0.3; float a = smoothstep(0.0, 0.05, head - vU) * go;' +
        'float pulse = exp(-abs(head - vU) * 13.0) * step(vF, 0.999) * go; float tail = a * (0.05 + 0.26 * s) ; float warm = vS > 0.0 ? smoothstep(0.0, 0.2, vK * 1.3 - (1.0 - vU)) : 0.0; float bp = vS > 0.0 ? exp(-abs(vK * 1.3 - (1.0 - vU)) * 11.0) * step(0.001, vK) * step(vK, 0.999) : 0.0;' +
        'vec3 col = mix(uCool, uPerson, warm) * tail * mix(1.0, vS > 0.0 ? 2.6 : 0.35, warm > 0.0 ? warm : step(0.5, vK)) + uIce * pulse * (0.25 + s) * 1.1 + uPerson * bp * (0.4 + s) * 1.6;' +
        'col *= edge * uAmp * exp(-vDepth * 0.012); gl_FragColor = vec4(col, 1.0); }' }));
    ribbons.frustumCulled = false; scene.add(ribbons);

    // the answer: the serif cut as real geometry from its own outline, coming out of the wall
    function glyphs(text, em) {
      const px = 210, c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true }); x.font = '400 ' + px + 'px "Instrument Serif", Georgia, serif';
      const adv = x.measureText(text).width, W = Math.ceil(adv) + 40, H = Math.ceil(px * 1.35), base = Math.round(px * 0.98); c.width = W; c.height = H;
      x.font = '400 ' + px + 'px "Instrument Serif", Georgia, serif'; x.fillStyle = '#fff'; x.textBaseline = 'alphabetic'; x.fillText(text, 20, base);
      const D = x.getImageData(0, 0, W, H).data, f = new Float64Array(W * H); for (let k = 0; k < f.length; k++) f[k] = D[k * 4 + 3];
      const k = em / px, shapes = [], path = (ring) => { const out = []; let lx = 1e9, ly = 1e9; for (const [a, b] of ring) { if (Math.hypot(a - lx, b - ly) < 1.1) continue; lx = a; ly = b; out.push(new THREE.Vector2((a - 20) * k, (base - b) * k)); } return out; };
      for (const poly of d3.contours().size([W, H]).thresholds([127])(f)[0].coordinates) { const o = path(poly[0]); if (o.length < 4) continue; const s = new THREE.Shape(o); for (let q = 1; q < poly.length; q++) { const hole = path(poly[q]); if (hole.length > 3) s.holes.push(new THREE.Path(hole)); } shapes.push(s); }
      const geo = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.03, bevelOffset: -0.02, bevelSegments: 2, steps: 1 });
      return { geo, w: adv * k };
    }
    const wu = { uLvl: { value: 0 }, uIgn: { value: 0 }, uLit: { value: 0 }, uPerson: { value: PERSON }, uIce: { value: ICE } };
    const lettersMat = (filled) => { const m = new THREE.MeshStandardMaterial({ color: '#434a53', roughness: 0.55, metalness: 0.4 }); m.customProgramCacheKey = () => 'sense-letters-' + filled; m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, wu); s.vertexShader = 'varying vec3 vOP; varying vec3 vON;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vOP = position; vON = normal;');
      s.fragmentShader = 'uniform float uLvl, uIgn, uLit; uniform vec3 uPerson, uIce; varying vec3 vOP; varying vec3 vON;\n' + s.fragmentShader.replace('#include <emissivemap_fragment>', [
        filled ? 'float below = 1.0 - smoothstep(uLvl - 0.02, uLvl + 0.02, vOP.y); float men = exp(-abs(vOP.y - uLvl) * 16.0);' : 'float below = 1.0; float men = 0.0;',
        'float front = smoothstep(0.5, 0.95, vON.z); vec3 lamp = mix(uIce * 0.42, uPerson * vec3(1.15, 0.92, 0.8), uIgn);',
        'totalEmissiveRadiance += uLit * (vec3(0.085, 0.1, 0.12) * (0.25 + 0.75 * front) * (1.0 - uIgn) + lamp * below * (0.22 + 0.78 * front) + mix(uIce, vec3(1.0, 0.75, 0.55), uIgn) * men * 1.1 * front * step(0.01, uLvl));'].join('\n')); }; return m; };
    const book = {}; for (const w of ['Person, moving', 'Person, still', 'No person']) { book[w] = glyphs(w, EM); await new Promise((r) => setTimeout(r)); }
    const digit = {}; for (const d of '0123456789.') digit[d] = glyphs(d, EM * 0.62);
    const group3 = new THREE.Group(); group3.position.set(0, WY, WALL); scene.add(group3);
    const wordMesh = new THREE.Mesh(book['No person'].geo, lettersMat(true)); wordMesh.castShadow = true;
    const numMat = lettersMat(false), nums = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(digit['0'].geo, numMat); m.castShadow = true; group3.add(m); return m; }); group3.add(wordMesh);
    const lineY = nn.threshold * CAP, alarm = new THREE.Mesh(new THREE.BoxGeometry(1, 0.035, 0.035), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(1.25) }));
    alarm.position.set(0, lineY, 1.02); group3.add(alarm);
    const alarmTag = new THREE.Mesh(new THREE.PlaneGeometry(14, 14 / 16), new THREE.MeshBasicMaterial({ map: etch('Alarm line', nn.threshold.toFixed(2)), transparent: true, depthWrite: false, opacity: 0.9 })); group3.add(alarmTag);
    const radial = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'), g = x.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.34)'); g.addColorStop(0.7, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); })();
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(46, 22), new THREE.MeshBasicMaterial({ map: radial, color: PERSON, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); halo.position.set(0, WY + 1.2, WALL + 0.05); scene.add(halo);
    const pool2 = new THREE.Mesh(new THREE.PlaneGeometry(40, 9), new THREE.MeshBasicMaterial({ map: radial, color: PERSON, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); pool2.rotation.x = -Math.PI / 2; pool2.position.set(0, 0.02, WALL + 3); scene.add(pool2);

    // the scan head: a machined gantry over the window, and the sheet of light under it
    const gantry = new THREE.Group(), gm = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.3, metalness: 0.9 }), gd = new THREE.MeshStandardMaterial({ color: '#1a1e24', roughness: 0.5, metalness: 0.7 });
    const box = (w, hh, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m); b.position.set(x, y, z); b.castShadow = true; gantry.add(b); return b; };
    const gz0 = L[0].z0 - 0.45, gz1 = L[0].z1 + 0.45, gc = (gz0 + gz1) / 2, gl = gz1 - gz0;
    for (const z of [gz0, gz1]) { box(0.2, 2.0, 0.12, gm, 0, 1.2, z); box(0.5, 0.2, 0.3, gd, 0, 0.36, z); box(0.07, 1.7, 0.02, gd, 0, 1.2, z + (z > -1 ? 0.07 : -0.07)); for (let k = 0; k < 4; k++) box(0.045, 0.045, 0.02, gm, k % 2 ? 0.17 : -0.17, k < 2 ? 0.32 : 0.41, z + (z > -1 ? 0.16 : -0.16)); }
    box(0.26, 0.26, gl + 0.2, gm, 0, 2.2, gc); box(0.36, 0.06, gl - 0.3, gd, 0, 2.06, gc); for (let k = 0; k < 13; k++) box(0.28, 0.03, 0.12, gd, 0, 2.34, gz0 + 0.3 + k * (gl - 0.6) / 12);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, gl - 0.4), new THREE.MeshBasicMaterial({ color: new THREE.Color('#dff0ff').multiplyScalar(3) })); lamp.position.set(0, 2.015, gc); gantry.add(lamp);
    const sheetMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uA: { value: 0 }, uT: ru.uTime }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec2 vUv; uniform float uA, uT; float n(vec2 p){ return fract(sin(dot(floor(p), vec2(12.9, 78.2))) * 43758.5); } void main(){ float e = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x); float f = 0.75 + 0.25 * sin(vUv.x * 70.0 + uT * 2.0) * sin(vUv.x * 23.0 - uT); gl_FragColor = vec4(vec3(0.55, 0.78, 1.0) * uA * e * f * (0.05 + 0.30 * vUv.y * vUv.y + 0.5 * exp(-vUv.y * 26.0)), 1.0); }' });
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(gl - 0.4, 1.4), sheetMat); sheet.rotation.y = Math.PI / 2; sheet.position.set(0, 1.31, gc); gantry.add(sheet); scene.add(gantry);
    for (const z of [gz0, gz1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(25, 0.1, 0.16), gm); rail.position.set(0, 0.22, z); rail.castShadow = rail.receiveShadow = true; scene.add(rail); for (let k = 0; k < 11; k++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.26), gd); f.position.set(-12 + k * 2.4, 0.1, z); scene.add(f); } }

    // dust in the key light
    const DN = 520, dp = new Float32Array(DN * 3); for (let k = 0; k < DN; k++) { dp[k * 3] = (Math.random() - 0.5) * 44; dp[k * 3 + 1] = Math.random() * 11; dp[k * 3 + 2] = 8 - Math.random() * 44; }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    const dust = new THREE.Points(dg, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: ru.uTime, uRes: ru.uRes }, vertexShader: 'uniform float uT; uniform vec2 uRes; varying float vA; void main(){ vec3 p = position; p.x += sin(uT * 0.11 + position.z) * 1.4; p.y = mod(p.y + uT * 0.07, 11.0); p.z += cos(uT * 0.09 + position.x) * 1.0; vec4 m = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * m; gl_PointSize = clamp(uRes.y * 0.045 / -m.z, 1.0, 5.0); vA = smoothstep(2.0, 8.0, -m.z) * (0.4 + 0.6 * fract(position.x * 7.3)); }', fragmentShader: 'varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(0.75, 0.85, 1.0) * vA * 0.16 * smoothstep(0.5, 0.0, r), 1.0); }' }));
    dust.frustumCulled = false; scene.add(dust);

    const pickBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#ffffff' })); pickBox.visible = false; scene.add(pickBox);

    // post: bloom on the signals only, then a film grade
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }), composer = new EffectComposer(renderer, rt);
    const bloom = new UnrealBloomPass(new THREE.Vector2(800, 400), 0.42, 0.55, 0.92);
    const grade = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uT: ru.uTime }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uT; void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.75; float l = dot(c, vec3(0.3, 0.6, 0.1)); c = mix(c, c * vec3(0.94, 1.0, 1.07), (1.0 - l) * 0.5); float n = fract(sin(dot(gl_FragCoord.xy + fract(uT) * 91.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5; c += n * 0.022; gl_FragColor = vec4(c, 1.0); }' });
    composer.addPass(new RenderPass(scene, camera)); composer.addPass(bloom); composer.addPass(new OutputPass()); composer.addPass(grade);

    // camera: one slow closed path, the same every window. [time, position, look-at, field of view]
    const KEYS = [[0.0, [0.4, 9.4, 9.8], [0.1, 2.9, -19]], [1.5, [-6.4, 4.0, 6.4], [-1.6, 0.4, -5.6]], [2.9, [3.4, 4.6, 6.6], [2.2, 0.8, -8.5]], [4.5, [5.0, 7.3, 6.0], [0.8, 2.2, -17]], [5.9, [1.8, 8.6, 7.0], [0.2, 3.2, -22]], [7.8, [-0.8, 9.6, 9.0], [0, 2.9, -20]], [8.8, [0.4, 9.4, 9.8], [0.1, 2.9, -19]]];
    const path = (which, axis, t) => { let k = 0; while (k < KEYS.length - 2 && t > KEYS[k + 1][0]) k++; const n = KEYS.length - 1, get = (j) => KEYS[((j % n) + n) % n], time = (j) => get(j)[0] + Math.floor(j / n) * LEN; const t0 = KEYS[k][0], t1 = KEYS[k + 1][0], u = (t - t0) / (t1 - t0), p0 = KEYS[k][which][axis], p1 = KEYS[k + 1][which][axis]; const m0 = (p1 - get(k - 1)[which][axis]) / (t1 - time(k - 1)) * (t1 - t0), m1 = (get(k + 2)[which][axis] - p0) / (time(k + 2) - t0) * (t1 - t0); const u2 = u * u, u3 = u2 * u; return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (3 * u2 - 2 * u3) * p1 + (u3 - u2) * m1; };
    let yaw = 0, pitch = 0, zoom = 1, yawT = 0, pitchT = 0, zoomT = 1, drag = null, idle = 9, clock = 0;
    const target = new THREE.Vector3(), off = new THREE.Vector3(), sph = new THREE.Spherical();
    dom.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; dom.setPointerCapture(e.pointerId); tip.hidden = true; pickBox.visible = false; });
    dom.addEventListener('pointermove', (e) => { if (drag) { yawT = clamp(yawT - (e.clientX - drag.x) * 0.0042, -1.5, 1.5); pitchT = clamp(pitchT - (e.clientY - drag.y) * 0.0032, -0.7, 0.35); drag.x = e.clientX; drag.y = e.clientY; idle = 0; } else hover(e); });
    const drop = () => { drag = null; }; dom.addEventListener('pointerup', drop); dom.addEventListener('pointercancel', drop); dom.addEventListener('pointerleave', () => { tip.hidden = true; pickBox.visible = false; });
    dom.addEventListener('wheel', (e) => { e.preventDefault(); zoomT = clamp(zoomT * Math.exp(e.deltaY * 0.0008), 0.45, 1.35); idle = 0; }, { passive: false });
    dom.addEventListener('keydown', (e) => { const d = { ArrowLeft: [0.12, 0], ArrowRight: [-0.12, 0], ArrowUp: [0, -0.07], ArrowDown: [0, 0.07] }[e.key]; if (d) { e.preventDefault(); e.stopPropagation(); yawT = clamp(yawT + d[0], -1.5, 1.5); pitchT = clamp(pitchT + d[1], -0.7, 0.35); idle = 0; if (reduced()) { yaw = yawT; pitch = pitchT; paint(); } } });

    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
    function hover(e) {
      if (!cur) return; const b = dom.getBoundingClientRect(); mouse.set((e.clientX - b.left) / b.width * 2 - 1, 1 - (e.clientY - b.top) / b.height * 2); ray.setFromCamera(mouse, camera);
      let best = null;
      for (const { l, u, v } of layers) { // step the ray down through the layer until it meets a pin
        if (u.uR.value < 0.02) continue;
        for (let s = 0; s <= 40; s++) { const y = l.base + l.H * (1 - s / 40); plane.constant = -(l.y + y); if (!ray.ray.intersectPlane(plane, hit)) continue; const t = Math.round((hit.x - l.cx(0)) / l.wx), r = Math.floor((hit.z - l.z0) / l.pz); if (t < 0 || r < 0 || t >= l.T || r >= l.R || l.base + v.array[r * l.T + t] * l.H < y - 0.02) continue; const d = hit.distanceTo(camera.position); if (!best || d < best.d) best = { l, t, r, d }; break; }
      }
      pickBox.visible = !!best; tip.hidden = !best; if (!best) return;
      const { l, t, r } = best, k = r * l.T + t, rec = layers[l.k], v = rec.v.array[k], hh = l.base + v * l.H;
      pickBox.position.set(l.cx(t), l.y + hh / 2, l.cz(r)); pickBox.scale.set(l.wx * 1.04, hh + 0.03, l.pz * (l.R === 2 ? 0.64 : 1.02));
      const raw = l.k < 6 ? (l.k ? cur.tr.layers[l.id][r][t] : cur.s.x[r][t]) : l.id === 'feat' ? cur.tr.layers.feat[r * 24 + t] : cur.tr.layers.hidden[r * 16 + t];
      const con = l.k < 6 ? cur.at.c[l.id][r][t] : cur.at.c[l.id][l.id === 'feat' ? r * 24 + t : r * 16 + t];
      const head = l.k === 0 ? (r < 51 ? 'Subcarrier ' + (r + 1) : 'Motion row') + ', ' + (t / 20).toFixed(2) + ' s' : l.k < 6 ? l.name + ', filter ' + (r + 1) + ', step ' + (t + 1) : l.id === 'feat' ? (r ? 'Peak' : 'Mean') + ' of filter ' + (t + 1) : 'Dense unit ' + (r * 16 + t + 1);
      const val = l.k === 0 ? (raw >= 0 ? '+' : '−') + Math.abs(raw).toFixed(2) + ' % from average' : 'activation ' + raw.toFixed(2);
      tip.replaceChildren(h('b', null, head), h('span.num', null, val), h('span', null, Math.abs(con) < 0.0005 ? 'No effect on this answer' : 'Pushes ' + (con > 0 ? 'towards' : 'away from') + ' person by ' + Math.abs(con).toFixed(3)));
      tip.style.transform = 'translate(' + Math.min(e.clientX - b.left + 16, b.width - 240) + 'px,' + Math.max(8, e.clientY - b.top - 74) + 'px)';
    }

    function load(d) {
      for (const { l, u, v, c } of layers) {
        const rows = l.k === 0 ? d.s.x : d.tr.layers[l.id], con = d.at.c[l.id], n = l.R * l.T, get = (a, r, t) => (l.k < 6 ? a[r][t] : a[r * l.T + t]);
        let m = 1e-9, cm = []; if (l.k === 0) m = inputScale(d.s.x); else for (let r = 0; r < l.R; r++) for (let t = 0; t < l.T; t++) m = Math.max(m, get(rows, r, t));
        for (let r = 0; r < l.R; r++) for (let t = 0; t < l.T; t++) { const q = get(con, r, t); if (q > 0) cm.push(q); }
        cm.sort((a, b) => a - b); const cs = cm.length ? cm[Math.floor((cm.length - 1) * (l.k < 6 ? 0.985 : 1))] || 1e-9 : 1e-9;
        for (let r = 0; r < l.R; r++) for (let t = 0; t < l.T; t++) { const k = r * l.T + t; v.array[k] = clamp(get(rows, r, t) / m, -1, 1); const q = get(con, r, t) / cs; c.array[k] = q > 0 ? Math.pow(Math.min(1, q), 0.8) : 0; }
        v.needsUpdate = c.needsUpdate = true;
      }
      const top = (l, r, t) => l.y + l.base + layers[l.k].v.array[r * l.T + t] * l.H, mx = new Float32Array(8); for (const e of d.at.edges) mx[e.k] = Math.max(mx[e.k], Math.abs(e.v));
      const W = book[d.verdict], txt = d.out.person.toFixed(2), gap = EM * 0.34; let nw = 0; for (const ch of txt) nw += digit[ch].w;
      const total = W.w + gap + nw, x0 = -total / 2; wordMesh.geometry = W.geo; wordMesh.position.set(x0, 0, 0); let nx = x0 + W.w + gap; nums.forEach((m, k) => { m.geometry = digit[txt[k]].geo; m.position.set(nx, 0, 0); nx += digit[txt[k]].w; });
      alarm.scale.x = W.w + 6.4; alarm.position.x = x0 - 5.8 + (W.w + 6.4) / 2; alarmTag.position.set(x0 - 5.8 + 7, lineY + 0.42, 1.02);
      const n = Math.min(RN, d.at.edges.length);
      for (let q = 0; q < n; q++) { const e = d.at.edges[q], a = L[e.k], s = Math.sign(e.v) * Math.sqrt(Math.abs(e.v) / (mx[e.k] || 1)); rA.setXYZ(q, a.cx(e.s), top(a, e.r, e.s), a.cz(e.r));
        if (e.k < 7) { const b = L[e.k + 1]; rB.setXYZ(q, b.cx(e.t), top(b, e.f, e.t), b.cz(e.f)); } else rB.setXYZ(q, x0 + W.w * (0.08 + 0.84 * ((e.s * 4 + e.t + (e.r ? 2 : 0)) % 64) / 63), WY + CAP * 0.15, WALL + 0.9);
        rD.setXYZW(q, s, e.k, (q * 0.618) % 1, 0); }
      rib.instanceCount = n; rA.needsUpdate = rB.needsUpdate = rD.needsUpdate = true;
    }

    function pose(t) {
      const sink = 1 - ease(span(t, 0, SWAP)), amp = t < SWAP ? sink : 1;
      for (let k = 0; k < 8; k++) {
        const { l, u } = layers[k]; u.uAmp.value = amp; u.uR.value = t < SWAP ? 2 : t < l.t1 ? span(t, l.t0, l.t1) : 1 + span(t, l.t1, l.t1 + 0.9);
        const b0 = 5.75 + (7 - k) * 0.16; u.uB.value = cur?.fires ? (t < SWAP ? sink : ease(span(t, b0, b0 + 0.6))) : 0;
        ru.uF.value[k] = t < SWAP ? 1 : span(t, l.t0 + (k === 0 ? 1.1 : 0.45), l.t0 + (k === 0 ? 2.3 : 1.15)); ru.uBk.value[k] = cur?.fires ? (t < SWAP ? 1 : span(t, b0 - 0.1, b0 + 0.55)) : 0;
      }
      ru.uAmp.value = amp; const pl = 0.46 - 0.34 * (t < SWAP ? sink : ease(span(t, 4.6, 5.6))); for (let k = 0; k < 8; k++) plates[k].opacity = pl;
      const out = t < SWAP ? sink : ease(span(t, 5.0, 5.7)); wordMesh.scale.z = alarm.visible ? 0.02 + out * 0.95 : 1; for (let k = 0; k < 4; k++) nums[k].scale.z = 0.02 + ease(clamp(out * 1.3 - 0.3, 0, 1)) * 0.6;
      wordMesh.position.z = -0.12 + out * 0.12; for (let k = 0; k < 4; k++) nums[k].position.z = -0.12 + out * 0.12; group3.visible = out > 0.002; 
      const s = cur ? cur.out.person : 0, lv = ease(span(t, 5.2, 6.1)) * s; wu.uLvl.value = t < SWAP ? s * CAP : lv * CAP;
      const ign = cur?.fires ? (t < SWAP ? 1 : ease(span(lv, nn.threshold - 0.005, Math.min(s, nn.threshold + 0.06)))) : 0; wu.uIgn.value = ign; wu.uLit.value = out;
      const g = ign * out; glowLight.intensity = g * 105; halo.material.opacity = g * 0.10; pool2.material.opacity = g * 0.16; alarm.material.opacity = out;
      const sw = t < SWAP ? 1 - ease(span(t, 0, SWAP)) : span(t, L[0].t0, L[0].t1) * 1.0; gantry.position.x = -11.3 + 22.6 * sw; const on = t < SWAP ? 0 : ease(span(t, SWAP, 1.1)) * (1 - ease(span(t, 2.8, 3.2))); sheetMat.uniforms.uA.value = on; headLight.intensity = on * 4; headLight.position.set(gantry.position.x, 1.75, gc); lamp.material.color.setRGB(0.5 + on * 2.2, 0.55 + on * 2.4, 0.62 + on * 2.6);
    }
    function aim(t, dt) {
      idle += dt; if (idle > 5 && !drag) { const k = 1 - Math.exp(-dt * 0.9); yawT -= yawT * k; pitchT -= pitchT * k; zoomT += (1 - zoomT) * k; }
      const f = reduced() ? 1 : 1 - Math.exp(-dt * 7); yaw += (yawT - yaw) * f; pitch += (pitchT - pitch) * f; zoom += (zoomT - zoom) * f;
      target.set(path(2, 0, t), path(2, 1, t), path(2, 2, t)); camera.position.set(path(1, 0, t), path(1, 1, t), path(1, 2, t));
      off.subVectors(camera.position, target); sph.setFromVector3(off); sph.theta += yaw; sph.phi = clamp(sph.phi + pitch, 0.25, 1.53); sph.radius *= zoom; off.setFromSpherical(sph); camera.position.addVectors(target, off);
      if (camera.position.y < 0.9) camera.position.y = 0.9; camera.lookAt(target);
    }
    let pr = Math.min(1.75, devicePixelRatio || 1), slow = 0, seen = 0, size = [0, 0];
    function resize() { const r = stage.getBoundingClientRect(); if (r.width < 8 || r.height < 8) return; size = [r.width, r.height]; renderer.setPixelRatio(pr); renderer.setSize(r.width, r.height, false); composer.setPixelRatio(pr); composer.setSize(r.width, r.height); bloom.setSize(r.width * 0.5 * pr, r.height * 0.5 * pr); camera.aspect = r.width / r.height; camera.fov = camera.aspect > 1.8 ? 31 : 31 * Math.min(1.25, 1.86 / camera.aspect); camera.updateProjectionMatrix(); ru.uRes.value.set(r.width * pr, r.height * pr); }
    const ro = new ResizeObserver(resize); ro.observe(stage); resize();
    function render(dt) {
      clock += dt; ru.uTime.value = clock; aim(T, dt); composer.render(dt);
      seen++; if (seen > 40) { slow += dt > 0.0195 ? 1 : -0.35; slow = Math.max(0, slow); if (slow > 45 && pr > 0.75) { pr = Math.max(0.75, pr * 0.85); slow = 0; seen = 0; resize(); } }
    }
    function prime() { for (const w of Object.values(book)) { wordMesh.geometry = w.geo; group3.visible = true; renderer.render(scene, camera); } for (const d of Object.values(digit)) { nums[0].geometry = d.geo; renderer.render(scene, camera); } load(cur); }
    return { prime, pose, render, resize, load, camera, info: renderer.info, get pr() { return pr; } };
  }
}
