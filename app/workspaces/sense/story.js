// Why this network: the five AI design decisions, each as one row of an evidence ledger.
// Every number on this view is computed here from data/eval_scores.json, the loaded weights (ctx.nn) and
// core/fusion.js, or is quoted from docs/FACTS.md (those are collected in QUOTED below). Every window is simulated.
import { loadEval, wilson } from './common.js';
import { fuse, PRIOR, THRESHOLDS } from '../../core/fusion.js';

// Quoted from docs/FACTS.md. Nothing else on this view is typed in by hand.
const QUOTED = {
  frameworkMB: 700,            // "PyTorch is a 700 MB install"
  trainSeconds: 23,            // "Training takes 23 s on a laptop CPU"
  laptopMs: 1.1, laptopNetMs: 0.1, // "One reading on a laptop 1.1 ms (window + network); 0.1 ms for the network alone"
  breathing: [0.05, 0.4],      // "Breathing changes the signal by about 0.05 to 0.4 %"
  noise: 0.5,                  // "the ESP32's own noise is about 0.5 % per bin"
  falseAlarmLimit: 0.1,        // "at most 10 % of empty rooms raise an alarm"
};
const BYTES_PER_WEIGHT = 4;    // the weights are 32-bit floats
const RUNS = 5;                // timing passes over the bundled windows

const NS = 'http://www.w3.org/2000/svg';
const NB = ' ';
const nf = (n) => n.toLocaleString('en-US');
const pc = (f, d = 1) => (100 * f).toFixed(d) + NB + '%';
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (v) => Math.round(v * 10) / 10;
const count = (w) => (Array.isArray(w) ? w.reduce((s, x) => s + count(x), 0) : 1);

// ---- everything the view shows, computed once -------------------------------------------------------------------
function digest(ev, nn) {
  const T = ev.test, C = ev.clean, V = ev.val, thr = ev.threshold, n = T.kind.length;
  // Scores are stored to 4 decimals, so a window that sits on the threshold is ambiguous in the file. The export
  // script checked the full-precision answers against the published table (ev.published.confusion), so a tie is
  // resolved the way that reproduces it.
  const confOf = (tieUp) => { const c = [0, 0, 0, 0]; for (let i = 0; i < n; i++) c[T.person[i] * 2 + (T.person_score[i] > thr || (tieUp && Math.abs(T.person_score[i] - thr) < 5e-5) ? 1 : 0)]++; return c; };
  const want = ev.published?.confusion?.join();
  const tieUp = confOf(false).join() !== want && confOf(true).join() === want;
  const said = T.person_score.map((s) => s > thr || (tieUp && Math.abs(s - thr) < 5e-5));
  const saidClean = C.person_score.map((s) => s > C.threshold);
  const idx = (f) => { const o = []; for (let i = 0; i < n; i++) if (f(i)) o.push(i); return o; };
  const empty = idx((i) => T.kind[i] === 0), still = idx((i) => T.kind[i] === 1), moving = idx((i) => T.kind[i] === 2), people = idx((i) => T.kind[i] > 0);
  const hits = (ix, a) => ix.reduce((s, i) => s + (a[i] ? 1 : 0), 0);
  const rank = (ix, scores, flags) => { const o = ix.map((i) => ({ s: scores[i], up: flags[i] })).sort((a, b) => a.s - b.s || a.up - b.up); return { s: o.map((d) => d.s), up: o.filter((d) => d.up).length, n: o.length }; };
  const movRight = (m) => people.reduce((s, i) => s + (((m.moving_score[i] > 0.5) ? 1 : 0) === T.moving[i] ? 1 : 0), 0);

  // validation, where the threshold was chosen
  const val = []; for (let i = 0; i < V.person.length; i++) if (V.person[i] === 0) val.push({ s: V.person_score[i], fan: V.fan[i] === 1 });
  val.sort((a, b) => a.s - b.s);
  const valUp = val.filter((d) => d.s > thr).length;

  // who is in the test set
  const groups = new Map();
  for (let i = 0; i < n; i++) { let g = groups.get(T.group[i]); if (!g) groups.set(T.group[i], g = { id: T.group[i], n: 0, still: 0, moving: 0, empty: 0, fan: false, depth: T.depth[i], lying: T.lying[i] === 1 }); g.n++; g[['empty', 'still', 'moving'][T.kind[i]]]++; if (T.fan[i] === 1) g.fan = true; }
  const all = [...groups.values()];
  const persons = all.filter((g) => g.still + g.moving > 0).sort((a, b) => b.moving - a.moving || a.id - b.id);
  const rooms = all.filter((g) => g.still + g.moving === 0).sort((a, b) => (b.fan - a.fan) || a.id - b.id);

  // the network itself, from the weights loaded in this page
  const w = nn.weights, pair = (i) => count(w[i]) + count(w[i + 1]);
  const layers = [
    { name: 'Convolution 1', params: pair(0), units: w[1].length, unit: 'filters' },
    { name: 'Convolution 2', params: pair(2), units: w[3].length, unit: 'filters' },
    { name: 'Convolution 3', params: pair(4), units: w[5].length, unit: 'filters' },
    { name: 'Dense', params: pair(6), units: w[7].length, unit: 'units' },
    { name: 'Two heads', params: pair(8) + pair(10), units: w[9].length + w[11].length, unit: 'outputs' },
  ];
  const params = layers.reduce((s, l) => s + l.params, 0), bytes = params * BYTES_PER_WEIGHT;

  const emptyFan = empty.filter((i) => T.fan[i] === 1), emptyNoFan = empty.filter((i) => T.fan[i] !== 1);
  return {
    thr, cleanThr: C.threshold, n, windows: ev.windows,
    nEmpty: empty.length, nPeople: people.length,
    messy: rank(empty, T.person_score, said), clean: rank(empty, C.person_score, saidClean),
    foundMessy: hits(people, said), foundClean: hits(people, saidClean),
    movMessy: movRight(T), movClean: movRight(C),
    still: { k: hits(still, said), n: still.length }, moving: { k: hits(moving, said), n: moving.length },
    val, valUp,
    rates: [
      { label: 'Validation', k: valUp, n: val.length, note: 'chosen here' },
      { label: 'Test', k: hits(empty, said), n: empty.length, note: 'checked here' },
      { label: 'Test, fan on', k: hits(emptyFan, said), n: emptyFan.length },
      { label: 'Test, no fan', k: hits(emptyNoFan, said), n: emptyNoFan.length },
    ],
    persons, rooms, fanRooms: rooms.filter((g) => g.fan).length,
    layers, params, bytes, ratio: QUOTED.frameworkMB * 1e6 / bytes,
    pPos: fuse([{ sensor: 'csi', result: 'pos' }]).p, pNeg: fuse([{ sensor: 'csi', result: 'neg' }]).p,
  };
}

