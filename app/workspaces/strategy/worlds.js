// A lightweight generator of random search problems: a damaged building with a corridor, rooms on both sides,
// doors (some blocked), sometimes a rubble pile across the corridor, people and decoys. Every world uses the same
// sensor model as the live map (model.js). The map of a world is coarse: each room is cut into zones about 3 m
// across, and each zone is one cell of the belief.
//
// What is drawn at random (all of it ASSUMED; these are trial worlds, not data about real buildings):
//   5 to 7 pairs of rooms, each 6 to 9 m wide and 8 to 11 m deep, a 4 m corridor, the entrance at its west end
//   each door blocked with probability 0.2; a rubble pile the rover cannot pass in 15 % of worlds
//   people: each room holds one with probability 0.10 (the console's prior, core/fusion.js), the corridor 0.02 in
//           total; 40 % of people are moving (the mix of the network's test set)
//   decoys: a running fan in 20 % of rooms, a hot pipe in 15 %. A fan changes the Wi-Fi false-alarm rate to the
//           measured with-fan value, and each decoy slips past the console's machine / temperature check one time
//           in ten (assumed), when it shows up as a radar or thermal report.
// The planner never sees the decoys or the people: only what the sensors say.
import { mulberry32 } from '../../core/geometry.js';
import { flatWalls, traceReach, makeBelief, ROVER_SPEED } from './model.js';

export const PRIOR_ROOM = 0.1, PRIOR_CORRIDOR = 0.02, P_FAN = 0.2, P_HEAT = 0.15, DECOY_SLIP = 0.1;
export const TEAM_SPEED = 1.1, TEAM_CHECK_S = 45, TEAM_BREACH_S = 90;

const DOOR = 1.4;
function wallWithGaps(a, b, gaps) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, out = [];
  let s = 0;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) { if (g0 > s) out.push({ a: [a[0] + ux * s, a[1] + uy * s], b: [a[0] + ux * g0, a[1] + uy * g0] }); s = g1; }
  if (s < len) out.push({ a: [a[0] + ux * s, a[1] + uy * s], b: [b[0], b[1]] });
  return out;
}

// The layout only (no people). Deterministic in the seed.
export function generateLayout(seed) {
  const rng = mulberry32((seed * 2654435761) >>> 0);
  const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const pairs = ri(5, 7), x0 = 14, y0 = 6, dS = ri(8, 11), dN = ri(8, 11), cw = 4;
  const widths = Array.from({ length: pairs }, () => ri(6, 9)), L = widths.reduce((s, w) => s + w, 0);
  const yc0 = y0 + dS, yc1 = yc0 + cw, yTop = yc1 + dN, ycm = (yc0 + yc1) / 2;
  const rooms = [], walls = [];
  let x = x0;
  const sGaps = [], nGaps = [];
  for (let i = 0; i < pairs; i++) {
    const w = widths[i];
    for (const side of ['S', 'N']) {
      const dx = 1.2 + rng() * (w - 2.4), blocked = rng() < 0.2;
      const rect = side === 'S' ? [x, y0, x + w, yc0] : [x, yc1, x + w, yTop];
      const door = [x + dx, side === 'S' ? yc0 : yc1];
      rooms.push({ id: (side === 'S' ? 100 : 200) + i + 1 + '', name: 'Room ' + ((side === 'S' ? 100 : 200) + i + 1), rect, side, pair: i, door, blocked, corridor: false });
      if (!blocked) (side === 'S' ? sGaps : nGaps).push([x - x0 + dx - DOOR / 2, x - x0 + dx + DOOR / 2]);
    }
    if (i > 0) walls.push({ a: [x, y0], b: [x, yc0] }, { a: [x, yc1], b: [x, yTop] });
    x += w;
  }
  const x1 = x0 + L;
  rooms.push({ id: 'C', name: 'Corridor', rect: [x0, yc0, x1, yc1], corridor: true, door: null, blocked: false });
  walls.push({ a: [x0, y0], b: [x1, y0] }, { a: [x0, yTop], b: [x1, yTop] }, { a: [x1, y0], b: [x1, yTop] });
  walls.push({ a: [x0, y0], b: [x0, yc0] }, { a: [x0, yc1], b: [x0, yTop] });           // west wall, open across the corridor (the entrance)
  walls.push(...wallWithGaps([x0, yc0], [x1, yc0], sGaps), ...wallWithGaps([x0, yc1], [x1, yc1], nGaps));
  let rubble = null;
  if (rng() < 0.15) { const k = ri(2, pairs - 1); let rx = x0; for (let i = 0; i < k; i++) rx += widths[i]; rx += -1 + rng() * 2; rubble = { x0: rx - 1, x1: rx + 1, poly: [[rx - 1, yc0], [rx + 1, yc0], [rx + 1, yc1], [rx - 1, yc1]] }; }
  return { seed, w: x1 + 6, h: yTop + 6, rooms, walls, rubble, start: [x0 - 10, ycm], entrance: [x0, ycm], x0, x1, yc0, yc1, ycm, pairs, widths };
}

