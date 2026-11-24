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
    for (const f of ['style.css', 'eval.css', 'story.css']) {
      const href = new URL('./' + f, import.meta.url).href;
      if (!document.querySelector(`link[href="${href}"]`)) document.head.append(h('link', { rel: 'stylesheet', href }));
    }
    const views = new Map();
    let current = null, visible = false;
    const tabs = h('div.seg', { role: 'tablist', 'aria-label': 'Wi-Fi AI views' }, VIEWS.map((v) => h('button', { role: 'tab', id: 'sense-tab-' + v.id, 'aria-selected': 'false', title: v.hint, onclick: () => show(v.id) }, v.label)));
    const body = h('div.sense-body');
    root.classList.add('sense');
    root.append(
      h('header.sense-head', null,
        h('div.sense-title', null, icon('wifi', 20), h('h2', null, 'Wi-Fi AI'), realityTag('live-ai')),
        h('p.sense-lede', null, 'HOUND’s real 23,372-parameter network, listening for a person behind a wall. It runs in this page, now, on held-out test windows.'),
        h('div.grow'),
        h('span.tag.tag-sim', { title: 'Blender-built people in a Wi-Fi channel simulator. No window was recorded with the rover, and the network has never been tested on real people.' }, 'Every window is simulated'),
        tabs),
      body);

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
      if (current === def.id && visible) { try { rec.api?.onShow?.(); } catch (e) { console.error(e); } } else if (current !== def.id) rec.el.hidden = true;
    }
    const route = (p = {}) => show(p.view || (p.sample != null ? 'bench' : current || 'bench'), p);
    ctx.bus.on('prefs', clearTokens);
    await route(ctx.params);
    return {
      onShow() { visible = true; try { views.get(current)?.api?.onShow?.(); } catch (e) { console.error(e); } },
      onHide() { visible = false; try { views.get(current)?.api?.onHide?.(); } catch (e) { console.error(e); } },
      onParams(p) { if (p && Object.keys(p).length) route(p); },
    };
  },
};
