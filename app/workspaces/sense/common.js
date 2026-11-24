// Shared helpers for the Wi-Fi AI workspace.
let evalPromise = null;
// The 955-window test-set export (scores and labels only). Written and verified by tools/export_eval.py.
export function loadEval() {
  evalPromise ||= fetch(new URL('../../../data/eval_scores.json', import.meta.url)).then((r) => {
    if (!r.ok) throw new Error(`The test-set scores did not load (${r.status}). Run tools/export_eval.py to rebuild data/eval_scores.json.`);
    return r.json();
  }).catch((e) => { evalPromise = null; throw e; });
  return evalPromise;
}

// CSS token lookup, cached until the preferences change (high contrast and the colour-blind palette swap tokens).
const cache = new Map();
export const tok = (name) => { if (!cache.has(name)) cache.set(name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()); return cache.get(name); };
export const clearTokens = () => cache.clear();

// 95 % Wilson interval for k successes out of n. Returns [low, high] as fractions.
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - w) / d), Math.min(1, (c + w) / d)];
}

export const hexToRgb = (hex) => { const m = hex.replace('#', ''); const n = parseInt(m.length === 3 ? m.replace(/./g, '$&$&') : m, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// Piecewise-linear colour ramp. stops: [[t, '#hex'], …] with t ascending in 0..1. Returns (t) => [r, g, b].
export function ramp(stops) {
  const s = stops.map(([t, c]) => [t, hexToRgb(c)]);
  return (t) => {
    if (!(t > s[0][0])) return s[0][1];
    for (let i = 1; i < s.length; i++) if (t <= s[i][0]) { const [t0, a] = s[i - 1], [t1, b] = s[i], u = (t - t0) / (t1 - t0); return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; }
    return s[s.length - 1][1];
  };
}
// Activation ramp (0 = off … 1 = strongest), from the heat tokens.
export const HEAT = ramp([[0, '#0b0e13'], [0.12, '#1b2740'], [0.32, '#2b3f6b'], [0.52, '#7a3f8f'], [0.72, '#d8504d'], [0.88, '#ffb24a'], [1, '#fff3c4']]);
// Signed ramp for "% change from the mean": blue below, dark at zero, amber above.
const NEG = ramp([[0, '#0b0e13'], [0.35, '#1f3357'], [0.75, '#5aa9ff'], [1, '#d6e9ff']]);
const POS = ramp([[0, '#0b0e13'], [0.35, '#5a3a1c'], [0.75, '#ffb24a'], [1, '#fff3c4']]);
export const signed = (v) => (v < 0 ? NEG(-v) : POS(v));

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// Small seeded random generator (mulberry32), so a perturbation is repeatable.
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function gauss(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
