// Shared helpers for the Radio twin exhibits: canvases, axes, controls, colour, complex maths, seeded noise.
// Every exhibit module exports { meta, create(stage, side, ctx, lab) } and uses these so the seven read as one lab.
import { h, icon, cssVar, reducedMotion } from '../../ui/kit.js';

// ---- radio constants shared by every exhibit ----
export const C0 = 299792458;                       // m/s
export const F0 = 2.437e9;                         // Wi-Fi channel 6 centre, Hz
export const DF = 312.5e3;                         // subcarrier spacing, Hz
export const LAMBDA = C0 / F0;                     // 0.1230 m
// The 51 subcarriers HOUND's receiver uses: -26..-1 and +2..+26 (+1 is dropped, see sensing/csi.py in the rover project).
export const SUB = [...Array.from({ length: 25 }, (_, i) => i + 2), ...Array.from({ length: 26 }, (_, i) => i - 26)];
export const SUB_SORTED = [...SUB].sort((a, b) => a - b);
export const KW = SUB.map((s) => (2 * Math.PI * (F0 + s * DF)) / C0);   // wavenumber of each subcarrier, rad/m

// ---- tokens (cached; cleared when the palette or contrast changes) ----
let tokens = {};
export const tok = (name) => (tokens[name] ||= cssVar(name) || '#888');
export const clearTokens = () => { tokens = {}; rampCache = null; };
export function rgb(hex) {
  const s = hex.trim();
  if (s.startsWith('#')) { const n = parseInt(s.length === 4 ? s.slice(1).replace(/./g, '$&$&') : s.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const m = s.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : [136, 136, 136];
}
export const rgba = (name, a) => { const [r, g, b] = rgb(tok(name)); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; };
// The data ramp from the tokens (--heat-0..5), as a 256-entry lookup. ramp(t) -> [r, g, b], t in 0..1.
let rampCache = null;
export function rampLut() {
  if (rampCache) return rampCache;
  const stops = [0, 1, 2, 3, 4, 5].map((i) => rgb(tok('--heat-' + i)));
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * 5, k = Math.min(4, Math.floor(x)), f = x - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f);
  }
  return (rampCache = lut);
}
export function ramp(t) { const l = rampLut(), i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3; return [l[i], l[i + 1], l[i + 2]]; }

// ---- numbers ----
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const db = (p) => 10 * Math.log10(Math.max(p, 1e-30));       // power ratio -> dB
export const db20 = (a) => 20 * Math.log10(Math.max(a, 1e-15));     // amplitude ratio -> dB
export function rng(seed = 1) {            // mulberry32: the same seed always gives the same scene
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.normal = () => { let u = 0; while (u < 1e-12) u = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * f()); };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  return f;
}
export const fx = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');
export const sgn = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);

// ---- canvas that stays sharp ----
// canvas(host, (c, w, h) => { ... }) -> { el, redraw(), w, h, c }. draw gets CSS pixels.
export function canvas(host, draw, { label } = {}) {
  const el = h('canvas.radio-canvas', label ? { role: 'img', 'aria-label': label } : null);
  host.append(el);
  const c = el.getContext('2d');
  const o = { el, c, w: 0, h: 0, dpr: 1, redraw() { if (!o.w) return; c.setTransform(o.dpr, 0, 0, o.dpr, 0, 0); c.clearRect(0, 0, o.w, o.h); try { draw(c, o.w, o.h, o.dpr); } catch (e) { if (!o.failed) { o.failed = true; console.error('[radio] draw failed', e); } } }, dispose() { ro.disconnect(); } };
  const ro = new ResizeObserver(() => {
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    o.dpr = Math.min(2, window.devicePixelRatio || 1); o.w = r.width; o.h = r.height;
    el.width = Math.round(r.width * o.dpr); el.height = Math.round(r.height * o.dpr); o.redraw();
  });
  ro.observe(el);
  return o;
}

// ---- chart frame: thin gridlines, labelled axes with units, tabular numbers ----
// plot(c, { x, y, w, h, xd: [lo, hi], yd: [lo, hi], xt: [ticks], yt: [ticks], xl: 'label', yl: 'label', xf, yf })
// returns { X(v), Y(v) } scale functions. Draw your marks after it.
export function plot(c, o) {
  const { x, y, w, h: hh, xd, yd } = o;
  const X = (v) => x + ((v - xd[0]) / (xd[1] - xd[0])) * w, Y = (v) => y + hh - ((v - yd[0]) / (yd[1] - yd[0])) * hh;
  c.save();
  c.lineWidth = 1; c.font = '500 10.5px ' + tok('--mono'); c.fillStyle = tok('--text-3');
  c.strokeStyle = tok('--line');
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (const t of o.yt || []) { const py = Math.round(Y(t)) + 0.5; c.beginPath(); c.moveTo(x, py); c.lineTo(x + w, py); c.stroke(); c.fillText(o.yf ? o.yf(t) : String(t), x - 6, py); }
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (const t of o.xt || []) { const px = Math.round(X(t)) + 0.5; c.beginPath(); c.moveTo(px, y); c.lineTo(px, y + hh); c.stroke(); c.fillText(o.xf ? o.xf(t) : String(t), px, y + hh + 5); }
  c.strokeStyle = tok('--line-2'); c.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(hh));
  c.font = '500 11px ' + tok('--font'); c.fillStyle = tok('--text-3');
  if (o.xl) { c.textAlign = 'right'; c.textBaseline = 'top'; c.fillText(o.xl, x + w, y + hh + 19); }
  if (o.yl) { c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText(o.yl, x - (o.ylx ?? 30), y - 6); }
  c.restore();
  return { X, Y };
}
export function line(c, pts, color, width = 1.5, dash = null) {
  if (!pts.length) return;
  c.save(); c.strokeStyle = color; c.lineWidth = width; c.lineJoin = 'round'; if (dash) c.setLineDash(dash);
  c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke(); c.restore();
}
export function label(c, text, x, y, { color, align = 'left', base = 'middle', font, bg = false } = {}) {
  c.save(); c.font = font || '500 11px ' + tok('--font'); c.textAlign = align; c.textBaseline = base;
  if (bg) { const m = c.measureText(text), pad = 3, lx = align === 'right' ? x - m.width : align === 'center' ? x - m.width / 2 : x; c.fillStyle = rgba('--bg-0', 0.78); c.fillRect(lx - pad, y - 8, m.width + pad * 2, 16); }
  c.fillStyle = color || tok('--text-2'); c.fillText(text, x, y); c.restore();
}
// Paint a Float32Array image (w x h, row 0 at the top) through the data ramp into an offscreen canvas you can drawImage.
export function heatImage(data, w, hh, lo, hi, into) {
  const cv = into || document.createElement('canvas'); if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
  const c = cv.getContext('2d'), img = c.createImageData(w, hh), lut = rampLut(), k = 255 / (hi - lo || 1);
  for (let i = 0; i < w * hh; i++) { const v = Math.max(0, Math.min(255, Math.round((data[i] - lo) * k))) * 3; img.data[i * 4] = lut[v]; img.data[i * 4 + 1] = lut[v + 1]; img.data[i * 4 + 2] = lut[v + 2]; img.data[i * 4 + 3] = 255; }
  c.putImageData(img, 0, 0); return cv;
}

