// Horizon: the shared toolkit every exhibit draws with. Plain canvas, no libraries.
// One look for all eleven exhibits: the same figure frame, axes, type, colours, controls and readouts.
import { h, icon, realityTag, reducedMotion, cssVar } from '../../ui/kit.js';
export { h, icon, realityTag };

export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const reduced = () => reducedMotion();

// ---------- seeded randomness (every exhibit is repeatable: same seed, same world) ----------
export function rng(seed = 1) {
  let a = (seed >>> 0) || 1, spare = null;
  const u = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  u.n = () => { if (spare != null) { const s = spare; spare = null; return s; } let x, y, r; do { x = u() * 2 - 1; y = u() * 2 - 1; r = x * x + y * y; } while (r >= 1 || r === 0); const m = Math.sqrt((-2 * Math.log(r)) / r); spare = y * m; return x * m; };
  u.range = (lo, hi) => lo + (hi - lo) * u();
  u.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * u());
  u.pick = (arr) => arr[Math.floor(u() * arr.length)];
  return u;
}

// ---------- colour: always from the design tokens ----------
let TOK = null;
const hex2rgb = (s) => { s = s.trim(); if (s[0] === '#') { if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]; return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]; } const m = s.match(/[\d.]+/g) || [0, 0, 0]; return [+m[0], +m[1], +m[2]]; };
export function tokens() {
  if (TOK) return TOK;
  const v = (n) => cssVar(n);
  const names = { bg0: '--bg-0', bg1: '--bg-1', bg2: '--bg-2', bg3: '--bg-3', bg4: '--bg-4', bg5: '--bg-5', line: '--line', line2: '--line-2', line3: '--line-3', text: '--text', text2: '--text-2', text3: '--text-3',
    accent: '--accent', accent2: '--accent-2', person: '--person', warn: '--warn', ok: '--ok', danger: '--danger', sim: '--sim' };
  TOK = { rgb: {} };
  for (const [k, n] of Object.entries(names)) { TOK[k] = v(n) || '#888888'; TOK.rgb[k] = hex2rgb(TOK[k]); }
  TOK.heat = [0, 1, 2, 3, 4, 5].map((i) => hex2rgb(v('--heat-' + i) || '#000000'));
  TOK.font = v('--font') || 'system-ui, sans-serif'; TOK.mono = v('--mono') || 'ui-monospace, monospace'; TOK.display = v('--font-display') || 'Georgia, serif';
  return TOK;
}
export function refreshTokens() { TOK = null; }
// rgba('accent', 0.4) or rgba('#5aa9ff', 0.4) or rgba([r, g, b], 0.4)
export function rgba(c, a = 1) { const T = tokens(); const v = Array.isArray(c) ? c : T.rgb[c] || hex2rgb(c); return 'rgba(' + (v[0] | 0) + ',' + (v[1] | 0) + ',' + (v[2] | 0) + ',' + a + ')'; }
export function rampFrom(stops) { const n = stops.length - 1; return (t) => { t = clamp(t) * n; const i = Math.min(n - 1, t | 0), f = t - i, a = stops[i], b = stops[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }; }
export const heat = (t) => rampFrom(tokens().heat)(t);                         // dark -> blue -> violet -> red -> amber -> pale: magnitudes
export const cyclic = (t) => { const T = tokens().rgb; return rampFrom([T.accent, T.sim, T.person, T.warn, T.ok, T.accent])(((t % 1) + 1) % 1); };   // phase: wraps
export const diverge = (t) => { const T = tokens().rgb; return rampFrom([T.accent, [22, 27, 33], T.person])(t); };   // signed: blue below, orange above
export const mono = (c) => { const T = tokens().rgb; return rampFrom([T.bg0, T[c] || hex2rgb(c)]); };

// ---------- canvas text ----------
export function font(size = 11, { weight = 500, mono: m = false, display = false } = {}) { const T = tokens(); return (display ? 400 : weight) + ' ' + size + 'px ' + (display ? T.display : m ? T.mono : T.font); }
// text(g, 'label', x, y, { color, size, align, base, mono, weight, halo })   halo: a dark outline so text stays legible over data
export function text(g, s, x, y, { color = 'text2', size = 11, align = 'left', base = 'alphabetic', mono: m = false, weight = 500, halo = false, display = false } = {}) {
  const T = tokens();
  g.font = font(size, { weight, mono: m, display }); g.textAlign = align; g.textBaseline = base;
  if (halo) { g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = rgba('bg0', 0.85); g.strokeText(s, x, y); }
  g.fillStyle = T[color] || color; g.fillText(s, x, y);
}
// A leader-lined label: a dot at (x, y), a thin line to (tx, ty), text there. Text never sits on the subject.
export function callout(g, s, x, y, tx, ty, { color = 'text2', size = 11, dot = true } = {}) {
  const T = tokens();
  g.save(); g.strokeStyle = rgba(color in T.rgb ? color : 'text3', 0.55); g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(tx, ty); g.stroke();
  if (dot) { g.fillStyle = T[color] || color; g.beginPath(); g.arc(x, y, 2, 0, TAU); g.fill(); }
  text(g, s, tx + (tx >= x ? 4 : -4), ty, { color, size, align: tx >= x ? 'left' : 'right', base: 'middle', halo: true });
  g.restore();
}

// ---------- the figure: a titled chart or scene. The title states the point; the note says what you are looking at ----------
// const fig = figure({ title, note, area, tag }); stage.append(fig.el); fig.draw = (g, w, h) => { ... }; fig.redraw();
export function figure({ title = '', note = '', area, tag, label } = {}) {
  const canvas = h('canvas', { role: 'img', 'aria-label': label || title });
  const titleEl = h('span.chart-title', null, title), noteEl = h('p.chart-note.horizon-fig-note', null, note), legendEl = h('div.legend.horizon-fig-legend');
  const head = h('figcaption.horizon-fig-head', null, titleEl, tag ? realityTag(tag) : null);
  const body = h('div.horizon-fig-body', null, canvas);
  const el = h('figure.horizon-fig', null, head, body, h('div.horizon-fig-foot', null, noteEl, legendEl));
  if (area) el.style.gridArea = area;
  let dpr = 1;
  const fig = {
    el, canvas, head, body, w: 0, h: 0, g: canvas.getContext('2d'), draw: null,
    redraw() { if (fig.w < 8 || fig.h < 8 || !fig.draw) return; const g = fig.g; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, fig.w, fig.h); g.save(); try { fig.draw(g, fig.w, fig.h); } finally { g.restore(); } },
    setTitle(s) { titleEl.textContent = s; canvas.setAttribute('aria-label', label || s); },
    setNote(s) { noteEl.textContent = s; },
    // legend([{ label, color: 'accent', kind: 'line' | 'dot' | 'dash' | 'box' | 'hollow' }])
    legend(items) { const T = tokens(); legendEl.replaceChildren(...items.map((it) => h('span', null, h('i' + (it.kind && it.kind !== 'box' ? '.' + it.kind : ''), { style: { '--c': T[it.color] || it.color } }), it.label))); legendEl.querySelectorAll('i').forEach((i, k) => i.style.setProperty('--c', T[items[k].color] || items[k].color)); },
    // onPointer(fn): fn({ type: 'down' | 'move' | 'drag' | 'up' | 'leave', x, y, event }) in canvas CSS pixels
    onPointer(fn) {
      let down = false; const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, event: e }; };
      canvas.addEventListener('pointerdown', (e) => { down = true; canvas.setPointerCapture(e.pointerId); fn({ type: 'down', ...at(e) }); });
      canvas.addEventListener('pointermove', (e) => fn({ type: down ? 'drag' : 'move', ...at(e) }));
      canvas.addEventListener('pointerup', (e) => { down = false; fn({ type: 'up', ...at(e) }); });
      canvas.addEventListener('pointerleave', (e) => { if (!down) fn({ type: 'leave', ...at(e) }); });
    },
  };
  new ResizeObserver(() => {
    const r = body.getBoundingClientRect(); if (r.width < 8 || r.height < 8) return;
    dpr = Math.min(2, window.devicePixelRatio || 1); fig.w = Math.floor(r.width); fig.h = Math.floor(r.height);
    canvas.width = Math.round(fig.w * dpr); canvas.height = Math.round(fig.h * dpr); canvas.style.width = fig.w + 'px'; canvas.style.height = fig.h + 'px';
    fig.redraw();
  }).observe(body);
  return fig;
}
// layout(stage, { cols: '1.6fr 1fr', rows: '1fr 1fr', areas: ['hero a', 'hero b'] }) then figure({ area: 'hero' })
export function layout(stage, { cols, rows, areas }) { stage.style.gridTemplateColumns = cols; stage.style.gridTemplateRows = rows; stage.style.gridTemplateAreas = areas.map((a) => '"' + a + '"').join(' '); }

