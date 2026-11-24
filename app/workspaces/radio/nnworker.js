// Runs the real Wi-Fi network (app/core/nn.js, same weights, same code) off the main thread, so the hero never drops a frame.
import { loadNN } from '../../core/nn.js';
const ready = loadNN();
self.onmessage = async (e) => {
  try { const nn = await ready, t0 = performance.now(), o = nn.infer(e.data.x); self.postMessage({ id: e.data.id, person: o.person, moving: o.moving, ms: performance.now() - t0, threshold: nn.threshold }); }
  catch (err) { self.postMessage({ id: e.data.id, error: String(err && err.message || err) }); }
};
