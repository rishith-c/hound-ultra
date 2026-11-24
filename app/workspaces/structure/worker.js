// Structure lab: the demo's solver, off the main thread. It streams the collapse as it is computed, then tests jack lifts in
// copies of the pile until it finds one that disturbs the pocket and a shore that keeps it, then runs the aftershocks, the
// void count and the vine route on the same pile. Every number it posts is measured on that pile.
import * as P from './physics.js';
import * as ST from './story.js';
import { betti, findVoids } from './voxel.js';
import { ROBOTS, reach, routeTo } from './robots.js';

const post = (m, tr) => self.postMessage(m, tr || []);
const breathe = () => new Promise((r) => setTimeout(r, 0));
async function run(gen, onYield) { let r; while (!(r = gen.next()).done) { onYield?.(r.value); await breathe(); } return r.value; }

self.onmessage = async (ev) => {
  const { seed, scenario, tie, hint } = ev.data;
  try {
    await P.loadRapier();
    const pile = P.buildPile({ seed, scenario, tie });
    post({ t: 'pieces', pieces: pile.pieces.map((p) => ({ idx: p.idx, kind: p.kind, sub: p.sub, id: p.id, name: p.name, boxes: p.boxes, fixed: p.fixed, mass: p.mass, broken: p.broken, level: p.level, home: p.home, p: p.p, radius: p.radius, alive: true })), poses: P.readPoses(pile), loose: pile.pieces.filter((p) => !p.fixed).length, mass: pile.massTotal });
    const c = await run(ST.collapse(pile, (m) => post({ t: 'chunk', ...m }, [m.buf.buffer]), { chunk: 30 }));
    const snap = P.snapshot(pile); let sp = null;
    if (hint) { const m = P.protectedMetrics(pile, pile.world, hint.box); if (m.intrusion === 0 && m.open < 0.5) sp = [{ box: hint.box }]; }
    sp = sp || ST.spaces(pile, 5); const near = hint || { jack: [99, 99], shore: [0, 0] };
    post({ t: 'rest', rest: c.rest, frames: c.frames, boxes: sp.map((s) => s.box) });
    // the lift: try the remembered site first, then search
    let found = null, tried = 0; const t0 = performance.now();
    outer: for (const s of sp) {
      const sites = ST.jackSites(pile, c.rest, s.box).map((q) => ({ ...q, d: Math.hypot(q.x - s.box.c[0], q.z - s.box.c[2]), h: Math.hypot(q.x - near.jack[0], q.z - near.jack[1]) })).sort((a, b) => (a.h < 0.3 ? a.h - 10 : a.d) - (b.h < 0.3 ? b.h - 10 : b.d)).slice(0, 60);
      for (const site of sites) {
        const a = await run(ST.jackRun(pile, snap, site, s.box)); tried++; if (tried % 2 === 0) post({ t: 'search', tried });
        if (!ST.ruined(a)) continue;
        for (const shore of ST.shoreSites(pile, s.box, site).sort((x, y) => Math.hypot(x.x - near.shore[0], x.z - near.shore[1]) - Math.hypot(y.x - near.shore[0], y.z - near.shore[1]))) { const b = await run(ST.jackRun(pile, snap, site, s.box, { shores: [shore] })); tried++; if (ST.kept(b)) { found = { box: s.box, site, shore }; break outer; } }
      }
    }
    if (!found) { post({ t: 'error', message: 'No lift on this pile both disturbs the pocket and is saved by one shore.' }); return; }
    const a = await run(ST.jackRun(pile, snap, found.site, found.box, { rec: true })), b = await run(ST.jackRun(pile, snap, found.site, found.box, { shores: [found.shore], rec: true }));
    const slim = (r) => { r.movedSlab = r.moved.filter((m) => pile.pieces[m.idx]?.kind === 'plank' || pile.pieces[m.idx]?.kind === 'beam').length; return r; };
    post({ t: 'lift', box: found.box, site: found.site, shore: found.shore, a: slim(a), b: slim(b), tried, ms: performance.now() - t0, piece: pile.pieces[found.site.idx].id, seed }, [a.frames.buffer, b.frames.buffer]);
    // aftershocks: the same seeded tremors on the pile as it is and on the pile with the shore
    const N = 16, pga = 0.5, f = P.fork(pile, snap); P.addShore(f, found.shore, 'post'); const snapS = P.snapshot(f);
    const out = []; const base = P.protectedMetrics(pile, pile.world, found.box);
    for (const [pl, sn] of [[pile, snap], [f, snapS]]) {
      const tr = []; for (let k = 0; k < N; k++) { const r = await run(P.shakeTrial(pl, sn, { pga, seed: k + 1, box: found.box })); const big = r.moved.filter((m) => m.d > 0.05); tr.push({ seed: k + 1, max: r.maxDisp, moved: big.length, head: r.prot.headroom, lost: base.headroom - r.prot.headroom > 0.1 || r.prot.intrusion > 0.02, by: [...new Set((r.prot.within.length ? r.prot.within : r.prot.roof).map((i) => pl.pieces[i].kind))] }); post({ t: 'shakeN', k: out.length * N + k + 1, n: 2 * N }); }
      out.push(tr);
    }
    const pick = (out[0].find((t, i) => t.lost && !out[1][i].lost) || out[0].find((t) => t.lost) || out[0].reduce((x, y) => (y.max > x.max ? y : x))).seed; const recs = [];
    for (const [pl, sn] of [[pile, snap], [f, snapS]]) { const n = pl.pieces.length, fr = [], ac = []; await run(P.shakeTrial(pl, sn, { pga, seed: pick, box: found.box, onStep: (w, s, ax, az) => { fr.push(P.readPoses({ pieces: pl.pieces, world: w }, w)); ac.push(ax, az); } })); const buf = new Float32Array(fr.length * n * 7); fr.forEach((x, i) => buf.set(x, i * n * 7)); recs.push({ frames: buf, n, total: fr.length, acc: Float32Array.from(ac) }); }
    post({ t: 'shake', pga, n: N, trials: out, pick, recs, head0: base.headroom }, recs.map((r) => r.frames.buffer));
    // the voids, counted
    const { g, vr } = ST.pockets(pile, c.rest); const curve = [];
    for (const r of [0, 0.1, 0.2, 0.3]) { const S = new Uint8Array(g.n), q = (r + g.res / 2) / g.res, t2 = r === 0 ? 0.5 : q * q; for (let i = 0; i < g.n; i++) S[i] = g.d2[i] < t2 ? 1 : 0; const bt = betti(S, g.nx, g.ny, g.nz); const cav = []; if (r > 0 && bt.b2) { const seen = new Map(); for (let i = 0; i < g.n; i++) if (!S[i]) { const k = bt.find(i); if (bt.cavRoots.includes(k)) { let a2 = seen.get(k); if (!a2) seen.set(k, a2 = []); a2.push(i); } } for (const v of seen.values()) { const pts = new Float32Array(v.length * 4); v.forEach((id, i) => { const p = g.pos(id); pts.set([p[0], p[1], p[2], Math.sqrt(g.d2[id]) * g.res], i * 4); }); cav.push(pts); } } curve.push({ r, b0: bt.b0, b1: bt.b1, b2: bt.b2, cav }); await breathe(); }
    post({ t: 'voids', curve, res: g.res, vox: g.n, nVoids: vr.voids.length });
    // the vine robot's way to the person
    const ids = []; { const bx = found.box, cy = Math.cos(bx.yaw), sy = Math.sin(bx.yaw); for (let u = -1; u <= 1; u += 0.1) for (let w = -1; w <= 1; w += 0.5) for (const y of [0.1, 0.25, 0.4]) { const du = u * bx.h[0], dw = w * bx.h[2], id = g.at([bx.c[0] + du * cy + dw * sy, y, bx.c[2] - du * sy + dw * cy]); if (id >= 0 && !g.solid[id]) ids.push(id); } }
    const bots = {}; for (const bot of ROBOTS) { const fd = reach(g, bot); const r = routeTo(g, fd, ids); bots[bot.id] = r ? { pts: r.pts, length: r.length, minClear: r.minClear, minBend: r.minBend, turn: r.turn } : null; await breathe(); }
    // the deepest place the vine can reach: a route worth watching
    { const bot = ROBOTS[0], fd = reach(g, bot); let best = -1, bc = 0; for (let i = 0; i < g.n; i++) if (g.roofed[i] && fd.cost[i] < Infinity && fd.plen[i] > bc && g.d2[i] > 2) { bc = fd.plen[i]; best = i; } if (best >= 0) { const r = routeTo(g, fd, [best]); bots.deep = { pts: r.pts, length: r.length, minClear: r.minClear, minBend: r.minBend, turn: r.turn }; } }
    post({ t: 'vine', bots });
    pile.world.free(); f.world.free();
  } catch (e) { post({ t: 'error', message: String(e && e.message || e) }); }
};
