// Fusion workspace: how several weak, different sensors add up to one answer, and how far to trust it.
// Live algorithm on simulated input. Assumed numbers are marked where they are shown.
import { createLedger } from './ledger.js';
import { createMap } from './map.js';
import { createInstruments } from './instruments.js';
import { createBreathing } from './breathing.js';
import { createMonteCarlo } from './montecarlo.js';
import { createHero } from './hero.js';
import { dropTokens } from './util.js';

function loadCss() {
  if (document.querySelector('link[data-fusion-css]')) return Promise.resolve();
  return Promise.all(['./style.css', './hero.css'].map((f) => new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = new URL(f, import.meta.url).href; link.dataset.fusionCss = '1';
    link.onload = link.onerror = () => resolve();
    document.head.append(link); setTimeout(resolve, 1500);
  })));
}

export default {
  async mount(root, ctx) {
    await loadCss();
    const { h, realityTag } = ctx.kit;
    root.classList.add('fusion');

    // ---- which lead the ledger explains ----
    let pin = null; // { type: 'detection' | 'room', id } chosen by the operator; null = follow the latest lead
    const leadIn = (S, roomId) => S.detections.find((d) => d.room === roomId && d.status !== 'rejected') || S.detections.find((d) => d.room === roomId);
    const vantages = new Map(); // where the rover stood for each reading key (S1, V1, ...)
    const api = {
      subject() {
        const S = ctx.sim.state;
        if (pin?.type === 'detection') { const det = S.detections.find((d) => d.id === pin.id); if (det) return { type: 'detection', det, key: 'det:' + det.id }; pin = null; }
        if (pin?.type === 'room') {
          const det = leadIn(S, pin.id), room = ctx.world.roomById(pin.id);
          if (det) return { type: 'detection', det, key: 'det:' + det.id, viaRoom: pin.id };
          if (room && S.coverage[pin.id]) return { type: 'room', room, cov: S.coverage[pin.id], key: 'room:' + pin.id };
          pin = null;
        }
        let latest = null;
        for (const d of S.detections) if (!latest || d.updated >= latest.updated) latest = d;
        return latest ? { type: 'detection', det: latest, key: 'det:' + latest.id, following: true } : { type: 'example', key: 'example' };
      },
      get following() { return !pin; },
      follow() { pin = null; },
      pick(sel) { ctx.select(sel); }, // the bus handler below does the pinning, so every view stays linked
      originOf(key) {
        const stop = ctx.world.STOPS.find((s) => s.id === key);
        if (stop) return { pos: stop.pos, known: true };
        const v = vantages.get(key); if (v) return { pos: v.pos, known: true };
        return { pos: ctx.sim.state.units['HOUND-01'].pos, known: false };
      },
    };

    // ---- layout ----
    const viewBtn = (id, label) => h('button', { type: 'button', 'aria-pressed': 'false', 'data-view': id, onclick: () => setView(id) }, label);
    const seg = h('div.seg', { role: 'group', 'aria-label': 'Fusion views' }, viewBtn('lead', 'Leads and evidence'), viewBtn('limits', 'Limits and reliability'));
    const head = h('header.ws-head.fusion-head.adv-only', null,
      h('div', null, h('h1', null, 'Fusion'), h('p', null, 'No single sensor is good enough alone. Every reading is weighed and added into one probability; see how, and how far to trust it.')),
      seg, realityTag('live-algo'));
    const ledgerEl = h('div.fusion-col'), mapEl = h('div.fusion-cell'), instEl = h('div.fusion-inst');
    const leadView = h('div.fusion-view.fusion-view-lead.adv-only', { 'data-view': 'lead' }, ledgerEl, h('div.fusion-col.fusion-right', null, mapEl, instEl));
    const breathEl = h('div.fusion-col'), mcEl = h('div.fusion-col');
    const limitsView = h('div.fusion-view.fusion-view-limits.adv-only', { 'data-view': 'limits', hidden: true }, breathEl, mcEl);
    const heroEl = h('div.demo-only');
    root.append(heroEl, head, leadView, limitsView);

    const parts = {
      lead: [createLedger(ledgerEl, ctx, api), createMap(mapEl, ctx, api), createInstruments(instEl, ctx, api)],
      limits: [createBreathing(breathEl, ctx), createMonteCarlo(mcEl, ctx)],
    };
    const all = [...parts.lead, ...parts.limits];
    let view = 'lead', raf = 0, visible = false, hero = null, building = null;
    const demo = () => ctx.mode === 'demo';
    const buildHero = () => building ||= createHero(heroEl, ctx, { openEvidence: () => ctx.setPref('mode', 'advanced') }).then((x) => { hero = x; if (visible && demo()) hero.onShow(); });
    function sync() { // only the visible mode runs
      cancelAnimationFrame(raf); raf = 0;
      if (!visible) { hero?.onHide(); return; }
      if (demo()) { hero ? hero.onShow() : buildHero(); } else { hero?.onHide(); for (const p of all) p.dirty?.(); raf = requestAnimationFrame(frame); }
    }
    function setView(v) {
      view = v === 'limits' ? 'limits' : 'lead';
      leadView.hidden = view !== 'lead'; limitsView.hidden = view !== 'limits';
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
      for (const p of all) p.dirty?.();
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const S = ctx.sim.state, r = S.units['HOUND-01'];
      if (r.mode === 'listen' && r.stop) vantages.set(r.stop, { pos: r.pos.slice() });
      for (const p of parts[view]) { try { p.frame(S, now); } catch (e) { if (!p.failed) { p.failed = true; console.error('[fusion]', e); } } }
    }
    function applyParams(p) {
      if (!p) return;
      if (p.view) setView(p.view);
      if (p.det || (p.type === 'detection' && p.id)) pin = { type: 'detection', id: p.det || p.id };
      if (p.room) pin = { type: 'room', id: p.room };
    }

    const offs = [
      ctx.bus.on('mode', sync),
      ctx.bus.on('select', (sel) => {
        if (!sel) return;
        const S = ctx.sim.state;
        if (sel.type === 'detection') pin = { type: 'detection', id: sel.id };
        else if (sel.type === 'survivor' && S.survivors[sel.id]) pin = { type: 'detection', id: S.survivors[sel.id].detId };
        else if (sel.type === 'room' && S.coverage[sel.id]) pin = { type: 'room', id: sel.id };
        for (const p of parts.lead) p.dirty?.();
      }),
      // The Limits view does not depend on the mission clock, so only the lead view is redrawn on a tick.
      ctx.bus.on('tick', () => { for (const p of parts.lead) p.dirty?.(); }),
      ctx.bus.on('reset', () => { vantages.clear(); for (const p of parts.lead) { p.reset?.(); p.dirty?.(); } }),
      ctx.bus.on('seek', () => { vantages.clear(); for (const p of parts.lead) { p.reset?.(); p.dirty?.(); } }),
      ctx.bus.on('prefs', () => { dropTokens(); for (const p of all) p.dirty?.(); }),
    ];
    if (ctx.selection) { const s = ctx.selection; if (s.type === 'detection') pin = { type: 'detection', id: s.id }; else if (s.type === 'room') pin = { type: 'room', id: s.id }; }
    applyParams(ctx.params);
    setView(view);
    if (demo()) await buildHero();

    return {
      onShow() { if (visible) return; visible = true; sync(); },
      onHide() { visible = false; sync(); for (const p of all) p.hide?.(); },
      onParams(p) { applyParams(p); },
      get hero() { return hero; },
      dispose() { offs.forEach((f) => f()); },
    };
  },
};
