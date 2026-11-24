// Structure lab: small canvas charts. Colours come from the design tokens; every chart labels its axes with units.
export function makeChart(kit, canvas, draw) {
  let data = null, size = [0, 0];
  const paint = (c, w, h) => { size = [w, h]; c.clearRect(0, 0, w, h); if (data != null) draw(c, w, h, data, pal(kit)); };
  kit.fitCanvas(canvas, paint);
  return { update(d) { data = d; const dpr = Math.min(2, devicePixelRatio || 1); const c = canvas.getContext('2d'); if (!size[0]) return; c.setTransform(dpr, 0, 0, dpr, 0, 0); paint(c, size[0], size[1]); } };
}
let P = null;
function pal(kit) { if (P) return P; const v = kit.cssVar; P = { text: v('--text'), t2: v('--text-2'), t3: v('--text-3'), line: v('--line'), line2: v('--line-2'), accent: v('--accent'), ok: v('--ok'), warn: v('--warn'), danger: v('--danger'), person: v('--person'), sim: v('--sim'), bg: v('--bg-0'), mono: v('--mono'), font: v('--font') }; return P; }
export function resetPalette() { P = null; }
const label = (c, p, s, x, y, { align = 'left', color = p.t3, size = 11, mono = false, base = 'alphabetic' } = {}) => { c.font = (mono ? '500 ' : '400 ') + size + 'px ' + (mono ? p.mono : p.font); c.fillStyle = color; c.textAlign = align; c.textBaseline = base; c.fillText(s, x, y); };

