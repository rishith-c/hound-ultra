// The copilot's tools: the ONLY things the language model or the rule-based interpreter can do to the console.
//
// Every request becomes one call { tool, args }. A call is (1) checked against a JSON schema that is rebuilt from the
// live mission, so an id that does not exist cannot pass; (2) checked against the mission state ("allowed now?");
// (3) for approve_route, put in front of a human in a dialog; and only then (4) run through ctx.sim.command, the
// same door every button in the console uses. Tools return FACTS (plain data read from ctx.sim.state) and a plain
// TEXT summary written by code. A language model may re-phrase the facts; it never supplies them.
//
// Nothing here reads world.TRUTH or sim.truthOf: the copilot knows only what the sensors found.
import { createEngine, fmtClock, PHASE_INFO, FAULTS } from '../../core/sim.js';
import { LR, PRIOR, THRESHOLDS } from '../../core/fusion.js';

export const SPEEDS = [1, 2, 4, 8, 16, 32];
export const HAZARD_KINDS = ['slope', 'mud', 'gas', 'collapse'];
export const HAZARD_WORDS = { slope: 'the unstable slope', mud: 'deep mud', gas: 'the possible gas leak', collapse: 'the collapse-risk zone' };
export const LAYERS = [
  { id: 'walls-xray', label: 'See-through walls', does: 'The walls of building B turn translucent.' },
  { id: 'hazards', label: 'Hazard zones', does: 'Slope, mud, gas and collapse zones.' },
  { id: 'coverage', label: 'Search coverage', does: 'What the rover has and has not searched.' },
  { id: 'heat', label: 'Heat behind walls', does: 'Thermal volumes at each reading.' },
  { id: 'route', label: 'Rescue route', does: 'The planned or approved route.' },
  { id: 'trail', label: 'Unit trails', does: 'Where each unit has been.' },
  { id: 'scan', label: 'Drone scan', does: 'The point cloud from the survey.' },
  { id: 'labels', label: 'Labels', does: 'Leader-lined names in the 3-D view.' },
  { id: 'grid', label: 'Ground grid', does: 'A metric grid on the ground.' },
  { id: 'sensing', label: 'Sensing volumes', does: 'Wi-Fi, radar and thermal reach at a stop.' },
];
export const CAMERAS = [
  { id: 'orbit', label: 'Orbit', does: 'Free orbit around the site.' },
  { id: 'top', label: 'Top down', does: 'Plan view, north up.' },
  { id: 'follow', label: 'Follow rover', does: 'Chase camera behind HOUND-01.' },
  { id: 'fpv', label: 'Rover camera', does: 'First-person view from the rover.' },
  { id: 'cinematic', label: 'Cinematic', does: 'The camera frames the story by itself.' },
];
export const MOMENTS = [
  { id: 'start', label: 'Mission start', code: 'MISSION_START' },
  { id: 'map_ready', label: 'Drone map ready', code: 'MAP_READY' },
  { id: 'rover_at_entrance', label: 'Rover at the entrance', code: 'AT_ENTRANCE' },
  { id: 'first_listen', label: 'First listening stop', code: 'LISTEN' },
  { id: 'first_possible', label: 'First possible person', code: 'POSSIBLE_PERSON' },
  { id: 'first_person_found', label: 'First person found', code: 'PERSON_FOUND' },
  { id: 'route_planned', label: 'Route planned', code: 'ROUTE_PLANNED' },
  { id: 'route_approved', label: 'Route approved', code: 'ROUTE_APPROVED' },
  { id: 'team_arrived', label: 'Team reaches the first person', code: 'TEAM_ARRIVED' },
  { id: 'mission_complete', label: 'Mission complete', code: 'MISSION_COMPLETE' },
];
const NOTABLE = new Set(['MISSION_START', 'MAP_READY', 'AT_ENTRANCE', 'LISTEN', 'POSSIBLE_PERSON', 'PERSON_FOUND', 'LEAD_CLOSED', 'ROUTE_PLANNED', 'ROUTE_APPROVED', 'TEAM_ARRIVED', 'MISSION_COMPLETE', 'NEW_HAZARD', 'FAULT', 'ALL_STOP', 'BATTERY_LOW']);
const MODE_WORDS = { idle: 'idle', drive: 'driving', listen: 'listening', hold: 'holding (all stop)', fault: 'holding (link lost)', swap: 'waiting for a battery swap', takeoff: 'taking off', scan: 'scanning', return: 'returning', landed: 'landed' };
const SENSOR_WORDS = { csi: 'Wi-Fi network', radar: 'radar', micro: 'breathing radar', thermal: 'thermal camera', aerial: 'drone image', acoustic: 'tapping or voice', human: 'rescue team', signature: 'motion pattern', temperature: 'temperature check' };
const RESULT_WORDS = { pos: 'person-like', neg: 'nothing', faint: 'faint', none: 'no movement', blind: 'could not see', machine: 'machine-like', tooHot: 'too hot' };
const SEL_TYPE = { lead: 'detection', person: 'survivor', room: 'room', unit: 'unit', hazard: 'hazard' };

const pct = (p) => Math.round(p * 100);
export const whereOf = (d) => (d.room ? 'room ' + d.room : d.outdoor ? 'outdoors, debris field' : 'position unknown');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------- what exists right now (ids the schema will accept) ----------
export function entitiesOf(S, ctx) {
  const w = ctx.world;
  return {
    clock: fmtClock(S.t), t: S.t, phase: S.phase, phaseLabel: PHASE_INFO[S.phase].label, speed: S.speed,
    leads: S.detections.map((d) => ({ id: d.id, room: d.room, outdoor: !!d.outdoor, status: d.status, kind: d.kind, p: d.p, needsTeam: !!d.needsTeam, survivorId: d.survivorId })),
    people: Object.values(S.survivors).map((v) => ({ id: v.id, detId: v.detId, room: v.room, outdoor: !!v.outdoor })),
    rooms: w.ROOMS.filter((r) => !r.corridor).map((r) => ({ id: r.id, name: r.name })),
    units: w.UNITS.map((u) => ({ id: u.id, kind: u.kind, name: u.name })),
    hazards: [...w.HAZARDS, ...S.hazards].map((h) => ({ id: h.id, kind: h.kind, name: h.name })),
    workspaces: ctx.manifest.map((m) => ({ id: m.id, title: m.title, blurb: m.blurb })),
  };
}
export const entities = (ctx) => entitiesOf(ctx.sim.state, ctx);

