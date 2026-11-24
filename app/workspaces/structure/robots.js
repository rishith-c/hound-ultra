// Structure lab: routes through the void network for robots that go where a rover cannot. A turn-limited, support-aware
// shortest-path search on the 10 cm voxel grid, started from every open-air voxel at once, so it also finds the best way in.
// The hardware is a concept; the planner is real and runs on the simulated pile.
export const ROBOTS = [
  { id: 'vine', label: 'Vine robot', color: 'accent', radius: 0.05, maxTurn: 45, support: false, maxLen: 12, climbs: true,
    spec: ['Grows from the tip by everting its skin, so the body never slides against the rubble', 'Body 8 cm across (design value); passes a 10 cm gap', 'Bends no tighter than about 13 cm radius: at most 45° per 10 cm of growth (design value)', '12 m of body on the reel (design value)'] },
  { id: 'snake', label: 'Snake robot', color: 'ok', radius: 0.05, maxTurn: 90, support: true, maxSpan: 0.3, maxLen: 6, climbs: true,
    spec: ['16 jointed modules, 5.1 cm across and 94 cm long (Carnegie Mellon Unified Snake)', 'Needs a surface under it or a gap narrow enough to brace in; bridges at most 30 cm of open air (design value)', '6 m tether (design value)'] },
  { id: 'rover', label: 'HOUND rover', color: 'warn', radius: 0.25, maxTurn: 180, support: true, maxSpan: 0, maxLen: 60, flat: true,
    spec: ['Needs a passage 50 cm across (design value)', 'Wheels on a surface the whole way; steps under 10 cm in this model'] },
];
const DIRS = []; for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz); if (m === 1 || m === 2) DIRS.push([dx, dy, dz, Math.sqrt(m)]); }

class Heap { constructor() { this.k = []; this.v = []; } get size() { return this.k.length; }
  push(key, val) { const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val); while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; } k[i] = key; v[i] = val; }
  pop() { const k = this.k, v = this.v, top = v[0], key = k.pop(), val = v.pop(), n = k.length; if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= key) break; k[i] = k[c]; v[i] = v[c]; i = c; } k[i] = key; v[i] = val; } return top; } }

