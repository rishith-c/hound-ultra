// Triage, Demo mode: a finished (simulated) search, one team, and a column of light over every person and open lead.
// Height is the priority score from model.js, live. Minutes pass, scores rise, the order changes by itself if the numbers say so.
import { createStage, newEngine, advance, ease } from './stage.js';
import * as M from './model.js';

const PT = 0.15;                                   // metres of light per point of score
const RISE = 3.6, WAIT = 13, HOLD = 15.5, WAY = 24.5, CUT = 32, LOOP = 35, MAX_MIN = 20;

export function createHero(root, ctx) {
  const { h, realityTag, icon } = ctx.kit, reduced = () => ctx.kit.reducedMotion();
  const scene3d = h('div.th-scene'), tags = h('div.th-tags', { 'aria-hidden': 'true' });
  const line = h('p.th-line', null, 'Taller light, higher priority.'), clock = h('b', null, '0'), wayBtn = h('button.btn.btn-primary.btn-lg.th-go', { onclick: () => jump(HOLD) }, icon('route'), h('span', null, 'Show the way in'));
  const steps = h('div.th-steps', { role: 'group', 'aria-label': 'What matters most' }, ...M.PRESETS.map((p) => h('button', { 'aria-pressed': String(p.id === 'balanced'), onclick: () => choose(p) }, p.label)));
  const el = h('section.th.demo-only', { 'aria-label': 'Who to reach first' }, scene3d, h('div.th-shade'), tags,
    h('div.th-low', null, h('div.th-title', null, h('div.row', null, realityTag('live-algo'), realityTag('sim')), h('h1', null, 'Who first?'), line), h('div.grow'), h('div.th-clock', null, h('div', null, h('span', null, '+'), clock, h('small', null, 'min')), h('span', null, 'waiting, assumed curve')), wayBtn),
    h('div.th-foot', null, steps, h('div.grow'), h('span.th-aid', null, 'Planning aid. Not a medical assessment.')));
  root.append(el);

  let stage = null, loading = false, on = false, dead = false, people = [], weights = M.DEFAULT_WEIGHTS, u = 0, order = [], route = null, opening = null, cutU = 0, minutes = 0, said = '', head = { x: 0, z: 0 }, headYaw = 0, px = { x: 0, y: 0, on: true };
  const say = (t) => { if (t === said) return; said = t; line.classList.add('swap'); setTimeout(() => { line.textContent = t; line.classList.remove('swap'); }, reduced() ? 0 : 220); };
  function jump(t) { u = t; }
  function choose(p) { weights = p.w; [...steps.children].forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === p.label))); if (!stage?.ok) return; score(); reroute(); if (u > HOLD) jump(WAIT); if (reduced()) settle(); }

  function score() {
    for (const p of people) p.target = M.scoreTarget({ ...p.t, waitS: p.t.waitS + minutes * 60 }, weights).total;
    const next = [...people].sort((a, b) => b.target - a.target), key = next.map((p) => p.t.id).join();
    if (key !== order.map((p) => p.t.id).join()) { order = next; order.forEach((p, i) => { if (p.rank.textContent !== String(i + 1)) { p.rank.textContent = String(i + 1); p.tag.dataset.first = String(i === 0); p.rank.animate?.([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: reduced() ? 0 : 420, easing: 'cubic-bezier(.2,.7,.2,1)' }); } }); return true; }
    return false;
  }
  function reroute() {
    route?.dispose(); route = null;
    const S = stage.engine.state, path = []; let from = S.units['TEAM-1'].pos; const ends = [];
    for (const p of order) { const r = M.planCached(stage.engine, from, p.t.det.pos, true); if (!r.ok) continue; path.push(...(path.length ? r.path.slice(1) : r.path)); from = r.path[r.path.length - 1]; let L = 0; for (let i = 1; i < path.length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); ends.push(L); }
    if (path.length < 2) return; const hz = M.allHazards(S), pip = (q) => hz.some((z) => M.inside(q, z.poly));
    route = stage.ribbon(path, '--accent', { width: 0.42, hot: pip }); route.ends = ends; route.alpha(0);
  }

  async function load() {
    if (loading || stage || dead) return; loading = true;
    try {
      const e = newEngine(ctx); await advance(e, (S) => S.phase === 'plan', () => !dead); if (dead) return;
      stage = await createStage(scene3d, ctx, e, { light: 'night' }); if (!stage.ok) return;
      const S = e.state, from = S.units['TEAM-1'].pos;
      people = S.detections.filter((d) => d.status === 'confirmed' || (d.status === 'possible')).map((det) => {
        const t = M.describeTarget(e, det, from), sure = det.status === 'confirmed', rank = h('b.th-rank'), val = h('span.th-val'), tag = h('div.th-tag', { 'data-sure': String(sure) }, rank, h('div', null, h('span.th-where', null, det.outdoor ? 'Outdoors' : 'Room ' + det.room), h('span.th-sub', null, sure ? t.motion === 'still' ? 'person, still' : t.motion === 'moving' ? 'person, moving' : 'person' : 'possible, ' + Math.round(det.p * 100) + ' %')), val); tags.append(tag);
        return { t, beam: stage.beam(det.pos, sure ? '--person' : '--warn'), rank, val, tag, shown: 0, target: 0, top: new stage.THREE.Vector3() };
      });
      score(); reroute();
      const thru = people.find((p) => p.t.kind === 'break through' && M.approachSides(e, p.t.det, from).some((a) => a.usable));
      if (thru) { const a = M.approachSides(e, thru.t.det, from).find((x) => x.usable), d = thru.t.det.pos, L = Math.hypot(d[0] - a.foot[0], d[1] - a.foot[1]) || 1, dir = [(a.foot[0] - a.stand[0]) / M.ASSUMED.standOffM, (a.foot[1] - a.stand[1]) / M.ASSUMED.standOffM];
        opening = { a, p: thru, dir, box: stage.cut(a.foot, dir, '--accent'), bridge: stage.ribbon([a.foot, [(a.foot[0] + d[0]) / 2, (a.foot[1] + d[1]) / 2], d], '--accent', { width: 0.16, y: 0.75 }), tag: h('div.th-tag.th-gap', null, h('span.th-where', null, L.toFixed(1) + ' m behind the wall'), h('span.th-sub', null, a.wall.state === 'damaged' ? 'damaged ' + a.wall.mat : a.wall.mat)), mid: new stage.THREE.Vector3(a.foot[0], 1.9, -a.foot[1]) }; opening.yaw = Math.atan2(-dir[0], dir[1]); tags.append(opening.tag); }
      Object.assign(stage.rig, { rate: 0.75 }); wide(0); stage.rig.snap = true;
      stage.frames.push(tick); stage.start(); if (!on) stage.stop();
    } catch (err) { console.warn('[triage] the 3-D view could not start:', err); }
    finally { loading = false; }
  }
  function wide(s) { const g = stage.rig.goal; g.x = 80; g.y = 4.6; g.z = -49; g.yaw = -0.62 + s * 0.012; g.pitch = 0.3; g.dist = 52; g.fov = 36; stage.rig.dof = 0; }
  function settle() { minutes = MAX_MIN; score(); for (const p of people) p.shown = p.target; }

  let lastScore = -1;
  function tick(dt) {
    if (reduced()) { u = HOLD; settle(); } else { u += dt; if (u > LOOP) { u = 0; minutes = 0; } }
    const rise = ease(u / RISE), w = ease((u - RISE) / (WAIT - RISE)), back = ease((u - CUT) / (LOOP - CUT));
    minutes = u < RISE ? 0 : MAX_MIN * w * (1 - back);
    if (Math.abs(minutes - lastScore) > 0.08) { lastScore = minutes; if (score() && u < HOLD) reroute(); const m = String(Math.round(minutes)); if (clock.textContent !== m) clock.textContent = m; }
    const R = stage.rig, g = R.goal, way = ease((u - HOLD) / (WAY - HOLD - 0.6)), away = u > HOLD ? ease((u - HOLD) / 1.4) * (1 - back) : 0, close = opening ? ease((u - WAY) / 1.6) * (1 - ease((u - CUT + 0.6) / 1)) : 0;
    for (let i = 0; i < people.length; i++) {
      const p = people[i], k = 1 - Math.exp(-dt * 3.2), grow = ease((u - i * 0.5) / (RISE - 1)); p.shown += (p.target * grow - p.shown) * (reduced() ? 1 : k);
      const first = order[0] === p; p.beam.set(p.shown * PT, (first ? 1 : 0.62) * (1 - 0.55 * away) * rise); p.top.copy(p.beam.top); p.top.y += 0.35;
      stage.project(p.top, px); p.tag.style.transform = 'translate3d(' + px.x.toFixed(1) + 'px,' + px.y.toFixed(1) + 'px,0) translate(-50%,-100%)'; p.tag.style.opacity = px.on && grow > 0.3 ? (1 - close * 0.9).toFixed(3) : '0';
      const s = p.shown.toFixed(0); if (p.val.textContent !== s) p.val.textContent = s;
    }
    if (route) { route.alpha(away * (1 - close * 0.4)); route.to(route.length * way); }
    if (opening) { opening.box.alpha(close > 0.01 ? 1 - back : 0); opening.box.draw(ease((u - WAY - 0.8) / 2.6)); opening.bridge.alpha(close); opening.bridge.to(opening.bridge.length * ease((u - WAY - 3) / 1.6)); stage.project(opening.mid, px); opening.tag.style.transform = 'translate3d(' + px.x.toFixed(1) + 'px,' + px.y.toFixed(1) + 'px,0) translate(-50%,-140%)'; opening.tag.style.opacity = (px.on ? ease((u - WAY - 3.2) / 0.8) * close : 0).toFixed(3); R.glass.x = opening.p.t.det.pos[0]; R.glass.z = -opening.p.t.det.pos[1]; R.glass.r = 5.2 * close; }
    if (u < HOLD || u > CUT) { wide(u); R.rate = 0.75; say(u < RISE ? 'Taller light, higher priority.' : 'Every minute of waiting lifts the light.'); }
    else if (u < WAY && route) { route.at(route.length * way, head); const ex = head.x, ez = head.z; route.at(Math.min(route.length, route.length * way + 6), head); const y = Math.atan2(ex - head.x, ez - head.z); if (Math.abs(head.x - ex) + Math.abs(head.z - ez) > 0.5) headYaw = y; g.x = ex; g.y = 1; g.z = ez; g.yaw = headYaw * 0.5 + -0.3; g.pitch = 0.5; g.dist = 24; g.fov = 36; R.rate = 1.5; say('The planner draws the way in, around the slope and the mud.'); }
    else if (opening) { const f = opening.a.foot; g.x = f[0]; g.y = 1; g.z = -f[1]; g.yaw = opening.yaw + 0.42 - (u - WAY) * 0.02; g.pitch = 0.42; g.dist = 9.5; g.fov = 36; R.rate = 1.5; R.dof = 0; say('No door left here. Open the wall, from the safest side.'); }
  }
  return {
    show() { on = true; if (ctx.mode !== 'demo') return this.hide(); on = true; if (stage?.ok) { stage.start(); } else load(); },
    hide() { on = false; stage?.ok && stage.stop(); },
    get stage() { return stage; }, jump,
  };
}
