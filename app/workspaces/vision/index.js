// Vision lab: seven exhibits of frontier computer vision, each running for real in this page.
// Frame only. Each exhibit lives in its own file and is imported the first time it is opened.
import { createLab, gpu, TF_VERSION, clearTok, asset } from './common.js';
import { createDemo } from './demo.js';

const EXHIBITS = [
  { id: 'words', n: '01', title: 'Search by words', sub: 'Type it, find it in the frame', file: './words.js', tags: ['live-ai'] },
  { id: 'outline', n: '02', title: 'Click to outline', sub: 'A mask and its area, from one click', file: './outline.js', tags: ['live-ai'] },
  { id: 'relief', n: '03', title: 'One photo to 3-D', sub: 'Depth from a single image', file: './relief.js', tags: ['live-ai'] },
  { id: 'pulse', n: '04', title: 'Pulse from pixels', sub: 'A heartbeat read from skin colour', file: './pulse.js', tags: ['device', 'live-algo'] },
  { id: 'events', n: '05', title: 'Event camera view', sub: 'Seeing only what changes', file: './events.js', tags: ['concept', 'live-algo'] },
  { id: 'skin', n: '06', title: 'Skin, by its spectrum', sub: 'Infrared bands where skin stands out', file: './skin.js', tags: ['concept', 'live-algo'] },
  { id: 'voice', n: '07', title: 'Hear a voice', sub: 'Sound events and speech to text', file: './voice.js', tags: ['live-ai', 'device'] },
];

