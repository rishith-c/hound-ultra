// Film page: the 51 moving channels fold flat into one picture, then the camera flies through the real network as it reads that picture.
import { loadNN } from '../../app/core/nn.js';
import { compile } from '../../app/workspaces/sense/fastnet.js';
const base = new URL('../../app/workspaces/sense/anatomy.js', import.meta.url).href, host = document.getElementById('s');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), ss = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); };
let s = await (await fetch(base)).text();
s = s.replace(/from '(\.[^']+)'/g, (m, p) => `from '${new URL(p, base).href}'`).replace('    function render(dt) {', '    globalThis.__ANA = { THREE, scene, camera, controls, meshes, heights, shown, P, STAGES, DZ, renderer, composer, bloom, ground, grid, key, rim, pillars, plates, kern, pathRects, tubes, slabMat, VEC, vz, X };\n    function render(dt) { if (globalThis.__ANA.film) { globalThis.__ANA.film(); composer.render(); return; }')
  .replace('m.receiveShadow = true; m.castShadow = true; scene.add(m);\n      const e =', 'm.receiveShadow = true; m.castShadow = true; scene.add(m); m.userData.slab = k;\n      const e =').replace('e.position.copy(m.position); scene.add(e);', 'e.position.copy(m.position); scene.add(e); e.userData.slab = k;');
const { createAnatomy, inputScale } = await import(URL.createObjectURL(new Blob([s], { type: 'text/javascript' })));
const h = (sel, props, ...kids) => { const [tag, ...cls] = sel.split('.'), e = document.createElement(tag || 'div'); e.className = cls.join(' '); for (const k in props || {}) if (k !== 'hidden') e.setAttribute(k, props[k]); else if (props[k]) e.hidden = true; e.append(...kids.filter((x) => x != null)); return e; };
const nn = await loadNN(), net = compile(nn.weights), x = (await (await fetch('mywalk.json')).json()).x, out = net.forward(x, true), RG = await (await fetch('ridge51.json')).json();
await Promise.all(['400 60px HSerif', '500 24px HSans'].map((f) => document.fonts.load(f)));
const api = await createAnatomy(host, { kit: { h, reducedMotion: () => true } }); const sc = inputScale(x);
api.setData({ x, out, threshold: .5, weights: nn.weights, scale: sc }); api.setStage(0);
const A = globalThis.__ANA, { THREE, scene, camera, meshes, heights, P, STAGES } = A;
// ---- silver, and amber where it is strong
const ramp = (st) => { const c = st.map(([u, v]) => [u, new THREE.Color(v)]); return (n, o) => { n = clamp(n, 0, 1); let k = 1; while (k < c.length - 1 && c[k][0] < n) k++; const [a, p] = c[k - 1], [b, q] = c[k]; return o.copy(p).lerp(q, (n - a) / (b - a)); }; };
const HEAT = ramp([[0, '#060709'], [.25, '#12161a'], [.55, '#3c444c'], [.8, '#8d979f'], [.9, '#c9a976'], [1, '#ff9d2e']]), UP = ramp([[0, '#090b0d'], [.4, '#353c43'], [.75, '#a9b2ba'], [.9, '#d9b983'], [1, '#ff9d2e']]), DN = ramp([[0, '#090b0d'], [.4, '#1a2026'], [.8, '#47525c'], [1, '#75828d']]);
const col = new THREE.Color(), C0 = meshes.map((m, k) => { if (!m) return null; const a = new Float32Array(m.count * 3), st = STAGES[k], rows = k === 0 ? x : k < 6 ? out.layers[st.id] : null, vals = k === 6 ? out.layers.feat : k === 7 ? out.layers.hidden : null;
  let max = 1e-9; if (k && rows) for (const r of rows) for (const q of r) max = Math.max(max, q); if (vals) max = Math.max(...vals); let ms = 1; if (k === 0) for (const q of x[51]) ms = Math.max(ms, Math.abs(q));
  for (let i = 0; i < m.count; i++) { if (k === 0) { const r = Math.floor(i / 200), n = clamp(x[r][i % 200] / (r === 51 ? ms : sc), -1, 1); (n < 0 ? DN : UP)(Math.pow(Math.abs(n), .85), col); } else { const q = rows ? rows[Math.floor(i / st.T)][i % st.T] : vals[i]; HEAT(Math.pow(clamp(q / max, 0, 1), .62), col); } a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  return a; });
A.slabMat.color.set('#0d1013'); A.slabMat.roughness = .95; A.slabMat.metalness = 0; scene.background = new THREE.Color('#000000'); scene.fog = new THREE.Fog(0x000000, 22, 64); A.ground.material.color.set('#040506'); A.grid.visible = false; A.rim.color.set('#ffffff'); A.rim.intensity = .8; A.key.intensity = 1.5; A.bloom.strength = .22; A.bloom.radius = .55; A.bloom.threshold = .8; A.renderer.toneMappingExposure = 1.0;
A.key.shadow.mapSize.set(4096, 4096); meshes[1].material.roughness = .95; meshes[1].material.metalness = 0; A.kern.material.opacity = 1; A.kern.material.color.set('#ffffff');
const slabs = scene.children.filter((o) => o.userData.slab != null); slabs.forEach((o) => { o.userData.y = o.position.y; });
const z0 = P[0].z0, reveal = new Float32Array(9).fill(-1);
// ---- the 51 channels as a landscape of lines, exactly as the shot before leaves it (x_ridge): it stops, becomes the window the network reads, and folds flat
const { LineSegments2 } = await import('three/addons/lines/LineSegments2.js'), { LineMaterial } = await import('three/addons/lines/LineMaterial.js'), { LineSegmentsGeometry } = await import('three/addons/lines/LineSegmentsGeometry.js');
const MP = 450, RY = 2.12, KS = 18 / 5.6, AMP = .17 * KS, smooth = (r, k) => { const g = [.12, .24, .28, .24, .12]; let a = r; for (let n = 0; n < k; n++) a = a.map((_, i) => g.reduce((q, w, k) => q + w * a[clamp(i + k - 2, 0, a.length - 1)], 0)); return a; };
const cub = (a, u) => { const k = clamp(Math.floor(u), 0, a.length - 2), f = u - k, p = a[Math.max(k - 1, 0)], q = a[k], r = a[k + 1], v = a[Math.min(k + 2, a.length - 1)]; return q + .5 * f * (r - p + f * (2 * p - 5 * q + 4 * r - v + f * (3 * (q - r) + v - p))); };
const up3 = (a) => Float32Array.from({ length: MP }, (_, i) => cub(a, i / (MP - 1) * (a.length - 1)));
const RS = x.slice(0, 51).map((r) => smooth(Array.from(r), 9)), GW = [.06, .12, .2, .24, .2, .12, .06], mix = (r) => RS[r].map((_, i) => GW.reduce((q, w, k) => q + w * RS[clamp(r + k - 3, 0, 50)][i], 0)), RH = RS.map((_, r) => up3(mix(r))), RMAX = RH.reduce((m, r) => Math.max(m, ...r.map(Math.abs)), 1e-6), rows = [];
for (let r = 0; r < 51; r++) {
  const lm = new LineMaterial({ color: '#ffffff', linewidth: 3.1, vertexColors: true, transparent: true, depthWrite: false, fog: false, toneMapped: false }); lm.resolution.set(1920, 1080);
  const lg = new LineSegmentsGeometry(); lg.setPositions(new Float32Array((MP - 1) * 6)); lg.setColors(new Float32Array((MP - 1) * 6)); const pos = lg.attributes.instanceStart.data, cl = lg.attributes.instanceColorStart.data, ln = new LineSegments2(lg, lm); ln.frustumCulled = false; ln.renderOrder = 10 + r; scene.add(ln);
  const cg = new THREE.BufferGeometry(), cp = new Float32Array(MP * 6), ix = []; for (let i = 0; i < MP - 1; i++) ix.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); cg.setAttribute('position', new THREE.BufferAttribute(cp, 3)); cg.setIndex(ix);
  const cm = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: '#000000', side: THREE.DoubleSide, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 24 })); cm.frustumCulled = false; scene.add(cm); rows.push({ ln, lg, pos, cl, cg, cp, cm, lm });
}
const CUT = 2.8, TS = 1.9, scroll = (t) => TS / 3 * (1 - (1 - Math.min(t, TS) / TS) ** 3);          // the signal runs on for a moment, then holds still: these are the ten seconds
const ridges = (t, q, edge) => { // edge: the input column that has just become picture (0 to 200)
  const on = t < 5.0; for (const R of rows) { R.ln.visible = on; R.cm.visible = on && t < 4.6; } if (!on) return; const out = 1 - ss(4.35, 4.95, t), M = ss(.15, 1.95, t), tr = CUT + scroll(t);
  for (let r = 0; r < 51; r++) { const R = rows[r], z = z0 + (r + .5) * .03 * q, hh = RH[r], rz = RG.z[50 - r], far = clamp(1.02 - .0 * r, .35, 1); for (let i = 0; i < MP; i++) {
    const u = i / (MP - 1), c = u * 200, d = edge - c, f = edge <= 0 ? 1 : 1 - ss(-10, 4, d), X_ = -9 + 18 * u, e = Math.min(1, u * 14, (1 - u) * 14), a = cub(rz, (tr - 3.6 + 3.6 * u - RG.t0) / RG.dt) * AMP, b_ = hh[i] / RMAX * 1.22 * e, hgt = (a + (b_ - a) * M) * f, y = RY + hgt;
    const gl = Math.exp(-((d + 3) ** 2) / 26) * (edge > 0 && edge < 206 ? 1 : 0), k = clamp(.26 + Math.abs(hgt) / AMP * .42, 0, 1) * far, v = Math.pow(1 - Math.exp(-1.72 * k), 2.2) * (.02 + .98 * f) * out * (1 - M * (1 - e));
    for (const o of [i * 6, i * 6 - 3]) { if (o < 0 || o > (MP - 1) * 6 - 3) continue; R.pos.array[o] = X_; R.pos.array[o + 1] = y; R.pos.array[o + 2] = z; R.cl.array[o] = v * .90 + gl * .95; R.cl.array[o + 1] = v * .96 + gl * .55; R.cl.array[o + 2] = v + gl * .16; }
    R.cp[i * 6] = X_; R.cp[i * 6 + 1] = y - .006; R.cp[i * 6 + 2] = z; R.cp[i * 6 + 3] = X_; R.cp[i * 6 + 4] = f > .02 ? RY - .6 * KS * f - .01 : y - .013; R.cp[i * 6 + 5] = z; }
    R.pos.needsUpdate = R.cl.needsUpdate = true; R.cg.attributes.position.needsUpdate = true; }
};
const clipX = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 99); A.renderer.localClippingEnabled = true; meshes[0].material.clippingPlanes = [clipX];          // nothing lies under the lines until they have been read
const side = document.createElement('div'); side.style.cssText = 'position:fixed;inset:0;background:linear-gradient(90deg,#000 0,rgba(0,0,0,0) 210px,rgba(0,0,0,0) calc(100% - 210px),#000 100%)'; document.body.append(side);
// ---- the filter: a bright frame around what it reads, and lines down to the one cell it writes
const fl = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffb352', toneMapped: false, fog: false }), 20); fl.frustumCulled = false; scene.add(fl); A.kern.material.visible = false; const fm = new THREE.Matrix4(), fq = new THREE.Quaternion(), fa = new THREE.Vector3(), fb = new THREE.Vector3(), fx = new THREE.Vector3(1, 0, 0);
const filter = (on) => { fl.visible = on && A.kern.visible; if (!fl.visible) return; const p = A.kern.geometry.attributes.position, w = .034; for (let k = 0; k < 20; k++) { fa.fromBufferAttribute(p, k * 2); fb.fromBufferAttribute(p, k * 2 + 1); const l = fa.distanceTo(fb) || 1e-4; fq.setFromUnitVectors(fx, fb.clone().sub(fa).divideScalar(l)); fm.compose(fa.clone().add(fb).multiplyScalar(.5), fq, new THREE.Vector3(l + w, w, w)); fl.setMatrixAt(k, fm); } fl.instanceMatrix.needsUpdate = true; };
const lab = (t, c = '') => { const e = document.createElement('div'); e.className = 't ' + c; e.textContent = t; document.body.append(e); return e; }, L = { ch: lab('51 channels'), tm: lab('10 seconds'), p: lab('A person', 'big'), m: lab('Moving', 'big') };
const at = (e, v3, dx, dy, o, right) => { const p = v3.clone().project(camera); e.style.opacity = o; e.style.transform = `translate(${(p.x + 1) / 2 * innerWidth + dx - (right ? e.offsetWidth : 0)}px, ${(1 - p.y) / 2 * innerHeight + dy}px)`; };
// ---- camera: one move, no cut
const Q0 = 3.4 * KS / 1.53, cz = (q) => z0 + 51 * .03 * q / 2, V = (...a) => new THREE.Vector3(...a);
const camR = (t) => { const q = ss(.5, 3.4, t); return [V((-1.10 + .55 * q) * KS, RY + (1.37 - .16 * q) * KS, cz(Q0) + (3.75 - .35 * q) * KS), V(0, RY + .12 * KS, cz(Q0))]; }, K0 = camR(2.2), K1 = camR(2.8);          // the camera of x_ridge, carried on
const K = [[-.6, ...K0], [0, ...K1], [1.75, V(-.95, 8.2, cz(Q0) + 10.9), V(-.1, 2.1, cz(Q0) + .4)], [4.45, V(0, 35.6, cz(Q0) + 3.0), V(0, 2.08, cz(Q0) + .1), 1], [4.9, V(0, 35.0, cz(Q0) + 3.1), V(0, 2.08, cz(Q0) + .1), 1], [6.15, V(-8.2, 8.6, 6.6), V(-2.6, 2.3, -5.6)], [7.45, V(4.6, 6.4, 5.4), V(1.6, 1.9, -5.0)], [8.75, V(6.4, 7.4, 9.6), V(.6, 1.2, -1.6)], [10.1, V(-3.6, 8.4, 14.6), V(-.4, 1.1, .2)], [11.1, V(-3.6, 5.6, 17.4), V(-.6, .9, 3.4)], [12.9, V(-1.2, 4.0, 16.2), V(-.1, 1.15, 4.6)]];
const spline = (j, t) => { let k = 1; while (k < K.length - 1 && K[k][0] < t) k++; const a = K[k - 1], b = K[k], p = K[Math.max(0, k - 2)], q = K[Math.min(K.length - 1, k + 1)], d = b[0] - a[0], u = clamp((t - a[0]) / d, 0, 1), m0 = b[j].clone().sub(p[j]).multiplyScalar(k > 1 && !a[3] ? d / (b[0] - p[0]) : 0), m1 = k < K.length - 1 && !b[3] ? q[j].clone().sub(a[j]).multiplyScalar(d / (q[0] - a[0])) : V(0, 0, 0), u2 = u * u, u3 = u2 * u;
  return a[j].clone().multiplyScalar(2 * u3 - 3 * u2 + 1).add(m0.multiplyScalar(u3 - 2 * u2 + u)).add(b[j].clone().multiplyScalar(-2 * u3 + 3 * u2)).add(m1.multiplyScalar(u3 - u2)); };
