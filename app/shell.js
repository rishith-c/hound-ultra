// The console shell: top bar, workspace rail, router, shared context. Workspaces plug in through MANIFEST below.
// Owners of workspaces never edit this file; see docs/ARCHITECTURE.md for the contract.
import { createBus } from './core/bus.js';
import { loadNN } from './core/nn.js';
import { createSim, PHASE_INFO, FAULTS, COMMANDS } from './core/sim.js';
import world from './core/world.js';
import * as kit from './ui/kit.js';
const { h, icon, realityTag, fmt } = kit;

// id, title, group, icon, reality (see kit.REALITY), one-line purpose. The module lives at workspaces/<id>/index.js.
export const MANIFEST = [
  { id: 'area', title: 'Valley', group: 'Operate', icon: 'layers', reality: 'real-data', blurb: 'The real valley in 3-D: terrain, satellite imagery, the flood, and where the search is.' },
  { id: 'mission', title: 'Mission', group: 'Operate', icon: 'mission', reality: 'sim', blurb: 'Run the search in the 3-D twin, from drone survey to rescue.' },
  { id: 'rover', title: 'Rover', group: 'Operate', icon: 'rover', reality: 'built', blurb: 'The rover we built, part by part, from our own CAD to the real photograph.' },
  { id: 'triage', title: 'Triage', group: 'Operate', icon: 'triage', reality: 'live-algo', blurb: 'Who to reach first, and where to break through.' },
  { id: 'swarm', title: 'Swarm', group: 'Operate', icon: 'swarm', reality: 'concept', blurb: 'Several rovers and drones sharing one search.' },
  { id: 'sense', title: 'Wi-Fi AI', group: 'Sense', icon: 'wifi', reality: 'live-ai', blurb: 'The neural network that senses people through walls, running live.' },
  { id: 'fusion', title: 'Fusion', group: 'Sense', icon: 'fusion', reality: 'live-algo', blurb: 'How several weak sensors add up to one confident answer.' },
  { id: 'aerial', title: 'Drone imagery', group: 'Sense', icon: 'aerial', reality: 'live-ai', blurb: 'Find people in aerial photos with a detector that runs in the browser.' },
  { id: 'scan', title: '3-D scan', group: 'Sense', icon: 'scan', reality: 'live-algo', blurb: 'Turn a drone scan into a map and look for survivable spaces.' },
  { id: 'signals', title: 'Signals', group: 'Sense', icon: 'signals', reality: 'device', blurb: 'Listen for tapping with your microphone; locate phones by signal strength.' },
  { id: 'radio', title: 'Radio twin', group: 'Frontier', icon: 'wifi', reality: 'live-algo', blurb: 'Ray-traced Wi-Fi through the building, the quarter-wavelength trick, and radar images through a wall.' },
  { id: 'deepscan', title: 'Deep scan', group: 'Frontier', icon: 'scan', reality: 'concept', blurb: 'Cosmic rays, gravity, ground radar and fibre optics: six kinds of physics for seeing inside a collapse.' },
  { id: 'vision', title: 'Vision lab', group: 'Frontier', icon: 'eye', reality: 'live-ai', blurb: 'Search a photo by words, turn one photo into 3-D, read a pulse from pixels. Real models, in the page.' },
  { id: 'strategy', title: 'Search strategy', group: 'Frontier', icon: 'route', reality: 'live-algo', blurb: 'The mathematics of where to look next, measured against the scripted search.' },
  { id: 'timelines', title: 'Timelines', group: 'Frontier', icon: 'clock', reality: 'live-algo', blurb: 'Fork the mission at any moment, decide differently, and compare the worlds side by side.' },
  { id: 'forge', title: 'Model forge', group: 'Frontier', icon: 'bolt', reality: 'live-ai', blurb: 'Train the network in your browser, shrink it for a microcontroller, and measure when it does not know.' },
  { id: 'structure', title: 'Structure', group: 'Frontier', icon: 'wall', reality: 'live-algo', blurb: 'Rigid-body physics of the rubble pile: test a lift before anyone touches a slab.' },
  { id: 'horizon', title: 'Horizon', group: 'Frontier', icon: 'globe', reality: 'concept', blurb: 'The far frontier: ideas that sound like science fiction, each anchored in real research.' },
  { id: 'graph', title: 'Evidence', group: 'Understand', icon: 'graph', reality: 'live-algo', blurb: 'Every finding linked to the readings that support it.' },
  { id: 'report', title: 'Report', group: 'Understand', icon: 'report', reality: 'live-algo', blurb: 'The hand-over report for the rescue team, written from the mission log.' },
  { id: 'globe', title: 'Live quakes', group: 'Understand', icon: 'globe', reality: 'real-data', blurb: 'Real earthquakes from the USGS feed, on a 3-D globe.' },
  { id: 'train', title: 'Training', group: 'Understand', icon: 'train', reality: 'live-algo', blurb: 'Practise the operator’s decisions and get scored.' },
  { id: 'copilot', title: 'Copilot', group: 'System', icon: 'copilot', reality: 'live-ai', blurb: 'Ask in plain words. An on-device language model turns it into actions.' },
  { id: 'status', title: 'System check', group: 'System', icon: 'status', reality: 'live-algo', blurb: 'Self-tests, fault drills and the list of what is real.' },
];
// Demo mode: the short, cinematic path through the product. Everything else is one click away in Advanced.
export const CHAPTERS = [
  { id: 'area', label: 'The problem', part: 'How HOUND finds people' }, { id: 'radio', label: 'The idea' }, { id: 'forge', label: 'The training' }, { id: 'sense', label: 'The network' }, { id: 'rover', label: 'The rover' },
  { id: 'mission', label: 'The search' }, { id: 'fusion', label: 'The proof' }, { id: 'report', label: 'The rescue' },
  { id: 'aerial', label: 'Drone eyes', part: 'What comes next' }, { id: 'scan', label: 'Inside the rubble' }, { id: 'swarm', label: 'Many rovers' },
  { id: 'structure', label: 'The collapse' }, { id: 'horizon', label: 'The horizon' },
];
// Optional app-wide add-ons. Each exports init(ctx). Missing files are skipped silently.
const GLOBALS = ['intro', 'palette', 'copilot-dock', 'narration', 'a11y', 'sound'];

