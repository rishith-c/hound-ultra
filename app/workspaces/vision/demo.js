// Vision lab, Demo mode: seven full-screen scenes behind one quiet stepper. Nothing is downloaded here: model results are
// recorded runs (data/vision/hero-*.json), and everything else is computed in the page. "Run it live" opens the full exhibit.
import * as THREE from 'three';
import { asset, clamp, lerp } from './common.js';
import { makeTerrain, makeBeam, makeDust, loadFrame, liftTexture, maskTexture, SIZE } from './terrain.js';

export const CHAPTERS = [
  { id: 'words', name: 'Search by words', rec: true, src: 'AI-generated frames', note: 'Five recorded results, selected from 60 phrase and frame pairs. The ground heights come from the depth model with the overall tilt removed.', line: 'Type what you are looking for. Every patch of the drone frame rises by how well it fits the words.' },
  { id: 'outline', name: 'Click to outline', rec: true, src: 'AI-generated frame', note: 'Four clicks, selected from 12. The confidence is the model’s own estimate.', line: 'One click, and the model cuts the object out of the ground and gives its area.' },
  { id: 'relief', name: 'One photo to 3-D', rec: true, src: 'AI-generated picture', note: 'One run per picture.', line: 'A single picture, and a network that estimates how far away every pixel is.' },
  { id: 'pulse', name: 'Pulse from pixels', tag: 'sim', rec: false, line: 'In this simulated face the skin changes colour by under one per cent with each beat. Amplified, it is a landscape.' },
  { id: 'events', name: 'Event camera', tag: 'concept', rec: false, src: 'Simulated on an AI-generated frame', line: 'A sensor that reports only change. Hold still, and the one thing left is a waving hand.' },
  { id: 'skin', name: 'Skin, by its spectrum', tag: 'concept', rec: false, src: 'Simulated on an AI-generated frame', line: 'In short-wave infrared, skin and mud differ. A simulation: the skin is placed by hand.' },
  { id: 'voice', name: 'Hear a voice', rec: true, src: 'Synthetic voice', note: 'Four clips shown from seven languages, one sentence and one voice each.', line: 'A cry for help as terrain, and the language a small network heard in it.' },
];
const ease = (x) => { x = clamp(x, 0, 1); return x * x * x * (x * (6 * x - 15) + 10); };
const span = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

