// Exhibit 3. How small can it get: magnitude pruning, measured in NumPy on the full test set and live in the page.
import { softmax2 } from './lib/net.js';
import { pct, fmtInt, plotter, signed, src, fig, honest, method, sources, block, byKind, ratesOf, thresholdAt, aucOf, slider, seg } from './lib/ui.js';
import { MW, MH, TILES, mosaicPaint } from './lib/mosaic.js';

export async function create(el, env) {
  const { ctx, doc } = env, { h, realityTag } = ctx.kit;
  const P = doc.prune, ft = doc.prune_ft || null, bte = doc.bundle.test, bv = doc.bundle.val, W0 = doc.W.messy;
  const mats = [0, 2, 4, 6, 8, 10], total = mats.reduce((a, t) => a + W0[t].length, 0), POS = [192, 40, 12, 1, 1, 1];
  const mags = new Float32Array(total); { let o = 0; for (const t of mats) for (const v of W0[t]) mags[o++] = Math.abs(v); } const sorted = Float32Array.from(mags).sort();
  let frac = P.knee_one_shot, mode = 'one_shot', busy = false, again = false;

  const cv = h('canvas.forge-plot'), plot = plotter(cv, { r: 16, b: 36 });
  const sl = slider('Weights removed', { min: 0, max: 99, step: 1, value: Math.round(frac * 100), fmt: (v) => v + ' %', oninput: (v) => { frac = v / 100; update(); } });
  const modeSeg = seg('Which curve', [['one_shot', 'Cut only'], ['ft', 'Cut, then retrain', ft ? 'Three more epochs on the full training set with the removed weights held at zero' : 'This measurement has not been run yet']], mode, (v) => { mode = v; drawPlot(); syncPy(); });
  if (!ft) modeSeg.querySelector('[data-v="ft"]').disabled = true;
  const live = { moving: fig('…', '%', 'moving people found', bte.n + ' test windows', 'page', 'person'), still: fig('…', '%', 'still people found', bte.n + ' test windows', 'page', 'warn'), empty: fig('…', '%', 'empty rooms called empty', bte.n + ' test windows', 'page', 'ok'), auc: fig('…', '', 'area under the ROC curve', bte.n + ' test windows', 'page') };
  const pyRow = h('p.forge-p');
  const chart = block('Two weights in five can go before ranking quality moves', null,
    h('div.row', null, modeSeg, h('span.grow'), src('py', 'all 955 test windows, 14 levels')),
    h('div.forge-plot-wrap.tall', null, cv), h('div.forge-prune-slider', null, sl.el),
    h('div.forge-figs', null, live.moving, live.still, live.empty, live.auc), pyRow);

  const die = h('canvas.forge-px.forge-die', { width: MW, height: MH, role: 'img', 'aria-label': 'The weights that survive at this level of pruning.' });
  const layerRows = TILES.map((tl) => { const bar = h('i'), n = h('b.num'); return { el: h('div.forge-layer', null, h('span', null, tl.name), h('div.forge-layer-bar', null, bar), n), bar, n }; });
  const left = { w: fig('…', '', 'weights left of ' + fmtInt(total), null, 'page', 'sm'), mac: fig('…', '', 'multiply-adds per reading', 'zero weights skipped', 'page', 'sm'), bytes: fig('…', 'bytes', 'stored sparse', '1 byte value + 2 bytes position each', 'page', 'sm') };
  const storeNote = h('p.forge-p');
  const what = block('What is left', src('page', 'pruned here, now'),
    h('div.forge-die-wrap.crop', null, die), h('div.forge-layers', null, layerRows.map((r) => r.el)),
    h('div.forge-figs', null, left.w, left.mac, left.bytes), storeNote);

  el.append(h('div.forge-ex', null,
    h('header.forge-ex-head', null, h('div', null, h('h2', null, 'How small can it get'),
      h('p', null, 'Set the smallest weights to zero, smallest first across the whole network, and ask the test set whether anything changed. Up to the knee (' + pct(P.knee_one_shot, 0) + ' removed) ranking quality stays within 0.01' + (ft ? '; with three more epochs of training, ' + pct(ft.knee, 0) + ' can go' : '') + '.')),
      h('div.forge-ex-tags', null, realityTag('live-ai'))),
    h('div.forge-grid.forge-prune', null, chart, what),
    h('footer.forge-ex-foot', null,
      honest('A pruned network is only smaller in practice if the chip stores and skips the zeros. On a microcontroller that needs a sparse format and code to walk it, and nobody has built or timed that for HOUND. The curve says what accuracy allows, not what the hardware delivers.'),
      method('Global magnitude pruning of the six weight matrices (biases kept), no retraining for the solid curves. For each level the PERSON threshold is set again on validation (10 % false alarms), as the project does, then the level is scored on test. Knee: ' + P.knee_rule + '.'),
      sources('han', 'frankle'))));

  const curve = () => (mode === 'ft' && ft ? ft.curve : P.one_shot), kneeNow = () => (mode === 'ft' && ft ? ft.knee : P.knee_one_shot);
  let livePts = null;
  function drawPlot() {
    const c = curve(), xs = (k) => c.map((r) => [r.frac, r[k]]), o = P.one_shot;
    plot.set({ x: { min: 0, max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 0.9, 1], fmt: (v) => Math.round(v * 100) + ' %', label: 'share of weights removed' }, y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => Math.round(v * 100) + '', label: '% (AUC × 100)' },
      bands: [{ x0: kneeNow(), x1: 1, color: 'rgba(255,77,94,0.05)' }],
      vlines: [{ at: kneeNow(), color: '--text-2', label: 'knee: ' + pct(kneeNow(), 0) + ' removed', dash: [2, 3] }, { at: frac, color: '--accent', dash: [] }],
      series: [
        ...(mode === 'ft' ? [{ pts: o.map((r) => [r.frac, r.auc]), color: '--line-3', dash: [3, 3], width: 1.1 }, { pts: o.map((r) => [r.frac, r.moving_found]), color: 'rgba(255,106,69,0.4)', dash: [3, 3], width: 1.1, label: 'cut only', labelAt: [0.93, o.find((r) => r.frac === 0.95).moving_found] }] : []),
        { pts: xs('auc'), color: '--text', dots: 2.4, label: 'ranking quality (AUC)', labelAt: [0.02, c[0].auc] },
        { pts: xs('moving_found'), color: '--person', dots: 2.4, label: 'moving found', labelAt: [0.02, c[0].moving_found] },
        { pts: xs('empty_ok'), color: '--ok', dots: 2.4, label: 'empty called empty', labelAt: [0.72, c[8].empty_ok], dy: -12 },
        { pts: xs('still_found'), color: '--warn', dots: 2.4, label: 'still found', labelAt: [0.02, c[0].still_found] }],
      points: livePts ? [{ x: frac, y: livePts.moving, color: '--person', r: 4.5, ring: true }, { x: frac, y: livePts.still, color: '--warn', r: 4.5, ring: true }, { x: frac, y: livePts.emptyOk, color: '--ok', r: 4.5, ring: true }, { x: frac, y: livePts.auc, color: '--text', r: 4.5, ring: true }] : [] });
  }
  function syncPy() {
    const c = curve(); let near = c[0]; for (const r of c) if (Math.abs(r.frac - frac) < Math.abs(near.frac - frac)) near = r;
    pyRow.replaceChildren(src('py', 'nearest measured level, ' + pct(near.frac, 0) + ' removed' + (mode === 'ft' ? ' then retrained' : '')), h('span', null, ': moving ', h('b.num', null, pct(near.moving_found)), ', still ', h('b.num', null, pct(near.still_found)), ', empty called empty ', h('b.num', null, pct(near.empty_ok)), ', AUC ', h('b.num', null, near.auc.toFixed(3)), '. Rings on the chart are this page’s run on ' + bte.n + ' windows, with the threshold set on only ' + bv.n + (mode === 'ft' ? ' (cut only: the page does not retrain).' : ', so they scatter.')));
  }

  async function update() {
    drawPlot(); syncPy();
    const cut = frac <= 0 ? -1 : sorted[Math.min(total - 1, Math.round(frac * total) - 1)];
    const Wp = W0.map((w, t) => (t % 2 ? w : Float32Array.from(w, (v) => (Math.abs(v) > cut ? v : 0))));
    let kept = 0, macs = 0; TILES.forEach((tl, i) => { let k = 0; for (const v of Wp[tl.t]) if (v !== 0) k++; kept += k; macs += k * POS[i]; const share = k / Wp[tl.t].length; layerRows[i].bar.style.width = (share * 100).toFixed(1) + '%'; layerRows[i].n.textContent = pct(share, 0); });
    let mx = 1e-9; for (const v of W0[0]) mx = Math.max(mx, Math.abs(v));
    mosaicPaint(die, (t, k) => { const v = Wp[TILES[t].t][k]; return v === 0 ? [6, 8, 10] : signed(Math.sign(v) * Math.pow(Math.min(1, Math.abs(v) / mx), 0.5)); });
    left.w.set(fmtInt(kept)); left.mac.set(fmtInt(macs)); left.bytes.set(fmtInt(kept * 3 + 432));
    const dense = doc.int8.bytes.int8_total, sparse = kept * 3 + 432;
    storeNote.replaceChildren(sparse < dense ? 'Stored sparse this is ' : 'Stored sparse this would be ', h('b.num', null, (sparse / dense).toFixed(2) + '×'), ' the size of the plain int8 network (' + fmtInt(dense) + ' bytes). Sparse storage only wins once more than two thirds of the weights are gone, because each survivor must also say where it sits.');
    if (busy) { again = true; return; } busy = true;
    try {
      do {
        again = false;
        const cutNow = frac <= 0 ? -1 : sorted[Math.min(total - 1, Math.round(frac * total) - 1)], fNow = frac;
        const Wn = W0.map((w, t) => (t % 2 ? w : Float32Array.from(w, (v) => (Math.abs(v) > cutNow ? v : 0))));
        const [vc, tc] = await Promise.all([env.loadSet('val'), env.loadSet('test')]);
        const [v, t] = await Promise.all([env.pool.forwardAll(Wn, { codes: vc }, bv.n), env.pool.forwardAll(Wn, { codes: tc }, bte.n)]);
        const pv = Float32Array.from({ length: bv.n }, (_, i) => softmax2(v.person[i * 2], v.person[i * 2 + 1])), pt = Float32Array.from({ length: bte.n }, (_, i) => softmax2(t.person[i * 2], t.person[i * 2 + 1]));
        const th = thresholdAt(pv, bv.kind), r = ratesOf(byKind(pt, th, bte.kind)); r.auc = aucOf(pt, bte.kind.map((k) => (k > 0 ? 1 : 0)));
        if (fNow === frac) { livePts = r; live.moving.set((r.moving * 100).toFixed(1)); live.still.set((r.still * 100).toFixed(1)); live.empty.set((r.emptyOk * 100).toFixed(1)); live.auc.set(r.auc.toFixed(3)); drawPlot(); }
      } while (again);
    } catch (e) { console.error(e); ctx.shell.toast('The pruned network could not be run: ' + (e.message || e), { level: 'alert' }); }
    busy = false;
  }
  // dragging on the chart moves the slider
  const pick = (e) => { const r = cv.getBoundingClientRect(), v = Math.max(0, Math.min(0.99, plot.invX(e.clientX - r.left))); sl.set(Math.round(v * 100)); frac = Math.round(v * 100) / 100; update(); };
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pick(e); }); cv.addEventListener('pointermove', (e) => { if (e.buttons) pick(e); });
  update();
  return { onShow() { drawPlot(); }, onHide() {} };
}
