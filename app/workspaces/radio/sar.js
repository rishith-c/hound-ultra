// Exhibit 04: synthetic aperture through the wall. The rover's positions along the corridor become one long antenna.
// Everything drawn is computed here: simulated stepped-frequency returns (with wall flash and noise), range profiles by
// our own FFT, the image by back-projection, and the blur measured from that image against the textbook formulas.
import * as core from './sarcore.js';
const { C0, ROOM, WALL, REF_AMP } = core;

export const meta = {
  title: 'Synthetic aperture through the wall',
  labels: ['concept', 'live-algo'],
  labelNote: 'Concept: the wideband radar and millimetre odometry. Live: the simulated returns and the back-projection, computed in this page.',
  plain: [
    'One radar position only knows how far away each echo is, so every reflector is a ring of possible places. As the rover drives along the wall, each stop adds another set of rings, and where they all cross is where the reflector is.',
    'The longer the drive, the finer the picture: the positions together behave like one antenna as long as the track.',
  ],
  cites: [
    { by: 'T. S. Ralston, G. L. Charvat, J. E. Peabody', year: 2010, title: 'Real-time through-wall imaging using an ultrawideband multiple-input multiple-output (MIMO) phased array radar system', venue: 'IEEE Int. Symp. on Phased Array Systems and Technology', url: 'https://doi.org/10.1109/ARRAY.2010.5613314' },
    { by: 'M. G. Amin (ed.)', year: 2011, title: 'Through-the-Wall Radar Imaging', venue: 'CRC Press', url: 'https://doi.org/10.1201/9781315218144' },
    { by: 'F. Adib and D. Katabi', year: 2013, title: 'See through walls with WiFi!', venue: 'ACM SIGCOMM', url: 'https://doi.org/10.1145/2486001.2486039' },
    { by: 'NASA JPL', year: 2015, title: 'FINDER, a real fielded radar. It senses heartbeat and breathing and does not form images: JPL reports that two prototypes taken to Nepal after the 25 April 2015 earthquake detected the heartbeats of four men under about 10 ft of rubble in Chautara', venue: 'NASA Jet Propulsion Laboratory news', url: 'https://www.jpl.nasa.gov/news/finder-search-and-rescue-technology-helped-save-lives-in-nepal/' },
  ],
  honest: 'It needs a coherent wideband radar that records raw phase, and rover positions known to a fraction of a wavelength (a few millimetres at 3 GHz). HOUND has neither: its radars (LD2450, LD2410C) report tracks and presence, not phase, and a mecanum rover on rubble slips. Real walls are not uniform slabs.',
  unknown: 'how much of this image survives real odometry drift, studs, pipes and furniture. Nothing here has been measured.',
};

const IW = 160, IH = 120, NPIX = IW * IH, M = 2048, DF = 10e6, FC = 3e9, RU = C0 / (2 * DF), LAMC = C0 / FC;
const MAXT = 6, LETTERS = 'ABCDEF', PATCH = 33, PSTEP = 0.0125, PP = PATCH * PATCH, CUT = 161, DR = 40, DRIVE_S = 11;
const TRACK_C = ROOM.w / 2;

