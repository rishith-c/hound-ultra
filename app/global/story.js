// The story plays itself. After Begin, each Demo chapter runs for its own length and hands over to the next, so the whole
// thing can be watched like a film. Touching the scene stops it; Play starts it again. A chapter may hand over sooner by
// emitting 'chapter:done'. Never starts by itself for anyone who prefers reduced motion. ?story=1 starts it at once.
const SECS = { area: 32, radio: 24, forge: 28, sense: 23, rover: 25, fusion: 34, status: 38, aerial: 76, scan: 46, swarm: 60, structure: 58, horizon: 110 };
const MISSION_END = 690, MISSION_HOLD = 6;   // simulated seconds a mission takes, and how long the last picture is held

export function init(ctx) {
  const { bus, kit, chapters } = ctx, { h, icon } = kit, root = document.documentElement;
  let on = false, t = 0, shown = null, held = 0, last = 0, raf = 0;
  const btn = h('button.btn.btn-icon.btn-ghost', { id: 'dock-play', onclick: () => set(!on) });
  document.querySelector('.dock-step')?.prepend(btn);
  const css = document.createElement('style');
  css.textContent = `
  .dock-item::after { content: ""; position: absolute; left: 0; top: 0; width: 100%; height: 2px; background: var(--accent); transform: scaleX(0); transform-origin: 0 0; }
  :root[data-story="on"] .dock-item[aria-current="page"]::before { background: var(--line-3); }
  :root[data-story="on"] .dock-item[aria-current="page"]::after { transform: scaleX(var(--p, 0)); }`;
  document.head.append(css);

  const at = () => chapters.findIndex((c) => c.id === ctx.shell.current());
  function paint() {
    btn.replaceChildren(icon(on ? 'pause' : 'play'));
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Stop the story here' : 'Play the whole story';
    btn.setAttribute('aria-label', btn.title);
    if (on) root.dataset.story = 'on'; else delete root.dataset.story;
  }
  function set(v) {
    if (v === on) return;
    on = v; t = 0; held = 0; paint(); bus.emit('story', { on });
    cancelAnimationFrame(raf);
    if (!on) return;
    if (at() < 0) ctx.shell.open(chapters[0].id);
    last = performance.now(); raf = requestAnimationFrame(frame);
  }
  function next() {
    const i = at();
    if (i < 0 || i === chapters.length - 1) return set(false);
    t = 0; held = 0; shown = null; ctx.shell.open(chapters[i + 1].id);
  }
  function frame(now) {
    if (!on) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    const id = ctx.shell.current();
    if (shown !== id || document.hidden || root.dataset.intro || document.querySelector('.scrim, [aria-modal="true"]')) return;
    t += dt;
    let p; const clip = ctx.shell.clip(id);            // a recording plays once through
    if (clip) { p = Math.min(1, t / clip); if (p >= 1) return next(); }
    else if (id === 'mission') {
      const S = ctx.sim.state;
      if (S.phase === 'complete') held += dt;
      p = S.phase === 'complete' ? 1 : Math.min(0.99, S.t / MISSION_END);
      if (held > MISSION_HOLD || t > 180) return next();
    } else {
      p = Math.min(1, t / (SECS[id] || 36));
      if (p >= 1) return next();
    }
    document.getElementById('dock-' + id)?.style.setProperty('--p', p.toFixed(4));
  }
  bus.on('workspace', (id) => { shown = id; t = 0; held = 0; document.getElementById('dock-' + id)?.style.setProperty('--p', '0'); });
  bus.on('chapter:done', () => { if (on && t > 8) next(); });
  bus.on('mode', () => set(false));
  bus.on('intro:done', () => { if (!kit.reducedMotion()) set(true); });
  for (const type of ['pointerdown', 'wheel']) document.getElementById('main').addEventListener(type, () => set(false), { capture: true, passive: true });
  ctx.story = { get on() { return on; }, set };
  shown = ctx.shell.current(); paint();
  if (new URLSearchParams(location.search).get('story') === '1') set(true);
}
