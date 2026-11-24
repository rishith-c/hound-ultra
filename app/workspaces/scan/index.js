// 3-D scan workspace: a drone or phone scan becomes a map the mission can use, and a search for survivable voids.
// What is real here: every algorithm (ground fit, classification, void search, occupancy map, route planning) runs
// live in the browser on the points. What is simulated: the scan itself (see scene.js), unless you drop your own file.
import { createView, HEIGHT_RAMP, TIME_RAMP } from './view.js';
import { CLASSES, OCC, compass } from './analyze.js';
import { writePLY, planToJSON, planFromJSON } from './io.js';
import { createPlanEditor, EXAMPLE_PLAN } from './plan.js';
import { PLAN_MARGIN } from './scene.js';
import { createHero, ACTS } from './hero.js';
import { createStrip } from './strip.js';
import { decode } from './bake.js';

let bakeP = null; // the film's scan, worked out beforehand (bake.js): nothing is computed when the Demo opens
if (document.documentElement.dataset.mode === 'demo') queueMicrotask(() => getBake().catch(() => {}));
const getBake = () => (bakeP = bakeP || fetch(new URL('./samples/site-film.bin', import.meta.url)).then((r) => { if (!r.ok) throw new Error('The recorded scan is missing.'); return decode(r); }).catch((e) => { bakeP = null; throw e; }));
import { planPath } from '../../core/planner.js';
import { pointInPoly } from '../../core/geometry.js';

const STEPS = [
  { id: 'capture', n: 1, title: 'Capture', say: 'Fly the scanner. Watch the cloud build.' },
  { id: 'classify', n: 2, title: 'Classify', say: 'Four kinds of surface.' },
  { id: 'voids', n: 3, title: 'Find voids', say: 'Spaces to search.' },
  { id: 'map', n: 4, title: 'Make the map', say: 'For the route planner.' },
];
const CLASS_SAY = ['Within 18 cm of the fitted ground surface.', 'Flat or upright planes: walls, roofs, ceilings.', 'Rough, tilted or low loose material, including overturned furniture.', 'Scattered returns high above ground with nothing flat nearby.'];
const TRUTH_ROWS = ['Ground', 'Structure', 'Rubble', 'Vegetation', 'Furniture, vehicles'];

function createClient() {
  let worker = null, seq = 0, direct = null; const pending = new Map();
  const runDirect = async (op, payload, progress) => { direct = direct || (await import('./compute.js')); return direct.handle(op, payload, progress); };
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const m = e.data; if (m.ready) return; const p = pending.get(m.id); if (!p) return; if (m.progress != null) p.progress(m.progress, m.text, m.partial); else { pending.delete(m.id); if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result); } };
    worker.onerror = (e) => { e.preventDefault?.(); worker = null; for (const [id, p] of pending) { pending.delete(id); if (p.transfer) p.reject(new Error('The background worker stopped. Drop the file again.')); else runDirect(p.op, p.payload, p.progress).then(p.resolve, p.reject); } };
  } catch { worker = null; }
  return {
    get threaded() { return !!worker; },
    run(op, payload, progress = () => {}, transfer = []) {
      if (!worker) return runDirect(op, payload, progress);
      return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject, progress, op, payload, transfer: transfer.length > 0 }); worker.postMessage({ id, op, payload }, transfer); });
    },
    dispose() { worker?.terminate(); },
  };
}

