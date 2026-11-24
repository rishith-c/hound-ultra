// Exhibit 07, "Every router is a sensor" (concept; standardisation path). IEEE 802.11bf standardises how Wi-Fi
// devices ask each other for channel measurements. One ladder diagram of a sensing measurement exchange, with the
// channel maths under it running live on a simulated scene, and what more bandwidth would buy: range resolution c/B
// and a two-path channel impulse response synthesised with this file's own inverse FFT.
// Frame and phase names follow the overview paper (Du et al.); the final standard text was not read. No frame fields
// or timings are shown: the time axis is illustrative.
import { C0, F0, DF, SUB, SUB_SORTED, rng } from './lab.js';

const TAU = Math.PI * 2;
const ECHO = 0.5, SNR_DB = 25, NFFT = 65536;      // assumed: echo at half the direct amplitude, 25 dB SNR per subcarrier
const CSI_SNR_DB = 28, WALK = 0.5, STEP_S = 0.1;  // assumed: CSI noise, walking speed m/s, scene seconds between exchanges
export const BANDS = [
  { id: 'hound', hz: SUB.length * DF, name: 'HOUND today', seg: (SUB.length * DF / 1e6).toFixed(1), note: SUB.length + ' subcarriers, ' + DF / 1e3 + ' kHz apart, channel 6', fc: F0 },
  { id: '20', hz: 20e6, name: '20 MHz', seg: '20', note: 'a common Wi-Fi channel width', fc: F0 },
  { id: '40', hz: 40e6, name: '40 MHz', seg: '40', note: 'a common Wi-Fi channel width', fc: F0 },
  { id: '80', hz: 80e6, name: '80 MHz', seg: '80', note: 'a common Wi-Fi channel width', fc: F0 },
  { id: '160', hz: 160e6, name: '160 MHz', seg: '160', note: 'a common Wi-Fi channel width', fc: F0 },
  { id: '320', hz: 320e6, name: '320 MHz', seg: '320', note: 'the most the overview gives for continuous measurement below 7 GHz', fc: F0 },
  { id: '1760', hz: 1.76e9, name: '1.76 GHz', seg: '1760', note: 'one channel in the bands above 45 GHz, per the overview; carrier assumed 60.48 GHz here', fc: 60.48e9 },
];

// ---- maths ----
// In-place radix-2 FFT (inverse when inv is true; not scaled).
export function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 1 : -1) * TAU) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// Channel impulse response of a two-path scene measured over bandwidth hz: K subcarriers DF apart, direct path at
// delay 0, an echo with extra path length "excess" metres, noise, then a zero-padded inverse FFT.
// Returns |h| per bin (direct path alone = 1) and the path length of one bin.
export function cir(hz, excess, { fc = F0, a = ECHO, snrDb = SNR_DB, seed = 7, nfft = NFFT } = {}) {
  const K = Math.max(2, Math.round(hz / DF)), re = new Float64Array(nfft), im = new Float64Array(nfft), rnd = rng(seed);
  const sig = snrDb == null ? 0 : 10 ** (-snrDb / 20) / Math.SQRT2, psi = (TAU * fc * excess) / C0, st = (TAU * DF * excess) / C0;
  for (let k = 0; k < K; k++) { const ph = psi + (k - (K - 1) / 2) * st; re[k] = 1 + a * Math.cos(ph) + (sig ? sig * rnd.normal() : 0); im[k] = -a * Math.sin(ph) + (sig ? sig * rnd.normal() : 0); }
  fft(re, im, true);
  const mag = new Float32Array(nfft); for (let m = 0; m < nfft; m++) mag[m] = Math.hypot(re[m], im[m]) / K;
  return { K, mag, bin: C0 / (nfft * DF), at: (L) => mag[((Math.round(L / (C0 / (nfft * DF))) % nfft) + nfft) % nfft] };
}
// The same response without noise, in closed form (two Dirichlet kernels), for an echo phase psi at band centre.
export function closedForm(hz, excess, psi, L, a = ECHO) {
  const K = Math.max(2, Math.round(hz / DF)), D = (x) => { const u = (Math.PI * DF * x) / C0, s = Math.sin(u); return Math.abs(s) < 1e-9 ? 1 : Math.sin(K * u) / (K * s); };
  const d0 = D(L), d1 = a * D(L - excess);
  return Math.hypot(d0 + d1 * Math.cos(psi), d1 * Math.sin(psi));
}
// Peaks of |h| over path length: the tallest, and the next one that is separated from it by a real dip.
export function analyse(xs, vs) {
  const pk = [];
  for (let i = 1; i < vs.length - 1; i++) if (vs[i] > 0.3 && vs[i] >= vs[i - 1] && vs[i] > vs[i + 1]) pk.push(i);
  if (!pk.length) return { peaks: [], separable: false };
  pk.sort((p, q) => vs[q] - vs[p]);
  const a = pk[0];
  for (const i of pk.slice(1)) {
    const lo = Math.min(a, i), hi = Math.max(a, i); let v = Infinity; for (let j = lo; j <= hi; j++) v = Math.min(v, vs[j]);
    if (v < 0.8 * vs[i]) return { peaks: [xs[lo], xs[hi]], heights: [vs[lo], vs[hi]], separable: true };
  }
  return { peaks: [xs[a]], heights: [vs[a]], separable: false };
}
export const cell = (hz) => C0 / hz;                 // range (delay) resolution as a path length, metres
function windowFor(hz, excess) { const r = cell(hz); return [Math.max(-40, -1.2 * r), Math.min(60, excess + 1.2 * r)]; }
export function measureCir(band, excess) {
  const h = cir(band.hz, excess, { fc: band.fc }), [lo, hi] = windowFor(band.hz, excess), r = cell(band.hz);
  const stp = Math.max(1, Math.floor(r / h.bin / 40)), xs = [], vs = [];
  for (let m = Math.ceil(lo / h.bin); m * h.bin <= hi; m += stp) { xs.push(m * h.bin); vs.push(h.mag[((m % NFFT) + NFFT) % NFFT]); }
  const now = analyse(xs, vs);
  let sep = 0; const P = 16, cx = Array.from({ length: 240 }, (_, i) => lo + ((hi - lo) * i) / 239);
  for (let q = 0; q < P; q++) { const psi = (q * TAU) / P; if (analyse(cx, cx.map((L) => closedForm(band.hz, excess, psi, L))).separable) sep++; }
  return { h, cell: r, now, sepPhases: sep, phases: P, located: now.separable ? now.peaks[1] - now.peaks[0] : NaN };
}

