// Demo mode for the Valley: the film fills the workspace; over it a title, one caption, three live figures, one action.
import { fmtClock, fmtDist } from './geo.js';

export function createDemo(root, ctx, opts) {
  const { h, icon, realityTag, reducedMotion } = ctx.kit, el = {};
  const host = h('div.area-film');
  const fig = (key, label) => h('div.area-fig', null, (el[key] = h('b', null, '–')), h('span', null, label));
  const ui = h('div.area-demo.demo-only', null, opts.poster || '', host,
    h('div.area-demo-shade'),
    (el.mark = h('div.area-demo-mark', { 'aria-hidden': 'true' }, h('i'), h('span', null, h('b', null, 'Block B'), h('em', null, 'simulated exercise')))),
    h('section.area-demo-title', null,
      h('div.row', null, realityTag('real-data'), realityTag('simulated')),
      h('h1', null, 'Somewhere down there, people are trapped.'),
      h('p', null, 'A flood has hit a mountain village. Rescuers need to know who is inside.'),
      h('div.row', null, (el.fly = h('button.btn.btn-ghost', { type: 'button', onclick: () => film?.fly() }, 'Fly to the block')),
        (el.again = h('button.btn.btn-ghost.btn-icon', { type: 'button', 'aria-label': 'Play the flight again', title: 'Play the flight again', onclick: () => film?.restart() }, icon('reset'))),
        (el.now = h('span.area-demo-now', { role: 'status' })))),
    h('div.area-demo-figs', null, fig('front', 'surge to the block'), fig('ha', 'flooded now'), fig('need', 'rooms to search')),
    (el.credit = h('p.area-demo-credit', null, h('span', null, 'Timure, Nepal, from real elevation and satellite imagery. The water is simulated.'), h('span', null, 'The block, its damage and the people are a simulated exercise. Trees, mist, dust, building heights and the ground under the block are drawn.'), h('span', null, 'Imagery © Esri, Maxar · Terrain: Mapzen, AWS · © OpenStreetMap'))));
  root.append(ui);
  let film = null, starting = null, lastText = 0, gone = false, shown = false;
  const set = (e, s) => { if (e.textContent !== s) e.textContent = s; };
  function onInfo(f) {
    if (!shown) { shown = true; host.classList.add('on'); }
    el.mark.style.opacity = f.siteOn ? String(Math.min(1, Math.max(0, (f.k - 0.75) * 5)) * f.fade) : '0';
    if (f.siteOn) el.mark.style.transform = 'translate3d(' + f.siteX.toFixed(1) + 'px,' + f.siteY.toFixed(1) + 'px,0)';
    const now = performance.now(); if (now - lastText < 200) return; lastText = now;
    set(el.ha, f.ha.toFixed(1) + ' ha'); set(el.front, f.toBlock > 20 ? fmtDist(f.toBlock) : 'passed'); set(el.need, '8');
    const what = f.t < 3.5 ? 'First light on the Lende Khola' : f.toBlock > 900 ? 'A 15 m surge runs down the Bhote Koshi' : f.toBlock > 0 ? 'The surge nears Timure' : f.t < 22 ? 'Block B has come down' : 'Someone is in there';
    set(el.now, fmtClock(f.minutes) + '  ' + what);
  }
  async function ensure() {
    if (film) return film;
    starting ||= import('./film.js').then(({ createFilm }) => { if (gone) return null; film = createFilm(host, { ...opts, onInfo, reduced: reducedMotion, onFail: () => ctx.shell.toast('The satellite tiles are not loading. The valley is drawn from the saved elevation grid.', { level: 'info' }) }); return film; });
    return starting;
  }
  return { ui, get film() { return film; }, async start() { el.fly.hidden = el.again.hidden = reducedMotion(); const f = await ensure(); f?.start(); return f; }, stop() { film?.stop(); }, dispose() { gone = true; film?.destroy(); film = null; ui.remove(); } };
}
