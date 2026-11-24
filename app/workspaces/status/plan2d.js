// A small, exact plan of the site: walls, debris, hazards, units, the route being driven. Drawn from a mission state.
export function drawPlan(c, w, h, { world, S, css, view = [38, 4, 92, 62], path = null, mark = null }) {
  const s = Math.min(w / (view[2] - view[0]), h / (view[3] - view[1])), ox = (w - s * (view[2] - view[0])) / 2, oy = (h - s * (view[3] - view[1])) / 2;
  const X = (x) => ox + (x - view[0]) * s, Y = (y) => h - oy - (y - view[1]) * s, poly = (p) => { c.beginPath(); p.forEach((q, i) => (i ? c.lineTo(X(q[0]), Y(q[1])) : c.moveTo(X(q[0]), Y(q[1])))); };
  c.clearRect(0, 0, w, h); c.save(); c.beginPath(); c.rect(0, 0, w, h); c.clip();
  c.strokeStyle = css('--line'); c.lineWidth = 1; c.beginPath(); for (let x = 0; x <= 120; x += 10) { c.moveTo(X(x), 0); c.lineTo(X(x), h); } for (let y = 0; y <= 90; y += 10) { c.moveTo(0, Y(y)); c.lineTo(w, Y(y)); } c.globalAlpha = 0.6; c.stroke(); c.globalAlpha = 1;
  for (const z of world.HAZARDS.filter((z) => z.block || z.kind === 'slope')) { poly(z.poly); c.closePath(); c.fillStyle = css('--danger-soft'); c.globalAlpha = z.block ? 0.8 : 0.35; c.fill(); c.globalAlpha = 1; }
  for (const o of world.OBSTACLES) { if (o.passable) continue; poly(o.poly); c.closePath(); c.fillStyle = css('--bg-5'); c.fill(); }
  c.strokeStyle = css('--text-3'); c.lineWidth = Math.max(1.2, s * 0.14); c.beginPath(); for (const k of world.WALLS) { if (k.state === 'collapsed') continue; c.moveTo(X(k.a[0]), Y(k.a[1])); c.lineTo(X(k.b[0]), Y(k.b[1])); } c.stroke();
  if (s > 5) { c.fillStyle = css('--text-3'); c.font = '500 11px ' + css('--mono'); c.textAlign = 'center'; for (const r of world.ROOMS) if (!r.corridor) c.fillText(r.id, X((r.rect[0] + r.rect[2]) / 2), Y((r.rect[1] + r.rect[3]) / 2) + 4); }
  if (S) {
    for (const z of S.hazards) { poly(z.poly); c.closePath(); c.fillStyle = css('--danger-soft'); c.fill(); c.strokeStyle = css('--danger'); c.lineWidth = 1.5; c.stroke(); }
    const u = S.units['HOUND-01'], tm = S.units['TEAM-1'];
    c.strokeStyle = css('--text-3'); c.globalAlpha = 0.55; c.lineWidth = 1.2; poly(u.trail); c.stroke(); c.globalAlpha = 1;
    for (const q of [u.path, tm.path]) if (q) { c.strokeStyle = css('--accent'); c.lineWidth = 2; c.setLineDash([6, 4]); poly(q); c.stroke(); c.setLineDash([]); }
    for (const d of S.detections) if (d.pos && d.status !== 'rejected') { c.beginPath(); c.arc(X(d.pos[0]), Y(d.pos[1]), 5, 0, 7); c.fillStyle = d.status === 'confirmed' ? css('--person') : css('--warn'); c.fill(); }
    for (const [q, col, name] of [[tm, '--text-2', 'Team'], [u, '--text', 'HOUND-01']]) { c.save(); c.translate(X(q.pos[0]), Y(q.pos[1])); c.save(); c.rotate(-q.heading); c.fillStyle = css(col); c.beginPath(); c.moveTo(9, 0); c.lineTo(-6, 5.5); c.lineTo(-3.5, 0); c.lineTo(-6, -5.5); c.closePath(); c.fill(); c.restore(); if (['fault', 'hold', 'swap'].includes(q.mode)) { c.strokeStyle = css('--warn'); c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, 13, 0, 7); c.stroke(); } c.fillStyle = css(col); c.font = '500 11px ' + css('--font'); c.textAlign = 'left'; c.fillText(name, 13, -9); c.restore(); }
  }
  if (path) { c.strokeStyle = css('--accent'); c.lineWidth = 2; c.lineJoin = 'round'; poly(path); c.stroke(); for (const [p, r] of [[path[0], 3.5], [path[path.length - 1], 5]]) { c.beginPath(); c.arc(X(p[0]), Y(p[1]), r, 0, 7); c.fillStyle = css('--accent'); c.fill(); } }
  c.restore();
}