// ---- small SVG pen ------------------------------------------------------------------------------------------------
function pen(svg) {
  svg.replaceChildren();
  return (tag, at, text, parent = svg) => {
    const e = document.createElementNS(NS, tag);
    if (at) for (const k in at) if (at[k] != null) e.setAttribute(k, at[k]);
    if (text != null) e.textContent = text;
    parent.append(e); return e;
  };
}
const k = (name) => 'sense-why-' + name;
const f2 = (v) => Math.round(v * 100) / 100;
const stepArea = (s, i0, i1, X, Y, y0) => { if (i1 <= i0) return ''; let d = 'M' + f2(X(i0)) + ',' + y0; for (let i = i0; i < i1; i++) d += 'V' + f2(Y(s[i])) + 'H' + f2(X(i + 1)); return d + 'V' + y0 + 'Z'; };

// ---- the figures. Each is draw(add, w, h) into an svg of that size ------------------------------------------------

// 1a. The network to scale, layer by layer, and the same weights against a 700 MB install.
function drawNet(D) {
  return (add, w, h) => {
    const W = w - 1, barY = 30, barH = Math.max(14, Math.min(22, h * 0.17)), big = h - 30, bigH = 8;
    let x = 0;
    D.layers.forEach((l, i) => {
      const sw = l.params / D.params * W, g = add('g');
      add('title', null, l.name + ': ' + nf(l.params) + ' parameters, ' + l.units + ' ' + l.unit, g);
      add('rect', { x: f2(x), y: barY, width: f2(Math.max(1, sw - 1)), height: barH, class: k(i === 4 ? 'f-ink' : i === 3 ? 'f-mid' : 'f-net') }, null, g);
      const step = sw / l.units; // one stripe per filter or unit, when there is room to draw them
      if (step >= 3) for (let u = 1; u < l.units; u++) add('line', { x1: f2(x + u * step), x2: f2(x + u * step), y1: barY, y2: barY + barH, class: k('s-bg') }, null, g);
      if (i < 3) { add('text', { x: f2(x), y: 10, class: k('lb') }, sw < 84 ? l.name.replace('Convolution', 'Conv.') : l.name); add('text', { x: f2(x), y: 23, class: k('lb-n') }, nf(l.params)); }
      else if (i === 3) { add('text', { x: W, y: 10, 'text-anchor': 'end', class: k('lb') }, l.name); add('text', { x: W, y: 23, 'text-anchor': 'end', class: k('lb-n') }, nf(l.params)); }
      else { add('text', { x: W, y: barY + barH + 13, 'text-anchor': 'end', class: k('lb') }, l.name + ', ' + nf(l.params)); add('line', { x1: W - 1, x2: W - 1, y1: barY + barH, y2: barY + barH + 4, class: k('s-line2') }); }
      x += sw;
    });
    // the wedge says "the bar above is this sliver, magnified"
    add('path', { d: 'M0,' + (barY + barH + 1) + 'H' + W + 'L1.5,' + (big - 1) + 'H0Z', class: k('wedge') });
    add('rect', { x: 0, y: big, width: W, height: bigH, class: k('f-frame') });
    add('rect', { x: 0, y: big - 2, width: 1.5, height: bigH + 4, class: k('f-ink') });
    add('text', { x: W, y: big - 5, 'text-anchor': 'end', class: k('lb') }, 'PyTorch install, ' + QUOTED.frameworkMB + ' MB');
    const px = W / D.ratio;
    add('text', { x: 0, y: h - 5, class: k('ax') }, 'This network, ' + Math.round(D.bytes / 1000) + ' kB: ' + px.toFixed(2) + ' px wide at this scale, drawn 1.5 px');
  };
}

