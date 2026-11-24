// Test set: one shared alarm threshold, dragged over the 955 held-out simulated windows.
// Every number on screen is counted here from data/eval_scores.json (loadEval) or quoted from docs/FACTS.md.
import * as d3 from 'd3';
import { loadEval, tok, wilson, clamp } from './common.js';

const NS = 'http://www.w3.org/2000/svg';
const ROWS = [
  { label: 'Person moving', word: 'found', person: true },
  { label: 'Person standing still', word: 'found', person: true },
  { label: 'Person lying still', word: 'found', person: true },
  { label: 'Empty room, no fan', word: 'called person', person: false },
  { label: 'Empty room, fan running', word: 'called person', person: false },
];
const TRUTH = ['a person, moving', 'a person standing still', 'a person lying still', 'an empty room', 'an empty room with a fan running'];
const DEPTH_BINS = [[0.5, 1.4], [1.4, 2.3], [2.3, 3.3]];   // the published bins, metres behind the wall
const CELLS = {   // what each outcome is called, and what it means to the team at the door
  tn: { name: 'Quiet, room empty', means: 'the rover moves on', glyph: 'ring-ok' },
  fp: { name: 'Alarm, room empty', means: 'radar and thermal are checked', glyph: 'dot-warn' },
  fn: { name: 'Quiet, person there', means: 'radar, thermal and a second look', glyph: 'ring-danger' },
  tp: { name: 'Found', means: 'a person the team goes to', glyph: 'dot-person' },
};

const upper = (a, v) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] > v) hi = m; else lo = m + 1; } return lo; };
const above = (a, v) => a.length - upper(a, v);               // how many scores are above v (a is sorted)
const pct = (k, n, d = 1) => (n ? (100 * k / n).toFixed(d) : '0') + ' %';
const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

function glyph(kind, size = 11) {
  const s = svgEl('svg', { viewBox: '0 0 12 12', width: size, height: size, class: 'sense-ev-glyph sense-ev-g-' + kind, 'aria-hidden': 'true' });
  s.append(svgEl('circle', { cx: 6, cy: 6, r: kind.startsWith('ring') ? 4.2 : 4.6 }));
  return s;
}

// Scores, counts and curves. Everything the view shows is derived here, once.
function buildModel(data) {
  const T = data.test, N = T.n, S = T.person_score;
  const rover = data.threshold;                                // scores are stored to 6 places, so the rover's own rule (score > threshold) applies as is
  const RK = Math.round(data.threshold * 100);                 // the slider stop that IS the rover's setting
  const TH = Array.from({ length: 101 }, (_, k) => (k === RK ? rover : k / 100));
  const label = (k) => (k === RK ? data.threshold : k / 100).toFixed(2);

  const rowOf = new Uint8Array(N);
  for (let i = 0; i < N; i++) rowOf[i] = T.kind[i] === 2 ? 0 : T.kind[i] === 1 ? (T.lying[i] ? 2 : 1) : (T.fan[i] ? 4 : 3);
  const pick = (f) => { const a = []; for (let i = 0; i < N; i++) if (f(i)) a.push(S[i]); return Float64Array.from(a).sort(); };
  const rows = ROWS.map((_, r) => pick((i) => rowOf[i] === r));
  const depth = DEPTH_BINS.map(([a, b], j) => pick((i) => T.kind[i] === 1 && T.depth[i] >= a && (j === DEPTH_BINS.length - 1 ? T.depth[i] <= b : T.depth[i] < b)));
  const people = pick((i) => T.kind[i] > 0), still = pick((i) => T.kind[i] === 1), empty = pick((i) => T.kind[i] === 0);
  const nP = people.length, nE = empty.length, nS = still.length, nM = rows[0].length;

  const at = (t) => {
    const r = rows.map((a) => above(a, t)), tp = r[0] + r[1] + r[2], fp = r[3] + r[4];
    return { rows: r, depth: depth.map((a) => above(a, t)), tp, fp, fn: nP - tp, tn: nE - fp, still: r[1] + r[2], moving: r[0] };
  };
  const stats = TH.map(at);
  const base = stats[RK];
  const pub = data.published && data.published.confusion;
  const reproduces = !!pub && [base.tn, base.fp, base.fn, base.tp].every((v, i) => v === pub[i]);

  // Receiver operating characteristic: sweep the threshold over every distinct score.
  const roc = (pos) => {
    const cuts = Array.from(new Set([...pos, ...empty])).sort((a, b) => b - a);
    const pts = cuts.map((t) => [above(empty, t) / nE, above(pos, t) / pos.length]);
    pts.push([1, 1]);
    let auc = 0;
    for (let i = 1; i < pts.length; i++) auc += (pts[i][0] - pts[i - 1][0]) * (pts[i][1] + pts[i - 1][1]) / 2;
    return { pts, auc, n: pos.length, at: (t) => [above(empty, t) / nE, above(pos, t) / pos.length] };
  };
  const curves = { moving: roc(rows[0]), all: roc(people), still: roc(still) };

  // The same counts as rates against the threshold, on a fine grid.
  const grid = d3.range(0, 1.0001, 0.0025);
  const sweep = grid.map((t) => { const m = above(rows[0], t), s = above(still, t), f = above(empty, t); return { t, moving: m / nM, still: s / nS, fa: f / nE, prec: m + s + f ? (m + s) / (m + s + f) : null }; });

  const median = rows.map((a) => d3.quantileSorted(a, 0.5));
  const groupSize = new Map();
  for (let i = 0; i < N; i++) groupSize.set(T.group[i], (groupSize.get(T.group[i]) || 0) + 1);
  return { T, N, S, rover, RK, TH, label, rowOf, rows, depth, nP, nE, nS, nM, stats, base, pub, reproduces, curves, sweep, median, groupSize };
}

