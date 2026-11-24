// Exhibit 2. Fits on a 4-dollar chip: the network as 8-bit integers, run with integer arithmetic only.
import { softmax2 } from './lib/net.js';
import { tok, pct, fmtInt, plotter, signed, src, fig, honest, method, sources, block, cite, sigmoid } from './lib/ui.js';
import { MW, MH, TILES, mosaicPaint, mosaicHit, mosaicXY } from './lib/mosaic.js';

export async function create(el, env) {
  const { ctx, doc } = env, { h, icon, realityTag } = ctx.kit;
  const q = doc.int8, Q = doc.q, by = q.bytes, tf = q.test.float, ti = q.test.int8, bte = doc.bundle.test, thr = doc.bundle.models.messy.threshold;
  const scaleOf = (t) => q.sw[Math.min(t, 4)];
  const floatW = (t, k, motion) => doc.W.messy[TILES[t].t][k] * (motion ? q.s_motion / q.s_in : 1);

  // ---------- the die ----------
  const die = h('canvas.forge-px.forge-die', { width: MW, height: MH, role: 'img', 'aria-label': 'All 23,264 weights of the network drawn as pixels, coloured by their 8-bit value.', tabIndex: 0 });
  const probe = h('div.forge-probe', null, h('span.dim', null, 'Point at a weight to read its byte.'));
  mosaicPaint(die, (t, k) => signed(Math.sign(Q.W[t][k]) * Math.pow(Math.abs(Q.W[t][k]) / 127, 0.6)));
  const readAt = (hit) => {
    if (!hit) return;
    const v = Q.W[hit.ti][hit.k], f = floatW(hit.ti, hit.k, hit.motion), back = v * scaleOf(hit.ti);
    probe.replaceChildren(h('b', null, hit.name), h('span', null, hit.where), h('span.forge-probe-eq.num', null, f.toFixed(5), h('i', null, ' → '), h('em', null, (v < 0 ? '−' : '') + Math.abs(v)), h('i', null, ' → '), back.toFixed(5)), h('span.dim', null, 'rounding error ' + Math.abs(f - back).toExponential(1) + ' (one step = ' + scaleOf(hit.ti).toFixed(5) + ')'));
  };
  die.addEventListener('mousemove', (e) => readAt(mosaicHit(...mosaicXY(die, e))));
  let kx = 100, ky = 10; die.addEventListener('keydown', (e) => { const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!d) return; e.preventDefault(); kx = Math.max(0, Math.min(MW - 1, kx + d[0])); ky = Math.max(0, Math.min(MH - 1, ky + d[1])); readAt(mosaicHit(kx, ky)); });
  const histCv = TILES.slice(0, 4).map(() => h('canvas.forge-lv'));
  const drawHists = () => histCv.forEach((cv, t) => {
    const w = 128, hh = 36; cv.width = w * 2; cv.height = hh * 2; const c = cv.getContext('2d'); c.scale(2, 2);
    const bins = new Float64Array(128); for (const v of Q.W[t]) bins[Math.min(127, (v + 128) >> 1)]++; const mx = Math.max(...bins);
    c.fillStyle = tok('--accent'); for (let i = 0; i < 128; i++) { const bh = Math.sqrt(bins[i] / mx) * (hh - 2); c.fillRect(i, hh - bh, 1, bh); }
    c.fillStyle = tok('--line-3'); c.fillRect(64, 0, 0.5, hh);
  });
  const dieBlock = block('The whole network, as the bytes a chip would store', src('py', 'quantised by tools/forge_export.py'),
    h('div.forge-die-wrap.crop', null, die, probe,
      h('div.forge-die-labels', { 'aria-hidden': 'true' }, h('span', { style: { left: '0', top: '0' } }, 'conv 1 · 11,232'), h('span', { style: { left: '0', top: '31%' } }, 'conv 2 · 5,184'), h('span', { style: { left: '47.4%', top: '31%' } }, 'conv 3 · 5,184'), h('span', { style: { left: '0', top: '62%' } }, 'dense'), h('span', { style: { left: '19%', top: '62%' } }, 'heads'))),
    h('div.forge-lv-row', null, TILES.slice(0, 4).map((tl, t) => h('div', null, histCv[t], h('span', null, tl.name + ': one step = ' + q.sw[t].toFixed(5))))),
    h('p.forge-p', null, 'Each layer gets one scale: its largest weight maps to ±127 and everything else rounds to the nearest step. The histograms show how the 255 levels are used (square-root height). Activations become 0 to 255 after each ReLU, biases are 32-bit, and each layer ends with a multiply and a shift, so the chip never touches a floating-point number.'));

  // ---------- the budget ----------
  const FLASH = 8 * 1024 * 1024, SRAM = 512 * 1024;
  const budget = (label, total, parts, note) => h('div.forge-budget', null, h('div.forge-budget-h', null, h('span', null, label), h('b.num', null, fmtInt(total / 1024) + ' KB')),
    h('div.forge-budget-bar', null, parts.map((p) => h('i', { style: { width: Math.max(0.35, 100 * p[1] / total) + '%', background: 'var(' + p[2] + ')' }, title: p[0] + ': ' + fmtInt(p[1]) + ' bytes' }))),
    h('ul.forge-budget-l', null, parts.map((p) => h('li', null, h('i', { style: { background: 'var(' + p[2] + ')' } }), h('span', null, p[0]), h('b.num', null, fmtInt(p[1]) + ' B'), h('em.num', null, (100 * p[1] / total).toFixed(2) + ' %')))), note ? h('p.forge-p.dim', null, note) : null);
  const mac = q.macs, budgetBlock = block('Against an ESP32-S3', realityTag('concept'),
    h('div.forge-figs', null, fig(fmtInt(by.int8_total), 'bytes', 'the network as int8', '23,264 weights + 108 biases × 4 + scales', 'py', 'ok'), fig(fmtInt(by.float32), 'bytes', 'the same network as 32-bit floats', '23,372 × 4', 'py')),
    budget('Flash on the N8 module', FLASH, [['int8 network', by.int8_total, '--ok'], ['float network, for scale', by.float32, '--text-3']]),
    budget('RAM on the chip (SRAM)', SRAM, [['Layer buffers at their peak (input + conv 1 output)', q.ram.peak_arena, '--accent'], ['10 s window before it is normalised (32-bit floats)', q.ram.float_window, '--warn']], 'Not counted: the Wi-Fi stack and the program itself, which take most of what a real ESP32 project uses.'),
    h('dl.kv.forge-kv', null,
      h('dt', null, 'Multiply-adds per reading'), h('dd.num', null, fmtInt(q.macs_total)),
      h('dt', null, 'Share spent in the first convolution'), h('dd.num', null, pct(mac.conv1 / q.macs_total)),
      h('dt', null, 'Time per reading on the chip'), h('dd', null, 'not measured'),
      h('dt', null, 'Price of the module'), h('dd', null, 'about 4 US dollars in quantity')),
    h('p.forge-p.dim', null, 'Memory sizes: ', cite('esp32'), '. Price: distributor listings in November 2026 showed about 3.30 US dollars each for 400 or more at one distributor and 5.66 or more for a single part at another, so “4-dollar” is fair in quantity, not for one part.'));

  // ---------- measured ----------
  const rowsDef = [['Moving person found', 'moving_found'], ['Still person found', 'still_found'], ['Empty room called empty', 'empty_ok'], ['Still or moving, right', 'moving_acc'], ['Area under the ROC curve', 'auc']];
  const scatCv = h('canvas.forge-plot'), scat = plotter(scatCv, { l: 40, b: 32 });
  const liveSum = h('div.forge-live-sum', { role: 'status', 'aria-live': 'polite' }, h('div.spinner.sm'), h('span', null, 'Running the integer network on ' + bte.n + ' test windows…'));
  const runBtn = h('button.btn.btn-primary', { onclick: () => runHere() }, icon('cpu'), 'Run the integer network again');
  const measured = block('Does it still give the same answers?', null,
    h('table.table.dense.forge-score', null, h('thead', null, h('tr', null, h('th', null, 'All ' + doc.repro.test.confusion.flat().reduce((a, b) => a + b, 0) + ' test windows'), h('th.num', null, 'int8'), h('th.num', null, '32-bit float'))),
      h('tbody', null, rowsDef.map((r) => h('tr', null, h('td', null, r[0]), h('td.num', null, r[1] === 'auc' ? ti.auc.toFixed(3) : pct(ti[r[1]])), h('td.num', null, r[1] === 'auc' ? tf.auc.toFixed(3) : pct(tf[r[1]])))),
        h('tr', null, h('td', null, 'Answers that changed'), h('td.num', null, q.test.flips + ' of 955'), h('td.num', null, 'reference')),
        h('tr', null, h('td', null, 'Mean shift in P(person)'), h('td.num', null, q.test.mean_abs_dp.toFixed(3)), h('td.num', null, 'reference')))),
    h('div.row', null, src('py', 'integer-only NumPy on the float16 windows'), h('span.grow')),
    h('div.forge-plot-wrap', { style: { height: '236px' } }, scatCv), liveSum, h('div.row', null, runBtn, h('span.grow'), src('page', bte.n + ' bundled test windows')));

  // ---------- how few bits ----------
  const bitsCv = h('canvas.forge-plot'), bitsPlot = plotter(bitsCv, { r: 132 });
  const B = q.bits, knee = B.find((b) => b.agree < 0.95);
  const bitsBlock = block('How few bits before it breaks?', src('py', '955 test windows, weights only'),
    h('div.forge-plot-wrap.short', { style: { height: '170px' } }, bitsCv),
    h('p.forge-p', null, 'The same rounding, with fewer levels per weight (activations left as floats, threshold unchanged). ' + (knee ? 'Down to ' + (knee.bits + 1) + ' bits the answers match the float network on at least 95 % of windows; at ' + knee.bits + ' bits they match on ' + pct(knee.agree, 0) + '.' : 'Even at 2 bits the answers match on at least 95 % of windows.')));

  el.append(h('div.forge-ex', null,
    h('header.forge-ex-head', null, h('div', null, h('h2', null, 'Fits on a 4-dollar chip'),
      h('p', null, 'The rover runs this network on a Raspberry Pi. Rounded to 8-bit integers it is ', fmtInt(by.int8_total), ' bytes and needs only whole-number arithmetic, small enough for the same ESP32-S3 that already receives the Wi-Fi signal, so a sensor node could decide for itself.')),
      h('div.forge-ex-tags', null, realityTag('live-algo'), realityTag('concept'))),
    h('div.forge-grid.forge-int8', null, h('div.forge-col', null, dieBlock, bitsBlock), budgetBlock, measured),
    h('footer.forge-ex-foot', null,
      honest('Nobody has run this on an ESP32-S3. The integers below are exactly what the chip would compute, but its speed for 2.4 million multiply-adds is unmeasured, the chip would also have to bin and normalise the packets itself, and the rover’s firmware does neither today.'),
      method('Post-training quantisation: weights symmetric per layer, activations unsigned 8-bit with the scale set at the ' + q.pct + 'th percentile of each layer on 512 training windows, input step ' + q.s_in + ' % (chosen on validation), 15-bit fixed-point multipliers. Measured on test afterwards.'),
      sources('jacob', 'david', 'esp32'))));

  bitsPlot.set({ x: { min: 1.6, max: 8.4, ticks: [2, 3, 4, 5, 6, 7, 8], label: 'bits per weight' }, y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => Math.round(v * 100) + '', label: '%' },
    series: [{ pts: B.map((b) => [b.bits, b.agree]), color: '--text', dots: 2.5, label: 'same answer as float', labelAt: 'start' }, { pts: B.map((b) => [b.bits, b.moving_found]), color: '--person', dots: 2.5, label: 'moving found', labelAt: 'start', dy: 14 }, { pts: B.map((b) => [b.bits, b.empty_ok]), color: '--ok', dots: 2.5, label: 'empty called empty', labelAt: 'start', dy: 14 }, { pts: B.map((b) => [b.bits, b.still_found]), color: '--warn', dots: 2.5, label: 'still found', labelAt: 'start' }] });

  async function runHere() {
    runBtn.disabled = true;
    try {
      const codes = await env.loadSet('test'), t0 = performance.now();
      const [iq, fl] = await Promise.all([env.pool.int8All(Q, codes, bte.n), env.pool.forwardAll(doc.W.messy, { codes }, bte.n)]);
      const wall = performance.now() - t0, refP = q.bundle_acc.person, refM = q.bundle_acc.moving; let exact = 0, flips = 0, shift = 0; const pts = [], flipPts = [];
      for (let i = 0; i < bte.n; i++) {
        if (iq.person[i * 2] === refP[i][0] && iq.person[i * 2 + 1] === refP[i][1] && iq.moving[i * 2] === refM[i][0] && iq.moving[i * 2 + 1] === refM[i][1]) exact++;
        const d = iq.person[i * 2 + 1] - iq.person[i * 2], pi = sigmoid(d * Q.outScale), pf = softmax2(fl.person[i * 2], fl.person[i * 2 + 1]), saysI = d > Q.thrInt;
        shift += Math.abs(pi - pf); if (saysI !== pf > thr) { flips++; flipPts.push([pf, pi]); } else pts.push([pf, pi]);
      }
      scat.set({ x: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => v.toFixed(2).replace(/0$/, ''), label: 'P(person), 32-bit float' }, y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => v.toFixed(2).replace(/0$/, ''), label: 'P(person), int8' },
        vlines: [{ at: thr, color: '--text-3', label: 'threshold ' + thr.toFixed(2) }], hlines: [{ at: thr, color: '--text-3' }],
        series: [{ pts: [[0, 0], [1, 1]], color: '--line-3', width: 1 }, { pts, color: 'rgba(90,169,255,0.75)', noLine: true, dots: 1.8 }, { pts: flipPts, color: '--danger', noLine: true, dots: 3, label: flipPts.length ? 'answer changed' : null, labelAt: flipPts[0] }] });
      const ok = exact === bte.n;
      liveSum.replaceChildren(icon(ok ? 'check-circle' : 'alert', 15), h('span', null, h('b.num', null, exact + ' of ' + bte.n), ' windows give the same four integers here as in NumPy' + (ok ? ', bit for bit. ' : '. '), h('b.num', null, String(flips)), ' answers differ from the float network; P(person) moves by ', h('b.num', null, (shift / bte.n).toFixed(3)), ' on average. ', h('b.num', null, (iq.ms / bte.n).toFixed(1) + ' ms'), ' a window in JavaScript on this computer.'));
      liveSum.className = 'forge-live-sum ' + (ok ? 'ok' : 'bad');
    } catch (e) { console.error(e); liveSum.replaceChildren(icon('alert', 15), h('span', null, 'The run failed: ' + (e.message || e))); liveSum.className = 'forge-live-sum bad'; }
    runBtn.disabled = false;
  }
  drawHists(); runHere();
  return { onShow() { drawHists(); bitsPlot.draw(); scat.draw(); }, onHide() {} };
}