export default {
  async mount(root, ctx) {
    const { h, icon, realityTag } = ctx.kit;
    for (const f of ['./style.css', './demo.css']) { const href = new URL(f, import.meta.url).href; if (!document.querySelector('link[href="' + href + '"]')) document.head.append(h('link', { rel: 'stylesheet', href })); }
    const lab = createLab(ctx);
    fetch(asset('data/vision/samples.json')).then((r) => (r.ok ? r.json() : [])).then((s) => { lab.samples = s; lab.emit('samples'); }).catch(() => {});

    const views = new Map(); let current = null, visible = false;
    const compute = h('span.vision-chip', { title: 'Where the models in this lab run. Nothing is sent to a server.' }, icon('cpu', 14), h('span', null, 'Checking this computer'));
    const ledger = h('span.vision-chip', { title: 'Models are downloaded only when you press Load, then kept in the browser cache.' }, icon('layers', 14), h('span', null, 'No model in memory'));
    const live = h('span.vision-chip.live', { hidden: true }, h('span.status.person.live', null, 'Camera or microphone is on'));
    gpu().then((g) => { compute.lastChild.textContent = g.ok ? 'WebGPU on this computer' + (g.vendor ? ' · ' + g.vendor + (g.arch ? ' ' + g.arch : '') : '') : 'No WebGPU here: models run on the processor'; });
    const paintLedger = () => {
      const all = [...lab.models.values()], ready = all.filter((m) => m.status === 'ready'), mb = ready.reduce((s, m) => s + m.mb, 0);
      ledger.lastChild.textContent = ready.length ? ready.length + (ready.length === 1 ? ' model' : ' models') + ' in memory · ' + Math.round(mb) + ' MB' : 'No model in memory';
      nav.querySelectorAll('[data-ex]').forEach((b) => { const st = lab.exState?.[b.dataset.ex]; b.dataset.state = st || ''; });
    };
    const nav = h('nav.vision-nav', { role: 'tablist', 'aria-label': 'Exhibits', 'aria-orientation': 'vertical' }, EXHIBITS.map((x) =>
      h('button.vision-nav-item', { role: 'tab', id: 'vision-tab-' + x.id, 'data-ex': x.id, 'aria-selected': 'false', onclick: () => show(x.id), onkeydown: (e) => {
        const i = EXHIBITS.indexOf(x), d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0; if (!d) return; e.preventDefault();
        const nx = EXHIBITS[(i + d + EXHIBITS.length) % EXHIBITS.length]; show(nx.id); document.getElementById('vision-tab-' + nx.id)?.focus();
      } },
        h('span.vision-nav-n.num', null, x.n), h('span.vision-nav-text', null, h('b', null, x.title), h('span', null, x.sub)), h('span.vision-nav-tags', null, x.tags.map((t) => h('i', { class: 't-' + t, title: ctx.kit.REALITY[t].label }))))));
    const navFoot = h('div.vision-nav-foot', null,
      h('p', null, 'Every model here runs in this page, on this computer. Transformers.js ' + TF_VERSION + '. Nothing loads until you ask, and nothing you show the camera or microphone is sent anywhere.'),
      h('div.vision-key', null, h('span', null, h('i.t-live-ai'), 'Live AI'), h('span', null, h('i.t-live-algo'), 'Live algorithm'), h('span', null, h('i.t-device'), 'Your device'), h('span', null, h('i.t-concept'), 'Concept hardware')));
    const body = h('div.vision-main');
    const demoEl = h('div.vision-demo.demo-only');
    root.classList.add('vision');
    root.append(
      h('header.ws-head.vision-head.adv-only', null,
        h('div', null, h('h1', null, 'Vision lab'), h('p', null, 'Seven ways a camera or a microphone could find a person, each one running for real in this page. Where the sensor does not exist on HOUND, it says Concept.')),
        h('div.vision-head-chips', null, live, compute, ledger, realityTag('live-ai'))),
      h('div.vision-body.adv-only', null, h('div.vision-rail', null, nav, navFoot), body), demoEl);
    const demo = createDemo(demoEl, ctx, lab);
    const isDemo = () => ctx.mode === 'demo';

    lab.on((t, d) => { if (t === 'models') paintLedger(); if (t === 'media') live.hidden = !d; });
    lab.open = (id, params) => show(id, params);
    ctx.bus.on('prefs', () => { clearTok(); views.get(current)?.api?.onPrefs?.(); });

    async function show(id, params) {
      const def = EXHIBITS.find((x) => x.id === id) || EXHIBITS[0];
      if (current && current !== def.id) { const prev = views.get(current); if (prev) { prev.el.hidden = true; try { prev.api?.onHide?.(); } catch (e) { console.error(e); } } lab.releaseAll(); }
      current = def.id;
      nav.querySelectorAll('button').forEach((b) => { const on = b.dataset.ex === def.id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
      let rec = views.get(def.id);
      if (!rec) {
        const el = h('div.vision-view', { role: 'tabpanel', 'aria-labelledby': 'vision-tab-' + def.id }, h('div.empty', null, h('div.spinner'), h('p', null, 'Opening ' + def.title.toLowerCase() + '…')));
        body.append(el); rec = { el, api: null }; views.set(def.id, rec);
        try {
          const mod = await import(def.file);
          el.replaceChildren();
          rec.api = (await mod.create(el, ctx, lab, { ...def, params: params || {} })) || {};
        } catch (e) {
          console.error('[vision] exhibit "' + def.id + '" failed', e);
          el.replaceChildren(h('div.empty', null, icon('alert', 28), h('h3', null, def.title + ' could not start'), h('p.muted', null, String(e.message || e)),
            h('button.btn', { onclick: () => { views.delete(def.id); el.remove(); show(def.id, params); } }, 'Try again')));
        }
      } else { rec.el.hidden = false; if (params) rec.api?.onParams?.(params); }
      if (current === def.id && visible) { try { rec.api?.onShow?.(); } catch (e) { console.error(e); } } else if (current !== def.id) rec.el.hidden = true;
    }
    // Demo plays the scenes; Advanced runs the exhibits. Only the one on screen animates.
    const first = ctx.params?.exhibit || ctx.params?.view || 'words';
    const start = () => { if (!visible) return; if (isDemo()) { pause(); demo.show(demo.current || current || first); } else { demo.hide(); if (current) { try { views.get(current)?.api?.onShow?.(); } catch (e) { console.error(e); } } else show(demo.current || first, ctx.params); } };
    const pause = () => { if (current) { try { views.get(current)?.api?.onHide?.(); } catch (e) { console.error(e); } } lab.releaseAll(); };
    ctx.bus.on('mode', start);
    if (!isDemo()) await show(first, ctx.params);
    root._vision = { demo, lab, show };
    return {
      onShow() { visible = true; start(); },
      onHide() { visible = false; demo.hide(); pause(); },
      onParams(p) { const id = p && (p.exhibit || p.view); if (!id) return; if (isDemo()) demo.go(id); else show(id, p); },
    };
  },
};
