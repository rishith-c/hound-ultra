// Drill logic for the Training workspace. No DOM here.
// A drill is the real mission engine (core/sim.js createEngine) with autoplay off, a seed, and a level that decides
// how hard it is. The trainee makes the choices; the same scenario is then replayed with the autoplay policy
// for comparison. Ground truth is read ONLY by outcome() and score(), which the debrief calls after the drill ends.
import { createEngine, FAULTS } from '../../core/sim.js';
import { TRUTH, HAZARDS, ROOMS, UNITS, buildGrid } from '../../core/world.js';
import { planPath } from '../../core/planner.js';
import { mulberry32 } from '../../core/geometry.js';
import { exposureAlong } from '../triage/model.js';

export const ALL_AVOID = { slope: true, mud: true, gas: true, collapse: true };
export const AVOID_LABELS = { slope: 'Unstable slope', mud: 'Deep mud and debris', gas: 'Possible gas leak', collapse: 'Collapse-risk zone' };
export const REF_FAULT_S = 20; // the reference response time used for the autoplay comparison (assumed)
export const SLIDE = { poly: [[48, 17], [62, 17], [62, 27], [48, 27]], name: 'Second slide: fresh debris on the approach', block: false };

export const LEVELS = [
  { id: 1, name: 'First search', windows: 'scripted', faults: 0, preset: null, slide: false, coach: true,
    sub: 'The scripted building, no faults. A coach explains each decision as it comes.',
    facts: ['Scripted Wi-Fi windows', 'No faults', 'Coach on'] },
  { id: 2, name: 'Noisy sensors', windows: 'random', faults: 1, preset: { slope: false }, slide: false, coach: false,
    sub: 'Random Wi-Fi windows, so the network misses and false-alarms at its measured rates. One fault. The planner was left on a shortcut.',
    facts: ['Random Wi-Fi windows', 'One fault', 'Planner preset to check'] },
  { id: 3, name: 'Bad day', windows: 'random', faults: 2, preset: { slope: false }, slide: true, coach: false,
    sub: 'Random windows, two faults, a planner preset to catch, and a second slide after you plan.',
    facts: ['Random Wi-Fi windows', 'Two faults', 'Second slide'] },
];

// What the trainee is asked when a fault is raised. The right answer is what the system really does (sim.js FAULTS).
export const FAULT_QUIZ = {
  linkLoss: { ask: 'The radio link to HOUND-01 is gone. What is happening, and what do you do?', options: [
    { right: true, text: 'The rover is holding position by itself and has kept its readings. Restore the link, then carry on.', why: 'Right. On the real rover the Arduino stops the motors 400 ms after the Pi goes quiet; the console holds the mission until the link is back.' },
    { text: 'The rover is still driving on its last command. Send the team in to catch it.', why: 'No. It never drives blind: the motors stop by themselves when commands stop arriving.' },
    { text: 'Everything it has sensed so far is lost. Restart the search from the entrance.', why: 'No. Readings already received stay in the log. Nothing has to be repeated.' }] },
  csiDropout: { ask: 'Wi-Fi packets are dropping during a listening stop. What does that mean for this reading?', options: [
    { text: 'The network fills the gaps. Accept the window.', why: 'No. A window with more than 35 % of its packets missing is rejected, never patched up.' },
    { right: true, text: 'The window is rejected and repeated. Fix the link now, or this stop continues on radar and thermal only.', why: 'Right. After two failed tries the room is marked “searched without Wi-Fi”, which is weaker. Fixing it in time keeps the Wi-Fi reading.' },
    { text: 'A rejected window means nobody is there. Mark the room clear.', why: 'No. A rejected window says nothing about the room. Missing data is not a negative.' }] },
  badWindow: { ask: 'The network refused a Wi-Fi window: it contains a value that is not a number. What now?', options: [
    { text: 'Count it as “no one”. A broken window cannot be a person.', why: 'No. The reading is skipped, never guessed. A skipped reading is not evidence either way.' },
    { text: 'Count it as “person” to be safe.', why: 'No. Inventing a positive sends people into a damaged building for nothing. The reading is skipped.' },
    { right: true, text: 'Nothing was guessed. Clear the fault and let the rover listen again.', why: 'Right. The network checks its input and refuses anything that is not a number, then the stop repeats the window.' }] },
  thermalFail: { ask: 'The thermal camera has stopped responding. How does the search continue?', options: [
    { right: true, text: 'Fusion carries on without thermal and says so on each reading. Expect more leads to stay “possible”; have them checked in person.', why: 'Right. Thermal is what confirms a still person, so without it more leads are handed to the rescue team.' },
    { text: 'Stop the mission. Without thermal no reading is valid.', why: 'No. Wi-Fi and radar still work. The answers are less certain, and the console says which readings were affected.' },
    { text: 'No change. Thermal never mattered behind walls anyway.', why: 'No. Thermal cannot see through a wall, but it is the sensor that turns a still “possible” into “confirmed” from a clear viewpoint.' }] },
  lowBattery: { ask: 'HOUND-01 reports a low battery in the middle of the search. What happens?', options: [
    { text: 'It keeps searching until it stops. Recover it afterwards.', why: 'No. A dead rover inside the building is a new hazard. It returns before that.' },
    { right: true, text: 'It finishes its reading, returns to staging and waits. Swap the battery; it goes back to where it left off.', why: 'Right. The swap is your job. The rover resumes the same stop, so no room is skipped.' },
    { text: 'The search is over. Plan the rescue with what you have.', why: 'No. The rooms not yet searched would stay unsearched. Swap and continue.' }] },
};

