// The 2-D tactical map. It is the minimap in the Mission workspace, and the main view when the 3-D twin cannot load.
// Everything is drawn from ctx.sim.state and ctx.world. It never reads ground truth: only what the sensors reported.
import { pointInPoly, pointInRect, rectCenter, mulberry32 } from '../../core/geometry.js';

export const MAP_LAYERS = [
  { id: 'hazards', label: 'Hazards', on: true },
  { id: 'coverage', label: 'Searched area', on: true },
  { id: 'heat', label: 'Chance a person is still there', on: false },
  { id: 'route', label: 'Rescue route', on: true },
  { id: 'trail', label: 'Trails and planned paths', on: true },
  { id: 'scan', label: 'Drone survey', on: true },
  { id: 'sensing', label: 'Sensor reach', on: true },
  { id: 'labels', label: 'Labels', on: true },
  { id: 'grid', label: 'Planner cost grid', on: false },
];

const hex = (c, a = 1) => {
  c = c.trim();
  if (c.startsWith('rgb')) return c;
  if (c.length === 4) c = '#' + [...c.slice(1)].map((x) => x + x).join('');
  const n = parseInt(c.slice(1), 16);
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
};

// A room's search status. The simulator does not revisit coverage after a second look, so a person confirmed later is
// folded in here: the room must not go on saying "lead open".
export function roomCover(S, id) {
  const cv = S.coverage[id]; if (!cv || cv.status !== 'lead') return cv;
  const d = S.detections.find((x) => x.room === id && x.status === 'confirmed');
  return d ? { ...cv, status: 'person', residual: d.p, note: 'A person was found here.' } : cv;
}

// Where a selection is on the site: { p: centre, r: radius to frame, rect? }.
export function selPoint(sel, S, world) {
  if (!sel) return null;
  if (sel.type === 'detection') { const d = S.detections.find((x) => x.id === sel.id); return d?.pos ? { p: d.pos, r: Math.max(9, (d.posSigma || 1) * 3) } : null; }
  if (sel.type === 'survivor') { const v = S.survivors[sel.id]; return v?.pos ? { p: v.pos, r: 9 } : null; }
  if (sel.type === 'unit') { const u = S.units[sel.id]; return u ? { p: u.pos, r: 7 } : null; }
  if (sel.type === 'room') { const r = world.roomById(sel.id); return r ? { p: rectCenter(r.rect), r: Math.max(r.rect[2] - r.rect[0], r.rect[3] - r.rect[1]) * 0.75, rect: r.rect } : null; }
  if (sel.type === 'hazard') { const hz = [...world.HAZARDS, ...S.hazards].find((x) => x.id === sel.id); if (!hz) return null; const xs = hz.poly.map((q) => q[0]), ys = hz.poly.map((q) => q[1]); const rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; return { p: rectCenter(rect), r: Math.max(12, Math.max(rect[2] - rect[0], rect[3] - rect[1]) * 0.7), rect: Math.max(rect[2] - rect[0], rect[3] - rect[1]) > 14 ? rect : undefined }; }
  if (sel.type === 'stop') { const s = world.STOPS.find((x) => x.id === sel.id); return s ? { p: s.pos, r: 7 } : null; }
  if (sel.type === 'event') {
    const e = S.events.find((x) => x.id === sel.id); if (!e) return null;
    if (e.pos) return { p: e.pos, r: 5 };
    if (e.det) return selPoint({ type: 'detection', id: e.det }, S, world);
    if (e.room) return selPoint({ type: 'room', id: e.room }, S, world);
    if (e.stop) return selPoint({ type: 'stop', id: e.stop }, S, world);
    if (e.unit) return selPoint({ type: 'unit', id: e.unit }, S, world);
  }
  return null;
}

