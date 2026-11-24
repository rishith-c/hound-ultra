// Timelines: a small tactical map of one world at one moment, drawn on a 2-D canvas from a branch's record.
// It draws only what that branch's console knew at that time. Ground truth appears only when opts.truth is on.
import { stateAt } from './model.js';

const VIEWS = { site: [-2, -2, 122, 92], building: [40, 25, 90, 63], approach: [14, 2, 100, 66], rescue: [14, 2, 112, 82] };
const AUTO = { standby: 'site', aerial: 'site', deploy: 'approach', search: 'building', assess: 'building', plan: 'rescue', rescue: 'rescue', complete: 'rescue' };
const rgba = (hex, a) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };

export function createMap(canvas, { world, kit, onPick, onPlace, onHover }) {
  const { SITE, ROOMS, WALLS, OBSTACLES, HAZARDS, STOPS, SENSORS, BUILDING } = world;
  let C = {}, W = 0, H = 0, g = null, o = { run: null, t: 0, other: null, truth: false, view: 'auto', placing: null, selected: null, tag: 'A' };
  let cam = VIEWS.site.slice(), camTo = VIEWS.site.slice(), hatch = null, mouse = null, dirty = true;
  function colours() {
    const v = (n) => kit.cssVar(n) || '#888';
    C = { bg0: v('--bg-0'), bg1: v('--bg-1'), bg2: v('--bg-2'), bg3: v('--bg-3'), bg4: v('--bg-4'), line: v('--line'), line2: v('--line-2'), line3: v('--line-3'), text: v('--text'), text2: v('--text-2'), text3: v('--text-3'), accent: v('--accent'), person: v('--person'), warn: v('--warn'), ok: v('--ok'), danger: v('--danger'), sim: v('--sim'), mono: v('--mono'), font: v('--font') };
    hatch = null; dirty = true;
  }
  colours();
  const stop = kit.fitCanvas(canvas, (c, w, h) => { g = c; W = w; H = h; dirty = true; draw(); });

  // ----- camera -----
  function fit(v) { // widen the view so the canvas aspect is filled
    let [x0, y0, x1, y1] = v; const a = W / Math.max(1, H), vw = x1 - x0, vh = y1 - y0;
    if (vw / vh < a) { const need = vh * a; x0 -= (need - vw) / 2; x1 += (need - vw) / 2; } else { const need = vw / a; y0 -= (need - vh) / 2; y1 += (need - vh) / 2; }
    return [x0, y0, x1, y1];
  }
  const scale = () => W / (cam[2] - cam[0]);
  const X = (x) => (x - cam[0]) * scale(), Y = (y) => (cam[3] - y) * scale();
  const toWorld = (px, py) => [cam[0] + px / scale(), cam[3] - py / scale()];
  function target(s) { const mode = o.view === 'auto' ? AUTO[s ? s.phase : 'standby'] : o.view; return fit(VIEWS[mode] || VIEWS.site); }

  // ----- drawing helpers -----
  function poly(pts, close = true) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); if (close) g.closePath(); }
  function label(text, x, y, { colour = C.text2, size = 10, align = 'left', mono = false, weight = 500, halo = true } = {}) {
    g.font = weight + ' ' + size + 'px ' + (mono ? C.mono : C.font); g.textAlign = align; g.textBaseline = 'middle';
    if (halo) { g.lineWidth = 3; g.strokeStyle = rgba(C.bg0, 0.85); g.lineJoin = 'round'; g.strokeText(text, x, y); }
    g.fillStyle = colour; g.fillText(text, x, y);
  }
  function hatchPattern() {
    if (hatch) return hatch;
    const c = document.createElement('canvas'); c.width = c.height = 8; const q = c.getContext('2d');
    q.strokeStyle = rgba(C.danger, 0.34); q.lineWidth = 1; q.beginPath(); q.moveTo(-2, 10); q.lineTo(10, -2); q.moveTo(-2, 2); q.lineTo(2, -2); q.moveTo(6, 10); q.lineTo(10, 6); q.stroke();
    return (hatch = g.createPattern(c, 'repeat'));
  }
  function rover(p, heading, { ghost = false, mode = 'idle' } = {}) {
    g.save(); g.translate(X(p[0]), Y(p[1])); g.rotate(-heading);
    const L = 13, Wd = 9;
    if (ghost) { g.setLineDash([2, 2]); g.strokeStyle = C.text3; g.lineWidth = 1; g.strokeRect(-L / 2, -Wd / 2, L, Wd); g.setLineDash([]); g.restore(); return; }
    g.fillStyle = C.bg0; g.fillRect(-L / 2 - 1.5, -Wd / 2 - 3, L + 3, Wd + 6);
    g.fillStyle = C.text3; for (const [wx, wy] of [[-L / 2 + 1, -Wd / 2 - 2], [L / 2 - 5, -Wd / 2 - 2], [-L / 2 + 1, Wd / 2], [L / 2 - 5, Wd / 2]]) g.fillRect(wx, wy, 4, 2);
    g.fillStyle = mode === 'fault' || mode === 'hold' ? C.text3 : C.text; g.fillRect(-L / 2, -Wd / 2, L, Wd);
    g.fillStyle = C.bg0; g.beginPath(); g.moveTo(L / 2 - 1.5, 0); g.lineTo(L / 2 - 5.5, -2.6); g.lineTo(L / 2 - 5.5, 2.6); g.closePath(); g.fill();
    g.restore();
  }
  function drone(p, alt, ghost) {
    const x = X(p[0]), y = Y(p[1]) - Math.min(8, alt * 0.25);
    g.save(); g.translate(x, y); g.strokeStyle = ghost ? C.text3 : C.text; g.lineWidth = 1.2; if (ghost) g.setLineDash([2, 2]);
    g.beginPath(); g.moveTo(-5, -5); g.lineTo(5, 5); g.moveTo(5, -5); g.lineTo(-5, 5); g.stroke();
    for (const [a, b] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) { g.beginPath(); g.arc(a, b, 2.6, 0, 7); g.stroke(); }
    g.restore();
  }
  function team(p, ghost) {
    const x = X(p[0]), y = Y(p[1]);
    if (ghost) { g.setLineDash([2, 2]); g.strokeStyle = C.text3; g.lineWidth = 1; g.beginPath(); g.arc(x, y, 5.5, 0, 7); g.stroke(); g.setLineDash([]); return; }
    g.fillStyle = C.bg0; g.beginPath(); g.arc(x, y, 7.5, 0, 7); g.fill();
    g.fillStyle = C.accent; g.beginPath(); g.arc(x, y, 5.5, 0, 7); g.fill();
    g.fillStyle = C.bg0; g.beginPath(); g.arc(x - 2, y, 1.4, 0, 7); g.arc(x + 2, y, 1.4, 0, 7); g.fill();
  }

  function draw() {
    if (!g || !W) return; dirty = false;
    const s = o.run ? stateAt(o.run, o.t) : null, k = scale();
    g.clearRect(0, 0, W, H); g.fillStyle = C.bg0; g.fillRect(0, 0, W, H);
    // grid: 10 m, and 2 m when zoomed in
    g.lineWidth = 1;
    for (const [step, col] of k > 7 ? [[2, rgba(C.line, 0.55)], [10, C.line2]] : [[10, C.line]]) {
      g.strokeStyle = col; g.beginPath();
      for (let x = Math.ceil(cam[0] / step) * step; x <= cam[2]; x += step) { const px = Math.round(X(x)) + 0.5; g.moveTo(px, 0); g.lineTo(px, H); }
      for (let y = Math.ceil(cam[1] / step) * step; y <= cam[3]; y += step) { const py = Math.round(Y(y)) + 0.5; g.moveTo(0, py); g.lineTo(W, py); }
      g.stroke();
    }
    // site edge
    g.strokeStyle = C.line3; g.setLineDash([6, 4]); g.strokeRect(X(0), Y(SITE.h), SITE.w * k, SITE.h * k); g.setLineDash([]);
    // drone survey so far
    if (s && s.scan > 0 && s.scan < 1) { g.fillStyle = rgba(C.text, 0.05); g.fillRect(X(s.drone.pos[0] - 1), Y(s.drone.pos[1] + 11), 2 * k, 22 * k); }
    // other buildings and rubble
    for (const ob of OBSTACLES) {
      poly(ob.poly);
      if (ob.kind === 'building') { g.fillStyle = C.bg2; g.fill(); g.strokeStyle = C.line3; g.lineWidth = 1; g.stroke(); const c = ob.poly.reduce((a, p) => [a[0] + p[0] / ob.poly.length, a[1] + p[1] / ob.poly.length], [0, 0]); if (k > 3) label(ob.name, X(c[0]), Y(c[1]), { colour: C.text3, align: 'center', halo: false }); }
      else if (ob.kind === 'rubble') { g.fillStyle = ob.passable ? rgba(C.text3, 0.1) : rgba(C.text3, 0.3); g.fill(); g.strokeStyle = rgba(C.text3, 0.7); g.lineWidth = 1; g.setLineDash(ob.passable ? [2, 3] : []); g.stroke(); g.setLineDash([]); }
    }
    // building B: floor, rooms with what the console knows about each
    const b = BUILDING.rect; g.fillStyle = C.bg1; g.fillRect(X(b[0]), Y(b[3]), (b[2] - b[0]) * k, (b[3] - b[1]) * k);
    for (const r of ROOMS) {
      const c = s && s.cov[r.id], x = X(r.rect[0]), y = Y(r.rect[3]), w = (r.rect[2] - r.rect[0]) * k, h = (r.rect[3] - r.rect[1]) * k;
      if (c && c.status === 'clear') { g.fillStyle = rgba(C.ok, 0.07); g.fillRect(x, y, w, h); }
      else if (c && c.status === 'lead') { g.fillStyle = rgba(C.warn, 0.1); g.fillRect(x, y, w, h); }
      else if (c && c.status === 'person') { g.fillStyle = rgba(C.person, 0.13); g.fillRect(x, y, w, h); }
      else if (c && c.status === 'blocked') { g.fillStyle = rgba(C.text3, 0.08); g.fillRect(x, y, w, h); }
      if (!r.corridor && k > 4.5) {
        label(r.id, x + 5, y + 9, { colour: C.text3, mono: true, halo: false });
        if (c && k > 6) { const word = c.status === 'clear' ? 'clear · ' + (c.residual * 100).toFixed(0) + ' % missed' : c.status === 'blocked' ? 'not searched' : c.status === 'lead' ? 'lead' : c.status === 'person' ? 'person' : ''; if (word) label(word, x + 5, y + h - 8, { colour: c.status === 'clear' ? C.ok : c.status === 'lead' ? C.warn : c.status === 'person' ? C.person : C.text3, size: 9.5, halo: false }); }
      }
    }
    // hazards known at this moment
    for (const hz of [...HAZARDS, ...(s ? s.hazards : [])]) {
      poly(hz.poly); g.fillStyle = hatchPattern(); g.fill(); g.strokeStyle = rgba(C.danger, hz.t != null ? 0.95 : 0.55); g.lineWidth = hz.t != null ? 1.5 : 1; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]);
      if (hz.t != null) { const c = hz.poly.reduce((a, p) => [a[0] + p[0] / hz.poly.length, a[1] + p[1] / hz.poly.length], [0, 0]); label('new hazard', X(c[0]), Y(c[1]) - (hz.poly[2][1] - hz.poly[0][1]) * k / 2 - 8, { colour: C.danger, align: 'center' }); }
    }
    if (o.placing && mouse) { const [mx, my] = toWorld(mouse[0], mouse[1]), sz = o.placing.size; g.strokeStyle = C.danger; g.lineWidth = 1.5; g.strokeRect(X(mx - sz / 2), Y(my + sz / 2), sz * k, sz * k); label(mx.toFixed(0) + ', ' + my.toFixed(0) + ' m', X(mx), Y(my + sz / 2) - 9, { colour: C.danger, align: 'center', mono: true }); }
    else if (o.placing && o.placing.c) { const [mx, my] = o.placing.c, sz = o.placing.size; g.strokeStyle = C.danger; g.lineWidth = 1.5; g.setLineDash([3, 3]); g.strokeRect(X(mx - sz / 2), Y(my + sz / 2), sz * k, sz * k); g.setLineDash([]); }
    // walls
    g.lineCap = 'butt';
    for (const w of WALLS) {
      g.beginPath(); g.moveTo(X(w.a[0]), Y(w.a[1])); g.lineTo(X(w.b[0]), Y(w.b[1]));
      if (w.state === 'collapsed') { g.strokeStyle = rgba(C.danger, 0.5); g.lineWidth = 1; g.setLineDash([1, 3]); }
      else if (w.state === 'damaged') { g.strokeStyle = C.text2; g.lineWidth = 1.5; g.setLineDash([5, 2]); }
      else { g.strokeStyle = w.mat === 'concrete' ? C.text2 : C.text3; g.lineWidth = w.mat === 'concrete' ? Math.max(2, k * 0.3) : Math.max(1, k * 0.14); }
      g.stroke(); g.setLineDash([]);
    }
    for (const ob of OBSTACLES) if (ob.kind === 'furniture') { poly(ob.poly); g.fillStyle = C.bg4; g.fill(); g.strokeStyle = C.line3; g.lineWidth = 1; g.stroke(); }
    if (!s) return;
    // listening stops
    if (k > 3.2) for (const st of STOPS) { const x = X(st.pos[0]), y = Y(st.pos[1]); g.strokeStyle = C.text3; g.lineWidth = 1; g.strokeRect(Math.round(x) - 3.5, Math.round(y) - 3.5, 7, 7); if (k > 6) label(st.id, x + 7, y - 7, { colour: C.text3, mono: true, size: 9.5 }); }
    // trails from the per-second record
    const f = o.run.frames, n = Math.min(f.n - 1, Math.floor(s.t));
    const trail = (arr, w, col, dash) => { g.beginPath(); let px = NaN, py = NaN; for (let i = 0; i <= n; i++) { const x = arr[i * w], y = arr[i * w + 1]; if (i === 0) g.moveTo(X(x), Y(y)); else if (x !== px || y !== py) g.lineTo(X(x), Y(y)); px = x; py = y; } g.strokeStyle = col; g.lineWidth = 1.25; g.setLineDash(dash); g.stroke(); g.setLineDash([]); };
    trail(f.drone, 3, rgba(C.text3, 0.45), [1, 4]); trail(f.rover, 5, rgba(C.text, 0.5), []); trail(f.team, 3, rgba(C.accent, 0.9), []);
    // rescue route
    if (s.route) {
      const planned = s.route.status === 'planned';
      for (const leg of s.route.legs) {
        if (!leg.ok) continue;
        poly(leg.path, false); g.strokeStyle = rgba(C.accent, planned ? 0.7 : 0.38); g.lineWidth = 2; g.setLineDash(planned ? [5, 4] : []); g.lineJoin = 'round'; g.stroke(); g.setLineDash([]);
        const a = leg.access, d = s.dets.find((x) => x.id === leg.det);
        if (!leg.reached && d) { g.beginPath(); g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(d.pos[0]), Y(d.pos[1])); g.strokeStyle = C.person; g.lineWidth = 1.5; g.setLineDash([2, 2]); g.stroke(); g.setLineDash([]); if (k > 5) label('break through ' + leg.gap.toFixed(1) + ' m', X(a[0]) + 6, Y(a[1]) + 12, { colour: C.person, size: 9.5 }); }
        g.fillStyle = C.accent; g.fillRect(X(a[0]) - 2.5, Y(a[1]) - 2.5, 5, 5);
      }
    }
    // listening ring
    if (s.listen >= 0) { const x = X(s.rover.pos[0]), y = Y(s.rover.pos[1]), r = SENSORS.csi.range * k; g.strokeStyle = rgba(C.text, 0.16); g.lineWidth = 1; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); g.strokeStyle = C.text; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + s.listen * Math.PI * 2); g.stroke(); }
    // ground truth, only behind the switch
    if (o.truth && o.run.truth) {
      for (const p of o.run.truth.people) { const x = X(p.pos[0]), y = Y(p.pos[1]); g.strokeStyle = C.sim; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5); g.moveTo(x + 5, y - 5); g.lineTo(x - 5, y + 5); g.stroke(); label(p.id + ' truth: ' + p.motion, x + 8, y + 10, { colour: C.sim, size: 9.5 }); }
      for (const d of o.run.truth.decoys) { const x = X(d.pos[0]), y = Y(d.pos[1]); g.strokeStyle = C.sim; g.lineWidth = 1; g.strokeRect(x - 3.5, y - 3.5, 7, 7); label('truth: ' + (d.kind === 'fan' ? 'fan' : 'hot pipe'), x + 8, y + 10, { colour: C.sim, size: 9.5 }); }
    }
    // the other world's units, where they are not in the same place
    if (o.other) {
      const q = stateAt(o.other, Math.min(o.t, o.other.endT)), far = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1]) > 0.75;
      const link = (a, c) => { g.strokeStyle = rgba(C.text3, 0.7); g.lineWidth = 1; g.setLineDash([1, 3]); g.beginPath(); g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(c[0]), Y(c[1])); g.stroke(); g.setLineDash([]); };
      if (far(q.rover.pos, s.rover.pos)) { link(q.rover.pos, s.rover.pos); rover(q.rover.pos, q.rover.heading, { ghost: true }); label('rover in ' + o.otherTag, X(q.rover.pos[0]) + 10, Y(q.rover.pos[1]) - 9, { colour: C.text3, size: 9.5 }); }
      if (far(q.team.pos, s.team.pos)) { link(q.team.pos, s.team.pos); team(q.team.pos, true); label('team in ' + o.otherTag, X(q.team.pos[0]) + 9, Y(q.team.pos[1]) - 9, { colour: C.text3, size: 9.5 }); }
    }
    // leads and people
    for (const d of s.dets) {
      if (Number.isNaN(d.pos[0])) continue;
      const x = X(d.pos[0]), y = Y(d.pos[1]), sel = o.selected === d.id, reached = s.reached.includes(d.id);
      if (d.status === 'rejected') { g.strokeStyle = rgba(C.ok, 0.8); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - 3.5, y - 3.5); g.lineTo(x + 3.5, y + 3.5); g.moveTo(x + 3.5, y - 3.5); g.lineTo(x - 3.5, y + 3.5); g.stroke(); if (k > 5 || sel) label(d.id + ' closed', x + 7, y - 8, { colour: C.ok, size: 9.5, mono: false }); }
      else {
        const col = d.status === 'confirmed' ? C.person : C.warn;
        if (d.sigma * k > 9) { g.strokeStyle = rgba(col, 0.35); g.lineWidth = 1; g.setLineDash([2, 3]); g.beginPath(); g.arc(x, y, d.sigma * k, 0, 7); g.stroke(); g.setLineDash([]); }
        g.fillStyle = C.bg0; g.beginPath(); g.arc(x, y, 8.5, 0, 7); g.fill();
        g.strokeStyle = rgba(col, 0.28); g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.stroke();
        g.strokeStyle = col; g.beginPath(); g.arc(x, y, 6.5, -Math.PI / 2, -Math.PI / 2 + d.p * Math.PI * 2); g.stroke();
        if (d.status === 'confirmed') { g.fillStyle = col; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
        if (reached) { g.strokeStyle = C.accent; g.lineWidth = 1.5; g.strokeRect(x - 10.5, y - 10.5, 21, 21); }
        label(d.id + ' ' + (d.p * 100).toFixed(0) + ' %' + (reached ? ' reached' : d.status === 'possible' && d.needsTeam ? ' team to check' : ''), x + 11, y - 9, { colour: col, mono: true, size: 10 });
      }
      if (sel) { g.strokeStyle = C.text; g.lineWidth = 1; g.strokeRect(Math.round(x) - 12.5, Math.round(y) - 12.5, 25, 25); }
    }
    // units
    if (s.drone.alt > 0.5) drone(s.drone.pos, s.drone.alt, false);
    team(s.team.pos, false); rover(s.rover.pos, s.rover.heading, { mode: s.rover.mode });
    if (k > 2.6) { label('HOUND-01', X(s.rover.pos[0]) + 11, Y(s.rover.pos[1]) + 11, { colour: C.text2, size: 9.5 }); label('Rescue team', X(s.team.pos[0]) + 10, Y(s.team.pos[1]) + 11, { colour: C.accent, size: 9.5 }); }
    // scale bar
    const bar = [5, 10, 20, 50].find((m) => m * k >= 44) || 50, bx = 12, by = H - 12;
    g.strokeStyle = C.text2; g.lineWidth = 1; g.beginPath(); g.moveTo(bx + 0.5, by - 4); g.lineTo(bx + 0.5, by + 0.5); g.lineTo(bx + bar * k + 0.5, by + 0.5); g.lineTo(bx + bar * k + 0.5, by - 4); g.stroke();
    label(bar + ' m', bx + bar * k + 6, by - 2, { colour: C.text2, mono: true, size: 9.5 });
  }

  // ----- pointer -----
  function at(ev) { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
  function nearest(px, py) { if (!o.run) return null; const s = stateAt(o.run, o.t); let best = null, bd = 14; for (const d of s.dets) { const dd = Math.hypot(X(d.pos[0]) - px, Y(d.pos[1]) - py); if (dd < bd) { bd = dd; best = d; } } return best; }
  const onMove = (ev) => { mouse = at(ev); const d = nearest(mouse[0], mouse[1]); canvas.style.cursor = o.placing ? 'crosshair' : d ? 'pointer' : 'default'; onHover?.(d, mouse); if (o.placing) draw(); };
  const onLeave = () => { mouse = null; onHover?.(null); if (o.placing) draw(); };
  const onClick = (ev) => { const [px, py] = at(ev); if (o.placing) { const w = toWorld(px, py); onPlace?.([Math.round(w[0] * 2) / 2, Math.round(w[1] * 2) / 2]); return; } const d = nearest(px, py); if (d) onPick?.(d.id); };
  canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerleave', onLeave); canvas.addEventListener('click', onClick);

  return {
    set(next) { Object.assign(o, next); const s = o.run ? stateAt(o.run, o.t) : null; camTo = target(s); dirty = true; },
    // Moves the camera toward its target. Returns true while it is still moving.
    tick(dt, instant) {
      let moving = false;
      for (let i = 0; i < 4; i++) { const d = camTo[i] - cam[i]; if (Math.abs(d) > 0.02) { cam[i] = instant ? camTo[i] : cam[i] + d * Math.min(1, dt * 5); moving = true; } else cam[i] = camTo[i]; }
      if (moving || dirty) draw();
      return moving;
    },
    draw, colours, dispose() { stop(); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave); canvas.removeEventListener('click', onClick); },
  };
}
