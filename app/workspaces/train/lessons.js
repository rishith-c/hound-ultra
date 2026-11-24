// Training lessons: four short lessons, each screen built around one figure with real computation behind it.
//   openLesson(host, ctx, id, { onDone, onExit, screen }) -> { destroy() }
// Honesty: every network number comes from the 955 SIMULATED test windows; every fusion likelihood other than
// the Wi-Fi network's is ASSUMED (core/fusion.js). Each screen says which of these it is showing.
import { LR, PRIOR, THRESHOLDS, fuse, classify } from '../../core/fusion.js';
import { planPath } from '../../core/planner.js';
import { dist, distToSeg, pointInPoly, pointAlong, mulberry32 } from '../../core/geometry.js';
import { createPlan } from '../triage/plan.js';
import { exposureAlong } from '../triage/model.js';

export const LESSONS = [
  { id: 'wifi', title: 'How Wi-Fi sensing works, and where it stops', minutes: 4, screens: 3, blurb: 'Drag a person through the echoes, then try to beat the network on real test windows.' },
  { id: 'fusion', title: 'Why three sensors beat one', minutes: 3, screens: 2, blurb: 'Build a finding one reading at a time and watch the odds move.' },
  { id: 'probability', title: 'Reading a probability', minutes: 3, screens: 2, blurb: 'What 21 % asks of you, and why an alarm is not an answer.' },
  { id: 'approval', title: 'Why a person approves the route', minutes: 3, screens: 2, blurb: 'Run the planner yourself, then catch the route it should not have proposed.' },
];

// Measured on the 955 simulated test windows (docs/FACTS.md). Nothing here is a real-world result.
const FACT = { moving: 86.9, still: 21.4, standing: 25.5, lying: 12.4, empty: 88.9, falseAlarm: 11.1, hit: 47.6, noise: 0.5, breathLo: 0.05, breathHi: 0.4, rateOk: 41, threshold: 0.53 };

