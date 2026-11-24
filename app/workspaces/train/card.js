// The operator card: one printed page to keep beside the laptop. Everything on it comes from how the system
// behaves in this console (core/sim.js FAULTS, core/fusion.js THRESHOLDS) and from docs/FACTS.md.
import { FAULTS } from '../../core/sim.js';
import { THRESHOLDS } from '../../core/fusion.js';

const STEPS = [
  ['Survey', 'The drone maps the site and flags people in the open.', 'Read the map. Note every marked hazard before the rover moves.'],
  ['Search', 'The rover stops at each room and listens for 10 s. It cannot listen while it drives.', 'Let each window finish. Watch which rooms it could not reach.'],
  ['Check leads', 'Uncertain readings stay open as “possible”.', 'Send the rover for a second look from a new place, or hand the lead to the team. Dismiss only with a reason.'],
  ['Plan', 'The planner draws a route around the hazards it was told to avoid.', 'Check which hazards are switched on. Read the metres inside hazards, not just the length.'],
  ['Approve', 'Nothing moves until a named person approves.', 'After any change (a slide, a new hazard) read the route again. Then approve.'],
  ['Hand over', 'The report lists what was searched and what was not.', 'Tell the team which rooms the sensors never reached. Those are searched by hand.'],
];
const YOU_DO = {
  linkLoss: 'Restore the link. Do not send anyone after the rover.',
  csiDropout: 'Fix the link quickly so the repeat window succeeds. If not, flag the room: no Wi-Fi.',
  badWindow: 'Clear it and let the stop listen again. Never count it as a yes or a no.',
  thermalFail: 'Carry on. Expect more “possible” leads; hand them to the team.',
  lowBattery: 'Swap the battery at staging. The rover goes back to the same stop.',
};

export function openCard(host, ctx, { onExit }) {
  const { h, icon } = ctx.kit;
  const pct = (x) => Math.round(x * 100) + ' %';
  const page = h('article.train-card-page', { 'aria-label': 'Operator card' },
    h('header', null, h('div', null, h('h1', null, 'HOUND operator card'), h('p', null, 'The procedure on one page. Keep it beside the laptop.')), h('div.train-card-mark', null, 'Training material', h('br'), 'Numbers are from simulation')),
    h('section.train-card-steps', null, h('h2', null, 'The six steps'),
      h('table', null, h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'What the system does'), h('th', null, 'What you do'))),
        h('tbody', null, ...STEPS.map(([name, sys, you], i) => h('tr', null, h('th', null, h('b', null, String(i + 1)), name), h('td', null, sys), h('td', null, you)))))),
    h('div.train-card-cols', null,
      h('section', null, h('h2', null, 'Reading the number'),
        h('div.train-card-scale', { 'aria-hidden': 'true' }, h('i', { style: { width: pct(THRESHOLDS.possible) } }), h('i', { style: { width: pct(THRESHOLDS.confirmed - THRESHOLDS.possible) } }), h('i', { style: { width: pct(1 - THRESHOLDS.confirmed) } })),
        h('ul', null,
          h('li', null, h('b', null, 'Under ' + pct(THRESHOLDS.possible) + ': closed.'), ' The readings do not add up to a person.'),
          h('li', null, h('b', null, pct(THRESHOLDS.possible) + ' to ' + pct(THRESHOLDS.confirmed) + ': possible.'), ' Take a second look or hand it to the team. A second look costs about a minute. A missed person costs far more.'),
          h('li', null, h('b', null, pct(THRESHOLDS.confirmed) + ' and over: person found.'), ' Independent sensors agree.')),
        h('p', null, h('b', null, 'A Wi-Fi “no one” is weak evidence.'), ' In simulation the network finds 87 % of moving people behind a wall but only 21 % of still ones, and raises a false alarm in 11 % of empty rooms. Radar and thermal carry the still person.'),
        h('p', null, 'The console never shows a breathing rate: the estimate is not reliable.')),
      h('section', null, h('h2', null, 'Before you approve a route'),
        h('ul.train-card-checks', null,
          h('li', null, 'Every hazard type is switched on in the planner, or you know why not.'),
          h('li', null, 'You have read the metres inside hazards for each leg.'),
          h('li', null, 'Nothing has changed since it was planned. If it has, it was planned again.'),
          h('li', null, 'For each “break through” leg, the team knows the wall, the side and the distance behind it.'),
          h('li', null, 'Your name is on the approval.')),
        h('h2', null, 'At hand-over'),
        h('ul.train-card-checks', null,
          h('li', null, 'Rooms the sensors never reached are listed as not searched.'),
          h('li', null, 'Rooms searched without Wi-Fi are listed as such.'),
          h('li', null, 'Rooms marked clear still carry a missed-person risk. Say the number.')))),
    h('section.train-card-faults', null, h('h2', null, 'When something fails'),
      h('table', null, h('thead', null, h('tr', null, h('th', null, 'You see'), h('th', null, 'The system'), h('th', null, 'You'))),
        h('tbody', null, ...Object.entries(FAULTS).map(([id, f]) => h('tr', null, h('th', null, f.label), h('td', null, f.does), h('td', null, YOU_DO[id])))))),
    h('footer', null, h('p', null, 'On the real rover the Arduino stops the motors by itself 400 ms after the Raspberry Pi goes quiet. Priority orders and probabilities are planning aids, not medical assessments. HOUND Command is a simulated exercise and is not connected to the rover. The network has been tested on simulated people only.')));
  const before = () => document.documentElement.classList.add('train-print'), after = () => document.documentElement.classList.remove('train-print');
  window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after);
  host.append(
    h('div.train-bar', null, h('button.btn.btn-ghost', { onclick: onExit }, icon('arrow-left', 14), 'Back to training'), h('h2', null, 'Operator card'), h('div.grow'),
      h('span.train-meta', null, 'One page, A4 or Letter. Printed in black on white.'), h('button.btn.btn-primary', { onclick: () => { before(); window.print(); } }, icon('print', 16), 'Print the card')),
    h('div.train-card-stage', null, page));
  return { destroy() { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); after(); } };
}
