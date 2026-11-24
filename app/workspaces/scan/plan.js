// Floor-plan mode: draw walls on a 0.5 m grid, drop rubble piles, and the result becomes a building the scanner can fly.
// A plan is { size: [w, h] in metres, wallHeight, walls: [{ a: [x, y], b: [x, y], mat }], rubble: [{ pos, r, h }] }.
export const EXAMPLE_PLAN = {
  size: [24, 16], wallHeight: 3,
  walls: [
    { a: [2, 2], b: [11, 2], mat: 'concrete' }, { a: [13, 2], b: [22, 2], mat: 'concrete' }, { a: [22, 2], b: [22, 14], mat: 'concrete' }, { a: [22, 14], b: [15, 14], mat: 'concrete' },
    { a: [2, 14], b: [2, 2], mat: 'concrete' }, { a: [2, 14], b: [9, 14], mat: 'concrete' },
    { a: [2, 8], b: [8, 8], mat: 'drywall' }, { a: [10, 8], b: [14, 8], mat: 'drywall' }, { a: [16, 8], b: [22, 8], mat: 'drywall' }, { a: [12, 8], b: [12, 14], mat: 'drywall' }, { a: [15, 2], b: [15, 6], mat: 'drywall' },
  ],
  rubble: [{ pos: [12, 13.5], r: 2.6, h: 1.5 }, { pos: [18.5, 5], r: 1.4, h: 0.9 }],
};
const clone = (p) => JSON.parse(JSON.stringify(p));

