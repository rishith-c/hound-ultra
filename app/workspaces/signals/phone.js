// Phone finder: a concept, with a live algorithm. No phone-finding radio is built. The received strengths are
// simulated with a path-loss model on building B; the solver that turns them into a position is real and runs here.
//
// Signal model (all numbers assumed):  strength = P0 - 10 n log10(d) - walls + noise
//   P0 = -40 dBm at 1 m (the solver does NOT know it: phones differ, so it carries P0 as an unknown, -40 +/- 6 dB)
//   n = 2.2, drywall 3 dB, concrete 10 dB, below -92 dBm the phone is not heard.
// Solver: Bayes on a 0.5 m grid with the unknown P0 integrated out analytically (the likelihood surface), then a
// weighted nonlinear least-squares fit (Levenberg-Marquardt on x, y and P0) started at the surface's peak.
import { segIntersect, mulberry32, dist } from '../../core/geometry.js';
import { C, surface, slider, intro, text, rgba, clamp, gauss } from './util.js';

const VIEW = [40, 22, 88, 66], RES = 0.5, GW = 96, GH = 88;
const M = { p0: -40, n: 2.2, drywall: 3, concrete: 10, floor: -92, tau: 6 };
const ROUTE = [[64, 27.5], [64, 36], [64, 44], [57.6, 44], [50, 44], [70.6, 44], [70.6, 38.4], [57.6, 50], [48.6, 37]];
const cellPt = (k) => [VIEW[0] + ((k % GW) + 0.5) * RES, VIEW[1] + (Math.floor(k / GW) + 0.5) * RES];
const logPhi = (z) => -Math.log1p(Math.exp(-1.702 * z)); // log of the normal CDF, logistic approximation