// The scripted mission played once in the background, so "seek to the moment the route was approved" works before
// that moment has happened on screen. Same seed, same windows, autoplay on. Used for seek targets only.
let ref = null;
export function referenceRun(ctx) {
  const o = ctx.sim.options;
  if (ref && ref.seed === o.seed && ref.windows === o.windows) return ref;
  const e = createEngine({ nn: ctx.nn, seed: o.seed, windows: o.windows, keep: { autoplay: true } });
  let guard = 0; while (!e.done && guard++ < 40000) e.step();
  ref = { seed: o.seed, windows: o.windows, events: e.state.events.slice(), end: e.state.t };
  return ref;
}
// A fixed moment of the scripted mission (07:10, checking leads) used by the evaluation, so its ids never depend on
// what the live mission happens to be doing.
let frozen = null;
export function frozenEntities(ctx, t = 430) {
  if (frozen) return frozen;
  const e = createEngine({ nn: ctx.nn, keep: { autoplay: true } });
  let guard = 0; while (e.state.t < t && guard++ < 40000) e.step();
  frozen = entitiesOf(e.state, ctx);
  return frozen;
}
function momentLabel(ev) {
  const where = ev.room ? 'room ' + ev.room : '';
  switch (ev.code) {
    case 'MISSION_START': return 'Mission start';
    case 'MAP_READY': return 'Drone map ready';
    case 'AT_ENTRANCE': return 'Rover at the entrance';
    case 'LISTEN': return 'Listening stop ' + (ev.stop || '');
    case 'POSSIBLE_PERSON': return 'Possible person' + (/room (\d+)/.test(ev.text) ? ', room ' + RegExp.$1 : /outdoors/.test(ev.text) ? ', outdoors' : '');
    case 'PERSON_FOUND': return 'Person found' + (/room (\d+)/.test(ev.text) ? ', room ' + RegExp.$1 : /outdoors/.test(ev.text) ? ', outdoors' : '');
    case 'LEAD_CLOSED': return 'Lead closed' + (/room (\d+)/.test(ev.text) ? ', room ' + RegExp.$1 : '');
    case 'ROUTE_PLANNED': return 'Rescue route planned';
    case 'ROUTE_APPROVED': return 'Route approved';
    case 'TEAM_ARRIVED': return 'Team arrives' + (/room (\d+)/.test(ev.text) ? ', room ' + RegExp.$1 : /outdoors/.test(ev.text) ? ', outdoors' : '');
    case 'MISSION_COMPLETE': return 'Mission complete';
    case 'NEW_HAZARD': return 'New hazard';
    case 'FAULT': return 'Fault drill: ' + (FAULTS[ev.fault]?.label || '');
    case 'ALL_STOP': return 'All stop';
    case 'BATTERY_LOW': return 'Battery low' + where;
    default: return ev.code;
  }
}
// Key moments: what has happened in THIS run, then what the scripted run does next.
export function keyMoments(ctx) {
  const S = ctx.sim.state;
  const live = S.events.filter((e) => NOTABLE.has(e.code)).map((e) => ({ t: e.t, code: e.code, label: momentLabel(e), text: e.text, source: 'log' }));
  let future = [];
  try { future = referenceRun(ctx).events.filter((e) => NOTABLE.has(e.code) && e.t > S.t + 0.5).map((e) => ({ t: e.t, code: e.code, label: momentLabel(e), text: e.text, source: 'scripted' })); } catch { /* seek targets from the log only */ }
  return [...live, ...future];
}
export function parseClock(s) { const m = /^(\d{1,3}):([0-5]\d)$/.exec(String(s).trim()); return m ? +m[1] * 60 + +m[2] : null; }
export const normClock = (s) => { const t = parseClock(s); return t == null ? String(s) : fmtClock(t); };

// ---------- "is this allowed now, and if not, why" for every simulator command (the palette uses this too) ----------
export function commandState(ctx, name, args = {}) {
  const S = ctx.sim.state, now = PHASE_INFO[S.phase].label, r = S.routes.rescue, rover = S.units['HOUND-01'];
  const det = args.id && S.detections.find((d) => d.id === args.id);
  const no = (reason) => ({ ok: false, reason });
  switch (name) {
    case 'start': return S.started ? no('The mission has already started.') : { ok: true };
    case 'allStop': return S.hold ? no('Every unit is already holding.') : { ok: true };
    case 'resume': return S.hold ? { ok: true } : no('No all-stop is active.');
    case 'investigate':
      if (!det) return no('There is no lead ' + (args.id || '') + '.');
      if (det.status !== 'possible') return no(det.id + ' is ' + det.status + ', not a possible lead. Only possible leads get a second look.');
      if (S.phase !== 'assess') return no('Second looks happen in the Checking leads phase. The mission is in: ' + now + '.');
      return { ok: true };
    case 'dismiss':
      if (!det) return no('There is no lead ' + (args.id || '') + '.');
      return det.status === 'possible' ? { ok: true } : no(det.id + ' is ' + det.status + '. Only a possible lead can be dismissed.');
    case 'finishAssess': return S.phase === 'assess' ? { ok: true } : no('Only while checking leads. The mission is in: ' + now + '.');
    case 'planRoute':
      if (S.phase !== 'plan') return no(S.phase === 'rescue' || S.phase === 'complete' ? 'The route is already approved.' : 'A route is planned after the leads are checked (phase Planning rescue). The mission is in: ' + now + '.');
      if (!S.detections.some((d) => d.status === 'confirmed' || (d.status === 'possible' && d.needsTeam))) return no('No one has been found to plan a route to.');
      return { ok: true };
    case 'approveRoute': case 'rejectRoute': return r && r.status === 'planned' ? { ok: true } : no(r ? 'The route is already ' + r.status + '.' : 'There is no planned route waiting for a decision.');
    case 'swapBattery': return rover.mode === 'swap' ? { ok: true } : no('The rover is not at staging waiting for a battery.');
    case 'injectFault': return !FAULTS[args.id] ? no('Unknown fault.') : S.faults[args.id] ? no('That fault drill is already running.') : { ok: true };
    case 'clearFault': return !FAULTS[args.id] ? no('Unknown fault.') : S.faults[args.id] ? { ok: true } : no('That fault is not active.');
    default: return { ok: true };
  }
}

