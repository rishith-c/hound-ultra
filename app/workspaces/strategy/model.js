// Search theory core. One Bayesian map, one sensor model, used by every exhibit in this lab.
//
// THE MAP. The area is cut into cells. Each cell holds two numbers: the probability that a MOVING person is in
// it and the probability that a STILL person is in it (a person is one or the other; cells are treated as
// independent). The number of people is unknown, so the map does not sum to one: it sums to the expected number
// of people not yet found. This is Koopman's search theory for an unknown number of targets.
//
// THE SENSORS. A 10 s stop is one "look" with four sensors. For a person of type k in cell c, sensor j fires with
// probability d[j][k][c] (the probability of detection, PoD), and with no one in reach it fires with probability
// f[j] (false alarm). Wi-Fi and the presence radar answer for the whole reach ("someone, somewhere"); the
// tracking radar and the thermal camera report a position.
//
//   Wi-Fi network   MEASURED on the 955 simulated test windows (rover-design-study/ml/results/synthetic.md):
//                   moving person found 86.9 %; still person found 21.4 % overall and, by depth behind the wall,
//                   28.5 % (0.5 to 1.4 m), 19.0 % (1.4 to 2.3 m), 16.7 % (2.3 to 3.3 m); false alarm 11.1 %
//                   (13.0 % without a fan, 7.9 % with one). Reach 6.5 m through at most one wall (world.SENSORS).
//                   Beyond 3.3 m behind a wall the last measured value is held: that part is an assumption.
//   Radar, thermal  ASSUMED. The console's fusion (core/fusion.js) uses assumed likelihood ratios; the detection
//                   and false-alarm rates below are the ones those ratios imply (LR+ = d/f, LR- = (1-d)/(1-f)),
//                   split by who each sensor can see: the tracking radar sees movers, the presence radar sees
//                   still people, the thermal camera sees anyone in line of sight.
//                     tracking radar  LR 6 / 0.7  ->  d = 34.0 %, f = 5.7 %;  all on movers: 34.0 / 0.40 = 85 %
//                     presence radar  LR 3 / 0.8  ->  d = 27.3 %, f = 9.1 %;  all on still people: 27.3 / 0.60 = 45.5 %
//                     thermal         LR 8 / 0.5  ->  d = 53.3 %, f = 6.7 %;  half that behind low furniture
//   Share of people who are moving: 40 %, the mix of the network's test set (assumed for a real site).
//
// THE UPDATE (Bayes' rule, exact for independent cells):
//   a sensor stays quiet      p_k <- p_k (1 - d_k) / (1 - p_m d_m - p_s d_s)            for every cell in reach
//   a position report at c    p_k <- p_k (1 - (1 - d_k)(1 - f/n)) / Z                   for that cell (n cells in reach)
//   a whole-reach alarm       p_k <- p_k (1 - (1 - f)(1 - d_k) Q / q_c) / (1 - (1 - f) Q), Q = prod over cells of
//                             q_c = 1 - p_m d_m - p_s d_s. After an alarm the cells are no longer independent;
//                             the map keeps each cell's own probability (a mean-field approximation).

export const SENSOR_IDS = ['csi', 'radar', 'micro', 'thermal'];
export const SENSOR_NAMES = { csi: 'Wi-Fi network', radar: 'Tracking radar', micro: 'Presence radar', thermal: 'Thermal camera' };

