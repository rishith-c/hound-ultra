// Exhibit 4, "Many teams, one plan": who goes to whom, in what order, when several rescue teams leave staging at once.
// The multiple travelling-repairman problem on the real planned paths of the site, solved three ways
// (teams-solvers.js): exactly, by simulated annealing, and by a classical simulation of quantum annealing.
// Live algorithm on simulated input. The drill is simulated; the teams are a concept (only one rover exists).
import { exhibitBrief, demoOverlay, createChart, makeLoop, tok, rgba, heat } from './common.js';
import * as S from './teams-solvers.js';
import { mulberry32, pathLength, pointInPoly } from '../../core/geometry.js';

const TEAM = [{ c: '--accent', dash: [] }, { c: '--ok', dash: [7, 4] }, { c: '--warn', dash: [2, 3] }];
const METHODS = ['exact', 'sa', 'sqa'];
const METHOD = {
  exact: { label: 'Exact', long: 'Exact, dynamic programming', c: '--text' },
  sa: { label: 'Simulated annealing', long: 'Simulated annealing', c: '--accent' },
  sqa: { label: 'Simulated quantum annealing', long: 'Simulated quantum annealing', c: '--sim' },
};
const M_REPLICAS = 24;
const HAZARD_WORD = { slope: 'Unstable slope', collapse: 'Collapse risk', mud: 'Deep mud', gas: 'Possible gas' };
const int = (v) => Math.round(v).toLocaleString('en-US');
const mmss = (s) => { const r = Math.round(s); return Math.floor(r / 60) + ':' + String(r % 60).padStart(2, '0'); };
const pct = (v, d = 1) => (v * 100).toFixed(d) + ' %';
const msText = (ms) => (ms < 0.05 ? '< 0.1 ms' : ms < 10 ? ms.toFixed(1) + ' ms' : int(ms) + ' ms');

function loadCss() {
  if (document.querySelector('link[data-strategy-css="teams"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = new URL('./teams.css', import.meta.url).href; link.dataset.strategyCss = 'teams';
    link.onload = link.onerror = () => resolve();
    document.head.append(link); setTimeout(resolve, 1500);
  });
}

