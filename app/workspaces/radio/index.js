// Radio twin: a lab of seven working exhibits on what radio can see inside a building.
// Every figure is computed in this page. The hardware is a concept unless an exhibit says otherwise.
import * as lab from './lab.js';

const EXHIBITS = [
  { id: 'twin', file: './twin.js', short: 'Radio digital twin' },
  { id: 'person', file: './person.js', short: 'A person in the channel' },
  { id: 'fresnel', file: './fresnel.js', short: 'Fresnel dither' },
  { id: 'sar', file: './sar.js', short: 'Synthetic aperture' },
  { id: 'sparse', file: './sparse.js', short: 'Too few measurements' },
  { id: 'ris', file: './ris.js', short: 'Steering through gaps' },
  { id: 'bf', file: './bf.js', short: 'Every router is a sensor' },
];

export default {
  async mount(root, ctx) {
    const { h, icon, realityTag } = ctx.kit;
    for (const f of ['./style.css', './mine.css']) {
      const href = new URL(f, import.meta.url).href;
      if (document.querySelector('link[href="' + href + '"]')) continue;
      await new Promise((res) => { const l = h('link', { rel: 'stylesheet', href }); l.onload = l.onerror = res; document.head.append(l); setTimeout(res, 1500); });
    }
    root.classList.add('radio');
    const recs = new Map();
    let current = null, visible = false;

    const strip = h('div.radio-strip', { role: 'tablist', 'aria-label': 'Exhibits' }, EXHIBITS.map((e, i) =>
      h('button.radio-tab', { type: 'button', role: 'tab', id: 'radio-tab-' + e.id, 'aria-selected': 'false', tabindex: '-1', 'data-id': e.id, onclick: () => show(e.id) },
        h('span.radio-tab-n', null, String(i + 1).padStart(2, '0')), h('span.radio-tab-t', null, e.short))));
    strip.addEventListener('keydown', (ev) => {
      const i = EXHIBITS.findIndex((e) => e.id === current); let j = i;
      if (ev.key === 'ArrowRight') j = (i + 1) % EXHIBITS.length; else if (ev.key === 'ArrowLeft') j = (i + EXHIBITS.length - 1) % EXHIBITS.length;
      else if (ev.key === 'Home') j = 0; else if (ev.key === 'End') j = EXHIBITS.length - 1; else return;
      ev.preventDefault(); show(EXHIBITS[j].id).then(() => strip.querySelector('[aria-selected="true"]')?.focus());
    });
    const body = h('div.radio-body');
    root.append(
      h('header.ws-head.radio-head', null,
        h('div', null, h('h1', null, 'Radio twin'),
          h('p', null, 'Seven working exhibits on what radio can see inside a building. Each one runs its real maths in this page, on simulated measurements, and shows its error against the simulated truth.')),
        h('div.radio-head-tags', null, realityTag('live-algo'), h('span.tag.tag-sim', { title: 'HOUND has two ESP32 radios and three small radars. Ray-traced planning, imaging radar on a track, reflecting surfaces and 802.11bf are not built.' }, 'Hardware: concept unless stated'))),
      strip, body);

    function placard(e, i, meta) {
      const cites = (meta.cites || []).map((c) => h('li', null,
        c.url ? h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer' }, c.by + (c.year ? ', ' + c.year : ''), icon('external', 11)) : h('b', null, c.by + (c.year ? ', ' + c.year : '')),
        h('span', null, c.title + (c.venue ? '. ' + c.venue + '.' : ''))));
      return h('div.radio-placard', null,
        h('div.radio-placard-n', null, 'Exhibit ' + String(i + 1).padStart(2, '0') + ' of ' + String(EXHIBITS.length).padStart(2, '0')),
        h('h2', null, meta.title),
        h('div.radio-placard-tags', null, (meta.labels || []).map((l) => (typeof l === 'string' ? realityTag(l) : h('span.tag.' + (l.cls || 'tag-sim'), { title: l.title }, l.text)))),
        meta.labelNote ? h('p.radio-placard-labelnote', null, meta.labelNote) : null,
        h('div.radio-placard-plain', null, (meta.plain || []).map((s) => h('p', null, s))),
        cites.length ? h('div.radio-placard-block', null, h('h4', null, meta.citesTitle || 'Research behind it'), h('ul.radio-cites', null, cites)) : null,
        meta.honest ? h('div.radio-placard-block.radio-honest', null, h('h4', null, 'For this to work in the field'), h('p', null, meta.honest), meta.unknown ? h('p.radio-unknown', null, h('b', null, 'Unknown: '), meta.unknown) : null) : null);
    }

    async function show(id, params) {
      const i = Math.max(0, EXHIBITS.findIndex((e) => e.id === id)), e = EXHIBITS[i];
      if (current && current !== e.id) { const prev = recs.get(current); if (prev) { prev.el.hidden = true; try { prev.api?.onHide?.(); } catch (err) { console.error(err); } } }
      current = e.id;
      strip.querySelectorAll('.radio-tab').forEach((b) => { const on = b.dataset.id === e.id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
      let rec = recs.get(e.id);
      if (!rec) {
        const stage = h('div.radio-stage'), side = h('div.radio-side-controls'), aside = h('aside.radio-side', { 'aria-label': 'About this exhibit' });
        const el = h('div.radio-exhibit', { role: 'tabpanel', 'aria-labelledby': 'radio-tab-' + e.id, 'data-exhibit': e.id }, stage, aside);
        stage.append(h('div.empty', null, h('div.spinner'), h('p', null, 'Setting up ' + e.short.toLowerCase() + '…')));
        body.append(el); rec = { el, api: null }; recs.set(e.id, rec);
        try {
          const mod = await import(e.file);
          stage.replaceChildren();
          aside.append(placard(e, i, mod.meta), side);
          rec.api = (await mod.create(stage, side, ctx, lab, { open: show, params: params || {} })) || {};
        } catch (err) {
          console.error('[radio] exhibit "' + e.id + '" failed', err);
          recs.delete(e.id);
          stage.replaceChildren(h('div.empty', null, icon('alert', 28), h('h3', null, e.short + ' could not start'), h('p.muted', null, String(err.message || err)),
            h('button.btn', { onclick: () => { el.remove(); show(e.id, params); } }, 'Try again')));
          return;
        }
      } else { rec.el.hidden = false; if (params) rec.api?.onParams?.(params); }
      if (current === e.id) { if (visible) { try { rec.api?.onShow?.(); } catch (err) { console.error(err); } } } else rec.el.hidden = true;
    }
    ctx.bus.on('prefs', () => { lab.clearTokens(); try { recs.get(current)?.api?.onShow?.(); } catch (err) { console.error(err); } });
    await show(ctx.params?.exhibit || 'twin', ctx.params);
    return {
      onShow() { visible = true; try { recs.get(current)?.api?.onShow?.(); } catch (err) { console.error(err); } },
      onHide() { visible = false; try { recs.get(current)?.api?.onHide?.(); } catch (err) { console.error(err); } },
      onParams(p) { if (p?.exhibit) show(p.exhibit, p); },
    };
  },
};