export function createPlanEditor(host, kit, onChange = () => {}) {
  const canvas = kit.h('canvas.scan-plan-canvas', { tabIndex: 0, 'aria-label': 'Floor plan drawing area. Drag to draw a wall. The wall list beside it can also be edited with the keyboard.' });
  host.append(canvas);
  let plan = clone(EXAMPLE_PLAN), tool = 'wall', mat = 'concrete', drag = null, hover = null, W = 0, H = 0, sc = 1, ox = 0, oy = 0;
  const undo = [];
  const snap = (v) => Math.round(v * 2) / 2;
  const toWorld = (px, py) => [(px - ox) / sc, (oy - py) / sc];
  const toPx = (p) => [ox + p[0] * sc, oy - p[1] * sc];
  const inside = (p) => [Math.min(plan.size[0], Math.max(0, p[0])), Math.min(plan.size[1], Math.max(0, p[1]))];
  const commit = () => { onChange(plan); draw(); };
  const push = () => { undo.push(clone(plan)); if (undo.length > 60) undo.shift(); };
  function distSeg(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
  function nearest(p) { let best = null, bd = 0.6; plan.walls.forEach((w, i) => { const d = distSeg(p, w.a, w.b); if (d < bd) { bd = d; best = { type: 'wall', i }; } }); plan.rubble.forEach((r, i) => { const d = Math.hypot(p[0] - r.pos[0], p[1] - r.pos[1]) - r.r; if (d < 0.2 && (!best || d < bd)) { bd = d; best = { type: 'rubble', i }; } }); return best; }

  function draw(c = canvas.getContext('2d')) {
    const v = kit.cssVar, cs = { bg: v('--bg-0'), line: v('--line'), line2: v('--line-2'), text: v('--text'), text2: v('--text-2'), text3: v('--text-3'), accent: v('--accent'), warn: v('--warn'), danger: v('--danger') };
    c.clearRect(0, 0, W, H);
    sc = Math.min((W - 120) / plan.size[0], (H - 150) / plan.size[1]); ox = (W - plan.size[0] * sc) / 2; oy = (H + plan.size[1] * sc) / 2 - 8;
    const [x0, y1] = toPx([0, 0]), [x1, y0] = toPx(plan.size);
    c.fillStyle = v('--bg-1'); c.fillRect(x0, y0, x1 - x0, y1 - y0);
    for (let s = 0; s <= plan.size[0] * 2; s++) { const x = x0 + (s / 2) * sc; c.strokeStyle = s % 10 === 0 ? cs.line2 : cs.line; c.globalAlpha = s % 2 ? 0.35 : s % 10 === 0 ? 1 : 0.8; c.beginPath(); c.moveTo(x + 0.5, y0); c.lineTo(x + 0.5, y1); c.stroke(); }
    for (let s = 0; s <= plan.size[1] * 2; s++) { const y = y1 - (s / 2) * sc; c.strokeStyle = s % 10 === 0 ? cs.line2 : cs.line; c.globalAlpha = s % 2 ? 0.35 : s % 10 === 0 ? 1 : 0.8; c.beginPath(); c.moveTo(x0, y + 0.5); c.lineTo(x1, y + 0.5); c.stroke(); }
    c.globalAlpha = 1; c.strokeStyle = cs.line2; c.lineWidth = 1; c.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    c.fillStyle = cs.text3; c.font = '11px ' + v('--mono'); c.textAlign = 'center';
    for (let m = 0; m <= plan.size[0]; m += 5) c.fillText(m + ' m', x0 + m * sc, y1 + 16);
    c.textAlign = 'right'; for (let m = 5; m <= plan.size[1]; m += 5) c.fillText(m + ' m', x0 - 8, y1 - m * sc + 4);
    for (const [i, r] of plan.rubble.entries()) { const p = toPx(r.pos), hot = hover && hover.type === 'rubble' && hover.i === i && tool === 'erase'; c.beginPath(); c.arc(p[0], p[1], r.r * sc, 0, 6.283); c.fillStyle = hot ? cs.danger : cs.warn; c.globalAlpha = 0.16; c.fill(); c.globalAlpha = 0.9; c.setLineDash([4, 4]); c.strokeStyle = hot ? cs.danger : cs.warn; c.stroke(); c.setLineDash([]); c.globalAlpha = 1; c.fillStyle = cs.warn; c.textAlign = 'center'; c.font = '11px ' + v('--font'); c.fillText('rubble ' + r.h.toFixed(1) + ' m', p[0], p[1] + 4); }
    c.lineCap = 'round';
    for (const [i, w] of plan.walls.entries()) { const a = toPx(w.a), b = toPx(w.b), hot = hover && hover.type === 'wall' && hover.i === i && tool === 'erase'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.strokeStyle = hot ? cs.danger : w.mat === 'concrete' ? cs.text : cs.text2; c.lineWidth = Math.max(2.5, (w.mat === 'concrete' ? 0.24 : 0.12) * sc); c.stroke(); }
    if (drag && tool === 'wall') { const a = toPx(drag.a), b = toPx(drag.b), len = Math.hypot(drag.b[0] - drag.a[0], drag.b[1] - drag.a[1]); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.strokeStyle = cs.accent; c.lineWidth = 3; c.stroke(); if (len > 0) { c.fillStyle = cs.accent; c.font = '600 12px ' + v('--mono'); c.textAlign = 'center'; c.fillText(len.toFixed(1) + ' m', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 10); } }
    if (hover && hover.p && tool !== 'erase') { const p = toPx(hover.p); c.beginPath(); c.arc(p[0], p[1], 4, 0, 6.283); c.strokeStyle = cs.accent; c.lineWidth = 1.5; c.stroke(); c.fillStyle = cs.text3; c.font = '11px ' + v('--mono'); c.textAlign = 'left'; c.fillText(hover.p[0].toFixed(1) + ', ' + hover.p[1].toFixed(1), p[0] + 10, p[1] - 8); }
    c.lineWidth = 1;
  }
  const stop = kit.fitCanvas(canvas, (c, w, h) => { W = w; H = h; draw(c); });
  const ev = (e) => { const r = canvas.getBoundingClientRect(); return toWorld(e.clientX - r.left, e.clientY - r.top); };
  canvas.addEventListener('pointerdown', (e) => {
    const p = ev(e), s = inside([snap(p[0]), snap(p[1])]);
    if (tool === 'wall') { drag = { a: s, b: s }; canvas.setPointerCapture(e.pointerId); }
    else if (tool === 'rubble') { if (p[0] < 0 || p[1] < 0 || p[0] > plan.size[0] || p[1] > plan.size[1]) return; push(); plan.rubble.push({ pos: s, r: 1.8, h: 1.2 }); commit(); }
    else { const n = nearest(p); if (n) { push(); (n.type === 'wall' ? plan.walls : plan.rubble).splice(n.i, 1); hover = null; commit(); } }
    draw();
  });
  canvas.addEventListener('pointermove', (e) => { const p = ev(e), s = inside([snap(p[0]), snap(p[1])]); if (drag) drag.b = s; hover = tool === 'erase' ? nearest(p) : { p: s }; draw(); });
  canvas.addEventListener('pointerup', () => { if (!drag) return; const d = drag; drag = null; if (Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) >= 0.5) { push(); plan.walls.push({ a: d.a, b: d.b, mat }); commit(); } else draw(); });
  canvas.addEventListener('pointerleave', () => { hover = null; draw(); });
  return {
    el: canvas, get plan() { return plan; },
    set(p) { push(); plan = clone(p); commit(); }, setTool(t) { tool = t; canvas.style.cursor = t === 'erase' ? 'pointer' : 'crosshair'; draw(); }, setMat(m) { mat = m; },
    addWall(a, b, m) { push(); plan.walls.push({ a: inside(a), b: inside(b), mat: m || mat }); commit(); }, removeWall(i) { push(); plan.walls.splice(i, 1); commit(); },
    setSize(w, h) { push(); plan.size = [w, h]; plan.walls = plan.walls.map((x) => ({ ...x, a: inside(x.a), b: inside(x.b) })).filter((x) => Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]) >= 0.5); plan.rubble = plan.rubble.filter((r) => r.pos[0] <= w && r.pos[1] <= h); commit(); },
    undo() { if (!undo.length) return false; plan = undo.pop(); commit(); return true; }, clear() { push(); plan.walls = []; plan.rubble = []; commit(); },
    redraw: () => draw(), destroy() { stop(); canvas.remove(); },
  };
}
