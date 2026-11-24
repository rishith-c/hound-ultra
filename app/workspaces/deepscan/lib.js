// Deep scan: shared numerics and drawing helpers. No dependencies.
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const ss = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// Seeded random numbers (mulberry32) so every pile and every noise draw can be repeated exactly.
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.gauss = () => { let u = 0; while (u < 1e-9) u = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * f()); };
  return f;
}
export function poisson(r, lam) {
  if (lam <= 0) return 0;
  if (lam > 40) return Math.max(0, Math.round(lam + Math.sqrt(lam) * r.gauss()));
  const L = Math.exp(-lam); let k = 0, p = 1;
  do { k++; p *= r(); } while (p > L);
  return k - 1;
}

// In-place radix-2 FFT. re, im: Float64Array of length 2^k.
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
export const nextPow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };

// ---- design tokens on a canvas ----
let TOK = {}, LUTS = {};
export const dropTokens = () => { TOK = {}; LUTS = {}; };
export function tok(name) { return TOK[name] || (TOK[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'); }
export function rgbOf(name) {
  const v = tok(name);
  if (v[0] === '#') { const n = parseInt(v.length === 4 ? v.slice(1).replace(/./g, '$&$&') : v.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const m = v.match(/[\d.]+/g) || [136, 136, 136]; return [+m[0], +m[1], +m[2]];
}
export const col = (name, a = 1) => { const [r, g, b] = rgbOf(name); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; };
export const font = (px, weight = 400) => weight + ' ' + px + 'px ' + tok('--font');
export const mono = (px, weight = 500) => weight + ' ' + px + 'px ' + tok('--mono');

// Colour look-up tables, built from the tokens. Each is a Uint8ClampedArray of 256 RGBA entries.
//   scan     nothing -> blue -> white: "the instrument thinks something is here" (reconstructions)
//   bipolar  blue (negative) - dark - white (positive): radar and vibration traces
//   heat     the token heat ramp: energy, misfit
export function lut(kind) {
  if (LUTS[kind]) return LUTS[kind];
  const out = new Uint8ClampedArray(1024);
  const stops = kind === 'scan' ? [[0, rgbOf('--bg-0'), 0], [0.18, rgbOf('--heat-1'), 0.35], [0.55, rgbOf('--accent'), 0.82], [1, [240, 248, 255], 1]]
    : kind === 'bipolar' ? [[0, rgbOf('--accent'), 1], [0.5, rgbOf('--bg-0'), 1], [1, [244, 246, 250], 1]]
    : kind === 'gray' ? [[0, rgbOf('--bg-0'), 1], [1, [240, 244, 250], 1]]
    : [[0, rgbOf('--heat-0'), 0], [0.2, rgbOf('--heat-1'), 0.55], [0.45, rgbOf('--heat-2'), 0.8], [0.68, rgbOf('--heat-3'), 0.92], [0.86, rgbOf('--heat-4'), 1], [1, rgbOf('--heat-5'), 1]];
  for (let i = 0; i < 256; i++) {
    const t = i / 255; let k = 0; while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const a = stops[k], b = stops[k + 1], u = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
    out[i * 4] = lerp(a[1][0], b[1][0], u); out[i * 4 + 1] = lerp(a[1][1], b[1][1], u); out[i * 4 + 2] = lerp(a[1][2], b[1][2], u); out[i * 4 + 3] = 255 * lerp(a[2], b[2], u);
  }
  return (LUTS[kind] = out);
}
// Paint a grid (row 0 at the bottom unless flip is false) into an offscreen canvas, one pixel per cell.
export function gridImage(cv, data, nx, nz, kind, lo, hi, { flip = true, alpha = 1, mask = null } = {}) {
  if (typeof document === 'undefined') return null; // solving in the worker: there is nothing to paint
  if (!cv) cv = document.createElement('canvas');
  if (cv.width !== nx || cv.height !== nz) { cv.width = nx; cv.height = nz; }
  const c = cv.getContext('2d'), img = c.createImageData(nx, nz), L = lut(kind), px = img.data, k = 255 / (hi - lo || 1);
  for (let j = 0; j < nz; j++) {
    const row = (flip ? nz - 1 - j : j) * nx * 4;
    for (let i = 0; i < nx; i++) {
      const q = j * nx + i, o = row + i * 4;
      if (mask && !mask[q]) { px[o + 3] = 0; continue; }
      const v = clamp(Math.round((data[q] - lo) * k), 0, 255) * 4;
      px[o] = L[v]; px[o + 1] = L[v + 1]; px[o + 2] = L[v + 2]; px[o + 3] = L[v + 3] * alpha;
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

// "Nice" tick values for an axis.
export function ticks(lo, hi, n = 5) {
  const span = hi - lo; if (!(span > 0)) return [lo];
  const raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag, out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : +v.toPrecision(10));
  return out;
}
// A plot box: frame, gridlines, tick labels, axis titles. Returns scale functions.
export function plot(c, box, { x = [0, 1], y = [0, 1], xl = '', yl = '', xt = 6, yt = 4, xfmt = String, yfmt = String, grid = true, yTicks = null, xTicks = null } = {}) {
  const { l, t, w, h } = box;
  const X = (v) => l + (v - x[0]) / (x[1] - x[0]) * w, Y = (v) => t + h - (v - y[0]) / (y[1] - y[0]) * h;
  c.save();
  c.lineWidth = 1; c.font = font(11); c.textBaseline = 'middle';
  const lo = Math.min(y[0], y[1]), hi = Math.max(y[0], y[1]);
  for (const v of (yTicks || ticks(lo, hi, yt))) {
    const py = Math.round(Y(v)) + 0.5;
    if (grid) { c.strokeStyle = col('--line', 0.9); c.beginPath(); c.moveTo(l, py); c.lineTo(l + w, py); c.stroke(); }
    c.fillStyle = tok('--text-3'); c.textAlign = 'right'; c.fillText(yfmt(v), l - 6, py);
  }
  c.textBaseline = 'top'; c.textAlign = 'center';
  for (const v of (xTicks || ticks(Math.min(x[0], x[1]), Math.max(x[0], x[1]), xt))) {
    const px = Math.round(X(v)) + 0.5;
    c.strokeStyle = col('--line-2', 0.9); c.beginPath(); c.moveTo(px, t + h); c.lineTo(px, t + h + 4); c.stroke();
    c.fillStyle = tok('--text-3'); c.fillText(xfmt(v), px, t + h + 6);
  }
  c.strokeStyle = tok('--line-2'); c.strokeRect(Math.round(l) + 0.5, Math.round(t) + 0.5, Math.round(w), Math.round(h));
  c.fillStyle = tok('--text-3'); c.font = font(11);
  if (xl) { c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(xl, l + w / 2, t + h + 20); }
  if (yl) { c.save(); c.translate(l - 34, t + h / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(yl, 0, 0); c.restore(); }
  c.restore();
  return { X, Y };
}
// A small leader-lined label on a canvas. Text never sits on the subject.
export function tagLabel(c, x, y, text, { dx = 14, dy = -14, color = '--text-2', align = 'left' } = {}) {
  c.save(); c.font = font(11, 500);
  const w = c.measureText(text).width + 10, bx = align === 'left' ? x + dx : x + dx - w, by = y + dy - 9;
  c.strokeStyle = col(color, 0.6); c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(align === 'left' ? bx : bx + w, by + 9); c.stroke();
  c.fillStyle = col('--bg-1', 0.86); c.fillRect(bx, by, w, 18); c.strokeStyle = col(color, 0.45); c.strokeRect(bx + 0.5, by + 0.5, w - 1, 17);
  c.fillStyle = tok(color); c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillText(text, bx + 5, by + 9.5);
  c.restore();
}
export const fmtDur = (hours) => hours < 1 / 60 ? Math.max(1, Math.round(hours * 3600)) + ' s' : hours < 1 ? Math.round(hours * 60) + ' min' : hours < 10 ? (Math.round(hours * 10) / 10) + ' h' : Math.round(hours) + ' h';
export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
