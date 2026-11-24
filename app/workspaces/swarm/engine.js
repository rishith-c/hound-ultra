// Swarm sandbox engine. A self-contained multi-robot search simulation, separate from the main mission.
//
// WHAT IS REAL AND WHAT IS NOT
//   Real (live algorithm): frontier detection and clustering on a shared occupancy grid, three assignment
//     strategies (nearest frontier, greedy auction, Hungarian), the lead auction, the radio-mesh routing and relay
//     drops, and the battery scheduler. They run here, step by step, and every metric is measured from the run.
//   Simulated: the site (generated from a seed), the robots' motion and sensors, the people and decoys.
//   Assumed: the radio model, the power draw, the sensor reach and every likelihood except the Wi-Fi network's
//     (see PARAMS; the UI marks them). Only one rover exists, so the fleet itself is a concept.
//
// No DOM in this file: it also runs inside a Web Worker for the benchmark.
import { fuse, classify } from '../../core/fusion.js';

export const W = 240, H = 180, RES = 0.5;            // 120 m by 90 m, 0.5 m cells
export const T = { FREE: 0, CONCRETE: 1, DRYWALL: 2, RUBBLE: 3, FURN: 4, VEHICLE: 5, EDGE: 6 };   // EDGE: the site boundary
export const K = { UNKNOWN: 0, FREE: 1, OCC: 2, ROOF: 3 };   // what the fleet knows about a cell
export const DT = 0.5;                                // simulated seconds per step

export const PARAMS = {
  rover: { speed: 0.42, lidar: 6, capWh: 24.4, hotelW: 9, driveW: 20, relays: 8, swapS: 40 },
  drone: { speed: 4, footprint: 8, capWh: 30, flyW: 180, relays: 3, swapS: 25, alt: 11 },
  radio: { p1m: -40, exponent: 2.8, rxMin: -88, drop: -82, loss: { 1: 10, 2: 3, 3: 6, 4: 2, 5: 5, 6: 0 } },
  energy: { reserve: 0.08, margin: 1.3, window: 0.12 },
  cue: { radarRange: 6, radarWalls: 1, thermalRange: 7, droneRange: 8 },
  bid: { time: 0.5, battery: 0.2, fit: 0.3 },
  listenS: 20,
};

