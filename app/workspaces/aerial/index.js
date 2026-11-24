// Drone imagery: turning cheap aerial pictures into places to check.
//
// Three working methods, each labelled:
//   Find people      Live AI          a pretrained detector (D-FINE nano, COCO) running in this browser (detect.worker.js)
//   Colour anomaly   Live algorithm   the RX detector: Mahalanobis distance from the scene's colour model (cv.worker.js)
//   Before / after   Live algorithm   registration + exposure match + structure and colour difference (cv.worker.js)
// The frames: synthetic scenes drawn by scenes.js with exact ground truth, a simulated mosaic of the exercise site,
// two real drone photographs (CC BY 2.0), and whatever the user drops in. Ground truth is only ever the truth of
// our own synthetic test frames; nothing here reads the mission's ground truth.
import { createViewer } from './viewer.js';
import { BENCH, CBENCH, DIFFS, pairSetup, nms, tileGrid, iouOf, colourName, eig3 } from './shared.js';
import { conceptPanel } from './concepts.js';
import { createHero } from './hero.js';

const MAX_WORK = 1.6e6;          // pixels: larger images are analysed at this size (the detector still sees full resolution)
const SITE_PPM = 12;
const RX_DEFAULT = 8, CHG_DEFAULT = 0.6, DET_DEFAULT = 0.3, OVERLAP = 0.4;
const REAL = [
  { id: 'R-01', name: 'Beach, straight down', src: 'real-jandia-beach.jpg', credit: 'dronepicr, CC BY 2.0, via Wikimedia Commons', page: 'https://commons.wikimedia.org/wiki/File:Aerial_view_of_beach_volleyball_courts_on_Jandia_Beach_on_Fuerteventura,_Canary_Islands.jpg', tile: 448 },
  { id: 'R-02', name: 'Crowded bay', src: 'real-nissi-beach.jpg', credit: 'dronepicr, CC BY 2.0, via Wikimedia Commons', page: 'https://commons.wikimedia.org/wiki/File:Nissi_beach_aerial_Cyprus_(29852122168).jpg', tile: 448 },
];

function rpc(worker, onCrash) {
  let n = 0; const pending = new Map();
  worker.onmessage = (e) => { const m = e.data, p = pending.get(m.id); if (!p) return; if (m.type === 'done' || m.type === 'ready') { pending.delete(m.id); p.res(m.type === 'ready' ? m : m.result); } else if (m.type === 'error') { pending.delete(m.id); p.rej(new Error(m.message)); } else p.on?.(m); };
  worker.onerror = (e) => { e.preventDefault?.(); const err = new Error(e.message || 'The worker could not start.'); for (const p of pending.values()) p.rej(err); pending.clear(); onCrash?.(err); };
  return (op, args = {}, transfer = [], on) => new Promise((res, rej) => { const id = ++n; pending.set(id, { res, rej, on }); worker.postMessage({ id, op, ...args }, transfer); });
}

