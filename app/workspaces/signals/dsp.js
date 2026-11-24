// Signal processing for the tap detector. Everything here is real and runs on whatever audio it is given:
// the microphone, the built-in synthetic recording, or the test clips. The same code path serves all three,
// so the measured detection rates describe the detector you see running.
//
// Pipeline (one frame every 8 ms at 16 kHz):
//   1. Short-time Fourier transform: 512-sample Hann window, hop 128.
//   2. Adaptive whitening: each frequency bin is divided by its own slowly tracked noise floor, so a steady
//      hum, wind or generator turns into a flat background and stops producing onsets.
//   3. Band-limited spectral flux, 150 Hz to 4 kHz: the summed rise in log magnitude over 16 ms. A knock is a
//      sudden rise across the whole band.
//   4. Peak picking against an adaptive threshold (running median + 3 scaled median absolute deviations).
//      A peak with too little energy above the noise floor is set aside as "weak".
//   5. Each onset is classed by how fast its energy dies: a knock is gone within 60 ms, a voiced sound is not.
//   6. Rhythm: inter-onset intervals and the autocorrelation of the onset train give candidate periods; a chain
//      search finds three or more evenly spaced knocks; the group is reported once it is followed by a pause.
//      A rhythm that is too even and never pauses is treated as a machine.
import { mulberry32 } from '../../core/geometry.js';

export const FS = 16000;
export const N = 512, HOP = 128;
export const BAND = [150, 4000];
export const REPORT_AT = 0.5;      // a pattern is reported when its score reaches this
export const IOI_RANGE = [0.18, 1.25]; // seconds between knocks that count as one rhythm

const COS = new Float32Array(N / 2), SIN = new Float32Array(N / 2), REV = new Uint16Array(N), HANN = new Float32Array(N);
for (let i = 0; i < N / 2; i++) { COS[i] = Math.cos((2 * Math.PI * i) / N); SIN[i] = Math.sin((2 * Math.PI * i) / N); }
for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < 9; b++) r |= ((i >> b) & 1) << (8 - b); REV[i] = r; HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N); }
const RE = new Float32Array(N), IM = new Float32Array(N);

// Magnitude spectrum of one frame (length N) into mag (length N/2).
export function fftMag(frame, mag) {
  for (let i = 0; i < N; i++) { RE[REV[i]] = frame[i] * HANN[i]; IM[i] = 0; }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half, c = COS[k], s = SIN[k];
        const tr = RE[b] * c + IM[b] * s, ti = IM[b] * c - RE[b] * s;
        RE[b] = RE[a] - tr; IM[b] = IM[a] - ti; RE[a] += tr; IM[a] += ti;
      }
    }
  }
  for (let k = 0; k < N / 2; k++) mag[k] = Math.sqrt(RE[k] * RE[k] + IM[k] * IM[k]) / (N / 4);
}

function median(buf, n) { // buf is scratch and gets sorted
  const s = buf.subarray(0, n); s.sort();
  return n & 1 ? s[n >> 1] : 0.5 * (s[(n >> 1) - 1] + s[n >> 1]);
}

export class TapDetector {
  constructor(fs = FS, { display = true } = {}) {
    this.fs = fs; this.dt = HOP / fs; this.display = display;
    const hz = fs / N;
    this.k0 = Math.max(2, Math.round(BAND[0] / hz)); this.k1 = Math.min(N / 2 - 1, Math.round(BAND[1] / hz));
    this.acc = new Float32Array(N); this.got = 0; this.frame = 0;
    this.mag = new Float32Array(N / 2); this.floor = new Float32Array(N / 2);
    this.l1 = new Float32Array(N / 2); this.l2 = new Float32Array(N / 2);
    this.H = Math.ceil(14 / this.dt);                       // 14 s of history
    this.flux = new Float32Array(this.H); this.thr = new Float32Array(this.H); this.env = new Float32Array(this.H);
    this.wmin = new Float32Array(this.H); this.wmax = new Float32Array(this.H);
    this.medN = Math.round(1.5 / this.dt); this.scratch = new Float32Array(this.medN);
    this.medF = 0; this.madF = 0; this.medE = 1;
    this.lastOnsetFrame = -1e9; this.pending = [];
    this.onsets = []; this.patterns = []; this.rejected = [];
    this.chain = null; this.doneBefore = -1; this.nextId = 1;
    this.ioi = new Float32Array(50); this.acf = new Float32Array(126); this.period = 0; // 25 ms bins; 10 ms lags
    this.counts = { impulse: 0, sustained: 0, weak: 0, machine: 0 };
    this.onColumn = null; this.onPattern = null;
    this.hopMin = 0; this.hopMax = 0;
  }
  get now() { return this.frame * this.dt; }