export const STRATEGIES = {
  nearest: { label: 'Nearest frontier', short: 'Nearest', does: 'Each robot drives to the frontier closest to itself. Nobody coordinates, so two robots often chase the same one.' },
  greedy: { label: 'Greedy auction', short: 'Greedy', does: 'The cheapest robot-and-frontier pair is awarded first, then the next. Frontiers near an awarded one cost more.' },
  hungarian: { label: 'Hungarian assignment', short: 'Hungarian', does: 'One optimal matching of robots to frontiers that minimises the total distance driven, solved again whenever the map changes.' },
};
export const LAYOUTS = {
  campus: { label: 'School campus', does: 'Six to seven separate buildings with corridors and classrooms.' },
  market: { label: 'Market street', does: 'Four rows of small shops facing two streets, with alleys.' },
  hospital: { label: 'Hospital', does: 'One large building with long corridors and three wings.' },
  blockb: { label: 'Block B (the exercise site)', does: 'Building B from the main exercise with its real wall plan; buildings A and C get generated interiors.' },
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const cx = (i) => (i + 0.5) * RES;
const cellOf = (x, y) => Math.min(H - 1, Math.max(0, Math.floor(y / RES))) * W + Math.min(W - 1, Math.max(0, Math.floor(x / RES)));

// ------------------------------------------------------------------------------------------------------------
// World generation
// ------------------------------------------------------------------------------------------------------------
export function genWorld({ layout = 'campus', seed = 1, blockB = null } = {}) {
  if (layout === 'blockb' && !blockB) layout = 'campus';
  const rng = mulberry32((seed * 2654435761 + { campus: 11, market: 23, hospital: 37, blockb: 51 }[layout]) >>> 0);
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const solid = new Uint8Array(W * H), indoor = new Uint8Array(W * H);
  const buildings = [];
  const inb = (i, j) => i >= 0 && j >= 0 && i < W && j < H;
  const set = (i, j, v) => { if (inb(i, j)) solid[j * W + i] = v; };
  const get = (i, j) => (inb(i, j) ? solid[j * W + i] : T.CONCRETE);
  let base = [10, 8];

  // One building: outer concrete shell, then either a double-loaded corridor with rooms or a recursive split.
  function addBuilding(x0, y0, x1, y1, opt = {}) {
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) { indoor[j * W + i] = 1; solid[j * W + i] = (i === x0 || i === x1 || j === y0 || j === y1) ? T.CONCRETE : T.FREE; }
    const b = { id: buildings.length, name: 'Building ' + String.fromCharCode(65 + buildings.length), rect: [x0 * RES, y0 * RES, (x1 + 1) * RES, (y1 + 1) * RES], cells: [x0, y0, x1, y1] };
    buildings.push(b);
    const iw = x1 - x0 - 1, ih = y1 - y0 - 1;
    const horiz = iw >= ih;
    // put(a, b): a runs along the long axis, b across it
    const put = (a, bb, v) => (horiz ? set(a, bb, v) : set(bb, a, v));
    const at = (a, bb) => (horiz ? get(a, bb) : get(bb, a));
    const a0 = (horiz ? x0 : y0) + 1, a1 = (horiz ? x1 : y1) - 1, b0 = (horiz ? y0 : x0) + 1, b1 = (horiz ? y1 : x1) - 1;
    if (Math.min(iw, ih) >= 18 && Math.max(iw, ih) >= 30 && !opt.simple) {
      const bc = Math.floor((b0 + b1) / 2);                 // corridor occupies bc-2 .. bc+1
      for (let a = a0; a <= a1; a++) { put(a, bc - 3, T.DRYWALL); put(a, bc + 2, T.DRYWALL); }
      for (const side of [0, 1]) {
        let a = a0;
        while (a <= a1) {
          let w = ri(9, 15); if (a1 - (a + w) < 9) w = a1 - a + 1;
          const end = a + w - 1;                              // room spans a .. end, partition at end + 1
          if (end < a1) for (let bb = side ? bc + 3 : b0; bb <= (side ? b1 : bc - 4); bb++) put(end + 1, bb, T.DRYWALL);
          const d = ri(a + 1, Math.max(a + 1, end - 2));
          put(d, side ? bc + 2 : bc - 3, T.FREE); put(d + 1, side ? bc + 2 : bc - 3, T.FREE);
          a = end + 2;
        }
      }
      const ends = opt.ends || (rng() < 0.6 ? 'both' : rng() < 0.5 ? 'low' : 'high');
      for (const bb of [bc - 2, bc - 1, bc]) { if (ends !== 'high') put(a0 - 1, bb, T.FREE); if (ends !== 'low') put(a1 + 1, bb, T.FREE); }
      b.kind = 'corridor';
    } else {
      const split = (xa, ya, xb, yb) => {
        const w = xb - xa + 1, h = yb - ya + 1;
        if (w <= 15 && h <= 15) return;
        if (w >= h && w >= 14) {
          const x = xa + ri(6, w - 7);
          for (let j = ya; j <= yb; j++) set(x, j, T.DRYWALL);
          const d = ri(ya + 1, Math.max(ya + 1, yb - 2)); set(x, d, T.FREE); set(x, d + 1, T.FREE);
          split(xa, ya, x - 1, yb); split(x + 1, ya, xb, yb);
        } else if (h >= 14) {
          const y = ya + ri(6, h - 7);
          for (let i = xa; i <= xb; i++) set(i, y, T.DRYWALL);
          const d = ri(xa + 1, Math.max(xa + 1, xb - 2)); set(d, y, T.FREE); set(d + 1, y, T.FREE);
          split(xa, ya, xb, y - 1); split(xa, y + 1, xb, yb);
        }
      };
      split(x0 + 1, y0 + 1, x1 - 1, y1 - 1);
      const sides = opt.doorSide ? [opt.doorSide] : ['s', 'n', 'e', 'w'].sort(() => rng() - 0.5).slice(0, ri(1, 2));
      for (const s of sides) {
        for (let tries = 0; tries < 30; tries++) {
          const horizSide = s === 's' || s === 'n';
          const p = horizSide ? ri(x0 + 2, x1 - 4) : ri(y0 + 2, y1 - 4);
          const cells = [0, 1, 2].map((q) => (horizSide ? [p + q, s === 's' ? y0 : y1, p + q, s === 's' ? y0 + 1 : y1 - 1] : [s === 'w' ? x0 : x1, p + q, s === 'w' ? x0 + 1 : x1 - 1, p + q]));
          if (!cells.every((c) => get(c[2], c[3]) === T.FREE)) continue;
          cells.forEach((c) => set(c[0], c[1], T.FREE)); break;
        }
      }
      b.kind = 'rooms';
    }
    // furniture: only where there is clear floor all around, so it never blocks a door or a corridor
    const tries = Math.floor((iw * ih) / 70);
    for (let q = 0; q < tries; q++) {
      const fw = ri(2, 5), fh = ri(1, 2), sw = rng() < 0.5, w = sw ? fh : fw, h = sw ? fw : fh;
      const fx = ri(x0 + 3, x1 - 3 - w), fy = ri(y0 + 3, y1 - 3 - h);
      let ok = fx > x0 && fy > y0;
      for (let j = fy - 2; ok && j < fy + h + 2; j++) for (let i = fx - 2; i < fx + w + 2; i++) if (get(i, j) !== T.FREE) { ok = false; break; }
      if (ok) for (let j = fy; j < fy + h; j++) for (let i = fx; i < fx + w; i++) set(i, j, T.FURN);
    }
    if (!opt.noDamage) {
      if (rng() < 0.5) { // a collapsed corner: walls and floor replaced by rubble
        const ccx = rng() < 0.5 ? x0 + 2 : x1 - 2, ccy = rng() < 0.5 ? y0 + 2 : y1 - 2, r = ri(4, 7), ph = rng() * 6;
        for (let j = ccy - r - 2; j <= ccy + r + 2; j++) for (let i = ccx - r - 2; i <= ccx + r + 2; i++) {
          if (!inb(i, j)) continue;
          const d = Math.hypot(i - ccx, j - ccy), ang = Math.atan2(j - ccy, i - ccx);
          if (d < r * (0.75 + 0.3 * Math.sin(ang * 3 + ph)) && (get(i, j) !== T.FREE || rng() < 0.7)) set(i, j, T.RUBBLE);
        }
        b.damage = 'collapsed corner';
      }
      if (rng() < 0.6) { // a breach: a gap torn in the outer wall, a second way in
        const hs = rng() < 0.5, p = hs ? ri(x0 + 3, x1 - 6) : ri(y0 + 3, y1 - 6), far = rng() < 0.5;
        for (let q = 0; q < 3; q++) { const i = hs ? p + q : (far ? x1 : x0), j = hs ? (far ? y1 : y0) : p + q; if (get(i, j) === T.CONCRETE) set(i, j, T.FREE); }
        b.damage = b.damage ? b.damage + ', breached wall' : 'breached wall';
      }
    }
    return b;
  }
  const clearOf = (x0, y0, x1, y1, gap) => {
    if (x0 < 6 || y0 < 6 || x1 > W - 7 || y1 > H - 7) return false;
    const bi = base[0] / RES, bj = base[1] / RES;
    if (bi > x0 - 20 && bi < x1 + 20 && bj > y0 - 20 && bj < y1 + 20) return false;
    return buildings.every((b) => x1 + gap < b.cells[0] || x0 - gap > b.cells[2] || y1 + gap < b.cells[1] || y0 - gap > b.cells[3]);
  };

  if (layout === 'campus') {
    base = [9, 8];
    const want = ri(6, 7);
    for (let t = 0; t < 600 && buildings.length < want; t++) {
      const big = buildings.length < 3, w = big ? ri(46, 70) : ri(26, 44), h = big ? ri(26, 42) : ri(22, 34);
      const sw = rng() < 0.35, bw = sw ? h : w, bh = sw ? w : h;
      const x0 = ri(8, W - 9 - bw), y0 = ri(8, H - 9 - bh);
      if (clearOf(x0, y0, x0 + bw, y0 + bh, 11)) addBuilding(x0, y0, x0 + bw, y0 + bh);
    }
  } else if (layout === 'market') {
    base = [7, 6];
    const rows = [[24, 44, 'n'], [62, 82, 's'], [102, 122, 'n'], [140, 160, 's']];
    for (const [ya, yb, side] of rows) {
      let x = ri(22, 30);
      while (x < W - 30) {
        const w = ri(13, 24), depth = ri(15, yb - ya);
        const y0 = side === 'n' ? yb - depth : ya, y1 = side === 'n' ? yb : ya + depth;
        if (x + w > W - 12) break;
        if (rng() < 0.1) { // an empty lot where a shop came down
          for (let j = y0; j <= y1; j++) for (let i = x; i <= x + w; i++) if (rng() < 0.55 && Math.hypot((i - x - w / 2) / w, (j - (y0 + y1) / 2) / depth) < 0.45) set(i, j, T.RUBBLE);
        } else addBuilding(x, y0, x + w, y1, { doorSide: side, simple: true });
        x += w + (rng() < 0.28 ? ri(5, 8) : 0);
      }
    }
  } else if (layout === 'hospital') {
    base = [10, 7];
    const mx0 = ri(30, 44), mx1 = W - ri(30, 44), my0 = ri(66, 76), my1 = my0 + ri(34, 38);
    addBuilding(mx0, my0, mx1, my1, { ends: 'both' });
    const ww = 34, span = mx1 - mx0;
    const wx = [mx0 + ri(6, 14), mx0 + Math.floor(span / 2) - 17 + ri(-8, 8), mx1 - ww - ri(6, 14)];
    const up = [rng() < 0.75, rng() < 0.5, rng() < 0.75];
    wx.forEach((x, q) => {
      const len = ri(44, 58);
      const b = up[q] ? addBuilding(x, my1, x + ww, Math.min(H - 8, my1 + len), { ends: 'low' }) : addBuilding(x, Math.max(26, my0 - len), x + ww, my0, { ends: 'high' });
      const mid = Math.floor((b.cells[0] + 1 + b.cells[2] - 1) / 2);
      for (const i of [mid - 2, mid - 1, mid]) for (const j of up[q] ? [my1 - 2, my1 - 1, my1, my1 + 1] : [my0 - 1, my0, my0 + 1, my0 + 2]) set(i, j, T.FREE);
    });
    for (let t = 0, made = 0; t < 200 && made < 2; t++) {
      const w = ri(22, 30), h = ri(20, 26), x0 = ri(8, W - 9 - w), y0 = ri(8, H - 9 - h);
      if (clearOf(x0, y0, x0 + w, y0 + h, 10)) { addBuilding(x0, y0, x0 + w, y0 + h); made++; }
    }
  } else { // blockb: the wall plan of building B from the main exercise, rasterised onto the grid
    base = blockB.staging.slice();
    const [bx0, by0, bx1, by1] = blockB.building;
    const seg = (a, b, v) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(len / 0.2);
      for (let q = 0; q <= n; q++) { const x = a[0] + ((b[0] - a[0]) * q) / n, y = a[1] + ((b[1] - a[1]) * q) / n;
        for (const [ox, oy] of [[-0.2, -0.2], [0.2, 0.2]]) { const k = cellOf(x + ox, y + oy); if (v === T.RUBBLE ? rng() < 0.5 : true) solid[k] = v; } }
    };
    for (let j = Math.floor(by0 / RES) - 1; j <= Math.floor(by1 / RES); j++) for (let i = Math.floor(bx0 / RES) - 1; i <= Math.floor(bx1 / RES); i++) indoor[j * W + i] = 1;
    buildings.push({ id: 0, name: 'Building B', rect: [bx0, by0, bx1, by1], cells: [bx0 / RES - 1, by0 / RES - 1, bx1 / RES, by1 / RES], kind: 'corridor', damage: 'collapsed north-east corner' });
    for (const w of blockB.walls) seg(w.a, w.b, w.state === 'collapsed' ? T.RUBBLE : w.mat === 'concrete' ? T.CONCRETE : T.DRYWALL);
    const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
    for (const o of blockB.obstacles) {
      if (o.kind === 'building') { const xs = o.poly.map((p) => p[0]), ys = o.poly.map((p) => p[1]); addBuilding(Math.min(...xs) / RES, Math.min(...ys) / RES, Math.max(...xs) / RES, Math.max(...ys) / RES); buildings[buildings.length - 1].name = o.name.split(' (')[0]; continue; }
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (inPoly([cx(i), cx(j)], o.poly)) {
        if (o.kind === 'furniture') solid[j * W + i] = T.FURN; else if (!o.passable || rng() < 0.3) solid[j * W + i] = T.RUBBLE;
      }
    }
    for (const d of blockB.doors) if (d.blocked) for (const [ox, oy] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) solid[cellOf(d.pos[0] + ox, d.pos[1] + oy)] = T.RUBBLE;
  }

  // outdoor rubble and abandoned vehicles
  const bi = Math.floor(base[0] / RES), bj = Math.floor(base[1] / RES);
  const nearBase = (i, j) => Math.hypot(i - bi, j - bj) < 18;
  for (let q = 0, n = ri(9, 14); q < n; q++) {
    const ccx = ri(6, W - 7), ccy = ri(6, H - 7), r = ri(2, 6), ph = rng() * 6;
    for (let j = ccy - r - 2; j <= ccy + r + 2; j++) for (let i = ccx - r - 2; i <= ccx + r + 2; i++) {
      if (!inb(i, j) || indoor[j * W + i] || nearBase(i, j)) continue;
      const d = Math.hypot(i - ccx, j - ccy), ang = Math.atan2(j - ccy, i - ccx);
      if (d < r * (0.7 + 0.35 * Math.sin(ang * 3 + ph) + 0.15 * Math.sin(ang * 7 + ph * 2)) && rng() < 0.88) solid[j * W + i] = T.RUBBLE;
    }
  }
  for (let q = 0, n = ri(3, 5), t = 0; q < n && t < 200; t++) {
    const sw = rng() < 0.5, w = sw ? 4 : 9, h = sw ? 9 : 4, x0 = ri(6, W - 7 - w), y0 = ri(6, H - 7 - h);
    let ok = !nearBase(x0, y0);
    for (let j = y0 - 2; ok && j < y0 + h + 2; j++) for (let i = x0 - 2; i < x0 + w + 2; i++) if (solid[j * W + i] || indoor[j * W + i]) { ok = false; break; }
    if (ok) { for (let j = y0; j < y0 + h; j++) for (let i = x0; i < x0 + w; i++) solid[j * W + i] = T.VEHICLE; q++; }
  }
  for (let j = bj - 8; j <= bj + 8; j++) for (let i = bi - 8; i <= bi + 8; i++) if (inb(i, j) && !indoor[j * W + i] && Math.hypot(i - bi, j - bj) <= 8) solid[j * W + i] = T.FREE;

  for (let i = 0; i < W; i++) { solid[i] = T.EDGE; solid[(H - 1) * W + i] = T.EDGE; }
  for (let j = 0; j < H; j++) { solid[j * W] = T.EDGE; solid[j * W + W - 1] = T.EDGE; }

  // which free cells a rover could ever reach from base (used only to score coverage, never to steer a robot)
  const reach = new Uint8Array(W * H), stack = [bj * W + bi]; reach[stack[0]] = 1;
  let reachCount = 0, reachIndoor = 0;
  while (stack.length) {
    const k = stack.pop(), i = k % W, j = (k / W) | 0; reachCount++; if (indoor[k]) reachIndoor++;
    for (let d = 0; d < 4; d++) { const ni = i + [1, -1, 0, 0][d], nj = j + [0, 0, 1, -1][d]; if (!inb(ni, nj)) continue; const nk = nj * W + ni; if (!reach[nk] && !solid[nk]) { reach[nk] = 1; stack.push(nk); } }
  }

  // people and decoys (hidden from the fleet until a sensor picks them up)
  const targets = [];
  const pick = (test) => { for (let t = 0; t < 4000; t++) { const k = ri(0, W * H - 1); if (reach[k] && test(k, k % W, (k / W) | 0) && targets.every((o) => Math.hypot(o.pos[0] - cx(k % W), o.pos[1] - cx((k / W) | 0)) > 9)) return k; } return -1; };
  const roomy = (k, i, j) => indoor[k] && !solid[k + 1] && !solid[k - 1] && !solid[k + W] && !solid[k - W] && Math.hypot(i - bi, j - bj) > 50;
  const plan = [['person', 'moving', roomy], ['person', 'still', roomy], ['person', 'still', (k, i, j) => !indoor[k] && Math.hypot(i - bi, j - bj) > 60 && (solid[k + 2] === T.RUBBLE || solid[k - 2] === T.RUBBLE || solid[k + 2 * W] === T.RUBBLE || solid[k - 2 * W] === T.RUBBLE)],
    ['person', 'moving', roomy], ['fan', 'moving', roomy], ['heat', 'still', roomy]];
  if (rng() < 0.5) plan.push(['person', 'still', roomy]);
  plan.forEach(([kind, motion, test], q) => { const k = pick(test); if (k >= 0) targets.push({ id: 'T' + q, kind, motion, cell: k, pos: [cx(k % W), cx((k / W) | 0)], indoor: !!indoor[k] }); });

  return { W, H, RES, layout, seed, solid, indoor, buildings, base, baseCell: bj * W + bi, reach, reachCount, reachIndoor, targets, name: LAYOUTS[layout].label };
}

