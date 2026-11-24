// The Demo's network chapter: a wall, a person, one Wi-Fi signal and the real network, drawn flat.
// Every dot, line and number comes from app/core/nn.js running the bundled test windows (data/nn.json).
import { loadNN } from '../../core/nn.js';

const SERIF = '"Instrument Serif", HSerif, serif', SANS = '"Instrument Sans", HSans, sans-serif';
const BLUE = '90,169,255', ICE = '196,222,255', AMBER = '255,178,82', TXT = '242,245,248', DIM = '142,156,171';
const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), ease = (x) => { x = cl(x); return x * x * (3 - 2 * x); }, out = (x) => 1 - Math.pow(1 - cl(x), 3), ramp = (t, a, b) => ease((t - a) / (b - a)), mix = (a, b, k) => a + (b - a) * k;
const pct = (p) => p >= 0.995 ? '100' : p < 0.005 ? '0' : String(Math.round(p * 100));


export function createFlat(host, nn, { ms = '1.1', dpr = 2, onPick = null } = {}) {
  const c = document.createElement('canvas'), g = c.getContext('2d'); let DPR = dpr; c.className = 'nf-canvas'; c.width = 1920 * DPR; c.height = 1000 * DPR;
  const bar = document.createElement('div'); bar.className = 'nf-ledger'; host.append(c, bar);
  // the five examples: real held-out windows of the bundled test set, in the order they are shown
  const EX = [
    { i: 15, t0: 0.0, name: 'Walking', title: ['Someone is walking', ', 3.1 m behind the wall'], kind: 'walk', fill: [1.5, 3.4], net: [3.0, 4.9], end: 6.6 },
    { i: 0, t0: 6.6, name: 'Empty room', title: ['The same room', ', with no one in it'], kind: 'none', fill: [7.0, 7.9], net: [7.7, 8.6], end: 9.6 },
    { i: 15, t0: 9.6, name: 'The first one again', title: ['Ask it again', ', get the same answer'], kind: 'walk', fill: [10.0, 10.7], net: [10.5, 11.3], end: 12.3 },
    { i: 7, t0: 12.3, name: 'A fan', title: ['A fan moves too.', ' It is not a person'], kind: 'fan', fill: [12.8, 13.6], net: [13.4, 14.3], end: 15.5 },
    { i: 22, t0: 15.5, name: 'Standing still', title: ['The hard one:', ' a person who does not move'], kind: 'still', fill: [16.0, 16.9], net: [16.7, 17.7], end: 99 },
  ].map((e) => ({ ...e, r: nn.inferSample(e.i, { trace: true }), x: nn.samples[e.i].x }));

  // layers as columns of dots; conv layers are summarised by each filter's mean over time
  const mean = (r) => r.reduce((a, b) => a + b, 0) / r.length;
  const LX = [985, 1112, 1239, 1366, 1493, 1620], LN = [24, 24, 24, 48, 32, 2];
  const W = nn.weights, strength = (Wt, k, C, F) => Array.from({ length: C }, (_, a) => Array.from({ length: F }, (_, f) => { let s = 0; for (let j = 0; j < k; j++) s += Wt[a * k + j][f]; return s; }));
  const S01 = strength(W[2], 9, 24, 24), S12 = strength(W[4], 9, 24, 24), S34 = W[6], S45 = [W[8], W[10]];
  for (const e of EX) {
    const L = e.r.layers, norm = (v) => { const m = Math.max(1e-6, ...v); return v.map((x) => x / m); };
    e.a = [norm(L.c1.map(mean)), norm(L.c2.map(mean)), norm(L.c3.map(mean)), [...norm(L.feat.slice(0, 24)), ...norm(L.feat.slice(24))], norm(L.hidden), [e.r.person, e.r.moving]];
    const pick = (A, B, w, n) => { const all = []; for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) all.push([i, j, A[i] * w(i, j) * (0.25 + B[j])]); all.sort((p, q) => Math.abs(q[2]) - Math.abs(p[2])); const m = Math.abs(all[0][2]) || 1; return all.slice(0, n).map((q) => [q[0], q[1], q[2] / m]); };
    e.w = [pick(e.a[0], e.a[1], (i, j) => S01[i][j], 150), pick(e.a[1], e.a[2], (i, j) => S12[i][j], 150),
      [...Array(24).keys()].flatMap((i) => [[i, i, e.a[2][i] * e.a[3][i]], [i, 24 + i, e.a[2][i] * e.a[3][24 + i]]]),
      pick(e.a[3], e.a[4], (i, j) => S34[i][j], 170), pick(e.a[4], e.a[5], (i, j) => S45[j][i][1] - S45[j][i][0], 64)];
    const cv = document.createElement('canvas'); cv.width = 200; cv.height = 52; const q = cv.getContext('2d'), id = q.createImageData(200, 52);
    let m = 1e-6; for (const r of e.x) for (const v of r) m = Math.max(m, Math.abs(v)); m = Math.min(m, 3);
    for (let y = 0; y < 52; y++) for (let x = 0; x < 200; x++) { const v = cl(e.x[y][x] / m, -1, 1), k = Math.abs(v), o = (y * 200 + x) * 4, hot = v > 0; id.data[o] = hot ? mix(14, 255, k ** 0.8) : mix(14, 40, k); id.data[o + 1] = hot ? mix(20, 196, k ** 0.9) : mix(20, 118, k ** 0.8); id.data[o + 2] = hot ? mix(30, 112, k) : mix(30, 235, k ** 0.75); id.data[o + 3] = 255; }
    q.putImageData(id, 0, 0); e.img = cv;
    // how much the signal shakes from one moment to the next: it drives the rings in the picture
    e.move = Array.from({ length: 200 }, (_, t) => { let s = 0; for (let y = 0; y < 52; y++) s += Math.abs(e.x[y][t] - e.x[y][Math.max(0, t - 1)]); return s / 52; });
  }
  const shakeMax = Math.max(...EX.flatMap((e) => e.move));

  const dotXY = (l, i) => {
    if (l === 3) return [LX[3] + (i < 24 ? -13 : 13), 478 + ((i % 24) - 11.5) * 20.4];
    if (l === 4) return [LX[4], 478 + (i - 15.5) * 15.3];
    if (l === 5) return [LX[5], 478 + (i - 0.5) * 190];
    return [LX[l], 478 + (i - 11.5) * 20.4];
  };
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  function text(s, x, y, font, col, al = 'left', a = 1) { g.globalAlpha = a; g.font = font; g.fillStyle = col; g.textAlign = al; g.textBaseline = 'alphabetic'; g.fillText(s, x, y); const w = g.measureText(s).width; g.globalAlpha = 1; return w; }

  // a person in profile, thick rounded limbs; phase null means standing
  function person(x, y, H, phase, lit, alpha) {
    const u = H / 8, sw = phase === null ? 0 : Math.sin(phase), bob = phase === null ? 0 : Math.abs(Math.cos(phase)) * u * 0.1;
    const limb = (px, py, a1, l1, a2, l2, w1, w2) => { const kx = px + Math.sin(a1) * l1, ky = py + Math.cos(a1) * l1, ex = kx + Math.sin(a2) * l2, ey = ky + Math.cos(a2) * l2; g.lineWidth = w1; g.beginPath(); g.moveTo(px, py); g.lineTo(kx, ky); g.stroke(); g.lineWidth = w2; g.beginPath(); g.moveTo(kx, ky); g.lineTo(ex, ey); g.stroke(); return [ex, ey]; };
    const body = (col) => {
      g.strokeStyle = g.fillStyle = col; g.lineCap = g.lineJoin = 'round';
      const hip = [x, y - 4.05 * u + bob], sh = [x - 0.1 * u, y - 6.35 * u + bob];
      const leg = (s) => { const a1 = -s * 0.46, a2 = a1 + Math.max(0, s) * 0.12 + (s < 0 ? 0.5 * -s : 0.04); const [ex, ey] = limb(hip[0], hip[1], a1, 2.0 * u, a2 * (phase === null ? 0.4 : 1), 1.9 * u, 0.82 * u, 0.6 * u); g.lineWidth = 0.46 * u; g.beginPath(); g.moveTo(ex, ey + 0.02 * u); g.lineTo(ex - 0.42 * u, ey + 0.06 * u); g.stroke(); };
      leg(phase === null ? 0.16 : sw); leg(phase === null ? -0.1 : -sw);
      g.lineWidth = 1.28 * u; g.beginPath(); g.moveTo(hip[0], hip[1] - 0.15 * u); g.lineTo(sh[0], sh[1] + 0.35 * u); g.stroke();
      limb(sh[0], sh[1] + 0.1 * u, sw * 0.5 + 0.02, 1.45 * u, sw * 0.5 - 0.3, 1.3 * u, 0.52 * u, 0.42 * u); limb(sh[0], sh[1] + 0.1 * u, -sw * 0.5 + 0.02, 1.45 * u, -sw * 0.5 - 0.3, 1.3 * u, 0.52 * u, 0.42 * u);
      g.lineWidth = 0.5 * u; g.beginPath(); g.moveTo(sh[0], sh[1]); g.lineTo(sh[0] - 0.04 * u, sh[1] - 0.6 * u); g.stroke();
      g.beginPath(); g.ellipse(sh[0] - 0.1 * u, sh[1] - 1.0 * u, 0.5 * u, 0.62 * u, 0, 0, 7); g.fill();
    };
    g.save(); g.globalAlpha = alpha;
    if (lit > 0.01) { g.shadowColor = `rgba(${AMBER},${0.75 * lit})`; g.shadowBlur = 46 * lit * DPR; }
    const k = lit, col = `rgb(${Math.round(mix(64, 255, k))},${Math.round(mix(76, 178, k))},${Math.round(mix(90, 82, k))})`;
    body(col); g.restore();
  }
  function fan(x, y, a, alpha) {
    g.save(); g.globalAlpha = alpha; g.strokeStyle = g.fillStyle = '#7f93a8'; g.lineCap = 'round';
    g.lineWidth = 10; g.beginPath(); g.moveTo(x, y - 190); g.lineTo(x, y - 8); g.stroke(); g.lineWidth = 12; g.beginPath(); g.moveTo(x - 52, y - 6); g.lineTo(x + 52, y - 6); g.stroke();
    g.lineWidth = 3; g.strokeStyle = 'rgba(160,180,200,.65)'; g.beginPath(); g.arc(x, y - 250, 92, 0, 7); g.stroke(); g.beginPath(); g.arc(x, y - 250, 70, 0, 7); g.globalAlpha = alpha * 0.35; g.stroke(); g.globalAlpha = alpha;
    for (let s = 2; s >= 0; s--) { g.globalAlpha = alpha * (s ? 0.16 : 0.9); for (let k = 0; k < 3; k++) { g.save(); g.translate(x, y - 250); g.rotate(a - s * 0.2 + k * 2.0944); g.beginPath(); g.ellipse(0, -44, 21, 38, 0.35, 0, 7); g.fill(); g.restore(); } }
    g.globalAlpha = alpha; g.beginPath(); g.arc(x, y - 250, 13, 0, 7); g.fill(); g.restore();
  }
  function rover(x, y) {
    g.save(); g.lineCap = 'round'; g.fillStyle = '#2b3642'; g.strokeStyle = '#8fa3b8';
    g.lineWidth = 2.5; rr(x - 76, y - 78, 152, 40, 5); g.fill(); g.stroke();
    for (const wx of [-46, 46]) { g.beginPath(); g.arc(x + wx, y - 30, 29, 0, 7); g.fillStyle = '#141b22'; g.fill(); g.lineWidth = 3; g.stroke(); g.lineWidth = 2; for (let k = 0; k < 8; k++) { const a = k * 0.785 + 0.3; g.beginPath(); g.moveTo(x + wx + Math.cos(a) * 14, y - 30 + Math.sin(a) * 14); g.lineTo(x + wx + Math.cos(a + 0.42) * 25, y - 30 + Math.sin(a + 0.42) * 25); g.stroke(); } }
    g.lineWidth = 7; g.beginPath(); g.moveTo(x + 20, y - 80); g.lineTo(x + 20, y - 196); g.stroke();
    g.fillStyle = '#2b3642'; g.lineWidth = 2.5; rr(x + 2, y - 226, 40, 34, 4); g.fill(); g.stroke(); g.fillStyle = `rgb(${BLUE})`; g.beginPath(); g.arc(x + 30, y - 209, 6, 0, 7); g.fill();
    g.lineWidth = 3; g.beginPath(); g.moveTo(x + 10, y - 226); g.lineTo(x + 10, y - 262); g.stroke(); g.restore();
  }

  const FLOOR = 742, ANT = [190, 481], WALL = [322, 352], PX = 520;
  function scene(t) {
    g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, 1920, 1000);
    const gl = g.createRadialGradient(1300, 470, 60, 1300, 470, 900); gl.addColorStop(0, 'rgba(38,66,104,.26)'); gl.addColorStop(1, 'rgba(6,8,10,0)'); g.fillStyle = gl; g.fillRect(0, 0, 1920, 1000);
    let k = EX.length - 1; while (k > 0 && t < EX[k].t0) k--; const e = EX[k], lt = t - e.t0, inn = ramp(t, 0, 0.9);
    const fill = ramp(t, e.fill[0], e.fill[1]), netP = cl((t - e.net[0]) / (e.net[1] - e.net[0])) * 6.2, ans = out((t - (e.net[1] - 0.35)) / 0.8), gone = k < EX.length - 1 ? ramp(t, e.end - 0.28, e.end) : 0;
    const yes = e.r.says, lit = e.kind === 'walk' || e.kind === 'still' ? ans * (1 - gone) : 0;

    // title
    const ta = ramp(lt, 0.05, 0.5) * (1 - gone), ty = 138 + (1 - out(lt / 0.7)) * 16;
    const tw = text(e.title[0], 84, ty, `400 68px ${SERIF}`, `rgb(${TXT})`, 'left', ta); text(e.title[1], 84 + tw, ty, `italic 400 68px ${SERIF}`, `rgb(${ICE})`, 'left', ta);

    // room
    g.globalAlpha = inn; g.strokeStyle = 'rgba(143,163,184,.55)'; g.lineWidth = 2; g.beginPath(); g.moveTo(84, FLOOR); g.lineTo(84 + 636 * inn, FLOOR); g.stroke();
    // rings of Wi-Fi: steady until something behind the wall moves; the bend follows the real signal
    g.save(); g.beginPath(); g.rect(84, 214, 640, FLOOR - 214); g.clip(); const wt = t * 210, R0 = 46;
    for (let n = 0; n < 16; n++) {
      const r = ((wt + n * 62) % 992); if (r < 18) continue;
      const base = cl(1 - r / 760) * inn * 0.75; if (base < 0.01) continue;
      const ti = Math.floor(cl(fill) * 199), shake = (e.kind === 'none' ? 0.02 : e.kind === 'still' ? 0.16 : 0.35 + 0.65 * e.move[ti] / shakeMax) * ramp(lt, 0.4, 1.2);
      g.beginPath();
      for (let q = 0; q <= 70; q++) {
        const th = -0.98 + 1.96 * q / 70, dx = PX - ANT[0], dy = (e.kind === 'fan' ? 496 : 520) - ANT[1], ang = Math.atan2(dy, dx), dist = Math.hypot(dx, dy);
        const past = cl((r - dist + 60) / 120), gs = Math.exp(-(((th - ang) / 0.34) ** 2)), bend = shake * gs * past * 34 * Math.sin(q * 0.9 + t * (e.kind === 'fan' ? 26 : e.kind === 'still' ? 3 : 9) + n);
        const x = ANT[0] + Math.cos(th) * (r + bend), y = ANT[1] + Math.sin(th) * (r + bend); q ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      const hit = cl((r - 300) / 90) * lit; g.strokeStyle = `rgba(${hit > 0.5 ? AMBER : BLUE},${base * (r > 150 ? 0.62 : 0.95)})`; g.lineWidth = r > 160 ? 2 : 2.6; g.stroke();
    }
    // what comes back
    if (e.kind !== 'none') for (let n = 0; n < 4; n++) { const r = ((t * 170 + n * 85) % 340); const a = cl(1 - r / 340) * ramp(lt, 0.5, 1.2) * (1 - gone) * (e.kind === 'still' ? 0.28 : 0.5); g.strokeStyle = `rgba(${e.kind === 'fan' ? '140,160,182' : AMBER},${a * 0.8})`; g.lineWidth = 1.8; g.setLineDash([5, 8]); g.beginPath(); g.arc(PX, 500, r, Math.PI - 0.75, Math.PI + 0.75); g.stroke(); g.setLineDash([]); }
    g.restore();
    // wall, hatched
    g.save(); g.globalAlpha = inn; g.beginPath(); g.rect(WALL[0], FLOOR - 528 * inn, WALL[1] - WALL[0], 528 * inn); g.fillStyle = 'rgba(38,48,58,.94)'; g.fill(); g.clip(); g.strokeStyle = 'rgba(150,168,186,.35)'; g.lineWidth = 2; for (let y = 160; y < FLOOR + 40; y += 17) { g.beginPath(); g.moveTo(WALL[0] - 6, y + 22); g.lineTo(WALL[1] + 6, y - 14); g.stroke(); } g.restore();
    g.globalAlpha = inn; g.strokeStyle = 'rgba(190,205,220,.7)'; g.lineWidth = 2; g.strokeRect(WALL[0], FLOOR - 528, WALL[1] - WALL[0], 528); g.globalAlpha = 1;
    g.globalAlpha = inn; rover(170, FLOOR); g.globalAlpha = 1;
    const fig = (e.kind === 'none' ? 0 : ramp(lt, k ? 0.1 : 0.5, k ? 0.5 : 1.1)) * (1 - gone);
    if (e.kind === 'walk') person(PX + Math.sin(t * 0.9) * 22, FLOOR - 8, 344, t * 5.2, lit, fig);
    if (e.kind === 'still') person(PX, FLOOR - 8, 344, null, lit, fig);
    if (e.kind === 'fan') fan(PX, FLOOR, t * 21, fig);
    // distance on the floor
    const da = ramp(lt, 0.7, 1.2) * (1 - gone), dep = nn.samples[e.i].depth;
    if (dep && da > 0.01) { g.globalAlpha = da; g.strokeStyle = `rgba(${DIM},.8)`; g.lineWidth = 1.5; g.beginPath(); g.moveTo(WALL[1] + 4, FLOOR + 20); g.lineTo(PX, FLOOR + 20); g.moveTo(WALL[1] + 4, FLOOR + 13); g.lineTo(WALL[1] + 4, FLOOR + 27); g.moveTo(PX, FLOOR + 13); g.lineTo(PX, FLOOR + 27); g.stroke(); g.globalAlpha = 1; text(dep.toFixed(1) + ' m', PX + 16, FLOOR + 28, `500 22px ${SANS}`, `rgb(${DIM})`, 'left', da); }
    text('Rover', 170, FLOOR + 28, `500 22px ${SANS}`, `rgb(${DIM})`, 'center', inn);

    // the ten second window, real values
    const SX = 752, SY = 234, SW = 150, SH = 488; g.globalAlpha = inn;
    g.fillStyle = '#0b1016'; g.fillRect(SX, SY, SW, SH); g.imageSmoothingEnabled = false; g.save(); g.globalAlpha = inn * (1 - gone); g.beginPath(); g.rect(SX, SY, SW * fill, SH); g.clip(); g.drawImage(e.img, SX, SY, SW, SH); g.restore();
    if (fill > 0 && fill < 1) { g.fillStyle = `rgba(${ICE},.95)`; g.fillRect(SX + SW * fill - 1.5, SY - 4, 3, SH + 8); }
    g.strokeStyle = 'rgba(143,163,184,.45)'; g.lineWidth = 1.5; g.strokeRect(SX, SY, SW, SH); g.globalAlpha = 1;
    // receiver to window
    g.save(); g.globalAlpha = inn * 0.7; g.strokeStyle = `rgba(${BLUE},.55)`; g.lineWidth = 2; g.setLineDash([3, 9]); g.lineDashOffset = -t * 60; g.beginPath(); g.moveTo(ANT[0] - 10, FLOOR - 262); g.lineTo(ANT[0] - 10, 222); g.lineTo(SX - 22, 222); g.lineTo(SX - 22, SY + 40); g.lineTo(SX - 4, SY + 40); g.stroke(); g.restore();

    // the network
    const on = (l) => ease(cl(netP - l)) * (1 - gone);
    g.save(); g.globalCompositeOperation = 'lighter';
    // window into first layer
    for (let j = 0; j < 24; j++) { const [x, y] = dotXY(0, j), a = on(0) * (0.06 + 0.34 * e.a[0][j]); g.strokeStyle = `rgba(${BLUE},${0.05 * inn + a})`; g.lineWidth = 1; g.beginPath(); g.moveTo(SX + SW, y); g.lineTo(x, y); g.stroke(); }
    for (let l = 0; l < 5; l++) {
      const a = on(l + 0.6), head = cl(netP - l - 0.35);
      for (const [i, j, v] of e.w[l]) {
        const [x0, y0] = dotXY(l, i), [x1, y1] = dotXY(l + 1, j), s = Math.abs(v), m = (x0 + x1) / 2;
        g.strokeStyle = `rgba(${v >= 0 ? ICE : BLUE},${0.02 * inn + a * (0.04 + 0.55 * s ** 0.8)})`; g.lineWidth = 0.7 + 1.7 * s * a; g.beginPath(); g.moveTo(x0, y0); g.bezierCurveTo(m, y0, m, y1, x1, y1); g.stroke();
        if (head > 0 && head < 1 && s > 0.22) { const q = head, p = 1 - q, bx = p * p * p * x0 + 3 * p * p * q * m + 3 * p * q * q * m + q * q * q * x1, by = p * p * p * y0 + 3 * p * p * q * y0 + 3 * p * q * q * y1 + q * q * q * y1; g.fillStyle = `rgba(${ICE},${0.9 * (1 - gone)})`; g.beginPath(); g.arc(bx, by, 1.6 + 2.2 * s, 0, 7); g.fill(); }
      }
    }
    g.restore();
    for (let l = 0; l < 6; l++) for (let i = 0; i < LN[l]; i++) {
      const [x, y] = dotXY(l, i), a = on(l), v = e.a[l][i], R = l === 5 ? 17 : l === 4 ? 5 : 6.2, hot = l === 5 && yes && i === 0;
      g.globalAlpha = ramp(t, 0.3 + l * 0.1, 0.9 + l * 0.1); g.fillStyle = '#0d141c'; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill(); g.strokeStyle = `rgba(143,170,200,${0.4 + 0.4 * a * v})`; g.lineWidth = l === 5 ? 2 : 1.2; g.stroke();
      if (a * v > 0.02) { const col = l === 5 ? (yes ? AMBER : '150,172,196') : ICE; g.globalAlpha *= a * (0.15 + 0.85 * v); g.save(); if (l === 5 || v > 0.6) { g.shadowColor = `rgba(${l === 5 ? col : BLUE},.9)`; g.shadowBlur = (l === 5 ? 34 : 12) * DPR * v; } g.fillStyle = `rgb(${col})`; g.beginPath(); g.arc(x, y, R * (l === 5 ? 0.82 : 0.9), 0, 7); g.fill(); g.restore(); }
      g.globalAlpha = 1;
    }
    const LB = [['10 seconds', 'of Wi-Fi', SX + SW / 2, 0], ['24', 'filters', LX[0], 1], ['24', 'filters', LX[1], 1], ['24', 'filters', LX[2], 1], ['48', 'features', LX[3], 1], ['32', 'neurons', LX[4], 1]];
    LB.forEach(([a, b, x], n) => { const al = ramp(t, 0.6 + n * 0.1, 1.2 + n * 0.1); text(a, x, 757, `500 22px ${SANS}`, `rgb(${TXT})`, 'center', al); text(b, x, 783, `500 20px ${SANS}`, `rgb(${DIM})`, 'center', al); });

    // the answer
    const AX = 1672, AY = 360; const rise = (1 - out(ans)) * 14, av = ans * (1 - gone), shown = e.r.person * out(ans);
    text('Person', AX, AY - 12, `500 26px ${SANS}`, `rgb(${DIM})`, 'left', inn); text('Moving', AX, AY + 178, `500 26px ${SANS}`, `rgb(${DIM})`, 'left', inn * (yes ? 1 : 1 - 0.65 * av));
    const big = text(pct(shown), AX - 4, AY + 100 + rise, `400 124px ${SERIF}`, yes ? `rgb(${AMBER})` : `rgb(${TXT})`, 'left', av); text('%', AX + big + 4, AY + 100 + rise, `400 58px ${SERIF}`, yes ? `rgb(${AMBER})` : `rgb(${TXT})`, 'left', av);
    const mv = yes ? e.r.moving : 0; if (yes) { const b2 = text(pct(mv * out(ans)), AX - 2, AY + 246 + rise, `400 70px ${SERIF}`, `rgb(${TXT})`, 'left', av); text('%', AX + b2 + 2, AY + 246 + rise, `400 36px ${SERIF}`, `rgb(${TXT})`, 'left', av); } 
    // the decision line
    const bx = AX, by = AY + 118, bw = 176; g.globalAlpha = inn; g.fillStyle = 'rgba(143,163,184,.24)'; g.fillRect(bx, by, bw, 6); g.globalAlpha = av; g.fillStyle = yes ? `rgb(${AMBER})` : '#9db2c7'; g.fillRect(bx, by, bw * shown, 6); g.globalAlpha = inn; g.fillStyle = `rgb(${TXT})`; g.fillRect(bx + bw * nn.threshold - 1, by - 6, 2, 18); g.globalAlpha = 1;

    // the network in figures
    const sa = ramp(t, 1.2, 2); text('23,372', AX, 668, `400 44px ${SERIF}`, `rgb(${TXT})`, 'left', sa); text('weights', AX, 694, `500 20px ${SANS}`, `rgb(${DIM})`, 'left', sa);
    text(ms + ' ms', AX, 752, `400 44px ${SERIF}`, `rgb(${TXT})`, 'left', sa); text('an answer', AX, 778, `500 20px ${SANS}`, `rgb(${DIM})`, 'left', sa);
    ledger(t, k);
  }

  const cells = EX.map((q, n) => {
    const b = document.createElement('button'), mk = (cls, s) => { const e = document.createElement('span'); e.className = cls; e.textContent = s; b.append(e); return e; };
    b.type = 'button'; b.className = 'nf-cell' + (q.r.says ? ' is-person' : ''); mk('nf-name', q.name); const r = mk('nf-says', q.r.says ? (q.r.moving > 0.5 ? 'Person, moving' : 'Person, still') : 'No one'), p = mk('nf-pct', pct(q.r.person) + ' %'), line = mk('nf-line', '');
    if (onPick) b.addEventListener('click', () => onPick(n)); bar.append(b); return { b, r, p, line };
  });
  function ledger(t, k) {
    cells.forEach((q, n) => { const done = out((t - (EX[n].net[1] + 0.15)) / 0.6); q.b.style.opacity = ramp(t, 0.4 + n * 0.08, 1 + n * 0.08) * (n === k || done > 0.5 ? 1 : 0.5); q.b.setAttribute('aria-pressed', String(n === k)); q.r.style.opacity = q.p.style.opacity = done; q.line.style.transform = `scaleX(${done})`; });
  }
  return { canvas: c, bar, draw: scene, examples: EX, length: 19.6, setDPR(v) { if (v === DPR) return; DPR = v; c.width = 1920 * v; c.height = 1000 * v; } };
}

