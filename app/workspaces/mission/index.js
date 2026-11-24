// Mission workspace: the main screen. The 3-D twin (or the 2-D tactical map when the twin cannot load) fills the
// workspace; the stepper, inspector, timeline, minimap and alerts float over it as glass panels.
import { createMap, MAP_LAYERS } from './map2d.js';
import { installRecorder } from './record.js';
import { createTimeline } from './timeline.js';
import { createInspector } from './inspector.js';
import { createStepper } from './stepper.js';
import { createAlerts, createRouteDialog, runDrill } from './alerts.js';
import { createFilm } from './film.js';

const CAM3 = [['cinematic', 'Cinematic', 'The camera frames the story by itself'], ['orbit', 'Orbit', 'Drag to turn, scroll to zoom'], ['top', 'Top', 'Straight down, like a plan'], ['follow', 'Follow', 'Stay behind HOUND-01'], ['fpv', 'Rover view', 'Look out from the rover']];
const CAM2 = [['auto', 'Auto', 'Frame whatever the mission is doing'], ['building', 'Building', 'Fit building B'], ['site', 'Site', 'Fit the whole site'], ['follow', 'Follow', 'Stay on HOUND-01']];
const store = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

export default {
  async mount(root, ctx) {
    const { kit, sim, bus, world } = ctx, { h, icon, realityTag, fmt } = kit;
    if (!document.querySelector('link[data-mission-css]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href, 'data-mission-css': '' }));
    installRecorder(sim);
    root.classList.add('mission');

    const app = { ctx, root, twin: null, view: '2d', visible: false, pending: null, avoid: { slope: true, mud: true, gas: true, collapse: true }, planWhenReady: false };
    let camera = 'auto', restoreTimer = 0, layerState = Object.fromEntries(MAP_LAYERS.map((l) => [l.id, l.on]));

    // ---------- the view ----------
    const twinHost = h('div.mission-twin', { hidden: true });
    const mapCanvas = h('canvas.mission-map');
    const map = createMap(mapCanvas, ctx, { onUserMove: () => { if (camera !== 'free') { camera = 'free'; syncCamera(); } } });
    const miniCanvas = h('canvas.mission-mini-canvas', { 'aria-label': 'Minimap of the site. Click an item to select it.' });
    const mini = createMap(miniCanvas, ctx, { mini: true });

    // ---------- panels ----------
    const collapseBtn = (panel, name, first = 'open') => { const b = h('button.btn.btn-ghost.btn-sm.btn-icon.mission-collapse', { 'aria-label': 'Collapse or expand ' + name, 'aria-expanded': 'true', onclick: () => { const closed = panel.dataset.closed !== 'true'; panel.dataset.closed = String(closed); b.setAttribute('aria-expanded', String(!closed)); store.set('hound.mission.' + name, closed ? 'closed' : 'open'); requestAnimationFrame(layout); } }, icon('chevron')); queueMicrotask(() => { if (store.get('hound.mission.' + name, first) === 'closed') { panel.dataset.closed = 'true'; b.setAttribute('aria-expanded', 'false'); } }); return b; };
    const stepper = createStepper(app), inspector = createInspector(app), timeline = createTimeline(app), alerts = createAlerts(app), routeDialog = createRouteDialog(app);
    app.alerts = alerts;
    const left = h('aside.mission-left.glass', { 'aria-label': 'Mission' });
    const simTag = realityTag('sim'); simTag.title = 'The site, the people and the radar, thermal and drone readings are simulated. The Wi-Fi network, the fusion maths and the route planner run for real.';
    left.append(h('header.mission-head', null, h('h3', null, 'Mission'), simTag, stepper.modeSeg, collapseBtn(left, 'mission panel')),
      h('p.mission-lede.mission-intro', null, 'Run the whole search here, from drone survey to rescue.'), stepper.el);
    const right = h('aside.mission-right.glass', { 'aria-label': 'Inspector' });
    right.append(h('header.mission-head', null, inspector.title, inspector.tagSlot, inspector.back, collapseBtn(right, 'inspector')), inspector.body);
    const tlPanel = h('section.mission-tl.glass', { 'aria-label': 'Timeline' });
    const tlNow = h('span.num.mission-tl-now');
    tlPanel.append(h('header.mission-head', null, h('h3', null, 'Timeline'), tlNow, timeline.scale, h('span.grow'),
      h('button.btn.btn-ghost.btn-sm.btn-icon', { 'aria-label': 'Zoom the timeline out', title: 'Zoom out', onclick: () => timeline.zoom(1.6) }, '−'),
      h('button.btn.btn-ghost.btn-sm', { title: 'Show the whole mission', onclick: () => timeline.fit() }, 'Fit'),
      h('button.btn.btn-ghost.btn-sm.btn-icon', { 'aria-label': 'Zoom the timeline in', title: 'Zoom in', onclick: () => timeline.zoom(1 / 1.6) }, '+'),
      collapseBtn(tlPanel, 'timeline')), timeline.el);
    const legend = h('ul.mission-legend', { 'aria-label': 'Legend' },
      h('li', null, h('i.lg-person'), 'Person'), h('li', null, h('i.lg-possible'), 'Possible'), h('li', null, h('i.lg-closed'), 'Closed lead'), h('li', null, h('i.lg-route'), 'Route'),
      h('li', null, h('i.lg-hazard'), 'Hazard'), h('li', null, h('i.lg-stop'), 'Listening stop'), h('li', null, h('i.lg-searched'), 'Searched'), h('li', null, h('i.lg-rover'), 'Rover'));
    const miniTitle = h('h3', null, 'Minimap');
    const miniPanel = h('div.mission-mini.glass', { 'aria-label': 'Minimap and legend' });
    miniPanel.append(h('header.mission-head', null, miniTitle, h('span.dim.mission-mini-scale', null, '120 × 90 m'), collapseBtn(miniPanel, 'minimap', 'closed')), miniCanvas, legend);

    // ---------- toolbar ----------
    const camSeg = h('div.seg.mission-cams', { role: 'group', 'aria-label': 'Camera' });
    const viewSeg = h('div.seg', { role: 'group', 'aria-label': 'View' }, h('button', { onclick: () => setView('3d'), disabled: true, title: 'The 3-D twin is loading' }, '3-D'), h('button', { onclick: () => setView('2d'), 'aria-pressed': 'true', title: 'A flat tactical map of the same mission' }, 'Map'));
    const twinNote = h('span.mission-twin-note.dim', null, 'Loading the 3-D twin…');
    const pop = h('div.mission-pop.glass', { hidden: true });
    let popFor = null;
    const closePop = () => { pop.hidden = true; if (popFor) { popFor.setAttribute('aria-expanded', 'false'); popFor = null; } };
    function openPop(btn, build) { if (popFor === btn) return closePop(); closePop(); popFor = btn; btn.setAttribute('aria-expanded', 'true'); pop.replaceChildren(...build().filter(Boolean)); pop.hidden = false; const r = btn.getBoundingClientRect(), rr = root.getBoundingClientRect(); pop.style.top = r.bottom - rr.top + 8 + 'px'; pop.style.left = Math.max(12, Math.min(rr.width - pop.offsetWidth - 12, r.left - rr.left)) + 'px'; pop.querySelector('input, button')?.focus(); }
    const layerList = () => (app.view === '3d' && app.twin ? safe(() => app.twin.layers(), []) : map.layers().map((l) => ({ ...l, on: layerState[l.id] })));
    const layersBtn = h('button.btn', { 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: () => openPop(layersBtn, () => [h('h4', null, 'Layers'), ...layerList().map((l) => h('label.check', null, h('input', { type: 'checkbox', checked: !!l.on, onchange: (e) => setLayer(l.id, e.target.checked) }), l.label || l.id)), app.view === '3d' ? null : h('p.mission-sub', null, 'The cost grid is what the route planner sees: red cannot be crossed, amber costs more.')]) }, icon('layers'), 'Layers');
    const drillBtn = h('button.btn', { 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'A drill: make a new hazard appear and watch every route being planned again', onclick: () => openPop(drillBtn, () => {
      const S = sim.state, moving = S.units['TEAM-1'].path || S.units['HOUND-01'].path || S.routes.rescue?.status === 'planned';
      return [h('h4', null, 'Drill: new hazard'), h('p.mission-sub', null, 'A second slide brings down new debris. It is a simulated drill to show that routes are planned again the moment the map changes.'),
        h('button.btn', { disabled: !moving, title: moving ? '' : 'Nothing is driving or planned right now', onclick: () => { closePop(); runDrill(app, 'path'); } }, 'Block the path in use'),
        h('button.btn', { onclick: () => { closePop(); runDrill(app, 'corridor'); } }, 'Block the main corridor'),
        h('p.mission-sub', null, 'Blocking the corridor can cut rooms off. The drill takes control from autoplay.')]; }) }, icon('alert'), h('span', null, 'Drill', h('span.mission-wide', null, ': new hazard')));
    const guideBtn = h('button.btn', { 'aria-pressed': String(store.get('hound.narration', 'on') === 'on'), title: 'A calm guide that explains what is happening and why', onclick: () => bus.emit('narration:set', { on: guideBtn.getAttribute('aria-pressed') !== 'true' }) }, icon('copilot'), 'Guide');
    const toolbar = h('div.mission-top', { role: 'toolbar', 'aria-label': 'View controls' }, h('div.glass.mission-bar', null, viewSeg, camSeg), h('div.glass.mission-bar', null, layersBtn, drillBtn, guideBtn), twinNote);
    const narrSlot = h('div.mission-narr', { 'data-narration-slot': '' });
    const centre = h('div.mission-centre', null, toolbar, alerts.el, h('div.grow'), h('div.mission-low', null, narrSlot, miniPanel));
    const mapPadBottom = () => (app.view === '2d' ? narrSlot.getBoundingClientRect().height + 12 : 0);
    const film = createFilm(app);
    root.append(h('div.mission-view', null, mapCanvas, twinHost), film.el, h('div.mission-hud', null, left, centre, right, tlPanel), pop);

    const safe = (fn, d) => { try { return fn(); } catch (e) { console.warn('[mission] twin call failed', e); return d; } };
    function syncCamera() {
      const list = app.view === '3d' ? CAM3 : CAM2;
      camSeg.replaceChildren(...list.map(([id, label, title]) => h('button', { 'aria-pressed': String(camera === id), title, onclick: () => app.setCamera(id) }, label)));
    }
    function autoFrame() { // the 2-D map's own director
      if (app.view !== '2d' || camera !== 'auto') return;
      const S = sim.state, r = S.routes.rescue;
      if (S.phase === 'standby' || S.phase === 'aerial') map.setView('site');
      else if ((S.phase === 'plan' || S.phase === 'rescue' || S.phase === 'complete') && r) { const xs = [22], ys = [9]; for (const l of r.legs) if (l.ok) for (const p of l.path) { xs.push(p[0]); ys.push(p[1]); } map.fitRect([Math.min(...xs) - 6, Math.min(...ys) - 6, Math.max(...xs) + 6, Math.max(...ys) + 8]); }
      else if (S.phase === 'deploy') map.fitRect([18, 4, 90, 62]);
      else map.setView('building');
    }
    app.setCamera = (id) => {
      clearTimeout(restoreTimer);
      if (app.view === '3d') { if (!CAM3.some((c) => c[0] === id)) id = id === 'site' ? 'top' : id === 'building' ? 'orbit' : 'cinematic'; camera = id; safe(() => app.twin.setCamera(id)); }
      else { if (!CAM2.some((c) => c[0] === id)) id = id === 'top' ? 'site' : id === 'follow' ? 'follow' : 'auto'; camera = id; if (id === 'auto') autoFrame(); else map.setView(id); }
      syncCamera();
    };
    app.focus = (sel) => { if (!sel) return; if (app.view === '3d') safe(() => app.twin.focus(sel)); else if (map.focus(sel)) { camera = 'free'; syncCamera(); } };
    app.pushIn = (sel) => { if (ctx.mode === 'demo') return; const before = camera; app.focus(sel); clearTimeout(restoreTimer); if (before !== 'free' && sim.state.autoplay) restoreTimer = setTimeout(() => { if (app.view === '2d' ? camera === 'free' : true) app.setCamera(before); }, 7000); };
    app.select = (sel, fly) => { ctx.select(sel); if (sel && right.dataset.closed === 'true') right.querySelector('.mission-collapse').click(); if (fly) app.focus(sel); };
    function setLayer(id, on) { layerState[id] = on; map.setLayer(id, on); if (id !== 'labels' && id !== 'sensing') mini.setLayer(id, on); if (app.twin) safe(() => app.twin.setLayer(id, on)); }
    function setView(v, init) {
      if (v === '3d' && !app.twin) return;
      app.view = v; if (!init) store.set('hound.mission.view', v);
      viewSeg.children[0].setAttribute('aria-pressed', String(v === '3d')); viewSeg.children[1].setAttribute('aria-pressed', String(v === '2d'));
      twinHost.hidden = v !== '3d'; mapCanvas.hidden = v === '3d'; root.dataset.view = v;
      miniTitle.textContent = v === '3d' ? 'Minimap' : 'Legend'; miniCanvas.hidden = v !== '3d';
      camera = v === '3d' ? 'cinematic' : 'auto';
      if (app.visible) run(true);
      app.setCamera(camera); closePop(); requestAnimationFrame(layout);
    }

    // ---------- actions ----------
    app.takeControl = () => { if (!sim.state.autoplay) return; sim.command('setAutoplay', { on: false }); ctx.shell.toast('You have control. Autoplay is off: the mission now waits for you at each decision. Switch it back on at the top of the Mission panel.', { level: 'info', ms: 6000 }); };
    app.setAutoplay = (on) => { if (sim.state.autoplay === on) return; sim.command('setAutoplay', { on }); ctx.shell.toast(on ? 'Autoplay is on. The mission makes the routine choices by itself.' : 'Manual. Every step waits for you.', { level: 'info' }); stepper.update(); };
    app.decide = () => { const d = app.pending; if (!d) return; if (!d.keep) app.takeControl(); if (d.run(app) === false) ctx.shell.toast('That is not possible right now.', { level: 'info' }); stepper.update(); };
    app.act = (name, args) => { app.takeControl(); if (!sim.command(name, args)) ctx.shell.toast('That is not possible right now.', { level: 'info' }); };
    app.dismiss = async (d) => { const ok = await ctx.shell.confirm({ title: 'Dismiss this lead?', body: (d.room ? 'Room ' + d.room : 'Outdoors') + ', ' + (d.p * 100).toFixed(0) + ' %. Dismissing closes the lead without a second look. The log will say that you dismissed it.', confirmLabel: 'Dismiss lead', danger: true }); if (ok) app.act('dismiss', { id: d.id }); };
    app.planRoute = () => { const S = sim.state; if (S.phase !== 'plan') { ctx.shell.toast('The route can be planned once the leads have been checked.', { level: 'info' }); return false; } if (!S.routes.rescue && !sim.command('planRoute', { avoid: app.avoid })) { ctx.shell.toast('There is no one to plan a route to.', { level: 'info' }); return false; } routeDialog.open(); return true; };
    app.openRoute = () => routeDialog.open();
    app.planFromAlert = () => { if (sim.state.phase === 'plan') { app.takeControl(); app.planRoute(); } else if (sim.state.phase === 'rescue' || sim.state.phase === 'complete') ctx.shell.toast('The route is already approved.', { level: 'info' }); else { app.planWhenReady = true; app.takeControl(); ctx.shell.toast('Noted. The route planner opens as soon as the search and the lead checks are finished.', { level: 'info' }); } };
    app.restart = () => { sim.reset({ autoplay: sim.state.autoplay }); sim.play(); };

    // ---------- keep the subject in the part of the view that nothing covers ----------
    const safeNow = { x: 0, y: 0 }, safeGoal = { x: 0, y: 0 }; let safeW = 0, safeH = 0;
    app.applySafe = () => {
      const R0 = root.getBoundingClientRect(); if (!R0.width || !app.twin) return;
      let a;
      if (ctx.mode === 'demo') a = film.find ? { left: 0, top: 0, right: Math.round(R0.width * 0.3), bottom: 170 } : { left: 0, top: 0, right: 0, bottom: 130 };
      else { const l = left.getBoundingClientRect(), r = right.getBoundingClientRect(), t = toolbar.getBoundingClientRect(), b = tlPanel.getBoundingClientRect(); a = { left: left.dataset.closed === 'true' ? 12 : l.right - R0.left, top: t.bottom - R0.top, right: right.dataset.closed === 'true' ? 12 : R0.right - r.left, bottom: R0.bottom - b.top }; }
      if (app.twin.setSafeArea) return void safe(() => app.twin.setSafeArea(a));
      safeGoal.x = (a.right - a.left) / 2; safeGoal.y = (a.bottom - a.top) / 2; safeW = R0.width; safeH = R0.height;
    };
    function frameSafe() { // until the twin has its own safe area: shift the lens, eased
      const cam = app.twin?.three?.camera; if (!cam || app.twin.setSafeArea || !safeW) return;
      const k = kit.reducedMotion() ? 1 : 0.06, dx = safeGoal.x - safeNow.x, dy = safeGoal.y - safeNow.y; if (Math.abs(dx) + Math.abs(dy) < 0.2 && cam.view?.fullWidth === safeW && cam.view?.fullHeight === safeH) return;
      safeNow.x += dx * k; safeNow.y += dy * k; cam.setViewOffset(safeW, safeH, safeNow.x, safeNow.y, safeW, safeH);
    }

    // ---------- layout: tell the map which part of the view is not under a panel ----------
    function layout() {
      const R0 = root.getBoundingClientRect(); if (!R0.width) return;
      const l = left.getBoundingClientRect(), r = right.getBoundingClientRect(), t = toolbar.getBoundingClientRect(), b = tlPanel.getBoundingClientRect();
      map.setPad({ l: l.right - R0.left + 16, r: R0.right - r.left + 16, t: t.bottom - R0.top + 14, b: R0.bottom - b.top + 16 + mapPadBottom() });
      film.resize(R0.width, R0.height);
      if (ctx.mode === 'demo') map.setPad({ l: 40, r: 40, t: 40, b: 190 });
      if (app.twin) safe(() => app.twin.resize());
      app.applySafe();
    }
    const ro = new ResizeObserver(() => layout()); for (const el of [root, left, right, tlPanel]) ro.observe(el);

    // ---------- the frame loop for the panels ----------
    let raf = 0, lastSlow = 0;
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (ctx.mode === 'demo') film.frame(); else timeline.frame();
      frameSafe();
      if (now - lastSlow > 110) { lastSlow = now; slow(); }
    }
    function slow(force) { if (ctx.mode === 'demo') { stepper.update(); film.slow(); return; } stepper.update(); inspector.update(force); if (app.view === '3d' && app.twin?.cameraMode && app.twin.cameraMode !== camera) { camera = app.twin.cameraMode; syncCamera(); } const S = sim.state; const txt = fmt.clock(S.t) + ' · ' + (S.hold ? 'All stop' : ctx.PHASE_INFO[S.phase].label); if (tlNow.textContent !== txt) tlNow.textContent = txt; }
    function run(on) { cancelAnimationFrame(raf); map.stop(); mini.stop(); if (app.twin) safe(() => app.twin.stop()); if (!on) return; raf = requestAnimationFrame(frame); if (app.view === '3d') { safe(() => app.twin.start()); if (ctx.mode !== 'demo') mini.start(); } else map.start(); }

    const offs = [
      bus.on('event', (ev) => { if (ctx.mode !== 'demo') alerts.onEvent(ev); }),
      bus.on('mode', () => applyMode()),
      bus.on('phase', ({ to }) => { autoFrame(); if (to === 'plan' && app.planWhenReady) { app.planWhenReady = false; setTimeout(() => app.planRoute(), 0); } }),
      bus.on('route', () => autoFrame()),
      bus.on('select', () => { slow(true); }),
      bus.on('seek', () => { alerts.clear(); autoFrame(); slow(true); }),
      bus.on('reset', () => { alerts.clear(); app.planWhenReady = false; app.avoid = { slope: true, mud: true, gas: true, collapse: true }; ctx.select(null); autoFrame(); slow(true); }),
      bus.on('escape', () => { if (!pop.hidden) closePop(); else if (!routeDialog.isOpen && ctx.selection && app.visible) ctx.select(null); }),
      bus.on('narration:state', ({ on }) => guideBtn.setAttribute('aria-pressed', String(on))),
      bus.on('prefs', () => inspector.recolor()),
    ];
    root.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !popFor?.contains(e.target)) closePop(); });

    // Demo hides every instrument and gives the 3-D view the whole stage; Advanced brings them back.
    app.demoLayer = (id, on) => { if (app.twin && ctx.mode === 'demo') safe(() => app.twin.setLayer(id, on)); };
    function applyMode() {
      const demo = ctx.mode === 'demo';
      alerts.clear(); closePop(); if (demo) { routeDialog.close(); ctx.select(null); } else { film.release(); film.reset(); }
      if (app.twin) for (const [id, on] of [['labels', demo ? false : layerState.labels], ['hazards', demo ? true : layerState.hazards], ['walls-xray', demo ? false : !!layerState['walls-xray']]]) safe(() => app.twin.setLayer(id, on));
      if (app.view === '3d') app.setCamera('cinematic');
      if (app.visible) run(true);
      requestAnimationFrame(() => { layout(); autoFrame(); slow(true); });
    }
    setView('2d', true);
    // ---------- the 3-D twin: loaded after the workspace is already usable ----------
    const want2d = ctx.params?.view === '2d' || new URLSearchParams(location.search).get('view') === '2d';
    (async () => {
      try {
        const mod = await import('../../twin/index.js');
        twinHost.hidden = false; twinHost.style.visibility = 'hidden';
        const twin = await mod.createTwin(twinHost, ctx, { interactive: true, quality: 'high', camera: 'cinematic', caption: false, autostart: false });
        if (!twin || twin.ok === false) { safe(() => twin?.dispose()); throw new Error('the twin reported that it could not start'); }
        twinHost.style.visibility = ''; twinHost.hidden = true; safe(() => twin.stop());
        app.twin = twin; viewSeg.children[0].disabled = false; viewSeg.children[0].title = 'The 3-D digital twin';
        twinNote.remove();
        for (const [id, on] of Object.entries(layerState)) if (on !== MAP_LAYERS.find((l) => l.id === id).on) safe(() => twin.setLayer(id, on));
        if (!want2d && (ctx.mode === 'demo' || store.get('hound.mission.view', '3d') !== '2d')) { twinHost.style.opacity = '0'; setView('3d', true); requestAnimationFrame(() => { requestAnimationFrame(() => { twinHost.style.opacity = ''; }); }); }
        applyMode();
      } catch (e) {
        console.warn('[mission] the 3-D twin did not load; using the tactical map.', e);
        app.twinFailed = true; twinHost.hidden = true; twinHost.replaceChildren(); viewSeg.children[0].title = 'The 3-D twin did not load on this device. The tactical map shows the same mission.';
        twinNote.textContent = '3-D twin unavailable. Showing the tactical map.';
      }
    })();

    return {
      onShow() { app.visible = true; run(true); requestAnimationFrame(() => { layout(); autoFrame(); slow(true); }); bus.emit('mission:shown'); },
      onHide() { app.visible = false; film.release(); run(false); closePop(); alerts.clear(); },
      onParams(p) { if (p?.select) app.select(p.select, true); if (p?.view) setView(p.view === '2d' ? '2d' : '3d'); },
    };
  },
};
