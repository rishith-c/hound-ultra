// Film page: the real clip, untouched; beside it the Wi-Fi signal simulated from that walk, and the real network reading it the whole time.
import { loadNN } from '../../app/core/nn.js';
const ENTER = +(new URLSearchParams(location.search).get('enter') || 5.2), NV = +(new URLSearchParams(location.search).get('n') || 762);
const SERIF = 'HSerif, serif', SANS = 'HSans, sans-serif', AMBER = '255,170,66', SILVER = '208,216,224', TXT = '242,245,248', DIM = '138,148,158';
const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), ss = (a, b, x) => { x = cl((x - a) / (b - a)); return x * x * (3 - 2 * x); }, mix = (a, b, k) => a + (b - a) * k;
const nn = await loadNN(), D = await (await fetch('walllive.json')).json(), W = nn.weights; await Promise.all(['400 60px HSerif', '500 24px HSans'].map((f) => document.fonts.load(f)));
const im = [...Array(NV)].map((_, i) => { const e = new Image(); e.src = `/x8/wall60/${String(i).padStart(4, '0')}.jpg`; return e; }); await Promise.all(im.map((e) => new Promise((r) => { if (e.complete) r(); e.onload = e.onerror = r; })));
const vx = document.getElementById('v').getContext('2d'); let shown = -1; const video = (i) => { i = cl(Math.floor(i), 0, NV - 1); if (i === shown || !im[i].naturalWidth) return; shown = i; vx.drawImage(im[i], 0, 0, 1738, 1608); };
const c = document.getElementById('c'), DPR = window.__P2 ? 2 : 2; c.width = 1920 * DPR; c.height = 1080 * DPR; const g = c.getContext('2d');
// what the network holds at each moment, 14 of its first filters and 14 of its last neurons: the ones that work hardest in this clip
const N = 14, top = (n, f) => [...Array(n).keys()].sort((p, q) => f(q) - f(p)).slice(0, N).sort((p, q) => p - q), S = D.steps, mx = (k, i) => Math.max(...S.map((s) => s[k][i]));
const A = top(24, (i) => mx('c', i)), B = top(32, (i) => mx('h', i)), cm = A.map((i) => Math.max(...S.map((s) => s.c[i]))), am = Math.max(...cm) * .5, hm = Math.max(...B.map((i) => mx('h', i))) * .8, bm = Math.max(...S.map((s) => Math.max(...s.b.slice(0, 51).map(Math.abs)))) * .8;
const sum = (Wt, C, F) => Array.from({ length: C }, (_, a) => Array.from({ length: F }, (_, f) => { let q = 0; for (let j = 0; j < 9; j++) q += Wt[a * 9 + j][f]; return q; })), mul = (P, Q) => P.map((r) => Q[0].map((_, j) => r.reduce((t, v, k) => t + v * Q[k][j], 0))), unit = (M) => { const m = Math.max(...M.flat().map(Math.abs)) || 1; return M.map((r) => r.map((v) => v / m)); };
const tail = Array.from({ length: 24 }, (_, f) => W[6][f].map((v, h) => v + W[6][24 + f][h])), L0 = unit(sum(W[0], 52, 24).map((r) => A.map((f) => r[f]))), thru = mul(mul(sum(W[2], 24, 24), sum(W[4], 24, 24)), tail), L1 = unit(A.map((f) => B.map((h) => thru[f][h]))), L2 = unit(B.map((h) => { const p = W[8][h][1] - W[8][h][0], m = W[10][h][1] - W[10][h][0]; return [p + m, p - m, -p]; }));
const at = (te) => { const q = cl((te - D.te0) / D.dt, 0, S.length - 1.001), n = Math.floor(q), k = q - n, a = S[n], b = S[n + 1], l = (x, y) => x.map((v, i) => mix(v, y[i], k)); return { p: mix(a.p, b.p, k), m: mix(a.m, b.m, k), c: l(a.c, b.c), h: l(a.h, b.h), b: l(a.b, b.b) }; };
// each channel's bar: how far it has moved in the last third of a second
const env = (te, i) => { let v = 0; for (let k = 0; k <= 8; k++) { const q = cl((te - k * .045 - D.te0) / D.dt, 0, S.length - 1.001), n = Math.floor(q), a = mix(S[n].b[i], S[n + 1].b[i], q - n); v = Math.max(v, Math.abs(a) * (1 - k * .085)); } return v; };
const soft = (te) => { const q = [-.10, -.05, 0].map((d) => at(te + d)), m = (k) => q[0][k].map((_, i) => (q[0][k][i] + q[1][k][i] + q[2][k][i]) / 3); return { p: q[2].p, m: q[2].m, c: m('c'), h: m('h'), b: m('b') }; };
const line = (t) => { const q = cl((t - D.lt0) / D.ldt, 0, D.line.length - 1.001), n = Math.floor(q); return mix(D.line[n], D.line[n + 1], q - n); }, LM = 1.45;
// ---- where things are
const X0 = 930, X1 = 1848, LY = 292, LA = 74, SPAN = 10, CY = 668, X = [1046, 1216, 1394, 1556], inY = (k) => CY + (k - 25.5) * 8.1, nY = (k) => CY + (k - 6.5) * 32, oY = (k) => CY + (k - 1) * 142, OUT = ['Person, moving', 'Person, still', 'No one'];
const hash = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const text = (s, x, y, font, col, al = 'left', a = 1) => { if (a < .004) return; g.globalAlpha = a; g.font = font; g.fillStyle = col; g.textAlign = al; g.fillText(s, x, y); g.globalAlpha = 1; };
let win = 2, lit = [0, 0, 1], last = 0, cand = 2, since = 0;
function draw(t) { // an answer counts once it has held for 0.6 s
  const te = D.enter + (t - ENTER), s = soft(te), pv = [s.p * s.m, s.p * (1 - s.m), 1 - s.p], dt = cl(t - last, 0, .1); last = t;
  const says = s.p > D.th ? (s.m > .5 ? 0 : 1) : 2; if (says !== cand) { cand = says; since = t; } if (t - since > .6) win = cand; lit = lit.map((v, i) => v + ((i === win ? 1 : 0) - v) * (1 - Math.exp(-dt / .16)));
  g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, 1920, 1080); const inn = ss(.05, .7, t), gl = g.createRadialGradient(1400, 660, 40, 1400, 660, 620); gl.addColorStop(0, 'rgba(34,38,44,.34)'); gl.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gl; g.fillRect(869, 138, 1051, 804);
  // ---- the signal
  const px = (q) => X1 - (te - q) / SPAN * (X1 - X0), xb = px(D.enter - .55); g.globalAlpha = inn * .5; g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X0, LY); g.lineTo(X1, LY); g.stroke(); g.globalAlpha = 1;
  g.lineCap = g.lineJoin = 'round'; const n = 460, P = [...Array(n + 1)].map((_, i) => { const q = te - SPAN + SPAN * i / n, v = line(q) / LM; return [X0 + (X1 - X0) * i / n, LY - v * LA, Math.abs(v)]; });
  for (const [w, al] of [[9, .10], [3.2, 1]]) for (let i = 0; i < n; i++) { const e = cl((Math.max(P[i][2], P[i + 1][2]) - .32) / .4), f = inn * al * ss(0, 40, i) * (.5 + .5 * ss(60, 420, i)); g.strokeStyle = `rgba(${e > .02 ? [0, 1, 2].map((k) => Math.round(mix(+SILVER.split(',')[k], +AMBER.split(',')[k], e))).join() : SILVER},${f})`; g.lineWidth = w; g.beginPath(); g.moveTo(P[i][0], P[i][1]); g.lineTo(P[i + 1][0], P[i + 1][1]); g.stroke(); }
  g.save(); g.shadowColor = `rgba(${TXT},.9)`; g.shadowBlur = 22 * DPR; g.fillStyle = `rgba(${TXT},${inn})`; g.beginPath(); g.arc(P[n][0], P[n][1], 7, 0, 7); g.fill(); g.restore();
  text('The Wi-Fi signal', X0, 196, `500 27px ${SANS}`, `rgb(${DIM})`, 'left', inn);
  const a1 = inn * ss(.5, 1.1, t) * ss(X0 + 150, X0 + 235, Math.min(xb, X1 - 1)), a2 = ss(ENTER + .9, ENTER + 1.6, t), mid = Math.min(xb, X1);
  text('Nobody moving', Math.max(X0, Math.min((X0 + mid) / 2, 1290)), 398, `500 27px ${SANS}`, `rgb(${DIM})`, 'center', a1); text('Me, walking', Math.max((mid + X1) / 2, X0 + 90), 398, `500 27px ${SANS}`, `rgb(${AMBER})`, 'center', a2);
  if (a2 > 0 && xb > X0) { g.globalAlpha = a2 * .55 * ss(X0, X0 + 60, xb); g.strokeStyle = `rgba(${TXT},.5)`; g.setLineDash([3, 7]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(xb, 222); g.lineTo(xb, 404); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
  // ---- the network
  const bars = s.b.map((v, i) => i < 51 ? cl(env(te, i) / bm) ** .8 : cl(Math.max(0, v) / 6)), act1 = A.map((i) => cl(s.c[i] / am) ** .8), act2 = B.map((i) => cl(s.h[i] / hm)), hotk = win === 2 ? 0 : 1, HOT = win === 2 ? SILVER : AMBER;
  for (let y = 0; y < 52; y++) { const v = bars[y], w = 5 + 104 * v, yy = inY(y), e = cl((v - .4) / .3); g.fillStyle = `rgba(${[0, 1, 2].map((k) => Math.round(mix(+SILVER.split(',')[k], +AMBER.split(',')[k], e * .8))).join()},${inn * (.22 + .7 * v)})`; g.fillRect(X[0] - 12 - w, yy - 2.4, w, 4.8); g.fillStyle = `rgba(${TXT},${inn * (.22 + .7 * v)})`; g.beginPath(); g.arc(X[0], yy, 2.4, 0, 7); g.fill(); }
  for (let l = 0; l < 3; l++) {
    const PA = l === 0 ? bars : l === 1 ? act1 : act2, PB = l === 0 ? act1 : act2, M = [L0, L1, L2][l], yA = l ? nY : inY, yB = l === 2 ? oY : nY, x0 = X[l] + (l ? 13 : 5), x1 = X[l + 1] - (l === 2 ? 20 : 13);
    for (let i = 0; i < M.length; i++) for (let j = 0; j < M[0].length; j++) {
      if (l === 0 && (i + j * 5) % 2) continue; const hot = l === 2 && j < 2 && M[i][j] > 0 ? lit[j] : 0, s_ = Math.abs(M[i][j]) * PA[i] * (l === 2 ? .3 + .7 * lit[j] : .3 + .7 * PB[j]), path = l === 1 ? hotk * cl(s_ * 3 - .4) : 0, al = (l === 0 ? .05 : .08) + s_ * .5 + hot * act2[i] * .5 + path * .25;
      g.strokeStyle = `rgba(${hot > .4 || path > .12 ? AMBER : TXT},${inn * Math.min(.85, al)})`; g.lineWidth = .8 + hot * act2[i] * 1.3 + path * .7; g.beginPath(); g.moveTo(x0, yA(i)); g.lineTo(x1, yB(j)); g.stroke();
    }
  }
  for (let p = 0; p < 150; p++) {
    const l = p % 3, sp = .8 + .45 * hash(p + 3), ph = t * sp + hash(p) + 20, cy = Math.floor(ph), u = ph - cy, n0 = l ? N : 52, n1 = l === 2 ? 3 : N, i = Math.floor(hash(p * 3 + cy * 17 + 1) * n0), j = l === 2 ? (hash(p + cy * 5) < .7 ? win : Math.floor(hash(p * 7 + cy) * 3)) : Math.floor(hash(p * 5 + cy * 13 + 2) * n1), v = l === 0 ? bars[i] : l === 1 ? act1[i] : act2[i]; if (v < .1) continue;
    const x0 = X[l] + (l ? 13 : 5), x1 = X[l + 1] - (l === 2 ? 20 : 13), a = Math.sin(Math.PI * u) * inn * (.2 + .7 * v); g.globalAlpha = a; g.fillStyle = `rgb(${l === 2 && j < 2 && lit[j] > .5 ? AMBER : TXT})`; g.beginPath(); g.arc(mix(x0, x1, u), mix(l ? nY(i) : inY(i), l === 2 ? oY(j) : nY(j), u), 2.1, 0, 7); g.fill(); g.globalAlpha = 1;
  }
  for (let l = 1; l < 3; l++) for (let i = 0; i < N; i++) { const v = (l === 1 ? act1 : act2)[i], y = nY(i), lum = Math.round(mix(44, 246, v ** .85)); g.globalAlpha = inn; g.fillStyle = '#05070a'; g.beginPath(); g.arc(X[l], y, 13, 0, 7); g.fill(); g.save(); if (v > .5) { g.shadowColor = `rgba(${TXT},.8)`; g.shadowBlur = 14 * DPR * v; } g.fillStyle = `rgb(${lum},${lum + 2},${lum + 4})`; g.beginPath(); g.arc(X[l], y, 11, 0, 7); g.fill(); g.restore(); g.globalAlpha = 1; }
  for (let o = 0; o < 3; o++) {
    const y = oY(o), on = lit[o], H = o < 2 ? AMBER : TXT, v = pv[o]; g.globalAlpha = inn; g.save(); g.shadowColor = `rgba(${H},${.95 * on})`; g.shadowBlur = 50 * DPR * on; g.fillStyle = `rgba(${H},${.25 * on})`; g.beginPath(); g.arc(X[3], y, 17 + 14 * on, 0, 7); g.fill(); const b = Math.round(50 + 70 * v); g.fillStyle = on > .03 ? `rgba(${H},${.35 + .65 * on})` : `rgb(${b},${b + 3},${b + 6})`; g.beginPath(); g.arc(X[3], y, 17, 0, 7); g.fill(); g.restore(); g.globalAlpha = 1;
    text(OUT[o], X[3] + 50, y + 13, `400 ${(44 + 4 * on).toFixed(1)}px ${SERIF}`, on > .4 ? `rgb(${o < 2 ? AMBER : TXT})` : `rgb(${DIM})`, 'left', inn * mix(.5, 1, on));
  }
  for (const [s_, x] of [['51 channels', 994], ['Filters', X[1]], ['Neurons', X[2]], ['Answer', X[3]]]) text(s_, x, 922, `500 23px ${SANS}`, `rgb(${DIM})`, 'center', inn * .9);
}
let t0 = performance.now(), run = false; function loop() { const t = run ? (performance.now() - t0) / 1000 : 0; video(t * 60 + .25); draw(t); requestAnimationFrame(loop); } loop();
window.WALL = { start() { t0 = performance.now(); run = true; last = 0; lit = [0, 0, 1]; win = cand = 2; since = 0; return im.filter((e) => e.naturalWidth).length; } };
window.READY = true;
