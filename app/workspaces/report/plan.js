// Drawing A: the search plan, as print-quality SVG. Two views: Building B large, the whole site small.
// World coordinates are [x, y] in metres, x east, y north; SVG y is flipped. All strokes are dark on light paper.
// Colours come from classes defined in paper.css (report-p-*), so the same markup prints and shows on screen.
import world from '../../core/world.js';

const f = (n) => (Math.round(n * 10) / 10).toString();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function view(x0, y0, x1, y1, s, pad) {
  const w = (x1 - x0) * s, h = (y1 - y0) * s;
  return { x0, y0, x1, y1, s, pad, w, h, W: w + pad.l + pad.r, H: h + pad.t + pad.b,
    X: (x) => pad.l + (x - x0) * s, Y: (y) => pad.t + (y1 - y) * s,
    pt(p) { return f(this.X(p[0])) + ',' + f(this.Y(p[1])); },
    poly(pts) { return pts.map((p) => this.pt(p)).join(' '); } };
}

function defs(id) {
  // Hatches. Each pattern is small and vector, so it stays sharp in a PDF.
  return '<defs>' +
    '<pattern id="' + id + '-collapse" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V6M0 0H6" class="report-p-hz-line"/></pattern>' +
    '<pattern id="' + id + '-slope" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><path d="M0 0V7" class="report-p-hz-line"/></pattern>' +
    '<pattern id="' + id + '-mud" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M1 2h3M5 6h3" class="report-p-hz-line"/></pattern>' +
    '<pattern id="' + id + '-gas" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V7" class="report-p-gas-line"/></pattern>' +
    '<pattern id="' + id + '-rubble" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M1 3l2-2 2 2zM6 8l1.500-2.500L9 8z" class="report-p-rubble-chip"/><circle cx="6.500" cy="2.500" r="0.700" class="report-p-dot"/><circle cx="2.500" cy="6.800" r="0.700" class="report-p-dot"/></pattern>' +
    '<pattern id="' + id + '-furn" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 5L5 0" class="report-p-thin"/></pattern>' +
    '<pattern id="' + id + '-blocked" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V8" class="report-p-blocked-line"/></pattern>' +
    '<pattern id="' + id + '-bldg" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V6" class="report-p-faint"/></pattern>' +
    '<marker id="' + id + '-arrow" viewBox="0 0 10 10" refX="8.500" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1.200L9 5 0 8.800z" class="report-p-route-head"/></marker>' +
    '</defs>';
}

