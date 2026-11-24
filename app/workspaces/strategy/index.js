// Search strategy: the mathematics of where to look next. Five exhibits that run their real maths in the page.
//   1  Search theory            a Bayesian probability map of the site, updated after every look        ex-theory.js
//   2  Where to listen next     expected information gain of one more 10 s window, for every cell       ex-theory.js
//   3  Planning under doubt     the mission as a POMDP, Monte-Carlo tree search, measured               ex-planner.js
//   4  Many teams, one plan     team routing: exact, simulated annealing, simulated quantum annealing   teams.js
//   5  The value of a sensor    the same machinery answering design questions with numbers             ex-value.js
// Everything is a live algorithm on simulated input. No exhibit claims hardware HOUND does not have.
import { dropTokens } from './common.js';

const EXHIBITS = [
  { id: 'theory', n: 1, label: 'Search theory', short: 'Search', file: './ex-theory.js' },
  { id: 'next', n: 2, label: 'Where to listen next', short: 'Next stop', file: './ex-theory.js' },
  { id: 'planner', n: 3, label: 'Planning under uncertainty', short: 'Plan', file: './ex-planner.js' },
  { id: 'teams', n: 4, label: 'Many teams, one plan', short: 'Teams', file: './teams.js' },
  { id: 'value', n: 5, label: 'The value of a sensor', short: 'Sensors', file: './ex-value.js' },
];

function loadCss(name, key) {
  if (document.querySelector('link[data-strategy-css="' + key + '"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = new URL(name, import.meta.url).href; link.dataset.strategyCss = key;
    link.onload = link.onerror = () => resolve();
    document.head.append(link); setTimeout(resolve, 1500);
  });
}

export default {
  async mount(root, ctx) {
    await loadCss('./style.css', 'main');
    const { h, realityTag, icon } = ctx.kit;
    root.classList.add('strategy');

    const tabs = h('div.tabs.strategy-tabs.adv-only', { role: 'tablist', 'aria-label': 'Exhibits' },
      ...EXHIBITS.map((e) => h('button', { type: 'button', role: 'tab', id: 'strategy-tab-' + e.id, 'aria-selected': 'false', 'aria-controls': 'strategy-pane-' + e.id, tabindex: '-1', 'data-ex': e.id, onclick: () => open(e.id) },
        h('span.num.strategy-tab-n', null, String(e.n)), e.label)));
    tabs.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft' && ev.key !== 'Home' && ev.key !== 'End') return;
      const i = EXHIBITS.findIndex((e) => e.id === active);
      const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? EXHIBITS.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + EXHIBITS.length) % EXHIBITS.length;
      ev.preventDefault(); open(EXHIBITS[j].id); tabs.children[j].focus();
    });
    const head = h('header.ws-head.strategy-head.adv-only', null,
      h('div', null, h('h1', null, 'Search strategy'),
        h('p', null, 'The mathematics of where to look next: a probability map that learns from every empty room, a planner that weighs each stop before the rover drives, and the numbers that say whether it helps.')),
      h('div.row.tight', null, realityTag('live-algo'), realityTag('sim')));
    const stage = h('div.strategy-stage');
    const stepper = h('nav.strategy-steps.demo-only', { 'aria-label': 'Exhibits' }, ...EXHIBITS.map((e) => h('button', { type: 'button', 'data-ex': e.id, onclick: () => open(e.id) }, h('i', null), e.short)));
    stage.append(stepper); root.append(head, tabs, stage);

    // Panes are built the first time they are opened. Exhibits 1 and 2 share one module (and one WebGL canvas).
    const modules = new Map();   // file -> Promise<controller>
    const panes = new Map();     // exhibit id -> element
    let active = null, visible = false;
    for (const e of EXHIBITS) {
      if (!panes.has(e.file)) panes.set(e.file, h('div.strategy-pane', { id: 'strategy-pane-' + e.id, role: 'tabpanel', hidden: true }));
    }
    stage.prepend(...panes.values());

    function controller(e) {
      if (modules.has(e.file)) return modules.get(e.file);
      const pane = panes.get(e.file);
      pane.replaceChildren(h('div.empty', null, h('div.spinner'), h('p', null, 'Opening ' + e.label.toLowerCase() + '…')));
      const p = import(e.file).then(async (mod) => { pane.replaceChildren(); return (await mod.default(pane, ctx)) || {}; }).catch((err) => {
        console.error('[strategy] exhibit "' + e.id + '" failed', err);
        pane.replaceChildren(h('div.empty', null, icon('alert', 28), h('h2', null, e.label + ' could not start'), h('p.muted', { style: { maxWidth: '520px' } }, String(err && err.message || err)),
          h('button.btn', { type: 'button', onclick: () => { modules.delete(e.file); open(e.id); } }, 'Try again')));
        return {};
      });
      modules.set(e.file, p); return p;
    }

    async function open(id) {
      const e = EXHIBITS.find((x) => x.id === id) || EXHIBITS[0];
      const prev = EXHIBITS.find((x) => x.id === active);
      if (prev && prev.file !== e.file) { panes.get(prev.file).hidden = true; modules.get(prev.file)?.then((c) => c.hide?.()); }
      active = e.id;
      for (const b of tabs.children) { const on = b.dataset.ex === e.id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
      for (const b of stepper.children) { if (b.dataset.ex === e.id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); }
      const pane = panes.get(e.file); pane.hidden = false; pane.setAttribute('aria-labelledby', 'strategy-tab-' + e.id);
      const c = await controller(e);
      if (active !== e.id) return;
      c.setExhibit?.(e.id);
      if (visible) c.show?.();
    }

    const offPrefs = ctx.bus.on('prefs', () => { dropTokens(); for (const p of modules.values()) p.then((c) => c.restyle?.()); });
    const fromUrl = new URLSearchParams(location.search).get('ex');
    await open(ctx.params?.exhibit || fromUrl || 'theory');

    return {
      onShow() { visible = true; const e = EXHIBITS.find((x) => x.id === active); modules.get(e.file)?.then((c) => { if (visible && active === e.id) c.show?.(); }); },
      onHide() { visible = false; for (const p of modules.values()) p.then((c) => c.hide?.()); },
      onParams(p) { if (p?.exhibit) open(p.exhibit); },
      _off: offPrefs,
    };
  },
};
