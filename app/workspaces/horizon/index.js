// Horizon: the far frontier. Eleven ideas that sound like science fiction, each anchored in published research,
// each with a simulation that runs its real mathematics in this page.
// Demo is the descent in ./dive.js. This file is the Advanced frame: the overview (every exhibit placed by readiness and by how far the sensor stands from the
// person) and the exhibit view (stage on the left, placard and controls on the right). Exhibits live in ./exhibits/.
import * as lib from './lib.js';
const { h, icon, realityTag, tokens, rgba, text, TAU, clamp } = lib;

// Order here does not matter; exhibits are sorted by readiness once loaded. A missing or broken file is skipped.
const FILES = ['atoms', 'corners', 'seeds', 'laser', 'insects', 'smell', 'passive', 'earthfm', 'phones', 'legged', 'insar'];
const BANDS = [
  { label: 'Lab result', sub: 'in a laboratory or a set-piece test' },
  { label: 'Field trial', sub: 'tried outdoors or at a real incident' },
  { label: 'Fielded', sub: 'in routine use today.' },
];
const ZONES = [[0.01, 1, 'inside the rubble'], [1, 10, 'in the room'], [10, 100, 'across the street'], [100, 1e4, 'across the valley'], [1e4, 1e5, 'the sky'], [1.6e5, 2e6, 'orbit']];
const YD = [0.01, 2e6];
const bandOf = (r) => Math.min(2, Math.floor(r));

