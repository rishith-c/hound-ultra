// Shared pieces for the Search strategy lab: verified sources, the exhibit brief, a small canvas chart, statistics.
// Nothing here knows about a particular exhibit.

// Every source below was checked on 23 November 2026 (title, authors, venue, year and link). Cite only from here.
export const SOURCES = {
  koopman: { who: 'B. O. Koopman', year: 1946, title: 'Search and Screening, Operations Evaluation Group Report 56 (US Navy)', note: 'Republished as “The Theory of Search”, Operations Research 4 and 5, 1956 to 1957.', url: 'https://doi.org/10.1287/opre.4.3.324' },
  scorpion: { who: 'H. R. Richardson and L. D. Stone', year: 1971, title: 'Operations analysis during the underwater search for Scorpion, Naval Research Logistics Quarterly 18, 141–157', url: 'https://onlinelibrary.wiley.com/doi/abs/10.1002/nav.3800180202' },
  af447: { who: 'L. D. Stone, C. M. Keller, T. M. Kratzke and J. P. Strumpfer', year: 2014, title: 'Search for the Wreckage of Air France Flight AF 447, Statistical Science 29(1), 69–80', url: 'https://doi.org/10.1214/13-STS420' },
  sarops: { who: 'T. M. Kratzke, L. D. Stone and J. R. Frost', year: 2010, title: 'Search and Rescue Optimal Planning System (the US Coast Guard’s planning tool), 13th Int. Conf. on Information Fusion', url: 'https://doi.org/10.1109/ICIF.2010.5712114' },
  bourgault: { who: 'F. Bourgault, T. Furukawa and H. F. Durrant-Whyte', year: 2003, title: 'Optimal Search for a Lost Target in a Bayesian World, Field and Service Robotics', url: 'https://link.springer.com/chapter/10.1007/10991459_21' },
  howard: { who: 'R. A. Howard', year: 1966, title: 'Information Value Theory, IEEE Transactions on Systems Science and Cybernetics 2(1), 22–26', url: 'https://doi.org/10.1109/TSSC.1966.300074' },
  pomcp: { who: 'D. Silver and J. Veness', year: 2010, title: 'Monte-Carlo Planning in Large POMDPs, Advances in Neural Information Processing Systems 23', url: 'https://papers.nips.cc/paper/4031-monte-carlo-planning-in-large-pomdps' },
  kadowaki: { who: 'T. Kadowaki and H. Nishimori', year: 1998, title: 'Quantum annealing in the transverse Ising model, Physical Review E 58, 5355', url: 'https://doi.org/10.1103/PhysRevE.58.5355' },
  martonak: { who: 'R. Martoňák, G. E. Santoro and E. Tosatti', year: 2004, title: 'Quantum annealing of the traveling-salesman problem, Physical Review E 70, 057701', url: 'https://doi.org/10.1103/PhysRevE.70.057701' },
  lucas: { who: 'A. Lucas', year: 2014, title: 'Ising formulations of many NP problems, Frontiers in Physics 2, 5', url: 'https://doi.org/10.3389/fphy.2014.00005' },
};

const svgNS = 'http://www.w3.org/2000/svg';