// Zones, candidate stops, travel times and the prior. Sensor reach is added by withSensors().
export function buildWorld(layout) {
  const { rooms, walls, rubble, start, x0, x1, yc0, yc1, ycm } = layout;
  const zones = [];
  rooms.forEach((r, ri) => {
    const w = r.rect[2] - r.rect[0], hh = r.rect[3] - r.rect[1];
    const nx = r.corridor ? Math.max(1, Math.round(w / 4)) : Math.max(1, Math.round(w / 3)), ny = r.corridor ? 1 : Math.max(1, Math.round(hh / 3));
    r.zones = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const rect = [r.rect[0] + (w * i) / nx, r.rect[1] + (hh * j) / ny, r.rect[0] + (w * (i + 1)) / nx, r.rect[1] + (hh * (j + 1)) / ny];
      r.zones.push(zones.length); zones.push({ room: ri, rect, c: [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2] });
    }
  });
  const n = zones.length, cx = new Float32Array(n), cy = new Float32Array(n), zoneRoom = new Int16Array(n);
  zones.forEach((z, i) => { cx[i] = z.c[0]; cy[i] = z.c[1]; zoneRoom[i] = z.room; });
  const geom = { n, cx, cy, walls: flatWalls(walls), blocks: rubble ? [{ poly: rubble.poly, partial: false }] : [] };

  // Candidate stops. kind: 'route' (the fixed route: one per pair of rooms), 'door' (corridor, at a door),
  // 'inside' (just inside an open door), 'deep' (middle of a room).
  const stops = [], pushStop = (s) => { s.i = stops.length; stops.push(s); return s; };
  const side = (px) => (!rubble ? 0 : px < rubble.x0 ? 0 : px > rubble.x1 ? 1 : -1);
  let x = x0;
  for (let i = 0; i < layout.pairs; i++) {
    const cxm = x + layout.widths[i] / 2; x += layout.widths[i];
    if (side(cxm) !== -1) pushStop({ id: 'F' + (i + 1), kind: 'route', pos: [cxm, ycm], region: 'C', pair: i, label: 'Corridor, by ' + (101 + i) + ' and ' + (201 + i) });
  }
  rooms.forEach((r, ri) => {
    if (r.corridor) return;
    if (side(r.door[0]) !== -1 && !stops.some((s) => s.region === 'C' && Math.abs(s.pos[0] - r.door[0]) < 1.5)) pushStop({ id: 'D' + r.id, kind: 'door', pos: [r.door[0], ycm], region: 'C', label: 'Corridor, at the door of ' + r.id });
    if (!r.blocked && side(r.door[0]) !== -1) {
      const inY = r.side === 'S' ? r.door[1] - 1.6 : r.door[1] + 1.6;
      r.inside = pushStop({ id: 'I' + r.id, kind: 'inside', pos: [r.door[0], inY], region: ri, room: ri, label: 'Room ' + r.id + ', inside the door' }).i;
      pushStop({ id: 'M' + r.id, kind: 'deep', pos: [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2], region: ri, room: ri, label: 'Room ' + r.id + ', middle' });
    } else r.inside = -1;
  });

  // Travel: every stop sits in a convex region (a room or one side of the corridor); regions meet at open doors.
  // Shortest paths on that small graph, by Floyd-Warshall. Node 0 is the start outside the entrance.
  const nodes = [{ pos: start, region: 'C', cside: 0 }];
  for (const s of stops) nodes.push({ pos: s.pos, region: s.region, cside: s.region === 'C' ? side(s.pos[0]) : null, stop: s.i });
  rooms.forEach((r, ri) => { if (!r.corridor) { r.doorNode = nodes.length; nodes.push({ pos: r.door, region: 'door', room: ri, cside: side(r.door[0]), open: !r.blocked }); } });
  const N = nodes.length, D = new Float32Array(N * N).fill(Infinity), Dteam = new Float32Array(N * N).fill(Infinity);
  const dist = (a, b) => Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]);
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    if (a === b) { D[a * N + b] = 0; Dteam[a * N + b] = 0; continue; }
    const A = nodes[a], B = nodes[b]; let rover = false, team = false;
    const inC = (p) => p.region === 'C' || p.region === 'door';
    if (inC(A) && inC(B)) { team = true; rover = A.cside !== -1 && A.cside === B.cside && (A.region !== 'door' || A.open) && (B.region !== 'door' || B.open); }
    else if (A.region === 'door' && B.region === A.room) { team = true; rover = A.open; }
    else if (B.region === 'door' && A.region === B.room) { team = true; rover = B.open; }
    else if (A.region === B.region && typeof A.region === 'number') { team = true; rover = true; }
    if (rover) D[a * N + b] = dist(A, B);
    if (team) Dteam[a * N + b] = dist(A, B) + ((A.region === 'door' && !A.open && typeof B.region === 'number') || (B.region === 'door' && !B.open && typeof A.region === 'number') ? TEAM_BREACH_S * TEAM_SPEED : 0);
  }
  for (const M of [D, Dteam]) for (let k = 0; k < N; k++) for (let a = 0; a < N; a++) { const ak = M[a * N + k]; if (ak === Infinity) continue; for (let b = 0; b < N; b++) { const v = ak + M[k * N + b]; if (v < M[a * N + b]) M[a * N + b] = v; } }
  // Seconds between stops for the rover (index 0 = start, i + 1 = stop i), and for the team between room doors.
  const nS = stops.length, travel = new Float32Array((nS + 1) * (nS + 1));
  for (let a = 0; a <= nS; a++) for (let b = 0; b <= nS; b++) travel[a * (nS + 1) + b] = D[a * N + b] / ROVER_SPEED;
  const reachable = stops.map((s) => D[0 * N + (s.i + 1)] < Infinity);
  const nR = rooms.length, teamT = new Float32Array((nR + 1) * (nR + 1)); // index 0 = start, r + 1 = room r (its door; the corridor counts as its middle)
  const teamNode = (k) => (k === 0 ? 0 : rooms[k - 1].corridor ? -1 : rooms[k - 1].doorNode);
  for (let a = 0; a <= nR; a++) for (let b = 0; b <= nR; b++) {
    const na = teamNode(a), nb = teamNode(b);
    const pa = na < 0 ? { pos: [(x0 + x1) / 2, ycm] } : nodes[na], pb = nb < 0 ? { pos: [(x0 + x1) / 2, ycm] } : nodes[nb];
    let d = na >= 0 && nb >= 0 ? Dteam[na * N + nb] : dist(pa, pb);
    if (b > 0 && !rooms[b - 1].corridor && rooms[b - 1].blocked) d += TEAM_BREACH_S * TEAM_SPEED;
    teamT[a * (nR + 1) + b] = d / TEAM_SPEED;
  }
  const prior = makeBelief(n);
  rooms.forEach((r) => { const p = (r.corridor ? PRIOR_CORRIDOR : PRIOR_ROOM) / r.zones.length; for (const z of r.zones) { prior.pm[z] = p * 0.4; prior.ps[z] = p * 0.6; } });
  const route = stops.filter((s) => s.kind === 'route' && reachable[s.i]).map((s) => s.i);
  return { ...layout, zones, zoneRoom, geom, stops, travel, teamT, reachable, prior, route, nRooms: nR };
}

