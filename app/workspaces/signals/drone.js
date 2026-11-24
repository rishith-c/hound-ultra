// Drone as a transmitter: a concept. Nothing here is built. The picture is the textbook two-ray (Fresnel zone)
// model of Wi-Fi sensing: the rover hears the drone directly, and also by a weak echo off the person's chest.
// Breathing moves the chest a few millimetres, which changes the echo's path, which changes how the two add up.
// How much it changes depends on where the chest sits inside a Fresnel zone, and that depends on where the
// transmitter is. Reflection strength and rubble loss are ASSUMED; the 0.5 % noise figure is from our simulator.
import { pointInPoly, mulberry32, dist } from '../../core/geometry.js';
import { C, surface, slider, seg, intro, text, rgba, clamp, gauss } from './util.js';

const VIEW = [1.5, -2.4, 22.5, 14.6];        // metres: x along the ground, y up
const RX = [17.9, 0.42], CHEST = [13.2, 0.55];
const A0 = 0.035, CHEST_PP = 0.005;          // echo strength before rubble (assumed); chest travel, 5 mm (assumed)
const LOSS = { 2.4: 5, 5: 9 };               // dB per metre of rubble (assumed)
const NOISE1 = 0.5, NOISE51 = 0.5 / Math.sqrt(51); // % per subcarrier (FACTS); after averaging 51 if independent (assumed)
const STOPS = [4, 6, 8, 10, 12, 14, 16, 18];

