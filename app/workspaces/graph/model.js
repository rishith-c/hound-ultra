// Evidence graph model: turns the live mission state into nodes and edges. Pure functions, no DOM.
// Nothing here reads ground truth. Every node and edge comes from what the console's sensors and log recorded.
import { LR, PRIOR, THRESHOLDS, fuse, classify } from '../../core/fusion.js';

export const TYPES = {
  person: { label: 'Person', plural: 'People', means: 'A confirmed find.' },
  lead: { label: 'Lead', plural: 'Leads', means: 'A place where something pointed to a person. Open, confirmed or closed.' },
  reading: { label: 'Reading', plural: 'Readings', means: 'One piece of evidence from one sensor at one stop.' },
  sensor: { label: 'Sensor', plural: 'Sensors', means: 'What produced a reading.' },
  stop: { label: 'Stop', plural: 'Stops', means: 'Where the reading was taken from.' },
  unit: { label: 'Unit', plural: 'Units', means: 'The rover, the drone, the rescue team.' },
  room: { label: 'Room', plural: 'Rooms', means: 'A room of Building B and its search status.' },
  hazard: { label: 'Hazard', plural: 'Hazards', means: 'A danger area or a blockage.' },
  route: { label: 'Route', plural: 'Routes', means: 'The planned way in for the rescue team.' },
  alert: { label: 'Alert', plural: 'Alerts', means: 'A warning raised during the mission.' },
  decision: { label: 'Decision', plural: 'Decisions', means: 'Who decided what, and when.' },
};
export const TYPE_ORDER = ['person', 'lead', 'reading', 'sensor', 'stop', 'unit', 'room', 'hazard', 'route', 'alert', 'decision'];

export const EDGE_KINDS = {
  supports: { label: 'supports', means: 'The reading makes a person more likely.' },
  contradicts: { label: 'contradicts', means: 'The reading makes a person less likely.' },
  neutral: { label: 'no information', means: 'The sensor could not see. The reading changes nothing.' },
  confirmed: { label: 'confirmed as', means: 'The lead became a located person.' },
  from: { label: 'observed from', means: 'Where the rover, drone or team was.' },
  by: { label: 'measured by', means: 'Which sensor.' },
  inRoom: { label: 'in room', means: 'Where the lead is.' },
  covers: { label: 'covers', means: 'Rooms a stop can sense.' },
  carries: { label: 'carries', means: 'Sensors on a unit.' },
  visited: { label: 'stopped at', means: 'Where a unit took readings.' },
  threatens: { label: 'affects', means: 'A hazard that overlaps or blocks a room.' },
  leadsTo: { label: 'leads to', means: 'The route reaches this person.' },
  avoids: { label: 'avoids', means: 'The route was planned around this.' },
  approvedBy: { label: 'approved by', means: 'The human approval step.' },
  about: { label: 'about', means: 'What an alert or a decision refers to.' },
};