// Trace what every stop can sense under a sensor model, and cache it on a shallow copy of the world.
export function withSensors(world, S) {
  const reach = world.stops.map((s) => traceReach(world.geom, s.pos, S));
  const slotOf = reach.map((r) => { const m = new Int16Array(world.zones.length).fill(-1); for (let k = 0; k < r.n; k++) m[r.idx[k]] = k; return m; });
  const prior = makeBelief(world.zones.length);
  world.rooms.forEach((r) => { const p = (r.corridor ? PRIOR_CORRIDOR : PRIOR_ROOM) / r.zones.length; for (const z of r.zones) { prior.pm[z] = p * S.pMove; prior.ps[z] = p * (1 - S.pMove); } });
  return { ...world, S, reach, slotOf, prior };
}

// Who is really there. Drawn from exactly the prior the planner starts with, so its map is honest on average.
export function populate(world, seed) {
  const rng = mulberry32((seed * 40503 + 977) >>> 0), people = [], fans = [], heats = [];
  world.rooms.forEach((r, ri) => {
    const pr = r.corridor ? PRIOR_CORRIDOR : PRIOR_ROOM;
    if (rng() < pr) { const z = r.zones[Math.floor(rng() * r.zones.length)], zr = world.zones[z].rect; people.push({ id: 'P' + (people.length + 1), zone: z, room: ri, moving: rng() < 0.4, pos: [zr[0] + 0.4 + rng() * (zr[2] - zr[0] - 0.8), zr[1] + 0.4 + rng() * (zr[3] - zr[1] - 0.8)] }); }
    if (!r.corridor && rng() < P_FAN) fans.push({ zone: r.zones[Math.floor(rng() * r.zones.length)], room: ri });
    if (!r.corridor && rng() < P_HEAT) heats.push({ zone: r.zones[Math.floor(rng() * r.zones.length)], room: ri });
  });
  return { people, fans, heats };
}

export function makeWorld(seed, S) { return withSensors(buildWorld(generateLayout(seed)), S); }