// 1b. One reading, timed in this browser. One dot per bundled window.
function drawSpeed(D, S) {
  return (add, w, h) => {
    const top = 40, axisY = h - 30, W = w - 6;
    if (!S.per) { add('text', { x: 0, y: 16, class: k('lb') }, S.busy ? 'Timing ' + S.nWin + ' windows, ' + RUNS + ' runs each…' : 'Not measured yet.'); return; }
    const max = Math.max(QUOTED.laptopNetMs * 6, Math.max(...S.per) * 1.12);
    const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].find((s) => max / s <= 6) || 200;
    const X = (v) => 2 + v / max * (W - 2);
    add('text', { x: 0, y: 11, class: k('lb') }, 'One dot per bundled window,');
    add('text', { x: 0, y: 24, class: k('lb') }, 'the median of ' + RUNS + ' runs');
    add('line', { x1: 0, x2: w, y1: axisY, y2: axisY, class: k('s-line2') });
    for (let v = 0; v <= max + 1e-9; v += step) { const x = X(v); add('line', { x1: f2(x), x2: f2(x), y1: axisY, y2: axisY + 3, class: k('s-line2') }); if (x < w - 84) add('text', { x: f2(x), y: axisY + 14, 'text-anchor': v === 0 ? 'start' : 'middle', class: k('ax') }, v === 0 ? '0' : (step < 1 ? v.toFixed(1) : String(Math.round(v)))); }
    add('text', { x: w, y: axisY + 14, 'text-anchor': 'end', class: k('ax') }, 'milliseconds');
    // FACTS reference, like for like: the same network in NumPy on a laptop, network alone
    const xr = X(QUOTED.laptopNetMs);
    add('path', { d: 'M' + f2(xr) + ',' + (axisY - 1) + 'l-3.5,-6h7z', class: k('f-ink') });
    add('line', { x1: f2(xr), x2: f2(xr), y1: axisY + 3, y2: h - 11, class: k('s-line2') });
    add('text', { x: f2(xr + 5), y: h - 2, class: k('ax') }, 'NumPy on a laptop, network alone: ' + QUOTED.laptopNetMs + ' ms');
    // dots, stacked where they would overlap
    const mid = (top + axisY - 8) / 2 + 2, half = Math.max(0, Math.floor((axisY - 10 - top) / 2 / 5.5)), placed = [];
    S.per.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v).forEach(({ v, i }) => {
      const x = X(v); let lvl = 0;
      for (let n = 0; n <= half * 2; n++) { const l = n === 0 ? 0 : (n % 2 ? 1 : -1) * Math.ceil(n / 2); if (!placed.some((p) => p.l === l && Math.abs(p.x - x) < 5.4)) { lvl = l; break; } lvl = l; }
      placed.push({ x, l: lvl });
      const c = add('circle', { cx: f2(x), cy: f2(mid + lvl * 5.5), r: 2.3, class: k('dot') }); add('title', null, 'Window ' + (i + 1) + ' (' + S.cats[i] + '): ' + v.toFixed(2) + ' ms', c);
    });
    const xm = X(S.ms), left = xm > 60;
    add('line', { x1: f2(xm), x2: f2(xm), y1: top - 6, y2: axisY, class: k('s-ink') });
    add('text', { x: f2(left ? xm - 5 : xm + 5), y: top, 'text-anchor': left ? 'end' : 'start', class: k('val') }, 'median');
  };
}

// 2a. Empty rooms, sorted by score, under each network's own threshold.
function drawEmptyPair(D) {
  return (add, w, h) => {
    const padL = 26, gap = 20, pw = (w - padL - gap - 1) / 2, top = 18, y0 = h - 37, Y = (v) => y0 - v * (y0 - top);
    add('text', { transform: 'translate(9,' + f2((top + y0) / 2) + ') rotate(-90)', 'text-anchor': 'middle', class: k('ax') }, 'Person score');
    [['Trained clean, threshold ', D.clean, D.cleanThr], ['Trained messy, threshold ', D.messy, D.thr]].forEach(([name, R, thr], p) => {
      const x0 = padL + p * (pw + gap), X = (i) => x0 + i / R.n * pw, cut = R.n - R.up, xc = X(cut);
      add('text', { x: f2(x0), y: 10, class: k('lb') }, name).append(Object.assign(document.createElementNS(NS, 'tspan'), { textContent: thr.toFixed(2) }));
      add('line', { x1: f2(x0), x2: f2(x0 + pw), y1: f2(Y(1)), y2: f2(Y(1)), class: k('s-grid') });
      [0, 1].forEach((v) => add('text', { x: f2(x0 - 4), y: f2(Y(v) + (v ? 8 : 0)), 'text-anchor': 'end', class: k('ax') }, v));
      add('path', { d: stepArea(R.s, 0, cut, X, Y, y0), class: k('f-ok') });
      add('path', { d: stepArea(R.s, cut, R.n, X, Y, y0), class: k('f-danger') });
      add('line', { x1: f2(x0), x2: f2(x0 + pw), y1: y0, y2: y0, class: k('s-line2') });
      add('line', { x1: f2(x0), x2: f2(x0 + pw), y1: f2(Y(thr)), y2: f2(Y(thr)), class: k('s-thr') });
      // brackets under the axis: which rooms are right, which are false alarms
      const by = y0 + 4, upW = x0 + pw - xc, wide = upW > 96;
      if (cut > 0) add('path', { d: 'M' + f2(x0 + 0.5) + ',' + by + 'v3H' + f2(xc - 1.5) + 'v-3', class: k('s-ok') });
      add('path', { d: 'M' + f2(xc + 1.5) + ',' + by + 'v3H' + f2(x0 + pw - 0.5) + 'v-3', class: k('s-danger') });
      add('text', { x: f2(wide ? xc + upW / 2 : x0 + pw), y: by + 15, 'text-anchor': wide ? 'middle' : 'end', class: k('t-danger') }, R.up + ' false alarms');
      add('text', { x: f2(wide ? x0 : Math.min((x0 + xc) / 2, x0 + pw - 140)), y: by + 15, 'text-anchor': wide ? 'start' : 'middle', class: k('t-ok') }, cut + ' right');
    });
    add('text', { x: padL, y: h - 2, class: k('ax') }, 'The ' + D.nEmpty + ' empty test rooms, sorted by score. Dashed: the threshold.');
  };
}

// 2b. Still or moving: share of right answers, with a 95 % interval.
function drawStillMoving(D) {
  return (add, w, h) => {
    const W = w - 2, X = (v) => v * W, axisY = h - 30, rowH = (axisY - 2) / 2, bh = Math.max(8, Math.min(12, rowH - 22));
    [['Trained clean', D.movClean, 'danger'], ['Trained messy', D.movMessy, 'ok']].forEach(([name, kk, tone], i) => {
      const y = i * rowH + 16, p = kk / D.nPeople, [lo, hi] = wilson(kk, D.nPeople), g = add('g');
      add('title', null, name + ': ' + kk + ' of ' + D.nPeople + ' right, ' + pc(p) + ' (95 % interval ' + pc(lo) + ' to ' + pc(hi) + ')', g);
      add('text', { x: 0, y: y - 5, class: k('lb') }, name, g);
      add('text', { x: W, y: y - 5, 'text-anchor': 'end', class: k('val') }, pc(p), g);
      add('rect', { x: 0, y, width: W, height: bh, class: k('f-track') }, null, g);
      add('rect', { x: 0, y, width: f2(X(p)), height: bh, class: k('f-' + tone) }, null, g);
      add('line', { x1: f2(X(lo)), x2: f2(X(hi)), y1: y + bh / 2, y2: y + bh / 2, class: k('s-ink') }, null, g);
    });
    add('line', { x1: f2(X(0.5)), x2: f2(X(0.5)), y1: 10, y2: axisY + 3, class: k('s-thr') });
    add('line', { x1: 0, x2: W, y1: axisY, y2: axisY, class: k('s-line2') });
    [0, 0.5, 1].forEach((v) => add('text', { x: f2(X(v)), y: axisY + 14, 'text-anchor': v === 0 ? 'start' : v === 1 ? 'end' : 'middle', class: k(v === 0.5 ? 'lb' : 'ax') }, v === 0.5 ? 'coin toss, 50 %' : Math.round(v * 100) + ' %'));
    add('text', { x: 0, y: h - 2, class: k('ax') }, 'Right on the ' + D.nPeople + ' windows with a person');
  };
}

