// The guide: one or two calm sentences that say what is happening and why, as the mission moves.
// It is optional (the Guide button in the Mission toolbar, or the bus event 'narration:set' { on }). It is worked out
// from the mission state, so it is right after a restart or after scrubbing the timeline. It docks into the element
// marked data-narration-slot in the Mission workspace, low and to the side, so it never covers the subject.
const KEY = 'hound.narration';

// What to say for a log entry. Returns null for entries that need no explanation.
function lineFor(e, S, ctx) {
  const det = e.det && S.detections.find((d) => d.id === e.det);
  const where = det ? (det.room ? 'room ' + det.room : 'the debris field') : '';
  switch (e.code) {
    case 'MISSION_START': return 'This is a training exercise. The building, the people and most sensor readings are simulated; the Wi-Fi neural network, the fusion and the route planner are running for real.';
    case 'PHASE':
      if (S.phase === 'aerial' && e.text.startsWith(ctx.PHASE_INFO.aerial.label)) return 'A scout drone maps the site first, so the rover knows where it can drive. The drone is a concept: only the rover has been built.';
      if (e.text.startsWith(ctx.PHASE_INFO.deploy.label)) return 'HOUND-01 drives in so that people do not have to. It plans its own path around the mud and the unstable slope.';
      if (e.text.startsWith(ctx.PHASE_INFO.search.label)) return 'The rover stops outside each room and listens through the wall. It has to stand still: the network needs 10 seconds of undisturbed Wi-Fi signal.';
      if (e.text.startsWith(ctx.PHASE_INFO.assess.label)) return 'Before anyone is sent in, every uncertain lead gets a second look from a better position.';
      if (e.text.startsWith(ctx.PHASE_INFO.plan.label)) return 'Now a route for the rescue team. The planner proposes; a person must approve it before anyone moves.';
      if (e.text.startsWith(ctx.PHASE_INFO.rescue.label)) return 'The team walks the approved route. If the map changes, the route is planned again at once.';
      return null;
    case 'MAP_READY': return 'The site map is ready. From here on, every path is planned on it.';
    case 'LISTEN': return 'Listening. Two ESP32 boards send and measure 100 Wi-Fi probes a second; a small neural network reads the 10 second window and answers: person, or no one.';
    case 'LISTEN_AGAIN': return 'One window was not enough to be sure, so the rover listens for a second one. A repeat from the same spot counts at half weight.';
    case 'POSSIBLE_PERSON':
      if (det?.outdoor) return 'The drone image shows a person-shaped object in the debris field. One sign is not proof, so it is kept as a possible person, not a find.';
      return 'A weak sign of a person in ' + where + '. Someone lying still is the hard case: in simulation the network alone finds a still person only 21 % of the time. So the lead stays open.';
    case 'PERSON_FOUND': {
      const n = det ? new Set(det.evidence.filter((x) => ['pos', 'faint'].includes(x.result)).map((x) => x.sensor)).size : 0;
      return 'Person found in ' + where + '. ' + (n > 1 ? 'No single sensor decided this: ' + n + ' independent sensors agreed, and each one moved the probability.' : 'Open the evidence to see what moved the probability.') + ' Select the marker to see every step.';
    }
    case 'LEAD_CLOSED':
      if (det?.kind === 'machine') return 'The radar saw motion in ' + where + ', but it repeats too steadily and there is no body heat. The lead is closed as a machine, most likely a fan. Closing false alarms matters as much as finding people.';
      if (det?.kind === 'hot object') return 'A hot spot in ' + where + ', but at 55 °C it is far hotter than skin and nothing moves. The lead is closed as a hot object.';
      if (det?.kind === 'dismissed') return 'The operator dismissed the lead in ' + where + '. The log records who decided.';
      return 'The Wi-Fi network raised an alarm in ' + where + ' that radar and thermal did not support. It is closed as a false alarm, and shown, not hidden.';
    case 'ROOM_CLEAR': return 'Room ' + e.room + ' is marked clear, with a number: the chance that someone was missed. A quiet reading lowers the risk; it never makes it zero.';
    case 'ROOM_BLOCKED': return 'Room ' + e.room + ' could not be reached. It is marked as not searched, so nobody mistakes it for clear.';
    case 'INVESTIGATE': return 'HOUND-01 moves to where the thermal camera has a clear line of sight to the lead, then listens again.';
    case 'TEAM_CHECK': return 'The rover cannot settle this lead, so it is handed to the rescue team to check in person. Uncertain is reported as uncertain.';
    case 'ROUTE_PLANNED': return 'The route is planned around the hazards. Where a person is behind a wall with no way in, it ends at the closest safe point to break through. It now waits for approval.';
    case 'ROUTE_APPROVED': return 'Route approved' + (S.routes.rescue?.approvedBy === 'autoplay' ? ' by autoplay, for this demonstration. In manual mode a person must press Approve.' : '. A person made this decision, not the software.');
    case 'TEAM_ARRIVED': return e.text.includes('breaking through') ? 'The team is at the wall, at the closest safe point to the person, and breaks through from there.' : 'The team has reached the person. The team and its movement are simulated.';
    case 'NEW_HAZARD': return 'A drill: new debris has come down. Every active path is planned again on the changed map.';
    case 'REPLANNED': return 'A new way round was found, so the unit keeps moving.';
    case 'ALL_STOP': return 'All stop. Every unit holds where it is until a person resumes.';
    case 'FAULT': return 'A fault drill. Watch what the system does: it holds, repeats or carries on without the broken sensor, and says so.';
    case 'BATTERY_LOW': return 'The battery is low. The rover returns to staging for a swap and then picks up where it left off.';
    case 'MISSION_COMPLETE': return 'Everyone found has been reached. The Report workspace has the hand-over, written from this log. Drag the timeline to replay any moment.';
    case 'NO_ONE_FOUND': return 'No one was found. The coverage map still says what was searched, what was not, and how sure each answer is.';
    default: return null;
  }
}

