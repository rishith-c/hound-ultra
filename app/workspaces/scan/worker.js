// Runs compute.js off the main thread. Messages: { id, op, payload } in; { id, progress, text } and { id, result } or { id, error } out.
import { handle } from './compute.js';
self.onmessage = async (e) => {
  const { id, op, payload } = e.data;
  try { const result = await handle(op, payload, (f, text, partial) => self.postMessage({ id, progress: f, text, partial }, partial ? [partial.pos.buffer, partial.inten.buffer] : [])); self.postMessage({ id, result }); }
  catch (err) { self.postMessage({ id, error: String(err && err.message ? err.message : err) }); }
};
self.postMessage({ ready: true });