// ------------------------------------------------------------------------------------------------------------
// Helpers on the grid
// ------------------------------------------------------------------------------------------------------------
// Rays from a cell to every cell on the edge of a square: together they touch every cell inside it.
function makeRays(r) {
  const rays = [];
  const edge = [];
  for (let q = -r; q <= r; q++) { edge.push([q, -r], [q, r]); if (q > -r && q < r) edge.push([-r, q], [r, q]); }
  for (const [ex, ey] of edge) {
    const n = Math.max(Math.abs(ex), Math.abs(ey)), ray = [];
    for (let s = 1; s <= n; s++) { const di = Math.round((ex * s) / n), dj = Math.round((ey * s) / n); if (di * di + dj * dj > r * r) break; ray.push(di, dj); }
    rays.push(Int8Array.from(ray));
  }
  return rays;
}
const RAYS = makeRays(Math.round(PARAMS.rover.lidar / RES));
const NB = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];
const NDI = Int32Array.from(NB.map((n) => n[0])), NDJ = Int32Array.from(NB.map((n) => n[1])), NDC = Int32Array.from(NB.map((n) => n[2]));
const INF = 0x3fffffff;
const buckets = Array.from({ length: 16 }, () => []);

// Shortest paths over cells the fleet knows are free. Step cost 10 straight, 14 diagonal (so 20 = 1 m), no
// corner cutting. Dial's bucket queue: linear time. The outer ring of the grid is always solid, so no bounds checks.
// If stopAfter > 0 the search ends once that many cells flagged in targetMark have been settled (their distances
// are then exact; everything farther stays "unreached").
const OFF = Int32Array.from([1, -1, W, -W, W + 1, -W + 1, W - 1, -W - 1]), OCOST = Int32Array.from([10, 10, 10, 10, 14, 14, 14, 14]);
const OA = Int32Array.from([0, 0, 0, 0, 1, 1, -1, -1]), OB = Int32Array.from([0, 0, 0, 0, W, -W, W, -W]);
const BCAP = 1 << 15, bq = new Int32Array(16 * BCAP), bn = new Int32Array(16);
function dijkstra(known, start, dist, prev, targetMark = null, stopAfter = 0) {
  dist.fill(INF); bn.fill(0);
  if (known[start] !== 1) { // standing on a cell not yet marked free (first step): start from the nearest free neighbour
    let s2 = -1; for (let q = 0; q < 8; q++) if (known[start + OFF[q]] === 1) { s2 = start + OFF[q]; break; }
    if (s2 < 0) return; prev[s2] = -1; start = s2;
  }
  dist[start] = 0; prev[start] = -1; bq[0] = start; bn[0] = 1;
  let live = 1, d = 0, hit = 0;
  while (live > 0) {
    const b = d & 15, base = b * BCAP;
    while (bn[b] > 0) {
      const k = bq[base + --bn[b]]; live--;
      if (dist[k] !== d) continue;
      if (stopAfter && targetMark[k] === 1 && ++hit >= stopAfter) { bn.fill(0); return; }
      for (let q = 0; q < 8; q++) {
        const nk = k + OFF[q];
        if (known[nk] !== 1) continue;
        const nd = d + OCOST[q];
        if (nd >= dist[nk]) continue;
        if (q > 3 && (known[k + OA[q]] !== 1 || known[k + OB[q]] !== 1)) continue;
        dist[nk] = nd; prev[nk] = k;
        const nb = nd & 15; if (bn[nb] < BCAP) { bq[nb * BCAP + bn[nb]++] = nk; live++; }
      }
    }
    d++;
  }
}
function tracePath(prev, from) { const p = []; for (let k = from; k >= 0; k = prev[k]) { p.push(k); if (p.length > 20000) break; } return p; }

// Minimum-cost assignment of n rows to m >= n columns (Kuhn-Munkres with potentials). cost is row-major.
export function hungarian(cost, n, m) {
  const u = new Float64Array(n + 1), v = new Float64Array(m + 1), p = new Int32Array(m + 1), way = new Int32Array(m + 1);
  const minv = new Float64Array(m + 1), used = new Uint8Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0; minv.fill(Infinity); used.fill(0);
    do {
      used[j0] = 1; const i0 = p[j0]; let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const cur = cost[(i0 - 1) * m + (j - 1)] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const a = new Int32Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) a[p[j] - 1] = j - 1;
  return a;
}

// ------------------------------------------------------------------------------------------------------------
// The swarm
// ------------------------------------------------------------------------------------------------------------
export function fleetMix(n) { const drones = n >= 8 ? 2 : n >= 4 ? 1 : 0; return { rovers: n - drones, drones }; }