  push(x) {
    const acc = this.acc;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      acc[N - HOP + this.got] = v;
      if (v < this.hopMin) this.hopMin = v; if (v > this.hopMax) this.hopMax = v;
      if (++this.got === HOP) { this._frame(); acc.copyWithin(0, HOP); this.got = 0; }
    }
  }

  _frame() {
    const { mag, floor, l1, l2, k0, k1, dt, H } = this; const n = this.frame, idx = n % H;
    fftMag(this.acc, mag);
    // noise floor per bin: quick to fall, slow to rise, so a knock does not lift it
    if (n < 12) { for (let k = 0; k < N / 2; k++) floor[k] += (mag[k] - floor[k]) / (n + 1); }
    else { const up = dt / 3, down = dt / 0.4; for (let k = 0; k < N / 2; k++) { const d = mag[k] - floor[k]; floor[k] += d * (d > 0 ? up : down); } }
    let fl = 0, e = 0, ef = 0;
    for (let k = k0; k <= k1; k++) {
      const L = Math.log1p(mag[k] / (floor[k] + 1e-9));
      const d = L - l2[k]; if (d > 0) fl += d;
      l2[k] = l1[k]; l1[k] = L;
      e += mag[k] * mag[k]; ef += floor[k] * floor[k];
    }
    fl /= k1 - k0 + 1;
    this.flux[idx] = n < 14 ? 0 : fl; this.env[idx] = e / (ef + 1e-12);
    if (this.display) { this.wmin[idx] = this.hopMin; this.wmax[idx] = this.hopMax; this.hopMin = 0; this.hopMax = 0; this.onColumn?.(mag, n); }
    // running median and spread of the flux, every 4th frame
    if ((n & 3) === 0 && n > 20) {
      const m = Math.min(this.medN, n - 14), s = this.scratch;
      for (let i = 0; i < m; i++) s[i] = this.flux[(n - i + H) % H];
      this.medF = median(s, m);
      for (let i = 0; i < m; i++) s[i] = Math.abs(this.flux[(n - i + H) % H] - this.medF);
      this.madF = median(s, m);
      for (let i = 0; i < m; i++) s[i] = this.env[(n - i + H) % H];
      this.medE = median(s, m);
    }
    this.thr[idx] = this.medF + 3 * 1.4826 * this.madF + 0.01;
    // a peak in the flux, checked three frames late so both sides are known
    const m = n - 3;
    if (m > 20) {
      const f = (i) => this.flux[(i + H) % H];
      const v = f(m);
      if (v > this.thr[(m + H) % H] && (m - this.lastOnsetFrame) * dt >= 0.09 && v > f(m - 1) && v > f(m - 2) && v > f(m - 3) && v >= f(m + 1) && v >= f(m + 2) && v >= f(m + 3)) {
        const a = f(m - 1), c = f(m + 1), den = a - 2 * v + c, off = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0; // parabolic peak position
        this.lastOnsetFrame = m;
        this.pending.push({ frame: m, t: (m + off) * dt, strength: v / this.thr[(m + H) % H] });
      }
    }
    // class each onset 120 ms after it happened
    const wait = Math.round(0.12 / dt);
    while (this.pending.length && n >= this.pending[0].frame + wait) {
      const p = this.pending.shift(), base = this.medE;
      const ex = (i) => Math.max(0, this.env[(i + H) % H] - base);
      let pk = 0; for (let i = p.frame - 1; i <= p.frame + 4; i++) pk = Math.max(pk, ex(i));
      let tail = 0, c = 0; for (let i = p.frame + Math.round(0.07 / dt); i <= p.frame + wait; i++) { tail += ex(i); c++; }
      p.decay = tail / c / (pk + 1e-6); p.level = 10 * Math.log10(pk + 1e-6);
      p.kind = pk < 1.5 ? 'weak' : p.decay < 0.3 ? 'impulse' : 'sustained'; // weak: too little energy above the floor to judge
      this.counts[p.kind]++;
      this.onsets.push(p);
      if (p.kind === 'impulse') this._rhythm();
    }
    this._pause();
    if ((n & 63) === 0) { const cut = this.now - 14; while (this.onsets.length && this.onsets[0].t < cut) this.onsets.shift(); }
    this.frame++;
  }

  // Inter-onset intervals, autocorrelation of the onset train, and the best evenly spaced chain.
  _rhythm() {
    const now = this.now, imp = this.onsets.filter((o) => o.kind === 'impulse' && o.t > now - 9 && o.t > this.doneBefore);
    this.ioi.fill(0); this.acf.fill(0);
    for (let i = 1; i < imp.length; i++) { const d = imp[i].t - imp[i - 1].t; if (d < IOI_RANGE[1]) this.ioi[Math.min(49, Math.floor(d / 0.025))] += 1; }
    let r0 = 0; const raw = new Float32Array(126);
    for (let i = 0; i < imp.length; i++) {
      r0 += 1;
      for (let j = i + 1; j < imp.length; j++) {
        const d = imp[j].t - imp[i].t; if (d > 1.25) break;
        const c = d / 0.01;
        for (let q = Math.max(0, Math.floor(c - 5)); q <= Math.min(125, Math.ceil(c + 5)); q++) raw[q] += Math.exp(-0.5 * ((q - c) / 2) ** 2);
      }
    }
    for (let q = 0; q < 126; q++) this.acf[q] = raw[q] / Math.max(1, r0);
    // candidate periods: lags where at least two pairs of knocks agree
    const cands = [];
    for (let q = Math.round(IOI_RANGE[0] / 0.01); q < 125; q++) if (raw[q] >= 1.5 && raw[q] >= raw[q - 1] && raw[q] > raw[q + 1]) cands.push({ P: q * 0.01, w: raw[q] });
    cands.sort((a, b) => b.w - a.w); cands.length = Math.min(cands.length, 4);
    // and every gap between neighbouring knocks, so a hesitant hand (uneven by 15 %) is still tried
    for (let i = Math.max(1, imp.length - 6); i < imp.length; i++) { const d = imp[i].t - imp[i - 1].t; if (d >= IOI_RANGE[0] && d <= IOI_RANGE[1] && !cands.some((c) => Math.abs(c.P - d) < 0.02)) cands.push({ P: d, w: 1 }); }
    let best = null;
    for (const cand of cands) {
      for (let i = 0; i < imp.length - 1; i++) {
        const chain = [imp[i]]; let P = cand.P, last = i;
        for (;;) {
          const want = chain[chain.length - 1].t + P; let hit = -1, err = 0.2 * P;
          for (let j = last + 1; j < imp.length && imp[j].t < want + 0.2 * P; j++) { const d = Math.abs(imp[j].t - want); if (d < err) { err = d; hit = j; } }
          if (hit < 0) break;
          chain.push(imp[hit]); last = hit; P = (imp[hit].t - chain[0].t) / (chain.length - 1);
        }
        if (chain.length >= 2 && (!best || chain.length > best.items.length || (chain.length === best.items.length && chain[chain.length - 1].t > best.items[best.items.length - 1].t))) best = { items: chain, P };
      }
    }
    if (!best && imp.length >= 2) { // two knocks so far: a candidate, nothing more
      const a = imp[imp.length - 2], b = imp[imp.length - 1], d = b.t - a.t;
      if (d >= IOI_RANGE[0] && d <= IOI_RANGE[1]) best = { items: [a, b], P: d };
    }
    this.chain = best ? this._score(best, imp) : null;
    this.period = this.chain ? this.chain.period : 0;
    const c = this.chain;
    if (c && c.count >= 10) {
      if (c.cv < 0.025) c.machine = true;
      else this._finish(c); // a person knocking on and on: report without waiting for a pause
    }
  }

  _score(ch, imp) {
    const it = ch.items, n = it.length, iv = [];
    for (let i = 1; i < n; i++) iv.push(it[i].t - it[i - 1].t);
    const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
    const cv = iv.length > 1 ? Math.sqrt(iv.reduce((a, b) => a + (b - mean) ** 2, 0) / iv.length) / mean : 0;
    const lv = it.map((o) => o.level), spread = Math.max(...lv) - Math.min(...lv);
    const t0 = it[0].t, t1 = it[n - 1].t;
    const extra = imp.filter((o) => o.t > t0 - mean && o.t < t1 + mean && !it.includes(o)).length; // other impacts in and around the group
    const sCount = n >= 5 ? 0.94 : n === 4 ? 0.86 : n === 3 ? 0.74 : 0.25;
    const sReg = Math.max(0, 1 - cv / 0.22), sAmp = Math.max(0, 1 - Math.max(0, spread - 3) / 15), sClean = 1 / (1 + 0.6 * extra);
    const conf = n < 3 ? 0.2 : sCount * (0.5 + 0.5 * sReg) * (0.6 + 0.4 * sAmp) * (0.55 + 0.45 * sClean);
    return { items: it, count: n, period: mean, cv, spread, extra, t0, t1, conf, parts: { sCount, sReg, sAmp, sClean } };
  }

  // For display only: gaps between neighbouring knocks and the autocorrelation of the knock train, last 9 s.
  view() {
    const now = this.now, imp = this.onsets.filter((o) => o.kind === 'impulse' && o.t > now - 9);
    const ioi = new Float32Array(50), acf = new Float32Array(126);
    for (let i = 1; i < imp.length; i++) { const d = imp[i].t - imp[i - 1].t; if (d < IOI_RANGE[1]) ioi[Math.min(49, Math.floor(d / 0.025))] += 1; }
    for (let i = 0; i < imp.length; i++) for (let j = i + 1; j < imp.length; j++) {
      const d = imp[j].t - imp[i].t; if (d > 1.25) break; const c = d / 0.01;
      for (let q = Math.max(0, Math.floor(c - 5)); q <= Math.min(125, Math.ceil(c + 5)); q++) acf[q] += Math.exp(-0.5 * ((q - c) / 2) ** 2) / Math.max(1, imp.length);
    }
    return { ioi, acf, n: imp.length };
  }

  // A group is complete when the next knock fails to arrive.
  _pause() {
    const c = this.chain; if (!c || c.count < 3) return;
    const quiet = this.now - c.t1;
    if (quiet > Math.max(1.5 * c.period, c.period + 0.25) + 0.13) this._finish(c);
  }

  _finish(c) {
    this.chain = null; this.doneBefore = c.t1 + 0.01;
    const out = { id: this.nextId++, t0: c.t0, t1: c.t1, at: this.now, count: c.count, period: c.period, cv: c.cv, spread: c.spread, extra: c.extra, conf: c.conf, times: c.items.map((o) => o.t) };
    if (c.machine) { out.kind = 'machine'; this.counts.machine++; this.rejected.push(out); this._trim(this.rejected); return; }
    const prev = this.patterns[this.patterns.length - 1];
    if (prev && c.t0 - prev.t1 < 8 && Math.abs(prev.period - c.period) / c.period < 0.25 && Math.abs(prev.count - c.count) <= 1 && c.conf >= 0.35) { out.conf = Math.min(0.99, c.conf + 0.2); out.repeatOf = prev.id; }
    if (out.conf >= REPORT_AT) { out.kind = 'knock'; this.patterns.push(out); this._trim(this.patterns); this.onPattern?.(out); }
    else { out.kind = 'irregular'; this.rejected.push(out); this._trim(this.rejected); }
  }
  _trim(a) { if (a.length > 60) a.splice(0, a.length - 60); }

  // What the meter shows right now.
  status() {
    const now = this.now, c = this.chain, last = this.patterns[this.patterns.length - 1];
    if (c && c.machine) return { state: 'machine', conf: 0.05, count: c.count, period: c.period };
    if (last && now - last.at < 3.5 && !(c && c.count >= 3)) return { state: 'knocking', conf: last.conf, count: last.count, period: last.period, repeat: !!last.repeatOf, hold: true };
    if (c && c.count >= 3) return { state: c.conf >= REPORT_AT ? 'knocking' : 'candidate', conf: c.conf, count: c.count, period: c.period };
    if (c && c.count === 2 && now - c.t1 < 1.6) return { state: 'candidate', conf: c.conf, count: 2, period: c.period };
    const recent = this.onsets.filter((o) => o.t > now - 1.5);
    if (recent.some((o) => o.kind === 'sustained')) return { state: 'voice', conf: 0.03 };
    if (recent.some((o) => o.kind === 'impulse')) return { state: 'impulse', conf: 0.08 };
    return { state: 'quiet', conf: 0 };
  }
}

