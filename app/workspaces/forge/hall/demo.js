// Demo mode of the forge: the hall, its words and its controls.
import { loadHall, createHall, personFacts, LOOP, HOLD } from './hall.js';

export function createDemo(root, ctx, openTrainer) {
  const { h, realityTag, reducedMotion } = ctx.kit;
  const canvas = h('canvas.forge-hall-c', { tabindex: 0, role: 'img', 'aria-label': 'A dark hall holding the 900 simulated people of the training set. Each one the network finds glows from within. Drag or use the arrow keys to look around, Space to pause.' });
  const step = h('b.num', null, '0'), found = h('b.num', null, '–'), line = h('p.forge-hall-line'), cap = h('p.forge-hall-cap', { role: 'status', 'aria-live': 'off' });
  const tip = h('div.forge-hall-tip', { hidden: true }), labM = h('div.forge-hall-lab', null, h('b', null, 'Walking'), h('span')), labS = h('div.forge-hall-lab', null, h('b', null, 'Still'), h('span')), labD = h('div.forge-hall-lab.dim', null, h('span', null, 'Raised floor: never trained on'));
  const btn = h('button.btn.btn-primary', { onclick: () => openTrainer() }, 'Train it live on this computer');
  const el = h('section.forge-hall.demo-only', { 'aria-label': 'The training' }, canvas, h('div.forge-hall-shade'), labM, labS, labD,
    h('div.forge-hall-text', null, h('div.forge-hall-tags', null, h('span.tag', { title: 'The project’s own training code, run again with its own seed and recorded at 26 steps. The model at each step judged every person on their own windows.' }, 'Recorded run'), realityTag('sim')),
      h('h2', null, 'Trained on people who never existed'), line, btn),
    h('div.forge-hall-figs', null, cap, h('div.forge-hall-row', null, h('div', null, step, h('span', null, 'training step')), h('div', null, h('span.forge-hall-big', null, found, h('small', null, '%')), h('span', null, 'moving people found'), h('i', null, 'held out, in simulation')))), tip);
  root.append(el);
  const L1 = '900 simulated people taught it what a living body does to Wi-Fi.', L2 = 'It learned to find people who move. Radar and heat join for those who lie still.';
  line.textContent = L1;
  let D = null, hall = null, raf = 0, visible = false, last = 0, failed = false, curLine = 0, curCap = '', curC = -1, starting = null; const cs = getComputedStyle(document.documentElement);
  const setCap = (s) => { if (s === curCap) return; curCap = s; cap.style.opacity = 0; setTimeout(() => { cap.textContent = curCap; cap.style.opacity = 1; }, 160); };
  const setLine = (i) => { if (i === curLine) return; curLine = i; line.style.opacity = 0; setTimeout(() => { line.textContent = curLine ? L2 : L1; line.style.opacity = 1; }, 260); };
  const size = () => { const r = el.getBoundingClientRect(); if (hall && r.width > 10) hall.resize(Math.round(r.width), Math.round(r.height)); };
  const a = { x: 0, y: 0, ok: false };
  const place = (n, x, y, z, o) => { hall.project(x, y, z, a); n.style.transform = 'translate3d(' + a.x.toFixed(1) + 'px,' + a.y.toFixed(1) + 'px,0)'; n.style.opacity = a.ok ? o : 0; };
  function words() {
    const t = hall.t, c = Math.min(D.steps.length - 1, Math.floor(hall.ck + 1e-6));
    if (c !== curC) { curC = c; step.textContent = D.steps[c]; found.textContent = (D.stats[c].test.moving * 100).toFixed(1); const s = D.stats[c].test; labM.lastChild.textContent = Math.round(s.moving * 100) + ' % found'; labS.lastChild.textContent = 'radar and heat join in'; }
    setLine(t > 21 ? 1 : 0);
    setCap(t < 2.3 ? 'One of them. Wi-Fi passes through.' : t < 5.5 ? 'The pattern comes out changed.' : t < 7.1 ? 'Step 0. It has learned nothing yet.' : t < 12.6 ? 'Every person sends their own pattern.' : t < 21 ? 'Each step, it judges all 900 again.' : 'Everyone it finds glows.');
    const o = Math.min(1, Math.max(0, (t - 13.5) / 1.5)) * (t > LOOP - 1 ? Math.max(0, LOOP - t) : 1); place(labM, 21, 5.6, -64, o); place(labS, -21, 5.6, -64, o); place(labD, 0, 0, 2.2, t > 20 ? o * 0.9 : 0);
  }
  function tick(now) { raf = requestAnimationFrame(tick); const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now; hall.frame(dt); words(); }
  function run() { if (!hall || raf || !visible || ctx.mode !== 'demo') return; size(); if (reducedMotion()) { hall.seek(HOLD); words(); return; } last = performance.now(); raf = requestAnimationFrame(tick); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  function start() {
    return (starting ||= (async () => {
      try { D = await loadHall(new URL('../../../../data/forge/', import.meta.url)); hall = createHall(canvas, D, { warm: cs.getPropertyValue('--person').trim() }); el.__hall = hall; size(); hall.compile(); el.classList.add('live'); words(); run(); }
      catch (e) { failed = true; console.error(e); el.append(h('div.forge-hall-fail', null, h('p', null, 'The hall could not be drawn: ' + (e.message || e)), h('button.btn', { onclick: () => location.reload() }, 'Try again'))); }
    })());
  }
  // look around, hover, keys
  let px = 0, py = 0, hoverAt = 0, hp = null;
  canvas.addEventListener('pointerdown', (e) => { if (!hall) return; canvas.setPointerCapture(e.pointerId); hall.dragging = true; px = e.clientX; py = e.clientY; hall.hover = -1; tip.hidden = true; });
  const up = () => { if (hall) hall.dragging = false; }; canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointermove', (e) => {
    if (!hall) return; if (hall.dragging) { hall.look(-(e.clientX - px) * 0.0016, (e.clientY - py) * 0.0012); px = e.clientX; py = e.clientY; return; }
    const n = performance.now(); if (n - hoverAt < 40) return; hoverAt = n; const r = canvas.getBoundingClientRect(), i = hall.pick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); hall.hover = i; tip.hidden = i < 0; if (i < 0) return;
    const p = personFacts(D, i, Math.min(D.steps.length - 1, Math.round(hall.ck)));
    if (hp !== i + ':' + curC) { hp = i + ':' + curC; tip.replaceChildren(h('b', null, 'Simulated person ' + (i + 1)), h('span', null, (p.lying ? (p.moving ? 'Lying, moving a limb' : 'Lying still') : p.moving ? 'Walking' : 'Standing still') + ', ' + p.height.toFixed(2) + ' m tall'), h('span', null, p.behind.toFixed(1) + ' m behind the wall'), h('span', null, 'Score ', h('b.num', null, p.score.toFixed(2)), p.found > 0 ? (p.found < 1 ? ', found in ' + Math.round(p.found * 100) + ' % of windows' : ', found') : ''), h('i', null, ['Used in training', 'Used to set the threshold', 'Held out: never trained on'][p.split])); }
    tip.style.transform = 'translate3d(' + Math.min(r.width - 250, e.clientX - r.left + 18) + 'px,' + Math.max(8, e.clientY - r.top - 60) + 'px,0)';
  });
  canvas.addEventListener('pointerleave', () => { if (hall) hall.hover = -1; tip.hidden = true; });
  canvas.addEventListener('keydown', (e) => { if (!hall) return; const k = { ArrowLeft: [-0.06, 0], ArrowRight: [0.06, 0], ArrowUp: [0, 0.04], ArrowDown: [0, -0.04] }[e.key]; if (k) { hall.look(...k); e.preventDefault(); } else if (e.key === ' ') { hall.playing = !hall.playing; e.preventDefault(); e.stopPropagation(); } });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); });
  new ResizeObserver(size).observe(el);
  return { el, show() { visible = true; if (ctx.mode === 'demo') { start(); run(); } }, hide() { visible = false; stop(); }, mode() { if (ctx.mode === 'demo' && visible) { start(); run(); } else stop(); } };
}
