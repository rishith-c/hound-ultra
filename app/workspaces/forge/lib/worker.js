// One of several workers. Each computes forward passes, or the gradient of its share of a batch; the page adds the
// shares together, so N workers give exactly the gradient one thread would (up to float rounding order).
import { A, createNet, createInt8, decodeWindow, toTimeMajor, quantWindow, zeros } from './net.js';

const net = createNet(Float32Array), int8 = createInt8();
const x = new Float32Array(A.N_IN), xq = new Int32Array(A.N_IN);
let dec = null;

const jobs = {
  setup(m) { dec = m.dec; return { ok: true }; },
  // gradient of a share of one batch. codes: n windows as stored; flips, yP, yM, wP, wM per window.
  grad(m) {
    const G = zeros(Float32Array); let L = 0;
    for (let i = 0; i < m.n; i++) { decodeWindow(m.codes, i * A.N_IN, dec, x, !!m.flips[i]); L += net.loss(x, m.W, m.yP[i], m.wP[i], m.yM[i], m.wM[i], G); }
    return { G, loss: L, _transfer: G.map((g) => g.buffer) };
  },
  // forward only. Windows come as stored codes or as floats (subcarrier-major). Returns logits and the hidden layer.
  forward(m) {
    const n = m.n, person = new Float32Array(n * 2), moving = new Float32Array(n * 2), hidden = m.hidden ? new Float32Array(n * 32) : null;
    for (let i = 0; i < n; i++) {
      if (m.codes) decodeWindow(m.codes, i * A.N_IN, dec, x); else toTimeMajor(m.x, i * A.N_IN, x);
      net.forward(x, m.W);
      person[i * 2] = net.zp[0]; person[i * 2 + 1] = net.zp[1]; moving[i * 2] = net.zm[0]; moving[i * 2 + 1] = net.zm[1];
      if (hidden) hidden.set(net.hid, i * 32);
    }
    return { person, moving, hidden, _transfer: [person.buffer, moving.buffer, ...(hidden ? [hidden.buffer] : [])] };
  },
  int8(m) {
    const n = m.n, person = new Int32Array(n * 2), moving = new Int32Array(n * 2);
    for (let i = 0; i < n; i++) { quantWindow(m.codes, i * A.N_IN, m.q.lutSub, m.q.lutMotion, xq); int8.forward(xq, m.q); person.set(int8.accP, i * 2); moving.set(int8.accM, i * 2); }
    return { person, moving, _transfer: [person.buffer, moving.buffer] };
  },
};

self.onmessage = (e) => {
  const { id, job, ...m } = e.data;
  try { const t0 = performance.now(); const { _transfer = [], ...res } = jobs[job](m); res.ms = performance.now() - t0; self.postMessage({ id, res }, _transfer); }
  catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};
