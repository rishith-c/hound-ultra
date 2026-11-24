// The demo's race: two searchers, one hidden person, the same sensors, the same speed, the same start.
//   fixed     drives the mission's four stops in order and repeats them
//   map       always takes the look with the most chance of detection per second of driving and listening, on a
//             probability map that Bayes' rule updates after every look (Koopman's search theory)
// One person is somewhere on the site, so the map sums to one: when a look finds nothing, the chance it removes
// from the cells it covered is spread over every other cell. While nothing has been found both searchers' moves are
// fixed in advance, so each one's chance of success over time is computed exactly, not sampled.
// Left out on purpose, and said so on screen: false alarms (exhibit 3 has them). Looks are treated as independent.
import { expectedFinds, distField, fieldAt, makeBelief, copyBelief, ROVER_SPEED, WINDOW_S } from './model.js';
import { mulberry32, pathLength } from '../../core/geometry.js';

export const CAP_S = 1200;                       // a searcher gives up after 20 minutes (assumed)
export const WEIGHTS = { place: 0.5, shelter: 0.3, exit: 0.2, outdoors: 0.2 };   // the prior's scenario weights (assumed)
export const hitOf = (d, b) => 1 - (1 - d[b]) * (1 - d[b + 1]) * (1 - d[b + 2]) * (1 - d[b + 3]);

// One quiet look on a map of exactly one person: multiply by the miss chance, then make the map sum to one again.
export function missUpdate(B, reach) {
  let gone = 0;
  for (let k = 0; k < reach.n; k++) { const c = reach.idx[k], b = k * 4, hm = hitOf(reach.dm, b), hs = hitOf(reach.ds, b); gone += B.pm[c] * hm + B.ps[c] * hs; B.pm[c] *= 1 - hm; B.ps[c] *= 1 - hs; }
  const z = 1 / (1 - gone); for (let c = 0; c < B.n; c++) { B.pm[c] *= z; B.ps[c] *= z; }
  return gone;
}
function toOne(B) { let s = 0; for (let c = 0; c < B.n; c++) s += B.pm[c] + B.ps[c]; for (let c = 0; c < B.n; c++) { B.pm[c] /= s; B.ps[c] /= s; } return B; }
const pause = () => new Promise((r) => setTimeout(r, 0));

export async function buildRace(M, ctx, { cap = CAP_S, weights = WEIGHTS } = {}) {
  const grid = ctx.sim.grid, start = ctx.world.SITE.entrance.slice(), prior = toOne(M.buildPrior(weights));
  const toCoarse = (B) => { const C = makeBelief(M.CW * M.CH); for (let c = 0; c < M.N; c++) { const k = ((c / M.GW) >> 1) * M.CW + ((c % M.GW) >> 1); C.pm[k] += B.pm[c]; C.ps[k] += B.ps[c]; } return C; };
  const cands = [], all = M.candidates(); let t0 = performance.now();
  for (const c of all) { cands.push({ pos: c.pos, reach: M.reachOf(c.pos, M.coarse) }); if (performance.now() - t0 > 10) { await pause(); t0 = performance.now(); } }

  async function plan(kind) {
    const B = copyBelief(prior), C = toCoarse(prior), looks = []; let at = start, t = 0, missed = 1;
    for (let k = 0; k < 80 && t < cap; k++) {
      let pos, options = null;
      if (kind === 'fixed') { const S = ctx.world.STOPS; pos = S[k % S.length].pos; }
      else {
        const f = distField(grid, at); let best = -1; options = [];
        for (const c of cands) { const d = fieldAt(grid, f, c.pos); if (!(d < Infinity)) continue; const rate = expectedFinds(C, c.reach) / (d / ROVER_SPEED + WINDOW_S); options.push({ pos: c.pos, rate }); if (rate > best) { best = rate; pos = c.pos; } }
        options.sort((a, b) => b.rate - a.rate);
        options = options.slice(0, 240);
      }
      const route = Math.hypot(pos[0] - at[0], pos[1] - at[1]) < 0.3 ? { ok: true, path: [at, pos] } : ctx.sim.plan(at, pos, { nearest: true });
      const path = route && route.ok ? route.path : [at, pos], drive = pathLength(path) / ROVER_SPEED;
      const fine = M.reachOf(pos); const before = k === 0 ? snapshot(B) : looks[k - 1].after;
      const hit = missUpdate(B, fine); missUpdate(C, M.reachOf(pos, M.coarse));
      const t1 = t + drive, t2 = t1 + WINDOW_S; missed *= 1 - hit;
      looks.push({ k, pos, path, t0: t, t1, t2, hit, success: 1 - missed, before, after: snapshot(B), reach: fine, options, rooms: roomMass(before), roomsAfter: roomMass(snapshot(B)) });
      at = pos; t = t2; await pause();
    }
    return looks;
  }
  function snapshot(B) { const a = new Float32Array(M.N); for (let c = 0; c < M.N; c++) a[c] = B.pm[c] + B.ps[c]; return a; }
  function roomMass(P) { const o = new Float32Array(M.rooms.length); for (let c = 0; c < M.N; c++) if (M.roomOf[c] >= 0) o[M.roomOf[c]] += P[c]; return o; }
  const map = await plan('map'), fixed = await plan('fixed');

  // Chance of having found the person by time t.
  const successAt = (looks, t) => { let s = 0; for (const L of looks) { if (L.t2 > t + 1e-6) break; s = L.success; } return s; };
  // Expected search time, counting a search that fails as the full cap.
  const meanTime = (looks) => { let e = 0, prev = 0; for (const L of looks) { if (L.t2 > cap) break; e += (L.success - prev) * L.t2; prev = L.success; } return e + (1 - prev) * cap; };
  // Draw one hidden person from the prior, and when each searcher first detects them. Consecutive seeds, never picked.
  function draw(seed) {
    const rng = mulberry32((seed * 2654435761) >>> 0); let u = rng(), cell = 0;
    for (let c = 0; c < M.N; c++) { u -= prior.pm[c] + prior.ps[c]; if (u <= 0) { cell = c; break; } }
    const moving = rng() < M.S.pMove, out = { seed, cell, pos: [M.fine.cx[cell], M.fine.cy[cell]], moving, room: M.roomOf[cell] >= 0 ? M.rooms[M.roomOf[cell]] : null };
    for (const [name, looks] of [['map', map], ['fixed', fixed]]) {
      out[name] = -1;
      for (let k = 0; k < looks.length; k++) { const L = looks[k]; if (L.t2 > cap) break; const r = rng(); let h = 0; const i = L.reach.idx.indexOf(cell); if (i >= 0) h = hitOf(moving ? L.reach.dm : L.reach.ds, i * 4); if (r < h) { out[name] = k; break; } }
    }
    return out;
  }
  return { prior: snapshot(prior), start, map, fixed, cap, successAt, meanTime, draw, candidates: cands.length };
}
