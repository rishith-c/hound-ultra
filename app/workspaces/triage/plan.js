// A drafted 2-D plan of the site, on a canvas. Shared by Triage and Training.
// createPlan(canvas, { scene, onPick }) -> { draw(), setView(rect), fit(name), destroy() }
// scene() returns what to draw right now (see drawScene). World points are [x east, y north] in metres.
import world from '../../core/world.js';
import { dist, mulberry32 } from '../../core/geometry.js';
import { cssVar } from '../../ui/kit.js';

const { SITE, BUILDING, ROOMS, WALLS, DOORS, OBSTACLES, HAZARDS } = world;
export const VIEWS = { building: [39, 22, 104, 78], site: [0, 0, SITE.w, SITE.h], block: [41, 26, 88, 62] };

function tokens() {
  const g = (n) => cssVar(n);
  return { bg0: g('--bg-0'), bg1: g('--bg-1'), bg2: g('--bg-2'), bg3: g('--bg-3'), bg4: g('--bg-4'), line: g('--line'), line2: g('--line-2'), text: g('--text'), text2: g('--text-2'), text3: g('--text-3'),
    accent: g('--accent'), person: g('--person'), warn: g('--warn'), ok: g('--ok'), danger: g('--danger'), sim: g('--sim'), font: g('--font'), mono: g('--mono') };
}
const alpha = (hex, a) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return hex; const n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };

function hatch(c, color, gap = 7, width = 1) {
  const p = document.createElement('canvas'); p.width = p.height = gap * 2;
  const x = p.getContext('2d'); x.strokeStyle = color; x.lineWidth = width;
  for (let i = -2; i <= 2; i++) { x.beginPath(); x.moveTo(i * gap, gap * 2); x.lineTo(i * gap + gap * 2, 0); x.stroke(); }
  return c.createPattern(p, 'repeat');
}