// 3. The three sets to scale, and every simulated person and empty room in the test set.
function drawSplit(D) {
  return (pen0, w, h) => {
    let add = pen0;
    const W = w - 1, sets = [['Training', D.windows.train], ['Validation', D.windows.val], ['Test', D.windows.test]], total = sets.reduce((s, d) => s + d[1], 0);
    const barY = 15, barH = 9; let x = 0, testX = 0;
    sets.forEach(([name, n], i) => {
      const sw = n / total * W;
      add('rect', { x: f2(x), y: barY, width: f2(sw - (i < 2 ? 2 : 0)), height: barH, class: k(i === 2 ? 'f-ink' : 'f-net') });
      add('text', { x: f2(x), y: 10, class: k('lb') }, name + ' ').append(Object.assign(document.createElementNS(NS, 'tspan'), { textContent: nf(n) + (i === 0 ? ' windows' : '') }));
      if (i === 2) testX = x; x += sw;
    });
    const uTop = barY + barH + 14, uBot = h - 19, H = uBot - uTop, gapB = 26, per = 5;
    // largest cell that fits: people are columns of 5 windows, rooms are single cells
    let best = null;
    for (let c = 9; c >= 2 && !best; c--) for (let rows = 1; rows <= 4 && !best; rows++) {
      const colH = per * c + (per - 1), bh = rows * colH + (rows - 1) * 5; if (bh > H) continue;
      const pcols = Math.ceil(D.persons.length / rows), pw = pcols * (c + 2) - 2;
      const rrows = Math.max(1, Math.floor((bh + 1) / (c + 1))), rcols = Math.ceil(D.rooms.length / rrows), rw = rcols * (c + 1) - 1;
      if (pw + gapB + rw <= W) best = { c, rows, colH, bh, pcols, pw, rrows, rw };
    }
    if (!best) return;
    const { c, rows, colH, bh, pcols, pw, rrows, rw } = best, oy = uTop + Math.max(0, (H - bh) / 2), rx = pw + gapB;
    add('path', { d: 'M' + f2(testX) + ',' + (barY + barH + 1) + 'H' + W + 'L' + f2(rx + rw) + ',' + f2(oy - 4) + 'H0Z', class: k('wedge') });
    const gp = add('g');
    D.persons.forEach((p, i) => {
      const col = i % pcols, row = Math.floor(i / pcols), px = col * (c + 2), py = oy + row * (colH + 5), g = add('g', null, null, gp);
      add('title', null, 'Simulated person ' + p.id + ': ' + p.moving + ' moving and ' + p.still + ' still windows, ' + (p.lying ? 'lying' : 'standing') + ' ' + p.depth.toFixed(2) + ' m behind the wall', g);
      for (let j = 0; j < p.n; j++) add('rect', { x: px, y: f2(py + j * (c + 1)), width: c, height: c, class: k(j < p.moving ? 'f-person' : 'f-person-still') }, null, g);
    });
    D.rooms.forEach((r, i) => { const col = Math.floor(i / rrows), row = i % rrows, e = add('rect', { x: rx + col * (c + 1), y: f2(oy + row * (c + 1)), width: c, height: c, class: k(r.fan ? 'f-room-fan' : 'f-room') }); add('title', null, 'Empty room ' + r.id + (r.fan ? ', fan running' : '') + ': 1 window', e); });
    const ly = h - 4, sw = 7; let lx = 0;
    const word = (t, cls) => { const e = add('text', { x: lx, y: ly, class: k(cls || 'lb') }, t); lx += e.getComputedTextLength() + 6; };
    const swatch = (cls) => { add('rect', { x: lx, y: ly - sw, width: sw, height: sw, class: k(cls) }); lx += sw + 4; };
    word(D.persons.length + ' simulated people, ' + per + ' windows each:'); swatch('f-person'); word('moving'); swatch('f-person-still'); word('still');
    lx = Math.max(lx + 8, rx);
    if (lx > rx + 1) add('text', { x: W, y: ly, 'text-anchor': 'end', class: k('lb') }, D.rooms.length + ' empty rooms; the ' + D.fanRooms + ' lighter ones had a fan');
    else {
      const g0 = add('g'), keep = add; add = (t, a, x) => keep(t, a, x, g0);
      word(D.rooms.length + ' empty rooms, 1 window each:'); swatch('f-room-fan'); word(D.fanRooms + ' with a fan'); add = keep;
      if (lx - 6 > W) { g0.remove(); add('text', { x: W, y: ly, 'text-anchor': 'end', class: k('lb') }, D.rooms.length + ' empty rooms; the ' + D.fanRooms + ' lighter ones had a fan'); }
    }
  };
}