export function create(root, ctx) {
  const { h, realityTag, reducedMotion } = ctx.kit;
  let tx = [8.6, 10.5], band = 2.4, cover = 0.6, shown = false, raf = 0, t = 0, lastT = 0, drag = false;
  let pass = null, visits = [], trace = new Float32Array(360), tracePos = 0, traceAcc = 0;
  const rng = mulberry32(31);

  // The pile: a mound of broken slabs. Its height over the person is the "rubble over the person" control.
  const mound = () => { const top = CHEST[1] + 0.45 + cover; return [[5.6, 0], [6.9, top * 0.55], [9.4, top * 0.9], [12, top + 0.25], [14.2, top], [15.5, top * 0.6], [16.3, 0]]; };
  const VOID = [[11.9, 0.05], [12.3, 0.85], [13.4, 1.0], [14.5, 0.8], [14.8, 0.05]];
  function rubbleOn(a, b) { const m = mound(); let n = 0; const N = 120; for (let i = 0; i < N; i++) { const f = (i + 0.5) / N, p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; if (p[1] > 0 && pointInPoly(p, m) && !pointInPoly(p, VOID)) n++; } return (n / N) * dist(a, b); }
  function physics(T = tx) {
    const lam = 0.299792 / band, dLos = dist(T, RX), d1 = dist(T, CHEST), d2 = dist(CHEST, RX), excess = d1 + d2 - dLos;
    const rub = rubbleOn(T, CHEST) + rubbleOn(CHEST, RX), a = A0 * Math.pow(10, -(LOSS[band] * rub) / 20);
    const phi = (2 * Math.PI * excess) / lam, dPath = CHEST_PP * ((T[1] - CHEST[1]) / d1 + (RX[1] - CHEST[1]) / d2); // chest moves up and down
    const dPhi = (2 * Math.PI * dPath) / lam, depth = 100 * a * Math.abs(Math.cos(phi + dPhi / 2) - Math.cos(phi - dPhi / 2)); // % peak to peak
    return { lam, excess, zone: Math.floor(excess / (lam / 2)) + 1, frac: (excess / (lam / 2)) % 1, rub, a, phi, dPhi, depth, best: 100 * a * Math.abs(dPhi), dLos };
  }

  // ----- layout -----
  const scene = surface('signals-canvas', () => draw());
  scene.canvas.tabIndex = 0; scene.canvas.setAttribute('role', 'application'); scene.canvas.setAttribute('aria-label', 'Side view: a drone above a rubble pile transmits, the rover on the ground listens, a person lies in a void. Drag the drone, or use the arrow keys to move it.');
  const sX = slider({ label: 'Drone position along the pile', min: 2.5, max: 21.5, step: 0.01, value: tx[0], format: (v) => v.toFixed(2) + ' m', onInput: (v) => { stopPass(); tx[0] = v; changed(); } });
  const sY = slider({ label: 'Drone height', min: 5, max: 14, step: 0.1, value: tx[1], format: (v) => v.toFixed(1) + ' m', onInput: (v) => { stopPass(); tx[1] = v; visits = []; changed(); } });
  const sC = slider({ label: 'Rubble over the person', min: 0.3, max: 2.4, step: 0.1, value: cover, format: (v) => v.toFixed(1) + ' m', onInput: (v) => { cover = v; visits = []; changed(); } });
  const bandSeg = seg([{ id: '2.4', label: '2.4 GHz' }, { id: '5', label: '5 GHz' }], '2.4', (v) => { band = +v; visits = []; changed(); }, 'Wi-Fi band');
  const passBtn = h('button.btn.btn-primary', { type: 'button', onclick: () => (pass ? stopPass() : startPass()) }, 'Fly the pass: eight hover points');
  const nudge = (d) => h('button.btn.btn-sm', { type: 'button', onclick: () => { stopPass(); tx[0] = clamp(tx[0] + d, 2.5, 21.5); sX.set(tx[0]); changed(); } }, (d > 0 ? 'Right ' : 'Left ') + Math.abs(d * 100) + ' cm');
  const rail = h('section.panel.signals-rail', { 'aria-label': 'Drone transmitter' }, h('div.panel-body', null,
    intro('Drone as the transmitter', realityTag('concept'), 'HOUND’s Wi-Fi sensing needs a transmitter on the far side of the person. A drone hovering over the pile could be that transmitter, and because it can move, it can pick a spot where a still person’s breathing shows up instead of cancelling out.'),
    h('div.signals-group', null, passBtn, h('div.signals-btnrow', null, nudge(-0.03), nudge(0.03)), h('p.signals-hint', null, 'Or drag the drone. Three centimetres is enough to turn a blind spot into a good one.')),
    h('div.signals-group', null, sX.el, sY.el, sC.el, h('div.row', null, h('span.grow.muted', { style: { fontSize: '12px' } }, 'Wi-Fi band'), bandSeg.el)),
    h('div.note.warn', { style: { marginTop: 'auto' } }, h('span', null, h('b', null, 'The real limit. '), 'In our simulated tests the network finds a still person only 21.4 % of the time: breathing changes the signal by 0.05 to 0.4 %, under the ESP32’s 0.5 % noise per subcarrier. This idea attacks that case. It is not built or tested.')),
    h('p.signals-hint', null, 'Assumed here: the echo’s strength, 5 mm of chest travel, rubble loss of ' + LOSS[2.4] + ' dB per metre at 2.4 GHz and ' + LOSS[5] + ' at 5 GHz. A real drone also drifts by more than a wavelength; telling that apart from breathing is unsolved.')));
  const scenePanel = h('section.panel', { 'aria-label': 'Side view', style: { flex: '1' } }, h('header.panel-head', null, h('h3', null, 'Side view: the drone transmits, the rover listens, the echo off the chest is what matters'), realityTag('concept')), h('div.signals-fill', null, scene.canvas));
  const sumEl = h('span.tag.tag-ok.plain', { hidden: true, 'aria-live': 'polite' });
  const sweep = surface('signals-canvas', () => drawSweep());
  sweep.canvas.setAttribute('role', 'img'); sweep.canvas.setAttribute('aria-label', 'How strongly breathing shows at the rover for every drone position along the pass');
  const sweepPanel = h('section.panel', { 'aria-label': 'Along the pass', style: { flex: '0 0 196px' } }, h('header.panel-head', null, h('h3', null, 'One hover point can be blind. Eight are unlikely to all be.'), sumEl, realityTag('live-algo')), h('div.signals-fill', null, sweep.canvas));
  const inset = surface('signals-canvas', () => drawInset());
  inset.canvas.setAttribute('role', 'img'); inset.canvas.setAttribute('aria-label', 'Thirty centimetres around the chest, magnified, with the Fresnel zones drawn as bands');
  const insetPanel = h('section.panel', { 'aria-label': 'At the chest', style: { flex: '1 1 200px' } }, h('header.panel-head', null, h('h3', null, 'At the chest, 30 cm wide: Fresnel zones as bands')), h('div.signals-fill', null, inset.canvas));
  const scope = surface('signals-canvas', () => drawScope());
  scope.canvas.setAttribute('role', 'img'); scope.canvas.setAttribute('aria-label', 'Signal strength at the rover over the last twelve seconds');
  const scopePanel = h('section.panel', { 'aria-label': 'At the rover', style: { flex: '0 0 170px' } }, h('header.panel-head', null, h('h3', null, 'What the rover receives, last 12 s'), realityTag('sim')), h('div.signals-fill', null, scope.canvas));
  const stDepth = h('b'), stZone = h('b'), stRub = h('b'), stEx = h('b'), verdict = h('p.signals-verdict');
  const statPanel = h('section.panel', { 'aria-label': 'Numbers' }, h('div.panel-body', { style: { flex: 'none' } },
    h('div.signals-stats', null, h('div.stat', null, stDepth, h('span', null, 'breathing swing in the signal (noise: 0.5 % per subcarrier)')), h('div.stat', null, stZone, h('span', null, 'Fresnel zone the chest is in, and how far across it')),
      h('div.stat', null, stRub, h('span', null, 'rubble the echo crosses, and what it costs (assumed)')), h('div.stat', null, stEx, h('span', null, 'extra distance the echo travels'))),
    h('div', { style: { marginTop: '10px' } }, verdict)));
  root.append(rail, h('div.signals-col', null, scenePanel, sweepPanel), h('div.signals-col', null, insetPanel, scopePanel, statPanel));

  function changed() { renderStats(); if (!shown) return; if (!raf) raf = requestAnimationFrame(tick); }
  function renderStats() {
    const p = physics(), mid = Math.abs(p.frac - 0.5) < 0.25;
    stDepth.replaceChildren(p.depth.toFixed(p.depth < 0.1 ? 3 : 2), h('small', null, '%')); stZone.replaceChildren(String(p.zone), h('small', null, Math.round(p.frac * 100) + ' % across'));
    stRub.replaceChildren(p.rub.toFixed(1), h('small', null, 'm, −' + (LOSS[band] * p.rub).toFixed(0) + ' dB')); stEx.replaceChildren(p.excess.toFixed(2), h('small', null, 'm = ' + (p.excess / p.lam).toFixed(1) + ' waves'));
    verdict.replaceChildren(p.best < NOISE51 * 2 ? h('span', null, h('b', null, 'Too much rubble. '), 'Even at the best spot the echo is weaker than the noise that remains after averaging.')
      : mid ? h('span', null, h('b', null, 'Good spot. '), 'The chest sits in the middle of a zone, so each breath changes how the echo adds to the direct signal.')
        : h('span', null, h('b', null, 'Blind spot. '), 'The chest sits on a zone edge, where the echo is already at its strongest or weakest and a small movement changes almost nothing. Move the drone a few centimetres.'));
  }

  // ----- the side view -----
  let tf = { s: 1, ox: 0, oy: 0 };
  const PX = (p) => [tf.ox + (p[0] - VIEW[0]) * tf.s, tf.oy + (VIEW[3] - p[1]) * tf.s];
  const debris = []; { const r = mulberry32(8); for (let i = 0; i < 70; i++) debris.push([r(), r(), r(), r()]); }
  function draw() {
    const { c, w, h: H } = scene; if (!w) return; c.clearRect(0, 0, w, H);
    const s = Math.min(w / (VIEW[2] - VIEW[0]), H / (VIEW[3] - VIEW[1])); tf = { s, ox: (w - (VIEW[2] - VIEW[0]) * s) / 2, oy: (H - (VIEW[3] - VIEW[1]) * s) / 2 };
    const p = physics(), [gx0, gy] = PX([VIEW[0], 0]), [gx1] = PX([VIEW[2], 0]), T = PX(tx), R = PX(RX), P = PX(CHEST), m = mound();
    // air, ground
    const sky = c.createLinearGradient(0, 0, 0, gy); sky.addColorStop(0, C.bg1); sky.addColorStop(1, C.bg2); c.fillStyle = sky; c.fillRect(0, 0, w, gy);
    c.fillStyle = C.bg0; c.fillRect(0, gy, w, H - gy);
    for (let x = 2; x <= 22; x += 2) { const [px] = PX([x, 0]); c.fillStyle = C.line2; c.fillRect(Math.round(px), gy, 1, 5); text(c, x + (x === 22 ? ' m' : ''), px, gy + 17, { align: 'center', color: C.text3, mono: true }); }
    // Fresnel zones: every point on one ellipse gives the echo the same extra distance
    const cx = (tx[0] + RX[0]) / 2, cy = (tx[1] + RX[1]) / 2, ang = Math.atan2(RX[1] - tx[1], RX[0] - tx[0]), half = p.dLos / 2;
    const ell = (excess, style, lw, dash) => { const a = (p.dLos + excess) / 2, b = Math.sqrt(Math.max(1e-6, a * a - half * half)); c.save(); c.beginPath(); c.rect(0, 0, w, gy); c.clip(); c.beginPath(); c.ellipse(PX([cx, cy])[0], PX([cx, cy])[1], a * s, b * s, -ang, 0, 6.2832); c.strokeStyle = style; c.lineWidth = lw; c.setLineDash(dash || []); c.stroke(); c.restore(); c.setLineDash([]); };
    const stepN = Math.max(1, Math.round(p.zone / 7));
    for (let n = stepN; n <= p.zone * 1.6 + stepN; n += stepN) ell((n * p.lam) / 2, rgba(C.accent, 0.13), 1);
    ell(p.lam / 2, rgba(C.accent, 0.5), 1); ell(p.excess, rgba(C.accent, 0.75), 1.4, [5, 4]);
    // the pile
    c.beginPath(); m.forEach((q, i) => { const [x, y] = PX(q); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath();
    const g = c.createLinearGradient(0, PX([0, m[3][1]])[1], 0, gy); g.addColorStop(0, C.bg4); g.addColorStop(1, C.bg3); c.fillStyle = g; c.fill();
    c.save(); c.clip();
    for (const [a, b, d, e] of debris) { const x = 5.6 + a * 10.8, y = b * (m[3][1] + 0.2), len = 0.5 + d * 1.9, tilt = (e - 0.5) * 0.5, [px, py] = PX([x, y]); c.save(); c.translate(px, py); c.rotate(tilt); c.fillStyle = rgba(C.text, 0.035 + d * 0.05); c.fillRect(-len * s / 2, -0.07 * s, len * s, 0.14 * s); c.strokeStyle = rgba(C.bg0, 0.55); c.lineWidth = 1; c.strokeRect(-len * s / 2, -0.07 * s, len * s, 0.14 * s); c.restore(); }
    c.restore();
    c.beginPath(); m.forEach((q, i) => { const [x, y] = PX(q); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.strokeStyle = C.line2; c.lineWidth = 1.5; c.stroke();
    // the void and the person in it
    c.beginPath(); VOID.forEach((q, i) => { const [x, y] = PX(q); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); c.fillStyle = C.bg0; c.fill(); c.strokeStyle = rgba(C.text, 0.18); c.lineWidth = 1; c.stroke();
    const br = Math.sin(t * 1.6) * 0.012; // drawn larger than life so it can be seen
    c.fillStyle = C.person; c.beginPath(); c.ellipse(PX([13.3, 0.33 + br])[0], PX([13.3, 0.33 + br])[1], 0.62 * s, (0.17 + br) * s, 0, 0, 6.2832); c.fill();
    c.beginPath(); c.arc(PX([12.5, 0.32])[0], PX([12.5, 0.32])[1], 0.16 * s, 0, 6.2832); c.fill();
    c.fillRect(PX([13.9, 0.34])[0], PX([13.9, 0.34])[1], 0.7 * s, 0.13 * s);
    c.fillStyle = C.line; c.fillRect(gx0, gy - 0.5, gx1 - gx0, 1.5);
    // rays: straight from drone to rover, and by way of the chest
    c.lineWidth = 1.5; c.strokeStyle = rgba(C.accent, 0.95); c.beginPath(); c.moveTo(T[0], T[1]); c.lineTo(R[0], R[1]); c.stroke();
    const k = Math.min(1, p.a / A0 + 0.25);
    c.strokeStyle = rgba(C.person, 0.35 + 0.6 * k); c.setLineDash([6, 4]); c.lineDashOffset = reducedMotion() ? 0 : -t * 22; c.beginPath(); c.moveTo(T[0], T[1]); c.lineTo(P[0], P[1]); c.lineTo(R[0], R[1]); c.stroke(); c.setLineDash([]); c.lineDashOffset = 0;
    // rover
    c.fillStyle = C.text2; c.beginPath(); c.roundRect(R[0] - 0.55 * s, R[1] - 0.12 * s, 1.1 * s, 0.32 * s, 3); c.fill();
    c.fillStyle = C.bg0; for (const dx of [-0.36, 0.36]) { c.beginPath(); c.arc(R[0] + dx * s, gy - 0.2 * s, 0.2 * s, 0, 6.2832); c.fill(); c.strokeStyle = C.text2; c.lineWidth = 1.5; c.stroke(); }
    c.strokeStyle = C.text2; c.beginPath(); c.moveTo(R[0], R[1] - 0.1 * s); c.lineTo(R[0], R[1] - 0.75 * s); c.stroke(); c.beginPath(); c.arc(R[0], R[1] - 0.75 * s, 2.5, 0, 6.2832); c.fillStyle = C.accent; c.fill();
    lab(c, 'rover listens', R[0], gy + 34, C.text2);
    // drone
    c.strokeStyle = C.text; c.lineWidth = 2; c.beginPath(); c.moveTo(T[0] - 0.75 * s, T[1] - 0.12 * s); c.lineTo(T[0] + 0.75 * s, T[1] - 0.12 * s); c.stroke();
    c.fillStyle = C.text; c.beginPath(); c.roundRect(T[0] - 0.28 * s, T[1] - 0.2 * s, 0.56 * s, 0.34 * s, 3); c.fill();
    const spin = reducedMotion() ? 0.8 : 0.45 + 0.55 * Math.abs(Math.sin(t * 30));
    for (const dx of [-0.75, 0.75]) { c.fillStyle = rgba(C.text, 0.4); c.beginPath(); c.ellipse(T[0] + dx * s, T[1] - 0.22 * s, 0.5 * s * spin, 2, 0, 0, 6.2832); c.fill(); c.fillStyle = C.text; c.fillRect(T[0] + dx * s - 1, T[1] - 0.22 * s, 2, 0.12 * s); }
    c.beginPath(); c.arc(T[0], T[1] + 0.2 * s, 2.5, 0, 6.2832); c.fillStyle = C.accent; c.fill();
    lab(c, 'drone transmits', T[0], T[1] - 0.2 * s - 22, C.text);
    // the pass and its hover points
    const ly = PX([0, tx[1]])[1] + 0.9 * s; c.strokeStyle = rgba(C.text, 0.16); c.setLineDash([2, 5]); c.beginPath(); c.moveTo(PX([STOPS[0], 0])[0], ly); c.lineTo(PX([STOPS[7], 0])[0], ly); c.stroke(); c.setLineDash([]);
    STOPS.forEach((x, i) => { const v = visits[i], px = PX([x, 0])[0]; c.beginPath(); c.arc(px, ly, 4, 0, 6.2832); if (v == null) { c.strokeStyle = rgba(C.text, 0.4); c.lineWidth = 1; c.stroke(); } else { c.fillStyle = v > NOISE51 * 2 ? C.ok : C.text3; c.fill(); } });
    // labels with leader lines, kept off the subject
    lab(c, 'straight path', (T[0] * 0.45 + R[0] * 0.55), (T[1] * 0.45 + R[1] * 0.55) - 14, C.accent);
    lab(c, 'echo off the chest: ' + p.excess.toFixed(2) + ' m longer', Math.min((T[0] + P[0]) / 2 - 10, w - 150), (T[1] + P[1]) / 2 - 4, C.person, 'right');
    const [vx, vy] = PX([9.6, -1.25]); c.strokeStyle = rgba(C.text, 0.4); c.lineWidth = 1; c.beginPath(); c.moveTo(vx + 40, vy - 9); c.lineTo(PX([12.6, 0.2])[0], PX([12.6, 0.2])[1]); c.stroke(); lab(c, 'person lying still in a void', vx, vy, C.person);
    const eTop = PX([cx, cy])[1] - Math.sqrt(Math.max(0, ((p.dLos + p.excess) / 2) ** 2 - half * half)) * s;
    if (eTop > 30) lab(c, 'same echo length anywhere on this line (zone ' + p.zone + ')', clamp(PX([cx, cy])[0], 170, w - 170), Math.max(14, eTop - 12), rgba(C.accent, 0.95));
  }
  function lab(c, str, x, y, color, align = 'center') { c.font = '500 11px ' + C.font; const tw = c.measureText(str).width, x0 = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x; c.fillStyle = rgba(C.bg0, 0.78); c.beginPath(); c.roundRect(x0 - 5, y - 9, tw + 10, 18, 4); c.fill(); text(c, str, x0, y + 0.5, { base: 'middle', color, weight: 500 }); }

  // ----- the chest, magnified -----
  let insetImg = null;
  function drawInset() {
    const { c, w, h: H } = inset; if (!w) return; c.clearRect(0, 0, w, H);
    const p = physics(), span = 0.3, sc = w / span, cw = Math.ceil(w / 3), chh = Math.ceil(H / 3);
    if (!insetImg || insetImg.width !== cw || insetImg.height !== chh) { insetImg = document.createElement('canvas'); insetImg.width = cw; insetImg.height = chh; }
    const ic = insetImg.getContext('2d'), img = ic.createImageData(cw, chh), A = [...C.lut.slice(4 * 40, 4 * 40 + 3)], B = [...C.lut.slice(4 * 96, 4 * 96 + 3)];
    for (let j = 0; j < chh; j++) for (let i = 0; i < cw; i++) {
      const q = [CHEST[0] + ((i + 0.5) / cw - 0.5) * span, CHEST[1] - ((j + 0.5) / chh - 0.5) * (H / sc)], ex = dist(tx, q) + dist(q, RX) - p.dLos;
      const z = ex / (p.lam / 2), f = z - Math.floor(z), odd = Math.floor(z) & 1, edge = Math.min(f, 1 - f), m = clamp(edge / 0.06, 0, 1), u = odd ? 0.5 + 0.5 * m : 0.5 - 0.5 * m, o = (j * cw + i) * 4;
      for (let k = 0; k < 3; k++) img.data[o + k] = A[k] + (B[k] - A[k]) * u; img.data[o + 3] = 255;
    }
    ic.putImageData(img, 0, 0); c.imageSmoothingEnabled = true; c.drawImage(insetImg, 0, 0, w, H);
    // the chest surface, breathing: 5 mm of travel, drawn to scale
    const y0 = H / 2 - Math.sin(t * 1.6) * (CHEST_PP / 2) * sc;
    c.beginPath(); c.moveTo(0, y0 + 26); c.quadraticCurveTo(w / 2, y0 - 26, w, y0 + 26); c.lineTo(w, H); c.lineTo(0, H); c.closePath(); c.fillStyle = rgba(C.bg0, 0.72); c.fill();
    c.beginPath(); c.moveTo(0, y0 + 26); c.quadraticCurveTo(w / 2, y0 - 26, w, y0 + 26); c.strokeStyle = C.person; c.lineWidth = 4; c.stroke();
    c.strokeStyle = C.bg0; c.lineWidth = 2; c.beginPath(); c.arc(w / 2, y0, 5, 0, 6.2832); c.fillStyle = C.text; c.fill(); c.stroke();
    text(c, 'the chest, rising and falling 5 mm', w / 2, Math.min(H - 10, y0 + 40), { align: 'center', color: C.person, weight: 600 });
    const mid = Math.abs(p.frac - 0.5) < 0.25;
    lab(c, mid ? 'mid-zone: every breath counts' : 'on a zone edge: blind', w / 2, 18, mid ? C.ok : C.warn);
  }

  // ----- what the rover receives -----
  function drawScope() {
    const { c, w, h: H } = scope; if (!w) return; c.clearRect(0, 0, w, H);
    const pl = 48, pr = 10, pt = 8, pb = 22, pw = w - pl - pr, ph = H - pt - pb, R = 0.3, Y = (v) => pt + ph / 2 - (clamp(v, -R, R) / R) * (ph / 2 - 2);
    c.fillStyle = C.bg1; c.fillRect(pl, pt, pw, ph);
    c.fillStyle = rgba(C.text3, 0.16); c.fillRect(pl, Y(NOISE51), pw, Y(-NOISE51) - Y(NOISE51));
    for (const v of [-0.2, 0, 0.2]) { c.fillStyle = rgba(C.text, 0.08); c.fillRect(pl, Math.round(Y(v)), pw, 1); text(c, (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + ' %', pl - 6, Y(v) + 4, { align: 'right', color: C.text3, mono: true }); }
    c.beginPath(); const n = trace.length; for (let i = 0; i < n; i++) { const v = trace[(tracePos + i) % n], x = pl + (i / (n - 1)) * pw, y = Y(v); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    const p = physics(); c.strokeStyle = p.depth > NOISE51 * 2 ? C.person : C.text2; c.lineWidth = 1.4; c.stroke();
    text(c, 'grey band: noise left after averaging 51 subcarriers', pl, H - 6, { color: C.text3 });
  }

  // ----- along the pass -----
  function drawSweep() {
    const { c, w, h: H } = sweep; if (!w) return; c.clearRect(0, 0, w, H);
    const pl = 54, pr = 14, pt = 12, pb = 30, pw = w - pl - pr, ph = H - pt - pb, x0 = 2.5, x1 = 21.5, X = (x) => pl + ((x - x0) / (x1 - x0)) * pw;
    let ymax = 0.1; const env = []; for (let i = 0; i <= pw; i += 2) { const x = x0 + (i / pw) * (x1 - x0), q = physics([x, tx[1]]); env.push([i, q.best]); ymax = Math.max(ymax, q.best * 1.15); }
    ymax = Math.min(0.6, ymax); const Y = (v) => pt + ph - (Math.min(v, ymax) / ymax) * ph;
    c.fillStyle = C.bg1; c.fillRect(pl, pt, pw, ph);
    // the fringes are a few centimetres wide: at this scale they merge into a band between zero and the best case
    c.beginPath(); c.moveTo(pl, pt + ph); for (const [i, b] of env) c.lineTo(pl + i, Y(b)); c.lineTo(pl + pw, pt + ph); c.closePath(); c.fillStyle = rgba(C.person, 0.16); c.fill();
    c.save(); c.clip(); c.strokeStyle = rgba(C.person, 0.22); c.lineWidth = 1; c.beginPath(); for (let x = pl; x < pl + pw; x += 3) { c.moveTo(x, pt); c.lineTo(x, pt + ph); } c.stroke(); c.restore();
    c.beginPath(); env.forEach(([i, b], k) => (k ? c.lineTo(pl + i, Y(b)) : c.moveTo(pl + i, Y(b)))); c.strokeStyle = C.person; c.lineWidth = 1.6; c.stroke();
    for (const [v, str] of [[NOISE51, 'noise after averaging 51 subcarriers (assumed independent)'], [NOISE1, 'noise on one subcarrier, 0.5 %']]) { if (v > ymax) continue; c.strokeStyle = C.text2; c.setLineDash([4, 3]); c.lineWidth = 1; c.beginPath(); c.moveTo(pl, Y(v)); c.lineTo(pl + pw, Y(v)); c.stroke(); c.setLineDash([]); text(c, str, pl + pw - 6, Y(v) - 5, { align: 'right', color: C.text2 }); }
    for (const v of [0, ymax / 2, ymax]) text(c, v.toFixed(2) + ' %', pl - 6, Y(v) + 4, { align: 'right', color: C.text3, mono: true });
    for (let x = 4; x <= 20; x += 2) text(c, String(x), X(x), pt + ph + 14, { align: 'center', color: C.text3, mono: true });
    text(c, 'drone position along the pile, m', pl + pw / 2, H - 4, { align: 'center', color: C.text3 });
    text(c, 'breathing swing: anywhere from zero up to this line', pl + 8, pt + 13, { color: C.person });
    STOPS.forEach((x, i) => { const v = visits[i]; if (v == null) return; const seen = v > NOISE51 * 2; c.beginPath(); c.arc(X(x), Y(v), 5, 0, 6.2832); c.fillStyle = seen ? C.ok : C.bg3; c.fill(); c.strokeStyle = seen ? C.bg0 : C.text2; c.lineWidth = 1.5; c.stroke(); text(c, seen ? 'seen' : 'blind', X(x), Y(v) - 9, { align: 'center', color: seen ? C.ok : C.text2, weight: 600 }); });
    const p = physics(), px = X(tx[0]); c.fillStyle = C.text; c.fillRect(Math.round(px), pt, 1, ph); c.beginPath(); c.arc(px, Y(p.depth), 4, 0, 6.2832); c.fillStyle = C.text; c.fill();
    const done = visits.filter((v) => v != null), seen = done.filter((v) => v > NOISE51 * 2).length;
    const sum = done.length ? 'seen at ' + seen + ' of ' + done.length + ' hover points' : ''; if (sumEl.textContent !== sum) { sumEl.textContent = sum; sumEl.hidden = !sum; }
  }

  // ----- motion -----
  function tick(ts) {
    raf = 0; const dt = Math.min(0.05, (ts - lastT) / 1000 || 0.016); lastT = ts; t += dt;
    if (pass) {
      const target = STOPS[pass.i], d = target - tx[0];
      if (Math.abs(d) > 0.02) tx[0] += Math.sign(d) * Math.min(Math.abs(d), dt * (reducedMotion() ? 40 : 4.5));
      else { tx[0] = target; pass.hold += dt; if (pass.hold > 2.6) { visits[pass.i] = physics().depth; pass.i++; pass.hold = 0; if (pass.i >= STOPS.length) stopPass(); } }
      sX.set(tx[0]); renderStats();
    }
    // the received signal: its slow swing with breathing plus noise, at 30 samples a second
    traceAcc += dt; const p = physics();
    while (traceAcc > 1 / 30) { traceAcc -= 1 / 30; const tt = t - traceAcc, v = 100 * p.a * (Math.cos(p.phi + (p.dPhi / 2) * Math.sin(tt * 1.6)) - Math.cos(p.phi)) + NOISE51 * gauss(rng); trace[tracePos] = v; tracePos = (tracePos + 1) % trace.length; }
    draw(); drawInset(); drawScope(); drawSweep();
    if (shown) raf = requestAnimationFrame(tick);
  }
  function startPass() { visits = []; pass = { i: 0, hold: 0 }; passBtn.textContent = 'Stop the pass'; passBtn.classList.remove('btn-primary'); changed(); }
  function stopPass() { if (!pass) return; pass = null; passBtn.textContent = 'Fly the pass: eight hover points'; passBtn.classList.add('btn-primary'); }

  const at = (e) => { const r = scene.canvas.getBoundingClientRect(); return [VIEW[0] + (e.clientX - r.left - tf.ox) / tf.s, VIEW[3] - (e.clientY - r.top - tf.oy) / tf.s]; };
  scene.canvas.addEventListener('pointerdown', (e) => { if (dist(at(e), tx) < 1.6) { drag = true; stopPass(); scene.canvas.setPointerCapture(e.pointerId); scene.canvas.style.cursor = 'grabbing'; } });
  scene.canvas.addEventListener('pointermove', (e) => { const q = at(e); if (drag) { const y = clamp(q[1], 5, 14); if (Math.abs(y - tx[1]) > 0.05) visits = []; tx = [clamp(q[0], 2.5, 21.5), y]; sX.set(tx[0]); sY.set(tx[1]); changed(); } else scene.canvas.style.cursor = dist(q, tx) < 1.6 ? 'grab' : 'default'; });
  scene.canvas.addEventListener('pointerup', () => { drag = false; scene.canvas.style.cursor = 'default'; });
  scene.canvas.addEventListener('keydown', (e) => { const d = { ArrowLeft: [-0.03, 0], ArrowRight: [0.03, 0], ArrowUp: [0, 0.5], ArrowDown: [0, -0.5] }[e.key]; if (!d) return; e.preventDefault(); stopPass(); if (d[1]) visits = []; tx = [clamp(tx[0] + d[0] * (e.shiftKey ? 10 : 1), 2.5, 21.5), clamp(tx[1] + d[1], 5, 14)]; sX.set(tx[0]); sY.set(tx[1]); changed(); });

  renderStats();
  let first = true;
  return {
    show() { shown = true; lastT = performance.now(); if (!raf) raf = requestAnimationFrame(tick); if (first) { first = false; setTimeout(() => { if (shown && !pass && !visits.length) startPass(); }, 1200); } },
    hide() { shown = false; cancelAnimationFrame(raf); raf = 0; stopPass(); },
    repaint() { draw(); drawInset(); drawScope(); drawSweep(); },
    debug: () => ({ physics: physics(), visits, tx }),
  };
}
