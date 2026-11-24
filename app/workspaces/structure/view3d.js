// Structure lab: the 3-D view. It draws what the physics and the analysis hand it; it measures nothing itself.
// Dust, thrown chips and chipped edges are drawn only: the physics runs on clean boxes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as L3 from './look.js';

export function createView(host, ctx, hooks = {}) {
  const { cssVar, reducedMotion } = ctx.kit;
  const col = (name) => new THREE.Color(cssVar(name) || '#888');
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
  let dpr = Math.min(1.5, devicePixelRatio || 1); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.localClippingEnabled = true;
  renderer.domElement.className = 'structure-canvas'; renderer.domElement.setAttribute('aria-label', '3-D view of the simulated bay and its rubble pile. Drag to orbit, scroll to zoom, click a piece to select it.'); renderer.domElement.setAttribute('role', 'img'); renderer.domElement.tabIndex = 0;
  host.append(renderer.domElement);
  const labelLayer = document.createElement('div'); labelLayer.className = 'structure-labels'; host.append(labelLayer);
  const scene = new THREE.Scene();
  const TX = L3.textures(), sky = L3.makeSky(); scene.add(sky);
  { const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene(), s2 = L3.makeSky(); s2.material.uniforms.uGain.value = 1.0; es.add(s2); scene.environment = pm.fromScene(es, 0.02).texture; scene.environmentIntensity = 0.95; pm.dispose(); }
  const camera = new THREE.PerspectiveCamera(34, 1, 0.15, 500); camera.position.set(-17, 6.4, 13);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.07; controls.target.set(0, 2.2, 0); controls.minDistance = 2.5; controls.maxDistance = 46; controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.autoRotate = !reducedMotion(); controls.autoRotateSpeed = 0.35;
  let userMoved = false; controls.addEventListener('start', () => { userMoved = true; controls.autoRotate = false; hooks.onCamera?.(); });

  const hemi = new THREE.HemisphereLight(0x9aa6b8, 0x4a3b2c, 0.5); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb877, 6.4); sun.position.copy(L3.SUN_DIR).multiplyScalar(46); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 10.5, bottom: -9, near: 8, far: 90 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3.2; scene.add(sun, sun.target); sun.target.position.set(0, 1, 0);
  const fill = new THREE.DirectionalLight(0xb9c6da, 0.55); fill.position.set(-16, 11, 14); scene.add(fill);
  const world = L3.makeSurroundings(TX), ground = world.ground; scene.add(world.group);
  // survey grid (Advanced only)
  const survey = new THREE.Group(); survey.visible = false; scene.add(survey);
  { const pts = []; for (let i = -12; i <= 12; i++) pts.push(i, 0.012, -12, i, 0.012, 12, -12, 0.012, i, 12, 0.012, i); const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); survey.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false })));
    const sb = [-5, 0.02, 7.2, 0, 0.02, 7.2]; for (let i = 0; i <= 5; i++) sb.push(-5 + i, 0.02, 7.2, -5 + i, 0.02, i % 5 ? 7.32 : 7.42); const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sb, 3)); survey.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }))); }

  // particles
  const dustScene = new THREE.Scene(), dust = L3.makeDust(), chunks = L3.makeChunks(TX); dustScene.add(dust.points); scene.add(chunks.mesh);
  const post = L3.makePost(renderer);

  // materials
  const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6); let clipOn = false;
  const rust = L3.rustMat(clip);
  const steel = new THREE.MeshStandardMaterial({ color: 0x8d9299, roughness: 0.28, metalness: 0.95 }), steelDark = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.7 }), rubber = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.7 });
  const TONES = [0xc9c2b6, 0xbdb7ad, 0xd0c8ba, 0xb3afa8];
  function matFor(p) {
    const tone = TONES[p.idx % 4]; let o;
    if (p.kind === 'plank') o = { tex: TX.conc, scale: 0.55, tint: tone, dust: 0.75 };
    else if (p.kind === 'beam' || p.kind === 'column') o = { tex: TX.form, scale: 0.6, tint: tone, dust: 0.65 };
    else if (p.kind === 'debris') o = { tex: TX.rough, scale: 0.9, bump: 1.4, tint: 0xbdb3a4, dust: 0.6 };
    else if (p.kind === 'wall') o = { tex: TX.brick, scale: 0.82, bump: 1.3, tint: 0x9c5136, tint2: 0xa79f92, dust: 0.55 };
    else if (p.kind === 'content') o = p.sub === 'cabinet' ? { tex: TX.conc, scale: 0.4, bump: 0.12, tint: 0x56646e, rough: 0.5, metal: 0.5, dust: 0.6 } : { tex: TX.wood, scale: 0.7, bump: 0.2, tint: 0x8c6644, rough: 0.6, dust: 0.65 };
    else o = { tex: TX.wood, scale: 0.8, bump: 0.35, tint: 0xd9ab68, rough: 0.72, dust: 0.2 };
    const m = L3.surface({ ...o, clip }); m.userData.u.uOff.value.set((p.idx * 1.37) % 5, (p.idx * 0.71) % 5, (p.idx * 2.13) % 5); return m;
  }
  const root = new THREE.Group(); scene.add(root);
  const overlay = new THREE.Group(); scene.add(overlay);
  let items = [];   // per piece: { group, meshes, mats }
  const pickables = [], plankCache = new Map();
  function plankShared(h, idx) { const k = h.map((x) => x.toFixed(3)).join() + ':' + idx % 5; let g = plankCache.get(k); if (!g) { g = L3.plankGeo(h, 11 + idx % 5); plankCache.set(k, g); } return g; }

  function buildPiece(p) {
    const group = new THREE.Group(), meshes = [], mats = [], soft = [];
    const add = (geo, mat, pos) => { const m = new THREE.Mesh(geo, mat); if (pos) m.position.set(pos[0], pos[1], pos[2]); m.castShadow = m.receiveShadow = true; m.userData.piece = p.idx; group.add(m); meshes.push(m); if (!mats.includes(m.material) && m.material.userData.u) mats.push(m.material); return m; };
    if (p.kind === 'shore') buildShore(p, add);
    else if (p.kind === 'plank') add(plankShared(p.boxes[0].h, p.idx), matFor(p));
    else if (p.kind === 'content' && !p.crushed) buildContent(p, add);
    else { const mat = matFor(p); for (const b of p.boxes) add(L3.chipBox(b.h, p.idx + 1, { amp: p.kind === 'content' ? 0.02 : p.kind === 'debris' ? 0.11 : p.kind === 'wall' ? 0.045 : p.broken ? 0.032 : 0.016, step: p.kind === 'debris' ? 0.09 : p.kind === 'wall' ? 0.22 : 0.3, edge: p.kind === 'debris' ? 0.035 : 0.05, ragged: p.broken ? [[1, p.broken === 'top' ? 1 : -1, 0.3]] : p.kind === 'wall' ? [[1, 1, 0.025]] : p.crushed ? [[1, 1, 0.1]] : [] }), mat, b.o); }
    // reinforcement: strands out of the plank ends, bent bars out of a burst column, a bar or two through a chunk
    const list = [], b = p.boxes[0], rr = L3.rng(p.idx * 31 + 7);
    if (p.kind === 'plank') for (const s of [1, -1]) for (let k = 0; k < 5; k++) { if (rr() < 0.35) continue; list.push([-b.h[0] + 2 * b.h[0] * (k + 1) / 6, -b.h[1] * 0.62, s * (b.h[2] - 0.08), 0, 0, s, 0.0075, 0.34]); }
    if (p.broken) { const s = p.broken === 'top' ? 1 : -1; for (let k = 0; k < 8; k++) { const a = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]][k]; list.push([a[0] * (b.h[0] - 0.05), s * (b.h[1] - 0.14), a[1] * (b.h[2] - 0.05), a[0] * 0.16, s * 0.97, a[1] * 0.16, 0.0125, 0.62]); } }
    if (p.kind === 'debris') for (let k = 0; k < 2; k++) list.push([(rr() - 0.5) * 0.1, (rr() - 0.5) * 0.3, (rr() - 0.5) * 0.1, rr() - 0.5, rr() - 0.5, rr() - 0.5, 0.011, 0.46].map((v, i, A) => (i > 2 && i < 6 ? v / (Math.hypot(A[3], A[4], A[5]) || 1) : v)));
    if (p.kind === 'beam' && !p.fixed) for (const s of [1, -1]) for (let k = 0; k < 4; k++) list.push([s * (b.h[0] - 0.06), (k % 2 ? 1 : -1) * 0.14, (k < 2 ? 1 : -1) * 0.24, s, 0, 0, 0.0115, 0.4]);
    if (list.length) { const g = L3.bars(list, p.idx + 1); if (g) { const m = new THREE.Mesh(g, rust); m.castShadow = true; m.receiveShadow = true; group.add(m); soft.push(m); } }
    root.add(group); for (const m of meshes) pickables.push(m);
    return { group, meshes, mats, soft };
  }
  function buildContent(p, add) {
    const [hx, hy, hz] = p.boxes[0].h, mat = matFor(p);
    if (p.sub === 'cabinet') { add(L3.chipBox([hx, hy, hz], p.idx, { amp: 0.006 }), mat); const dm = L3.surface({ tex: TX.conc, scale: 0.4, bump: 0.1, tint: 0x6d7a84, rough: 0.45, metal: 0.5, dust: 0.4, clip }); for (let k = 0; k < 4; k++) for (const s of [-1, 1]) { add(new THREE.BoxGeometry(hx * 0.92, hy * 2 / 4 - 0.03, 0.014), dm, [s * hx * 0.5, -hy + hy * 2 * (k + 0.5) / 4, hz + 0.004]); add(new THREE.BoxGeometry(0.12, 0.018, 0.022), steel, [s * hx * 0.5, -hy + hy * 2 * (k + 0.72) / 4, hz + 0.02]); } }
    else { add(L3.chipBox([hx, 0.022, hz], p.idx, { amp: 0.01 }), mat, [0, hy - 0.022, 0]); for (const s of [-1, 1]) add(L3.chipBox([0.2, hy - 0.03, hz * 0.9], p.idx + s, { amp: 0.008 }), mat, [s * (hx - 0.24), -0.02, 0]); add(new THREE.BoxGeometry(2 * hx - 0.9, 0.35, 0.02), mat, [0, 0.12, -hz * 0.8]); }
  }
  function buildShore(p, add) {
    const b = p.boxes[0], mat = matFor(p), addBox = (h, pos) => add(L3.chipBox(h, p.idx + pos[0] * 9 + pos[1], { amp: 0.008, step: 0.4, edge: 0.012 }), mat, pos);
    if (p.sub === 'crib') { const t = 0.045, n = Math.max(2, Math.round(b.h[1] / t)), lt = b.h[1] / n; for (let i = 0; i < n; i++) { const y = -b.h[1] + lt * (2 * i + 1); for (const s of [-1, 1]) addBox(i % 2 ? [b.h[0], lt * 0.96, 0.045] : [0.045, lt * 0.96, b.h[2]], i % 2 ? [0, y, s * (b.h[2] - 0.06)] : [s * (b.h[0] - 0.06), y, 0]); } }
    else { addBox([0.07, b.h[1] - 0.09, 0.07], [0, 0, 0]); addBox([0.34, 0.045, 0.07], [0, b.h[1] - 0.045, 0]); addBox([0.34, 0.045, 0.07], [0, -b.h[1] + 0.045, 0]); for (const s of [-1, 1]) { addBox([0.012, 0.16, 0.085], [s * 0.084, b.h[1] - 0.2, 0]); addBox([0.012, 0.16, 0.085], [s * 0.084, -b.h[1] + 0.2, 0]); addBox([0.07, 0.018, 0.045], [s * 0.1, -b.h[1] + 0.11, 0]); } }
  }
  // film: full columns that stand in for the burst ones until they burst
  const covers = new THREE.Group(); scene.add(covers);
  function setCovers(pieces) { covers.clear(); const seen = new Set(); for (const p of pieces) { if (p.kind !== 'column' || p.meta?.seg == null) continue; const k = p.meta.i + ':' + p.meta.j; if (seen.has(k)) continue; seen.add(k); const h = [0.2, 1.275, 0.2], m = new THREE.Mesh(L3.chipBox(h, p.idx + 1, { amp: 0.016 }), matFor({ ...p, kind: 'column' })); m.castShadow = m.receiveShadow = true; m.position.set(p.home[0], 1.275, p.home[2]); covers.add(m); } }
  function showCovers(on, pieces) { if (covers.visible === on && covers.userData.n === items.length) return; covers.visible = on; covers.userData.n = items.length; for (const p of pieces) if ((p.kind === 'column' && p.meta?.seg != null) || p.kind === 'debris') items[p.idx].group.visible = !on; }
  const rayO = new THREE.Raycaster(), rd = new THREE.Vector3();
  function blockers(from, to) { const o = new THREE.Vector3(...from), t = new THREE.Vector3(...to); rd.subVectors(t, o); const len = rd.length(); rayO.set(o, rd.normalize()); rayO.far = len - 0.15; scene.updateMatrixWorld(); const s = new Set(); for (const h of rayO.intersectObjects(pickables, false)) if (h.object.parent.visible) s.add(h.object.userData.piece); rayO.far = Infinity; return s; }
  function setPile(pile) {
    covers.clear(); covers.visible = false;
    for (const it of items) { root.remove(it.group); it.group.traverse((o) => { if (o.geometry && ![...plankCache.values()].includes(o.geometry)) o.geometry.dispose(); }); for (const m of it.mats) m.dispose(); }
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
  const SEL = new THREE.Color(0x4f8fe8), HOV = new THREE.Color(0x3a5878);
  function applyLook(idx) {
    const it = items[idx]; if (!it) return; const t = tints.get(idx), sel = idx === selected, hov = idx === hovered, ghost = xray && !sel && !t;
    const c = sel ? SEL : t ? t.color : HOV, k = sel ? 0.75 : t ? t.k : hov ? 0.5 : 0;
    for (const m of it.mats) { const u = m.userData.u; u.uGhost.value = ghost ? 1 : 0; m.transparent = ghost; m.depthWrite = !ghost; u.uHeat.value.set(c.r, c.g, c.b, k); }
    for (const mesh of it.meshes) mesh.castShadow = !ghost; for (const s of it.soft) s.visible = !ghost;
  }
  // film: direct control of one piece's glow and glass, no allocation
  function setHeat(idx, r, g, b, k) { const it = items[idx]; if (it) for (const m of it.mats) m.userData.u.uHeat.value.set(r, g, b, k); }
  function setGhost(idx, k) { const it = items[idx]; if (!it) return; const on = k > 0.002; for (const m of it.mats) { m.userData.u.uGhost.value = k; if (m.transparent !== on) { m.transparent = on; m.depthWrite = !on; m.needsUpdate = false; } } for (const s of it.soft) s.visible = k < 0.6; for (const mesh of it.meshes) mesh.castShadow = k < 0.5; }
  const refreshLooks = () => { for (let i = 0; i < items.length; i++) applyLook(i); };
  function setXray(on) { xray = on; refreshLooks(); setNight(on ? 1 : 0); }
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
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(g.res * 0.9, g.res * 0.9, g.res * 0.9), new THREE.MeshBasicMaterial({ transparent: true, opacity: Math.min(0.12, 2.2 / Math.sqrt(count || 1)), depthWrite: false, blending: THREE.AdditiveBlending, clippingPlanes: [clip] }), count);
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
    setLabel('prot', 'Believed position', [box.c[0], box.c[1] - box.h[1] - 0.3, box.c[2]], { layer: 'prot', cls: 'is-person', anchor: box.c });
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

  // ---- dust and chips on a clock (drawn only). Group 0 is the live pile; the film uses its own groups.
  function puff(e, t) { if (reducedMotion()) return; dust.emit(0, t, e.x, e.y, e.z, e.s, e.r); chunks.emit(0, t, e.x, e.y, e.z, e.s * 0.7, e.r); fxDirty = true; }
  function emitAll(group, list, t0 = 0) { for (const [f, x, y, z, s, r] of list) { const t = t0 + f / 60, sd = f * 977 + x * 131 + z * 17 + 5000; if (!reducedMotion()) dust.emit(group, t, x, y, z, s, r, sd); chunks.emit(group, t, x, y, z, s, r, sd); } fxDirty = true; }
  function setClock(group, t) { dust.setClock(group, t); chunks.setClock(group, t); }
  function clearFx() { dust.clear(); chunks.clear(); chunks.scatter(760, 4.2, 12, 5); chunks.scatter(260, 0, 5, 9); fxDirty = true; }
  let fxDirty = true; clearFx();

  // ---- film props: the person, the jack, the load path
  const person = new THREE.Group(); person.visible = false; scene.add(person);
  const pGeo = L3.personGeo(), pMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, emissive: 0xff7a2c, emissiveIntensity: 0.12 });
  const pBody = new THREE.Mesh(pGeo, pMat); pBody.castShadow = pBody.receiveShadow = true;
  const pGlow = new THREE.Mesh(pGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth, blending: THREE.AdditiveBlending, uniforms: { uK: { value: 0 } }, vertexShader: 'varying vec3 vN, vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); mv.xyz *= 1.0 - 0.5 / length(mv.xyz); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }', fragmentShader: 'uniform float uK; varying vec3 vN, vV; void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(vec3(1.0, 0.42, 0.12) * (0.05 + 1.0 * pow(f, 2.2)) * uK, 1.0); }' })); pGlow.renderOrder = 20;
  const pLight = new THREE.PointLight(0xff8a3c, 0, 4.2, 1.7); person.add(pBody, pGlow, pLight); pLight.position.set(0.1, 0.62, -0.1);
  function setPerson(box, k = 0) { person.visible = !!box; if (!box) return; person.position.set(box.c[0], 0.135, box.c[2]); person.rotation.y = box.yaw || 0; pGlow.material.uniforms.uK.value = k; pLight.intensity = 0.4 + 1.25 * k; pMat.emissiveIntensity = 0.02 + 0.05 * k; }
  const jack = new THREE.Group(), jHead = new THREE.Group(); jack.visible = false; scene.add(jack); let jPiston = null, jTop = 0, jBodyTop = 0;
  function buildJack(s) {
    jack.clear(); jHead.clear(); const gap = s.top - s.bottom, cribH = Math.max(0, gap - 0.42), wood = L3.surface({ tex: TX.wood, scale: 0.8, bump: 0.35, tint: 0xcf9d5c, rough: 0.75, dust: 0.25 }), n = Math.max(0, Math.round(cribH / 0.1)); const M = (g, m, y, x = 0, z = 0) => { const q = new THREE.Mesh(g, m); q.position.set(x, y, z); q.castShadow = q.receiveShadow = true; jack.add(q); return q; };
    for (let i = 0; i < n; i++) for (const t of [-1, 1]) M(L3.chipBox(i % 2 ? [0.32, cribH / n / 2 - 0.002, 0.05] : [0.05, cribH / n / 2 - 0.002, 0.32], i * 3 + t, { amp: 0.008, step: 0.4, edge: 0.012 }), wood, (i + 0.5) * cribH / n, i % 2 ? 0 : t * 0.2, i % 2 ? t * 0.2 : 0);
    const bh = gap - cribH, b0 = cribH; M(new THREE.BoxGeometry(0.34, 0.03, 0.34), steelDark, b0 + 0.015); const red = new THREE.MeshStandardMaterial({ color: 0x7c1f14, roughness: 0.42, metalness: 0.35 }); jBodyTop = b0 + bh * 0.66; M(new THREE.CylinderGeometry(0.1, 0.115, bh * 0.63, 28), red, b0 + 0.03 + bh * 0.315); M(new THREE.CylinderGeometry(0.106, 0.106, 0.03, 28), steelDark, jBodyTop); M(new THREE.TorusGeometry(0.104, 0.008, 8, 28).rotateX(Math.PI / 2), steel, b0 + bh * 0.3); M(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 10).rotateZ(Math.PI / 2), steel, b0 + 0.09, 0.14);
    jPiston = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 1, 24), steel); jPiston.castShadow = true; jack.add(jPiston);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.045, 24), steelDark); plate.castShadow = true; const knurl = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.02, 24), steel); knurl.position.y = 0.03; jHead.add(plate, knurl); jack.add(jHead);
    const hose = new THREE.CatmullRomCurve3([new THREE.Vector3(0.18, b0 + 0.09, 0), new THREE.Vector3(-0.35, b0 * 0.4 + 0.08, 0.2), new THREE.Vector3(-0.95, 0.03, 0.5), new THREE.Vector3(-1.9, 0.03, 0.7), new THREE.Vector3(-2.9, 0.03, 1.8), new THREE.Vector3(-4.6, 0.03, 2.1)]); const hm = new THREE.Mesh(new THREE.TubeGeometry(hose, 60, 0.018, 8), rubber); hm.castShadow = true; hm.rotation.y = 0; jack.add(hm);
    jack.position.set(s.x, s.bottom, s.z); jack.visible = true; setJackY(s.top - 0.034, s);
  }
  function buildJackOnce(s) { if (!s) return; if (jack.userData.key !== s.x + ':' + s.z) { jack.userData.key = s.x + ':' + s.z; buildJack(s); } jack.visible = true; jack.position.set(s.x, s.bottom, s.z); }
  function setJackY(y, s) { const top = y - s.bottom; jHead.position.y = top; jPiston.scale.y = Math.max(0.02, top - jBodyTop); jPiston.position.y = (top + jBodyTop) / 2; }
  const NL = 180, fGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), fMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 }, uK: { value: 1 } },
    vertexShader: 'attribute vec4 iC; varying vec4 vC; varying float vY; void main(){ vC = iC; vY = position.y + 0.5; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uT, uK; varying vec4 vC; varying float vY; void main(){ float d = fract(vY * vC.a * 2.2 + uT * 0.9); float p = smoothstep(0.0, 0.25, d) * smoothstep(1.0, 0.45, d); gl_FragColor = vec4(vC.rgb * (0.35 + 1.9 * p) * uK, 1.0); }' });
  const fMesh = new THREE.InstancedMesh(fGeo, fMat, NL), fCol = new THREE.InstancedBufferAttribute(new Float32Array(NL * 4), 4); fGeo.setAttribute('iC', fCol); fMesh.frustumCulled = false; fMesh.count = 0; fMesh.renderOrder = 18; scene.add(fMesh);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vd = new THREE.Vector3(), vq = new THREE.Quaternion(), vs = new THREE.Vector3(), vm = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
  // edges: packed [a, b, F, x, y, z] * K from the recording; poses at that instant; only contacts at least fMin newtons
  function drawLoad(edges, off, K, poses, k, fMin = 1500, near = null) {
    let n = 0; if (k > 0.01) for (let i = 0; i < K && n < NL - 2; i++) { const o = off + i * 6, F = edges[o + 2]; if (edges[o] < 0 || F < fMin) continue; const x = edges[o + 3], y = edges[o + 4], z = edges[o + 5]; let fade = 1; if (near) { const d = Math.hypot(x - near.x, z - near.z); fade = Math.max(0, Math.min(1, (near.r - d) / 1.2)); if (fade <= 0) continue; }
      const t = Math.min(1, Math.log(F / fMin) / 4.2), rad = 0.0028 + 0.0105 * t;
      for (let s = 0; s < 2; s++) { const id = edges[o + s]; if (id < 0) { if (s) continue; va.set(x, 0, z); } else { const p = id * 7; va.set(poses[p], poses[p + 1], poses[p + 2]); } vb.set(x, y, z); if (va.y < vb.y) { vd.copy(va); va.copy(vb); vb.copy(vd); } vd.subVectors(va, vb); const len = vd.length(); if (len < 0.02) continue; vq.setFromUnitVectors(UP, vd.divideScalar(len)); vs.set(rad, len, rad); vm.compose(va.add(vb).multiplyScalar(0.5), vq, vs); fMesh.setMatrixAt(n, vm); fCol.setXYZW(n, 1.0 * fade, (0.16 + 0.5 * (1 - t) * 0.6 + 0.3 * t * t) * fade, (0.03 + 0.2 * t * t) * fade, len); n++; } }
    fMesh.count = n; fMat.uniforms.uK.value = k; if (n) { fMesh.instanceMatrix.needsUpdate = true; fCol.needsUpdate = true; }
  }
  // a shore brought in by hand: t = 0 outside the pile, 1 wedged home
  function placeAnim(idx, probe, t, from) { const it = items[idx]; if (!it) return; it.group.visible = t > 0; const a = Math.min(1, t / 0.7), e = 1 - Math.pow(1 - a, 3), u = Math.max(0, (t - 0.7) / 0.3), eu = u * u * (3 - 2 * u); it.group.position.set(probe.x + from[0] * (1 - e), probe.bottom + probe.h / 2 - 0.10 * (1 - eu) , probe.z + from[1] * (1 - e)); it.group.rotation.set(0, (1 - e) * 0.9, (1 - e) * 0.5); it.group.scale.y = 1; }

  // ---- camera moves
  let tween = null;
  const VIEWS = { orbit: { pos: [-17, 7.2, 13.5], tgt: [0, 2, 0] }, top: { pos: [0.01, 27, 0.02], tgt: [0, 0, 0] }, side: { pos: [25, 3.6, 0.01], tgt: [0, 2.6, 0] }, front: { pos: [0.01, 3.6, 25], tgt: [0, 2.6, 0] } };
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
  let raf = 0, last = 0, W = 1, H = 1, fps = 60, slow = 0, fast = 0, T0 = performance.now(), film = null;
  const ro = new ResizeObserver(() => resize()); ro.observe(host);
  function resize() { const r = host.getBoundingClientRect(); if (!r.width || !r.height) return; W = r.width; H = r.height; renderer.setPixelRatio(dpr); renderer.setSize(W, H, false); renderer.domElement.style.width = W + 'px'; renderer.domElement.style.height = H + 'px'; camera.aspect = W / H; camera.updateProjectionMatrix(); post.setSize(W * dpr, H * dpr); }
  function adapt(ms) { // keep 60 frames a second: give up pixels before frames
    if (ms > 21) { slow++; fast = 0; } else { fast++; slow = Math.max(0, slow - 0.35); }
    if (slow > 26 && dpr > 0.75) { dpr = Math.max(0.75, dpr - 0.18); slow = 0; resize(); }
  }
  function frame(now) {
    raf = requestAnimationFrame(frame); const raw = now - last, dt = Math.min(0.05, raw / 1000 || 0.016); last = now; fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05; if (raw < 120) adapt(raw);
    const time = (now - T0) / 1000; fMat.uniforms.uT.value = time;
    hooks.onFrame?.(dt, now);
    if (tween) { tween.t += dt * 1000 / tween.ms; const k = Math.min(1, tween.t), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e); if (k >= 1) tween = null; }
    if (film) { film(dt, time); if (!controls.enabled) camera.lookAt(controls.target); else controls.update(); } else controls.update();
    if (fxDirty) { fxDirty = false; dust.flush(); chunks.flush(); }
    for (const r of routes) { if (r.t >= 1) continue; r.t = Math.min(1, r.t + dt * r.speed / Math.max(0.5, r.len)); r.mesh.geometry.setDrawRange(0, Math.floor(r.total * r.t / 60) * 60); r.curve.getPoint(r.t, r.tip.position); }
    camera.updateMatrixWorld(); post.render(scene, camera, sun, dustScene, dust.mat, time); projectLabels(W, H);
  }
  // Demo is lit for film; Advanced keeps the same place but with less haze and more fill, so it can be read.
  let lookMode = 'demo';
  function setLook(mode) { setNight(0); lookMode = mode; const d = mode === 'demo'; sun.color.set(d ? 0xffb877 : 0xffe6cc); survey.visible = !d; post.uni.atm.uHaze.value = d ? 0.0115 : 0.004; post.uni.atm.uShaft.value = d ? 1.6 : 1.1; post.uni.fin.uVig.value = d ? 0.6 : 0.25; hemi.intensity = d ? 0.95 : 1.4; fill.intensity = d ? 0.75 : 1.5; sun.intensity = d ? 6.6 : 4.4; post.uni.fin.uExp.value = d ? 0.96 : 1.05; dust.mat.uniforms.uMul.value = d ? 1 : 0.7; }
  // the x-ray chapters: the sun goes out and the pile turns to glass
  function setNight(k) { if (Math.abs(L3.XR.value - k) < 0.003 && k) return; if (!k && !L3.XR.value) return; L3.XR.value = k; const mx = (a, b) => a + (b - a) * k, a = post.uni.atm, d = lookMode === 'demo'; sun.intensity = mx(d ? 6.6 : 4.4, 0.0); hemi.intensity = mx(d ? 0.95 : 1.4, 0.10); scene.environmentIntensity = mx(0.95, 0.03); fill.intensity = mx(d ? 0.75 : 1.5, 0.12); sky.material.uniforms.uGain.value = a.uGain.value = mx(1, 0.035); a.uHaze.value = mx(d ? 0.0115 : 0.004, 0.0025); a.uShaft.value = mx(d ? 1.6 : 1.1, 0.0); dust.mat.uniforms.uMul.value = mx(d ? 1 : 0.7, 0.05); }
  function setFilm(fn) { film = fn; }
  function start() { if (!raf) { last = performance.now(); resize(); raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  function dispose() { stop(); ro.disconnect(); post.dispose(); renderer.dispose(); }
  return { setCovers, showCovers, blockers, setLook, setNight, setFilm, setHeat, setGhost, emitAll, setClock, clearFx, setPerson, buildJack, setJackY, drawLoad, placeAnim, buildJackOnce, rebuildPiece, jack, person, controls, camera, post, get dpr() { return dpr; }, setTween(v) { tween = v; }, get items() { return items; }, setPile, addPiece, trim, sync, puff, setXray, setSelected, setHovered, setTints, setSection, showVoids, showProtected, showForces, showGhost, showZones, showRoutes, showShorePreview, clearLayer, setLabel, removeLabel, setCamera, focus, flyTo, setAutoRotate, start, stop, dispose, resize, get fps() { return fps; }, get userMoved() { return userMoved; }, three: { scene, camera, renderer } };
}
