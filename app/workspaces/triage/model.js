// Triage model: everything here is plain computation on what the console already knows (detections, the map,
// the planner). Nothing reads ground truth. Numbers that are design assumptions live in ASSUMED and are shown
// as "assumed" wherever they appear on screen.
import { dist, pointInPoly, distToSeg, segIntersect } from '../../core/geometry.js';
import world from '../../core/world.js';

export const inside = pointInPoly;
const { WALLS, HAZARDS, OBSTACLES, DOORS, UNITS, roomAt, roomById, wallsCrossed } = world;

export const TEAM_SPEED = UNITS.find((u) => u.kind === 'team').speed; // m/s, from the scenario

// Design assumptions. None of these is measured. They make the trade-offs visible; a team would set their own.
export const ASSUMED = {
  breachMin: { drywall: 4, concrete: 25, debris: 15 },  // minutes to open a way through
  damagedFactor: 0.6,                                   // a damaged wall opens faster, but needs a stability check
  thicknessM: { drywall: 0.12, concrete: 0.25 },
  onSiteMin: 3,                                         // minutes a team stays with a person before moving on
  waitTauMin: 10,                                       // waiting term reaches 63 % after this many minutes
  effortHalfMin: 10,                                    // access term halves after this many minutes of effort
  exposureFullM: 15,                                    // route-safety term reaches zero at this many metres inside hazards
  need: { still: 1, unknown: 0.7, moving: 0.45 },       // still people may be less able to help themselves
  standOffM: 0.9,                                       // where the cutter stands, from the wall face
  clearMarginM: 0.5,                                    // extra margin added to the position uncertainty
  collapseZoneFactor: 1.5,                              // wait this many wall heights back from a damaged wall (rule of thumb)
  exposureMinPerM: 0.5,                                 // ranking approach sides: 1 m inside a hazard counts as 30 s
};

export const TERMS = [
  { key: 'sure', letter: 'C', label: 'Confidence', short: 'How sure', def: 'The fused probability that a person is there.' },
  { key: 'need', letter: 'L', label: 'Signs of life', short: 'Need', def: 'Still 1.00, not yet known 0.70, moving 0.45. A still person may be less able to help themselves.', assumed: true },
  { key: 'wait', letter: 'T', label: 'Time waiting', short: 'Waiting', def: '1 − e^(−minutes ÷ 10), counted from the first reading that pointed here.', assumed: true },
  { key: 'access', letter: 'A', label: 'Ease of access', short: 'Access', def: '10 ÷ (10 + minutes of walking and breaking through). Quicker to reach scores higher.', assumed: true },
  { key: 'safe', letter: 'H', label: 'Route safety', short: 'Safe route', def: '1 − metres of the route inside marked hazards ÷ 15 (never below 0).', assumed: true },
];
export const DEFAULT_WEIGHTS = { sure: 3, need: 3, wait: 2, access: 2, safe: 1 };
export const PRESETS = [
  { id: 'balanced', label: 'Balanced', w: DEFAULT_WEIGHTS },
  { id: 'need', label: 'Need first', w: { sure: 2, need: 5, wait: 3, access: 0.5, safe: 0.5 } },
  { id: 'reach', label: 'Fastest reach', w: { sure: 2, need: 1, wait: 1, access: 5, safe: 1 } },
  { id: 'safe', label: 'Safest route', w: { sure: 2, need: 1.5, wait: 1, access: 1.5, safe: 5 } },
];

// ---------- cached planning ----------
// The planner runs A* on a 240 x 180 grid. Results are remembered until the planning grid itself changes
// (a new hazard, a different avoid setting, a reset), which the simulator signals by replacing sim.grid.
let cacheGrid = null; const cache = new Map();
const r4 = (p) => (Math.round(p[0] * 4) / 4) + ',' + (Math.round(p[1] * 4) / 4);
export function planCached(sim, from, to, nearest = true) {
  if (sim.grid !== cacheGrid) { cacheGrid = sim.grid; cache.clear(); }
  const k = r4(from) + '>' + r4(to) + (nearest ? 'n' : '');
  let res = cache.get(k);
  if (!res) { res = sim.plan(from, to, { nearest }); cache.set(k, res); if (cache.size > 900) cache.delete(cache.keys().next().value); }
  return res;
}

export const allHazards = (state) => [...HAZARDS, ...(state.hazards || [])];

