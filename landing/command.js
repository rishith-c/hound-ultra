// HOUND Command, live on the landing page. The real simulator (app/core/sim.js) runs the scripted mission with the
// real network, planner and fusion code. It is drawn by the console's 3-D twin when that is available, and always
// as a plan view (the main picture when there is no twin, a small map beside it when there is).
import { createBus } from '../app/core/bus.js';
import { createSim, PHASES, PHASE_INFO, FAULTS, COMMANDS } from '../app/core/sim.js';
import world from '../app/core/world.js';
import * as kit from '../app/ui/kit.js';
import { reduced, el, getNN, fmtClock, clamp } from './shared.js';
import { CONFIG } from './config.js';

const $ = (s) => document.querySelector(s);
const C = { ink: '#e9edf2', t2: '#a8b2bf', t3: '#74808e', line: 'rgba(233,237,242,0.10)', line2: 'rgba(233,237,242,0.22)', person: '#ff6a45', warn: '#ffb224', ok: '#41d6a0', danger: '#ff4d5e', accent: '#5aa9ff', bg: '#090b0e' };
const MONO = '11px "Geist Mono", "Geist Mono", ui-monospace, Menlo, monospace', SANS = '11.5px "Instrument Sans", system-ui, sans-serif';

export async function startCommand() {
  const stage = $('#cmd-stage'), plan = $('#cmd-plan'), twinHost = $('#cmd-twin');
  const ui = { phase: $('#cmd-phase'), clock: $('#cmd-clock'), hint: $('#cmd-hint'), phases: $('#cmd-phases'), finds: $('#cmd-finds'), count: $('#cmd-count'), rooms: $('#cmd-rooms'), coverNote: $('#cmd-cover-note'), log: $('#cmd-log'), play: $('#cmd-play'), reset: $('#cmd-reset'), speed: $('#cmd-speed'), view: $('#cmd-view') };
  let nn;
  try { nn = await getNN(); }
  catch (e) { ui.phase.textContent = 'Not running'; ui.hint.textContent = 'The network file did not load, so the mission cannot run here. Open the console to try again.'; return; }

  const bus = createBus();
  const sim = createSim({ bus, nn });
  const prefs = { contrast: 'normal', palette: 'default', motion: reduced ? 'reduce' : 'auto' };
  const ctx = { bus, world, kit, nn, sim, prefs, manifest: [], PHASE_INFO, FAULTS, COMMANDS, selection: null,
    setPref() {}, select(sel) { ctx.selection = sel; bus.emit('select', sel); },
    shell: { toast() {}, confirm: async () => false, open: (id) => { location.href = 'app/#/' + id; }, current: () => 'mission' } };
  window.__landing && (window.__landing.cmd = ctx);

  // ---------- the 3-D twin, if the console has one ----------
  let twin = null, showPlan = false;
  let twinOn = false;
  const q = new URLSearchParams(location.search).get('twin');
  // Loaded beside the running mission, so the plan view plays while the 3-D site is being built.
  async function loadTwin() {
    if (q === '1' || (CONFIG.twin && q !== '0')) {
      try {
        const mod = await import('../app/twin/index.js');
        twin = await mod.createTwin(twinHost, ctx, { interactive: false, quality: 'high', camera: 'cinematic', caption: false, autostart: false });
        if (!twin || twin.ok === false) { try { twin?.dispose?.(); } catch { /* nothing to release */ } throw new Error('the twin reported that it could not start'); }
        twin.setLayer?.('labels', false);
        stage.classList.add('has-twin');
        const mk = (label, plan_) => el('button', { type: 'button', 'aria-pressed': String(showPlan === plan_), onclick: () => { showPlan = plan_; stage.classList.toggle('show-plan', plan_); [...seg.children].forEach((b, i) => b.setAttribute('aria-pressed', String((i === 1) === plan_))); sizePlan(); syncTwin(); } }, label);
        const seg = el('div.lseg', { role: 'group', 'aria-label': 'Picture' }, mk('3-D twin', false), mk('Plan view', true));
        ui.view.replaceChildren(seg); ui.view.hidden = false;
      } catch (e) { console.warn('[landing] the 3-D twin did not start; showing the plan view.', e); twin = null; twinHost.replaceChildren(); }
    }
    syncTwin(); sizePlan();
  }
  function syncTwin() { if (!twin) return; const want = visible && !showPlan; if (want === twinOn) return; twinOn = want; try { want ? twin.start() : twin.stop(); } catch (e) { console.warn(e); } }

  // ---------- plan view ----------
  const g = plan.getContext('2d');
  let W = 0, H = 0, sc = 1, ox = 0, oy = 0, mini = false;
  const X = (x) => ox + x * sc, Y = (y) => oy - y * sc;               // world metres (y north) to canvas pixels
  function sizePlan() {
    const r = plan.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (!r.width) return;
    W = r.width; H = r.height; plan.width = Math.round(W * dpr); plan.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    mini = W < 420;
    const view = mini ? [36, 4, 112, 80] : [2, 0, 118, 84];           // the part of the 120 x 90 m site to show
    const padL = mini ? 6 : 34, padR = mini ? 6 : (W > 1100 ? 350 : 300), padT = mini ? 6 : 26, padB = mini ? 6 : 34;   // the right column belongs to the panels
    sc = Math.min((W - padL - padR) / (view[2] - view[0]), (H - padT - padB) / (view[3] - view[1]));
    ox = padL + ((W - padL - padR) - (view[2] - view[0]) * sc) / 2 - view[0] * sc;
    oy = padT + ((H - padT - padB) + (view[3] - view[1]) * sc) / 2 + view[1] * sc;
    draw();
  }
  new ResizeObserver(sizePlan).observe(plan);

  const poly = (pts) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.closePath(); };
  const line = (pts) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); };
  const centroid = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  function hatch(pts, color, gap = 6) {
    g.save(); poly(pts); g.clip();
    const xs = pts.map((p) => X(p[0])), ys = pts.map((p) => Y(p[1])), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    g.strokeStyle = color; g.lineWidth = 1; g.beginPath();
    for (let x = x0 - (y1 - y0); x < x1; x += gap) { g.moveTo(x, y1); g.lineTo(x + (y1 - y0), y0); }
    g.stroke(); g.restore();
  }
  function label(x, y, title, sub, color, dx = 22, dy = -20) {
    if (mini) return;
    const px = X(x), py = Y(y), lx = px + dx, ly = py + dy;
    g.font = SANS; const w1 = g.measureText(title).width; g.font = MONO; const w2 = sub ? g.measureText(sub).width : 0;
    const w = Math.max(w1, w2) + 14, h = sub ? 34 : 20, bx = dx > 0 ? lx : lx - w, by = ly - h;
    g.strokeStyle = color; g.lineWidth = 1; g.beginPath(); g.moveTo(px + Math.sign(dx) * 5, py + Math.sign(dy) * 5); g.lineTo(lx, ly); g.stroke();
    g.fillStyle = 'rgba(8,10,13,0.88)'; g.fillRect(bx, by, w, h); g.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
    g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = C.ink; g.font = SANS; g.fillText(title, bx + 7, by + 10.5);
    if (sub) { g.fillStyle = color; g.font = MONO; g.fillText(sub, bx + 7, by + 24.5); }
  }
  const fog = document.createElement('canvas'); fog.width = world.SITE.w; fog.height = world.SITE.h;
  const fogCtx = fog.getContext('2d'), fogImg = fogCtx.createImageData(fog.width, fog.height);
  const HZ = { slope: 'unstable slope', collapse: 'collapse risk', mud: 'deep mud', gas: 'possible gas' };

  function drawWorld(S, bright) {
    const a = bright ? 1 : 0.28;
    g.globalAlpha = a;
    // neighbouring buildings
    for (const o of world.OBSTACLES) {
      if (o.kind !== 'building') continue;
      poly(o.poly); g.fillStyle = 'rgba(233,237,242,0.035)'; g.fill(); hatch(o.poly, 'rgba(233,237,242,0.07)', 7); poly(o.poly); g.strokeStyle = C.line2; g.lineWidth = 1; g.stroke();
      if (!mini) { const c = centroid(o.poly); g.fillStyle = C.t3; g.font = SANS; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(o.name, X(c[0]), Y(c[1])); }
    }
    // building B: floor, rooms tinted by what the search has established
    const b = world.BUILDING.rect;
    g.fillStyle = 'rgba(233,237,242,0.045)'; g.fillRect(X(b[0]), Y(b[3]), (b[2] - b[0]) * sc, (b[3] - b[1]) * sc);
    for (const r of world.ROOMS) {
      const cov = S.coverage[r.id], tint = cov && { clear: 'rgba(65,214,160,0.10)', person: 'rgba(255,106,69,0.20)', lead: 'rgba(255,178,36,0.14)' }[cov.status];
      if (tint) { g.fillStyle = tint; g.fillRect(X(r.rect[0]), Y(r.rect[3]), (r.rect[2] - r.rect[0]) * sc, (r.rect[3] - r.rect[1]) * sc); }
      if (!r.corridor && !mini) { g.fillStyle = cov?.status === 'person' ? C.person : cov?.status === 'lead' ? C.warn : cov?.status === 'clear' ? C.ok : C.t3; g.font = MONO; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(r.id, X(r.rect[0]) + 5, Y(r.rect[3]) + 5); }
    }
    // rubble and furniture
    for (const o of world.OBSTACLES) {
      if (o.kind === 'building') continue;
      poly(o.poly); g.fillStyle = o.kind === 'rubble' ? 'rgba(233,237,242,0.10)' : 'rgba(233,237,242,0.16)'; g.fill();
      if (o.kind === 'rubble') hatch(o.poly, 'rgba(233,237,242,0.22)', 3.5);
      poly(o.poly); g.strokeStyle = 'rgba(233,237,242,0.34)'; g.lineWidth = 1; g.stroke();
    }
    // hazards
    for (const hz of [...world.HAZARDS, ...S.hazards]) {
      hatch(hz.poly, hz.block ? 'rgba(255,77,94,0.5)' : 'rgba(255,77,94,0.2)', hz.block ? 5 : 9);
      poly(hz.poly); g.setLineDash([4, 4]); g.strokeStyle = hz.block ? 'rgba(255,77,94,0.9)' : 'rgba(255,77,94,0.5)'; g.lineWidth = 1; g.stroke(); g.setLineDash([]);
      if (!mini) { const top = hz.poly.reduce((m, p) => (p[1] > m[1] ? p : m)); g.fillStyle = 'rgba(255,128,140,0.95)'; g.font = SANS; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText(HZ[hz.kind] || 'hazard', X(Math.min(...hz.poly.map((p) => p[0]))) + 3, Y(top[1]) - 4); }
    }
    // walls
    for (const w of world.WALLS) {
      g.beginPath(); g.moveTo(X(w.a[0]), Y(w.a[1])); g.lineTo(X(w.b[0]), Y(w.b[1]));
      g.lineWidth = w.mat === 'concrete' ? 3 : 1.5; g.strokeStyle = w.mat === 'concrete' ? C.ink : 'rgba(233,237,242,0.72)';
      if (w.state === 'collapsed') { g.setLineDash([2, 5]); g.strokeStyle = 'rgba(233,237,242,0.5)'; } else if (w.state === 'damaged') g.setLineDash([7, 3]);
      g.stroke(); g.setLineDash([]);
    }
    g.globalAlpha = 1;
  }

  function draw() {
    if (!W) return;
    const S = sim.state, now = performance.now() / 1000;
    g.clearRect(0, 0, W, H); g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    // survey grid, 10 m, with coordinates along the edges
    g.lineWidth = 1; g.font = MONO; g.fillStyle = C.t3;
    for (let x = 0; x <= world.SITE.w; x += 10) { g.strokeStyle = x % 50 === 0 ? 'rgba(233,237,242,0.085)' : 'rgba(233,237,242,0.04)'; g.beginPath(); g.moveTo(Math.round(X(x)) + 0.5, Y(world.SITE.h)); g.lineTo(Math.round(X(x)) + 0.5, Y(0)); g.stroke(); if (!mini && x % 20 === 0) { g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(x + '', X(x), Y(0) + 7); } }
    for (let y = 0; y <= world.SITE.h; y += 10) { g.strokeStyle = y % 50 === 0 ? 'rgba(233,237,242,0.085)' : 'rgba(233,237,242,0.04)'; g.beginPath(); g.moveTo(X(0), Math.round(Y(y)) + 0.5); g.lineTo(X(world.SITE.w), Math.round(Y(y)) + 0.5); g.stroke(); if (!mini && y % 20 === 0 && X(0) > 22) { g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(y + '', X(0) - 7, Y(y)); } }

    // The site is only as clear as the drone's survey: dim until a swath has passed over it.
    drawWorld(S, false);
    if (S.map.swaths.length || S.map.ready) {
      g.save(); g.beginPath();
      if (S.map.ready) g.rect(X(0), Y(world.SITE.h), world.SITE.w * sc, world.SITE.h * sc);
      else for (const s of S.map.swaths) g.rect(X(s.x0), Y(s.y + s.half), (s.x1 - s.x0) * sc, s.half * 2 * sc);
      g.clip(); g.fillStyle = 'rgba(120,160,200,0.035)'; g.fillRect(0, 0, W, H); drawWorld(S, true); g.restore();
    }
    // what the rover has seen with its own sensors
    const ex = S.map.explored, d = fogImg.data; let any = false;
    for (let i = 0; i < ex.length; i++) { const yy = fog.height - 1 - Math.floor(i / fog.width), o = (yy * fog.width + (i % fog.width)) * 4; d[o] = 170; d[o + 1] = 205; d[o + 2] = 255; d[o + 3] = ex[i] ? 15 : 0; any ||= !!ex[i]; }
    if (any) { fogCtx.putImageData(fogImg, 0, 0); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(fog, X(0), Y(world.SITE.h), world.SITE.w * sc, world.SITE.h * sc); }
    if (!mini) for (const [p, name] of [[world.SITE.staging, 'Staging'], [world.SITE.dronePad, 'Drone pad'], [world.SITE.entrance, 'Entrance']]) {
      const px = Math.round(X(p[0])) + 0.5, py = Math.round(Y(p[1])) + 0.5; g.strokeStyle = C.t3; g.lineWidth = 1; g.beginPath(); g.arc(px, py, 3, 0, Math.PI * 2); g.stroke();
      g.fillStyle = C.t3; g.font = SANS; g.textAlign = name === 'Drone pad' ? 'right' : 'left'; g.textBaseline = 'top'; g.fillText(name, px + (name === 'Drone pad' ? -8 : 8), py + (name === 'Entrance' ? 6 : 4));
    }

    // listening stops
    for (const s of world.STOPS) {
      const done = s.covers.some((id) => S.coverage[id] && S.coverage[id].status !== 'unsearched' && S.coverage[id].stop === s.id) || s.covers.every((id) => S.coverage[id]?.status !== 'unsearched');
      const px = Math.round(X(s.pos[0])) + 0.5, py = Math.round(Y(s.pos[1])) + 0.5;
      g.strokeStyle = done ? C.ok : C.t2; g.lineWidth = 1; g.strokeRect(px - 4, py - 4, 8, 8); g.beginPath(); g.moveTo(px - 7, py); g.lineTo(px + 7, py); g.moveTo(px, py - 7); g.lineTo(px, py + 7); g.stroke();
      if (!mini) { g.fillStyle = done ? C.ok : C.t2; g.font = MONO; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText(s.id, px + 7, py - 5); }
    }
    // rescue route
    const route = S.routes.rescue;
    if (route) for (const leg of route.legs) {
      if (!leg.path?.length) continue;
      line(leg.path); g.strokeStyle = C.accent; g.lineWidth = route.status === 'planned' ? 1.5 : 2.25; g.setLineDash(route.status === 'planned' ? [6, 5] : []); g.globalAlpha = leg.arrivedAt ? 0.45 : 1; g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      const end = leg.path[leg.path.length - 1]; g.fillStyle = C.accent; g.fillRect(X(end[0]) - 3, Y(end[1]) - 3, 6, 6);
    }
    // units
    const rover = S.units['HOUND-01'], drone = S.units['DRONE-01'], team = S.units['TEAM-1'];
    if (rover.trail.length > 1) { line(rover.trail); g.strokeStyle = 'rgba(233,237,242,0.5)'; g.lineWidth = 1; g.stroke(); }
    if (rover.path?.length) { line([rover.pos, ...rover.path.filter((p) => p)]); g.strokeStyle = 'rgba(233,237,242,0.3)'; g.setLineDash([2, 4]); g.lineWidth = 1; g.stroke(); g.setLineDash([]); }
    if (team.trail.length > 1) { line(team.trail); g.strokeStyle = 'rgba(90,169,255,0.4)'; g.lineWidth = 1; g.stroke(); }
    // the drone and its swath
    if (drone.mode !== 'idle' && drone.mode !== 'landed') {
      if (drone.trail.length > 1) { line(drone.trail); g.strokeStyle = 'rgba(180,215,255,0.22)'; g.lineWidth = 1; g.stroke(); }
      const px = X(drone.pos[0]), py = Y(drone.pos[1]);
      if (drone.mode === 'scan') { g.fillStyle = 'rgba(190,220,255,0.10)'; g.fillRect(px - 2, py - 8 * sc, 4, 16 * sc); g.strokeStyle = 'rgba(200,228,255,0.85)'; g.lineWidth = 1; g.beginPath(); g.moveTo(px + 0.5, py - 8 * sc); g.lineTo(px + 0.5, py + 8 * sc); g.stroke(); }
      g.strokeStyle = C.ink; g.lineWidth = 1.25; g.beginPath(); g.moveTo(px - 6, py - 6); g.lineTo(px + 6, py + 6); g.moveTo(px + 6, py - 6); g.lineTo(px - 6, py + 6); g.stroke();
      for (const [sx, sy] of [[-6, -6], [6, 6], [6, -6], [-6, 6]]) { g.beginPath(); g.arc(px + sx, py + sy, 3, 0, Math.PI * 2); g.stroke(); }
      label(drone.pos[0], drone.pos[1], 'Scout drone', `${drone.alt.toFixed(0)} m  ${drone.mode}  concept`, C.t2, 24, -22);
    }
    // the team
    if (team.mode !== 'idle' || route) { const px = X(team.pos[0]), py = Y(team.pos[1]); g.fillStyle = C.accent; g.beginPath(); g.moveTo(px, py - 6); g.lineTo(px + 5.5, py + 4.5); g.lineTo(px - 5.5, py + 4.5); g.closePath(); g.fill(); if (route && route.status !== 'done') label(team.pos[0], team.pos[1], 'Rescue team 1', route.status === 'planned' ? 'waiting for approval' : 'on the approved route', C.accent, -24, 26); }
    // the rover: listening rings while it is stopped with a window open
    const rx = X(rover.pos[0]), ry = Y(rover.pos[1]);
    const lis = S.sensors.listen;
    if (lis) {
      const R = world.SENSORS.csi.range * sc;
      g.strokeStyle = 'rgba(233,237,242,0.16)'; g.lineWidth = 1; g.beginPath(); g.arc(rx, ry, R, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 3; k++) { const f = reduced ? (k + 1) / 3 : (now * 0.55 + k / 3) % 1; g.strokeStyle = `rgba(233,237,242,${(0.5 * (1 - f)).toFixed(3)})`; g.beginPath(); g.arc(rx, ry, f * R, 0, Math.PI * 2); g.stroke(); }
      g.strokeStyle = C.ink; g.lineWidth = 2; g.beginPath(); g.arc(rx, ry, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(lis.progress ?? 0)); g.stroke();
    }
    for (const t of S.sensors.radar?.targets || []) { const px = X(t.pos[0]), py = Y(t.pos[1]); g.strokeStyle = C.t2; g.lineWidth = 1; g.beginPath(); g.moveTo(px, py - 5); g.lineTo(px + 5, py); g.lineTo(px, py + 5); g.lineTo(px - 5, py); g.closePath(); g.stroke(); }
    g.save(); g.translate(rx, ry); g.rotate(-rover.heading); g.fillStyle = C.ink; g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, -5.5); g.lineTo(-2.5, 0); g.lineTo(-5, 5.5); g.closePath(); g.fill(); g.restore();
    label(rover.pos[0], rover.pos[1], 'HOUND-01', lis ? `listening  ${Math.round(clamp(lis.progress ?? 0) * 10)} of 10 s` : `${rover.mode}  ${rover.v ? rover.v.toFixed(2) + ' m/s' : 'stopped'}`, C.ink, -24, -24);

    // findings
    for (const dct of S.detections) {
      if (!dct.pos || dct.dismissed) continue;
      const px = X(dct.pos[0]), py = Y(dct.pos[1]), col = dct.status === 'confirmed' ? C.person : dct.status === 'rejected' ? C.t3 : C.warn;
      if (dct.status === 'confirmed') {
        const pulse = reduced ? 0.5 : (now * 0.8) % 1;
        g.strokeStyle = `rgba(255,106,69,${(0.7 * (1 - pulse)).toFixed(3)})`; g.lineWidth = 1.5; g.beginPath(); g.arc(px, py, 6 + pulse * 16, 0, Math.PI * 2); g.stroke();
        g.fillStyle = col; g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.fill(); g.strokeStyle = C.bg; g.lineWidth = 1.5; g.stroke();
      } else if (dct.status === 'rejected') { g.strokeStyle = col; g.lineWidth = 1.25; g.beginPath(); g.moveTo(px - 4, py - 4); g.lineTo(px + 4, py + 4); g.moveTo(px + 4, py - 4); g.lineTo(px - 4, py + 4); g.stroke(); }
      else { g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, py - 6); g.lineTo(px + 6, py); g.lineTo(px, py + 6); g.lineTo(px - 6, py); g.closePath(); g.stroke(); g.beginPath(); g.arc(px, py, Math.max(8, (dct.posSigma || 1) * sc * 1.5), 0, Math.PI * 2); g.setLineDash([2, 3]); g.stroke(); g.setLineDash([]); }
      if (dct.status !== 'rejected') label(dct.pos[0], dct.pos[1], findTitle(dct), `${dct.id}  ${(dct.p * 100).toFixed(0)} %  ${dct.status}`, col, 24, dct.outdoor ? 26 : -22);
    }
    if (!mini) {   // scale bar and north
      const bx = X(4), by = Y(0) + 22; g.strokeStyle = C.t2; g.lineWidth = 1; g.beginPath(); g.moveTo(bx, by - 3); g.lineTo(bx, by); g.lineTo(bx + 20 * sc, by); g.lineTo(bx + 20 * sc, by - 3); g.moveTo(bx + 10 * sc, by); g.lineTo(bx + 10 * sc, by - 3); g.stroke();
      g.fillStyle = C.t3; g.font = MONO; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('20 m', bx + 20 * sc + 8, by - 1);
      g.fillText('Plan view of the simulated site. North is up. Grid 10 m.', bx + 20 * sc + 56, by - 1);
    }
  }

  // ---------- the panels ----------
  const findTitle = (d) => {
    const where = d.outdoor ? 'debris field' : d.room ? 'room ' + d.room : 'site';
    if (d.status === 'confirmed') return 'Person, ' + where;
    if (d.status === 'rejected') return `Not a person, ${where}`;
    return 'Possible person, ' + where;
  };
  const SHOWN = PHASES.filter((p) => p !== 'standby');
  ui.phases.replaceChildren(...SHOWN.map((p) => el('li', { title: PHASE_INFO[p].label })));
  const rooms = world.ROOMS.filter((r) => !r.corridor);
  const roomEls = Object.fromEntries(rooms.map((r) => [r.id, el('div', null, el('b', null, r.id), el('span', null, 'to search'))]));
  ui.rooms.replaceChildren(...rooms.map((r) => roomEls[r.id]));
  let lastUi = 0, sig = '';
  function panels(force) {
    const now = performance.now(); if (!force && now - lastUi < 110) return; lastUi = now;
    const S = sim.state, info = PHASE_INFO[S.phase];
    ui.clock.textContent = fmtClock(S.t);
    const s2 = S.phase + '|' + S.events.length + '|' + S.detections.map((d) => d.status + Math.round(d.p * 100)).join(',') + '|' + Object.values(S.coverage).map((c) => c.status[0] + Math.round(c.residual * 100)).join('') + '|' + S.running;
    if (s2 === sig && !force) return; sig = s2;
    ui.phase.textContent = info.label; ui.hint.textContent = info.hint;
    const at = SHOWN.indexOf(S.phase); [...ui.phases.children].forEach((li, i) => { li.className = S.phase === 'complete' || i < at ? 'done' : i === at ? 'now' : ''; });
    const dets = S.detections.filter((d) => !d.dismissed);
    ui.count.textContent = String(dets.filter((d) => d.status === 'confirmed').length) + ' confirmed';
    ui.finds.replaceChildren(...(dets.length ? dets.map((d) => el('li.' + d.status, null, el('i'), el('div', null, el('b', null, findTitle(d)), el('small', null, d.status === 'rejected' ? d.reason : [...new Set(d.evidence.map((e) => ({ csi: 'Wi-Fi', radar: 'radar', micro: 'radar', thermal: 'thermal', aerial: 'drone image', human: 'rescue team' }[e.sensor] || e.sensor)))].join(', '))), el('span.num', null, (d.p * 100).toFixed(0) + ' %'))) : [el('li.cmd-empty', null, 'Nothing found yet.')]));
    let left = 0;
    for (const r of rooms) { const c = S.coverage[r.id], n = roomEls[r.id]; n.className = c.status; if (c.status === 'unsearched') left++; n.lastChild.textContent = { unsearched: 'to search', clear: 'clear, ' + (c.residual * 100).toFixed(0) + ' % risk', lead: 'lead open', person: 'person', blocked: 'blocked' }[c.status] || c.status; n.title = c.note || ''; }
    ui.coverNote.textContent = left ? left + ' to search' : 'all checked or blocked';
    ui.log.replaceChildren(...S.events.slice(-4).map((e) => el('li.' + e.level, null, el('span.num', null, fmtClock(e.t)), el('span', null, e.text))));
    const done = S.phase === 'complete';
    ui.play.textContent = S.running ? 'Pause' : done ? 'Run it again' : 'Play'; ui.play.setAttribute('aria-pressed', String(!S.running));
    [...ui.speed.children].forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.speed === S.speed)));
  }

  // ---------- running it ----------
  let visible = false, userPaused = false, started = false, raf = 0;
  const loop = () => { raf = 0; if (!visible) return; if (!twin || showPlan || !mini || sim.state.running) draw(); if (sim.state.running || sim.state.sensors.listen) raf = requestAnimationFrame(loop); };
  const kick = () => { if (!raf && visible) raf = requestAnimationFrame(loop); };
  bus.on('tick', () => { panels(); kick(); }); bus.on('reset', () => { panels(true); draw(); }); bus.on('running', () => { panels(true); kick(); });
  ui.play.addEventListener('click', () => {
    const S = sim.state;
    if (S.phase === 'complete' && !S.running) { sim.reset(); sim.play(); userPaused = false; return; }
    userPaused = S.running; sim.toggle();
  });
  ui.reset.addEventListener('click', () => { sim.reset(); userPaused = false; sim.play(); });
  ui.speed.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { sim.setSpeed(+b.dataset.speed); panels(true); } });
  sim.setSpeed(8);
  new IntersectionObserver((es) => {
    visible = es[0].isIntersecting && es[0].intersectionRatio > 0.3;
    if (visible) { if (!started) { started = true; if (!reduced) sim.play(); } else if (!userPaused && sim.state.phase !== 'complete') sim.play(); kick(); }
    else if (sim.state.running) sim.pause();
    syncTwin();
  }, { threshold: [0, 0.3, 0.6] }).observe(stage);
  if (reduced) ui.hint.textContent = 'Reduced motion is on, so the mission waits for you. Press Play.';
  sizePlan(); panels(true);
  loadTwin();
  document.fonts?.ready.then(() => draw());
}
