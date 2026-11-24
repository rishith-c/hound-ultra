// Heartbeat by laser: a laser Doppler vibrometer reads the velocity of a surface from the Doppler shift of the
// light it sends back. Everything is computed here: a seeded recording of the velocity at the laser spot (heartbeat,
// breathing, sway, platform vibration, speckle and shot noise), then the real processing (high-pass, despike, Welch
// averaged spectrum, harmonic-product heart-rate estimate, detection score) and the comparison with the truth.
//
// Numbers and where they come from:
//   1550 nm measurement laser, 10 mW, works from 5 m to beyond 300 m, spot 7.5 mm wide at 100 m:
//     Polytec RSV-150 remote sensing vibrometer data sheet (a commercial instrument of the kind the Jetson
//     report says was adapted). The spot is scaled linearly with range from that figure.
//   200 m, about 30 s for a good return, works through a shirt: Hambling, MIT Technology Review, 27 June 2019.
//   Heart rate from chest and neck velocity agrees with the electrocardiogram within about 3 %:
//     Morbiducci et al. 2007 (chest, 10 people), Scalise and Morbiducci 2008 (carotid, 5 people).
//   ASSUMED (no published value was verified for these; each is marked "assumed" where it is shown):
//     shot-noise floor 0.3 um/s per root hertz at 10 m on a white matte surface; reflectivity of each surface;
//     heartbeat and breathing displacement of each surface; sway, tremor and site vibration; the pointing lever.
import * as L from '../lib.js';
const { TAU, clamp } = L;

export const FS = 64, NSEG = 512, HOP = 128, NFFT = 2048, TREC = 120, TMC = 60, ZTHR = 6;
const DF = FS / NFFT, NB = Math.floor(17 / DF), LAM = 1.55 /* um */, N10 = 0.3 /* um/s/rtHz at 10 m, assumed */, LEVER = 0.3 /* m, assumed */;
// card, breath: displacement in um. sway, tremor: um/s rms. slide: how fast the surface slips sideways under the spot, mm/s. rho: diffuse reflectivity at 1550 nm.
export const SURF = {
  neck: { short: 'Neck skin', name: 'bare neck skin', at: 'bare neck skin over the artery', card: 100, width: 1, breath: 400, sway: 120, tremor: 0, slide: 0.5, rho: 0.04 },
  chest: { short: 'Chest, shirt', name: 'the chest through a shirt', at: 'the chest, through a shirt', card: 90, width: 1.7, breath: 4000, sway: 150, tremor: 0, slide: 2, rho: 0.3 },
  hand: { short: 'Hand', name: 'the back of a hand', at: 'the back of a hand', card: 10, width: 1.2, breath: 60, sway: 250, tremor: 300, slide: 3, rho: 0.04 },
  slab: { short: 'Slab', name: 'the slab the person lies against', at: 'the slab the person lies against', card: 0.03, width: 2, breath: 0.3, sway: 1.5, tremor: 0, slide: 0.02, rho: 0.25 },
};
const rms = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, a.length)); };
const toRms = (a, target) => { const r = rms(a), k = r > 0 ? target / r : 0; for (let i = 0; i < a.length; i++) a[i] *= k; return a; };
const gd = (t, m, s) => (-(t - m) / (s * s)) * Math.exp(-0.5 * ((t - m) / s) ** 2);   // derivative of a unit Gaussian bump
// velocity of one heartbeat at the skin, per unit of peak displacement: a fast systolic rise, a notch, a dicrotic wave
const beatVel = (t) => gd(t, 0.11, 0.045) + 0.35 * gd(t, 0.37, 0.06) - 0.1 * gd(t, 0.29, 0.022);

// ---------- the simulated recording: velocity at the laser spot along the beam, um/s, FS samples a second ----------
export function simulate(p, T, seed) {
  const R = L.rng(seed), S = SURF[p.surf], n = Math.round(T * FS), dt = 1 / FS;
  const card = new Float64Array(n), breath = new Float64Array(n), sway = new Float64Array(n), plat = new Float64Array(n), noise = new Float64Array(n), v = new Float64Array(n);
  const bph = new Float32Array(n), ret = new Float32Array(n), drop = new Uint8Array(n);
  // breathing: a slow, slightly lopsided wave whose rate wanders
  const fb = 0.25 * (1 + 0.1 * R.n()); let ph = R() * TAU, wd = 0;
  for (let i = 0; i < n; i++) { wd += (-wd / 15) * dt + 0.06 * Math.sqrt((2 * dt) / 15) * R.n(); const f = fb * (1 + wd); ph += TAU * f * dt; bph[i] = ph;
    breath[i] = S.breath * TAU * f * (Math.cos(ph) + 0.44 * Math.cos(2 * ph + 0.7) + 0.18 * Math.cos(3 * ph + 1.3) + 0.06 * Math.cos(4 * ph + 0.4)); }
  // heartbeats: the interval follows the breath a little (sinus arrhythmia) and jitters from beat to beat
  const beats = []; let tb = -R() * (60 / p.hr);
  while (tb < T + 1) { const a = 1 + 0.05 * R.n(); beats.push(tb); const i0 = Math.max(0, Math.ceil(tb * FS)), i1 = Math.min(n, Math.ceil((tb + 0.75 * S.width) * FS));
    for (let i = i0; i < i1; i++) card[i] += ((S.card * a) / S.width) * beatVel((i * dt - tb) / S.width);
    tb += (60 / p.hr) * (1 + 0.035 * Math.sin(bph[clamp(Math.round(tb * FS), 0, n - 1)]) + 0.012 * R.n()); }
  // sway of the body (slow, random) and, on a hand, tremor near 9 Hz; vibration of the platform, peaked at a tripod resonance near 11 Hz
  const lp = (fc, out) => { const a = Math.exp(-TAU * fc * dt); let y1 = 0, y2 = 0; for (let i = 0; i < n; i++) { y1 = a * y1 + (1 - a) * R.n(); y2 = a * y2 + (1 - a) * y1; out[i] = y2; } return out; };
  const res = (f0, q, out) => { const r = Math.exp((-Math.PI * f0) / q * dt), c = 2 * r * Math.cos(TAU * f0 * dt); let y1 = 0, y2 = 0; for (let i = 0; i < n; i++) { const y = c * y1 - r * r * y2 + R.n(); y2 = y1; y1 = y; out[i] = y; } return out; };
  toRms(lp(1.2, sway), S.sway); if (S.tremor) { const tr = toRms(res(9, 5, new Float64Array(n)), S.tremor); for (let i = 0; i < n; i++) sway[i] += tr[i]; }
  { const a = toRms(res(11, 3, new Float64Array(n)), 0.8), b = toRms(lp(3, new Float64Array(n)), 0.6); for (let i = 0; i < n; i++) plat[i] = a[i] + b[i]; toRms(plat, p.vib); }
  // speckle: the returned light is a random phasor that changes each time the spot slides about one spot width
  const spot = Math.max(2, 7.5 * p.range / 100), trans = S.slide + (p.vib / LEVER) * p.range / 1000, tauC = spot / trans, ac = Math.exp(-dt / tauC), sc = Math.sqrt((1 - ac * ac) / 2);
  const n0 = (N10 * (p.range / 10)) / Math.sqrt(S.rho), sig = n0 * Math.sqrt(FS / 2);
  let ar = R.n() * Math.SQRT1_2, ai = R.n() * Math.SQRT1_2, nDrop = 0;
  for (let i = 0; i < n; i++) { const pr = ar, pi = ai; ar = ac * ar + sc * R.n(); ai = ac * ai + sc * R.n();
    const I = ar * ar + ai * ai, dphi = Math.atan2(ai * pr - ar * pi, ar * pr + ai * pi); ret[i] = I; if (I < 0.05) { drop[i] = 1; nDrop++; }
    noise[i] = (LAM / (2 * TAU)) * dphi * FS + (sig * R.n()) / Math.sqrt(Math.max(I, 0.004));
    v[i] = card[i] + breath[i] + sway[i] + plat[i] + noise[i]; }
  const other = new Float64Array(n); for (let i = 0; i < n; i++) other[i] = v[i] - card[i];
  return { n, T, v, card, bph, ret, drop, beats, n0, tauC, spot, dropFrac: nDrop / n, rms: { card: rms(card), breath: rms(breath), sway: rms(sway), plat: rms(plat), noise: rms(noise), other: rms(other) } };
}
export function trueRate(beats, ta, tb) { let a = -1, b = -1, k = 0; for (const t of beats) if (t >= ta && t <= tb) { if (a < 0) a = t; b = t; k++; } return k > 1 ? (60 * (k - 1)) / (b - a) : NaN; }