// The brief every exhibit opens with: what it is in two sentences, where the idea comes from, how real it is, and
// what would have to be true in the field.
//   exhibitBrief(kit, { n, title, sentences: [a, b], sources: ['af447', ...], tags: ['live-algo', 'sim'], field, unknown })
export function exhibitBrief(kit, { n, title, sentences, sources = [], tags = [], field, unknown }) {
  const { h, realityTag, icon } = kit;
  return h('section.strategy-brief-card', { 'aria-label': title },
    h('div.strategy-brief-top', null, h('span.strategy-brief-n.num', { 'aria-hidden': 'true' }, String(n).padStart(2, '0')), h('div.row.tight.wrap', null, ...tags.map((t) => realityTag(t)))),
    h('h2.strategy-brief-title', null, title),
    h('p.strategy-brief-what', null, sentences[0], ' ', sentences[1]),
    sources.length ? h('ul.strategy-sources', { 'aria-label': 'Published research behind this exhibit' }, ...sources.map((id) => {
      const s = SOURCES[id];
      return h('li', null, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', title: s.note || s.title }, h('b', null, s.who + ', ' + s.year + '. '), s.title, icon('external', 11)));
    })) : null,
    h('dl.strategy-honest', null,
      h('dt', null, 'For this to work in the field'), h('dd', null, field),
      h('dt', null, 'Not known yet'), h('dd', null, unknown)));
}

// The Demo layer of an exhibit: title, one sentence, reality tags, one caption, at most one action. Lower left.
//   demoOverlay(kit, { title, sentence, tags, action: { label, icon, run } }) -> { el, caption(text) }
export function demoOverlay(kit, { title, sentence, tags = [], action = null }) {
  const { h, realityTag, icon } = kit, cap = h('p.strategy-demo-cap', { 'aria-live': 'polite' }); let last = '';
  const el = h('div.strategy-demo', null,
    h('div.strategy-demo-text.demo-only', null, h('div.row.tight', null, ...tags.map((t) => realityTag(t))), h('h1', null, title), h('p.strategy-demo-what', null, sentence)),
    h('div.strategy-demo-foot', null, cap, action ? h('button.btn.demo-only', { type: 'button', onclick: action.run }, icon(action.icon || 'reset', 14), action.label) : null));
  return { el, caption(t) { if (t !== last) { last = t; cap.textContent = t; } } };
}

// ---------- tokens ----------
let tokCache = new Map();
export function tok(name) { let v = tokCache.get(name); if (v == null) { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); tokCache.set(name, v); } return v; }
export function dropTokens() { tokCache = new Map(); rampCache = null; }
export function hexRgb(hex) { const s = hex.replace('#', ''); const n = parseInt(s.length === 3 ? s.replace(/./g, '$&$&') : s, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgba(name, a) { const [r, g, b] = hexRgb(tok(name)); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; }
let rampCache = null;
// The data ramp from the design tokens (--heat-0 … --heat-5). t in 0..1, returns [r, g, b] 0..255.
export function heat(t) {
  if (!rampCache) rampCache = [0, 1, 2, 3, 4, 5].map((i) => hexRgb(tok('--heat-' + i)));
  const x = Math.min(0.9999, Math.max(0, t)) * 5, i = Math.floor(x), f = x - i, a = rampCache[i], b = rampCache[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
export const heatStops = () => [0, 1, 2, 3, 4, 5].map((i) => hexRgb(tok('--heat-' + i)));

// ---------- statistics ----------
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
export function sd(a) { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); }
// Two-sided 95 % Student t quantile (table for small n, 1.96 beyond).
const T95 = [NaN, 12.71, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
export const t95 = (df) => (df < 1 ? NaN : df <= 30 ? T95[df] : df <= 60 ? 2.0 : df <= 120 ? 1.98 : 1.96);
// Mean with a 95 % confidence interval: { n, mean, lo, hi, half }.
export function ci(a) { const n = a.length, m = mean(a), half = n > 1 ? (t95(n - 1) * sd(a)) / Math.sqrt(n) : NaN; return { n, mean: m, half, lo: m - half, hi: m + half }; }
// Paired difference a[i] - b[i] (the same worlds under two conditions).
export function paired(a, b) { const n = Math.min(a.length, b.length), d = new Array(n); for (let i = 0; i < n; i++) d[i] = a[i] - b[i]; return ci(d); }

// ---------- a small canvas chart ----------
// createChart(canvas, kit) -> { set(spec), redraw(), destroy() }
// spec: { x: { min, max, label, ticks, fmt }, y: { min, max, label, ticks, fmt },
//         series: [{ pts: [[x, y], ...], color: '--accent', width, dash, step, label, band: [[x, lo, hi], ...], dots, fill }],
//         marks: [{ x, label, color }], hlines: [{ y, label, color, dash }], empty: 'text when there is nothing to draw' }
export function niceTicks(min, max, n = 5) {
  const span = max - min || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12));
  return out;
}
export function createChart(canvas, kit) {
  let spec = null, W = 0, H = 0, c2 = null;
  const pad = { l: 44, r: 14, t: 10, b: 34 };
  function draw() {
    if (!c2 || !W) return;
    const c = c2; c.clearRect(0, 0, W, H);
    if (!spec) return;
    pad.t = spec.y.label ? 26 : 10;
    const { x, y } = spec, pl = spec.padL ?? pad.l, pr = spec.padR ?? pad.r, pw = W - pl - pr, ph = H - pad.t - pad.b;
    const sx = (v) => pl + ((v - x.min) / (x.max - x.min || 1)) * pw, sy = (v) => pad.t + ph - ((v - y.min) / (y.max - y.min || 1)) * ph;
    c.font = '400 11px ' + tok('--mono'); c.lineWidth = 1;
    const yt = y.ticks || niceTicks(y.min, y.max, Math.max(2, Math.floor(ph / 34))), xt = x.ticks || niceTicks(x.min, x.max, Math.max(2, Math.floor(pw / 64)));
    c.strokeStyle = tok('--line'); c.fillStyle = tok('--text-3'); c.textBaseline = 'middle'; c.textAlign = 'right';
    for (const v of yt) { const py = Math.round(sy(v)) + 0.5; c.beginPath(); c.moveTo(pl, py); c.lineTo(pl + pw, py); c.stroke(); c.fillText(y.fmt ? y.fmt(v) : String(v), pl - 7, py); }
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (const v of xt) { const px = Math.round(sx(v)) + 0.5; c.strokeStyle = tok('--line-2'); c.beginPath(); c.moveTo(px, pad.t + ph); c.lineTo(px, pad.t + ph + 4); c.stroke(); c.fillText(x.fmt ? x.fmt(v) : String(v), px, pad.t + ph + 7); }
    c.strokeStyle = tok('--line-2'); c.beginPath(); c.moveTo(pl + 0.5, pad.t); c.lineTo(pl + 0.5, pad.t + ph + 0.5); c.lineTo(pl + pw, pad.t + ph + 0.5); c.stroke();
    c.fillStyle = tok('--text-2'); c.font = '500 11px ' + tok('--font');
    if (x.label) { c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText(x.label, pl + pw, H - 2); }
    if (y.label) { c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(y.label, 2, 0); }
    c.save(); c.beginPath(); c.rect(pl, pad.t - 2, pw + 2, ph + 4); c.clip();
    for (const hl of spec.hlines || []) { const py = Math.round(sy(hl.y)) + 0.5; c.strokeStyle = tok(hl.color || '--text-3'); c.setLineDash(hl.dash || [3, 3]); c.beginPath(); c.moveTo(pl, py); c.lineTo(pl + pw, py); c.stroke(); c.setLineDash([]); if (hl.label) { c.fillStyle = tok(hl.color || '--text-3'); c.font = '400 11px ' + tok('--font'); c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText(hl.label, pl + pw - 4, py - 2); } }
    for (const m of spec.marks || []) { const px = Math.round(sx(m.x)) + 0.5; c.strokeStyle = tok(m.color || '--line-3'); c.setLineDash(m.dash || [2, 3]); c.beginPath(); c.moveTo(px, pad.t); c.lineTo(px, pad.t + ph); c.stroke(); c.setLineDash([]); if (m.label) { c.fillStyle = tok(m.color || '--text-3'); c.font = '400 11px ' + tok('--font'); c.textAlign = px > pl + pw - 60 ? 'right' : 'left'; c.textBaseline = 'top'; c.fillText(m.label, px + (px > pl + pw - 60 ? -4 : 4), pad.t + 1); } }
    const labels = [];
    for (const s of spec.series || []) {
      const col = tok(s.color || '--accent');
      if (s.band && s.band.length > 1) {
        c.beginPath(); s.band.forEach((p, i) => (i ? c.lineTo(sx(p[0]), sy(p[2])) : c.moveTo(sx(p[0]), sy(p[2]))));
        for (let i = s.band.length - 1; i >= 0; i--) c.lineTo(sx(s.band[i][0]), sy(s.band[i][1]));
        c.closePath(); c.globalAlpha = 0.16; c.fillStyle = col; c.fill(); c.globalAlpha = 1;
      }
      const pts = s.pts || []; if (!pts.length) continue;
      c.beginPath();
      pts.forEach((p, i) => { const px = sx(p[0]), py = sy(p[1]); if (!i) c.moveTo(px, py); else { if (s.step) c.lineTo(px, sy(pts[i - 1][1])); c.lineTo(px, py); } });
      if (s.fill) { c.save(); c.lineTo(sx(pts[pts.length - 1][0]), sy(y.min)); c.lineTo(sx(pts[0][0]), sy(y.min)); c.closePath(); const g = c.createLinearGradient(0, pad.t, 0, pad.t + ph); g.addColorStop(0, rgba(s.color || '--accent', 0.22)); g.addColorStop(1, rgba(s.color || '--accent', 0)); c.fillStyle = g; c.fill(); c.restore(); c.beginPath(); pts.forEach((p, i) => { const px = sx(p[0]), py = sy(p[1]); if (!i) c.moveTo(px, py); else { if (s.step) c.lineTo(px, sy(pts[i - 1][1])); c.lineTo(px, py); } }); }
      c.strokeStyle = col; c.lineWidth = s.width || 1.6; c.lineJoin = 'round'; c.setLineDash(s.dash || []); c.stroke(); c.setLineDash([]);
      if (s.dots) { c.fillStyle = col; for (const p of pts) { c.beginPath(); c.arc(sx(p[0]), sy(p[1]), s.dots, 0, 7); c.fill(); } }
      if (s.label) { const p = pts[pts.length - 1]; labels.push({ text: s.label, x: sx(p[0]), y: sy(p[1]), col }); }
    }
    c.restore();
    // direct labels at the end of each line, nudged apart
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    for (let i = labels.length - 1, lim = pad.t + ph - 6; i >= 0; i--, lim = labels[i + 1].y - 13) if (labels[i].y > lim) labels[i].y = lim;
    c.font = '500 11px ' + tok('--font'); c.textBaseline = 'middle';
    for (const l of labels) { const w = c.measureText(l.text).width, right = l.x + 6 + w > W - 2; c.textAlign = right ? 'right' : 'left'; const ly = Math.min(pad.t + ph - 6, Math.max(pad.t + 6, l.y + (right ? -9 : 0))); c.fillStyle = l.col; c.fillText(l.text, right ? Math.min(l.x - 4, W - 3) : l.x + 6, ly); }
    if (spec.empty && !(spec.series || []).some((s) => s.pts && s.pts.length)) { c.fillStyle = tok('--text-3'); c.font = '400 12px ' + tok('--font'); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(spec.empty, pl + pw / 2, pad.t + ph / 2); }
  }
  const off = kit.fitCanvas(canvas, (c, w, hh) => { c2 = c; W = w; H = hh; draw(); });
  return { set(s) { spec = s; draw(); }, redraw: draw, destroy: off };
}

// An animation loop that can be started and stopped (workspaces must stop drawing when hidden).
export function makeLoop(fn) {
  let id = 0, last = 0;
  const tick = (ts) => { const dt = Math.min(0.1, (ts - last) / 1000 || 0.016); last = ts; id = requestAnimationFrame(tick); fn(dt, ts / 1000); };
  return { start() { if (!id) { last = performance.now(); id = requestAnimationFrame(tick); } }, stop() { cancelAnimationFrame(id); id = 0; }, get running() { return !!id; } };
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const fmtPct = (p, d = 0) => (p * 100).toFixed(d) + ' %';
export const fmtClock = (t) => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); };
export function svgEl(tag, attrs = {}, ...kids) { const el = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v); for (const k of kids) if (k != null) el.append(k); return el; }