// Metres of a path inside each hazard, sampled every 0.25 m. spans = stretches along the path, for drawing.
export function exposureAlong(path, hazards) {
  const by = new Map(), spans = []; let total = 0, d = 0, open = null;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], len = dist(a, b), n = Math.max(1, Math.ceil(len / 0.25)), step = len / n;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const inside = hazards.filter((hz) => pointInPoly(p, hz.poly));
      for (const hz of inside) by.set(hz.id, (by.get(hz.id) || 0) + step);
      const worst = inside.find((hz) => hz.block) || inside[0] || null;
      if (inside.length) total += step;
      if ((worst?.id || null) !== (open?.hz.id || null)) { if (open) { open.to = d; spans.push(open); } open = worst ? { hz: worst, from: d, to: d } : null; }
      d += step;
    }
  }
  if (open) { open.to = d; spans.push(open); }
  return { total, length: d, by: [...by].map(([id, m]) => ({ hz: hazards.find((x) => x.id === id), m })).sort((p, q) => q.m - p.m), spans };
}

// Add the last stretch behind a wall (from the cut to the person) to a route's exposure. spans stay those of the walk.
export function withBehind(exposure, foot, pos, hazards) {
  const b = exposureAlong([foot, pos], hazards); if (!b.total) return { ...exposure, behind: 0 };
  const by = exposure.by.map((x) => ({ ...x }));
  for (const x of b.by) { const e = by.find((y) => y.hz.id === x.hz.id); if (e) e.m += x.m; else by.push({ ...x }); }
  return { ...exposure, total: exposure.total + b.total, by: by.sort((p, q) => q.m - p.m), behind: b.total };
}

// Doors the path goes through, with the distance along the path.
export function doorsAlong(path) {
  const out = []; let d = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], len = dist(a, b);
    for (const door of DOORS) {
      if (out.some((o) => o.door.id === door.id) || distToSeg(door.pos, a, b) > 0.75) continue;
      const t = len ? Math.max(0, Math.min(1, ((door.pos[0] - a[0]) * (b[0] - a[0]) + (door.pos[1] - a[1]) * (b[1] - a[1])) / (len * len))) : 0;
      out.push({ door, at: d + t * len });
    }
    d += len;
  }
  return out.sort((p, q) => p.at - q.at);
}

export function motionOf(det, state) {
  const sv = det.survivorId && state.survivors[det.survivorId];
  if (sv?.motion) return sv.motion;
  if (det.evidence.some((e) => e.sensor === 'radar' && e.result === 'pos')) return 'moving';
  if (det.evidence.some((e) => e.sensor === 'micro' && e.result === 'pos')) return 'still';
  return 'unknown';
}

export function whereOf(det) {
  if (det.outdoor) return 'Debris field, outdoors';
  const r = det.room && roomById(det.room);
  return r ? r.name : 'Inside building B';
}

function breachMinutes(wall) {
  if (!wall) return ASSUMED.breachMin.debris;
  return ASSUMED.breachMin[wall.mat] * (wall.state === 'damaged' ? ASSUMED.damagedFactor : 1);
}
// The standing wall nearest to p among those the straight line p-q passes through.
export function wallBetween(p, q) {
  const hit = wallsCrossed(p, q);
  if (!hit.length) return null;
  return hit.sort((a, b) => distToSeg(p, a.a, a.b) - distToSeg(p, b.a, b.b))[0];
}

// Everything the board needs for one person or open lead. from = where the rescue team is now.
export function describeTarget(sim, det, from) {
  const S = sim.state, hazards = allHazards(S);
  const sv = det.survivorId ? S.survivors[det.survivorId] : null;
  const res = planCached(sim, from, det.pos, true);
  const t = { id: det.id, det, survivor: sv, status: det.status, where: whereOf(det), p: det.p, motion: motionOf(det, S), sigma: det.posSigma ?? 1,
    reached: sv?.status === 'reached' || !!S.routes.rescue?.legs.some((l) => l.det === det.id && l.arrivedAt != null), reachedAt: sv?.reachedAt ?? null,
    routable: det.status === 'confirmed' || det.needsTeam, waitS: Math.max(0, S.t - det.t), ok: !!res.ok };
  if (!res.ok) return { ...t, kind: 'no route', reason: res.reason, length: Infinity, walkMin: Infinity, breachMin: 0, effortMin: Infinity, exposure: { total: 0, by: [], spans: [], length: 0 }, doors: [], path: null };
  const access = res.path[res.path.length - 1];
  const wall = res.reached ? null : wallBetween(access, det.pos);
  const through = res.reached ? 0 : dist(access, det.pos);
  const exposure = res.reached ? exposureAlong(res.path, hazards) : withBehind(exposureAlong(res.path, hazards), access, det.pos, hazards);
  const walkMin = res.length / TEAM_SPEED / 60, bMin = res.reached ? 0 : breachMinutes(wall);
  return { ...t, kind: res.reached ? 'walk in' : 'break through', path: res.path, access, length: res.length, wall, through, exposure, doors: doorsAlong(res.path), walkMin, breachMin: bMin, effortMin: walkMin + bMin };
}