// Flood the whole reachable network for one robot. Returns per-voxel cost, path length and predecessor.
export function reach(g, bot) {
  const { n, nx, ny, nz, sl, d2, solid, roofed, res } = g;
  const need = ((bot.radius + res / 2) / res) ** 2 - 1e-6, open2 = (0.5 / res + 0.5) ** 2;
  const cost = new Float32Array(n).fill(Infinity), plen = new Float32Array(n), prev = new Int32Array(n).fill(-1), pdir = new Int8Array(n).fill(-1), run = new Float32Array(n);
  const cosMax = Math.cos(bot.maxTurn * Math.PI / 180) - 1e-6;
  const lift = bot.flat ? Math.ceil(bot.radius / res - 1e-6) : 1;   // a wheeled body's centre rides its own radius above the surface
  const supported = (id) => { if (id - lift * sl >= 0 && solid[id - lift * sl]) return true; if (bot.flat) return false; if (id - 2 * sl >= 0 && solid[id - 2 * sl]) return true; return d2[id] <= 2.01; };
  const heap = new Heap(); const src = new Uint8Array(n);
  for (let y = 1; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const id = x + nx * (z + nz * y);
    if (solid[id] || roofed[id] || d2[id] < need) continue;
    // open air: half a metre clear of everything. A robot that stands on the ground is tested 60 cm above where it stands.
    { const o = bot.support ? id + 6 * sl : id; if (o < n && (solid[o] || d2[o] < open2)) continue; }
    // the robot is put down by hand: its start must sit on, or just above, something a rescuer can reach
    { const down = bot.flat ? lift : bot.support ? 3 : 8; let ok = false; for (let k = 1; k <= down && y - k >= 0; k++) if (solid[id - k * sl]) { ok = true; break; } if (!ok) continue; if (bot.support && !bot.flat && (y - 0.5) * res > 2.5) continue; }
    src[id] = 1; cost[id] = 0;
  }
  for (let id = 0; id < n; id++) { if (!src[id]) continue; const y = Math.floor(id / sl), r = id - y * sl, z = Math.floor(r / nx), x = r - z * nx; let edge = false; for (const [dx, dy, dz] of DIRS) { if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) !== 1) continue; const X = x + dx, Y = y + dy, Z = z + dz; if (X < 0 || Y < 1 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue; const u = X + nx * (Z + nz * Y); if (!src[u] && !solid[u]) { edge = true; break; } } if (edge) heap.push(0, id); }
  let expanded = 0;
  while (heap.size) {
    const v = heap.pop(); expanded++;
    const cv = cost[v], y = Math.floor(v / sl), r = v - y * sl, z = Math.floor(r / nx), x = r - z * nx, pd = pdir[v];
    for (let k = 0; k < DIRS.length; k++) {
      const [dx, dy, dz, len] = DIRS[k], X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 0 || Y < 1 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
      const u = X + nx * (Z + nz * Y);
      if (solid[u] || src[u] || d2[u] < need) continue;
      if (len > 1) { // a diagonal step must not cut a corner
        const a = dx ? v + dx : -1, b = dy ? v + dy * sl : -1, c = dz ? v + dz * nx : -1;
        if ((a >= 0 && (solid[a] || d2[a] < need)) || (b >= 0 && (solid[b] || d2[b] < need)) || (c >= 0 && (solid[c] || d2[c] < need))) continue;
      }
      if (bot.flat && dy !== 0) continue;
      if (pd >= 0) { const q = DIRS[pd]; if ((q[0] * dx + q[1] * dy + q[2] * dz) / (q[3] * len) < cosMax) continue; }
      let rn = 0;
      if (bot.support) { rn = supported(u) ? 0 : run[v] + len * res; if (rn > bot.maxSpan + 1e-6) continue; }
      const L = plen[v] + len * res; if (L > bot.maxLen) continue;
      const c = Math.sqrt(d2[u]) * res - res / 2, nc = cv + len * res * (1 + 0.6 * Math.max(0, 1 - c / 0.25));
      if (nc < cost[u] - 1e-6) { cost[u] = nc; plen[u] = L; prev[u] = v; pdir[u] = k; run[u] = rn; heap.push(nc, u); }
    }
  }
  return { bot, lift, cost, plen, prev, src, expanded };
}
// The route into a set of voxels (a void, or the protected volume): the cheapest reached voxel, traced back to open air.
export function routeTo(g, field, voxels) {
  let best = -1, bc = Infinity;
  // a robot that stands on something is there when it stands on the floor straight below the void
  const { bot, lift } = field, under = (v) => { if (!bot.support) return v; let u = v; while (u - g.sl >= 0 && !g.solid[u - g.sl]) u -= g.sl; return u + (lift - 1) * g.sl; };
  for (let i = 0; i < voxels.length; i++) { const v = under(voxels[i]); if (v >= 0 && field.cost[v] < bc) { bc = field.cost[v]; best = v; } }
  if (best < 0) return null;
  const ids = []; for (let v = best; v >= 0; v = field.prev[v]) ids.push(v); ids.reverse();
  const raw = ids.map((id) => g.pos(id));
  let minC = Infinity; for (const id of ids) if (!field.src[id]) minC = Math.min(minC, Math.sqrt(g.d2[id]) * g.res - g.res / 2);
  // smooth for drawing and for the bend measurement (Chaikin corner cutting, twice)
  let pts = raw; for (let it = 0; it < 2; it++) { const o = [pts[0]]; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] * 0.75 + b[2] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] * 0.25 + b[2] * 0.75]); } o.push(pts[pts.length - 1]); pts = o; }
  let turn = 0, minR = Infinity;
  for (let i = 1; i < raw.length - 1; i++) { const a = raw[i - 1], b = raw[i], c = raw[i + 1]; const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - b[0], c[1] - b[1], c[2] - b[2]]; const cu = Math.hypot(...u), cw = Math.hypot(...w); const ang = Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (cu * cw)))); turn += ang; if (ang > 1e-3) minR = Math.min(minR, (cu + cw) / 2 / (2 * Math.sin(ang / 2))); }
  return { ids, pts, raw, length: field.plen[best], minClear: minC === Infinity ? 0 : minC, turn, minBend: minR, entry: raw[0], end: raw[raw.length - 1] };
}