// ---------- a small JSON-schema checker (the subset the tool schemas use) ----------
export function validate(schema, v, path = 'call') {
  const errs = [];
  if (schema.anyOf) { if (!schema.anyOf.some((s) => !validate(s, v, path).length)) errs.push(path + ' matches none of the allowed forms'); return errs; }
  if (schema.enum && !schema.enum.includes(v)) { errs.push(path + ' must be one of ' + schema.enum.slice(0, 12).join(', ') + ', got ' + JSON.stringify(v)); return errs; }
  const type = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
  if (schema.type && type !== schema.type) { errs.push(path + ' must be ' + schema.type + ', got ' + type); return errs; }
  if (schema.pattern && !new RegExp(schema.pattern).test(v)) errs.push(path + ' has the wrong form');
  if (type === 'array') { v.forEach((x, i) => errs.push(...validate(schema.items || {}, x, path + '[' + i + ']'))); if (schema.uniqueItems && new Set(v).size !== v.length) errs.push(path + ' repeats a value'); }
  if (type === 'object') {
    for (const k of schema.required || []) if (!(k in v)) errs.push(path + '.' + k + ' is missing');
    for (const [k, x] of Object.entries(v)) { const s = schema.properties?.[k]; if (!s) { if (schema.additionalProperties === false) errs.push(path + '.' + k + ' is not a known argument'); } else errs.push(...validate(s, x, path + '.' + k)); }
  }
  return errs;
}
const obj = (properties = {}) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const ids = (list) => (list.length ? list.map((x) => x.id) : ['-']);

// ---------- descriptions of things, reused by several tools ----------
function leadFacts(d) {
  return { id: d.id, status: d.status, what: d.kind, where: whereOf(d), confidence_pct: pct(d.p), sensors: [...new Set(d.evidence.filter((e) => ['pos', 'faint'].includes(e.result)).map((e) => SENSOR_WORDS[e.sensor] || e.sensor))], readings: d.windows, last_update: fmtClock(d.updated), ...(d.needsTeam ? { assigned_to: 'rescue team, to check in person' } : {}), ...(d.survivorId ? { person: d.survivorId } : {}) };
}
function unitFacts(u, ctx) {
  const room = ctx.world.roomAt(u.pos);
  const at = dist(u.pos, ctx.world.SITE.staging) < 4 || dist(u.pos, ctx.world.UNITS.find((x) => x.id === u.id).home) < 2 ? 'staging' : room ? room.name : 'outside, ' + u.pos.map((x) => x.toFixed(0)).join(' E ') + ' N';
  const f = { id: u.id, name: u.name, state: MODE_WORDS[u.mode] || u.mode, at };
  if (u.kind === 'rover') { f.battery_pct = pct(u.battery); f.link_pct = pct(u.link); f.driven_m = Math.round(u.odo); }
  if (!u.built) f.note = u.kind === 'drone' ? 'concept: no drone has been built' : 'simulated';
  return f;
}
function routeFacts(r, S) {
  if (!r) return null;
  const good = r.legs.filter((l) => l.ok);
  return { status: r.status === 'planned' ? 'planned, waiting for approval' : r.status, length_m: Math.round(r.length), eta_min: Math.max(1, Math.round(r.etaS / 60)),
    stops: r.legs.map((l, i) => { const d = S.detections.find((x) => x.id === l.det); return l.ok ? { order: i + 1, lead: l.det, where: d ? whereOf(d) : '', access: l.kind, leg_m: Math.round(l.length), ...(l.reached ? {} : { wall_gap_m: +l.gap.toFixed(1) }), ...(l.arrivedAt != null ? { arrived: fmtClock(l.arrivedAt) } : {}) } : { order: i + 1, lead: l.det, unreachable: l.reason || 'no safe path' }; }),
    stays_out_of: r.avoided, may_cross: HAZARD_KINDS.filter((k) => r.avoid && r.avoid[k] === false).map((k) => HAZARD_WORDS[k]), reachable_stops: good.length };
}
export function nextAction(ctx) {
  const S = ctx.sim.state, r = S.routes.rescue;
  if (S.hold) return { say: 'All stop is active. Resume when it is safe.', call: { tool: 'resume', args: {} } };
  if (!S.started && !S.autoplay) return { say: 'Start the mission.', call: { tool: 'start_mission', args: {} } };
  if (S.units['HOUND-01'].mode === 'swap') return { say: 'HOUND-01 is at staging waiting for a battery swap.', call: null };
  if (S.phase === 'assess') { const d = S.detections.find((x) => x.status === 'possible' && !x.needsTeam); if (d) return { say: 'Send the rover for a second look at ' + d.id + ' (' + whereOf(d) + ').', call: { tool: 'investigate', args: { id: d.id } } }; }
  if (S.phase === 'plan' && !r) return { say: 'Plan the rescue route.', call: { tool: 'plan_route', args: { avoid: HAZARD_KINDS.slice() } } };
  if (r && r.status === 'planned') return { say: 'A route is waiting for approval.', call: { tool: 'approve_route', args: {} } };
  if (S.phase === 'complete') return { say: 'Write the situation report for hand-over.', call: { tool: 'write_sitrep', args: {} } };
  return null;
}

