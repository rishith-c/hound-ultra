// HOUND's Wi-Fi neural network, running in the browser.
//
// This is the real trained network from the rover project (ml/net.py, 23,372 parameters): a 1-D CNN over a
// 10-second window of Wi-Fi channel state information (52 rows x 200 time steps).
//   conv 52->24 (9 taps) ReLU, average pool 4
//   conv 24->24 (9 taps) ReLU, average pool 2
//   conv 24->24 (9 taps) ReLU
//   mean and max over time -> 48, dense 48->32 ReLU, two heads: person (2) and moving (2)
// The weights and 30 held-out test windows (6 per situation) are in data/nn.json. Every window is SIMULATED
// (Blender people in a channel simulator). No window was recorded with the rover. `ref` on each sample is the
// Python output for the same window, so the browser result can be checked against it.
let model = null;

export function conv(x, Wt, b, k) {
  const C = x.length, T = x[0].length, F = b.length, Tp = T - k + 1, out = [];
  for (let f = 0; f < F; f++) {
    const r = new Float32Array(Tp);
    for (let t = 0; t < Tp; t++) {
      let s = b[f];
      for (let c = 0; c < C; c++) { const xc = x[c]; for (let j = 0; j < k; j++) s += xc[t + j] * Wt[c * k + j][f]; }
      r[t] = s > 0 ? s : 0;
    }
    out.push(r);
  }
  return out;
}
export const pool = (x, p) => x.map((r) => { const n = Math.floor(r.length / p), o = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < p; j++) s += r[i * p + j]; o[i] = s / p; } return o; });
export const dense = (v, Wt, b, relu) => Array.from(b, (bb, f) => { let s = bb; for (let i = 0; i < v.length; i++) s += v[i] * Wt[i][f]; return relu ? Math.max(0, s) : s; });
const softmax1 = (z) => { const m = Math.max(z[0], z[1]), e0 = Math.exp(z[0] - m), e1 = Math.exp(z[1] - m); return e1 / (e0 + e1); };

// Forward pass. x is 52 rows of 200 numbers (already normalised). Returns { person, moving } probabilities.
// With { trace: true } it also returns every layer's output for drawing.
export function forward(x, w, { trace = false } = {}) {
  const c1 = conv(x, w[0], w[1], 9), p1 = pool(c1, 4);
  const c2 = conv(p1, w[2], w[3], 9), p2 = pool(c2, 2);
  const c3 = conv(p2, w[4], w[5], 9);
  const feat = [...c3.map((r) => r.reduce((a, b) => a + b, 0) / r.length), ...c3.map((r) => Math.max(...r))];
  const hidden = dense(feat, w[6], w[7], true);
  const person = softmax1(dense(hidden, w[8], w[9])), moving = softmax1(dense(hidden, w[10], w[11]));
  return trace ? { person, moving, layers: { c1, p1, c2, p2, c3, feat, hidden } } : { person, moving };
}

export async function loadNN(url = new URL('../../data/nn.json', import.meta.url)) {
  if (model) return model;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the network file (${res.status}).`);
  const raw = await res.json();
  if (!Array.isArray(raw.weights) || raw.weights.length !== 12 || !Array.isArray(raw.samples)) throw new Error('The network file is not in the expected format.');
  const byCat = {};
  raw.samples.forEach((s, i) => { (byCat[s.cat] ||= []).push(i); });
  model = {
    weights: raw.weights, samples: raw.samples, threshold: raw.threshold, byCat,
    categories: Object.keys(byCat),
    params: 23372,
    infer(x, opts) {
      if (!Array.isArray(x) || x.length !== 52 || x.some((r) => !r || r.length !== 200)) throw new Error('A Wi-Fi window must be 52 rows by 200 samples.');
      for (const row of x) for (let i = 0; i < row.length; i++) if (!Number.isFinite(row[i])) throw new Error('The Wi-Fi window contains a value that is not a number.');
      return forward(x, raw.weights, opts);
    },
    inferSample(i, opts) {
      const s = raw.samples[i];
      if (!s) throw new Error(`There is no sample ${i}.`);
      const t0 = performance.now(), out = this.infer(s.x, opts);
      return { ...out, ms: performance.now() - t0, says: out.person > raw.threshold, truth: s.cat, truthPerson: !!s.person, ref: s.ref, matchesPython: Math.abs(out.person - s.ref[0]) < 0.01, index: i };
    },
  };
  return model;
}