// ------------------------------------------------------------------------------------------------------------
// Synthetic sound. Used for the built-in recording and for the test. None of it is a real recording.

export function makeVoice(rng) { // the object being struck: three damped resonances and a click
  return { modes: [
    { f: 170 + rng() * 260, tau: 0.016 + rng() * 0.018, a: 1 },
    { f: 480 + rng() * 620, tau: 0.009 + rng() * 0.012, a: 0.7 },
    { f: 1300 + rng() * 1500, tau: 0.004 + rng() * 0.006, a: 0.45 } ], click: 0.5 };
}
export function knockTemplate(voice, fs, rng) {
  const n = Math.round(0.22 * fs), y = new Float32Array(n), ph = voice.modes.map(() => rng() * 6.283);
  for (let i = 0; i < n; i++) {
    const t = i / fs; let v = 0;
    for (let m = 0; m < voice.modes.length; m++) { const o = voice.modes[m]; v += o.a * Math.exp(-t / o.tau) * Math.sin(6.2832 * o.f * t + ph[m]); }
    v += voice.click * (rng() * 2 - 1) * Math.exp(-t / 0.0015);
    y[i] = v * (1 - Math.exp(-t / 0.0004));
  }
  const m = Math.round(0.03 * fs); let s = 0; for (let i = 0; i < m; i++) s += y[i] * y[i];
  const g = 1 / Math.sqrt(s / m); for (let i = 0; i < n; i++) y[i] *= g; // unit level over its first 30 ms
  return y;
}
function addAt(x, y, at, gain) { const i0 = Math.round(at); for (let i = 0; i < y.length && i0 + i < x.length; i++) if (i0 + i >= 0) x[i0 + i] += y[i] * gain; }
const db = (d) => Math.pow(10, d / 20);
function normalise(x, target = 1) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; const g = target / Math.sqrt(s / x.length + 1e-20); for (let i = 0; i < x.length; i++) x[i] *= g; return x; }