export function createDemo(root, ctx, lab) {
  const { h, icon, realityTag } = ctx.kit;
  const canvas = h('canvas.vision-demo-canvas', { tabindex: 0, role: 'img', 'aria-label': 'Animated scene. Drag to look around.' });
  const title = h('h2.vision-demo-title'), line = h('p.vision-demo-line'), cap = h('p.vision-demo-cap', { 'aria-live': 'polite' }), tags = h('div.vision-demo-tags');
  const run = h('button.btn.btn-primary.vision-demo-run', { onclick: () => { const id = cur.id; ctx.setMode('advanced'); lab.open(id); } }, icon('play'), h('span', null, 'Run it live'));
  const figs = [0, 1, 2].map(() => { const b = h('b'), s = h('small'), l = h('span'); return { el: h('div', null, h('div', null, b, s), l), b, s, l }; });
  const pin = h('div.vision-demo-pin', { hidden: true, 'aria-hidden': 'true' }, h('i'), h('span'));
  const aside = h('div.vision-demo-aside');
  const stepName = h('span.vision-demo-stepname'), steps = h('nav.vision-demo-steps', { 'aria-label': 'Vision exhibits' }, stepName, CHAPTERS.map((c, i) => h('button', { 'aria-label': c.name, title: c.name, onclick: () => go(i) }, String(i + 1).padStart(2, '0'))));
  const veil = h('div.vision-demo-veil');
  root.append(canvas, h('div.vision-demo-shade'), pin, aside, steps, h('div.vision-demo-text', null, tags, title, line, cap, run), h('div.vision-demo-figs', null, figs.map((f) => f.el)), veil);

  let renderer = null, raf = 0, last = 0, ratio = Math.min(1.5, devicePixelRatio || 1), W = 2, H = 2, slow = 0, count = 0, cur = null, scene = null, token = 0, shown = false, lastCap = '', failed = false;
  const cache = new Map(), pointer = { yaw: 0, pitch: 0, ty: 0, tp: 0, down: false, x: 0, y: 0 };
  const shared = {};
  canvas.addEventListener('pointerdown', (e) => { pointer.down = true; pointer.x = e.clientX; pointer.y = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!pointer.down) return; pointer.ty = clamp(pointer.ty + (e.clientX - pointer.x) * 0.004, -0.9, 0.9); pointer.tp = clamp(pointer.tp + (e.clientY - pointer.y) * 0.003, -0.35, 0.35); pointer.x = e.clientX; pointer.y = e.clientY; });
  for (const n of ['pointerup', 'pointercancel']) canvas.addEventListener(n, () => { pointer.down = false; });
  canvas.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') pointer.ty -= 0.12; else if (e.key === 'ArrowRight') pointer.ty += 0.12; else return; e.preventDefault(); });

  const v = new THREE.Vector3();
  const ui = {
    title(s) { if (title.textContent !== s) title.textContent = s; },
    long(on) { title.classList.toggle('long', on); },
    caret(on) { title.classList.toggle('typing', on); },
    say(s, cls = '') { if (s === lastCap) return; lastCap = s; cap.textContent = s; cap.className = 'vision-demo-cap ' + cls; },
    fig(i, val, unit = '', label = '', cls = '') { const f = figs[i]; if (val == null) { f.el.hidden = true; return; } f.el.hidden = false; if (f.b.textContent !== val) f.b.textContent = val; if (f.s.textContent !== unit) f.s.textContent = unit; if (f.l.textContent !== label) f.l.textContent = label; f.el.className = cls; },
    pin(p, text, cls = '') { if (!p) { pin.hidden = true; return; } pin.hidden = false; v.copy(p).project(scene.camera); pin.style.transform = 'translate3d(' + ((v.x + 1) / 2 * W).toFixed(1) + 'px,' + ((1 - v.y) / 2 * H).toFixed(1) + 'px,0)'; if (pin.lastChild.textContent !== text) pin.lastChild.textContent = text; const c = 'vision-demo-pin ' + cls; if (pin.className !== c) pin.className = c; },
    aside(node) { aside.replaceChildren(node || ''); },
  };
  const env = { THREE, lab, ui, pointer, ease, span, clamp, lerp, asset, h, icon, shared, get renderer() { return renderer; }, get ratio() { return ratio; }, get aspect() { return W / H; }, reduced: () => lab.reduced(),
    terrain() { if (!shared.terrain) { shared.terrain = makeTerrain(); shared.beam = makeBeam(); shared.dust = makeDust(); shared.ground = new THREE.Scene(); shared.ground.background = new THREE.Color(0x0a0d11); shared.ground.add(shared.terrain.mesh, shared.beam.mesh, shared.dust.mesh); } return shared; } };
  env.size = () => [W, H];

  function ensureRenderer() {
    if (renderer) return true;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.setClearColor(0x0a0d11); return true; } catch (e) { failed = true; ui.say('This browser could not start 3-D graphics. The exhibits in Advanced still work.'); console.warn(e); return false; }
  }
  function resize() { const r = root.getBoundingClientRect(); if (r.width < 8) return; W = r.width; H = r.height; renderer.setPixelRatio(ratio); renderer.setSize(W, H, false); if (scene) { scene.camera.aspect = W / H; scene.resize?.(W, H); scene.camera.updateProjectionMatrix(); } }
  const ro = new ResizeObserver(() => { if (renderer && shown) resize(); }); ro.observe(root);

  const LOADERS = { words: () => wordsScene(env), outline: () => outlineScene(env), ...Object.fromEntries(['relief', 'pulse', 'events', 'skin', 'voice'].map((id) => [id, () => import('./scenes.js').then((m) => m[id](env))])) };
  async function go(i) {
    const c = CHAPTERS[i]; if (!c) return; const my = ++token; cur = c;
    steps.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-current', String(k === i))); stepName.textContent = c.name;
    tags.replaceChildren(c.rec ? h('span.vision-demo-rec', { title: c.note + ' Run on 23 November 2026, with more tries than are shown here. Press Run it live for a new run.' }, 'Recorded from this model on this computer') : realityTag(c.tag), c.src ? h('span.vision-demo-rec.src', null, c.src) : '');
    run.lastChild.textContent = c.rec ? 'Run it live' : 'Open the exhibit';
    if (!shown || !ensureRenderer()) return;
    if (scene) { veil.classList.add('on'); await new Promise((r) => setTimeout(r, 240)); if (my !== token) return; scene.leave?.(); scene = null; }
    title.classList.remove('typing'); title.textContent = c.name; title.classList.remove('long'); line.textContent = c.line; lastCap = ''; cap.textContent = ''; pin.hidden = true; aside.replaceChildren(); figs.forEach((f) => { f.el.hidden = true; });
    try {
      let s = cache.get(c.id); if (!s) { s = await LOADERS[c.id](); cache.set(c.id, s); }
      if (my !== token) return;
      scene = s; scene.t = 0; scene.camera.aspect = W / H; resize(); scene.enter?.();
      if (lab.reduced()) { scene.t = scene.still || 4; scene.update(0, scene.t); renderer.render(scene.scene, scene.camera); }
    } catch (e) { console.warn('[vision] demo scene ' + c.id, e); if (my === token) ui.say('This scene could not be loaded. The full exhibit is in Advanced.'); }
    veil.classList.remove('on');
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; const real = now - last; last = now; if (!scene) return;
    pointer.yaw += (pointer.ty - pointer.yaw) * Math.min(1, dt * 6); pointer.pitch += (pointer.tp - pointer.pitch) * Math.min(1, dt * 6); if (!pointer.down) { pointer.ty *= 1 - Math.min(1, dt * 0.25); pointer.tp *= 1 - Math.min(1, dt * 0.25); }
    const still = lab.reduced(); if (!still) scene.t += dt;
    scene.update(still ? 0 : dt, scene.t); renderer.render(scene.scene, scene.camera);
    // keep the frame rate: drop the pixel ratio in steps when frames run long
    if (real > 0 && real < 200) { slow += real; if (++count === 45) { const m = slow / 45; if (m > 19.5 && ratio > 0.85) { ratio = Math.max(0.85, ratio - 0.15); resize(); } slow = 0; count = 0; } }
  }
  return {
    show(id) { shown = true; if (failed || !ensureRenderer()) return; resize(); last = 0; if (!raf) raf = requestAnimationFrame(frame); const i = Math.max(0, CHAPTERS.findIndex((c) => c.id === id)); if (!scene || cur !== CHAPTERS[i]) go(i); },
    hide() { shown = false; cancelAnimationFrame(raf); raf = 0; scene?.pause?.(); },
    get current() { return cur?.id; }, get scene() { return scene; }, go: (id) => go(CHAPTERS.findIndex((c) => c.id === id)),
  };
}