const rover = (S) => S.units['HOUND-01'];
const TRIGGERS = {
  linkLoss: (S) => S.phase === 'deploy' && rover(S).odo > 22,
  csiDropout: (S) => S.sensors.listen?.stop === 'S3' && S.sensors.listen.window === 1 && S.sensors.listen.progress > 0.25,
  badWindow: (S) => S.sensors.listen?.stop === 'S2' && S.sensors.listen.progress > 0.4,
  thermalFail: (S) => S.phase === 'search' && S.coverage['101'].status !== 'unsearched' && rover(S).mode === 'drive',
  lowBattery: (S) => S.phase === 'search' && S.coverage['102'].status !== 'unsearched' && rover(S).mode === 'drive',
};
export function pickFaults(seed, n) {
  const rnd = mulberry32(seed ^ 0x5f3759df), ids = Object.keys(TRIGGERS);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids.slice(0, n);
}

export function routeMetrics(S) {
  const r = S.routes.rescue; if (!r) return null;
  const hazards = [...HAZARDS, ...S.hazards], by = new Map();
  const legs = r.legs.map((l) => {
    if (!l.ok) return { det: l.det, ok: false };
    const ex = exposureAlong(l.path, hazards);
    for (const x of ex.by) by.set(x.hz.id, { hz: x.hz, m: (by.get(x.hz.id)?.m || 0) + x.m });
    return { det: l.det, ok: true, path: l.path, length: l.length, kind: l.kind, gap: l.gap, exposure: ex };
  });
  return { legs, length: r.length, etaS: r.etaS, exposure: legs.reduce((s, l) => s + (l.ok ? l.exposure.total : 0), 0), by: [...by.values()].sort((a, b) => b.m - a.m), avoid: { ...r.avoid }, status: r.status, plannedAt: r.plannedAt };
}

// The same stops in the same order, planned with every hazard avoided: what the trainee could have approved instead.
export function safestFor(S, detIds) {
  const grid = buildGrid({ extraHazards: S.hazards, avoid: ALL_AVOID }), hazards = [...HAZARDS, ...S.hazards];
  let cur = UNITS.find((u) => u.kind === 'team').home.slice(), length = 0, exposure = 0;
  for (const id of detIds) { const d = S.detections.find((x) => x.id === id); if (!d) continue; const res = planPath(grid, cur, d.pos, { nearest: true }); if (!res.ok) continue; length += res.length; exposure += exposureAlong(res.path, hazards).total; cur = res.path[res.path.length - 1]; }
  return { length, exposure };
}

const latest = (det) => { const m = new Map(); for (const e of det.evidence) m.set(e.sensor, e); return [...m.values()]; };

