// Deliberate damage to a normalised window (subcarrier-major floats, 52 rows of 200). The same four definitions as
// corrupt() in tools/forge_export.py; the random draws differ (another generator), the recipe does not.
import { rng, gauss } from './net.js';

export const CORRUPTIONS = {
  interference: { label: 'Interference bursts', unit: '% noise', help: 'Three bursts of wide-band noise, 0.3 to 1.5 s each, on every subcarrier at once: another transmitter on the channel.' },
  dead: { label: 'Dead subcarriers', unit: 'subcarriers', help: 'This many of the 51 subcarriers stop varying and read flat.' },
  step: { label: 'Missed gain step', unit: '% step', help: 'One jump in the receiver gain that the gain-step filter did not remove.' },
  dropout: { label: 'Packet drop-out', unit: 's lost', help: 'No packets for this long; the last value is held.' },
};

export function corrupt(x, off, out, kind, sev, seed) {
  const C = 52, T = 200, r = rng(seed);
  out.set(x.subarray(off, off + C * T));
  if (kind === 'interference') {
    for (let b = 0; b < 3; b++) { const L = Math.floor(6 + r() * 24), t0 = Math.floor(r() * (T - L)); for (let c = 0; c < 51; c++) for (let t = t0; t < t0 + L; t++) out[c * T + t] += gauss(r) * sev; for (let t = t0; t < t0 + L; t++) out[51 * T + t] += sev; }
  } else if (kind === 'dead') {
    const order = Array.from({ length: 51 }, (_, i) => i); for (let i = 50; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (let k = 0; k < Math.min(51, sev); k++) out.fill(0, order[k] * T, order[k] * T + T);
  } else if (kind === 'step') {
    const t0 = 40 + Math.floor(r() * 120), f = t0 / T, sgn = r() < 0.5 ? 1 : -1;
    for (let c = 0; c < 51; c++) for (let t = 0; t < T; t++) out[c * T + t] += t < t0 ? -sgn * sev * (1 - f) : sgn * sev * f;
  } else if (kind === 'dropout') {
    const L = Math.round(sev * 20), t0 = 1 + Math.floor(r() * (T - L - 1));
    for (let c = 0; c < C; c++) { const v = out[c * T + t0 - 1]; for (let t = t0; t < t0 + L; t++) out[c * T + t] = v; }
  }
  for (let c = 0; c < 51; c++) for (let t = 0; t < T; t++) { const v = out[c * T + t]; out[c * T + t] = v > 50 ? 50 : v < -50 ? -50 : v; }
  for (let t = 0; t < T; t++) { const v = out[51 * T + t]; out[51 * T + t] = v > 50 ? 50 : v < -5 ? -5 : v; }
  return out;
}

// ESP32 faults laid over a CLEAN window, one dial each: an approximation, in the normalised window, of what
// esp32() in ml/simulate_csi.py does to the packets before windowing.
//   noise   per-bin receiver noise, % (the messy simulator measures about 0.5 %)
//   steps   residual of gain steps, % (what is left after the gain-step filter)
//   drift   slow common drift across the window, %
//   loss    share of 50 ms bins that hold the previous value (lost packets)
export function addFaults(x, off, out, { noise = 0, steps = 0, drift = 0, loss = 0 }, seed) {
  const C = 52, T = 200, r = rng(seed);
  out.set(x.subarray(off, off + C * T));
  const common = new Float32Array(T);
  if (drift) { const ph = r() * 6.283; for (let t = 0; t < T; t++) common[t] += drift * Math.sin(ph + 1.4 * t / T); }
  if (steps) for (let k = 0; k < 2; k++) { const t0 = 20 + Math.floor(r() * 160), a = (r() < 0.5 ? -1 : 1) * steps * (0.5 + r()); for (let t = t0; t < T; t++) common[t] += a; }
  let mean = 0; for (let t = 0; t < T; t++) mean += common[t]; mean /= T;
  for (let c = 0; c < 51; c++) for (let t = 0; t < T; t++) out[c * T + t] += common[t] - mean + (noise ? gauss(r) * noise : 0);
  if (noise) for (let t = 0; t < T; t++) out[51 * T + t] += noise * 1.2 * (0.8 + 0.4 * r());      // packets inside a bin now differ: the motion row rises
  if (loss) for (let t = 1; t < T; t++) if (r() < loss) for (let c = 0; c < C; c++) out[c * T + t] = out[c * T + t - 1];
  for (let c = 0; c < 51; c++) for (let t = 0; t < T; t++) { const v = out[c * T + t]; out[c * T + t] = v > 50 ? 50 : v < -50 ? -50 : v; }
  for (let t = 0; t < T; t++) { const v = out[51 * T + t]; out[51 * T + t] = v > 50 ? 50 : v < -5 ? -5 : v; }
  return out;
}