// ---------- 01 words ----------
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const PERSON = 'person', BLUE = 'blue', AMBER = 'amber', TINT = { person: [1, 0.2, 0.07], blue: [0.16, 0.46, 1], amber: [1, 0.55, 0.1] };   // linear light, tuned to the tokens after tone mapping
async function wordsScene(env) {
  const { lab, ui, ease, span, lerp, pointer } = env, S = env.terrain(), T = S.terrain, U = T.U;
  const rec = await (await fetch(asset('data/vision/hero-words.json'))).json();
  const F = { 'aerial-01': 'a', 'aerial-05': 'd', 'aerial-03': 'e' };
  const beats = [
    { tint: PERSON, cls: 'person', pin: 'Red jacket', say: 'No list of objects is built in. It compares the words with every patch.' },
    { tint: PERSON, cls: 'person', pin: 'Waving', say: 'Same frame, new question. The picture is not read again.' },
    { tint: PERSON, cls: 'person', pin: 'Covered in mud', say: 'A few words lead to the place.' },
    { tint: BLUE, cls: '', pin: 'Barrel', say: 'Anything you can describe will do.' },
    { tint: AMBER, cls: 'warn', pin: 'A red cloth', say: 'A red cloth. A match is a place to look.' },
  ].map((b, i) => { const r = rec.rows[i], t = r.top[0]; return { ...b, ...r, f: F[r.frame], tex: liftTexture(b64(r.grid), 64, false), u: (t.x + t.s / 2) / 1254, v: (t.y + t.s / 2) / 1254, grid: b64(r.grid) }; });
  // aim at the highest patch of the recorded map
  for (const b of beats) { let bi = 0; for (let i = 0; i < 4096; i++) if (b.grid[i] > b.grid[bi]) bi = i; b.hu = ((bi % 64) + 0.5) / 64; b.hv = ((bi / 64 | 0) + 0.5) / 64; b.peak = b.grid[bi] / 255; }
  const first = await loadFrame('a', env.renderer), all = { a: first }; loadFrame('d', env.renderer).then((f) => { all.d = f; }); loadFrame('e', env.renderer).then((f) => { all.e = f; });
  const camera = new THREE.PerspectiveCamera(34, 1.8, 0.1, 80), pos = new THREE.Vector3(), tgt = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Vector3(), pinP = new THREE.Vector3();
  const D = 15.2; let i = -1, b = null, t0 = 0, az = 0.35, init = true;
  const start = (k, t) => { i = k; b = beats[k]; t0 = t; const f = all[b.f] || first, prev = U.pB.value ? U.pB.value : f.photo, pd = U.dB.value || f.depth; U.pA.value = prev; U.dA.value = pd; U.pB.value = f.photo; U.dB.value = f.depth; U.uMixW.value = prev === f.photo ? 1 : 0; U.lA.value = b.tex; U.uFocus.value.set(b.hu, b.hv); U.uTint.value.setRGB(...TINT[b.tint]); S.beam.U.uC.value.setRGB(...TINT[b.tint]); U.uWave.value = 0; };
  return { scene: S.ground, camera, still: 5.2,
    enter() { U.uSmooth.value = 0; U.uLift.value = 3.1; U.uDim.value = 0; U.uClick.value.z = -1; U.pB.value = null; U.dB.value = null; init = true; start(0, 0); },
    update(dt, t) {
      let k = t - t0; if (k > 9.2) { start((i + 1) % beats.length, t); k = 0; }
      U.uTime.value = t; S.dust.U.uT.value = t; S.dust.U.uP.value = env.ratio;
      if (U.uMixW.value < 1) U.uMixW.value = Math.min(1, U.uMixW.value + dt * 0.9);
      // type, scan, rise, hold, sink
      const n = Math.floor(span(k, 0.15, 0.15 + b.q.length * 0.055) * b.q.length); ui.title('“' + b.q.slice(0, n) + (n === b.q.length ? '”' : '')); ui.caret(k < 2.2);
      U.uScan.value = k > 0.9 && k < 2.1 ? lerp(-0.1, 1.1, span(k, 0.9, 2.1)) : -1;
      const up = ease(span(k, 1.7, 3.9)), down = ease(span(k, 8.2, 9.1)); U.uWave.value = up * (1 - down); U.uDim.value = ease(span(k, 0.3, 1.6)) * (1 - 0.7 * down);
      ui.say(k > 2.9 ? b.say : k > 0.9 ? 'Comparing the words with 860 patches of the frame.' : ' ', k > 2.9 ? b.cls : '');
      const score = b.top[0].score * ease(span(k, 1.9, 3.4));
      if (k > 1.8) { ui.fig(0, score.toFixed(2), '', 'match, 0 to 1', b.cls); ui.fig(1, '860', '', 'patches compared'); ui.fig(2, Math.round(b.textMs).toString(), 'ms', 'to read the words'); } else { ui.fig(0, '–', '', 'match, 0 to 1'); ui.fig(1, '860', '', 'patches compared'); ui.fig(2, '–', 'ms', 'to read the words'); }
      const g = T.ground(all[b.f] || first, b.hu, b.hv), topY = g + Math.pow(b.peak, 1.25) * 3.1 * U.uWave.value; pinP.copy(T.at(b.hu, b.hv, topY + 0.5));
      S.beam.mesh.position.set(pinP.x, topY - 0.05, pinP.z); S.beam.U.uA.value = U.uWave.value * (0.8 + 0.2 * Math.sin(t * 1.6));
      // one slow move: the camera circles the place the words point at
      const push = ease(span(k, 1.2, 5.5)), dist = lerp(D + 1.4, D - 2.6, push); az += dt * 0.045;
      C.copy(T.at(lerp(0.5, b.hu, 0.9), lerp(0.5, b.hv, 0.9), 0.5 + 0.6 * U.uWave.value)); C.x = clamp(C.x, -6.2, 6.2); C.z = clamp(C.z, -5.5, 4.2);
      const a = Math.sin(az) * 0.55 + pointer.yaw, el = clamp(lerp(1.02, 0.8, push) + pointer.pitch, 0.35, 1.4);
      P.set(C.x + Math.sin(a) * Math.cos(el) * dist, C.y + Math.sin(el) * dist, C.z + Math.cos(a) * Math.cos(el) * dist);
      const s = init ? 1 : 1 - Math.exp(-dt * 1.7); init = false; pos.lerp(P, s); tgt.lerp(C, s); camera.position.copy(pos); camera.lookAt(tgt);
      camera.updateMatrixWorld(); T.bake(env.renderer);
      if (k > 3.1 && k < 8.3) ui.pin(pinP, b.pin, b.cls); else ui.pin(null);
    },
    leave() { U.uScan.value = -1; S.beam.U.uA.value = 0; }, };
}

