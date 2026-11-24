// Live quakes (id: globe). Real earthquakes from the USGS feed on a 3-D globe, with a time scrubber, a sortable
// list and a detail card that shows only what the feed gives. Label: real data. The search exercise elsewhere in
// the console is simulated; this workspace shows the console can be pointed at a real event.
import { FEEDS, SITE, cached, loadFeed, DEPTH_STOPS, depthPos, rgb, magRadius, energyJ, energyToMag, MAG_TYPES, clock, utc, local, ago, int, latLon } from './data.js';
import { createScene } from './scene.js';

const asset = (p) => new URL(p, import.meta.url).href;
if (!document.querySelector('link[data-globe-css]')) {
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = asset('./style.css'); l.dataset.globeCss = '1'; document.head.append(l);
}

const MIN_MAGS = [[-Infinity, 'All'], [2.5, '2.5+'], [4.5, '4.5+'], [6, '6+']];
const ROW_H = 30;
const NR = 'not reported';
const svgEl = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

export default {
  async mount(root, ctx) {
    const { h, icon, realityTag, cssVar } = ctx.kit;
    root.classList.add('globe');

    const S = {
      feed: 'week', data: null, loading: false, error: null, t: 0, playing: false, speed: 1, sel: null, hover: null,
      minMag: -Infinity, query: '', sort: { key: 'time', dir: -1 }, shown: false,
    };
    let rows = [], vis = [], reduced = ctx.kit.reducedMotion(), stepAcc = 0, refreshTimer = 0, loadSeq = 0;
    const offPrefs = ctx.bus.on('prefs', () => { reduced = ctx.kit.reducedMotion(); });
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => { reduced = ctx.kit.reducedMotion(); });

    // ---------- stage: canvas, leader lines, labels, tooltip ----------
    const stage = h('div.globe-stage');
    const leads = svgEl('svg', { class: 'globe-leads', 'aria-hidden': 'true' });
    const siteLine = svgEl('line', { class: 'globe-lead' }), siteDot = svgEl('circle', { class: 'globe-site-dot', r: 3 }), siteRing = svgEl('circle', { class: 'globe-site-ring', r: 7 });
    const selLine = svgEl('line', { class: 'globe-lead' });
    leads.append(siteLine, siteRing, siteDot, selLine);
    const siteLabel = h('div.globe-label', null, SITE.label);
    const selLabel = h('div.globe-label.globe-label-sel');
    const tip = h('div.tooltip.show.globe-tip', { hidden: true });
    stage.append(leads, siteLabel, selLabel);

    // ---------- header ----------
    const sentence = h('p.muted.globe-sentence');
    const fetchLine = h('p.globe-fetch', { 'aria-live': 'polite' });
    const feedSeg = h('div.seg', { role: 'group', 'aria-label': 'USGS feed' }, Object.values(FEEDS).map((f) =>
      h('button', { type: 'button', 'data-feed': f.id, title: f.title, onclick: () => switchFeed(f.id) }, f.label)));
    const layer = (key, label, title) => h('label.check', { title }, h('input', { type: 'checkbox', checked: true, 'data-layer': key, onchange: (e) => scene.setLayer(key, e.target.checked) }), label);
    const refreshBtn = h('button.btn', { type: 'button', title: 'Fetch the feed again now. It also refreshes by itself every 5 minutes while this workspace is open.', onclick: () => load() }, icon('reset'), 'Refresh');
    const header = h('header.globe-head.glass', null,
      h('div.globe-head-text', null, h('div.row', null, h('h1', null, 'Live earthquakes'), realityTag('real-data')), sentence),
      h('div.globe-head-tools', null,
        h('div.row.globe-tools-row', null, feedSeg,
          layer('plates', 'Plate boundaries', 'Draw the boundaries between tectonic plates (Bird 2003, PB2002).'),
          layer('lights', 'City lights', 'Show night-time lights on the dark side (NASA Black Marble, 2016).'),
          layer('sun', 'Sunlight', 'Light the globe from where the sun really was at the time on the scrubber. Off: the whole globe is shown as night.'),
          refreshBtn),
        fetchLine));

    // ---------- left: the list ----------
    const countEl = h('span.num.globe-count');
    const magSeg = h('div.seg', { role: 'group', 'aria-label': 'Smallest magnitude to show in the list, on the globe and in the chart' }, MIN_MAGS.map(([m, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(m === S.minMag), title: label === 'All' ? 'Every magnitude' : 'Magnitude ' + label.replace('+', ' and over'), onclick: () => setMinMag(m) }, label)));
    const search = h('input.input', { type: 'search', placeholder: 'Filter by place', 'aria-label': 'Filter the list by place name', oninput: (e) => { S.query = e.target.value; rebuildRows(); renderList(true); } });
    const COLS = [['mag', 'Magnitude', 'Mag'], ['place', 'Place', 'Place'], ['time', 'Time', 'When'], ['depth', 'Depth', 'Depth']];
    const ths = COLS.map(([key, full, short]) => h('th.globe-c-' + key, { scope: 'col' }, h('button.globe-sort', { type: 'button', title: 'Sort by ' + full.toLowerCase(), onclick: () => setSort(key) }, short)));
    const tbody = h('tbody');
    const table = h('table.table.globe-table', { 'aria-label': 'Earthquakes in this feed' }, h('thead', null, h('tr', null, ths)), tbody);
    const listState = h('div.empty.globe-list-state');
    const scroller = h('div.globe-scroll', { onscroll: () => renderList(false) }, table, listState);
    const listPanel = h('section.globe-list.glass', { 'aria-label': 'Earthquake list' },
      h('div.globe-pane-head', null, h('h3', null, 'Earthquakes'), countEl),
      h('div.globe-filters', null, h('div.row', null, h('span.globe-lbl', null, 'Magnitude'), magSeg), search),
      scroller,
      h('p.chart-note.globe-credit', null, 'Earthquakes: USGS Earthquake Hazards Program. Imagery: NASA Blue Marble and Black Marble. Plate boundaries: Bird (2003), PB2002.'));

    // ---------- right: the selected event, or the feed summary ----------
    const detailBody = h('div.globe-detail-body');
    const detailPanel = h('section.globe-detail.glass', { 'aria-label': 'Selected earthquake or feed summary' }, detailBody,
      h('div.globe-notes', null,
        h('p.note.quiet', null, icon('info', 14), h('span', null, 'Magnitude is the energy released, not the damage. Damage depends on depth, distance to people, the ground and how buildings are built. That is why HOUND does not guess how many people need finding.')),
        h('p.note', null, icon('info', 14), h('span', null, 'This shows the console can be pointed at a real event. The search exercise in the other workspaces is simulated.'))));

    // ---------- middle: nothing but the globe, and messages when the feed fails ----------
    const alerts = h('div.globe-alerts');
    const free = h('div.globe-free', null, alerts);

    // ---------- bottom: the scrubber ----------
    const playBtn = h('button.btn.btn-primary.globe-play', { type: 'button', onclick: () => togglePlay() });
    const speedSeg = h('div.seg', { role: 'group', 'aria-label': 'Replay speed' }, [1, 2, 4].map((x) =>
      h('button', { type: 'button', 'aria-pressed': String(x === 1), title: 'Replay the whole period in ' + 40 / x + ' seconds', onclick: (e) => { S.speed = x; for (const b of speedSeg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); } }, x + '×')));
    const nowBtn = h('button.btn', { type: 'button', title: 'Move the playhead to the moment the feed was fetched', onclick: () => { S.playing = false; if (S.data) setTime(S.data.tMax); syncPlay(); } }, 'Now');
    const timeEl = h('b.num.globe-time'), soFar = h('span.globe-sofar'), sunEl = h('span.globe-sun', { title: 'Where the sun was straight overhead at the scrubber time, computed from the date and time (declination and the equation of time). It sets the day and night sides of the globe.' });
    const grad = 'linear-gradient(90deg,' + DEPTH_STOPS.map(([d, c]) => rgb(c) + ' ' + (depthPos(d) * 100).toFixed(1) + '%').join(',') + ')';
    const legend = h('div.legend.globe-legend', null,
      h('div.globe-leg', { title: 'Marker size grows with magnitude. It is clamped, not to scale with energy: each whole magnitude is about 32 times the energy.' }, h('span.globe-lbl', null, 'Magnitude'),
        [3, 5, 7].map((m) => h('span.globe-leg-size', null, h('i', { style: { width: 2 * magRadius(m) + 'px', height: 2 * magRadius(m) + 'px' } }), 'M' + m))),
      h('div.globe-leg', { title: 'Marker colour is the depth of the earthquake below the surface. Shallow events are bright; deep ones are blue.' }, h('span.globe-lbl', null, 'Depth, km'),
        h('div.globe-ramp', null, h('i', { style: { background: grad } }), [0, 20, 70, 300, 700].map((d) => h('span.num', { style: { left: depthPos(d) * 100 + '%' } }, String(d))))));
    const plotTitle = h('p.chart-title.globe-plot-title');
    const plotCanvas = h('canvas');
    const plot = h('div.globe-plot', { role: 'slider', tabindex: '0', 'aria-label': 'Replay time, UTC. Arrow keys move one step, Page Up and Page Down one day.', 'aria-orientation': 'horizontal' }, plotCanvas);
    const scrub = h('section.globe-scrub.glass', { 'aria-label': 'Replay: magnitude against time' },
      h('div.globe-scrub-row', null, playBtn, speedSeg, nowBtn, h('div.globe-readout', null, timeEl, h('span.globe-readout-sub', null, soFar, sunEl))),
      h('div.globe-scrub-row.globe-scrub-meta', null, plotTitle, h('div.grow'), legend),
      plot);

    // ---------- Demo: the Earth, the week, three figures ----------
    const D = { t: 0, i: 0, big: null, near: null, list: null, sorted: [], last: '' }, SPAN = 64, HOLD = 9;   // seconds for the week, then a held beat over Nepal
    const demoFig = (label) => { const b = h('b', null, '–'), s = h('span', null, label); return { b, s, el: h('div.globe-fig', null, b, s) }; };
    const figN = demoFig('earthquakes located'), figBig = demoFig('largest so far'), figNear = demoFig('nearest M4.5+ to Timure');
    const demoNow = h('span.globe-demo-now');
    const demoUi = h('div.globe-demo.demo-only', null,
      h('section.globe-demo-title', null, h('div.row', null, realityTag('real-data')),
        h('h1', null, 'A week of earthquakes.'),
        h('p', null, 'Everything USGS located in seven days, replayed. Magnitude is energy, not damage. The search exercise itself is simulated.'),
        h('div.row', null, h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: () => ctx.shell.open('area') }, 'Go to the valley'), demoNow)),
      h('div.globe-demo-figs', null, figN.el, figBig.el, figNear.el),
      h('p.globe-demo-credit', null, 'USGS · NASA Blue Marble, Black Marble · Bird (2003)'));
    const demoOn = () => ctx.mode === 'demo';
    const put = (el, s) => { if (el.textContent !== s) el.textContent = s; };
    function demoFrame(dt) {
      const d = S.data;
      if (!d || !d.quakes.length) { put(demoNow, S.error ? 'USGS could not be reached. Nothing is drawn.' : 'Asking USGS for the feed…'); return; }
      if (!reduced) D.t += dt; else D.t = SPAN;
      if (D.t > SPAN + HOLD) { D.t = 0; D.i = 0; D.big = D.near = null; }
      const u = Math.min(1, D.t / SPAN), t = d.tMin + (d.tMax - d.tMin) * u, e = u * u * (3 - 2 * u);
      scene.setTime(t, { winH: 5.5, tauH: spanH() * 0.1, playing: u < 1 }); scene.setSun(t);
      scene.setDrift(-6 + 31 * e, 168 - 80 * e, 1 - 0.16 * e);
      if (D.list !== d) { D.list = d; D.sorted = d.quakes.slice().sort((a, b) => a.time - b.time); D.i = 0; D.big = D.near = null; }
      let changed = false;
      while (D.i < D.sorted.length && D.sorted[D.i].time <= t) { const q = D.sorted[D.i++]; changed = true; if (!D.big || q.mag > D.big.mag) D.big = q; if (q.mag >= 4.5 && (!D.near || q.km < D.near.km)) D.near = q; }
      if (changed) { put(figN.b, int(D.i)); if (D.big) { put(figBig.b, 'M ' + D.big.mag.toFixed(1)); put(figBig.s, D.big.place || 'place ' + NR); } put(figNear.b, D.near ? int(D.near.km) + ' km' : '–'); }
      const line = utc(t) + (u >= 1 ? ', fetched ' + clock(d.fetchedAt, true) : ''); if (line !== D.last) { D.last = line; put(demoNow, line); }
    }
    function enterMode() {
      hideTip(); scene.setWide(demoOn()); S.playing = false;
      if (demoOn()) { if (S.feed !== 'week') switchFeed('week'); if (S.sel) select(null); if (S.minMag > -Infinity) setMinMag(-Infinity); D.t = 0; D.list = null; scene.face(-6, 168); }
      else { scene.setDrift(null); syncPlay(); requestAnimationFrame(() => { bakePlot(); renderList(true); if (S.data) setTime(S.data.tMax); }); }
      requestAnimationFrame(fitFrame);
    }
    for (const p of [header, listPanel, detailPanel, scrub]) p.classList.add('adv-only');
    const ui = h('div.globe-ui', null, header, listPanel, free, detailPanel, scrub);
    root.append(stage, ui, demoUi, tip);

    // ---------- the 3-D scene ----------
    const scene = createScene(stage, {
      accent: cssVar('--accent'), backdrop: cssVar('--bg-0'), reduced: () => reduced,
      onFrame(dt) {
        if (demoOn()) { demoFrame(dt); return; }
        if (!S.playing || !S.data) return;
        const rate = FEEDS[S.feed].spanMs / 40 * S.speed;                   // feed milliseconds per real second
        if (reduced) { stepAcc += dt; if (stepAcc < 0.6) return; setTime(S.t + rate * stepAcc); stepAcc = 0; } else setTime(S.t + rate * dt);
        if (S.t >= S.data.tMax) { S.playing = false; syncPlay(); }
      },
      onAfter: placeLabels,
      onInteract() { hideTip(); },
    });
    stage.prepend(scene.canvas);
    scene.loadTextures({ day: asset('./tex/earth_day.jpg'), night: asset('./tex/earth_night.jpg'), water: asset('./tex/earth_water.jpg') })
      .catch(() => ctx.shell.toast('The Earth imagery did not load. The globe is drawn plain; the earthquake data is not affected.', { level: 'info' }));
    fetch(asset('./plates.json')).then((r) => r.json()).then((j) => scene.setPlates(j.lines))
      .catch(() => { const box = header.querySelector('[data-layer="plates"]'); box.checked = false; box.disabled = true; box.parentElement.title = 'The plate boundary file did not load.'; });

    const frameBox = { l: 0, t: 0, r: 0, b: 0 };
    const fitFrame = () => {
      const a = stage.getBoundingClientRect(), f = free.getBoundingClientRect();
      if (demoOn() && a.width) { Object.assign(frameBox, { l: 12, t: 12, r: a.width - 12, b: a.height - 250 }); scene.setFrame(a.width * 0.615, a.height * 0.60, a.height * 1.36); return; }
      if (!f.width || !f.height) return;
      Object.assign(frameBox, { l: f.left - a.left, t: f.top - a.top, r: f.right - a.left, b: f.bottom - a.top });
      scene.setFrame((frameBox.l + frameBox.r) / 2, (frameBox.t + frameBox.b) / 2, Math.min(f.height, f.width * 1.3));
    };
    new ResizeObserver(fitFrame).observe(free);
    new ResizeObserver(fitFrame).observe(stage);

    // ---------- labels on the globe ----------
    const P = {};
    function placeLabel(v, line, label, show, lift) {
      scene.project(v, P);
      const on = show && P.front;
      label.hidden = !on; line.style.display = on ? '' : 'none';
      if (!on) return false;
      const cx = (frameBox.l + frameBox.r) / 2, cy = (frameBox.t + frameBox.b) / 2;
      let dx = P.x - cx, dy = P.y - cy; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      if (Math.abs(dy) < 0.35) dy = lift * 0.6;
      const w = label.offsetWidth, hh = label.offsetHeight, ax = P.x + dx * 44, ay = P.y + (dy < 0 ? -1 : 1) * 30 * Math.max(0.6, Math.abs(dy));
      const x = Math.min(frameBox.r - w - 6, Math.max(frameBox.l + 6, dx >= 0 ? ax : ax - w));
      const y = Math.min(frameBox.b - hh - 6, Math.max(frameBox.t + 6, ay - hh / 2));
      label.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      const ex = Math.min(x + w, Math.max(x, P.x)), ey = Math.min(y + hh, Math.max(y, P.y));
      line.setAttribute('x1', P.x); line.setAttribute('y1', P.y); line.setAttribute('x2', ex); line.setAttribute('y2', ey);
      return true;
    }
    function placeLabels() {
      const siteOn = placeLabel(scene.site, siteLine, siteLabel, true, -1);
      siteDot.style.display = siteRing.style.display = siteOn ? '' : 'none';
      if (siteOn) { scene.project(scene.site, P); for (const c of [siteDot, siteRing]) { c.setAttribute('cx', P.x); c.setAttribute('cy', P.y); } }
      placeLabel(S.sel ? S.sel.v : scene.site, selLine, selLabel, !!S.sel && S.sel.time <= S.t, 1);
    }

    // ---------- tooltip and picking on the globe ----------
    const tipText = (q) => [h('b.num', null, 'M ' + q.mag.toFixed(1)), h('span', null, q.place || 'Place ' + NR), h('span.dim', null, ago(q.time) + (q.depth != null ? ', ' + q.depth.toFixed(0) + ' km deep' : ''))];
    function showTip(q, clientX, clientY) {
      const a = root.getBoundingClientRect();
      tip.replaceChildren(...tipText(q)); tip.hidden = false;
      const x = Math.min(a.width - tip.offsetWidth - 8, clientX - a.left + 14), y = Math.min(a.height - tip.offsetHeight - 8, Math.max(8, clientY - a.top + 14));
      tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    }
    function hideTip() { tip.hidden = true; }
    function setHover(q) { if (S.hover === q) return; S.hover = q; scene.setMarks(S.sel, S.hover); scene.setHold(!!(S.sel || S.hover)); drawPlot(); }
    let downAt = null;
    scene.canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
    scene.canvas.addEventListener('pointermove', (e) => {
      if (e.buttons || !S.data) return;
      const r = scene.canvas.getBoundingClientRect(), q = scene.pick(e.clientX - r.left, e.clientY - r.top, S.t, S.minMag);
      setHover(q); scene.canvas.style.cursor = q ? 'pointer' : '';
      if (q) showTip(q, e.clientX, e.clientY); else hideTip();
    });
    scene.canvas.addEventListener('pointerleave', () => { setHover(null); hideTip(); });
    scene.canvas.addEventListener('pointerup', (e) => {
      if (!downAt || !S.data || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
      const r = scene.canvas.getBoundingClientRect(), q = scene.pick(e.clientX - r.left, e.clientY - r.top, S.t, S.minMag);
      if (q) select(q);
    });

    // ---------- time ----------
    const spanH = () => FEEDS[S.feed].spanMs / 36e5;
    const countAt = (t) => { let lo = 0, hi = vis.length; while (lo < hi) { const m = (lo + hi) >> 1; if (vis[m].time <= t) lo = m + 1; else hi = m; } return lo; };
    function setTime(t) {
      const d = S.data; if (!d) return;
      S.t = Math.min(d.tMax, Math.max(d.tMin, t));
      const rateH = spanH() / 40 * S.speed;                                // feed hours per real second while playing
      scene.setTime(S.t, { winH: S.playing ? Math.max(3, rateH * 0.9) : 3, tauH: spanH() * 0.1, playing: S.playing });
      const sun = scene.setSun(S.t), n = countAt(S.t), atNow = S.t >= d.tMax - 1000;
      timeEl.textContent = utc(S.t);
      soFar.replaceChildren(h('span.num', null, int(n)), ' of ', h('span.num', null, int(vis.length)), atNow ? ' shown, up to the fetch' : ' had happened by then');
      sunEl.textContent = 'Sun overhead at ' + latLon(sun.lat, sun.lon, 1);
      plot.setAttribute('aria-valuemin', '0'); plot.setAttribute('aria-valuemax', String(Math.round(spanH())));
      plot.setAttribute('aria-valuenow', String(Math.round((S.t - d.tMin) / 36e5)));
      plot.setAttribute('aria-valuetext', utc(S.t) + ', ' + int(n) + ' of ' + int(vis.length) + ' earthquakes so far');
      drawPlot();
      if (!S.shown) scene.renderOnce();
    }
    function syncPlay() {
      const what = S.feed === 'week' ? 'week' : 'month';
      playBtn.replaceChildren(icon(S.playing ? 'pause' : 'play'), S.playing ? 'Pause' : 'Replay the ' + what);
      playBtn.title = S.playing ? 'Pause the replay' : 'Replay the ' + what + ' from the start. Earthquakes appear as they happened.';
      playBtn.disabled = nowBtn.disabled = !S.data;
      if (S.data) setTime(S.t);
    }
    function togglePlay() {
      if (!S.data) return;
      if (!S.playing && S.t >= S.data.tMax - 1000) S.t = S.data.tMin;
      S.playing = !S.playing; stepAcc = 0; syncPlay();
    }

    // ---------- the magnitude-time plot ----------
    const PAD = { l: 46, r: 40, t: 8, b: 20 };
    const G = { w: 0, h: 0, dpr: 1, y0: 0, y1: 8, bright: document.createElement('canvas'), dim: document.createElement('canvas'), axes: document.createElement('canvas') };
    const xOf = (t) => PAD.l + (t - S.data.tMin) / (S.data.tMax - S.data.tMin) * (G.w - PAD.l - PAD.r);
    const yOf = (m) => PAD.t + (1 - (m - G.y0) / (G.y1 - G.y0)) * (G.h - PAD.t - PAD.b);
    const tOf = (x) => S.data.tMin + (x - PAD.l) / (G.w - PAD.l - PAD.r) * (S.data.tMax - S.data.tMin);
    const dotR = (m) => Math.min(4.6, Math.max(1.2, 1.1 + 0.36 * m));
    function bakePlot() {
      const r = plot.getBoundingClientRect(); if (!r.width || !r.height) return;
      G.w = r.width; G.h = r.height; G.dpr = Math.min(2, window.devicePixelRatio || 1);
      for (const c of [plotCanvas, G.bright, G.dim, G.axes]) { c.width = Math.round(G.w * G.dpr); c.height = Math.round(G.h * G.dpr); }
      const d = S.data, ax = G.axes.getContext('2d'); ax.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
      const cLine = cssVar('--line'), cLine2 = cssVar('--line-2'), cText = cssVar('--text-2'), cTick = cssVar('--text-3'), fTitle = '500 11px ' + cssVar('--font'), fTick = '500 11px ' + cssVar('--mono');
      ax.font = fTitle; ax.fillStyle = cText; ax.textBaseline = 'middle';
      ax.save(); ax.translate(11, PAD.t + (G.h - PAD.t - PAD.b) / 2); ax.rotate(-Math.PI / 2); ax.textAlign = 'center'; ax.fillText('Magnitude', 0, 0); ax.restore();
      if (!d || !d.quakes.length) {
        ax.textAlign = 'center'; ax.fillStyle = cTick;
        ax.fillText(d ? 'The feed is empty: nothing to plot.' : S.loading ? 'Waiting for the USGS feed…' : 'Nothing to plot: no feed is loaded.', PAD.l + (G.w - PAD.l - PAD.r) / 2, PAD.t + (G.h - PAD.t - PAD.b) / 2);
        drawPlot(); return;
      }
      const mags = d.quakes.map((q) => q.mag), lo = Math.min(...mags), hi = Math.max(...mags);
      G.y0 = d.quakes.length ? Math.floor(Math.min(lo, hi - 3)) : 0; G.y1 = d.quakes.length ? Math.max(G.y0 + 3, Math.ceil(hi + 0.25)) : 8;
      ax.textAlign = 'right'; ax.lineWidth = 1; ax.font = fTick; ax.fillStyle = cTick;
      const stepY = G.y1 - G.y0 > 5 ? 2 : 1;
      for (let m = Math.ceil(G.y0 / stepY) * stepY; m <= G.y1; m += stepY) {
        const y = Math.round(yOf(m)) + 0.5;
        ax.strokeStyle = cLine; ax.beginPath(); ax.moveTo(PAD.l, y); ax.lineTo(G.w - PAD.r, y); ax.stroke();
        ax.fillText(String(m), PAD.l - 8, y);
      }
      // day ticks: every UTC midnight; a date on each (week) or every fifth (month)
      ax.textAlign = 'center'; ax.textBaseline = 'alphabetic';
      const days = Math.round(FEEDS[d.feed].spanMs / 864e5), every = days > 10 ? 5 : 1;
      const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: days > 10 ? undefined : 'short', day: 'numeric', month: 'short' });
      const first = Math.ceil(d.tMin / 864e5) * 864e5;
      for (let t = first, k = 0; t <= d.tMax; t += 864e5, k++) {
        const x = Math.round(xOf(t)) + 0.5, major = (Math.round(t / 864e5) % every) === 0;
        ax.strokeStyle = major ? cLine2 : cLine; ax.beginPath(); ax.moveTo(x, PAD.t); ax.lineTo(x, G.h - PAD.b + (major ? 4 : 0)); ax.stroke();
        if (major && x > PAD.l + 28 && x < G.w - PAD.r - 28) ax.fillText(dayFmt.format(t).replace(',', ''), x, G.h - 4);
      }
      ax.textAlign = 'left'; ax.font = fTitle; ax.fillStyle = cText; ax.fillText('UTC', G.w - PAD.r + 8, G.h - 4);
      for (const [c, alphaIn, alphaOut] of [[G.bright, 0.9, 0.16], [G.dim, 0.26, 0.10]]) {
        const g = c.getContext('2d'); g.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
        for (const q of d.quakes) {
          q.px = xOf(q.time); q.py = yOf(q.mag);
          g.fillStyle = rgb(q.col, q.mag >= S.minMag ? alphaIn : alphaOut);
          g.beginPath(); g.arc(q.px, q.py, dotR(q.mag), 0, 6.2832); g.fill();
        }
      }
      drawPlot();
    }
    function ringDot(g, q, color, extra) {
      g.strokeStyle = color; g.lineWidth = 1.5; g.beginPath(); g.arc(q.px, q.py, dotR(q.mag) + extra, 0, 6.2832); g.stroke();
    }
    function drawPlot() {
      if (!G.w) return;
      const g = plotCanvas.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, plotCanvas.width, plotCanvas.height);
      g.drawImage(G.axes, 0, 0);
      if (!S.data || !S.data.quakes.length) return;
      const xT = xOf(S.t), W = plotCanvas.width, H = plotCanvas.height;
      g.drawImage(G.dim, 0, 0);
      g.save(); g.beginPath(); g.rect(0, 0, xT * G.dpr, H); g.clip(); g.drawImage(G.bright, 0, 0); g.restore();
      g.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
      if (S.hover && S.hover.px != null) ringDot(g, S.hover, cssVar('--text-2'), 2.5);
      if (S.sel && S.sel.px != null) ringDot(g, S.sel, cssVar('--text'), 3);
      const x = Math.round(xT) + 0.5, accent = cssVar('--accent');
      g.strokeStyle = accent; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, PAD.t - 2); g.lineTo(x, G.h - PAD.b + 2); g.stroke();
      g.fillStyle = accent; g.beginPath(); g.roundRect(x - 4.5, 0, 9, 11, 2.5); g.fill();
      void W;
    }
    new ResizeObserver(bakePlot).observe(plot);

    const nearDot = (x, y) => { let best = null, bd = 7; if (S.data) for (const q of S.data.quakes) { const dd = Math.hypot(q.px - x, q.py - y); if (dd < bd) { bd = dd; best = q; } } return best; };
    let drag = null;
    plot.addEventListener('pointerdown', (e) => { if (!S.data) return; try { plot.setPointerCapture(e.pointerId); } catch { /* a pointer that is already gone: the drag still works inside the plot */ } const r = plot.getBoundingClientRect(); drag = { x0: e.clientX, moved: false, left: r.left, top: r.top }; });
    plot.addEventListener('pointermove', (e) => {
      if (!S.data) return;
      const r = plot.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (drag) {
        if (!drag.moved && Math.abs(e.clientX - drag.x0) > 3) { drag.moved = true; S.playing = false; syncPlay(); hideTip(); setHover(null); }
        if (drag.moved) setTime(tOf(x));
        return;
      }
      const q = nearDot(x, y); setHover(q); plot.style.cursor = q ? 'pointer' : '';
      if (q) showTip(q, e.clientX, e.clientY); else hideTip();
    });
    plot.addEventListener('pointerup', (e) => {
      if (!drag || !S.data) { drag = null; return; }
      const r = plot.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, moved = drag.moved; drag = null;
      if (moved) return;
      const q = nearDot(x, y);
      if (q) select(q, { fly: true }); else { S.playing = false; syncPlay(); setTime(tOf(x)); }
    });
    plot.addEventListener('pointerleave', () => { if (!drag) { setHover(null); hideTip(); } });
    plot.addEventListener('keydown', (e) => {
      if (!S.data) return;
      const step = (S.feed === 'week' ? 1 : 6) * 36e5 * (e.shiftKey ? 6 : 1);
      const to = { ArrowLeft: S.t - step, ArrowDown: S.t - step, ArrowRight: S.t + step, ArrowUp: S.t + step, PageDown: S.t - 864e5, PageUp: S.t + 864e5, Home: S.data.tMin, End: S.data.tMax }[e.key];
      if (to != null) { e.preventDefault(); S.playing = false; syncPlay(); setTime(to); }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); togglePlay(); }
    });

    // ---------- the list ----------
    const cmp = {
      mag: (a, b) => a.mag - b.mag, time: (a, b) => a.time - b.time,
      depth: (a, b) => (a.depth ?? -1e9) - (b.depth ?? -1e9),
      place: (a, b) => (a.place || '￿').localeCompare(b.place || '￿'),
    };
    function rebuildRows() {
      const d = S.data, needle = S.query.trim().toLowerCase();
      vis = d ? d.quakes.filter((q) => q.mag >= S.minMag) : [];
      rows = needle ? vis.filter((q) => (q.place || '').toLowerCase().includes(needle)) : vis.slice();
      const c = cmp[S.sort.key]; rows.sort((a, b) => S.sort.dir * c(a, b) || b.time - a.time);
      COLS.forEach(([key], i) => ths[i].setAttribute('aria-sort', key === S.sort.key ? (S.sort.dir > 0 ? 'ascending' : 'descending') : 'none'));
      countEl.textContent = d ? (rows.length === d.quakes.length ? int(rows.length) : int(rows.length) + ' of ' + int(d.quakes.length)) : '';
    }
    function setSort(key) {
      S.sort = S.sort.key === key ? { key, dir: -S.sort.dir } : { key, dir: key === 'place' ? 1 : -1 };
      rebuildRows(); scroller.scrollTop = 0; renderList(true);
    }
    function setMinMag(m) {
      S.minMag = m;
      [...magSeg.children].forEach((b, i) => b.setAttribute('aria-pressed', String(MIN_MAGS[i][0] === m)));
      scene.setMinMag(m); rebuildRows(); renderList(true); bakePlot(); if (S.data) setTime(S.t);
    }
    const spacer = (px) => h('tr.globe-spacer', { 'aria-hidden': 'true' }, h('td', { colSpan: 4, style: { height: px + 'px' } }));
    function rowEl(q, now) {
      return h('tr', { tabindex: '0', 'data-id': q.id, 'aria-selected': String(S.sel === q), onclick: () => select(q, { fly: true }), onkeydown: (e) => rowKey(e, q) },
        h('td.globe-c-mag', null, h('i.globe-dot', { style: { background: rgb(q.col) } }), h('span.num', null, q.mag.toFixed(1))),
        h('td.globe-c-place', { title: q.place || '' }, q.place || 'Place ' + NR),
        h('td.globe-c-time.num', { title: utc(q.time) }, ago(q.time, now, true)),
        h('td.globe-c-depth.num', null, q.depth == null ? NR : q.depth.toFixed(0) + ' km'));
    }
    let win = [-1, -1];
    function renderList(force) {
      const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_H) - 10), last = Math.min(rows.length, Math.ceil((scroller.scrollTop + scroller.clientHeight) / ROW_H) + 10);
      if (!force && first === win[0] && last === win[1]) return;
      win = [first, last];
      const focusId = tbody.contains(document.activeElement) ? document.activeElement.dataset.id : null, now = Date.now();
      tbody.replaceChildren(spacer(first * ROW_H), ...rows.slice(first, last).map((q) => rowEl(q, now)), spacer((rows.length - last) * ROW_H));
      if (focusId) tbody.querySelector('[data-id="' + CSS.escape(focusId) + '"]')?.focus({ preventScroll: true });
      let msg = null;
      if (!S.data) msg = S.loading ? [h('div.spinner'), h('p', null, 'Loading the USGS feed…')] : [h('p', null, 'No feed loaded. Nothing is listed because nothing was received.')];
      else if (!rows.length) msg = [h('p', null, S.data.quakes.length ? 'No earthquake matches these filters.' : 'The feed is empty: USGS lists no events for this period.'),
        S.data.quakes.length ? h('button.btn.btn-sm', { type: 'button', onclick: () => { search.value = ''; S.query = ''; setMinMag(-Infinity); } }, 'Clear the filters') : null];
      listState.replaceChildren(...(msg || [])); listState.hidden = !msg; table.hidden = !S.data;
    }
    function rowKey(e, q) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); select(q, { fly: true }); return; }
      const dir = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0; if (!dir) return;
      e.preventDefault();
      const next = rows[rows.indexOf(q) + dir]; if (!next) return;
      const i = rows.indexOf(next), top = i * ROW_H, headH = table.tHead.offsetHeight;
      if (top < scroller.scrollTop) scroller.scrollTop = top; else if (top + ROW_H + headH > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + ROW_H + headH - scroller.clientHeight;
      renderList(false);
      tbody.querySelector('[data-id="' + CSS.escape(next.id) + '"]')?.focus({ preventScroll: true });
    }
    const markRows = () => { for (const tr of tbody.children) if (tr.dataset.id) tr.setAttribute('aria-selected', String(!!S.sel && tr.dataset.id === S.sel.id)); };

    // ---------- selection ----------
    function select(q, { fly = false } = {}) {
      S.sel = q || null;
      if (q) {
        if (q.mag < S.minMag) setMinMag(-Infinity);
        if (q.time > S.t) { S.playing = false; syncPlay(); setTime(q.time + 60e3); }
        if (fly) scene.flyTo(q.lat, q.lon);
        selLabel.textContent = 'M ' + q.mag.toFixed(1) + (q.place ? ', ' + q.place : '');
      }
      scene.setMarks(S.sel, S.hover); scene.setHold(!!(S.sel || S.hover));
      markRows(); renderDetail(); drawPlot(); if (!S.shown) scene.renderOnce();
    }

    // ---------- the detail card and the feed summary ----------
    const kv = (pairs) => h('dl.kv.globe-kv', null, pairs.filter(Boolean).map(([k, v, title]) => [h('dt', title ? { title } : null, k), h('dd', null, v)]));
    const nr = () => h('span.dim', null, NR);
    const ALERTS = { green: ['tag-ok', 'Green'], yellow: ['tag-warn', 'Yellow'], orange: ['tag-warn', 'Orange'], red: ['tag-danger', 'Red'] };
    const pick = (q, label) => h('button.globe-link', { type: 'button', title: 'Select this earthquake and turn the globe to it', onclick: () => select(q, { fly: true }) }, label);
    const sci = (x) => { const e = Math.floor(Math.log10(x)); return [(x / Math.pow(10, e)).toFixed(1) + ' × 10', h('sup', null, String(e)), ' J']; };

    function renderDetail() {
      const d = S.data, q = S.sel;
      if (q) {
        const a = q.alert && ALERTS[q.alert];
        detailBody.replaceChildren(...[
          h('div.globe-pane-head', null, h('h3', null, 'Selected earthquake'), h('button.btn.btn-ghost.btn-sm.btn-icon', { type: 'button', 'aria-label': 'Clear the selection', title: 'Clear the selection (Escape)', onclick: () => select(null) }, icon('close'))),
          h('div.globe-hero', null,
            h('div.globe-mag', null, h('b.num', null, q.mag.toFixed(1)), h('span', null, 'magnitude', h('br'), q.magType ? q.magType + (MAG_TYPES[q.magType.toLowerCase()] ? ', ' + MAG_TYPES[q.magType.toLowerCase()] : '') : 'type ' + NR)),
            h('p.globe-place', null, q.place || 'Place ' + NR),
            h('div.row.globe-actions', null,
              q.url ? h('a.btn', { href: q.url, target: '_blank', rel: 'noopener' }, 'Open the USGS event page') : h('span.dim', null, 'USGS event page ' + NR),
              h('button.btn.btn-ghost', { type: 'button', title: 'Turn the globe so this earthquake faces you', onclick: () => scene.flyTo(q.lat, q.lon) }, 'Face it'))),
          kv([
            ['Time, UTC', h('span.num', null, utc(q.time).replace(' UTC', '') + ' · ' + ago(q.time))],
            ['Your time', h('span.num', null, local(q.time))],
            ['Depth', q.depth == null ? nr() : h('span.num', null, q.depth.toFixed(1) + ' km')],
            ['Coordinates', h('span.num', null, latLon(q.lat, q.lon))],
            ['Distance to Timure', h('span.num', null, int(q.km) + ' km'), 'Great-circle distance to the exercise site, computed here with the haversine formula. The blue arc on the globe is this path.'],
            ['Felt reports', q.felt == null ? nr() : h('span.num', null, int(q.felt)), 'How many people told the USGS “Did You Feel It?” that they felt this earthquake.'],
            ['Felt intensity (CDI)', q.cdi == null ? nr() : h('span.num', null, q.cdi.toFixed(1)), 'Community Decimal Intensity: the strongest shaking people reported, on a scale of 1 to 10.'],
            ['Shaking (MMI)', q.mmi == null ? nr() : h('span.num', null, q.mmi.toFixed(1)), 'Modified Mercalli Intensity from the USGS ShakeMap: the strongest shaking estimated from instruments, 1 to 10.'],
            ['PAGER alert', a ? h('span.tag.' + a[0], null, a[1]) : q.alert ? q.alert : nr(), 'The alert level the USGS PAGER system published for this event. Shown as published; HOUND adds no estimate of its own.'],
            ['Review status', q.status || nr(), 'Automatic: located by software. Reviewed: checked by a seismologist.'],
            ['Significance', q.sig == null ? nr() : h('span.num', null, int(q.sig)), 'A USGS score from 0 to about 1,000 or more that combines magnitude, felt reports and alert level.'],
            q.type && q.type !== 'earthquake' ? ['Event type', q.type] : null,
          ]),
          h('p.globe-tsunami', null, 'USGS tsunami flag: ' + (q.tsunami == null ? NR : q.tsunami ? 'yes' : 'no') + '; this flag means the event is in an oceanic region and may warrant a look at tsunami.gov, not that a tsunami happened.')].flat().filter(Boolean));
        return;
      }
      if (!d) { detailBody.replaceChildren(h('div.globe-pane-head', null, h('h3', null, 'This feed')), h('p.muted.globe-empty', null, S.loading ? 'Waiting for the USGS feed…' : 'No feed loaded, so there is nothing to summarise.')); return; }
      const all = d.quakes, eq = all.filter((x) => !x.type || x.type === 'earthquake'), other = all.length - eq.length;
      const classes = [['Under 2.5', (m) => m < 2.5], ['2.5 to 4.4', (m) => m >= 2.5 && m < 4.5], ['4.5 to 5.9', (m) => m >= 4.5 && m < 6], ['6 and over', (m) => m >= 6]].map(([label, f]) => [label, all.filter((x) => f(x.mag)).length]);
      const top = Math.max(1, ...classes.map((c) => c[1]));
      const largest = all.reduce((a, b) => (!a || b.mag > a.mag ? b : a), null);
      const withDepth = all.filter((x) => x.depth != null), deepest = withDepth.reduce((a, b) => (!a || b.depth > a.depth ? b : a), null);
      const nearest = all.filter((x) => x.mag >= 4.5).reduce((a, b) => (!a || b.km < a.km ? b : a), null);
      const E = eq.reduce((s, x) => s + energyJ(x.mag), 0);
      const otherKinds = [...new Set(all.filter((x) => x.type && x.type !== 'earthquake').map((x) => x.type + 's'))];
      detailBody.replaceChildren(...[
        h('div.globe-pane-head', null, h('h3', null, 'This feed'), h('span.dim.globe-feedname', null, FEEDS[d.feed].title)),
        !all.length ? h('p.muted.globe-empty', null, 'The feed is empty: USGS lists no events for this period.') : [
          h('div.globe-classes', { role: 'img', 'aria-label': 'Events by magnitude: ' + classes.map((c) => c[0] + ' ' + c[1]).join(', ') }, classes.map(([label, n]) => [
            h('span', null, label), h('div.bar', null, h('i', { style: { width: Math.max(n ? 1.5 : 0, n / top * 100) + '%' } })), h('span.num', null, int(n))])),
          h('div.globe-facts', null,
            h('div', null, h('span.globe-fact-head', null, h('span.globe-lbl', null, 'Largest'), h('span.dim.num', null, ago(largest.time))), pick(largest, ['M ' + largest.mag.toFixed(1) + ', ' + (largest.place || 'place ' + NR)])),
            deepest ? h('div', null, h('span.globe-fact-head', null, h('span.globe-lbl', null, 'Deepest'), h('span.dim.num', null, ago(deepest.time))), pick(deepest, [deepest.depth.toFixed(0) + ' km, M ' + deepest.mag.toFixed(1) + ', ' + (deepest.place || 'place ' + NR)])) : null,
            h('div', null, h('span.globe-fact-head', null, h('span.globe-lbl', null, 'Nearest M4.5+ to Timure'), nearest ? h('span.dim.num', null, ago(nearest.time)) : null), nearest ? pick(nearest, [int(nearest.km) + ' km away, M ' + nearest.mag.toFixed(1) + ', ' + (nearest.place || 'place ' + NR)]) : h('span.dim', null, 'No magnitude 4.5 or larger event in this feed.')),
            eq.length ? h('div', null, h('span.globe-fact-head', null, h('span.globe-lbl', null, 'Total radiated energy'), h('span.tag.plain', null, 'estimate from magnitudes')), h('b.num.globe-energy', null, sci(E)),
              h('span.dim', null, 'log₁₀ E = 1.5 M + 4.8 joules (the Gutenberg-Richter energy relation), summed over ' + int(eq.length) + ' earthquakes. The same as one magnitude ' + energyToMag(E).toFixed(1) + ' earthquake.')) : null),
          other || d.dropped ? h('p.dim.globe-small', null, (other ? int(other) + ' of the ' + int(all.length) + ' events are not earthquakes (' + otherKinds.join(', ') + ', as USGS labels them); they are shown but left out of the energy sum. ' : '') + (d.dropped ? int(d.dropped) + ' events without a magnitude or a position are left out.' : '')) : null,
          h('p.dim.globe-small', null, 'Select an earthquake in the list, on the globe or in the chart to see what USGS reports about it.'),
        ]].flat().filter(Boolean));
    }

    // ---------- loading, failure, refresh ----------
    function renderHead() {
      const f = FEEDS[S.feed], d = S.data;
      sentence.textContent = f.sentence;
      for (const b of feedSeg.children) b.setAttribute('aria-pressed', String(b.dataset.feed === S.feed));
      fetchLine.replaceChildren(...(d ? ['USGS feed, fetched ', h('span.num', null, clock(d.fetchedAt, true)), d.generated ? [', generated ', h('span.num', null, clock(d.generated))] : null, S.loading ? ' · asking again…' : null].flat().filter(Boolean)
        : [S.loading ? 'Asking USGS for the feed…' : 'No feed loaded']));
      refreshBtn.disabled = S.loading;
      plotTitle.replaceChildren(...(d && d.quakes.length ? (() => { const big = d.quakes.reduce((a, b) => (b.mag > a.mag ? b : a)); return [h('span.num', null, int(d.quakes.length)), ' events in ' + (d.feed === 'week' ? '7' : '30') + ' days; the largest was M ', h('span.num', null, big.mag.toFixed(1)), ' on ' + new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(big.time).replace(',', '') + '.']; })() : ['Magnitude against time, UTC']));
      const retry = () => h('button.btn.btn-sm', { type: 'button', onclick: () => load() }, 'Retry');
      if (S.error && d) alerts.replaceChildren(h('div.note.warn.globe-alert', { role: 'status' }, icon('alert', 14), h('span', null, 'Could not reach USGS at ' + clock(S.error.at) + '. Showing the feed fetched at ' + clock(d.fetchedAt) + '.'), retry()));
      else if (S.error) alerts.replaceChildren(h('div.glass.globe-none', { role: 'alert' }, icon('alert', 22), h('h3', null, 'No earthquake data'),
        h('p.muted', null, 'Could not reach USGS at ' + clock(S.error.at) + '. ' + S.error.message + ' Nothing is drawn on the globe because nothing was received; this view never fills in with made-up events.'), retry()));
      else if (!d) alerts.replaceChildren(h('div.glass.globe-none', { role: 'status' }, h('div.spinner'), h('p.muted', null, 'Loading the USGS feed: ' + f.title.toLowerCase() + '…')));
      else alerts.replaceChildren();
    }
    function applyData(d) {
      const atNow = !S.data || S.data.feed !== d.feed || S.t >= S.data.tMax - 1000, selId = S.sel?.id, keepT = S.t;
      S.data = d; scene.setQuakes(d.quakes, d.tMin);
      S.sel = selId ? d.quakes.find((q) => q.id === selId) || null : null; S.hover = null;
      scene.setMarks(S.sel, null); scene.setHold(!!S.sel);
      rebuildRows(); S.t = atNow ? d.tMax : keepT; bakePlot(); setTime(S.t); renderList(true); renderDetail(); syncPlay();
    }
    function clearData() {
      S.data = null; S.sel = null; S.hover = null; S.playing = false; scene.setQuakes([], 0); scene.setMarks(null, null); scene.setHold(false);
      rebuildRows(); bakePlot(); renderList(true); renderDetail(); syncPlay();
      timeEl.textContent = ''; soFar.textContent = ''; sunEl.textContent = '';
    }
    async function load() {
      const id = S.feed, seq = ++loadSeq;
      S.loading = true; renderHead(); if (!S.data) { renderList(true); renderDetail(); }
      try { const d = await loadFeed(id); if (seq !== loadSeq) return; S.error = null; applyData(d); }
      catch (e) { if (seq !== loadSeq) return; S.error = { at: Date.now(), message: e.message }; const c = cached(id); if (c && S.data !== c) applyData(c); }
      if (seq !== loadSeq) return;
      S.loading = false; renderHead(); if (!S.data) { renderList(true); renderDetail(); bakePlot(); }
    }
    function switchFeed(id) {
      if (id === S.feed) return;
      S.feed = id; S.error = null; S.playing = false; S.sel = null;
      const c = cached(id); if (c) applyData(c); else clearData();
      scroller.scrollTop = 0; load();
    }

    ctx.bus.on('mode', () => { if (S.shown) enterMode(); });
    const offEscape = ctx.bus.on('escape', () => { if (S.shown && S.sel) select(null); });
    root.__globe = { scene, state: S, select, setTime, load };   // a handle for the automated checks
    void offPrefs; void offEscape;

    scene.setSun(Date.now());
    renderHead(); rebuildRows(); renderList(true); renderDetail(); syncPlay();
    load();

    return {
      onShow() {
        S.shown = true; enterMode(); fitFrame(); bakePlot(); scene.start();
        clearInterval(refreshTimer);
        refreshTimer = setInterval(() => { if (!S.loading && !S.playing) load(); }, 5 * 60e3);
        if (S.data && !S.loading && Date.now() - S.data.fetchedAt > 5 * 60e3) load();
      },
      onHide() { S.shown = false; S.playing = false; syncPlay(); scene.stop(); clearInterval(refreshTimer); hideTip(); },
      onParams(p) { if (p && FEEDS[p.feed]) switchFeed(p.feed); },
    };
  },
};