export function createRun({ nn, level, seed, policy = 'trainee', onEvent }) {
  const auto = policy === 'autoplay';
  const engine = createEngine({ nn, seed, windows: level.windows, emit: (type, p) => onEvent?.(type, p), keep: { autoplay: auto, speed: 1, operator: auto ? 'Autoplay policy' : 'Trainee' } });
  const S = engine.state;
  const rec = { level: level.id, seed, policy, faults: pickFaults(seed, level.faults).map((id) => ({ id, tInject: null, tAnswer: null, wrong: 0 })), leads: [], proposals: [], slideAt: null, approvedAt: null, presetShown: false, handover: null, steps: 0 };
  let pendingSwap = false, slideDue = null, lastRouteAt = null;

  function answerFault(id, right) {
    const f = rec.faults.find((x) => x.id === id); if (!f || f.tAnswer != null) return false;
    if (!right) { f.wrong++; return false; }
    f.tAnswer = S.t;
    if (id === 'lowBattery') pendingSwap = true;
    else if (id !== 'thermalFail') engine.command('clearFault', { id });
    return true;
  }
  function noteProposal(source) {
    const m = routeMetrics(S); if (!m) return;
    lastRouteAt = m.plannedAt;
    rec.proposals.push({ t: S.t, source, avoid: m.avoid, length: m.length, exposure: m.exposure, by: m.by.map((x) => ({ id: x.hz.id, name: x.hz.name, m: x.m })), action: null });
  }
  function step() {
    engine.step(); rec.steps++;
    for (const f of rec.faults) {
      if (f.tInject == null && TRIGGERS[f.id](S)) { engine.command('injectFault', { id: f.id }); f.tInject = S.t; }
      if (auto && f.tInject != null && f.tAnswer == null && S.t - f.tInject >= REF_FAULT_S) answerFault(f.id, true);
    }
    if (pendingSwap && rover(S).mode === 'swap') { engine.command('swapBattery'); pendingSwap = false; }
    if (slideDue != null && S.t >= slideDue) { slideDue = null; rec.slideAt = S.t; engine.command('newHazard', SLIDE); noteProposal('replanned after the slide'); }
    const r = S.routes.rescue;
    if (auto) {
      if (r && r.plannedAt !== lastRouteAt && r.status === 'planned') { noteProposal('autoplay'); if (level.slide && rec.slideAt == null && slideDue == null) slideDue = S.t + 1; }
      if (r?.status === 'approved' && rec.approvedAt == null) { rec.approvedAt = S.t; rec.proposals.at(-1).action = 'approved'; }
    }
  }
  // What the trainee has to decide now, or null while the mission is simply running.
  function awaiting() {
    const f = rec.faults.find((x) => x.tInject != null && x.tAnswer == null);
    if (f) return { type: 'fault', fault: f };
    if (!S.started) return { type: 'start' };
    if (S.phase === 'assess' && rover(S).mode === 'idle' && !S.queue.length && !S.sensors.listen) { const open = S.detections.filter((d) => d.status === 'possible' && !d.needsTeam); if (open.length) return { type: 'leads', open }; }
    if (S.phase === 'plan') {
      if (!S.detections.some((d) => d.status === 'confirmed' || d.needsTeam)) return null; // the engine closes the mission itself
      return { type: 'plan', route: S.routes.rescue || null };
    }
    if (S.phase === 'rescue' || S.phase === 'complete') return { type: 'handover' };
    return null;
  }
  const run = {
    engine, state: S, rec, level, seed, step, awaiting, answerFault,
    truthOf: (id) => engine.truthOf(id),
    start() { engine.command('start'); },
    leadAction(id, action) {
      const d = S.detections.find((x) => x.id === id); if (!d) return false;
      const ok = engine.command(action === 'dismiss' ? 'dismiss' : 'investigate', { id });
      if (ok) rec.leads.push({ id, action: action === 'dismiss' ? 'dismiss' : d.outdoor ? 'team' : 'look', t: S.t, p: d.p, room: d.room, outdoor: d.outdoor, evidence: latest(d).map((e) => ({ sensor: e.sensor, result: e.result })) });
      return ok;
    },
    finishAssess() {
      for (const d of S.detections) if (d.status === 'possible' && !d.needsTeam) rec.leads.push({ id: d.id, action: 'left', t: S.t, p: d.p, room: d.room, outdoor: d.outdoor, evidence: latest(d).map((e) => ({ sensor: e.sensor, result: e.result })) });
      return engine.command('finishAssess');
    },
    proposePreset() { if (rec.presetShown || !level.preset) return false; rec.presetShown = true; const ok = engine.command('planRoute', { avoid: { ...ALL_AVOID, ...level.preset } }); if (ok) noteProposal('left by the last shift'); return ok; },
    plan(avoid) { const ok = engine.command('planRoute', { avoid: { ...ALL_AVOID, ...avoid } }); if (ok) { noteProposal('your plan'); if (level.slide && rec.slideAt == null && slideDue == null) slideDue = S.t + 3; } return ok; },
    get slidePending() { return slideDue != null; },
    approve() { const ok = engine.command('approveRoute'); if (ok) { rec.approvedAt = S.t; const p = rec.proposals.at(-1); if (p) p.action = 'approved'; } return ok; },
    reject() { const ok = engine.command('rejectRoute'); if (ok) { const p = rec.proposals.at(-1); if (p) p.action = 'rejected'; } return ok; },
    setHandover(rooms) { rec.handover = [...rooms]; },
  };
  return run;
}