export function drawSpark(c, w, h, d, p) {
  const { values, mark } = d; if (!values.length) return; const max = Math.max(1, ...values);
  c.beginPath(); values.forEach((v, i) => { const x = 1 + (w - 2) * i / Math.max(1, values.length - 1), y = h - 2 - (h - 5) * v / max; i ? c.lineTo(x, y) : c.moveTo(x, y); });
  c.strokeStyle = p.accent; c.lineWidth = 1.4; c.stroke(); c.lineTo(w - 1, h - 1); c.lineTo(1, h - 1); c.closePath(); c.globalAlpha = 0.14; c.fillStyle = p.accent; c.fill(); c.globalAlpha = 1;
  if (mark != null) { const x = 1 + (w - 2) * mark; c.strokeStyle = p.ok; c.setLineDash([2, 2]); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); c.setLineDash([]); }
}
// Betti numbers against the thickening radius, on a log-like scale
export function drawBetti(c, w, h, curve, p) {
  const L = 34, R = 74, T = 8, B = 30, pw = w - L - R, ph = h - T - B; if (!curve.length) return;
  const rmax = Math.max(0.5, curve[curve.length - 1].r), vmax = Math.max(10, ...curve.map((k) => Math.max(k.b0, k.b1, k.b2)));
  const X = (r) => L + pw * r / rmax, sy = (v) => Math.log10(1 + v), top = sy(vmax), Y = (v) => T + ph - ph * sy(v) / top;
  c.lineWidth = 1; c.strokeStyle = p.line;
  for (const t of [0, 1, 10, 100, 1000, 10000]) { if (t > vmax * 1.2) break; const y = Math.round(Y(t)) + 0.5; c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke(); label(c, p, String(t), L - 6, y + 3.5, { align: 'right', mono: true, size: 10 }); }
  for (let r = 0; r <= rmax + 1e-6; r += 0.1) { const x = Math.round(X(r)) + 0.5; c.beginPath(); c.moveTo(x, T + ph); c.lineTo(x, T + ph + 4); c.stroke(); label(c, p, (2 * r * 100).toFixed(0), x, T + ph + 15, { align: 'center', mono: true, size: 10 }); }
  label(c, p, 'gaps narrower than this are sealed, cm', L + pw / 2, h - 2, { align: 'center' });
  const series = [['b1', 'tunnels', p.t2], ['b0', 'pieces', p.accent], ['b2', 'sealed pockets', p.warn]]; const ends = [];
  for (const [k, name, colr] of series) { c.beginPath(); curve.forEach((q, i) => { const x = X(q.r), y = Y(q[k]); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.strokeStyle = colr; c.lineWidth = k === 'b2' ? 2 : 1.4; c.stroke(); for (const q of curve) { c.beginPath(); c.arc(X(q.r), Y(q[k]), k === 'b2' ? 2.6 : 1.8, 0, 6.3); c.fillStyle = colr; c.fill(); } const q = curve[curve.length - 1]; ends.push({ y: Y(q[k]), name: name + ' ' + q[k], colr, x: X(q.r) }); }
  ends.sort((a, b) => a.y - b.y); for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
  for (const e of ends) label(c, p, e.name, e.x + 8, e.y + 3.5, { color: e.colr, size: 11 });
}
// Persistence diagram of the air pockets: widest way in (x) against the largest sphere that fits (y)
export function drawPersistence(c, w, h, d, p) {
  const L = 38, R = 10, T = 8, B = 30, pw = w - L - R, ph = h - T - B; const { pairs, voids, sel } = d;
  const max = Math.max(0.6, ...pairs.map((q) => q[1]), ...voids.map((v) => v.inscribed)) * 1.08, X = (v) => L + pw * v / max, Y = (v) => T + ph - ph * v / max;
  c.strokeStyle = p.line; c.lineWidth = 1;
  for (let t = 0; t <= max; t += 0.2) { const y = Math.round(Y(t)) + 0.5, x = Math.round(X(t)) + 0.5; c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke(); label(c, p, (t * 200).toFixed(0), L - 6, y + 3.5, { align: 'right', mono: true, size: 10 }); label(c, p, (t * 200).toFixed(0), x, T + ph + 14, { align: 'center', mono: true, size: 10 }); }
  c.strokeStyle = p.line2; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(X(0), Y(0)); c.lineTo(X(max), Y(max)); c.stroke(); c.setLineDash([]);
  c.fillStyle = 'rgba(255,106,69,0.07)'; c.fillRect(X(0), Y(max), X(0.3) - X(0), Y(0.25) - Y(max));     // a person fits, a rescuer cannot walk in
  label(c, p, 'a person fits, the way in is tight', X(0) + 5, Y(max) + 13, { color: p.t3, size: 10 });
  label(c, p, 'widest way in, cm across', L + pw / 2, h - 2, { align: 'center' });
  c.save(); c.translate(10, T + ph / 2); c.rotate(-Math.PI / 2); label(c, p, 'largest sphere inside, cm', 0, 0, { align: 'center' }); c.restore();
  for (const q of pairs) { c.beginPath(); c.arc(X(q[0]), Y(q[1]), 1.6, 0, 6.3); c.fillStyle = q[2] ? 'rgba(170,179,190,0.55)' : 'rgba(128,139,153,0.25)'; c.fill(); }
  for (const v of voids) { const x = X(v.throat), y = Y(v.inscribed), on = v.id === sel; c.beginPath(); c.arc(x, y, on ? 6 : 4.2, 0, 6.3); c.fillStyle = v.person ? p.person : p.warn; c.globalAlpha = on ? 1 : 0.85; c.fill(); c.globalAlpha = 1; if (on) { c.strokeStyle = p.text; c.lineWidth = 1.5; c.stroke(); } label(c, p, v.id, x + 8, y + 3.5, { color: on ? p.text : p.t2, size: 10, mono: true }); }
}
// One bar per tremor trial: how far the worst piece moved
export function drawTrials(c, w, h, d, p) {
  const { trials, n } = d, L = 30, B = 16, T = 6, pw = w - L - 4, ph = h - T - B, bw = pw / n; const max = 0.5;
  const Y = (v) => T + ph - ph * Math.min(1, Math.sqrt(v / max));
  c.strokeStyle = p.line; c.lineWidth = 1; for (const t of [0.05, 0.2, 0.5]) { const y = Math.round(Y(t)) + 0.5; c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke(); label(c, p, (t * 100).toFixed(0), L - 5, y + 3.5, { align: 'right', mono: true, size: 10 }); }
  c.strokeStyle = p.warn; c.setLineDash([3, 3]); const y5 = Math.round(Y(0.05)) + 0.5; c.beginPath(); c.moveTo(L, y5); c.lineTo(L + pw, y5); c.stroke(); c.setLineDash([]);
  for (let i = 0; i < n; i++) { const t = trials[i], x = L + i * bw + 1.5; if (!t) { c.fillStyle = p.line; c.fillRect(x, T + ph - 2, bw - 3, 2); continue; } const y = Y(Math.max(0.004, t.shift)); c.fillStyle = t.compromised ? p.danger : t.shifted ? p.warn : p.ok; c.fillRect(x, y, bw - 3, T + ph - y); }
  label(c, p, 'largest shift in each trial, cm (dashed line: 5 cm)', L, h - 3, {});
}
export function drawFragility(c, w, h, d, p) {
  const L = 38, R = 12, T = 8, B = 30, pw = w - L - R, ph = h - T - B, pts = d.points; const xmax = 0.6, X = (v) => L + pw * v / xmax, Y = (v) => T + ph - ph * v;
  c.strokeStyle = p.line; c.lineWidth = 1;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) { const y = Math.round(Y(t)) + 0.5; c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke(); label(c, p, (t * 100).toFixed(0) + '%', L - 5, y + 3.5, { align: 'right', mono: true, size: 10 }); }
  for (let g = 0; g <= xmax + 1e-6; g += 0.1) label(c, p, g.toFixed(1), X(g), T + ph + 14, { align: 'center', mono: true, size: 10 });
  label(c, p, 'peak ground acceleration, g', L + pw / 2, h - 2, { align: 'center' });
  for (const [key, colr] of [['shift', p.warn], ['comp', p.danger]]) {
    const done = pts.filter((q) => q.n > 0); if (!done.length) continue;
    c.beginPath(); done.forEach((q, i) => { const x = X(q.pga), y = Y(q[key] / q.n); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.strokeStyle = colr; c.lineWidth = 1.6; c.stroke();
    for (const q of done) { const [lo, hi] = wilson(q[key], q.n), x = X(q.pga); c.strokeStyle = colr; c.globalAlpha = 0.5; c.beginPath(); c.moveTo(x, Y(lo)); c.lineTo(x, Y(hi)); c.stroke(); c.globalAlpha = 1; c.beginPath(); c.arc(x, Y(q[key] / q.n), 3, 0, 6.3); c.fillStyle = colr; c.fill(); }
    const q = done[done.length - 1]; label(c, p, key === 'shift' ? 'pile shifts' : 'void compromised', Math.min(X(q.pga) + 6, w - 92), Y(q[key] / q.n) + (key === 'shift' ? -7 : 13), { color: colr });
  }
  if (d.mark != null) { const x = Math.round(X(d.mark)) + 0.5; c.strokeStyle = p.accent; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + ph); c.stroke(); c.setLineDash([]); }
}
// Wilson score interval for k successes in n trials (95 %)
export function wilson(k, n) { if (!n) return [0, 1]; const z = 1.96, ph = k / n, den = 1 + z * z / n, mid = (ph + z * z / (2 * n)) / den, half = z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / den; return [Math.max(0, mid - half), Math.min(1, mid + half)]; }