// ---------- the situation report: facts first, wording second ----------
export function sitrepFacts(ctx) {
  const S = ctx.sim.state, w = ctx.world, cov = Object.values(S.coverage), r = S.routes.rescue;
  const clear = cov.filter((c) => c.status === 'clear');
  const next = nextAction(ctx);
  return {
    as_of: fmtClock(S.t), exercise: 'Training exercise, Block B, Timure (simulated)', phase: S.hold ? 'All stop' : PHASE_INFO[S.phase].label, operator: S.operator,
    people: Object.values(S.survivors).map((v) => ({ id: v.id, lead: v.detId, where: whereOf(v), confidence_pct: pct(v.p), movement: v.motion, status: v.status === 'reached' ? 'reached by the team at ' + fmtClock(v.reachedAt) : 'located, not yet reached', found_at: fmtClock(v.foundAt) })),
    open_leads: S.detections.filter((d) => d.status === 'possible').map((d) => ({ id: d.id, where: whereOf(d), confidence_pct: pct(d.p), plan: d.needsTeam ? 'rescue team checks in person' : 'rover second look' })),
    closed_leads: S.detections.filter((d) => d.status === 'rejected').map((d) => ({ id: d.id, where: whereOf(d), judged: d.kind })),
    search: { rooms_total: cov.length, rooms_clear: clear.length, highest_missed_chance_pct: clear.length ? Math.max(...clear.map((c) => pct(c.residual))) : null, not_searched: cov.filter((c) => c.status === 'unsearched' || c.status === 'blocked').map((c) => ({ room: c.room, why: c.status === 'blocked' ? 'blocked' : 'not reached yet' })) },
    hazards: [...w.HAZARDS, ...S.hazards].map((h) => h.name.replace(/ \(concept sensor\)/, '')),
    units: Object.values(S.units).map((u) => unitFacts(u, ctx)),
    route: routeFacts(r, S),
    faults_active: Object.keys(S.faults).filter((k) => S.faults[k]).map((k) => FAULTS[k].label),
    next: next ? next.say : S.phase === 'complete' ? 'Hand over.' : 'No operator decision is waiting.',
  };
}
export function sitrepLines(f) {
  const list = (a, fn, none) => (a.length ? a.map(fn).join('; ') : none);
  const rover = f.units.find((u) => u.id === 'HOUND-01');
  return [
    ['Situation', f.phase + ' at ' + f.as_of + '. ' + f.exercise + '. Operator: ' + f.operator + '.'],
    ['People', list(f.people, (p) => p.id + ' in ' + p.where + ' (' + p.confidence_pct + ' %, ' + p.movement + '), ' + p.status, 'No one confirmed yet') + '.'],
    ['Open leads', list(f.open_leads, (l) => l.id + ' ' + l.where + ' (' + l.confidence_pct + ' %): ' + l.plan, 'None') + '.'],
    ['Closed leads', list(f.closed_leads, (l) => l.id + ' ' + l.where + ': ' + l.judged, 'None') + '.'],
    ['Search', f.search.rooms_clear + ' of ' + f.search.rooms_total + ' rooms clear' + (f.search.highest_missed_chance_pct != null ? ' (highest chance someone was missed: ' + f.search.highest_missed_chance_pct + ' %)' : '') + '. Not searched: ' + list(f.search.not_searched, (r) => r.room + ' (' + r.why + ')', 'none') + '.'],
    ['Route', f.route ? f.route.length_m + ' m, about ' + f.route.eta_min + ' min on foot, ' + f.route.reachable_stops + ' stop' + (f.route.reachable_stops === 1 ? '' : 's') + ', ' + f.route.status + '.' + (f.route.may_cross.length ? ' May cross: ' + f.route.may_cross.join(', ') + '.' : '') : 'None yet.'],
    ['Units', 'HOUND-01 ' + rover.state + ' at ' + rover.at + ', battery ' + rover.battery_pct + ' %, link ' + rover.link_pct + ' %. ' + f.units.filter((u) => u.id !== 'HOUND-01').map((u) => u.name + ' ' + u.state).join('. ') + '.'],
    ['Hazards', f.hazards.join('; ') + '.'],
    ['Faults', f.faults_active.length ? f.faults_active.join('; ') + '.' : 'None active.'],
    ['Next', f.next],
  ];
}
export const SITREP_CAVEAT = 'Simulated exercise. Confidence is the fusion output; radar and thermal likelihoods are assumed design values. Not a medical assessment.';

// ---------- the tools ----------
// kind: ask (read only) | act (changes the mission) | view (changes what is on screen) | drill (a fault, on purpose)
const T = [];
const tool = (t) => T.push({ args: () => obj(), check: () => ({ ok: true }), ...t });

tool({ name: 'get_mission_status', kind: 'ask', title: 'Mission status', llm: 'overall status: phase, clock, units, battery, counts',
  run(a, ctx) {
    const S = ctx.sim.state, f = sitrepFacts(ctx), rover = f.units.find((u) => u.id === 'HOUND-01');
    const facts = { clock: f.as_of, phase: f.phase, phase_note: S.hold ? 'Every unit is holding.' : PHASE_INFO[S.phase].hint, clock_running: S.running, speed: S.speed + 'x', autoplay: S.autoplay,
      people_found: f.people.length, people_reached: f.people.filter((p) => p.status.startsWith('reached')).length, leads_open: f.open_leads.length, leads_closed: f.closed_leads.length,
      rooms_clear: f.search.rooms_clear, rooms_total: f.search.rooms_total, rooms_not_searched: f.search.not_searched.map((r) => r.room), units: f.units, route: f.route ? f.route.status : 'none', faults_active: f.faults_active, next: f.next };
    const text = f.phase + ' at ' + f.as_of + '. ' + (f.people.length ? f.people.length + (f.people.length === 1 ? ' person' : ' people') + ' found (' + f.people.map((p) => p.where).join(', ') + ')' : 'No one found yet') + ', ' + f.open_leads.length + ' open lead' + (f.open_leads.length === 1 ? '' : 's') + '. HOUND-01 is ' + rover.state + ', battery ' + rover.battery_pct + ' %, link ' + rover.link_pct + ' %. ' + (f.faults_active.length ? 'Fault active: ' + f.faults_active.join(', ') + '. ' : '') + f.next;
    return { ok: true, facts, text };
  } });