// Run the same scenario with the autoplay policy until the route is approved (or the mission ends with no one found).
export async function runBaseline({ nn, level, seed, onProgress }) {
  const run = createRun({ nn, level, seed, policy: 'autoplay' });
  let guard = 0;
  while (run.rec.approvedAt == null && !run.engine.done && guard < 30000) {
    for (let i = 0; i < 400 && run.rec.approvedAt == null && !run.engine.done; i++, guard++) run.step();
    onProgress?.(Math.min(0.98, run.state.t / 520)); await new Promise((r) => setTimeout(r, 0));
  }
  if (run.rec.approvedAt == null) run.rec.approvedAt = run.state.t;
  return run;
}

// ---------- after the drill: compare with ground truth ----------
const isPerson = (src) => TRUTH.people.some((p) => p.id === src);
export function describeSource(src) {
  const p = TRUTH.people.find((x) => x.id === src); if (p) return { person: true, label: (p.motion === 'still' ? 'A person lying still' : 'A person moving') + (p.room ? ' in room ' + p.room : ' outdoors'), note: p.note };
  const d = TRUTH.decoys.find((x) => x.id === src); if (d) return { person: false, label: (d.kind === 'fan' ? 'A desk fan' : 'A hot water pipe') + ' in room ' + d.room, note: d.note };
  return { person: false, label: 'Nothing: a Wi-Fi false alarm', note: 'The network raised an alarm on an empty room. In simulation it does this for 11 % of empty-room windows.' };
}
export function needsHandSearch(S) { return ROOMS.filter((r) => !r.corridor).filter((r) => { const c = S.coverage[r.id]; return c.status === 'blocked' || c.status === 'unsearched' || (c.status === 'clear' && c.noCsi); }).map((r) => r.id); }

export function outcome(run) {
  const S = run.state, route = S.routes.rescue && (S.routes.rescue.status === 'approved' || S.routes.rescue.status === 'done') ? S.routes.rescue : null;
  const inRoute = new Set(route ? route.legs.filter((l) => l.ok).map((l) => l.det) : []);
  const people = TRUTH.people.map((p) => {
    const det = S.detections.find((d) => run.truthOf(d.id) === p.id), act = det && run.rec.leads.filter((l) => l.id === det.id);
    let result = 'missed', how = 'The sensors never raised a lead here.';
    if (det) {
      if (det.status === 'confirmed' && inRoute.has(det.id)) { result = 'sensors'; how = 'Confirmed by the sensors at ' + (det.p * 100).toFixed(0) + ' % and on the route.'; }
      else if (det.status === 'possible' && det.needsTeam && inRoute.has(det.id)) { result = 'team'; how = 'Left at ' + (det.p * 100).toFixed(0) + ' % and handed to the rescue team to check.'; }
      else if (det.dismissed) how = 'Dismissed by the operator at ' + ((act?.find((a) => a.action === 'dismiss')?.p ?? det.p) * 100).toFixed(0) + ' %.';
      else if (det.status === 'rejected') how = 'Closed by fusion: the readings did not add up to a person.';
      else if (det.status === 'possible') how = 'Left open at ' + (det.p * 100).toFixed(0) + ' % when checking stopped, so it was never routed.';
      else how = 'Found, but no route was approved.';
    }
    return { truth: p, det: det || null, result, how };
  });
  const falseLeads = S.detections.filter((d) => !isPerson(run.truthOf(d.id))).map((d) => {
    const acts = run.rec.leads.filter((l) => l.id === d.id), leg = route?.legs.find((l) => l.det === d.id && l.ok);
    const fate = d.dismissed ? 'dismissed' : d.status === 'rejected' ? 'closed' : inRoute.has(d.id) ? 'team' : d.status === 'confirmed' ? 'confirmed' : 'open';
    return { det: d, src: run.truthOf(d.id), what: describeSource(run.truthOf(d.id)), fate, chased: acts.some((a) => a.action === 'look'), detour: leg ? leg.length : 0 };
  });
  return { people, falseLeads, route: route ? routeMetrics(S) : null, hand: needsHandSearch(S), coverage: S.coverage, time: run.rec.approvedAt ?? S.t };
}