const $ = (id) => document.getElementById(id);
const bus = createBus();
const prefs = loadPrefs();
applyPrefs();

function loadPrefs() {
  const base = { contrast: 'normal', palette: 'default', motion: 'auto', rail: 'open', mode: 'demo' };
  try { Object.assign(base, JSON.parse(localStorage.getItem('hound.prefs') || '{}')); } catch { /* private mode: defaults */ }
  const asked = new URLSearchParams(location.search).get('mode'); // ?mode=advanced or ?mode=demo
  if (asked === 'advanced' || asked === 'demo') base.mode = asked;
  return base;
}
function savePrefs() { try { localStorage.setItem('hound.prefs', JSON.stringify(prefs)); } catch { /* private mode: keep going without saving */ } }
function applyPrefs() {
  const r = document.documentElement;
  r.dataset.contrast = prefs.contrast === 'high' ? 'high' : 'normal';
  r.dataset.palette = prefs.palette === 'cb' ? 'cb' : 'default';
  if (prefs.motion === 'reduce') r.dataset.motion = 'reduce'; else delete r.dataset.motion;
  r.dataset.rail = prefs.rail;
  r.dataset.mode = prefs.mode === 'advanced' ? 'advanced' : 'demo';
}

// ---------- toasts and dialogs ----------
function toast(text, { level = 'info', ms = 4200 } = {}) {
  const el = h('div.toast.glass.' + level, { role: level === 'alert' ? 'alert' : 'status' }, icon(level === 'alert' ? 'alert' : level === 'ok' ? 'check' : 'info'), h('span', null, text));
  $('toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
}
function confirmDialog({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const done = (v) => { wrap.remove(); prev?.focus?.(); resolve(v); };
    const ok = h('button.btn.btn-lg.' + (danger ? 'btn-danger' : 'btn-primary'), { onclick: () => done(true) }, confirmLabel);
    const wrap = h('div.scrim', { onclick: (e) => { if (e.target === wrap) done(false); }, onkeydown: (e) => { if (e.key === 'Escape') done(false); } },
      h('div.dialog.glass', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', null, title), typeof body === 'string' ? h('p.muted', null, body) : body,
        h('div.row', { style: { justifyContent: 'flex-end', marginTop: '8px' } }, h('button.btn.btn-lg', { onclick: () => done(false) }, cancelLabel), ok)));
    $('overlays').append(wrap); ok.focus();
  });
}

