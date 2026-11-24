// Demo mode for the Valley: the film fills the workspace; over it a title, one caption, three live figures, one action.
import { fmtClock, fmtDist } from './geo.js';

export function createDemo(root, ctx, opts) {
  const { h, icon, realityTag, reducedMotion } = ctx.kit, el = {};
  const host = h('div.area-film');
  const fig = (key, label) => h('div.area-fig', null, (el[key] = h('b', null, '–')), h('span', null, label));
  const ui = h('div.area-demo.demo-only', null, host,
    h('div.area-demo-shade'),
    (el.mark = h('div.area-demo-mark', { 'aria-hidden': 'true' }, h('i'), h('span', null, h('b', null, 'Block B'), h('em', null, 'simulated exercise')))),
    h('section.area-demo-title', null,
      h('div.row', null, realityTag('real-data'), realityTag('live-algo')),
      h('h1', null, 'One valley. One block to search.'),
      h('p', null, 'Timure, Nepal, from real elevation and satellite imagery. The water is an illustrative simulation, not a forecast and not a reconstruction of the real event.'),
      h('div.row', null, h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: () => ctx.shell.open('mission') }, icon('mission'), 'Enter the building'),
        h('button.btn.btn-ghost.btn-icon', { type: 'button', 'aria-label': 'Play the flight again', title: 'Play the flight again', onclick: () => film?.restart() }, icon('reset')),
        (el.now = h('span.area-demo-now', { role: 'status' })))),
    h('div.area-demo-figs', null, fig('front', 'surge to the block'), fig('ha', 'flooded now'), fig('need', 'river rise to reach the block')),
    (el.credit = h('p.area-demo-credit', null, 'Imagery © Esri, Maxar · Terrain: Mapzen, AWS · © OpenStreetMap · trees, mist and building heights drawn')));
  root.append(ui);
  let film = null, starting = null, lastText = 0;
  const set = (e, s) => { if (e.textContent !== s) e.textContent = s; };
  function onInfo(f) {
    el.mark.style.opacity = f.siteOn ? String(Math.min(1, Math.max(0, (f.k - 0.75) * 5)) * f.fade) : '0';
    if (f.siteOn) el.mark.style.transform = 'translate3d(' + f.siteX.toFixed(1) + 'px,' + f.siteY.toFixed(1) + 'px,0)';
    const now = performance.now(); if (now - lastText < 200) return; lastText = now;
    set(el.ha, f.ha.toFixed(1) + ' ha'); set(el.front, f.toBlock > 20 ? fmtDist(f.toBlock) : 'passed'); set(el.need, '+' + opts.blockNeed.toFixed(1) + ' m');
    const what = f.t < 7 ? 'First light on the Lende Khola' : f.toBlock > 900 ? 'A 15 m surge runs down the Bhote Koshi' : f.toBlock > 0 ? 'The surge nears Timure' : f.t < 46 ? 'The surge passes below the block' : 'The block stays dry. The search can start';
    set(el.now, fmtClock(f.minutes) + '  ' + what);
  }
  async function ensure() {
    if (film) return film;
    starting ||= import('./film.js').then(({ createFilm }) => { film = createFilm(host, { ...opts, onInfo, reduced: reducedMotion, onFail: () => ctx.shell.toast('The satellite tiles are not loading. The valley is drawn from the saved elevation grid.', { level: 'info' }) }); return film; });
    return starting;
  }
  return { ui, get film() { return film; }, async start() { const f = await ensure(); f.start(); return f; }, stop() { film?.stop(); } };
}
