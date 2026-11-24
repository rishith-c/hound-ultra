// Structure lab: the demo film. It plays recordings solved by worker.js: the collapse, a jack lift that shuts the pocket,
// the rewind, one shore, and the same lift again; then the aftershocks, the void count and the vine route. Every figure on
// screen is read from those recordings. The camera, the light and the dust are the only things made up here.
import * as THREE from 'three';
import { blueprint } from './physics.js';

// Seeds whose pile really does this, found by search. The first is tried first; if a browser's arithmetic settles the pile
// differently and no such lift exists, the next one is simulated instead.
const HINTS = [
  { seed: 1, scenario: 'vshape', tie: 0.25, hint: { box: { c: [-3.8, 0.21, 3.15], h: [0.85, 0.19, 0.24], yaw: Math.PI / 2 }, jack: [-3.31, 1.76], shore: [-3.36, 2.62] } },
  { seed: 2, scenario: 'vshape', tie: 0.25, hint: null }, { seed: 5, scenario: 'vshape', tie: 0.25, hint: null } ];
const G = { COL: 1, A: 2, B: 3 };
const cm = (m) => Math.round(m * 100), kN = (f) => (f / 1000).toFixed(f < 9950 ? 1 : 0);
const ease = (u) => u * u * (3 - 2 * u), clamp = (x) => Math.max(0, Math.min(1, x));

