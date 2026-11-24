// Runs the tap detector test off the main thread so the live display stays smooth.
import { runTest } from './dsp.js';
self.onmessage = async (e) => {
  let last = 0;
  const res = await runTest({ seed: e.data.seed, onProgress: (r, f) => { const now = performance.now(); if (f === 1 || now - last > 120) { last = now; self.postMessage({ res: r, frac: f }); } } });
  self.postMessage({ res, frac: 1 });
};
