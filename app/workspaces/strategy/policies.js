// The search as a decision problem, and three ways to decide.
//
// THE PROBLEM (a POMDP). Hidden state: who is where. Actions: drive to a stop and listen for one 10 s window (a
// "look"), or hand over to the rescue team. Observations: what the four sensors say. The belief is the Bayesian
// map of model.js. Rules shared by every policy, taken from the console (core/fusion.js) where they exist:
//   a room is CONFIRMED when the map says P(someone in it) >= 0.85, and a LEAD when >= 0.15
//   at hand-over the team checks every confirmed room and every lead, most likely first, walking at 1.1 m/s and
//   spending 45 s per room (assumed), 90 s more to break through a blocked door (assumed)
//   a person counts as found when their room is confirmed by the rover, or when the team reaches it
//   a team check of a room with no one in it is a "false alarm chased"
//   the rover may search for at most 15 minutes (assumed)
// The planner's objective (all three weights ASSUMED; they say that sooner is better, that a wasted entry into an
// unsafe room matters, and that the rover and the team are needed at the next building):
//   + exp(-t / 10 min) for each person found at time t,  - 0.25 for each false alarm chased,
//   - 0.04 for every minute until the team has finished.
//
// THE POLICIES
//   scripted   the mission's fixed route: one stop per pair of rooms, a second window when a lead appears, one
//              closer look at each open lead afterwards, then hand over (the logic of core/sim.js)
//   greedy     always the look with the most expected information per second; hand over when the best rate
//              falls below a threshold
//   tree       Monte-Carlo tree search in the style of POMCP (Silver and Veness 2010): sample "who is there" from
//              the belief, simulate looks with the sensor model, grow a tree of action and observation nodes with
//              UCB1, finish each simulation with a short rollout policy, act on the most-visited branch.
import { applyLook, copyBelief, makeBelief, sampleObs, infoGain, WINDOW_S } from './model.js';
import { TEAM_CHECK_S, DECOY_SLIP } from './worlds.js';
import { mulberry32 } from '../../core/geometry.js';

export const RULES = { lead: 0.15, confirmed: 0.85, tau: 600, cFalse: 0.25, cMin: 0.04, budget: 900 };
export const DEFAULTS = { kappa: 0.0065, sims: 280, depth: 4, width: 4, ucb: 0.5, rollSteps: 14, rollStop: 0.0013, margin: 2 };

export function roomProbs(world, B, out) {
  const rooms = world.rooms; out = out || new Float32Array(rooms.length);
  for (let r = 0; r < rooms.length; r++) { let q = 1; const zs = rooms[r].zones; for (let k = 0; k < zs.length; k++) q *= 1 - B.pm[zs[k]] - B.ps[zs[k]]; out[r] = 1 - q; }
  return out;
}
// The team's visiting order at hand-over: confirmed rooms, then leads, most likely first. Returns how many.
function teamOrder(roomP, conf, scratch) {
  let n = 0;
  for (let r = 0; r < roomP.length; r++) if (conf[r] || roomP[r] >= RULES.lead) {
    const key = (conf[r] ? 2 : 0) + roomP[r]; let i = n++;
    while (i > 0 && (conf[scratch[i - 1]] ? 2 : 0) + roomP[scratch[i - 1]] < key) { scratch[i] = scratch[i - 1]; i--; }
    scratch[i] = r;
  }
  return n;
}