function northArrow(x, y, r) {
  return '<g transform="translate(' + f(x) + ' ' + f(y) + ')" aria-label="North is up"><circle r="' + r + '" class="report-p-paperfill report-p-thin"/><path d="M0 ' + (-r + 3) + 'L' + f(r * 0.42) + ' ' + f(r * 0.55) + 'L0 ' + f(r * 0.22) + 'Z" class="report-p-inkfill"/><path d="M0 ' + (-r + 3) + 'L' + f(-r * 0.42) + ' ' + f(r * 0.55) + 'L0 ' + f(r * 0.22) + 'Z" class="report-p-paperfill report-p-thin"/><text y="' + (-r - 3) + '" text-anchor="middle" class="report-p-t report-p-t-b">N</text></g>';
}
function scaleBar(x, y, s, step, n) {
  let g = '<g transform="translate(' + f(x) + ' ' + f(y) + ')">';
  for (let i = 0; i < n; i++) g += '<rect x="' + f(i * step * s) + '" y="0" width="' + f(step * s) + '" height="4" class="' + (i % 2 ? 'report-p-paperfill' : 'report-p-inkfill') + ' report-p-thin"/>';
  for (let i = 0; i <= n; i++) g += '<text x="' + f(i * step * s) + '" y="14" text-anchor="middle" class="report-p-t report-p-t-s">' + i * step + '</text>';
  return g + '<text x="' + f(n * step * s + 10) + '" y="14" class="report-p-t report-p-t-s">m</text></g>';
}
function hazardShapes(v, id, R) {
  let g = '';
  for (const h of R.hazards) {
    const pat = h.kind === 'rubble' ? 'rubble' : ['collapse', 'slope', 'mud', 'gas'].includes(h.kind) ? h.kind : 'collapse';
    g += '<g class="report-p-click" data-sel="hazard:' + esc(h.id) + '"><title>' + esc(h.key + ': ' + h.name) + '</title><polygon points="' + v.poly(h.poly) + '" fill="url(#' + id + '-' + pat + ')" class="' + (h.kind === 'rubble' ? 'report-p-rubble' : h.kind === 'gas' ? 'report-p-gas' : 'report-p-hz') + (h.block ? ' report-p-hz-block' : '') + '"/></g>';
  }
  return g;
}
function hazardKeys(v, R, at) {
  let g = '';
  for (const h of R.hazards) {
    const c = at[h.id] || h.centre;
    if (c[0] < v.x0 + 0.5 || c[0] > v.x1 - 0.5 || c[1] < v.y0 + 0.5 || c[1] > v.y1 - 0.5) continue;
    g += '<g transform="translate(' + v.pt(c).replace(',', ' ') + ')" class="report-p-click" data-sel="hazard:' + esc(h.id) + '"><path d="M0 -9L8.500 6H-8.500Z" class="report-p-hz-key"/><text y="3.500" text-anchor="middle" class="report-p-t report-p-t-key">' + h.key.slice(1) + '</text></g>';
  }
  return g;
}
function routeLines(v, id, R, { breach }) {
  if (!R.route) return '';
  let g = '';
  for (const l of R.route.legs) {
    if (!l.ok || !l.path) continue;
    g += '<polyline points="' + v.poly(l.path) + '" class="report-p-route' + (R.route.status === 'planned' ? ' report-p-route-planned' : '') + '" marker-end="url(#' + id + '-arrow)"/>';
    // an arrowhead in the middle of each long segment, so the direction of travel reads anywhere on the line
    for (let i = 1; i < l.path.length; i++) {
      const a = l.path[i - 1], b = l.path[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d * v.s < 60) continue;
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ang = (Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180) / Math.PI;
      g += '<path d="M-4 -3.200L4 0-4 3.200Z" transform="translate(' + v.pt(m).replace(',', ' ') + ') rotate(' + f(ang) + ')" class="report-p-route-head"/>';
    }
    if (l.kind === 'break through' && breach) {
      const p = R.people.find((x) => x.n === l.person);
      if (p?.pos) g += '<line x1="' + f(v.X(l.access[0])) + '" y1="' + f(v.Y(l.access[1])) + '" x2="' + f(v.X(p.pos[0])) + '" y2="' + f(v.Y(p.pos[1])) + '" class="report-p-breach-line"/>';
      const wall = p?.access?.wall;
      if (wall) g += '<g transform="translate(' + v.pt(wall.point).replace(',', ' ') + ')"><path d="M-7 -7L7 7M-7 7L7 -7" class="report-p-breach"/><circle r="9.500" class="report-p-breach-ring"/></g>';
      g += '<g transform="translate(' + v.pt(l.access).replace(',', ' ') + ')"><rect x="-3.500" y="-3.500" width="7" height="7" class="report-p-access"/></g>';
    }
  }
  return g;
}
function personMarks(v, R, { sigma, r }) {
  let g = '';
  for (const c of R.closed) {
    if (!c.pos) continue;
    g += '<g transform="translate(' + v.pt(c.pos).replace(',', ' ') + ')" class="report-p-click" data-sel="detection:' + esc(c.det) + '"><title>' + esc('Lead closed: ' + c.kind + '. ' + c.reason) + '</title><path d="M-3.500 -3.500L3.500 3.500M-3.500 3.500L3.500 -3.500" class="report-p-closed"/>' + (sigma ? '<text x="6" y="3.500" class="report-p-t report-p-t-s report-p-t-mute">' + esc(c.kind.toLowerCase()) + '</text>' : '') + '</g>';
  }
  for (const p of R.people) {
    if (!p.pos) continue;
    const sel = p.sel.type + ':' + p.sel.id;
    g += '<g transform="translate(' + v.pt(p.pos).replace(',', ' ') + ')" class="report-p-click" data-sel="' + esc(sel) + '"><title>' + esc('Person ' + p.n + ': ' + p.stateLabel + ', ' + (p.p * 100).toFixed(0) + ' % sure') + '</title>';
    if (sigma && p.sigma) g += '<circle r="' + f(Math.max(r + 2, p.sigma * v.s)) + '" class="' + (p.confirmed ? 'report-p-sigma' : 'report-p-sigma report-p-sigma-poss') + '"/>';
    g += p.confirmed ? '<circle r="' + r + '" class="report-p-person"/>' : '<path d="M0 ' + (-r - 1.500) + 'L' + (r + 1.500) + ' 0 0 ' + (r + 1.500) + ' ' + (-r - 1.500) + ' 0Z" class="report-p-possible"/>';
    g += '<text y="4.200" text-anchor="middle" class="report-p-t ' + (p.confirmed ? 'report-p-t-on' : 'report-p-t-b') + '" style="font-size:12px">' + p.n + '</text></g>';
  }
  return g;
}

