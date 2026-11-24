// Small shared helpers for the Signals workspace: colours from the design tokens, a canvas that stays sharp,
// sliders and segmented controls built from the shared classes.
import { h, cssVar } from '../../ui/kit.js';

export function hexRgb(hex) {
  const s = hex.replace('#', ''); const v = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
export function rgba(hex, a) { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }

// The token colours, read once and again when the palette or contrast changes.
export const C = {};
export function readColours() {
  for (const k of ['bg-0', 'bg-1', 'bg-2', 'bg-3', 'bg-4', 'line', 'line-2', 'text', 'text-2', 'text-3', 'accent', 'person', 'warn', 'ok', 'danger', 'sim', 'heat-0', 'heat-1', 'heat-2', 'heat-3', 'heat-4', 'heat-5'])
    C[k.replace('-', '')] = cssVar('--' + k) || '#888888';
  C.font = cssVar('--font') || 'system-ui'; C.mono = cssVar('--mono') || 'monospace';
  C.lut = ramp(256);
  return C;
}
// The heat ramp from the tokens as a lookup table of n colours (RGBA bytes).
export function ramp(n) {
  const stops = [C.heat0, C.heat1, C.heat2, C.heat3, C.heat4, C.heat5].map(hexRgb), out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const f = (i / (n - 1)) * (stops.length - 1), a = Math.min(stops.length - 2, Math.floor(f)), t = f - a;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = stops[a][c] + (stops[a + 1][c] - stops[a][c]) * t;
    out[i * 4 + 3] = 255;
  }
  return out;
}

// A canvas that fills its box at device resolution. s.w and s.h are CSS pixels; s.c is the 2-D context.
export function surface(cls, onResize) {
  const canvas = h('canvas.' + cls);
  const s = { canvas, c: canvas.getContext('2d'), w: 0, h: 0, dpr: 1 };
  const ro = new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    s.dpr = Math.min(2, window.devicePixelRatio || 1); s.w = r.width; s.h = r.height;
    canvas.width = Math.round(r.width * s.dpr); canvas.height = Math.round(r.height * s.dpr);
    s.c.setTransform(s.dpr, 0, 0, s.dpr, 0, 0); onResize?.(s);
  });
  ro.observe(canvas);
  return s;
}

export function slider({ label, min, max, step = 1, value, format = (v) => String(v), onInput, hint }) {
  const out = h('output.num', null, format(value));
  const input = h('input.signals-range', { type: 'range', min, max, step, value, 'aria-label': label, title: hint || null });
  const paint = () => input.style.setProperty('--f', ((input.value - min) / (max - min)) * 100 + '%');
  input.addEventListener('input', () => { out.textContent = format(+input.value); paint(); onInput(+input.value); });
  paint();
  const el = h('label.signals-slider', null, h('span.signals-slider-top', null, h('span', null, label), out), input);
  return { el, input, get value() { return +input.value; }, set(v) { input.value = v; out.textContent = format(+v); paint(); } };
}

export function seg(options, value, onChange, label) {
  const el = h('div.seg', { role: 'group', 'aria-label': label });
  const set = (v) => { for (const b of el.children) b.setAttribute('aria-pressed', String(b.dataset.v === String(v))); };
  for (const o of options) el.append(h('button', { type: 'button', 'data-v': o.id, title: o.title || null, onclick: () => { set(o.id); onChange(o.id); } }, o.label));
  set(value);
  return { el, set };
}

// The opening of every area: its reality label and two plain sentences. Its name is on the tab above.
export function intro(tag, text, extraTag) {
  return h('div.signals-intro', null, h('div.signals-intro-head', null, tag, extraTag), h('p', null, text));
}
export function text(c, str, x, y, { color = C.text2, size = 11, align = 'left', weight = 400, mono = false, base = 'alphabetic' } = {}) {
  c.font = `${weight} ${size}px ${mono ? C.mono : C.font}`; c.fillStyle = color; c.textAlign = align; c.textBaseline = base; c.fillText(str, x, y);
}
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function gauss(rng) { let u = 0; while (u < 1e-9) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2831853 * rng()); }
