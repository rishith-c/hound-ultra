// Accessibility and offline, for the whole console. Loaded by the shell; System check shows its controls.
//   - text size (prefs.text), applied with CSS zoom on the shell so every layout keeps its proportions
//   - a live region that speaks what matters: a person found, a fault, all stop, the workspace that opened
//   - dialogs: Tab stays inside, the page behind is inert, focus goes back where it was
//   - the keyboard sheet: press ?
//   - the service worker (sw.js): network first, cache only when the network fails. Never on localhost unless ?sw=1.
let ctx = null, polite = null, urgent = null, sheet = null;
export const TEXT_SIZES = [[1, 'Normal'], [1.1, 'Larger'], [1.25, 'Largest']];
export const SHORTCUTS = [
  ['Anywhere', [['Space', 'Play or pause the mission'], ['⌘ K', 'Search, or run a command (Ctrl K on Windows)'], ['?', 'This sheet'], ['Esc', 'Close, go back'], ['Tab', 'Move to the next control'], ['Enter', 'Press the control in focus']]],
  ['Demo', [['[', 'Previous chapter'], [']', 'Next chapter']]],
  ['Maps and pictures', [['+  −', 'Zoom'], ['0', 'Fit to the window'], ['Arrows', 'Move']]],
];

export function announce(text, now = false) { const el = now ? urgent : polite; if (!el) return; el.textContent = ''; setTimeout(() => { el.textContent = text; }, 60); }

export function init(c) {
  ctx = c; const { h } = ctx.kit, d = document;
  polite = h('div.sr-only', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', id: 'a11y-polite' }); urgent = h('div.sr-only', { role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'true', id: 'a11y-urgent' }); d.body.append(polite, urgent);
  if (!d.querySelector('link[rel="manifest"]')) d.head.append(h('link', { rel: 'manifest', href: '../manifest.webmanifest' }));
  const style = d.createElement('style'); style.textContent = [
    ':root[data-text="1.1"] #shell { zoom: 1.1; height: calc(100vh / 1.1); } :root[data-text="1.25"] #shell { zoom: 1.25; height: calc(100vh / 1.25); }',
    ':root[data-text="1.1"] .dialog, :root[data-text="1.1"] .toast { zoom: 1.1; } :root[data-text="1.25"] .dialog, :root[data-text="1.25"] .toast { zoom: 1.25; }',
    '.a11y-sheet { width: min(720px, calc(100vw - 32px)); } .a11y-keys { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 36px; margin-top: 6px; } .a11y-keys h3 { color: var(--text-2); padding-bottom: 7px; border-bottom: 1px solid var(--line-2); } .a11y-keys section:first-child { grid-row: span 2; } .a11y-keys dl { margin: 0; display: grid; grid-template-columns: 84px 1fr; } .a11y-keys dt, .a11y-keys dd { margin: 0; padding: 7px 0; border-bottom: 1px solid var(--line); line-height: 18px; }',
  ].join('\n'); d.head.append(style);
  const text = () => { const v = TEXT_SIZES.some(([x]) => x === ctx.prefs.text) ? ctx.prefs.text : 1, was = d.documentElement.dataset.text; d.documentElement.dataset.text = String(v); if (was && was !== String(v)) requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))); };
  text(); ctx.bus.on('prefs', text);

  // The shell shows alerts as role="alert" toasts outside Mission, so those are spoken there and not repeated here.
  const SAY = new Set(['PERSON_FOUND', 'POSSIBLE_PERSON', 'LEAD_CLOSED', 'ROUTE_PLANNED', 'ROUTE_APPROVED', 'WINDOW_REJECTED', 'CSI_UNAVAILABLE', 'REPLANNED', 'NO_PATH', 'BATTERY_LOW', 'BATTERY_SWAPPED', 'FAULT', 'FAULT_CLEARED', 'ALL_STOP', 'RESUMED', 'NEW_HAZARD', 'TEAM_ARRIVED', 'TEAM_FOUND_NO_ONE', 'MISSION_COMPLETE']);
  ctx.bus.on('event', (e) => { if (!SAY.has(e.code)) return; const alert = e.level === 'alert'; if (alert && ctx.shell.current() !== 'mission') return; announce(e.text, alert); });
  ctx.bus.on('workspace', (id) => { const m = ctx.manifest.find((x) => x.id === id); if (m) announce(m.title + '. ' + m.blurb); });

  const top = () => [...d.querySelectorAll('[aria-modal="true"]')].filter((x) => x.getClientRects().length).pop();
  const focusable = (el) => [...el.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((x) => x.getClientRects().length);
  d.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(d.activeElement?.tagName) || d.activeElement?.isContentEditable;
    if (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey && !top()) { e.preventDefault(); openSheet(); return; }
    if (e.key !== 'Tab') return; const dlg = top(); if (!dlg) return; const f = focusable(dlg); if (!f.length) return;
    if (!dlg.contains(d.activeElement)) { e.preventDefault(); f[0].focus(); } else if (e.shiftKey && d.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && d.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }, true);
  const overlays = d.getElementById('overlays'), shell = d.getElementById('shell');
  if (overlays && shell) new MutationObserver(() => { shell.inert = !!overlays.querySelector('[aria-modal="true"]'); }).observe(overlays, { childList: true, subtree: true });
  // "What is real?" in the bars opens the ledger, not the first view of System check.
  d.addEventListener('click', (e) => { const a = e.target.closest?.('a[href="#/status"]'); if (!a || !a.closest('#dock, #statusbar')) return; asked.view = 'real'; ctx.bus.emit('status:view', 'real'); }, true);
  if (window.top === window) startOffline();
}
export const asked = { view: null };

