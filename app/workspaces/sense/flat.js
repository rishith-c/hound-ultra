// The Demo's network chapter: a wall, a person, one Wi-Fi signal and the real network, drawn flat.
// Drawn simply (14 of its first filters and 14 of its last neurons), but every value comes from app/core/nn.js running the
// bundled test windows (data/nn.json); the bars on the right are the answer so far as the window is read.
import { loadNN } from '../../core/nn.js';

const SERIF = '"Instrument Serif", HSerif, serif', SANS = '"Instrument Sans", HSans, sans-serif';
const BLUE = '90,169,255', ICE = '196,222,255', AMBER = '255,178,82', TXT = '242,245,248', DIM = '142,156,171';
const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), ease = (x) => { x = cl(x); return x * x * (3 - 2 * x); }, out = (x) => 1 - Math.pow(1 - cl(x), 3), ramp = (t, a, b) => ease((t - a) / (b - a)), mix = (a, b, k) => a + (b - a) * k;
const pct = (p) => p >= 0.995 ? '100' : p < 0.005 ? '0' : String(Math.round(p * 100));


export function createFlat(host, nn, { dpr = 2, onNext = null } = {}) {
  const c = document.createElement('canvas'), g = c.getContext('2d'); let DPR = dpr; c.className = 'nf-canvas'; c.width = 1920 * DPR; c.height = 1000 * DPR; host.append(c);
  if (onNext) { c.style.cursor = 'pointer'; c.title = 'Next example'; c.addEventListener('click', onNext); }
  // the five examples: real held-out windows of the bundled test set, in the order they are shown
  const EX = [
    { i: 15, t0: 0.0, name: 'Walking', title: 'Someone walking behind the wall', kind: 'walk', fill: [1.0, 4.4], net: [3.0, 4.9], end: 6.6 },
    { i: 0, t0: 6.6, name: 'Empty room', title: 'The same room, empty', kind: 'none', fill: [6.9, 8.5], net: [7.7, 8.6], end: 9.6 },
    { i: 15, t0: 9.6, name: 'The first one again', title: 'The first one, again', kind: 'walk', fill: [9.9, 11.2], net: [10.5, 11.3], end: 12.3 },
    { i: 7, t0: 12.3, name: 'A fan', title: 'Only a fan', kind: 'fan', fill: [12.6, 14.2], net: [13.4, 14.3], end: 15.5 },
    { i: 22, t0: 15.5, name: 'Standing still', title: 'Someone standing still', kind: 'still', fill: [15.8, 17.6], net: [16.7, 17.7], end: 99 },
  ].map((e) => ({ ...e, r: nn.inferSample(e.i, { trace: true }), x: nn.samples[e.i].x }));

  // The drawing: 52 signal rows, 14 of the 24 first filters, 14 of the 32 last neurons, three answers.
  const N = 14, W = nn.weights, top = (n, score) => [...Array(n).keys()].sort((p, q) => score(q) - score(p)).slice(0, N).sort((p, q) => p - q);
  const A = top(24, (f) => Math.max(...EX.map((e) => Math.max(...e.r.layers.c1[f])))), B = top(32, (h) => Math.max(...EX.map((e) => e.r.layers.hidden[h])));
  const sum = (Wt, C, F) => Array.from({ length: C }, (_, a) => Array.from({ length: F }, (_, f) => { let q = 0; for (let j = 0; j < 9; j++) q += Wt[a * 9 + j][f]; return q; }));
  const mul = (P, Q) => P.map((r) => Q[0].map((_, j) => r.reduce((t, v, k) => t + v * Q[k][j], 0)));
  const tail = Array.from({ length: 24 }, (_, f) => W[6][f].map((v, h) => v + W[6][24 + f][h]));           // each last filter reaches the neurons twice: its mean and its peak
  const unit = (M) => { const m = Math.max(...M.flat().map(Math.abs)) || 1; return M.map((r) => r.map((v) => v / m)); };
  const w0 = sum(W[0], 52, 24), L0 = unit(w0.map((r) => A.map((f) => r[f]))), thru = mul(mul(sum(W[2], 24, 24), sum(W[4], 24, 24)), tail), L1 = unit(A.map((f) => B.map((h) => thru[f][h])));
  const L2 = unit(B.map((h) => { const p = W[8][h][1] - W[8][h][0], m = W[10][h][1] - W[10][h][0]; return [p + m, p - m, -p]; }));
  const sm2 = (z) => { const m = Math.max(z[0], z[1]), q = Math.exp(z[1] - m); return q / (Math.exp(z[0] - m) + q); };
  const lin = (v, Wt, bb) => Array.from(bb, (q, f) => { let o = q; for (let i = 0; i < v.length; i++) o += v[i] * Wt[i][f]; return o; });
  for (const e of EX) {
    const { c1, c3 } = e.r.layers, T = c3[0].length;
    // the answer so far: the same layers, run on the first n parts of the window; the last one is the exact result
    e.run = Array.from({ length: T }, (_, n) => { const mean = c3.map((r) => { let q = 0; for (let k = 0; k <= n; k++) q += r[k]; return q / (n + 1); }), peak = c3.map((r) => Math.max(...r.slice(0, n + 1)));
      const hid = lin([...mean, ...peak], W[6], W[7]).map((v) => Math.max(0, v)); return { hid, p: sm2(lin(hid, W[8], W[9])), m: sm2(lin(hid, W[10], W[11])) }; });
    const hm = Math.max(1e-6, ...e.run[T - 1].hid, ...EX[0].r.layers.hidden), am = Math.max(1e-6, ...A.map((f) => Math.max(...c1[f]))) * 0.42;
    e.hidAt = (u) => { const q = cl(u) * (T - 1), n = Math.floor(q), k = q - n, a = e.run[n], b = e.run[Math.min(T - 1, n + 1)]; return { hid: B.map((h) => cl(mix(a.hid[h], b.hid[h], k) / hm)), p: mix(a.p, b.p, k), m: mix(a.m, b.m, k) }; };
    const soft = (row, q) => { let o = 0, d = 0; for (let j = -5; j <= 5; j++) { const k = Math.exp(-j * j / 9); o += k * row[((Math.round(q) + j) % row.length + row.length) % row.length]; d += k; } return o / d; };
    e.c1At = (q) => A.map((f) => cl(soft(c1[f], q) / am)); e.barAt = (q) => e.x.map((r) => soft(r, q));
    // how much the signal shakes from one moment to the next: it drives the rings in the picture
    e.move = Array.from({ length: 200 }, (_, t) => { let q = 0; for (let y = 0; y < 52; y++) q += Math.abs(e.x[y][t] - e.x[y][Math.max(0, t - 1)]); return q / 52; });
  }
  const shakeMax = Math.max(...EX.flatMap((e) => e.move));
  const CY = 528, X = [916, 1128, 1340, 1530], inY = (k) => CY + (k - 25.5) * 10.8, nY = (k) => CY + (k - 6.5) * 41.5, oY = (k) => CY + (k - 1) * 184;
  const OUT = ['Person, moving', 'Person, still', 'No one'];
  const hash = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

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

  const FLOOR = 806, ANT = [190, 545], WALL = [322, 352], PX = 520;
  function scene(t) {
    g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, 1920, 1000);
    const gl = g.createRadialGradient(1220, 520, 60, 1220, 520, 900); gl.addColorStop(0, 'rgba(38,66,104,.22)'); gl.addColorStop(1, 'rgba(6,8,10,0)'); g.fillStyle = gl; g.fillRect(0, 0, 1920, 1000);
    let k = EX.length - 1; while (k > 0 && t < EX[k].t0) k--; const e = EX[k], lt = t - e.t0, inn = ramp(t, 0, 0.9);
    const fill = ramp(t, e.fill[0], e.fill[1]), ans = out((t - (e.net[1] - 0.35)) / 0.8), gone = k < EX.length - 1 ? ramp(t, e.end - 0.28, e.end) : 0, yes = e.r.says;
    const lit = e.kind === 'walk' || e.kind === 'still' ? ans * (1 - gone) : 0, live = ramp(t, e.fill[0] - 0.2, e.fill[0] + 0.3) * (1 - gone);

    // title
    text(e.title, 84, 152 + (1 - out(lt / 0.7)) * 14, `400 70px ${SERIF}`, `rgb(${TXT})`, 'left', ramp(lt, 0.05, 0.5) * (1 - gone));

    // room
    g.globalAlpha = inn; g.strokeStyle = 'rgba(143,163,184,.55)'; g.lineWidth = 2; g.beginPath(); g.moveTo(84, FLOOR); g.lineTo(84 + 636 * inn, FLOOR); g.stroke();
    // rings of Wi-Fi: steady until something behind the wall moves; the bend follows the real signal
    g.save(); g.beginPath(); g.rect(84, 240, 640, FLOOR - 240); g.clip(); const wt = t * 210, R0 = 46;
    for (let n = 0; n < 16; n++) {
      const r = ((wt + n * 62) % 992); if (r < 18) continue;
      const base = cl(1 - r / 760) * inn * 0.75; if (base < 0.01) continue;
      const ti = Math.floor(cl(fill) * 199), shake = (e.kind === 'none' ? 0.02 : e.kind === 'still' ? 0.16 : 0.35 + 0.65 * e.move[ti] / shakeMax) * ramp(lt, 0.4, 1.2);
      g.beginPath();
      for (let q = 0; q <= 70; q++) {
        const th = -0.98 + 1.96 * q / 70, dx = PX - ANT[0], dy = (e.kind === 'fan' ? FLOOR - 246 : FLOOR - 222) - ANT[1], ang = Math.atan2(dy, dx), dist = Math.hypot(dx, dy);
        const past = cl((r - dist + 60) / 120), gs = Math.exp(-(((th - ang) / 0.34) ** 2)), bend = shake * gs * past * 34 * Math.sin(q * 0.9 + t * (e.kind === 'fan' ? 26 : e.kind === 'still' ? 3 : 9) + n);
        const x = ANT[0] + Math.cos(th) * (r + bend), y = ANT[1] + Math.sin(th) * (r + bend); q ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      const hit = cl((r - 300) / 90) * lit; g.strokeStyle = `rgba(${hit > 0.5 ? AMBER : BLUE},${base * (r > 150 ? 0.62 : 0.95)})`; g.lineWidth = r > 160 ? 2 : 2.6; g.stroke();
    }
    // what comes back
    if (e.kind !== 'none') for (let n = 0; n < 4; n++) { const r = ((t * 170 + n * 85) % 340); const a = cl(1 - r / 340) * ramp(lt, 0.5, 1.2) * (1 - gone) * (e.kind === 'still' ? 0.28 : 0.5); g.strokeStyle = `rgba(${e.kind === 'fan' ? '140,160,182' : AMBER},${a * 0.8})`; g.lineWidth = 1.8; g.setLineDash([5, 8]); g.beginPath(); g.arc(PX, FLOOR - 242, r, Math.PI - 0.75, Math.PI + 0.75); g.stroke(); g.setLineDash([]); }
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

    // the signal: 52 rows of Wi-Fi, the real window playing
    const q = lt * 46, bars = e.barAt(q), act1 = e.c1At(q), run = e.hidAt(fill), act2 = run.hid.map((v) => v * cl(fill * 4)), pv = [run.p * run.m, run.p * (1 - run.m), 1 - run.p];
    const win = yes ? (e.r.moving > 0.5 ? 0 : 1) : 2, HOT = win === 2 ? ICE : AMBER;
    for (let y = 0; y < 52; y++) {
      const v = Math.abs(Math.tanh(bars[y] * 0.9)), w = 12 + 128 * v * live, yy = inY(y), b = v;
      g.globalAlpha = inn; g.fillStyle = `rgba(${ICE},${mix(0.16, 0.26 + 0.64 * b, live)})`; g.fillRect(X[0] - 14 - w, yy - 3.2, w, 6.4);
      g.fillStyle = `rgba(${TXT},${mix(0.2, 0.3 + 0.7 * b, live)})`; g.beginPath(); g.arc(X[0], yy, 3.1, 0, 7); g.fill();
    }
    // straight lines
    const near = (a0, a1, w) => Math.abs(w) * a0 * a1;
    for (let l = 0; l < 3; l++) {
      const PA = l === 0 ? bars.map((v) => cl(Math.abs(v))) : l === 1 ? act1 : act2, PB = l === 0 ? act1 : l === 1 ? act2 : null, M = l === 0 ? L0 : l === 1 ? L1 : L2, yA = l === 0 ? inY : nY, yB = l === 2 ? oY : nY;
      const x0 = X[l] + (l ? 16 : 5), x1 = X[l + 1] - (l === 2 ? 24 : 16);
      for (let i = 0; i < M.length; i++) for (let j = 0; j < M[0].length; j++) {
        if (l === 0 && (i + j * 5) % 2) continue;
        const s = near(PA[i], PB ? 0.3 + 0.7 * PB[j] : j === win ? ans : 0.25 * live, M[i][j]), hot = l === 2 && j === win && M[i][j] > 0 ? ans * (1 - gone) : 0, path = l === 1 && win < 2 ? ans * (1 - gone) * cl(s * 3 - 0.35) : 0, al = (l === 0 ? 0.065 : 0.1) * inn + live * s * (l === 0 ? 0.5 : 0.6) + hot * act2[i] * 0.55 + path * 0.3;
        g.globalAlpha = 1; g.strokeStyle = `rgba(${hot > 0.4 || path > 0.12 ? HOT : TXT},${Math.min(0.85, al)})`; g.lineWidth = 0.9 + hot * act2[i] * 1.4 + path * 0.8; g.beginPath(); g.moveTo(x0, yA(i)); g.lineTo(x1, yB(j)); g.stroke();
      }
    }
    // light moving along them
    if (live > 0.02) for (let p = 0; p < 190; p++) {
      const l = p % 3, sp = 0.95 + 0.5 * hash(p + 3), ph = t * sp + hash(p), cy = Math.floor(ph), u = ph - cy, n0 = l ? N : 52, n1 = l === 2 ? 3 : N;
      const i = Math.floor(hash(p * 3 + cy * 17 + 1) * n0), j = l === 2 ? (hash(p + cy * 5) < 0.25 + 0.75 * ans ? win : Math.floor(hash(p * 7 + cy) * 3)) : Math.floor(hash(p * 5 + cy * 13 + 2) * n1);
      const s = l === 0 ? cl(0.25 + Math.abs(bars[i])) : l === 1 ? act1[i] : act2[i]; if (s < 0.08) continue;
      const x0 = X[l] + (l ? 16 : 5), x1 = X[l + 1] - (l === 2 ? 24 : 16), y0 = l ? nY(i) : inY(i), y1 = l === 2 ? oY(j) : nY(j), a = Math.sin(Math.PI * u) * live * (0.35 + 0.65 * s);
      g.globalAlpha = a; g.fillStyle = `rgb(${l === 2 && j === win && ans > 0.4 ? HOT : TXT})`; g.beginPath(); g.arc(mix(x0, x1, u), mix(y0, y1, u), 2.5, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
    // neurons
    for (let l = 1; l < 3; l++) for (let i = 0; i < N; i++) {
      const v = (l === 1 ? act1 : act2)[i] * live, y = nY(i); g.globalAlpha = ramp(t, 0.2 + l * 0.15, 0.8 + l * 0.15);
      g.fillStyle = '#10161d'; g.beginPath(); g.arc(X[l], y, 16, 0, 7); g.fill(); const lum = Math.round(mix(52, 246, v ** 0.8)); g.save(); if (v > 0.55) { g.shadowColor = `rgba(${ICE},.8)`; g.shadowBlur = 16 * DPR * v; } g.fillStyle = `rgb(${lum},${lum + 2},${lum + 5})`; g.beginPath(); g.arc(X[l], y, 14, 0, 7); g.fill(); g.restore();
    }
    // three answers
    for (let o = 0; o < 3; o++) {
      const y = oY(o), on = o === win ? ans * (1 - gone) : 0, v = pv[o] * live * cl(fill * 3); g.globalAlpha = ramp(t, 0.6, 1.2);
      g.save(); if (on > 0.02) { g.shadowColor = `rgba(${HOT},.95)`; g.shadowBlur = 60 * DPR * on; g.fillStyle = `rgba(${HOT},${0.28 * on})`; g.beginPath(); g.arc(X[3], y, 21 + 17 * on, 0, 7); g.fill(); } const col = on > 0.05 ? `rgb(${HOT})` : `rgb(${Math.round(60 + 120 * v)},${Math.round(64 + 120 * v)},${Math.round(70 + 122 * v)})`; g.fillStyle = col; g.beginPath(); g.arc(X[3], y, 21, 0, 7); g.fill(); g.restore();
      const a = ramp(t, 0.7, 1.3) * mix(0.42, 1, on); text(OUT[o], 1584, y + 2, `400 ${(46 + 8 * on).toFixed(1)}px ${SERIF}`, on > 0.4 ? `rgb(${HOT})` : `rgb(${TXT})`, 'left', a);
      g.globalAlpha = ramp(t, 0.7, 1.3); g.fillStyle = 'rgba(143,163,184,.2)'; g.fillRect(1585, y + 28, 206, 4); g.fillStyle = on > 0.4 ? `rgb(${HOT})` : 'rgba(196,214,232,.75)'; g.fillRect(1585, y + 28, 206 * v, 4); g.globalAlpha = 1;
      text(pct(v) + ' %', 1806, y + 38, `500 24px ${SANS}`, on > 0.4 ? `rgb(${HOT})` : `rgb(${DIM})`, 'left', ramp(t, 0.7, 1.3) * live);
    }
  }
  return { canvas: c, draw: scene, examples: EX, length: 19.6, setDPR(v) { if (v === DPR) return; DPR = v; c.width = 1920 * v; c.height = 1000 * v; } };
}

// The chapter itself: plays the five examples, then starts again; a click on one jumps to it.
export async function create(host, ctx) {
  const { h, realityTag } = ctx.kit, nn = await loadNN();
  await Promise.all([`400 60px ${SERIF}`, `italic 400 60px ${SERIF}`, `500 24px ${SANS}`].map((f) => document.fonts.load(f).catch(() => 0)));
  let t = 0, last = 0, raf = 0, on = false, slow = 0; const still = ctx.kit.reducedMotion?.();
  const box = h('div.nf-box'), wrap = h('div.nf', null, box, h('div.nf-tags', null, realityTag('live-ai'), h('span.tag.tag-sim', { title: 'Blender-built people in a Wi-Fi channel simulator.' }, 'Simulated windows')));
  host.replaceChildren(wrap);
  const flat = createFlat(box, nn, { dpr: 1, onNext: () => { let k = flat.examples.length - 1; while (k > 0 && t < flat.examples[k].t0) k--; const n = flat.examples[(k + 1) % flat.examples.length]; t = still ? n.net[1] + 1.2 : n.t0 + 0.02; kick(); } });
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
