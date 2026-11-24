// Small maths and drawing helpers for the Fusion workspace.
export const logit = (p) => Math.log(p / (1 - p));
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function gaussian(rnd) { let u = 0; while (u < 1e-9) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }

// A probability as a person would say it: no false precision in the middle, more digits near the ends.
export function pct(p) {
  const v = p * 100;
  if (v > 99.9) return '>99.9 %';
  if (v < 0.1) return '<0.1 %';
  return (v >= 99 || v < 2 ? v.toFixed(1) : v.toFixed(0)) + ' %';
}
export const fmtLR = (x) => '×' + (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)).replace(/\.?0+$/, (m) => (m.startsWith('.') ? '' : m));
export const signed = (x, d = 2) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);

// Design tokens, read once and again when the contrast or palette preference changes.
let cache = null;
export function tokens() {
  if (cache) return cache;
  const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim();
  cache = { bg0: g('--bg-0'), bg1: g('--bg-1'), bg2: g('--bg-2'), bg3: g('--bg-3'), bg4: g('--bg-4'), line: g('--line'), line2: g('--line-2'),
    text: g('--text'), text2: g('--text-2'), text3: g('--text-3'), accent: g('--accent'), person: g('--person'), warn: g('--warn'), ok: g('--ok'),
    danger: g('--danger'), sim: g('--sim'), font: g('--font'), mono: g('--mono'),
    heat: [g('--heat-0'), g('--heat-1'), g('--heat-2'), g('--heat-3'), g('--heat-4'), g('--heat-5')] };
  return cache;
}
export function dropTokens() { cache = null; }
function parse(hex) { const s = hex.replace('#', ''); const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s; return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]; }
export function rgba(hex, a = 1) { const [r, g, b] = parse(hex); return `rgba(${r},${g},${b},${a})`; }
export function rampRGB(stops, t) {
  const x = clamp(t, 0, 1) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i, a = parse(stops[i]), b = parse(stops[i + 1]);
  return [Math.round(lerp(a[0], b[0], f)), Math.round(lerp(a[1], b[1], f)), Math.round(lerp(a[2], b[2], f))];
}
// Wilson score interval for k successes in n trials (95 %).
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - w) / d), Math.min(1, (c + w) / d)];
}
export function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
export const STATUS = {
  confirmed: { label: 'Confirmed', tag: 'tag-person', color: 'person' },
  possible: { label: 'Possible', tag: 'tag-warn', color: 'warn' },
  rejected: { label: 'Closed', tag: '', color: 'text3' },
  unlikely: { label: 'Closed', tag: '', color: 'text3' },
  new: { label: 'New', tag: '', color: 'text3' },
};
export const whereOf = (d) => (d.room ? 'room ' + d.room : d.outdoor ? 'outdoors' : 'at the stop');

// Demo hero: metres of light shaft for a probability of 1.
export const SHAFT_M = 6;
