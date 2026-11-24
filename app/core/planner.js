// Path planning: A* on the world grid, then a line-of-sight pass that removes needless corners.
// planPath(grid, from, to) returns { ok, path: [[x, y], ...], length (m), cost, expanded } or { ok: false, reason }.
// The grid comes from world.buildGrid(), so hazards and blockages are already priced in.
import { dist, pathLength } from './geometry.js';

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
}

// Nearest free cell to c, searched in growing rings. Lets a goal sit against a wall.
function nearestFree(grid, c, maxR = 8) {
  const ok = (i, j) => i >= 0 && j >= 0 && i < grid.w && j < grid.h && !grid.blocked[j * grid.w + i];
  if (ok(c[0], c[1])) return c;
  for (let r = 1; r <= maxR; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    if (ok(c[0] + di, c[1] + dj)) return [c[0] + di, c[1] + dj];
  }
  return null;
}

// True when the straight line a-b stays on free cells whose cost is no higher than maxCost.
export function gridClear(grid, a, b, maxCost = Infinity) {
  const n = Math.ceil(dist(a, b) / (grid.res * 0.5));
  for (let k = 0; k <= n; k++) {
    const t = n ? k / n : 0, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    const i = Math.floor(x / grid.res), j = Math.floor(y / grid.res);
    if (i < 0 || j < 0 || i >= grid.w || j >= grid.h) return false;
    const idx = j * grid.w + i;
    if (grid.blocked[idx] || grid.cost[idx] > maxCost) return false;
  }
  return true;
}

// With { nearest: true } an unreachable goal returns the path to the closest reachable point instead of failing
// (reached: false, gap: metres left). That closest point is where a rescue team would have to break through.
export function planPath(grid, from, to, { nearest = false } = {}) {
  const s = nearestFree(grid, grid.toCell(from)), g = nearestFree(grid, grid.toCell(to));
  if (!s) return { ok: false, reason: 'The start is inside a wall or debris.' };
  if (!g) return { ok: false, reason: 'The goal is inside a wall or debris.' };
  const W = grid.w, H = grid.h, key = (i, j) => j * W + i;
  const gScore = new Float32Array(W * H).fill(Infinity), came = new Int32Array(W * H).fill(-1), closed = new Uint8Array(W * H);
  const hOf = (i, j) => { const dx = Math.abs(i - g[0]), dy = Math.abs(j - g[1]); return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)); };
  const open = new Heap();
  gScore[key(s[0], s[1])] = 0;
  open.push({ i: s[0], j: s[1], f: hOf(s[0], s[1]) });
  let expanded = 0;
  while (open.size) {
    const cur = open.pop(), ck = key(cur.i, cur.j);
    if (closed[ck]) continue;
    closed[ck] = 1; expanded++;
    if (cur.i === g[0] && cur.j === g[1]) break;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = cur.i + di, nj = cur.j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = key(ni, nj);
      if (grid.blocked[nk] || closed[nk]) continue;
      if (di && dj && (grid.blocked[key(cur.i + di, cur.j)] || grid.blocked[key(cur.i, cur.j + dj)])) continue; // no corner cutting
      const step = (di && dj ? Math.SQRT2 : 1) * grid.cost[nk];
      const ng = gScore[ck] + step;
      if (ng < gScore[nk]) { gScore[nk] = ng; came[nk] = ck; open.push({ i: ni, j: nj, f: ng + hOf(ni, nj) }); }
    }
  }
  let gk = key(g[0], g[1]);
  let reached = true, gap = 0;
  if (!closed[gk]) {
    if (!nearest) return { ok: false, reason: 'No safe way through. Every route is blocked.', expanded };
    let best = -1, bestD = Infinity;
    for (let k = 0; k < closed.length; k++) {
      if (!closed[k]) continue;
      const d = Math.hypot((k % W) - g[0], Math.floor(k / W) - g[1]);
      if (d < bestD) { bestD = d; best = k; }
    }
    gk = best; reached = false; gap = bestD * grid.res;
  }
  const cells = [];
  for (let k = gk; k !== -1; k = came[k]) cells.push([k % W, Math.floor(k / W)]);
  cells.reverse();
  let pts = cells.map((c) => grid.toPoint(c));
  pts[0] = from.slice();
  if (reached && !grid.blocked[key(...grid.toCell(to))]) pts[pts.length - 1] = to.slice();
  // Remove corners where a straight line is just as safe (never cut through a costlier cell than the path used).
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    const maxTo = new Float32Array(pts.length); // highest cell cost on the planned path between i and k
    let m = 1;
    for (let k = i; k <= j; k++) { const c = grid.toCell(pts[k]); m = Math.max(m, grid.cost[key(c[0], c[1])]); maxTo[k] = m; }
    while (j > i + 1 && !gridClear(grid, pts[i], pts[j], maxTo[j])) j--;
    out.push(pts[j]); i = j;
  }
  return { ok: true, reached, gap, path: out, length: pathLength(out), cost: gScore[gk] * grid.res, expanded };
}
