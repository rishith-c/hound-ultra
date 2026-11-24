// The race on the probability landscape. Two searchers, one clock, one hidden person (race.js holds the maths).
// Time runs at the same rate for both. Each run hides a new person: consecutive seeds from a start that differs on
// every visit, so no run is picked to flatter either searcher.
import { buildRace } from './race.js';
import { ROVER_SPEED } from './model.js';
import { pointAlong, pathLength } from '../../core/geometry.js';
import { clamp, fmtClock, fmtPct } from './common.js';

const SCALE = 1.5;             // metres of relief for the starting density of a room; height is linear in chance
const word = (p) => (p < 0.005 ? 'under 1 %' : fmtPct(p));

export function createHero(map, M, ctx, ui) {
  let race = null, run = null, seed = 0, on = false, speed = 15, tally = { map: 0, fixed: 0, neither: 0, n: 0 };
  let hgt = new Float32Array(map.N), heat = new Float32Array(map.N), ref = 1, building = null;
  const rm = () => ctx.kit.reducedMotion();
  function show(P, opts) { for (let c = 0; c < map.N; c++) { const x = P[c] / ref; hgt[c] = Math.min(11, SCALE * x); heat[c] = 1 - Math.exp(-0.34 * x); } map.setField(hgt, heat, opts); }
  async function ready() {
    if (race) return race; if (building) return building;
    building = buildRace(M, ctx).then((r) => { race = r; let s = 0, n = 0; for (let c = 0; c < M.N; c++) if (M.roomOf[c] >= 0 && !M.rooms[M.roomOf[c]].corridor) { s += r.prior[c]; n++; } ref = s / n; return r; });
    return building;
  }
  function begin(next) {
    seed = next; const d = race.draw(seed);
    run = { d, t: 0, wait: 1.6, phase: 'run', hold: 0, shownLook: -1, kMap: 0, kFix: 0, listening: -1, found: 0,
      tMap: d.map < 0 ? Infinity : race.map[d.map].t2, tFix: d.fixed < 0 ? Infinity : race.fixed[d.fixed].t2 };
    map.stage.clear(); show(race.prior, { secs: 1.4 }); map.setDim(1); map.setMode('belief'); map.setContours(SCALE / 4); map.setCut(0.3);
    map.stage.rover(0, race.start, Math.PI / 2); map.stage.rover(1, [race.start[0] - 1.6, race.start[1] - 0.6], Math.PI / 2);
    const L = race.map[0]; map.stage.next(L.pos, L.path);
    ui.caption('One person is hidden. Height is the chance they are there.'); ui.state('run'); ui.clocks(0, 0, 0, 0, null, null);
  }
  const at = (L, t) => { // pose along one look: driving, then listening
    if (t < L.t1) { const d = (t - L.t0) * ROVER_SPEED, a = pointAlong(L.path, d), b = pointAlong(L.path, Math.min(pathLength(L.path), d + 0.4)); const p = a.pos || a, q = b.pos || b; return { p, h: Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.02 ? Math.atan2(q[1] - p[1], q[0] - p[0]) : null, listen: null }; }
    return { p: L.pos, h: null, listen: clamp((t - L.t1) / (L.t2 - L.t1), 0, 1) };
  };
  function caption(L) {
    let best = -1, drop = 0; for (let r = 0; r < L.rooms.length; r++) { const d = L.rooms[r] - L.roomsAfter[r]; if (d > drop) { drop = d; best = r; } }
    if (best < 0) return 'Look ' + (L.k + 1) + '. Nothing in the debris field. Chance elsewhere rises.';
    return 'Look ' + (L.k + 1) + '. Nothing heard. ' + M.rooms[best].name + ': ' + word(L.rooms[best]) + ' to ' + word(L.roomsAfter[best]) + '.';
  }
  const lookAt = (looks, t, k) => { while (k < looks.length - 1 && t >= looks[k].t2) k++; return k; };
  function frame(dt, time) {
    if (!on || !run) return;
    if (run.wait > 0) { run.wait -= dt; film(null, time); return; }
    const { d } = run;
    if (run.phase === 'run') {
      const L0 = race.map[run.kMap], far = L0 && L0.t1 - L0.t0 > 90 ? 2.2 : 1;
      run.t = Math.min(race.cap, run.t + dt * speed * far);
      const t = run.t, end = Math.min(run.tMap, race.cap);
      const k = lookAt(race.map, t, run.kMap);
      for (let i = run.kMap; i < Math.min(k, d.map < 0 ? Infinity : d.map); i++) { if (i > run.shownLook) { run.shownLook = i; show(race.map[i].after, { from: race.map[i].pos, secs: 1.0 }); ui.caption(caption(race.map[i])); } }
      if (k !== run.kMap && (d.map < 0 || k <= d.map)) { run.kMap = k; const L = race.map[k]; map.stage.next(L.pos, L.path); }
      const L = race.map[run.kMap], A = at(L, Math.min(t, end)); map.stage.rover(0, A.p, A.h); map.stage.listen(A.p, A.listen);
      run.kFix = lookAt(race.fixed, t, run.kFix); const F = race.fixed[run.kFix], B = at(F, Math.min(t, run.tFix, race.cap)); map.stage.rover(1, B.p, B.h);
      if (t >= run.tFix && !run.saidFix) { run.saidFix = true; ui.caption('The fixed route heard the person first. The map keeps searching.'); }
      if (t >= end) { run.phase = 'found'; run.hold = 0; run.end = end; finish(); }
      else ui.clocks(t, Math.min(t, run.tFix), race.successAt(race.map, t), race.successAt(race.fixed, Math.min(t, run.tFix)), null, t >= run.tFix ? true : null);
      film(L, time);
    } else {
      run.hold += dt; const k = clamp(run.hold / 1.2, 0, 1);
      if (run.hold > 2.1 && !run.melted) { run.melted = true; hgt.fill(0); heat.fill(0); map.setField(hgt, heat, { secs: 1.6 }); ui.caption(run.ok ? 'Found: ' + (d.room ? d.room.name : 'outside') + ', ' + (d.moving ? 'moving' : 'still') + '. The hidden person, now shown.' : 'Not found in 20 minutes. The hidden person was ' + (d.room ? 'in ' + d.room.name : 'outside') + '.'); }
      if (run.hold > 2.3) { run.found = clamp((run.hold - 2.3) / 1.1, 0, 1); map.stage.person(d.pos, run.found * run.found * (3 - 2 * run.found)); }
      // the fixed route's clock runs on to its own result
      const tf = Math.min(run.tFix, race.cap), shown = run.end + (tf - run.end) * clamp((run.hold - 1.4) / 2.2, 0, 1);
      ui.clocks(run.end, Math.max(Math.min(run.end, tf), shown), race.successAt(race.map, run.end), race.successAt(race.fixed, shown), run.ok, run.hold > 3.6 ? run.tFix < Infinity : null);
      if (run.hold < 2) map.shot(-0.48 + Math.sin(time * 0.1) * 0.12, 0.44, 48, d.pos[0] - 1, d.pos[1], 1.5); else map.shot(-0.48 + Math.sin(time * 0.1) * 0.12, 0.4, 25, d.pos[0] - 0.8, d.pos[1], 1);
      if (k >= 1 && run.hold > 10) begin(seed + 1);
    }
  }
  function finish() {
    const { d } = run, L = d.map >= 0 ? race.map[d.map] : null; run.ok = !!L; map.stage.next(null); map.stage.listen(d.pos, null);
    tally.n++; if (run.tMap < run.tFix) tally.map++; else if (run.tFix < run.tMap) tally.fixed++; else tally.neither++;
    if (L) { // Bayes after a detection: only cells this look could have heard keep their chance
      const P = new Float32Array(M.N); let z = 0; const r = L.reach; for (let i = 0; i < r.n; i++) { const c = r.idx[i], b = i * 4, hit = 0.4 * (1 - (1 - r.dm[b]) * (1 - r.dm[b + 1]) * (1 - r.dm[b + 2]) * (1 - r.dm[b + 3])) + 0.6 * (1 - (1 - r.ds[b]) * (1 - r.ds[b + 1]) * (1 - r.ds[b + 2]) * (1 - r.ds[b + 3])); P[c] = L.before[c] * hit; z += P[c]; }
      let top = 0; for (let c = 0; c < M.N; c++) { P[c] /= z; if (P[c] > top) top = P[c]; }
      for (let c = 0; c < M.N; c++) { const x = P[c] / top; hgt[c] = 5.5 * x; heat[c] = 0.3 + 0.62 * x; } map.setField(hgt, heat, { from: L.pos, secs: 1.3 });   // rescaled to its own peak
      ui.caption('Heard, ' + (d.room ? d.room.name : 'outside') + ', after ' + (d.map + 1) + (d.map ? ' looks.' : ' look.'));
    } else ui.caption('Twenty minutes. Nothing heard.');
    ui.state('found'); ui.tally(tally);
  }
  function film(L, time) {
    const out = L && L.pos[0] > 88, drift = rm() ? 0 : Math.sin(time * 0.07) * 0.16;
    if (out) map.shot(-0.42 + drift, 0.52, 92, 80, 54); else map.shot(-0.46 + drift, 0.5, 76, 64 + (L ? (L.pos[0] - 64) * 0.14 : 0), 45 + (L ? (L.pos[1] - 44) * 0.14 : 0));
  }
  return {
    get race() { return race; }, get run() { return run; }, get tally() { return tally; },
    async start(first) {
      on = true; ui.state('load'); await ready(); if (!on) return;
      ui.exact(race.meanTime(race.map), race.meanTime(race.fixed), race);
      if (!run) begin(first || +new URLSearchParams(location.search).get('race') || (Math.floor(Date.now() / 1000) % 9000) + 1); else { const P = run.phase === 'found' && run.ok ? null : run.shownLook >= 0 ? race.map[run.shownLook].after : race.prior; if (P) { map.setMode('belief'); map.setContours(SCALE / 4); map.setCut(0.3); show(P, { instant: true }); } else begin(seed + 1); map.stage.rover(0, rPos(0), null); map.stage.rover(1, rPos(1), null); }
      if (rm()) { finishNow(); }
    },
    stop() { on = false; map.stage.hide(); map.freeCamera(); },
    next() { if (race) begin(seed + 1); }, frame, ready,
    jump(to) { if (run) { run.wait = 0; run.t = Math.min(to, race.cap - 1); } },
    set speed(x) { speed = x; },
  };
  function rPos(i) { const looks = i ? race.fixed : race.map; return at(looks[lookAt(looks, run.t, 0)], Math.min(run.t, i ? run.tFix : run.tMap)).p; }
  function finishNow() { // reduced motion: show the finished picture, no animation
    run.wait = 0; run.t = run.end = Math.min(run.tMap, race.cap); run.phase = 'found'; const k = run.d.map; if (k >= 0) { map.stage.rover(0, race.map[k].pos, 0); const pts = []; for (let i = 0; i <= k; i++) pts.push(...race.map[i].path); map.stage.next(null, pts); }
    finish(); map.stage.person(run.d.pos, 1); const tf = Math.min(run.tFix, race.cap); ui.clocks(run.end, tf, race.successAt(race.map, run.end), race.successAt(race.fixed, tf), run.ok, run.tFix < Infinity); map.setView('building', true); map.renderOnce();
  }
}