// ---------- boot ----------
const ctx = { bus, world, kit, prefs, manifest: MANIFEST, PHASE_INFO, FAULTS, COMMANDS, selection: null,
  chapters: CHAPTERS,
  get mode() { return prefs.mode === 'advanced' ? 'advanced' : 'demo'; },   // 'demo' shows only the hero; 'advanced' shows everything
  setPref(k, v) { prefs[k] = v; savePrefs(); applyPrefs(); bus.emit('prefs', prefs); if (k === 'mode') { refreshMode(); bus.emit('mode', { mode: ctx.mode }); } },
  setMode(m) { if (m !== ctx.mode) ctx.setPref('mode', m); },
  select(sel) { ctx.selection = sel; bus.emit('select', sel); },
  shell: { toast, confirm: confirmDialog, open: (id, params) => openWorkspace(id, params), current: () => current },
};
window.HOUND = ctx; // for debugging and for the automated checks

const mounted = new Map(); let current = null;

function refreshMode() {
  for (const b of document.querySelectorAll('[data-set-mode]')) b.setAttribute('aria-pressed', String(b.dataset.setMode === ctx.mode));
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))); // the main area changes size
}

function buildChrome() {
  const groups = [...new Set(MANIFEST.map((m) => m.group))];
  $('rail').append(...groups.map((g) => h('div.rail-group', { role: 'group', 'aria-label': g }, h('div.rail-title', null, g),
    ...MANIFEST.filter((m) => m.group === g).map((m) => h('a.rail-item', { href: '#/' + m.id, id: 'rail-' + m.id, title: m.blurb }, icon(m.icon, 18), h('span.rail-label', null, m.title))))));
  $('rail').append(h('div.grow'), h('button.btn.btn-ghost.btn-sm.rail-toggle', { 'aria-label': 'Collapse or expand the workspace list', onclick: () => ctx.setPref('rail', prefs.rail === 'open' ? 'closed' : 'open') }, icon('menu')));

  const play = h('button.btn.btn-icon', { id: 'tb-play', 'aria-label': 'Play or pause the simulation', onclick: () => ctx.sim.toggle() }, icon('play'));
  const speed = h('select.select', { id: 'tb-speed', 'aria-label': 'Simulation speed', style: { width: '74px' }, onchange: (e) => ctx.sim.setSpeed(+e.target.value) }, ...[1, 2, 4, 8, 16, 32].map((x) => h('option', { value: x }, x + '×')));
  const reset = h('button.btn.btn-icon', { 'aria-label': 'Restart the mission from the beginning', title: 'Restart the mission', onclick: () => ctx.sim.reset() }, icon('reset'));
  $('topbar').append(
    h('a.brand', { href: '../', 'aria-label': 'HOUND home' }, h('i'), 'HOUND'),
    h('p.tb-promise.demo-only', null, 'Finds people trapped in collapsed buildings, with a Wi-Fi neural network'),
    h('div.tb-mission', null, h('b', { id: 'tb-phase' }, 'Loading'),
      h('div.tb-track', { id: 'tb-track', role: 'img', 'aria-label': 'Mission progress' }, ...Object.keys(PHASE_INFO).map((p) => h('i', { 'data-phase': p, title: PHASE_INFO[p].label }))),
      h('span.dim', { id: 'tb-hint' }, '')),
    h('div.grow'),
    h('div.tb-group', { title: 'Simulated time. The mission runs faster than real life; the speed is shown.' }, play, reset, speed, h('span.num.tb-clock', { id: 'tb-clock' }, '00:00')),
    h('span.tag.tag-sim', { title: 'The building, people and most sensor readings are simulated. Items marked Live run for real.' }, 'Simulation'),
    h('div.tb-group.tb-unit', { id: 'tb-unit', title: 'HOUND-01 radio link and battery (simulated)' }),
    h('button.btn.tb-search', { 'aria-label': 'Search or run a command', onclick: () => bus.emit('palette:open') }, icon('search'), h('span', null, 'Search or command'), h('kbd', null, '⌘K')),
    h('div.seg.tb-mode', { role: 'group', 'aria-label': 'How much to show' },
      h('button', { 'data-set-mode': 'demo', title: 'Only the essentials, full screen', onclick: () => ctx.setMode('demo') }, 'Demo'),
      h('button', { 'data-set-mode': 'advanced', title: 'Every workspace, control and number', onclick: () => ctx.setMode('advanced') }, 'Advanced')),
    h('button.btn.btn-danger', { id: 'tb-stop', onclick: () => { const S = ctx.sim.state; ctx.sim.command(S.hold ? 'resume' : 'allStop'); } }, icon('stop'), h('span', { id: 'tb-stop-label' }, 'All stop')),
  );
  $('dock').append(
    h('div.dock-note', { title: 'Training exercise. The people, damage and readings are simulated.' }, h('span', null, 'Training exercise, simulated'), h('a', { href: '#/status' }, 'What is real?')),
    h('div.dock-chapters', { role: 'group', 'aria-label': 'Chapters' }, ...CHAPTERS.map((c) => h('a.dock-item' + (c.part ? '.first' : ''), { href: '#/' + c.id, id: 'dock-' + c.id, title: MANIFEST.find((x) => x.id === c.id).blurb }, h('span.dock-part', null, c.part || ''), h('b', null, c.label)))),
    h('div.dock-step', null,
      h('button.btn.btn-icon.btn-ghost', { 'aria-label': 'Previous chapter', onclick: () => stepChapter(-1) }, icon('chevron-left')),
      h('button.btn.btn-primary', { id: 'dock-next', onclick: () => stepChapter(1) }, h('span', { id: 'dock-next-label' }, 'Next'), icon('chevron'))));
  refreshMode();
  $('statusbar').append(h('span', { id: 'sb-event' }, ''), h('div.grow'), h('span.dim', null, 'Training exercise. The people, damage and readings are simulated.'), h('a', { href: '#/status' }, 'What is real?'), h('a', { href: 'ui/reference.html', target: '_blank', rel: 'noopener' }, 'Design reference'));
}

