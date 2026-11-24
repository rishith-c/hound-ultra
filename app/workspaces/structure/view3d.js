// Structure lab: the 3-D view. three.js with physically based materials, soft shadows and dust. It draws what the
// physics and the analysis hand it; it measures nothing itself. Dust is a visual effect only.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const TEX = 256;
function noiseCanvas(seed, draw) {
  const c = document.createElement('canvas'); c.width = c.height = TEX; const g = c.getContext('2d');
  let a = seed >>> 0; const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  draw(g, rnd); return c;
}
function tex(canvas, repeat = true) { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }
function concreteCanvas(seed, base, { lines = false, coarse = false } = {}) {
  return noiseCanvas(seed, (g, r) => {
    g.fillStyle = 'rgb(' + base + ',' + base + ',' + (base + 2) + ')'; g.fillRect(0, 0, TEX, TEX);
    for (let i = 0; i < 46; i++) { const x = r() * TEX, y = r() * TEX, s = 20 + r() * 70, d = (r() - 0.5) * 22; const gr = g.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, 'rgba(' + (d > 0 ? '255,255,255,' : '0,0,0,') + Math.abs(d) / 255 + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - s, y - s, 2 * s, 2 * s); }
    for (let i = 0; i < (coarse ? 5200 : 3200); i++) { const v = r() < 0.5 ? 255 : 0; g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.03 + r() * 0.09) + ')'; const s = coarse ? 1 + r() * 2.4 : 1 + r() * 1.2; g.fillRect(r() * TEX, r() * TEX, s, s); }
    for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(0,0,0,' + (0.05 + r() * 0.1) + ')'; g.beginPath(); g.arc(r() * TEX, r() * TEX, 0.6 + r() * 1.6, 0, 6.3); g.fill(); }   // bug holes
    if (lines) { g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = 1; for (let y = 0; y < TEX; y += 64) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(TEX, y + 0.5); g.stroke(); } }
    for (let i = 0; i < 5; i++) { g.strokeStyle = 'rgba(20,16,12,' + (0.06 + r() * 0.07) + ')'; g.lineWidth = 2 + r() * 6; const x = r() * TEX; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + (r() - 0.5) * 30, 80, x + (r() - 0.5) * 30, 170, x + (r() - 0.5) * 40, TEX); g.stroke(); }  // run-off stains
  });
}
function hollowCoreCanvas() { // the end of a hollow-core plank: 1.1 m by 0.2 m with five cores
  const c = document.createElement('canvas'); c.width = 440; c.height = 80; const g = c.getContext('2d');
  g.fillStyle = '#8f9091'; g.fillRect(0, 0, 440, 80);
  for (let i = 0; i < 900; i++) { const v = Math.random() < 0.5 ? 255 : 0; g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.08)'; g.fillRect(Math.random() * 440, Math.random() * 80, 2, 2); }
  for (let i = 0; i < 5; i++) { const x = 44 + i * 88; const gr = g.createRadialGradient(x, 40, 4, x, 40, 30); gr.addColorStop(0, '#050506'); gr.addColorStop(1, '#17181a'); g.fillStyle = gr; g.beginPath(); g.ellipse(x, 40, 30, 26, 0, 0, 6.3); g.fill(); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2; g.stroke(); }
  for (let i = 0; i < 7; i++) { g.fillStyle = '#3a2a22'; g.beginPath(); g.arc(18 + i * 67.3, 70, 2.6, 0, 6.3); g.fill(); }   // prestressing strands
  return c;
}
function brickCanvas() {
  return noiseCanvas(11, (g, r) => {
    g.fillStyle = '#7d7a76'; g.fillRect(0, 0, TEX, TEX);
    const bh = TEX / 8, bw = TEX / 4;
    for (let row = 0; row < 8; row++) for (let col = -1; col < 4; col++) { const x = col * bw + (row % 2 ? bw / 2 : 0), y = row * bh, t = 96 + r() * 34; g.fillStyle = 'rgb(' + (t + 16) + ',' + (t - 6) + ',' + (t - 18) + ')'; g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3); }
    for (let i = 0; i < 2600; i++) { const v = r() < 0.5 ? 255 : 0; g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.05)'; g.fillRect(r() * TEX, r() * TEX, 1.5, 1.5); }
  });
}
function woodCanvas() {
  return noiseCanvas(5, (g, r) => { g.fillStyle = '#b08a56'; g.fillRect(0, 0, TEX, TEX); for (let i = 0; i < 90; i++) { g.strokeStyle = 'rgba(70,45,20,' + (0.08 + r() * 0.2) + ')'; g.lineWidth = 0.6 + r() * 1.6; const x = r() * TEX; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + (r() - 0.5) * 8, 80, x + (r() - 0.5) * 8, 170, x + (r() - 0.5) * 6, TEX); g.stroke(); } });
}
function groundCanvas() {
  return noiseCanvas(3, (g, r) => { g.fillStyle = '#1b1d20'; g.fillRect(0, 0, TEX, TEX); for (let i = 0; i < 9000; i++) { const v = r() < 0.55 ? 255 : 0; g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.02 + r() * 0.06) + ')'; const s = 0.6 + r() * 1.8; g.fillRect(r() * TEX, r() * TEX, s, s); } });
}
// a box whose texture has the same density on every face (uv in metres / scale)
function boxGeo(h, scale = 1.6) {
  const g = new THREE.BoxGeometry(2 * h[0], 2 * h[1], 2 * h[2]); const uv = g.attributes.uv, d = [[2 * h[2], 2 * h[1]], [2 * h[2], 2 * h[1]], [2 * h[0], 2 * h[2]], [2 * h[0], 2 * h[2]], [2 * h[0], 2 * h[1]], [2 * h[0], 2 * h[1]]];
  const off = Math.random() * 3;
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * d[f][0] / scale + off, uv.getY(i) * d[f][1] / scale + off * 0.7); }
  return g;
}

