// The mission simulator. It plays one search-and-rescue mission, step by step, the same way every time.
//
// WHAT IS REAL AND WHAT IS NOT
//   Real:      the Wi-Fi neural network (core/nn.js) runs on every listening stop; the route planner (core/planner.js)
//              and the fusion maths (core/fusion.js) run for real.
//   Simulated: the building, the people, the rover's motion, and the radar / thermal / drone readings. The Wi-Fi
//              windows fed to the network are simulated test windows, chosen to match what is near the rover.
//
// HOW TO USE IT (from a workspace: ctx.sim)
//   sim.state                 the whole mission state (read it, never write it)
//   sim.command(name, args)   the only way to change the mission; see COMMANDS below
//   sim.play() / pause() / toggle() / setSpeed(x) / reset() / seek(t)
//   bus events                'tick' (once per animation frame while running), 'phase', 'event', 'reading',
//                             'detection', 'survivor', 'route', 'fault', 'reset', 'seek'
//   Draw from sim.state. Use events only for one-off effects (a sound, a flash). After 'reset' or 'seek', redraw.
//
// The clock is simulated seconds. state.speed is how many simulated seconds pass per real second.
import { mulberry32, dist, pathLength, pointAlong, pointInPoly, pointInRect, rectCenter } from './geometry.js';
import { SEED, SITE, STOPS, UNITS, SENSORS, ROOMS, HAZARDS, OBSTACLES, TRUTH, wallsCrossed, sightline, buildGrid, roomAt, roomById } from './world.js';
import { planPath } from './planner.js';
import { fuse, classify, PRIOR } from './fusion.js';

export const DT = 0.1;
export const PHASES = ['standby', 'aerial', 'deploy', 'search', 'assess', 'plan', 'rescue', 'complete'];
export const PHASE_INFO = {
  standby: { label: 'Ready', hint: 'Press Start mission. The drone maps the site first.' },
  aerial: { label: 'Drone survey', hint: 'The scout drone maps the site from above and looks for people in the open.' },
  deploy: { label: 'Rover deploying', hint: 'HOUND-01 drives from staging to the building entrance.' },
  search: { label: 'Searching', hint: 'HOUND-01 stops at each room and listens for 10 seconds through the walls.' },
  assess: { label: 'Checking leads', hint: 'Uncertain readings are checked from a second position before anyone is sent in.' },
  plan: { label: 'Planning rescue', hint: 'A safe route for the rescue team is planned around the damage. A person must approve it.' },
  rescue: { label: 'Rescue team moving', hint: 'The team follows the approved route to each person.' },
  complete: { label: 'Mission complete', hint: 'Everyone found has been reached. The report is ready.' },
};
export const COMMANDS = {
  start: 'Start the mission.',
  allStop: 'Stop every unit where it is.',
  resume: 'Resume after an all-stop.',
  setAutoplay: '{ on } Let the mission make the routine choices by itself.',
  investigate: '{ id } Send the rover for a closer second reading of a possible person.',
  dismiss: '{ id } Mark a possible person as dismissed by the operator.',
  finishAssess: 'Stop checking leads and move on to planning.',
  planRoute: '{ avoid?: { slope, mud, gas, collapse }, order?: [detection ids] } Plan the rescue route.',
  approveRoute: 'Approve the planned route. The rescue team starts moving.',
  rejectRoute: 'Throw the planned route away.',
  injectFault: '{ id } linkLoss | csiDropout | badWindow | thermalFail | lowBattery',
  clearFault: '{ id }',
  swapBattery: 'Swap the rover battery (after a low-battery return).',
  newHazard: '{ poly?, name?, block? } A new hazard appears (a second slide). Active routes are planned again.',
  setOperator: '{ name }',
};
export const FAULTS = {
  linkLoss: { label: 'Radio link lost', does: 'The rover holds position and keeps its readings until the link returns.' },
  csiDropout: { label: 'Wi-Fi packets dropping', does: 'Windows with too many missing packets are rejected and repeated; after two tries the stop continues on radar and thermal alone.' },
  badWindow: { label: 'Corrupt Wi-Fi window', does: 'The network refuses input that is not a number and the reading is skipped, never guessed.' },
  thermalFail: { label: 'Thermal camera offline', does: 'Fusion continues without thermal and says so on every affected reading.' },
  lowBattery: { label: 'Rover battery low', does: 'The rover finishes its current reading, returns to staging and waits for a battery swap.' },
};

// Which simulated Wi-Fi window is played at each stop in the scripted scenario. The category (moving, lying
// still, fan, empty) always comes from what is really near the rover; this table only fixes WHICH window of that
// category is used, so the demo is the same every time. Mission statistics with random windows are in monteCarlo().
const SCRIPTED = { S1: [8], S2: [0], S3: [24, 26], S4: [14, 15] };
const SCRIPTED_VANTAGE = [27, 25, 28];

