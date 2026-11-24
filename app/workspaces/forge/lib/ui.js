// Shared drawing and DOM helpers for the Model forge exhibits.
import { h, icon, fitCanvas } from '../../../ui/kit.js';

const cache = new Map();
export const tok = (name) => { if (!cache.has(name)) cache.set(name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()); return cache.get(name); };
export const clearTokens = () => cache.clear();
const col = (c) => (c && c.startsWith('--') ? tok(c) : c);

export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
export const pct = (p, d = 1) => (p * 100).toFixed(d) + ' %';
export const KIND = ['Empty room', 'Still person', 'Moving person'];
export const KIND_C = ['--text-3', '--warn', '--person'];
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// Verified sources (checked on the web on 23 November 2026). cite('guo') returns a link.
export const SOURCES = {
  guo: ['Guo, Pleiss, Sun and Weinberger, ICML 2017', 'On calibration of modern neural networks', 'https://arxiv.org/abs/1706.04599'],
  angelopoulos: ['Angelopoulos and Bates, 2021', 'A gentle introduction to conformal prediction and distribution-free uncertainty quantification', 'https://arxiv.org/abs/2107.07511'],
  lee: ['Lee, Lee, Lee and Shin, NeurIPS 2018', 'A simple unified framework for detecting out-of-distribution samples and adversarial attacks', 'https://arxiv.org/abs/1807.03888'],
  liu: ['Liu, Wang, Owens and Li, NeurIPS 2020', 'Energy-based out-of-distribution detection', 'https://arxiv.org/abs/2010.03759'],
  jacob: ['Jacob et al. (Google), CVPR 2018', 'Quantization and training of neural networks for efficient integer-arithmetic-only inference', 'https://arxiv.org/abs/1712.05877'],
  david: ['David et al., MLSys 2021', 'TensorFlow Lite Micro: embedded machine learning on TinyML systems', 'https://arxiv.org/abs/2010.08678'],
  han: ['Han, Pool, Tran and Dally, NeurIPS 2015', 'Learning both weights and connections for efficient neural networks', 'https://arxiv.org/abs/1506.02626'],
  frankle: ['Frankle and Carbin, ICLR 2019', 'The lottery ticket hypothesis: finding sparse, trainable neural networks', 'https://arxiv.org/abs/1803.03635'],
  diehl: ['Diehl et al., IJCNN 2015', 'Fast-classifying, high-accuracy spiking deep networks through weight and threshold balancing', 'https://doi.org/10.1109/IJCNN.2015.7280696'],
  rueckauer: ['Rueckauer et al., Frontiers in Neuroscience 2017', 'Conversion of continuous-valued deep networks to efficient event-driven networks for image classification', 'https://doi.org/10.3389/fnins.2017.00682'],
  davies: ['Davies et al. (Intel), IEEE Micro 2018', 'Loihi: a neuromorphic manycore processor with on-chip learning', 'https://doi.org/10.1109/MM.2018.112130359'],
  tobin: ['Tobin et al. (OpenAI), IROS 2017', 'Domain randomization for transferring deep neural networks from simulation to the real world', 'https://arxiv.org/abs/1703.06907'],
  esp32: ['Espressif, ESP32-S3-WROOM-1 datasheet', '512 KB SRAM and 384 KB ROM on the chip; the N8 module adds 8 MB of flash', 'https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf'],
};
export const cite = (key) => { const s = SOURCES[key]; return h('a.forge-cite', { href: s[2], target: '_blank', rel: 'noopener', title: s[1] }, s[0]); };
export const sources = (...keys) => h('div.forge-sources', null, h('span.forge-sources-k', null, 'Research this rests on'), keys.map((k) => { const s = SOURCES[k]; return h('a', { href: s[2], target: '_blank', rel: 'noopener' }, h('b', null, s[0]), h('span', null, s[1]), icon('external', 12)); }));

// Where a number came from. src('py', '955 test windows') / src('page', '320 bundled windows').
export const src = (kind, text) => h('span.forge-src.' + kind, { title: kind === 'py' ? 'Measured by tools/forge_export.py with the project’s own NumPy code, on the full set.' : 'Computed in this page, on your computer, just now.' }, kind === 'py' ? 'NumPy · ' : 'This page · ', text);
// A measured figure: value, unit, what it is, and how it was measured.
export function fig(value, unit, label, method, kind = 'py', cls = '') {
  const b = h('b.num', null, value, unit ? h('small', null, unit) : null);
  const el = h('div.forge-fig' + (cls ? '.' + cls : ''), null, b, h('span.forge-fig-l', null, label), method ? src(kind, method) : null);
  el.set = (v) => { b.firstChild.nodeValue = v; };
  return el;
}
export const honest = (...text) => h('div.forge-honest', null, icon('info', 15), h('p', null, h('b', null, 'What would have to be true. '), ...text));
export const method = (...text) => h('p.forge-method', null, h('b', null, 'Method. '), ...text);
export const block = (title, tagEl, ...body) => { const el = h('section.forge-block', { 'aria-label': title }, h('header', null, h('h3', null, title), tagEl), ...body); return el; };

