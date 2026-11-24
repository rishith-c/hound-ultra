// Exhibit 03. The Fresnel dither: HOUND's own answer to "Wi-Fi breathing detection works one day and not the next".
// The model is the rover project's sensing/fresnel.py, line for line: sensitivity(), detectable(), monte_carlo().
import { LAMBDA } from './lab.js';

export const meta = {
  title: 'The Fresnel dither',
  labels: ['live-algo', { text: 'HOUND design decision', cls: 'tag-accent', title: 'A design decision of the rover project (sensing/fresnel.py). The mecanum rover exists; the dither has not been run on it with a real person.' }, { text: 'Not yet tried on a real person', cls: 'tag-sim' }],
  labelNote: 'The model below is the project’s own, running in this page. No recording exists yet.',
  plain: [
    'Whether Wi-Fi can feel a chest move depends on where the person is to within a few centimetres: in some spots breathing changes the signal strength, a few centimetres away it does not.',
    'HOUND cannot move the person, so it moves itself. Its mecanum wheels slide the receiver sideways 3.1 cm at a time, a quarter of a wavelength, until one stop brings the breathing out.',
  ],
  citesTitle: 'Research the decision rests on',
  cites: [
    { by: 'Wang et al.', year: 2016, title: 'Human respiration detection with commodity WiFi devices: do user location and body orientation matter?', venue: 'ACM UbiComp', url: 'https://doi.org/10.1145/2971648.2971744' },
    { by: 'Zhang et al.', year: 2018, title: 'From Fresnel diffraction model to fine-grained human respiration sensing with commodity Wi-Fi devices', venue: 'Proc. ACM IMWUT 2(1)', url: 'https://doi.org/10.1145/3191785' },
    { by: 'HOUND rover project', year: 2026, title: 'sensing/fresnel.py: the model, the Monte-Carlo run (16.5 % of still people detectable from one spot, 32.5 % with four stops, 35.0 % with eight) and the rule for placing the transmitter' },
  ],
  honest: 'The rover must hold its sideways steps to a few millimetres on a rubble-strewn floor, and the person must stay put for the 12 seconds a station takes. Even then the project’s own model says two still people in three stay invisible to Wi-Fi, which is why the radar gets the deciding vote.',
  unknown: 'the reflection strength of a real body through a real wall (0.15 at 1 m² and a halving per partition are allocations, not measurements).',
};

// ---- sensing/fresnel.py ----
export const CHEST_MM = 5.0, WALL_LOSS = 0.5, NOISE = 0.004, NEED = 1.5;
export function link(tx, rx, p, chestMm = CHEST_MM, lambda = LAMBDA) {
  const dDirect = Math.hypot(rx[0] - tx[0], rx[1] - tx[1]), d1 = Math.hypot(p[0] - tx[0], p[1] - tx[1]), d2 = Math.hypot(rx[0] - p[0], rx[1] - p[1]);
  const phase = (2 * Math.PI * (d1 + d2 - dDirect)) / lambda, ratio = (0.15 / Math.max(d1 * d2, 0.25)) * WALL_LOSS, dphi = (2 * Math.PI * ((1.5 * chestMm) / 1000)) / lambda;
  return { phase, ratio, dphi, sens: ratio * Math.abs(Math.sin(phase)) * dphi, zone: Math.floor((2 * (d1 + d2 - dDirect)) / lambda) + 1, excess: d1 + d2 - dDirect };
}
export const detectable = (sens, noise = NOISE) => sens / noise >= NEED;
export function monteCarlo(R, n, lambda = LAMBDA) {
  const tx = [-1.5, 0], res = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const p = [R.range(-1.0, 1.5), R.range(0.8, 3.5)]; let b4 = 0, b8 = 0;
    for (let i = 0; i < 8; i++) { const s = link(tx, [(i * lambda) / 4, 0], p, CHEST_MM, lambda).sens; if (i < 4) b4 = Math.max(b4, s); b8 = Math.max(b8, s); if (i === 0) res[0] += detectable(s) ? 1 : 0; }
    res[1] += detectable(b4) ? 1 : 0; res[2] += detectable(b8) ? 1 : 0;
  }
  return res.map((v) => v / n);
}
const PROJECT = [0.165, 0.325, 0.35];                                      // sensing/fresnel_results.json