const S = [[0, 0], [2.1, 0], [4.45, 1], [5.5, 1], [7.35, 2], [7.8, 3], [8.45, 4], [8.75, 5], [9.45, 6], [10.1, 7], [10.7, 7.7], [11.22, 8.2], [11.85, 9], [99, 9]], stageAt = (t) => { let k = 1; while (S[k][0] < t) k++; const [a, p] = S[k - 1], [b, q] = S[k]; return p + (q - p) * (t - a) / (b - a); };
let t0 = performance.now(), run = false;
A.film = () => {
  const t = run ? (performance.now() - t0) / 1000 : 0, st = stageAt(t); api.setStage(st, { silent: true }); 
  const q = Q0 + (1 - Q0) * ss(4.75, 5.95, t), m0 = meshes[0]; m0.scale.z = q; m0.position.z = z0 * (1 - q);
  slabs.forEach((o) => { const k = o.userData.slab; if (k === 0) { o.visible = t > 4.7; return; } const up = ss(4.9 + k * .16, 6.0 + k * .2, t); o.visible = t > 4.8; o.position.y = o.userData.y - (1 - up) * (P[k].y + .25); });
  A.ground.visible = t > 4.7; m0.castShadow = t > 4.7; m0.count = t < 5.2 ? 10200 : 10400; for (let k = 1; k < 8; k++) meshes[k].visible = t > 4.9; filter(t > 5.3); A.pillars.forEach((p, i) => { p.material.color.set('#ffb352'); p.material.emissive.set('#d8913a'); });
  A.plates.forEach((g) => { g.visible = false; }); A.pillars.forEach((p) => { p.visible = t > 11.1; });
  for (let k = 0; k < 8; k++) { // a cell is dark until it has been computed; the newest ones flash
    const m = meshes[k], r = clamp(st - k, 0, 1); if (Math.abs(r - reveal[k]) < 1e-6 && k) continue; reveal[k] = r; const a = m.instanceColor.array, c = C0[k], T = k < 6 ? STAGES[k].T : 1, edge = r * (T + 6);
    for (let i = 0; i < m.count; i++) { const d = k < 6 ? edge - (i % T) : r * 4, f = k < 6 ? clamp(d / 3, 0, 1) : clamp(d, 0, 1), fl = k < 6 && r < 1 ? 1 + (k ? 1.6 : 2.2) * Math.exp(-Math.max(0, d - 1) / (k ? T * .02 + .8 : 3.2)) : 1, g = f * fl * (k === 0 && i >= 10200 ? ss(5.0, 5.8, t) : 1); a[i * 3] = c[i * 3] * g + .0018; a[i * 3 + 1] = c[i * 3 + 1] * g + .0022; a[i * 3 + 2] = c[i * 3 + 2] * g + .0028; }
    m.instanceColor.needsUpdate = true; }
  camera.position.copy(spline(1, t)); camera.up.set(0, 1, 0); camera.lookAt(spline(2, t)); camera.fov = 43.6 + (30.8 - 43.6) * ss(.2, 4.2, t); clipX.constant = t > 4.9 ? 99 : -9 + 18 * clamp(st, 0, 1) * 206 / 200; side.style.opacity = 1 - ss(.3, 1.9, t); { const b = ss(3.6, 4.7, t); A.bloom.threshold = .06 + .74 * b; A.bloom.strength = .30 - .08 * b; A.bloom.radius = .35 + .2 * b; } camera.setViewOffset(1920, 1080, -70 * ss(4.9, 6.0, t), 0, 1920, 1080); camera.near = .5; camera.far = 300; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  ridges(t, q, clamp(st, 0, 1) * 206); const o1 = ss(3.3, 3.9, t) * (1 - ss(4.75, 5.05, t)), zE = z0 + 51 * .03 * q; at(L.ch, V(-9, 2.1, z0), 0, -44, o1); at(L.tm, V(9, 2.1, zE), 0, 20, o1, true);
  const o2 = ss(11.4, 11.72, t); at(L.p, V(A.VEC.out(0), P[8].y + 1.8 * out.person + .1, A.vz(8)), -105, -86, o2); at(L.m, V(A.VEC.out(1), P[8].y + 1.8 * out.moving + .1, A.vz(8)), -92, -86, o2);
};
window.NET3D = { start() { t0 = performance.now(); run = true; return [out.person, out.moving]; } };
api.start();
window.READY = true;
