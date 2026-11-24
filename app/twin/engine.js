// The twin's engine: renderer, scene, frame loop, picking, layers, and the seam to the actors
// (docs/ARCHITECTURE.md, "Inside the twin"). The static world is built by the part modules listed in PARTS; the
// things that move come from ./actors/index.js. A part or an actor that fails is logged and left out; the rest
// of the world keeps rendering.
import * as THREE from 'three';
import * as U from './util.js';
import { createTextures } from './textures.js';
import { createMaterials } from './materials.js';
import { buildEnvironment } from './environment.js';
import { loadTerrain } from './terrain.js';
import { loadPhotos } from './photos.js';
import { createCameras, MODES } from './cameras.js';
import { createLabels } from './labels.js';
import { createPost, makeGlow } from './post.js';

const PARTS = ['building', 'rubble', 'interior', 'massing', 'site', 'debris'];      // each: export function build(env) -> { group?, update?, setLayer?, dispose? }
const LAYERS = [
  { id: 'walls-xray', label: 'See through walls', on: false, core: true }, { id: 'roof', label: 'Roof of block B', on: true, core: true },
  { id: 'labels', label: 'Labels', on: true, core: true }, { id: 'grid', label: 'Survey grid, 10 m', on: false, core: true },
  { id: 'hazards', label: 'Hazards', on: true }, { id: 'coverage', label: 'Search coverage', on: true }, { id: 'heat', label: 'Heat behind walls', on: true },
  { id: 'sensing', label: 'Sensing beams', on: true }, { id: 'route', label: 'Routes', on: true }, { id: 'trail', label: 'Rover trail', on: true },
  { id: 'scan', label: 'Drone scan', on: true }, { id: 'truth', label: 'Ground truth (debug)', on: false },
];
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export async function createEngine(host, ctx, opts = {}) {
  const { interactive = true, quality: q0 = 'high', camera: cam0 = 'orbit', caption = true, autostart = true, actors: wantActors = true, onProgress = () => {} } = opts;
  const quality = q0 === 'low' ? 'low' : 'high', world = ctx.world, kit = ctx.kit;
  const reducedNow = () => !!(kit && kit.reducedMotion && kit.reducedMotion());

  // ---- DOM ----
  host.classList.add('twin-host'); if (!interactive) host.classList.add('static');
  const canvas = document.createElement('canvas'); canvas.className = 'twin-canvas';
  if (interactive) { canvas.tabIndex = 0; canvas.setAttribute('role', 'application'); canvas.setAttribute('aria-label', '3-D view of the search site. Drag to orbit, scroll to zoom, right-drag to move. Arrow keys orbit, W A S D move, plus and minus zoom, Home resets the view.'); }
  else { canvas.style.pointerEvents = 'none'; canvas.setAttribute('aria-hidden', 'true'); }
  const overlay = document.createElement('div'); overlay.className = 'twin-overlay';
  host.append(canvas, overlay);
  if (caption) { const c = document.createElement('div'); c.className = 'twin-caption'; c.textContent = 'Simulated training exercise. The buildings, people and damage are invented.'; host.append(c); }

  // ---- renderer ----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });   // throws without WebGL: index.js shows the message
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.autoClear = false; renderer.shadowMap.autoUpdate = false; renderer.info.autoReset = false;
  const maxPR = quality === 'high' ? 1.5 : 1.1; let pr = Math.min(maxPR, window.devicePixelRatio || 1); renderer.setPixelRatio(1);
  const scene = new THREE.Scene(); scene.name = 'twin';
  const camera = new THREE.PerspectiveCamera(38, 1.6, 0.5, 5200);
  const tex = createTextures(world, Math.min(16, renderer.capabilities.getMaxAnisotropy()));

  const layerState = Object.fromEntries(LAYERS.map((l) => [l.id, l.on]));
  // ---- labels, cameras, image pipeline ----
  // A label is hidden when the camera is down among the walls of block B and a wall stands between it and the label
  // (unless the walls are see-through). Labels for people stay: seeing them through walls is the point.
  const camXY = [0, 0], labXY = [0, 0], WALL_H = world.BUILDING.wallHeight;
  const occluded = (p) => { if (layerState['walls-xray'] || camera.position.y > WALL_H + 0.4 || p.y > WALL_H + 0.4) return false; camXY[0] = camera.position.x; camXY[1] = -camera.position.z; labXY[0] = p.x; labXY[1] = -p.z; return world.wallsCrossed(camXY, labXY).length > 0; };
  const demo = () => (ctx.mode || document.documentElement.dataset.mode) === 'demo', safe = { left: 0, top: 0, right: 0, bottom: 0 };
  const labels = createLabels(overlay, camera, { select: (sel) => ctx.select && ctx.select(sel), occluded, safe, demo });
  const hoverB = labels.bracket('hover'), selB = labels.bracket('sel');
  const t = { reduced: reducedNow() };
  const cams = createCameras({ camera, dom: canvas, ctx, world, reduced: () => t.reduced, interactive, mode: cam0 });
  const post = createPost(renderer, scene, camera, { quality });

  // ---- the t object handed to builders and actors ----
  const pickables = [], updates = [];
  Object.assign(t, {
    THREE, scene, camera, renderer, ctx, world, quality, v3: U.v3, groundY: 0,
    pickable(obj, sel) { if (!obj || !sel) return obj; obj.userData.twinSel = sel; if (!pickables.includes(obj)) pickables.push(obj); return obj; },
    unpickable(obj) { const i = pickables.indexOf(obj); if (i >= 0) pickables.splice(i, 1); },
    label(text, o) { return labels.add(text, o); },
    glow(obj, strength = 1) { return makeGlow(obj, strength); },
    addUpdate(fn) { if (typeof fn === 'function') updates.push(fn); return () => { const i = updates.indexOf(fn); if (i >= 0) updates.splice(i, 1); }; },
  });
  const env = { ...t, t, tex, mats: null, U, rng: U.rng, label: t.label, pickable: t.pickable, layer: (id) => layerState[id] };

  // ---- build the world, a part at a time so the page stays alive ----
  onProgress(0.05, 'Painting the ground'); await nextFrame();
  const [D, photos] = await Promise.all([loadTerrain(), loadPhotos(quality, Math.min(4, renderer.capabilities.getMaxAnisotropy()))]);
  env.photos = photos; env.mats = createMaterials(tex, photos);
  onProgress(0.15, 'Raising the valley'); await nextFrame();
  const environment = buildEnvironment(env, D); env.environment = environment; t.heightAt = environment.heightAt; cams.setGround(environment.heightAt);
  const parts = [];
  for (let i = 0; i < PARTS.length; i++) {
    onProgress(0.25 + 0.6 * (i / PARTS.length), ['Raising block B', 'Piling the rubble', 'Furnishing the classrooms', 'Building the neighbours', 'Setting up staging', 'Laying the silt'][i]); await nextFrame();
    try { const mod = await import('./' + PARTS[i] + '.js'); const p = mod.build(env); if (p) { p.id = PARTS[i]; parts.push(p); if (p.group && !p.group.parent) scene.add(p.group); } }
    catch (e) { console.warn('[twin] world part "' + PARTS[i] + '" was left out:', e); }
  }

  // ---- actors ----
  onProgress(0.9, 'Waking the rover'); await nextFrame();
  const actors = [];
  if (wantActors) try {
    const mod = await import('./actors/index.js');
    for (const def of mod.ACTORS || []) {
      if (!def || typeof def.create !== 'function') continue;
      try { const inst = def.create(t) || {}; actors.push({ def, inst, errors: 0 }); }
      catch (e) { console.warn('[twin] actor "' + def.id + '" failed to start and was left out:', e); }
    }
  } catch (e) { console.warn('[twin] no actors loaded (app/twin/actors/index.js):', e); }
  const callActor = (a, fn, ...args) => {
    if (a.dead || typeof a.inst[fn] !== 'function') return;
    try { a.inst[fn](...args); a.errors = 0; }
    catch (e) { if (++a.errors === 1) console.warn('[twin] actor "' + a.def.id + '" threw in ' + fn + '():', e); if (a.errors > 30) { a.dead = true; console.warn('[twin] actor "' + a.def.id + '" keeps failing and has been switched off.'); } }
  };

  // Switching a light off changes how many lights every material is compiled for, which would stall the picture. So a
  // light that an actor hides stays in the scene at zero brightness instead.
  scene.traverse((l) => { if (!l.isLight) return; let vis = l.visible, k = l.intensity; Object.defineProperty(l, 'visible', { configurable: true, get: () => true, set: (v) => { vis = v; } }); Object.defineProperty(l, 'intensity', { configurable: true, get: () => (vis ? k : 0), set: (v) => { k = v; } }); });

  // ---- layers ----
  let roofManual = false, phase = '';
  function applyLayer(id, on) {
    if (id === 'labels') labels.setEnabled(on);
    else if (id === 'grid') environment.setGrid(on);
    for (const p of parts) { try { p.setLayer && p.setLayer(id, on); } catch (e) { console.warn('[twin] part ' + p.id, e); } }
    for (const a of actors) if (!a.def.layers || a.def.layers.includes(id)) callActor(a, 'setLayer', id, on);
  }
  // Demo shows the picture, not the instruments: search cells and the grid stay out of it, and hazards wait until the route needs them.
  const chosen = new Set(), quiet = (id) => demo() && !chosen.has(id) && (id === 'coverage' || id === 'grid' || (id === 'hazards' && !['plan', 'rescue', 'complete'].includes(ctx.sim && ctx.sim.state && ctx.sim.state.phase))), eff = {};
  function sync(force) { for (const l of LAYERS) { const on = layerState[l.id] && !quiet(l.id); if (force || eff[l.id] !== on) { eff[l.id] = on; applyLayer(l.id, on); } } }
  const tell = () => { ctx.bus && ctx.bus.emit('twin:layers', { layers: api.layers() }); };
  function setLayer(id, on) { if (!(id in layerState)) return false; on = !!on; if (id === 'roof') roofManual = true; if (id === 'grid') chosen.add(id); layerState[id] = on; sync(); tell(); return true; }
  sync(true);

  // ---- selection and picking ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); ray.params.Points.threshold = 0.25; ray.params.Line.threshold = 0.2;
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const selOf = (o) => { for (let p = o; p; p = p.parent) if (p.userData && p.userData.twinSel) return p; return null; };
  function pick(cx, cy) {
    const r = canvas.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    for (let i = pickables.length - 1; i >= 0; i--) if (!pickables[i].parent) pickables.splice(i, 1);
    let hits; try { hits = ray.intersectObjects(pickables, true); } catch (e) { return null; }
    for (const h of hits) { if (!shown(h.object)) continue; const o = selOf(h.object); if (o) return { object: o, sel: o.userData.twinSel, point: h.point }; }
    return null;
  }
  function nameOf(sel) {
    const S = ctx.sim && ctx.sim.state; if (!sel) return '';
    if (sel.type === 'unit') return (S && S.units[sel.id] && S.units[sel.id].name) || sel.id;
    if (sel.type === 'room') { const r = world.roomById(sel.id); return r ? r.name : sel.id; }
    if (sel.type === 'hazard') { const hz = [...world.HAZARDS, ...((S && S.hazards) || [])].find((x) => x.id === sel.id); return hz ? hz.name : 'Hazard'; }
    if (sel.type === 'stop') { const s = world.STOPS.find((x) => x.id === sel.id); return s ? 'Listening stop ' + s.id.replace('S', '') : sel.id; }
    if (sel.type === 'detection') { const d = S && S.detections.find((x) => x.id === sel.id); return d ? (d.status === 'confirmed' ? 'Person found' : d.status === 'rejected' ? 'Ruled out' : 'Possible person') + ' (' + Math.round(d.p * 100) + ' %)' : 'Detection'; }
    if (sel.type === 'survivor') return 'Person ' + sel.id;
    return sel.label || '';
  }
  const same = (a, b) => a && b && a.type === b.type && a.id === b.id;
  function markSelection(sel) { const o = sel && (pickables.find((p) => same(p.userData.twinSel, sel) && shown(p)) || pickables.find((p) => same(p.userData.twinSel, sel))); selB.set(o || null, ''); }
  let ptr = null, hoverDirty = false, hoverSel = null, downAt = null;
  const onPtrMove = (e) => { ptr = { x: e.clientX, y: e.clientY }; hoverDirty = true; };
  const onPtrLeave = () => { ptr = null; hoverB.set(null); canvas.classList.remove('over'); hoverSel = null; };
  const onPtrDown = (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const onPtrUp = (e) => {
    if (!downAt || e.button !== 0) return; const d = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y); downAt = null; if (d > 5) return;
    const hit = pick(e.clientX, e.clientY); if (hit && ctx.select) ctx.select(hit.sel);
  };
  const onDbl = (e) => { const hit = pick(e.clientX, e.clientY); if (hit) { ctx.select && ctx.select(hit.sel); if (!cams.focus(hit.sel, ctx.sim && ctx.sim.state)) cams.flyTo(hit.point, null); } else { const p = cams.groundAt(e.clientX, e.clientY, new THREE.Vector3()); if (p && p.distanceTo(camera.position) < 600) cams.flyTo(p, Math.max(8, cams.pose.dist * 0.55)); } };
  if (interactive) { canvas.addEventListener('pointermove', onPtrMove); canvas.addEventListener('pointerleave', onPtrLeave); canvas.addEventListener('pointerdown', onPtrDown); canvas.addEventListener('pointerup', onPtrUp); canvas.addEventListener('dblclick', onDbl); }
  const offs = [];
  if (ctx.bus) {
    offs.push(ctx.bus.on('select', (sel) => { markSelection(sel); for (const a of actors) callActor(a, 'onSelect', sel); for (const p of parts) { try { p.onSelect && p.onSelect(sel); } catch (e) { /* a part's highlight is optional */ } } }));
    offs.push(ctx.bus.on('twin:camera', (p) => { if (p && p.mode) api.setCamera(p.mode); }), ctx.bus.on('twin:layer', (p) => { if (p && p.id) api.setLayer(p.id, p.on); }), ctx.bus.on('mode', () => { sync(); tell(); }));
    offs.push(ctx.bus.on('prefs', () => { t.reduced = reducedNow(); }));
    offs.push(ctx.bus.on('reset', () => { roofManual = false; }));
  }
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null, onMq = () => { t.reduced = reducedNow(); }; mq && mq.addEventListener && mq.addEventListener('change', onMq);

  // ---- size ----
  let W = 0, H = 0;
  function resize() {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight); if (w === W && h === H && renderer.userData_pr === pr) return;
    W = w; H = h; renderer.userData_pr = pr; renderer.setSize(Math.round(w * pr), Math.round(h * pr), false); post.setSize(w, h, pr);
  }
  const ro = new ResizeObserver(() => { resize(); if (!running && !disposed) frame(performance.now(), true); }); ro.observe(host);

  // ---- the frame ----
  let running = false, disposed = false, raf = 0, last = 0, time = 0, slow = 0, frames = 0, ms = 16, lost = false;
  const stats = { fps: 60, ms: 16, calls: 0, triangles: 0, pr };
  function frame(nowMs, once = false) {
    if (disposed) return; if (!once) raf = requestAnimationFrame(frame);
    if (lost || !host.isConnected || host.clientWidth < 2 || host.clientHeight < 2) { last = nowMs; return; }
    const raw = last ? (nowMs - last) / 1000 : 0.016; last = nowMs; const dt = Math.min(0.1, Math.max(0, raw)); time += dt; frames++;
    if (!once) { ms += (raw * 1000 - ms) * 0.05; if (ms > 19.5 && frames > 120) { if (++slow > 70 && pr > 0.75) { pr = Math.max(0.75, pr - 0.125); slow = 0; stats.pr = pr; } } else slow = Math.max(0, slow - 2); }
    resize();
    const S = ctx.sim ? ctx.sim.state : null, animate = !t.reduced;
    if (S && !roofManual) { const want = S.phase === 'standby' || S.phase === 'aerial'; if (layerState.roof !== want) { layerState.roof = want; sync(); tell(); } }
    if (S && S.phase !== phase) { phase = S.phase; sync(); }
    cams.update(dt, S, W, H);
    environment.update(dt, time, camera, cams.pose, animate);
    for (const p of parts) { if (p.update && !p.dead) { try { p.update(dt, time, S, cams); } catch (e) { p.dead = true; console.warn('[twin] part "' + p.id + '" stopped updating:', e); } } }
    if (S) for (const a of actors) callActor(a, 'update', S, dt, time);
    for (const fn of updates) { try { fn(dt, time, S); } catch (e) { /* an update hook must not stop the frame */ } }
    if (hoverDirty && ptr && frames % 2 === 0 && !canvas.classList.contains('dragging')) {
      hoverDirty = false; const hit = pick(ptr.x, ptr.y);
      if (!same(hit && hit.sel, hoverSel)) { hoverSel = hit ? hit.sel : null; hoverB.set(hit ? hit.object : null, hit ? nameOf(hit.sel) : ''); canvas.classList.toggle('over', !!hit); }
    }
    labels.update(dt, W, H); hoverB.update(); selB.update();
    post.setFog(environment.fog); post.setFocus(camera.position.distanceTo(cams.pose.target), cams.dof, dt);
    renderer.shadowMap.needsUpdate = once || frames % 2 === 0;
    renderer.info.reset(); post.render(time);
    stats.ms = ms; stats.fps = 1000 / ms; stats.calls = renderer.info.render.calls; stats.triangles = renderer.info.render.triangles;
  }
  const onLost = (e) => { e.preventDefault(); lost = true; }, onRestored = () => { lost = false; };
  canvas.addEventListener('webglcontextlost', onLost); canvas.addEventListener('webglcontextrestored', onRestored);

  const api = {
    t, env, cams, labels, post, environment, parts, actors, stats, MODES,
    three: { scene, camera, renderer },
    setCamera(m, o) { const ok = cams.setMode(m, o); if (ok && ctx.bus) ctx.bus.emit('twin:camera:changed', { mode: m }); return ok; },
    setLight(m, o) { return environment.setLight(m, o); }, get light() { return environment.mode; },
    setSafeArea(a) { cams.setSafeArea(a); Object.assign(safe, cams.safe); },
    focus(sel) { return cams.focus(sel, ctx.sim && ctx.sim.state); },
    setLayer, layers: () => LAYERS.map((l) => ({ id: l.id, label: l.label, on: !!eff[l.id] })),
    start() { if (running || disposed) return; running = true; last = 0; raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    get running() { return running; },
    resize() { resize(); if (!running) frame(performance.now(), true); },
    renderOnce() { frame(performance.now(), true); },
    screenshot() { resize(); post.render(time); return canvas.toDataURL('image/png'); },
    dispose() {
      if (disposed) return; api.stop(); disposed = true; ro.disconnect(); offs.forEach((f) => f()); mq && mq.removeEventListener && mq.removeEventListener('change', onMq);
      canvas.removeEventListener('pointermove', onPtrMove); canvas.removeEventListener('pointerleave', onPtrLeave); canvas.removeEventListener('pointerdown', onPtrDown); canvas.removeEventListener('pointerup', onPtrUp); canvas.removeEventListener('dblclick', onDbl);
      for (const a of actors) callActor(a, 'dispose'); for (const p of parts) { try { p.dispose && p.dispose(); } catch (e) { /* keep disposing */ } }
      cams.dispose(); labels.dispose(); environment.dispose(); U.disposeTree(scene); env.mats.dispose(); tex.dispose(); post.dispose(); photos.dispose(); renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss();
      canvas.remove(); overlay.remove(); host.querySelector(':scope > .twin-caption')?.remove(); host.classList.remove('twin-host', 'static');
    },
  };
  resize(); frame(performance.now(), true);          // compile shaders and draw one frame before anyone sees the canvas
  onProgress(1, 'Ready');
  if (ctx.bus) ctx.bus.emit('twin:ready', { layers: api.layers() });
  if (autostart) api.start();
  return api;
}
