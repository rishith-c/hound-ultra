// Valley: the real Bhote Koshi valley at Timure in 3-D, an illustrative flood on the real terrain, terrain tools,
// and the simulated exercise placed on the map.
//   Real data:        elevation (Mapzen terrain tiles on AWS), imagery (Esri World Imagery), map data (OpenStreetMap).
//   Live algorithm:   the flood model, slope, terrain shadows, the sun window, distances and profiles (terrain.js).
//   Simulated:        the block, its buildings, the units, the leads: all from ctx.sim.state.
import { BOUNDS, siteFrame, haversine, sunPosition, nptDate, nptToday, fmtDist, fmtClock, fmtLat, fmtLon } from './geo.js';
import * as T from './terrain.js';
import { buildImpacts, CROSSING_CLEARANCE, ROAD_DEPTH } from './impacts.js';
import { drawProfile, profileDist, drawStageCurve, drawHorizon } from './charts.js';
import { contours } from 'd3';

const cssUrl = new URL('./style.css', import.meta.url);
if (!document.querySelector('link[data-area-css]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = cssUrl; l.dataset.areaCss = '1'; document.head.append(l); }

const SURGE = { height: 15, speed: 600, front: 260, tail: 1900 };   // metres, metres per second on screen (assumed, sped up)
const MODE_WORDS = { idle: 'standing by', drive: 'moving', listen: 'listening', hold: 'holding', fault: 'link lost', swap: 'battery swap', takeoff: 'taking off', scan: 'surveying', return: 'returning', landed: 'landed' };
const FC = (features = []) => ({ type: 'FeatureCollection', features });
const feat = (type, coordinates, properties = {}) => ({ type: 'Feature', properties, geometry: { type, coordinates } });
const compass = (az) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(az / 45) % 8];

export default {
  async mount(root, ctx) {
    const { h, icon, realityTag, reducedMotion } = ctx.kit, { SITE, BUILDING, ROOMS, OBSTACLES, HAZARDS } = ctx.world;
    const frame = siteFrame(SITE.anchor), siteCenter = frame.ll([SITE.w / 2, SITE.h / 2]);
    const query = new URLSearchParams(location.search);
    root.classList.add('area');

    // ------------------------------------------------------------------ skeleton
    const stage = h('div.area-stage'), mapHost = h('div.area-map'), schemHost = h('div.area-schem', { hidden: true });
    stage.append(mapHost, schemHost);
    const loading = h('div.area-loading', { role: 'status' }, h('div.spinner'), h('p', null, 'Reading the elevation tiles for the valley…'));
    root.append(stage, loading);

    // ------------------------------------------------------------------ data
    let osm, dem;
    try { osm = await (await fetch(new URL('./data/osm.json', import.meta.url))).json(); }
    catch (e) { loading.replaceChildren(icon('alert', 28), h('h2', null, 'The valley data did not load'), h('p.muted', null, 'The saved OpenStreetMap extract for Timure is missing. Reload the page to try again.'), h('button.btn', { onclick: () => location.reload() }, 'Reload')); return {}; }
    for (const r of osm.rivers) r.main = r.name === 'Bhote Koshi';
    const forced = query.has('schematic') || navigator.onLine === false;
    try { if (forced) throw new Error('offline'); dem = await T.loadLiveDem(); }
    catch { dem = await T.loadSavedDem(); }
    loading.lastChild.textContent = 'Working out slopes and where water can reach…';
    await new Promise((r) => setTimeout(r, 0));
    const slope = T.slopeGrid(dem), model = T.floodModel(dem, osm.rivers), coarse = T.coarse(dem);
    const impacts = buildImpacts(dem, model, slope, osm, frame, SITE);
    const horizon = T.horizonAt(coarse, siteCenter[0], siteCenter[1]);

    const mk = (n) => { const c = document.createElement('canvas'); c.width = c.height = n; return c; };
    const today = nptToday();
    const M = {
      dem, osm, impacts, exaggeration: 1.25,
      canvases: { flood: mk(dem.n), slope: mk(dem.n), shadow: mk(coarse.n) },
      sun: sunPosition(nptDate(today.dayUtcMs, 630), siteCenter[1], siteCenter[0]),
      home: { center: siteCenter, zoom: 16.25, pitch: 62, bearing: 24 },
      buildingsFC: FC(osm.buildings.map((b) => feat('Polygon', [b.g], { id: b.id }))),
    };
    const S = { stage: 0, surge: null, minutes: 630, shadows: false, slope: false, measuring: false, pts: [], hover: null, prof: null, probe: null, view: null, shown: false, flew: false,
      layers: { flood: true, sectors: true, exercise: true, buildings: true }, sector: impacts.sectors.find((s) => s.home).id, tab: 'flood', fail: null };

    // slope shading is painted once: amber from 25 degrees, orange from 35, red from 45
    { const c = M.canvases.slope.getContext('2d'), img = c.createImageData(dem.n, dem.n), px = img.data;
      for (let k = 0; k < slope.length; k++) { const s = slope[k]; if (s < 25) continue; const p = k * 4;
        if (s < 35) { px[p] = 255; px[p + 1] = 178; px[p + 2] = 36; px[p + 3] = 22 + (s - 25) * 5; }
        else if (s < 45) { px[p] = 255; px[p + 1] = 122; px[p + 2] = 60; px[p + 3] = 105 + (s - 35) * 3; }
        else { px[p] = 255; px[p + 1] = 77; px[p + 2] = 94; px[p + 3] = 175; } }
      c.putImageData(img, 0, 0); }
    // the part of the grid the water model can touch, so only that rectangle is repainted
    const floodCtx = M.canvases.flood.getContext('2d'), floodImg = floodCtx.createImageData(dem.n, dem.n);
    const box = [dem.n, dem.n, 0, 0]; for (const k of model.cells) { const x = k % dem.n, y = (k / dem.n) | 0; if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y; if (x > box[2]) box[2] = x; if (y > box[3]) box[3] = y; }
    let prevUpto = 0;

    // ------------------------------------------------------------------ the exercise as map features
    const poly = (pts, props) => feat('Polygon', [[...pts, pts[0]].map(frame.ll)], props), rect = (r) => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
    const exStatic = FC([
      poly(rect([0, 0, SITE.w, SITE.h]), { kind: 'site' }),
      poly(rect(BUILDING.rect), { kind: 'building', target: true, h: BUILDING.wallHeight }),
      ...OBSTACLES.filter((o) => o.kind === 'building').map((o) => poly(o.poly, { kind: 'building', target: false, h: o.h })),
      ...OBSTACLES.filter((o) => o.kind === 'rubble').map((o) => poly(o.poly, { kind: 'rubble' })),
      ...ROOMS.map((r) => poly(rect(r.rect), { kind: 'room' })),
    ]);
    function exDynamic(st) {
      const out = [];
      for (const hz of [...HAZARDS, ...(st.hazards || [])]) if (hz.poly) out.push(poly(hz.poly, { kind: 'hazard' }));
      for (const sw of st.map.swaths) { out.push(poly(rect([sw.x0, sw.y - sw.half, sw.x1, sw.y + sw.half]), { kind: 'swath' })); out.push(feat('LineString', [[sw.x0, sw.y], [sw.x1, sw.y]].map(frame.ll), { kind: 'swathline' })); }
      for (const u of Object.values(st.units)) if (u.trail.length > 1) out.push(feat('LineString', [...u.trail, u.pos].map(frame.ll), { kind: 'trail', unit: u.kind }));
      const rover = st.units['HOUND-01']; if (rover.path?.length > 1) out.push(feat('LineString', rover.path.map(frame.ll), { kind: 'plan' }));
      for (const leg of st.routes.rescue?.legs || []) if (leg.path?.length > 1) out.push(feat('LineString', leg.path.map(frame.ll), { kind: 'route' }));
      return FC(out);
    }

    // ------------------------------------------------------------------ markers (shared by both views)
    const markerEls = new Map();
    function markerEl(id, cls, iconName, onPick) {
      let m = markerEls.get(id);
      if (!m) {
        const title = h('b'), sub = h('em');
        const el = h('button.area-mk.' + cls, { type: 'button', onclick: (e) => { e.stopPropagation(); onPick(); } }, h('i', null, icon(iconName, 14)), h('span', null, title, sub));
        m = { el, title, sub }; markerEls.set(id, m);
      }
      return m;
    }
    function markerList(st) {
      const list = [], sel = ctx.selection;
      const pin = markerEl('site', 'area-mk-site', 'mission', () => S.view?.easeTo(M.home));
      pin.title.textContent = 'Block B'; pin.sub.textContent = 'training exercise, simulated'; pin.el.setAttribute('aria-label', 'Block B, the simulated training exercise. Fly to it.');
      list.push({ id: 'site', el: pin.el, ll: siteCenter });
      for (const u of Object.values(st.units)) {
        const m = markerEl('unit:' + u.id, 'area-mk-unit.area-mk-' + u.kind, u.kind === 'team' ? 'person' : u.kind, () => ctx.select({ type: 'unit', id: u.id }));
        m.title.textContent = u.name; m.sub.textContent = MODE_WORDS[u.mode] || u.mode; m.el.setAttribute('aria-label', u.name + ', ' + (MODE_WORDS[u.mode] || u.mode) + ' (simulated)');
        m.el.classList.toggle('sel', sel?.type === 'unit' && sel.id === u.id);
        list.push({ id: 'unit:' + u.id, el: m.el, ll: frame.ll(u.pos), heading: u.heading });
      }
      for (const d of st.detections) {
        if (d.status === 'rejected' || d.dismissed) continue;
        const confirmed = d.status === 'confirmed', m = markerEl('det:' + d.id, 'area-mk-det', 'person', () => ctx.select({ type: 'detection', id: d.id }));
        m.el.classList.toggle('confirmed', confirmed); m.el.classList.toggle('sel', (sel?.type === 'detection' && sel.id === d.id) || (sel?.type === 'survivor' && sel.id === d.survivorId));
        m.title.textContent = confirmed ? 'Person' : 'Possible person'; m.sub.textContent = Math.round(d.p * 100) + ' %';
        m.el.setAttribute('aria-label', (confirmed ? 'Person found, ' : 'Possible person, ') + Math.round(d.p * 100) + ' percent, simulated');
        list.push({ id: 'det:' + d.id, el: m.el, ll: frame.ll(d.pos) });
      }
      return list;
    }

    // ------------------------------------------------------------------ panels
    const el = {};
    const range = (props) => h('input.slider', { type: 'range', ...props });
    const fill = (input) => input.style.setProperty('--p', ((input.value - input.min) / (input.max - input.min)) * 100 + '%');
    const stat = (key, label) => h('div.stat.live', null, (el[key] = h('b', null, '0')), h('span', null, label));
    const chart = (key, height, label) => (el[key] = h('canvas.area-chart', { style: { height: height + 'px' }, role: 'img', 'aria-label': label }));

    // left: header + analysis
    const head = h('header.area-head.glass', null,
      h('div.row', null, h('h2', null, 'Valley'), h('div.grow'), realityTag('real-data'), realityTag('sim')),
      h('p.muted', null, 'The real Bhote Koshi valley at Timure, Nepal: where the block is, what the ground does, and what rising water would reach. The terrain, imagery and map are real. The exercise on it is invented.'));

    const tabs = [['flood', 'Flood'], ['terrain', 'Terrain'], ['sun', 'Sun'], ['layers', 'Layers']];
    const tabBar = h('div.seg.area-tabs', { role: 'tablist', 'aria-label': 'Analysis' }, ...tabs.map(([id, label]) => h('button', { role: 'tab', id: 'area-tab-' + id, 'aria-selected': String(id === S.tab), 'aria-controls': 'area-pane-' + id, onclick: () => setTab(id) }, label)));
    function setTab(id) { S.tab = id; for (const b of tabBar.children) b.setAttribute('aria-selected', String(b.id === 'area-tab-' + id)); for (const [t] of tabs) el['pane-' + t].hidden = t !== id; requestAnimationFrame(redrawCharts); }

    el.stageRange = range({ min: 0, max: T.MAX_STAGE, step: 0.5, value: 0, 'aria-label': 'Water level above the river, in metres', oninput: (e) => setStage(+e.target.value) });
    el['pane-flood'] = h('div.area-pane', { id: 'area-pane-flood', role: 'tabpanel', 'aria-labelledby': 'area-tab-flood' },
      h('div.row', null, h('h3.grow', null, 'Flood model'), realityTag('live-algo')),
      h('p.note.warn', null, 'An illustrative simulation on the real terrain. Not a forecast, and not a reconstruction of the real event.'),
      h('label.area-field', null, h('span', null, 'Water level above the river'), (el.stageVal = h('b.num', null, '+0.0 m'))), el.stageRange,
      h('div.row', null, (el.surgeBtn = h('button.btn.grow', { onclick: () => (S.surge ? endSurge() : startSurge()) }, 'Send a surge down the valley')), h('button.btn.btn-ghost', { onclick: () => { endSurge(); setStage(0); } }, 'Drain')),
      h('div.area-stats', null, stat('fArea', 'hectares under water'), stat('fRoad', 'of mapped road under water'), stat('fWet', 'mapped buildings in the water'), stat('fCut', 'more cut off from the main road')),
      (el.fBlock = h('p.area-line')),
      h('div', null, h('h4.area-h4', null, 'Area under water by water level'), chart('curve', 86, 'Line chart: hectares under water against water level above the river'), h('div.area-axis', null, h('span', null, 'hectares'), h('span', null, 'water level above the river'))),
      h('div', null, h('h4.area-h4', null, 'Road sections under water'), (el.cuts = h('div.area-list'))),
      h('details.area-how', null, h('summary', null, 'How this is worked out, and its limits'),
        h('p', null, 'The mapped river is laid on the elevation grid (' + dem.n + ' by ' + dem.n + ' cells of ' + dem.cs.toFixed(1) + ' m). Each cell near it gets its height above the nearest point of the river. A priority flood from the river then finds the lowest water level at which water can reach each cell without climbing over higher ground.'),
        h('p', null, 'Limits: the elevation data is about 30 m wide per measurement, so the channel, embankments and buildings are not resolved. There is no flow, no time and no debris in this model. A road is counted as under water at ' + ROAD_DEPTH + ' m of water, and a river crossing at ' + CROSSING_CLEARANCE + ' m (both assumed). A building is “cut off” when its nearest mapped road or path no longer connects to the south end of the main road.'),
        h('p', null, 'The surge is a ' + SURGE.height + ' m wave shown about 100 times faster than a real flood wave would travel (assumed shape and speed).')));

    el.exRange = range({ min: 1, max: 2, step: 0.05, value: M.exaggeration, 'aria-label': 'Terrain height exaggeration', oninput: (e) => { M.exaggeration = +e.target.value; fill(e.target); el.exVal.textContent = M.exaggeration.toFixed(2) + '×'; S.view?.setExaggeration(M.exaggeration); } });
    const steepAll = impacts.sectors.reduce((a, s) => a + s.steep, 0) / impacts.sectors.reduce((a, s) => a + s.cells, 0);
    el['pane-terrain'] = h('div.area-pane', { id: 'area-pane-terrain', role: 'tabpanel', 'aria-labelledby': 'area-tab-terrain', hidden: true },
      h('div.row', null, h('h3.grow', null, 'Slope'), realityTag('live-algo')),
      h('label.check', null, (el.slopeChk = h('input', { type: 'checkbox', onchange: (e) => { S.slope = e.target.checked; S.view?.setLayer('slope', S.slope); } })), 'Shade steep ground'),
      h('div.area-legend', null, h('i.s1'), h('span', null, '25° to 35°'), h('i.s2'), h('span', null, '35° to 45°'), h('i.s3'), h('span', null, 'over 45°')),
      h('p.area-line', null, h('b.num', null, Math.round(steepAll * 100) + ' %'), ' of the ground inside the search grid is steeper than 35°.'),
      h('p.muted.area-small', null, 'Slope angle is computed from the elevation grid (Horn’s method). Steep is where slides start most easily, but a landslide map also needs geology, soil and rain. Treat this as where to look, not as a hazard rating.'),
      h('h3', null, 'Relief'),
      h('label.area-field', null, h('span', null, 'Height exaggeration'), (el.exVal = h('b.num', null, M.exaggeration.toFixed(2) + '×'))), el.exRange,
      h('p.muted.area-small', null, 'At 1.00× the mountains are drawn to scale. Elevation here runs from ' + Math.round(dem.min).toLocaleString('en') + ' m at the river to ' + Math.round(dem.max).toLocaleString('en') + ' m on the ridges.'));

    el.sunRange = range({ min: 0, max: 1435, step: 5, value: S.minutes, 'aria-label': 'Time of day in Nepal', oninput: (e) => setSun(+e.target.value) });
    el['pane-sun'] = h('div.area-pane', { id: 'area-pane-sun', role: 'tabpanel', 'aria-labelledby': 'area-tab-sun', hidden: true },
      h('div.row', null, h('h3.grow', null, 'Sun and shade'), realityTag('live-algo')),
      h('label.area-field', null, h('span', null, 'Time in Nepal, ' + new Date(today.dayUtcMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })), (el.sunVal = h('b.num'))), el.sunRange,
      h('div.row', null, h('button.btn.btn-sm', { onclick: () => setSun(Math.round(nptToday().minutes / 5) * 5) }, 'Now'), h('button.btn.btn-sm', { onclick: () => setSun(630) }, '10:30'), (el.sunWhere = h('span.muted.area-small.grow', { style: { textAlign: 'right' } }))),
      h('label.check', null, (el.shadeChk = h('input', { type: 'checkbox', onchange: (e) => { S.shadows = e.target.checked; paintShadow(); S.view?.setLayer('shadow', S.shadows); } })), 'Cast the terrain’s shadows on the map'),
      h('div', null, (el.sunTitle = h('h4.area-h4')), chart('horizon', 104, 'Chart: the terrain horizon seen from the block and the path of the sun today'), h('div.area-axis', null, h('span', null, 'degrees above level'), h('span', null, 'direction from the block'))),
      (el.sunLine = h('p.area-line')),
      h('p.muted.area-small', null, 'The horizon is measured from the block against the terrain inside this elevation grid (about 4 km each way). Higher ridges farther off are not included, so real direct sun can start a little later.'));

    const layerCheck = (key, label) => h('label.check', null, h('input', { type: 'checkbox', checked: S.layers[key], onchange: (e) => { S.layers[key] = e.target.checked; S.view?.setLayer(key, S.layers[key]); } }), label);
    el['pane-layers'] = h('div.area-pane', { id: 'area-pane-layers', role: 'tabpanel', 'aria-labelledby': 'area-tab-layers', hidden: true },
      h('h3', null, 'What is drawn'),
      layerCheck('flood', 'Flood water (illustrative model)'), layerCheck('buildings', 'Mapped buildings (OpenStreetMap)'), layerCheck('sectors', 'Search sectors, 200 m grid'), layerCheck('exercise', 'The exercise: block, units, leads (simulated)'),
      h('p.muted.area-small', null, 'Mapped buildings turn red when the model puts them in the water and amber when their road link is cut. Their heights are not mapped, so all are drawn 5 m tall.'),
      h('h3', null, 'Sources'),
      h('dl.kv.area-kv', null,
        h('dt', null, 'Elevation'), h('dd', null, dem.source === 'live' ? 'Live tiles, read just now' : 'Saved copy of the same tiles'),
        h('dt', null, 'Grid'), h('dd.num', null, dem.n + ' × ' + dem.n + ', ' + dem.cs.toFixed(1) + ' m cells'),
        h('dt', null, 'Covers'), h('dd.num', null, fmtLat(BOUNDS.south) + ' to ' + fmtLat(BOUNDS.north)),
        h('dt', null, 'Buildings'), h('dd.num', null, impacts.total + ' mapped'),
        h('dt', null, 'Roads and paths'), h('dd.num', null, impacts.roadCount + ' mapped ways')),
      h('p.muted.area-small', null, 'Map data © OpenStreetMap contributors, extracted 23 November 2026. Elevation: Mapzen terrain tiles hosted by AWS (SRTM and other open sources). Imagery © Esri, Maxar, Earthstar Geographics.'));

    const left = h('aside.area-left', { 'aria-label': 'Valley analysis' }, head, h('div.area-card.glass', null, tabBar, ...tabs.map(([t]) => el['pane-' + t])));

    // right: the exercise
    el.sectorGrid = h('div.area-sectors', { role: 'group', 'aria-label': 'Search sectors, west to east and north to south' },
      ...impacts.sectors.map((s) => (s.btn = h('button', { type: 'button', onclick: () => { S.sector = s.id; S.view?.flyTo(s.center, 16); renderSectors(); } }, h('span', null, s.id), h('b.num', null, '')))));
    const right = h('aside.area-right.glass', { 'aria-label': 'The exercise' },
      h('div.row', null, h('h3.grow', null, 'The exercise'), realityTag('sim')),
      h('p.muted.area-small', null, 'A training exercise placed in the real valley after the Bhote Koshi flood of 26 August 2026. The block, the people, the damage and every reading are invented.'),
      (el.phase = h('div.area-phase')),
      h('h4.area-h4', null, 'Units'), (el.units = h('div.area-list')),
      h('h4.area-h4', null, 'Leads and people'), (el.leads = h('div.area-list')),
      h('div.row', null, h('h4.area-h4.grow', null, 'Search sectors'), h('span.dim.area-small', null, 'mapped buildings')), el.sectorGrid, (el.sectorInfo = h('p.area-line')),
      h('div.grow'),
      h('button.btn.btn-primary.btn-lg', { onclick: () => ctx.shell.open('mission') }, icon('mission'), 'Enter the building'));

    // top: tools
    el.styleSeg = h('div.seg', { role: 'group', 'aria-label': 'Map style' }, h('button', { 'aria-pressed': 'true', onclick: () => useView('map') }, 'Satellite'), h('button', { 'aria-pressed': 'false', onclick: () => useView('schematic') }, 'Schematic'));
    el.presets = h('div.seg', { role: 'group', 'aria-label': 'Camera' }, h('button', { onclick: () => S.view?.easeTo({ center: siteCenter, zoom: 13.3, pitch: 58, bearing: 12 }, 2200) }, 'Valley'), h('button', { onclick: () => S.view?.easeTo(M.home, 1800) }, 'Block'), h('button', { onclick: () => S.view?.easeTo({ center: siteCenter, zoom: 17.1, pitch: 0, bearing: 0 }, 1500) }, 'Overhead'));
    el.measureBtn = h('button.btn', { 'aria-pressed': 'false', onclick: () => setMeasuring(!S.measuring) }, icon('route'), 'Measure');
    el.replay = h('button.btn.btn-icon', { 'aria-label': 'Replay the fly-in down the valley', title: 'Replay the fly-in down the valley', onclick: () => flyIn() }, icon('play'));
    const tools = h('div.area-tools.glass', { role: 'toolbar', 'aria-label': 'Map tools' }, el.styleSeg, el.presets, el.measureBtn, el.replay);

    // bottom: profile, readout, credit
    el.profCanvas = h('canvas.area-chart', { style: { height: '132px' }, role: 'img', 'aria-label': 'Elevation along the drawn line' });
    el.profile = h('section.area-profile.glass', { hidden: true, 'aria-label': 'Measure and terrain profile' },
      h('div.row', null, (el.profTitle = h('h3.grow', null, 'Measure')), realityTag('live-algo'),
        h('button.btn.btn-sm', { onclick: crossSection }, 'Cross-section at the block'), (el.profDone = h('button.btn.btn-sm', { onclick: finishLine }, 'Finish line')), h('button.btn.btn-sm.btn-ghost', { onclick: () => { clearLine(); } }, 'Clear'),
        h('button.btn.btn-sm.btn-ghost.btn-icon', { 'aria-label': 'Close the measuring tool', onclick: () => setMeasuring(false) }, icon('close'))),
      (el.profHint = h('p.muted', null, 'Click the map to place points. The elevation along the line appears here.')),
      (el.profStats = h('div.area-profstats', { hidden: true })), el.profCanvas);
    el.profCanvas.hidden = true;
    el.readout = h('div.area-readout.glass.num', { 'aria-live': 'off' }, 'Point at the map for position, elevation and slope');
    el.credit = h('div.area-credit');
    el.caption = h('div.area-caption', { hidden: true });
    el.banner = h('div.area-banner', { hidden: true });
    const bottom = h('div.area-bottom', null, el.profile, h('div.area-strip', null, el.readout, el.credit));
    loading.remove();
    root.append(left, right, tools, el.banner, el.caption, bottom);

    // ------------------------------------------------------------------ flood
    const stageAt = (s) => { // water level along the river while a surge passes
      const x = S.surge.front - s; return S.stage + SURGE.height * (x < 0 ? Math.exp(-((x / SURGE.front) ** 2)) : Math.exp(-x / SURGE.tail));
    };
    const blockNeed = (() => { let best = Infinity; for (let y = 0; y <= SITE.h; y += 6) for (let x = 0; x <= SITE.w; x += 6) { const k = dem.cell(...frame.ll([x, y])); if (k >= 0 && model.need[k] < best) best = model.need[k]; } return best; })();
    let lastImpact = null;
    function paintWater(time) {
      const res = T.paintFlood(model, floodImg, S.surge ? stageAt : S.stage, time, prevUpto);
      prevUpto = res.upto;
      floodCtx.putImageData(floodImg, 0, 0, box[0], box[1], box[2] - box[0] + 1, box[3] - box[1] + 1);
      return res;
    }
    let shoreFC = FC();
    function drawShore() { shoreFC = S.stage > 0 || S.surge ? T.shoreline(model, box, S.surge ? stageAt : S.stage, contours) : FC(); S.view?.setData('shore', shoreFC); }
    function applyImpacts(painted) {
      const level = S.surge ? stageAt : S.stage, r = impacts.compute(level); lastImpact = r;
      const wetCells = painted ? painted.cells : model.countBelow(S.stage);
      el.fArea.textContent = ((wetCells * model.cellArea) / 1e4).toFixed(1);
      el.fRoad.textContent = fmtDist(r.roadWet); el.fWet.textContent = r.wet; el.fCut.textContent = r.cut;
      if (r.changes.length) S.view?.setBuildingStates(r.changes);
      S.view?.setData('cut', r.cutFC);
      el.cuts.replaceChildren(...(r.cuts.length ? r.cuts.slice(0, 5).map((c) => h('button.area-row', { type: 'button', onclick: () => S.view?.flyTo(c.ll, 16.4), title: 'Fly to this road section' }, h('i.area-dot.danger'), h('span.grow', null, c.name), h('span.num', null, fmtDist(c.len)))) : [h('p.muted.area-small', null, S.stage > 0 || S.surge ? 'No mapped road is under water at this level.' : 'Raise the water level to see which roads go under.')]),
        ...(r.cuts.length > 5 ? [h('p.dim.area-small', null, 'and ' + (r.cuts.length - 5) + ' shorter sections')] : []));
      el.fBlock.replaceChildren(...(blockNeed === Infinity ? [h('b', null, 'The block stays dry'), ' at every level this model covers (up to +' + T.MAX_STAGE + ' m).']
        : S.stage > blockNeed && !S.surge ? [h('b', null, 'Water reaches the block.'), ' Its lowest corner goes under at +' + blockNeed.toFixed(1) + ' m.']
          : ['Water reaches the block’s lowest corner at ', h('b.num', null, '+' + blockNeed.toFixed(1) + ' m'), '. It is ' + (blockNeed - S.stage).toFixed(1) + ' m above the water now.']));
      renderSectors(); refreshProfile();
    }
    function setStage(v) {
      S.stage = v; el.stageRange.value = v; fill(el.stageRange); el.stageVal.textContent = '+' + v.toFixed(1) + ' m';
      el.stageRange.setAttribute('aria-valuetext', v.toFixed(1) + ' metres above the river');
      const painted = paintWater(reducedMotion() ? 0 : performance.now() / 1000);
      S.view?.refreshOverlay('flood'); drawShore(); syncAnimation(); applyImpacts(S.surge ? painted : null); drawStageCurve(el.curve, model, S.stage, T.MAX_STAGE);
    }
    function startSurge() {
      S.surge = { t0: performance.now() / 1000, front: model.sMin - 800, peak: 0 };
      el.surgeBtn.textContent = 'Stop the surge'; syncAnimation();
      if (reducedMotion()) { S.surge.front = (model.sMin + model.sMax) / 2; const p = paintWater(0); S.view?.refreshOverlay('flood'); drawShore(); applyImpacts(p); }
    }
    function endSurge() {
      if (!S.surge) return; const peak = S.surge.peak; S.surge = null; el.surgeBtn.textContent = 'Send a surge down the valley';
      if (peak) ctx.shell.toast('Surge passed. At its peak about ' + peak.toFixed(0) + ' hectares were under water in this illustrative model.', { level: 'info' });
      setStage(S.stage);
    }

    // ------------------------------------------------------------------ sun
    const sunAt = (min) => sunPosition(nptDate(today.dayUtcMs, min), siteCenter[1], siteCenter[0]);
    const sunPath = []; for (let m = 0; m < 1440; m += 5) sunPath.push({ min: m, ...sunAt(m) });
    const lit = sunPath.filter((p) => p.alt > 0 && p.alt > horizon[Math.round(p.az) % 360]), up = sunPath.filter((p) => p.alt > 0);
    let shadowJob = 0;
    function paintShadow() {
      if (!S.shadows) return;
      cancelAnimationFrame(shadowJob);
      shadowJob = requestAnimationFrame(() => {
        const g = T.shadowGrid(coarse, M.sun.az, M.sun.alt), tmp = mk(coarse.n), tc = tmp.getContext('2d'), img = tc.createImageData(coarse.n, coarse.n);
        for (let k = 0; k < g.length; k++) if (g[k]) { img.data[k * 4] = 4; img.data[k * 4 + 1] = 9; img.data[k * 4 + 2] = 18; img.data[k * 4 + 3] = 215; }
        tc.putImageData(img, 0, 0);
        const c = M.canvases.shadow.getContext('2d'); c.clearRect(0, 0, coarse.n, coarse.n); c.filter = 'blur(1.1px)'; c.drawImage(tmp, 0, 0); c.filter = 'none';
        S.view?.refreshOverlay('shadow');
      });
    }
    function setSun(min) {
      S.minutes = min; el.sunRange.value = min; fill(el.sunRange); M.sun = sunAt(min);
      el.sunVal.textContent = fmtClock(min); el.sunRange.setAttribute('aria-valuetext', fmtClock(min) + ' Nepal time');
      const here = M.sun.alt > 0 && M.sun.alt > horizon[Math.round(M.sun.az) % 360];
      el.sunWhere.textContent = M.sun.alt <= 0 ? 'Sun below the horizon' : 'Sun ' + Math.round(M.sun.alt) + '° up, to the ' + compass(M.sun.az);
      el.sunLine.replaceChildren(...(M.sun.alt <= 0 ? ['The sun is below the horizon at the block.'] : here ? [h('b', null, 'The block is in direct sun'), ' at ' + fmtClock(min) + '.'] : [h('b', null, 'The block is in the shadow of the ridge'), ' to the ' + compass(M.sun.az) + ' at ' + fmtClock(min) + '.']));
      S.view?.setSun(M.sun.az, M.sun.alt); paintShadow(); drawHorizon(el.horizon, horizon, sunPath, M.sun);
    }
    el.sunTitle.textContent = lit.length ? 'Ridges hide the sun from the block until ' + fmtClock(lit[0].min) + ' and after ' + fmtClock(lit[lit.length - 1].min + 5) : 'The sun does not clear the ridges at the block today';
    if (up.length && lit.length) el.sunTitle.title = 'With a flat horizon the sun would be up from ' + fmtClock(up[0].min) + ' to ' + fmtClock(up[up.length - 1].min + 5) + ' (Nepal time).';

    // ------------------------------------------------------------------ sectors and the exercise panel
    function renderSectors() {
      const st = ctx.sim.state, phase = ctx.PHASE_INFO[st.phase].label;
      const feats = [], labels = [];
      for (const s of impacts.sectors) {
        const status = s.home ? 'active' : s.wet + s.cut > 0 ? 'wet' : s.buildings ? 'wait' : 'none';
        s.btn.className = 'st-' + status + (s.id === S.sector ? ' sel' : ''); s.btn.lastChild.textContent = s.buildings || '';
        s.btn.setAttribute('aria-pressed', String(s.id === S.sector));
        s.text = s.home ? 'This exercise: ' + phase.toLowerCase() : s.wet + s.cut > 0 ? s.wet + ' in the water, ' + s.cut + ' cut off at this level' : s.buildings ? 'Not assigned in this exercise' : 'No mapped buildings';
        s.btn.setAttribute('aria-label', 'Sector ' + s.id + ': ' + s.buildings + ' mapped buildings. ' + s.text);
        feats.push(feat('Polygon', [s.ring], { id: s.id, st: status })); labels.push(feat('Point', s.center, { id: s.id, st: status }));
      }
      const s = impacts.sectors.find((x) => x.id === S.sector);
      el.sectorInfo.replaceChildren(h('b', null, 'Sector ' + s.id + '. '), s.text + '. ', h('span.muted', null, s.buildings + ' mapped buildings, ' + Math.round((s.steep / (s.cells || 1)) * 100) + ' % of the ground steeper than 35°' + (s.wetCells ? ', ' + Math.round((s.wetCells / (s.cells || 1)) * 100) + ' % under water' : '') + '.'));
      const key = feats.map((f) => f.properties.st).join();
      if (key !== renderSectors.key) { renderSectors.key = key; S.sectorFC = FC(feats); S.sectorLabelFC = FC(labels); S.view?.setData('sectors', S.sectorFC); S.view?.setData('sectorLabels', S.sectorLabelFC); }
    }
    let panelKey = '';
    function renderExercise() {
      const st = ctx.sim.state, info = ctx.PHASE_INFO[st.phase], sel = ctx.selection;
      const dets = st.detections.filter((d) => d.status !== 'rejected' && !d.dismissed);
      const key = [st.phase, st.hold, sel?.type, sel?.id, ...Object.values(st.units).map((u) => u.mode), ...dets.map((d) => d.id + d.status + Math.round(d.p * 100))].join('|');
      if (key === panelKey) return; panelKey = key;
      el.phase.replaceChildren(h('b', null, st.hold ? 'All stop' : info.label), h('span.muted', null, st.started ? info.hint : 'The mission has not started. Enter the building to start it.'));
      el.units.replaceChildren(...Object.values(st.units).map((u) => h('button.area-row', { type: 'button', 'aria-pressed': String(sel?.type === 'unit' && sel.id === u.id), onclick: () => { ctx.select({ type: 'unit', id: u.id }); S.view?.flyTo(frame.ll(u.pos), 17.6); } },
        h('i.area-ic', null, icon(u.kind === 'team' ? 'person' : u.kind, 15)), h('span.grow', null, u.name), h('span.muted', null, MODE_WORDS[u.mode] || u.mode), u.built ? null : h('span.tag.tag-sim.plain', { title: u.kind === 'drone' ? 'The drone is a concept. Only the rover exists.' : 'The rescue team is simulated.' }, u.kind === 'drone' ? 'Concept' : 'Simulated'))));
      el.leads.replaceChildren(...(dets.length ? dets.map((d) => h('button.area-row', { type: 'button', 'aria-pressed': String(sel?.type === 'detection' && sel.id === d.id), onclick: () => { ctx.select({ type: 'detection', id: d.id }); S.view?.flyTo(frame.ll(d.pos), 17.8); } },
        h('i.area-dot.' + (d.status === 'confirmed' ? 'person' : 'warn')), h('span.grow', null, (d.status === 'confirmed' ? 'Person' : 'Possible person') + (d.room ? ', room ' + d.room : d.outdoor ? ', outdoors' : '')), h('span.num', null, Math.round(d.p * 100) + ' %')))
        : [h('p.muted.area-small', null, st.started ? 'Nothing found yet. The drone looks first, then the rover listens room by room.' : 'No leads yet. They appear here and on the map as the search finds them.')]));
    }

    // ------------------------------------------------------------------ measure and profile
    function measureFC() {
      const f = S.pts.map((p) => feat('Point', p, { kind: 'vertex' }));
      if (S.pts.length > 1) f.push(feat('LineString', S.pts, { kind: 'line' }));
      if (S.measuring && !S.lineDone && S.pts.length && S.hover) f.push(feat('LineString', [S.pts[S.pts.length - 1], S.hover], { kind: 'rubber' }));
      if (S.probe) f.push(feat('Point', S.probe, { kind: 'probe' }));
      return FC(f);
    }
    function refreshProfile(hoverDist = null) {
      if (!S.prof) return;
      const level = S.surge ? stageAt : S.stage;
      const water = S.stage > 0 || S.surge ? S.prof.samples.map((p) => { const k = dem.cell(p.ll[0], p.ll[1]); if (k < 0) return -Infinity; const hh = typeof level === 'number' ? level : level(model.s[k]); return model.need[k] < hh ? p.z + (hh - model.rel[k]) : -Infinity; }) : null;
      const hit = drawProfile(el.profCanvas, S.prof, water, hoverDist);
      const probe = hoverDist != null && hit?.ll ? hit.ll : null;
      if (probe !== S.probe) { S.probe = probe; S.view?.setData('measure', measureFC()); }
    }
    function updateLine() {
      S.view?.setData('measure', measureFC());
      const has = S.pts.length > 1;
      el.profCanvas.hidden = !has; el.profStats.hidden = !has; el.profHint.hidden = has; el.profDone.hidden = !has || S.lineDone;
      if (!has) { S.prof = null; el.profTitle.textContent = 'Measure'; el.profHint.textContent = S.pts.length ? 'Click the next point. Distances and the elevation profile appear as you go.' : 'Click the map to place points, or draw a ready-made line across the valley at the block.'; return; }
      S.prof = T.profile(dem, S.pts);
      const p = S.prof, z0 = p.samples[0].z, z1 = p.samples[p.samples.length - 1].z;
      el.profTitle.textContent = fmtDist(p.length) + ' on the map, ' + fmtDist(p.surface) + ' over the ground';
      const cell = (label, value) => h('div', null, h('span', null, label), h('b.num', null, value));
      el.profStats.replaceChildren(cell('Climb', '+' + Math.round(p.up) + ' m'), cell('Descent', '−' + Math.round(p.down) + ' m'), cell('Start to end', (z1 >= z0 ? '+' : '−') + Math.abs(Math.round(z1 - z0)) + ' m'), cell('Steepest stretch', Math.round(p.steep) + '°'), cell('Points', String(S.pts.length)),
        h('span.area-key', null, h('i.k-steep'), '35° or steeper', h('i.k-water'), 'water at this level'));
      requestAnimationFrame(() => refreshProfile());
    }
    function setMeasuring(on) {
      S.measuring = on; el.measureBtn.setAttribute('aria-pressed', String(on)); el.profile.hidden = !on; stage.classList.toggle('measuring', on);
      if (!on) { S.pts = []; S.lineDone = false; S.hover = null; S.probe = null; }
      updateLine(); applyPadding();
    }
    function clearLine() { S.pts = []; S.lineDone = false; S.probe = null; updateLine(); }
    function finishLine() { S.lineDone = true; S.hover = null; updateLine(); }
    function crossSection() {
      // a line across the valley through the block, at right angles to the river there: west bank to the east slope
      S.pts = [frame.ll([-520, SITE.h / 2 + 60]), frame.ll([SITE.w / 2, SITE.h / 2]), frame.ll([SITE.w + 420, SITE.h / 2 - 40])]; S.lineDone = true;
      updateLine(); S.view?.easeTo({ center: siteCenter, zoom: 15.2, pitch: 50, bearing: 0 }, 1400);
    }
    el.profCanvas.addEventListener('pointermove', (e) => S.prof && refreshProfile(profileDist(el.profCanvas, S.prof, e.clientX)));
    el.profCanvas.addEventListener('pointerleave', () => refreshProfile());

    function onMapClick(ll) { if (!S.measuring) return; if (S.lineDone) { S.pts = []; S.lineDone = false; } S.pts.push(ll); updateLine(); }
    let moveJob = 0, lastMove = null;
    function onMapMove(ll) {
      lastMove = ll; if (moveJob) return;
      moveJob = requestAnimationFrame(() => {
        moveJob = 0; const p = lastMove, z = dem.at(p[0], p[1]);
        if (!(z === z)) { el.readout.textContent = fmtLat(p[1]) + '  ' + fmtLon(p[0]) + '   outside the elevation grid'; return; }
        const k = dem.cell(p[0], p[1]), above = model.need[k] < Infinity || model.rel[k] > 0 ? '   ' + Math.round(model.rel[k]) + ' m above the river' : '';
        el.readout.textContent = fmtLat(p[1]) + '  ' + fmtLon(p[0]) + '   ' + Math.round(z).toLocaleString('en') + ' m   slope ' + Math.round(slope[k]) + '°' + above;
        if (S.measuring && !S.lineDone && S.pts.length) { S.hover = p; S.view?.setData('measure', measureFC()); }
      });
    }

    // ------------------------------------------------------------------ views
    const views = {};
    function applyPadding() {
      if (!S.view) return;
      const r = root.getBoundingClientRect(), wide = r.width > 900;
      S.view.setPadding({ left: wide ? left.offsetWidth + 12 : 0, right: wide ? right.offsetWidth + 12 : 0, top: 56, bottom: 44 + (S.measuring ? el.profile.offsetHeight + 8 : 0) });
    }
    function pushAll() {
      const v = S.view, st = ctx.sim.state;
      v.setData('exs', exStatic); v.setData('ex', exDynamic(st)); v.setData('measure', measureFC());
      if (S.sectorFC) { v.setData('sectors', S.sectorFC); v.setData('sectorLabels', S.sectorLabelFC); }
      if (lastImpact) v.setData('cut', lastImpact.cutFC);
      v.setData('shore', shoreFC);
      v.setBuildingStates(impacts.buildings.filter((b) => b.st !== 'ok').map((b) => [b.id, b.st]));
      for (const [k, on] of Object.entries(S.layers)) v.setLayer(k, on);
      v.setLayer('slope', S.slope); v.setLayer('shadow', S.shadows);
      v.setSun(M.sun.az, M.sun.alt); v.setMarkers(markerList(st));
      v.refreshOverlay('flood'); v.refreshOverlay('slope'); v.refreshOverlay('shadow');
      applyPadding(); onView();
    }
    function onView() { const far = S.view.camera().zoom < 15.4; if (far !== stage.classList.contains('far')) stage.classList.toggle('far', far); }
    function wire(v) { v.on('click', onMapClick); v.on('move', onMapMove); v.on('leave', () => { el.readout.textContent = 'Point at the map for position, elevation and slope'; }); v.on('view', onView); return v; }
    function credit() {
      el.credit.replaceChildren(...(S.view?.kind === 'map'
        ? ['Imagery © Esri, Maxar · Terrain: Mapzen, AWS · ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, '© OpenStreetMap'), ', OpenFreeMap']
        : ['Terrain: Mapzen, AWS' + (dem.source === 'saved' ? ' (saved copy)' : '') + ' · ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, '© OpenStreetMap'), ' · contours every 100 m']));
    }
    async function useView(kind, { silent = false } = {}) {
      if (S.switching || (S.view && S.view.kind === kind)) return;
      S.switching = true;
      const cam = S.view?.camera();
      try {
        if (kind === 'map' && !views.map) {
          if (navigator.onLine === false) throw new Error('This computer is offline.');
          mapHost.hidden = false;
          const { createMapView } = await import('./map.js');
          views.map = wire(await createMapView(mapHost, M, { onFail: (why) => fallBack(why) }));
        }
        if (kind === 'schematic' && !views.schematic) { const { createSchematic } = await import('./schematic.js'); schemHost.hidden = false; views.schematic = wire(createSchematic(schemHost, M)); }
      } catch (e) { S.switching = false; if (kind === 'map') { mapHost.hidden = true; return fallBack(String(e.message || e)); } throw e; }
      S.view?.stop(); S.view?.animateFlood(false);
      S.view = views[kind]; mapHost.hidden = kind !== 'map'; schemHost.hidden = kind !== 'schematic';
      [...el.styleSeg.children].forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0) === (kind === 'map'))));
      el.replay.disabled = false; el.exRange.disabled = kind !== 'map';
      if (kind === 'map' && !silent) { S.fail = null; el.banner.hidden = true; }
      S.view.resize(); pushAll(); credit();
      if (cam) S.view.easeTo(kind === 'map' ? { ...M.home, center: cam.center, zoom: cam.zoom } : cam, 0);
      if (S.shown) { S.view.start(); syncAnimation(); }
      S.switching = false;
    }
    async function fallBack(why) {
      S.fail = why;
      el.banner.replaceChildren(icon('alert'), h('span', null, h('b', null, 'Showing the schematic. '), why + ' The valley below is drawn from the saved elevation grid and OpenStreetMap extract, so every tool still works.'),
        h('button.btn.btn-sm', { onclick: async () => { if (views.map) { views.map.destroy(); views.map = null; mapHost.replaceChildren(); } await useView('map'); } }, 'Try the satellite map again'));
      el.banner.hidden = false;
      if (S.view?.kind === 'map') { const dead = views.map; S.view = null; views.map = null; dead.destroy(); mapHost.replaceChildren(); }
      S.switching = false; await useView('schematic', { silent: true });
    }

    // ------------------------------------------------------------------ the fly-in
    const flightPath = (() => {
      const lende = osm.rivers.find((r) => r.name === 'Lende Khola')?.g || [], main = osm.rivers.find((r) => r.main).g;
      let best = 0, bd = Infinity; main.forEach((p, i) => { const d = haversine(p, siteCenter); if (d < bd) { bd = d; best = i; } });
      const raw = [...lende, ...main.slice(1, best + 1)], dense = [];
      for (let i = 1; i < raw.length; i++) { const steps = Math.max(1, Math.round(haversine(raw[i - 1], raw[i]) / 60)); for (let q = 0; q < steps; q++) dense.push([raw[i - 1][0] + ((raw[i][0] - raw[i - 1][0]) * q) / steps, raw[i - 1][1] + ((raw[i][1] - raw[i - 1][1]) * q) / steps]); }
      const w = 14, smooth = dense.map((_, i) => { let x = 0, y = 0, c = 0; for (let q = Math.max(0, i - w); q <= Math.min(dense.length - 1, i + w); q++) { x += dense[q][0]; y += dense[q][1]; c++; } return [x / c, y / c]; });
      return { path: [...smooth, siteCenter], joinAt: lende.length ? haversine(lende[0], lende[lende.length - 1]) : 0 };
    })();
    async function flyIn() {
      if (!S.view) return;
      if (reducedMotion()) { S.view.easeTo(M.home, 0); return; }
      const p = flightPath.path;
      el.caption.hidden = false; root.classList.add('flying');
      const done = await S.view.flyIn({ path: p, from: { center: p[0], zoom: 11.3, pitch: 38, bearing: 215 }, to: M.home, duration: 16000,
        onProgress: (e, c) => {
          const z = dem.at(c[0], c[1]), far = haversine(c, siteCenter), name = e > 0.86 ? 'Timure, Rasuwa, Nepal' : far > haversine(p[0], siteCenter) * 0.42 ? 'Lende Khola, above the border at Rasuwagadhi' : 'Bhote Koshi river, flowing south';
          const text = name + (z === z && e <= 0.86 ? '  ·  river at ' + Math.round(z).toLocaleString('en') + ' m  ·  ' + fmtDist(far) + ' to the block' : e > 0.86 ? '  ·  the exercise block (simulated)' : '  ·  ' + fmtDist(far) + ' to the block');
          if (el.caption.textContent !== text) el.caption.textContent = text;
        } });
      root.classList.remove('flying'); el.caption.hidden = true;
      return done;
    }

    // ------------------------------------------------------------------ loop and bus
    let raf = 0, lastStats = 0, lastEx = 0, lastShore = 0;
    const moving = () => S.shown && !reducedMotion() && S.layers.flood && (S.stage > 0 || S.surge);
    function syncAnimation() { const on = !!moving(); S.view?.animateFlood(on); if (on && !raf) raf = requestAnimationFrame(tick); }
    function tick(now) {
      raf = 0; if (!moving()) { S.view?.animateFlood(false); return; }
      raf = requestAnimationFrame(tick);
      const t = now / 1000;
      if (S.surge) { S.surge.front = model.sMin - 800 + (t - S.surge.t0) * SURGE.speed; if (S.surge.front > model.sMax + SURGE.tail * 3.2) { endSurge(); return; } }
      const painted = paintWater(t);
      if (S.view?.kind === 'schematic') S.view.refreshOverlay('flood');
      if (S.surge && now - lastShore > 70) { lastShore = now; drawShore(); }
      if (S.surge && now - lastStats > 180) { lastStats = now; const ha = (painted.cells * model.cellArea) / 1e4; if (ha > S.surge.peak) S.surge.peak = ha; applyImpacts(painted); }
    }
    function onTick() {
      if (!S.shown || !S.view) return;
      const st = ctx.sim.state, now = performance.now();
      S.view.setMarkers(markerList(st));
      if (now - lastEx > 250) { lastEx = now; S.view.setData('ex', exDynamic(st)); renderExercise(); if (renderSectors.phase !== st.phase) { renderSectors.phase = st.phase; renderSectors(); } }
    }
    const full = () => { lastEx = 0; panelKey = ''; onTick(); };
    const offs = [ctx.bus.on('tick', onTick), ctx.bus.on('reset', full), ctx.bus.on('seek', full), ctx.bus.on('select', (sel) => { full(); if (S.shown && sel?.type === 'unit') { /* highlighted through markerList */ } }),
      ctx.bus.on('escape', () => { if (!S.shown) return; S.view?.cancelFlight(); if (S.measuring) (S.pts.length && !S.lineDone ? clearLine() : setMeasuring(false)); }),
      ctx.bus.on('prefs', () => { redrawCharts(); syncAnimation(); })];
    root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && S.measuring && S.pts.length > 1 && !S.lineDone && e.target.tagName !== 'BUTTON') finishLine(); });
    function redrawCharts() { drawStageCurve(el.curve, model, S.stage, T.MAX_STAGE); drawHorizon(el.horizon, horizon, sunPath, M.sun); refreshProfile(); }
    new ResizeObserver(() => { if (S.shown) { applyPadding(); redrawCharts(); } }).observe(root);

    // ------------------------------------------------------------------ start
    renderSectors(); renderExercise(); setSun(S.minutes); setStage(0); fill(el.exRange);
    await useView(forced ? 'schematic' : 'map');
    if (forced && !S.fail) { el.banner.replaceChildren(icon('info'), h('span', null, h('b', null, 'Schematic view. '), navigator.onLine === false ? 'This computer is offline, so the valley is drawn from the saved elevation grid and OpenStreetMap extract.' : 'Drawn from the saved elevation grid and OpenStreetMap extract.')); el.banner.hidden = false; }
    root.__area = { S, M, model, impacts, setStage, setSun, startSurge, flyIn, useView, setMeasuring, crossSection, fallBack };

    return {
      onShow() {
        S.shown = true; S.view?.resize(); S.view?.start(); applyPadding(); full(); requestAnimationFrame(redrawCharts); syncAnimation();
        if (!S.flew) { S.flew = true; if (S.view?.kind === 'map' && !query.has('nofly')) flyIn(); }
      },
      onHide() { S.shown = false; cancelAnimationFrame(raf); raf = 0; S.view?.animateFlood(false); S.view?.stop(); root.classList.remove('flying'); el.caption.hidden = true; },
      onParams(p) { if (p?.stage != null) setStage(Math.max(0, Math.min(T.MAX_STAGE, +p.stage))); },
    };
  },
};
