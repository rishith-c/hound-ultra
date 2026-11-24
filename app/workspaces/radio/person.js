// Exhibit 02. A person in the channel: a body as a set of reflecting points, the few millimetres a chest moves,
// and the real network's answer to a 10 s window synthesised here.
// The synthesiser follows the rover project's ml/simulate_csi.py (same channel equation, constants and ESP32 faults)
// and ml/csi_window.py (same windowing and normalisation), with a much simpler body. It is a demonstration.
import * as rf from './rf.js';
import { SUB, C0, F0, DF, LAMBDA } from './lab.js';

export const meta = {
  title: 'A person in the channel',
  labels: ['live-ai', { text: 'Simulated person', cls: 'tag-sim', title: 'The body, the room and the radio faults are synthesised in this page. No recording of a real person exists in this project.' }],
  labelNote: 'The network is HOUND’s real one, running now. Its input is synthesised in this page: a demonstration, not an evaluation.',
  plain: [
    'A body behind a wall adds a faint echo to the Wi-Fi signal. When the chest rises a few millimetres the echo’s phase turns, and the received strength changes by a fraction of a percent.',
    'That change is smaller than the radio’s own noise. Below, a 10 second window with a person you place is synthesised and handed to HOUND’s real network.',
  ],
  cites: [
    { by: 'Wang et al.', year: 2016, title: 'Human respiration detection with commodity WiFi devices: do user location and body orientation matter?', venue: 'ACM UbiComp', url: 'https://doi.org/10.1145/2971648.2971744' },
    { by: 'HOUND rover project', year: 2026, title: 'ml/simulate_csi.py and ml/csi_window.py: the channel simulator and windowing the network was trained with. Measured on 955 simulated test windows: moving person found 86.9 %, still person 21.4 %' },
  ],
  honest: 'The network has only ever seen simulated people. For this to hold in a building, real recordings must look like the simulator’s windows, and nobody has checked that yet.',
  unknown: 'how a real wet wall, a real ESP32 and a real trapped person differ from this model.',
};

const BODY = 0.15, REF_AREA = 0.30, WALL_LOSS = 0.5;                         // simulate_csi.py / fresnel.py
const PKT_HZ = 100, SECONDS = 10, HZ = 20, N_T = 200, AGC_STEP = 0.04, MAX_EMPTY = 0.35;
const TX = [74.7, 49.5, 0.80], RX = [74.7, 51.0, 0.45], WALL_X = 75;         // the training layout, laid on the wall between rooms 111 and 112
const REGION = { x0: 75.5, x1: 78.2, y0: 50.0, y1: 52.5 };                   // where the training simulator put people
const ROOM = { x0: 75.42, x1: 79.1, y0: 48.5, y1: 53.5 };
const DK = (2 * Math.PI * DF) / C0, KC = (2 * Math.PI * F0) / C0;
const ROW = new Map(SUB.map((s, i) => [s, i]));                              // subcarrier number -> network row

// ---- the body: surface points in the body's own frame (it faces -x, toward the wall) ----
function buildBody(posture) {
  const P = []; const add = (x, y, z, n, area, part) => P.push({ x, y, z, n, area, part });
  if (posture === 'standing') {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) add(-0.11, -0.135 + c * 0.09, 0.97 + r * 0.12, [-1, 0, 0], 0.0108, 0);
    for (let r = 0; r < 3; r++) for (const s of [-1, 1]) add(0, s * 0.19, 1.02 + r * 0.17, [0, s, 0], 0.02, 0);
    for (const a of [-1.2, -0.6, 0, 0.6, 1.2]) add(-0.09 * Math.cos(a), 0.09 * Math.sin(a), 1.6, [-Math.cos(a), Math.sin(a), 0], 0.012, 1);
    for (const s of [-1, 1]) for (let r = 0; r < 5; r++) add(-0.03, s * 0.26, 0.85 + r * 0.13, [-0.8, s * 0.6, 0], 0.008, 2);
    for (const s of [-1, 1]) for (let r = 0; r < 6; r++) add(-0.06, s * 0.1, 0.1 + r * 0.15, [-1, 0, 0], 0.012, 3);
  } else {                                                                   // lying on the back, along the wall
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) add(-0.135 + c * 0.09, -0.05 + r * 0.12, 0.22, [0, 0, 1], 0.0108, 0);
    for (let r = 0; r < 5; r++) add(-0.19, -0.05 + r * 0.12, 0.12, [-1, 0, 0], 0.015, 0);
    for (const n of [[-1, 0, 0], [0, 0, 1], [0, 1, 0]]) add(n[0] * 0.09, 0.68 + n[1] * 0.09, 0.12 + n[2] * 0.09, n, 0.012, 1);
    for (const s of [-1, 1]) for (let r = 0; r < 4; r++) add(s * 0.26, -0.05 + r * 0.15, 0.08, [s < 0 ? -0.8 : 0.3, 0, 0.6], 0.008, 2);
    for (const s of [-1, 1]) for (let r = 0; r < 6; r++) add(s * 0.1, -0.2 - r * 0.14, 0.1, s < 0 ? [-0.7, 0, 0.7] : [0, 0, 1], 0.012, 3);
  }
  return P;
}
function smoothNoise(R, n, dt, tau) { const a = Math.exp(-dt / tau), s = Math.sqrt(1 - a * a), x = new Float64Array(n); x[0] = R.normal(); for (let i = 1; i < n; i++) x[i] = a * x[i - 1] + s * R.normal(); return x; }

