// Showcase: in Advanced, a small panel that opens the Demo's best pictures, for anyone who skipped the demo.
const TILES = [['aerial', 'Drone eyes', 'Colour, heat, laser and Wi-Fi from the air'], ['scan', 'Inside the rubble', 'Where someone could survive'], ['swarm', 'Many rovers', 'One search, eight machines'], ['structure', 'The collapse', 'Test a lift before anyone lifts'], ['horizon', 'The horizon', 'Ten ideas from real research'], ['mission', 'The search', 'A whole mission, start to finish']];
export function init(ctx) {
  const { h, icon } = ctx.kit, bar = document.getElementById('statusbar'); if (!bar) return;
  const css = document.createElement('style');
  css.textContent = `
  #sc-btn { display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 10px; border: 1px solid var(--accent-line, rgba(90,169,255,.5)); border-radius: 3px; background: rgba(90,169,255,.12); color: var(--text); font: 600 12px/1 var(--font); cursor: pointer; }
  #sc-btn:hover { background: rgba(90,169,255,.22); }
  #sc { position: fixed; right: 12px; bottom: 34px; z-index: var(--z-modal); width: min(620px, calc(100vw - 24px)); padding: 16px; border: 1px solid var(--line-2); border-radius: 4px; background: rgba(9,12,16,.96); box-shadow: 0 24px 70px rgba(0,0,0,.6); }
  #sc header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; } #sc h3 { margin: 0; font: 400 24px/1 var(--font-display); } #sc header p { margin: 0; color: var(--text-2); font-size: 13px; } #sc header button { margin-left: auto; }
  #sc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .sc-tile { position: relative; padding: 0; border: 1px solid var(--line-2); border-radius: 3px; overflow: hidden; background: #06080a; color: var(--text); text-align: left; cursor: pointer; aspect-ratio: 16 / 11; }
  .sc-tile img, .sc-tile video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; } .sc-tile video { opacity: 0; transition: opacity 240ms; } .sc-tile video.on { opacity: 1; }
  .sc-tile:hover, .sc-tile:focus-visible { border-color: var(--accent); }
  .sc-tile span { position: absolute; left: 0; right: 0; bottom: 0; padding: 22px 10px 9px; background: linear-gradient(0deg, rgba(4,6,8,.92), rgba(4,6,8,0)); font: 400 18px/1.1 var(--font-display); } .sc-tile em { display: block; margin-top: 3px; font: 400 11.5px/1.25 var(--font); color: var(--text-2); }`;
  document.head.append(css);
  const btn = h('button', { id: 'sc-btn', type: 'button', 'aria-expanded': 'false', onclick: () => (panel ? close() : open()) }, icon('play', 12), 'Showcase');
  bar.querySelector('a')?.before(btn);
  let panel = null;
  const film = (id, ext) => new URL('../../film/' + id + ext, import.meta.url).href;
  function tile([id, name, line]) {
    let v = null;
    const el = h('button.sc-tile', { type: 'button', onclick: () => { close(); ctx.setMode('demo'); ctx.shell.open(id); } }, h('img', { src: film(id, '.jpg'), alt: '', loading: 'lazy' }), h('span', null, name, h('em', null, line)));
    const play = () => { if (!v) { v = h('video', { src: film(id, '.mp4'), loop: true, preload: 'auto' }); v.muted = true; v.playsInline = true; v.addEventListener('playing', () => v.classList.add('on')); el.querySelector('img').after(v); } v.play().catch(() => {}); };
    el.addEventListener('pointerenter', play); el.addEventListener('focus', play);
    el.addEventListener('pointerleave', () => { v?.pause(); v?.classList.remove('on'); });
    return el;
  }
  function open() {
    if (panel) return;
    panel = h('div', { id: 'sc', role: 'dialog', 'aria-label': 'Showcase' }, h('header', null, h('h3', null, 'Showcase'), h('p', null, 'The pictures to see first. Each opens full screen.'), h('button.btn.btn-icon.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Close the showcase', onclick: close }, icon('close', 14))), h('div', { id: 'sc-grid' }, TILES.map(tile)));
    document.body.append(panel); btn.setAttribute('aria-expanded', 'true');
  }
  function close() { panel?.remove(); panel = null; btn.setAttribute('aria-expanded', 'false'); }
  ctx.bus.on('escape', close);
  let shown = false;
  const look = () => { if (ctx.mode !== 'advanced') { close(); return; } let seen = shown; try { seen ||= sessionStorage.getItem('hound.showcase') === '1'; } catch { /* no storage */ } if (seen || new URLSearchParams(location.search).has('paused') || new URLSearchParams(location.search).get('intro') === '0') return; shown = true; try { sessionStorage.setItem('hound.showcase', '1'); } catch { /* no storage */ } setTimeout(() => { if (ctx.mode === 'advanced') open(); }, 1800); };
  ctx.bus.on('mode', look); look();
}
