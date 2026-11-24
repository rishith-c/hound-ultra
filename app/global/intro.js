// The opening title of Demo mode: what HOUND is, in three lines, once per visit. Skipped with ?intro=0, in Advanced,
// and for anyone who prefers reduced motion (the lines simply appear).
const LINES = ['People get trapped under rubble.', 'Wi-Fi passes through walls. A living body changes it.', 'We built a neural network that finds them.'];
export function init(ctx) {
  const q = new URLSearchParams(location.search);
  let seen = false; try { seen = sessionStorage.getItem('hound.intro') === '1'; } catch { /* no storage */ }
  if (ctx.mode !== 'demo' || q.get('intro') === '0' || q.has('paused') || (seen && q.get('intro') !== '1') || (ctx.deepLink && q.get('intro') !== '1')) return;
  try { sessionStorage.setItem('hound.intro', '1'); } catch { /* no storage */ }
  const { h } = ctx.kit;
  const begin = h('button.btn.btn-primary.btn-lg', { onclick: () => close() }, 'Begin');
  const el = h('div.intro', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'What HOUND does' },
    h('div.intro-copy', null, ...LINES.map((t, i) => h('p', { style: { '--i': i } }, t)),
      h('div.intro-act', null, begin, h('span', null, 'The rover is built. Every result shown here is from simulation.'))));
  const css = document.createElement('style');
  css.textContent = `
  .intro { position: fixed; inset: 0; z-index: var(--z-modal); display: grid; align-items: end; padding: 0 64px 92px; background: linear-gradient(180deg, rgba(6,8,10,.10) 0%, rgba(6,8,10,.06) 42%, rgba(6,8,10,.78) 100%); transition: opacity 900ms var(--ease-in-out); }
  :root[data-intro] #topbar, :root[data-intro] #dock { opacity: 0; pointer-events: none; }
  #topbar, #dock { transition: opacity 900ms var(--ease-in-out); }
  :root[data-intro] #main :not(canvas):not(:has(canvas)) { opacity: 0 !important; }
  .intro.out { opacity: 0; pointer-events: none; }
  .intro p { margin: 0 0 14px; max-width: 24em; font: 400 clamp(34px, 3.4vw, 58px)/1.04 var(--font-display); color: var(--text); opacity: 0; transform: translateY(10px); animation: intro-in 900ms var(--ease) forwards; animation-delay: calc(350ms + var(--i) * 1500ms); }
  .intro p:nth-child(3) { color: var(--person); }
  .intro-act { display: flex; align-items: center; gap: 20px; margin-top: 26px; opacity: 0; animation: intro-in 700ms var(--ease) forwards; animation-delay: 4600ms; }
  .intro-act span { color: var(--text-2); font-size: var(--fs-14); }
  @keyframes intro-in { to { opacity: 1; transform: none; } }
  :root[data-motion="reduce"] .intro p, :root[data-motion="reduce"] .intro-act { animation: none; opacity: 1; transform: none; }
  @media (prefers-reduced-motion: reduce) { .intro p, .intro-act { animation: none; opacity: 1; transform: none; } }`;
  document.documentElement.dataset.intro = '1'; document.head.append(css); document.body.append(el); begin.focus({ preventScroll: true });
  const key = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', key);
  let done = false;
  function close() { if (done) return; done = true; window.removeEventListener('keydown', key); el.classList.add('out'); delete document.documentElement.dataset.intro; setTimeout(() => { el.remove(); css.remove(); }, 920); ctx.bus.emit('intro:done'); }
  setTimeout(close, 14000);
}
