// Signals: other ways to hear a trapped person. Four separate areas, each with its own reality label.
//   tap    your device + live algorithm   microphone knock detector (dsp.js)
//   phone  concept, live algorithm        locating a phone from signal strength
//   drone  concept                        a drone overhead as the Wi-Fi transmitter
//   plume  concept                        following exhaled CO2 to its source
// Only the area on screen runs. Everything stops, and the microphone is released, in onHide.
import { readColours } from './util.js';

const AREAS = [
  { id: 'tap', title: 'Tap detector', kind: 'device', line: 'Knocking, heard by a microphone', glyph: 'M3 17h2M7 17V7m0 10h3m2 0V9m0 8h3m2 0V7m0 10h2' },
  { id: 'phone', title: 'Phone finder', kind: 'concept', line: 'A phone, located by signal strength', glyph: 'M12 12h.01M8.500 15.500a5 5 0 0 1 0-7M15.500 8.500a5 5 0 0 1 0 7M5.500 18.500a9.200 9.200 0 0 1 0-13M18.500 5.500a9.200 9.200 0 0 1 0 13' },
  { id: 'drone', title: 'Drone transmitter', kind: 'concept', line: 'Wi-Fi sent from above the rubble', glyph: 'M5 5h.01M19 19h.01M5 5c8-1 15 6 14 14M5 5c-1 8 6 15 14 14M10 14l1 1' },
  { id: 'plume', title: 'Breath plume', kind: 'concept', line: 'Exhaled CO2, followed to its source', glyph: 'M4 18h.01M4 18c4-1 3-5 7-6s3-5 9-6M4 18c5 1 6-2 9-3s5-1 7-1' },
];

export default {
  async mount(root, ctx) {
    const { h, realityTag } = ctx.kit;
    if (!document.getElementById('signals-css')) document.head.append(h('link', { id: 'signals-css', rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }));
    readColours();
    root.classList.add('signals');
    const made = new Map(); let current = null, visible = false;

    const glyph = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`; return s; };
    const tabs = h('div.signals-tabs', { role: 'tablist', 'aria-label': 'Signal types' });
    for (const a of AREAS) {
      a.tab = h('button.signals-tab', { type: 'button', role: 'tab', id: 'signals-tab-' + a.id, 'aria-controls': 'signals-area-' + a.id, onclick: () => open(a.id) },
        glyph(a.glyph), h('span.signals-tab-text', null, h('b', null, a.title), h('span', null, a.line)), realityTag(a.kind));
      tabs.append(a.tab);
    }
    tabs.addEventListener('keydown', (e) => {
      const i = AREAS.findIndex((a) => a.id === current); let j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % AREAS.length; else if (e.key === 'ArrowLeft') j = (i + AREAS.length - 1) % AREAS.length;
      if (j >= 0) { e.preventDefault(); open(AREAS[j].id); AREAS[j].tab.focus(); }
    });
    const stage = h('div.signals-stage');
    root.append(
      h('header.signals-head', null,
        h('div.signals-title', null, h('div.row', null, h('h2', null, 'Signals'), realityTag(ctx.manifestEntry?.reality || 'device')),
          h('p.muted', null, 'Four more ways to hear a trapped person: knocking, a phone’s radio, a transmitter overhead, and breath.')),
        tabs),
      stage);

    async function open(id) {
      const a = AREAS.find((x) => x.id === id) || AREAS[0];
      if (current === a.id) return;
      if (current) made.get(current)?.api.hide();
      current = a.id;
      for (const x of AREAS) { x.tab.setAttribute('aria-selected', String(x.id === a.id)); x.tab.tabIndex = x.id === a.id ? 0 : -1; if (made.has(x.id)) made.get(x.id).el.hidden = x.id !== a.id; }
      if (!made.has(a.id)) {
        const el = h('section.signals-area', { id: 'signals-area-' + a.id, role: 'tabpanel', 'aria-labelledby': 'signals-tab-' + a.id });
        stage.append(el);
        const rec = { el, api: { show() {}, hide() {} } }; made.set(a.id, rec);
        try { const mod = await import(`./${a.id}.js`); rec.api = mod.create(el, ctx); }
        catch (e) { console.error('[signals] ' + a.id + ' failed', e); el.replaceChildren(h('div.empty', null, h('h3', null, a.title + ' could not start'), h('p.muted', null, String(e.message || e)))); }
        el.hidden = current !== a.id;
      }
      if (visible && current === a.id) made.get(a.id).api.show();
    }
    const offPrefs = ctx.bus.on('prefs', () => { readColours(); if (visible) made.get(current)?.api.repaint?.(); });
    await open(ctx.params?.area || 'tap');
    return {
      onShow() { visible = true; readColours(); made.get(current)?.api.show(); },
      onHide() { visible = false; for (const r of made.values()) r.api.hide(); },
      onParams(p) { if (p?.area) open(p.area); },
      dispose() { offPrefs(); },
    };
  },
};
