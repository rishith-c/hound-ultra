// HOUND's Wi-Fi network (rover-design-study/ml/net.py) in typed arrays: forward AND backward, float and int8.
//
//   input   52 x 200      51 subcarriers (% change) + the motion row, 20 samples a second for 10 s
//   conv 1  52 -> 24, 9 taps, ReLU, average pool 4        192 -> 48 steps
//   conv 2  24 -> 24, 9 taps, ReLU, average pool 2         40 -> 20 steps
//   conv 3  24 -> 24, 9 taps, ReLU                         12 steps
//   mean and max over time -> 48, dense 48 -> 32, ReLU, heads: person (2), moving (2)        23,372 parameters
//
// Layout. Signals are time-major: x[t * C + c]. A convolution weight is stored one filter after another,
// W[f * K + j * C + c] with K = 9 * C, so each output is one dot product of two contiguous runs of K numbers.
// (NumPy keeps W[c * 9 + j, f]; fromPython / toPython convert.) Dense weights are W[out * nIn + in].
export const A = { C: 52, T: 200, k: 9, F: 24, H: 32, T1: 192, P1: 48, T2: 40, P2: 20, T3: 12, N_IN: 10400, PARAMS: 23372 };
export const SHAPES = [[468, 24], [24], [216, 24], [24], [216, 24], [24], [48, 32], [32], [32, 2], [2], [32, 2], [2]];
export const NAMES = ['conv1.W', 'conv1.b', 'conv2.W', 'conv2.b', 'conv3.W', 'conv3.b', 'dense.W', 'dense.b', 'person.W', 'person.b', 'moving.W', 'moving.b'];
export const SIZES = SHAPES.map((s) => s.reduce((a, b) => a * b, 1));
const CONV_C = [52, 24, 24];

// NumPy layout -> ours, and back. i is the tensor's place in net.params().
export function fromPython(arr, i, Type = Float32Array) {
  const out = new Type(SIZES[i]);
  if (SHAPES[i].length === 1) { out.set(arr); return out; }
  const [rows, F] = SHAPES[i];
  if (i <= 4) { const C = CONV_C[i / 2], k = 9; for (let c = 0; c < C; c++) for (let j = 0; j < k; j++) for (let f = 0; f < F; f++) out[f * rows + j * C + c] = arr[(c * k + j) * F + f]; }
  else for (let n = 0; n < rows; n++) for (let f = 0; f < F; f++) out[f * rows + n] = arr[n * F + f];
  return out;
}
export function toPython(arr, i, Type = Float32Array) {
  const out = new Type(SIZES[i]);
  if (SHAPES[i].length === 1) { out.set(arr); return out; }
  const [rows, F] = SHAPES[i];
  if (i <= 4) { const C = CONV_C[i / 2], k = 9; for (let c = 0; c < C; c++) for (let j = 0; j < k; j++) for (let f = 0; f < F; f++) out[(c * k + j) * F + f] = arr[f * rows + j * C + c]; }
  else for (let n = 0; n < rows; n++) for (let f = 0; f < F; f++) out[n * F + f] = arr[f * rows + n];
  return out;
}
export const zeros = (Type = Float32Array) => SIZES.map((n) => new Type(n));
export const clone = (W) => W.map((w) => w.slice());