// The chapter itself: plays the five examples, then starts again; a click on one jumps to it.
export async function create(host, ctx) {
  const { h, realityTag } = ctx.kit, nn = await loadNN();
  await Promise.all([`400 60px ${SERIF}`, `italic 400 60px ${SERIF}`, `500 24px ${SANS}`].map((f) => document.fonts.load(f).catch(() => 0)));
  const times = []; for (let n = 0; n < 40; n++) times.push(nn.inferSample(15).ms); times.splice(0, 20); times.sort((a, b) => a - b);
  let t = 0, last = 0, raf = 0, on = false, slow = 0; const still = ctx.kit.reducedMotion?.();
  const box = h('div.nf-box'), wrap = h('div.nf', null, box, h('div.nf-tags', null, realityTag('live-ai'), h('span.tag.tag-sim', { title: 'Blender-built people in a Wi-Fi channel simulator.' }, 'Simulated windows')));
  host.replaceChildren(wrap);
  const flat = createFlat(box, nn, { ms: Math.max(0.1, times[10] || 1.1).toFixed(1), dpr: 1, onPick: (n) => { t = flat.examples[n].t0 + 0.02; if (still) t = flat.examples[n].net[1] + 1.2; kick(); } });
  function fit() { const r = wrap.getBoundingClientRect(); if (r.width < 8) return; const k = Math.min(r.width / 1920, r.height / 1000); box.style.transform = `translate(${(r.width - 1920 * k) / 2}px, ${(r.height - 1000 * k) / 2}px) scale(${k})`; flat.setDPR(Math.min(2, Math.max(0.75, k * Math.min(2, devicePixelRatio || 1) * (slow > 2 ? 0.75 : 1)))); flat.draw(t); }
  new ResizeObserver(fit).observe(wrap);
  function frame(now) {
    if (!on) return; raf = requestAnimationFrame(frame); const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now; t += dt; if (t > flat.length + 2.5) t = 0.9;
    flat.draw(t); if (dt > 0.03 && ++slow === 40) fit();
  }
  function kick() { cancelAnimationFrame(raf); last = 0; if (still) { flat.draw(t); return; } if (on) raf = requestAnimationFrame(frame); }
  if (still) t = flat.length;
  fit();
  return { flat, onShow() { on = true; fit(); kick(); }, onHide() { on = false; cancelAnimationFrame(raf); }, onParams(p) { if (p && p.sample != null) { const n = flat.examples.findIndex((e) => e.i === +p.sample); if (n >= 0) t = flat.examples[n].t0; } kick(); } };
}