// ---------- a real episode in a world with hidden truth ----------
export function newEpisode(world, truth, seed) {
  const nR = world.rooms.length;
  const ep = { world, truth, rng: mulberry32((seed * 7919 + 13) >>> 0), B: copyBelief(world.prior), roomP: new Float32Array(nR), conf: new Uint8Array(nR), confAt: new Float32Array(nR).fill(-1),
    t: 0, at: -1, looks: [], lastTouched: [], foundAt: truth.people.map(() => -1), foundBy: truth.people.map(() => null), falseChases: 0, done: false, tSearch: 0, tEnd: 0, visits: [] };
  roomProbs(world, ep.B, ep.roomP);
  return ep;
}
export const lookCost = (world, at, stop) => world.travel[(at + 1) * (world.stops.length + 1) + stop + 1] + WINDOW_S;
export function epLook(ep, stop) {
  const { world, truth, rng } = ep, S = world.S, reach = world.reach[stop], slot = world.slotOf[stop];
  ep.t += lookCost(world, ep.at, stop); ep.at = stop;
  const people = truth.people.map((p) => ({ slot: slot[p.zone], moving: p.moving }));
  const fan = truth.fans.some((f) => { const k = slot[f.zone]; return k >= 0 && reach.dm[k * 4] > 0; });
  const obs = sampleObs(reach, S, people, { fan }, rng);
  for (const f of truth.fans) { const k = slot[f.zone]; if (obs.radar && k >= 0 && rng() < reach.dm[k * 4 + 1] * DECOY_SLIP && !obs.radar.includes(k)) obs.radar.push(k); }
  for (const hsrc of truth.heats) { const k = slot[hsrc.zone]; if (obs.thermal && k >= 0 && rng() < reach.dm[k * 4 + 3] * DECOY_SLIP && !obs.thermal.includes(k)) obs.thermal.push(k); }
  applyLook(ep.B, reach, S, obs);
  roomProbs(world, ep.B, ep.roomP);
  const touched = new Set(); for (let k = 0; k < reach.n; k++) touched.add(world.zoneRoom[reach.idx[k]]);
  ep.lastTouched = [...touched];
  const newConf = [];
  for (let r = 0; r < ep.conf.length; r++) if (!ep.conf[r] && ep.roomP[r] >= RULES.confirmed) {
    ep.conf[r] = 1; ep.confAt[r] = ep.t; newConf.push(r);
    truth.people.forEach((p, i) => { if (p.room === r && ep.foundAt[i] < 0) { ep.foundAt[i] = ep.t; ep.foundBy[i] = 'rover'; } });
  }
  ep.looks.push({ stop, t: ep.t, obs, newConf, roomP: Float32Array.from(ep.roomP) });
  return obs;
}
export function epHandoff(ep) {
  const { world, truth } = ep, nR = world.rooms.length, order = new Int16Array(nR), n = teamOrder(ep.roomP, ep.conf, order);
  ep.tSearch = ep.t; let tt = ep.t, prev = 0;
  for (let i = 0; i < n; i++) {
    const r = order[i]; tt += world.teamT[prev * (nR + 1) + r + 1] + TEAM_CHECK_S; prev = r + 1;
    let any = false;
    truth.people.forEach((p, k) => { if (p.room === r) { any = true; if (ep.foundAt[k] < 0) { ep.foundAt[k] = tt; ep.foundBy[k] = 'team'; } } });
    if (!any) ep.falseChases++;
    ep.visits.push({ room: r, t: tt, empty: !any });
  }
  ep.tEnd = tt; ep.done = true;
}
export function epResult(ep) {
  const found = ep.foundAt.filter((t) => t >= 0), minutes = ep.tEnd / 60;
  let reward = -RULES.cFalse * ep.falseChases - RULES.cMin * minutes; for (const t of found) reward += Math.exp(-t / RULES.tau);
  return { people: ep.truth.people.length, found: found.length, missed: ep.truth.people.length - found.length, first: found.length ? Math.min(...found) : null, falseChases: ep.falseChases,
    tSearch: ep.tSearch, tEnd: ep.tEnd, looks: ep.looks.length, perMin: minutes > 0 ? found.length / minutes : 0, reward, byRover: ep.foundBy.filter((b) => b === 'rover').length };
}