// The score, by category, with the reason for every point lost. base = the autoplay run of the same scenario.
export function score(run, base) {
  const o = outcome(run), b = outcome(base), cats = [], lessons = [];
  // 1. people
  { const max = 15 * o.people.length; let got = 0; const lines = [];
    for (const p of o.people) { const pts = p.result === 'sensors' ? 15 : p.result === 'team' ? (p.truth.outdoors ? 15 : 12) : 0; got += pts; lines.push({ ok: pts > 0, text: describeSource(p.truth.id).label + ': ' + (p.result === 'sensors' ? 'found by the sensors' : p.result === 'team' ? (p.truth.outdoors ? 'handed to the rescue team, the only way to check a lead the rover cannot reach' : 'left to the rescue team to confirm') : 'missed') + '.' });
      if (p.result === 'missed' && p.det?.dismissed) lessons.push({ id: 'dismissed-' + p.truth.id, lesson: 'probability', title: 'You dismissed a real person', text: 'The lead ' + (p.det.room ? 'in room ' + p.det.room : 'outdoors') + ' stood at ' + ((run.rec.leads.find((l) => l.id === p.det.id && l.action === 'dismiss')?.p ?? 0) * 100).toFixed(0) + ' % when you dismissed it. ' + p.truth.note + ' A low number is not a no: the Wi-Fi network finds only 21 % of still people in simulation. A second look costs about a minute.' });
      else if (p.result === 'missed' && p.det && p.det.status === 'possible') lessons.push({ id: 'left-' + p.truth.id, lesson: 'probability', title: 'An open lead was dropped', text: 'You stopped checking with the lead ' + (p.det.room ? 'in room ' + p.det.room : 'outdoors') + ' still open at ' + (p.det.p * 100).toFixed(0) + ' %. The route planner only goes to confirmed people and to leads handed to the team, so nobody was sent. ' + p.truth.note + ' Check every open lead or hand it to the team before you plan.' });
      else if (p.result === 'missed' && p.det) lessons.push({ id: 'closed-' + p.truth.id, lesson: 'fusion', title: 'The sensors closed a real lead', text: 'Fusion closed the lead ' + (p.det.room ? 'in room ' + p.det.room : 'outdoors') + '. ' + p.truth.note + ' This is the limit of the sensors, not your mistake; it is why rooms keep a missed-person risk even when marked clear.' });
      else if (p.result === 'missed') lessons.push({ id: 'never-' + p.truth.id, lesson: 'wifi', title: 'One person was never detected', text: p.truth.note + ' No sensor raised a lead' + (p.truth.room ? ' for room ' + p.truth.room : '') + '. Nothing you pressed caused this. Report the room’s missed-person risk in the hand-over so the team searches it by hand.' });
    }
    cats.push({ key: 'people', label: 'People found', got, max, lines, note: o.people.filter((p) => p.result === 'sensors').length + ' by sensors, ' + o.people.filter((p) => p.result === 'team').length + ' left to the team, ' + o.people.filter((p) => p.result === 'missed').length + ' missed' }); }
  // 2. false alarms
  { const max = 15; let got = max; const lines = [];
    for (const f of o.falseLeads) {
      if (f.fate === 'team') { got -= 5; lines.push({ ok: false, text: f.what.label + ': sent to the rescue team, a ' + f.detour.toFixed(0) + ' m detour.' }); lessons.push({ id: 'team-' + f.det.id, lesson: 'fusion', title: 'The team was sent to a false alarm', text: 'The lead ' + (f.det.room ? 'in room ' + f.det.room : 'outdoors') + ' went on the route at ' + (f.det.p * 100).toFixed(0) + ' %. It was: ' + f.what.label.toLowerCase() + '. ' + f.what.note + ' That is ' + f.detour.toFixed(0) + ' m of walking inside a damaged building for nothing. This can be the right call when the evidence is thin; here a second look from a clear viewpoint would have closed it.' }); }
      else if (f.chased) { got -= 1; lines.push({ ok: true, text: f.what.label + ': a second look closed it. Time spent, nothing lost.' }); }
      else if (f.fate === 'dismissed') lines.push({ ok: true, text: f.what.label + ': you dismissed it at ' + ((run.rec.leads.find((l) => l.id === f.det.id)?.p ?? f.det.p) * 100).toFixed(0) + ' %. Right this time.' });
      else if (f.fate === 'confirmed') { got -= 5; lines.push({ ok: false, text: f.what.label + ': confirmed by the sensors. A false find.' }); }
      else lines.push({ ok: true, text: f.what.label + ': ' + (f.fate === 'closed' ? 'closed by fusion.' : 'left open, not routed.') });
    }
    if (!o.falseLeads.length) lines.push({ ok: true, text: 'No false leads were raised in this run.' });
    cats.push({ key: 'false', label: 'False alarms', got: Math.max(0, got), max, lines, note: o.falseLeads.filter((f) => f.chased).length + ' chased, ' + o.falseLeads.filter((f) => f.fate === 'team').length + ' sent to the team' }); }
  // 3. route
  { const max = 20; let got = 0; const lines = [];
    if (o.route) {
      const safe = safestFor(run.state, o.route.legs.filter((l) => l.ok).map((l) => l.det));
      const extra = Math.max(0, o.route.exposure - safe.exposure - 0.5); got = Math.max(0, max - Math.round(extra)); o.route.safe = safe;
      lines.push({ ok: extra === 0, text: 'Approved route: ' + o.route.length.toFixed(0) + ' m with ' + o.route.exposure.toFixed(1) + ' m inside hazards. ' + (extra === 0 ? 'That is as low as the planner can get for these stops.' : 'With every hazard avoided the same stops need only ' + safe.exposure.toFixed(1) + ' m.') });
      const first = run.rec.proposals[0];
      if (first?.source === 'left by the last shift') lines.push({ ok: first.action === 'rejected', text: 'The first proposal had slope avoidance switched off (' + first.exposure.toFixed(1) + ' m inside hazards). You ' + (first.action === 'rejected' ? 'rejected it.' : 'approved it.') });
      if (run.rec.slideAt != null) lines.push({ ok: true, text: 'A second slide came down at ' + clock(run.rec.slideAt) + '. Every route was planned again before you approved.' });
      if (extra > 0) lessons.push({ id: 'route', lesson: 'approval', title: 'You approved a route through a hazard', text: 'The route you approved spends ' + o.route.exposure.toFixed(1) + ' m inside marked hazards' + (o.route.by[0] ? ', most of it in “' + o.route.by[0].hz.name + '”' : '') + '. With every hazard avoided the planner reaches the same stops with ' + safe.exposure.toFixed(1) + ' m, and the route is only ' + Math.abs(safe.length - o.route.length).toFixed(0) + ' m different in length. The length line will not warn you. Read the exposure line, and check which hazards the planner was told to avoid, before you approve.' });
    } else lines.push({ ok: false, text: 'No route was approved.' });
    cats.push({ key: 'route', label: 'Route approval', got, max, lines, note: o.route ? o.route.exposure.toFixed(1) + ' m inside hazards' : 'none' }); }
  // 4. faults
  if (run.rec.faults.length) { const max = 10, share = max / run.rec.faults.length; let got = 0; const lines = [];
    for (const f of run.rec.faults) {
      if (f.tInject == null) { got += share; lines.push({ ok: true, text: FAULTS[f.id].label + ': the mission ended before it could happen.' }); continue; }
      if (f.tAnswer == null) { lines.push({ ok: false, text: FAULTS[f.id].label + ': never handled.' }); continue; }
      const dt = f.tAnswer - f.tInject, timeF = dt <= REF_FAULT_S ? 1 : Math.max(0.5, 1 - (0.5 * (dt - REF_FAULT_S)) / 100), pts = Math.max(0, share * timeF - share * 0.4 * f.wrong); got += pts;
      lines.push({ ok: f.wrong === 0 && dt <= REF_FAULT_S, text: FAULTS[f.id].label + ': handled in ' + dt.toFixed(0) + ' s' + (f.wrong ? ' after ' + f.wrong + ' wrong ' + (f.wrong === 1 ? 'answer' : 'answers') : '') + ' (reference ' + REF_FAULT_S + ' s).' });
      if (f.wrong) lessons.push({ id: 'fault-' + f.id, lesson: null, title: 'Fault: ' + FAULTS[f.id].label.toLowerCase(), text: 'You picked a wrong response ' + (f.wrong === 1 ? 'once' : f.wrong + ' times') + '. What the system really does: ' + FAULTS[f.id].does + ' Knowing this by heart is what makes the response fast.' });
      else if (dt > REF_FAULT_S * 2) lessons.push({ id: 'faultslow-' + f.id, lesson: null, title: 'Slow fault response', text: FAULTS[f.id].label + ' took you ' + dt.toFixed(0) + ' s to handle. The rover was safe the whole time, but the search stood still. The operator card lists the response for each fault.' });
    }
    cats.push({ key: 'faults', label: 'Fault response', got, max, lines, note: run.rec.faults.filter((f) => f.tAnswer != null).map((f) => (f.tAnswer - f.tInject).toFixed(0) + ' s').join(', ') || 'not handled' }); }
  // 5. hand-over
  { const max = 10, truth = new Set(o.hand), said = new Set(run.rec.handover || []), lines = []; let got = max;
    const missed = [...truth].filter((r) => !said.has(r)), over = [...said].filter((r) => !truth.has(r));
    got -= missed.length * 4 + over.length * 1;
    lines.push({ ok: !missed.length, text: truth.size ? 'Not searched by the sensors: ' + [...truth].join(', ') + '. You flagged ' + (said.size ? [...said].join(', ') : 'none') + '.' : 'Every room was searched with Wi-Fi.' });
    const risk = ROOMS.filter((r) => !r.corridor && ['clear', 'blocked', 'unsearched'].includes(o.coverage[r.id].status)).reduce((s2, r) => s2 + o.coverage[r.id].residual, 0);
    lines.push({ ok: true, text: 'Even rooms marked clear keep a missed-person risk. Summed over the rooms with no find: ' + risk.toFixed(2) + ' people expected (prior 0.10 a room, assumed).' });
    if (missed.length) lessons.push({ id: 'handover', lesson: 'probability', title: 'An unsearched room was handed over as searched', text: 'Room' + (missed.length > 1 ? 's ' : ' ') + missed.join(' and ') + (missed.length > 1 ? ' were' : ' was') + ' never reached by the sensors' + (missed.some((r) => o.coverage[r].noCsi) ? ' with Wi-Fi' : '') + ': ' + o.coverage[missed[0]].note + ' The chance someone is in there is still the starting 10 % (assumed). The team has to search it by hand, and only your hand-over tells them so.' });
    cats.push({ key: 'hand', label: 'Hand-over', got: Math.max(0, got), max, lines, note: missed.length ? missed.length + ' unsearched room' + (missed.length > 1 ? 's' : '') + ' not flagged' : 'unsearched rooms flagged' }); }
  // 6. time
  { const max = 10, dt = o.time - b.time, got = Math.max(0, Math.min(max, max - Math.max(0, dt - 45) / 20));
    cats.push({ key: 'time', label: 'Time to an approved route', got, max, lines: [{ ok: dt <= 45, text: 'You: ' + clock(o.time) + ' of mission time. Autoplay policy: ' + clock(b.time) + '. Time spent thinking with the clock stopped is not counted.' }], note: clock(o.time) }); }
  const got = cats.reduce((s2, c) => s2 + c.got, 0), max = cats.reduce((s2, c) => s2 + c.max, 0), total = Math.round((got / max) * 100);
  const grade = total >= 90 ? 'Ready for the rover.' : total >= 75 ? 'Solid. One more clean run.' : total >= 50 ? 'Getting there. Read the lessons below, then run it again.' : 'Start with the lessons, then come back.';
  return { total, grade, cats, lessons, outcome: o, base: b };
}
export const clock = (t) => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0');
export const TEAM_SPEED = UNITS.find((u) => u.kind === 'team').speed;
