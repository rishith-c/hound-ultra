// Structure lab: the demo story, solved. Everything the film shows is a recording of these runs: one collapse, a jack
// lift that disturbs the pocket, and the same lift again with one timber shore in place. Runs in a worker.
import * as P from './physics.js';
import { voxelise, distanceTransform, findVoids } from './voxel.js';

const NFRAME = 7;
export function drain(gen) { let r; while (!(r = gen.next()).done); return r.value; }

// ------------------------------------------------------------ the collapse, recorded frame by frame
export function* collapse(pile, onChunk, { chunk = 60, maxT = 14 } = {}) {
  P.trigger(pile);
  const n = pile.pieces.length; let buf = new Float32Array(n * NFRAME * chunk), k = 0, dust = [], evs = [], f = 0, quiet = 0, ke = [];
  const crushed = new Set();
  for (;;) {
    const d = []; P.stepPile(pile, d);
    for (const q of d) dust.push([f, q.x, q.y, q.z, q.s, q.r]);
    for (const p of pile.pieces) if (p.crushed && !crushed.has(p.idx)) { crushed.add(p.idx); evs.push({ f, idx: p.idx, boxes: p.boxes }); }
    P.readPoses(pile, pile.world, buf.subarray(k * n * NFRAME, (k + 1) * n * NFRAME)); ke.push(P.kinetic(pile)); k++; f++;
    let stop = false;
    if (pile.t > 1.6 && f % 6 === 0) { const sp = P.maxSpeed(pile); if (!pile.calmed && (sp < 0.6 || pile.t > 7)) P.calm(pile); quiet = sp < 0.02 ? quiet + 1 : 0; stop = quiet >= 5 || pile.t > maxT; }
    if (k === chunk || stop) { onChunk({ frames: k, buf: buf.slice(0, k * n * NFRAME), dust, evs, ke }); dust = []; evs = []; ke = []; k = 0; yield f; }
    if (stop) break;
  }
  // rest: let the damped pile come fully still, then take the damping away again so that no trial is flattered by it
  const before = P.readPoses(pile);
  P.calm(pile, true);
  for (let i = 0, q = 0; i < 420 && q < 6; i++) { pile.world.step(); if (i % 10 === 9) { q = P.maxSpeed(pile) < 0.006 ? q + 1 : 0; yield f; } }
  P.sleepAll(pile); P.calm(pile, false); pile.calmed = false;
  return { frames: f, before, rest: P.readPoses(pile) };
}

// ------------------------------------------------------------ the pocket and its person
export function pocketBox(v) {
  const ex = v.max[0] - v.min[0], ez = v.max[2] - v.min[2], along = ex >= ez, len = Math.max(0.9, Math.min(1.7, (along ? ex : ez) - 0.1));
  return { c: [v.center[0], 0.2, v.center[2]], h: [len / 2, 0.19, 0.24], yaw: along ? 0 : Math.PI / 2 };
}
export function pockets(pile, poses) {
  const g = voxelise(pile, poses, { res: 0.1 }); distanceTransform(g); const vr = findVoids(g);
  return { g, vr, list: vr.voids.filter((v) => v.person && v.min[1] < 0.3) };
}

