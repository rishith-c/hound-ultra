// What pushed the person answer up or down, cell by cell: gradient x activation, by back-propagation through the real
// weights. The network is piecewise linear (ReLU, average, max), so this is the exact first-order share of the log-odds.
const zeros = (R, T) => Array.from({ length: R }, () => new Float64Array(T));
function convBack(g, W, C, T, k) { // g: gradient at the conv output. Returns the gradient at its input (C rows of T).
  const o = zeros(C, T);
  for (let f = 0; f < g.length; f++) for (let t = 0; t < g[f].length; t++) { const v = g[f][t]; if (v) for (let c = 0; c < C; c++) { const b = (f * C + c) * k, r = o[c]; for (let j = 0; j < k; j++) r[t + j] += v * W[b + j]; } }
  return o;
}
const poolBack = (g, p, T, act) => g.map((r, c) => { const o = new Float64Array(T); for (let i = 0; i < r.length; i++) for (let j = 0; j < p; j++) if (act[c][i * p + j] > 0) o[i * p + j] = r[i] / p; return o; });
const gate = (g, act) => g.map((r, f) => r.map((v, t) => (act[f][t] > 0 ? v : 0)));
const mul = (g, a) => g.map((r, f) => Float32Array.from(r, (v, t) => v * a[f][t]));

// net: compile(weights). out: net.forward(x, true). Returns contributions and gradients per layer, plus the strongest edges.
export function attribute(net, x, out) {
  const { c1, p1, c2, p2, c3, feat, hidden } = out.layers;
  const gH = hidden.map((v, j) => (v > 0 ? net.hp[32 + j] - net.hp[j] : 0));
  const gF = feat.map((_, i) => { let s = 0; for (let j = 0; j < 32; j++) s += gH[j] * net.d[j * 48 + i]; return s; });
  const gC3 = gate(c3.map((r, f) => Float64Array.from(r, (_, t) => gF[f] / r.length + (out.arg[f] === t ? gF[24 + f] : 0))), c3);
  const gP2 = convBack(gC3, net.c3, 24, 20, 9), gC2 = poolBack(gP2, 2, 40, c2);
  const gP1 = convBack(gC2, net.c2, 24, 48, 9), gC1 = poolBack(gP1, 4, 192, c1);
  const gX = convBack(gC1, net.c1, 52, 200, 9);
  const g = { x: gX, c1: gC1, p1: gP1, c2: gC2, p2: gP2, c3: gC3, feat: gF, hidden: gH };
  const c = { x: mul(gX, x), c1: mul(gC1, c1), p1: mul(gP1, p1), c2: mul(gC2, c2), p2: mul(gP2, p2), c3: mul(gC3, c3), feat: feat.map((v, i) => v * gF[i]), hidden: hidden.map((v, j) => v * gH[j]) };
  return { g, c, edges: edges(net, x, out, g, c) };
}

// The strongest products of input x weight x downstream gradient between neighbouring layers (what each thread carries).
function edges(net, x, out, g, c) {
  const L = out.layers, list = [];
  const top = (rows, n) => { const a = []; rows.forEach((r, f) => { for (let t = 0; t < r.length; t++) if (r[t]) a.push([f, t, Math.abs(r[t])]); }); return a.sort((p, q) => q[2] - p[2]).slice(0, n); };
  const push = (k, cells, n, gen) => { for (const [f, t] of cells) { const e = gen(f, t).sort((p, q) => Math.abs(q.v) - Math.abs(p.v)).slice(0, n); for (const o of e) list.push({ k, f, t, ...o }); } };
  const conv = (inp, W, C, gout) => (f, t) => { const e = []; for (let r = 0; r < C; r++) for (let j = 0; j < 9; j++) e.push({ r, s: t + j, v: inp[r][t + j] * W[(f * C + r) * 9 + j] * gout[f][t] }); return e; };
  const pool = (inp, p, gout) => (f, t) => Array.from({ length: p }, (_, j) => ({ r: f, s: t * p + j, v: inp[f][t * p + j] * gout[f][t] / p }));
  push(0, top(c.c1, 110), 1, conv(x, net.c1, 52, g.c1));
  push(1, top(c.p1, 46), 2, pool(L.c1, 4, g.p1));
  push(2, top(c.c2, 46), 2, conv(L.p1, net.c2, 24, g.c2));
  push(3, top(c.p2, 46), 2, pool(L.c2, 2, g.p2));
  push(4, top(c.c3, 46), 2, conv(L.p2, net.c3, 24, g.c3));
  for (const [f, t] of top(c.c3, 64)) { list.push({ k: 5, r: f, s: t, f: 0, t: f, v: L.c3[f][t] * g.feat[f] / 12 }); if (out.arg[f] === t) list.push({ k: 5, r: f, s: t, f: 1, t: f, v: L.c3[f][t] * g.feat[24 + f] }); }
  const d = []; for (let j = 0; j < 32; j++) if (g.hidden[j]) for (let i = 0; i < 48; i++) { const v = L.feat[i] * net.d[j * 48 + i] * g.hidden[j]; if (v) d.push({ k: 6, r: i < 24 ? 0 : 1, s: i % 24, f: j < 16 ? 0 : 1, t: j % 16, v }); }
  list.push(...d.sort((p, q) => Math.abs(q.v) - Math.abs(p.v)).slice(0, 90));
  c.hidden.forEach((v, j) => { if (v) for (let n = 0; n < 4; n++) list.push({ k: 7, r: j < 16 ? 0 : 1, s: j % 16, f: 0, t: n, v }); });
  return list;
}
