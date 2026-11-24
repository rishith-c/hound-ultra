// Demo, scene three: every feature set in one typographic wall, in columns from "built" to "concept". A name that the code
// check cannot find is struck out and says so. Each name opens its workspace.
import { LEDGER, ALL, checkBuilt } from './ledger.js';
const ORDER = ['built', 'live-ai', 'live-algo', 'real-data', 'device', 'sim', 'concept'];
export function createRealWall(host, ctx) {
  const { h, REALITY } = ctx.kit; let made = false, timers = [];
  const cols = h('div.status-rcols'); host.append(cols);
  async function make() {
    if (made) return; made = true; await checkBuilt();
    const groups = ORDER.filter((k) => REALITY[k]).map((k) => [k, ALL.filter((r) => r.kind === k)]).filter(([, l]) => l.length);
    cols.replaceChildren(...groups.map(([k, l]) => h('section', { class: 'k-' + k, style: { '--n': l.length } }, h('header', null, h('b', null, String(l.filter((r) => r.built !== 'missing').length)), h('h2', null, REALITY[k].label), h('p', null, REALITY[k].means)),
      h('ul', null, ...l.map((r) => h('li', { class: r.built }, r.ws && r.built !== 'missing' ? h('a', { href: '#/' + r.ws, title: r.real + (r.sim ? ' ' + r.sim : '') }, r.name) : h('span', { title: r.built === 'missing' ? 'Not built: the code was not found.' : r.real }, r.name), r.built === 'missing' ? h('small', null, 'not built') : null))))));
    let i = 0; for (const li of cols.querySelectorAll('li')) li.style.setProperty('--i', i++);
    paint();
  }
  function paint() { /* colours come from the tokens */ }
  return { show() { make().then(() => requestAnimationFrame(() => host.classList.add('on'))); }, hide() { host.classList.remove('on'); timers.forEach(clearTimeout); timers = []; }, paint, total: () => LEDGER.length };
}
