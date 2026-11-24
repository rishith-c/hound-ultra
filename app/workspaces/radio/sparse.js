// Exhibit 05: seeing with too few measurements. The same room and forward model as exhibit 04, but only a random
// subset of the (rover position, frequency) samples is kept. Left: plain back-projection of that subset. Right: an
// L1 reconstruction (ISTA and FISTA) with the real forward operator A as the sensing matrix, iterating in view.
import * as core from './sarcore.js';
const { C0, ROOM } = core;

export const meta = {
  title: 'Seeing with too few measurements',
  labels: ['concept', 'live-algo'],
  labelNote: 'Concept: the radar that would take these samples. Live: the sensing matrix, both solvers and every score, computed in this page.',
  plain: [
    'If a room holds only a few strong reflectors, most radar samples repeat what the others already said. Keep a random few, and ask for the emptiest room that still explains them.',
    'It works until it does not: with too few samples, too many reflectors, or a model that is slightly wrong, the answer falls apart quickly.',
  ],
  cites: [
    { by: 'R. Baraniuk and P. Steeghs', year: 2007, title: 'Compressive radar imaging', venue: 'IEEE Radar Conference', url: 'https://doi.org/10.1109/RADAR.2007.374203' },
    { by: 'Y.-S. Yoon and M. G. Amin', year: 2008, title: 'Compressed sensing technique for high-resolution radar imaging', venue: 'Proc. SPIE 6968', url: 'https://doi.org/10.1117/12.777175' },
    { by: 'I. Daubechies, M. Defrise, C. De Mol', year: 2004, title: 'An iterative thresholding algorithm for linear inverse problems with a sparsity constraint (ISTA)', venue: 'Comm. Pure Appl. Math. 57(11)', url: 'https://doi.org/10.1002/cpa.20042' },
    { by: 'A. Beck and M. Teboulle', year: 2009, title: 'A fast iterative shrinkage-thresholding algorithm for linear inverse problems (FISTA)', venue: 'SIAM J. Imaging Sciences 2(1)', url: 'https://doi.org/10.1137/080716542' },
  ],
  honest: 'The scene must really be a few point reflectors, and the model of the wall, the rover positions and the frequencies must be exact. Neither holds in a collapsed room. It also needs the same coherent wideband radar and millimetre odometry as exhibit 04, which HOUND does not have: its radars report tracks and presence, not raw phase.',
  unknown: 'how sparse a real room looks at these frequencies, and how much model error the method tolerates there. Nothing here has been measured.',
};

const GW = 48, GH = 36, NPX = GW * GH, PXM = ROOM.w / GW, NP = 40, NQ = 32, MF = NP * NQ, F0 = 2e9, BW = 2e9, TRACK = 6;
const MAXIT = 300, DRANGE = 30, THR = 0.1, FRACS = [2, 3, 4, 6, 8, 12, 18, 25, 35, 50, 70, 100], DRAWS = 2, SWEEP_IT = 120, POWER_IT = 24;
const FW = GW * 3, FH = GH * 3, NFINE = FW * FH, PM = 1024, DFQ = BW / (NQ - 1), RUQ = C0 / (2 * DFQ), FCQ = F0 + BW / 2;
const nfmt = (n) => n.toLocaleString('en-US');

