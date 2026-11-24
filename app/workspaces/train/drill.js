// One drill: the real mission engine with autoplay off, driven by this loop. The clock fast-forwards while there
// is nothing to decide, stops while the trainee thinks, and runs at 1x while a fault is waiting for a response.
// Nothing here reads ground truth; that happens only in the debrief, after the last decision.
import { createPlan } from '../triage/plan.js';
import { createRun, runBaseline, score, routeMetrics, FAULT_QUIZ, ALL_AVOID, AVOID_LABELS, clock, TEAM_SPEED } from './scenario.js';
import { FAULTS, PHASE_INFO, DT } from '../../core/sim.js';
import { THRESHOLDS } from '../../core/fusion.js';
import { ROOMS, SENSORS, roomAt } from '../../core/world.js';
import { openDebrief } from './debrief.js';

const SENSOR = { csi: 'Wi-Fi', radar: 'Radar', micro: 'Micro-motion', thermal: 'Thermal', signature: 'Pattern', temperature: 'Temperature', aerial: 'Drone image', human: 'Team' };
const RESULT = { pos: 'yes', neg: 'no', faint: 'faint', blind: 'cannot see', none: 'nothing', machine: 'machine-like', tooHot: 'too hot' };
const STEPS = [['aerial', 'Survey'], ['deploy', 'Drive in'], ['search', 'Search'], ['assess', 'Check leads'], ['plan', 'Plan and approve'], ['hand', 'Hand over']];
const COACH = {
  running: { aerial: 'The drone goes first so the rover has a map. Anything it flags in the open arrives as a lead with a low number: one sensor, one look.', deploy: 'Nothing to decide while the rover drives. Use the time to read the hazards on the map.', search: 'Each stop is a 10 second window. Watch the leads list: a line appears the moment a sensor points somewhere, with every reading behind it.', assess: 'The rover is taking a second look from a place with a clear view. A new vantage counts as fresh evidence; listening twice from the same spot does not.' },
  leads: 'Look at what is behind each number. A Wi-Fi “no” barely lowers it, because the network misses most still people. Micro-motion or a faint warm edge is worth a second look. The rover costs about a minute per lead; a dismissed person costs everything.',
  plan: 'Before you approve: which hazards is the planner avoiding, and how many metres of the route are inside one? The length will not tell you.',
  hand: 'The hatched rooms on the map were never reached. The team has to search those by hand, and they only know if you say so.',
};

