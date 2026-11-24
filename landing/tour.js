// The guided tour of the console's workspaces. The list mirrors MANIFEST in app/shell.js (that file starts the whole
// console when imported, so it cannot be imported here). Captures are real screenshots taken by landing/capture.py;
// landing/captures.json says which ones exist.
import { el } from './shared.js';

const FALLBACK = [
  { id: 'area', title: 'Valley', group: 'Operate', reality: 'real-data', blurb: 'The real valley in 3-D: terrain, satellite imagery, the flood, and where the search is.' },
  { id: 'mission', title: 'Mission', group: 'Operate', reality: 'sim', blurb: 'Run the search in the 3-D twin, from drone survey to rescue.' },
  { id: 'triage', title: 'Triage', group: 'Operate', reality: 'live-algo', blurb: 'Who to reach first, and where to break through. A planning aid, not a medical assessment.' },
  { id: 'swarm', title: 'Swarm', group: 'Operate', reality: 'concept', blurb: 'Several rovers and drones sharing one search.' },
  { id: 'sense', title: 'Wi-Fi AI', group: 'Sense', reality: 'live-ai', blurb: 'The neural network that senses people through walls, running live, with its explanation.' },
  { id: 'fusion', title: 'Fusion', group: 'Sense', reality: 'live-algo', blurb: 'How Wi-Fi, radar and heat add up to one confident answer, step by step.' },
  { id: 'aerial', title: 'Drone imagery', group: 'Sense', reality: 'live-ai', blurb: 'Find people in aerial pictures with a detector that runs in the browser.' },
  { id: 'scan', title: '3-D scan', group: 'Sense', reality: 'live-algo', blurb: 'Turn a drone scan into a map and look for survivable spaces.' },
  { id: 'signals', title: 'Signals', group: 'Sense', reality: 'device', blurb: 'Listen for tapping with your microphone; locate phones by signal strength.' },
  { id: 'graph', title: 'Evidence', group: 'Understand', reality: 'live-algo', blurb: 'Every finding linked to the readings that support it.' },
  { id: 'report', title: 'Report', group: 'Understand', reality: 'live-algo', blurb: 'The hand-over report for the rescue team, written from the mission log.' },
  { id: 'globe', title: 'Live quakes', group: 'Understand', reality: 'real-data', blurb: 'Real earthquakes from the USGS feed, on a 3-D globe.' },
  { id: 'train', title: 'Training', group: 'Understand', reality: 'live-algo', blurb: 'Practise the operator\u2019s decisions and get scored.' },
  { id: 'copilot', title: 'Copilot', group: 'System', reality: 'live-ai', blurb: 'Ask in plain words. A language model on this computer turns it into actions.' },
  { id: 'status', title: 'System check', group: 'System', reality: 'live-algo', blurb: 'Self-tests, fault drills and the full list of what is real.' },
];
const REALITY = { 'live-ai': ['Live AI', 'rl-live-ai'], 'live-algo': ['Live algorithm', 'rl-live-algo'], 'real-data': ['Real data', 'rl-real'], device: ['Your device', 'rl-real'], sim: ['Simulated', 'rl-sim'], concept: ['Concept', 'rl-concept'], built: ['Built', 'rl-real'] };
const tag = (kind) => el('span.rl.' + REALITY[kind][1], null, REALITY[kind][0]);

// The console's own list, read from app/shell.js as text, so this page cannot fall out of step with it.
async function readManifest() {
  try {
    const src = await (await fetch('app/shell.js')).text();
    const re = /\{ id: '([\w-]+)', title: '([^']+)', group: '([^']+)', icon: '[^']+', reality: '([^']+)', blurb: '((?:[^'\\]|\\.)*)' \}/g;
    const out = []; let m;
    while ((m = re.exec(src))) if (REALITY[m[4]]) out.push({ id: m[1], title: m[2], group: m[3], reality: m[4], blurb: m[5].replace(/\\'/g, "'") });
    return out.length >= 10 ? out : null;
  } catch { return null; }
}
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine', 'thirty'];

export async function startTour() {
  const list = document.querySelector('#tour-list'), frame = document.querySelector('#tour-frame');
  let WORKSPACES = (await readManifest()) || FALLBACK;
  let caps = {};
  try { const r = await fetch('landing/captures.json'); if (r.ok) caps = await r.json(); } catch { /* no captures: the tour still lists every workspace */ }
  // A workspace that could not be captured did not open, so the tour does not promise it.
  if (Object.keys(caps).length) WORKSPACES = WORKSPACES.filter((w) => caps[w.id]);
  const count = document.querySelector('#tour-count'), word = WORDS[WORKSPACES.length] || String(WORKSPACES.length);
  if (count) count.textContent = word[0].toUpperCase() + word.slice(1);
  const inBuilt = document.querySelector('#built-count'); if (inBuilt) inBuilt.textContent = 'The ' + word;
  const bs = document.querySelector('#built-shot img'), best = caps.mission || caps.sense || Object.values(caps)[0];
  if (bs && best) { bs.src = best.file; bs.alt = 'A capture of HOUND Command'; bs.nextSibling.lastChild.textContent = 'HOUND Command, a capture of the running console'; }

  const shot = el('div.tf-shot'), cap = el('div.tf-cap');
  frame.append(shot, cap);
  const imgs = {}, items = {};
  let current = null;
  function show(id) {
    if (id === current) return; current = id;
    const w = WORKSPACES.find((x) => x.id === id), c = caps[id];
    Object.entries(items).forEach(([k, b]) => b.setAttribute('aria-pressed', String(k === id)));
    shot.querySelector('.tf-none')?.remove();
    Object.values(imgs).forEach((im) => im.classList.remove('on'));
    if (c) {
      const im = imgs[id] ||= shot.appendChild(el('img', { src: c.file, width: c.w, height: c.h, alt: `The ${w.title} workspace of HOUND Command`, decoding: 'async' }));
      const on = () => { if (current === id) im.classList.add('on'); };
      im.complete ? requestAnimationFrame(on) : im.addEventListener('load', on, { once: true });
    } else shot.append(el('div.tf-none', null, el('b', null, w.blurb), el('span', null, 'There was no capture of this workspace when the page was built. Open it in the console to see it.')));
    cap.replaceChildren(tag(w.reality), el('span', null, w.blurb + (c?.note ? ' ' + c.note + '.' : '')), el('a', { href: 'app/#/' + w.id }, 'Open ' + w.title));
  }
  // Two columns of names; the one pointed at, focused or clicked is shown large.
  list.style.gridTemplateRows = `repeat(${Math.ceil(WORKSPACES.length / 2)}, auto)`;
  list.append(...WORKSPACES.map((w) => items[w.id] = el('button.tour-item', { type: 'button', 'aria-pressed': 'false', onclick: () => show(w.id), onpointerenter: () => show(w.id), onfocus: () => show(w.id) }, w.title)));
  show(caps.mission ? 'mission' : WORKSPACES.find((w) => caps[w.id])?.id || 'mission');
}