// Person-sized places on the ground with a slab overhead: free space for a lying body, low roof, loose pieces above.
export function spaces(pile, max = 6) {
  const { world } = pile, out = []; world.updateSceneQueries?.();
  for (let x = -4.6; x <= 4.6; x += 0.4) for (let z = -4.2; z <= 4.2; z += 0.35) for (const yaw of [0, Math.PI / 2]) {
    const box = { c: [x, 0.21, z], h: [0.85, 0.19, 0.24], yaw }, m = P.protectedMetrics(pile, world, box);
    if (m.intrusion > 0 || m.open > 0 || m.headroom > 1.3 || m.headroom < 0.18) continue;
    const loose = m.roof.filter((i) => !pile.pieces[i].fixed).length; if (!loose) continue;
    out.push({ box, head: m.headroom, roof: m.roof, score: -Math.abs(m.headroom - 0.5) + 0.05 * loose });
  }
  out.sort((a, b) => b.score - a.score); const keep = [];
  for (const s of out) { if (keep.length >= max) break; if (keep.some((k) => Math.hypot(k.box.c[0] - s.box.c[0], k.box.c[2] - s.box.c[2]) < 1.1)) continue; keep.push(s); }
  return keep;
}
// ------------------------------------------------------------ where a jack could go
export function jackSites(pile, poses, box) {
  const { world } = pile, R = pile.R, out = []; world.updateSceneQueries?.();
  for (const p of pile.pieces) {
    if (!p.alive || p.fixed || (p.kind !== 'plank' && p.kind !== 'beam')) continue;
    const o = p.idx * 7, q = { x: poses[o + 3], y: poses[o + 4], z: poses[o + 5], w: poses[o + 6] }, b = p.boxes[0], long = b.h[0] > b.h[2] ? 0 : 2;
    for (const t of [-0.82, -0.45, 0, 0.45, 0.82]) {
      const loc = [0, 0, 0]; loc[long] = t * b.h[long];
      // face whose normal points most nearly down
      const up = rot(q, [0, 1, 0]); const s = up[1] > 0 ? -1 : 1; if (Math.abs(up[1]) < 0.42) continue; loc[1] = s * (b.h[1]);
      const w = rot(q, loc), pt = { x: poses[o] + w[0], y: poses[o + 1] + w[1], z: poses[o + 2] + w[2] };
      const hit = world.castRay(new R.Ray({ x: pt.x, y: pt.y - 0.02, z: pt.z }, { x: 0, y: -1, z: 0 }), 4, true); if (!hit) continue;
      const gap = hit.timeOfImpact + 0.02; if (gap < 0.2 || gap > 1.7) continue;
      const base = hit.collider.parent(); const under = base ? pile.byBodyAny(world, base.handle) : -1;
      if (Math.abs(pt.x - box.c[0]) < 0.35 && Math.abs(pt.z - box.c[2]) < 0.35) continue;
      out.push({ idx: p.idx, x: pt.x, z: pt.z, top: pt.y, gap, under, bottom: pt.y - gap, tilt: Math.abs(up[1]) });
    }
  }
  return out;
}
export function rot(q, v) { const { x, y, z, w } = q, [a, b, c] = v; const tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a); return [a + w * tx + y * tz - z * ty, b + w * ty + z * tx - x * tz, c + w * tz + x * ty - y * tx]; }

// headroom over the person (smallest clear height above the body, 15 rays) and how far pieces have come into the space
function gauge(pile, box) { const m = P.protectedMetrics(pile, pile.world, box); return { head: m.headroom, intr: m.intrusion, open: m.open, roof: m.roof, within: m.within }; }

