// A small pool of workers that run branch specs. If workers cannot start, the same code runs on the page instead.
export function createPool(nn, { size } = {}) {
  const want = size || Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 2));
  const workers = [], queue = [], jobs = new Map();
  let seq = 0, mode = 'worker', inline = null, dead = false;
  function spawn() {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const rec = { w, busy: null };
    w.onmessage = (ev) => {
      const m = ev.data; if (m.ready) return;
      const j = jobs.get(m.job); if (!j) return;
      if (m.progress != null) { j.onProgress?.(m.progress); return; }
      jobs.delete(m.job); rec.busy = null;
      if (m.error) j.reject(new Error(m.error)); else j.resolve(m.result);
      pump();
    };
    w.onerror = (err) => { // a worker that cannot load: fall back to running on the page
      err.preventDefault?.();
      const j = rec.busy != null ? jobs.get(rec.busy) : null;
      workers.splice(workers.indexOf(rec), 1); try { w.terminate(); } catch { /* already gone */ }
      if (j) { jobs.delete(rec.busy); queue.unshift(j); }
      if (!workers.length) mode = 'page';
      pump();
    };
    workers.push(rec);
  }
  let started = false; // workers start with the first job, not on page load
  function start() { started = true; try { for (let i = 0; i < want; i++) spawn(); } catch { mode = 'page'; } }
  async function runInline(j) {
    inline ||= import('./runner.js');
    const { runSpec } = await inline;
    await new Promise((r) => setTimeout(r, 0));
    const { out } = await runSpec(j.spec, nn, { onProgress: j.onProgress });
    return out;
  }
  let inlineBusy = false;
  function pump() {
    if (dead) return;
    if (mode === 'page') {
      if (inlineBusy || !queue.length) return;
      const j = queue.shift(); inlineBusy = true;
      runInline(j).then(j.resolve, j.reject).finally(() => { inlineBusy = false; pump(); });
      return;
    }
    for (const rec of workers) {
      if (rec.busy != null || !queue.length) continue;
      const j = queue.shift(); rec.busy = j.job; jobs.set(j.job, j);
      rec.w.postMessage({ job: j.job, spec: j.spec });
    }
  }
  return {
    get mode() { return mode; }, get size() { return mode === 'page' ? 1 : started ? workers.length : want; }, get pending() { return queue.length + jobs.size; },
    run(spec, { onProgress, priority = false } = {}) {
      if (!started) start();
      return new Promise((resolve, reject) => { const j = { job: ++seq, spec, onProgress, resolve, reject }; if (priority) queue.unshift(j); else queue.push(j); pump(); });
    },
    dispose() { dead = true; for (const r of workers) r.w.terminate(); workers.length = 0; queue.length = 0; jobs.clear(); },
  };
}
