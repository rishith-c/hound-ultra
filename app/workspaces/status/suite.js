// HOUND Command's self-tests. Pure logic, no DOM: the same file runs in a worker behind the System check workspace,
// and at tests/index.html on its own.
//
//   SUITE    the tests, in running order: { id, group, area, title, expect, run(t) }
//   run(t)   does the work and returns one plain sentence saying what happened. t.check(ok, what, detail) records one
//            check; t.limit(what, detail) records a known limit: something measured that has no pass mark (the network
//            missing a still person, a team visit that finds no one). A limit is shown in amber, never
//            hidden and never counted as a pass.
// A test passes when it made at least one check and none failed. Ground truth is read here on purpose: this is a test.
import { createEngine, createSim, DT } from '../../core/sim.js';
import { createBus } from '../../core/bus.js';
import { planPath } from '../../core/planner.js';
import { fuse, classify, THRESHOLDS, PRIOR } from '../../core/fusion.js';
import { buildGrid, SITE, STOPS, WALLS, OBSTACLES, HAZARDS, TRUTH, ROOMS } from '../../core/world.js';
import { mulberry32, dist, pathLength, segIntersect, pointInPoly, distToSeg } from '../../core/geometry.js';

export const GROUPS = [
  { id: 'ordinary', title: 'Ordinary cases', line: 'The whole job, done the way it is meant to be done.' },
  { id: 'repeated', title: 'Repeated cases', line: 'The same question, asked again, gets the same answer.' },
  { id: 'demanding', title: 'Demanding cases', line: 'Long routes, random missions, hundreds of runs.' },
  { id: 'failure', title: 'Failure cases', line: 'Bad input, dead sensors, lost links. It must fail safely.' },
];

const PARITY_TOL = 0.01;          // allowed difference between the browser and Python, as a probability
const PLAN_FACTOR = 1.08;         // no returned route may cost more than this many times the grid optimum
const FAULT_IDS = ['linkLoss', 'csiDropout', 'badWindow', 'thermalFail', 'lowBattery'];
const near = (a, b, e = 5e-4) => Math.abs(a - b) <= e;
const ev = (sensor, result, vantage = 'A') => ({ sensor, result, vantage });
const steps = (e, n) => { for (let i = 0; i < n && !e.done; i++) e.step(); };
const runTo = (e, pred, max = 60000) => { let n = 0; while (!e.done && n++ < max && !pred(e.state)) e.step(); return pred(e.state); };
const finish = (e, max = 60000) => { let n = 0; while (!e.done && n++ < max) e.step(); return e.done; };
const codes = (e) => e.state.events.map((x) => x.code);
const has = (e, code) => e.state.events.some((x) => x.code === code);
const logLines = (S) => S.events.map((x) => x.t.toFixed(1) + '|' + x.level + '|' + x.code + '|' + x.text);
const statusOf = (e, src) => e.state.detections.find((d) => e.truthOf(d.id) === src);
const clock = (t) => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0');

// Everything that matters about a mission state, as one string. Timings of the network (ms) are left out: they are
// the only thing allowed to differ between two runs.
function digest(S) {
  return JSON.stringify([S.t, S.phase, Object.values(S.units).map((u) => [u.id, u.pos, u.heading, u.mode, u.battery, u.link, u.odo]),
    S.detections.map((d) => [d.id, d.status, d.p, d.pos, d.evidence.map((x) => [x.sensor, x.result, x.note])]),
    S.survivors, S.coverage, S.hazards, S.faults, S.routes.rescue ? [S.routes.rescue.status, S.routes.rescue.length] : null, logLines(S), [...S.map.explored].reduce((a, b) => a + b, 0)]);
}

// An independent check on the planner: plain Dijkstra with a linear-scan bucket queue, written separately on purpose.
function dijkstra(grid, start) {
  const { w, h, blocked, cost } = grid, d = new Float64Array(w * h).fill(Infinity), done = new Uint8Array(w * h);
  const heap = [[0, start]]; d[start] = 0;
  const push = (n) => { heap.push(n); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; const x = heap[p]; heap[p] = heap[i]; heap[i] = x; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; const x = heap[m]; heap[m] = heap[i]; heap[i] = x; i = m; } } return top; };
  while (heap.length) {
    const [dk, k] = pop(); if (done[k]) continue; done[k] = 1;
    const x = k % w, y = (k - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx; if (blocked[n] || done[n]) continue;
      if (dx && dy && (blocked[y * w + nx] || blocked[ny * w + x])) continue;
      const nd = dk + (dx && dy ? Math.SQRT2 : 1) * cost[n];
      if (nd < d[n]) { d[n] = nd; push([nd, n]); }
    }
  }
  return d;
}
const cellOf = (grid, p) => { const c = grid.toCell(p); return c[1] * grid.w + c[0]; };
// A route must not cross a wall, enter solid debris or a building, or enter an area closed as dangerous.
function hits(path, extra = []) {
  let clear = Infinity; const bad = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(dist(a, b) / 0.05));
    for (const w of WALLS) if (w.state !== 'collapsed' && segIntersect(a, b, w.a, w.b)) bad.push('wall ' + w.id);
    for (let k = 0; k <= n; k++) {
      const p = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      for (const w of WALLS) if (w.state !== 'collapsed') clear = Math.min(clear, distToSeg(p, w.a, w.b));
      for (const o of OBSTACLES) if (!o.passable && pointInPoly(p, o.poly) && deep(p, o.poly)) bad.push(o.name);
      for (const z of [...HAZARDS, ...extra]) if (z.block && pointInPoly(p, z.poly) && deep(p, z.poly)) bad.push(z.name);
    }
  }
  return { bad: [...new Set(bad)], clear };
}
// Inside by more than half a planning cell. The map is a 0.5 m grid: a point within 0.36 m of an edge shares a cell with it.
function deep(p, poly) { let m = Infinity; for (let i = 0; i < poly.length; i++) m = Math.min(m, distToSeg(p, poly[i], poly[(i + 1) % poly.length])); return m > 0.36; }
function pathCost(grid, path) { // the price of a route on the same map, sampled every 2 cm
  let s = 0;
  for (let i = 1; i < path.length; i++) { const a = path[i - 1], b = path[i], l = dist(a, b), n = Math.max(1, Math.ceil(l / 0.02)); for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, c = grid.cost[cellOf(grid, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])] || 1; s += (l / n) * c; } }
  return s;
}
function throws(fn) { try { fn(); return null; } catch (e) { return e.message || String(e); } }
const copyX = (nn, i) => nn.samples[i].x.map((r) => r.slice());