export function scoreTarget(t, w) {
  const sum = TERMS.reduce((s, k) => s + (w[k.key] || 0), 0) || 1;
  const waitMin = t.waitS / 60;
  const v = {
    sure: t.p,
    need: ASSUMED.need[t.motion] ?? ASSUMED.need.unknown,
    wait: 1 - Math.exp(-waitMin / ASSUMED.waitTauMin),
    access: Number.isFinite(t.effortMin) ? ASSUMED.effortHalfMin / (ASSUMED.effortHalfMin + t.effortMin) : 0,
    safe: Math.max(0, 1 - t.exposure.total / ASSUMED.exposureFullM),
  };
  const seen = {
    sure: (t.p * 100).toFixed(0) + ' % after fusion',
    need: t.motion === 'still' ? 'Still: no movement seen' : t.motion === 'moving' ? 'Moving' : 'Movement not yet known',
    wait: waitMin.toFixed(1) + ' min since first reading',
    access: Number.isFinite(t.effortMin) ? t.effortMin.toFixed(1) + ' min of effort' : 'No route found',
    safe: t.exposure.total < 0.05 ? 'Route clear of marked hazards' : t.exposure.total.toFixed(1) + ' m inside hazards',
  };
  const terms = TERMS.map((k) => ({ ...k, value: v[k.key], weight: w[k.key] || 0, points: (100 * (w[k.key] || 0) * v[k.key]) / sum, seen: seen[k.key] }));
  return { total: terms.reduce((s, x) => s + x.points, 0), terms };
}

// ---------- breakthrough: compare the sides a team could come from ----------
const COMPASS = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'East' : 'West') : (dy > 0 ? 'North' : 'South'));
export function approachSides(sim, det, from) {
  const S = sim.state, hazards = allHazards(S), pos = det.pos, grid = sim.grid, out = [];
  const freeAt = (p) => { const c = grid.toCell(p); return c[0] >= 0 && c[1] >= 0 && c[0] < grid.w && c[1] < grid.h && !grid.blocked[c[1] * grid.w + c[0]]; };
  for (const wall of WALLS) {
    if (wall.state === 'collapsed') continue;
    const len = dist(wall.a, wall.b); if (len < 1.2) continue;
    if (distToSeg(pos, wall.a, wall.b) > 9) continue;
    const ux = (wall.b[0] - wall.a[0]) / len, uy = (wall.b[1] - wall.a[1]) / len;
    const s0 = Math.max(0.5, Math.min(len - 0.5, (pos[0] - wall.a[0]) * ux + (pos[1] - wall.a[1]) * uy));
    // the wall normal that points away from the person
    let nx = -uy, ny = ux; const foot0 = [wall.a[0] + ux * s0, wall.a[1] + uy * s0];
    if ((foot0[0] - pos[0]) * nx + (foot0[1] - pos[1]) * ny < 0) { nx = -nx; ny = -ny; }
    let best = null, why = 'No free place to stand on the far side of this wall.';
    for (const off of [0, -1, 1, -2, 2, -3, 3]) {
      const s = s0 + off; if (s < 0.5 || s > len - 0.5) continue;
      const foot = [wall.a[0] + ux * s, wall.a[1] + uy * s], stand = [foot[0] + nx * ASSUMED.standOffM, foot[1] + ny * ASSUMED.standOffM];
      const crossed = wallsCrossed(stand, pos);
      if (crossed.length !== 1 || crossed[0].id !== wall.id) { why = 'Another wall stands between this side and the person.'; continue; }
      const hzStand = hazards.filter((hz) => pointInPoly(stand, hz.poly) || pointInPoly(foot, hz.poly));
      if (hzStand.some((hz) => hz.block)) { why = 'The place to stand is inside “' + hzStand.find((hz) => hz.block).name + '”.'; continue; }
      if (!freeAt(stand)) { why = OBSTACLES.some((o) => !o.passable && pointInPoly(stand, o.poly)) ? 'Debris fills the place to stand.' : 'No free place to stand on the far side of this wall.'; continue; }
      const res = planCached(sim, from, stand, false);
      if (!res.ok) { why = 'The team has no safe way to this side.'; continue; }
      const debris = OBSTACLES.filter((o) => o.kind === 'rubble' && !o.passable && o.poly.some((q, i) => segIntersect(foot, pos, q, o.poly[(i + 1) % o.poly.length])));
      const exposure = withBehind(exposureAlong(res.path, hazards), foot, pos, hazards);
      const through = dist(foot, pos), walkMin = res.length / TEAM_SPEED / 60, bMin = breachMinutes(wall) + (debris.length ? ASSUMED.breachMin.debris : 0);
      best = { wall, foot, stand, offset: off, path: res.path, length: res.length, exposure, through, walkMin, breachMin: bMin, minutes: walkMin + bMin, debris, hzStand,
        rank: walkMin + bMin + exposure.total * ASSUMED.exposureMinPerM, usable: true };
      break;
    }
    const side = COMPASS(foot0[0] - pos[0], foot0[1] - pos[1]);
    const beyond = roomAt([foot0[0] + nx * 1.2, foot0[1] + ny * 1.2]);
    const label = side + ' wall, from ' + (beyond ? beyond.name.toLowerCase() : 'outside');
    out.push(best ? { ...best, side, label } : { wall, side, label, usable: false, why, foot: foot0, through: dist(foot0, pos), rank: Infinity });
  }
  // one row per side: keep the best wall section on each compass side
  const bySide = new Map();
  for (const a of out.sort((p, q) => p.rank - q.rank || p.through - q.through)) if (!bySide.has(a.side)) bySide.set(a.side, a);
  return [...bySide.values()].sort((p, q) => p.rank - q.rank || p.through - q.through);
}

