// A spiking copy of the trained network: integrate-and-fire neurons, rate coding.
//
// Conversion (data-based threshold balancing; Diehl et al. 2015, Rueckauer et al. 2017): each layer's weights are
// rescaled by lambda(previous) / lambda(this), where lambda is the 99.9th percentile of that layer's activations on
// training windows (measured in tools/forge_export.py). Every neuron then fires at threshold 1 and is reset by
// subtraction, so its firing rate approximates the ReLU activation / lambda.
//   - the input is not spikes: the first convolution injects a constant current each step (analog input coding);
//   - average pooling is linear, so pooled spikes are passed on as fractions;
//   - "max over time" is a gate: the time step with the most spikes so far passes its spikes on;
//   - the two heads do not spike: they read the hidden layer's spike counts.
import { A } from './net.js';

export function createSNN(W, lambda) {
  const { C, F, H, T1, P1, T2, P2, T3 } = A, K = 9 * F;
  const scale = (w, s) => { const o = new Float32Array(w.length); for (let i = 0; i < w.length; i++) o[i] = w[i] * s; return o; };
  const W2 = scale(W[2], lambda[0] / lambda[1]), b2 = scale(W[3], 1 / lambda[1]);
  const W3 = scale(W[4], lambda[1] / lambda[2]), b3 = scale(W[5], 1 / lambda[2]);
  const W4 = scale(W[6], lambda[2] / lambda[3]), b4 = scale(W[7], 1 / lambda[3]);
  const I1 = new Float32Array(T1 * F), V1 = new Float32Array(T1 * F), V2 = new Float32Array(T2 * F), V3 = new Float32Array(T3 * F), V4 = new Float32Array(H);
  const s1 = new Uint8Array(T1 * F), s2 = new Uint8Array(T2 * F), s3 = new Uint8Array(T3 * F), s4 = new Uint8Array(H), smax = new Uint8Array(F);
  const p1 = new Float32Array(P1 * F), p2 = new Float32Array(P2 * F), cnt3 = new Int32Array(T3 * F), cnt4 = new Int32Array(H), cnt1 = new Int32Array(T1 * F), cnt2 = new Int32Array(T2 * F);
  const feat = new Float32Array(48);
  const fan2 = Array.from({ length: P1 }, (_, u) => (Math.min(u, T2 - 1) - Math.max(u - 8, 0) + 1) * F), fan3 = Array.from({ length: P2 }, (_, u) => (Math.min(u, T3 - 1) - Math.max(u - 8, 0) + 1) * F);
  const st = { t: 0, synops: 0, spikes: [0, 0, 0, 0], s1, s2, s3, s4, smax, cnt1, cnt2, cnt3, cnt4, V4, neurons: [T1 * F, T2 * F, T3 * F, H] };

  // Event-driven convolution: only positions that received something are visited.
  function convAdd(p, Tin, Tout, Wt, b, V) {
    for (let t = 0; t < Tout; t++) for (let f = 0; f < F; f++) V[t * F + f] += b[f];
    for (let u = 0; u < Tin; u++) for (let c = 0; c < F; c++) {
      const v = p[u * F + c]; if (v === 0) continue;
      const lo = Math.max(0, u - 8), hi = Math.min(Tout - 1, u);
      for (let t = lo; t <= hi; t++) { const j = u - t, wi = j * F + c; for (let f = 0; f < F; f++) V[t * F + f] += v * Wt[f * K + wi]; }
    }
  }
  function fire(V, s, cnt, n) { let k = 0; for (let i = 0; i < n; i++) { if (V[i] >= 1) { V[i] -= 1; s[i] = 1; cnt[i]++; k++; } else s[i] = 0; } return k; }

  // x: one window, time-major floats. Clears all membranes.
  st.reset = (x) => {
    for (let t = 0; t < T1; t++) { const base = t * C; for (let f = 0; f < F; f++) { let s = W[1][f]; const wo = f * 9 * C; for (let i = 0; i < 9 * C; i++) s += x[base + i] * W[0][wo + i]; I1[t * F + f] = s / lambda[0]; } }
    for (const a of [V1, V2, V3, V4, cnt1, cnt2, cnt3, cnt4]) a.fill(0);
    st.t = 0; st.synops = 0; st.spikes = [0, 0, 0, 0];
  };
  st.step = () => {
    st.t++;
    for (let i = 0; i < V1.length; i++) V1[i] += I1[i];
    st.spikes[0] += fire(V1, s1, cnt1, V1.length);
    p1.fill(0); for (let u = 0; u < P1; u++) for (let f = 0; f < F; f++) { let s = 0; for (let q = 0; q < 4; q++) s += s1[(u * 4 + q) * F + f]; if (s) { p1[u * F + f] = s / 4; st.synops += s * fan2[u]; } }
    convAdd(p1, P1, T2, W2, b2, V2);
    st.spikes[1] += fire(V2, s2, cnt2, V2.length);
    p2.fill(0); for (let u = 0; u < P2; u++) for (let f = 0; f < F; f++) { const s = s2[(u * 2) * F + f] + s2[(u * 2 + 1) * F + f]; if (s) { p2[u * F + f] = s / 2; st.synops += s * fan3[u]; } }
    convAdd(p2, P2, T3, W3, b3, V3);
    const k3 = fire(V3, s3, cnt3, V3.length); st.spikes[2] += k3; st.synops += k3 * H;
    for (let f = 0; f < F; f++) { let s = 0, best = -1, at = 0; for (let t = 0; t < T3; t++) { s += s3[t * F + f]; if (cnt3[t * F + f] > best) { best = cnt3[t * F + f]; at = t; } } feat[f] = s / T3; smax[f] = s3[at * F + f]; feat[F + f] = smax[f]; if (smax[f]) st.synops += H; }
    for (let h = 0; h < H; h++) { let s = b4[h]; for (let i = 0; i < 48; i++) if (feat[i] !== 0) s += feat[i] * W4[h * 48 + i]; V4[h] += s; }
    const k4 = fire(V4, s4, cnt4, H); st.spikes[3] += k4; st.synops += k4 * 4;
  };
  // The answer so far: logits from the hidden layer's spike counts.
  st.read = () => { const z = [W[9][0], W[9][1], W[11][0], W[11][1]]; for (let h = 0; h < H; h++) { const rte = lambda[3] * cnt4[h] / st.t; z[0] += rte * W[8][h]; z[1] += rte * W[8][H + h]; z[2] += rte * W[10][h]; z[3] += rte * W[10][H + h]; } return { person: 1 / (1 + Math.exp(z[0] - z[1])), moving: 1 / (1 + Math.exp(z[2] - z[3])) }; };
  return st;
}