// A small multipath scene for the CSI plot (metres): direct path, three fixed echoes, one person-like reflector.
const NODES = { ap: [0, 0], s1: [7, 1], s2: [3, 6], sta: [7, 1] };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const walker = (t) => { const u = (t * WALK) % 8; return [1.5 + (u < 4 ? u : 8 - u), 2.5]; };
export function csi(from, to, t, person, rnd) {
  const A = NODES[from], B = NODES[to], d0 = dist(A, B), r0 = rng(Math.round(d0 * 1000) + 11), paths = [[d0, 1]];
  for (const g of [0.42, 0.3, 0.2]) { const L = d0 + r0.range(1.5, 11); paths.push([L, (g * d0) / L]); }
  if (person) { const p = walker(t), L = dist(A, p) + dist(p, B); paths.push([L, (0.4 * d0) / L]); }
  const sig = 10 ** (-CSI_SNR_DB / 20) / Math.SQRT2, out = new Float64Array(SUB_SORTED.length);
  SUB_SORTED.forEach((s, i) => {
    const k = (TAU * (F0 + s * DF)) / C0; let re = sig * rnd.normal(), im = sig * rnd.normal();
    for (const [L, a] of paths) { re += a * Math.cos(k * L); im -= a * Math.sin(k * L); }
    out[i] = Math.hypot(re, im);
  });
  return out;
}
export function change(cur, prev) { let s = 0, m = 0; for (let i = 0; i < cur.length; i++) { s += (cur[i] - prev[i]) ** 2; m += prev[i]; } return Math.sqrt(s / cur.length) / (m / cur.length); }

export function selfCheck() {
  const r = (x, d = 3) => +x.toFixed(d);
  // 1. FFT round trip
  const n = 1024, rnd = rng(3), re = Float64Array.from({ length: n }, () => rnd.normal()), im = Float64Array.from({ length: n }, () => rnd.normal()), r0 = re.slice(), i0 = im.slice();
  fft(re, im, false); fft(re, im, true); let e = 0; for (let i = 0; i < n; i++) e = Math.max(e, Math.abs(re[i] / n - r0[i]), Math.abs(im[i] / n - i0[i]));
  // 2. inverse FFT against the closed form, no noise, 160 MHz, echo +3.4 m
  const b = BANDS.find((q) => q.id === '160'), ex = 3.4, h = cir(b.hz, ex, { snrDb: null }), psi = (TAU * F0 * ex) / C0; let d = 0;
  for (let L = -4; L <= 20; L += 0.05) { const m = Math.round(L / h.bin); d = Math.max(d, Math.abs(h.mag[((m % NFFT) + NFFT) % NFFT] - closedForm(b.hz, ex, psi, m * h.bin))); }
  // 3. where the echo is found, with noise
  const m160 = measureCir(b, ex), m20 = measureCir(BANDS.find((q) => q.id === '20'), ex);
  return {
    fftRoundTripMaxErr: +e.toExponential(2), ifftVersusClosedFormMaxDiff: +d.toExponential(2),
    cells_m: Object.fromEntries(BANDS.map((q) => [q.name, r(cell(q.hz), 2)])),
    at160MHz: { echoTruth_m: ex, located_m: r(m160.located), error_cm: r((m160.located - ex) * 100, 1), separableInPhases: m160.sepPhases + ' of ' + m160.phases },
    at20MHz: { separableNow: m20.now.separable, separableInPhases: m20.sepPhases + ' of ' + m20.phases },
    pass: e < 1e-9 && d < 1e-6 && Math.abs(m160.located - ex) < 0.3 && m160.sepPhases === 16 && m20.sepPhases === 0,
  };
}

