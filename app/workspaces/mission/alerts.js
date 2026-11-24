// Moments that need the operator's eyes: a person found, a lead closed, a new hazard; and the route approval dialog.
import { agreement, whereOf } from './inspector.js';
import { createMap } from './map2d.js';
import { planPath } from '../../core/planner.js';
import { pathLength, pointAlong, pointInPoly } from '../../core/geometry.js';

export function createAlerts(app) {
  const { ctx } = app, { kit, sim } = ctx, { h, icon } = kit;
  const el = h('div.mission-alerts', { role: 'region', 'aria-label': 'Mission alerts', 'aria-live': 'assertive' });
  const cards = new Set();
  function add(card, ms) {
    // the person card stays on top; at most one smaller card sits under it
    const firstSmall = [...el.children].find((c) => !c.classList.contains('person'));
    if (card.classList.contains('person')) el.prepend(card); else el.insertBefore(card, firstSmall || null);
    cards.add(card);
    const smalls = [...cards].filter((c) => !c.classList.contains('person')); smalls.slice(0, Math.max(0, smalls.length - 1)).forEach(close);
    const people = [...cards].filter((c) => c.classList.contains('person')); people.slice(0, Math.max(0, people.length - 1)).forEach(close);
    let left = ms, last = performance.now(), paused = false;
    const life = card.querySelector('.mission-card-life i');
    const tick = () => { if (!cards.has(card)) return; const now = performance.now(); if (!paused && !document.hidden) left -= now - last; last = now; if (life) life.style.transform = 'scaleX(' + Math.max(0, left / ms) + ')'; if (left <= 0) close(card); else requestAnimationFrame(tick); };
    card.addEventListener('pointerenter', () => { paused = true; }); card.addEventListener('pointerleave', () => { paused = false; });
    card.addEventListener('focusin', () => { paused = true; }); card.addEventListener('focusout', () => { paused = false; });
    requestAnimationFrame(tick);
  }
  function close(card) { if (!cards.delete(card)) return; card.classList.add('out'); setTimeout(() => card.remove(), 240); }
  const x = (card) => h('button.btn.btn-ghost.btn-sm.btn-icon', { 'aria-label': 'Dismiss this alert', onclick: () => close(card()) }, icon('close'));

  function personFound(ev) {
    const S = sim.state, d = S.detections.find((q) => q.id === ev.det); if (!d) return;
    let card;
    const where = whereOf(d);
    const planBtn = h('button.btn', { 'data-plan': '', hidden: S.phase === 'rescue' || S.phase === 'complete', onclick: () => { close(card); app.planFromAlert(); } }, 'Plan rescue');
    card = h('div.mission-card.person.glass', { role: 'alertdialog', 'aria-label': 'Person found' },
      h('div.mission-card-top', null, h('i.mission-beacon'), h('span', null, 'Person found'), h('span.grow'), h('span.num.dim', null, kit.fmt.clock(ev.t)), x(() => card)),
      h('div.mission-card-main', null, h('b.num', null, (d.p * 100).toFixed(0) + ' %'), h('div', null, h('h2', null, 'Person found in ' + where + '.'), h('p', null, (d.p * 100).toFixed(0) + ' % confidence. ' + agreement(d)))),
      h('div.row', null, h('button.btn', { onclick: () => { close(card); app.select({ type: 'detection', id: d.id }, true); } }, 'Show evidence'), planBtn, h('span.grow'), h('span.tag.tag-sim', { title: 'The person and the readings are simulated. The Wi-Fi network and the fusion maths ran for real.' }, 'Simulated person')),
      h('div.mission-card-life', null, h('i')));
    add(card, 11000); app.pushIn({ type: 'detection', id: d.id });
  }
  function small(kind, head, text, sel, ms = 7000) {
    let card; card = h('div.mission-card.small.glass.' + kind, { role: 'status' },
      h('div.mission-card-top', null, icon(kind === 'closed' ? 'check' : 'alert', 15), h('span', null, head), h('span.grow'), sel ? h('button.mission-link', { onclick: () => { close(card); app.select(sel, true); } }, 'Show') : null, x(() => card)),
      h('p', null, text), h('div.mission-card-life', null, h('i')));
    add(card, ms);
  }
  ctx.bus.on('phase', ({ to }) => { if (to === 'rescue' || to === 'complete') for (const b of el.querySelectorAll('[data-plan]')) b.hidden = true; });
  return {
    el, small,
    onEvent(ev) {
      if (!app.visible) return;
      const S = sim.state, d = ev.det && S.detections.find((q) => q.id === ev.det);
      if (ev.code === 'PERSON_FOUND') personFound(ev);
      else if (ev.code === 'LEAD_CLOSED' && d) small('closed', 'Lead closed in ' + whereOf(d), d.reason + ' Final chance of a person: ' + (d.p * 100).toFixed(0) + ' %.', { type: 'detection', id: d.id });
      else if (ev.code === 'POSSIBLE_PERSON' && d) small('warn', 'Possible person in ' + whereOf(d), (d.p * 100).toFixed(0) + ' %. Not enough to be sure, and too much to ignore. It will get a second look before anyone is sent in.', { type: 'detection', id: d.id });
      else if (ev.code === 'TEAM_CHECK' && d) small('warn', 'Handed to the rescue team', ev.text, { type: 'detection', id: d.id });
      else if (ev.code === 'BATTERY_LOW' || ev.code === 'WINDOW_REJECTED' || ev.code === 'CSI_UNAVAILABLE' || ev.code === 'NO_PATH' || ev.code === 'ROOM_BLOCKED') small('warn', { BATTERY_LOW: 'Battery low', WINDOW_REJECTED: 'Wi-Fi window rejected', CSI_UNAVAILABLE: 'Searching without Wi-Fi', NO_PATH: 'No safe path', ROOM_BLOCKED: 'Room not searched' }[ev.code], ev.text, ev.room ? { type: 'room', id: ev.room } : ev.unit ? { type: 'unit', id: ev.unit } : null);
    },
    clear() { for (const c of [...cards]) close(c); },
  };
}

