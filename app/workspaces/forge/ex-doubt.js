// Exhibit 4. Knowing when it does not know: calibration, conformal prediction and out-of-distribution detection,
// all computed in the page from the real validation and test scores (and cross-checked against NumPy).
import { softmax2 } from './lib/net.js';
import { CORRUPTIONS, corrupt } from './lib/corrupt.js';
import { pct, plotter, paintWindow, src, fig, honest, method, sources, block, slider, seg, sigmoid, KIND } from './lib/ui.js';

export async function create(el, env) {
  const { ctx, doc } = env, { h, icon, realityTag } = ctx.kit;
  const V = doc.scores.val, T = doc.scores.test, U = doc.uncertainty, O = doc.ood, thr = doc.bundle.models.messy.threshold, bte = doc.bundle.test;
  const margin = (s) => Float64Array.from({ length: s.n }, (_, i) => s.personZ[i * 2 + 1] - s.personZ[i * 2]);
  const zv = margin(V), zt = margin(T), yv = V.kind.map((k) => (k > 0 ? 1 : 0)), yt = T.kind.map((k) => (k > 0 ? 1 : 0));

  // ================= calibration =================
  const nll = (z, y, a, b) => { let s = 0; for (let i = 0; i < z.length; i++) { const u = a * z[i] + b; s += Math.log1p(Math.exp(y[i] ? -u : u)); } return s / z.length; };
  function ece(z, y, a, b, bins = 15) { const n = new Float64Array(bins), ok = new Float64Array(bins), cf = new Float64Array(bins); for (let i = 0; i < z.length; i++) { const p = sigmoid(a * z[i] + b), c = Math.max(p, 1 - p), k = Math.min(bins - 1, Math.max(0, Math.ceil((c - 0.5) * 2 * bins) - 1)); n[k]++; cf[k] += c; if ((p > 0.5) === !!y[i]) ok[k]++; } let e = 0; for (let k = 0; k < bins; k++) if (n[k]) e += (n[k] / z.length) * Math.abs(ok[k] / n[k] - cf[k] / n[k]); return e; }
  function reliability(z, y, a, b, bins = 10) { const n = new Float64Array(bins), pos = new Float64Array(bins), sp = new Float64Array(bins); for (let i = 0; i < z.length; i++) { const p = sigmoid(a * z[i] + b), k = Math.min(bins - 1, Math.floor(p * bins)); n[k]++; sp[k] += p; pos[k] += y[i]; } const out = []; for (let k = 0; k < bins; k++) if (n[k] >= 5) out.push([sp[k] / n[k], pos[k] / n[k], n[k]]); return out; }
  function fitT() { let lo = Math.log(0.05), hi = Math.log(20); const g = 0.381966; for (let i = 0; i < 60; i++) { const a = lo + g * (hi - lo), b = hi - g * (hi - lo); if (nll(zv, yv, 1 / Math.exp(a), 0) < nll(zv, yv, 1 / Math.exp(b), 0)) hi = b; else lo = a; } return Math.exp((lo + hi) / 2); }
  function fitPlatt() { let a = 1, b = 0; for (let it = 0; it < 60; it++) { let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0; for (let i = 0; i < zv.length; i++) { const p = sigmoid(a * zv[i] + b), d = p - yv[i], w = p * (1 - p); g0 += d * zv[i]; g1 += d; h00 += w * zv[i] * zv[i]; h01 += w * zv[i]; h11 += w; } const det = h00 * h11 - h01 * h01 || 1e-12; a -= (h11 * g0 - h01 * g1) / det; b -= (h00 * g1 - h01 * g0) / det; } return [a, b]; }
  const Topt = fitT(), platt = fitPlatt();
  let calMode = 'temp', Tcur = Topt;
  const calCv = h('canvas.forge-plot'), calPlot = plotter(calCv, { l: 42, b: 34 });
  const eceB = fig('–', '%', 'calibration error, as trained', T.n + ' test windows', 'page'), eceA = fig('–', '%', 'after the fix', 'fitted on validation only', 'page', 'ok');
  const tSl = slider('Temperature', { min: -1.6, max: 2.2, step: 0.01, value: Math.log(Topt), fmt: (v) => Math.exp(v).toFixed(2), oninput: (v) => { Tcur = Math.exp(v); calSeg.set('temp', false); calMode = 'temp'; drawCal(); } });
  const calSeg = seg('Calibration method', [['none', 'As trained'], ['temp', 'Temperature', 'Divide the logit by one number'], ['platt', 'Scale and offset', 'Two numbers: also shifts the balance between the classes']], calMode, (v) => { calMode = v; if (v === 'temp') { Tcur = Topt; tSl.set(Math.log(Topt)); } drawCal(); });
  const calNote = h('p.forge-p');
  const ab = () => (calMode === 'none' ? [1, 0] : calMode === 'temp' ? [1 / Tcur, 0] : platt);
  function drawCal() {
    const [a, b] = ab(), before = reliability(zt, yt, 1, 0), after = reliability(zt, yt, a, b), e0 = ece(zt, yt, 1, 0), e1 = ece(zt, yt, a, b);
    eceB.set((e0 * 100).toFixed(1)); eceA.set((e1 * 100).toFixed(1)); tSl.input.disabled = calMode === 'platt';
    calPlot.set({ x: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => Math.round(v * 100) + '', label: 'the network says: P(person), %' }, y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => Math.round(v * 100) + '', label: 'how often a person was there, %' },
      series: [{ pts: [[0, 0], [1, 1]], color: '--line-3', width: 1, label: 'honest', labelAt: [0.8, 0.8], dy: 16 }, { pts: before, color: '--text-3', dots: 3, dash: [4, 3], label: 'as trained', labelAt: before[0] }, ...(calMode !== 'none' ? [{ pts: after, color: '--accent', dots: 3.4, width: 2, label: 'after', labelAt: after[after.length - 1] }] : [])] });
    const c = U.calibration;
    calNote.replaceChildren(calMode === 'temp' ? 'Best temperature on validation: ' : calMode === 'platt' ? 'Fitted on validation: scale ' + platt[0].toFixed(2) + ', offset ' + platt[1].toFixed(2) + '. ' : '', calMode === 'temp' ? h('b.num', null, Topt.toFixed(2)) : null, calMode === 'temp' ? (Topt > 1 ? ' (above 1: the network was overconfident). ' : ' (below 1: the network was underconfident). ') : null,
      'People are ' + pct(c.prior_test, 0) + ' of the test windows, but the training loss weighted both classes equally, so the raw probability runs low; one temperature cannot repair that tilt, a scale and an offset can. ',
      src('py', 'same sums: T ' + c.T.toFixed(2) + ', error ' + (c.ece_test_before * 100).toFixed(1) + ' → ' + (c.ece_test_temp * 100).toFixed(1) + ' % (temperature), ' + (c.ece_test_platt * 100).toFixed(1) + ' % (scale and offset)'));
  }
  const calBlock = block('When it says 80 %, is it right 80 % of the time?', realityTag('live-algo'),
    h('div.row.wrap', null, calSeg), h('div.forge-plot-wrap', { style: { height: '230px' } }, calCv), tSl.el, h('div.forge-figs', null, eceB, eceA), calNote);

  // ================= conformal =================
  let alpha = 0.1, cMode = 'marginal';
  const pv = Float64Array.from(zv, sigmoid), pt = Float64Array.from(zt, sigmoid);
  const qOf = (scores, a) => { const s = Float64Array.from(scores).sort(), n = s.length, k = Math.ceil((n + 1) * (1 - a)); return k > n ? Infinity : s[k - 1]; };
  const bars = [...KIND, 'All windows'].map((name) => { const seg4 = [0, 1, 2, 3].map((j) => h('i.forge-set-' + j)); const lab = h('em.num'); return { el: h('div.forge-setrow', null, h('span', null, name), h('div.forge-setbar', null, seg4), lab), seg4, lab }; });
  const covFig = fig('–', '%', 'of test windows: the set holds the truth', T.n + ' test windows', 'page', 'ok'), absStill = fig('–', '%', 'of still people: “not sure”', null, 'page', 'warn'), absMove = fig('–', '%', 'of moving people: “not sure”', null, 'page', 'person');
  const aSl = slider('Promise: right at least', { min: 60, max: 99, step: 1, value: 90, fmt: (v) => v + ' %', oninput: (v) => { alpha = 1 - v / 100; drawConf(); } });
  const cSeg = seg('Guarantee', [['marginal', 'Over all windows'], ['class', 'For each class', 'Empty rooms and people are calibrated separately, so each gets the promise']], cMode, (v) => { cMode = v; drawConf(); });
  const confNote = h('p.forge-p');
  function drawConf() {
    const s = Float64Array.from(pv, (p, i) => (yv[i] ? 1 - p : p));
    let q0, q1; if (cMode === 'marginal') q0 = q1 = qOf(s, alpha); else { q0 = qOf(s.filter((_, i) => !yv[i]), alpha); q1 = qOf(s.filter((_, i) => yv[i]), alpha); }
    const cnt = [0, 1, 2, 3].map(() => [0, 0, 0, 0]), tot = [0, 0, 0, 0]; let cov = 0, cov0 = 0, cov1 = 0, n0 = 0, n1 = 0;
    for (let i = 0; i < pt.length; i++) { const in1 = 1 - pt[i] <= q1, in0 = pt[i] <= q0, j = in1 && in0 ? 2 : in1 ? 1 : in0 ? 0 : 3, k = T.kind[i]; cnt[k][j]++; cnt[3][j]++; tot[k]++; tot[3]++; const ok = yt[i] ? in1 : in0; if (ok) cov++; if (yt[i]) { n1++; if (ok) cov1++; } else { n0++; if (ok) cov0++; } }
    bars.forEach((b, k) => { cnt[k].forEach((c, j) => { b.seg4[j].style.width = (100 * c / tot[k]) + '%'; b.seg4[j].title = ['Says “no one”', 'Says “person”', 'Says “not sure” (both)', 'Says neither'][j] + ': ' + c + ' of ' + tot[k]; }); b.lab.textContent = pct(cnt[k][2] / tot[k], 0); });
    covFig.set((100 * cov / pt.length).toFixed(1)); absStill.set((100 * cnt[1][2] / tot[1]).toFixed(0)); absMove.set((100 * cnt[2][2] / tot[2]).toFixed(0));
    covFig.className = 'forge-fig ' + (cov / pt.length >= 1 - alpha - 0.02 ? 'ok' : 'warn');
    const c = U.conformal['0.1'];
    confNote.replaceChildren('Promised ' + pct(1 - alpha, 0) + '; measured ' + pct(cov / pt.length) + ' (empty rooms ' + pct(cov0 / n0, 0) + ', people ' + pct(cov1 / n1, 0) + '). ', cMode === 'marginal' ? 'The promise is an average: one class can pay for the other. ' : 'Now each class is held to the promise on its own. ',
      'The price of keeping it is the amber share: answers the network hands back as “not sure”. ', src('py', 'at 90 %: coverage ' + pct(c.coverage) + ', not sure for ' + pct(c.abstain_by_kind[1], 0) + ' of still and ' + pct(c.abstain_by_kind[2], 0) + ' of moving people'));
  }
  const confBlock = block('An answer with a guarantee: “person”, “no one” or “not sure”', realityTag('live-algo'),
    h('div.row.wrap', null, cSeg), aSl.el,
    h('div.forge-sets', null, h('div.forge-setlegend', null, h('span', null, h('i.forge-set-0'), 'no one'), h('span', null, h('i.forge-set-1'), 'person'), h('span', null, h('i.forge-set-2'), 'not sure'), h('span', null, h('i.forge-set-3'), 'neither'), h('span.grow'), h('span.dim', null, 'not sure')), bars.map((b) => b.el)),
    h('div.forge-figs', null, covFig, absStill, absMove), confNote);

  // ================= out of distribution =================
  let oKind = 'interference', oLev = 2, oBusy = false, oAgain = false;
  const mu = O.muA, prec = O.precA;
  function maha(hid, off) { let best = Infinity; const d = new Float64Array(32); for (let k = 0; k < 3; k++) { for (let i = 0; i < 32; i++) d[i] = hid[off + i] - mu[k * 32 + i]; let s = 0; for (let i = 0; i < 32; i++) { let r = 0; for (let j = 0; j < 32; j++) r += prec[i * 32 + j] * d[j]; s += d[i] * r; } if (s < best) best = s; } return best; }
  const energy = (z, i) => { const a = z[i * 2], b = z[i * 2 + 1], m = Math.max(a, b); return -(m + Math.log(Math.exp(a - m) + Math.exp(b - m))); };
  const prevA = h('canvas.forge-px.forge-win'), prevB = h('canvas.forge-px.forge-win'), histCv = h('canvas.forge-plot'), histPlot = plotter(histCv, { l: 30, b: 34 });
  const det = fig('–', '%', 'of damaged windows flagged', bte.n + ' windows damaged here', 'page', 'danger'), fa = fig('–', '%', 'of empty rooms now called a person', null, 'page', 'person'), caught = fig('–', '%', 'of changed answers that were flagged', null, 'page');
  const oSeg = seg('Kind of damage', Object.entries(CORRUPTIONS).map(([k, c]) => [k, c.label.split(' ')[0] === 'Missed' ? 'Gain step' : c.label.split(' ')[0], c.help]), oKind, (v) => { oKind = v; oSl.set(2); oLev = 2; drawOod(); });
  const oSl = slider('How bad', { min: 0, max: 4, step: 1, value: 2, fmt: (v) => O.levels[oKind][v] + ' ' + CORRUPTIONS[oKind].unit, oninput: (v) => { oLev = v; drawOod(); } });
  const oBody = h('tbody'), oHelp = h('p.forge-p');
  let cleanX = null, cleanM = null, cleanSaid = null;
  async function ensureClean() {
    if (cleanX) return;
    const codes = await env.loadSet('test'); cleanX = new Float32Array(bte.n * 10400); for (let i = 0; i < cleanX.length; i++) cleanX[i] = doc.dec[codes[i] + 128];
    const out = await env.pool.forwardAll(doc.W.messy, { x: cleanX }, bte.n, { hidden: true });
    cleanM = Float64Array.from({ length: bte.n }, (_, i) => maha(out.hidden, i * 32)); cleanSaid = Uint8Array.from({ length: bte.n }, (_, i) => (softmax2(out.person[i * 2], out.person[i * 2 + 1]) > thr ? 1 : 0));
  }
  function logHist(vals, lo, hi, n = 34) { const b = new Float64Array(n); for (const v of vals) { const u = (Math.log10(Math.max(v, 1e-3)) - lo) / (hi - lo); b[Math.min(n - 1, Math.max(0, Math.floor(u * n)))]++; } const pts = []; for (let i = 0; i < n; i++) { const x0 = Math.pow(10, lo + (hi - lo) * i / n), x1 = Math.pow(10, lo + (hi - lo) * (i + 1) / n); pts.push([x0, b[i] / vals.length], [x1, b[i] / vals.length]); } return pts; }
  async function drawOod() {
    const rows = O.table[oKind]; oHelp.textContent = CORRUPTIONS[oKind].help;
    oBody.replaceChildren(...rows.map((r, i) => h('tr', { 'aria-selected': String(i === oLev), tabIndex: 0, role: 'button', onclick: () => { oSl.set(i); oLev = i; drawOod(); }, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); oSl.set(i); oLev = i; drawOod(); } } },
      h('td.num', null, r.sev + ' ' + CORRUPTIONS[oKind].unit), h('td.num', null, pct(r.maha_detect, 0)), h('td.num', null, pct(r.energy_detect, 0)), h('td.num', null, pct(r.empty_false_alarm, 0)), h('td.num', null, pct(r.answers_changed, 0)), h('td.num', null, pct(r.changed_caught, 0)))));
    if (oBusy) { oAgain = true; return; } oBusy = true;
    try {
      do {
        oAgain = false; await ensureClean();
        const kind = oKind, lev = oLev, sev = O.levels[kind][lev], X = new Float32Array(cleanX.length), tmp = new Float32Array(10400);
        for (let i = 0; i < bte.n; i++) { corrupt(cleanX, i * 10400, tmp, kind, sev, 9000 + i * 7 + lev); X.set(tmp, i * 10400); }
        const ex = bte.kind.indexOf(0); paintWindow(prevA, cleanX, ex * 10400, 2); paintWindow(prevB, X, ex * 10400, 2);
        const out = await env.pool.forwardAll(doc.W.messy, { x: X }, bte.n, { hidden: true });
        if (kind !== oKind || lev !== oLev) { oAgain = true; continue; }
        const m = Float64Array.from({ length: bte.n }, (_, i) => maha(out.hidden, i * 32)); let flagged = 0, emptyP = 0, nEmpty = 0, changed = 0, changedCaught = 0;
        for (let i = 0; i < bte.n; i++) { const said = softmax2(out.person[i * 2], out.person[i * 2 + 1]) > thr ? 1 : 0, f = m[i] > O.thr_maha; if (f) flagged++; if (bte.kind[i] === 0) { nEmpty++; emptyP += said; } if (said !== cleanSaid[i]) { changed++; if (f) changedCaught++; } }
        det.set((100 * flagged / bte.n).toFixed(0)); fa.set((100 * emptyP / nEmpty).toFixed(0)); caught.set(changed ? (100 * changedCaught / changed).toFixed(0) : '–'); caught.lastChild && (caught.querySelector('.forge-fig-l').textContent = changed ? 'of the ' + changed + ' changed answers were flagged' : 'no answer changed');
        const all = [...cleanM, ...m], lo = Math.floor(Math.log10(Math.max(1, Math.min(...all)))), hi = Math.ceil(Math.log10(Math.max(...all)) + 0.01), a = logHist(cleanM, lo, hi), b = logHist(m, lo, hi), ymax = Math.max(...a.map((p) => p[1]), ...b.map((p) => p[1])) * 1.15;
        const ticks = []; for (let e = lo; e <= hi; e++) ticks.push(Math.pow(10, e));
        histPlot.set({ x: { min: Math.pow(10, lo), max: Math.pow(10, hi), log: true, ticks, fmt: (v) => (v >= 1000 ? v / 1000 + 'k' : String(v)), label: 'distance from the training windows (Mahalanobis, squared)' }, y: { min: 0, max: ymax, ticks: [] },
          vlines: [{ at: O.thr_maha, color: '--text', label: 'flag above ' + O.thr_maha.toFixed(0), dash: [3, 3] }],
          series: [{ pts: a, color: '--text-3', fill: 'rgba(128,139,153,0.22)', width: 1.2, label: 'as recorded', labelAt: a[Math.max(0, a.findIndex((p) => p[1] === Math.max(...a.map((q) => q[1]))))] }, { pts: b, color: '--danger', fill: 'rgba(255,77,94,0.16)', width: 1.4, label: 'damaged', labelAt: b[Math.max(0, b.findIndex((p) => p[1] === Math.max(...b.map((q) => q[1]))) + 1)] }] });
      } while (oAgain);
    } catch (e) { console.error(e); ctx.shell.toast('The damaged windows could not be scored: ' + (e.message || e), { level: 'alert' }); }
    oBusy = false;
  }
  const oodBlock = block('Would it notice that the input is broken?', realityTag('live-algo'),
    h('div.row.wrap', null, oSeg), oSl.el, oHelp,
    h('div.forge-winpair', null, h('figure', null, prevA, h('figcaption', null, 'An empty room, as recorded')), h('figure', null, prevB, h('figcaption', null, 'The same window, damaged'))),
    h('div.forge-plot-wrap.short', { style: { height: '140px' } }, histCv), h('div.forge-figs', null, det, fa, caught),
    h('div.forge-gc-wrap', null, h('table.table.dense.forge-ood', null, h('thead', null, h('tr', null, h('th.num', null, 'Damage'), h('th.num', { title: 'Mahalanobis distance in the 32-unit hidden layer' }, 'Flagged'), h('th.num', { title: 'Energy score from the two person logits' }, 'By energy'), h('th.num', { title: 'Empty rooms the network now calls a person (11 % undamaged)' }, 'False alarms'), h('th.num', null, 'Answers changed'), h('th.num', null, 'Of those, flagged'))), oBody)),
    h('div.row', null, src('py', 'all 955 test windows; flag rate on undamaged test windows ' + pct(O.clean_flagged.maha, 0)), h('span.grow')));

  el.append(h('div.forge-ex', null,
    h('header.forge-ex-head', null, h('div', null, h('h2', null, 'Knowing when it does not know'),
      h('p', null, 'A detector that is wrong should at least say “I am not sure”. Three tools from the research on trustworthy machine learning, each fitted on the validation windows and then checked on the 955 test windows it never saw.')),
      h('div.forge-ex-tags', null, realityTag('live-algo'))),
    h('div.forge-grid.forge-doubt', null, calBlock, confBlock, oodBlock),
    h('footer.forge-ex-foot', null,
      honest('All three guarantees hold only while the field looks like the simulator: same kind of room, wall and radio. A real building breaks that assumption on day one, so each would need fitting again on real recordings, which do not exist yet. The damage test covers four faults we invented; a real fault may look like none of them.'),
      method('Calibration error: 15 equal-width confidence bins. Conformal: split conformal with score 1 − P(true class), quantile ⌈(n+1)(1−α)⌉/n of ' + V.n + ' validation windows. Out of distribution: Mahalanobis distance to the nearest of three class means (empty, still, moving) with a shared covariance, fitted on ' + O.fit_on + ' training windows; flag above the 95th percentile of validation.'),
      sources('guo', 'angelopoulos', 'lee', 'liu'))));
  drawCal(); drawConf(); drawOod();
  return { onShow() { calPlot.draw(); histPlot.draw(); }, onHide() {} };
}