export function create(stage, side, ctx, lab) {
  const { h, icon, tok, rgba, fx } = lab;
  const P = { B: 2, d: 1.5, L: 6, snr: 0, sub: true, hann: false };
  let targets = core.DEFAULT_TARGETS.map((t) => ({ ...t }));
  let sel = 0, hover = null, dragging = null, mouse = null;

  // ---- derived radar set-up ----
  let nf, f0, N, Lact, xs, prof, dataVer = 0, S = [], PR = [], cumRe, cumIm, cumN = 0, px, py, np;
  let nUse = 1, playU = 0, playing = false, autoplayed = false;
  function configure() {
    nf = Math.round((P.B * 1e9) / DF) + 1; f0 = FC - ((nf - 1) / 2) * DF;
    const d = P.d / 100; N = Math.floor(P.L / d + 1e-9) + 1; Lact = (N - 1) * d;
    xs = new Float64Array(N); for (let n = 0; n < N; n++) xs[n] = TRACK_C - Lact / 2 + n * d;
    prof = core.profiler(nf, M, P.hann);
    S = new Array(N); PR = new Array(N); cumRe = new Float64Array(nf); cumIm = new Float64Array(nf); cumN = 0;
    np = NPIX + targets.length * PP; px = new Float32Array(np); py = new Float32Array(np);
    for (let j = 0; j < IH; j++) for (let i = 0; i < IW; i++) { px[j * IW + i] = ((i + 0.5) * ROOM.w) / IW; py[j * IW + i] = ROOM.d - ((j + 0.5) * ROOM.d) / IH; }
    targets.forEach((t, k) => { for (let b = 0; b < PATCH; b++) for (let a = 0; a < PATCH; a++) { const o = NPIX + k * PP + b * PATCH + a; px[o] = t.x + (a - (PATCH - 1) / 2) * PSTEP; py[o] = t.y + (b - (PATCH - 1) / 2) * PSTEP; } });
    acc = { re: new Float64Array(np), im: new Float64Array(np) }; accN = 0; accKey = ''; job = null;
    dataVer++; nUse = Math.max(1, Math.min(N, nUse)); blur = []; blurQueue = null; shown.N = 0; shown.key = '';
    const ref = refTarget(); refIdx = ref;
  }
  const sweepOf = (n) => { if (!S[n]) { const re = new Float64Array(nf), im = new Float64Array(nf); core.sweep(xs[n], f0, DF, nf, targets, true, re, im); core.addNoise(re, im, nf, core.noiseSigma(P.snr), core.rng(9000 + n * 7919)); S[n] = { re, im }; } return S[n]; };
  const profOf = (n) => { if (!PR[n]) { const s = sweepOf(n), re = new Float32Array(M), im = new Float32Array(M); prof(s.re, s.im, re, im); PR[n] = { re, im }; } return PR[n]; };
  // range profile of the average sweep over the first n positions: the part that is the same everywhere, i.e. the wall
  const mre = new Float64Array(512), mim = new Float64Array(512);
  function meanProf(n, outR, outI) {
    if (n < cumN) { cumRe.fill(0); cumIm.fill(0); cumN = 0; }
    for (; cumN < n; cumN++) { const s = sweepOf(cumN); for (let k = 0; k < nf; k++) { cumRe[k] += s.re[k]; cumIm[k] += s.im[k]; } }
    for (let k = 0; k < nf; k++) { mre[k] = cumRe[k] / n; mim[k] = cumIm[k] / n; }
    prof(mre, mim, outR, outI);
  }
  const echo = (t) => { const R = Math.hypot(t.x - TRACK_C, t.y + ROOM.standoff); return t.a / (R * R); };
  const refTarget = () => { let b = -1; targets.forEach((t, k) => { if (b < 0 || echo(t) > echo(targets[b])) b = k; }); return b; };
  let refIdx = 0;

  // ---- imaging job: time-sliced back-projection ----
  let acc = null, accN = 0, accKey = '', job = null;
  const shown = { N: 0, key: '', db: new Float32Array(NPIX), peakAmp: 0, peaks: [], cv: null, note: '' };
  const tmpR = new Float32Array(M), tmpI = new Float32Array(M), zoomDb = new Float32Array(PP); let zoomCv = null, zoomK = -1;
  const keyNow = () => dataVer + '|' + (P.sub ? 1 : 0);
  function addPos(n, mean, aR, aI, qx, qy, from, to) {
    const p = profOf(n); let r = p.re, i = p.im;
    if (mean) { for (let m = 0; m < M; m++) { tmpR[m] = r[m] - mean.re[m]; tmpI[m] = i[m] - mean.im[m]; } r = tmpR; i = tmpI; }
    core.bpAdd(aR, aI, qx, qy, from, to, xs[n], r, i, M, RU, FC);
  }
  function pump(budget) {
    const key = keyNow();
    if (job && job.key !== key) job = null;
    if (!job) {
      if (shown.key === key && shown.N === nUse) return false;
      const useMean = P.sub && nUse >= 2;
      if (!P.sub && accKey === key && accN <= nUse) job = { key, N: nUse, n: accN, mean: null };
      else { acc.re.fill(0); acc.im.fill(0); accN = 0; accKey = P.sub ? '' : key; job = { key, N: nUse, n: 0, mean: null }; if (useMean) { job.mean = { re: new Float32Array(M), im: new Float32Array(M) }; meanProf(nUse, job.mean.re, job.mean.im); } }
    }
    if (!P.sub) { if (nUse < job.n) { job = null; accKey = ''; return true; } job.N = nUse; }
    const t0 = performance.now();
    while (job.n < job.N && performance.now() - t0 < budget) { addPos(job.n, job.mean, acc.re, acc.im, px, py, 0, np); job.n++; }
    if (!P.sub) accN = job.n;
    if (job.n >= job.N) { publish(job.N, key, job.mean); job = null; }
    else if (!P.sub) publish(job.n, '', null);
    return true;
  }
  function publish(n, key, mean) {
    let mx = 0; const mag = shown.db;
    for (let p = 0; p < NPIX; p++) { const v = Math.hypot(acc.re[p], acc.im[p]); mag[p] = v; if (v > mx) mx = v; }
    const pk = []; let best = mx;
    targets.forEach((t, k) => {
      const o = NPIX + k * PP; let bi = 0, bv = -1;
      for (let q = 0; q < PP; q++) { const v = Math.hypot(acc.re[o + q], acc.im[o + q]); if (v > bv) { bv = v; bi = q; } }
      const a = bi % PATCH, b = (bi / PATCH) | 0, edge = a === 0 || b === 0 || a === PATCH - 1 || b === PATCH - 1;
      let ox = 0, oy = 0;
      if (!edge) {
        const v = (da, db) => Math.hypot(acc.re[o + (b + db) * PATCH + a + da], acc.im[o + (b + db) * PATCH + a + da]);
        const l = v(-1, 0), r = v(1, 0), u = v(0, -1), d2 = v(0, 1), dx = l - 2 * bv + r, dy = u - 2 * bv + d2;
        if (dx < 0) ox = (0.5 * (l - r)) / dx; if (dy < 0) oy = (0.5 * (u - d2)) / dy;
      }
      const x = t.x + (a + ox - (PATCH - 1) / 2) * PSTEP, y = t.y + (b + oy - (PATCH - 1) / 2) * PSTEP;
      pk.push({ x, y, amp: bv, found: !edge, err: Math.hypot(x - t.x, y - t.y) }); if (bv > best) best = bv;
      if (k === sel) { for (let q = 0; q < PP; q++) zoomDb[q] = 20 * Math.log10(Math.max(Math.hypot(acc.re[o + (PATCH - 1 - ((q / PATCH) | 0)) * PATCH + (q % PATCH)], acc.im[o + (PATCH - 1 - ((q / PATCH) | 0)) * PATCH + (q % PATCH)]) / (bv || 1), 1e-6)); zoomK = k; zoomCv = lab.heatImage(zoomDb, PATCH, PATCH, -30, 0, zoomCv); }
    });
    const ref = best || 1;
    for (let p = 0; p < NPIX; p++) mag[p] = 20 * Math.log10(Math.max(mag[p] / ref, 1e-9));
    // a peak counts only if it stands at least 10 dB above the median of the image
    const sorted = Float32Array.from(mag).sort(), med = sorted[NPIX >> 1];
    for (const p of pk) { p.db = 20 * Math.log10(Math.max(p.amp / ref, 1e-9)); p.found = p.found && p.db > med + 10; }
    shown.peaks = pk; shown.N = n; shown.key = key; shown.med = med;
    shown.cv = lab.heatImage(mag, IW, IH, -DR, 0, shown.cv);
    shown.note = P.sub && n < 2 ? 'One position: nothing to average, so the wall is not removed yet' : '';
    if (key) { cur = blurFor(n); }
    dirty = true;
  }

  // ---- blur of the reference reflector, measured from fine cuts through its image peak ----
  const bR = new Float64Array(PP), bI = new Float64Array(PP), bx = new Float32Array(PP), by = new Float32Array(PP);
  const cR = new Float64Array(2 * CUT), cI = new Float64Array(2 * CUT), cx = new Float32Array(2 * CUT), cy = new Float32Array(2 * CUT);
  const bm = { re: new Float32Array(M), im: new Float32Array(M) };
  let blur = [], blurQueue = null, cur = null;
  function blurFor(n) {
    const t = targets[refIdx]; if (!t || n < 1) return null;
    const mean = P.sub && n >= 2 ? (meanProf(n, bm.re, bm.im), bm) : null;
    const L = (n - 1) * (P.d / 100), xc = xs[0] + L / 2, R = Math.hypot(t.x - xc, t.y + ROOM.standoff);
    const rule = L > 0 ? (LAMC * R) / (2 * L) : Infinity;
    for (let q = 0; q < PP; q++) { bx[q] = t.x + ((q % PATCH) - (PATCH - 1) / 2) * PSTEP; by[q] = t.y + (((q / PATCH) | 0) - (PATCH - 1) / 2) * PSTEP; }
    bR.fill(0); bI.fill(0);
    for (let k = 0; k < n; k++) addPos(k, mean, bR, bI, bx, by, 0, PP);
    let bi = 0, bv = -1; for (let q = 0; q < PP; q++) { const v = Math.hypot(bR[q], bI[q]); if (v > bv) { bv = v; bi = q; } }
    const pxk = bx[bi], pyk = by[bi], ux = (pxk - xc) / Math.hypot(pxk - xc, pyk + ROOM.standoff), uy = (pyk + ROOM.standoff) / Math.hypot(pxk - xc, pyk + ROOM.standoff);
    const halfC = Math.min(4, Math.max(0.2, 1.6 * rule)), halfD = Math.max(0.3, (2.5 * C0) / (2 * P.B * 1e9)), sc = (2 * halfC) / (CUT - 1), sd = (2 * halfD) / (CUT - 1);
    for (let q = 0; q < CUT; q++) { const a = (q - (CUT - 1) / 2) * sc, b = (q - (CUT - 1) / 2) * sd; cx[q] = pxk - uy * a; cy[q] = pyk + ux * a; cx[CUT + q] = pxk + ux * b; cy[CUT + q] = pyk + uy * b; }
    cR.fill(0); cI.fill(0);
    for (let k = 0; k < n; k++) addPos(k, mean, cR, cI, cx, cy, 0, 2 * CUT);
    const mc = new Float64Array(CUT), md = new Float64Array(CUT);
    for (let q = 0; q < CUT; q++) { mc[q] = Math.hypot(cR[q], cI[q]); md[q] = Math.hypot(cR[CUT + q], cI[CUT + q]); }
    return { n, L, R, rule, cross: core.width3dB(mc, sc, (CUT - 1) / 2).width, down: core.width3dB(md, sd, (CUT - 1) / 2).width };
  }
  function pumpBlur() {
    if (!blurQueue) {
      if (blur.key === keyNow() + '|' + refIdx) return false;
      const d = P.d / 100, lo = Math.max(2, Math.ceil(0.06 / d) + 1), set = new Set(); const K = 26;
      for (let i = 0; i < K; i++) set.add(Math.round(lo * Math.pow(N / lo, i / (K - 1))));
      blurQueue = [...set].filter((n) => n >= 2 && n <= N).sort((a, b) => a - b); blur = []; blur.key = keyNow() + '|' + refIdx;
    }
    const t0 = performance.now();
    while (blurQueue.length && performance.now() - t0 < 5) { const r = blurFor(blurQueue.shift()); if (r) blur.push(r); }
    if (!blurQueue.length) blurQueue = null;
    dirty = true; return true;
  }

  // ---- DOM ----
  const figMain = lab.figure('', { tag: h('span.tag.tag-sim', { title: 'Simulated returns from simulated reflectors. HOUND has no imaging radar.' }, 'Simulated'), cls: 'radio-sar-main' });
  const view = h('div.radio-sar-view');
  const btnPlay = h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => togglePlay() });
  const btnReset = h('button.btn.btn-sm', { type: 'button', title: 'Back to one position', onclick: () => { playing = false; playU = 0; setUse(1); syncPlay(); } }, icon('skip-back', 14), 'Reset');
  const scrub = h('input.slider', { type: 'range', min: 1, max: 10, step: 1, value: 1, 'aria-label': 'Positions used: the aperture', title: 'How much of the drive is used. Dragging the rover on the figure does the same.' });
  const scrubOut = h('output.num');
  scrub.addEventListener('input', () => { playing = false; setUse(+scrub.value); playU = Math.pow((nUse - 1) / Math.max(1, N - 1), 1 / 1.6); syncPlay(); });
  figMain.body.append(view, h('div.radio-sar-bar', null, btnPlay, btnReset, h('span.radio-sar-bar-l', null, 'Aperture'), scrub, scrubOut));
  figMain.setCaption([h('b', null, ROOM.name + ', first ' + ROOM.d + ' m.'), ' Drag a reflector or the rover. Click the floor to add a reflector, double-click one to remove it. Brightness is decibels below the brightest pixel, ' + DR + ' dB shown.']);
  const figProf = lab.figure('One position alone knows range, not direction', { cls: 'radio-sar-chart' });
  const figBlur = lab.figure('Cross-range blur shrinks as the aperture grows', { cls: 'radio-sar-chart' });
  figProf.setCaption('Inverse FFT of the frequency sweep at the rover\'s current position. Dashed marks: true range of each reflector.');
  figBlur.setCaption('');
  stage.append(h('div.radio-grid.radio-sar-grid', null, figMain, figProf, figBlur));

  let dirty = true, geo = null;
  const cvMain = lab.canvas(view, drawMain, { label: 'Plan view of the room behind the wall with the radar image forming as the rover drives' });
  const cvProf = lab.canvas(figProf.body, drawProfile, { label: 'Range profile at the current rover position' });
  const cvBlur = lab.canvas(figBlur.body, drawBlur, { label: 'Measured blur against aperture length, with the formula' });

  // controls
  const fmtBand = () => fx(f0 / 1e9, 2) + ' to ' + fx((f0 + (nf - 1) * DF) / 1e9, 2) + ' GHz';
  const bandLine = h('p.radio-sar-derived.num'), gratingNote = h('div.note.warn.radio-sar-note', { hidden: true }, icon('alert', 15), h('span'));
  const change = (k) => (v) => { P[k] = v; const keep = nUse / N; configure(); if (k === 'd' || k === 'L') nUse = Math.max(1, Math.min(N, Math.round(keep * N))); syncAll(); };
  const sB = lab.slider({ label: 'Bandwidth', min: 0.5, max: 3, step: 0.1, value: P.B, format: (v) => fx(v, 1) + ' GHz', oninput: change('B'), title: 'Width of the frequency sweep around 3 GHz. Wider means finer range.' });
  const sD = lab.slider({ label: 'Spacing', min: 1, max: 12, step: 0.5, value: P.d, format: (v) => fx(v, 1) + ' cm', oninput: change('d'), title: 'Distance the rover moves between sweeps.' });
  const sL = lab.slider({ label: 'Track length', min: 1, max: 8, step: 0.5, value: P.L, format: (v) => fx(v, 1) + ' m', oninput: change('L'), title: 'How far the rover drives along the wall.' });
  const sN = lab.slider({ label: 'Signal to noise', min: -40, max: 20, step: 1, value: P.snr, format: (v) => lab.sgn(v, 0) + ' dB', oninput: change('snr'), title: 'Per sample, for a unit reflector 4 m away. The image adds every sample up, so it tolerates far more noise than one sweep.' });
  const tSub = lab.toggle('Remove the wall (subtract the average sweep)', P.sub, (v) => { P.sub = v; syncAll(); }, { title: 'The wall echo is the same at every position, so the average over positions is mostly wall. Subtracting it leaves what changes: the reflectors.' });
  const gWin = lab.seg([['none', 'None', 'Every frequency weighted equally: sharpest, with range sidelobes'], ['hann', 'Hann', 'Tapered sweep: sidelobes drop, the range blur widens']], 'none', (v) => { P.hann = v === 'hann'; const u = nUse; configure(); nUse = u; syncAll(); }, { label: 'Range window' });
  const st = {
    cross: lab.stat('Cross-range blur, measured', 'cm', { title: 'Width at -3 dB of the reference reflector, across the line of sight, from a fine cut through the image peak' }),
    crossR: lab.stat('Rule λR / 2L', 'cm', { title: 'Centre wavelength x range / (2 x aperture length). Assumes the aperture is short next to the range.' }),
    down: lab.stat('Down-range blur, measured', 'cm', { title: 'Width at -3 dB along the line of sight' }),
    downR: lab.stat('Rule c / 2B', 'cm', { title: 'Speed of light / (2 x bandwidth)' }),
    pos: lab.stat('Positions used', ''), ap: lab.stat('Aperture', 'm'),
    ru: lab.stat('Unambiguous range', 'm', { title: 'c / (2 x frequency step). Echoes from further away fold back.' }),
    q: lab.stat('Spacing limit λ / 4', 'cm', { title: 'At the top frequency. Wider spacing under-samples the wavefront.' }),
  };
  const list = h('div.radio-sar-list'), btnAdd = h('button.btn.btn-sm', { type: 'button', onclick: () => addTarget(null) }, icon('plus', 14), 'Add a reflector');
  const sX = lab.slider({ label: 'Along the wall', min: 0.3, max: ROOM.w - 0.3, step: 0.05, value: 1, format: (v) => fx(v, 2) + ' m', oninput: (v) => moveSel({ x: v }) });
  const sY = lab.slider({ label: 'Depth', min: 0.3, max: ROOM.d - 0.3, step: 0.05, value: 1, format: (v) => fx(v, 2) + ' m', oninput: (v) => moveSel({ y: v }) });
  const sA = lab.slider({ label: 'Strength', min: 0.2, max: 1, step: 0.05, value: 1, format: (v) => fx(v, 2), oninput: (v) => moveSel({ a: v }), title: '1.00 stands for a person-sized reflector (assumed)' });
  side.append(
    lab.group('Radar, assumed concept hardware', sB, sD, sL, sN, bandLine,
      h('div.radio-row', null, h('span.radio-row-label', null, 'Range window'), gWin), tSub, gratingNote),
    lab.group('Measured from the image', h('div.radio-stats', null, st.cross, st.crossR, st.down, st.downR, st.pos, st.ap, st.ru, st.q)),
    lab.group('Reflectors, simulated', list, sX, sY, sA, h('div.radio-row', null, btnAdd)),
    lab.group('Assumed in this simulation',
      h('p', null, 'Wall: one plasterboard slab ' + fx(WALL.thick * 1000, 0) + ' mm thick, relative permittivity ' + WALL.eps + ' (ITU-R P.2040-4), which adds ' + fx(WALL.delay * 100, 2) + ' cm of path each way. Two-way loss ' + WALL.lossDb + ' dB. Its echo is set ' + WALL.flashDb + ' dB above a unit reflector at 4 m and is the same at every position.'),
      h('p', null, 'Reflectors are points; echoes fall as 1 / R². Bending of the rays inside the slab is ignored. Rover positions are exact, which a real rover cannot promise.')));

  function rebuildList() {
    list.replaceChildren(...targets.map((t, k) => {
      const row = h('div.radio-sar-item', { 'data-k': k },
        h('button.radio-sar-pick', { type: 'button', 'aria-pressed': String(k === sel), title: 'Select reflector ' + LETTERS[k], onclick: () => { sel = k; syncSel(); reshow(); } }, h('b', null, LETTERS[k]), h('span.num.radio-sar-xy'), h('span.num.radio-sar-err')),
        h('button.btn.btn-ghost.btn-sm.btn-icon', { type: 'button', title: 'Remove reflector ' + LETTERS[k], 'aria-label': 'Remove reflector ' + LETTERS[k], onclick: () => removeTarget(k) }, icon('trash', 14)));
      return row;
    }));
    btnAdd.disabled = targets.length >= MAXT; syncSel();
  }
  function syncSel() {
    sel = Math.max(0, Math.min(targets.length - 1, sel)); const t = targets[sel];
    list.querySelectorAll('.radio-sar-pick').forEach((b, k) => b.setAttribute('aria-pressed', String(k === sel)));
    for (const s of [sX, sY, sA]) s.input.disabled = !t;
    if (t) { sX.set(t.x); sY.set(t.y); sA.set(t.a); }
  }
  function syncList() {
    list.querySelectorAll('.radio-sar-item').forEach((row, k) => {
      const t = targets[k], p = shown.peaks[k]; if (!t) return;
      row.querySelector('.radio-sar-xy').textContent = fx(t.x, 2) + ', ' + fx(t.y, 2) + ' m';
      const e = row.querySelector('.radio-sar-err');
      e.textContent = p && p.found ? 'peak off by ' + fx(p.err * 100, 1) + ' cm' : 'no clear peak'; e.dataset.tone = p && p.found ? '' : 'warn';
    });
  }
  function moveSel(d) { const t = targets[sel]; if (!t) return; Object.assign(t, d); retarget(); }
  function retarget() { const u = nUse; configure(); nUse = u; syncAll(false); }
  function addTarget(at) {
    if (targets.length >= MAXT) return;
    const r = core.rng(31 + targets.length * 17 + dataVer), t = at || { x: 1 + r() * (ROOM.w - 2), y: 0.8 + r() * (ROOM.d - 1.8) };
    targets.push({ x: t.x, y: t.y, a: 0.8 }); sel = targets.length - 1; rebuildList(); retarget();
  }
  function removeTarget(k) { targets.splice(k, 1); if (sel >= targets.length) sel = targets.length - 1; hover = null; rebuildList(); retarget(); }

  function reshow() { shown.key = ''; shown.N = 0; accKey = ''; job = null; dirty = true; kick(); }
  function setUse(n) { nUse = Math.max(1, Math.min(N, Math.round(n))); syncScrub(); dirty = true; kick(); }
  function syncScrub() { scrub.max = N; scrub.value = nUse; scrub.style.setProperty('--p', (N > 1 ? ((nUse - 1) / (N - 1)) * 100 : 100) + '%'); scrubOut.textContent = nUse + ' / ' + N + ' · ' + fx((nUse - 1) * P.d / 100, 2) + ' m'; }
  function syncPlay() { const end = nUse >= N; btnPlay.replaceChildren(icon(playing ? 'pause' : 'play', 14), playing ? 'Pause' : end ? 'Drive again' : 'Drive the rover'); }
  function togglePlay() { if (playing) playing = false; else { if (nUse >= N) { playU = 0; setUse(1); } playing = true; } syncPlay(); kick(); }
  function syncAll(list = true) {
    const fmax = f0 + (nf - 1) * DF, q = C0 / fmax / 4;
    bandLine.textContent = fmtBand() + ' in ' + nf + ' steps of ' + DF / 1e6 + ' MHz · ' + N + ' positions';
    const wide = P.d / 100 > q * 1.0001; gratingNote.hidden = !wide;
    gratingNote.lastChild.textContent = 'Spacing ' + fx(P.d, 1) + ' cm is wider than a quarter wavelength (' + fx(q * 100, 2) + ' cm at ' + fx(fmax / 1e9, 2) + ' GHz). The track under-samples the wave, so each reflector also focuses faintly at false places: grating lobes. Look for ghost arcs beside the true points.';
    st.ru.set(fx(RU, 1)); st.q.set(fx(q * 100, 2), wide ? 'warn' : ''); st.downR.set(fx((C0 / (2 * P.B * 1e9)) * 100, 2));
    syncScrub(); syncPlay(); if (list) syncSel(); dirty = true; kick();
  }
  function syncStats() {
    st.pos.set(shown.N + ' / ' + N); st.ap.set(fx((shown.N - 1) * P.d / 100, 2));
    const ok = (v) => Number.isFinite(v);
    st.cross.set(cur && ok(cur.cross) ? fx(cur.cross * 100, 2) : '–', 'accent'); st.crossR.set(cur && ok(cur.rule) ? fx(Math.min(cur.rule, 99.99) * 100, 2) : '–');
    st.down.set(cur && ok(cur.down) ? fx(cur.down * 100, 2) : '–');
    figMain.setTitle(shown.N <= 1 ? 'One position: every reflector is a ring of possible places' : shown.N + ' positions act as one ' + fx((shown.N - 1) * P.d / 100, 2) + ' m antenna: the rings ' + (shown.N * P.d / 100 > 1 ? 'collapse into points' : 'begin to cross'));
    const rule = cur && ok(cur.cross) && ok(cur.rule) ? 'Reflector ' + LETTERS[refIdx] + ' now: measured ' + fx(cur.cross * 100, 1) + ' cm against the rule ' + fx(cur.rule * 100, 1) + ' cm. ' : '';
    figBlur.setCaption(rule + 'The rule assumes an aperture much shorter than the range; a plain aperture measures 0.89 of it at -3 dB.');
    syncList();
  }

  // ---- pointer: drag reflectors and the rover, click to add ----
  const el = cvMain.el; el.style.touchAction = 'none';
  const evPos = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function pick(mx, my) {
    if (!geo) return null;
    for (let k = targets.length - 1; k >= 0; k--) if (Math.hypot(geo.X(targets[k].x) - mx, geo.Y(targets[k].y) - my) < 13) return { kind: 'target', k };
    if (Math.abs(my - geo.Y(-ROOM.standoff)) < 16 && mx > geo.X(xs[0]) - 20 && mx < geo.X(xs[N - 1]) + 20) return { kind: 'rover' };
    const [wx, wy] = geo.inv(mx, my); if (wx > 0.15 && wx < ROOM.w - 0.15 && wy > 0.15 && wy < ROOM.d - 0.15) return { kind: 'floor', wx, wy };
    return null;
  }
  const roverTo = (mx) => { const d = P.d / 100; playing = false; setUse(Math.round((geo.inv(mx, 0)[0] - xs[0]) / d) + 1); playU = Math.pow((nUse - 1) / Math.max(1, N - 1), 1 / 1.6); syncPlay(); };
  el.addEventListener('pointerdown', (e) => {
    const [mx, my] = evPos(e), hit = pick(mx, my); if (!hit) return;
    el.setPointerCapture(e.pointerId); dragging = { ...hit, x0: mx, y0: my, moved: false };
    if (hit.kind === 'target' && sel !== hit.k) { sel = hit.k; syncSel(); reshow(); } if (hit.kind === 'rover') roverTo(mx);
    dirty = true; kick();
  });
  el.addEventListener('pointermove', (e) => {
    const [mx, my] = evPos(e); mouse = [mx, my];
    if (dragging) {
      if (Math.hypot(mx - dragging.x0, my - dragging.y0) > 3) dragging.moved = true;
      if (dragging.kind === 'target' && dragging.moved) { const [wx, wy] = geo.inv(mx, my), t = targets[dragging.k]; t.x = Math.max(0.2, Math.min(ROOM.w - 0.2, wx)); t.y = Math.max(0.2, Math.min(ROOM.d - 0.2, wy)); syncSel(); retarget(); }
      else if (dragging.kind === 'rover') roverTo(mx);
    } else { const hit = pick(mx, my); hover = hit; el.style.cursor = !hit ? 'default' : hit.kind === 'target' ? 'grab' : hit.kind === 'rover' ? 'ew-resize' : 'crosshair'; }
    dirty = true; kick();
  });
  el.addEventListener('pointerup', (e) => {
    const d = dragging; dragging = null; if (!d) return;
    if (d.kind === 'floor' && !d.moved) addTarget({ x: d.wx, y: d.wy });
    dirty = true; kick();
  });
  el.addEventListener('pointerleave', () => { mouse = null; hover = null; dirty = true; kick(); });
  el.addEventListener('dblclick', (e) => { const [mx, my] = evPos(e), hit = pick(mx, my); if (hit && hit.kind === 'target') removeTarget(hit.k); });
  let pm = null;
  cvProf.el.addEventListener('pointermove', (e) => { const r = cvProf.el.getBoundingClientRect(); pm = [e.clientX - r.left, e.clientY - r.top]; dirty = true; kick(); });
  cvProf.el.addEventListener('pointerleave', () => { pm = null; dirty = true; kick(); });

  // ---- drawing ----
  const MONO = () => '500 10.5px ' + tok('--mono'), SANS = () => '500 11px ' + tok('--font');
  function drawMain(c, w, hh) {
    const ml = 34, mr = 58, mt = 10, mb = 66, yLo = -(ROOM.standoff + 0.42), yHi = ROOM.d;
    const s = Math.min((w - ml - mr) / ROOM.w, (hh - mt - mb) / (yHi - yLo));
    const ox = Math.round(ml + (w - ml - mr - s * ROOM.w) / 2), oy = Math.round(mt + (hh - mt - mb - s * (yHi - yLo)) / 2);
    const X = (x) => ox + x * s, Y = (y) => oy + (yHi - y) * s;
    geo = { X, Y, s, inv: (a, b) => [(a - ox) / s, yHi - (b - oy) / s] };
    const x0 = X(0), x1 = X(ROOM.w), yT = Y(ROOM.d), yW = Y(0), yB = Y(yLo), yTr = Math.round(Y(-ROOM.standoff)) + 0.5;
    // corridor floor
    c.fillStyle = tok('--bg-0'); c.fillRect(x0, yW, x1 - x0, yB - yW);
    // image
    c.fillStyle = tok('--heat-0'); c.fillRect(x0, yT, x1 - x0, yW - yT);
    if (shown.cv && shown.N > 0) { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(shown.cv, x0, yT, x1 - x0, yW - yT); }
    // metre grid, ticks and axis numbers
    c.lineWidth = 1; c.font = MONO(); c.fillStyle = tok('--text-3');
    for (let m = 0; m <= ROOM.w; m++) { const gx = Math.round(X(m)) + 0.5; if (m > 0 && m < ROOM.w) { c.strokeStyle = rgba('--text', 0.06); c.beginPath(); c.moveTo(gx, yT); c.lineTo(gx, yW); c.stroke(); } c.strokeStyle = tok('--line-3'); c.beginPath(); c.moveTo(gx, yB); c.lineTo(gx, yB + 4); c.stroke(); c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(String(m), gx, yB + 7); }
    for (let m = 0; m <= 6; m++) { const gy = Math.round(Y(m)) + 0.5; if (m > 0) { c.strokeStyle = rgba('--text', 0.06); c.beginPath(); c.moveTo(x0, gy); c.lineTo(x1, gy); c.stroke(); } c.strokeStyle = tok('--line-3'); c.beginPath(); c.moveTo(x0 - 4, gy); c.lineTo(x0, gy); c.stroke(); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(String(m), x0 - 7, gy); }
    lab.label(c, 'm along the wall', x1, yB + 22, { align: 'right', base: 'top', color: tok('--text-3') });
    c.save(); c.translate(x0 - 24, yT); c.rotate(-Math.PI / 2); lab.label(c, 'depth behind the wall, m', 0, 0, { align: 'right', color: tok('--text-3') }); c.restore();
    c.strokeStyle = tok('--line-2'); c.strokeRect(Math.round(x0) + 0.5, Math.round(yT) + 0.5, Math.round(x1 - x0), Math.round(yB - yT));
    { // key to the marks
      let kx = x0, ky = Math.round(yB + 50) + 0.5; const item = (draw, text) => { draw(kx + 7, ky); c.font = SANS(); lab.label(c, text, kx + 19, ky, { color: tok('--text-3') }); kx += 19 + c.measureText(text).width + 18; };
      item((ax, ay) => { c.strokeStyle = tok('--text'); c.lineWidth = 1.25; c.setLineDash([3, 2.5]); c.beginPath(); c.arc(ax, ay, 6, 0, 2 * Math.PI); c.stroke(); c.setLineDash([]); }, 'simulated reflector');
      item((ax, ay) => { c.strokeStyle = tok('--warn'); c.lineWidth = 1.5; c.beginPath(); for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(ax + ux * 3, ay + uy * 3); c.lineTo(ax + ux * 7, ay + uy * 7); } c.stroke(); }, 'peak found in the image');
      item((ax, ay) => { c.strokeStyle = rgba('--accent', 0.8); c.lineWidth = 1; c.beginPath(); c.arc(ax, ay + 6, 9, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }, 'range ring from the rover now');
    }
    // range rings of the current position, clipped to the room
    const xr = xs[nUse - 1];
    c.save(); c.beginPath(); c.rect(x0, yT, x1 - x0, yW - yT); c.clip();
    targets.forEach((t, k) => { const R = Math.hypot(t.x - xr, t.y + ROOM.standoff); c.strokeStyle = rgba('--accent', k === sel ? 0.75 : 0.42); c.lineWidth = 1; c.beginPath(); c.arc(X(xr), Y(-ROOM.standoff), R * s, Math.PI, 2 * Math.PI); c.stroke(); });
    c.restore();
    // wall slab
    const th = Math.max(5, 0.1 * s); c.fillStyle = tok('--bg-4'); c.fillRect(x0, yW, x1 - x0, th);
    c.strokeStyle = tok('--line-3'); c.beginPath(); c.moveTo(x0, Math.round(yW) + 0.5); c.lineTo(x1, Math.round(yW) + 0.5); c.moveTo(x0, Math.round(yW + th) + 0.5); c.lineTo(x1, Math.round(yW + th) + 0.5); c.stroke();
    lab.label(c, 'Drywall slab, assumed ' + fx(WALL.thick * 1000, 0) + ' mm, εr ' + WALL.eps, x0 + 8, yW + th + 12, { color: tok('--text-3') });
    lab.label(c, 'Main corridor', x1 - 8, yW + th + 12, { align: 'right', color: tok('--text-3') });
    lab.label(c, ROOM.name + ', simulated', x0 + 8, yT + 13, { color: tok('--text-2'), bg: true });
    // track: one tick per recorded position
    const tx0 = X(xs[0]), tx1 = X(xs[N - 1]), step = N > 1 ? (tx1 - tx0) / (N - 1) : 1;
    c.strokeStyle = tok('--line-3'); c.beginPath(); c.moveTo(tx0, yTr); c.lineTo(tx1, yTr); c.stroke();
    if (step >= 3) { for (let n = 0; n < N; n++) { const gx = Math.round(tx0 + n * step) + 0.5, on = n < nUse; c.strokeStyle = on ? tok('--accent') : tok('--line-3'); c.beginPath(); c.moveTo(gx, yTr - (on ? 5 : 3)); c.lineTo(gx, yTr + (on ? 5 : 3)); c.stroke(); } }
    else { c.fillStyle = rgba('--line-3', 0.55); c.fillRect(tx0, yTr - 3, tx1 - tx0, 6); c.fillStyle = rgba('--accent', 0.6); c.fillRect(tx0, yTr - 5, X(xr) - tx0, 10); c.fillStyle = tok('--bg-0'); for (let n = 0; n < nUse; n += 2) c.fillRect(Math.round(tx0 + n * step), yTr - 5.5, Math.max(0.5, step * 0.5), 11); }
    // dimension line for the aperture so far
    const yD = yTr + 19, ax1 = X(xr);
    c.strokeStyle = tok('--text-2'); c.beginPath(); c.moveTo(Math.round(tx0) + 0.5, yD - 4); c.lineTo(Math.round(tx0) + 0.5, yD + 4); c.moveTo(Math.round(ax1) + 0.5, yD - 4); c.lineTo(Math.round(ax1) + 0.5, yD + 4); c.moveTo(tx0, yD + 0.5); c.lineTo(ax1, yD + 0.5); c.stroke();
    const dimT = 'aperture ' + fx((nUse - 1) * P.d / 100, 2) + ' m'; c.font = MONO(); const dw = c.measureText(dimT).width;
    lab.label(c, dimT, ax1 - tx0 > dw + 16 ? (tx0 + ax1) / 2 : Math.min(ax1 + 8 + dw / 2, x1 - dw / 2 - 4), yD + (ax1 - tx0 > dw + 16 ? 0 : 0), { align: 'center', font: MONO(), color: tok('--text'), bg: true });
    // rover
    const rw = Math.max(20, 0.44 * s), rh = Math.max(13, 0.3 * s), rx = X(xr), ry = yTr;
    c.fillStyle = rgba('--accent', 0.07); c.beginPath(); c.moveTo(rx, ry); c.lineTo(rx - (yTr - yW) * 1.2, yW + th); c.lineTo(rx + (yTr - yW) * 1.2, yW + th); c.closePath(); c.fill();
    c.fillStyle = tok('--bg-0'); c.strokeStyle = tok('--accent'); c.lineWidth = 1;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const wx = rx + sx * (rw / 2 - 4) - 4, wy = ry + sy * (rh / 2 + 1) - 2; c.fillRect(wx, wy, 8, 4); c.strokeRect(Math.round(wx) + 0.5, Math.round(wy) + 0.5, 8, 4); }
    c.fillStyle = tok('--bg-2'); c.lineWidth = 1.25; c.fillRect(rx - rw / 2, ry - rh / 2, rw, rh); c.strokeRect(Math.round(rx - rw / 2) + 0.5, Math.round(ry - rh / 2) + 0.5, Math.round(rw), Math.round(rh));
    c.fillStyle = tok('--accent'); c.fillRect(rx - 3, ry - rh / 2 - 2, 6, 4);
    if (hover && hover.kind === 'rover' || (dragging && dragging.kind === 'rover')) { c.strokeStyle = rgba('--accent', 0.5); c.strokeRect(Math.round(rx - rw / 2) - 3.5, Math.round(ry - rh / 2) - 3.5, Math.round(rw) + 8, Math.round(rh) + 8); }
    // recovered peaks, then truth markers
    const reticle = (qx, qy, a, b) => { c.beginPath(); for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(qx + ux * a, qy + uy * a); c.lineTo(qx + ux * b, qy + uy * b); } };
    shown.peaks.forEach((p) => { if (!p.found) return; const qx = Math.round(X(p.x)) + 0.5, qy = Math.round(Y(p.y)) + 0.5; c.strokeStyle = rgba('--bg-0', 0.8); c.lineWidth = 3.5; reticle(qx, qy, 5, 10); c.stroke(); c.strokeStyle = tok('--warn'); c.lineWidth = 1.5; reticle(qx, qy, 5, 10); c.stroke(); });
    targets.forEach((t, k) => {
      const qx = X(t.x), qy = Y(t.y), r = 11 + 4 * t.a, hot = k === sel || (hover && hover.kind === 'target' && hover.k === k);
      c.strokeStyle = rgba('--bg-0', 0.75); c.lineWidth = 3.5; c.beginPath(); c.arc(qx, qy, r, 0, 2 * Math.PI); c.stroke();
      c.strokeStyle = hot ? tok('--accent-2') : tok('--text'); c.lineWidth = 1.25; c.setLineDash([3, 2.5]); c.beginPath(); c.arc(qx, qy, r, 0, 2 * Math.PI); c.stroke(); c.setLineDash([]);
      lab.label(c, LETTERS[k], qx + r + 5, qy - r - 1, { color: hot ? tok('--accent-2') : tok('--text'), bg: true, font: '600 11px ' + tok('--font') });
    });
    // magnified view of the selected reflector's patch of image
    if (zoomCv && targets[sel] && zoomK === sel && shown.N > 0) {
      const t = targets[sel], zs = Math.round(Math.min(116, (x1 - x0) * 0.2)), zw = (zs + 30) / s, zh = (zs + 70) / s, clear = (cxm) => Math.min(...targets.map((u) => Math.hypot(Math.max(0, Math.abs(u.x - cxm) - zw / 2), Math.max(0, ROOM.d - zh - u.y)))), left = clear(zw / 2) > clear(ROOM.w - zw / 2) + 0.05, zx = Math.round(left ? x0 + 8 : x1 - 8 - zs) + 0.5, zy = Math.round(yT + 28) + 0.5, half = ((PATCH - 1) / 2) * PSTEP;
      c.strokeStyle = rgba('--text', 0.3); c.lineWidth = 1; c.beginPath(); c.moveTo(X(t.x), Y(t.y) - 15); c.lineTo(left ? zx + zs : zx, zy + zs); c.stroke();
      c.imageSmoothingEnabled = true; c.drawImage(zoomCv, zx, zy, zs, zs);
      c.strokeStyle = rgba('--text', 0.22); c.beginPath(); c.moveTo(zx + zs / 2, zy); c.lineTo(zx + zs / 2, zy + zs); c.moveTo(zx, zy + zs / 2); c.lineTo(zx + zs, zy + zs / 2); c.stroke();
      const p = shown.peaks[sel]; if (p && p.found) { const ux = zx + zs / 2 + ((p.x - t.x) / (2 * half)) * zs, uy = zy + zs / 2 - ((p.y - t.y) / (2 * half)) * zs; c.strokeStyle = tok('--warn'); c.lineWidth = 1.5; reticle(ux, uy, 3, 7); c.stroke(); }
      c.strokeStyle = tok('--line-3'); c.lineWidth = 1; c.strokeRect(zx, zy, zs, zs);
      lab.label(c, LETTERS[sel] + ' magnified, ' + fx(2 * half * 100, 0) + ' cm square', left ? zx : zx + zs, zy + zs + 11, { align: left ? 'left' : 'right', color: tok('--text-2'), bg: true });
      lab.label(c, p && p.found ? 'peak off by ' + fx(p.err * 100, 1) + ' cm' : 'no clear peak', left ? zx : zx + zs, zy + zs + 27, { align: left ? 'left' : 'right', font: MONO(), color: p && p.found ? tok('--warn') : tok('--text-3'), bg: true });
    }
    // colour bar
    const bx0 = Math.round(x1) + 12, bw = 8, bh = yW - yT;
    for (let i = 0; i < bh; i++) { const [r, g, b] = lab.ramp(1 - i / bh); c.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')'; c.fillRect(bx0, yT + i, bw, 1.5); }
    c.strokeStyle = tok('--line-2'); c.lineWidth = 1; c.strokeRect(bx0 + 0.5, Math.round(yT) + 0.5, bw, Math.round(bh));
    c.font = MONO(); c.fillStyle = tok('--text-3'); c.textAlign = 'left'; c.textBaseline = 'middle';
    for (let d = 0; d <= DR; d += 10) { const gy = yT + (d / DR) * bh; c.fillText((d ? '−' + d : '0') + (d === 0 ? ' dB' : ''), bx0 + bw + 5, Math.max(yT + 5, Math.min(yW - 5, gy))); }
    // job progress and notes
    if (job && P.sub && job.N > 40) { c.fillStyle = tok('--accent'); c.fillRect(x0, yT, (x1 - x0) * (job.n / job.N), 2); lab.label(c, 'forming the image: ' + job.n + ' of ' + job.N + ' positions', x1 - 8, yT + 13, { align: 'right', font: MONO(), color: tok('--text-2'), bg: true }); }
    else lab.label(c, shown.N + (shown.N === 1 ? ' position' : ' positions'), x1 - 8, yT + 13, { align: 'right', font: MONO(), color: tok('--text'), bg: true });
    if (shown.note) lab.label(c, shown.note, x0 + 8, yW - 13, { color: tok('--warn'), bg: true });
    // hover read-out
    if (mouse && !dragging && mouse[0] > x0 && mouse[0] < x1 && mouse[1] > yT && mouse[1] < yW) {
      const [wx, wy] = geo.inv(mouse[0], mouse[1]), i = Math.min(IW - 1, (wx / ROOM.w * IW) | 0), j = Math.min(IH - 1, ((ROOM.d - wy) / ROOM.d * IH) | 0);
      c.strokeStyle = rgba('--text', 0.28); c.lineWidth = 1; c.beginPath(); c.moveTo(Math.round(mouse[0]) + 0.5, yT); c.lineTo(Math.round(mouse[0]) + 0.5, yW); c.moveTo(x0, Math.round(mouse[1]) + 0.5); c.lineTo(x1, Math.round(mouse[1]) + 0.5); c.stroke();
      const txt = fx(wx, 2) + ' m, depth ' + fx(wy, 2) + ' m, ' + (shown.N ? fx(shown.db[j * IW + i], 1).replace('-', '−') + ' dB' : ''); c.font = MONO(); const tw = c.measureText(txt).width;
      const lx = mouse[0] + 12 + tw > x1 - 4 ? mouse[0] - 12 - tw : mouse[0] + 12, ly = mouse[1] - 14 < yT + 26 ? mouse[1] + 16 : mouse[1] - 14;
      lab.label(c, txt, lx, ly, { font: MONO(), color: tok('--text'), bg: true });
    }
  }

  const pmR = new Float32Array(M), pmI = new Float32Array(M);
  function drawProfile(c, w, hh) {
    const o = { x: 40, y: 26, w: w - 40 - 14, h: hh - 26 - 38, xd: [0, 12], yd: [-60, 40], xt: [0, 2, 4, 6, 8, 10, 12], yt: [-60, -40, -20, 0, 20, 40], xl: 'range from the rover, m', yl: 'echo, dB re. a unit reflector at 4 m', ylx: 32, yf: (v) => (v < 0 ? '−' + -v : String(v)) };
    if (o.w < 40 || o.h < 30) return;
    const { X, Y } = lab.plot(c, o), n = nUse - 1, p = profOf(n), useMean = P.sub && nUse >= 2;
    if (useMean) meanProf(nUse, pmR, pmI);
    const cols = Math.max(2, Math.floor(o.w)), raw = [], sub = [], kb = M / RU; let subPk = -99;
    for (let q = 0; q < cols; q++) {
      const m0 = Math.floor((q / cols) * 12 * kb), m1 = Math.max(m0 + 1, Math.floor(((q + 1) / cols) * 12 * kb)); let a = 0, b = 0;
      for (let m = m0; m < m1 && m < M; m++) { a = Math.max(a, Math.hypot(p.re[m], p.im[m])); if (useMean) b = Math.max(b, Math.hypot(p.re[m] - pmR[m], p.im[m] - pmI[m])); }
      const xq = o.x + q + 0.5, da = 20 * Math.log10(Math.max(a / REF_AMP, 1e-6)), dbb = 20 * Math.log10(Math.max(b / REF_AMP, 1e-6));
      raw.push([xq, Y(Math.max(-60, da))]); if (useMean) { sub.push([xq, Y(Math.max(-60, dbb))]); subPk = Math.max(subPk, dbb); }
    }
    c.save(); c.beginPath(); c.rect(o.x, o.y, o.w, o.h); c.clip();
    targets.forEach((t, k) => { const R = Math.hypot(t.x - xs[n], t.y + ROOM.standoff) + WALL.delay, gx = Math.round(X(R)) + 0.5; if (R > 12) return; c.strokeStyle = rgba('--text', k === sel ? 0.55 : 0.3); c.setLineDash([2, 3]); c.beginPath(); c.moveTo(gx, o.y + 14); c.lineTo(gx, o.y + o.h); c.stroke(); c.setLineDash([]); lab.label(c, LETTERS[k], gx, o.y + 8, { align: 'center', color: tok('--text'), font: '600 11px ' + tok('--font') }); });
    lab.line(c, raw, useMean ? tok('--text-3') : tok('--accent'), useMean ? 1 : 1.5); if (useMean) lab.line(c, sub, tok('--accent'), 1.5);
    c.restore();
    const wx = X(ROOM.standoff);
    lab.label(c, 'wall echo', wx + 7, Y(WALL.flashDb) + 4, { color: tok('--text-2'), bg: true });
    if (useMean) { c.font = SANS(); const t2 = 'average removed', w2 = c.measureText(t2).width; lab.label(c, t2, o.x + o.w - 6, o.y + o.h - 10, { align: 'right', color: tok('--accent'), bg: true }); lab.label(c, 'raw sweep', o.x + o.w - 18 - w2, o.y + o.h - 10, { align: 'right', color: tok('--text-2'), bg: true }); }
    else lab.label(c, 'raw sweep, wall included', o.x + o.w - 6, o.y + o.h - 10, { align: 'right', color: tok('--accent'), bg: true });
    if (pm && pm[0] > o.x && pm[0] < o.x + o.w && pm[1] > o.y && pm[1] < o.y + o.h) {
      const q = Math.min(cols - 1, Math.max(0, Math.round(pm[0] - o.x))), src = useMean ? sub : raw, R = (q / cols) * 12, gx = Math.round(pm[0]) + 0.5;
      c.strokeStyle = rgba('--text', 0.3); c.beginPath(); c.moveTo(gx, o.y); c.lineTo(gx, o.y + o.h); c.stroke();
      const v = o.yd[0] + ((o.y + o.h - src[q][1]) / o.h) * (o.yd[1] - o.yd[0]);
      lab.label(c, fx(R, 2) + ' m, ' + lab.sgn(v, 1) + ' dB', pm[0] + 10 > o.x + o.w - 110 ? pm[0] - 10 : pm[0] + 10, o.y + 30, { align: pm[0] + 10 > o.x + o.w - 110 ? 'right' : 'left', font: MONO(), color: tok('--text'), bg: true });
    }
  }

  function drawBlur(c, w, hh) {
    const lg = Math.log10, o = { x: 40, y: 26, w: w - 40 - 14, h: hh - 26 - 38, xd: [lg(0.05), lg(10)], yd: [lg(1), lg(400)], xt: [0.1, 0.3, 1, 3, 10].map(lg), yt: [1, 3, 10, 30, 100, 300].map(lg), xl: 'aperture length L, m (log)', yl: 'blur width at −3 dB, cm (log)', ylx: 32, xf: (v) => String(+Math.pow(10, v).toPrecision(1)), yf: (v) => String(+Math.pow(10, v).toPrecision(1)) };
    if (o.w < 40 || o.h < 30) return;
    const { X, Y } = lab.plot(c, o), cl = (v) => Math.max(o.yd[0], Math.min(o.yd[1], v)), ok = Number.isFinite;
    c.save(); c.beginPath(); c.rect(o.x, o.y, o.w, o.h); c.clip();
    const rr = C0 / (2 * P.B * 1e9) * 100, yR = Math.round(Y(lg(rr))) + 0.5;
    lab.line(c, [[o.x, yR], [o.x + o.w, yR]], tok('--text-3'), 1, [2, 3]);
    const rule = blur.filter((b) => b.L > 0).map((b) => [X(lg(b.L)), Y(cl(lg(b.rule * 100)))]);
    lab.line(c, rule, tok('--text-2'), 1, [5, 3]);
    const dn = blur.filter((b) => ok(b.down)).map((b) => [X(lg(b.L)), Y(cl(lg(b.down * 100)))]);
    lab.line(c, dn, rgba('--text', 0.55), 1);
    const cr = blur.filter((b) => ok(b.cross)).map((b) => [X(lg(b.L)), Y(cl(lg(b.cross * 100)))]);
    lab.line(c, cr, tok('--accent'), 1.5);
    c.fillStyle = tok('--accent'); for (const q of cr) c.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3);
    if (cur && cur.L > 0) { const gx = Math.round(X(lg(cur.L))) + 0.5; c.strokeStyle = rgba('--text', 0.35); c.lineWidth = 1; c.beginPath(); c.moveTo(gx, o.y); c.lineTo(gx, o.y + o.h); c.stroke(); if (ok(cur.cross)) { const gy = Y(cl(lg(cur.cross * 100))); c.fillStyle = tok('--bg-1'); c.strokeStyle = tok('--accent'); c.lineWidth = 1.5; c.beginPath(); c.arc(gx, gy, 4, 0, 2 * Math.PI); c.fill(); c.stroke(); } }
    c.restore();
    if (rule.length > 3) { const q = rule[Math.floor(rule.length * 0.22)]; lab.label(c, 'rule λR / 2L', q[0] + 8, q[1] - 9, { color: tok('--text-2'), bg: true }); }
    if (cr.length > 3) { const q = cr[cr.length - 1]; lab.label(c, 'measured, cross-range', Math.min(q[0] - 6, o.x + o.w - 6), q[1] + 13 > o.y + o.h - 8 ? q[1] - 13 : q[1] + 13, { align: 'right', color: tok('--accent'), bg: true }); }
    lab.label(c, 'down-range rule c / 2B, ' + fx(rr, 1) + ' cm', o.x + 6, yR - 10, { color: tok('--text-3'), bg: true });
    if (dn.length > 2) lab.label(c, 'down-range, measured', o.x + 6, dn[0][1] + 11, { color: rgba('--text', 0.6), bg: true });
    if (blurQueue) lab.label(c, 'measuring ' + blur.length + ' apertures…', o.x + o.w - 6, o.y + 10, { align: 'right', font: MONO(), color: tok('--text-2'), bg: true });
  }

  // ---- loop ----
  const run = lab.loop((t, dt) => {
    const still = lab.reducedMotion();
    if (still) { playing = false; if (!autoplayed) { autoplayed = true; nUse = N; syncScrub(); syncPlay(); } let g = 0; while (pump(40) && g++ < 400); g = 0; while (pumpBlur() && g++ < 400); }
    else {
      if (!autoplayed) { autoplayed = true; playing = true; playU = 0; nUse = 1; syncPlay(); }
      if (playing) { playU = Math.max(0, Math.min(1, playU + Math.max(0, dt) / DRIVE_S)); nUse = 1 + Math.round((N - 1) * Math.pow(playU, 1.6)); syncScrub(); if (playU >= 1) { playing = false; syncPlay(); } dirty = true; }
      const busy = pump(7); if (!busy && !playing && !dragging) pumpBlur();
    }
    if (dirty) { dirty = false; syncStats(); cvMain.redraw(); cvProf.redraw(); cvBlur.redraw(); }
  });
  const kick = () => run.once();

  configure(); rebuildList(); syncAll();
  globalThis.__sarDbg = () => ({ N, nUse, shownN: shown.N, shownKey: shown.key, key: keyNow(), job: job && { n: job.n, N: job.N }, accN, playing, run: run.running, peaks: shown.peaks, cur, blurN: blur.length });
  return {
    onShow() { shown.key = ''; shown.N = 0; accKey = ''; job = null; dirty = true; run.start(); },
    onHide() { run.stop(); },
    // for the self-check in the page
    _debug: () => ({ P: { ...P }, N, nUse, shownN: shown.N, peaks: shown.peaks.map((p) => ({ found: p.found, errCm: +(p.err * 100).toFixed(2), db: +p.db.toFixed(1) })), cur, blur: blur.length, playing }),
    _set: (o) => { if (o.nUse) { playing = false; setUse(o.nUse); syncPlay(); } },
  };
}
