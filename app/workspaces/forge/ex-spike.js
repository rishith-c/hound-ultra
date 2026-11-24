// Exhibit 5. A spiking version: the trained network converted to integrate-and-fire neurons, run in the page.
import { A, createNet, decodeWindow, softmax2 } from './lib/net.js';
import { createSNN } from './lib/snn.js';
import { tok, pct, fmtInt, plotter, paintWindow, decodeToFloat, src, fig, honest, method, sources, block, seg, KIND } from './lib/ui.js';

export async function create(el, env) {
  const { ctx, doc } = env, { h, icon, realityTag } = ctx.kit;
  const S = doc.snn, bte = doc.bundle.test, thr = doc.bundle.models.messy.threshold, W = doc.W.messy;
  if (!S) { el.append(h('div.empty', null, icon('clock', 28), h('h3', null, 'The spiking measurements are still being made'), h('p.muted', null, 'tools/forge_export.py --only snn writes them. Reload when it has finished.'))); return {}; }
  const net = createNet(), snn = createSNN(W, S.lambda), x = new Float32Array(A.N_IN), xf = new Float32Array(A.N_IN);
  const byK = [0, 1, 2].map((k) => bte.kind.map((v, i) => (v === k ? i : -1)).filter((i) => i >= 0));
  let kind = 2, pos = 0, Tmax = 128, t = 0, trace = [], raf = 0, visible = false, annP = 0, codes = null;
  const BANDS = [{ name: 'hidden layer, 32 neurons', n: 32, rows: 96, src: () => snn.s4, c: [255, 178, 74] }, { name: 'conv 3, 288 neurons', n: 288, rows: 288, src: () => snn.s3, c: [214, 233, 255] }, { name: 'conv 2, 960 neurons (4 per row)', n: 960, rows: 240, src: () => snn.s2, c: [134, 192, 255] }];
  const RH = BANDS.reduce((a, b) => a + b.rows + 6, 0);
  const raster = h('canvas.forge-px.forge-raster', { role: 'img', 'aria-label': 'Spike raster: each dot is one neuron firing at one time step.' }), winCv = h('canvas.forge-px.forge-win');
  let img = null;
  const settleCv = h('canvas.forge-plot'), settle = plotter(settleCv, { l: 40 }), agreeCv = h('canvas.forge-plot'), agree = plotter(agreeCv, { l: 40 }), workCv = h('canvas.forge-plot'), work = plotter(workCv, { l: 46 });
  const verdict = h('div.forge-live-sum', { role: 'status', 'aria-live': 'polite' });
  const rateEls = ['conv 1', 'conv 2', 'conv 3', 'hidden'].map((n) => { const b = h('b.num', null, '…'); return { el: h('div', null, b, h('span', null, n + ', spikes per neuron per step')), b }; });
  const sFig = fig('…', '', 'synaptic events so far, this window', null, 'page', 'sm'), stepFig = fig('0', '', 'time step', null, 'page', 'sm');
  const kSeg = seg('Kind of window', KIND.map((k, i) => [i, k]), kind, (v) => { kind = +v; pos = 0; load(); });
  const tSeg = seg('Time steps', [[64, '64'], [128, '128'], [256, '256']], Tmax, (v) => { Tmax = +v; load(); });
  const label = h('span.forge-win-cap');
  const nav = h('div.btn-group', null, h('button.btn.btn-sm.btn-icon', { 'aria-label': 'Previous window', onclick: () => { pos = (pos - 1 + byK[kind].length) % byK[kind].length; load(); } }, icon('chevron-left')), h('button.btn.btn-sm.btn-icon', { 'aria-label': 'Next window', onclick: () => { pos = (pos + 1) % byK[kind].length; load(); } }, icon('chevron')));
  const again = h('button.btn.btn-primary', { onclick: () => load() }, icon('bolt'), 'Fire again');

  const r64 = S.rows.find((r) => r.T === 64), rBest = S.rows.reduce((a, b) => (b.agree > a.agree ? b : a)), r95 = S.rows.find((r) => r.agree >= 0.95), rest = S.ann.macs_rest;
  const finding = r95
    ? ['The spiking copy needs ', h('b.num', null, String(r95.T)), ' time steps to give the same answer as the ordinary network on 95 % of test windows. By then it has made ', h('b.num', null, fmtInt(r95.synops)), ' synaptic events, ', h('b.num', null, (r95.synops / rest).toFixed(1) + '×'), ' the ', fmtInt(rest), ' multiply-adds of the layers it replaces. ', h('b', null, r95.synops > rest ? 'On this count it does more work, not less.' : 'On this count it does less work.')]
    : ['Even after ', h('b.num', null, String(rBest.T)), ' time steps the spiking copy agrees with the ordinary network on only ', h('b.num', null, pct(rBest.agree)), ' of test windows, and by then it has made ', h('b.num', null, fmtInt(rBest.synops)), ' synaptic events against ', fmtInt(rest), ' multiply-adds for the layers it replaces (', h('b.num', null, (rBest.synops / rest).toFixed(1) + '×'), '). ', h('b', null, 'On this network, converted this way, spiking is worse on both counts.')];

  el.append(h('div.forge-ex', null,
    h('header.forge-ex-head', null, h('div', null, h('h2', null, 'A spiking version'),
      h('p', null, 'Brains do not multiply; neurons add up what arrives and fire when full. Here the trained network is rebuilt from such neurons, where a firing rate stands in for each number, to ask the question neuromorphic chips pose: is it the same answer for less work?')),
      h('div.forge-ex-tags', null, realityTag('live-algo'), realityTag('concept'))),
    h('div.forge-grid.forge-spike', null,
      block('Spikes, one window, live', src('page', 'simulated here, step by step'),
        h('div.row.wrap', null, kSeg, nav, label, h('span.grow'), h('span.forge-p', null, 'Steps'), tSeg, again),
        h('figure.forge-spike-in', null, winCv, h('figcaption', null, 'Input: 10 s of Wi-Fi, 51 subcarriers and the motion row. It enters as a steady current, not as spikes.')),
        h('div.forge-raster-wrap.crop', null, raster, h('div.forge-raster-labels', { 'aria-hidden': 'true' }, BANDS.map((b, i) => h('span', { style: { top: (100 * (BANDS.slice(0, i).reduce((a, q) => a + q.rows + 6, 0)) / RH) + '%' } }, b.name)))),
        h('div.forge-figs', null, stepFig, sFig), h('div.forge-readouts.four', null, rateEls.map((r) => r.el))),
      h('div.forge-col', null,
        block('The answer settles as spikes are counted', null, h('div.forge-plot-wrap.short', null, settleCv), verdict),
        block('Agreement with the ordinary network, against time steps', src('py', 'all 955 test windows'), h('div.forge-plot-wrap.short', null, agreeCv)),
        block('The work it takes', src('py', 'mean over 955 test windows'), h('div.forge-plot-wrap.short', null, workCv), h('p.forge-p', null, ...finding)))),
    h('footer.forge-ex-foot', null,
      honest('The promise of spiking hardware is energy, and energy is exactly what a browser cannot measure: a synaptic event on a neuromorphic chip costs far less than a multiply on a microcontroller, by an amount that depends on the chip. HOUND has no such chip. Counted in operations, the honest result here is above; a network trained as a spiking network from the start, not converted, might do better, and that has not been tried.'),
      method('Conversion without retraining: thresholds from the ' + S.percentile + 'th percentile of each layer’s activations on 512 training windows, reset by subtraction, constant input current, a spike-count gate for the maximum over time. A synaptic event is one spike arriving at one connection. The first convolution (' + fmtInt(S.ann.macs_conv1) + ' multiply-adds) is the same in both networks and is left out of the comparison.'),
      sources('diehl', 'rueckauer', 'davies'))));

  const lg = (v) => Math.log10(Math.max(1, v));
  function staticPlots() {
    agree.set({ x: { min: 1, max: 512, log: true, ticks: S.rows.map((r) => r.T), label: 'time steps' }, y: { min: 0.4, max: 1, ticks: [0.4, 0.6, 0.8, 1], fmt: (v) => Math.round(v * 100) + '', label: '% of windows' },
      vlines: [{ at: Tmax, color: '--accent', dash: [] }], hlines: [{ at: doc.repro.test.accuracy, color: '--text-3', label: 'ordinary network’s accuracy ' + pct(doc.repro.test.accuracy), align: 'left' }],
      series: [{ pts: S.rows.map((r) => [r.T, r.agree]), color: '--text', dots: 2.6, label: 'same answer as the ordinary network', labelAt: [S.rows[3].T, S.rows[3].agree], dy: -6 }, { pts: S.rows.map((r) => [r.T, r.accuracy]), color: '--accent', dots: 2.6, label: 'right answer', labelAt: [S.rows[6].T, S.rows[6].accuracy], dy: 20 }] });
    const ys = [4, 5, 6, 7, 8].filter((e) => e <= Math.ceil(lg(S.rows[S.rows.length - 1].synops)) + 0.01);
    work.set({ x: { min: 1, max: 512, log: true, ticks: S.rows.map((r) => r.T), label: 'time steps' }, y: { min: 3.5, max: ys[ys.length - 1] + 0.2, ticks: ys, fmt: (v) => (v >= 6 ? Math.pow(10, v - 6) + ' M' : Math.pow(10, v - 3) + ' k'), label: 'operations per reading' },
      vlines: [{ at: Tmax, color: '--accent', dash: [] }], hlines: [{ at: lg(rest), color: '--ok', label: 'ordinary network, layers after conv 1: ' + fmtInt(rest) + ' multiply-adds', align: 'left' }],
      series: [{ pts: S.rows.map((r) => [r.T, lg(r.synops)]), color: '--person', dots: 2.6, label: 'spiking: synaptic events', labelAt: [S.rows[4].T, lg(S.rows[4].synops)], dy: 26 }],
      points: t ? [{ x: Math.max(1, t), y: lg(snn.synops), color: '--accent', r: 4.5, ring: true, label: 'this window' }] : [] });
  }
  function drawSettle() {
    const last = trace[trace.length - 1];
    settle.set({ x: { min: 0, max: Tmax, ticks: [0, Tmax / 4, Tmax / 2, 3 * Tmax / 4, Tmax], label: 'time step' }, y: { min: 0, max: 1.18, ticks: [0, 0.5, 1], fmt: (v) => v.toFixed(1), label: 'P(person)' },
      hlines: [{ at: thr, color: '--text-3', label: 'threshold ' + thr.toFixed(2), align: 'left' }, { at: annP, color: '--text', dash: [5, 3], label: 'ordinary network ' + annP.toFixed(2) }],
      series: [{ pts: trace, color: '--person', width: 1.8 }], points: last ? [{ x: last[0], y: last[1], color: '--person', r: 3.5 }] : [] });
  }
  function paintColumn() {
    const d = img.data, col = t - 1; let y0 = 0;
    for (const b of BANDS) {
      const s = b.src(), per = b.n / b.rows;
      for (let r = 0; r < b.rows; r++) { let v = 0; if (per >= 1) { for (let k = 0; k < per; k++) v += s[Math.floor(r * per) + k]; v = v / Math.min(per, 2); } else v = s[Math.floor(r * per)]; if (v > 0) { const o = ((y0 + r) * Tmax + col) * 4, a = Math.min(1, 0.55 + 0.45 * v); d[o] = b.c[0] * a; d[o + 1] = b.c[1] * a; d[o + 2] = b.c[2] * a; } }
      y0 += b.rows + 6;
    }
  }
  function stepOnce() { snn.step(); t = snn.t; paintColumn(); trace.push([t, snn.read().person]); }
  function finishFrame() {
    raster.getContext('2d').putImageData(img, 0, 0); drawSettle();
    stepFig.set(String(t)); sFig.set(fmtInt(snn.synops)); rateEls.forEach((r, i) => { r.b.textContent = t ? (snn.spikes[i] / (snn.neurons[i] * t)).toFixed(3) : '…'; });
    if (t >= Tmax) {
      const p = trace[trace.length - 1][1], same = (p > thr) === (annP > thr), truth = bte.kind[byK[kind][pos]] > 0;
      verdict.className = 'forge-live-sum ' + (same ? 'ok' : 'bad');
      verdict.replaceChildren(icon(same ? 'check-circle' : 'x-circle', 15), h('span', null, 'After ' + Tmax + ' steps the spiking copy says ', h('b', null, p > thr ? 'PERSON' : 'NO ONE'), ' (', h('span.num', null, p.toFixed(2)), '); the ordinary network says ', h('b', null, annP > thr ? 'PERSON' : 'NO ONE'), ' (', h('span.num', null, annP.toFixed(2)), '). The truth: ' + (truth ? 'someone is there.' : 'the room is empty.')));
      staticPlots();
    }
  }
  function loop() { raf = 0; if (!visible || t >= Tmax) return; const n = Tmax / 64; for (let i = 0; i < n && t < Tmax; i++) stepOnce(); finishFrame(); if (t < Tmax) raf = requestAnimationFrame(loop); }
  async function load() {
    cancelAnimationFrame(raf); raf = 0;
    try { codes ||= await env.loadSet('test'); } catch (e) { verdict.replaceChildren(icon('alert', 15), h('span', null, String(e.message || e))); return; }
    const i = byK[kind][pos]; label.textContent = KIND[kind] + ' ' + (pos + 1) + ' of ' + byK[kind].length + (bte.kind[i] === 0 && bte.fan[i] ? ', with a fan' : bte.kind[i] > 0 ? (bte.lying[i] ? ', lying' : ', standing') + ', ' + bte.depth[i].toFixed(1) + ' m behind the wall' : '');
    decodeWindow(codes, i * A.N_IN, doc.dec, x); net.forward(x, W); annP = softmax2(net.zp[0], net.zp[1]);
    paintWindow(winCv, decodeToFloat(codes, i, doc.dec, xf), 0, 2);
    snn.reset(x); t = 0; trace = []; raster.width = Tmax; raster.height = RH; const c = raster.getContext('2d'); c.fillStyle = '#06080a'; c.fillRect(0, 0, Tmax, RH); img = c.getImageData(0, 0, Tmax, RH);
    verdict.className = 'forge-live-sum'; verdict.replaceChildren(h('div.spinner.sm'), h('span', null, 'Counting spikes…'));
    staticPlots();
    if (ctx.kit.reducedMotion()) { while (t < Tmax) stepOnce(); finishFrame(); } else if (visible) raf = requestAnimationFrame(loop);
  }
  await load();
  return { onShow() { visible = true; staticPlots(); drawSettle(); if (t < Tmax && !raf) raf = requestAnimationFrame(loop); }, onHide() { visible = false; cancelAnimationFrame(raf); raf = 0; } };
}
