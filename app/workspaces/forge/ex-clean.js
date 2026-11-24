// Exhibit 6. Clean vs. messy simulator: the project's key finding, made visible on the same windows.
import { A, createNet, toTimeMajor, softmax2 } from './lib/net.js';
import { addFaults } from './lib/corrupt.js';
import { pct, plotter, paintWindow, src, honest, method, sources, block, kindMatrix, slider, seg, KIND } from './lib/ui.js';

export async function create(el, env) {
  const { ctx, doc } = env, { h, icon, realityTag } = ctx.kit;
  const C = doc.clean, bte = doc.bundle.test, TH = C.thresholds, MODELS = [['clean', 'Trained on the clean simulator'], ['messy', 'Trained on the messy simulator (the rover’s network)']];
  const net = createNet(), xt = new Float32Array(A.N_IN);
  const byK = [0, 1, 2].map((k) => bte.kind.map((v, i) => (v === k ? i : -1)).filter((i) => i >= 0));
  let kind = 0, pos = 0, X = null, faults = { noise: 0, steps: 0, drift: 0, loss: 0 }, busy = false, again = false;
  const pOf = (w, x, off) => { toTimeMajor(x, off, xt); net.forward(xt, doc.W[w]); return softmax2(net.zp[0], net.zp[1]); };

  // ---------- four experiments ----------
  const cell = (m, d) => { const r = C.cells[m + '_on_' + d], km = kindMatrix(''); km.set(r.by_kind); km.firstChild.remove(); const fa = 1 - r.empty_ok;
    return h('div.forge-cell' + (m === 'clean' && d === 'messy' ? '.is-key' : ''), null, h('div.forge-cell-h', null, h('b.num' + (fa > 0.3 ? '.c-danger' : ''), null, pct(fa, 0)), h('span', null, 'of empty rooms called a person')), km,
      h('p.forge-p.dim', null, 'Still found ' + pct(r.still_found, 0) + ', moving found ' + pct(r.moving_found, 0) + ', still-or-moving right ' + pct(r.moving_acc, 0) + '. Threshold ' + r.threshold.toFixed(2) + '.')); };
  const four = block('Two networks, two simulators, the same 955 test windows', src('py', 'ml/evaluate.py protocol, all four cells'),
    h('div.forge-four', null, h('span'), h('span.forge-four-h', null, 'Tested on clean signals'), h('span.forge-four-h', null, 'Tested on messy signals (ESP32 faults on)'),
      h('span.forge-four-r', null, 'Trained clean'), cell('clean', 'clean'), cell('clean', 'messy'), h('span.forge-four-r', null, 'Trained messy'), cell('messy', 'clean'), cell('messy', 'messy')),
    h('p.forge-p', null, 'Trained on perfect signals, the network learns that any flicker means a person. The real receiver flickers all the time, so on messy signals it calls ', h('b', null, pct(1 - C.cells.clean_on_messy.empty_ok, 0) + ' of empty rooms'), ' a person and finds nearly everyone: an alarm that is always on. The messy-trained network gives up most still people and gets a false-alarm rate it can live with.'));

  // ---------- one window, both simulators ----------
  const cvC = h('canvas.forge-px.forge-win'), cvM = h('canvas.forge-px.forge-win'), cvF = h('canvas.forge-px.forge-win');
  const meter = () => { const rows = MODELS.map(([m, name]) => { const bx = (el) => { el.style.setProperty('--mark', TH[m]); return el; }; const bar = h('i'), v = h('b.num'), say = h('em'); return { m, bar, v, say, el: h('div.forge-pm', null, h('span', null, m === 'clean' ? 'Clean-trained' : 'Messy-trained'), bx(h('div.forge-pm-bar', { title: name + '; says PERSON above ' + TH[m].toFixed(2) }, bar)), v, say) }; });
    return { el: h('div.forge-pms', null, rows.map((r) => r.el)), set(x, off) { rows.forEach((r) => { const p = pOf(r.m, x, off), yes = p > TH[r.m]; r.bar.style.width = (p * 100).toFixed(1) + '%'; r.bar.className = yes ? 'yes' : ''; r.v.textContent = p.toFixed(2); r.say.textContent = yes ? 'PERSON' : 'no one'; r.say.className = yes ? 'yes' : ''; }); } }; };
  const mC = meter(), mM = meter(), mF = meter();
  const cap = h('span.forge-win-cap'), truth = h('span.tag');
  const kSeg = seg('Kind of window', KIND.map((k, i) => [i, k]), kind, (v) => { kind = +v; pos = 0; drawOne(); });
  const nav = h('div.btn-group', null, h('button.btn.btn-sm.btn-icon', { 'aria-label': 'Previous window', onclick: () => { pos = (pos - 1 + byK[kind].length) % byK[kind].length; drawOne(); } }, icon('chevron-left')), h('button.btn.btn-sm.btn-icon', { 'aria-label': 'Next window', onclick: () => { pos = (pos + 1) % byK[kind].length; drawOne(); } }, icon('chevron')));
  const check = h('div.forge-live-sum', null, h('div.spinner.sm'), h('span', null, 'Running both networks on all ' + bte.n + ' window pairs…'));
  const one = block('The same simulated room, through both simulators', realityTag('live-ai'),
    h('div.row.wrap', null, kSeg, nav, cap, h('span.grow'), truth),
    h('div.forge-pair', null,
      h('figure', null, h('figcaption', null, 'Clean simulator: the physics only'), cvC, mC.el),
      h('figure', null, h('figcaption', null, 'Messy simulator: gain steps, drift, noise, lost packets'), cvM, mM.el)), check);

  // ---------- add the faults yourself ----------
  const sweepCv = h('canvas.forge-plot'), sweep = plotter(sweepCv, { l: 40 });
  const mk = (key, label, max, step, unit) => slider(label, { min: 0, max, step, value: 0, fmt: (v) => (key === 'loss' ? Math.round(v * 100) : v.toFixed(2)) + ' ' + unit, oninput: (v) => { faults[key] = v; drawFault(); runSweep(); } });
  const sl = { noise: mk('noise', 'Receiver noise', 1.5, 0.05, '%'), steps: mk('steps', 'Gain steps left in', 2, 0.1, '%'), drift: mk('drift', 'Slow drift', 2, 0.1, '%'), loss: mk('loss', 'Packets lost', 0.4, 0.02, '%') };
  const preset = h('button.btn.btn-sm', { onclick: () => { faults = { noise: +C.noise.messy_bin_std_pct.toFixed(2), steps: 0.3, drift: 0.5, loss: 0.08 }; for (const k in sl) sl[k].set(faults[k]); drawFault(); runSweep(); }, title: 'Noise set to what the messy simulator measures per bin; the other three are rough stand-ins.' }, 'Roughly an ESP32'), zero = h('button.btn.btn-sm.btn-ghost', { onclick: () => { faults = { noise: 0, steps: 0, drift: 0, loss: 0 }; for (const k in sl) sl[k].set(0); drawFault(); runSweep(); } }, 'Perfect receiver');
  const sweepNote = h('p.forge-p');
  const lab = block('Break the clean signal yourself', realityTag('live-algo'),
    h('div.forge-fault', null, h('div.forge-col', null, sl.noise.el, sl.steps.el, sl.drift.el, sl.loss.el, h('div.row', null, preset, zero)),
      h('figure', null, h('figcaption', null, 'The clean window above, with your faults'), cvF, mF.el)),
    h('div.forge-plot-wrap.short', { style: { height: '168px' } }, sweepCv), sweepNote, h('div.row', null, src('page', byK[0].length + ' clean empty rooms × 9 noise levels × 2 networks'), h('span.grow')));

  el.append(h('div.forge-ex', null,
    h('header.forge-ex-head', null, h('div', null, h('h2', null, 'Clean vs. messy simulator'),
      h('p', null, 'The network has only ever seen simulated people, so the simulator is the teacher. This is the design decision the project rests on: the simulator must reproduce the cheap receiver’s faults, or the network learns a world that does not exist.')),
      h('div.forge-ex-tags', null, realityTag('live-ai'))),
    h('div.forge-grid.forge-clean', null, four, h('div.forge-col', null, one, lab)),
    h('footer.forge-ex-foot', null,
      honest('The messy simulator’s faults are estimates of what an ESP32 does, not measurements of HOUND’s boards. If the real receiver is messier, or messy in another way, the rover’s network is in the same position as the clean-trained one here. Only recordings from the rover can settle it, and none exist yet.'),
      method('Both networks have the same 23,372 weights and training code; only the training data differs. Each uses its own threshold, set for 10 % false alarms on its own validation data (' + TH.clean.toFixed(2) + ' clean, ' + TH.messy.toFixed(2) + ' messy). The fault dials act on the normalised window and approximate esp32() in ml/simulate_csi.py; the four-cell table uses the real simulator.'),
      sources('tobin'))));

  function drawOne() {
    if (!X) return;
    const i = byK[kind][pos]; cap.textContent = KIND[kind] + ' ' + (pos + 1) + ' of ' + byK[kind].length + (bte.kind[i] === 0 ? (bte.fan[i] ? ', with a fan' : ', no fan') : (bte.lying[i] ? ', lying' : ', standing') + ', ' + bte.depth[i].toFixed(1) + ' m behind the wall');
    truth.className = 'tag ' + (kind ? 'tag-person' : 'tag-ok'); truth.textContent = kind ? 'Truth: someone is there' : 'Truth: empty';
    paintWindow(cvC, X.clean, i * 10400, 2); paintWindow(cvM, X.messy, i * 10400, 2); mC.set(X.clean, i * 10400); mM.set(X.messy, i * 10400); drawFault();
  }
  const fx = new Float32Array(10400);
  function drawFault() { if (!X) return; const i = byK[kind][pos]; addFaults(X.clean, i * 10400, fx, faults, 77 + i); paintWindow(cvF, fx, 0, 2); mF.set(fx, 0); }
  const LEVELS = [0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1.2, 1.5];
  async function runSweep() {
    if (!X) return; if (busy) { again = true; return; } busy = true;
    try {
      do {
        again = false; const f0 = { ...faults }, E = byK[0], n = E.length, big = new Float32Array(LEVELS.length * n * 10400), tmp = new Float32Array(10400);
        LEVELS.forEach((nz, l) => E.forEach((i, k) => { addFaults(X.clean, i * 10400, tmp, { ...f0, noise: nz }, 500 + i + l * 131); big.set(tmp, (l * n + k) * 10400); }));
        const [a, b] = await Promise.all([env.pool.forwardAll(doc.W.clean, { x: big }, LEVELS.length * n), env.pool.forwardAll(doc.W.messy, { x: big }, LEVELS.length * n)]);
        if (again) continue;
        const rate = (o, th) => LEVELS.map((nz, l) => { let c = 0; for (let k = 0; k < n; k++) if (softmax2(o.person[(l * n + k) * 2], o.person[(l * n + k) * 2 + 1]) > th) c++; return [nz, c / n]; });
        const rc = rate(a, TH.clean), rm = rate(b, TH.messy), half = rc.find((p) => p[1] >= 0.5);
        sweep.set({ x: { min: 0, max: 1.5, ticks: [0, 0.3, 0.6, 0.9, 1.2, 1.5], fmt: (v) => v.toFixed(1), label: 'receiver noise per 50 ms bin, % of the signal' }, y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => Math.round(v * 100) + '', label: '% of empty rooms called a person' },
          vlines: [{ at: C.noise.messy_bin_std_pct, color: '--text-3', label: 'the messy simulator: ' + C.noise.messy_bin_std_pct.toFixed(2) + ' %' }, { at: f0.noise, color: '--accent', dash: [] }],
          series: [{ pts: rc, color: '--danger', dots: 2.6, width: 2, label: 'clean-trained', labelAt: rc[rc.length - 1], dy: 14 }, { pts: rm, color: '--accent', dots: 2.6, width: 2, label: 'messy-trained', labelAt: rm[rm.length - 1] }] });
        sweepNote.replaceChildren(half ? 'With the other dials as set, the clean-trained network calls half of these empty rooms a person once the noise reaches about ' : 'With the other dials as set, the clean-trained network stays under half up to 1.5 % noise. ', half ? h('b.num', null, half[0].toFixed(1) + ' %') : null, half ? '. The messy simulator’s own noise, measured from its test windows, is ' + C.noise.messy_bin_std_pct.toFixed(2) + ' % per bin (the clean one: ' + C.noise.clean_bin_std_pct.toFixed(3) + ' %).' : null);
      } while (again);
    } catch (e) { console.error(e); ctx.shell.toast('The sweep could not run: ' + (e.message || e), { level: 'alert' }); }
    busy = false;
  }
  (async () => {
    try {
      const [cm, cc] = await Promise.all([env.loadSet('test'), env.loadSet('test_clean')]);
      X = { messy: Float32Array.from(cm, (v) => doc.dec[v + 128]), clean: Float32Array.from(cc, (v) => doc.dec[v + 128]) };
      drawOne();
      const runs = await Promise.all(['clean', 'messy'].flatMap((m) => ['clean', 'messy'].map((d) => env.pool.forwardAll(doc.W[m], { codes: d === 'clean' ? cc : cm }, bte.n).then((o) => ({ m, d, o })))));
      let ok = 0, worst = 0; for (const { m, d, o } of runs) { const refP = C.bundle_ref[m + '_on_' + d]; for (let i = 0; i < bte.n; i++) { const gap = Math.abs(softmax2(o.person[i * 2], o.person[i * 2 + 1]) - refP[i]); worst = Math.max(worst, gap); if (gap < 1e-3) ok++; } }
      check.className = 'forge-live-sum ' + (ok === bte.n * 4 ? 'ok' : 'bad');
      check.replaceChildren(icon(ok === bte.n * 4 ? 'check-circle' : 'alert', 15), h('span', null, 'Both networks, run in this page on all ' + bte.n + ' pairs: ', h('b.num', null, ok + ' of ' + bte.n * 4), ' probabilities match NumPy to within 0.001 (largest gap ', h('span.num', null, worst.toExponential(1)), ').'));
      runSweep();
    } catch (e) { console.error(e); check.className = 'forge-live-sum bad'; check.replaceChildren(icon('alert', 15), h('span', null, 'The windows did not load: ' + (e.message || e))); }
  })();
  return { onShow() { sweep.draw(); }, onHide() {} };
}