// ---------- small helpers ----------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const alpha = (hex, a) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim()); if (!m) return hex; const n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };
const rgb = (hex) => { const n = parseInt(/([0-9a-f]{6})/i.exec(hex)[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const pct = (p, d = 0) => (p * 100).toFixed(d) + ' %';
const times = (lr) => '×' + (lr >= 10 ? lr.toFixed(0) : lr.toFixed(2));

function ensureCss() {
  if (document.getElementById('train-lessons-css')) return;
  const link = document.createElement('link'); link.id = 'train-lessons-css'; link.rel = 'stylesheet'; link.href = new URL('./lessons.css', import.meta.url).href;
  document.head.append(link);
}
function tokens(kit) {
  const g = kit.cssVar;
  return { bg0: g('--bg-0'), bg1: g('--bg-1'), bg2: g('--bg-2'), bg3: g('--bg-3'), bg4: g('--bg-4'), bg5: g('--bg-5'), line: g('--line'), line2: g('--line-2'), line3: g('--line-3'),
    text: g('--text'), text2: g('--text-2'), text3: g('--text-3'), accent: g('--accent'), person: g('--person'), warn: g('--warn'), ok: g('--ok'), danger: g('--danger'), sim: g('--sim'),
    font: g('--font'), mono: g('--mono'), display: g('--font-display'), heat: [0, 1, 2, 3, 4, 5].map((i) => g('--heat-' + i)) };
}
// Canvas text in the token fonts. opts: size, weight, color, align, base, mono, display
function label(c, T, s, x, y, o = {}) {
  c.font = (o.weight || (o.display ? 400 : 500)) + ' ' + (o.size || 11) + 'px ' + (o.display ? T.display : o.mono ? T.mono : T.font);
  c.textAlign = o.align || 'left'; c.textBaseline = o.base || 'alphabetic'; c.fillStyle = o.color || T.text2; c.fillText(s, x, y);
}
function hline(c, x0, x1, y, color, dash) { c.save(); c.beginPath(); c.setLineDash(dash || []); c.strokeStyle = color; c.lineWidth = 1; const yy = Math.round(y) + 0.5; c.moveTo(x0, yy); c.lineTo(x1, yy); c.stroke(); c.restore(); }
function vline(c, x, y0, y1, color, dash) { c.save(); c.beginPath(); c.setLineDash(dash || []); c.strokeStyle = color; c.lineWidth = 1; const xx = Math.round(x) + 0.5; c.moveTo(xx, y0); c.lineTo(xx, y1); c.stroke(); c.restore(); }

// Everything a screen adds (loops, observers, listeners) is registered here and removed when the screen changes.
function makeEnv(ctx, root) {
  const kit = ctx.kit, h = kit.h, cleanups = [];
  const env = {
    ctx, kit, h, T: tokens(kit), reduced: kit.reducedMotion(), dead: false,
    cleanup(fn) { cleanups.push(fn); },
    on(target, type, fn, opts) { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); },
    // A canvas that fills its box. draw(c, W, H) runs on resize, after fonts load and on redraw().
    canvas(text, draw, cls) {
      const el = h('canvas', { role: 'img', 'aria-label': text }), box = h('div.train-ls-cv' + (cls ? '.' + cls : ''), null, el);
      let c = null, W = 0, H = 0;
      const redraw = () => { if (c && W && H && !env.dead) { c.clearRect(0, 0, W, H); draw(c, W, H); } };
      cleanups.push(kit.fitCanvas(el, (cc, w, hh) => { c = cc; W = w; H = hh; redraw(); }));
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
      return { box, el, redraw, describe(s) { el.setAttribute('aria-label', s); } };
    },
    // requestAnimationFrame loop; fn(seconds). Does nothing under reduced motion or while the workspace is hidden.
    loop(fn) {
      let raf = 0, on = false; const t0 = performance.now();
      const tick = (now) => { if (!on) return; if (root.offsetParent !== null) fn((now - t0) / 1000); raf = requestAnimationFrame(tick); };
      const api = { start() { if (on || env.reduced || env.dead) return; on = true; raf = requestAnimationFrame(tick); }, stop() { on = false; cancelAnimationFrame(raf); } };
      cleanups.push(api.stop);
      return api;
    },
    dispose() { env.dead = true; for (const fn of cleanups.splice(0).reverse()) { try { fn(); } catch (e) { console.warn('[train lessons] cleanup', e); } } },
  };
  return env;
}

function slider(h, { min, max, step = 1, value, name, oninput }) {
  const el = h('input.slider', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': name });
  const sync = () => el.style.setProperty('--p', ((+el.value - min) / (max - min)) * 100 + '%');
  el.addEventListener('input', () => { sync(); oninput(+el.value); });
  el.sync = sync; sync();
  return el;
}
function seg(h, name, options, value, onchange) {
  const el = h('div.seg', { role: 'group', 'aria-label': name });
  const paint = () => { for (const b of el.children) b.setAttribute('aria-pressed', String(b.dataset.v === String(value))); };
  for (const [v, text] of options) el.append(h('button', { type: 'button', 'data-v': String(v), onclick: () => { value = v; paint(); onchange(v); } }, text));
  paint();
  return { el, set(v) { value = v; paint(); }, get: () => value };
}
const assumedMark = (h, assumed) => h('span.train-ls-src' + (assumed ? '.assumed' : ''), null, assumed ? 'assumed' : 'measured');
const figHead = (h, title, note) => h('div.train-ls-fighead', null, h('h3.train-ls-figtitle', null, title), note ? h('p.train-ls-fignote', null, note) : null);

// ---------- lesson chrome ----------
export function openLesson(host, ctx, id, { onDone, onExit, screen = 1 } = {}) {
  ensureCss();
  const kit = ctx.kit, h = kit.h;
  const lesson = LESSONS.find((l) => l.id === id) || LESSONS[0], screens = SCREENS[lesson.id];
  let idx = clamp((screen | 0) - 1, 0, screens.length - 1), env = null, finished = false, dead = false;

  const backHome = h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => onExit && onExit() }, kit.icon('arrow-left', 14), 'Back to training');
  const count = h('span.train-ls-count.num', { 'aria-live': 'polite' });
  const dots = h('div.train-ls-steps', { role: 'group', 'aria-label': 'Screens in this lesson' },
    screens.map((s, i) => h('button.train-ls-step', { type: 'button', 'aria-label': 'Screen ' + (i + 1) + ': ' + s.head, title: s.head, onclick: () => go(i) })));
  const prev = h('button.btn', { type: 'button', onclick: () => go(idx - 1) }, kit.icon('arrow-left', 14), 'Back');
  const nextText = h('span'), next = h('button.btn.btn-primary', { type: 'button', onclick: () => (idx === screens.length - 1 ? finish() : go(idx + 1)) }, nextText, kit.icon('arrow-right', 14));
  const body = h('div.train-ls-body');
  const root = h('div.train-ls', null,
    h('header.train-ls-head', null, backHome, h('span.train-ls-rule'), h('h1.train-ls-title.title', null, lesson.title), h('div.train-ls-nav', null, dots, count, prev, next)), body);
  host.append(root);

  function finish() { if (finished) return; finished = true; onDone && onDone(lesson.id); }
  function go(i) {
    i = clamp(i, 0, screens.length - 1);
    if (env) env.dispose();
    idx = i; env = makeEnv(ctx, root);
    const s = screens[i];
    [...dots.children].forEach((b, j) => { b.setAttribute('aria-current', j === i ? 'step' : 'false'); b.dataset.done = String(j < i); });
    count.textContent = (i + 1) + ' of ' + screens.length;
    prev.disabled = i === 0; nextText.textContent = i === screens.length - 1 ? 'Finish lesson' : 'Next';
    const fig = h('div.train-ls-fig');
    const copy = h('div.train-ls-copy', null,
      h('h2.train-ls-headline', null, s.head),
      s.text.map((t) => h('p', null, t)),
      h('div.train-ls-label', null, kit.realityTag(s.tag), h('span', null, s.label)),
      h('div.train-ls-spacer'),
      h('p.train-ls-remember', null, h('b', null, 'Remember'), s.remember));
    const screenEl = h('section.train-ls-screen', { 'aria-label': s.head }, copy, fig);
    body.replaceChildren(screenEl);
    try { s.build(fig, env); }
    catch (e) { console.error('[train lessons]', e); fig.replaceChildren(h('div.empty', null, kit.icon('alert', 28), h('h3', null, 'This figure could not be drawn'), h('p', null, String((e && e.message) || e)))); }
  }
  function onKey(e) {
    if (dead || root.offsetParent === null || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const t = e.target;
    if (t && t.closest && t.closest('input, select, textarea, [contenteditable], [data-arrows]')) return;
    e.preventDefault(); go(idx + (e.key === 'ArrowRight' ? 1 : -1));
  }
  document.addEventListener('keydown', onKey);
  go(idx);
  return { destroy() { if (dead) return; dead = true; document.removeEventListener('keydown', onKey); if (env) env.dispose(); root.remove(); } };
}

// =====================================================================================================
// Lesson 1, screen a: a body changes the echoes. A teaching model: the channel is a phasor sum over a handful
// of paths, H(f_k) = sum a_i exp(-j 2 pi f_k d_i / c), f_k = 2.437 GHz + (k - 25) x 312.5 kHz.
// =====================================================================================================
function figEchoes(fig, env) {
  const { h, kit, T } = env;
  const C = 299792458, F0 = 2.437e9, DF = 312500, NK = 51;
  const ROOM = { w: 6, d: 4.5 }, TX = [-1.4, 2.6], RX = [4.9, 1.5], HOME = [2.6, 3.2];
  // Teaching values, chosen so one breath lands inside the measured 0.05 to 0.4 % range.
  const WALL_LOSS = 0.7, REFLECT = 0.7, SCATTER = 0.06, SHADOW = 0.55, BODY_R = 0.22, CHEST_SHARE = 0.3, CHEST_M = 0.004, BREATHS_PER_MIN = 15;
  const WALLS = { top: ['y', ROOM.d], bottom: ['y', 0], right: ['x', ROOM.w] };
  const mirror = (p, w) => (w[0] === 'x' ? [2 * w[1] - p[0], p[1]] : [p[0], 2 * w[1] - p[1]]);
  const cross = (a, b, w) => { const i = w[0] === 'x' ? 0 : 1, t = (w[1] - a[i]) / (b[i] - a[i]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
  function echo(seq) { // image method: mirror the receiver in each wall, last wall first
    const im = [RX]; for (let i = seq.length - 1; i >= 0; i--) im.unshift(mirror(im[0], WALLS[seq[i]]));
    const pts = [TX]; let cur = TX; seq.forEach((w, i) => { cur = cross(cur, im[i], WALLS[w]); pts.push(cur); }); pts.push(RX);
    return pts;
  }
  const lengthOf = (pts) => { let d = 0; for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1], pts[i]); return d; };
  const PATHS = [[], ['top'], ['bottom'], ['right'], ['top', 'right'], ['bottom', 'right']].map((seq) => { const pts = seq.length ? echo(seq) : [TX, RX]; return { pts, len: lengthOf(pts), gain: WALL_LOSS * Math.pow(REFLECT, seq.length), direct: !seq.length }; });

  // person = null for the empty room. chest = extra path length of the chest reflection, metres.
  function channel(person, chest = 0) {
    const list = PATHS.map((p) => {
      let g = 1;
      if (person) for (let i = 1; i < p.pts.length; i++) { const d = distToSeg(person, p.pts[i - 1], p.pts[i]) / BODY_R; g *= 1 - SHADOW * Math.exp(-d * d); }
      return { d: p.len, a: (p.gain * g) / p.len, shade: g };
    });
    if (person) { const d1 = Math.max(0.3, dist(TX, person)), d2 = Math.max(0.3, dist(person, RX)), a = (WALL_LOSS * SCATTER) / (d1 * d2); list.push({ d: d1 + d2, a: a * (1 - CHEST_SHARE) }, { d: d1 + d2 + chest, a: a * CHEST_SHARE }); }
    const amp = new Float64Array(NK);
    for (let k = 0; k < NK; k++) { const w = (-2 * Math.PI * (F0 + (k - 25) * DF)) / C; let re = 0, im = 0; for (const p of list) { re += p.a * Math.cos(w * p.d); im += p.a * Math.sin(w * p.d); } amp[k] = Math.hypot(re, im); }
    return { amp, shade: list.slice(0, PATHS.length).map((p) => p.shade) };
  }
  const change = (a, b) => { const out = new Float64Array(NK); let mean = 0; for (let k = 0; k < NK; k++) { out[k] = ((a[k] - b[k]) / b[k]) * 100; mean += Math.abs(out[k]); } return { per: out, mean: mean / NK }; };
  const EMPTY = channel(null), TOP = Math.max(...EMPTY.amp) * 1.35;

  const S = { person: HOME.slice(), breathing: false, t: 0, moved: false };
  let rest, live, vsEmpty, vsRest, breathPeak;
  function compute() {
    rest = channel(S.person, 0);
    breathPeak = 0; for (let i = 0; i < 12; i++) breathPeak = Math.max(breathPeak, change(channel(S.person, 2 * CHEST_M * Math.sin((i / 12) * 2 * Math.PI)).amp, rest.amp).mean);
    frame();
  }
  function frame() {
    const chest = S.breathing ? 2 * CHEST_M * Math.sin(2 * Math.PI * (BREATHS_PER_MIN / 60) * S.t) : 0;
    live = S.breathing ? channel(S.person, env.reduced ? 2 * CHEST_M : chest) : rest;
    vsEmpty = change(live.amp, EMPTY.amp); vsRest = change(live.amp, rest.amp);
  }

  // ---- the room, drawn with the transmitter at the top: world x runs down the screen, world y across ----
  let k = 1, ox = 0, oy = 0;
  const X = (p) => ox + p[1] * k, Y = (p) => oy + p[0] * k;
  const handle = h('button.train-ls-handle', { type: 'button', 'data-arrows': '', 'aria-label': 'Person in the room. Drag, or use the arrow keys to move 10 centimetres.' });
  const room = env.canvas('Top view of a room. A transmitter outside, a wall, the receiver on the rover, the direct ray and five echoes, and a person you can move.', (c, W, H) => {
    const a0 = -2.35, a1 = 6.75, b0 = -0.5, b1 = 5.0; // a: world x (down), b: world y (across)
    k = Math.min(W / (b1 - b0), H / (a1 - a0)); ox = (W - (b1 - b0) * k) / 2 - b0 * k; oy = (H - (a1 - a0) * k) / 2 - a0 * k;
    const rx0 = X([0, 0]), ry0 = Y([0, 0]), rw = ROOM.d * k, rh = ROOM.w * k;
    c.fillStyle = T.bg1; c.fillRect(rx0, ry0, rw, rh);
    c.fillStyle = alpha(T.line2, 0.9); for (let x = 0; x <= ROOM.w; x += 0.5) for (let y = 0; y <= ROOM.d; y += 0.5) c.fillRect(X([x, y]) - 0.5, Y([x, y]) - 0.5, 1, 1);
    // rays: echoes first, the direct ray on top. A ray that passes the body is dimmed by its shadow.
    c.lineJoin = 'round'; c.lineCap = 'round';
    const trace = (pts) => { c.beginPath(); pts.forEach((q, j) => (j ? c.lineTo(X(q), Y(q)) : c.moveTo(X(q), Y(q)))); };
    PATHS.slice().reverse().forEach((p, r) => {
      const shade = live.shade[PATHS.length - 1 - r];
      trace(p.pts); c.strokeStyle = p.direct ? alpha(T.text, 0.25 + 0.7 * shade) : alpha(T.accent, (0.2 + 0.55 * shade) * (p.pts.length > 3 ? 0.55 : 1)); c.lineWidth = p.direct ? 2 : 1.3; c.stroke();
      for (let j = 1; j < p.pts.length - 1; j++) { c.beginPath(); c.arc(X(p.pts[j]), Y(p.pts[j]), 2.4, 0, 7); c.fillStyle = T.accent; c.fill(); }
    });
    c.setLineDash([4, 4]); trace([TX, S.person, RX]); c.strokeStyle = alpha(T.person, 0.9); c.lineWidth = 1.5; c.stroke(); c.setLineDash([]);
    // walls: the wall between the transmitter and the room is drawn heavy
    c.strokeStyle = T.text3; c.lineWidth = 2; c.strokeRect(rx0, ry0, rw, rh);
    c.fillStyle = T.text2; c.fillRect(rx0 - 1, ry0 - 5, rw + 2, 10);
    label(c, T, 'Wall', rx0 + rw - 2, ry0 - 12, { align: 'right', color: T.text2 });
    // transmitter
    const tx = X(TX), ty = Y(TX);
    c.strokeStyle = T.text; c.lineWidth = 1.5; c.strokeRect(tx - 6, ty - 6, 12, 12); c.fillStyle = T.text; c.fillRect(tx - 2, ty - 2, 4, 4);
    for (const r of [13, 19]) { c.beginPath(); c.arc(tx, ty, r, Math.PI / 2 - 0.6, Math.PI / 2 + 0.6); c.strokeStyle = alpha(T.text, 0.55); c.lineWidth = 1.2; c.stroke(); }
    label(c, T, 'Transmitter', tx - 16, ty - 1, { align: 'right', color: T.text }); label(c, T, '100 probes a second', tx - 16, ty + 13, { align: 'right', color: T.text3, size: 10.5 });
    // rover with the receiver
    const rx = X(RX), ry = Y(RX), bw = 0.46 * k, bl = 0.62 * k;
    c.fillStyle = T.text3; for (const [dx, dy] of [[-1, -0.3], [1, -0.3], [-1, 0.42], [1, 0.42]]) c.fillRect(rx + (dx * bw) / 2 - (dx < 0 ? 0.06 * k : 0), ry + bl * dy - 0.1 * k, 0.06 * k, 0.2 * k);
    c.fillStyle = T.bg3; c.strokeStyle = T.text; c.lineWidth = 1.5; c.beginPath(); c.rect(rx - bw / 2, ry - bl * 0.35, bw, bl); c.fill(); c.stroke();
    c.beginPath(); c.arc(rx, ry, 3.5, 0, 7); c.fillStyle = T.accent; c.fill();
    label(c, T, 'Receiver on the rover', rx + bw / 2 + 10, ry + 4, { color: T.text });
    const mid = [(TX[0] + RX[0]) / 2, (TX[1] + RX[1]) / 2]; label(c, T, 'Direct ray', X(mid) + 10, Y(mid) + 3, { color: T.text2, size: 10.5 });
    const e = PATHS[2].pts[1]; label(c, T, 'Echo off a wall', X(e) - 10, Y(e) + 4, { align: 'right', color: T.accent, size: 10.5 });
    // the person
    const px = X(S.person), py = Y(S.person), pr = BODY_R * k;
    if (S.breathing) { const ph = env.reduced ? 0.5 : (S.t * BREATHS_PER_MIN / 60) % 1; c.beginPath(); c.arc(px, py, pr + 5 + ph * 14, 0, 7); c.strokeStyle = alpha(T.person, 0.55 * (1 - ph)); c.lineWidth = 1.2; c.stroke(); }
    c.beginPath(); c.arc(px, py, pr + 5, 0, 7); c.fillStyle = alpha(T.person, 0.16); c.fill();
    c.beginPath(); c.arc(px, py, pr, 0, 7); c.fillStyle = T.person; c.fill(); c.strokeStyle = T.bg0; c.lineWidth = 2; c.stroke();
    label(c, T, S.moved ? 'Person' : 'Drag the person', px, py - pr - 12, { align: 'center', color: T.text, weight: 600 });
    // scale
    const bx = rx0 + rw - k, by = ry0 + rh + 16; c.strokeStyle = T.text2; c.lineWidth = 1; c.beginPath(); c.moveTo(bx, by - 4); c.lineTo(bx, by); c.lineTo(bx + k, by); c.lineTo(bx + k, by - 4); c.stroke();
    label(c, T, '1 m', bx - 8, by + 3, { align: 'right', mono: true, size: 10, color: T.text2 });
    handle.style.left = px + 'px'; handle.style.top = py + 'px'; handle.style.width = handle.style.height = Math.max(28, pr * 2 + 14) + 'px';
  }, 'train-ls-room');
  room.box.append(handle);

  // ---- the 51 subcarriers ----
  const bars = env.canvas('Bar chart of the amplitude on 51 Wi-Fi subcarriers, with the empty room as an outline, and below it the change on each subcarrier next to the receiver noise.', (c, W, H) => {
    const L = 44, R = 10, top = 22, mid = Math.round(H * 0.54), gap = 70, bw = (W - L - R) / NK;
    const y0 = mid, yA = (v) => y0 - (v / TOP) * (y0 - top);
    hline(c, L, W - R, y0, T.line2);
    for (let i = 0; i < NK; i++) { const x = L + i * bw; c.fillStyle = alpha(T.accent, 0.78); c.fillRect(x + 1, yA(live.amp[i]), Math.max(1, bw - 2), y0 - yA(live.amp[i])); }
    c.beginPath(); for (let i = 0; i < NK; i++) { const x = L + i * bw, y = Math.round(yA(EMPTY.amp[i])) + 0.5; i ? c.lineTo(x, y) : c.moveTo(x, y); c.lineTo(x + bw, y); }
    c.strokeStyle = T.text; c.lineWidth = 1; c.setLineDash([3, 2]); c.stroke(); c.setLineDash([]);
    label(c, T, 'Empty room', W - R, 10, { align: 'right', color: T.text, size: 10.5 }); hline(c, W - R - 84, W - R - 64, 6, T.text, [3, 2]); label(c, T, 'Now', W - R - 100, 10, { align: 'right', color: T.accent, size: 10.5, weight: 600 }); c.fillStyle = alpha(T.accent, 0.78); c.fillRect(W - R - 134, 2, 8, 8);
    c.save(); c.translate(12, (top + y0) / 2); c.rotate(-Math.PI / 2); label(c, T, 'Amplitude', 0, 0, { align: 'center', color: T.text3, size: 10.5 }); c.restore();
    for (const i of [0, 25, 50]) label(c, T, String(i + 1), L + (i + 0.5) * bw, y0 + 13, { align: 'center', mono: true, size: 10, color: T.text3 });
    label(c, T, 'Subcarrier, 312.5 kHz apart around 2.437 GHz', L + (NK * bw) / 2, y0 + 28, { align: 'center', color: T.text3, size: 10.5 });
    // change per subcarrier
    const d = S.breathing ? vsRest : vsEmpty, t2 = mid + gap, b2 = H - 12;
    const hiV = S.breathing ? 1 : Math.max(2, Math.ceil(Math.max(...d.per) / 5) * 5), loV = S.breathing ? -1 : Math.min(-2, Math.floor(Math.min(...d.per) / 5) * 5), yD = (v) => b2 - ((clamp(v, loV, hiV) - loV) / (hiV - loV)) * (b2 - t2), zero = yD(0);
    c.fillStyle = alpha(T.text3, 0.2); c.fillRect(L, yD(FACT.noise), W - L - R, yD(-FACT.noise) - yD(FACT.noise));
    hline(c, L, W - R, yD(FACT.noise), T.text3, [2, 3]); hline(c, L, W - R, yD(-FACT.noise), T.text3, [2, 3]); hline(c, L, W - R, zero, T.line2);
    for (let i = 0; i < NK; i++) { const x = L + i * bw, y = yD(d.per[i]); c.fillStyle = T.person; c.fillRect(x + 1, Math.min(y, zero), Math.max(1, bw - 2), Math.max(1, Math.abs(y - zero))); }
    for (const v of [hiV, 0, loV]) label(c, T, (v > 0 ? '+' : '') + v + ' %', L - 6, yD(v), { align: 'right', base: 'middle', mono: true, size: 10, color: T.text3 });
    label(c, T, 'Receiver noise, about ±0.5 %', W - R, t2 - 12, { align: 'right', color: T.text2, size: 10.5 }); c.fillStyle = alpha(T.text3, 0.35); c.fillRect(W - R - 160, t2 - 20, 8, 8);
    label(c, T, S.breathing ? 'Change on each subcarrier during a breath' : 'Change on each subcarrier, against the empty room', L, t2 - 12, { color: T.text, size: 11, weight: 600 });
  });

  const nEmpty = h('b.num'), nBreath = h('b.num'), ratio = h('span');
  const stats = h('div.train-ls-stats', null,
    h('div.stat.live', null, nEmpty, h('span', null, 'pattern change, person against empty room')),
    h('div.stat.live', null, nBreath, ratio),
    h('div.stat.live', null, h('b.num', null, FACT.noise.toFixed(2), h('small', null, '%')), h('span', null, 'receiver noise per subcarrier (measured)')));
  const toggle = h('input', { type: 'checkbox', onchange: () => { S.breathing = toggle.checked; S.t = 0; if (S.breathing) anim.start(); else anim.stop(); frame(); paint(); } });
  const reset = h('button.btn.btn-sm', { type: 'button', onclick: () => { S.person = HOME.slice(); compute(); paint(); } }, kit.icon('reset', 14), 'Put the person back');

  function paint() {
    nEmpty.replaceChildren(vsEmpty.mean.toFixed(1), h('small', null, '%'));
    nBreath.replaceChildren(breathPeak.toFixed(2), h('small', null, '%'));
    ratio.textContent = 'largest change in one breath here: ' + (breathPeak < FACT.noise ? (FACT.noise / Math.max(breathPeak, 0.001)).toFixed(0) + ' times smaller than the noise' : 'above the noise at this spot');
    room.redraw(); bars.redraw();
  }
  const anim = env.loop((t) => { S.t = t; frame(); room.redraw(); bars.redraw(); });
  function moveTo(x, y) { S.person = [clamp(x, 0.3, ROOM.w - 0.3), clamp(y, 0.3, ROOM.d - 0.3)]; S.moved = true; compute(); paint(); }
  const fromEvent = (e) => { const r = room.el.getBoundingClientRect(); return [(e.clientY - r.top - oy) / k, (e.clientX - r.left - ox) / k]; };
  let dragging = false;
  const down = (e) => { dragging = true; e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId); const p = fromEvent(e); moveTo(p[0], p[1]); };
  const move = (e) => { if (dragging) { const p = fromEvent(e); moveTo(p[0], p[1]); } };
  const up = () => { dragging = false; };
  for (const el of [room.el, handle]) { env.on(el, 'pointerdown', down); env.on(el, 'pointermove', move); env.on(el, 'pointerup', up); env.on(el, 'pointercancel', up); }
  env.on(handle, 'keydown', (e) => { const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key]; if (!d) return; e.preventDefault(); e.stopPropagation(); const s = e.shiftKey ? 0.02 : 0.1; moveTo(S.person[0] + d[0] * s, S.person[1] + d[1] * s); });

  fig.append(h('div.train-ls-echo', null,
    h('div.train-ls-pane', null, figHead(h, 'The signal reaches the rover by many paths. A body shadows some and adds one of its own.'), room.box,
      h('div.train-ls-bar', null, h('label.check.switch', null, toggle, 'Breathing only: the chest moves 4 mm'), h('span.train-ls-grow'), reset)),
    h('div.train-ls-pane', null, figHead(h, 'Every subcarrier shifts when the person moves'), stats, bars.box)));
  compute(); paint();
}