// The sensor model. Pass overrides to ask "what if": { csi: { range: 13 }, thermal: { on: false } }.
export function makeSensors(over = {}) {
  const base = {
    pMove: 0.4,
    csi: { on: true, range: 6.5, maxWalls: 1, los: false, local: false, f: 0.111, fFan: 0.079, fNoFan: 0.13, dMove: 0.869, dStill: 0.214, depth: [[1.4, 0.285], [2.3, 0.19], [1e9, 0.167]], assumed: false },
    radar: { on: true, range: 6, maxWalls: 1, los: false, local: true, f: 0.3 / 5.3, dMove: (6 * 0.3 / 5.3) / 0.4, dStill: 0, assumed: true },
    micro: { on: true, range: 4.5, maxWalls: 1, los: false, local: false, f: 0.2 / 2.2, dMove: 0, dStill: (3 * 0.2 / 2.2) / 0.6, assumed: true },
    thermal: { on: true, range: 7, maxWalls: 0, los: true, local: true, f: 0.5 / 7.5, dMove: 8 * 0.5 / 7.5, dStill: 8 * 0.5 / 7.5, partial: 0.5, assumed: true },
  };
  const S = { pMove: over.pMove ?? base.pMove };
  for (const id of SENSOR_IDS) S[id] = { id, ...base[id], ...(over[id] || {}) };
  S.list = SENSOR_IDS.map((id) => S[id]);
  S.maxRange = Math.max(...S.list.filter((s) => s.on).map((s) => s.range), 0);
  return S;
}

// Probability that sensor s fires on a person of the given type. walls = walls on the line, depth = metres from
// the wall crossing to the person (0 with no wall), sight = 'clear' | 'partial' | 'blocked' (furniture, rubble).
export function pod(s, moving, r, walls, depth, sight) {
  if (!s.on || r > s.range || walls > s.maxWalls) return 0;
  if (s.los) { if (sight === 'blocked') return 0; return (moving ? s.dMove : s.dStill) * (sight === 'partial' ? s.partial : 1); }
  if (moving) return s.dMove;
  if (s.depth && walls > 0) { for (const [lim, v] of s.depth) if (depth < lim) return v; }
  return s.dStill;
}

// ---------- geometry of a look ----------
// geom: { n, cx, cy (Float32Array cell centres), walls: Float32Array [ax, ay, bx, by, ...], blocks: [{ poly, partial }],
//         lattice?: { x0, y0, res, w, h, cell: Int32Array (lattice index -> cell index, or -1) } }
export function flatWalls(walls) { const a = new Float32Array(walls.length * 4); walls.forEach((w, i) => { a[i * 4] = w.a[0]; a[i * 4 + 1] = w.a[1]; a[i * 4 + 2] = w.b[0]; a[i * 4 + 3] = w.b[1]; }); return a; }

// Walls crossed by the segment p-q. Returns the count; out[0] is the distance from the last crossing to q.
const cross = [0];
function wallsOnLine(W, px, py, qx, qy, out) {
  let n = 0, tMax = 0; const rx = qx - px, ry = qy - py;
  for (let i = 0; i < W.length; i += 4) {
    const sx = W[i + 2] - W[i], sy = W[i + 3] - W[i + 1], den = rx * sy - ry * sx;
    if (den > -1e-12 && den < 1e-12) continue;
    const t = ((W[i] - px) * sy - (W[i + 1] - py) * sx) / den, u = ((W[i] - px) * ry - (W[i + 1] - py) * rx) / den;
    if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) { n++; if (t > tMax) tMax = t; }
  }
  out[0] = (1 - tMax) * Math.hypot(rx, ry);
  return n;
}
function segHitsPoly(px, py, qx, qy, poly) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], rx = qx - px, ry = qy - py, sx = b[0] - a[0], sy = b[1] - a[1], den = rx * sy - ry * sx;
    if (den > -1e-12 && den < 1e-12) continue;
    const t = ((a[0] - px) * sy - (a[1] - py) * sx) / den, u = ((a[0] - px) * ry - (a[1] - py) * rx) / den;
    if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) return true;
  }
  return false;
}
function sightOf(geom, px, py, qx, qy) {
  let partial = false;
  for (const b of geom.blocks || []) { if (!segHitsPoly(px, py, qx, qy, b.poly)) continue; if (b.partial) partial = true; else return 'blocked'; }
  return partial ? 'partial' : 'clear';
}