// ---------- Building B, large ----------
export function buildingPlan(S, R) {
  const id = 'rpb', B = world.BUILDING.rect;
  const v = view(39, 25, 92, 64, 12.6, { l: 26, r: 6, t: 8, b: 30 });
  const tint = { clear: 'report-p-room-clear', lead: 'report-p-room-lead', person: 'report-p-room-person', blocked: 'report-p-room-blocked', unsearched: 'report-p-room-none' };
  const cov = Object.fromEntries(R.coverage.map((c) => [c.room, c]));
  let g = '<svg xmlns="http://www.w3.org/2000/svg" class="report-plan" viewBox="0 0 ' + f(v.W) + ' ' + f(v.H) + '" width="' + f(v.W) + '" height="' + f(v.H) + '" role="img" aria-label="Plan of Building B with search coverage, hazards, people found and the rescue route">' + defs(id);
  g += '<clipPath id="' + id + '-clip"><rect x="' + v.pad.l + '" y="' + v.pad.t + '" width="' + f(v.w) + '" height="' + f(v.h) + '"/></clipPath>';
  // grid ticks and coordinates
  for (let x = Math.ceil(v.x0 / 5) * 5; x <= v.x1; x += 5) { g += '<line x1="' + f(v.X(x)) + '" x2="' + f(v.X(x)) + '" y1="' + v.pad.t + '" y2="' + f(v.pad.t + v.h) + '" class="report-p-grid"/>'; if (x % 10 === 0) g += '<text x="' + f(v.X(x)) + '" y="' + f(v.pad.t + v.h + 12) + '" text-anchor="middle" class="report-p-t report-p-t-s report-p-t-mute">' + x + '</text>'; }
  for (let y = Math.ceil(v.y0 / 5) * 5; y <= v.y1; y += 5) { g += '<line y1="' + f(v.Y(y)) + '" y2="' + f(v.Y(y)) + '" x1="' + v.pad.l + '" x2="' + f(v.pad.l + v.w) + '" class="report-p-grid"/>'; if (y % 10 === 0) g += '<text x="' + (v.pad.l - 5) + '" y="' + f(v.Y(y) + 3.500) + '" text-anchor="end" class="report-p-t report-p-t-s report-p-t-mute">' + y + '</text>'; }
  g += '<text x="' + f(v.pad.l + v.w) + '" y="' + f(v.pad.t + v.h + 27) + '" text-anchor="end" class="report-p-t report-p-t-s report-p-t-mute">metres east (across) and north (up) of the site origin</text>';
  g += '<g clip-path="url(#' + id + '-clip)">';
  // rooms: coverage tint
  for (const r of world.ROOMS) {
    const c = cov[r.id], [a, b, c2, d] = r.rect;
    g += '<rect x="' + f(v.X(a)) + '" y="' + f(v.Y(d)) + '" width="' + f((c2 - a) * v.s) + '" height="' + f((d - b) * v.s) + '" class="' + (r.corridor ? 'report-p-room-corr' : tint[c?.status] || 'report-p-room-none') + (r.corridor ? '' : ' report-p-click') + '"' + (c?.status === 'blocked' ? ' fill="url(#' + id + '-blocked)"' : '') + (r.corridor ? '' : ' data-sel="room:' + r.id + '"') + '/>';
  }
  // neighbouring building, lightly
  for (const o of world.OBSTACLES) if (o.kind === 'building') g += '<polygon points="' + v.poly(o.poly) + '" fill="url(#' + id + '-bldg)" class="report-p-faint"/>';
  g += hazardShapes(v, id, R);
  for (const o of world.OBSTACLES) if (o.kind === 'furniture') g += '<polygon points="' + v.poly(o.poly) + '" fill="url(#' + id + '-furn)" class="report-p-thin"><title>' + esc(o.name) + '</title></polygon>';
  // doors: leaf and swing, drawn into the room
  for (const d of world.DOORS) {
    const room = world.roomById(d.room); if (!room) continue;
    const up = d.id === 'entrance' ? 1 : (room.rect[1] + room.rect[3]) / 2 > d.pos[1] ? 1 : -1;
    const hx = v.X(d.pos[0] - d.w / 2), hy = v.Y(d.pos[1]), L = d.w * v.s;
    if (d.blocked) g += '<path d="M' + f(hx) + ' ' + f(hy - 4) + 'L' + f(hx + L) + ' ' + f(hy + 4) + 'M' + f(hx) + ' ' + f(hy + 4) + 'L' + f(hx + L) + ' ' + f(hy - 4) + '" class="report-p-door-x"/>';
    else g += '<path d="M' + f(hx) + ' ' + f(hy) + 'L' + f(hx) + ' ' + f(hy - up * L) + 'A' + f(L) + ' ' + f(L) + ' 0 0 ' + (up > 0 ? 1 : 0) + ' ' + f(hx + L) + ' ' + f(hy) + '" class="report-p-door"/>';
  }
  // walls: thickness by material, state by line style
  for (const w of world.WALLS) {
    const cls = 'report-p-wall report-p-wall-' + w.mat + (w.state !== 'intact' ? ' report-p-wall-' + w.state : '');
    g += '<line x1="' + f(v.X(w.a[0])) + '" y1="' + f(v.Y(w.a[1])) + '" x2="' + f(v.X(w.b[0])) + '" y2="' + f(v.Y(w.b[1])) + '" class="' + cls + '"><title>' + esc(w.id + ': ' + w.mat + ', ' + w.state) + '</title></line>';
    if (w.state === 'damaged') {
      const n = Math.floor(Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) / 1.5);
      for (let i = 1; i < n; i++) { const p = [w.a[0] + ((w.b[0] - w.a[0]) * i) / n, w.a[1] + ((w.b[1] - w.a[1]) * i) / n]; g += '<path d="M-4 -3L4 3" transform="translate(' + v.pt(p).replace(',', ' ') + ')" class="report-p-wall-tick"/>'; }
    }
  }
  // room labels
  for (const r of world.ROOMS) {
    const c = cov[r.id], x = v.X(r.rect[0]) + 7; let top = r.rect[3];
    // keep the label clear of a small hazard patch that sits in the room's north-west corner
    for (const hzd of R.hazards) { if (hzd.kind !== 'gas') continue; const ys = hzd.poly.map((p) => p[1]), xs = hzd.poly.map((p) => p[0]); if (Math.min(...xs) < r.rect[0] + 6 && Math.max(...xs) > r.rect[0] && Math.max(...ys) > r.rect[3] - 2 && Math.min(...ys) > r.rect[1] + 5) top = Math.min(top, Math.min(...ys)); }
    const y = v.Y(top) + 15;
    if (r.corridor) { if (r.id === 'C-EW') g += '<text x="' + f(v.X(51.4)) + '" y="' + f(v.Y(45.1) + 3.500) + '" class="report-p-t report-p-t-s report-p-t-mute">Corridor</text>'; else if (r.id === 'C-N') g += '<text x="' + f(v.X(64)) + '" y="' + f(v.Y(56.6)) + '" text-anchor="middle" class="report-p-t report-p-t-s report-p-t-mute">Stair</text>'; continue; }
    const st = { clear: 'clear, miss ' + (c.residual * 100).toFixed(0) + ' %', lead: 'possible person', person: 'person found', blocked: 'not searched', unsearched: 'not searched' }[c?.status] || '';
    const nm = /^Classroom/.test(r.name) ? '' : r.name.replace(/ \d+$/, '');
    g += '<g class="report-p-click" data-sel="room:' + r.id + '"><text x="' + f(x) + '" y="' + f(y) + '" class="report-p-t report-p-t-room">' + r.id + '</text>' + (nm ? '<text x="' + f(x + 34) + '" y="' + f(y) + '" class="report-p-t report-p-t-s">' + esc(nm) + '</text>' : '') + '<text x="' + f(x) + '" y="' + f(y + 14) + '" class="report-p-t report-p-t-s report-p-t-st-' + (c?.status || 'unsearched') + '">' + st + '</text></g>';
  }
  // rover trail and listening stops
  const rover = S.units['HOUND-01'];
  if (rover.trail.length > 1) g += '<polyline points="' + v.poly(rover.trail) + '" class="report-p-trail"/>';
  const used = new Set(R.coverage.map((c) => c.stop).filter(Boolean));
  for (const st of world.STOPS) {
    const done = used.has(st.id);
    g += '<g transform="translate(' + v.pt(st.pos).replace(',', ' ') + ')" class="report-p-click" data-sel="stop:' + st.id + '"><title>' + esc(st.id + ': ' + st.label + (done ? ' (listened)' : ' (not reached yet)')) + '</title><rect x="-4" y="-4" width="8" height="8" class="' + (done ? 'report-p-stop-done' : 'report-p-stop') + '"/><text x="7" y="-5" class="report-p-t report-p-t-s report-p-t-b">' + st.id + '</text></g>';
  }
  g += routeLines(v, id, R, { breach: true });
  // hazard keys, placed by hand where the shapes overlap
  const at = { 'hz-slope-ne': [89.6, 60.6], 'hz-collapse': [82, 57.6], 'hz-mud-c': [90, 40], 'hz-gas': [58.7, 56.4], 'rubble-corridor': [77.6, 44], 'rubble-ne': [85.2, 53.2], 'rubble-field': [90.8, 63] };
  g += hazardKeys(v, R, at);
  g += personMarks(v, R, { sigma: true, r: 8.5 });
  // break-through call-out
  for (const p of R.people) if (p.access?.wall && p.access.kind === 'break through') {
    // the note sits in the clear strip north of the building, with a leader to the wall
    const q = p.access.wall.point, bx = v.X(Math.min(q[0] - 3.2, v.x1 - 16)), byy = v.Y(Math.min(v.y1 - 0.6, Math.max(q[1] + 8.4, 61.9)));
    g += '<g><line x1="' + f(v.X(q[0])) + '" y1="' + f(v.Y(q[1]) - 10) + '" x2="' + f(bx) + '" y2="' + f(byy + 32) + '" class="report-p-leader"/><rect x="' + f(bx - 176) + '" y="' + f(byy) + '" width="178" height="32" class="report-p-callout"/><text x="' + f(bx - 170) + '" y="' + f(byy + 13) + '" class="report-p-t report-p-t-s report-p-t-b">Break through here</text><text x="' + f(bx - 170) + '" y="' + f(byy + 26) + '" class="report-p-t report-p-t-s">' + esc(p.access.wall.state + ' ' + p.access.wall.mat + ', ' + p.access.gap.toFixed(1) + ' m to go') + '</text></g>';
  }
  // the rover now
  g += '<g transform="translate(' + v.pt(rover.pos).replace(',', ' ') + ') rotate(' + f((-rover.heading * 180) / Math.PI) + ')"><title>HOUND-01 at report time</title><path d="M7 0L-5 -5V5Z" class="report-p-rover"/></g>';
  // entrance
  g += '<g transform="translate(' + f(v.X(64)) + ' ' + f(v.Y(27.6)) + ')"><path d="M0 8V-6M-4 -1L0 -6 4 -1" class="report-p-ink-line"/><text y="19" text-anchor="middle" class="report-p-t report-p-t-s report-p-t-b">Entrance</text></g>';
  g += '</g>';
  g += '<rect x="' + v.pad.l + '" y="' + v.pad.t + '" width="' + f(v.w) + '" height="' + f(v.h) + '" class="report-p-frame"/>';
  g += northArrow(v.pad.l + 26, v.pad.t + 34, 13);
  g += '<g><rect x="' + (v.pad.l + 8) + '" y="' + f(v.pad.t + v.h - 34) + '" width="170" height="26" class="report-p-paperfill"/>' + scaleBar(v.pad.l + 16, v.pad.t + v.h - 28, v.s, 5, 2) + '</g>';
  return g + '</svg>';
}