// ---------- the drill: a new hazard appears ----------
export function runDrill(app, where) {
  const { ctx } = app, { sim, world } = ctx, S = sim.state;
  const team = S.units['TEAM-1'], rover = S.units['HOUND-01'], route = S.routes.rescue;
  const active = team.path ? { who: team, name: 'the rescue team', goal: team.goal, path: [team.pos, ...team.path.slice(1)] } : rover.path ? { who: rover, name: 'HOUND-01', goal: rover.goal, path: rover.path } : route && route.status === 'planned' ? { who: team, name: 'the planned rescue route', goal: route.legs.find((l) => l.ok)?.access, path: route.legs.find((l) => l.ok)?.path, planned: true } : null;
  const before = route ? route.length : null;
  let poly = null, name = null, detour = null;
  if (where === 'path' && active?.path) {
    // Try spots along the path that are outdoors, and keep the first one that still leaves a way round.
    const from = active.who.pos, len = pathLength(active.path), B = world.BUILDING.rect;
    const lenBefore = planPath(sim.grid, from, active.goal, { nearest: true });
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2]) {
      const c = pointAlong(active.path, len * f).pos;
      if (c[0] > B[0] - 3 && c[0] < B[2] + 3 && c[1] > B[1] - 3 && c[1] < B[3] + 3) continue;
      if (Math.hypot(c[0] - from[0], c[1] - from[1]) < 6 || Math.hypot(c[0] - active.goal[0], c[1] - active.goal[1]) < 6) continue;
      const cand = [[c[0] - 2.5, c[1] - 2.5], [c[0] + 2.5, c[1] - 2.5], [c[0] + 2.5, c[1] + 2.5], [c[0] - 2.5, c[1] + 2.5]];
      const grid = world.buildGrid({ extraHazards: [...S.hazards, { id: 'x', kind: 'collapse', poly: cand, block: true }], avoid: route?.avoid });
      const res = planPath(grid, from, active.goal, { nearest: true });
      if (res.ok && lenBefore.ok && Math.abs((res.gap || 0) - (lenBefore.gap || 0)) < 0.6) { poly = cand; detour = { from: lenBefore.length, to: res.length }; name = 'Drill: second slide across the path of ' + active.name; break; }
    }
    if (!poly) { ctx.shell.toast('No spot on that path can be blocked and still leave a way round. Nothing was changed.', { level: 'info' }); return false; }
  }
  app.takeControl('drill');
  const ok = sim.command('newHazard', poly ? { poly, name } : { name: 'Drill: second slide, new debris in the main corridor' });
  if (!ok) return false;
  const S2 = sim.state, hz = S2.hazards[S2.hazards.length - 1], after = S2.routes.rescue ? S2.routes.rescue.length : null;
  const text = detour ? 'New debris blocks the way ahead of ' + active.name + '. The planner found a way round: ' + detour.from.toFixed(1) + ' m to go became ' + detour.to.toFixed(1) + ' m.' + (before != null && after != null && active.planned ? ' Whole route: ' + before.toFixed(0) + ' m, now ' + after.toFixed(0) + ' m.' : '')
    : 'New debris in the main corridor, west of the entrance hall. Every active path is planned again. Rooms that can no longer be reached are marked as not searched.' + (before != null && after != null && S2.routes.rescue.status === 'planned' ? ' Route: ' + before.toFixed(0) + ' m, now ' + after.toFixed(0) + ' m.' : '');
  app.alerts.small('danger', 'Drill: new hazard', text, { type: 'hazard', id: hz.id }, 10000);
  app.select({ type: 'hazard', id: hz.id }, true);
  return true;
}