// Confusion table by kind of window: rows empty / still / moving, columns said "no one" / "person".
export function kindMatrix(caption) {
  const cells = [], el = h('div.forge-cm', null, h('div.forge-cm-cap', null, caption), h('div.forge-cm-grid', null,
    h('span'), h('span.forge-cm-h', null, 'said no one'), h('span.forge-cm-h', null, 'said person'),
    ...KIND.flatMap((k, r) => [h('span.forge-cm-r', null, k), ...[0, 1].map((c) => { const cell = h('span.forge-cm-c.num', { 'data-good': String((r === 0) === (c === 0)) }, '…'); cells.push(cell); return cell; })])));
  el.set = (byKind) => { byKind.forEach((row, r) => { const n = row[0] + row[1] || 1; row.forEach((v, c) => { const cell = cells[r * 2 + c]; cell.textContent = v; cell.style.setProperty('--f', (v / n).toFixed(3)); }); }); };
  return el;
}
// Counts by kind from P(person), a threshold and the kinds.
export function byKind(p, thr, kind) { const m = [[0, 0], [0, 0], [0, 0]]; for (let i = 0; i < kind.length; i++) m[kind[i]][p[i] > thr ? 1 : 0]++; return m; }
export const ratesOf = (m) => ({ emptyOk: m[0][0] / (m[0][0] + m[0][1] || 1), still: m[1][1] / (m[1][0] + m[1][1] || 1), moving: m[2][1] / (m[2][0] + m[2][1] || 1), acc: (m[0][0] + m[1][1] + m[2][1]) / (m.flat().reduce((a, b) => a + b, 0) || 1) });
// The threshold the project uses: at most fa of the empty rooms above it (np.quantile, linear interpolation).
export function thresholdAt(p, kind, fa = 0.1) { const e = []; for (let i = 0; i < kind.length; i++) if (kind[i] === 0) e.push(p[i]); e.sort((a, b) => a - b); if (!e.length) return 0.5; const pos = (1 - fa) * (e.length - 1), lo = Math.floor(pos), hi = Math.min(e.length - 1, lo + 1); return e[lo] + (e[hi] - e[lo]) * (pos - lo); }
export function aucOf(score, label) { const idx = Array.from(score, (_, i) => i).sort((a, b) => score[a] - score[b]); let n1 = 0, rs = 0, i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && score[idx[j + 1]] === score[idx[i]]) j++; const rk = (i + j) / 2 + 1; for (let k = i; k <= j; k++) if (label[idx[k]]) { rs += rk; n1++; } i = j + 1; } const n0 = idx.length - n1; return n1 && n0 ? (rs - n1 * (n1 + 1) / 2) / (n1 * n0) : 0.5; }

