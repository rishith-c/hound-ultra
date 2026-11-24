// All six instruments on the same pile: what each finds, side by side, and an honest table.
import { drawPile, WORLD } from './model.js';
const FULL = { x0: -0.4, x1: 24.4, z0: -3.2, z1: 7.2 };
const ICON = { seen: 'check', hint: 'warning', missed: 'close', na: null }, WORD = { seen: 'found', hint: 'a hint', missed: 'missed', na: 'cannot' };

export function createCompare(env, { LENSES, exhibits, ensure, open }) {
  const { h, icon } = env, list = LENSES.filter((l) => exhibits.has(l.id)); let stale = true, queue = [], dirtyIds = new Set(), bar = null;
  const status = h('p', { role: 'status' }, 'Each picture is what that instrument recovers, computed here from its own simulated measurements.');
  const cells = new Map(), thumbs = h('div.ds-thumbs', { role: 'list', 'aria-label': 'The same pile through six instruments' }, list.map((l) => {
    const cv = h('canvas', { width: 520, height: 218 }), sum = h('span', null, 'measuring'); cells.set(l.id, { cv, sum });
    return h('button.ds-thumb', { type: 'button', role: 'listitem', 'aria-label': 'Open ' + l.name, onclick: () => open(l.id) }, cv, h('span.ds-thumb-cap', null, h('b', null, l.name), sum));
  }));
  const matrix = h('div'), table = h('div');
  const el = h('section.ds-compare', { 'aria-label': 'Compare all six' }, h('div.ds-cmp-intro', null, h('h2', null, 'No single instrument is enough'), status), thumbs,
    h('div.ds-cmp-grid', null, h('div', null, h('h3', null, 'Who finds what in this pile'), h('p.ds-fig-sub', null, 'Scored against the simulated truth at each instrument’s current settings.'), matrix),
      h('div', null, h('h3', null, 'What each would cost you'), h('p.ds-fig-sub', null, 'Range, time, cost class and readiness are our own reading, not measurements. Click a row to open it.'), table)));
  const mark = (v) => h('td', { title: v.why || '' }, h('span.ds-cell.' + v.state, null, ICON[v.state] ? icon(ICON[v.state], 13) : '–'), h('small', null, WORD[v.state]));
  function fill() {
    const rows = [...env.pile.voids.map((v) => [v.id, v.id + ' ' + v.kind]), ['person', 'the person']];
    matrix.replaceChildren(h('table.table.ds-matrix', null, h('thead', null, h('tr', null, h('th', null, 'Target'), list.map((l) => h('th', null, l.name)))), h('tbody', null, rows.map(([id, name]) => h('tr', null, h('td', null, name), list.map((l) => { const ex = exhibits.get(l.id); return mark(ex.stale ? { state: 'na' } : ex.verdicts()[id] || { state: 'na' }); }))))));
    table.replaceChildren(h('table.table.ds-honest-table', null, h('thead', null, h('tr', null, ['Instrument', 'What it sees', 'Range', 'Time', 'Cost class', 'Readiness'].map((t) => h('th', null, t)))), h('tbody', null, list.map((l) => { const r = exhibits.get(l.id).row; return h('tr', { tabindex: '0', role: 'link', 'aria-label': 'Open ' + l.name, onclick: () => open(l.id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(l.id); } } }, h('td', null, h('b', null, l.name)), h('td', null, r.sees), h('td', null, r.range), h('td', null, r.time), h('td', null, r.cost, h('br'), h('small.dim', null, r.costNote)), h('td', null, h('span.ds-ready', { role: 'img', 'aria-label': r.ready + ' of 5' }, [1, 2, 3, 4, 5].map((n) => h('i', { class: n <= r.ready ? 'on' : '' }))), h('small.dim', null, r.readyNote))); }))));
  }
  function paint(l) {
    const ex = exhibits.get(l.id), { cv, sum } = cells.get(l.id), c = cv.getContext('2d'), w = cv.width, hh = cv.height, s = Math.min(w / (FULL.x1 - FULL.x0), hh / (FULL.z1 - FULL.z0)), ox = (w - (FULL.x1 - FULL.x0) * s) / 2 - FULL.x0 * s, oz = hh + FULL.z0 * s;
    c.clearRect(0, 0, w, hh); const S = { c, w, h: hh, s, pile: env.pile, truth: env.truth, X: (x) => ox + x * s, Z: (z) => oz - z * s, zr: [FULL.z0, FULL.z1], xr: [FULL.x0, FULL.x1], t: 0, thumb: true };
    ex.under?.(S); drawPile(S); ex.drawStage(S); sum.textContent = ex.summary();
  }
  return {
    el, dirty() { stale = true; },
    show() { if (!stale) { queue = [...list]; fill(); } },
    frame(dt) { // one instrument per frame, so opening this never freezes the page
      if (stale) { stale = false; queue = [...list]; fill(); }
      const l = queue[0]; if (!l) return; const ex = exhibits.get(l.id);
      try { ensure(ex); ex._demo?.().runAll?.(); paint(l); } catch (e) { cells.get(l.id).sum.textContent = 'failed: ' + e.message; console.error('[deepscan] compare ' + l.id, e); }
      queue.shift(); fill(); 
    },
  };
}