export function create(root, ctx) {
  const { h, realityTag, fmt, reducedMotion } = ctx.kit, world = ctx.world;
  const WALLS = world.WALLS.filter((w) => w.state !== 'collapsed');
  const wallLoss = (p, q) => { let s = 0; for (const w of WALLS) if (segIntersect(p, q, w.a, w.b)) s += w.mat === 'concrete' ? M.concrete : M.drywall; return s; };
  const shape = (p, q, walls) => -10 * M.n * Math.log10(Math.max(1, dist(p, q))) - (walls ? wallLoss(p, q) : 0);
  const shapeGrid = (pos, walls) => { const g = new Float32Array(GW * GH); for (let k = 0; k < g.length; k++) g[k] = shape(cellPt(k), pos, walls); return g; };

  // ----- the solver -----
  // readings: [{ pos, rssi | null (not heard), S: grid with walls, S0: grid without }]
  function solve(readings, sigma, knowWalls) {
    const n = GW * GH, post = new Float32Array(n), heard = readings.filter((r) => r.rssi != null), miss = readings.filter((r) => r.rssi == null);
    const kk = heard.length + (sigma * sigma) / (M.tau * M.tau); let best = -Infinity, bi = 0;
    for (let c = 0; c < n; c++) {
      let se = 0, see = 0;
      for (const r of heard) { const e = r.rssi - M.p0 - (knowWalls ? r.S : r.S0)[c]; se += e; see += e * e; }
      const dh = heard.length ? se / kk : 0; let ll = -(see - (se * se) / kk) / (2 * sigma * sigma);
      for (const r of miss) ll += logPhi((M.floor - (M.p0 + dh + (knowWalls ? r.S : r.S0)[c])) / sigma);
      post[c] = ll; if (ll > best) { best = ll; bi = c; }
    }
    let sum = 0; for (let c = 0; c < n; c++) { post[c] = Math.exp(post[c] - best); sum += post[c]; }
    for (let c = 0; c < n; c++) post[c] /= sum;
    // weighted nonlinear least squares from the peak
    let v = [...cellPt(bi), 0];
    if (heard.length) {
      const res = (u) => { const o = heard.map((r) => (r.rssi - M.p0 - u[2] - shape([u[0], u[1]], r.pos, knowWalls)) / sigma); o.push(u[2] / M.tau); return o; };
      const cost = (r) => r.reduce((a, b) => a + b * b, 0);
      let r0 = res(v), c0 = cost(r0), lam = 1; const hs = [0.15, 0.15, 0.1], start = v.slice();
      for (let it = 0; it < 14; it++) {
        const J = hs.map((hh, j) => { const u = v.slice(); u[j] += hh; const r1 = res(u); return r1.map((x, i) => (x - r0[i]) / hh); });
        const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0];
        for (let a = 0; a < 3; a++) { for (let b = 0; b < 3; b++) for (let i = 0; i < r0.length; i++) A[a][b] += J[a][i] * J[b][i]; for (let i = 0; i < r0.length; i++) g[a] -= J[a][i] * r0[i]; }
        for (let a = 0; a < 3; a++) A[a][a] = A[a][a] * (1 + lam) + 1e-6;
        const dv = solve3(A, g); if (!dv) break;
        const u = [clamp(v[0] + dv[0], VIEW[0], VIEW[2]), clamp(v[1] + dv[1], VIEW[1], VIEW[3]), v[2] + dv[2]], r1 = res(u), c1 = cost(r1);
        if (c1 < c0) { v = u; r0 = r1; if (c0 - c1 < 1e-5) break; c0 = c1; lam /= 3; } else lam *= 4;
      }
      if (dist(v, start) > 3) v = [start[0], start[1], 0]; // left the peak's basin (a wall edge): keep the grid answer
    }
    return { post, est: [v[0], v[1]], dP0: v[2], mapIdx: bi };
  }
  function solve3(A, b) {
    const m = A.map((r, i) => [...r, b[i]]);
    for (let i = 0; i < 3; i++) {
      let p = i; for (let j = i + 1; j < 3; j++) if (Math.abs(m[j][i]) > Math.abs(m[p][i])) p = j;
      if (Math.abs(m[p][i]) < 1e-12) return null; [m[i], m[p]] = [m[p], m[i]];
      for (let j = i + 1; j < 3; j++) { const f = m[j][i] / m[i][i]; for (let k = i; k < 4; k++) m[j][k] -= f * m[i][k]; }
    }
    const x = [0, 0, 0]; for (let i = 2; i >= 0; i--) { let s = m[i][3]; for (let k = i + 1; k < 3; k++) s -= m[i][k] * x[k]; x[i] = s / m[i][i]; }
    return x;
  }
  function region(post, frac = 0.9) { // the smallest set of cells holding 90 % of the probability
    const s = Float32Array.from(post).sort().reverse(); let acc = 0, i = 0; while (i < s.length && acc < frac) acc += s[i++];
    return { level: s[Math.max(0, i - 1)], area: i * RES * RES };
  }

  // ----- state -----
  const rng = mulberry32(34); // of seeds 1 to 40 this is the median run for the opening phone: 4.0 m off after nine positions (range 1.2 to 22 m)
  let phone = [79.4, 35.2], sigma = 4, knowWalls = true, readings = [], sol = null, reg = null, disp = new Float32Array(GW * GH), shown = false, raf = 0;
  let drive = null, pulse = 0, drag = false, hover = null, rover = null, mc = null, mcRun = 0;
  const heat = document.createElement('canvas'); heat.width = GW; heat.height = GH; const heatCtx = heat.getContext('2d'), heatImg = heatCtx.createImageData(GW, GH);

  function measure(r) { const mu = M.p0 + shape(phone, r.pos, true) + sigma * r.z; r.rssi = mu < M.floor ? null : mu; }
  function addReading(pos) { const r = { pos: pos.slice(), z: gauss(rng), S: shapeGrid(pos, true), S0: shapeGrid(pos, false) }; measure(r); readings.push(r); pulse = 1; recompute(); }
  function recompute() {
    if (readings.length) { sol = solve(readings, sigma, knowWalls); reg = region(sol.post); } else { sol = null; reg = null; }
    renderSide(); kick();
  }

  // ----- layout -----
  const map = surface('signals-canvas', () => draw());
  map.canvas.tabIndex = 0; map.canvas.setAttribute('role', 'application');
  map.canvas.setAttribute('aria-label', 'Plan of building B with the likelihood surface for the phone. Click to listen from a spot; drag the phone to move it. Arrow keys move the phone; Enter adds the next listening position.');
  const sNoise = slider({ label: 'Signal noise (shadowing)', min: 1, max: 8, step: 0.5, value: sigma, format: (v) => '±' + v.toFixed(1) + ' dB', hint: 'How much each reading wanders from the model. 4 dB is typical indoors; this value is assumed.', onInput: (v) => { sigma = v; readings.forEach(measure); recompute(); drawChart(); } });
  const wallsChk = h('input', { type: 'checkbox', checked: true, onchange: () => { knowWalls = wallsChk.checked; recompute(); } });
  const driveBtn = h('button.btn.btn-primary', { type: 'button', onclick: () => startDrive() }, 'Drive the corridor and listen');
  const nextBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => { stopDrive(); const p = ROUTE[readings.length % ROUTE.length]; rover = p.slice(); addReading(p); } }, 'Add one position');
  const undoBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => { stopDrive(); readings.pop(); rover = readings.length ? readings[readings.length - 1].pos.slice() : null; recompute(); } }, 'Remove last');
  const clearBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => { stopDrive(); readings = []; rover = null; recompute(); } }, 'Clear');
  const moveBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => { const rooms = world.ROOMS.filter((r) => !r.corridor), r = rooms[Math.floor(rng() * rooms.length)].rect; setPhone([r[0] + 1.5 + rng() * (r[2] - r[0] - 3), r[1] + 1.5 + rng() * (r[3] - r[1] - 3)]); } }, 'Hide the phone somewhere else');
  const rail = h('section.panel.signals-rail', { 'aria-label': 'Phone finder' }, h('div.panel-body', null,
    intro(realityTag('concept'), 'A phone in a pocket keeps calling out for Wi-Fi and Bluetooth. The rover cannot read what it says, but it can measure how loud it is from several spots, and since loudness falls with distance and walls, the readings can be solved for a position.', realityTag('live-algo')),
    h('div.signals-group', null, driveBtn, h('div.signals-btnrow', null, nextBtn, undoBtn, clearBtn), h('p.signals-hint', null, 'Or click the plan to listen from that spot. Drag the phone to move it.')),
    h('div.signals-group', null, sNoise.el, h('label.check', { title: 'Turn this off and the solver assumes open air. A map of the walls, such as the one from the drone scan, is what makes the answer land in the right room.' }, wallsChk, 'Solver knows the floor plan'), moveBtn),
    h('div.note', { style: { marginTop: 'auto' } }, h('span', null, h('b', null, 'Privacy. '), 'Only signal strength is used: no message, name or content is read. A phone’s radio address can still point to a person, so real use would need permission and clear rules about what is kept.')),
    h('p.signals-hint', null, 'Concept. Strengths come from a path-loss model with design values (−40 dBm at 1 m, exponent 2.2, 3 dB per partition, 10 dB per concrete wall).')));
  const mapPanel = h('section.panel', { 'aria-label': 'Likelihood surface' }, h('header.panel-head', null, h('h3', null, 'Where the phone could be, given every reading so far'), realityTag('sim')), h('div.signals-fill', null, map.canvas),
    h('div.signals-legend', null, h('span', null, h('i', { style: { background: 'var(--sim)' } }), 'the phone (simulated truth, hidden from the solver)'), h('span', null, h('i', { style: { background: 'var(--accent)' } }), 'where the rover listened'), h('span', null, h('i', { style: { background: 'var(--warn)' } }), 'least-squares estimate'), h('span', null, h('i.ln', { style: { background: 'var(--text)' } }), '90 % of the probability is inside this line')));
  const stErr = h('b', null, '–'), stArea = h('b', null, '–'), stN = h('b', null, '0'), stP0 = h('b', null, '–'), verdict = h('p.signals-verdict', null, '');
  const estPanel = h('section.panel', { 'aria-label': 'Estimate' }, h('header.panel-head', null, h('h3', null, 'Estimate')), h('div.panel-body', { style: { flex: 'none' } },
    h('div.signals-stats', null, h('div.stat', null, stErr, h('span', null, 'error, known only because this is a simulation')), h('div.stat', null, stArea, h('span', null, 'area that holds 90 % of the probability')), h('div.stat', null, stN, h('span', null, 'listening positions that heard it')), h('div.stat', null, stP0, h('span', null, 'phone loudness at 1 m, solved (true: −40)'))),
    h('div', { style: { marginTop: '12px' } }, verdict)));
  const tbody = h('tbody');
  const readPanel = h('section.panel', { 'aria-label': 'Readings', style: { flex: '1 1 120px' } }, h('header.panel-head', null, h('h3', null, 'What the rover measured')), h('div.panel-body.flush', null, h('table.table.signals-readings', null, h('thead', null, h('tr', null, h('th', null, 'Position'), h('th', null, 'Strength'), h('th', { title: 'Distance this strength would mean in open air with a typical phone' }, 'Alone it says'))), tbody)));
  const chart = surface('signals-canvas', () => drawChart());
  chart.canvas.setAttribute('role', 'img'); chart.canvas.setAttribute('aria-label', 'Median position error against number of listening positions, for three noise levels');
  const chartPanel = h('section.panel', { 'aria-label': 'Error against positions', style: { flex: '0 0 250px' } }, h('header.panel-head', null, h('h3', { title: 'Median error of the same solver on simulated phones placed at random in the building. Noise sets the floor.' }, 'Measured: more positions, less error')), h('div.signals-fill', null, chart.canvas));
  root.append(rail, mapPanel, h('div.signals-col', null, estPanel, readPanel, chartPanel));

  function renderSide() {
    const heard = readings.filter((r) => r.rssi != null).length;
    stN.replaceChildren(String(heard), h('small', null, 'of ' + readings.length));
    if (!sol) { stErr.textContent = '–'; stArea.textContent = '–'; stP0.textContent = '–'; verdict.textContent = 'No readings yet. The phone could be anywhere in the block.'; }
    else {
      const err = dist(sol.est, phone), room = world.roomAt(sol.est), truthRoom = world.roomAt(phone);
      stErr.replaceChildren(err.toFixed(1), h('small', null, 'm')); stArea.replaceChildren(reg.area.toFixed(0), h('small', null, 'm²')); stP0.replaceChildren((M.p0 + sol.dP0).toFixed(0), h('small', null, 'dBm'));
      const where = room ? room.name : 'outside the building';
      verdict.replaceChildren(heard < 3 ? h('span', null, heard + ' reading' + (heard === 1 ? '' : 's') + ': ' + (heard <= 1 ? 'one strength fits a wide ring of places, and a louder phone further away fits too.' : 'two strengths narrow it to a band. A third position pins it.'))
        : h('span', null, 'Best fit: ', h('b', null, where), room && truthRoom && room.id === truthRoom.id ? ', the right room.' : truthRoom ? '. The phone is really in ' + truthRoom.name.toLowerCase().replace('classroom', 'room') + ': ' + (knowWalls ? 'more positions or less noise are needed.' : 'without the floor plan the walls pull the answer off.') : '.'));
    }
    tbody.replaceChildren(...(readings.length ? readings.map((r, i) => h('tr', null, h('td', null, h('span.num', null, String(i + 1)), '  ', h('span.dim', null, world.roomAt(r.pos)?.name.replace('Classroom ', 'Room ').replace('Science lab ', 'Lab ') || 'Outside')),
      h('td', null, r.rssi == null ? h('span.dim', null, 'not heard') : [h('i.signals-rssi', { style: '--v:' + clamp((r.rssi + 95) / 60, 0, 1) }), h('span.num', null, r.rssi.toFixed(0) + ' dBm')]),
      h('td.num', null, r.rssi == null ? '–' : '≈ ' + Math.pow(10, (M.p0 - r.rssi) / (10 * M.n)).toFixed(0) + ' m')))
      : [h('tr', null, h('td.dim', { colSpan: 3, style: { textAlign: 'left', padding: '14px 12px' } }, 'Nothing measured yet. Press “Drive the corridor and listen”.'))]));
    undoBtn.disabled = clearBtn.disabled = !readings.length;
  }

  // ----- drawing -----
  let tf = { s: 1, ox: 0, oy: 0 };
  const PX = (p) => [tf.ox + (p[0] - VIEW[0]) * tf.s, tf.oy + (VIEW[3] - p[1]) * tf.s];
  const toWorld = (x, y) => [VIEW[0] + (x - tf.ox) / tf.s, VIEW[3] - (y - tf.oy) / tf.s];
  function draw() {
    const { c, w, h: H } = map; if (!w) return;
    const s = Math.min((w - 16) / (VIEW[2] - VIEW[0]), (H - 16) / (VIEW[3] - VIEW[1])); tf = { s, ox: (w - (VIEW[2] - VIEW[0]) * s) / 2, oy: (H - (VIEW[3] - VIEW[1]) * s) / 2 };
    c.clearRect(0, 0, w, H);
    const [x0, y0] = PX([VIEW[0], VIEW[3]]), mw = (VIEW[2] - VIEW[0]) * s, mh = (VIEW[3] - VIEW[1]) * s;
    c.fillStyle = C.bg1; c.fillRect(x0, y0, mw, mh);
    // metre grid
    c.fillStyle = rgba(C.text, 0.035); for (let x = VIEW[0] + 2; x < VIEW[2]; x += 2) c.fillRect(Math.round(PX([x, 0])[0]), y0, 1, mh); for (let y = VIEW[1] + 2; y < VIEW[3]; y += 2) c.fillRect(x0, Math.round(PX([0, y])[1]), mw, 1);
    // the surface
    if (sol) {
      let mx = 0; for (let k = 0; k < disp.length; k++) if (disp[k] > mx) mx = disp[k];
      const px = heatImg.data, lut = C.lut;
      for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { const v = Math.sqrt(disp[j * GW + i] / (mx + 1e-30)), q = Math.round(clamp(v, 0, 1) * 255) * 4, o = ((GH - 1 - j) * GW + i) * 4; px[o] = lut[q]; px[o + 1] = lut[q + 1]; px[o + 2] = lut[q + 2]; px[o + 3] = Math.round(Math.min(1, v * 1.6) * 235); }
      heatCtx.putImageData(heatImg, 0, 0); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(heat, x0, y0, mw, mh);
    }
    // rooms and walls
    for (const r of world.ROOMS) { const [a, b] = PX([(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2]); if (!r.corridor) text(c, r.id, a, b + 4, { align: 'center', color: rgba(C.text, 0.32), size: 12, mono: true }); }
    for (const o of world.OBSTACLES) { if (o.kind !== 'rubble' || o.poly[0][0] > VIEW[2]) continue; c.beginPath(); o.poly.forEach((p, i) => { const [x, y] = PX(p); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); c.fillStyle = rgba(C.text3, 0.22); c.fill(); c.strokeStyle = rgba(C.text3, 0.6); c.lineWidth = 1; c.setLineDash([2, 3]); c.stroke(); c.setLineDash([]); }
    c.lineCap = 'round';
    for (const wl of world.WALLS) { const [ax, ay] = PX(wl.a), [bx, by] = PX(wl.b); c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.strokeStyle = wl.state === 'collapsed' ? rgba(C.text3, 0.7) : wl.mat === 'concrete' ? C.text : rgba(C.text2, 0.9); c.lineWidth = wl.mat === 'concrete' ? 3 : 1.6; c.setLineDash(wl.state === 'collapsed' ? [3, 5] : []); c.stroke(); }
    c.setLineDash([]); c.lineCap = 'butt';
    text(c, 'Building B, ground floor', PX([44, 58])[0], PX([44, 58])[1] - 8, { color: C.text3 });
    text(c, 'collapsed', PX([84.6, 59.4])[0], PX([84.6, 59.4])[1], { color: C.text3, align: 'right' });
    // 90 % line
    if (sol && reg) { c.strokeStyle = rgba(C.text, 0.75); c.lineWidth = 1; c.beginPath(); contour(sol.post, reg.level, c); c.stroke(); }
    // what each reading alone would say: a ring at the open-air distance for a typical phone
    readings.forEach((r, i) => { if (r.rssi == null) return; const d = Math.pow(10, (M.p0 - r.rssi) / (10 * M.n)), [x, y] = PX(r.pos); c.beginPath(); c.arc(x, y, d * s, 0, 6.2832); c.strokeStyle = rgba(C.accent, i === readings.length - 1 ? 0.5 : 0.13); c.lineWidth = 1; c.setLineDash([4, 5]); c.stroke(); c.setLineDash([]); });
    // rover track and listening positions
    if (readings.length > 1) { c.beginPath(); readings.forEach((r, i) => { const [x, y] = PX(r.pos); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.strokeStyle = rgba(C.accent, 0.5); c.lineWidth = 1.5; c.setLineDash([1, 5]); c.lineCap = 'round'; c.stroke(); c.setLineDash([]); c.lineCap = 'butt'; }
    readings.forEach((r, i) => { const [x, y] = PX(r.pos), last = i === readings.length - 1;
      if (last && pulse > 0) { c.beginPath(); c.arc(x, y, 9 + (1 - pulse) * 26, 0, 6.2832); c.strokeStyle = rgba(C.accent, pulse * 0.8); c.lineWidth = 2; c.stroke(); }
      c.beginPath(); c.arc(x, y, 9, 0, 6.2832); c.fillStyle = r.rssi == null ? C.bg3 : C.accent; c.fill(); c.strokeStyle = r.rssi == null ? C.accent : C.bg0; c.lineWidth = 1.5; c.stroke();
      text(c, String(i + 1), x, y + 0.5, { align: 'center', base: 'middle', color: r.rssi == null ? C.accent : C.bg0, size: 11, weight: 700, mono: true }); });
    if (rover && drive) { const [x, y] = PX(rover); c.beginPath(); c.arc(x, y, 6, 0, 6.2832); c.fillStyle = C.text; c.fill(); c.strokeStyle = C.accent; c.lineWidth = 2; c.stroke(); }
    if (hover && !drag) { const [x, y] = PX(hover); c.beginPath(); c.arc(x, y, 9, 0, 6.2832); c.strokeStyle = rgba(C.accent, 0.9); c.setLineDash([3, 3]); c.lineWidth = 1.5; c.stroke(); c.setLineDash([]); text(c, 'listen here', x + 14, y + 4, { color: C.accent }); }
    // estimate, truth, and the gap between them
    const [tx, ty] = PX(phone);
    if (sol && readings.some((r) => r.rssi != null)) {
      const [ex, ey] = PX(sol.est); c.strokeStyle = rgba(C.text, 0.55); c.lineWidth = 1; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(ex, ey); c.lineTo(tx, ty); c.stroke(); c.setLineDash([]);
      c.strokeStyle = C.bg0; c.lineWidth = 4; c.beginPath(); c.moveTo(ex - 11, ey); c.lineTo(ex + 11, ey); c.moveTo(ex, ey - 11); c.lineTo(ex, ey + 11); c.stroke();
      c.strokeStyle = C.warn; c.lineWidth = 2; c.beginPath(); c.moveTo(ex - 11, ey); c.lineTo(ex + 11, ey); c.moveTo(ex, ey - 11); c.lineTo(ex, ey + 11); c.stroke(); c.beginPath(); c.arc(ex, ey, 6, 0, 6.2832); c.stroke();
      const e = dist(sol.est, phone); if (e * s > 46) labelAt(c, e.toFixed(1) + ' m off', (ex + tx) / 2, (ey + ty) / 2, C.text);
      labelAt(c, 'estimate', ex, ey - 20, C.warn);
    }
    c.fillStyle = C.bg0; c.beginPath(); c.roundRect(tx - 7, ty - 11, 14, 22, 3.5); c.fill(); c.strokeStyle = C.sim; c.lineWidth = 2; c.stroke(); c.fillStyle = C.sim; c.fillRect(tx - 2.5, ty + 5.5, 5, 1.6);
    labelAt(c, drag ? 'phone ' + fmt.pos(phone) : 'phone', tx, ty + 22, C.sim);
    // scale bar
    const sb = PX([VIEW[2] - 12, VIEW[1] + 2]); c.fillStyle = C.text2; c.fillRect(sb[0], sb[1], 10 * s, 1.5); c.fillRect(sb[0], sb[1] - 3, 1.5, 6); c.fillRect(sb[0] + 10 * s - 1.5, sb[1] - 3, 1.5, 6); text(c, '10 m', sb[0] + 5 * s, sb[1] - 7, { align: 'center', color: C.text2, mono: true });
    if (!readings.length) labelAt(c, 'No readings yet: the phone could be anywhere. Press “Drive the corridor and listen”.', x0 + mw / 2, y0 + 22, C.text2);
  }
  function labelAt(c, str, x, y, color) { c.font = '600 11px ' + C.font; const tw = c.measureText(str).width; c.fillStyle = rgba(C.bg0, 0.8); c.beginPath(); c.roundRect(x - tw / 2 - 5, y - 9, tw + 10, 18, 4); c.fill(); text(c, str, x, y + 0.5, { align: 'center', base: 'middle', color, weight: 600 }); }
  function contour(g, level, c) { // marching squares over cell centres
    const P = (i, j) => PX([VIEW[0] + (i + 0.5) * RES, VIEW[1] + (j + 0.5) * RES]);
    for (let j = 0; j < GH - 1; j++) for (let i = 0; i < GW - 1; i++) {
      const a = g[j * GW + i], b = g[j * GW + i + 1], d = g[(j + 1) * GW + i], e = g[(j + 1) * GW + i + 1];
      const idx = (a >= level) | ((b >= level) << 1) | ((e >= level) << 2) | ((d >= level) << 3); if (idx === 0 || idx === 15) continue;
      const f = (u, v) => clamp((level - u) / (v - u + 1e-30), 0, 1);
      const pts = { B: [i + f(a, b), j], R: [i + 1, j + f(b, e)], T: [i + f(d, e), j + 1], L: [i, j + f(a, d)] };
      const segs = { 1: ['L', 'B'], 2: ['B', 'R'], 3: ['L', 'R'], 4: ['R', 'T'], 5: ['L', 'T', 'B', 'R'], 6: ['B', 'T'], 7: ['L', 'T'], 8: ['L', 'T'], 9: ['B', 'T'], 10: ['L', 'B', 'R', 'T'], 11: ['R', 'T'], 12: ['L', 'R'], 13: ['B', 'R'], 14: ['L', 'B'] }[idx];
      for (let q = 0; q < segs.length; q += 2) { const p1 = P(...pts[segs[q]]), p2 = P(...pts[segs[q + 1]]); c.moveTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); }
    }
  }

  // ----- measured: error against number of positions -----
  const MC = { sig: [2, 4, 8], trials: 160 };
  let mcNext = null, mcTimer = 0; // the measurement waits while the area is hidden
  function mcGo() { clearTimeout(mcTimer); if (mcNext) mcTimer = setTimeout(mcNext, 30); }
  function runMC() {
    const my = ++mcRun, grids = ROUTE.map((p) => ({ pos: p, S: shapeGrid(p, true), S0: shapeGrid(p, false) })), r2 = mulberry32(99);
    const series = [...MC.sig.map((s) => ({ sigma: s, walls: true, errs: ROUTE.map(() => []) })), { sigma: 4, walls: false, errs: ROUTE.map(() => []) }];
    mc = { series, done: 0, total: MC.trials }; let t = 0;
    const step = () => {
      if (my !== mcRun) return;
      const t1 = performance.now();
      while (t < MC.trials && performance.now() - t1 < 14) {
        const ph = [45 + r2() * 38, 31 + r2() * 26], z = ROUTE.map(() => gauss(r2));
        for (const se of series) { const rs = [];
          for (let k = 0; k < ROUTE.length; k++) { const mu = M.p0 + shape(ph, ROUTE[k], true) + se.sigma * z[k]; rs.push({ pos: ROUTE[k], rssi: mu < M.floor ? null : mu, S: grids[k].S, S0: grids[k].S0 }); se.errs[k].push(dist(solve(rs, se.sigma, se.walls).est, ph)); } }
        t++;
      }
      mc.done = t; drawChart();
      mcNext = t < MC.trials ? step : null; if (shown) mcGo();
    };
    step();
  }
  const q = (a, f) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : 0; };
  function drawChart() {
    const { c, w, h: H } = chart; if (!w) return; c.clearRect(0, 0, w, H);
    const pl = 34, pr = 92, pt = 14, pb = 34, pw = w - pl - pr, ph = H - pt - pb, nx = ROUTE.length;
    const X = (k) => pl + ((k - 1) / (nx - 1)) * pw, ymax = 16, Y = (v) => pt + ph - (Math.min(v, ymax) / ymax) * ph;
    for (const v of [0, 4, 8, 12, 16]) { c.fillStyle = rgba(C.text, 0.07); c.fillRect(pl, Math.round(Y(v)), pw, 1); text(c, String(v), pl - 6, Y(v) + 4, { align: 'right', color: C.text3, mono: true }); }
    for (let k = 1; k <= nx; k++) text(c, String(k), X(k), pt + ph + 14, { align: 'center', color: C.text3, mono: true });
    text(c, 'listening positions', pl + pw / 2, H - 5, { align: 'center', color: C.text3 });
    c.save(); c.translate(10, pt + ph / 2); c.rotate(-Math.PI / 2); text(c, 'median error, m', 0, 0, { align: 'center', color: C.text3 }); c.restore();
    if (!mc || !mc.done) { text(c, 'Measuring on simulated phones…', pl + pw / 2, pt + ph / 2, { align: 'center', color: C.text3 }); return; }
    const labels = [];
    mc.series.forEach((se) => {
      const near = se.walls && se.sigma === MC.sig.reduce((a, b) => (Math.abs(b - sigma) < Math.abs(a - sigma) ? b : a)) && knowWalls, cur = (!se.walls && !knowWalls) || near;
      c.beginPath(); se.errs.forEach((e, k) => { const y = Y(q(e, 0.5)); k ? c.lineTo(X(k + 1), y) : c.moveTo(X(k + 1), y); });
      c.strokeStyle = se.walls ? rgba(C.accent, cur ? 1 : 0.45) : rgba(C.text2, cur ? 1 : 0.6); c.lineWidth = cur ? 2.2 : 1.4; c.setLineDash(se.walls ? [] : [4, 3]); c.stroke(); c.setLineDash([]);
      labels.push({ y: Y(q(se.errs[nx - 1], 0.5)), str: se.walls ? '±' + se.sigma + ' dB noise' : 'no floor plan', color: se.walls ? (cur ? C.accent : rgba(C.accent, 0.7)) : C.text2 });
    });
    labels.sort((a, b) => a.y - b.y); for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    for (const l of labels) text(c, l.str, pl + pw + 6, l.y + 4, { color: l.color });
    if (sol && readings.length && readings.length <= nx) { const e = dist(sol.est, phone), x = X(readings.length), y = Y(e); c.beginPath(); c.arc(x, y, 4.5, 0, 6.2832); c.fillStyle = C.warn; c.fill(); c.strokeStyle = C.bg2; c.lineWidth = 1.5; c.stroke(); text(c, 'now', x, y - 9, { align: 'center', color: C.warn, weight: 600 }); }
    if (mc.done < mc.total) text(c, mc.done + ' of ' + mc.total + ' phones', pl + pw, pt + 10, { align: 'right', color: C.text3 });
    else text(c, mc.total + ' simulated phones per point', pl + pw, pt + 10, { align: 'right', color: C.text3 });
  }

  // ----- motion -----
  function kick() { if (shown && !raf) raf = requestAnimationFrame(tick); if (!shown) { if (sol) disp.set(sol.post); } }
  let lastT = 0;
  function tick(ts) {
    raf = 0; const dt = Math.min(0.05, (ts - lastT) / 1000 || 0.016); lastT = ts; let busy = false;
    const slow = reducedMotion();
    if (sol) { let diff = 0; const a = slow ? 1 : 1 - Math.exp(-dt * 9); for (let k = 0; k < disp.length; k++) { const d = sol.post[k] - disp[k]; disp[k] += d * a; if (Math.abs(d) > diff) diff = Math.abs(d); } if (diff > 2e-5 && !slow) busy = true; else disp.set(sol.post); }
    if (pulse > 0) { pulse = slow ? 0 : Math.max(0, pulse - dt * 1.8); busy = busy || pulse > 0; }
    if (drive) {
      busy = true; const target = ROUTE[drive.i];
      if (!rover || slow) rover = target.slice();
      const d = dist(rover, target), stepLen = 26 * dt;
      if (d <= stepLen) { rover = target.slice(); drive.wait += dt; if (drive.wait > (slow ? 0.5 : 0.28)) { addReading(target); drive.i++; drive.wait = 0; if (drive.i >= ROUTE.length) stopDrive(); } }
      else { rover[0] += ((target[0] - rover[0]) / d) * stepLen; rover[1] += ((target[1] - rover[1]) / d) * stepLen; }
    }
    draw(); drawChart();
    if (busy && shown) raf = requestAnimationFrame(tick);
  }
  function startDrive() { readings = []; rover = null; sol = null; reg = null; drive = { i: 0, wait: 0 }; driveBtn.textContent = 'Driving…'; driveBtn.disabled = true; renderSide(); kick(); }
  function stopDrive() { if (!drive) return; drive = null; driveBtn.textContent = 'Drive the corridor and listen'; driveBtn.disabled = false; }
  function setPhone(p) { phone = [clamp(p[0], VIEW[0] + 1, VIEW[2] - 1), clamp(p[1], VIEW[1] + 1, VIEW[3] - 1)]; readings.forEach(measure); recompute(); }

  // ----- pointer and keys -----
  const at = (e) => { const r = map.canvas.getBoundingClientRect(); return toWorld(e.clientX - r.left, e.clientY - r.top); };
  const inView = (p) => p[0] > VIEW[0] && p[0] < VIEW[2] && p[1] > VIEW[1] && p[1] < VIEW[3];
  const free = (p) => { const g = ctx.sim.grid; if (!g) return true; const [i, j] = g.toCell(p); return !g.blocked[j * g.w + i]; };
  map.canvas.addEventListener('pointerdown', (e) => { const p = at(e); if (dist(p, phone) * tf.s < 18) { drag = true; map.canvas.setPointerCapture(e.pointerId); map.canvas.style.cursor = 'grabbing'; } });
  map.canvas.addEventListener('pointermove', (e) => { const p = at(e);
    if (drag) { setPhone(p); return; }
    const onPhone = dist(p, phone) * tf.s < 18, ok = inView(p) && free(p) && !drive;
    map.canvas.style.cursor = onPhone ? 'grab' : ok ? 'crosshair' : 'default'; hover = !onPhone && ok ? p : null; kick(); });
  map.canvas.addEventListener('pointerup', (e) => { if (drag) { drag = false; map.canvas.style.cursor = 'grab'; kick(); return; } const p = at(e); if (inView(p) && free(p) && !drive && dist(p, phone) * tf.s >= 18) { rover = p; addReading(p); } });
  map.canvas.addEventListener('pointerleave', () => { hover = null; kick(); });
  map.canvas.addEventListener('keydown', (e) => { const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key]; if (d) { e.preventDefault(); setPhone([phone[0] + d[0], phone[1] + d[1]]); } else if (e.key === 'Enter') { e.preventDefault(); nextBtn.click(); } });

  renderSide();
  let first = true;
  return {
    show() { shown = true; if (first) { first = false; setTimeout(() => { if (shown && !readings.length && !drive) startDrive(); }, 500); runMC(); } mcGo(); kick(); },
    hide() { shown = false; clearTimeout(mcTimer); cancelAnimationFrame(raf); raf = 0; if (drive) { stopDrive(); } },
    repaint() { draw(); drawChart(); },
    debug: () => ({ readings, sol, phone, mc }),
  };
}
