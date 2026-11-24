// HOUND landing page: scroll scenes, reveals, counters, and lazy loading of the heavy parts.
import { reduced, clamp, easeOut, el, getNN } from './shared.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- scroll scenes ----------
// A scene is a tall section with a sticky stage. u is its raw progress (below 0 while it scrolls in, above 1 after),
// p is u clamped to 0..1 and is also set on the element as --p for CSS.
const scenes = $$('[data-scene]').map((node) => ({ node, name: node.dataset.scene, top: 0, h: 1, p: -1, u: -9 }));
const handlers = {};
export const onScene = (name, fn) => { (handlers[name] ||= []).push(fn); const s = scenes.find((x) => x.name === name); if (s && s.u > -9) fn(s.p, s.u); };
let vh = innerHeight, ticking = false;
function measure() {
  vh = innerHeight;
  for (const s of scenes) { const r = s.node.getBoundingClientRect(); s.top = r.top + scrollY; s.h = r.height; }
  update();
}
function update() {
  ticking = false;
  const y = scrollY;
  for (const s of scenes) {
    const span = Math.max(1, s.h - vh), u = s.h > vh + 2 ? (y - s.top) / span : (y - s.top) / vh, p = clamp(u);
    if (Math.abs(u - s.u) < 1e-4) continue;
    s.u = u;
    const v = (y + vh - s.top) / (s.h + vh);            // 0 as the scene enters the screen, 1 as it leaves
    if (v > -0.1 && v < 1.1) s.node.style.setProperty('--v', clamp(v).toFixed(4));
    if (p !== s.p) { s.p = p; s.node.style.setProperty('--p', p.toFixed(4)); }
    for (const fn of handlers[s.name] || []) fn(p, u, span / vh);
  }
  $('#nav').classList.toggle('is-solid', y > 24);
}
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
addEventListener('resize', measure);
new ResizeObserver(measure).observe(document.body);

// ---------- nav: mark the section in view ----------
const navLinks = $$('.nav-links a');
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) navLinks.forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === '#' + e.target.id)));
}, { rootMargin: '-45% 0px -50% 0px' });
$$('main > section[id]').forEach((s) => spy.observe(s));

// ---------- the moment: words light as you scroll ----------
const paras = $$('[data-words]').map((p) => {
  const words = p.textContent.trim().split(/\s+/);
  p.setAttribute('aria-label', p.textContent.trim());
  p.replaceChildren(...words.flatMap((w, i) => (i < words.length - 1 ? [el('span.w', { 'aria-hidden': 'true' }, w), ' '] : [el('span.w', { 'aria-hidden': 'true' }, w)])));
  return { p, spans: $$('.w', p) };
});
const plate = $('#moment-plate'), plates = $$('img', plate);
if (!reduced) onScene('moment', (p, u, spanVh) => {
  const n = paras.length, lead = 0.6 / spanVh;          // the first paragraph starts lighting while the scene scrolls in
  const at = Math.min(n - 1, Math.max(0, Math.floor(u * n)));
  plates.forEach((im, i) => im.classList.toggle('is-on', i + 1 === at)); plate.classList.toggle('has-img', at >= 1);   // the first paragraph stands alone
  paras.forEach(({ p: node, spans }, i) => {
    const a = i / n, b = (i + 1) / n;
    const on = (i === 0 ? true : u >= a) && (i === n - 1 ? true : u < b);
    node.classList.toggle('is-on', on); node.classList.toggle('is-past', i < n - 1 && u >= b);
    const f = clamp((u - a + (i === 0 ? lead : 0)) / ((b - a) * 0.66 + (i === 0 ? lead : 0)));
    const lit = Math.round(f * spans.length);
    for (let k = 0; k < spans.length; k++) spans[k].classList.toggle('lit', k < lit);
  });
});

// ---------- reveals and counters ----------
const revealSets = ['.sec-head > *', '.truth-head > *', '.answer-head > *', '.big-num', '.why-col', '.answer-steps li', '.ledger-row', '.built-col li', '.built-col h3', '.open-links > div', '.real-coda', '.proof', '.ladder', '.cmd', '.tour-group', '.open h2', '.open-cta'];
const assignReveals = (root = document) => revealSets.forEach((sel) => $$(sel, root).forEach((n) => {
  if (n.hasAttribute('data-reveal')) return;
  n.setAttribute('data-reveal', ''); n.style.setProperty('--i', Math.min(6, [...n.parentNode.children].indexOf(n)));
  revealIO.observe(n);
}));
const revealIO = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); } }, { rootMargin: '0px 0px -8% 0px' });
assignReveals();

const countIO = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    countIO.unobserve(e.target);
    const node = e.target, to = +node.dataset.count, dec = +(node.dataset.dec || 0);
    if (reduced) { node.textContent = to.toFixed(dec); continue; }
    const t0 = performance.now(), dur = 1500;
    const tick = (now) => { const t = clamp((now - t0) / dur); node.textContent = (to * easeOut(t)).toFixed(dec); if (t < 1) requestAnimationFrame(tick); };
    node.textContent = (0).toFixed(dec); requestAnimationFrame(tick);
  }
}, { threshold: 0.4 });
$$('[data-count]').forEach((n) => countIO.observe(n));

// ---------- the network's true numbers (docs/FACTS.md, 955 simulated test windows) ----------
const RESULTS = [
  { label: 'Still or moving, answered correctly', v: 91.5 },
  { label: 'An empty room is called empty', v: 88.9 },
  { label: 'A moving person is found', v: 86.9 },
  { label: 'Overall: is someone there?', v: 59.3 },
  { label: 'A still person is found', v: 21.4, weak: true },
];
const bars = $('#truth-bars');
bars.append(...RESULTS.map((r, i) => el('div.tb-row' + (r.weak ? '.weak' : ''), null, el('span', null, r.label), el('div.tb-track', { style: `--v:${r.v};--i:${i}` }, el('i')), el('b', null, r.v.toFixed(1) + ' %'))),
  el('div.tb-axis', null, el('span'), el('div', null, el('span', null, '0'), el('span', null, '50'), el('span', null, '100 % of test windows')), el('span')));
new IntersectionObserver((es, io) => { if (es[0].isIntersecting) { bars.classList.add('in'); io.disconnect(); } }, { threshold: 0.3 }).observe(bars);

// ---------- the hero: atmosphere ----------
if (!reduced) {
  const canvas = $('#hero-gl');
  import('./atmosphere.js').then(({ startAtmosphere }) => startAtmosphere(canvas, { image: 'assets/img/landing/hero.webp', depth: 'assets/img/landing/hero-depth.png' }))
    .then((atmo) => { canvas.classList.add('on'); onScene('hero', (p) => atmo.setScroll(p)); })
    .catch((e) => { console.warn('[landing] hero atmosphere is off:', e.message); canvas.remove(); });
}

// ---------- heavy parts, loaded when they are needed ----------
const near = (sel, margin, load) => {
  const node = $(sel); if (!node) return;
  new IntersectionObserver((es, io) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); load().catch((e) => console.error('[landing]', sel, e)); } }, { rootMargin: margin }).observe(node);
};
const idle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1200 }) : setTimeout(fn, 400));
idle(() => { import('./proof.js').then((m) => m.startProof({ onScene })).catch((e) => console.error('[landing] proof', e)); });
near('#rover', '120% 0px', () => import('./rover.js').then((m) => m.startRover({ onScene })));
near('#command', '90% 0px', () => import('./command.js').then((m) => m.startCommand()));
near('#tour', '100% 0px', () => import('./tour.js').then((m) => m.startTour({ assignReveals })));

measure();
window.__landing = { scenes, getNN };
