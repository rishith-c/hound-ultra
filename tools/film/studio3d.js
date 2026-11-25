// Film pages: the drone taken apart in the rover's studio, and side views of both machines for the wave pictures.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createStudio } from '../../app/workspaces/rover/studio.js';
const q = new URLSearchParams(location.search), mode = q.get('m') || 'drone', FAST = q.get('v') === '2', host = document.getElementById('s');
const ss = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * x * (x * (x * 6 - 15) + 10); };
const base = new URL('../../app/twin/actors/', import.meta.url).href;
async function airframe() { // the site's own model, with its parts kept apart
  let s = await (await fetch(base + 'drone.js')).text();
  s = s.replace(/from '(\.[^']+)'/g, (m, p) => `from '${new URL(p, base + 'drone.js').href}'`).replace(/import\('(\.[^']+)'\)/g, (m, p) => `import('${new URL(p, base + 'drone.js').href}')`).replaceAll('import.meta.url', JSON.stringify(base + 'drone.js'));
  s = s.replace('body.push(prep(g, m))', '{ const G = prep(g, m); G.part = add.now; body.push(G); }').replace('hd = (m, g) => head.push(prep(g, m));', "hd = (m, g) => head.push(prep(g, m)); add.now = 'plate';");
  for (const [k, n] of [['// battery in its tray', 'battery'], ['// GPS puck', 'gps'], ['// forward obstacle cameras', 'eyes'], ['// skids', 'skids'], ['// gimbal: damped', 'gimbal']]) s = s.replace(k, `add.now = '${n}';\n  ${k}`);
  s = s.replace('tips.push([tx, tz]);', "tips.push([tx, tz]); add.now = 'arm' + deg;").replace('return { body: mergeGeometries(body)', 'return { list: body, heads: head, body: mergeGeometries(body)');
  return import(URL.createObjectURL(new Blob([s], { type: 'text/javascript' })));
}
function pcb() { // flight computer: a board with its chips, on four posts
  const g = new THREE.Group(), M = (c, r, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }), box = (w, h, d, x, y, z, mat) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; g.add(b); return b; };
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'); x.fillStyle = '#0c1a16'; x.fillRect(0, 0, 512, 512); let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  x.strokeStyle = '#1f4035'; x.lineWidth = 3; for (let k = 0; k < 90; k++) { let px = r() * 512, py = r() * 512; x.beginPath(); x.moveTo(px, py); for (let j = 0; j < 4; j++) { const a = Math.round(r() * 8) * Math.PI / 4, l = 20 + r() * 70; px += Math.cos(a) * l; py += Math.sin(a) * l; x.lineTo(px, py); } x.stroke(); }
  for (let k = 0; k < 130; k++) { x.fillStyle = r() > .4 ? '#c8b27a' : '#7c8580'; x.fillRect(r() * 500, r() * 500, 4 + r() * 10, 4 + r() * 6); } x.fillStyle = '#d6d9dc'; for (let k = 0; k < 24; k++) x.fillRect(r() * 480, r() * 490, 12 + r() * 26, 2.5);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; const top = new THREE.MeshStandardMaterial({ map: t, roughness: .42, metalness: .15 });
  box(.074, .0016, .074, 0, 0, 0, top); const chip = M(0x0b0c0e, .38), can = M(0xb9bec4, .3, .85), gold = M(0xcaa65a, .3, .9), conn = M(0xd9d4c6, .5);
  box(.017, .0024, .017, -.004, .002, .002, chip); box(.011, .002, .011, .02, .0018, -.016, chip); box(.009, .0034, .007, -.022, .0025, -.02, can); box(.014, .004, .012, .02, .0028, .02, can); box(.007, .0016, .005, -.024, .0016, .012, chip);
  for (let k = 0; k < 7; k++) { box(.0055, .0052, .0085, -.030 + k * .010, .0034, .0325, conn); box(.0055, .0052, .0085, -.030 + k * .010, .0034, -.0325, k % 2 ? conn : chip); }
  for (let k = 0; k < 26; k++) box(.0018, .0012, .001, (r() - .5) * .058, .0014, (r() - .5) * .046, k % 3 ? gold : can);
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.0026, .0026, .012, 18), gold); p.position.set(a * .0325, -.0065, b * .0325); g.add(p); }
  return g;
}
async function drone() {
  const D = await airframe(), A = D.buildAirframe(THREE, false), mat = D.frameMaterial(THREE), o0 = mat.onBeforeCompile; mat.envMapIntensity = 1.55;
  mat.onBeforeCompile = (s) => { o0(s); s.fragmentShader = s.fragmentShader.replace('totalEmissiveRadiance += (', 'totalEmissiveRadiance += 0.05 * (').replace('* 170.0;', '* 620.0;'); }; mat.customProgramCacheKey = () => 'drone-film';
  const G = new THREE.Group(), P = {}, part = (n) => P[n] || (P[n] = (() => { const g = new THREE.Group(); G.add(g); return g; })()), c = new THREE.Vector3();
  for (const g of A.list) {
    g.computeBoundingBox(); g.boundingBox.getCenter(c); let n = g.part;
    if (n === 'plate' && c.y > .117) n = 'shell';
    if (n === 'gps' && Math.abs(c.z) > .02) n = 'antennas';
    if (n.startsWith('arm')) { const a = +n.slice(3) * Math.PI / 180, r = Math.hypot(c.x - Math.cos(a) * D.ARM_R, c.z - Math.sin(a) * D.ARM_R); if (r < .03 && c.y > D.PROP_Y - .012) n = 'prop' + n.slice(3); else if (r < .03 && c.y > D.ARM_Y + .009) n = 'motor' + n.slice(3); }
    const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; part(n).add(m);
  }
  for (const g of A.heads) { const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; part('head').add(m); }
  let bl = D.bladeGeometry(THREE); bl.deleteAttribute('normal'); bl = mergeVertices(bl, 1e-5); bl.computeVertexNormals(); const bm = new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: .38, metalness: .1, side: THREE.DoubleSide }), spin = [];
  A.tips.forEach(([x, z], k) => { const deg = [45, 135, 225, 315][k], s = new THREE.Group(); s.position.set(x, D.PROP_Y + .002, z); const m = new THREE.Mesh(bl, bm); m.castShadow = true; if (k % 2) s.scale.z = -1; s.add(m); part('prop' + deg).add(s); spin.push([s, k % 2 ? -1 : 1]); });
  const fc = pcb(); fc.position.set(-.006, .1215, 0); part('fc').add(fc);
  part('head').position.set(.07, .066, 0); const home = {}; for (const k in P) home[k] = P[k].position.clone();
  const off = { plate: [0, 0, 0], fc: [0, .058, 0], shell: [0, .128, 0], battery: [0, .188, 0], gps: [-.12, .17, 0], antennas: [-.10, .135, 0], eyes: [.14, .012, 0], skids: [0, -.095, 0], gimbal: [.085, -.05, 0], head: [.13, -.085, 0] };
  for (const d of [45, 135, 225, 315]) { const a = d * Math.PI / 180, r = .10; off['arm' + d] = [Math.cos(a) * r, 0, Math.sin(a) * r]; off['motor' + d] = [Math.cos(a) * r, .045, Math.sin(a) * r]; off['prop' + d] = [Math.cos(a) * r, .115, Math.sin(a) * r]; }
  const win = (n) => /prop|motor|arm/.test(n) ? [2.55, 4.0] : /fc|shell|battery|gps|antennas/.test(n) ? [3.5, 5.4] : [5.2, 7.0];
  function open(t) { for (const k in P) { const [a, b] = win(k), u = Math.min(1, Math.max(0, (t - .08 - (/prop|motor|arm/.test(k) ? 0 : .07)) / .95)), e = FAST ? 1 - (1 - u) ** 4.4 + .035 * Math.max(0, t - .5) : ss(a, b, t), o = off[k] || [0, 0, 0]; P[k].position.set(home[k].x + o[0] * e, home[k].y + o[1] * e, home[k].z + o[2] * e); } }
  return { G, P, open, spin };
}
if (mode === 'sprite') {
  document.body.classList.add('sprite');
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); r.setPixelRatio(+(q.get('r') || 2)); r.setSize(innerWidth, innerHeight); r.setClearColor(q.get('bg') ? '#' + q.get('bg') : 0, q.get('bg') ? 1 : 0); r.toneMapping = THREE.ACESFilmicToneMapping; host.append(r.domElement);
  const sc = new THREE.Scene(), pm = new THREE.PMREMGenerator(r), es = new THREE.Scene(), add = (w, h, p, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(...p); m.lookAt(0, 0, 0); es.add(m); };
  es.add(new THREE.Mesh(new THREE.SphereGeometry(20, 24, 12), new THREE.MeshBasicMaterial({ color: 0x14181d, side: THREE.BackSide }))); add(9, 1.2, [0, 6, 1], 14); add(2, 6, [-6, 1, -2], 8); add(2, 6, [6, 2, 2], 4); add(6, 3, [0, 2, 8], 1.4); sc.environment = pm.fromScene(es, .02).texture;
  const k = new THREE.DirectionalLight(0xfff2e4, 2.4); k.position.set(-1.5, 3, 2.2); sc.add(k); const b = new THREE.DirectionalLight(0xc8dcff, 2.2); b.position.set(2, 1.5, -2); sc.add(b);
  let o; if (q.get('o') === 'drone') { o = (await drone()).G; o.rotation.y = +(q.get('yaw') || .5); } else { const { buildRover } = await import('../../app/workspaces/rover/rover.js'); const R = await buildRover(); o = new THREE.Group(); o.add(R.root); o.rotation.y = +(q.get('yaw') || -.35); }
  sc.add(o); const H = +(q.get('h') || .6), W = H * innerWidth / innerHeight, cam = new THREE.OrthographicCamera(-W / 2, W / 2, H - .02, -.02, -5, 5); cam.position.set(0, 0, 2); if (q.get('tilt')) { cam.position.set(0, +q.get('tilt'), 2); cam.lookAt(0, 0, 0); }
  r.render(sc, cam); setTimeout(() => { r.render(sc, cam); window.READY = 1; }, 1500);
} else {
  const st = createStudio(host), { scene, camera } = st; st.resize(); const X = await drone(); X.G.position.y = .20; scene.add(X.G); st.key.shadow.normalBias = .0045; st.key.intensity = 15; scene.environmentIntensity = 1.0; { const f = new THREE.DirectionalLight(0xfff3e6, .55); f.position.set(2.2, 1.4, 1.2); scene.add(f); const g = new THREE.DirectionalLight(0xcfe0ff, 1.5); g.position.set(-1.6, 1.0, -1.8); scene.add(g); }
  st.floorU.uWheel.value.forEach((v) => { v.z = 9; }); st.floorU.uBody.value.z = 9;
  const LB = FAST ? [['Wi-Fi', .50, () => X.P.antennas, [-.085, .165, .03], [-.13, .03]], ['Laser', .86, () => X.P.head, [.008, -.028, 0], [.17, -.053]], ['Heat camera', .74, () => X.P.head, [.028, -.004, -.012], [.17, .106]], ['Color camera', .62, () => X.P.head, [.0255, -.0227, .014], [.19, .044]]] : [['Four rotors', 3.22, () => X.P.prop315, [.2, .19, -.2], [.10, .035]], ['Flight computer', 4.28, () => X.P.fc, [.03, .122, .03], [.045, .02]], ['Battery', 5.42, () => X.P.battery, [.03, .168, .02], [.13, .025]], ['Four senses', 6.4, () => X.P.head, [.02, -.01, .02], [.15, -.04]]];
  const L = document.getElementById('l'), V = document.getElementById('v'), NS = 'http://www.w3.org/2000/svg'; for (const l of LB) { l.d = document.createElement('div'); l.d.className = 'lb'; l.d.textContent = l[0]; L.append(l.d); l.n = document.createElementNS(NS, 'line'); l.c = document.createElementNS(NS, 'circle'); V.append(l.n, l.c); l.n.style.opacity = l.c.style.opacity = 0; }
  let t0 = performance.now(), run = false; const v = new THREE.Vector3();
  const K = FAST ? [[0, [.66, .47, .56], [.05, .30, 0], 21], [.75, [1.02, .60, .88], [.045, .338, 0], 24.6], [2.8, [1.10, .56, .78], [.055, .332, 0], 23.4]] : [[0, [.60, .52, .40], [.17, .375, -.04], 20], [2.5, [.92, .55, .82], [.0, .325, 0], 23.5], [5.2, [1.08, .66, .94], [.02, .352, 0], 25], [9, [1.16, .58, .78], [.035, .338, 0], 24.8]];
  function cam(t) { let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++; const a = K[i], b = K[i + 1], d = b[0] - a[0], u = Math.min(1, Math.max(0, (t - a[0]) / d)), z = K[i - 1], w = K[i + 2], f = (g) => { const p0 = g(a), p1 = g(b), m0 = z ? (p1 - g(z)) / (b[0] - z[0]) * d : (p1 - p0) * .9, m1 = w ? (g(w) - p0) / (w[0] - a[0]) * d : (p1 - p0) * .3, u2 = u * u, u3 = u2 * u; return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (3 * u2 - 2 * u3) * p1 + (u3 - u2) * m1; };
    camera.position.set(f((k) => k[1][0]), f((k) => k[1][1]), f((k) => k[1][2])); camera.lookAt(f((k) => k[2][0]), f((k) => k[2][1]), f((k) => k[2][2])); camera.fov = f((k) => k[3]); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
  function draw(t) {
    if (FAST) t -= .22;
    X.open(t); X.G.position.y = .20 + Math.sin(t * 1.1) * .004; X.G.rotation.y = .35 + t * .055; const w = FAST ? 9 * (1 - Math.exp(-t * 1.1)) : t < 2.2 ? 4.2 * t - .95 * t * t : 4.2 * 2.2 - .95 * 4.84; for (const [s, d] of X.spin) s.rotation.y = d * (1.2 + w * 1.4);
    st.stripAt(-1.3 + t * (FAST ? .8 : .30), 1.12, -.5); cam(t); st.render();
    for (const l of LB) { const e = ss(l[1], l[1] + (FAST ? .30 : .45), t); v.set(...l[3]); l[2]().updateWorldMatrix(true, false); v.applyMatrix4(l[2]().matrixWorld).project(camera); const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight, x2 = x + l[4][0] * innerWidth * .7 * (.3 + .7 * e), y2 = y - l[4][1] * innerHeight;
      l.n.setAttribute('x1', x); l.n.setAttribute('y1', y); l.n.setAttribute('x2', x2); l.n.setAttribute('y2', y2); l.c.setAttribute('cx', x); l.c.setAttribute('cy', y); l.c.setAttribute('r', 3.2); l.n.style.opacity = l.c.style.opacity = e; l.d.style.opacity = e; l.d.style.transform = l[4][0] < 0 ? `translate(${x2 - 10}px,${y2}px) translate(-100%,-50%)` : `translate(${x2 + 10}px,${y2}px) translateY(-50%)`; }
  }
  window.PARTS = { start() { t0 = performance.now(); run = true; return 1; } };
  (function loop() { requestAnimationFrame(loop); if (run) draw((performance.now() - t0) / 1000); })(); draw(0); await document.fonts.load('500 24px HSans'); window.READY = 1;
}