// ---------- 02 outline ----------
async function outlineScene(env) {
  const { ui, ease, span, lerp, pointer } = env, S = env.terrain(), T = S.terrain, U = T.U;
  const rec = await (await fetch(asset('data/vision/hero-outline.json'))).json(), f = await loadFrame('a', env.renderer), m2 = rec.gridM ** 2;
  const list = [['slab', BLUE, '', 'Fallen slab', 'The outline goes around the person sitting on it.'], ['rect', BLUE, '', 'Slab', 'An area is a first guess at a load, before anyone lifts.'], ['roof2', BLUE, '', 'Tin roof', 'One click per object. The picture is read once.'], ['waver', PERSON, 'person', 'A person', 'A person is under one square metre here.']];
  const beats = await Promise.all(list.map(async ([id, tint, cls, pin, say]) => { const c = rec.clicks.find((x) => x.id === id); return { id, tint, cls, pin, say, tex: await maskTexture('assets/img/vision/mask-' + id + '.png'), u: c.pts[0][0] / 1254, v: c.pts[0][1] / 1254, area: c.cells[c.best] * m2, iou: c.iou[c.best], ms: c.ms }; }));
  const warm = rec.clicks.slice(1).map((c) => c.ms).sort((a, b) => a - b); const med = warm[warm.length >> 1];
  const camera = new THREE.PerspectiveCamera(34, 1.8, 0.1, 80), pos = new THREE.Vector3(), tgt = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Vector3(), pinP = new THREE.Vector3(); let i = 0, b = beats[0], t0 = 0, az = -0.5, init = true;
  const start = (k, t) => { i = k; b = beats[k]; t0 = t; U.lA.value = b.tex; U.uFocus.value.set(b.u, b.v); U.uTint.value.setRGB(...TINT[b.tint]); U.uClick.value.set(b.u, b.v, -1); };
  return { scene: S.ground, camera, still: 4.5,
    enter() { U.pA.value = U.pB.value = f.photo; U.dA.value = U.dB.value = f.depth; U.uMixW.value = 1; U.uSmooth.value = 1; U.uScan.value = -1; S.beam.U.uA.value = 0; init = true; start(0, 0); },
    update(dt, t) {
      let k = t - t0; if (k > 7) { start((i + 1) % beats.length, t); k = 0; }
      U.uTime.value = t; S.dust.U.uT.value = t; S.dust.U.uP.value = env.ratio;
      const up = ease(span(k, 1.4, 2.9)), down = ease(span(k, 6.1, 6.95)); U.uWave.value = ease(span(k, 1, 2)) * (1 - down); U.uLift.value = lerp(0.02, b.id === 'waver' ? 0.9 : 1.55, up) * (1 - down) + 0.001; U.uDim.value = ease(span(k, 0.9, 1.8)) * (1 - down) * 0.9; U.uClick.value.z = k > 0.85 ? (k - 0.85) * 0.9 : -1;
      ui.say(k > 1.5 ? b.say : 'One click.', k > 1.5 ? b.cls : '');
      const a0 = b.area * ease(span(k, 1.3, 2.6)); ui.fig(0, k > 1.2 ? a0.toFixed(1) : '–', 'm²', 'outlined area', b.cls); ui.fig(1, k > 1.2 ? Math.round(med).toString() : '–', 'ms', 'typical click'); ui.fig(2, k > 1.2 ? b.iou.toFixed(2) : '–', '', 'its own confidence');
      const g = T.ground(f, b.u, b.v); pinP.copy(T.at(b.u, b.v, g + U.uLift.value + 0.3));
      const push = ease(span(k, 0.6, 4.5)), dist = lerp(17.5, b.id === 'waver' ? 9.5 : 13.2, push); az += dt * 0.05;
      C.copy(T.at(lerp(0.5, b.u, 0.85), lerp(0.5, b.v, 0.85), 0.4)); C.x = clamp(C.x, -6.6, 6.6); C.z = clamp(C.z, -5.6, 4.6);
      const a = Math.sin(az) * 0.6 + pointer.yaw, el = clamp(lerp(1.02, 0.76, push) + pointer.pitch, 0.35, 1.4);
      P.set(C.x + Math.sin(a) * Math.cos(el) * dist, C.y + Math.sin(el) * dist, C.z + Math.cos(a) * Math.cos(el) * dist);
      const s = init ? 1 : 1 - Math.exp(-dt * 1.9); init = false; pos.lerp(P, s); tgt.lerp(C, s); camera.position.copy(pos); camera.lookAt(tgt); camera.updateMatrixWorld(); T.bake(env.renderer);
      if (k > 2.2 && k < 6.2) ui.pin(pinP, b.pin + ', ' + b.area.toFixed(1) + ' m²', b.cls); else ui.pin(null);
    },
    leave() { U.uClick.value.z = -1; U.uSmooth.value = 0; }, };
}