// Everything one look from pos can sense: the cells in reach and each sensor's PoD on them.
// Returns { n, pos, idx: Int32Array, dm: Float32Array(4n), ds: Float32Array(4n), cnt: [cells in reach per sensor] }.
export function traceReach(geom, pos, S) {
  const R = S.maxRange, px = pos[0], py = pos[1], idx = [], dm = [], ds = [], cnt = [0, 0, 0, 0];
  const visit = (c) => {
    const qx = geom.cx[c], qy = geom.cy[c], r = Math.hypot(qx - px, qy - py);
    if (r > R) return;
    const walls = wallsOnLine(geom.walls, px, py, qx, qy, cross), depth = walls ? cross[0] : 0;
    let sight = null, any = false; const m = [0, 0, 0, 0], s = [0, 0, 0, 0];
    for (let j = 0; j < 4; j++) {
      const sn = S.list[j]; if (!sn.on || r > sn.range || walls > sn.maxWalls) continue;
      if (sn.los && sight === null) sight = sightOf(geom, px, py, qx, qy);
      m[j] = pod(sn, true, r, walls, depth, sight); s[j] = pod(sn, false, r, walls, depth, sight);
      if (m[j] > 0 || s[j] > 0) { any = true; cnt[j]++; }
    }
    if (any) { idx.push(c); dm.push(...m); ds.push(...s); }
  };
  const L = geom.lattice;
  if (L) {
    const i0 = Math.max(0, Math.floor((px - R - L.x0) / L.res)), i1 = Math.min(L.w - 1, Math.ceil((px + R - L.x0) / L.res));
    const j0 = Math.max(0, Math.floor((py - R - L.y0) / L.res)), j1 = Math.min(L.h - 1, Math.ceil((py + R - L.y0) / L.res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = L.cell ? L.cell[j * L.w + i] : j * L.w + i; if (c >= 0) visit(c); }
  } else for (let c = 0; c < geom.n; c++) visit(c);
  return { n: idx.length, pos: [px, py], idx: Int32Array.from(idx), dm: Float32Array.from(dm), ds: Float32Array.from(ds), cnt };
}

// ---------- the belief ----------
export function makeBelief(n) { return { n, pm: new Float32Array(n), ps: new Float32Array(n) }; }
export function copyBelief(B, into) { if (!into) into = makeBelief(B.n); into.pm.set(B.pm); into.ps.set(B.ps); return into; }
export function expectedPeople(B) { let s = 0; for (let c = 0; c < B.n; c++) s += B.pm[c] + B.ps[c]; return s; }
const h3 = (a, b) => { const e = 1 - a - b; let h = 0; if (a > 1e-12) h -= a * Math.log2(a); if (b > 1e-12) h -= b * Math.log2(b); if (e > 1e-12) h -= e * Math.log2(e); return h; };
// Entropy of the map in bits: how much is still unknown about where people are.
export function entropy(B) { let s = 0; for (let c = 0; c < B.n; c++) s += h3(B.pm[c], B.ps[c]); return s; }

// Sensor j stayed quiet over its reach.
export function quiet(B, reach, j) {
  const { idx, dm, ds, n } = reach, pm = B.pm, ps = B.ps;
  for (let k = 0; k < n; k++) {
    const a = dm[k * 4 + j], b = ds[k * 4 + j]; if (a === 0 && b === 0) continue;
    const c = idx[k], den = 1 - pm[c] * a - ps[c] * b;
    pm[c] = (pm[c] * (1 - a)) / den; ps[c] = (ps[c] * (1 - b)) / den;
  }
}
// Sensor j raised an alarm for its whole reach, with false-alarm rate f. Returns the probability of that alarm.
export function alarm(B, reach, j, f) {
  const { idx, dm, ds, n } = reach, pm = B.pm, ps = B.ps;
  let logQ = 0;
  for (let k = 0; k < n; k++) { const c = idx[k]; logQ += Math.log(1 - pm[c] * dm[k * 4 + j] - ps[c] * ds[k * 4 + j]); }
  const Q = Math.exp(logQ), pA = 1 - (1 - f) * Q;
  for (let k = 0; k < n; k++) {
    const a = dm[k * 4 + j], b = ds[k * 4 + j]; if (a === 0 && b === 0) continue;
    const c = idx[k], Qc = Q / (1 - pm[c] * a - ps[c] * b);
    pm[c] = (pm[c] * (1 - (1 - f) * (1 - a) * Qc)) / pA; ps[c] = (ps[c] * (1 - (1 - f) * (1 - b) * Qc)) / pA;
  }
  return pA;
}
// A position-reporting sensor j: 'reported' is the set of reach slots (positions in reach.idx) it pointed at.
export function reports(B, reach, j, f, reported) {
  const { idx, dm, ds, n, cnt } = reach, pm = B.pm, ps = B.ps, fc = f / Math.max(1, cnt[j]);
  for (let k = 0; k < n; k++) {
    const a = dm[k * 4 + j], b = ds[k * 4 + j]; if (a === 0 && b === 0) continue;
    const c = idx[k];
    if (reported && reported.includes(k)) {
      const lm = 1 - (1 - a) * (1 - fc), ls = 1 - (1 - b) * (1 - fc), z = pm[c] * lm + ps[c] * ls + (1 - pm[c] - ps[c]) * fc;
      pm[c] = (pm[c] * lm) / z; ps[c] = (ps[c] * ls) / z;
    } else { const den = 1 - pm[c] * a - ps[c] * b; pm[c] = (pm[c] * (1 - a)) / den; ps[c] = (ps[c] * (1 - b)) / den; }
  }
}
// One whole look. obs = { csi: 0 | 1 | null, micro: 0 | 1 | null, radar: null | [slots], thermal: null | [slots] };
// null means the sensor gave no usable answer (off, failed, or its alarm was already explained by a known lead).
export function applyLook(B, reach, S, obs) {
  if (S.radar.on && obs.radar) reports(B, reach, 1, S.radar.f, obs.radar);
  if (S.thermal.on && obs.thermal) reports(B, reach, 3, S.thermal.f, obs.thermal);
  if (S.micro.on && obs.micro != null) { if (obs.micro) alarm(B, reach, 2, S.micro.f); else quiet(B, reach, 2); }
  if (S.csi.on && obs.csi != null) { if (obs.csi) alarm(B, reach, 0, obs.csiF ?? S.csi.f); else quiet(B, reach, 0); }
}
export const QUIET = Object.freeze({ csi: 0, micro: 0, radar: [], thermal: [] });

// Expected number of people this look would make at least one sensor fire on (Koopman's probability of success
// for the look, summed over the people expected in reach).
export function expectedFinds(B, reach) {
  const { idx, dm, ds, n } = reach; let s = 0;
  for (let k = 0; k < n; k++) {
    const c = idx[k], o = k * 4;
    s += B.pm[c] * (1 - (1 - dm[o]) * (1 - dm[o + 1]) * (1 - dm[o + 2]) * (1 - dm[o + 3])) + B.ps[c] * (1 - (1 - ds[o]) * (1 - ds[o + 1]) * (1 - ds[o + 2]) * (1 - ds[o + 3]));
  }
  return s;
}

// Expected information gain of one look, in bits: the expected drop in the map's entropy,
//   sum over cells of I(cell ; what the four sensors say).
// Exact under the map's independence assumption. For a cell, the two whole-reach sensors (Wi-Fi, presence radar)
// depend on every other cell in reach through the products G below; the two position sensors depend on it alone.
const xlog = (p) => (p > 1e-300 ? p * Math.log2(p) : 0);
export function infoGain(B, reach, S) {
  const { idx, dm, ds, n, cnt } = reach, pm = B.pm, ps = B.ps;
  if (!n) return 0;
  const f0 = S.csi.on ? S.csi.f : 0, f2 = S.micro.on ? S.micro.f : 0;
  let l0 = 0, l2 = 0, l02 = 0;
  for (let k = 0; k < n; k++) {
    const c = idx[k], o = k * 4, a0 = dm[o], b0 = ds[o], a2 = dm[o + 2], b2 = ds[o + 2];
    l0 += Math.log(1 - pm[c] * a0 - ps[c] * b0); l2 += Math.log(1 - pm[c] * a2 - ps[c] * b2);
    l02 += Math.log(1 - pm[c] * (1 - (1 - a0) * (1 - a2)) - ps[c] * (1 - (1 - b0) * (1 - b2)));
  }
  const G0 = (1 - f0) * Math.exp(l0), G2 = (1 - f2) * Math.exp(l2), G02 = (1 - f0) * (1 - f2) * Math.exp(l02);
  const fr = S.radar.on ? S.radar.f / Math.max(1, cnt[1]) : 0, ft = S.thermal.on ? S.thermal.f / Math.max(1, cnt[3]) : 0;
  const P = new Float64Array(48); // P[state * 16 + outcome]
  let total = 0;
  for (let k = 0; k < n; k++) {
    const c = idx[k], o = k * 4, m = pm[c], s = ps[c];
    if (m + s < 1e-9) continue;
    const a0 = dm[o], b0 = ds[o], a1 = dm[o + 1], b1 = ds[o + 1], a2 = dm[o + 2], b2 = ds[o + 2], a3 = dm[o + 3], b3 = ds[o + 3];
    const g0 = G0 / (1 - m * a0 - s * b0), g2 = G2 / (1 - m * a2 - s * b2), g02 = G02 / (1 - m * (1 - (1 - a0) * (1 - a2)) - s * (1 - (1 - b0) * (1 - b2)));
    const pri = [1 - m - s, m, s];
    let hCond = 0;
    for (let st = 0; st < 3; st++) {
      const d0 = st === 1 ? a0 : st === 2 ? b0 : 0, d1 = st === 1 ? a1 : st === 2 ? b1 : 0, d2 = st === 1 ? a2 : st === 2 ? b2 : 0, d3 = st === 1 ? a3 : st === 2 ? b3 : 0;
      const n0 = g0 * (1 - d0), n2 = g2 * (1 - d2), n02 = g02 * (1 - d0) * (1 - d2);
      const q00 = n02, q01 = Math.max(0, n0 - n02), q10 = Math.max(0, n2 - n02), q11 = Math.max(0, 1 - n0 - n2 + n02); // (csi, micro)
      const r1 = 1 - (1 - d1) * (1 - fr), r3 = 1 - (1 - d3) * (1 - ft), base = st * 16;
      const reg = [q00, q01, q10, q11];
      for (let a = 0; a < 4; a++) { const ra = reg[a]; P[base + a * 4] = ra * (1 - r1) * (1 - r3); P[base + a * 4 + 1] = ra * r1 * (1 - r3); P[base + a * 4 + 2] = ra * (1 - r1) * r3; P[base + a * 4 + 3] = ra * r1 * r3; }
      if (pri[st] > 0) hCond += pri[st] * -(xlog(q00) + xlog(q01) + xlog(q10) + xlog(q11) + xlog(r1) + xlog(1 - r1) + xlog(r3) + xlog(1 - r3));
    }
    let hO = 0;
    for (let q = 0; q < 16; q++) hO -= xlog(pri[0] * P[q] + pri[1] * P[16 + q] + pri[2] * P[32 + q]);
    const mi = hO - hCond; if (mi > 0) total += mi;
  }
  return total;
}

// Draw what the sensors would say at this look, given who is really there (used by the random-world trials and
// by the tree search, which samples "who is there" from the belief).
//   people: [{ slot (position in reach.idx, or -1 when out of reach), moving }]; decoys: { fan: bool, heatSlots: [slot] }
export function sampleObs(reach, S, people, decoys, rng) {
  const obs = { csi: S.csi.on ? 0 : null, micro: S.micro.on ? 0 : null, radar: S.radar.on ? [] : null, thermal: S.thermal.on ? [] : null, csiF: undefined };
  const { dm, ds, cnt, n } = reach;
  for (const p of people) {
    if (p.slot < 0) continue; const o = p.slot * 4, d = p.moving ? dm : ds;
    if (obs.csi === 0 && rng() < d[o]) obs.csi = 1;
    if (obs.radar && rng() < d[o + 1] && !obs.radar.includes(p.slot)) obs.radar.push(p.slot);
    if (obs.micro === 0 && rng() < d[o + 2]) obs.micro = 1;
    if (obs.thermal && rng() < d[o + 3] && !obs.thermal.includes(p.slot)) obs.thermal.push(p.slot);
  }
  if (!n) return obs;
  const fan = decoys && decoys.fan;
  if (obs.csi === 0 && cnt[0] && rng() < (fan == null ? S.csi.f : fan ? S.csi.fFan : S.csi.fNoFan)) obs.csi = 1;
  if (obs.micro === 0 && cnt[2] && rng() < S.micro.f) obs.micro = 1;
  if (obs.radar && cnt[1] && rng() < S.radar.f) { const k = pickSlot(reach, 1, rng); if (k >= 0 && !obs.radar.includes(k)) obs.radar.push(k); }
  if (obs.thermal && cnt[3] && rng() < S.thermal.f) { const k = pickSlot(reach, 3, rng); if (k >= 0 && !obs.thermal.includes(k)) obs.thermal.push(k); }
  return obs;
}
function pickSlot(reach, j, rng) {
  let want = Math.floor(rng() * reach.cnt[j]);
  for (let k = 0; k < reach.n; k++) if (reach.dm[k * 4 + j] > 0 || reach.ds[k * 4 + j] > 0) { if (want-- === 0) return k; }
  return -1;
}

// ---------- travel ----------
// Shortest driving distance in metres from one point to every free cell of a planning grid (the grid of
// core/world.js: { w, h, res, blocked, cost }). Hazards cost extra, as in the route planner, but the number
// returned is the real length of the cheapest route. Unreachable cells are Infinity.
export function distField(grid, from) {
  const W = grid.w, H = grid.h, N = W * H, cost = new Float32Array(N).fill(Infinity), len = new Float32Array(N).fill(Infinity), done = new Uint8Array(N);
  let si = Math.min(W - 1, Math.max(0, Math.floor(from[0] / grid.res))), sj = Math.min(H - 1, Math.max(0, Math.floor(from[1] / grid.res)));
  if (grid.blocked[sj * W + si]) { // start inside a wall's clearance: step to the nearest free cell
    let best = -1, bd = 1e9;
    for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) { const i = si + di, j = sj + dj; if (i < 0 || j < 0 || i >= W || j >= H || grid.blocked[j * W + i]) continue; const d = di * di + dj * dj; if (d < bd) { bd = d; best = j * W + i; } }
    if (best < 0) return len; si = best % W; sj = (best - si) / W;
  }
  const heap = [], hk = []; // binary heap of cell ids keyed by cost
  const push = (id, k) => { let i = heap.length; heap.push(id); hk.push(k); while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; heap[i] = heap[p]; hk[i] = hk[p]; i = p; } heap[i] = id; hk[i] = k; };
  const pop = () => { const top = heap[0], id = heap.pop(), k = hk.pop(), n = heap.length; if (n) { let i = 0; for (;;) { let l = 2 * i + 1; if (l >= n) break; if (l + 1 < n && hk[l + 1] < hk[l]) l++; if (hk[l] >= k) break; heap[i] = heap[l]; hk[i] = hk[l]; i = l; } heap[i] = id; hk[i] = k; } return top; };
  const s = sj * W + si; cost[s] = 0; len[s] = 0; push(s, 0);
  while (heap.length) {
    const u = pop(); if (done[u]) continue; done[u] = 1;
    const ui = u % W, uj = (u - ui) / W;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const i = ui + di, j = uj + dj; if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const v = j * W + i; if (done[v] || grid.blocked[v]) continue;
      if (di && dj && (grid.blocked[uj * W + i] || grid.blocked[j * W + ui])) continue;
      const step = di && dj ? Math.SQRT2 : 1, nc = cost[u] + step * grid.cost[v];
      if (nc < cost[v]) { cost[v] = nc; len[v] = len[u] + step * grid.res; push(v, nc); }
    }
  }
  return len;
}
export function fieldAt(grid, field, p) { const i = Math.floor(p[0] / grid.res), j = Math.floor(p[1] / grid.res); if (i < 0 || j < 0 || i >= grid.w || j >= grid.h) return Infinity; let v = field[j * grid.w + i]; if (v < Infinity) return v;
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= grid.w || b >= grid.h) continue; const x = field[b * grid.w + a] + Math.hypot(di, dj) * grid.res; if (x < v) v = x; } return v; }

export const ROVER_SPEED = 0.42, WINDOW_S = 10;
