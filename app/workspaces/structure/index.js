// Structure: the pile is a physics problem. Before anyone lifts a slab, test the lift.
// A seeded two-storey bay is failed and collapses under Rapier rigid-body physics in this page. Everything after that
// (the pattern, the voids, every trial lift, every tremor, every shore, every robot route) is computed on that pile.
import * as P from './physics.js';
import { voxelise, distanceTransform, classify, findVoids, bettiCurve, selfTest, PATTERNS } from './voxel.js';
import { ROBOTS, reach, routeTo } from './robots.js';
import { createView } from './view3d.js';
import { createFilm } from './film.js';
import { makeChart, drawSpark, drawBetti, drawPersistence, drawTrials, drawFragility, wilson, resetPalette } from './charts.js';

const SRC = {
  fema: ['FEMA National US&R Response System, Structural Collapse Technician manual, module 1c (collapse patterns)', 'https://www.fema.gov/pdf/emergency/usr/module1c2.pdf'],
  fema2a: ['FEMA Structural Collapse Technician manual, module 2a (shoring basics: where victims might be found, quoted above)', 'https://www.fema.gov/pdf/emergency/usr/module2a.pdf'],
  schweier: ['Schweier and Markus, “Classification of collapsed buildings for fast damage and loss assessment”, Bulletin of Earthquake Engineering, 2006', 'https://link.springer.com/article/10.1007/s10518-006-9005-2'],
  robins: ['Robins, Saadatfar, Delgado-Friedrichs and Sheppard, “Percolating length scales from topological persistence analysis of micro-CT images of porous materials”, Water Resources Research, 2016', 'https://agupubs.onlinelibrary.wiley.com/doi/10.1002/2015WR017937'],
  sog: ['US&R Shoring Operations Guide, US Army Corps of Engineers and FEMA, 2021', 'https://firemarshal.ks.gov/DocumentCenter/View/190/US-Army-Corps-of-Engineers-Shoring-Operations-Guide---10-2021-PDF'],
  mod4: ['FEMA Structural Collapse Technician manual, module 4 (cribbing capacity)', 'https://www.fema.gov/pdf/emergency/usr/module4.pdf'],
  hawkes: ['Hawkes, Blumenschein, Greer and Okamura, “A soft robot that navigates its environment through growth”, Science Robotics, 2017', 'https://www.science.org/doi/10.1126/scirobotics.aan3028'],
  sprout: ['SPROUT vine robot for rubble search, MIT Lincoln Laboratory and University of Notre Dame, 2025', 'https://www.ll.mit.edu/news/flexible-robot-can-help-emergency-responders-search-through-rubble'],
  snake: ['Carnegie Mellon snake robot in the search after the 2017 Mexico City earthquake', 'https://www.ri.cmu.edu/carnegie-mellon-snake-robot-looks-forused-in-search-for-mexico-city-quake-survivors/'],
  usnake: ['Wright and others, “Design and architecture of the unified modular snake robot”, ICRA 2012', 'http://biorobotics.ri.cmu.edu/papers/paperUploads/ICRA2012_Wright.pdf'],
  rapier: ['Rapier 3-D physics engine, version ' + P.RAPIER_VERSION + ' (Dimforge)', 'https://rapier.rs'],
};
const TABS = [['collapse', 'Collapse'], ['voids', 'Voids'], ['lift', 'Lift'], ['shake', 'Shake'], ['shore', 'Shore'], ['robots', 'Robots']];
const VERDICT = { safe: ['Safe to move', 'tag-ok', '--ok'], caution: ['Caution', 'tag-warn', '--warn'], no: ['Do not touch', 'tag-danger', '--danger'] };
const fkN = (N) => (N / 1000).toFixed(Math.abs(N) < 9950 ? 1 : 0) + ' kN';
const ft = (kg) => (kg / 1000).toFixed(kg < 9950 ? 2 : 1) + ' t';
const fcm = (m) => (m * 100).toFixed(Math.abs(m) < 0.095 ? 1 : 0) + ' cm';
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export default {
  async mount(root, ctx) {
    const { h, icon, realityTag, cssVar, reducedMotion } = ctx.kit;
    const href = new URL('./style.css', import.meta.url).href;
    if (!document.querySelector('link[href="' + href + '"]')) document.head.append(h('link', { rel: 'stylesheet', href }));
    root.classList.add('structure');

    // ------------------------------------------------------------ state
    const S = { scenario: 'vshape', seed: 7, pile: null, poses: null, phase: 'loading', tab: 'collapse', ke: [], settleT: 0, acc: 0, quiet: 0, peakKE: 0, pe0: 0,
      grid: null, cls: null, voidRes: null, betti: null, con: null, snap: null, box: null, boxVoid: null, base: null, selVoid: null, selPiece: -1,
      rank: null, plan: null, shake: { pga: 0.2, kind: 'tremor', trials: [], n: 24, running: false }, runs: [], frag: null, shoreType: 'post', shoreMode: false, history: [],
      bots: null, routeVoid: null, live: null, autoStarted: false, visible: false, show: { voids: true, forces: false, xray: false, zones: true }, userXray: false, stepMs: 0, epoch: 0, liveQueue: [] };
    const self = selfTest();

    // ------------------------------------------------------------ frame
    const stage = h('div.structure-stage');
    const loading = h('div.structure-loading.adv-only', null, h('div.spinner'), h('p', null, 'Loading the physics engine (Rapier, 1.5 MB of WebAssembly)…'));
    const tip = h('div.structure-tip.glass', { hidden: true });
    const dock = h('aside.structure-dock.adv-only', { 'aria-label': 'Structure worksheet' });
    root.append(
      h('header.ws-head.structure-head.adv-only', null,
        h('div', null, h('h1', null, 'Structure', realityTag('live-algo'), h('span.tag.tag-sim', { title: 'The crane, shores and robots are not HOUND hardware. They are drawn to show the idea.' }, 'Concept hardware')),
          h('p', null, 'The pile is a physics problem. Collapse a building bay with real rigid-body physics, then test every lift, tremor and shore in a copy of that world before anyone touches a slab.')),
        h('p.structure-disclaimer', null, 'The physics engine and every measurement on this pile are real computation. The pile is not a real building, and this is not an engineering assessment.')),
      h('div.structure-main', null, stage, dock));
    stage.append(loading);

    // scenario bar
    const scnSeg = h('div.seg', { role: 'radiogroup', 'aria-label': 'Which supports fail' }, P.SCENARIOS.map((s) => h('button', { role: 'radio', 'data-id': s.id, title: s.fail, onclick: () => { S.scenario = s.id; rebuild(); } }, s.label)));
    const scnText = h('p'); const seedB = h('b', null, '7');
    const goBtn = h('button.btn.btn-primary', { onclick: () => (S.phase === 'intact' ? startCollapse() : rebuild()) }, icon('bolt'), h('span', null, 'Fail the supports'));
    const scn = h('div.structure-scn.glass.adv-only', null, scnSeg, scnText,
      h('div.row', null, goBtn, h('div.grow'),
        h('span.structure-seed', { title: 'The seed fixes the column break heights, the furniture, the infill walls and the tie strengths. Same seed, same collapse.' }, 'Seed',
          h('button.btn.btn-icon.btn-sm', { 'aria-label': 'Previous seed', onclick: () => { S.seed = Math.max(1, S.seed - 1); rebuild(); } }, icon('minus', 14)), seedB,
          h('button.btn.btn-icon.btn-sm', { 'aria-label': 'Next seed', onclick: () => { S.seed++; rebuild(); } }, icon('plus', 14)))));
    // view tools
    const camSeg = h('div.seg', { role: 'group', 'aria-label': 'Camera' }, [['orbit', 'Orbit'], ['top', 'Top'], ['side', 'Side'], ['front', 'Front']].map(([id, l]) => h('button', { onclick: () => view.setCamera(id) }, l)));
    const mkCheck = (label, key, title) => { const inp = h('input', { type: 'checkbox', checked: S.show[key], onchange: () => { S.show[key] = inp.checked; if (key === 'xray') S.userXray = true; applyOverlays(); } }); return { el: h('label.check', { title }, inp, h('span', null, label)), inp }; };
    const ckX = mkCheck('See through the pile', 'xray', 'Draw the pieces as ghosts so the voids and routes inside are visible'), ckV = mkCheck('Voids', 'voids', 'The pockets of air found by the topology pass'), ckF = mkCheck('Load path', 'forces', 'One bar per contact, thicker and hotter with force. Solver estimate.');
    const cut = h('input.slider', { type: 'range', min: -60, max: 60, step: 1, value: 60, 'aria-label': 'Section cut position', oninput: () => { const z = +cut.value / 10; view.setSection(+cut.value >= 60 ? null : z); } });
    const tools = h('div.structure-tools.glass.adv-only', null, camSeg, ckX.el, ckV.el, ckF.el, h('div.structure-cut', { title: 'Slice the pile open along a vertical plane' }, h('span', null, 'Section'), cut));
    // telemetry
    const hud = { state: h('b', null, 'Loading'), sub: h('span', null, ''), n: h('b', null, '0'), mass: h('b', null, '0'), ke: h('b', null, '0'), ms: h('b', null, '0'), spark: h('canvas'), jobL: h('span', null, 'Idle'), jobB: h('i', { style: { width: '0%' } }) };
    const stat = (b, l) => h('div.stat', null, b, h('span', null, l));
    const hudEl = h('div.structure-hud.glass.adv-only', null, h('div.stat.structure-state', null, hud.state, hud.sub), stat(hud.n, 'loose pieces'), stat(hud.mass, 'loose mass'), stat(hud.ke, 'kinetic energy'), stat(hud.ms, 'physics per step'),
      h('div', { title: 'Kinetic energy of the pile since the supports failed' }, hud.spark), h('div.structure-job', { role: 'status' }, hud.jobL, h('div.bar', null, hud.jobB)));
    const sparkChart = makeChart(ctx.kit, hud.spark, drawSpark);

    // dock
    const tabBar = h('div.structure-tabs', { role: 'tablist', 'aria-label': 'Structure exhibits' }, TABS.map(([id, l], i) => h('button', { role: 'tab', id: 'structure-tab-' + id, 'aria-selected': 'false', 'aria-controls': 'structure-pane-' + id, onclick: () => setTab(id) }, h('i', null, '0' + (i + 1)), l)));
    const panes = Object.fromEntries(TABS.map(([id]) => [id, h('div.structure-pane', { role: 'tabpanel', id: 'structure-pane-' + id, 'aria-labelledby': 'structure-tab-' + id, hidden: true })]));
    dock.append(tabBar, ...Object.values(panes));

    // ------------------------------------------------------------ physics engine and view
    const view = createView(stage, ctx, { onFrame: (dt) => { if (S.pile && ctx.mode === 'advanced') onFrame(dt); }, onHover: (a, b) => S.pile && ctx.mode === 'advanced' && onHover(a, b), onPick: (a, b) => S.pile && ctx.mode === 'advanced' && onPick(a, b), onVoid: (id) => selectVoid(id, true) });
    const film = createFilm({ ctx, view, host: stage });
    stage.append(scn, tools, hudEl, tip);
    // Advanced brings its own live world, loaded the first time it is opened. The film keeps its recordings.
    let readying = null;
    function ready() {
      return (readying ||= P.loadRapier().then(() => { loading.remove(); rebuild(); setTab(S.tab); }, (e) => { readying = null; loading.replaceChildren(icon('alert', 28), h('h3', null, 'The physics engine did not load'), h('p.muted', { style: { maxWidth: '460px', textAlign: 'center' } }, 'Rapier is fetched from the jsDelivr network on first use. Check the connection and try again. (' + String(e.message || e) + ')'), h('button.btn.btn-primary', { onclick: () => ready() }, 'Try again')); }));
    }
    function applyMode() {
      if (!S.visible) return;
      if (ctx.mode === 'demo') { tip.hidden = true; jobs.clear(); view.clearLayer('voids'); for (const k of ['prot', 'forces', 'zones', 'ghost', 'routes']) view.clearLayer(k); view.setXray(false); film.start(); return; }
      film.stop(); view.setLook('advanced');
      if (S.pile) { view.clearFx(); view.setPile(S.pile); view.sync(S.pile, S.poses); view.setClock(0, S.pile.t); view.setCamera('orbit'); renderAll(); applyOverlays(); hudNow(); if (S.phase === 'settled' && !S.grid) analyse(); }
      else ready().then(autoStart);
    }
    function autoStart() { if (!S.autoStarted && S.pile && S.phase === 'intact') { S.autoStarted = true; setTimeout(() => { if (S.visible && S.phase === 'intact' && ctx.mode === 'advanced') startCollapse(); }, 1100); } }

    // ------------------------------------------------------------ jobs: long computations spread over frames
    const jobs = { q: [], cur: null, done: 0,
      add(label, make) { return new Promise((res) => { const e = S.epoch; jobs.q.push({ label, make, res, e }); }); },
      clear() { for (const j of jobs.q) j.res(null); jobs.q = []; if (jobs.cur) { try { jobs.cur.gen.return?.(); } catch { /* dropped */ } jobs.cur.res(null); jobs.cur = null; } setJob('Idle', 0); },
      tick(ms) {
        const t0 = performance.now();
        while (performance.now() - t0 < ms) {
          if (!jobs.cur) { const j = jobs.q.shift(); if (!j) { if (hud.jobL.textContent !== 'Idle' && !S.live) setJob('Idle', 0); return; } jobs.cur = j; j.gen = j.make(); setJob(j.label, 0); }
          let r; try { r = jobs.cur.gen.next(); } catch (err) { console.error('[structure] job failed', err); ctx.shell.toast('A computation failed: ' + (err.message || err), { level: 'alert' }); jobs.cur.res(null); jobs.cur = null; continue; }
          if (r.done) { const j = jobs.cur; jobs.cur = null; j.res(r.value); } else if (typeof r.value === 'number') setJob(jobs.cur.label, r.value); else if (typeof r.value === 'string') setJob(r.value, null);
        }
      } };
    function setJob(label, frac) { hud.jobL.textContent = label; if (frac != null) hud.jobB.style.width = Math.round(frac * 100) + '%'; }

    // ------------------------------------------------------------ build, collapse, settle
    function rebuild() {
      view.clearFx(); view.setClock(0, 0);
      S.epoch++; jobs.clear(); S.live = null; S.liveQueue = [];
      if (S.pile) S.pile.world.free();
      S.pile = P.buildPile({ seed: S.seed, scenario: S.scenario }); S.poses = P.readPoses(S.pile); S.phase = 'intact'; S.ke = []; S.peakKE = 0; S.acc = 0; S.quiet = 0;
      S.pe0 = S.pile.pieces.reduce((a, p) => a + (p.fixed ? 0 : p.mass * P.G * p.home[1]), 0);
      Object.assign(S, { grid: null, cls: null, voidRes: null, betti: null, con: null, snap: null, box: null, boxVoid: null, base: null, selVoid: null, selPiece: -1, rank: null, plan: null, runs: [], frag: null, history: [], bots: null, routeVoid: null, shoreMode: false });
      S.shake.trials = []; S.shake.running = false;
      view.setPile(S.pile); view.sync(S.pile, S.poses); view.setSelected(-1); view.setTints(null); view.showShorePreview(null); stage.dataset.mode = '';
      if (!view.userMoved) { view.setCamera('orbit'); view.setAutoRotate(true); }
      scnSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === S.scenario)));
      scnText.textContent = P.SCENARIOS.find((s) => s.id === S.scenario).fail; seedB.textContent = S.seed;
      renderAll(); hudNow();
    }
    function startCollapse() {
      if (S.phase !== 'intact') return;
      P.trigger(S.pile); S.phase = 'collapsing'; S.ke = []; S.quiet = 0;
      if (reducedMotion()) { // no animation: run the collapse to rest, then show the result
        jobs.add('Simulating the collapse', function* () { let n = 0; while (S.phase === 'collapsing' && n < 1400) { stepLive(null); n++; if (n % 12 === 0) yield Math.min(0.95, S.pile.t / 10); } S.poses = P.readPoses(S.pile, S.pile.world, S.poses); view.sync(S.pile, S.poses); });
      }
      renderAll(); hudNow();
    }
    function stepLive(dust) {
      const pile = S.pile, t0 = performance.now(); P.stepPile(pile, dust); S.stepMs += (performance.now() - t0 - S.stepMs) * 0.08;
      const n = Math.round(pile.t / P.DT);
      if (n % 3 === 0) { const ke = P.kinetic(pile); if (S.phase === 'collapsing') { S.ke.push(ke / 1000); if (ke > S.peakKE) S.peakKE = ke; } S.keNow = ke; }
      if (S.live?.type === 'lift' && pile.t - S.live.t0 > 1.5) { P.removePiece(pile, S.live.idx); S.live = { type: 'settle', t0: pile.t }; }
      const minT = S.phase === 'collapsing' ? 1.6 : 0.5, since = S.phase === 'collapsing' ? pile.t : pile.t - (S.live?.t0 ?? pile.t);
      if (S.live?.type === 'lift') return;
      if (since > minT && n % 6 === 0) { const sp = P.maxSpeed(pile); if (!pile.calmed && sp < 0.6) P.calm(pile); S.quiet = sp < 0.03 ? S.quiet + 1 : 0; if (S.quiet >= 5 || since > (S.phase === 'collapsing' ? 20 : 8)) settle(); }
    }
    function settle() {
      const pile = S.pile; P.sleepAll(pile); P.calm(pile, false); pile.calmed = false; if (S.phase === 'collapsing') S.settleT = pile.t; S.phase = 'settled'; S.live = null; S.quiet = 0; S.keNow = 0;
      S.poses = P.readPoses(pile, pile.world, S.poses); view.sync(pile, S.poses);
      analyse();
    }
    function analyse() {
      const e = S.epoch; S.rank = null; S.plan = null; S.bots = null; S.betti = null; view.setTints(null); view.clearLayer('ghost'); view.clearLayer('routes');
      jobs.add('Reading the pile', function* () {
        const pile = S.pile; yield 0.05;
        const g = voxelise(pile, S.poses, { res: 0.1 }); yield 0.3; distanceTransform(g); yield 0.6;
        S.grid = g; S.cls = classify(pile, S.poses, g); S.voidRes = findVoids(g); yield 0.8;
        S.con = P.measureContacts(pile); P.sleepAll(pile); S.poses = P.readPoses(pile, pile.world, S.poses); S.snap = P.snapshot(pile);
        if (S.box && !S.box.user) S.box = null;
        if (!S.box) { const v = S.voidRes.voids.find((q) => q.person) || S.voidRes.voids[0]; if (v) placeBox(v, false); }
        refreshBase();
        if (S.selVoid && !S.voidRes.voids.find((v) => v.id === S.selVoid)) S.selVoid = null;
        if (!S.selVoid) S.selVoid = S.boxVoid || S.voidRes.voids[0]?.id || null;
        renderAll(); applyOverlays(); hudNow();
        if (S.liveQueue.length && e === S.epoch) { const next = S.liveQueue.shift(); setTimeout(() => liveLift(next, true), 350); }
      });
      jobs.add('Counting voids with topology', function* () {
        const radii = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5]; const gen = bettiCurve(S.grid, radii); let r, k = 0;
        while (!(r = gen.next()).done) { S.betti = r.value.slice(); k++; if (S.tab === 'voids') renderVoids(); yield k / radii.length; }
        markTabs();
      });
    }
    function placeBox(v, user) {
      const ex = v.max[0] - v.min[0], ez = v.max[2] - v.min[2], along = ex >= ez, len = Math.max(0.5, Math.min(1.7, (along ? ex : ez) - 0.1));
      S.box = { c: [v.center[0], Math.max(0.2, v.center[1]), v.center[2]], h: [len / 2, 0.16, 0.22], yaw: along ? 0 : Math.PI / 2, user }; S.boxVoid = v.id;
    }
    function refreshBase() {
      if (!S.box) { S.base = null; return; }
      const m = P.protectedMetrics(S.pile, S.pile.world, S.box); let load = 0; for (const i of m.roof) load += S.con.loadAbove[i];
      S.base = { ...m, roofLoad: load };
    }

    // ------------------------------------------------------------ the frame loop
    let frameN = 0; const dust = [];
    function onFrame(dt) {
      frameN++;
      const moving = S.phase === 'collapsing' || S.phase === 'moving';
      if (moving && !(reducedMotion() && S.phase === 'collapsing')) {
        S.acc = Math.min(S.acc + dt, 3 * P.DT); dust.length = 0;
        while (S.acc >= P.DT && (S.phase === 'collapsing' || S.phase === 'moving')) { stepLive(dust); S.acc -= P.DT; }
        for (const d of dust) view.puff(d, S.pile.t); view.setClock(0, S.pile.t);
        if (S.phase !== 'settled') { S.poses = P.readPoses(S.pile, S.pile.world, S.poses); view.sync(S.pile, S.poses); }
        jobs.tick(2);
      } else jobs.tick(reducedMotion() ? 14 : 9);
      if (frameN % 8 === 0) hudNow();
    }
    function hudNow() {
      const pile = S.pile; if (!pile) return;
      const loose = pile.pieces.filter((p) => p.alive && !p.fixed && p.kind !== 'shore');
      const names = { intact: 'Standing', collapsing: 'Collapsing', settled: 'At rest', moving: S.live?.type === 'lift' ? 'Lifting' : 'Settling' };
      hud.state.textContent = names[S.phase] || '';
      hud.sub.textContent = S.phase === 'intact' ? 'supports intact' : S.phase === 'collapsing' ? pile.t.toFixed(1) + ' s since failure' : S.phase === 'settled' ? 'came to rest in ' + S.settleT.toFixed(1) + ' s' : 'the pile is moving';
      hud.n.textContent = loose.length; hud.mass.replaceChildren((loose.reduce((a, p) => a + p.mass, 0) / 1000).toFixed(1), h('small', null, 't'));
      hud.ke.replaceChildren(((S.phase === 'settled' || S.phase === 'intact' ? 0 : S.keNow || 0) / 1000).toFixed(S.keNow > 1e5 ? 0 : 1), h('small', null, 'kJ'));
      hud.ms.replaceChildren(S.stepMs.toFixed(2), h('small', null, 'ms'));
      sparkChart.update({ values: S.ke });
      goBtn.querySelector('span').textContent = S.phase === 'intact' ? 'Fail the supports' : 'Rebuild the bay';
      goBtn.classList.toggle('btn-primary', S.phase === 'intact'); goBtn.replaceChild(icon(S.phase === 'intact' ? 'bolt' : 'reset'), goBtn.firstChild);
    }

    // ------------------------------------------------------------ 3-D overlays for the current tab
    function applyOverlays() {
      const settled = S.phase === 'settled' && S.grid;
      if (!S.userXray) { S.show.xray = settled && (S.tab === 'voids' || S.tab === 'robots'); ckX.inp.checked = S.show.xray; }
      view.setXray(S.show.xray);
      if (settled && S.show.voids) view.showVoids(S.grid, S.voidRes.voids, { selectedId: S.tab === 'voids' || S.tab === 'robots' ? S.selVoid : null }); else view.clearLayer('voids');
      view.showProtected(settled || S.phase === 'moving' ? S.box : null);
      if (settled && S.show.forces) view.showForces(S.pile, S.poses, S.con); else view.clearLayer('forces');
      if (settled && S.tab === 'collapse') view.showZones(S.cls.zones); else view.clearLayer('zones');
      if (S.tab !== 'robots') view.clearLayer('routes'); else drawRoutes();
      if (S.tab !== 'lift' && S.tab !== 'shake') view.clearLayer('ghost');
      if (S.tab === 'lift' && S.rank) tintRank(); else view.setTints(null);
      if (S.tab !== 'shore' && S.shoreMode) { S.shoreMode = false; stage.dataset.mode = ''; view.showShorePreview(null); }
    }
    function tintRank() { const m = new Map(); for (const [idx, r] of S.rank.results) m.set(idx, { color: cssVar(VERDICT[r.j.verdict][2]), k: r.j.verdict === 'safe' ? 0.16 : 0.34 }); view.setTints(m); }

    // ------------------------------------------------------------ picking and hover
    function onHover(hit, ev) {
      if (S.shoreMode && S.phase === 'settled') { if (!hit) { view.showShorePreview(null); return; } const pr = P.probeShore(S.pile, hit.point, S.shoreType); if (pr.ok) view.showShorePreview(pr, P.SHORES[S.shoreType].half, true); else view.showShorePreview({ x: hit.point[0], z: hit.point[2], bottom: hit.point[1], h: 0.4 }, 0.12, false); tip.hidden = false; tip.replaceChildren(h('b', null, pr.ok ? 'Shore here: ' + pr.h.toFixed(2) + ' m tall' : 'Cannot shore here'), h('span', null, pr.ok ? 'click to place' : pr.why)); moveTip(ev); return; }
      const idx = hit ? hit.idx : -1; view.setHovered(idx);
      if (idx < 0 || !ev) { tip.hidden = true; return; }
      const p = S.pile.pieces[idx]; tip.hidden = false;
      tip.replaceChildren(h('b', null, p.name), h('span', null, p.id + (p.kind === 'shore' ? '' : '  ' + ft(p.mass)) + (p.fixed && p.kind !== 'shore' ? '  standing frame' : '') + (p.crushed ? '  crushed' : '')));
      moveTip(ev);
    }
    function moveTip(ev) { if (!ev) return; const r = stage.getBoundingClientRect(); tip.style.left = Math.min(r.width - 270, ev.clientX - r.left) + 'px'; tip.style.top = Math.min(r.height - 70, ev.clientY - r.top) + 'px'; }
    function onPick(hit) {
      if (!hit) return;
      if (S.shoreMode && S.phase === 'settled') { const pr = P.probeShore(S.pile, hit.point, S.shoreType); if (!pr.ok) { ctx.shell.toast(pr.why, { level: 'info' }); return; } placeShore(pr); return; }
      selectPiece(hit.idx);
    }
    function selectPiece(idx, focus) {
      S.selPiece = idx; view.setSelected(idx); view.clearLayer('ghost');
      if (idx >= 0 && focus) { const o = idx * 7; view.focus([S.poses[o], S.poses[o + 1], S.poses[o + 2]], 9); }
      if (idx >= 0 && S.tab === 'lift') { const r = S.rank?.results.get(idx); if (r) view.showGhost(S.pile, r.before, r.after, r.j.moved, VERDICT[r.j.verdict][2]); }
      if (S.tab === 'lift') renderLift(); else if (idx >= 0 && S.pile.pieces[idx].kind !== 'shore' && S.phase === 'settled' && S.tab === 'collapse') { /* stay */ }
    }
    function selectVoid(id, focus) {
      S.selVoid = id; const v = S.voidRes?.voids.find((q) => q.id === id);
      if (v && focus) view.focus(v.center, 8);
      applyOverlays(); if (S.tab === 'voids') renderVoids(); if (S.tab === 'robots') renderRobots();
    }

    // ------------------------------------------------------------ tabs
    function setTab(id) {
      S.tab = id; tabBar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.id === 'structure-tab-' + id)));
      for (const [k, el] of Object.entries(panes)) el.hidden = k !== id;
      render(id); applyOverlays();
    }
    function markTabs() { const done = { collapse: !!S.cls, voids: !!S.betti && S.betti.length >= 9, lift: !!S.rank && !S.rank.running, shake: S.runs.length > 0, shore: S.pile?.shores.some((i) => S.pile.pieces[i].alive), robots: !!S.bots }; for (const [id] of TABS) tabBar.querySelector('#structure-tab-' + id).dataset.done = String(!!done[id]); }
    const render = (id) => ({ collapse: renderCollapse, voids: renderVoids, lift: renderLift, shake: renderShake, shore: renderShore, robots: renderRobots }[id])();
    function renderAll() { render(S.tab); markTabs(); }
    const sources = (...keys) => h('div.structure-src', null, h('b', { style: { color: 'var(--text-3)', fontWeight: 500 } }, 'Sources'), keys.map((k) => h('span', null, h('a', { href: SRC[k][1], target: '_blank', rel: 'noopener' }, SRC[k][0]))));
    const real = (works, unknown) => h('div.structure-real', null, h('div', null, h('b', null, 'For this to work in the field: '), works), h('div', null, h('b', null, 'Unknown: '), unknown));
    const head = (title, ...tags) => h('h2', null, title, ...tags);
    const sec = (title, small, ...kids) => h('section.structure-sec', null, h('h3', null, title, small ? h('small', null, small) : null), ...kids);
    const waiting = (text) => h('div.structure-empty', null, text);
    const needPile = () => S.phase === 'intact' ? waiting('The bay is still standing. Press “Fail the supports” to collapse it.') : S.phase !== 'settled' || !S.grid ? waiting('Waiting for the pile to come to rest…') : null;

    // ---------- 1 collapse
    function renderCollapse() {
      const el = panes.collapse, sc = P.SCENARIOS.find((s) => s.id === S.scenario);
      const kids = [head('The collapse, simulated', realityTag('live-algo')),
        h('p.structure-what', null, 'A two-storey precast bay: ' + S.pile.pieces.filter((p) => p.kind === 'column').length + ' column pieces, 12 ledger beams, 36 hollow-core planks, infill walls and furniture, ' + ft(S.pile.pieces.reduce((a, p) => a + p.mass, 0)) + ' in all. Fail a line of supports and rigid-body physics decides where every piece lands.')];
      const wait = needPile();
      if (wait) kids.push(wait, sec('What is about to fail', null, h('p.structure-what', null, sc.fail), h('dl.kv', null, h('dt', null, 'Columns'), h('dd.num', null, '0.40 × 0.40 × 2.55 m, 0.98 t'), h('dt', null, 'Ledger beams'), h('dd.num', null, '4.78 m long, 4.5 t'), h('dt', null, 'Hollow-core planks'), h('dd.num', null, '1.10 × 0.20 × 3.78 m, 1.2 t'), h('dt', null, 'Friction, concrete on concrete'), h('dd.num', null, P.FRICTION + ' (assumed)'), h('dt', null, 'Plank ties'), h('dd.num', null, 'pins that break on a hard impact (assumed)'))));
      else {
        const c = S.cls, ev = c.evidence, pat = PATTERNS[c.verdict], top = Object.entries(c.scores).sort((a, b) => b[1] - a[1]);
        const match = c.verdict === S.scenario;
        kids.push(h('div.structure-verdict', null, h('span', null, 'Pattern read from the geometry'), h('span.num', null, c.verdict === 'mixed' ? '' : 'match ' + (top[0][1] * 100).toFixed(0) + ' %'), h('b', null, pat ? pat.label : 'Mixed heap'),
          h('span', { class: match ? 'structure-ok' : 'structure-warn' }, c.verdict === 'mixed' ? 'no textbook pattern fits' : match ? 'agrees with the failure that was set' : 'the failure set was “' + sc.label + '”')),
          h('div.structure-match', null, top.map(([k, v], i) => [h('span', { class: i === 0 ? 'is-top' : '' }, PATTERNS[k].label), h('div.bar' + (i === 0 ? '.ok' : ''), null, h('i', { style: { width: (clamp01(v) * 100).toFixed(0) + '%' } })), h('span.num', null, (v * 100).toFixed(0) + ' %')])),
          sec('What the classifier measured', ev.n + ' floor planks',
            h('dl.kv', null, h('dt', null, 'Leaning (15° to 72°)'), h('dd.num', null, ev.inclined + (ev.inclined ? '   ' + ev.tiltMin.toFixed(0) + '° to ' + ev.tiltMax.toFixed(0) + '°' : '')), h('dt', null, 'Hanging (steeper than 72°)'), h('dd.num', null, ev.hanging),
              h('dt', null, 'Flat and dropped over 1.2 m'), h('dd.num', null, ev.flatLow), h('dt', null, 'Level, one end unsupported'), h('dd.num', null, ev.cantilevered), h('dt', null, 'Still in place'), h('dd.num', null, ev.standing),
              h('dt', { title: '1 means every leaning plank dips the same way; 0 means they dip in opposite directions' }, 'Dip agreement'), h('dd.num', null, ev.R.toFixed(2) + (ev.twoSided ? (ev.toward ? '   two sides, toward each other' : '   two sides, apart') : '')))),
          pat ? sec('Where the voids usually are', 'FEMA', h('div.structure-fema', null, pat.voids, h('cite', null, 'FEMA module 2a: “' + pat.fema + '”')),
            h('p.structure-what', null, (() => { const z = c.zones, vs = S.voidRes.voids; const inZ = vs.filter((v) => z.some((q) => v.center[0] >= q.min[0] && v.center[0] <= q.max[0] && v.center[2] >= q.min[2] && v.center[2] <= q.max[2])); return z.length ? 'On this pile: ' + inZ.length + ' of the ' + vs.length + ' voids found by the topology pass lie inside the dashed textbook zone.' : 'No textbook zone could be placed on this pile.'; })())) : null,
          sec('The collapse in numbers', null, h('dl.kv', null, h('dt', null, 'Came to rest after'), h('dd.num', null, S.settleT.toFixed(1) + ' s'), h('dt', null, 'Peak kinetic energy'), h('dd.num', null, (S.peakKE / 1000).toFixed(0) + ' kJ'),
            h('dt', null, 'Height lost by the centre of mass'), h('dd.num', null, (() => { let pe = 0, m = 0; for (const p of S.pile.pieces) if (p.alive && !p.fixed && p.kind !== 'shore') { pe += p.mass * (p.home[1] - S.poses[p.idx * 7 + 1]); m += p.mass; } return (pe / m).toFixed(2) + ' m'; })()),
            h('dt', null, 'Plank ties broken on impact'), h('dd.num', null, (S.pile.tiesBroken || 0) + ' of ' + S.pile.ties.length), h('dt', null, 'Furniture crushed'), h('dd.num', null, (S.pile.crushed || 0) + ' of 14'), h('dt', null, 'Contacts carrying load'), h('dd.num', null, S.con.edges.length))));
      }
      kids.push(real('a scan good enough to rebuild the pile piece by piece, and the mass and friction of each piece.', 'how far a rigid-body model can be trusted when real concrete cracks, crushes and hangs on its reinforcing bars. This model does none of that.'), sources('fema', 'fema2a', 'schweier', 'rapier'));
      el.replaceChildren(...kids);
    }

    // ---------- 2 voids
    let bettiChart = null, persChart = null;
    function renderVoids() {
      const el = panes.voids, kids = [head('Counting voids with topology', realityTag('live-algo')),
        h('p.structure-what', null, 'A void is a hole in a shape, and topology is the mathematics of counting holes without caring how the shape is bent. Thicken the rubble a little at a time and watch pockets seal: the radius at which each one closes is the size of its widest way in.')];
      const wait = needPile();
      if (wait) kids.push(wait);
      else {
        const g = S.grid, vr = S.voidRes, b0 = S.betti?.[0];
        kids.push(h('div.stat-row', null, h('div.stat', null, h('b', null, b0 ? b0.b0 : '…'), h('span', null, 'connected pieces')), h('div.stat', null, h('b', null, b0 ? b0.b1 : '…'), h('span', null, 'tunnels through it')), h('div.stat', null, h('b', null, b0 ? b0.b2 : '…'), h('span', null, 'sealed cavities')), h('div.stat', null, h('b', null, vr.voids.length), h('span', null, 'pockets with a tight way in'))),
          h('p.structure-what', { style: { fontSize: 'var(--fs-12)' } }, 'Betti numbers of the solid, on a grid of ' + g.nx + ' × ' + g.nz + ' × ' + g.ny + ' voxels of ' + (g.res * 100).toFixed(0) + ' cm (' + (g.n / 1e6).toFixed(2) + ' million). The ground counts as solid.'),
          h('div.structure-test', { title: 'The same code is run on six small shapes whose answers are known' }, h('b', { style: { color: 'var(--text-2)', fontWeight: 500 } }, 'Self-check on known shapes'), self.cases.map((c) => h('span', { class: c.ok ? '' : 'is-bad' }, c.name + ' ' + c.got.join(' ')))));
        const c1 = h('canvas.structure-chart', { style: { height: '168px' }, role: 'img', 'aria-label': 'Betti numbers of the rubble against the thickening radius' });
        kids.push(sec('Seal the narrow gaps and sealed pockets appear', S.betti && S.betti.length < 9 ? 'computing ' + S.betti.length + ' of 9' : null, c1));
        bettiChart = makeChart(ctx.kit, c1, drawBetti); bettiChart.update(S.betti || []);
        const c2 = h('canvas.structure-chart', { style: { height: '190px' }, role: 'img', 'aria-label': 'Persistence diagram: widest way in against largest sphere inside, for every pocket of air' });
        kids.push(sec('Each pocket: how big inside, how tight the way in', vr.pairs.length + ' pockets', c2));
        persChart = makeChart(ctx.kit, c2, drawPersistence); persChart.update({ pairs: vr.pairs, voids: vr.voids, sel: S.selVoid });
        const rows = vr.voids.map((v) => h('tr', { tabindex: 0, 'aria-selected': String(v.id === S.selVoid), onclick: () => selectVoid(v.id, true), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectVoid(v.id, true); } } },
          h('td', null, h('b', null, v.id), v.id === S.boxVoid ? h('span.c-person', { title: 'The believed position is in this void' }, '  ●') : null), h('td.num', null, v.volume.toFixed(2)), h('td.num', null, (v.inscribed * 200).toFixed(0)), h('td.num', null, v.sealed ? 'sealed' : (v.throat * 200).toFixed(0)), h('td', null, v.person ? h('span.c-person', null, 'person-sized') : h('span.muted', null, 'small'))));
        kids.push(sec('Voids on this pile', vr.chambers ? vr.chambers + ' side chambers merged' : null,
          vr.voids.length ? h('div.structure-tablewrap', null, h('table.table.dense', null, h('thead', null, h('tr', null, h('th', null, 'Void'), h('th.num', null, 'm³'), h('th.num', { title: 'Diameter of the largest sphere that fits inside' }, 'sphere, cm'), h('th.num', { title: 'Diameter of the widest opening that leads out' }, 'way in, cm'), h('th', null, 'Size'))), h('tbody', null, rows))) : waiting('No roofed pocket wider than 40 cm was found in this pile.'),
          (() => { const v = vr.voids.find((q) => q.id === S.selVoid); return v ? h('div.row', null, h('button.btn', { disabled: v.id === S.boxVoid && S.box?.user, onclick: () => { placeBox(v, true); refreshBase(); S.rank = null; S.plan = null; ctx.shell.toast('Believed position moved to ' + v.id + '. Lift and shake results now refer to it.', { level: 'ok' }); renderAll(); applyOverlays(); } }, icon('person'), 'Believe a person is in ' + v.id), h('span.caption', null, 'person-sized: a 50 cm sphere fits and the pocket is over 0.3 m³ (assumed)')) : null; })()));
      }
      kids.push(real('a 3-D scan that sees inside the pile, from several sides or from within, at about the 10 cm used here.', 'whether any sensor can deliver that through concrete. A drone scan sees only the outside surface; this exhibit is handed the true geometry.'), sources('robins'));
      el.replaceChildren(...kids);
    }

    // ---------- 3 lift
    function judge(res, control, base) {
      const cd = control?.shift || new Map(); let maxShift = 0; const moved = [];
      for (const m of res.moved) { const d = m.d - (cd.get(m.idx) || 0); if (d > 0.03) { moved.push({ idx: m.idx, d }); if (d > maxShift) maxShift = d; } }
      const intr = res.prot && base ? Math.max(0, res.prot.intrusion - base.intrusion) : 0, head = res.prot && base ? base.headroom - res.prot.headroom : 0, dLoad = res.roofLoad != null && base ? res.roofLoad - base.roofLoad : 0;
      const score = Math.min(100, 100 * clamp01(intr / 0.08) + 55 * clamp01(head / 0.25) + 30 * clamp01(maxShift / 0.5) + 15 * clamp01(moved.length / 12) + 15 * clamp01(res.energy / 20000) + 10 * clamp01(dLoad / 20000));
      const verdict = intr > 0.02 || head > 0.1 || maxShift > 0.3 || res.energy > 8000 ? 'no' : maxShift > 0.05 || moved.length >= 3 || dLoad > 5000 || head > 0.03 ? 'caution' : 'safe';
      return { score, verdict, moved, maxShift, intr, head, dLoad };
    }
    const candidates = () => S.pile.pieces.filter((p) => p.alive && !p.fixed && (p.kind === 'plank' || p.kind === 'beam' || p.kind === 'column')).sort((a, b) => S.poses[b.idx * 7 + 1] - S.poses[a.idx * 7 + 1]);
    function* controlRun() { const c = yield* P.controlTrial(S.pile, S.snap, { box: S.box }); c.shift = new Map(c.moved.map((m) => [m.idx, m.d])); return c; }
    function rankAll() {
      if (S.phase !== 'settled' || !S.snap || S.rank?.running) return;
      const cand = candidates(); S.rank = { results: new Map(), running: true, total: cand.length, control: null, t0: performance.now() }; renderLift();
      jobs.add('Testing ' + cand.length + ' lifts in copies of the pile', function* () {
        const R = S.rank; R.control = yield* controlRun(); let k = 0;
        for (const p of cand) { const r = yield* P.liftTrial(S.pile, S.snap, p.idx, { box: S.box, base: S.base }); r.j = judge(r, R.control, S.base); R.results.set(p.idx, r); k++; if (k % 2 === 0 || k === cand.length) { if (S.tab === 'lift') { renderLift(); tintRank(); } } yield k / cand.length; }
        R.running = false; R.ms = performance.now() - R.t0; renderAll(); if (S.tab === 'lift') tintRank();
      });
    }
    function testOne(idx) {
      if (S.phase !== 'settled' || !S.snap) return; if (!S.rank) S.rank = { results: new Map(), running: false, total: 0, control: null };
      jobs.add('Testing the lift of ' + S.pile.pieces[idx].id, function* () { const R = S.rank; if (!R.control) R.control = yield* controlRun(); const r = yield* P.liftTrial(S.pile, S.snap, idx, { box: S.box, base: S.base }); r.j = judge(r, R.control, S.base); R.results.set(idx, r); if (S.selPiece === idx) view.showGhost(S.pile, r.before, r.after, r.j.moved, VERDICT[r.j.verdict][2]); renderAll(); if (S.tab === 'lift') tintRank(); });
    }
    function planOrder() {
      if (S.phase !== 'settled' || !S.box || S.plan?.running) return;
      S.plan = { steps: [], running: true, done: false, note: '' }; renderLift();
      jobs.add('Planning the extraction order', function* () {
        const pile = S.pile, plan = S.plan; let snap = S.snap, base = S.base; if (!S.rank) S.rank = { results: new Map(), running: false, total: 0, control: null };
        const control = S.rank.control || (S.rank.control = yield* controlRun());
        for (let s = 0; s < 8; s++) {
          const w = P.restoreWorld(snap), over = P.overhead(pile, w, S.box, snap.alive), pm = P.protectedMetrics(pile, w, S.box); w.free();
          if (pm.open >= 0.8) { plan.done = true; plan.note = 'After these lifts the believed position is open to the sky.'; break; }
          if (!over.length) { plan.note = 'What is still overhead is standing frame. It cannot be lifted off; go in from the side.'; break; }
          const tried = [];
          for (const idx of over) { yield 'Step ' + (s + 1) + ': testing ' + pile.pieces[idx].id + ' (' + (tried.length + 1) + ' of ' + over.length + ')'; const r = yield* P.liftTrial(pile, snap, idx, { box: S.box, base, keep: true }); r.j = judge(r, control, base); tried.push(r); }
          tried.sort((a, b) => a.j.score - b.j.score);
          for (const r of tried.slice(0, 2)) { // look one step ahead from the two calmest lifts
            const w2 = P.restoreWorld(r.snap), next = P.overhead(pile, w2, S.box, r.snap.alive).slice(0, 3); w2.free(); let best = next.length ? Infinity : 0; const b2 = { ...r.prot, roofLoad: r.roofLoad, roof: base.roof };
            for (const j of next) { yield 'Step ' + (s + 1) + ': looking ahead past ' + pile.pieces[r.idx].id; const r2 = yield* P.liftTrial(pile, r.snap, j, { box: S.box, base: b2, keepPoses: false }); best = Math.min(best, judge(r2, control, b2).score); }
            r.look = best;
          }
          const pick = tried.slice(0, 2).sort((a, b) => (a.j.score + 0.5 * a.look) - (b.j.score + 0.5 * b.look))[0];
          plan.steps.push({ idx: pick.idx, j: pick.j, look: pick.look, tried: tried.length, alt: tried.length > 1 && pick !== tried[0] ? tried[0].idx : -1 });
          if (S.tab === 'lift') renderLift();
          if (pick.j.verdict === 'no') { plan.steps[plan.steps.length - 1].stop = true; plan.note = 'Every remaining lift disturbs the void. Shore it first, then plan again.'; break; }
          snap = pick.snap; base = { ...pick.prot, roofLoad: pick.roofLoad, roof: base.roof };
          yield (s + 1) / 8;
        }
        if (!plan.note) plan.note = 'Stopped after eight lifts.';
        plan.running = false; renderAll();
      });
    }
    async function liveLift(idx, fromPlan) {
      if (S.phase !== 'settled') return; const p = S.pile.pieces[idx]; if (!p?.alive || p.fixed) return;
      const r = S.rank?.results.get(idx);
      if (!fromPlan && r?.j.verdict === 'no') { const ok = await ctx.shell.confirm({ title: 'Lift ' + p.id + ' anyway?', body: 'The trial says “do not touch”: ' + r.j.moved.length + ' pieces move, the largest by ' + fcm(r.j.maxShift) + '. This lifts it in the main simulation. You can undo it.', confirmLabel: 'Lift it', danger: true }); if (!ok) return; }
      S.history.push(P.snapshot(S.pile)); if (S.history.length > 12) S.history.shift();
      if (S.plan && !fromPlan) S.plan = null; else if (S.plan) { const st = S.plan.steps.find((q) => q.idx === idx); if (st) st.done = true; }
      S.selPiece = -1; view.setSelected(-1); view.clearLayer('ghost'); view.clearLayer('voids'); view.clearLayer('forces'); view.setTints(null);
      P.beginLift(S.pile, idx); S.phase = 'moving'; S.live = { type: 'lift', idx, t0: S.pile.t }; S.quiet = 0; setJob('Lifting ' + p.id + ' on the crane', 0.5); renderAll(); hudNow();
    }
    function undo() {
      const snap = S.history.pop(); if (!snap || S.phase !== 'settled') return; jobs.clear();
      P.rollback(S.pile, snap); view.trim(S.pile.pieces.length); S.poses = P.readPoses(S.pile); view.sync(S.pile, S.poses); S.plan = null; ctx.shell.toast('Undone. The pile is back as it was.', { level: 'ok' }); analyse();
    }
    function renderLift() {
      const el = panes.lift, kids = [head('Test the lift', realityTag('live-algo')),
        h('p.structure-what', null, 'Pick any slab, beam or column piece. A copy of the pile is made, the piece is raised on a crane at 0.6 m/s and taken away, and the copy is run until it is still. The original is never touched.')];
      const wait = needPile();
      if (wait) kids.push(wait);
      else {
        const b = S.base, R = S.rank, cand = candidates();
        kids.push(b ? h('div.structure-detail', null, h('header', null, h('b', null, 'Believed position: void ' + (S.boxVoid || '')), h('span.tag.tag-person', null, 'Protected volume')),
          h('dl.kv', null, h('dt', null, 'Headroom above it'), h('dd.num', null, b.headroom >= 7.9 ? 'open sky' : fcm(b.headroom)), h('dt', null, 'Pieces forming its roof'), h('dd.num', null, b.roof.map((i) => S.pile.pieces[i].id).join(', ') || 'none'), h('dt', { title: 'Sum of the downward contact forces on the roof pieces. A solver estimate.' }, 'Load pressing on that roof'), h('dd.num', null, fkN(b.roofLoad))))
          : waiting('No void is big enough to place a believed position. Lifts are judged on what moves alone.'));
        kids.push(h('div.row', null, h('button.btn' + (R ? '' : '.btn-primary'), { disabled: !!R?.running, onclick: rankAll }, icon('sort'), R?.running ? 'Testing ' + R.results.size + ' of ' + R.total + '…' : R && R.results.size >= cand.length ? 'Test all ' + cand.length + ' again' : 'Test every lift (' + cand.length + ' pieces)'),
          h('button.btn', { disabled: !S.history.length, onclick: undo }, icon('undo'), 'Undo last change'), h('div.grow'), R?.ms ? h('span.caption', null, R.results.size + ' simulations in ' + (R.ms / 1000).toFixed(1) + ' s') : null));
        if (R && R.results.size) {
          const list = [...R.results.values()].filter((r) => S.pile.pieces[r.idx].alive).sort((a, b2) => a.j.score - b2.j.score);
          const count = { safe: 0, caution: 0, no: 0 }; for (const r of list) count[r.j.verdict]++;
          kids.push(sec('Every piece, from safe to move down to do not touch', count.safe + ' safe · ' + count.caution + ' caution · ' + count.no + ' do not touch',
            h('div.structure-tablewrap', null, h('table.table.dense', null, h('thead', null, h('tr', null, h('th', null, 'Piece'), h('th.num', null, 't'), h('th', null, 'Verdict'), h('th', { title: 'This page’s own 0 to 100 scale: intrusion, lost headroom, largest shift, pieces moved, energy released, load moved onto the void' }, 'Disturbance'), h('th.num', { title: 'Pieces that move more than 3 cm beyond the control run' }, 'move'), h('th.num', null, 'max'))),
              h('tbody', null, list.map((r) => { const p = S.pile.pieces[r.idx], V = VERDICT[r.j.verdict]; return h('tr', { tabindex: 0, 'aria-selected': String(r.idx === S.selPiece), onclick: () => selectPiece(r.idx, true), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPiece(r.idx, true); } } },
                h('td', null, h('b', null, p.id)), h('td.num', null, (p.mass / 1000).toFixed(1)), h('td', null, h('span.tag.' + V[1], null, V[0])), h('td', null, h('span.structure-dist', null, h('i', { style: { width: Math.max(3, r.j.score) + '%', background: 'var(' + V[2] + ')' } })), ' ', h('span.num', { style: { fontSize: 'var(--fs-11)' } }, r.j.score.toFixed(0))), h('td.num', null, r.j.moved.length), h('td.num', null, r.j.maxShift > 0 ? fcm(r.j.maxShift) : '0')); })))),
            R.control ? h('p.caption', null, 'Control run (nothing lifted, same duration): ' + R.control.moved.length + ' pieces creep, the largest by ' + fcm(R.control.maxDisp) + '. That creep is subtracted from every trial.') : null));
        }
        // the selected piece
        const idx = S.selPiece, p = idx >= 0 ? S.pile.pieces[idx] : null;
        if (p && p.alive && p.kind !== 'shore') {
          const r = R?.results.get(idx), V = r ? VERDICT[r.j.verdict] : null, load = S.con.loadAbove[idx];
          kids.push(h('div.structure-detail', null, h('header', null, h('b', null, p.name), V ? h('span.tag.' + V[1], null, V[0]) : p.fixed ? h('span.tag.plain', null, 'Standing frame') : null),
            h('dl.kv', null, h('dt', null, 'Mass'), h('dd.num', null, ft(p.mass)), h('dt', { title: 'Sum of the downward contact forces on this piece. If it is large the piece is pinned.' }, 'Load resting on it'), h('dd.num', null, fkN(load) + (load > p.mass * P.G * 0.5 ? '   pinned' : '')),
              ...(r ? [h('dt', null, 'Pieces that move'), h('dd.num', null, r.j.moved.length + (r.j.moved.length ? ', largest ' + fcm(r.j.maxShift) : '')), h('dt', null, 'Energy released by the others'), h('dd.num', null, (r.energy / 1000).toFixed(2) + ' kJ'),
                ...(r.prot && b ? [h('dt', null, 'Headroom over the person'), h('dd.num', { class: r.j.head > 0.1 ? 'structure-bad' : '' }, (b.headroom >= 7.9 ? 'open' : fcm(b.headroom)) + ' → ' + (r.prot.headroom >= 7.9 ? 'open sky' : fcm(r.prot.headroom))), h('dt', null, 'Protected volume entered'), h('dd.num', { class: r.j.intr > 0.02 ? 'structure-bad' : '' }, (r.j.intr * 100).toFixed(0) + ' %'), h('dt', null, 'Load on the void’s roof'), h('dd.num', { class: r.j.dLoad > 5000 ? 'structure-warn' : '' }, fkN(b.roofLoad) + ' → ' + fkN(r.roofLoad))] : [])] : [])),
            r && r.j.moved.length ? h('div.structure-moves', null, r.j.moved.slice(0, 5).map((m) => h('div', null, h('span', null, S.pile.pieces[m.idx].name), h('span.num', null, fcm(m.d)))), r.j.moved.length > 5 ? h('div', null, h('span.muted', null, 'and ' + (r.j.moved.length - 5) + ' more'), h('span')) : null) : null,
            p.fixed ? h('p.caption', null, 'Part of the frame that is assumed to stand. It is held fixed in this model and cannot be lifted.') :
              h('div.row', null, h('button.btn', { onclick: () => testOne(idx) }, icon('flask'), r ? 'Test again' : 'Test this lift'), h('button.btn' + (r?.j.verdict === 'no' ? '.btn-danger' : ''), { onclick: () => liveLift(idx) }, icon('arrow-up'), 'Lift it for real'))));
        } else kids.push(h('p.caption', null, 'Click a piece in the 3-D view, or a row above, to see what its lift would disturb.'));
        // extraction order
        const pl = S.plan;
        kids.push(sec('Extraction order', pl?.steps.length ? 'greedy, one step of look-ahead' : null,
          h('p.structure-what', { style: { fontSize: 'var(--fs-12)' } }, 'Goal: open the believed position to the sky. At each step every piece overhead is test-lifted in the pile as it would then be; the calmest two are followed one lift further, and the better is kept.'),
          h('div.row', null, h('button.btn', { disabled: !S.box || pl?.running, onclick: planOrder }, icon('list'), pl?.running ? 'Planning…' : pl ? 'Plan again' : 'Plan the order'),
            pl && !pl.running && pl.steps.some((q) => !q.done && !q.stop) ? h('button.btn', { onclick: () => { const todo = S.plan.steps.filter((q) => !q.done && !q.stop).map((q) => q.idx); S.liveQueue = todo.slice(1); liveLift(todo[0], true); } }, icon('play'), 'Carry out the plan') : null),
          pl?.steps.length ? h('ol.structure-plan', null, pl.steps.map((st) => { const p2 = S.pile.pieces[st.idx], V = VERDICT[st.j.verdict]; return h('li', { class: (st.done ? 'is-done ' : '') + (st.stop ? 'is-stop' : '') }, h('div', null, h('b', null, st.stop ? 'Stop before ' + p2.id : 'Lift ' + p2.id), h('small', null, p2.name + ' · ' + st.j.moved.length + ' move, max ' + fcm(st.j.maxShift) + ' · chosen from ' + st.tried + (st.alt >= 0 ? ' · look-ahead overruled ' + S.pile.pieces[st.alt].id : ''))), h('span.tag.' + V[1], null, V[0])); })) : null,
          pl && !pl.running ? h('p.caption', null, pl.note) : null));
      }
      kids.push(real('the same scan as before, plus each piece’s weight and how it bears on its neighbours.', 'friction, hidden reinforcing bars still tying pieces together, and cracked pieces that break when lifted. A real lift plan is made by a structures specialist on site.'), sources('rapier'));
      el.replaceChildren(...kids);
    }

    // ---------- 4 shake
    let trialChart = null, fragChart = null;
    function runShake() {
      const sh = S.shake; if (S.phase !== 'settled' || sh.running) return; sh.running = true; sh.trials = []; sh.cfg = { pga: sh.pga, kind: sh.kind }; renderShake();
      jobs.add('Shaking ' + sh.n + ' copies of the pile', function* () {
        if (!S.rank) S.rank = { results: new Map(), running: false, total: 0, control: null }; const control = S.rank.control || (S.rank.control = yield* controlRun());
        for (let k = 0; k < sh.n; k++) { const r = yield* P.shakeTrial(S.pile, S.snap, { pga: sh.pga, kind: sh.kind, seed: k + 1, box: S.box, base: S.base }); sh.trials.push(scoreShake(r, control)); if (S.tab === 'shake') { trialChart?.update({ trials: sh.trials, n: sh.n }); if (k % 4 === 3) renderShake(); } yield (k + 1) / sh.n; }
        sh.running = false; const s = shakeSummary(sh.trials);
        S.runs.unshift({ label: (sh.kind === 'tremor' ? 'Aftershock ' : 'Slide push ') + sh.pga.toFixed(2) + ' g', shores: S.pile.shores.filter((i) => S.pile.pieces[i].alive).length, lifted: S.pile.pieces.filter((p) => !p.alive && p.kind !== 'shore').length, ...s }); renderAll();
      });
    }
    function scoreShake(r, control) { const j = judge(r, control, S.base); return { shift: j.maxShift, moved: j.moved, shifted: j.maxShift > 0.05, compromised: j.intr > 0.02 || j.head > 0.1, before: r.before, after: r.after, seed: r.seed, dir: r.dir }; }
    function shakeSummary(tr) { const n = tr.length, shift = tr.filter((t) => t.shifted).length, comp = tr.filter((t) => t.compromised).length, stable = tr.filter((t) => !t.shifted && !t.compromised).length; return { n, shift, comp, stable }; }
    function sweep() {
      if (S.phase !== 'settled' || S.frag?.running) return; const levels = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6], per = 10; S.frag = { points: levels.map((pga) => ({ pga, n: 0, shift: 0, comp: 0 })), running: true, kind: S.shake.kind }; renderShake();
      jobs.add('Sweeping tremor strength', function* () {
        if (!S.rank) S.rank = { results: new Map(), running: false, total: 0, control: null }; const control = S.rank.control || (S.rank.control = yield* controlRun()); let k = 0;
        for (const pt of S.frag.points) for (let i = 0; i < per; i++) { const r = yield* P.shakeTrial(S.pile, S.snap, { pga: pt.pga, kind: S.frag.kind, seed: 100 + i, box: S.box, base: S.base }); const t = scoreShake(r, control); pt.n++; if (t.shifted) pt.shift++; if (t.compromised) pt.comp++; k++; fragChart?.update({ points: S.frag.points, mark: S.shake.pga }); yield k / (levels.length * per); }
        S.frag.running = false; renderAll();
      });
    }
    function renderShake() {
      const el = panes.shake, sh = S.shake, kids = [head('Shake test', realityTag('live-algo')),
        h('p.structure-what', null, 'An aftershock does not ask first. The settled pile is copied ' + sh.n + ' times and each copy gets a different tremor of the chosen strength: a new direction, frequency and phase. The share of copies that shift is the stability score.')];
      const wait = needPile();
      if (wait) kids.push(wait);
      else {
        const out = h('output', null, sh.pga.toFixed(2) + ' g');
        const sl = h('input.slider', { type: 'range', min: 0.05, max: 0.6, step: 0.05, value: sh.pga, id: 'structure-pga', oninput: () => { sh.pga = +sl.value; out.textContent = sh.pga.toFixed(2) + ' g'; fragChart?.update({ points: S.frag?.points || [], mark: sh.pga }); } });
        kids.push(h('div.row', null, h('div.seg', { role: 'radiogroup', 'aria-label': 'Kind of load' }, [['tremor', 'Aftershock'], ['slide', 'Slide push']].map(([id, l]) => h('button', { role: 'radio', 'aria-checked': String(sh.kind === id), title: id === 'tremor' ? 'Shaking for 2.4 s, 1 to 4 Hz, with a vertical part' : 'One sideways push over 1.4 s, as from a debris surge', onclick: () => { sh.kind = id; renderShake(); } }, l))), h('div.grow'), h('button.btn.btn-primary', { disabled: sh.running, onclick: runShake }, icon('waves'), sh.running ? 'Trial ' + sh.trials.length + ' of ' + sh.n + '…' : 'Run ' + sh.n + ' trials')),
          h('div.structure-slider', null, h('label', { for: 'structure-pga' }, 'Peak ground acceleration'), out, sl));
        if (sh.trials.length) {
          const s = shakeSummary(sh.trials), [lo, hi] = wilson(s.shift, s.n), [slo, shi] = wilson(s.stable, s.n);
          kids.push(h('div.stat-row', null, h('div.stat', null, h('b', null, (100 * s.stable / s.n).toFixed(0), h('small', null, '%')), h('span', null, 'stability score: nothing moved 5 cm, void intact (95 % interval ' + (slo * 100).toFixed(0) + ' to ' + (shi * 100).toFixed(0) + ')')),
            h('div.stat', null, h('b', null, s.shift, h('small', null, 'of ' + s.n)), h('span', null, 'pile shifts (' + (lo * 100).toFixed(0) + ' to ' + (hi * 100).toFixed(0) + ' %)')), h('div.stat', null, h('b', { class: s.comp ? 'c-person' : '' }, s.comp, h('small', null, 'of ' + s.n)), h('span', null, 'void compromised'))));
          const c1 = h('canvas.structure-chart', { style: { height: '112px', cursor: 'pointer' }, role: 'img', 'aria-label': 'Largest shift in each trial', title: 'Click a bar to see what moved in that trial',
            onclick: (e) => { const r = c1.getBoundingClientRect(), i = Math.floor((e.clientX - r.left - 30) / ((r.width - 34) / sh.n)); const t = sh.trials[i]; if (t) { view.showGhost(S.pile, t.before, t.after, t.moved, t.compromised ? '--danger' : '--warn'); ctx.shell.toast('Trial ' + (i + 1) + ': ' + t.moved.length + ' pieces moved, the largest by ' + fcm(t.shift) + '.', { level: 'info' }); } } });
          kids.push(sec(s.shift > s.n / 2 ? 'Most tremors of this strength move the pile' : s.shift ? 'Some tremors of this strength move the pile' : 'No tremor of this strength moved the pile', (sh.cfg.kind === 'tremor' ? 'aftershock ' : 'slide ') + sh.cfg.pga.toFixed(2) + ' g', c1));
          trialChart = makeChart(ctx.kit, c1, drawTrials); trialChart.update({ trials: sh.trials, n: sh.n });
        } else kids.push(waiting('No trials yet. Pick a strength and run them. Each trial is a full physics run of about 4 simulated seconds.'));
        const c2 = h('canvas.structure-chart', { style: { height: '170px' }, role: 'img', 'aria-label': 'Probability the pile shifts against tremor strength' });
        kids.push(sec('How strong a tremor can this pile take?', S.frag ? '10 trials per strength, 95 % intervals' : null, S.frag ? c2 : null, h('div.row', null, h('button.btn', { disabled: S.frag?.running, onclick: sweep }, icon('signal'), S.frag?.running ? 'Sweeping…' : S.frag ? 'Sweep again' : 'Sweep seven strengths (70 runs)'))));
        if (S.frag) { fragChart = makeChart(ctx.kit, c2, drawFragility); fragChart.update({ points: S.frag.points, mark: sh.pga }); }
        if (S.runs.length) kids.push(sec('Runs on this pile', 'newest first', h('div.structure-runs', null, S.runs.slice(0, 6).map((r) => h('div', null, h('span', null, r.label + (r.shores ? ' · ' + r.shores + ' shore' + (r.shores > 1 ? 's' : '') : ' · no shores') + (r.lifted ? ' · ' + r.lifted + ' lifted' : '')), h('span.num', null, 'stable ' + (100 * r.stable / r.n).toFixed(0) + ' %'), h('span.num', { class: r.comp ? 'structure-bad' : 'structure-ok' }, 'void hit ' + r.comp + '/' + r.n))))));
      }
      kids.push(real('the pile model above, and a forecast of the aftershock: its strength at this site and its direction.', 'almost all of it. Aftershock ground motion at one address cannot be predicted, so this is a what-if, and the tremor here is two sine waves, not a recorded earthquake.'), sources('rapier'));
      el.replaceChildren(...kids);
    }

    // ---------- 5 shore
    function placeShore(pr) {
      S.history.push(P.snapshot(S.pile)); const piece = P.addShore(S.pile, pr, S.shoreType); view.addPiece(piece); view.showShorePreview(null);
      S.phase = 'moving'; S.live = { type: 'settle', t0: S.pile.t }; S.quiet = 0; ctx.shell.toast(piece.name + ' placed, ' + pr.h.toFixed(2) + ' m tall. Run the shake test again to see what it changes.', { level: 'ok' }); renderAll();
    }
    function suggestShores() {
      if (!S.box || S.phase !== 'settled') return; const b = S.box, cy = Math.cos(b.yaw), sy = Math.sin(b.yaw), R = S.pile.R; let best = [];
      for (const u of [-1, 1, 0]) for (const w of [-1, 1]) { const off = u ? [u * (b.h[0] + 0.25), 0] : [0, w * (b.h[2] + 0.3)]; const x = b.c[0] + off[0] * cy + off[1] * sy, z = b.c[2] - off[0] * sy + off[1] * cy;
        S.pile.world.updateSceneQueries?.(); const up = S.pile.world.castRay(new R.Ray({ x, y: b.c[1], z }, { x: 0, y: 1, z: 0 }), 6, false); if (!up) continue; const pr = P.probeShore(S.pile, [x, b.c[1] + up.timeOfImpact + 0.035, z], S.shoreType); if (pr.ok && !best.some((q) => Math.hypot(q.x - pr.x, q.z - pr.z) < 0.5)) best.push(pr); if (u) break; }
      best = best.slice(0, 2); if (!best.length) { ctx.shell.toast('No gap beside the believed position fits a ' + P.SHORES[S.shoreType].label.toLowerCase() + '. Try the other kind, or place one by hand.', { level: 'info' }); return; }
      S.history.push(P.snapshot(S.pile)); for (const pr of best) view.addPiece(P.addShore(S.pile, pr, S.shoreType));
      S.phase = 'moving'; S.live = { type: 'settle', t0: S.pile.t }; S.quiet = 0; ctx.shell.toast(best.length + ' shore' + (best.length > 1 ? 's' : '') + ' placed beside the believed position.', { level: 'ok' }); renderAll();
    }
    function renderShore() {
      const el = panes.shore, kids = [head('Shoring', realityTag('live-algo'), realityTag('concept')),
        h('p.structure-what', null, 'A shore is a prop that gives the load a second way to the ground. Place timber posts or box cribs under the pile and the copy of the world gets them too: rerun the shake test and see whether the void holds.')];
      const wait = needPile();
      if (wait) kids.push(wait);
      else {
        const T = P.SHORES[S.shoreType], placed = S.pile.shores.map((i) => S.pile.pieces[i]).filter((p) => p.alive);
        kids.push(h('div.row', null, h('div.seg', { role: 'radiogroup', 'aria-label': 'Kind of shore' }, Object.entries(P.SHORES).map(([id, s]) => h('button', { role: 'radio', 'aria-checked': String(S.shoreType === id), title: s.note, onclick: () => { S.shoreType = id; renderShore(); } }, id === 'post' ? 'Post shore' : 'Box crib'))), h('span.caption', null, T.note)),
          h('div.row', null, h('button.btn' + (S.shoreMode ? '' : '.btn-primary'), { 'aria-pressed': String(S.shoreMode), onclick: () => { S.shoreMode = !S.shoreMode; stage.dataset.mode = S.shoreMode ? 'shore' : ''; if (!S.shoreMode) view.showShorePreview(null); renderShore(); } }, icon('pin'), S.shoreMode ? 'Placing: click the pile (press again to stop)' : 'Place a shore by clicking'),
            h('button.btn', { disabled: !S.box, onclick: suggestShores }, icon('target'), 'Suggest two beside the void')),
          S.shoreMode ? h('p.caption', null, 'Click the top of a slab to shore the gap under it, or a point inside the pile to shore the gap above it. Turn on “See through the pile” to reach inside.') : null);
        kids.push(sec('Shores in place', placed.length ? placed.length + ' placed' : null, placed.length ? h('div.structure-tablewrap', null, h('table.table.dense', null, h('thead', null, h('tr', null, h('th', null, 'Shore'), h('th.num', null, 'height'), h('th.num', { title: 'Downward contact force on the shore now. A solver estimate.' }, 'carrying'), h('th.num', null, 'rated'), h('th', null, ''))),
          h('tbody', null, placed.map((p) => { const load = S.con.loadAbove[p.idx] || 0, over = load > p.rated; return h('tr', { onclick: () => selectPiece(p.idx, true) }, h('td', null, h('b', null, p.id), ' ', p.sub === 'post' ? 'post' : 'crib'), h('td.num', null, p.height.toFixed(2) + ' m'), h('td.num', { class: over ? 'structure-bad' : load > 0 ? 'structure-ok' : '' }, fkN(load) + (over ? '  over' : '')), h('td.num', null, fkN(p.rated)),
            h('td', null, h('button.btn.btn-ghost.btn-sm', { 'aria-label': 'Remove shore ' + p.id, onclick: (e) => { e.stopPropagation(); S.history.push(P.snapshot(S.pile)); P.removePiece(S.pile, p.idx); S.phase = 'moving'; S.live = { type: 'settle', t0: S.pile.t }; S.quiet = 0; renderAll(); } }, icon('trash', 14)))); })))) : waiting('No shores yet. A shore that carries nothing now is still doing its job: it is there for when the pile moves.'),
          h('div.row', null, h('button.btn', { disabled: !S.history.length, onclick: undo }, icon('undo'), 'Undo last change'), h('button.btn', { onclick: () => setTab('shake') }, icon('waves'), 'Go to the shake test'))));
        if (S.runs.length > 1) { const a = S.runs.find((r) => r.shores > 0), b = S.runs.find((r) => r.shores === 0); if (a && b) kids.push(h('div.note' + (a.stable / a.n > b.stable / b.n ? '.ok' : '.warn'), null, icon('info'), h('span', null, h('b', null, 'Before and after shoring. '), b.label + ': stable in ' + b.stable + ' of ' + b.n + ', void hit in ' + b.comp + '. With ' + a.shores + ' shore' + (a.shores > 1 ? 's' : '') + ' (' + a.label + '): stable in ' + a.stable + ' of ' + a.n + ', void hit in ' + a.comp + '.'))); }
      }
      kids.push(real('a way to get the timber to that spot, and a surface under it that can take the load.', 'here each shore is rigid and anchored and never fails; the page only compares the load it carries with the guide’s rated working load. Real shores are built to a pattern by trained crews and are checked by a structures specialist.'), sources('sog', 'mod4'));
      el.replaceChildren(...kids);
    }

    // ---------- 6 robots
    function planRoutes() {
      if (S.phase !== 'settled' || !S.grid || S.botsRunning) return; S.botsRunning = true; renderRobots();
      jobs.add('Planning robot routes through the voids', function* () {
        const fields = {}; let k = 0; const t0 = performance.now();
        for (const bot of ROBOTS) { yield 'Flooding the void network for the ' + bot.label.toLowerCase(); fields[bot.id] = reach(S.grid, bot); k++; yield k / ROBOTS.length; }
        const targets = S.voidRes.voids.map((v) => ({ id: v.id, voxels: v.voxels, v }));
        const table = targets.map((t) => ({ id: t.id, v: t.v, routes: Object.fromEntries(ROBOTS.map((b) => [b.id, routeTo(S.grid, fields[b.id], t.voxels)])) }));
        S.bots = { fields, table, ms: performance.now() - t0 }; S.botsRunning = false; if (!S.selVoid) S.selVoid = S.boxVoid; renderAll(); applyOverlays();
      });
    }
    function drawRoutes() {
      if (!S.bots) { view.clearLayer('routes'); return; } const row = S.bots.table.find((r) => r.id === S.selVoid) || S.bots.table[0]; if (!row) return;
      view.showRoutes(ROBOTS.map((b) => { const r = row.routes[b.id]; return r ? { id: b.id, pts: r.pts, color: '--' + b.color, radius: b.id === 'vine' ? 0.04 : b.id === 'snake' ? 0.028 : 0.1, label: b.label + ' in here, ' + r.length.toFixed(1) + ' m', length: r.length, through: true, speed: b.id === 'vine' ? 1.6 : 1.1 } : null; }).filter(Boolean));
    }
    function renderRobots() {
      const el = panes.robots, kids = [head('Routes for robots that go where rovers cannot', realityTag('concept'), realityTag('live-algo')),
        h('p.structure-what', null, 'A vine robot grows from its tip like a plant; a snake robot crawls on sixteen joints. The planner floods the pile’s air from every open face at once, under each robot’s own limits, and reports which voids each could reach and by what path.')];
      const wait = needPile();
      if (wait) kids.push(wait);
      else {
        kids.push(h('div.row', null, h('button.btn' + (S.bots ? '' : '.btn-primary'), { disabled: !!S.botsRunning, onclick: planRoutes }, icon('route'), S.botsRunning ? 'Planning…' : S.bots ? 'Plan again' : 'Plan the routes'), S.bots ? h('span.caption', null, ROBOTS.map((b) => (S.bots.fields[b.id].expanded / 1000).toFixed(0) + 'k').join(' + ') + ' voxels searched in ' + (S.bots.ms / 1000).toFixed(1) + ' s') : null));
        if (S.bots) {
          const cell = (r, b) => r ? h('td.num', { class: 'structure-ok', title: 'Path ' + r.length.toFixed(2) + ' m, tightest gap ' + (r.minClear * 200).toFixed(0) + ' cm' }, r.length.toFixed(1) + ' m') : h('td.num.structure-no', { title: b.label + ' cannot reach this void within its limits' }, 'no way in');
          kids.push(sec('Which voids each can reach', 'path length from open air',
            h('div.structure-tablewrap', null, h('table.table.dense', null, h('thead', null, h('tr', null, h('th', null, 'Void'), h('th.num', null, 'way in, cm'), ROBOTS.map((b) => h('th.num', null, b.label.replace(' robot', '').replace('HOUND ', ''))))),
              h('tbody', null, S.bots.table.map((row) => h('tr', { tabindex: 0, 'aria-selected': String(row.id === S.selVoid), onclick: () => selectVoid(row.id, true), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectVoid(row.id, true); } } }, h('td', null, h('b', null, row.id), row.id === S.boxVoid ? h('span.c-person', null, '  ●') : null), h('td.num', null, row.v.sealed ? 'sealed' : (row.v.throat * 200).toFixed(0)), ROBOTS.map((b) => cell(row.routes[b.id], b))))))),
              h('p.caption', null, (() => { const n = S.bots.table.length, c = (id) => S.bots.table.filter((r) => r.routes[id]).length; return 'Of ' + n + ' voids: rover ' + c('rover') + ', snake ' + c('snake') + ', vine ' + c('vine') + '. Select a row to draw its routes.'; })())));
          const row = S.bots.table.find((r) => r.id === S.selVoid);
          if (row) kids.push(sec('Routes into ' + row.id, null, h('div.structure-tablewrap', null, h('table.table.dense', null, h('thead', null, h('tr', null, h('th', null, 'Robot'), h('th.num', null, 'length'), h('th.num', { title: 'Narrowest free width along the path' }, 'tightest gap'), h('th.num', { title: 'Smallest radius of any bend on the path' }, 'tightest bend'), h('th.num', { title: 'Sum of all direction changes' }, 'turning'))),
            h('tbody', null, ROBOTS.map((b) => { const r = row.routes[b.id]; return h('tr', null, h('td', null, h('b', null, b.label)), ...(r ? [h('td.num', null, r.length.toFixed(2) + ' m'), h('td.num', null, (r.minClear * 200).toFixed(0) + ' cm'), h('td.num', null, r.minBend === Infinity ? 'straight' : (r.minBend * 100).toFixed(0) + ' cm'), h('td.num', null, (r.turn * 180 / Math.PI).toFixed(0) + '°')] : [h('td.num.structure-no', { colSpan: 4 }, 'no way in within its limits')])); }))))));
        }
        kids.push(h('div.structure-bots', null, ROBOTS.map((b) => h('div.structure-bot', null, h('header', null, h('i', { style: { background: 'var(--' + b.color + ')' } }), b.label, h('div.grow'), b.id === 'rover' ? h('span.tag.plain', null, 'Exists') : realityTag('concept')), h('ul', null, b.spec.map((s) => h('li', null, s)))))));
      }
      kids.push(real('the inside map again, and for the vine a pump, a reel and a tip camera that survive concrete edges; for the snake, grip on dust and a tether that does not snag.', 'whether either could follow a planned path without that map. In the field the map is exactly what the robot is being sent in to make. Carnegie Mellon’s team reported limited success in Mexico City in 2017, and SPROUT has so far been tried at a training site.'), sources('hawkes', 'sprout', 'snake', 'usnake'));
      el.replaceChildren(...kids);
    }

    // ------------------------------------------------------------ go
    ctx.bus.on('prefs', () => { resetPalette(); if (S.pile) { renderAll(); applyOverlays(); } });
    ctx.bus.on('mode', applyMode);
    const api = {
      onShow() { S.visible = true; view.start(); applyMode(); },
      onHide() { S.visible = false; view.stop(); film.stop(); tip.hidden = true; },
      onParams(p) { if (p?.tab && panes[p.tab]) { if (S.pile) setTab(p.tab); else S.tab = p.tab; } if (p?.scenario && P.SCENARIOS.some((s) => s.id === p.scenario)) { S.scenario = p.scenario; if (S.pile) rebuild(); } },
    };
    root.__structure = { S, view, film, jobs, setTab, rebuild, startCollapse, rankAll, planOrder, runShake, sweep, planRoutes, suggestShores, selectPiece, selectVoid, liveLift };
    if (ctx.params && Object.keys(ctx.params).length) api.onParams(ctx.params);
    return api;
  },
};