export default {
  async mount(root, ctx) {
    const { kit, bus, world, shell } = ctx, { h, icon, realityTag, fmt } = kit;
    if (!document.querySelector('link[data-aerial]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href, 'data-aerial': '' }));
    const css = (n) => kit.cssVar(n);
    const offs = [];

    // ---------- workers ----------
    let cv = null, cvErr = null, det = null, bench = null;
    try { cv = rpc(new Worker(new URL('./cv.worker.js', import.meta.url), { type: 'module' }), (e) => { cvErr = e; }); } catch (e) { cvErr = e; }
    const benchRpc = () => (bench ??= rpc(new Worker(new URL('./cv.worker.js', import.meta.url), { type: 'module' })));

    // ---------- state ----------
    const st = {
      tool: 'people', frameId: null, reveal: false, sel: null, hover: null, shown: false,
      det: { status: 'idle', loaded: 0, total: 0, stage: '', minScore: DET_DEFAULT, show: 'tiled' },
      rx: { mode: 'global', thr: RX_DEFAULT, token: 0 },
      chg: { method: 'robust', thr: CHG_DEFAULT, swipe: 0.5, token: 0, current: null },
      run: null, bench: { rx: null, change: null, det: null, rxState: 'idle', detState: 'idle', row: 'rx-local' },
    };
    const frames = new Map(), order = [];
    const cur = () => frames.get(st.frameId);
    const S = () => ctx.sim.state;

    // ---------- the mission plug-in: the one way this workspace changes the mission ----------
    if (!ctx.sim.__aerialLead) {
      ctx.sim.__aerialLead = true;
      ctx.sim.use({ commands: { aerialLead(args, api) {
        const M = api.state, pos = args.pos; if (!Array.isArray(pos) || !isFinite(pos[0]) || !isFinite(pos[1])) return false;
        M.aerial ??= { leads: [] };
        if (M.aerial.leads.some((l) => Math.hypot(l.pos[0] - pos[0], l.pos[1] - pos[1]) < 2)) return false;
        const near = M.detections.find((d) => d.pos && Math.hypot(d.pos[0] - pos[0], d.pos[1] - pos[1]) < 4) || null;
        const lead = { id: 'AL' + (M.aerial.leads.length + 1), t: M.t, pos: [+pos[0].toFixed(1), +pos[1].toFixed(1)], px: args.px, method: args.method, score: args.score, colour: args.colour || null, frame: args.frame, matches: near ? near.id : null };
        M.aerial.leads.push(lead);
        const what = args.method === 'people' ? 'a person-shaped object' : 'an unusual colour' + (args.colour ? ' (' + args.colour + ')' : '');
        api.log(near ? 'ok' : 'warn', 'AERIAL_LEAD', near
          ? 'Drone imagery, second method: ' + what + ' at ' + lead.pos.join(', ') + ' m agrees with lead ' + near.id + '.'
          : 'New lead from the drone imagery: ' + what + ' at ' + lead.pos.join(', ') + ' m. No other sensor has seen it. It needs a ground check.', { pos: lead.pos, det: near ? near.id : undefined });
        return true;
      } } });
    }

    // ---------- layout ----------
    root.classList.add('aerial');
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr-only', tabindex: -1, onchange: (e) => { addFiles(e.target.files); e.target.value = ''; } });
    const revealBox = h('input', { type: 'checkbox', onchange: (e) => { st.reveal = e.target.checked; renderSide(); viewer.kick(); } });
    const head = h('header.ws-head.aerial-head', null,
      h('div', null, h('h1', null, 'Drone imagery'), h('p', null, 'A cheap camera drone photographs the site. Three methods turn the pictures into places to check: a neural network that looks for people, a colour test that looks for clothing, and a before/after comparison that shows what moved.')),
      h('label.check.aerial-reveal', { title: 'Marks where the figures were drawn in the synthetic test frames. It is the truth of our own test images, not of the mission.' }, revealBox, h('span', null, 'Show test-frame truth')),
      h('button.btn', { onclick: () => fileInput.click() }, icon('upload'), 'Add your image'), fileInput, realityTag('live-ai'));

    const film = h('nav.aerial-film', { 'aria-label': 'Frames' });
    const TOOLS = [
      { id: 'people', label: 'Find people', sub: 'Neural network', reality: 'live-ai' },
      { id: 'rx', label: 'Colour anomaly', sub: 'RX detector', reality: 'live-algo' },
      { id: 'change', label: 'Before / after', sub: 'Change detection', reality: 'live-algo' },
    ];
    const toolSeg = h('div.aerial-toolseg', { role: 'tablist', 'aria-label': 'Method' }, ...TOOLS.map((t) => h('button', { role: 'tab', id: 'aerial-tab-' + t.id, 'aria-selected': 'false', onclick: () => setTool(t.id) }, h('b', null, t.label), h('span', null, t.sub), realityTag(t.reality))));
    const viewHost = h('div.aerial-view');
    const hudMeta = h('div.aerial-hud.aerial-hud-meta.glass');
    const hudCoord = h('div.aerial-hud.aerial-hud-coord.glass.num', { 'aria-hidden': 'true' });
    const hudScale = h('div.aerial-hud.aerial-hud-scale', { 'aria-hidden': 'true' }, h('i'), h('span.num'));
    const hudRun = h('div.aerial-hud.aerial-hud-run.glass', { role: 'status', hidden: true });
    const hudZoom = h('div.aerial-hud.aerial-hud-zoom.glass', null,
      h('button.btn.btn-ghost.btn-sm.btn-icon', { 'aria-label': 'Zoom in', title: 'Zoom in (+)', onclick: () => viewer.zoom(1.5) }, '+'),
      h('button.btn.btn-ghost.btn-sm.btn-icon', { 'aria-label': 'Zoom out', title: 'Zoom out (-)', onclick: () => viewer.zoom(1 / 1.5) }, '−'),
      h('button.btn.btn-ghost.btn-sm', { 'aria-label': 'Fit the frame to the view', title: 'Fit (0)', onclick: () => viewer.flyTo('fit') }, 'Fit'));
    const cover = h('div.aerial-cover', { hidden: true });
    const dropHint = h('div.aerial-drop', { hidden: true }, icon('upload', 28), h('b', null, 'Drop an aerial photo'), h('span', null, 'It stays on this computer. All three methods will run on it.'));
    viewHost.append(hudMeta, hudZoom, hudCoord, hudScale, hudRun, cover, dropHint);
    const stage = h('section.aerial-stage', { 'aria-label': 'Frame viewer' }, toolSeg, viewHost);
    const side = h('aside.aerial-side', { 'aria-label': 'Method controls and results' });
    const scorePanel = h('section.aerial-card.aerial-score', { 'aria-label': 'Measured on the synthetic test set' });
    const missionPanel = h('section.aerial-card.aerial-mission', { 'aria-label': 'Link to the mission' });
    const strip = h('div.aerial-strip', null, scorePanel, missionPanel, conceptPanel(kit));
    const advanced = h('div.aerial-adv.adv-only', null, head, h('div.aerial-main', null, film, stage, side), strip), demo = h('section.aerial-demo.demo-only', { 'aria-label': 'Drone imagery, the short film' });
    root.append(advanced, demo);

    // ---------- viewer ----------
    const viewer = createViewer(viewHost, { h, reduced: kit.reducedMotion,
      onHover(p) { st.hover = p; updateCoord(); },
      onPick(p) { pickAt(p); },
      grab(x, y, phase) {
        if (st.tool !== 'change' || !cur()?.res.change) return null;
        const sx = swipeX(); if (Math.abs(x - sx) > 12) return null;
        if (phase === 'hover') return true;
        return (nx) => { const f = cur(), v = viewer.view; st.chg.swipe = Math.min(1, Math.max(0, ((nx - v.x) / v.s) / f.w)); swipeRange.value = String(Math.round(st.chg.swipe * 100)); };
      } });
    const swipeX = () => { const f = cur(), v = viewer.view; return v.x + f.w * st.chg.swipe * v.s; };
    const swipeRange = h('input.aerial-swipe-range.sr-only', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Before and after divider position', oninput: (e) => { st.chg.swipe = e.target.value / 100; viewer.kick(); } });
    viewHost.append(swipeRange);

    // ---------- recorded detector runs ----------
    // data/aerial/recorded.json holds this same detector's own output on the frames, run once in this page and saved,
    // so the first view never waits for a download. It is always labelled "Recorded run" and can be run live.
    let recorded = null;
    const recReady = (async () => { try { const r = await fetch(new URL('../../../data/aerial/recorded.json', import.meta.url)); if (r.ok) { recorded = await r.json(); const b = recorded.bench; if (b) st.bench.det = { ...b, recorded: recorded.when, perFigure: b.perFigure.map(([frame, id, difficulty, whole, tiled]) => ({ frame, id, difficulty, whole: !!whole, tiled: !!tiled })) }; } } catch { /* no recording: the live detector still works */ } })();
    function recordedFor(f) {
      const r = recorded?.frames[f.id]; if (!r || r.w !== f.w || r.h !== f.h) return null;
      const bx = (a) => a.map((b) => ({ score: b[0], box: b.slice(1) }));
      return { recorded: recorded.when, whole: { boxes: bx(r.whole), ms: r.wholeMs }, tiled: { boxes: bx(r.boxes), raw: r.raw, ms: r.ms, tile: r.tile, grid: tileGrid(r.w, r.h, r.tile, OVERLAP).map((t, i) => ({ ...t, n: r.n[i] })) }, others: r.others };
    }

    // ---------- frames ----------
    function addFrame(f) { f.status = 'idle'; f.res = { people: null, rx: {}, change: null }; f.el = null; frames.set(f.id, f); order.push(f.id); return f; }
    BENCH.seeds.slice(0, 4).forEach((seed, i) => addFrame({ id: 'S-0' + (i + 1), group: 'Synthetic test frames', kind: 'synthetic', name: ['Collapsed masonry', 'Debris flow', 'Village roofs', 'Mixed damage'][i],
      spec: { seed, w: BENCH.w, h: BENCH.h, pxPerM: BENCH.pxPerM, theme: BENCH.themes[i], figures: BENCH.figures }, noiseSeed: seed, pxPerM: BENCH.pxPerM, tile: 448,
      pair: { earlier: 'A', label: ['First flight', 'Second flight, after an aftershock'] } }));
    const site = addFrame({ id: 'SITE', group: 'This mission', kind: 'site', name: 'Site mosaic, Block B', pxPerM: SITE_PPM, tile: 448, pair: { earlier: 'B', label: ['Before the flood', 'Drone survey, now'] } });
    order.splice(order.indexOf('SITE'), 1); order.unshift('SITE');
    for (const r of REAL) addFrame({ ...r, group: 'Real drone photos', kind: 'real', url: new URL('../../../assets/img/aerial/' + r.src, import.meta.url).href });

    // Illustrations made by an image generator for this project (assets/img/gen). Listed in data/aerial/frames.json;
    // if the list or a file is missing, the group simply does not appear.
    const genReady = (async () => {
      try {
        const resp = await fetch(new URL('../../../data/aerial/frames.json', import.meta.url)); if (!resp.ok) return;
        const list = (await resp.json()).generated || [];
        list.forEach((g, i) => { const f = addFrame({ id: 'G-0' + (i + 1), group: 'AI-generated scenes', kind: 'gen', name: g.name, asked: g.asked, tile: g.tile || 320, url: new URL('../../../' + g.src, import.meta.url).href, pairUrl: g.before ? new URL('../../../' + g.before, import.meta.url).href : null });
          if (g.before) f.pair = { earlier: 'B', label: ['Before (generated)', 'After (generated)'], gen: true }; });
        buildFilm();
      } catch { /* no generated frames: carry on without them */ }
    })();

    const worldData = () => JSON.parse(JSON.stringify({ SITE: world.SITE, BUILDING: world.BUILDING, ROOMS: world.ROOMS, OBSTACLES: world.OBSTACLES, HAZARDS: world.HAZARDS }));
    const outdoorLeads = () => S().detections.filter((d) => d.outdoor && d.pos).map((d) => ({ id: d.id, pos: d.pos.slice() }));
    const teamHome = () => { const u = world.UNITS.find((x) => x.kind === 'team'); return u ? [u.home.slice(), [u.home[0] + 1.3, u.home[1] + 0.7]] : []; };
    const siteSpec = (before = false) => ({ site: true, world: worldData(), leads: before ? [] : outdoorLeads(), team: before ? [] : teamHome(), pxPerM: SITE_PPM, before });
    const siteSig = () => outdoorLeads().map((l) => l.id + l.pos.map((v) => v.toFixed(1))).join('|');
    const swathSig = () => { const m = S().map; return m.ready ? 'all' : m.swaths.map((s) => s.y + ':' + Math.round(s.x0) + ':' + Math.round(s.x1)).join('|'); };
    const siteRects = () => { const m = S().map; if (m.ready) return null; return m.swaths.map((s) => [Math.min(s.x0, s.x1) * SITE_PPM, (world.SITE.h - s.y - s.half) * SITE_PPM, Math.max(s.x0, s.x1) * SITE_PPM, (world.SITE.h - s.y + s.half) * SITE_PPM]); };
    const sitePx = (p) => [p[0] * SITE_PPM, (world.SITE.h - p[1]) * SITE_PPM];
    const siteM = (x, y) => [x / SITE_PPM, world.SITE.h - y / SITE_PPM];

    function canvasFrom(src, w, h2) { const c = document.createElement('canvas'); c.width = w; c.height = h2; c.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0, w, h2); return c; }
    async function putWork(f) {   // send the analysis copy of an ordinary image to the worker
      const scale = Math.min(1, Math.sqrt(MAX_WORK / (f.w * f.h))), w = Math.round(f.w * scale), hh = Math.round(f.h * scale);
      const c = scale === 1 ? f.canvas : canvasFrom(f.canvas, w, hh), id = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, hh);
      f.work = { key: f.id, w, h: hh, scale: w / f.w };
      if (cv) await cv('put', { key: f.id, rgba: id.data.buffer, w, h: hh }, [id.data.buffer]);
    }
    async function loadFrame(f) {
      if (f.status === 'loading') return f.loading;
      f.status = 'loading'; paintFilm(f);
      f.loading = (async () => {
        try {
          await recReady;
          if (f.kind === 'synthetic' || f.kind === 'site') {
            if (!cv) throw new Error('The analysis worker did not start' + (cvErr ? ' (' + cvErr.message + ')' : '') + '.');
            const spec = f.kind === 'site' ? siteSpec() : f.spec; if (f.kind === 'site') f.sig = siteSig();
            const r = await cv('scene', { key: f.id, spec, noiseSeed: f.noiseSeed ?? 7 });
            f.w = r.w; f.h = r.h; f.canvas = canvasFrom(r.bitmap, r.w, r.h); r.bitmap.close?.(); f.truth = r.truth; f.renderMs = r.ms; f.work = { key: f.id, w: r.w, h: r.h, scale: 1 };
            if (f.kind === 'synthetic') f.name = f.truth.name || f.name;
          } else {
            let bmp;
            if (f.file) bmp = await createImageBitmap(f.file);
            else { const resp = await fetch(f.url); if (!resp.ok) throw new Error('The image could not be fetched (' + resp.status + ').'); bmp = await createImageBitmap(await resp.blob()); }
            const lim = 4096, k = Math.min(1, lim / Math.max(bmp.width, bmp.height));
            f.w = Math.round(bmp.width * k); f.h = Math.round(bmp.height * k); f.canvas = canvasFrom(bmp, f.w, f.h); bmp.close?.();
            await putWork(f);
            if (f.pairUrl && cv) {   // the generated "before" picture of the same place
              const r2 = await fetch(f.pairUrl); if (r2.ok) { const b2 = await createImageBitmap(await r2.blob()), c2 = canvasFrom(b2, f.work.w, f.work.h); b2.close?.(); const id2 = c2.getContext('2d').getImageData(0, 0, f.work.w, f.work.h); await cv('put', { key: f.id + '|B', rgba: id2.data.buffer, w: f.work.w, h: f.work.h }, [id2.data.buffer]); } else f.pair = null;
            }
          }
          f.res = { people: recordedFor(f), rx: {}, change: null }; f.status = 'ready'; f.error = null;
        } catch (e) { f.status = 'error'; f.error = String(e.message || e); }
        paintFilm(f);
        if (st.frameId === f.id) onFrameReady();
      })();
      return f.loading;
    }
    function addFiles(list) {
      const imgs = [...list].filter((x) => x.type.startsWith('image/'));
      if (!imgs.length) { shell.toast('That file is not an image. Drop a JPEG or PNG photo.', { level: 'info' }); return; }
      // In Before / after on a frame of your own, a dropped image becomes the second look at the same ground.
      const f0 = cur();
      if (st.tool === 'change' && f0 && f0.kind === 'user' && !f0.pair && imgs.length === 1) { attachSecond(f0, imgs[0]); return; }
      let first = null;
      for (const file of imgs) { const n = [...frames.values()].filter((x) => x.kind === 'user').length + 1; const f = addFrame({ id: 'U-' + String(n).padStart(2, '0'), group: 'Your images', kind: 'user', name: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 28) || 'Your image', file, tile: 512 }); first ??= f; }
      buildFilm(); selectFrame(first.id);
      if (imgs.length === 2 && st.tool === 'change') { /* two at once: second becomes the pair */ }
    }
    async function attachSecond(f, file) {
      try {
        const bmp = await createImageBitmap(file), c = canvasFrom(bmp, f.work.w, f.work.h); bmp.close?.();
        const id = c.getContext('2d').getImageData(0, 0, f.work.w, f.work.h);
        await cv('put', { key: f.id + '|B', rgba: id.data.buffer, w: f.work.w, h: f.work.h }, [id.data.buffer]);
        f.pair = { earlier: 'A', label: [f.name, file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 28)], user: true, bCanvas: canvasFrom(c, f.w, f.h) };
        f.res.change = null; renderSide(); runTool();
      } catch (e) { shell.toast('The second image could not be read: ' + (e.message || e), { level: 'alert' }); }
    }

    // ---------- film strip ----------
    const KIND_TAG = { synthetic: ['Synthetic', 'tag-sim', 'Drawn by this page. Not a photograph.'], site: ['Simulated', 'tag-sim', 'A drawn mosaic of the exercise site, standing in for the drone\'s photographs.'], real: ['Real photo', 'tag-ok', 'A real drone photograph, used under its licence.'], gen: ['AI-generated', 'tag-sim', 'An illustration made by an image generator for this project. Not a photograph of a real place or event.'], user: ['Your image', 'tag-ok', 'From this computer. It is not uploaded anywhere.'] };
    function buildFilm() {
      film.replaceChildren();
      let group = null;
      for (const id of order) {
        const f = frames.get(id);
        if (f.group !== group) { group = f.group; film.append(h('div.aerial-film-title', null, group)); }
        const thumb = h('canvas.aerial-thumb', { width: 264, height: 176 });
        f.el = h('button.aerial-frame', { 'aria-pressed': String(st.frameId === id), 'aria-label': f.name + '. ' + KIND_TAG[f.kind][0], onclick: () => selectFrame(id) }, thumb,
          h('span.aerial-frame-name', null, h('b.num', null, id === 'SITE' ? 'Site' : id), h('span', null, f.name)), h('span.aerial-frame-meta'));
        f.thumb = thumb; film.append(f.el); paintFilm(f);
      }
      film.append(h('button.aerial-add', { onclick: () => fileInput.click() }, icon('upload', 18), h('span', null, 'Drop a photo here, or choose one')));
    }
    function paintFilm(f) {
      if (!f.el) return;
      f.el.setAttribute('aria-pressed', String(st.frameId === f.id)); f.el.dataset.status = f.status;
      const meta = f.el.querySelector('.aerial-frame-meta'), g = f.thumb.getContext('2d'), [tl, tc, tt] = KIND_TAG[f.kind];
      const bits = [h('span.tag.plain.' + tc, { title: tt }, tl)];
      if (f.status === 'ready') {
        const k = Math.max(264 / f.w, 176 / f.h), w = f.w * k, hh = f.h * k; g.drawImage(f.canvas, (264 - w) / 2, (176 - hh) / 2, w, hh);
        if (f.kind === 'site' && !S().map.ready) { g.fillStyle = 'rgba(7,9,12,0.72)'; g.fillRect(0, 0, 264, 176); const rr = siteRects() || []; for (const r of rr) { const x = (264 - w) / 2 + r[0] * k, y = (176 - hh) / 2 + r[1] * k; g.drawImage(f.canvas, r[0], r[1], r[2] - r[0], r[3] - r[1], x, y, (r[2] - r[0]) * k, (r[3] - r[1]) * k); } }
        const p = f.res.people, rx = f.res.rx[st.rx.mode] || f.res.rx.global || f.res.rx.local;
        if (p?.tiled) bits.push(h('span.num.dim', null, shownPeople(f, 'tiled').length + ' people'));
        else if (rx?.regions) bits.push(h('span.num.dim', null, rx.count + ' colour leads'));
        else if (f.kind === 'site' && !S().map.ready) bits.push(h('span.num.dim', null, S().map.scan > 0 ? 'survey ' + Math.round(S().map.scan * 100) + ' %' : 'not flown yet'));
      } else { g.fillStyle = css('--bg-3'); g.fillRect(0, 0, 264, 176); bits.push(h('span.dim', null, f.status === 'error' ? 'failed' : 'drawing…')); }
      meta.replaceChildren(...bits);
    }

    function selectFrame(id) {
      if (!frames.has(id)) return;
      cancelRun(); st.frameId = id; st.sel = null;
      for (const f of frames.values()) paintFilm(f);
      const f = cur();
      if (f.status === 'idle' || f.status === 'error') loadFrame(f);
      onFrameReady();
    }
    function onFrameReady() {
      const f = cur(); if (!f) return;
      if (f.status === 'ready') viewer.setImageSize(f.w, f.h);
      revealBox.disabled = !(f.truth?.figures?.length); revealBox.parentElement.classList.toggle('is-off', revealBox.disabled);
      updateCover(); updateMeta(); renderSide(); viewer.kick();
      if (f.status === 'ready') runTool({ auto: true });
    }
    function setTool(id) {
      if (st.tool === id) return; cancelRun(); st.tool = id; st.sel = null;
      toolSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.id === 'aerial-tab-' + id)));
      updateCover(); renderSide(); viewer.kick(); runTool({ auto: true });
    }

    // ---------- HUD ----------
    function updateMeta() {
      const f = cur(); if (!f) return;
      const [tl, tc] = KIND_TAG[f.kind], bits = [h('b', null, (f.id === 'SITE' ? '' : f.id + '  ') + f.name), h('span.tag.plain.' + tc, null, tl)];
      if (f.status === 'ready') {
        bits.push(h('span.num', null, f.w + ' × ' + f.h + ' px'));
        if (f.pxPerM) bits.push(h('span.num', { title: 'Ground size of one pixel. Chosen for the drawing, not measured.' }, (100 / f.pxPerM).toFixed(1) + ' cm per pixel'));
        if (f.work && f.work.scale < 1) bits.push(h('span.dim', { title: 'Large images are analysed at reduced size. The neural network still reads full-resolution tiles.' }, 'analysed at ' + f.work.w + ' × ' + f.work.h));
        if (f.credit) bits.push(h('a', { href: f.page, target: '_blank', rel: 'noopener' }, 'Photo: ' + f.credit));
        if (f.asked) bits.push(h('span.dim', { title: 'What the image generator was asked to draw. Nobody has checked the picture against it.' }, 'Asked for: ' + f.asked));
      }
      hudMeta.replaceChildren(...bits);
    }
    function updateCoord() {
      const f = cur(), p = st.hover; if (!f || !p || f.status !== 'ready') { hudCoord.hidden = true; return; }
      hudCoord.hidden = false;
      let t = 'pixel ' + Math.round(p[0]) + ', ' + Math.round(p[1]);
      if (f.kind === 'site') { const m = siteM(p[0], p[1]); t += '   site ' + m[0].toFixed(1) + ' m east, ' + m[1].toFixed(1) + ' m north'; const room = world.roomAt(m); if (room) t += '   ' + room.name; }
      else if (f.pxPerM) t += '   ' + (p[0] / f.pxPerM).toFixed(1) + ' m, ' + (p[1] / f.pxPerM).toFixed(1) + ' m';
      const rx = st.tool === 'rx' && f.res.rx[st.rx.mode]; if (rx?.peakAt) { /* reserved */ }
      hudCoord.textContent = t;
    }
    function updateScale() {
      const f = cur(); if (!f || !f.pxPerM || f.status !== 'ready') { hudScale.hidden = true; return; }
      hudScale.hidden = false; const pxPerM = f.pxPerM * viewer.view.s;
      const m = [0.5, 1, 2, 5, 10, 20, 50].find((x) => x * pxPerM >= 64) || 50;
      hudScale.firstChild.style.width = (m * pxPerM).toFixed(1) + 'px'; hudScale.lastChild.textContent = m + ' m';
    }
    function updateCover() {
      const f = cur(); if (!f) return;
      let body = null;
      if (f.status === 'loading' || f.status === 'idle') body = [h('div.spinner'), h('p', null, f.kind === 'real' ? 'Loading the photograph…' : f.kind === 'gen' ? 'Loading the generated scene…' : f.kind === 'user' ? 'Reading your image…' : 'Drawing the synthetic frame…')];
      else if (f.status === 'error') body = [icon('alert', 28), h('h3', null, 'This frame could not be prepared'), h('p.muted', null, f.error), h('button.btn', { onclick: () => loadFrame(f) }, 'Try again')];
      else if (f.kind === 'site' && !S().map.ready && !S().map.swaths.length) body = [icon('drone', 30), h('h3', null, 'The drone has not flown yet'), h('p.muted', null, 'The site mosaic fills in strip by strip as the survey flies. Start the mission, or use the test frames on the left now.'),
        h('button.btn.btn-primary', { onclick: () => { ctx.sim.command('start'); ctx.sim.play(); } }, icon('play'), S().started ? 'Resume the clock' : 'Start the survey')];
      cover.hidden = !body; if (body) cover.replaceChildren(h('div.aerial-cover-box.glass', null, ...body));
    }

    // ---------- drawing ----------
    let maskCanvas = null, maskSig = '';
    function siteMask(f) {
      const sig = swathSig(); if (sig === 'all') return null;
      if (maskCanvas && sig === maskSig) return maskCanvas;
      maskCanvas ??= document.createElement('canvas'); maskCanvas.width = f.w / 2; maskCanvas.height = f.h / 2; maskSig = sig;
      const g = maskCanvas.getContext('2d'); g.setTransform(0.5, 0, 0, 0.5, 0, 0); g.clearRect(0, 0, f.w, f.h);
      g.fillStyle = 'rgba(7,9,12,0.86)'; g.fillRect(0, 0, f.w, f.h);
      g.strokeStyle = 'rgba(168,178,191,0.10)'; g.lineWidth = 2; g.beginPath(); for (let x = -f.h; x < f.w; x += 28) { g.moveTo(x, 0); g.lineTo(x + f.h, f.h); } g.stroke();
      for (const r of siteRects() || []) g.clearRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
      return maskCanvas;
    }
    const shownPeople = (f, which = st.det.show) => (f.res.people?.[which]?.boxes || []).filter((b) => b.score >= st.det.minScore);
    function bracket(g, x0, y0, x1, y1, L) {
      g.beginPath();
      g.moveTo(x0, y0 + L); g.lineTo(x0, y0); g.lineTo(x0 + L, y0); g.moveTo(x1 - L, y0); g.lineTo(x1, y0); g.lineTo(x1, y0 + L);
      g.moveTo(x1, y1 - L); g.lineTo(x1, y1); g.lineTo(x1 - L, y1); g.moveTo(x0 + L, y1); g.lineTo(x0, y1); g.lineTo(x0, y1 - L); g.stroke();
    }
    function label(g, text, x, y, bg, fg) {
      g.font = '600 11px ' + css('--font'); const w = g.measureText(text).width + 10;
      g.fillStyle = bg; g.beginPath(); g.roundRect(x, y - 16, w, 16, 3); g.fill(); g.fillStyle = fg; g.textBaseline = 'middle'; g.fillText(text, x + 5, y - 7.5);
    }
    function drawStage(g, v, W, H, ts) {
      const f = cur(); if (!f || f.status !== 'ready') return;
      const C = { warn: css('--warn'), accent: css('--accent'), sim: css('--sim'), person: css('--person'), text: css('--text'), ink: css('--bg-0'), ok: css('--ok') };
      const X = (x) => v.x + x * v.s, Y = (y) => v.y + y * v.s;
      const chg = st.tool === 'change' ? f.res.change : null;
      g.save(); g.translate(v.x, v.y); g.scale(v.s, v.s); g.imageSmoothingEnabled = v.s < 2.5; g.imageSmoothingQuality = 'high';
      if (chg) {
        const sx = f.w * st.chg.swipe, early = f.pair.earlier === 'A' ? f.canvas : chg.aligned, late = f.pair.earlier === 'A' ? chg.aligned : f.canvas;
        g.save(); g.beginPath(); g.rect(0, 0, sx, f.h); g.clip(); g.drawImage(early, 0, 0, f.w, f.h); g.restore();
        g.save(); g.beginPath(); g.rect(sx, 0, f.w - sx, f.h); g.clip(); g.drawImage(late, 0, 0, f.w, f.h); g.restore();
      } else g.drawImage(f.canvas, 0, 0);
      const ov = st.tool === 'rx' ? f.res.rx[st.rx.mode]?.overlay : chg ? chg.overlay : null;
      if (ov) { g.imageSmoothingEnabled = v.s < 4; g.globalAlpha = st.tool === 'rx' ? 0.92 : 0.8; g.drawImage(ov, 0, 0, f.w, f.h); g.globalAlpha = 1; }
      if (f.kind === 'site') { const m = siteMask(f); if (m) { g.imageSmoothingEnabled = true; g.drawImage(m, 0, 0, f.w, f.h); } }
      g.restore();
      g.lineJoin = 'round'; g.lineCap = 'round';

      // tiles of the detector
      const run = st.run && st.run.frame === f.id ? st.run : null, ppl = f.res.people;
      if (st.tool === 'people' && (run?.grid || (ppl?.tiled && st.det.show === 'tiled'))) {
        const grid = run?.grid || ppl.tiled.grid;
        g.lineWidth = 1;
        grid.forEach((t, i) => {
          const x = X(t.x), y = Y(t.y), w = t.w * v.s, hh = t.h * v.s, state = run ? (i < run.done ? 'done' : i === run.done && run.phase === 'tiles' ? 'now' : 'todo') : 'idle';
          if (state === 'now') {
            g.fillStyle = 'rgba(90,169,255,0.10)'; g.fillRect(x, y, w, hh); g.strokeStyle = C.accent; g.lineWidth = 1.5; g.strokeRect(x + 0.5, y + 0.5, w, hh);
            const k = (ts % 900) / 900; g.strokeStyle = 'rgba(90,169,255,0.9)'; g.beginPath(); g.moveTo(x, y + hh * k); g.lineTo(x + w, y + hh * k); g.stroke(); g.lineWidth = 1;
          } else { g.strokeStyle = state === 'todo' ? 'rgba(233,237,242,0.10)' : 'rgba(233,237,242,0.20)'; g.setLineDash(state === 'idle' ? [3, 5] : []); g.strokeRect(x + 0.5, y + 0.5, w, hh); g.setLineDash([]); }
        });
        if (run?.phase === 'whole') { g.strokeStyle = C.accent; g.lineWidth = 1.5; g.strokeRect(X(0), Y(0), f.w * v.s, f.h * v.s); const k = (ts % 1200) / 1200; g.beginPath(); g.moveTo(X(0), Y(f.h * k)); g.lineTo(X(f.w), Y(f.h * k)); g.stroke(); }
      }
      // truth of the synthetic frame
      if (st.reveal && f.truth) {
        g.setLineDash([4, 3]); g.lineWidth = 1.2; g.strokeStyle = C.sim;
        for (const t of f.truth.figures) { const b = t.bbox; g.strokeRect(X(b[0]) - 5, Y(b[1]) - 5, (b[2] - b[0]) * v.s + 10, (b[3] - b[1]) * v.s + 10); }
        g.setLineDash([]);
        if (v.s > 1.1) for (const t of f.truth.figures) { const b = t.bbox, d = DIFFS.find((x) => x.id === t.difficulty); label(g, t.team ? 'own team' : (t.top?.name || 'figure') + (d ? ', ' + d.label.toLowerCase() : ''), X(b[0]) - 5, Y(b[3]) + 22, 'rgba(183,156,255,0.92)', C.ink); }
        if (st.tool === 'change' && f.truth.changesB) { g.setLineDash([6, 4]); for (const c of f.truth.changesB) { const b = c.bbox; g.strokeRect(X(b[0]), Y(b[1]), (b[2] - b[0]) * v.s, (b[3] - b[1]) * v.s); if (v.s > 0.7) label(g, c.label, X(b[0]), Y(b[1]) - 2, 'rgba(183,156,255,0.92)', C.ink); } g.setLineDash([]); }
      }
      // results of the current method
      const sel = st.sel;
      if (st.tool === 'people' && ppl) {
        const list = shownPeople(f), other = st.det.show === 'tiled' ? (ppl.whole?.boxes || []).filter((b) => b.score >= st.det.minScore) : [];
        g.lineWidth = 1.5;
        list.forEach((b, i) => {
          const x0 = X(b.box[0]), y0 = Y(b.box[1]), w = (b.box[2] - b.box[0]) * v.s, hh = (b.box[3] - b.box[1]) * v.s, isSel = sel?.kind === 'people' && sel.ref === b;
          g.strokeStyle = isSel ? C.accent : C.warn; g.lineWidth = isSel ? 2.2 : 1.5; g.beginPath(); g.roundRect(x0, y0, w, hh, 3); g.stroke();
          if (isSel || w > 26) label(g, Math.round(b.score * 100) + ' %', x0 - 1, y0 - 2, isSel ? C.accent : 'rgba(255,178,36,0.94)', C.ink);
          if (st.det.show === 'tiled' && !other.some((o) => iouOf(o.box, b.box) > 0.3) && ppl.whole) { g.fillStyle = C.warn; g.beginPath(); g.arc(x0 + w, y0, 3, 0, 7); g.fill(); }
        });
      }
      if (st.tool === 'rx') {
        const r = f.res.rx[st.rx.mode];
        if (r?.regions) r.regions.slice(0, 40).forEach((c, i) => {
          const isSel = sel?.kind === 'rx' && sel.ref === c, pad = 5, x0 = X(c.bbox[0]) - pad, y0 = Y(c.bbox[1]) - pad, x1 = X(c.bbox[2]) + pad, y1 = Y(c.bbox[3]) + pad;
          g.strokeStyle = isSel ? C.accent : C.warn; g.lineWidth = isSel ? 2.2 : 1.4; bracket(g, x0, y0, x1, y1, Math.max(4, Math.min(9, (x1 - x0) / 3)));
          if (i < 12 || isSel) label(g, String(i + 1), x1 + 3, y0 + 15, isSel ? C.accent : 'rgba(255,178,36,0.94)', C.ink);
        });
      }
      if (chg?.regions) chg.regions.slice(0, 30).forEach((c, i) => {
        const isSel = sel?.kind === 'change' && sel.ref === c, x0 = X(c.bbox[0]), y0 = Y(c.bbox[1]), x1 = X(c.bbox[2]), y1 = Y(c.bbox[3]);
        g.strokeStyle = isSel ? C.accent : 'rgba(233,237,242,0.85)'; g.lineWidth = isSel ? 2.2 : 1.2; bracket(g, x0, y0, x1, y1, Math.max(5, Math.min(12, (x1 - x0) / 4)));
        label(g, String(i + 1), x0, y0 - 2, isSel ? C.accent : 'rgba(233,237,242,0.92)', C.ink);
      });
      // the mission's own leads, on the site mosaic
      if (f.kind === 'site') {
        const pins = [...S().detections.filter((d) => d.outdoor && d.pos).map((d) => ({ id: d.id, pos: d.pos, text: d.id + '  ' + (d.status === 'confirmed' ? 'person confirmed' : d.status === 'rejected' ? 'lead closed' : 'possible person') + '  ' + Math.round(d.p * 100) + ' %', col: d.status === 'confirmed' ? C.person : d.status === 'rejected' ? C.ok : C.warn, det: true })),
          ...(S().aerial?.leads || []).map((l) => ({ id: l.id, pos: l.pos, text: l.id + '  sent from here', col: C.accent }))];
        for (const p of pins) {
          const [px, py] = sitePx(p.pos), x = X(px), y = Y(py), on = ctx.selection?.type === 'detection' && ctx.selection.id === p.id;
          const lx = x + 34, ly = y - 34;
          g.strokeStyle = p.col; g.lineWidth = on ? 2.4 : 1.4; g.beginPath(); g.arc(x, y, Math.max(11, 1.5 * SITE_PPM * v.s), 0, 7); g.stroke();
          g.beginPath(); g.moveTo(x + 9, y - 9); g.lineTo(lx, ly); g.stroke(); label(g, p.text, lx, ly + 1, p.col, C.ink);
        }
        if (!S().map.ready && S().map.swaths.length) { const d = S().units['DRONE-01']; if (d && d.mode === 'scan') { const [px, py] = sitePx(d.pos), x = X(px), y = Y(py); g.strokeStyle = C.text; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x + 9, y); g.moveTo(x, y - 9); g.lineTo(x, y + 9); g.stroke(); g.setLineDash([3, 4]); g.strokeStyle = 'rgba(233,237,242,0.5)'; g.strokeRect(x - 2, y - 11 * SITE_PPM * v.s, 4, 22 * SITE_PPM * v.s); g.setLineDash([]); label(g, 'drone', x + 12, y - 6, 'rgba(233,237,242,0.92)', C.ink); } }
      }
      if (sel?.bbox) {   // a reticle on the selected thing
        const b = sel.bbox, cx = X((b[0] + b[2]) / 2), cy = Y((b[1] + b[3]) / 2), r = Math.max(18, Math.max(b[2] - b[0], b[3] - b[1]) * v.s * 0.5 + 12);
        g.strokeStyle = 'rgba(90,169,255,0.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - r - 14, cy); g.lineTo(cx - r, cy); g.moveTo(cx + r, cy); g.lineTo(cx + r + 14, cy); g.moveTo(cx, cy - r - 14); g.lineTo(cx, cy - r); g.moveTo(cx, cy + r); g.lineTo(cx, cy + r + 14); g.stroke();
      }
      if (chg) {   // the swipe divider
        const sx = swipeX(), y0 = Math.max(0, Y(0)), y1 = Math.min(H, Y(f.h));
        g.strokeStyle = C.text; g.lineWidth = 1.5; g.beginPath(); g.moveTo(sx, y0); g.lineTo(sx, y1); g.stroke();
        const hy = Math.min(y1 - 24, Math.max(y0 + 24, H / 2)); g.fillStyle = C.text; g.beginPath(); g.roundRect(sx - 11, hy - 16, 22, 32, 6); g.fill();
        g.strokeStyle = C.ink; g.lineWidth = 1.6; g.beginPath(); g.moveTo(sx - 3, hy - 5); g.lineTo(sx - 6, hy); g.lineTo(sx - 3, hy + 5); g.moveTo(sx + 3, hy - 5); g.lineTo(sx + 6, hy); g.lineTo(sx + 3, hy + 5); g.stroke();
        g.font = '600 11px ' + css('--font'); const lw = g.measureText(f.pair.label[0]).width + 10;
        if (sx - X(0) > lw + 16) label(g, f.pair.label[0], sx - lw - 8, y0 + 24, 'rgba(7,9,12,0.78)', C.text);
        if (X(f.w) - sx > 120) label(g, f.pair.label[1], sx + 8, y0 + 24, 'rgba(7,9,12,0.78)', C.text);
      }
      updateScale();
    }
    viewer.setDraw(drawStage);

    function pickAt([x, y]) {
      const f = cur(); if (!f || f.status !== 'ready') return;
      const hit = (b, pad = 4) => x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad;
      let s = null;
      if (st.tool === 'people') { const b = shownPeople(f).find((p) => hit(p.box, 2)); if (b) s = { kind: 'people', ref: b, bbox: b.box }; }
      else if (st.tool === 'rx') { const c = (f.res.rx[st.rx.mode]?.regions || []).find((r) => hit(r.bbox, 6)); if (c) s = { kind: 'rx', ref: c, bbox: c.bbox }; }
      else if (st.tool === 'change') { const c = (f.res.change?.regions || []).find((r) => hit(r.bbox, 2)); if (c) s = { kind: 'change', ref: c, bbox: c.bbox }; }
      if (f.kind === 'site' && !s) { const d = S().detections.find((d) => d.outdoor && d.pos && Math.hypot(...sitePx(d.pos).map((v, i) => v - [x, y][i])) < 2 * SITE_PPM); if (d) ctx.select({ type: 'detection', id: d.id }); }
      select(s, { fly: false });
    }
    function select(s, { fly = true } = {}) {
      st.sel = s; if (s && fly) viewer.focusBox(s.bbox, s.kind === 'change' ? { pad: 2.2, maxS: 5 } : undefined);
      refreshLists(); viewer.kick();
    }

    // ---------- the detector ----------
    function loadDetector() {
      if (st.det.status === 'loading' || st.det.status === 'ready') return st.det.promise;
      st.det.status = 'loading'; st.det.error = null; st.det.loaded = 0; st.det.total = 0; st.det.stage = 'Starting the detector'; renderModelCard();
      let worker;
      st.det.promise = (async () => {
        try {
          worker = new Worker(new URL('./detect.worker.js', import.meta.url), { type: 'module' });
          det = rpc(worker, (e) => { if (st.det.status !== 'ready') { st.det.status = 'error'; st.det.error = e.message; renderSide(); } });
          const r = await det('load', {}, [], (m) => { if (m.type === 'progress') { st.det.loaded = m.loaded; st.det.total = m.total; } else if (m.type === 'stage') st.det.stage = m.text; renderModelCard(); });
          Object.assign(st.det, { status: 'ready', backend: r.backend, note: r.note, bytes: r.bytes, loadMs: r.loadMs, warmMs: r.warmMs, fromNetwork: r.fromNetwork });
        } catch (e) { st.det.status = 'error'; st.det.error = String(e.message || e); try { worker?.terminate(); } catch { /* gone */ } det = null; }
        renderSide(); renderScore();
      })();
      return st.det.promise;
    }
    function cancelRun() { if (st.run) { st.run.cancel = true; st.run = null; hudRun.hidden = true; viewer.setBusy(false); } }
    async function detectOn(canvas, x, y, w, hh, outW, outH) {
      let id;
      if (outW && (outW !== w || outH !== hh)) { const c = document.createElement('canvas'); c.width = outW; c.height = outH; const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(canvas, x, y, w, hh, 0, 0, outW, outH); id = g.getImageData(0, 0, outW, outH); }
      else id = canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, hh);
      const r = await det('detect', { rgba: id.data.buffer, w: id.width, h: id.height, minScore: 0.2 }, [id.data.buffer]);
      const kx = w / id.width, ky = hh / id.height;
      return { ms: r.ms, others: r.others, people: r.people.map((p) => ({ score: p.score, box: [x + p.box[0] * kx, y + p.box[1] * ky, x + p.box[2] * kx, y + p.box[3] * ky] })) };
    }
    async function detectFrame(canvas, w, hh, tile, onStep) {
      const k = Math.min(1, 1280 / Math.max(w, hh));
      onStep?.('whole', 0, 0);
      const whole = await detectOn(canvas, 0, 0, w, hh, Math.round(w * k), Math.round(hh * k));
      const grid = tileGrid(w, hh, tile, OVERLAP), all = whole.people.slice(), others = { ...whole.others }; let ms = 0, raw = 0;
      for (let i = 0; i < grid.length; i++) {
        if (onStep?.('tiles', i, grid) === false) return null;
        const t = grid[i], r = await detectOn(canvas, t.x, t.y, t.w, t.h);
        const full = r.people.filter(({ box: b }) => !((t.x > 0 && b[0] < t.x + 4) || (t.y > 0 && b[1] < t.y + 4) || (t.x + t.w < w && b[2] > t.x + t.w - 4) || (t.y + t.h < hh && b[3] > t.y + t.h - 4)));   // a box cut by an inner tile edge: the overlap shows that person whole in the next tile
        ms += r.ms; raw += r.people.length; t.n = r.people.length; all.push(...full); for (const [kk, n] of Object.entries(r.others)) others[kk] = Math.max(others[kk] || 0, n);
      }
      return { whole: { boxes: nms(whole.people), ms: whole.ms }, tiled: { boxes: nms(all), raw, ms, grid, tile }, others };
    }
    async function runPeople(f, { tile = f.res.people?.tiled.tile || f.tile || 448 } = {}) {
      if (st.det.status !== 'ready') { await loadDetector(); if (st.det.status !== 'ready' || cur() !== f) return; }
      cancelRun();
      const run = st.run = { frame: f.id, phase: 'whole', done: 0, grid: null, t0: performance.now() }; viewer.setBusy(true); renderSide();
      try {
        const r = await detectFrame(f.canvas, f.w, f.h, tile, (phase, i, grid) => {
          if (run.cancel) return false; run.phase = phase; run.done = i; if (grid) run.grid = grid;
          hudRun.hidden = false; hudRun.replaceChildren(h('div.spinner'), h('span', null, phase === 'whole' ? 'Pass 1: the whole frame, shrunk to the network\'s 640 × 640 input' : 'Pass 2: tile ' + (i + 1) + ' of ' + grid.length + ' at full resolution'), h('button.btn.btn-sm', { onclick: cancelRun }, 'Stop'));
        });
        if (!r || run.cancel) return;
        f.res.people = r; st.det.show = 'tiled'; st.sel = null;
      } catch (e) { f.res.peopleError = String(e.message || e); }
      if (st.run === run) { st.run = null; hudRun.hidden = true; viewer.setBusy(false); }
      paintFilm(f); if (cur() === f) { renderSide(); viewer.kick(); }
    }

    // ---------- colour anomaly ----------
    const rxWindow = (f) => { const ppm = (f.pxPerM || 0) * (f.work?.scale || 1); const outer = ppm ? Math.round(1.75 * ppm) : Math.round(Math.min(f.work.w, f.work.h) / 34); return { outer: Math.max(8, outer), guard: Math.max(3, Math.round(outer / 3.1)) }; };
    async function runRx(f, { force = false } = {}) {
      const mode = st.rx.mode, sig = f.kind === 'site' ? swathSig() : '';
      if (!cv) return;
      let r = f.res.rx[mode];
      if (!r || force || r.sig !== sig) {
        f.res.rx[mode] = r = { busy: true, sig }; renderSide();
        try { const win = rxWindow(f); Object.assign(r, await cv('rx', { key: f.work.key, mode, rects: f.kind === 'site' ? scaleRects(siteRects(), 1) : null, ...win }), { win, busy: false }); }
        catch (e) { f.res.rx[mode] = { error: String(e.message || e), sig }; if (cur() === f) renderSide(); return; }
      }
      await rxRegions(f);
    }
    const scaleRects = (r) => r;
    async function rxRegions(f) {
      const mode = st.rx.mode, r = f.res.rx[mode]; if (!r || r.busy || r.error) return;
      const token = ++st.rx.token, thr = st.rx.thr;
      try {
        const out = await cv('rxRegions', { key: f.work.key, mode, thr, minArea: Math.max(4, Math.round(BENCH.minArea * (f.work.scale < 1 ? 1 : 1))) });
        if (token !== st.rx.token) return;
        const k = 1 / f.work.scale; r.overlay?.close?.();
        r.overlay = await createImageBitmap(new ImageData(new Uint8ClampedArray(out.overlay), out.w, out.h));
        r.regions = out.regions.map((c) => ({ ...c, bbox: c.bbox.map((v) => v * k), cx: c.cx * k, cy: c.cy * k, areaPx: c.area, area: c.area * k * k })); r.count = out.count; r.thr = thr; r.regMs = out.ms;
        if (st.sel?.kind === 'rx') st.sel = null;
      } catch (e) { r.error = String(e.message || e); }
      paintFilm(f); if (cur() === f && st.tool === 'rx') { refreshRx(); viewer.kick(); }
    }

    // ---------- before / after ----------
    async function runChange(f, { force = false } = {}) {
      if (!cv || !f.pair) return;
      const sig = f.kind === 'site' ? siteSig() + swathSig() : '';
      let c = f.res.change;
      if (!c || force || c.sig !== sig || st.chg.current !== f.id) {
        f.res.change = c = { busy: true, sig }; renderSide();
        try {
          let bKey = f.id + '|B';
          if (f.kind === 'synthetic') {
            const set = pairSetup(f.spec.seed), r = await cv('scene', { key: bKey, spec: { ...f.spec, mutate: f.spec.seed + 1 }, noiseSeed: f.spec.seed + 9, light: set.light, shift: set.shift });
            c.setup = set; f.truth.changesB = r.truth.changes; r.bitmap.close?.();
          } else if (f.kind === 'site') {
            const set = { shift: [-9, 6], light: { gain: 1.1, tint: [1.03, 1, 0.96] } }; c.setup = set;
            const r = await cv('scene', { key: bKey, spec: siteSpec(true), noiseSeed: 31, light: set.light, shift: set.shift }); r.bitmap.close?.();
          }
          const A = f.work.key, r = await cv('change', { before: A, after: bKey, rects: f.kind === 'site' ? siteRects() : null });
          const img = new ImageData(new Uint8ClampedArray(r.aligned), r.w, r.h), al = document.createElement('canvas'); al.width = r.w; al.height = r.h; al.getContext('2d').putImageData(img, 0, 0);
          Object.assign(c, { busy: false, aligned: al, shift: r.shift, ncc: r.score, surface: r.surface, surfaceR: r.surfaceR, gains: r.gains, ms: r.ms, msReg: r.msReg, levels: r.levels });
          st.chg.current = f.id;
        } catch (e) { f.res.change = { error: String(e.message || e), sig }; if (cur() === f) renderSide(); return; }
      }
      await changeRegions(f);
    }
    async function changeRegions(f) {
      const c = f.res.change; if (!c || c.busy || c.error || st.chg.current !== f.id) return;
      const token = ++st.chg.token, ppm = (f.pxPerM || 0) * f.work.scale, minArea = ppm ? Math.round(CBENCH.minAreaM2 * ppm * ppm) : Math.round(f.work.w * f.work.h / 6000);
      try {
        const out = await cv('changeRegions', { thr: st.chg.method === 'naive' ? st.chg.thr : st.chg.thr, method: st.chg.method, minArea });
        if (token !== st.chg.token) return;
        const k = 1 / f.work.scale; c.overlay?.close?.();
        c.overlay = await createImageBitmap(new ImageData(new Uint8ClampedArray(out.overlay), out.w, out.h));
        c.regions = out.regions.map((r) => ({ ...r, bbox: r.bbox.map((v) => v * k), areaPx: r.area })); c.count = out.count; c.changedPx = out.changed; c.regMs = out.ms; c.method = st.chg.method;
        if (st.sel?.kind === 'change') st.sel = null;
      } catch (e) { c.error = String(e.message || e); }
      if (cur() === f && st.tool === 'change') { refreshChange(); viewer.kick(); }
    }

    function runTool({ auto = false, force = false } = {}) {
      const f = cur(); if (!f || f.status !== 'ready') return;
      if (f.kind === 'site' && !S().map.ready && !S().map.swaths.length) return;
      if (st.tool === 'people') { if (auto) return; if (st.det.status === 'idle') loadDetector(); else if (st.det.status === 'ready' && !auto) runPeople(f); }
      else if (st.tool === 'rx') runRx(f, { force });
      else if (st.tool === 'change') runChange(f, { force });
    }

    // ---------- side panel ----------
    const el = {};   // live elements of the current panel
    function range(min, max, step, value, label, oninput) {
      const r = h('input.slider', { type: 'range', min, max, step, value, 'aria-label': label });
      const sync = () => r.style.setProperty('--p', ((r.value - min) / (max - min) * 100).toFixed(1) + '%');
      r.addEventListener('input', () => { sync(); oninput(+r.value); }); sync(); return r;
    }
    const stat = (v, l, title) => h('div.stat', title ? { title } : null, h('b.num', null, v), h('span', null, l));
    const sec = (n) => n >= 10 ? n.toFixed(0) + ' s' : n >= 1 ? n.toFixed(1) + ' s' : Math.round(n * 1000) + ' ms';
    function thumb(src, bbox, size = 44, pad = 1.9) {
      const c = h('canvas.aerial-crop', { width: size * 2, height: size * 2, style: { width: size + 'px', height: size + 'px' } }), g = c.getContext('2d');
      const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2, half = Math.max(10, Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]) * pad / 2);
      g.fillStyle = css('--bg-0'); g.fillRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = half * 2 > c.width; g.drawImage(src, cx - half, cy - half, half * 2, half * 2, 0, 0, c.width, c.height);
      return c;
    }
    function row(sel, isSel, ...kids) { return h('button.aerial-row', { 'aria-pressed': String(!!isSel), onclick: () => select(st.sel?.ref === sel.ref ? null : sel) }, ...kids); }
    const leadable = (f) => f.kind === 'site';
    function leadButton(f) {
      const s = st.sel, ok = leadable(f) && s && (s.kind === 'rx' || s.kind === 'people');
      const why = !leadable(f) ? 'Only the site mosaic has a map position. Open it to send a lead.' : !s ? 'Pick a candidate first.' : '';
      return h('button.btn.btn-primary.aerial-lead', { disabled: !ok, title: why, onclick: () => sendLead(f, s) }, icon('mission'), 'Send to mission as a lead');
    }
    function sendLead(f, s) {
      const cx = (s.bbox[0] + s.bbox[2]) / 2, cy = (s.bbox[1] + s.bbox[3]) / 2, pos = siteM(cx, cy);
      const args = { pos, px: [Math.round(cx), Math.round(cy)], frame: f.id, method: s.kind === 'rx' ? 'colour' : 'people', score: s.kind === 'rx' ? +s.ref.peak.toFixed(1) : +s.ref.score.toFixed(2), colour: s.kind === 'rx' ? colourName(s.ref.rgb) : null };
      if (!ctx.sim.command('aerialLead', args)) { shell.toast('That spot is already a lead (within 2 m of one you sent).', { level: 'info' }); return; }
      const lead = S().aerial.leads[S().aerial.leads.length - 1];
      bus.emit('aerial:lead', { ...lead });
      shell.toast(lead.matches ? 'Sent. It agrees with the drone\'s lead ' + lead.matches + ': two methods now point at the same spot.' : 'Sent to the mission log as ' + lead.id + ' at ' + lead.pos.join(', ') + ' m. It needs a ground check.', { level: 'ok' });
      renderMission(); viewer.kick();
    }

    function renderModelCard() {
      if (!el.model) return; const d = st.det;
      const name = h('div.aerial-model-name', null, h('b', null, 'D-FINE nano'), h('span.dim', null, 'trained on COCO photographs, about 3.8 million weights'));
      let body;
      if (d.status === 'idle') body = [h('p.muted', null, 'The network is not loaded yet.'), h('button.btn', { onclick: loadDetector }, icon('download'), 'Load the detector (15 MB)')];
      else if (d.status === 'loading') { const pct = d.total ? d.loaded / d.total : 0; body = [h('div.row', null, h('span.grow', null, d.stage + '…'), h('span.num.dim', null, d.total ? (d.loaded / 1e6).toFixed(1) + ' of ' + (d.total / 1e6).toFixed(1) + ' MB' : '')), h('div.bar', { role: 'progressbar', 'aria-valuenow': Math.round(pct * 100), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Model download' }, h('i', { style: { width: (pct * 100).toFixed(1) + '%' } })), h('span.dim', null, 'First visit downloads the weights. After that the browser keeps them.')]; }
      else if (d.status === 'ready') body = [h('div.aerial-model-ok', null, h('span.tag.tag-ok', null, 'Ready'), h('span', null, d.backend === 'webgpu' ? 'Running on the graphics card (WebGPU)' : 'Running on this computer\'s processor (WebAssembly)'), h('span.num.dim', null, (d.bytes / 1e6).toFixed(1) + ' MB, ' + (d.fromNetwork ? 'downloaded' : 'from this browser\'s cache') + ' in ' + sec(d.loadMs / 1000))), d.note && d.backend !== 'webgpu' ? h('span.dim.aerial-small', null, d.note) : null];
      else body = [h('div.note.danger', null, icon('alert'), h('span', null, h('b', null, 'The detector did not load. '), d.error + ' The colour and before/after methods do not need it and still work.')), h('button.btn', { onclick: () => { st.det.status = 'idle'; loadDetector(); } }, icon('reset'), 'Try again')];
      el.model.replaceChildren(name, ...body.filter(Boolean));
    }

    function peoplePanel(f) {
      const p = f.res.people, running = st.run?.frame === f.id, d = st.det, tile = p?.tiled.tile || f.tile || 448;
      el.model = h('div.aerial-model'); 
      const tileSeg = h('div.seg', { role: 'group', 'aria-label': 'Tile size' }, ...[640, 448, 320].map((t) => h('button', { 'aria-pressed': String(t === tile), title: 'Each tile is ' + t + ' px square and is enlarged to the network\'s 640 px input.', onclick: () => { f.tile = t; if (f.res.people) f.res.people.tiled.tile = t; runPeople(f, { tile: t }); } }, t + ' px')));
      const runBtn = h('button.btn.btn-primary', { disabled: d.status === 'loading' || running, onclick: () => runPeople(f) }, icon('search'), running ? 'Looking…' : d.status === 'loading' ? 'Loading the detector…' : p?.recorded ? 'Run it live' : p ? 'Run again' : 'Find people in this frame');
      const kids = [h('p.aerial-how', null, 'A pretrained object detector reads the frame and boxes what it thinks is a person. It learned from everyday photographs, so it knows people seen from the side far better than from straight above.'), el.model,
        h('div.aerial-runrow', null, runBtn, h('div.aerial-field', null, h('span.dim', null, 'Tile'), tileSeg))];
      if (p?.recorded) kids.push(h('p.aerial-rec', null, h('span.tag.tag-sim.plain', null, 'Recorded run'), h('span', null, 'The same network\'s own output on this frame, saved on ' + p.recorded + '. Run it live to replace it.')));
      if (f.res.peopleError && !p) kids.push(h('div.note.danger', null, icon('alert'), h('span', null, 'The run failed: ' + f.res.peopleError)));
      if (p) {
        el.cmp = h('div.aerial-cmp'); el.list = h('div.aerial-list'); el.count = h('span.num');
        const slider = range(20, 90, 1, Math.round(d.minScore * 100), 'Minimum confidence, percent', (v) => { d.minScore = v / 100; st.sel = null; refreshPeople(); viewer.kick(); paintFilm(f); });
        el.conf = h('span.num'); 
        kids.push(h('h4', null, 'Why the frame is cut into tiles'), el.cmp,
          h('label.aerial-slider', null, h('span', null, 'Keep boxes the network is at least ', el.conf, ' sure of'), slider),
          h('div.aerial-listhead', null, h('h4', null, 'People found'), el.count), el.list);
        const others = Object.entries(p.others).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (others.length) kids.push(h('p.dim.aerial-small', null, 'Also recognised and ignored, because only the person class is kept: ' + others.map(([k, n]) => k).join(', ') + '.'));
        if (f.truth?.figures?.length) { const found = f.truth.figures.filter((t) => p.tiled.boxes.some((b) => b.score >= d.minScore && iouOf(b.box, t.bbox) > 0.1)).length; kids.push(h('div.note', null, icon('info'), h('span', null, 'This synthetic frame has ' + f.truth.figures.length + ' drawn figures. The detector boxed ' + found + ' of them. Drawn figures seen from above are not the photographs it was trained on; the real photos on the left show what it can do, and the colour test covers this case.'))); }
        kids.push(leadButton(f));
      } else if (!running) kids.push(h('div.aerial-emptyline', null, 'No run on this frame yet.'));
      side.replaceChildren(panelHead('Find people', 'live-ai'), h('div.aerial-side-body', null, ...kids));
      renderModelCard(); if (p) refreshPeople();
    }
    function refreshPeople() {
      const f = cur(), p = f?.res.people; if (!p || !el.cmp) return; const d = st.det;
      const nW = p.whole.boxes.filter((b) => b.score >= d.minScore).length, nT = p.tiled.boxes.filter((b) => b.score >= d.minScore).length, mx = Math.max(1, nW, nT);
      const line = (id, title, sub, n, time) => h('button.aerial-cmp-row', { 'aria-pressed': String(d.show === id), title: 'Show these boxes', onclick: () => { d.show = id; st.sel = null; refreshPeople(); viewer.kick(); } },
        h('span.aerial-cmp-name', null, h('b', null, title), h('span.dim', null, sub)), h('span.aerial-cmp-bar', null, h('i', { style: { width: (n / mx * 100) + '%' } })), h('b.num', null, String(n)), h('span.num.dim', null, time));
      el.cmp.replaceChildren(
        line('whole', 'Whole frame', '1 pass; a ' + f.w + ' px frame shrunk to 640 px', nW, sec(p.whole.ms / 1000)),
        line('tiled', 'Plus tiles', p.tiled.grid.length + ' overlapping ' + p.tiled.tile + ' px tiles, merged', nT, sec(p.tiled.ms / 1000)),
        h('p.dim.aerial-small', null, nT > nW ? 'Shrinking the whole frame leaves each person only a few pixels wide. Tiles keep the detail, at ' + (p.tiled.ms / Math.max(1, p.whole.ms)).toFixed(0) + ' times the computing time. ' + 'Boxes cut by a tile edge are dropped and duplicates from the overlap are merged (non-max suppression): ' + p.tiled.raw + ' raw boxes became ' + p.tiled.boxes.length + '.' : 'On this frame tiling did not find more than one pass did. It costs ' + (p.tiled.ms / Math.max(1, p.whole.ms)).toFixed(0) + ' times the computing time; ' + sec(p.tiled.ms / 1000 / p.tiled.grid.length) + ' per tile.'));
      el.conf.textContent = Math.round(d.minScore * 100) + ' %';
      const list = shownPeople(f).slice().sort((a, b) => b.score - a.score); el.count.textContent = String(list.length);
      el.list.replaceChildren(...(list.length ? list.slice(0, 60).map((b) => row({ kind: 'people', ref: b, bbox: b.box }, st.sel?.ref === b, thumb(f.canvas, b.box, 40, 1.6),
        h('span.aerial-row-main', null, h('b.num', null, Math.round(b.score * 100) + ' %'), h('span.dim.num', null, Math.round(b.box[2] - b.box[0]) + ' × ' + Math.round(b.box[3] - b.box[1]) + ' px')),
        d.show === 'tiled' && !p.whole.boxes.some((o) => o.score >= d.minScore && iouOf(o.box, b.box) > 0.3) ? h('span.tag.tag-warn.plain', { title: 'The single whole-frame pass did not find this one.' }, 'tiles only') : null)) : [h('div.aerial-emptyline', null, 'Nothing above ' + Math.round(d.minScore * 100) + ' %. Lower the confidence, or try the colour method.')]));
      updateLeadBtn();
    }

    function panelHead(title, reality, extra) { return h('header.aerial-side-head', null, h('h3', null, title), extra, realityTag(reality)); }
    function updateLeadBtn() { const old = side.querySelector('.aerial-lead'); if (old) old.replaceWith(leadButton(cur())); }
    function refreshLists() { if (st.tool === 'people') refreshPeople(); else if (st.tool === 'rx') refreshRx(); else refreshChange(); }

    function rxPanel(f) {
      const r = f.res.rx[st.rx.mode], win = rxWindow(f), ppm = (f.pxPerM || 0) * (f.work?.scale || 1);
      const modeSeg = h('div.seg', { role: 'group', 'aria-label': 'Background model' },
        h('button', { 'aria-pressed': String(st.rx.mode === 'global'), title: 'One colour model for the whole frame. Fast. Best when the ground is fairly uniform.', onclick: () => { st.rx.mode = 'global'; st.sel = null; renderSide(); runRx(f); viewer.kick(); } }, 'Whole-frame model'),
        h('button', { 'aria-pressed': String(st.rx.mode === 'local'), title: 'A separate model around every pixel, from a ring of its neighbours. Finds things that only stand out from their surroundings.', onclick: () => { st.rx.mode = 'local'; st.sel = null; renderSide(); runRx(f); viewer.kick(); } }, 'Local window'));
      el.thrText = h('b.num'); el.hist = h('canvas.aerial-hist', { role: 'img', 'aria-label': 'Histogram of colour distance over all pixels, with the threshold marked' }); el.plot = h('canvas.aerial-plot', { role: 'img' }); el.list = h('div.aerial-list'); el.count = h('span.num'); el.rxStats = h('div.aerial-stats');
      const slider = range(3, 20, 0.5, st.rx.thr, 'Sensitivity: flag colours further than this many standard deviations from the background', (v) => { st.rx.thr = v; el.thrText.textContent = v.toFixed(1); drawHist(); drawPlot(); rxRegions(f); });
      const kids = [h('p.aerial-how', null, 'Rubble and mud share a narrow family of colours. The RX detector (Reed and Yu, 1990) learns that family from the frame itself, then measures how far every pixel sits from it. A red jacket is a long way out, even when it is six pixels wide.'),
        modeSeg,
        h('label.aerial-slider', null, h('span', null, 'Flag colours more than ', el.thrText, ' standard deviations out'), slider, h('span.aerial-slider-ends.dim', null, h('span', null, 'more leads'), h('span', null, 'fewer, surer'))),
        el.hist];
      if (!cv) kids.push(h('div.note.danger', null, icon('alert'), h('span', null, 'The analysis worker did not start, so this method cannot run in this browser.')));
      else if (r?.error) kids.push(h('div.note.danger', null, icon('alert'), h('span', null, r.error)), h('button.btn', { onclick: () => runRx(f, { force: true }) }, 'Try again'));
      else if (!r || r.busy) kids.push(h('div.aerial-emptyline', null, h('div.spinner'), 'Scoring every pixel…'));
      else kids.push(el.rxStats,
        st.rx.mode === 'global' ? h('figure.aerial-fig', null, h('figcaption', null, 'Almost every pixel sits in one colour cloud. Leads are the dots outside the ring.'), el.plot)
          : h('figure.aerial-fig', null, h('figcaption', null, 'Each pixel is compared with a ring of its own neighbours' + (ppm ? ', sized so a lying person fits inside the gap' : '') + '.'), el.plot),
        h('div.aerial-listhead', null, h('h4', null, 'Candidates, most unusual first'), el.count), el.list, leadButton(f));
      if (f.kind === 'site' && !S().map.ready) kids.splice(1, 0, h('div.note', null, icon('info'), h('span', null, 'Survey ' + Math.round(S().map.scan * 100) + ' % flown. Only the strips already photographed are scored; this re-runs when the survey ends.')));
      side.replaceChildren(panelHead('Colour anomaly', 'live-algo'), h('div.aerial-side-body', null, ...kids));
      el.thrText.textContent = st.rx.thr.toFixed(1);
      requestAnimationFrame(() => { drawHist(); refreshRx(); });
    }
    function sizeCanvas(c) { const r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); if (!r.width) return null; c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return { g, w: r.width, h: r.height }; }
    function drawHist() {
      const f = cur(), r = f?.res.rx[st.rx.mode]; if (!el.hist?.isConnected) return; const s = sizeCanvas(el.hist); if (!s) return; const { g, w, h: hh } = s;
      const padL = 4, padB = 16, pw = w - padL * 2, ph = hh - padB - 4, max = r?.histMax || 20, thr = st.rx.thr;
      g.font = '11px ' + css('--font'); g.textBaseline = 'alphabetic';
      if (r?.hist) {
        const bins = r.hist.length, top = Math.log10(Math.max(10, ...r.hist) + 1), bw = pw / bins;
        for (let i = 0; i < bins; i++) { const v = r.hist[i]; if (!v) continue; const bh = Math.max(1.5, Math.log10(v + 1) / top * ph), d = (i + 0.5) / bins * max; g.fillStyle = d > thr ? css('--warn') : css('--line-2'); g.fillRect(padL + i * bw + 0.5, 4 + ph - bh, Math.max(1, bw - 1), bh); }
        // what a perfect Gaussian scene would give (chi distribution, 3 degrees of freedom), same pixel count
        g.strokeStyle = css('--text-3'); g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); let started = false;
        for (let i = 0; i <= 200; i++) { const d = i / 200 * max, pdf = Math.sqrt(2 / Math.PI) * d * d * Math.exp(-d * d / 2), n = pdf * r.pixels * (max / bins); const y = 4 + ph - Math.min(ph, Math.max(0, Math.log10(n + 1) / top * ph)); if (n < 0.5 && started) break; if (!started) { g.moveTo(padL + d / max * pw, y); started = true; } else g.lineTo(padL + d / max * pw, y); }
        g.stroke(); g.setLineDash([]);
      }
      const x = padL + Math.min(1, thr / max) * pw; g.strokeStyle = css('--text'); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 2); g.lineTo(x, 4 + ph); g.stroke();
      g.fillStyle = css('--text-3'); for (const t of [0, 5, 10, 15, 20]) { g.textAlign = t === 0 ? 'left' : t === 20 ? 'right' : 'center'; g.fillText(String(t), padL + t / max * pw, hh - 3); }
      g.textAlign = 'right'; g.fillText('pixels per distance (log scale); dashed: a pure Gaussian scene', w - padL, 13);
    }
    function drawPlot() {
      const f = cur(), r = f?.res.rx[st.rx.mode]; if (!el.plot?.isConnected || !r?.stats) return; const s = sizeCanvas(el.plot); if (!s) return; const { g, w, h: hh } = s;
      g.font = '11px ' + css('--font');
      if (st.rx.mode === 'local') {   // the dual window, to scale against a 1.7 m person
        const win = r.win, k = Math.min((hh - 22) / (2 * win.outer + 1), 2.6), cx = 78, cy = hh / 2, o = (win.outer + 0.5) * k, gd = (win.guard + 0.5) * k, ppm = (f.pxPerM || 0) * f.work.scale;
        g.fillStyle = 'rgba(90,169,255,0.16)'; g.fillRect(cx - o, cy - o, 2 * o, 2 * o); g.strokeStyle = css('--accent'); g.lineWidth = 1; g.strokeRect(cx - o, cy - o, 2 * o, 2 * o);
        g.fillStyle = css('--bg-2'); g.fillRect(cx - gd, cy - gd, 2 * gd, 2 * gd); g.setLineDash([3, 3]); g.strokeStyle = css('--text-3'); g.strokeRect(cx - gd, cy - gd, 2 * gd, 2 * gd); g.setLineDash([]);
        if (ppm) { g.fillStyle = css('--warn'); g.save(); g.translate(cx, cy); g.rotate(-0.5); g.beginPath(); g.roundRect(-0.85 * ppm * k, -0.22 * ppm * k, 1.7 * ppm * k, 0.44 * ppm * k, 3); g.fill(); g.restore(); }
        g.fillStyle = css('--text'); g.fillRect(cx - 1.5, cy - 1.5, 3, 3);
        g.fillStyle = css('--text-2'); g.textAlign = 'left'; const tx = cx + o + 16; let ty = cy - 30;
        const lines = [['Background ring', (2 * win.outer + 1) + ' px' + (ppm ? ' (' + ((2 * win.outer + 1) / ppm).toFixed(1) + ' m)' : ''), css('--accent')], ['Guard gap, left out', (2 * win.guard + 1) + ' px' + (ppm ? ' (' + ((2 * win.guard + 1) / ppm).toFixed(1) + ' m)' : ''), css('--text-3')], ppm ? ['A lying adult, 1.7 m', 'to scale', css('--warn')] : null].filter(Boolean);
        for (const [a, b, c] of lines) { g.fillStyle = c; g.fillRect(tx, ty - 8, 8, 8); g.fillStyle = css('--text'); g.fillText(a, tx + 14, ty); g.fillStyle = css('--text-3'); g.fillText(b, tx + 14, ty + 14); ty += 34; }
        return;
      }
      // polar colour-distance plot: radius = Mahalanobis distance (all three axes), angle = direction in the two minor axes
      const e = eig3(r.stats.cov), mu = r.stats.mean, thr = st.rx.thr, R = Math.min(w, hh) / 2 - 6, cx = R + 8, cy = hh / 2, maxD = Math.max(14, Math.min(40, thr * 1.9)), sc = (d) => Math.min(1, Math.sqrt(d / maxD)) * R;
      const proj = (rgb) => { const x = [rgb[0] - mu[0], rgb[1] - mu[1], rgb[2] - mu[2]], u = e.vectors.map((vec, i) => (vec[0] * x[0] + vec[1] * x[1] + vec[2] * x[2]) / Math.sqrt(e.values[i])); const d = Math.hypot(u[0], u[1], u[2]), a = Math.atan2(u[2], u[1]); return [cx + Math.cos(a) * sc(d), cy + Math.sin(a) * sc(d), d]; };
      g.strokeStyle = css('--line'); g.lineWidth = 1; for (const d of [5, 10, 20, 40]) { if (d > maxD) continue; g.beginPath(); g.arc(cx, cy, sc(d), 0, 7); g.stroke(); }
      if (!f.sample) { const c = canvasFrom(f.canvas, 110, Math.round(110 * f.h / f.w)); f.sample = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; }
      const px = f.sample;
      for (let i = 0; i < px.length; i += 4) { const [x, y] = proj([px[i], px[i + 1], px[i + 2]]); g.fillStyle = 'rgb(' + px[i] + ',' + px[i + 1] + ',' + px[i + 2] + ')'; g.fillRect(x - 1, y - 1, 2, 2); }
      g.strokeStyle = css('--text'); g.lineWidth = 1.4; g.beginPath(); g.arc(cx, cy, sc(thr), 0, 7); g.stroke();
      (r.regions || []).slice(0, 12).forEach((c, i) => { const [x, y] = proj(c.rgb); const isSel = st.sel?.ref === c; g.fillStyle = 'rgb(' + c.rgb.join(',') + ')'; g.strokeStyle = isSel ? css('--accent') : css('--text'); g.lineWidth = isSel ? 2.4 : 1.2; g.beginPath(); g.arc(x, y, 5.5, 0, 7); g.fill(); g.stroke(); g.fillStyle = css('--text'); g.textAlign = 'left'; g.fillText(String(i + 1), x + 8, y + 4); });
      const tx = cx + R + 14; g.textAlign = 'left'; g.fillStyle = css('--text'); g.fillText('Ring: the threshold, ' + thr.toFixed(1), tx, cy - 26);
      g.fillStyle = css('--text-3'); g.fillText('Small dots: a sample of pixels,', tx, cy - 8); g.fillText('in their own colour.', tx, cy + 6); g.fillText('Numbered: the candidates.', tx, cy + 24); g.fillText('Distance from centre = score.', tx, cy + 42);
    }
    function refreshRx() {
      const f = cur(), r = f?.res.rx[st.rx.mode]; if (!r || !el.list?.isConnected && !el.rxStats?.isConnected) return;
      drawHist();
      if (!r.stats) return;
      const mu = r.stats.mean.map(Math.round), ppm = (f.pxPerM || 0);
      el.rxStats?.replaceChildren(
        stat((r.pixels / 1e6).toFixed(2) + ' M', 'pixels scored'), stat(sec(r.ms / 1000), st.rx.mode === 'local' ? 'local models' : 'model and scores', 'Measured on this computer, in a background thread.'),
        h('div.stat', { title: 'The mean colour of the background model: rgb ' + mu.join(', ') + (r.stats.excluded ? '. ' + r.stats.excluded + ' outlying pixels were left out of the second estimate.' : '') }, h('b', null, h('i.aerial-swatch', { style: { background: 'rgb(' + mu.join(',') + ')' } })), h('span', null, 'usual colour')),
        stat(String(r.count ?? '…'), 'regions flagged'));
      drawPlot();
      if (!r.regions) return;
      el.count.textContent = r.count > 12 ? '12 of ' + r.count : String(r.count);
      el.list.replaceChildren(...(r.regions.length ? r.regions.slice(0, 12).map((c, i) => {
        const truth = st.reveal && f.truth ? (f.truth.figures.find((t) => iouOf(t.bbox, c.bbox) > 0 ) ? 'figure' : f.truth.distractors.find((t) => iouOf(t.bbox, c.bbox) > 0) ? 'object' : 'nothing there') : null;
        const tdet = truth === 'figure' ? f.truth.figures.find((t) => iouOf(t.bbox, c.bbox) > 0) : truth === 'object' ? f.truth.distractors.find((t) => iouOf(t.bbox, c.bbox) > 0) : null;
        return row({ kind: 'rx', ref: c, bbox: c.bbox }, st.sel?.ref === c, h('span.aerial-rank.num', null, String(i + 1)), thumb(f.canvas, c.bbox, 40, 2.6),
          h('span.aerial-row-main', null, h('b', null, h('i.aerial-swatch', { style: { background: 'rgb(' + c.rgb.join(',') + ')' } }), colourName(c.rgb)), h('span.dim.num', null, c.peak.toFixed(1) + ' sd' + '  ·  ' + (ppm ? (c.area / (ppm * ppm)).toFixed(2) + ' m²' : Math.round(c.area) + ' px'))),
          truth ? h('span.tag.plain.' + (truth === 'figure' ? 'tag-sim' : 'tag-sim'), { title: 'Ground truth of this synthetic frame.' }, truth === 'figure' ? (tdet.team ? 'truth: own team' : 'truth: person') : truth === 'object' ? 'truth: ' + tdet.name : 'truth: nothing') : null);
      }) : [h('div.aerial-emptyline', null, 'Nothing is further out than ' + st.rx.thr.toFixed(1) + '. Lower the threshold to see weaker leads.')]));
      updateLeadBtn();
    }

    function changePanel(f) {
      const c = f.res.change, kids = [h('p.aerial-how', null, 'Two photographs of the same ground, taken at different times. The page lines them up, matches their exposure, and marks where the ground itself is different: a roof that fell, a slide that moved, a shelter that appeared.')];
      if (!f.pair) {
        kids.push(f.kind === 'user'
          ? h('div.aerial-emptybox', null, icon('upload', 22), h('b', null, 'Add a second photo of the same ground'), h('span.muted', null, 'Drop it on the frame, or choose it. It is stretched to the size of the first; the page then finds the shift between them.'), h('button.btn.btn-primary', { onclick: () => fileInput.click() }, 'Choose the second photo'))
          : h('div.aerial-emptybox', null, icon('info', 22), h('b', null, 'This photograph has no second look'), h('span.muted', null, 'Before / after needs two frames of the same ground. Open the site mosaic or a synthetic frame, or add two photos of your own.'), h('button.btn.btn-primary', { onclick: () => selectFrame('SITE') }, 'Open the site mosaic')));
        side.replaceChildren(panelHead('Before / after', 'live-algo'), h('div.aerial-side-body', null, ...kids)); return;
      }
      kids.push(h('div.aerial-pair', null, h('span', null, h('b', null, 'Left'), ' ' + f.pair.label[0]), h('span', null, h('b', null, 'Right'), ' ' + f.pair.label[1])));
      const methodSeg = h('div.seg', { role: 'group', 'aria-label': 'Comparison method' },
        h('button', { 'aria-pressed': String(st.chg.method === 'robust'), onclick: () => { st.chg.method = 'robust'; st.chg.thr = CHG_DEFAULT; renderSide(); changeRegions(f); } }, 'Aligned and exposure-matched'),
        h('button', { 'aria-pressed': String(st.chg.method === 'naive'), title: 'What you get by subtracting one photo from the other with no alignment. Shown for comparison.', onclick: () => { st.chg.method = 'naive'; st.chg.thr = CHG_DEFAULT; renderSide(); changeRegions(f); } }, 'Plain subtraction'));
      el.chgThr = h('b.num'); el.list = h('div.aerial-list'); el.count = h('span.num'); el.chgStats = h('div.aerial-stats'); el.surface = h('canvas.aerial-surface', { role: 'img', 'aria-label': 'Match quality for every trial shift; the bright cell is the shift that was chosen' }); el.align = h('div.aerial-align');
      const slider = range(0.2, 1.6, 0.05, st.chg.thr, 'How different a place must be to count as changed', (v) => { st.chg.thr = v; el.chgThr.textContent = v.toFixed(2); changeRegions(f); });
      kids.push(methodSeg, h('label.aerial-slider', null, h('span', null, 'Count a place as changed above ', el.chgThr), slider, h('span.aerial-slider-ends.dim', null, h('span', null, 'more, smaller'), h('span', null, 'fewer, larger'))));
      if (c?.error) kids.push(h('div.note.danger', null, icon('alert'), h('span', null, c.error)), h('button.btn', { onclick: () => runChange(f, { force: true }) }, 'Try again'));
      else if (!c || c.busy) kids.push(h('div.aerial-emptyline', null, h('div.spinner'), 'Lining the two frames up…'));
      else kids.push(h('div.aerial-alignbox', null, el.surface, el.align), el.chgStats, h('div.aerial-listhead', null, h('h4', null, 'Changed areas, largest first'), el.count), el.list);
      if (f.kind === 'site') kids.push(h('p.dim.aerial-small', null, 'Both site frames are drawn by this page from the exercise layout. The earlier one imagines the block before the flood.'));
      if (f.pair.gen) kids.push(h('p.dim.aerial-small', null, 'Both pictures come from an image generator, which redraws every stone a little differently. Expect more scattered false change here than between two real flights; the large areas are the ones to trust.'));
      if (f.pair.user) kids.push(h('p.dim.aerial-small', null, 'Only a sideways shift is corrected. Photos taken from different heights or angles will show false change along edges.'));
      side.replaceChildren(panelHead('Before / after', 'live-algo'), h('div.aerial-side-body', null, ...kids));
      el.chgThr.textContent = st.chg.thr.toFixed(2);
      requestAnimationFrame(refreshChange);
    }
    function refreshChange() {
      const f = cur(), c = f?.res.change; if (!c || c.busy || c.error || !el.align?.isConnected) return;
      const ppm = (f.pxPerM || 0), dx = c.shift[0] / f.work.scale, dy = c.shift[1] / f.work.scale, truthShift = c.setup?.shift;
      const dir = (v, a, b) => v === 0 ? null : Math.abs(v).toFixed(0) + ' px ' + (v > 0 ? a : b);
      const parts = [dir(dx, 'right', 'left'), dir(dy, 'down', 'up')].filter(Boolean);
      el.align.replaceChildren(
        h('b', null, parts.length ? 'Second frame sits ' + parts.join(' and ') : 'The frames already line up'),
        h('span.dim', null, (ppm && parts.length ? 'That is ' + (Math.hypot(dx, dy) / ppm).toFixed(2) + ' m on the ground. ' : '') + 'Edge match ' + (c.ncc * 100).toFixed(0) + ' %, searched coarse to fine over ' + c.levels + ' scales in ' + sec(c.msReg / 1000) + '.'),
        h('span.dim', null, 'Exposure matched: second frame × ' + c.gains.map((x) => x[0].toFixed(2)).join(', ') + ' (red, green, blue).'),
        truthShift && st.reveal ? h('span.tag.tag-sim.plain', { title: 'The shift this page applied when it drew the second frame.' }, 'truth: ' + truthShift[0] + ', ' + truthShift[1] + ' px') : null);
      const s = sizeCanvas(el.surface);
      if (s && c.surface?.length) { const n = 2 * c.surfaceR + 1, cell = s.w / n; let lo = 1, hi = -1; for (const v of c.surface) { if (v > hi) hi = v; if (v < lo && v > -1) lo = v; } const best = c.surface.indexOf(hi);
        c.surface.forEach((v, i) => { const t = Math.max(0, (v - lo) / Math.max(1e-6, hi - lo)); const heat = [[16, 21, 28], [43, 63, 107], [122, 63, 143], [216, 80, 77], [255, 178, 74], [255, 243, 196]], ff = Math.pow(t, 2.2) * 5, k = Math.min(4, ff | 0), u = ff - k; s.g.fillStyle = 'rgb(' + heat[k].map((a, j) => Math.round(a + (heat[k + 1][j] - a) * u)).join(',') + ')'; s.g.fillRect((i % n) * cell, ((i / n) | 0) * cell, cell + 0.5, cell + 0.5); });
        s.g.strokeStyle = css('--text'); s.g.lineWidth = 1.5; s.g.strokeRect((best % n) * cell - 1, ((best / n) | 0) * cell - 1, cell + 2, cell + 2); s.g.strokeStyle = 'rgba(233,237,242,0.35)'; s.g.lineWidth = 1; s.g.beginPath(); s.g.moveTo(s.w / 2, 0); s.g.lineTo(s.w / 2, s.h); s.g.moveTo(0, s.h / 2); s.g.lineTo(s.w, s.h / 2); s.g.stroke(); }
      if (!c.regions) return;
      const area = c.changedPx / (f.work.scale * f.work.scale), total = f.w * f.h;
      el.chgStats.replaceChildren(stat(String(c.count), 'areas changed'), stat(ppm ? Math.round(area / (ppm * ppm)).toLocaleString('en-US') + ' m²' : (area / total * 100).toFixed(1) + ' %', ppm ? 'ground changed' : 'of the frame'), stat((area / total * 100).toFixed(1) + ' %', 'of the frame'), stat(sec(c.ms / 1000), 'to compare'));
      el.count.textContent = c.count > 14 ? '14 of ' + c.count : String(c.count);
      const early = f.pair.earlier === 'A' ? f.canvas : c.aligned, late = f.pair.earlier === 'A' ? c.aligned : f.canvas;
      el.list.replaceChildren(...(c.regions.length ? c.regions.slice(0, 14).map((r, i) => {
        const a = r.areaPx / (f.work.scale * f.work.scale); let where = null;
        if (f.kind === 'site') { const m = siteM((r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2), inP = (poly) => { let ins = false; for (let i2 = 0, j = poly.length - 1; i2 < poly.length; j = i2++) { const [xi, yi] = poly[i2], [xj, yj] = poly[j]; if ((yi > m[1]) !== (yj > m[1]) && m[0] < (xj - xi) * (m[1] - yi) / (yj - yi) + xi) ins = !ins; } return ins; };
          const o = world.OBSTACLES.find((x) => x.kind !== 'furniture' && inP(x.poly)) || world.HAZARDS.find((x) => inP(x.poly)); where = o ? o.name : world.roomAt(m) ? 'Building B roof, over ' + world.roomAt(m).name : null; }
        const tr = st.reveal && f.truth?.changesB ? f.truth.changesB.find((t) => iouOf(t.bbox, r.bbox) > 0) : null;
        return row({ kind: 'change', ref: r, bbox: r.bbox }, st.sel?.ref === r, h('span.aerial-rank.num', null, String(i + 1)), h('span.aerial-duo', null, thumb(early, r.bbox, 40, 1.25), thumb(late, r.bbox, 40, 1.25)),
          h('span.aerial-row-main', null, h('b.num', null, ppm ? (a / (ppm * ppm) >= 10 ? Math.round(a / (ppm * ppm)) : (a / (ppm * ppm)).toFixed(1)) + ' m²' : (a / total * 100).toFixed(2) + ' % of frame'), h('span.dim', null, where || (tr ? '' : Math.round(r.bbox[2] - r.bbox[0]) + ' × ' + Math.round(r.bbox[3] - r.bbox[1]) + ' px'))),
          st.reveal && f.truth?.changesB ? h('span.tag.tag-sim.plain', { title: 'Ground truth of this synthetic pair.' }, tr ? 'truth: ' + tr.label.toLowerCase() : 'truth: no change') : null);
      }) : [h('div.aerial-emptyline', null, 'Nothing changed by more than ' + st.chg.thr.toFixed(2) + '.')]));
    }

    function renderSide() {
      const f = cur(); for (const k of Object.keys(el)) delete el[k];
      if (!f || f.status !== 'ready') { side.replaceChildren(panelHead(TOOLS.find((t) => t.id === st.tool).label, TOOLS.find((t) => t.id === st.tool).reality), h('div.aerial-side-body', null, h('div.aerial-emptyline', null, f?.status === 'error' ? 'This frame is not available.' : 'Preparing the frame…'))); if (st.tool === 'people') { /* keep model status visible */ } return; }
      if (st.tool === 'people') peoplePanel(f); else if (st.tool === 'rx') rxPanel(f); else changePanel(f);
    }

    // ---------- scoreboard: measured on the synthetic test set ----------
    function cellBar(n, of) { const p = of ? n / of : 0; return h('td.aerial-cell', { title: n + ' of ' + of }, h('span.aerial-cellbar', null, h('i', { style: { width: (p * 100) + '%' } })), h('span.num', null, of ? Math.round(p * 100) + ' %' : '–')); }
    function renderScore() {
      const b = st.bench, rx = b.rx, total = rx?.total, all = total ? DIFFS.reduce((a, d) => a + total[d.id], 0) : BENCH.seeds.length * BENCH.figures;
      const ti = rx ? rx.thrs.indexOf(RX_DEFAULT) : -1;
      const rows = [];
      const mkRow = (id, name, sub, hits, falseC, time, pending) => h('tr', { 'aria-selected': String(b.row === id), tabindex: 0, onclick: () => { b.row = id; renderScore(); }, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.row = id; renderScore(); } } },
        h('th', { scope: 'row' }, h('b', null, name), h('span.dim', null, sub)),
        ...(hits ? [...DIFFS.map((d) => cellBar(hits[d.id], total[d.id])), cellBar(DIFFS.reduce((a, d) => a + hits[d.id], 0), all), h('td.num', null, falseC.toFixed(1)), h('td.num', null, time)] : [h('td.dim', { colspan: 7 }, pending)]));
      for (const mode of ['global', 'local']) rows.push(mkRow('rx-' + mode, 'Colour anomaly', mode === 'global' ? 'whole-frame model' : 'local window', rx ? rx.res[mode][ti].hit : null, rx ? rx.res[mode][ti].falseC / rx.frames : 0, rx ? sec(rx.ms[mode] / 1000) : '', b.rxState === 'error' ? 'Could not run: ' + b.rxError : 'Measuring… ' + (b.rxProgress || '')));
      const dt = b.det;
      const detBtn = h('button.btn.btn-sm', { disabled: b.detState === 'running', title: 'Runs the network on all 12 test frames: a minute or two.', onclick: runDetBench }, b.detState === 'running' ? 'Scoring ' + (b.detProgress || '') : dt ? 'Score the detector live' : 'Score the detector (a few minutes)');
      for (const which of ['whole', 'tiled']) rows.push(mkRow('det-' + which, 'Neural detector', which === 'whole' ? 'whole frame' : 'tiled, 448 px', dt ? dt[which].hit : null, dt ? dt[which].falseC / dt.frames : 0, dt ? sec(dt[which].ms / dt.frames / 1000) : '', which === 'whole' ? h('span', null, 'Not scored in this session. ', detBtn) : b.detState === 'running' ? 'Running…' : 'Same button.'));
      const head = h('div.aerial-card-head', null, h('h3', null, 'Measured here: ' + all + ' drawn figures in ' + BENCH.seeds.length + ' synthetic frames'), realityTag('live-algo'), h('span.tag.tag-sim', { title: 'The frames are drawn by this page. These are not results on real people or real photographs.' }, 'Synthetic test set'),
        h('div.grow'), dt ? detBtn : null, h('button.btn.btn-sm.btn-ghost', { disabled: b.rxState === 'running', onclick: runBench }, icon('reset'), 'Measure again'));
      const table = h('table.aerial-table', null, h('thead', null, h('tr', null, h('th', null, 'Method'), ...DIFFS.map((d) => h('th', { title: d.hint }, d.label)), h('th', null, 'All'), h('th', { title: 'Candidates per frame, among the top ' + BENCH.topK + ', that are neither a figure nor a known bright object.' }, 'False leads / frame'), h('th', null, 'Time / frame'))), h('tbody', null, ...rows));
      // the misses of the selected row
      let missBox = h('div.aerial-miss');
      const [kind, which] = b.row.split('-');
      if (kind === 'rx' && rx) {
        const miss = rx.perFigure.filter((p) => p.at[which] < RX_DEFAULT), by = DIFFS.map((d) => miss.filter((m) => m.difficulty === d.id).length);
        missBox.append(h('span.aerial-miss-title', null, h('b', null, miss.length + ' missed'), ' by the ' + (which === 'global' ? 'whole-frame' : 'local') + ' colour test at ' + RX_DEFAULT + ' sd: ' + DIFFS.map((d, i) => by[i] + ' ' + d.label.toLowerCase()).join(', ') + '.'),
          h('span.aerial-miss-thumbs', null, ...miss.slice(0, 16).map((m) => { const c = h('canvas', { width: 72, height: 72, title: m.top.name + ', ' + DIFFS.find((d) => d.id === m.difficulty).label.toLowerCase() + '. Strongest score inside its box: ' + m[which + 'Peak'].toFixed(1) + ' sd.' }); c.getContext('2d').drawImage(m.thumb, 0, 0); return c; })));
      } else if (kind === 'det' && dt) {
        const miss = dt.perFigure.filter((p) => !p[which]); missBox.append(h('span.aerial-miss-title', null, h('b', null, miss.length + ' of ' + all + ' missed'), ' by the neural detector (' + (which === 'whole' ? 'whole frame' : 'tiled') + ') at ' + Math.round(dt.minScore * 100) + ' % confidence. It was trained on photographs taken from the ground; these are drawings seen from above.'));
      } else missBox.append(h('span.aerial-miss-title.dim', null, kind === 'det' ? 'The detector has not been scored in this session. On the 12 frames it takes about 90 seconds.' : 'Running the colour test on 12 fresh frames…'));
      const ch = b.change, cti = ch ? ch.thrs.indexOf(CHG_DEFAULT) : -1;
      const chLine = h('p.aerial-chline', null, h('b', null, 'Before / after: '), ch ? ch.rows[cti].hit + ' of ' + ch.total + ' known changes found in ' + ch.frames + ' synthetic pairs, ' + (ch.rows[cti].falseR / ch.frames).toFixed(1) + ' false areas per pair; the camera shift was recovered to within ' + ch.shiftMax.toFixed(0) + ' px on every pair. Plain subtraction without alignment: ' + ch.naiveRows[cti].hit + ' found, ' + (ch.naiveRows[cti].falseR / ch.frames).toFixed(1) + ' false areas per pair.' : b.changeState === 'error' ? 'could not run (' + b.changeError + ').' : 'measuring on 8 synthetic pairs…');
      scorePanel.replaceChildren(head, h('div.aerial-score-body', null, table, missBox, chLine));
    }
    async function runBench() {
      const b = st.bench; if (b.rxState === 'running') return;
      b.rxState = 'running'; b.rx = null; b.change = null; b.changeState = 'running'; b.rxProgress = ''; renderScore();
      try { b.rx = await benchRpc()('bench', { what: 'rx' }, [], (m) => { b.rxProgress = m.done + ' of ' + m.of + ' frames'; if (!b.rx) renderScore(); }); b.rxState = 'done'; } catch (e) { b.rxState = 'error'; b.rxError = String(e.message || e); }
      renderScore();
      try { b.change = await benchRpc()('bench', { what: 'change' }); b.changeState = 'done'; } catch (e) { b.changeState = 'error'; b.changeError = String(e.message || e); }
      renderScore();
    }
    async function runDetBench() {
      const b = st.bench; if (b.detState === 'running') return;
      if (st.det.status !== 'ready') { b.detState = 'running'; b.detProgress = 'after loading'; renderScore(); await loadDetector(); if (st.det.status !== 'ready') { b.detState = 'error'; renderScore(); return; } }
      cancelRun();
      b.detState = 'running'; b.detProgress = ''; renderScore();
      const minScore = DET_DEFAULT, mk = () => ({ hit: { bright: 0, shadow: 0, covered: 0, muted: 0 }, falseC: 0, ms: 0 }), out = { whole: mk(), tiled: mk(), perFigure: [], frames: 0, minScore };
      try {
        for (let k = 0; k < BENCH.seeds.length; k++) {
          const fr = await benchRpc()('benchFrame', { index: k }), c = canvasFrom(fr.bitmap, fr.w, fr.h); fr.bitmap.close?.();
          const r = await detectFrame(c, fr.w, fr.h, 448, (phase, i, grid) => { b.detProgress = 'frame ' + (k + 1) + ' of ' + BENCH.seeds.length; if (i % 4 === 0) renderScore(); });
          const per = fr.figures.map((fig) => ({ frame: k, id: fig.id, difficulty: fig.difficulty })); out.perFigure.push(...per);
          for (const which of ['whole', 'tiled']) {
            const boxes = r[which].boxes.filter((x) => x.score >= minScore), used = new Set();
            fr.figures.forEach((fig, fi) => { const j = boxes.findIndex((x) => iouOf(x.box, fig.bbox) > 0.1); if (j >= 0) { out[which].hit[fig.difficulty]++; used.add(j); } per[fi][which] = j >= 0; });
            out[which].falseC += boxes.length - used.size; out[which].ms += r[which].ms;
          }
          out.frames++;
        }
        b.det = out; b.detState = 'done'; b.row = 'det-tiled';
      } catch (e) { b.detState = 'error'; shell.toast('The detector benchmark stopped: ' + (e.message || e), { level: 'alert' }); }
      renderScore();
    }

    // ---------- mission link ----------
    let missionSig = '';
    function renderMission(force) {
      const M = S(), dets = M.detections.filter((d) => d.outdoor && d.pos), leads = M.aerial?.leads || [];
      const sig = [M.phase, Math.round(M.map.scan * 50), M.map.ready, dets.map((d) => d.id + d.status + Math.round(d.p * 100)).join(), leads.length, ctx.selection?.id].join('|');
      if (!force && sig === missionSig) return; missionSig = sig;
      const kids = [h('div.aerial-card-head', null, h('h3', null, 'Link to the mission'), realityTag('sim'))];
      const body = h('div.aerial-mission-body');
      if (!M.map.ready && M.map.scan <= 0) body.append(h('p.muted', null, 'The scout drone has not flown. When it does, its survey becomes the site mosaic here, and anything it flags shows up below with its place in the picture.'), h('button.btn.btn-sm', { onclick: () => { ctx.sim.command('start'); ctx.sim.play(); } }, icon('play'), 'Start the survey'));
      else body.append(h('div.aerial-survey', null, h('span', null, M.map.ready ? 'Survey complete' : 'Survey in flight'), h('div.bar.grow', null, h('i', { style: { width: (M.map.scan * 100).toFixed(0) + '%' } })), h('span.num', null, Math.round(M.map.scan * 100) + ' %')));
      for (const d of dets) {
        const px = sitePx(d.pos), sw = M.map.swaths.findIndex((s) => Math.abs(s.y - d.pos[1]) <= s.half), on = ctx.selection?.type === 'detection' && ctx.selection.id === d.id;
        body.append(h('div.aerial-link' + (on ? '.is-on' : ''), null,
          h('div.aerial-link-top', null, h('span.tag.' + (d.status === 'confirmed' ? 'tag-person' : d.status === 'rejected' ? 'tag-ok' : 'tag-warn'), null, d.status === 'confirmed' ? 'Person' : d.status === 'rejected' ? 'Closed' : 'Possible person'), h('b', null, d.id), h('span.num.dim', null, 'p ' + Math.round(d.p * 100) + ' %'), h('span.dim', null, 'seen ' + fmt.clock(d.t))),
          h('div.aerial-link-map', null, h('span', null, h('span.dim', null, 'Mission'), h('b.num', null, d.pos[0].toFixed(1) + ' m E, ' + d.pos[1].toFixed(1) + ' m N')), h('i', { 'aria-hidden': 'true' }), h('span', null, h('span.dim', null, 'This mosaic'), h('b.num', null, 'pixel ' + Math.round(px[0]) + ', ' + Math.round(px[1]) + (sw >= 0 ? ', flight line ' + (sw + 1) : '')))),
          h('div.row', null, h('button.btn.btn-sm', { onclick: () => showLead(d) }, icon('eye'), 'Show in the frame'), h('button.btn.btn-sm.btn-ghost', { onclick: () => { ctx.select({ type: 'detection', id: d.id }); shell.open('mission'); } }, 'Open in Mission'))));
      }
      if (M.map.scan > 0 && !dets.length) body.append(h('p.dim', null, M.map.ready ? 'The drone flagged nobody outdoors on this flight.' : 'Nothing flagged yet on the strips flown so far.'));
      if (dets.length) body.append(h('p.dim.aerial-small', null, 'The mission\'s drone sighting is simulated: the simulator decides it, then this page draws a figure at that place in the mosaic. Run the colour test on the mosaic to see whether it would find the figure on its own.'));
      if (leads.length) body.append(h('div.aerial-sent', null, h('b', null, 'Sent from here'), ...leads.map((l) => h('button.aerial-sent-row', { onclick: () => { selectFrame('SITE'); const p = sitePx(l.pos); viewer.focusBox([p[0] - 20, p[1] - 20, p[0] + 20, p[1] + 20]); } }, h('b.num', null, l.id), h('span', null, (l.method === 'colour' ? 'colour' + (l.colour ? ', ' + l.colour : '') : 'detector') + ' at ' + l.pos.join(', ') + ' m'), h('span.tag.plain.' + (l.matches ? 'tag-ok' : 'tag-warn'), null, l.matches ? 'agrees with ' + l.matches : 'new, needs a check')))));
      kids.push(body); missionPanel.replaceChildren(...kids);
    }
    function showLead(d) {
      ctx.select({ type: 'detection', id: d.id });
      if (st.frameId !== 'SITE') selectFrame('SITE');
      const go = () => { const p = sitePx(d.pos); viewer.focusBox([p[0] - 14, p[1] - 14, p[0] + 14, p[1] + 14], { pad: 6, maxS: 5 }); };
      if (site.status === 'ready') go(); else site.loading?.then(go);
    }

    // ---------- the simulator moving on ----------
    let lastSwath = '', tickN = 0;
    function onTick() {
      if (!st.shown) return;
      renderMission();
      const sw = swathSig(), ls = siteSig();
      if (site.status === 'ready' && ls !== site.sig) { site.status = 'idle'; loadFrame(site); }       // a lead appeared: draw it into the mosaic
      if (sw !== lastSwath) {
        const was = lastSwath; lastSwath = sw; if ((tickN++ % 6) === 0 || sw === 'all') paintFilm(site);
        if (st.frameId === 'SITE') { updateCover(); viewer.kick(); if (sw === 'all' && was !== '') runTool({ force: true }); else if (was === '' && site.status === 'ready') { renderSide(); runTool({ auto: true }); } }
      }
    }
    function onReset() { missionSig = ''; lastSwath = ''; site.sig = null; if (site.status !== 'loading') { site.status = 'idle'; loadFrame(site); } renderMission(true); if (st.frameId === 'SITE') { updateCover(); renderSide(); } viewer.kick(); }
    offs.push(bus.on('tick', onTick), bus.on('reset', onReset), bus.on('seek', onReset), bus.on('select', () => { renderMission(true); viewer.kick(); }), bus.on('prefs', () => { viewer.kick(); renderSide(); }));

    // ---------- drag and drop ----------
    let dragDepth = 0;
    root.addEventListener('dragenter', (e) => { if (![...(e.dataTransfer?.types || [])].includes('Files')) return; e.preventDefault(); dragDepth++; dropHint.hidden = false; });
    root.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
    root.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropHint.hidden = true; });
    root.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; dropHint.hidden = true; if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });

    // ---------- Demo mode: the film (hero.js) ----------
    let hero = null, heroState = 'none', heroCv = null;
    const ACTS = [
      { name: 'Find', title: 'Every frame, read twice', line: 'A neural network looks for people. A colour test looks for what does not belong.', tags: () => [realityTag('live-ai'), h('span.tag.tag-sim.plain', { title: 'These frames were made by an image generator for this project. They are not photographs of a real place or event. The boxes and the heat are computed from them by the real methods.' }, 'Illustration frames'), h('span.tag.plain.ah-mode', null, hero?.strip.isLive ? 'Live run' : 'Recorded run')] },
      { name: 'Place', title: 'A pixel becomes a place', line: 'Every lead gets a position on the plan that the rover can drive to.', tags: () => [realityTag('sim'), realityTag('live-algo')] },
      { name: 'Compare', title: 'What moved since', line: 'Two flights, lined up and compared. What changed stays lit.', tags: () => [realityTag('live-algo'), h('span.tag.tag-sim.plain', { title: 'Both flights are drawn by this page, so every change is known and the result can be scored.' }, 'Synthetic frames')] },
    ];
    const dTags = h('div.ah-tags'), dTitle = h('h1.ah-title'), dLine = h('p.ah-line'), dCap = h('p.ah-cap', { role: 'status' }), dFig = h('div.ah-figs'), dBtn = h('button.btn.btn-primary.ah-btn');
    const dSteps = ACTS.map((a, i) => h('button.ah-step', { 'aria-pressed': String(i === 0), onclick: () => hero?.go(i) }, h('span', null, a.name), h('i', null, h('b'))));
    demo.append(h('div.ah-stage'), h('div.ah-scrim', { 'aria-hidden': 'true' }), h('div.ah-copy', null, dTags, dTitle, dLine, h('div.ah-act', null, dBtn, dCap)), h('div.ah-right', null, dFig, h('div.ah-steps', { role: 'group', 'aria-label': 'Part of the film' }, ...dSteps)));
    function paintAct(i) {
      const a = ACTS[i]; dTags.replaceChildren(...a.tags()); dTitle.textContent = a.title; dLine.textContent = a.line;
      dSteps.forEach((b, k) => { b.setAttribute('aria-pressed', String(k === i)); if (k !== i) b.querySelector('b').style.transform = 'scaleX(0)'; });
      dBtn.hidden = i === 2; dBtn.replaceChildren(...(i === 0 ? [icon('play'), 'Run it live'] : [icon('mission'), 'Send to the mission']));
      dBtn.disabled = false;
    }
    dBtn.addEventListener('click', async () => {
      if (!hero) return;
      if (hero.act === 1) { const p = hero.leadPx(); if (!p) { shell.toast('The drone has not flagged anyone yet. Let the mission clock run.', { level: 'info' }); return; } const m = hero.mainLead().match, [x, y] = sitePx(p);
        if (!ctx.sim.command('aerialLead', { pos: p, px: [Math.round(x), Math.round(y)], frame: 'SITE', method: 'colour', score: m ? +m.peak.toFixed(1) : null, colour: m ? m.name : null })) { shell.toast('That spot is already a lead in the mission.', { level: 'info' }); return; }
        const lead = S().aerial.leads[S().aerial.leads.length - 1]; bus.emit('aerial:lead', { ...lead }); shell.toast('Sent to the mission log as ' + lead.id + (lead.matches ? '. It agrees with the drone\'s ' + lead.matches + '.' : '.'), { level: 'ok' }); return; }
      dBtn.disabled = true; dBtn.replaceChildren(h('span.spinner'), 'Running');
      try {
        await hero.live(async (src, q) => { const c = await tileCanvas(src); return detectOn(c, q.x - q.k * 1104, q.y, q.w, q.w); }, async (say) => {
          const tick = setInterval(() => say(st.det.total ? 'Loading the detector: ' + (st.det.loaded / 1e6).toFixed(1) + ' of ' + (st.det.total / 1e6).toFixed(1) + ' MB' : 'Loading the detector…'), 120);
          try { await loadDetector(); } finally { clearInterval(tick); }
          if (st.det.status !== 'ready') throw new Error(st.det.error || 'The detector did not load.');
        });
      } catch (e) { shell.toast('The live run stopped: ' + (e.message || e) + ' The recorded run is still shown.', { level: 'alert' }); }
      paintAct(hero.act);
    });
    const tileCs = new Map();
    async function tileCanvas(src) { if (!tileCs.has(src)) tileCs.set(src, canvasFrom(src, src.width, src.height)); return tileCs.get(src); }
    async function startHero() {
      if (heroState !== 'none') { hero?.start(); return; }
      heroState = 'loading'; paintAct(0); dCap.textContent = 'Loading the frames';
      await Promise.all([recReady, genReady]);
      try {
        const onState = (m) => { if (m.kind === 'act') paintAct(m.act); else if (m.kind === 'caption') { if (dCap.textContent !== m.text) { dCap.textContent = m.text; dCap.classList.remove('is-in'); void dCap.offsetWidth; dCap.classList.add('is-in'); } const same = dFig.children.length === m.figures.length; if (same) m.figures.forEach(([v, l], i) => { const b = dFig.children[i]; if (b.firstChild.textContent !== v) b.firstChild.textContent = v; if (b.lastChild.textContent !== l) b.lastChild.textContent = l; }); else dFig.replaceChildren(...m.figures.map(([v, l]) => h('div.ah-fig', null, h('b.num', null, v), h('span', null, l)))); } };
        onState.progress = (i, k) => { dSteps[i].querySelector('b').style.transform = 'scaleX(' + k.toFixed(3) + ')'; };
        hero = await createHero(demo.querySelector('.ah-stage'), { h, css, world, reduced: kit.reducedMotion(), recorded, minScore: DET_DEFAULT, rxThr: RX_DEFAULT, chgThr: CHG_DEFAULT, siteSpec, outdoorLeads, onState,
          missed: { x: 690, y: 655, r: 34 }, warn: (m) => shell.toast(m, { level: 'alert' }),
          rpc: () => (heroCv ??= rpc(new Worker(new URL('./cv.worker.js', import.meta.url), { type: 'module' }))),
          loadBitmap: async (id) => { const f = frames.get(id); if (!f) throw new Error('frame ' + id + ' is missing'); const r = await fetch(f.url); if (!r.ok) throw new Error(id + ' could not be fetched (' + r.status + ')'); return createImageBitmap(await r.blob()); } });
        heroState = 'ready'; if (st.shown && ctx.mode === 'demo') hero.start();
      } catch (e) { heroState = 'failed'; demo.classList.add('is-failed'); dCap.textContent = 'The film needs WebGL and a network connection (' + (e.message || e) + '). The tools work in Advanced.'; }
    }
    let thumbs = false;
    function applyMode() {
      if (!st.shown) return;
      if (ctx.mode === 'demo') { viewer.stop(); cancelRun(); startHero(); return; }
      hero?.stop(); viewer.start(); onTick(); renderMission(true); renderSide(); renderScore();
      if (!started) { started = true; setTimeout(runBench, 1200); }
      if (!thumbs) { thumbs = true; (async () => { await genReady; for (const id of [...order]) { const f = frames.get(id); if (f.status === 'idle') await loadFrame(f); } })(); }   // thumbnails, one at a time
    }
    offs.push(bus.on('mode', applyMode), bus.on('prefs', () => hero?.recolour()));

    // ---------- start ----------
    buildFilm(); renderScore(); renderMission(true);
    toolSeg.querySelector('#aerial-tab-' + st.tool).setAttribute('aria-selected', 'true');
    const startId = ctx.params?.frame && frames.has(ctx.params.frame) ? ctx.params.frame : 'R-01';
    if (ctx.params?.tool && TOOLS.some((t) => t.id === ctx.params.tool)) { st.tool = ctx.params.tool; toolSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.id === 'aerial-tab-' + st.tool))); }
    selectFrame(startId);
    let started = false;
    const api = {
      onShow() { st.shown = true; applyMode(); },
      onHide() { st.shown = false; viewer.stop(); hero?.stop(); cancelRun(); },
      onParams(p) { if (p?.tool && TOOLS.some((t) => t.id === p.tool)) setTool(p.tool); if (p?.frame && frames.has(p.frame)) selectFrame(p.frame); if (p?.detection) { const d = S().detections.find((x) => x.id === p.detection); if (d?.pos) showLead(d); } },
      // for the automated checks
      debug: { st, frames, loadFrame, loadDetector, runBench, runDetBench, viewer, detectFrame, selectFrame, setTool, runTool, select, get cur() { return cur(); }, get hero() { return hero; } },
    };
    window.HOUND_AERIAL = api.debug;
    return api;
  },
};