// ---- one recording: the channel packet by packet, then the ESP32, then the network's window ----
// who: 'empty' | 'still' | 'moving'. Returns everything the figures need.
export function synthesise(o, staticH, lab, seed) {
  const R = lab.rng(seed), n = Math.round((SECONDS + 0.5) * PKT_HZ), stretch = 1 + R.range(-0.02, 0.02), dt = stretch / PKT_HZ;
  const t = Float64Array.from({ length: n }, (_, i) => i * dt);
  const Hre = new Float64Array(n * 51), Him = new Float64Array(n * 51);
  for (let i = 0; i < n; i++) for (let k = 0; k < 51; k++) { Hre[i * 51 + k] = staticH.re[k]; Him[i * 51 + k] = staticH.im[k]; }
  const cx = new Float32Array(n).fill(o.pos[0]), cy = new Float32Array(n).fill(o.pos[1]), chest = new Float32Array(n);
  let ratio = 0, excess = 0;
  const addReflector = (i, px, py, pz, amp) => {
    const d = Math.hypot(px - TX[0], py - TX[1], pz - TX[2]) + Math.hypot(px - RX[0], py - RX[1], pz - RX[2]);
    let cr = Math.cos(KC * d), ci = -Math.sin(KC * d); const sr = Math.cos(DK * d), si = -Math.sin(DK * d);
    // subcarrier s has wavenumber KC + s * DK: walk s upward from 0, then downward from 0
    let ur = cr, ui = ci;
    for (let s = 1; s <= 26; s++) { const nr = ur * sr - ui * si; ui = ur * si + ui * sr; ur = nr; const row = ROW.get(s); if (row !== undefined) { Hre[i * 51 + row] += amp * ur; Him[i * 51 + row] += amp * ui; } }
    ur = cr; ui = ci;
    for (let s = -1; s >= -26; s--) { const nr = ur * sr + ui * si; ui = ui * sr - ur * si; ur = nr; const row = ROW.get(s); Hre[i * 51 + row] += amp * ur; Him[i * 51 + row] += amp * ui; }
    return d;
  };
  if (o.who !== 'empty') {
    const pts = buildBody(o.posture), lying = o.posture === 'lying';
    // breathing: uneven breaths, rate wandering 8 %, plus the heartbeat
    const wander = smoothNoise(R, n, dt, 8), ph0 = R.range(0, 6.283), shape = new Float64Array(n); let ph = ph0, mx = 0;
    for (let i = 0; i < n; i++) { ph += 2 * Math.PI * (o.bpm / 60) * (1 + 0.08 * wander[i]) * dt; shape[i] = Math.sin(ph) + 0.25 * Math.sin(2 * ph + 0.8); mx = Math.max(mx, Math.abs(shape[i])); }
    const hr = R.range(55, 110) / 60, hamp = R.range(0.1, 0.4) / 1000, hph = R.range(0, 6.3);
    for (let i = 0; i < n; i++) chest[i] = ((o.depthMm / 1000) / 2) * (shape[i] / mx) + hamp * Math.sin(2 * Math.PI * hr * t[i] + hph) ** 3;
    const swayX = lying ? null : smoothNoise(R, n, dt, 2), swayY = lying ? null : smoothNoise(R, n, dt, 2);
    let walk = null, limb = null;
    if (o.who === 'moving' && !lying) {
      const v = R.range(0.3, 1.0), head = R.range(-Math.PI, Math.PI), step = R.range(1.6, 2.2); let x = o.pos[0], y = o.pos[1], vx = v * Math.cos(head), vy = v * Math.sin(head);
      for (let i = 0; i < n; i++) { x += vx * dt; y += vy * dt; if (x < REGION.x0 || x > REGION.x1) { vx = -vx; x = lab.clamp(x, REGION.x0, REGION.x1); } if (y < REGION.y0 || y > REGION.y1) { vy = -vy; y = lab.clamp(y, REGION.y0, REGION.y1); } cx[i] = x; cy[i] = y; }
      walk = { head, step };
    } else if (o.who === 'moving') {
      const f = R.range(0.4, 2.0), burst = smoothNoise(R, n, dt, 1.5), a0 = R.range(0.05, 0.2), dir = [R.normal(), R.normal(), R.normal()], dl = Math.hypot(...dir);
      limb = { f, burst, a0, dir: dir.map((v) => v / dl), on: pts.map((p) => (p.part === 2 || p.part === 3) && R() < 0.5) };
    }
    let rsum = 0, esum = 0, wsum = 0;
    for (let i = 0; i < n; i++) {
      for (let q = 0; q < pts.length; q++) {
        const p = pts[q]; let dx = 0, dy = 0, dz = 0;
        if (p.part === 0) { dx += p.n[0] * chest[i]; dy += p.n[1] * chest[i]; dz += p.n[2] * chest[i]; }
        if (swayX) { dx += 0.003 * swayX[i]; dy += 0.003 * swayY[i]; }
        if (walk) { dz += 0.02 * Math.sin(2 * Math.PI * walk.step * t[i]); if (p.part >= 2) { const sidev = Math.sign(p.x * -Math.sin(walk.head) + p.y * Math.cos(walk.head) + 1e-9), sw = 0.15 * Math.sin(Math.PI * walk.step * t[i]) * sidev; dx += sw * Math.cos(walk.head); dy += sw * Math.sin(walk.head); } }
        if (limb && limb.on[q]) { const a = limb.a0 * Math.sin(2 * Math.PI * limb.f * t[i]) * (limb.burst[i] > -0.3 ? 1 : 0); dx += a * limb.dir[0]; dy += a * limb.dir[1]; dz += a * limb.dir[2]; }
        const px = cx[i] + p.x + dx, py = cy[i] + p.y + dy, pz = Math.max(0.02, p.z + dz);
        const v1 = [px - TX[0], py - TX[1], pz - TX[2]], v2 = [px - RX[0], py - RX[1], pz - RX[2]], d1 = Math.hypot(...v1), d2 = Math.hypot(...v2);
        const facing = Math.max(0, -(p.n[0] * (v1[0] / d1 + v2[0] / d2) + p.n[1] * (v1[1] / d1 + v2[1] / d2) + p.n[2] * (v1[2] / d1 + v2[2] / d2)) / 2);
        const amp = ((BODY * p.area * facing) / REF_AREA / Math.max(d1 * d2, 0.25)) * (px > WALL_X ? WALL_LOSS : 1);
        if (amp > 0) { const d = addReflector(i, px, py, pz, amp); if (i === 0) { rsum += amp; esum += amp * d; wsum += amp; } }
      }
    }
    ratio = rsum / Math.hypot(staticH.re[25], staticH.im[25]); excess = wsum ? esum / wsum - Math.hypot(TX[0] - RX[0], TX[1] - RX[1], TX[2] - RX[2]) : 0;
  }
  if (o.fan) {                                                               // an oscillating desk fan: a slow swinging reflector
    const c = [77.4, 49.3, 0.8], period = R.range(6, 16), r = R.range(0.1, 0.25), p0 = R.range(0, 6.3), bf = R.range(8, 20);
    const a = (R.range(0.02, 0.08) / Math.max(Math.hypot(c[0] - TX[0], c[1] - TX[1], c[2] - TX[2]) * Math.hypot(c[0] - RX[0], c[1] - RX[1], c[2] - RX[2]), 0.25)) * WALL_LOSS;
    for (let i = 0; i < n; i++) { const ang = (35 * Math.PI / 180) * Math.sin((2 * Math.PI * t[i]) / period + p0), bl = 0.004 * Math.sin(2 * Math.PI * bf * t[i]); addReflector(i, c[0] + r * Math.sin(ang) + bl / 2, c[1] + r * Math.cos(ang), c[2], a); }
  }
  // what the receiver would report with no faults at all (for the "how little it changes" figure)
  const clean = new Float32Array(n * 51); let meanAmp = 0;
  for (let i = 0; i < n * 51; i++) { clean[i] = Math.hypot(Hre[i], Him[i]); meanAmp += clean[i]; } meanAmp /= n * 51;
  // ---- the ESP32: gain steps and drift, ripple, int8 I/Q with noise, lost packets, jitter (simulate_csi.esp32) ----
  let g0 = (R.range(0.7, 1.4) * 30) / meanAmp; const driftT = R.range(60, 300), driftP = R.range(0, 6.3);
  const steps = []; { let tj = 0; for (let k = 0; k < 5; k++) { tj += -20 * Math.log(1 - R()); steps.push([tj, R.range(0.8, 1.25)]); } }
  const lossP = R.range(0.02, 0.15), bursts = Array.from({ length: Math.floor(R() * 3) }, () => { const a = R.range(0, t[n - 1]); return [a, a + R.range(0.1, 0.6)]; });
  const ta = [], amp = []; let agcSeen = 0;
  for (let i = 0; i < n; i++) {
    let g = g0 * (1 + 0.015 * Math.sin((2 * Math.PI * t[i]) / driftT + driftP)); for (const [tj, f] of steps) if (t[i] >= tj) { g *= f; }
    const lost = R() <= lossP || bursts.some(([a, b]) => t[i] > a && t[i] < b);
    const row = new Float32Array(51);
    for (let k = 0; k < 51; k++) { const s = g * RIPPLE[k], I = lab.clamp(Math.round(Hre[i * 51 + k] * s + 0.15 * R.normal()), -127, 127), Q = lab.clamp(Math.round(Him[i * 51 + k] * s + 0.15 * R.normal()), -127, 127); row[k] = Math.hypot(I, Q); }
    if (!lost) { ta.push(t[i] + R.range(0, 0.004)); amp.push(row); }
  }
  for (const [tj] of steps) if (tj < t[n - 1]) agcSeen++;
  const W = toWindow(ta, amp, ta[0] + SECONDS + 0.2); if (!W) return null;
  const x = normalise(W);
  // clean reference, binned and normalised the same way
  const cb = Array.from({ length: 51 }, () => new Float32Array(N_T)), cnt = new Float32Array(N_T), tEnd = ta[0] + SECONDS + 0.2;
  for (let i = 0; i < n; i++) { const b = Math.floor((t[i] - (tEnd - SECONDS)) * HZ); if (b < 0 || b >= N_T) continue; cnt[b]++; for (let k = 0; k < 51; k++) cb[k][b] += clean[i * 51 + k]; }
  let sig = 0, noise = 0, best = 0, bestV = -1;
  for (let k = 0; k < 51; k++) {
    let m = 0, c = 0; for (let b = 0; b < N_T; b++) if (cnt[b]) { cb[k][b] /= cnt[b]; m += cb[k][b]; c++; } m /= c;
    let v = 0, e = 0, em = 0; for (let b = 0; b < N_T; b++) { cb[k][b] = cnt[b] ? 100 * (cb[k][b] / m - 1) : 0; v += cb[k][b] ** 2; em += x[k][b] - cb[k][b]; }
    em /= N_T; for (let b = 0; b < N_T; b++) e += (x[k][b] - cb[k][b] - em) ** 2;
    v = Math.sqrt(v / N_T); sig += v; noise += Math.sqrt(e / N_T); if (v > bestV) { bestV = v; best = k; }
  }
  return { x, clean: cb, sigPct: sig / 51, noisePct: noise / 51, best, ratio, excess, cx, cy, chest, dt, n, lost: 1 - ta.length / n, agcSeen, t0: tEnd - SECONDS };
}
// the receiver's own frequency response: fixed for this radio
const RIPPLE = (() => { let a = 3; const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; const g = Array.from({ length: 57 }, () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(6.2832 * r())); return Array.from({ length: 51 }, (_, k) => 1 + (0.1 * g.slice(k, k + 7).reduce((s, v) => s + v, 0)) / 7); })();

