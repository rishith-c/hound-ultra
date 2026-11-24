// The copilot, reachable from anywhere: a button in the top bar and Cmd/Ctrl+J open it as a side drawer over the
// current workspace. It is the same conversation as the Copilot workspace (one session), in a compact view.
import { getSession } from '../workspaces/copilot/session.js';
import { createChatView } from '../workspaces/copilot/chat.js';
import { layerState } from '../workspaces/copilot/tools.js';

export function init(ctx) {
  const { h, icon } = ctx.kit, bus = ctx.bus;
  if (!document.getElementById('cop-css')) document.head.append(h('link', { id: 'cop-css', rel: 'stylesheet', href: new URL('../workspaces/copilot/style.css', import.meta.url).href }));
  const session = getSession(ctx);
  let drawer = null, chat = null, isOpen = false, lastFocus = null;

  const btn = h('button.btn.btn-icon.cop-dock-btn', { type: 'button', 'aria-label': 'Copilot: ask in plain words (Command or Control J)', title: 'Copilot (⌘J)', 'aria-expanded': 'false', 'aria-controls': 'cop-drawer', onclick: () => toggle() }, icon('copilot'));
  const search = document.querySelector('#topbar .tb-search');
  if (search) { btn.style.order = getComputedStyle(search).order; search.before(btn); } else document.getElementById('topbar')?.append(btn);

  function build() {
    chat = createChatView(ctx, session, { compact: true, onEngine: () => { close(); ctx.shell.open('copilot', { tab: 'engine' }); } });
    drawer = h('aside.cop-drawer', { id: 'cop-drawer', role: 'complementary', 'aria-label': 'Copilot' },
      h('header.cop-drawer-head', null, h('h2', null, 'Copilot'),
        h('button.btn.btn-ghost.btn-sm', { onclick: () => { close(); ctx.shell.open('copilot'); }, title: 'Models, evaluation and the situation report' }, icon('expand'), 'Full view'),
        h('button.btn.btn-ghost.btn-icon.btn-sm', { 'aria-label': 'Close the copilot', onclick: () => close() }, icon('close'))),
      chat.el);
    drawer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen && document.activeElement === document.body && !document.querySelector('.dialog')) close(); }); // a clicked suggestion is removed, which leaves focus on the page
    document.getElementById('overlays').append(drawer);
    void drawer.offsetWidth; // so the first open animates
  }
  function open(o = {}) {
    if (ctx.shell.current() === 'copilot') { if (o.ask) session.ask(o.ask, { via: 'palette' }); else if (o.call) session.runCall(o.call, { via: 'palette', label: o.label }); document.querySelector('#ws-copilot .cop-input')?.focus(); return; }
    if (!drawer) build();
    if (!isOpen) { lastFocus = document.activeElement; isOpen = true; drawer.classList.add('open'); drawer.inert = false; btn.setAttribute('aria-expanded', 'true'); session.checkDevice(); }
    if (o.ask) session.ask(o.ask, { via: 'palette' }); else if (o.call) session.runCall(o.call, { via: 'palette', label: o.label });
    setTimeout(() => chat.focus(), 30);
  }
  function close() {
    if (!isOpen) return; isOpen = false; drawer.classList.remove('open'); drawer.inert = true; btn.setAttribute('aria-expanded', 'false'); session.stopListening();
    if (lastFocus && document.contains(lastFocus) && lastFocus !== document.body) lastFocus.focus?.(); else btn.focus();
  }
  const toggle = () => (isOpen ? close() : open());
  bus.on('copilot:open', (o) => open(o || {}));
  bus.on('copilot:close', close);
  bus.on('twin:ready', () => setTimeout(() => { for (const [id, on] of layerState) bus.emit('twin:layer', { id, on }); }, 0)); // layers asked for before the 3-D view opened; after Mission has applied its own defaults
  bus.on('workspace', (id) => { if (id === 'copilot') close(); });
  window.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') { e.preventDefault(); toggle(); } });
  ctx.copilot = { open, close, toggle, session };
}
