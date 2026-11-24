// Atoms as antennas. Two principle figures: a Rydberg vapour whose transparency line splits in a radio field, and
// a diamond whose nitrogen-vacancy spins shift with a magnetic field. Both spectra are computed from the textbook
// weak-probe and Zeeman formulas, shot noise is added, and the field is fitted back from the noisy spectrum alone.
import * as L from '../lib.js';
const { TAU, clamp } = L;
const HBAR = 1.054571817e-34, EA0 = 8.4783536e-30, DIP = 1500;      // dipole in e·a0: assumed, the size typical of a high Rydberg state
const G28 = 28.03, D0 = 2870;                                        // MHz per mT, MHz: the NV electron spin
const HEART = 50e-12, HEART_AT = 0.06;                               // tesla at 6 cm from the heart: assumed, order of magnitude
// weak-probe ladder susceptibility (absorption) with a resonant radio field coupling the top pair
function absorb(dp, oc, orf, g2 = 3, g3 = 0.25, g4 = 0.25) {         // all in MHz (rates over 2 pi)
  // nested continued fraction: i·dp + g2 + (oc²/4)/(i·dp + g3 + (orf²/4)/(i·dp + g4))
  const inv = (a, b) => { const m = a * a + b * b; return [a / m, -b / m]; };
  const z4 = inv(g4, -dp), z3 = inv(g3 + (orf * orf / 4) * z4[0], -dp + (orf * orf / 4) * z4[1]);
  const z2 = inv(g2 + (oc * oc / 4) * z3[0], -dp + (oc * oc / 4) * z3[1]);
  return z2[0] * g2;
}
const orfOf = (E) => (DIP * EA0 * E) / HBAR / TAU / 1e6;             // V/m -> MHz
const odmr = (f, B, c = 0.03, w = 0.5) => { const a = D0 - G28 * B, b = D0 + G28 * B, lz = (x) => 1 / (1 + ((f - x) / w) ** 2); return 1 - c * lz(a) - c * lz(b); };
// golden-section search around the best of a coarse scan: least squares in one unknown
function fit1(cost, lo, hi, n = 220) {
  let bi = 0, bc = Infinity; for (let i = 0; i <= n; i++) { const c = cost(lo + ((hi - lo) * i) / n); if (c < bc) { bc = c; bi = i; } }
  let a = lo + ((hi - lo) * Math.max(0, bi - 1)) / n, b = lo + ((hi - lo) * Math.min(n, bi + 1)) / n; const r = 0.6180339887;
  for (let k = 0; k < 32; k++) { const c = b - r * (b - a), d = a + r * (b - a); if (cost(c) < cost(d)) b = d; else a = c; }
  return (a + b) / 2;
}
export default {
  id: 'atoms', title: 'Atoms as antennas', short: 'Atoms',
  readiness: 0.12, readinessNote: 'The farthest-out idea here. Atom receivers and diamond magnetometers work on optical benches. None has looked for a trapped person. HOUND has neither.',
  standoff: [0.05, 0.6],
  labels: ['concept', 'live-algo'],
  labelNote: 'Both spectra come from textbook formulas with simulated noise. The fields are fitted back from the noisy curves in this page. Line widths, noise, the dipole size and the heart field are assumed.',
  sentences: [
    'Excite an atom until its outer electron orbits thousands of times farther out than normal, and a radio wave visibly splits its spectral line; cool-running diamond defects do the same for magnetic fields.',
    'An antenna made of atoms hears any radio band without metal, and a diamond can feel a beating heart, so both could one day listen for a person where nothing else fits.',
  ],
  needs: 'Lasers, a vapour cell and optics that survive dust and shock. For a heart: sensitivity far below a picotesla next to rebar, motors and the Earth’s field, which is a million times stronger, and a sensor within centimetres.',
  unknown: 'Whether either ever leaves a shielded room in this role. The rat-heart result needed an opened chest and the diamond almost touching the heart. We found no work on trapped people.',
  sources: [
    { who: 'Sedlacek et al.', year: 2012, title: 'Microwave electrometry with Rydberg atoms in a vapour cell using bright atomic resonances', where: 'Nature Physics 8, 819–824', url: 'https://doi.org/10.1038/nphys2423' },
    { who: 'Meyer, Kunz and Cox, US Army Research Laboratory', year: 2021, title: 'Waveguide-coupled Rydberg spectrum analyzer from 0 to 20 GHz', where: 'Physical Review Applied 15, 014053', url: 'https://arxiv.org/abs/2009.14383', note: 'Received AM, FM, Wi-Fi and Bluetooth with an antenna attached.' },
    { who: 'Barry et al.', year: 2020, title: 'Sensitivity optimization for NV-diamond magnetometry', where: 'Reviews of Modern Physics 92, 015004', url: 'https://doi.org/10.1103/RevModPhys.92.015004' },
    { who: 'Arai et al., Tokyo Institute of Technology', year: 2022, title: 'Millimetre-scale magnetocardiography of living rats with thoracotomy', where: 'Communications Physics 5, 200', url: 'https://doi.org/10.1038/s42005-022-00978-0' },
  ],
  glyph(g, s, t, c) {
    g.strokeStyle = c.dim; for (let k = 0; k < 3; k++) { g.save(); g.rotate((k * Math.PI) / 3); g.beginPath(); g.ellipse(0, 0, s * 0.4, s * 0.15, 0, 0, TAU); g.stroke(); const a = t * (0.9 + k * 0.3) + k * 2; g.fillStyle = c.accent; g.beginPath(); g.arc(s * 0.4 * Math.cos(a), s * 0.15 * Math.sin(a), 1.6, 0, TAU); g.fill(); g.restore(); }
    g.fillStyle = c.ink; g.beginPath(); g.arc(0, 0, 2.2, 0, TAU); g.fill();
  },
  create({ stage, controls, readout }) {
    L.layout(stage, { cols: '1fr 1fr', rows: '1.15fr 1fr', areas: ['cell dia', 'line far'] });
    const fCell = L.figure({ area: 'cell', title: 'A radio wave pulls one line into two' }), fDia = L.figure({ area: 'dia', title: 'A magnetic field pulls two dips apart' });
    const fAcc = L.figure({ area: 'line', title: 'Weaker fields stop splitting the line' }), fFar = L.figure({ area: 'far', title: 'A heart fades too fast to feel from a distance' });
    stage.append(fCell.el, fDia.el, fAcc.el, fFar.el);
    const P = { le: -0.3, B: 0.06, noise: 0.02, ls: 0, dist: 0.1, seed: 3 };
    const N = 260, dps = Float64Array.from({ length: N }, (_, i) => -14 + (28 * i) / (N - 1)), M = 300, fs = Float64Array.from({ length: M }, (_, i) => 2862 + (16 * i) / (M - 1));
    const yA = new Float64Array(N), tA = new Float64Array(N), yB = new Float64Array(M), tB = new Float64Array(M);
    let S = {}, acc = null, clock = 0;
    const fitE = (y) => { const o = fit1((x) => { let s = 0; for (let i = 0; i < N; i += 2) { const d = absorb(dps[i], 3.5, x) - y[i]; s += d * d; } return s; }, 0, 24); return (o * 1e6 * TAU * HBAR) / (DIP * EA0); };
    function compute() {
      const R = L.rng(P.seed), E = 10 ** P.le, orf = orfOf(E);
      for (let i = 0; i < N; i++) { tA[i] = absorb(dps[i], 3.5, orf); yA[i] = tA[i] + P.noise * R.n(); }
      for (let i = 0; i < M; i++) { tB[i] = odmr(fs[i], P.B); yB[i] = tB[i] + P.noise * 0.1 * R.n(); }
      const Bh = fit1((b) => { let s = 0; for (let i = 0; i < M; i += 2) { const d = odmr(fs[i], b) - yB[i]; s += d * d; } return s; }, 0, 0.25, 260);
      S = { E, orf, Eh: fitE(yA), Bh };
      const heart = HEART * (HEART_AT / P.dist) ** 3, sens = 10 ** P.ls * 1e-12; S.heart = heart; S.time = (3 * sens / heart) ** 2;
      paint();
    }
    function accuracy() {           // the same fit repeated over field strengths: median error of 24 noisy spectra each
      const R = L.rng(99), xs = [], ys = []; const y = new Float64Array(N);
      for (let k = 0; k < 13; k++) { const E = 10 ** (-2 + (k * 2.1) / 12), o = orfOf(E), er = []; for (let r = 0; r < 12; r++) { for (let i = 0; i < N; i++) y[i] = absorb(dps[i], 3.5, o) + P.noise * R.n(); er.push(Math.abs(fitE(y) - E) / E); } er.sort((a, b) => a - b); xs.push(E); ys.push(Math.max(1e-4, er[6])); }
      acc = { xs, ys }; fAcc.redraw();
    }
    const accSoon = (() => { let h = 0; return () => { clearTimeout(h); h = setTimeout(accuracy, 160); }; })();
    const fmtE = (v) => (v < 0.1 ? (v * 1000).toFixed(1) + ' mV/m' : v.toFixed(2) + ' V/m');
    const fmtT = (s) => (s < 1 ? '<1 s' : s < 90 ? s.toFixed(0) + ' s' : s < 5400 ? (s / 60).toFixed(0) + ' min' : s < 172800 ? (s / 3600).toFixed(0) + ' h' : s < 3.15e7 ? (s / 86400).toFixed(0) + ' days' : 'years');
    function atom(g, cx, cy, r, k) {
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, L.rgba('sim', 0.0)); gr.addColorStop(0.72, L.rgba('sim', 0.05 + 0.12 * k)); gr.addColorStop(0.9, L.rgba('sim', 0.25)); gr.addColorStop(1, L.rgba('sim', 0));
      g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, r * (1 + 0.14 * k), r * (1 - 0.1 * k), 0, 0, TAU); g.fill();
      for (let i = 0; i < 26; i++) { const a = i * 2.39996 + clock * (0.7 + (i % 5) * 0.07), q = 0.78 + 0.17 * Math.sin(i * 7.1), f = 0.5 + 0.5 * Math.sin(i * 3 + clock * 2); g.fillStyle = L.rgba('sim', 0.25 + 0.6 * f); g.beginPath(); g.arc(cx + Math.cos(a) * r * q * (1 + 0.14 * k), cy + Math.sin(a) * r * q * (1 - 0.1 * k), 1.1, 0, TAU); g.fill(); }
      g.fillStyle = L.tokens().text; g.beginPath(); g.arc(cx, cy, 2, 0, TAU); g.fill();
    }
    fCell.draw = (g, w, h) => {
      const sw = Math.min(170, w * 0.32), box = { x: sw + 46, y: 16, w: w - sw - 58, h: h - 52 };
      const k = clamp(Math.abs(Math.sin(clock * 2)) * (S.orf || 0) / 12);
      g.save(); g.beginPath(); g.rect(0, 0, sw, h); g.clip(); g.strokeStyle = L.rgba('accent', 0.15 + 0.5 * clamp((P.le + 2) / 2)); g.lineWidth = 1.25; for (let r = 0; r < 4; r++) { g.beginPath(); for (let y = 0; y < h; y += 4) { const x = ((r * sw) / 3 + clock * 26) % (sw * 1.3) - 20 + 5 * Math.sin(y * 0.02); y ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); } g.restore();
      atom(g, sw / 2, h * 0.46, sw * 0.36, k);
      L.text(g, 'one atom, not to scale', sw / 2, h - 14, { color: 'text3', size: 11, align: 'center' });
      const Pl = L.plot(g, box, { xd: [-14, 14], yd: [0, 1.15], xlabel: 'probe laser offset, MHz', yfmt: (v) => v.toFixed(1) });
      L.text(g, 'light absorbed', box.x, 11, { color: 'text3', size: 11 });
      L.trace(g, Pl, dps, yA, { color: 'text3', width: 1, alpha: 0.8 }); L.trace(g, Pl, dps, tA, { color: 'ok', dash: [4, 3], width: 1.25 });
      const fitO = orfOf(S.Eh), yf = Float64Array.from(dps, (d) => absorb(d, 3.5, fitO)); L.trace(g, Pl, dps, yf, { color: 'accent', width: 2 });
    };
    fCell.legend([{ label: 'measured (simulated)', color: 'text3', kind: 'line' }, { label: 'fit', color: 'accent', kind: 'line' }, { label: 'truth', color: 'ok', kind: 'dash' }]);
    fDia.draw = (g, w, h) => {
      const Pl = L.plot(g, L.pad(w, h, { l: 50, t: 18 }), { xd: [2862, 2878], yd: [0.93, 1.01], xlabel: 'microwave frequency, MHz', yfmt: (v) => v.toFixed(2) });
      L.text(g, 'red glow of the diamond', 50, 11, { color: 'text3', size: 11 });
      L.trace(g, Pl, fs, yB, { color: 'text3', width: 1, alpha: 0.8 }); L.trace(g, Pl, fs, tB, { color: 'ok', dash: [4, 3] }); L.trace(g, Pl, fs, Float64Array.from(fs, (f) => odmr(f, S.Bh)), { color: 'accent', width: 2 });
      const a = D0 - G28 * S.Bh, b = D0 + G28 * S.Bh, y = Pl.Y(0.945); if (b - a > 0.5) { g.strokeStyle = L.rgba('accent', 0.8); g.beginPath(); g.moveTo(Pl.X(a), y); g.lineTo(Pl.X(b), y); g.stroke(); L.text(g, (b - a).toFixed(2) + ' MHz apart', Pl.X(D0), y + 14, { color: 'accent', align: 'center', halo: true }); }
    };
    fAcc.draw = (g, w, h) => {
      const Pl = L.plot(g, L.pad(w, h, { l: 58, t: 18 }), { xd: [0.01, 1.3], yd: [1e-4, 10], xlog: true, ylog: true, xlabel: 'radio field, V/m', yfmt: (v) => (v >= 0.01 ? v * 100 + ' %' : v * 100 + ' %'), xfmt: (v) => String(v) });
      L.text(g, 'median error of the fitted field', 58, 11, { color: 'text3', size: 11 });
      L.rule(g, Pl, { y: 0.1, label: '10 % error', color: 'warn' });
      if (acc) { L.trace(g, Pl, acc.xs, acc.ys, { color: 'accent', fill: 0.15 }); L.dots(g, Pl, acc.xs, acc.ys); } else L.text(g, 'fitting 156 spectra…', w / 2, h / 2, { align: 'center', color: 'text3' });
      L.rule(g, Pl, { x: S.E, label: 'set here', color: 'text2', side: P.le > -0.5 ? 'left' : 'right' });
    };
    fFar.draw = (g, w, h) => {
      const Pl = L.plot(g, L.pad(w, h, { l: 58, t: 18 }), { xd: [0.05, 2], yd: [1e-16, 1e-4], xlog: true, ylog: true, xticks: [0.05, 0.1, 0.2, 0.5, 1, 2], yticks: [1e-15, 1e-12, 1e-9, 1e-6], yfmt: (v) => ({ '-15': '1 fT', '-12': '1 pT', '-9': '1 nT', '-6': '1 µT' })[Math.round(Math.log10(v))], xfmt: String, xlabel: 'distance from the heart, m' });
      L.text(g, 'magnetic field', 58, 11, { color: 'text3', size: 11 });
      const xs = Array.from({ length: 60 }, (_, i) => 0.05 * 40 ** (i / 59)); L.trace(g, Pl, xs, xs.map((x) => HEART * (HEART_AT / x) ** 3), { color: 'person', width: 2 });
      L.rule(g, Pl, { y: 5e-5, label: 'the Earth’s field', color: 'text2' }); L.rule(g, Pl, { y: 10 ** P.ls * 1e-12, label: 'sensor noise in one second (assumed)', color: 'accent' });
      L.dots(g, Pl, [P.dist], [S.heart], { color: 'person', r: 4.5 }); L.text(g, 'the heart (assumed)', Pl.X(0.2), Pl.Y(HEART * (HEART_AT / 0.2) ** 3) - 10, { color: 'person', halo: true });
    };
    const sE = L.stat('radio field from the fit'), sEe = L.stat('error against truth', { unit: '%' }), sB = L.stat('magnetic field from the fit', { unit: 'µT' }), sBe = L.stat('error against truth', { unit: 'µT' }), sT = L.stat('of averaging to feel a heart at that distance');
    function paint() {
      sE.set(fmtE(S.Eh)); const pe = Math.abs(S.Eh - S.E) / S.E; sEe.set(pe > 9.99 ? '>999' : (pe * 100).toFixed(1)); sEe.tone(pe < 0.1 ? 'ok' : 'warn'); sB.set((S.Bh * 1000).toFixed(1)); sBe.set((Math.abs(S.Bh - P.B) * 1000).toFixed(2)); sBe.tone(Math.abs(S.Bh - P.B) < 0.002 ? 'ok' : 'warn'); sT.set(fmtT(S.time)); sT.tone(S.time < 600 ? 'ok' : 'warn');
      fCell.setTitle(S.orf > 3.5 ? 'A radio wave pulls one line into two: the gap gives ' + fmtE(S.Eh) + ' against a true ' + fmtE(S.E) : 'Below the line width the radio wave barely splits the line');
      fDia.setTitle('The dips sit ' + (2 * G28 * S.Bh).toFixed(2) + ' MHz apart, so the field is ' + (S.Bh * 1000).toFixed(1) + ' µT (truth ' + (P.B * 1000).toFixed(1) + ')');
      fFar.setTitle('At ' + L.fmtDist(P.dist) + ' the heart is ' + (S.heart / 1e-12 < 0.1 ? (S.heart / 1e-15).toPrecision(2) + ' fT' : (S.heart / 1e-12).toPrecision(2) + ' pT') + ': ' + fmtT(S.time) + ' of averaging with no other field present');
      fCell.setNote('Weak-probe ladder with a resonant radio field. Dipole 1,500 e·a₀ and line widths assumed.'); fFar.setNote('Falls as distance cubed. Real rubble adds rebar, motors and traffic: not modelled.');
      fCell.redraw(); fDia.redraw(); fAcc.redraw(); fFar.redraw();
    }
    readout.append(L.h('h4', null, 'Measured against the simulated truth'), sE.el, sEe.el, sB.el, sBe.el, sT.el);
    const C = L.soon(compute);
    controls.append(
      L.slider({ label: 'Radio field', min: -2, max: 0.1, step: 0.02, value: P.le, format: (v) => fmtE(10 ** v), onInput: (v) => { P.le = v; C(); } }).el,
      L.slider({ label: 'Magnetic field', min: 0, max: 0.2, step: 0.002, value: P.B, format: (v) => (v * 1000).toFixed(0) + ' µT', onInput: (v) => { P.B = v; C(); } }).el,
      L.slider({ label: 'Reading noise (assumed)', min: 0.005, max: 0.1, step: 0.005, value: P.noise, format: (v) => (v * 100).toFixed(1) + ' %', onInput: (v) => { P.noise = v; C(); accSoon(); } }).el,
      L.slider({ label: 'Distance to the heart', min: 0.05, max: 1, step: 0.01, value: P.dist, format: (v) => L.fmtDist(v), onInput: (v) => { P.dist = v; C(); } }).el,
      L.slider({ label: 'Diamond noise in one second (assumed)', min: -2, max: 3, step: 0.1, value: P.ls, format: (v) => (10 ** v).toPrecision(2) + ' pT', onInput: (v) => { P.ls = v; C(); } }).el,
      L.row(L.button({ label: 'Measure again', icon: 'refresh', onClick: () => { P.seed++; compute(); } })));
    compute(); accSoon();
    const loop = L.loop((dt) => { clock += dt; fCell.redraw(); });
    return { start() { compute(); loop.start(); }, stop() { loop.stop(); } };
  },
};
