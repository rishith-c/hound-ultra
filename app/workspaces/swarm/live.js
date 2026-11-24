// A search running in a worker, played back on the main thread with interpolation. Same shape as createSwarm()
// (world, state, summary, failRelay) plus advance(dt, look). Without workers it steps the engine here instead.
import { createSwarm, DT } from './engine.js';

export function createLive(world, { n, strategy, startCharge }, { layout, seed, blockB }) {
  const local = createSwarm(world, { n, strategy, startCharge, track: true }), S = local.state;
  S.front = null; S.frontRev = 0; S.linkRev = 0;
  let wk = null;
  try { wk = new Worker(new URL('./live-worker.js', import.meta.url), { type: 'module' }); } catch (e) { wk = null; }
  if (!wk) {
    let acc = 0, ref = null; local.step();
    return { world, state: S, inWorker: false, summary: local.summary, buffered: () => 0, dispose() {}, failRelay: (id) => Promise.resolve(local.failRelay(id)),
      advance(dt) { acc += dt; const t0 = performance.now(), was = S.t; while (acc >= DT && performance.now() - t0 < 10) { local.step(); acc -= DT; } if (acc > DT * 6) acc = 0;
        if (ref !== S.clusters) { ref = S.clusters; S.front = Int32Array.from(S.clusters.flatMap((c) => c.cells)); S.frontRev++; } S.linkRev++; return S.t - was; } };
  }
  const q = []; let head = 0, endT = 0, playT = 0, asked = 0, sum = local.summary(), fails = [], dead = false, error = null;
  let A = new Float32Array(n * 3), tA = 0; S.robots.forEach((r, i) => { A[i * 3] = r.x; A[i * 3 + 1] = r.y; A[i * 3 + 2] = r.heading; });
  S.events.length = 0;
  wk.onmessage = (e) => {
    if (dead) return; const d = e.data;
    if (d.frames) { for (const f of d.frames) q.push(f); endT = d.frames[d.frames.length - 1].t; }
    else if ('failed' in d) fails.shift()?.(d.failed);
    else if (d.error) { error = d.error; console.error('[swarm] worker: ' + d.error); }
  };
  wk.onerror = (e) => { error = e.message || 'worker failed'; console.error('[swarm] worker: ' + error); };
  wk.postMessage({ init: { layout, seed, blockB, n, strategy, startCharge } });
  function apply(f) {
    const kn = S.known; for (let i = 0; i < f.ch.length; i++) { kn[f.ch[i]] = f.cv[i]; S.changed.push(f.ch[i]); }
    A = f.pos; tA = f.t;
    const s = f.slow; if (!s) return;
    for (let i = 0; i < n; i++) Object.assign(S.robots[i], s.robots[i]);
    S.links = s.links; S.linkRev++; Object.assign(S.m, s.m); sum = s.summary; if (s.done) S.done = true;
    for (const e of s.ev) { S.events.push(e); if (S.events.length > 400) S.events.shift(); }
    for (const v of s.series) S.series.push(v);
    if (s.relays) { const old = S.relays; S.relays = s.relays; for (const b of S.relays) { const o = old.find((x) => x.id === b.id); if (o && o.dying && b.alive) b.dying = true; } }
    if (s.leads) S.leads = s.leads;
    if (s.front) { S.front = s.front; S.frontRev++; }
  }
  return {
    world, state: S, inWorker: true, get error() { return error; }, summary: () => sum, buffered: () => endT - playT,
    advance(dt, look = 8) {
      const t0 = playT, want = playT + dt + look;
      if (want > asked) { asked = want; wk.postMessage({ upTo: want }); }
      playT = Math.min(playT + dt, Math.max(tA, endT));
      while (head < q.length && q[head].t <= playT) { apply(q[head]); q[head++] = null; }
      if (head > 256) { q.splice(0, head); head = 0; }
      const B = q[head], f = B ? Math.min(1, Math.max(0, (playT - tA) / (B.t - tA))) : 0;
      for (let i = 0; i < n; i++) { const r = S.robots[i], j = i * 3; if (B) { r.x = A[j] + (B.pos[j] - A[j]) * f; r.y = A[j + 1] + (B.pos[j + 1] - A[j + 1]) * f; } else { r.x = A[j]; r.y = A[j + 1]; } r.heading = A[j + 2]; }
      S.t = playT; return playT - t0;
    },
    failRelay(id) { const b = S.relays.find((x) => x.id === id); if (b) b.dying = true; return new Promise((res) => { fails.push(res); wk.postMessage({ fail: id || 'busiest' }); }); },
    dispose() { dead = true; wk.terminate(); },
  };
}