// csi_window.to_window: AGC steps out, 20 bins a second, a motion row from the packets inside each bin.
export function toWindow(t, amp, tEnd) {
  const n = t.length, g = new Float64Array(n); let stepSum = 0, prev = 0;
  for (let i = 0; i < n; i++) { let m = 0; for (let k = 0; k < 51; k++) m += amp[i][k]; g[i] = Math.log(Math.max(m / 51, 1e-6)); }
  const a = amp.map((row, i) => { const d = i ? g[i] - prev : 0; prev = g[i]; if (Math.abs(d) > AGC_STEP) stepSum += d; const f = Math.exp(-stepSum); return row.map((v) => v * f); });
  const kb = t.map((ti) => Math.floor((ti - (tEnd - SECONDS)) * HZ)), mean = new Float64Array(51); let used = 0;
  for (let i = 0; i < n; i++) if (kb[i] >= 0 && kb[i] < N_T) { used++; for (let k = 0; k < 51; k++) mean[k] += a[i][k]; }
  if (!used) return null; for (let k = 0; k < 51; k++) mean[k] = Math.max(mean[k] / used, 1e-6);
  const s = Array.from({ length: 51 }, () => new Float64Array(N_T)), s1 = Array.from({ length: 51 }, () => new Float64Array(N_T)), sq = Array.from({ length: 51 }, () => new Float64Array(N_T)), c = new Float64Array(N_T);
  for (let i = 0; i < n; i++) { const b = kb[i]; if (b < 0 || b >= N_T) continue; c[b]++; for (let k = 0; k < 51; k++) { const v = a[i][k], r = v / mean[k]; s[k][b] += v; s1[k][b] += r; sq[k][b] += r * r; } }
  let have = 0; for (let b = 0; b < N_T; b++) if (c[b] > 0) have++;
  if (have / N_T < 1 - MAX_EMPTY) return null;
  const motion = new Float64Array(N_T);
  for (let b = 0; b < N_T; b++) { if (!c[b]) continue; let sd = 0; for (let k = 0; k < 51; k++) { s[k][b] /= c[b]; const m = s1[k][b] / c[b]; sd += Math.sqrt((Math.max(0, sq[k][b] / c[b] - m * m) * c[b]) / Math.max(c[b] - 1, 1)); } motion[b] = c[b] > 1 ? (100 * sd) / 51 : 0; }
  let first = 0; while (first < N_T && !c[first]) first++;
  for (let b = 0, last = first; b < N_T; b++) { if (c[b]) last = b; const src = b < first ? first : last; if (src !== b) { for (let k = 0; k < 51; k++) s[k][b] = s[k][src]; motion[b] = motion[src]; } }
  return [...s, motion];
}
// csi_window.normalise: each subcarrier as % change from its own mean; the motion row in %, less 1 %.
export function normalise(W) {
  const out = [];
  for (let k = 0; k < 51; k++) { let m = 0; for (let b = 0; b < N_T; b++) m += W[k][b]; m = Math.max(m / N_T, 1e-6); out.push(Array.from(W[k], (v) => Math.max(-50, Math.min(50, 100 * (v / m - 1))))); }
  out.push(Array.from(W[51], (v) => Math.max(-5, Math.min(50, v - 1))));
  return out;
}

