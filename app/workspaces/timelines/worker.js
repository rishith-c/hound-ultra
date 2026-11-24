// Timelines worker: runs whole missions off the page so the console stays smooth. One job at a time per worker.
import { loadNN } from '../../core/nn.js';
import { runSpec } from './runner.js';

let nn = null;
self.onmessage = async (ev) => {
  const { job, spec } = ev.data;
  try {
    nn ||= await loadNN();
    const { out, transfer } = await runSpec(spec, nn, { onProgress: (p) => self.postMessage({ job, progress: p }) });
    self.postMessage({ job, result: out }, transfer);
  } catch (err) {
    self.postMessage({ job, error: String(err && err.message ? err.message : err) });
  }
};
self.postMessage({ ready: true });