function stepChapter(d) {
  const i = CHAPTERS.findIndex((c) => c.id === current);
  openWorkspace(CHAPTERS[(Math.max(i, 0) + (i < 0 ? 0 : d) + CHAPTERS.length) % CHAPTERS.length].id);
}

function refreshChrome() {
  const S = ctx.sim.state, info = PHASE_INFO[S.phase];
  $('tb-phase').textContent = S.hold ? 'All stop' : info.label;
  $('tb-hint').textContent = S.hold ? 'Every unit is holding. Press Resume to continue.' : info.hint;
  const phases = Object.keys(PHASE_INFO), now = phases.indexOf(S.phase);
  [...$('tb-track').children].forEach((el, i) => { el.classList.toggle('done', i < now); el.classList.toggle('now', i === now); });
  $('tb-track').setAttribute('aria-label', `Mission progress: step ${now + 1} of ${phases.length}, ${info.label}`);
  document.documentElement.dataset.hold = String(!!S.hold);
  $('tb-clock').textContent = fmt.clock(S.t);
  const play = $('tb-play'); play.replaceChildren(icon(S.running ? 'pause' : 'play')); play.setAttribute('aria-pressed', String(S.running));
  if (+$('tb-speed').value !== S.speed) $('tb-speed').value = String(S.speed);
  const r = S.units['HOUND-01'];
  $('tb-unit').replaceChildren(icon('rover'), h('span.num', null, `link ${(r.link * 100).toFixed(0)}%`), h('span.num', { class: r.battery <= 0.15 ? 'bad' : '' }, `battery ${(r.battery * 100).toFixed(0)}%`));
  $('tb-stop-label').textContent = S.hold ? 'Resume' : 'All stop';
  $('tb-stop').classList.toggle('btn-danger', !S.hold); $('tb-stop').classList.toggle('btn-primary', S.hold);
  const last = S.events[S.events.length - 1];
  $('sb-event').textContent = last ? `${fmt.clock(last.t)}  ${last.text}` : 'Ready.';
}

