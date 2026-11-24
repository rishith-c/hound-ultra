// The probability map: building B from above. Every room shows the chance someone is there or was missed, with the
// cells the sensors actually reached; every lead shows where it is and how uncertain that position is.
import { PRIOR } from '../../core/fusion.js';
import { tokens, rgba, clamp, pct, roundRect, STATUS, whereOf } from './util.js';

const VIEW = { x0: 42.4, y0: 28.2, x1: 85.6, y1: 59.8 };       // building B with a margin, metres
const FIELD = { x0: 86.5, y0: 60.5, x1: 108.5, y1: 78.5 };     // the debris field outdoors (inset)
const ROOM_COLOR = { unsearched: 'text3', clear: 'ok', lead: 'warn', person: 'person', blocked: 'danger' };
const ROOM_WORD = { unsearched: 'not searched', clear: 'chance missed', lead: 'possible person', person: 'person found', blocked: 'not searched' };

export function createMap(host, ctx, api) {
  const { h, fmt } = ctx.kit, W = ctx.world;
  const canvas = h('canvas.fusion-map-canvas', { tabIndex: 0, role: 'img', 'aria-label': 'Probability map of building B. Use the left and right arrow keys to step through leads and rooms.' });
  const tip = h('div.fusion-tip.glass', { hidden: true });
  const legend = h('div.fusion-map-legend', null,
    ...[['ok', 'Searched, no lead'], ['warn', 'Possible person'], ['person', 'Person found'], ['text3', 'Not searched: 10 % prior']].map(([c, t]) => h('span', null, h('i', { 'data-c': c }), t)),
    h('span', null, h('i.is-cell'), 'Lit squares: reached by the sensors (1 m)'), h('span', null, h('i.is-ring'), 'Ring: 86 % of a lead’s position (2σ)'));
  const live = h('span.dim.fusion-map-live');
  const panel = ctx.kit.panel('Probability map: where a person may be, or was missed', { flush: true, actions: [live] }, h('div.fusion-map-wrap', null, canvas, legend, tip));
  panel.classList.add('fusion-map');
  host.append(panel);

  let size = { w: 0, h: 0 }, isDirty = true, hover = null, main = null, inset = null, cursor = -1;
  const reachCache = new Map();
  ctx.kit.fitCanvas(canvas, (c, w, hh) => { size = { w, h: hh }; isDirty = true; draw(ctx.sim.state, performance.now()); });

  function layout() {
    const pad = 12, sideW = clamp(size.w * 0.27, 150, 200);
    const aw = size.w - pad * 2 - sideW - 10, ah = size.h - pad * 2;
    const s = Math.min(aw / (VIEW.x1 - VIEW.x0), ah / (VIEW.y1 - VIEW.y0));
    const ox = pad + (aw - s * (VIEW.x1 - VIEW.x0)) / 2, oy = pad + (ah - s * (VIEW.y1 - VIEW.y0)) / 2;
    main = { s, X: (x) => ox + (x - VIEW.x0) * s, Y: (y) => oy + (VIEW.y1 - y) * s, rect: [ox, oy, s * (VIEW.x1 - VIEW.x0), s * (VIEW.y1 - VIEW.y0)] };
    const ix = size.w - pad - sideW, iw = sideW, ih = Math.min(ah * 0.46, iw * 0.82), is = Math.min(iw / (FIELD.x1 - FIELD.x0), (ih - 18) / (FIELD.y1 - FIELD.y0));
    inset = { s: is, X: (x) => ix + (iw - is * (FIELD.x1 - FIELD.x0)) / 2 + (x - FIELD.x0) * is, Y: (y) => pad + 18 + (FIELD.y1 - y) * is, rect: [ix, pad, iw, ih] };
    legend.style.width = sideW + 'px'; legend.style.top = pad + ih + 10 + 'px';
  }
  function reachCells(roomId, stopId) {
    const k = roomId + '|' + stopId; if (reachCache.has(k)) return reachCache.get(k);
    const r = W.roomById(roomId), stop = W.STOPS.find((s) => s.id === stopId), cells = [];
    if (r && stop) for (let y = r.rect[1] + 0.5; y < r.rect[3]; y++) for (let x = r.rect[0] + 0.5; x < r.rect[2]; x++) {
      cells.push([x, y, Math.hypot(stop.pos[0] - x, stop.pos[1] - y) <= W.SENSORS.csi.range && W.wallsCrossed(stop.pos, [x, y]).length <= W.SENSORS.csi.maxWalls]);
    }
    reachCache.set(k, cells); return cells;
  }
  // What a room shows. The coverage record is written when the room is searched; if a lead in the room has moved since
  // (a second look), the lead's current number is the truth, so use it.
  function roomView(S, id) {
    const cov = S.coverage[id] || { status: 'unsearched', residual: PRIOR, reach: 0, note: 'Not searched yet.' };
    const lead = S.detections.find((d) => d.room === id && (d.status === 'confirmed' || d.status === 'possible'));
    if (lead) return { ...cov, status: lead.status === 'confirmed' ? 'person' : 'lead', residual: lead.p, note: lead.status === 'confirmed' ? 'A person was found here (lead ' + lead.id + ').' : 'A possible person is being checked (lead ' + lead.id + ').' };
    if (cov.status === 'lead' || cov.status === 'person') return { ...cov, status: 'clear', note: 'The lead here was closed.' };
    return cov;
  }
  const inField = (p) => p[0] > VIEW.x1 || p[1] > VIEW.y1 || p[0] < VIEW.x0 || p[1] < VIEW.y0;
  const vp = (p) => (inField(p) ? inset : main);

  function items(S) {
    return [...S.detections.filter((d) => d.pos).map((d) => ({ type: 'detection', id: d.id })), ...W.ROOMS.filter((r) => !r.corridor).map((r) => ({ type: 'room', id: r.id }))];
  }
  function hit(S, mx, my) {
    let best = null, bd = Infinity;
    for (const d of S.detections) {
      if (!d.pos) continue; const v = vp(d.pos), dx = v.X(d.pos[0]) - mx, dy = v.Y(d.pos[1]) - my, dd = Math.hypot(dx, dy);
      if (dd < Math.max(12, Math.min(2 * (d.posSigma || 0.3) * v.s, 26)) && dd < bd) { bd = dd; best = { type: 'detection', id: d.id }; }
    }
    if (best) return best;
    for (const r of W.ROOMS) { if (r.corridor) continue; if (mx >= main.X(r.rect[0]) && mx <= main.X(r.rect[2]) && my >= main.Y(r.rect[3]) && my <= main.Y(r.rect[1])) return { type: 'room', id: r.id }; }
    return null;
  }
  const same = (a, b) => !!a && !!b && a.type === b.type && a.id === b.id;

  function poly(c, v, pts) { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(v.X(p[0]), v.Y(p[1])) : c.moveTo(v.X(p[0]), v.Y(p[1])))); c.closePath(); }
  function hatch(c, v, pts, color, gap = 6) {
    c.save(); poly(c, v, pts); c.clip();
    const xs = pts.map((p) => v.X(p[0])), ys = pts.map((p) => v.Y(p[1])), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    c.strokeStyle = color; c.lineWidth = 1; c.beginPath();
    for (let x = x0 - (y1 - y0); x < x1; x += gap) { c.moveTo(x, y1); c.lineTo(x + (y1 - y0), y0); }
    c.stroke(); c.restore();
  }

  function draw(S, now) {
    if (!size.w) return;
    const c = canvas.getContext('2d'), T = tokens(), reduced = ctx.kit.reducedMotion();
    layout();
    c.clearRect(0, 0, size.w, size.h);
    const v = main, sel = ctx.selection, subj = api.subject();
    const selDet = subj.type === 'detection' ? subj.det.id : null, selRoom = subj.type === 'room' ? subj.room.id : null;
    const font = (w, px, mono) => (c.font = w + ' ' + px + 'px ' + (mono ? T.mono : T.font));

    // ground and floor slab
    const B = W.BUILDING.rect;
    c.fillStyle = T.bg1; roundRect(c, v.rect[0], v.rect[1], v.rect[2], v.rect[3], 6); c.fill();
    c.fillStyle = T.bg2; c.fillRect(v.X(B[0]), v.Y(B[3]), (B[2] - B[0]) * v.s, (B[3] - B[1]) * v.s);

    // rooms
    for (const r of W.ROOMS) {
      const x = v.X(r.rect[0]), y = v.Y(r.rect[3]), w = (r.rect[2] - r.rect[0]) * v.s, hh = (r.rect[3] - r.rect[1]) * v.s;
      if (r.corridor) continue;
      const cov = roomView(S, r.id), col = T[ROOM_COLOR[cov.status]];
      const strong = cov.status === 'person' ? 0.13 : cov.status === 'lead' ? 0.1 : cov.status === 'clear' ? 0.03 : 0.0;
      c.fillStyle = rgba(col, strong); c.fillRect(x, y, w, hh);
      if (cov.stop && cov.reach > 0) {
        const cs = v.s;
        for (const [cx, cy, on] of reachCells(r.id, cov.stop)) {
          const px = v.X(cx - 0.5), py = v.Y(cy + 0.5);
          if (on) { c.fillStyle = rgba(col, 0.1); c.fillRect(px + 0.5, py + 0.5, cs - 1, cs - 1); }
          else { c.fillStyle = rgba(T.text3, 0.3); c.fillRect(px + cs / 2 - 0.75, py + cs / 2 - 0.75, 1.5, 1.5); }
        }
      } else {
        for (let cy = r.rect[1] + 0.5; cy < r.rect[3]; cy++) for (let cx = r.rect[0] + 0.5; cx < r.rect[2]; cx++) { c.fillStyle = rgba(T.text3, 0.3); c.fillRect(v.X(cx) - 0.75, v.Y(cy) - 0.75, 1.5, 1.5); }
        if (cov.status === 'blocked') hatch(c, v, [[r.rect[0], r.rect[1]], [r.rect[2], r.rect[1]], [r.rect[2], r.rect[3]], [r.rect[0], r.rect[3]]], rgba(T.danger, 0.16), 9);
      }
    }
    // hazards (outline only) and things in the way
    for (const hz of [...W.HAZARDS, ...S.hazards]) { c.setLineDash([3, 4]); c.strokeStyle = rgba(T.danger, 0.4); c.lineWidth = 1; poly(c, v, hz.poly); c.save(); c.beginPath(); c.rect(...v.rect); c.clip(); poly(c, v, hz.poly); c.stroke(); c.restore(); c.setLineDash([]); }
    for (const o of W.OBSTACLES) {
      if (o.kind === 'building') continue;
      c.save(); c.beginPath(); c.rect(...v.rect); c.clip();
      poly(c, v, o.poly); c.fillStyle = o.kind === 'rubble' ? rgba(T.text3, 0.2) : rgba(T.text3, 0.3); c.fill();
      if (o.kind === 'rubble') hatch(c, v, o.poly, rgba(T.text2, 0.3), 5);
      c.restore();
    }
    // walls
    c.lineCap = 'butt';
    for (const wl of W.WALLS) {
      c.beginPath(); c.moveTo(v.X(wl.a[0]), v.Y(wl.a[1])); c.lineTo(v.X(wl.b[0]), v.Y(wl.b[1]));
      c.lineWidth = wl.mat === 'concrete' ? 3.2 : 1.8; c.strokeStyle = wl.mat === 'concrete' ? T.text2 : rgba(T.text2, 0.75);
      if (wl.state === 'collapsed') { c.setLineDash([2, 5]); c.strokeStyle = rgba(T.danger, 0.8); } else if (wl.state === 'damaged') c.setLineDash([7, 3]);
      c.stroke(); c.setLineDash([]);
    }
    // stops and the rover's track
    const rover = S.units['HOUND-01'];
    if (rover.trail.length > 1) {
      c.save(); c.beginPath(); c.rect(...v.rect); c.clip();
      c.beginPath(); rover.trail.forEach((p, i) => (i ? c.lineTo(v.X(p[0]), v.Y(p[1])) : c.moveTo(v.X(p[0]), v.Y(p[1])))); c.lineTo(v.X(rover.pos[0]), v.Y(rover.pos[1]));
      c.strokeStyle = rgba(T.accent, 0.45); c.lineWidth = 1.2; c.setLineDash([1, 4]); c.lineCap = 'round'; c.stroke(); c.setLineDash([]); c.restore();
    }
    for (const st of W.STOPS) {
      const x = v.X(st.pos[0]), y = v.Y(st.pos[1]), done = st.covers.some((id) => S.coverage[id]?.stop === st.id);
      c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.fillStyle = done ? T.accent : T.bg2; c.strokeStyle = T.accent; c.lineWidth = 1.2; c.fillRect(-3, -3, 6, 6); c.strokeRect(-3, -3, 6, 6); c.restore();
      font(600, 10, true); c.fillStyle = rgba(T.accent, 0.95); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(st.id, x + 7, y + 0.5);
    }
    // room numbers
    for (const r of W.ROOMS) {
      if (r.corridor) continue;
      const cov = roomView(S, r.id), col = T[ROOM_COLOR[cov.status]];
      const x = v.X(r.rect[0]) + 8, north = r.rect[1] >= 46, y = north ? v.Y(r.rect[3]) + 8 : v.Y(r.rect[1]) - 54;
      c.textAlign = 'left'; c.textBaseline = 'top';
      font(500, 10.5, false); c.fillStyle = T.text3; c.fillText(r.id, x, y);
      font(600, v.s > 8.5 ? 19 : 16, true); c.fillStyle = cov.status === 'unsearched' || cov.status === 'blocked' ? T.text2 : col; c.fillText(pct(cov.residual), x, y + 12);
      font(500, v.s > 8.5 ? 10.5 : 10, false); c.fillStyle = T.text2; c.fillText(ROOM_WORD[cov.status], x, y + 33);
      const isSel = selRoom === r.id || (sel?.type === 'room' && sel.id === r.id), isHover = hover?.type === 'room' && hover.id === r.id;
      if (isSel || isHover) { c.strokeStyle = isSel ? T.accent : rgba(T.text, 0.5); c.lineWidth = isSel ? 2 : 1; c.strokeRect(v.X(r.rect[0]) + 3, v.Y(r.rect[3]) + 3, (r.rect[2] - r.rect[0]) * v.s - 6, (r.rect[3] - r.rect[1]) * v.s - 6); }
    }
    // the rover
    if (!inField(rover.pos) && rover.pos[0] > VIEW.x0) {
      const x = v.X(rover.pos[0]), y = v.Y(rover.pos[1]);
      if (S.sensors.listen) {
        const R = W.SENSORS.csi.range * v.s, ph = reduced ? 0.5 : (now / 1600) % 1;
        c.save(); c.beginPath(); c.rect(...v.rect); c.clip();
        c.strokeStyle = rgba(T.accent, 0.55); c.lineWidth = 1; c.setLineDash([4, 4]); c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
        c.strokeStyle = rgba(T.accent, 0.5 * (1 - ph)); c.beginPath(); c.arc(x, y, R * ph, 0, Math.PI * 2); c.stroke();
        c.restore();
      }
      c.save(); c.translate(x, y); c.rotate(-rover.heading);
      c.fillStyle = T.text; roundRect(c, -5.5, -4, 11, 8, 2); c.fill(); c.fillStyle = T.accent; c.beginPath(); c.moveTo(8.5, 0); c.lineTo(4, -3); c.lineTo(4, 3); c.closePath(); c.fill(); c.restore();
    }
    // inset: the debris field
    {
      const [ix, iy, iw, ih] = inset.rect;
      c.fillStyle = T.bg1; roundRect(c, ix, iy, iw, ih, 6); c.fill(); c.strokeStyle = T.line; c.lineWidth = 1; c.stroke();
      font(500, 10.5, false); c.fillStyle = T.text2; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('Outdoors: debris field', ix + 8, iy + 6);
      c.save(); roundRect(c, ix, iy + 18, iw, ih - 18, 6); c.clip();
      const f = W.OBSTACLES.find((o) => o.id === 'rubble-field');
      if (f) { poly(c, inset, f.poly); c.fillStyle = rgba(T.text3, 0.16); c.fill(); hatch(c, inset, f.poly, rgba(T.text2, 0.22), 5); }
      for (const sw of S.map.swaths) { const y = inset.Y(sw.y); c.strokeStyle = rgba(T.text, 0.18); c.setLineDash([2, 3]); c.beginPath(); c.moveTo(inset.X(sw.x0), y); c.lineTo(inset.X(sw.x1), y); c.stroke(); c.setLineDash([]); }
      c.restore();
      if (!S.detections.some((d) => d.pos && inField(d.pos))) { font(400, 10.5, false); c.fillStyle = T.text3; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(S.map.scan >= 1 ? 'no lead here' : 'drone survey ' + (S.map.scan * 100).toFixed(0) + ' %', ix + iw / 2, iy + ih - 6); }
    }
    // leads
    const taken = W.ROOMS.filter((r) => !r.corridor).map((r) => { const north = r.rect[1] >= 46; return [v.X(r.rect[0]) + 4, north ? v.Y(r.rect[3]) + 4 : v.Y(r.rect[1]) - 58, Math.min(86, (r.rect[2] - r.rect[0]) * v.s - 8), 54]; });
    const hits = (a) => taken.some((b) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1]);
    const dets = S.detections.filter((d) => d.pos).sort((a, b) => (a.id === selDet) - (b.id === selDet));
    for (const d of dets) {
      const w = vp(d.pos), x = w.X(d.pos[0]), y = w.Y(d.pos[1]), st = STATUS[d.status] || STATUS.new, col = T[st.color], sg = (d.posSigma || 0.3) * w.s;
      const isSel = selDet === d.id, isHover = hover?.type === 'detection' && hover.id === d.id;
      c.save(); c.beginPath(); c.rect(...w.rect); c.clip();
      if (d.status !== 'rejected') {
        const g = c.createRadialGradient(x, y, 0, x, y, sg * 2.6);
        g.addColorStop(0, rgba(col, 0.5 * clamp(d.p + 0.25, 0.3, 1))); g.addColorStop(0.45, rgba(col, 0.16)); g.addColorStop(1, rgba(col, 0));
        c.fillStyle = g; c.beginPath(); c.arc(x, y, sg * 2.6, 0, Math.PI * 2); c.fill();
      }
      c.strokeStyle = rgba(col, d.status === 'rejected' ? 0.5 : 0.9); c.lineWidth = 1; c.setLineDash([3, 3]); c.beginPath(); c.arc(x, y, Math.max(6, sg * 2), 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      c.restore();
      if (d.status === 'confirmed') { c.fillStyle = col; c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill(); c.fillStyle = T.bg0; c.beginPath(); c.arc(x, y, 1.8, 0, Math.PI * 2); c.fill(); }
      else if (d.status === 'possible') { c.fillStyle = T.bg0; c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 4.5, 0, Math.PI * 2); c.fill(); c.stroke(); }
      else { c.strokeStyle = T.text2; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x - 3.5, y - 3.5); c.lineTo(x + 3.5, y + 3.5); c.moveTo(x + 3.5, y - 3.5); c.lineTo(x - 3.5, y + 3.5); c.stroke(); }
      if (isSel || isHover) { const R = Math.max(10, sg * 2 + 4); c.strokeStyle = isSel ? T.accent : rgba(T.text, 0.6); c.lineWidth = 1.5; for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(x, y, R, k * Math.PI / 2 + 0.35, k * Math.PI / 2 + Math.PI / 2 - 0.35); c.stroke(); } }
      // label
      const txt = d.id + '  ' + pct(d.p); font(600, 10.5, true);
      const tw = c.measureText(txt).width + 12;
      let lx = x + 10, ly = y + 7;
      for (const [ax, ay] of [[x + 10, y + 7], [x + 10, y - 24], [x - 10 - tw, y + 7], [x - 10 - tw, y - 24], [x - tw / 2, y + 14], [x - tw / 2, y - 31], [x + 10, y - 44], [x - 10 - tw, y - 44], [x - tw / 2, y - 52], [x + 10, y + 26]]) { if (ax > w.rect[0] + 2 && ax + tw < w.rect[0] + w.rect[2] - 2 && ay > w.rect[1] + 2 && ay + 17 < w.rect[1] + w.rect[3] - 2 && !hits([ax, ay, tw, 17])) { lx = ax; ly = ay; break; } }
      taken.push([lx, ly, tw, 17]);
      c.fillStyle = rgba(T.bg0, 0.86); roundRect(c, lx, ly, tw, 17, 4); c.fill(); c.strokeStyle = rgba(col, 0.7); c.lineWidth = 1; c.stroke();
      c.fillStyle = d.status === 'rejected' ? T.text2 : T.text; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(txt, lx + 6, ly + 9);
    }
    // compass and scale
    {
      const [rx, ry, rw, rh] = v.rect, len = 5 * v.s, x = rx + 10, y = ry + rh - 10;
      c.strokeStyle = T.text3; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y - 3); c.lineTo(x, y); c.lineTo(x + len, y); c.lineTo(x + len, y - 3); c.stroke();
      font(500, 10, true); c.fillStyle = T.text3; c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText('5 m', x + len + 5, y + 3);
      c.textAlign = 'center'; c.fillText('N', rx + rw - 12, ry + rh - 6); c.beginPath(); c.moveTo(rx + rw - 12, ry + rh - 26); c.lineTo(rx + rw - 15.5, ry + rh - 19); c.lineTo(rx + rw - 8.5, ry + rh - 19); c.closePath(); c.fillStyle = T.text3; c.fill();
    }
    const cleared = Object.keys(S.coverage).filter((id) => roomView(S, id).status === 'clear').length, total = Object.keys(S.coverage).length;
    live.textContent = cleared + ' of ' + total + ' rooms searched, no lead';
  }

  function showTip(S, it, mx, my) {
    if (!it) { tip.hidden = true; return; }
    let title, lines;
    if (it.type === 'room') {
      const r = W.roomById(it.id), cov = roomView(S, it.id);
      title = r.name; lines = [pct(cov.residual) + ' ' + (cov.status === 'clear' ? 'chance someone was missed' : cov.status === 'lead' || cov.status === 'person' ? 'chance a person is here' : 'prior, nothing measured (assumed)'), cov.note, 'Click to see how this number was reached.'];
    } else {
      const d = S.detections.find((x) => x.id === it.id); if (!d) { tip.hidden = true; return; }
      title = 'Lead ' + d.id + ': ' + (STATUS[d.status]?.label || '') + ', ' + pct(d.p);
      lines = [whereOf(d) + ', position known to about ' + (2 * (d.posSigma || 0)).toFixed(1) + ' m (2σ)', d.reason, 'Click to open its evidence ledger.'];
    }
    tip.replaceChildren(h('b', null, title), ...lines.filter(Boolean).map((t) => h('p', null, t)));
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = clamp(mx + 14, 6, size.w - tw - 6) + 'px'; tip.style.top = clamp(my + 14, 6, size.h - th - 6) + 'px';
  }
  canvas.addEventListener('mousemove', (e) => {
    if (!main) return; const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, S = ctx.sim.state, it = hit(S, mx, my);
    if (!same(it, hover)) { hover = it; isDirty = true; }
    canvas.style.cursor = it ? 'pointer' : 'default'; showTip(S, it, mx, my);
  });
  canvas.addEventListener('mouseleave', () => { hover = null; tip.hidden = true; isDirty = true; });
  canvas.addEventListener('click', (e) => {
    if (!main) return; const r = canvas.getBoundingClientRect(), it = hit(ctx.sim.state, e.clientX - r.left, e.clientY - r.top);
    if (it) api.pick(it);
  });
  canvas.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0; if (!step) return;
    e.preventDefault(); const list = items(ctx.sim.state); if (!list.length) return;
    cursor = (cursor + step + list.length) % list.length; api.pick(list[cursor]);
  });

  return {
    dirty() { isDirty = true; },
    hide() { tip.hidden = true; },
    frame(S, now) {
      const anim = !!S.sensors.listen && !ctx.kit.reducedMotion();
      if (!isDirty && !anim) return; isDirty = false;
      draw(S, now);
    },
  };
}