// 4a. Validation empty rooms, sorted. The threshold is where the top tenth begins.
function drawThreshold(D) {
  return (add, w, h) => {
    const padL = 38, x0 = padL, pw = w - padL - 1, top = 6, y0 = h - 36, Y = (v) => y0 - v * (y0 - top), n = D.val.length, X = (i) => x0 + i / n * pw, cut = n - D.valUp, xc = X(cut), s = D.val.map((d) => d.s);
    add('text', { transform: 'translate(9,' + f2((top + y0) / 2) + ') rotate(-90)', 'text-anchor': 'middle', class: k('ax') }, 'Person score');
    [0, 0.5, 1].forEach((v) => { add('line', { x1: x0, x2: x0 + pw, y1: f2(Y(v)), y2: f2(Y(v)), class: k('s-grid') }); add('text', { x: x0 - 5, y: f2(Y(v) + (v === 1 ? 8 : v === 0 ? 0 : 4)), 'text-anchor': 'end', class: k('ax') }, v === 0.5 ? '0.5' : v); });
    add('rect', { x: f2(xc), y: top, width: f2(x0 + pw - xc), height: y0 - top, class: k('band') });
    add('path', { d: stepArea(s, 0, cut, X, Y, y0), class: k('f-ok') });
    add('path', { d: stepArea(s, cut, n, X, Y, y0), class: k('f-danger') });
    add('line', { x1: x0, x2: x0 + pw, y1: y0, y2: y0, class: k('s-line2') });
    const ty = Y(D.thr);
    add('line', { x1: x0, x2: x0 + pw, y1: f2(ty), y2: f2(ty), class: k('s-thr') });
    add('text', { x: x0 + 4, y: f2(ty - 5), class: k('lb') }, 'threshold ' + D.thr.toFixed(4));
    add('line', { x1: f2(xc), x2: f2(xc), y1: top, y2: y0, class: k('s-danger') });
    add('text', { x: f2(xc - 6), y: top + 10, 'text-anchor': 'end', class: k('t-danger') }, D.valUp + ' of ' + n + ' score above it: ' + pc(D.valUp / n));
    add('text', { x: f2(xc - 6), y: top + 24, 'text-anchor': 'end', class: k('t-ok') }, cut + ' stay quiet');
    // rug: which of these rooms had a fan running
    D.val.forEach((d, i) => { if (d.fan) add('line', { x1: f2(X(i + 0.5)), x2: f2(X(i + 0.5)), y1: y0 + 3, y2: y0 + 8, class: k('s-rug') }); });
    add('text', { x: x0, y: y0 + 20, class: k('ax') }, 'The ' + n + ' validation empty rooms, sorted by score.');
    add('text', { x: x0, y: h - 2, class: k('ax') }, 'Marks under the axis: the ' + D.val.filter((d) => d.fan).length + ' rooms with a fan.');
  };
}

// 4b. Does the limit hold where the threshold was not chosen?
function drawRates(D) {
  return (add, w, h) => {
    const labW = 74, valW = 46, x0 = labW + valW + 10, pw = w - x0 - 3, max = 0.2, X = (v) => x0 + Math.min(v, max) / max * pw, axisY = h - 30, rowH = (axisY - 2) / D.rates.length;
    [0, 0.05, 0.1, 0.15, 0.2].forEach((v) => { const lim = v === QUOTED.falseAlarmLimit; add('line', { x1: f2(X(v)), x2: f2(X(v)), y1: 0, y2: axisY + (lim ? 3 : 0), class: k(lim ? 's-thr' : 's-grid') }); if (v !== 0.05 && v !== 0.15) add('text', { x: f2(X(v)), y: axisY + 14, 'text-anchor': v === 0 ? 'start' : v === max ? 'end' : 'middle', class: k(lim ? 'lb' : 'ax') }, lim ? 'limit, 10 %' : Math.round(v * 100) + ' %'); });
    add('line', { x1: x0, x2: x0 + pw, y1: axisY, y2: axisY, class: k('s-line2') });
    D.rates.forEach((r, i) => {
      const y = i * rowH + rowH / 2, p = r.k / r.n, [lo, hi] = wilson(r.k, r.n), g = add('g');
      add('title', null, r.label + ': ' + r.k + ' of ' + r.n + ' empty rooms, ' + pc(p) + ' (95 % interval ' + pc(lo) + ' to ' + pc(hi) + ')', g);
      add('text', { x: 0, y: f2(y + 4), class: k(i < 2 ? 'lb' : 'ax') }, r.label, g);
      add('text', { x: labW + valW, y: f2(y + 4), 'text-anchor': 'end', class: k(i < 2 ? 'val' : 'lb') }, pc(p), g);
      add('line', { x1: f2(X(lo)), x2: f2(X(hi)), y1: f2(y), y2: f2(y), class: k('s-whisk') }, null, g);
      [lo, hi].forEach((v) => add('line', { x1: f2(X(v)), x2: f2(X(v)), y1: f2(y - 3), y2: f2(y + 3), class: k('s-whisk') }, null, g));
      add('circle', { cx: f2(X(p)), cy: f2(y), r: i < 2 ? 3.8 : 3, class: k(i < 2 ? 'pt' : 'pt-mid') }, null, g);
    });
    add('text', { x: 0, y: h - 2, class: k('ax') }, 'Empty rooms that raise an alarm, with a 95 % interval');
  };
}