export function createFilm({ ctx, view, host }) {
  const { h, icon, realityTag, reducedMotion } = ctx.kit;
  const D = { pieces: null, n: 0, chunks: [], frames: 0, done: false, rest: null, lift: null, shake: null, voids: null, vine: null, tried: 0, shakeK: 0, error: '' };
  const CH = [['lift', 'Lift'], ['shake', 'Aftershock'], ['shore', 'Shore'], ['voids', 'Voids'], ['vine', 'Vine robot']];
  let take = 0, chap = 'lift', beats = [], bi = 0, bt = 0, running = false, worker = null, poses = null, curClock = { [G.COL]: -100, [G.A]: -100, [G.B]: -100 }, lastUser = -1e9, held = false;

  // ---------------- overlay
  const fig = () => { const v = h('b'), u = h('small'), l = h('span'); return { el: h('div.structure-fig', null, h('div', null, v, u), l), v, u, l, key: '' }; };
  const F = [fig(), fig(), fig()];
  const cap = h('p.structure-cap', { role: 'status', 'aria-live': 'polite' });
  const act = h('button.btn.btn-primary.structure-act', { onclick: () => action() }, icon('play', 16), h('span', null, 'Lift it without the shore'));
  const steps = h('div.structure-steps', { role: 'group', 'aria-label': 'Chapters of this exhibit' }, CH.map(([id, l], i) => h('button', { 'data-id': id, 'aria-pressed': String(id === chap), onclick: () => go(id, true) }, h('i', null, String(i + 1)), l)));
  const bar = h('i'); const prog = h('div.structure-prog', { 'aria-hidden': 'true' }, bar);
  const tag = h('span.structure-tags', null, realityTag('sim'));
  const el = h('div.structure-film.demo-only', null,
    h('div.structure-shade', { 'aria-hidden': 'true' }),
    h('div.structure-title', null, tag, h('h1', null, 'Test the lift before anyone lifts.'), cap, act),
    h('p.structure-note', null, 'Weak ties assumed; seed chosen by search. Not an engineering assessment.'),
    h('div.structure-figs', null, ...F.map((f) => f.el)), h('div.structure-foot', null, steps, prog));
  host.append(el);
  let capNow = ''; function say(t) { if (t === capNow) return; capNow = t; cap.classList.add('is-out'); setTimeout(() => { cap.textContent = capNow; cap.classList.remove('is-out'); }, 160); }
  function figs(list) { for (let i = 0; i < 3; i++) { const f = F[i], x = list[i]; f.el.classList.toggle('is-off', !x); if (!x) continue; if (f.v.textContent !== x[0]) f.v.textContent = x[0]; if (f.u.textContent !== x[1]) f.u.textContent = x[1]; if (f.l.textContent !== x[2]) f.l.textContent = x[2]; const c = x[3] || ''; if (f.key !== c) { f.key = c; f.el.dataset.tone = c; } } }

  // ---------------- data from the worker
  function boot() {
    if (worker) return;
    { // the bay stands on screen before the engine has arrived
      const pl = blueprint(HINTS[take]); D.pieces = pl.pieces; D.n = pl.pieces.length; D.loose = pl.pieces.filter((p) => !p.fixed).length; D.mass = pl.massTotal; D.poses0 = new Float32Array(D.n * 7);
      pl.pieces.forEach((p, i) => { D.poses0.set(p.p, i * 7); D.poses0.set(p.q || [0, 0, 0, 1], i * 7 + 3); }); poses = new Float32Array((D.n + 1) * 7); poses.set(D.poses0);
    }
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onerror = (e) => { D.error = e.message || 'The solver did not start.'; };
    worker.onmessage = ({ data: m }) => {
      if (m.t === 'chunk') { D.chunks.push({ f0: D.frames, frames: m.frames, buf: m.buf }); D.frames += m.frames; logFx(G.COL, m.dust.filter((_, i) => i % 2 === 0)); for (const e of m.evs) (D.crush ||= []).push(e); }
      else if (m.t === 'rest') { D.done = true; D.rest = m.rest; }
      else if (m.t === 'search') D.tried = m.tried;
      else if (m.t === 'lift') { D.lift = m; prepLift(m); }
      else if (m.t === 'shakeN') D.shakeK = m.k / m.n;
      else if (m.t === 'shake') D.shake = m;
      else if (m.t === 'voids') { D.voids = m; buildVoids(m); }
      else if (m.t === 'vine') D.vine = m;
      else if (m.t === 'error') retry(m.message);
    };
    worker.postMessage(HINTS[take]);
  }
  function retry(message) {
    worker.terminate(); worker = null; if (D.lift || ++take >= HINTS.length) { D.error = message; return; }
    Object.assign(D, { chunks: [], frames: 0, done: false, rest: null, crush: null, dustLog: null, tried: 0 }); crushN = 0; beats = []; boot(); if (running) enter();
  }
  function prepLift(m) {
    for (const r of [m.a, m.b]) { r.k = r.tr.edges.length / (Math.ceil(r.total / 3) * r.tr.K * 6); }
    let s = m.a.tr.head.findIndex((x) => x < m.a.head0 - 0.015); if (s < 0) s = Math.floor(m.a.tr.head.length * 0.5); m.slip = Math.max(20, s * 3 - 6);
    let w = 0; for (let i = 0; i < m.a.tr.head.length; i++) if (m.a.tr.head[i] <= m.a.worst + 0.004) { w = i; break; } m.shut = Math.min(m.a.total - 1, w * 3 + 4);
    m.bLow = Math.min(...m.b.tr.head); m.peakShore = Math.max(...m.b.tr.shore); m.peakJack = Math.max(...m.a.tr.force.slice(12)); 
    logFx(G.A, m.a.tr.dust); logFx(G.B, m.b.tr.dust);
    if (view.items.length) addShorePiece();
  }
  function addShorePiece() { const s = D.lift.shore; if (view.items[D.n]) return; view.addPiece({ idx: D.n, kind: 'shore', sub: 'post', id: 'S', name: 'Shore', alive: true, fixed: true, boxes: [{ o: [0, 0, 0], h: [0.07, s.h / 2, 0.07] }] }); view.items[D.n].group.visible = false; }

  // ---------------- playback
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  function mix(A, oa, B, ob, u, n, out) { for (let i = 0; i < n; i++) { const a = oa + i * 7, b = ob + i * 7, o = i * 7; out[o] = A[a] + (B[b] - A[a]) * u; out[o + 1] = A[a + 1] + (B[b + 1] - A[a + 1]) * u; out[o + 2] = A[a + 2] + (B[b + 2] - A[a + 2]) * u; qa.set(A[a + 3], A[a + 4], A[a + 5], A[a + 6]); qb.set(B[b + 3], B[b + 4], B[b + 5], B[b + 6]); qa.slerp(qb, u); out[o + 3] = qa.x; out[o + 4] = qa.y; out[o + 5] = qa.z; out[o + 6] = qa.w; } }
  function frameAt(f) { for (const c of D.chunks) if (f < c.f0 + c.frames) return [c.buf, (f - c.f0) * D.n * 7]; const c = D.chunks[D.chunks.length - 1]; return [c.buf, (c.frames - 1) * D.n * 7]; }
  function showCollapse(f) { // f in sim frames
    const last = D.frames - 1; if (last < 1) { if (D.poses0) poses.set(D.poses0); view.showCovers(true, D.pieces); place(); return; }
    view.showCovers(f < 2, D.pieces); if (f >= last) { if (D.rest) { const [a, oa] = frameAt(last); mix(a, oa, D.rest, 0, clamp((f - last) / 30), D.n, poses); } else { const [a, oa] = frameAt(last); mix(a, oa, a, oa, 0, D.n, poses); } }
    else if (f <= 0) poses.set(D.poses0); else { const i = Math.floor(f), [a, oa] = frameAt(i), [b, ob] = frameAt(i + 1); mix(a, oa, b, ob, f - i, D.n, poses); }
    clock(G.COL, f / 60); crushTo(f); place();
  }
  let glass = new Set(), glassK = 0;
  function findGlass() { const s = L().site, b = L().box; glass = new Set([...view.blockers(CAM.jack[0], [s.x, s.top - 0.05, s.z]), ...view.blockers(CAM.hold[0], [s.x, s.top - 0.05, s.z]), ...view.blockers(CAM.jack[0], [b.c[0], 0.3, b.c[2] - 0.3])]); glass.delete(s.idx); for (const i of [...glass]) if (i >= D.n || D.pieces[i].fixed) glass.delete(i); }
  function glassTo(k) { if (Math.abs(k - glassK) < 0.004) return; glassK = k; for (const i of glass) view.setGhost(i, k); }
  function showRun(r, f) { view.showCovers(false, D.pieces); const last = r.total - 1, x = Math.max(0, Math.min(last - 0.001, f)), i = Math.floor(x); mix(r.frames, i * r.n * 7, r.frames, Math.min(last, i + 1) * r.n * 7, x - i, D.n, poses); place(); }
  let crushN = 0; function crushTo(f) { if (!D.crush) return; let n = 0; for (const e of D.crush) if (e.f <= f) n++; if (n === crushN) return; for (let i = 0; i < D.crush.length; i++) { const e = D.crush[i], on = i < n, p = D.pieces[e.idx]; if (!!p.crushed !== on) { p.box0 ||= p.boxes; p.crushed = on; p.boxes = on ? e.boxes : p.box0; view.rebuildPiece(p); } } crushN = n; }
  function place() { const it = view.items; for (let i = 0; i < D.n; i++) { const g = it[i] && it[i].group; if (!g) continue; const o = i * 7; g.position.set(poses[o], poses[o + 1], poses[o + 2]); g.quaternion.set(poses[o + 3], poses[o + 4], poses[o + 5], poses[o + 6]); } }
  function clock(g, t) { curClock[g] = t; view.setClock(g, t); }
  const heat = new Float32Array(400);
  function glow(ref, k) { // pieces that have moved from where they rested, by how far
    for (let i = 0; i < D.n; i++) { let w = 0; if (k > 0) { const o = i * 7, d = Math.hypot(poses[o] - ref[o], poses[o + 1] - ref[o + 1], poses[o + 2] - ref[o + 2]); w = clamp((d - 0.02) / 0.3) * 0.5 * k; } if (Math.abs(w - heat[i]) > 0.002) { heat[i] = w; view.setHeat(i, 1.0, 0.13, 0.035, w); } }
  }
  function ghostAll(k, skip) { for (let i = 0; i < D.n; i++) view.setGhost(i, skip && skip.has(i) ? 0 : k); }
  const near = { x: 0, z: 0, r: 4 };
  function runFrame(r, f, k) { // load path and figures for one jack run
    const i = Math.max(0, Math.min(Math.ceil(r.total / 3) - 1, Math.floor(f / 3))), b = D.lift.box; near.x = (b.c[0] + D.lift.site.x) / 2; near.z = (b.c[2] + D.lift.site.z) / 2; near.r = 2.9;
    view.drawLoad(r.tr.edges, i * r.tr.K * 6, r.tr.K, posesX(r, f), k, 2500, near); view.setJackY(r.tr.jackY[Math.max(0, Math.min(r.total - 1, Math.floor(f)))], D.lift.site);
    return { head: r.tr.head[Math.min(i, r.tr.head.length - 1)], force: r.tr.force[Math.max(0, Math.min(r.total - 1, Math.floor(f)))], shore: r.tr.shore[Math.max(0, Math.min(r.total - 1, Math.floor(f)))] };
  }
  function posesX(r, f) { if (r.n > D.n) { const o = D.n * 7, s = Math.max(0, Math.min(r.total - 1, Math.floor(f))) * r.n * 7 + o; for (let k = 0; k < 7; k++) poses[o + k] = r.frames[s + k]; } return poses; }

  // ---------------- camera: slow, critically damped, hands over while the visitor drags
  const CAM = { wide: [[-15.6, 4.6, 15.2], [0.2, 2.1, 0.6]], fall: [[-14.2, 2.3, 11.6], [0, 2.1, 0.6]], mid: [[-12.6, 3.0, 9.4], [-1.6, 1.3, 1.6]], pocket: [[-8.6, 1.15, 4.7], [-3.6, 0.42, 2.7]], jack: [[-8.1, 1.0, 3.0], [-3.5, 0.45, 2.3]], hold: [[-8.3, 1.35, 4.1], [-3.5, 0.42, 2.45]], high: [[-11.4, 5.6, 9.8], [-0.4, 1.0, 0.8]] };
  const cp = new THREE.Vector3(...CAM.wide[0]), ct = new THREE.Vector3(...CAM.wide[1]), vp = new THREE.Vector3(), vt = new THREE.Vector3(), gp = new THREE.Vector3(), gt = new THREE.Vector3(), acc = new THREE.Vector3(); let camW = 1.0, drift = 0, shakeA = 0;
  function camTo(name, rate) { gp.set(...CAM[name][0]); gt.set(...CAM[name][1]); camW = rate || 0.9; }
  function camStep(dt, time) {
    for (const [p, v, g] of [[cp, vp, gp], [ct, vt, gt]]) { acc.subVectors(g, p).multiplyScalar(camW * camW).addScaledVector(v, -2 * camW); v.addScaledVector(acc, dt); p.addScaledVector(v, dt); }
    if (performance.now() - lastUser < 6000) return; drift += dt;
    const a = Math.sin(drift * 0.13) * 0.06, dx = cp.x - ct.x, dz = cp.z - ct.z; view.camera.position.set(ct.x + dx * Math.cos(a) - dz * Math.sin(a), cp.y + Math.sin(drift * 0.21) * 0.08, ct.z + dx * Math.sin(a) + dz * Math.cos(a));
    view.controls.target.copy(ct); if (shakeA > 0.001) { view.camera.position.x += Math.sin(time * 47) * shakeA; view.camera.position.y += Math.sin(time * 61 + 1) * shakeA * 0.7; view.controls.target.y += Math.sin(time * 53) * shakeA * 0.6; }
  }
  view.controls.addEventListener('start', () => { lastUser = performance.now() + 1e9; }); view.controls.addEventListener('end', () => { lastUser = performance.now(); cp.copy(view.camera.position); ct.copy(view.controls.target); vp.set(0, 0, 0); vt.set(0, 0, 0); });

  // ---------------- void cloud
  let cloud = null, cloudA = new Map(), wire = null;
  // outlines of every block as it lies, for the x-ray chapters
  function buildWire() {
    if (wire) return; const pts = [], q = new THREE.Quaternion(), o = new THREE.Vector3(), v = [...Array(8)].map(() => new THREE.Vector3()), E = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
    for (let i = 0; i < D.n; i++) { const k = i * 7; o.set(D.rest[k], D.rest[k + 1], D.rest[k + 2]); q.set(D.rest[k + 3], D.rest[k + 4], D.rest[k + 5], D.rest[k + 6]); for (const b of D.pieces[i].boxes) { for (let c = 0; c < 8; c++) v[c].set(b.o[0] + (c & 4 ? 1 : -1) * b.h[0], b.o[1] + (c & 2 ? 1 : -1) * b.h[1], b.o[2] + (c & 1 ? 1 : -1) * b.h[2]).applyQuaternion(q).add(o); for (const e of E) pts.push(v[e].x, v[e].y, v[e].z); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); wire = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(0.30, 0.55, 0.78), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); wire.frustumCulled = false; wire.renderOrder = 15; view.three.scene.add(wire);
  }
  function night(k) { if (k) buildWire(); view.setNight(k); if (wire) { wire.visible = k > 0.01; wire.material.opacity = 0.42 * k; } }
  function buildVoids(m) {
    const lists = m.curve.map((c) => c.cav || []), total = lists.flat().reduce((a, p) => a + p.length / 4, 0); if (!total) return;
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: { uK: { value: 0 }, uR: { value: 0.2 }, uA: { value: 0.1 } }, vertexShader: 'attribute vec2 iR; uniform float uR, uK; varying vec3 vN; varying vec3 vV; void main(){ vec4 p = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0); float s = step(abs(iR.x - uR), 0.02) * iR.x * smoothstep(0.0, 0.4, uK * 1.5 - iR.y * 0.12); vec4 mv = viewMatrix * (p + vec4(position * s, 0.0)); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }', fragmentShader: 'uniform float uA, uK; varying vec3 vN; varying vec3 vV; void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(vec3(0.16, 0.62, 0.95) * (0.25 + 1.6 * f * f) * uA * uK, 1.0); }' }), total);
    cloudA = new Map(m.curve.map((c, i) => [c.r, Math.max(0.018, Math.min(0.3, 14 / Math.max(1, lists[i].reduce((a, p) => a + p.length / 4, 0))))]));
    const m4 = new THREE.Matrix4(), ir = new Float32Array(total * 2); let k = 0; m.curve.forEach((c) => (c.cav || []).forEach((p) => { for (let i = 0; i < p.length; i += 4) { m4.makeTranslation(p[i], p[i + 1], p[i + 2]); mesh.setMatrixAt(k, m4); ir[k * 2] = c.r; ir[k * 2 + 1] = p[i + 1]; k++; } }));
    mesh.geometry.setAttribute('iR', new THREE.InstancedBufferAttribute(ir, 2)); mesh.frustumCulled = false; mesh.renderOrder = 16; mesh.visible = false; view.three.scene.add(mesh); cloud = mesh;
  }

  // ---------------- chapters as beats: { dur, cam, rate, gate?, in?, run(u, t, dt) }
  const L = () => D.lift;
  const headFig = (x, tone) => [String(cm(x)), 'cm', 'headroom over the person', tone || (x < 0.12 ? 'bad' : '')];
  function liftBeats() {
    const A = () => L().a, B = () => L().b; const refA = () => A().frames;
    return [
      { id: 'stand', dur: 1.1, cam: 'wide', rate: 0.8, in() { reset(); camTo('wide', 0.8); }, run() { showCollapse(0); clock(G.COL, -1); say('A two-storey bay. Its middle columns are about to burst.'); figs([]); } },
      { id: 'fall', dur: 7.2, cam: 'fall', rate: 0.42, gate: () => D.frames > 60, run(u, t) { const f = fallMap(t); showCollapse(Math.min(f, D.frames - 2)); shakeA = 0.018 * Math.exp(-Math.pow((f - 75) / 46, 2)); say('Rigid-body physics decides where all ' + D.loose + ' loose pieces land.'); figs([[(D.mass / 1000).toFixed(0), 't', 'falling, simulated']]); } },
      { id: 'find', dur: 5.4, cam: 'pocket', rate: 0.62, gate: () => !!L(), wait: () => D.tried ? 'Testing lifts in copies of the pile: ' + D.tried + ' so far.' : 'Reading the pile.', run(u, t) { showCollapse(D.frames + 60); shakeA = 0; view.setPerson(L().box, ease(clamp((t - 1.2) / 1.8)) * 0.9); say('One pocket stays open, with a person in it.'); figs(t > 1.6 ? [headFig(A().head0)] : []); } },
      { id: 'jack', dur: 2.6, cam: 'jack', rate: 0.75, run(u, t) { view.setPerson(L().box, 0.55); const e = ease(clamp(t / 1.5)); if (t < 0.05 || !glass.size) findGlass(); glassTo(0.9 * ease(clamp((t - 0.4) / 1.2))); view.buildJackOnce(L().site); view.jack.position.x = L().site.x - (1 - e) * 2.2; view.jack.position.z = L().site.z + (1 - e) * 0.6; showRun(A(), 0); say('A jack goes under plank ' + L().piece + '. Lift it 34 cm, in a copy.'); figs([headFig(A().head0)]); } },
      { id: 'liftA', dur: 9.2, cam: 'jack', rate: 0.6, run(u, t) { const m = L(), f = slipMap(t, m); showRun(A(), f); clock(G.A, f / 60); const v = runFrame(A(), f, clamp(t / 0.6)); glow(refA(), clamp((f - m.slip) / 14)); view.setPerson(m.box, 0.55); say(f < m.slip + 6 ? 'Lines are contact forces, read from the solver.' : what(m.a) + ' comes in over the person.'); figs([headFig(v.head), [kN(v.force), 'kN', 'on the jack']]); } },
      { id: 'shut', dur: 2.6, cam: 'hold', rate: 0.7, run(u, t) { const m = L(); showRun(A(), m.shut + 30); clock(G.A, (m.shut + 30) / 60 + t * 0.2); runFrame(A(), m.shut + 30, 1 - u * 0.7); glow(refA(), 1); view.setPerson(m.box, 0.6); say('The pocket shuts. ' + A().moved.length + ' pieces moved.'); figs([headFig(A().worst, 'bad'), [String(A().moved.length), '', 'pieces moved']]); } },
      { id: 'rewind', dur: 2.5, cam: 'jack', rate: 0.8, run(u) { const m = L(), f = (m.shut + 30) * (1 - ease(u)); showRun(A(), f); clock(G.A, f / 60); glow(refA(), 1 - u); runFrame(A(), f, 0.3 * (1 - u)); view.post.uni.fin.uRew.value = Math.sin(Math.PI * u); say('It was a copy. Rewind.'); figs([headFig(A().tr.head[Math.min(A().tr.head.length - 1, Math.floor(f / 3))])]); }, out() { view.post.uni.fin.uRew.value = 0; clock(G.A, -100); } },
      { id: 'shore', dur: 3.6, cam: 'pocket', rate: 0.7, run(u, t) { const m = L(); showRun(A(), 0); glow(refA(), 0); addShorePiece(); view.placeAnim(D.n, m.shore, clamp(t / 2.5), [-2.6, 1.2]); view.setPerson(m.box, 0.6); view.drawLoad(A().tr.edges, 0, 0, poses, 0); say('Add one timber shore beside the person.'); figs([headFig(A().head0)]); } },
      { id: 'liftB', dur: 5.4, cam: 'jack', rate: 0.6, run(u, t) { const m = L(), f = Math.min(B().total - 2, t * 60 * 1.02); showRun(B(), f); clock(G.B, f / 60); shorePose(1); const v = runFrame(B(), f, clamp(t / 0.6)); glow(B().frames, 1); view.setPerson(m.box, 0.65); say('Same jack, same plank, same lift.'); figs([headFig(v.head), [kN(v.force), 'kN', 'on the jack'], [kN(v.shore), 'kN', 'on the shore']]); } },
      { id: 'answer', dur: 6.5, cam: 'hold', rate: 0.55, hold: true, run(u, t) { const m = L(), f = B().total - 2; showRun(B(), f); clock(G.B, f / 60 + t * 0.3); shorePose(1); runFrame(B(), f, 0.7); glow(B().frames, 0.6); view.setPerson(m.box, 0.8); glassTo(0.9 * (1 - ease(clamp((t - 4.5) / 1.5)))); say(B().moved.length ? B().moved.length + ' pieces still move. The pocket stays open.' : 'Nothing moves. The pocket stays open.'); figs([headFig(m.bLow, 'ok'), [kN(m.peakShore), 'kN', 'on a shore rated for ' + kN(m.b.shores[0].rated) + ' kN', 'ok'], [A().moved.length + ' → ' + B().moved.length, '', 'pieces that move']]); } },
      { id: 'unfall', dur: 4.2, cam: 'wide', rate: 0.95, run(u, t) { const m = L(); view.setPerson(m.box, 0.5 * (1 - clamp(t / 0.5))); if (t > 0.4) { view.jack.visible = false; hideShore(); view.setPerson(null); } view.drawLoad(A().tr.edges, 0, 0, poses, 0); glow(poses, 0); const f = (D.frames + 10) * (1 - ease(clamp((t - 0.5) / 3.5))); showCollapse(t < 0.4 ? D.frames + 60 : f); clock(G.B, -100); view.post.uni.fin.uRew.value = Math.sin(Math.PI * clamp((t - 0.3) / 3.9)) * 0.8; say('Again, from the start.'); figs([]); }, out() { view.post.uni.fin.uRew.value = 0; } },
    ];
  }
  const fallMap = (t) => { // film seconds to sim frames: real time at first, slow through the break, real time to rest
    const a = t < 0.7 ? t * 34 : 24 + (t < 3.4 ? (t - 0.7) * 27 : 73 + (t - 3.4) * 62); return a; };
  const slipMap = (t, m) => { const t1 = m.slip / 60 / 1.05; const slow = m.shut + 30 - m.slip, rate = slow / Math.max(1, 9.2 - t1 - 0.2); return t < t1 ? t * 63 : m.slip + (t - t1) * rate; };
  function shorePose(k) { addShorePiece(); view.placeAnim(D.n, L().shore, k, [0, 0]); }
  function hideShore() { const it = view.items[D.n]; if (it) it.group.visible = false; }
  function settled(shore) { showCollapse(D.frames + 60); clock(G.COL, D.frames / 60 + 20); if (shore && L()) shorePose(1); else hideShore(); }
  const KIND = { wall: 'a masonry panel', plank: 'a floor plank', beam: 'a beam', column: 'a column piece', content: 'furniture', debris: 'a concrete chunk', shore: 'the shore' };
  const what = (r) => { const w = [...new Set(r.by.map((i) => KIND[D.pieces[i]?.kind]).filter(Boolean))].slice(0, 2).join(' and ') || 'A piece'; return w[0].toUpperCase() + w.slice(1); };
  function shakeWords(k, n) { const S = D.shake, n0 = S.trials[0].filter((t) => t.lost).length, by = new Set(S.trials[k].filter((t) => t.lost).flatMap((t) => t.by)); if (!n) return 'The pocket stays open in all ' + S.n + ' tremors.'; const what = [...by].filter((q) => q !== 'shore').map((q) => KIND[q]).slice(0, 2).join(' or '); if (!k) return 'Lost in ' + n + ' of ' + S.n + '. What comes in: ' + what + '.'; return n < n0 ? 'One shore: lost in ' + n + ' of ' + S.n + ', down from ' + n0 + '.' : 'One shore does not help here: still ' + n + ' of ' + S.n + '. What comes in is ' + what + '.'; }
  function shakeBeats(k) {
    const S = () => D.shake, r = () => S().recs[k], lost = () => S().trials[k].filter((t) => t.lost).length;
    return [
      { id: 'a', dur: 2.2, cam: 'mid', rate: 0.8, gate: () => !!S(), wait: () => 'Shaking copies of the pile: ' + Math.round(D.shakeK * 100) + ' %.', in() { reset(); if (k) settled(true); }, run(u, t) { settled(!!k); view.setPerson(L().box, 0.6); if (k) view.placeAnim(D.n, L().shore, clamp(t / 1.7), [-2.6, 1.2]); say(k ? 'One shore. The same ' + S().n + ' tremors.' : 'An aftershock: ' + S().pga.toFixed(2) + ' g, assumed. ' + S().n + ' copies, ' + S().n + ' different tremors.'); figs([]); } },
      { id: 'b', dur: 7.2, cam: k ? 'pocket' : 'mid', rate: 0.5, run(u, t) { const q = r(), f = Math.min(q.total - 2, t * 60 * 0.85); mix(q.frames, Math.floor(f) * q.n * 7, q.frames, Math.min(q.total - 1, Math.floor(f) + 1) * q.n * 7, f % 1, D.n, poses); place(); if (k) shorePose(1); const i = Math.min(q.acc.length - 2, Math.floor(f) * 2); shakeA = Math.hypot(q.acc[i], q.acc[i + 1]) * 0.006; glow(q.frames, 1); view.setPerson(L().box, 0.6); say(k ? 'One shore. The same ' + S().n + ' tremors.' : 'This is copy ' + S().pick + ' of ' + S().n + '.'); figs([]); } },
      { id: 'c', dur: 5.5, cam: 'hold', rate: 0.55, hold: true, run(u, t) { const q = r(); mix(q.frames, (q.total - 1) * q.n * 7, q.frames, (q.total - 1) * q.n * 7, 0, D.n, poses); place(); if (k) shorePose(1); shakeA = 0; glow(q.frames, 1); view.setPerson(L().box, 0.7); say(shakeWords(k, lost())); figs([[lost() + ' of ' + S().n, '', k ? 'pockets lost, one shore' : 'pockets lost, no shore', lost() ? 'bad' : 'ok'], k ? [S().trials[0].filter((t2) => t2.lost).length + ' of ' + S().n, '', 'without the shore'] : null].filter(Boolean)); }, out() { glow(poses, 0); } },
    ];
  }
  function voidBeats() {
    const V = () => D.voids, at = (r) => V().curve.find((c) => Math.abs(c.r - r) < 1e-6);
    const stage = (r, dur, text) => ({ id: 'r' + r, dur, cam: 'high', rate: 0.5, run(u, t) { settled(false); ghostAll(0.94); night(1); if (L()) view.setPerson(L().box, 0.35); if (cloud) { cloud.visible = r > 0; cloud.material.uniforms.uR.value = r; cloud.material.uniforms.uA.value = cloudA.get(r) || 0.1; cloud.material.uniforms.uK.value = ease(clamp(t / 1.4)); } say(text(at(r))); figs([[String(at(r).b0), '', 'connected parts'], [String(at(r).b1), '', 'tunnels'], [String(at(r).b2), '', 'sealed cavities', r > 0 && at(r).b2 ? 'ok' : '']]); } });
    return [
      { id: 'in', dur: 2.2, cam: 'high', rate: 0.6, gate: () => !!V(), wait: () => 'Counting voids.', in() { reset(); }, run(u) { settled(false); ghostAll(0.94 * ease(u)); night(ease(u)); if (L()) view.setPerson(L().box, 0.35); say('Turn the pile to glass and count its holes.'); figs([]); } },
      stage(0, 3.4, () => 'Topology counts them without caring about their shape.'), stage(0.1, 3.4, (c) => 'Thicken the rubble by 10 cm: ' + c.b2 + ' pockets seal.'), stage(0.2, 3.6, (c) => 'By 20 cm: ' + c.b2 + '. Their way in is narrower than 40 cm.'), { ...stage(0.3, 5, (c) => 'By 30 cm: ' + c.b2 + '. Each count is a Betti number of the pile.'), hold: true, out() { ghostAll(0); if (cloud) cloud.visible = false; } } ];
  }
  function vineBeats() {
    const b = () => D.vine.bots, r = () => b().deep || b().vine; let shown = false;
    return [
      { id: 'in', dur: 2, cam: 'high', rate: 0.6, gate: () => !!D.vine && !!r(), wait: () => 'Planning a way in.', in() { reset(); shown = false; }, run(u) { settled(false); ghostAll(0.9 * ease(u)); night(ease(u)); if (L()) view.setPerson(L().box, 0.5); say('A vine robot grows from its tip. It does not drag its body.'); figs([]); } },
      { id: 'grow', dur: 8.5, cam: 'mid', rate: 0.4, run(u, t) { settled(false); ghostAll(0.9); night(1); if (!shown) { shown = true; const list = [{ id: 'deep', pts: r().pts, color: '--accent', radius: 0.04, length: r().length, speed: r().length / 6.5, through: true, label: '' }]; view.showRoutes(list); } say('It may bend no tighter than 13 cm and needs a 10 cm gap (assumed).'); figs([[(Math.min(1, t / 6.6) * r().length).toFixed(1), 'm', 'grown into the pile']]); } },
      { id: 'end', dur: 5, cam: 'mid', rate: 0.4, hold: true, run() { settled(false); ghostAll(0.9); night(1); say('The planner is real. The robot is not ours; it is a concept here.'); figs([[r().length.toFixed(1), 'm', 'route length'], [String(cm(r().minClear * 2)), 'cm', 'tightest gap'], [String(Math.round(r().turn * 57.3)), '°', 'total turning']]); }, out() { ghostAll(0); view.clearLayer('routes'); } },
    ];
  }
  const BEATS = { lift: liftBeats, shake: () => shakeBeats(0), shore: () => shakeBeats(1), voids: voidBeats, vine: vineBeats };
  const TAGS = { lift: ['sim', 'live-algo'], shake: ['live-algo'], shore: ['live-algo', 'concept'], voids: ['live-algo'], vine: ['concept', 'live-algo'] };
  function reset() { night(0); view.setPerson(null); view.jack.visible = false; hideShore(); glassK = 0; ghostAll(0); if (cloud) cloud.visible = false; view.clearLayer('routes'); clock(G.A, -100); clock(G.B, -100); shakeA = 0; view.post.uni.fin.uRew.value = 0; heat.fill(1); glow(poses, 0); view.drawLoad(null, 0, 0, poses, 0); }
  function go(id, user, beat = 0) {
    beats[bi]?.out?.(); chap = id; beats = BEATS[id](); bi = 0; bt = 0; for (const b of steps.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.id === id)); tag.replaceChildren(...TAGS[id].map((k) => realityTag(k)));
    act.classList.toggle('is-off', id !== 'lift'); if (D.pieces && view.items.length) { reset(); if (beat) { bi = beat; } enterBeat(); } if (user) lastUser = -1e9;
  }
  function enterBeat() { const b = beats[bi]; camTo(b.cam, b.rate); b.in?.(); setAct(); }
  function setAct() { const b = beats[bi]; if (chap !== 'lift') { act.disabled = true; return; } const shored = ['shore', 'liftB', 'answer'].includes(b.id); act.querySelector('span').textContent = shored ? 'Lift it without the shore' : 'Lift it with the shore'; act.disabled = !L(); act.dataset.to = shored ? 'liftA' : 'shore'; }
  function action() { if (!L()) return; const to = act.dataset.to, i = beats.findIndex((b) => b.id === to); beats[bi].out?.(); reset(); showCollapse(D.frames + 60); clock(G.COL, D.frames / 60 + 20); view.buildJackOnce(L().site); bi = i; bt = 0; enterBeat(); lastUser = -1e9; }
  function next() { const b = beats[bi]; b.out?.(); bi++; bt = 0; if (bi >= beats.length) { const k = CH.findIndex((c) => c[0] === chap); go(CH[(k + 1) % CH.length][0]); return; } enterBeat(); }
  function step(dt, time) {
    if (!D.pieces) { camStep(dt, time); if (D.error) say('The solver did not start: ' + D.error); return; }
    const b = beats[bi]; if (b) {
      if (b.gate && !b.gate()) { say(D.error ? 'Stopped: ' + D.error : b.wait ? b.wait() : 'Solving the collapse.'); if (chap === 'lift' && D.frames) { showCollapse(bi > 1 ? D.frames + 60 : 0); } else if (D.rest) settled(false); else if (D.frames) showCollapse(D.frames); }
      else { if (reducedMotion()) { const hb = beats.findIndex((q) => q.hold); if (bi !== hb && (!beats[hb].gate || beats[hb].gate()) && beats.slice(0, hb).every((q) => !q.gate || q.gate())) { b.out?.(); view.buildJackOnce?.(L()?.site); bi = hb; bt = 0; enterBeat(); gp.set(...CAM[beats[hb].cam][0]); cp.copy(gp); gt.set(...CAM[beats[hb].cam][1]); ct.copy(gt); } const q = beats[bi]; bt = q.dur * 0.9; q.run(0.9, bt, 0); }
        else { bt += dt; b.run(clamp(bt / b.dur), bt, dt); if (bt >= b.dur) next(); } }
    }
    const tot = beats.reduce((a, q) => a + q.dur, 0) || 1; let doneT = bt; for (let i = 0; i < bi; i++) doneT += beats[i].dur; bar.style.transform = 'scaleX(' + clamp(doneT / tot).toFixed(4) + ')';
    camStep(dt, time);
  }
  function enter() { // take the canvas
    view.clearFx(); view.setPile({ pieces: D.pieces }); view.setCovers(D.pieces); crushN = 0; refillFx(); for (const p of D.pieces) if (p.crushed) { p.crushed = false; p.boxes = p.box0 || p.boxes; view.rebuildPiece(p); }
    if (L()) { addShorePiece(); } if (!beats.length) go('lift'); else { reset(); enterBeat(); }
  }
  return { el, D, boot,
    start() { running = true; boot(); view.setFilm(step); view.controls.autoRotate = false; view.setLook('demo'); { enter(); for (const g of [G.COL, G.A, G.B]) view.setClock(g, curClock[g]); } },
    stop() { if (!running) return; running = false; view.setFilm(null); reset(); ghostAll(0); },
    get state() { return { chap, beat: beats[bi]?.id, bt, tried: D.tried, err: D.error, trace: L() && [L().a, L().b].map((r) => ({ moved: r.moved.slice(0, 6).map((m) => [D.pieces[m.idx]?.id, +m.d.toFixed(2)]), n: r.moved.length, F: [...r.tr.force].filter((_, i) => i % 24 === 0).map((x) => Math.round(x / 100) / 10), S: [...r.tr.shore].filter((_, i) => i % 24 === 0).map((x) => Math.round(x / 100) / 10), speed: r.speed })), shakeBy: D.shake && D.shake.trials.map((t) => t.filter((q) => q.lost).map((q) => q.by.join('+'))), lift: L() && { a: { h0: L().a.head0, worst: L().a.worst, moved: L().a.moved.length, F: L().a.peakF }, b: { h0: L().b.head0, worst: L().b.worst, i: L().b.worstI }, slip: L().slip, shut: L().shut, tried: L().tried, ms: L().ms, shore: L().shore, site: L().site, peakShore: L().peakShore }, shake: D.shake && D.shake.trials.map((t) => t.filter((q) => q.lost).length), voids: D.voids && D.voids.curve.map((c) => [c.r, c.b0, c.b1, c.b2]), vine: D.vine && Object.fromEntries(Object.entries(D.vine.bots).map(([k, r]) => [k, r && [r.length, r.minClear, r.turn]])) }; },
    jump(id, beat) { go(id, true); if (beat) { const i = beats.findIndex((b) => b.id === beat); if (i >= 0) { beats[bi].out?.(); if (id === 'lift' && L()) view.buildJackOnce(L().site); showCollapse(D.frames + 60); clock(G.COL, D.frames / 60 + 20); bi = i; bt = 0; enterBeat(); } } }, seek(t) { bt = t; } };
  function logFx(g, list) { (D.dustLog ||= []).push([g, list]); if (running && view.items.length) view.emitAll(g, list); }
  function refillFx() { if (D.dustLog) for (const [g, list] of D.dustLog) view.emitAll(g, list); }
}