// ------------------------------------------------------------ one jack lift in a forked world
const CARRY = new Set(['plank', 'beam', 'shore']);
export function* jackRun(pile, snap, site, box, { shores = [], rec = false, hold = 2.6 } = {}) {
  const f = P.fork(pile, snap); const sh = shores.map((s) => P.addShore(f, s, 'post'));
  const jack = P.addJack(f, site), n = f.pieces.length, before = P.readPoses(f);
  const g0 = gauge(f, box); const up = Math.round(P.JACK.rise / P.JACK.speed / P.DT), total = up + Math.round(hold / P.DT);
  const frames = rec ? new Float32Array(total * n * NFRAME) : null, tr = { head: [], intr: [], force: [], shore: [], jackY: [], dust: [], edges: [] };
  let worst = g0.head, worstI = g0.intr, peakF = 0, by = g0.roof, y = jack.y0, Fs = 0, Ss = 0, rose = 0; const acc = [];
  for (let s = 0; s < total; s++) {
    if (s < up) { const k = s / up, e = Math.min(1, Math.min(k, 1 - k) * 8); y += P.JACK.speed * P.DT * (0.35 + 0.65 * e); rose = y - jack.y0; }
    jack.body.setNextKinematicTranslation({ x: site.x, y, z: site.z });
    const d = []; P.stepPile(f, d);
    if (rec) { P.readPoses(f, f.world, frames.subarray(s * n * NFRAME, (s + 1) * n * NFRAME)); for (const q of d) tr.dust.push([s, q.x, q.y, q.z, q.s, q.r]); }
    const F = P.forceOn(f.world, jack.col); Fs += (F - Fs) * 0.16; peakF = Math.max(peakF, s > 12 ? Fs : 0);
    let Fsh = 0; for (const p of sh) { const b = f.world.getRigidBody(p.handle); Fsh += P.forceOn(f.world, b.collider(0)); } Fsh = Fsh / 2; Ss += (Fsh - Ss) * 0.16;   // top and bottom both press on it: half
    if (s % 3 === 0) { const g = gauge(f, box); if (g.head < worst - 1e-6 || g.intr > worstI + 1e-6) by = g.within.length ? g.within : g.roof; worst = Math.min(worst, g.head); worstI = Math.max(worstI, g.intr); if (rec) { tr.head.push(g.head); tr.intr.push(g.intr); } }
    if (rec) { tr.force.push(Fs); tr.shore.push(Ss); tr.jackY.push(y); const m = P.readContacts(f, f.world, new Map()); for (const [id, e] of m) if (!(CARRY.has(f.pieces[e.a].kind) || (e.b >= 0 && CARRY.has(f.pieces[e.b].kind))) || f.pieces[e.a].fixed && f.pieces[e.a].kind !== 'shore' && e.b >= 0 && f.pieces[e.b].kind === 'wall') m.delete(id); tr.edges.push(m); }
    if (s % 30 === 29) yield s / total;
  }
  const g1 = gauge(f, box), after = P.readPoses(f), moved = [];
  for (const p of f.pieces) if (p.alive && !p.fixed) { const dd = P.poseShift(before, after, p.idx * 7, p.radius); if (dd > 0.03) moved.push({ idx: p.idx, d: dd }); }
  moved.sort((a, b) => b.d - a.d);
  const out = { site, head0: g0.head, head1: g1.head, worst, intr0: g0.intr, intr1: g1.intr, worstI, peakF, by: [...by], moved, n, total, up, rise: rose, roof: g0.roof, speed: P.maxSpeed(f), shores: sh.map((p, i) => ({ idx: p.idx, ...shores[i], rated: p.rated })) };
  if (rec) { out.frames = frames; out.tr = packTrace(tr, total); }
  f.world.free();
  return out;
}
// keep only the strongest contacts, averaged over 6 frames, every 3rd frame: enough to draw the load path
function packTrace(tr, total) {
  const key = []; const K = 90;
  for (let s = 0; s < total; s += 3) {
    const acc = new Map(); let w = 0;
    for (let k = Math.max(0, s - 5); k <= Math.min(total - 1, s + 2); k++) { w++; for (const [id, e] of tr.edges[k]) { let a = acc.get(id); if (!a) { a = { a: e.a, b: e.b, F: 0, pt: e.pt }; acc.set(id, a); } a.F += e.F; if (e.pt) a.pt = e.pt; } }
    const top = [...acc.values()].filter((e) => e.pt).sort((x, y) => y.F - x.F).slice(0, K); const b = new Float32Array(K * 6).fill(-2);
    top.forEach((e, i) => { b[i * 6] = e.a; b[i * 6 + 1] = e.b; b[i * 6 + 2] = e.F / w; b[i * 6 + 3] = e.pt[0]; b[i * 6 + 4] = e.pt[1]; b[i * 6 + 5] = e.pt[2]; }); key.push(b);
  }
  const edges = new Float32Array(key.length * K * 6); key.forEach((b, i) => edges.set(b, i * K * 6));
  return { head: Float32Array.from(tr.head), intr: Float32Array.from(tr.intr), force: Float32Array.from(tr.force), shore: Float32Array.from(tr.shore), jackY: Float32Array.from(tr.jackY), dust: tr.dust, edges, K };
}

// ------------------------------------------------------------ where a shore could go: a ring of points round the person
export function shoreSites(pile, box, site) {
  const { world } = pile, R = pile.R, cy = Math.cos(box.yaw || 0), sy = Math.sin(box.yaw || 0), out = []; world.updateSceneQueries?.();
  for (const [u, w] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [0.5, 1], [-0.5, 1], [0.5, -1], [-0.5, -1]]) {
    const du = u * (box.h[0] + 0.22), dw = w * (box.h[2] + 0.2), x = box.c[0] + du * cy + dw * sy, z = box.c[2] - du * sy + dw * cy;
    if (Math.hypot(x - site.x, z - site.z) < 0.35) continue;
    const up = world.castRay(new R.Ray({ x, y: 0.25, z }, { x: 0, y: 1, z: 0 }), 6, true); if (!up || up.timeOfImpact < 0.05) continue;
    const dn = world.castRay(new R.Ray({ x, y: 0.25, z }, { x: 0, y: -1, z: 0 }), 3, true); if (!dn) continue;
    const top = 0.25 + up.timeOfImpact, bottom = 0.25 - dn.timeOfImpact, h = top - bottom;
    if (h < 0.3 || h > 2.6) continue; const b = up.collider.parent(), idx = b ? pile.byBodyAny(world, b.handle) : -1; if (idx < 0 || pile.pieces[idx].kind === 'shore') continue;
    out.push({ x, z, top, bottom, h, under: idx, floor: bottom < 0.05 });
  }
  return out.filter((s) => s.floor);
}
export const ruined = (r) => (r.worstI - r.intr0 > 0.03) || (r.head0 - r.worst > 0.12 && r.worst < r.head0 * 0.75);
export const kept = (r) => (r.head0 - r.worst < 0.03) && (r.worstI - r.intr0 < 0.01);