export function create(stage, side, ctx, lab) {
  const { h, icon, tok, rgba, fx } = lab;
  const p = { frac: 20, K: 3, off: false, offAmt: 25, snr: 10, lam: 5, algo: 'fista', seed: 1 };
  // grid (row 0 is the far side of the room) and the full measurement lattice
  const gx = new Float64Array(NPX), gy = new Float64Array(NPX);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { gx[j * GW + i] = (i + 0.5) * PXM; gy[j * GW + i] = (GH - 1 - j + 0.5) * PXM; }
  const mx = new Float64Array(MF), mf = new Float64Array(MF);
  for (let a = 0; a < NP; a++) for (let b = 0; b < NQ; b++) { mx[a * NQ + b] = ROOM.w / 2 - TRACK / 2 + (TRACK * a) / (NP - 1); mf[a * NQ + b] = F0 + (BW * b) / (NQ - 1); }
  let A = null, built = 0;
  // a finer grid (3 x 3 per pixel) for drawing the back-projection, so its rings and sidelobes are seen as they are
  const fxs = new Float32Array(NFINE), fys = new Float32Array(NFINE);
  for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) { fxs[j * FW + i] = ((i + 0.5) * PXM) / 3; fys[j * FW + i] = ROOM.d - ((j + 0.5) * PXM) / 3; }
  const prof = core.profiler(NQ, PM, false);
  function fineBp(rows, yr, yi) {
    const aR = new Float64Array(NFINE), aI = new Float64Array(NFINE), ws = new Float64Array(NFINE), out = new Float32Array(NFINE);
    const sr = new Float64Array(NQ), si = new Float64Array(NQ), pr = new Float64Array(PM), pi = new Float64Array(PM);
    let q = 0;
    for (let a = 0; a < NP; a++) {
      sr.fill(0); si.fill(0); let cnt = 0;
      while (q < rows.length && rows[q] < (a + 1) * NQ) { sr[rows[q] - a * NQ] = yr[q]; si[rows[q] - a * NQ] = yi[q]; cnt++; q++; }
      if (!cnt) continue;
      prof(sr, si, pr, pi); core.bpAddMF(aR, aI, ws, fxs, fys, NFINE, mx[a * NQ], pr, pi, PM, RUQ, FCQ, cnt);
    }
    for (let i = 0; i < NFINE; i++) out[i] = (Math.hypot(aR[i], aI[i]) * NQ) / Math.sqrt(ws[i] || 1);
    return out;
  }
  // twelve reflectors, fixed: the three of exhibit 04 snapped to pixel centres, then nine seeded ones
  const pool = core.DEFAULT_TARGETS.map((t) => ({ i: Math.min(GW - 1, Math.floor(t.x / PXM)), j: GH - 1 - Math.min(GH - 1, Math.floor(t.y / PXM)), a: t.a < 0.6 ? 0.6 : t.a }));
  { const r = core.rng(11); while (pool.length < 12) { const i = 3 + Math.floor(r() * (GW - 6)), j = 4 + Math.floor(r() * (GH - 8)); if (pool.some((t) => Math.abs(t.i - i) < 3 && Math.abs(t.j - j) < 3)) continue; pool.push({ i, j, a: 0.5 + 0.5 * r() }); } }
  const offs = (() => { const r = core.rng(21); return pool.map(() => [r() * 2 - 1, r() * 2 - 1]); })();
  const perm = (seed) => { const idx = Array.from({ length: MF }, (_, i) => i), r = core.rng(seed * 101 + 5); for (let i = MF - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = idx[i]; idx[i] = idx[j]; idx[j] = t; } return idx; };
  const scene = () => pool.slice(0, p.K).map((t, k) => { const o = p.off ? (p.offAmt / 100) * PXM : 0; return { x: gx[t.j * GW + t.i] + offs[k][0] * o, y: gy[t.j * GW + t.i] + offs[k][1] * o, a: t.a, i: t.i, j: t.j }; });

  // ---- a problem instance ----
  function makeProblem(frac, seed, noiseSeed, fine) {
    const keep = Math.max(8, Math.round((frac / 100) * MF)), rows = Int32Array.from(perm(seed).slice(0, keep).sort((a, b) => a - b));
    const tg = scene(), yr = new Float64Array(keep), yi = new Float64Array(keep);
    core.measure(mx, mf, rows, tg, yr, yi); core.addNoise(yr, yi, keep, core.noiseSigma(p.snr), core.rng(noiseSeed));
    const P = core.problem(A, rows, yr, yi);
    const truth = tg.map((t) => ({ i: t.i, j: t.j, a: t.a * P.nrm[t.j * GW + t.i] })), zref = Math.max(...truth.map((t) => t.a));
    const br = new Float64Array(NPX), bi = new Float64Array(NPX), bp = new Float64Array(NPX); P.BH(yr, yi, br, bi);
    for (let i = 0; i < NPX; i++) bp[i] = Math.hypot(br[i], bi[i]);
    return { frac, keep, rows, tg, P, truth, zref, bp, bpScore: core.score(bp, GW, GH, truth, THR), fine: fine ? fineBp(rows, yr, yi) : null };
  }
  const magOf = (S, out) => { for (let i = 0; i < NPX; i++) out[i] = Math.hypot(S.zr[i], S.zi[i]); return out; };

  let Q = null, stale = true, phase = 'build', wantRun = true, powerLeft = 0, lamAbs = 0, lamMax = 0;
  let sol = null, hist = null, scores = { ista: null, fista: null }, flat = 0;
  const mags = { ista: new Float64Array(NPX), fista: new Float64Array(NPX) };
  let trail = [], sweep = null, sweepRes = null, dirty = true, frame = 0;
  const cvs = { bp: null, l1: null };
  const sceneKey = () => [p.K, p.off ? p.offAmt : 0, p.snr, p.lam].join('|');

  function startSolve() {
    lamMax = Q.P.lambdaMax(); lamAbs = (p.lam / 100) * lamMax;
    sol = { ista: core.solver(Q.P, lamAbs, false), fista: core.solver(Q.P, lamAbs, true) };
    hist = { ista: { obj: [], err: [] }, fista: { obj: [], err: [] } }; scores = { ista: null, fista: null }; flat = 0;
    mags.ista.fill(0); mags.fista.fill(0);
    phase = wantRun ? 'run' : 'ready';
  }
  function iterate() {
    let moved = 0;
    for (const k of ['ista', 'fista']) {
      const S = sol[k], prev = S.obj, o = S.step(); magOf(S, mags[k]); scores[k] = core.score(mags[k], GW, GH, Q.truth, THR);
      hist[k].obj.push(o); hist[k].err.push(scores[k].rel); if (!(Math.abs(prev - o) < 1e-9 * o)) moved++;
    }
    flat = moved ? 0 : flat + 1;
    if (sol.ista.it >= MAXIT || flat >= 8) { phase = 'done'; const s = scores[p.algo]; trail.push({ key: sceneKey(), frac: p.frac, l1: s.rel, bp: Q.bpScore.rel }); if (trail.length > 60) trail.shift(); syncButtons(); }
  }

  // ---- the sweep: error against the fraction kept, for back-projection and L1 (FISTA), DRAWS random subsets each ----
  function startSweep() {
    if (!A || built < MF) return;
    const tasks = []; for (const f of FRACS) for (let d = 0; d < DRAWS; d++) tasks.push({ f, d });
    sweep = { key: sceneKey(), tasks, at: 0, cur: null, total: tasks.length };
    sweepRes = { key: sweep.key, pts: FRACS.map((f) => ({ f, bp: [], l1: [], hit: [], fals: [] })), done: false };
    syncButtons(); dirty = true;
  }
  function pumpSweep(budget) {
    const t0 = performance.now();
    while (sweep && performance.now() - t0 < budget) {
      if (sweep.key !== sceneKey()) { sweep = null; sweepRes = null; break; }
      let c = sweep.cur;
      if (!c) { const tk = sweep.tasks[sweep.at], q = makeProblem(tk.f, 50 + tk.d * 13 + sweep.at, 700 + sweep.at); c = sweep.cur = { tk, q, pw: 16, S: null, it: 0 }; continue; }
      if (c.pw > 0) { c.q.P.power(); c.pw--; continue; }
      if (!c.S) { c.S = core.solver(c.q.P, (p.lam / 100) * c.q.P.lambdaMax(), true); continue; }
      if (c.it < SWEEP_IT) { c.S.step(); c.it++; continue; }
      const s = core.score(magOf(c.S, new Float64Array(NPX)), GW, GH, c.q.truth, THR), r = sweepRes.pts[FRACS.indexOf(c.tk.f)];
      r.bp.push(c.q.bpScore.rel); r.l1.push(s.rel); r.hit.push(s.hit); r.fals.push(s.fals);
      sweep.cur = null; sweep.at++; dirty = true;
      if (sweep.at >= sweep.total) { sweepRes.done = true; sweep = null; }
    }
    syncSweep();
  }

  // ---- DOM ----
  const simTag = () => h('span.tag.tag-sim', { title: 'Simulated samples of simulated reflectors. HOUND has no imaging radar.' }, 'Simulated');
  const btnRun = h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => { if (phase === 'run') { phase = 'ready'; wantRun = false; } else if (Q && sol && Number.isFinite(Q.P.L)) { wantRun = true; startSolve(); } else wantRun = true; syncButtons(); dirty = true; kick(); } });
  const segAlgo = lab.seg([['ista', 'ISTA', 'Iterative shrinkage-thresholding: a gradient step, then shrink small values to zero'], ['fista', 'FISTA', 'The same step with momentum from the previous iterate']], p.algo, (v) => { p.algo = v; dirty = true; kick(); }, { label: 'Solver shown' });
  const btnRedraw = h('button.btn.btn-sm', { type: 'button', title: 'Pick a different random subset of the same size', onclick: () => { p.seed++; changed(); } }, icon('rotate', 14), 'Re-draw the random subset');
  const btnSweep = h('button.btn.btn-sm', { type: 'button', onclick: () => { if (sweep) { sweep = null; sweepRes = null; syncButtons(); syncSweep(); dirty = true; } else startSweep(); kick(); } });
  const figBp = lab.figure('Back-projection of the kept samples', { tag: simTag(), cls: 'radio-sparse-img' });
  const figL1 = lab.figure('L1 reconstruction', { tag: h('div.radio-sparse-head', null, segAlgo, btnRun), cls: 'radio-sparse-img' });
  const figMask = lab.figure('Samples kept', { cls: 'radio-sparse-chart' });
  const figConv = lab.figure('Objective and error, iteration by iteration', { cls: 'radio-sparse-chart' });
  const figSweep = lab.figure('Error against the share of samples kept', { tag: btnSweep, cls: 'radio-sparse-chart' });
  figBp.setCaption('Each kept sample is smeared back along its range ring. The gaps leave sidelobes everywhere.');
  figL1.setCaption('The sparsest ' + GW + ' × ' + GH + ' image (' + fx(PXM * 100, 1) + ' cm pixels) that explains the same samples.');
  figMask.setCaption('One square per position and frequency. Exhibit 04 records 401 × 201.');
  figConv.setCaption('Both minimise ½‖y − Az‖² + λ‖z‖₁. Error is against the simulated truth.');
  figSweep.setCaption('');
  stage.append(h('div.radio-grid.radio-sparse-grid', null, h('div.radio-sparse-top', null, figBp, figL1), h('div.radio-sparse-bottom', null, figMask, figConv, figSweep)));
  cvs.bp = lab.canvas(figBp.body, (c, w, hh) => drawImage(c, w, hh, 'bp'), { label: 'Back-projection image of the kept samples' });
  cvs.l1 = lab.canvas(figL1.body, (c, w, hh) => drawImage(c, w, hh, 'l1'), { label: 'L1 reconstruction, updating each iteration' });
  const cvMask = lab.canvas(figMask.body, drawMask, { label: 'Which position and frequency samples were kept' });
  const cvConv = lab.canvas(figConv.body, drawConv, { label: 'Objective and relative error per iteration for ISTA and FISTA' });
  const cvSweep = lab.canvas(figSweep.body, drawSweep, { label: 'Reconstruction error against the fraction of samples kept' });
  const hov = { bp: null, l1: null };
  for (const k of ['bp', 'l1']) { const el = cvs[k].el; el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); hov.bp = hov.l1 = null; hov[k] = [e.clientX - r.left, e.clientY - r.top]; dirty = true; kick(); }); el.addEventListener('pointerleave', () => { hov[k] = null; dirty = true; kick(); }); }

  function changed() { stale = true; dirty = true; kick(); }
  const sFrac = lab.slider({ label: 'Samples kept', min: 2, max: 100, step: 1, value: p.frac, format: (v) => v + ' %', oninput: (v) => { p.frac = v; changed(); }, title: 'Share of the ' + nfmt(MF) + ' position and frequency samples that is kept, chosen at random' });
  const sSnr = lab.slider({ label: 'Signal to noise', min: -20, max: 30, step: 1, value: p.snr, format: (v) => lab.sgn(v, 0) + ' dB', oninput: (v) => { p.snr = v; changed(); }, title: 'Per sample, for a unit reflector 4 m away' });
  const sK = lab.slider({ label: 'Reflectors', min: 1, max: 12, step: 1, value: p.K, format: (v) => String(v), oninput: (v) => { p.K = v; changed(); }, title: 'How many point reflectors are in the room. More reflectors need more samples.' });
  const sOff = lab.slider({ label: 'Shift', min: 5, max: 50, step: 5, value: p.offAmt, format: (v) => '±' + v + ' % px', oninput: (v) => { p.offAmt = v; if (p.off) changed(); }, title: 'How far each reflector is moved from its pixel centre, as a share of a pixel (' + fx(PXM * 100, 1) + ' cm)' });
  const tOff = lab.toggle('Move the reflectors off the pixel centres', p.off, (v) => { p.off = v; sOff.input.disabled = !v; offNote.hidden = !v; changed(); }, { title: 'The grid assumes reflectors sit exactly on pixel centres. Real ones do not.' });
  sOff.input.disabled = true;
  const offNote = h('div.note.warn.radio-sparse-note', { hidden: true }, icon('alert', 15), h('span', null, 'Off the grid, no column of A matches a reflector. At 3 GHz a range error of 2.5 cm is a quarter turn of phase, so the nearest pixel fits badly and the solver spreads the echo over many wrong pixels.'));
  const sLam = lab.slider({ label: 'Sparsity weight λ', min: 1, max: 30, step: 1, value: p.lam, format: (v) => v + ' % λmax', oninput: (v) => { p.lam = v; if (Q && Number.isFinite(Q.P.L) && phase !== 'power') { wantRun = true; startSolve(); syncButtons(); } dirty = true; kick(); }, title: 'How hard small values are pushed to zero, as a share of the λ that would zero the whole image' });
  const st = {
    m: lab.stat('Samples kept', ''), n: lab.stat('Unknown pixels', ''),
    L: lab.stat('Largest singular value²', '', { title: 'Of the column-normalised operator, by power iteration. The step size is its inverse.' }), step: lab.stat('Step 1 / L', ''),
    lam: lab.stat('λ', ''), it: lab.stat('Iteration', ''),
  };
  const cell = () => h('td.num'), tb = { rel: [cell(), cell(), cell()], hit: [cell(), cell(), cell()], fals: [cell(), cell(), cell()] };
  const table = h('table.table.dense.radio-sparse-table', null,
    h('thead', null, h('tr', null, h('th', null, ''), h('th.num', null, 'Back-proj.'), h('th.num', null, 'ISTA'), h('th.num', null, 'FISTA'))),
    h('tbody', null,
      h('tr', null, h('td', { title: 'Relative L2 error of the magnitude image against the simulated truth' }, 'Relative error'), ...tb.rel),
      h('tr', null, h('td', { title: 'Reflectors with an image peak within one pixel' }, 'Reflectors found'), ...tb.hit),
      h('tr', null, h('td', { title: 'Peaks above -20 dB of the brightest pixel that are further than one pixel from every reflector' }, 'False peaks'), ...tb.fals)));
  const sweepBar = h('div.bar', null, h('i')), sweepTxt = h('p.radio-sparse-sweeptxt.num');
  side.append(
    lab.group('Samples', sFrac, sSnr, h('div.radio-row', null, btnRedraw)),
    lab.group('Scores against the simulated truth', table),
    lab.group('Scene, simulated', sK, tOff, sOff, offNote),
    lab.group('Solver', sLam, h('div.radio-stats', null, st.m, st.n, st.L, st.step, st.lam, st.it)),
    lab.group('The sweep', h('p', null, 'Runs FISTA for ' + SWEEP_IT + ' iterations at ' + FRACS.length + ' sample shares, ' + DRAWS + ' random subsets each, with the current scene, noise and λ.'), sweepBar, sweepTxt),
    lab.group('Assumed in this simulation',
      h('p', null, 'Full set: ' + NP + ' rover positions over ' + TRACK + ' m × ' + NQ + ' frequencies from ' + F0 / 1e9 + ' to ' + (F0 + BW) / 1e9 + ' GHz = ' + nfmt(MF) + ' samples. Grid: ' + GW + ' × ' + GH + ' = ' + nfmt(NPX) + ' pixels over the first ' + ROOM.d + ' m of ' + ROOM.name + '. The grid is kept this small so the matrix A (' + nfmt(MF) + ' × ' + nfmt(NPX) + ' complex numbers) fits in the page.'),
      h('p', null, 'Same wall and echo model as exhibit 04; the wall echo is taken as already removed. Samples come from the reflectors\' true positions, then noise is added. Brightness is echo strength (reflectivity × path loss), in decibels below the strongest true echo.')));

  function syncButtons() {
    btnRun.replaceChildren(icon(phase === 'run' ? 'pause' : 'play', 14), phase === 'run' ? 'Stop' : 'Reconstruct');
    btnSweep.replaceChildren(icon(sweep ? 'stop' : 'play', 14), sweep ? 'Stop the sweep' : sweepRes && sweepRes.done && sweepRes.key === sceneKey() ? 'Run the sweep again' : 'Run the sweep');
  }
  function syncSweep() {
    const run = !!sweep, frac = run ? sweep.at / sweep.total : sweepRes && sweepRes.done ? 1 : 0; sweepBar.firstChild.style.width = frac * 100 + '%';
    sweepTxt.textContent = run ? 'subset ' + (sweep.at + 1) + ' of ' + sweep.total + ' · ' + sweep.tasks[sweep.at].f + ' % kept' + (sweep.cur && sweep.cur.S ? ' · iteration ' + sweep.cur.it : '') : sweepRes && sweepRes.done ? 'done: ' + FRACS.length * DRAWS + ' reconstructions' : 'not run for this scene yet';
  }
  const f2 = (v) => (Number.isFinite(v) ? (v >= 10 ? fx(v, 1) : fx(v, 2)) : '–');
  function syncStats() {
    st.n.set(nfmt(NPX)); st.m.set(Q ? nfmt(Q.keep) + ' / ' + nfmt(MF) : '–');
    const L = Q ? Q.P.L : NaN; st.L.set(Number.isFinite(L) ? fx(L, 2) : '–'); st.step.set(Number.isFinite(L) ? (1 / L).toFixed(4) : '–');
    st.lam.set(sol ? lamAbs.toExponential(2) : '–'); st.it.set(sol ? sol.ista.it + ' / ' + MAXIT : phase === 'power' ? 'power ' + (POWER_IT - powerLeft) : '–');
    const K = p.K, col = (i, s) => { tb.rel[i].textContent = s ? f2(s.rel) : '–'; tb.hit[i].textContent = s ? s.hit + ' of ' + K : '–'; tb.fals[i].textContent = s ? String(s.fals) : '–'; tb.hit[i].dataset.tone = s ? (s.hit === K ? 'ok' : 'warn') : ''; tb.fals[i].dataset.tone = s ? (s.fals === 0 ? 'ok' : 'warn') : ''; };
    col(0, Q && Q.bpScore); col(1, scores.ista); col(2, scores.fista);
    figBp.setTitle('Back-projection of ' + (Q ? nfmt(Q.keep) : '…') + ' samples: smeared, with sidelobes');
    const nm = p.algo === 'fista' ? 'FISTA' : 'ISTA';
    figL1.setTitle(phase === 'build' ? 'L1 reconstruction: building the sensing matrix' : phase === 'power' ? 'L1 reconstruction: finding the step size' : 'L1 reconstruction, ' + nm + (sol ? ', iteration ' + sol[p.algo].it : ''));
    figMask.setTitle(Q ? 'Kept: ' + nfmt(Q.keep) + ' of ' + nfmt(MF) + ' samples' : 'Samples kept');
    const sr = sweepRes && sweepRes.key === sceneKey() ? sweepRes : null;
    if (sr && sr.done) {
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length; let cliff = null;
      for (let i = sr.pts.length - 1; i >= 0; i--) { if (Math.min(...sr.pts[i].hit) >= p.K && mean(sr.pts[i].l1) < 0.5) cliff = sr.pts[i].f; else break; }
      figSweep.setTitle(cliff == null ? 'L1 does not hold at any share for this scene' : cliff <= FRACS[0] ? 'L1 holds all the way down to ' + cliff + ' % for this scene' : 'L1 holds down to ' + cliff + ' % of the samples, then fails');
      figSweep.setCaption('Mean of ' + DRAWS + ' random subsets per share. "Holds" means every reflector found and relative error under 0.5.');
    } else { figSweep.setTitle('Error against the share of samples kept'); figSweep.setCaption(sweep ? 'Sweeping: each dot is one full reconstruction, computed now.' : 'Each reconstruction you run leaves a ring here. Run the sweep to trace both curves.'); }
  }

  // ---- drawing ----
  const MONO = () => '500 10.5px ' + tok('--mono');
  const heat = { bp: null, l1: null }, dbBuf = new Float32Array(NPX), dbFine = new Float32Array(NFINE);
  function drawImage(c, w, hh, which) {
    const ml = 30, mr = 52, mt = 8, mb = 34, s = Math.min((w - ml - mr) / ROOM.w, (hh - mt - mb) / ROOM.d);
    if (s < 5) return;
    const ox = Math.round(ml + (w - ml - mr - s * ROOM.w) / 2), oy = Math.round(mt + (hh - mt - mb - s * ROOM.d) / 2), X = (x) => ox + x * s, Y = (y) => oy + (ROOM.d - y) * s;
    const x0 = X(0), x1 = X(ROOM.w), yT = Y(ROOM.d), yB = Y(0), iw = x1 - x0, ih = yB - yT;
    c.fillStyle = tok('--heat-0'); c.fillRect(x0, yT, iw, ih);
    const mag = which === 'bp' ? Q && Q.bp : sol && mags[p.algo], sc = which === 'bp' ? Q && Q.bpScore : scores[p.algo];
    if (mag && Q && which === 'bp' && Q.fine) {
      for (let i = 0; i < NFINE; i++) dbFine[i] = 20 * Math.log10(Math.max(Q.fine[i] / Q.zref, 1e-6));
      heat.bp = lab.heatImage(dbFine, FW, FH, -DRANGE, 0, heat.bp); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(heat.bp, x0, yT, iw, ih);
    } else if (mag && Q) {
      for (let i = 0; i < NPX; i++) dbBuf[i] = 20 * Math.log10(Math.max(mag[i] / Q.zref, 1e-6));
      heat[which] = lab.heatImage(dbBuf, GW, GH, -DRANGE, 0, heat[which]); c.imageSmoothingEnabled = false; c.drawImage(heat[which], x0, yT, iw, ih); c.imageSmoothingEnabled = true;
    }
    c.lineWidth = 1; c.font = MONO(); c.fillStyle = tok('--text-3');
    for (let m = 0; m <= ROOM.w; m += 1) { const g = Math.round(X(m)) + 0.5; c.strokeStyle = tok('--line-3'); c.beginPath(); c.moveTo(g, yB); c.lineTo(g, yB + 4); c.stroke(); if (m % 3 === 0) { c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(String(m), g, yB + 6); } }
    for (let m = 0; m <= 6; m += 1) { const g = Math.round(Y(m)) + 0.5; c.strokeStyle = tok('--line-3'); c.beginPath(); c.moveTo(x0 - 4, g); c.lineTo(x0, g); c.stroke(); if (m % 2 === 0) { c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(String(m), x0 - 7, g); } }
    lab.label(c, 'm along the wall', x1, yB + 20, { align: 'right', base: 'top', color: tok('--text-3') });
    lab.label(c, 'depth, m', x0 - 4, yB + 20, { align: 'left', base: 'top', color: tok('--text-3') });
    c.strokeStyle = tok('--line-2'); c.strokeRect(Math.round(x0) + 0.5, Math.round(yT) + 0.5, Math.round(iw), Math.round(ih));
    c.fillStyle = tok('--bg-4'); c.fillRect(x0, yB - 1, iw, 3);
    if (Q && mag) {
      // false peaks, matched peaks, then the truth rings
      if (sc && sc.fals <= 40) for (const q of sc.peaks) {
        const qx = Math.round(X(gx[q.j * GW + q.i])) + 0.5, qy = Math.round(Y(gy[q.j * GW + q.i])) + 0.5;
        if (q.ok) continue;
        c.strokeStyle = tok('--danger'); c.lineWidth = 1.25; c.beginPath(); c.moveTo(qx - 3, qy - 3); c.lineTo(qx + 3, qy + 3); c.moveTo(qx + 3, qy - 3); c.lineTo(qx - 3, qy + 3); c.stroke();
      }
      for (const t of Q.tg) {
        const qx = X(t.x), qy = Y(t.y), r = Math.max(9, s * PXM * 1.15);
        c.strokeStyle = rgba('--bg-0', 0.7); c.lineWidth = 3.5; c.beginPath(); c.arc(qx, qy, r, 0, 2 * Math.PI); c.stroke();
        c.strokeStyle = tok('--text'); c.lineWidth = 1.25; c.setLineDash([3, 2.5]); c.beginPath(); c.arc(qx, qy, r, 0, 2 * Math.PI); c.stroke(); c.setLineDash([]);
      }
      if (sc) { c.font = '500 11px ' + tok('--font'); const txt = 'error ' + f2(sc.rel) + ' · ' + sc.hit + ' of ' + p.K + ' found · ' + sc.fals + ' false'; lab.label(c, txt, x0 + 8, yT + 13, { color: tok('--text'), bg: true }); }
    }
    if (which === 'l1' && (phase === 'build' || phase === 'power' || !sol)) {
      const txt = phase === 'build' ? 'Building the sensing matrix A: row ' + nfmt(built) + ' of ' + nfmt(MF) + ' × ' + nfmt(NPX) + ' pixels' : 'Power iteration ' + (POWER_IT - powerLeft) + ' of ' + POWER_IT + ': largest singular value² ' + (Q && Number.isFinite(Q.P.L) ? fx(Q.P.L, 2) : '…');
      lab.label(c, txt, (x0 + x1) / 2, (yT + yB) / 2 - 10, { align: 'center', color: tok('--text-2'), bg: true });
      const bw = Math.min(260, iw - 40), f = phase === 'build' ? built / MF : (POWER_IT - powerLeft) / POWER_IT; c.fillStyle = tok('--bg-5'); c.fillRect((x0 + x1 - bw) / 2, (yT + yB) / 2 + 6, bw, 3); c.fillStyle = tok('--accent'); c.fillRect((x0 + x1 - bw) / 2, (yT + yB) / 2 + 6, bw * f, 3);
    } else if (which === 'l1' && phase === 'ready' && sol && sol.ista.it === 0) lab.label(c, 'Press Reconstruct', (x0 + x1) / 2, (yT + yB) / 2, { align: 'center', color: tok('--text-2'), bg: true });
    if (which === 'l1' && phase === 'run' && sol) { c.fillStyle = tok('--accent'); c.fillRect(x0, yT, iw * (sol.ista.it / MAXIT), 2); }
    // colour bar
    const bx0 = Math.round(x1) + 10, bw = 7;
    for (let i = 0; i < ih; i++) { const [r, g, b] = lab.ramp(1 - i / ih); c.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')'; c.fillRect(bx0, yT + i, bw, 1.5); }
    c.strokeStyle = tok('--line-2'); c.lineWidth = 1; c.strokeRect(bx0 + 0.5, Math.round(yT) + 0.5, bw, Math.round(ih));
    c.font = MONO(); c.fillStyle = tok('--text-3'); c.textAlign = 'left'; c.textBaseline = 'middle';
    for (let d = 0; d <= DRANGE; d += 10) c.fillText(d ? '−' + d : '0 dB', bx0 + bw + 4, Math.max(yT + 5, Math.min(yB - 5, yT + (d / DRANGE) * ih)));
    // key under the image
    const ky = yB + 20 + 0.5, kx = (x0 + x1) / 2 - 78;
    c.strokeStyle = tok('--text'); c.lineWidth = 1.25; c.setLineDash([3, 2.5]); c.beginPath(); c.arc(kx, ky + 6, 5, 0, 2 * Math.PI); c.stroke(); c.setLineDash([]);
    lab.label(c, 'reflector', kx + 9, ky + 6, { color: tok('--text-3') });
    c.strokeStyle = tok('--danger'); c.beginPath(); c.moveTo(kx + 66, ky + 3); c.lineTo(kx + 72, ky + 9); c.moveTo(kx + 72, ky + 3); c.lineTo(kx + 66, ky + 9); c.stroke();
    lab.label(c, 'false peak', kx + 78, ky + 6, { color: tok('--text-3') });
    const hv = hov[which] || hov[which === 'bp' ? 'l1' : 'bp'];
    if (hv && mag && Q && hv[0] > x0 && hv[0] < x1 && hv[1] > yT && hv[1] < yB) {
      const i = Math.min(GW - 1, Math.floor((hv[0] - x0) / (s * PXM))), j = Math.min(GH - 1, Math.floor((hv[1] - yT) / (s * PXM)));
      c.strokeStyle = rgba('--text', 0.7); c.lineWidth = 1; c.strokeRect(Math.round(x0 + i * s * PXM) + 0.5, Math.round(yT + j * s * PXM) + 0.5, Math.round(s * PXM), Math.round(s * PXM));
      const v = 20 * Math.log10(Math.max(mag[j * GW + i] / Q.zref, 1e-6)), txt = fx(gx[j * GW + i], 2) + ', ' + fx(gy[j * GW + i], 2) + ' m  ' + (v < -99 ? 'zero' : lab.sgn(v, 1) + ' dB');
      c.font = MONO(); const tw = c.measureText(txt).width, lx = hv[0] + 12 + tw > x1 - 4 ? hv[0] - 12 - tw : hv[0] + 12;
      lab.label(c, txt, lx, hv[1] - 14 < yT + 26 ? hv[1] + 18 : hv[1] - 14, { font: MONO(), color: tok('--text'), bg: true });
    }
  }

  function drawMask(c, w, hh) {
    const o = { x: 36, y: 24, w: w - 36 - 10, h: hh - 24 - 36 }; if (o.w < 40 || o.h < 40) return;
    const cw = o.w / NP, ch = o.h / NQ, keep = new Uint8Array(MF); if (Q) for (const r of Q.rows) keep[r] = 1;
    for (let a = 0; a < NP; a++) for (let b = 0; b < NQ; b++) {
      const on = keep[a * NQ + b], x = o.x + a * cw, y = o.y + o.h - (b + 1) * ch;
      c.fillStyle = on ? tok('--accent') : rgba('--text', 0.07); c.fillRect(Math.round(x) + (on ? 0 : 0), Math.round(y), Math.max(1, Math.round(x + cw) - Math.round(x) - 1), Math.max(1, Math.round(y + ch) - Math.round(y) - 1));
    }
    c.font = MONO(); c.fillStyle = tok('--text-3'); c.textBaseline = 'middle'; c.textAlign = 'right';
    for (const g of [2, 3, 4]) c.fillText(String(g), o.x - 6, o.y + o.h - ((g * 1e9 - F0) / BW) * (o.h - ch) - ch / 2);
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (const m of [1.5, 4.5, 7.5]) c.fillText(fx(m, 1), o.x + ((m - (ROOM.w / 2 - TRACK / 2)) / TRACK) * (o.w - cw) + cw / 2, o.y + o.h + 5);
    lab.label(c, 'rover position, m', o.x + o.w, o.y + o.h + 19, { align: 'right', base: 'top', color: tok('--text-3') });
    lab.label(c, 'frequency, GHz', o.x - 30, o.y - 6, { base: 'bottom', color: tok('--text-3') });
  }

  function drawConv(c, w, hh) {
    const gap = 44, pw = (w - 40 - 12 - gap) / 2, top = 24, ph = hh - top - 36; if (pw < 50 || ph < 40) return;
    const n = hist ? hist.fista.obj.length : 0, xmax = MAXIT, lg = Math.log10;
    const series = (key, k) => (hist ? hist[k][key] : []);
    // objective (log)
    let lo = Infinity, hi = -Infinity; for (const k of ['ista', 'fista']) for (const v of series('obj', k)) { if (v > 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    if (!Number.isFinite(lo)) { lo = 0.01; hi = 1; } const dlo = Math.floor(lg(lo) * 4) / 4, dhi = Math.max(dlo + 0.5, Math.ceil(lg(hi) * 4) / 4), yt = []; for (let v = Math.ceil(dlo * 2) / 2; v <= dhi + 1e-9; v += 0.5) yt.push(v);
    const A1 = lab.plot(c, { x: 40, y: top, w: pw, h: ph, xd: [0, xmax], yd: [dlo, dhi], xt: [0, 100, 200, 300], yt, xl: 'iteration', yl: 'objective (log)', ylx: 34, yf: (v) => { const u = Math.pow(10, v); return u >= 1 ? fx(u, u >= 10 ? 0 : 1) : u.toPrecision(1); } });
    let emax = 1.2; for (const k of ['ista', 'fista']) for (const v of series('err', k)) emax = Math.max(emax, Math.min(v, 6)); emax = Math.ceil(emax * 2) / 2;
    const et = emax <= 1.5 ? [0, 0.5, 1, 1.5].filter((v) => v <= emax) : [0, emax / 2, emax];
    const x2 = 40 + pw + gap, A2 = lab.plot(c, { x: x2, y: top, w: pw, h: ph, xd: [0, xmax], yd: [0, emax], xt: [0, 100, 200, 300], yt: et, xl: 'iteration', yl: 'relative error', ylx: 26, yf: (v) => fx(v, 1) });
    const cols = { ista: tok('--text-2'), fista: tok('--accent') }, names = { ista: 'ISTA', fista: 'FISTA' };
    for (const [key, Ax, px0, clampHi] of [['obj', A1, 40, null], ['err', A2, x2, emax]]) {
      c.save(); c.beginPath(); c.rect(px0, top, pw, ph); c.clip();
      const ends = {};
      for (const k of ['ista', 'fista']) { const s = series(key, k), pts = s.map((v, i) => [Ax.X(i + 1), Ax.Y(key === 'obj' ? lg(Math.max(v, 1e-30)) : Math.min(v, clampHi))]); lab.line(c, pts, cols[k], k === p.algo ? 1.75 : 1.25); if (pts.length) ends[k] = pts[pts.length - 1]; }
      c.restore();
      // label each curve where the two are furthest apart: ISTA on its own point, FISTA at the same height further left or at its end
      const si = series(key, 'ista'), sf = series(key, 'fista'), yv = (v) => Ax.Y(key === 'obj' ? lg(Math.max(v, 1e-30)) : Math.min(v, clampHi));
      if (si.length > 3) {
        let bi = 0, bd = -1; for (let i = 0; i < Math.min(si.length, sf.length); i++) { const d = Math.abs(yv(si[i]) - yv(sf[i])); if (d > bd) { bd = d; bi = i; } }
        const xi = Ax.X(bi + 1), yi = yv(si[bi]), flip = xi + 44 > px0 + pw;
        lab.label(c, names.ista, flip ? xi - 7 : xi + 7, Math.max(top + 9, yi - 7), { align: flip ? 'right' : 'left', color: cols.ista, bg: true });
        const e = ends.fista; lab.label(c, names.fista, Math.min(px0 + pw - 5, e[0] + 2), Math.max(top + 9, e[1] - 10), { align: 'right', color: cols.fista, bg: true });
      }
    }
    if (!n) lab.label(c, phase === 'build' || phase === 'power' ? 'waiting for the step size' : 'no iterations yet', 40 + pw / 2, top + ph / 2, { align: 'center', color: tok('--text-3') });
  }

  function drawSweep(c, w, hh) {
    const lg = Math.log10, o = { x: 40, y: 38, w: w - 40 - 14, h: hh - 38 - 36, xd: [lg(1.7), lg(118)], yd: [lg(0.03), lg(30)], xt: [2, 5, 10, 20, 50, 100].map(lg), yt: [0.1, 1, 10].map(lg), xl: 'samples kept, % (log)', yl: 'relative error (log)', ylx: 34, xf: (v) => String(Math.round(Math.pow(10, v))), yf: (v) => String(+Math.pow(10, v).toPrecision(1)) };
    if (o.w < 50 || o.h < 40) return;
    const { X, Y } = lab.plot(c, o), cl = (v) => Math.max(o.yd[0], Math.min(o.yd[1], lg(Math.max(v, 1e-9)))), mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const gxc = Math.round(X(lg(p.frac))) + 0.5; c.strokeStyle = rgba('--text', 0.3); c.lineWidth = 1; c.beginPath(); c.moveTo(gxc, o.y); c.lineTo(gxc, o.y + o.h); c.stroke();
    const key = sceneKey(), sr = sweepRes && sweepRes.key === key ? sweepRes : null;
    c.save(); c.beginPath(); c.rect(o.x - 4, o.y - 4, o.w + 8, o.h + 8); c.clip();
    if (sr) {
      const done = sr.pts.filter((q) => q.l1.length);
      for (const [k, col] of [['bp', tok('--text-2')], ['l1', tok('--accent')]]) {
        lab.line(c, done.map((q) => [X(lg(q.f)), Y(cl(mean(q[k])))]), col, 1.5);
        c.fillStyle = col; for (const q of done) for (const v of q[k]) c.fillRect(X(lg(q.f)) - 1.5, Y(cl(v)) - 1.5, 3, 3);
      }
    }
    for (const t of trail) { if (t.key !== key) continue; for (const [k, col] of [['bp', tok('--text-2')], ['l1', tok('--accent')]]) { c.strokeStyle = col; c.lineWidth = 1.25; c.fillStyle = tok('--bg-1'); c.beginPath(); c.arc(X(lg(t.frac)), Y(cl(t[k])), 3.5, 0, 2 * Math.PI); c.fill(); c.stroke(); } }
    c.restore();
    if (sr) {
      const done = sr.pts.filter((q) => q.l1.length); c.font = MONO(); c.textAlign = 'center'; c.textBaseline = 'middle';
      for (const q of done) { const hm = Math.min(...q.hit); c.fillStyle = hm >= p.K ? tok('--ok') : tok('--warn'); c.fillText(String(hm), X(lg(q.f)), o.y - 10); }
      lab.label(c, 'found of ' + p.K, o.x - 34, o.y - 24, { color: tok('--text-3') });
      if (done.length > 2) { const a = done[done.length - 1]; lab.label(c, 'back-projection', X(lg(a.f)) - 4, Y(cl(mean(a.bp))) - 11, { align: 'right', color: tok('--text-2'), bg: true }); lab.label(c, 'L1 (FISTA)', X(lg(a.f)) - 4, Y(cl(mean(a.l1))) - 11, { align: 'right', color: tok('--accent'), bg: true }); }
    } else {
      const mine = trail.filter((t) => t.key === key);
      if (mine.length) { const t = mine[mine.length - 1], right = X(lg(t.frac)) > o.x + o.w - 100; lab.label(c, 'back-projection', X(lg(t.frac)) + (right ? -8 : 8), Y(cl(t.bp)), { align: right ? 'right' : 'left', color: tok('--text-2'), bg: true }); lab.label(c, 'L1', X(lg(t.frac)) + (right ? -8 : 8), Y(cl(t.l1)), { align: right ? 'right' : 'left', color: tok('--accent'), bg: true }); }
    }
  }

  // ---- loop ----
  function work(budget) {
    const t0 = performance.now();
    if (built < MF) {
      if (!A) A = core.allocA(MF, NPX);
      while (built < MF && performance.now() - t0 < budget) { const to = Math.min(MF, built + 8); core.buildRows(A, mx, mf, gx, gy, built, to); built = to; }
      phase = 'build'; dirty = true; return true;
    }
    if (stale || !Q) { stale = false; Q = makeProblem(p.frac, p.seed, 300 + p.seed, true); sol = null; hist = null; scores = { ista: null, fista: null }; powerLeft = POWER_IT; phase = 'power'; dirty = true; syncButtons(); return true; }
    if (phase === 'power') { let k = 0; while (powerLeft > 0 && k < 3 && performance.now() - t0 < budget) { Q.P.power(); powerLeft--; k++; } if (powerLeft <= 0) { startSolve(); syncButtons(); } dirty = true; return true; }
    if (phase === 'run') {     // the first iterations are paced so the image is seen sharpening; then full speed
      const it = sol.ista.it, every = lab.reducedMotion() ? 1 : it < 16 ? 5 : it < 40 ? 2 : 1, most = it < 40 ? 1 : 3; let k = 0;
      if (++frame % every === 0) while (phase === 'run' && k < most && performance.now() - t0 < budget) { iterate(); k++; }
      dirty = true; return true;
    }
    if (sweep) { pumpSweep(budget); return true; }
    return false;
  }
  const run = lab.loop(() => {
    if (lab.reducedMotion()) { const t0 = performance.now(); while (work(30) && performance.now() - t0 < 4000); }
    else work(9);
    if (dirty) { dirty = false; syncStats(); cvs.bp.redraw(); cvs.l1.redraw(); cvMask.redraw(); cvConv.redraw(); cvSweep.redraw(); }
  });
  const kick = () => run.once();
  syncButtons(); syncSweep(); syncStats();
  globalThis.__sparseDbg = () => ({ fineVsCoarse: Q && Q.fine ? (() => { let m = 0; for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) m = Math.max(m, Math.abs(Q.fine[(3 * j + 1) * FW + 3 * i + 1] - Q.bp[j * GW + i]) / Q.zref); return m; })() : null, phase, built, keep: Q && Q.keep, L: Q && Q.P.L, it: sol && sol.ista.it, bp: Q && { rel: Q.bpScore.rel, hit: Q.bpScore.hit, fals: Q.bpScore.fals }, ista: scores.ista && { rel: scores.ista.rel, hit: scores.ista.hit, fals: scores.ista.fals }, fista: scores.fista && { rel: scores.fista.rel, hit: scores.fista.hit, fals: scores.fista.fals }, sweep: sweep && sweep.at, sweepRes: sweepRes && sweepRes.pts.map((q) => [q.f, q.bp.map((v) => +v.toFixed(2)), q.l1.map((v) => +v.toFixed(2)), q.hit]) });
  return {
    onShow() { dirty = true; run.start(); },
    onHide() { run.stop(); },
  };
}