// ---------- the processing ----------
// 1. High-pass, fourth-order Butterworth at 0.5 Hz, run forwards then backwards (zero phase): removes breathing. 2. Clip speckle spikes at 5 robust sigma.
export function prefilter(v) {
  const n = v.length, y = Float64Array.from(v); let m = 0; for (let i = 0; i < n; i++) m += y[i]; m /= n; for (let i = 0; i < n; i++) y[i] -= m;
  const w0 = (TAU * 0.5) / FS, cs = Math.cos(w0), sn = Math.sin(w0);
  const pass = (q, rev) => { const al = sn / (2 * q), a0 = 1 + al, b0 = (1 + cs) / 2 / a0, b1 = -(1 + cs) / a0, a1 = (-2 * cs) / a0, a2 = (1 - al) / a0; let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let k = 0; k < n; k++) { const i = rev ? n - 1 - k : k, x = y[i], o = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = o; y[i] = o; } };
  pass(0.5412, false); pass(1.3066, false); pass(0.5412, true); pass(1.3066, true);
  const ab = Float64Array.from(y, Math.abs).sort(), lim = 5 * 1.4826 * ab[n >> 1]; let clipped = 0;
  if (lim > 0) for (let i = 0; i < n; i++) if (Math.abs(y[i]) > lim) { y[i] = Math.sign(y[i]) * lim; clipped++; }
  return { y, clipped };
}
// 3. One power spectrum per 8 s segment (Hann window, 75 % overlap, zero-padded), one-sided, in (um/s)^2 per hertz.
const WIN = L.hann(NSEG), WSS = WIN.reduce((s, w) => s + w * w, 0);
export function segments(y) {
  const out = [], re = new Float64Array(NFFT), im = new Float64Array(NFFT);
  for (let s = 0; s + NSEG <= y.length; s += HOP) { re.fill(0); im.fill(0); for (let i = 0; i < NSEG; i++) re[i] = y[s + i] * WIN[i]; L.fft(re, im);
    const P = new Float64Array(NB); for (let k = 0; k < NB; k++) P[k] = (2 * (re[k] * re[k] + im[k] * im[k])) / (FS * WSS); out.push(P); }
  return out;
}
// Hann windows at 75 % overlap are correlated: K segments are worth fewer independent averages (Welch 1967; Harris 1978).
export const kEff = (K) => { const c = [0.434, 0.0279, 0.00006]; let s = 1; for (let j = 1; j <= Math.min(3, K - 1); j++) s += 2 * (1 - j / K) * c[j - 1]; return K / s; };
const q25 = (K) => (1 - 1 / (9 * K) - 0.6745 / (3 * Math.sqrt(K))) ** 3;   // lower quartile of an average of K exponentials (Wilson-Hilferty)
// Scatter of the harmonic sum when there is only noise, in dB, against the number of independent averages. PLACEHOLDER
export const sigma0 = (ke) => 9.7 / Math.sqrt(ke);
const CAND = Float64Array.from({ length: Math.round((3.2 - 0.75) * 128) + 1 }, (_, i) => 0.75 + i / 128);
// 4. Welch average of K segments. 5. Noise floor: the lower quartile within 1 Hz either side, corrected to a mean.
// 6. Harmonic product: for every candidate rate, add the decibels above the floor at its first five harmonics.
// 7. Score: how far the best candidate stands above the others, in robust standard deviations.
export function analyse(psd, K) {
  const ke = kEff(K), fl = new Float64Array(NB), W = new Float64Array(NB), half = Math.round(1 / DF), kmin = Math.round(0.55 / DF), buf = [], corr = q25(ke), STEP = 4;
  const at = (j) => { buf.length = 0; for (let k = Math.max(kmin, j - half); k <= Math.min(NB - 1, j + half); k++) buf.push(psd[k]); buf.sort((a, b) => a - b); return buf[buf.length >> 2] / corr; };
  let prev = at(0), pj = 0; fl[0] = prev;
  for (let j = STEP; j < NB + STEP; j += STEP) { const jj = Math.min(NB - 1, j), cur = at(jj); for (let k = pj + 1; k <= jj; k++) fl[k] = prev + ((cur - prev) * (k - pj)) / (jj - pj); prev = cur; pj = jj; if (jj === NB - 1) break; }
  for (let k = 0; k < NB; k++) W[k] = psd[k] / fl[k];
  const band = (f) => { const lo = (f * 0.97) / DF, hi = (f * 1.03) / DF; if (hi - lo < 1) { const x = f / DF, i = Math.min(NB - 2, Math.floor(x)); return W[i] + (W[i + 1] - W[i]) * (x - i); } let s = 0, c = 0; for (let k = Math.ceil(lo); k <= Math.min(NB - 1, Math.floor(hi)); k++) { s += W[k]; c++; } return s / c; };
  const H = new Float64Array(CAND.length); let best = 0;
  for (let i = 0; i < CAND.length; i++) { let s = 0; for (let h = 1; h <= 5; h++) s += 10 * Math.log10(band(h * CAND[i])); H[i] = s; if (s > H[best]) best = i; }
  const srt = Float64Array.from(H).sort(), med = srt[srt.length >> 1], dev = Float64Array.from(H, (x) => Math.abs(x - med)).sort(), mad = 1.4826 * dev[dev.length >> 1];
  let f = CAND[best]; if (best > 0 && best < CAND.length - 1) { const a = H[best - 1], b = H[best], c = H[best + 1], d = a - 2 * b + c; if (d < 0) f += (0.5 * (a - c)) / d / 128; }
  let line = 0; for (let k = Math.floor((f * 0.95) / DF); k <= Math.ceil((f * 1.05) / DF); k++) line = Math.max(line, W[k]);
  void mad; return { K, ke, psd, floor: fl, W, H, f, bpm: f * 60, peak: H[best] - med, z: (H[best] - med) / sigma0(ke), lineDb: 10 * Math.log10(line) };
}
export const segsAt = (tau) => Math.floor((tau * FS - NSEG) / HOP) + 1;                // whole segments inside tau seconds
export const tauOf = (K) => (NSEG + (K - 1) * HOP) / FS;
// One whole experiment: score and heart-rate error after every averaging time from 8 s to TMC.
export function curve(p, seed) {
  const rec = simulate(p, TMC, seed), segs = segments(prefilter(rec.v).y), acc = new Float64Array(NB), avg = new Float64Array(NB), z = [], err = [];
  for (let K = 1; K <= segs.length; K++) { const P = segs[K - 1]; for (let k = 0; k < NB; k++) { acc[k] += P[k]; avg[k] = acc[k] / K; } const A = analyse(avg, K); z.push(A.z); err.push(A.bpm - trueRate(rec.beats, 0, tauOf(K))); }
  return { z, err };
}

const fmtV = (u) => (u >= 995 ? L.fix(u / 1000, u >= 9950 ? 0 : 1) + ' mm/s' : u >= 9.95 ? Math.round(u) + ' µm/s' : u >= 0.995 ? L.fix(u, 1) + ' µm/s' : L.fix(u, 2) + ' µm/s');
const median = (a) => { const s = Float64Array.from(a).sort(); return s.length ? s[s.length >> 1] : NaN; };
const quant = (a, q) => { const s = Float64Array.from(a).sort(); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };

