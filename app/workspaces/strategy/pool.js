// Run random-world trials on a few workers, streaming rows back. Returns { cancel(), done: Promise }.
//   jobs: [{ key, policies, sensors, params }], seeds: [..], onRows(key, rows)
export function runPool({ jobs, seeds, onRows, size = 4, chunk = 40 }) {
  const queue = []; for (let i = 0; i < seeds.length; i += chunk) for (const j of jobs) queue.push({ ...j, seeds: seeds.slice(i, i + chunk) });
  const workers = []; let stop = false, id = 0;
  const one = () => new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); workers.push(w); let cur = null;
    const next = () => { if (stop || !queue.length) { w.terminate(); resolve(); return; } cur = queue.shift(); w.postMessage({ id: ++id, seeds: cur.seeds, policies: cur.policies, sensors: cur.sensors, params: cur.params }); };
    w.onmessage = (e) => { if (stop) return; const m = e.data; if (m.rows) onRows(cur.key, m.rows); if (m.done) next(); if (m.error) { w.terminate(); reject(new Error(m.error)); } };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'A worker stopped')); };
    next();
  });
  const n = Math.max(1, Math.min(size, (navigator.hardwareConcurrency || 4) - 2));
  return { cancel() { stop = true; workers.forEach((w) => w.terminate()); }, done: Promise.all(Array.from({ length: n }, one)) };
}