// ---------------------------------------------------------------------------------------------------------------
// A small canvas plot. const p = plotter(canvas); p.set({ x, y, series, ... }).
//   x, y: { min, max, ticks: [..], fmt: (v) => '', label: '', log: false }
//   series: [{ pts: [[x, y], ..], color, width, dash: [..], dots, label, labelAt: 'end' | 'start' | [x, y], fill }]
//   vlines / hlines: [{ at, color, dash, label }]   points: [{ x, y, color, r, label, ring }]   bands: [{ x0, x1, color }]
export function plotter(canvas, pad = {}) {
  let spec = null, W = 0, H = 0, c2 = null;
  const m = { l: 46, r: 14, t: 10, b: 34, ...pad }; m.l += 12;
  const sx = (v) => { const a = spec.x; const u = a.log ? (Math.log(v) - Math.log(a.min)) / (Math.log(a.max) - Math.log(a.min)) : (v - a.min) / (a.max - a.min); return m.l + u * (W - m.l - m.r); };
  const sy = (v) => { const a = spec.y; return H - m.b - ((v - a.min) / (a.max - a.min)) * (H - m.t - m.b); };
  function draw() {
    if (!spec || !c2 || !W) return;
    const c = c2; c.clearRect(0, 0, W, H);
    c.font = '10.5px ' + tok('--mono'); c.lineWidth = 1;
    for (const b of spec.bands || []) { c.fillStyle = col(b.color); c.fillRect(sx(b.x0), m.t, sx(b.x1) - sx(b.x0), H - m.t - m.b); }
    c.strokeStyle = tok('--line'); c.fillStyle = tok('--text-3'); c.textBaseline = 'middle'; c.textAlign = 'right';
    for (const t of spec.y.ticks || []) { const y = Math.round(sy(t)) + 0.5; c.beginPath(); c.moveTo(m.l, y); c.lineTo(W - m.r, y); c.stroke(); c.fillText((spec.y.fmt || String)(t), m.l - 7, y); }
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (const t of spec.x.ticks || []) { const x = Math.round(sx(t)) + 0.5; c.strokeStyle = tok('--line-2'); c.beginPath(); c.moveTo(x, H - m.b); c.lineTo(x, H - m.b + 4); c.stroke(); c.fillText((spec.x.fmt || String)(t), x, H - m.b + 7); }
    c.strokeStyle = tok('--line-2'); c.beginPath(); c.moveTo(m.l + 0.5, m.t); c.lineTo(m.l + 0.5, H - m.b + 0.5); c.lineTo(W - m.r, H - m.b + 0.5); c.stroke();
    c.font = '500 11px ' + tok('--font'); c.fillStyle = tok('--text-2');
    if (spec.x.label) { c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText(spec.x.label, W - m.r, H - 2); }
    if (spec.y.label) { c.save(); c.translate(11, m.t); c.rotate(-Math.PI / 2); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(spec.y.label, 0, 0); c.restore(); }
    for (const l of spec.hlines || []) { const y = Math.round(sy(l.at)) + 0.5; c.strokeStyle = col(l.color || '--text-3'); c.setLineDash(l.dash || [3, 3]); c.beginPath(); c.moveTo(m.l, y); c.lineTo(W - m.r, y); c.stroke(); c.setLineDash([]);
      if (l.label) { c.font = '500 10.5px ' + tok('--font'); c.fillStyle = col(l.color || '--text-3'); c.textAlign = l.align === 'left' ? 'left' : 'right'; c.textBaseline = 'bottom'; c.fillText(l.label, l.align === 'left' ? m.l + 6 : W - m.r - 4, y - 3); } }
    for (const l of spec.vlines || []) { const x = Math.round(sx(l.at)) + 0.5; c.strokeStyle = col(l.color || '--text-3'); c.setLineDash(l.dash || [3, 3]); c.beginPath(); c.moveTo(x, m.t); c.lineTo(x, H - m.b); c.stroke(); c.setLineDash([]);
      if (l.label) { c.font = '600 10.5px ' + tok('--font'); c.fillStyle = col(l.color || '--text-3'); const right = x > W - 120; c.textAlign = right ? 'right' : 'left'; c.textBaseline = 'top'; c.fillText(l.label, x + (right ? -5 : 5), m.t + (l.dy || 2)); } }
    c.save(); c.beginPath(); c.rect(m.l, m.t - 4, W - m.l - m.r + 2, H - m.t - m.b + 5); c.clip();
    for (const s of spec.series || []) {
      if (!s.pts?.length) continue;
      c.strokeStyle = col(s.color || '--accent'); c.lineWidth = s.width || 1.6; c.setLineDash(s.dash || []); c.lineJoin = 'round';
      if (s.fill) { c.beginPath(); c.moveTo(sx(s.pts[0][0]), sy(spec.y.min)); for (const p of s.pts) c.lineTo(sx(p[0]), sy(p[1])); c.lineTo(sx(s.pts[s.pts.length - 1][0]), sy(spec.y.min)); c.closePath(); c.fillStyle = col(s.fill); c.fill(); }
      if (!s.noLine) { c.beginPath(); s.pts.forEach((p, i) => (i ? c.lineTo(sx(p[0]), sy(p[1])) : c.moveTo(sx(p[0]), sy(p[1])))); c.stroke(); }
      c.setLineDash([]);
      if (s.dots) { c.fillStyle = col(s.color || '--accent'); for (const p of s.pts) { c.beginPath(); c.arc(sx(p[0]), sy(p[1]), s.dots, 0, 7); c.fill(); } }
    }
    c.restore();
    for (const p of spec.points || []) { const x = sx(p.x), y = sy(p.y); c.beginPath(); c.arc(x, y, p.r || 4, 0, 7); if (p.ring) { c.strokeStyle = col(p.color); c.lineWidth = 1.6; c.stroke(); } else { c.fillStyle = col(p.color); c.fill(); c.strokeStyle = tok('--bg-2'); c.lineWidth = 1.5; c.stroke(); }
      if (p.label) { c.font = '600 10.5px ' + tok('--font'); c.fillStyle = col(p.labelColor || p.color); const right = x > W - 110; c.textAlign = right ? 'right' : 'left'; c.textBaseline = 'middle'; c.fillText(p.label, x + (right ? -8 : 8), y + (p.dy || 0)); } }
    c.font = '600 10.5px ' + tok('--font');
    for (const s of spec.series || []) {
      if (!s.label || !s.pts?.length) continue;
      const at = Array.isArray(s.labelAt) ? s.labelAt : s.labelAt === 'start' ? s.pts[0] : s.pts[s.pts.length - 1];
      const x = sx(at[0]), y = sy(at[1]); c.fillStyle = col(s.color || '--accent');
      const right = s.labelAt !== 'start' && x > W - m.r - 60; c.textAlign = right ? 'right' : 'left'; c.textBaseline = 'bottom';
      c.fillText(s.label, clamp(x + (right ? -4 : 6), m.l + 4, W - 4), clamp(y - 5 + (s.dy || 0), m.t + 12, H - m.b - 2));
    }
  }
  const stop = fitCanvas(canvas, (c, w, hh) => { c2 = c; W = w; H = hh; draw(); });
  return { set(s) { spec = s; draw(); }, draw, sx: (v) => sx(v), sy: (v) => sy(v), invX: (px) => { const a = spec.x, u = (px - m.l) / (W - m.l - m.r); return a.log ? Math.exp(Math.log(a.min) + u * (Math.log(a.max) - Math.log(a.min))) : a.min + u * (a.max - a.min); }, stop };
}