// Hazard areas the planned path really enters. Some kinds cost the planner extra but do not block it, so the
// approval dialog has to say when a route goes through one.
export function crossed(r, S, world) {
  const names = new Set();
  for (const l of r.legs) if (l.ok) { const len = pathLength(l.path); for (let s = 0; s <= len; s += 0.5) { const p = pointAlong(l.path, s).pos; for (const hz of [...world.HAZARDS, ...S.hazards]) if (pointInPoly(p, hz.poly)) names.add(hz.name); } }
  return [...names];
}

// ---------- route approval ----------
const AVOID = [['slope', 'Unstable slope'], ['mud', 'Deep mud and debris'], ['gas', 'Possible gas (concept sensor)'], ['collapse', 'Collapse-risk areas']];
export function createRouteDialog(app) {
  const { ctx } = app, { kit, sim, bus, world } = ctx, { h, icon, fmt, realityTag } = kit;
  let wrap = null, map = null, prevFocus = null, lastLen = null, offs = [];
  const content = h('div.mission-route-side');
  function render() {
    const S = sim.state, r = S.routes.rescue;
    if (!r || r.status !== 'planned') return close();
    const legs = r.legs, good = legs.filter((l) => l.ok), order = legs.map((l) => l.det);
    const delta = lastLen != null && Math.abs(lastLen - r.length) > 0.5 ? (r.length > lastLen ? '+' : '−') + Math.abs(r.length - lastLen).toFixed(0) + ' m against the last plan' : '';
    const breaks = good.filter((l) => !l.reached);
    let n = 0;
    content.replaceChildren(...[
      h('header', null, h('div', null, h('h2', null, 'Rescue route for approval'), h('p.muted', null, 'Nobody moves until a person approves this. Planned ' + fmt.clock(r.plannedAt) + ' by the route planner (A* on a 0.5 m grid).')), realityTag('live-algo')),
      h('div.mission-route-stats', null,
        h('div.stat', null, h('b', null, r.length.toFixed(0) + ' m'), h('span', null, 'on foot' + (delta ? ' · ' + delta : ''))),
        h('div.stat', null, h('b', null, r.etaS < 90 ? Math.round(r.etaS) + ' s' : (r.etaS / 60).toFixed(1) + ' min'), h('span', null, 'at 1.1 m/s (assumed)')),
        h('div.stat', null, h('b', null, String(good.length)), h('span', null, good.length === 1 ? 'stop' : 'stops')),
        h('div.stat', null, h('b', null, String(breaks.length)), h('span', null, breaks.length === 1 ? 'wall to break through' : 'walls to break through'))),
      h('h4', null, 'Stops, in order'),
      h('ol.mission-route-stops', null, ...legs.map((l, i) => { const d = S.detections.find((q) => q.id === l.det); if (l.ok) n++;
        return h('li' + (l.ok ? '' : '.bad'), null, h('i.mission-route-n', null, l.ok ? String(n) : '!'),
          h('div.grow', null, h('b', null, d.room ? world.roomById(d.room).name : 'Debris field, outdoors'), h('span.tag.' + (d.status === 'confirmed' ? 'tag-person' : 'tag-warn'), null, d.status === 'confirmed' ? 'Person ' + (d.p * 100).toFixed(0) + ' %' : 'Possible ' + (d.p * 100).toFixed(0) + ' %'),
            h('p', null, !l.ok ? 'No way to this stop: ' + l.reason : l.reached ? 'Walk in. ' + l.length.toFixed(0) + ' m from the stop before.' : 'Break through: the route ends at the wall, ' + l.gap.toFixed(1) + ' m from the person. ' + l.length.toFixed(0) + ' m from the stop before.')),
          h('div.mission-route-move', null, h('button.btn.btn-ghost.btn-sm.btn-icon', { disabled: i === 0, 'aria-label': 'Visit this stop earlier', onclick: () => reorder(order, i, -1) }, '↑'), h('button.btn.btn-ghost.btn-sm.btn-icon', { disabled: i === legs.length - 1, 'aria-label': 'Visit this stop later', onclick: () => reorder(order, i, 1) }, '↓'))); })),
      h('p.mission-sub', null, 'Suggested order: still people first, then moving people, then unconfirmed leads. It is a planning aid, not a medical assessment. Change it if you know better.'),
      h('h4', null, 'What the route goes around'),
      r.avoided.length ? h('ul.mission-route-avoid', null, ...r.avoided.map((a) => h('li', null, h('i'), a))) : h('p.mission-sub', null, 'Nothing lies between the team and the stops on this plan.'),
      crossed(r, S, world).length ? h('p.note.warn', null, 'The route still passes through: ' + crossed(r, S, world).join('; ') + '. The planner counts that ground as slower and riskier, but does not block it.') : null,
      h('h4', null, 'Keep clear of'),
      h('div.mission-route-opts', null, ...AVOID.map(([k, label]) => h('label.check', null, h('input', { type: 'checkbox', checked: r.avoid[k] !== false, onchange: (e) => replan({ avoid: { [k]: e.target.checked } }) }), label))),
      r.avoid.collapse === false ? h('p.note.danger', null, 'Collapse-risk areas are no longer blocked. The route may pass under the undercut wall. Not recommended.') : null,
      h('footer', null, h('button.btn.btn-lg', { onclick: () => { sim.command('rejectRoute'); close(); } }, 'Throw away'), h('button.btn.btn-lg', { onclick: close }, 'Decide later'), h('span.grow'), h('button.btn.btn-primary.btn-lg.mission-approve', { onclick: approve }, 'Approve route'))].filter(Boolean));
    if (map) { const xs = [], ys = []; for (const l of good) for (const p of l.path) { xs.push(p[0]); ys.push(p[1]); } for (const l of good) { const d = S.detections.find((q) => q.id === l.det); if (d?.pos) { xs.push(d.pos[0]); ys.push(d.pos[1]); } } if (xs.length) map.fitRect([Math.min(...xs) - 5, Math.min(...ys) - 5, Math.max(...xs) + 5, Math.max(...ys) + 5]); }
  }
  function replan(args) { lastLen = sim.state.routes.rescue?.length ?? null; app.avoid = { ...app.avoid, ...(args.avoid || {}) }; if (!sim.command('planRoute', args)) ctx.shell.toast('The route could not be planned again.', { level: 'alert' }); }
  function reorder(order, i, dir) { const o = order.slice(); const j = i + dir; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; replan({ order: o }); }
  function approve() { if (sim.command('approveRoute')) { close(); ctx.shell.toast('Route approved by ' + sim.state.operator + '. The rescue team is moving.', { level: 'ok' }); app.setCamera(app.twin ? 'cinematic' : 'site'); } }
  function close() { if (!wrap) return; map?.dispose(); map = null; offs.forEach((f) => f()); offs = []; wrap.remove(); wrap = null; prevFocus?.focus?.(); app.onDialog?.(false); }
  function open() {
    const r = sim.state.routes.rescue; if (!r || r.status !== 'planned' || wrap) return;
    prevFocus = document.activeElement; lastLen = null;
    const canvas = h('canvas.mission-route-map');
    const dialog = h('div.mission-route.glass', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Rescue route for approval' }, h('div.mission-route-mapwrap', null, canvas, h('span.tag.tag-sim', null, 'Simulated site')), content);
    wrap = h('div.mission-scrim', { onclick: (e) => { if (e.target === wrap) close(); }, onkeydown: (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Tab') { const f = [...dialog.querySelectorAll('button:not([disabled]), input, canvas[tabindex]')]; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } } }, dialog);
    app.root.append(wrap);
    map = createMap(canvas, ctx, { interactive: true }); map.setLayer('sensing', false); map.setLayer('coverage', false); map.setPad({ l: 24, r: 24, t: 24, b: 24 }); map.start();
    offs = [bus.on('route', () => setTimeout(render, 0)), bus.on('seek', close), bus.on('reset', close), bus.on('escape', close)];
    render(); app.onDialog?.(true);
    requestAnimationFrame(() => content.querySelector('.mission-approve')?.focus());
  }
  return { open, close, get isOpen() { return !!wrap; } };
}