tool({ name: 'list_leads', kind: 'ask', title: 'List leads', llm: 'list detections. status: confirmed = people found, possible = uncertain/open, rejected = ruled out/false alarms, all = everything',
  args: () => obj({ status: { enum: ['all', 'possible', 'confirmed', 'rejected'] } }), defaults: { status: 'all' },
  run(a, ctx) {
    const S = ctx.sim.state, all = S.detections.filter((d) => a.status === 'all' || d.status === a.status);
    const facts = { filter: a.status, count: all.length, leads: all.map(leadFacts) };
    const word = { all: 'lead', possible: 'possible lead', confirmed: 'confirmed person', rejected: 'closed lead' }[a.status];
    const text = all.length ? all.length + ' ' + word + (all.length === 1 ? '' : a.status === 'confirmed' ? '' : 's') + (a.status === 'confirmed' && all.length > 1 ? ' (people)' : '') + ': ' + all.map((d) => d.id + ' ' + whereOf(d) + ', ' + (a.status === 'all' ? d.status + ' ' : '') + pct(d.p) + ' %' + (d.status === 'rejected' ? ' (' + d.kind + ')' : '')).join('; ') + '.' : S.detections.length ? 'No ' + word + 's right now. ' + S.detections.length + ' lead' + (S.detections.length === 1 ? '' : 's') + ' in total.' : 'No leads yet. Nothing has been detected so far.';
    return { ok: true, facts, text, follow: all.filter((d) => d.status !== 'rejected').slice(0, 2).map((d) => ({ label: 'Explain ' + d.id, call: { tool: 'explain_lead', args: { id: d.id } } })) };
  } });

tool({ name: 'explain_lead', kind: 'ask', title: 'Explain a lead', llm: 'why the system believes what it does about ONE lead (evidence, confidence). Use the lead id from the mission list',
  args: (e) => obj({ id: { enum: ids(e.leads) } }),
  run(a, ctx) {
    const S = ctx.sim.state, d = S.detections.find((x) => x.id === a.id);
    const steps = d.steps.map((s) => ({ at: fmtClock(s.t), sensor: LR[s.sensor]?.label || SENSOR_WORDS[s.sensor] || s.sensor, said: RESULT_WORDS[s.result] || s.result, note: s.note, factor: +s.lr.toFixed(2), ...(s.repeat ? { repeat_reading: 'counted at half weight' } : {}), source: s.assumed ? 'assumed' : 'measured in simulation', after_pct: pct(s.p), key: s.sensor, result: s.result }));
    const facts = { ...leadFacts(d), verdict: d.reason, start_pct: pct(PRIOR), confirm_at_pct: pct(THRESHOLDS.confirmed), keep_open_above_pct: pct(THRESHOLDS.possible), steps, caution: 'Only the Wi-Fi network factor is measured (on simulated test windows). Every other factor is an assumed design value.' };
    const up = steps.filter((s) => s.factor > 1.05).sort((x, y) => y.factor - x.factor)[0], down = steps.filter((s) => s.factor < 0.95).sort((x, y) => x.factor - y.factor)[0];
    const text = d.id + ' is ' + (d.status === 'confirmed' ? 'a confirmed person' : d.status === 'possible' ? 'a possible person' : 'closed (' + d.kind + ')') + ' in ' + whereOf(d).replace('room ', 'room ') + ', ' + pct(d.p) + ' %. ' + d.reason + ' It started at ' + pct(PRIOR) + ' % (assumed) and ' + steps.length + ' reading' + (steps.length === 1 ? '' : 's') + ' moved it.' + (up ? ' Strongest for: ' + up.sensor + ' (' + up.note + ', ×' + up.factor + ').' : '') + (down ? ' Strongest against: ' + down.sensor + ' (' + down.note + ', ×' + down.factor + ').' : '');
    const follow = [{ label: 'Select ' + d.id, call: { tool: 'select', args: { type: 'lead', id: d.id } } }, { label: 'Open Evidence', call: { tool: 'open_workspace', args: { id: 'graph' } } }];
    if (commandState(ctx, 'investigate', { id: d.id }).ok) follow.unshift({ label: 'Second look at ' + d.id, call: { tool: 'investigate', args: { id: d.id } } });
    return { ok: true, facts, text, follow };
  } });

tool({ name: 'list_rooms_not_searched', kind: 'ask', title: 'Rooms not searched', llm: 'rooms not searched or blocked, and the chance someone was missed in searched rooms',
  run(a, ctx) {
    const S = ctx.sim.state, cov = Object.values(S.coverage);
    const not = cov.filter((c) => c.status === 'unsearched' || c.status === 'blocked');
    const facts = { not_searched: not.map((c) => ({ room: c.room, name: ctx.world.roomById(c.room).name, why: c.note })), searched: cov.filter((c) => !not.includes(c)).map((c) => ({ room: c.room, result: c.status === 'clear' ? 'no one detected' : c.status === 'person' ? 'person found' : 'possible person', sensors_reached_pct: pct(c.reach), ...(c.status === 'clear' ? { chance_missed_pct: pct(c.residual) } : {}), ...(c.noCsi ? { note: 'searched without Wi-Fi' } : {}) })), rooms_total: cov.length };
    const clear = cov.filter((c) => c.status === 'clear');
    const text = (not.length ? not.length + ' of ' + cov.length + ' rooms not searched: ' + not.map((c) => c.room + (c.status === 'blocked' ? ' (blocked)' : '')).join(', ') + '.' : 'Every room has been searched.') + (clear.length ? ' In the ' + clear.length + ' clear room' + (clear.length === 1 ? '' : 's') + ' the chance someone was missed is at most ' + Math.max(...clear.map((c) => pct(c.residual))) + ' %.' : '') + (not.some((c) => c.status === 'blocked') ? ' A blocked room is unknown, not clear.' : '');
    return { ok: true, facts, text, follow: not.slice(0, 1).map((c) => ({ label: 'Select room ' + c.room, call: { tool: 'select', args: { type: 'room', id: c.room } } })) };
  } });