export function createView(host, ctx, hooks = {}) {
  const { cssVar, reducedMotion } = ctx.kit;
  const col = (name) => new THREE.Color(cssVar(name) || '#888');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.localClippingEnabled = true;
  renderer.domElement.className = 'structure-canvas'; renderer.domElement.setAttribute('aria-label', '3-D view of the simulated bay and its rubble pile. Drag to orbit, scroll to zoom, click a piece to select it.'); renderer.domElement.setAttribute('role', 'img'); renderer.domElement.tabIndex = 0;
  host.append(renderer.domElement);
  const labelLayer = document.createElement('div'); labelLayer.className = 'structure-labels'; host.append(labelLayer);
  const scene = new THREE.Scene(); const bg = new THREE.Color('#07090c'); scene.background = bg; scene.fog = new THREE.Fog(bg, 34, 95);
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.22;
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 300); camera.position.set(15.5, 9.5, 17);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.target.set(0, 2.2, 0); controls.minDistance = 3; controls.maxDistance = 60; controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.autoRotate = !reducedMotion(); controls.autoRotateSpeed = 0.35;
  let userMoved = false; controls.addEventListener('start', () => { userMoved = true; controls.autoRotate = false; hooks.onCamera?.(); });

  scene.add(new THREE.HemisphereLight(0xc4d6f2, 0x15171b, 0.62));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.9); sun.position.set(13, 21, 8); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 60 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035; sun.shadow.radius = 4; scene.add(sun);
  const rim = new THREE.DirectionalLight(0x86b4ff, 0.75); rim.position.set(-12, 9, -14); scene.add(rim);

  // ground: dark yard, a concrete pad under the bay, a 1 m survey grid and a scale bar
  const gT = tex(groundCanvas()); gT.repeat.set(60, 60);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ map: gT, roughness: 0.96, metalness: 0 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const padT = tex(concreteCanvas(21, 96, { lines: true })); const pad = new THREE.Mesh(boxGeo([5.6, 0.02, 4.9], 2.4), new THREE.MeshStandardMaterial({ map: padT, roughness: 0.9, color: 0x9a9da1 })); pad.position.y = -0.012; pad.receiveShadow = true; scene.add(pad);
  { const pts = []; for (let i = -14; i <= 14; i++) { pts.push(i, 0.004, -14, i, 0.004, 14, -14, 0.004, i, 14, 0.004, i); }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); const grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.045, depthWrite: false })); scene.add(grid);
    const sb = [-5, 0.01, 6.4, 0, 0.01, 6.4]; for (let i = 0; i <= 5; i++) sb.push(-5 + i, 0.01, 6.4, -5 + i, 0.01, i % 5 ? 6.52 : 6.62);
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sb, 3)); scene.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }))); }

  // materials
  const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6); let clipOn = false;
  const T = { conc: tex(concreteCanvas(1, 150)), concB: tex(concreteCanvas(2, 132, { lines: true })), concC: tex(concreteCanvas(4, 120, { coarse: true })), core: tex(hollowCoreCanvas(), false), brick: tex(brickCanvas()), wood: tex(woodCanvas()), rough: tex(concreteCanvas(9, 104, { coarse: true })) };
  const M = (o) => { const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o }); m.clippingPlanes = [clip]; m.clipShadows = true; return m; };
  const rebarMat = new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.75, metalness: 0.6, clippingPlanes: [clip] });
  const matsFor = (p) => {
    if (p.kind === 'plank') { const side = M({ map: T.conc, bumpMap: T.conc, bumpScale: 0.6, color: 0xb9bbbd }), end = M({ map: T.core, color: 0xc4c4c4 }); return [side, side, side, side, end, end]; }
    if (p.kind === 'beam') return M({ map: T.concB, bumpMap: T.concB, bumpScale: 0.7, color: 0xa6a8ab });
    if (p.kind === 'column') { const side = M({ map: T.concB, bumpMap: T.concB, bumpScale: 0.7, color: 0xb0b2b4 }), brk = M({ map: T.rough, bumpMap: T.rough, bumpScale: 1.6, color: 0x8a8782, roughness: 1 }); return [side, side, p.broken === 'top' ? brk : side, p.broken === 'bottom' ? brk : side, side, side]; }
    if (p.kind === 'debris') return M({ map: T.rough, bumpMap: T.rough, bumpScale: 1.6, color: 0x97948f, roughness: 1 });
    if (p.kind === 'wall') return M({ map: T.brick, bumpMap: T.brick, bumpScale: 0.8, color: 0xb9b2aa });
    if (p.kind === 'content') return p.sub === 'cabinet' ? M({ color: 0x59616b, roughness: 0.45, metalness: 0.7 }) : M({ map: T.wood, color: 0x9a8468, roughness: 0.7 });
    return M({ map: T.wood, color: 0xd2b488, roughness: 0.8 });
  };
  const root = new THREE.Group(); scene.add(root);
  const overlay = new THREE.Group(); scene.add(overlay);
  let items = [];   // per piece: { group, meshes, mats, edges }
  const pickables = [];

  function buildPiece(p) {
    const group = new THREE.Group(), meshes = [], mats = [];
    if (p.kind === 'shore') buildShore(p, group, meshes, mats);
    else for (const b of p.boxes) {
      const mat = matsFor(p); const mesh = new THREE.Mesh(boxGeo(b.h, p.kind === 'wall' ? 1.2 : 1.6), mat); mesh.position.set(b.o[0], b.o[1], b.o[2]); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.piece = p.idx;
      group.add(mesh); meshes.push(mesh); for (const m of [].concat(mat)) if (!mats.includes(m)) mats.push(m);
    }
    if (p.broken) { // reinforcing bars standing out of the broken face
      const b = p.boxes[0], s = p.broken === 'top' ? 1 : -1;
      for (let k = 0; k < 4; k++) { const L = 0.22 + Math.random() * 0.3, bar = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, L, 6), rebarMat); bar.position.set((k % 2 ? 1 : -1) * (b.h[0] - 0.05), s * (b.h[1] + L / 2 - 0.02), (k < 2 ? 1 : -1) * (b.h[2] - 0.05)); bar.rotation.set((Math.random() - 0.5) * 0.7, 0, (Math.random() - 0.5) * 0.7); bar.castShadow = true; group.add(bar); }
    }
    root.add(group); for (const m of meshes) pickables.push(m);
    return { group, meshes, mats, edges: null, tint: null };
  }
  function buildShore(p, group, meshes, mats) {
    const b = p.boxes[0], mat = M({ map: T.wood, color: 0xe2c08c, roughness: 0.78 }); mats.push(mat);
    const addBox = (h, pos) => { const m = new THREE.Mesh(boxGeo(h, 0.8), mat); m.position.set(pos[0], pos[1], pos[2]); m.castShadow = m.receiveShadow = true; m.userData.piece = p.idx; group.add(m); meshes.push(m); };
    if (p.sub === 'crib') { const t = 0.045, n = Math.max(2, Math.round(b.h[1] / t)); const lt = b.h[1] / n; for (let i = 0; i < n; i++) { const y = -b.h[1] + lt * (2 * i + 1); for (const s of [-1, 1]) addBox(i % 2 ? [b.h[0], lt * 0.96, 0.045] : [0.045, lt * 0.96, b.h[2]], i % 2 ? [0, y, s * (b.h[2] - 0.06)] : [s * (b.h[0] - 0.06), y, 0]); } }
    else { addBox([0.07, b.h[1] - 0.09, 0.07], [0, 0, 0]); addBox([0.3, 0.045, 0.07], [0, b.h[1] - 0.045, 0]); addBox([0.3, 0.045, 0.07], [0, -b.h[1] + 0.045, 0]); addBox([0.02, 0.2, 0.07], [0.12, b.h[1] - 0.3, 0]); addBox([0.02, 0.2, 0.07], [-0.12, b.h[1] - 0.3, 0]); }
  }
  function setPile(pile) {
    for (const it of items) { root.remove(it.group); it.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const m of it.mats) m.dispose(); }
    items = []; pickables.length = 0; clearOverlays();
    for (const p of pile.pieces) items.push(buildPiece(p));
  }
  function addPiece(p) { items[p.idx] = buildPiece(p); }
  function rebuildPiece(p) { const old = items[p.idx]; if (old) { root.remove(old.group); for (const m of old.meshes) { const i = pickables.indexOf(m); if (i >= 0) pickables.splice(i, 1); } } items[p.idx] = buildPiece(p); }
  function trim(n) { while (items.length > n) { const it = items.pop(); root.remove(it.group); for (const m of it.meshes) { const i = pickables.indexOf(m); if (i >= 0) pickables.splice(i, 1); } } }
  function sync(pile, poses) {
    for (const p of pile.pieces) { const it = items[p.idx]; if (!it) continue; if (p.dirty) { p.dirty = false; rebuildPiece(p); } const g = items[p.idx].group; g.visible = p.alive; if (!p.alive) continue; const o = p.idx * 7; g.position.set(poses[o], poses[o + 1], poses[o + 2]); g.quaternion.set(poses[o + 3], poses[o + 4], poses[o + 5], poses[o + 6]); }
  }

  // ---- appearance modes
  let xray = false, selected = -1, hovered = -1; const tints = new Map();
  function applyLook(idx) {
    const it = items[idx]; if (!it) return; const t = tints.get(idx), sel = idx === selected, hov = idx === hovered;
    for (const m of it.mats) {
      const ghost = xray && !sel && !t;
      m.transparent = ghost; m.opacity = ghost ? 0.13 : 1; m.depthWrite = !ghost;
      m.emissive.set(sel ? 0x2a6fd0 : t ? t.color : hov ? 0x26354a : 0x000000); m.emissiveIntensity = sel ? 0.55 : t ? t.k : hov ? 0.8 : 0;
    }
    for (const mesh of it.meshes) mesh.castShadow = !(xray && !sel && !t);
  }
  const refreshLooks = () => { for (let i = 0; i < items.length; i++) applyLook(i); };
  function setXray(on) { xray = on; refreshLooks(); }
  function setSelected(idx) { const old = selected; selected = idx; applyLook(old); applyLook(idx); }
  function setHovered(idx) { if (idx === hovered) return; const old = hovered; hovered = idx; applyLook(old); applyLook(idx); }
  function setTints(map) { tints.clear(); if (map) for (const [i, c] of map) tints.set(i, { color: new THREE.Color(c.color), k: c.k ?? 0.5 }); refreshLooks(); }
  function setSection(z) { clipOn = z != null; clip.constant = clipOn ? z : 1e6; sectionQuad.visible = clipOn; if (clipOn) sectionQuad.position.z = z; }
  const sectionQuad = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(13, 7.4)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })); sectionQuad.position.y = 3.7; sectionQuad.visible = false; scene.add(sectionQuad);

  // ---- overlays
  const layers = {};
  function layer(name) { if (layers[name]) { overlay.remove(layers[name]); layers[name].traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); } const g = new THREE.Group(); layers[name] = g; overlay.add(g); return g; }
  function clearLayer(name) { if (layers[name]) { overlay.remove(layers[name]); delete layers[name]; } for (const [k, l] of labels) if (l.layer === name) { l.el.remove(); labels.delete(k); } }
  function clearOverlays() { for (const k of Object.keys(layers)) clearLayer(k); for (const [, l] of labels) l.el.remove(); labels.clear(); routes.length = 0; }
  const ramp = ['--heat-1', '--heat-2', '--heat-3', '--heat-4', '--heat-5'].map(col);
  const rampAt = (t, out = new THREE.Color()) => { t = Math.max(0, Math.min(0.9999, t)) * (ramp.length - 1); const i = Math.floor(t); return out.copy(ramp[i]).lerp(ramp[i + 1], t - i); };

  // pockets of air: the shell voxels of each void, coloured by how much room there is
  function showVoids(g, voids, { selectedId = null } = {}) {
    clearLayer('voids'); if (!g || !voids?.length) return; const L = layer('voids');
    let count = 0; const member = new Uint8Array(g.n); const shells = [];
    for (const v of voids) { member.fill(0); for (const id of v.voxels) member[id] = 1; const sh = []; for (const id of v.voxels) { if (!member[id + 1] || !member[id - 1] || !member[id + g.nx] || !member[id - g.nx] || !member[id + g.sl] || !member[id - g.sl]) sh.push(id); } shells.push(sh); count += sh.length; }
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(g.res * 0.9, g.res * 0.9, g.res * 0.9), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, clippingPlanes: [clip] }), count);
    const m4 = new THREE.Matrix4(), c = new THREE.Color(); let k = 0;
    voids.forEach((v, vi) => { const dim = selectedId && v.id !== selectedId; for (const id of shells[vi]) { const p = g.pos(id); m4.makeTranslation(p[0], p[1], p[2]); mesh.setMatrixAt(k, m4); const cl = Math.sqrt(g.d2[id]) * g.res; rampAt(0.25 + cl / 0.9, c); if (v.person) c.lerp(new THREE.Color(0xffffff), 0.08); c.multiplyScalar(dim ? 0.18 : v.person ? 0.75 : 0.42); mesh.setColorAt(k, c); k++; } });
    mesh.instanceColor.needsUpdate = true; mesh.renderOrder = 5; L.add(mesh);
    voids.slice(0, 8).forEach((v) => setLabel('void-' + v.id, v.id + '  ' + v.volume.toFixed(1) + ' m³', [v.center[0], v.max[1] + 0.15, v.center[2]], { layer: 'voids', cls: v.person ? 'is-person' : '', anchor: v.center, onclick: () => hooks.onVoid?.(v.id) }));
  }
  function showProtected(box) {
    clearLayer('prot'); if (!box) return; const L = layer('prot'); const c = col('--person');
    const geo = new THREE.BoxGeometry(2 * box.h[0], 2 * box.h[1], 2 * box.h[2]);
    const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.16, depthWrite: false })); const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.95 }));
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(Math.min(box.h[1], box.h[2]) * 0.62, Math.max(0.1, 2 * box.h[0] - 0.75), 6, 12), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, depthTest: false })); body.rotation.z = Math.PI / 2;
    const grp = new THREE.Group(); grp.add(fill, edge, body); grp.position.set(box.c[0], box.c[1], box.c[2]); grp.rotation.y = box.yaw || 0; edge.renderOrder = 9; body.renderOrder = 8; L.add(grp);
    setLabel('prot', 'Believed position', [box.c[0], box.c[1] + box.h[1] + 0.25, box.c[2]], { layer: 'prot', cls: 'is-person', anchor: box.c });
  }
  // the load path: one bar per contact, from each piece's centre to the contact point, thicker and hotter with force
  function showForces(pile, poses, con) {
    clearLayer('forces'); if (!con) return; const L = layer('forces');
    const E = con.edges.filter((e) => e.pt && e.F > 400).sort((a, b) => b.F - a.F).slice(0, 700); if (!E.length) return;
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthTest: false }), E.length * 2);
    const up = new THREE.Vector3(0, 1, 0), a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), m4 = new THREE.Matrix4(), c = new THREE.Color(); let k = 0;
    const lo = Math.log(400), hi = Math.log(Math.max(2e5, E[0].F));
    for (const e of E) { const t = (Math.log(e.F) - lo) / (hi - lo), r = 0.008 + 0.05 * t * t; rampAt(0.15 + 0.85 * t, c);
      for (const i of [e.a, e.b]) { if (i < 0) { a.set(e.pt[0], 0, e.pt[2]); } else { const o = i * 7; a.set(poses[o], poses[o + 1], poses[o + 2]); } b.set(e.pt[0], e.pt[1], e.pt[2]); d.subVectors(b, a); const len = d.length(); if (len < 1e-3) { m4.makeScale(0, 0, 0); } else { q.setFromUnitVectors(up, d.normalize()); s.set(r, len, r); m4.compose(a.add(b).multiplyScalar(0.5), q, s); } mesh.setMatrixAt(k, m4); mesh.setColorAt(k, c); k++; } }
    mesh.count = k; mesh.instanceColor.needsUpdate = true; mesh.renderOrder = 6; L.add(mesh);
  }
  // what a trial changed: outlines of the pieces where they ended up, and an arrow from where they were
  function showGhost(pile, before, after, moved, colorVar = '--accent') {
    clearLayer('ghost'); if (!after || !moved?.length) return; const L = layer('ghost'); const c = col(colorVar);
    const mat = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.95, depthTest: false }), arrows = [];
    for (const m of moved.slice(0, 60)) { const p = pile.pieces[m.idx], o = m.idx * 7; const grp = new THREE.Group(); grp.position.set(after[o], after[o + 1], after[o + 2]); grp.quaternion.set(after[o + 3], after[o + 4], after[o + 5], after[o + 6]);
      for (const b of p.boxes) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * b.h[0], 2 * b.h[1], 2 * b.h[2])), mat); e.position.set(b.o[0], b.o[1], b.o[2]); e.renderOrder = 7; grp.add(e); } L.add(grp);
      arrows.push(before[o], before[o + 1], before[o + 2], after[o], after[o + 1], after[o + 2]); }
    const ag = new THREE.BufferGeometry(); ag.setAttribute('position', new THREE.Float32BufferAttribute(arrows, 3)); const al = new THREE.LineSegments(ag, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.8, depthTest: false })); al.computeLineDistances(); al.renderOrder = 7; L.add(al);
  }
  function showZones(zones) {
    clearLayer('zones'); if (!zones?.length) return; const L = layer('zones');
    zones.forEach((z, i) => { const sx = z.max[0] - z.min[0], sy = Math.max(0.3, z.max[1] - z.min[1]), sz = z.max[2] - z.min[2]; const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sy, sz)), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.22, gapSize: 0.16, transparent: true, opacity: 0.55, depthTest: false })); e.computeLineDistances(); e.position.set((z.min[0] + z.max[0]) / 2, z.min[1] + sy / 2, (z.min[2] + z.max[2]) / 2); e.renderOrder = 4; L.add(e);
      setLabel('zone-' + i, 'Textbook void zone', [e.position.x, z.min[1] + sy + 0.2, z.max[2]], { layer: 'zones', cls: 'is-quiet' }); });
  }
  const routes = [];
  function showRoutes(list) { // [{ id, pts, color var, radius }]
    clearLayer('routes'); routes.length = 0; if (!list?.length) return; const L = layer('routes');
    for (const r of list) { if (!r.pts || r.pts.length < 2) continue; const curve = new THREE.CatmullRomCurve3(r.pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal', 0.5); const seg = Math.min(900, r.pts.length * 3);
      const geo = new THREE.TubeGeometry(curve, seg, r.radius, 10, false); const c = col(r.color);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9, roughness: 0.5, depthTest: !r.through, transparent: true, opacity: 0.96 })); mesh.renderOrder = 8; L.add(mesh);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(r.radius * 1.9, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })); tip.renderOrder = 9; L.add(tip);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.014, 8, 28), new THREE.MeshBasicMaterial({ color: c, depthTest: false })); ring.position.copy(curve.getPoint(0)); ring.rotation.x = Math.PI / 2; ring.renderOrder = 9; L.add(ring);
      const total = geo.index.count; const rec = { mesh, tip, curve, total, t: reducedMotion() ? 1 : 0, speed: r.speed || 0.5, len: r.length || 1 }; geo.setDrawRange(0, rec.t ? total : 0); if (rec.t) tip.position.copy(curve.getPoint(1)); routes.push(rec);
      setLabel('route-' + r.id, r.label, r.pts[0], { layer: 'routes', cls: 'is-' + r.id }); }
  }
  let preview = null;
  function showShorePreview(probe, half, ok) {
    if (!probe) { if (preview) preview.visible = false; return; }
    if (!preview) { preview = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthTest: false })); preview.renderOrder = 9; scene.add(preview); }
    preview.visible = true; preview.material.color.copy(col(ok ? '--ok' : '--danger')); preview.scale.set(half * 2, Math.max(0.05, probe.h), half * 2); preview.position.set(probe.x, probe.bottom + probe.h / 2, probe.z);
  }

  // ---- labels with leader lines
  const labels = new Map();
  function setLabel(key, text, pos, { layer = '', cls = '', anchor = null, onclick = null } = {}) {
    let l = labels.get(key);
    if (!l) { const el = document.createElement(onclick ? 'button' : 'div'); el.className = 'structure-label ' + cls; const line = document.createElement('i'); const span = document.createElement('span'); el.append(line, span); if (onclick) { el.type = 'button'; el.addEventListener('click', onclick); } labelLayer.append(el); l = { el, span, line }; labels.set(key, l); }
    l.span.textContent = text; l.pos = new THREE.Vector3(pos[0], pos[1], pos[2]); l.anchor = anchor ? new THREE.Vector3(anchor[0], anchor[1], anchor[2]) : null; l.layer = layer; l.el.className = 'structure-label ' + cls;
  }
  function removeLabel(key) { const l = labels.get(key); if (l) { l.el.remove(); labels.delete(key); } }
  const v3 = new THREE.Vector3();
  function projectLabels(w, h) {
    for (const [, l] of labels) {
      v3.copy(l.pos).project(camera); if (v3.z > 1 || v3.z < -1) { l.el.style.display = 'none'; continue; }
      const x = (v3.x * 0.5 + 0.5) * w, y = (-v3.y * 0.5 + 0.5) * h; l.el.style.display = ''; l.el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      if (l.anchor) { v3.copy(l.anchor).project(camera); const ay = (-v3.y * 0.5 + 0.5) * h; l.line.style.height = Math.max(0, Math.round(ay - y)) + 'px'; } else l.line.style.height = '10px';
    }
  }

  // ---- dust (drawn only)
  const ND = 2200, dPos = new Float32Array(ND * 3), dVel = new Float32Array(ND * 3), dAge = new Float32Array(ND).fill(9), dLife = new Float32Array(ND).fill(1), dSize = new Float32Array(ND); let dNext = 0;
  const dGeo = new THREE.BufferGeometry(); dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3)); dGeo.setAttribute('aAge', new THREE.BufferAttribute(new Float32Array(ND), 1)); dGeo.setAttribute('aSize', new THREE.BufferAttribute(dSize, 1));
  const dMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 } },
    vertexShader: 'attribute float aAge; attribute float aSize; varying float vA; uniform float uScale; void main(){ vA = aAge; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * (0.6 + 1.6 * aAge) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d) * 4.0; if (r > 1.0 || vA >= 1.0) discard; float a = (1.0 - r) * (1.0 - r) * smoothstep(0.0, 0.08, vA) * (1.0 - vA) * 0.16; gl_FragColor = vec4(vec3(0.66, 0.62, 0.56), a); }' });
  const dustPts = new THREE.Points(dGeo, dMat); dustPts.frustumCulled = false; dustPts.renderOrder = 3; scene.add(dustPts); let dustLive = 0;
  function puff(e) {
    if (reducedMotion()) return; const n = Math.round(5 + 26 * e.s);
    for (let i = 0; i < n; i++) { const k = dNext; dNext = (dNext + 1) % ND; const a = Math.random() * 6.283, rr = Math.random() * e.r * 0.8; dPos[k * 3] = e.x + Math.cos(a) * rr; dPos[k * 3 + 1] = e.y + Math.random() * 0.25; dPos[k * 3 + 2] = e.z + Math.sin(a) * rr; const sp = 0.5 + Math.random() * 2.6 * (0.4 + e.s); dVel[k * 3] = Math.cos(a) * sp; dVel[k * 3 + 1] = 0.25 + Math.random() * 1.3; dVel[k * 3 + 2] = Math.sin(a) * sp; dAge[k] = 0; dLife[k] = 2.6 + Math.random() * 3.8; dSize[k] = 0.5 + Math.random() * 1.1; }
    dustLive = 7;
  }
  function stepDust(dt) {
    if (dustLive <= 0) return; dustLive -= dt; const aA = dGeo.attributes.aAge.array;
    for (let k = 0; k < ND; k++) { if (dAge[k] >= dLife[k]) { aA[k] = 1; continue; } dAge[k] += dt; const dr = Math.exp(-1.7 * dt); dVel[k * 3] *= dr; dVel[k * 3 + 2] *= dr; dVel[k * 3 + 1] = dVel[k * 3 + 1] * dr + 0.05 * dt; dPos[k * 3] += dVel[k * 3] * dt; dPos[k * 3 + 1] += dVel[k * 3 + 1] * dt; dPos[k * 3 + 2] += dVel[k * 3 + 2] * dt; aA[k] = Math.min(1, dAge[k] / dLife[k]); }
    dGeo.attributes.position.needsUpdate = true; dGeo.attributes.aAge.needsUpdate = true; dGeo.attributes.aSize.needsUpdate = true;
  }

  // ---- camera moves
  let tween = null;
  const VIEWS = { orbit: { pos: [15.5, 9.5, 17], tgt: [0, 2.2, 0] }, top: { pos: [0.01, 27, 0.02], tgt: [0, 0, 0] }, side: { pos: [25, 3.6, 0.01], tgt: [0, 2.6, 0] }, front: { pos: [0.01, 3.6, 25], tgt: [0, 2.6, 0] } };
  function flyTo(pos, tgt, ms = 800) { if (reducedMotion()) { camera.position.set(...pos); controls.target.set(...tgt); return; } tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...pos), t1: new THREE.Vector3(...tgt), t: 0, ms }; controls.autoRotate = false; }
  function setCamera(name) { const v = VIEWS[name] || VIEWS.orbit; flyTo(v.pos, v.tgt); }
  function focus(p, dist = 7) { const dir = camera.position.clone().sub(controls.target).normalize(); flyTo([p[0] + dir.x * dist, Math.max(1.2, p[1] + dir.y * dist), p[2] + dir.z * dist], p, 700); }
  function setAutoRotate(on) { controls.autoRotate = on && !reducedMotion(); }

  // ---- picking
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
  function pickAt(ev) { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); const hits = ray.intersectObjects(pickables, false); for (const hit of hits) { if (!hit.object.parent.visible) continue; if (clipOn && hit.point.z > clip.constant) continue; return { idx: hit.object.userData.piece, point: [hit.point.x, hit.point.y, hit.point.z] }; } const g = ray.intersectObject(ground, false)[0]; return g ? { idx: -1, point: [g.point.x, 0, g.point.z] } : null; }
  let lastMove = 0;
  renderer.domElement.addEventListener('pointermove', (ev) => { const now = performance.now(); if (now - lastMove < 40 || ev.buttons) return; lastMove = now; const h = pickAt(ev); hooks.onHover?.(h, ev); });
  renderer.domElement.addEventListener('pointerleave', () => hooks.onHover?.(null));
  renderer.domElement.addEventListener('pointerdown', (ev) => { down = [ev.clientX, ev.clientY]; });
  renderer.domElement.addEventListener('pointerup', (ev) => { if (!down) return; const moved = Math.hypot(ev.clientX - down[0], ev.clientY - down[1]); down = null; if (moved < 5) hooks.onPick?.(pickAt(ev), ev); });

  // ---- loop
  let raf = 0, last = 0, W = 1, H = 1, fps = 60;
  const ro = new ResizeObserver(() => resize()); ro.observe(host);
  function resize() { const r = host.getBoundingClientRect(); if (!r.width || !r.height) return; W = r.width; H = r.height; renderer.setSize(W, H, false); renderer.domElement.style.width = W + 'px'; renderer.domElement.style.height = H + 'px'; camera.aspect = W / H; camera.updateProjectionMatrix(); dMat.uniforms.uScale.value = H * 0.9; }
  function frame(now) {
    raf = requestAnimationFrame(frame); const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now; fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
    hooks.onFrame?.(dt, now);
    if (tween) { tween.t += dt * 1000 / tween.ms; const k = Math.min(1, tween.t), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e); if (k >= 1) tween = null; }
    controls.update(); stepDust(dt);
    for (const r of routes) { if (r.t >= 1) continue; r.t = Math.min(1, r.t + dt * r.speed / Math.max(0.5, r.len)); r.mesh.geometry.setDrawRange(0, Math.floor(r.total * r.t / 60) * 60); r.tip.position.copy(r.curve.getPoint(r.t)); }
    renderer.render(scene, camera); projectLabels(W, H);
  }
  function start() { if (!raf) { last = performance.now(); resize(); raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  function dispose() { stop(); ro.disconnect(); renderer.dispose(); }
  return { setPile, addPiece, trim, sync, puff, setXray, setSelected, setHovered, setTints, setSection, showVoids, showProtected, showForces, showGhost, showZones, showRoutes, showShorePreview, clearLayer, setLabel, removeLabel, setCamera, focus, flyTo, setAutoRotate, start, stop, dispose, resize, get fps() { return fps; }, get userMoved() { return userMoved; }, three: { scene, camera, renderer } };
}
