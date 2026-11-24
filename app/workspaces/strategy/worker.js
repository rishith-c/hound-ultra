// Runs batches of random-world trials off the main thread. One message in, several out:
//   in:  { id, seeds: [..], policies: ['scripted', 'greedy', 'tree'], sensors: { overrides for makeSensors }, params }
//   out: { id, rows: [{ seed, policy, ...result }] } in small chunks so the page can draw progress, then { id, done: true }
import { makeSensors } from './model.js';
import { makeWorld, populate } from './worlds.js';
import { runEpisode } from './policies.js';

export function runBatch({ seeds, policies, sensors, params }, onRows) {
  const S = makeSensors(sensors || {});
  let rows = [];
  for (const seed of seeds) {
    const world = makeWorld(seed, S), truth = populate(world, seed);
    for (const policy of policies) { const { result } = runEpisode(world, truth, policy, params || {}, seed); rows.push({ seed, policy, ...result }); }
    if (rows.length >= 12) { onRows(rows); rows = []; }
  }
  if (rows.length) onRows(rows);
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (e) => {
    const job = e.data;
    try { runBatch(job, (rows) => self.postMessage({ id: job.id, rows })); self.postMessage({ id: job.id, done: true }); }
    catch (err) { self.postMessage({ id: job.id, error: String(err && err.message || err) }); }
  };
}