tool({ name: 'plan_route', kind: 'act', title: 'Plan the rescue route', llm: 'plan the rescue route. avoid = hazard kinds to stay out of; use all four unless the operator says one may be crossed',
  args: () => obj({ avoid: { type: 'array', items: { enum: HAZARD_KINDS }, uniqueItems: true } }), defaults: { avoid: HAZARD_KINDS.slice() },
  check(a, ctx) {
    if (!a.avoid.includes('collapse')) return { ok: false, unsafe: true, reason: 'Refused. The collapse-risk zone is never crossed: an undercut wall can come down on the team. Plan again without that exception.' };
    return commandState(ctx, 'planRoute');
  },
  run(a, ctx) {
    const avoid = Object.fromEntries(HAZARD_KINDS.map((k) => [k, a.avoid.includes(k)]));
    if (!ctx.sim.command('planRoute', { avoid })) return { ok: false, text: 'The planner did not accept the request.' };
    const S = ctx.sim.state, f = routeFacts(S.routes.rescue, S);
    const text = 'Route planned: ' + f.length_m + ' m, about ' + f.eta_min + ' min on foot, ' + f.reachable_stops + ' stop' + (f.reachable_stops === 1 ? '' : 's') + ' (' + f.stops.filter((s) => s.lead && !s.unreachable).map((s) => s.lead + ' ' + s.access).join(', ') + ').' + (f.stays_out_of.length ? ' Stays out of: ' + f.stays_out_of.join('; ') + '.' : '') + (f.may_cross.length ? ' Allowed to cross: ' + f.may_cross.join(', ') + '.' : '') + ' It is waiting for your approval.';
    return { ok: true, facts: f, text, follow: [{ label: 'Approve route', call: { tool: 'approve_route', args: {} } }] };
  } });

tool({ name: 'approve_route', kind: 'act', title: 'Approve the route', llm: 'approve the planned rescue route so the team moves (a human is always asked to confirm)',
  check: (a, ctx) => commandState(ctx, 'approveRoute'),
  confirm(a, ctx) {
    const S = ctx.sim.state, f = routeFacts(S.routes.rescue, S);
    return { title: 'Approve the rescue route?', confirmLabel: 'Approve route', lines: [f.length_m + ' m, about ' + f.eta_min + ' min on foot.', ...f.stops.map((s) => s.unreachable ? s.order + '. ' + s.lead + ': cannot be reached (' + s.unreachable + ')' : s.order + '. ' + s.lead + ', ' + s.where + ': ' + s.access + (s.wall_gap_m ? ' (' + s.wall_gap_m + ' m of wall to the person)' : '')), f.stays_out_of.length ? 'Stays out of: ' + f.stays_out_of.join('; ') + '.' : null, f.may_cross.length ? 'Allowed to cross: ' + f.may_cross.join(', ') + '.' : null, 'The rescue team starts moving as soon as you approve. The copilot never approves a route by itself.'].filter(Boolean) };
  },
  run(a, ctx) {
    if (!ctx.sim.command('approveRoute')) return { ok: false, text: 'The route could not be approved.' };
    const S = ctx.sim.state, f = routeFacts(S.routes.rescue, S);
    return { ok: true, facts: { ...f, approved_by: S.operator, approved_at: fmtClock(S.t) }, text: 'Approved by ' + S.operator + ' at ' + fmtClock(S.t) + '. The rescue team is moving: ' + f.length_m + ' m, about ' + f.eta_min + ' min.' };
  } });

tool({ name: 'investigate', kind: 'act', title: 'Second look', llm: 'send the rover for a second, closer reading of ONE possible lead',
  args: (e) => obj({ id: { enum: ids(e.leads) } }), check: (a, ctx) => commandState(ctx, 'investigate', a),
  run(a, ctx) {
    const d = ctx.sim.state.detections.find((x) => x.id === a.id);
    if (!ctx.sim.command('investigate', { id: a.id })) return { ok: false, text: 'The rover did not accept the task.' };
    const team = d.outdoor;
    return { ok: true, facts: { lead: d.id, where: whereOf(d), confidence_pct: pct(d.p), task: team ? 'outdoors and too far for the rover: handed to the rescue team for a ground check' : 'rover queued to move to a clear view and listen for 10 s' }, text: team ? d.id + ' is outdoors, too far for the rover to check quickly. It goes to the rescue team for a ground check.' : 'HOUND-01 will move for a clear view of ' + d.id + ' (' + whereOf(d) + ', ' + pct(d.p) + ' %) and listen again. The lead will be confirmed, closed, or handed to the team.', follow: [{ label: 'Select ' + d.id, call: { tool: 'select', args: { type: 'lead', id: d.id } } }] };
  } });

tool({ name: 'all_stop', kind: 'act', title: 'All stop', llm: 'SAFETY: stop every unit where it is, immediately',
  run(a, ctx) {
    const was = ctx.sim.state.hold; ctx.sim.command('allStop');
    return { ok: true, facts: { all_stop: true, at: fmtClock(ctx.sim.state.t), units_holding: Object.keys(ctx.sim.state.units) }, text: was ? 'All stop was already active. Every unit is holding.' : 'All stop. Every unit is holding where it is. Say "resume" when it is safe.', follow: [{ label: 'Resume', call: { tool: 'resume', args: {} } }] };
  } });
tool({ name: 'resume', kind: 'act', title: 'Resume', llm: 'resume the units after an all-stop', check: (a, ctx) => commandState(ctx, 'resume'),
  run(a, ctx) { ctx.sim.command('resume'); return { ok: true, facts: { all_stop: false, at: fmtClock(ctx.sim.state.t) }, text: 'Resumed. Units continue from where they stopped.' }; } });
tool({ name: 'start_mission', kind: 'act', title: 'Start the mission', llm: 'start the mission (the drone survey begins)', check: (a, ctx) => commandState(ctx, 'start'),
  run(a, ctx) { ctx.sim.command('start'); if (!ctx.sim.state.running) ctx.sim.play(); return { ok: true, facts: { started: true }, text: 'Mission started. The scout drone maps the site first.' }; } });

tool({ name: 'set_speed', kind: 'view', title: 'Simulation speed', llm: 'simulation speed multiplier (1 = real time, 32 = fastest)',
  args: () => obj({ speed: { enum: SPEEDS } }),
  run(a, ctx) { ctx.sim.setSpeed(a.speed); return { ok: true, facts: { speed: a.speed + 'x' }, text: 'Simulation speed ' + a.speed + '×' + (a.speed === 1 ? ' (real time).' : ': one real second is ' + a.speed + ' simulated seconds.') }; } });