export async function create(stage, side, ctx, lab) {
  const { h, icon } = lab, nn = ctx.nn;
  const scene = rf.buildScene(ctx.world);
  const st = { who: 'still', posture: 'standing', pos: [76.6, 51.2], depthMm: 6, bpm: 15, fan: false, auto: true };
  const paths = rf.tracePaths(scene, TX, RX, { order: 3 }), direct = paths.find((p) => p.kind === 'direct');
  const staticH = rf.channel(paths, 0.8 / Math.hypot(direct.a[0], direct.a[1]));       // the simulator's units: straight path about 0.8
  let cur = null, out = null, seed = 1, playT = 0, history = [], tally = new Map(), batch = 0;
  const SPEED = 2.5;

  // ---------- figures ----------
  const figPlan = lab.figure('The rover listens through the wall of Classroom 112', { tag: h('span.tag.tag-sim', null, 'Simulated room'), caption: 'Plan view, to scale. Radio positions are the layout the network was trained on. Drag the person.' });
  const figTrace = lab.figure('How little a person changes the signal', { caption: 'One subcarrier over the 10 s window. Line: the channel alone. Dots: what the ESP32 model reports, 20 bins a second.' });
  const figWin = lab.figure('What the network is given: 51 subcarriers and a motion row, 10 s', { caption: 'Each subcarrier as % change from its own mean (ml/csi_window.py).' });
  const verdict = h('div.radio-person-verdict');
  const figV = lab.figure('The real network’s answer', { tag: ctx.kit.realityTag('live-ai') }); figV.body.append(verdict);
  stage.append(h('div.radio-grid.radio-person-grid', null, figPlan, figTrace, figV, figWin));

  const tr = { sx: 1, ox: 0, oy: 0 };
  const VIEW = { y0: 48.2, y1: 53.8, x0: 73.82, x1: 78.75 };                 // building metres: y runs across the screen, x up
  const toS = (p) => [tr.ox + (p[1] - VIEW.y0) * tr.sx, tr.oy - (p[0] - VIEW.x0) * tr.sx];
  const cvPlan = lab.canvas(figPlan.body, (c, w, hh) => {
    tr.sx = Math.min(w / (VIEW.y1 - VIEW.y0), hh / (VIEW.x1 - VIEW.x0)); tr.ox = (w - (VIEW.y1 - VIEW.y0) * tr.sx) / 2; tr.oy = hh - (hh - (VIEW.x1 - VIEW.x0) * tr.sx) / 2;
    const S = tr.sx, m = (v) => v * S;
    // floor grid, 0.5 m
    c.strokeStyle = lab.tok('--line'); c.lineWidth = 1; c.beginPath();
    for (let y = Math.ceil(VIEW.y0 * 2) / 2; y <= VIEW.y1; y += 0.5) { const [x] = toS([0, y]); c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, hh); }
    for (let x = Math.ceil(VIEW.x0 * 2) / 2; x <= VIEW.x1; x += 0.5) { const [, y] = toS([x, 0]); c.moveTo(0, Math.round(y) + 0.5); c.lineTo(w, Math.round(y) + 0.5); }
    c.stroke();
    // the wall
    const [wx0, wy] = toS([WALL_X, VIEW.y0]), [wx1] = toS([WALL_X, VIEW.y1]), th = Math.max(4, m(0.1));
    c.fillStyle = lab.tok('--bg-4'); c.fillRect(0, wy - th / 2, w, th); c.strokeStyle = lab.tok('--line-3'); c.strokeRect(-1, Math.round(wy - th / 2) + 0.5, w + 2, Math.round(th));
    lab.label(c, 'Plasterboard partition', w - 10, wy - th / 2 - 9, { align: 'right', color: lab.tok('--text-3') });
    lab.label(c, 'Classroom 112', 10, 14, { color: lab.tok('--text-2') }); lab.label(c, 'Classroom 111, rover side', 10, wy + th / 2 + 11, { color: lab.tok('--text-2') });
    // trained region
    const a = toS([REGION.x1, REGION.y0]), b = toS([REGION.x0, REGION.y1]); c.setLineDash([4, 4]); c.strokeStyle = lab.tok('--line-3'); c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); c.setLineDash([]);
    lab.label(c, 'training region', a[0] + 5, a[1] + 10, { color: lab.tok('--text-3') });
    // static link
    const T = toS(TX), Rr = toS(RX);
    lab.line(c, [T, Rr], lab.tok('--accent'), 1.6);
    // body
    const i = cur ? Math.min(cur.n - 1, Math.floor(playT / cur.dt)) : 0, px = cur ? cur.cx[i] : st.pos[0], py = cur ? cur.cy[i] : st.pos[1], P = toS([px, py]);
    if (st.who !== 'empty') {
      const inRegion = px >= REGION.x0 - 0.01 && px <= REGION.x1 + 0.01 && py >= REGION.y0 - 0.01 && py <= REGION.y1 + 0.01;
      const chestPt = toS([px - (st.posture === 'standing' ? 0.11 : 0.19), py + (st.posture === 'standing' ? 0 : 0.2)]);
      c.setLineDash([2, 3]); lab.line(c, [T, chestPt, Rr], lab.rgba('--person', 0.75), 1.2, [2, 3]); c.setLineDash([]);
      c.fillStyle = lab.rgba('--person', 0.16); c.strokeStyle = lab.tok('--person'); c.lineWidth = 1.5;
      if (st.posture === 'standing') { c.beginPath(); c.ellipse(P[0], P[1], m(0.24), m(0.12), 0, 0, 7); c.fill(); c.stroke(); c.beginPath(); c.arc(P[0], P[1], m(0.09), 0, 7); c.fillStyle = lab.rgba('--person', 0.5); c.fill(); c.stroke(); }
      else { const hd = toS([px, py + 0.68]); c.beginPath(); c.roundRect(P[0] - m(0.95), P[1] - m(0.2), m(1.5), m(0.4), m(0.18)); c.fill(); c.stroke(); c.beginPath(); c.arc(hd[0], hd[1], m(0.1), 0, 7); c.fillStyle = lab.rgba('--person', 0.5); c.fill(); c.stroke(); }
      const pts = bodyPts[st.posture]; c.fillStyle = lab.tok('--person'); for (const q of pts) { const s = toS([px + q.x, py + q.y]); c.fillRect(s[0] - 1, s[1] - 1, 2, 2); }
      lab.label(c, (st.who === 'moving' ? 'Moving' : 'Still') + ', ' + st.posture + (inRegion ? '' : ' · outside the trained region'), P[0] + m(0.3) + 4, P[1] - m(0.2) - 6, { color: inRegion ? lab.tok('--person') : lab.tok('--warn'), bg: true });
      if (cur && cur.excess) lab.label(c, 'echo travels ' + cur.excess.toFixed(2) + ' m further: ' + (cur.excess / LAMBDA).toFixed(1) + ' wavelengths', (chestPt[0] + T[0]) / 2 + 8, (chestPt[1] + T[1]) / 2, { color: lab.tok('--text-2'), bg: true });
      // the chest, magnified
      if (st.who === 'still' && cur) {
        const bx = w - 190, by = wy + th / 2 + 12, mm = cur.chest[i] * 1000, half = Math.max(1, st.depthMm / 2);
        c.fillStyle = lab.rgba('--bg-0', 0.82); c.fillRect(bx - 8, by - 6, 190, 50); c.strokeStyle = lab.tok('--line-2'); c.strokeRect(bx - 7.5, by - 5.5, 189, 49);
        lab.label(c, 'Chest wall, drawn 12×', bx, by + 5, { color: lab.tok('--text-2') }); lab.label(c, lab.sgn(mm, 1) + ' mm', bx + 174, by + 5, { align: 'right', font: '500 11px ' + lab.tok('--mono'), color: lab.tok('--text') });
        const pxmm = 12 * (S / 1000), mid = bx + 87; c.strokeStyle = lab.tok('--line-3'); c.beginPath(); c.moveTo(mid - half * pxmm, by + 17); c.lineTo(mid - half * pxmm, by + 37); c.moveTo(mid + half * pxmm, by + 17); c.lineTo(mid + half * pxmm, by + 37); c.stroke();
        c.fillStyle = lab.tok('--person'); c.fillRect(mid + mm * pxmm - 1.5, by + 15, 3, 24);
      }
    }
    if (st.fan) { const F = toS([77.4, 49.3]); c.strokeStyle = lab.tok('--text-2'); c.beginPath(); c.arc(F[0], F[1], m(0.16), 0, 7); c.stroke(); lab.label(c, 'Desk fan, swinging', F[0] + m(0.2) + 3, F[1], { color: lab.tok('--text-2'), bg: true }); }
    // radios
    c.fillStyle = lab.tok('--text'); c.beginPath(); c.arc(T[0], T[1], 4.5, 0, 7); c.fill(); lab.label(c, 'Probe radio', T[0], T[1] + 15, { align: 'center', color: lab.tok('--text') });
    c.fillStyle = lab.tok('--bg-5'); c.strokeStyle = lab.tok('--accent'); c.lineWidth = 1.5; c.beginPath(); c.roundRect(Rr[0] - m(0.17), Rr[1] - m(0.05), m(0.34), m(0.44), 2); c.fill(); c.stroke();
    c.fillStyle = lab.tok('--accent'); c.beginPath(); c.arc(Rr[0], Rr[1], 4, 0, 7); c.fill(); lab.label(c, 'HOUND-01 receiver', Rr[0], Rr[1] + m(0.39) + 11, { align: 'center', color: lab.tok('--accent-2') });
    lab.label(c, '1.5 m', (T[0] + Rr[0]) / 2, T[1] - 8, { align: 'center', font: '500 10.5px ' + lab.tok('--mono'), color: lab.tok('--text-3') });
    // scale bar
    c.strokeStyle = lab.tok('--text-3'); c.beginPath(); c.moveTo(12, hh - 12.5); c.lineTo(12 + m(1), hh - 12.5); c.moveTo(12.5, hh - 16); c.lineTo(12.5, hh - 9); c.moveTo(12.5 + m(1), hh - 16); c.lineTo(12.5 + m(1), hh - 9); c.stroke(); lab.label(c, '1 m', 12 + m(0.5), hh - 21, { align: 'center', font: '500 10.5px ' + lab.tok('--mono'), color: lab.tok('--text-3') });
  }, { label: 'Plan of the link through the wall and the person behind it' });
  const bodyPts = { standing: buildBody('standing'), lying: buildBody('lying') };

  const cvTrace = lab.canvas(figTrace.body, (c, w, hh) => {
    if (!cur) return; const k = cur.best, cl = cur.clean[k], nz = cur.x[k];
    let ext = 1.2; for (let b = 0; b < N_T; b++) ext = Math.max(ext, Math.abs(nz[b]), Math.abs(cl[b])); ext = Math.min(50, Math.ceil(ext * 1.1 * 2) / 2);
    const tick = ext > 20 ? 10 : ext > 8 ? 5 : ext > 3 ? 2 : ext > 1.5 ? 1 : 0.5, yt = []; for (let v = -Math.floor(ext / tick) * tick; v <= ext + 1e-9; v += tick) yt.push(+v.toFixed(2));
    const S = lab.plot(c, { x: 44, y: 16, w: w - 58, h: hh - 52, xd: [0, 10], yd: [-ext, ext], xt: [0, 2, 4, 6, 8, 10], yt, xl: 'time in the window, s', yl: 'change from the mean, %', ylx: 38, yf: (v) => (v > 0 ? '+' : '') + v });
    const band = cur.noisePct; c.fillStyle = lab.rgba('--text-3', 0.13); c.fillRect(44, S.Y(band), w - 58, S.Y(-band) - S.Y(band));
    lab.label(c, 'radio noise, ±' + band.toFixed(2) + ' % (1 standard deviation per bin)', w - 18, S.Y(band) - 8, { align: 'right', color: lab.tok('--text-3'), bg: true });
    c.fillStyle = lab.rgba('--text-2', 0.75); for (let b = 0; b < N_T; b++) { const y = S.Y(nz[b]); if (y > 16 && y < hh - 36) c.fillRect(S.X((b + 0.5) / HZ) - 1, y - 1, 2, 2); }
    lab.line(c, Array.from(cl, (v, b) => [S.X((b + 0.5) / HZ), S.Y(v)]), lab.tok(st.who === 'empty' ? '--accent' : '--person'), 1.8);
    const xp = S.X(Math.min(10, Math.max(0, playT - cur.t0))); lab.line(c, [[xp, 16], [xp, hh - 36]], lab.rgba('--text', 0.5), 1);
    lab.label(c, 'subcarrier ' + (SUB[k] > 0 ? '+' : '') + SUB[k], 50, 26, { color: lab.tok('--text-3'), bg: true });
  }, { label: 'Signal change over the window, clean and as received' });

  let winImg = null, motImg = null, winExt = 1;
  const DISPLAY_ROWS = SUB.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map((p) => p[1]);     // +26 at the top
  function paintWindow() {
    if (!out) return; const x = cur.x; let ext = 0.8; const vals = []; for (let k = 0; k < 51; k += 3) for (let b = 0; b < N_T; b += 2) vals.push(Math.abs(x[k][b])); vals.sort((a, b) => a - b); ext = Math.max(ext, vals[Math.floor(vals.length * 0.98)]); winExt = ext;
    const d = new Float32Array(51 * N_T); DISPLAY_ROWS.forEach((row, j) => { for (let b = 0; b < N_T; b++) d[j * N_T + b] = x[row][b]; });
    winImg = lab.heatImage(d, N_T, 51, -ext, ext, winImg); motImg = lab.heatImage(Float32Array.from(x[51]), N_T, 1, -1, Math.max(3, ...x[51]), motImg);
  }
  const cvWin = lab.canvas(figWin.body, (c, w, hh) => {
    if (!winImg) return; const x0 = 44, x1 = w - 62, y0 = 12, y1 = hh - 58, my = hh - 48;
    c.imageSmoothingEnabled = false; c.drawImage(winImg, x0, y0, x1 - x0, y1 - y0); c.drawImage(motImg, x0, my, x1 - x0, 12);
    c.strokeStyle = lab.tok('--line-2'); c.strokeRect(x0 - 0.5, y0 - 0.5, x1 - x0 + 1, y1 - y0 + 1); c.strokeRect(x0 - 0.5, my - 0.5, x1 - x0 + 1, 13);
    const f = '500 10.5px ' + lab.tok('--mono');
    lab.label(c, '+26', x0 - 6, y0 + 5, { align: 'right', font: f, color: lab.tok('--text-3') }); lab.label(c, '−26', x0 - 6, y1 - 5, { align: 'right', font: f, color: lab.tok('--text-3') }); lab.label(c, 'motion', x0 - 6, my + 6, { align: 'right', color: lab.tok('--text-3') });
    for (const t of [0, 2, 4, 6, 8, 10]) lab.label(c, String(t), x0 + ((x1 - x0) * t) / 10, my + 22, { align: 'center', font: f, color: lab.tok('--text-3') });
    lab.label(c, 'time, s', x1, my + 36, { align: 'right', color: lab.tok('--text-3') }); lab.label(c, 'subcarrier', x0, my + 36, { color: lab.tok('--text-3') });
    // colour key
    const kx = w - 44, lut = lab.rampLut(); for (let j = 0; j < y1 - y0; j++) { const i = Math.round((1 - j / (y1 - y0)) * 255) * 3; c.fillStyle = 'rgb(' + lut[i] + ',' + lut[i + 1] + ',' + lut[i + 2] + ')'; c.fillRect(kx, y0 + j, 8, 1.5); }
    lab.label(c, '+' + winExt.toFixed(1) + ' %', kx + 12, y0 + 5, { font: f, color: lab.tok('--text-3') }); lab.label(c, '−' + winExt.toFixed(1) + ' %', kx + 12, y1 - 5, { font: f, color: lab.tok('--text-3') });
    const xp = x0 + ((x1 - x0) * Math.min(10, Math.max(0, playT - cur.t0))) / 10; lab.line(c, [[xp, y0], [xp, my + 12]], lab.rgba('--text', 0.7), 1);
  }, { label: 'The normalised window given to the network' });

  // ---------- verdict ----------
  const vBig = h('b.radio-person-p', null, '–'), vWord = h('span.radio-person-word', null, ''), vTruth = h('p.radio-person-truth', null, '');
  const vMeter = h('div.meter-wrap', { style: { '--mark': nn.threshold } }, h('div.meter.lg'));
  vMeter.style.setProperty('--mark', String(nn.threshold));
  const vMove = h('span.num', null, '–'), vMs = h('span.num', null, '–'), vHist = h('div.radio-person-hist', { role: 'img' }), vTally = h('p.radio-person-tally', null, '');
  verdict.append(
    h('div.radio-person-main', null, h('div', null, h('span.caption', null, 'P(person)'), vBig), h('div.radio-person-call', null, vWord, vTruth)),
    h('div.radio-person-meter', null, vMeter, h('span.caption', null, 'alarm threshold ' + nn.threshold.toFixed(2) + ', set on validation so at most 10 % of empty rooms raise it')),
    h('dl.kv.num.radio-person-kv', null, h('dt', null, 'P(moving), if someone is there'), h('dd', null, vMove), h('dt', null, 'Window built and network run'), h('dd', null, vMs)),
    h('div', null, h('span.caption', null, 'Last windows with this set-up (new noise and breathing each time)'), vHist, vTally));

  const sigStat = lab.stat('Person changes the signal by', '%', { title: 'Root-mean-square change of the fault-free channel over the window, mean over subcarriers' }), noiseStat = lab.stat('Radio’s own noise', '% per bin', { title: 'What the ESP32 model adds to each 50 ms bin, mean over subcarriers' });
  const snrStat = lab.stat('Signal over noise', '×'), ratioStat = lab.stat('Echo vs straight path', '%', { title: 'Summed amplitude of the body’s reflections over the straight path' });
  const lossStat = lab.stat('Packets lost', '%'), agcStat = lab.stat('Gain steps removed');
  const condKey = () => (st.who === 'empty' ? (st.fan ? 'Empty room, fan running' : 'Empty room') : (st.who === 'moving' ? 'Moving' : 'Still') + ', ' + st.posture + (st.fan ? ', fan running' : ''));
  const tallyBody = h('tbody');
  function listen() {
    const t0 = performance.now(); let rec = null;
    for (let tries = 0; tries < 4 && !rec; tries++) rec = synthesise(st, staticH, lab, 7919 * seed++ + 13);
    if (!rec) return;
    const res = nn.infer(rec.x); cur = rec; out = { ...res, ms: performance.now() - t0, says: res.person > nn.threshold };
    playT = rec.t0; paintWindow();
    const truth = st.who !== 'empty', key = condKey(); history.push(out.says); if (history.length > 36) history.shift();
    const row = tally.get(key) || { n: 0, said: 0, truth }; row.n++; row.said += out.says ? 1 : 0; tally.set(key, row);
    vBig.textContent = out.person.toFixed(2); vBig.dataset.on = String(out.says); vWord.textContent = out.says ? 'Person' : 'No one'; vWord.dataset.on = String(out.says);
    vTruth.textContent = truth ? (out.says ? 'Correct: you put a ' + (st.who === 'moving' ? 'moving' : 'still') + ' person there.' : 'Missed: a ' + (st.who === 'moving' ? 'moving' : 'still') + ' person is there.') : out.says ? 'False alarm: the room is empty.' : 'Correct: the room is empty.';
    vTruth.dataset.ok = String(truth === out.says);
    vMeter.firstChild.style.setProperty('--v', out.person.toFixed(3)); vMeter.firstChild.className = 'meter lg ' + (out.says ? 'person' : '');
    vMove.textContent = truth ? out.moving.toFixed(2) + (out.moving > 0.5 ? ' (moving)' : ' (still)') : 'not applicable'; vMs.textContent = out.ms.toFixed(0) + ' ms';
    vHist.replaceChildren(...history.map((s) => h('i', { 'data-on': String(s) }))); vHist.setAttribute('aria-label', history.filter(Boolean).length + ' of the last ' + history.length + ' windows were called person');
    vTally.textContent = 'Called person in ' + row.said + ' of ' + row.n + ' windows. ' + (truth ? '' : 'Every one of those is a false alarm.');
    sigStat.set(rec.sigPct.toFixed(2), st.who === 'empty' ? '' : 'person'); noiseStat.set(rec.noisePct.toFixed(2)); snrStat.set((rec.sigPct / rec.noisePct).toFixed(2), rec.sigPct > rec.noisePct ? 'ok' : 'warn');
    ratioStat.set(st.who === 'empty' ? '0' : (100 * rec.ratio).toFixed(1)); lossStat.set((100 * rec.lost).toFixed(0)); agcStat.set(String(rec.agcSeen));
    figTrace.setTitle(st.who === 'empty' ? 'An empty room: only the radio’s noise' + (st.fan ? ' and the fan' : '') : 'The person moves the signal by ' + rec.sigPct.toFixed(2) + ' %. The radio’s own noise is ' + rec.noisePct.toFixed(2) + ' %.');
    tallyBody.replaceChildren(...[...tally].map(([k, r]) => h('tr', { 'aria-selected': String(k === key) }, h('td', null, k), h('td.num', null, r.said + ' / ' + r.n), h('td', null, r.truth ? 'found' : 'false alarms'))));
    cvTrace.redraw(); cvWin.redraw(); cvPlan.redraw();
  }
  function changed() { history = []; listen(); }

  // ---------- controls ----------
  const batchBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => { batch = 20; run.start(); if (lab.reducedMotion()) { while (batch-- > 0) listen(); batch = 0; } } }, 'Run 20 windows');
  side.append(
    lab.group('Put someone in the room',
      h('div.radio-row', null, h('span.radio-row-label', null, 'In Classroom 112'), lab.seg([['empty', 'Nobody'], ['still', 'Still'], ['moving', 'Moving']], st.who, (v) => { st.who = v; changed(); }, { label: 'Who is in the room' })),
      h('div.radio-row', null, h('span.radio-row-label', null, 'Posture'), lab.seg([['standing', 'Standing'], ['lying', 'Lying']], st.posture, (v) => { st.posture = v; changed(); }, { label: 'Posture' })),
      lab.slider({ label: 'Chest travel', min: 0, max: 12, step: 0.5, value: st.depthMm, format: (v) => v.toFixed(1) + ' mm', oninput: (v) => { st.depthMm = v; changed(); }, title: 'Peak to peak. The training simulator used 4 to 12 mm.' }),
      lab.slider({ label: 'Breathing', min: 7, max: 30, step: 1, value: st.bpm, format: (v) => v + ' /min', oninput: (v) => { st.bpm = v; changed(); } }),
      lab.toggle('A desk fan swinging in the room (a decoy)', st.fan, (on) => { st.fan = on; changed(); }),
      h('div.radio-row', null, h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => listen() }, icon('wifi'), 'Listen again'), batchBtn, lab.toggle('Keep listening', st.auto, (on) => { st.auto = on; }))),
    lab.group('This window', h('div.radio-stats', null, sigStat, noiseStat, snrStat, ratioStat, lossStat, agcStat),
      h('p.dim', null, 'The rover project measured 0.05 to 0.4 % for breathing against about 0.5 % of noise per bin. This is why a still person is the hard case.')),
    lab.group('Tally in this session', h('table.table.dense.radio-twin-table', null, h('thead', null, h('tr', null, h('th', null, 'Set-up'), h('th.num', null, 'Called person'), h('th', null, ''))), tallyBody),
      h('div.note.quiet', null, icon('info'), h('span', null, h('b', null, 'A demonstration, not an evaluation. '), 'This page’s synthesiser is a simplified cousin of the Python simulator the network was trained on: one 70-point body instead of 900 Blender people, and a traced room instead of random echoes. The measured results are on the Wi-Fi AI page.')),
      h('button.btn.btn-sm', { type: 'button', onclick: () => ctx.shell.open('sense', { view: 'test' }) }, 'Open the measured test set', icon('arrow-right'))));

  // ---------- drag the person ----------
  const el = cvPlan.el; let drag = false;
  const fromS = (ev) => { const r = el.getBoundingClientRect(); return [VIEW.x0 + (tr.oy - (ev.clientY - r.top)) / tr.sx, VIEW.y0 + (ev.clientX - r.left - tr.ox) / tr.sx]; };
  el.addEventListener('pointerdown', (ev) => { if (st.who === 'empty') return; const p = fromS(ev); if (Math.hypot(p[0] - st.pos[0], p[1] - st.pos[1]) > 1.1) return; drag = true; el.setPointerCapture(ev.pointerId); el.style.cursor = 'grabbing'; });
  el.addEventListener('pointermove', (ev) => { const p = fromS(ev); if (!drag) { el.style.cursor = st.who !== 'empty' && Math.hypot(p[0] - st.pos[0], p[1] - st.pos[1]) < 1.1 ? 'grab' : ''; return; } st.pos = [lab.clamp(p[0], ROOM.x0, ROOM.x1), lab.clamp(p[1], ROOM.y0, ROOM.y1)]; if (cur) { cur.cx.fill(st.pos[0]); cur.cy.fill(st.pos[1]); } cvPlan.redraw(); });
  const up = () => { if (!drag) return; drag = false; el.style.cursor = ''; changed(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.tabIndex = 0; el.addEventListener('keydown', (ev) => { const d = { ArrowLeft: [0, -0.1], ArrowRight: [0, 0.1], ArrowUp: [0.1, 0], ArrowDown: [-0.1, 0] }[ev.key]; if (!d || st.who === 'empty') return; ev.preventDefault(); st.pos = [lab.clamp(st.pos[0] + d[0], ROOM.x0, ROOM.x1), lab.clamp(st.pos[1] + d[1], ROOM.y0, ROOM.y1)]; changed(); });

  const run = lab.loop((t, dt) => {
    if (batch > 0) { batch--; listen(); batchBtn.textContent = batch ? batch + ' to go…' : 'Run 20 windows'; return; }
    if (!cur || drag) return;
    playT += dt * SPEED;
    if (playT > cur.t0 + SECONDS) { if (st.auto) listen(); else playT = cur.t0; }
    cvPlan.redraw(); cvTrace.redraw(); cvWin.redraw();
  });
  listen();
  return {
    onShow() { paintWindow(); cvPlan.redraw(); cvTrace.redraw(); cvWin.redraw(); run.start(); },
    onHide() { run.stop(); batch = 0; batchBtn.textContent = 'Run 20 windows'; },
    debug: { st, listen, get out() { return out; }, get cur() { return cur; }, tally },
  };
}
