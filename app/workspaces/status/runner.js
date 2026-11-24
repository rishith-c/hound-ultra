// Runs the suite on a few workers at once. emit: { start, checks, end, done, error }.
import { SUITE, joinParts } from './suite.js';

export function createRunner(emit) {
  const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
  let workers = [], run = 0;
  function stop() { run++; for (const w of workers) w.terminate(); workers = []; }
  function go(only = null) {
    stop(); const mine = run, T0 = performance.now(), tests = SUITE.filter((t) => !only || only.includes(t.id)), parts = new Map(), results = [];
    // Long tests first in each worker's eyes would hide the short ones, so keep the suite's order but start the split test early.
    const queue = []; for (const t of tests) { const n = t.parts || 1; parts.set(t.id, { need: n, got: [], started: false }); for (let p = 0; p < n; p++) queue.push({ id: t.id, part: p }); }
    const left = () => [...parts.values()].some((p) => p.got.length < p.need);
    const next = (w) => {
      const j = queue.shift(); if (!j) return; w.job = j; const rec = parts.get(j.id);
      if (!rec.started) { rec.started = true; emit({ type: 'start', id: j.id }); }
      w.postMessage({ job: mine, ...j });
    };
    const finishPart = (w, out) => {
      const rec = parts.get(out.id); rec.got.push(out);
      if (rec.got.length === rec.need) { const r = joinParts(out.id, rec.got.sort((a, b) => a.part - b.part)); results.push(r); emit({ type: 'end', id: out.id, result: r }); }
      if (!left()) {
        results.sort((a, b) => SUITE.findIndex((t) => t.id === a.id) - SUITE.findIndex((t) => t.id === b.id));
        const sum = (k) => results.reduce((s, r) => s + r[k], 0), out2 = { when: new Date().toISOString(), ms: performance.now() - T0, results, passed: sum('passed'), failed: sum('failed'), limits: sum('limits') };
        out2.checks = out2.passed + out2.failed + out2.limits; out2.workers = workers.length; stop(); emit({ type: 'done', out: out2, partial: !!only });
      } else next(w);
    };
    const broken = (message) => { if (mine === run) { stop(); emit({ type: 'error', message }); } };
    for (let i = 0; i < Math.min(size, queue.length || 1); i++) {
      let w; try { w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); } catch (e) { broken(String(e.message || e)); return; }
      w.onmessage = ({ data: m }) => { if (mine !== run) return; if (m.type === 'error') broken(m.message); else if (m.type === 'part') finishPart(w, m.out); else emit(m); };
      w.onerror = (e) => { e.preventDefault?.(); broken(e.message || 'This browser cannot start a module worker.'); };
      workers.push(w);
    }
    for (const w of workers) next(w);
  }
  return { go, stop, get busy() { return workers.length > 0; } };
}