// 5a. Breathing against the radio's own noise, to scale.
function drawNoise(D) {
  return (add, w, h, id) => {
    const W = w - 2, max = 0.6, X = (v) => v / max * W, axisY = h - 30, rowH = (axisY - 2) / 2, bh = Math.max(10, Math.min(16, rowH - 20));
    const defs = add('defs'), pat = add('pattern', { id, width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, null, defs);
    add('rect', { width: 4, height: 4, class: k('f-noise') }, null, pat); add('line', { x1: 0, x2: 0, y1: 0, y2: 4, class: k('s-noise') }, null, pat);
    for (let v = 0; v <= max + 1e-9; v += 0.1) { add('line', { x1: f2(X(v)), x2: f2(X(v)), y1: 13, y2: axisY, class: k('s-grid') }); add('text', { x: f2(X(v)), y: axisY + 13, 'text-anchor': v < 0.01 ? 'start' : v > max - 0.01 ? 'end' : 'middle', class: k('ax') }, v < 0.01 ? '0' : v.toFixed(1) + (v > max - 0.01 ? ' %' : '')); }
    add('line', { x1: 0, x2: W, y1: axisY, y2: axisY, class: k('s-line2') });
    const y1 = 15, y2 = rowH + 15;
    add('text', { x: 0, y: y1 - 5, class: k('lb') }, 'The ESP32’s own noise, about ' + QUOTED.noise + ' % per bin');
    add('rect', { x: 0, y: y1, width: f2(X(QUOTED.noise)), height: bh, fill: 'url(#' + id + ')' });
    add('line', { x1: f2(X(QUOTED.noise)), x2: f2(X(QUOTED.noise)), y1: y1 - 2, y2: y1 + bh + 2, class: k('s-ink') });
    add('text', { x: 0, y: y2 - 5, class: k('t-person') }, 'Breathing, about ' + QUOTED.breathing[0] + ' to ' + QUOTED.breathing[1] + ' %');
    add('rect', { x: f2(X(QUOTED.breathing[0])), y: y2, width: f2(X(QUOTED.breathing[1]) - X(QUOTED.breathing[0])), height: bh, class: k('f-person-still') });
    add('rect', { x: 0, y: y2, width: f2(X(QUOTED.breathing[0])), height: bh, class: k('f-person') });
    add('text', { x: f2(X(QUOTED.breathing[0]) + 5), y: y2 + bh / 2 + 4, class: k('ax-on') }, 'weakest');
    add('text', { x: f2(X(QUOTED.breathing[1]) - 5), y: y2 + bh / 2 + 4, 'text-anchor': 'end', class: k('ax-on') }, 'strongest');
    add('text', { x: 0, y: h - 2, class: k('ax') }, 'Change in the Wi-Fi signal, per cent');
  };
}

// 5b. What one Wi-Fi answer does to the chance that a person is there.
function drawFuse(D) {
  return (add, w, h) => {
    const W = w - 2, X = (p) => 1 + p * (W - 1), oy = Math.max(0, (h - 106) / 2), ty = oy + 42, th = 12, cy = ty + th / 2;
    const zones = [[0, THRESHOLDS.possible, 'z-unlikely'], [THRESHOLDS.possible, THRESHOLDS.confirmed, 'z-possible'], [THRESHOLDS.confirmed, 1, 'z-confirmed']];
    zones.forEach(([a, b, cls]) => add('rect', { x: f2(X(a)), y: ty, width: f2(X(b) - X(a) - 1), height: th, class: k(cls) }));
    const xq = X(D.pNeg), xp = X(PRIOR), xs = X(D.pPos);
    // leaders and labels: the quiet answer on the top line, the PERSON answer on the second
    add('line', { x1: f2(xq), x2: f2(xq), y1: oy + 2, y2: cy, class: k('s-mid') });
    add('text', { x: f2(xq + 5), y: oy + 11, class: k('lb') }, 'Wi-Fi quiet: ').append(Object.assign(document.createElementNS(NS, 'tspan'), { textContent: pc(D.pNeg) }));
    add('line', { x1: f2(xs), x2: f2(xs), y1: oy + 17, y2: cy, class: k('s-person') });
    add('text', { x: f2(xs + 5), y: oy + 26, class: k('t-person') }, 'Wi-Fi says person: ' + pc(D.pPos));
    // the two moves away from the starting chance
    add('path', { d: 'M' + f2(xp) + ',' + (ty - 5) + 'H' + f2(xs - 6) + 'm-4,-3l5,3l-5,3', class: k('s-person') + ' ' + k('nofill') });
    add('circle', { cx: f2(xq), cy, r: 4, class: k('pt-mid') }); add('circle', { cx: f2(xs), cy, r: 4, class: k('pt-person') });
    add('circle', { cx: f2(xp), cy, r: 3.5, class: k('prior') });
    add('line', { x1: f2(xp), x2: f2(xp), y1: cy + 4, y2: ty + th + 13, class: k('s-mid') });
    add('text', { x: f2(xp + 5), y: ty + th + 17, class: k('lb') }, 'Before any reading: ').append(Object.assign(document.createElementNS(NS, 'tspan'), { textContent: pc(PRIOR, 0) }));
    const zy = ty + th + 36;
    [THRESHOLDS.possible, THRESHOLDS.confirmed].forEach((v) => add('line', { x1: f2(X(v)), x2: f2(X(v)), y1: ty + th, y2: zy - (v === THRESHOLDS.possible ? 22 : 10), class: k('s-line2') }));
    add('text', { x: f2(X(THRESHOLDS.possible) + 3), y: zy, class: k('t-warn') }, 'possible from ' + pc(THRESHOLDS.possible, 0));
    add('text', { x: W, y: zy, 'text-anchor': 'end', class: k('t-person') }, 'confirmed from ' + pc(THRESHOLDS.confirmed, 0));
    add('text', { x: 0, y: zy + 16, class: k('ax') }, 'Chance that a person is there, 0 to 100 %');
  };
}

// ---- the view -----------------------------------------------------------------------------------------------------
let uid = 0;
export async function create(el, ctx, { open }) {
  const { h, icon, reducedMotion } = ctx.kit;
  const root = h('div.sense-why');
  el.append(root);
  let D = null, visible = false, runId = 0, disposers = [];
  const S = { per: null, ms: null, busy: false, nWin: ctx.nn.samples.length, cats: ctx.nn.samples.map((s) => String(s.cat).replace(/_/g, ' ')) };
  const figs = [];
  let speedTitle = null, speedBtn = null, speedFig = null;

  function fig(title, draw, label, { action = null, grow = 1 } = {}) {
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label);
    const plot = h('div.sense-why-plot', null, svg, action);
    const cap = typeof title === 'string' ? h('figcaption.sense-figtitle', null, title) : title;
    const node = h('figure.sense-why-fig', { style: { flex: grow + ' 1 0' } }, cap, plot);
    const rec = { plot, svg, draw, id: 'sense-why-p' + (++uid), w: 0, h: 0, redraw() { if (rec.w > 40 && rec.h > 40) { svg.setAttribute('width', rec.w); svg.setAttribute('height', rec.h); svg.setAttribute('viewBox', '0 0 ' + rec.w + ' ' + rec.h); rec.draw(pen(svg), rec.w, rec.h, rec.id); } } };
    figs.push(rec); node.rec = rec;
    return node;
  }

  async function measure() {
    const my = ++runId, n = S.nWin, times = Array.from({ length: n }, () => []);
    S.busy = true; speedBtn.disabled = true; speedTitle.textContent = 'Timing one reading in this browser…'; speedFig?.rec.redraw();
    await new Promise((r) => setTimeout(r, 30));
    for (let r = 0; r < RUNS; r++) for (let i = 0; i < n; i++) {
      if (my !== runId) return;
      times[i].push(ctx.nn.inferSample(i).ms);
      if (i % 5 === 4) await new Promise((res) => setTimeout(res, 0)); // let the page breathe
    }
    if (my !== runId) return;
    S.per = times.map(median); S.ms = median(S.per); S.busy = false; speedBtn.disabled = false;
    showSpeed();
    speedFig.rec.svg.setAttribute('aria-label', 'Timing of the network on the ' + n + ' bundled windows in this browser: median ' + S.ms.toFixed(1) + ' milliseconds, from ' + Math.min(...S.per).toFixed(1) + ' to ' + Math.max(...S.per).toFixed(1) + '. For reference, NumPy on a laptop takes ' + QUOTED.laptopNetMs + ' ms for the network alone.');
    speedFig.rec.redraw();
  }
  const showSpeed = () => { if (S.per) speedTitle.replaceChildren(h('span.num', null, S.ms.toFixed(1) + ' ms'), ' a reading in this browser, measured just now'); else speedTitle.textContent = 'Not measured yet'; };
  // Leaving the view cancels a run; the last finished result (if any) stays, and the run starts again on return.
  let interrupted = false;
  const stopMeasure = () => { if (S.busy) { runId++; S.busy = false; interrupted = true; speedBtn.disabled = false; showSpeed(); speedFig.rec.redraw(); } };

  function row(i, title, body, charts, big, bigLabel, caveat, action) {
    const id = 'sense-why-d' + i;
    return h('section.sense-why-row', { 'aria-labelledby': id, style: '--i:' + i },
      h('div.sense-why-claim', null,
        h('span.sense-why-n', { 'aria-hidden': 'true' }, i),
        h('div.sense-why-text', null, h('h3', { id }, h('span.sr-only', null, 'Decision ' + i + ': '), title), h('p', null, body), action)),
      h('div.sense-why-figs', null, charts),
      h('div.sense-why-key', null,
        h('div.sense-why-big', null, big),
        h('p.sense-why-biglab', null, bigLabel),
        h('p.sense-why-caveat', null, h('b', null, icon('info', 12), 'Detail'), ' ', caveat)));
  }

  function build() {
    const st = D.still, mv = D.moving, test = D.rates[1], valR = D.rates[0];
    speedTitle = h('figcaption.sense-figtitle', { 'aria-live': 'polite' }, 'Not measured yet');
    speedBtn = h('button.btn.btn-sm.sense-why-plotbtn', { type: 'button', onclick: measure }, icon('reset', 14), 'Measure again');
    speedFig = fig(speedTitle, drawSpeed(D, S), 'Timing of the network in this browser. Not measured yet.', { action: speedBtn, grow: 1 });
    const kB = Math.round(D.bytes / 1000);

    const rows = [
      row(1, 'NumPy on the Pi, not a ' + QUOTED.frameworkMB + ' MB framework',
        'A 1-D CNN written from scratch: three convolutions, every gradient written by hand and checked against finite differences. The Pi already has NumPy. Training takes ' + QUOTED.trainSeconds + ' s on a laptop CPU.',
        [fig(kB + ' kB of weights: about 1/' + nf(Math.round(D.ratio / 100) * 100) + ' of a PyTorch install', drawNet(D),
          'The network drawn to scale by parameters per layer: ' + D.layers.map((l) => l.name + ' ' + nf(l.params)).join(', ') + '. Total ' + nf(D.params) + ' parameters, ' + kB + ' kilobytes of weights, against a ' + QUOTED.frameworkMB + ' megabyte PyTorch install.'), speedFig],
        [nf(D.params)], 'parameters, counted from the weights running in this page.',
        'A laptop takes ' + QUOTED.laptopMs + ' ms a reading, ' + QUOTED.laptopNetMs + ' ms for the network alone.'),

      row(2, 'Train on a messy simulator',
        'The simulator adds the ESP32’s own faults: gain jumps, drift, noise, lost packets, jitter. Both networks below read the same ' + nf(D.n) + ' messy test windows, so a noisy room does not fool the one we trained.',
        [fig('Trained on clean signals, ' + D.clean.up + ' of ' + D.nEmpty + ' empty rooms raise an alarm', drawEmptyPair(D),
          'Person scores of the ' + D.nEmpty + ' empty test rooms, sorted, for two networks. Trained on clean signals: ' + D.clean.up + ' score above its threshold of ' + D.cleanThr.toFixed(2) + '. Trained on messy signals: ' + D.messy.up + ' score above its threshold of ' + D.thr.toFixed(2) + '.', { grow: 1.9 }),
        fig('Still or moving: ' + pc(D.movMessy / D.nPeople) + ' with messy training', drawStillMoving(D),
          'Still or moving answered right on the ' + D.nPeople + ' windows with a person: ' + pc(D.movClean / D.nPeople) + ' trained on clean signals, ' + pc(D.movMessy / D.nPeople) + ' trained on messy signals. A coin toss is 50 %.')],
        [h('span.sense-why-from', null, pc(D.clean.up / D.nEmpty, 0)), h('span.sense-why-arrow', { 'aria-hidden': 'true' }, '→'), h('span.sr-only', null, ' down to '), pc(D.messy.up / D.nEmpty, 0)],
        'of empty rooms called a person: trained clean, then trained messy.',
        'Same network, same training code. Only the training signals differ.'),

      row(3, 'Split by person, never by window',
        nf(D.windows.train) + ' training, ' + nf(D.windows.val) + ' validation and ' + nf(D.windows.test) + ' test windows. All windows of one simulated person stay in one set, so the test people were never seen in training.',
        [fig('The ' + nf(D.n) + ' test windows come from ' + D.persons.length + ' simulated people and ' + D.rooms.length + ' empty rooms that training never saw', drawSplit(D),
          'The three sets to scale: ' + nf(D.windows.train) + ' training, ' + nf(D.windows.val) + ' validation, ' + nf(D.windows.test) + ' test windows. The test set drawn as ' + D.persons.length + ' simulated people with 5 windows each, moving or still, and ' + D.rooms.length + ' empty rooms with one window each, ' + D.fanRooms + ' of them with a fan.')],
        [String(D.persons.length)], 'simulated people held out for the test, with ' + D.rooms.length + ' empty rooms.',
        'All of them are simulated.'),

      row(4, 'An alarm threshold set on validation',
        'The PERSON threshold was set on the validation set, not on the test set, so that at most ' + pc(QUOTED.falseAlarmLimit, 0) + ' of empty rooms raise an alarm.',
        [fig('The threshold cuts off the top tenth on validation', drawThreshold(D),
          'Person scores of the ' + valR.n + ' empty rooms in the validation set, sorted. ' + valR.k + ' score above the threshold of ' + D.thr.toFixed(4) + ', which is ' + pc(valR.k / valR.n) + '.', { grow: 1.25 }),
        fig('On the test set: ' + pc(test.k / test.n), drawRates(D),
          'Empty rooms that raise an alarm at the threshold. ' + D.rates.map((r) => r.label + ' ' + pc(r.k / r.n) + ', ' + r.k + ' of ' + r.n).join('. ') + '.')],
        [D.thr.toFixed(2)], 'is the threshold. ' + pc(valR.k / valR.n) + ' of validation empty rooms score above it.',
        'On the test set it gives ' + pc(test.k / test.n) + ', ' + test.k + ' of ' + test.n + ': ' + pc(D.rates[3].k / D.rates[3].n) + ' without a fan, ' + pc(D.rates[2].k / D.rates[2].n) + ' with one.',
        h('button.btn.btn-sm', { type: 'button', onclick: () => open('test') }, 'Move the threshold on the test set', icon('chevron', 14))),

      row(5, 'Fuse Wi-Fi with radar and thermal',
        'Breathing is smaller than the ESP32’s own noise, so Wi-Fi is one voice of three. Wi-Fi, radar and heat are weighed together, and the rover moves and listens again.',
        [fig('How small breathing is', drawNoise(D),
          'To scale: the ESP32’s own noise is about ' + QUOTED.noise + ' % per bin. Breathing changes the signal by about ' + QUOTED.breathing[0] + ' to ' + QUOTED.breathing[1] + ' %.'),
        fig('What one Wi-Fi answer does to the odds', drawFuse(D),
          'Starting from a ' + pc(PRIOR, 0) + ' chance of a person, a Wi-Fi answer of person raises it to ' + pc(D.pPos) + ' and a quiet answer lowers it to ' + pc(D.pNeg) + '. A lead is possible from ' + pc(THRESHOLDS.possible, 0) + ' and confirmed from ' + pc(THRESHOLDS.confirmed, 0) + '.', { grow: 1.15 })],
        [pc(mv.k / mv.n)], 'of moving people found by Wi-Fi, in simulation: ' + mv.k + ' of ' + mv.n + '. Radar, thermal and a second look join for people who lie still.',
        'The Wi-Fi ratio is measured on the test set. The ' + pc(PRIOR, 0) + ' start and the radar and thermal ratios are design values.',
        h('button.btn.btn-sm.btn-primary', { type: 'button', onclick: () => ctx.shell.open('fusion') }, 'See the fusion working', icon('chevron', 14))),
    ];

    root.replaceChildren(
      h('header.sense-why-head', null,
        h('h3', null, 'Five decisions, each with its evidence'),
        h('p.sense-why-cols', { 'aria-hidden': 'true' }, 'Each row: the decision, what proves it, the number to remember, and one detail.'),
        h('p.note.sense-why-note', null, icon('info', 14), h('span', null, 'All evidence here comes from simulation: Blender-built people in a channel simulator.'))),
      h('div.sense-why-rows' + (reducedMotion() ? '' : '.sense-why-anim'), null, rows));

    const ro = new ResizeObserver((entries) => { for (const e of entries) { const rec = figs.find((f) => f.plot === e.target); if (!rec) continue; const w = Math.floor(e.contentRect.width), hh = Math.floor(e.contentRect.height); if (w !== rec.w || hh !== rec.h) { rec.w = w; rec.h = hh; rec.redraw(); } } });
    figs.forEach((f) => ro.observe(f.plot));
    disposers.push(() => ro.disconnect());
    disposers.push(ctx.bus.on('prefs', () => figs.forEach((f) => f.redraw())) || (() => {}));
  }

  async function load() {
    root.replaceChildren(h('div.empty', null, h('div.spinner'), h('p', null, 'Loading the test-set scores…')));
    try { D = digest(await loadEval(), ctx.nn); }
    catch (e) {
      console.warn('[sense/why] could not build the evidence', e);
      root.replaceChildren(h('div.empty', null, icon('alert', 28), h('h3', null, 'The evidence could not be loaded'), h('p.muted', { style: { maxWidth: '520px' } }, String(e.message || e)), h('button.btn', { type: 'button', onclick: load }, 'Try again')));
      return;
    }
    build();
    if (visible) measure();
  }
  await load();

  return {
    onShow() { visible = true; if (D && !S.busy && (!S.per || interrupted)) { interrupted = false; measure(); } },
    onHide() { visible = false; stopMeasure(); },
    onParams() {},
  };
}