export function createMap(canvas, ctx, { mini = false, interactive = true, onUserMove = null } = {}) {
  const { world, kit, bus, sim } = ctx;
  const { SITE, BUILDING, ROOMS, DOORS, WALLS, OBSTACLES, HAZARDS, STOPS, SENSORS } = world;
  const g = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, raf = 0, running = false, hover = null;
  const layers = Object.fromEntries(MAP_LAYERS.map((l) => [l.id, l.on]));
  if (mini) { layers.labels = false; layers.sensing = false; }
  let pad = { l: 16, r: 16, t: 16, b: 16 };
  // view: centre in metres and scale in pixels per metre. "goal" is where the view is easing to.
  const view = { cx: SITE.w / 2, cy: SITE.h / 2, k: 6 }, goal = { cx: SITE.w / 2, cy: SITE.h / 2, k: 6 };
  let mode = mini ? 'site' : 'building', first = true;
  let C = {};
  const patterns = new Map();
  const readColors = () => {
    const v = (n) => kit.cssVar(n) || '#888888';
    C = { bg0: v('--bg-0'), bg1: v('--bg-1'), bg2: v('--bg-2'), bg3: v('--bg-3'), bg4: v('--bg-4'), line: v('--line'), line2: v('--line-2'), text: v('--text'), text2: v('--text-2'), text3: v('--text-3'),
      accent: v('--accent'), person: v('--person'), warn: v('--warn'), ok: v('--ok'), danger: v('--danger'), font: v('--font') || 'system-ui', mono: v('--mono') || 'monospace' };
    patterns.clear();
  };
  function hatch(color, alpha, angle = 1, gap = 7) {
    const key = color + alpha + angle + gap;
    if (patterns.has(key)) return patterns.get(key);
    const c = document.createElement('canvas'); c.width = c.height = gap * dpr;
    const x = c.getContext('2d'); x.scale(dpr, dpr); x.strokeStyle = hex(color, alpha); x.lineWidth = 1.1; x.lineCap = 'square';
    x.beginPath();
    if (angle > 0) { x.moveTo(-1, gap + 1); x.lineTo(gap + 1, -1); x.moveTo(-1, 1); x.lineTo(1, -1); x.moveTo(gap - 1, gap + 1); x.lineTo(gap + 1, gap - 1); }
    else { x.moveTo(-1, -1); x.lineTo(gap + 1, gap + 1); x.moveTo(gap - 1, -1); x.lineTo(gap + 1, 1); x.moveTo(-1, gap - 1); x.lineTo(1, gap + 1); }
    x.stroke();
    const p = g.createPattern(c, 'repeat'); p.setTransform?.(new DOMMatrix().scale(1 / dpr)); patterns.set(key, p); return p;
  }

  // Rubble: small rocks scattered inside each rubble outline (fixed seed, so it never flickers).
  const rocks = [];
  { const rnd = mulberry32(77);
    for (const o of OBSTACLES) if (o.kind === 'rubble') {
      const xs = o.poly.map((p) => p[0]), ys = o.poly.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const n = Math.round((x1 - x0) * (y1 - y0) * (o.passable ? 0.7 : 2.2));
      for (let i = 0; i < n; i++) { const p = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)]; if (pointInPoly(p, o.poly)) rocks.push({ p, s: 0.12 + rnd() * 0.32, a: rnd() * Math.PI, n: 4 + Math.floor(rnd() * 3), q: rnd(), o }); }
    } }
  let costImg = null, costGrid = null;
  function updateCost() {
    const gr = sim.grid; if (gr === costGrid && costImg) return; costGrid = gr;
    costImg = document.createElement('canvas'); costImg.width = gr.w; costImg.height = gr.h;
    const x = costImg.getContext('2d'), img = x.createImageData(gr.w, gr.h), d = img.data;
    for (let j = 0; j < gr.h; j++) for (let i = 0; i < gr.w; i++) { const s = j * gr.w + i, k = ((gr.h - 1 - j) * gr.w + i) * 4; if (gr.blocked[s]) { d[k] = 255; d[k + 1] = 77; d[k + 2] = 94; d[k + 3] = 70; } else if (gr.cost[s] > 1) { d[k] = 255; d[k + 1] = 178; d[k + 2] = 36; d[k + 3] = Math.min(90, 12 * gr.cost[s]); } }
    x.putImageData(img, 0, 0);
  }

  const X = (x) => W / 2 + (x - view.cx) * view.k, Y = (y) => H / 2 - (y - view.cy) * view.k;
  const toWorld = (px, py) => [view.cx + (px - W / 2) / view.k, view.cy - (py - H / 2) / view.k];
  function fitRect(rect, { instant = false, maxK = 40, margin = 1.12 } = {}) {
    const w = (rect[2] - rect[0]) * margin, hgt = (rect[3] - rect[1]) * margin;
    const aw = Math.max(40, W - pad.l - pad.r), ah = Math.max(40, H - pad.t - pad.b);
    const k = Math.min(maxK, aw / w, ah / hgt);
    goal.k = k; goal.cx = (rect[0] + rect[2]) / 2 - (pad.l - pad.r) / 2 / k; goal.cy = (rect[1] + rect[3]) / 2 - (pad.b - pad.t) / 2 / k;
    if (instant) Object.assign(view, goal);
  }
  function applyMode(instant) {
    if (mode === 'site') fitRect([0, 0, SITE.w, SITE.h], { instant, margin: mini ? 1.02 : 1.06 });
    else if (mode === 'building') fitRect([BUILDING.rect[0] - 6, BUILDING.rect[1] - 7, BUILDING.rect[2] + 6, BUILDING.rect[3] + 6], { instant });
  }
  function poly(pts) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.closePath(); }
  function line(pts) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); }
  function label(text, x, y, { color = C.text, bg = 'rgba(9,12,16,0.78)', align = 'left', size = 11, weight = 500, border = null, mono = false } = {}) {
    g.font = weight + ' ' + size + 'px ' + (mono ? C.mono : C.font);
    const w = Math.ceil(g.measureText(text).width), hgt = size + 7, px = 6;
    const x0 = Math.round(align === 'center' ? x - w / 2 - px : align === 'right' ? x - w - px * 2 : x), y0 = Math.round(y - hgt / 2);
    g.beginPath(); g.roundRect(x0, y0, w + px * 2, hgt, 4); g.fillStyle = bg; g.fill();
    if (border) { g.strokeStyle = border; g.lineWidth = 1; g.stroke(); }
    g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(text, x0 + px, y0 + hgt / 2 + 0.5);
  }
  const MODE_WORD = { drive: 'driving', listen: 'listening', hold: 'holding', fault: 'link lost', swap: 'battery swap', takeoff: 'taking off', scan: 'surveying', return: 'returning' };

  function draw(now) {
    if (!W) return;
    const S = sim.state, t = now / 1000, still = kit.reducedMotion();
    const sel = ctx.selection, k = view.k;
    const sf = { clear: hex(C.ok, 0.07), lead: hex(C.warn, 0.11), person: hex(C.person, 0.14) };
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C.bg0; g.fillRect(0, 0, W, H);
    g.fillStyle = mini ? 'rgba(255,255,255,0.025)' : C.bg1; g.fillRect(X(0), Y(SITE.h), SITE.w * k, SITE.h * k);
    // drone survey: surveyed ground is lighter than ground nobody has looked at yet
    if (layers.scan) {
      g.save(); g.beginPath(); g.rect(X(0), Y(SITE.h), SITE.w * k, SITE.h * k); g.clip();
      g.fillStyle = 'rgba(190,215,245,0.045)';
      for (const sw of S.map.swaths) g.fillRect(X(sw.x0), Y(sw.y + sw.half), (sw.x1 - sw.x0) * k, sw.half * 2 * k);
      const dr = S.units['DRONE-01'];
      if (dr.mode === 'scan') {
        const horiz = Math.abs(Math.cos(dr.heading)) > 0.5;
        g.strokeStyle = 'rgba(205,228,255,0.85)'; g.lineWidth = mini ? 1 : 1.5; g.beginPath();
        if (horiz) { g.moveTo(X(dr.pos[0]), Y(dr.pos[1] - 11)); g.lineTo(X(dr.pos[0]), Y(dr.pos[1] + 11)); } else { g.moveTo(X(dr.pos[0] - 11), Y(dr.pos[1])); g.lineTo(X(dr.pos[0] + 11), Y(dr.pos[1])); }
        g.stroke();
        if (horiz && !mini) { const dir = Math.sign(Math.cos(dr.heading)), gr = g.createLinearGradient(X(dr.pos[0]), 0, X(dr.pos[0] - dir * 9), 0); gr.addColorStop(0, 'rgba(190,220,255,0.16)'); gr.addColorStop(1, 'rgba(190,220,255,0)'); g.fillStyle = gr; g.fillRect(Math.min(X(dr.pos[0]), X(dr.pos[0] - dir * 9)), Y(dr.pos[1] + 11), 9 * k, 22 * k); }
      }
      g.restore();
    }
    // grid: 10 m lines, 1 m dots when close, coordinates along the edges
    if (!mini) {
      g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.045)'; g.beginPath();
      for (let x = 0; x <= SITE.w; x += 10) { g.moveTo(Math.round(X(x)) + 0.5, Y(0)); g.lineTo(Math.round(X(x)) + 0.5, Y(SITE.h)); }
      for (let y = 0; y <= SITE.h; y += 10) { g.moveTo(X(0), Math.round(Y(y)) + 0.5); g.lineTo(X(SITE.w), Math.round(Y(y)) + 0.5); }
      g.stroke();
      if (k > 13) { g.fillStyle = 'rgba(255,255,255,0.09)'; const a = toWorld(0, H), b = toWorld(W, 0); for (let x = Math.max(0, Math.floor(a[0])); x <= Math.min(SITE.w, b[0]); x++) for (let y = Math.max(0, Math.floor(a[1])); y <= Math.min(SITE.h, b[1]); y++) g.fillRect(X(x) - 0.5, Y(y) - 0.5, 1, 1); }
    }
    g.strokeStyle = hex(C.line2, 0.9); g.lineWidth = 1; g.strokeRect(Math.round(X(0)) + 0.5, Math.round(Y(SITE.h)) + 0.5, SITE.w * k, SITE.h * k);
    if (layers.grid && !mini) { updateCost(); g.imageSmoothingEnabled = false; g.drawImage(costImg, X(0), Y(SITE.h), SITE.w * k, SITE.h * k); g.imageSmoothingEnabled = true; }

    // neighbouring buildings
    for (const o of OBSTACLES) if (o.kind === 'building') {
      poly(o.poly); g.fillStyle = hex(C.bg3, 0.9); g.fill(); g.fillStyle = hatch(C.text3, 0.16, -1, 9); g.fill(); g.strokeStyle = C.line2; g.lineWidth = mini ? 1 : 1.5; g.stroke();
      if (layers.labels) { const xs = o.poly.map((p) => p[0]), ys = o.poly.map((p) => p[1]); g.font = '500 11px ' + C.font; g.fillStyle = C.text3; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(o.name, X((Math.min(...xs) + Math.max(...xs)) / 2), Y((Math.min(...ys) + Math.max(...ys)) / 2)); }
    }
    // building B: floor and the state of each room
    const B = BUILDING.rect;
    g.fillStyle = C.bg2; g.fillRect(X(B[0]), Y(B[3]), (B[2] - B[0]) * k, (B[3] - B[1]) * k);
    for (const r of ROOMS) {
      const cv = roomCover(S, r.id), x = X(r.rect[0]), y = Y(r.rect[3]), w = (r.rect[2] - r.rect[0]) * k, hgt = (r.rect[3] - r.rect[1]) * k;
      if (r.corridor) { g.fillStyle = 'rgba(255,255,255,0.022)'; g.fillRect(x, y, w, hgt); continue; }
      if (!cv) continue;
      if (layers.heat) { g.fillStyle = cv.status === 'person' ? hex(C.person, 0.22) : hex(C.warn, Math.min(0.5, 0.04 + cv.residual * 1.6)); g.fillRect(x, y, w, hgt); }
      else if (layers.coverage) {
        if (sf[cv.status]) { g.fillStyle = sf[cv.status]; g.fillRect(x, y, w, hgt); }
        else if (cv.status === 'blocked') { g.fillStyle = hatch(C.text3, 0.28, 1, 8); g.fillRect(x, y, w, hgt); }
      }
    }
    if (layers.coverage) { const tr = S.units['HOUND-01'].trail; g.save(); g.beginPath(); g.rect(X(0), Y(SITE.h), SITE.w * k, SITE.h * k); g.clip(); line([...tr, S.units['HOUND-01'].pos]); g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = 10 * k; g.strokeStyle = 'rgba(120,175,235,0.085)'; g.stroke(); g.lineCap = 'butt'; g.restore(); }
    // rubble and furniture
    for (const o of OBSTACLES) {
      if (o.kind === 'rubble') { poly(o.poly); g.fillStyle = o.passable ? 'rgba(160,150,135,0.07)' : 'rgba(160,150,135,0.16)'; g.fill(); g.setLineDash(o.passable ? [3, 4] : []); g.strokeStyle = 'rgba(190,180,165,0.45)'; g.lineWidth = 1; g.stroke(); g.setLineDash([]); }
      else if (o.kind === 'furniture') { poly(o.poly); g.fillStyle = C.bg4; g.fill(); g.strokeStyle = hex(C.text3, 0.8); g.lineWidth = 1; g.stroke(); }
    }
    for (const r of rocks) {
      const s = r.s * k; if (s < 0.7) continue;
      g.beginPath();
      for (let i = 0; i < r.n; i++) { const a = r.a + (i / r.n) * Math.PI * 2, rr = s * (0.6 + 0.4 * (((i * 7 + r.n) % 5) / 4)); const px = X(r.p[0]) + Math.cos(a) * rr, py = Y(r.p[1]) + Math.sin(a) * rr; if (i) g.lineTo(px, py); else g.moveTo(px, py); }
      g.closePath(); g.fillStyle = 'rgba(' + ((150 + r.q * 50) | 0) + ',' + ((142 + r.q * 44) | 0) + ',' + ((130 + r.q * 36) | 0) + ',' + (r.o.passable ? 0.34 : 0.55) + ')'; g.fill();
    }
    // hazards
    if (layers.hazards) for (const hz of [...HAZARDS, ...S.hazards]) {
      const fresh = hz.t != null ? S.t - hz.t : 1e9, isSel = sel?.type === 'hazard' && sel.id === hz.id;
      poly(hz.poly); g.fillStyle = hex(C.danger, hz.block ? 0.1 : 0.045); g.fill(); g.fillStyle = hatch(C.danger, hz.block ? 0.5 : 0.26, hz.kind === 'mud' || hz.kind === 'gas' ? -1 : 1, hz.block ? 6 : 9); g.fill();
      g.setLineDash(hz.block ? [] : [5, 4]); g.strokeStyle = hex(C.danger, isSel ? 1 : hz.block ? 0.85 : 0.5); g.lineWidth = isSel ? 2 : 1; g.stroke(); g.setLineDash([]);
      if (fresh < 40 && !still) { const ph = (t * 0.9) % 1; poly(hz.poly); g.strokeStyle = hex(C.danger, 0.7 * (1 - ph)); g.lineWidth = 2 + ph * 10; g.stroke(); }
    }
    // walls: concrete is heavy, drywall is thin, damaged is dashed, collapsed is dotted
    g.lineCap = 'butt';
    for (const w of WALLS) {
      const concrete = w.mat === 'concrete';
      g.lineWidth = concrete ? Math.max(mini ? 1.2 : 2, 0.34 * k) : Math.max(1, 0.14 * k);
      g.strokeStyle = w.state === 'collapsed' ? hex(C.danger, 0.55) : w.state === 'damaged' ? hex(C.warn, 0.8) : concrete ? hex(C.text2, 0.95) : hex(C.text3, 0.95);
      g.setLineDash(w.state === 'collapsed' ? [2, 4] : w.state === 'damaged' ? [7, 3] : []);
      g.beginPath(); g.moveTo(X(w.a[0]), Y(w.a[1])); g.lineTo(X(w.b[0]), Y(w.b[1])); g.stroke();
    }
    g.setLineDash([]);
    if (!mini) for (const d of DOORS) {
      const x = X(d.pos[0]), y = Y(d.pos[1]), hw = (d.w / 2) * k;
      if (d.blocked) { g.strokeStyle = C.danger; g.lineWidth = 1.5; const s = Math.max(3, hw * 0.55); g.beginPath(); g.moveTo(x - s, y - s); g.lineTo(x + s, y + s); g.moveTo(x + s, y - s); g.lineTo(x - s, y + s); g.stroke(); }
      else if (k > 7) { g.fillStyle = hex(C.text2, 0.9); g.fillRect(x - hw - 1, y - 3, 2, 6); g.fillRect(x + hw - 1, y - 3, 2, 6); }
    }
    // room labels
    if (layers.labels && !mini) for (const r of ROOMS) {
      const c = rectCenter(r.rect);
      if (r.corridor) { if (k > 9 && r.id === 'C-EW') { g.font = '500 10px ' + C.font; g.fillStyle = hex(C.text3, 0.8); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(r.name, X(c[0] - 12), Y(c[1])); } continue; }
      const cv = roomCover(S, r.id), isSel = sel?.type === 'room' && sel.id === r.id, x = X(r.rect[0]), y = Y(r.rect[3]);
      g.font = '600 12px ' + C.font; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = isSel ? C.text : hex(C.text2, 0.95); g.fillText(r.id, x + 7, y + 7);
      if (k > 9.5 && cv) {
        const word = { unsearched: 'not searched', clear: 'clear', lead: 'lead open', person: 'person', blocked: 'not reached' }[cv.status];
        const col = { unsearched: C.text3, clear: C.ok, lead: C.warn, person: C.person, blocked: C.text3 }[cv.status];
        if (cv.status !== 'unsearched') { g.font = '500 10.5px ' + C.font; g.fillStyle = col; g.fillText(word, x + 7, y + 23); }
        if (cv.status === 'clear' || (layers.heat && cv.status !== 'person')) { g.font = '500 10.5px ' + C.mono; g.fillStyle = C.text3; g.fillText((cv.residual * 100).toFixed(0) + ' % risk', x + 7, y + 37); }
      }
    }
    if (sel?.type === 'room') { const r = world.roomById(sel.id); if (r) { g.strokeStyle = hex(C.accent, 0.9); g.lineWidth = 1.5; g.strokeRect(X(r.rect[0]) + 2.5, Y(r.rect[3]) + 2.5, (r.rect[2] - r.rect[0]) * k - 5, (r.rect[3] - r.rect[1]) * k - 5); } }
    // staging, drone pad, entrance
    const marker = (p, text, pad2) => { const x = X(p[0]), y = Y(p[1]); g.strokeStyle = hex(C.text3, 0.9); g.lineWidth = 1; g.beginPath(); if (pad2) g.arc(x, y, Math.max(4, 1.4 * k), 0, 7); else g.rect(x - Math.max(4, 1.6 * k), y - Math.max(3, 1.1 * k), Math.max(8, 3.2 * k), Math.max(6, 2.2 * k)); g.stroke(); if (layers.labels && !mini) { g.font = '500 10.5px ' + C.font; g.fillStyle = C.text3; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(text, x, y + Math.max(6, 1.6 * k) + 3); } };
    marker(SITE.staging, 'Staging', false); marker(SITE.dronePad, 'Drone pad', true);
    if (!mini && layers.labels && k > 5) { const x = X(SITE.entrance[0]), y = Y(SITE.entrance[1]); g.fillStyle = C.text3; g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x - 5, y - 1); g.lineTo(x + 5, y - 1); g.closePath(); g.fill(); g.font = '500 10.5px ' + C.font; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText('Entrance', x, y + 2); }

    // trails and planned paths
    if (layers.trail) for (const u of Object.values(S.units)) {
      if (u.trail.length > 1) { line([...u.trail, u.pos]); g.strokeStyle = u.kind === 'rover' ? hex(C.text, 0.42) : u.kind === 'team' ? hex(C.ok, 0.4) : hex(C.text3, 0.22); g.lineWidth = u.kind === 'drone' || mini ? 1 : 1.5; g.lineJoin = 'round'; g.stroke(); }
      if (u.path && u.kind !== 'drone' && !mini) { line(u.path); g.setLineDash([2, 5]); g.strokeStyle = hex(u.kind === 'team' ? C.ok : C.accent, 0.75); g.lineWidth = 1.5; g.stroke(); g.setLineDash([]); if (u.goal) { g.beginPath(); g.arc(X(u.goal[0]), Y(u.goal[1]), 3, 0, 7); g.fillStyle = hex(u.kind === 'team' ? C.ok : C.accent, 0.9); g.fill(); } }
    }
    // listening stops
    for (const s of STOPS) {
      const x = X(s.pos[0]), y = Y(s.pos[1]), done = s.covers.some((id) => S.coverage[id]?.stop === s.id), isSel = sel?.type === 'stop' && sel.id === s.id, r = mini ? 2.5 : 5;
      g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath();
      g.fillStyle = done ? hex(C.text2, 0.9) : C.bg0; g.fill(); g.strokeStyle = isSel ? C.accent : hex(C.text2, 0.9); g.lineWidth = isSel ? 2 : 1.2; g.stroke();
      if (!mini && layers.labels && k > 6) { g.font = '600 10px ' + C.mono; g.fillStyle = C.text2; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(s.id, x + 8, y - 8); }
      if (isSel) brackets(x, y, mini ? 7 : 13, t, still);
    }
    // sensor reach while the rover listens
    const rover = S.units['HOUND-01'], rx = X(rover.pos[0]), ry = Y(rover.pos[1]);
    if (layers.sensing && S.sensors.listen) {
      const R1 = SENSORS.csi.range * k;
      g.beginPath(); g.arc(rx, ry, R1, 0, 7); g.fillStyle = hex(C.accent, 0.05); g.fill(); g.strokeStyle = hex(C.accent, 0.5); g.lineWidth = 1; g.setLineDash([3, 4]); g.stroke(); g.setLineDash([]);
      if (!still) for (let i = 0; i < 3; i++) { const ph = (t * 0.55 + i / 3) % 1; g.beginPath(); g.arc(rx, ry, R1 * ph, 0, 7); g.strokeStyle = hex(C.accent, 0.4 * (1 - ph)); g.lineWidth = 1.2; g.stroke(); }
      const a0 = -rover.heading, fov = ((SENSORS.thermal.fovDeg / 2) * Math.PI) / 180;
      g.beginPath(); g.moveTo(rx, ry); g.arc(rx, ry, SENSORS.thermal.range * k, a0 - fov, a0 + fov); g.closePath(); g.fillStyle = hex(C.person, 0.045); g.fill(); g.strokeStyle = hex(C.person, 0.28); g.lineWidth = 1; g.stroke();
      if (layers.labels && k > 7) label('Wi-Fi reach ' + SENSORS.csi.range + ' m, through one wall', rx, ry - R1 - 12, { align: 'center', color: C.accent, size: 10.5 });
    }
    if (layers.sensing && S.sensors.radar?.t != null && S.t - S.sensors.radar.t < 45) for (const tg of S.sensors.radar.targets) { const x = X(tg.pos[0]), y = Y(tg.pos[1]); g.strokeStyle = hex(C.text, 0.8); g.lineWidth = 1; g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x - 4, y); g.moveTo(x + 4, y); g.lineTo(x + 9, y); g.moveTo(x, y - 9); g.lineTo(x, y - 4); g.moveTo(x, y + 4); g.lineTo(x, y + 9); g.stroke(); }

    // rescue route
    const route = S.routes.rescue;
    if (layers.route && route) {
      let n = 0;
      for (const leg of route.legs) {
        if (!leg.ok) continue; n++;
        const done = leg.arrivedAt != null, a = route.status === 'done' || done ? 0.35 : 1;
        g.lineJoin = 'round'; g.lineCap = 'round';
        line(leg.path); g.strokeStyle = 'rgba(4,8,14,0.85)'; g.lineWidth = mini ? 3.5 : 6; g.stroke();
        line(leg.path); g.strokeStyle = hex(C.accent, a); g.lineWidth = mini ? 1.6 : 3; if (route.status === 'planned') g.setLineDash([8, 6]); g.stroke(); g.setLineDash([]);
        if (route.status === 'approved' && !done && !still && !mini) { line(leg.path); g.setLineDash([2, 22]); g.lineDashOffset = -t * 30; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2; g.stroke(); g.setLineDash([]); g.lineDashOffset = 0; }
        g.lineCap = 'butt';
        const ax = X(leg.access[0]), ay = Y(leg.access[1]);
        const det = S.detections.find((d) => d.id === leg.det);
        if (!leg.reached && det?.pos) { g.setLineDash([2, 3]); g.strokeStyle = hex(C.warn, 0.95); g.lineWidth = 1.5; g.beginPath(); g.moveTo(ax, ay); g.lineTo(X(det.pos[0]), Y(det.pos[1])); g.stroke(); g.setLineDash([]); }
        if (!mini) {
          g.beginPath(); g.arc(ax, ay, 8, 0, 7); g.fillStyle = C.accent; g.fill(); g.strokeStyle = 'rgba(4,8,14,0.9)'; g.lineWidth = 1.5; g.stroke();
          g.font = '700 10px ' + C.font; g.fillStyle = '#06131f'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), ax, ay + 0.5);
          if (!leg.reached && layers.labels) label('Break through, ' + leg.gap.toFixed(1) + ' m', ax + 12, ay + 15, { color: C.warn, size: 10.5 });
        }
      }
    }

    // leads and people
    for (const d of S.detections) {
      if (!d.pos) continue;
      const x = X(d.pos[0]), y = Y(d.pos[1]), isSel = (sel?.type === 'detection' && sel.id === d.id) || (sel?.type === 'survivor' && sel.id === d.survivorId);
      const sv = d.survivorId && S.survivors[d.survivorId], reached = sv?.status === 'reached';
      if (d.status === 'rejected') {
        g.strokeStyle = hex(C.text3, 0.95); g.lineWidth = 1.5; const s = mini ? 2.5 : 4; g.beginPath(); g.moveTo(x - s, y - s); g.lineTo(x + s, y + s); g.moveTo(x + s, y - s); g.lineTo(x - s, y + s); g.stroke();
        if (!mini && layers.labels && k > 6) label(d.kind[0].toUpperCase() + d.kind.slice(1) + ' · closed', x + 9, y, { color: C.text3, size: 10.5 });
      } else {
        const col = d.status === 'confirmed' ? C.person : C.warn;
        if (d.posSigma && !mini) { g.beginPath(); g.arc(x, y, Math.max(6, d.posSigma * 2 * k), 0, 7); g.fillStyle = hex(col, 0.07); g.fill(); g.setLineDash([3, 3]); g.strokeStyle = hex(col, 0.55); g.lineWidth = 1; g.stroke(); g.setLineDash([]); }
        if (!still && !reached) { const ph = (t * (d.status === 'confirmed' ? 0.7 : 0.45)) % 1; g.beginPath(); g.arc(x, y, (mini ? 3 : 6) + ph * (mini ? 9 : 20), 0, 7); g.strokeStyle = hex(col, 0.75 * (1 - ph)); g.lineWidth = 1.5; g.stroke(); }
        g.beginPath(); g.arc(x, y, mini ? 3.2 : 6.5, 0, 7);
        if (d.status === 'confirmed') { g.fillStyle = col; g.fill(); g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = mini ? 1 : 1.5; g.stroke(); }
        else { g.fillStyle = C.bg0; g.fill(); g.strokeStyle = col; g.lineWidth = 2; g.stroke(); if (!mini) { g.font = '700 9px ' + C.font; g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', x, y + 0.5); } }
        if (reached) { g.beginPath(); g.arc(x, y, mini ? 5.5 : 10.5, 0, 7); g.strokeStyle = C.ok; g.lineWidth = 2; g.stroke(); }
        if (!mini && layers.labels) label(d.status === 'confirmed' ? (reached ? 'Person · reached' : 'Person · ' + (d.p * 100).toFixed(0) + ' %') : 'Possible · ' + (d.p * 100).toFixed(0) + ' %', x + 13, y - 13, { color: col, weight: 600, border: hex(col, 0.45) });
      }
      if (isSel) brackets(x, y, mini ? 8 : 16, t, still);
    }
    // units
    for (const u of Object.values(S.units)) {
      const x = X(u.pos[0]), y = Y(u.pos[1]), isSel = sel?.type === 'unit' && sel.id === u.id;
      g.save(); g.translate(x, y);
      if (u.kind === 'rover') {
        const s = mini ? 0.62 : Math.max(1, Math.min(2.4, k / 9));
        g.rotate(-u.heading);
        g.fillStyle = C.text3; for (const [wx, wy] of [[-5, -6.5], [5, -6.5], [-5, 6.5], [5, 6.5]]) { g.beginPath(); g.roundRect((wx - 3) * s, (wy - 1.6) * s, 6 * s, 3.2 * s, 1); g.fill(); }
        g.fillStyle = '#e8ecf1'; g.strokeStyle = 'rgba(4,8,14,0.9)'; g.lineWidth = 1.2; g.beginPath(); g.roundRect(-8 * s, -5 * s, 16 * s, 10 * s, 2.5 * s); g.fill(); g.stroke();
        g.fillStyle = 'rgba(4,8,14,0.9)'; g.beginPath(); g.moveTo(6 * s, 0); g.lineTo(1.5 * s, -3 * s); g.lineTo(1.5 * s, 3 * s); g.closePath(); g.fill();
      } else if (u.kind === 'drone') {
        const s = mini ? 0.6 : 1, lift = (u.alt / 30) * (mini ? 3 : 9);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(lift * 0.6, lift, 7 * s, 4 * s, 0, 0, 7); g.fill();
        g.rotate(-u.heading + Math.PI / 4); g.strokeStyle = '#dfe6ee'; g.lineWidth = 1.6 * s; g.beginPath(); g.moveTo(-8 * s, 0); g.lineTo(8 * s, 0); g.moveTo(0, -8 * s); g.lineTo(0, 8 * s); g.stroke();
        for (const [px, py] of [[-8, 0], [8, 0], [0, -8], [0, 8]]) { g.beginPath(); g.arc(px * s, py * s, 3.4 * s, 0, 7); g.strokeStyle = hex(C.text2, u.alt > 1 ? 0.55 : 1); g.lineWidth = 1; g.stroke(); }
        g.fillStyle = '#dfe6ee'; g.beginPath(); g.roundRect(-2.6 * s, -2.6 * s, 5.2 * s, 5.2 * s, 1); g.fill();
      } else {
        const s = mini ? 0.6 : 1; g.fillStyle = C.ok; g.strokeStyle = 'rgba(4,8,14,0.9)'; g.lineWidth = 1.2;
        for (const [px, py] of [[0, -4], [-4.2, 3], [4.2, 3]]) { g.beginPath(); g.arc(px * s, py * s, 3.3 * s, 0, 7); g.fill(); g.stroke(); }
      }
      g.restore();
      if (!mini && layers.labels) label(u.name + (MODE_WORD[u.mode] ? ' · ' + (u.kind === 'team' && u.mode === 'drive' ? 'walking' : MODE_WORD[u.mode]) : ''), x, y + 22, { align: 'center', size: 10.5, color: C.text2 });
      if (u.kind === 'rover' && S.sensors.listen && !mini) { const p = S.sensors.listen.progress; g.beginPath(); g.arc(x, y, 15, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); g.strokeStyle = C.accent; g.lineWidth = 2.5; g.stroke(); }
      if (isSel) brackets(x, y, mini ? 9 : 19, t, still);
    }
    if (sel?.type === 'event') { const q = selPoint(sel, S, world); if (q && !q.rect) brackets(X(q.p[0]), Y(q.p[1]), mini ? 8 : 14, t, still); }
    if (sel?.type === 'hazard' && layers.labels && !mini) { const q = selPoint(sel, S, world), hz = [...HAZARDS, ...S.hazards].find((z) => z.id === sel.id); if (q && hz) label(hz.name, X(q.p[0]), Y(q.rect[3]) - 12, { align: 'center', color: C.danger, border: hex(C.danger, 0.4) }); }

    if (!mini) hud();
    if (hover && !mini && hover.text) label(hover.text, hover.x + 14, hover.y + 18, { size: 11.5, bg: 'rgba(9,12,16,0.92)', border: C.line2 });
  }
  function brackets(x, y, r, t, still) {
    const rr = r + (still ? 0 : Math.sin(t * 3) * 1.2), c = r * 0.42; g.strokeStyle = C.accent; g.lineWidth = 1.6; g.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.moveTo(x + sx * rr, y + sy * (rr - c)); g.lineTo(x + sx * rr, y + sy * rr); g.lineTo(x + sx * (rr - c), y + sy * rr); }
    g.stroke();
  }
  function hud() { // scale bar and north arrow, top right of the free area
    const nice = [1, 2, 5, 10, 20, 50].find((m) => m * view.k >= 56) || 50, w = nice * view.k, x1 = pad.l + 34 + w, y = H - pad.b - 22;
    g.strokeStyle = hex(C.text2, 0.9); g.lineWidth = 1.2; g.beginPath(); g.moveTo(x1 - w, y - 4); g.lineTo(x1 - w, y); g.lineTo(x1, y); g.lineTo(x1, y - 4); g.stroke();
    g.font = '500 10.5px ' + C.mono; g.fillStyle = C.text2; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(nice + ' m', x1 - w / 2, y + 4);
    const nx = x1 - w - 22; g.beginPath(); g.moveTo(nx, y - 12); g.lineTo(nx - 5, y + 2); g.lineTo(nx, y - 1.5); g.lineTo(nx + 5, y + 2); g.closePath(); g.fillStyle = hex(C.text2, 0.9); g.fill(); g.font = '600 10px ' + C.font; g.fillText('N', nx, y + 4);
  }

  function hitTest(px, py) {
    const S = sim.state, [wx, wy] = toWorld(px, py), near = (p, r) => p && Math.hypot(X(p[0]) - px, Y(p[1]) - py) <= r;
    for (const d of [...S.detections].reverse()) if (near(d.pos, mini ? 9 : 13)) return { sel: { type: 'detection', id: d.id }, text: d.status === 'confirmed' ? 'Person, ' + (d.p * 100).toFixed(0) + ' % confidence' : d.status === 'possible' ? 'Possible person, ' + (d.p * 100).toFixed(0) + ' %' : 'Closed lead: ' + d.kind };
    for (const u of Object.values(S.units)) if (near(u.pos, mini ? 9 : 15)) return { sel: { type: 'unit', id: u.id }, text: u.name };
    for (const s of STOPS) if (near(s.pos, mini ? 6 : 10)) return { sel: { type: 'stop', id: s.id }, text: 'Listening stop ' + s.id + ': ' + s.label };
    if (wx < 0 || wy < 0 || wx > SITE.w || wy > SITE.h) return null;
    const room = ROOMS.find((r) => !r.corridor && pointInRect([wx, wy], r.rect));
    if (room) return { sel: { type: 'room', id: room.id }, text: room.name };
    if (layers.hazards) { const hz = [...S.hazards, ...HAZARDS].filter((z) => pointInPoly([wx, wy], z.poly)).sort((a, b) => (b.block ? 1 : 0) - (a.block ? 1 : 0))[0]; if (hz) return { sel: { type: 'hazard', id: hz.id }, text: hz.name }; }
    const ob = OBSTACLES.find((o) => pointInPoly([wx, wy], o.poly)); if (ob) return { sel: null, text: ob.name };
    return null;
  }

  // ---- interaction ----
  const offs = [];
  const listen = (el, type, fn, opt) => { el.addEventListener(type, fn, opt); offs.push(() => el.removeEventListener(type, fn, opt)); };
  if (interactive) {
    let drag = null;
    const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    listen(canvas, 'pointerdown', (e) => { const [x, y] = local(e); drag = { x, y, cx: view.cx, cy: view.cy, moved: false }; try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic event */ } });
    listen(canvas, 'pointermove', (e) => {
      const [x, y] = local(e);
      if (drag && !mini) { if (Math.hypot(x - drag.x, y - drag.y) > 4) drag.moved = true; if (drag.moved) { mode = 'free'; goal.cx = view.cx = drag.cx - (x - drag.x) / view.k; goal.cy = view.cy = drag.cy + (y - drag.y) / view.k; onUserMove?.(); canvas.style.cursor = 'grabbing'; } return; }
      const hit = hitTest(x, y); hover = hit ? { x, y, text: hit.text } : null; canvas.style.cursor = hit?.sel ? 'pointer' : mini ? 'default' : 'grab'; if (mini) canvas.title = hit ? hit.text : '';
    });
    listen(canvas, 'pointerup', (e) => { const [x, y] = local(e); if (drag && !drag.moved) { const hit = hitTest(x, y); ctx.select(hit?.sel || null); } drag = null; canvas.style.cursor = mini ? 'default' : 'grab'; });
    listen(canvas, 'pointerleave', () => { hover = null; });
    if (!mini) {
      listen(canvas, 'wheel', (e) => { e.preventDefault(); const [x, y] = local(e), before = toWorld(x, y); view.k = goal.k = Math.max(3, Math.min(60, view.k * Math.exp(-e.deltaY * 0.0016))); const after = toWorld(x, y); view.cx = goal.cx = view.cx + before[0] - after[0]; view.cy = goal.cy = view.cy + before[1] - after[1]; mode = 'free'; onUserMove?.(); }, { passive: false });
      canvas.tabIndex = 0; canvas.setAttribute('role', 'application'); canvas.setAttribute('aria-label', 'Tactical map of the site. Arrow keys pan, plus and minus zoom. Use the timeline and the lists to select items.');
      listen(canvas, 'keydown', (e) => { const step = 40 / view.k; let used = true; if (e.key === 'ArrowLeft') goal.cx -= step; else if (e.key === 'ArrowRight') goal.cx += step; else if (e.key === 'ArrowUp') goal.cy += step; else if (e.key === 'ArrowDown') goal.cy -= step; else if (e.key === '+' || e.key === '=') goal.k = Math.min(60, goal.k * 1.25); else if (e.key === '-') goal.k = Math.max(3, goal.k / 1.25); else used = false; if (used) { e.preventDefault(); mode = 'free'; onUserMove?.(); } });
    }
  }
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (mode === 'follow') { const u = sim.state.units['HOUND-01']; goal.cx = u.pos[0] - (pad.l - pad.r) / 2 / goal.k; goal.cy = u.pos[1] - (pad.b - pad.t) / 2 / goal.k; }
    const e = kit.reducedMotion() ? 1 : 0.12;
    view.cx += (goal.cx - view.cx) * e; view.cy += (goal.cy - view.cy) * e; view.k += (goal.k - view.k) * e;
    draw(now);
  }
  function resize() {
    const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return;
    dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); patterns.clear();
    if (mode !== 'free' && mode !== 'follow') applyMode(first); first = false;
    if (!running) draw(performance.now());
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas);
  readColors(); offs.push(bus.on('prefs', () => setTimeout(readColors, 0)));

  return {
    canvas,
    start() { if (running) return; running = true; resize(); raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    resize, redraw: () => draw(performance.now()),
    layers: () => MAP_LAYERS.map((l) => ({ ...l, on: layers[l.id] })),
    setLayer(id, on) { if (id in layers) layers[id] = !!on; },
    setPad(p) { pad = { ...pad, ...p }; if (mode !== 'free' && mode !== 'follow') applyMode(false); },
    get mode() { return mode; },
    setView(m) { mode = m; if (m === 'follow') goal.k = Math.max(goal.k, 15); else applyMode(false); },
    zoom(f) { goal.k = Math.max(3, Math.min(60, goal.k * f)); mode = 'free'; },
    focus(sel, { zoom = true } = {}) {
      const q = selPoint(sel, sim.state, world); if (!q) return false;
      mode = 'free';
      if (zoom) fitRect([q.p[0] - q.r * 1.6, q.p[1] - q.r * 1.3, q.p[0] + q.r * 1.6, q.p[1] + q.r * 1.3], { maxK: 30 });
      else { goal.cx = q.p[0] - (pad.l - pad.r) / 2 / goal.k; goal.cy = q.p[1] - (pad.b - pad.t) / 2 / goal.k; }
      return true;
    },
    fitRect,
    dispose() { this.stop(); ro.disconnect(); offs.forEach((f) => f()); },
  };
}