// ---- colour ramps (from the heat tokens' values; data ramps are allowed to carry their own stops) ----
const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function ramp(stops) { const s = stops.map(([t, c]) => [t, hexRgb(c)]); return (t) => { if (!(t > s[0][0])) return s[0][1]; for (let i = 1; i < s.length; i++) if (t <= s[i][0]) { const [t0, a] = s[i - 1], [t1, b] = s[i], u = (t - t0) / (t1 - t0); return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; } return s[s.length - 1][1]; }; }
const NEG = ramp([[0, '#0b0e13'], [0.35, '#1f3357'], [0.75, '#5aa9ff'], [1, '#d6e9ff']]), POS = ramp([[0, '#0b0e13'], [0.35, '#5a3a1c'], [0.75, '#ffb24a'], [1, '#fff3c4']]);
export const signed = (v) => (v < 0 ? NEG(Math.min(1, -v)) : POS(Math.min(1, v)));
export const HEAT = ramp([[0, '#0b0e13'], [0.12, '#1b2740'], [0.32, '#2b3f6b'], [0.52, '#7a3f8f'], [0.72, '#d8504d'], [0.88, '#ffb24a'], [1, '#fff3c4']]);

// Paint an array as pixels (w x h, one value each) into a canvas at native resolution; CSS scales it (pixelated).
export function paint(canvas, w, hh, colorAt) {
  if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
  const c = canvas.getContext('2d'), img = c.createImageData(w, hh), d = img.data;
  for (let i = 0; i < w * hh; i++) { const rgb = colorAt(i); d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255; }
  c.putImageData(img, 0, 0);
}
// A Wi-Fi window (subcarrier-major floats, 52 x 200) as a 200 x 52 image: blue below the mean, amber above.
// The 51 subcarrier rows share one scale (span, in % change); the motion row at the bottom has its own.
export function paintWindow(canvas, x, off = 0, span = 2) {
  paint(canvas, 200, 52, (i) => { const r = Math.floor(i / 200), v = x[off + i]; return r === 51 ? HEAT(clamp((v + 1) / 6, 0, 1)) : signed(Math.sign(v) * Math.pow(Math.min(1, Math.abs(v) / span), 0.7)); });
}
export function decodeToFloat(codes, i, dec, out) { const o = i * 10400; for (let k = 0; k < 10400; k++) out[k] = dec[codes[o + k] + 128]; return out; }

// A labelled slider row. Returns { el, input, set(v) }.
export function slider(label, { min, max, step, value, fmt = String, oninput }) {
  const out = h('output.num', null, fmt(value));
  const input = h('input.slider', { type: 'range', min, max, step, value, 'aria-label': label });
  const sync = () => { input.style.setProperty('--p', ((input.value - min) / (max - min)) * 100 + '%'); out.textContent = fmt(+input.value); };
  input.addEventListener('input', () => { sync(); oninput?.(+input.value); });
  sync();
  return { el: h('label.forge-slider', null, h('span', null, label), input, out), input, set(v) { input.value = v; sync(); } };
}
export function seg(label, options, value, onchange) {
  const el = h('div.seg', { role: 'radiogroup', 'aria-label': label });
  const set = (v, fire = true) => { value = v; el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === String(v)))); if (fire) onchange(v); };
  options.forEach(([v, text, tip]) => el.append(h('button', { role: 'radio', 'data-v': v, title: tip || null, 'aria-checked': String(v === value), onclick: () => set(v) }, text)));
  el.set = set; el.value = () => value;
  return el;
}
export const raf = () => new Promise((r) => requestAnimationFrame(r));
