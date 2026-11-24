// Report, Demo mode: the finished document as an object. The pages are the real ones (the same HTML that prints), on a
// dark desk under one lamp. They turn by themselves, and the plan is drawn in ink from the mission log.
import * as THREE from 'three';
import { rasterSheet, inkOrder } from './raster.js';

const PW = 2.10, PH = 2.97, SEG = 44, THICK = 0.011;                  // one unit is 100 mm
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };

// What the film does: at second t, how many leaves are turned and where the camera stands.
const FILM = [
  { t: 0, turned: 0, shot: 'cover', cap: 'The mission is over. This is what the next team is handed.' },
  { t: 2.6, turned: 1, shot: 'spread', cap: 'The plan draws itself from the mission log.' },
  { t: 4.8, turned: 1, shot: 'plan', cap: 'The plan draws itself from the mission log.' },
  { t: 13.6, turned: 1, shot: 'people', cap: 'Who was found, how sure, and the way in.' },
  { t: 19.5, turned: 1, shot: 'spread', cap: 'Who was found, how sure, and the way in.' },
  { t: 21, turned: 'mark', shot: 'mark', cap: 'The search marking for the wall of the building.' },
  { t: 27, turned: 'last', shot: 'last', cap: 'Every test result, and who approved what.' },
  { t: 33, turned: 0, shot: 'cover', cap: 'Every page is written from the log. Nothing by hand.' },
  { t: 38, end: true },
];

const CAPS = { cover: FILM[0].cap, spread: FILM[3].cap, mark: FILM[5].cap, last: FILM[6].cap };