tool({ name: 'set_clock', kind: 'view', title: 'Play or pause', llm: 'running=false pauses simulated time, running=true plays it. (Not a safety stop)',
  args: () => obj({ running: { type: 'boolean' } }),
  run(a, ctx) { a.running ? ctx.sim.play() : ctx.sim.pause(); return { ok: true, facts: { clock_running: a.running, clock: fmtClock(ctx.sim.state.t) }, text: a.running ? 'Clock running at ' + ctx.sim.state.speed + '×.' : 'Clock paused at ' + fmtClock(ctx.sim.state.t) + '. This freezes simulated time; it is not an all-stop.' }; } });

tool({ name: 'seek_to', kind: 'view', title: 'Seek the replay', llm: 'jump the mission replay to a named moment or to a clock time "mm:ss"',
  args: () => obj({ event: { anyOf: [{ enum: MOMENTS.map((m) => m.id) }, { type: 'string', pattern: '^[0-9]{1,2}:[0-5][0-9]$' }] } }),
  resolve(a, ctx) {
    const clock = parseClock(a.event);
    if (clock != null) return { t: clock, label: fmtClock(clock) };
    const m = MOMENTS.find((x) => x.id === a.event);
    if (m.id === 'start') return { t: 0, label: m.label };
    const hit = keyMoments(ctx).find((k) => k.code === m.code);
    return hit ? { t: hit.t + 0.2, label: m.label, source: hit.source } : null;
  },
  check(a, ctx) { const r = this.resolve(a, ctx); if (!r) return { ok: false, reason: 'That moment does not happen in this run.' }; if (r.t > referenceRun(ctx).end + 600) return { ok: false, reason: 'That is long after the mission ends.' }; return { ok: true }; },
  confirm(a, ctx) {
    const r = this.resolve(a, ctx), lost = ctx.sim.commandLog.filter((c) => c.t > r.t);
    return lost.length ? { title: 'Seek back to ' + fmtClock(r.t) + '?', confirmLabel: 'Seek', lines: ['The mission is replayed from the start up to that moment.', lost.length + ' operator command' + (lost.length === 1 ? '' : 's') + ' given after it will be discarded: ' + lost.map((c) => c.name).join(', ') + '.'] } : null;
  },
  run(a, ctx) { const r = this.resolve(a, ctx); ctx.sim.seek(r.t); const S = ctx.sim.state; return { ok: true, facts: { moment: r.label, clock: fmtClock(S.t), phase: PHASE_INFO[S.phase].label, ...(r.source === 'scripted' ? { note: 'time taken from the scripted run' } : {}) }, text: 'Replay moved to ' + fmtClock(S.t) + ' (' + r.label + '). Phase: ' + PHASE_INFO[S.phase].label + '.' }; } });

tool({ name: 'select', kind: 'view', title: 'Select a thing', llm: 'select/highlight/locate one thing (lead D#, person V#, room, unit, hazard) in every view',
  args: (e) => ({ anyOf: [obj({ type: { enum: ['lead'] }, id: { enum: ids(e.leads) } }), obj({ type: { enum: ['person'] }, id: { enum: ids(e.people) } }), obj({ type: { enum: ['room'] }, id: { enum: ids(e.rooms) } }), obj({ type: { enum: ['unit'] }, id: { enum: ids(e.units) } }), obj({ type: { enum: ['hazard'] }, id: { enum: ids(e.hazards) } })] }),
  run(a, ctx) {
    const S = ctx.sim.state; ctx.select({ type: SEL_TYPE[a.type], id: a.id });
    let facts, text;
    if (a.type === 'lead') { const d = S.detections.find((x) => x.id === a.id); facts = leadFacts(d); text = d.id + ': ' + d.status + ' ' + (d.status === 'rejected' ? '(' + d.kind + ')' : 'person') + ', ' + whereOf(d) + ', ' + pct(d.p) + ' %.'; }
    else if (a.type === 'person') { const v = S.survivors[a.id]; facts = { id: v.id, lead: v.detId, where: whereOf(v), confidence_pct: pct(v.p), movement: v.motion, status: v.status, found_at: fmtClock(v.foundAt) }; text = v.id + ': person in ' + whereOf(v) + ', ' + pct(v.p) + ' %, ' + v.motion + ', ' + (v.status === 'reached' ? 'reached by the team.' : 'not yet reached.'); }
    else if (a.type === 'room') { const c = S.coverage[a.id], r = ctx.world.roomById(a.id); facts = { room: a.id, name: r.name, search: c.status, sensors_reached_pct: pct(c.reach), note: c.note, ...(c.status === 'clear' ? { chance_missed_pct: pct(c.residual) } : {}) }; text = r.name + ': ' + c.note; }
    else if (a.type === 'unit') { facts = unitFacts(S.units[a.id], ctx); text = facts.name + ' is ' + facts.state + ' at ' + facts.at + (facts.battery_pct != null ? ', battery ' + facts.battery_pct + ' %, link ' + facts.link_pct + ' %.' : '.') + (facts.note ? ' (' + facts.note + ')' : ''); }
    else { const hz = [...ctx.world.HAZARDS, ...S.hazards].find((x) => x.id === a.id); facts = { id: hz.id, kind: hz.kind, name: hz.name, effect: hz.block ? 'never crossed' : 'crossed only at ' + hz.cost + ' times the normal cost' }; text = hz.name + '. The planner treats it as ' + facts.effect + '.'; }
    return { ok: true, facts: { selected: a.type + ' ' + a.id, ...facts }, text: 'Selected. ' + text, follow: ctx.shell.current() === 'mission' ? [] : [{ label: 'See it in Mission', call: { tool: 'open_workspace', args: { id: 'mission' } } }] };
  } });

tool({ name: 'open_workspace', kind: 'view', title: 'Open a workspace', llm: 'open one of the console workspaces',
  args: (e) => obj({ id: { enum: ids(e.workspaces) } }),
  run(a, ctx) { const m = ctx.manifest.find((x) => x.id === a.id); ctx.shell.open(a.id); return { ok: true, facts: { opened: m.title, purpose: m.blurb }, text: 'Opened ' + m.title + '. ' + m.blurb }; } });