export function createSwarm(world, { n = 6, strategy = 'hungarian', startCharge = 1, track = false } = {}) {
  const { solid, indoor, reach } = world;
  const rngS = mulberry32((world.seed * 7919 + 17) >>> 0);        // sensor noise
  const known = new Uint8Array(W * H);
  const P = PARAMS, mix = fleetMix(n);
  const [bx, by] = world.base;
  const homeDist = new Int32Array(W * H), homePrev = new Int32Array(W * H);
  const scratchD = new Int32Array(W * H), scratchP = new Int32Array(W * H);
  const mark = new Int32Array(W * H);
  const tmark = new Uint8Array(W * H);
  const cued = new Map();                                      // target id -> lead id (kept here: the world is shared between runs)

  const robots = [];
  for (let q = 0; q < n; q++) {
    const kind = q >= mix.rovers ? 'drone' : 'rover', spec = P[kind];
    const ang = (q / n) * Math.PI * 2, rad = kind === 'drone' ? 3 : 1.6;
    robots.push({ id: (kind === 'drone' ? 'D' : 'R') + (kind === 'drone' ? q - mix.rovers + 1 : q + 1), idx: q, kind, x: bx + Math.cos(ang) * rad, y: by + Math.sin(ang) * rad, heading: ang,
      mode: 'explore', path: null, pi: 0, goal: null, cap: spec.capWh, energy: spec.capWh * startCharge, relaysLeft: spec.relays, odo: 0, swaps: 0,
      link: { ok: true, parent: 'BASE', rssi: -40, best: -40, hops: 1, q: 1 }, lead: null, timer: 0, why: '', wait: 0, used: 0,
      dist: kind === 'rover' ? new Int32Array(W * H) : null, prev: kind === 'rover' ? new Int32Array(W * H) : null });
  }
  const S = {
    t: 0, step: 0, done: false, strategy, n, mix, known, robots, relays: [], leads: [], auctions: [], events: [], clusters: [], droneClusters: [],
    links: [], prof: { home: 0, clusters: 0, paths: 0, assign: 0, auction: 0, mesh: 0, total: 0 }, changed: track ? [] : null, series: [0], seriesDt: 2,
    m: { covered: 0, coveredIn: 0, coverage: 0, indoorCoverage: 0, t50: null, t90: null, t95: null, tExplored: null, tFirstLead: null, distRover: 0, distDrone: 0, energyWh: 0, swaps: 0, relays: 0, relayFails: 0, restocks: 0,
      clash: 0, searchS: 0, minSearching: n, reroutes: 0, regroups: 0, replans: 0, confirmed: 0, rejected: 0, open: 0 },
  };
  let lastReplan = -99, relaySeq = 0, leadSeq = 0, staticDirty = true, evSeq = 0;
  const log = (level, text, extra) => { S.events.push({ id: ++evSeq, t: S.t, level, text, ...extra }); if (S.events.length > 400) S.events.shift(); };

  const setKnown = (k, v) => {
    const old = known[k]; if (old === v) return;
    if (v === K.ROOF && old !== K.UNKNOWN) return;
    known[k] = v;
    if (v === K.FREE && reach[k]) { S.m.covered++; if (indoor[k]) S.m.coveredIn++; }
    if (S.changed) S.changed.push(k);
  };

  // ---- sensing: the mapping sensor ----
  function sense(r) {
    const ci = Math.floor(r.x / RES), cj = Math.floor(r.y / RES);
    if (r.kind === 'rover') {
      setKnown(cj * W + ci, K.FREE);
      for (const ray of RAYS) {
        for (let s = 0; s < ray.length; s += 2) {
          const i = ci + ray[s], j = cj + ray[s + 1];
          if (i < 0 || j < 0 || i >= W || j >= H) break;
          const k = j * W + i;
          if (solid[k]) { setKnown(k, K.OCC); break; }
          setKnown(k, K.FREE);
        }
      }
    } else { // a camera looking straight down: open ground and roofs, never the inside of a building
      const R = Math.round(P.drone.footprint / RES);
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        if (di * di + dj * dj > R * R) continue;
        const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= W || j >= H) continue;
        const k = j * W + i;
        if (known[k] !== K.UNKNOWN) continue;
        setKnown(k, solid[k] === T.EDGE ? K.OCC : indoor[k] ? K.ROOF : solid[k] ? K.OCC : K.FREE);
      }
    }
  }

  // ---- geometry through the true map (physics: radio and sensor sight lines) ----
  function trace(ax, ay, bx2, by2, aerial) {
    const dx = bx2 - ax, dy = by2 - ay, len = Math.hypot(dx, dy), n2 = Math.max(1, Math.ceil(len / (RES * 0.7)));
    let loss = 0, walls = 0, blocked = false, prevT = 0;
    for (let q = 1; q < n2; q++) {
      const k = cellOf(ax + (dx * q) / n2, ay + (dy * q) / n2);
      let t = solid[k];
      if (aerial) t = indoor[k] ? (t || T.DRYWALL) : 0;      // from the air only roofs are in the way
      if (t && !prevT) { loss += P.radio.loss[t]; if (t === T.CONCRETE || t === T.DRYWALL) walls++; }
      if (t) blocked = true;
      prevT = t;
    }
    return { len, loss, walls, blocked };
  }
  const rssi = (ax, ay, bx2, by2, aerial) => { const tr = trace(ax, ay, bx2, by2, aerial); return P.radio.p1m - 10 * P.radio.exponent * Math.log10(Math.max(1, tr.len)) - tr.loss; };
  const linkCost = (db) => { const w = Math.min(1, Math.max(0, (-55 - db) / 33)); return 0.2 + 8 * w * w * w * w; };   // weak links cost far more than an extra hop
  const quality = (db) => Math.min(1, Math.max(0, (db - P.radio.rxMin) / 30));

  // ---- radio mesh: base and relays form the backbone; every robot attaches to its best backbone node ----
  const nodes = () => [{ id: 'BASE', x: bx, y: by, alive: true }, ...S.relays.filter((r) => r.alive)];
  const pairCache = new Map();
  function staticTree() {
    const ns = nodes(), cnt = ns.length;
    const cost = new Float64Array(cnt).fill(Infinity), par = new Int32Array(cnt).fill(-1), done = new Uint8Array(cnt), up = new Float64Array(cnt);
    cost[0] = 0;
    for (let it = 0; it < cnt; it++) {
      let b = -1; for (let q = 0; q < cnt; q++) if (!done[q] && (b < 0 || cost[q] < cost[b])) b = q;
      if (b < 0 || cost[b] === Infinity) break; done[b] = 1;
      for (let q = 1; q < cnt; q++) {
        if (done[q]) continue;
        const key = ns[b].id + '|' + ns[q].id; let db = pairCache.get(key);
        if (db === undefined) { db = rssi(ns[b].x, ns[b].y, ns[q].x, ns[q].y, !!(ns[b].high || ns[q].high)); pairCache.set(key, db); pairCache.set(ns[q].id + '|' + ns[b].id, db); }
        if (db < P.radio.rxMin) continue;
        const c = cost[b] + linkCost(db);
        if (c < cost[q]) { cost[q] = c; par[q] = b; up[q] = db; }
      }
    }
    ns.forEach((nd, q) => { nd.cost = cost[q]; nd.connected = cost[q] < Infinity; nd.parent = par[q] >= 0 ? ns[par[q]].id : null; nd.rssi = up[q]; nd.hops = 0; nd.load = 0; });
    ns.forEach((nd) => { let h = 0, c = nd; while (c && c.parent) { h++; c = ns.find((o) => o.id === c.parent); } nd.hops = h; });
    S.relays.forEach((r) => { if (!r.alive) { r.connected = false; r.parent = null; } });
    staticDirty = false;
    return ns;
  }
  let backbone = [];
  function updateMesh() {
    if (staticDirty) backbone = staticTree();
    for (const nd of backbone) nd.load = 0;
    for (const r of robots) {
      let best = null, bestC = Infinity, bestDb = -200, top = -200;
      for (const nd of backbone) {
        if (!nd.connected) continue;
        const d = Math.hypot(nd.x - r.x, nd.y - r.y); if (d > 75) continue;
        const db = rssi(r.x, r.y, nd.x, nd.y, r.kind === 'drone' || !!nd.high); if (db < P.radio.rxMin) continue;
        if (db > top) top = db;
        const c = nd.cost + linkCost(db);
        if (c < bestC) { bestC = c; best = nd; bestDb = db; }
      }
      const was = r.link;
      r.link = best ? { ok: true, parent: best.id, rssi: bestDb, best: top, hops: best.hops + 1, q: quality(bestDb) } : { ok: false, parent: null, rssi: -120, best: -120, hops: 0, q: 0 };
      if (best && top >= P.radio.drop) r.crumb = { x: r.x, y: r.y, parent: best.id, rssi: bestDb, best: top, hops: best.hops + 1 };
      if (best) { let c = best; while (c) { c.load++; c = c.parent ? backbone.find((o) => o.id === c.parent) : null; } }
      if (was.ok && !r.link.ok && r.mode !== 'swap' && r.mode !== 'done') {
        S.m.regroups++; r.resume = r.mode === 'lead' || r.mode === 'listen' ? 'explore' : r.mode; if (r.lead) releaseLead(r, 'the link dropped');
        r.mode = 'regroup'; r.why = 'No path to base'; r.goal = null; headHome(r);
        log('warn', r.id + ' lost its path to base and is driving back toward the mesh.', { robot: r.id });
      } else if (!was.ok && r.link.ok && r.mode === 'regroup') {
        r.mode = r.resume === 'return' || r.resume === 'home' ? r.resume : 'explore'; r.why = ''; if (r.mode === 'explore') { r.path = null; r.goal = null; }
        if (r.relaysLeft > 0 && !S.relays.some((b) => b.alive && Math.hypot(b.x - r.x, b.y - r.y) < 3)) dropRelay(r, 'edge of coverage after a regroup');
        else if (r.relaysLeft === 0 && r.mode === 'explore') { r.mode = 'return'; r.why = 'Out of beacons'; headHome(r); log('info', r.id + ' is out of beacons and returns to restock.', { robot: r.id }); }
        log('ok', r.id + ' is back on the mesh through ' + label(r.link.parent) + '.', { robot: r.id });
      } else if (was.ok && r.link.ok && r.rerouteFrom && was.parent !== r.link.parent) {
        S.m.reroutes++; log('ok', r.id + ' re-routed: ' + label(r.rerouteFrom) + ' failed, now through ' + label(r.link.parent) + ' (' + r.link.hops + ' hops).', { robot: r.id });
      }
      r.rerouteFrom = null;
    }
    // links to draw
    const L = [];
    for (const nd of backbone) if (nd.parent) { const p = backbone.find((o) => o.id === nd.parent); L.push({ a: nd.id, b: p.id, ax: nd.x, ay: nd.y, bx: p.x, by: p.y, rssi: nd.rssi, q: quality(nd.rssi), kind: 'backbone' }); }
    for (const r of robots) if (r.link.ok && r.mode !== 'done') { const p = backbone.find((o) => o.id === r.link.parent); L.push({ a: r.id, b: p.id, ax: r.x, ay: r.y, bx: p.x, by: p.y, rssi: r.link.rssi, q: r.link.q, kind: r.kind }); }
    S.links = L;
  }
  const label = (id) => (id === 'BASE' ? 'base' : 'beacon ' + String(id).slice(1));
  function dropRelay(r, why) {
    // A wall can cost 10 dB in one step. A rover places the beacon from its rear deck at the last spot where the link
    // was still strong (never more than 1 m behind it), so the beacon itself keeps a good link. A drone sets its beacon
    // on a roof or another high point, so that beacon's links are traced from the air, as the drone's own are (assumed).
    const c = r.kind === 'rover' && r.crumb && r.link.ok && Math.hypot(r.crumb.x - r.x, r.crumb.y - r.y) <= 1 ? r.crumb : { x: r.x, y: r.y, parent: r.link.parent, rssi: r.link.rssi, best: r.link.best, hops: r.link.hops };
    const rel = { id: 'B' + (++relaySeq), x: c.x, y: c.y, cell: cellOf(c.x, c.y), alive: true, high: r.kind === 'drone', by: r.id, t: S.t, connected: true, parent: c.parent, rssi: c.rssi, hops: c.hops, load: 0, why };
    S.relays.push(rel); r.relaysLeft--; S.m.relays++; staticDirty = true;
    log('info', r.id + ' dropped beacon ' + relaySeq + ' (its link was down to ' + r.link.best.toFixed(0) + ' dBm).', { robot: r.id, relay: rel.id });
  }
  function failRelay(id) {
    let rel = id && id !== 'busiest' ? S.relays.find((r) => r.id === id && r.alive) : null;
    if (!rel) { updateMesh(); rel = S.relays.filter((r) => r.alive && r.connected).sort((a, b) => (b.load - a.load) || (a.hops - b.hops))[0]; }
    if (!rel) return null;
    rel.alive = false; rel.failedAt = S.t; S.m.relayFails++; staticDirty = true;
    for (const r of robots) { let c = backbone.find((o) => o.id === r.link.parent), through = false; while (c) { if (c.id === rel.id) through = true; c = c.parent ? backbone.find((o) => o.id === c.parent) : null; } if (through) r.rerouteFrom = rel.id; }
    log('alert', 'Beacon ' + rel.id.slice(1) + ' failed. It was carrying ' + rel.load + ' robot' + (rel.load === 1 ? '' : 's') + '.', { relay: rel.id });
    updateMesh();
    return rel;
  }

  // ---- motion ----
  function headHome(r) {
    if (r.kind === 'drone') { r.path = null; r.goal = { x: bx, y: by, cell: world.baseCell, home: true }; return; }
    const k = cellOf(r.x, r.y);
    r.path = homeDist[k] < INF ? tracePath(homePrev, k) : null; r.pi = 0; r.goal = { x: bx, y: by, cell: world.baseCell, home: true };
    if (!r.path) { dijkstra(known, world.baseCell, homeDist, homePrev); r.path = homeDist[k] < INF ? tracePath(homePrev, k) : [k]; }
  }
  function move(r, dt) {
    const spec = P[r.kind]; let left = spec.speed * dt, moved = 0, arrived = false;
    if (r.kind === 'drone') {
      if (!r.goal) return true;
      const dx = r.goal.x - r.x, dy = r.goal.y - r.y, d = Math.hypot(dx, dy);
      if (d <= left) { r.x = r.goal.x; r.y = r.goal.y; moved = d; arrived = true; } else { r.x += (dx / d) * left; r.y += (dy / d) * left; moved = left; r.heading = Math.atan2(dy, dx); }
    } else {
      if (!r.path || r.pi >= r.path.length) return true;
      while (left > 1e-6 && r.pi < r.path.length) {
        const k = r.path[r.pi], tx = cx(k % W), ty = cx((k / W) | 0), dx = tx - r.x, dy = ty - r.y, d = Math.hypot(dx, dy);
        if (d <= left) { r.x = tx; r.y = ty; left -= d; moved += d; r.pi++; } else { r.x += (dx / d) * left; r.y += (dy / d) * left; moved += left; left = 0; r.heading = Math.atan2(dy, dx); }
      }
      arrived = r.pi >= r.path.length;
    }
    r.odo += moved; if (r.kind === 'drone') S.m.distDrone += moved; else S.m.distRover += moved;
    return arrived;
  }
  const powerOf = (r) => (r.kind === 'drone' ? (r.mode === 'swap' || r.mode === 'done' || r.mode === 'standby' ? 0 : P.drone.flyW) : (r.mode === 'swap' || r.mode === 'done' ? 0 : P.rover.hotelW + (r.mode === 'listen' || r.mode === 'idle' ? 0 : P.rover.driveW)));
  const homeMetres = (r) => (r.kind === 'drone' ? Math.hypot(r.x - bx, r.y - by) : (homeDist[cellOf(r.x, r.y)] < INF ? homeDist[cellOf(r.x, r.y)] / 20 : Math.hypot(r.x - bx, r.y - by) * 1.6));
  const homeWh = (r, metres) => ((metres / P[r.kind].speed) * (r.kind === 'drone' ? P.drone.flyW : P.rover.hotelW + P.rover.driveW)) / 3600;
  const slackOf = (r) => r.energy - homeWh(r, homeMetres(r)) * P.energy.margin - r.cap * P.energy.reserve;

  // ---- frontiers ----
  function findClusters(forDrone) {
    const out = [], cells = [];
    mark.fill(0);
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
      const k = j * W + i, v = known[k];
      if (forDrone) { if (v === K.UNKNOWN) continue; if (known[k + 1] && known[k - 1] && known[k + W] && known[k - W]) continue; }
      else { if (v !== K.FREE) continue; const a = known[k + 1], b = known[k - 1], c = known[k + W], d = known[k - W]; if (a !== 0 && a !== 3 && b !== 0 && b !== 3 && c !== 0 && c !== 3 && d !== 0 && d !== 3) continue; }
      mark[k] = 1; cells.push(k);
    }
    const cap = forDrone ? 40 : 22, q = [];
    for (const s of cells) {
      if (mark[s] !== 1) continue;
      q.length = 0; q.push(s); mark[s] = 2; let sx = 0, sy = 0; const mem = [];
      while (q.length && mem.length < cap) {
        const k = q.shift(); mem.push(k); const i = k % W, j = (k / W) | 0; sx += i; sy += j;
        for (let d = 0; d < 8; d++) { const nk = (j + NB[d][1]) * W + i + NB[d][0]; if (mark[nk] === 1) { mark[nk] = 2; q.push(nk); } }
      }
      for (const k of q) mark[k] = 1;                         // spill-over starts the next cluster
      const mx = sx / mem.length, my = sy / mem.length; let best = mem[0], bd = 1e9;
      for (const k of mem) { const d = Math.hypot((k % W) - mx, ((k / W) | 0) - my); if (d < bd) { bd = d; best = k; } }
      let gain = 0; const bi2 = best % W, bj2 = (best / W) | 0;
      for (let dj = -8; dj <= 8; dj += 2) for (let di = -8; di <= 8; di += 2) { const i = bi2 + di, j = bj2 + dj; if (i < 0 || j < 0 || i >= W || j >= H) continue; const v = known[j * W + i]; if (v === 0 || (!forDrone && v === 3)) gain++; }
      if (!forDrone && mem.length < 2 && gain < 3) continue;  // a one-cell speck the sensor missed: not worth a trip
      out.push({ cell: best, x: cx(bi2), y: cx(bj2), size: mem.length, gain, cells: mem, taken: 0 });
    }
    return out;
  }
  const goalStale = (r) => {
    if (!r.goal || r.goal.home) return true;
    const i0 = r.goal.cell % W, j0 = (r.goal.cell / W) | 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= W || j >= H) continue; const v = known[j * W + i]; if (v === 0 || (r.kind === 'rover' && v === 3)) return false; }
    return true;
  };

  // ---- assignment: the part the three strategies do differently ----
  function assign(group, clusters) {
    const n2 = group.length, m = clusters.length;
    if (!n2) return;
    if (!m) { for (const r of group) { r.goal = null; r.path = null; } return; }
    const BIG = 1e6, cost = new Float64Array(n2 * m);
    group.forEach((r, a) => clusters.forEach((c, b) => {
      let d = r.kind === 'drone' ? Math.hypot(c.x - r.x, c.y - r.y) : (r.dist[c.cell] < INF ? r.dist[c.cell] / 20 : BIG);
      if (r.blocked && r.blocked.has(c.cell)) d = BIG;
      if (d < BIG && r.goal && !r.goal.home && Math.hypot(r.goal.x - c.x, r.goal.y - c.y) < 1.6) d *= 0.8;   // stay committed: no dithering
      cost[a * m + b] = d;
    }));
    const pickOf = new Int32Array(n2).fill(-1);
    const spread = (r) => (r.kind === 'drone' ? 12 : 6);
    const greedyFill = (rows, pen) => {
      const left = new Set(rows);
      while (left.size) {
        let ba = -1, bb = -1, bc = BIG;
        for (const a of left) for (let b = 0; b < m; b++) { const c = cost[a * m + b] + pen[b]; if (c < bc && cost[a * m + b] < BIG) { bc = c; ba = a; bb = b; } }
        if (ba < 0) break;
        pickOf[ba] = bb; left.delete(ba);
        for (let b = 0; b < m; b++) { const d = Math.hypot(clusters[b].x - clusters[bb].x, clusters[b].y - clusters[bb].y); if (b === bb) pen[b] += 40; else if (d < spread(group[0])) pen[b] += 14 * (1 - d / spread(group[0])); }
      }
    };
    if (S.strategy === 'nearest') {
      for (let a = 0; a < n2; a++) { let bb = -1, bc = BIG; for (let b = 0; b < m; b++) if (cost[a * m + b] < bc) { bc = cost[a * m + b]; bb = b; } pickOf[a] = bb; }
    } else if (S.strategy === 'greedy') {
      greedyFill(group.map((_, a) => a), new Float64Array(m));
    } else {
      const pen = new Float64Array(m);
      if (n2 <= m) { const a = hungarian(cost, n2, m); for (let q = 0; q < n2; q++) if (a[q] >= 0 && cost[q * m + a[q]] < BIG) pickOf[q] = a[q]; }
      else { const tc = new Float64Array(m * n2); for (let a = 0; a < n2; a++) for (let b = 0; b < m; b++) tc[b * n2 + a] = cost[a * m + b]; const a = hungarian(tc, m, n2); for (let b = 0; b < m; b++) if (a[b] >= 0 && cost[a[b] * m + b] < BIG) pickOf[a[b]] = b; }
      const rest = [];
      for (let a = 0; a < n2; a++) { if (pickOf[a] < 0) rest.push(a); else for (let b = 0; b < m; b++) { const d = Math.hypot(clusters[b].x - clusters[pickOf[a]].x, clusters[b].y - clusters[pickOf[a]].y); if (b === pickOf[a]) pen[b] += 40; else if (d < spread(group[0])) pen[b] += 14 * (1 - d / spread(group[0])); } }
      if (rest.length) greedyFill(rest, pen);
    }
    group.forEach((r, a) => {
      const b = pickOf[a];
      if (b < 0) { r.goal = null; r.path = null; return; }
      const c = clusters[b]; c.taken++;
      const same = r.goal && r.goal.cell === c.cell;
      r.goal = { x: c.x, y: c.y, cell: c.cell, gain: c.gain, cost: cost[a * m + b] };
      if (r.kind === 'rover' && !(same && r.path && r.pi < r.path.length)) { r.path = tracePath(r.prev, c.cell).reverse(); r.pi = 0; }
    });
    // how many robots are heading for a frontier that another robot is already heading for
    let clash = 0;
    for (let a = 0; a < n2; a++) { if (pickOf[a] < 0) continue; for (let b2 = 0; b2 < n2; b2++) if (b2 !== a && pickOf[b2] >= 0 && Math.hypot(clusters[pickOf[a]].x - clusters[pickOf[b2]].x, clusters[pickOf[a]].y - clusters[pickOf[b2]].y) < (group[0].kind === 'drone' ? 8 : 5)) { clash++; break; } }
    return clash;
  }

  let clashNow = 0;
  function replan() {
    S.m.replans++; lastReplan = S.t;
    const p0 = performance.now();
    if (S.m.replans % 4 === 1) dijkstra(known, world.baseCell, homeDist, homePrev);
    const p1 = performance.now();
    S.clusters = findClusters(false);
    S.droneClusters = mix.drones ? findClusters(true) : [];
    const p2 = performance.now();
    const rovers = robots.filter((r) => r.kind === 'rover' && r.mode === 'explore'), drones = robots.filter((r) => r.kind === 'drone' && r.mode === 'explore');
    tmark.fill(0); let nt = 0; for (const c of S.clusters) if (!tmark[c.cell]) { tmark[c.cell] = 1; nt++; }
    const stopAfter = Math.min(nt, 2 * rovers.length + 6);          // each rover only needs its nearest few frontiers
    for (const r of rovers) dijkstra(known, cellOf(r.x, r.y), r.dist, r.prev, tmark, stopAfter);
    const p3 = performance.now();
    clashNow = (assign(rovers, S.clusters) || 0) + (assign(drones, S.droneClusters) || 0);
    const p4 = performance.now();
    openAuctions();
    S.prof.home += p1 - p0; S.prof.clusters += p2 - p1; S.prof.paths += p3 - p2; S.prof.assign += p4 - p3; S.prof.auction += performance.now() - p4;
    // nothing left to explore for a robot: go home
    const exhausted = !S.clusters.some((c) => rovers.length === 0 || stopAfter < nt || rovers.some((r) => r.dist[c.cell] < INF));
    for (const r of robots) {
      if (r.mode !== 'explore' || r.goal) continue;
      const mine = r.kind === 'drone' ? S.droneClusters : S.clusters;
      if (!mine.length || (r.kind === 'rover' && (exhausted || (stopAfter >= nt && !mine.some((c) => r.dist[c.cell] < INF)))) || (r.kind === 'drone' && !mine.some((c) => !(r.blocked && r.blocked.has(c.cell))))) {
        if (r.kind === 'drone' && S.clusters.length && !exhausted) { r.mode = 'home'; r.why = 'Outdoor survey done'; headHome(r); }
        else if (exhausted || !S.clusters.length) { r.mode = 'home'; r.why = 'Nothing left to search'; headHome(r); }
      }
    }
    const explorers = robots.filter((r) => r.mode === 'explore' || r.mode === 'lead' || r.mode === 'listen' || r.mode === 'return' || r.mode === 'swap' || r.mode === 'regroup');
    if (S.m.tExplored == null && S.t > 4 && !explorers.some((r) => r.kind === 'rover') && (!S.clusters.length || exhausted)) {
      S.m.tExplored = S.t; log('ok', 'Search complete: no reachable frontier is left. ' + (S.m.coverage * 100).toFixed(1) + ' % of the reachable floor is mapped.');
    }
  }

  // ---- leads and the task auction ----
  function cueCheck(r, dt) {
    for (const tg of world.targets) {
      if (cued.has(tg.id)) continue;
      const d = Math.hypot(tg.pos[0] - r.x, tg.pos[1] - r.y); let sensor = null, rate = 0;
      if (r.kind === 'drone') { if (!tg.indoor && tg.kind === 'person' && d <= P.cue.droneRange) { sensor = 'aerial'; rate = 0.25; } }
      else if (d <= P.cue.thermalRange) {
        const tr = trace(r.x, r.y, tg.pos[0], tg.pos[1], false);
        if (tg.motion === 'moving' && d <= P.cue.radarRange && tr.walls <= P.cue.radarWalls) { sensor = 'radar'; rate = tr.walls ? 0.2 : 0.35; }
        else if ((tg.kind === 'person' || tg.kind === 'heat') && !tr.blocked) { sensor = 'thermal'; rate = 0.3; }
      }
      if (!sensor || rngS() > rate * dt) continue;
      const nx = tg.pos[0] + (rngS() - 0.5) * 1.6, ny = tg.pos[1] + (rngS() - 0.5) * 1.6;
      const ev = [{ sensor, result: 'pos', vantage: 'v1', unit: r.id, t: S.t, note: sensor === 'radar' ? 'Moving target on the radar while driving past' : sensor === 'thermal' ? 'Warm shape in the thermal camera' : 'Person-shaped object in the drone image' }];
      const f = fuse(ev);
      const lead = { id: 'L' + (++leadSeq), t: S.t, pos: [nx, ny], cell: cellOf(nx, ny), by: r.id, sensor, v1: [r.x, r.y], indoor: tg.indoor, status: 'auction', p: f.p, evidence: ev, steps: f.steps, target: tg.id, winner: null, tries: 0 };
      cued.set(tg.id, lead.id); S.leads.push(lead);
      if (S.m.tFirstLead == null) S.m.tFirstLead = S.t;
      log('warn', 'Lead ' + lead.id.slice(1) + ': ' + r.id + ' picked up a ' + (sensor === 'radar' ? 'moving target on radar' : sensor === 'thermal' ? 'warm shape on thermal' : 'person-shaped object from the air') + '. Possible person, ' + (f.p * 100).toFixed(0) + ' %. Auction opened.', { lead: lead.id, robot: r.id });
    }
  }
  function openAuctions() {
    for (const lead of S.leads) {
      if (lead.status !== 'auction') continue;
      // where to stand for the second look: known free floor about 2.5 m from the lead, away from the first vantage
      const li = lead.cell % W, lj = (lead.cell / W) | 0; let vant = -1, vs = 1e9;
      for (let dj = -14; dj <= 14; dj++) for (let di = -14; di <= 14; di++) {
        const i = li + di, j = lj + dj; if (i < 1 || j < 1 || i >= W - 1 || j >= H - 1) continue; const k = j * W + i;
        if (known[k] !== K.FREE || homeDist[k] >= INF) continue;
        const d = Math.hypot(di, dj) * RES, d1 = Math.hypot(cx(i) - lead.v1[0], cx(j) - lead.v1[1]);
        const s = Math.abs(d - 2.5) + (d1 < 3 ? 4 : 0) + (trace(cx(i), cx(j), lead.pos[0], lead.pos[1], false).walls ? 2.5 : 0);
        if (s < vs) { vs = s; vant = k; }
      }
      if (vant < 0) continue;
      dijkstra(known, vant, scratchD, scratchP);
      const vx = cx(vant % W), vy = cx((vant / W) | 0);
      const bids = robots.map((r) => {
        const bid = { robot: r.id, kind: r.kind, eligible: true, reason: '' };
        const busy = { swap: 'swapping battery', return: 'returning for a battery', regroup: 'off the mesh', lead: 'on another lead', listen: 'on another lead', done: 'stood down', home: 'heading home', standby: 'stood down' }[r.mode];
        if (busy && !((r.mode === 'home' || r.mode === 'done' || r.mode === 'standby') && r.energy > r.cap * 0.5)) { bid.eligible = false; bid.reason = busy; }
        if (r.kind === 'drone' && lead.indoor) { bid.eligible = false; bid.reason = 'cannot fly indoors'; }
        const metres = r.kind === 'drone' ? Math.hypot(lead.pos[0] - r.x, lead.pos[1] - r.y) : (scratchD[cellOf(r.x, r.y)] < INF ? scratchD[cellOf(r.x, r.y)] / 20 : Infinity);
        if (metres === Infinity) { bid.eligible = false; bid.reason = bid.reason || 'no known route'; bid.eta = null; bid.dist = null; return bid; }
        bid.dist = metres; bid.eta = metres / P[r.kind].speed;
        const tripWh = homeWh(r, metres) + (P.listenS * (r.kind === 'drone' ? P.drone.flyW : P.rover.hotelW)) / 3600;
        const backWh = homeWh(r, r.kind === 'drone' ? Math.hypot(lead.pos[0] - bx, lead.pos[1] - by) : homeDist[vant] / 20) * P.energy.margin;
        bid.battAfter = (r.energy - tripWh - backWh) / r.cap;
        if (bid.eligible && bid.battAfter < P.energy.reserve) { bid.eligible = false; bid.reason = 'not enough battery to get there and home'; }
        bid.fit = (r.kind === 'drone' ? 0.6 : lead.indoor ? 1 : 0.85) * (r.id === lead.by ? 0.85 : 1);
        bid.fitWhy = (r.kind === 'drone' ? 'thermal from above only' : 'Wi-Fi network, radar, thermal') + (r.id === lead.by ? '; same unit as the first look' : '');
        bid.timeScore = 1 / (1 + bid.eta / 60); bid.battScore = Math.min(1, Math.max(0, bid.battAfter / 0.5));
        bid.score = P.bid.time * bid.timeScore + P.bid.battery * bid.battScore + P.bid.fit * bid.fit;
        return bid;
      });
      const win = bids.filter((b) => b.eligible).sort((a, b) => b.score - a.score)[0];
      lead.tries++;
      if (!win) { if (lead.tries === 1) log('info', 'Lead ' + lead.id.slice(1) + ': no robot can take it yet. The auction stays open.', { lead: lead.id }); lead.bids = bids; continue; }
      const r = robots.find((o) => o.id === win.robot);
      lead.status = 'assigned'; lead.winner = r.id; lead.vantage = [vx, vy]; lead.bids = bids; lead.awardedAt = S.t;
      S.auctions.push({ id: 'A' + S.auctions.length, t: S.t, lead: lead.id, bids, winner: r.id });
      r.mode = 'lead'; r.lead = lead.id; r.why = 'Second look at lead ' + lead.id.slice(1);
      r.goal = { x: r.kind === 'drone' ? lead.pos[0] : vx, y: r.kind === 'drone' ? lead.pos[1] : vy, cell: vant, lead: lead.id };
      if (r.kind === 'rover') { r.path = tracePath(scratchP, cellOf(r.x, r.y)); r.pi = 0; }
      log('info', 'Lead ' + lead.id.slice(1) + ' goes to ' + r.id + ' (bid ' + win.score.toFixed(2) + ', ' + Math.round(win.eta) + ' s away). ' + (bids.filter((b) => b.eligible).length - 1) + ' other bidder' + (bids.filter((b) => b.eligible).length === 2 ? '' : 's') + ' keep searching.', { lead: lead.id, robot: r.id });
    }
  }
  function releaseLead(r, why) {
    const lead = S.leads.find((l) => l.id === r.lead); r.lead = null;
    if (lead && (lead.status === 'assigned' || lead.status === 'listening')) { lead.status = 'auction'; lead.winner = null; log('info', 'Lead ' + lead.id.slice(1) + ' is back in the auction: ' + why + '.', { lead: lead.id }); }
  }
  function secondLook(r) {
    const lead = S.leads.find((l) => l.id === r.lead), tg = world.targets.find((t) => t.id === lead.target);
    const d = Math.hypot(tg.pos[0] - r.x, tg.pos[1] - r.y), tr = trace(r.x, r.y, tg.pos[0], tg.pos[1], false);
    const ev = [], say = (sensor, result, note) => ev.push({ sensor, result, note, vantage: 'v2', unit: r.id, t: S.t });
    const isP = tg.kind === 'person', moving = tg.motion === 'moving';
    if (r.kind === 'drone') {
      say('aerial', rngS() < (isP ? 0.8 : 0.1) ? 'pos' : 'neg', 'Second pass, lower and slower');
      say('thermal', rngS() < (isP ? 0.75 : 0.05) ? 'faint' : 'neg', 'Thermal from above; a covered person shows faintly');
    } else {
      // the Wi-Fi network's rates are the measured ones from its 955-window simulated test set
      const csiOk = d <= 6.5 && tr.walls <= 1;
      const pSay = isP ? (moving ? 0.869 : 0.214) : tg.kind === 'fan' ? 0.079 : 0.111;
      for (let w = 0; w < 2; w++) say('csi', csiOk ? (rngS() < pSay ? 'pos' : 'neg') : 'blind', csiOk ? '10 s Wi-Fi window ' + (w + 1) + ' of 2' : 'Out of reach for the Wi-Fi link');
      const radarOk = d <= 6 && tr.walls <= 1;
      const rad = radarOk && rngS() < (moving ? (isP ? 0.9 : 0.8) : 0.05);
      const machine = rad && tg.kind === 'fan' && rngS() < 0.85;   // a return explained as a machine is not evidence of a person
      say('radar', radarOk ? (machine ? 'periodic' : rad ? 'pos' : 'neg') : 'blind', machine ? 'Moving target, perfectly regular' : rad ? 'Moving target' : 'No moving target');
      if (machine) say('signature', 'machine', 'Steady, periodic motion: looks like a machine');
      if (!moving && d <= 4.5 && tr.walls <= 1) say('micro', rngS() < (isP ? 0.55 : 0.1) ? 'pos' : 'neg', 'Slow repeating motion at breathing pace');
      const th = !tr.blocked && d <= 7;
      const hot = th && rngS() < (isP || tg.kind === 'heat' ? 0.9 : 0.05);
      const tooHot = hot && tg.kind === 'heat' && rngS() < 0.9;
      say('thermal', th ? (tooHot ? 'hot' : hot ? 'pos' : 'neg') : 'blind', th ? (tooHot ? 'Hot object in view' : hot ? 'Warm shape in view' : 'Nothing warm in view') : 'No line of sight for the thermal camera');
      if (tooHot) say('temperature', 'tooHot', 'Far above skin temperature');
    }
    lead.evidence.push(...ev);
    const f = fuse(lead.evidence); lead.p = f.p; lead.steps = f.steps; lead.checkedAt = S.t; lead.checkedBy = r.id;
    const c = classify(f.p);
    lead.status = c === 'confirmed' ? 'confirmed' : c === 'unlikely' ? 'rejected' : 'open';
    if (lead.status === 'confirmed') { S.m.confirmed++; log('alert', 'Lead ' + lead.id.slice(1) + ' confirmed by ' + r.id + ': person, ' + (f.p * 100).toFixed(0) + ' %. Marked for the rescue team.', { lead: lead.id, robot: r.id }); }
    else if (lead.status === 'rejected') { S.m.rejected++; log('ok', 'Lead ' + lead.id.slice(1) + ' ruled out by ' + r.id + ' (' + (f.p * 100).toFixed(0) + ' %): ' + (ev.find((e) => e.sensor === 'signature' || e.sensor === 'temperature')?.note || 'the second look found nothing') + '.', { lead: lead.id, robot: r.id }); }
    else { S.m.open++; log('warn', 'Lead ' + lead.id.slice(1) + ' is still only possible after the second look (' + (f.p * 100).toFixed(0) + ' %). Left for a person to decide.', { lead: lead.id, robot: r.id }); }
    r.lead = null; r.mode = 'explore'; r.why = ''; r.goal = null; r.path = null;
  }

  // ---- one step ----
  function step() {
    if (S.done) return;
    const dt = DT; S.t += dt; S.step++;
    if (S.step === 1) { for (const r of robots) sense(r); updateMesh(); replan(); }

    // battery scheduler: no more than a third of the fleet off-task for a swap at once
    const out = robots.filter((r) => r.mode === 'return' || r.mode === 'swap').length, maxOut = Math.max(1, Math.floor(n / 3));
    const asking = robots.filter((r) => (r.mode === 'explore' || r.mode === 'regroup') && slackOf(r) < r.cap * P.energy.window).sort((a, b) => slackOf(a) - slackOf(b));
    let granted = 0;
    for (const r of asking) {
      const forced = slackOf(r) <= 0;
      if (!forced && out + granted >= maxOut) continue;
      granted++; r.mode = 'return'; r.why = forced ? 'Battery at the return limit' : 'Battery low: swap slot granted'; r.resume = null; headHome(r);
      log('info', r.id + ' is heading back for a battery swap at ' + ((r.energy / r.cap) * 100).toFixed(0) + ' %' + (forced ? '.' : ' (early, so the swaps do not all land together).'), { robot: r.id });
    }

    let need = false, searching = 0;
    for (const r of robots) {
      const e = (powerOf(r) * dt) / 3600; r.energy = Math.max(0, r.energy - e); r.used += e; S.m.energyWh += e;
      if (r.energy <= 0 && r.mode !== 'swap' && r.mode !== 'done' && r.mode !== 'dead') { r.mode = 'dead'; r.why = 'Battery empty'; if (r.lead) releaseLead(r, r.id + ' ran out of battery'); log('alert', r.id + ' ran out of battery in the field.', { robot: r.id }); }
      switch (r.mode) {
        case 'explore': {
          searching++;
          if (r.link.ok && r.link.best < P.radio.drop) {
            if (r.relaysLeft > 0 && !S.relays.some((b) => b.alive && Math.hypot(b.x - r.x, b.y - r.y) < 3)) dropRelay(r, 'weak link');
            else if (r.relaysLeft === 0 && r.link.best < P.radio.drop - 3) { r.mode = 'return'; r.why = 'Out of beacons'; headHome(r); log('info', r.id + ' is out of beacons and returns to restock.', { robot: r.id }); break; }
          }
          if (!r.goal) { r.wait += dt; need = true; break; }
          const arrived = move(r, dt); sense(r); cueCheck(r, dt);
          if (arrived || goalStale(r)) { need = true; if (arrived) { r.goal = null; r.path = null; } }
          break;
        }
        case 'lead': {
          if (r.link.ok && r.link.best < P.radio.drop && r.relaysLeft > 0 && !S.relays.some((b) => b.alive && Math.hypot(b.x - r.x, b.y - r.y) < 3)) dropRelay(r, 'weak link');
          const arrived = move(r, dt); sense(r);
          if (arrived) { r.mode = 'listen'; r.timer = r.kind === 'drone' ? 10 : P.listenS; const lead = S.leads.find((l) => l.id === r.lead); if (lead) lead.status = 'listening'; }
          break;
        }
        case 'listen': r.timer -= dt; if (r.timer <= 0) { secondLook(r); need = true; } break;
        case 'return': case 'home': case 'regroup': {
          const arrived = move(r, dt); sense(r); if (r.mode !== 'regroup') cueCheck(r, dt);
          if (arrived) {
            if (r.mode === 'return') { r.mode = 'swap'; r.timer = P[r.kind].swapS; r.why = 'Battery swap'; }
            else if (r.mode === 'home') { r.mode = 'done'; r.why = 'Stood down at base'; r.goal = null; }
            else headHome(r);
          }
          break;
        }
        case 'swap': r.timer -= dt; if (r.timer <= 0) { if (r.energy < r.cap * 0.6) { r.swaps++; S.m.swaps++; } else S.m.restocks++; r.energy = r.cap; r.relaysLeft = P[r.kind].relays; r.mode = 'explore'; r.why = ''; r.goal = null; r.path = null; need = true; log('ok', r.id + ' has a fresh battery and ' + r.relaysLeft + ' beacons, and is back in the search.', { robot: r.id }); } break;
        default: break;
      }
    }
    if (S.step % 2 === 0 || staticDirty) { const p0 = performance.now(); updateMesh(); S.prof.mesh += performance.now() - p0; }
    if (S.m.tExplored == null) { S.m.searchS += searching * dt; S.m.clash += clashNow * dt; if (S.t > 20 && searching < S.m.minSearching) S.m.minSearching = searching; }
    if ((need && S.t - lastReplan >= 1.5) || S.t - lastReplan >= 6) replan();

    const m = S.m; m.coverage = m.covered / world.reachCount; m.indoorCoverage = world.reachIndoor ? m.coveredIn / world.reachIndoor : 0;
    if (m.t50 == null && m.coverage >= 0.5) m.t50 = S.t;
    if (m.t90 == null && m.coverage >= 0.9) m.t90 = S.t;
    if (m.t95 == null && m.coverage >= 0.95) { m.t95 = S.t; log('ok', '95 % of the reachable floor is mapped after ' + Math.floor(S.t / 60) + ' min ' + Math.round(S.t % 60) + ' s.'); }
    if (S.step % Math.round(S.seriesDt / DT) === 0) S.series.push(m.coverage);
    if ((m.tExplored != null && robots.every((r) => r.mode === 'done' || r.mode === 'dead')) || S.t > 4 * 3600 || robots.every((r) => r.mode === 'dead' || r.mode === 'done')) { S.done = true; if (m.tExplored == null) m.tExplored = S.t; }
  }

  function summary() {
    const m = S.m;
    return { strategy: S.strategy, n, seed: world.seed, layout: world.layout, t: S.t, coverage: m.coverage, indoorCoverage: m.indoorCoverage, t50: m.t50, t90: m.t90, t95: m.t95, tExplored: m.tExplored, tFirstLead: m.tFirstLead,
      dist: m.distRover + m.distDrone, distRover: m.distRover, distDrone: m.distDrone, energyWh: m.energyWh, swaps: m.swaps, restocks: m.restocks, relays: m.relays, clashShare: m.searchS ? m.clash / m.searchS : 0,
      leads: S.leads.length, confirmed: m.confirmed, rejected: m.rejected, open: m.open, people: world.targets.filter((t) => t.kind === 'person').length, peopleCued: world.targets.filter((t) => t.kind === 'person' && cued.has(t.id)).length, minSearching: m.minSearching, done: S.done };
  }
  return { world, state: S, step, failRelay, summary, backbone: () => backbone, params: P };
}

// Run one whole search with no drawing. Used by the benchmark and by the self-test.
export function runHeadless(world, opts, { maxT = 3 * 3600, stopAtExplored = true } = {}) {
  const sw = createSwarm(world, opts);
  while (!sw.state.done && sw.state.t < maxT && !(stopAtExplored && sw.state.m.tExplored != null)) sw.step();
  return { ...sw.summary(), series: sw.state.series };
}