// ---------- policy 1: the scripted route ----------
export function scriptedPolicy() {
  let phase = 0, k = 0, again = false, leads = null, li = 0;
  return (ep) => {
    const w = ep.world;
    if (phase === 0) {
      if (k > 0 && !again && ep.lastTouched.some((r) => !ep.conf[r] && ep.roomP[r] >= RULES.lead)) { again = true; return { stop: w.route[k - 1], why: 'A lead appeared: one more window here' }; }
      again = false;
      if (k < w.route.length) return { stop: w.route[k++], why: 'Next stop on the fixed route' };
      phase = 1; leads = []; for (let r = 0; r < w.rooms.length; r++) if (!ep.conf[r] && ep.roomP[r] >= RULES.lead) leads.push(r);
    }
    while (li < leads.length) { const r = leads[li++], ins = w.rooms[r].inside; if (!ep.conf[r] && ep.roomP[r] >= RULES.lead && ins != null && ins >= 0 && w.reachable[ins]) return { stop: ins, why: 'A closer look at the lead in room ' + w.rooms[r].id }; }
    return { handoff: true, why: 'Route finished' };
  };
}

// ---------- policy 2: greedy information gain ----------
export function greedyChoice(world, B, at, t, kappa) {
  let best = -1, bestRate = 0, bestGain = 0;
  for (let s = 0; s < world.stops.length; s++) {
    if (!world.reachable[s]) continue; const dt = lookCost(world, at, s); if (t + dt > RULES.budget) continue;
    const g = infoGain(B, world.reach[s], world.S), rate = g / dt;
    if (rate > bestRate) { bestRate = rate; best = s; bestGain = g; }
  }
  return best < 0 || bestRate < kappa ? { handoff: true, rate: bestRate } : { stop: best, rate: bestRate, gain: bestGain };
}
export function greedyPolicy(params = {}) {
  const kappa = params.kappa ?? DEFAULTS.kappa;
  return (ep) => { const c = greedyChoice(ep.world, ep.B, ep.at, ep.t, kappa); return c.handoff ? { handoff: true, why: 'No look is worth its time any more' } : { stop: c.stop, why: (c.gain).toFixed(2) + ' bits expected' }; };
}

// The rollout policy on its own (Koopman's rule: look where the most undetected probability can be swept per
// second). Not shown as a contender; it exists so the rollout's stopping threshold can be tuned and checked.
export function detectionChoice(world, B, conf, at, t, stopBelow) {
  let best = -1, bestScore = stopBelow;
  for (let s = 0; s < world.stops.length; s++) {
    if (!world.reachable[s]) continue; const dt = lookCost(world, at, s); if (t + dt > RULES.budget) continue;
    const reach = world.reach[s], dm = reach.dm, ds = reach.ds; let e = 0;
    for (let k = 0; k < reach.n; k++) { const c = reach.idx[k]; if (conf[world.zoneRoom[c]]) continue; const o = k * 4;
      e += B.pm[c] * (1 - (1 - dm[o]) * (1 - dm[o + 1]) * (1 - dm[o + 2]) * (1 - dm[o + 3])) + B.ps[c] * (1 - (1 - ds[o]) * (1 - ds[o + 1]) * (1 - ds[o + 2]) * (1 - ds[o + 3])); }
    if (e / dt > bestScore) { bestScore = e / dt; best = s; }
  }
  return best;
}
export function detectionPolicy(params = {}) { const stopBelow = params.rollStop ?? DEFAULTS.rollStop; return (ep) => { const s = detectionChoice(ep.world, ep.B, ep.conf, ep.at, ep.t, stopBelow); return s < 0 ? { handoff: true, why: 'No look is worth its time any more' } : { stop: s, why: 'Most undetected probability per second' }; }; }

