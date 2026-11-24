// A faster loop over the SAME weights as app/core/nn.js, for the hundreds of re-runs that occlusion and the sliders need.
// It keeps the reference's order of additions, so the outputs agree to the last digit. bench.js checks that on all
// 30 bundled windows when it opens and falls back to ctx.nn.infer if they ever differ.
export function compile(w) {
  const convW = (Wt, C, k, F) => { const a = new Float64Array(F * C * k); for (let f = 0; f < F; f++) for (let c = 0; c < C; c++) for (let j = 0; j < k; j++) a[(f * C + c) * k + j] = Wt[c * k + j][f]; return a; };
  const denseW = (Wt, I, F) => { const a = new Float64Array(F * I); for (let f = 0; f < F; f++) for (let i = 0; i < I; i++) a[f * I + i] = Wt[i][f]; return a; };
  const net = {
    c1: convW(w[0], 52, 9, 24), b1: Float64Array.from(w[1]), c2: convW(w[2], 24, 9, 24), b2: Float64Array.from(w[3]), c3: convW(w[4], 24, 9, 24), b3: Float64Array.from(w[5]),
    d: denseW(w[6], 48, 32), bd: Float64Array.from(w[7]), hp: denseW(w[8], 32, 2), bp: Float64Array.from(w[9]), hm: denseW(w[10], 32, 2), bm: Float64Array.from(w[11]),
  };
  const acc = new Float64Array(200);
  function conv(x, C, T, W, b, F, k) { // x: rows (arrays or typed arrays) of length T. Returns F rows of Float32Array(T - k + 1).
    const Tp = T - k + 1, out = new Array(F);
    for (let f = 0; f < F; f++) {
      acc.fill(b[f], 0, Tp);
      for (let c = 0; c < C; c++) { const xc = x[c], base = (f * C + c) * k; for (let j = 0; j < k; j++) { const wv = W[base + j]; for (let t = 0; t < Tp; t++) acc[t] += xc[t + j] * wv; } }
      const r = new Float32Array(Tp); for (let t = 0; t < Tp; t++) r[t] = acc[t] > 0 ? acc[t] : 0; out[f] = r;
    }
    return out;
  }
  const pool = (x, p) => x.map((r) => { const n = Math.floor(r.length / p), o = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < p; j++) s += r[i * p + j]; o[i] = s / p; } return o; });
  const dense = (v, W, b, I, relu) => { const o = new Array(b.length); for (let f = 0; f < b.length; f++) { let s = b[f]; for (let i = 0; i < I; i++) s += v[i] * W[f * I + i]; o[f] = relu && s < 0 ? 0 : s; } return o; };
  const sm = (z) => { const m = Math.max(z[0], z[1]), e0 = Math.exp(z[0] - m), e1 = Math.exp(z[1] - m); return e1 / (e0 + e1); };
  // x: 52 rows of 200 finite numbers (already validated by the caller).
  net.forward = (x, trace = false) => {
    const c1 = conv(x, 52, 200, net.c1, net.b1, 24, 9), p1 = pool(c1, 4), c2 = conv(p1, 24, 48, net.c2, net.b2, 24, 9), p2 = pool(c2, 2), c3 = conv(p2, 24, 20, net.c3, net.b3, 24, 9);
    const feat = new Array(48), arg = new Array(24);
    for (let f = 0; f < 24; f++) { const r = c3[f]; let s = 0, m = -Infinity, a = 0; for (let t = 0; t < r.length; t++) { s += r[t]; if (r[t] > m) { m = r[t]; a = t; } } feat[f] = s / r.length; feat[24 + f] = m; arg[f] = a; }
    const hidden = dense(feat, net.d, net.bd, 48, true), zp = dense(hidden, net.hp, net.bp, 32), zm = dense(hidden, net.hm, net.bm, 32);
    const out = { person: sm(zp), moving: sm(zm) };
    if (trace) { out.layers = { c1, p1, c2, p2, c3, feat, hidden }; out.arg = arg; out.logit = { person: zp[1] - zp[0], moving: zm[1] - zm[0] }; }
    return out;
  };
  return net;
}

// The input cells a cell of a layer can see. Layers in order: x, c1, p1, c2, p2, c3. Returns [first, last] sample of the window.
export const STEPS = [null, { conv: 9 }, { pool: 4 }, { conv: 9 }, { pool: 2 }, { conv: 9 }];
export function fieldOf(layer, a, b = a) { // index range [a, b] in layer -> array of [a, b] for every layer from 0 up to 'layer'
  const out = new Array(layer + 1); out[layer] = [a, b];
  for (let L = layer; L > 0; L--) { const s = STEPS[L]; if (s.conv) b = b + s.conv - 1; else { a = a * s.pool; b = b * s.pool + s.pool - 1; } out[L - 1] = [a, b]; }
  return out;
}