// Beeswarm: x is exact, y is the nearest free place to the row's centre line. px must be ascending.
function swarm(px, d) {
  const n = px.length, ys = new Float32Array(n), d2 = d * d - 1e-4;
  let start = 0, ext = 0;
  const cand = [];
  for (let i = 0; i < n; i++) {
    while (px[i] - px[start] >= d) start++;
    cand.length = 0; cand.push(0);
    for (let j = start; j < i; j++) { const dx = px[i] - px[j], dy = Math.sqrt(d * d - dx * dx); cand.push(ys[j] + dy, ys[j] - dy); }
    cand.sort((a, b) => Math.abs(a) - Math.abs(b));
    let y = 0;
    for (const c of cand) {
      let ok = true;
      for (let j = start; j < i; j++) { const dx = px[i] - px[j], dy = c - ys[j]; if (dx * dx + dy * dy < d2) { ok = false; break; } }
      if (ok) { y = c; break; }
    }
    ys[i] = y; if (Math.abs(y) > ext) ext = Math.abs(y);
  }
  return { ys, ext };
}

// Push labels apart vertically so none overlap; keeps their order.
function spread(ys, gap, lo, hi) {
  const idx = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b]), out = ys.slice();
  for (let i = 0; i < idx.length; i++) out[idx[i]] = Math.max(i ? out[idx[i - 1]] + gap : lo, out[idx[i]]);
  for (let i = idx.length - 1; i >= 0; i--) out[idx[i]] = Math.min(i < idx.length - 1 ? out[idx[i + 1]] - gap : hi, out[idx[i]]);
  return out;
}