// ---------- the whole site, small ----------
export function sitePlan(S, R, scale = 2.55) {
  const id = 'rps', v = view(0, 0, world.SITE.w, world.SITE.h, scale, { l: 1, r: 1, t: 1, b: 1 });
  let g = '<svg xmlns="http://www.w3.org/2000/svg" class="report-plan" viewBox="0 0 ' + f(v.W) + ' ' + f(v.H) + '" width="' + f(v.W) + '" height="' + f(v.H) + '" role="img" aria-label="Plan of the whole exercise site, 120 by 90 metres">' + defs(id);
  for (let x = 20; x < 120; x += 20) g += '<line x1="' + f(v.X(x)) + '" x2="' + f(v.X(x)) + '" y1="1" y2="' + f(v.h + 1) + '" class="report-p-grid"/>';
  for (let y = 20; y < 90; y += 20) g += '<line y1="' + f(v.Y(y)) + '" y2="' + f(v.Y(y)) + '" x1="1" x2="' + f(v.w + 1) + '" class="report-p-grid"/>';
  for (const sw of S.map.swaths) g += '<rect x="' + f(v.X(sw.x0)) + '" y="' + f(v.Y(sw.y + sw.half)) + '" width="' + f(Math.max(0, sw.x1 - sw.x0) * v.s) + '" height="' + f(sw.half * 2 * v.s) + '" class="report-p-swath"/>';
  g += hazardShapes(v, id, R);
  for (const o of world.OBSTACLES) if (o.kind === 'building') { const c = o.poly.reduce((a, p) => [a[0] + p[0] / o.poly.length, a[1] + p[1] / o.poly.length], [0, 0]); g += '<polygon points="' + v.poly(o.poly) + '" fill="url(#' + id + '-bldg)" class="report-p-ink-line"/><text x="' + f(v.X(c[0])) + '" y="' + f(v.Y(c[1]) + 4) + '" text-anchor="middle" class="report-p-t report-p-t-b">' + (o.id === 'bldg-a' ? 'A' : 'C') + '</text>'; }
  const B = world.BUILDING.rect;
  g += '<rect x="' + f(v.X(B[0])) + '" y="' + f(v.Y(B[3])) + '" width="' + f((B[2] - B[0]) * v.s) + '" height="' + f((B[3] - B[1]) * v.s) + '" class="report-p-paperfill report-p-bldg-b"/>';
  for (const w of world.WALLS) if (w.mat === 'drywall') g += '<line x1="' + f(v.X(w.a[0])) + '" y1="' + f(v.Y(w.a[1])) + '" x2="' + f(v.X(w.b[0])) + '" y2="' + f(v.Y(w.b[1])) + '" class="report-p-thin"/>';
  g += '<text x="' + f(v.X(47)) + '" y="' + f(v.Y(50)) + '" class="report-p-t report-p-t-b">B</text>';
  const rover = S.units['HOUND-01'], drone = S.units['DRONE-01'];
  if (rover.trail.length > 1) g += '<polyline points="' + v.poly(rover.trail) + '" class="report-p-trail"/>';
  g += routeLines(v, id, R, { breach: false });
  const mark = (p, label, dx, dy, anchor) => '<g transform="translate(' + v.pt(p).replace(',', ' ') + ')"><rect x="-2.500" y="-2.500" width="5" height="5" class="report-p-inkfill"/><text x="' + dx + '" y="' + dy + '" text-anchor="' + (anchor || 'start') + '" class="report-p-t report-p-t-s">' + label + '</text></g>';
  g += mark(world.SITE.staging, 'Staging', 6, 4) + mark(world.SITE.dronePad, 'Drone pad', -4, -6, 'middle');
  if (drone.alt > 0.5) g += '<g transform="translate(' + v.pt(drone.pos).replace(',', ' ') + ')"><title>Scout drone (concept) at report time</title><path d="M-4 -4L4 4M-4 4L4 -4" class="report-p-ink-line"/><circle r="2" class="report-p-paperfill report-p-thin"/></g>';
  g += personMarks(v, R, { sigma: false, r: 7.5 });
  g += '<rect x="' + f(v.X(39)) + '" y="' + f(v.Y(64)) + '" width="' + f(53 * v.s) + '" height="' + f(39 * v.s) + '" class="report-p-inset"/><text x="' + f(v.X(39) + 2) + '" y="' + f(v.Y(64) - 3) + '" class="report-p-t report-p-t-s report-p-t-mute">large plan</text>';
  g += '<rect x="1" y="1" width="' + f(v.w) + '" height="' + f(v.h) + '" class="report-p-frame"/>';
  g += northArrow(v.w - 16, 24, 9);
  g += '<g><rect x="6" y="' + f(v.h - 24) + '" width="' + f(40 * v.s + 34) + '" height="22" class="report-p-paperfill"/>' + scaleBar(12, v.h - 19, v.s, 20, 2) + '</g>';
  return g + '</svg>';
}

