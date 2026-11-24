// Things more than one part of the landing page needs.
import { loadNN } from '../app/core/nn.js';

export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (t) => 1 - Math.pow(1 - t, 4);

// The Wi-Fi network (weights + 30 test windows, 5 MB). Fetched once, shared by the hero, the proof and the mission.
let nnPromise = null;
export const getNN = () => (nnPromise ||= loadNN());

export function el(spec, props, ...kids) {
  const [tag, ...cls] = spec.split('.');
  const n = document.createElement(tag || 'div');
  if (cls.length) n.className = cls.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else n.append(c instanceof Node ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return n;
}

// The heat ramp from the design tokens (--heat-0 .. --heat-5), as a 256-entry lookup table.
const STOPS = [[16, 21, 28], [43, 63, 107], [122, 63, 143], [216, 80, 77], [255, 178, 74], [255, 243, 196]];
export const HEAT = (() => {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const f = (i / 255) * (STOPS.length - 1), a = Math.floor(f), b = Math.min(STOPS.length - 1, a + 1), t = f - a;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = STOPS[a][c] + (STOPS[b][c] - STOPS[a][c]) * t;
  }
  return lut;
})();

// Draw rows of numbers (an array of arrays) into a canvas, one pixel per value. lo..hi maps to the ramp.
export function drawHeat(canvas, rows, lo, hi, { upto = Infinity } = {}) {
  const h = rows.length, w = rows[0].length;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const c = canvas.getContext('2d'), img = c.createImageData(w, h), d = img.data, k = 255 / (hi - lo || 1);
  for (let y = 0; y < h; y++) {
    const r = rows[y];
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let v = Math.round((r[x] - lo) * k); v = v < 0 ? 0 : v > 255 ? 255 : v;
      const dim = x > upto ? 0.28 : 1;
      d[o] = HEAT[v * 3] * dim; d[o + 1] = HEAT[v * 3 + 1] * dim; d[o + 2] = HEAT[v * 3 + 2] * dim; d[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
}

export const fmtClock = (t) => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0');