// Small seeded generator (mulberry32) and a normal draw, so "seed 3" always starts from the same random weights.
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function gauss(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
// He initialisation, as net.py: std = sqrt(2 / fan-in) for the body, sqrt(1 / fan-in) for the heads; biases zero.
export function init(seed, Type = Float32Array) {
  const r = rng(seed), W = zeros(Type);
  for (let i = 0; i < 12; i += 2) { const fanIn = SHAPES[i][0], std = Math.sqrt((i >= 8 ? 1 : 2) / fanIn), w = W[i]; for (let n = 0; n < w.length; n++) w[n] = gauss(r) * std; }
  return W;
}

// One network instance = scratch buffers for one window. Type is Float32Array (training) or Float64Array (the
// finite-difference check needs the extra digits).
export function createNet(Type = Float32Array) {
  const { C, F, H, T1, P1, T2, P2, T3 } = A, K1 = 9 * C, K2 = 9 * F;
  const c1 = new Type(T1 * F), p1 = new Type(P1 * F), c2 = new Type(T2 * F), p2 = new Type(P2 * F), c3 = new Type(T3 * F);
  const feat = new Type(2 * F), hid = new Type(H), zp = new Type(2), zm = new Type(2), arg = new Int32Array(F);
  const dhid = new Type(H), dfeat = new Type(2 * F), dc3 = new Type(T3 * F), dp2 = new Type(P2 * F), dc2 = new Type(T2 * F), dp1 = new Type(P1 * F), dc1 = new Type(T1 * F);

  function conv(x, Cin, Tp, W, b, out, relu = true) {
    const K = 9 * Cin;
    for (let t = 0; t < Tp; t++) {
      const base = t * Cin, o = t * F;
      for (let f = 0; f < F; f++) { let s = b[f]; const wo = f * K; for (let i = 0; i < K; i++) s += x[base + i] * W[wo + i]; out[o + f] = relu && s < 0 ? 0 : s; }
    }
  }
  function pool(x, Tp, p, out) { const inv = 1 / p; for (let u = 0; u < Tp; u++) for (let f = 0; f < F; f++) { let s = 0; for (let q = 0; q < p; q++) s += x[(u * p + q) * F + f]; out[u * F + f] = s * inv; } }

  // x: one window, time-major (200 * 52). Fills the layer buffers; returns nothing. Read net.zp / net.zm / net.hid.
  function forward(x, W) {
    conv(x, C, T1, W[0], W[1], c1); pool(c1, P1, 4, p1);
    conv(p1, F, T2, W[2], W[3], c2); pool(c2, P2, 2, p2);
    conv(p2, F, T3, W[4], W[5], c3);
    for (let f = 0; f < F; f++) { let s = 0, m = -Infinity, a = 0; for (let t = 0; t < T3; t++) { const v = c3[t * F + f]; s += v; if (v > m) { m = v; a = t; } } feat[f] = s / T3; feat[F + f] = m; arg[f] = a; }
    const Wd = W[6], bd = W[7];
    for (let h = 0; h < H; h++) { let s = bd[h]; const wo = h * 48; for (let i = 0; i < 48; i++) s += feat[i] * Wd[wo + i]; hid[h] = s > 0 ? s : 0; }
    for (let o = 0; o < 2; o++) { let s = W[9][o], u = W[11][o]; for (let h = 0; h < H; h++) { s += hid[h] * W[8][o * H + h]; u += hid[h] * W[10][o * H + h]; } zp[o] = s; zm[o] = u; }
  }

  function convBack(x, Cin, Tp, W, g, GW, Gb, dx) {
    const K = 9 * Cin;
    if (dx) dx.fill(0);
    for (let t = 0; t < Tp; t++) {
      const base = t * Cin, o = t * F;
      for (let f = 0; f < F; f++) {
        const gv = g[o + f]; if (gv === 0) continue;          // ReLU switched this unit off: nothing flows back
        const wo = f * K; Gb[f] += gv;
        for (let i = 0; i < K; i++) GW[wo + i] += gv * x[base + i];
        if (dx) for (let i = 0; i < K; i++) dx[base + i] += gv * W[wo + i];
      }
    }
  }
  // After forward(x, W): add this window's gradients to G, for the loss gradient at the two heads' logits.
  function backward(x, W, dzp, dzm, G) {
    dhid.fill(0);
    for (let o = 0; o < 2; o++) {
      const a = dzp[o], b = dzm[o]; G[9][o] += a; G[11][o] += b;
      for (let h = 0; h < H; h++) { G[8][o * H + h] += a * hid[h]; G[10][o * H + h] += b * hid[h]; dhid[h] += a * W[8][o * H + h] + b * W[10][o * H + h]; }
    }
    dfeat.fill(0);
    for (let h = 0; h < H; h++) { if (!(hid[h] > 0)) continue; const gv = dhid[h], wo = h * 48; G[7][h] += gv; for (let i = 0; i < 48; i++) { G[6][wo + i] += gv * feat[i]; dfeat[i] += gv * W[6][wo + i]; } }
    for (let f = 0; f < F; f++) { const gm = dfeat[f] / T3; for (let t = 0; t < T3; t++) { const j = t * F + f; dc3[j] = c3[j] > 0 ? gm + (t === arg[f] ? dfeat[F + f] : 0) : 0; } }
    convBack(p2, F, T3, W[4], dc3, G[4], G[5], dp2);
    for (let u = 0; u < P2; u++) for (let f = 0; f < F; f++) { const gv = dp2[u * F + f] / 2; for (let q = 0; q < 2; q++) { const j = (u * 2 + q) * F + f; dc2[j] = c2[j] > 0 ? gv : 0; } }
    convBack(p1, F, T2, W[2], dc2, G[2], G[3], dp1);
    for (let u = 0; u < P1; u++) for (let f = 0; f < F; f++) { const gv = dp1[u * F + f] / 4; for (let q = 0; q < 4; q++) { const j = (u * 4 + q) * F + f; dc1[j] = c1[j] > 0 ? gv : 0; } }
    convBack(x, C, T1, W[0], dc1, G[0], G[1], null);
  }
  // Cross-entropy for one window on both heads, as net.py's loss(): wP, wM are this window's share of the batch
  // (class weight / sum of class weights in the batch); yM = -1 means "no label" (an empty room has no still/moving).
  // Runs forward, adds gradients to G when G is given, returns the loss.
  const dzp = new Type(2), dzm = new Type(2);
  function loss(x, W, yP, wP, yM, wM, G) {
    forward(x, W);
    const pp = softmax2(zp[0], zp[1]), pm = softmax2(zm[0], zm[1]);
    let L = -wP * Math.log((yP ? pp : 1 - pp) + 1e-9);
    dzp[0] = wP * ((1 - pp) - (yP === 0 ? 1 : 0)); dzp[1] = wP * (pp - (yP === 1 ? 1 : 0));
    if (yM >= 0) { L += -wM * Math.log((yM ? pm : 1 - pm) + 1e-9); dzm[0] = wM * ((1 - pm) - (yM === 0 ? 1 : 0)); dzm[1] = wM * (pm - (yM === 1 ? 1 : 0)); } else { dzm[0] = 0; dzm[1] = 0; }
    if (G) backward(x, W, dzp, dzm, G);
    return L;
  }
  return { forward, backward, loss, c1, p1, c2, p2, c3, feat, hid, zp, zm, arg };
}
// P(class 1) from two logits.
export const softmax2 = (z0, z1) => 1 / (1 + Math.exp(z0 - z1));

// Stored window (int8 codes, subcarrier-major: code[c * 200 + t]) -> the network's input (time-major floats).
// dec is the 256-entry table from data/forge (fine steps near zero, coarse steps far out). flip reverses time.
export function decodeWindow(codes, off, dec, out, flip = false) {
  const { C, T } = A;
  for (let c = 0; c < C; c++) { const row = off + c * T; if (flip) for (let t = 0; t < T; t++) out[t * C + c] = dec[codes[row + T - 1 - t] + 128]; else for (let t = 0; t < T; t++) out[t * C + c] = dec[codes[row + t] + 128]; }
  return out;
}
// Float window, subcarrier-major (52 rows of 200) -> time-major.
export function toTimeMajor(x, off, out) { const { C, T } = A; for (let c = 0; c < C; c++) for (let t = 0; t < T; t++) out[t * C + c] = x[off + c * T + t]; return out; }

// Adam exactly as net.py: weight decay 1e-4 added to the gradient of matrices only.
export function createAdam(W, { lr = 2e-3, b1 = 0.9, b2 = 0.999, wd = 1e-4 } = {}) {
  const m = W.map((w) => new Float32Array(w.length)), v = W.map((w) => new Float32Array(w.length));
  const opt = { lr, t: 0, step(G, mask) {
    opt.t++; const c1 = 1 - Math.pow(b1, opt.t), c2 = 1 - Math.pow(b2, opt.t);
    for (let i = 0; i < W.length; i++) { const w = W[i], g = G[i], mi = m[i], vi = v[i], decay = i % 2 === 0 ? wd : 0, mk = mask?.[i];
      for (let n = 0; n < w.length; n++) { const gn = g[n] + decay * w[n]; mi[n] = b1 * mi[n] + (1 - b1) * gn; vi[n] = b2 * vi[n] + (1 - b2) * gn * gn; w[n] -= opt.lr * (mi[n] / c1) / (Math.sqrt(vi[n] / c2) + 1e-8); if (mk && !mk[n]) w[n] = 0; } }
  } };
  return opt;
}

// ---------------------------------------------------------------------------------------------------------------
// int8: integer-only inference, the arithmetic a microcontroller would run. q comes from tools/forge_export.py:
//   W[6] Int8Array (our layout), B[6] Int32Array, mult[4] = [m, shift] (15-bit multiplier and a right shift).
// Activations are uint8 (0..255) after ReLU. Every operation below is exact integer arithmetic (the products stay
// far under 2^53), so the result must equal NumPy's bit for bit.
export function createInt8() {
  const { C, F, H, T1, P1, T2, P2, T3 } = A;
  const c1 = new Int32Array(T1 * F), p1 = new Int32Array(P1 * F), c2 = new Int32Array(T2 * F), p2 = new Int32Array(P2 * F), c3 = new Int32Array(T3 * F), feat = new Int32Array(48), hid = new Int32Array(H);
  const accP = new Int32Array(2), accM = new Int32Array(2);
  const rq = (acc, m, sh) => { const v = Math.floor((acc * m + Math.pow(2, sh - 1)) / Math.pow(2, sh)); return v < 0 ? 0 : v > 255 ? 255 : v; };
  function conv(x, Cin, Tp, W, B, m, sh, out) { const K = 9 * Cin; for (let t = 0; t < Tp; t++) { const base = t * Cin; for (let f = 0; f < F; f++) { let s = B[f]; const wo = f * K; for (let i = 0; i < K; i++) s += x[base + i] * W[wo + i]; out[t * F + f] = rq(s, m, sh); } } }
  function pool(x, Tp, p, out) { for (let u = 0; u < Tp; u++) for (let f = 0; f < F; f++) { let s = 0; for (let q = 0; q < p; q++) s += x[(u * p + q) * F + f]; out[u * F + f] = Math.floor((s + p / 2) / p); } }
  function forward(xq, q) {
    conv(xq, C, T1, q.W[0], q.B[0], q.mult[0][0], q.mult[0][1], c1); pool(c1, P1, 4, p1);
    conv(p1, F, T2, q.W[1], q.B[1], q.mult[1][0], q.mult[1][1], c2); pool(c2, P2, 2, p2);
    conv(p2, F, T3, q.W[2], q.B[2], q.mult[2][0], q.mult[2][1], c3);
    for (let f = 0; f < F; f++) { let s = 0, mx = 0; for (let t = 0; t < T3; t++) { const v = c3[t * F + f]; s += v; if (v > mx) mx = v; } feat[f] = Math.floor((2 * s + T3) / (2 * T3)); feat[F + f] = mx; }
    for (let h = 0; h < H; h++) { let s = q.B[3][h]; for (let i = 0; i < 48; i++) s += feat[i] * q.W[3][h * 48 + i]; hid[h] = rq(s, q.mult[3][0], q.mult[3][1]); }
    for (let o = 0; o < 2; o++) { let s = q.B[4][o], u = q.B[5][o]; for (let h = 0; h < H; h++) { s += hid[h] * q.W[4][o * H + h]; u += hid[h] * q.W[5][o * H + h]; } accP[o] = s; accM[o] = u; }
  }
  return { forward, accP, accM, hid, c1, c3 };
}
// Stored window codes -> the int8 input, through the two 256-entry tables (subcarrier rows, motion row).
export function quantWindow(codes, off, lutSub, lutMotion, out) {
  const { C, T } = A;
  for (let c = 0; c < C; c++) { const lut = c === 51 ? lutMotion : lutSub, row = off + c * T; for (let t = 0; t < T; t++) out[t * C + c] = lut[codes[row + t] + 128]; }
  return out;
}
