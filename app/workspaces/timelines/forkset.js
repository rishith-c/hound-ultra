// Timelines, Demo: the default set of worlds. The mission as scripted, and four forks of it, each changing one thing.
// computeSet() runs them for real (workers). braid.json is the saved result of exactly this code, shipped so that Demo
// starts at once; Demo then runs the same set again in the background and compares fingerprints.
import * as M from './model.js';
import { SEED } from '../../core/world.js';

const BASE = { seed: SEED, windows: 'scripted', autoplay0: true, log: [], autoT: 0, acts: [], expectEnd: 660 };
const openAt = (run, id, after) => { const d = run.frames.dets.find((x) => x.id === id); if (!d) return null; for (let k = Math.max(0, after - d.i0); k < d.st.length; k++) if (d.st[k] === 1) return d.i0 + k; return null; };

// Each entry: a short name for the screen, the moment, and the decision (resolved against the trunk by model.js).
export const SET = [
  { id: 'ignore', name: 'Ignore the drone’s lead', at: (r) => openAt(r, 'D1', 0) + 14, dec: { kind: 'dismiss', det: 'D1' } },
  { id: 'thermal', name: 'Thermal camera fails', at: (r) => M.phaseStart(r, 'search') + 12, dec: { kind: 'fault', id: 'thermalFail', dur: null } },
  { id: 'dismiss', name: 'Dismiss the uncertain lead', at: (r) => openAt(r, 'D4', 200) + 8, dec: { kind: 'dismiss', det: 'D4' } },
  { id: 'skip', name: 'Skip the second look', at: (r) => M.phaseStart(r, 'assess'), dec: { kind: 'skipSecondLook' } },
];

const q = (v) => Math.round(v * 100);
function packRun(run, from) {
  const f = run.frames, i0 = Math.max(0, Math.floor(from)), P = [];
  for (let i = i0; i < f.n; i++) P.push(q(f.rover[i * 5]), q(f.rover[i * 5 + 1]), q(f.rover[i * 5 + 2]), q(f.drone[i * 3]), q(f.drone[i * 3 + 1]), q(f.drone[i * 3 + 2]), q(f.team[i * 3]), q(f.team[i * 3 + 1]), f.listen[i] >= 0 ? 1 : 0);
  // delta code the columns so the file stays small
  const W = 9; for (let k = P.length - 1; k >= W; k--) P[k] -= P[k - W];
  return { i0, n: f.n, frames: P, endT: run.endT, hash: run.hash, reached: run.metrics.reached, routeLen: run.metrics.routeLen, hazardM: run.metrics.hazardM,
    // every lead this world's console held: when it opened, was confirmed, was closed, and when the team reached it
    leads: f.dets.map((d, k) => { const first = (s) => { const j = d.st.indexOf(s); return j < 0 ? null : d.i0 + j; }, fin = run.detections[k]; return { id: d.id, pos: fin.pos && [q(fin.pos[0]) / 100, q(fin.pos[1]) / 100], open: first(1), confirmed: first(2), closed: first(3), reached: Object.values(run.survivors).find((s) => s.detId === d.id)?.reachedAt ?? null }; }).filter((d) => d.pos),
    // ground truth, used only for the labelled reveal at the end
    people: run.truth.people.map((p) => ({ id: p.id, pos: p.pos, seen: p.firstSeenAt, confirmed: p.confirmedAt, reached: p.reachedAt, outcome: p.outcome })) };
}
export async function computeSet(pool, onEach) {
  const trunk = await pool.run(BASE);
  const worlds = [{ id: 'flown', name: 'As flown', forkT: 0, ...packRun(trunk, 0) }];
  onEach?.(1);
  await Promise.all(SET.map(async (s, i) => {
    const res = M.resolve(s.dec, trunk, s.at(trunk));
    if (!res.ok) throw new Error(s.name + ': ' + res.why);
    const run = await pool.run({ ...BASE, ...res.opts, autoT: res.forkT, acts: res.acts });
    worlds[i + 1] = { id: s.id, name: s.name, forkT: res.forkT, detail: res.detail, ...packRun(run, res.forkT) };
    onEach?.(1);
  }));
  return { seed: SEED, worlds };
}
// Unpack: every world gets full per-second frames from the start (the trunk's, then its own).
export function hydrate(set) {
  const W = 9; let trunk = null;
  return set.worlds.map((w) => {
    const d = Int32Array.from(w.frames); for (let k = W; k < d.length; k++) d[k] += d[k - W];
    const all = new Float32Array(w.n * W);
    if (trunk) all.set(trunk.frames.subarray(0, w.i0 * W));
    for (let k = 0; k < d.length; k++) all[w.i0 * W + k] = (k % W) === 8 ? d[k] : d[k] / 100;
    const out = { ...w, frames: all }; if (!trunk) trunk = out; return out;
  });
}
export const F = { RX: 0, RY: 1, RH: 2, DX: 3, DY: 4, DZ: 5, TX: 6, TY: 7, LISTEN: 8, W: 9 };