// ---- the exchanges, as the overview paper describes them ----
const VARIANTS = {
  tb: {
    title: 'One trigger-based exchange: the access point sounds the channel both ways, then collects the results',
    actors: [['ap', 'Access point', 'sensing initiator'], ['s1', 'Station 1', 'responder'], ['s2', 'Station 2', 'responder']],
    holder: 'Access point holds results of',
    phases: [
      ['Polling phase', [
        { from: ['ap'], to: ['s1', 's2'], name: 'Poll', text: 'The access point polls the stations to learn which can take part in this exchange.' },
        { from: ['s1', 's2'], to: ['ap'], name: 'CTS-to-self', text: 'Stations that will take part answer, for example with a CTS-to-self.' }]],
      ['NDPA sounding phase', [
        { from: ['ap'], to: ['s1', 's2'], name: 'Sensing NDP Announcement', text: 'The access point announces that a sounding packet follows, and to whom.' },
        { from: ['ap'], to: ['s1', 's2'], name: 'SI2SR NDP', ndp: true, measure: [['s1', 'ap', 's1', 'at station 1'], ['s2', 'ap', 's2', 'at station 2']], text: 'A null data packet from the sensing initiator to the responders: no data, only a known waveform. Each station compares what arrived with what was sent. The difference is the channel state information (CSI).' }]],
      ['TF sounding phase', [
        { from: ['ap'], to: ['s1', 's2'], name: 'Sensing Sounding Trigger', text: 'The access point asks the stations to send sounding packets back.' },
        { from: ['s1', 's2'], to: ['ap'], name: 'SR2SI NDP', ndp: true, measure: [['ap']], text: 'Null data packets from the responders to the initiator. The access point measures the channel from each station itself, so nothing needs reporting for this direction.' }]],
      ['Reporting phase', [
        { from: ['ap'], to: ['s1', 's2'], name: 'Trigger: request results', text: 'The access point sends a trigger frame asking the stations for their sensing measurement results.' },
        { from: ['s1', 's2'], to: ['ap'], name: 'Sensing measurement results', report: 'ap', text: 'The stations report. Immediate reporting returns the measurement of this exchange; delayed reporting returns the one from the previous exchange.' }]],
    ],
  },
  ntb: {
    title: 'Non-trigger-based: a station starts the exchange and the access point answers with its own sounding packet',
    actors: [['sta', 'Station', 'sensing initiator (not an AP)'], ['ap', 'Access point', 'responder']],
    holder: 'Station holds feedback of',
    phases: [
      ['Non-TB sensing measurement exchange', [
        { from: ['sta'], to: ['ap'], name: 'Sensing NDPA', text: 'A station that is not an access point starts: it announces a sounding packet to the access point.' },
        { from: ['sta'], to: ['ap'], name: 'SI2SR NDP', ndp: true, measure: [['ap', 'sta', 'ap', 'at the access point']], text: 'The station’s null data packet. The access point measures the channel from it.' },
        { from: ['ap'], to: ['sta'], name: 'SR2SI NDP', ndp: true, measure: [['sta', 'ap', 'sta', 'at the station']], text: 'The access point answers with a null data packet of its own. The station measures the same channel in the other direction.' },
        { from: ['ap'], to: ['sta'], name: 'Sensing feedback', report: 'sta', text: 'Feedback for the SI2SR sounding can be sent to the initiating station after the SR2SI NDP.' }]],
    ],
  },
  sbp: {
    title: 'Sensing by proxy: a station asks the access point to sense for it and gets the measurements back',
    actors: [['req', 'Station A', 'SBP initiator'], ['ap', 'Access point', 'proxy, sensing initiator'], ['s1', 'Station 1', 'responder']],
    holder: 'Station A holds results of',
    phases: [
      ['SBP request', [
        { from: ['req'], to: ['ap'], name: 'SBP Request', text: 'A station asks an access point that supports it to act as its proxy and run sensing on its behalf.' }]],
      ['Sensing measurement exchange', [
        { from: ['ap'], to: ['s1'], name: 'Sensing NDP Announcement', text: 'The access point runs an ordinary sensing exchange with other stations. Here: one responder.' },
        { from: ['ap'], to: ['s1'], name: 'SI2SR NDP', ndp: true, measure: [['s1', 'ap', 's1', 'at station 1']], text: 'The sounding packet. Station 1 measures the channel from the access point.' },
        { from: ['ap'], to: ['s1'], name: 'Trigger: request results', text: 'The access point asks station 1 for its results.' },
        { from: ['s1'], to: ['ap'], name: 'Sensing measurement results', text: 'Station 1 reports to the access point.' }]],
      ['Report to the SBP initiator', [
        { from: ['ap'], to: ['req'], name: 'Measurements reported back', report: 'req', text: 'The access point reports the sensing measurements it obtained to the station that asked for them.' }]],
    ],
  },
};
for (const v of Object.values(VARIANTS)) { v.frames = []; v.spans = []; for (const [name, fr] of v.phases) { v.spans.push([name, v.frames.length, v.frames.length + fr.length]); v.frames.push(...fr); } }

export const meta = {
  title: 'Every router is a sensor',
  labels: ['concept', 'live-algo'],
  labelNote: 'The standard is published; using it is a concept for HOUND. The channel maths beside the diagram runs live on a simulated scene.',
  plain: [
    'Wi-Fi devices already measure the radio channel between them. IEEE 802.11bf, published in 2025, standardises how one device asks another for those measurements so they can be used to sense movement.',
    'If routers and phones in a building still had power, every link between them could act like the sensing link HOUND carries in on its own two radios.',
  ],
  citesTitle: 'The standard and its overview',
  cites: [
    { by: 'IEEE Std 802.11bf-2025', title: 'Enhancements for wireless LAN sensing (amendment to IEEE 802.11), published 26 September 2025 per the IEEE 802.11 working group. Bands per the overview paper: licence-exempt bands between 1 and 7.125 GHz and above 45 GHz.', venue: '', url: 'https://www.ieee802.org/11/' },
    { by: 'R. Du et al.', year: 2025, title: 'An overview on IEEE 802.11bf: WLAN sensing (preprint: arxiv.org/abs/2310.17661)', venue: 'IEEE Communications Surveys & Tutorials 27(1)', url: 'https://doi.org/10.1109/COMST.2024.3408899' },
  ],
  honest: '802.11bf standardises the measurement exchange, not the detection. After a flood the mains are out and most routers are dark. HOUND’s own network has only been tested on simulated people.',
  unknown: 'whether any powered device that speaks 802.11bf would be left in a collapsed building, and how well its links would sense there.',
};