export default {
  id: 'laser', title: 'Heartbeat by laser', short: 'Laser',
  readiness: 0.9, readinessNote: 'Published on people in laboratories, and reported in 2019 from a Pentagon project at 200 m. Never shown at a collapse. HOUND has no such instrument.',
  standoff: [10, 300],
  labels: ['concept', 'live-algo'],
  labelNote: 'The instrument, the person and every recording are simulated; the amplitudes marked assumed are our own guesses. The filtering, the averaged spectrum, the heart-rate estimate and the detection score are computed in this page from the simulated recording.',
  sentences: [
    'A laser vibrometer measures how fast a surface moves from the Doppler shift of the light it reflects; skin over an artery moves a tenth of a millimetre with every heartbeat, and that has been read from 200 m.',
    'A pulse found from across the street would say a person in a gap in the rubble is alive before anyone climbs in, but only if the beam can reach skin, or something that moves with it.',
  ],
  needs: 'A clear line of sight to skin, or to a surface that moves with the person. A steady platform: here a tripod works and a hovering drone does not. Tens of seconds on one spot. Dust, smoke, heavy clothing and a person who shifts all break the reading.',
  unknown: 'Nobody has shown this through a rubble pile, and light does not pass through concrete. Whether a slab that a person lies against moves enough to measure is our speculation: the 0.03 µm used here is a guess, and published work is on skin and thin clothing only. Every amplitude and the noise floor are assumed, not measured.',
  sources: [
    { who: 'Hambling, MIT Technology Review', year: 2019, title: 'The Pentagon has a laser that can identify people from a distance—by their heartbeat', where: 'MIT Technology Review, 27 June 2019', url: 'https://www.technologyreview.com/2019/06/27/238884/the-pentagon-has-a-laser-that-can-identify-people-from-a-distanceby-their-heartbeat/', note: 'A news report of an official\'s statements, not a peer-reviewed result.' },
    { who: 'Morbiducci, Scalise, De Melis and Grigioni', year: 2007, title: 'Optical vibrocardiography: a novel tool for the optical monitoring of cardiac activity', where: 'Annals of Biomedical Engineering 35(1)', url: 'https://doi.org/10.1007/s10439-006-9202-9' },
    { who: 'Scalise and Morbiducci', year: 2008, title: 'Non-contact cardiac monitoring from carotid artery using optical vibrocardiography', where: 'Medical Engineering & Physics 30(4)', url: 'https://doi.org/10.1016/j.medengphy.2007.05.008' },
  ],
  glyph(g, s, t, c) {
    const ph = (t * 0.9) % 1, k = Math.exp(-ph * 7) + 0.6 * Math.exp(-Math.max(0, ph - 0.3) * 9) * (ph > 0.3 ? 1 : 0), x1 = s * 0.2;
    g.beginPath(); g.moveTo(-s * 0.44, 0); g.lineTo(x1 - 3, 0); g.stroke(); g.fillRect(-s * 0.44, -3, 5, 6);
    g.fillStyle = c.person; g.beginPath(); g.arc(x1, 0, 2.6 + 1.6 * k, 0, TAU); g.fill();
    g.strokeStyle = c.person; g.globalAlpha = 0.5 * k; g.beginPath(); g.arc(x1, 0, 5 + 5 * (1 - k), 0, TAU); g.stroke(); g.globalAlpha = 1;
  },

  create({ stage, controls, readout }) {
    L.layout(stage, { cols: 'minmax(0, 1.22fr) minmax(0, 1fr)', rows: 'minmax(0, 1fr) minmax(0, 1.08fr)', areas: ['hero hero', 'sig conv'] });
    const fHero = L.figure({ area: 'hero', title: 'A laser spot on the skin moves with the pulse' });
    const fSig = L.figure({ area: 'sig', title: 'The recording and its averaged spectrum' });
    const fConv = L.figure({ area: 'conv', title: 'Detection score against averaging time' });
    stage.append(fHero.el, fSig.el, fConv.el);

    const P = { range: 200, surf: 'neck', T: 30, vib: 2, hr: 72, seed: 4 };
    const NTRIAL = 40;
    let rec = null, segs = null, A = null, own = null, tNow = 0, phase = 'build', buildDur = 1.6, lastK = -1, clipped = 0;
    let trials = [], mc = null, gen = 0, wall = 0;
    const phys = () => ({ range: P.range, surf: P.surf, vib: P.vib, hr: P.hr });

    function newRecording(animate, dur = 1.6) {
      rec = simulate(phys(), TREC, 1000 + P.seed); const pf = prefilter(rec.v); clipped = pf.clipped; segs = segments(pf.y);
      own = curve(phys(), 1000 + P.seed); lastK = -1; A = null;
      if (animate && !L.reduced()) { tNow = 0; phase = 'build'; buildDur = dur; } else { tNow = P.T; phase = 'live'; }
      analyseNow(); report();
    }
    function resetTrials() { gen++; trials = [own]; mc = null; summarise(); }
    function runTrial() { trials.push(curve(phys(), 5000 + 31 * gen + trials.length)); summarise(); }
    function summarise() {
      const nK = own.z.length, med = [], lo = [], hi = [], er = [];
      for (let k = 0; k < nK; k++) { const zs = trials.map((t) => t.z[k]); med.push(median(zs)); lo.push(quant(zs, 0.25)); hi.push(quant(zs, 0.75)); er.push(Math.sqrt(trials.reduce((s, t) => s + t.err[k] ** 2, 0) / trials.length)); }
      // square-root law: score = c * sqrt(independent averages); c by least squares in the log. Also the free exponent, to check the law.
      let sl = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0; for (let k = 0; k < nK; k++) { if (!(med[k] > 0)) continue; const x = Math.log(kEff(k + 1)), y = Math.log(med[k]); sl += y - 0.5 * x; sx += x; sy += y; sxx += x * x; sxy += x * y; m++; }
      const c = m ? Math.exp(sl / m) : NaN, expo = m > 2 ? (m * sxy - sx * sy) / (m * sxx - sx * sx) : NaN;
      let tDet = NaN; for (let k = 0; k < nK; k++) if (med[k] >= ZTHR) { tDet = tauOf(k + 1); break; }
      mc = { med, lo, hi, er, c, expo, tDet, n: trials.length };
    }
    // the window analysed now: the last T seconds of the recording (or all of it so far)
    function windowNow() { const t1 = Math.min(tNow, TREC), k1 = Math.floor((t1 * FS - NSEG) / HOP), k0 = Math.max(0, Math.ceil(((t1 - P.T) * FS) / HOP - 1e-9)); return { k0, k1, ta: (k0 * HOP) / FS, tb: (k1 * HOP + NSEG) / FS }; }
    function analyseNow() {
      const { k0, k1, ta, tb } = windowNow(); if (k1 === lastK && A) return false; lastK = k1;
      if (k1 < k0 || k1 < 0) { A = null; return true; }
      const K = k1 - k0 + 1, avg = new Float64Array(NB); for (let s = k0; s <= k1; s++) { const Pk = segs[s]; for (let k = 0; k < NB; k++) avg[k] += Pk[k] / K; }
      A = analyse(avg, K); A.last = segs[k1]; A.truth = trueRate(rec.beats, ta, tb); A.err = A.bpm - A.truth; A.tau = tb - ta; A.found = A.z >= ZTHR; return true;
    }

    // ---------- readouts ----------
    const sHr = L.stat('estimated beats a minute'), sErr = L.stat('error against the truth', { unit: 'beats/min' }), sLine = L.stat('heartbeat line above the floor', { unit: 'dB' }), sRaw = L.stat('heartbeat against all else, raw', { unit: 'dB', hint: 'Power of the true heartbeat velocity over the power of everything else in the recording. Known only because this is a simulation.' }), sT = L.stat('averaging for a confident detection', { unit: 's' });
    readout.append(L.h('h4', null, 'Measured against the simulated truth'), sHr.el, sErr.el, sLine.el, sRaw.el, sT.el,
      L.h('p.note.quiet.wide', null, 'An experiment on a simulated person, not a medical reading. A rate is shown only to compare it with the truth.'));
    function report() {
      const S = SURF[P.surf], share = rec.rms.card / Math.hypot(rec.rms.card, rec.rms.other);
      fHero.setTitle('At ' + P.range + ' m, aimed at ' + S.at + ', the heartbeat is ' + (share >= 0.1 ? Math.round(share * 100) + ' %' : share >= 0.001 ? L.fix(share * 100, share >= 0.01 ? 1 : 2) + ' %' : 'under 0.1 %') + ' of the motion the beam records');
      fHero.setNote('Side view, simulated. Drag the tripod to change the range; click a ring to aim. The instrument is a concept: HOUND has no laser vibrometer. Body motion is drawn larger than life.');
      sRaw.set(L.fix(20 * Math.log10(rec.rms.card / rec.rms.other), 0)); sRaw.tone(rec.rms.card > rec.rms.other ? 'ok' : null);
      if (!A) { sHr.set('–', 'estimated beats a minute'); sErr.set('–'); sLine.set('–'); sHr.tone(null); sErr.tone(null); sLine.tone(null); fSig.setTitle('Collecting the first 8 seconds…'); }
      else {
        const bad = Math.abs(A.err) > 5;
        sHr.set(L.fix(A.bpm, 1), 'estimated beats a minute (truth ' + L.fix(A.truth, 1) + ')' + (A.found ? '' : ', below the threshold')); sHr.tone(A.found ? (bad ? 'danger' : 'ok') : 'warn');
        sErr.set((A.err >= 0 ? '+' : '−') + L.fix(Math.abs(A.err), 1)); sErr.tone(Math.abs(A.err) <= 2 ? 'ok' : bad ? 'danger' : 'warn');
        sLine.set(L.fix(A.lineDb, 1), 'heartbeat line above the floor; score ' + L.fix(A.z, 1) + ', threshold ' + ZTHR); sLine.tone(A.found ? 'ok' : 'warn');
        const tt = Math.round(A.tau) + ' s';
        fSig.setTitle(A.found ? (bad ? 'After ' + tt + ' a line stands ' + L.fix(A.lineDb, 0) + ' dB above the floor, but it is not the heartbeat: ' + L.fix(A.bpm, 0) + ' a minute against a true ' + L.fix(A.truth, 0)
          : 'After ' + tt + ' of averaging the heartbeat stands ' + L.fix(A.lineDb, 0) + ' dB above the floor: ' + L.fix(A.bpm, 1) + ' beats a minute against a true ' + L.fix(A.truth, 1))
          : 'After ' + tt + ' nothing stands clear of the floor: no heartbeat can be claimed (score ' + L.fix(A.z, 1) + ', threshold ' + ZTHR + ')');
      }
      fSig.setNote('Above: the last 8 s as recorded. Below: Welch average of 8 s Hann segments after a 0.5 Hz high-pass. Shot-noise floor ' + (rec.n0 >= 10 ? L.fix(rec.n0, 0) : L.fix(rec.n0, 1)) + ' µm/s per root hertz here (0.3 at 10 m on white, assumed; its power grows as range squared). ' + L.pct(rec.dropFrac, 1) + ' % of samples are speckle dropouts.');
      if (mc) {
        const ok = Number.isFinite(mc.tDet);
        sT.set(ok ? L.fix(mc.tDet, 0) : '> ' + TMC, ok ? 'averaging for a confident detection (median of ' + mc.n + ' recordings)' : 'no confident detection within a minute (' + mc.n + ' recordings)'); sT.tone(ok ? (mc.tDet <= 30 ? 'ok' : 'warn') : 'danger');
        const e = mc.er[Math.min(mc.er.length - 1, Math.max(0, segsAt(P.T) - 1))];
        fConv.setTitle((ok ? 'Across ' + mc.n + ' simulated recordings the score crosses the threshold after ' + L.fix(mc.tDet, 0) + ' s' : 'Across ' + mc.n + ' simulated recordings the score never reaches the threshold within a minute')
          + (Number.isFinite(mc.expo) ? '; it grows as averages to the power ' + L.fix(mc.expo, 2) : '') + '. Rate error after ' + P.T + ' s: ' + L.fix(e, 1) + ' beats a minute');
        fConv.setNote('Each recording is processed after every 2 s more. Averaging does not lower the floor; it steadies it, so the score should grow as the square root of the number of independent averages (dashed, one fitted constant; exponent 0.5).');
      }
    }

    // ---------- hero: the scene ----------
    let geo = null, dragging = false, hover = null; const dustR = L.rng(77), dust = Array.from({ length: 34 }, () => ({ x: dustR(), y: dustR(), s: 0.4 + dustR(), p: dustR() * TAU }));
    const TARGETS = { neck: [2.235, 0.805], chest: [1.93, 0.52], hand: [1.34, 0.555], slab: [2.665, 1.1] };
    const LABEL_AT = { neck: [-70, -78], chest: [-120, -40], hand: [-96, 44], slab: [38, -30] };
    const spk = L.raster(44, 44), waves = (() => { const R = L.rng(9); return Array.from({ length: 14 }, () => { const a = R() * TAU, k = 0.25 + 0.75 * Math.sqrt(R()); return { kx: Math.cos(a) * k * 0.62, ky: Math.sin(a) * k * 0.62, ph: R() * TAU }; }); })(), spkR = L.rng(21);
    function paintSpeckle(dt) {
      const T = L.tokens().rgb, sd = rec ? Math.sqrt((2 * dt) / Math.max(0.02, rec.tauC)) : 0; for (const w of waves) w.ph += sd * spkR.n();
      const d = spk.data; for (let j = 0, p = 0; j < 44; j++) for (let i = 0; i < 44; i++, p += 4) { let re = 0, im = 0; for (const w of waves) { const a = w.kx * i + w.ky * j + w.ph; re += Math.cos(a); im += Math.sin(a); } const I = clamp((re * re + im * im) / (waves.length * 3.2)), r2 = (i - 21.5) ** 2 + (j - 21.5) ** 2;
        d[p] = T.sim[0] * I + 8; d[p + 1] = T.sim[1] * I + 9; d[p + 2] = T.sim[2] * I + 12; d[p + 3] = r2 > 21.5 * 21.5 ? 0 : 255; }
      spk.commit();
    }
    let chunks = null, chunkKey = '';
    fHero.draw = (g, w, hh) => {
      if (!rec) return; const T = L.tokens(), S = SURF[P.surf];
      const G = hh - 44, sc = clamp(Math.min((G - 16) / 1.95, (G - 108) / 1.52), 40, 118), ox = w - 3.45 * sc, xMin = 52, xMax = Math.max(xMin + 60, Math.min(w * 0.4, ox - 5.2 * sc));
      const xT = xMax - (xMax - xMin) * (Math.log(P.range / 10) / Math.log(30)), m = (x, y) => [ox + x * sc, G - y * sc];
      const ti = clamp(Math.floor(tNow * FS), 0, rec.n - 1), br = Math.sin(rec.bph[ti]);
      let lastBeat = -9; for (const b of rec.beats) { if (b > tNow) break; lastBeat = b; } const pulse = Math.exp(-Math.max(0, tNow - lastBeat) * 6);
      geo = { xT, xMin, xMax, G, sc, ox, hit: {} };
      // ground
      g.fillStyle = T.bg1; g.fillRect(0, G, w, hh - G); g.strokeStyle = T.line3; g.lineWidth = 1; g.beginPath(); g.moveTo(0, G + 0.5); g.lineTo(w, G + 0.5); g.stroke();
      const lens = [xT + 0.3 * sc, G - 1.42 * sc], tg = m(...TARGETS[P.surf]); if (P.surf === 'chest') { tg[0] -= 0.8 * br; tg[1] -= 1.6 * br; }
      const yBeam = (x) => lens[1] + ((tg[1] - lens[1]) * (x - lens[0])) / (tg[0] - lens[0]);
      // rubble across the gap (seeded; kept under the beam)
      const key = w + 'x' + hh; if (key !== chunkKey) { chunkKey = key; const R = L.rng(12); chunks = Array.from({ length: Math.round(w / 13) }, () => ({ u: R(), s: 0.25 + 0.75 * R(), rot: R.range(-0.5, 0.5), back: R() < 0.45, pts: Array.from({ length: 5 }, (_, i) => { const an = (i / 5) * TAU + R.range(-0.25, 0.25), rr = 0.6 + 0.4 * R(); return [Math.cos(an) * rr, Math.sin(an) * rr * 0.72]; }), bar: R() < 0.16 })).sort((a, b) => b.back - a.back); }
      const x0r = xMin + 0.75 * sc, x1r = ox - 0.3 * sc;
      for (const c of chunks) { const x = x0r + c.u * (x1r - x0r); if (Math.abs(x - xT) < 0.55 * sc) continue; const lowBeam = Math.min(yBeam(x), m(0, 1.1)[1]); const s = Math.min(0.2 * sc * c.s * (c.back ? 1.5 : 1), (G - lowBeam) * 0.36); if (s < 3) continue;
        g.save(); g.translate(x, G - s * 0.5); g.rotate(c.rot); g.beginPath(); c.pts.forEach((p, i) => (i ? g.lineTo(p[0] * s, p[1] * s) : g.moveTo(p[0] * s, p[1] * s))); g.closePath(); g.fillStyle = c.back ? T.bg2 : T.bg3; g.fill(); g.strokeStyle = c.back ? T.line2 : T.line3; g.stroke();
        if (c.bar) { g.strokeStyle = L.rgba('text3', 0.7); g.beginPath(); g.moveTo(0, -s * 0.4); g.quadraticCurveTo(s * 0.8, -s * 1.6, s * 1.5, -s * 0.9); g.stroke(); } g.restore(); }
      // the collapsed structure, right: a pillar behind, a leaning slab, the floors that came down on it
      const poly = (pts, fill, stroke) => { g.beginPath(); pts.forEach((p, i) => { const q = m(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); } };
      const hatch = (pts) => { g.save(); g.beginPath(); pts.forEach((p, i) => { const q = m(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); g.clip(); g.strokeStyle = L.rgba('text3', 0.22); g.lineWidth = 1; g.beginPath(); for (let x = ox - sc; x < w + 2 * sc; x += 6) { g.moveTo(x, G); g.lineTo(x + 2 * sc, G - 2 * sc); } g.stroke(); g.restore(); };
      poly([[-0.34, 0], [-0.34, 1.4], [-0.1, 1.4], [-0.1, 0]], T.bg1, T.line2);                                       // pillar, behind the opening
      poly([[0.1, 0], [3.45, 0], [3.45, 1.3], [0.1, 1.3]], L.rgba('bg1', 0.9), null);                                   // the dark of the void
      const back = [[1.78, 0], [2.86, 1.3], [3.06, 1.3], [1.98, 0]], roof = [[-0.42, 1.42], [3.2, 1.24], [3.2, 1.44], [-0.42, 1.63]], roof2 = [[-0.1, 1.68], [3.35, 1.5], [3.35, 1.66], [-0.1, 1.85]];
      poly([[1.98, 0], [3.06, 1.3], [3.45, 1.3], [3.45, 0]], T.bg2, T.line2);                                            // debris packed behind the leaning slab
      poly(back, T.bg3, T.line3); hatch(back); poly(roof, T.bg3, T.line3); hatch(roof); poly(roof2, T.bg2, T.line3);
      poly([[0.5, 1.86], [0.9, 1.93], [1.6, 1.88], [1.5, 1.8]], T.bg2, T.line2); poly([[2.2, 1.78], [2.9, 1.84], [3.2, 1.7]], T.bg2, T.line2);
      g.strokeStyle = L.rgba('text3', 0.8); g.lineWidth = 1; g.beginPath(); let q = m(-0.42, 1.5); g.moveTo(q[0], q[1]); g.bezierCurveTo(q[0] - 0.22 * sc, q[1] - 0.02 * sc, q[0] - 0.3 * sc, q[1] + 0.2 * sc, q[0] - 0.2 * sc, q[1] + 0.34 * sc); q = m(-0.42, 1.58); g.moveTo(q[0], q[1]); g.bezierCurveTo(q[0] - 0.3 * sc, q[1], q[0] - 0.42 * sc, q[1] + 0.1 * sc, q[0] - 0.46 * sc, q[1] + 0.3 * sc); g.stroke();
      // the person (truth, simulated): half sitting against the leaning slab
      const limb = (pts, wd) => { g.lineWidth = wd * sc; g.beginPath(); pts.forEach((p, i) => { const z = m(p[0], p[1]); i ? g.lineTo(z[0], z[1]) : g.moveTo(z[0], z[1]); }); g.stroke(); };
      g.save(); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = L.rgba('person', 0.5);
      limb([[1.74, 0.16], [1.22, 0.5], [0.8, 0.09]], 0.15); limb([[0.8, 0.07], [0.66, 0.16]], 0.1);
      g.strokeStyle = L.rgba('person', 0.72); limb([[1.76, 0.17], [2.17, 0.62 + 0.012 * br]], 0.27 + 0.02 * br);
      limb([[2.2, 0.72], [2.3, 0.84]], 0.11); const hd = m(2.36, 0.95); g.fillStyle = L.rgba('person', 0.72); g.beginPath(); g.arc(hd[0], hd[1], 0.115 * sc, 0, TAU); g.fill();
      g.strokeStyle = L.rgba('person', 0.95); limb([[2.12, 0.66], [1.74, 0.4], [1.36, 0.5]], 0.085); g.restore();
      // the beam: infrared, invisible to the eye, drawn in the concept colour. A break mark where the gap is not to scale.
      const xb = (lens[0] + ox - 0.5 * sc) / 2, cut = (x) => [x, yBeam(x)];
      g.save(); g.lineCap = 'butt'; for (const [wd, al] of [[5, 0.12], [1.25, 0.95]]) { g.strokeStyle = L.rgba('sim', al); g.lineWidth = wd; g.beginPath(); g.moveTo(lens[0], lens[1]); g.lineTo(...cut(xb - 5)); g.moveTo(...cut(xb + 5)); g.lineTo(tg[0], tg[1]); g.stroke(); } g.restore();
      for (const d of dust) { const x = x0r + ((d.x + (L.reduced() ? 0 : wall * 0.006 * d.s)) % 1) * (ox + 0.1 * sc - x0r), y = G - (0.08 + 1.6 * d.y) * sc + 3 * Math.sin(wall * 0.4 * d.s + d.p), near = Math.abs(y - yBeam(x)) < 2.5 && x > lens[0] && x < tg[0]; g.fillStyle = near ? L.rgba('sim', 0.95) : L.rgba('text3', 0.28); g.beginPath(); g.arc(x, y, near ? 1.7 : 1, 0, TAU); g.fill(); }
      g.strokeStyle = T.text3; g.lineWidth = 1; g.beginPath(); for (const dx of [-5, 5]) { g.moveTo(xb + dx - 4, G + 8); g.lineTo(xb + dx + 4, G - 8); g.moveTo(xb + dx - 4, yBeam(xb) + 8); g.lineTo(xb + dx + 4, yBeam(xb) - 8); } g.stroke();
      g.fillStyle = T.bg0; g.fillRect(xb - 4, G - 1, 8, 3);
      // tripod and instrument
      const hub = [xT, G - 1.2 * sc]; g.strokeStyle = T.text2; g.lineWidth = 1.5; g.lineCap = 'round'; g.beginPath(); for (const dx of [-0.36, 0.06, 0.33]) { g.moveTo(hub[0], hub[1]); g.lineTo(xT + dx * sc, G); } g.moveTo(hub[0], hub[1]); g.lineTo(xT, G - 1.34 * sc); g.stroke(); g.lineCap = 'butt';
      g.fillStyle = T.bg4; g.strokeStyle = T.text2; g.lineWidth = 1; const bw = 0.46 * sc, bh = 0.17 * sc, bx = xT - 0.2 * sc, by = G - 1.42 * sc - bh / 2; g.beginPath(); g.rect(Math.round(bx) + 0.5, Math.round(by) + 0.5, bw, bh); g.fill(); g.stroke();
      g.beginPath(); g.rect(Math.round(bx + bw) + 0.5, Math.round(by + bh * 0.2) + 0.5, 0.06 * sc, bh * 0.6); g.fill(); g.stroke(); g.beginPath(); g.rect(Math.round(bx + bw * 0.25) + 0.5, Math.round(by - bh * 0.42) + 0.5, bw * 0.45, bh * 0.4); g.stroke();
      g.fillStyle = T.sim; g.beginPath(); g.arc(lens[0], lens[1], 2, 0, TAU); g.fill();
      if (P.vib > 4) { const k = clamp(Math.log10(P.vib / 4) / 1.9); g.strokeStyle = L.rgba('warn', 0.3 + 0.5 * k); for (const sgn of [-1, 1]) for (let i = 1; i <= 1 + Math.round(2 * k); i++) { g.beginPath(); g.arc(xT + 0.03 * sc, G - 1.42 * sc, 0.3 * sc + i * 5, sgn > 0 ? -0.5 : Math.PI - 0.5, sgn > 0 ? 0.5 : Math.PI + 0.5); g.stroke(); } }
      L.callout(g, 'laser vibrometer, 1550 nm infrared (concept)', bx + bw * 0.6, by + bh, xT + 0.35 * sc + 10, G - 0.8 * sc, { color: 'sim', dot: false });
      g.strokeStyle = T.accent; g.fillStyle = T.accent; g.lineWidth = dragging ? 2 : 1.5; g.beginPath(); g.moveTo(xT - 15, G + 10); g.lineTo(xT + 15, G + 10); g.moveTo(xT - 10, G + 6); g.lineTo(xT - 15, G + 10); g.lineTo(xT - 10, G + 14); g.moveTo(xT + 10, G + 6); g.lineTo(xT + 15, G + 10); g.lineTo(xT + 10, G + 14); g.stroke();
      // range, with the break
      const yd = G + 27; g.strokeStyle = T.text3; g.lineWidth = 1; g.beginPath(); g.moveTo(xT + 0.5, yd - 4); g.lineTo(xT + 0.5, yd + 4); g.moveTo(xT, yd + 0.5); g.lineTo(xb - 34, yd + 0.5); g.moveTo(xb + 34, yd + 0.5); g.lineTo(tg[0], yd + 0.5); g.moveTo(Math.round(tg[0]) + 0.5, yd - 4); g.lineTo(Math.round(tg[0]) + 0.5, yd + 4); g.stroke();
      L.text(g, P.range + ' m', xb, yd + 4, { color: 'text', size: 12, align: 'center', mono: true });
      L.text(g, 'drag the tripod', xT + 22, G + 14, { color: 'accent2', size: 11 });
      L.scaleBar(g, w - 14 - sc, yd + 6, sc, { metres: 1 });
      // aim points: click to aim
      for (const [id, pt] of Object.entries(TARGETS)) { const z = m(...pt); if (id === 'chest') { z[0] -= 0.8 * br; z[1] -= 1.6 * br; } geo.hit[id] = z; const on = id === P.surf, hv = hover === id;
        if (!on) { g.strokeStyle = L.rgba('accent', hv ? 1 : 0.75); g.lineWidth = hv ? 2 : 1.25; g.beginPath(); g.arc(z[0], z[1], 5, 0, TAU); g.stroke(); const la = LABEL_AT[id]; if (hv) L.callout(g, 'aim at ' + SURF[id].name, z[0], z[1], z[0] + la[0] * 0.5, z[1] + la[1] * 0.5, { color: 'accent2', dot: false }); } }
      // the spot, its speckle, and the truth marker
      g.fillStyle = L.rgba('sim', 0.95); g.beginPath(); g.arc(tg[0], tg[1], 2.6, 0, TAU); g.fill(); g.strokeStyle = L.rgba('sim', 0.5); g.lineWidth = 1; g.beginPath(); g.arc(tg[0], tg[1], 6.5, 0, TAU); g.stroke();
      const nk = m(2.27, 0.78); g.strokeStyle = L.rgba('text', 0.25 + 0.75 * pulse); g.lineWidth = 1.5; g.beginPath(); g.arc(nk[0], nk[1], 9 + 7 * (1 - pulse), 0, TAU); g.stroke();
      const lp = m(3.42, 0.62); L.callout(g, 'truth (simulated): ' + P.hr + ' beats a minute', nk[0] + 6, nk[1] + 6, Math.min(w - 196, lp[0] - 170), G - 0.16 * sc, { color: 'person', dot: false });
      // inset: the speckle pattern the receiver sees, and how much light is coming back now
      const ir = clamp(hh * 0.105, 26, 40), icx = clamp(ox - 1.5 * sc, w * 0.45, w - 420), icy = ir + 6;
      g.strokeStyle = L.rgba('sim', 0.5); g.lineWidth = 1; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(tg[0], tg[1] - 7); const an = Math.atan2(icy - tg[1], icx - tg[0]); g.lineTo(icx - Math.cos(an) * (ir + 2), icy - Math.sin(an) * (ir + 2)); g.stroke(); g.setLineDash([]);
      g.imageSmoothingEnabled = true; g.drawImage(spk.canvas, icx - ir, icy - ir, 2 * ir, 2 * ir); g.strokeStyle = T.line3; g.beginPath(); g.arc(icx, icy, ir, 0, TAU); g.stroke();
      const tx = icx + ir + 12, I = rec.ret[ti], dr = rec.drop[ti];
      L.text(g, 'Speckle at the receiver', tx, icy - ir + 11, { color: 'text', size: 11.5 });
      L.text(g, 'spot ' + L.fix(rec.spot, 0) + ' mm wide; pattern holds ' + (rec.tauC >= 10 ? Math.round(rec.tauC) : rec.tauC >= 1 ? L.fix(rec.tauC, 1) : L.fix(rec.tauC, 2)) + ' s', tx, icy - ir + 27, { color: 'text3', size: 11 });
      L.text(g, 'light returned now', tx, icy - ir + 43, { color: 'text3', size: 11 }); g.fillStyle = T.bg3; g.fillRect(tx + 104, icy - ir + 36, 90, 6); g.fillStyle = dr ? T.warn : T.sim; g.fillRect(tx + 104, icy - ir + 36, 90 * clamp(I / 3), 6);
      if (dr) L.text(g, 'dropout', tx + 200, icy - ir + 43, { color: 'warn', size: 11 });
      // what the beam records, by size (log scale)
      const rows = [['breathing', rec.rms.breath, 'text3'], ['sway' + (S.tremor ? ' and tremor' : P.surf === 'slab' ? ' of the site' : ' of the body'), rec.rms.sway, 'text3'], ['platform vibration', rec.rms.plat, 'text3'], ['speckle and shot noise', rec.rms.noise, 'text3'], ['heartbeat', rec.rms.card, 'person']];
      const bx0 = 14, lab = 138, bl = clamp(w * 0.13, 90, 170), by0 = 22, X = (u) => bl * clamp((Math.log10(Math.max(u, 0.1)) + 1) / 5.2);
      L.text(g, 'Velocity at the spot, rms (log scale; amplitudes assumed)', bx0, 10, { color: 'text2', size: 11 });
      rows.forEach((r, i) => { const y = by0 + i * 16; L.text(g, r[0], bx0, y + 8, { color: r[2] === 'person' ? 'text' : 'text3', size: 11 }); g.fillStyle = T.bg2; g.fillRect(bx0 + lab, y + 1, bl, 7); g.fillStyle = r[2] === 'person' ? T.person : L.rgba('text3', 0.85); g.fillRect(bx0 + lab, y + 1, Math.max(1, X(r[1])), 7); L.text(g, fmtV(r[1]), bx0 + lab + bl + 8, y + 8, { color: r[2] === 'person' ? 'text' : 'text2', size: 10.5, mono: true, weight: 400 }); });
    };
    fHero.onPointer((ev) => {
      if (!geo) return; const near = Math.abs(ev.x - geo.xT) < 0.5 * geo.sc && ev.y > geo.G - 1.7 * geo.sc; let h = null;
      for (const [id, z] of Object.entries(geo.hit)) if (id !== P.surf && Math.hypot(ev.x - z[0], ev.y - z[1]) < 13) h = id;
      if (ev.type === 'down') { if (h) { sSurf.set(h, true); return; } if (near) dragging = true; }
      if (ev.type === 'up' || ev.type === 'leave') dragging = false;
      if (dragging && ev.type === 'drag') { const f = clamp((geo.xMax - ev.x) / (geo.xMax - geo.xMin)), r = Math.round((10 * 30 ** f) / 5) * 5; if (r !== P.range) { P.range = clamp(r, 10, 300); sRange.set(P.range); changed(); } }
      if (h !== hover) { hover = h; if (L.reduced()) fHero.redraw(); }
      fHero.canvas.style.cursor = dragging ? 'grabbing' : h ? 'pointer' : near ? 'grab' : 'default';
    });

    // ---------- the recording and its spectrum ----------
    fSig.draw = (g, w, hh) => {
      if (!rec) return; const T = L.tokens(), hTop = Math.round(clamp(hh * 0.3, 70, 120));
      // raw trace: the last 8 s
      const t1 = Math.min(tNow, TREC), t0 = t1 - 8, i0 = Math.round(t0 * FS), n = 8 * FS; let mx = 1e-9; for (let i = Math.max(0, i0); i < Math.min(rec.n, i0 + n); i++) mx = Math.max(mx, Math.abs(rec.v[i]));
      const unit = mx >= 1500 ? 1000 : 1, top = mx * 1.08 / unit, B1 = { x: 52, y: 14, w: w - 52 - 12, h: hTop - 14 - 20 };
      const P1 = L.plot(g, B1, { xd: [t0, t1], yd: [-top, top], yticks: [-top, 0, top], yfmt: (v) => (v === 0 ? '0' : (v > 0 ? '+' : '−') + (+Math.abs(v).toPrecision(2))), xticks: L.niceTicks(Math.ceil(t0), Math.floor(t1), 8).filter((v) => v >= t0 && v >= 0), xfmt: (v) => v + ' s', ylabel: 'velocity at the spot, ' + (unit === 1000 ? 'mm/s' : 'µm/s') });
      const xs = [], ys = [], yc = []; for (let i = Math.max(0, i0); i < Math.min(rec.n, i0 + n + 1) && i / FS <= t1; i++) { xs.push(i / FS); ys.push(rec.v[i] / unit); yc.push(rec.card[i] / unit); }
      g.fillStyle = L.rgba('warn', 0.5); for (let i = Math.max(0, i0), k = 0; k < xs.length; i++, k++) if (rec.drop[i]) g.fillRect(P1.X(xs[k]) - 0.5, B1.y, 1.5, 4);
      L.trace(g, P1, xs, ys, { color: 'text2', width: 1 }); L.trace(g, P1, xs, yc, { color: 'ok', width: 1.5 });
      L.text(g, 'recorded', B1.x + B1.w, B1.y - 3, { color: 'text2', size: 10.5, align: 'right' }); L.text(g, 'the heartbeat alone, truth (simulated)', B1.x + B1.w - 58, B1.y - 3, { color: 'ok', size: 10.5, align: 'right' });
      if (rec.dropFrac > 0.002 && B1.w > 420) L.text(g, 'amber ticks: speckle dropouts', B1.x + B1.w - 262, B1.y - 3, { color: 'warn', size: 10.5, align: 'right' });
      // spectrum
      const B2 = { x: 52, y: hTop + 18, w: w - 52 - 12, h: hh - hTop - 18 - 34 }, FX = [0.4, 8];
      if (!A) { L.plot(g, B2, { xd: FX, yd: [0.1, 1000], ylog: true, xlabel: 'frequency, Hz', ylabel: 'velocity, µm/s per root hertz' }); L.text(g, 'One 8 s segment is needed before there is a spectrum', B2.x + B2.w / 2, B2.y + B2.h / 2, { color: 'text3', size: 12, align: 'center' }); return; }
      const k0 = Math.round(0.55 / DF), k1 = Math.round(FX[1] / DF), fs = [], av = [], ls = [], fl = []; let lo = Infinity, hi = 0;
      for (let k = k0; k <= k1; k++) { fs.push(k * DF); const a = Math.sqrt(A.psd[k]), f = Math.sqrt(A.floor[k]); av.push(a); ls.push(Math.sqrt(A.last[k])); fl.push(f); if (a > hi) hi = a; if (f < lo) lo = f; }
      const yd = [10 ** Math.floor(Math.log10(lo * 0.5)), 10 ** Math.ceil(Math.log10(hi * 1.6))], dec = Math.log10(yd[1] / yd[0]);
      const P2 = L.plot(g, B2, { xd: FX, yd, ylog: true, xticks: [0.5, 1, 2, 3, 4, 5, 6, 7, 8], xlabel: 'frequency, Hz (times 60 for beats a minute)', ylabel: 'velocity, µm/s per root hertz', yfmt: (v) => (v >= 1 ? String(v) : v.toPrecision(1)), yticks: dec > 6 ? L.logTicks(yd[0], yd[1]).filter((_, i) => i % 2 === 0) : undefined });
      const ft = A.truth / 60; for (let h = 1; h * ft < FX[1]; h++) L.rule(g, P2, { x: h * ft, color: 'ok', label: h === 1 ? 'truth ' + L.fix(A.truth, 1) : h === 2 ? 'its harmonics' : '', side: 'right' });
      L.trace(g, P2, fs, ls, { color: 'text3', width: 1, alpha: 0.55 }); L.trace(g, P2, fs, fl, { color: 'text2', width: 1.25, dash: [5, 3] }); L.trace(g, P2, fs, av, { color: 'accent', width: 1.75 });
      const ex = P2.X(A.f), ey = P2.Y(Math.sqrt(A.psd[Math.round(A.f / DF)])), col = A.found ? 'accent' : 'warn';
      g.fillStyle = T[col]; g.beginPath(); g.moveTo(ex, B2.y + B2.h + 1); g.lineTo(ex - 5, B2.y + B2.h + 9); g.lineTo(ex + 5, B2.y + B2.h + 9); g.fill();
      L.callout(g, (A.found ? 'estimate ' : 'best guess ') + L.fix(A.bpm, 1), ex, ey, ex + (ex > B2.x + B2.w * 0.55 ? -34 : 34), Math.max(B2.y + 26, ey - 20), { color: A.found ? 'accent2' : 'warn' });
      const xe = B2.x + B2.w - 6, ie = fs.length - 1; L.text(g, 'average of ' + A.K + ' segment' + (A.K > 1 ? 's' : ''), xe, P2.Y(av[ie]) - 16, { color: 'accent2', size: 10.5, align: 'right', halo: true });
      L.text(g, 'estimated floor', xe - 150, P2.Y(fl[ie - 40]) + 14, { color: 'text2', size: 10.5, align: 'right', halo: true }); L.text(g, 'one segment', xe - 60, Math.min(B2.y + B2.h - 4, P2.Y(fl[ie]) + 26), { color: 'text3', size: 10.5, align: 'right', halo: true });
    };

    // ---------- score and error against averaging time ----------
    fConv.draw = (g, w, hh) => {
      if (!mc || !own) return; const T = L.tokens(), nK = own.z.length, taus = Array.from({ length: nK }, (_, k) => tauOf(k + 1)), XT = [8, 12, 20, 30, 45, 60];
      const h1 = Math.round((hh - 40) * 0.56), B1 = { x: 52, y: 16, w: w - 52 - 14, h: h1 - 16 }, B2 = { x: 52, y: h1 + 28, w: w - 52 - 14, h: hh - h1 - 28 - 34 };
      const shown = phase === 'build' ? Math.max(0, segsAt(tNow)) : nK, all = [...mc.hi, ...mc.lo, ...own.z, ZTHR].filter((v) => v > 0);
      const zd = [Math.min(1, 10 ** Math.floor(Math.log10(Math.min(...all)))), Math.max(100, 10 ** Math.ceil(Math.log10(Math.max(...all) * 1.2)))];
      const P1 = L.plot(g, B1, { xd: [7.4, 62], yd: zd, xlog: true, ylog: true, xticks: XT, xfmt: () => '', ylabel: 'detection score (robust standard deviations)', yfmt: (v) => (v >= 1 ? String(v) : v.toPrecision(1)) });
      g.save(); g.beginPath(); g.rect(B1.x, B1.y, B1.w, B1.h); g.clip(); g.fillStyle = L.rgba('accent', 0.13); g.beginPath(); taus.forEach((t, k) => (k ? g.lineTo(P1.X(t), P1.Y(Math.max(mc.hi[k], zd[0]))) : g.moveTo(P1.X(t), P1.Y(Math.max(mc.hi[k], zd[0]))))); for (let k = nK - 1; k >= 0; k--) g.lineTo(P1.X(taus[k]), P1.Y(Math.max(mc.lo[k], zd[0]))); g.closePath(); g.fill(); g.restore();
      L.rule(g, P1, { y: ZTHR, color: 'warn', label: 'threshold ' + ZTHR });
      if (Number.isFinite(mc.c)) { const law = taus.map((_, k) => mc.c * Math.sqrt(kEff(k + 1))); L.trace(g, P1, taus, law, { color: 'text2', width: 1.25, dash: [5, 3] }); const kk = Math.round(nK * 0.42); L.callout(g, 'square-root law', P1.X(taus[kk]), P1.Y(law[kk]), P1.X(taus[kk]) + 26, clamp(P1.Y(law[kk]) + 30, B1.y + 12, B1.y + B1.h - 8), { color: 'text2', dot: false }); }
      L.trace(g, P1, taus, mc.med.map((v) => Math.max(v, zd[0])), { color: 'accent', width: 2 });
      L.dots(g, P1, taus.slice(0, shown), own.z.slice(0, shown).map((v) => Math.max(v, zd[0])), { color: 'text', r: 2, alpha: 0.9 });
      L.text(g, 'median of ' + mc.n + ' recordings, middle half shaded', B1.x + 8, B1.y + 12, { color: 'accent2', size: 10.5, halo: true }); L.text(g, 'white dots: the recording on the left', B1.x + 8, B1.y + 26, { color: 'text', size: 10.5, halo: true });
      L.rule(g, P1, { x: clamp(P.T, 8, 60), color: 'text3', dash: [2, 3] });
      const ed = [0.05, Math.max(10, 10 ** Math.ceil(Math.log10(Math.max(...mc.er) * 1.1)))], cl = (v) => clamp(Math.abs(v), ed[0], ed[1]);
      const P2 = L.plot(g, B2, { xd: [7.4, 62], yd: ed, xlog: true, ylog: true, xticks: XT, xlabel: 'averaging time, s', ylabel: 'heart-rate error, beats a minute (rms over recordings)', yfmt: (v) => (v >= 1 ? String(v) : v.toPrecision(1)), xfmt: (v) => String(v) });
      L.rule(g, P2, { y: 2, color: 'ok', label: 'within 2' }); L.rule(g, P2, { x: clamp(P.T, 8, 60), color: 'text3', dash: [2, 3], label: 'now ' + P.T + ' s', side: P.T > 40 ? 'left' : 'right' });
      L.trace(g, P2, taus, mc.er.map(cl), { color: 'accent', width: 2 }); L.dots(g, P2, taus.slice(0, shown), own.err.slice(0, shown).map(cl), { color: 'text', r: 2, alpha: 0.9 });
      void T;
    };

    // ---------- controls ----------
    const redrawAll = () => { fHero.redraw(); fSig.redraw(); fConv.redraw(); };
    const changed = L.soon(() => { newRecording(false); resetTrials(); if (L.reduced()) settle(); report(); redrawAll(); });
    function settle() { while (trials.length < NTRIAL) runTrial(); paintSpeckle(0); report(); redrawAll(); }
    const sRange = L.slider({ label: 'Range to the person', min: 10, max: 300, step: 5, value: P.range, unit: 'm', hint: 'Collected light falls as the square of the range, so the noise power rises as the square of the range.', onInput: (v) => { P.range = v; changed(); } });
    const sSurf = L.seg({ label: 'The beam is aimed at', value: P.surf, options: Object.entries(SURF).map(([k, s]) => ({ value: k, label: s.short, hint: 'Heartbeat moves it about ' + s.card + ' µm (assumed)' })), onChange: (v) => { P.surf = v; changed(); } });
    controls.append(sRange.el, sSurf.el,
      L.slider({ label: 'Averaging time', min: 8, max: 60, step: 2, value: P.T, unit: 's', hint: 'How much of the recording goes into the averaged spectrum.', onInput: (v) => { P.T = v; if (phase !== 'build') { lastK = -1; analyseNow(); } report(); if (L.reduced()) redrawAll(); } }).el,
      L.slider({ label: 'Platform vibration', min: 0, max: 2.5, step: 0.05, value: Math.log10(P.vib), format: (v) => { const u = 10 ** v; return (u < 10 ? u.toFixed(1) : Math.round(u)) + ' µm/s rms: ' + (u < 6 ? 'tripod on firm ground' : u < 40 ? 'tripod in wind' : u < 150 ? 'idling vehicle' : 'hovering drone'); }, hint: 'The instrument measures its own shaking too, and a shaking beam drags the spot across the surface. The four names are assumed levels.', onInput: (v) => { P.vib = 10 ** v; changed(); } }).el,
      L.slider({ label: 'Heart rate of the simulated person', min: 45, max: 150, step: 1, value: P.hr, unit: 'beats/min', onInput: (v) => { P.hr = v; changed(); } }).el,
      L.row(L.button({ label: 'New recording', icon: 'reset', hint: 'A fresh draw of noise, replayed from zero so the line can be watched rising.', onClick: () => { P.seed++; newRecording(true, 6); resetTrials(); if (L.reduced()) settle(); redrawAll(); } })));

    newRecording(true, 1.6); resetTrials();
    const loop = L.loop((dt, t) => {
      wall = t;
      if (phase === 'build') { tNow += (dt * P.T) / buildDur; if (tNow >= P.T) { tNow = P.T; phase = 'live'; } } else tNow += dt;
      if (tNow >= TREC) { P.seed++; newRecording(true, 3); resetTrials(); }
      if (analyseNow()) report();
      if (trials.length < NTRIAL) { runTrial(); if (trials.length % 4 === 0 || trials.length === NTRIAL) report(); fConv.redraw(); } else if (phase === 'build') fConv.redraw();
      paintSpeckle(dt); fHero.redraw(); fSig.redraw();
    });
    return { start() { if (L.reduced()) { tNow = Math.max(tNow, P.T); phase = 'live'; lastK = -1; analyseNow(); settle(); } else loop.start(); }, stop() { loop.stop(); } };
  },
};

// White noise through the same processing: the scatter of the harmonic sum and of its peak, used to set sigma0 and the threshold.
export function calibrate(nTrials, seed = 1) {
  const R = L.rng(seed), n = TMC * FS, nK = segsAt(TMC), fix = Array.from({ length: nK }, () => []), pk = Array.from({ length: nK }, () => []);
  for (let t = 0; t < nTrials; t++) { const v = Float64Array.from({ length: n }, () => R.n()), segs = segments(prefilter(v).y), acc = new Float64Array(NB), avg = new Float64Array(NB);
    for (let K = 1; K <= nK; K++) { const P = segs[K - 1]; for (let k = 0; k < NB; k++) { acc[k] += P[k]; avg[k] = acc[k] / K; } const A = analyse(avg, K); for (let c = 20; c < A.H.length; c += 60) fix[K - 1].push(A.H[c]); pk[K - 1].push(A.peak); } }
  const sd = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
  return { ke: fix.map((_, k) => kEff(k + 1)), sd: fix.map(sd), pk99: pk.map((a) => quant(a, 0.99)), pk50: pk.map((a) => quant(a, 0.5)) };
}
