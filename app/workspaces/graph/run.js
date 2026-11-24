// One finished run of the mission, for the Demo heroes of Evidence and Report (so they are never half empty).
// If the live mission is already complete, its own commands are replayed, so every fault and choice is in it.
// Otherwise the same exercise is run from start to end in the background, a few milliseconds per frame.
// Positions are recorded once per simulated second (the live state keeps trails without times).
import { createEngine } from '../../core/sim.js';

let cache = null;
const END = 1500;                                                   // simulated seconds; a normal run ends near 620

export function finishedRun(ctx) {
  const live = ctx.sim.state.phase === 'complete', log = live ? ctx.sim.commandLog : [];
  const key = live ? 'live:' + ctx.sim.state.t.toFixed(0) + ':' + log.length : 'clean';
  if (cache?.key === key) return cache.promise;
  cache = { key, promise: run(ctx, log, live) };
  cache.promise.catch(() => { cache = null; });
  return cache.promise;
}

async function run(ctx, log, live) {
  const { seed } = ctx.sim.options;
  const e = createEngine({ nn: ctx.nn, seed, keep: { autoplay: true, operator: ctx.sim.state.operator } });
  const cmds = log.slice().sort((a, b) => a.t - b.t);
  const tracks = {}; for (const u of Object.values(e.state.units)) tracks[u.id] = [];
  let i = 0, nextT = 0, tail = 0;
  const sample = () => { for (const u of Object.values(e.state.units)) tracks[u.id].push([e.state.t, u.pos[0], u.pos[1], u.alt || 0]); };
  while (e.state.t < END && tail < 2) {
    const until = performance.now() + 7;
    while (performance.now() < until && e.state.t < END && tail < 2) {
      while (i < cmds.length && cmds[i].t <= e.state.t + 1e-9) { e.command(cmds[i].name, cmds[i].args); i++; }
      if (e.state.t >= nextT) { sample(); nextT += 1; }
      e.step();
      if (e.state.phase === 'complete') tail += 0.1;
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  sample();
  if (e.state.phase !== 'complete' && live) return run(ctx, [], false);
  return { state: e.state, tracks, live, end: e.state.t, commandLog: cmds };
}