// Small swatches for the legend, drawn with the same classes as the plan.
export function legendItems(R) {
  const sw = (inner) => '<svg class="report-plan" width="30" height="16" viewBox="0 0 30 16" aria-hidden="true">' + defs('rpl') + inner + '</svg>';
  return [
    [sw('<line x1="1" y1="8" x2="29" y2="8" class="report-p-wall report-p-wall-concrete"/>'), 'Concrete wall'],
    [sw('<line x1="1" y1="8" x2="29" y2="8" class="report-p-wall report-p-wall-drywall"/>'), 'Drywall partition'],
    [sw('<line x1="1" y1="8" x2="29" y2="8" class="report-p-wall report-p-wall-drywall report-p-wall-damaged"/><path d="M11 5l8 6" class="report-p-wall-tick"/>'), 'Damaged wall'],
    [sw('<line x1="1" y1="8" x2="29" y2="8" class="report-p-wall report-p-wall-concrete report-p-wall-collapsed"/>'), 'Collapsed wall'],
    [sw('<rect x="1" y="1" width="28" height="14" fill="url(#rpl-collapse)" class="report-p-hz report-p-hz-block"/>'), 'Hazard, no entry'],
    [sw('<rect x="1" y="1" width="28" height="14" fill="url(#rpl-slope)" class="report-p-hz"/>'), 'Hazard, avoid'],
    [sw('<rect x="1" y="1" width="28" height="14" fill="url(#rpl-gas)" class="report-p-gas"/>'), 'Possible gas (concept sensor)'],
    [sw('<rect x="1" y="1" width="28" height="14" fill="url(#rpl-rubble)" class="report-p-rubble"/>'), 'Rubble or debris'],
    [sw('<rect x="1" y="1" width="28" height="14" class="report-p-room-clear report-p-thin"/>'), 'Room searched, no one detected'],
    [sw('<rect x="1" y="1" width="28" height="14" fill="url(#rpl-blocked)" class="report-p-room-blocked report-p-thin"/>'), 'Room blocked, not searched'],
    [sw('<circle cx="15" cy="8" r="6.500" class="report-p-person"/><circle cx="15" cy="8" r="7.600" class="report-p-sigma"/>'), 'Person located (dashed ring: position uncertainty)'],
    [sw('<path d="M15 1l7 7-7 7-7-7z" class="report-p-possible"/>'), 'Possible person, not confirmed'],
    [sw('<path d="M11 4l8 8M11 12l8-8" class="report-p-closed"/>'), 'Lead closed'],
    [sw('<line x1="1" y1="8" x2="26" y2="8" class="report-p-route" marker-end="url(#rpl-arrow)"/>'), 'Rescue route, direction of travel'],
    [sw('<path d="M9 2l12 12M9 14l12-12" class="report-p-breach"/><circle cx="15" cy="8" r="7" class="report-p-breach-ring"/>'), 'Break-through point'],
    [sw('<line x1="1" y1="8" x2="29" y2="8" class="report-p-trail"/><rect x="11" y="4" width="8" height="8" class="report-p-stop-done"/>'), 'Rover trail and listening stop'],
    [sw('<path d="M22 8L9 2.500V13.500Z" class="report-p-rover"/>'), 'Rover at report time'],
    [sw('<path d="M15 -1L24.500 14H5.500Z" class="report-p-hz-key" style="transform:scale(0.8) translate(4px,3px)"/>'), 'Hazard number, see the hazard key'],
  ];
}
