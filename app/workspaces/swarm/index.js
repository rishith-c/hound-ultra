// Swarm workspace: several rovers and drones sharing one search, in a sandbox of its own.
// The fleet is a concept (one rover exists). The algorithms are real and run live: see engine.js.
import { genWorld, runHeadless, STRATEGIES, LAYOUTS, PARAMS, DT, fleetMix } from './engine.js';
import { createLive } from './live.js';
import { createDirector } from './director.js';
import { LR } from '../../core/fusion.js';

const DEMO = { layout: 'campus', seed: 3, n: 8, strategy: 'hungarian', race: false, charge: 1 };

const ORDER = ['nearest', 'greedy', 'hungarian'];
const clock = (t) => (t == null ? '–' : Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

export default {
  async mount(root, ctx) {
    const { h, icon, realityTag, panel, fitCanvas, cssVar } = ctx.kit;
    if (!document.getElementById('swarm-css')) document.head.append(h('link', { id: 'swarm-css', rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }));
    const w = ctx.world;
    const blockB = { staging: w.SITE.staging.slice(), building: w.BUILDING.rect.slice(), walls: w.WALLS.map((x) => ({ a: x.a, b: x.b, mat: x.mat, state: x.state })), obstacles: w.OBSTACLES.map((o) => ({ kind: o.kind, name: o.name, poly: o.poly, passable: !!o.passable })), doors: w.DOORS.map((d) => ({ pos: d.pos, blocked: !!d.blocked })) };

    const cfg = { ...DEMO, strategyB: 'nearest', speed: 30, ...(ctx.params || {}) };
    let demo = ctx.mode === 'demo', director = null, dCapNext = '', paused = false;
    let world = null, runs = [], playing = false, started = false, visible = false, raf = 0, last = 0, acc = 0, uiAcc = 1, focus = 0, selRobot = null, selLead = null, scene = null, sceneError = null, chartTab = 'seed', hover = null;
    const history = new Map(), bench = new Map();
    const key = () => [cfg.layout, cfg.seed, cfg.n, cfg.charge].join('|');
    const benchKey = () => [cfg.layout, cfg.n, cfg.charge].join('|');
    const hist = () => { if (!history.has(key())) history.set(key(), {}); return history.get(key()); };

    // ---------- header and controls ----------
    const btnPlay = h('button.btn.btn-primary', { onclick: () => togglePlay() }, icon('play'), h('span', null, 'Start search'));
    const btnRestart = h('button.btn', { onclick: () => { build(); play(); }, title: 'Run this site again from the start' }, icon('reset'), 'Restart');
    const field = (label, ...kids) => h('label.swarm-field', null, h('span', null, label), ...kids);
    const seg = (items, get, set, label) => { const el = h('div.seg', { role: 'group', 'aria-label': label }); const draw = () => el.replaceChildren(...items.map(([v, t, tip]) => h('button', { type: 'button', 'aria-pressed': String(get() === v), title: tip || null, onclick: () => { set(v); draw(); } }, t))); draw(); el.redraw = draw; return el; };
    const selLayout = h('select.select', { 'aria-label': 'Site layout', onchange: (e) => { cfg.layout = e.target.value; build(); play(); } }, ...Object.entries(LAYOUTS).map(([k, v]) => h('option', { value: k, title: v.does }, v.label)));
    const inSeed = h('input.input', { type: 'number', min: 1, max: 9999, value: cfg.seed, 'aria-label': 'Seed for the site generator', onchange: (e) => { cfg.seed = Math.max(1, Math.min(9999, Math.round(+e.target.value) || 1)); e.target.value = cfg.seed; build(); play(); } });
    const btnDice = h('button.btn.btn-icon', { 'aria-label': 'New random seed', title: 'New random site', onclick: () => { cfg.seed = 1 + Math.floor(Math.random() * 999); inSeed.value = cfg.seed; build(); play(); } }, icon('rotate'));
    const nVal = h('b', null, String(cfg.n)), nMix = h('small', null, '');
    const nMinus = h('button', { type: 'button', 'aria-label': 'One robot fewer', onclick: () => setN(cfg.n - 1) }, '−'), nPlus = h('button', { type: 'button', 'aria-label': 'One robot more', onclick: () => setN(cfg.n + 1) }, '+');
    const setN = (n) => { cfg.n = Math.max(2, Math.min(12, n)); build(); play(); };
    const stratItems = ORDER.map((s) => [s, STRATEGIES[s].short, STRATEGIES[s].does]);
    const segStrat = seg(stratItems, () => cfg.strategy, (v) => { cfg.strategy = v; if (cfg.race && cfg.strategyB === v) cfg.strategyB = ORDER.find((s) => s !== v); selB.value = cfg.strategyB; build(); play(); }, 'Assignment strategy');
    const selB = h('select.select', { 'aria-label': 'Strategy for the second run in the race', onchange: (e) => { cfg.strategyB = e.target.value; if (cfg.strategyB === cfg.strategy) { cfg.strategy = ORDER.find((s) => s !== cfg.strategyB); segStrat.redraw(); } build(); play(); } }, ...ORDER.map((s) => h('option', { value: s }, STRATEGIES[s].label)));
    selB.value = cfg.strategyB;
    const fieldB = field('Against (run B)', selB);
    const segMode = seg([[false, 'One run'], [true, 'Race two']], () => cfg.race, (v) => { cfg.race = v; if (cfg.strategyB === cfg.strategy) { cfg.strategyB = ORDER.find((s) => s !== cfg.strategy); selB.value = cfg.strategyB; } build(); play(); }, 'One run or a race between two strategies');
    const segSpeed = seg([[1, '1×'], [10, '10×'], [30, '30×'], [60, '60×'], [120, '120×']], () => cfg.speed, (v) => { cfg.speed = v; }, 'Simulation speed');
    const selCharge = h('select.select', { 'aria-label': 'Battery charge at the start', onchange: (e) => { cfg.charge = +e.target.value; build(); play(); } }, ...[[1, 'Full packs'], [0.6, '60 % packs'], [0.35, '35 % packs']].map(([v, t]) => h('option', { value: v }, t)));

    const head = h('header.ws-head.swarm-head.adv-only', null,
      h('div', null, h('h1', null, 'Swarm'), h('p', null, 'Several robots, one search: one shared map, bids for every lead, a radio path home.')),
      h('span', { title: 'Only one rover exists. The fleet, the drones and the relay beacons are a concept.' }, realityTag('concept')), h('span.tag.tag-ok', { title: 'Exploration, assignment, auction, mesh routing and battery scheduling run live in this sandbox. Every number is measured from the run.' }, 'Live algorithm'),
      h('span', { title: 'How many simulated seconds pass per real second' }, segSpeed), btnRestart, btnPlay);
    const bar = h('div.swarm-bar.adv-only', null,
      field('Site', selLayout), field('Seed', h('div.swarm-seed', null, inSeed, btnDice)),
      field('Robots', h('div.swarm-step', null, nMinus, nVal, nPlus, nMix)),
      field('Who goes where', segStrat), field('Mode', segMode), fieldB, field('Battery at start', selCharge));

    // ---------- stage ----------
    const stage = h('div.swarm-stage.crop');
    const caption = h('div.swarm-caption.glass.adv-only', { role: 'status', hidden: true });
    const badges = [0, 1].map(() => { const el = h('div.swarm-badge.glass.adv-only'); el.t = h('b'); el.big = h('div.swarm-big.num'); el.s1 = h('span'); el.s2 = h('span.swarm-win'); el.fill = h('i'); el.append(el.t, el.big, h('div.bar', null, el.fill), el.s1, el.s2); return el; });
    const divider = h('div.swarm-divider', { hidden: true });
    let camMode = 'overview';
    const segCam = seg([['overview', 'Overview'], ['plan', 'Plan'], ['follow', 'Follow']], () => camMode, (v) => { if (v === 'follow') { const r = runs[focus]?.swarm.state.robots; selRobot = selRobot || r?.[0]?.id; } camMode = v; scene?.setCamera(v, selRobot); scene?.select(v === 'follow' ? selRobot : null); drawFleet(true); }, 'Camera');
    const layerDefs = [['mesh', 'Radio mesh'], ['trails', 'Trails'], ['range', 'Sensor reach'], ['goals', 'Assignments'], ['truth', 'Hidden map (debug)']];
    const layerBox = h('div.swarm-layers.glass', { role: 'group', 'aria-label': 'Layers', hidden: true }, ...layerDefs.map(([id, t]) => h('label.check', { title: id === 'truth' ? 'Shows the walls and the people the fleet has not found yet. The robots never use this.' : null }, h('input', { type: 'checkbox', checked: id !== 'truth', onchange: (e) => scene?.setLayer(id, e.target.checked) }), t)));
    const btnFail = h('button.btn.btn-sm', { title: 'Kills the beacon that carries the most robots, to show what the mesh does next. You can also click any beacon in the view.', onclick: () => failRelay('busiest') }, icon('alert', 14), 'Fail the busiest beacon');
    const btnLayers = h('button.btn.btn-sm', { 'aria-expanded': 'false', onclick: () => { layerBox.hidden = !layerBox.hidden; btnLayers.setAttribute('aria-expanded', String(!layerBox.hidden)); } }, icon('layers', 14), 'Layers');
    const tools = h('div.swarm-tools.adv-only', null, h('div.swarm-toolrow', null, segCam, btnLayers, btnFail), layerBox);
    const sw = (c, cls = '') => h('i' + (cls ? '.' + cls : ''), { style: { background: c, color: c } });
    const lg = (cls, c, text) => h('span', null, h('i' + (cls ? '.' + cls : ''), { style: '--c:' + c }), text);
    const legend = h('div.swarm-legend.glass.legend.adv-only', null, lg('line', 'var(--text)', 'Frontier: where the known map ends'), lg('hollow', 'var(--accent)', 'Robot'), lg('line', 'var(--accent-2)', 'Radio link (amber: weak)'),
      lg('', 'var(--warn)', 'Lead: possible person'), lg('', 'var(--person)', 'Person confirmed'), h('span.dim', null, 'Walls cut at 1.7 m'));
    // ---------- demo overlay ----------
    const dCap = h('p.swarm-dcap', { role: 'status' }), dFig = ['mapped', 'search time', 'searching'].map((t) => { const b = h('b.num', null, '–'); return { el: h('div', null, b, h('span', null, t)), b }; });
    const btnDemo = h('button.btn.btn-primary', { title: 'Kills the beacon that carries the most machines. You can also click any beacon.', onclick: () => failRelay('busiest') }, icon('alert', 14), 'Fail a beacon');
    const btnHold = h('button.btn', { 'aria-label': 'Pause', onclick: () => { paused = !paused; btnHold.replaceChildren(icon(paused ? 'play' : 'pause', 14)); btnHold.setAttribute('aria-label', paused ? 'Play' : 'Pause'); } }, icon('pause', 14));
    const demoBox = h('div.swarm-demo.demo-only', null,
      h('div.swarm-dtitle', null, h('div.swarm-dtags', null, realityTag('concept'), h('span.tag.tag-ok', null, 'Live algorithm')), h('h1', null, 'One search, eight machines'), dCap, h('div.row', null, btnDemo, btnHold)),
      h('div.swarm-dfig', null, ...dFig.map((f) => f.el)));
    const setCap = (text) => { if (dCapNext === text) return; dCapNext = text; dCap.classList.add('out'); setTimeout(() => { dCap.textContent = dCapNext; dCap.classList.remove('out'); }, 260); };
    stage.append(...badges, divider, tools, legend, caption, demoBox);

    // ---------- panels ----------
    const chartCanvas = h('canvas', { role: 'img', 'aria-label': 'Coverage over time for each strategy' });
    const chartWrap = h('div.swarm-chart', null, chartCanvas);
    const benchBox = h('div.swarm-bench', { hidden: true });
    const tabSeed = h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => setTab('seed') }, 'This site'), tabBench = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setTab('bench') }, 'Across 8 sites');
    const chartPanel = panel('Coverage over time', { actions: [h('div.seg.swarm-tabs', { role: 'group', 'aria-label': 'Chart' }, tabSeed, tabBench)] }, chartWrap, benchBox);
    chartPanel.body.style.cssText = 'display:flex;flex-direction:column;padding:6px 8px 4px';
    const chartTitle = chartPanel.querySelector('h3');
    const setTab = (t) => { chartTab = t; tabSeed.setAttribute('aria-pressed', String(t === 'seed')); tabBench.setAttribute('aria-pressed', String(t === 'bench')); chartWrap.hidden = t !== 'seed'; benchBox.hidden = t !== 'bench'; if (t === 'bench') drawBench(); else drawChart(); };

    const auctionBody = h('div.swarm-auction');
    const auctionPanel = panel('Task auction', { tag: h('span.tag.tag-ok', { title: 'The bids are computed live from each robot\'s route, battery and sensors.' }, 'Live algorithm') }, auctionBody);

    const kpiTable = h('table.swarm-kpi');
    const btnMeasure = h('button.btn.btn-sm', { title: 'Runs the strategies you have not watched yet on this same site, off-screen, and adds them to the table and the chart.', onclick: () => measureOthers() }, 'Measure all three');
    const kpiPanel = panel('This site, measured', { actions: [btnMeasure] }, kpiTable);
    const fleetBody = h('tbody'), fleetAB = seg([[0, 'A'], [1, 'B']], () => focus, (v) => { focus = v; selLead = null; refreshAll(true); }, 'Which run the panels show');
    const fleetPanel = panel('Fleet', { flush: true }, h('table.table.dense', null, h('thead', null, h('tr', null, ...['Robot', 'Doing', 'Battery', 'Signal', 'Hops', 'Beacons'].map((t, i) => h('th' + (i > 3 ? '.num' : ''), { title: i === 5 ? 'Relay beacons it still carries' : i === 3 ? 'Signal to the mesh node it is attached to' : i === 4 ? 'Radio hops from the robot to base' : null }, t)))), fleetBody));
    fleetPanel.classList.add('swarm-fleet');
    const meshGrid = h('div.swarm-mesh-grid'), meshNote = h('p.caption'), logList = h('ul.swarm-log', { 'aria-label': 'Sandbox events' });
    const fleetTable = fleetPanel.body.firstChild, meshBox = h('div.swarm-meshbox', { hidden: true }, meshGrid, meshNote), logBox = h('div.swarm-logbox', { hidden: true }, logList);
    fleetPanel.body.append(meshBox, logBox);
    let sideTab = 'fleet';
    const sideTabs = h('div.tabs', { role: 'tablist', 'aria-label': 'Fleet, mesh and log' }, ...[['fleet', 'Fleet'], ['mesh', 'Mesh and energy'], ['log', 'Log']].map(([id, t]) => h('button', { type: 'button', role: 'tab', 'data-tab': id, 'aria-selected': String(id === 'fleet'), onclick: () => { sideTab = id; [...sideTabs.querySelectorAll('button')].forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id))); fleetTable.hidden = id !== 'fleet'; meshBox.hidden = id !== 'mesh'; logBox.hidden = id !== 'log'; refreshAll(true); } }, t)), h('div.grow'), fleetAB);
    fleetPanel.querySelector('.panel-head').replaceWith(sideTabs);
    const realNote = h('div.note.swarm-real', null, h('div', null, h('b', null, 'What is real. '), 'The algorithms run live and every number here is measured in this sandbox. The site, robots and sensors are simulated. The fleet is a concept: one rover exists. ',
      h('button.swarm-link', { type: 'button', onclick: () => openModel() }, 'Model and assumptions')));

    root.append(h('div.swarm', null, head, bar, h('div.swarm-main', null,
      h('div.swarm-left', null, stage, h('div.swarm-dock.adv-only', null, chartPanel, auctionPanel)),
      h('div.swarm-right.adv-only', null, kpiPanel, fleetPanel, realNote))));

    // ---------- the 3-D scene ----------
    try {
      const mod = await import('./scene.js');
      scene = mod.createScene(stage, { kit: ctx.kit, onPick: (p) => {
        if (p.view !== focus && runs.length > 1) { focus = p.view; fleetAB.redraw(); selLead = null; }
        if (p.type === 'robot') { if (demo) { scene.select(p.id); scene.film({ id: p.id, d: 22, el: 0.55, az: 0.4, st: 1.8, drift: 0.05 }); return; } selRobot = p.id; camMode = 'follow'; segCam.redraw(); scene.setCamera('follow', p.id); scene.select(p.id); refreshAll(true); }
        else if (p.type === 'relay') failRelay(p.id, p.view);
      } });
      stage.prepend(scene.canvas);
    } catch (e) {
      console.warn('[swarm] 3-D view unavailable', e); sceneError = e;
      stage.append(h('div.empty', null, icon('alert', 28), h('h3', null, 'The 3-D view could not load'), h('p.muted', { style: { maxWidth: '420px' } }, 'three.js did not arrive from the CDN. The search still runs: the chart and the tables are live. Check the connection and reload to see the scene.')));
      tools.hidden = legend.hidden = true;
    }

    // ---------- runs ----------
    function build() {
      world = genWorld({ layout: cfg.layout, seed: cfg.seed, blockB });
      const mk = (strategy, tag) => ({ strategy, tag, swarm: createLive(world, { n: cfg.n, strategy, startCharge: cfg.charge }, { layout: cfg.layout, seed: cfg.seed, blockB }) });
      for (const r of runs) r.swarm.dispose();
      runs = cfg.race ? [mk(cfg.strategy, 'A'), mk(cfg.strategyB, 'B')] : [mk(cfg.strategy, '')];
      for (const r of runs) r.swarm.advance(0, 4);
      director = null;
      focus = Math.min(focus, runs.length - 1); selLead = null; acc = 0; started = false; playing = false; hover = null;
      if (selRobot && !runs[0].swarm.state.robots.some((r) => r.id === selRobot)) { selRobot = null; if (camMode === 'follow') { camMode = 'overview'; segCam.redraw(); } }
      scene?.setSwarms(runs.map((r) => r.swarm)); applyCam();
      const mix = fleetMix(cfg.n); nVal.textContent = String(cfg.n); nMix.textContent = mix.rovers + ' rover' + (mix.rovers === 1 ? '' : 's') + (mix.drones ? ' + ' + mix.drones + ' drone' + (mix.drones === 1 ? '' : 's') : '');
      nMinus.disabled = cfg.n <= 2; nPlus.disabled = cfg.n >= 12; selLayout.value = cfg.layout; inSeed.value = cfg.seed; selCharge.value = String(cfg.charge);
      fieldB.hidden = !cfg.race; fleetAB.hidden = !cfg.race; divider.hidden = !cfg.race; stage.classList.toggle('race', cfg.race); badges[1].hidden = !cfg.race; segStrat.redraw(); segMode.redraw();
      fleetBody.replaceChildren(); fleetRows.clear(); record(); refreshAll(true);
    }
    function applyCam() { if (!scene) return; scene.setCinema(demo); if (demo && !ctx.kit.reducedMotion()) scene.setCamera('film'); else scene.setCamera(demo ? 'overview' : camMode, selRobot); scene.select(!demo && camMode === 'follow' ? selRobot : null); }
    function makeDirector() { const run = runs[0]; director = createDirector({ scene, live: run.swarm, world, onCaption: setCap, failBeacon: () => { if (run === runs[0]) run.swarm.failRelay('busiest'); }, onEnd: () => { scene.setFade(0); setTimeout(() => { if (!demo || runs[0] !== run) { scene.setFade(1); return; } Object.assign(cfg, DEMO); build(); play(); scene.setFade(1); }, 1300); } }); }
    function setMode(m) { const on = m === 'demo'; if (on === demo) return; demo = on; if (demo && cfg.race) { cfg.race = false; build(); } director = null; applyCam(); if (demo) { play(); uiAcc = 1; } else refreshAll(true); requestAnimationFrame(() => scene?.resize()); }
    function record() { const H = hist(); for (const r of runs) H[r.strategy] = { series: r.swarm.state.series, sum: r.swarm.summary(), live: true, dt: r.swarm.state.seriesDt }; }
    function play() { if (runs.every((r) => r.swarm.state.done)) return; playing = true; started = true; drawPlay(); }
    function pause() { playing = false; drawPlay(); }
    function togglePlay() { if (runs.every((r) => r.swarm.state.done)) { build(); play(); } else if (playing) pause(); else play(); }
    function drawPlay() { const done = runs.every((r) => r.swarm.state.done); btnPlay.replaceChildren(icon(done ? 'reset' : playing ? 'pause' : 'play'), h('span', null, done ? 'Run again' : playing ? 'Pause' : started ? 'Resume' : 'Start search')); btnPlay.setAttribute('aria-pressed', String(playing)); }
    function failRelay(id, view) {
      const targets = view != null ? [runs[view]] : runs;
      Promise.all(targets.map((r) => r.swarm.failRelay(id))).then((res) => { if (!res.some(Boolean)) ctx.shell.toast('No beacon is carrying traffic yet. Beacons are dropped once robots get far from base.', { level: 'info' }); else refreshAll(true); });
    }

    function tick(now) {
      raf = requestAnimationFrame(tick);
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000 || 0.016)); last = now; let speed = 0;
      if (playing && !(demo && paused)) {
        if (demo && scene && !ctx.kit.reducedMotion()) { if (!director) makeDirector(); speed = director.update(dt); } else speed = demo ? 6 : cfg.speed;
        let adv = dt * speed; if (runs.length > 1) for (const r of runs) if (!r.swarm.state.done) adv = Math.min(adv, Math.max(0, r.swarm.buffered()));   // keep a race in step
        for (const r of runs) r.swarm.advance(adv, Math.max(3, speed * (demo ? 0.7 : 0.4)));
        if (runs.every((r) => r.swarm.state.done)) { playing = false; drawPlay(); if (!demo) announceEnd(); uiAcc = 1; }
      }
      try { scene?.frame(dt, speed); } catch (e) { console.error('[swarm] scene', e); scene = null; }
      uiAcc += dt; if (uiAcc > (demo ? 0.1 : 0.25)) { uiAcc = 0; if (demo) drawDemo(); else refreshAll(false); }
    }
    function drawDemo() { const S = runs[0].swarm.state, out = S.robots.filter((r) => r.mode === 'explore' || r.mode === 'lead' || r.mode === 'listen').length, v = [(S.m.coverage * 100).toFixed(0) + ' %', clock(S.t), out + ' of ' + S.n]; dFig.forEach((f, i) => { if (f.b.textContent !== v[i]) f.b.textContent = v[i]; }); }
    function announceEnd() {
      const a = runs[0].swarm.summary(); if (runs.length === 1) ctx.shell.toast(STRATEGIES[a.strategy].label + ': search finished in ' + clock(a.tExplored) + ' of simulated time, ' + (a.coverage * 100).toFixed(1) + ' % mapped.', { level: 'ok' });
      else { const b = runs[1].swarm.summary(); if (a.t95 && b.t95) { const win = a.t95 <= b.t95 ? a : b, lose = win === a ? b : a; ctx.shell.toast(STRATEGIES[win.strategy].label + ' reached 95 % in ' + clock(win.t95) + ', ' + clock(lose.t95 - win.t95) + ' ahead of ' + STRATEGIES[lose.strategy].label.toLowerCase() + ' on this site.', { level: 'ok', ms: 7000 }); } }
    }

    // ---------- drawing the panels ----------
    function refreshAll(force) { record(); drawBadges(); drawKpi(); drawFleet(force); drawMesh(force); drawAuction(force); if (chartTab === 'seed') drawChart(); drawPlay(); }
    function drawBadges() {
      const rects = scene ? scene.rects() : [{ x: 0, w: stage.clientWidth }, { x: stage.clientWidth / 2, w: stage.clientWidth / 2 }];
      runs.forEach((r, i) => {
        const b = badges[i], S = r.swarm.state, m = S.m; b.style.left = (rects[i]?.x ?? 0) + 10 + 'px';
        b.t.replaceChildren(...(r.tag ? [h('i', null, r.tag)] : []), STRATEGIES[r.strategy].label);
        b.big.replaceChildren((m.coverage * 100).toFixed(1) + ' %', h('small', null, 'mapped'));
        b.fill.style.width = (m.coverage * 100).toFixed(1) + '%';
        b.s1.textContent = clock(S.t) + ' simulated' + (m.t95 ? ' · 95 % at ' + clock(m.t95) : '');
        let win = ''; if (runs.length === 2) { const o = runs[1 - i].swarm.state.m; if (m.t95 && (!o.t95 || m.t95 < o.t95)) win = o.t95 ? 'First to 95 %, by ' + clock(o.t95 - m.t95) : 'First to 95 %'; }
        if (S.done || m.tExplored != null) win = (win ? win + ' · ' : '') + 'search finished ' + clock(m.tExplored);
        b.s2.textContent = win; b.s2.hidden = !win;
      });
      if (cfg.race && rects[1]) divider.style.left = rects[1].x - 2 + 'px';
    }
    const KPI = [
      ['Mapped so far', (s) => (s.coverage * 100).toFixed(1) + ' %', null],
      ['Time to 95 % mapped', (s) => clock(s.t95), (s) => s.t95],
      ['Search finished', (s) => clock(s.tExplored), (s) => s.tExplored],
      ['First lead', (s) => clock(s.tFirstLead), (s) => s.tFirstLead],
      ['Distance travelled', (s) => (s.dist / 1000).toFixed(2) + ' km', (s) => (s.tExplored != null ? s.dist : null)],
      ['Energy used', (s) => s.energyWh.toFixed(0) + ' Wh', (s) => (s.tExplored != null ? s.energyWh : null)],
      ['Chasing a taken frontier', (s) => (s.clashShare * 100).toFixed(0) + ' %', (s) => (s.tExplored != null ? s.clashShare : null), 'Share of robot time spent heading for a frontier another robot was already heading for.'],
    ];
    function drawKpi() {
      const H = hist(), liveSet = new Set(runs.map((r) => r.strategy));
      const rows = [h('tr', null, h('th', { title: world.name + ', seed ' + cfg.seed + ', ' + cfg.n + ' robots' }, 'Seed ' + cfg.seed), ...ORDER.map((s) => h('th' + (liveSet.has(s) ? '.live' : ''), { title: STRATEGIES[s].does }, STRATEGIES[s].short)))];
      for (const [label, fmtv, score, tip] of KPI) {
        const vals = ORDER.map((s) => (H[s] && score ? score(H[s].sum) : null)), have = vals.filter((v) => v != null), best = have.length > 1 ? Math.min(...have) : null;
        rows.push(h('tr', null, h('td', { title: tip || null }, label), ...ORDER.map((s, i) => (H[s] ? h('td' + (best != null && vals[i] === best ? '.best' : H[s].sum.tExplored == null ? '.part' : ''), null, fmtv(H[s].sum)) : h('td.none', { title: 'Not measured yet' }, '–')))));
      }
      kpiTable.replaceChildren(...rows);
      btnMeasure.disabled = measuring || ORDER.every((s) => H[s] && (H[s].sum.tExplored != null || liveSet.has(s)));
    }
    const fleetRows = new Map();
    const DOING = { explore: (r) => (r.goal ? 'Searching' : 'Waiting for a frontier'), lead: (r) => 'To lead ' + (r.lead || '').slice(1), listen: (r) => 'Listening, ' + Math.ceil(r.timer) + ' s', return: (r) => (r.why === 'Out of beacons' ? 'Back to restock' : 'Back for a battery'), swap: (r) => 'Battery swap, ' + Math.ceil(r.timer) + ' s', regroup: () => 'No link: driving back', home: () => 'Search done: returning', done: () => 'At base', dead: () => 'Battery empty' };
    function drawFleet(force) {
      const S = runs[focus].swarm.state;
      for (const r of S.robots) {
        let row = fleetRows.get(r.id);
        if (!row) {
          row = { tr: h('tr', { tabindex: 0, role: 'button', 'aria-label': 'Follow ' + r.id, onclick: () => pickRobot(r.id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRobot(r.id); } } }) };
          row.doing = h('td.doing'); row.bfill = h('span.meter.sm'); row.bt = h('span.num'); row.batt = h('span.swarm-batt', null, row.bfill, row.bt);
          row.sig = h('span.swarm-sig', null, ...[4, 6, 9, 11].map((px) => h('i', { style: { height: px + 'px' } }))); row.lt = h('span.num'); row.rel = h('td.num'); row.hops = h('td.num'); row.lt.style.fontSize = '11.5px';
          row.tr.append(h('td', null, h('span.id', null, icon(r.kind === 'drone' ? 'drone' : 'rover', 14), r.id)), row.doing, h('td', null, row.batt), h('td', null, row.sig, row.lt), row.hops, row.rel);
          fleetBody.append(row.tr); fleetRows.set(r.id, row);
        }
        row.tr.setAttribute('aria-selected', String(selRobot === r.id && camMode === 'follow'));
        const txt = (DOING[r.mode] || (() => r.mode))(r); if (row.doing.textContent !== txt) row.doing.textContent = txt;
        row.doing.className = 'doing' + (r.mode === 'lead' || r.mode === 'listen' ? ' warn' : r.mode === 'regroup' || r.mode === 'dead' ? ' bad' : r.mode === 'swap' || r.mode === 'return' ? ' ok' : '');
        const e = r.energy / r.cap; row.bfill.style.setProperty('--v', e.toFixed(2)); row.bfill.className = 'meter sm ' + (e < 0.15 ? 'danger' : e < 0.35 ? 'warn' : 'ok'); row.bt.textContent = (e * 100).toFixed(0) + ' %';
        const bars = !r.link.ok ? 0 : r.link.rssi > -70 ? 4 : r.link.rssi > -78 ? 3 : r.link.rssi > -84 ? 2 : 1; [...row.sig.children].forEach((el, i) => el.classList.toggle('on', i < bars)); row.sig.className = 'swarm-sig' + (!r.link.ok ? ' none' : bars <= 2 ? ' weak' : '');
        const atBase = r.mode === 'done' || r.mode === 'swap'; row.lt.textContent = atBase ? 'at base' : r.link.ok ? r.link.rssi.toFixed(0) + ' dBm' : 'no path'; row.hops.textContent = atBase || !r.link.ok ? '–' : String(r.link.hops);
        row.rel.textContent = String(r.relaysLeft); row.tr.title = r.id + ' has driven ' + r.odo.toFixed(0) + ' m and used ' + r.used.toFixed(1) + ' Wh.' + (r.why ? ' ' + r.why + '.' : '');
      }
    }
    function pickRobot(id) { selRobot = id; camMode = 'follow'; segCam.redraw(); scene?.setCamera('follow', id); scene?.select(id); drawFleet(true); }
    let lastEvent = -1, capUntil = 0, capSeen = 0, capRun = null;
    function drawMesh(force) {
      const S = runs[focus].swarm.state, m = S.m, alive = S.relays.filter((r) => r.alive).length;
      btnFail.disabled = !runs.some((r) => r.swarm.state.relays.some((b) => b.alive));
      // a short caption over the view for the events that matter
      const ev = S.events, lastEv = ev[ev.length - 1];
      if (capRun !== runs[focus]) { capRun = runs[focus]; capSeen = lastEv ? lastEv.id : 0; caption.hidden = true; }
      if (lastEv && lastEv.id > capSeen) { const big = [...ev].reverse().find((e) => e.id > capSeen && (e.level === 'alert' || /95 %|Search complete|re-routed|back on the mesh/.test(e.text))); capSeen = lastEv.id;
        if (big) { caption.replaceChildren(h('span.num', null, clock(big.t)), h('span', null, big.text)); caption.className = 'swarm-caption glass ' + big.level; caption.hidden = false; capUntil = performance.now() + 5200; } }
      if (!caption.hidden && performance.now() > capUntil) caption.hidden = true;
      if (sideTab === 'mesh') {
        const weakest = S.links.length ? Math.min(...S.links.map((l) => l.rssi)) : null;
        const linked = S.robots.filter((r) => r.link.ok || r.mode === 'done').length, hops = Math.max(0, ...S.robots.map((r) => (r.link.ok ? r.link.hops : 0)));
        const kv = (rows) => h('dl.kv.num', null, ...rows.flatMap(([k, v, tip]) => [h('dt', { title: tip || null }, k), h('dd', null, v)]));
        meshGrid.replaceChildren(
          kv([['Beacons working', alive + ' of ' + S.relays.length], ['Robots with a path', linked + ' of ' + S.robots.length], ['Weakest link in use', weakest == null ? '–' : weakest.toFixed(0) + ' dBm', 'Links below ' + PARAMS.radio.rxMin + ' dBm are unusable (assumed radio).'], ['Longest path', hops + (hops === 1 ? ' hop' : ' hops')], ['Re-routed', String(m.reroutes), 'Robots that found another path after a beacon failed.'], ['Regrouped', String(m.regroups), 'Robots that lost every path and drove back to the mesh.']]),
          kv([['Energy used', m.energyWh.toFixed(1) + ' Wh'], ['Battery swaps', String(m.swaps)], ['Beacon restocks', String(m.restocks)], ['Fewest searching', S.t > 20 ? m.minSearching + ' of ' + S.n : '–', 'The fewest robots that were searching at any one moment.'], ['Leads raised', String(S.leads.length)], ['Yes / no / open', m.confirmed + ' / ' + m.rejected + ' / ' + (S.leads.length - m.confirmed - m.rejected)]]));
        if (!meshNote.textContent) meshNote.textContent = 'A robot drops a beacon when its best link falls under ' + PARAMS.radio.drop + ' dBm. At most a third of the fleet may leave for a battery swap at once, so the search never stops. Radio and power figures are assumed.';
      }
      if (sideTab === 'log') { const lastId = ev.length ? ev[ev.length - 1].id + focus * 1e6 : -1;
        if (force || lastId !== lastEvent) { lastEvent = lastId; logList.replaceChildren(...(ev.length ? ev.slice(-60).reverse().map((e) => h('li.' + e.level, null, h('time', null, clock(e.t)), h('span', null, e.text))) : [h('li', null, h('time', null, '0:00'), h('span', null, 'Nothing has happened yet.'))])); } }
    }
    let auctionSig = '';
    function drawAuction(force) {
      const S = runs[focus].swarm.state, leads = S.leads;
      if (!leads.length) { if (auctionSig !== 'empty' + focus) { auctionSig = 'empty' + focus; auctionBody.replaceChildren(h('div.empty', { style: { padding: '16px' } }, h('p', null, 'No lead yet.'), h('p.dim', { style: { maxWidth: '340px', fontSize: '12px' } }, 'When a robot\'s radar or thermal camera picks something up while it drives, every robot bids for the second look. The bids appear here.'))); } return; }
      const lead = leads.find((l) => l.id === selLead) || leads[leads.length - 1];
      const sig = focus + '|' + lead.id + '|' + lead.status + '|' + leads.map((l) => l.status[0]).join('') + '|' + (lead.bids ? lead.bids.length : 0) + '|' + lead.tries;
      if (!force && sig === auctionSig) return; auctionSig = sig;
      const tabs = h('div.swarm-leadtabs', { role: 'group', 'aria-label': 'Leads' }, ...leads.map((l) => h('button.chip', { type: 'button', 'aria-pressed': String(l.id === lead.id), onclick: () => { selLead = l.id; drawAuction(true); } }, h('i', { style: '--chip-c:' + (l.status === 'confirmed' ? 'var(--person)' : l.status === 'rejected' ? 'var(--text-3)' : 'var(--warn)') }), 'Lead ' + l.id.slice(1))));
      const stat = { auction: 'Auction open', assigned: lead.winner + ' is on the way', listening: lead.winner + ' is listening', confirmed: 'Person confirmed', rejected: 'Ruled out', open: 'Still possible: left for a person to decide' }[lead.status];
      const line = h('p.swarm-leadline', null, h('b', null, stat + ', ' + Math.round(lead.p * 100) + ' %. '), 'Raised at ' + clock(lead.t) + ' by ' + lead.by + ' (' + (lead.sensor === 'radar' ? 'radar, moving target' : lead.sensor === 'thermal' ? 'thermal, warm shape' : 'drone image') + '), ' + (lead.indoor ? 'indoors' : 'outdoors') + '.');
      const bids = (lead.bids || []).slice().sort((a, b) => (b.eligible - a.eligible) || ((b.score || 0) - (a.score || 0)));
      const table = h('table.table.dense.swarm-bids', null, h('thead', null, h('tr', null, h('th', null, 'Robot'), h('th', { title: 'Drive or flight time to the second vantage, along the known map' }, 'Arrives in'), h('th', { title: 'Charge left after the trip, the 20 s listen and the drive home' }, 'Battery after'), h('th', { title: 'How well its sensors suit this lead (assumed scores)' }, 'Sensor fit'), h('th', { title: 'Bid = ' + PARAMS.bid.time + ' × speed + ' + PARAMS.bid.battery + ' × battery + ' + PARAMS.bid.fit + ' × sensor fit (assumed weights)' }, 'Bid'))),
        h('tbody', null, ...bids.map((b) => (b.eligible
          ? h('tr' + (b.robot === lead.winner ? '.won' : ''), null, h('td', null, b.robot), h('td', null, Math.round(b.eta) + ' s'), h('td', null, Math.round(b.battAfter * 100) + ' %'), h('td', { title: b.fitWhy }, b.fit.toFixed(2)), h('td', null, h('span.swarm-bidbar', null, h('i', { style: { width: Math.round(b.score * 100) + '%' } })), b.score.toFixed(2) + (b.robot === lead.winner ? ' won' : '')))
          : h('tr.out', null, h('td', null, b.robot), h('td.why', { colspan: 4 }, 'No bid: ' + b.reason))))));
      const steps = lead.steps && lead.evidence.length > 1 ? h('div.swarm-steps', { title: 'Each reading multiplies the odds. The Wi-Fi network\'s rates are measured on simulated test windows; every other likelihood is assumed.' },
        ...lead.steps.map((s) => h('span' + (s.lr > 1.05 ? '.up' : s.lr < 0.95 ? '.down' : ''), null, (LR[s.sensor]?.label || s.sensor).replace('Wi-Fi neural network', 'Wi-Fi network') + ' ', h('b', null, s.lr === 1 ? 'no info' : '×' + s.lr.toFixed(2))))) : null;
      auctionBody.replaceChildren(tabs, line, lead.bids ? table : h('p.dim', null, 'Waiting for a known place to stand for the second look.'), steps);
    }

    // ---------- coverage chart ----------
    const STYLE = { nearest: { dash: [5, 4], col: '--text-3' }, greedy: { dash: [], col: '--text-2' }, hungarian: { dash: [], col: '--accent' } };
    let chartSize = null;
    function drawChart() {
      if (!chartSize || chartTab !== 'seed') return;
      const { c, W: cw, H: ch } = chartSize, H = hist(), liveSet = new Set(runs.map((r) => r.strategy));
      const L = 40, R = 104, Tp = 8, B = 24, pw = cw - L - R, ph = ch - Tp - B;
      c.clearRect(0, 0, cw, ch);
      const sers = ORDER.filter((s) => H[s]).map((s) => ({ s, ...H[s] }));
      const tMax = Math.max(300, ...sers.map((x) => (x.series.length - 1) * x.dt)) * 1.04;
      const X = (t) => L + (t / tMax) * pw, Y = (v) => Tp + (1 - v) * ph;
      c.font = '11px ' + cssVar('--mono'); c.textBaseline = 'middle'; c.lineWidth = 1;
      for (const v of [0, 0.25, 0.5, 0.75, 1]) { c.strokeStyle = cssVar('--line'); c.beginPath(); c.moveTo(L, Y(v) + 0.5); c.lineTo(L + pw, Y(v) + 0.5); c.stroke(); c.fillStyle = cssVar('--text-3'); c.textAlign = 'right'; c.fillText(v * 100 + ' %', L - 6, Y(v)); }
      const stepMin = [1, 2, 5, 10, 15, 20, 30, 60].find((m) => tMax / 60 / m <= 8) || 60;
      c.textAlign = 'center'; c.textBaseline = 'top';
      for (let m = 0; m * 60 <= tMax; m += stepMin) { c.fillStyle = cssVar('--text-3'); c.fillText(m + (m === 0 ? '' : ' min'), X(m * 60), Tp + ph + 6); if (m) { c.strokeStyle = cssVar('--line'); c.beginPath(); c.moveTo(X(m * 60) + 0.5, Tp); c.lineTo(X(m * 60) + 0.5, Tp + ph); c.stroke(); } }
      c.strokeStyle = cssVar('--ok'); c.setLineDash([2, 4]); c.beginPath(); c.moveTo(L, Y(0.95) + 0.5); c.lineTo(L + pw, Y(0.95) + 0.5); c.stroke(); c.setLineDash([]);
      c.fillStyle = cssVar('--ok'); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('95 %', L + pw + 6, Y(0.95));
      const ends = [];
      for (const x of sers) {
        const st = STYLE[x.s], live = liveSet.has(x.s); c.strokeStyle = cssVar(st.col); c.lineWidth = live ? 2.2 : 1.4; c.setLineDash(st.dash); c.globalAlpha = live || !liveSet.size ? 1 : 0.85;
        c.beginPath(); const n = x.series.length, stride = Math.max(1, Math.floor(n / pw)); for (let i = 0; i < n; i += stride) { const px = X(i * x.dt), py = Y(x.series[i]); if (i) c.lineTo(px, py); else c.moveTo(px, py); } const lx = X((n - 1) * x.dt), ly = Y(x.series[n - 1]); c.lineTo(lx, ly); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
        if (x.sum.t95) { c.fillStyle = cssVar('--bg-2'); c.strokeStyle = cssVar(st.col); c.lineWidth = 1.6; c.beginPath(); c.arc(X(x.sum.t95), Y(0.95), 3.5, 0, 7); c.fill(); c.stroke(); }
        if (live && playing) { c.fillStyle = cssVar(st.col); c.beginPath(); c.arc(lx, ly, 3, 0, 7); c.fill(); }
        ends.push({ x, lx, ly });
      }
      // direct labels at the line ends, nudged apart
      ends.sort((a, b) => a.ly - b.ly); let prevY = -99;
      c.font = '600 11px ' + cssVar('--font'); c.textAlign = 'left'; c.textBaseline = 'middle';
      prevY = Y(0.95) - 3; for (const e of ends) { const y = Math.max(e.ly, prevY + 13); prevY = y; c.fillStyle = cssVar(STYLE[e.x.s].col); c.fillText(STRATEGIES[e.x.s].short + (e.x.sum.t95 ? ' ' + clock(e.x.sum.t95) : ' ' + (e.x.sum.coverage * 100).toFixed(0) + ' %'), Math.min(e.lx + 8, L + pw + 6), Math.min(y, Tp + ph - 4)); }
      if (hover != null && hover >= L && hover <= L + pw) {
        const t = ((hover - L) / pw) * tMax; c.strokeStyle = cssVar('--line-2'); c.lineWidth = 1; c.beginPath(); c.moveTo(hover + 0.5, Tp); c.lineTo(hover + 0.5, Tp + ph); c.stroke();
        const lines = [clock(t)].concat(sers.filter((x) => t <= (x.series.length - 1) * x.dt).map((x) => STRATEGIES[x.s].short + ' ' + (x.series[Math.round(t / x.dt)] * 100).toFixed(1) + ' %'));
        c.font = '11px ' + cssVar('--mono'); const bw = Math.max(...lines.map((s) => c.measureText(s).width)) + 14, bx = hover + bw + 10 > L + pw ? hover - bw - 8 : hover + 8, by = Tp + ph - lines.length * 15 - 14;
        c.fillStyle = cssVar('--bg-3'); c.strokeStyle = cssVar('--line-2'); c.beginPath(); c.roundRect(bx, by, bw, lines.length * 15 + 8, 5); c.fill(); c.stroke();
        lines.forEach((s, i) => { c.fillStyle = i ? cssVar(STYLE[sers.filter((x) => t <= (x.series.length - 1) * x.dt)[i - 1].s].col) : cssVar('--text'); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(s, bx + 7, by + 5 + i * 15); });
      }
      // the title states the measured point
      const done = sers.filter((x) => x.sum.t95).sort((a, b) => a.sum.t95 - b.sum.t95);
      let title = 'Coverage over time';
      if (done.length >= 2) { const a = done[0], b = done[done.length - 1]; title = STRATEGIES[a.s].short + ' reached 95 % in ' + clock(a.sum.t95) + ': ' + clock(b.sum.t95 - a.sum.t95) + ' sooner than ' + STRATEGIES[b.s].short.toLowerCase() + ' (' + Math.round((1 - a.sum.t95 / b.sum.t95) * 100) + ' % less time)'; }
      else if (done.length === 1) title = STRATEGIES[done[0].s].short + ' reached 95 % in ' + clock(done[0].sum.t95) + '. Measure the others to compare.';
      else if (sers.length) title = 'Coverage over time: ' + (runs[0].swarm.state.m.coverage * 100).toFixed(0) + ' % mapped after ' + clock(runs[0].swarm.state.t);
      if (chartTitle.textContent !== title) { chartTitle.textContent = title; chartTitle.title = title; }
    }
    const unfit = fitCanvas(chartCanvas, (c, cw, ch) => { chartSize = { c, W: cw, H: ch }; drawChart(); });
    chartCanvas.addEventListener('mousemove', (e) => { hover = e.offsetX; drawChart(); }); chartCanvas.addEventListener('mouseleave', () => { hover = null; drawChart(); });

    // ---------- measuring off-screen ----------
    let measuring = false, pool = null, jobSeq = 0; const waiting = new Map();
    function getPool() {
      if (pool) return pool;
      const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2)), ws = [], idle = [], queue = [];
      const pump = () => { while (idle.length && queue.length) { const wk = idle.pop(), job = queue.shift(); wk.job = job.id; wk.postMessage(job); } };
      try {
        for (let i = 0; i < size; i++) { const wk = new Worker(new URL('./bench-worker.js', import.meta.url), { type: 'module' });
          wk.onmessage = (e) => { const p = waiting.get(e.data.id); waiting.delete(e.data.id); idle.push(wk); pump(); if (p) e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error)); };
          wk.onerror = (e) => { const p = waiting.get(wk.job); waiting.delete(wk.job); if (p) p.reject(new Error(e.message || 'worker failed')); };
          ws.push(wk); idle.push(wk); }
      } catch (e) { ws.length = 0; }
      pool = { run(job) { job.id = ++jobSeq; job.blockB = blockB;
        if (!ws.length) return new Promise((res) => setTimeout(() => res(runHeadless(genWorld(job), job)), 30));   // no workers: run here, one at a time
        return new Promise((resolve, reject) => { waiting.set(job.id, { resolve, reject }); queue.push(job); pump(); }); },
        stop() { ws.forEach((x) => x.terminate()); } };
      return pool;
    }
    async function measureOthers() {
      if (measuring) return; measuring = true; const k = key(), H = hist(), liveSet = new Set(runs.map((r) => r.strategy));
      const todo = ORDER.filter((s) => !(H[s] && H[s].sum.tExplored != null) && !liveSet.has(s));
      btnMeasure.textContent = 'Measuring…'; drawKpi();
      try {
        await Promise.all(todo.map(async (s) => { const r = await getPool().run({ layout: cfg.layout, seed: cfg.seed, n: cfg.n, strategy: s, startCharge: cfg.charge }); const Hk = history.get(k); if (Hk && !(k === key() && runs.some((x) => x.strategy === s))) Hk[s] = { series: r.series, sum: r, live: false, dt: 2 }; }));
        if (todo.length) ctx.shell.toast('Measured ' + todo.map((s) => STRATEGIES[s].short.toLowerCase()).join(' and ') + ' on the same site. See the table and the chart.', { level: 'ok' });
      } catch (e) { ctx.shell.toast('The off-screen runs failed: ' + e.message, { level: 'alert' }); }
      measuring = false; btnMeasure.textContent = 'Measure all three'; refreshAll(true);
    }
    const BENCH_SEEDS = [11, 23, 37, 41, 59, 67, 73, 89];
    async function runBench() {
      const bk = benchKey(); if (bench.get(bk)?.running) return;
      const rec = { running: true, done: 0, total: BENCH_SEEDS.length * 3, rows: [], layout: cfg.layout, n: cfg.n, error: null }; bench.set(bk, rec); drawBench();
      try { await Promise.all(BENCH_SEEDS.flatMap((seed) => ORDER.map(async (strategy) => { const r = await getPool().run({ layout: rec.layout, seed, n: rec.n, strategy, startCharge: cfg.charge }); rec.rows.push(r); rec.done++; if (chartTab === 'bench') drawBench(); }))); }
      catch (e) { rec.error = e.message; }
      rec.running = false; if (chartTab === 'bench') drawBench();
    }
    const benchCanvas = h('canvas', { role: 'img', 'aria-label': 'Time to 95 % coverage for each strategy on eight generated sites' });
    let benchSize = null; const unfitB = fitCanvas(benchCanvas, (c, cw, ch) => { benchSize = { c, W: cw, H: ch }; paintBench(); });
    const benchText = h('p'), benchBtn = h('button.btn.btn-sm', { onclick: () => runBench() }, 'Run 24 searches'), benchWrap = h('div.swarm-chart', null, benchCanvas);
    benchBox.append(h('div.row', null, benchText, h('div.grow'), benchBtn), benchWrap);
    function drawBench() {
      const rec = bench.get(benchKey()); const mix = fleetMix(cfg.n);
      chartTitle.textContent = 'Time to 95 % mapped across eight generated sites';
      if (!rec) { benchText.replaceChildren('One site can flatter a strategy. This runs all three on eight other seeds of ', h('b', null, LAYOUTS[cfg.layout].label.toLowerCase()), ' with ' + cfg.n + ' robots, off-screen, and plots every result.'); benchBtn.hidden = false; benchBtn.disabled = false; benchBtn.textContent = 'Run 24 searches'; }
      else if (rec.running) { benchText.textContent = 'Running: ' + rec.done + ' of ' + rec.total + ' searches finished.'; benchBtn.disabled = true; benchBtn.textContent = 'Running…'; }
      else if (rec.error) { benchText.textContent = 'The runs failed: ' + rec.error; benchBtn.disabled = false; benchBtn.textContent = 'Try again'; }
      else {
        const by = (s) => rec.rows.filter((r) => r.strategy === s), med = (s, f) => median(by(s).map(f).filter((v) => v != null));
        let wins = 0, pairs = 0; const gains = [];
        for (const seed of BENCH_SEEDS) { const a = rec.rows.find((r) => r.seed === seed && r.strategy === 'hungarian'), b = rec.rows.find((r) => r.seed === seed && r.strategy === 'nearest'); if (a?.t95 && b?.t95) { pairs++; if (a.t95 < b.t95) wins++; gains.push(1 - a.t95 / b.t95); } }
        const g = median(gains);
        benchText.replaceChildren(h('b', null, 'Measured: '), 'median time to 95 % is ' + ORDER.map((s) => STRATEGIES[s].short.toLowerCase() + ' ' + clock(med(s, (r) => r.t95))).join(', ') + '. Hungarian beat nearest frontier on ', h('b', null, wins + ' of ' + pairs + ' sites'), g == null ? '.' : ' (median ' + (g >= 0 ? Math.round(g * 100) + ' % less' : Math.round(-g * 100) + ' % more') + ' time). Median distance: ' + ORDER.map((s) => (med(s, (r) => r.dist) / 1000).toFixed(1) + ' km').join(' / ') + '.');
        benchBtn.disabled = false; benchBtn.textContent = 'Run again';
      }
      paintBench();
    }
    function paintBench() {
      if (!benchSize) return; const { c, W: cw, H: ch } = benchSize, rec = bench.get(benchKey()); c.clearRect(0, 0, cw, ch);
      const L = 78, R = 92, Tp = 6, B = 26, pw = cw - L - R, ph = ch - Tp - B, rows = rec ? rec.rows.filter((r) => r.t95) : [];
      const tMax = Math.max(600, ...rows.map((r) => r.t95)) * 1.06, X = (t) => L + (t / tMax) * pw;
      const stepMin = [1, 2, 5, 10, 15, 20, 30, 60].find((m) => tMax / 60 / m <= 8) || 60;
      c.font = '11px ' + cssVar('--mono'); c.textAlign = 'center'; c.textBaseline = 'top';
      for (let m = 0; m * 60 <= tMax; m += stepMin) { c.strokeStyle = cssVar('--line'); c.beginPath(); c.moveTo(X(m * 60) + 0.5, Tp); c.lineTo(X(m * 60) + 0.5, Tp + ph); c.stroke(); c.fillStyle = cssVar('--text-3'); c.fillText(m + (m ? ' min' : ''), X(m * 60), Tp + ph + 6); }
      ORDER.forEach((s, i) => {
        const y = Tp + ((i + 0.5) / 3) * ph, mine = rows.filter((r) => r.strategy === s);
        c.font = '600 12px ' + cssVar('--font'); c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillStyle = cssVar(STYLE[s].col); c.fillText(STRATEGIES[s].short, L - 10, y);
        c.strokeStyle = cssVar('--line'); c.beginPath(); c.moveTo(L, y + 0.5); c.lineTo(L + pw, y + 0.5); c.stroke();
        for (const r of mine) { c.fillStyle = cssVar(STYLE[s].col); c.globalAlpha = 0.75; c.beginPath(); c.arc(X(r.t95), y + ((BENCH_SEEDS.indexOf(r.seed) % 3) - 1) * 5, 4, 0, 7); c.fill(); c.globalAlpha = 1; }
        if (mine.length) { const md = median(mine.map((r) => r.t95)); c.strokeStyle = cssVar('--text'); c.lineWidth = 2; c.beginPath(); c.moveTo(X(md), y - 13); c.lineTo(X(md), y + 13); c.stroke(); c.lineWidth = 1;
          if (rec && !rec.running) { c.font = '11px ' + cssVar('--mono'); c.textAlign = 'left'; c.fillStyle = cssVar('--text-2'); c.fillText('median ' + clock(md), L + pw + 8, y); } }
      });
      if (!rows.length) { c.font = '12px ' + cssVar('--font'); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = cssVar('--text-3'); c.fillText(rec?.running ? 'First results arrive in a few seconds…' : 'Each dot will be one whole search on one generated site.', L + pw / 2, Tp + ph / 2); }
    }

    // ---------- model and assumptions ----------
    function openModel() {
      const P = PARAMS, prev = document.activeElement;
      const rows = [
        ['Site', 'Generated from the seed on a 240 × 180 grid of 0.5 m cells (120 m × 90 m). Block B uses the wall plan of the main exercise. Building outlines, heights and the city around the site are scenery: the robots never read them.', 'Simulated'],
        ['Frontier exploration', 'Frontier cells are found on the shared occupancy grid, grouped into clusters of up to 22 cells, and costed by shortest path over known free cells. Rovers then drive straight to the furthest clear point of the path.', 'Live algorithm'],
        ['Assignment', 'Nearest frontier (no coordination), greedy auction with a spreading penalty, and the Hungarian method (Kuhn–Munkres) solved at every replan.', 'Live algorithm'],
        ['Coverage score', 'Share of the floor a rover could ever reach that the fleet has seen as free. Scored against the hidden map; the robots never read it.', 'Measured'],
        ['Rover', P.rover.speed + ' m/s (HOUND-01\'s speed), ' + P.rover.capWh + ' Wh pack (3S 2200 mAh, as built).', 'Real values'],
        ['Rover mapping sensor', 'A ' + P.rover.lidar + ' m line-of-sight range sensor. HOUND-01 does not carry one yet.', 'Assumed'],
        ['Rover power draw', P.rover.hotelW + ' W standing, ' + (P.rover.hotelW + P.rover.driveW) + ' W driving.', 'Assumed'],
        ['Drone', P.drone.speed + ' m/s at ' + P.drone.alt + ' m, sees open ground and roofs within ' + P.drone.footprint + ' m, ' + P.drone.capWh + ' Wh at ' + P.drone.flyW + ' W. No drone exists.', 'Concept, assumed'],
        ['Radio', 'Log-distance path loss: ' + P.radio.p1m + ' dBm at 1 m, exponent ' + P.radio.exponent + ', minus ' + P.radio.loss[1] + ' dB per concrete wall, ' + P.radio.loss[2] + ' dB per drywall, ' + P.radio.loss[3] + ' dB per rubble pile. Usable above ' + P.radio.rxMin + ' dBm.', 'Assumed'],
        ['Relay beacons', 'A robot drops one when its best link falls under ' + P.radio.drop + ' dBm. Rovers carry ' + P.rover.relays + ', drones ' + P.drone.relays + '. A drone sets its beacon on a roof or another high point, so that beacon\'s links are traced from the air. Robots attach to the backbone; they do not relay for each other.', 'Concept, live algorithm'],
        ['Battery scheduler', 'Return when charge left is under ' + P.energy.margin + ' × the trip home plus ' + P.energy.reserve * 100 + ' %. At most a third of the fleet may be away for a swap at once.', 'Live algorithm'],
        ['Leads while driving', 'Radar picks up a moving target within ' + P.cue.radarRange + ' m through at most one wall; the thermal camera needs line of sight within ' + P.cue.thermalRange + ' m. A still person behind a wall is not picked up while driving.', 'Simulated, assumed rates'],
        ['Second look', 'Two 10 s Wi-Fi windows, radar and thermal from a new position, fused with Bayes\' rule. The Wi-Fi network answers with its measured rates: 86.9 % for a moving person, 21.4 % for a still one, 11.1 % false alarms.', 'Measured in simulation'],
        ['Other sensor likelihoods', 'Radar, thermal, drone image, machine signature: the same assumed values as the Fusion workspace.', 'Assumed'],
        ['Bid', P.bid.time + ' × speed score + ' + P.bid.battery + ' × battery after + ' + P.bid.fit + ' × sensor fit.', 'Assumed weights'],
      ];
      const close = () => { wrap.remove(); prev?.focus?.(); };
      const ok = h('button.btn.btn-primary', { onclick: close }, 'Close');
      const wrap = h('div.scrim', { onclick: (e) => { if (e.target === wrap) close(); }, onkeydown: (e) => { if (e.key === 'Escape') close(); } },
        h('div.dialog.glass.swarm-dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Model and assumptions' }, h('h2', null, 'Model and assumptions'),
          h('p', null, 'Only one rover exists, so this fleet has never driven anywhere. What you can trust is narrower and still useful: given this model, these algorithms produce these numbers, and you can re-run every one of them.'),
          h('table.table', null, h('thead', null, h('tr', null, h('th', null, 'Part'), h('th', null, 'How it works here'), h('th', null, 'Status'))), h('tbody', null, ...rows.map((r) => h('tr', null, h('td', { style: { whiteSpace: 'nowrap', fontWeight: 600 } }, r[0]), h('td', { style: { whiteSpace: 'normal', lineHeight: 1.4 } }, r[1]), h('td', { style: { whiteSpace: 'nowrap' } }, r[2]))))),
          h('p', null, 'Not modelled: robots colliding with each other, wheel slip and stairs, radio interference and multipath, sensor noise in the map, and people who move.'),
          h('div.row', { style: { justifyContent: 'flex-end' } }, ok)));
      (document.getElementById('overlays') || document.body).append(wrap); ok.focus();
    }

    build();
    root._swarm = { cfg, get director() { return director; }, get runs() { return runs; }, get scene() { return scene; }, build, play, pause, failRelay, history, bench, runBench, measureOthers, setTab };
    const offMode = ctx.bus.on('mode', ({ mode }) => setMode(mode));
    const offEsc = ctx.bus.on('escape', () => { if (!demo && camMode === 'follow') { camMode = 'overview'; segCam.redraw(); scene?.setCamera('overview'); scene?.select(null); drawFleet(true); } });
    let firstShow = true, resumeOnShow = false;
    return {
      onShow() { visible = true; scene?.resize(); last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); if (firstShow) { firstShow = false; play(); } else if (demo && resumeOnShow) play(); },
      onHide() { resumeOnShow = playing; visible = false; cancelAnimationFrame(raf); raf = 0; if (playing) pause(); },
      onParams(p) { if (!p || !Object.keys(p).length) return; Object.assign(cfg, p); segSpeed.redraw(); build(); play(); },
    };
  },
};