export function createEngine({ nn, emit = () => {}, seed = SEED, windows = 'scripted', keep = {} } = {}) {
  const rng = mulberry32(seed);
  const srcOf = new Map(); // detection id -> what is really there. Private to the engine.
  let nDet = 0, nEv = 0, nSurv = 0, vantageN = 0;
  let extraHazards = [], avoid = { slope: true, mud: true, gas: true, collapse: true }, grid = buildGrid({ avoid });
  const regrid = () => { grid = buildGrid({ extraHazards, avoid }); };

  const S = {
    t: 0, running: false, speed: keep.speed ?? 8, autoplay: keep.autoplay ?? true, seed, windows,
    phase: 'standby', started: false, hold: false, assessDone: false,
    units: Object.fromEntries(UNITS.map((u) => [u.id, { id: u.id, kind: u.kind, name: u.name, built: u.built, pos: u.home.slice(), heading: Math.PI / 2, alt: 0, v: 0, mode: 'idle', battery: 1, link: 1, path: null, goal: null, trail: [u.home.slice()], odo: 0, stop: null }])),
    map: { scan: 0, swaths: [], explored: new Uint8Array(SITE.w * SITE.h), ready: false },
    sensors: { listen: null, csi: null, radar: { targets: [] }, micro: null, thermal: null, tof: null, at: null, stop: null },
    detections: [], survivors: {}, coverage: {}, hazards: [], routes: {}, events: [], faults: {}, queue: [],
    operator: keep.operator ?? 'Demo operator',
    stats: { windows: 0, nnMs: 0, replans: 0, distance: 0 },
  };
  for (const r of ROOMS) if (!r.corridor) S.coverage[r.id] = { room: r.id, status: 'unsearched', reach: 0, residual: PRIOR, note: 'Not searched yet.' };

  // ---------- small helpers ----------
  const rover = S.units['HOUND-01'], drone = S.units['DRONE-01'], team = S.units['TEAM-1'];
  function log(level, code, text, extra = {}) {
    const ev = { id: 'E' + ++nEv, t: S.t, level, code, text, ...extra };
    S.events.push(ev); emit('event', ev); return ev;
  }
  function setPhase(p) { const from = S.phase; if (from === p) return; S.phase = p; emit('phase', { from, to: p }); log('info', 'PHASE', PHASE_INFO[p].label + '. ' + PHASE_INFO[p].hint); }
  function plan(from, to, opts) { return planPath(grid, from, to, opts); }
  function markExplored(p, r = 5) {
    const x0 = Math.max(0, Math.floor(p[0] - r)), x1 = Math.min(SITE.w - 1, Math.ceil(p[0] + r)), y0 = Math.max(0, Math.floor(p[1] - r)), y1 = Math.min(SITE.h - 1, Math.ceil(p[1] + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x + 0.5 - p[0]) ** 2 + (y + 0.5 - p[1]) ** 2 <= r * r) S.map.explored[y * SITE.w + x] = 1;
  }
  function linkModel(u) { return Math.max(0.05, Math.min(1, 1 - dist(u.pos, SITE.staging) / 140 - 0.06 * wallsCrossed(u.pos, SITE.staging).length)); }
  const paused = () => S.hold || (S.faults.linkLoss && true);

  // ---------- coroutines (generators stepped once per DT) ----------
  function* wait(sec, { freeze = true } = {}) { let r = sec; while (r > 0) { const dt = yield; if (freeze && S.hold) continue; r -= dt; } }
  function* waitFor(pred) { while (!pred()) yield; }

  function* drive(u, goal, { nearest = false, label = '' } = {}) {
    const straight = () => ({ ok: true, reached: true, gap: 0, path: [u.pos.slice(), goal.slice()], length: dist(u.pos, goal) });
    let res = u.kind === 'drone' ? straight() : plan(u.pos, goal, { nearest });
    if (!res.ok) { log('warn', 'NO_PATH', `${u.name} cannot reach ${label || 'the target'}: ${res.reason}`, { unit: u.id }); return res; }
    u.goal = goal.slice(); u.path = res.path; u._replan = false;
    let d = 0; const speed = UNITS.find((x) => x.id === u.id).speed;
    u.mode = 'drive';
    while (d < res.length - 1e-6) {
      const dt = yield;
      if (S.hold || (u.kind === 'rover' && S.faults.linkLoss)) { u.v = 0; u.mode = S.hold ? 'hold' : 'fault'; continue; }
      if (u._replan) {
        u._replan = false;
        const again = u.kind === 'drone' ? straight() : plan(u.pos, goal, { nearest });
        if (again.ok) { res = again; u.path = again.path; d = 0; S.stats.replans++; log('warn', 'REPLANNED', `${u.name} planned a new way around the new hazard (${again.length.toFixed(1)} m left).`, { unit: u.id }); }
        else { log('alert', 'NO_PATH', `${u.name} has no safe way forward after the change and is holding.`, { unit: u.id }); u.mode = 'hold'; u.v = 0; u.path = null; return again; }
      }
      u.mode = 'drive'; u.v = speed;
      const stepLen = Math.min(speed * dt, res.length - d);
      d += stepLen; u.odo += stepLen; S.stats.distance += u.kind === 'rover' ? stepLen : 0;
      const at = pointAlong(res.path, d);
      u.pos = at.pos; u.heading = at.heading;
      if (dist(u.trail[u.trail.length - 1], u.pos) > 1) u.trail.push(u.pos.slice());
      if (u.kind === 'rover') { u.battery = Math.max(0, u.battery - stepLen * 0.0009); u.link = S.faults.linkLoss ? 0 : linkModel(u); markExplored(u.pos); }
    }
    u.v = 0; u.mode = 'idle'; u.path = null; u.goal = null;
    return res;
  }

  // ---------- sensing ----------
  function pickWindow(cat, list, n) {
    const pool = nn.byCat[cat] || [];
    if (windows === 'scripted' && list && list[n] != null && nn.samples[list[n]]?.cat === cat) return list[n];
    return pool[Math.floor(rng() * pool.length)];
  }
  function csiCategory(pos) {
    const inReach = (s) => dist(pos, s.pos) <= SENSORS.csi.range && wallsCrossed(pos, s.pos).length <= SENSORS.csi.maxWalls;
    const people = TRUTH.people.filter(inReach);
    const mover = people.find((p) => p.motion === 'moving');
    if (mover) return 'Person moving';
    if (people.length) return people[0].posture === 'lying' ? 'Person lying still' : 'Person standing still';
    if (TRUTH.decoys.some((x) => x.kind === 'fan' && inReach(x))) return 'Empty room + fan';
    return 'Empty room';
  }
  function readCsi(pos, list, n) {
    S.stats.windows++;
    if (S.faults.csiDropout) return { ok: false, reason: 'Wi-Fi window rejected: 41 % of packets missing (limit 35 %).' };
    const idx = pickWindow(csiCategory(pos), list, n);
    try {
      let x = nn.samples[idx].x;
      if (S.faults.badWindow) { x = x.map((r) => r.slice()); x[7][40] = NaN; }
      const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
      const out = nn.infer(x);
      const ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
      S.stats.nnMs += ms;
      return { ok: true, sample: idx, person: out.person, moving: out.moving, says: out.person > nn.threshold, threshold: nn.threshold, ms };
    } catch (e) {
      return { ok: false, reason: 'Wi-Fi window refused by the network: ' + e.message };
    }
  }

  function candidate(key, init) {
    for (const d of S.detections) if (srcOf.get(d.id) === key) return d;
    const d = { id: 'D' + ++nDet, t: S.t, updated: S.t, room: null, pos: null, posSigma: null, p: PRIOR, status: 'new', kind: 'unknown', evidence: [], steps: [], reason: '', by: [], stop: null, outdoor: false, needsTeam: false, dismissed: false, survivorId: null, windows: 0, ...init };
    srcOf.set(d.id, key); S.detections.push(d); return d;
  }
  function judge(d, unitId) {
    const f = fuse(d.evidence);
    const before = d.status;
    d.p = f.p; d.steps = f.steps; d.updated = S.t;
    if (unitId && !d.by.includes(unitId)) d.by.push(unitId);
    const cls = d.dismissed ? 'unlikely' : classify(f.p);
    const has = (s, r) => d.evidence.some((e) => e.sensor === s && e.result === r);
    if (cls === 'confirmed') { d.status = 'confirmed'; d.kind = 'person'; d.reason = 'Independent sensors agree.'; }
    else if (cls === 'possible') { d.status = 'possible'; d.kind = 'possible person'; d.reason = 'Some sensors point to a person, but not enough to be sure.'; }
    else {
      d.status = 'rejected';
      if (d.dismissed) { d.kind = 'dismissed'; d.reason = 'Dismissed by the operator.'; }
      else if (has('human', 'neg')) { d.kind = 'no one there'; d.reason = 'The rescue team looked and found no one.'; }
      else if (has('signature', 'machine')) { d.kind = 'machine'; d.reason = 'Steady, repeating motion with no body heat: most likely a machine such as a fan.'; }
      else if (has('temperature', 'tooHot')) { d.kind = 'hot object'; d.reason = 'Far hotter than a person, with no motion or breathing: most likely a hot pipe or machine.'; }
      else { d.kind = 'false alarm'; d.reason = 'One sensor raised an alarm that the others did not support.'; }
    }
    if (d.status !== before) {
      emit('detection', d);
      const where = d.room ? `in room ${d.room}` : d.outdoor ? 'outdoors, in the debris field' : 'at this stop';
      if (d.status === 'confirmed') {
        const csi = [...d.evidence].reverse().find((e) => e.sensor === 'csi' && e.result === 'pos');
        const radar = d.evidence.some((e) => e.sensor === 'radar' && e.result === 'pos');
        const sv = d.survivorId ? S.survivors[d.survivorId] : (S.survivors['V' + ++nSurv] = { id: 'V' + nSurv, detId: d.id, status: 'located', foundAt: S.t });
        d.survivorId = sv.id;
        Object.assign(sv, { pos: d.pos, posSigma: d.posSigma, room: d.room, outdoor: d.outdoor, p: d.p, motion: radar || (csi && csi.moving > 0.5) ? 'moving' : 'still', sensors: [...new Set(d.evidence.filter((e) => ['pos', 'faint'].includes(e.result)).map((e) => e.sensor))], breathing: null });
        emit('survivor', sv);
        log('alert', 'PERSON_FOUND', `Person found ${where}. Confidence ${(d.p * 100).toFixed(0)} %.`, { det: d.id, survivor: sv.id, pos: d.pos });
      } else if (d.status === 'possible') log('warn', 'POSSIBLE_PERSON', `Possible person ${where} (${(d.p * 100).toFixed(0)} %). Needs a second look.`, { det: d.id, pos: d.pos });
      else if (d.status === 'rejected') log('ok', 'LEAD_CLOSED', `Lead ${where} closed: ${d.reason}`, { det: d.id, pos: d.pos });
    }
    return d;
  }

  // One full reading at a place. key = stop id or vantage id; `list` fixes the scripted Wi-Fi windows.
  function takeReading(u, key, list, n, covers = []) {
    const pos = u.pos, csi = readCsi(pos, list, n);
    const near = (s, sensor) => dist(pos, s.pos) <= SENSORS[sensor].range && wallsCrossed(pos, s.pos).length <= SENSORS[sensor].maxWalls;
    const sources = [...TRUTH.people.filter((p) => !p.outdoors || dist(pos, p.pos) < 8), ...TRUTH.decoys];
    const noise = (s) => (rng() - 0.5) * 2 * s;
    const radarTargets = [], blobs = [];
    let microStill = false;
    const touched = [];
    for (const src of sources) {
      const d = dist(pos, src.pos), isPerson = !!src.motion, moving = src.motion === 'moving', view = sightline(pos, src.pos);
      const ev = [];
      const stamp = (e) => ({ t: S.t, vantage: key, unit: u.id, ...e });
      if (near(src, 'radar')) {
        if (moving || src.kind === 'fan') {
          const est = [src.pos[0] + noise(0.2), src.pos[1] + noise(0.2)];
          radarTargets.push({ pos: est, v: moving ? 0.3 + rng() * 0.5 : 0.1, kind: src.kind === 'fan' ? 'periodic' : 'moving' });
          ev.push(stamp({ sensor: 'radar', result: 'pos', note: `Moving target ${d.toFixed(1)} m away`, est }));
          if (src.kind === 'fan') ev.push(stamp({ sensor: 'signature', result: 'machine', note: 'The motion repeats steadily, like a machine' }));
        } else if (isPerson && near(src, 'micro')) ev.push(stamp({ sensor: 'radar', result: 'none', note: 'No moving target, as expected for someone lying still' }));
        else ev.push(stamp({ sensor: 'radar', result: 'neg', note: 'No moving target' }));
      }
      if (near(src, 'micro') && !moving) {
        if (isPerson) { microStill = true; ev.push(stamp({ sensor: 'micro', result: 'pos', note: `Small rhythmic motion in the ${(Math.round(d / 0.75) * 0.75).toFixed(2)} m range gate` })); }
        else ev.push(stamp({ sensor: 'micro', result: 'neg', note: 'No breathing-sized motion' }));
      }
      if (d <= SENSORS.thermal.range) {
        if (S.faults.thermalFail) ev.push(stamp({ sensor: 'thermal', result: 'blind', note: 'Thermal camera not responding' }));
        else if (view === 'blocked') ev.push(stamp({ sensor: 'thermal', result: 'blind', note: 'Thermal cannot see through the wall' }));
        else if (isPerson) {
          const tempC = view === 'clear' ? 31.5 + rng() * 2 : 24 + rng() * 1.5;
          blobs.push({ bearing: Math.atan2(src.pos[1] - pos[1], src.pos[0] - pos[0]), dist: d, tempC, strength: view === 'clear' ? 'clear' : 'faint' });
          ev.push(stamp({ sensor: 'thermal', result: view === 'clear' ? 'pos' : 'faint', note: view === 'clear' ? `Body-warm shape, ${tempC.toFixed(1)} °C` : `Faint warm edge behind furniture, ${tempC.toFixed(1)} °C` }));
        } else if (src.kind === 'heat') {
          blobs.push({ bearing: Math.atan2(src.pos[1] - pos[1], src.pos[0] - pos[0]), dist: d, tempC: 55, strength: 'clear' });
          ev.push(stamp({ sensor: 'thermal', result: 'pos', note: 'Hot spot, 55 °C' }));
          ev.push(stamp({ sensor: 'temperature', result: 'tooHot', note: '55 °C is far above skin temperature (28 to 37 °C)' }));
        } else ev.push(stamp({ sensor: 'thermal', result: 'neg', note: 'No warm shape' }));
      }
      const csiHere = near(src, 'csi');
      const informative = ev.some((e) => ['pos', 'faint'].includes(e.result)) || (csiHere && csi.ok && csi.says && isPerson);
      const existing = S.detections.find((x) => srcOf.get(x.id) === src.id);
      if (!informative && !existing) continue; // nothing pointed at this spot: no lead to open
      const det = candidate(src.id, { room: src.room || (roomAt(src.pos)?.id ?? null), stop: key, outdoor: !!src.outdoors });
      if (csiHere) {
        if (csi.ok) ev.unshift(stamp({ sensor: 'csi', result: csi.says ? 'pos' : 'neg', score: csi.person, moving: csi.moving, sample: csi.sample, note: `Network output ${csi.person.toFixed(2)} (alarm above ${csi.threshold.toFixed(2)})` }));
        else ev.unshift(stamp({ sensor: 'csi', result: 'blind', note: csi.reason }));
      }
      det.evidence.push(...ev); det.windows++;
      const radarEst = ev.find((e) => e.est);
      if (radarEst) { det.pos = radarEst.est; det.posSigma = 0.3; }
      else if (ev.some((e) => e.sensor === 'thermal' && ['pos', 'faint'].includes(e.result)) || ev.some((e) => e.sensor === 'micro' && e.result === 'pos')) { det.pos = [src.pos[0] + noise(0.4), src.pos[1] + noise(0.4)]; det.posSigma = view === 'clear' ? 0.4 : 1.0; }
      else if (!det.pos) { det.pos = src.room ? rectCenter(roomById(src.room).rect) : src.pos.slice(); det.posSigma = 3; }
      touched.push(judge(det, u.id));
    }
    // A Wi-Fi alarm that nothing else supports becomes its own lead, so the operator can see it was a false alarm.
    if (csi.ok && csi.says && !touched.some((d) => d.evidence.some((e) => e.sensor === 'csi' && e.t === S.t))) {
      const det = candidate('phantom-' + key, { room: covers[0] || roomAt(pos)?.id || null, stop: key, pos: pos.slice(), posSigma: SENSORS.csi.range });
      det.evidence.push({ t: S.t, vantage: key, unit: u.id, sensor: 'csi', result: 'pos', score: csi.person, moving: csi.moving, sample: csi.sample, note: `Network output ${csi.person.toFixed(2)} (alarm above ${csi.threshold.toFixed(2)})` },
        { t: S.t, vantage: key, unit: u.id, sensor: 'radar', result: 'neg', note: 'No moving target' }, { t: S.t, vantage: key, unit: u.id, sensor: 'micro', result: 'neg', note: 'No breathing-sized motion' });
      det.windows++; touched.push(judge(det, u.id));
    }
    S.sensors.csi = csi.ok ? { ...csi, t: S.t, stop: key } : { ok: false, reason: csi.reason, t: S.t, stop: key };
    S.sensors.radar = { targets: radarTargets, t: S.t };
    S.sensors.micro = { still: microStill, t: S.t };
    S.sensors.thermal = S.faults.thermalFail ? { ok: false, reason: 'Thermal camera not responding', t: S.t } : { ok: true, ambientC: 19.5, blobs, heading: u.heading, t: S.t };
    S.sensors.tof = { front: 0.6 + rng() * 2.4, rear: 0.5 + rng() * 2, t: S.t };
    S.sensors.at = S.t; S.sensors.stop = key;
    // Room coverage: how much of each room this stop could reach, and the chance a person there was missed.
    for (const id of covers) {
      const r = roomById(id); if (!r) continue;
      let inside = 0, total = 0;
      for (let y = r.rect[1] + 0.5; y < r.rect[3]; y++) for (let x = r.rect[0] + 0.5; x < r.rect[2]; x++) { total++; if (dist(pos, [x, y]) <= SENSORS.csi.range && wallsCrossed(pos, [x, y]).length <= SENSORS.csi.maxWalls) inside++; }
      const reach = total ? inside / total : 0;
      const lead = S.detections.find((d) => d.room === id && (d.status === 'possible' || d.status === 'confirmed'));
      const explained = touched.some((d) => d.status !== 'rejected' && d.room !== id && d.evidence.some((e) => e.sensor === 'csi' && e.result === 'pos' && e.t === S.t));
      const neg = [csi.ok && !explained ? { sensor: 'csi', result: csi.says ? 'pos' : 'neg' } : null, { sensor: 'radar', result: 'neg' }, { sensor: 'micro', result: 'neg' }].filter(Boolean);
      const pNeg = fuse(neg).p;
      const prev = S.coverage[id];
      const best = Math.max(prev?.reach || 0, reach);
      S.coverage[id] = lead
        ? { room: id, status: lead.status === 'confirmed' ? 'person' : 'lead', reach: best, residual: lead.p, note: lead.status === 'confirmed' ? 'A person was found here.' : 'A possible person is being checked.', stop: key, t: S.t }
        : { room: id, status: 'clear', reach: best, residual: best * pNeg + (1 - best) * PRIOR, note: csi.ok ? `Searched from ${key}. The sensors reached ${(best * 100).toFixed(0)} % of the room.` : `Searched from ${key} without Wi-Fi. Radar and thermal only.`, stop: key, t: S.t, noCsi: !csi.ok };
    }
    emit('reading', { key, unit: u.id, csi, detections: touched.map((d) => d.id) });
    return { csi, touched };
  }

  function* listenAt(u, key, list, covers, maxWindows = 2) {
    u.mode = 'listen'; u.stop = key;
    let n = 0, retries = 0;
    for (;;) {
      S.sensors.listen = { stop: key, window: n + 1, progress: 0, dur: SENSORS.csi.windowS };
      let r = SENSORS.csi.windowS;
      while (r > 0) { const dt = yield; if (S.hold || S.faults.linkLoss) { u.mode = S.hold ? 'hold' : 'fault'; continue; } u.mode = 'listen'; r -= dt; S.sensors.listen.progress = 1 - Math.max(0, r) / SENSORS.csi.windowS; }
      const { csi, touched } = takeReading(u, key, list, n, covers);
      if (!csi.ok) {
        if (retries < 2 && (S.faults.csiDropout || S.faults.badWindow)) { retries++; log('warn', 'WINDOW_REJECTED', `${csi.reason} Listening again (try ${retries + 1} of 3).`, { unit: u.id }); continue; }
        log('warn', 'CSI_UNAVAILABLE', `Wi-Fi reading unavailable at ${key}. Continuing with radar and thermal only; this room is marked as searched without Wi-Fi.`, { unit: u.id });
      }
      n++;
      if (n < maxWindows && touched.some((d) => d.status === 'possible')) { log('info', 'LISTEN_AGAIN', 'Possible person. Listening for one more 10-second window.', { unit: u.id }); continue; }
      break;
    }
    S.sensors.listen = null; u.mode = 'idle';
  }

  function* batteryGuard() {
    if (rover.battery > 0.15) return;
    log('alert', 'BATTERY_LOW', `HOUND-01 battery at ${(rover.battery * 100).toFixed(0)} %. Returning to staging for a swap; the search will continue afterwards.`, { unit: rover.id });
    const back = rover.pos.slice();
    yield* drive(rover, SITE.staging, { label: 'staging' });
    rover.mode = 'swap';
    let waited = 0;
    while (rover.battery <= 0.15) { const dt = yield; waited += dt; if (S.autoplay && waited > 4) doSwap(); }
    yield* drive(rover, back, { label: 'where it left off' });
  }
  function doSwap() { rover.battery = 1; S.faults.lowBattery = false; emit('fault', { id: 'lowBattery', on: false }); log('ok', 'BATTERY_SWAPPED', 'Battery swapped. HOUND-01 is going back to where it left off.', { unit: rover.id }); }

  function vantageFor(det) {
    const from = rover.pos; let best = null;
    for (const r of [1.8, 2.4, 3]) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, p = [det.pos[0] + Math.cos(a) * r, det.pos[1] + Math.sin(a) * r];
      if (p[0] < 1 || p[1] < 1 || p[0] > SITE.w - 1 || p[1] > SITE.h - 1) continue;
      const c = grid.toCell(p); if (grid.blocked[c[1] * grid.w + c[0]]) continue;
      if (sightline(p, det.pos) !== 'clear') continue; // judged from the estimated position, as the rover would
      const res = plan(from, p); if (!res.ok || !res.reached) continue;
      if (!best || res.length < best.res.length) best = { p, res };
    }
    return best;
  }
  function* investigate(det) {
    if (det.status !== 'possible') return;
    if (det.outdoor) { det.needsTeam = true; log('info', 'TEAM_CHECK', 'The lead outdoors is too far for the rover to check quickly. It is assigned to the rescue team for a ground check.', { det: det.id }); return; }
    const v = vantageFor(det);
    if (!v) { det.needsTeam = true; log('warn', 'NO_VANTAGE', `HOUND-01 cannot get a clear view of the lead in room ${det.room}. It is assigned to the rescue team.`, { det: det.id }); return; }
    log('info', 'INVESTIGATE', `HOUND-01 is moving for a clear view of the lead in room ${det.room}.`, { det: det.id });
    yield* drive(rover, v.p, { label: 'a better viewpoint' });
    const key = 'V' + ++vantageN;
    yield* listenAt(rover, key, [SCRIPTED_VANTAGE[(vantageN - 1) % SCRIPTED_VANTAGE.length]], [], 1);
    if (det.status === 'possible') { det.needsTeam = true; log('info', 'TEAM_CHECK', `Still not certain about room ${det.room}. Assigned to the rescue team to check in person.`, { det: det.id }); }
  }

  function planRescue(order) {
    const leads = S.detections.filter((d) => d.status === 'confirmed' || (d.status === 'possible' && d.needsTeam));
    if (!leads.length) return null;
    const rank = (d) => { const sv = d.survivorId && S.survivors[d.survivorId]; return d.status !== 'confirmed' ? 2 : sv?.motion === 'still' ? 0 : 1; };
    let list = [...leads].sort((a, b) => rank(a) - rank(b) || a.t - b.t);
    if (Array.isArray(order) && order.length) list = order.map((id) => leads.find((d) => d.id === id)).filter(Boolean).concat(list.filter((d) => !order.includes(d.id)));
    let cur = team.pos.slice(); const legs = []; const avoided = new Set();
    for (const d of list) {
      const res = plan(cur, d.pos, { nearest: true });
      if (!res.ok) { legs.push({ det: d.id, ok: false, reason: res.reason }); continue; }
      for (let k = 0; k <= 40; k++) { const p = [cur[0] + ((d.pos[0] - cur[0]) * k) / 40, cur[1] + ((d.pos[1] - cur[1]) * k) / 40]; for (const hz of [...HAZARDS, ...extraHazards]) if (pointInPoly(p, hz.poly) && !res.path.some((q) => pointInPoly(q, hz.poly))) avoided.add(hz.name); for (const o of OBSTACLES) if (o.kind === 'rubble' && !o.passable && pointInPoly(p, o.poly)) avoided.add(o.name); }
      const access = res.path[res.path.length - 1];
      legs.push({ det: d.id, survivor: d.survivorId, ok: true, path: res.path, length: res.length, reached: res.reached, gap: res.gap, access, kind: res.reached ? 'walk in' : 'break through' });
      cur = access.slice();
    }
    const good = legs.filter((l) => l.ok);
    const length = good.reduce((s, l) => s + l.length, 0);
    return { id: 'rescue', unit: team.id, legs, length, etaS: length / UNITS.find((u) => u.id === team.id).speed, avoided: [...avoided], status: 'planned', plannedAt: S.t, avoid: { ...avoid } };
  }

  function* droneSurvey() {
    drone.mode = 'takeoff';
    let up = 0; while (up < 3) { const dt = yield; if (S.hold) continue; up += dt; drone.alt = 30 * Math.min(1, up / 3); }
    const rows = [10, 30, 50, 70, 84], line = [];
    rows.forEach((y, i) => { const a = [4, y], b = [SITE.w - 4, y]; line.push(...(i % 2 ? [b, a] : [a, b])); });
    const full = [drone.pos.slice(), ...line], total = pathLength(full);
    let d = 0; drone.mode = 'scan'; drone.path = full; let seen = false;
    while (d < total) {
      const dt = yield; if (S.hold) { drone.v = 0; continue; }
      drone.v = 8; d = Math.min(total, d + 8 * dt);
      const at = pointAlong(full, d); drone.pos = at.pos; drone.heading = at.heading; drone.odo = d;
      if (dist(drone.trail[drone.trail.length - 1], drone.pos) > 4) drone.trail.push(drone.pos.slice());
      S.map.scan = d / total;
      const row = rows.find((y) => Math.abs(y - drone.pos[1]) < 0.5);
      if (row != null) { let sw = S.map.swaths.find((s) => s.y === row); if (!sw) S.map.swaths.push((sw = { y: row, x0: drone.pos[0], x1: drone.pos[0], half: 11 })); sw.x0 = Math.min(sw.x0, drone.pos[0]); sw.x1 = Math.max(sw.x1, drone.pos[0]); }
      const p3 = TRUTH.people.find((p) => p.outdoors);
      if (!seen && p3 && Math.abs(drone.pos[1] - p3.pos[1]) < 11 && Math.abs(drone.pos[0] - p3.pos[0]) < 1.2) {
        seen = true;
        const det = candidate(p3.id, { room: null, outdoor: true, stop: 'aerial', pos: [p3.pos[0] + (rng() - 0.5), p3.pos[1] + (rng() - 0.5)], posSigma: 1.5 });
        det.evidence.push({ t: S.t, vantage: 'aerial', unit: drone.id, sensor: 'aerial', result: 'pos', note: 'Person-shaped object in the drone image (simulated detection)' });
        judge(det, drone.id);
      }
    }
    S.map.ready = true; drone.path = null; drone.mode = 'return';
    log('ok', 'MAP_READY', 'Site map ready. The rover will use it to plan its way in.');
    yield* drive(drone, SITE.dronePad, { label: 'its pad' });
    let dn = 0; while (dn < 2) { const dt = yield; dn += dt; drone.alt = 30 * Math.max(0, 1 - dn / 2); }
    drone.mode = 'landed';
  }

  function* mission() {
    let idle = 0;
    while (!S.started) { const dt = yield; idle += dt; if (S.autoplay && idle > 1.5) S.started = true; }
    log('info', 'MISSION_START', `Exercise started by ${S.operator}. The people, damage and readings are simulated.`);
    setPhase('aerial'); yield* droneSurvey();
    setPhase('deploy'); yield* drive(rover, SITE.entrance, { label: 'the entrance' });
    log('info', 'AT_ENTRANCE', 'HOUND-01 is at the entrance.', { unit: rover.id });
    setPhase('search');
    for (const stop of STOPS) {
      yield* batteryGuard();
      const res = yield* drive(rover, stop.pos, { label: stop.label });
      if (!res.ok) { for (const id of stop.covers) S.coverage[id] = { room: id, status: 'blocked', reach: 0, residual: PRIOR, note: 'Could not be reached. Not searched.' }; continue; }
      log('info', 'LISTEN', `${stop.id}: ${stop.label}. Stopped. Listening for 10 seconds.`, { unit: rover.id, stop: stop.id });
      yield* listenAt(rover, stop.id, SCRIPTED[stop.id], stop.covers);
      for (const id of stop.covers) if (S.coverage[id].status === 'clear') log('ok', 'ROOM_CLEAR', `Room ${id}: no one detected. Chance someone was missed: ${(S.coverage[id].residual * 100).toFixed(0)} %.`, { room: id });
    }
    setPhase('assess');
    for (const r of ROOMS) if (!r.corridor && S.coverage[r.id].status === 'unsearched') { S.coverage[r.id] = { room: r.id, status: 'blocked', reach: 0, residual: PRIOR, note: 'The corridor to this room is blocked by debris. Not searched.' }; log('warn', 'ROOM_BLOCKED', `Room ${r.id} could not be searched: the corridor is blocked by debris.`, { room: r.id }); }
    idle = 0;
    for (;;) {
      const next = S.queue.shift();
      if (next) { const det = S.detections.find((d) => d.id === next.id); if (det) { yield* batteryGuard(); yield* investigate(det); } idle = 0; continue; }
      const open = S.detections.filter((d) => d.status === 'possible' && !d.needsTeam);
      if (S.assessDone || !open.length) break;
      const dt = yield; idle += dt;
      if (S.autoplay && idle > 2) { S.queue.push({ id: open[0].id }); }
    }
    setPhase('plan'); idle = 0;
    for (;;) {
      const r = S.routes.rescue;
      if (r && r.status === 'approved') break;
      const dt = yield; idle += dt;
      if (S.autoplay && !r && idle > 2) { doPlan(); idle = 0; }
      else if (S.autoplay && r && r.status === 'planned' && idle > 4) { r.status = 'approved'; r.approvedAt = S.t; r.approvedBy = 'autoplay'; emit('route', r); log('ok', 'ROUTE_APPROVED', 'Route approved (autoplay). The rescue team is moving.'); }
      if (!S.detections.some((d) => d.status === 'confirmed' || d.needsTeam) && idle > 3) { log('info', 'NO_ONE_FOUND', 'No one was found. The coverage map shows what was searched and what was not.'); setPhase('complete'); return; }
    }
    setPhase('rescue');
    for (const leg of S.routes.rescue.legs) {
      if (!leg.ok) continue;
      const det = S.detections.find((d) => d.id === leg.det);
      yield* drive(team, leg.access, { nearest: true, label: 'the next person' });
      leg.arrivedAt = S.t;
      if (det.status === 'possible') {
        const someone = TRUTH.people.some((p) => p.id === srcOf.get(det.id)); // what the team sees when it gets there
        det.evidence.push({ t: S.t, vantage: 'team', unit: team.id, sensor: 'human', result: someone ? 'pos' : 'neg', note: someone ? 'Confirmed in person by the rescue team (simulated)' : 'The rescue team looked and found no one (simulated)' });
        judge(det, team.id);
        if (!someone) { log('ok', 'TEAM_FOUND_NO_ONE', `Rescue team checked ${det.room ? 'room ' + det.room : 'the place'}: no one there.`, { det: det.id, pos: leg.access }); yield* wait(4); continue; }
      }
      const sv = det.survivorId && S.survivors[det.survivorId];
      if (sv) { sv.status = 'reached'; sv.reachedAt = S.t; emit('survivor', sv); }
      log('ok', 'TEAM_ARRIVED', leg.reached ? `Rescue team reached the person ${det.room ? 'in room ' + det.room : 'outdoors'}.` : `Rescue team is at the wall of room ${det.room}, ${leg.gap.toFixed(1)} m from the person, and is breaking through.`, { det: det.id, pos: leg.access });
      yield* wait(4);
    }
    S.routes.rescue.status = 'done'; emit('route', S.routes.rescue);
    const n = Object.keys(S.survivors).length;
    log('ok', 'MISSION_COMPLETE', `Mission complete. ${n} ${n === 1 ? 'person' : 'people'} located and reached in ${fmtClock(S.t)} of simulated time.`);
    setPhase('complete');
  }

  function doPlan(args = {}) {
    if (args.avoid) { avoid = { ...avoid, ...args.avoid }; regrid(); }
    const r = planRescue(args.order);
    if (!r) { log('warn', 'NOTHING_TO_PLAN', 'There is no one to plan a route to yet.'); return null; }
    S.routes.rescue = r; emit('route', r);
    const bad = r.legs.filter((l) => !l.ok);
    log(bad.length ? 'warn' : 'info', 'ROUTE_PLANNED', `Rescue route planned: ${r.length.toFixed(0)} m, about ${Math.max(1, Math.round(r.etaS / 60))} min on foot, ${r.legs.length - bad.length} stop${r.legs.length - bad.length === 1 ? '' : 's'}.${r.avoided.length ? ' Avoids: ' + r.avoided.join('; ') + '.' : ''}${bad.length ? ' ' + bad.length + ' target could not be reached.' : ''} Waiting for approval.`);
    return r;
  }

  // ---------- commands ----------
  const extraCommands = new Map();
  function command(name, args = {}) {
    switch (name) {
      case 'start': if (!S.started) S.started = true; return true;
      case 'allStop': if (!S.hold) { S.hold = true; log('alert', 'ALL_STOP', `All stop by ${S.operator}. Every unit is holding position.`); } return true;
      case 'resume': if (S.hold) { S.hold = false; log('ok', 'RESUMED', 'Resumed.'); } return true;
      case 'setAutoplay': S.autoplay = !!args.on; return true;
      case 'setOperator': S.operator = String(args.name || 'Demo operator').slice(0, 60); return true;
      case 'investigate': { const d = S.detections.find((x) => x.id === args.id); if (!d || d.status !== 'possible' || S.phase !== 'assess') return false; S.queue.push({ id: d.id }); return true; }
      case 'dismiss': { const d = S.detections.find((x) => x.id === args.id); if (!d || d.status !== 'possible') return false; d.dismissed = true; judge(d); return true; }
      case 'finishAssess': if (S.phase !== 'assess') return false; S.assessDone = true; return true;
      case 'planRoute': if (S.phase !== 'plan') return false; return !!doPlan(args);
      case 'approveRoute': { const r = S.routes.rescue; if (!r || r.status !== 'planned') return false; r.status = 'approved'; r.approvedAt = S.t; r.approvedBy = S.operator; emit('route', r); log('ok', 'ROUTE_APPROVED', `Route approved by ${S.operator}. The rescue team is moving.`); return true; }
      case 'rejectRoute': { const r = S.routes.rescue; if (!r || r.status !== 'planned') return false; delete S.routes.rescue; emit('route', null); log('info', 'ROUTE_REJECTED', 'Route thrown away. Plan again when ready.'); return true; }
      case 'injectFault': {
        if (!FAULTS[args.id]) return false;
        S.faults[args.id] = true; emit('fault', { id: args.id, on: true });
        if (args.id === 'lowBattery') rover.battery = Math.min(rover.battery, 0.14);
        if (args.id === 'linkLoss') rover.link = 0;
        log('alert', 'FAULT', `${FAULTS[args.id].label}. ${FAULTS[args.id].does}`, { fault: args.id });
        return true;
      }
      case 'clearFault': if (!S.faults[args.id]) return false; S.faults[args.id] = false; emit('fault', { id: args.id, on: false }); if (args.id === 'linkLoss') rover.link = linkModel(rover); log('ok', 'FAULT_CLEARED', `${FAULTS[args.id].label}: cleared.`, { fault: args.id }); return true;
      case 'swapBattery': if (rover.mode !== 'swap') return false; doSwap(); return true;
      case 'aftershock': case 'newHazard': {
        const poly = args.poly || [[58, 42], [62, 42], [62, 46], [58, 46]];
        const hz = { id: 'hz-new-' + (extraHazards.length + 1), kind: 'collapse', name: args.name || 'Second slide: new debris in the corridor', poly, block: args.block !== false, cost: 8, t: S.t };
        extraHazards.push(hz); S.hazards.push(hz); regrid();
        log('alert', 'NEW_HAZARD', `${hz.name}. Routes are being planned again.`, { hazard: hz.id });
        for (const u of Object.values(S.units)) if (u.path && u.kind !== 'drone') u._replan = true;
        const r = S.routes.rescue;
        if (r && r.status === 'planned') doPlan();
        return true;
      }
      default: { const h = extraCommands.get(name); return h ? h(args, api) : false; }
    }
  }

  const script = mission(); script.next();
  let finished = false;
  const plugins = [];
  function step() {
    S.t = Math.round((S.t + DT) * 1000) / 1000;
    if (!finished) { const r = script.next(DT); if (r.done) finished = true; }
    for (const p of plugins) p.step?.(DT, api);
  }
  const api = {
    state: S, step, command, log, plan: (a, b, o) => plan(a, b, o), get grid() { return grid; }, get done() { return finished; },
    // Extensions: add commands or per-step behaviour without editing this file.
    use(plugin) { plugins.push(plugin); if (plugin.commands) for (const [k, v] of Object.entries(plugin.commands)) extraCommands.set(k, v); plugin.init?.(api); },
    // For tests and the ground-truth debug view only.
    truthOf: (detId) => srcOf.get(detId) ?? null,
  };
  return api;
}