export function createReportHero(host, ctx, { print }) {
  const { h, icon, realityTag, reducedMotion } = ctx.kit;
  const canvas = h('canvas.rh-canvas', { 'aria-hidden': 'true' });
  const simTag = h('span.tag.tag-sim', { title: 'The people, the damage and the readings are simulated. The report is written by code from that run.' }, 'Simulated exercise');
  const cap = h('p.rh-sub', { 'aria-live': 'off' }, 'The mission is over. This is what the next team is handed.');
  const printBtn = h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: print }, icon('report'), h('span', null, 'Print'));
  const steps = h('div.rh-steps', { role: 'group', 'aria-label': 'Open the report at' });
  const title = h('h1.rh-h1', null, 'Three people, on paper.'), figs = h('div.rh-figs');
  const prev = h('button.rh-turn', { type: 'button', 'aria-label': 'Turn back one page', onclick: () => turnBy(-1) }, icon('chevron-left')), next = h('button.rh-turn', { type: 'button', 'aria-label': 'Turn one page', onclick: () => turnBy(1) }, icon('chevron-left'));
  host.append(canvas, h('div.rh-vig', { 'aria-hidden': 'true' }), h('div.rh-copy', null, h('div.rh-tags', null, realityTag('live-algo'), simTag), title, cap, h('div.rh-row', null, printBtn, steps)), figs);

  let renderer, scene, camera, lamp, ready = false, visible = false, raf = 0, last = 0, time = 0, begun = false, dpr = 1, slow = 0, shadowsDirty = 3, hw = 1, hh = 1;
  let leaves = [], N = 0, turned = 0, film = 0, fi = -1, auto = true, shot = 'cover', ink = 0, inkWant = 0, idle = 0, R = null, markLeaf = 4, yaw = 0, pit = 0, yawW = 0, pitW = 0, drag = false, moved = 0, motes = null, lampK = 0;
  const uInk = { value: 0 };
  const pos = new THREE.Vector3(1.2, 5.5, 5.2), tgt = new THREE.Vector3(0.8, 0, 0), wp = new THREE.Vector3(), wt = new THREE.Vector3();
  // camera: target x, z; distance; pitch; yaw
  const SHOTS = { cover: [0.42, -0.05, 7.3, 0.98, -0.12], spread: [-0.66, 0.0, 8.0, 1.02, -0.04], plan: [-1.42, -0.12, 5.1, 1.12, 0.07], people: [-0.56, -0.06, 7.0, 1.10, -0.10], mark: [-1.42, -0.12, 5.1, 1.12, 0.05], last: [-0.66, 0.0, 7.4, 1.04, 0.05] };

  // ---------- surfaces ----------
  const rngOf = (s) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  function deskTextures() {
    const S = 1024, c = document.createElement('canvas'), b = document.createElement('canvas'); c.width = c.height = b.width = b.height = S; const g = c.getContext('2d'), q = b.getContext('2d'), rnd = rngOf(17);
    g.fillStyle = '#241c17'; g.fillRect(0, 0, S, S); q.fillStyle = '#808080'; q.fillRect(0, 0, S, S);
    for (let plank = 0; plank < 4; plank++) {
      const y0 = plank * 256, ph = rnd() * 9, tint = 0.82 + rnd() * 0.3;
      for (let i = 0; i < 1100; i++) { const y = y0 + rnd() * 256, l = 300 + rnd() * 1100, x = rnd() * S - 300, d = rnd(), a = 0.02 + rnd() * 0.075; const wob = (xx) => y + Math.sin(xx * 0.006 + ph) * 7 + Math.sin(xx * 0.019 + y * 0.05) * 2.2; g.strokeStyle = d > 0.5 ? 'rgba(' + Math.round(96 * tint) + ',' + Math.round(72 * tint) + ',' + Math.round(54 * tint) + ',' + a + ')' : 'rgba(10,7,5,' + a * 1.5 + ')'; g.lineWidth = 0.5 + rnd() * 1.0; g.beginPath(); for (let xx = x; xx < x + l; xx += 16) g.lineTo(xx, Math.max(y0, Math.min(y0 + 255, wob(xx)))); g.stroke(); if (d < 0.4) { q.strokeStyle = 'rgba(40,40,40,' + a * 1.6 + ')'; q.lineWidth = g.lineWidth; q.beginPath(); for (let xx = x; xx < x + l; xx += 16) q.lineTo(xx, Math.max(y0, Math.min(y0 + 255, wob(xx)))); q.stroke(); } }
      g.fillStyle = 'rgba(4,3,2,0.85)'; g.fillRect(0, y0, S, 2); q.fillStyle = '#4a4a4a'; q.fillRect(0, y0, S, 2);
    }
    for (let i = 0; i < 46; i++) { const x = rnd() * S, y = rnd() * S; g.strokeStyle = 'rgba(160,140,120,' + 0.03 + ')'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 190, y + (rnd() - 0.5) * 60); g.stroke(); }
    const T = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2.6, 2.6); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    return { map: T(c, true), bump: T(b, false) };
  }
  function fibre() { const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), rnd = rngOf(5), d = g.createImageData(S, S); for (let i = 0; i < S * S; i++) { const v = 118 + rnd() * 20; d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; } g.putImageData(d, 0, 0); for (let i = 0; i < 700; i++) { g.strokeStyle = 'rgba(' + (rnd() > 0.5 ? '190,190,190' : '70,70,70') + ',0.16)'; const x = rnd() * S, y = rnd() * S, a = rnd() * 6.3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9); g.stroke(); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 7); return t; }
  function buildRoom() {
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    // a very plain studio for reflections: one warm window of light, the rest near black
    const env = new THREE.Scene(); env.background = new THREE.Color(0x050608); const card = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.3, 3.4), side: THREE.DoubleSide })); card.position.set(-5, 6, -4); card.lookAt(0, 0, 0); env.add(card); const c2 = new THREE.Mesh(new THREE.PlaneGeometry(9, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.45, 0.6), side: THREE.DoubleSide })); c2.position.set(8, 3, 5); c2.lookAt(0, 0, 0); env.add(c2);
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(env, 0.03).texture; scene.environmentIntensity = 0.6; pm.dispose();
    const tx = deskTextures(); const desk = new THREE.Mesh(new THREE.PlaneGeometry(34, 34).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tx.map, bumpMap: tx.bump, bumpScale: 0.35, roughness: 0.74, metalness: 0, envMapIntensity: 0.35, dithering: true })); desk.position.y = -0.012; desk.rotation.y = 0.22; desk.receiveShadow = true; scene.add(desk);
    lamp = new THREE.SpotLight(0xffe2bd, 0, 26, 0.58, 0.95, 1.6); lamp.position.set(-3.6, 7.4, -3.4); lamp.target.position.set(0.45, 0, 0.1); lamp.castShadow = true; lamp.shadow.mapSize.set(2048, 2048); lamp.shadow.camera.near = 3; lamp.shadow.camera.far = 16; lamp.shadow.bias = -0.0005; lamp.shadow.normalBias = 0.012; lamp.shadow.radius = 5; scene.add(lamp, lamp.target);
    scene.add(new THREE.HemisphereLight(0x6c83a3, 0x3a2b1e, 0.36));
    const rim = new THREE.DirectionalLight(0x86a7d8, 0.16); rim.position.set(6, 3, 5); scene.add(rim);
    // the pencil
    const prof = [[0, 0], [0.006, 0.004], [0.012, 0.04], [0.016, 0.05], [0.034, 0.2], [0.04, 0.22], [0.04, 0.6], [0.0425, 0.605], [0.0425, 1.18], [0.04, 1.19], [0.04, 1.36], [0.034, 1.37], [0.034, 1.45], [0.028, 1.47], [0, 1.47]].map((p) => new THREE.Vector2(p[0], p[1]));
    const pen = new THREE.Group(), steel = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, metalness: 1, roughness: 0.28 }), black = new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.3, roughness: 0.42 });
    const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), black); pen.add(body); const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.015, 0.152, 32), steel); tip.position.y = 0.125; pen.add(tip);
    for (let i = 0; i < 15; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0412, 0.0028, 8, 32).rotateX(Math.PI / 2), steel); ring.position.y = 0.25 + i * 0.021; pen.add(ring); }
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 0.007), steel); clip.position.set(0, 1.14, 0.056); pen.add(clip); const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 24), steel); btn.position.y = 1.5; pen.add(btn);
    pen.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); pen.rotation.set(Math.PI / 2, 0, 0.5); pen.position.set(2.62, 0.046, 0.1); pen.rotation.order = 'YXZ'; pen.rotation.set(Math.PI / 2, 0.42, 0); scene.add(pen);
    // the scale ruler
    const rc = document.createElement('canvas'); rc.width = 2048; rc.height = 160; const g = rc.getContext('2d'); g.fillStyle = '#8f969d'; g.fillRect(0, 0, 2048, 160); const rnd = rngOf(3); for (let i = 0; i < 1800; i++) { g.fillStyle = 'rgba(' + (rnd() > 0.5 ? '255,255,255' : '0,0,0') + ',0.035)'; g.fillRect(0, rnd() * 160, 2048, 1); }
    g.fillStyle = '#14171a'; g.font = '500 30px "Instrument Sans", sans-serif'; for (let m = 0; m <= 200; m++) { const x = 24 + m * 10, l = m % 10 ? (m % 5 ? 26 : 40) : 58; g.fillRect(x, 0, 2, l); if (m % 10 === 0) g.fillText(String(m / 10), x + 6, 88); } g.font = '500 24px "Instrument Sans", sans-serif'; g.fillText('cm', 1960, 140);
    const rt = new THREE.CanvasTexture(rc); rt.colorSpace = THREE.SRGBColorSpace; rt.anisotropy = 8; const side = new THREE.MeshStandardMaterial({ color: 0x8f969d, metalness: 0.95, roughness: 0.35 }); const face = new THREE.MeshStandardMaterial({ map: rt, metalness: 0.9, roughness: 0.36 });
    const ruler = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.012, 0.16), [side, side, face, side, side, side]); ruler.position.set(2.75, 0.0, 1.28); ruler.rotation.y = -0.16; ruler.castShadow = ruler.receiveShadow = true; scene.add(ruler);
    // dust in the lamp's light
    const n = 150, P = new Float32Array(n * 3), A = new Float32Array(n), r2 = rngOf(29); for (let i = 0; i < n; i++) { P[i * 3] = (r2() - 0.5) * 9; P[i * 3 + 1] = r2() * 3.2; P[i * 3 + 2] = (r2() - 0.5) * 6; A[i] = r2(); } const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(P, 3)); mg.setAttribute('aS', new THREE.BufferAttribute(A, 1));
    motes = new THREE.Points(mg, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 }, uPx: { value: 1 }, uK: { value: 0 } }, vertexShader: 'attribute float aS; uniform float uT,uPx; varying float vA; void main(){ vec3 p=position; p.x+=sin(uT*.11+aS*40.)*.35; p.y=mod(p.y+uT*.018*(.4+aS),3.2); p.z+=cos(uT*.09+aS*70.)*.3; vec4 m=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*m; gl_PointSize=uPx*(1.+aS*aS*3.4)*(6./-m.z); vA=(.05+.10*aS)*smoothstep(5.,1.,length(p.xz+vec2(1.2,1.2)))*smoothstep(0.,.5,p.y); }', fragmentShader: 'varying float vA; uniform float uK; void main(){ float r=length(gl_PointCoord*2.-1.); gl_FragColor=vec4(vec3(1.,.88,.72)*vA*uK*smoothstep(1.,.0,r),1.); }' })); motes.frustumCulled = false; scene.add(motes);
  }

  // ---------- paper ----------
  const bump = { t: null };
  function pageMat(tex, side, order) {
    const m = new THREE.MeshStandardMaterial({ map: tex, bumpMap: bump.t, bumpScale: 0.22, roughness: 0.94, metalness: 0, envMapIntensity: 0.25, side, dithering: true });
    m.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb=pow(diffuseColor.rgb,vec3(1.7));'); };
    if (order) { m.onBeforeCompile = (s) => { s.uniforms.uInk = uInk; s.uniforms.uOrd = { value: order }; s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uOrd; uniform float uInk;').replace('#include <map_fragment>', '#include <map_fragment>\n float io=texture2D(uOrd,vMapUv).r; float rv=1.-smoothstep(uInk-.012,uInk+.004,io); float wet=smoothstep(.07,.0,uInk-io)*rv; vec3 pap=vec3(.982,.982,.965); diffuseColor.rgb=mix(pap,diffuseColor.rgb*(1.-.22*wet),rv); diffuseColor.rgb=pow(diffuseColor.rgb,vec3(1.7));'); }; m.customProgramCacheKey = () => 'ink'; }
    return m;
  }
  const texOf = (cv, srgb = true) => { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  function makeLeaf(i) {
    const geo = new THREE.PlaneGeometry(PW, PH, SEG, 1), back = geo.clone(); back.deleteAttribute('position'); back.deleteAttribute('normal'); back.setAttribute('position', geo.attributes.position); back.setAttribute('normal', geo.attributes.normal);
    const uv = back.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, 1 - uv.getX(k));
    const front = new THREE.Mesh(geo, null), bk = new THREE.Mesh(back, null); for (const m of [front, bk]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; scene.add(m); }
    return { i, geo, front, bk, a: 0, want: 0, delay: 0, dirty: true, texs: [] };
  }
  const cx = new Float32Array(SEG + 1), cy = new Float32Array(SEG + 1), cn = new Float32Array(SEG + 1);
  function shape(L) {
    const k = ease(L.a), th = k * Math.PI, bend = Math.sin(th) * 1.05 * (L.want > L.a || (L.want === 1 && L.a < 1) ? 1 : L.want === 0 && L.a < 1 ? -1 : 1), ds = PW / SEG, rest = Math.cos(th);
    const hR = (N - L.i) * THICK, hL = (L.i + 1) * THICK, h0 = hR + (hL - hR) * k, air = Math.abs(Math.sin(th)); let x = 0, y = 0;
    for (let j = 0; j <= SEG; j++) {
      const s = j * ds, u = s / PW, gut = (0.30 * Math.exp(-s / 0.13) - 0.0165) * (1 - air * 0.6), phi = th + rest * gut - bend * (u - 0.35) * (1.35 - 0.35 * u) * (0.75 + 0.25 * air);
      if (j) { x += Math.cos(phi) * ds; y += Math.sin(phi) * ds; } cx[j] = x; cy[j] = y; cn[j] = phi;
    }
    const p = L.geo.attributes.position.array, n = L.geo.attributes.normal.array;
    for (let r = 0; r < 2; r++) for (let j = 0; j <= SEG; j++) { const q = (r * (SEG + 1) + j) * 3; p[q] = cx[j]; p[q + 1] = Math.max(h0 + cy[j], 0.004 + L.i * 0.0006); p[q + 2] = r ? PH / 2 : -PH / 2; n[q] = -Math.sin(cn[j]); n[q + 1] = Math.cos(cn[j]); n[q + 2] = 0; }
    L.geo.attributes.position.needsUpdate = true; L.geo.attributes.normal.needsUpdate = true; shadowsDirty = Math.max(shadowsDirty, 1);
  }
  // Show a report: sheets are live DOM sheets; every page becomes a texture, one per frame so nothing stutters.
  let job = 0, waiting = true, bt0 = null;
  const blankTex = () => { if (!bt0) { const c = document.createElement('canvas'); c.width = c.height = 4; const g = c.getContext('2d'); g.fillStyle = '#fdfdfb'; g.fillRect(0, 0, 4, 4); bt0 = texOf(c); } return bt0; };
  const blankBook = (n) => { for (const L of leaves) scene.remove(L.front, L.bk); N = n; leaves = []; for (let i = 0; i < n; i++) { const L = makeLeaf(i); L.front.material = pageMat(blankTex(), THREE.FrontSide); L.bk.material = pageMat(blankTex(), THREE.BackSide); shape(L); leaves.push(L); } turned = 0; };
  async function setReport(sheets, report, { fontCss, paperCss, press, live }) {
    const my = ++job; R = report; simTag.textContent = live ? 'Simulated exercise, your run' : 'Simulated exercise, complete run';
    const css = fontCss + paperCss, plan = sheets.findIndex((s) => s.querySelector('[data-sec="sA"]')), mark = sheets.findIndex((s) => s.querySelector('[data-sec="sB"]'));
    const words = ['No one', 'One person', 'Two people', 'Three people', 'Four people', 'Five people'], np = report.people.length;
    title.textContent = (words[np] || np + ' people') + ', on paper.';
    const order = inkOrder(sheets[plan], press); const list = []; const tex = [];
    const nLeaf = Math.ceil(sheets.length / 2); if (N !== nLeaf) blankBook(nLeaf);
    markLeaf = Math.max(1, Math.ceil(mark / 2));
    const bt = blankTex();
    for (const L of leaves) { if (!L.front.material.map) { L.front.material = pageMat(bt, THREE.FrontSide); L.bk.material = pageMat(bt, THREE.BackSide); } }
    const seq = [0, plan, ...sheets.keys()].filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
    for (const i of seq) {
      const cv = await rasterSheet(sheets[i], css, 1.75); if (my !== job) return; tex[i] = texOf(cv); renderer.initTexture(tex[i]);
      const L = leaves[i >> 1], mesh = i % 2 ? L.bk : L.front, ot = i === plan ? texOf(order, false) : null; if (ot) { ot.minFilter = THREE.LinearFilter; ot.generateMipmaps = false; }
      const oldM = mesh.material; mesh.material = pageMat(tex[i], i % 2 ? THREE.BackSide : THREE.FrontSide, ot); if (oldM && oldM.map && oldM.map !== bt) { oldM.map.dispose(); } oldM?.dispose();
      list.push(i); if (list.length === 2) { begin(); } await new Promise((r) => setTimeout(r, 24));
    }
    const figure = (v, l, hot) => h('div' + (hot ? '.rh-warm' : ''), null, h('b', null, v), h('span', null, l)); const S = report;
    figs.replaceChildren(figure(String(np), np === 1 ? 'person found' : 'people found', true), figure(String(sheets.length), 'pages'), ...(S.route?.length ? [figure(Math.round(S.route.length) + ' m', 'way in')] : []));
    const opts = [['Cover', 0, 'cover'], ['Plan and people', 1, 'spread'], ['Marking', markLeaf, 'mark'], ['Test results', N - 1, 'last']];
    steps.replaceChildren(...opts.map(([l, n, s]) => h('button.rh-step', { type: 'button', 'data-n': n, 'data-s': s, onclick: () => { manual(); go(n, s); if (s === 'spread') inkWant = 1; cap.textContent = CAPS[s]; if (reducedMotion()) { for (const L of leaves) { L.a = L.want; shape(L); } ink = 1; cameraTo(true); render(); } } }, l)), prev, next);
    markStep();
  }
  function begin() { if (!waiting) return; waiting = false; ready = true; for (const L of leaves) shape(L); shadowsDirty = 4; restart(); if (reducedMotion()) { still(); } else kick(); }
  function still() { film = 12; go(1, 'spread'); for (const L of leaves) { L.a = L.want; L.delay = 0; shape(L); } ink = inkWant = 1; lampK = 1; cameraTo(true); render(); }
  function restart() { film = 0; fi = -1; auto = true; ink = 0; inkWant = 0; }
  function manual() { auto = false; idle = 0; }
  function go(n, s) {
    n = clamp(n, 0, N - 1); const from = turned; turned = n; let d = 0; if (n > from) for (let i = from; i < n; i++) { leaves[i].want = 1; leaves[i].delay = d; d += 0.2; } else for (let i = from - 1; i >= n; i--) { leaves[i].want = 0; leaves[i].delay = d; d += 0.16; }
    shot = s || (n === 0 ? 'cover' : 'spread'); figs.classList.toggle('is-off', shot === 'plan' || shot === 'mark'); markStep(); kick();
  }
  function turnBy(k) { manual(); inkWant = 1; go(turned + k, null); cap.textContent = 'Page ' + (turned ? turned * 2 + ' and ' + (turned * 2 + 1) : 1) + ' of ' + (N * 2) + '.'; if (reducedMotion()) { for (const L of leaves) { L.a = L.want; shape(L); } ink = 1; cameraTo(true); render(); } }
  function markStep() { steps.querySelectorAll('.rh-step').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.n === turned))); }

  function cameraTo(snap, dt = 0) {
    const s = SHOTS[shot], asp = hw / hh, d = s[2] * (asp < 1.75 ? 1.07 : 1), y = s[4] + yaw + Math.sin(time * 0.13) * 0.035, p = clamp(s[3] + pit + Math.sin(time * 0.1) * 0.012, 0.45, 1.45);
    wt.set(s[0], 0.02, s[1]); wp.set(s[0] + Math.sin(y) * Math.cos(p) * d, Math.sin(p) * d, s[1] + Math.cos(y) * Math.cos(p) * d);
    const a = snap ? 1 : 1 - Math.exp(-dt * 1.15); pos.lerp(wp, a); tgt.lerp(wt, a); camera.position.copy(pos); camera.lookAt(tgt);
  }
  function render() { uInk.value = ink * 1.02; lamp.intensity = 118 * lampK; motes.material.uniforms.uT.value = time; motes.material.uniforms.uK.value = lampK; if (shadowsDirty > 0) { renderer.shadowMap.needsUpdate = true; shadowsDirty--; } renderer.render(scene, camera); }
  function frame(ts) {
    raf = 0; if (!visible || !ready) return; const raw = Math.min(0.1, (ts - last) / 1000 || 0.016), dt = Math.min(raw, 0.04); last = ts; time += dt; lampK += (1 - lampK) * (1 - Math.exp(-dt * 1.6));
    if (auto) {
      if (!waiting) film += dt; if (!waiting) for (let i = FILM.length - 1; i >= 0; i--) if (film >= FILM[i].t) { if (i !== fi) { fi = i; const f = FILM[i]; if (f.end) { restart(); } else { const n = f.turned === 'mark' ? markLeaf : f.turned === 'last' ? N - 1 : f.turned; go(n, f.shot); cap.textContent = f.cap; if (f.t < 1) { ink = 0; inkWant = 0; } if (f.shot === 'plan') inkWant = 1; } } break; }
    } else { idle += dt; if (idle > 24 && !drag) restart(); }
    ink += clamp(inkWant - ink, 0, dt / 8.2);
    for (const L of leaves) { if (L.a === L.want) continue; if (L.delay > 0) { L.delay -= dt; continue; } const v = dt / 1.55; L.a = L.want > L.a ? Math.min(1, L.a + v) : Math.max(0, L.a - v); shape(L); }
    yaw += (yawW - yaw) * (1 - Math.exp(-dt * 6)); pit += (pitW - pit) * (1 - Math.exp(-dt * 6)); if (!drag) { yawW *= Math.exp(-dt * 0.35); pitW *= Math.exp(-dt * 0.35); }
    cameraTo(false, dt); render();
    slow = slow * 0.95 + (raw > 0.0215 ? 0.05 : 0); if (slow > 0.4 && dpr > 0.85) { dpr = Math.max(0.85, dpr * 0.87); slow = 0; resize(); }
    kick();
  }
  const kick = () => { if (!raf && visible && ready && !reducedMotion()) raf = requestAnimationFrame(frame); };
  function resize() { if (!renderer) return; hw = host.clientWidth || 1; hh = host.clientHeight || 1; renderer.setPixelRatio(dpr); renderer.setSize(hw, hh, false); camera.aspect = hw / hh; camera.setViewOffset(hw, hh, -hw * 0.06, hh * 0.0, hw, hh); camera.updateProjectionMatrix(); motes.material.uniforms.uPx.value = dpr; }
  function init() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); renderer.setClearColor(0x050607); dpr = Math.min(window.devicePixelRatio || 1, 2); scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x050607, 8, 19); camera = new THREE.PerspectiveCamera(28, 1.8, 0.2, 60); bump.t = fibre(); buildRoom(); resize(); blankBook(6); cameraTo(true); lampK = 0.25; pos.multiplyScalar(1.12); ready = true; shadowsDirty = 4; render();
  }

  // ---------- hands ----------
  let px = 0, py = 0; const ray = new THREE.Raycaster(), v2 = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  canvas.addEventListener('pointerdown', (e) => { drag = true; moved = 0; px = e.clientX; py = e.clientY; try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ } });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - px, dy = e.clientY - py; moved += Math.abs(dx) + Math.abs(dy); px = e.clientX; py = e.clientY; yawW = clamp(yawW - dx * 0.004, -0.7, 0.7); pitW = clamp(pitW + dy * 0.003, -0.45, 0.3); if (reducedMotion() && ready) { yaw = yawW; pit = pitW; cameraTo(true); render(); } });
  canvas.addEventListener('pointerup', (e) => { drag = false; if (moved > 6 || !ready) return; const b = canvas.getBoundingClientRect(); v2.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1); ray.setFromCamera(v2, camera); if (ray.ray.intersectPlane(plane, hit) && Math.abs(hit.z) < PH / 2 + 0.1 && Math.abs(hit.x) < PW + 0.1) turnBy(hit.x > 0 ? 1 : -1); });
  canvas.addEventListener('pointercancel', () => { drag = false; });
  new ResizeObserver(() => { if (renderer && host.clientWidth) { resize(); if (ready && !raf) { cameraTo(true); render(); } } }).observe(host);

  return {
    // build() is asked for the sheets the first time the hero is shown, and again when the run behind it changes
    async show(build) {
      visible = true;
      if (!begun) { begun = true; try { init(); } catch (e) { console.warn('[report hero]', e); host.classList.add('is-failed'); return false; } }
      last = performance.now(); resize(); if (ready) (reducedMotion() ? render() : kick());
      try { const b = await build(); if (b) await setReport(b.sheets, b.report, b); } catch (e) { console.warn('[report hero]', e); host.classList.add('is-failed'); return false; }
      return true;
    },
    hide() { visible = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    get state() { return { ready, film, turned, shot, ink, dpr, N, auto }; }, go(n, s) { manual(); go(n, s); },
  };
}