export function pink(n, rng) { // Paul Kellet's filter
  const x = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) { const w = rng() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; x[i] = b0 + b1 + b2 + w * 0.1848; }
  return normalise(x);
}
export function steadyNoise(n, fs, rng) { // generator hum, wind: loud but unchanging
  const x = pink(n, rng), p1 = rng() * 6.28, p2 = rng() * 6.28, pd = rng() * 6.28;
  for (let i = 0; i < n; i++) { const t = i / fs; x[i] = (x[i] + 0.6 * Math.sin(314.16 * t + p1) + 0.35 * Math.sin(628.32 * t + p2) + 0.2 * Math.sin(942.5 * t)) * (1 + 0.18 * Math.sin(6.2832 * t / 7 + pd)); }
  return normalise(x);
}
// Voice-like sound: a pitched buzz through two moving resonances, in syllables and phrases. Not real speech.
export function addVoice(x, fs, t0, t1, level, rng) {
  let t = t0;
  while (t < t1) {
    const phraseEnd = Math.min(t1, t + 0.9 + rng() * 1.8); let f0 = 100 + rng() * 120;
    while (t < phraseEnd) {
      const dur = 0.12 + rng() * 0.2, att = 0.03 + rng() * 0.03, rel = 0.06 + rng() * 0.06, n = Math.round((dur + rel) * fs), i0 = Math.round(t * fs);
      const F = [300 + rng() * 500, 900 + rng() * 1400], st = [[0, 0], [0, 0]], co = F.map((f) => { const w = (6.2832 * f) / fs, r = 0.985; return [2 * r * Math.cos(w), -r * r, 1 - r]; });
      let ph = rng(); f0 *= 0.94 + rng() * 0.12; const amp = level * (0.6 + rng() * 0.6);
      if (rng() < 0.4) for (let i = 0; i < 0.012 * fs; i++) if (i0 - 200 + i >= 0 && i0 - 200 + i < x.length) x[i0 - 200 + i] += amp * 0.8 * (rng() * 2 - 1); // a consonant burst
      for (let i = 0; i < n && i0 + i < x.length; i++) {
        const tt = i / fs; ph += f0 / fs; if (ph >= 1) ph -= 1;
        const src = 2 * ph - 1; let v = 0;
        for (let k = 0; k < 2; k++) { const y = co[k][0] * st[k][0] + co[k][1] * st[k][1] + co[k][2] * src; st[k][1] = st[k][0]; st[k][0] = y; v += y * (k ? 0.7 : 1); }
        const envl = tt < att ? 0.5 - 0.5 * Math.cos((Math.PI * tt) / att) : tt > dur ? Math.max(0, 1 - (tt - dur) / rel) : 1;
        if (i0 + i >= 0) x[i0 + i] += v * envl * amp * 9;
      }
      t += dur + rel * 0.5 + 0.02 + rng() * 0.06;
    }
    t += 0.3 + rng() * 0.9;
  }
}
export const NOISE_KINDS = {
  steady: { label: 'Steady noise', sub: 'generator hum and wind' },
  voice: { label: 'Voice-like sound', sub: 'synthetic talking nearby' },
  impacts: { label: 'Random debris impacts', sub: 'about one every 3 s, irregular' },
  tick: { label: 'Steady ticking', sub: 'a pump, perfectly regular' },
};
// A background of the given kind, level 1.
export function background(kind, n, fs, rng) {
  if (kind === 'steady') return steadyNoise(n, fs, rng);
  if (kind === 'voice') { const x = pink(n, rng); for (let i = 0; i < n; i++) x[i] *= 0.18; addVoice(x, fs, 0, n / fs, 1, rng); return normalise(x); }
  const x = pink(n, rng);
  if (kind === 'impacts') { let t = 0; for (;;) { t += -Math.log(1 - rng()) / 0.33; if (t > n / fs - 0.3) break; addAt(x, knockTemplate(makeVoice(rng), fs, rng), t * fs, db(rng() * 15)); } }
  if (kind === 'tick') { const P = 0.3 + rng() * 0.5, tpl = knockTemplate(makeVoice(rng), fs, rng); for (let t = rng() * P; t < n / fs - 0.3; t += P * (1 + (rng() - 0.5) * 0.008)) addAt(x, tpl, t * fs, db(9)); }
  return x;
}
// Three (or more) deliberate knocks by one hand on one object: same sound, nearly even spacing, similar force.
export function addKnocks(x, fs, t0, count, period, snrDb, rng, { jitter = 0.05, voice = makeVoice(rng) } = {}) {
  const times = []; let t = t0;
  for (let i = 0; i < count; i++) { times.push(t); addAt(x, knockTemplate(voice, fs, rng), t * fs, db(snrDb + (rng() - 0.5) * 4)); t += period * (1 + (rng() * 2 - 1) * jitter * 1.7); }
  return times;
}