export function fmtClock(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }

// The live simulator used by the console. Wraps one engine with a clock, a command log and seeking.
export function createSim({ bus, nn }) {
  let engine, cmdLog = [], raf = 0, last = 0, acc = 0, quiet = false, opts = { seed: SEED, windows: 'scripted' }, autoplay0 = true;
  const plugins = [];
  const emit = (type, payload) => { if (!quiet) bus.emit(type, payload); };
  function build(keep) { engine = createEngine({ nn, emit, keep, ...opts }); for (const p of plugins) engine.use(p); return engine; }
  build({ autoplay: autoplay0 });
  function frame(ts) {
    const S = engine.state;
    if (!S.running) return;
    const real = Math.min(0.1, (ts - last) / 1000); last = ts; acc += real * S.speed;
    let n = 0; while (acc >= DT && n < 400) { engine.step(); acc -= DT; n++; }
    if (n >= 400) acc = 0;
    bus.emit('tick', S);
    raf = requestAnimationFrame(frame);
  }
  const sim = {
    get state() { return engine.state; },
    get grid() { return engine.grid; },
    get done() { return engine.done; },
    plan: (a, b, o) => engine.plan(a, b, o),
    play() { const S = engine.state; if (S.running) return; S.running = true; last = performance.now(); raf = requestAnimationFrame(frame); bus.emit('running', true); },
    pause() { const S = engine.state; if (!S.running) return; S.running = false; cancelAnimationFrame(raf); bus.emit('running', false); bus.emit('tick', S); },
    toggle() { engine.state.running ? this.pause() : this.play(); },
    setSpeed(x) { engine.state.speed = Math.max(0.5, Math.min(64, Number(x) || 1)); bus.emit('speed', engine.state.speed); },
    // The only way to change the mission. Returns true when the command was accepted.
    command(name, args = {}) {
      const ok = engine.command(name, args);
      if (ok) { cmdLog.push({ t: engine.state.t, name, args: structuredClone(args) }); bus.emit('command', { name, args }); bus.emit('tick', engine.state); }
      return ok;
    },
    // Start over. reset({ autoplay, seed, windows: 'scripted' | 'random' })
    reset(o = {}) {
      const S = engine.state, was = S.running; this.pause();
      if (o.seed != null) opts.seed = o.seed; if (o.windows) opts.windows = o.windows;
      autoplay0 = o.autoplay ?? S.autoplay; cmdLog = []; acc = 0;
      build({ speed: S.speed, autoplay: autoplay0, operator: S.operator });
      bus.emit('reset', engine.state); bus.emit('tick', engine.state); if (was) this.play();
    },
    // Jump to any time by replaying the mission from the start with the same commands. Deterministic.
    seek(t) {
      const S0 = engine.state, was = S0.running; this.pause();
      const log = cmdLog.slice().sort((a, b) => a.t - b.t); let i = 0;
      quiet = true;
      try {
        build({ speed: S0.speed, autoplay: autoplay0, operator: S0.operator });
        while (engine.state.t < t - 1e-9) { while (i < log.length && log[i].t <= engine.state.t + 1e-9) { engine.command(log[i].name, log[i].args); i++; } engine.step(); }
      } finally { quiet = false; }
      cmdLog = log.slice(0, i); acc = 0;
      bus.emit('seek', engine.state); bus.emit('tick', engine.state); if (was) this.play();
    },
    // Extensions: sim.use({ init(api), step(dt, api), commands: { name(args, api) { ... return true } } })
    use(plugin) { plugins.push(plugin); engine.use(plugin); },
    truthOf: (id) => engine.truthOf(id),
    get commandLog() { return cmdLog.slice(); },
    get options() { return { ...opts }; },
  };
  return sim;
}