// ---------- policy 3: Monte-Carlo tree search (POMCP style) ----------
export class TreeSearch {
  // root: { B, conf (Uint8Array), t, at }
  constructor(world, root, params = {}, seed = 1) {
    this.w = world; this.S = world.S; this.p = { ...DEFAULTS, ...params }; this.rng = mulberry32(seed >>> 0);
    this.nR = world.rooms.length; this.order = new Int16Array(this.nR); this.scratchB = makeBelief(world.zones.length); this.scratchP = new Float32Array(this.nR); this.scratchC = new Uint8Array(this.nR);
    this.nodes = 0; this.sims = 0; this.maxDepthSeen = 0;
    this.particle = []; this.found = [];
    this.root = this.makeNode(copyBelief(root.B), root.conf, root.t, root.at, 0, true);
  }
  // A node is a history: the belief after it is fixed, so it is computed once and kept.
  makeNode(B, parentConf, t, at, depth, isRoot = false) {
    const w = this.w, roomP = roomProbs(w, B), conf = Uint8Array.from(parentConf), newConf = [];
    if (!isRoot) for (let r = 0; r < this.nR; r++) if (!conf[r] && roomP[r] >= RULES.confirmed) { conf[r] = 1; newConf.push(r); }
    // Candidate looks: the stops with the most undetected probability per second (confirmed rooms excluded).
    const cands = [], nS = w.stops.length;
    for (let s = 0; s < nS; s++) {
      if (!w.reachable[s]) continue; const dt = lookCost(w, at, s); if (t + dt > RULES.budget) continue;
      const reach = w.reach[s], dm = reach.dm, ds = reach.ds; let e = 0;
      for (let k = 0; k < reach.n; k++) { const c = reach.idx[k]; if (conf[w.zoneRoom[c]]) continue; const o = k * 4;
        e += B.pm[c] * (1 - (1 - dm[o]) * (1 - dm[o + 1]) * (1 - dm[o + 2]) * (1 - dm[o + 3])) + B.ps[c] * (1 - (1 - ds[o]) * (1 - ds[o + 1]) * (1 - ds[o + 2]) * (1 - ds[o + 3])); }
      cands.push({ stop: s, dt, score: e / dt });
    }
    cands.sort((a, b) => b.score - a.score);
    // At the root, of the ten most promising keep the few with the most expected information per second, so the
    // first branch is the greedy policy's own choice and the tree's job is to find something better.
    const short = cands.slice(0, isRoot ? 10 : this.p.width);
    if (isRoot) { for (const c of short) c.rate = infoGain(B, w.reach[c.stop], this.S) / c.dt; short.sort((a, b) => b.rate - a.rate); }
    const width = isRoot ? this.p.width + 2 : this.p.width;
    const actions = short.slice(0, width).map((c) => ({ stop: c.stop, dt: c.dt, score: c.score, rate: c.rate, N: 0, Q: 0, children: new Map() }));
    actions.push({ handoff: true, N: 0, Q: 0, children: null });
    this.nodes++; if (depth > this.maxDepthSeen) this.maxDepthSeen = depth;
    return { B, roomP, conf, newConf, t, at, depth, N: 0, actions };
  }
  handoffValue(roomP, conf, t) {
    const w = this.w, nR = this.nR, n = teamOrder(roomP, conf, this.order), P = this.particle, F = this.found;
    let tt = t, prev = 0, v = 0;
    for (let i = 0; i < n; i++) {
      const r = this.order[i]; tt += w.teamT[prev * (nR + 1) + r + 1] + TEAM_CHECK_S; prev = r + 1;
      let any = false;
      for (let k = 0; k < P.length; k++) if (P[k].room === r) { any = true; if (!F[k]) { F[k] = 1; v += Math.exp(-tt / RULES.tau); } }
      if (!any) v -= RULES.cFalse;
    }
    return v - RULES.cMin * (tt / 60);
  }
  confirmValue(newConf, t) {
    let v = 0; const P = this.particle, F = this.found;
    for (const r of newConf) for (let k = 0; k < P.length; k++) if (P[k].room === r && !F[k]) { F[k] = 1; v += Math.exp(-t / RULES.tau); }
    return v;
  }
  observe(stop) { const slot = this.w.slotOf[stop], P = this.particle; for (let k = 0; k < P.length; k++) P[k].slot = slot[P[k].zone]; return sampleObs(this.w.reach[stop], this.S, P, null, this.rng); }
  // Rollout policy: keep taking the look with the most undetected probability per second (Koopman's rule, a cheap
  // stand-in for the greedy policy) until no look is worth its time, then hand over.
  rollout(node) {
    const w = this.w, steps = this.p.rollSteps;
    if (node.actions.length < 2) return this.handoffValue(node.roomP, node.conf, node.t);
    const B = copyBelief(node.B, this.scratchB), conf = this.scratchC, roomP = this.scratchP; conf.set(node.conf); roomP.set(node.roomP);
    let t = node.t, at = node.at, v = 0;
    for (let i = 0; i < steps; i++) {
      let best = -1, bestScore = this.p.rollStop, bestDt = 0;
      for (let s = 0; s < w.stops.length; s++) {
        if (!w.reachable[s]) continue; const dt = lookCost(w, at, s); if (t + dt > RULES.budget) continue;
        const reach = w.reach[s], dm = reach.dm, ds = reach.ds; let e = 0;
        for (let k = 0; k < reach.n; k++) { const c = reach.idx[k]; if (conf[w.zoneRoom[c]]) continue; const o = k * 4;
          e += B.pm[c] * (1 - (1 - dm[o]) * (1 - dm[o + 1]) * (1 - dm[o + 2]) * (1 - dm[o + 3])) + B.ps[c] * (1 - (1 - ds[o]) * (1 - ds[o + 1]) * (1 - ds[o + 2]) * (1 - ds[o + 3])); }
        if (e / dt > bestScore) { bestScore = e / dt; best = s; bestDt = dt; }
      }
      if (best < 0) break;
      const obs = this.observe(best); applyLook(B, w.reach[best], this.S, obs); roomProbs(w, B, roomP);
      t += bestDt; at = best;
      for (let r = 0; r < this.nR; r++) if (!conf[r] && roomP[r] >= RULES.confirmed) { conf[r] = 1; const P = this.particle, F = this.found; for (let k = 0; k < P.length; k++) if (P[k].room === r && !F[k]) { F[k] = 1; v += Math.exp(-t / RULES.tau); } }
    }
    return v + this.handoffValue(roomP, conf, t);
  }
  simulate(node, forced = null) {
    // UCB1 over the node's actions; untried actions first, in order of promise.
    let a = forced;
    if (!a) for (const x of node.actions) if (x.N === 0) { a = x; break; }
    if (!a) { let best = -Infinity; const ln = Math.log(node.N); for (const x of node.actions) { const u = x.Q + this.p.ucb * Math.sqrt(ln / x.N); if (u > best) { best = u; a = x; } } }
    let v;
    if (a.handoff) v = this.handoffValue(node.roomP, node.conf, node.t);
    else {
      const obs = this.observe(a.stop), key = obsKey(obs);
      let child = a.children.get(key);
      if (!child) {
        const B = copyBelief(node.B); applyLook(B, this.w.reach[a.stop], this.S, obs);
        child = this.makeNode(B, node.conf, node.t + a.dt, a.stop, node.depth + 1); child.obs = obs; child.key = key;
        a.children.set(key, child);
        v = this.confirmValue(child.newConf, child.t) + this.rollout(child); child.N++;
      } else {
        v = this.confirmValue(child.newConf, child.t);
        v += child.depth >= this.p.depth ? this.rollout(child) : this.simulate(child);
      }
    }
    a.N++; a.Q += (v - a.Q) / a.N; node.N++;
    return v;
  }
  // Run about n simulations. Each starts from one sampled answer to "who is there" (root sampling from the
  // belief). Every first move is tried against the SAME sampled world (common random numbers), so first moves are
  // compared on equal terms; below the root the tree grows by UCB1.
  run(n) {
    const w = this.w, B = this.root.B, nz = w.zones.length, rng = this.rng, acts = this.root.actions, vals = new Float64Array(acts.length);
    for (let done = 0; done < n; done += acts.length) {
      const P = this.particle; P.length = 0;
      for (let z = 0; z < nz; z++) { const u = rng(); if (u < B.pm[z]) P.push({ zone: z, room: w.zoneRoom[z], moving: true, slot: -1 }); else if (u < B.pm[z] + B.ps[z]) P.push({ zone: z, room: w.zoneRoom[z], moving: false, slot: -1 }); }
      this.found.length = P.length;
      for (let k = 0; k < acts.length; k++) { this.found.fill(0); vals[k] = this.simulate(this.root, acts[k]); this.sims++; }
      for (let k = 1; k < acts.length; k++) { const d = vals[k] - vals[0], a = acts[k]; a.dSum = (a.dSum || 0) + d; a.dSq = (a.dSq || 0) + d * d; }
      this.worlds = (this.worlds || 0) + 1;
    }
    return this;
  }
  // The first move to make. actions[0] is the greedy policy's choice; another move replaces it only when its
  // measured advantage over that choice, on the same sampled worlds, is larger than the noise (margin x standard error).
  best() {
    const acts = this.root.actions, n = this.worlds || 0; let b = acts[0], bestLead = 0;
    for (let k = 1; k < acts.length; k++) {
      const a = acts[k]; if (!n) break;
      const lead = a.dSum / n, se = n > 1 ? Math.sqrt(Math.max(0, a.dSq / n - lead * lead) / (n - 1)) : Infinity;
      a.lead = lead; a.se = se;
      if (lead > this.p.margin * se && lead > bestLead) { bestLead = lead; b = a; }
    }
    return b;
  }
}
export function obsKey(o) { return (o.csi ? 'W' : '-') + (o.micro ? 'B' : '-') + (o.radar && o.radar.length ? 'r' + o.radar.slice().sort((a, b) => a - b).join('.') : '') + (o.thermal && o.thermal.length ? 't' + o.thermal.slice().sort((a, b) => a - b).join('.') : ''); }
// Plain words for an observation, for the tree view.
export function obsWords(world, stop, o) {
  const reach = world.reach[stop], roomOf = (k) => world.rooms[world.zoneRoom[reach.idx[k]]].id, parts = [];
  if (o.radar && o.radar.length) parts.push('radar: mover in ' + [...new Set(o.radar.map(roomOf))].join(', '));
  if (o.thermal && o.thermal.length) parts.push('thermal: warm shape in ' + [...new Set(o.thermal.map(roomOf))].join(', '));
  if (o.csi) parts.push('Wi-Fi alarm'); if (o.micro) parts.push('breathing-size motion');
  return parts.length ? parts.join(' + ') : 'all quiet';
}
export function treePolicy(params = {}) {
  let n = 0;
  return (ep) => {
    const ts = new TreeSearch(ep.world, { B: ep.B, conf: ep.conf, t: ep.t, at: ep.at }, params, (ep.world.seed * 131 + 17 * ++n) >>> 0).run(params.sims ?? DEFAULTS.sims);
    const a = ts.best(); ep.lastTree = ts;
    return a.handoff ? { handoff: true, why: 'Handing over scores best (' + a.Q.toFixed(2) + ')' } : { stop: a.stop, why: 'Most-visited branch, value ' + a.Q.toFixed(2) };
  };
}

export const POLICIES = {
  scripted: { label: 'Fixed route', make: () => scriptedPolicy(), color: '--text-2' },
  greedy: { label: 'Greedy information gain', make: (p) => greedyPolicy(p), color: '--warn' },
  tree: { label: 'Tree search', make: (p) => treePolicy(p), color: '--accent' },
  detection: { label: 'Detection-rate rule', make: (p) => detectionPolicy(p), color: '--text-3', hidden: true },
};

// Run one whole episode. Returns the episode (for replay) and its result.
export function runEpisode(world, truth, policyId, params = {}, seed = 1) {
  const ep = newEpisode(world, truth, seed), decide = POLICIES[policyId].make(params);
  let guard = 0;
  while (!ep.done && guard++ < 200) {
    const d = decide(ep);
    if (d.handoff || ep.t + lookCost(world, ep.at, d.stop) > RULES.budget) { ep.handoffWhy = d.handoff ? d.why : 'Search time used up'; epHandoff(ep); }
    else { epLook(ep, d.stop); ep.looks[ep.looks.length - 1].why = d.why; }
  }
  return { ep, result: epResult(ep) };
}
