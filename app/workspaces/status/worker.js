// Runs self-tests away from the screen, so the page keeps its 60 frames a second while they work.
// One message in ({ job, id, part }) is one test or one part of a test; checks stream out as they happen.
import { loadNN } from '../../core/nn.js';
import { runPart } from './suite.js';

// The network gives the same answer to the same window every time (the suite proves it), so the mission tests ask it
// once per window and remember. Tests about the network itself get the plain network.
let nets = null;
async function networks() {
  if (nets) return nets;
  const nn = await loadNN(), memo = new WeakMap();
  return (nets = { plain: nn, quick: { ...nn, infer(x, o) { if (o?.trace) return nn.infer(x, o); let r = memo.get(x); if (!r) memo.set(x, (r = nn.infer(x))); return r; } } });
}
self.onmessage = async ({ data: { job, id, part } }) => {
  try {
    const n = await networks();
    self.postMessage({ job, type: 'part', out: await runPart({ nn: id.startsWith('nn-') ? n.plain : n.quick, id, part, emit: (m) => self.postMessage({ job, ...m }) }) });
  } catch (e) { self.postMessage({ job, type: 'error', message: String(e.message || e) }); }
};
