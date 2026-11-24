// The scenario world. Everything in the console (3-D twin, planner, sensors, fusion) reads this one description.
//
// Units: metres. 2-D points are [x, y] with x east and y north; the site is 120 m by 90 m with its origin at the
// south-west corner. In three.js use (x, height, -y) so north points away from the default camera.
//
// The setting is a training exercise placed in Timure, Nepal, after the Bhote Koshi flood of 26 August 2026. The
// valley, its terrain and the satellite imagery are real. This block of buildings, the people in it, the damage and
// every reading are INVENTED for the exercise.
// `truth` holds what is really there (people, decoys). Nothing outside app/core/sim.js may read `truth` to decide
// what the operator sees: the console must only show what the sensors found. The 3-D twin may draw truth only in
// the clearly labelled "Reveal ground truth" debug view.
import { segIntersect, pointInPoly, pointInRect, distToSeg, rectPoly, dist } from './geometry.js';

export const SEED = 20261121;

export const SITE = {
  w: 120, h: 90,
  name: 'Training exercise: flood response, Timure, Nepal. Block B.',
  place: 'Timure, Rasuwa, Nepal', event: 'Bhote Koshi flood, 26 August 2026 (the exercise is simulated)',
  // Where the site's south-west corner sits on the real map. x runs east, y runs north, in metres.
  anchor: { lat: 28.25285, lon: 85.36667 },
  staging: [26, 12], dronePad: [20, 17], entrance: [64, 27],
};

// Building B is the search target. One storey is searched.
export const BUILDING = { id: 'B', rect: [44, 30, 84, 58], wallHeight: 3.2 };

export const ROOMS = [
  { id: '101', name: 'Classroom 101', rect: [44, 30, 53, 42] },
  { id: '102', name: 'Classroom 102', rect: [53, 30, 62, 42] },
  { id: '103', name: 'Classroom 103', rect: [66, 30, 75, 42] },
  { id: '104', name: 'Classroom 104', rect: [75, 30, 84, 42] },
  { id: '109', name: 'Classroom 109', rect: [44, 46, 53, 58] },
  { id: '110', name: 'Science lab 110', rect: [53, 46, 62, 58] },
  { id: '111', name: 'Classroom 111', rect: [66, 46, 75, 58] },
  { id: '112', name: 'Classroom 112', rect: [75, 46, 84, 58] },
  { id: 'C-EW', name: 'Main corridor', rect: [44, 42, 84, 46], corridor: true },
  { id: 'C-S', name: 'Entrance hall', rect: [62, 30, 66, 42], corridor: true },
  { id: 'C-N', name: 'North stairwell', rect: [62, 46, 66, 58], corridor: true },
];

// Wall helper: a straight wall from a to b with door gaps cut out. gaps are [from, to] distances along the wall.
function wall(a, b, mat, gaps = [], state = 'intact') {
  const len = dist(a, b), ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const out = [];
  let s = 0;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g0 > s) out.push({ a: [a[0] + ux * s, a[1] + uy * s], b: [a[0] + ux * g0, a[1] + uy * g0], mat, state });
    s = g1;
  }
  if (s < len) out.push({ a: [a[0] + ux * s, a[1] + uy * s], b: [b[0], b[1]], mat, state });
  return out;
}

const DOOR = 1.4; // door width, m
export const DOORS = [
  { id: 'entrance', room: 'C-S', pos: [64, 30], w: 2.4 },
  { id: 'd101', room: '101', pos: [48.6, 42], w: DOOR }, { id: 'd102', room: '102', pos: [57.6, 42], w: DOOR },
  { id: 'd103', room: '103', pos: [70.6, 42], w: DOOR }, { id: 'd104', room: '104', pos: [79.6, 42], w: DOOR, blocked: true },
  { id: 'd109', room: '109', pos: [48.6, 46], w: DOOR }, { id: 'd110', room: '110', pos: [57.6, 46], w: DOOR },
  { id: 'd111', room: '111', pos: [70.6, 46], w: DOOR }, { id: 'd112', room: '112', pos: [79.6, 46], w: DOOR, blocked: true },
];
const gap = (c, w = DOOR) => [c - w / 2, c + w / 2];

