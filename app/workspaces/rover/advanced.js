// Advanced: the same model as an engineering instrument.
import * as THREE from 'three';
import { PARTS, SIGNAL, POWER, RAILS, CHAIN, FW } from './facts.js';

const VIEWS = [['parts', 'Parts'], ['section', 'Section'], ['xray', 'X-ray'], ['signal', 'Signal'], ['power', 'Power'], ['drive', 'Drive'], ['stop', 'Safety stop']];
const SHELLS = new Set(['frame', 'deck', 'mast', 'bank', 'battery', 'bank2']);
const SPM = FW.steps * FW.micro / (Math.PI * FW.wheelD), CAP = Math.min(FW.maxRate / SPM, 800), K = FW.lx + FW.ly; // steps per mm, top wheel speed mm/s
const clamp = (x, a, b) => x < a ? a : x > b ? b : x, svgEl = (t, a) => { const e = document.createElementNS('http://www.w3.org/2000/svg', t); for (const k in a) e.setAttribute(k, a[k]); return e; };

export function createAdvanced({ ctx, wrap, stage, st, R }) {
  const { h, realityTag, icon, cssVar, reducedMotion } = ctx.kit;
  const NEAR = new Set(['radio', 'radar', 'thermal', 'webcam', 'tof', 'pi', 'uno', 'battery', 'bank', 'bank2', 'drivers']), P0 = new THREE.Vector3(), TG = new THREE.Vector3(0, .15, 0); let back = 0, first = true;
  let view = 'parts', sel = null, cad = false, e = 0, eGoal = 0, on = false, visible = true;
  const cam = { th: .62, ph: 1.22, d: 1.75, gth: .62, gph: 1.22, gd: 1.75, ty: .15 };

  // ── layout
  const rows = new Map(), list = h('div.list.rover-list', { role: 'listbox', 'aria-label': 'Parts of the rover' }, ...PARTS.map((p) => { const b = h('button.list-item.rover-row', { type: 'button', role: 'option', 'aria-selected': 'false', onclick: () => pick(sel === p.id ? null : p.id) }, h('span', null, p.name), h('small', null, p.what)); rows.set(p.id, b); return b; }));
  const side = h('div.rover-side');
  const seg = h('div.seg.rover-views', { role: 'group', 'aria-label': 'View' }, ...VIEWS.map(([id, label]) => h('button', { type: 'button', 'data-v': id, 'aria-pressed': 'false', onclick: () => setView(id) }, label)));
  const tool = h('div.rover-tool'), angles = h('div.rover-angles', null, ...[['Front', 1.5708 - 1.5708, 1.45], ['Side', 1.5708, 1.45], ['Top', .0, .06], ['Photo', 0, 1.1167]].map(([n, th, ph]) => h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => { cam.gth = th; cam.gph = ph; cam.gd = n === 'Photo' ? 1.62 : 1.9; } }, n)));
  const model = h('div.seg', { role: 'group', 'aria-label': 'Which model' }, h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => setCad(false) }, 'As built'), h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setCad(true) }, 'CAD design'));
  const head = h('header.ws-head.rover-head', null, h('div', null, h('h2', null, 'The rover'), h('p', null, 'What each part is, what it talks to, and what stops it.')), h('span.grow'), model, realityTag('built'));
  const note = h('p.rover-note', null, 'The CAD is a design model. The built rover differs in places: foam-board deck and mast, wheel position, wiring. Boards are drawn at their outline sizes.');
  const adv = h('div.rover-adv.adv-only', null, head, h('section.panel.rover-left', { 'aria-label': 'Parts' }, h('header.panel-head', null, h('h3', null, 'Parts')), h('div.panel-body.flush', null, list)), h('section.panel.rover-right', { 'aria-label': 'Details' }, side), h('div.rover-bottom', null, h('div.rover-bar', null, seg, h('span.grow'), angles), tool, note));
  wrap.append(adv);

  // ── materials
  const ghost = new THREE.MeshBasicMaterial({ color: 0x8fa4bd, transparent: true, opacity: .055, depthWrite: false }); const meshes = []; R.built.traverse((m) => { if (m.isMesh) meshes.push([m, m.castShadow]); });
  function paint() { for (const [m, cs] of meshes) { const g = m.userData.group; const hide = (on && sel && g !== sel) || (on && !sel && view === 'xray' && SHELLS.has(g)); m.material = hide ? ghost : m.userData.mat; if (g !== 'wiring') m.castShadow = hide ? false : cs; } R.cables.visible = !(on && (sel && sel !== 'wiring')); }

  // ── links: moving beads between parts (signal and power)
  const N = 26, LM = Math.max(SIGNAL.length, POWER.length), beads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false }), N * LM); beads.frustumCulled = false; beads.visible = false; beads.renderOrder = 20; st.scene.add(beads);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), M = new THREE.Vector3(), O = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0), T = new THREE.Vector3();
  function recolor() { const L = view === 'power' ? POWER : SIGNAL; for (let i = 0; i < LM * N; i++) { const l = L[(i / N) | 0]; col.set(l ? (view === 'power' ? cssVar(RAILS.find((r) => r.id === l[2]).color) : l[0] === 'radio' ? cssVar('--person') : cssVar('--accent')) : '#000'); beads.setColorAt(i, col); } beads.instanceColor.needsUpdate = true; }
  function drawLinks(time) {
    const L = view === 'power' ? POWER : view === 'signal' ? SIGNAL : null; beads.visible = !!L && !cad; if (!beads.visible) return; R.root.updateMatrixWorld(); const tt = reducedMotion() ? 0 : time;
    for (let i = 0; i < LM; i++) { const l = L[i], dim = l && sel && l[0] !== sel && l[1] !== sel; if (l) { R.anchor(l[0], A); R.anchor(l[1], B); M.copy(A).add(B).multiplyScalar(.5); M.y += .03 + A.distanceTo(B) * .16; }
      for (let k = 0; k < N; k++) { const u = (k + (tt * 4) % 1) / N, r = !l ? 0 : (dim ? .0006 : .0016 + .0012 * Math.max(0, Math.sin((u * 3 - tt * 1.2) * 6.283))); if (l) { const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u; O.set(A.x * a + M.x * b + B.x * c, A.y * a + M.y * b + B.y * c, A.z * a + M.z * b + B.z * c); } S.set(r, r, r); beads.setMatrixAt(i * N + k, m4.compose(O, Q, S)); } }
    beads.instanceMatrix.needsUpdate = true;
  }

  // ── panels on the right
  const kv = (o) => h('dl.kv', null, ...Object.entries(o).filter(([, v]) => v).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
  const sec = (t, tag, ...k) => [h('header.panel-head', null, h('h3', null, t), tag), h('div.panel-body', null, ...k)];
  function partPanel() {
    const p = PARTS.find((x) => x.id === sel);
    if (!p) return sec('Pick a part', null, h('p.rover-lead', null, cad ? 'This is the CAD exactly as drawn. Switch to “As built” to pick parts.' : 'Click a part in the model, or a row on the left. Everything else fades away.'), h('p.rover-src', null, '241 parts in the CAD file. 17 groups here.'));
    const ch = p.chain.filter(Boolean);
    return sec(p.name, null, h('p.rover-lead', null, p.role), kv({ 'What it is': p.what, 'Connects by': p.iface, Power: p.power }), ch.length ? h('div.rover-chain', null, h('h4', null, 'Its place in the chain'), h('ol', null, ...ch.map((c) => h('li', { class: /^Th(is|ese) /.test(c) ? 'me' : '' }, c)))) : null, h('p.rover-src', null, 'Source: ' + p.src), h('button.btn.btn-sm', { type: 'button', onclick: () => pick(null) }, 'Show everything'));
  }
  const nm = (id) => PARTS.find((x) => x.id === id).name;
  const signalPanel = () => sec('From a Wi-Fi probe to an answer', null, h('ol.rover-steps', null, ...CHAIN.map(([a, b]) => h('li', null, h('b', null, a), h('span', null, b)))), h('h4.rover-sub4', null, 'The other links'), kv(Object.fromEntries(SIGNAL.slice(1).map(([a, b, c]) => [nm(a), c + ' to ' + nm(b)]))), h('p.rover-src', null, 'Orange beads: the Wi-Fi radio. Blue: the other sensors and the drive commands.'));
  const powerPanel = () => sec('Batteries and the rails drawn here', null, h('p.rover-lead', null, 'The motors and the computer do not share a battery.'), h('table.table.rover-rails', null, h('thead', null, h('tr', null, h('th', null, 'Supply'), h('th.num', null, 'Voltage'), h('th', null, 'Feeds'))), h('tbody', null, ...RAILS.map((r) => h('tr', null, h('td', null, h('i.rover-key', { style: { background: 'var(' + r.color + ')' } }), r.name), h('td.num', null, r.v), h('td', null, r.feeds))))), h('p.rover-src', null, 'Source: wiring.json in the design study.'));

  // drive: the firmware's own mixing, ramp and limits
  const D = { t: [0, 0, 0], c: [0, 0, 0], w: [0, 0, 0, 0], head: 0, keys: new Set() }, WN = [['FL', 'Front left'], ['FR', 'Front right'], ['RL', 'Rear left'], ['RR', 'Rear right']];
  let cells = [], bodyCell = null, keyBtns = {};
  const KEYS = { ArrowUp: ['Forward', [1, 0, 0]], ArrowDown: ['Back', [-1, 0, 0]], ArrowLeft: ['Left', [0, 1, 0]], ArrowRight: ['Right', [0, -1, 0]], q: ['Turn left', [0, 0, 1]], e: ['Turn right', [0, 0, -1]] }, GL = { ArrowUp: 'arrow-up', ArrowDown: 'arrow-down', ArrowLeft: 'arrow-left', ArrowRight: 'arrow-right', q: 'undo', e: 'redo' };
  function drivePanel() {
    cells = []; keyBtns = {}; const pad = h('div.rover-pad', null, ...['q', 'ArrowUp', 'e', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].map((k) => { const b = h('button.btn.btn-icon', { type: 'button', 'aria-label': KEYS[k][0], title: KEYS[k][0] }, icon(GL[k], 18)); b.addEventListener('pointerdown', () => { D.keys.add(k); }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) b.addEventListener(ev, () => D.keys.delete(k)); b.addEventListener('keydown', (x) => { if (x.key === ' ' || x.key === 'Enter') { x.preventDefault(); D.keys.add(k); } }); b.addEventListener('keyup', () => D.keys.delete(k)); keyBtns[k] = b; return b; }));
    bodyCell = h('p.rover-body.num', null, ' ');
    return sec('Drive it', realityTag('live-algo'), h('p.rover-lead', null, 'Hold the arrow keys, or Q and E to turn.'), pad, bodyCell, h('table.table', null, h('thead', null, h('tr', null, h('th', null, 'Wheel'), h('th.num', null, 'rad/s'), h('th.num', null, 'steps/s'), h('th', null, ''))), h('tbody', null, ...WN.map(([, n], i) => { const a = h('td.num', null, '0.0'), b = h('td.num', null, '0'), bar = h('i'); cells[i] = { a, b, bar }; return h('tr', null, h('td', null, n), a, b, h('td.rover-wb', null, bar)); }))), h('p.rover-src', null, 'Mixing, 600 mm/s² ramp, 3× braking and ' + FW.maxRate.toLocaleString('en') + ' steps/s limit (' + CAP.toFixed(0) + ' mm/s) come from the drive firmware, running here on your keys.'));
  }
  // 400 ms stop
  const Z = { v: FW.cruise, t: -1, run: false }; let zDot, zDash, zText, zPath;
  const zV = (t) => t <= FW.watchdog ? Z.v : Math.max(0, Z.v - 3 * FW.accel * (t - FW.watchdog) / 1000), zStop = () => FW.watchdog + Z.v / (3 * FW.accel) * 1000, zDist = () => Z.v * FW.watchdog / 1000 + Z.v * Z.v / (2 * 3 * FW.accel);
  function stopPanel() {
    const s = svgEl('svg', { viewBox: '0 0 288 190', class: 'rover-tl', role: 'img', 'aria-label': 'Wheel speed against time after the Pi goes quiet' }), X = (t) => 34 + t / 800 * 244, Y = (v) => 146 - v / 560 * 118; s.X = X; s.Y = Y;
    const tx = (x, y, t, a = 'middle', c = 'axis') => { const q = svgEl('text', { x, y, 'text-anchor': a, class: c }); q.textContent = t; s.append(q); };
    for (const v of [0, 200, 400]) { s.append(svgEl('line', { x1: 34, x2: 278, y1: Y(v), y2: Y(v), class: 'gl' })); tx(29, Y(v) + 4, v, 'end'); } for (const t of [0, 200, 400, 600, 800]) tx(X(t), 162, t);
    tx(34, 12, 'Speed, mm/s', 'start'); tx(278, 182, 'ms after the last command', 'end'); s.append(svgEl('rect', { x: X(0), y: 22, width: X(FW.watchdog) - X(0), height: 124, class: 'band' }), svgEl('line', { x1: X(FW.watchdog), x2: X(FW.watchdog), y1: 22, y2: 146, class: 'wd' })); tx(X(200), 34, 'last command runs', 'middle', 'lab'); tx(X(FW.watchdog) + 5, 34, '400 ms: R4 stops', 'start', 'lab wd');
    zPath = svgEl('path', { class: 'cv' }); zDash = svgEl('line', { y1: 22, y2: 146, class: 'now' }); zDot = svgEl('circle', { r: 4, class: 'dt' }); s.append(zPath, zDash, zDot); zText = h('p.rover-body.num', null, ' ');
    const sp = h('div.seg', { role: 'group', 'aria-label': 'Speed' }, ...[FW.cruise, Math.round(CAP)].map((v) => h('button', { type: 'button', 'aria-pressed': String(v === Z.v), onclick: (x) => { Z.v = v; for (const b of sp.children) b.setAttribute('aria-pressed', String(b === x.currentTarget)); drawZ(); } }, v + ' mm/s')));
    const r = sec('The Pi goes quiet. Then what?', realityTag('live-algo'), h('p.rover-lead', null, 'The motor board stops the wheels on its own. It does not need the Pi, the laptop or the network.'), h('div.row', null, sp), s, zText, h('button.btn.btn-primary', { type: 'button', onclick: () => { Z.run = true; Z.t = -500; } }, 'Cut the link'), h('p.rover-src', null, 'Played at quarter speed. Computed from the firmware’s constants; not timed on the machine. A second layer: if the browser stops sending for 0.6 s, the Pi stops the rover.'));
    drawZ(); return r;
  }
  function drawZ() { if (!zPath) return; const X = (t) => 34 + t / 800 * 244, Y = (v) => 146 - v / 560 * 118, end = zStop(); zPath.setAttribute('d', 'M' + X(0) + ' ' + Y(Z.v) + 'L' + X(400) + ' ' + Y(Z.v) + 'L' + X(end) + ' ' + Y(0) + 'L' + X(800) + ' ' + Y(0)); const t = clamp(Z.t, 0, 800); zDash.setAttribute('x1', X(t)); zDash.setAttribute('x2', X(t)); zDot.setAttribute('cx', X(t)); zDot.setAttribute('cy', Y(zV(t))); zText.textContent = 'Stopped after ' + end.toFixed(0) + ' ms and ' + zDist().toFixed(0) + ' mm.'; }

  function tools() {
    const sl = (label, min, max, step, val, fn, fmt) => { const out = h('output.num', null, fmt(val)), i = h('input.slider', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(val), 'aria-label': label }); const p = () => i.style.setProperty('--p', ((i.value - min) / (max - min) * 100) + '%'); i.addEventListener('input', () => { fn(+i.value); out.textContent = fmt(+i.value); p(); }); p(); return h('label.rover-slide', null, h('span', null, label), i, out); };
    if (view === 'section') { const ax = h('div.seg', { role: 'group', 'aria-label': 'Cut direction' }, ...[['x', 'Front to back'], ['y', 'Side to side'], ['z', 'Top down']].map(([a, l]) => h('button', { type: 'button', 'aria-pressed': String(cut.a === a), onclick: () => { cut.a = a; cut.v = a === 'z' ? .25 : 0; setCut(); tools(); } }, l))); const [lo, hi] = cut.a === 'z' ? [0, .5] : [-.28, .28]; tool.replaceChildren(ax, sl('Cut', lo, hi, .002, cut.v, (v) => { cut.v = v; setCut(); }, (v) => Math.round(v * 1000) + ' mm')); }
    else if (cad) tool.replaceChildren(h('span.rover-hint', null, 'The design file, 241 parts, shown whole. Drag to look around.')); else if (view === 'drive' || view === 'stop') tool.replaceChildren(h('span.rover-hint', null, view === 'drive' ? 'Arrow keys drive. Q and E turn. Drag to look around.' : 'Press “Cut the link” and watch the wheels.'));
    else tool.replaceChildren(sl('Take apart', 0, 1, .005, eGoal, (v) => { eGoal = v; }, (v) => Math.round(v * 100) + ' %'));
  }
  const cut = { a: 'x', v: 0, plane: new THREE.Plane() };
  function setCut() { if (!on || view !== 'section') { if (st.renderer.clippingPlanes.length) st.renderer.clippingPlanes = []; return; } cut.plane.normal.set(cut.a === 'x' ? -1 : 0, cut.a === 'z' ? -1 : 0, cut.a === 'y' ? 1 : 0); cut.plane.constant = cut.v; if (!st.renderer.clippingPlanes.length) st.renderer.clippingPlanes = [cut.plane]; }
  function fill() { side.replaceChildren(...(view === 'signal' && !sel ? signalPanel() : view === 'power' && !sel ? powerPanel() : view === 'drive' ? drivePanel() : view === 'stop' ? stopPanel() : partPanel()).filter(Boolean)); }
  function setView(v) {
    view = v; for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.v === v)); D.keys.clear(); if (v !== 'drive') { D.t = [0, 0, 0]; D.c = [0, 0, 0]; R.root.rotation.z = 0; D.head = 0; } Z.run = false; Z.t = 0; sel = null; syncRows();
    back = 0; if (cad) setCad(false, true); eGoal = v === 'signal' || v === 'power' ? 1 : v === 'parts' ? eGoal : 0; cam.gd = v === 'signal' || v === 'power' ? 2.55 : v === 'stop' ? 1.35 : 1.75; if (v === 'stop') { cam.gth = .9; cam.gph = 1.42; } else if (v === 'drive') cam.gph = 1.12;
    tools(); fill(); paint(); setCut(); recolor();
  }
  function syncRows() { for (const [id, b] of rows) b.setAttribute('aria-selected', String(id === sel)); }
  function pick(id) { if (cad) setCad(false, true); sel = id; if (sel && (view === 'drive' || view === 'stop')) { setView('parts'); sel = id; } syncRows(); const row = rows.get(sel), box = list.parentElement; if (row) { if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop; else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight; } if (NEAR.has(sel)) { if (!back) back = cam.gd; cam.gd = .62; } else if (back) { cam.gd = back; back = 0; } fill(); paint(); }
  function setCad(v, quiet) { cad = v; model.children[0].setAttribute('aria-pressed', String(!v)); model.children[1].setAttribute('aria-pressed', String(v)); R.cad.visible = on && v; R.built.visible = !(on && v); if (v) { sel = null; eGoal = 0; syncRows(); if (view !== 'parts' && view !== 'section') { view = 'parts'; for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.v === 'parts')); tools(); setCut(); } paint(); } tools(); if (!quiet) fill(); }

  // ── input on the stage
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let drag = null; const isAdv = () => on && visible;
  stage.addEventListener('pointerdown', (x) => { if (!isAdv() || x.button) return; stage.setPointerCapture(x.pointerId); drag = { x: x.clientX, y: x.clientY, th: cam.gth, ph: cam.gph, moved: 0 }; });
  stage.addEventListener('pointermove', (x) => { if (!drag || !isAdv()) return; const dx = x.clientX - drag.x, dy = x.clientY - drag.y; drag.moved = Math.max(drag.moved, Math.hypot(dx, dy)); if (drag.moved < 4) return; cam.gth = drag.th + dx * .006; cam.gph = clamp(drag.ph - dy * .005, .05, 1.54); });
  stage.addEventListener('pointerup', (x) => { if (drag && isAdv() && drag.moved < 4 && !cad) { const b = stage.getBoundingClientRect(); ptr.set((x.clientX - b.left) / b.width * 2 - 1, -(x.clientY - b.top) / b.height * 2 + 1); ray.setFromCamera(ptr, st.camera); const hit = ray.intersectObject(R.built, true).find((q) => q.object.visible && (view !== 'section' || cut.plane.distanceToPoint(q.point) >= 0)); pick(hit ? hit.object.userData.group || null : null); } drag = null; }); stage.addEventListener('pointercancel', () => { drag = null; });
  stage.addEventListener('wheel', (x) => { if (!isAdv()) return; x.preventDefault(); cam.gd = clamp(cam.gd * Math.exp(clamp(x.deltaY, -120, 120) * .0016), .55, 3.6); }, { passive: false });
  const key = (x) => (x.key.length === 1 ? x.key.toLowerCase() : x.key), typing = (x) => x.target.closest?.('input,textarea,select,[contenteditable]');
  addEventListener('keydown', (x) => { if (!isAdv() || ctx.shell?.current?.() !== 'rover') return; if (x.key === 'Escape' && sel) { pick(null); return; } if (view === 'drive' && KEYS[key(x)] && !typing(x) && !x.metaKey && !x.ctrlKey) { x.preventDefault(); x.stopPropagation(); D.keys.add(key(x)); } }, true);
  addEventListener('keyup', (x) => D.keys.delete(key(x)), true); addEventListener('blur', () => D.keys.clear());

  function roll(dt) { // wheels, rollers and floor from the body velocity
    const [vx, vy, wz] = D.c, w = D.w; w[0] = vx - vy - wz * K; w[1] = vx + vy + wz * K; w[2] = vx + vy - wz * K; w[3] = vx - vy + wz * K;
    for (let i = 0; i < 4; i++) { const W = R.wheels[i]; W.angle += w[i] / (FW.wheelD / 2) * dt; const lat = vy + wz * W.sx * FW.lx, ca = Math.cos(W.angle), sa = Math.sin(W.angle); for (const r of W.rest) { const z = -r.dir.x * sa + r.dir.z * ca; if (z < -.6) r.spin += lat * 1.4142 / 8 * dt * clamp((-z - .6) * 4, 0, 1) * (W.sx * W.sy); } if (w[i] || lat) R.poseWheel(W); }
    if (vx || vy || wz) { D.head += wz * dt; R.root.rotation.z = D.head; const c = Math.cos(D.head), s = Math.sin(D.head), mx = (vx * c - vy * s) / 1000 * dt, my = (vx * s + vy * c) / 1000 * dt; st.floorU.uOff.value.x += mx; st.floorU.uOff.value.y -= my; }
  }
  function drive(dt) {
    let x = 0, y = 0, z = 0; for (const k of D.keys) { const v = KEYS[k]?.[1]; if (v) { x += v[0]; y += v[1]; z += v[2]; } } const sp = FW.cruise, tv = [x * sp, y * sp, z * sp * .8 / K];
    const wm = Math.max(Math.abs(tv[0] - tv[1] - tv[2] * K), Math.abs(tv[0] + tv[1] + tv[2] * K), Math.abs(tv[0] + tv[1] - tv[2] * K), Math.abs(tv[0] - tv[1] + tv[2] * K)), sc = wm > CAP ? CAP / wm : 1;
    const tgt = [tv[0] * sc, tv[1] * sc, tv[2] * sc * K], now = [D.c[0], D.c[1], D.c[2] * K]; let need = 0; for (let i = 0; i < 3; i++) { const a = FW.accel * (Math.abs(tgt[i]) < Math.abs(now[i]) ? 3 : 1); need = Math.max(need, Math.abs(tgt[i] - now[i]) / a); } const f = need <= dt ? 1 : dt / need; for (let i = 0; i < 3; i++) now[i] += (tgt[i] - now[i]) * f; D.c[0] = now[0]; D.c[1] = now[1]; D.c[2] = now[2] / K; roll(dt);
    for (let i = 0; i < 4; i++) { const c = cells[i]; if (!c) continue; c.a.textContent = (D.w[i] / 40).toFixed(1); c.b.textContent = Math.round(D.w[i] * SPM).toLocaleString('en'); c.bar.style.transform = 'scaleX(' + (D.w[i] / CAP).toFixed(3) + ')'; } if (bodyCell) bodyCell.textContent = 'forward ' + D.c[0].toFixed(0) + '  left ' + D.c[1].toFixed(0) + ' mm/s  turn ' + D.c[2].toFixed(2) + ' rad/s'; for (const k in keyBtns) keyBtns[k].classList.toggle('on', D.keys.has(k));
  }
  function stopRun(dt) { if (!Z.run) { D.c[0] = D.c[1] = D.c[2] = 0; return; } const r = reducedMotion(); Z.t = r ? 800 : Z.t + dt * 1000 * .25 * (Z.t < 0 ? 4 : 1); const q = dt * .25; D.c[0] = zV(Math.max(0, Z.t)); D.c[1] = D.c[2] = 0; roll(q); drawZ(); if (Z.t >= 800) { Z.run = false; Z.t = 800; drawZ(); } }

  return {
    enter() { on = true; paint(); setCad(cad, true); st.key.intensity = 11; st.strip.intensity = 4; st.stripAt(.9, 1.05, -.6); st.scene.environmentRotation.y = .4; e = eGoal; setView(view); },
    leave() { on = false; st.renderer.clippingPlanes = []; paint(); R.cad.visible = false; R.built.visible = true; beads.visible = false; R.root.rotation.z = 0; D.head = 0; D.c = [0, 0, 0]; D.keys.clear(); },
    show(v) { visible = v; if (!v) D.keys.clear(); },
    update(dt, time) {
      const k = reducedMotion() ? 1 : 1 - Math.exp(-dt * 10); e += (eGoal - e) * (reducedMotion() ? 1 : 1 - Math.exp(-dt * 5)); if (Math.abs(e - eGoal) < .0005) e = eGoal; R.explode(e);
      cam.th += (cam.gth - cam.th) * k; cam.ph += (cam.gph - cam.ph) * k; cam.d += (cam.gd - cam.d) * k; cam.ty = .15 + .20 * e; const s = Math.sin(cam.ph); P0.set(-.04 * e, cam.ty, 0); if (NEAR.has(sel)) { R.root.updateMatrixWorld(); R.anchor(sel, P0); } if (first) { TG.copy(P0); first = false; } TG.lerp(P0, k); T.copy(TG); st.camera.position.set(T.x + Math.cos(cam.th) * s * cam.d, T.y + Math.cos(cam.ph) * cam.d, T.z + Math.sin(cam.th) * s * cam.d); if (st.camera.position.y < .02) st.camera.position.y = .02; st.camera.lookAt(T); if (Math.abs(st.camera.fov - 28) > .01) { st.camera.fov = 28; st.camera.updateProjectionMatrix(); } st.camera.updateMatrixWorld();
      if (view === 'drive') drive(dt); else if (view === 'stop') stopRun(dt); drawLinks(time);
    },
  };
}
