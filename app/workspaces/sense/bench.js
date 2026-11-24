// The bench: pick one of the 30 bundled test windows, run the real network on it, look inside, ask what the answer
// depends on (occlusion), and try to break it. Every number here is computed in the page when you see it.
import { signed, clamp, tok, rng, gauss } from './common.js';
import { compile } from './fastnet.js';
import { createAnatomy, STAGES, inputScale } from './anatomy.js';

const MAX_EMPTY = 0.35; // the rover refuses a window when more than 35 % of its time bins are empty (ml/csi_window.py)
const SIT = { 'Empty room': 'Empty room', 'Empty room + fan': 'Empty room with a fan', 'Person moving': 'Person moving', 'Person standing still': 'Person standing still', 'Person lying still': 'Person lying still' };
const f2 = (v) => v.toFixed(2), sgn = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
const secs = (a, b) => `${+a.toFixed(1)} to ${+b.toFixed(1)}`;

export async function create(el, ctx, { params }) {
  const { h, icon, panel, fitCanvas } = ctx.kit, nn = ctx.nn, N = nn.samples.length, THR = nn.threshold;
  // ---- the fast loop, checked against the reference on every bundled window
  let fast = null, fastDiff = 0;
  try { fast = compile(nn.weights); for (let i = 0; i < N; i++) { const a = fast.forward(nn.samples[i].x), b = nn.infer(nn.samples[i].x); fastDiff = Math.max(fastDiff, Math.abs(a.person - b.person), Math.abs(a.moving - b.moving)); } if (!(fastDiff < 1e-9)) fast = null; } catch (e) { fast = null; }
  const argmax = (r) => { let a = 0; for (let t = 1; t < r.length; t++) if (r[t] > r[a]) a = t; return a; };
  const traceOf = (x) => { if (fast) return fast.forward(x, true); const o = nn.infer(x, { trace: true }); o.arg = o.layers.c3.map(argmax); return o; };
  const scoreOf = fast ? (x) => fast.forward(x).person : (x) => nn.infer(x).person;

  const S = { idx: -1, x: null, res: null, pert: { noise: 0, drop: 0, motion: 1, reverse: false, corrupt: false }, runs: new Array(N).fill(null), occ: null, occToken: 0, spot: false, mask: null, hoverSec: null, runningAll: false, visible: false };
  const touched = () => S.pert.noise > 0 || S.pert.drop > 0 || S.pert.motion !== 1 || S.pert.reverse || S.pert.corrupt;

  // =================================================================== left: the 30 windows
  const tiles = [], groupNotes = {};
  const thumb = (x) => { const c = document.createElement('canvas'); c.width = 50; c.height = 30; const g = c.getContext('2d'), img = g.createImageData(50, 30), sc = inputScale(x);
    for (let py = 0; py < 30; py++) for (let px = 0; px < 50; px++) { const r = py < 24 ? Math.floor(py / 24 * 51) : 51, v = (x[r][px * 4] + x[r][px * 4 + 1] + x[r][px * 4 + 2] + x[r][px * 4 + 3]) / 4, col = py === 24 ? [13, 16, 20] : signed(clamp(v / (r === 51 ? Math.max(1, sc) : sc), -1, 1)), k = (py * 50 + px) * 4; img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255; }
    g.putImageData(img, 0, 0); return c; };
  const groups = nn.categories.map((cat) => {
    const note = h('span.sense-grp-note.num', null, '6 windows'); groupNotes[cat] = note;
    return h('div.sense-grp', { role: 'group', 'aria-label': SIT[cat] || cat }, h('div.sense-grp-head', null, h('span', null, cat), note),
      h('div.sense-tiles', null, nn.byCat[cat].map((i, n) => { const mark = h('i.sense-tile-mark'), score = h('span.num', null, '·');
        const b = h('button.sense-tile', { 'aria-label': `${SIT[cat] || cat}, window ${n + 1} of 6`, 'aria-pressed': 'false', 'data-i': i, onclick: () => select(i) }, thumb(nn.samples[i].x), mark, score); tiles[i] = { b, mark, score }; return b; })));
  });
  const browser = h('div.sense-browser', { onkeydown: (e) => { const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 6, ArrowUp: -6 }[e.key]; if (!d || !e.target.dataset?.i) return; e.preventDefault(); const j = clamp(+e.target.dataset.i + d, 0, N - 1); tiles[j].b.focus(); select(j); } }, groups);
  const runBtn = h('button.btn.btn-primary', { onclick: runAll }, icon('play'), h('span', null, 'Run all 30'));
  const conf = h('div.sense-conf');
  const left = panel('30 held-out test windows', {}, h('p.sense-figsub', null, 'Six per situation, from simulated people the network never trained on.'), browser,
    h('div.sense-runrow', null, runBtn), conf);
  left.classList.add('sense-left');

  // =================================================================== centre top: the window
  const spCanvas = h('canvas.sense-spec', { tabIndex: 0, role: 'img', 'aria-label': 'The window: 51 subcarriers over 10 seconds, with the motion row beneath. Left and right arrow keys hide one second at a time, up and down hide three subcarriers, and the network runs again each time.' });
  const spRead = h('div.sense-spec-read'), legend = h('div.sense-legend');
  const spotCheck = h('input', { type: 'checkbox', onchange: (e) => { S.spot = e.target.checked; drawSpec(); } });
  const specPanel = panel('The window the network reads', { actions: [legend, h('label.check.sense-spot', { title: 'Dim every part of the window that the answer does not depend on. From 323 re-runs of the network with one patch hidden each time.' }, spotCheck, 'Spotlight what matters')] }, h('div.sense-spec-wrap', null, spCanvas, spRead));
  specPanel.classList.add('sense-specpanel'); specPanel.body.classList.add('flush');
  const off = document.createElement('canvas'); off.width = 200; off.height = 51;
  let spW = 0, spH = 0, G = null;
  const stopFit = fitCanvas(spCanvas, (c, w, hh) => { spW = w; spH = hh; drawSpec(); });
  function geom() { const L = 62, R = 100, T = 44, B = 22, MH = clamp(spH * 0.2, 30, 56), gap = 12; return { L, R, T, B, MH, x0: L, x1: spW - R, y0: T, y1: spH - B - MH - gap, m0: spH - B - MH, m1: spH - B, px: (t) => L + t / 200 * (spW - R - L) }; }
  function drawSpec() {
    if (!spW || !S.x) return; const c = spCanvas.getContext('2d'), g = G = geom(), x = S.x, sc = S.scale, font = tok('--font');
    c.clearRect(0, 0, spW, spH); const W_ = g.x1 - g.x0, H_ = g.y1 - g.y0, rowH = H_ / 51;
    // heat map
    const o = off.getContext('2d'), img = o.createImageData(200, 51);
    for (let r = 0; r < 51; r++) for (let t = 0; t < 200; t++) { const v = x[r][t], col = Number.isFinite(v) ? signed(clamp(v / sc, -1, 1)) : [255, 77, 94], k = (r * 200 + t) * 4; img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255; }
    if (S.spot && S.occ?.grid) for (let r = 0; r < 51; r++) for (let t = 0; t < 200; t++) { const a = 0.14 + 0.86 * Math.pow(S.occ.grid[r * 200 + t], 0.8), k = (r * 200 + t) * 4; img.data[k] *= a; img.data[k + 1] *= a; img.data[k + 2] *= a; }
    o.putImageData(img, 0, 0); c.imageSmoothingEnabled = false; c.drawImage(off, g.x0, g.y0, W_, H_);
    // motion row
    let mn = 0, mx = 0.5; for (let t = 0; t < 200; t++) { const v = x[51][t]; if (Number.isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); } }
    const my = (v) => g.m1 - (v - mn) / (mx - mn) * g.MH;
    c.fillStyle = tok('--bg-2'); c.fillRect(g.x0, g.m0, W_, g.MH);
    c.beginPath(); c.moveTo(g.x0, my(0)); for (let t = 0; t < 200; t++) { c.lineTo(g.px(t), my(x[51][t])); c.lineTo(g.px(t + 1), my(x[51][t])); } c.lineTo(g.x1, my(0)); c.closePath();
    const spotM = S.spot && S.occ?.gridMotion; c.fillStyle = 'rgba(255, 178, 74, 0.22)'; c.fill();
    c.beginPath(); for (let t = 0; t < 200; t++) { c.lineTo(g.px(t), my(x[51][t])); c.lineTo(g.px(t + 1), my(x[51][t])); } c.strokeStyle = '#ffb24a'; c.lineWidth = 1.25; c.stroke();
    if (spotM) for (let t = 0; t < 200; t++) { c.fillStyle = `rgba(13,16,20,${(0.8 * (1 - Math.pow(S.occ.gridMotion[t], 0.6))).toFixed(3)})`; c.fillRect(g.px(t), g.m0, W_ / 200 + 0.5, g.MH); }
    c.strokeStyle = tok('--line-2'); c.lineWidth = 1; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(g.x0, my(0) + 0.5); c.lineTo(g.x1, my(0) + 0.5); c.stroke(); c.setLineDash([]);
    c.strokeStyle = tok('--line-2'); c.strokeRect(g.x0 - 0.5, g.y0 - 0.5, W_ + 1, H_ + 1); c.strokeRect(g.x0 - 0.5, g.m0 - 0.5, W_ + 1, g.MH + 1);
    // axes
    c.fillStyle = tok('--text-3'); c.font = '11px ' + font; c.textBaseline = 'middle'; c.textAlign = 'right';
    for (const r of [10, 20, 30, 40, 51]) { const yy = g.y0 + (r - 0.5) * rowH; c.fillText(String(r), g.x0 - 8, yy); c.fillRect(g.x0 - 5, Math.round(yy), 4, 1); }
    c.fillText(mx.toFixed(1) + ' %', g.x0 - 8, g.m0 + 5); c.fillText(mn.toFixed(1) + ' %', g.x0 - 8, g.m1 - 5);
    c.save(); c.translate(13, (g.y0 + g.y1) / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillStyle = tok('--text-2'); c.fillText(g.y1 - g.y0 > 150 ? 'Wi-Fi subcarrier (1 to 51)' : 'Subcarrier', 0, 0); c.restore();
    c.save(); c.translate(13, (g.m0 + g.m1) / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillStyle = tok('--text-2'); c.fillText('Motion', 0, 0); c.restore();
    c.textAlign = 'center'; c.textBaseline = 'top'; c.fillStyle = tok('--text-3');
    for (let s = 0; s <= 10; s++) { const xx = g.px(s * 20); c.fillRect(Math.round(xx), g.m1 + 1, 1, 4); c.fillText(s === 10 ? '10 s' : String(s), xx, g.m1 + 8); }
    // saliency strips
    c.textBaseline = 'middle';
    if (S.occ?.time) {
      const pk = Math.max(0.02, S.occ.peakAbs), base = g.y0 - 8, hMax = 20;
      for (let t = 0; t < 200; t++) { const v = S.occ.time[t], bh = Math.abs(v) / pk * hMax; if (v >= 0) { c.fillStyle = tok('--text'); c.fillRect(g.px(t), base - bh, W_ / 200 + 0.4, Math.max(1, bh)); } else { c.fillStyle = tok('--text-3'); c.fillRect(g.px(t), base - bh, W_ / 200 + 0.4, 1.5); } }
      c.fillStyle = tok('--line-2'); c.fillRect(g.x0, base, W_, 1);
      c.textAlign = 'right'; c.fillStyle = tok('--text-2'); c.fillText('Hide 1 s', g.x0 - 8, base - 7);
      { let pi = 0; for (let t = 1; t < 200; t++) if (Math.abs(S.occ.time[t]) > Math.abs(S.occ.time[pi])) pi = t; const v = S.occ.time[pi]; if (Math.abs(v) >= 0.005) { const lx = g.px(pi + 0.5), right = lx < g.x0 + W_ - 60; c.textAlign = right ? 'left' : 'right'; c.fillStyle = tok('--text'); c.textAlign = 'center'; void right; c.fillText(sgn(-v), clamp(lx, g.x0 + 16, g.x1 - 16), base - Math.abs(v) / pk * hMax - 8); } }
      const bx = g.x1 + 8, bw = g.R - 44, bk = Math.max(0.02, S.occ.bandPeak, Math.abs(S.occ.motionDrop));
      for (let r = 0; r < 51; r++) { const v = S.occ.band[r], w = Math.abs(v) / bk * bw; c.fillStyle = v >= 0 ? tok('--text') : tok('--text-3'); c.fillRect(bx, g.y0 + r * rowH, Math.max(1, w), Math.max(1, rowH - 0.6)); }
      const mv = S.occ.motionDrop, mw = Math.abs(mv) / bk * bw; c.fillStyle = mv >= 0 ? tok('--text') : tok('--text-3'); c.fillRect(bx, g.m0 + g.MH / 2 - 5, Math.max(1, mw), 10);
      c.fillStyle = tok('--line-2'); c.fillRect(bx - 1, g.y0, 1, H_); c.fillRect(bx - 1, g.m0, 1, g.MH);
      c.textAlign = 'left'; c.fillStyle = tok('--text-2'); c.fillText('Hide 3 rows', bx, g.y0 - 15);
      { let bi = 0; for (let r = 1; r < 51; r++) if (Math.abs(S.occ.band[r]) > Math.abs(S.occ.band[bi])) bi = r; const v = S.occ.band[bi]; if (Math.abs(v) >= 0.005) { c.fillStyle = tok('--text'); c.fillText(sgn(-v), bx + Math.abs(v) / bk * bw + 6, g.y0 + (bi + 0.5) * rowH); } }
      c.fillStyle = tok('--text-2'); c.fillText(sgn(-mv), bx + Math.max(1, mw) + 6, g.m0 + g.MH / 2);
    } else if (S.occ?.status) { c.textAlign = 'left'; c.fillStyle = tok('--text-3'); c.fillText(S.occ.status, g.x0, g.y0 - 16); }
    // brackets: the seconds the strongest route reads (cream) and the cell under the pointer in the 3-D view (blue)
    const bracket = (sec, col, yy) => { if (!sec) return; c.strokeStyle = col; c.lineWidth = 1.5; const a = g.px(sec[0] * 20), b = g.px(sec[1] * 20); c.beginPath(); c.moveTo(a, yy - 4); c.lineTo(a, yy); c.lineTo(b, yy); c.lineTo(b, yy - 4); c.stroke(); };
    if (S.res?.ok && ana?.analysis?.chains[0]) bracket(ana.analysis.chains[0].sec, '#fff3c4', g.y1 + 6);
    bracket(S.hoverSec, tok('--accent'), g.y1 + 9);
    // the mask under the pointer
    if (S.mask && S.mask.r0 != null) { const ya = g.y0 + S.mask.r0 * rowH, hb = 3 * rowH; c.fillStyle = 'rgba(7,9,12,0.92)'; c.fillRect(g.x0, ya, W_, hb); c.fillStyle = tok('--text'); c.fillRect(g.x0 - 6, Math.round(ya) - 1, W_ + 12, 1); c.fillRect(g.x0 - 6, Math.round(ya + hb), W_ + 12, 1); }
    else if (S.mask) { const a = g.px(S.mask.t0), b = g.px(S.mask.t0 + 20); c.fillStyle = 'rgba(7,9,12,0.78)'; c.fillRect(a, g.y0, b - a, H_); c.fillRect(a, g.m0, b - a, g.MH); c.strokeStyle = tok('--text'); c.lineWidth = 1; c.setLineDash([4, 3]); c.strokeRect(a + 0.5, g.y0 + 0.5, b - a - 1, g.m1 - g.y0 - 1); c.setLineDash([]); }
    if (S.spot && S.occ?.time && !S.occ.grid) { c.textAlign = 'right'; c.fillStyle = tok('--text-2'); c.fillText('Working out the spotlight: hiding 323 patches, one at a time…', g.x1, g.y0 - 16); }
    if (S.spot && S.occ?.flat) { c.textAlign = 'right'; c.fillStyle = tok('--text-2'); c.fillText('Nothing to spotlight: no patch of this window moves the answer by 0.02.', g.x1, g.y0 - 16); }
    if (S.pert.corrupt) { const xx = g.px(40), yy = g.y0 + 7 * rowH; c.strokeStyle = tok('--danger'); c.lineWidth = 2; c.strokeRect(xx - 5, yy - 5, 12, 12); c.fillStyle = tok('--danger'); c.textAlign = 'left'; c.fillText('not a number', xx + 12, yy + 1); }
  }
  // Hide one second (t0) or three subcarriers (r0) and run the network again, there and then.
  function setMask(t0, r0 = null) {
    if ((t0 == null && r0 == null) || !S.res?.ok) { S.mask = null; spRead.hidden = true; drawSpec(); return; }
    const work = S.x.map((r) => Float64Array.from(r));
    if (r0 != null) { r0 = clamp(Math.round(r0), 0, 48); for (let r = r0; r < r0 + 3; r++) work[r].fill(0); t0 = null; } else { t0 = clamp(Math.round(t0), 0, 180); for (const r of work) r.fill(0, t0, t0 + 20); }
    const p = scoreOf(work), p0 = S.res.person, lost = p0 > THR && p <= THR, gained = p0 <= THR && p > THR; S.mask = { t0, r0, p };
    spRead.hidden = false; spRead.replaceChildren(h('span', null, r0 != null ? `Hide subcarriers ${r0 + 1} to ${r0 + 3} and run again:` : `Hide ${secs(t0 / 20, t0 / 20 + 1)} s and run again:`), h('b.num', null, `${f2(p0)} → ${f2(p)}`), h('span.num', null, `(${sgn(p - p0)})`), lost ? h('span.tag.tag-warn', null, 'alarm lost') : gained ? h('span.tag.tag-warn', null, 'alarm raised') : '');
    if (G) spRead.style.left = clamp(r0 != null ? (G.x0 + G.x1) / 2 : G.px(t0 + 10), 190, spW - 200) + 'px';
    drawSpec();
  }
  spCanvas.addEventListener('pointermove', (e) => { if (!G) return; const r = spCanvas.getBoundingClientRect(), xx = e.clientX - r.left, yy = e.clientY - r.top; if (xx > G.x1 && xx < spW - 4 && yy >= G.y0 && yy <= G.y1) { const r0 = clamp(Math.floor((yy - G.y0) / (G.y1 - G.y0) * 51) - 1, 0, 48); if (!S.mask || S.mask.r0 !== r0) setMask(null, r0); return; } if (xx < G.x0 || xx > G.x1 || yy < G.y0 || yy > G.m1) { if (S.mask) setMask(null); return; } const t0 = Math.round(((xx - G.x0) / (G.x1 - G.x0) * 200 - 10) / 2) * 2; if (!S.mask || S.mask.t0 !== clamp(t0, 0, 180)) setMask(t0); });
  spCanvas.addEventListener('pointerleave', () => setMask(null));
  spCanvas.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setMask((S.mask?.t0 ?? 85) + (e.key === 'ArrowRight' ? 5 : -5)); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMask(null, (S.mask?.r0 ?? 24) + (e.key === 'ArrowDown' ? 1 : -1)); } else if (e.key === 'Escape') setMask(null); });
  spCanvas.addEventListener('blur', () => setMask(null));

  // =================================================================== centre bottom: inside the network
  const anaHost = h('div.sense-ana');
  const playBtn = h('button.btn.btn-icon', { 'aria-label': 'Play the window through the network', onclick: () => { if (ana.playing) ana.pause(); else ana.play(ana.stage >= 9 ? 0 : null); } }, icon('play'));
  const scrub = h('input.sense-scrub', { type: 'range', min: 0, max: 9, step: 0.01, value: 9, 'aria-label': 'Position in the network, from the window (0) to the answer (9)', oninput: (e) => { const v = +e.target.value; ana.pause(); ana.setStage(v); } });
  const stageBtns = STAGES.map((st, k) => h('button', { title: st.name, onclick: () => { ana.pause(); ana.setStage(k + 1); } }, st.short));
  const caption = h('p.sense-ana-caption'), route = h('p.sense-ana-route');
  const modeSeg = h('div.seg', { role: 'group', 'aria-label': 'How to draw the network' }, ['3d', 'flat'].map((m) => h('button', { 'data-m': m, 'aria-pressed': 'false', onclick: () => setMode(m) }, m === '3d' ? '3-D' : 'Flat')));
  const resetBtn = h('button.btn.btn-sm.btn-ghost', { onclick: () => ana.resetView(), title: 'Put the camera back' }, 'Reset view');
  const anaPanel = panel('Inside the network', { actions: [h('span.sense-figsub.sense-ana-hint', null, 'Bars are real activations. Drag to orbit, point at a cell to see what it reads.'), resetBtn, modeSeg] },
    anaHost, h('div.sense-ana-ctl', null, playBtn, h('div.sense-scrubwrap', null, h('div.sense-stages', null, stageBtns), scrub)), h('div.sense-ana-text', null, caption, route));
  anaPanel.classList.add('sense-anapanel'); anaPanel.body.classList.add('flush');
  const ana = await createAnatomy(anaHost, ctx, {
    onStage(s) { scrub.value = s; const k = Math.min(8, Math.max(0, Math.ceil(s) - 1)); stageBtns.forEach((b, i) => b.setAttribute('aria-current', i === k ? 'step' : 'false')); caption.textContent = S.res && !S.res.ok ? 'The window was refused before the first layer. A refused window gives no answer; it is never guessed.' : STAGES[k].say; playBtn.replaceChildren(icon(ana?.playing ? 'pause' : 'play')); playBtn.setAttribute('aria-label', ana?.playing ? 'Pause' : 'Play the window through the network'); },
    onHover(info) { S.hoverSec = info?.sec || null; drawSpec(); },
  });
  function setMode(m) { const got = ana.setMode(m); modeSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === got))); resetBtn.hidden = got !== '3d'; if (m === '3d' && got !== '3d') ctx.shell.toast('This browser has no WebGL, so the network is drawn flat.', { level: 'info' }); }
  setMode(ana.webgl ? '3d' : 'flat');

  // =================================================================== right: the answer, why, try it
  const ans = h('div.sense-ans'), why = h('div.sense-dep'), tryBox = h('div.sense-try');
  const ansPanel = panel('The answer', { tag: ctx.kit.realityTag('live-ai') }, ans), whyPanel = panel('What the answer depends on', { actions: [h('button.btn.btn-sm.btn-ghost', { 'aria-expanded': 'false', onclick: (e) => { S.how = !S.how; e.currentTarget.setAttribute('aria-expanded', String(S.how)); renderWhy(); } }, 'How?')] }, why), tryPanel = panel('Try to break it', { actions: [h('button.btn.btn-sm.btn-ghost', { onclick: resetPert }, 'Reset')] }, tryBox);
  ansPanel.classList.add('sense-anspanel'); tryPanel.classList.add('sense-trypanel');
  const meter = (label, v, tick, tickLabel, on, cls) => h('div.sense-meter' + (on ? '' : '.off'), null, h('div.sense-meter-top', null, h('span', null, label), h('b.num', null, v == null ? '–' : v.toFixed(3))),
    h('div.sense-meter-track', null, h('i' + (cls ? '.' + cls : ''), { style: { width: (v == null ? 0 : v * 100) + '%' } }), h('u', { style: { left: tick * 100 + '%' } })), h('div.sense-meter-sub', { style: { paddingLeft: `calc(${tick * 100}% - 4px)` } }, tickLabel));
  function renderAnswer() {
    const r = S.res, s = nn.samples[S.idx]; if (!r) return;
    const truth = s.person ? `${SIT[s.cat]}, ${s.depth.toFixed(1)} m behind the wall` : SIT[s.cat];
    if (!r.ok) {
      ans.replaceChildren(h('div.sense-say.refused', null, h('span', null, 'The network'), h('b', null, 'Refused')), h('div.note.danger', { role: 'alert' }, icon('alert'), h('span', null, r.reason + ' No answer is given. On the rover the reading is skipped and repeated, never guessed.')),
        h('div.sense-receipt', null, h('p', null, h('span', null, 'Truth (simulator)'), h('b', null, truth))));
      return;
    }
    const says = r.person > THR, right = says === !!s.person;
    const verdict = says && s.person ? ['ok', 'check', 'Right.', 'A person is there and the alarm is raised.'] : !says && !s.person ? ['ok', 'check', 'Right.', 'The room is empty and the network stays quiet.']
      : says ? ['danger', 'alert', 'False alarm.', 'The room is empty. In simulation this happens in 11 % of empty rooms.'] : ['danger', 'alert', 'Missed.', s.cat === 'Person moving' ? 'A moving person was there. In simulation 13 % of moving people are missed.' : 'A still person was there. This is the weak case: in simulation only 21 % of still people are found.'];
    ans.replaceChildren(
      h('div.sense-say' + (says ? '.person' : ''), null, h('span', null, 'The network says'), h('b', null, says ? 'Person' : 'No one'), says ? h('em', null, r.moving > 0.5 ? 'moving' : 'still') : null),
      meter('Person score', r.person, THR, `alarm above ${THR.toFixed(2)}`, true, says ? 'person' : ''), meter('Moving score', r.moving, 0.5, says ? 'moving above 0.50' : 'only read after an alarm', says, ''),
      h('div.sense-verdict.' + verdict[0], null, icon(verdict[1], 18), h('p', null, h('b', null, verdict[2] + ' '), verdict[3], touched() ? ' (Truth is for the untouched window.)' : '')),
      h('div.sense-receipt', null,
        h('p', null, h('span', null, 'Truth (simulator)'), h('b', null, truth)),
        h('p', null, h('span', null, 'This reading'), h('b.num', null, `${r.ms.toFixed(1)} ms`), h('span', null, 'median of 3 runs here')),
        touched() ? h('p', null, h('span', null, 'Untouched window'), h('b.num', null, S.runs[S.idx].person.toFixed(3)), h('span.num', null, `now ${sgn(r.person - S.runs[S.idx].person)}`))
          : h('p.sense-receipt-row', null, h('span', null, 'Browser'), h('b.num', null, r.person.toFixed(4)), h('span', null, 'Python'), h('b.num', null, s.ref[0].toFixed(4)), r.match ? h('span.tag.tag-ok', null, 'Match') : h('span.tag.tag-danger', null, 'Differ'))));
  }
  function renderWhy() {
    const o = S.occ, r = S.res;
    if (!r?.ok) { why.replaceChildren(h('p.muted', null, 'There is no answer to explain: the window was refused.')); return; }
    if (!o?.time) { why.replaceChildren(h('div.sense-dep-busy', null, h('div.bar', null, h('i', { style: { width: ((o?.progress || 0) * 100) + '%' } })), h('p.muted', null, 'Hiding parts of the window and running the network again…'))); return; }
    why.replaceChildren(h('p.sense-dep-main', null, o.sentence), h('p.sense-dep-2', null, o.second),
      h('p.sense-figsub.sense-dep-how', { hidden: !S.how }, `Worked out just now from ${o.passes} runs of the real network, each with one part of the window replaced by a flat, quiet signal. The white bars around the window show the drop for each part. Move over the window to hide any second yourself.`));
  }
  const sliders = {};
  const slider = (key, label, min, max, step, fmtv, mark) => { const out = h('b.num'), inp = h('input', { type: 'range', min, max, step, value: S.pert[key], 'aria-label': label, oninput: (e) => { S.pert[key] = +e.target.value; out.textContent = fmtv(S.pert[key]); evaluate({ quick: true }); } }); out.textContent = fmtv(S.pert[key]); sliders[key] = { inp, out, fmtv }; return h('label.sense-slider', null, h('span.sense-slider-top', null, h('span', null, label), out), inp, mark ? h('span.sense-mark', { style: { left: `calc(6px + (100% - 12px) * ${(mark[0] - min) / (max - min)})` }, title: mark[2] }, mark[1]) : null); };
  const checks = {}; const check = (key, label, hint) => { const inp = h('input', { type: 'checkbox', onchange: (e) => { S.pert[key] = e.target.checked; evaluate({ quick: true }); } }); checks[key] = inp; return h('label.check.sense-check', { title: hint }, inp, h('span', null, label)); };
  tryBox.append(
    slider('noise', 'Add noise to every subcarrier', 0, 3, 0.05, (v) => v.toFixed(2) + ' %', [0.5, 'the ESP32’s own noise, about 0.5 %', 'From the rover project: the receiver’s own noise is about 0.5 % per bin.']),
    slider('drop', 'Lose packets: empty time bins', 0, 0.6, 0.01, (v) => (v * 100).toFixed(0) + ' %', [0.35, 'refused above 35 %', 'An empty bin holds the last value. Above 35 % empty bins the rover refuses the window.']),
    slider('motion', 'Scale the motion row', 0, 3, 0.05, (v) => '× ' + v.toFixed(2), null),
    h('div.sense-checks', null, check('reverse', 'Play it backwards', 'Training also used reversed windows, so the answer should hardly move.'), check('corrupt', 'Corrupt one value', 'Puts a not-a-number into subcarrier 8 at 2.0 s. The network must refuse it.')));
  function resetPert(silent) { Object.assign(S.pert, { noise: 0, drop: 0, motion: 1, reverse: false, corrupt: false }); for (const k in sliders) { sliders[k].inp.value = S.pert[k]; sliders[k].out.textContent = sliders[k].fmtv(S.pert[k]); } for (const k in checks) checks[k].checked = false; if (silent !== true) evaluate({ quick: true }); }
  function perturbed() {
    const p = S.pert, x = nn.samples[S.idx].x.map((r) => Float64Array.from(r)); let empty = 0;
    if (p.reverse) for (const r of x) r.reverse();
    if (p.motion !== 1) for (let t = 0; t < 200; t++) x[51][t] *= p.motion;
    if (p.noise > 0) { const rnd = rng(S.idx * 7919 + 11); for (let r = 0; r < 51; r++) for (let t = 0; t < 200; t++) x[r][t] += gauss(rnd) * p.noise; }
    if (p.drop > 0) { // exactly this share of the 200 bins, the same bins every time for this window
      const rnd = rng(S.idx * 104729 + 5), order = Array.from({ length: 199 }, (_, i) => [rnd(), i + 1]).sort((a, b) => a[0] - b[0]), gone = new Uint8Array(200); empty = Math.min(199, Math.round(p.drop * 200));
      for (let i = 0; i < empty; i++) gone[order[i][1]] = 1; for (let t = 1; t < 200; t++) if (gone[t]) for (let r = 0; r < 52; r++) x[r][t] = x[r][t - 1]; }
    if (p.corrupt) x[7][40] = NaN;
    return { x, empty: empty / 200 };
  }

  // =================================================================== running the network
  function infer(x, emptyFrac = 0) { // the reference network with the simulator's two guards
    if (emptyFrac > MAX_EMPTY) return { ok: false, reason: `Wi-Fi window rejected: ${(emptyFrac * 100).toFixed(0)} % of its time bins are empty (limit 35 %).` };
    try { const ts = []; let out; for (let k = 0; k < 3; k++) { const t0 = performance.now(); out = nn.infer(x); ts.push(performance.now() - t0); } ts.sort((a, b) => a - b); return { ok: true, person: out.person, moving: out.moving, ms: ts[1] }; }
    catch (e) { return { ok: false, reason: 'Wi-Fi window rejected: ' + String(e.message || e).replace(/^The Wi-Fi window/, 'it').replace(/^A Wi-Fi window/, 'it') }; }
  }
  function record(i) { const s = nn.samples[i], r = infer(s.x); r.match = Math.abs(r.person - s.ref[0]) < 0.01 && Math.abs(r.moving - s.ref[1]) < 0.01; r.says = r.person > THR; r.right = r.says === !!s.person; S.runs[i] = r;
    const t = tiles[i]; t.b.classList.add('ran'); t.b.classList.toggle('right', r.right); t.b.classList.toggle('wrong', !r.right); t.b.classList.toggle('alarm', r.says); t.mark.replaceChildren(icon(r.right ? 'check' : 'close', 11)); t.score.textContent = r.person.toFixed(2);
    t.b.setAttribute('aria-label', `${SIT[s.cat]}: score ${r.person.toFixed(2)}, ${r.says ? 'person' : 'no one'}, ${r.right ? 'right' : 'wrong'}`); return r; }
  function renderConf() {
    const done = S.runs.map((r, i) => (r ? i : -1)).filter((i) => i >= 0), n = done.length; let a = 0, b = 0, c = 0, d = 0, match = 0;
    for (const i of done) { const r = S.runs[i], p = nn.samples[i].person; if (!p && !r.says) a++; else if (!p) b++; else if (!r.says) c++; else d++; if (r.match) match++; }
    for (const cat of nn.categories) { const ids = nn.byCat[cat].filter((i) => S.runs[i]); groupNotes[cat].textContent = ids.length ? `${ids.filter((i) => S.runs[i].right).length} of ${ids.length} right` : '6 windows'; }
    const cell = (v, cls, lab) => h('td.num' + (cls ? '.' + cls : ''), { title: lab }, n ? String(v) : '–');
    conf.replaceChildren(
      h('table.sense-cm', { 'aria-label': 'Confusion table for the windows run so far' }, h('thead', null, h('tr', null, h('th'), h('th', null, 'said no one'), h('th', null, 'said person'))),
        h('tbody', null, h('tr', null, h('th', null, 'Empty room'), cell(a, 'good', 'Empty rooms called empty'), cell(b, b ? 'bad' : '', 'False alarms')), h('tr', null, h('th', null, 'Person'), cell(c, c ? 'bad' : '', 'People missed'), cell(d, 'good', 'People found')))),
      h('p.sense-conf-line', null, n ? [h('b.num', null, `${a + d} of ${n}`), ' right so far. ', h('b.num', null, `${match} of ${n}`), ' match the Python reference.'] : 'Nothing run yet. Run all 30 to fill this table.'),
      n === N ? h('p.sense-figsub', null, 'It misses most still people, as the full test predicts. ', h('a', { href: '#/sense', onclick: (e) => { e.preventDefault(); ctx.shell.open('sense', { view: 'test' }); } }, 'See all 955 windows')) : '');
  }
  async function runAll() {
    if (S.runningAll) return; S.runningAll = true; runBtn.disabled = true; const label = runBtn.querySelector('span'), slow = !ctx.kit.reducedMotion();
    for (let i = 0; i < N; i++) { record(i); tiles[i].b.classList.add('flash'); label.textContent = `Running ${i + 1} of 30`; renderConf(); if (slow) await new Promise((r) => setTimeout(r, 45)); }
    setTimeout(() => tiles.forEach((t) => t.b.classList.remove('flash')), 400);
    S.runningAll = false; runBtn.disabled = false; label.textContent = 'Run all 30 again';
    const right = S.runs.filter((r) => r.right).length, match = S.runs.filter((r) => r.match).length;
    ctx.shell.toast(`All 30 run: ${right} right, ${match} of 30 match the Python reference.`, { level: match === N ? 'ok' : 'alert' });
  }
  function select(i, { play = true } = {}) {
    if (!Number.isInteger(i) || i < 0 || i >= N) { ctx.shell.toast(`There is no test window ${i}. Showing the first one.`, { level: 'alert' }); i = 0; }
    if (S.idx === i && !touched()) return;
    S.idx = i; resetPert(true); tiles.forEach((t, k) => t.b.setAttribute('aria-pressed', String(k === i)));
    record(i); renderConf(); evaluate({ play });
  }
  let occTimer = 0;
  function evaluate({ quick = false, play = false } = {}) {
    const s = nn.samples[S.idx], isT = touched(), pr = isT ? perturbed() : { x: s.x, empty: 0 };
    S.x = pr.x; S.scale = inputScale(s.x); S.mask = null; spRead.hidden = true;
    const r = isT ? infer(pr.x, pr.empty) : { ...S.runs[S.idx] }; r.match = !isT && S.runs[S.idx].match; S.res = r;
    const out = r.ok ? traceOf(pr.x) : null;
    ana.setData({ x: pr.x, out, reason: r.reason, threshold: THR, weights: nn.weights, scale: S.scale });
    if (play && S.visible) ana.play(1); else ana.setStage(r.ok ? (quick ? ana.stage : 9) : 1);
    const c0 = ana.analysis?.chains[0];
    route.replaceChildren(...(c0 ? [h('b', null, 'Strongest route to the person answer: '), `filter ${c0.ch + 1}’s ${c0.kind === 'max' ? 'highest peak' : 'average'}, which reads ${secs(c0.sec[0], c0.sec[1])} s of the window, through dense unit ${c0.j + 1}. It pushes the answer ${c0.v >= 0 ? 'up' : 'down'} by ${Math.abs(c0.v).toFixed(2)} (log-odds).`] : []));
    legend.replaceChildren(h('span.num', null, `−${S.scale.toFixed(1)} %`), h('i', { style: { background: `linear-gradient(90deg, ${[-1, -0.75, -0.35, 0, 0.35, 0.75, 1].map((v) => { const c = signed(v); return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }).join(',')})` } }), h('span.num', null, `+${S.scale.toFixed(1)} %`), h('span', null, 'change from each subcarrier’s average'));
    renderAnswer(); S.occ = null; const token = ++S.occToken; clearTimeout(occTimer); renderWhy(); drawSpec();
    if (r.ok) occTimer = setTimeout(() => explain(pr.x, r.person, token), quick ? 260 : 30);
  }

  // =================================================================== explanation by occlusion
  async function explain(x, p0, token) {
    const work = x.map((r) => Float64Array.from(r)), stale = () => token !== S.occToken;
    const total = 37 + 49 + 2; let passes = 0, lastYield = performance.now(), phase2 = false;
    const tick = async () => { passes++; if (performance.now() - lastYield > 28) { if (!phase2) { S.occ = { progress: passes / total, status: 'Working out what the answer depends on…' }; renderWhy(); } await new Promise((r) => setTimeout(r, 0)); lastYield = performance.now(); } };
    const hide = (r0, r1, t0, t1) => { const saved = []; for (let r = r0; r <= r1; r++) { saved.push(work[r].slice(t0, t1)); work[r].fill(0, t0, t1); } const p = scoreOf(work); for (let r = r0; r <= r1; r++) work[r].set(saved[r - r0], t0); return p0 - p; };
    const tSum = new Float64Array(200), tCnt = new Float64Array(200), tMasks = [];
    for (let t0 = 0; t0 <= 180; t0 += 5) { const d = hide(0, 51, t0, t0 + 20); tMasks.push({ t0, d }); for (let t = t0; t < t0 + 20; t++) { tSum[t] += d; tCnt[t]++; } await tick(); if (stale()) return; }
    const time = Float64Array.from(tSum, (v, i) => v / tCnt[i]);
    const bSum = new Float64Array(51), bCnt = new Float64Array(51); let bandBest = { d: 0, r: 0 };
    for (let r0 = 0; r0 <= 48; r0++) { const d = hide(r0, r0 + 2, 0, 200); if (Math.abs(d) > Math.abs(bandBest.d)) bandBest = { d, r: r0 }; for (let r = r0; r < r0 + 3; r++) { bSum[r] += d; bCnt[r]++; } await tick(); if (stale()) return; }
    const band = Float64Array.from(bSum, (v, i) => v / bCnt[i]);
    const motionDrop = hide(51, 51, 0, 200), subDrop = hide(0, 50, 0, 200); passes += 2;
    if (stale()) return;
    // ---- the plain-words reading
    const best = tMasks.reduce((a, b) => (Math.abs(b.d) > Math.abs(a.d) ? b : a)), peakAbs = Math.abs(best.d), bandPeak = Math.max(...Array.from(band, Math.abs));
    let pk = 0; for (let t = 1; t < 200; t++) if (Math.abs(time[t]) > Math.abs(time[pk])) pk = t;
    let a = pk, b = pk; const cut = Math.abs(time[pk]) * 0.6, sg = Math.sign(time[pk]); while (a > 0 && time[a - 1] * sg >= cut) a--; while (b < 199 && time[b + 1] * sg >= cut) b++;
    const sa = a / 20, sb = (b + 1) / 20, mean = (f, lo, hi) => { let s = 0, n = 0; for (let t = 0; t < 200; t++) if ((t >= lo && t <= hi) === true) { s += f(t); n++; } return n ? s / n : 0; }, meanOut = (f, lo, hi) => { let s = 0, n = 0; for (let t = 0; t < 200; t++) if (t < lo || t > hi) { s += f(t); n++; } return n ? s / n : 0; };
    const mIn = mean((t) => x[51][t], a, b), mOut = meanOut((t) => x[51][t], a, b), amp = (t) => { let s = 0; for (let r = 0; r < 51; r++) s += Math.abs(x[r][t]); return s / 51; }, aIn = mean(amp, a, b), aOut = meanOut(amp, a, b);
    let msd = 0; { const mAll = mean((t) => x[51][t], 0, 199); for (let t = 0; t < 200; t++) msd += (x[51][t] - mAll) ** 2; msd = Math.sqrt(msd / 200); }
    const where = b - a >= 195 ? '' : mIn - mOut > Math.max(0.1, 0.5 * msd) ? ', where the motion row rises' : mOut - mIn > Math.max(0.1, 0.5 * msd) ? ', where the motion row is at its quietest' : aIn > aOut * 1.25 ? ', where the subcarriers swing most' : aIn < aOut * 0.8 ? ', where the subcarriers are calmest' : '';
    const flips = (best.d > 0 && p0 > THR && p0 - best.d <= THR) || (best.d < 0 && p0 <= THR && p0 - best.d > THR);
    let sentence, second;
    if (peakAbs < 0.02 && Math.abs(motionDrop) < 0.02 && bandPeak < 0.02) {
      sentence = p0 > 0.98 ? `The answer is pinned at ${f2(p0)}. Hiding any one second, any three subcarriers or the whole motion row moves it by less than 0.02: the evidence is everywhere in this window.`
        : `No single part carries this answer. Hiding any one second, any three subcarriers or the whole motion row moves it by less than 0.02.`;
    } else if (peakAbs < 0.02) { sentence = `No single second matters: hiding any one moves the answer by less than 0.02. The answer rests on the whole window.`; }
    else if (best.d > 0) sentence = `The answer depends most on seconds ${secs(sa, sb)}${where}. Hiding one second there lowers it from ${f2(p0)} to ${f2(p0 - best.d)}${flips ? ', enough to lose the alarm' : ''}.`;
    else sentence = `Seconds ${secs(sa, sb)}${where} argue against a person. Hiding one second there raises the answer from ${f2(p0)} to ${f2(p0 - best.d)}${flips ? ', enough to raise the alarm' : ''}.`;
    const lean = Math.abs(motionDrop) > 2 * Math.abs(subDrop) && Math.abs(motionDrop) > 0.02 ? 'It is reading mostly the motion row.' : Math.abs(subDrop) > 2 * Math.abs(motionDrop) && Math.abs(subDrop) > 0.02 ? 'It is reading mostly the subcarriers.' : Math.abs(subDrop) > 0.02 ? 'It is reading both.' : '';
    second = `Without the motion row: ${f2(p0 - motionDrop)} (${sgn(-motionDrop)}). Without the 51 subcarriers: ${f2(p0 - subDrop)} (${sgn(-subDrop)}). ${lean}`;
    if (stale()) return;
    const occ = S.occ = { time, band, motionDrop, subDrop, grid: null, gridMotion: null, flat: false, peakAbs: Math.max(...Array.from(time, Math.abs)), bandPeak, sentence, second, passes };
    renderWhy(); drawSpec();
    // second pass, for the spotlight: 323 patches (1 s by 6 subcarriers, and 1 s of the motion row)
    phase2 = true;
    const gSum = new Float64Array(51 * 200), gCnt = new Float64Array(51 * 200), mSum = new Float64Array(200), mCnt = new Float64Array(200);
    for (let t0 = 0; t0 <= 180; t0 += 10) {
      for (let r0 = 0; r0 <= 45; r0 += 3) { const d = Math.abs(hide(r0, r0 + 5, t0, t0 + 20)); for (let r = r0; r < r0 + 6; r++) for (let t = t0; t < t0 + 20; t++) { gSum[r * 200 + t] += d; gCnt[r * 200 + t]++; } await tick(); if (stale()) return; }
      const d = Math.abs(hide(51, 51, t0, t0 + 20)); for (let t = t0; t < t0 + 20; t++) { mSum[t] += d; mCnt[t]++; } await tick(); if (stale()) return;
    }
    let gMax = 1e-6; const grid = new Float32Array(51 * 200), gridMotion = new Float32Array(200);
    for (let i = 0; i < grid.length; i++) { grid[i] = gSum[i] / gCnt[i]; if (grid[i] > gMax) gMax = grid[i]; } for (let t = 0; t < 200; t++) { gridMotion[t] = mSum[t] / mCnt[t]; if (gridMotion[t] > gMax) gMax = gridMotion[t]; }
    // brightness is relative to the 90th percentile of the patches, so the picture is not ruled by one cell
    const sorted = Float32Array.from(grid).sort(), ref = Math.max(sorted[Math.floor(sorted.length * 0.9)], gMax * 0.25);
    const flat_ = gMax < 0.02; for (let i = 0; i < grid.length; i++) grid[i] = flat_ ? 1 : Math.min(1, grid[i] / ref); for (let t = 0; t < 200; t++) gridMotion[t] = flat_ ? 1 : Math.min(1, gridMotion[t] / ref);
    if (stale()) return;
    Object.assign(occ, { grid, gridMotion, flat: flat_, passes }); renderWhy(); drawSpec();
  }

  // =================================================================== assemble
  el.append(h('div.sense-bench', null, left, h('div.sense-centre', null, specPanel, anaPanel), h('div.sense-right', null, ansPanel, whyPanel, tryPanel)));
  left.body.append(h('p.sense-figsub.sense-foot', null, fast ? `Explanation re-runs use a faster loop over the same weights, checked against the reference on all 30 windows (largest difference ${fastDiff === 0 ? '0' : fastDiff.toExponential(0)}).` : 'Explanation re-runs use the reference network.'));
  renderConf();
  const startIdx = Number.isInteger(+params.sample) && params.sample != null && params.sample !== '' ? +params.sample : nn.byCat['Person moving']?.[2] ?? 0;
  select(startIdx, { play: false });
  const offPrefs = ctx.bus.on('prefs', () => setTimeout(() => { drawSpec(); ana.setStage(ana.stage, { silent: true }); }, 0));
  void stopFit; void offPrefs;
  return {
    onShow() { S.visible = true; ana.start(); drawSpec(); },
    onHide() { S.visible = false; ana.stop(); setMask(null); },
    onParams(p) { if (p.sample != null && p.sample !== '') { const i = +p.sample; S.idx = -1; select(Number.isInteger(i) ? i : -1); tiles[S.idx]?.b.scrollIntoView({ block: 'nearest' }); } },
  };
}