export async function create(stage, side, ctx, lab) {
  const { h, icon } = lab;
  const TX = [-1.5, 0], WALL_Y = 0.3, REGION = { x0: -1.0, x1: 1.5, y0: 0.8, y1: 3.5 }, STEP = LAMBDA / 4;
  const st = { p: [0.42, 1.86], stop: 0, stops: 4, chestMm: 5, bpm: 15, auto: false, offset: 0 };   // offset eases toward stop * STEP
  let breath = 0, tNow = 0, autoT = 0, mc = null, mcJob = null, mapImg = null, mapKey = '', mapBuf = new Float32Array(0);
  const rxAt = (i) => [i * STEP, 0], rxNow = () => [st.offset, 0];
  const L = (i) => link(TX, rxAt(i), st.p, st.chestMm);
  const chestNow = () => { const ph = 2 * Math.PI * (st.bpm / 60) * tNow, s = Math.sin(ph) + 0.25 * Math.sin(2 * ph + 0.8); return (st.chestMm / 2) * (s / 1.19); };   // mm, same breath shape as the simulator

  const figPlan = lab.figure('Bright bands: breathing shows. Dark bands: it does not.', { tag: h('span.tag.tag-sim', null, 'Model'), caption: 'Plan view. Shade: how much a 5 mm breath there changes the received amplitude, for the receiver where it is now. Drag the person.' });
  const figPh = lab.figure('Why: two arrows that add', { caption: 'The straight path (long arrow) and the body’s echo (short arrow). Breathing swings the echo through the shaded arc. The white bar is how far the received strength moves: the arc’s shadow on the long arrow.' });
  const figStops = lab.figure('The ripple at each stop', { caption: 'Amplitude change over 10 s at every stop, with the model’s noise after averaging (0.4 %). A stop counts when the ripple is 1.5 times the noise.' });
  const figMc = lab.figure('What the dither buys, over many people', { caption: 'Still people placed at random 0.8 to 3.5 m behind the wall. White ticks: the project’s Python run (400 people, 12.5 cm wavelength).' });
  stage.append(h('div.radio-grid.radio-fresnel-grid', null, figPlan, figPh, figStops, figMc));

  // ---------- plan ----------
  const V = { x0: -2.15, x1: 2.25, y0: -0.62, y1: 3.75 }, tr = { s: 1, ox: 0, oy: 0 };
  const toS = (p) => [tr.ox + (p[0] - V.x0) * tr.s, tr.oy - (p[1] - V.y0) * tr.s];
  function paintMap(w, hh, dpr) {
    const key = [w, hh, dpr, st.offset.toFixed(4), st.chestMm].join(); if (key === mapKey && mapImg) return; mapKey = key;
    const q = w * hh * dpr * dpr > 5e5 ? dpr * 0.5 : dpr, W = Math.round(w * q), Hh = Math.round(hh * q), d = mapBuf.length === W * Hh ? mapBuf.fill(0) : (mapBuf = new Float32Array(W * Hh)), rx = rxNow();
    const dDir = Math.hypot(rx[0] - TX[0], rx[1] - TX[1]), k = (2 * Math.PI) / LAMBDA, dphi = (2 * Math.PI * ((1.5 * st.chestMm) / 1000)) / LAMBDA;
    for (let j = 0; j < Hh; j++) { const y = V.y0 + (tr.oy - j / q) / tr.s; if (y < WALL_Y) continue;
      for (let i = 0; i < W; i++) { const x = V.x0 + (i / q - tr.ox) / tr.s, d1 = Math.sqrt((x - TX[0]) * (x - TX[0]) + (y - TX[1]) * (y - TX[1])), d2 = Math.sqrt((x - rx[0]) * (x - rx[0]) + (y - rx[1]) * (y - rx[1]));
        d[j * W + i] = Math.pow((0.075 / Math.max(d1 * d2, 0.25)) * Math.abs(Math.sin(k * (d1 + d2 - dDir))) * dphi * 100, 0.55); } }
    mapImg = lab.heatImage(d, W, Hh, 0, 1.9, mapImg);
  }
  const cvPlan = lab.canvas(figPlan.body, (c, w, hh, dpr) => {
    tr.s = Math.min(w / (V.x1 - V.x0), hh / (V.y1 - V.y0)); tr.ox = (w - (V.x1 - V.x0) * tr.s) / 2; tr.oy = hh - (hh - (V.y1 - V.y0) * tr.s) / 2;
    const S = tr.s; paintMap(w, hh, dpr);
    c.drawImage(mapImg, 0, 0, w, hh);
    const wy = toS([0, WALL_Y])[1]; c.fillStyle = lab.tok('--bg-1'); c.fillRect(0, wy, w, hh - wy);
    c.fillStyle = lab.tok('--bg-4'); c.fillRect(0, wy - 3, w, 6); c.strokeStyle = lab.tok('--line-3'); c.strokeRect(-1, Math.round(wy) - 3.5, w + 2, 7);
    lab.label(c, 'wall', w - 10, wy + 14, { align: 'right', color: lab.tok('--text-3') });
    const a = toS([REGION.x0, REGION.y1]), b = toS([REGION.x1, REGION.y0]); c.setLineDash([4, 4]); c.strokeStyle = lab.rgba('--text', 0.35); c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); c.setLineDash([]);
    lab.label(c, 'search region', a[0] + 5, a[1] + 10, { color: lab.tok('--text-2'), bg: true });
    const T = toS(TX), R = toS(rxNow()), P = toS(st.p), cur = link(TX, rxNow(), st.p, st.chestMm);
    lab.line(c, [T, R], lab.tok('--accent'), 1.6); lab.line(c, [T, P, R], lab.rgba('--person', 0.9), 1.2, [3, 3]);
    c.fillStyle = lab.tok('--text'); c.beginPath(); c.arc(T[0], T[1], 4.5, 0, 7); c.fill(); lab.label(c, 'Probe radio, at the doorway', Math.max(T[0], 78), T[1] + 16, { align: 'center', color: lab.tok('--text') });
    // rover and its stops
    c.fillStyle = lab.tok('--bg-5'); c.strokeStyle = lab.tok('--accent'); c.lineWidth = 1.5; c.beginPath(); c.roundRect(R[0] - 0.17 * S, R[1] - 0.06 * S, 0.34 * S, 0.44 * S, 2); c.fill(); c.stroke();
    for (let i = 0; i < st.stops; i++) { const q = toS(rxAt(i)); c.fillStyle = i === st.stop ? lab.tok('--accent') : lab.rgba('--accent', 0.35); c.fillRect(q[0] - 1, q[1] - 7, 2, 14); }
    c.fillStyle = lab.tok('--accent'); c.beginPath(); c.arc(R[0], R[1], 3.5, 0, 7); c.fill();
    lab.label(c, 'HOUND-01, stop ' + (st.stop + 1) + ' of ' + st.stops + ' (' + (st.stop * STEP * 100).toFixed(1) + ' cm)', R[0] + 0.2 * S + 4, R[1] + 0.46 * S + 2, { color: lab.tok('--accent-2') });
    // person
    c.fillStyle = lab.rgba('--person', 0.22); c.strokeStyle = lab.tok('--person'); c.lineWidth = 1.5; c.beginPath(); c.ellipse(P[0], P[1] - 0.11 * S, 0.24 * S, 0.12 * S, 0, 0, 7); c.fill(); c.stroke();
    c.beginPath(); c.arc(P[0], P[1] - 0.11 * S, 0.09 * S, 0, 7); c.fillStyle = lab.rgba('--person', 0.55); c.fill(); c.stroke();
    c.fillStyle = lab.tok('--text'); c.beginPath(); c.arc(P[0], P[1], 2.5, 0, 7); c.fill();
    lab.label(c, 'zone ' + cur.zone + ' · echo ' + cur.excess.toFixed(2) + ' m longer', P[0] + 0.28 * S + 4, P[1] - 0.11 * S, { color: lab.tok('--person'), bg: true });
    // magnifier on the chest: the bands at true scale against the chest's travel
    const mz = 14, mr = Math.min(86, hh * 0.2, w * 0.15), mx = w - mr - 14, my = mr + (ctx.mode === 'demo' ? 64 : 14), rx = rxNow(), dDir = Math.hypot(rx[0] - TX[0], rx[1] - TX[1]), kk = (2 * Math.PI) / LAMBDA;
    c.save(); c.beginPath(); c.arc(mx, my, mr, 0, 7); c.clip(); c.fillStyle = lab.tok('--bg-0'); c.fillRect(mx - mr, my - mr, 2 * mr, 2 * mr);
    const cell = 3; for (let j = -mr; j < mr; j += cell) for (let i = -mr; i < mr; i += cell) { const x = st.p[0] + i / (S * mz), y = st.p[1] - j / (S * mz), d1 = Math.hypot(x - TX[0], y - TX[1]), d2 = Math.hypot(x - rx[0], y - rx[1]), v = Math.abs(Math.sin(kk * (d1 + d2 - dDir))), col = lab.ramp(0.08 + 0.8 * v); c.fillStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')'; c.fillRect(mx + i, my + j, cell, cell); }
    // the chest moves along the bisector of the two legs, toward the radios
    const u1 = [TX[0] - st.p[0], TX[1] - st.p[1]], u2 = [rx[0] - st.p[0], rx[1] - st.p[1]], n1 = Math.hypot(...u1), n2 = Math.hypot(...u2), bis = [u1[0] / n1 + u2[0] / n2, u1[1] / n1 + u2[1] / n2], bn = Math.hypot(...bis), ux = bis[0] / bn, uy = bis[1] / bn, pm = S * mz / 1000;
    const half = st.chestMm / 2; c.strokeStyle = lab.tok('--text'); c.lineWidth = 1; c.beginPath(); c.moveTo(mx - ux * half * pm, my + uy * half * pm); c.lineTo(mx + ux * half * pm, my - uy * half * pm); c.stroke();
    const cm = chestNow(); c.fillStyle = lab.tok('--text'); c.beginPath(); c.arc(mx + ux * cm * pm, my - uy * cm * pm, 4, 0, 7); c.fill(); c.strokeStyle = lab.tok('--bg-0'); c.stroke();
    c.restore(); c.strokeStyle = lab.tok('--text-2'); c.lineWidth = 1; c.beginPath(); c.arc(mx, my, mr, 0, 7); c.stroke();
    lab.line(c, [[mx - mr * 0.72, my + mr * 0.7], [P[0] + 4, P[1] - 4]], lab.rgba('--text', 0.4), 1);
    lab.label(c, 'the chest, ' + mz + ' times larger', mx, my + mr + 11, { align: 'center', color: lab.tok('--text-2'), bg: true }); lab.label(c, 'white bar: ' + st.chestMm.toFixed(0) + ' mm of travel', mx, my + mr + 26, { align: 'center', color: lab.tok('--text-3'), bg: true });
    // scale
    c.strokeStyle = lab.tok('--text-3'); c.beginPath(); c.moveTo(12.5, hh - 16); c.lineTo(12.5, hh - 10); c.moveTo(12, hh - 12.5); c.lineTo(12 + S, hh - 12.5); c.moveTo(12.5 + S, hh - 16); c.lineTo(12.5 + S, hh - 10); c.stroke(); lab.label(c, '1 m', 12 + S / 2, hh - 22, { align: 'center', font: '500 10.5px ' + lab.tok('--mono'), color: lab.tok('--text-3') });
  }, { label: 'Plan of the link with the bands where breathing is visible' });

  // ---------- phasor ----------
  const cvPh = lab.canvas(figPh.body, (c, w, hh) => {
    const cur = link(TX, rxNow(), st.p, st.chestMm), D = Math.min(w * 0.5, 300), r = Math.min(hh * 0.3, 84), MAG = r / (cur.ratio * D), ox = Math.max(24, (w - D - r) / 2 - 10), oy = hh * 0.6;
    const ang0 = -cur.phase, swing = cur.dphi * (chestNow() / st.chestMm), ang = ang0 - swing;      // echo lags as the path grows
    c.strokeStyle = lab.tok('--line-2'); c.setLineDash([2, 4]); c.beginPath(); c.moveTo(ox - 14, oy); c.lineTo(w - 10, oy); c.stroke(); c.setLineDash([]);
    const tip = [ox + D, oy], arrowTo = (x0, y0, x1, y1, col, wd) => { const a = Math.atan2(y1 - y0, x1 - x0); c.strokeStyle = c.fillStyle = col; c.lineWidth = wd; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.beginPath(); c.moveTo(x1, y1); c.lineTo(x1 - 9 * Math.cos(a - 0.38), y1 - 9 * Math.sin(a - 0.38)); c.lineTo(x1 - 9 * Math.cos(a + 0.38), y1 - 9 * Math.sin(a + 0.38)); c.closePath(); c.fill(); };
    arrowTo(ox, oy, tip[0], tip[1], lab.tok('--accent'), 2); lab.label(c, 'straight path', ox + D * 0.3, oy + 14, { color: lab.tok('--accent-2') });
    // the arc the echo sweeps in one breath, and its shadow on the long arrow
    const a0 = ang0 - cur.dphi / 2, a1 = ang0 + cur.dphi / 2; c.strokeStyle = lab.rgba('--person', 0.35); c.lineWidth = 7; c.beginPath(); c.arc(tip[0], tip[1], r, Math.min(-a0, -a1), Math.max(-a0, -a1)); c.stroke();
    let lo = Infinity, hi = -Infinity; for (let k = 0; k <= 16; k++) { const x = Math.cos(a0 + ((a1 - a0) * k) / 16); lo = Math.min(lo, x); hi = Math.max(hi, x); }
    c.fillStyle = lab.tok('--text'); c.fillRect(tip[0] + lo * r, oy - 3, Math.max(1.5, (hi - lo) * r), 6);
    const e = [tip[0] + r * Math.cos(ang), tip[1] - r * Math.sin(ang)]; arrowTo(tip[0], tip[1], e[0], e[1], lab.tok('--person'), 2);
    c.setLineDash([2, 3]); lab.line(c, [e, [e[0], oy]], lab.rgba('--text', 0.45), 1, [2, 3]); c.setLineDash([]);
    arrowTo(ox, oy, e[0], e[1], lab.rgba('--text', 0.55), 1);
    const quad = Math.abs(Math.sin(cur.phase));
    lab.label(c, 'echo', e[0] + (Math.cos(ang) >= 0 ? 8 : -8), e[1] + (Math.sin(ang) >= 0 ? -8 : 10), { align: Math.cos(ang) >= 0 ? 'left' : 'right', color: lab.tok('--person') });
    lab.label(c, 'what the receiver measures', ox + 4, oy - Math.max(16, Math.abs(e[1] - oy) * 0.35) - 4, { color: lab.tok('--text-3') });
    lab.label(c, 'echo drawn ' + MAG.toFixed(0) + ' times longer than it is', ox + D * 0.3, oy + 30, { color: lab.tok('--text-3') });
    const word = quad > 0.92 ? 'At right angles: breathing changes the strength most.' : quad < 0.3 ? 'In line: the strength barely changes.' : 'In between: part of the swing shows.';
    lab.label(c, word, 12, 16, { color: quad > 0.92 ? lab.tok('--ok') : quad < 0.3 ? lab.tok('--warn') : lab.tok('--text-2'), font: '600 12px ' + lab.tok('--font') });
    lab.label(c, 'echo angle ' + ((((cur.phase * 180) / Math.PI) % 360 + 360) % 360).toFixed(0) + '°, swing ' + ((cur.dphi * 180) / Math.PI).toFixed(0) + '° per breath', 12, 33, { font: '500 10.5px ' + lab.tok('--mono'), color: lab.tok('--text-3') });
  }, { label: 'Phasor diagram of the straight path and the echo' });

  // ---------- ripple at each stop ----------
  const noiseSeq = Array.from({ length: 8 }, (_, i) => { const R = lab.rng(101 + i); return Float32Array.from({ length: 100 }, () => R.normal()); });
  const cvStops = lab.canvas(figStops.body, (c, w, hh) => {
    const n = st.stops, gap = 8, x0 = 44, cw = (w - x0 - 10 - gap * (n - 1)) / n, y0 = 30, ph = hh - y0 - 44, links = Array.from({ length: n }, (_, i) => L(i));
    const top = Math.max(1.2, ...links.map((l) => l.sens * 100)) * 1.25, best = links.reduce((b, l, i) => (l.sens > links[b].sens ? i : b), 0);
    c.font = '500 10.5px ' + lab.tok('--mono');
    for (let i = 0; i < n; i++) {
      const l = links[i], x = x0 + i * (cw + gap), on = i === st.stop, ok = detectable(l.sens), Y = (v) => y0 + ph / 2 - (v / top) * (ph / 2);
      c.fillStyle = on ? lab.rgba('--accent', 0.07) : 'transparent'; c.fillRect(x, y0, cw, ph); c.strokeStyle = on ? lab.tok('--accent') : lab.tok('--line-2'); c.lineWidth = 1; c.strokeRect(Math.round(x) + 0.5, y0 + 0.5, Math.round(cw), ph);
      c.fillStyle = lab.rgba('--text-3', 0.14); c.fillRect(x + 1, Y(NOISE * 100), cw - 2, Y(-NOISE * 100) - Y(NOISE * 100));
      const pts = [], dots = []; for (let k = 0; k < 100; k++) { const t = (k / 100) * 10, p2 = 2 * Math.PI * (st.bpm / 60) * t, s = (Math.sin(p2) + 0.25 * Math.sin(2 * p2 + 0.8)) / 1.19, v = l.ratio * (Math.cos(l.phase + (l.dphi * s) / 2) - Math.cos(l.phase)) * 100; pts.push([x + (k / 99) * cw, Y(v)]); dots.push([x + (k / 99) * cw, Y(v + noiseSeq[i][k] * NOISE * 100)]); }
      c.fillStyle = lab.rgba('--text-2', 0.6); for (const d of dots) c.fillRect(d[0] - 0.75, d[1] - 0.75, 1.5, 1.5);
      lab.line(c, pts, ok ? lab.tok('--person') : lab.tok('--text-3'), 1.6);
      if (on) { const xp = x + ((tNow % 10) / 10) * cw; lab.line(c, [[xp, y0], [xp, y0 + ph]], lab.rgba('--text', 0.5), 1); }
      lab.label(c, (cw < 92 ? '' : 'Stop ') + (i + 1), x + 5, y0 - 10, { color: on ? lab.tok('--text') : lab.tok('--text-3'), font: '600 11px ' + lab.tok('--font') });
      lab.label(c, (i * STEP * 100).toFixed(1) + ' cm', x + cw - 4, y0 - 10, { align: 'right', font: '500 10.5px ' + lab.tok('--mono'), color: lab.tok('--text-3') });
      const snr = l.sens / NOISE; lab.label(c, snr.toFixed(1) + '× noise', x + 5, y0 + ph + 13, { font: '500 10.5px ' + lab.tok('--mono'), color: ok ? lab.tok('--ok') : lab.tok('--text-3') });
      lab.label(c, ok ? (i === best ? 'shows best' : 'it shows') : 'lost in the noise', x + 5, y0 + ph + 28, { color: ok ? lab.tok('--ok') : lab.tok('--text-3') });
    }
    c.fillStyle = lab.tok('--text-3'); c.textAlign = 'right'; c.textBaseline = 'middle'; for (const v of [top / 1.25, 0, -top / 1.25]) c.fillText((v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1), x0 - 6, y0 + ph / 2 - (v / top) * (ph / 2));
    lab.label(c, '%', x0 - 6, y0 - 10, { align: 'right', color: lab.tok('--text-3') });
  }, { label: 'Breathing ripple at each dither stop' });

  // ---------- Monte Carlo ----------
  const cvMc = lab.canvas(figMc.body, (c, w, hh) => {
    const names = ['One spot, no dither', 'Four stops, 3.1 cm apart', 'Eight stops'], x0 = 168, x1 = w - 64, rowH = Math.min(34, (hh - 42) / 3), y0 = 24 + (hh - 42 - rowH * 3) / 2, X = (v) => x0 + (x1 - x0) * (v / 0.5);
    c.strokeStyle = lab.tok('--line'); c.fillStyle = lab.tok('--text-3'); c.font = '500 10.5px ' + lab.tok('--mono'); c.textAlign = 'center'; c.textBaseline = 'top';
    for (const v of [0, 0.1, 0.2, 0.3, 0.4, 0.5]) { const x = Math.round(X(v)) + 0.5; c.beginPath(); c.moveTo(x, y0 - 4); c.lineTo(x, y0 + rowH * 3); c.stroke(); c.fillText(v * 100 + ' %', x, y0 + rowH * 3 + 4); }
    for (let i = 0; i < 3; i++) {
      const y = y0 + i * rowH + 5, bh = Math.max(5, rowH - 12), v = mc ? mc.p[i] : 0;
      lab.label(c, names[i], x0 - 10, y + bh / 2, { align: 'right', color: lab.tok('--text') });
      c.fillStyle = lab.tok('--bg-4'); c.fillRect(x0, y, x1 - x0, bh);
      if (mc) { c.fillStyle = i === 0 ? lab.tok('--text-3') : lab.tok('--accent'); c.fillRect(x0, y, X(v) - x0, bh); lab.label(c, (v * 100).toFixed(1) + ' %', bh < 14 ? x1 + 8 : X(v) - 7, y + bh / 2, { align: bh < 14 ? 'left' : 'right', font: (bh < 14 ? '500 10px ' : '500 12px ') + lab.tok('--mono'), color: lab.tok(bh < 14 ? '--text' : '--bg-0') }); }
      const px = Math.round(X(PROJECT[i])) + 0.5; c.strokeStyle = lab.tok('--text'); c.lineWidth = 1.5; c.beginPath(); c.moveTo(px, y - 4); c.lineTo(px, y + bh + 4); c.stroke();
    }
    lab.label(c, 'Share of still people whose breathing would show' + (mc ? ' · ' + (mcJob ? 'running, ' : '') + mc.n.toLocaleString('en-US') + ' placed' : ''), 12, 13, { color: lab.tok('--text-3') });
  }, { label: 'Share of still people detectable with and without the dither' });
  function runMc(total = 4000) {
    const R = lab.rng(5 + Math.floor(Math.random() * 1e6)); mc = { p: [0, 0, 0], n: 0 }; mcJob = { R, total, acc: [0, 0, 0] };
    if (lab.reducedMotion()) { while (mcJob) stepMc(); cvMc.redraw(); } else run.start();
  }
  function stepMc() {
    const J = mcJob; if (!J) return; const chunk = Math.min(160, J.total - mc.n), r = monteCarlo(J.R, chunk);
    for (let i = 0; i < 3; i++) J.acc[i] += r[i] * chunk; mc.n += chunk; mc.p = J.acc.map((v) => v / mc.n);
    if (mc.n >= J.total) { mcJob = null; mcStat.set((mc.p[1] / Math.max(mc.p[0], 1e-9)).toFixed(2), 'ok'); }
  }

  // ---------- controls and read-outs ----------
  const angStat = lab.stat('Echo angle from best', '°', { title: '0° means the echo is at right angles to the straight path, where breathing shows most. 90° is the blind spot.' }), ratioStat = lab.stat('Echo vs straight path', '%');
  const modStat = lab.stat('Breathing ripple', '%'), snrStat = lab.stat('Ripple over noise', '×', { title: 'The project counts a stop as detectable at 1.5 or more' });
  const bestStat = lab.stat('Best stop here'), stepStat = lab.stat('Echo turns per step', '°', { title: 'How far one 3.1 cm step turns the echo for this person. 90° would be ideal.' }), mcStat = lab.stat('Dither gain, 4 stops', '×', { title: 'Share detectable with four stops over the share from one spot, in the run above' });
  function readouts() {
    const links = Array.from({ length: st.stops }, (_, i) => L(i)), cur = links[st.stop], best = links.reduce((b, l, i) => (l.sens > links[b].sens ? i : b), 0);
    const off = Math.abs(90 - (((cur.phase * 180) / Math.PI) % 180 + 180) % 180);
    angStat.set(off.toFixed(0), off < 25 ? 'ok' : off > 65 ? 'warn' : ''); ratioStat.set((cur.ratio * 100).toFixed(2)); modStat.set((cur.sens * 100).toFixed(2), detectable(cur.sens) ? 'person' : '');
    snrStat.set((cur.sens / NOISE).toFixed(2), detectable(cur.sens) ? 'ok' : 'warn'); bestStat.set('stop ' + (best + 1) + (detectable(links[best].sens) ? '' : ', still lost'), detectable(links[best].sens) ? 'ok' : 'warn');
    const dph = st.stops > 1 ? ((((links[1].phase - links[0].phase) * 180) / Math.PI) % 360 + 540) % 360 - 180 : 0; stepStat.set(lab.sgn(dph, 0));
    nudgeBack.disabled = st.stop === 0; nudgeFwd.disabled = st.stop === st.stops - 1;
    figStops.setTitle(detectable(links[best].sens) ? (detectable(links[0].sens) ? 'Breathing already shows at the first stop' : 'Invisible at stop 1. At stop ' + (best + 1) + ' the breathing comes out of the noise.') : 'For this person no stop is enough: the echo is too weak');
  }
  const go = (i) => { st.stop = lab.clamp(i, 0, st.stops - 1); readouts(); redraw(); if (lab.reducedMotion()) { st.offset = st.stop * STEP; redraw(); } };
  const nudgeBack = h('button.btn.btn-sm', { type: 'button', 'aria-label': 'Slide back 3.1 centimetres', onclick: () => go(st.stop - 1) }, icon('arrow-left'), '3.1 cm');
  const nudgeFwd = h('button.btn.btn-primary.btn-sm', { type: 'button', 'aria-label': 'Slide on 3.1 centimetres', onclick: () => go(st.stop + 1) }, 'Slide 3.1 cm', icon('arrow-right'));
  const bestBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => { const ls = Array.from({ length: st.stops }, (_, i) => L(i).sens); go(ls.indexOf(Math.max(...ls))); } }, 'Go to the best stop');
  side.append(
    lab.group('Slide the receiver',
      h('div.radio-row', null, nudgeBack, nudgeFwd, bestBtn),
      h('div.radio-row', null, h('span.radio-row-label', null, 'Stops per station'), lab.seg([[4, 'Four'], [8, 'Eight']], st.stops, (v) => { st.stops = +v; st.stop = Math.min(st.stop, st.stops - 1); readouts(); redraw(); }, { label: 'Stops per station' })),
      lab.toggle('Run the dither by itself', st.auto, (on) => { st.auto = on; autoT = 0; }, { title: 'On the rover each stop lasts about 3 s. Here it is the same.' }),
      h('p.dim', null, 'A quarter wavelength at 2.437 GHz is ' + (STEP * 100).toFixed(2) + ' cm. The rover’s mecanum wheels let it move sideways without turning.')),
    lab.group('At this stop', h('div.radio-stats', null, modStat, snrStat, angStat, ratioStat, bestStat, stepStat)),
    lab.group('The person',
      lab.slider({ label: 'Chest travel', min: 2, max: 12, step: 0.5, value: st.chestMm, format: (v) => v.toFixed(1) + ' mm', oninput: (v) => { st.chestMm = v; readouts(); redraw(); }, title: 'The project’s model uses 5 mm' }),
      lab.slider({ label: 'Breathing', min: 7, max: 30, step: 1, value: st.bpm, format: (v) => v + ' /min', oninput: (v) => { st.bpm = v; redraw(); } }),
      h('div.radio-row', null, h('button.btn.btn-sm', { type: 'button', onclick: () => { const R = lab.rng(Math.floor(Math.random() * 1e9)); st.p = [R.range(REGION.x0, REGION.x1), R.range(REGION.y0, REGION.y1)]; readouts(); redraw(); } }, 'Somewhere else'), h('span.kbd-hint', null, 'or drag, or focus the plan and use the arrow keys'))),
    lab.group('Over many people',
      h('div.radio-row', null, h('button.btn.btn-sm', { type: 'button', onclick: () => runMc(4000) }, 'Place 4,000 people'), h('div.radio-stats', { style: { flex: '1' } }, mcStat)),
      h('p.dim', null, 'The dither about doubles the chance, and still leaves most still people to the radar. Sensitivity falls with distance, so the project drops the transmitter as far along the wall as the room allows.')));

  function redraw() { cvPlan.redraw(); cvPh.redraw(); cvStops.redraw(); }
  // drag the person
  const el = cvPlan.el; let drag = false; el.tabIndex = 0;
  const fromS = (ev) => { const r = el.getBoundingClientRect(); return [V.x0 + (ev.clientX - r.left - tr.ox) / tr.s, V.y0 + (tr.oy - (ev.clientY - r.top)) / tr.s]; };
  const setP = (p) => { st.p = [lab.clamp(p[0], -1.9, 2.0), lab.clamp(p[1], 0.55, 3.6)]; readouts(); redraw(); };
  el.addEventListener('pointerdown', (ev) => { const p = fromS(ev); if (p[1] < WALL_Y + 0.1) return; drag = true; el.setPointerCapture(ev.pointerId); el.style.cursor = 'grabbing'; setP(p); });
  el.addEventListener('pointermove', (ev) => { if (drag) setP(fromS(ev)); else el.style.cursor = fromS(ev)[1] > WALL_Y + 0.1 ? 'grab' : ''; });
  const up = () => { drag = false; el.style.cursor = ''; }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('keydown', (ev) => { const d = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, 0.01], ArrowDown: [0, -0.01] }[ev.key]; if (!d) return; ev.preventDefault(); const k = ev.shiftKey ? 10 : 1; setP([st.p[0] + d[0] * k, st.p[1] + d[1] * k]); });

  const run = lab.loop((t, dt) => {
    tNow += dt;
    const target = st.stop * STEP; if (Math.abs(st.offset - target) > 2e-4) st.offset += (target - st.offset) * Math.min(1, dt * 9); else st.offset = target;
    if ((st.auto || ctx.mode === 'demo') && !drag) { autoT += dt; if (autoT > 3) { autoT = 0; go((st.stop + 1) % st.stops); } }
    if (mcJob) { stepMc(); cvMc.redraw(); }
    redraw();
  });
  // start on a person the first stop cannot see and a later stop can: the case the dither exists for
  search: for (let y = 0.95; y < 1.6; y += 0.013) for (let x = 0.15; x < 0.8; x += 0.017) { const s = [0, 1, 2, 3].map((i) => link(TX, rxAt(i), [x, y]).sens / NOISE); if (s[0] < 0.35 && Math.max(s[1], s[2]) > 2.6) { st.p = [x, y]; break search; } }
  readouts(); runMc(4000);
  return {
    onShow() { mapKey = ''; readouts(); redraw(); cvMc.redraw(); run.start(); },
    onHide() { run.stop(); },
    debug: { st, link: L, get mc() { return mc; }, go },
  };
}