export const layerState = new Map(); // what the copilot and the palette asked the 3-D view for
tool({ name: 'set_layer', kind: 'view', title: 'Show or hide a layer', llm: 'show (on=true) or hide (on=false) a layer of the 3-D view',
  args: () => obj({ layer: { enum: LAYERS.map((l) => l.id) }, on: { type: 'boolean' } }),
  run(a, ctx) { const l = LAYERS.find((x) => x.id === a.layer); layerState.set(a.layer, a.on); ctx.bus.emit('twin:layer', { id: a.layer, on: a.on }); return { ok: true, facts: { layer: l.label, shown: a.on, what: l.does }, text: l.label + ' ' + (a.on ? 'on' : 'off') + ' in the 3-D view. ' + l.does, follow: ctx.shell.current() === 'mission' ? [] : [{ label: 'See it in Mission', call: { tool: 'open_workspace', args: { id: 'mission' } } }] }; } });

tool({ name: 'inject_fault', kind: 'drill', title: 'Start a fault drill', llm: 'start a fault drill: linkLoss radio link lost, csiDropout Wi-Fi packets dropping, badWindow corrupt Wi-Fi window, thermalFail thermal camera offline, lowBattery rover battery low',
  args: () => obj({ id: { enum: Object.keys(FAULTS) } }), check: (a, ctx) => commandState(ctx, 'injectFault', a),
  run(a, ctx) { ctx.sim.command('injectFault', { id: a.id }); const f = FAULTS[a.id]; return { ok: true, facts: { drill: f.label, expected_safe_behaviour: f.does, started_at: fmtClock(ctx.sim.state.t) }, text: 'Drill started: ' + f.label.toLowerCase() + '. Expected: ' + f.does, follow: [{ label: 'End this drill', call: { tool: 'clear_fault', args: { id: a.id } } }] }; } });
tool({ name: 'clear_fault', kind: 'drill', title: 'End a fault drill', llm: 'end a fault drill (same ids as inject_fault)',
  args: () => obj({ id: { enum: Object.keys(FAULTS) } }), check: (a, ctx) => commandState(ctx, 'clearFault', a),
  run(a, ctx) { ctx.sim.command('clearFault', { id: a.id }); return { ok: true, facts: { drill_ended: FAULTS[a.id].label, at: fmtClock(ctx.sim.state.t) }, text: FAULTS[a.id].label + ': cleared.' }; } });

tool({ name: 'write_sitrep', kind: 'ask', title: 'Situation report', llm: 'write a situation report (sitrep) from the mission state',
  run(a, ctx) { const facts = sitrepFacts(ctx); return { ok: true, facts, text: sitrepLines(facts).map(([k, v]) => k + ': ' + v).join('\n') }; } });

tool({ name: 'none', kind: 'none', title: 'No tool', llm: 'nothing fits, or the request is unsafe, medical, or outside this console',
  run() { return { ok: true, facts: null, text: 'No tool fits that request, so nothing was done and I have no mission facts to answer from. I can report status, list and explain leads, show what was not searched, plan a route, stop and resume units, run fault drills, move the replay, and open views.' }; } });

export const TOOLS = T;
export const toolByName = (n) => T.find((t) => t.name === n) || null;
export const ACTS = new Set(T.filter((t) => t.kind === 'act' || t.kind === 'drill').map((t) => t.name));
export const PHRASED = new Set(['get_mission_status', 'list_leads', 'explain_lead', 'list_rooms_not_searched']);

// The schema the language model's output is constrained to: exactly one known tool with exactly its arguments.
export function callSchema(ent) {
  return { anyOf: T.map((t) => ({ type: 'object', properties: { tool: { enum: [t.name] }, args: t.args(ent) }, required: ['tool', 'args'], additionalProperties: false })) };
}
// Fill defaults, put list arguments in a fixed order, tidy clock strings. Used before validation and for scoring.
export function normalise(call) {
  if (!call || typeof call !== 'object') return { tool: String(call), args: {} };
  const t = toolByName(call.tool), args = { ...(t?.defaults || {}), ...(call.args && typeof call.args === 'object' ? call.args : {}) };
  if (call.tool === 'plan_route' && Array.isArray(args.avoid)) args.avoid = HAZARD_KINDS.filter((k) => args.avoid.includes(k)).concat(args.avoid.filter((k) => !HAZARD_KINDS.includes(k)));
  if (call.tool === 'seek_to' && typeof args.event === 'string' && parseClock(args.event) != null) args.event = normClock(args.event);
  if (call.tool === 'set_speed' && typeof args.speed === 'string' && /^\d+$/.test(args.speed)) args.speed = +args.speed;
  return { tool: call.tool, args };
}
export const sameCall = (a, b) => JSON.stringify(sortKeys(normalise(a))) === JSON.stringify(sortKeys(normalise(b)));
function sortKeys(v) { return Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v; }
// Schema check for one call against what exists now. Returns { ok, errors, tool }.
export function validateCall(call, ent) {
  const t = toolByName(call?.tool);
  if (!t) return { ok: false, errors: ['"' + String(call?.tool) + '" is not a tool of this console'], tool: null };
  const errors = validate(t.args(ent), call.args, 'args');
  return { ok: !errors.length, errors, tool: t };
}
export function formatCall(call) {
  const a = Object.entries(call.args || {}).map(([k, v]) => k + ': ' + (Array.isArray(v) ? '[' + v.join(', ') + ']' : JSON.stringify(v))).join(', ');
  return call.tool + (a ? ' { ' + a + ' }' : ' { }');
}

// Every number and id in a model-written answer must appear in the tool's facts (or in the operator's own words).
// Returns the tokens that do not: if there are any, the wording is thrown away and the code-written text is shown.
const TOKEN = /\b(?:[DVS]\d{1,2}|HOUND-01|DRONE-01|TEAM-1|\d{1,3}:\d{2}|\d+(?:\.\d+)?)\b/g;
const canon = (tok) => (/^\d{1,3}:\d{2}$/.test(tok) ? normClock(tok) : /^\d/.test(tok) ? String(parseFloat(tok)) : tok.toUpperCase());
export function groundCheck(text, facts, allowText = '') {
  const allowed = new Set((JSON.stringify(facts ?? '') + ' ' + allowText).match(TOKEN)?.map(canon) || []);
  const found = [...new Set(String(text).match(TOKEN) || [])];
  const unknown = found.filter((tok) => !allowed.has(canon(tok)));
  return { ok: !unknown.length, checked: found.length, unknown };
}