// A dark veil covers the stage while one workspace hands over to the next, so building a scene is never seen.
const reduced = () => document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n) => new Promise((r) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : r()); f(); });
let opening = 0;
async function veil(on) {
  const v = $('veil'); if (reduced()) { v.classList.remove('on'); return; }
  v.classList.toggle('on', on); if (on) await wait(150);
}

async function openWorkspace(id, params = {}) {
  const m = MANIFEST.find((x) => x.id === id) || MANIFEST[0];
  if (current === m.id && mounted.has(m.id)) { mounted.get(m.id).api?.onParams?.(params); return; }
  const token = ++opening, first = !current;
  document.querySelectorAll('.rail-item').forEach((a) => a.setAttribute('aria-current', a.id === 'rail-' + m.id ? 'page' : 'false'));
  document.querySelectorAll('.dock-item').forEach((a) => a.setAttribute('aria-current', a.id === 'dock-' + m.id ? 'page' : 'false'));
  document.documentElement.dataset.ws = m.id;
  const ci = CHAPTERS.findIndex((c) => c.id === m.id), nx = CHAPTERS[(ci + 1) % CHAPTERS.length];
  $('dock-next-label').textContent = ci < 0 ? 'Back to the story' : ci === CHAPTERS.length - 1 ? 'Start again' : nx.label;
  document.title = `${m.title} · HOUND`;
  if (location.hash !== '#/' + m.id) history.replaceState(null, '', '#/' + m.id);
  const label = $('veil-label'); label.textContent = CHAPTERS.find((c) => c.id === m.id)?.label || m.title;
  if (!first) await veil(true);
  if (token !== opening) return;                                   // a newer click won
  if (current && mounted.has(current)) { const prev = mounted.get(current); prev.root.hidden = true; try { prev.api?.onHide?.(); } catch (e) { console.error(e); } }
  current = m.id;
  let rec = mounted.get(m.id);
  if (!rec) {
    const root = h('div.ws', { id: 'ws-' + m.id, 'data-ws': m.id, role: 'region', 'aria-label': m.title });
    root.append(h('div.empty', null, h('div.spinner'), h('p', null, `Opening ${m.title}…`)));
    $('main').append(root); rec = { root, api: null }; mounted.set(m.id, rec);
    try {
      const mod = await import(`./workspaces/${m.id}/index.js`);
      root.replaceChildren();
      const own = { ...ctx, params, manifestEntry: m };
      for (const k of ['selection', 'mode']) Object.defineProperty(own, k, { get: () => ctx[k], set: (v) => { if (k === 'selection') ctx.selection = v; }, configurable: true, enumerable: true });
      rec.api = (await mod.default.mount(root, own)) || {};
    } catch (e) {
      console.error(`[shell] workspace "${m.id}" failed`, e);
      const missing = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(String(e));
      root.replaceChildren(h('div.empty', null, icon('alert', 28), h('h2', null, missing ? `${m.title} is not built yet` : `${m.title} could not start`), h('p.muted', { style: { maxWidth: '520px' } }, missing ? m.blurb : String(e.message || e)), realityTag(m.reality)));
      mounted.delete(m.id); if (current === m.id) rec.failed = true;
    }
  } else { rec.root.hidden = false; rec.api?.onParams?.(params); }
  if (current === m.id) { try { rec.api?.onShow?.(); } catch (e) { console.error(e); } }
  else if (rec.root) rec.root.hidden = true;
  bus.emit('workspace', m.id);
  if (token === opening) { if (!first) await frames(2); veil(false); preloadNext(m.id); }
}