export default async function (pane, ctx) {
  await loadCss();
  const { h, icon, fitCanvas, reducedMotion } = ctx.kit, W = ctx.world, SITE = W.SITE;
  const SPEED = (W.UNITS.find((u) => u.id === 'TEAM-1') || { speed: 1.1 }).speed;      // m/s, walking

  // ------------------------------------------------------------------ state
  const state = { scenario: 'drill', N: 7, K: 2, seed: 1, restarts: 20, sweeps: 400, view: 'exact', follow: true };
  let visible = false, autoRan = false, buildToken = 0, solveCount = 0;
  let sc = null;        // the scenario: { kind, people: [{ pos, name }], depots, prob, legs: Map }
  let res = null;       // results for sc
  let run = null;       // the solve in progress
  let reveal = null;    // { t0, dur } while the routes draw themselves in simulated time
  let wlSnap = null;    // the replicas to draw when no SQA run is live
  let planning = null;  // { done, total } while routes are being planned
  let fallbackNote = '';
  const dirty = { table: true, land: true, conv: true, wl: true, q: true, tests: true };
  const offs = [];

  // ------------------------------------------------------------------ DOM
  const canvas = (cls, label, draw) => {
    const el = h('canvas.' + cls, { role: 'img', 'aria-label': label });
    const o = { el, c: null, w: 0, h: 0, redraw() { if (o.c && o.w) draw(o.c, o.w, o.h); } };
    offs.push(fitCanvas(el, (c, w, hh) => { o.c = c; o.w = w; o.h = hh; draw(c, w, hh); }));
    return o;
  };
  const seg = (label, options, get, set, attr) => {
    const el = h('div.seg', { role: 'group', 'aria-label': label });
    const btns = options.map((o) => h('button', { type: 'button', 'aria-pressed': 'false', ['data-' + attr]: String(o.value), title: o.title || null, onclick: () => set(o.value) }, o.label));
    el.append(...btns);
    el.sync = () => btns.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === get())));
    el.setDisabled = (off, why) => btns.forEach((b) => { b.disabled = off; b.title = off ? why : ''; });
    el.sync();
    return el;
  };

  const brief = exhibitBrief(ctx.kit, {
    n: 4, title: 'Many teams, one plan', tags: ['live-algo', 'sim', 'concept'], sources: ['kadowaki', 'martonak', 'lucas'],
    sentences: [
      'Several rescue teams leave staging at once: who goes to whom, and in what order, so that people wait as little as possible in total?',
      'This page solves that routing problem three ways on the site\'s real walking paths, and measures each method honestly.',
    ],
    field: 'Travel times through debris must be known, people\'s positions must be known, and the teams must be interchangeable. A field plan would measure each.',
    unknown: 'Whether any quantum or quantum-inspired annealer beats classical solvers on routing at useful sizes is an open research question. At this size the exact solver wins in milliseconds.',
  });

  const scenarioSeg = seg('Scenario', [{ value: 'mission', label: 'This mission' }, { value: 'drill', label: 'Mass-casualty drill' }], () => state.scenario, (v) => chooseScenario(v), 'scenario');
  const nSeg = seg('People to reach', [5, 6, 7, 8, 9].map((v) => ({ value: v, label: String(v) })), () => state.N, (v) => { state.N = v; nSeg.sync(); build(); }, 'n');
  const kSeg = seg('Rescue teams', [2, 3].map((v) => ({ value: v, label: String(v) })), () => state.K, (v) => { state.K = v; kSeg.sync(); build(); }, 'k');
  const rSeg = seg('Restarts per annealer', [10, 20, 40].map((v) => ({ value: v, label: String(v) })), () => state.restarts, (v) => { state.restarts = v; rSeg.sync(); settingsChanged(); }, 'restarts');
  const sSeg = seg('Sweeps per run', [200, 400, 800, 1600].map((v) => ({ value: v, label: int(v) })), () => state.sweeps, (v) => { state.sweeps = v; sSeg.sync(); settingsChanged(); }, 'sweeps');
  const scenarioNote = h('small');
  const sweepNote = h('small');
  const solveBtn = h('button.btn.btn-primary', { type: 'button', 'data-act': 'solve', onclick: () => (run ? stopRun('Stopped. Results so far are kept.') : startRun()) }, icon('play', 16), h('span', null, 'Solve all three'));
  const drillBtn = h('button.btn', { type: 'button', 'data-act': 'drill', onclick: () => { state.seed++; build(); } }, icon('reset', 16), 'New drill');
  const statusText = h('p.strategy-teams-status', { role: 'status', 'aria-live': 'polite' });
  const statusBar = h('div.bar', { hidden: true }, h('i', { style: { width: '0%' } }));

  const left = h('div.strategy-col.left.strategy-teams-left', null, brief,
    h('section.strategy-sec', { 'aria-label': 'Set up the problem' },
      h('h3', null, 'Set up the problem'),
      h('div.strategy-ctl.strategy-teams-ctl', null, h('span', null, 'Scenario'), h('span'), scenarioSeg, scenarioNote),
      h('div.strategy-ctl', null, h('span', null, 'People to reach'), nSeg),
      h('div.strategy-ctl', null, h('span', null, 'Rescue teams ', h('span.strategy-assumed', null, 'concept')), kSeg),
      h('div.strategy-ctl', null, h('span', null, 'Restarts per annealer'), rSeg),
      h('div.strategy-ctl', null, h('span', null, 'Sweeps per run'), sSeg, sweepNote),
      h('p.strategy-fine', null, 'Teams walk at ', h('b', null, SPEED.toFixed(1) + ' m/s'), ' ', h('span.strategy-assumed', null, 'assumed'), ' along the route planner\'s paths. All times are simulated.')),
    h('section.strategy-sec.strategy-teams-go', { 'aria-label': 'Solve' },
      h('div.strategy-actions', null, solveBtn, drillBtn),
      statusText, statusBar));

  const viewSeg = seg('Whose plan is drawn', METHODS.map((m) => ({ value: m, label: METHOD[m].label })), () => state.view, (v) => setView(v, true), 'view');
  const summary = h('p.strategy-teams-sum', { 'aria-live': 'off' });
  const mapTags = h('div.strategy-teams-tags');
  const mapEmpty = h('div.strategy-teams-wait', { hidden: true });
  const map = canvas('strategy-teams-mapcv', 'Top-down plan of the site with each team\'s route', drawMap);
  const legend = h('div.strategy-teams-legend.adv-only', { 'aria-label': 'Routes, team by team' });
  const qCap = h('p.strategy-fine');
  const qcv = canvas('strategy-teams-qcv', 'Heat-map of the QUBO matrix', drawQ);
  const wlcv = canvas('strategy-teams-wlcv', 'Trotter replicas: one row per replica, one column per bit', drawWL);
  const rdGamma = h('b.num', null, 'n/a'), rdJ = h('b.num', null, 'n/a'), rdAgree = h('b.num', null, 'n/a');
  const wlTitle = h('p.strategy-point', null, 'As the transverse field falls, the coupling grows and ' + M_REPLICAS + ' replicas lock together');

  const overlay = demoOverlay(ctx.kit, { title: 'Who goes to whom', sentence: 'Several teams, many people: each order of visits is scored by how long everyone waits.', tags: ['live-algo', 'concept'], action: { label: 'Solve again', icon: 'reset', run: () => { if (!run) startRun(); } } });
  overlay.el.classList.add('demo-only');
  const main = h('div.strategy-main.strategy-teams-main', null,
    h('div.strategy-teams-bar.adv-only', null, viewSeg, summary),
    h('div.strategy-teams-map', null, map.el, mapTags, mapEmpty),
    legend,
    h('section.strategy-teams-wl.adv-only', { 'aria-label': 'Simulated quantum annealing, live' },
      h('div.strategy-teams-wlhead', null, wlTitle,
        h('div.note.strategy-teams-claim', null, icon('info', 14), h('span', null, h('b', null, 'A classical simulation of quantum annealing.'), ' No quantum hardware is used or claimed.'))),
      h('div.strategy-teams-wlbody', null, wlcv.el,
        h('dl.strategy-teams-rd', null,
          h('dt', null, 'Transverse field Γ'), h('dd', null, rdGamma),
          h('dt', null, 'Replica coupling J⊥'), h('dd', null, rdJ),
          h('dt', null, 'Neighbours that agree'), h('dd', null, rdAgree)))));

  const verdict = h('p.strategy-point');
  const tbody = h('tbody');
  const table = h('table.strategy-table.strategy-teams-table', null,
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Method'), h('th.num', { scope: 'col', title: 'Sum of arrival times of the best run, minutes:seconds' }, 'Sum of arrivals'), h('th.num', { scope: 'col', title: 'Median over the runs, against the exact optimum' }, 'Gap to exact'), h('th.num', { scope: 'col', title: 'Runs whose bits were a valid plan before any repair' }, 'Feasible'), h('th.num', { scope: 'col', title: 'Runs that found the exact optimum' }, 'Optimal'), h('th.num', { scope: 'col', title: 'Compute time for all runs together' }, 'Time'))),
    tbody);
  const tableFine = h('p.strategy-fine');
  const convTitle = h('p.strategy-point', null, 'Each run first sheds its rule penalties, then closes in on the proven optimum');
  const convEl = h('canvas.strategy-chart', { role: 'img', 'aria-label': 'Energy against schedule for both annealers' });
  const conv = createChart(convEl, ctx.kit);
  const convFine = h('p.strategy-fine');
  const landTitle = h('p.strategy-point');
  const land = canvas('strategy-teams-landcv', 'Histogram of the cost of every possible plan, with a close-up of the best plans', drawLand);
  const landFine = h('p.strategy-fine');
  const testList = h('ul.strategy-teams-tests');

  const right = h('div.strategy-col.right', null,
    h('section.strategy-sec', { 'aria-label': 'Measured results' }, h('h3', null, 'Measured results'), verdict, table, tableFine),
    h('section.strategy-sec', { 'aria-label': 'Convergence' }, h('h3', null, 'Convergence'), convTitle, convEl, convFine),
    h('section.strategy-sec', { 'aria-label': 'Energy landscape' }, h('h3', null, 'Energy landscape'), landTitle, land.el, landFine),
    h('section.strategy-sec', { 'aria-label': 'The problem as a quantum annealer needs it' }, h('h3', null, 'The same problem, written as bits'),
      h('div.strategy-teams-q', null, qcv.el, qCap),
      h('p.strategy-point', null, 'Self-test: the binary form gives the same answers as the routes'), testList));

  main.append(overlay.el);
  pane.append(h('div.strategy-ex.wide-side', null, left, main, right));

  // ------------------------------------------------------------------ scenario
  function missionPeople() {
    const dets = (ctx.sim.state.detections || []).filter((d) => d.pos && !d.dismissed && (d.status === 'confirmed' || (d.status === 'possible' && d.needsTeam)));
    return dets.slice(0, 9).map((d) => ({ pos: [d.pos[0], d.pos[1]], name: d.id + (d.room ? ', room ' + d.room : d.outdoor ? ', outdoors' : ''), status: d.status }));
  }
  const missionSig = () => missionPeople().map((p) => p.name + p.pos.map((v) => v.toFixed(1)).join()).join('|');

  const freeRooms = W.ROOMS.filter((r) => !r.corridor && !(W.DOORS.find((d) => d.room === r.id) || {}).blocked);
  const debris = (W.OBSTACLES.find((o) => o.id === 'rubble-field') || {}).poly;
  const bldgC = (W.OBSTACLES.find((o) => o.id === 'bldg-c') || {}).poly;
  function sampleSpot(rng) {
    const u = rng();
    if (u < 0.56 || !debris || !bldgC) { const r = freeRooms[Math.floor(rng() * freeRooms.length)].rect; return [r[0] + 1.2 + rng() * (r[2] - r[0] - 2.4), r[1] + 1.2 + rng() * (r[3] - r[1] - 2.4)]; }
    const poly = u < 0.8 ? debris : bldgC, xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]), grow = poly === bldgC ? 4.5 : 0;
    const x0 = Math.min(...xs) - grow, x1 = Math.max(...xs) + grow, y0 = Math.min(...ys) - grow, y1 = Math.max(...ys) + grow;
    for (let n = 0; n < 40; n++) {
      const p = [x0 + rng() * (x1 - x0), y0 + rng() * (y1 - y0)];
      if (poly === debris ? pointInPoly(p, poly) : !(p[0] > x0 + grow - 1 && p[0] < x1 - grow + 1 && p[1] > y0 + grow - 1 && p[1] < y1 - grow + 1)) return p;
    }
    return [x0, y0];
  }

  let legCache = new Map(), legGrid = null;
  function leg(a, b) {
    if (legGrid !== ctx.sim.grid) { legGrid = ctx.sim.grid; legCache = new Map(); }
    const key = a[0].toFixed(2) + ',' + a[1].toFixed(2) + '>' + b[0].toFixed(2) + ',' + b[1].toFixed(2);
    let r = legCache.get(key);
    if (r) return r;
    const p = ctx.sim.plan(a, b, { nearest: true });
    let path, reached = false;
    if (!p || !p.ok) path = [a.slice(), b.slice()];
    else { path = p.path.map((q) => [q[0], q[1]]); reached = !!p.reached; if (!reached) path.push(b.slice()); }
    r = { path, reached, length: pathLength(path) };
    legCache.set(key, r);
    return r;
  }

  async function build() {
    const token = ++buildToken;
    stopRun(null);
    res = null; reveal = null; wlSnap = null; sc = null;
    const kind = state.scenario, K = state.K;
    const depots = Array.from({ length: K }, (_, k) => [SITE.staging[0] + (k - (K - 1) / 2) * 4, SITE.staging[1]]);
    let last = performance.now();
    const breathe = async () => { if (performance.now() - last > 10) { await new Promise((r) => setTimeout(r, 0)); last = performance.now(); } };
    try {
      let people;
      if (kind === 'mission') people = missionPeople();
      const N = kind === 'mission' ? people.length : state.N;
      planning = { done: 0, total: K * N + (N * (N - 1)) / 2 };
      syncControls(); renderAll();
      if (kind === 'drill') {
        const rng = mulberry32(0x5eed + state.seed * 7919), grid = ctx.sim.grid;
        people = [];
        for (let guard = 0; people.length < N && guard < 600; guard++) {
          const p = sampleSpot(rng), c = grid.toCell(p);
          if (p[0] < 1 || p[1] < 1 || p[0] > SITE.w - 1 || p[1] > SITE.h - 1 || grid.blocked[c[1] * grid.w + c[0]]) continue;
          if (people.some((o) => Math.hypot(o.pos[0] - p[0], o.pos[1] - p[1]) < 3.5)) continue;
          const fresh = !legCache.has(depots[0][0].toFixed(2) + ',' + depots[0][1].toFixed(2) + '>' + p[0].toFixed(2) + ',' + p[1].toFixed(2));
          if (!leg(depots[0], p).reached) continue;                // a drill person must be reachable on foot
          const room = W.roomAt(p);
          people.push({ pos: p, name: room ? 'room ' + room.id : 'outdoors' });
          if (fresh) { await breathe(); if (token !== buildToken) return; }
        }
        if (people.length < N) throw new Error('Could not place ' + N + ' reachable people on this map.');
      }
      const t = new Float64Array(N * N), t0 = new Float64Array(K * N), legs = new Map();
      let forced = 0;
      for (let i = 0; i < N; i++) {
        for (let k = 0; k < K; k++) { const r = leg(depots[k], people[i].pos); legs.set('d' + k + '>' + i, r); t0[k * N + i] = r.length / SPEED; if (!r.reached) forced++; planning.done++; await breathe(); if (token !== buildToken) return; }
        for (let j = i + 1; j < N; j++) { const r = leg(people[i].pos, people[j].pos); legs.set(i + '>' + j, r); t[i * N + j] = t[j * N + i] = r.length / SPEED; planning.done++; setStatus(); await breathe(); if (token !== buildToken) return; }
      }
      sc = { kind, people, depots, legs, forced, prob: { N, K, t, t0 } };
      planning = null;
      solveExact();
      syncControls(); renderAll();
      startReveal();
      if (!autoRan && visible) { autoRan = true; startRun(); }
    } catch (err) {
      if (token !== buildToken) return;
      planning = null; sc = null; res = null;
      console.warn('[strategy/teams] scenario failed', err);
      mapEmpty.hidden = false; mapEmpty.replaceChildren(icon('alert', 22), h('p', null, 'The routes could not be planned: ' + (err && err.message || err) + ' Try "New drill".'));
      syncControls(); renderAll();
    }
  }

  function chooseScenario(v) {
    if (v === 'mission') {
      const n = missionPeople().length;
      if (n < 3) {
        fallbackNote = 'This mission has located ' + (n === 0 ? 'no one' : n === 1 ? '1 person' : n + ' people') + ' so far; routing needs at least 3. Showing the drill instead. Let the mission run, then choose it again.';
        if (state.scenario === 'drill' && sc) { syncControls(); return; }
        v = 'drill';
      } else fallbackNote = '';
    } else fallbackNote = '';
    state.scenario = v;
    build();
  }

  function solveExact() {
    const { prob } = sc, P = Math.max(1, prob.N - prob.K + 1);
    const ex = S.solveExact(prob, { cap: P }), un = S.solveExact(prob), worst = S.solveExact(prob, { sign: -1 });
    const reps = 20, tRep = performance.now();                      // the clock is too coarse for one solve: time 20
    for (let i = 0; i < reps; i++) S.solveExact(prob, { cap: P });
    ex.ms = (performance.now() - tRep) / reps;
    const qubo = S.buildQubo(prob, { P });
    res = { ex, un, worst, qubo, tests: S.selfTest(prob, qubo, ex, un, 7), en: null, enumOk: null, sa: null, sqa: null, bound: S.penaltyBound(prob, P),
      exact: { routes: ex.routes, cost: ex.cost, arrivals: S.planCost(prob, ex.routes).arrivals } };
    for (const k in dirty) dirty[k] = true;
  }

  // ------------------------------------------------------------------ the solve, time-sliced
  function startRun() {
    if (!sc || !res || run) return;
    solveExact();                                                   // "all three": the exact solve is repeated and re-timed
    solveCount++;
    res.sa = { runs: [], best: null, trace: null, ms: 0, sweeps: 0 };
    res.sqa = { runs: [], best: null, trace: null, ms: 0, sweeps: 0 };
    res.en = S.createEnumerator(sc.prob, res.un.cost, res.worst.cost);
    wlSnap = null;
    run = { phase: 'enum', r: 0, R: state.restarts, an: null, seed: solveCount * 1000 + state.seed * 17, sched: S.schedules(res.qubo, state.sweeps, M_REPLICAS), live: null, liveE: NaN };
    state.follow = true;
    setView('exact', false);
    syncControls(); setStatus();
    drive();
  }
  function stopRun(message) {
    if (!run) return;
    run = null;
    if (res && res.en && !res.en.done) res.en = null;
    if (message != null) finishRun(message);
  }
  function finishRun(message) {
    for (const k in dirty) dirty[k] = true;
    syncControls(); setStatus(message); startReveal(); renderAll();
  }
  function newAnnealer(kind) {
    const o = { ...run.sched[kind], seed: run.seed + run.r * 2 + (kind === 'sqa' ? 1 : 0) };
    run.an = kind === 'sa' ? S.createSA(res.qubo, o) : S.createSQA(res.qubo, o);
    run.live = null; run.liveE = NaN;
    res[kind].sweeps = o.sweeps;
  }
  function recordRestart() {
    const kind = run.phase, an = run.an, slot = res[kind];
    const ro = S.readOut(sc.prob, res.qubo, an.bestX);
    slot.runs.push({ cost: ro.cost, feasible: ro.feasible, ms: an.ms });
    slot.ms += an.ms;
    if (!slot.best || ro.cost < slot.best.cost - 1e-9) slot.best = { routes: ro.routes, cost: ro.cost, repaired: ro.repaired, arrivals: S.planCost(sc.prob, ro.routes).arrivals };
    if (run.r === 0) slot.trace = an.trace;
    if (kind === 'sqa') wlSnap = { X: an.X.slice(), M: an.M, n: an.n, gamma: an.gamma, jperp: an.jperp, T: an.T, agree: an.agreement(), label: 'run ' + (run.r + 1) + ' of ' + run.R + ', finished' };
    dirty.table = dirty.land = dirty.conv = dirty.wl = true;
  }
  // Do up to budget ms of solving. animate: the first run of each annealer is paced so it can be watched.
  function advance(budget, animate) {
    const end = performance.now() + budget;
    if (run.phase === 'enum') {
      if (res.en.step(budget)) {
        res.enumOk = { pass: Math.abs(res.en.min - res.un.cost) < 1e-6, diff: Math.abs(res.en.min - res.un.cost) };
        dirty.tests = true;
        run.phase = 'sa'; run.r = 0; newAnnealer('sa');
        if (state.follow) setView('sa', false);
      }
      dirty.land = true;
      return;
    }
    const an = run.an, kind = run.phase;
    if (animate && run.r === 0) an.step(Math.max(1, Math.ceil(an.sweeps / 150)));
    else { const chunk = kind === 'sa' ? 240 : 10; while (!an.done && performance.now() < end) an.step(chunk); }
    if (kind === 'sqa') dirty.wl = true;
    if (run.r === 0) dirty.conv = true;
    if (!an.done) return;
    recordRestart();
    run.r++;
    if (run.r < run.R) { newAnnealer(kind); return; }
    if (kind === 'sa') { run.phase = 'sqa'; run.r = 0; newAnnealer('sqa'); if (state.follow) setView('sqa', false); return; }
    run = null;
    finishRun();
  }
  let pumping = false;
  const loop = makeLoop(() => {
    if (run) advance(10, true);
    renderLive();
    if (!run && !revealing()) loop.stop();
  });
  function drive() {
    if (!visible) return;
    if (!reducedMotion()) { loop.start(); return; }
    if (pumping || !run) { renderAll(); return; }
    pumping = true;                                                 // reduced motion: compute in slices, draw only the result
    const go = () => { if (!visible || !run) { pumping = false; renderAll(); return; } advance(14, false); setStatus(); setTimeout(go, 0); };
    go();
  }
  const revealing = () => !!reveal && performance.now() - reveal.t0 < reveal.dur;
  function startReveal() {
    if (reducedMotion() || !visible) { reveal = null; return; }
    reveal = { t0: performance.now(), dur: 1500 };
    loop.start();
  }

  // ------------------------------------------------------------------ what to draw
  function shownPlan() {
    if (!res) return null;
    const v = state.view;
    if (v === 'exact') return res.exact;
    if (run && run.phase === v && run.r === 0 && run.an) {
      if (run.liveE !== run.an.bestE) {
        run.liveE = run.an.bestE;
        const d = S.decode(res.qubo, run.an.bestX);
        run.live = d.feasible ? { routes: d.routes, cost: S.planCost(sc.prob, d.routes).total, arrivals: S.planCost(sc.prob, d.routes).arrivals, live: true } : null;
      }
      return run.live;
    }
    return (res[v] && res[v].best) || null;
  }
  function setView(v, byUser) {
    if (byUser) state.follow = false;
    const changed = state.view !== v;
    state.view = v; viewSeg.sync();
    if (changed && byUser && !run) startReveal();
    renderPlanText(); map.redraw();
  }
  function settingsChanged() {
    syncControls();
    if (run) { stopRun(null); res.sa = res.sqa = null; finishRun('Settings changed. Press "Solve all three" to measure again.'); }
    else if (res && res.sa) setStatus('Settings changed. Press "Solve all three" to measure with them.');
  }

  function syncControls() {
    scenarioSeg.sync(); nSeg.sync(); kSeg.sync(); rSeg.sync(); sSeg.sync(); viewSeg.sync();
    const mission = state.scenario === 'mission';
    nSeg.setDisabled(mission, 'Set by the mission: one stop for each located person.');
    drillBtn.disabled = mission; drillBtn.title = mission ? 'Only the drill can be redrawn. This scenario follows the mission.' : 'Place the people somewhere else (a new random seed)';
    solveBtn.disabled = !sc || !!planning; solveBtn.title = planning ? 'The routes are still being planned.' : !sc ? 'There is no scenario to solve.' : run ? 'Stop the annealers' : 'Run the exact solver and both annealers, and measure them';
    solveBtn.classList.toggle('btn-primary', !run);
    solveBtn.replaceChildren(icon(run ? 'stop' : 'play', 16), h('span', null, run ? 'Stop' : 'Solve all three'));
    const n = sc ? sc.prob.N : state.N;
    scenarioNote.textContent = fallbackNote || (mission
      ? n + ' people located so far in the running mission. The mission itself is simulated.'
      : 'Simulated: ' + n + ' people at random free spots in building B, the debris field and beside building C. Seed ' + state.seed + '.');
    scenarioNote.classList.toggle('is-warn', !!fallbackNote);
    sweepNote.textContent = 'Simulated quantum annealing: ' + int(state.sweeps) + ' sweeps of ' + M_REPLICAS + ' replicas. Simulated annealing: ' + int(state.sweeps * M_REPLICAS) + ' sweeps of one copy. The same number of proposed bit flips.';
    mapTags.replaceChildren(
      h('span.tag.tag-sim', null, mission ? 'This mission, simulated' : 'Simulated drill, seed ' + state.seed),
      h('span.tag.tag-sim', { title: 'The rescue teams are drawn to show the idea.' }, 'Rescue teams: concept'));
    setStatus();
  }

  function setStatus(message) {
    let text = message || '', frac = null;
    if (planning) { text = 'Planning ' + planning.total + ' routes… ' + planning.done + ' done'; frac = planning.done / planning.total; }
    else if (run) {
      if (run.phase === 'enum') { text = 'Exact optimum found. Counting every plan… ' + int(res.en.count) + ' of ' + int(res.en.total); frac = res.en.count / res.en.total; }
      else { const an = run.an; text = METHOD[run.phase].label + ': run ' + (run.r + 1) + ' of ' + run.R + ', sweep ' + int(an.sweep) + ' of ' + int(an.sweeps); frac = ((run.phase === 'sqa' ? 1 : 0) + (run.r + an.sweep / an.sweeps) / run.R) / 2; }
    } else if (!text) {
      if (!sc) text = 'No scenario.';
      else if (res && res.sa && res.sqa && res.sqa.runs.length) text = 'Done. ' + res.sa.runs.length + ' + ' + res.sqa.runs.length + ' annealing runs measured against the exact optimum.';
      else text = 'Exact optimum ready. Press "Solve all three" to run and measure both annealers.';
      if (sc && sc.forced) text += ' ' + sc.forced + ' leg' + (sc.forced > 1 ? 's end' : ' ends') + ' at a blockage: a team would have to break through.';
    }
    if (statusText.textContent !== text) statusText.textContent = text;
    overlay.caption(planning ? 'Planning the walking routes.' : run ? (run.phase === 'enum' ? 'Counting every possible plan.' : METHOD[run.phase].label + (run.phase === 'sqa' ? ', a classical simulation, ' : ', ') + 'run ' + (run.r + 1) + ' of ' + run.R + '.') : res && res.ex && sc ? 'Best plan: average wait ' + mmss(res.ex.cost / sc.prob.N) + '. Proven by exact search.' : '');
    statusBar.hidden = frac == null;
    if (frac != null) statusBar.firstChild.style.width = (Math.min(1, frac) * 100).toFixed(1) + '%';
  }

  // ------------------------------------------------------------------ text: summary, legend, table, tests
  let planKey = '';
  function renderPlanText() {
    const plan = shownPlan(), v = state.view;
    const key = v + '|' + (plan ? plan.cost.toFixed(3) + JSON.stringify(plan.routes) : 'none') + '|' + (run ? run.phase : '') + (sc ? sc.prob.N + '.' + sc.prob.K : '');
    if (key === planKey) return;
    planKey = key;
    if (!sc || !res) { summary.textContent = planning ? 'Planning the walking routes…' : ''; legend.replaceChildren(); return; }
    const N = sc.prob.N;
    if (!plan) {
      const live = run && run.phase === v;
      summary.replaceChildren(live ? 'No valid plan yet: the bits still break a rule (a person twice, or not at all).' : v === 'exact' ? '' : METHOD[v].label + ' has not run yet. Press "Solve all three".');
      legend.replaceChildren(h('span.strategy-teams-leg.dim', null, live ? 'Waiting for the first valid plan from this run…' : 'No plan to draw for this solver yet.'));
      map.el.setAttribute('aria-label', 'Top-down plan of the site. ' + N + ' people, no routes drawn yet for ' + METHOD[v].label + '.');
      return;
    }
    let lastArr = 0; for (let i = 0; i < N; i++) lastArr = Math.max(lastArr, plan.arrivals[i]);
    const gap = plan.cost / res.ex.cost - 1;
    summary.replaceChildren(...[h('span', null, 'Sum of arrival times ', h('b.num', null, mmss(plan.cost))),
      v !== 'exact' ? h('span', null, h('b.num', null, gap < 5e-7 ? 'optimal' : '+' + pct(gap)), gap < 5e-7 ? '' : ' over the optimum') : h('span', null, 'proven best'),
      plan.live ? h('span', null, 'best so far in this run') : null,
      plan.repaired ? h('span.strategy-assumed', { title: 'The bits broke a rule; the plan was completed greedily.' }, 'repaired') : null].filter(Boolean));
    legend.replaceChildren(...plan.routes.map((r, k) => h('span.strategy-teams-leg', null,
      h('i.strategy-teams-key', { 'data-team': String(k) }), h('b', null, 'Team ' + (k + 1)),
      h('span.num', null, r.length ? r.map((i) => i + 1).join(' → ') : 'stays at staging'),
      r.length ? h('span.dim', null, 'done ' + mmss(plan.arrivals[r[r.length - 1]])) : null)),
      h('span.strategy-teams-leg.strategy-teams-avg', null, 'Average wait ', h('b.num', null, mmss(plan.cost / N)), ' · last person reached at ', h('b.num', null, mmss(lastArr))));
    map.el.setAttribute('aria-label', 'Top-down plan of the site, ' + METHOD[v].label + '. ' + plan.routes.map((r, k) => 'Team ' + (k + 1) + ': ' + (r.length ? r.map((i) => 'person ' + (i + 1) + ' (' + sc.people[i].name + ') at ' + mmss(plan.arrivals[i])).join(', then ') : 'stays at staging')).join('. ') + '.');
  }

  function renderTable() {
    dirty.table = false;
    if (!res) { tbody.replaceChildren(h('tr', null, h('td', { colSpan: 6 }, planning ? 'Planning the routes first…' : 'Nothing solved yet.'))); verdict.textContent = ''; tableFine.textContent = ''; return; }
    const opt = res.ex.cost;
    const row = (m) => {
      const key = h('span.strategy-key', { style: { background: 'var(' + METHOD[m].c + ')' } });
      if (m === 'exact') return h('tr', null, h('td', null, key, METHOD.exact.long), h('td.num', null, mmss(opt)), h('td.num', null, h('small', null, 'reference')), h('td.num', null, h('small', null, 'by design')), h('td.num', null, h('small', null, 'proven')), h('td.num', null, msText(res.ex.ms)));
      const s = res[m];
      if (!s || !s.runs.length) return h('tr', null, h('td', null, key, METHOD[m].long), h('td.num.flat', { colSpan: 5 }, h('small', null, run ? (run.phase === m ? 'first run in progress…' : 'waiting its turn') : 'not run yet')));
      const n = s.runs.length, gaps = s.runs.map((r) => r.cost / opt - 1), med = S.median(gaps), feas = s.runs.filter((r) => r.feasible).length, optimal = s.runs.filter((r) => r.cost - opt < 1e-6).length;
      const bestGap = s.best.cost / opt - 1;
      return h('tr', null, h('td', null, key, METHOD[m].long),
        h('td.num', null, mmss(s.best.cost), h('br'), h('small', null, bestGap < 5e-7 ? 'best run: optimal' : 'best run: +' + pct(bestGap))),
        h('td.num', null, med < 5e-7 ? '0.0 %' : '+' + pct(med), h('br'), h('small', null, 'median')),
        h('td.num', null, feas + '/' + n), h('td.num', null, optimal + '/' + n),
        h('td.num', null, int(s.ms) + ' ms', h('br'), h('small', null, int(s.ms / n) + ' a run')));
    };
    tbody.replaceChildren(...METHODS.map(row));
    const done = res.sa && res.sqa && res.sa.runs.length && res.sqa.runs.length;
    if (!done) verdict.textContent = 'The exact solver has proved the best plan: ' + mmss(opt) + ' of waiting in total, found in ' + msText(res.ex.ms) + '.';
    else {
      const slower = Math.min(res.sa.ms / res.sa.runs.length, res.sqa.ms / res.sqa.runs.length) / Math.max(res.ex.ms, 0.01);
      const nOpt = ['sa', 'sqa'].reduce((a, m) => a + res[m].runs.filter((r) => r.cost - opt < 1e-6).length, 0), nRuns = res.sa.runs.length + res.sqa.runs.length;
      verdict.textContent = 'Exact wins at this size: it proves the best plan in ' + msText(res.ex.ms) + '. One annealing run takes at least ' + int(slower) + ' times as long, and ' + (nOpt ? nOpt + ' of ' + nRuns + ' runs' : 'none of ' + nRuns + ' runs') + ' found that plan.';
    }
    const repaired = ['sa', 'sqa'].map((m) => (res[m] ? res[m].runs.filter((r) => !r.feasible).length : 0));
    tableFine.replaceChildren('Measured in this browser, in this simulated scenario. The exact time is the mean of 20 solves. Sum of arrivals is the best run, in min:s. Feasible counts runs whose bits were a valid plan before any repair', repaired[0] + repaired[1] ? ' (' + (repaired[0] + repaired[1]) + ' were repaired greedily)' : '', '. The point is the method an annealer needs, not a speed claim. The visiting order is a planning aid, not a medical priority.');
  }

  function renderTests() {
    dirty.tests = false;
    if (!res) { testList.replaceChildren(h('li.dim', null, 'Runs as soon as the routes are planned.')); return; }
    const by = Object.fromEntries(res.tests.map((t) => [t.id, t])), sci = (v) => (v === 0 ? '0' : v.toExponential(1));
    const item = (pass, text, detail) => h('li', { class: pass == null ? 'is-wait' : pass ? 'is-pass' : 'is-fail' }, pass == null ? h('span.spinner.sm') : icon(pass ? 'check' : 'close', 14),
      h('span', null, h('b', null, text), h('small', null, detail)), h('em', null, pass == null ? 'waiting' : pass ? 'pass' : 'fail'));
    const en = res.en;
    testList.replaceChildren(
      item(by.optimum.pass, 'The energy of the best plan equals the exact optimum', 'difference ' + sci(by.optimum.diff) + ' s'),
      item(by.random.pass, 'On 200 random plans the energy equals the sum of arrival times', 'largest difference ' + sci(by.random.diff) + ' s'),
      item(by.cap.pass, 'Limiting a team to ' + by.cap.P + ' stops loses nothing', by.cap.pass ? 'the optimum is the same without the limit' : 'the limit costs ' + by.cap.diff.toFixed(1) + ' s here'),
      item(by.local.pass, 'No change of one or two bits improves on the best plan', int(by.local.checked) + ' neighbours checked; the closest is ' + by.local.least.toFixed(0) + ' s worse'),
      res.enumOk ? item(res.enumOk.pass, 'The exact optimum is the best of all ' + int(en.total) + ' plans, counted one by one', 'difference ' + sci(res.enumOk.diff) + ' s')
        : item(null, 'The exact optimum is the best of all ' + int(S.planCount(sc.prob.N, sc.prob.K)) + ' plans', run && run.phase === 'enum' ? 'counting…' : 'counted when you press "Solve all three"'));
  }

  // ------------------------------------------------------------------ canvas: the site plan
  const rubbleDots = W.OBSTACLES.filter((o) => o.kind === 'rubble').map((o) => {
    const rng = mulberry32(o.id.length * 977 + 13), xs = o.poly.map((p) => p[0]), ys = o.poly.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), pts = [];
    for (let n = 0; n < (x1 - x0) * (y1 - y0) * 1.6; n++) { const p = [x0 + rng() * (x1 - x0), y0 + rng() * (y1 - y0), 0.4 + rng() * 0.9]; if (pointInPoly(p, o.poly)) pts.push(p); }
    return pts;
  });
  function legPath(a, b) {             // the planned path from node a to node b (people by index, depots as 'd0')
    const direct = sc.legs.get(a + '>' + b);
    if (direct) return direct.path;
    const back = sc.legs.get(b + '>' + a);
    return back ? back.path.slice().reverse() : [];
  }
  function drawMap(c, w, hh) {
    c.clearRect(0, 0, w, hh);
    const padL = 30, padB = 24, padT = 10, padR = 10;
    const s = Math.min((w - padL - padR) / SITE.w, (hh - padT - padB) / SITE.h);
    const ox = padL + (w - padL - padR - SITE.w * s) / 2, oy = padT + (hh - padT - padB - SITE.h * s) / 2;
    const X = (x) => ox + x * s, Y = (y) => oy + (SITE.h - y) * s;
    const poly = (pts) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])))); c.closePath(); };
    const font = (wt, px, mono) => { c.font = wt + ' ' + px + 'px ' + tok(mono ? '--mono' : '--font'); };
    // ground, 10 m grid, frame, coordinates
    c.fillStyle = tok('--bg-1'); c.fillRect(X(0), Y(SITE.h), SITE.w * s, SITE.h * s);
    c.lineWidth = 1;
    for (let x = 10; x < SITE.w; x += 10) { c.strokeStyle = rgba('--line', x % 20 ? 0.45 : 0.9); const px = Math.round(X(x)) + 0.5; c.beginPath(); c.moveTo(px, Y(SITE.h)); c.lineTo(px, Y(0)); c.stroke(); }
    for (let y = 10; y < SITE.h; y += 10) { c.strokeStyle = rgba('--line', y % 20 ? 0.45 : 0.9); const py = Math.round(Y(y)) + 0.5; c.beginPath(); c.moveTo(X(0), py); c.lineTo(X(SITE.w), py); c.stroke(); }
    c.strokeStyle = tok('--line-2'); c.strokeRect(Math.round(X(0)) + 0.5, Math.round(Y(SITE.h)) + 0.5, Math.round(SITE.w * s), Math.round(SITE.h * s));
    font(400, 11, true); c.fillStyle = tok('--text-3'); c.textBaseline = 'top'; c.textAlign = 'center';
    for (let x = 0; x <= SITE.w; x += 20) { c.fillText(x === SITE.w ? x + ' m' : String(x), X(x) - (x === SITE.w ? 8 : 0), Y(0) + 6); c.beginPath(); c.moveTo(Math.round(X(x)) + 0.5, Y(0)); c.lineTo(Math.round(X(x)) + 0.5, Y(0) + 4); c.stroke(); }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let y = 0; y <= SITE.h; y += 20) { c.fillText(String(y), X(0) - 7, Y(y)); c.beginPath(); c.moveTo(X(0) - 4, Math.round(Y(y)) + 0.5); c.lineTo(X(0), Math.round(Y(y)) + 0.5); c.stroke(); }
    // hazards: hatched, never crossed lightly
    const hazards = [...W.HAZARDS, ...((ctx.sim.state && ctx.sim.state.hazards) || [])];
    for (const hz of hazards) {
      c.save(); poly(hz.poly); c.clip();
      const xs = hz.poly.map((p) => X(p[0])), ys = hz.poly.map((p) => Y(p[1])), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      c.fillStyle = rgba('--danger', hz.block ? 0.1 : 0.035); c.fillRect(x0, y0, x1 - x0, y1 - y0);
      c.strokeStyle = rgba('--danger', hz.block ? 0.5 : 0.2); c.lineWidth = 1; c.beginPath();
      for (let d = x0 - (y1 - y0); d < x1; d += hz.block ? 5 : 7) { c.moveTo(d, y1); c.lineTo(d + (y1 - y0), y0); }
      c.stroke(); c.restore();
      c.setLineDash([3, 3]); c.strokeStyle = rgba('--danger', hz.block ? 0.8 : 0.42); poly(hz.poly); c.stroke(); c.setLineDash([]);
    }
    // buildings A and C
    for (const o of W.OBSTACLES.filter((q) => q.kind === 'building')) {
      poly(o.poly); c.fillStyle = tok('--bg-3'); c.fill(); c.strokeStyle = tok('--line-3'); c.lineWidth = 1; c.stroke();
      const cx = o.poly.reduce((a, p) => a + p[0], 0) / o.poly.length, cy = o.poly.reduce((a, p) => a + p[1], 0) / o.poly.length;
      font(500, 11); c.fillStyle = tok('--text-3'); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(o.name.split(' (')[0], X(cx), Y(cy));
    }
    // building B: floor, rooms, walls with door gaps
    const br = W.BUILDING.rect;
    c.fillStyle = tok('--bg-2'); c.fillRect(X(br[0]), Y(br[3]), (br[2] - br[0]) * s, (br[3] - br[1]) * s);
    for (const r of W.ROOMS) {
      if (r.corridor) { c.fillStyle = rgba('--text', 0.035); c.fillRect(X(r.rect[0]), Y(r.rect[3]), (r.rect[2] - r.rect[0]) * s, (r.rect[3] - r.rect[1]) * s); continue; }
      if (s > 4.6) { font(400, 11, true); c.fillStyle = rgba('--text-3', 0.75); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(r.id, X(r.rect[0]) + 4, Y(r.rect[3]) + 4); }
    }
    for (let i = 0; i < W.OBSTACLES.length; i++) {
      const o = W.OBSTACLES[i];
      if (o.kind === 'building') continue;
      poly(o.poly); c.fillStyle = rgba('--text-3', o.kind === 'rubble' ? 0.13 : 0.2); c.fill();
      c.strokeStyle = rgba('--text-3', 0.6); c.lineWidth = 1; if (o.kind === 'rubble') c.setLineDash([2, 2]); c.stroke(); c.setLineDash([]);
    }
    c.fillStyle = rgba('--text-2', 0.5);
    for (const pts of rubbleDots) for (const p of pts) c.fillRect(X(p[0]), Y(p[1]), p[2], p[2]);
    for (const wl of W.WALLS) {
      c.beginPath(); c.moveTo(X(wl.a[0]), Y(wl.a[1])); c.lineTo(X(wl.b[0]), Y(wl.b[1]));
      if (wl.state === 'collapsed') { c.strokeStyle = rgba('--danger', 0.7); c.lineWidth = 1; c.setLineDash([1, 3]); }
      else if (wl.state === 'damaged') { c.strokeStyle = tok('--text-2'); c.lineWidth = 1; c.setLineDash([4, 2]); }
      else { c.strokeStyle = tok(wl.mat === 'concrete' ? '--text' : '--text-2'); c.lineWidth = wl.mat === 'concrete' ? 1.75 : 1; c.setLineDash([]); }
      c.stroke();
    }
    c.setLineDash([]);
    font(500, 11); c.fillStyle = tok('--text-2'); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('Building B', X(br[0]), Y(br[1]) + 5);
    font(400, 11); c.fillStyle = rgba('--danger', 0.85); c.textBaseline = 'middle';
    for (const hz of hazards) {
      if (hz.kind === 'collapse' || hz.kind === 'gas') continue;
      const at = hz.kind === 'mud' ? [115, 13.4] : hz.kind === 'slope' ? [88.5, 64] : [hz.poly[0][0], hz.poly[0][1]];
      c.textAlign = hz.kind === 'mud' || hz.kind === 'slope' ? 'right' : 'left';
      c.fillText(HAZARD_WORD[hz.kind] || hz.kind, X(at[0]), Y(at[1]));
    }
    // scale bar and north arrow
    const bx = X(SITE.w - 26), by = Y(4.2), bw = 20 * s;
    c.strokeStyle = tok('--text-2'); c.lineWidth = 1; c.beginPath(); c.moveTo(bx + 0.5, by - 4); c.lineTo(bx + 0.5, by + 0.5); c.lineTo(bx + bw + 0.5, by + 0.5); c.lineTo(bx + bw + 0.5, by - 4); c.moveTo(bx + bw / 2 + 0.5, by); c.lineTo(bx + bw / 2 + 0.5, by - 3); c.stroke();
    font(400, 11, true); c.fillStyle = tok('--text-2'); c.textBaseline = 'bottom'; c.textAlign = 'left'; c.fillText('0', bx - 2, by - 5); c.textAlign = 'right'; c.fillText('20 m', bx + bw + 3, by - 5);
    const nx = X(SITE.w - 5), ny = Y(SITE.h - 5);
    c.beginPath(); c.moveTo(nx, ny + 13); c.lineTo(nx, ny - 9); c.moveTo(nx - 4, ny - 3); c.lineTo(nx, ny - 10); c.lineTo(nx + 4, ny - 3); c.stroke();
    font(600, 11); c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText('N', nx, ny + 15);
    if (!sc) return;

    // staging and the teams' starts
    const K = sc.prob.K, N = sc.prob.N, plan = shownPlan();
    font(500, 11); c.fillStyle = tok('--text-2'); c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText('Staging', X(SITE.staging[0]), Y(SITE.staging[1]) + 11);
    // routes, drawn in simulated time while they reveal
    const maxArr = plan ? Math.max(1, ...plan.arrivals) : 1;
    const u = reveal ? Math.min(1, (performance.now() - reveal.t0) / reveal.dur) : 1, clock = plan && u < 1 ? (1 - Math.pow(1 - u, 2)) * maxArr * 1.02 : Infinity;
    if (plan) for (let k = 0; k < K; k++) {
      const r = plan.routes[k]; if (!r.length) continue;
      const off = (k - (K - 1) / 2) * 2.4, col = TEAM[k].c;
      const pts = []; let tAcc = 0, prev = 'd' + k; const marks = [];
      for (const i of r) {
        const path = legPath(prev, i), t0leg = tAcc;
        for (let q = 0; q < path.length; q++) { if (q) tAcc += Math.hypot(path[q][0] - path[q - 1][0], path[q][1] - path[q - 1][1]) / SPEED; if (q || !pts.length) pts.push([X(path[q][0]) + off, Y(path[q][1]) + off, tAcc]); }
        marks.push((t0leg + tAcc) / 2); prev = i;
      }
      const trace = () => {
        c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
        for (let q = 1; q < pts.length; q++) {
          if (pts[q][2] <= clock) { c.lineTo(pts[q][0], pts[q][1]); continue; }
          const f = (clock - pts[q - 1][2]) / (pts[q][2] - pts[q - 1][2] || 1); c.lineTo(pts[q - 1][0] + (pts[q][0] - pts[q - 1][0]) * f, pts[q - 1][1] + (pts[q][1] - pts[q - 1][1]) * f); break;
        }
      };
      c.lineJoin = 'round'; c.lineCap = 'butt';
      trace(); c.strokeStyle = rgba('--bg-0', 0.9); c.lineWidth = 4.5; c.stroke();
      trace(); c.strokeStyle = rgba(col, 0.22); c.lineWidth = 4.5; c.stroke();
      trace(); c.strokeStyle = tok(col); c.lineWidth = 1.6; c.setLineDash(TEAM[k].dash); c.stroke(); c.setLineDash([]);
      c.fillStyle = tok(col);
      for (const tm of marks) {                                     // a chevron at the middle of each leg: direction of travel
        if (tm > clock) continue;
        let q = 1; while (q < pts.length - 1 && pts[q][2] < tm) q++;
        const a = pts[q - 1], b = pts[q], f = (tm - a[2]) / (b[2] - a[2] || 1), px = a[0] + (b[0] - a[0]) * f, py = a[1] + (b[1] - a[1]) * f, ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        c.save(); c.translate(px, py); c.rotate(ang); c.beginPath(); c.moveTo(5, 0); c.lineTo(-3.5, -3.6); c.lineTo(-1.5, 0); c.lineTo(-3.5, 3.6); c.closePath();
        c.strokeStyle = rgba('--bg-0', 0.9); c.lineWidth = 2; c.stroke(); c.fill(); c.restore();
      }
    }
    for (let k = 0; k < K; k++) {
      const d = sc.depots[k], px = Math.round(X(d[0])) + 0.5, py = Math.round(Y(d[1])) + 0.5;
      c.fillStyle = tok('--bg-0'); c.fillRect(px - 6.5, py - 6.5, 13, 13); c.strokeStyle = tok(TEAM[k].c); c.lineWidth = 1.5; c.strokeRect(px - 6.5, py - 6.5, 13, 13);
      font(600, 11, true); c.fillStyle = tok(TEAM[k].c); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(k + 1), px, py + 0.5);
    }
    // people, numbered, with arrival-time labels on leaders
    const teamOf = new Int8Array(N).fill(-1);
    if (plan) plan.routes.forEach((r, k) => r.forEach((i) => { teamOf[i] = k; }));
    const boxes = sc.people.map((p) => [X(p.pos[0]) - 10, Y(p.pos[1]) - 10, 20, 20]);
    const hit = (b) => b[0] < 2 || b[1] < 2 || b[0] + b[2] > w - 2 || b[1] + b[3] > hh - 2 || boxes.some((o) => b[0] < o[0] + o[2] && o[0] < b[0] + b[2] && b[1] < o[1] + o[3] && o[1] < b[1] + b[3]);
    const R = 8.5;
    for (let i = 0; i < N; i++) {
      const px = X(sc.people[i].pos[0]), py = Y(sc.people[i].pos[1]), reached = plan && plan.arrivals[i] <= clock;
      c.beginPath(); c.arc(px, py, R, 0, Math.PI * 2); c.fillStyle = tok('--bg-0'); c.fill();
      if (reached) { c.fillStyle = rgba('--person', 0.2); c.fill(); }
      c.strokeStyle = tok('--person'); c.lineWidth = 1.5; c.stroke();
      font(600, 11, true); c.fillStyle = tok('--person'); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), px, py + 0.5);
    }
    if (plan) for (let i = 0; i < N; i++) {
      if (teamOf[i] < 0 || plan.arrivals[i] > clock) continue;
      const px = X(sc.people[i].pos[0]), py = Y(sc.people[i].pos[1]), text = mmss(plan.arrivals[i]);
      font(500, 11, true);
      const tw = Math.ceil(c.measureText(text).width) + 10, th = 17;
      let box = null, anchor = null;
      for (const [dx, dy] of [[1, -1], [1, 1], [-1, -1], [-1, 1], [1, 0], [-1, 0], [0, -1], [0, 1], [1.8, -1.8], [-1.8, -1.8], [1.8, 1.8], [-1.8, 1.8]]) {
        const cx = px + dx * (R + 9 + (dx ? tw / 2 : 0)), cy = py + dy * (R + 7 + (dy && !dx ? th / 2 : 0));
        const b = [Math.round(cx - tw / 2), Math.round(cy - th / 2), tw, th];
        if (!hit(b)) { box = b; anchor = [dx, dy]; break; }
      }
      if (!box) { box = [Math.round(px + R + 6), Math.round(py - R - th), tw, th]; anchor = [1, -1]; }
      boxes.push(box);
      const col = TEAM[teamOf[i]].c, n = Math.hypot(anchor[0], anchor[1]) || 1;
      const ex = Math.max(box[0], Math.min(box[0] + box[2], px)), ey = Math.max(box[1], Math.min(box[1] + box[3], py));
      c.strokeStyle = rgba(col, 0.8); c.lineWidth = 1; c.beginPath(); c.moveTo(px + (anchor[0] / n) * R, py + (anchor[1] / n) * R); c.lineTo(ex, ey); c.stroke();
      c.fillStyle = rgba('--bg-0', 0.9); c.fillRect(box[0], box[1], box[2], box[3]);
      c.strokeStyle = rgba(col, 0.75); c.strokeRect(box[0] + 0.5, box[1] + 0.5, box[2] - 1, box[3] - 1);
      c.fillStyle = tok('--text'); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, box[0] + box[2] / 2, box[1] + box[3] / 2 + 0.5);
    }
  }

  // ------------------------------------------------------------------ canvas: the QUBO matrix
  function drawQ(c, w, hh) {
    dirty.q = false;
    c.clearRect(0, 0, w, hh);
    if (!res) { qCap.textContent = planning ? 'Built when the routes are planned.' : ''; return; }
    const q = res.qubo, n = q.n, pad = 18, side = Math.min(w, hh) - pad;
    let maxObj = 0;
    for (let u = 0; u < n; u++) { maxObj = Math.max(maxObj, Math.abs(q.objLin[u])); for (let v = u + 1; v < n; v++) maxObj = Math.max(maxObj, Math.abs(q.objW[u * n + v])); }
    const off = document.createElement('canvas'); off.width = off.height = n;
    const oc = off.getContext('2d'), img = oc.createImageData(n, n), grey = [128, 139, 153];
    const g = tok('--text-3').replace('#', ''); if (g.length === 6) { grey[0] = parseInt(g.slice(0, 2), 16); grey[1] = parseInt(g.slice(2, 4), 16); grey[2] = parseInt(g.slice(4, 6), 16); }
    for (let u = 0; u < n; u++) for (let v = u; v < n; v++) {
      const o = u === v ? q.objLin[u] : q.objW[u * n + v], p = u === v ? q.penLin[u] : q.penW[u * n + v], at = (u * n + v) * 4;
      if (o !== 0) { const rgb = heat(0.3 + 0.7 * Math.sqrt(Math.abs(o) / maxObj)); img.data[at] = rgb[0]; img.data[at + 1] = rgb[1]; img.data[at + 2] = rgb[2]; img.data[at + 3] = 255; }
      else if (p !== 0) { img.data[at] = grey[0]; img.data[at + 1] = grey[1]; img.data[at + 2] = grey[2]; img.data[at + 3] = Math.abs(p) >= 2 ? 150 : 80; }
    }
    oc.putImageData(img, 0, 0);
    c.fillStyle = tok('--bg-0'); c.fillRect(pad, pad, side, side);
    c.imageSmoothingEnabled = false; c.drawImage(off, pad, pad, side, side);
    const block = q.P * q.N, cell = side / n;
    c.lineWidth = 1;
    for (let k = 0; k <= q.K; k++) {
      const p = Math.round(pad + k * block * cell) + 0.5;
      c.strokeStyle = tok('--line-3'); c.beginPath(); c.moveTo(p, pad); c.lineTo(p, pad + side); c.moveTo(pad, p); c.lineTo(pad + side, p); c.stroke();
      if (k < q.K) {
        c.fillStyle = tok(TEAM[k].c); c.fillRect(pad + k * block * cell + 1, pad - 4, block * cell - 2, 2); c.fillRect(pad - 4, pad + k * block * cell + 1, 2, block * cell - 2);
        c.font = '500 11px ' + tok('--font'); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText('team ' + (k + 1), pad + (k + 0.5) * block * cell, pad - 6);
      }
    }
    qCap.replaceChildren(h('b', null, int(n) + ' binary variables, ' + int(q.couplings) + ' couplings.'), ' One bit means "team k reaches person i as its q-th stop from the end": ' + q.K + ' teams × ' + q.P + ' stops × ' + q.N + ' people. Warm cells are travel time. Grey cells are the rules; breaking one costs A = ' + int(q.A) + ' s, set just above the most that deleting a visit can save (' + int(res.bound) + ' s).');
  }

  // ------------------------------------------------------------------ canvas: Trotter replicas
  function drawWL(c, w, hh) {
    dirty.wl = false;
    c.clearRect(0, 0, w, hh);
    const live = run && run.phase === 'sqa' && run.an ? run.an : null;
    const src = live ? { X: live.X, M: live.M, n: live.n, gamma: live.gamma, jperp: live.jperp, T: live.T, agree: live.agreement() } : wlSnap;
    const padL = 34, padB = 26, padT = 2, padR = 2, pw = w - padL - padR, ph = hh - padT - padB;
    c.fillStyle = tok('--bg-0'); c.fillRect(padL, padT, pw, ph);
    c.font = '400 11px ' + tok('--font'); c.fillStyle = tok('--text-3');
    if (!src || !res) {
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(run ? 'Starts when simulated annealing has finished its runs.' : 'Press "Solve all three" to watch the replicas.', padL + pw / 2, padT + ph / 2);
      rdGamma.textContent = rdJ.textContent = rdAgree.textContent = 'n/a';
      return;
    }
    const { X: bits, M, n } = src, q = res.qubo, cw = pw / n, rh = ph / M, block = q.P * q.N;
    for (let k = 0; k < q.K; k++) {
      c.fillStyle = tok(TEAM[k].c);
      const base = k * block;
      for (let m = 0; m < M; m++) { const o = m * n + base, y = padT + m * rh; for (let u = 0; u < block; u++) if (bits[o + u]) c.fillRect(padL + (base + u) * cw, y, Math.max(1, cw - (cw > 3 ? 1 : 0)), Math.max(1, rh - 1)); }
    }
    c.lineWidth = 1;
    for (let b = 0; b <= n; b += q.N) { const px = Math.round(padL + b * cw) + 0.5; c.strokeStyle = b % block ? rgba('--line-2', 0.55) : tok('--line-3'); c.beginPath(); c.moveTo(px, padT); c.lineTo(px, padT + ph + (b % block ? 0 : 5)); c.stroke(); }
    c.textBaseline = 'top';
    for (let k = 0; k < q.K; k++) {
      const x0 = padL + k * block * cw, x1 = x0 + block * cw;
      c.fillStyle = tok(TEAM[k].c); c.textAlign = 'center'; c.font = '500 11px ' + tok('--font'); c.fillText('team ' + (k + 1) + (cw * block > 190 ? ': one column per bit' : ''), (x0 + x1) / 2, padT + ph + 9);
      if (cw * block > 300) { c.fillStyle = tok('--text-3'); c.font = '400 11px ' + tok('--font'); c.textAlign = 'left'; c.fillText('last stop', x0 + 3, padT + ph + 9); c.textAlign = 'right'; c.fillText('first stop', x1 - 3, padT + ph + 9); }
    }
    c.fillStyle = tok('--text-3'); c.font = '400 11px ' + tok('--mono'); c.textAlign = 'right'; c.textBaseline = 'middle';
    c.fillText('1', padL - 6, padT + rh / 2); c.fillText(String(M), padL - 6, padT + ph - rh / 2);
    c.save(); c.translate(11, padT + ph / 2); c.rotate(-Math.PI / 2); c.font = '400 11px ' + tok('--font'); c.textAlign = 'center'; c.fillText('replica', 0, 0); c.restore();
    rdGamma.textContent = (src.gamma / q.A).toFixed(3) + ' A';
    rdJ.textContent = (src.jperp / src.T > 99 ? '> 99' : (src.jperp / src.T).toFixed(2)) + ' T';
    rdAgree.textContent = pct(src.agree, 1);
  }

  // ------------------------------------------------------------------ chart: convergence
  function renderConv() {
    dirty.conv = false;
    if (!res) { conv.set({ x: { min: 0, max: 100 }, y: { min: 0, max: 1 }, series: [], empty: planning ? 'Planning the routes…' : 'Nothing to show yet.' }); convFine.textContent = ''; return; }
    // The energy above the exact optimum, on a log scale: 0.1 % stands for "at the optimum".
    const opt = res.ex.cost, series = [], lg = (e) => Math.log10(Math.max(0.1, (e / opt - 1) * 100));
    let top = 3;
    const add = (kind, a, b, label) => {
      const live = run && run.phase === kind && run.r === 0 && run.an;
      const tr = live ? run.an.trace : res[kind] && res[kind].trace;
      if (!tr) return;
      const total = live ? run.an.sweeps : res[kind].sweeps;
      top = Math.max(top, Math.ceil(lg(tr[a][0])));
      series.push({ color: METHOD[kind].c, width: 1, dash: [2, 2], pts: tr.s.map((s, i) => [(s / total) * 100, lg(tr[a][i])]) });
      series.push({ color: METHOD[kind].c, width: 1.8, label, pts: tr.s.map((s, i) => [(s / total) * 100, lg(tr[b][i])]) });
    };
    add('sa', 'cur', 'best', 'SA best so far'); add('sqa', 'mean', 'best', 'SQA best replica');
    const ticks = []; for (let e = -1; e <= top; e++) ticks.push(e);
    conv.set({ padR: 98, padL: 40, x: { min: 0, max: 100, label: 'schedule completed, %', ticks: [0, 25, 50, 75, 100] },
      y: { min: -1, max: top, ticks, label: 'energy above the exact optimum, % (log scale)', fmt: (v) => (v < 0 ? '0' : v < 3 ? String(Math.pow(10, v)) : v < 6 ? Math.pow(10, v - 3) + 'k' : Math.pow(10, v - 6) + 'M') },
      series, hlines: [{ y: -1, label: 'exact optimum, ' + mmss(opt), color: '--text-2', dash: [4, 3] }], empty: 'Press "Solve all three" to record a run of each annealer.' });
    convFine.replaceChildren('Run 1 of each annealer. Solid: the best state so far (SA), the best replica at that moment (SQA). Dashed: the current state (SA), the mean over replicas (SQA). Anything above about 100 % still breaks a rule; each broken rule adds ', h('b', null, 'A = ' + int(res.qubo.A) + ' s'), '.');
  }

  // ------------------------------------------------------------------ canvas: every plan there is
  function beats(cost) {                                            // share of all plans that are strictly worse (binned)
    const en = res.en; let below = 0;
    const g = cost / en.lo - 1;
    if (g < en.tailSpan) { const b = Math.floor((g / en.tailSpan) * en.tailBins); for (let i = 0; i <= Math.max(0, b); i++) below += en.tail[i]; }
    else { const b = Math.min(en.bins - 1, Math.floor(((cost - en.lo) / (en.hi - en.lo)) * en.bins)); for (let i = 0; i <= b; i++) below += en.hist[i]; }
    return 1 - below / en.total;
  }
  function drawLand(c, w, hh) {
    dirty.land = false;
    c.clearRect(0, 0, w, hh);
    const en = res && res.en;
    if (!en) {
      const total = sc ? S.planCount(sc.prob.N, sc.prob.K) : 0;
      landTitle.textContent = sc ? 'There are ' + int(total) + ' different plans. Exactly one sum of arrival times is the smallest.' : '';
      landFine.textContent = sc ? 'Press "Solve all three" to cost every one of them and draw the true landscape.' : '';
      c.font = '400 12px ' + tok('--font'); c.fillStyle = tok('--text-3'); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(planning ? 'Planning the routes…' : sc ? 'Not counted yet.' : '', w / 2, hh / 2);
      return;
    }
    const padL = 40, padR = 8, pw = w - padL - padR, top = 14, ch = 76, zTop = top + ch + 44, zh = 54, rug = zTop + zh + 5;
    const lo = en.lo / 60, hi = en.hi / 60;
    c.font = '400 11px ' + tok('--mono'); c.lineWidth = 1;
    // context: all plans, log count
    const nb = Math.max(20, Math.floor(pw / 4)), bars = new Float64Array(nb);
    for (let i = 0; i < en.bins; i++) bars[Math.min(nb - 1, Math.floor((i / en.bins) * nb))] += en.hist[i];
    let mx = 1; for (const v of bars) mx = Math.max(mx, v);
    const lmax = Math.max(1, Math.ceil(Math.log10(mx))), yOf = (v, y0, hgt, lm) => y0 + hgt - ((Math.log10(v) + 0.35) / (lm + 0.35)) * hgt;
    for (let e = 0; e <= lmax; e += lmax > 4 ? 2 : 1) { const py = Math.round(yOf(Math.pow(10, e), top, ch, lmax)) + 0.5; c.strokeStyle = tok('--line'); c.beginPath(); c.moveTo(padL, py); c.lineTo(padL + pw, py); c.stroke(); c.fillStyle = tok('--text-3'); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(e < 3 ? String(Math.pow(10, e)) : e < 6 ? Math.pow(10, e - 3) + 'k' : Math.pow(10, e - 6) + 'M', padL - 6, py); }
    const zMaxGap = zoomGap(), zx = padL + ((en.lo * (1 + zMaxGap) / 60 - lo) / (hi - lo)) * pw;
    for (let b = 0; b < nb; b++) { if (!bars[b]) continue; const x = padL + (b / nb) * pw, y = yOf(bars[b], top, ch, lmax); c.fillStyle = x < zx ? tok('--text') : rgba('--text-2', 0.5); c.fillRect(x, y, Math.max(1, pw / nb - 1), top + ch - y); }
    c.strokeStyle = tok('--line-2'); c.beginPath(); c.moveTo(padL + 0.5, top); c.lineTo(padL + 0.5, top + ch + 0.5); c.lineTo(padL + pw, top + ch + 0.5); c.stroke();
    c.fillStyle = tok('--text-3'); c.textBaseline = 'top'; c.textAlign = 'center';
    const span = hi - lo, stepM = span > 60 ? 20 : span > 30 ? 10 : span > 12 ? 5 : 2;
    for (let v = Math.ceil(lo / stepM) * stepM; v <= hi; v += stepM) { const px = padL + ((v - lo) / span) * pw; c.fillText(String(v), px, top + ch + 5); }
    c.font = '500 11px ' + tok('--font'); c.fillStyle = tok('--text-2'); c.textAlign = 'right'; c.fillText('sum of arrival times, min', padL + pw, top + ch + 18);
    c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('plans (log scale)', 2, 0);
    // the close-up: within zMaxGap of the best
    c.fillStyle = tok('--text'); c.fillRect(padL, top + ch + 2, Math.max(2, zx - padL), 2);
    c.fillStyle = tok('--text-2'); c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText('Close-up: the plans within ' + (zMaxGap * 100).toFixed(0) + ' % of the best', padL, zTop - 6);
    const zb = Math.max(10, Math.floor(pw / 5)), zbars = new Float64Array(zb), tailUsed = Math.round((zMaxGap / en.tailSpan) * en.tailBins);
    for (let i = 0; i < tailUsed; i++) zbars[Math.min(zb - 1, Math.floor((i / tailUsed) * zb))] += en.tail[i];
    let zmx = 1; for (const v of zbars) zmx = Math.max(zmx, v);
    const zl = Math.max(1, Math.ceil(Math.log10(zmx)));
    c.font = '400 11px ' + tok('--mono');
    for (let e = 0; e <= zl; e += zl > 3 ? 2 : 1) { const py = Math.round(yOf(Math.pow(10, e), zTop, zh, zl)) + 0.5; c.strokeStyle = tok('--line'); c.beginPath(); c.moveTo(padL, py); c.lineTo(padL + pw, py); c.stroke(); c.fillStyle = tok('--text-3'); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(e < 3 ? String(Math.pow(10, e)) : Math.pow(10, e - 3) + 'k', padL - 6, py); }
    for (let b = 0; b < zb; b++) { if (!zbars[b]) continue; const x = padL + (b / zb) * pw, y = yOf(zbars[b], zTop, zh, zl); c.fillStyle = b === 0 ? tok('--text') : rgba('--text', 0.62); c.fillRect(x, y, Math.max(1, pw / zb - 1), zTop + zh - y); }
    c.strokeStyle = tok('--line-2'); c.beginPath(); c.moveTo(padL + 0.5, zTop); c.lineTo(padL + 0.5, zTop + zh + 0.5); c.lineTo(padL + pw, zTop + zh + 0.5); c.stroke();
    const gx = (g) => padL + Math.min(1, g / zMaxGap) * pw;
    // where each solver landed: one mark per run
    const rows = [['exact', [{ cost: res.ex.cost, feasible: true }]], ['sa', (res.sa && res.sa.runs) || []], ['sqa', (res.sqa && res.sqa.runs) || []]];
    rows.forEach(([m, runs], ri) => {
      const y = rug + ri * 13 + 6;
      c.font = '500 11px ' + tok('--font'); c.fillStyle = tok(METHOD[m].c); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(m === 'exact' ? 'Exact' : m === 'sa' ? 'SA' : 'SQA', padL - 6, y);
      c.strokeStyle = tok('--line'); c.beginPath(); c.moveTo(padL, y + 0.5); c.lineTo(padL + pw, y + 0.5); c.stroke();
      for (const r of runs) {
        const g = r.cost / res.ex.cost - 1, x = gx(g);
        if (m === 'exact') { c.fillStyle = tok('--text'); c.beginPath(); c.moveTo(x, y - 5); c.lineTo(x + 4.5, y); c.lineTo(x, y + 5); c.lineTo(x - 4.5, y); c.closePath(); c.fill(); continue; }
        c.beginPath(); c.arc(Math.min(padL + pw - 3, x), y, 3, 0, Math.PI * 2);
        if (r.feasible) { c.fillStyle = rgba(METHOD[m].c, 0.55); c.fill(); }
        c.strokeStyle = tok(METHOD[m].c); c.lineWidth = 1; c.stroke();
      }
    });
    const axY = rug + 3 * 13 + 4;
    c.font = '400 11px ' + tok('--mono'); c.fillStyle = tok('--text-3'); c.textBaseline = 'top'; c.textAlign = 'center';
    const gs = zMaxGap > 0.3 ? 0.1 : zMaxGap > 0.12 ? 0.05 : 0.02;
    for (let g = 0; g <= zMaxGap + 1e-9; g += gs) c.fillText((g * 100).toFixed(0), gx(g), axY);
    c.font = '500 11px ' + tok('--font'); c.fillStyle = tok('--text-2'); c.textAlign = 'right'; c.fillText('gap to the best plan, %', padL + pw, axY + 14);

    if (!en.done) { landTitle.textContent = 'Costing every plan: ' + int(en.count) + ' of ' + int(en.total); landFine.textContent = ''; return; }
    landTitle.textContent = 'The best plan is ' + int(en.nMin) + ' of ' + int(en.total) + (en.nMin > 1 ? ' (ties)' : '');
    let half = 0, acc = 0; for (let i = 0; i < en.bins; i++) { acc += en.hist[i]; if (acc >= en.total / 2) { half = en.lo + ((i + 0.5) / en.bins) * (en.hi - en.lo); break; } }
    const parts = ['Every possible plan was costed. The typical (median) plan makes people wait ', h('b', null, (half / en.lo).toFixed(1) + ' times'), ' as long in total as the best; the worst, ' + (en.hi / en.lo).toFixed(1) + ' times.'];
    for (const m of ['sa', 'sqa']) if (res[m] && res[m].runs.length) parts.push(' ' + (m === 'sa' ? 'Simulated annealing' : 'Simulated quantum annealing') + ': the median run beats ', h('b', null, pct(beats(S.median(res[m].runs.map((r) => r.cost))), 2)), ' of all plans.');
    parts.push(' Each dot is one run; hollow dots were repaired.');
    landFine.replaceChildren(...parts);
  }
  function zoomGap() {
    let g = 0.1;
    for (const m of ['sa', 'sqa']) if (res[m]) for (const r of res[m].runs) g = Math.max(g, r.cost / res.ex.cost - 1);
    return Math.min(res.en.tailSpan, Math.ceil(g * 20 + 1e-9) / 20);
  }

  // ------------------------------------------------------------------ render
  function renderLive() {
    renderPlanText();
    map.redraw();
    if (dirty.wl) wlcv.redraw();
    if (dirty.conv) renderConv();
    if (dirty.land) land.redraw();
    if (dirty.table) renderTable();
    if (dirty.tests) renderTests();
    if (dirty.q) qcv.redraw();
    if (run || planning) setStatus();
  }
  function renderAll() {
    for (const k in dirty) dirty[k] = true;
    planKey = '';
    if (planning) { mapEmpty.hidden = false; mapEmpty.replaceChildren(h('div.spinner'), h('p', null, 'Planning ' + planning.total + ' routes…')); }
    else if (sc) mapEmpty.hidden = true;
    renderLive();
  }

  const offBus = ['reset', 'seek'].map((ev) => ctx.bus.on(ev, () => { missionStale = true; if (visible) checkMission(); }));
  let missionStale = false, lastSig = '';
  function checkMission() {
    missionStale = false;
    if (state.scenario !== 'mission') return;
    const sig = missionSig();
    if (sig === lastSig) return;
    lastSig = sig;
    if (missionPeople().length < 3) chooseScenario('mission'); else build();
  }

  // first scenario: this mission when it has located at least three people, otherwise the drill
  if (missionPeople().length >= 3) { state.scenario = 'mission'; lastSig = missionSig(); }
  else { const n = missionPeople().length; fallbackNote = 'This mission has located ' + (n === 0 ? 'no one' : n === 1 ? '1 person' : n + ' people') + ' so far; routing needs at least 3. Showing the drill instead.'; }
  syncControls(); renderAll();
  build();

  return {
    show() {
      visible = true;
      if (missionStale || state.scenario === 'mission') checkMission();
      if (sc && res && !autoRan && !run) { autoRan = true; startRun(); }
      else if (run) drive();
      else renderAll();
    },
    hide() { visible = false; loop.stop(); reveal = null; },
    restyle() { conv.redraw(); renderAll(); },
    _off: [offs, offBus],
  };
}
