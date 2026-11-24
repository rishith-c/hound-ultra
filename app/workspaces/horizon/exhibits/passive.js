// Passive radar. A cell mast lights the valley; the receiver hears the mast directly and, far weaker, its echoes.
// Every block of noise-like signal is generated in the frequency domain, the mast and still clutter are estimated and
// cancelled, and the range-Doppler map is the cross-correlation of what was heard with the reference. No stored answer.
import * as L from '../lib.js';
const { TAU, clamp } = L;
const C0 = 299792458, FC = 3.5e9, LAM = C0 / FC, BW = 20e6, NS = 512, NB = 512, TB = 1e-3;       // 20 MHz at 3.5 GHz; one 25.6 µs block every millisecond
const CELL = C0 / BW, RB = 40, EIRP = 1000, NOISE = 1.38e-23 * 290 * BW * 4;                      // bistatic cell 15 m; noise figure 6 dB (assumed)
const TX = [-620, 360], RX = [0, 0];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const DIRECT = dist(TX, RX);
function bist(p, v) { const dt = dist(p, TX), dr = dist(p, RX); const rr = (v[0] * (p[0] - TX[0]) + v[1] * (p[1] - TX[1])) / dt + (v[0] * (p[0] - RX[0]) + v[1] * (p[1] - RX[1])) / dr; return { r: dt + dr - DIRECT, f: -rr / LAM, dt, dr }; }
const pw = (rcs, dt, dr) => (EIRP * LAM * LAM * rcs) / ((4 * Math.PI) ** 3 * dt * dt * dr * dr);
function measure(T, P) {
  const R = L.rng(P.seed), re = new Float32Array(RB * NB), im = new Float32Array(RB * NB);
  const paths = [];
  const still = [[60, 40, 30], [-80, 90, 60], [150, -60, 80], [-40, -150, 40], [210, 120, 120], [-180, -60, 90]];
  const direct = Math.sqrt((EIRP * LAM * LAM) / ((4 * Math.PI) ** 2 * DIRECT * DIRECT) * 0.01);      // 20 dB of nulling toward the mast (assumed)
  paths.push({ a: direct, r: 0, f: 0, ph: 0 });
  for (const s of still) { const b = bist(s, [0, 0]); paths.push({ a: Math.sqrt(pw(s[2], b.dt, b.dr)), r: b.r, f: 0, ph: R() * TAU }); }
  for (const t of T) { const b = bist(t.p, t.v); paths.push({ a: Math.sqrt(pw(t.rcs, b.dt, b.dr)), r: b.r, f: b.f, ph: R() * TAU }); }
  const sg = Math.sqrt(NOISE / 2), rsn = Math.sqrt(0.5 * 10 ** (-P.refSnr / 10));
  const K = paths.length, cr = new Float64Array(K * NS), ci = new Float64Array(K * NS);
  for (let k = 0; k < K; k++) for (let n = 0; n < NS; n++) { const a = -TAU * (n - NS / 2) / NS * (paths[k].r / CELL) + paths[k].ph; cr[k * NS + n] = paths[k].a * Math.cos(a); ci[k * NS + n] = paths[k].a * Math.sin(a); }
  const Sr = new Float32Array(NB * NS), Si = new Float32Array(NB * NS), Rr = new Float32Array(NB * NS), Ri = new Float32Array(NB * NS);
  const hr = new Float64Array(NS), hi = new Float64Array(NS);
  for (let b = 0; b < NB; b++) {
    hr.fill(0); hi.fill(0);
    for (let k = 0; k < K; k++) { const p = TAU * paths[k].f * b * TB, c = Math.cos(p), s = Math.sin(p), o = k * NS; for (let n = 0; n < NS; n++) { hr[n] += cr[o + n] * c - ci[o + n] * s; hi[n] += cr[o + n] * s + ci[o + n] * c; } }
    for (let n = 0, o = b * NS; n < NS; n++, o++) { const xr = R.n() * 0.70710678, xi = R.n() * 0.70710678; Sr[o] = xr * hr[n] - xi * hi[n] + sg * R.n(); Si[o] = xr * hi[n] + xi * hr[n] + sg * R.n(); Rr[o] = xr + rsn * R.n(); Ri[o] = xi + rsn * R.n(); }
  }
  // cancel what does not move: least-squares still channel per tone over every block (an extensive-cancellation filter)
  if (P.cancel) for (let n = 0; n < NS; n++) { let a = 0, c = 0, d = 1e-30; for (let b = 0, o = n; b < NB; b++, o += NS) { a += Sr[o] * Rr[o] + Si[o] * Ri[o]; c += Si[o] * Rr[o] - Sr[o] * Ri[o]; d += Rr[o] * Rr[o] + Ri[o] * Ri[o]; } a /= d; c /= d; for (let b = 0, o = n; b < NB; b++, o += NS) { Sr[o] -= a * Rr[o] - c * Ri[o]; Si[o] -= a * Ri[o] + c * Rr[o]; } }
  const fr = new Float64Array(NS), fi = new Float64Array(NS);
  for (let b = 0; b < NB; b++) { for (let n = 0, o = b * NS; n < NS; n++, o++) { const m = (n + NS / 2) % NS; fr[m] = Sr[o] * Rr[o] + Si[o] * Ri[o]; fi[m] = Si[o] * Rr[o] - Sr[o] * Ri[o]; } L.fft(fr, fi, true); for (let r = 0; r < RB; r++) { re[r * NB + b] = fr[r]; im[r * NB + b] = fi[r]; } }
  return { re, im };
}
const WIN = {};
function doppler(X, nb) {          // range-Doppler power over the first nb blocks
  const w = WIN[nb] || (WIN[nb] = L.hann(nb)), out = new Float32Array(RB * nb), a = new Float64Array(nb), b = new Float64Array(nb);
  for (let r = 0; r < RB; r++) { for (let i = 0; i < nb; i++) { a[i] = X.re[r * NB + i] * w[i]; b[i] = X.im[r * NB + i] * w[i]; } L.fft(a, b); for (let i = 0; i < nb; i++) { const k = (i + nb / 2) % nb; out[r * nb + i] = a[k] * a[k] + b[k] * b[k]; } }
  const s = Float32Array.from(out).sort(), floor = s[s.length >> 1] / Math.LN2; for (let i = 0; i < out.length; i++) out[i] /= floor;
  return out;
}
export default {
  id: 'passive', title: 'Radio without a transmitter', short: 'Passive radar',
  readiness: 1.35, readinessNote: 'Moving people were detected through a wall with Wi-Fi signals in 2012, and satellite-internet signals have been used in measurement campaigns. No use at a collapse was verified. HOUND has no such receiver.',
  standoff: [30, 12000],
  labels: ['concept', 'live-algo'],
  labelNote: 'The mast, the people, the vehicle and every sample are simulated. The cancelling, correlation, Doppler transform and detection are computed in this page from those samples. Transmit power, reflectivity and noise are assumed.',
  sentences: [
    'Passive radar sends nothing: it listens to a mast or satellite that is already transmitting and compares the direct signal with its faint echoes.',
    'Anything that moves shifts the echo’s pitch, so one quiet receiver on a drone could watch a whole slope for people moving.',
  ],
  needs: 'A transmitter still on the air after the disaster, a clean copy of its signal, and enough rejection that the direct signal does not bury echoes thousands of times weaker.',
  unknown: 'Who can be told from a dog or a branch. A person lying still looks like the rubble around them, and wet rubble swallows gigahertz signals. Neither is modelled here.',
  sources: [
    { who: 'Chetty, Smith and Woodbridge, University College London', year: 2012, title: 'Through-the-wall sensing of personnel using passive bistatic WiFi radar at standoff distances', where: 'IEEE Transactions on Geoscience and Remote Sensing 50(4), 1218–1226', url: 'https://doi.org/10.1109/TGRS.2011.2164411' },
    { who: 'Gomez-del-Hoyo and Samczynski, Warsaw University of Technology', year: 2024, title: 'Starlink-based passive radar for Earth’s surface imaging: first experimental results', where: 'IEEE JSTARS 17, 13949–13965', url: 'https://doi.org/10.1109/JSTARS.2024.3437179' },
    { who: 'Blázquez García et al., Fraunhofer FHR', year: 2023, title: 'Experimental comparison of Starlink and OneWeb signals for passive radar', where: 'IEEE Radar Conference', url: 'https://doi.org/10.1109/RadarConf2351548.2023.10149580' },
  ],
  glyph(g, s, t, c) { g.strokeStyle = c.dim; for (let k = 0; k < 3; k++) { const q = ((t * 0.35 + k / 3) % 1); g.globalAlpha = 1 - q; g.beginPath(); g.arc(-s * 0.3, -s * 0.2, q * s * 0.75, 0, TAU); g.stroke(); } g.globalAlpha = 1; g.strokeStyle = c.accent; g.beginPath(); g.moveTo(-s * 0.3, -s * 0.2); g.lineTo(s * 0.2, s * 0.22); g.lineTo(s * 0.3, -s * 0.22); g.stroke(); g.fillStyle = c.person; g.beginPath(); g.arc(s * 0.2, s * 0.22, 2, 0, TAU); g.fill(); },
  create({ stage, controls, readout }) {
    L.layout(stage, { cols: '1.05fr 1fr', rows: '1.35fr 1fr', areas: ['map rd', 'cut int'] });
    const fMap = L.figure({ area: 'map', title: 'The scene, seen from above' }), fRD = L.figure({ area: 'rd', title: 'What the receiver computes' }), fCut = L.figure({ area: 'cut', title: 'One slice' }), fInt = L.figure({ area: 'int', title: 'Listening longer' });
    stage.append(fMap.el, fRD.el, fCut.el, fInt.el);
    const P = { cancel: true, refSnr: 25, nb: 512, seed: 2 };
    const T0 = () => [{ p: [95, 60], v: [-0.9, 0.8], rcs: 0.6, name: 'person walking', person: true }, { p: [-150, -90], v: [0.9, -0.9], rcs: 0.6, name: 'person walking', person: true }, { p: [230, -150], v: [-3.2, 1.4], rcs: 8, name: 'vehicle' }, { p: [40, 130], v: [0, 0], rcs: 0.6, name: 'person, still', person: true }];
    let T = T0(), X = null, RD = null, det = [], curve = [], img = null, clock = 0, drag = -1, M = null;
    function detect() {
      const nb = P.nb; RD = doppler(X, nb); det = []; const th = 22, at = (r, d) => RD[r * nb + ((d + nb) % nb)];
      for (let r = 0; r < RB; r++) for (let d = 0; d < nb; d++) { const v = at(r, d); if (v < th) continue; let top = true; for (let a = -2; a <= 2 && top; a++) for (let b = -3; b <= 3; b++) { const q = r + a; if (q < 0 || q >= RB || (!a && !b)) continue; if (at(q, d + b) > v) { top = false; break; } } if (!top) continue;
        let m = 0, c = 0; for (let a = -5; a <= 5; a++) for (let b = -9; b <= 9; b++) { const q = r + a; if (q < 0 || q >= RB || (Math.abs(a) < 2 && Math.abs(b) < 4)) continue; m += at(q, d + b); c++; } if (v < 9 * (m / c)) continue;
        const pk = (l, q, h) => { const u = Math.log(l + 1e-9), o = Math.log(q + 1e-9), w = Math.log(h + 1e-9), n = u - 2 * o + w; return n ? clamp((0.5 * (u - w)) / n, -0.5, 0.5) : 0; };
        const dr = r > 0 && r < RB - 1 ? pk(at(r - 1, d), v, at(r + 1, d)) : 0, dd = pk(at(r, d - 1), v, at(r, d + 1)); det.push({ r: (r + dr) * CELL, f: (d + dd - nb / 2) / (nb * TB), v }); }
      det.sort((a, b) => b.v - a.v); det = det.slice(0, 24);
      const tru = T.map((t) => ({ ...bist(t.p, t.v), t })); det.forEach((d) => { d.m = null; });
      for (const q of tru) { q.hit = null; let best = 1; for (const d of det) { if (d.m) continue; const e = Math.hypot((d.r - q.r) / 22, (d.f - q.f) / Math.max(2, 4 / (nb * TB))); if (e < best) { best = e; q.hit = d; } } if (q.hit) q.hit.m = q; }
      M = tru;
      const ramp = L.heat, R = img && img.w === nb ? img : L.raster(nb, RB); img = R; R.paint((i) => { const r = RB - 1 - Math.floor(i / nb), v = RD[r * nb + (i % nb)]; return ramp(clamp((10 * Math.log10(v + 1e-6) + 2) / 34)); });
    }
    function integ() { curve = []; const b = M[0], cellr = Math.round(b.r / CELL); for (let nb = 16; nb <= NB; nb *= 2) { const q = doppler(X, nb), d = Math.round(b.f * nb * TB + nb / 2); let v = 0; for (let a = -1; a <= 1; a++) for (let c = -2; c <= 2; c++) { const r = cellr + a; if (r >= 0 && r < RB) v = Math.max(v, q[r * nb + ((d + c + nb) % nb)]); } curve.push([nb * TB, 10 * Math.log10(v)]); } }
    function compute(full = true) { X = measure(T, P); detect(); if (full) integ(); paint(); }
    const C = L.soon(() => compute()), Cf = L.soon(() => compute(false));
    let vw = {};
    fMap.draw = (g, w, h) => {
      const sc = Math.min(w / 1010, h / 700), ox = w * 0.5 + 235 * sc, oy = h * 0.56; vw = { sc, ox, oy }; const X1 = (p) => ox + p[0] * sc, Y1 = (p) => oy - p[1] * sc, TK = L.tokens();
      g.strokeStyle = L.rgba('text3', 0.08); for (let k = -10; k < 10; k++) { g.beginPath(); g.moveTo(X1([k * 100, 0]), 0); g.lineTo(X1([k * 100, 0]), h); g.moveTo(0, Y1([0, k * 100])); g.lineTo(w, Y1([0, k * 100])); g.stroke(); }
      const cx = (TX[0] + RX[0]) / 2, cy = (TX[1] + RX[1]) / 2, ang = Math.atan2(-(RX[1] - TX[1]), RX[0] - TX[0]);
      for (let k = 1; k <= 8; k++) { const a = (DIRECT + k * 60) / 2, b = Math.sqrt(a * a - (DIRECT / 2) ** 2); g.strokeStyle = L.rgba('accent', 0.1); g.lineWidth = 1; g.beginPath(); g.ellipse(X1([cx, 0]), Y1([0, cy]), a * sc, b * sc, ang, 0, TAU); g.stroke(); }
      for (let k = 0; k < 5; k++) { const q = (clock * 0.16 + k / 5) % 1; g.strokeStyle = L.rgba('text2', 0.22 * (1 - q)); g.beginPath(); g.arc(X1(TX), Y1(TX), q * 1200 * sc, 0, TAU); g.stroke(); }
      for (const q of M || []) { if (!q.hit) continue; const a = (DIRECT + q.hit.r) / 2, b = Math.sqrt(Math.max(0, a * a - (DIRECT / 2) ** 2)); g.strokeStyle = L.rgba(q.t.person ? 'person' : 'text2', 0.55); g.lineWidth = 1.25; g.beginPath(); g.ellipse(X1([cx, 0]), Y1([0, cy]), a * sc, b * sc, ang, 0, TAU); g.stroke(); }
      g.strokeStyle = TK.text2; g.lineWidth = 1.25; const tx = X1(TX), ty = Y1(TX); g.beginPath(); g.moveTo(tx - 5, ty + 9); g.lineTo(tx, ty - 14); g.lineTo(tx + 5, ty + 9); g.moveTo(tx - 3, ty); g.lineTo(tx + 3, ty); g.stroke(); L.text(g, 'cell mast (assumed 1 kW)', tx + 10, ty - 8, { color: 'text2' });
      g.strokeStyle = TK.accent; g.strokeRect(X1(RX) - 5, Y1(RX) - 5, 10, 10); L.text(g, 'receiver, listening only', X1(RX) + 10, Y1(RX) + 16, { color: 'accent', halo: true });
      T.forEach((t) => { const c = t.person ? TK.person : TK.text2, x = X1(t.p), y = Y1(t.p); g.strokeStyle = c; g.fillStyle = c; g.beginPath(); g.arc(x, y, t.person ? 4.5 : 6, 0, TAU); g.fill(); const s = Math.hypot(...t.v); if (s > 0) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + t.v[0] * 12, y - t.v[1] * 12); g.stroke(); } L.text(g, t.name + (s ? ', ' + s.toFixed(1) + ' m/s' : ''), x + 9, y - 8, { color: t.person ? 'person' : 'text2', halo: true }); });
      L.scaleBar(g, w - 130, h - 10, sc);
    };
    fRD.draw = (g, w, h) => {
      const box = L.pad(w, h, { l: 48, t: 16, r: 14, b: 36 }); const F = 150; const Pl0 = { x: box.x, y: box.y, w: box.w, h: box.h };
      if (img) { const nb = P.nb, half = F * nb * TB; g.imageSmoothingEnabled = true; g.drawImage(img.canvas, nb / 2 - half, 0, 2 * half, RB, Pl0.x, Pl0.y, Pl0.w, Pl0.h); }
      const Pl = L.plot(g, box, { xd: [-F, F], yd: [0, RB * CELL], xlabel: 'Doppler shift, Hz', grid: false }); L.text(g, 'extra path length, m', 48, 10, { color: 'text3', size: 11 });
      for (const q of M || []) { const x = Pl.X(q.f), y = Pl.Y(q.r); g.strokeStyle = L.tokens().ok; g.setLineDash([2, 2]); g.beginPath(); g.arc(x, y, 9, 0, TAU); g.stroke(); g.setLineDash([]); }
      for (const d of det) { const x = Pl.X(d.f), y = Pl.Y(d.r); g.strokeStyle = d.m ? L.tokens().text : L.tokens().warn; g.lineWidth = 1.25; g.strokeRect(x - 5, y - 5, 10, 10); }
    };
    fRD.legend([{ label: 'detection', color: 'text', kind: 'hollow' }, { label: 'false alarm', color: 'warn', kind: 'hollow' }, { label: 'truth', color: 'ok', kind: 'hollow' }]);
    fCut.draw = (g, w, h) => { if (!RD) return; const nb = P.nb, r = clamp(Math.round(M[0].r / CELL), 0, RB - 1), xs = [], ys = []; for (let d = 0; d < nb; d++) { xs.push((d - nb / 2) / (nb * TB)); ys.push(10 * Math.log10(RD[r * nb + d] + 1e-3)); } const Pl = L.plot(g, L.pad(w, h, { t: 18 }), { xd: [-150, 150], yd: [-15, 50], xlabel: 'Doppler shift, Hz' }); L.text(g, 'power above the noise, dB', 46, 11, { color: 'text3', size: 11 }); L.trace(g, Pl, xs, ys, { color: 'accent', width: 1.25 }); L.rule(g, Pl, { x: M[0].f, label: 'truth', color: 'ok' }); };
    fInt.draw = (g, w, h) => { if (!curve.length) return; const Pl = L.plot(g, L.pad(w, h, { t: 18 }), { xd: [0.014, 0.6], yd: [0, 50], xlog: true, xticks: [0.016, 0.03, 0.06, 0.13, 0.26, 0.51], xfmt: String, xlabel: 'listening time, s' }); L.text(g, 'first person above the noise, dB', 46, 11, { color: 'text3', size: 11 }); const xs = curve.map((c) => c[0]), ys = curve.map((c) => c[1]); L.trace(g, Pl, xs, xs.map((x) => ys[ys.length - 1] + 10 * Math.log10(x / xs[xs.length - 1])), { color: 'text3', dash: [4, 4], width: 1 }); L.trace(g, Pl, xs, ys, { color: 'accent', fill: 0.14 }); L.dots(g, Pl, xs, ys); L.rule(g, Pl, { y: 13.4, label: 'detection threshold', color: 'warn' }); };
    const sD = L.stat('moving targets found'), sF = L.stat('false alarms'), sR = L.stat('median range error', { unit: 'm' }), sV = L.stat('median Doppler error', { unit: 'Hz' });
    function paint() {
      const mv = M.filter((q) => Math.hypot(...q.t.v) > 0.05), hit = mv.filter((q) => q.hit), med = (a) => { a = a.slice().sort((x, y) => x - y); return a.length ? a[a.length >> 1] : NaN; }, fa = det.filter((d) => !d.m).length;
      sD.set(hit.length + ' of ' + mv.length); sD.tone(hit.length === mv.length ? 'ok' : 'warn'); sF.set(String(fa)); sF.tone(fa ? 'warn' : 'ok'); sR.set(L.fix(med(hit.map((q) => Math.abs(q.hit.r - q.r))), 1)); sV.set(L.fix(med(hit.map((q) => Math.abs(q.hit.f - q.f))), 2));
      const st = M.find((q) => Math.hypot(...q.t.v) < 0.05);
      fMap.setTitle(hit.length + ' of ' + mv.length + ' moving targets found' + (st ? st.hit ? '; the still person too' : '; the person who lies still is invisible' : '')); fMap.setNote('Each detection says only how far the echo travelled: an ellipse around mast and receiver. Drag anyone.');
      fRD.setTitle(P.cancel ? 'With the mast cancelled, what moves stands out' : 'Without cancelling, the mast buries the echoes'); fRD.setNote(P.nb + ' blocks of 25.6 µs, one each millisecond. Two people within about 15 m of path and 2 Hz of each other merge into one.');
      fCut.setTitle('At the first person’s range, the echo sits at ' + M[0].f.toFixed(0) + ' Hz'); fInt.setTitle('Listening twice as long adds about 3 dB (dashed)');
      fMap.redraw(); fRD.redraw(); fCut.redraw(); fInt.redraw();
    }
    fMap.onPointer(({ type, x, y }) => { const p = [(x - vw.ox) / vw.sc, (vw.oy - y) / vw.sc]; if (type === 'down') { drag = T.findIndex((t) => Math.hypot(t.p[0] - p[0], t.p[1] - p[1]) * vw.sc < 18); } else if (type === 'drag' && drag >= 0) { T[drag].p = [clamp(p[0], -560, 340), clamp(p[1], -290, 330)]; Cf(); } else if (type === 'up') { if (drag >= 0) C(); drag = -1; } fMap.canvas.style.cursor = drag >= 0 ? 'grabbing' : T.some((t) => Math.hypot(t.p[0] - p[0], t.p[1] - p[1]) * vw.sc < 18) ? 'grab' : 'default'; });
    readout.append(L.h('h4', null, 'Measured against the simulated truth'), sD.el, sF.el, sR.el, sV.el);
    controls.append(
      L.toggle({ label: 'Cancel the mast and everything still', value: true, onChange: (v) => { P.cancel = v; C(); } }).el,
      L.seg({ label: 'Listening time', value: 512, options: [{ value: 64, label: '64 ms' }, { value: 128, label: '128 ms' }, { value: 256, label: '256 ms' }, { value: 512, label: '512 ms' }], onChange: (v) => { P.nb = v; detect(); paint(); } }).el,
      L.slider({ label: 'Quality of the reference copy', min: 0, max: 40, step: 1, value: P.refSnr, unit: 'dB', onInput: (v) => { P.refSnr = v; Cf(); } }).el,
      L.slider({ label: 'First person’s walking speed', min: 0, max: 2, step: 0.1, value: 1.2, unit: 'm/s', format: (v) => v.toFixed(1), onInput: (v) => { T[0].v = [-0.747 * v, 0.664 * v]; C(); } }).el,
      L.row(L.button({ label: 'Listen again', icon: 'reset', onClick: () => { P.seed++; compute(); } }), L.button({ label: 'Reset the scene', onClick: () => { T = T0(); compute(); } })));
    compute();
    const loop = L.loop((dt) => { clock += dt; fMap.redraw(); });
    return { start() { paint(); loop.start(); }, stop() { loop.stop(); } };
  },
};