export const SENSOR_ORDER = ['aerial', 'csi', 'radar', 'micro', 'thermal', 'signature', 'temperature', 'acoustic', 'human'];
export const SENSOR_INFO = {
  csi: { short: 'Wi-Fi', name: 'Wi-Fi neural network', real: 'live-ai', what: 'A 1-D CNN (23,372 parameters) reads a 10 second Wi-Fi window. It runs for real in this browser, on simulated windows.' },
  radar: { short: 'Radar', name: 'Radar, moving target', real: 'sim', what: 'HLK-LD2450 24 GHz radar. Tracks a moving person. Simulated reading.' },
  micro: { short: 'Micro', name: 'Radar, micro-motion', real: 'sim', what: 'HLK-LD2410C presence radar. Looks for small repeating motion. Simulated reading.' },
  thermal: { short: 'Thermal', name: 'Thermal camera', real: 'sim', what: 'MLX90640, 32 by 24 pixels. Cannot see through walls. Simulated reading.' },
  signature: { short: 'Pattern', name: 'Motion pattern check', real: 'sim', what: 'Is the motion steady and repeating, like a machine? Simulated reading.' },
  temperature: { short: 'Temp', name: 'Temperature check', real: 'sim', what: 'Is the warm spot far above skin temperature? Simulated reading.' },
  aerial: { short: 'Drone', name: 'Drone image detector', real: 'concept', what: 'A person-shaped object in the drone image. The drone is a concept; the detection is simulated.' },
  acoustic: { short: 'Sound', name: 'Tapping or voice', real: 'sim', what: 'Tapping or a voice heard at the stop.' },
  human: { short: 'Team', name: 'Rescue team, in person', real: 'sim', what: 'A rescuer saw the person. Simulated team.' },
};
const RESULT_WORD = { pos: 'positive', faint: 'faint', neg: 'negative', none: 'nothing seen', blind: 'could not see', machine: 'machine-like', tooHot: 'too hot' };
const DECISION_CODES = new Set(['MISSION_START', 'INVESTIGATE', 'TEAM_CHECK', 'LEAD_CLOSED', 'ROUTE_PLANNED', 'ROUTE_APPROVED', 'ROUTE_REJECTED', 'ALL_STOP', 'RESUMED', 'BATTERY_SWAPPED', 'MISSION_COMPLETE']);
const DECISION_TITLE = { MISSION_START: 'Exercise started', INVESTIGATE: 'Second look ordered', TEAM_CHECK: 'Handed to the rescue team', LEAD_CLOSED: 'Lead closed', ROUTE_PLANNED: 'Route planned', ROUTE_APPROVED: 'Route approved', ROUTE_REJECTED: 'Route thrown away', ALL_STOP: 'All stop', RESUMED: 'Resumed', BATTERY_SWAPPED: 'Battery swapped', MISSION_COMPLETE: 'Mission complete' };
const ALERT_TITLE = { PERSON_FOUND: 'Person found', POSSIBLE_PERSON: 'Possible person', FAULT: 'Fault', NEW_HAZARD: 'New hazard', ROOM_BLOCKED: 'Room not searched', NO_PATH: 'No safe path', WINDOW_REJECTED: 'Wi-Fi window rejected', CSI_UNAVAILABLE: 'Wi-Fi unavailable', BATTERY_LOW: 'Battery low', NO_VANTAGE: 'No clear viewpoint', REPLANNED: 'Planned again', NOTHING_TO_PLAN: 'Nothing to plan' };