export function create(stage, side, ctx, lab) {
  const { h, tok, rgba, clamp } = lab;
  const NUM = () => '500 10.5px ' + tok('--mono'), TXT = () => '500 11px ' + tok('--font'), TXB = () => '600 11px ' + tok('--font');
  const S = { variant: 'tb', reporting: 'immediate', run: true, person: true, band: '160', excess: 3.4 };
  const SLOT = 0.85;                                // seconds on screen per frame slot (illustrative)
  let T = 0, exch = 1, sceneT = 0, reported = null, hoverK = -1, lad = null, dLad = true, dCsi = true, dBw = true, MC = null;
  const noise = rng(20251);
  let lines = [], hist = [], apMeasured = 0;        // CSI lines for the current variant; change history of the first line
  const V = () => VARIANTS[S.variant], band = () => BANDS.find((b) => b.id === S.band);

  // ---- figures ----
  const figLad = lab.figure('', { tag: ctx.kit.realityTag('concept'), cls: 'radio-bf-ladder', caption: 'Phase and frame names follow the overview paper (Du et al.); the final standard text was not read. Timing is illustrative, not from the standard: the overview says only that a short interframe space (SIFS) separates the frames.' });
  const figCsi = lab.figure('', { tag: ctx.kit.realityTag('sim') });
  const figCir = lab.figure('', { tag: ctx.kit.realityTag('live-algo'), caption: 'Two simulated paths, the echo at half the direct amplitude and 25 dB signal to noise (both assumed), measured on subcarriers 312.5 kHz apart across the chosen bandwidth, then this page’s own inverse FFT. Drag the echo on the plot.' });
  const figBw = lab.figure('');
  stage.append(h('div.radio-grid.radio-bf-grid', null, h('div.radio-bf-col.radio-bf-col-a', null, figLad, figCsi), h('div.radio-bf-col.radio-bf-col-b', null, figCir, figBw)));
  const host = (fig) => { const el = h('div.radio-bf-host'); fig.body.classList.add('radio-bf-body'); fig.body.append(el); return el; };
  const hLad = host(figLad), note = h('p.radio-bf-note'); figLad.body.append(note);
  const cvLad = lab.canvas(hLad, drawLadder, { label: 'Sequence diagram of one sensing measurement exchange, time flowing down' });
  const cvCsi = lab.canvas(host(figCsi), drawCsi, { label: 'Channel state information measured from the null data packet, amplitude over subcarriers' });
  const hCir = host(figCir), cvCir = lab.canvas(hCir, drawCir, { label: 'Channel impulse response of a direct path and one echo at the chosen bandwidth' });
  const hBw = host(figBw), cvBw = lab.canvas(hBw, drawBw, { label: 'Range resolution c over B for each bandwidth, log scale' });

  // ---- side ----
  const segVar = lab.seg([['tb', 'Trigger-based', 'The access point starts and triggers every frame'], ['ntb', 'Non-TB', 'Non-trigger-based: a station that is not an access point starts'], ['sbp', 'By proxy', 'Sensing by proxy (SBP): a station asks the access point to sense for it']], S.variant, (v) => { S.variant = v; resetExchange(); }, { label: 'Kind of exchange' });
  const segRep = lab.seg([['immediate', 'Immediate', 'The report carries this exchange’s measurement'], ['delayed', 'Delayed', 'The report carries the previous exchange’s measurement']], S.reporting, (v) => { S.reporting = v; dLad = dCsi = true; run.once(); }, { label: 'Reporting' });
  const tgRun = lab.toggle('Run the exchange', S.run, (v) => { S.run = v; run.once(); });
  const tgPerson = lab.toggle('A person is walking near the link (simulated)', S.person, (v) => { S.person = v; });
  const stE = lab.stat('Exchange', ''), stC = lab.stat('CSI change', '%', { title: 'Root-mean-square change in amplitude across the 51 subcarriers since the previous exchange, relative to the mean amplitude' });
  const segBand = lab.seg(BANDS.map((b) => [b.id, b.seg, b.name + ': ' + b.note]), S.band, (v) => { S.band = v; bw(); }, { label: 'Bandwidth, MHz' });
  const slEx = lab.slider({ label: 'Echo path', min: 0.2, max: 12, step: 0.1, value: S.excess, format: (v) => '+' + v.toFixed(1) + ' m', title: 'How much longer the path off the person is than the direct path', oninput: (v) => { S.excess = v; bw(); } });
  const st = { cell: lab.stat('Range cell, c/B', 'm'), delay: lab.stat('Echo arrives later by', 'ns'), loc: lab.stat('Echo located at', 'm', { title: 'Distance between the two peaks found in the noisy response' }), err: lab.stat('Error against truth', 'cm'),
    peaks: lab.stat('Peaks found', ''), ph: lab.stat('Separable, echo phases', '', { title: 'The echo’s phase turns once for every wavelength of extra path. Near the limit, whether two peaks show depends on it: counted over 16 phases, noise-free, closed form.' }) };
  const hz = SUB.length * DF;
  side.append(
    lab.group('Measurement exchange', h('div.radio-row', null, segVar), h('div.radio-row', null, h('span.radio-row-label', null, 'Reporting'), segRep), tgRun, tgPerson, h('div.radio-stats', null, stE, stC)),
    lab.group('What more bandwidth would buy', h('div.radio-row', null, h('span.radio-row-label', null, 'Bandwidth, MHz')), h('div.radio-row', null, segBand), slEx, h('div.radio-stats', null, st.cell, st.delay, st.loc, st.err, st.peaks, st.ph)),
    lab.group('HOUND today',
      h('p', null, 'HOUND brings its own link: two ESP32 radios, 100 probes a second, ' + SUB.length + ' usable subcarriers ' + DF / 1e3 + ' kHz apart on channel 6, ' + (F0 / 1e6).toFixed(0) + ' MHz. That is ' + (hz / 1e6).toFixed(1) + ' MHz of spectrum and a range cell of ' + cell(hz).toFixed(1) + ' m, so it cannot tell echoes apart by distance. Its network reads how the channel changes over time instead.'),
      h('p.radio-bf-hint', null, 'With 802.11bf, devices already in a building could be asked for the same kind of measurement over wider channels. No routers are modelled in this exercise.')));

  // ---- exchange state ----
  function takeLine(m) {                             // m = [who, from, to, label]
    let ln = lines.find((l) => l.who === m[0]);
    if (!ln) { ln = { who: m[0], label: m[3], cur: null, prev: null }; lines.push(ln); }
    ln.prev = ln.cur; ln.cur = csi(m[1], m[2], sceneT, S.person, noise); ln.exch = exch; ln.t0 = performance.now();
    if (ln === lines[0] && ln.prev) { hist.push(change(ln.cur, ln.prev) * 100); if (hist.length > 36) hist.shift(); }
  }
  function fire(k) {
    const f = V().frames[k];
    for (const m of f.measure || []) { if (m.length > 1) takeLine(m); else apMeasured = exch; }
    if (f.report) reported = S.reporting === 'immediate' ? exch : exch - 1;
    dCsi = true; csiReadout();
  }
  function resetExchange() {
    T = 0; lines = []; hist = []; reported = null; hoverK = -1;
    for (const f of V().frames) for (const m of f.measure || []) if (m.length > 1) { takeLine(m); lines[lines.length - 1].t0 = 0; lines[lines.length - 1].exch = exch - 1; }
    figLad.setTitle(V().title); setNote(); dLad = dCsi = true; csiReadout(); run.once();
  }
  function csiReadout() {
    stE.set(String(exch)); const c = hist[hist.length - 1];
    stC.set(c == null ? '–' : c.toFixed(1), c > 9 ? 'accent' : '');
    figCsi.setTitle(c == null ? 'What a null data packet yields: the channel on 51 subcarriers' : 'What a null data packet yields: CSI, ' + c.toFixed(1) + ' % different from the last exchange');
  }
  function setNote() {
    const f = hoverK >= 0 ? V().frames[hoverK] : null;
    note.replaceChildren(...(f ? [h('b', null, f.name + '. '), f.text]
      : ['Where this sits: a sensing capabilities exchange, then a sensing measurement session is set up, then measurement exchanges like this one repeat until the session is terminated. Point at a frame for what it does.']));
  }
  hLad.addEventListener('pointermove', (e) => {
    if (!lad) return; const r = hLad.getBoundingClientRect(), y = e.clientY - r.top, k = Math.floor((y - lad.top) / lad.sh);
    const nk = k >= 0 && k < V().frames.length ? k : -1; if (nk !== hoverK) { hoverK = nk; setNote(); dLad = true; run.once(); }
  });
  hLad.addEventListener('pointerleave', () => { if (hoverK !== -1) { hoverK = -1; setNote(); dLad = true; run.once(); } });

  // ---- bandwidth state ----
  function bw() {
    const b = band(); MC = measureCir(b, S.excess);
    st.cell.set(MC.cell.toFixed(MC.cell < 1 ? 3 : 2)); st.delay.set(((S.excess / C0) * 1e9).toFixed(2));
    st.loc.set(MC.now.separable ? MC.located.toFixed(2) : 'merged', MC.now.separable ? 'ok' : 'warn');
    st.err.set(MC.now.separable ? ((MC.located - S.excess) * 100 >= 0 ? '+' : '−') + Math.abs((MC.located - S.excess) * 100).toFixed(1) : '–');
    st.peaks.set(String(MC.now.peaks.length)); st.ph.set(MC.sepPhases + ' of ' + MC.phases, MC.sepPhases === MC.phases ? 'ok' : MC.sepPhases ? 'warn' : '');
    const what = b.id === 'hound' ? 'With HOUND’s ' + (b.hz / 1e6).toFixed(1) + ' MHz' : 'At ' + b.name;
    figCir.setTitle(what + (MC.now.separable ? ' the echo stands apart: found at +' + MC.located.toFixed(2) + ' m, truth +' + S.excess.toFixed(1) + ' m' : ' the echo, +' + S.excess.toFixed(1) + ' m longer, merges with the direct path'));
    figBw.setTitle('More bandwidth, finer range: c/B is ' + (MC.cell >= 1 ? MC.cell.toFixed(1) + ' m' : (MC.cell * 100).toFixed(0) + ' cm') + ' at ' + (b.id === 'hound' ? (b.hz / 1e6).toFixed(1) + ' MHz' : b.name));
    segBand.set(S.band); dBw = true; run.once();
  }
  let cirP = null, bwRows = null, dragging = false;
  const exAt = (e) => { const r = hCir.getBoundingClientRect(); return clamp(Math.round(cirP.inv(e.clientX - r.left) * 10) / 10, 0.2, 12); };
  hCir.addEventListener('pointerdown', (e) => { if (!cirP) return; dragging = true; hCir.setPointerCapture(e.pointerId); hCir.classList.add('is-drag'); S.excess = exAt(e); slEx.set(S.excess); bw(); });
  hCir.addEventListener('pointermove', (e) => { if (dragging) { S.excess = exAt(e); slEx.set(S.excess); bw(); } });
  for (const ev of ['pointerup', 'pointercancel']) hCir.addEventListener(ev, () => { dragging = false; hCir.classList.remove('is-drag'); });
  const rowAt = (e) => { if (!bwRows) return null; const r = hBw.getBoundingClientRect(), k = Math.floor((e.clientY - r.top - bwRows.top) / bwRows.rh); return BANDS[k] || null; };
  hBw.addEventListener('pointermove', (e) => hBw.classList.toggle('is-pick', !!rowAt(e)));
  hBw.addEventListener('click', (e) => { const b = rowAt(e); if (b) { S.band = b.id; bw(); } });

  // ---- frame ----
  const run = lab.loop((t, dt) => {
    const n = V().frames.length;
    if (dt === 0 && S.run && T < n) { for (let k = Math.ceil(T - 1e-9); k < n; k++) fire(k); T = n; dLad = true; }      // reduced motion: show one finished exchange
    else if (S.run && dt > 0) {
      const p = T; T += dt / SLOT;
      for (let k = 0; k < n; k++) if (p < k + 1 && T >= k + 1) fire(k);
      if (T >= n + 0.9) { T = 0; exch++; sceneT += STEP_S; csiReadout(); }
      dLad = true;
    }
    if (lines.some((l) => performance.now() - l.t0 < 700)) dCsi = true;
    if (dLad) { dLad = false; cvLad.redraw(); }
    if (dCsi) { dCsi = false; cvCsi.redraw(); }
    if (dBw) { dBw = false; cvCir.redraw(); cvBw.redraw(); }
  });

  // ---- drawing ----
  function wrap(c, text, maxW) { const out = []; let cur = ''; for (const w of text.split(' ')) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; }
  function drawLadder(c, w, hh) {
    const v = V(), n = v.frames.length, left = 126, top = 44, bottom = 20, right = 92;
    const xs = v.actors.map((_, i) => Math.round(left + 26 + (i * (w - left - 26 - right)) / (v.actors.length - 1)) + 0.5), xOf = (id) => xs[v.actors.findIndex((a) => a[0] === id)];
    const sh = Math.min(64, (hh - top - bottom) / n); lad = { top, sh };
    const ty = top + Math.min(T, n) * sh;
    // lifelines and heads
    v.actors.forEach((a, i) => {
      c.strokeStyle = tok('--line-3'); c.lineWidth = 1; c.beginPath(); c.moveTo(xs[i], top - 8); c.lineTo(xs[i], top + n * sh + 4); c.stroke();
      const al = i === 0 ? 'left' : i === v.actors.length - 1 && v.actors.length > 2 ? 'center' : 'center', lx = i === 0 ? xs[i] - 12 : xs[i];
      lab.label(c, a[1], lx, 10, { align: al, font: TXB(), color: tok('--text') }); lab.label(c, a[2], lx, 24, { align: al, color: tok('--text-3') });
    });
    // phases
    c.font = TXT();
    for (const [name, a, b] of v.spans) {
      const y0 = top + a * sh + 4, y1 = top + b * sh - 4, on = T >= a && T < b;
      c.strokeStyle = on ? tok('--accent') : tok('--line-3'); c.lineWidth = 1; c.beginPath(); c.moveTo(left - 4, y0 + 0.5); c.lineTo(left - 9.5, y0 + 0.5); c.lineTo(left - 9.5, y1 - 0.5); c.lineTo(left - 4, y1 - 0.5); c.stroke();
      const ls = wrap(c, name, left - 28); ls.forEach((s, i) => lab.label(c, s, left - 16, (y0 + y1) / 2 + (i - (ls.length - 1) / 2) * 14, { align: 'right', color: on ? tok('--text') : tok('--text-3') }));
    }
    // frames
    v.frames.forEach((f, k) => {
      const y0 = Math.round(top + k * sh + 17), y1 = Math.round(top + (k + 1) * sh - 4), p = clamp((T - k) * sh / Math.max(1, sh) , 0, 1), done = T >= k + 1, live = T >= k && !done, hot = k === hoverK;
      const prog = clamp((ty - y0) / (y1 - y0), 0, 1);
      if (hot) { c.fillStyle = rgba('--text', 0.035); c.fillRect(left - 2, top + k * sh, w - left - 6, sh); }
      const fx = f.from.map(xOf), tx = f.to.map(xOf), ink = done || live ? tok('--accent') : tok('--line-3');
      // arrows from each sender to the receivers
      f.from.forEach((id, q) => {
        const sx = xOf(id), ay = y0 + 4.5 + q * 6, far = tx.reduce((m, x) => (Math.abs(x - sx) > Math.abs(m - sx) ? x : m), tx[0]), dir = Math.sign(far - sx);
        c.strokeStyle = done || live ? rgba('--accent', live ? 0.95 : 0.55) : tok('--line-3'); c.lineWidth = 1; c.beginPath(); c.moveTo(sx + dir * 6, ay); c.lineTo(far - dir * 6.5, ay); c.stroke();
        for (const x of tx) { c.fillStyle = c.strokeStyle; c.beginPath(); c.moveTo(x - dir * 6, ay); c.lineTo(x - dir * 12, ay - 3); c.lineTo(x - dir * 12, ay + 3); c.closePath(); c.fill(); }
      });
      // receive windows, then the transmitted frame itself
      for (const x of tx) { c.fillStyle = done ? rgba('--accent', 0.12) : tok('--bg-1'); c.fillRect(x - 5, y0, 10, y1 - y0); c.strokeStyle = done || live ? rgba('--accent', 0.6) : tok('--line-3'); c.strokeRect(x - 5, y0 + 0.5, 10, y1 - y0 - 1); }
      for (const x of fx) {
        c.fillStyle = tok('--bg-1'); c.fillRect(x - 5.5, y0, 11, y1 - y0);
        if (prog > 0) { c.fillStyle = tok('--accent'); c.fillRect(x - 5.5, y0, 11, (y1 - y0) * prog); if (f.ndp) { c.fillStyle = rgba('--bg-0', 0.45); for (let q = y0 + 2; q < y0 + (y1 - y0) * prog - 1; q += 4) c.fillRect(x - 5.5, q, 11, 1); } }
        c.strokeStyle = ink; c.strokeRect(x - 5, y0 + 0.5, 10, y1 - y0 - 1);
      }
      const lx = Math.min(...fx, ...tx) + 12;
      lab.label(c, f.name, lx, y0 - 8, { color: live || hot ? tok('--text') : done ? tok('--text-2') : tok('--text-3'), font: f.ndp ? TXB() : TXT(), bg: true });
      // what happens when it lands
      for (const m of f.measure || []) { const x = xOf(m[0]), y = y1 - 5; c.fillStyle = done ? tok('--text') : tok('--bg-1'); c.strokeStyle = done ? tok('--text') : tok('--text-3'); c.beginPath(); c.moveTo(x + 10, y); c.lineTo(x + 14.5, y - 4.5); c.lineTo(x + 19, y); c.lineTo(x + 14.5, y + 4.5); c.closePath(); c.fill(); c.stroke(); lab.label(c, 'measures CSI', x + 24, y, { color: done ? tok('--text') : tok('--text-3'), bg: true }); }
      if (f.report) { const x = xOf(f.report), y = y1 - 5, left2 = x < w / 2; c.fillStyle = done ? tok('--ok') : tok('--bg-1'); c.strokeStyle = done ? tok('--ok') : tok('--text-3'); c.fillRect(x + (left2 ? -18 : 10), y - 4, 8, 8); c.strokeRect(x + (left2 ? -18 : 10) + 0.5, y - 3.5, 7, 7);
        const which = S.reporting === 'immediate' ? 'this exchange' : 'the previous exchange';
        lab.label(c, (done ? 'has results of ' : 'results of ') + which, x + (left2 ? 12 : 24), y + (left2 ? 13 : 0), { color: done ? tok('--ok') : tok('--text-3'), bg: true }); }
    });
    // playhead
    if (T < n + 0.02) { const py = Math.round(ty) + 0.5; c.strokeStyle = rgba('--text', 0.75); c.lineWidth = 1; c.beginPath(); c.moveTo(left - 2, py); c.lineTo(w - 8, py); c.stroke(); c.fillStyle = tok('--text'); c.beginPath(); c.moveTo(left - 2, py); c.lineTo(left - 9, py - 4); c.lineTo(left - 9, py + 4); c.closePath(); c.fill(); }
    lab.label(c, 'time runs down, not to scale', left - 16, hh - 9, { align: 'right', color: tok('--text-3') });
    lab.label(c, 'exchange ' + exch, w - 10, hh - 9, { align: 'right', font: NUM(), color: tok('--text-2') });
  }

  function drawCsi(c, w, hh) {
    const sw = Math.min(170, w * 0.34), mg = { l: 36, r: sw + 26, t: 22, b: 34 };
    const P = lab.plot(c, { x: mg.l, y: mg.t, w: w - mg.l - mg.r, h: hh - mg.t - mg.b, xd: [-26, 26], yd: [0, 2.4], xt: [-26, -13, 0, 13, 26], yt: [0, 1, 2], xf: (v) => String(v).replace('-', '−'), xl: 'subcarrier, 312.5 kHz apart', yl: 'amplitude, direct path = 1', ylx: 26 });
    const now = performance.now(), cols = [tok('--accent'), tok('--text')];
    lines.forEach((ln, q) => {
      if (!ln.cur) return; const rv = clamp((now - ln.t0) / 600, 0, 1), nn = ln.cur.length, upto = Math.max(1, Math.round(rv * nn));
      const pts = (a) => Array.from(a, (v, i) => [P.X(SUB_SORTED[i]), P.Y(Math.min(2.4, v))]);
      if (ln.prev) lab.line(c, pts(ln.prev), rgba(q ? '--text' : '--accent', 0.28), 1);
      lab.line(c, pts(ln.cur).slice(0, upto), cols[q % 2], 1.5);
      lab.label(c, ln.label, P.X(26) - 4, mg.t + 9 + q * 14, { align: 'right', color: cols[q % 2], bg: true });
    });
    if (lines.some((l) => l.prev)) lab.label(c, 'faint: previous exchange', mg.l + 6, mg.t + 9, { color: tok('--text-3'), bg: true });
    // how much it changed, exchange by exchange
    const x0 = w - sw - 4, y0 = mg.t, ph = hh - mg.t - mg.b, top = 40;
    c.strokeStyle = tok('--line-2'); c.lineWidth = 1; c.strokeRect(Math.round(x0) + 0.5, y0 + 0.5, sw - 10, ph);
    const bwid = (sw - 12) / 36; hist.forEach((v, i) => { const bh = (Math.min(top, v) / top) * (ph - 2); c.fillStyle = i === hist.length - 1 ? tok('--accent') : rgba('--accent', 0.45); c.fillRect(x0 + 1 + (36 - hist.length + i) * bwid, y0 + ph - bh, Math.max(1, bwid - 1), bh); });
    lab.label(c, 'change per exchange, %', x0, y0 - 9, { color: tok('--text-3') });
    lab.label(c, String(top), x0 - 4, y0 + 5, { align: 'right', font: NUM(), color: tok('--text-3') }); lab.label(c, '0', x0 - 4, y0 + ph - 4, { align: 'right', font: NUM(), color: tok('--text-3') });
    const who = V().holder + ' ' + (reported == null ? 'no exchange yet' : reported < 1 ? 'no exchange yet (delayed)' : 'exchange ' + reported);
    lab.label(c, who, w - 14, hh - 12, { align: 'right', color: reported >= 1 ? tok('--ok') : tok('--text-3') });
  }

  function drawCir(c, w, hh) {
    if (!MC) return;
    const mg = { l: 40, r: 16, t: 26, b: 36 }, x0 = -4, x1 = 20, pw = w - mg.l - mg.r, b = band();
    const P = lab.plot(c, { x: mg.l, y: mg.t, w: pw, h: hh - mg.t - mg.b, xd: [x0, x1], yd: [0, 1.7], xt: [-4, 0, 4, 8, 12, 16, 20], yt: [0, 0.5, 1, 1.5], xf: (v) => String(v).replace('-', '−'), yf: (v) => v.toFixed(1), xl: 'extra path length, m (delay × c)', yl: '|h|, direct path alone = 1' });
    cirP = { inv: (px) => x0 + ((px - mg.l) / pw) * (x1 - x0) };
    const yb = hh - mg.b, ex = P.X(S.excess), zx = P.X(0);
    // truth
    c.strokeStyle = tok('--text-3'); c.lineWidth = 1; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(Math.round(zx) + 0.5, mg.t); c.lineTo(Math.round(zx) + 0.5, yb); c.stroke();
    c.strokeStyle = tok('--person'); c.beginPath(); c.moveTo(Math.round(ex) + 0.5, mg.t); c.lineTo(Math.round(ex) + 0.5, yb); c.stroke(); c.setLineDash([]);
    // response: max of |h| over the bins under each pixel
    const pts = []; for (let px = 0; px <= pw; px += 1) { const La = x0 + (px / pw) * (x1 - x0), Lb = x0 + ((px + 1) / pw) * (x1 - x0); let v = 0; for (let m = Math.round(La / MC.h.bin); m <= Math.round(Lb / MC.h.bin); m++) v = Math.max(v, MC.h.mag[((m % NFFT) + NFFT) % NFFT]); pts.push([mg.l + px, P.Y(Math.min(1.7, v))]); }
    c.save(); c.beginPath(); c.rect(mg.l, mg.t, pw, yb - mg.t); c.clip();
    c.fillStyle = rgba('--accent', 0.1); c.beginPath(); c.moveTo(mg.l, yb); for (const p of pts) c.lineTo(p[0], p[1]); c.lineTo(mg.l + pw, yb); c.closePath(); c.fill();
    lab.line(c, pts, tok('--accent'), 1.5); c.restore();
    // found peaks
    MC.now.peaks.forEach((L, i) => { const x = P.X(L), y = P.Y(Math.min(1.7, MC.now.heights[i])) - 5; if (x < mg.l || x > mg.l + pw) return; c.fillStyle = tok('--text'); c.beginPath(); c.moveTo(x, y); c.lineTo(x - 4, y - 6); c.lineTo(x + 4, y - 6); c.closePath(); c.fill(); });
    // the range cell, drawn to scale from the direct path
    const cy = mg.t + 12, cx1 = Math.min(P.X(MC.cell), mg.l + pw - 1), cut = P.X(MC.cell) > mg.l + pw;
    c.strokeStyle = tok('--text-2'); c.lineWidth = 1; c.beginPath(); c.moveTo(zx, cy + 0.5); c.lineTo(cx1, cy + 0.5); c.moveTo(Math.round(zx) + 0.5, cy - 4); c.lineTo(Math.round(zx) + 0.5, cy + 5); if (!cut) { c.moveTo(Math.round(cx1) + 0.5, cy - 4); c.lineTo(Math.round(cx1) + 0.5, cy + 5); } c.stroke();
    const cl = 'c/B ' + (MC.cell >= 1 ? MC.cell.toFixed(2) + ' m' : (MC.cell * 100).toFixed(1) + ' cm') + (cut ? ' (runs off the plot)' : '');
    const side2 = cx1 - zx > c.measureText(cl).width + 30 || cut;
    lab.label(c, cl, side2 ? (zx + cx1) / 2 : zx - 8, side2 ? cy + 12 : cy, { font: NUM(), color: tok('--text-2'), align: side2 ? 'center' : 'right', bg: true });
    lab.label(c, 'direct', zx - 6, yb - 10, { align: 'right', color: tok('--text-3'), bg: true });
    const rightSide = ex < mg.l + pw - 150;
    lab.label(c, 'echo off the person, +' + S.excess.toFixed(1) + ' m (truth)', ex + (rightSide ? 7 : -7), yb - 10, { align: rightSide ? 'left' : 'right', color: tok('--person'), bg: true });
    lab.label(c, MC.now.separable ? 'two peaks: separable' : 'one peak: merged', mg.l + pw - 8, mg.t + 38, { align: 'right', font: TXB(), color: MC.now.separable ? tok('--ok') : tok('--warn'), bg: true });
    lab.label(c, MC.sepPhases === MC.phases ? 'at every echo phase' : MC.sepPhases === 0 ? 'at every echo phase' : 'depends on the echo’s phase: ' + MC.sepPhases + ' of ' + MC.phases, mg.l + pw - 8, mg.t + 53, { align: 'right', color: tok('--text-3'), bg: true });
  }

  function drawBw(c, w, hh) {
    const lw = 96, mg = { l: lw + 12, r: 16, t: 20, b: 34 }, pw = w - mg.l - mg.r, lo = Math.log10(0.1), hi = Math.log10(30), X = (m) => mg.l + ((Math.log10(m) - lo) / (hi - lo)) * pw;
    const rh = (hh - mg.t - mg.b) / BANDS.length; bwRows = { top: mg.t, rh };
    c.font = NUM(); c.textBaseline = 'top'; c.textAlign = 'center';
    for (const m of [0.1, 0.3, 1, 3, 10, 30]) { const x = Math.round(X(m)) + 0.5; c.strokeStyle = tok('--line'); c.beginPath(); c.moveTo(x, mg.t); c.lineTo(x, hh - mg.b); c.stroke(); c.fillStyle = tok('--text-3'); c.fillText(String(m), x, hh - mg.b + 5); }
    lab.label(c, 'range cell c/B, m (log scale): smaller is finer', mg.l + pw, hh - mg.b + 25, { align: 'right', color: tok('--text-3') });
    const exX = Math.round(X(S.excess)) + 0.5;
    BANDS.forEach((b, i) => {
      const y = mg.t + i * rh, cy = Math.round(y + rh / 2), sel = b.id === S.band, r = cell(b.hz), x = X(r), ok = r <= S.excess;
      if (sel) { c.fillStyle = rgba('--accent', 0.1); c.fillRect(4, y + 1, w - 8, rh - 2); c.fillStyle = tok('--accent'); c.fillRect(4, y + 1, 2, rh - 2); }
      lab.label(c, b.name, lw + 2, cy, { align: 'right', color: sel ? tok('--text') : tok('--text-2'), font: sel ? TXB() : TXT() });
      c.fillStyle = sel ? tok('--accent') : tok('--line-3'); c.fillRect(mg.l, cy - 1, x - mg.l, 3);
      c.fillStyle = sel ? tok('--accent') : tok('--text-2'); c.fillRect(Math.round(x) - 1, cy - 6, 3, 13);
      const txt = (r >= 1 ? r.toFixed(r >= 10 ? 1 : 2) + ' m' : (r * 100).toFixed(1) + ' cm') + (ok ? '  apart' : '  merged');
      const leftSide = x > mg.l + pw - 110;
      c.font = NUM(); const tw = c.measureText(txt).width; const lx = leftSide ? x - 8 - tw : x + 8;
      lab.label(c, txt, lx, cy, { font: NUM(), color: ok ? tok('--ok') : tok('--text-3'), bg: Math.abs(exX - (lx + tw / 2)) < tw / 2 + 4 });
    });
    c.strokeStyle = tok('--person'); c.lineWidth = 1; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(exX, mg.t - 4); c.lineTo(exX, hh - mg.b); c.stroke(); c.setLineDash([]);
    lab.label(c, 'echo +' + S.excess.toFixed(1) + ' m', exX + (exX > mg.l + pw - 80 ? -6 : 6), mg.t - 9, { align: exX > mg.l + pw - 80 ? 'right' : 'left', color: tok('--person') });
  }

  resetExchange(); bw();
  return {
    onShow() { dLad = dCsi = dBw = true; run.start(); },
    onHide() { run.stop(); },
  };
}
