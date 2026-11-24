// Model forge: frontier machine-learning engineering on HOUND's real Wi-Fi network, with real measurements.
// Six exhibits share this frame. Every number comes from tools/forge_export.py (NumPy, the project's own code) or is
// computed in the page; each one says which. All data is simulated people: nothing was recorded with the rover.
import { loadDoc, loadSet } from './lib/data.js';
import { createPool } from './lib/pool.js';
import { clearTokens, pct, fmtInt } from './lib/ui.js';
import { createDemo } from './hall/demo.js';

const EXHIBITS = [
  { id: 'train', title: 'Train it yourself', file: './ex-train.js', fig: (d) => [fmtInt(d.repro.params), 'weights, from noise'] },
  { id: 'int8', title: 'Fits on a 4-dollar chip', file: './ex-int8.js', fig: (d) => [(d.int8.bytes.int8_total / 1000).toFixed(1) + ' kB', 'as 8-bit integers'] },
  { id: 'prune', title: 'How small can it get', file: './ex-prune.js', fig: (d) => [pct(d.prune.knee_one_shot, 0), 'of weights can go'] },
  { id: 'doubt', title: 'Knowing when to ask again', file: './ex-doubt.js', fig: (d) => [pct(d.uncertainty.conformal['0.1'].abstain_by_kind[1], 0), 'of still people: “not sure”'] },
  { id: 'spike', title: 'A spiking version', file: './ex-spike.js', fig: (d) => { const r = d.snn?.rows?.find((x) => x.T === 64); return r ? [pct(r.agree, 0), 'agreement at 64 steps'] : ['…', 'being measured']; } },
  { id: 'clean', title: 'Clean vs. messy simulator', file: './ex-clean.js', fig: (d) => [pct(1 - d.clean.cells.clean_on_messy.empty_ok, 0), 'empty rooms alarm if trained clean'] },
];

export default {
  async mount(root, ctx) {
    const { h, icon, realityTag } = ctx.kit; let want = ctx.params?.exhibit || 'train';
    const href = new URL('./style.css', import.meta.url).href;
    if (!document.querySelector('link[href="' + href + '"]')) document.head.append(h('link', { rel: 'stylesheet', href }));
    root.classList.add('forge');
    const demo = createDemo(root, ctx, () => { want = 'train'; ctx.setMode('advanced'); if (current) show('train'); });
    const adv = h('div.forge-adv.adv-only'); root.append(adv);
    const proof = h('div.forge-proof', { title: 'Before anything else, tools/forge_export.py runs the project’s own test and must get the published confusion matrix.' });
    const stations = h('div.forge-stations', { role: 'tablist', 'aria-label': 'Exhibits' });
    const stage = h('div.forge-stage');
    adv.append(
      h('header.ws-head.forge-head', null,
        h('div', null, h('h1', null, 'Model forge'),
          h('p', null, 'HOUND’s real 23,372-weight Wi-Fi network on the bench: train it from noise in this page, shrink it for a microcontroller, and measure its confidence.')),
        proof, h('div.forge-tags', null, realityTag('live-ai'), h('span.tag.tag-sim', { title: 'Blender-built people in a Wi-Fi channel simulator. The network was trained and tested on simulated people.' }, 'Every window is simulated'))),
      stations, stage);

    let doc = null, pool = null, env = null, current = null, visible = false, building = null; const views = new Map();
    const bench = () => (building ||= build());
    async function build() {
    stage.append(h('div.empty', null, h('div.spinner'), h('p', null, 'Loading the measurements and both trained networks (0.8 MB)…')));
    try { doc = await loadDoc(); }
    catch (e) { stage.replaceChildren(h('div.empty', null, icon('alert', 28), h('h3', null, 'The forge could not load its measurements'), h('p.muted', null, String(e.message || e)), h('button.btn.btn-primary', { onclick: () => location.reload() }, 'Try again'))); return; }
    const m = doc.repro.test.confusion;
    proof.append(icon('check-circle', 15), h('span', null, 'Pipeline check: the published test matrix ', h('b.num', null, m[0][0] + ' / ' + m[0][1] + ' / ' + m[1][0] + ' / ' + m[1][1]), ' reproduced'));

    env = { ctx, doc, loadSet, get pool() { return (pool ||= createPool(doc.dec)); }, open: (id) => show(id) };
    EXHIBITS.forEach((x, i) => {
      const [v, l] = x.fig(doc);
      stations.append(h('button.forge-station', { role: 'tab', id: 'forge-tab-' + x.id, 'aria-selected': 'false', onclick: () => show(x.id),
        onkeydown: (e) => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { const n = EXHIBITS[(i + d + EXHIBITS.length) % EXHIBITS.length]; show(n.id); document.getElementById('forge-tab-' + n.id).focus(); } } },
        h('span.forge-station-n.num', null, String(i + 1).padStart(2, '0')), h('span.forge-station-t', null, x.title), h('span.forge-station-f', null, h('b.num', null, v), ' ', l)));
    });

    await show(want);
    }

    async function show(id) {
      const def = EXHIBITS.find((x) => x.id === id) || EXHIBITS[0];
      if (current && current !== def.id) { const prev = views.get(current); if (prev) { prev.el.hidden = true; try { prev.api?.onHide?.(); } catch (e) { console.error(e); } } }
      current = def.id;
      stations.querySelectorAll('button').forEach((b) => { const on = b.id === 'forge-tab-' + def.id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
      let rec = views.get(def.id);
      if (!rec) {
        const el = h('div.forge-view', { role: 'tabpanel', 'aria-labelledby': 'forge-tab-' + def.id, 'data-exhibit': def.id }, h('div.empty', null, h('div.spinner'), h('p', null, 'Setting up “' + def.title + '”…')));
        if (!views.size) stage.replaceChildren();
        stage.append(el); rec = { el, api: null }; views.set(def.id, rec);
        try { const mod = await import(def.file); el.replaceChildren(); rec.api = (await mod.create(el, env)) || {}; }
        catch (e) {
          console.error('[forge] exhibit "' + def.id + '" failed', e);
          el.replaceChildren(h('div.empty', null, icon('alert', 28), h('h3', null, def.title + ' could not start'), h('p.muted', { style: { maxWidth: '520px' } }, String(e.message || e)),
            h('button.btn', { onclick: () => { views.delete(def.id); el.remove(); show(def.id); } }, 'Try again')));
        }
      } else rec.el.hidden = false;
      if (current === def.id && visible) { try { rec.api?.onShow?.(); } catch (e) { console.error(e); } } else if (current !== def.id) rec.el.hidden = true;
    }
    ctx.bus.on('prefs', () => { clearTokens(); try { views.get(current)?.api?.onShow?.(); } catch (e) { console.error(e); } });
    ctx.bus.on('mode', () => { demo.mode(); if (ctx.mode === 'advanced' && visible) { bench().then(() => views.get(current)?.api?.onShow?.()); } else { try { views.get(current)?.api?.onHide?.(); } catch (e) { console.error(e); } } });
    return {
      onShow() { visible = true; demo.show(); if (ctx.mode === 'advanced') { const had = !!building; bench(); if (had) try { views.get(current)?.api?.onShow?.(); } catch (e) { console.error(e); } } },
      onHide() { visible = false; demo.hide(); try { views.get(current)?.api?.onHide?.(); } catch (e) { console.error(e); } },
      onParams(p) { if (p?.exhibit) { want = p.exhibit; if (env) show(p.exhibit); } },
    };
  },
};