// A mission with a fault switched on at a moment and off at a later one.
function faulted(nn, { id, at, off, seed }) {
  const e = createEngine({ nn, ...(seed ? { seed } : {}) });
  runTo(e, at); e.command('injectFault', { id });
  const t0 = e.state.t, from = e.state.events.length;
  if (off) { runTo(e, (S) => off(S, S.t - t0)); e.command('clearFault', { id }); }
  return { e, t0, from };
}
const missionOutcome = (t, e, { rooms = true } = {}) => {
  t.check(e.done && e.state.phase === 'complete', 'The mission still reaches its end', e.state.phase + ' at ' + clock(e.state.t));
  t.check(Object.values(e.state.detections).every((d) => d.p > 0 && d.p < 1), 'Every probability stays between 0 and 1');
  const falseFind = e.state.detections.filter((d) => d.status === 'confirmed' && !TRUTH.people.some((p) => p.id === e.truthOf(d.id)));
  t.check(!falseFind.length, 'No one is confirmed who is not there', falseFind.map((d) => d.id).join(', ') || 'none');
  if (rooms) t.check(e.state.coverage['104'].status === 'blocked', 'Room 104 is still reported as not searched', e.state.coverage['104'].status);
};

export const SUITE = [
  // ---------------------------------------------------------------- ordinary
  { id: 'nn-parity', group: 'ordinary', area: 'Network', title: 'The browser network matches Python', expect: 'On all 30 bundled windows the JavaScript output is within 0.01 of the Python output for the same window.',
    async run(t) {
      let worst = 0;
      for (let i = 0; i < t.nn.samples.length; i++) {
        const r = t.nn.inferSample(i), dP = Math.abs(r.person - r.ref[0]), dM = Math.abs(r.moving - r.ref[1]); worst = Math.max(worst, dP, dM);
        t.check(dP <= PARITY_TOL && dM <= PARITY_TOL, 'Window ' + i + ', ' + r.truth.toLowerCase(), 'browser ' + r.person.toFixed(5) + ', Python ' + r.ref[0].toFixed(5), { js: r.person, py: r.ref[0], sample: i, says: r.says, truth: r.truthPerson, ms: r.ms });
        if (i % 3 === 2) await t.breathe();
      }
      return t.passed + ' of ' + t.nn.samples.length + ' windows match. Largest difference ' + worst.toFixed(5) + '.';
    } },
  { id: 'nn-answers', group: 'ordinary', area: 'Network', title: 'The network’s answers on the bundled windows', expect: 'Right on 20 of the 30, as published. Every wrong answer is listed as a known limit, not hidden.',
    async run(t) {
      let right = 0; const wrong = {};
      t.nn.samples.forEach((s, i) => { const r = t.nn.inferSample(i), ok = r.says === r.truthPerson; if (ok) { right++; t.check(true, 'Window ' + i + ', ' + r.truth.toLowerCase(), 'says ' + (r.says ? 'person' : 'no one')); } else { wrong[r.truth] = (wrong[r.truth] || 0) + 1; t.limit('Window ' + i + ', ' + r.truth.toLowerCase(), 'says ' + (r.says ? 'person' : 'no one') + ' (' + r.person.toFixed(2) + ')'); } });
      t.check(right === 20, 'The count agrees with the published figure', right + ' of 30');
      return 'Right on ' + right + ' of 30. Wrong on ' + Object.entries(wrong).map(([k, v]) => v + ' × ' + k.toLowerCase()).join(', ') + '.';
    } },
  { id: 'plan-ordinary', group: 'ordinary', area: 'Planner', title: 'An ordinary route', expect: 'From staging to the entrance and on to each listening stop: a route is found, it is collision-free, and it is no shorter than a straight line.',
    async run(t) {
      const g = buildGrid(), pts = [SITE.staging, SITE.entrance, ...STOPS.map((s) => s.pos)]; let total = 0;
      for (let i = 1; i < pts.length; i++) {
        const r = planPath(g, pts[i - 1], pts[i]), h = r.ok ? hits(r.path) : { bad: ['no route'], clear: 0 }; total += r.length || 0;
        t.check(r.ok && r.reached, 'Leg ' + i + ': a route is found', r.ok ? r.length.toFixed(1) + ' m' : r.reason, { path: r.path });
        t.check(r.ok && !h.bad.length, 'Leg ' + i + ': nothing is hit', h.bad.join(', ') || 'closest wall ' + h.clear.toFixed(2) + ' m');
        t.check(r.ok && r.length >= dist(pts[i - 1], pts[i]) - 1e-6, 'Leg ' + i + ': not shorter than a straight line');
      }
      return (pts.length - 1) + ' legs, ' + total.toFixed(1) + ' m in all, nothing hit.';
    } },
  { id: 'plan-blocked', group: 'ordinary', area: 'Planner', title: 'A route around a blocked corridor', expect: 'With the west corridor closed the route from the entrance to stop S2 must change or be refused. It must never go through.',
    async run(t) {
      const hz = { id: 'test', kind: 'collapse', name: 'Test blockage', poly: [[51, 42], [54, 42], [54, 46], [51, 46]], block: true };
      const open = planPath(buildGrid(), SITE.entrance, STOPS[1].pos), shut = planPath(buildGrid({ extraHazards: [hz] }), SITE.entrance, STOPS[1].pos, { nearest: true });
      t.check(open.ok && open.path.some((p, i) => i && segCross(open.path[i - 1], p, hz.poly)), 'Open: the route uses the corridor', open.length.toFixed(1) + ' m');
      t.check(shut.ok && !hits(shut.path, [hz]).bad.length, 'Closed: the new route does not cross the blockage', shut.ok ? (shut.reached ? shut.length.toFixed(1) + ' m, a way round' : 'stops ' + shut.gap.toFixed(1) + ' m short') : shut.reason);
      t.check(shut.ok && (!shut.reached || shut.length > open.length), 'Closed: longer, or stopped short and says so');
      const yard = { ...hz, poly: [[40, 8], [44, 8], [44, 26], [40, 26]] }, a = planPath(buildGrid(), [30, 16], [56, 16]), b = planPath(buildGrid({ extraHazards: [yard] }), [30, 16], [56, 16]);
      t.check(b.ok && b.reached && b.length > a.length && !hits(b.path, [yard]).bad.length, 'In the yard: it walks around a wall of debris', a.length.toFixed(1) + ' m becomes ' + b.length.toFixed(1) + ' m');
      return 'Corridor closed: ' + (shut.reached ? 'a longer way, ' + shut.length.toFixed(1) + ' m' : 'stopped at the closest safe point') + '. Yard closed: ' + a.length.toFixed(1) + ' m became ' + b.length.toFixed(1) + ' m.';
    } },
  { id: 'fuse-one', group: 'ordinary', area: 'Fusion', title: 'One reading at a time', expect: 'The prior, and the prior after one reading of each kind, equal values worked out by hand.',
    async run(t) {
      t.check(near(fuse([]).p, 0.1), 'No evidence: the prior', fuse([]).p.toFixed(4) + ' (hand 0.1000)');
      // odds 1/9, times the likelihood ratio, back to a probability
      for (const [s, r, hand] of [['csi', 'pos', 0.32271], ['csi', 'neg', 0.06146], ['radar', 'pos', 0.4], ['radar', 'neg', 0.07216], ['micro', 'pos', 0.25], ['micro', 'neg', 0.08163], ['thermal', 'pos', 0.47059], ['thermal', 'faint', 0.25], ['thermal', 'neg', 0.05263], ['signature', 'machine', 0.03226], ['temperature', 'tooHot', 0.01099], ['aerial', 'pos', 0.4], ['acoustic', 'pos', 0.4375], ['human', 'pos', 0.95694]]) {
        const p = fuse([ev(s, r)]).p; t.check(near(p, hand), s + ' ' + r, p.toFixed(5) + ' (hand ' + hand.toFixed(5) + ')');
      }
      return t.passed + ' hand-computed values agree to 0.0005.';
    } },
  { id: 'fuse-limits', group: 'ordinary', area: 'Fusion', title: 'The two thresholds', expect: 'Confirmed from 85 %, possible from 15 %, nothing in between is lost.',
    async run(t) {
      for (const [p, want] of [[1, 'confirmed'], [THRESHOLDS.confirmed, 'confirmed'], [0.8499, 'possible'], [0.5, 'possible'], [THRESHOLDS.possible, 'possible'], [0.1499, 'unlikely'], [0, 'unlikely']]) t.check(classify(p) === want, (p * 100).toFixed(2) + ' %', classify(p));
      let prev = 0; for (let i = 0; i <= 100; i++) { const c = ['unlikely', 'possible', 'confirmed'].indexOf(classify(i / 100)); if (c < prev) t.check(false, 'Order broken at ' + i + ' %'); prev = c; }
      t.check(prev === 2, 'Rises in order from 0 to 100 %');
      return 'Each boundary falls on the right side.';
    } },
  { id: 'mission', group: 'ordinary', area: 'Mission', title: 'The whole mission, start to finish', expect: 'It completes, finds all three people, rejects the fan and the hot pipe, reports room 104 as not searched, and no one moves before the route is approved.',
    async run(t) {
      const e = createEngine({ nn: t.nn }); let early = false; const home = e.state.units['TEAM-1'].pos.slice();
      let n = 0; while (!e.done && n++ < 60000) { e.step(); const r = e.state.routes.rescue; if (dist(home, e.state.units['TEAM-1'].pos) > 0.01 && !(r && (r.status === 'approved' || r.status === 'done'))) early = true; }
      const S = e.state;
      t.check(e.done && S.phase === 'complete', 'It completes', clock(S.t));
      for (const p of TRUTH.people) { const d = statusOf(e, p.id); t.check(d?.status === 'confirmed', 'Person ' + p.id + ' (' + (p.room ? 'room ' + p.room : 'outdoors') + ') is found', d ? d.status + ', ' + (d.p * 100).toFixed(1) + ' %' : 'never seen'); t.check(d?.pos && dist(d.pos, p.pos) <= Math.max(3, 3 * (d.posSigma || 0)), 'Person ' + p.id + ' is placed inside its stated error', d?.pos ? dist(d.pos, p.pos).toFixed(2) + ' m off' : ''); }
      for (const [id, kind] of [['X1', 'machine'], ['X2', 'hot object']]) { const d = statusOf(e, id); t.check(d?.status === 'rejected' && d.kind === kind, 'The ' + (id === 'X1' ? 'fan' : 'hot pipe') + ' is rejected for the right reason', d ? d.kind + ', ' + (d.p * 100).toFixed(1) + ' %' : 'never seen'); }
      t.check(S.coverage['104'].status === 'blocked' && S.coverage['104'].residual > 0, 'Room 104 is marked as not searched', S.coverage['104'].note);
      for (const r of ROOMS) if (!r.corridor) t.check(S.coverage[r.id].residual > 0 && S.coverage[r.id].residual < 1, 'Room ' + r.id + ' never claims certainty', (S.coverage[r.id].residual * 100).toFixed(0) + ' % chance someone is there');
      t.check(!early, 'The team stays put until a route is approved');
      for (const l of S.routes.rescue.legs) t.check(l.ok && !hits(l.path).bad.length, 'Rescue leg to ' + l.det + ' hits nothing', l.length.toFixed(1) + ' m, ' + l.kind);
      t.check(S.routes.rescue.status === 'done' && Object.values(S.survivors).length === 3 && Object.values(S.survivors).every((v) => v.status === 'reached'), 'All three are reached');
      return 'Complete at ' + clock(S.t) + ': 3 of 3 people found, 2 of 2 decoys rejected, room 104 not searched, ' + S.events.length + ' log entries.';
    } },

  // ---------------------------------------------------------------- repeated
  { id: 'nn-repeat', group: 'repeated', area: 'Network', title: 'The network, five times over', expect: 'The same window gives the same number, to the last bit, every time.',
    async run(t) {
      const first = t.nn.samples.map((s) => t.nn.infer(s.x).person);
      for (let k = 0; k < 4; k++) { for (let i = 0; i < first.length; i++) { const p = t.nn.infer(t.nn.samples[i].x).person; t.check(Object.is(p, first[i]), 'Pass ' + (k + 2) + ', window ' + i, p.toFixed(6)); } await t.breathe(); }
      return '30 windows, 5 passes, not one bit of difference.';
    } },
  { id: 'plan-repeat', group: 'repeated', area: 'Planner', title: 'The planner, three times over', expect: '25 routes planned three times come out identical, point for point.',
    async run(t) {
      const g = buildGrid(), rng = mulberry32(77), pt = freePoint(g, rng);
      for (let i = 0; i < 25; i++) { const a = pt(), b = pt(), one = JSON.stringify(planPath(g, a, b, { nearest: true })); for (let k = 0; k < 2; k++) t.check(JSON.stringify(planPath(g, a, b, { nearest: true })) === one, 'Route ' + (i + 1) + ', run ' + (k + 2)); if (i % 5 === 4) await t.breathe(); }
      return '75 plans, every repeat identical.';
    } },
  { id: 'fuse-repeat', group: 'repeated', area: 'Fusion', title: 'Repeated evidence is discounted', expect: 'A second reading from the same place counts as its square root; from a new place it counts in full; the order does not matter.',
    async run(t) {
      // by hand: odds 1/9; Wi-Fi 0.476/0.111 = 4.28829; its square root 2.07082
      const same = fuse([ev('csi', 'pos'), ev('csi', 'pos')]), other = fuse([ev('csi', 'pos'), ev('csi', 'pos', 'B')]);
      t.check(near(same.p, 0.49667), 'Twice from one place', same.p.toFixed(5) + ' (hand 0.49667)');
      t.check(near(other.p, 0.67139), 'Once each from two places', other.p.toFixed(5) + ' (hand 0.67139)');
      t.check(same.steps[1].repeat === 1 && near(same.steps[1].lr, 2.07082), 'The discount is written in the steps', '× ' + same.steps[1].lr.toFixed(4));
      const set = [ev('csi', 'pos'), ev('radar', 'pos'), ev('micro', 'neg'), ev('thermal', 'faint'), ev('aerial', 'pos')], p0 = fuse(set).p, rng = mulberry32(5);
      for (let k = 0; k < 24; k++) { const s = set.map((x) => [rng(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]); t.check(Math.abs(fuse(s).p - p0) < 1e-12, 'Order ' + (k + 1), fuse(s).p.toFixed(6)); }
      let p = 0; for (let k = 1; k <= 40; k++) { const q = fuse(Array.from({ length: k }, () => ev('radar', 'neg'))).p; if (k > 1) t.check(q < p && q > 0, 'After ' + k + ' empty readings: lower, never zero', q.toExponential(2)); p = q; }
      return 'Twice from one place ' + (same.p * 100).toFixed(1) + ' %, from two places ' + (other.p * 100).toFixed(1) + ' %. 24 orders agree.';
    } },
  { id: 'mission-twice', group: 'repeated', area: 'Mission', title: 'The mission, run twice', expect: 'Two runs write the same log, word for word, and end in the same state.',
    async run(t) {
      const a = createEngine({ nn: t.nn }); finish(a); await t.breathe(); const b = createEngine({ nn: t.nn }); finish(b);
      const la = logLines(a.state), lb = logLines(b.state);
      for (let i = 0; i < Math.max(la.length, lb.length); i++) t.check(la[i] === lb[i], 'Log line ' + (i + 1), la[i] === lb[i] ? a.state.events[i].code : (la[i] || 'missing') + ' / ' + (lb[i] || 'missing'));
      t.check(digest(a.state) === digest(b.state), 'The end states are identical', digest(a.state).length.toLocaleString('en') + ' characters compared');
      return la.length + ' log lines and the whole end state, identical.';
    } },
  { id: 'seek', group: 'repeated', area: 'Mission', title: 'Jumping is the same as watching', expect: 'Seeking to five moments reproduces exactly the state you get by playing to them, with commands and a fault in the log.',
    async run(t) {
      const script = (sim, at) => { // the same operator actions, played live
        const acts = [[150, 'injectFault', { id: 'thermalFail' }], [200, 'allStop', {}], [206, 'resume', {}], [300, 'clearFault', { id: 'thermalFail' }], [320, 'newHazard', { poly: [[60, 34], [62, 34], [62, 36], [60, 36]] }]];
        return acts.filter((a) => a[0] <= at);
      };
      const at = [60, 205, 310, 430, 600];
      for (const T of at) {
        const e = createEngine({ nn: t.nn }); let i = 0; const acts = script(null, 1e9);
        while (e.state.t < T - 1e-9) { while (i < acts.length && acts[i][0] <= e.state.t + 1e-9) { e.command(acts[i][1], acts[i][2]); i++; } e.step(); }
        const sim = createSim({ bus: createBus(), nn: t.nn }); for (const a of acts) { if (a[0] >= T) break; sim.seek(a[0]); sim.command(a[1], a[2]); }
        sim.seek(T); const one = digest(sim.state); sim.seek(T > 100 ? 40 : 10); const back = sim.state.t; 
        t.check(one === digest(e.state), 'Jump to ' + clock(T), 'phase ' + e.state.phase + ', ' + e.state.events.length + ' log lines');
        t.check(Math.abs(back - (T > 100 ? 40 : 10)) < 0.06, 'and back again from ' + clock(T), clock(back));
        await t.breathe();
      }
      return 'Five moments, five identical states.';
    } },
  { id: 'reset', group: 'repeated', area: 'Mission', title: 'Restart means restart', expect: 'After a disturbed mission, Restart gives the same first three minutes as a fresh start.',
    async run(t) {
      const sim = createSim({ bus: createBus(), nn: t.nn }); sim.seek(250); sim.command('injectFault', { id: 'linkLoss' }); sim.command('newHazard', {}); sim.reset(); sim.seek(180);
      const e = createEngine({ nn: t.nn }); while (e.state.t < 180 - 1e-9) e.step();
      t.check(digest(sim.state) === digest(e.state), 'Same state at 03:00'); t.check(!Object.values(sim.state.faults).some(Boolean), 'No fault left on'); t.check(!sim.state.hazards.length, 'No hazard left over'); t.check(sim.commandLog.length === 0, 'The command log is empty');
      return 'Nothing carries over.';
    } },

  // ---------------------------------------------------------------- demanding
  { id: 'plan-long', group: 'demanding', area: 'Planner', title: 'The longest route on the site', expect: 'Every pair of 20 points around the edge, with every hazard priced in. All collision-free; the longest is timed.',
    async run(t) {
      const g = buildGrid(), pts = []; for (let i = 0; i < 7; i++) { pts.push([2 + i * 19.3, 2], [2 + i * 19.3, 88]); } for (let i = 1; i < 4; i++) pts.push([2, 2 + i * 21.5], [118, 2 + i * 21.5]);
      let best = null, n = 0;
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { if ((i * 7 + j) % 3) continue; const t0 = performance.now(), r = planPath(g, pts[i], pts[j]), ms = performance.now() - t0; n++; const h = r.ok ? hits(r.path) : { bad: [r.reason] }; t.check(r.ok && !h.bad.length, 'Edge to edge ' + n, r.ok ? r.length.toFixed(1) + ' m' : r.reason); if (r.ok && (!best || r.length > best.r.length)) best = { r, ms, a: pts[i], b: pts[j] }; if (n % 6 === 0) await t.breathe(); }
      t.check(best.ms < 1000, 'The longest is planned in under a second', best.ms.toFixed(0) + ' ms', { path: best.r.path });
      return n + ' routes. Longest ' + best.r.length.toFixed(1) + ' m, planned in ' + best.ms.toFixed(0) + ' ms, ' + best.r.expanded.toLocaleString('en') + ' cells looked at.';
    } },
  { id: 'plan-200', group: 'demanding', area: 'Planner', title: '200 random routes against an independent solver', expect: 'A second algorithm, written separately, must agree on what is reachable and on the best price. No route may hit anything, or cost more than ' + PLAN_FACTOR + ' times the optimum.',
    async run(t) {
      const g = buildGrid(), rng = mulberry32(20261121), pt = freePoint(g, rng); let worst = 0, minClear = Infinity, unreachable = 0, total = 0;
      for (let s = 0; s < 20; s++) {
        const a = pt(), d = dijkstra(g, cellOf(g, a));
        for (let k = 0; k < 10; k++) {
          const b = pt(), opt = d[cellOf(g, b)] * g.res, r = planPath(g, a, b), id = 'Route ' + (s * 10 + k + 1);
          if (!Number.isFinite(opt)) { unreachable++; t.check(!r.ok, id + ': both say unreachable', r.ok ? 'the planner found a route' : r.reason); t.check(true, id + ': nothing to drive'); t.check(true, id + ': no price'); continue; }
          const h = r.ok ? hits(r.path) : { bad: [r.reason], clear: 0 }, f = r.ok && opt > 0.6 ? pathCost(g, r.path) / opt : 1; worst = Math.max(worst, f); if (r.ok) { minClear = Math.min(minClear, h.clear); total += r.length; }
          t.check(r.ok && Math.abs(r.cost - opt) < 0.02 + opt * 1e-4, id + ': same best price', r.ok ? r.cost.toFixed(2) + ' and ' + opt.toFixed(2) : r.reason, { path: r.path });
          t.check(!h.bad.length, id + ': nothing hit', h.bad.join(', ') || r.length.toFixed(1) + ' m');
          t.check(f <= PLAN_FACTOR, id + ': within ' + PLAN_FACTOR + ' of the optimum', '× ' + f.toFixed(3));
        }
        await t.breathe();
      }
      return '200 pairs, ' + (total / 1000).toFixed(1) + ' km of route. Worst ' + worst.toFixed(3) + ' × optimum, ' + unreachable + ' unreachable and said so, closest wall ' + minClear.toFixed(2) + ' m.';
    } },
  { id: 'nn-speed', group: 'demanding', area: 'Network', title: 'A burst of 300 readings', expect: 'Each one finishes long before the next 10-second window is full. Under 100 ms each on this computer.',
    async run(t) {
      const ms = []; for (let i = 0; i < 300; i++) { const t0 = performance.now(); t.nn.infer(t.nn.samples[i % 30].x); const d = performance.now() - t0; ms.push(d); if (i % 10 === 9) { const m = Math.max(...ms.slice(-10)); t.check(m < 100, 'Readings ' + (i - 8) + ' to ' + (i + 1), 'slowest ' + m.toFixed(1) + ' ms'); await t.breathe(); } }
      ms.sort((a, b) => a - b);
      return 'Median ' + ms[150].toFixed(1) + ' ms, slowest ' + ms[299].toFixed(1) + ' ms on this computer. The Raspberry Pi has not been timed.';
    } },
  { id: 'hazards-24', group: 'demanding', area: 'Mission', title: '24 missions, each with a slide at a random moment', expect: 'Routes are planned again, nothing drives through the new debris, and every mission ends with its gaps reported.',
    async run(t) {
      const rng = mulberry32(99); let replans = 0, found = 0, gaps = 0;
      for (let k = 0; k < 24; k++) {
        const e = createEngine({ nn: t.nn }), when = 100 + rng() * 460; runTo(e, (S) => S.t >= when);
        const S = e.state, corridor = rng() < 0.6, cx = corridor ? 46 + rng() * 28 : 30 + rng() * 60, cy = corridor ? 44 : 8 + rng() * 20, w = corridor ? 1.5 : 2 + rng() * 3, hgt = corridor ? 2 : 1.5 + rng() * 2;
        const poly = [[cx - w, cy - hgt], [cx + w, cy - hgt], [cx + w, cy + hgt], [cx - w, cy + hgt]], inAt = ['HOUND-01', 'TEAM-1'].map((id) => pointInPoly(S.units[id].pos, poly));
        e.command('newHazard', { poly, name: 'Test slide' });
        let drove = false, n = 0, escaped = inAt.map((x) => !x);
        while (!e.done && n++ < 40000) { e.step(); ['HOUND-01', 'TEAM-1'].forEach((id, i) => { const inside = pointInPoly(S.units[id].pos, poly) && deep(S.units[id].pos, poly); if (!pointInPoly(S.units[id].pos, poly)) escaped[i] = true; else if (inside && escaped[i]) drove = true; }); }
        replans += S.stats.replans; found += Object.values(S.survivors).length; const open = Object.values(S.coverage).filter((c) => c.status === 'blocked').length; gaps += open;
        t.check(e.done && S.phase === 'complete', 'Mission ' + (k + 1) + ' ends', clock(S.t)); t.check(!drove, 'Mission ' + (k + 1) + ': nothing drives through it', 'slide at ' + clock(when)); t.check(open >= 1 && Object.values(S.coverage).every((c) => c.status !== 'unsearched'), 'Mission ' + (k + 1) + ': every room is accounted for', open + ' not searched');
        if (k % 4 === 3) await t.breathe();
      }
      return '24 of 24 ended. ' + replans + ' routes planned again, ' + found + ' people found in all, ' + gaps + ' rooms honestly reported as not searched.';
    } },
  { id: 'monte-carlo', group: 'demanding', area: 'Mission', title: '200 missions with random Wi-Fi windows', expect: 'Every mission ends, no person is missed and no one is confirmed who is not there. Team visits that find no one are counted and shown as a known limit.', parts: 5,
    async run(t, part) {
      const tally = {}; let falseRuns = 0, falseN = 0, wasted = 0, time = 0; for (const p of TRUTH.people) tally[p.id] = { confirmed: 0, flagged: 0, missed: 0 };
      for (let i = part * 40; i < part * 40 + 40; i++) {
        const e = createEngine({ nn: t.nn, seed: 1000 + i * 7919, windows: 'random', keep: { autoplay: true } }); finish(e, 40000); time += e.state.t;
        const out = Object.fromEntries(TRUTH.people.map((p) => [p.id, 'missed'])); let f = 0, w = 0;
        for (const d of e.state.detections) { const src = e.truthOf(d.id), team = d.evidence.some((x) => x.sensor === 'human'); if (!(src in out)) { if (d.status === 'confirmed') f++; if (team) { wasted++; w++; } continue; } if (d.status === 'confirmed' && !team) out[src] = 'confirmed'; else if (d.status === 'confirmed' || (d.status === 'possible' && d.needsTeam)) out[src] = 'flagged'; }
        for (const [id, r] of Object.entries(out)) tally[id][r]++;
        const miss = Object.entries(out).filter(([, r]) => r === 'missed').map(([id]) => id);
        t.check(e.done, 'Mission ' + (i + 1) + ' ends', clock(e.state.t)); t.check(!miss.length, 'Mission ' + (i + 1) + ': no one is missed', Object.entries(out).map(([k, v]) => k + ' ' + v).join(', '));
        if (f) { falseRuns++; falseN += f; } t.check(!f, 'Mission ' + (i + 1) + ': no one is confirmed who is not there', f + ' false'); if (w) t.limit('Mission ' + (i + 1) + ': the team is sent to a room with no one in it', w + ' wasted visit' + (w > 1 ? 's' : ''));
        if (i % 2) await t.breathe();
      }
      return { tally, falseRuns, falseN, wasted, time };
    },
    join(parts) {
      const s = { runs: 40 * parts.length, people: {}, falseRuns: 0, falseConfirmed: 0, wastedVisits: 0, meanTime: 0 };
      for (const p of parts) { s.falseRuns += p.falseRuns; s.falseConfirmed += p.falseN; s.wastedVisits += p.wasted; s.meanTime += p.time; for (const [id, o] of Object.entries(p.tally)) { const q = (s.people[id] ||= { confirmed: 0, flagged: 0, missed: 0 }); for (const k in o) q[k] += o[k]; } }
      s.meanTime /= s.runs; const say = (id) => { const o = s.people[id]; return o.confirmed + ' confirmed, ' + o.flagged + ' flagged for the team, ' + o.missed + ' missed'; };
      return { summary: s, got: 'Moving person: ' + say('P1') + '. Still person: ' + say('P2') + '. Outdoors: ' + say('P3') + '. False confirmations: ' + s.falseConfirmed + '. Visits that found no one: ' + s.wastedVisits + '.' };
    } },

  // ---------------------------------------------------------------- failure
  { id: 'nn-shape', group: 'failure', area: 'Network', title: 'Input of the wrong shape', expect: 'Refused, with an error a person can read. Never a guess.',
    async run(t) {
      const cases = [['nothing', () => null], ['text', () => 'hello'], ['an empty list', () => []], ['51 rows', () => copyX(t.nn, 0).slice(1)], ['53 rows', () => [...copyX(t.nn, 0), copyX(t.nn, 0)[0]]], ['199 samples a row', () => copyX(t.nn, 0).map((r) => r.slice(1))], ['one short row in the middle', () => { const x = copyX(t.nn, 0); x[30] = x[30].slice(0, 10); return x; }], ['a missing row', () => { const x = copyX(t.nn, 0); x[12] = null; return x; }], ['a window number that does not exist', null]];
      for (const [name, make] of cases) { const m = throws(() => (make ? t.nn.infer(make()) : t.nn.inferSample(999))); t.check(!!m, name, m || 'it answered anyway'); }
      return t.failed ? t.failed + ' of ' + cases.length + ' got through.' : 'All ' + cases.length + ' refused.';
    } },
  { id: 'nn-nan', group: 'failure', area: 'Network', title: 'Corrupt numbers', expect: 'One bad value anywhere in the 10,400 is enough for the window to be refused.',
    async run(t) {
      const bad = [['not a number', NaN], ['infinity', Infinity], ['minus infinity', -Infinity], ['missing', undefined], ['text', '0.5'], ['null', null]], at = [[0, 0], [7, 40], [26, 100], [51, 199]];
      for (const [name, v] of bad) for (const [r, c] of at) { const x = copyX(t.nn, 3); x[r][c] = v; const m = throws(() => t.nn.infer(x)); t.check(!!m, name + ' at row ' + r + ', sample ' + c, m || 'it answered anyway'); }
      const ok = throws(() => t.nn.infer(copyX(t.nn, 3))); t.check(!ok, 'and a good window still gets an answer afterwards', ok || 'yes');
      return bad.length * at.length + ' corrupt windows, all refused.';
    } },
  { id: 'nn-file', group: 'failure', area: 'Network', title: 'A damaged network file', expect: 'Loading stops with a clear message. The console does not start on a broken network.',
    async run(t) {
      const { loadNN } = await import(new URL('../../core/nn.js', import.meta.url).href + '?fresh=' + Math.floor(performance.now()));
      for (const [name, body] of [['an empty object', '{}'], ['too few layers', '{"weights":[1,2,3],"samples":[]}'], ['no windows', '{"weights":[1,2,3,4,5,6,7,8,9,10,11,12]}'], ['half a file', '{"weights":[[1,2']]) {
        let m = null; try { await loadNN('data:application/json,' + encodeURIComponent(body)); } catch (e) { m = e.message; } t.check(!!m, name, m || 'it loaded');
      }
      return 'All four refused.';
    } },
  { id: 'plan-unreachable', group: 'failure', area: 'Planner', title: 'No way through', expect: 'A goal that cannot be reached is refused, or the closest safe approach is given with the distance left.',
    async run(t) {
      const box = [[[40, 8], [52, 8], [52, 9.5], [40, 9.5]], [[40, 18.5], [52, 18.5], [52, 20], [40, 20]], [[40, 8], [41.5, 8], [41.5, 20], [40, 20]], [[50.5, 8], [52, 8], [52, 20], [50.5, 20]]].map((poly, i) => ({ id: 'b' + i, kind: 'collapse', name: 'Box', poly, block: true }));
      const g = buildGrid({ extraHazards: box }), no = planPath(g, SITE.staging, [46, 14]), close = planPath(g, SITE.staging, [46, 14], { nearest: true });
      t.check(!no.ok && /blocked|safe way/i.test(no.reason), 'Boxed in: refused, with a reason', no.reason);
      t.check(close.ok && !close.reached && close.gap > 0, 'Boxed in: the closest approach', close.ok ? close.gap.toFixed(1) + ' m short' : close.reason);
      const end = close.path[close.path.length - 1]; t.check(!g.blocked[cellOf(g, end)] && !hits(close.path, box).bad.length, 'and it stops on safe ground');
      const d = dijkstra(g, cellOf(g, SITE.staging)); let best = Infinity; const gc = g.toCell([46, 14]); for (let k = 0; k < d.length; k++) if (Number.isFinite(d[k])) best = Math.min(best, Math.hypot((k % g.w) - gc[0], Math.floor(k / g.w) - gc[1])); t.check(near(close.gap, best * g.res, 1e-6), 'No reachable point is closer', (best * g.res).toFixed(2) + ' m by the second solver');
      const r112 = planPath(buildGrid(), SITE.entrance, [77.6, 51], { nearest: true }); t.check(r112.ok && !r112.reached && r112.gap > 0, 'Room 112: says how far to break through', r112.gap.toFixed(1) + ' m');
      return 'Refused when it must be. Closest approach to room 112 stops ' + r112.gap.toFixed(1) + ' m short and says so.';
    } },
  { id: 'plan-inside', group: 'failure', area: 'Planner', title: 'Starting inside a wall', expect: 'It steps to the nearest free ground, or refuses. It never returns nonsense.',
    async run(t) {
      const g = buildGrid(), rng = mulberry32(3); 
      for (let i = 0; i < 20; i++) { const w = WALLS[Math.floor(rng() * WALLS.length)], k = rng(), p = [w.a[0] + (w.b[0] - w.a[0]) * k, w.a[1] + (w.b[1] - w.a[1]) * k], r = planPath(g, p, SITE.staging, { nearest: true }); t.check(r.ok ? r.path.every((q) => q.every(Number.isFinite)) && r.length > 0 : typeof r.reason === 'string', 'From inside wall ' + w.id, r.ok ? r.length.toFixed(1) + ' m' : r.reason); }
      const deepIn = planPath(g, [100, 33], SITE.staging); t.check(!deepIn.ok, 'From the middle of building C: refused', deepIn.reason || 'returned a route');
      const off = planPath(g, SITE.staging, [-60, -60]); t.check(!off.ok, 'To a point off the map: refused', off.reason || 'returned a route');
      const same = planPath(g, SITE.staging, SITE.staging); t.check(same.ok && same.length < 1, 'To where it already is', same.ok ? same.length.toFixed(2) + ' m' : same.reason);
      return 'Every odd start handled.';
    } },
  { id: 'fuse-blind', group: 'failure', area: 'Fusion', title: 'A sensor that could not see', expect: 'Blind, unknown and missing evidence change nothing at all.',
    async run(t) {
      const base = [ev('csi', 'pos'), ev('radar', 'pos')], p0 = fuse(base).p;
      for (const x of [ev('thermal', 'blind'), ev('csi', 'blind'), ev('radar', 'none'), ev('micro', 'blind'), ev('nosuchsensor', 'pos'), ev('thermal', 'nosuchresult'), ev('aerial', 'blind'), ev('acoustic', 'blind')]) { const p = fuse([...base, x]).p; t.check(p === p0, x.sensor + ' ' + x.result, (p * 100).toFixed(3) + ' %'); }
      const p = fuse([ev('thermal', 'blind')]).p; t.check(near(p, PRIOR, 1e-12), 'Only blind evidence: still the prior', p.toFixed(4));
      return 'Not one changes the answer.';
    } },
  { id: 'fault-link', group: 'failure', area: 'Mission', title: 'Radio link lost while driving', expect: 'The rover stops where it is, keeps its readings, and carries on when the link returns.',
    async run(t) {
      const e = createEngine({ nn: t.nn }); runTo(e, (S) => S.phase === 'deploy' && S.units['HOUND-01'].odo > 12); const S = e.state, u = S.units['HOUND-01'], det = S.detections.length; e.command('injectFault', { id: 'linkLoss' }); e.step(); const p = u.pos.slice();
      for (let i = 0; i < 60; i++) { steps(e, 10); t.check(dist(p, u.pos) < 1e-9 && u.mode === 'fault' && u.v === 0, 'Second ' + (i + 1) + ': holding', u.mode); }
      t.check(u.link === 0, 'The link reads zero'); t.check(S.detections.length >= det, 'Findings are kept', S.detections.length + ' kept'); t.check(has(e, 'FAULT'), 'It is in the log');
      e.command('clearFault', { id: 'linkLoss' }); steps(e, 20); t.check(dist(p, u.pos) > 0.2 && u.mode === 'drive', 'It drives on when the link is back', dist(p, u.pos).toFixed(2) + ' m'); t.check(has(e, 'FAULT_CLEARED'), 'and says so'); finish(e); missionOutcome(t, e); t.check(Object.keys(S.survivors).length === 3, 'All three people are still found');
      return 'Held still for 60 s, then finished at ' + clock(S.t) + ' with all three found.';
    } },
  { id: 'fault-packets', group: 'failure', area: 'Mission', title: 'Wi-Fi packets dropping', expect: 'Each bad window is rejected and repeated; after two tries the stop goes on without Wi-Fi and is marked so.',
    async run(t) {
      const { e } = faulted(t.nn, { id: 'csiDropout', at: (S) => S.phase === 'search' }); finish(e); const S = e.state;
      t.check(codes(e).filter((c) => c === 'WINDOW_REJECTED').length >= 2, 'Windows are rejected and repeated', codes(e).filter((c) => c === 'WINDOW_REJECTED').length + ' times'); t.check(has(e, 'CSI_UNAVAILABLE'), 'Then it goes on without Wi-Fi and says so');
      t.check(S.detections.every((d) => d.evidence.filter((x) => x.sensor === 'csi').every((x) => x.result === 'blind')), 'No Wi-Fi answer is used anywhere'); for (const c of Object.values(S.coverage)) if (c.status === 'clear') t.check(c.noCsi === true, 'Room ' + c.room + ' is marked as searched without Wi-Fi', c.note); missionOutcome(t, e);
      return codes(e).filter((c) => c === 'WINDOW_REJECTED').length + ' windows rejected. ' + Object.keys(S.survivors).length + ' people still found, by the other sensors.';
    } },
  { id: 'fault-window', group: 'failure', area: 'Mission', title: 'A corrupt Wi-Fi window', expect: 'The network refuses it. The reading is skipped, never guessed.',
    async run(t) {
      const { e } = faulted(t.nn, { id: 'badWindow', at: (S) => S.phase === 'search' && S.sensors.listen, off: (S) => S.events.some((x) => x.code === 'WINDOW_REJECTED') }); finish(e);
      t.check(e.state.events.some((x) => x.code === 'WINDOW_REJECTED' && /refused by the network/.test(x.text)), 'The network refused it', e.state.events.find((x) => x.code === 'WINDOW_REJECTED')?.text); t.check(e.state.events.filter((x) => x.code === 'CSI_UNAVAILABLE').length === 0, 'Once cleared, the next try works'); missionOutcome(t, e); t.check(Object.keys(e.state.survivors).length === 3, 'All three people are still found');
      return 'One window refused, the next one used. Three of three found.';
    } },
  { id: 'fault-thermal', group: 'failure', area: 'Mission', title: 'Thermal camera dead', expect: 'Every reading it would have given is marked blind. Nothing is invented in its place.',
    async run(t) {
      const { e } = faulted(t.nn, { id: 'thermalFail', at: (S) => S.phase === 'deploy' }); finish(e); const th = e.state.detections.flatMap((d) => d.evidence).filter((x) => x.sensor === 'thermal');
      t.check(th.length > 0, 'It was asked for a reading', th.length + ' times'); for (const x of th) t.check(x.result === 'blind', 'Marked blind at ' + clock(x.t), x.note); t.check(e.state.sensors.thermal.ok === false, 'The instrument says it is not responding', e.state.sensors.thermal.reason); t.check(e.state.detections.filter((d) => e.truthOf(d.id) === 'X2').every((d) => d.status !== 'confirmed'), 'The hot pipe is not mistaken for a person'); missionOutcome(t, e);
      return th.length + ' readings marked blind. ' + Object.keys(e.state.survivors).length + ' people found without it.';
    } },
  { id: 'fault-battery', group: 'failure', area: 'Mission', title: 'Rover battery low', expect: 'It finishes the reading, goes back to staging, is swapped, and returns to where it left off.',
    async run(t) {
      const { e } = faulted(t.nn, { id: 'lowBattery', at: (S) => S.phase === 'search' && S.sensors.listen }); const S = e.state, u = S.units['HOUND-01']; const p = u.pos.slice(); t.check(runTo(e, () => has(e, 'BATTERY_LOW')), 'It says the battery is low', S.events.find((x) => x.code === 'BATTERY_LOW')?.text); t.check(dist(p, u.pos) < 0.01, 'It finished the reading first'); t.check(runTo(e, () => u.mode === 'swap'), 'It goes back for a swap'); t.check(dist(u.pos, SITE.staging) < 0.6, 'The swap happens at staging', dist(u.pos, SITE.staging).toFixed(2) + ' m from it'); t.check(runTo(e, () => has(e, 'BATTERY_SWAPPED')) && u.battery > 0.99, 'It is swapped', (u.battery * 100).toFixed(0) + ' %'); t.check(runTo(e, () => dist(u.pos, p) < 0.6), 'It returns to where it left off'); finish(e); missionOutcome(t, e); t.check(Object.keys(S.survivors).length === 3, 'All three people are still found');
      return 'Returned, swapped, resumed, finished at ' + clock(S.t) + '.';
    } },
  { id: 'fault-all', group: 'failure', area: 'Mission', title: 'Everything at once', expect: 'All five faults together, three times over, at different moments. No exception, no false find, and it ends.',
    async run(t) {
      for (const at of [120, 255, 400]) { const e = createEngine({ nn: t.nn }); runTo(e, (S) => S.t >= at); for (const id of FAULT_IDS) t.check(e.command('injectFault', { id }) === true, 'At ' + clock(at) + ': ' + id + ' accepted'); const p = e.state.units['HOUND-01'].pos.slice(); steps(e, 300); t.check(dist(p, e.state.units['HOUND-01'].pos) < 1e-9, 'At ' + clock(at) + ': the rover holds for 30 s'); e.command('clearFault', { id: 'linkLoss' }); let err = null; try { finish(e); } catch (x) { err = x.message; } t.check(!err, 'At ' + clock(at) + ': no exception', err || 'none'); missionOutcome(t, e, { rooms: true }); await t.breathe(); }
      return 'Three missions, fifteen faults, all ended safely.';
    } },
  { id: 'hazard-mid', group: 'failure', area: 'Mission', title: 'A slide in front of the rover', expect: 'Debris lands on the route while it drives. It plans again at once and never enters it.',
    async run(t) {
      const e = createEngine({ nn: t.nn }); runTo(e, (S) => S.phase === 'deploy' && S.units['HOUND-01'].odo > 10); const S = e.state, u = S.units['HOUND-01'], a = u.pos, b = S.units['HOUND-01'].goal, m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], poly = [[m[0] - 2, m[1] - 3], [m[0] + 2, m[1] - 3], [m[0] + 2, m[1] + 3], [m[0] - 2, m[1] + 3]], before = pathLength(u.path);
      t.check(u.path.some((p, i) => i && segCross(u.path[i - 1], p, poly)), 'The slide is on its route'); e.command('newHazard', { poly, name: 'Test slide' }); steps(e, 2); t.check(has(e, 'NEW_HAZARD'), 'It is in the log'); t.check(has(e, 'REPLANNED'), 'It plans again within 0.2 s', S.events.find((x) => x.code === 'REPLANNED')?.text); t.check(u.path && !hits(u.path, [{ poly, block: true, name: 'slide' }]).bad.length, 'The new route goes around', u.path ? pathLength(u.path).toFixed(1) + ' m' : 'none', { path: u.path }); let inside = 0; while (!e.done && e.state.phase === 'deploy') { e.step(); if (pointInPoly(u.pos, poly) && deep(u.pos, poly)) inside++; } t.check(inside === 0, 'It never enters the slide', inside + ' steps inside'); finish(e); missionOutcome(t, e);
      return 'Planned again at once; mission finished at ' + clock(S.t) + '.';
    } },
  { id: 'all-stop', group: 'failure', area: 'Mission', title: 'All stop, at eight moments', expect: 'Every unit freezes for a full minute, and nothing is lost when it resumes.',
    async run(t) {
      for (const at of [20, 70, 130, 250, 300, 420, 500, 600]) { const e = createEngine({ nn: t.nn }); runTo(e, (S) => S.t >= at); const S = e.state; e.command('allStop'); e.step(); const p = Object.values(S.units).map((u) => u.pos.slice()); steps(e, 600); const moved = Math.max(...Object.values(S.units).map((u, i) => dist(u.pos, p[i]))); t.check(moved < 1e-9, 'At ' + clock(at) + ': nothing moves for 60 s', 'largest movement ' + moved.toFixed(3) + ' m'); e.command('resume'); finish(e); t.check(e.done && Object.keys(S.survivors).length === 3, 'At ' + clock(at) + ': resumes and finds all three', clock(S.t)); await t.breathe(); }
      return 'Eight holds, eight complete missions.';
    } },
  { id: 'bad-commands', group: 'failure', area: 'Mission', title: 'Orders that make no sense', expect: 'Refused without changing anything.',
    async run(t) {
      const e = createEngine({ nn: t.nn }); runTo(e, (S) => S.t >= 200); const before = digest(e.state);
      for (const [n, a] of [['launchMissiles', {}], ['approveRoute', {}], ['rejectRoute', {}], ['planRoute', {}], ['investigate', { id: 'D999' }], ['dismiss', { id: null }], ['injectFault', { id: 'nope' }], ['clearFault', { id: 'linkLoss' }], ['swapBattery', {}], ['finishAssess', {}]]) t.check(e.command(n, a) === false, n, 'refused'); t.check(digest(e.state) === before, 'Nothing changed');
      return 'Ten refused, nothing changed.';
    } },
];
function segCross(a, b, poly) { for (let i = 0; i < poly.length; i++) if (segIntersect(a, b, poly[i], poly[(i + 1) % poly.length])) return true; return pointInPoly(a, poly) || pointInPoly(b, poly); }
function freePoint(g, rng) { return () => { for (;;) { const i = Math.floor(rng() * g.w), j = Math.floor(rng() * g.h); if (!g.blocked[j * g.w + i]) return g.toPoint([i, j]); } }; }