// ---------- axes ----------
// const P = plot(g, { x, y, w, h }, { xd: [0, 10], yd: [0, 1], xlog, ylog, xlabel, ylabel, xticks, yticks, xfmt, yfmt, grid });
// P.X(v), P.Y(v) map data to pixels; P.ix(px), P.iy(px) map back. Draws gridlines, tick labels and axis titles.
export function niceTicks(lo, hi, n = 5) { const span = hi - lo; if (!(span > 0)) return [lo]; const raw = span / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag; const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag; const out = []; for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12)); return out; }
export function logTicks(lo, hi) { const out = []; for (let e = Math.ceil(Math.log10(lo) - 1e-9); e <= Math.log10(hi) + 1e-9; e++) out.push(10 ** e); return out; }
export const pad = (w, h, { l = 46, r = 12, t = 10, b = 32 } = {}) => ({ x: l, y: t, w: Math.max(10, w - l - r), h: Math.max(10, h - t - b) });
export function plot(g, box, { xd, yd, xlog = false, ylog = false, xlabel, ylabel, xticks, yticks, xfmt = (v) => String(v), yfmt = (v) => String(v), grid = true, frame = false } = {}) {
  const T = tokens(), { x, y, w, h: hh } = box, L = Math.log10;
  const X = xlog ? (v) => x + ((L(Math.max(v, 1e-300)) - L(xd[0])) / (L(xd[1]) - L(xd[0]))) * w : (v) => x + ((v - xd[0]) / (xd[1] - xd[0])) * w;
  const Y = ylog ? (v) => y + hh - ((L(Math.max(v, 1e-300)) - L(yd[0])) / (L(yd[1]) - L(yd[0]))) * hh : (v) => y + hh - ((v - yd[0]) / (yd[1] - yd[0])) * hh;
  const ix = xlog ? (px) => 10 ** (L(xd[0]) + ((px - x) / w) * (L(xd[1]) - L(xd[0]))) : (px) => xd[0] + ((px - x) / w) * (xd[1] - xd[0]);
  const iy = ylog ? (px) => 10 ** (L(yd[0]) + ((y + hh - px) / hh) * (L(yd[1]) - L(yd[0]))) : (px) => yd[0] + ((y + hh - px) / hh) * (yd[1] - yd[0]);
  const xt = xticks || (xlog ? logTicks(xd[0], xd[1]) : niceTicks(xd[0], xd[1], Math.max(2, Math.round(w / 80))));
  const yt = yticks || (ylog ? logTicks(yd[0], yd[1]) : niceTicks(yd[0], yd[1], Math.max(2, Math.round(hh / 40))));
  g.save(); g.lineWidth = 1;
  if (grid) { g.strokeStyle = T.line; g.beginPath(); for (const v of yt) { const py = Math.round(Y(v)) + 0.5; g.moveTo(x, py); g.lineTo(x + w, py); } g.stroke(); }
  g.strokeStyle = T.line2; g.beginPath(); g.moveTo(x, y + hh + 0.5); g.lineTo(x + w, y + hh + 0.5); if (frame) { g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + hh); } g.stroke();
  g.beginPath(); for (const v of xt) { const px = Math.round(X(v)) + 0.5; g.moveTo(px, y + hh); g.lineTo(px, y + hh + 4); } g.stroke();
  for (const v of xt) text(g, xfmt(v), X(v), y + hh + 15, { color: 'text3', size: 10.5, align: 'center', mono: true, weight: 400 });
  for (const v of yt) text(g, yfmt(v), x - 6, Y(v), { color: 'text3', size: 10.5, align: 'right', base: 'middle', mono: true, weight: 400 });
  if (xlabel) text(g, xlabel, x + w, y + hh + 28, { color: 'text3', size: 11, align: 'right' });
  if (ylabel) text(g, ylabel, x - 40 < 2 ? 2 : x - 40, y - 2 < 9 ? 9 : y - 2, { color: 'text3', size: 11 });
  g.restore();
  return { X, Y, ix, iy, box, x0: x, x1: x + w, y0: y, y1: y + hh };
}
// trace(g, P, xs, ys, { color, width, dash, fill, alpha, step })
export function trace(g, P, xs, ys, { color = 'accent', width = 1.5, dash, fill = 0, alpha = 1, n } = {}) {
  const T = tokens(), N = n ?? xs.length; if (!N) return;
  g.save(); g.beginPath(); g.rect(P.x0, P.y0 - 2, P.x1 - P.x0, P.y1 - P.y0 + 4); g.clip();
  g.beginPath(); for (let i = 0; i < N; i++) { const px = P.X(xs[i]), py = P.Y(ys[i]); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
  g.strokeStyle = rgba(color, alpha); g.lineWidth = width; g.lineJoin = 'round'; if (dash) g.setLineDash(dash); g.stroke();
  if (fill) { g.lineTo(P.X(xs[N - 1]), P.y1); g.lineTo(P.X(xs[0]), P.y1); g.closePath(); const gr = g.createLinearGradient(0, P.y0, 0, P.y1); gr.addColorStop(0, rgba(color, fill)); gr.addColorStop(1, rgba(color, 0)); g.fillStyle = gr; g.fill(); }
  g.restore(); void T;
}
export function dots(g, P, xs, ys, { color = 'accent', r = 2.5, alpha = 1, hollow = false } = {}) { g.save(); g.fillStyle = rgba(color, alpha); g.strokeStyle = rgba(color, alpha); g.lineWidth = 1.5; for (let i = 0; i < xs.length; i++) { g.beginPath(); g.arc(P.X(xs[i]), P.Y(ys[i]), r, 0, TAU); hollow ? g.stroke() : g.fill(); } g.restore(); }
// A vertical or horizontal reference line with a label: rule(g, P, { x: 72, label: 'truth 72', color: 'ok' })
export function rule(g, P, { x, y, label, color = 'text3', dash = [3, 3], side = 'right' } = {}) {
  g.save(); g.strokeStyle = rgba(color, 0.8); g.lineWidth = 1; g.setLineDash(dash); g.beginPath();
  if (x != null) { const px = Math.round(P.X(x)) + 0.5; g.moveTo(px, P.y0); g.lineTo(px, P.y1); } else { const py = Math.round(P.Y(y)) + 0.5; g.moveTo(P.x0, py); g.lineTo(P.x1, py); }
  g.stroke(); g.restore();
  if (label) { if (x != null) text(g, label, P.X(x) + (side === 'right' ? 5 : -5), P.y0 + 10, { color, size: 10.5, align: side === 'right' ? 'left' : 'right', halo: true }); else text(g, label, P.x1 - 4, P.Y(y) - 5, { color, size: 10.5, align: 'right', halo: true }); }
}

// ---------- rasters: a grid of values drawn as an image ----------
// const R = raster(w, h); R.paint((i) => [r, g, b, a255]); g.drawImage(R.canvas, x, y, W, H)
export function raster(w, hh) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = hh;
  const c = canvas.getContext('2d'), img = c.createImageData(w, hh), d = img.data;
  return { canvas, w, h: hh, data: d, paint(fn) { for (let i = 0, p = 0; i < w * hh; i++, p += 4) { const v = fn(i); d[p] = v[0]; d[p + 1] = v[1]; d[p + 2] = v[2]; d[p + 3] = v.length > 3 ? v[3] : 255; } c.putImageData(img, 0, 0); }, commit() { c.putImageData(img, 0, 0); } };
}
// A colour bar with end labels, drawn on the canvas: colorbar(g, x, y, w, heat, '0', '1', 'coherence')
export function colorbar(g, x, y, w, ramp, lo, hi, label) {
  for (let i = 0; i < w; i++) { const c = ramp(i / (w - 1)); g.fillStyle = 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; g.fillRect(x + i, y, 1.5, 6); }
  text(g, lo, x, y + 18, { color: 'text3', size: 10.5, mono: true, weight: 400 }); text(g, hi, x + w, y + 18, { color: 'text3', size: 10.5, mono: true, weight: 400, align: 'right' });
  if (label) text(g, label, x, y - 5, { color: 'text2', size: 11 });
}
export function scaleBar(g, x, y, pxPerMetre, { metres } = {}) {
  let m = metres; if (!m) { const want = 90 / pxPerMetre; const mag = 10 ** Math.floor(Math.log10(want)); m = [1, 2, 5, 10].map((k) => k * mag).filter((v) => v <= want).pop() || mag; }
  const w = m * pxPerMetre, T = tokens();
  g.save(); g.strokeStyle = T.text2; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 0.5, y - 4); g.lineTo(x + 0.5, y + 0.5); g.lineTo(x + w + 0.5, y + 0.5); g.lineTo(x + w + 0.5, y - 4); g.stroke(); g.restore();
  text(g, m >= 1000 ? m / 1000 + ' km' : m >= 1 ? m + ' m' : m * 100 + ' cm', x + w / 2, y - 6, { color: 'text2', size: 10.5, align: 'center', mono: true, halo: true });
}