export function createPlan(canvas, { scene, onPick, view = 'building', interactive = true } = {}) {
  let W = 0, H = 0, dpr = 1, rect = (VIEWS[view] || view).slice(), T = tokens(), pats = null, hits = [], hover = null, raf = 0, phase = 0, running = false;
  const c = canvas.getContext('2d');
  // world -> screen, keeping the aspect ratio and centring the view rectangle
  let k = 1, ox = 0, oy = 0;
  function layout() {
    const vw = rect[2] - rect[0], vh = rect[3] - rect[1];
    k = Math.min(W / vw, H / vh); ox = (W - vw * k) / 2 - rect[0] * k; oy = (H + vh * k) / 2 + rect[1] * k;
  }
  const sx = (x) => ox + x * k, sy = (y) => oy - y * k, P = (p) => [sx(p[0]), sy(p[1])];
  const toWorld = (px, py) => [(px - ox) / k, (oy - py) / k];
  const poly = (pts) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(sx(p[0]), sy(p[1])) : c.moveTo(sx(p[0]), sy(p[1])))); c.closePath(); };
  const line = (pts) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(sx(p[0]), sy(p[1])) : c.moveTo(sx(p[0]), sy(p[1])))); };
  function text(s, x, y, { size = 11, color = T.text2, align = 'left', base = 'alphabetic', weight = 500, mono = false, halo = true } = {}) {
    c.font = weight + ' ' + size + 'px ' + (mono ? T.mono : T.font); c.textAlign = align; c.textBaseline = base;
    const tw = c.measureText(s).width, l = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;      // never run off the sheet
    if (l + tw > W - 5 && l < W) x -= l + tw - W + 5; else if (l < 5 && l + tw > 0) x += 5 - l;
    if (halo) { c.lineWidth = 3; c.strokeStyle = alpha(T.bg0, 0.85); c.lineJoin = 'round'; c.strokeText(s, x, y); }
    c.fillStyle = color; c.fillText(s, x, y);
  }

  function drawBase(sc) {
    c.fillStyle = T.bg0; c.fillRect(0, 0, W, H);
    // survey grid: faint 2 m ticks when zoomed in, 10 m lines always, with coordinates on the edges
    const [wx0, wy1] = toWorld(0, 0), [wx1, wy0] = toWorld(W, H);
    if (k > 9) { c.fillStyle = alpha(T.line2, 0.55); for (let x = Math.ceil(wx0 / 2) * 2; x < wx1; x += 2) for (let y = Math.ceil(wy0 / 2) * 2; y < wy1; y += 2) c.fillRect(sx(x) - 0.5, sy(y) - 0.5, 1, 1); }
    c.strokeStyle = alpha(T.line, 0.9); c.lineWidth = 1; c.beginPath();
    for (let x = Math.ceil(wx0 / 10) * 10; x < wx1; x += 10) { c.moveTo(Math.round(sx(x)) + 0.5, 0); c.lineTo(Math.round(sx(x)) + 0.5, H); }
    for (let y = Math.ceil(wy0 / 10) * 10; y < wy1; y += 10) { c.moveTo(0, Math.round(sy(y)) + 0.5); c.lineTo(W, Math.round(sy(y)) + 0.5); }
    c.stroke();
    for (let x = Math.ceil(wx0 / 10) * 10; x < wx1; x += 10) text(x + ' m', sx(x) + 4, H - 6, { size: 10, color: T.text3, mono: true, halo: false });
    for (let y = Math.ceil(wy0 / 10) * 10; y < wy1; y += 10) if (sy(y) < H - 24 && sy(y) > 14) text(String(y), 5, sy(y) - 4, { size: 10, color: T.text3, mono: true, halo: false });

    // the strips the drone has mapped so far
    for (const sw of sc.swaths || []) { c.fillStyle = alpha(T.accent, 0.05); c.fillRect(sx(sw.x0), sy(sw.y + sw.half), (sw.x1 - sw.x0) * k, sw.half * 2 * k); c.strokeStyle = alpha(T.accent, 0.25); c.lineWidth = 1; c.beginPath(); c.moveTo(sx(sw.x0), sy(sw.y)); c.lineTo(sx(sw.x1), sy(sw.y)); c.stroke(); }
    // neighbouring buildings and the debris field
    for (const o of OBSTACLES) {
      if (o.kind === 'building') { poly(o.poly); c.fillStyle = alpha(T.bg3, 0.8); c.fill(); c.strokeStyle = T.line2; c.lineWidth = 1; c.stroke(); const cx = o.poly.reduce((s, p) => s + p[0], 0) / o.poly.length, cy = o.poly.reduce((s, p) => s + p[1], 0) / o.poly.length; text(o.name, sx(cx), sy(cy), { align: 'center', color: T.text3, size: 11, halo: false }); }
    }
    // building B: floor, room tints, room numbers
    const b = BUILDING.rect; c.fillStyle = T.bg1; c.fillRect(sx(b[0]), sy(b[3]), (b[2] - b[0]) * k, (b[3] - b[1]) * k);
    for (const r of ROOMS) {
      const cov = sc.coverage?.[r.id]; const x = sx(r.rect[0]), y = sy(r.rect[3]), w = (r.rect[2] - r.rect[0]) * k, hgt = (r.rect[3] - r.rect[1]) * k;
      if (cov) {
        const tint = cov.status === 'clear' ? alpha(T.ok, 0.07) : cov.status === 'person' ? alpha(T.person, 0.1) : cov.status === 'lead' ? alpha(T.warn, 0.09) : cov.status === 'blocked' ? null : null;
        if (tint) { c.fillStyle = tint; c.fillRect(x, y, w, hgt); }
        if (cov.status === 'blocked' || cov.status === 'unsearched') { c.fillStyle = pats.dim; c.fillRect(x, y, w, hgt); }
      }
      if (sc.roomMarks?.[r.id]) { c.fillStyle = alpha(T.accent, 0.12); c.fillRect(x, y, w, hgt); c.strokeStyle = T.accent; c.lineWidth = 1.5; c.strokeRect(x + 3, y + 3, w - 6, hgt - 6); }
      if (!r.corridor && k > 5) {
        text(r.id, x + 7, y + 8, { size: Math.min(15, Math.max(11, k * 1.1)), color: T.text3, base: 'top', weight: 600, mono: true, halo: false });
        if (cov && sc.showResidual && k > 7) { const lab = cov.status === 'blocked' ? 'not searched' : cov.status === 'unsearched' ? 'not searched yet' : cov.status === 'clear' ? 'missed-person risk ' + (cov.residual * 100).toFixed(0) + ' %' + (cov.noCsi ? ', no Wi-Fi' : '') : ''; if (lab) { c.font = '500 10px ' + T.font; const fits = (s2) => c.measureText(s2).width < w - 12; const use = fits(lab) ? lab : cov.status === 'clear' ? 'risk ' + (cov.residual * 100).toFixed(0) + ' %' : fits('not searched') ? 'not searched' : ''; if (use && fits(use)) text(use, x + 7, y + hgt - 7, { size: 10, color: cov.status === 'clear' ? T.ok : T.text3, halo: false }); } }
      }
    }
    // rubble and furniture
    for (const o of OBSTACLES) {
      if (o.kind === 'building') continue;
      poly(o.poly); c.fillStyle = o.kind === 'furniture' ? alpha(T.bg4, 0.9) : alpha(T.bg4, o.passable ? 0.35 : 0.8); c.fill();
      if (o.kind === 'rubble') {
        c.save(); c.clip(); const rnd = mulberry32(o.id.length * 977 + o.poly.length);
        const xs = o.poly.map((p) => p[0]), ys = o.poly.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const n = Math.round((x1 - x0) * (y1 - y0) * (o.passable ? 1.1 : 2.4)); c.strokeStyle = alpha(T.text3, o.passable ? 0.5 : 0.8); c.lineWidth = 1;
        for (let i = 0; i < n; i++) { const px = sx(x0 + rnd() * (x1 - x0)), py = sy(y0 + rnd() * (y1 - y0)), s = (0.18 + rnd() * 0.34) * k, a = rnd() * Math.PI; c.beginPath(); for (let j = 0; j < 4; j++) { const q = a + (j / 4) * Math.PI * 2 + rnd() * 0.5, rr = s * (0.6 + rnd() * 0.5); j ? c.lineTo(px + Math.cos(q) * rr, py + Math.sin(q) * rr) : c.moveTo(px + Math.cos(q) * rr, py + Math.sin(q) * rr); } c.closePath(); c.stroke(); }
        c.restore();
      }
      poly(o.poly); c.strokeStyle = alpha(T.text3, 0.7); c.lineWidth = 1; c.setLineDash(o.passable ? [3, 3] : []); c.stroke(); c.setLineDash([]);
    }
    // hazards: hatched, outlined, named
    for (const hz of [...HAZARDS, ...(sc.hazards || [])]) {
      const off = sc.avoid && sc.avoid[hz.kind] === false;
      poly(hz.poly); c.fillStyle = hz.block ? pats.dangerDense : pats.danger; c.globalAlpha = off ? 0.35 : 1; c.fill(); c.globalAlpha = 1;
      c.strokeStyle = alpha(T.danger, hz.block ? 0.95 : 0.6); c.lineWidth = hz.block ? 1.5 : 1; c.setLineDash(hz.block ? [] : [6, 4]); c.stroke(); c.setLineDash([]);
    }
    // walls. Concrete is drawn heavy, drywall light, damaged walls broken, collapsed walls as fragments.
    c.lineCap = 'butt';
    for (const w of WALLS) {
      const hi = sc.wall === w.id;
      c.beginPath(); c.moveTo(sx(w.a[0]), sy(w.a[1])); c.lineTo(sx(w.b[0]), sy(w.b[1]));
      c.lineWidth = Math.max(w.mat === 'concrete' ? 2.6 : 1.4, (w.mat === 'concrete' ? 0.3 : 0.14) * k);
      c.strokeStyle = hi ? T.accent : w.state === 'damaged' ? T.warn : w.mat === 'concrete' ? T.text2 : alpha(T.text2, 0.62);
      c.setLineDash(w.state === 'collapsed' ? [2, 6] : w.state === 'damaged' ? [7, 3, 2, 3] : []);
      if (w.state === 'collapsed') c.strokeStyle = alpha(T.text3, 0.8);
      c.stroke(); c.setLineDash([]);
    }
    // doors: a leaf and its swing, the way a floor plan draws them. A blocked door carries a cross.
    for (const d of DOORS) {
      if (d.id === 'entrance') { text('Entrance', sx(d.pos[0]), sy(d.pos[1]) + 14, { align: 'center', size: 10, color: T.text3 }); continue; }
      const up = d.pos[1] === 42 ? -1 : 1, hw = d.w / 2, hx = sx(d.pos[0] - hw), hy = sy(d.pos[1]);
      c.strokeStyle = alpha(T.text3, 0.9); c.lineWidth = 1;
      c.beginPath(); c.moveTo(hx, hy); c.lineTo(hx, hy - up * d.w * k); c.stroke();
      c.beginPath(); c.setLineDash([2, 3]); c.arc(hx, hy, d.w * k, up > 0 ? -Math.PI / 2 : 0, up > 0 ? 0 : Math.PI / 2); c.stroke(); c.setLineDash([]);
      if (d.blocked) { const m = sx(d.pos[0]), s = 4; c.strokeStyle = T.danger; c.lineWidth = 1.5; c.beginPath(); c.moveTo(m - s, hy - s); c.lineTo(m + s, hy + s); c.moveTo(m + s, hy - s); c.lineTo(m - s, hy + s); c.stroke(); }
    }
    // hazard names go on top of the walls so they stay readable
    if (sc.hazardLabels !== false) {
      const placed = [];
      for (const m of sc.markers || []) { const [mx, my] = P(m.pos); placed.push([mx - 16, my - 24, mx + 28 + (m.label ? m.label.length * 6.2 : 0), my + 14]); }
      for (const r of ROOMS) if (!r.corridor) { const x = sx(r.rect[0]), y = sy(r.rect[3]); placed.push([x + 6, y + 7, x + 30, y + 22]); }
      if (sc.breach) { const st = P(sc.breach.stand); placed.push([st[0] - 60, st[1] - 24, st[0] + 60, st[1] + 24]); }
      for (const hz of [...(sc.hazards || []), ...HAZARDS].sort((a, b) => (b.block ? 1 : 0) - (a.block ? 1 : 0))) {
        const ys = hz.poly.map((p) => p[1]), xs = hz.poly.map((p) => p[0]); const x0 = sx(Math.min(...xs)), x1 = sx(Math.max(...xs)), y0 = sy(Math.max(...ys)), y1 = sy(Math.min(...ys));
        const short = hz.name.replace(' (concept sensor)', '').replace('Second slide: ', '').replace(/ by lab 110$/, '');
        c.font = '500 10.5px ' + T.font; const tw = c.measureText(short).width;
        const tries = [[x1 - 6, y1 - 7, 'right'], [x1 - 6, y0 + 14, 'right'], [x0 + 6, y1 - 7, 'left'], [x0 + 6, y0 + 14, 'left'], [x1 - 6, y0 - 6, 'right'], [x0 + 6, y0 - 6, 'left'], [x0 + 6, y1 + 14, 'left'], [x1 - 6, y1 + 14, 'right'], [x1 - 6, (y0 + y1) / 2, 'right'], [x1 + 8, y0 + 14, 'left']];
        for (const [lx, ly, al] of tries) {
          const box = [al === 'right' ? lx - tw : lx, ly - 11, al === 'right' ? lx : lx + tw, ly + 3];
          if (box[0] < 30 || box[2] > W - 44 || box[1] < 40 || box[3] > H - 44) continue;
          if (placed.some((q) => box[0] < q[2] + 4 && box[2] > q[0] - 4 && box[1] < q[3] + 2 && box[3] > q[1] - 2)) continue;
          placed.push(box); text(short, lx, ly, { align: al, size: 10.5, color: T.danger }); break;
        }
      }
    }
  }

  function drawRoutes(sc) {
    for (const r of sc.routes || []) {
      if (!r.path || r.path.length < 2) continue;
      const col = r.tone === 'dim' ? alpha(T.accent, 0.38) : r.tone === 'warn' ? T.warn : r.tone === 'danger' ? T.danger : r.tone === 'ghost' ? alpha(T.text2, 0.5) : T.accent;
      c.lineJoin = 'round'; c.lineCap = 'round';
      if (r.tone !== 'dim' && r.tone !== 'ghost') { line(r.path); c.strokeStyle = alpha(T.bg0, 0.9); c.lineWidth = (r.width || 2.5) + 3; c.stroke(); }
      line(r.path); c.strokeStyle = col; c.lineWidth = r.width || 2.5;
      if (r.dash) { c.setLineDash(r.dash); c.lineDashOffset = r.march ? -phase : 0; }
      c.stroke(); c.setLineDash([]); c.lineDashOffset = 0;
      // stretches inside a hazard are overdrawn in red so exposure is visible on the route itself
      for (const sp of r.spans || []) { const seg = slice(r.path, sp.from, sp.to); if (seg.length > 1) { line(seg); c.strokeStyle = T.danger; c.lineWidth = (r.width || 2.5) + 1; c.stroke(); } }
      if (r.arrows !== false && r.tone !== 'ghost') {
        let acc = 0; const every = 46 / k; c.fillStyle = col;
        for (let i = 1; i < r.path.length; i++) { const a = r.path[i - 1], b = r.path[i], l = dist(a, b); let d = every - acc; while (d < l) { const t = d / l, x = sx(a[0] + (b[0] - a[0]) * t), y = sy(a[1] + (b[1] - a[1]) * t), ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]); c.save(); c.translate(x, y); c.rotate(ang); c.beginPath(); c.moveTo(5, 0); c.lineTo(-3.5, -4); c.lineTo(-1.5, 0); c.lineTo(-3.5, 4); c.closePath(); c.fill(); c.restore(); d += every; } acc = (acc + l) % every; }
      }
      if (r.end) { const e = r.path[r.path.length - 1]; c.beginPath(); c.arc(sx(e[0]), sy(e[1]), 4, 0, 7); c.fillStyle = T.bg0; c.fill(); c.strokeStyle = col; c.lineWidth = 2; c.stroke(); }
    }
  }
  function slice(path, from, to) {
    const out = []; let d = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], l = dist(a, b), s = Math.max(from, d), e = Math.min(to, d + l);
      if (e > s && l > 0) { const p = (t) => [a[0] + ((b[0] - a[0]) * (t - d)) / l, a[1] + ((b[1] - a[1]) * (t - d)) / l]; if (!out.length) out.push(p(s)); out.push(p(e)); }
      d += l;
    }
    return out;
  }

  function drawBreach(br) {
    if (!br) return;
    const f = P(br.foot), s = P(br.stand), p = P(br.pos);
    c.setLineDash([4, 4]); c.strokeStyle = T.text; c.lineWidth = 1.2; c.beginPath(); c.moveTo(s[0], s[1]); c.lineTo(p[0], p[1]); c.stroke(); c.setLineDash([]);
    // the cut: a bracket across the wall at the foot point
    const dx = p[0] - s[0], dy = p[1] - s[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, hw = Math.max(7, 0.5 * k);
    c.strokeStyle = T.text; c.lineWidth = 2.5; c.beginPath(); c.moveTo(f[0] - nx * hw, f[1] - ny * hw); c.lineTo(f[0] + nx * hw, f[1] + ny * hw); c.stroke();
    c.beginPath(); c.arc(s[0], s[1], 4.5, 0, 7); c.fillStyle = T.accent; c.fill(); c.strokeStyle = T.bg0; c.lineWidth = 1.5; c.stroke();
    text(br.through.toFixed(1) + ' m', (f[0] + p[0]) / 2 + nx * 12, (f[1] + p[1]) / 2 + ny * 12, { align: 'center', base: 'middle', size: 11, color: T.text, mono: true });
    text('Break through here', s[0], s[1] + (ny >= 0 ? 18 : -12), { align: 'center', size: 11, color: T.text });
  }

  function drawMarkers(sc) {
    hits = [];
    for (const u of sc.units || []) {
      if (u.trail && u.trail.length > 1) { line(u.trail); c.strokeStyle = alpha(u.kind === 'drone' ? T.text3 : T.text2, 0.5); c.lineWidth = 1; c.setLineDash([1, 3]); c.stroke(); c.setLineDash([]); }
    }
    for (const m of sc.markers || []) {
      const [x, y] = P(m.pos), col = m.kind === 'person' ? T.person : m.kind === 'possible' ? T.warn : m.kind === 'truth' ? T.sim : m.kind === 'decoy' ? T.sim : T.text3;
      const sel = m.selected || (hover && hover.id === m.id);
      if (m.sigma && m.kind !== 'rejected') { const r = Math.max(6, 2 * m.sigma * k); c.beginPath(); c.arc(x, y, r, 0, 7); c.fillStyle = alpha(col, m.reached ? 0.05 : 0.1); c.fill(); c.strokeStyle = alpha(col, 0.7); c.lineWidth = 1; c.setLineDash([3, 3]); c.stroke(); c.setLineDash([]); }
      if (m.pulse && running) { const t = (phase / 40) % 1; c.beginPath(); c.arc(x, y, 7 + t * 16, 0, 7); c.strokeStyle = alpha(col, 0.6 * (1 - t)); c.lineWidth = 1.5; c.stroke(); }
      if (sel) { c.beginPath(); c.arc(x, y, 12, 0, 7); c.strokeStyle = T.text; c.lineWidth = 1.5; c.stroke(); }
      c.beginPath();
      if (m.kind === 'person') { c.arc(x, y, 6.5, 0, 7); c.fillStyle = m.reached ? T.bg0 : col; c.fill(); c.strokeStyle = m.reached ? col : T.bg0; c.lineWidth = 2; c.stroke(); }
      else if (m.kind === 'possible') { c.moveTo(x, y - 7.5); c.lineTo(x + 7.5, y); c.lineTo(x, y + 7.5); c.lineTo(x - 7.5, y); c.closePath(); c.fillStyle = T.bg0; c.fill(); c.strokeStyle = col; c.lineWidth = 2; c.stroke(); }
      else if (m.kind === 'truth') { c.arc(x, y, 9.5, 0, 7); c.strokeStyle = col; c.lineWidth = 2; c.setLineDash([3, 2]); c.stroke(); c.setLineDash([]); c.beginPath(); c.arc(x, y, 2, 0, 7); c.fillStyle = col; c.fill(); }
      else if (m.kind === 'decoy') { c.rect(x - 6, y - 6, 12, 12); c.strokeStyle = col; c.lineWidth = 1.5; c.setLineDash([3, 2]); c.stroke(); c.setLineDash([]); }
      else { c.moveTo(x - 5, y - 5); c.lineTo(x + 5, y + 5); c.moveTo(x + 5, y - 5); c.lineTo(x - 5, y + 5); c.strokeStyle = col; c.lineWidth = 1.5; c.stroke(); }
      if (m.rank != null) { const bx = x + 13, by = y - 13; c.beginPath(); c.arc(bx, by, 8.5, 0, 7); c.fillStyle = sel ? T.text : T.bg3; c.fill(); c.strokeStyle = sel ? T.text : T.line2; c.lineWidth = 1; c.stroke(); text(String(m.rank), bx, by + 0.5, { align: 'center', base: 'middle', size: 10.5, weight: 700, color: sel ? T.bg0 : T.text, mono: true, halo: false }); }
      if (m.label && (k > 4 || sel)) text(m.label, x + (m.rank != null ? 25 : 12), y + (m.rank != null ? -9 : 4), { size: 11, color: m.kind === 'rejected' ? T.text3 : T.text, weight: sel ? 600 : 500 });
      if (m.id) hits.push({ id: m.id, x, y, r: 14, m });
    }
    for (const u of sc.units || []) {
      const [x, y] = P(u.pos), col = u.kind === 'team' ? T.accent : u.kind === 'drone' ? T.text2 : T.text;
      c.save(); c.translate(x, y);
      if (u.kind === 'team') { c.beginPath(); c.arc(0, 0, 6, 0, 7); c.fillStyle = T.bg0; c.fill(); c.strokeStyle = col; c.lineWidth = 2; c.stroke(); c.beginPath(); c.arc(0, 0, 2, 0, 7); c.fillStyle = col; c.fill(); }
      else if (u.kind === 'drone') { c.rotate(-(u.heading || 0)); c.strokeStyle = col; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-6, -6); c.lineTo(6, 6); c.moveTo(6, -6); c.lineTo(-6, 6); c.stroke(); for (const [a, b] of [[-6, -6], [6, 6], [6, -6], [-6, 6]]) { c.beginPath(); c.arc(a, b, 2.6, 0, 7); c.stroke(); } }
      else { c.rotate(-(u.heading || 0)); c.beginPath(); c.moveTo(8, 0); c.lineTo(-5, -5.5); c.lineTo(-2.5, 0); c.lineTo(-5, 5.5); c.closePath(); c.fillStyle = col; c.fill(); c.strokeStyle = T.bg0; c.lineWidth = 1.5; c.stroke(); }
      c.restore();
      if (u.ring) { c.beginPath(); c.arc(x, y, u.ring * k, 0, 7); c.strokeStyle = alpha(T.accent, 0.5); c.lineWidth = 1; c.setLineDash([2, 4]); c.stroke(); c.setLineDash([]); if (u.listen != null) { c.beginPath(); c.arc(x, y, u.ring * k, -Math.PI / 2, -Math.PI / 2 + u.listen * Math.PI * 2); c.strokeStyle = T.accent; c.lineWidth = 2; c.stroke(); } }
      if (u.label) text(u.label, x + 11, y + 15, { size: 10.5, color: T.text2 });
    }
  }

  function drawFurniture() {
    // scale bar and north arrow
    const m = [1, 2, 5, 10, 20, 50].find((v) => v * k >= 56) || 50, x = W - 20 - m * k, y = H - 22;
    c.strokeStyle = T.text2; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y - 4); c.lineTo(x, y); c.lineTo(x + m * k, y); c.lineTo(x + m * k, y - 4); c.moveTo(x + (m * k) / 2, y - 2.5); c.lineTo(x + (m * k) / 2, y); c.stroke();
    text(m + ' m', x + (m * k) / 2, y - 7, { align: 'center', size: 10, color: T.text2, mono: true });
    const nx = W - 26, ny = 34; c.beginPath(); c.moveTo(nx, ny - 13); c.lineTo(nx + 5.5, ny + 6); c.lineTo(nx, ny + 2); c.lineTo(nx - 5.5, ny + 6); c.closePath(); c.fillStyle = T.text2; c.fill(); text('N', nx, ny + 18, { align: 'center', size: 10, color: T.text2, weight: 600 });
  }

  function draw() {
    if (!W || !H) return;
    const sc = scene() || {};
    c.setTransform(dpr, 0, 0, dpr, 0, 0); layout();
    drawBase(sc); drawRoutes(sc); drawBreach(sc.breach); drawMarkers(sc); drawFurniture();
  }
  function tick() { phase = (phase + 0.5) % 4000; draw(); if (running) raf = requestAnimationFrame(tick); }

  const ro = new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return;
    dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    T = tokens(); pats = { danger: hatch(c, alpha(T.danger, 0.34), 7), dangerDense: hatch(c, alpha(T.danger, 0.62), 4, 1.2), dim: hatch(c, alpha(T.text3, 0.2), 6) };
    draw();
  });
  ro.observe(canvas);
  document.fonts?.ready.then(() => { if (W) draw(); });

  // pointer: pick a marker, drag to pan, wheel to zoom, double-click to fit again
  let drag = null; const home = rect.slice();
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pick = (x, y) => hits.slice().reverse().find((hh) => Math.hypot(hh.x - x, hh.y - y) <= hh.r) || null;
  function onMove(e) {
    const [x, y] = at(e);
    if (drag) { const dx = (x - drag.x) / k, dy = (y - drag.y) / k; if (Math.abs(x - drag.x0) + Math.abs(y - drag.y0) > 4) drag.moved = true; rect = [rect[0] - dx, rect[1] + dy, rect[2] - dx, rect[3] + dy]; drag.x = x; drag.y = y; draw(); return; }
    const hNow = pick(x, y); if ((hNow?.id || null) !== (hover?.id || null)) { hover = hNow; canvas.style.cursor = hNow ? 'pointer' : interactive ? 'grab' : 'default'; draw(); }
  }
  function onDown(e) { if (!interactive) return; const [x, y] = at(e); drag = { x, y, x0: x, y0: y, moved: false }; canvas.setPointerCapture?.(e.pointerId); }
  function onUp(e) { const [x, y] = at(e); const was = drag; drag = null; if (was?.moved) return; const hNow = pick(x, y); if (hNow) onPick?.(hNow.id, hNow.m); else onPick?.(null, null, toWorld(x, y)); }
  function onWheel(e) { if (!interactive) return; e.preventDefault(); const [x, y] = at(e), w = toWorld(x, y), f = Math.exp(Math.max(-1, Math.min(1, e.deltaY / 240)) * 0.5); const nw = Math.max(12, Math.min(SITE.w * 1.4, (rect[2] - rect[0]) * f)), ratio = nw / (rect[2] - rect[0]); rect = [w[0] - (w[0] - rect[0]) * ratio, w[1] - (w[1] - rect[1]) * ratio, w[0] + (rect[2] - w[0]) * ratio, w[1] + (rect[3] - w[1]) * ratio]; draw(); }
  function onDbl() { if (interactive) { rect = home.slice(); draw(); } }
  canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; draw(); } });
  canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('dblclick', onDbl);
  if (interactive) canvas.style.cursor = 'grab';

  return {
    draw,
    setView(v) { rect = (VIEWS[v] || v).slice(); home.splice(0, 4, ...rect); draw(); },
    retheme() { T = tokens(); if (W) { pats = { danger: hatch(c, alpha(T.danger, 0.34), 7), dangerDense: hatch(c, alpha(T.danger, 0.62), 4, 1.2), dim: hatch(c, alpha(T.text3, 0.2), 6) }; draw(); } },
    start() { if (running) return; running = true; raf = requestAnimationFrame(tick); },
    stop() { running = false; cancelAnimationFrame(raf); },
    toWorld,
    destroy() { this.stop(); ro.disconnect(); },
  };
}
