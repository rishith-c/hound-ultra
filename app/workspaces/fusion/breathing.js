// Breathing band, honestly. A still person's micro-motion signal is simulated here in the browser, its spectrum is
// computed for real, and a rate is estimated. The panel exists to show why the console does NOT display a breathing
// rate as a reading: in the project's own test the estimate was within 3 breaths a minute only 41 % of the time.
import { tokens, rgba, clamp, mulberry, gaussian, roundRect } from './util.js';

const FS = 20, NFFT = 2048, BAND = [0.1, 0.5], RATE = [7, 30];
// The project's measured result (ml/results/synthetic.md): 75 still people the network found.
const FOUND = { n: 75, within: 31, pct: 41.3, median: 6.1, clearest: 42.1 };

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
// One simulated window: chest motion plus the things that hide it.
export function simulate(rnd, seconds, noise) {
  const n = Math.round(seconds * FS), rate = RATE[0] + rnd() * (RATE[1] - RATE[0]), f = rate / 60, amp = 0.05 + rnd() * 0.35, ph = rnd() * Math.PI * 2;
  const clean = new Float32Array(n), x = new Float32Array(n);
  let drift = 0; const jumpAt = rnd() < 0.3 ? Math.floor(rnd() * n) : -1, jump = (rnd() - 0.5) * 0.5 * noise;
  for (let i = 0; i < n; i++) {
    const t = i / FS;
    clean[i] = amp * (Math.sin(2 * Math.PI * f * t + ph) + 0.25 * Math.sin(4 * Math.PI * f * t + 2 * ph + 0.6)) / 1.1; // breathing in is quicker than out
    drift += 0.035 * noise * gaussian(rnd);
    x[i] = clean[i] + noise * gaussian(rnd) + drift + (jumpAt >= 0 && i >= jumpAt ? jump : 0);
  }
  return { n, rate, amp, clean, x, seconds };
}
export function estimate(sig) {
  const n = sig.n, x = sig.x, re = new Float64Array(NFFT), im = new Float64Array(NFFT);
  let sx = 0, sy = 0, sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sx += i; sy += x[i]; sxx += i * i; sxy += i * x[i]; }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
  for (let i = 0; i < n; i++) re[i] = (x[i] - a - b * i) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im);
  const half = NFFT / 2, mag = new Float32Array(half); for (let k = 0; k < half; k++) mag[k] = Math.hypot(re[k], im[k]) / (n / 4);
  const k0 = Math.ceil((BAND[0] * NFFT) / FS), k1 = Math.floor((BAND[1] * NFFT) / FS);
  let kp = -1, sum = 0;
  for (let k = k0; k <= k1; k++) { sum += mag[k]; if (mag[k] >= mag[k - 1] && mag[k] >= mag[k + 1] && (kp < 0 || mag[k] > mag[kp])) kp = k; } // the tallest true peak inside the band
  if (kp < 0) { kp = k0; for (let k = k0; k <= k1; k++) if (mag[k] > mag[kp]) kp = k; }
  return { mag, rate: ((kp * FS) / NFFT) * 60, peak: mag[kp], clarity: mag[kp] / (sum / (k1 - k0 + 1)) };
}