export const WALLS = [
  // Outer shell (concrete). The south wall has the entrance; the north-east corner has collapsed.
  ...wall([44, 30], [84, 30], 'concrete', [gap(20, 2.4)]),
  ...wall([44, 30], [44, 58], 'concrete'),
  ...wall([44, 58], [78, 58], 'concrete'),
  ...wall([78, 58], [84, 58], 'concrete', [], 'collapsed'),
  ...wall([84, 30], [84, 50], 'concrete'),
  ...wall([84, 50], [84, 58], 'concrete', [], 'collapsed'),
  // Corridor walls (drywall) with the room doors.
  ...wall([44, 42], [62, 42], 'drywall', [gap(4.6), gap(13.6)]),
  ...wall([66, 42], [84, 42], 'drywall', [gap(4.6), gap(13.6)]),
  ...wall([44, 46], [62, 46], 'drywall', [gap(4.6), gap(13.6)]),
  ...wall([66, 46], [84, 46], 'drywall', [gap(4.6), gap(13.6)]),
  // Partitions between rooms (drywall).
  ...wall([53, 30], [53, 42], 'drywall'), ...wall([62, 30], [62, 42], 'drywall', [gap(9)]),
  ...wall([66, 30], [66, 42], 'drywall', [gap(9)]), ...wall([75, 30], [75, 42], 'drywall'),
  ...wall([53, 46], [53, 58], 'drywall'), ...wall([62, 46], [62, 58], 'drywall', [gap(3)]),
  ...wall([66, 46], [66, 58], 'drywall', [gap(3)]), ...wall([75, 46], [75, 58], 'drywall', [], 'damaged'),
].map((w, i) => ({ id: 'W' + (i + 1), h: BUILDING.wallHeight, ...w }));

// Things the rover cannot drive through, other than walls.
export const OBSTACLES = [
  { id: 'rubble-corridor', kind: 'rubble', name: 'Corridor blocked by flood debris', poly: [[76, 42], [79.2, 42], [79.4, 46], [75.8, 46]], h: 1.4 },
  { id: 'rubble-ne', kind: 'rubble', name: 'Collapsed roof and mud, north-east corner', poly: [[80, 52], [84, 50], [86, 55], [84, 60], [78, 60], [78.5, 55]], h: 2.2 },
  { id: 'rubble-field', kind: 'rubble', name: 'Debris field left by the flood', poly: [[90, 64], [102, 62], [106, 70], [100, 77], [90, 75]], h: 0.9, passable: true },
  { id: 'bldg-a', kind: 'building', name: 'Building A (standing)', poly: rectPoly([8, 40, 34, 70]), h: 7 },
  { id: 'bldg-c', kind: 'building', name: 'Building C (damaged)', poly: rectPoly([92, 20, 112, 46]), h: 6 },
  { id: 'desk-103', kind: 'furniture', name: 'Overturned desks', poly: [[69, 35.5], [73.5, 35.5], [73.5, 36.6], [69, 36.6]], h: 0.9 },
];

// Areas that are dangerous to cross. `cost` multiplies the planner's step cost; `block` forbids crossing.
export const HAZARDS = [
  { id: 'hz-slope-ne', kind: 'slope', name: 'Unstable slope above the block', poly: [[72, 48], [90, 46], [92, 62], [74, 62]], cost: 6 },
  { id: 'hz-collapse', kind: 'collapse', name: 'Undercut wall: collapse risk', poly: [[78, 50], [86, 49], [87, 60], [78, 60]], block: true },
  { id: 'hz-mud-c', kind: 'mud', name: 'Deep mud and flood debris', poly: [[88, 16], [116, 16], [116, 50], [88, 50]], cost: 6 },
  { id: 'hz-gas', kind: 'gas', name: 'Possible gas cylinder leak by lab 110 (concept sensor)', poly: [[54, 54], [60, 54], [60, 58], [54, 58]], cost: 3 },
];

// What is really there. Read only by the simulator (see the note at the top of this file).
export const TRUTH = {
  people: [
    { id: 'P1', pos: [77.6, 51], room: '112', motion: 'moving', posture: 'standing', wall: 'drywall', note: 'Trapped behind the damaged partition, 2.6 m past the wall of room 111.' },
    { id: 'P2', pos: [71.4, 34.2], room: '103', motion: 'still', posture: 'lying', wall: 'none', note: 'Lying still behind overturned desks. Breathing only.' },
    { id: 'P3', pos: [96.5, 70], room: null, motion: 'still', posture: 'lying', wall: 'none', outdoors: true, note: 'In the debris field north-east of the building, partly covered.' },
  ],
  decoys: [
    { id: 'X1', kind: 'fan', pos: [57, 38.5], room: '102', note: 'A desk fan left running on backup power.' },
    { id: 'X2', kind: 'heat', pos: [58, 49.8], room: '110', note: 'A hot water pipe in the lab.' },
  ],
};

// Where the rover stops to listen. Each stop is 10 s per Wi-Fi window, because the network needs 10 s of signal
// and cannot listen while the rover drives.
export const STOPS = [
  { id: 'S1', pos: [57.6, 44], label: 'Corridor, by 102 and 110', covers: ['102', '110'] },
  { id: 'S2', pos: [48.6, 44], label: 'Corridor, west end', covers: ['101', '109'] },
  { id: 'S3', pos: [70.6, 38.4], label: 'Room 103, inside the door', covers: ['103'] },
  { id: 'S4', pos: [73.4, 51], label: 'Room 111, east wall', covers: ['111', '112'] },
];