// ---- controls built from the shared classes ----
export function slider({ label: text, min, max, step = 1, value, format = (v) => String(v), oninput, title }) {
  const input = h('input.slider', { type: 'range', min, max, step, value, 'aria-label': text, title });
  const out = h('output', null, format(+value));
  const fill = () => input.style.setProperty('--p', ((+input.value - min) / (max - min)) * 100 + '%');
  input.addEventListener('input', () => { fill(); out.textContent = format(+input.value); oninput?.(+input.value); });
  fill();
  const el = h('label.slider-row.radio-slider', null, h('span', null, text), input, out);
  el.set = (v) => { input.value = v; fill(); out.textContent = format(+input.value); };
  el.input = input;
  return el;
}
export function seg(options, value, onchange, { label: text } = {}) {
  const el = h('div.seg', { role: 'group', 'aria-label': text || 'Options' });
  const set = (v, fire) => { value = v; el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v)))); if (fire) onchange?.(v); };
  for (const o of options) { const [v, l, t] = Array.isArray(o) ? o : [o, o]; el.append(h('button', { type: 'button', 'data-v': String(v), title: t, onclick: () => set(v, true) }, l)); }
  set(value, false); el.set = (v) => set(v, false); el.get = () => value;
  return el;
}
export function toggle(text, on, onchange, { title } = {}) {
  const input = h('input', { type: 'checkbox', checked: !!on });
  input.addEventListener('change', () => onchange?.(input.checked));
  const el = h('label.check.switch', { title }, input, h('span', null, text)); el.input = input; return el;
}
// A live readout: stat('Path gain', 'dB') -> element with .set(text, tone?)
export function stat(text, unit = '', { title } = {}) {
  const b = h('b.num', null, '–'), u = unit ? h('small', null, unit) : null;
  const el = h('div.radio-stat', { title }, h('span', null, text), h('div', null, b, u));
  el.set = (v, tone) => { if (b.textContent !== v) b.textContent = v; el.dataset.tone = tone || ''; };
  return el;
}
export const group = (title, ...kids) => h('section.radio-group', null, title ? h('h4', null, title) : null, ...kids);
// A figure frame inside the stage: title that states the point, optional reality tag, a body you fill, a caption.
export function figure(title, { tag = null, caption = null, cls = '' } = {}) {
  const body = h('div.radio-fig-body');
  const cap = h('figcaption.radio-fig-cap', null, caption);
  const titleEl = h('h3', null, title);
  const el = h('figure.radio-fig' + (cls ? '.' + cls : ''), null, h('header.radio-fig-head', null, titleEl, tag), body, caption ? cap : null);
  el.body = body; el.setTitle = (t) => { titleEl.textContent = t; }; el.setCaption = (t) => { cap.replaceChildren(...(Array.isArray(t) ? t : [t])); if (!cap.parentNode) el.append(cap); };
  return el;
}

// ---- animation loop that obeys onShow/onHide and reduced motion ----
// const run = loop((t, dt) => {...}); run.start(); run.stop(). Under reduced motion it calls the function once per
// start (and whenever you call run.once()), so figures are still drawn and controls still work.
export function loop(fn) {
  let raf = 0, last = 0, on = false;
  const step = (now) => { raf = requestAnimationFrame(step); const dt = Math.min(0.1, (now - last) / 1000 || 0.016); last = now; try { fn(now / 1000, dt); } catch (e) { cancelAnimationFrame(raf); on = false; console.error('[radio] frame failed', e); } };
  return {
    start() { if (on) return; if (reducedMotion()) { try { fn(performance.now() / 1000, 0); } catch (e) { console.error(e); } return; } on = true; last = performance.now(); raf = requestAnimationFrame(step); },
    stop() { on = false; cancelAnimationFrame(raf); },
    once() { if (!on) { try { fn(performance.now() / 1000, 0); } catch (e) { console.error(e); } } },
    get running() { return on; },
  };
}
export { h, icon, reducedMotion };
