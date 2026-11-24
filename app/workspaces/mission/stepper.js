// The left panel: where the mission is, the one decision that needs a person, and the units.
const MODE = { idle: 'waiting', drive: 'driving', listen: 'listening', hold: 'holding', fault: 'link lost', swap: 'needs a battery', takeoff: 'taking off', scan: 'surveying', return: 'returning', landed: 'landed' };

// The next human decision, worked out from the mission state. null means nothing is waiting for a person.
export function decision(S, world) {
  const rover = S.units['HOUND-01'];
  if (S.hold) return null; // Resume is the primary button in the top bar while all stop is on
  if (S.phase === 'standby' && !S.started) return { key: 'start', label: 'Start mission', hint: 'The drone maps the site first, then HOUND-01 drives in.', autoIn: 1.5, autoSays: 'starts the mission', run: (app) => app.ctx.sim.command('start') };
  if (rover.mode === 'swap') return { key: 'swap', label: 'Swap the battery', hint: 'HOUND-01 is back at staging with a low battery. The search continues after the swap.', autoIn: 4, autoSays: 'swaps the battery', run: (app) => app.ctx.sim.command('swapBattery') };
  if (S.phase === 'assess') {
    const open = S.detections.filter((d) => d.status === 'possible' && !d.needsTeam), busy = S.queue.length || rover.mode === 'drive' || rover.mode === 'listen';
    if (open.length && !busy) { const d = open[0]; return { key: 'check' + d.id, label: 'Check this lead', det: d.id, hint: (d.room ? 'Room ' + d.room : 'Outdoors') + ', ' + (d.p * 100).toFixed(0) + ' %. ' + (d.outdoor ? 'Too far for the rover: it will be handed to the rescue team.' : 'HOUND-01 moves for a clear view and listens again.'), autoIn: 2, autoSays: 'checks it', run: (app) => app.ctx.sim.command('investigate', { id: d.id }),
      more: [{ label: 'Dismiss', run: (app) => app.dismiss(d) }, { label: 'Skip the checks', title: 'Stop checking leads and move on to planning', run: (app) => app.ctx.sim.command('finishAssess') }] }; }
  }
  if (S.phase === 'plan') {
    const r = S.routes.rescue;
    if (!r) return { key: 'plan', label: 'Plan the rescue route', hint: 'The planner finds the safest way to each person, around the hazards. You approve it before anyone moves.', autoIn: 2, autoSays: 'plans the route', run: (app) => app.planRoute() };
    if (r.status === 'planned') return { key: 'approve' + r.plannedAt, label: 'Approve route', hint: r.length.toFixed(0) + ' m, about ' + Math.max(1, Math.round(r.etaS / 60)) + ' min on foot, ' + r.legs.filter((l) => l.ok).length + ' stops. Review it, then approve.', autoIn: 4, autoSays: 'approves it', run: (app) => app.openRoute() };
  }
  if (S.phase === 'complete') return { key: 'done', label: 'Open the hand-over report', hint: 'Written from the mission log, ready to print.', noAuto: true, keep: true, run: (app) => app.ctx.shell.open('report'), more: [{ label: 'Run again', run: (app) => app.restart() }] };
  return null;
}