export default {
  async mount(root, ctx) {
    const { h, icon, realityTag, fmt, cssVar } = ctx.kit, world = ctx.world;
    if (ctx.mode === 'demo') getBake().catch(() => {});
    if (!document.querySelector('link[data-scan-css]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href, 'data-scan-css': '' }));
    const reduced = () => ctx.kit.reducedMotion();
    const N = (v) => Math.round(v).toLocaleString('en-US');
    const client = createClient();
    const S = { source: 'site', step: 'capture', data: null, mode: 'natural', prevMode: 'natural', replay: { t: null, playing: false, speed: 24 }, played: false, auto: true, sel: -1, vp: { minH: 0.5, minL: 1.2, whole: false }, compare: null, mapView: 'diff', overlay: true, route: null, leads: [], file: null, up: 'auto', busy: false, error: null, planScanned: false, shown: false, diffSel: null };

    // ------------------------------------------------------------------ skeleton
    const tagSource = h('span');
    const srcSeg = h('div.seg', { role: 'group', 'aria-label': 'Where the scan comes from' });
    const SOURCES = [['site', 'Exercise site'], ['file', 'Your file'], ['plan', 'Floor plan']];
    const btnShot = h('button.btn.btn-sm', { title: 'Save a picture of this view', onclick: screenshot }, icon('download'), 'Screenshot');
    const btnPly = h('button.btn.btn-sm.btn-ghost', { title: 'Download the cloud as a binary .ply with intensity and class per point', onclick: exportPly }, 'Export .ply');
    const head = h('header.scan-head.adv-only', null,
      h('div.scan-title', null, h('h1', null, '3-D scan'), h('p.muted', null, 'A map for the mission, and spaces to search.')),
      h('div.scan-tags', null, realityTag('live-algo'), tagSource), h('div.grow'), srcSeg, btnShot, btnPly);
    const steps = h('nav.scan-steps.adv-only', { 'aria-label': 'From scan to map' });
    const stage = h('div.scan-stage'), dock = h('aside.scan-dock.adv-only', { 'aria-label': 'Step details' });
    root.classList.add('scan'); root.append(head, steps, h('div.scan-body', null, stage, dock));

    const colors = { glow: '#d6e8fb', accent: cssVar('--accent'), warn: cssVar('--warn'), person: cssVar('--person'), ok: cssVar('--ok'), text3: cssVar('--text-3'), bg0: cssVar('--bg-0'), bg1: cssVar('--bg-2') };
    const view = createView(stage, { colors, reduced: reduced() });
    const classColors = () => ['#6a7684', '#8fb8e8', cssVar('--warn'), cssVar('--ok')];
    view.setClassColors(classColors());

    // HUD over the view
    const modeSeg = h('div.seg', { role: 'group', 'aria-label': 'Colour the points by' });
    const legend = h('div.scan-legend');
    const hudTL = h('div.scan-hud.scan-hud-tl.glass', null, h('div.row', null, h('span.dim', null, 'Colour'), modeSeg), legend);
    const statLine = h('div.scan-hud.scan-hud-tr.glass.num', { 'aria-live': 'off' });
    const tools = h('div.scan-hud.scan-tools.glass', { role: 'toolbar', 'aria-label': 'View tools' });
    const sectionBar = h('div.scan-hud.scan-sectionbar.glass', { hidden: true });
    const scale = h('div.scan-scale', null, h('i'), h('span.num'));
    const compassEl = h('div.scan-compass', { title: 'North' }, h('i'), h('span', null, 'N'));
    const transport = h('div.scan-hud.scan-transport.glass', { hidden: true });
    const veil = h('div.scan-veil', { hidden: true });
    const dropVeil = h('div.scan-drop', { hidden: true }, h('div', null, icon('upload', 28), h('b', null, 'Drop the scan to load it'), h('span.muted', null, '.ply (ASCII or binary little-endian) or .xyz')));
    const planHost = h('div.scan-planhost', { hidden: true });
    const measureTip = h('div.scan-hud.scan-tip.glass', { hidden: true });
    stage.append(hudTL, statLine, tools, sectionBar, scale, compassEl, transport, measureTip, planHost, veil, dropVeil);
    for (const el of [hudTL, statLine, tools, sectionBar, scale, compassEl, transport, measureTip, planHost]) el.classList.add('adv-only');

    // ------------------------------------------------------------------ Demo: one film, full bleed, over the same view
    const film = { hero: null, title: h('h1'), say: h('p'), act: h('button.btn.btn-primary', { onclick: () => filmAction() }), dots: h('div.scan-film-dots', { role: 'group', 'aria-label': 'Chapters of the film' }), fig: [0, 1, 2].map(() => h('b.num')), cap: [], last: '', strip: createStrip(h, cssVar, realityTag('sim')), rate: 0 };
    film.title.append('Room to ', h('em', null, 'survive'));
    const filmBox = h('section.scan-film.demo-only', { 'aria-label': 'Void finder film' },
      h('div.scan-film-text', null, h('div.scan-film-tags', null, film.src = h('span.tag.tag-sim', { title: 'A virtual scanner was flown through a model of the site. The drone and its lidar are a concept.' }, 'Simulated scan'), film.algo = h('span')), film.title, film.say, h('div.row', null, film.act, film.dots)),
      h('div.scan-film-right', null, film.strip.el, h('div.scan-film-figs', null, [0, 1, 2].map((i) => h('div', null, film.fig[i], film.cap[i] = h('span'))))));
    stage.append(filmBox);
    const PASS_SAY = { aerial: 'A drone sweeps the site. Every beam that returns becomes a point.', orbit: 'It circles the collapse and looks in from the side.', close: 'Closer, for the cables, bars and bent roof sheets.', interior: 'Then inside, through every open door.', survey: 'A drone sweeps the building.', all: 'A simulated scan: every point is one beam that came back.' };
    // on the exercise site the roofs stand to the south, so look at the collapses from the north, as the film does
    function openSide(i) { const d = S.data; return d.kind !== 'site' ? undefined : d.voids.list[i].centre[0] > 88 ? 342 : 36; }
    function filmSay() {
      const s = film.hero.S, d = filmData(), v = s.cur && s.cur.v;
      if (s.act === 'scan' && d.kind === 'file') return (S.file && S.file.sample ? 'The simulated sample scan, ' : d.name + ', ') + N(d.n) + ' points.';
      if (s.act === 'scan') return PASS_SAY[s.cpt] || PASS_SAY.aerial;
      if (s.act === 'open') return 'The roof lifts away, and free space is flooded inward from open air.';
      if (!v) return 'No space in this scan is big enough for a person.';
      if (s.act === 'voids') return v.kind.split(':')[0] + '. ' + v.clear.toFixed(1) + ' m of headroom, ' + (v.places ? 'floor for ' + v.places + ' lying down, at 2.0 by 0.6 m each.' : 'too short to lie flat, long enough to crouch.');
      return 'Looking into ' + v.id + '. ' + (v.seen == null ? 'A place to check.' : 'Beams reached ' + Math.round(v.seen * 100) + ' % of it. A place to check.');
    }
    function filmHtml(v) { return '<b>' + v.id + '</b><span>' + v.volume.toFixed(0) + ' m³</span><em>' + (v.places ? 'fits ' + v.places + ' lying down' : 'room to crouch') + '</em>'; }
    function filmAction() { const H = film.hero; if (!H) return; H.go(H.S.act === 'inside' || !H.big ? 'scan' : 'inside'); tickFilm(true); }
    function drawDots() { film.dots.replaceChildren(...ACTS.map(([id, label], i) => h('button', { 'aria-current': null, 'data-act': id, onclick: () => { film.hero?.go(id); tickFilm(true); } }, h('i', null, h('u')), h('span', null, label)))); }
    let filmFig = 0;
    function tickFilm(force) {
      const H = film.hero; if (!H) return; const s = H.S, now = performance.now();
      if (s.cap != null) { // the instrument reads the points as they land
        const a = film.lastCap, dc = a ? s.cap - a[0] : 0; if (dc > 0 && dc < 8 && a[2] === s.pass) { const r = (s.points - a[1]) / dc; film.rate += (r - film.rate) * (film.rate ? 0.06 : 1); } else if (dc < 0 || !a) film.rate = 0;
        film.lastCap = [s.cap, s.points, s.pass]; s.alt = film.strip.feed(filmData(), s.drawn, s.cap, s.pass, view.gz);
      }
      film.strip.draw(now, s.cap != null);
      if (force || now - filmFig > 90) { filmFig = now; const d = filmData(), fly = s.cap != null, L = d.voids.list, K = H.list.length, tx = fly ? [N(s.points), N(film.rate), N(s.alt || 0) + ' m'] : [N(s.points), String(s.found), N(s.volume)], cx = fly ? ['points so far', 'points a second', 'scanner height'] : ['points in the scan', K < L.length ? 'largest of ' + L.length + ' voids' : 'voids found', K < L.length ? 'm³, of ' + L.reduce((q, v) => q + v.volume, 0).toFixed(0) + ' possible' : 'm³ of possible space'];
        film.fig.forEach((el, i) => { if (el.textContent !== tx[i]) el.textContent = tx[i]; if (film.cap[i].textContent !== cx[i]) film.cap[i].textContent = cx[i]; });
        const order = ACTS.map((a) => a[0]); order.forEach((id, i) => { const a = H.starts[id], b = i < 3 ? H.starts[order[i + 1]] : H.total, u = film.dots.children[i].querySelector('u'); u.style.transform = 'scaleX(' + Math.min(1, Math.max(0, (s.t - a) / (b - a))).toFixed(3) + ')'; }); }
      const key = s.act + s.cpt; if (key === film.last && !force) return; film.last = key;
      film.say.textContent = filmSay(); film.say.classList.remove('in'); void film.say.offsetWidth; film.say.classList.add('in');
      film.act.replaceChildren(s.act === 'inside' ? 'Play again' : H.big ? 'Look into ' + H.big.v.id : 'Play again'); film.act.prepend(icon(s.act === 'inside' ? 'reset' : 'target'));
      [...film.dots.children].forEach((x) => { if (x.dataset.act === s.act) x.setAttribute('aria-current', 'step'); else x.removeAttribute('aria-current'); });
    }
    const demo = () => ctx.mode === 'demo', filmData = () => (S.source === 'site' ? S.bake : S.data);
    async function showBake() {
      const id = ++job; stopFilm(); stopReplay(); veil.hidden = true; filmBox.classList.add('loading'); film.say.textContent = '';
      try { S.bake = S.bake || await getBake(); } catch { if (id === job && demo()) { S.bake = null; film.say.textContent = 'The recorded scan could not be read. Open Advanced to run it live.'; } return; }
      if (id !== job || !demo()) return;
      view.setCloud(S.bake); view.setVoids(S.bake.voids.list); if (S.shown) startFilm();
    }
    function startFilm() {
      const d0 = filmData(); if (!demo() || !d0) return; stopFilm(); S.replay.playing = false; S.replay.t = null; view.setTool('orbit'); tip();
      if (view.section.on) { view.setSection({ on: false }); }
      for (const g of ['frame', 'leads', 'routes', 'zones', 'occ', 'section', 'measure', 'access']) view.setLayer(g, false);
      view.setLayer('flight', true);
      filmBox.classList.remove('loading'); film.strip.reset(); film.lastCap = null; film.algo.replaceChildren(d0.baked ? h('span.tag.tag-sim', { title: 'The same search, run beforehand on this scan and saved with it. Advanced runs it live.' }, 'Recorded result') : realityTag('live-algo')); film.hero = createHero(view, d0, { reduced: reduced(), html: filmHtml }); film.hero.begin(); film.last = ''; film.src.hidden = S.source === 'file' && !(S.file && S.file.sample); tickFilm(true); for (let i = 0; i < 4; i++) view.setClassVisible(i, true);
    }
    function stopFilm() { if (!film.hero) return; film.hero.end(); film.hero = null; }
    function onMode() {
      if (demo()) { if (S.source === 'site') showBake(); else startFilm(); }
      else { stopFilm(); if (S.source === 'site' && !S.data) { setSource('site'); return; } if (!S.data) return; if (view.data !== S.data) setData(S.data); for (const g of ['frame', 'section', 'measure', 'access']) view.setLayer(g, true); view.setMode(S.mode); view.setLit(lit); classOn.forEach((on, i) => view.setClassVisible(i, on)); view.selectVoid(S.sel); S.auto = false; setStep(S.step, true); if (S.step === 'capture') view.home(); }
    }
    drawDots();

    const seg = (host, opts, get, set) => { host.replaceChildren(...opts.map(([v, label, title, dis]) => h('button', { 'aria-pressed': String(get() === v), title, disabled: !!dis, onclick: () => { set(v); [...host.children].forEach((b, i) => b.setAttribute('aria-pressed', String(opts[i][0] === get()))); } }, label))); };
    const slider = (label, min, max, step, value, show, oninput, title) => { const out = h('span.num', null, show(value)); const inp = h('input.scan-range', { type: 'range', min, max, step, value, 'aria-label': label, title, oninput: () => { out.textContent = show(+inp.value); oninput(+inp.value); } }); const el = h('label.scan-slider', null, h('span', null, label), inp, out); el.input = inp; el.out = out; el.set = (v) => { inp.value = v; out.textContent = show(+v); }; return el; };
    const kv = (rows) => h('dl.kv', null, rows.filter(Boolean).map(([k, v, t]) => [h('dt', t ? { title: t } : null, k), h('dd.num', null, v)]));

    // ------------------------------------------------------------------ steps
    function drawSteps() {
      const d = S.data, m = { capture: d ? N(d.n) + ' points' : 'No scan yet', classify: d ? (d.classes.accuracy != null ? (d.classes.accuracy * 100).toFixed(1) + ' % agree with labels' : '4 classes') : '', voids: d ? (d.voids.list.length ? d.voids.list.length + ' found, ' + d.voids.list.reduce((s, v) => s + v.volume, 0).toFixed(0) + ' m³' : 'None found') : '', map: d ? (S.compare ? (S.compare.agreement * 100).toFixed(1) + ' % agrees with the planner' : N(d.occ.areas[OCC.FREE]) + ' m² clear floor') : '' };
      steps.replaceChildren(...STEPS.map((s) => h('button.scan-step', { 'aria-pressed': String(S.step === s.id), disabled: !d && s.id !== 'capture', title: s.say, onclick: () => setStep(s.id, true) }, h('i.num', null, String(s.n)), h('span', null, h('b', null, s.title), h('em.num', null, m[s.id] || s.say)))));
    }
    function setStep(id, byUser) {
      if (film.hero) { S.step = id; return; }
      if (byUser) S.auto = false;
      const was = S.step; S.step = id;
      if (id !== 'capture' && S.replay.t != null) stopReplay();
      if (id === 'classify' && S.mode !== 'class') { S.prevMode = S.mode; setMode('class'); }
      else if (was === 'classify' && id !== 'classify' && S.mode === 'class') setMode(S.prevMode === 'class' ? 'natural' : S.prevMode);
      applyLayers(); drawSteps(); drawDock(); drawTransport();
      if (!S.data || !byUser && !S.auto) return;
      if (id === 'voids') { if (S.sel < 0 && S.data.voids.list.length) selectVoid(0, true); else if (S.sel >= 0) view.focusVoid(S.sel, openSide(S.sel)); }
      else if (id === 'map') view.topView();
      else if (id === 'capture' && byUser && was !== 'capture') view.home();
    }
    function applyLayers() {
      const planEdit = S.source === 'plan' && !S.planScanned;
      const v = S.step === 'voids';
      if (film.hero) { planHost.hidden = !planEdit; return; }
      view.setVoidsVisible(v); view.setLayer('zones', v); view.setLayer('routes', v || S.step === 'map'); view.setLayer('leads', S.step === 'voids' || S.step === 'map');
      view.setLayer('occ', S.step === 'map' && S.overlay); view.setLayer('flight', S.step === 'capture');
      planHost.hidden = !planEdit;
      for (const el of [hudTL, statLine, tools, scale, compassEl]) el.hidden = planEdit || !S.data;
      sectionBar.hidden = planEdit || !S.data || !view.section.on;
    }

    // ------------------------------------------------------------------ colour modes and the legend
    function setMode(m) { S.mode = m; view.setMode(film.hero ? 'natural' : m); drawModeSeg(); drawLegend(); }
    function drawModeSeg() {
      const d = S.data, opts = [['natural', 'Natural', 'Return strength, tinted by height, with light and shadow worked out from the points'], ['height', 'Height', 'Height above the fitted ground'], ['intensity', 'Intensity', 'Strength of each return'], ['class', 'Class', 'What the classifier decided'], ['time', 'Time', d && !d.time ? 'This scan has no time stamps' : 'When each point was captured', d && !d.time]];
      if (d && d.rgb) opts.push(['rgb', 'Photo colour', 'The colours stored in the file']);
      seg(modeSeg, opts, () => S.mode, (v) => { if (S.step === 'classify' && v !== 'class') S.prevMode = v; setMode(v); });
    }
    const grad = (stops) => 'linear-gradient(90deg,' + stops.map((s) => s[1] + ' ' + (s[0] * 100).toFixed(0) + '%').join(',') + ')';
    function drawLegend() {
      const d = S.data; if (!d) { legend.replaceChildren(); return; }
      if (S.mode === 'natural') legend.replaceChildren(h('span.dim', null, 'Return strength, tinted by height. Sun and shadow are worked out from the points.'));
      else if (S.mode === 'height') { const hm = view.heightMax; legend.replaceChildren(h('div.scan-ramp', { style: { background: grad(HEIGHT_RAMP) } }), h('div.scan-ramp-ax.num', null, h('span', null, '0'), h('span', null, (hm / 2).toFixed(1)), h('span', null, hm.toFixed(1) + ' m +')), h('span.dim', null, 'Height above ground')); }
      else if (S.mode === 'intensity') legend.replaceChildren(h('div.scan-ramp', { style: { background: 'linear-gradient(90deg,#0d1117,#e0effe)' } }), h('div.scan-ramp-ax', null, h('span', null, 'weak'), h('span', null, 'strong')), h('span.dim', null, d.kind === 'file' && !d.hasIntensity ? 'Return strength (not in this file)' : 'Return strength: dark tarmac, bright plaster'));
      else if (S.mode === 'class') { const cc = classColors(); legend.replaceChildren(h('div.scan-swatches', null, CLASSES.map((c, i) => h('span', null, h('i', { style: { background: cc[i] } }), c)))); }
      else if (S.mode === 'time') legend.replaceChildren(h('div.scan-ramp', { style: { background: grad(TIME_RAMP) } }), h('div.scan-ramp-ax.num', null, h('span', null, '0:00'), h('span', null, fmt.clock(d.duration || 0))), h('span.dim', null, 'Capture time: first beam to last'));
      else legend.replaceChildren(h('span.dim', null, 'Colours stored in the file'));
    }

    // ------------------------------------------------------------------ tools
    const toolBtn = (name, label, ic, onclick, pressed) => h('button.btn.btn-ghost.btn-icon', { 'aria-label': label, title: label, 'aria-pressed': pressed == null ? null : String(pressed), onclick }, typeof ic === 'string' ? h('span.scan-glyph', { html: ic }) : ic);
    const G = { orbit: '<svg viewBox="0 0 24 24"><path d="M12 5a7 7 0 1 1-6.6 4.7M5 4v6h6"/></svg>', ruler: '<svg viewBox="0 0 24 24"><path d="M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2"/></svg>', cut: '<svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5-9 5zM3 15l9 5 9-5" /><path d="M2 12h20" stroke-dasharray="2 2.5"/></svg>', home: '<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/></svg>', top: '<svg viewBox="0 0 24 24"><path d="M5 5h14v14H5zM12 9v6M9 12l3-3 3 3"/></svg>', zone: '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="4"/></svg>', spin: '<svg viewBox="0 0 24 24"><path d="M4 12c0-3 3.6-5 8-5s8 2 8 5-3.6 5-8 5M9 14l3 3-3 3"/></svg>' };
    let autoOrbit = true;
    function drawTools() {
      tools.replaceChildren(
        toolBtn('orbit', 'Orbit and pan (drag, scroll, right-drag)', G.orbit, () => { view.setTool('orbit'); drawTools(); tip(); }, view.tool === 'orbit'),
        toolBtn('measure', 'Measure: click two points', G.ruler, () => { view.setTool(view.tool === 'measure' ? 'orbit' : 'measure'); if (view.tool !== 'measure') view.clearMeasure(); drawTools(); tip(); }, view.tool === 'measure'),
        toolBtn('section', 'Section plane: cut the scan open', G.cut, () => toggleSection(!view.section.on), view.section.on),
        h('hr'),
        toolBtn('home', 'Whole site', G.home, () => view.home()),
        toolBtn('top', 'Plan view, north up', G.top, () => view.topView()),
        toolBtn('zone', 'Go to the collapse', G.zone, goZone),
        toolBtn('spin', 'Slow orbit when idle', G.spin, () => { autoOrbit = !autoOrbit; view.setAutoOrbit(autoOrbit); drawTools(); }, autoOrbit));
    }
    function tip() {
      if (view.tool !== 'measure') { measureTip.hidden = true; return; }
      measureTip.hidden = false; measureTip.replaceChildren(h('b', null, 'Measure'), h('span.muted', null, 'Click a point, then a second one. The reading snaps to real scan points.'), h('button.btn.btn-sm', { onclick: () => view.clearMeasure() }, 'Clear'), h('button.btn.btn-sm.btn-ghost', { onclick: () => { view.setTool('orbit'); view.clearMeasure(); drawTools(); tip(); } }, 'Done'));
    }
    function goZone() {
      const d = S.data; if (!d) return;
      const z = [...d.voids.zones].sort((a, b) => b.area - a.area)[0];
      if (!z) { ctx.shell.toast('No collapsed zone was found in this scan.'); return; }
      const near = d.voids.list.length ? d.voids.list[0].centre : [(z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2];
      view.flyTo({ target: [near[0], near[1], d.bounds.min[2] + 1.2], dist: 34, az: 48, el: 34 });
    }
    let secSlider = null;
    function toggleSection(on, opts = {}) {
      const d = S.data; if (!d) return;
      const axis = opts.axis || view.section.axis, r0 = (() => { view.section.axis = axis; return view.sectionRange(); })();
      const def = axis === 'z' ? Math.min(r0[1], d.bounds.min[2] + 2.6) : (r0[0] + r0[1]) / 2;
      view.setSection({ on, axis, value: opts.value ?? (opts.axis ? def : view.section.value ?? def), slab: opts.slab ?? view.section.slab });
      drawTools(); drawSectionBar(); applyLayers();
    }
    function drawSectionBar() {
      const s = view.section; if (!s.on || !S.data) { sectionBar.hidden = true; return; }
      const r = view.sectionRange(), axSeg = h('div.seg', { role: 'group', 'aria-label': 'Cut direction' });
      seg(axSeg, [['z', 'Level', 'A level cut: lift the roof off'], ['x', 'East–west', 'An upright cut you move east and west'], ['y', 'North–south', 'An upright cut you move north and south']], () => view.section.axis, (v) => toggleSection(true, { axis: v }));
      secSlider = slider('Position', r[0].toFixed(2), r[1].toFixed(2), 0.05, s.value, (v) => v.toFixed(2) + ' m', (v) => view.setSection({ value: v }), 'Drag the handle in the view, or this slider');
      const slab = h('label.check', { title: 'Show only a thin slice at the cut, like one frame of a CT scan' }, h('input', { type: 'checkbox', checked: s.slab > 0, onchange: (e) => view.setSection({ slab: e.target.checked ? 0.6 : 0 }) }), 'Thin slice only');
      sectionBar.replaceChildren(h('b', null, 'Section'), axSeg, secSlider, slab, h('button.btn.btn-sm.btn-ghost', { onclick: () => toggleSection(false) }, 'Close'));
      sectionBar.hidden = false;
    }
    view.on('section', (v) => { view.setSection({ value: v }); secSlider?.set(v); });

    // ------------------------------------------------------------------ replay
    function drawTransport() {
      const d = S.data, show = !!(d && d.time && S.step === 'capture' && !(S.source === 'plan' && !S.planScanned));
      transport.hidden = !show; if (!show) return;
      const r = S.replay, live = r.t != null, dur = d.duration;
      const play = h('button.btn.btn-icon' + (live ? '' : '.btn-primary'), { 'aria-label': r.playing ? 'Pause the replay' : 'Replay the capture', title: r.playing ? 'Pause' : 'Replay the capture', onclick: () => (r.playing ? pauseReplay() : startReplay(live && r.t < dur - 0.5 ? r.t : 0)) }, icon(r.playing ? 'pause' : 'play'));
      const bars = h('div.scan-passes', null, d.passes.map((p) => h('button', { style: { left: ((p.t0 / dur) * 100).toFixed(2) + '%', width: (((p.t1 - p.t0) / dur) * 100).toFixed(2) + '%' }, title: p.name + ': ' + p.detail, onclick: () => startReplay(p.t0) }, h('span', null, p.name))));
      const range = h('input.scan-range.scan-scrub', { type: 'range', min: 0, max: dur.toFixed(1), step: 0.1, value: live ? r.t : dur, 'aria-label': 'Capture time', oninput: () => { r.t = +range.value; r.playing = false; view.setReplay(r.t); tickTransport(); syncPlay(); } });
      const clock = h('span.num.scan-clock'), pts = h('span.num.dim.scan-pts');
      const spd = h('div.seg', { role: 'group', 'aria-label': 'Replay speed' }); seg(spd, [[8, '8×'], [24, '24×'], [72, '72×']], () => r.speed, (v) => { r.speed = v; });
      const done = h('button.btn.btn-sm.btn-ghost', { title: 'Jump to the finished scan', onclick: stopReplay }, 'Show finished scan');
      transport.replaceChildren(play, h('div.scan-track', null, bars, range), clock, pts, spd, done);
      transport.refs = { play, range, clock, pts, done };
      tickTransport();
    }
    function syncPlay() { const p = transport.refs?.play; if (!p) return; p.replaceChildren(icon(S.replay.playing ? 'pause' : 'play')); p.setAttribute('aria-label', S.replay.playing ? 'Pause the replay' : 'Replay the capture'); p.classList.toggle('btn-primary', S.replay.t == null); }
    function tickTransport() {
      const f = transport.refs, d = S.data; if (!f || !d) return; const r = S.replay, t = r.t ?? d.duration;
      if (document.activeElement !== f.range || r.playing) f.range.value = t;
      f.range.style.setProperty('--p', ((t / d.duration) * 100).toFixed(2) + '%');
      f.clock.textContent = fmt.clock(t) + ' / ' + fmt.clock(d.duration);
      let lo = 0, hi = d.n; if (r.t != null) { while (lo < hi) { const m = (lo + hi) >> 1; if (d.time[m] <= t) lo = m + 1; else hi = m; } } else lo = d.n;
      f.pts.textContent = N(lo) + ' points'; f.done.hidden = r.t == null;
      const live = dock.querySelectorAll('[data-pass]'); live.forEach((el) => { const p = d.passes[+el.dataset.pass]; el.classList.toggle('on', r.t != null && t >= p.t0 && t <= p.t1); el.querySelector('i').style.width = (Math.min(1, Math.max(0, (t - p.t0) / (p.t1 - p.t0))) * 100).toFixed(1) + '%'; });
    }
    function startReplay(t = 0) { if (!S.data?.time) return; if (S.step !== 'capture') setStep('capture'); S.replay.t = t; S.replay.playing = true; view.setReplay(t); syncPlay(); tickTransport(); }
    function pauseReplay() { S.replay.playing = false; syncPlay(); }
    function stopReplay() { S.replay.t = null; S.replay.playing = false; view.setReplay(null); syncPlay(); tickTransport(); }
    view.on('frame', (dt) => {
      if (film.hero) { film.hero.update(dt); tickFilm(); return; }
      const r = S.replay; if (!r.playing || !S.data) return;
      r.t += dt * r.speed;
      if (r.t >= S.data.duration) { stopReplay(); if (S.auto && S.source === 'site') { S.auto = false; setStep('voids'); if (S.data.voids.list.length) selectVoid(0, true); } return; }
      view.setReplay(r.t); tickTransport();
    });
    let fpsNow = 0;
    view.on('fps', (f) => { fpsNow = f; drawStat(); });
    view.on('view', ({ mpp, az }) => {
      const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200], want = mpp * 120, len = nice.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
      scale.firstChild.style.width = (len / mpp).toFixed(0) + 'px'; scale.lastChild.textContent = (len < 1 ? len * 100 + ' cm' : len + ' m');
      compassEl.firstChild.style.transform = 'rotate(' + (az * 180 / Math.PI + 180).toFixed(1) + 'deg)';
    });
    function drawStat() {
      const d = S.data; if (!d) { statLine.textContent = ''; return; }
      const e = d.extent; statLine.replaceChildren(h('b', null, N(d.n)), ' points', h('i'), d.stats.density.toFixed(0) + ' per m²', h('i'), e[0].toFixed(0) + ' × ' + e[1].toFixed(0) + ' × ' + e[2].toFixed(1) + ' m', h('i'), h('span', { title: 'Frames per second on this device' }, fpsNow ? fpsNow.toFixed(0) + ' fps' : '… fps'));
    }

    // ------------------------------------------------------------------ leads from the mission (what the sensors found, never ground truth)
    let leadSig = '';
    function readLeads(force) {
      const list = S.source !== 'site' ? [] : ctx.sim.state.detections.filter((d) => (d.status === 'possible' || d.status === 'confirmed') && !d.dismissed && d.pos).map((d) => ({ id: d.id, pos: d.pos, sigma: d.posSigma, confirmed: d.status === 'confirmed', p: d.p, label: '<b>' + d.id + '</b> ' + (d.status === 'confirmed' ? 'person' : 'possible') + ' · ' + (d.p * 100).toFixed(0) + ' %' }));
      const sig = list.map((l) => l.id + l.confirmed + l.p.toFixed(2) + l.pos.join()).join('|') + S.source;
      if (sig === leadSig && !force) return; leadSig = sig; S.leads = list; view.setLeads(list); if (film.hero) view.setLayer('leads', false); applyLayers();
      if (S.step === 'voids') drawDock(); if (S.step === 'map') drawMap();
    }
    const nearestLead = (v) => { let best = null; for (const l of S.leads) { const dx = Math.max(v.box[0] - l.pos[0], 0, l.pos[0] - v.box[2]), dy = Math.max(v.box[1] - l.pos[1], 0, l.pos[1] - v.box[3]), d = Math.hypot(dx, dy); if (!best || d < best.d) best = { d, lead: l }; } return best; };

    // ------------------------------------------------------------------ voids
    function selectVoid(i, flyThere) {
      if (film.hero) return;
      S.sel = i; S.route = null; view.selectVoid(i); view.setRoutes([]);
      if (flyThere && i >= 0) view.focusVoid(i, openSide(i));
      if (S.step === 'voids') drawDock(); if (S.step === 'map') drawMap();
    }
    view.on('void', (i) => { if (S.step !== 'voids') setStep('voids', true); selectVoid(i, false); });
    let voidTimer = 0, voidBusy = false, voidAgain = false;
    function rerunVoids() {
      clearTimeout(voidTimer);
      voidTimer = setTimeout(async () => {
        if (voidBusy) { voidAgain = true; return; }
        voidBusy = true;
        try { const v = await client.run('voids', S.vp); if (S.data) { S.data.voids = v; S.sel = -1; S.route = null; view.setVoids(v.list); view.setZones(v.zones); view.setRoutes([]); applyLayers(); drawSteps(); if (S.step === 'voids') drawDock({ keepSliders: true }); } }
        catch (e) { ctx.shell.toast('The void search failed: ' + e.message, { level: 'alert' }); }
        voidBusy = false; if (voidAgain) { voidAgain = false; rerunVoids(); }
      }, 140);
    }
    const confidence = (v) => (v.seen == null ? null : v.seen >= 0.25 ? ['Seen inside', 'tag-ok', 'Beams passed through ' + (v.seen * 100).toFixed(0) + ' % of this space, so it is known to be empty there.'] : v.seen >= 0.08 ? ['Partly seen', 'tag-warn', 'Beams passed through ' + (v.seen * 100).toFixed(0) + ' % of this space. The rest is inferred from the shape of the cover.'] : ['Inferred', 'tag-warn', 'Almost no beam went in (' + (v.seen * 100).toFixed(0) + ' %). The space is inferred from the cover above it and may be filled.']);
    function planTo(v) {
      const occ = S.data.occ, g = ctx.sim.grid, blocked = new Uint8Array(occ.w * occ.h);
      for (let k = 0; k < blocked.length; k++) blocked[k] = occ.state[k] === OCC.FREE ? 0 : 1;
      const grid = { res: occ.res, w: occ.w, h: occ.h, blocked, cost: g.cost, toCell: g.toCell, toPoint: g.toPoint };
      const from = world.SITE.staging, to = v.access ? [v.access.pos[0], v.access.pos[1]] : [v.centre[0], v.centre[1]];
      const t0 = performance.now(), a = planPath(grid, from, to, { nearest: true }), ms = performance.now() - t0, b = ctx.sim.plan(from, to, { nearest: true });
      S.route = { scan: a, planner: b, ms };
      view.setRoutes([b.ok ? { path: b.path, dashed: true, color: cssVar('--text-2') } : null, a.ok ? { path: a.path } : null].filter(Boolean));
      applyLayers(); drawDock({ keepSliders: true });
      if (a.ok) { const xs = a.path.map((p) => p[0]), ys = a.path.map((p) => p[1]); view.flyTo({ target: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, 0], dist: Math.max(60, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.5), az: 200, el: 52 }); }
    }

    // ------------------------------------------------------------------ scan map against the planner's map
    const hexRgb = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(c.trim()); const v = m ? parseInt(m[1], 16) : 0x888888; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
    function compareWithPlanner(occ) {
      const g = ctx.sim.grid; if (!g || g.w !== occ.w || g.h !== occ.h) return null;
      const n = g.w * g.h, cat = new Uint8Array(n), c = [0, 0, 0, 0, 0, 0, 0], places = new Map(), B = world.BUILDING.rect, bc = [(B[0] + B[2]) / 2, (B[1] + B[3]) / 2];
      for (let k = 0; k < n; k++) {
        const s = occ.state[k], pb = g.blocked[k], q = s === OCC.FREE ? (pb ? 4 : 1) : s === OCC.BLOCKED ? (pb ? 2 : 3) : pb ? 6 : 5;
        cat[k] = q; c[q]++;
        if (q < 3 || q === 6) continue;
        const p = [((k % g.w) + 0.5) * g.res, (((k / g.w) | 0) + 0.5) * g.res];
        const room = world.roomAt(p), ob = room ? null : world.OBSTACLES.find((o) => pointInPoly(p, o.poly)), hz = q === 4 ? world.hazardsAt(p).find((x) => x.block) : null;
        const name = room ? room.name : ob ? ob.name : 'Outdoors, ' + compass(p[0] - bc[0], p[1] - bc[1]) + ' of block B';
        const key = q + '|' + name + (hz ? '|hz' : '');
        let pl = places.get(key); if (!pl) places.set(key, (pl = { cat: q, name, hz: hz ? hz.name : null, cells: 0, sx: 0, sy: 0, x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 }));
        pl.cells++; pl.sx += p[0]; pl.sy += p[1]; pl.x0 = Math.min(pl.x0, p[0]); pl.x1 = Math.max(pl.x1, p[0]); pl.y0 = Math.min(pl.y0, p[1]); pl.y1 = Math.max(pl.y1, p[1]);
      }
      const seen = c[1] + c[2] + c[3] + c[4], a = g.res * g.res;
      const list = [...places.values()].map((p) => ({ ...p, area: p.cells * a, pos: [p.sx / p.cells, p.sy / p.cells] })).filter((p) => p.area >= 2).sort((x, y) => y.area - x.area);
      return { cat, counts: c, agreement: (c[1] + c[2]) / Math.max(1, seen), seenShare: seen / n, places: list, cell: a };
    }
    const DIFF_SAY = { 3: 'The scan sees something standing here. The planner has clear floor.', 4: 'The planner blocks this. The scan sees clear floor.', 5: 'The scan never saw this floor. The planner assumes it is clear.' };
    function mapImage(kind, forOverlay) {
      const d = S.data, occ = d.occ, w = occ.w, hh = occ.h, cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
      const c2 = cv.getContext('2d'), img = c2.createImageData(w, hh), px = img.data, warn = hexRgb(cssVar('--warn')), acc = hexRgb(cssVar('--accent')), dang = hexRgb(cssVar('--danger'));
      const cmp = S.compare, g = cmp ? ctx.sim.grid : null;
      for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) {
        const k = j * w + i, o = ((hh - 1 - j) * w + i) * 4, hatch = (i + j) % 3 === 0; let r, a = 255;
        if (kind === 'planner') { r = g.blocked[k] ? [206, 215, 226] : g.cost[k] > 1 ? [34 + (dang[0] - 34) * 0.3, 49 + (dang[1] - 49) * 0.3, 68 + (dang[2] - 68) * 0.3] : [34, 49, 68]; if (!g.blocked[k]) a = forOverlay ? 70 : 255; }
        else if (kind === 'diff') { const q = cmp.cat[k]; r = q === 1 ? [26, 34, 46] : q === 2 ? [98, 108, 121] : q === 3 ? warn : q === 4 ? acc : q === 5 ? (hatch ? [150, 160, 176] : [18, 21, 27]) : [46, 53, 64]; a = forOverlay ? (q === 1 ? 40 : q === 2 ? 150 : 240) : 255; }
        else { const s = occ.state[k]; r = s === OCC.FREE ? [34, 49, 68] : s === OCC.BLOCKED ? [206, 215, 226] : s === OCC.COVERED ? ((i + j) % 2 ? [70, 79, 94] : [20, 24, 30]) : hatch ? [52, 60, 73] : [10, 12, 16]; a = forOverlay ? (s === OCC.FREE ? 60 : s === OCC.BLOCKED ? 235 : 170) : 255; }
        px[o] = r[0]; px[o + 1] = r[1]; px[o + 2] = r[2]; px[o + 3] = a;
      }
      c2.putImageData(img, 0, 0); return cv;
    }
    let mapCanvas = null, mapStop = null, mapImg = null;
    function refreshMapLayers() {
      const d = S.data; if (!d) return;
      const kind = S.compare ? S.mapView : 'scan';
      mapImg = mapImage(kind, false);
      const occ = d.occ; view.setOccOverlay(mapImage(kind, true), [occ.x0, occ.y0, occ.x0 + occ.w * occ.res, occ.y0 + occ.h * occ.res]);
      applyLayers(); drawMap();
    }
    function drawMap() {
      if (!mapCanvas || !mapImg || !S.data) return;
      const r = mapCanvas.getBoundingClientRect(); if (!r.width) return;
      const c = mapCanvas.getContext('2d'), W2 = r.width, H2 = r.height, occ = S.data.occ, sc = Math.min(W2 / occ.w, H2 / occ.h), ox = (W2 - occ.w * sc) / 2, oy = (H2 - occ.h * sc) / 2;
      const X = (x) => ox + ((x - occ.x0) / occ.res) * sc, Y = (y) => oy + (occ.h - (y - occ.y0) / occ.res) * sc;
      c.clearRect(0, 0, W2, H2); c.imageSmoothingEnabled = false; c.drawImage(mapImg, ox, oy, occ.w * sc, occ.h * sc);
      mapCanvas.geo = { ox, oy, sc };
      if (S.source === 'site') { c.font = '10px ' + cssVar('--font'); c.textAlign = 'center'; c.fillStyle = 'rgba(233,237,242,0.72)'; for (const rm of world.ROOMS) { if (rm.corridor) continue; c.fillText(rm.id, X((rm.rect[0] + rm.rect[2]) / 2), Y((rm.rect[1] + rm.rect[3]) / 2) + 3); } }
      S.data.voids.list.forEach((v, i) => { c.strokeStyle = cssVar('--warn'); c.lineWidth = i === S.sel ? 2 : 1; c.setLineDash(i === S.sel ? [] : [3, 2]); c.strokeRect(X(v.box[0]), Y(v.box[3]), (v.box[2] - v.box[0]) / occ.res * sc, (v.box[3] - v.box[1]) / occ.res * sc); });
      c.setLineDash([]);
      if (S.route?.scan?.ok) { c.strokeStyle = cssVar('--accent'); c.lineWidth = 1.5; c.beginPath(); S.route.scan.path.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])))); c.stroke(); }
      for (const l of S.leads) { c.beginPath(); c.arc(X(l.pos[0]), Y(l.pos[1]), 3.5, 0, 6.283); c.fillStyle = l.confirmed ? cssVar('--person') : cssVar('--warn'); c.fill(); c.strokeStyle = '#07090c'; c.lineWidth = 1; c.stroke(); }
      if (S.diffSel) { const p = S.diffSel; c.strokeStyle = cssVar('--text'); c.lineWidth = 1.5; c.strokeRect(X(p.x0) - 4, Y(p.y1) - 4, (p.x1 - p.x0) / occ.res * sc + 8, (p.y1 - p.y0) / occ.res * sc + 8); }
    }

    // ------------------------------------------------------------------ the dock: one panel set per step
    const panel = (title, opts, ...body) => ctx.kit.panel(title, opts || {}, ...body);
    const simTag = () => (S.source === 'file' && !(S.file && S.file.sample) ? realityTag('device') : h('span.tag.tag-sim', { title: 'The scan is simulated: a virtual scanner flown through a model of the exercise site.' }, 'Simulated scan'));
    function drawDock(opts = {}) {
      const d = S.data, keep = opts.keepSliders && dock.querySelector('.scan-voidparams');
      mapCanvas = null; mapStop?.(); mapStop = null;
      const out = [];
      if (S.step === 'capture') out.push(...dockCapture());
      else if (!d) out.push(h('div.empty', null, h('p', null, 'Load a scan first.')));
      else if (S.step === 'classify') out.push(...dockClassify());
      else if (S.step === 'voids') out.push(...dockVoids(keep));
      else out.push(...dockMap());
      const y = dock.scrollTop; dock.replaceChildren(...out); dock.scrollTop = opts.keepSliders ? y : 0;
      if (mapCanvas) mapStop = ctx.kit.fitCanvas(mapCanvas, () => drawMap());
      tickTransport();
    }
    function facts() {
      const d = S.data, e = d.extent, T = d.timings;
      return panel('Scan facts', null, kv([
        ['Points', N(d.n)], ['Ground covered', N(d.stats.area) + ' m²'], ['Density', d.stats.density.toFixed(1) + ' points per m²', 'Points divided by the area of 1 m cells that hold at least one point'],
        ['Typical spacing', (100 / Math.sqrt(d.stats.density)).toFixed(0) + ' cm'], ['Bounds', e[0].toFixed(1) + ' × ' + e[1].toFixed(1) + ' × ' + e[2].toFixed(1) + ' m', 'East–west × north–south × height'],
        d.rays ? ['Beams fired', N(d.rays) + ' (' + ((d.n / d.rays) * 100).toFixed(0) + ' % returned)', 'Beams that hit nothing in range, left the site or were too weak give no point'] : null,
        d.prims ? ['Shapes in the model', N(d.prims), 'Walls, slabs, furniture, debris, trunks and tree crowns the beams are tested against'] : null,
        d.kind === 'file' && d.total > d.n ? ['In the file', N(d.total)] : null,
      ]), h('div.scan-times', { title: 'Measured on this device just now' }, [['Simulate', T.scan != null ? T.build + T.scan : null], ['Read', T.read], ['Ground', T.ground], ['Classify', T.classify], ['Voids', T.voids], ['Light', T.light], ['Map', T.map]].filter((x) => x[1] != null).map(([k, v]) => h('span', null, k + ' ', h('b.num', null, v < 1000 ? v.toFixed(0) + ' ms' : (v / 1000).toFixed(1) + ' s')))),
      h('p.dim.scan-small', null, client.threaded ? 'Computed in a background worker on this device.' : 'Computed on this device.'));
    }
    function display() {
      return panel('Display', null,
        slider('Point size', 0.6, 3.2, 0.05, view.pointSize, (v) => v.toFixed(2) + ' × spacing', (v) => view.setPointSize(v), 'Each point is drawn this many times wider than the local gap between points, so sparse and dense areas both close up. Points shrink with distance; close up, one point is drawn as up to eight grains.'),
        slider('Sun and shadow', 0, 1, 0.05, lit, (v) => (v * 100).toFixed(0) + ' %', (v) => { lit = v; view.setLit(v); }, 'Light, shadow and openness to the sky, worked out from the points themselves. At zero you see the raw colours.'),
        slider('Depth shading', 0, 2.5, 0.05, shading, (v) => v.toFixed(2), (v) => { shading = v; view.setShading(v); }, 'Eye-dome lighting: darkens a point by how far it sits behind its neighbours on screen'),
        slider('Height scale', 2, 14, 0.5, view.heightMax, (v) => '0 to ' + v.toFixed(1) + ' m', (v) => { view.setHeightRange(v); drawLegend(); }, 'Top of the height colour scale'));
    }
    let shading = 1, lit = 1;
    function dockCapture() {
      const d = S.data;
      if (S.source === 'file') return dockFile();
      if (S.source === 'plan' && !S.planScanned) return dockPlan();
      if (!d) return [h('div.empty', null, h('div.spinner'), h('p', null, 'Running it live on this device…'))];
      const out = [];
      out.push(panel(S.source === 'plan' ? 'How your plan was scanned' : 'How this scan was made', { tag: simTag() },
        h('p.muted', null, S.source === 'plan' ? 'A virtual scanner flew two crossing sets of lines over your drawing and every beam was ray-cast against your walls and rubble.' : 'A virtual lidar is flown through a model of the exercise site and every beam is ray-cast, so the shadows, holes and scan lines you see are what the geometry gives, not decoration. Four passes are merged.'),
        h('div.scan-passlist', null, d.passes.map((p, i) => h('button.scan-pass', { 'data-pass': i, title: 'Replay from here', onclick: () => startReplay(p.t0) }, h('b', null, p.name), h('span.num', null, N(p.i1 - p.i0) + ' points · ' + fmt.clock(p.t1 - p.t0)), h('em', null, p.detail), h('i')))),
        S.source === 'plan' ? h('button.btn', { onclick: () => { S.planScanned = false; view.setCloud(null); S.data = null; refreshAll(); } }, 'Edit the plan') : null,
        S.source === 'site' ? h('div.note', null, icon('info'), h('span', null, 'The drone and its scanner are a concept. Range noise is set at 8 to 20 mm and weak returns are dropped. People are not in the scan.')) : null));
      if (S.source === 'site') out.push(h('button.btn', { title: 'Scan the site again and redo every step on this device', onclick: () => setSource('site') }, icon('reset'), 'Run it live again'));
      out.push(facts(), display());
      return out;
    }
    function dockClassify() {
      const d = S.data, c = d.classes, cc = classColors(), tot = d.n;
      const rows = CLASSES.map((name, i) => { const cb = h('input', { type: 'checkbox', checked: classOn[i], 'aria-label': 'Show ' + name, onchange: () => { classOn[i] = cb.checked; view.setClassVisible(i, cb.checked); } }); return h('div.scan-classrow', null, h('label.check', { title: 'Show or hide this class' }, cb, h('i.scan-sw', { style: { background: cc[i] } }), h('b', null, name)), h('span.num', null, N(c.counts[i])), h('span.num.dim', null, ((c.counts[i] / tot) * 100).toFixed(1) + ' %'), h('div.bar', null, h('i', { style: { width: ((c.counts[i] / tot) * 100).toFixed(1) + '%', background: cc[i] } })), h('em', null, CLASS_SAY[i])); });
      const out = [panel('What each point is', { tag: realityTag('live-algo') },
        h('p.muted', null, 'A ground surface is fitted under everything first. Then the scan is cut into ' + (c.voxel * 100).toFixed(0) + ' cm cubes, and the shape of the points in each cube and its 26 neighbours (flat, upright, tilted, rough or thin) decides the class, with height above ground. No labels, no training: only x, y, z.'),
        h('div.scan-classes', null, rows),
        h('p.dim.scan-small', null, N(c.voxels) + ' occupied cubes, ' + d.timings.classify.toFixed(0) + ' ms on this device.'))];
      if (c.confusion) {
        let worst = null; for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) if (r !== k && (!worst || c.confusion[r][k] > worst.n)) worst = { r, k, n: c.confusion[r][k] };
        const rowTot = c.confusion.map((r) => r.reduce((a, b) => a + b, 0));
        const table = h('table.table.scan-conf', null, h('thead', null, h('tr', null, h('th', null, 'Really is'), CLASSES.map((x) => h('th', null, x)))), h('tbody', null, c.confusion.map((r, i) => h('tr', i === 4 ? { class: 'aside' } : null, h('th', { scope: 'row' }, TRUTH_ROWS[i]), r.map((v, k) => { const f = v / Math.max(1, rowTot[i]); return h('td.num', { title: N(v) + ' points', style: { background: i < 4 ? (i === k ? 'rgba(65,214,160,' + (f * 0.32).toFixed(3) + ')' : f > 0.004 ? 'rgba(255,178,36,' + Math.min(0.5, f * 2.2 + 0.05).toFixed(3) + ')' : '') : 'rgba(255,255,255,' + (f * 0.1).toFixed(3) + ')' } }, (f * 100).toFixed(f > 0.1 || f === 0 ? 0 : 1)); })))));
        out.push(panel((c.accuracy * 100).toFixed(1) + ' % of points match the simulator’s own labels', { tag: h('span.tag.tag-sim', null, 'Simulated check') },
          h('p.muted', null, 'Because this scan is simulated, the true material of every point is known. It is used here only to mark the algorithm’s work. Each row adds up to 100 %.'), table,
          h('p.scan-small', null, 'Most points wrong in one place: ' + ((worst.n / rowTot[worst.r]) * 100).toFixed(1) + ' % of ' + TRUTH_ROWS[worst.r].toLowerCase() + ' points are called ' + CLASSES[worst.k].toLowerCase() + '. Furniture and vehicles have no class of their own, so they are left out of the score.'),
          checkBox(),
          h('div.note.warn', null, icon('alert'), h('span', null, 'The rules and limits were set by hand on this simulated site, with clean geometry. Reshuffle the site to score the unchanged rules on a new one.'))));
      } else out.push(panel('No answer key for this scan', null, h('p.muted', null, 'A file you load has no known labels, so the classes cannot be scored here. Hide and show classes to check them by eye.')));
      return out;
    }
    const CHECK = { busy: false, res: [], err: null };
    function checkBox() { // an honest second opinion: the same rules on a site they were not adjusted on
      const box = h('div.scan-check'), draw = () => box.replaceChildren(...[
        h('div.row', null, h('button.btn.btn-sm', { disabled: CHECK.busy, title: 'Re-rolls debris, furniture, trees and sensor noise, scans again and scores the unchanged rules. The buildings stay where they are.', onclick: async () => { CHECK.busy = true; CHECK.err = null; draw(); try { CHECK.res.push(await client.run('check', { shuffle: CHECK.res.length + 1 })); } catch (e) { CHECK.err = e.message; } CHECK.busy = false; draw(); } }, icon('reset'), CHECK.busy ? 'Scanning a reshuffled site…' : 'Score on a reshuffled site'), CHECK.busy ? h('span.spinner.sm') : null),
        ...CHECK.res.map((r) => h('div.scan-checkrow', null, h('span', null, 'Reshuffle ' + r.shuffle + ', never used for tuning'), h('b.num', null, (r.accuracy * 100).toFixed(1) + ' %'))), CHECK.res.length ? h('p.dim.scan-small', null, 'Void search on the same reshuffled sites: ' + CHECK.res.map((r) => { const V = r.voids.reduce((s, q) => s + q.volume, 0), E = r.voids.reduce((s, q) => s + q.volume * q.empty, 0); return r.voids.length + ' voids, ' + (V ? (E / V * 100).toFixed(0) : 0) + ' % of their volume really empty'; }).join('; ') + '.') : null, CHECK.err ? h('span.c-danger', { role: 'alert' }, CHECK.err) : null].filter(Boolean));
      draw(); return box;
    }
    const classOn = [true, true, true, true];
    function dockVoids(keep) {
      const d = S.data, V = d.voids, list = V.list, tot = list.reduce((s, v) => s + v.volume, 0);
      const params = keep || h('div.scan-voidparams', null,
        slider('Least headroom', 0.3, 1.2, 0.05, S.vp.minH, (v) => v.toFixed(2) + ' m', (v) => { S.vp.minH = v; rerunVoids(); }, 'A pocket must be at least this high over most of its floor'),
        slider('Least length', 0.8, 2.6, 0.1, S.vp.minL, (v) => v.toFixed(1) + ' m', (v) => { S.vp.minL = v; rerunVoids(); }, 'A pocket must have at least this much floor along its long axis'),
        h('label.check', { title: 'Search everywhere, not only where the scan is classed as rubble. Slower, and it will list ordinary sheltered spaces.' }, h('input', { type: 'checkbox', checked: S.vp.whole, onchange: (e) => { S.vp.whole = e.target.checked; rerunVoids(); } }), 'Search the whole scan, not only the collapsed zones'));
      const rows = list.map((v, i) => {
        const nl = nearestLead(v), cf = confidence(v);
        return h('button.scan-void', { 'aria-pressed': String(i === S.sel), onclick: () => selectVoid(i, true) },
          h('i.scan-voidbadge', null, v.id.replace('Void ', '')),
          h('span.scan-voidmain', null, h('b', null, v.volume.toFixed(1) + ' m³', h('span', null, ' · ' + v.clear.toFixed(1) + ' m headroom · ' + v.length.toFixed(1) + ' × ' + v.width.toFixed(1) + ' m floor')), h('em', null, v.kind)),
          h('span.scan-voidmeta', null,
            h('span', { title: 'Where the flood fill found the way from open air to the middle of the pocket' }, icon('route', 13), v.access ? (v.access.from === 'above' ? 'In from above' : 'In from the ' + v.access.from) + ', ' + v.access.crawl.toFixed(1) + ' m to the middle' : 'No open way in found'),
            h('span', { class: nl && nl.d < 3 ? 'hot' : '', title: 'Distance in plan from this pocket to the nearest thing the mission’s sensors have flagged' }, icon('person', 13), S.source !== 'site' ? 'No mission leads for this scan' : nl ? (nl.d < 0.05 ? nl.lead.id + ' is within its bounds' : nl.d.toFixed(1) + ' m from lead ' + nl.lead.id) + (nl.lead.confirmed ? ' (person)' : ' (possible)') : 'No leads yet'),
            cf ? h('span.tag.' + cf[1], { title: cf[2] }, cf[0]) : null));
      });
      const out = [panel('Survivable voids', { tag: realityTag('live-algo') },
        h('p.muted', null, 'The scan is cut into 20 cm cubes and free space is flood-filled from open air with a 0.6 m probe. A space it reaches is listed as a place someone could be alive when it lies under fallen material, is at least half closed in, has headroom and floor for a person' + (d.traj ? ', and goes no more than 0.6 m past where a beam went.' : '.')),
        params,
        h('div.scan-voidsum.num', null, list.length ? h('b', null, list.length + (list.length === 1 ? ' void' : ' voids') + ' · ' + tot.toFixed(0) + ' m³') : h('b', null, 'No void meets these limits'), h('span.dim', null, V.rejected + ' smaller pockets set aside · ' + (V.params.whole ? 'whole scan searched' : V.zones.length + (V.zones.length === 1 ? ' collapsed zone, ' : ' collapsed zones, ') + N(V.zoneArea) + ' m²') + (V.ms != null ? ' · ' + V.ms.toFixed(0) + ' ms' : ''))),
        list.length && list[0].empty != null ? h('div.scan-checkrow', { title: 'Simulated check against the model the scan was made from. The search never sees it.' }, h('span', null, 'Of that volume, really empty in the model'), h('b.num', null, (list.reduce((s, q) => s + q.volume * q.empty, 0) / tot * 100).toFixed(0) + ' %')) : null,
        list.length ? h('div.scan-voidlist', null, rows) : h('div.note', null, icon('info'), h('span', null, V.zones.length || V.params.whole ? 'Lower the limits to see the smaller pockets.' : 'Nothing in this scan is classed as a collapsed zone. Tick “search the whole scan” to look everywhere.')))];
      const v = list[S.sel];
      if (v) {
        const nl = nearestLead(v), R = S.route;
        out.push(panel(v.id + ': ' + v.kind.split(':')[0].toLowerCase(), null,
          kv([['Volume', v.volume.toFixed(1) + ' m³'], ['Headroom', v.clear.toFixed(2) + ' m', 'Over nine tenths of its floor'], ['Floor with that headroom', v.area.toFixed(1) + ' m² (' + v.length.toFixed(1) + ' × ' + v.width.toFixed(1) + ' m)'], ['Lying places', v.places ? String(v.places) + ' (assumed 2.0 × 0.6 m)' : 'none', 'How many 2.0 × 0.6 m rectangles pack onto the floor that has the headroom. The size of a person lying down is assumed.'], ['Cover slopes at', v.slope.toFixed(0) + '°'], ['Closed in', (v.enclosure * 100).toFixed(0) + ' % of its surface', 'Share of the pocket’s surface that touches scanned material or ground. The rest is open.'], ['Scanner saw into', v.seen == null ? 'not known (no scanner path in the file)' : (v.seen * 100).toFixed(0) + ' % of it', 'Share of the pocket that a beam actually passed through'], v.empty != null ? ['Really empty in the model', (v.empty * 100).toFixed(0) + ' % of it', 'Simulated check: the share of this space that is empty in the model the scan was made from. The search never sees this.'] : null, ['Centre', fmt.pos(S.source === 'plan' ? [v.centre[0] - PLAN_MARGIN, v.centre[1] - PLAN_MARGIN] : v.centre) + ' m']]),
          S.source === 'site' && nl ? h('button.btn.btn-sm', { title: 'Select this lead everywhere in the console', onclick: () => { ctx.select({ type: 'detection', id: nl.lead.id }); ctx.shell.toast(nl.lead.id + ' selected. Open Mission or Fusion to see its evidence.'); } }, icon('person'), 'Select lead ' + nl.lead.id + ' (' + nl.d.toFixed(1) + ' m away)') : null,
          S.source === 'site' ? h('button.btn' + (R ? '' : '.btn-primary'), { onclick: () => planTo(v) }, icon('route'), R ? 'Plan again' : 'Plan a way to ' + v.id) : null,
          R ? h('div.scan-route', null,
            h('div', null, h('i.solid'), h('span', null, 'On the map made from this scan'), h('b.num', null, R.scan.ok ? R.scan.length.toFixed(1) + ' m' : 'no way'), h('em', null, R.scan.ok ? (R.scan.reached ? 'reaches the opening' : 'stops ' + R.scan.gap.toFixed(1) + ' m short of the opening') : R.scan.reason)),
            h('div', null, h('i.dash'), h('span', null, 'On the planner’s own map'), h('b.num', null, R.planner.ok ? R.planner.length.toFixed(1) + ' m' : 'no way'), h('em', null, R.planner.ok ? (R.planner.reached ? 'reaches the opening' : 'stops ' + R.planner.gap.toFixed(1) + ' m short of the opening') : R.planner.reason)),
            h('p.dim.scan-small', null, 'From staging. The mission’s own route planner (A*), run on both maps in ' + R.ms.toFixed(0) + ' ms. Hazard costs are the mission’s; walls and obstacles come from the scan.')) : null));
      }
      if (S.source === 'site') out.push(h('div.note.quiet', null, icon('info'), h('span', null, 'The search limits were set by hand on this site, and the 0.6 m limit was added after comparing the list with the model. The list shows the method working on this site.')));
      out.push(h('div.note.warn', null, icon('alert'), h('span', null, 'A void is a place worth checking, not a finding. A scan cannot see into a sealed pocket, cannot tell an empty space from one it never saw into, and cannot tell whether anyone is there.')));
      return out;
    }
    function dockMap() {
      const d = S.data, occ = d.occ, cmp = S.compare, a = occ.areas;
      mapCanvas = h('canvas.scan-map', { role: 'img', 'aria-label': 'Top-down map made from the scan', onclick: (e) => { const g = mapCanvas.geo; if (!g) return; const r = mapCanvas.getBoundingClientRect(), x = occ.x0 + ((e.clientX - r.left - g.ox) / g.sc) * occ.res, y = occ.y0 + (occ.h - (e.clientY - r.top - g.oy) / g.sc) * occ.res; view.flyTo({ target: [x, y, d.bounds.min[2] + 1], dist: 30, az: 200, el: 42 }); } });
      const viewSeg = h('div.seg', { role: 'group', 'aria-label': 'Which map to show' });
      if (cmp) seg(viewSeg, [['diff', 'Where they differ'], ['scan', 'From the scan'], ['planner', 'Planner’s map']], () => S.mapView, (v) => { S.mapView = v; S.diffSel = null; refreshMapLayers(); drawDock(); });
      const key = (S.compare ? S.mapView : 'scan') === 'diff'
        ? [['#1a222e', 'Both clear', cmp.counts[1]], ['#626c79', 'Both blocked', cmp.counts[2]], [cssVar('--warn'), 'Scan only: obstacle', cmp.counts[3]], [cssVar('--accent'), 'Planner only: blocked', cmp.counts[4]], ['hatch', 'Scan never saw it', cmp.counts[5] + cmp.counts[6]]].map(([c, t, n]) => [c, t, N(n * cmp.cell) + ' m²'])
        : S.mapView === 'planner' && cmp ? [['#223144', 'Clear', ''], ['#ced7e2', 'Blocked', ''], ['#5a3a4a', 'Clear but costly (hazard)', '']]
        : [['#223144', 'Floor seen, clear', N(a[OCC.FREE]) + ' m²'], ['#ced7e2', 'Something in the way', N(a[OCC.BLOCKED]) + ' m²'], ['hatch2', 'Under cover, floor not seen', N(a[OCC.COVERED]) + ' m²'], ['hatch', 'Never seen', N(a[OCC.UNSEEN]) + ' m²']];
      const out = [panel(cmp ? (cmp.agreement * 100).toFixed(1) + ' % of what the scan saw agrees with the planner’s map' : 'The map made from this scan', { tag: realityTag('live-algo') },
        h('p.muted', null, 'The cloud is flattened into the 0.5 m grid the route planner uses. A cell is clear when its floor was seen and nothing stands between 0.2 and 1.9 m above it, blocked when something does, and unknown when no beam reached it.'),
        cmp ? viewSeg : null, mapCanvas,
        h('div.scan-key', null, key.map(([c, t, n]) => h('span', null, h('i', { class: c.startsWith('hatch') ? c : '', style: c.startsWith('hatch') ? null : { background: c } }), t, n ? h('b.num', null, n) : null))),
        h('label.check', null, h('input', { type: 'checkbox', checked: S.overlay, onchange: (e) => { S.overlay = e.target.checked; applyLayers(); } }), 'Lay this map over the cloud'),
        h('p.dim.scan-small', null, 'Click the map to fly there. ' + d.timings.map.toFixed(0) + ' ms on this device.'))];
      if (cmp) {
        const top = cmp.places.slice(0, 7);
        out.push(panel('Where the two maps differ, and why', null,
          h('div.scan-diffs', null, top.map((p) => h('button.scan-diff', { 'aria-pressed': String(S.diffSel === p), onclick: () => { S.diffSel = p; if (S.mapView !== 'diff') { S.mapView = 'diff'; refreshMapLayers(); } view.flyTo({ target: [p.pos[0], p.pos[1], d.bounds.min[2] + 1], dist: Math.max(26, Math.hypot(p.x1 - p.x0, p.y1 - p.y0) * 1.7), az: 200, el: 50 }); drawDock({ keepSliders: true }); } },
            h('i', { class: p.cat === 5 ? 'hatch' : '', style: p.cat === 5 ? null : { background: p.cat === 3 ? cssVar('--warn') : cssVar('--accent') } }), h('b', null, p.name), h('span.num', null, p.area.toFixed(0) + ' m²'),
            h('em', null, p.hz ? 'The planner keeps out by rule (' + p.hz + '). The scan sees clear floor.' : DIFF_SAY[p.cat])))),
          h('p.scan-small.muted', null, 'The planner’s map is drawn from the building plan; the scan is what was actually seen. Furniture and debris show up only in the scan. Rooms behind the blocked corridor were never entered, so the scan cannot vouch for their floor. The scan covered ' + (cmp.seenShare * 100).toFixed(0) + ' % of the site’s cells.')));
      } else out.push(panel('No planner map to compare with', null, h('p.muted', null, 'The mission’s planner only has a map of the exercise site. For your own scan the map above stands on its own: ' + N(a[OCC.FREE]) + ' m² of clear floor seen.')));
      return out;
    }

    // ------------------------------------------------------------------ bring your own: a file
    const fileInput = h('input', { type: 'file', accept: '.ply,.xyz,.txt,.csv,.pts,.asc', hidden: true, onchange: () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) openFile(f); } });
    const planInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async () => { const f = planInput.files[0]; planInput.value = ''; if (!f) return; try { editor.set(planFromJSON(await f.text())); ctx.shell.toast('Floor plan loaded: ' + editor.plan.walls.length + ' walls.', { level: 'ok' }); drawDock(); } catch (e) { ctx.shell.toast(e.message, { level: 'alert' }); } } });
    root.append(fileInput, planInput);
    async function openFile(f, up) {
      if (S.source !== 'file') { S.source = 'file'; drawSources(); }
      S.file = f; S.up = up || 'auto'; S.error = null;
      if (f.size > 700 * 1024 * 1024) { fail('This file is ' + (f.size / 1048576).toFixed(0) + ' MB. The browser can load scans up to about 700 MB. Thin it out and try again.'); return; }
      let buffer; try { buffer = await f.arrayBuffer(); } catch { fail('The file could not be read from disk.'); return; }
      await load('file', { name: f.name, buffer, up: S.up === 'auto' ? undefined : S.up }, [buffer]);
    }
    async function openSample() {
      try { const url = new URL('./samples/fallen-slab-room.ply', import.meta.url), r = await fetch(url); if (!r.ok) throw new Error('missing'); const buffer = await r.arrayBuffer(); openFile({ sample: true, name: 'fallen-slab-room.ply', size: buffer.byteLength, arrayBuffer: async () => buffer.slice(0) }); }
      catch { fail('The sample scan could not be downloaded. Check the connection and try again.'); }
    }
    function dockFile() {
      const d = S.data, out = [];
      out.push(panel('Bring your own scan', { tag: realityTag('device') },
        h('p.muted', null, 'Drop a point cloud anywhere on this workspace: .ply (ASCII or binary little-endian) or .xyz text. It stays on this computer. It is classified, searched for voids and turned into a map the same way as the exercise scan.'),
        h('div.row.wrap', null, h('button.btn' + (d ? '' : '.btn-primary'), { onclick: () => fileInput.click() }, icon('upload'), 'Choose a file'), h('button.btn', { title: 'A small simulated scan of a room with a fallen roof slab, 0.7 MB', onclick: openSample }, 'Load the sample scan')),
        S.error ? h('div.note.danger', { role: 'alert' }, icon('alert'), h('span', null, h('b', null, 'That file could not be loaded. '), S.error)) : null,
        h('p.dim.scan-small', null, 'Coordinates are read as metres. From phone apps such as Polycam or Scaniverse, export “PLY”. Scans above 1.5 million points are thinned to stay interactive.')));
      if (d && d.kind === 'file') {
        const upSeg = h('div.seg', { role: 'group', 'aria-label': 'Which axis points up in the file' });
        seg(upSeg, [['z', 'Z is up'], ['y', 'Y is up']], () => d.up, (v) => { if (v !== d.up && S.file) openFile(S.file, v); });
        out.push(panel(d.name, null, h('div.row', null, h('span.muted.grow', null, 'If the scan lies on its side, switch this'), upSeg),
          ...(d.warnings || []).map((w) => h('div.note.warn', null, icon('alert'), h('span', null, w)))));
        out.push(facts(), display());
      }
      return out;
    }

    // ------------------------------------------------------------------ bring your own: a floor plan
    const editor = createPlanEditor(planHost, ctx.kit, () => { if (S.source === 'plan' && !S.planScanned && S.step === 'capture') drawWalls(); });
    let wallsBox = null, planTool = 'wall', planMat = 'concrete';
    function drawWalls() {
      if (!wallsBox) return; const p = editor.plan;
      wallsBox.replaceChildren(p.walls.length ? h('table.table', null, h('thead', null, h('tr', null, h('th', null, 'From'), h('th', null, 'To'), h('th', null, 'Length'), h('th', null, ''))), h('tbody', null, p.walls.map((w, i) => h('tr', null, h('td', null, w.a.join(', ')), h('td', null, w.b.join(', ')), h('td', null, Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]).toFixed(1) + ' m ' + (w.mat === 'concrete' ? 'concrete' : 'drywall')), h('td', null, h('button.btn.btn-ghost.btn-sm', { 'aria-label': 'Remove wall ' + (i + 1), onclick: () => editor.removeWall(i) }, icon('close', 13))))))) : h('p.muted', null, 'No walls yet. Drag on the grid to draw one.'));
    }
    function dockPlan() {
      const p = editor.plan, toolSeg = h('div.seg', { role: 'group', 'aria-label': 'Drawing tool' }), matSeg = h('div.seg', { role: 'group', 'aria-label': 'Wall material' });
      seg(toolSeg, [['wall', 'Wall', 'Drag from one grid point to another'], ['rubble', 'Rubble pile', 'Click to drop a pile'], ['erase', 'Erase', 'Click a wall or a pile to remove it']], () => planTool, (v) => { planTool = v; editor.setTool(v); });
      seg(matSeg, [['concrete', 'Concrete'], ['drywall', 'Drywall']], () => planMat, (v) => { planMat = v; editor.setMat(v); });
      const num = (label, v, min, max, step = 0.5) => h('input.input.num', { type: 'number', 'aria-label': label, title: label, value: v, min, max, step });
      const sw = num('Width, metres', p.size[0], 6, 60, 1), sh = num('Depth, metres', p.size[1], 6, 60, 1), wh = num('Wall height, metres', p.wallHeight, 2, 6, 0.1);
      const size = () => { const w = Math.min(60, Math.max(6, +sw.value || 24)), hh = Math.min(60, Math.max(6, +sh.value || 16)); editor.setSize(w, hh); editor.plan.wallHeight = Math.min(6, Math.max(2, +wh.value || 3)); };
      sw.onchange = sh.onchange = wh.onchange = size;
      const x1 = num('From, east', 2, 0, 60), y1 = num('From, north', 2, 0, 60), x2 = num('To, east', 8, 0, 60), y2 = num('To, north', 2, 0, 60);
      wallsBox = h('div.scan-walls');
      const out = [panel('Draw a building', { tag: realityTag('device') },
        h('p.muted', null, 'Draw walls on the 0.5 m grid, drop rubble where the roof came down, then scan it. The scan of your drawing is simulated; the classification, void search and map run on it for real.'),
        h('div.row.wrap', null, toolSeg, matSeg),
        h('div.scan-planrow', null, h('span.dim', null, 'Plot'), sw, h('span.dim', null, '×'), sh, h('span.dim', null, 'm, walls'), wh, h('span.dim', null, 'm high')),
        h('div.row.wrap', null, h('button.btn.btn-sm', { onclick: () => { if (!editor.undo()) ctx.shell.toast('Nothing to undo.'); drawDock(); } }, 'Undo'), h('button.btn.btn-sm', { onclick: () => { editor.set(EXAMPLE_PLAN); drawDock(); } }, 'Load the example'), h('button.btn.btn-sm', { onclick: async () => { if (await ctx.shell.confirm({ title: 'Clear the plan?', body: 'Every wall and rubble pile is removed. Undo brings them back.', confirmLabel: 'Clear', danger: true })) editor.clear(); } }, 'Clear')),
        h('button.btn.btn-primary.btn-lg', { onclick: scanPlanNow }, icon('scan'), 'Scan this building'))];
      out.push(panel('Walls', { actions: [h('span.dim.num', null, p.walls.length + ' walls, ' + p.rubble.length + ' piles')] },
        h('div.scan-planrow', { title: 'Add a wall by its end points, in metres from the south-west corner' }, x1, y1, h('span.dim', null, 'to'), x2, y2, h('button.btn.btn-sm', { onclick: () => { const a = [+x1.value, +y1.value], b = [+x2.value, +y2.value]; if (![...a, ...b].every(isFinite) || Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5) { ctx.shell.toast('A wall needs two different end points at least 0.5 m apart.'); return; } editor.addWall(a, b, planMat); } }, 'Add wall')),
        wallsBox));
      out.push(panel('Save and load', null, h('p.muted', null, 'The plan is saved as plain JSON: walls as pairs of points in metres, the same shape the console’s own scenario uses.'),
        h('div.row.wrap', null, h('button.btn', { onclick: () => { download(new Blob([planToJSON(editor.plan)], { type: 'application/json' }), 'hound-floorplan.json'); ctx.shell.toast('Floor plan saved as hound-floorplan.json.', { level: 'ok' }); } }, icon('download'), 'Export JSON'), h('button.btn', { onclick: () => planInput.click() }, icon('upload'), 'Import JSON'))));
      drawWalls();
      return out;
    }
    async function scanPlanNow() {
      const p = editor.plan;
      if (!p.walls.length) { ctx.shell.toast('Draw at least one wall first.'); return; }
      S.planScanned = true; applyLayers();
      const ok = await load('plan', { plan: JSON.parse(JSON.stringify(p)) });
      if (!ok) { S.planScanned = false; refreshAll(); }
    }

    // ------------------------------------------------------------------ loading
    let job = 0;
    function showVeil(f, text) {
      if (demo()) { veil.hidden = true; filmBox.classList.add('loading'); film.say.textContent = (text || 'Starting') + '…'; return; } veil.hidden = false; veil.replaceChildren(h('div.scan-veilbox.glass', { role: 'status' }, h('div.spinner'), h('div', null, h('b', null, text || 'Working…'), h('div.bar', null, h('i', { style: { width: (f * 100).toFixed(0) + '%' } }))))); }
    function fail(msg) {
      if (demo()) film.say.textContent = '';
      S.error = msg; S.busy = false; veil.hidden = true;
      if (S.source === 'file') { S.data = null; view.setCloud(null); refreshAll(); return; }
      veil.hidden = false; veil.replaceChildren(h('div.scan-veilbox.glass.col', { role: 'alert' }, h('div.row', null, icon('alert', 22), h('b', null, 'The scan could not be prepared')), h('p.muted', null, msg), h('button.btn.btn-primary', { onclick: () => setSource(S.source) }, 'Try again')));
    }
    async function load(op, payload = {}, transfer = []) {
      if (op === 'site') view.setPreview(demo());
      const id = ++job; S.busy = true; S.error = null; stopReplay(); showVeil(0.01, op === 'file' ? 'Reading ' + payload.name : 'Starting');
      try {
        const d = await client.run(op, payload, (f, t, part) => { if (id !== job) return; showVeil(f, t); if (part) view.addPreview(part); }, transfer);
        if (id !== job) return false;
        veil.hidden = true; S.busy = false; setData(d); return true;
      } catch (e) { if (id === job) fail(e.message || String(e)); return false; }
    }
    function setData(d) {
      stopFilm(); S.data = d; S.sel = -1; S.route = null; S.diffSel = null; S.vp = { minH: 0.5, minL: 1.2, whole: false };
      classOn.fill(true); for (let i = 0; i < 4; i++) view.setClassVisible(i, true);
      view.setCloud(d); view.setShading(shading); view.setVoids(d.voids.list); view.setZones(d.voids.zones); view.setSection({ on: false, axis: 'z', value: d.bounds.min[2] + 2.6, slab: 0 });
      S.compare = d.kind === 'site' ? compareWithPlanner(d.occ) : null; if (!S.compare) S.mapView = 'scan'; else S.mapView = 'diff';
      if ((S.mode === 'time' && !d.time) || (S.mode === 'rgb' && !d.rgb)) S.mode = 'height';
      if (d.rgb && d.kind === 'file' && S.step !== 'classify') S.mode = 'rgb';
      view.setMode(S.mode); view.setLit(lit); leadSig = ''; readLeads(true); refreshMapLayers(); refreshAll();
      if (d.kind === 'file') ctx.shell.toast(d.name + ': ' + N(d.n) + ' points loaded, ' + d.voids.list.length + ' voids found.', { level: 'ok' });
      maybeAutoplay();
    }
    function maybeAutoplay() {
      if (!S.shown) return;
      if (demo()) { if (!film.hero && view.data && view.data === filmData()) startFilm(); return; }
      if (!S.data) return;
      if (S.played || S.source !== 'site') return;
      S.played = true;
      if (reduced() || !S.auto) return;
      if (S.step === 'capture') startReplay(0);
    }
    function refreshAll() { drawSources(); drawSteps(); drawModeSeg(); drawLegend(); drawTools(); drawSectionBar(); drawStat(); applyLayers(); drawDock(); drawTransport(); btnPly.disabled = !S.data; }
    function drawSources() {
      seg(srcSeg, SOURCES.map(([v, l]) => [v, l, v === 'site' ? 'The simulated scan of the exercise site' : v === 'file' ? 'Load a .ply or .xyz file from this computer' : 'Draw walls and scan your own building']), () => S.source, (v) => setSource(v));
      tagSource.replaceChildren(S.source === 'file' && !(S.file && S.file.sample) ? h('span.tag.tag-ok', { title: 'The points come from a file on this computer.' }, 'on your file') : h('span.tag.tag-sim', { title: 'The scan itself is simulated. The algorithms that read it are real and run now.' }, S.source === 'plan' ? 'on a simulated scan of your plan' : 'on a simulated scan'));
    }
    function setSource(src) {
      job++; veil.hidden = true; S.source = src; S.data = null; S.compare = null; S.sel = -1; S.route = null; S.error = null; S.planScanned = false; S.auto = S.auto && src === 'site';
      stopFilm(); stopReplay(); view.setCloud(null); view.setTool('orbit'); if (S.step !== 'capture') S.step = 'capture'; if (S.mode === 'class') S.mode = 'height'; view.setMode(S.mode);
      leadSig = ''; S.leads = []; refreshAll();
      if (src === 'site') { if (demo()) showBake(); else load('site'); }
      else if (src === 'file' && S.file) openFile(S.file, S.up);
      else if (src === 'plan') { editor.setTool(planTool); editor.redraw(); }
    }

    // ------------------------------------------------------------------ save things
    function download(blob, name) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    function screenshot() {
      const planEdit = S.source === 'plan' && !S.planScanned, src = planEdit ? editor.el : view.screenshot();
      if (!planEdit && !S.data) { ctx.shell.toast('There is no scan on screen yet.'); return; }
      const cv = document.createElement('canvas'), bar = Math.round(src.height * 0.045) + 18; cv.width = src.width; cv.height = src.height + bar;
      const c = cv.getContext('2d'); c.fillStyle = cssVar('--bg-0'); c.fillRect(0, 0, cv.width, cv.height); c.drawImage(src, 0, 0);
      c.fillStyle = cssVar('--bg-1'); c.fillRect(0, src.height, cv.width, bar); c.fillStyle = cssVar('--text-2'); c.font = Math.round(bar * 0.4) + 'px ' + cssVar('--font'); c.textBaseline = 'middle';
      const d = S.data, what = planEdit ? 'Floor plan drawing' : (S.source === 'file' ? (S.file && S.file.sample ? 'Simulated sample scan ' : '') + d.name : S.source === 'plan' ? 'Simulated scan of a drawn floor plan' : 'Simulated scan, training exercise, Timure') + ' · ' + N(d.n) + ' points · ' + STEPS.find((s) => s.id === S.step).title;
      c.fillText('HOUND Command · 3-D scan · ' + what, bar * 0.4, src.height + bar / 2); c.textAlign = 'right'; c.fillText(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', cv.width - bar * 0.4, src.height + bar / 2);
      cv.toBlob((b) => { if (!b) { ctx.shell.toast('The picture could not be made.', { level: 'alert' }); return; } download(b, 'hound-scan-' + S.step + '.png'); ctx.shell.toast('Screenshot saved as hound-scan-' + S.step + '.png.', { level: 'ok' }); }, 'image/png');
    }
    function exportPly() {
      const d = S.data; if (!d) return;
      download(new Blob([writePLY(d.pos, d.n, d.inten, d.cls)], { type: 'application/octet-stream' }), 'hound-scan.ply');
      ctx.shell.toast('Saved hound-scan.ply: ' + N(d.n) + ' points with intensity and class.', { level: 'ok' });
    }

    // ------------------------------------------------------------------ drag and drop
    let dragDepth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    root.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; dropVeil.hidden = false; });
    root.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    root.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropVeil.hidden = true; });
    root.addEventListener('drop', async (e) => {
      if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; dropVeil.hidden = true;
      const f = e.dataTransfer.files[0]; if (!f) return;
      if (/\.json$/i.test(f.name)) { try { const p = planFromJSON(await f.text()); setSource('plan'); editor.set(p); drawDock(); ctx.shell.toast('Floor plan loaded: ' + p.walls.length + ' walls.', { level: 'ok' }); } catch (err) { ctx.shell.toast(err.message, { level: 'alert' }); } return; }
      S.step = 'capture'; openFile(f);
    });

    // ------------------------------------------------------------------ the rest of the console
    const offs = [
      ctx.bus.on('detection', () => readLeads()), ctx.bus.on('reset', () => readLeads(true)), ctx.bus.on('seek', () => readLeads(true)),
      ctx.bus.on('tick', () => { if (S.shown && !film.hero) readLeads(); }),
      ctx.bus.on('mode', () => onMode()),
      ctx.bus.on('route', () => { if (S.shown && S.compare && S.data) { S.compare = compareWithPlanner(S.data.occ); if (S.step === 'map') { refreshMapLayers(); drawDock(); } drawSteps(); } }),
      ctx.bus.on('prefs', () => { view.setClassColors(classColors()); drawLegend(); if (S.data) { refreshMapLayers(); drawDock(); } editor.redraw(); }),
      ctx.bus.on('escape', () => { if (!S.shown) return; if (view.tool === 'measure') { view.setTool('orbit'); view.clearMeasure(); drawTools(); tip(); } }),
      ctx.bus.on('select', (sel) => { if (!S.shown || !sel || S.source !== 'site' || !S.data) return; const st = ctx.sim.state; let p = null; if (sel.type === 'detection') p = st.detections.find((x) => x.id === sel.id)?.pos; else if (sel.type === 'survivor') p = st.survivors[sel.id]?.pos; else if (sel.type === 'room') { const r = world.roomById(sel.id); if (r) p = [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2]; } if (p && !film.hero) view.flyTo({ target: [p[0], p[1], 1], dist: 30, az: 205, el: 40 }); }),
    ];
    root.__scan = { S, view, film, client, openFile, setStep, setSource, selectVoid, startReplay, stopReplay, editor, planTo, toggleSection }; // handle for the automated checks
    refreshAll();
    setSource('site');

    return {
      onShow() { S.shown = true; view.start(); readLeads(true); maybeAutoplay(); if (S.source === 'plan') editor.redraw(); },
      onHide() { S.shown = false; pauseReplay(); view.stop(); },
      onParams(p) { if (p && p.step && STEPS.some((s) => s.id === p.step) && S.data) setStep(p.step, true); if (p && p.source && SOURCES.some((s) => s[0] === p.source) && p.source !== S.source) setSource(p.source); },
    };
  },
};