export function openSheet() {
  if (sheet || !ctx) return; const { h } = ctx.kit, prev = document.activeElement;
  const close = () => { sheet?.remove(); sheet = null; document.getElementById('shell').inert = false; prev?.focus?.(); };
  const btn = h('button.btn.btn-lg.btn-primary', { onclick: close }, 'Close');
  sheet = h('div.scrim', { onclick: (e) => { if (e.target === sheet) close(); }, onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } } },
    h('div.dialog.glass.a11y-sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard shortcuts' }, h('h2', null, 'Keyboard'),
      h('div.a11y-keys', null, ...SHORTCUTS.map(([g, rows]) => h('section', null, h('h3', null, g), h('dl', null, ...rows.flatMap(([k, t]) => [h('dt', null, h('kbd', null, k)), h('dd', null, t)]))))),
      h('div.row', { style: { justifyContent: 'flex-end' } }, btn)));
  document.getElementById('overlays').append(sheet); btn.focus();
}

// ---------- offline ----------
// state: 'starting' | 'unsupported' | 'local' | 'online' | 'ready' | 'error'
const off = { state: 'starting', files: 0, total: 0, done: 0, failed: 0, message: '', version: '' }, subs = new Set();
export const offline = { get state() { return { ...off, online: navigator.onLine }; }, on(fn) { subs.add(fn); return () => subs.delete(fn); }, saveAll };
const tell = (o) => { Object.assign(off, o); for (const f of subs) f(offline.state); };
const isLocal = () => /^(localhost$|127\.|\[::1\]|0\.0\.0\.0)/.test(location.hostname);
async function startOffline() {
  addEventListener('online', () => tell({})); addEventListener('offline', () => tell({}));
  if (!('serviceWorker' in navigator) || !('caches' in window)) return tell({ state: 'unsupported' });
  if (isLocal() && !new URLSearchParams(location.search).has('sw')) return tell({ state: 'local' });
  if (document.readyState !== 'complete') await new Promise((r) => addEventListener('load', r, { once: true }));
  try {
    navigator.serviceWorker.addEventListener('message', (e) => { const m = e.data || {}; if (m.type === 'saved') tell({ done: m.done, total: m.total, failed: m.failed }); if (m.type === 'count') tell({ files: m.files, version: m.version, state: m.ready ? 'ready' : 'online' }); });
    const reg = await navigator.serviceWorker.register('../sw.js', { scope: '../', updateViaCache: 'none' }); await navigator.serviceWorker.ready; reg.update?.().catch(() => {});
    tell({ state: 'online' }); await new Promise((r) => setTimeout(r, 4000)); await saveLoaded();
  } catch (e) { tell({ state: 'error', message: String(e.message || e) }); }
}
const wanted = (u) => { try { const x = new URL(u, location.href); return x.origin === location.origin && !x.search.includes('fresh=') && !/\.mp4$/.test(x.pathname); } catch { return false; } };
async function post(urls) { const w = (await navigator.serviceWorker.ready).active; tell({ total: urls.length, done: 0, failed: 0 }); w.postMessage({ type: 'save', urls }); }
// What this page has already loaded, so opening it again works with no network.
const saveLoaded = () => post([...new Set([location.href.split('#')[0].split('?')[0], new URL('../', location.href).href, ...performance.getEntriesByType('resource').map((r) => r.name).filter(wanted)])]);
// Every workspace: follow each import and asset reference from the console's own files, then save them all.
async function saveAll() {
  if (!['online', 'ready'].includes(off.state)) return false;
  const seen = new Set(), base = new URL('./', location.href), at = (p) => new URL(p, base).href;
  const queue = [at('./'), at('../'), at('shell.js'), at('../data/nn.json'), ...ctx.manifest.map((m) => at('workspaces/' + m.id + '/index.js')), ...['palette', 'copilot-dock', 'narration', 'a11y', 'sound', 'intro', 'story'].map((g) => at('global/' + g + '.js'))];
  const map = JSON.parse(document.querySelector('script[type="importmap"]')?.textContent || '{"imports":{}}').imports;
  const REF = /(?:from\s*|import\s*\(\s*|import\s+|new URL\(\s*|file:\s*|href=|src=|url\()\s*["'\x60]?([^"'\x60)\s>]+)/g;
  while (queue.length) {
    const u = queue.shift().split('#')[0]; if (seen.has(u) || !wanted(u)) continue; seen.add(u); tell({ message: 'Finding files: ' + seen.size });
    if (!/(\.js|\.mjs|\.css|\.html|\/|\+esm)$/.test(u.split('?')[0])) continue;
    let src; try { const r = await fetch(u); if (!r.ok) { seen.delete(u); continue; } src = await r.text(); } catch { seen.delete(u); continue; }
    for (const m of src.matchAll(REF)) {
      const s = m[1]; let t = null; if (/[{}$*\\]/.test(s)) continue;
      if (/^(\.{1,2}\/|\/)/.test(s)) t = s; else if (map[s]) t = new URL(map[s], base).href; else { const p = Object.keys(map).find((k) => k.endsWith('/') && s.startsWith(k)); if (p) t = new URL(map[p] + s.slice(p.length), base).href; else if (/^[\w./-]+\.(css|js|webp|jpg|png|svg|woff2|json|bin|glb)$/.test(s)) t = s; }
      if (t) try { queue.push(new URL(t, u).href); } catch { /* not an address */ }
    }
  }
  tell({ message: '' }); await post([...seen]); return true;
}
