// Deep scan: one collapsed building, seen through six kinds of physics.
// Every lens runs its real mathematics in this page on measurements simulated from the same seeded cross-section,
// and scores its answer against that simulated truth. The hardware is concept; none of it is on HOUND.
import { buildPile, drawPile, drawPerson, drawScale, voidLabels } from './model.js';
import * as L from './lib.js';
import { createCompare } from './compare.js';
import { createDemo } from './demo.js';

const LENSES = [
  { id: 'muon', n: '1', name: 'Cosmic-ray muons', what: 'weighs matter along a line' },
  { id: 'gravity', n: '2', name: 'Quantum gravity', what: 'feels missing mass' },
  { id: 'gpr', n: '3', name: 'Ground radar', what: 'echoes off material edges' },
  { id: 'das', n: '4', name: 'Fibre as a microphone', what: 'hears a tap along a cable' },
  { id: 'seismic', n: '5', name: 'Seismic tap location', what: 'times a tap at eight sensors' },
  { id: 'echo', n: '6', name: 'Shape of a void', what: 'ranges the walls by echo' },
];
const FULL = { x0: -1.5, x1: 24.5, z0: -3.55, z1: 6.2 };

export default {
  async mount(root, ctx) {
    const { h, icon, realityTag } = ctx.kit;
    const href = new URL('./style.css', import.meta.url).href;
    if (!document.querySelector('link[href="' + href + '"]')) await new Promise((res) => { const l = h('link', { rel: 'stylesheet', href }); l.onload = l.onerror = res; document.head.append(l); setTimeout(res, 1500); });
    root.classList.add('deepscan');

    const st = { seed: 7, lens: 'muon', truth: true, visible: false };
    let pile = buildPile(st.seed);
    const dirty = { stage: true, readout: true, side: true };
    const env = {
      ctx, h, icon, L, get pile() { return pile; }, get truth() { return st.truth; },
      redraw() { dirty.stage = dirty.readout = true; }, refresh() { dirty.side = true; dirty.stage = dirty.readout = true; },
      reduced: () => ctx.kit.reducedMotion(),
      ui: {
        slider({ label, min, max, step = 1, value, fmt = String, oninput, hint, marks }) {
          const out = h('output', null, fmt(value));
          const inp = h('input.slider', { type: 'range', min, max, step, value, 'aria-label': label, title: hint || label });
          const setP = () => { inp.style.setProperty('--p', ((inp.value - min) / (max - min) * 100) + '%'); };
          inp.addEventListener('input', () => { setP(); out.textContent = fmt(+inp.value); oninput(+inp.value); }); setP();
          const el = h('label.ds-ctl', null, h('span.ds-ctl-top', null, h('span', null, label), out), h('span.ds-slider', null, inp,
            marks ? marks.map((m) => h('i.ds-mark', { style: { left: ((m.v - min) / (max - min) * 100) + '%' }, title: m.t }, h('em', null, m.l))) : null), hint ? h('span.ds-hint', null, hint) : null);
          el.set = (v) => { inp.value = v; setP(); out.textContent = fmt(+v); }; el.input = inp;
          return el;
        },
        seg({ label, options, value, onchange, hint }) {
          const btns = options.map((o) => h('button', { type: 'button', 'aria-pressed': String(o.v === value), title: o.t || o.l, onclick: () => { btns.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].v === o.v))); onchange(o.v); } }, o.l));
          const el = h('div.ds-ctl', null, h('span.ds-ctl-top', null, h('span', null, label)), h('div.seg', { role: 'group', 'aria-label': label }, btns), hint ? h('span.ds-hint', null, hint) : null);
          el.set = (v) => btns.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].v === v)));
          return el;
        },
        button({ label, ico, primary, onclick, title }) { return h('button.btn' + (primary ? '.btn-primary' : ''), { type: 'button', onclick, title: title || label }, ico ? icon(ico) : null, h('span', null, label)); },
        toggle({ label, value, onchange, hint }) { const inp = h('input', { type: 'checkbox', checked: value, onchange: () => onchange(inp.checked) }); return h('label.check.switch.ds-toggle', { title: hint || label }, inp, h('span', null, label)); },
      },
    };

    // ---- load the six lenses; one that fails to load is reported, the others still work ----
    const exhibits = new Map();
    await Promise.all(LENSES.map(async (ln) => {
      try { const mod = await import('./' + ln.id + '.js'); const ex = mod.default(env); ex.meta = ln; ex.stale = true; exhibits.set(ln.id, ex); }
      catch (e) { console.error('[deepscan] lens "' + ln.id + '" failed to load', e); }
    }));
    const cur = () => exhibits.get(st.lens);
    const ensure = (ex) => { if (ex && ex.stale) { ex.setPile(pile); ex.stale = false; } return ex; };

    // ---- chrome ----
    const seedOut = h('span.num', null, '#' + st.seed);
    const truthSw = env.ui.toggle({ label: 'Show simulated truth', value: true, hint: 'Draw what is really inside the simulated pile. Turn it off to see only what the instrument recovers.', onchange: (v) => { st.truth = v; env.redraw(); compare.dirty(); } });
    const head = h('header.ds-head', null,
      h('div.ds-title', null, icon('scan', 20), h('h2', null, 'Deep scan'), realityTag('concept'), realityTag('live-algo')),
      h('p.ds-lede', null, 'Six kinds of physics for seeing inside a collapse. Each one measures this simulated pile, rebuilds what is hidden in your browser, and is scored against the truth.'),
      h('div.grow'), truthSw,
      h('div.ds-seed', { title: 'The pile is generated from this number. A new pile re-runs every instrument.' }, h('span', null, 'Pile'), seedOut,
        h('button.btn.btn-sm', { type: 'button', 'aria-label': 'Generate a new pile', onclick: () => newPile(st.seed + 1) }, icon('reset', 14), h('span', null, 'New pile'))));
    const tabs = h('nav.ds-lenses', { role: 'tablist', 'aria-label': 'Instruments' },
      LENSES.map((ln) => h('button.ds-lens', { type: 'button', role: 'tab', id: 'ds-tab-' + ln.id, 'aria-selected': 'false', disabled: !exhibits.has(ln.id), onclick: () => show(ln.id) },
        h('span.ds-lens-n.num', null, ln.n), h('span.ds-lens-t', null, h('b', null, ln.name), h('small', null, exhibits.has(ln.id) ? ln.what : 'did not load')))),
      h('button.ds-lens.ds-lens-cmp', { type: 'button', role: 'tab', id: 'ds-tab-compare', 'aria-selected': 'false', onclick: () => show('compare') },
        h('span.ds-lens-n', null, icon('grid', 15)), h('span.ds-lens-t', null, h('b', null, 'Compare all six'), h('small', null, 'who sees what, and at what cost'))));

    tabs.addEventListener('keydown', (e) => { const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!step) return; const all = [...tabs.querySelectorAll('button:not([disabled])')], b = all[(all.indexOf(document.activeElement) + step + all.length) % all.length]; e.preventDefault(); b.focus(); b.click(); });

    const stageCv = h('canvas.ds-canvas', { 'aria-label': 'Cross-section of the simulated rubble pile with the selected instrument', role: 'img' });
    const readCv = h('canvas.ds-canvas', { 'aria-label': 'What the instrument recorded', role: 'img' });
    const stageCap = h('div.ds-cap'), readTitle = h('h3.ds-fig-title'), readSub = h('p.ds-fig-sub');
    const hud = h('aside.ds-hud', { 'aria-label': 'What this instrument finds in the pile' });
    const stageWrap = h('section.ds-stage', { 'aria-label': 'The pile' }, stageCv, stageCap);
    const readWrap = h('section.ds-readout', { 'aria-label': 'Measurements' }, h('div.ds-fig', null, h('header.ds-fig-head', null, readTitle, readSub), h('div.ds-read-body', null, readCv)));
    const side = h('aside.ds-side', { 'aria-label': 'About this instrument' });
    const body = h('div.ds-body', null, h('div.ds-main', null, stageWrap, hud, readWrap), side);
    const compare = createCompare(env, { LENSES, exhibits, ensure, open: (id) => show(id) });
    compare.el.hidden = true;
    const demo = createDemo(ctx, { getPile: () => pile, getSeed: () => st.seed, reduced: () => ctx.kit.reducedMotion() });
    for (const e of [head, tabs, body, compare.el]) e.classList.add('adv-only');
    root.append(demo.el, head, tabs, body, compare.el);
    root.__ds = { exhibits, st, env, demo, show: (id) => show(id) };

    // ---- side panel ----
    const sideParts = new Map();
    function buildSide(ex) {
      if (sideParts.has(ex.meta.id)) return sideParts.get(ex.meta.id);
      const results = h('div.ds-stats');
      const el = h('div.ds-card', null,
        h('div.ds-card-head', null, h('span.ds-card-n.num', null, ex.meta.n + ' / 6'), h('h2', null, ex.title), h('div.ds-tags', null, h('span.tag.tag-sim', { title: 'This hardware is not part of HOUND. ' + ex.hardware }, 'Concept hardware'), realityTag('live-algo'))),
        h('p.ds-card-lede', null, ex.lede),
        h('div.ds-block', null, h('h4', null, 'Try it'), ex.controls()),
        h('div.ds-block', null, h('h4', null, 'Scored against the simulated truth'), results),
        h('div.note.quiet.ds-honest', null, icon('info'), h('div', null, h('b', null, 'What it needs: '), ex.honest)),
        h('div.ds-src', null, h('h4', null, 'Real work this stands on'), ex.sources.map((s) => h('a', { href: s.url, target: '_blank', rel: 'noopener' }, icon('external', 13), h('span', null, h('b', null, s.who), ' ', s.what)))),
        h('p.ds-assume', null, ex.assumed));
      const rec = { el, results }; sideParts.set(ex.meta.id, rec); return rec;
    }
    const STATE = { seen: ['tag-ok', 'Found'], hint: ['tag-warn', 'A hint'], missed: ['', 'Not seen'], na: ['', 'Not covered'] };
    function fillSide(ex) {
      const rec = buildSide(ex);
      if (side.firstChild !== rec.el) side.replaceChildren(rec.el);
      rec.results.replaceChildren(...ex.results().map((r) => h('div.ds-stat', null, h('span', null, r.k), h('b.num', { class: r.tone ? 'ds-' + r.tone : '' }, r.v), r.sub ? h('small', null, r.sub) : null)));
      const V = ex.verdicts();
      hud.replaceChildren(...[...pile.voids.map((v) => [v.id, v.id, v.kind, v.depth.toFixed(1) + ' m down']), ['person', '', 'the person', 'in void A']].map(([id, badge, name, desc]) => {
        const d = V[id] || { state: 'na', text: '' }, sdef = STATE[d.state] || STATE.na;
        return h('div.ds-hud-row', { title: name + ', ' + desc + '. ' + (d.why || '') }, badge ? h('i.ds-hud-id', null, badge) : h('i.ds-hud-id.person', null, icon('person', 11)), h('span.ds-hud-what', null, h('b', null, name), h('small', null, desc)), h('span.ds-hud-v', null, h('span.tag.plain.' + (sdef[0] || 'ds-tag-off'), null, sdef[1]), h('small', null, d.text)));
      }));
      stageCap.replaceChildren(h('b', null, ex.stageTitle?.() || ex.title), h('span', null, ex.stageNote?.() || ''), h('span.tag.tag-sim', { title: 'The pile and every measurement of it are simulated.' }, 'Simulated pile'));
      const rt = ex.readoutTitle(); readTitle.textContent = rt[0]; readSub.textContent = rt[1] || '';
    }

    // ---- stage camera ----
    const view = { ...FULL }, target = { ...FULL };
    function makeS(c, w, hh) {
      const s = Math.min(w / (view.x1 - view.x0), hh / (view.z1 - view.z0));
      const ox = (w - (view.x1 - view.x0) * s) / 2 - view.x0 * s, oz = (hh + (view.z1 - view.z0) * s) / 2 + view.z0 * s;
      return { c, w, h: hh, s, pile, truth: st.truth, X: (x) => ox + x * s, Z: (z) => oz - z * s, wx: (px) => (px - ox) / s, wz: (py) => (oz - py) / s, zr: [view.z0, view.z1], xr: [view.x0, view.x1], t: performance.now() / 1000 };
    }

    // ---- canvases ----
    const sizes = new Map();
    const ro = new ResizeObserver((entries) => { for (const e of entries) { const cv = e.target, r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); if (!r.width || !r.height) continue; cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); sizes.set(cv, { w: r.width, h: r.height, dpr }); } env.redraw(); });
    ro.observe(stageCv); ro.observe(readCv);
    const begin = (cv) => { const z = sizes.get(cv); if (!z) return null; const c = cv.getContext('2d'); c.setTransform(z.dpr, 0, 0, z.dpr, 0, 0); c.clearRect(0, 0, z.w, z.h); return { c, w: z.w, h: z.h }; };

    const demoSeed = st.seed; // the film set is built once, for the pile the page opened with
    // the pile itself only changes with the view, so it is painted once and reused while the instrument animates
    let still = null, stillKey = '';
    function stillPile(S) {
      const z = sizes.get(stageCv), k = [S.w, S.h, z.dpr, view.x0, view.x1, view.z0, view.z1, st.truth, st.seed, L.tok('--bg-4')].join(); still = still || document.createElement('canvas');
      if (k !== stillKey) { stillKey = k; still.width = stageCv.width; still.height = stageCv.height; const c = still.getContext('2d'); c.setTransform(z.dpr, 0, 0, z.dpr, 0, 0); drawPile({ ...S, c }); }
      S.c.drawImage(still, 0, 0, S.w, S.h);
    }
    let raf = 0, last = 0, lastS = null;
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
      if (ctx.mode !== 'advanced') { if (demoSeed !== st.seed) newPile(demoSeed); demo.start(); demo.frame(dt); return; }
      if (st.lens === 'compare') { compare.frame(dt); return; }
      const ex = cur(); if (!ex) return;
      try {
        ensure(ex);
        const anim = ex.tick?.(dt) || false;
        const tv = ex.view?.() || FULL; let moving = false;
        for (const k of ['x0', 'x1', 'z0', 'z1']) { target[k] = tv[k]; const d = target[k] - view[k]; if (Math.abs(d) > 0.002) { view[k] += env.reduced() ? d : d * (1 - Math.exp(-dt * 7)); moving = true; } else view[k] = target[k]; }
        if (dirty.side) { fillSide(ex); dirty.side = false; }
        if (dirty.stage || anim || moving) {
          const b = begin(stageCv);
          if (b) { const S = makeS(b.c, b.w, b.h); lastS = S; ex.under?.(S); stillPile(S); ex.drawStage(S); if (st.truth) drawPerson(S); if (st.truth && !ex.hideLabels) voidLabels(S, ex.verdicts()); drawScale(S); }
          dirty.stage = false;
        }
        if (dirty.readout || anim) { const b = begin(readCv); if (b) ex.drawReadout({ c: b.c, w: b.w, h: b.h, t: now / 1000, truth: st.truth, pile, SX: lastS && view.x0 === FULL.x0 && view.x1 === FULL.x1 ? lastS.X : (x) => 56 + (x / 24) * (b.w - 72) }); dirty.readout = false; }
      } catch (e) { if (!ex.failed) { ex.failed = true; console.error('[deepscan] ' + st.lens, e); } }
    }

    // pointer: lenses that let you move something on the stage
    const world = (e) => { const r = stageCv.getBoundingClientRect(); return lastS ? { x: lastS.wx(e.clientX - r.left), z: lastS.wz(e.clientY - r.top), S: lastS } : null; };
    let dragging = false;
    stageCv.addEventListener('pointerdown', (e) => { const p = world(e), ex = cur(); if (p && ex?.pointer?.('down', p)) { dragging = true; stageCv.setPointerCapture(e.pointerId); env.refresh(); } });
    stageCv.addEventListener('pointermove', (e) => { const p = world(e), ex = cur(); if (!p || !ex?.pointer) return; if (dragging) { ex.pointer('move', p); env.refresh(); } else stageCv.style.cursor = ex.pointer('hover', p) ? 'grab' : ''; });
    const endDrag = (e) => { if (dragging) { dragging = false; cur()?.pointer?.('up', world(e) || {}); env.refresh(); } };
    stageCv.addEventListener('pointerup', endDrag); stageCv.addEventListener('pointercancel', endDrag);

    function show(id) {
      if (id !== 'compare' && !exhibits.has(id)) id = [...exhibits.keys()][0] || 'compare';
      cur()?.hide?.();
      st.lens = id;
      tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.id === 'ds-tab-' + id)));
      const cmp = id === 'compare'; body.hidden = cmp; compare.el.hidden = !cmp;
      if (cmp) compare.show(); else { dirty.side = true; env.redraw(); }
    }
    function newPile(seed) {
      st.seed = seed; seedOut.textContent = '#' + seed; pile = buildPile(seed);
      for (const ex of exhibits.values()) ex.stale = true;
      compare.dirty(); env.refresh();
    }
    const offs = [ctx.bus.on('mode', () => { L.dropTokens(); env.refresh(); }), ctx.bus.on('prefs', () => { L.dropTokens(); compare.dirty(); env.refresh(); })];
    show(ctx.params?.lens || 'muon');

    return {
      onShow() { if (st.visible) return; st.visible = true; last = performance.now(); env.redraw(); raf = requestAnimationFrame(frame); },
      onHide() { st.visible = false; cancelAnimationFrame(raf); cur()?.hide?.(); },
      onParams(p) { if (p?.lens) show(p.lens); if (p?.seed) newPile(+p.seed); },
      dispose() { offs.forEach((f) => f()); ro.disconnect(); },
    };
  },
};