export function init(ctx) {
  const { bus, kit } = ctx, { h } = kit;
  let on = true; try { on = localStorage.getItem(KEY) !== 'off'; } catch { /* no storage */ }
  const text = h('p', { 'aria-live': 'polite' });
  const el = h('div.hound-narr.glass', { role: 'note', 'aria-label': 'Guide', hidden: true }, h('i.hound-narr-mark'), h('div', { style: { flex: '1', minWidth: '0' } }, h('small', null, 'Guide'), text));
  let shownId = null, shownAt = 0, swapTimer = 0;
  const slot = () => document.querySelector('[data-narration-slot]');
  function place() { const s = ctx.shell.current() === 'mission' ? slot() : null; if (s && el.parentNode !== s) s.append(el); el.hidden = !(on && s && text.textContent); }
  function show(id, line, instant) {
    shownId = id; shownAt = performance.now(); clearTimeout(swapTimer);
    if (instant || !text.textContent || kit.reducedMotion()) { text.textContent = line; text.classList.remove('swap'); }
    else { text.classList.add('swap'); swapTimer = setTimeout(() => { text.textContent = line; text.classList.remove('swap'); }, 180); }
    place(); if (on) el.hidden = !slot() || ctx.shell.current() !== 'mission';
  }
  // The newest log entry that has something worth saying. A line stays up for at least 2.6 s unless an alert arrives.
  function update(instant) {
    const S = ctx.sim?.state; if (!S) return;
    if (!S.events.length) { if (shownId !== 'ready') show('ready', S.autoplay ? 'The mission starts by itself in a moment. Press Manual on the left to make every decision yourself.' : 'Press Start mission when you are ready. Nothing moves until you do.', instant); return; }
    for (let i = S.events.length - 1; i >= 0 && i >= S.events.length - 12; i--) {
      const e = S.events[i], line = lineFor(e, S, ctx); if (!line) continue;
      if (e.id === shownId) return;
      const urgent = e.level === 'alert' || instant;
      if (!urgent && performance.now() - shownAt < 2600) return;
      show(e.id, line, instant); return;
    }
  }
  bus.on('tick', () => update(false));
  bus.on('seek', () => { shownId = null; update(true); }); bus.on('reset', () => { shownId = null; text.textContent = ''; update(true); });
  bus.on('workspace', () => { place(); update(true); }); bus.on('mission:shown', () => { place(); update(true); });
  bus.on('narration:set', (p) => { on = !!p?.on; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* no storage */ } place(); bus.emit('narration:state', { on }); });
  ctx.narration = { get on() { return on; }, set(v) { bus.emit('narration:set', { on: v }); } };
  place(); update(true); bus.emit('narration:state', { on });
}