// ---------- signal processing ----------
// In-place radix-2 FFT. re and im are Float64Array or Float32Array of the same power-of-two length.
export function fft(re, im, inverse = false) {
  const n = re.length; if (n & (n - 1)) throw new Error('fft length must be a power of two');
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = ((inverse ? 1 : -1) * TAU) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < half; k++) { const a = i + k, b = a + half, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
export const hann = (n) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((TAU * i) / (n - 1)));

// ---------- controls and readouts (they go in the side column) ----------
export function slider({ label, min, max, step = 1, value, unit = '', format, hint, onInput }) {
  const f = format || ((v) => String(+v.toFixed(6)));
  const out = h('output.num'), input = h('input.slider', { type: 'range', min, max, step, value, 'aria-label': label + (unit ? ', ' + unit : '') });
  const paint = () => { out.textContent = f(+input.value) + (unit ? ' ' + unit : ''); input.style.setProperty('--p', ((+input.value - min) / (max - min)) * 100 + '%'); };
  input.addEventListener('input', () => { paint(); onInput?.(+input.value); });
  paint();
  const el = h('label.horizon-ctl', hint ? { title: hint } : null, h('span.horizon-ctl-top', null, h('span', null, label), out), input);
  return { el, input, get value() { return +input.value; }, set(v, fire = false) { input.value = v; paint(); if (fire) onInput?.(+input.value); } };
}
export function seg({ label, options, value, onChange }) {
  let cur = value; const btns = options.map((o) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.value === cur), title: o.hint || null, onclick: () => api.set(o.value, true) }, o.label));
  const group = h('div.seg', { role: 'radiogroup', 'aria-label': label }, btns);
  const el = h('div.horizon-ctl', null, h('span.horizon-ctl-top', null, h('span', null, label)), group);
  const api = { el, get value() { return cur; }, set(v, fire = false) { cur = v; btns.forEach((b, i) => b.setAttribute('aria-checked', String(options[i].value === v))); if (fire) onChange?.(v); } };
  return api;
}
export function toggle({ label, value = false, hint, onChange }) {
  const input = h('input', { type: 'checkbox', checked: value, onchange: () => onChange?.(input.checked) });
  const el = h('label.check.switch.horizon-toggle', hint ? { title: hint } : null, input, h('span', null, label));
  return { el, get value() { return input.checked; }, set(v, fire = false) { input.checked = v; if (fire) onChange?.(v); } };
}
export function button({ label, icon: ic, primary = false, hint, onClick }) { return h('button.btn' + (primary ? '.btn-primary' : ''), { type: 'button', title: hint || null, onclick: onClick }, ic ? icon(ic) : null, h('span', null, label)); }
// const s = stat('Coverage', { unit: '%' }); s.set('62.4'); s.tone('ok' | 'warn' | 'danger' | 'person' | null)
export function stat(label, { unit = '', hint } = {}) {
  const b = h('b.num', null, '–'), u = unit ? h('small', null, unit) : null, sub = h('span', null, label);
  const el = h('div.stat.horizon-stat', hint ? { title: hint } : null, h('div', null, b, u), sub);
  return { el, set(v, newLabel) { b.textContent = v; if (newLabel != null) sub.textContent = newLabel; }, tone(t) { el.dataset.tone = t || ''; } };
}
export const group = (title, ...kids) => h('div.horizon-group', null, title ? h('h4', null, title) : null, ...kids);
export const row = (...kids) => h('div.row.wrap', null, ...kids);

// ---------- animation ----------
// const L = loop((dt, t) => { ... }); L.start(); L.stop();   dt is capped at 50 ms. Under reduced motion the step runs once and stops.
export function loop(step) {
  let id = 0, last = 0, on = false;
  const tick = (now) => { if (!on) return; const dt = Math.min(0.05, (now - last) / 1000); last = now; step(dt, now / 1000); if (on) id = requestAnimationFrame(tick); };
  return { start() { if (on) return; last = performance.now(); if (reduced()) { step(0, last / 1000); return; } on = true; id = requestAnimationFrame(tick); }, stop() { on = false; cancelAnimationFrame(id); }, get running() { return on; } };
}
// Coalesce bursts of slider input into one recompute per frame.
export function soon(fn) { let q = false; return (...a) => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(...a); }); }; }

// ---------- formatting ----------
export const fmtDist = (m) => (m < 0.995 ? +(m * 100).toPrecision(2) + ' cm' : m < 1000 ? +m.toPrecision(2) + ' m' : Math.round(m / 1000).toLocaleString('en-US') + ' km');
export const fix = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '–');
export const pct = (p, d = 0) => (Number.isFinite(p) ? (p * 100).toFixed(d) : '–');