// The built-in recording: 48 s, scripted, looped. Its script is shown next to the detector's answer.
export function buildScene(seed = 7) {
  const rng = mulberry32(seed), fs = FS, dur = 48, n = dur * fs, x = steadyNoise(n, fs, rng), script = [];
  const knocks = (t, count, P, snr, label) => { const v = makeVoice(rng), ts = addKnocks(x, fs, t, count, P, snr, rng, { voice: v }); script.push({ t0: t - 0.1, t1: ts[ts.length - 1] + 0.25, kind: 'knock', label }); return v; };
  addVoice(x, fs, 3.2, 7.4, 2.6, rng); script.push({ t0: 3.2, t1: 7.6, kind: 'voice', label: 'voices' });
  const v = makeVoice(rng);
  for (const t of [10.4, 13.2]) { const ts = addKnocks(x, fs, t, 3, 0.46, 10, rng, { voice: v }); script.push({ t0: t - 0.1, t1: ts[2] + 0.25, kind: 'knock', label: '3 knocks' }); }
  for (const [t, g] of [[17.3, 12], [18.05, 4], [19.9, 9], [20.5, 14]]) addAt(x, knockTemplate(makeVoice(rng), fs, rng), t * fs, db(g));
  script.push({ t0: 17.1, t1: 20.9, kind: 'impacts', label: 'debris falling' });
  const tick = knockTemplate(makeVoice(rng), fs, rng); for (let t = 22.6; t < 30.2; t += 0.52 * (1 + (rng() - 0.5) * 0.006)) addAt(x, tick, t * fs, db(8));
  script.push({ t0: 22.5, t1: 30.4, kind: 'tick', label: 'pump ticking' });
  addVoice(x, fs, 32, 37, 2.2, rng); script.push({ t0: 32, t1: 37.2, kind: 'voice', label: 'voices' });
  knocks(34.1, 3, 0.52, 12, '3 knocks under voices');
  knocks(39.6, 3, 0.4, 2, '3 faint knocks');
  knocks(43.2, 4, 0.36, 9, '4 knocks');
  for (let i = 0; i < n; i++) x[i] *= 0.035;
  return { x, fs, dur, script };
}