// Run one test (or one part of a test that is split into parts). emit({ type: 'checks', id, checks }) as it goes; returns
// the part's outcome. A check is [state, what, detail, data]: state 1 pass, 2 fail, 3 known limit.
export async function runPart({ nn, id, part = 0, emit }) {
  const test = SUITE.find((x) => x.id === id); let batch = [], n = 0;
  const flush = () => { if (batch.length) { emit({ type: 'checks', id, part, checks: batch }); batch = []; } };
  const add = (s, what, detail, data) => { const c = [s, String(what), detail == null ? '' : String(detail)]; if (data) c.push(data); n++; batch.push(c); };
  const t = { nn, passed: 0, failed: 0, limits: 0, summary: null,
    check(ok, what, detail, data) { if (ok) t.passed++; else t.failed++; add(ok ? 1 : 2, what, detail, data); return ok; },
    limit(what, detail, data) { t.limits++; add(3, what, detail, data); },
    async breathe() { flush(); await new Promise((r) => setTimeout(r, 0)); } };
  const t0 = performance.now(); let got, error = null;
  try { got = await test.run(t, part); } catch (e) { error = String(e.message || e); got = 'Stopped with an error: ' + error; t.check(false, 'The test ran without an exception', String(e.stack || e).slice(0, 300)); }
  flush();
  return { id, part, got, error, ms: performance.now() - t0, passed: t.passed, failed: t.failed, limits: t.limits, n };
}

