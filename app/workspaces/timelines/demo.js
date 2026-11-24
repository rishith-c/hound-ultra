// Timelines, Demo: the overlay on the braid (title, caption, three figures, world names) and the background replay check.
import { createBraid, HOLD_AT, STORY_END, storyAt } from './braid.js';
import { clock } from './model.js';

export function mountDemo(root, { ctx, pool }) {
  const { kit } = ctx, { h, icon, realityTag } = kit;
  let canvas = h('canvas.tl-hero', { role: 'img', tabindex: '-1', 'aria-label': 'Five runs of the same rescue drawn as strands of light that split where one decision differs. Height is mission time.' });
  const labels = h('div.tl-labels'), cap = h('p.tl-cap', { 'aria-live': 'polite' }), capNote = h('p.tl-cap-note');
  const clockEl = h('b', null, '00:00'), worldsEl = h('b', null, '1'), verEl = h('b', null, '…'), verNote = h('span', null, 'replays matched here');
  const playBtn = h('button.btn.btn-ghost.btn-icon', { type: 'button', 'aria-label': 'Pause', onclick: () => setPlay(!playing) }, icon('pause'));
  const scrub = h('input.slider.tl-hero-scrub', { type: 'range', min: 0, max: STORY_END, step: 0.05, value: 0, 'aria-label': 'Story position', oninput: (e) => { back(); braid?.seek(+e.target.value); setPlay(false); } });
  const backBtn = h('button.btn.btn-ghost.tl-hero-back', { type: 'button', hidden: true, onclick: () => back() }, icon('arrow-left'), 'All five worlds');
  const loading = h('div.tl-hero-load', null, h('div.spinner'), h('span', null, 'Laying out five worlds'));
  const el = h('section.demo-only.tl-demo', { 'aria-label': 'Timelines' }, canvas, h('div.tl-vig', { 'aria-hidden': 'true' }), labels, loading,
    h('div.tl-title', null, h('h1', null, 'One mission, five worlds'), h('p', null, 'The same rescue, replayed with one thing changed. Height is time.'), h('div.row', null, realityTag('live-algo'), realityTag('sim')), h('button.btn.btn-primary', { type: 'button', onclick: () => ctx.setMode('advanced') }, icon('route'), 'Fork it yourself')),
    h('div.tl-capwrap', null, cap, capNote),
    h('div.tl-figs', null, h('div', null, clockEl, h('span', null, 'mission clock')), h('div', null, worldsEl, h('span', null, 'worlds')), h('div.tl-fig-ver', null, verEl, verNote)),
    h('div.tl-hero-bar', null, backBtn, playBtn, scrub));
  root.append(el);
  let braid = null, set = null, tMax = 0, playing = true, visible = false, btns = [], lastCap = '', lastT = -1, lastN = -1, checked = false, building = null, lastScrub = -1;
  const setText = (n, s) => { if (n.textContent !== s) n.textContent = s; };
  function setPlay(on) { playing = on; braid?.play(on); playBtn.replaceChildren(icon(on ? 'pause' : 'play')); playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play'); }
  function focus(i) { if (!braid || i < 0) return; braid.focus(i); backBtn.hidden = false; el.classList.add('is-focus'); btns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i))); }
  function back() { if (!braid || braid.st.focus < 0) return; braid.focus(-1); backBtn.hidden = true; el.classList.remove('is-focus'); btns.forEach((b) => b.setAttribute('aria-pressed', 'false')); }
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') back(); else if (e.key === ' ' && e.target === canvas) { e.preventDefault(); setPlay(!playing); } });
  const win = (e) => { if (e.key === 'Escape' && visible && !el.hidden) back(); }; addEventListener('keydown', win);

  const many = (k, N) => k + ' of ' + N + ' reached';
  function caption(s) {
    const W = s.worlds, F = W[s.focus]; if (F) return [F.name + ': ' + many(F.finalReached, F.total) + ' by ' + clock(F.endT) + '.', F.finalReached < F.total ? 'Scored against ground truth, in simulation.' : ''];
    if (s.hold > 0.35) { const best = W.reduce((a, b) => (b.finalReached > a.finalReached ? b : a)), worst = W.reduce((a, b) => (b.finalReached < a.finalReached ? b : a)); return [best.name + ': ' + many(best.finalReached, best.total) + '. ' + worst.name + ': ' + worst.finalReached + ' of ' + worst.total + '.', 'Scored against ground truth, in simulation.']; }
    let last = null; for (const w of W) if (w.i && s.t >= w.forkT - 0.5 && s.t < w.forkT + 46 && (!last || w.forkT > last.forkT)) last = w;
    if (last) return [clock(last.forkT) + '  ' + last.name + '. A world splits off.', ''];
    return [s.t < 104 ? 'The drone maps the site.' : s.t < 200 ? 'The rover drives in.' : s.t < 420 ? 'It stops, and listens through walls.' : s.t < 480 ? 'A second look at every uncertain lead.' : 'The team goes in.', ''];
  }
  function onState(s) {
    const tt = s.focus >= 0 ? s.worlds[s.focus].endT : Math.floor(s.t); if (tt !== lastT) { lastT = tt; setText(clockEl, clock(Math.min(tt, tMax))); }
    let nOn = 0; for (const w of s.worlds) if (w.i === 0 || s.t >= w.forkT) nOn++; if (nOn !== lastN) { lastN = nOn; setText(worldsEl, String(nOn)); }
    const c = caption(s); if (c[0] !== lastCap) { lastCap = c[0]; cap.textContent = c[0]; capNote.textContent = c[1]; cap.classList.remove('in'); void cap.offsetWidth; cap.classList.add('in'); }
    for (let i = 0; i < btns.length; i++) {
      const w = s.worlds[i], b = btns[i], early = w.i && s.t < w.forkT + 4, show = s.focus >= 0 ? s.focus === i : w.on && !early && nOn > 1 && w.depth < 1 && w.y > 46 && w.x > 90 && w.x < s.vw - 90;
      if (b._show !== show) { b._show = show; b.classList.toggle('on', show); b.tabIndex = show ? 0 : -1; }
      if (show) b.style.transform = 'translate3d(' + w.x.toFixed(1) + 'px,' + w.y.toFixed(1) + 'px,0) translate(-50%,-100%)';
      const key = w.reached + (w.ended ? 'e' : '') + (s.hold > 0.35 ? 'h' : ''); if (b._key !== key) { b._key = key; for (let p = 0; p < 3; p++) b._pips[p].className = p < w.reached ? 'on' : s.hold > 0.35 ? 'lost' : ''; b.classList.toggle('lost', s.hold > 0.35 && w.finalReached < w.total); b.classList.toggle('best', s.hold > 0.35 && w.best); setText(b._sub, w.ended || s.hold > 0.35 ? (w.best ? 'Best of five · ' : '') + many(w.finalReached, w.total) + ' · ' + clock(w.endT) : ''); }
    }
    if (Math.abs(s.u - lastScrub) > 0.08) { lastScrub = s.u; if (document.activeElement !== scrub || playing) scrub.value = s.u; scrub.style.setProperty('--p', (100 * s.u) / STORY_END + '%'); }
  }
  function build(data) {
    set = data; tMax = Math.max(...data.worlds.map((w) => w.endT)); btns.forEach((b) => b.remove()); btns = [];
    return createBraid(canvas, data, { onState, onPick: (i) => (i >= 0 ? focus(i) : back()), reduced: kit.reducedMotion }).then((b) => {
      braid = b; btns = b.worlds.map((w, i) => { const pips = [0, 1, 2].map(() => h('i')), sub = h('small'), x = h('button.tl-wl', { type: 'button', 'aria-pressed': 'false', 'aria-label': w.name + ', go to this world', onclick: () => (b.st.focus === i ? back() : focus(i)) }, h('span.tl-wl-n', null, w.name, h('span.tl-pips', { 'aria-hidden': 'true' }, ...pips)), sub); x._pips = pips; x._sub = sub; x._show = false; x.tabIndex = -1; return x; }); labels.append(...btns);
      loading.remove(); el.classList.add('ready'); el._braid = b;
      const u = new URLSearchParams(location.hash.split('?')[1] || '').get('u'); if (u != null) { b.seek(+u); }
      if (visible) b.start(); if (kit.reducedMotion()) setPlay(false);
    });
  }
  // The saved worlds are played at once; the same five missions are then run here and their fingerprints compared.
  async function check() {
    if (checked) return; checked = true; verNote.textContent = 'replays running here';
    try {
      const { computeSet } = await import('./forkset.js'); let k = 0; setText(verEl, '0/5');
      const fresh = await computeSet(pool(), () => setText(verEl, ++k + '/5')), same = fresh.worlds.filter((w, i) => set.worlds[i] && w.hash === set.worlds[i].hash).length;
      setText(verEl, same + '/' + fresh.worlds.length); verNote.textContent = 'replays matched here'; el.querySelector('.tl-fig-ver').classList.toggle('ok', same === fresh.worlds.length);
      if (same !== fresh.worlds.length) { verNote.textContent = 'saved replays were out of date'; await rebuild(fresh); }
    } catch (e) { setText(verEl, '–'); verNote.textContent = 'replay check did not run'; console.warn('[timelines] replay check:', e); }
  }
  // If the simulator has changed since braid.json was saved, show what it does now.
  async function rebuild(data) { braid?.dispose(); braid = null; const c = canvas.cloneNode(false); canvas.replaceWith(c); canvas = c; await build(data); }
  el._rebuild = () => rebuild(set);
  const offPrefs = ctx.bus.on('prefs', () => { if (visible && braid) { braid.stop(); if (kit.reducedMotion()) setPlay(false); braid.start(); } });
  const api = {
    el, get braid() { return braid; },
    show() { if (visible) return; visible = true; if (!building) building = fetch(new URL('./braid.json', import.meta.url)).then((r) => { if (!r.ok) throw new Error('saved worlds: ' + r.status); return r.json(); }).catch(async () => { const { computeSet } = await import('./forkset.js'); return computeSet(pool()); }).then(build).then(() => setTimeout(() => visible && check(), 5000)).catch((e) => { console.warn('[timelines] hero:', e); loading.replaceChildren(icon('alert'), h('span', null, 'The 3-D view could not start on this device. Advanced still works.')); }); else { braid?.start(); if (!checked && braid) setTimeout(() => visible && check(), 3000); } },
    hide() { visible = false; braid?.stop(); },
    dispose() { removeEventListener('keydown', win); offPrefs(); braid?.dispose(); },
  };
  return api;
}