const clock = (t) => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); };
const pct = (p) => (p * 100).toFixed(p > 0.995 || p < 0.005 ? 1 : 0) + ' %';
function inPoly(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function overlap(poly, rect) { let n = 0, tot = 0; for (let y = rect[1] + 0.5; y < rect[3]; y++) for (let x = rect[0] + 0.5; x < rect[2]; x++) { tot++; if (inPoly([x, y], poly)) n++; } return tot ? n / tot : 0; }

// A cheap fingerprint of everything the graph depends on. The view rebuilds only when it changes.
export function signature(S) {
  let ev = 0, st = '';
  for (const d of S.detections) { ev += d.evidence.length; st += d.status[0] + (d.needsTeam ? 't' : '') + (d.survivorId || ''); }
  const r = S.routes.rescue;
  let sv = ''; for (const v of Object.values(S.survivors)) sv += v.status[0];
  let cov = ''; for (const c of Object.values(S.coverage)) cov += c.status[0];
  return [S.detections.length, ev, st, S.events.length, r ? r.status + r.legs.length + (r.plannedAt || 0) : '-', sv, cov, S.hazards.length, S.operator].join('|');
}

export function buildGraph(S, world, { commandLog = [] } = {}) {
  const nodes = new Map(), edges = new Map();
  const node = (id, type, o) => { const n = { id, type, label: id, sub: '', t: null, status: '', ref: null, lane: null, sensor: null, ...o }; nodes.set(id, n); return n; };
  const edge = (source, target, kind, o = {}) => { if (!nodes.has(source) || !nodes.has(target)) return null; const id = source + '>' + target + ':' + kind; const e = { id, source, target, kind, label: EDGE_KINDS[kind].label, w: 0, ...o }; edges.set(id, e); return e; };
  const roomName = (id) => world.roomById(id)?.name || ('Room ' + id);

  // Units
  for (const u of Object.values(S.units)) node('U:' + u.id, 'unit', { label: u.name, sub: u.kind === 'rover' ? 'Rover. The only unit that exists as hardware.' : u.kind === 'drone' ? 'Scout drone (concept, simulated)' : 'Rescue team (simulated)', status: u.mode, kind: u.kind, ref: { type: 'unit', id: u.id }, pos: u.pos, data: u });

  // Rooms
  for (const r of world.ROOMS) {
    if (r.corridor) continue;
    let c = S.coverage[r.id] || { status: 'unsearched', residual: PRIOR, reach: 0, note: '' };
    // A second look updates the lead but not state.coverage (see orchestration/requests), so a confirmed lead wins here.
    const found = S.detections.find((d) => d.room === r.id && d.status === 'confirmed');
    if (found && c.status !== 'person') c = { ...c, status: 'person', residual: found.p, note: 'Person confirmed at ' + pct(found.p) + '.' };
    node('RM:' + r.id, 'room', { label: r.id, long: r.name, sub: ({ unsearched: 'Not searched yet', clear: 'Searched, no one detected', lead: 'Possible person', person: 'Person found', blocked: 'Could not be searched' })[c.status] || c.status, status: c.status, t: c.t ?? null, lane: r.id, ref: { type: 'room', id: r.id }, pos: [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2], data: { room: r, cov: c } });
  }

  // Hazards (world, added during the mission, and blocking rubble)
  const hz = [...world.HAZARDS, ...S.hazards].map((x) => ({ ...x, src: 'hazard' }));
  for (const o of world.OBSTACLES) if (o.kind === 'rubble' && !o.passable) hz.push({ ...o, src: 'obstacle', block: true });
  for (const x of hz) {
    const cx = x.poly.reduce((s, p) => s + p[0], 0) / x.poly.length, cy = x.poly.reduce((s, p) => s + p[1], 0) / x.poly.length;
    node('HZ:' + x.id, 'hazard', { label: x.name.split(':')[0].split(',')[0].replace(/ \(.*\)/, ''), long: x.name, sub: x.src === 'obstacle' ? 'Blockage. Cannot be crossed.' : x.block ? 'No-go area' : 'Costly to cross (planner cost ×' + x.cost + ', assumed)', status: x.block ? 'block' : 'cost', kind: x.kind, t: x.t ?? null, ref: x.src === 'hazard' ? { type: 'hazard', id: x.id } : null, pos: [cx, cy], data: x });
    for (const r of world.ROOMS) { if (r.corridor) continue; const f = overlap(x.poly, r.rect); if (f > 0.04) edge('HZ:' + x.id, 'RM:' + r.id, 'threatens', { note: Math.round(f * 100) + ' % of the room' }); }
  }
  for (const [id, c] of Object.entries(S.coverage)) if (c.status === 'blocked' && nodes.has('HZ:rubble-corridor')) edge('HZ:rubble-corridor', 'RM:' + id, 'threatens', { note: 'blocks the way in' });

  // Stops: the four planned listening stops, plus any other vantage that produced evidence.
  const visited = new Map();
  for (const d of S.detections) for (const e of d.evidence) { const v = visited.get(e.vantage) || { t: e.t, unit: e.unit, n: 0 }; v.t = Math.min(v.t, e.t); v.n++; visited.set(e.vantage, v); }
  for (const c of Object.values(S.coverage)) if (c.stop && !visited.has(c.stop)) visited.set(c.stop, { t: c.t, unit: 'HOUND-01', n: 0 });
  for (const s of world.STOPS) {
    const v = visited.get(s.id);
    node('ST:' + s.id, 'stop', { label: s.id, long: s.label, sub: v ? 'Listened here from ' + clock(v.t) : 'Planned stop, not reached yet', status: v ? 'visited' : 'planned', t: v?.t ?? null, ref: { type: 'stop', id: s.id }, pos: s.pos, data: s });
    for (const r of s.covers) edge('ST:' + s.id, 'RM:' + r, 'covers');
    if (v) edge('U:' + v.unit, 'ST:' + s.id, 'visited');
  }
  for (const [k, v] of visited) {
    if (nodes.has('ST:' + k)) continue;
    const label = k === 'aerial' ? 'Drone pass' : k === 'team' ? 'Team on site' : k;
    node('ST:' + k, 'stop', { label, long: k === 'aerial' ? 'Drone survey pass over the site' : k === 'team' ? 'Rescue team at the person (simulated)' : 'Second look from a clearer viewpoint', sub: 'From ' + clock(v.t), status: 'visited', t: v.t, ref: null, data: { id: k } });
    edge('U:' + v.unit, 'ST:' + k, 'visited');
  }

  // Leads, people, readings, sensors
  const sensorSeen = new Map();
  for (const d of S.detections) {
    const where = d.room ? roomName(d.room) : d.outdoor ? 'Outdoors, debris field' : 'Unknown place';
    const lane = d.room || (d.outdoor ? 'out' : null);
    node('L:' + d.id, 'lead', { label: 'Lead ' + d.id, long: where, sub: (d.status === 'confirmed' ? 'Confirmed' : d.status === 'possible' ? (d.needsTeam ? 'Possible, team to check' : 'Possible') : 'Closed: ' + d.kind) + ' · ' + pct(d.p), status: d.status, p: d.p, t: d.t, lane, ref: { type: 'detection', id: d.id }, pos: d.pos, data: d });
    if (d.room) edge('L:' + d.id, 'RM:' + d.room, 'inRoom');
    d.evidence.forEach((e, i) => {
      const step = d.steps[i] || {};
      const lr = step.lr ?? 1, raw = step.rawLr ?? lr;
      const shared = e.sensor === 'csi';
      const rid = shared ? 'R:csi:' + e.vantage + ':' + e.t : 'R:' + d.id + ':' + i;
      const info = SENSOR_INFO[e.sensor] || { short: e.sensor, name: LR[e.sensor]?.label || e.sensor, real: 'sim', what: '' };
      let r = nodes.get(rid);
      if (!r) {
        r = node(rid, 'reading', { label: info.short + ' ' + (RESULT_WORD[e.result] || e.result), long: e.note || '', sub: clock(e.t) + ' · from ' + (e.vantage === 'aerial' ? 'the drone pass' : e.vantage === 'team' ? 'the team on site' : e.vantage), t: e.t, sensor: e.sensor, lane, status: e.result, vantage: e.vantage, w: 0, leads: [], ref: { type: 'detection', id: d.id }, data: e });
        edge(rid, 'ST:' + e.vantage, 'from');
        if (!sensorSeen.has(e.sensor)) sensorSeen.set(e.sensor, { unit: e.unit, n: 0, t: e.t });
        sensorSeen.get(e.sensor).n++;
      }
      r.leads.push({ det: d.id, index: i, lr, raw, repeat: step.repeat || 0, p: step.p });
      r.w = Math.max(r.w, Math.abs(Math.log(lr)));
      const kind = lr > 1.001 ? 'supports' : lr < 0.999 ? 'contradicts' : 'neutral';
      if (!r.dir || kind !== 'neutral') r.dir = r.dir && r.dir !== kind && r.dir !== 'neutral' ? 'mixed' : kind;
      edge(rid, 'L:' + d.id, kind, { w: Math.abs(Math.log(lr)), lr, raw, repeat: step.repeat || 0, t: e.t, order: i });
    });
    if (d.survivorId && S.survivors[d.survivorId]) {
      const v = S.survivors[d.survivorId];
      node('P:' + v.id, 'person', { label: 'Person ' + v.id, long: where, sub: (v.status === 'reached' ? 'Reached by the team' : 'Located') + ' · ' + (v.motion === 'moving' ? 'moving' : 'still') + ' · ' + pct(v.p ?? d.p), status: v.status, p: v.p ?? d.p, t: v.foundAt, lane, ref: { type: 'survivor', id: v.id }, pos: v.pos, det: d.id, data: v });
      edge('L:' + d.id, 'P:' + v.id, 'confirmed', { t: v.foundAt });
    }
  }
  for (const [s, v] of sensorSeen) {
    const info = SENSOR_INFO[s] || { short: s, name: LR[s]?.label || s, real: 'sim', what: '' };
    node('SN:' + s, 'sensor', { label: info.name, sub: v.n + (v.n === 1 ? ' reading' : ' readings') + (LR[s] ? LR[s].assumed ? ' · design-value weight' : ' · weight measured' : ''), sensor: s, t: null, status: info.real, data: { id: s, info, lr: LR[s], n: v.n } });
    edge('U:' + v.unit, 'SN:' + s, 'carries');
  }
  for (const n of [...nodes.values()]) if (n.type === 'reading') edge(n.id, 'SN:' + n.sensor, 'by');

  // Route
  const r = S.routes.rescue;
  if (r) {
    const good = r.legs.filter((l) => l.ok);
    node('RT:rescue', 'route', { label: 'Rescue route', sub: ({ planned: 'Planned, waiting for approval', approved: 'Approved, team moving', done: 'Walked' })[r.status] + ' · ' + r.length.toFixed(0) + ' m', status: r.status, t: r.plannedAt ?? null, ref: null, data: r });
    edge('U:' + r.unit, 'RT:rescue', 'visited', { label: 'assigned' });
    good.forEach((l, i) => { const tgt = l.survivor && nodes.has('P:' + l.survivor) ? 'P:' + l.survivor : 'L:' + l.det; edge('RT:rescue', tgt, 'leadsTo', { order: i, note: 'Leg ' + (i + 1) + ': ' + l.length.toFixed(0) + ' m, ' + l.kind }); });
    for (const name of r.avoided) { const h = [...nodes.values()].find((n) => n.type === 'hazard' && n.long === name); if (h) edge('RT:rescue', h.id, 'avoids'); }
  }

  // Alerts and decisions, from the mission log
  const cmdAt = (name, t, id) => commandLog.some((c) => c.name === name && c.t <= t + 0.2 && (id == null || c.args?.id === id));
  for (const ev of S.events) {
    const isDecision = DECISION_CODES.has(ev.code);
    if (!isDecision && !(ev.level === 'alert' || ev.level === 'warn')) continue;
    if (ev.code === 'BATTERY_SWAPPED' || ev.code === 'MISSION_COMPLETE') continue;
    const det = ev.det && S.detections.find((d) => d.id === ev.det);
    const lane = det ? det.room || (det.outdoor ? 'out' : null) : ev.room || null;
    let n;
    if (isDecision) {
      let by = 'Mission rule';
      if (ev.code === 'MISSION_START') by = cmdAt('start', ev.t) ? S.operator : 'Autoplay (demo)';
      else if (ev.code === 'INVESTIGATE') by = cmdAt('investigate', ev.t, ev.det) ? S.operator : 'Autoplay (demo)';
      else if (ev.code === 'LEAD_CLOSED') by = det?.dismissed ? S.operator : 'Fusion rule (below ' + pct(THRESHOLDS.possible) + ')';
      else if (ev.code === 'ROUTE_PLANNED') by = 'Route planner (live algorithm)';
      else if (ev.code === 'ROUTE_APPROVED') by = r?.approvedBy === 'autoplay' || /autoplay/.test(ev.text) ? 'Autoplay (demo)' : (r?.approvedBy || S.operator);
      else if (['ROUTE_REJECTED', 'ALL_STOP', 'RESUMED'].includes(ev.code)) by = S.operator;
      n = node('DC:' + ev.id, 'decision', { label: DECISION_TITLE[ev.code], long: ev.text, sub: clock(ev.t) + ' · ' + by, by, human: !/rule|Autoplay|planner/.test(by), t: ev.t, lane, status: ev.code, ref: { type: 'event', id: ev.id }, pos: ev.pos, data: ev });
      if (r && nodes.has('RT:rescue') && ev.t >= (r.plannedAt ?? 0) - 0.2) { if (ev.code === 'ROUTE_APPROVED') edge('RT:rescue', n.id, 'approvedBy'); else if (ev.code === 'ROUTE_PLANNED' && Math.abs(ev.t - r.plannedAt) < 0.3) edge(n.id, 'RT:rescue', 'about'); }
    } else {
      n = node('AL:' + ev.id, 'alert', { label: ALERT_TITLE[ev.code] || ev.code.toLowerCase().replace(/_/g, ' '), long: ev.text, sub: clock(ev.t) + ' · ' + (ev.level === 'alert' ? 'alert' : 'warning'), t: ev.t, lane, status: ev.level, ref: { type: 'event', id: ev.id }, pos: ev.pos, data: ev });
    }
    if (det) edge(n.id, 'L:' + det.id, 'about');
    else if (ev.room) edge(n.id, 'RM:' + ev.room, 'about');
    else if (ev.hazard) edge(n.id, 'HZ:' + ev.hazard, 'about');
    else if (ev.unit) edge(n.id, 'U:' + ev.unit, 'about');
  }

  const list = [...nodes.values()], elist = [...edges.values()];
  const deg = new Map(); for (const e of elist) { deg.set(e.source, (deg.get(e.source) || 0) + 1); deg.set(e.target, (deg.get(e.target) || 0) + 1); }
  for (const n of list) n.degree = deg.get(n.id) || 0;
  return { nodes: list, edges: elist, byId: nodes };
}

// "Why do we believe this?": the fusion working for one lead, in order, with the reading node behind each step.
export function whyChain(det) {
  const steps = det.steps.map((s, i) => {
    const e = det.evidence[i];
    return { index: i, node: e.sensor === 'csi' ? 'R:csi:' + e.vantage + ':' + e.t : 'R:' + det.id + ':' + i, t: e.t, sensor: e.sensor, name: (SENSOR_INFO[e.sensor] || {}).name || e.sensor, vantage: e.vantage, result: e.result, word: RESULT_WORD[e.result] || e.result, note: e.note, lr: s.lr, raw: s.rawLr, repeat: s.repeat, assumed: s.assumed, p: s.p, ln: Math.log(s.lr) };
  });
  return { prior: PRIOR, steps, p: det.p, cls: classify(det.p) };
}

// "What would change our mind?": add one hypothetical reading from a fresh viewpoint and run the real fusion again.
const HYPO = [
  { sensor: 'thermal', result: 'neg', text: 'Thermal camera with a clear view shows no warm shape', dir: -1 },
  { sensor: 'radar', result: 'neg', text: 'Radar sees no moving target from a new position', dir: -1 },
  { sensor: 'micro', result: 'neg', text: 'Micro-motion radar finds no breathing-sized motion', dir: -1 },
  { sensor: 'csi', result: 'neg', text: 'Wi-Fi network says "no one" from a new position', dir: -1 },
  { sensor: 'signature', result: 'machine', text: 'The motion turns out steady and repeating, like a machine', dir: -1 },
  { sensor: 'temperature', result: 'tooHot', text: 'The warm spot measures far above skin temperature', dir: -1 },
  { sensor: 'thermal', result: 'pos', text: 'Thermal camera with a clear view shows a body-warm shape', dir: 1 },
  { sensor: 'radar', result: 'pos', text: 'Radar tracks a moving target', dir: 1 },
  { sensor: 'micro', result: 'pos', text: 'Micro-motion radar finds small rhythmic motion', dir: 1 },
  { sensor: 'csi', result: 'pos', text: 'Wi-Fi network says "person" from a new position', dir: 1 },
  { sensor: 'acoustic', result: 'pos', text: 'Tapping or a voice is heard', dir: 1 },
  { sensor: 'human', result: 'pos', text: 'A rescuer sees the person', dir: 1 },
];
export function changeMind(det) {
  const base = det.evidence, now = classify(det.p);
  const row = (h, k) => { const f = fuse([...base, { sensor: h.sensor, result: h.result, vantage: 'hypothetical-' + k }]); return { ...h, lr: LR[h.sensor][h.result], assumed: LR[h.sensor].assumed, p: f.p, cls: classify(f.p), flips: classify(f.p) !== now }; };
  const against = HYPO.filter((h) => h.dir < 0).map(row).sort((a, b) => a.p - b.p);
  const forIt = HYPO.filter((h) => h.dir > 0).map(row).sort((a, b) => b.p - a.p);
  // Fewest contradicting readings (strongest first) that would close the lead, and fewest supporting that would confirm it.
  const greedy = (list, done) => { const used = []; let ev = [...base]; for (const h of list) { ev = [...ev, { sensor: h.sensor, result: h.result, vantage: 'hypothetical-g' + used.length }]; used.push(h); const p = fuse(ev).p; if (done(p)) return { ok: true, used, p }; } return { ok: false, used, p: fuse(ev).p }; };
  const close = now === 'unlikely' ? null : greedy([...against].sort((a, b) => a.lr - b.lr), (p) => p < THRESHOLDS.possible);
  const confirm = now === 'confirmed' ? null : greedy(forIt.filter((h) => h.sensor !== 'human').sort((a, b) => b.lr - a.lr), (p) => p >= THRESHOLDS.confirmed);
  return { now, p: det.p, against, forIt, close, confirm, thresholds: THRESHOLDS };
}
export { clock, pct, PRIOR, THRESHOLDS, LR };