// Run the whole mission many times with random Wi-Fi windows, to see how often each person is found or missed.
// For each person: confirmed (by the rover or drone sensors alone), flagged (left as "possible" and handed to the
// rescue team to check), or missed (never detected, or wrongly closed). Yields to the page between runs.
export async function monteCarlo({ nn, runs = 100, onProgress } = {}) {
  const people = {}, outcomes = []; let falseConfirmed = 0, wastedVisits = 0, time = 0;
  for (const p of TRUTH.people) people[p.id] = { confirmed: 0, flagged: 0, missed: 0 };
  for (let i = 0; i < runs; i++) {
    const e = createEngine({ nn, seed: 1000 + i * 7919, windows: 'random', keep: { autoplay: true } });
    let guard = 0; while (!e.done && guard++ < 40000) e.step();
    const o = { run: i, time: e.state.t, people: {}, falseConfirmed: 0 };
    for (const p of TRUTH.people) o.people[p.id] = 'missed';
    for (const d of e.state.detections) {
      const src = e.truthOf(d.id), isPerson = TRUTH.people.some((p) => p.id === src);
      const byTeam = d.evidence.some((x) => x.sensor === 'human');
      if (!isPerson) { if (d.status === 'confirmed') o.falseConfirmed++; if (byTeam) wastedVisits++; continue; } // a wasted visit: the team was sent and found no one
      if (d.status === 'confirmed' && !byTeam) o.people[src] = 'confirmed';
      else if (d.status === 'confirmed' || (d.status === 'possible' && d.needsTeam)) o.people[src] = 'flagged';
    }
    for (const [id, r] of Object.entries(o.people)) people[id][r]++;
    falseConfirmed += o.falseConfirmed; time += o.time; outcomes.push(o);
    if (i % 5 === 4) { onProgress?.((i + 1) / runs); await new Promise((r) => setTimeout(r, 0)); }
  }
  return { runs, people, falseConfirmed, wastedVisits, meanTime: time / runs, outcomes };
}