function progressLine(S, world) {
  const rover = S.units['HOUND-01'], team = S.units['TEAM-1'];
  if (S.phase === 'aerial') return S.map.ready ? 'Survey done. The drone is returning to its pad.' : 'Survey ' + (S.map.scan * 100).toFixed(0) + ' % of the site.';
  if (S.phase === 'deploy') return 'HOUND-01 is ' + Math.hypot(world.SITE.entrance[0] - rover.pos[0], world.SITE.entrance[1] - rover.pos[1]).toFixed(0) + ' m from the entrance.';
  if (S.phase === 'search') { const done = world.STOPS.filter((s) => s.covers.some((id) => S.coverage[id]?.stop === s.id)).length; const L = S.sensors.listen; return L ? 'Stop ' + L.stop + ': listening, ' + Math.ceil((1 - L.progress) * L.dur) + ' s left of window ' + L.window + '.' : 'Stop ' + Math.min(world.STOPS.length, done + 1) + ' of ' + world.STOPS.length + '. ' + (rover.mode === 'drive' ? 'Driving to it.' : ''); }
  if (S.phase === 'assess') { const open = S.detections.filter((d) => d.status === 'possible' && !d.needsTeam).length; const L = S.sensors.listen; return L ? 'Second look: listening, ' + Math.ceil((1 - L.progress) * L.dur) + ' s left.' : rover.mode === 'drive' ? 'HOUND-01 is moving for a clear view.' : open + ' lead' + (open === 1 ? '' : 's') + ' still uncertain.'; }
  if (S.phase === 'plan') return S.routes.rescue ? 'Route planned. Waiting for a person to approve it.' : 'No route yet.';
  if (S.phase === 'rescue') { const r = S.routes.rescue, legs = r.legs.filter((l) => l.ok), n = legs.filter((l) => l.arrivedAt != null).length; return n >= legs.length ? 'Team at the last stop.' : 'Leg ' + (n + 1) + ' of ' + legs.length + (team.goal ? ', ' + Math.hypot(team.goal[0] - team.pos[0], team.goal[1] - team.pos[1]).toFixed(0) + ' m in a straight line to go.' : '.'); }
  return '';
}