export function openDrill(host, ctx, { level, seed, visible, onExit, onScore, onAgain, onNext, onLesson }) {
  const { h, icon, realityTag, reducedMotion } = ctx.kit;
  const run = createRun({ nn: ctx.nn, level, seed });
  const S = run.state;
  const mainWasRunning = ctx.sim.state.running; ctx.sim.pause(); // the main mission waits, so its alerts do not interrupt the drill
  let speed = 24, paused = false, acc = 0, last = performance.now(), raf = 0, settle = 0, lastSig = '', finished = false, destroyed = false, debrief = null;
  let avoid = { ...ALL_AVOID }, view = 'site', viewTouched = false, flash = null, lastLeadSig = '', lastLogN = -1, faultFeedback = {};
  const hand = new Set();

  // ---------- skeleton ----------
  const clockEl = h('b.num.train-clock', { title: 'Mission time in this drill (simulated)' }, '00:00');
  const speedSeg = h('div.seg', { role: 'group', 'aria-label': 'Drill speed between decisions' },
    h('button', { 'aria-pressed': 'false', 'aria-label': 'Pause the drill', onclick: () => setSpeed(0) }, icon('pause', 14)),
    ...[8, 24, 60].map((x) => h('button', { 'aria-pressed': String(x === speed), onclick: () => setSpeed(x) }, x + '×')));
  const steps = h('ol.train-steps', { 'aria-label': 'Where the drill is' }, ...STEPS.map(([, label]) => h('li', null, label)));
  const bar = h('div.train-bar', null,
    h('button.btn.btn-ghost', { onclick: quit }, icon('arrow-left', 14), 'Leave drill'),
    h('h2', null, 'Level ' + level.id + ': ' + level.name), h('span.train-meta.num', null, 'scenario ' + seed), steps, h('div.grow'),
    h('span.train-clockwrap', null, h('span', null, 'drill clock'), clockEl), speedSeg);
  const canvas = h('canvas.train-canvas', { role: 'img', 'aria-label': 'Plan of the site: the rover, the drone, each lead with its probability, searched and unsearched rooms, hazards and the planned route' });
  const viewSeg = h('div.seg', { role: 'group', 'aria-label': 'Map view' }, ...[['site', 'Whole site'], ['building', 'Building']].map(([id, label]) => h('button', { 'data-v': id, 'aria-pressed': String(id === view), onclick: () => { viewTouched = true; setView(id); } }, label)));
  const speedNote = h('span.train-speednote');
  const stage = h('div.train-stage', null, canvas,
    h('div.train-stagetop', null, viewSeg, speedNote, h('div.grow'), realityTag('sim')),
    h('div.legend.train-legend', null, h('span', null, h('i.dot', { style: '--c:var(--person)' }), 'Person found'), h('span', null, h('i.hollow.train-lgdia', { style: '--c:var(--warn)' }), 'Possible'), h('span', null, h('i.train-lgx'), 'Closed lead'), h('span', null, h('i.line'), 'Route'), h('span', null, h('i.line', { style: '--c:var(--danger)' }), 'Route inside a hazard'), h('span', null, h('i.train-lghatch'), 'Not searched')));
  const now = h('section.train-now', { 'aria-live': 'polite', 'aria-label': 'What to do now' });
  const leadsEl = h('div.train-leadlist');
  const logEl = h('ol.train-log', { 'aria-label': 'Drill log, newest first' });
  const consoleEl = h('aside.train-console', null, now,
    h('section.train-leads', { 'aria-label': 'Leads' }, h('h3', null, 'Leads', h('span.train-meta', null, 'what the sensors say, nothing more')), leadsEl),
    h('section.train-logwrap', { 'aria-label': 'Log' }, h('h3', null, 'Log'), logEl));
  const grid = h('div.train-drillgrid', null, stage, consoleEl);
  host.append(bar, grid);

  const plan = createPlan(canvas, { scene, view, onPick: (id, m, w) => { if (run.awaiting()?.type === 'handover' && w) { const r = roomAt(w); if (r && !r.corridor) toggleRoom(r.id); } } });
  function setView(v) { view = v; plan.setView(v); for (const b of viewSeg.children) b.setAttribute('aria-pressed', String(b.dataset.v === v)); }
  function setSpeed(x) { paused = x === 0; if (x) speed = x; [...speedSeg.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === 0 ? paused : !paused && [8, 24, 60][i - 1] === speed))); }

  // ---------- the map ----------
  function scene() {
    const r = S.units['HOUND-01'], d = S.units['DRONE-01'], t = S.units['TEAM-1'], need = run.awaiting();
    const units = [{ pos: t.pos, kind: 'team', label: 'Rescue team' }];
    if (d.alt > 0.5 || d.mode === 'scan') units.push({ pos: d.pos, heading: d.heading, kind: 'drone', label: 'Scout drone', trail: d.trail });
    units.push({ pos: r.pos, heading: r.heading, kind: 'rover', label: 'HOUND-01', trail: r.trail, ring: S.sensors.listen ? SENSORS.csi.range : 0, listen: S.sensors.listen ? S.sensors.listen.progress : null });
    const markers = S.detections.map((x) => ({ id: x.id, pos: x.pos, sigma: x.status === 'rejected' ? 0 : Math.min(x.posSigma || 0, 3.2), kind: x.status === 'confirmed' ? 'person' : x.status === 'possible' ? 'possible' : 'rejected', label: (x.room ? x.room : 'outdoors') + '  ' + (x.p * 100).toFixed(0) + ' %', pulse: x.status === 'possible' && !x.needsTeam }));
    const routes = [];
    if (r.path) routes.push({ path: [r.pos, ...r.path.slice(1)], tone: 'ghost', width: 1.5, dash: [3, 4], arrows: false });
    const m = routeMetrics(S);
    if (m) for (const leg of m.legs) if (leg.ok) routes.push({ path: leg.path, tone: 'main', width: 2.5, end: true, spans: leg.exposure.spans, dash: m.status === 'planned' ? [10, 6] : null, march: true });
    const marks = {}; if (need?.type === 'handover') for (const id of hand) marks[id] = true;
    return { units, markers, routes, hazards: S.hazards, coverage: S.coverage, showResidual: true, swaths: S.phase === 'aerial' || S.phase === 'deploy' ? S.map.swaths : null, avoid: need?.type === 'plan' ? (S.routes.rescue?.avoid || avoid) : null, roomMarks: marks };
  }

  // ---------- helpers for the decision card ----------
  const where = (d) => (d.outdoor ? 'Debris field, outdoors' : d.room ? 'Room ' + d.room : 'Inside building B');
  const latest = (d) => { const m = new Map(); for (const e of d.evidence) m.set(e.sensor, e); return [...m.values()]; };
  const chips = (d) => h('span.train-chips', null, ...latest(d).map((e) => h('span.train-chip', { 'data-r': ['pos', 'faint'].includes(e.result) ? 'yes' : ['machine', 'tooHot'].includes(e.result) ? 'veto' : e.result === 'neg' ? 'no' : 'na', title: e.note }, h('i', null, SENSOR[e.sensor] || e.sensor), RESULT[e.result] || e.result)));
  const pbar = (p) => h('span.train-p', { role: 'img', 'aria-label': (p * 100).toFixed(0) + ' percent. Possible from ' + THRESHOLDS.possible * 100 + ', confirmed from ' + THRESHOLDS.confirmed * 100 + '.', style: '--v:' + p.toFixed(3) + ';--a:' + THRESHOLDS.possible + ';--b:' + THRESHOLDS.confirmed }, h('i'));
  const coach = (text) => (level.coach && text ? h('p.train-coach', null, h('b', null, 'Coach'), text) : null);
  const say = (text, tone) => { flash = { text, tone: tone || 'info', at: S.t }; };
  function act(fn) { fn(); settle = 4; lastSig = ''; }

  function renderNow(need) {
    const kids = [];
    const head = (title, tag) => h('div.train-nowhead', null, h('h2', null, title), tag || null);
    if (need?.type === 'start') {
      kids.push(head('Brief'),
        h('p', null, 'Building B, a school block in the exercise area. One storey. The east end of the corridor is under debris. Nobody knows how many people are inside.'),
        h('ul.train-brief', null, ...level.facts.map((f) => h('li', null, f)), h('li', null, 'You decide which leads to check, when to stop, which route to approve and what to do when something fails.')),
        h('p.train-fine', null, 'The clock fast-forwards between decisions and stops while you think. Only a fault is timed. The main mission is paused while you drill.'),
        h('button.btn.btn-primary.btn-lg', { onclick: () => act(() => { run.start(); say('The drone is taking off.'); }) }, icon('play'), 'Start the search'));
    } else if (need?.type === 'fault') {
      const f = need.fault, quiz = FAULT_QUIZ[f.id], fb = faultFeedback[f.id] || {};
      kids.push(head(FAULTS[f.id].label, h('span.tag.tag-danger', null, 'Fault')),
        h('p.train-timer', null, 'The clock is running at 1×. Waiting ', h('b.num', { id: 'train-faultt' }, '0 s'), ' for your response.'),
        h('p.train-ask', null, quiz.ask),
        h('div.train-options', { role: 'group', 'aria-label': 'Possible responses' }, ...quiz.options.map((o, i) => h('button.train-option', { disabled: !!fb[i], 'data-wrong': String(!!fb[i]), onclick: () => {
          if (o.right) { run.answerFault(f.id, true); say(o.why, 'ok'); settle = 2; lastSig = ''; }
          else { run.answerFault(f.id, false); faultFeedback[f.id] = { ...fb, [i]: true }; say(o.why, 'bad'); lastSig = ''; }
        } }, h('span.train-optkey', null, 'ABC'[i]), h('span', null, o.text)))));
    } else if (need?.type === 'leads') {
      kids.push(head('Check the leads'),
        h('p', null, need.open.length === 1 ? 'One lead is still open.' : need.open.length + ' leads are still open.', ' The rover can take a second look from a clear viewpoint, or you can close a lead yourself. The planner only routes to confirmed people and to leads handed to the team.'),
        coach(COACH.leads),
        h('div.train-openleads', null, ...need.open.map((d) => h('div.train-open', null,
          h('div.train-openhead', null, h('b', null, where(d)), h('span.num', null, (d.p * 100).toFixed(0) + ' %'), pbar(d.p)),
          chips(d),
          h('div.row', null,
            h('button.btn', { onclick: () => act(() => { run.leadAction(d.id, 'look'); say(d.outdoor ? 'Too far for the rover. The lead outdoors goes to the rescue team for a ground check.' : 'HOUND-01 is moving for a clear view of ' + where(d).toLowerCase() + '.'); }) }, icon(d.outdoor ? 'team' : 'eye', 14), d.outdoor ? 'Hand to the rescue team' : 'Second look'),
            h('button.btn.btn-ghost', { onclick: () => act(() => { run.leadAction(d.id, 'dismiss'); say('You dismissed the lead at ' + where(d).toLowerCase() + '. It is closed under your name.'); }) }, icon('close', 14), 'Dismiss'))))),
        h('div.train-nowfoot', null, h('button.btn', { onclick: () => act(() => { run.finishAssess(); say('Checking stopped with ' + need.open.length + (need.open.length === 1 ? ' lead' : ' leads') + ' still open. Open leads are not routed.'); }) }, 'Stop checking and plan'),
          h('span.train-fine', null, 'Open leads left behind will not be on the route.')));
    } else if (need?.type === 'plan' && !need.route) {
      const who = S.detections.filter((d) => d.status === 'confirmed' || d.needsTeam);
      kids.push(head('Plan the rescue route'),
        h('p', null, 'The team will be routed to ' + who.length + (who.length === 1 ? ' place: ' : ' places: ') + who.map((d) => where(d).toLowerCase() + (d.status === 'confirmed' ? '' : ' (to check)')).join('; ') + '. Tell the planner what to keep away from.'),
        coach(COACH.plan),
        h('div.train-avoid', { role: 'group', 'aria-label': 'Hazards the planner avoids' }, ...Object.keys(AVOID_LABELS).map((k) => h('label.check', null, h('input', { type: 'checkbox', checked: avoid[k], onchange: (e) => { avoid[k] = e.target.checked; plan.draw(); } }), h('span', null, 'Avoid: ' + AVOID_LABELS[k].toLowerCase())))),
        h('button.btn.btn-primary.btn-lg', { onclick: () => act(() => { if (run.plan(avoid)) say('Route planned. It waits for your approval.'); }) }, icon('route'), 'Plan route'));
    } else if (need?.type === 'plan') {
      const m = routeMetrics(S), prop = run.rec.proposals.at(-1), slide = run.rec.slideAt != null && prop?.source === 'replanned after the slide';
      kids.push(head('Route waiting for approval'),
        slide ? h('p.note.danger', null, icon('alert'), h('span', null, h('b', null, 'Second slide at ' + clock(run.rec.slideAt) + '.'), ' Fresh debris on the approach. The route was planned again; this is the new one.')) : null,
        h('p.train-source', null, prop?.source === 'left by the last shift' ? 'This plan was already on the console when you sat down, made with the settings the last shift left.' : prop?.source === 'your plan' ? 'Planned with your settings.' : 'Planned again automatically, with the same settings.'),
        h('div.train-settings', { 'aria-label': 'Planner settings for this route' }, ...Object.keys(AVOID_LABELS).map((k) => h('span', { 'data-on': String(m.avoid[k] !== false) }, AVOID_LABELS[k], h('b', null, m.avoid[k] !== false ? 'avoided' : 'not avoided')))),
        h('div.train-routestats', null,
          h('div.stat.sm', null, h('b', null, m.length.toFixed(0) + ' m'), h('span', null, 'on foot')),
          h('div.stat.sm', null, h('b', null, Math.max(1, Math.round(m.length / TEAM_SPEED / 60)) + ' min'), h('span', null, 'walking')),
          h('div.stat.sm', null, h('b', null, m.exposure.toFixed(1) + ' m'), h('span', null, 'inside hazards'))),
        h('table.table.dense.train-legs', null, h('thead', null, h('tr', null, h('th', null, 'Stop'), h('th', null, 'Way in'), h('th.num', null, 'Walk'), h('th.num', null, 'In hazards'))),
          h('tbody', null, ...m.legs.map((l, i) => { const d = S.detections.find((x) => x.id === l.det); return l.ok ? h('tr', null, h('td', null, (i + 1) + '. ' + where(d)), h('td', null, l.kind === 'walk in' ? 'walk in' : 'break through, ' + l.gap.toFixed(1) + ' m short'), h('td.num.nw', null, l.length.toFixed(0) + ' m'), h('td.num.nw', { title: l.exposure.by.map((x) => x.hz.name + ' ' + x.m.toFixed(1) + ' m').join('; ') }, l.exposure.total.toFixed(1) + ' m')) : h('tr', null, h('td', null, where(d)), h('td', { colSpan: 3 }, 'no way found')); }))),
        m.by.length ? h('p.train-fine', null, 'Inside: ' + m.by.map((x) => x.hz.name.replace(' (concept sensor)', '') + ' ' + x.m.toFixed(1) + ' m').join('; ') + '.') : null,
        coach(COACH.plan),
        h('div.row', null,
          h('button.btn.btn-primary.btn-lg', { onclick: () => act(() => { if (run.approve()) { say('Route approved under your name at ' + clock(S.t) + '. The team is moving.', 'ok'); avoid = { ...ALL_AVOID }; } }) }, icon('check'), 'Approve route'),
          h('button.btn.btn-lg', { onclick: () => act(() => { const keep = { ...ALL_AVOID, ...m.avoid }; if (run.reject()) { avoid = keep; say('Route thrown away. Set the planner and plan again.'); } }) }, 'Reject and plan again')));
    } else if (need?.type === 'handover') {
      const routed = !!run.rec.approvedAt;
      kids.push(head('Hand-over'),
        h('p', null, routed ? 'Route approved at ' + clock(run.rec.approvedAt) + '. The team is on its way. ' : 'The search ended with no one to route to. ', 'One decision is left. Which rooms do you report as ', h('b', null, 'not searched by the sensors'), ', or searched without Wi-Fi? The team will search those by hand.'),
        coach(COACH.hand),
        h('div.train-rooms', { role: 'group', 'aria-label': 'Rooms to report as not searched' }, ...['109', '110', '111', '112', '101', '102', '103', '104'].map((id) => h('button.train-room', { 'aria-pressed': String(hand.has(id)), 'data-id': id, onclick: () => toggleRoom(id) }, h('b.num', null, id), h('span', null, ROOMS.find((r) => r.id === id).name.replace(/ \d+$/, ''))))),
        h('p.train-fine', null, 'Laid out like the building: north rooms on top. You can also click rooms on the map.'),
        h('button.btn.btn-primary.btn-lg', { onclick: finish }, 'Finish and see the debrief', icon('arrow-right')));
    } else {
      const r = S.units['HOUND-01'], l = S.sensors.listen;
      const detail = S.faults.linkLoss ? 'HOUND-01 is holding: no radio link.' : l ? 'HOUND-01 is listening at ' + l.stop + ', window ' + l.window + '.' : r.mode === 'swap' ? 'HOUND-01 is at staging, waiting for a battery.' : S.phase === 'aerial' ? 'The drone has mapped ' + (S.map.scan * 100).toFixed(0) + ' % of the site.' : r.mode === 'drive' ? 'HOUND-01 is driving.' : '';
      kids.push(head(PHASE_INFO[S.phase].label, h('span.status.accent.live', null, paused ? 'Paused' : 'Fast-forward ' + speed + '×')),
        h('p', null, PHASE_INFO[S.phase].hint), h('p.train-detail', { id: 'train-detail' }, detail),
        coach(COACH.running[S.phase]),
        h('p.train-fine', null, 'Nothing to decide yet. The drill stops by itself at the next decision.'));
    }
    if (flash && S.t - flash.at > 90 && need?.type !== 'fault') flash = null;
    if (flash) kids.push(h('p.train-flash', { 'data-tone': flash.tone }, icon(flash.tone === 'ok' ? 'check' : flash.tone === 'bad' ? 'close' : 'info', 14), h('span', null, flash.text)));
    now.dataset.type = need?.type || 'running';
    now.replaceChildren(...kids.filter(Boolean));
    if (need?.type === 'plan' || need?.type === 'handover') plan.draw();
  }
  function toggleRoom(id) { hand.has(id) ? hand.delete(id) : hand.add(id); for (const b of now.querySelectorAll('.train-room')) b.setAttribute('aria-pressed', String(hand.has(b.dataset.id))); plan.draw(); }

  function renderLeads() {
    const sig = S.detections.map((d) => d.id + d.status + d.p.toFixed(2) + d.evidence.length + d.needsTeam).join('|');
    if (sig === lastLeadSig) return; lastLeadSig = sig;
    if (!S.detections.length) { leadsEl.replaceChildren(h('p.train-none', null, 'No leads yet. One appears as soon as any sensor points somewhere.')); return; }
    leadsEl.replaceChildren(...[...S.detections].sort((a, b) => b.updated - a.updated).map((d) => h('div.train-lead', { 'data-s': d.status },
      h('div.train-leadhead', null, h('span.train-glyph', { 'aria-hidden': 'true' }), h('b', null, where(d)), h('span.train-leadstate', null, d.status === 'confirmed' ? 'Person found' : d.status === 'possible' ? (d.needsTeam ? 'Possible · with the team' : 'Possible') : d.dismissed ? 'Dismissed by you' : 'Closed: ' + d.kind), h('span.num', null, (d.p * 100).toFixed(0) + ' %')),
      pbar(d.p), chips(d))));
  }
  function renderLog() {
    if (S.events.length === lastLogN) return; lastLogN = S.events.length;
    logEl.replaceChildren(...S.events.slice(-40).reverse().map((e) => h('li', { 'data-l': e.level }, h('span.num', null, clock(e.t)), h('span', null, e.text.replace('Demo operator', 'the trainee')))));
  }
  function renderChrome(need) {
    clockEl.textContent = clock(S.t);
    const idx = need?.type === 'handover' ? 5 : Math.max(0, STEPS.findIndex(([p]) => p === S.phase));
    [...steps.children].forEach((li, i) => { li.dataset.s = !S.started ? 'todo' : i < idx ? 'done' : i === idx ? 'now' : 'todo'; });
    const timed = need?.type === 'fault', stopped = need && !timed && settle <= 0 && !run.slidePending;
    speedNote.textContent = !S.started ? '' : timed ? 'Clock at 1× until the fault is handled' : stopped ? 'Clock stopped while you decide' : paused ? 'Paused' : 'Fast-forward ' + speed + '×';
    speedNote.dataset.s = timed ? 'timed' : stopped ? 'stopped' : 'run';
    const ft = document.getElementById('train-faultt'); if (ft && timed) ft.textContent = (S.t - need.fault.tInject).toFixed(0) + ' s';
    if (!viewTouched && view === 'site' && (S.phase === 'search' || S.phase === 'assess')) setView('building');
  }

  // ---------- the loop ----------
  function frame(ts) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const real = Math.min(0.1, (ts - last) / 1000); last = ts;
    if (finished || !visible()) return;
    let need = run.awaiting();
    if (need?.type === 'plan' && !need.route && level.preset && !run.rec.presetShown) { run.proposePreset(); need = run.awaiting(); }
    const timed = need?.type === 'fault', stopped = need && !timed && settle <= 0 && !run.slidePending;
    if (!stopped && !paused && S.started) {
      acc += real * (timed ? 1 : speed); let n = 0; const type0 = need?.type || '';
      while (acc >= DT && n < 400) { run.step(); acc -= DT; n++; settle--; const a = run.awaiting(); if ((a?.type || '') !== type0 && settle <= 0) { acc = 0; break; } }
      need = run.awaiting();
    }
    const r = S.routes.rescue;
    const sig = (need?.type || 'run') + '|' + S.phase + '|' + (need?.fault?.id || '') + '|' + (need?.open ? need.open.map((d) => d.id).join() : '') + '|' + (r ? r.plannedAt + r.status : '') + '|' + (flash ? flash.at + flash.text.length : '') + '|' + paused + speed + '|' + (need ? '' : (S.sensors.listen ? S.sensors.listen.stop + S.sensors.listen.window : S.units['HOUND-01'].mode));
    if (sig !== lastSig) { lastSig = sig; renderNow(need); }
    else if (!need && S.phase === 'aerial') { const dEl = document.getElementById('train-detail'); if (dEl) dEl.textContent = 'The drone has mapped ' + (S.map.scan * 100).toFixed(0) + ' % of the site.'; }
    renderChrome(need); renderLeads(); renderLog();
    if (!stopped || !reducedMotion()) plan.draw();
  }

  async function finish() {
    if (finished) return; finished = true; run.setHandover(hand);
    const prog = h('div.bar.lg', null, h('i', { style: { width: '2%' } }));
    now.replaceChildren(h('div.train-nowhead', null, h('h2', null, 'Preparing the debrief')), h('p', null, 'Replaying this exact scenario with the autoplay policy, so your choices can be set beside it.'), prog);
    let base;
    try { base = await runBaseline({ nn: ctx.nn, level, seed, onProgress: (p) => { prog.firstChild.style.width = Math.round(p * 100) + '%'; } }); }
    catch (e) { console.error(e); now.replaceChildren(h('p.note.danger', null, icon('alert'), h('span', null, 'The comparison run failed: ' + (e.message || e) + '. Your drill is not lost; try the debrief again.')), h('button.btn', { onclick: () => { finished = false; finish(); } }, 'Try again')); finished = false; return; }
    if (destroyed) return;
    const res = score(run, base);
    onScore({ total: res.total, seed, clock: clock(res.outcome.time) });
    cancelAnimationFrame(raf); plan.destroy(); host.replaceChildren();
    debrief = openDebrief(host, ctx, { run, base, res, level, seed, onExit: leave, onAgain: () => { leave(false); onAgain(seed); }, onNew: () => { leave(false); onAgain(); }, onNext: () => { leave(false); onNext(); }, onLesson: (id) => { leave(false); onLesson(id); } });
  }
  function restoreMain() { if (mainWasRunning && !ctx.sim.state.running) ctx.sim.play(); }
  function leave(goHome = true) { restoreMain(); if (goHome) onExit(); }
  async function quit() {
    if (S.started && !finished && !(await ctx.shell.confirm({ title: 'Leave this drill?', body: 'The run will not be scored.', confirmLabel: 'Leave drill', danger: true }))) return;
    leave();
  }

  renderNow(run.awaiting()); renderLeads(); renderLog(); renderChrome(run.awaiting());
  raf = requestAnimationFrame(frame);
  return {
    destroy() { destroyed = true; cancelAnimationFrame(raf); try { plan.destroy(); } catch { /* already gone */ } debrief?.destroy?.(); restoreMain(); },
    pause() {}, resume() { last = performance.now(); },
  };
}