// Where to cut, given how uncertain the person's position is. A rule of thumb, shown as assumed.
export function standOff(alt, sigma) {
  const r95 = 2 * sigma, clear = alt.through - r95;
  const need = ASSUMED.clearMarginM + 0.5;
  const sideways = clear >= need ? 0 : r95 + ASSUMED.clearMarginM;
  return { r95, clear, sideways, direct: sideways === 0,
    collapseZone: alt.wall.state === 'damaged' ? alt.wall.h * ASSUMED.collapseZoneFactor : null };
}

// ---------- resources: which team takes whom ----------
// Exact search for small problems: every way to split the people between N identical teams, every visiting order.
// Objective: the smallest priority-weighted waiting time (each person's time-to-reach multiplied by their score).
function* permutations(a, n = a.length) {
  if (n <= 1) { yield a.slice(); return; }
  for (let i = 0; i < n; i++) { yield* permutations(a, n - 1); const j = n % 2 ? 0 : i; [a[n - 1], a[j]] = [a[j], a[n - 1]]; }
}
export function travelMatrix(sim, from, targets) {
  const pts = [from, ...targets.map((t) => t.access || t.det.pos)], n = pts.length, m = Array.from({ length: n }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let j = 1; j < n; j++) {
    if (i === j) continue;
    if (i > 0 && j < i) { m[i][j] = m[j][i]; continue; }
    const res = planCached(sim, pts[i], pts[j], true);
    m[i][j] = res.ok ? res.length / TEAM_SPEED / 60 : 999;
  }
  return m;
}
function lineCost(order, m, targets, weights) {
  let t = 0, cur = 0, cost = 0; const stops = [];
  for (const i of order) {
    const walk = m[cur][i + 1], arrive = t + walk, reach = arrive + targets[i].breachMin;
    stops.push({ i, depart: t, arrive, reach, leave: reach + ASSUMED.onSiteMin });
    cost += weights[i] * reach; t = reach + ASSUMED.onSiteMin; cur = i + 1;
  }
  return { cost, stops };
}
export function assignTeams(sim, from, targets, scores, nTeams, fixedOrder = null) {
  const k = targets.length;
  if (!k) return { teams: [], makespan: 0, cost: 0, tried: 0 };
  const m = travelMatrix(sim, from, targets), w = targets.map((t, i) => Math.max(1, scores[i]));
  if (nTeams === 1 && fixedOrder) { const l = lineCost(fixedOrder, m, targets, w); return { teams: [l.stops], cost: l.cost, makespan: Math.max(...l.stops.map((s) => s.reach)), tried: 1, fixed: true }; }
  const bestLine = new Map(); let tried = 0;
  const lineFor = (mask) => {
    if (bestLine.has(mask)) return bestLine.get(mask);
    const ids = []; for (let i = 0; i < k; i++) if (mask & (1 << i)) ids.push(i);
    let best = { cost: Infinity, stops: [] };
    for (const perm of permutations(ids)) { tried++; const l = lineCost(perm, m, targets, w); if (l.cost < best.cost) best = l; }
    bestLine.set(mask, best); return best;
  };
  let best = null; const assign = new Array(k).fill(0);
  (function rec(i, used) {
    if (i === k) {
      const masks = new Array(used).fill(0); for (let j = 0; j < k; j++) masks[assign[j]] |= 1 << j;
      const lines = masks.map(lineFor), cost = lines.reduce((s, l) => s + l.cost, 0);
      const makespan = Math.max(...lines.flatMap((l) => l.stops.map((s) => s.reach)));
      if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) < 1e-9 && makespan < best.makespan)) best = { teams: lines.map((l) => l.stops), cost, makespan };
      return;
    }
    for (let t = 0; t <= Math.min(used, nTeams - 1); t++) { assign[i] = t; rec(i + 1, Math.max(used, t + 1)); } // identical teams: no mirror duplicates
  })(0, 0);
  return { ...best, tried };
}