// =====================================================================================================
// Lesson 1, screen b: ten seconds in, one answer out. The real network on the bundled held-out test windows.
// =====================================================================================================
function figWindow(fig, env) {
  const { h, kit, T, ctx } = env, nn = ctx.nn;
  if (!nn || !nn.samples || !nn.samples.length) { fig.append(h('div.empty', null, kit.icon('alert', 28), h('h3', null, 'The network file is not loaded'), h('p', null, 'Reload the page. This figure runs the real network on its 30 bundled test windows.'))); return; }
  const N = nn.samples.length, ramp = T.heat.map(rgb), LO = -2.2, HI = 2.2;
  const colour = (v) => { const t = clamp((v - LO) / (HI - LO), 0, 1) * 5, i = Math.min(4, Math.floor(t)), f = t - i, a = ramp[i], b = ramp[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
  const off = document.createElement('canvas');
  function render(i) {
    const x = nn.samples[i].x, rows = x.length, cols = x[0].length; off.width = cols; off.height = rows;
    const oc = off.getContext('2d'), img = oc.createImageData(cols, rows);
    for (let r = 0; r < rows; r++) for (let t = 0; t < cols; t++) { const q = colour(x[r][t]), o = (r * cols + t) * 4; img.data[o] = q[0]; img.data[o + 1] = q[1]; img.data[o + 2] = q[2]; img.data[o + 3] = 255; }
    oc.putImageData(img, 0, 0);
  }
  const order = Array.from({ length: N }, (_, i) => i); for (let i = N - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const S = { at: 0, guess: null, res: null, n: 0, you: 0, net: 0 };
  const TRUTH_WORDS = { 'Empty room': 'An empty room', 'Empty room + fan': 'An empty room with a fan running', 'Person moving': 'A person, moving', 'Person standing still': 'A person, standing still', 'Person lying still': 'A person, lying still' };

  const heat = env.canvas('Heat map of one ten second Wi-Fi window: 52 rows by 200 time steps.', (c, W, H) => {
    const L = 46, R = 8, top = 8, B = 34, w = W - L - R, hh = H - top - B;
    c.imageSmoothingEnabled = false; c.drawImage(off, L, top, w, hh);
    c.strokeStyle = T.line2; c.lineWidth = 1; c.strokeRect(L - 0.5, top - 0.5, w + 1, hh + 1);
    for (let s = 0; s <= 10; s += 2) { const x = L + (s / 10) * w; vline(c, Math.min(x, L + w - 1), top + hh, top + hh + 4, T.line3); label(c, T, String(s), x, top + hh + 16, { align: s === 10 ? 'right' : s ? 'center' : 'left', mono: true, size: 10, color: T.text3 }); }
    label(c, T, 'Time, seconds', L + w / 2, H - 4, { align: 'center', color: T.text2 });
    for (const r of [1, 13, 26, 39, 52]) label(c, T, String(r), L - 6, top + ((r - 0.5) / 52) * hh, { align: 'right', base: 'middle', mono: true, size: 10, color: T.text3 });
    c.save(); c.translate(11, top + hh / 2); c.rotate(-Math.PI / 2); label(c, T, 'Input row (subcarrier)', 0, 0, { align: 'center', color: T.text2 }); c.restore();
  });

  const which = h('span.train-ls-meta.num');
  const bPerson = h('button.btn.btn-lg', { type: 'button', onclick: () => guess(true) }, kit.icon('person', 16), 'Person');
  const bNone = h('button.btn.btn-lg', { type: 'button', onclick: () => guess(false) }, 'No one');
  const meter = h('div.meter.lg', { role: 'meter', 'aria-label': 'Network output', 'aria-valuemin': '0', 'aria-valuemax': '1' });
  const out = h('b.num.train-ls-out'), verdict = h('span.tag'), wrap = h('div.meter-wrap', null, meter); wrap.style.setProperty('--mark', String(nn.threshold));
  const kvYou = h('dd'), kvNet = h('dd'), kvTruth = h('dd'), kvMs = h('dd.num');
  const reveal = h('div.train-ls-reveal', { 'aria-live': 'polite' },
    h('div.train-ls-outrow', null, h('span.label', null, 'Network output'), out, verdict),
    wrap,
    h('div.train-ls-scale.num', null, h('span', null, '0'), h('span', { style: { left: nn.threshold * 100 + '%' } }, 'alarm above ' + nn.threshold.toFixed(2)), h('span', null, '1')),
    h('dl.kv', null, h('dt', null, 'You said'), kvYou, h('dt', null, 'The network said'), kvNet, h('dt', null, 'What was really there'), kvTruth, h('dt', null, 'Time for this reading'), kvMs));
  const tYou = h('b.num'), tNet = h('b.num');
  const nextBtn = h('button.btn', { type: 'button', onclick: () => { S.at = (S.at + 1) % N; show(); } }, 'Next window', kit.icon('arrow-right', 14));
  const hint = h('p.train-ls-hint');

  function show() {
    S.guess = null; S.res = null; render(order[S.at]); heat.redraw();
    which.textContent = 'Window ' + (S.at + 1) + ' of ' + N;
    paint();
  }
  function guess(person) {
    if (S.res) return;
    S.guess = person; S.res = nn.inferSample(order[S.at]); S.n++;
    if (person === S.res.truthPerson) S.you++; if (S.res.says === S.res.truthPerson) S.net++;
    paint(); nextBtn.focus();
  }
  function paint() {
    const r = S.res, yes = (b) => (b ? 'Person' : 'No one'), mark = (ok) => h('span.train-ls-mark', { 'data-ok': String(ok) }, kit.icon(ok ? 'check' : 'close', 13), ok ? 'right' : 'wrong');
    bPerson.disabled = bNone.disabled = !!r; bPerson.setAttribute('aria-pressed', String(S.guess === true)); bNone.setAttribute('aria-pressed', String(S.guess === false));
    reveal.dataset.open = String(!!r); nextBtn.disabled = !r;
    hint.textContent = r ? '' : 'Bright bands that wander mean something moved. Flat stripes mean a quiet room, or a person lying still. Make your call, then the network runs.';
    meter.style.setProperty('--v', r ? r.person.toFixed(3) : '0'); meter.className = 'meter lg' + (r && r.says ? ' person' : '');
    meter.setAttribute('aria-valuenow', r ? r.person.toFixed(2) : '0');
    out.textContent = r ? r.person.toFixed(2) : '0.00';
    verdict.className = 'tag' + (r && r.says ? ' tag-person' : ''); verdict.textContent = r ? (r.says ? 'Says person' : 'Says no one') : 'Waiting for your call';
    kvYou.replaceChildren(...(r ? [yes(S.guess), mark(S.guess === r.truthPerson)] : ['—']));
    kvNet.replaceChildren(...(r ? [yes(r.says), mark(r.says === r.truthPerson)] : ['—']));
    kvTruth.textContent = r ? TRUTH_WORDS[r.truth] || r.truth : '—'; kvMs.textContent = r ? r.ms.toFixed(1) + ' ms on this computer' : '—';
    tYou.textContent = S.you + ' of ' + S.n; tNet.textContent = S.net + ' of ' + S.n;
  }
  fig.append(h('div.train-ls-window', null,
    h('div.train-ls-pane', null, figHead(h, 'This is all the network sees: ten seconds of Wi-Fi, 52 rows by 200 steps'), heat.box,
      h('div.legend', null, h('span', null, 'Weaker', h('i.ramp'), 'Stronger than the row’s average'), h('span.train-ls-grow'), which)),
    h('div.train-ls-side', null,
      h('h3', null, 'Is someone behind the wall?'), h('div.train-ls-guess', null, bPerson, bNone), hint, reveal,
      h('div.train-ls-spacer'),
      h('div.stat-row', null, h('div.stat.live', null, tYou, h('span', null, 'you, right so far')), h('div.stat.live', null, tNet, h('span', null, 'the network, right so far'))),
      nextBtn)));
  show();
}

// =====================================================================================================
// Lesson 1, screen c: what it can and cannot do. Measured results, then breathing against receiver noise.
// =====================================================================================================
function figLimits(fig, env) {
  const { h, T } = env;
  const row = (name, v, cls, sub) => h('div.train-ls-res' + (sub ? '.sub' : ''), null, h('span.train-ls-resname', null, name),
    h('div.train-ls-track', { role: 'img', 'aria-label': name + ': ' + v + ' percent' }, h('i.' + cls, { style: { width: v + '%' } })), h('b', null, v.toFixed(1), h('small', null, '%')));
  const results = h('div.train-ls-results', null,
    row('A moving person is found', FACT.moving, 'person'),
    row('A still person is found', FACT.still, 'person'),
    row('standing still', FACT.standing, 'person', true), row('lying still', FACT.lying, 'person', true),
    row('An empty room is called empty', FACT.empty, 'ok'),
    row('false alarm in an empty room', FACT.falseAlarm, 'warn', true),
    h('div.train-ls-axis.num', null, h('span', null, '0'), h('span', null, '25'), h('span', null, '50'), h('span', null, '75'), h('span', null, '100 %')));

  const NS = 200, rnd = mulberry32(955), noise = new Float64Array(NS);
  for (let i = 0; i < NS; i++) { const u = Math.max(1e-9, rnd()), v = rnd(); noise[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * FACT.noise; }
  let ampl = 0.2;
  const wave = (i) => ampl * Math.sin(2 * Math.PI * 0.25 * ((i / (NS - 1)) * 10));
  const trace = env.canvas('Ten seconds of one subcarrier: the clean breathing wave and the noisy samples the receiver records.', (c, W, H) => {
    const L = 46, R = 10, top = 10, B = 30, lim = 1.6, w = W - L - R, hh = H - top - B, y = (v) => top + hh / 2 - (clamp(v, -lim, lim) / lim) * (hh / 2), x = (i) => L + (i / (NS - 1)) * w;
    c.fillStyle = alpha(T.text3, 0.13); c.fillRect(L, y(FACT.noise), w, y(-FACT.noise) - y(FACT.noise));
    for (const v of [-1.5, -1, -0.5, 0, 0.5, 1, 1.5]) { hline(c, L, L + w, y(v), v === 0 ? T.line2 : T.line); label(c, T, (v > 0 ? '+' : '') + v.toFixed(1), L - 6, y(v), { align: 'right', base: 'middle', mono: true, size: 10, color: T.text3 }); }
    for (let s = 0; s <= 10; s += 2) label(c, T, String(s), L + (s / 10) * w, H - 16, { align: s === 10 ? 'right' : s ? 'center' : 'left', mono: true, size: 10, color: T.text3 });
    label(c, T, 'Time, seconds', L + w / 2, H - 3, { align: 'center', color: T.text2 });
    c.save(); c.translate(11, top + hh / 2); c.rotate(-Math.PI / 2); label(c, T, 'Change in amplitude, %', 0, 0, { align: 'center', color: T.text2 }); c.restore();
    c.fillStyle = alpha(T.text2, 0.85); for (let i = 0; i < NS; i++) { c.beginPath(); c.arc(x(i), y(wave(i) + noise[i]), 1.6, 0, 7); c.fill(); }
    c.beginPath(); for (let i = 0; i < NS; i++) (i ? c.lineTo(x(i), y(wave(i))) : c.moveTo(x(i), y(wave(i)))); c.strokeStyle = T.person; c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
    label(c, T, 'Receiver noise, about ±0.5 % per subcarrier', L + w - 4, y(FACT.noise) - 5, { align: 'right', size: 10.5, color: T.text2 });
    label(c, T, 'Breathing, as it would look with no noise', L + 6, top + 12, { size: 10.5, color: T.person, weight: 600 });
    label(c, T, 'What the receiver records', L + 6, top + 27, { size: 10.5, color: T.text2 });
  });
  const val = h('output.num'), verdict = h('p.train-ls-snr');
  const paint = () => { val.textContent = ampl.toFixed(2) + ' %'; const r = ampl / FACT.noise; verdict.replaceChildren(h('b.num', null, r.toFixed(1) + '×'), ' the noise. ' + (r < 0.3 ? 'The wave is buried. One subcarrier cannot show it.' : r < 0.7 ? 'A rhythm is there, but you would not swear to it.' : 'This is the strongest breathing gets, and it is still below the noise.')); trace.redraw(); };
  const sl = slider(h, { min: FACT.breathLo, max: FACT.breathHi, step: 0.01, value: ampl, name: 'Breathing amplitude, percent', oninput: (v) => { ampl = v; paint(); } });
  fig.append(h('div.train-ls-limits', null,
    h('div.train-ls-pane', null, figHead(h, 'Movement and stillness, by situation.', 'Share of 955 simulated test windows, people never seen in training.'), results,
      h('p.note.quiet', null, env.kit.icon('info', 15), h('span', null, 'A breathing estimate is within 3 a minute in ' + FACT.rateOk + ' % of the still people found, so the console shows movement and no rate.'))),
    h('div.train-ls-pane', null, figHead(h, 'Breathing sinks into the receiver’s own noise', 'Breathing changes the signal by 0.05 to 0.4 %. The noise stays at 0.5 %.'), trace.box,
      h('div.slider-row', null, h('span.label', null, 'Breathing amplitude'), sl, val), verdict)));
  paint();
}

// =====================================================================================================
// Lesson 2, screen a: each reading multiplies the odds. The real fuse() from core/fusion.js, run live.
// =====================================================================================================
const OFF = ['off', 'Not used'];
const SENSOR_ROWS = [
  { key: 'csi', sensor: 'csi', name: 'Wi-Fi neural network', short: 'Wi-Fi', opts: [OFF, ['pos', 'Person'], ['neg', 'No one']] },
  { key: 'radar', sensor: 'radar', name: 'Radar, moving target', short: 'Radar', opts: [OFF, ['pos', 'Movement'], ['neg', 'None']] },
  { key: 'micro', sensor: 'micro', name: 'Radar, breathing-sized motion', short: 'Breathing radar', opts: [OFF, ['pos', 'Seen'], ['neg', 'None']] },
  { key: 'thermal', sensor: 'thermal', name: 'Thermal camera', short: 'Thermal', opts: [OFF, ['pos', 'Warm'], ['faint', 'Faint'], ['neg', 'Cold'], ['blind', 'Blind']] },
  { key: 'signature', sensor: 'signature', name: 'Motion pattern', short: 'Pattern', opts: [OFF, ['machine', 'Steady, like a machine']] },
  { key: 'temperature', sensor: 'temperature', name: 'Temperature check', short: 'Temperature', opts: [OFF, ['tooHot', 'Too hot for skin']] },
  { key: 'thermal2', sensor: 'thermal', vantage: 'second look', name: 'Thermal, second look from a new place', short: 'Thermal again', opts: [OFF, ['pos', 'Warm'], ['faint', 'Faint'], ['neg', 'Cold']] },
];
const STORIES = [
  { id: 'moving', name: 'Moving person behind a wall', set: { csi: 'pos', radar: 'pos', thermal: 'blind' }, say: 'The network alarms and the radar tracks movement. The thermal camera waits for a clear view.' },
  { id: 'still', name: 'Still person', set: { csi: 'neg', micro: 'pos', thermal: 'faint' }, say: 'The network says no one. Breathing-sized motion and faint warmth keep the lead open.', then: { thermal2: 'pos' }, thenSay: 'From a new place the thermal camera sees clear warmth. Fresh evidence counts in full.' },
  { id: 'fan', name: 'Desk fan', set: { csi: 'neg', radar: 'pos', signature: 'machine', thermal: 'neg' }, say: 'The radar sees motion, but it is steady and nothing is warm. The lead closes.' },
  { id: 'pipe', name: 'Hot pipe', set: { csi: 'neg', radar: 'neg', thermal: 'pos', temperature: 'tooHot' }, say: 'The thermal camera sees heat, far hotter than skin, and nothing moves.' },
  { id: 'false', name: 'Wi-Fi alarm alone', set: { csi: 'pos', radar: 'neg', micro: 'neg' }, say: 'The network alarms alone. Both radars see nothing. The lead stays open, just.' },
];
const VERDICT = { confirmed: ['Confirmed', 'tag-person'], possible: ['Possible: stays open', 'tag-warn'], unlikely: ['Unlikely: lead closes', ''] };
const evidenceOf = (state) => SENSOR_ROWS.filter((r) => state[r.key] && state[r.key] !== 'off').map((r) => ({ sensor: r.sensor, result: state[r.key], vantage: r.vantage || 'first stop', row: r }));

function figEvidence(fig, env) {
  const { h, T } = env;
  const state = {}; let story = STORIES[0], second = false, res;
  const rows = SENSOR_ROWS.map((r) => {
    const lr = h('span.train-ls-lr.num'), assumed = LR[r.sensor].assumed;
    const control = seg(h, r.name, r.opts, 'off', (v) => { state[r.key] = v; story = null; update(); });
    const el = h('div.train-ls-sensor', null, h('span.train-ls-sname', null, r.name, assumedMark(h, assumed)), control.el, lr);
    return { r, el, control, lr };
  });
  const storyText = h('p.train-ls-story', { 'aria-live': 'polite' });
  const presets = h('div.train-ls-presets', { role: 'group', 'aria-label': 'Stories from the exercise' }, STORIES.map((s) => h('button.btn.btn-sm', { type: 'button', 'data-id': s.id, onclick: () => load(s) }, s.name)));
  function load(s, withSecond = false) {
    story = s; second = withSecond;
    for (const row of rows) { const v = (withSecond && s.then && s.then[row.r.key]) || s.set[row.r.key] || 'off'; state[row.r.key] = v; row.control.set(v); }
    update();
  }

  const big = h('b.num.train-ls-p'), tag = h('span.tag'), odds = h('span.train-ls-meta.num');
  const fill = h('i'), meter = h('div.train-ls-pmeter', { role: 'meter', 'aria-label': 'Probability that a person is there', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill,
    h('span.train-ls-tick', { style: { left: THRESHOLDS.possible * 100 + '%' } }, h('em', null, pct(THRESHOLDS.possible) + ' possible')),
    h('span.train-ls-tick', { style: { left: THRESHOLDS.confirmed * 100 + '%' } }, h('em', null, pct(THRESHOLDS.confirmed) + ' confirmed')));

  const fall = env.canvas('Waterfall of the odds on a log scale, one step per reading.', (c, W, H) => {
    const L = 50, R = 14, top = 16, B = 62, steps = res.steps, lo = Math.min(-2, Math.log10(res.odds) - 0.3, ...steps.map((s) => Math.log10(s.p / (1 - s.p)) - 0.3)), hi = Math.max(2, ...steps.map((s) => Math.log10(s.p / (1 - s.p)) + 0.3));
    const y = (o) => top + (1 - (Math.log10(o) - lo) / (hi - lo)) * (H - top - B), yp = (p) => y(p / (1 - p));
    for (const p of [0.001, 0.01, 0.05, 0.5, 0.95, 0.99, 0.999]) { if (yp(p) < top - 1 || yp(p) > H - B + 1) continue; hline(c, L, W - R, yp(p), T.line); label(c, T, (p * 100) + ' %', L - 6, yp(p), { align: 'right', base: 'middle', mono: true, size: 10, color: T.text3 }); }
    for (const [p, col, word] of [[THRESHOLDS.possible, T.warn, 'possible'], [THRESHOLDS.confirmed, T.person, 'confirmed']]) { hline(c, L, W - R, yp(p), alpha(col, 0.8), [5, 4]); label(c, T, (p * 100) + ' %', L - 6, yp(p), { align: 'right', base: 'middle', mono: true, size: 10, color: col }); label(c, T, word, W - R, yp(p) - 5, { align: 'right', size: 10.5, color: col }); }
    c.save(); c.translate(11, top + (H - top - B) / 2); c.rotate(-Math.PI / 2); label(c, T, 'Chance of a person (odds scale)', 0, 0, { align: 'center', color: T.text2 }); c.restore();
    const n = steps.length + 1, slot = (W - L - R) / Math.max(n, 5), bw = Math.min(54, slot * 0.46), cx = (i) => L + slot * (i + 0.5), base = H - B;
    const y0 = y(PRIOR / (1 - PRIOR));
    c.beginPath(); c.arc(cx(0), y0, 4.5, 0, 7); c.fillStyle = T.text; c.fill();
    label(c, T, pct(PRIOR), cx(0), y0 - 10, { align: 'center', mono: true, color: T.text }); label(c, T, 'Before any', cx(0), base + 16, { align: 'center', color: T.text2 }); label(c, T, 'reading', cx(0), base + 30, { align: 'center', color: T.text2 }); label(c, T, 'assumed', cx(0), base + 46, { align: 'center', color: T.sim, size: 10.5, weight: 600 });
    let prev = y0;
    steps.forEach((s, i) => {
      const x = cx(i + 1), yy = yp(s.p), up = s.lr > 1, flat = Math.abs(s.lr - 1) < 1e-9, col = flat ? T.text3 : up ? T.accent : T.text2;
      hline(c, cx(i) + (i ? bw / 2 : 6), x - bw / 2, prev, T.line3, [2, 3]);
      if (flat) { c.fillStyle = col; c.fillRect(x - bw / 2, prev - 1, bw, 2); }
      else {
        c.fillStyle = alpha(col, up ? 0.9 : 0.55); c.fillRect(x - bw / 2, Math.min(prev, yy), bw, Math.max(2, Math.abs(yy - prev)));
        c.beginPath(); const tip = yy, dir = up ? 1 : -1; c.moveTo(x - 5, tip + dir * 7); c.lineTo(x, tip + dir * 1); c.lineTo(x + 5, tip + dir * 7); c.strokeStyle = T.bg0; c.lineWidth = 1.6; c.stroke();
      }
      label(c, T, flat ? '×1' : times(s.lr), x, (up || flat ? Math.min(prev, yy) - 7 : Math.max(prev, yy) + 15), { align: 'center', mono: true, size: 11.5, weight: 600, color: T.text });
      const words = s.row.short.split(' '); label(c, T, words[0], x, base + 16, { align: 'center', color: T.text }); if (words[1]) label(c, T, words.slice(1).join(' '), x, base + 30, { align: 'center', color: T.text });
      label(c, T, flat ? 'no information' : s.assumed ? 'assumed' : 'measured', x, base + 46, { align: 'center', color: flat ? T.text3 : s.assumed ? T.sim : T.ok, size: 10.5, weight: 600 });
      if (s.repeat) label(c, T, 'half weight', x, base + 59, { align: 'center', color: T.text3, size: 10 });
      prev = yy;
    });
    const k = classify(res.p), endCol = k === 'confirmed' ? T.person : k === 'possible' ? T.warn : T.text2, xe = cx(steps.length);
    if (steps.length) { c.beginPath(); c.arc(xe + bw / 2 + 9, prev, 4.5, 0, 7); c.fillStyle = endCol; c.fill(); hline(c, xe + bw / 2, xe + bw / 2 + 5, prev, endCol); label(c, T, pct(res.p, res.p < 0.1 ? 1 : 0), xe + bw / 2 + 18, prev, { base: 'middle', mono: true, size: 12, weight: 600, color: endCol }); }
    else label(c, T, 'Pick what a sensor says. Each reading adds one step.', cx(0) + 24, y0, { base: 'middle', color: T.text3 });
    hline(c, L, W - R, base, T.line2);
  });

  function update() {
    res = fuse(evidenceOf(state));
    const byKey = new Map(res.steps.map((s) => [s.row.key, s]));
    for (const row of rows) { const s = byKey.get(row.r.key); row.lr.textContent = s ? (Math.abs(s.lr - 1) < 1e-9 ? '×1' : times(s.lr)) : ''; row.el.dataset.on = String(!!s); }
    const k = classify(res.p);
    big.textContent = pct(res.p, res.p < 0.1 ? 1 : 0); tag.className = 'tag ' + VERDICT[k][1]; tag.textContent = VERDICT[k][0];
    odds.textContent = 'odds ' + (res.odds >= 1 ? res.odds.toFixed(1) + ' to 1 for' : '1 to ' + (1 / res.odds).toFixed(1) + ' against');
    fill.style.width = res.p * 100 + '%'; fill.dataset.k = k; meter.setAttribute('aria-valuenow', (res.p * 100).toFixed(0));
    for (const b of presets.children) b.setAttribute('aria-pressed', String(!!story && b.dataset.id === story.id));
    storyText.replaceChildren(story ? (second ? story.thenSay : story.say) : 'Your own mix. Change any reading and the odds follow.');
    if (story && story.then) storyText.append(' ', h('button.btn.btn-sm', { type: 'button', onclick: () => load(story, !second) }, second ? 'Undo the second look' : 'Take a second look'));
    fall.redraw();
  }
  fig.append(h('div.train-ls-evidence', null,
    h('div.train-ls-pane', null, figHead(h, 'Set what each sensor says', 'Only the Wi-Fi network’s likelihood is measured. Radar and thermal values are assumed design numbers.'),
      h('div.train-ls-sensors', null, rows.map((r) => r.el)), h('div.train-ls-spacer'), h('span.label', null, 'Five stories from the exercise'), presets, storyText),
    h('div.train-ls-pane', null, figHead(h, 'One step per reading. Strong evidence moves the odds far, weak evidence a little.'),
      h('div.train-ls-result', null, big, h('div.train-ls-resultside', null, h('div.row', null, tag, odds), meter)), fall.box)));
  load(STORIES[0]);
}

// =====================================================================================================
// Lesson 2, screen b: listen again, or move? A repeat from the same place counts at half weight in fuse().
// =====================================================================================================
function figRepeat(fig, env) {
  const { h, T } = env, MAXN = 5;
  const OTHER = { none: [], quiet: [{ sensor: 'radar', result: 'neg', vantage: 'spot 1' }, { sensor: 'micro', result: 'neg', vantage: 'spot 1' }], warm: [{ sensor: 'thermal', result: 'faint', vantage: 'spot 1' }] };
  let n = 2, other = 'none', same = [], fresh = [];
  const run = (count, move) => fuse([...OTHER[other], ...Array.from({ length: count }, (_, i) => ({ sensor: 'csi', result: 'pos', vantage: move ? 'spot ' + (i + 1) : 'spot 1' }))]).p;
  const chart = env.canvas('Line chart: probability against the number of Wi-Fi alarms, for listening again from the same spot and for moving to a new place each time.', (c, W, H) => {
    const L = 50, R = 150, top = 14, B = 44, w = W - L - R, hh = H - top - B, x = (i) => L + (i / MAXN) * w, y = (p) => top + (1 - p) * hh;
    for (const p of [0, 0.25, 0.5, 0.75, 1]) { hline(c, L, L + w, y(p), T.line); label(c, T, (p * 100) + ' %', L - 6, y(p), { align: 'right', base: 'middle', mono: true, size: 10, color: T.text3 }); }
    for (const [p, col, word] of [[THRESHOLDS.possible, T.warn, '15 % possible'], [THRESHOLDS.confirmed, T.person, '85 % confirmed']]) { hline(c, L, L + w, y(p), alpha(col, 0.85), [5, 4]); label(c, T, word, L + 6, y(p) - 5, { size: 10.5, color: col }); }
    for (let i = 0; i <= MAXN; i++) label(c, T, String(i), x(i), top + hh + 16, { align: 'center', mono: true, size: 10.5, color: i === n ? T.text : T.text3, weight: i === n ? 700 : 500 });
    label(c, T, 'Wi-Fi alarms', L + w / 2, H - 6, { align: 'center', color: T.text2 });
    c.save(); c.translate(11, top + hh / 2); c.rotate(-Math.PI / 2); label(c, T, 'Chance of a person', 0, 0, { align: 'center', color: T.text2 }); c.restore();
    vline(c, x(n), top, top + hh, T.line3);
    for (const [arr, col, name] of [[same, T.text2, 'Same spot'], [fresh, T.accent, 'New place each time']]) {
      c.lineJoin = 'round';
      c.beginPath(); arr.forEach((p, i) => (i ? c.lineTo(x(i), y(p)) : c.moveTo(x(i), y(p)))); c.strokeStyle = alpha(col, 0.3); c.lineWidth = 2; c.stroke();
      c.beginPath(); arr.slice(0, n + 1).forEach((p, i) => (i ? c.lineTo(x(i), y(p)) : c.moveTo(x(i), y(p)))); c.strokeStyle = col; c.lineWidth = 2.5; c.stroke();
      arr.forEach((p, i) => { c.beginPath(); c.arc(x(i), y(p), i === n ? 5 : 3, 0, 7); c.fillStyle = i <= n ? col : T.bg0; c.fill(); c.strokeStyle = i <= n ? T.bg0 : alpha(col, 0.6); c.lineWidth = 1.5; c.stroke(); });
    }
    // direct labels at the right end, kept apart
    let ya = y(fresh[MAXN]), yb = y(same[MAXN]); if (Math.abs(ya - yb) < 30) { const m = (ya + yb) / 2; ya = m - 15; yb = m + 15; }
    label(c, T, 'New place each time', L + w + 12, ya, { base: 'middle', color: T.accent, weight: 600 }); label(c, T, pct(fresh[n]) + ' after ' + n, L + w + 12, ya + 14, { base: 'middle', mono: true, size: 10.5, color: T.accent });
    label(c, T, 'Same spot', L + w + 12, yb, { base: 'middle', color: T.text2, weight: 600 }); label(c, T, pct(same[n]) + ' after ' + n, L + w + 12, yb + 14, { base: 'middle', mono: true, size: 10.5, color: T.text2 });
  });
  const bSame = h('b.num'), bFresh = h('b.num'), bGap = h('b.num'), needs = h('p.train-ls-story');
  const firstOver = (move) => { for (let i = 1; i <= 12; i++) if (run(i, move) >= THRESHOLDS.confirmed) return i; return null; };
  function update() {
    same = Array.from({ length: MAXN + 1 }, (_, i) => run(i, false)); fresh = Array.from({ length: MAXN + 1 }, (_, i) => run(i, true));
    bSame.textContent = pct(same[n]); bFresh.textContent = pct(fresh[n]); bGap.textContent = '+' + ((fresh[n] - same[n]) * 100).toFixed(0) + ' points';
    const a = firstOver(false), b = firstOver(true), word = (k) => (k == null ? 'more than 12 alarms' : k + (k === 1 ? ' alarm' : ' alarms'));
    needs.textContent = 'To reach 85 % with this evidence: ' + word(a) + ' from the same spot, ' + word(b) + ' if the rover moves each time.';
    chart.redraw();
  }
  const count = seg(h, 'Number of Wi-Fi alarms', [1, 2, 3, 4, 5].map((v) => [v, String(v)]), n, (v) => { n = v; update(); });
  const others = seg(h, 'Other evidence at the first spot', [['none', 'Wi-Fi alone'], ['quiet', 'Both radars see nothing'], ['warm', 'Thermal sees faint warmth']], other, (v) => { other = v; update(); });
  fig.append(h('div.train-ls-pane.train-ls-repeat', null,
    figHead(h, 'A second look from a new place is worth more than listening twice', 'A repeat from the same sensor in the same place counts at half weight: the square root of its likelihood ratio.'),
    h('div.train-ls-bar', null, h('span.label', null, 'Wi-Fi alarms'), count.el, h('span.train-ls-gap'), h('span.label', null, 'Also at the first spot'), others.el, assumedMark(h, true)),
    chart.box,
    h('div.train-ls-foot', null, h('div.stat-row', null, h('div.stat.live', null, bSame, h('span', null, 'listening again, same spot')), h('div.stat.live', null, bFresh, h('span', null, 'a new place each time')), h('div.stat.live', null, bGap, h('span', null, 'what moving is worth'))), needs)));
  update();
}

// =====================================================================================================
// Lesson 3, screen a: 21 % is not a no.
// =====================================================================================================
function figRooms(fig, env) {
  const { h } = env;
  const lone = Math.round(fuse([{ sensor: 'csi', result: 'pos' }, { sensor: 'radar', result: 'neg' }, { sensor: 'micro', result: 'neg' }]).p * 100);
  const rnd = mulberry32(21), order = Array.from({ length: 100 }, (_, i) => i); for (let i = 99; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const rank = new Array(100); order.forEach((cell, r) => { rank[cell] = r; });
  const cells = Array.from({ length: 100 }, () => h('i'));
  const grid = h('div.train-ls-rooms', { role: 'img' }, cells);
  const big = h('b.num.train-ls-p'), tag = h('span.tag'), line = h('p.train-ls-walk', { 'aria-live': 'polite' }), why = h('p.train-ls-story');
  let v = lone;
  const sl = slider(h, { min: 0, max: 100, step: 1, value: v, name: 'Probability shown on the lead, percent', oninput: (x) => { v = x; paint(); } });
  function paint() {
    cells.forEach((c, i) => { c.dataset.on = String(rank[i] < v); });
    grid.setAttribute('aria-label', v + ' of 100 rooms hold a person');
    const k = classify(v / 100); big.textContent = v + ' %'; tag.className = 'tag ' + VERDICT[k][1]; tag.textContent = VERDICT[k][0];
    line.replaceChildren('Dismiss every lead like this and you walk away from ', h('b', null, v + (v === 1 ? ' person' : ' people')), ' in 100.');
    why.textContent = k === 'unlikely' ? 'Below 15 % the console closes the lead. ' + v + ' in 100 is the risk it accepts so that teams are not sent to every flicker.'
      : k === 'possible' ? 'From 15 % the lead stays open. A missed person costs far more than a second look, so the console asks for one.'
        : 'From 85 % the console calls it confirmed and a team can be sent. ' + (100 - v) + ' in 100 would still be an empty room.';
  }
  const zones = h('div.train-ls-zones', { 'aria-hidden': 'true' },
    h('span', { style: { width: '15%' } }, 'Closes'), h('span.warn', { style: { width: '70%' } }, 'Possible: stays open, look again'), h('span.person', { style: { width: '15%' } }, 'Confirmed'),
    h('em', { style: { left: '15%' } }, '15 %'), h('em', { style: { left: '85%' } }, '85 %'));
  const again = h('button.btn.btn-sm', { type: 'button', onclick: () => { v = lone; sl.value = String(lone); sl.sync(); paint(); } }, 'A lone Wi-Fi alarm: ' + lone + ' %');
  fig.append(h('div.train-ls-prob', null,
    h('div.train-ls-pane', null, figHead(h, 'Out of 100 rooms that look like this one, this many hold a person'), h('div.train-ls-roomswrap', null, grid),
      h('div.legend', null, h('span', null, h('i.p1'), 'A person is there'), h('span', null, h('i.p4'), 'Empty'))),
    h('div.train-ls-side.wide', null,
      h('span.label', null, 'Probability shown on the lead'), h('div.train-ls-result', null, big, h('div.train-ls-resultside', null, tag)),
      h('div.train-ls-slwrap', null, sl, zones), again,
      h('div.train-ls-spacer'), line, why,
      h('p.note.quiet', null, env.kit.icon('info', 15), h('span', null, lone + ' % is what this console gives a Wi-Fi alarm when both radars see nothing, computed now by the fusion code. The radar numbers in it are assumed.')))));
  paint();
}

// =====================================================================================================
// Lesson 3, screen b: the alarm is not the answer. Base rates, drawn as 1,000 rooms.
// =====================================================================================================
function figBaseRate(fig, env) {
  const { h, T } = env, HIT = FACT.hit / 100, FA = FACT.falseAlarm / 100, COLS = 50, ROWS = 20;
  let guess = 80, prior = PRIOR * 100, shown = false;
  const answer = () => { const p = prior / 100; return (p * HIT) / (p * HIT + (1 - p) * FA); };
  const counts = () => { const people = Math.round(prior * 10), hit = Math.round(people * HIT), fa = Math.round((1000 - people) * FA); return { people, hit, miss: people - hit, fa, quiet: 1000 - people - fa }; };
  const mosaic = env.canvas('One thousand rooms as small squares, split into rooms with a person and empty rooms, with the alarms marked.', (c, W, H) => {
    const top = 40, B = 40, cell = Math.floor(Math.min((W - 4) / COLS, (H - top - B) / ROWS)), gw = cell * COLS, x0 = Math.round((W - gw) / 2), q = counts();
    const kind = (i) => (!shown ? 'quiet' : i < q.miss ? 'miss' : i < q.people ? 'hit' : i < q.people + q.fa ? 'fa' : 'quiet');
    for (let i = 0; i < 1000; i++) {
      const col = Math.floor(i / ROWS), row = i % ROWS, x = x0 + col * cell, y = top + row * cell, k = kind(i), s = cell - 2;
      if (k === 'hit') { c.fillStyle = T.person; c.fillRect(x, y, s, s); }
      else if (k === 'miss') { c.strokeStyle = T.person; c.lineWidth = 1.2; c.strokeRect(x + 0.6, y + 0.6, s - 1.2, s - 1.2); }
      else if (k === 'fa') { c.fillStyle = T.warn; c.fillRect(x, y, s, s); }
      else { c.fillStyle = T.bg4; c.fillRect(x, y, s, s); }
    }
    if (!shown) { label(c, T, '1,000 rooms. Some hold a person. The network has listened to every one.', x0, top - 14, { color: T.text2, size: 12 }); return; }
    const colX = (n) => x0 + (n / ROWS) * cell, br = (a, b, y, colr, text, below) => { const xa = colX(a), xb = Math.max(colX(b), xa + 6), d = below ? -5 : 5; c.beginPath(); c.moveTo(xa, y + d); c.lineTo(xa, y); c.lineTo(xb - 2, y); c.lineTo(xb - 2, y + d); c.strokeStyle = colr; c.lineWidth = 1.5; c.stroke(); label(c, T, text, xa, below ? y + 16 : y - 7, { color: colr, weight: 600, size: 11.5 }); };
    br(0, q.people, top - 10, T.person, q.people + ' rooms hold a person', false);
    br(q.miss, q.people + q.fa, top + ROWS * cell + 8, T.text, 'The network says person in ' + (q.hit + q.fa) + ' rooms: ' + q.hit + ' right, ' + q.fa + ' false alarms', true);
  });
  const gOut = h('output.num'), gSl = slider(h, { min: 0, max: 100, step: 1, value: guess, name: 'Your guess, percent', oninput: (x) => { guess = x; paint(); } });
  const pOut = h('output.num'), pSl = slider(h, { min: 1, max: 50, step: 1, value: prior, name: 'Rooms that hold a person before any reading, percent', oninput: (x) => { prior = x; paint(); } });
  const showBtn = h('button.btn', { type: 'button', onclick: () => { shown = true; paint(); pSl.focus(); } }, 'Show the answer');
  const ans = h('b.num.train-ls-p'), sum = h('p.train-ls-walk'), gapLine = h('p.train-ls-story', { 'aria-live': 'polite' });
  const answerBox = h('div.train-ls-answer', null,
    h('span.label', null, 'A person is really there in'), h('div.train-ls-result', null, ans), sum, gapLine,
    h('div.train-ls-priorrow', null, h('span.label', null, 'Rooms that hold a person before any reading ', assumedMark(h, true)), h('div.slider-row', null, pSl, pOut)));
  function paint() {
    gOut.textContent = guess + ' %'; pOut.textContent = prior + ' %'; gSl.disabled = shown; showBtn.hidden = shown; answerBox.hidden = !shown;
    if (shown) {
      const q = counts(), a = answer(), gap = Math.abs(guess - a * 100);
      ans.textContent = pct(a); sum.replaceChildren(h('b.c-person', null, q.hit + ' true alarms'), ' out of ', h('b', null, (q.hit + q.fa) + ' alarms'), '. The other ', h('b.c-warn', null, String(q.fa)), ' are empty rooms.');
      gapLine.textContent = 'You guessed ' + guess + ' %. ' + (gap < 5 ? 'That is within 5 points. Most people guess far higher.' : 'That is ' + gap.toFixed(0) + ' points ' + (guess > a * 100 ? 'too high' : 'too low') + '. Empty rooms outnumber people, so their alarms add up.');
      mosaic.describe('One thousand rooms: ' + q.people + ' hold a person, the network alarms in ' + (q.hit + q.fa) + ', and ' + q.hit + ' of those alarms are right.');
    }
    mosaic.redraw();
  }
  fig.append(h('div.train-ls-base', null,
    h('div.train-ls-pane', null, figHead(h, 'Most alarms come from empty rooms, because most rooms are empty', 'Alarm rates measured on 955 simulated test windows: ' + FACT.hit + ' % when a person is there, ' + FACT.falseAlarm + ' % when the room is empty.'), mosaic.box,
      h('div.legend', null, h('span', null, h('i.p1'), 'Person, alarm'), h('span', null, h('i.p2'), 'Person, quiet'), h('span', null, h('i.p3'), 'Empty, alarm'), h('span', null, h('i.p4'), 'Empty, quiet'))),
    h('div.train-ls-side.wide', null,
      h('h3', null, 'The network says person. How likely is it that someone is there?'),
      h('div.slider-row', null, h('span.label', null, 'Your guess'), gSl, gOut), showBtn, answerBox)));
  paint();
}

// =====================================================================================================
// Lesson 4: the planner. The real grid (world.buildGrid), the real A* (core/planner.js), the real site plan.
// =====================================================================================================
const GOAL = [96.5, 70], WALK_MPS = 1.1, DEBRIS_M = 4;
const AVOID_ROWS = [['slope', 'Avoid the unstable slope'], ['mud', 'Avoid deep mud'], ['gas', 'Avoid the gas leak'], ['collapse', 'Avoid the collapse zone']];
const HAZ_WORD = { slope: 'unstable slope', mud: 'deep mud', gas: 'gas leak', collapse: 'collapse zone', debris: 'new debris', slide: 'new slide' };
const square = (p, size, id, kind, name) => ({ id, kind, name, block: true, poly: [[p[0] - size / 2, p[1] - size / 2], [p[0] + size / 2, p[1] - size / 2], [p[0] + size / 2, p[1] + size / 2], [p[0] - size / 2, p[1] + size / 2]] });

function makePlanner(world) {
  const grids = new Map();
  // Grids are built once per avoid setting (about a tenth of a second each) and copied when blockages are added.
  function gridFor(avoid, blocks) {
    const key = AVOID_ROWS.map(([k]) => (avoid[k] === false ? 0 : 1)).join('');
    if (!grids.has(key)) grids.set(key, world.buildGrid({ avoid }));
    const base = grids.get(key); if (!blocks.length) return base;
    const g = { ...base, blocked: base.blocked.slice() }, pad = 0.4;
    for (const b of blocks) {
      const xs = b.poly.map((p) => p[0]), ys = b.poly.map((p) => p[1]);
      const i0 = Math.max(0, Math.floor((Math.min(...xs) - pad) / g.res)), i1 = Math.min(g.w - 1, Math.floor((Math.max(...xs) + pad) / g.res)), j0 = Math.max(0, Math.floor((Math.min(...ys) - pad) / g.res)), j1 = Math.min(g.h - 1, Math.floor((Math.max(...ys) + pad) / g.res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) g.blocked[j * g.w + i] = 1;
    }
    return g;
  }
  // blocks: new blocking hazards the planner knows about. unseen: hazards that exist but were not on its map.
  function plan(avoid, blocks = [], unseen = []) {
    const res = planPath(gridFor(avoid, blocks), world.SITE.staging, GOAL, { nearest: true });
    if (!res.ok) return res;
    const exposure = exposureAlong(res.path, [...world.HAZARDS, ...blocks, ...unseen]);
    return { ...res, exposure, minutes: res.length / WALK_MPS / 60, inside: (kind) => exposure.by.filter((x) => x.hz.kind === kind).reduce((s, x) => s + x.m, 0) };
  }
  return { plan };
}
const ALL = { slope: true, mud: true, gas: true, collapse: true };
const planScene = (world, o) => ({ hazards: o.hazards || [], avoid: o.avoid, routes: o.routes, hazardLabels: true,
  markers: [{ pos: GOAL, kind: 'possible', label: 'Possible person' }], units: [{ kind: 'team', pos: world.SITE.staging, label: 'Rescue team' }] });

function figPlanner(fig, env) {
  const { h, kit, ctx } = env, world = ctx.world, P = makePlanner(world);
  const avoid = { ...ALL }; let debris = [], route = null; const careful = P.plan(ALL);
  const canvas = h('canvas', { role: 'img', 'aria-label': 'Site plan with the hazards and the planned route from the staging point to the possible person in the debris field.' }), box = h('div.train-ls-cv.train-ls-map', null, canvas);
  const plan = createPlan(canvas, { view: [4, 2, 118, 84], interactive: false, onPick: (id, m, pt) => { if (pt) drop(pt); },
    scene: () => planScene(world, { hazards: debris, avoid, routes: route && route.ok ? [{ path: route.path, spans: route.exposure.spans, end: true, width: 3 }] : [] }) });
  env.cleanup(() => plan.destroy());
  canvas.style.cursor = 'crosshair';
  const nLen = h('b.num'), nMin = h('b.num'), nIn = h('b.num'), delta = h('p.train-ls-story', { 'aria-live': 'polite' });
  const hz = h('dl.kv.num'), clear = h('button.btn.btn-sm', { type: 'button', onclick: () => { debris = []; replan(); } }, kit.icon('trash', 14), 'Clear debris');
  const dropBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => { if (route && route.ok) drop(pointAlong(route.path, route.length * 0.45)); } }, kit.icon('plus', 14), 'Drop debris on the route');
  function drop(pt) { debris = [...debris, square(pt, DEBRIS_M, 'debris-' + (debris.length + 1), 'debris', 'New debris')]; replan(); }
  function replan() {
    route = P.plan(avoid, debris);
    clear.disabled = !debris.length; dropBtn.disabled = !route.ok;
    if (!route.ok) { nLen.textContent = nMin.textContent = nIn.textContent = '—'; hz.replaceChildren(); delta.textContent = route.reason + ' Clear the debris to plan again.'; plan.draw(); return; }
    nLen.replaceChildren(route.length.toFixed(0), h('small', null, 'm')); nMin.replaceChildren(route.minutes.toFixed(1), h('small', null, 'min')); nIn.replaceChildren(route.exposure.total.toFixed(1), h('small', null, 'm')); nIn.dataset.bad = String(route.exposure.total > 0.5);
    hz.replaceChildren(...AVOID_ROWS.flatMap(([k]) => { const m = route.inside(k); return [h('dt', null, 'Inside the ' + HAZ_WORD[k]), h('dd', { 'data-bad': String(m > 0.5) }, m.toFixed(1) + ' m')]; }));
    const d = route.length - careful.length, off = AVOID_ROWS.filter(([k]) => avoid[k] === false).length;
    delta.textContent = (!route.reached ? 'The route stops ' + route.gap.toFixed(1) + ' m short of the person. ' : '')
      + (off || debris.length ? 'Against the careful route (' + careful.length.toFixed(0) + ' m, 0 m in hazards): ' + (Math.abs(d) < 0.5 ? 'the same length' : Math.abs(d).toFixed(0) + ' m ' + (d > 0 ? 'longer' : 'shorter')) + ', ' + route.exposure.total.toFixed(1) + ' m inside hazards.' + (debris.length ? ' Planned again around ' + debris.length + (debris.length === 1 ? ' new blockage.' : ' new blockages.') : '')
        : 'Everything avoided. The planner goes round the west side of the block and stays out of every marked hazard.');
    plan.draw();
  }
  const checks = AVOID_ROWS.map(([k, text]) => { const input = h('input', { type: 'checkbox', checked: true, onchange: () => { avoid[k] = input.checked; replan(); } }); return h('label.check', null, input, text); });
  fig.append(h('div.train-ls-planner', null,
    h('div.train-ls-pane', null, figHead(h, 'The planner gives the cheapest route for the rules it was given', 'Click the plan to drop a 4 m square of debris. The route is planned again at once.'), box),
    h('div.train-ls-side', null,
      h('h3', null, 'What the planner must avoid'), h('div.train-ls-checks', null, checks),
      h('hr.divider'),
      h('div.stat-row', null, h('div.stat.live', null, nLen, h('span', null, 'route length')), h('div.stat.live', null, nMin, h('span', null, 'on foot at 1.1 m/s')), h('div.stat.live', null, nIn, h('span', null, 'inside hazards'))),
      hz, delta, h('div.train-ls-spacer'), h('div.row.wrap', null, dropBtn, clear))));
  replan();
}

function figApprove(fig, env) {
  const { h, kit, ctx } = env, world = ctx.world, P = makePlanner(world);
  const careful = P.plan(ALL), noSlope = P.plan({ ...ALL, slope: false });
  // The slide lands on the careful route after it was planned: the proposal is drawn from the old map.
  const slide = { ...square(pointAlong(careful.path, careful.length * 0.62), 9, 'hz-slide', 'slide', 'New slide'), name: 'New slide, 4 minutes after planning' };
  const stale = P.plan(ALL, [], [slide]), fresh = P.plan(ALL, [slide]);
  const m1 = noSlope.inside('slope'), m3 = stale.inside('slide');
  const CASES = [
    { name: 'Proposal 1', route: noSlope, avoid: { ...ALL, slope: false }, hazards: [], tone: null, right: 'reject', facts: [['Length', noSlope.length.toFixed(0) + ' m'], ['On foot', noSlope.minutes.toFixed(1) + ' min'], ['Planned with', 'slope avoidance off'], ['Map age', 'current']],
      approve: 'Not this one. It puts ' + m1.toFixed(0) + ' m of the walk on the unstable slope. The careful route is ' + careful.length.toFixed(0) + ' m against ' + noSlope.length.toFixed(0) + ' m and spends 0 m in hazards.',
      reject: 'Right. ' + m1.toFixed(0) + ' m of this route is on the unstable slope. Planned with the slope avoided, the route is ' + careful.length.toFixed(0) + ' m against ' + noSlope.length.toFixed(0) + ' m, with 0 m in hazards.' },
    { name: 'Proposal 2', route: careful, avoid: ALL, hazards: [], tone: null, right: 'approve', facts: [['Length', careful.length.toFixed(0) + ' m'], ['On foot', careful.minutes.toFixed(1) + ' min'], ['Planned with', 'every hazard avoided'], ['Map age', 'current']],
      approve: 'Right. ' + careful.length.toFixed(0) + ' m, ' + careful.minutes.toFixed(1) + ' minutes on foot, 0 m inside any marked hazard, on a current map. This is what a good proposal looks like.',
      reject: 'This one was sound: ' + careful.length.toFixed(0) + ' m, 0 m inside any marked hazard, planned on a current map. Rejecting a good route keeps the person waiting.' },
    { name: 'Proposal 3', route: stale, avoid: ALL, hazards: [slide], tone: 'danger', right: 'reject', facts: [['Length', stale.length.toFixed(0) + ' m'], ['On foot', stale.minutes.toFixed(1) + ' min'], ['Planned with', 'every hazard avoided'], ['Map age', 'planned 4 minutes before the slide']],
      approve: 'Not this one. The route was planned before the slide and runs ' + m3.toFixed(0) + ' m straight through it. Planned again on the new map it is ' + (fresh.ok ? fresh.length.toFixed(0) + ' m and clear.' : 'blocked: ' + fresh.reason),
      reject: 'Right. The planner did nothing wrong: its map was 4 minutes old. The route crosses ' + m3.toFixed(0) + ' m of the new slide. Planned again it is ' + (fresh.ok ? fresh.length.toFixed(0) + ' m and clear.' : 'blocked: ' + fresh.reason) },
  ];
  let at = 0; const done = CASES.map(() => null);
  const canvas = h('canvas', { role: 'img', 'aria-label': 'Site plan with a proposed rescue route.' }), box = h('div.train-ls-cv.train-ls-map', null, canvas);
  const plan = createPlan(canvas, { view: [4, 2, 118, 84], interactive: false,
    scene: () => { const c = CASES[at], routes = [{ path: c.route.path, spans: c.route.exposure.spans, end: true, width: 3, tone: c.tone }]; if (done[at] && c.right === 'reject') routes.unshift({ path: (at === 2 ? fresh : careful).path, tone: 'ghost', dash: [5, 5], arrows: false }); return planScene(world, { hazards: c.hazards, avoid: c.avoid, routes }); } });
  env.cleanup(() => plan.destroy());
  const tabs = seg(h, 'Route proposals', CASES.map((c, i) => [i, c.name]), 0, (i) => { at = i; paint(); });
  const facts = h('dl.kv'), feedback = h('div.train-ls-feedback', { 'aria-live': 'polite' }), score = h('span.train-ls-meta.num');
  const bApprove = h('button.btn.btn-lg', { type: 'button', onclick: () => decide('approve') }, kit.icon('check', 16), 'Approve'), bReject = h('button.btn.btn-lg', { type: 'button', onclick: () => decide('reject') }, kit.icon('close', 16), 'Reject');
  const title = h('h3'), nextCase = h('button.btn.btn-sm', { type: 'button', onclick: () => { at = (at + 1) % CASES.length; tabs.set(at); paint(); } }, 'Next proposal', kit.icon('arrow-right', 14));
  function decide(what) { if (done[at]) return; done[at] = what; paint(); if (at < CASES.length - 1) nextCase.focus(); }
  function paint() {
    const c = CASES[at], d = done[at];
    title.textContent = c.name + ' of ' + CASES.length + ': approve or reject?';
    facts.replaceChildren(...c.facts.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
    bApprove.disabled = bReject.disabled = !!d; bApprove.setAttribute('aria-pressed', String(d === 'approve')); bReject.setAttribute('aria-pressed', String(d === 'reject'));
    feedback.replaceChildren(); feedback.dataset.state = d ? (d === c.right ? 'right' : 'wrong') : 'open';
    if (d) feedback.append(h('p.note.' + (d === c.right ? 'ok' : 'warn'), null, kit.icon(d === c.right ? 'check-circle' : 'alert', 15), h('span', null, c[d])));
    else feedback.append(h('p.train-ls-hint', null, 'Read the route on the plan before you decide. Red stretches are inside a hazard.'));
    const n = done.filter(Boolean).length; score.textContent = n ? done.filter((x, i) => x === CASES[i].right).length + ' of ' + n + ' right' : '';
    nextCase.hidden = !d || done.every(Boolean);
    canvas.setAttribute('aria-label', 'Site plan with ' + c.name.toLowerCase() + ': ' + c.route.length.toFixed(0) + ' metres, ' + c.route.exposure.total.toFixed(0) + ' metres inside hazards.');
    plan.draw();
  }
  fig.append(h('div.train-ls-planner', null,
    h('div.train-ls-pane', null, h('div.train-ls-bar', null, tabs.el, h('span.train-ls-grow'), score), box),
    h('div.train-ls-side', null, title, facts, h('div.train-ls-guess', null, bApprove, bReject), feedback, nextCase, h('div.train-ls-spacer'),
      h('ul.train-ls-facts', null,
        h('li', null, kit.icon('cpu', 15), h('span', null, 'Software plans. A named person approves, and the approval is logged.')),
        h('li', null, kit.icon('power', 15), h('span', null, 'On the real rover the Arduino stops the motors by itself 400 ms after the Raspberry Pi goes quiet.'))))));
  paint();
}

// ---------- the screens ----------
const SIM_NOTE = 'Simulated test windows.';
const SCREENS = {
  wifi: [
    { head: 'A body changes the echoes', build: figEchoes, tag: 'live-algo', label: 'Teaching model with a handful of echoes. The real training simulator uses 3 to 8 echoes and a full body.',
      text: ['Wi-Fi reaches the rover by a direct ray and by echoes off the walls. They add up differently on each of 51 subcarriers.', 'Drag the person. A body blocks some paths and scatters a new one, so the whole pattern shifts.', 'Now switch to breathing only. The chest moves 4 mm and the pattern barely stirs.'],
      remember: 'Movement is loud. Breathing is quieter than the receiver’s own noise.' },
    { head: 'Ten seconds in, one answer out', build: figWindow, tag: 'live-ai', label: SIM_NOTE,
      text: ['The rover stops and listens for ten seconds. The network reads that one window and gives a number from 0 to 1.', 'Above 0.53 it says person. The line was set so that about one empty room in ten raises an alarm.', 'Make your call first. Then the real network runs here, on a test window it never saw in training.'],
      remember: 'One window, one number, one threshold. Radar adds the position.' },
    { head: 'What it hears', build: figLimits, tag: 'sim', label: 'Measured on 955 simulated test windows.',
      text: ['In simulation the network finds most moving people and most empty rooms.', 'A still person is the job of radar and heat. Move the slider to see why: breathing is smaller than the noise.'],
      remember: 'This is why HOUND adds radar and thermal, and asks for a second look.' },
  ],
  fusion: [
    { head: 'Each reading multiplies the odds', build: figEvidence, tag: 'live-algo', label: 'The console’s own fusion code, running now. Radar and thermal likelihoods are design values.',
      text: ['Before any reading the console assumes one room in ten holds a person. Each reading multiplies those odds.', 'A reading that is far more common with a person than without multiplies by a lot. A weak one barely moves it.', 'Load a story, then change one reading and watch which step matters.'],
      remember: 'No single sensor decides. Agreement confirms, and one strong “no” can close a lead.' },
    { head: 'Listen again, or move?', build: figRepeat, tag: 'live-algo', label: 'Computed by the same fusion code. The half-weight rule for repeats is a design value.',
      text: ['A fresh place gives fresh evidence. The same spot repeats the same echoes.', 'So the console counts a repeat at half weight. A reading from a new place counts in full.'],
      remember: 'When a lead is stuck at possible, move the rover. Do not just listen again.' },
  ],
  probability: [
    { head: '21 % is not a no', build: figRooms, tag: 'live-algo', label: 'The thresholds are the console’s. The prior and the radar likelihoods are design values.',
      text: ['A probability is a count. 21 % means: of 100 rooms that look like this, about 21 hold a person.', 'Move the slider across the two lines the console uses and read what each one asks of you.'],
      remember: 'Possible means look again. Only a second reading, or a person, closes a lead.' },
    { head: 'The alarm is not the answer', build: figBaseRate, tag: 'live-algo', label: 'Alarm rates from 955 simulated test windows. The share of rooms with a person is a design value.',
      text: ['The network says person. Before you look at anything else, how sure should you be?', 'Guess first. Then count it out over 1,000 rooms.'],
      remember: 'An alarm starts the question. How common people are, and what else agrees, finishes it.' },
  ],
  approval: [
    { head: 'The planner answers the question it was asked', build: figPlanner, tag: 'live-algo', label: 'The console’s planner on the simulated site. The hazards are invented for the exercise.',
      text: ['The planner finds the cheapest way from the team to the person, under the rules it is given.', 'Switch off one rule. The length hardly changes, but the route now crosses the hazard.', 'It will never tell you a rule was missing. It only answers what it was asked.'],
      remember: 'A short route is not a safe route. Check what the planner was told to avoid.' },
    { head: 'Approve or reject?', build: figApprove, tag: 'live-algo', label: 'Three proposals computed now by the same planner. The slide is scripted for this lesson.',
      text: ['Three proposals arrive. Each looks reasonable at a glance.', 'Check the red stretches, the rules it was planned with, and how old the map is.'],
      remember: 'The planner proposes. You approve, with your name on it.' },
  ],
};
