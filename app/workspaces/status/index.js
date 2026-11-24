// System check: proof. Demo is three full-bleed scenes (the proof wall, the drill film, what is real). Advanced is the
// workbench (advanced.js): results and evidence, live fault drills, the ledger, accessibility, device and offline.
import { SUITE } from './suite.js';
import { createRunner } from './runner.js';
import { createWall } from './wall.js';
import { createDrillFilm, FILM } from './film.js';
import { createAdvanced } from './advanced.js';
import { createRealWall } from './real.js';
import { ALL, checkBuilt } from './ledger.js';
import { asked } from '../../global/a11y.js';

export const VERDICT = { pass: 'Pass', limit: 'Pass, with known limits', fail: 'Fail' };

export default {
  async mount(root, ctx) {
    const { h, icon, realityTag, cssVar, reducedMotion } = ctx.kit;
    if (!document.querySelector('link[data-status-css]')) await new Promise((r) => document.head.append(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href, 'data-status-css': '1', onload: r, onerror: r })));
    root.classList.add('status-ws');

    // ---------- results, shared by both modes ----------
    const store = { checks: new Map(), results: new Map(), running: new Set(), out: null, error: null, busy: false, counts: { p: 0, f: 0, l: 0 } }, subs = new Set(), say = (m) => { for (const f of subs) f(m); };
    const checksOf = (id) => (store.checks.get(id) || []).flat(); // kept in parts as they arrive: flatten once, here
    const runner = createRunner((m) => {
      if (m.type === 'start') store.running.add(m.id);
      if (m.type === 'checks') { let l = store.checks.get(m.id); if (!l) store.checks.set(m.id, (l = [])); (l[m.part] ||= []).push(...m.checks); }
      if (m.type === 'end') { store.running.delete(m.id); store.results.set(m.id, m.result); wall?.finish(m.id, checksOf(m.id), m.result); last = m.result; }
      if (m.type === 'done') { store.busy = false; store.out = m.out; finishedAt = performance.now(); }
      if (m.type === 'error') { store.busy = false; store.error = m.message; }
      say(m); dirty = true;
    });
    let wall = null, film = null, last = null, finishedAt = 0, dirty = true, shown = false, view = asked.view || 'wall', timer = 0, touched = false, ran = false, lastFilm = null;
    asked.view = null;
    function runAll() { store.checks.clear(); store.results.clear(); store.running.clear(); store.out = null; store.error = null; store.busy = true; last = null; ran = true; wall?.reset(); say({ type: 'reset' }); runner.go(); dirty = true; }

    // ---------- Demo ----------
    const wallHost = h('div.status-stage'), filmHost = h('div.status-stage', { hidden: true }), realHost = h('div.status-stage.status-real', { hidden: true }), tip = h('div.tooltip.status-tip', { 'aria-hidden': 'true' });
    const title = h('h1', { class: 'display' }), sub = h('p', null), tags = h('div.row'), now = h('p.status-nowline', { role: 'status' }), act = h('button.btn.btn-lg.btn-primary', { onclick: () => primary() }), figs = h('div.status-figs'), lines = h('ol.status-lines', { 'aria-label': 'What the system did' });
    const STEPS = [['wall', 'The proof'], ['film', 'Broken on purpose'], ['real', 'What is real']], steps = h('div.status-steps', { role: 'group', 'aria-label': 'Scenes' }, ...STEPS.map(([id, t]) => h('button', { 'data-v': id, onclick: () => { touched = true; go(id); } }, t)));
    const drills = h('div.status-steps.small', { role: 'group', 'aria-label': 'Drills' }, ...FILM.map((d, i) => h('button', { onclick: () => { touched = true; film?.go(i); } }, d.short)));
    const demo = h('div.status-demo.demo-only', null, wallHost, filmHost, realHost, h('div.status-scrim', { 'aria-hidden': 'true' }), h('div.status-block', null, steps, title, sub, h('div.status-actions', null, act, tags), now), figs, h('div.status-right', null, drills, lines), tip);
    const adv = createAdvanced(ctx, store, { runAll, subscribe: (f) => { subs.add(f); return () => subs.delete(f); } }), advEl = h('div.status-adv.adv-only', null, adv.el);
    root.append(demo, advEl);
    const real = createRealWall(realHost, ctx);

    const fig = (v, label, cls = '') => h('div', { class: 'status-fig ' + cls }, h('b.num', null, v), h('span', null, label));
    function head() {
      const T = { wall: ['Proof, not <em>promises</em>', SUITE.length + ' self-tests run on this computer, now. Every lamp is one check.', ['live-algo'], 'Break it on purpose'], film: ['', '', ['live-algo', 'sim'], 'What is real?'], real: ['What is <em>real</em>', 'Every feature, by how real it is. Anything not found in the code is struck out.', [], 'Run the proof again'] }[view];
      if (view !== 'film') { title.innerHTML = T[0]; sub.textContent = T[1]; }
      tags.replaceChildren(...T[2].map((k) => realityTag(k))); act.replaceChildren(h('span', null, T[3]), icon(view === 'real' ? 'reset' : 'arrow-right'));
      for (const b of steps.children) b.setAttribute('aria-pressed', String(b.dataset.v === view));
      drills.hidden = lines.hidden = view !== 'film'; now.hidden = view === 'real'; demo.dataset.view = view; figs.replaceChildren();
    }
    function primary() { touched = true; if (view === 'wall') go('film'); else if (view === 'film') go('real'); else { go('wall'); runAll(); } }
    async function openWall() {
      if (wall) return; try { wall = await createWall(wallHost, { nn: ctx.nn, ctx, css: cssVar, reduced: reducedMotion }); for (const [id, r] of store.results) wall.finish(id, checksOf(id), r, { instant: true }); for (const id of store.running) wall.begin(id); if (store.results.size) wall.toEnd(); }
      catch (e) { wallHost.replaceChildren(h('div.empty', null, icon('alert', 28), h('h2', null, 'The wall needs WebGL'), h('p', null, 'The tests still run. Open Advanced to read every result.'))); console.warn('[status] wall:', e); }
    }
    function closeWall() { wall?.dispose(); wall = null; }
    function closeFilm() { film?.dispose(); film = null; filmHost.replaceChildren(); lastFilm = null; }
    let gen = 0;
    async function go(v) { // one WebGL canvas at a time: a scene is released when the next one opens
      const g = ++gen; view = v; wallHost.hidden = v !== 'wall'; filmHost.hidden = v !== 'film'; realHost.hidden = v !== 'real'; tip.classList.remove('show');
      head(); if (v !== 'wall') closeWall(); if (v !== 'film') closeFilm(); if (v === 'real') real.show(); else real.hide();
      if (v === 'real') checkBuilt().then(() => { if (view !== 'real') return; const n = (f) => String(ALL.filter(f).length); figs.replaceChildren(fig(n((r) => r.built === 'built'), 'found in the code'), fig(n((r) => r.built === 'built' && r.kind === 'concept'), 'of those, concepts only'), fig(n((r) => r.built === 'missing'), 'not built', 'bad')); });
      if (!shown || ctx.mode !== 'demo') return;
      if (v === 'wall') { await openWall(); if (g !== gen) return closeWall(); wall?.start(); }
      if (v === 'film' && !film) { title.textContent = 'Broken on purpose'; sub.textContent = 'A private copy of the mission. The live one is not touched.'; now.textContent = 'Building the site'; const f = await createDrillFilm(filmHost, ctx, { onUpdate: onFilm }); if (g !== gen) { f.dispose(); return; } film = f; film.twin.setSafeArea?.({ left: 0, top: 0, right: 380, bottom: 220 }); film.start(); }
      if (shown) start();
      dirty = true;
    }
    let fk = -1, fl = '', seenDrills = new Set();
    function onFilm(s) {
      if (s.k !== fk) { fk = s.k; title.textContent = s.d.title; sub.textContent = s.d.says; seenDrills.add(s.k); [...drills.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === s.k))); if (lastFilm && lastFilm.k === FILM.length - 1 && s.k === 0 && !touched) { setTimeout(() => go('real'), 0); } }
      lastFilm = s; now.textContent = s.phase === 'lead' ? 'Everything is working.' : s.phase === 'fault' ? (s.d.id === 'slide' ? 'Debris on the map. ' : 'Fault on. ') + s.mode + '.' : 'Put right. ' + s.mode + '.'; now.dataset.tone = s.phase === 'fault' ? 'warn' : 'ok';
      const key = s.lines.length + '|' + s.k + s.phase[0]; if (key !== fl) { fl = key; lines.replaceChildren(...s.lines.slice(-5).map((e) => h('li', { class: 'lv-' + e.level }, h('span.num', null, '+' + Math.max(0, e.t - (s.t - s.sinceT)).toFixed(0) + ' s'), h('span', null, e.text)))); }
      if (!figs.firstChild) figs.append(fig('', 'radio link'), fig('', 'battery'), fig('', 'moved since the fault'));
      const v = [(s.link * 100).toFixed(0) + ' %', (s.battery * 100).toFixed(0) + ' %', s.moved.toFixed(1) + ' m']; [...figs.children].forEach((f, i) => { if (f.firstChild.textContent !== v[i]) f.firstChild.textContent = v[i]; }); figs.children[0].classList.toggle('bad', s.link < 0.05); figs.children[1].classList.toggle('bad', s.battery <= 0.15);
    }
    // The three figures count the lamps that are lit, so the numbers and the wall always agree.
    const F = [fig('0', 'checks lit'), fig('0 / 30', 'windows match Python'), fig('0', 'failed')];
    function paintWall() {
      if (view !== 'wall') return; if (figs.firstChild !== F[0]) figs.replaceChildren(...F);
      const lit = wall ? wall.lit() : 0, done = store.out, par = store.results.get('nn-parity'), sh = wall ? Math.round(wall.part('nn-parity') * (par?.passed || 0)) : 0;
      let bad = 0; for (const [id, r] of store.results) if (!wall || wall.part(id) >= 1) bad += r.failed;
      const set = (i, t) => { const b = F[i].firstChild; if (b.textContent !== t) b.textContent = t; }; set(0, lit.toLocaleString('en')); set(1, sh + ' / 30'); set(2, String(bad)); F[2].classList.toggle('bad', bad > 0); F[1].classList.toggle('good', sh === 30);
      const t = store.error ? 'The tests could not run: ' + store.error : done && wall?.settled() ? (done.failed ? done.results.filter((r) => r.failed).length + ' of ' + SUITE.length + ' tests failed. Their names are lit on the wall; Advanced says why.' : 'All ' + SUITE.length + ' passed, in ' + (done.ms / 1000).toFixed(0) + ' seconds. Amber is a measured limit, kept in view.') : store.running.size ? 'Running: ' + SUITE.find((x) => x.id === [...store.running][0]).title : last ? last.got : 'Starting';
      if (now.textContent !== t) now.textContent = t; now.dataset.tone = store.error || bad ? 'bad' : 'ok';
      if (done && wall?.settled() && !touched && !reducedMotion() && performance.now() - finishedAt > 14000 && wall.time > 34) go('film');
    }
    const start = () => { clearInterval(timer); timer = setInterval(() => { if (shown && ctx.mode === 'demo') paintWall(); }, 100); };
    wallHost.addEventListener('pointermove', (e) => {
      const p = wall?.pick(e.clientX, e.clientY), r = demo.getBoundingClientRect(); if (!p) { tip.classList.remove('show'); wallHost.style.cursor = ''; return; }
      let a, b, c; if (p.test) { const t = SUITE.find((x) => x.id === p.test), res = store.results.get(p.test); a = t.title; b = res ? res.got : store.running.has(p.test) ? 'Running' : 'Waiting its turn'; c = res ? VERDICT[res.state] + ' · ' + (res.passed + res.failed + res.limits) + ' checks · ' + (res.ms < 1000 ? res.ms.toFixed(0) + ' ms' : (res.ms / 1000).toFixed(1) + ' s') : t.expect; }
      else { const s = ctx.nn.samples[p.window], d = checksOf('nn-parity')[p.window]?.[3]; a = 'Window ' + p.window + ': ' + s.cat.toLowerCase(); b = d ? 'This browser ' + d.js.toFixed(5) + ', Python ' + d.py.toFixed(5) : 'Waiting'; c = 'Simulated. Ten seconds, 52 rows by 200 samples'; }
      tip.replaceChildren(h('b', null, a), h('span', null, b), h('small', null, c)); tip.classList.add('show'); wallHost.style.cursor = p.test ? 'pointer' : 'default';
      const x = e.clientX - r.left, y = e.clientY - r.top; tip.style.transform = 'translate(' + Math.min(x + 18, r.width - 350) + 'px,' + Math.min(y + 18, r.height - 130) + 'px)';
    });
    wallHost.addEventListener('pointerleave', () => tip.classList.remove('show'));
    wallHost.addEventListener('click', (e) => { touched = true; const p = wall?.pick(e.clientX, e.clientY); if (p) { adv.open('tests', p.test || 'nn-parity'); ctx.setMode('advanced'); } });

    function resume() { if (ctx.mode === 'demo') { adv.hide(); if (view === 'wall' && wall) wall.start(); else if (view === 'film' && film) film.start(); else go(view); start(); if (view === 'real') real.show(); } else { wall?.stop(); film?.stop(); real.hide(); clearInterval(timer); adv.show(); } }
    function pause() { clearInterval(timer); wall?.stop(); film?.stop(); real.hide(); adv.hide(); if (store.busy) { runner.stop(); store.busy = false; ran = false; } }
    subs.add((m) => { if (m.type === 'start') wall?.begin(m.id); });
    ctx.bus.on('mode', () => { if (shown) resume(); });
    ctx.bus.on('prefs', () => { wall?.colours(); real.paint(); });
    ctx.bus.on('status:view', (v) => { asked.view = null; touched = true; if (ctx.mode === 'advanced') adv.open(v === 'real' ? 'real' : 'tests'); else go(v); });
    ctx.bus.on('escape', () => tip.classList.remove('show'));
    head(); if (view === 'real') adv.open('real');
    wallHost.hidden = view !== 'wall'; realHost.hidden = view !== 'real';
    return {
      onShow() { shown = true; resume(); if (!ran) runAll(); },
      onHide() { shown = false; pause(); },
      dispose() { shown = false; pause(); closeWall(); closeFilm(); },
      onParams(p) { if (p?.view) ctx.bus.emit('status:view', p.view); },
    };
  },
};