// Fetch the next chapter's code while this one plays, so moving on is instant.
function preloadNext(id) {
  const i = CHAPTERS.findIndex((c) => c.id === id); if (i < 0 || ctx.mode !== 'demo') return;
  const next = CHAPTERS[(i + 1) % CHAPTERS.length].id;
  const go = () => { if (!document.querySelector(`link[data-preload="${next}"]`)) document.head.append(h('link', { rel: 'modulepreload', href: `workspaces/${next}/index.js`, 'data-preload': next })); };
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(go, { timeout: 4000 });
}

async function boot() {
  buildChrome();
  const loading = h('div.empty', { id: 'boot' }, h('div.boot-mark', { 'aria-hidden': 'true' }, h('i'), h('i'), h('b')), h('p.boot-line', { role: 'status' }, 'Loading the neural network, 23,372 numbers'), h('div.bar.indeterminate.boot-bar', null, h('i')));
  $('main').append(loading, h('div', { id: 'veil', 'aria-hidden': 'true' }, h('span', { id: 'veil-label' })));
  let nn;
  try { nn = await loadNN(); }
  catch (e) { loading.replaceChildren(icon('alert', 28), h('h2', null, 'The neural network did not load'), h('p.muted', null, String(e.message || e)), h('button.btn.btn-primary', { onclick: () => location.reload() }, 'Try again')); return; }
  ctx.nn = nn; ctx.sim = createSim({ bus, nn });
  try { const name = localStorage.getItem('hound_operator'); if (name) ctx.sim.command('setOperator', { name }); } catch { /* no storage */ }
  loading.classList.add('out'); setTimeout(() => loading.remove(), 520);
  bus.on('tick', refreshChrome); bus.on('reset', refreshChrome); bus.on('seek', refreshChrome);
  bus.on('event', (ev) => { if (ev.level === 'alert' && current !== 'mission') toast(ev.text, { level: 'alert', ms: 6000 }); });
  window.addEventListener('hashchange', () => openWorkspace(location.hash.replace(/^#\/?/, '').split('?')[0]));
  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); bus.emit('palette:open'); }
    else if (e.key === ' ' && !typing && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); ctx.sim.toggle(); }
    else if (e.key === 'Escape') bus.emit('escape');
    else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && ctx.mode === 'demo' && (e.key === '[' || e.key === ']')) stepChapter(e.key === ']' ? 1 : -1);
  });
  for (const g of GLOBALS) import(`./global/${g}.js`).then((mod) => mod.init?.(ctx)).catch(() => {});
  refreshChrome();
  await openWorkspace(location.hash.replace(/^#\/?/, '').split('?')[0] || (ctx.mode === 'demo' ? CHAPTERS[0].id : 'mission'));
  if (!new URLSearchParams(location.search).has('paused')) ctx.sim.play();
}
boot();
