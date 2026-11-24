// Wi-Fi AI: the workspace where the real neural network runs, explains itself and shows its limits.
// Three views share this frame: the bench (bench.js), the test set (evalview.js) and the design decisions (story.js).
import { clearTokens } from './common.js';

const VIEWS = [
  { id: 'bench', label: 'Bench', file: './bench.js', hint: 'Run the network on one window and look inside it' },
  { id: 'test', label: 'Test set', file: './evalview.js', hint: 'All 955 held-out windows: the threshold and its trade-off' },
  { id: 'why', label: 'Why this network', file: './story.js', hint: 'Five design decisions and the evidence for each' },
];

export default {
  async mount(root, ctx) {
    const { h, icon, realityTag } = ctx.kit;
    for (const f of ['style.css', 'eval.css', 'story.css', 'hero.css']) {
      const href = new URL('./' + f, import.meta.url).href;
      if (!document.querySelector(`link[href="${href}"]`)) document.head.append(h('link', { rel: 'stylesheet', href }));
    }
    const views = new Map();
    let current = null, visible = false;
    const tabs = h('div.seg', { role: 'tablist', 'aria-label': 'Wi-Fi AI views' }, VIEWS.map((v) => h('button', { role: 'tab', id: 'sense-tab-' + v.id, 'aria-selected': 'false', title: v.hint, onclick: () => show(v.id) }, v.label)));
    const body = h('div.sense-body.adv-only'), stage = h('div.sense-hero.demo-only');
    root.classList.add('sense');
    root.append(
      h('header.sense-head.adv-only', null,
        h('div.sense-title', null, icon('wifi', 20), h('h2', null, 'Wi-Fi AI'), realityTag('live-ai')),
        h('p.sense-lede', null, 'HOUND’s real 23,372-parameter network, listening for a person behind a wall. It runs in this page, now, on held-out test windows.'),
        h('div.grow'),
        h('span.tag.tag-sim', { title: 'Blender-built people in a Wi-Fi channel simulator. No window was recorded with the rover, and the network has never been tested on real people.' }, 'Every window is simulated'),
        tabs),
      body, stage);

    async function show(id, params) {
      const def = VIEWS.find((v) => v.id === id) || VIEWS[0];
      if (current && current !== def.id) { const prev = views.get(current); if (prev) { prev.el.hidden = true; try { prev.api?.onHide?.(); } catch (e) { console.error(e); } } }
      current = def.id;
      tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.id === 'sense-tab-' + def.id)));
      let rec = views.get(def.id);
      if (!rec) {
        const el = h('div.sense-view', { role: 'tabpanel', 'aria-labelledby': 'sense-tab-' + def.id, 'data-view': def.id }, h('div.empty', null, h('div.spinner'), h('p', null, `Opening ${def.label.toLowerCase()}…`)));
        body.append(el); rec = { el, api: null }; views.set(def.id, rec);
        try {
          const mod = await import(def.file);
          el.replaceChildren();
          rec.api = (await mod.create(el, ctx, { open: show, params: params || {} })) || {};
        } catch (e) {
          console.error('[sense] view "' + def.id + '" failed', e);
          el.replaceChildren(h('div.empty', null, icon('alert', 28), h('h3', null, def.label + ' could not start'), h('p.muted', { style: { maxWidth: '520px' } }, String(e.message || e)),
            h('button.btn', { onclick: () => { views.delete(def.id); el.remove(); show(def.id, params); } }, 'Try again')));
        }
      } else { rec.el.hidden = false; if (params) rec.api?.onParams?.(params); }
      if (current === def.id && visible && ctx.mode === 'advanced') { try { rec.api?.onShow?.(); } catch (e) { console.error(e); } } else if (current !== def.id) rec.el.hidden = true;
    }
    const route = (p = {}) => show(p.view || (p.sample != null ? 'bench' : current || 'bench'), p);
    ctx.bus.on('prefs', clearTokens);

    // Demo: one film-like hero. Advanced: the three views. Only the one on screen runs; the other is built when first needed.
    let hero = null, heroLoad = null;
    async function openHero(p) {
      if (!heroLoad) heroLoad = import('./hero.js').then((m) => m.create(stage, ctx)).then((a) => (hero = a)).catch((e) => { console.error('[sense] the demo view failed', e); heroLoad = null; stage.replaceChildren(h('div.empty', null, icon('alert', 28), h('h3', null, 'The demo could not start'), h('p.muted', null, String(e.message || e)), h('button.btn', { onclick: () => { stage.replaceChildren(); enter(); } }, 'Try again'))); });
      else if (p && Object.keys(p).length) hero?.onParams(p);
      await heroLoad;
      if (visible && ctx.mode !== 'advanced') hero?.onShow();
    }
    const pause = () => { try { hero?.onHide(); views.get(current)?.api?.onHide?.(); } catch (e) { console.error(e); } };
    const enter = (p) => (ctx.mode === 'advanced' ? route(p) : openHero(p));
    ctx.bus.on('mode', () => { pause(); if (visible) requestAnimationFrame(() => enter()); });
    await enter(ctx.params);
    return {
      onShow() { visible = true; if (ctx.mode === 'advanced' ? !current : !heroLoad) enter(); else if (ctx.mode === 'advanced') { try { views.get(current)?.api?.onShow?.(); } catch (e) { console.error(e); } } else hero?.onShow(); },
      onHide() { visible = false; pause(); },
      onParams(p) { if (p && Object.keys(p).length) enter(p); },
    };
  },
};