// The test. Every clip is new synthetic sound; each positive clip holds exactly one group of three knocks.
export const TEST = { kinds: ['steady', 'voice', 'impacts'], snrs: [12, 6, 0, -6], trials: 24, clipS: 12, negClips: 12, negS: 20 };
export async function runTest({ seed = 1, onProgress, pause, alive = () => true } = {}) {
  const rng = mulberry32(seed), fs = FS, res = { seed, cells: {}, fa: {}, done: false, clips: 0, seconds: 0 };
  const allKinds = [...TEST.kinds, 'tick'];
  for (const k of allKinds) { res.fa[k] = { count: 0, minutes: 0 }; res.cells[k] = {}; }
  const total = TEST.kinds.length * TEST.snrs.length * TEST.trials + allKinds.length * TEST.negClips; let done = 0;
  const score = (kind, x, truth) => {
    const det = new TapDetector(fs, { display: false }); det.push(x);
    for (let i = 0; i < 16; i++) det.push(new Float32Array(HOP)); // let the last frames settle
    let hit = false;
    for (const p of det.patterns) { if (truth && p.t1 > truth[0] - 0.15 && p.t0 < truth[1] + 0.15 && !hit) hit = true; else res.fa[kind].count++; }
    res.fa[kind].minutes += x.length / fs / 60; res.clips++; res.seconds += x.length / fs;
    return hit;
  };
  for (const snr of TEST.snrs) for (const kind of TEST.kinds) {
    const cell = (res.cells[kind][snr] = { hit: 0, n: 0 });
    for (let i = 0; i < TEST.trials; i++) {
      const n = TEST.clipS * fs, x = background(kind, n, fs, rng), t0 = 4.5 + rng() * 3.5, P = 0.3 + rng() * 0.4;
      const ts = addKnocks(x, fs, t0, 3, P, snr, rng);
      if (score(kind, x, [ts[0], ts[2]])) cell.hit++; cell.n++;
      onProgress?.(res, ++done / total);
      if (pause) await pause(); if (!alive()) return res;
    }
  }
  for (const kind of allKinds) for (let i = 0; i < TEST.negClips; i++) {
    score(kind, background(kind, TEST.negS * fs, fs, rng), null);
    onProgress?.(res, ++done / total);
    if (pause) await pause(); if (!alive()) return res;
  }
  res.done = true; onProgress?.(res, 1);
  return res;
}
