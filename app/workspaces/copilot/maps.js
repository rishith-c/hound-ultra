// Two small maps the copilot draws inside its answers, straight from ctx.world and ctx.sim.state:
// the floor plan of building B (what was searched) and the site (where the rescue route goes).
// Positions are metres, x east, y north; SVG y is flipped so north is up.
const NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v); }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const pts = (poly, fx, fy) => poly.map((p) => fx(p[0]).toFixed(2) + ',' + fy(p[1]).toFixed(2)).join(' ');
const STATUS_WORD = { clear: 'clear', lead: 'possible', person: 'person', blocked: 'blocked', unsearched: 'not searched' };

// Floor plan of building B. Rooms are coloured by search status and carry the chance someone was missed.
export function floorPlan(ctx, { onPick } = {}) {
  const w = ctx.world, S = ctx.sim.state, [x0, y0, x1, y1] = w.BUILDING.rect, pad = 1.2;
  const fx = (x) => x - x0 + pad, fy = (y) => y1 - y + pad, W = x1 - x0 + pad * 2, H = y1 - y0 + pad * 2;
  const svg = s('svg', { class: 'cop-plan', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Floor plan of building B: ' + Object.values(S.coverage).map((c) => 'room ' + c.room + ' ' + STATUS_WORD[c.status]).join(', ') });
  svg.append(s('defs', null, s('pattern', { id: 'cop-hatch', width: 1.2, height: 1.2, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('line', { x1: 0, y1: 0, x2: 0, y2: 1.2, class: 'cop-plan-hatch' }))));
  const labels = []; // drawn after the rubble so a room number is never hidden
  for (const r of w.ROOMS) {
    const c = S.coverage[r.id], [a, b, cx, d] = r.rect, st = r.corridor ? 'corridor' : c.status;
    const g = s('g', { class: 'cop-room ' + st, tabindex: r.corridor ? null : 0, role: r.corridor ? null : 'button', 'aria-label': r.corridor ? null : r.name + ': ' + STATUS_WORD[c.status] + (c.status === 'clear' ? ', ' + Math.round(c.residual * 100) + ' percent chance someone was missed' : ''),
      onclick: r.corridor ? null : () => onPick?.({ type: 'room', id: r.id }), onkeydown: r.corridor ? null : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.({ type: 'room', id: r.id }); } } });
    g.append(s('rect', { x: fx(a), y: fy(d), width: cx - a, height: d - b }));
    if (!r.corridor) {
      if (st === 'blocked' || st === 'unsearched') g.append(s('rect', { x: fx(a), y: fy(d), width: cx - a, height: d - b, fill: 'url(#cop-hatch)', class: 'cop-plan-over' }));
      labels.push(s('g', { class: 'cop-room ' + st, 'pointer-events': 'none', 'aria-hidden': 'true' }, s('text', { x: fx((a + cx) / 2), y: fy((b + d) / 2) - 0.5, class: 'cop-plan-id' }, r.id), s('text', { x: fx((a + cx) / 2), y: fy((b + d) / 2) + 1.9, class: 'cop-plan-note' }, st === 'clear' ? Math.round(c.residual * 100) + ' % missed' : STATUS_WORD[st])));
      g.append(s('title', null, r.name + ': ' + c.note));
    }
    svg.append(g);
  }
  for (const wl of w.WALLS) svg.append(s('line', { x1: fx(wl.a[0]), y1: fy(wl.a[1]), x2: fx(wl.b[0]), y2: fy(wl.b[1]), class: 'cop-wall ' + wl.mat + ' ' + wl.state }));
  for (const o of w.OBSTACLES) if (o.kind === 'rubble' && o.poly.some((p) => p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1)) svg.append(s('polygon', { points: pts(o.poly, fx, fy), class: 'cop-rubble' }, s('title', null, o.name)));
  for (const d of S.detections) if (d.pos && d.status !== 'rejected' && !d.outdoor) svg.append(s('circle', { cx: fx(d.pos[0]), cy: fy(d.pos[1]), r: 0.75, class: 'cop-dot ' + d.status }, s('title', null, d.id + ', ' + d.status)));
  svg.append(...labels);
  const rv = S.units['HOUND-01'];
  if (rv.pos[0] > x0 - pad && rv.pos[0] < x1 + pad && rv.pos[1] > y0 - pad && rv.pos[1] < y1 + pad) svg.append(s('rect', { x: fx(rv.pos[0]) - 0.55, y: fy(rv.pos[1]) - 0.55, width: 1.1, height: 1.1, class: 'cop-rover' }, s('title', null, 'HOUND-01')));
  return svg;
}

// The site with the rescue route: buildings, hazard zones, the route legs and their numbered stops.
export function siteMap(ctx, { route } = {}) {
  const w = ctx.world, S = ctx.sim.state, r = route || S.routes.rescue;
  const fx = (x) => x, fy = (y) => w.SITE.h - y;
  const svg = s('svg', { class: 'cop-site', viewBox: '14 8 100 76', role: 'img', 'aria-label': r ? 'Site map with the rescue route: ' + r.legs.filter((l) => l.ok).length + ' stops, ' + Math.round(r.length) + ' metres' : 'Site map' });
  svg.append(s('defs', null, s('pattern', { id: 'cop-hz', width: 2.4, height: 2.4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('line', { x1: 0, y1: 0, x2: 0, y2: 2.4, class: 'cop-site-hatch' }))));
  for (const o of w.OBSTACLES) svg.append(s('polygon', { points: pts(o.poly, fx, fy), class: 'cop-ob ' + o.kind }, s('title', null, o.name)));
  const [a, b, c, d] = w.BUILDING.rect;
  svg.append(s('rect', { x: fx(a), y: fy(d), width: c - a, height: d - b, class: 'cop-bldg' }));
  for (const wl of w.WALLS) if (wl.mat === 'drywall') svg.append(s('line', { x1: fx(wl.a[0]), y1: fy(wl.a[1]), x2: fx(wl.b[0]), y2: fy(wl.b[1]), class: 'cop-site-wall' }));
  for (const hz of [...w.HAZARDS, ...S.hazards]) svg.append(s('polygon', { points: pts(hz.poly, fx, fy), class: 'cop-hz' + (hz.block ? ' block' : ''), fill: 'url(#cop-hz)' }, s('title', null, hz.name + (hz.block ? ' (never crossed)' : ''))));
  svg.append(s('text', { x: fx(21), y: fy(72.5), class: 'cop-site-label' }, 'A'), s('text', { x: fx(46), y: fy(60), class: 'cop-site-label' }, 'B'), s('text', { x: fx(102), y: fy(48), class: 'cop-site-label' }, 'C'));
  if (r) {
    for (const leg of r.legs) if (leg.ok) svg.append(s('polyline', { points: pts(leg.path, fx, fy), class: 'cop-route' + (r.status === 'planned' ? ' planned' : '') }));
    r.legs.forEach((leg, i) => { if (!leg.ok) return; const p = leg.access; svg.append(s('g', { class: 'cop-stop' + (leg.kind === 'break through' ? ' breach' : '') }, s('circle', { cx: fx(p[0]), cy: fy(p[1]), r: 2.6 }), s('text', { x: fx(p[0]), y: fy(p[1]) + 1.15 }, i + 1), s('title', null, 'Stop ' + (i + 1) + ': ' + leg.det + ', ' + leg.kind))); });
  }
  const st = w.SITE.staging; svg.append(s('g', { class: 'cop-staging' }, s('rect', { x: fx(st[0]) - 1.6, y: fy(st[1]) - 1.6, width: 3.2, height: 3.2 }), s('text', { x: fx(st[0]) + 3, y: fy(st[1]) + 1.1 }, 'Staging')));
  const team = S.units['TEAM-1']; svg.append(s('circle', { cx: fx(team.pos[0]), cy: fy(team.pos[1]), r: 1.3, class: 'cop-team' }, s('title', null, 'Rescue team 1')));
  return svg;
}
