// Exhibit 1. Train it yourself: the project's training loop (ml/train.py) in JavaScript, on several threads.
import { A, NAMES, SIZES, init, clone, createNet, createAdam, toPython, decodeWindow, softmax2, rng } from './lib/net.js';
import { tok, pct, fmtInt, kindMatrix, byKind, ratesOf, thresholdAt, plotter, paint, signed, src, honest, method, sources, block, raf, seg } from './lib/ui.js';

export async function create(el, env) {
  const { ctx, doc } = env, { h, icon, realityTag } = ctx.kit;
  const ref = doc.train_ref || null, hy = ref?.hyper || { lr: 2e-3, batch: 64, patience: 6, halve_after: 3, max_epochs: 40, false_alarm: 0.1 };
  const cw = ref?.class_weights || { person: [1, 1], moving: [1, 1] };
  const bt = doc.bundle.train, bv = doc.bundle.val, bte = doc.bundle.test;
  const shipLog = doc.clean.train_logs.messy;
  let W = init(0), best = null, hist = [], stepPts = [], running = false, paused = false, visible = false, token = 0, seed = 0, lr = hy.lr, state = 'idle', lastFilters = 0;

  // ---------- left: the run ----------
  const status = h('p.forge-status', { role: 'status', 'aria-live': 'polite' }, 'Ready. The network below is 23,372 random numbers (seed 0).');
  const go = h('button.btn.btn-primary.btn-lg', { onclick: () => (running ? stop() : start()) }, icon('play'), h('span', null, 'Train from random weights'));
  const seedIn = h('input.input.input-sm.num', { type: 'number', min: 0, max: 999, value: 0, 'aria-label': 'Random seed for the starting weights', style: { width: '64px' }, onchange: () => { seed = Math.max(0, Math.min(999, Math.round(+seedIn.value || 0))); seedIn.value = seed; if (!running) reset(); } });
  const lrSeg = seg('Learning rate', [[0.0005, '0.0005'], [0.002, '0.002', 'The rate the project used'], [0.008, '0.008']], lr, (v) => { lr = +v; });
  const ro = { epoch: h('b.num', null, '0'), rate: h('b.num', null, '–'), time: h('b.num', null, '0.0'), workers: h('b.num', null, String(Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 2)))) };
  const bar = h('div.bar', null, h('i', { style: { width: '0%' } }));
  const run = block('Run', realityTag('live-ai'),
    h('div.forge-run-go', null, go),
    h('div.forge-run-set', null, h('label', null, h('span', null, 'Seed'), seedIn), h('label', null, h('span', null, 'Learning rate'), lrSeg)),
    h('div.forge-readouts', null,
      h('div', null, ro.epoch, h('span', null, 'epoch, of at most ' + hy.max_epochs)), h('div', null, ro.rate, h('span', null, 'windows a second')),
      h('div', null, ro.time, h('span', null, 'seconds training')), h('div', null, ro.workers, h('span', null, 'threads sharing each batch'))),
    bar, status,
    h('dl.kv.forge-kv', null,
      h('dt', null, 'Training windows'), h('dd.num', null, fmtInt(bt.n) + ' of ' + fmtInt(doc.repro.counts.train)),
      h('dt', null, 'Simulated people in them'), h('dd.num', null, String(doc.bundle.people_in_train)),
      h('dt', null, 'Download'), h('dd.num', null, (bt.bytes / 1e6).toFixed(1) + ' MB, 8-bit'),
      h('dt', null, 'Batch, optimiser'), h('dd.num', null, hy.batch + ', Adam'),
      h('dt', null, 'Stops when'), h('dd', null, 'validation loss has not improved for ' + hy.patience + ' epochs')));

  // ---------- gradient check ----------
  const gcBody = h('tbody'), gcSum = h('p.forge-gc-sum', null, 'Checking…'), gcNp = h('p.forge-gc-sum');
  const gcBtn = h('button.btn.btn-sm', { onclick: () => gradCheck(Math.floor(Math.random() * 1e6)) }, icon('reset'), 'Check other weights');
  const gc = block('Are the gradients right?', realityTag('live-algo'),
    h('p.forge-p', null, 'Every gradient is written by hand, so each is tested: nudge one weight up and down by 0.00001, measure the change in the loss, and compare with what the formula says.'),
    h('div.forge-gc-wrap', null, h('table.table.dense.forge-gc', null, h('thead', null, h('tr', null, h('th', null, 'Tensor'), h('th.num', null, 'Formula'), h('th.num', null, 'Measured'), h('th.num', null, 'Gap'))), gcBody)),
    gcSum, gcNp, h('div.row', null, gcBtn, h('span.grow'), src('page', '64-bit floats')));

  // ---------- middle: curves and filters ----------
  const lossCv = h('canvas.forge-plot'), rateCv = h('canvas.forge-plot'), filtA = h('canvas.forge-filters'), filtB = h('canvas.forge-filters');
  const lossPlot = plotter(lossCv), ratePlot = plotter(rateCv);
  const filtCap = h('span.forge-filt-cap', null, 'Yours: random weights');
  const mid = h('div.forge-col',
    block('Loss falls as the weights find the signal', null, h('div.forge-plot-wrap', null, lossCv)),
    block('People found on the validation windows, at 10 % false alarms', null, h('div.forge-plot-wrap.short', null, rateCv)),
    block('What the first layer learns to listen for', null,
      h('p.forge-p', null, '24 filters. Each is 51 subcarriers (down) by 9 time steps, 0.45 s (across); the last row reads the motion channel. Blue pulls down, amber pulls up.'),
      h('div.forge-filt', null, filtCap, filtA), h('div.forge-filt', null, h('span.forge-filt-cap', null, 'The rover’s network (trained in NumPy on 4,384 windows)'), filtB)));

  // ---------- right: scoreboard ----------
  const cmYou = kindMatrix('Yours: random weights'), cmShip = kindMatrix('The rover’s network, same windows');
  const rows = [['Moving person found', 'moving_found', 'moving'], ['Still person found', 'still_found', 'still'], ['Empty room called empty', 'empty_ok', 'emptyOk'], ['Still or moving, right', 'moving_acc', 'mv']];
  const cells = rows.map(() => [h('td.num', null, '–'), h('td.num'), h('td.num')]);
  const testCap = h('p.forge-p.dim', null, 'Scored when training ends, on ' + bte.n + ' test windows from people neither network trained on. Each network uses its own threshold (10 % false alarms on validation).');
  const board = h('div.forge-col',
    block('Validation, ' + bv.n + ' windows, after every epoch', null, cmYou, cmShip, src('page', bv.n + ' validation windows')),
    block('Final exam: yours against the rover’s', null,
      h('table.table.dense.forge-score', null, h('thead', null, h('tr', null, h('th', null, ''), h('th.num', null, 'Yours'), h('th.num', null, 'Rover’s'), h('th.num', { title: 'ml/train.py run in NumPy on the same ' + bt.n + ' windows' }, 'NumPy twin'))),
        h('tbody', null, rows.map((r, i) => h('tr', null, h('td', null, r[0]), ...cells[i])))), testCap));

  el.append(h('div.forge-ex', null,
    h('header.forge-ex-head', null, h('div', null, h('h2', null, 'Train it yourself'),
      h('p', null, 'This is the project’s training loop rewritten in JavaScript: the same network, the same hand-written gradients, the same optimiser, spread over the threads of your processor. Press train and 23,372 random numbers become a detector, on ', fmtInt(bt.n), ' simulated windows; the network on the rover saw ', fmtInt(doc.repro.counts.train), '.'))),
    h('div.forge-grid.forge-train', null, h('div.forge-col', null, run, gc), mid, board),
    h('footer.forge-ex-foot', null,
      honest('A model trained in a browser tab is only as good as the simulator that made its windows. For the field it would have to be trained again, or fine-tuned, on recordings from the rover, and no such recording exists yet. With a third of the data, yours will usually trail the rover’s network; the table says by how much.'),
      method('Forward and backward pass: lib/net.js (typed arrays). Loss: class-weighted cross-entropy on two heads. Half of each batch is reversed in time. Threshold: the 90th percentile of P(person) on the validation empty rooms. All as ml/train.py.'))));

  // shipped network's numbers on the same windows
  const shipV = ref?.shipped_bundle_val, shipT = ref?.shipped_bundle_test, twin = ref?.python_same_windows?.bundle_test;
  if (shipV) cmShip.set(shipV.by_kind);
  rows.forEach((r, i) => { cells[i][1].textContent = shipT ? pct(shipT[r[1]]) : '–'; cells[i][2].textContent = twin ? pct(twin[r[1]]) : '–'; });

  function drawFilters(cv, w0) {
    let mx = 1e-9; for (let i = 0; i < w0.length; i++) mx = Math.max(mx, Math.abs(w0[i]));
    const bg = [16, 19, 23];
    paint(cv, 24 * 10 - 1, 52, (i) => { const px = i % 239, c = Math.floor(i / 239), f = Math.floor(px / 10), j = px % 10; return j === 9 ? bg : signed(Math.sign(w0[f * 468 + j * 52 + c]) * Math.pow(Math.abs(w0[f * 468 + j * 52 + c]) / mx, 0.6)); });
  }
  function drawCurves() {
    const n = Math.max(16, hist.length + 2, Math.ceil(stepPts.length ? stepPts[stepPts.length - 1][0] + 1 : 0));
    const all = [...hist.map((e) => e.val), ...hist.map((e) => e.train), ...stepPts.map((p) => p[1]), ...shipLog.map((e) => e.val_loss)];
    const ymax = Math.min(1.6, Math.max(1.3, ...all) + 0.05), ymin = Math.max(0, Math.floor((Math.min(0.6, ...all) - 0.05) * 10) / 10);
    const yt = []; for (let v = Math.ceil(ymin * 5) / 5; v <= ymax + 1e-9; v += 0.2) yt.push(+v.toFixed(1));
    const xt = []; for (let v = 0; v <= n; v += n > 24 ? 8 : 4) xt.push(v);
    lossPlot.set({ x: { min: 0, max: n, ticks: xt, label: 'epoch' }, y: { min: ymin, max: ymax, ticks: yt, fmt: (v) => v.toFixed(1), label: 'loss' },
      series: [
        { pts: shipLog.map((e) => [e.epoch, e.val_loss]), color: '--text-3', dash: [4, 3], width: 1.2, label: 'rover’s network, validation', labelAt: [shipLog[Math.min(7, shipLog.length - 1)].epoch, shipLog[Math.min(7, shipLog.length - 1)].val_loss], dy: -8 },
        { pts: stepPts, color: 'rgba(90,169,255,0.35)', width: 1 },
        { pts: hist.map((e) => [e.epoch, e.train]), color: '--accent', width: 1.8, dots: 2.2, label: 'yours, training' },
        { pts: hist.map((e) => [e.epoch, e.val]), color: '--text', width: 1.8, dots: 2.2, label: 'yours, validation', dy: 16 }],
      points: best ? [{ x: best.epoch, y: best.val, color: '--ok', r: 4.5, ring: true, label: 'kept' }] : [] });
    ratePlot.set({ x: { min: 0, max: n, ticks: xt, label: 'epoch' }, y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => Math.round(v * 100) + '', label: '% found' },
      hlines: shipV ? [{ at: shipV.moving_found, color: '--person', label: 'rover’s: moving ' + pct(shipV.moving_found, 0) }, { at: shipV.still_found, color: '--warn', label: 'rover’s: still ' + pct(shipV.still_found, 0) }] : [],
      series: [{ pts: hist.map((e) => [e.epoch, e.rates.moving]), color: '--person', dots: 2.2, label: 'moving' }, { pts: hist.map((e) => [e.epoch, e.rates.still]), color: '--warn', dots: 2.2, label: 'still' }] });
  }

  // ---------- validation and test scoring ----------
  const kindsOf = (b) => Int8Array.from(b.kind);
  async function score(Wt, setName, b) {
    const codes = await env.loadSet(setName), out = await env.pool.forwardAll(Wt, { codes }, b.n), kind = kindsOf(b);
    const p = new Float32Array(b.n); let L = 0, sP = 0, sM = 0, mvOk = 0, mvN = 0;
    for (let i = 0; i < b.n; i++) { sP += cw.person[kind[i] > 0 ? 1 : 0]; if (kind[i] > 0) sM += cw.moving[kind[i] === 2 ? 1 : 0]; }
    for (let i = 0; i < b.n; i++) {
      const pp = softmax2(out.person[i * 2], out.person[i * 2 + 1]), pm = softmax2(out.moving[i * 2], out.moving[i * 2 + 1]); p[i] = pp;
      L += -cw.person[kind[i] > 0 ? 1 : 0] / sP * Math.log((kind[i] > 0 ? pp : 1 - pp) + 1e-9);
      if (kind[i] > 0) { const y = kind[i] === 2; L += -cw.moving[y ? 1 : 0] / sM * Math.log((y ? pm : 1 - pm) + 1e-9); mvN++; if ((pm > 0.5) === y) mvOk++; }
    }
    return { p, loss: L, kind, mv: mvOk / (mvN || 1) };
  }

  // ---------- the loop (train.py's train()) ----------
  function reset() { W = init(seed); best = null; hist = []; stepPts = []; state = 'idle'; ro.epoch.textContent = '0'; ro.rate.textContent = '–'; ro.time.textContent = '0.0'; bar.firstChild.style.width = '0%';
    status.textContent = 'Ready. The network below is 23,372 random numbers (seed ' + seed + ').'; filtCap.textContent = 'Yours: random weights'; cmYou.firstChild.textContent = 'Yours: random weights'; drawFilters(filtA, W[0]); drawCurves(); rows.forEach((r, i) => { cells[i][0].textContent = '–'; }); scoreNow(); }
  async function scoreNow() { try { const v = await score(W, 'val', bv), thr = thresholdAt(v.p, v.kind, hy.false_alarm); cmYou.set(byKind(v.p, thr, v.kind)); } catch (e) { console.error(e); } }
  function stop() { token++; running = false; setGo(); status.textContent = 'Stopped at epoch ' + hist.length + '.' + (best ? ' The best epoch so far (' + best.epoch + ') is kept.' : ''); if (best) finish(); }
  function setGo() { go.replaceChildren(icon(running ? 'stop' : 'play'), h('span', null, running ? 'Stop training' : hist.length ? 'Train again from new random weights' : 'Train from random weights')); go.classList.toggle('btn-primary', !running); seedIn.disabled = running; lrSeg.querySelectorAll('button').forEach((b) => { b.disabled = running; }); }

  async function start() {
    const my = ++token; running = true; setGo();
    try {
      status.textContent = 'Loading ' + fmtInt(bt.n) + ' training windows (' + (bt.bytes / 1e6).toFixed(1) + ' MB)…';
      const data = await env.loadSet('train', (got, total) => { if (my === token) { bar.firstChild.style.width = (100 * got / (total || bt.bytes)).toFixed(0) + '%'; status.textContent = 'Loading ' + fmtInt(bt.n) + ' training windows: ' + (got / 1e6).toFixed(1) + ' of ' + ((total || bt.bytes) / 1e6).toFixed(1) + ' MB'; } });
      await env.pool.ready; if (my !== token) return;
      ro.workers.textContent = String(env.pool.size);
      W = init(seed); best = null; hist = []; stepPts = []; state = 'training';
      const opt = createAdam(W, { lr }), r = rng(seed * 7919 + 17), kind = kindsOf(bt), n = bt.n, B = hy.batch, steps = Math.ceil(n / B);
      let bestVal = Infinity, bad = 0, seen = 0, tTrain = 0, ema = null;
      for (let ep = 0; ep < hy.max_epochs && my === token; ep++) {
        const perm = Int32Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
        let tl = 0, cnt = 0;
        for (let s = 0; s < steps; s++) {
          while (paused && my === token) await new Promise((res) => setTimeout(res, 200));
          if (my !== token) return;
          const idx = perm.subarray(s * B, Math.min(n, (s + 1) * B)), m = idx.length;
          const flips = new Uint8Array(m), yP = new Int8Array(m), yM = new Int8Array(m), wP = new Float32Array(m), wM = new Float32Array(m); let sP = 0, sM = 0;
          for (let i = 0; i < m; i++) { const k = kind[idx[i]]; flips[i] = r() < 0.5 ? 1 : 0; yP[i] = k > 0 ? 1 : 0; yM[i] = k === 0 ? -1 : k === 2 ? 1 : 0; wP[i] = cw.person[yP[i]]; sP += wP[i]; if (k > 0) { wM[i] = cw.moving[yM[i]]; sM += wM[i]; } }
          for (let i = 0; i < m; i++) { wP[i] /= sP; if (sM) wM[i] /= sM; }
          const t0 = performance.now(), g = await env.pool.gradBatch(W, data, { idx, flips, yP, yM, wP, wM });
          if (my !== token) return;
          opt.step(g.G); tTrain += performance.now() - t0; seen += m; tl += g.loss * m; cnt += m;
          ema = ema == null ? g.loss : 0.8 * ema + 0.2 * g.loss; stepPts.push([ep + (s + 1) / steps, ema]);
          ro.epoch.textContent = String(ep + 1); ro.rate.textContent = fmtInt(seen / (tTrain / 1000)); ro.time.textContent = (tTrain / 1000).toFixed(1); bar.firstChild.style.width = (100 * (s + 1) / steps).toFixed(0) + '%';
          status.textContent = 'Epoch ' + (ep + 1) + ', batch ' + (s + 1) + ' of ' + steps + ': loss ' + g.loss.toFixed(3);
          if (visible && performance.now() - lastFilters > 180) { lastFilters = performance.now(); drawFilters(filtA, W[0]); filtCap.textContent = 'Yours: epoch ' + (ep + 1) + ', batch ' + (s + 1); drawCurves(); }
        }
        const v = await score(W, 'val', bv); if (my !== token) return;
        const thr = thresholdAt(v.p, v.kind, hy.false_alarm), bk = byKind(v.p, thr, v.kind), e = { epoch: ep + 1, train: tl / cnt, val: v.loss, thr, rates: ratesOf(bk), bk, mv: v.mv };
        hist.push(e); cmYou.set(bk); cmYou.firstChild.textContent = 'Yours: epoch ' + (ep + 1) + ', threshold ' + thr.toFixed(2);
        if (v.loss < bestVal - 1e-4) { bestVal = v.loss; best = { ...e, W: clone(W) }; bad = 0; }
        else { bad++; if (bad === hy.halve_after) opt.lr *= 0.5; }
        drawFilters(filtA, W[0]); drawCurves();
        if (bad >= hy.patience) { status.textContent = 'Stopped early after epoch ' + (ep + 1) + ': validation loss had not improved for ' + hy.patience + ' epochs.'; break; }
      }
      if (my !== token) return;
      running = false; setGo(); await finish(tTrain);
    } catch (e) { console.error(e); if (my === token) { running = false; setGo(); status.textContent = 'Training stopped: ' + (e.message || e); ctx.shell.toast('Training stopped: ' + (e.message || e), { level: 'alert' }); } }
  }
  async function finish(tTrain) {
    if (!best) return;
    state = 'done'; W = clone(best.W); drawFilters(filtA, W[0]); filtCap.textContent = 'Yours: epoch ' + best.epoch + ' (the best on validation, kept)';
    cmYou.set(best.bk); cmYou.firstChild.textContent = 'Yours: epoch ' + best.epoch + ' (kept), threshold ' + best.thr.toFixed(2);
    const t = await score(W, 'test', bte), bk = byKind(t.p, best.thr, t.kind), rt = ratesOf(bk);
    [rt.moving, rt.still, rt.emptyOk, t.mv].forEach((v, i) => { cells[i][0].textContent = pct(v); });
    env.trained = { W: clone(W), thr: best.thr, epoch: best.epoch, seed };
    if (tTrain != null) status.textContent = 'Done in ' + (tTrain / 1000).toFixed(1) + ' s of training. Epoch ' + best.epoch + ' of ' + hist.length + ' had the lowest validation loss (' + best.val.toFixed(3) + ') and is kept. On the test windows it finds ' + pct(rt.moving, 0) + ' of moving people' + (shipT ? ' (the rover’s network: ' + pct(shipT.moving_found, 0) + ').' : '.');
    drawCurves();
  }

  // ---------- gradient check ----------
  async function gradCheck(s) {
    gcBtn.disabled = true;
    try {
      const val = await env.loadSet('val'), net = createNet(Float64Array), r = rng(s + 11), W64 = (s === 0 && !hist.length ? init(seed) : W).map((w) => Float64Array.from(w));
      const nB = 4, xs = [], kind = bv.kind; let sP = 0, sM = 0;
      for (let i = 0; i < nB; i++) { xs.push(decodeWindow(val, i * 31 * A.N_IN, doc.dec, new Float64Array(A.N_IN))); const k = kind[i * 31]; sP += cw.person[k > 0 ? 1 : 0]; if (k > 0) sM += cw.moving[k === 2 ? 1 : 0]; }
      const lossAll = (G) => { let L = 0; for (let i = 0; i < nB; i++) { const k = kind[i * 31]; L += net.loss(xs[i], W64, k > 0 ? 1 : 0, cw.person[k > 0 ? 1 : 0] / sP, k === 0 ? -1 : k === 2 ? 1 : 0, k > 0 ? cw.moving[k === 2 ? 1 : 0] / sM : 0, G); } return L; };
      const G = SIZES.map((n) => new Float64Array(n)); lossAll(G);
      gcBody.replaceChildren(); let worst = 0, count = 0;
      for (let t = 0; t < 12; t++) {
        let row = null;
        for (let k = 0; k < 3; k++) {
          let i = Math.floor(r() * SIZES[t]); for (let tries = 0; tries < 40 && G[t][i] === 0; tries++) i = Math.floor(r() * SIZES[t]);
          const keep = W64[t][i], eps = 1e-5; W64[t][i] = keep + eps; const up = lossAll(null); W64[t][i] = keep - eps; const dn = lossAll(null); W64[t][i] = keep;
          const num = (up - dn) / (2 * eps), an = G[t][i], gap = Math.abs(an - num) / Math.max(1e-12, Math.abs(an) + Math.abs(num)); count++;
          if (!row || gap > row.gap) row = { an, num, gap }; worst = Math.max(worst, gap);
        }
        gcBody.append(h('tr', null, h('td', null, NAMES[t]), h('td.num', null, row.an.toExponential(3)), h('td.num', null, row.num.toExponential(3)), h('td.num' + (row.gap < 1e-5 ? '.c-ok' : '.c-danger'), null, row.gap.toExponential(1))));
        await raf();
      }
      gcSum.replaceChildren(icon(worst < 1e-5 ? 'check-circle' : 'alert', 14), h('span', null, count + ' weights nudged across all 12 tensors; the worst gap between formula and measurement is ', h('b.num', null, worst.toExponential(1)), worst < 1e-5 ? '. The backward pass is right.' : '. That is too large: something is wrong.'));
      gcSum.className = 'forge-gc-sum ' + (worst < 1e-5 ? 'ok' : 'bad');
      // against NumPy: the same eight windows, the rover's weights, both losses and sampled gradient entries
      const gr = ref?.grad_ref;
      if (gr) {
        const Ws = doc.W.messy.map((w) => Float64Array.from(w)), G2 = SIZES.map((n) => new Float64Array(n)); let L = 0, p2 = 0, m2 = 0; const x = new Float64Array(A.N_IN);
        for (let i = 0; i < gr.batch; i++) { const k = kind[i]; p2 += cw.person[k > 0 ? 1 : 0]; if (k > 0) m2 += cw.moving[k === 2 ? 1 : 0]; }
        for (let i = 0; i < gr.batch; i++) { const k = kind[i]; decodeWindow(val, i * A.N_IN, doc.dec, x); L += net.loss(x, Ws, k > 0 ? 1 : 0, cw.person[k > 0 ? 1 : 0] / p2, k === 0 ? -1 : k === 2 ? 1 : 0, k > 0 ? cw.moving[k === 2 ? 1 : 0] / m2 : 0, G2); }
        let gapMax = 0, nCmp = 0; gr.grads.forEach((g, t) => { const py = toPython(G2[t], t, Float64Array); g.idx.forEach((ix, k) => { const a = py[ix], b = g.val[k]; gapMax = Math.max(gapMax, Math.abs(a - b) / Math.max(1e-9, Math.abs(a) + Math.abs(b))); nCmp++; }); });
        const okNp = Math.abs(L - gr.loss) < 1e-4 && gapMax < 1e-3;
        gcNp.replaceChildren(icon(okNp ? 'check-circle' : 'alert', 14), h('span', null, 'Against NumPy on the same 8 windows with the rover’s weights: loss ', h('b.num', null, L.toFixed(5)), ' here, ', h('b.num', null, gr.loss.toFixed(5)), ' there; ' + nCmp + ' gradient entries agree to ', h('b.num', null, gapMax.toExponential(1)), ' (NumPy works in 32-bit floats).'));
        gcNp.className = 'forge-gc-sum ' + (okNp ? 'ok' : 'bad');
      }
    } catch (e) { console.error(e); gcSum.textContent = 'The check could not run: ' + (e.message || e); }
    gcBtn.disabled = false;
  }

  drawFilters(filtA, W[0]); drawFilters(filtB, doc.W.messy[0]); drawCurves();
  scoreNow(); gradCheck(0);
  return {
    onShow() { visible = true; paused = false; drawCurves(); if (running) status.textContent = 'Training…'; },
    onHide() { visible = false; if (running) { paused = true; status.textContent = 'Paused while this exhibit is hidden.'; } },
    debug: { start, stop, get hist() { return hist; }, get state() { return state; } },
  };
}
