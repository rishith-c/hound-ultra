// The twin's cameras. One perspective camera, one rig. The rig holds a pose (target, yaw, pitch, distance, field
// of view); every mode is just a different way of choosing that pose each frame:
//   orbit      the user's own view, damped
//   top        a plan view from high up through a long lens, north up
//   follow     chases the rover from behind with spring-damped lag
//   fpv        from the rover's mast
//   cinematic  a director that picks shots from the mission state
// Changes of mode and of shot are eased. Any input from the user takes control at once; follow, fpv and cinematic
// wait a few seconds after the last input, then ease back.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const yawBehind = (heading) => heading - Math.PI / 2;        // camera yaw that looks along a sim heading (0 = east)
export const MODES = ['orbit', 'top', 'follow', 'fpv', 'cinematic'];
const HOLD = { follow: 5, fpv: 4, cinematic: 9 };            // seconds the director waits after the user lets go

const mkPose = (o = {}) => ({ target: new THREE.Vector3(62, 0, -42), yaw: -0.42, pitch: 0.62, dist: 92, fov: 38, ...o });
function copyPose(a, b) { a.target.copy(b.target); a.yaw = b.yaw; a.pitch = b.pitch; a.dist = b.dist; a.fov = b.fov; return a; }
export function createCameras({ camera, dom, ctx, world, reduced = () => false, interactive = true, mode: startMode = 'orbit', heightAt = null }) {
  const B = world.BUILDING.rect, siteC = new THREE.Vector3((B[0] + B[2]) / 2 - 2, 0, -(B[1] + B[3]) / 2 + 2);
  const home = mkPose({ target: siteC.clone(), yaw: -0.44, pitch: 0.42, dist: 84, fov: 38 });
  const G = mkPose(), C = mkPose(), D = mkPose();      // goal, current, director's pose
  const vel = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, dist: 0, fov: 0 }, sp = [0, 0];                    // the rig's velocity: critically damped springs, so nothing overshoots
  const spring = (x, v, g, w, dt) => { const e = Math.exp(-w * dt), d = x - g, q = (v + w * d) * dt; sp[0] = g + (d + q) * e; sp[1] = (v - w * q) * e; };
  const safe = { left: 0, top: 0, right: 0, bottom: 0 }, safeC = { x: 0, y: 0, k: 1, vx: 0, vy: 0, vk: 0 }, view = { x: 0, y: 0, w: 0, h: 0 };
  const glass = { x: 64, z: -44, r: 0 }, camXY = [0, 0], tgtXY = [0, 0]; let lift = 0, liftV = 0, ground0 = heightAt;
  copyPose(G, home); copyPose(C, home);
  let mode = MODES.includes(startMode) ? startMode : 'orbit', soft = 0, softRate = 1, lastInput = -1e9, now = 0, aspect = 1.6, held = false, moved = 0;
  let shot = { key: '', t0: 0, yaw0: 0 }, find = null, routeUntil = 0, userYaw = false;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ndc = new THREE.Vector2();
  const unit = (S, id) => S.units[id];
  const u3 = (out, p, h = 0) => out.set(p[0], h, -p[1]);

  // ---------- the director ----------
  const offs = [];
  if (ctx.bus) {
    offs.push(ctx.bus.on('detection', (d) => { if (d && d.pos && d.status !== 'rejected') find = { pos: d.pos.slice(), until: now + 5.5, id: d.id }; }));
    offs.push(ctx.bus.on('survivor', (s) => { if (s && s.pos) find = { pos: s.pos.slice(), until: now + 5, id: s.id }; }));
    offs.push(ctx.bus.on('route', (r) => { if (r && r.status === 'planned') routeUntil = now + 7; }));
    offs.push(ctx.bus.on('reset', () => { find = null; routeUntil = 0; shot.key = ''; snap = true; }));
    offs.push(ctx.bus.on('seek', () => { find = null; routeUntil = 0; shot.key = ''; snap = true; }));
  }
  const inB = (p) => p[0] > B[0] - 1 && p[0] < B[2] + 1 && p[1] > B[1] - 1 && p[1] < B[3] + 1;
  function routeBox(S) {
    const r = S.routes && S.routes.rescue; if (!r || !r.legs) return null;
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const leg of r.legs) for (const p of leg.path || []) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
    return a === Infinity ? null : [a, b, c, d];
  }
  // Each shot fills D for the current moment. tau = seconds since the shot began; k = 0 under reduced motion.
  const slowIn = (tau, T) => { const x = clamp(tau / T, 0, 1); return x * x * (3 - 2 * x); };
  const SHOTS = {
    establish(S, tau, k) { D.target.copy(siteC).setY(13); D.yaw = -0.06 - tau * 0.008 * k; D.pitch = 0.05; D.dist = 80 - 14 * slowIn(tau, 26) * k; D.fov = 42; },
    survey(S, tau, k) { const d = unit(S, 'DRONE-01'); u3(tmp, d.pos, 0).lerp(siteC, 0.72); D.target.copy(tmp).setY(14); D.yaw = 0.02 - tau * 0.009 * k; D.pitch = 0.08; D.dist = 82; D.fov = 42; },
    drone(S, tau, k) { const d = unit(S, 'DRONE-01'); u3(D.target, d.pos, (d.alt || 0) * 0.9); D.yaw = -0.2 + tau * 0.015 * k; D.pitch = 0.2; D.dist = 19; D.fov = 36; },
    track(S, tau, k) { const r = unit(S, 'HOUND-01'); u3(D.target, r.pos, 0.55); D.yaw = yawBehind(r.heading) + 0.55 - 0.25 * slowIn(tau, 14) * k; D.pitch = 0.13; D.dist = 5.6 - 0.8 * slowIn(tau, 14) * k; D.fov = 36; },
    inside(S, tau, k) { const r = unit(S, 'HOUND-01'); u3(D.target, r.pos, 0.35); D.yaw = 0.3 + Math.sin(tau * 0.07) * 0.2 * k; D.pitch = 0.6; D.dist = 12.5; D.fov = 34; },
    listen(S, tau, k) { const r = unit(S, 'HOUND-01'); u3(D.target, r.pos, 0.45); D.yaw = shot.yaw0 + tau * 0.03 * k; D.pitch = 0.46; D.dist = 9.5 - 2.6 * slowIn(tau, 9) * k; D.fov = 34; },
    find(S, tau, k) { const r = unit(S, 'HOUND-01'); u3(D.target, find ? find.pos : [64, 44], 0.5); D.yaw = shot.yaw0 + tau * 0.025 * k; D.pitch = 0.46 - 0.14 * slowIn(tau, 5) * k; D.dist = 10.5 - 4.2 * slowIn(tau, 6) * k; D.fov = 32; },
    route(S, tau, k) { const b = routeBox(S) || [20, 8, 84, 58], far = clamp(Math.max(b[2] - b[0], (b[3] - b[1]) * 1.5) * 1.15 + 14, 40, 130), u = k ? slowIn(tau, 6) : 1; D.target.set((b[0] + b[2]) / 2, 0, -(b[1] + b[3]) / 2); D.yaw = -0.22 + tau * 0.008 * k; D.pitch = 0.42 + 0.34 * u; D.dist = far * (0.5 + 0.5 * u); D.fov = 36; },
    team(S, tau, k) { const m = unit(S, 'TEAM-1'), i = inB(m.pos); u3(D.target, m.pos, 0.9); D.yaw = (i ? 0.3 : yawBehind(m.heading || 0) + 0.7) + Math.sin(tau * 0.08) * 0.15 * k; D.pitch = i ? 0.6 : 0.16; D.dist = i ? 13 : 9; D.fov = 34; },
    done(S, tau, k) { D.target.copy(siteC).setY(13); D.yaw = -0.1 - tau * 0.008 * k; D.pitch = 0.07; D.dist = 78; D.fov = 42; },
  };
  const DOF = { establish: 0, survey: 0, drone: 0.5, track: 0.6, inside: 0.25, listen: 0.5, find: 0.55, route: 0, team: 0.5, done: 0 };
  function pickShot(S) {
    const r = unit(S, 'HOUND-01'), d = unit(S, 'DRONE-01');
    if (find && now < find.until) return 'find';
    if (now < routeUntil && routeBox(S)) return 'route';
    switch (S.phase) {
      case 'standby': return 'establish';
      case 'aerial': return d && d.mode === 'scan' && Math.floor(now / 9) % 3 === 1 ? 'drone' : 'survey';
      case 'deploy': return inB(r.pos) ? 'inside' : 'track';
      case 'search': case 'assess': return S.sensors && S.sensors.listen ? 'listen' : inB(r.pos) ? 'inside' : 'track';
      case 'plan': return routeBox(S) ? 'route' : 'inside';
      case 'rescue': return 'team';
      default: return 'done';
    }
  }
  function direct(S, dt) {
    const want = pickShot(S), urgent = want === 'find' || want === 'route';
    if (want !== shot.key && (shot.key === '' || urgent || now - shot.t0 > 3.2)) {
      const first = shot.key === '';
      shot = { key: want, t0: now, yaw0: want === 'listen' || want === 'find' ? wrap(C.yaw) * 0.4 + 0.2 : C.yaw };
      if (!first) begin(want === 'find' ? 2.6 : 3.4);
    }
    SHOTS[shot.key](S, now - shot.t0, reduced() ? 0 : 1);
  }

  // ---------- modes ----------
  function modePose(S, dt) {
    const r = S && unit(S, 'HOUND-01');
    if (mode === 'top') { D.target.copy(G.target); D.yaw = 0; D.pitch = 1.552; D.dist = G.dist; D.fov = 20; return; }
    if (mode === 'follow' && r) { u3(D.target, r.pos, 0.35); D.yaw = userYaw ? G.yaw : yawBehind(r.heading) + 0.32; D.pitch = userYaw ? G.pitch : 0.36; D.dist = G.dist; D.fov = 42; return; }
    if (mode === 'fpv' && r) {
      const dx = Math.cos(r.heading), dz = -Math.sin(r.heading);
      u3(D.target, r.pos, 0.5).add(tmp.set(dx * 4.2, 0, dz * 4.2)); D.yaw = yawBehind(r.heading); D.pitch = 0.035; D.dist = 4.08; D.fov = 72; return;
    }
    if (mode === 'cinematic' && S) { direct(S, dt); return; }
    copyPose(D, G);
  }
  function begin(dur) { soft = reduced() || dur <= 0 ? 0 : 1; softRate = 1 / Math.max(0.1, dur); }      // soft = 1: the springs start slack and tighten
  function fitTop() { const need = Math.max(98, 132 / aspect); return need / (2 * Math.tan(THREE.MathUtils.degToRad(10))); }
  function setMode(m, { instant = false } = {}) {
    if (!MODES.includes(m)) return false;
    const prev = mode; mode = m; userYaw = false; lastInput = -1e9; shot.key = '';
    if (m === 'orbit') { if (prev === 'top' || prev === 'fpv') copyPose(G, home); else { copyPose(G, C); G.pitch = clamp(G.pitch, 0.2, 1.3); G.dist = clamp(G.dist, 6, 220); G.fov = 38; } }
    if (m === 'top') { G.target.copy(siteC).setY(0); G.target.x = 60; G.target.z = -45; G.dist = fitTop(); }
    if (m === 'follow') G.dist = 5.2;
    begin(instant ? 0 : 1.6);
    if (instant || reduced()) snap = true;
    return true;
  }
  let snap = true;

  // ---------- user input ----------
  const userActive = () => held || now - lastInput < (HOLD[mode] || 0);
  function grab() {                                        // the user takes over: carry on from exactly where the camera is
    soft = 0;
    if (mode === 'cinematic' || mode === 'fpv') { if (!userActive()) copyPose(G, C); }
    else if (mode === 'follow') { if (!userYaw) { G.yaw = C.yaw; G.pitch = C.pitch; } userYaw = true; }
    lastInput = now;
  }
  function groundAt(cx, cy, out) {
    const r = dom.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera); return ray.ray.intersectPlane(ground, out);
  }
  function orbitBy(dx, dy) { if (mode === 'top') return panBy(dx, dy); grab(); G.yaw -= dx * 0.0052; G.pitch = clamp(G.pitch + dy * 0.0042, mode === 'fpv' ? -0.5 : 0.05, 1.5); }
  function panBy(dx, dy) {
    if (mode === 'follow' || mode === 'fpv') return orbitBy(dx, dy);
    grab();
    const h = dom.clientHeight || 1, s = (2 * C.dist * Math.tan(THREE.MathUtils.degToRad(C.fov / 2))) / h, sy = s / Math.max(0.35, Math.sin(C.pitch));
    const cx = Math.cos(C.yaw), sx = Math.sin(C.yaw);
    G.target.x += -dx * s * cx - dy * sy * sx; G.target.z += dx * s * sx - dy * sy * cx;
    G.target.x = clamp(G.target.x, -140, 260); G.target.z = clamp(G.target.z, -240, 150);
  }
  function zoomBy(f, cx, cy) {
    grab();
    const lim = mode === 'top' ? [60, 700] : mode === 'follow' ? [1.6, 40] : mode === 'fpv' ? [4.08, 4.08] : [2.2, 420];
    if (mode === 'fpv') { G.fov = clamp(G.fov * f, 30, 90); return; }
    const d0 = G.dist, d1 = clamp(d0 * f, lim[0], lim[1]);
    if (cx != null && mode !== 'follow' && d1 < d0 && groundAt(cx, cy, tmp2) && tmp2.distanceTo(C.target) < C.dist * 1.5) G.target.lerp(tmp2.setY(G.target.y), (1 - d1 / d0) * 0.7);
    G.dist = d1;
  }
  const ptrs = new Map(); let pinch = 0, lastMid = null;
  const onDown = (e) => { dom.setPointerCapture?.(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey }); held = true; moved = 0; pinch = 0; lastMid = null; dom.classList.add('dragging'); };
  const onMove = (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    if (moved < 4) return;
    if (ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()], dd = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinch) zoomBy(pinch / dd, mid.x, mid.y); if (lastMid) panBy(mid.x - lastMid.x, mid.y - lastMid.y); pinch = dd; lastMid = mid; return;
    }
    if (p.b === 2 || p.b === 1 || p.shift) panBy(dx, dy); else orbitBy(dx, dy);
  };
  const onUp = (e) => { ptrs.delete(e.pointerId); pinch = 0; lastMid = null; if (!ptrs.size) { held = false; dom.classList.remove('dragging'); if (moved >= 4) lastInput = now; } };
  const onWheel = (e) => { e.preventDefault(); const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY; zoomBy(Math.exp(clamp(dy, -240, 240) * (e.ctrlKey ? 0.008 : 0.0016)), e.clientX, e.clientY); };
  const onKey = (e) => {
    const step = e.shiftKey ? 60 : 24; let used = true;
    switch (e.key) {
      case 'ArrowLeft': e.altKey ? panBy(step, 0) : orbitBy(step, 0); break; case 'ArrowRight': e.altKey ? panBy(-step, 0) : orbitBy(-step, 0); break;
      case 'ArrowUp': e.altKey ? panBy(0, step) : orbitBy(0, step); break; case 'ArrowDown': e.altKey ? panBy(0, -step) : orbitBy(0, -step); break;
      case '+': case '=': zoomBy(0.85); break; case '-': case '_': zoomBy(1.18); break;
      case 'a': case 'A': panBy(step, 0); break; case 'd': case 'D': panBy(-step, 0); break; case 'w': case 'W': panBy(0, step); break; case 's': case 'S': panBy(0, -step); break;
      case 'Home': case '0': copyPose(G, home); begin(1.4); if (mode === 'top') { G.dist = fitTop(); G.target.set(60, 0, -45); } soft = Math.max(soft, 0.6); softRate = 0.5; lastInput = now; break;
      default: used = false;
    }
    if (used) { e.preventDefault(); e.stopPropagation(); }
  };
  const noMenu = (e) => e.preventDefault();
  if (interactive) {
    dom.addEventListener('pointerdown', onDown); dom.addEventListener('pointermove', onMove); dom.addEventListener('pointerup', onUp); dom.addEventListener('pointercancel', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false }); dom.addEventListener('keydown', onKey); dom.addEventListener('contextmenu', noMenu);
  }

  // ---------- fly to a selection ----------
  function locate(sel, S) {
    if (!sel || !S) return null;
    const W = world, c = (r) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], cen = (poly) => { let x = 0, y = 0; for (const p of poly) { x += p[0]; y += p[1]; } return [x / poly.length, y / poly.length]; };
    switch (sel.type) {
      case 'detection': { const d = S.detections.find((q) => q.id === sel.id); return d && d.pos ? { p: d.pos, h: 0.7, dist: 10 } : null; }
      case 'survivor': { const s = S.survivors[sel.id]; return s && s.pos ? { p: s.pos, h: 0.7, dist: 9 } : null; }
      case 'unit': { const u = S.units[sel.id]; return u ? { p: u.pos, h: u.kind === 'drone' ? (u.alt || 0) : 0.4, dist: u.kind === 'drone' ? 22 : u.kind === 'team' ? 11 : 5.5 } : null; }
      case 'room': { const r = W.roomById(sel.id); return r ? { p: c(r.rect), h: 0.5, dist: Math.max(r.rect[2] - r.rect[0], r.rect[3] - r.rect[1]) * 1.25 + 10, pitch: 0.95 } : null; }
      case 'hazard': { const hz = [...W.HAZARDS, ...(S.hazards || [])].find((q) => q.id === sel.id); if (!hz) return null; const p = cen(hz.poly); let rad = 4; for (const q of hz.poly) rad = Math.max(rad, Math.hypot(q[0] - p[0], q[1] - p[1])); return { p, h: 0, dist: rad * 2.4 + 10, pitch: 0.85 }; }
      case 'stop': { const s = W.STOPS.find((q) => q.id === sel.id); return s ? { p: s.pos, h: 0.3, dist: 12 } : null; }
      case 'event': {
        const ev = S.events.find((q) => q.id === sel.id); if (!ev) return null;
        if (ev.pos) return { p: ev.pos, h: 0.4, dist: 14 };
        return (ev.det && locate({ type: 'detection', id: ev.det }, S)) || (ev.room && locate({ type: 'room', id: ev.room }, S)) || (ev.unit && locate({ type: 'unit', id: ev.unit }, S)) || null;
      }
      default: return sel.pos ? { p: sel.pos, h: 0, dist: 14 } : null;
    }
  }
  function focus(sel, S) {
    const f = locate(sel, S); if (!f) return false;
    soft = Math.max(soft, 0.6); softRate = 0.5; if (mode === 'cinematic' || mode === 'fpv') copyPose(G, C); if (mode === 'follow' || mode === 'fpv') { mode = 'orbit'; copyPose(G, C); G.fov = 38; }
    lastInput = now + 3;                                   // hold the shot a little longer than after a drag
    u3(G.target, f.p, f.h);
    if (mode === 'top') { G.dist = clamp(f.dist * 6.5, 90, fitTop()); return true; }
    G.dist = f.dist; G.pitch = f.pitch ?? clamp(G.pitch, 0.5, 0.9); G.fov = 38;
    return true;
  }
  function flyTo(point, dist) { soft = Math.max(soft, 0.6); softRate = 0.5; if (mode === 'cinematic') copyPose(G, C); lastInput = now + 2; G.target.copy(point); if (dist) G.dist = dist; }

  // ---------- every frame ----------
  let wasUser = false, viewW = 0, viewH = 0;
  function update(dt, S, w, h) {
    now += dt; viewW = w; viewH = h; aspect = w / h || aspect;
    const user = userActive(), driven = mode === 'cinematic' || mode === 'fpv' || mode === 'follow' || mode === 'top';
    if (mode === 'follow' && !user) userYaw = false;
    if (wasUser && !user && (mode === 'cinematic' || mode === 'fpv' || mode === 'follow')) begin(mode === 'cinematic' ? 2.4 : 1.2);
    wasUser = user;
    let tgt = G, rateT = 16, rateA = 16;
    if (driven && !(user && (mode === 'cinematic' || mode === 'fpv'))) {
      modePose(S, dt); tgt = D;
      if (mode === 'follow') { rateT = 9; rateA = user ? 14 : 3; } else if (mode === 'fpv') { rateT = 18; rateA = 9; } else if (mode === 'cinematic') { rateT = 2.6; rateA = 2.0; } else { rateT = 10; rateA = 10; }
    }
    // wide shots step back when panels cover part of the view
    const sw = (viewW || 1) - safe.left - safe.right, sh = (viewH || 1) - safe.top - safe.bottom, fit = viewW ? clamp(Math.sqrt(Math.max(0.2, (sw * sh) / (viewW * viewH))), 0.6, 1) : 1;
    spring(safeC.x, safeC.vx, (safe.left - safe.right) / 2, 3, dt); safeC.x = sp[0]; safeC.vx = sp[1]; spring(safeC.y, safeC.vy, (safe.top - safe.bottom) / 2, 3, dt); safeC.y = sp[0]; safeC.vy = sp[1];
    const back = mode === 'cinematic' && !user ? 1 / fit : 1, gd = tgt.dist * back;
    if (snap || reduced()) { copyPose(C, tgt); C.dist = gd; for (const q in vel) vel[q] = 0; safeC.x = (safe.left - safe.right) / 2; safeC.y = (safe.top - safe.bottom) / 2; soft = 0; snap = false; lift = liftV = 0; }
    else {
      soft = Math.max(0, soft - dt * softRate); const q = 1 - soft * soft * 0.9, wt = rateT * q, wa = rateA * q;
      spring(C.target.x, vel.x, tgt.target.x, wt, dt); C.target.x = sp[0]; vel.x = sp[1]; spring(C.target.y, vel.y, tgt.target.y, wt, dt); C.target.y = sp[0]; vel.y = sp[1]; spring(C.target.z, vel.z, tgt.target.z, wt, dt); C.target.z = sp[0]; vel.z = sp[1];
      spring(C.yaw, vel.yaw, C.yaw + wrap(tgt.yaw - C.yaw), wa, dt); C.yaw = sp[0]; vel.yaw = sp[1]; spring(C.pitch, vel.pitch, tgt.pitch, wa, dt); C.pitch = sp[0]; vel.pitch = sp[1];
      const ld = Math.log(C.dist); spring(ld, vel.dist, Math.log(gd), wa, dt); C.dist = Math.exp(sp[0]); vel.dist = sp[1]; spring(C.fov, vel.fov, tgt.fov, wa, dt); C.fov = sp[0]; vel.fov = sp[1];
    }
    const cp = Math.cos(C.pitch);
    camera.position.set(C.target.x + Math.sin(C.yaw) * cp * C.dist, C.target.y + Math.sin(C.pitch) * C.dist, C.target.z + Math.cos(C.yaw) * cp * C.dist);
    // never inside the hillside, never through a wall: rise over whatever is in the way, smoothly
    let need = 0; const y0 = camera.position.y;
    if (ground0) { const g = ground0(camera.position.x, -camera.position.z) + (mode === 'fpv' ? 0.12 : C.dist > 20 ? 2.2 : 0.5); if (y0 < g) need = g - y0; }
    if (mode !== 'fpv' && C.dist < 45 && y0 < 4.2) { camXY[0] = camera.position.x; camXY[1] = -camera.position.z; tgtXY[0] = C.target.x; tgtXY[1] = -C.target.z; if (world.wallsCrossed(camXY, tgtXY).length) need = Math.max(need, 4.4 - y0); }
    if (soft === 0 && lift === 0 && need > 0 && dt === 0) lift = need; spring(lift, liftV, need, 4, dt); lift = sp[0]; liftV = sp[1]; if (lift < 1e-4) lift = 0;
    camera.position.y = Math.max(y0 + lift, ground0 ? ground0(camera.position.x, -camera.position.z) + 0.1 : 0.12);
    camera.up.set(0, 1, 0); camera.lookAt(C.target);
    // radio passes through the walls around the rover while it listens, and around a person as they are found
    const listening = S && S.sensors && S.sensors.listen, gk = mode === 'cinematic' || mode === 'follow' || mode === 'orbit';
    if (gk && find && now < find.until) { glass.x = find.pos[0]; glass.z = -find.pos[1]; glass.r = 5.5; }
    else if (gk && listening) { const r = unit(S, 'HOUND-01'); glass.x = r.pos[0]; glass.z = -r.pos[1]; glass.r = 6.2; } else glass.r = 0;
    const near = clamp(C.dist * 0.02, 0.06, 2.5), far = 5200, vx = Math.round(-safeC.x * 2) / 2, vy = Math.round(-safeC.y * 2) / 2;
    if (camera.fov !== C.fov || camera.near !== near || camera.aspect !== aspect || view.x !== vx || view.y !== vy || view.w !== viewW || view.h !== viewH) {
      camera.fov = C.fov; camera.near = near; camera.far = far; camera.aspect = aspect; view.x = vx; view.y = vy; view.w = viewW; view.h = viewH;
      if (viewW && (vx || vy)) camera.setViewOffset(viewW, viewH, vx, vy, viewW, viewH); else { camera.clearViewOffset(); } camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  return {
    update, setMode, focus, flyTo, groundAt,
    get mode() { return mode; }, get pose() { return C; }, get goal() { return G; }, glass, safe, setSafeArea(a = {}) { for (const k of ['left', 'top', 'right', 'bottom']) safe[k] = Math.max(0, +a[k] || 0); }, setGround(fn) { ground0 = fn; },
    get dof() { return mode === 'cinematic' && !userActive() ? DOF[shot.key] || 0 : 0; }, get shot() { return mode === 'cinematic' ? shot.key : ''; },
    get userActive() { return userActive(); }, wasDrag: () => moved >= 4,
    setPose(p) { copyPose(G, { ...G, ...p, target: p.target ? p.target : G.target }); copyPose(C, G); soft = Math.max(soft, 0.6); softRate = 0.5; },
    dispose() {
      offs.forEach((f) => f());
      dom.removeEventListener('pointerdown', onDown); dom.removeEventListener('pointermove', onMove); dom.removeEventListener('pointerup', onUp); dom.removeEventListener('pointercancel', onUp);
      dom.removeEventListener('wheel', onWheel); dom.removeEventListener('keydown', onKey); dom.removeEventListener('contextmenu', noMenu);
    },
  };
}