export function createStepper(app) {
  const { ctx } = app, { kit, sim, world } = ctx, { h, icon, fmt } = kit;
  const PH = Object.keys(ctx.PHASE_INFO);
  const rows = PH.map((id, i) => { const time = h('span.num.dim'), detail = h('p'); const el = h('li.mission-ph', { 'data-id': id }, h('i.mission-ph-mark', null, h('span.num', null, String(i + 1))), h('div', null, h('div.row', null, h('b', null, ctx.PHASE_INFO[id].label), h('span.grow'), time), detail)); return { id, el, time, detail }; });
  const primary = h('button.btn.btn-primary.btn-lg.mission-primary', { onclick: () => app.decide() });
  const ring = h('i.mission-ring'), dHint = h('p.mission-dhint'), dAuto = h('p.mission-dauto'), more = h('div.row.wrap');
  const idle = h('div.mission-idle', null, h('i'), h('span'));
  const modeSeg = h('div.seg.mission-mode', { role: 'group', 'aria-label': 'Who makes the routine choices' },
    h('button', { onclick: () => app.setAutoplay(true), title: 'The mission makes the routine choices by itself, so it can be watched like a film.' }, 'Autoplay'),
    h('button', { onclick: () => app.setAutoplay(false), title: 'Every step waits for you: start, check leads, plan and approve.' }, 'Manual'));
  const tally = { people: h('b.num'), leads: h('b.num'), rooms: h('b.num') };
  const unitEls = Object.values(sim.state.units).map((u) => { const mode = h('span.dim'), bat = h('i'), batv = h('span.num.dim'), link = h('span.num.dim'); const el = h('button.mission-unit', { 'data-id': u.id, onclick: () => app.select({ type: 'unit', id: u.id }, true) }, icon(u.kind === 'team' ? 'person' : u.kind, 16), h('b', null, u.name), u.built ? null : h('small', { title: u.kind === 'drone' ? 'Concept: only one rover has been built.' : 'Simulated.' }, u.kind === 'drone' ? 'concept' : 'simulated'), h('span.grow'), mode, u.kind === 'rover' ? h('div.mission-unit-tele', null, h('div.bar', { title: 'Battery (simulated)' }, bat), batv, link) : null); return { id: u.id, el, mode, bat, batv, link }; });
  const el = h('div.mission-step', null,
    h('ol.mission-phases', { 'aria-label': 'Mission phases' }, ...rows.map((r) => r.el)),
    h('div.mission-decide', { 'aria-live': 'polite' }, primary, dHint, dAuto, more, idle),
    h('div.mission-tally', null, h('span', null, tally.people, ' found'), h('span', null, tally.leads, ' leads open'), h('span', null, tally.rooms, ' rooms searched')),
    h('div.mission-units', { role: 'group', 'aria-label': 'Units' }, ...unitEls.map((u) => u.el)));
  let dKey = null, dT0 = 0, moreKey = null, lastState = null;
  function update() {
    const S = sim.state, cur = PH.indexOf(S.phase);
    if (S !== lastState) { lastState = S; dKey = null; }
    const entered = { standby: 0 }; for (const e of S.events) if (e.code === 'PHASE') { const id = PH.find((k) => e.text.startsWith(ctx.PHASE_INFO[k].label + '.')); if (id) entered[id] = e.t; }
    rows.forEach((r, i) => { const state = i < cur || (S.phase === 'complete' && i === cur) ? 'done' : i === cur ? 'now' : 'next'; if (r.el.dataset.state !== state) { r.el.dataset.state = state; if (state === 'now') r.el.setAttribute('aria-current', 'step'); else r.el.removeAttribute('aria-current'); }
      const tt = entered[r.id] != null && i ? fmt.clock(entered[r.id]) : ''; if (r.time.textContent !== tt) r.time.textContent = tt;
      const txt = state === 'now' ? (S.hold ? 'All stop. Every unit is holding.' : [ctx.PHASE_INFO[r.id].hint, progressLine(S, world)].filter(Boolean).join(' ')) : ''; if (r.detail.textContent !== txt) r.detail.textContent = txt; });
    modeSeg.children[0].setAttribute('aria-pressed', String(S.autoplay)); modeSeg.children[1].setAttribute('aria-pressed', String(!S.autoplay));
    const d = decision(S, world); app.pending = d;
    if (d) {
      if (d.key !== dKey) { dKey = d.key; dT0 = S.t; }
      primary.hidden = false; idle.hidden = true; if (primary.firstChild?.textContent !== d.label) primary.replaceChildren(h('span', null, d.label), ring);
      dHint.textContent = d.hint;
      const auto = S.autoplay && !d.noAuto, left = auto ? Math.max(0, d.autoIn - (S.t - dT0)) : 0;
      primary.classList.toggle('auto', auto); ring.hidden = !auto; if (auto) ring.style.setProperty('--f', String(1 - left / d.autoIn));
      dAuto.hidden = !auto; if (auto) dAuto.textContent = 'Autoplay ' + d.autoSays + ' in ' + Math.ceil(left) + ' s of mission time. Press to take control yourself.';
      const mk = d.key + (d.more ? d.more.length : 0); if (mk !== moreKey) { moreKey = mk; more.replaceChildren(...(d.more || []).map((m) => h('button.btn.btn-sm', { title: m.title || null, onclick: () => { app.takeControl(); m.run(app); } }, m.label))); }
    } else {
      dKey = null; primary.hidden = true; dHint.textContent = ''; dAuto.hidden = true; if (moreKey) { moreKey = null; more.replaceChildren(); }
      idle.hidden = false; idle.lastChild.textContent = S.hold ? 'All stop is on. Every unit is holding. Press Resume in the top bar to continue.' : S.autoplay ? 'No decision is waiting. Autoplay is on.' : 'No decision is waiting. You will be asked at the next one.';
    }
    const dets = S.detections; tally.people.textContent = String(Object.keys(S.survivors).length); tally.leads.textContent = String(dets.filter((x) => x.status === 'possible').length);
    const cov = Object.values(S.coverage); tally.rooms.textContent = cov.filter((c) => c.status !== 'unsearched' && c.status !== 'blocked').length + '/' + cov.length;
    for (const ue of unitEls) { const u = S.units[ue.id]; const m = (S.hold && u.mode !== 'landed' && u.mode !== 'idle' ? 'holding' : u.kind === 'team' && u.mode === 'drive' ? 'walking the route' : MODE[u.mode] || u.mode) + (u.mode === 'listen' && u.stop ? ' at ' + u.stop : ''); if (ue.mode.textContent !== m) ue.mode.textContent = m;
      if (u.kind === 'rover') { ue.bat.style.width = u.battery * 100 + '%'; ue.bat.style.background = u.battery <= 0.15 ? 'var(--danger)' : 'var(--text-2)'; ue.batv.textContent = (u.battery * 100).toFixed(0) + ' %'; ue.link.textContent = 'link ' + (u.link * 100).toFixed(0) + ' %'; ue.link.classList.toggle('bad', u.link < 0.2); }
      ue.el.setAttribute('aria-pressed', String(ctx.selection?.type === 'unit' && ctx.selection.id === u.id)); }
  }
  return { el, update, primary, modeSeg };
}
