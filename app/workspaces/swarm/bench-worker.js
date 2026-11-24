// Runs whole searches off the main thread for the strategy comparison. Same engine as the live view.
import { genWorld, runHeadless } from './engine.js';
self.onmessage = (e) => {
  const { id, layout, seed, n, strategy, startCharge, pair, blockB } = e.data;
  try {
    const world = genWorld({ layout, seed, blockB });
    const r = runHeadless(world, { n, strategy, startCharge, pair });
    self.postMessage({ id, ok: true, result: { ...r, series: Array.from(r.series) } });
  } catch (err) { self.postMessage({ id, ok: false, error: String(err && err.message || err) }); }
};
