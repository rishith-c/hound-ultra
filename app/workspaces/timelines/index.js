// Timelines: fork the mission at any moment, decide differently, and compare the worlds.
//
// What is real here: every branch is a full run of the mission engine (app/core/sim.js) in a Web Worker, started
// from the live mission's own command log. Nothing is drawn from a script. What is simulated: the mission itself
// (building, people, readings), as everywhere in the console. Ground truth is used only behind a labelled switch.
import { createPool } from './pool.js';
import { digest } from './runner.js';
import { createTree } from './tree.js';
import { createMap } from './map.js';
import * as M from './model.js';
import { mountSweeps } from './sweeps.js';
import { mountCf } from './cfview.js';
import { mountRegret, mountMethod } from './regret.js';

const { clock, span, plural } = M;
let cssLoaded = false;

export default {
  async mount(root, ctx) {
    const { kit, bus, sim, world } = ctx, { h, icon, realityTag } = kit;
    if (!cssLoaded) { cssLoaded = true; document.head.append(h('link', { rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href })); }
    root.classList.add('tl');

    // ------------------------------------------------------------------ state
    const pool = createPool(ctx.nn);
    const listeners = new Map();
    const app = {
      ctx, kit, h, world, pool, branches: [], cursor: { id: 'trunk', t: 0 }, compareId: null, truth: false, lead: null, live: null, proof: { live: null },
      on(type, fn) { (listeners.get(type) || listeners.set(type, new Set()).get(type)).add(fn); },
      emit(type, p) { for (const fn of listeners.get(type) || []) { try { fn(p); } catch (e) { console.error('[timelines]', e); } } },
      byId: (id) => app.branches.find((b) => b.id === id) || null,
      get trunk() { return app.branches[0]; },
      runOf: (id) => app.byId(id)?.run || null,
    };
    let seq = 0, visible = false, stale = false, syncGen = 0, auto0 = sim.state.autoplay, scores = null;
    const trunk = { id: 'trunk', name: 'Trunk', parent: null, forkT: 0, label: 'The mission as flown', detail: 'The live mission, replayed from its own command log. Past the live clock it is a projection: the autopilot makes the routine choices.', acts: [], opts: {}, status: 'queued', progress: 0 };
    app.branches.push(trunk);

    // The Wi-Fi network's likelihood ratio at any alarm line, from the 955 simulated test windows.
    fetch(new URL('../../../data/eval_scores.json', import.meta.url)).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.test) { scores = j.test; app.emit('scores'); } }).catch(() => {});
    app.csiLR = (th) => {
      if (!scores) return null;
      let tp = 0, fp = 0, P = 0, N = 0;
      for (let i = 0; i < scores.n; i++) { const says = scores.person_score[i] > th; if (scores.person[i]) { P++; if (says) tp++; } else { N++; if (says) fp++; } }
      const tpr = Math.min(1 - 0.5 / P, Math.max(0.5 / P, tp / P)), fpr = Math.min(1 - 0.5 / N, Math.max(0.5 / N, fp / N));
      return { tpr: tp / P, fpr: fp / N, pos: tpr / fpr, neg: (1 - tpr) / (1 - fpr) };
    };
    app.hasScores = () => !!scores;

    const chainOf = (b) => { const c = []; for (let x = b; x && x.parent; x = app.byId(x.parent)) c.unshift(x); return c; };
    function buildSpec(parent, res, extra = {}) {
      const chain = chainOf(parent), L = app.live;
      const rootT = chain.length ? chain[0].forkT : res.forkT;
      const opts = Object.assign({}, ...chain.map((b) => b.opts), res.opts);
      return { seed: opts.seed ?? L.seed, windows: opts.windows ?? L.windows, autoplay0: L.auto0, operator: L.operator, log: L.log.filter((c) => c.t < rootT - 1e-9), autoT: rootT, acts: [...chain.flatMap((b) => b.acts), ...res.acts], expectEnd: trunk.run ? trunk.run.endT : 660, ...extra };
    }
    const trunkSpec = (extra = {}) => { const L = app.live; return { seed: L.seed, windows: L.windows, autoplay0: L.auto0, operator: L.operator, log: L.log, autoT: L.t, acts: [], ...extra }; };
    app.buildSpec = buildSpec; app.trunkSpec = trunkSpec;
    // Re-check the trunk against the live mission as it stands this instant (the live clock keeps moving).
    app.recheck = async () => {
      if (!app.live) return;
      const S = sim.state, log = sim.commandLog;
      if (JSON.stringify([log, sim.options]) !== app.live.sig) { sync(); return; }
      const t = S.t, live = digest(S);
      app.proof.live = { state: 'checking', t }; app.emit('proof');
      try { const chk = await pool.run(trunkSpec({ until: t, autoT: undefined, log }), { priority: true }); app.proof.live = { state: chk.hash === live ? 'ok' : 'differs', t, live, replay: chk.hash, commands: log.length }; }
      catch (e) { app.proof.live = { state: 'error', t, error: String(e.message || e) }; }
      app.emit('proof');
    };
    // A probe: resolve a decision against a branch and run it without adding it to the tree (sweeps use this).
    app.probe = async (parentId, T, dec, extra = {}) => {
      const parent = app.byId(parentId); if (!parent || !parent.run) return { ok: false, why: 'That branch has not finished running.' };
      const res = M.resolve(dec, parent.run, T); if (!res.ok) return res;
      const run = await pool.run(buildSpec(parent, res, { frames: false, ...extra }));
      return { ok: true, res, run, dec, parentId, T };
    };

    function adopt(b, run) {
      b.run = run; b.status = 'done'; b.river = M.river(run); b.phases = M.phases(run);
      const p = b.parent ? app.byId(b.parent) : null;
      b.firstDiff = p && p.run ? M.diffRuns(run, p.run).first : null;
      b.refused = run.fired.filter((f) => !f.ok);
    }
    async function launch(b) {
      const gen = (b.gen = (b.gen || 0) + 1), ok = () => b.gen === gen && app.branches.includes(b);
      b.status = 'running'; b.progress = 0; b.run = null; b.verify = null; app.emit('branches');
      try {
        const spec = b === trunk ? trunkSpec() : buildSpec(app.byId(b.parent), b);
        const run = await pool.run(spec, { priority: b === trunk, onProgress: (p) => { if (ok()) { b.progress = p; app.emit('progress'); } } });
        if (!ok()) return;
        adopt(b, run); app.emit('branches');
        b.verify = 'pending';
        const again = await pool.run({ ...spec, frames: false });
        if (!ok()) return;
        b.hash2 = again.hash; b.verify = again.hash === run.hash ? 'ok' : 'fail'; app.emit('proof'); app.emit('branches');
      } catch (e) { if (ok()) { b.status = 'error'; b.error = String(e.message || e); app.emit('branches'); } }
    }
    app.fork = (parentId, T, dec, extra = {}) => {
      const parent = app.byId(parentId); if (!parent || !parent.run) return { error: 'That branch has not finished running yet.' };
      const res = M.resolve(dec, parent.run, T); if (!res.ok) return { error: res.why };
      const dup = app.branches.find((x) => x.parent === parentId && x.label === res.label && Math.abs(x.forkT - res.forkT) < 0.05);
      if (dup) return { branch: dup, duplicate: true };
      const b = { id: 'b' + ++seq, name: 'B' + seq, parent: parentId, dec, T, forkT: res.forkT, label: res.label, detail: res.detail, acts: res.acts, opts: res.opts, status: 'queued', progress: 0, ...extra };
      app.branches.push(b); launch(b); return { branch: b };
    };
    app.remove = (id) => {
      const kill = new Set([id]); let grew = true;
      while (grew) { grew = false; for (const b of app.branches) if (b.parent && kill.has(b.parent) && !kill.has(b.id)) { kill.add(b.id); grew = true; } }
      app.branches = app.branches.filter((b) => !kill.has(b.id));
      if (kill.has(app.cursor.id)) app.cursor.id = 'trunk';
      if (kill.has(app.compareId)) app.compareId = null;
      app.emit('branches'); app.emit('cursor');
    };
    app.setCursor = (id, t) => {
      const b = app.byId(id); if (!b || !b.run) return;
      const changed = id !== app.cursor.id;
      app.cursor = { id, t: Math.max(0, Math.min(b.run.endT, t)) };
      if (changed || !app.compareId || app.compareId === id) { const alt = app.compareId && app.compareId !== id && app.runOf(app.compareId) ? app.compareId : b.parent || app.branches.find((x) => x.id !== id && x.run)?.id || null; app.compareId = alt; }
      app.emit('cursor', { changed });
    };
    app.setCompare = (id) => { if (id === app.cursor.id) return; app.compareId = app.compareId === id ? null : id; app.emit('cursor', { changed: true }); };
    app.setTruth = (on) => { app.truth = !!on; truthBox.checked = app.truth; root.classList.toggle('tl-truth-on', app.truth); app.emit('truth'); app.emit('branches'); };
    app.selectLead = (id, from) => { app.lead = id; app.emit('lead', from); const live = sim.state.detections.find((d) => d.id === id); const mine = app.runOf(app.cursor.id)?.detections.find((d) => d.id === id); if (live && mine && live.room === mine.room && app.cursor.id === 'trunk') ctx.select({ type: 'detection', id }); };
    app.rows = () => { const out = []; const walk = (id, depth) => { const b = app.byId(id); out.push({ b, depth }); for (const c of app.branches) if (c.parent === id) walk(c.id, depth + 1); }; walk('trunk', 0); return out; };
    app.tMax = () => { let m = trunk.run ? trunk.run.endT : 660; for (const b of app.branches) if (b.run && b.run.done) m = Math.max(m, b.run.endT); return Math.ceil((m + 12) / 30) * 30; };

    // ------------------------------------------------------------------ sync with the live mission
    async function sync() {
      const gen = ++syncGen, S = sim.state, log = sim.commandLog, o = sim.options;
      const L = (app.live = { log, seed: o.seed, windows: o.windows, t: S.t, digest: digest(S), auto0, operator: log.some((c) => c.name === 'setOperator') && S.t > 0 ? undefined : S.operator, sig: JSON.stringify([log, o]) });
      stale = false; trunk.status = 'running'; trunk.progress = 0; trunk.run = trunk.run || null; app.proof.live = { state: 'checking', t: L.t }; app.emit('branches'); app.emit('proof');
      try {
        // Does a replay of the command log reproduce the live mission exactly, up to the live clock?
        let chk = await pool.run(trunkSpec({ until: L.t, autoT: undefined }), { priority: true });
        if (gen !== syncGen) return;
        if (chk.hash !== L.digest) { // the mission may have been started with the autopilot off: try that
          const alt = await pool.run(trunkSpec({ until: L.t, autoT: undefined, autoplay0: !L.auto0 }), { priority: true });
          if (gen !== syncGen) return;
          if (alt.hash === L.digest) { L.auto0 = auto0 = !L.auto0; chk = alt; }
        }
        app.proof.live = { state: chk.hash === L.digest ? 'ok' : 'differs', t: L.t, live: L.digest, replay: chk.hash, commands: log.length };
        app.emit('proof');
      } catch (e) { app.proof.live = { state: 'error', t: L.t, error: String(e.message || e) }; app.emit('proof'); }
      if (gen !== syncGen) return;
      await launch(trunk);
      if (gen !== syncGen || !trunk.run) return;
      if (!app.runOf(app.cursor.id)) app.cursor.id = 'trunk';
      app.cursor.t = Math.min(app.cursor.t || M.phaseStart(trunk.run, 'assess') || 0, trunk.run.endT);
      // Re-apply every existing fork to the new trunk, parents first.
      for (const b of app.branches.slice(1)) {
        const parent = app.byId(b.parent);
        const settle = async () => { while (parent.status === 'running' || parent.status === 'queued') await new Promise((r) => setTimeout(r, 60)); };
        await settle(); if (gen !== syncGen) return;
        if (!parent.run) { b.status = 'invalid'; b.run = null; continue; }
        const res = M.resolve(b.dec, parent.run, b.T);
        if (!res.ok) { b.status = 'invalid'; b.run = null; b.error = res.why; continue; }
        Object.assign(b, { forkT: res.forkT, label: res.label, detail: res.detail, acts: res.acts, opts: res.opts });
        launch(b);
      }
      if (app.branches.length === 1) starters();
      app.emit('trunk'); app.emit('branches'); app.emit('cursor', { changed: true });
    }
    function starters() {
      const r = trunk.run, search = M.phaseStart(r, 'search'), assess = M.phaseStart(r, 'assess');
      if (assess != null) app.fork('trunk', assess - 20, { kind: 'skipSecondLook' }, { example: true });
      if (search != null) app.fork('trunk', search, { kind: 'fault', id: 'csiDropout', dur: null }, { example: true });
      if (search != null) app.fork('trunk', search + 70, { kind: 'hazard', ...M.HAZARD_PRESETS[1] }, { example: true });
      app.compareId = app.branches[1]?.id || null;
    }
    let syncTimer = 0;
    const liveChanged = () => { if (!app.live) return; if (JSON.stringify([sim.commandLog, sim.options]) === app.live.sig) return; if (!visible) { stale = true; return; } clearTimeout(syncTimer); syncTimer = setTimeout(sync, 350); };
    const offs = [
      bus.on('command', liveChanged), bus.on('seek', liveChanged),
      bus.on('reset', (S) => { auto0 = S.autoplay; liveChanged(); }),
      bus.on('tick', () => { if (visible) tree.setLive(sim.state.t); }),
      bus.on('prefs', () => { mapA.colours(); mapB.colours(); mapA.draw(); mapB.draw(); }),
      bus.on('select', (sel) => { if (sel && sel.type === 'detection' && sel.id !== app.lead && app.runOf(app.cursor.id)?.detections.some((d) => d.id === sel.id)) { app.lead = sel.id; app.emit('lead', 'bus'); } }),
    ];

    // ------------------------------------------------------------------ header
    const truthBox = h('input', { type: 'checkbox', 'aria-describedby': 'tl-truth-note', onchange: (e) => app.setTruth(e.target.checked) });
    const proofChip = h('button.tl-proof', { type: 'button', title: 'Open the determinism proof', onclick: () => showTab('method') });
    root.append(h('header.ws-head.tl-head', null,
      h('div', null, h('h1', null, 'Timelines'), h('p', null, 'Fork the mission at any moment, change one decision, and run both worlds to the end. The simulator is deterministic, so each branch is a full replay with the same people and the same noise, and one thing different.')),
      h('div.tl-head-right', null, proofChip,
        h('label.check.switch.tl-truthsw', { title: 'Score every branch against what was really in the building. A real team would never have this.' }, truthBox, h('span', { id: 'tl-truth-note' }, 'Ground truth', h('small', null, 'known only because this is a simulation'))),
        realityTag('live-algo'), realityTag('sim'))));

    // ------------------------------------------------------------------ tree
    const treeHost = h('div.tl-tree');
    const legend = h('div.legend.tl-legend', null,
      h('span', null, h('i.tl-lg.possible'), 'possible person'), h('span', null, h('i.tl-lg.confirmed'), 'confirmed'), h('span', null, h('i.tl-lg.reached'), 'reached by the team'),
      h('span', null, h('i.tl-lg.node'), 'decision'), h('span', null, h('i.tl-lg.dia'), 'fault or hazard'), h('span', null, h('i.tl-lg.x'), 'lead closed'), h('span', null, h('i.tl-lg.tri'), 'route approved'));
    const busy = h('span.tl-busy');
    root.append(h('section.tl-treewrap', { 'aria-label': 'Branching timeline' },
      h('div.tl-treebar', null, h('h3', null, 'Every world, on one clock'), legend, h('div.grow'), busy,
        h('span.kbd-hint', null, h('kbd', null, '←'), h('kbd', null, '→'), 'time'), h('span.kbd-hint', null, h('kbd', null, '↑'), h('kbd', null, '↓'), 'branch'), h('span.kbd-hint', null, h('kbd', null, 'F'), 'fork')),
      treeHost));
    const tree = createTree(treeHost, { kit,
      onCursor: (id, t) => { stopPlay(); app.setCursor(id, t); },
      onCompare: (id) => app.setCompare(id),
      onDelete: (id) => app.remove(id),
      onKey: (ev, b) => { if (ev.key === 'f' || ev.key === 'F') { forkBtn.focus(); return true; } if (ev.key === 'b' || ev.key === 'B') { app.setCompare(b.id); return true; } if (ev.key === ' ') { togglePlay(); return true; } return false; } });

    // ------------------------------------------------------------------ lower area: composer + tabs
    const composer = h('aside.panel.tl-composer', { 'aria-label': 'Fork the mission' });
    const tabs = [['worlds', 'Side by side'], ['sweeps', 'Sweeps'], ['cf', 'Why this lead?'], ['regret', 'Regret'], ['method', 'Proof and sources']];
    const tabBar = h('div.tabs', { role: 'tablist' }, ...tabs.map(([id, label]) => h('button', { type: 'button', role: 'tab', id: 'tl-tab-' + id, 'aria-selected': 'false', 'aria-controls': 'tl-pane-' + id, onclick: () => showTab(id) }, label)));
    const panes = Object.fromEntries(tabs.map(([id]) => [id, h('div.tl-pane', { id: 'tl-pane-' + id, role: 'tabpanel', 'aria-labelledby': 'tl-tab-' + id, hidden: true })]));
    const work = h('section.panel.tl-work', null, tabBar, ...Object.values(panes));
    root.append(h('div.tl-lower', null, composer, work));
    let tab = 'worlds';
    function showTab(id) { tab = id; app.tab = id; for (const [k, el] of Object.entries(panes)) el.hidden = k !== id; tabBar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.id === 'tl-tab-' + id))); app.emit('tab', id); if (id === 'worlds') { requestAnimationFrame(() => { mapA.tick(0, true); mapB.tick(0, true); }); } }
    app.showTab = showTab;

    // ------------------------------------------------------------------ side by side
    const mkWorld = (tag) => {
      const canvas = h('canvas', { role: 'img', 'aria-label': 'Tactical map of world ' + tag });
      const name = h('span.tl-w-name'), state = h('div.tl-w-state'), badge = h('b.tl-w-tag.' + tag.toLowerCase(), null, tag);
      const el = h('figure.tl-world', null, h('figcaption', null, badge, name), h('div.tl-w-canvas.crop', null, canvas), state);
      return { el, canvas, name, state };
    };
    const WA = mkWorld('A'), WB = mkWorld('B');
    let placing = null; // { size, cb } while the composer waits for a click on the map
    const mapA = createMap(WA.canvas, { world, kit, onPick: (id) => { app.selectLead(id, 'map'); }, onPlace: (c) => { if (placing) placing.cb(c); } });
    const mapB = createMap(WB.canvas, { world, kit, onPick: (id) => { app.selectLead(id, 'map'); } });
    const playBtn = h('button.btn.btn-icon', { type: 'button', 'aria-label': 'Play both worlds in step', onclick: () => togglePlay() }, icon('play'));
    const scrub = h('input.slider.tl-scrub', { type: 'range', min: '0', max: '660', step: '1', value: '0', 'aria-label': 'Time in both worlds', oninput: (e) => { stopPlay(); app.setCursor(app.cursor.id, +e.target.value); } });
    const timeOut = h('output.num.tl-time', null, '00:00');
    let speed = 16, view = 'auto';
    const seg = (items, get, set, label) => { const el = h('div.seg', { role: 'group', 'aria-label': label }, ...items.map(([v, text]) => h('button', { type: 'button', 'aria-pressed': String(get() === v), onclick: () => { set(v); el.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(items[i][0] === get()))); } }, text))); return el; };
    const firstBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => { const d = currentDiff(); if (d && d.first != null) { stopPlay(); app.setCursor(app.cursor.id, Math.max(0, d.first - 2)); } } }, icon('skip-forward'), 'First difference');
    const diffEl = h('div.tl-diff');
    panes.worlds.append(h('div.tl-worlds', null,
      h('div.tl-transport', null, playBtn, seg([[4, '4×'], [16, '16×'], [64, '64×']], () => speed, (v) => { speed = v; }, 'Playback speed'), scrub, timeOut, firstBtn,
        seg([['auto', 'Follow'], ['site', 'Site'], ['building', 'Building']], () => view, (v) => { view = v; paintMaps(true); }, 'Map view')),
      h('div.tl-maps', null, WA.el, WB.el), diffEl));

    let diffCache = { key: '', d: null };
    function currentDiff() {
      const a = app.runOf(app.cursor.id), b = app.runOf(app.compareId); if (!a || !b) return null;
      const key = a.hash + '|' + b.hash + '|' + app.cursor.id + '|' + app.compareId;
      if (diffCache.key !== key) diffCache = { key, d: M.diffRuns(a, b) };
      return diffCache.d;
    }
    const stateLine = (run, t) => {
      const s = M.stateAt(run, t), c = s.dets.filter((d) => d.status === 'confirmed').length, p = s.dets.filter((d) => d.status === 'possible').length;
      const what = t >= run.endT - 0.05 && !run.done ? 'Stalled: did not finish' : s.hold ? 'All stop' : M.PHASE_INFO[s.phase].label;
      const rv = s.rover.mode === 'listen' ? 'listening' : s.rover.mode === 'drive' ? 'driving' : s.rover.mode === 'fault' ? 'holding, no link' : s.rover.mode === 'swap' ? 'battery swap' : s.rover.mode === 'hold' ? 'holding' : 'stopped';
      return [h('b', null, what), h('span', null, 'rover ' + rv), h('span', { class: c ? 'c-person' : '' }, c + ' confirmed'), h('span', { class: p ? 'c-warn' : '' }, p + ' possible'), s.reached.length ? h('span.c-accent', null, s.reached.length + ' reached') : null, s.faults.length ? h('span.c-danger', null, s.faults.map((f) => M.FAULTS[f].label.toLowerCase()).join(', ')) : null];
    };
    function paintMaps(instant) {
      const A = app.byId(app.cursor.id), B = app.byId(app.compareId), t = app.cursor.t;
      mapA.set({ run: A?.run || null, t, other: B?.run || null, otherTag: 'B', truth: app.truth, view, selected: app.lead, placing: placing ? { size: placing.size, c: placing.c } : null });
      mapB.set({ run: B?.run || null, t: B?.run ? Math.min(t, B.run.endT) : 0, other: A?.run || null, otherTag: 'A', truth: app.truth, view, selected: app.lead });
      if (instant || kit.reducedMotion()) { mapA.tick(0, true); mapB.tick(0, true); }
      WA.name.replaceChildren(A ? h('b', null, A.name) : '', A ? ' ' + A.label : '');
      WB.name.replaceChildren(B ? h('b', null, B.name) : h('span.dim', null, 'Pick a second world: press B on any branch'), B ? ' ' + B.label : '');
      WA.state.replaceChildren(...(A?.run ? stateLine(A.run, t) : [h('span.dim', null, 'Running…')]));
      WB.state.replaceChildren(...(B?.run ? stateLine(B.run, Math.min(t, B.run.endT)) : [h('span.dim', null, B ? 'Running…' : 'No second world selected')]));
      WB.el.classList.toggle('is-empty', !B);
      timeOut.textContent = clock(t); scrub.value = String(Math.round(t));
      const mx = Math.max(A?.run?.endT || 0, 1); scrub.max = String(Math.ceil(mx)); scrub.style.setProperty('--p', (100 * t) / mx + '%');
    }
    function paintDiff() {
      const A = app.byId(app.cursor.id), B = app.byId(app.compareId), d = currentDiff();
      if (!A?.run || !B?.run || !d) { diffEl.replaceChildren(h('div.empty', null, icon('timeline', 24), h('p', null, B ? 'This branch is still running.' : 'Press B on a branch in the tree to compare it with ' + (A ? A.name : 'the selected branch') + '.'))); firstBtn.disabled = true; return; }
      firstBtn.disabled = d.first == null;
      const words = M.deltaWords(A.run, B.run, app.truth);
      const head = h('div.tl-diff-head', null,
        h('h4', null, 'What differs: ', h('b.tl-w-tag.a', null, 'A'), ' ' + A.name + ' against ', h('b.tl-w-tag.b', null, 'B'), ' ' + B.name),
        d.identical ? h('p', null, 'Nothing. These two worlds are identical to the last decimal: the same events at the same times, the same positions every second.') :
          h('p', null, 'The worlds are identical until ', h('button.tl-link.num', { type: 'button', onclick: () => { stopPlay(); app.setCursor(app.cursor.id, Math.max(0, d.first - 1)); } }, clock(d.first)), '. ', words.length ? ['In A: ', ...words.flatMap((w, i) => [i ? ', ' : '', h('span', { class: w.good == null ? '' : w.good ? 'c-ok' : 'c-danger' }, w.text)]), '.'] : 'By the end the outcome is the same: only the path differs.'));
      const leadRows = d.leads.map((l) => { const f = (x) => (x ? (x.status === 'rejected' ? (x.dismissed ? 'dismissed' : 'closed') : x.status) + ' ' + (x.p * 100).toFixed(0) + ' %' : 'never opened'); return h('li', null, h('button.tl-link', { type: 'button', onclick: () => { app.selectLead(l.id, 'diff'); showTab('cf'); } }, 'Lead ' + l.id + ' ' + ((l.a || l.b).room ? 'room ' + (l.a || l.b).room : 'outdoors')), h('span', null, ': A ' + f(l.a) + ', B ' + f(l.b))); });
      const rows = d.rows.map((r) => {
        const e = r.a || r.b, text = e.text;
        const tagEl = r.kind === 'onlyA' ? h('span.tl-dk.a', null, 'only in A') : r.kind === 'onlyB' ? h('span.tl-dk.b', null, 'only in B') : r.kind === 'shifted' ? h('span.tl-dk', null, span(r.dt) + (r.dt > 0 ? ' later in A' : ' sooner in A')) : h('span.tl-dk', null, 'different');
        return h('li.tl-drow', { 'data-t': r.t, tabindex: '0', role: 'button', onclick: () => { stopPlay(); app.setCursor(app.cursor.id, Math.min(r.t, A.run.endT)); }, onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.currentTarget.click(); } } },
          h('span.num.tl-dt', null, clock(r.t)), tagEl, r.kind === 'changed' ? h('span.tl-dtext', null, h('span', null, 'A: ' + r.a.text), h('span.dim', null, 'B: ' + r.b.text)) : h('span.tl-dtext', null, text));
      });
      diffEl.replaceChildren(head, leadRows.length ? h('ul.tl-dleads', null, ...leadRows) : null, h('ol.tl-dlist', null, ...rows));
      markDiff();
    }
    function markDiff() { const t = app.cursor.t; diffEl.querySelectorAll('.tl-drow').forEach((el) => el.classList.toggle('future', +el.dataset.t > t + 0.5)); }

    // ------------------------------------------------------------------ playback
    let playing = false, raf = 0, lastTs = 0;
    function frame(ts) {
      raf = 0; if (!visible) return;
      const dt = Math.min(0.1, (ts - lastTs) / 1000 || 0); lastTs = ts;
      let again = false;
      if (playing) {
        const A = app.runOf(app.cursor.id), end = A ? A.endT : 0, t = Math.min(end, app.cursor.t + dt * speed);
        app.cursor.t = t; tree.setCursor(app.cursor, app.compareId); paintMaps(); markDiff(); app.emit('time');
        if (t >= end) stopPlay(); else again = true;
      }
      if (tab === 'worlds') { const a = mapA.tick(dt, kit.reducedMotion()), b = mapB.tick(dt, kit.reducedMotion()); again = again || a || b; }
      if (again) raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf && visible) { lastTs = performance.now(); raf = requestAnimationFrame(frame); } };
    function togglePlay() { if (playing) return stopPlay(); const A = app.runOf(app.cursor.id); if (!A) return; if (app.cursor.t >= A.endT - 0.5) app.cursor.t = 0; playing = true; playBtn.replaceChildren(icon('pause')); playBtn.setAttribute('aria-pressed', 'true'); kick(); }
    function stopPlay() { if (!playing) return; playing = false; playBtn.replaceChildren(icon('play')); playBtn.setAttribute('aria-pressed', 'false'); app.emit('cursor', {}); }

    // ------------------------------------------------------------------ the composer
    const KINDS = [
      { id: 'second', label: 'Second look', icon: 'eye' }, { id: 'dismiss', label: 'Dismiss a lead', icon: 'x-circle' }, { id: 'route', label: 'Rescue route', icon: 'route' }, { id: 'fault', label: 'Break something', icon: 'bolt' },
      { id: 'hazard', label: 'New hazard', icon: 'hazard' }, { id: 'hold', label: 'Hesitate', icon: 'pause' }, { id: 'params', label: 'Move a threshold', icon: 'sliders' }, { id: 'reroll', label: 'Re-roll the dice', icon: 'rotate' },
    ];
    const C = { kind: 'second', second: 'skip', dismiss: null, avoid: { slope: true, mud: true, gas: true, collapse: true }, order: '', fault: 'linkLoss', dur: 120, hz: 'hall', hzC: null, hzSize: 4, hold: 120, params: {}, seed: 7 };
    const compHead = h('div.tl-c-head'), compKinds = h('div.tl-c-kinds', { role: 'group', 'aria-label': 'Kind of decision' }), compOpts = h('div.tl-c-opts'), compSum = h('div.tl-c-sum');
    const forkBtn = h('button.btn.btn-primary.btn-lg.tl-forkbtn', { type: 'button', onclick: doFork }, icon('timeline'), 'Fork here');
    composer.append(h('header.panel-head', null, h('h3', null, 'Fork the mission'), kit.realityTag('live-algo')), h('div.panel-body.tl-c-body', null, compHead, compKinds, compOpts), h('div.tl-c-foot', null, compSum, forkBtn));
    KINDS.forEach((k) => compKinds.append(h('button.tl-kind', { type: 'button', 'aria-pressed': String(C.kind === k.id), 'data-kind': k.id, onclick: () => { C.kind = k.id; compKinds.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === C.kind))); setPlacing(false); buildOpts(); } }, icon(k.icon, 15), h('span', null, k.label))));
    function setPlacing(on) { placing = on ? { size: C.hzSize, c: C.hzC, cb: (c) => { C.hzC = c; C.hz = 'custom'; placing.c = c; buildOpts(); paintMaps(); } } : null; if (on && tab !== 'worlds') showTab('worlds'); paintMaps(); }
    const radio = (name, value, cur, text, sub, onpick) => h('label.check.tl-opt', null, h('input', { type: 'radio', name, value, checked: cur === value, onchange: () => onpick(value) }), h('span', null, text, sub ? h('small', null, sub) : null));
    function decision() {
      const A = app.byId(app.cursor.id), run = A?.run; if (!run) return null;
      switch (C.kind) {
        case 'second': return C.second === 'skip' ? { kind: 'skipSecondLook' } : { kind: 'onlyCheck', det: C.second };
        case 'dismiss': return { kind: 'dismiss', det: C.dismiss };
        case 'route': return { kind: 'route', avoid: Object.values(C.avoid).every(Boolean) ? null : { ...C.avoid }, order: C.order ? C.order.split(',') : null };
        case 'fault': return { kind: 'fault', id: C.fault, dur: C.dur };
        case 'hazard': { const p = M.HAZARD_PRESETS.find((x) => x.id === C.hz); return p ? { kind: 'hazard', c: p.c, size: C.hzSize, name: p.name, short: p.short } : { kind: 'hazard', c: C.hzC || [64, 36], size: C.hzSize, name: 'New debris, placed by the analyst', short: (C.hzC || [64, 36]).map((v) => v.toFixed(0)).join(', ') + ' m' }; }
        case 'hold': return { kind: 'hold', dur: C.hold };
        case 'params': { const q = { ...C.params }; if (q.csiThreshold != null) { const lr = app.csiLR(q.csiThreshold); if (lr) q.csiLR = { pos: lr.pos, neg: lr.neg }; } return { kind: 'params', params: q }; }
        case 'reroll': return { kind: 'reroll', seed: C.seed };
      }
      return null;
    }
    function buildOpts() {
      const A = app.byId(app.cursor.id), run = A?.run, t = app.cursor.t; compOpts.replaceChildren();
      if (!run) { compOpts.append(h('p.dim', null, 'Waiting for this branch to finish running.')); refreshSummary(); return; }
      const now = M.stateAt(run, t), re = () => { buildOpts(); };
      if (C.kind === 'second') {
        const a = M.phaseStart(run, 'assess'), open = a != null ? M.stateAt(run, a + 0.2).dets.filter((d) => d.status === 'possible') : [];
        if (C.second !== 'skip' && !open.some((d) => d.id === C.second)) C.second = 'skip';
        compOpts.append(h('p.tl-c-q', null, 'After the search, uncertain leads get a second reading from a new position before anyone walks in. What if they did not?'),
          radio('tl-second', 'skip', C.second, 'Skip every second look', 'Plan the rescue with what is confirmed', (v) => { C.second = v; refreshSummary(); }),
          ...open.map((d) => radio('tl-second', d.id, C.second, 'Check ' + d.id + ' only', M.leadWhere(d) + ', ' + (d.p * 100).toFixed(0) + ' % when the search ends', (v) => { C.second = v; refreshSummary(); })));
      } else if (C.kind === 'dismiss') {
        const open = now.dets.filter((d) => d.status === 'possible');
        if (!open.some((d) => d.id === C.dismiss)) C.dismiss = open[0]?.id || null;
        compOpts.append(h('p.tl-c-q', null, 'The operator can close a lead by hand. What does that cost if the lead was real?'),
          ...(open.length ? open.map((d) => radio('tl-dismiss', d.id, C.dismiss, 'Dismiss ' + d.id, M.leadWhere(d) + ', ' + (d.p * 100).toFixed(0) + ' % at ' + clock(t), (v) => { C.dismiss = v; refreshSummary(); })) : [h('p.dim', null, 'No lead is open at ' + clock(t) + '. Move the cursor to a moment when a lead is "possible" (the amber band in the tree).')]));
      } else if (C.kind === 'route') {
        const legs = (run.routeLog.filter((r) => r.legs).pop()?.legs || []).map((l) => l.det), perms = [];
        const rec = (rest, acc) => { if (!rest.length) perms.push(acc); else rest.forEach((x, i) => rec(rest.filter((_, j) => j !== i), [...acc, x])); };
        if (legs.length > 1 && legs.length <= 4) rec(legs, []);
        compOpts.append(h('p.tl-c-q', null, 'The planner keeps the rescue team out of hazards where it can. Accept a hazard, or change who is reached first.'),
          h('div.tl-c-grid', null, ...Object.entries(M.HAZARD_KINDS).map(([k, name]) => h('label.check', null, h('input', { type: 'checkbox', checked: !C.avoid[k], onchange: (e) => { C.avoid[k] = !e.target.checked; refreshSummary(); } }), 'Accept ' + name.replace('the ', '')))),
          h('label.field', null, h('span.label', null, 'Visiting order'), h('select.select.input-sm', { onchange: (e) => { C.order = e.target.value; refreshSummary(); } }, h('option', { value: '' }, 'The planner’s order' + (legs.length ? ' (' + legs.join(' → ') + ')' : '')), ...perms.filter((p) => p.join() !== legs.join()).map((p) => h('option', { value: p.join(','), selected: C.order === p.join(',') }, p.join(' → '))))));
      } else if (C.kind === 'fault') {
        compOpts.append(h('p.tl-c-q', null, 'Break one thing at ' + clock(t) + ' and see whether the mission still finds everyone.'),
          h('label.field', null, h('span.label', null, 'Fault'), h('select.select.input-sm', { onchange: (e) => { C.fault = e.target.value; re(); } }, ...Object.entries(M.FAULTS).map(([id, f]) => h('option', { value: id, selected: C.fault === id }, f.label)))),
          h('p.tl-c-does', null, M.FAULTS[C.fault].does),
          h('div.field', null, h('span.label', null, 'For how long'), seg([[30, '30 s'], [120, '2 min'], [null, 'Rest of mission']], () => C.dur, (v) => { C.dur = v; refreshSummary(); }, 'Fault duration')));
      } else if (C.kind === 'hazard') {
        compOpts.append(h('p.tl-c-q', null, 'A second slide. Drop a block of debris anywhere and every route in use is planned again.'),
          h('label.field', null, h('span.label', null, 'Where'), h('select.select.input-sm', { onchange: (e) => { C.hz = e.target.value; setPlacing(C.hz === 'custom'); re(); } }, ...M.HAZARD_PRESETS.map((p) => h('option', { value: p.id, selected: C.hz === p.id }, p.name)), h('option', { value: 'custom', selected: C.hz === 'custom' }, 'Place it on the map…'))),
          C.hz === 'custom' ? h('p.tl-c-does', null, C.hzC ? 'Placed at ' + C.hzC[0].toFixed(1) + ', ' + C.hzC[1].toFixed(1) + ' m. Click map A again to move it.' : 'Click anywhere on map A to place it.') : null,
          h('div.field', null, h('span.label', null, 'Size'), seg([[3, '3 m'], [4, '4 m'], [8, '8 m']], () => C.hzSize, (v) => { C.hzSize = v; if (placing) placing.size = v; refreshSummary(); paintMaps(); }, 'Hazard size')));
        if (C.hz === 'custom' && !placing) setPlacing(true);
      } else if (C.kind === 'hold') {
        compOpts.append(h('p.tl-c-q', null, 'Every unit stops while the operator thinks. What does hesitation cost?'),
          h('div.field', null, h('span.label', null, 'All stop for'), seg([[30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min']], () => C.hold, (v) => { C.hold = v; refreshSummary(); }, 'Hold duration')));
      } else if (C.kind === 'params') {
        const inUse = run.params, P = [
          ['confirmed', 'Confirm line', 0.5, 0.99, 0.01, inUse.confirmed, (v) => (v * 100).toFixed(0) + ' %', 'A lead is "confirmed" at or above this probability.'],
          ['possible', 'Lead-open line', 0.02, 0.5, 0.01, inUse.possible, (v) => (v * 100).toFixed(0) + ' %', 'Below this a lead is closed.'],
          ['csiThreshold', 'Wi-Fi alarm line', 0.2, 0.95, 0.01, inUse.csiThreshold, (v) => v.toFixed(2), 'The network output above which a window counts as "person".'],
          ['maxWindows', 'Listening windows per stop', 1, 4, 1, inUse.maxWindows, (v) => String(v), 'How many 10-second windows a stop may take when a lead stays uncertain.'],
        ];
        compOpts.append(h('p.tl-c-q', null, 'Change a line the console draws, from ' + clock(t) + ' on.'), ...P.map(([key, label, min, max, step, def, f, hint]) => {
          const val = C.params[key] ?? def, out = h('output', null, f(val)), note = h('small.tl-c-lr');
          const upd = (v) => { if (Math.abs(v - def) < step / 2) delete C.params[key]; else C.params[key] = v; out.textContent = f(v); out.classList.toggle('changed', C.params[key] != null); if (key === 'csiThreshold') { const lr = app.csiLR(v); note.textContent = lr ? 'On the 955 simulated test windows: finds ' + (lr.tpr * 100).toFixed(0) + ' % of people, alarms on ' + (lr.fpr * 100).toFixed(0) + ' % of empty rooms. A "person" reading is worth ×' + lr.pos.toFixed(1) + '.' : ''; } refreshSummary(); };
          const inp = h('input.slider', { type: 'range', min, max, step, value: val, 'aria-label': label, title: hint, style: '--p:' + ((val - min) / (max - min)) * 100 + '%', oninput: (e) => { e.target.style.setProperty('--p', ((+e.target.value - min) / (max - min)) * 100 + '%'); upd(+e.target.value); } });
          out.classList.toggle('changed', C.params[key] != null); if (key === 'csiThreshold') upd(val);
          return h('div.tl-c-slider', null, h('div.slider-row', null, h('span.label', null, label), inp, out), key === 'csiThreshold' ? note : null);
        }));
      } else if (C.kind === 'reroll') {
        compOpts.append(h('p.tl-c-q', null, 'Same building, same people, different luck. Each stop plays a random simulated Wi-Fi window of the right kind, and sensor noise comes from a new seed.'),
          h('label.field', null, h('span.label', null, 'Seed'), h('div.row', null, h('input.input.input-sm.num', { type: 'number', min: '1', max: '99999', value: C.seed, 'aria-label': 'Random seed', oninput: (e) => { C.seed = Math.max(1, Math.min(99999, Math.round(+e.target.value || 1))); refreshSummary(); } }), h('button.btn.btn-sm', { type: 'button', onclick: () => { C.seed = 1 + Math.floor(Math.random() * 9999); re(); } }, icon('rotate'), 'Another'))));
      }
      refreshSummary();
    }
    function refreshSummary() {
      const A = app.byId(app.cursor.id), run = A?.run, t = app.cursor.t;
      compHead.replaceChildren(h('span.dim', null, 'From'), h('b', null, A ? A.name : ''), h('span.dim', null, 'at'), h('b.num', null, clock(t)), run ? h('span.tl-c-phase', null, M.PHASE_INFO[M.stateAt(run, t).phase].label) : null);
      const dec = decision(), res = dec && run ? M.resolve(dec, run, t) : { ok: false, why: 'Waiting for this branch to finish running.' };
      forkBtn.disabled = !res.ok;
      compSum.replaceChildren(res.ok ? h('p', null, h('b', null, res.label + '. '), res.detail, Math.abs(res.forkT - t) > 1 ? h('span.c-accent', null, ' The fork is drawn at ' + clock(res.forkT) + ', when the decision is taken.') : null) : h('p.c-warn', null, res.why));
    }
    function doFork() {
      const dec = decision(); if (!dec) return;
      const out = app.fork(app.cursor.id, app.cursor.t, dec);
      if (out.error) { ctx.shell.toast(out.error, { level: 'info' }); return; }
      if (out.duplicate) ctx.shell.toast('That fork already exists: ' + out.branch.name + '.', { level: 'info' });
      setPlacing(false); if (C.hz === 'custom') C.hz = 'hall';
      app.pendingSelect = out.branch.id; app.emit('branches');
    }
    let sumTimer = 0;
    const lazySummary = () => { if (sumTimer) return; sumTimer = setTimeout(() => { sumTimer = 0; if (C.kind === 'dismiss' || C.kind === 'second') buildOpts(); else refreshSummary(); }, 140); };

    // ------------------------------------------------------------------ other panes
    mountSweeps(panes.sweeps, app); mountCf(panes.cf, app); mountRegret(panes.regret, app); mountMethod(panes.method, app);

    // ------------------------------------------------------------------ wiring
    let treeTimer = 0;
    function paintTree() {
      tree.render({ rows: app.rows(), tMax: app.tMax(), truth: app.truth, base: trunk.run });
      tree.setCursor(app.cursor, app.compareId); tree.setLive(sim.state.t);
      const running = app.branches.filter((b) => b.status === 'running' || b.status === 'queued').length;
      busy.replaceChildren(...(running || pool.pending ? [h('div.spinner.sm'), h('span', null, running ? plural(running, 'branch', 'branches') + ' running on ' + (pool.mode === 'worker' ? plural(pool.size, 'worker') : 'this page') : 'working…')] : []));
    }
    function paintProof() {
      const done = app.branches.filter((b) => b.run), ok = done.filter((b) => b.verify === 'ok').length, bad = done.filter((b) => b.verify === 'fail').length, L = app.proof.live;
      const cls = bad || (L && L.state === 'differs') ? 'bad' : ok === done.length && done.length && L && L.state === 'ok' ? 'ok' : 'wait';
      proofChip.className = 'tl-proof ' + cls;
      proofChip.replaceChildren(icon(cls === 'ok' ? 'check-circle' : cls === 'bad' ? 'alert' : 'clock', 14), h('span', null, cls === 'bad' ? 'Replay check failed' : cls === 'ok' ? 'Replay verified' : 'Verifying replay'), h('small.num', null, ok + ' of ' + done.length + ' branches run twice, same fingerprint' + (L && L.state === 'ok' ? ' · trunk matches live at ' + clock(L.t) : L && L.state === 'differs' ? ' · trunk differs from live' : '')));
    }
    app.on('branches', () => {
      if (app.pendingSelect && app.runOf(app.pendingSelect)) { const id = app.pendingSelect; app.pendingSelect = null; const b = app.byId(id); app.compareId = b.parent; app.setCursor(id, Math.min(b.run.endT, Math.max(b.forkT, app.cursor.t))); return; }
      paintTree(); paintMaps(); paintDiff(); refreshSummary(); paintProof();
    });
    app.on('progress', () => { if (treeTimer) return; treeTimer = setTimeout(() => { treeTimer = 0; paintTree(); }, 200); });
    app.on('proof', paintProof);
    app.on('cursor', (e) => { tree.setCursor(app.cursor, app.compareId); paintMaps(); if (e && e.changed) { paintDiff(); buildOpts(); } else { markDiff(); lazySummary(); } kick(); });
    app.on('truth', () => { paintMaps(); paintDiff(); });
    app.on('lead', () => { paintMaps(); kick(); });
    app.on('trunk', () => buildOpts());
    showTab('worlds'); buildOpts(); paintTree(); paintProof(); paintDiff();
    if (ctx.params && ctx.params.tab && panes[ctx.params.tab]) showTab(ctx.params.tab);

    return {
      onShow() { visible = true; if (!app.live || stale) sync(); tree.setLive(sim.state.t); paintMaps(true); kick(); },
      onHide() { visible = false; stopPlay(); cancelAnimationFrame(raf); raf = 0; },
      onParams(p) { if (p && p.tab && panes[p.tab]) showTab(p.tab); if (p && p.truth != null) app.setTruth(p.truth); },
      dispose() { offs.forEach((f) => f()); pool.dispose(); tree.dispose(); mapA.dispose(); mapB.dispose(); },
    };
  },
};