export function createBreathing(host, ctx) {
  const { h, icon, realityTag } = ctx.kit;
  const P = { seconds: 10, noise: 1.5, showTrue: false };
  let seed = 7, sig = null, est = null, batch = null, isDirty = true;
  const sizes = { ts: { w: 0, h: 0 }, sp: { w: 0, h: 0 }, sc: { w: 0, h: 0 } };
  const cTs = h('canvas.fusion-br-ts', { role: 'img' }), cSp = h('canvas.fusion-br-sp', { role: 'img' }), cSc = h('canvas.fusion-br-sc', { role: 'img' });
  for (const [k, cv] of [['ts', cTs], ['sp', cSp], ['sc', cSc]]) ctx.kit.fitCanvas(cv, (c, w, hh) => { sizes[k] = { w, h: hh }; isDirty = true; });

  const segBtn = (v) => h('button', { type: 'button', 'aria-pressed': String(P.seconds === v), onclick: (e) => { P.seconds = v; [...e.target.parentElement.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.target))); regen(true); } }, v + ' s');
  const noiseOut = h('span.num'), noise = h('input.slider.fusion-range', { type: 'range', min: '0.2', max: '2.5', step: '0.1', value: String(P.noise), 'aria-label': 'Sensor noise, in percent of the signal', oninput: (e) => { P.noise = +e.target.value; e.target.style.setProperty('--p', ((P.noise - 0.2) / 2.3) * 100 + '%'); regen(true); } });
  noise.style.setProperty('--p', ((P.noise - 0.2) / 2.3) * 100 + '%');
  const trueChk = h('input', { type: 'checkbox', onchange: (e) => { P.showTrue = e.target.checked; isDirty = true; } });
  const controls = h('div.fusion-br-controls', null,
    h('button.btn.btn-sm', { type: 'button', onclick: () => { seed++; regen(false); } }, icon('reset'), 'New person'),
    h('div.seg', { role: 'group', 'aria-label': 'How long the sensor listens' }, segBtn(10), segBtn(20), segBtn(40)),
    h('label.fusion-br-noise', null, h('span.dim', null, 'Noise'), noise, noiseOut),
    h('label.check', null, trueChk, h('span', null, 'Show true motion')));

  const readEst = h('span.num'), readTrue = h('span.num'), readErr = h('span');
  const dots = h('div.fusion-dots', { 'aria-hidden': 'true' }, ...Array.from({ length: FOUND.n }, (_, i) => h('i' + (i < FOUND.within ? '.on' : ''))));
  const withheld = h('div.fusion-withheld', null,
    h('div.fusion-withheld-read', { 'aria-label': 'Breathing rate: not shown as a reading' }, h('span.dim', null, 'Breathing rate'), h('b.num', { 'aria-hidden': 'true' }, '– –'), h('span.dim', null, 'per min'), h('span.tag.tag-warn', null, 'Withheld')),
    h('p.fusion-withheld-why', null, h('b', null, 'The console does not show a breathing rate as a reading.'), ' In the project’s own test, on ' + FOUND.n + ' still simulated people the network had found, the estimate was within 3 breaths a minute for only ' + FOUND.within + ' of them (' + FOUND.pct.toFixed(0) + ' %). The median error was ' + FOUND.median + ' a minute, and the windows with the clearest rhythm did no better (' + FOUND.clearest.toFixed(0) + ' %).'),
    dots, h('p.dim.fusion-dots-cap', null, 'One dot per test window. Filled: within 3 breaths a minute. Simulated people; no real recordings exist yet.'),
    h('div.fusion-exp', null, h('span.tag.tag-sim', null, 'Experiment'), h('span', null, 'This signal: estimate ', readEst, ', true rate ', readTrue, ' (known only because it is simulated). ', readErr)));
  const batchLine = h('p.fusion-br-batch');
  const body = h('div.fusion-br', null, controls,
    h('figure.fusion-fig', null, h('figcaption', null, h('b', null, 'What the sensor records: '), 'chest motion of 0.05 to 0.4 % of the signal, under noise, drift and gain jumps'), cTs),
    h('figure.fusion-fig', null, h('figcaption', null, h('b', null, 'Its spectrum: '), 'the tallest peak in the band is taken as the rate. A short window makes every peak wide'), cSp),
    h('div.fusion-br-bottom', null, withheld,
      h('figure.fusion-fig.fusion-br-scfig', null, h('figcaption', null, h('b', null, 'Wrong estimates land anywhere in the band')), cSc, batchLine)));
  const panel = ctx.kit.panel('Breathing band: a rate you can compute, but should not trust yet', { tag: realityTag('sim'), flush: true }, body);
  panel.classList.add('fusion-brp'); host.append(panel);

  function regen(batchToo) {
    sig = simulate(mulberry(seed * 7919 + 13), P.seconds, P.noise); est = estimate(sig);
    if (batchToo || !batch) {
      const rnd = mulberry(4242), pts = [];
      for (let i = 0; i < 300; i++) { const s = simulate(rnd, P.seconds, P.noise), e = estimate(s); pts.push({ t: s.rate, e: e.rate, c: e.clarity, ok: Math.abs(e.rate - s.rate) <= 3 }); }
      const errs = pts.map((p) => Math.abs(p.e - p.t)).sort((a, b) => a - b), top = [...pts].sort((a, b) => b.c - a.c).slice(0, 75);
      batch = { pts, within: pts.filter((p) => p.ok).length / pts.length, median: errs[150], clearest: top.filter((p) => p.ok).length / top.length };
    }
    isDirty = true;
  }
  regen(true);

  function draw() {
    const T = tokens();
    const font = (c, wt, px, mono) => (c.font = wt + ' ' + px + 'px ' + (mono ? T.mono : T.font));
    // time series
    { const { w, h: hh } = sizes.ts; if (w) {
      const c = cTs.getContext('2d'); c.clearRect(0, 0, w, hh);
      const l = 48, r = 18, t = 8, b = 20, pw = w - l - r, ph = hh - t - b; let m = 0.2; for (const v of sig.x) m = Math.max(m, Math.abs(v)); m *= 1.08;
      const X = (i) => l + (i / (sig.n - 1)) * pw, Y = (v) => t + ph / 2 - (v / m) * (ph / 2);
      c.strokeStyle = T.line; c.lineWidth = 1; c.beginPath(); for (let s = 0; s <= sig.seconds; s += sig.seconds / 10) { const x = Math.round(l + (s / sig.seconds) * pw) + 0.5; c.moveTo(x, t); c.lineTo(x, t + ph); } c.moveTo(l, Y(0) + 0.5); c.lineTo(l + pw, Y(0) + 0.5); c.stroke();
      c.strokeStyle = rgba(T.text2, 0.9); c.lineWidth = 1; c.beginPath(); for (let i = 0; i < sig.n; i++) (i ? c.lineTo(X(i), Y(sig.x[i])) : c.moveTo(X(i), Y(sig.x[i]))); c.stroke();
      if (P.showTrue) { c.strokeStyle = T.ok; c.lineWidth = 2; c.beginPath(); for (let i = 0; i < sig.n; i++) (i ? c.lineTo(X(i), Y(sig.clean[i])) : c.moveTo(X(i), Y(sig.clean[i]))); c.stroke(); font(c, 600, 10.5, false); c.fillStyle = T.ok; c.textAlign = 'right'; c.textBaseline = 'top'; c.fillText('true chest motion (simulation only)', l + pw - 4, t + 2); }
      font(c, 500, 10, true); c.fillStyle = T.text3; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText('+' + m.toFixed(1) + ' %', l - 5, t + 5); c.fillText('−' + m.toFixed(1) + ' %', l - 5, t + ph - 5); c.fillText('0', l - 5, Y(0));
      c.textAlign = 'center'; c.textBaseline = 'top'; for (let s = 0; s <= sig.seconds; s += sig.seconds / 5) c.fillText(s + ' s', l + (s / sig.seconds) * pw, t + ph + 5);
      cTs.setAttribute('aria-label', 'Simulated micro-motion signal over ' + sig.seconds + ' seconds.');
    } }
    // spectrum
    { const { w, h: hh } = sizes.sp; if (w) {
      const c = cSp.getContext('2d'); c.clearRect(0, 0, w, hh);
      const l = 48, r = 18, t = 22, b = 20, pw = w - l - r, ph = hh - t - b, FMAX = 0.8, kmax = Math.floor((FMAX * NFFT) / FS);
      let m = 0; for (let k = 1; k <= kmax; k++) m = Math.max(m, est.mag[k]); m *= 1.15;
      const X = (f) => l + (f / FMAX) * pw, Y = (v) => t + ph - (v / m) * ph;
      c.fillStyle = rgba(T.accent, 0.08); c.fillRect(X(BAND[0]), t, X(BAND[1]) - X(BAND[0]), ph);
      c.strokeStyle = rgba(T.accent, 0.5); c.setLineDash([3, 3]); c.beginPath(); c.moveTo(X(BAND[0]) + 0.5, t); c.lineTo(X(BAND[0]) + 0.5, t + ph); c.moveTo(X(BAND[1]) + 0.5, t); c.lineTo(X(BAND[1]) + 0.5, t + ph); c.stroke(); c.setLineDash([]);
      font(c, 500, 10.5, false); c.fillStyle = T.accent; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('breathing band, 0.1 to 0.5 Hz', X(BAND[0]) + 5, t + 3);
      c.strokeStyle = T.line; c.beginPath(); c.moveTo(l, t + ph + 0.5); c.lineTo(l + pw, t + ph + 0.5); c.stroke();
      const g = c.createLinearGradient(0, t, 0, t + ph); g.addColorStop(0, rgba(T.text2, 0.35)); g.addColorStop(1, rgba(T.text2, 0.02));
      c.beginPath(); c.moveTo(X(0), Y(0)); for (let k = 0; k <= kmax; k++) c.lineTo(X((k * FS) / NFFT), Y(est.mag[k])); c.lineTo(X(FMAX), Y(0)); c.closePath(); c.fillStyle = g; c.fill();
      c.beginPath(); for (let k = 0; k <= kmax; k++) (k ? c.lineTo(X((k * FS) / NFFT), Y(est.mag[k])) : c.moveTo(X(0), Y(est.mag[0]))); c.strokeStyle = T.text; c.lineWidth = 1.3; c.stroke();
      // estimate and truth
      const fe = est.rate / 60, ft = sig.rate / 60;
      c.strokeStyle = T.text; c.lineWidth = 1; c.beginPath(); c.moveTo(X(fe) + 0.5, Y(est.peak) - 3); c.lineTo(X(fe) + 0.5, t + ph); c.stroke(); c.fillStyle = T.text; c.beginPath(); c.arc(X(fe) + 0.5, Y(est.peak), 3, 0, Math.PI * 2); c.fill();
      c.strokeStyle = T.ok; c.setLineDash([4, 3]); c.lineWidth = 1.5; c.beginPath(); c.moveTo(X(ft) + 0.5, t); c.lineTo(X(ft) + 0.5, t + ph); c.stroke(); c.setLineDash([]);
      font(c, 600, 10.5, true); const eRight = fe >= ft;
      { const lab = 'estimate ' + est.rate.toFixed(0) + '/min', lw = c.measureText(lab).width, ly = t + ph - 8, lx = eRight ? X(fe) + 7 : X(fe) - 7 - lw; c.fillStyle = rgba(T.bg2, 0.85); c.fillRect(lx - 3, ly - 12, lw + 6, 15); c.fillStyle = T.text; c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText(lab, lx, ly + 1); }
      c.fillStyle = T.ok; c.textAlign = eRight ? 'right' : 'left'; c.textBaseline = 'top'; c.fillText('true ' + sig.rate.toFixed(0) + '/min', X(ft) + (eRight ? -6 : 6), t + 18);
      // what one window can resolve
      const step = 1 / sig.seconds, bx = X(FMAX) - X(step) + X(0) - 6;
      c.strokeStyle = T.warn; c.lineWidth = 1.5; c.beginPath(); c.moveTo(bx, t + 30); c.lineTo(bx + X(step) - X(0), t + 30); c.moveTo(bx, t + 26); c.lineTo(bx, t + 34); c.moveTo(bx + X(step) - X(0), t + 26); c.lineTo(bx + X(step) - X(0), t + 34); c.stroke();
      font(c, 500, 10.5, false); c.fillStyle = T.warn; c.textAlign = 'right'; c.textBaseline = 'top'; c.fillText('a ' + sig.seconds + ' s window cannot separate rates closer than ' + (step * 60).toFixed(1).replace('.0', '') + '/min', X(FMAX) - 6, t + 3);
      font(c, 500, 10, true); c.fillStyle = T.text3; c.textBaseline = 'top'; c.textAlign = 'center';
      for (let f = 0; f <= FMAX + 1e-9; f += 0.1) c.fillText(f.toFixed(1) + (f === 0 ? ' Hz' : ''), X(f), t + ph + 5);
      c.textBaseline = 'bottom'; for (let bpm = 6; bpm <= 42; bpm += 6) c.fillText(String(bpm), X(bpm / 60), t - 3); c.textAlign = 'right'; c.fillText('per min', l + 8, t - 3);
      cSp.setAttribute('aria-label', 'Spectrum. Estimated rate ' + est.rate.toFixed(0) + ' per minute, true rate ' + sig.rate.toFixed(0) + ' per minute.');
    } }
    // estimate against truth
    { const { w, h: hh } = sizes.sc; if (w) {
      const c = cSc.getContext('2d'); c.clearRect(0, 0, w, hh);
      const l = 40, r = 10, t = 8, b = 30, pw = w - l - r, ph = hh - t - b, A = 4, B = 32;
      const X = (v) => l + ((v - A) / (B - A)) * pw, Y = (v) => t + ph - ((v - A) / (B - A)) * ph;
      c.save(); c.beginPath(); c.rect(l, t, pw, ph); c.clip();
      c.fillStyle = rgba(T.ok, 0.13); c.beginPath(); c.moveTo(X(A), Y(A + 3)); c.lineTo(X(B), Y(B + 3)); c.lineTo(X(B), Y(B - 3)); c.lineTo(X(A), Y(A - 3)); c.closePath(); c.fill();
      c.strokeStyle = rgba(T.ok, 0.6); c.lineWidth = 1; c.beginPath(); c.moveTo(X(A), Y(A)); c.lineTo(X(B), Y(B)); c.stroke();
      for (const p of batch.pts) { c.fillStyle = p.ok ? rgba(T.ok, 0.95) : rgba(T.text2, 0.55); c.beginPath(); c.arc(X(p.t), Y(p.e), 2, 0, Math.PI * 2); c.fill(); }
      c.strokeStyle = T.text; c.lineWidth = 1.5; c.beginPath(); c.arc(X(sig.rate), Y(est.rate), 5.5, 0, Math.PI * 2); c.stroke();
      c.restore();
      c.strokeStyle = T.line2; c.lineWidth = 1; c.strokeRect(l + 0.5, t + 0.5, pw, ph);
      font(c, 500, 10, true); c.fillStyle = T.text3; c.textAlign = 'center'; c.textBaseline = 'top'; for (let v = 6; v <= 30; v += 6) c.fillText(String(v), X(v), t + ph + 4);
      c.textAlign = 'right'; c.textBaseline = 'middle'; for (let v = 6; v <= 30; v += 6) c.fillText(String(v), l - 5, Y(v));
      font(c, 500, 10.5, false); c.fillStyle = T.text2; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText('true breaths per minute', l + pw / 2, hh - 1);
      c.save(); c.translate(11, t + ph / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'middle'; c.fillText('estimated', 0, 0); c.restore();
      c.fillStyle = T.ok; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('green band: within 3/min', l + 6, t + 5);
      cSc.setAttribute('aria-label', 'Scatter of estimated against true breathing rate for 300 simulated people. ' + (batch.within * 100).toFixed(0) + ' percent within 3 per minute.');
    } }
    noiseOut.textContent = P.noise.toFixed(1) + ' %';
    readEst.textContent = est.rate.toFixed(0) + '/min'; readTrue.textContent = sig.rate.toFixed(0) + '/min';
    const err = Math.abs(est.rate - sig.rate); readErr.textContent = err <= 3 ? 'Within 3 this time.' : 'Off by ' + err.toFixed(0) + ' this time.';
    batchLine.replaceChildren(P.seconds + ' s at ' + P.noise.toFixed(1) + ' % noise: ', h('b.num', null, (batch.within * 100).toFixed(0) + ' %'), ' within 3/min, median error ', h('b.num', null, batch.median.toFixed(1)), ', clearest quarter ', h('b.num', null, (batch.clearest * 100).toFixed(0) + ' %'), '. ', P.noise === 1.5 && P.seconds === 10 ? 'Noise chosen so this illustration behaves like the project’s measured result: an assumption, not a measurement.' : 'Compare with 10 s at 1.5 %, the setting that behaves like the project’s measured result.');
  }
  return { dirty() { isDirty = true; }, frame() { if (!isDirty) return; isDirty = false; draw(); } };
}