// Put the parts of one test together into its result.
export function joinParts(id, parts) {
  const test = SUITE.find((x) => x.id === id), sum = (k) => parts.reduce((s, p) => s + p[k], 0), failed = sum('failed'), limits = sum('limits'), error = parts.find((p) => p.error)?.error || null;
  let got = parts[0].got, summary = null;
  if (test.join && !error) ({ got, summary } = test.join(parts.map((p) => p.got)));
  return { id, group: test.group, area: test.area, title: test.title, expect: test.expect, got, summary, error, ms: sum('ms'), passed: sum('passed'), failed, limits, state: failed || !sum('n') ? 'fail' : limits ? 'limit' : 'pass' };
}

export function toMarkdown(out, device = '') {
  const L = ['# HOUND Command self-tests', '', 'Run ' + new Date(out.when).toLocaleString('en-GB') + (device ? ' on ' + device : '') + ' in ' + (out.ms / 1000).toFixed(1) + ' s. ' + out.results.length + ' tests, ' + out.checks.toLocaleString('en') + ' checks: ' + out.passed.toLocaleString('en') + ' passed, ' + out.failed + ' failed, ' + out.limits + ' known limits (measured, no pass mark). Everything runs on simulated people and a simulated mission.', ''];
  for (const g of GROUPS) {
    const rs = out.results.filter((r) => r.group === g.id); if (!rs.length) continue;
    L.push('## ' + g.title, '', g.line, '', '| Test | What should happen | What happened | Result | Checks | Time |', '|---|---|---|---|--:|--:|');
    for (const r of rs) L.push('| ' + [r.title, r.expect, r.got, r.state === 'pass' ? 'Pass' : r.state === 'limit' ? 'Pass, ' + r.limits + ' known limits' : 'FAIL (' + r.failed + ')', r.passed + r.failed + r.limits, r.ms < 1000 ? r.ms.toFixed(0) + ' ms' : (r.ms / 1000).toFixed(1) + ' s'].map((x) => String(x).replace(/\|/g, '/')).join(' | ') + ' |');
    L.push('');
  }
  return L.join('\n');
}