export async function create(el, ctx, { open, params }) {
  const { h, icon, fitCanvas, reducedMotion } = ctx.kit;
  el.replaceChildren(h('div.empty', null, h('div.spinner'), h('p', null, 'Loading the scores of the 955 test windows…')));
  let data;
  try { data = await loadEval(); } catch (e) {
    let api = {};
    el.replaceChildren(h('div.empty', null, icon('alert', 28), h('h3', null, 'The test-set scores did not load'),
      h('p.muted', { style: { maxWidth: '520px' } }, String(e.message || e)),
      h('button.btn', { onclick: async () => { api = await create(el, ctx, { open, params }); api.onShow?.(); } }, 'Try again')));
    return { onShow() { api.onShow?.(); }, onHide() { api.onHide?.(); }, onParams(p) { api.onParams?.(p); } };
  }
  const M = buildModel(data);
  const { T, N, S, RK, TH, rowOf } = M;
  let k = RK, visible = false, raf = 0, anim = 0, hover = -1;
  const offs = [];

  // ---------------------------------------------------------------- centre: the strip plot and the one control
  const readout = h('output.sense-ev-value.num', { id: 'sense-ev-value' });
  const offset = h('span.sense-ev-offset');
  const range = h('input.sense-ev-range', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Alarm threshold: the rover says person when the score is above this', oninput: () => setK(+range.value) });
  const back = h('button.btn.btn-sm', { type: 'button', onclick: () => glide(RK) }, icon('reset', 14), `Back to ${M.label(RK)} (the rover’s setting)`);
  const canvas = h('canvas.sense-ev-canvas', { role: 'img', 'aria-label': `Strip plot of the ${N} simulated test windows by network score from 0 to 1, one row per situation: ${ROWS.map((r, i) => `${r.label.toLowerCase()} (${M.rows[i].length})`).join(', ')}. The sentence below the chart reads it at the current threshold.` });
  const tip = h('div.sense-ev-tip', { 'aria-hidden': 'true', hidden: true });
  const plot = h('div.sense-ev-plot', null, canvas, range, tip);
  const reading = h('p.sense-ev-reading');
  const key = (g, text) => h('span.sense-ev-key', null, glyph(g), text);
  const hero = h('section.sense-ev-hero', { 'aria-label': 'Every test window by network score' },
    h('header.sense-ev-herohead', null,
      h('div', null,
        h('h3.sense-ev-h', null, 'Every dot is one test window, placed by its score. Moving people score far right.'),
        h('p.sense-figsub', null, key('dot-person', 'found'), key('ring-danger', 'quiet, person there'), key('ring-ok', 'quiet, room empty'), key('dot-warn', 'alarm, room empty'),
          'Filled: the rover raises an alarm. Hollow: it stays quiet. Windows that round to 0.00 or 1.00 are stacked just outside the axis.'))),
    h('div.sense-ev-ctl', null,
      h('label.sense-ev-ctl-name', { for: 'sense-ev-value' }, 'Alarm threshold'), readout, offset, h('div.grow'), back),
    plot, reading,
    h('div.note', null, icon('info', 16), h('span', null, 'Every one of these ', N, ' windows is simulated: Blender-built people behind a wall in a Wi-Fi channel simulator. The network was trained and tested on simulated people. A still person is the job of radar, thermal and a second look from another place, and every route is planned for a person to approve.')));

  // ---------------------------------------------------------------- left: the two trade-off charts
  const aucs = M.curves;
  const rocBox = h('div.sense-ev-svgbox'), tradeBox = h('div.sense-ev-svgbox');
  const left = h('aside.sense-ev-side', { 'aria-label': 'Trade-off curves' },
    h('section.sense-ev-fig.sense-ev-fig-roc', null,
      h('h3.sense-figtitle', null, `Moving people separate from empty rooms: ${aucs.moving.auc.toFixed(2)}. Still people: ${aucs.still.auc.toFixed(2)}.`),
      h('p.sense-figsub', null, 'Each curve is every possible threshold. The number is the area under it: 1 is the maximum, 0.5 is chance. Drag the point.'),
      rocBox),
    h('section.sense-ev-fig.sense-ev-fig-trade', null,
      h('h3.sense-figtitle', null, 'Every threshold, and what it does'),
      h('p.sense-figsub', null, 'Share of windows against the threshold. Drag the line.'),
      tradeBox));

  // ---------------------------------------------------------------- right: the table and the split
  const cell = {};
  const mkCell = (id) => {
    const c = CELLS[id];
    const o = cell[id] = { n: h('b.num'), delta: h('span.sense-ev-delta.num'), bar: h('i') };
    return h('td.sense-ev-cell.sense-ev-cell-' + id, null,
      h('div.sense-ev-cell-top', null, glyph(c.glyph, 12), o.n),
      h('div.sense-ev-cell-name', null, c.name), h('div.sense-ev-cell-means', null, c.means),
      h('div.sense-ev-share', { 'aria-hidden': 'true' }, o.bar), o.delta);
  };
  const mxTitle = h('h3.sense-figtitle');
  const acc = h('p.sense-ev-acc');
  const check = h('p.sense-ev-check' + (M.reproduces ? '.is-ok' : '.is-bad'), null, icon(M.reproduces ? 'check' : 'alert', 14),
    h('span', null, M.reproduces
      ? [`At the rover’s ${M.label(RK)}: `, h('span.num', null, [M.base.tn, M.base.fp, M.base.fn, M.base.tp].join(' / ')), '. Reproduces the published table.']
      : [`At the rover’s ${M.label(RK)} this table counts `, h('span.num', null, [M.base.tn, M.base.fp, M.base.fn, M.base.tp].join(' / ')), ', which does not match the published ', h('span.num', null, (M.pub || []).join(' / ')), '. Rebuild data/eval_scores.json.']));
  const matrix = h('table.sense-ev-mx', null,
    h('thead', null, h('tr', null, h('td'), h('th', { scope: 'col' }, 'Rover: no one'), h('th', { scope: 'col' }, 'Rover: person'))),
    h('tbody', null,
      h('tr', null, h('th', { scope: 'row' }, 'Room is empty', h('span.num', null, M.nE)), mkCell('tn'), mkCell('fp')),
      h('tr', null, h('th', { scope: 'row' }, 'A person is there', h('span.num', null, M.nP)), mkCell('fn'), mkCell('tp'))));

  const split = [];
  const splitRow = (label, arr, getK, person) => {
    const o = { arr, getK, person, wh: h('i.sense-ev-wh'), pt: h('i.sense-ev-pt' + (person ? '.is-person' : '.is-alarm')), rv: h('i.sense-ev-rv'), val: h('span.sense-ev-sp-val.num') };
    o.rv.style.left = (100 * getK(M.base) / arr.length) + '%';
    o.el = h('div.sense-ev-sp-row', { role: 'listitem' }, h('span.sense-ev-sp-label', null, label), h('span.sense-ev-sp-n.num', null, arr.length), h('span.sense-ev-track', null, o.rv, o.wh, o.pt), o.val);
    split.push(o); return o.el;
  };
  const splitEl = h('div.sense-ev-split', { role: 'list' },
    h('div.sense-ev-sp-head', null, h('span', null, 'People found'), h('span', null, 'windows')),
    splitRow('Moving', M.rows[0], (s) => s.rows[0], true),
    splitRow('Standing still', M.rows[1], (s) => s.rows[1], true),
    splitRow('Lying still', M.rows[2], (s) => s.rows[2], true),
    h('div.sense-ev-sp-head', null, h('span', null, 'Still people found, by depth behind the wall')),
    DEPTH_BINS.map(([a, b], j) => splitRow(`${a} to ${b} m`, M.depth[j], (s) => s.depth[j], true)),
    h('div.sense-ev-sp-head', null, h('span', null, 'Empty rooms that raise an alarm')),
    splitRow('No fan', M.rows[3], (s) => s.rows[3], false),
    splitRow('Fan running', M.rows[4], (s) => s.rows[4], false),
    h('div.sense-ev-sp-axis', { 'aria-hidden': 'true' }, h('span'), h('span'), h('span.sense-ev-sp-ticks.num', null, h('i', null, '0'), h('i', null, '25'), h('i', null, '50'), h('i', null, '75'), h('i', null, '100 %')), h('span')));
  const right = h('aside.sense-ev-side.sense-ev-side-r', { 'aria-label': 'Counts at this threshold' },
    h('section.sense-ev-fig', null, mxTitle, h('p.sense-figsub.sense-ev-tall', null, 'Each cell counts test windows, with what it means for the team at the door.'), matrix, acc, check),
    h('section.sense-ev-fig.sense-ev-fig-split', null,
      h('h3.sense-figtitle', null, 'Movement, posture and depth decide who is found'),
      h('p.sense-figsub', null, 'Dot: the rate now, with its 95 % Wilson interval. Dashed tick: the rate at the rover’s setting. Grey number: windows counted.'),
      splitEl));

  el.replaceChildren(h('div.sense-ev', null, left, hero, right));

  // ---------------------------------------------------------------- hero canvas
  const L = { ok: false };
  const order = ROWS.map((_, r) => { const a = []; for (let i = 0; i < N; i++) if (rowOf[i] === r) a.push(i); return a.sort((p, q) => S[p] - S[q]); });
  const X = new Float32Array(N), Y = new Float32Array(N);

  function layout(w, hgt) {
    const top = 42, bottom = 42, head = 21, gutL = 24, gutR = Math.round(clamp(w * 0.14, 76, 104));
    const x0 = 10 + gutL, x1 = w - 8 - gutR, sx = (v) => x0 + v * (x1 - x0);
    const avail = hgt - top - bottom - head * ROWS.length;
    let best = null;
    for (let r = 3.1; r >= 1.69; r -= 0.1) {
      const d = 2 * r + 0.7;
      const rowsL = order.map((ids) => {
        const lo = ids.filter((i) => S[i] < 0.005), hi = ids.filter((i) => S[i] >= 0.995);
        const pileL = lo.length >= 8 ? lo : [], pileR = hi.length >= 8 ? hi : [];
        const mid = ids.slice(pileL.length, ids.length - pileR.length);
        const sw = swarm(mid.map((i) => sx(S[i])), d);
        const colsL = Math.max(1, Math.floor((gutL - 5) / d)), colsR = Math.max(1, Math.floor((gutR - 6) / d));
        const need = Math.max(34, 2 * (sw.ext + r) + 6, Math.ceil(pileL.length / colsL) * d + 6, Math.ceil(pileR.length / colsR) * d + 6);
        return { mid, sw, pileL, pileR, need };
      });
      const total = d3.sum(rowsL, (q) => q.need);
      best = { r, d, rowsL, total };
      if (total <= avail) break;
    }
    const { r, d, rowsL, total } = best;
    const extra = (avail - total) / ROWS.length, squeeze = total > avail ? avail / total : 1;
    let y = top;
    const bands = rowsL.map((q) => {
      const bh = total > avail ? q.need * squeeze : q.need + extra, b = { y, head, top: y + head, h: bh, cy: y + head + bh / 2 };
      const lim = bh / 2 - r - 1;
      q.mid.forEach((i, j) => { X[i] = sx(S[i]); Y[i] = b.cy + clamp(q.sw.ys[j], -lim, lim); });
      const perCol = Math.max(1, Math.floor((bh - 4) / d));
      const stack = (ids, dir, xe) => {
        const cols = Math.ceil(ids.length / perCol);
        ids.forEach((i, j) => {
          const c = Math.floor(j / perCol), n = Math.min(perCol, ids.length - c * perCol), jj = j % perCol;
          X[i] = xe + dir * (5 + r + c * d); Y[i] = b.cy + (jj - (n - 1) / 2) * d;
        });
        return cols ? { n: ids.length, x: xe + dir * 3, w: cols * d + 4 } : null;
      };
      b.pileL = stack(q.pileL.slice().reverse(), -1, x0); b.pileR = stack(q.pileR, 1, x1);
      y += head + bh;
      return b;
    });
    Object.assign(L, { ok: true, w, h: hgt, x0, x1, sx, top, bottomY: y, r, d, bands });
    const thumb = 16;
    range.style.left = (x0 - thumb / 2) + 'px'; range.style.width = (x1 - x0 + thumb) + 'px';
  }

  let fontUI = '', fontNum = '';
  function draw() {
    if (!L.ok) return;
    const c = canvas.getContext('2d'), { w, x0, x1, sx, top, bottomY, r, bands } = L;
    const col = { person: tok('--person'), danger: tok('--text-2'), ok: tok('--ok'), warn: tok('--warn'), accent: tok('--accent'), line: tok('--line'), line2: tok('--line-2'), t1: tok('--text'), t2: tok('--text-2'), t3: tok('--text-3'), bg: tok('--bg-0') };
    fontUI ||= getComputedStyle(el).fontFamily; fontNum ||= tok('--mono');
    const ui = (px, wt = 400) => `${wt} ${px}px ${fontUI}`, num = (px, wt = 500) => `${wt} ${px}px ${fontNum}`;
    const t = TH[k], xt = Math.round(sx(t)) + 0.5, xr = Math.round(sx(M.rover)) + 0.5, st = M.stats[k];
    c.clearRect(0, 0, w, L.h);
    c.textBaseline = 'middle';

    // the alarm side of the line
    c.globalAlpha = 0.055; c.fillStyle = col.accent; c.fillRect(xt, top - 4, w - xt, bottomY - top + 4); c.globalAlpha = 1;
    // score grid
    c.lineWidth = 1;
    for (let g = 0; g <= 10; g++) { const x = Math.round(sx(g / 10)) + 0.5; c.strokeStyle = col.line; c.globalAlpha = g % 2 ? 0.5 : 1; c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottomY); c.stroke(); }
    c.globalAlpha = 1;

    // rows: a header line of words, then the dots
    const segs = (parts, x, y, align) => {
      let wsum = 0; for (const p of parts) { c.font = p.f; p.w = c.measureText(p.t).width; wsum += p.w; }
      let cx = align === 'right' ? x - wsum : x; c.textAlign = 'left';
      for (const p of parts) { c.font = p.f; c.fillStyle = p.c; c.fillText(p.t, cx, y); cx += p.w; }
      return wsum;
    };
    bands.forEach((b, i) => {
      const R = ROWS[i], n = M.rows[i].length, got = st.rows[i];
      c.strokeStyle = i === 3 ? col.line2 : col.line; c.beginPath(); c.moveTo(0, Math.round(b.y) + 0.5); c.lineTo(w, Math.round(b.y) + 0.5); c.stroke();
      const hy = b.y + 12;
      segs([{ t: R.label, f: ui(12, 600), c: col.t1 }, { t: '   ' + n + ' windows · median score ', f: ui(11), c: col.t3 }, { t: M.median[i].toFixed(2), f: num(11), c: col.t2 }], 10, hy, 'left');
      segs([{ t: R.word + ' ', f: ui(12, 600), c: R.person ? col.person : col.warn }, { t: pct(got, n), f: num(12, 600), c: col.t1 }, { t: '   ' + got + ' of ' + n, f: num(11), c: col.t3 }], w - 8, hy, 'right');
      // median caret on the row's top edge
      const mx = sx(M.median[i]); c.fillStyle = col.t2; c.beginPath(); c.moveTo(mx - 3.5, b.top); c.lineTo(mx + 3.5, b.top); c.lineTo(mx, b.top + 5); c.closePath(); c.fill();
      // piles outside the axis
      for (const p of [b.pileL, b.pileR]) if (p) {
        const xa = p.x, xb = p.x + Math.sign(p.x - (x0 + x1) / 2) * p.w, yb = b.top + b.h - 1.5;
        c.strokeStyle = col.line2; c.beginPath(); c.moveTo(xa, yb - 3); c.lineTo(xa, yb); c.lineTo(xb, yb); c.lineTo(xb, yb - 3); c.stroke();
      }
    });
    c.strokeStyle = col.line; c.beginPath(); c.moveTo(0, Math.round(bottomY) + 0.5); c.lineTo(w, Math.round(bottomY) + 0.5); c.stroke();

    // the windows, drawn by outcome so that the rarer and more serious ones sit on top
    const rr = r, ring = Math.max(1.1, r * 0.46);
    const pass = (isPerson, isAlarm, color, filled, alpha) => {
      c.globalAlpha = alpha; c.beginPath();
      for (let i = 0; i < N; i++) {
        if ((rowOf[i] < 3) !== isPerson || (S[i] > t) !== isAlarm) continue;
        const rad = filled ? rr : rr - ring / 2;
        c.moveTo(X[i] + rad, Y[i]); c.arc(X[i], Y[i], rad, 0, 6.2832);
      }
      if (filled) { c.fillStyle = color; c.fill(); } else { c.strokeStyle = color; c.lineWidth = ring; c.stroke(); }
      c.globalAlpha = 1;
    };
    pass(false, false, col.ok, false, 0.8);
    pass(true, false, col.danger, false, 0.95);
    pass(true, true, col.person, true, 1);
    pass(false, true, col.warn, true, 1);

    // the rover's setting: always there
    c.lineWidth = 1; c.strokeStyle = col.t2; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(xr, top - 6); c.lineTo(xr, bottomY + 18); c.stroke(); c.setLineDash([]);
    c.fillStyle = col.t2; c.beginPath(); c.moveTo(xr, 5); c.lineTo(xr + 4, 9.5); c.lineTo(xr, 14); c.lineTo(xr - 4, 9.5); c.closePath(); c.fill();
    // the threshold
    c.strokeStyle = col.accent; c.lineWidth = 1.5; c.beginPath(); c.moveTo(xt, 12); c.lineTo(xt, bottomY + 5); c.stroke();
    c.font = ui(11); const zy = 31, lt = M.label(k);
    const leftParts = [{ t: 'says no one · score ≤ ', f: ui(11), c: col.t3 }, { t: lt, f: num(11), c: col.t2 }];
    const rightParts = [{ t: 'score > ', f: ui(11), c: col.t2 }, { t: lt, f: num(11), c: col.t1 }, { t: ' · says person', f: ui(11, 600), c: col.accent }];
    const measure = (ps) => { let s = 0; for (const p of ps) { c.font = p.f; s += c.measureText(p.t).width; } return s; };
    if (xt - 8 - measure(leftParts) > 2) segs(leftParts, xt - 8, zy, 'right');
    if (xt + 8 + measure(rightParts) < w - 2) segs(rightParts, xt + 8, zy, 'left');

    // axis
    const ay = bottomY + 12;
    for (let g = 0; g <= 10; g += 2) { c.font = num(11, 400); c.fillStyle = col.t3; c.textAlign = 'center'; c.fillText((g / 10).toFixed(1), sx(g / 10), ay); }
    const ay2 = bottomY + 30;
    c.font = ui(11); c.fillStyle = col.t3; c.textAlign = 'right'; c.fillText('Network score for “person”, 0 to 1', w - 8, ay2);
    segs([{ t: 'the rover’s setting ', f: ui(11), c: col.t2 }, { t: M.label(RK), f: num(11), c: col.t1 }], xr - 6, ay2, 'right');

    // hovered window, and the other windows of the same simulated person or room
    if (hover >= 0) {
      const g = T.group[hover];
      c.strokeStyle = col.t2; c.lineWidth = 1;
      for (let i = 0; i < N; i++) if (T.group[i] === g && i !== hover) { c.beginPath(); c.arc(X[i], Y[i], rr + 2.5, 0, 6.2832); c.stroke(); }
      c.strokeStyle = col.t1; c.lineWidth = 1.5; c.beginPath(); c.arc(X[hover], Y[hover], rr + 3, 0, 6.2832); c.stroke();
    }
  }
  const invalidate = () => { if (!raf && visible) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  offs.push(fitCanvas(canvas, (c2, w, hgt) => { layout(w, hgt); draw(); }));

  const kFromX = (clientX) => { const b = canvas.getBoundingClientRect(); return clamp(Math.round(100 * (clientX - b.left - L.x0) / (L.x1 - L.x0)), 0, 100); };
  function showTip(i, e) {
    if (i === hover) return;
    hover = i; invalidate();
    if (i < 0) { tip.hidden = true; return; }
    const r = rowOf[i], said = S[i] > TH[k], person = r < 3, same = M.groupSize.get(T.group[i]);
    const out = person ? (said ? CELLS.tp : CELLS.fn) : (said ? CELLS.fp : CELLS.tn);
    tip.replaceChildren(
      h('div.sense-ev-tip-score', null, 'Score ', h('b.num', null, S[i].toFixed(4))),
      h('div', null, 'Truth: ', TRUTH[r], person ? [', ', h('span.num', null, T.depth[i].toFixed(2)), ' m behind the wall'] : null, '.'),
      h('div.sense-ev-tip-out', null, glyph(out.glyph), `At ${M.label(k)} the rover says ${said ? 'person' : 'no one'}: ${out.name.toLowerCase()}, ${out.means}.`),
      h('div.dim', null, same > 1 ? `One of ${same} windows from the same simulated ${person ? 'person' : 'room'} (ringed).` : `The only window from this simulated ${person ? 'person' : 'room'}.`));
    tip.hidden = false;
    const pw = plot.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = clamp(X[i] + 14 + tw > pw ? X[i] - 14 - tw : X[i] + 14, 4, pw - tw - 4) + 'px';
    tip.style.top = clamp(Y[i] - th / 2, 4, plot.clientHeight - th - 4) + 'px';
  }
  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => { if (e.button) return; dragging = true; canvas.setPointerCapture(e.pointerId); showTip(-1); stop(); setK(kFromX(e.clientX)); e.preventDefault(); });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) { setK(kFromX(e.clientX)); return; }
    const b = canvas.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
    let bi = -1, bd = 64;
    for (let i = 0; i < N; i++) { const dx = X[i] - px, dy = Y[i] - py, q = dx * dx + dy * dy; if (q < bd) { bd = q; bi = i; } }
    showTip(bi, e);
  });
  const endDrag = () => { dragging = false; };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (!dragging) showTip(-1); });

  // ---------------------------------------------------------------- ROC
  let rocUpd = null, tradeUpd = null;
  const SER = [
    { id: 'moving', name: 'moving people', short: 'moving', cls: 'sense-ev-l-moving' },
    { id: 'all', name: 'all people', short: 'all', cls: 'sense-ev-l-all' },
    { id: 'still', name: 'still people', short: 'still', cls: 'sense-ev-l-still' },
  ];
  function dragSvg(svg, toK) {
    let on = false;
    svg.addEventListener('pointerdown', (e) => { if (e.button) return; on = true; svg.setPointerCapture(e.pointerId); stop(); setK(toK(e)); e.preventDefault(); });
    svg.addEventListener('pointermove', (e) => { if (on) setK(toK(e)); });
    const end = () => { on = false; };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  }
  function buildRoc(w, hgt) {
    const m = { l: 40, r: 10, t: 18, b: 36 }, side = Math.max(60, Math.min(w - m.l - m.r, hgt));
    const x = d3.scaleLinear([0, 1], [m.l, m.l + side]), y = d3.scaleLinear([0, 1], [m.t + side, m.t]);
    const svg = d3.create('svg').attr('width', w).attr('height', m.t + side + m.b).attr('class', 'sense-ev-svg').attr('role', 'img');
    const g = svg.append('g');
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      g.append('line').attr('class', 'sense-ev-grid').attr('x1', x(v)).attr('x2', x(v)).attr('y1', y(0)).attr('y2', y(1));
      g.append('line').attr('class', 'sense-ev-grid').attr('x1', x(0)).attr('x2', x(1)).attr('y1', y(v)).attr('y2', y(v));
      g.append('text').attr('class', 'sense-axis num').attr('x', x(v)).attr('y', y(0) + 14).attr('text-anchor', 'middle').text(v * 100);
      g.append('text').attr('class', 'sense-axis num').attr('x', x(0) - 6).attr('y', y(v) + 4).attr('text-anchor', 'end').text(v * 100);
    }
    g.append('text').attr('class', 'sense-axis').attr('x', x(0.5)).attr('y', y(0) + 30).attr('text-anchor', 'middle').text('Empty rooms that raise an alarm (%)');
    g.append('text').attr('class', 'sense-axis').attr('transform', `translate(${x(0) - 28},${y(0.5)}) rotate(-90)`).attr('text-anchor', 'middle').text('People found (%)');
    g.append('line').attr('class', 'sense-ev-diag').attr('x1', x(0)).attr('y1', y(0)).attr('x2', x(1)).attr('y2', y(1));
    g.append('text').attr('class', 'sense-axis sense-ev-halo').attr('transform', `translate(${x(0.8)},${y(0.8) + 13}) rotate(-45)`).attr('text-anchor', 'middle').text('coin toss');
    const line = d3.line().x((p) => x(p[0])).y((p) => y(p[1])).curve(d3.curveStepAfter);
    const yAt = (c, f) => { let best = 0; for (const p of c.pts) { if (p[0] <= f) best = p[1]; else break; } return best; };
    for (const s of SER) g.append('path').attr('class', 'sense-ev-line ' + s.cls).attr('d', line(M.curves[s.id].pts));
    // direct labels with the area under each curve
    const lab = (s, f, dy, anchor) => g.append('text').attr('class', 'sense-ev-lab sense-ev-halo ' + s.cls + '-t').attr('x', x(f)).attr('y', y(yAt(M.curves[s.id], f)) + dy).attr('text-anchor', anchor)
      .call((tx) => { tx.append('tspan').text(s.short + ' '); tx.append('tspan').attr('class', 'num').text(M.curves[s.id].auc.toFixed(2)); });
    lab(SER[0], 0.15, 15, 'start'); lab(SER[1], 0.3, -7, 'end'); lab(SER[2], 0.47, 20, 'start');
    // rover's setting on each curve
    for (const s of SER) { const p = M.curves[s.id].at(M.rover); g.append('path').attr('class', 'sense-ev-rover').attr('d', d3.symbol(d3.symbolDiamond, 34)()).attr('transform', `translate(${x(p[0])},${y(p[1])})`); }
    const pr = M.curves.moving.at(M.rover);
    g.append('text').attr('class', 'sense-axis sense-ev-halo').attr('x', x(pr[0]) - 8).attr('y', y(pr[1]) + 2).attr('text-anchor', 'end').text('rover');
    const guide = g.append('line').attr('class', 'sense-ev-guide').attr('y1', y(0)).attr('y2', y(1) - 4);
    const flag = g.append('text').attr('class', 'sense-ev-flag').attr('y', y(1) - 8), flagV = flag.append('tspan').attr('class', 'num'), flagT = flag.append('tspan').text(' empty-room alarms');
    const dots = SER.map((s) => g.append('circle').attr('class', 'sense-ev-op').attr('r', 4.5));
    svg.append('rect').attr('class', 'sense-ev-hit').attr('x', 0).attr('y', 0).attr('width', w).attr('height', m.t + side + m.b);
    const ops = TH.map((t) => M.curves.all.at(t));
    dragSvg(svg.node(), (e) => {
      const b = svg.node().getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
      let bk = k, bd = Infinity;
      for (let j = 0; j <= 100; j++) { const dx = x(ops[j][0]) - px, dy = y(ops[j][1]) - py, q = dx * dx + dy * dy * 0.25; if (q < bd) { bd = q; bk = j; } }
      return bk;
    });
    rocBox.replaceChildren(svg.node());
    rocUpd = () => {
      const t = TH[k], f = above(M.rows[3], t) + above(M.rows[4], t);
      const gx = x(f / M.nE);
      guide.attr('x1', gx).attr('x2', gx);
      SER.forEach((s, i) => { const p = M.curves[s.id].at(t); dots[i].attr('cx', x(p[0])).attr('cy', y(p[1])); });
      flagV.text(pct(f, M.nE)); flag.attr('x', gx < x(0.5) ? Math.max(x(0), gx - 4) : Math.min(x(1), gx + 4)).attr('text-anchor', gx < x(0.5) ? 'start' : 'end');
      const st = M.stats[k];
      svg.attr('aria-label', `Trade-off curves for moving, all and still people against the ${M.nE} empty rooms. At ${M.label(k)}: ${pct(st.fp, M.nE)} of empty rooms alarm, ${pct(st.moving, M.nM)} of moving people and ${pct(st.still, M.nS)} of still people are found.`);
    };
    rocUpd();
  }

  // ---------------------------------------------------------------- rates against the threshold
  const TR = [
    { id: 'moving', name: 'moving found', cls: 'sense-ev-l-moving', get: (s) => s.moving / M.nM },
    { id: 'prec', name: 'alarms that are real', short: 'real alarms', cls: 'sense-ev-l-all', get: (s) => (s.tp + s.fp ? s.tp / (s.tp + s.fp) : null) },
    { id: 'still', name: 'still found', cls: 'sense-ev-l-still', get: (s) => s.still / M.nS },
    { id: 'fa', name: 'empty-room alarms', cls: 'sense-ev-l-fa', get: (s) => s.fp / M.nE },
  ];
  function buildTrade(w, hgt) {
    const m = { l: 40, r: 10, t: 20, b: 36 }, ph = Math.max(80, hgt - m.t - m.b);
    const x = d3.scaleLinear([0, 1], [m.l, w - m.r]), y = d3.scaleLinear([0, 1], [m.t + ph, m.t]);
    const svg = d3.create('svg').attr('width', w).attr('height', hgt).attr('class', 'sense-ev-svg').attr('role', 'img');
    const g = svg.append('g');
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      g.append('line').attr('class', 'sense-ev-grid').attr('x1', x(0)).attr('x2', x(1)).attr('y1', y(v)).attr('y2', y(v));
      g.append('text').attr('class', 'sense-axis num').attr('x', x(0) - 6).attr('y', y(v) + 4).attr('text-anchor', 'end').text(v * 100);
    }
    for (const v of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      g.append('line').attr('class', 'sense-ev-grid').attr('x1', x(v)).attr('x2', x(v)).attr('y1', y(0)).attr('y2', y(0) + 4);
      g.append('text').attr('class', 'sense-axis num').attr('x', x(v)).attr('y', y(0) + 15).attr('text-anchor', 'middle').text(v.toFixed(1));
    }
    g.append('text').attr('class', 'sense-axis').attr('x', x(1)).attr('y', y(0) + 31).attr('text-anchor', 'end').text('Alarm threshold');
    g.append('text').attr('class', 'sense-axis').attr('transform', `translate(${x(0) - 28},${y(0.5)}) rotate(-90)`).attr('text-anchor', 'middle').text('Share of windows (%)');
    const key = { moving: 'moving', prec: 'prec', still: 'still', fa: 'fa' };
    for (const s of TR) g.append('path').attr('class', 'sense-ev-line ' + s.cls).attr('d', d3.line().defined((p) => p[key[s.id]] != null).x((p) => x(p.t)).y((p) => y(p[key[s.id]]))(M.sweep));
    const sAt = (f) => M.sweep[Math.round(f / 0.0025)];
    const name = (s, f, dy, anchor, yv) => g.append('text').attr('class', 'sense-ev-lab sense-ev-halo ' + s.cls + '-t').attr('x', x(f)).attr('y', y(yv != null ? yv : sAt(f)[key[s.id]]) + dy).attr('text-anchor', anchor).text(s.short || s.name);
    name(TR[0], 0.99, 15, 'end', sAt(0.8).moving); name(TR[1], 1, -5, 'end', 1); name(TR[2], 0.62, 4, 'start', 0.45); name(TR[3], 0.04, 17, 'start', sAt(0.3).fa);
    const xr = x(M.rover);
    g.append('line').attr('class', 'sense-ev-roverline').attr('x1', xr).attr('x2', xr).attr('y1', y(1)).attr('y2', y(0) + 22);
    g.append('text').attr('class', 'sense-axis sense-ev-halo').attr('x', xr - 4).attr('y', y(0) + 31).attr('text-anchor', 'end').call((tx) => { tx.append('tspan').text('rover '); tx.append('tspan').attr('class', 'num').text(M.label(RK)); });
    const guide = g.append('line').attr('class', 'sense-ev-guide sense-ev-guide-strong').attr('y1', y(0)).attr('y2', y(1) - 6);
    const grip = g.append('rect').attr('class', 'sense-ev-grip').attr('width', 8).attr('height', 14).attr('rx', 2).attr('y', y(1) - 12);
    const marks = TR.map((s) => ({ s, dot: g.append('circle').attr('class', 'sense-ev-op').attr('r', 3.5), text: g.append('text').attr('class', 'sense-ev-lab sense-ev-val sense-ev-halo') }));
    for (const mk of marks) mk.v = mk.text.append('tspan').attr('class', 'num');
    svg.append('rect').attr('class', 'sense-ev-hit').attr('x', 0).attr('y', 0).attr('width', w).attr('height', hgt);
    dragSvg(svg.node(), (e) => { const b = svg.node().getBoundingClientRect(); return clamp(Math.round(100 * x.invert(e.clientX - b.left)), 0, 100); });
    tradeBox.replaceChildren(svg.node());
    tradeUpd = () => {
      const st = M.stats[k], gx = x(TH[k]), flip = gx > x(0.84);
      guide.attr('x1', gx).attr('x2', gx); grip.attr('x', gx - 4);
      const vals = marks.map((mk) => mk.s.get(st));
      const ys = spread(vals.map((v) => y(v == null ? 1 : v) + 4), 13, y(1) + 8, y(0) + 2);
      marks.forEach((mk, i) => {
        const v = vals[i];
        mk.dot.attr('cx', gx).attr('cy', y(v == null ? 0 : v)).style('display', v == null ? 'none' : null);
        mk.text.attr('x', gx + (flip ? -8 : 8)).attr('y', ys[i]).attr('text-anchor', flip ? 'end' : 'start');
        mk.v.text(v == null ? '' : pct(v * 1000, 1000));
      });
      svg.attr('aria-label', `Rates against the alarm threshold. At ${M.label(k)}: ${marks.map((mk, i) => (vals[i] == null ? 'no alarms' : (100 * vals[i]).toFixed(1) + ' %') + ' ' + mk.s.name).join(', ')}.`);
    };
    tradeUpd();
  }
  const watch = (box, build, widthOnly) => { let lw = 0, lh = 0; const ro = new ResizeObserver(() => { const r = box.getBoundingClientRect(), w = Math.floor(r.width), hh = Math.floor(r.height); if (w < 40 || (!widthOnly && hh < 40) || (w === lw && (widthOnly || hh === lh))) return; lw = w; lh = hh; build(w, widthOnly ? Math.round(clamp(innerHeight * 0.26, 180, 250)) : hh); }); ro.observe(box); offs.push(() => ro.disconnect()); };
  watch(rocBox, buildRoc, true); watch(tradeBox, buildTrade);

  // ---------------------------------------------------------------- everything that follows the threshold
  const more = (d, noun) => (d === 0 ? 'the same ' + noun : Math.abs(d) + (d > 0 ? ' more ' : ' fewer ') + noun);
  function update() {
    const st = M.stats[k], b = M.base, lt = M.label(k), atRover = k === RK;
    range.value = k;
    readout.textContent = lt;
    const dist = Math.abs(k - RK) / 100;
    offset.replaceChildren(...(atRover ? [icon('rover', 14), 'the rover’s setting'] : [h('span.num', null, dist.toFixed(2)), k > RK ? ' above the rover’s setting' : ' below the rover’s setting']));
    offset.classList.toggle('is-rover', atRover);
    back.disabled = atRover;
    const line1 = `At ${lt}: ${st.fp} of ${M.nE} empty rooms raise an alarm, and ${st.still} of ${M.nS} still people are found. ${st.moving} of ${M.nM} moving people are found.`;
    const line2 = atRover ? 'This is the rover’s setting, chosen on validation windows so that at most 10 % of empty rooms raise an alarm.'
      : `Against the rover’s ${M.label(RK)}: ${more(st.tp - b.tp, 'people found')}, ${more(st.fp - b.fp, 'empty-room alarms')}.`;
    reading.replaceChildren(h('span', null, h('b.num', null, 'At ' + lt), ': ', h('b.num', null, st.fp), ' of ', h('span.num', null, M.nE), ' empty rooms raise an alarm, and ', h('b.num', null, st.still), ' of ', h('span.num', null, M.nS), ' still people are found. ',
      h('b.num', null, st.moving), ' of ', h('span.num', null, M.nM), ' moving people are found.'), h('span.sense-ev-reading-2', null, line2));
    range.setAttribute('aria-valuetext', line1 + ' ' + line2);

    mxTitle.textContent = `At ${lt}: ${st.tn + st.tp} of ${N} windows answered correctly`;
    for (const id of ['tn', 'fp', 'fn', 'tp']) {
      const o = cell[id], d = st[id] - b[id];
      o.n.textContent = st[id];
      o.bar.style.width = (100 * st[id] / (id === 'tn' || id === 'fp' ? M.nE : M.nP)) + '%';
      o.delta.textContent = atRover ? '\u00a0' : (d === 0 ? 'same as at ' : (d > 0 ? '+' : '−') + Math.abs(d) + ' vs ') + M.label(RK);
    }
    acc.replaceChildren('Accuracy ', h('b.num', null, pct(st.tn + st.tp, N)), '. ', ...(st.tp + st.fp ? ['Of its ', h('span.num', null, st.tp + st.fp), ' alarms, ', h('b.num', null, pct(st.tp, st.tp + st.fp)), ' have a person behind them.'] : ['It raises no alarm at all.']));
    for (const o of split) {
      const n = o.arr.length, got = o.getK(st), [lo, hi] = wilson(got, n);
      o.pt.style.left = (100 * got / n) + '%';
      o.wh.style.left = (100 * lo) + '%'; o.wh.style.width = (100 * (hi - lo)) + '%';
      o.val.textContent = pct(got, n);
      o.el.title = `${got} of ${n} windows. 95 % Wilson interval ${(100 * lo).toFixed(1)} to ${(100 * hi).toFixed(1)} %.`;
    }
    rocUpd?.(); tradeUpd?.();
    if (hover >= 0) { hover = -1; tip.hidden = true; }
    invalidate();
  }
  function setK(v) { v = clamp(Math.round(v), 0, 100); if (v === k) return; k = v; update(); }
  function stop() { if (anim) { cancelAnimationFrame(anim); anim = 0; } }
  // Return to the rover's setting: a short eased glide, so the eye can follow what changes back.
  function glide(to) {
    stop();
    if (reducedMotion() || !visible || to === k) { setK(to); range.focus(); return; }
    const from = k, t0 = performance.now(), dur = 200;
    const step = (now) => {
      const u = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - u, 3);
      setK(from + (to - from) * e);
      anim = u < 1 ? requestAnimationFrame(step) : 0;
      if (u >= 1) setK(to);
    };
    anim = requestAnimationFrame(step); range.focus();
  }
  // Arrow keys step 0.01 through the native slider; PageUp / PageDown step 0.10; R returns to the rover's setting.
  range.addEventListener('keydown', (e) => {
    if (e.key === 'PageUp') { setK(k + 10); e.preventDefault(); } else if (e.key === 'PageDown') { setK(k - 10); e.preventDefault(); }
  });
  offs.push(ctx.bus.on('prefs', () => { fontUI = ''; fontNum = ''; requestAnimationFrame(draw); }));
  const applyParams = (p) => { if (p && p.threshold != null && isFinite(+p.threshold)) setK(Math.round(+p.threshold * 100)); };
  update(); applyParams(params);

  return {
    onShow() { visible = true; invalidate(); },
    onHide() { visible = false; stop(); if (raf) { cancelAnimationFrame(raf); raf = 0; } showTip(-1); dragging = false; },
    onParams: applyParams,
  };
}