export const UNITS = [
  { id: 'HOUND-01', kind: 'rover', name: 'HOUND-01', home: SITE.staging, speed: 0.42, built: true },
  { id: 'DRONE-01', kind: 'drone', name: 'Scout drone', home: SITE.dronePad, speed: 8, alt: 30, built: false },
  { id: 'TEAM-1', kind: 'team', name: 'Rescue team 1', home: [22, 9], speed: 1.1, built: false },
];

// Sensor reach used by the simulator. `assumed: true` means the number is a design assumption, not a measurement.
export const SENSORS = {
  csi: { name: 'Wi-Fi CSI + neural network', range: 6.5, maxWalls: 1, windowS: 10, assumed: false },
  radar: { name: 'LD2450 24 GHz radar', range: 6, maxWalls: 1, fovDeg: 120, assumed: true },
  micro: { name: 'LD2410C presence radar', range: 4.5, maxWalls: 1, assumed: true },
  thermal: { name: 'MLX90640 thermal camera', range: 7, maxWalls: 0, fovDeg: 110, px: [32, 24], assumed: true },
  tof: { name: 'VL53L1X distance', range: 4, assumed: true },
};

// ---- queries ----
export function roomAt(p) { return ROOMS.find((r) => pointInRect(p, r.rect)) || null; }
export function roomById(id) { return ROOMS.find((r) => r.id === id) || null; }

// The standing or damaged walls that the straight line p-q passes through.
export function wallsCrossed(p, q) {
  return WALLS.filter((w) => w.state !== 'collapsed' && segIntersect(p, q, w.a, w.b));
}

// True when nothing solid is between p and q (no wall, rubble pile or furniture taller than 0.8 m).
export function lineOfSight(p, q) {
  if (wallsCrossed(p, q).length) return false;
  for (const o of OBSTACLES) {
    if (o.h < 0.8) continue;
    const poly = o.poly;
    for (let i = 0; i < poly.length; i++) if (segIntersect(p, q, poly[i], poly[(i + 1) % poly.length])) return false;
  }
  return true;
}

// How well a camera at p can see q: 'clear', 'partial' (only low furniture in the way) or 'blocked'.
export function sightline(p, q) {
  if (wallsCrossed(p, q).length) return 'blocked';
  let partial = false;
  for (const o of OBSTACLES) {
    if (o.h < 0.8) continue;
    const poly = o.poly;
    let hit = false;
    for (let i = 0; i < poly.length; i++) if (segIntersect(p, q, poly[i], poly[(i + 1) % poly.length])) { hit = true; break; }
    if (!hit) continue;
    if (o.h < 1.2) partial = true; else return 'blocked';
  }
  return partial ? 'partial' : 'clear';
}

export function hazardsAt(p) { return HAZARDS.filter((h) => pointInPoly(p, h.poly)); }

// A grid for path planning. blocked[i] = 1 where the rover cannot go; cost[i] >= 1 is the price of entering a cell.
// `extra` lets callers add hazards (an aftershock, a new blockage) without changing the world.
export function buildGrid({ res = 0.5, clearance = 0.4, extraHazards = [], avoid = { slope: true, mud: true, gas: true, collapse: true } } = {}) {
  const w = Math.round(SITE.w / res), h = Math.round(SITE.h / res);
  const blocked = new Uint8Array(w * h), cost = new Float32Array(w * h).fill(1);
  const hazards = [...HAZARDS, ...extraHazards];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const p = [(i + 0.5) * res, (j + 0.5) * res], k = j * w + i;
      for (const wl of WALLS) {
        if (wl.state === 'collapsed') continue;
        if (distToSeg(p, wl.a, wl.b) < clearance) { blocked[k] = 1; break; }
      }
      if (blocked[k]) continue;
      for (const o of OBSTACLES) if (!o.passable && pointInPoly(p, o.poly)) { blocked[k] = 1; break; }
      if (blocked[k]) continue;
      for (const hz of hazards) {
        if (!pointInPoly(p, hz.poly)) continue;
        if (hz.block && avoid.collapse !== false) { blocked[k] = 1; break; }
        if (avoid[hz.kind] !== false && hz.cost) cost[k] = Math.max(cost[k], hz.cost);
      }
    }
  }
  return { res, w, h, blocked, cost, toCell: (p) => [Math.floor(p[0] / res), Math.floor(p[1] / res)], toPoint: (c) => [(c[0] + 0.5) * res, (c[1] + 0.5) * res] };
}

export const world = { SEED, SITE, BUILDING, ROOMS, DOORS, WALLS, OBSTACLES, HAZARDS, STOPS, UNITS, SENSORS, roomAt, roomById, wallsCrossed, lineOfSight, sightline, hazardsAt, buildGrid };
export default world;
