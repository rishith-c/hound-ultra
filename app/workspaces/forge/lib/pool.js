// A small pool of Web Workers (lib/worker.js). pool.run(job) sends one job to the least busy worker;
// forwardAll / int8All / gradBatch split a set of windows across all of them and put the pieces back in order.
import { A, zeros } from './net.js';

export function createPool(dec, size) {
  const n = size || Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
  const workers = [], pending = new Map(); let seq = 0, dead = false;
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.busy = 0;
    w.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); w.busy--; e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.res); };
    w.onerror = (e) => { for (const [id, p] of pending) if (p.w === w) { pending.delete(id); p.reject(new Error(e.message || 'A worker stopped.')); } };
    workers.push(w);
  }
  const post = (w, msg) => new Promise((resolve, reject) => { if (dead) return reject(new Error('The worker pool was closed.')); const id = ++seq; pending.set(id, { resolve, reject, w }); w.busy++; w.postMessage({ id, ...msg }); });
  const run = (msg) => post(workers.reduce((a, b) => (b.busy < a.busy ? b : a)), msg);
  const ready = Promise.all(workers.map((w) => post(w, { job: 'setup', dec })));
  const chunks = (count) => { const k = Math.min(n, count), out = []; for (let i = 0; i < k; i++) { const a = Math.floor(i * count / k), b = Math.floor((i + 1) * count / k); if (b > a) out.push([a, b]); } return out; };

  // Forward n windows. src = { codes: Int8Array } (as stored) or { x: Float32Array } (floats, subcarrier-major).
  async function forwardAll(W, src, count, { hidden = false } = {}) {
    await ready;
    const parts = await Promise.all(chunks(count).map(([a, b], i) => post(workers[i], { job: 'forward', W, n: b - a, hidden,
      ...(src.codes ? { codes: src.codes.subarray(a * A.N_IN, b * A.N_IN) } : { x: src.x.subarray(a * A.N_IN, b * A.N_IN) }) })));
    const person = new Float32Array(count * 2), moving = new Float32Array(count * 2), hid = hidden ? new Float32Array(count * 32) : null; let o = 0;
    for (const p of parts) { person.set(p.person, o * 2); moving.set(p.moving, o * 2); if (hid) hid.set(p.hidden, o * 32); o += p.person.length / 2; }
    return { person, moving, hidden: hid };
  }
  async function int8All(q, codes, count) {
    await ready;
    const parts = await Promise.all(chunks(count).map(([a, b], i) => post(workers[i], { job: 'int8', q, n: b - a, codes: codes.subarray(a * A.N_IN, b * A.N_IN) })));
    const person = new Int32Array(count * 2), moving = new Int32Array(count * 2); let o = 0, ms = 0;
    for (const p of parts) { person.set(p.person, o * 2); moving.set(p.moving, o * 2); o += p.person.length / 2; ms += p.ms; }
    return { person, moving, ms };
  }
  // The gradient of one batch. batch: { codes (copied out per window), idx[], flips, yP, yM, wP, wM }.
  async function gradBatch(W, data, b) {
    await ready;
    const count = b.idx.length;
    const parts = await Promise.all(chunks(count).map(([s, e], i) => {
      const m = e - s, codes = new Int8Array(m * A.N_IN);
      for (let k = 0; k < m; k++) codes.set(data.subarray(b.idx[s + k] * A.N_IN, (b.idx[s + k] + 1) * A.N_IN), k * A.N_IN);
      return post(workers[i], { job: 'grad', W, n: m, codes, flips: b.flips.subarray(s, e), yP: b.yP.subarray(s, e), yM: b.yM.subarray(s, e), wP: b.wP.subarray(s, e), wM: b.wM.subarray(s, e) });
    }));
    const G = zeros(); let loss = 0;
    for (const p of parts) { loss += p.loss; for (let i = 0; i < 12; i++) { const g = G[i], q = p.G[i]; for (let k = 0; k < g.length; k++) g[k] += q[k]; } }
    return { G, loss };
  }
  return { size: n, run, ready, forwardAll, int8All, gradBatch, close() { dead = true; workers.forEach((w) => w.terminate()); } };
}