export default {
  async mount(root, ctx) {
    const href = new URL('./style.css', import.meta.url).href;
    if (!document.querySelector('link[href="' + href + '"]')) { const l = h('link', { rel: 'stylesheet', href }); document.head.append(l); await new Promise((r) => { l.onload = l.onerror = r; setTimeout(r, 1500); }); }
    root.classList.add('horizon');
    const opening = h('div.empty', null, h('div.spinner'), h('p', null, 'Opening the exhibits…')); root.append(opening);
    // Demo: the descent. Built the first time Demo is shown; three.js loads only then.
    let dive = null, diveP = null, visible = false;
    const demo = () => ctx.mode === 'demo';
    const needDive = () => diveP || (diveP = import('./dive.js').then((m) => m.createDive({ onStop: () => {} })).then((d) => { dive = d; root.append(d.el); opening.remove(); if (visible && demo()) d.start(); return d; }).catch((err) => { console.error('[horizon] the descent could not start', err); opening.remove(); root.append(h('div.empty.demo-only', null, icon('alert', 28), h('h2', null, 'This view needs 3-D graphics'), h('p.muted', null, 'Switch to Advanced to use the exhibits without it.'))); }));
    if (demo()) needDive();

    // One retry with a fresh URL: a failed module fetch is otherwise remembered for the life of the page.
    const load = (f) => import('./exhibits/' + f + '.js').catch(() => new Promise((r) => setTimeout(r, 400)).then(() => import('./exhibits/' + f + '.js?retry=1')));
    const loaded = await Promise.allSettled(FILES.map(load));
    const EX = [];
    loaded.forEach((r, i) => { if (r.status === 'fulfilled' && r.value.default?.id) EX.push(r.value.default); else console.error('[horizon] exhibit "' + FILES[i] + '" is not available', r.reason?.message || ''); });
    EX.sort((a, b) => a.readiness - b.readiness);
    EX.forEach((e, i) => { e.num = String(i + 1).padStart(2, '0'); });
    if (!demo()) opening.remove(); else opening.hidden = !!dive;
    if (!EX.length) { root.append(h('div.empty', null, icon('alert', 28), h('h2', null, 'No exhibit could be loaded'), h('p.muted', null, 'Reload the page. If this stays, the exhibit files are missing.'))); return {}; }

    let view = 'overview', current = null, featured = EX[0].id, userPicked = false;
    const recs = new Map();
    const byId = (id) => EX.find((e) => e.id === id);

    // ================= overview =================
    const ovCanvas = h('canvas.horizon-ov-canvas', { 'aria-hidden': 'true' });
    const nodeLayer = h('div.horizon-ov-nodes', { role: 'list', 'aria-label': 'Exhibits, placed by readiness and by distance from the person' });
    const placard = h('div.horizon-placard', { 'aria-live': 'polite' });
    const ov = h('section.horizon-ov.adv-only', { 'aria-label': 'Overview of the exhibits' },
      h('div.horizon-ov-chart', null, ovCanvas, nodeLayer),
      h('div.horizon-ov-left', null,
        h('header.horizon-ov-head', null,
          h('div.row', null, h('h1', null, 'Horizon'), realityTag('concept')),
          h('p.lede', null, EX.length + ' ideas that sound like science fiction. Each is anchored in published research, and each runs its mathematics in this page.'),
          h('p.horizon-ov-how', null, 'The chart places every idea by how far it has come, left to right, and by how far its sensor stands from the person it is looking for, bottom to top.')),
        placard,
        h('div.horizon-ov-foot', null,
          realityTag('concept'), h('span', null, 'The hardware.'),
          realityTag('live-algo'), h('span', null, 'The mathematics, computed in this page on simulated measurements.'),
          h('span', null, h('kbd', null, '←'), ' ', h('kbd', null, '→')), h('span', null, 'Move between exhibits. Escape returns here.'))));
    const nodes = EX.map((e) => {
      const b = h('button.horizon-node', { type: 'button', role: 'listitem', 'data-id': e.id, 'aria-label': e.num + ', ' + e.title + '. ' + BANDS[bandOf(e.readiness)].label + '. Open the exhibit.',
        onclick: () => open(e.id), onmouseenter: () => feature(e.id, true), onfocus: () => feature(e.id, true) },
        h('span.horizon-node-disc'), h('span.horizon-node-label', null, h('span.num', null, e.num), h('b', null, e.title)));
      nodeLayer.append(b); return { e, b, x: 0, y: 0, y0: 0, y1: 0 };
    });

    function feature(id, byUser) {
      if (byUser) userPicked = true;
      if (featured === id && placard.firstChild) return;
      featured = id; const e = byId(id);
      nodes.forEach((n) => n.b.classList.toggle('is-featured', n.e.id === id));
      placard.replaceChildren(
        h('div.horizon-placard-num', null, e.num, h('span', null, ' / ' + String(EX.length).padStart(2, '0'))),
        h('h2', null, e.title),
        h('p.horizon-placard-hook', null, e.sentences[0]),
        h('dl.kv.horizon-placard-kv', null,
          h('dt', null, 'Readiness'), h('dd', null, BANDS[bandOf(e.readiness)].label),
          h('dt', null, 'Sensor to person'), h('dd.num', null, lib.fmtDist(e.standoff[0]) + ' to ' + lib.fmtDist(e.standoff[1])),
          h('dt', null, 'Anchored in'), h('dd', null, e.sources[0] ? e.sources[0].who + ', ' + e.sources[0].year : 'idea only')),
        h('div.row.wrap', null, e.labels.map((k) => realityTag(k))),
        h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: () => open(e.id) }, h('span', null, 'Open the exhibit'), icon('arrow-right')));
    }

    let ovW = 0, ovH = 0, ovDpr = 1, stars = [];
    const ovG = ovCanvas.getContext('2d');
    const geom = () => { const x0 = 84, x1 = ovW - 172, y0 = 76, y1 = ovH - 34; return { x0, x1, y0, y1, bw: (x1 - x0) / 3 }; };
    const yOf = (m, G) => G.y1 - ((Math.log10(m) - Math.log10(YD[0])) / (Math.log10(YD[1]) - Math.log10(YD[0]))) * (G.y1 - G.y0);
    function placeNodes() {
      const G = geom();
      for (const n of nodes) {
        const b = bandOf(n.e.readiness), f = n.e.readiness - b;
        n.x = G.x0 + (b + 0.1 + 0.62 * f) * G.bw; n.y0 = yOf(n.e.standoff[0], G); n.y1 = yOf(n.e.standoff[1], G); n.y = yOf(Math.sqrt(n.e.standoff[0] * n.e.standoff[1]), G);
        n.b.style.left = n.x + 'px'; n.b.style.top = n.y + 'px'; n.b.classList.toggle('flip', n.e.flip ?? (n.x + n.b.offsetWidth - 22 > G.x1 + 30));
      }
    }
    function drawOverview(t) {
      if (ovW < 50) return; const g = ovG, T = tokens(), G = geom();
      g.setTransform(ovDpr, 0, 0, ovDpr, 0, 0); g.clearRect(0, 0, ovW, ovH);
      // space above the 100 km line: stars, and the line itself as the horizon
      const yK = yOf(1e5, G);
      for (const s of stars) { const tw = 0.55 + 0.45 * Math.sin(t * s.w + s.p); g.fillStyle = rgba('text', s.a * tw); g.fillRect(G.x0 + s.x * (G.x1 - G.x0 + 110), 8 + s.y * (yK - 14), s.r, s.r); }
      const glow = g.createLinearGradient(0, yK, 0, yK + 150); glow.addColorStop(0, rgba('accent', 0.16)); glow.addColorStop(0.25, rgba('accent', 0.05)); glow.addColorStop(1, rgba('accent', 0));
      g.fillStyle = glow; g.fillRect(G.x0 - 60, yK, G.x1 - G.x0 + 190, 150);
      const hl = g.createLinearGradient(G.x0 - 60, 0, G.x1 + 130, 0); hl.addColorStop(0, rgba('accent', 0)); hl.addColorStop(0.12, rgba('accent2', 0.9)); hl.addColorStop(0.88, rgba('accent2', 0.9)); hl.addColorStop(1, rgba('accent', 0));
      g.strokeStyle = hl; g.lineWidth = 1; g.beginPath(); g.moveTo(G.x0 - 60, yK + 0.5); g.lineTo(G.x1 + 130, yK + 0.5); g.stroke();
      // the ground: below one metre the sensor is inside the rubble
      const yG = yOf(1, G); g.save(); g.beginPath(); g.rect(G.x0, yG, G.x1 - G.x0, G.y1 - yG); g.clip(); g.strokeStyle = rgba('text3', 0.1); g.lineWidth = 1; g.beginPath(); for (let x = G.x0 - (G.y1 - yG); x < G.x1; x += 9) { g.moveTo(x, G.y1); g.lineTo(x + (G.y1 - yG), yG); } g.stroke(); g.restore();
      // decades
      for (let e = -2; e <= 6; e++) { const m = 10 ** e, y = Math.round(yOf(m, G)) + 0.5; if (e !== 5) { g.strokeStyle = e === 0 ? T.line3 : T.line; g.beginPath(); g.moveTo(G.x0, y); g.lineTo(G.x1, y); g.stroke(); }
        text(g, lib.fmtDist(m), G.x0 - 10, y, { color: 'text3', size: 11, align: 'right', base: 'middle', mono: true, weight: 400 }); }
      for (const [a, b, name] of ZONES) text(g, name, G.x1 + 14, (yOf(Math.max(a, YD[0]), G) + yOf(Math.min(b, YD[1]), G)) / 2, { color: name === 'orbit' ? 'text2' : 'text3', size: 12, base: 'middle' });
      text(g, 'where space begins', G.x1 + 14, yK - 8, { color: 'accent2', size: 11.5 });
      g.save(); g.translate(16, (G.y0 + G.y1) / 2); g.rotate(-Math.PI / 2); text(g, 'Distance from the sensor to the person', 0, 0, { color: 'text2', size: 12, align: 'center' }); g.restore();
      // readiness bands
      BANDS.forEach((b, i) => { const x = G.x0 + i * G.bw; if (i) { g.strokeStyle = T.line2; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(Math.round(x) + 0.5, G.y0 - 44); g.lineTo(Math.round(x) + 0.5, G.y1); g.stroke(); g.setLineDash([]); }
        text(g, b.label, x + 14, G.y0 - 40, { color: 'text', size: 20, display: true }); text(g, b.sub, x + 14, G.y0 - 22, { color: 'text3', size: 11.5, weight: 400 }); });
      g.strokeStyle = T.line2; g.beginPath(); g.moveTo(G.x0, G.y1 + 0.5); g.lineTo(G.x1, G.y1 + 0.5); g.stroke();
      text(g, 'How far it has come', G.x0, G.y1 + 20, { color: 'text2', size: 12 });
      const ax = G.x0 + 118; g.strokeStyle = T.text3; g.beginPath(); g.moveTo(ax, G.y1 + 16.5); g.lineTo(ax + 44, G.y1 + 16.5); g.moveTo(ax + 39, G.y1 + 12.5); g.lineTo(ax + 44, G.y1 + 16.5); g.lineTo(ax + 39, G.y1 + 20.5); g.stroke();
      // exhibits: a range bar (nearest to farthest the sensor works) and a living miniature
      for (const n of nodes) {
        const on = n.e.id === featured, col = on ? 'accent' : 'text3';
        g.strokeStyle = rgba(col, on ? 0.9 : 0.2); g.lineWidth = 1; g.beginPath(); g.moveTo(n.x + 0.5, n.y1); g.lineTo(n.x + 0.5, n.y0); g.moveTo(n.x - 4, n.y1 + 0.5); g.lineTo(n.x + 5, n.y1 + 0.5); g.moveTo(n.x - 4, n.y0 + 0.5); g.lineTo(n.x + 5, n.y0 + 0.5); g.stroke();
        g.fillStyle = T.bg1; g.beginPath(); g.arc(n.x, n.y, 21, 0, TAU); g.fill();
        g.strokeStyle = on ? T.accent : T.line3; g.lineWidth = on ? 1.5 : 1; g.beginPath(); g.arc(n.x, n.y, 21, 0, TAU); g.stroke();
        if (on) { g.strokeStyle = rgba('accent', 0.25); g.lineWidth = 4; g.beginPath(); g.arc(n.x, n.y, 24.5, 0, TAU); g.stroke(); }
        g.save(); g.translate(n.x, n.y); g.beginPath(); g.arc(0, 0, 19.5, 0, TAU); g.clip();
        g.lineWidth = 1.25; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = on ? T.text : T.text2; g.fillStyle = on ? T.text : T.text2;
        try { n.e.glyph?.(g, 34, t, { ink: on ? T.text : T.text2, dim: T.text3, accent: T.accent, person: T.person, ok: T.ok, warn: T.warn }); } catch { /* a glyph must never break the overview */ }
        g.restore();
      }
    }
    const ovLoop = lib.loop((dt, t) => {
      if (!userPicked && !lib.reduced()) { const k = Math.floor(t / 5) % EX.length; if (EX[k].id !== featured) feature(EX[k].id); }
      drawOverview(t);
    });
    new ResizeObserver(() => {
      const r = ovCanvas.parentElement.getBoundingClientRect(); if (r.width < 50 || r.height < 50) return;
      ovDpr = Math.min(2, window.devicePixelRatio || 1); ovW = Math.floor(r.width); ovH = Math.floor(r.height);
      ovCanvas.width = Math.round(ovW * ovDpr); ovCanvas.height = Math.round(ovH * ovDpr);
      const R = lib.rng(7); stars = Array.from({ length: 150 }, () => ({ x: R(), y: R() ** 1.5, r: R() < 0.12 ? 1.5 : 1, a: 0.2 + 0.6 * R(), w: 0.4 + 1.6 * R(), p: R() * TAU }));
      placeNodes(); drawOverview(performance.now() / 1000);
    }).observe(ovCanvas.parentElement);

    // ================= exhibit view =================
    const stageHost = h('div.horizon-stage-host'), sideHost = h('div.horizon-side-host');
    const strip = h('nav.horizon-strip', { 'aria-label': 'Exhibits' });
    const exView = h('section.horizon-ex.adv-only', { hidden: true, 'aria-label': 'Exhibit' }, h('div.horizon-ex-main', null, stageHost, sideHost), strip);
    const stripBtns = new Map();
    strip.append(h('button.btn.btn-ghost', { type: 'button', onclick: () => showOverview(), title: 'Back to the overview (Escape)' }, icon('arrow-left'), h('span', null, 'All exhibits')));
    BANDS.forEach((b, i) => {
      const items = EX.filter((e) => bandOf(e.readiness) === i); if (!items.length) return;
      strip.append(h('div.horizon-strip-band', null, h('span.horizon-strip-title', null, b.label),
        h('div.horizon-strip-items', null, items.map((e) => { const btn = h('button', { type: 'button', title: e.title, 'aria-current': 'false', onclick: () => open(e.id) }, h('span.num', null, e.num), h('span', null, e.short || e.title)); stripBtns.set(e.id, btn); return btn; }))));
    });
    strip.append(h('div.grow'),
      h('button.btn.btn-icon', { type: 'button', 'aria-label': 'Previous exhibit', title: 'Previous exhibit (left arrow)', onclick: () => step(-1) }, icon('chevron-left')),
      h('button.btn.btn-icon', { type: 'button', 'aria-label': 'Next exhibit', title: 'Next exhibit (right arrow)', onclick: () => step(1) }, icon('chevron')));

    function readinessScale(e) {
      const p = clamp(e.readiness / 3, 0.02, 0.98);
      return h('div.horizon-ready', { role: 'img', 'aria-label': 'Readiness: ' + BANDS[bandOf(e.readiness)].label },
        h('div.horizon-ready-track', null, h('i'), h('i'), h('i'), h('b', { style: { left: p * 100 + '%' } })),
        h('div.horizon-ready-labels', null, BANDS.map((b, i) => h('span', { class: i === bandOf(e.readiness) ? 'is-on' : '' }, b.label))),
        e.readinessNote ? h('p.caption', null, e.readinessNote) : null);
    }
    function buildSide(e, controls, readout) {
      return h('aside.horizon-side', { 'aria-label': e.title },
        h('div.horizon-side-top', null,
          h('div.horizon-side-num', null, e.num), h('h2', null, e.title),
          h('div.row.wrap', null, e.labels.map((k) => realityTag(k))),
          h('p.horizon-say', null, e.sentences[0]), h('p.horizon-say', null, e.sentences[1]),
          readinessScale(e)),
        readout, controls,
        h('div.horizon-group', null, h('h4', null, 'What it needs'), h('p', null, e.needs), h('h4', null, 'Open questions'), h('p', null, e.unknown)),
        e.labelNote ? h('div.horizon-group', null, h('h4', null, 'What is real here'), h('p', null, e.labelNote)) : null,
        h('div.horizon-group.horizon-sources', null, h('h4', null, e.sources.length ? 'Published research behind this' : 'Idea'),
          e.sources.map((s) => h('p', null, h('b', null, s.who + ' (' + s.year + '). '), s.title + '. ', s.where ? h('i', null, s.where + '. ') : null, s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open source', icon('external', 12)) : null, s.note ? h('span.dim', null, ' ' + s.note) : null))));
    }
    function ensure(e) {
      let rec = recs.get(e.id); if (rec) return rec;
      const stage = h('div.horizon-stage', { 'data-ex': e.id }), controls = h('div.horizon-group.horizon-controls', null, h('h4', null, 'Try it')), readout = h('div.horizon-group.horizon-readout', null);
      rec = { e, stage, side: buildSide(e, controls, readout), api: null };
      stageHost.append(stage); sideHost.append(rec.side); recs.set(e.id, rec);
      try { rec.api = e.create({ stage, controls, readout, ctx, lib }) || {}; }
      catch (err) { console.error('[horizon] exhibit "' + e.id + '" failed', err); stage.replaceChildren(h('div.empty', null, icon('alert', 28), h('h3', null, e.title + ' could not start'), h('p.muted', null, String(err.message || err)))); rec.api = {}; }
      return rec;
    }
    function open(id) {
      const e = byId(id) || EX[0];
      if (current && current !== e.id) { const p = recs.get(current); if (p) { p.stage.hidden = true; p.side.hidden = true; try { p.api.stop?.(); } catch (err) { console.error(err); } } }
      ovLoop.stop(); view = 'exhibit'; current = e.id; featured = e.id; ov.hidden = true; exView.hidden = false;
      const rec = ensure(e); rec.stage.hidden = false; rec.side.hidden = false; rec.side.scrollTop = 0;
      stripBtns.forEach((b, k) => b.setAttribute('aria-current', String(k === e.id)));
      if (visible && !demo()) { try { rec.api.start?.(); } catch (err) { console.error(err); } }
    }
    function showOverview() {
      if (current) { const p = recs.get(current); try { p?.api.stop?.(); } catch (err) { console.error(err); } }
      view = 'overview'; exView.hidden = true; ov.hidden = false; placard.replaceChildren(); const f = featured; featured = null; feature(f);
      if (visible && !demo()) ovLoop.start();
      nodes.find((n) => n.e.id === f)?.b.focus({ preventScroll: true });
    }
    function step(d) { const i = EX.findIndex((e) => e.id === current); open(EX[(i + d + EX.length) % EX.length].id); }

    root.append(ov, exView);
    feature(featured);
    const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    window.addEventListener('keydown', (ev) => {
      if (visible && demo() && dive && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !typing()) { if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') { ev.preventDefault(); dive.next(1); } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') { ev.preventDefault(); dive.next(-1); } return; }
      if (!visible || demo() || view !== 'exhibit' || ev.metaKey || ev.ctrlKey || ev.altKey || typing()) return;
      if (ev.key === 'ArrowRight') step(1); else if (ev.key === 'ArrowLeft') step(-1);
    });
    ctx.bus.on('escape', () => { if (visible && !demo() && view === 'exhibit') showOverview(); });
    ctx.bus.on('prefs', () => { lib.refreshTokens(); if (demo()) return; if (view === 'overview') drawOverview(performance.now() / 1000); else recs.get(current)?.api.start?.(); });
    const runAdv = (on) => { if (!on) { ovLoop.stop(); try { recs.get(current)?.api.stop?.(); } catch (err) { console.error(err); } } else if (view === 'overview') ovLoop.start(); else { try { recs.get(current)?.api.start?.(); } catch (err) { console.error(err); } } };
    const runAll = () => { if (demo()) { runAdv(false); needDive(); if (visible) dive?.start(); else dive?.pause(); } else { dive?.pause(); opening.remove(); if (dive && !current && !userPicked) feature(dive.stop); runAdv(visible); } };
    ctx.bus.on('mode', runAll);

    const want = ctx.params?.exhibit || new URLSearchParams(location.search).get('x');
    if (want && byId(want)) open(want);
    return {
      onShow() { visible = true; runAll(); },
      onHide() { visible = false; dive?.pause(); runAdv(false); },
      onParams(p) { if (p?.exhibit && byId(p.exhibit)) open(p.exhibit); else if (p?.view === 'overview') showOverview(); },
    };
  },
};
