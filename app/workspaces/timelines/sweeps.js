// Timelines: sensitivity sweeps. Fork one decision across all its options, or one parameter across a range,
// and measure what changes. Every row and every point is a full mission run in a worker.
import * as M from './model.js';
import { COLS, TRUTH_COLS } from './tree.js';
const { clock, span, plural } = M;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const PARAMS = {
  confirmed: { label: 'Confirm line', unit: '%', values: [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.99], fmt: (v) => (v * 100).toFixed(0) + ' %', inUse: (p) => p.confirmed, what: 'the probability at which a lead counts as a confirmed person' },
  possible: { label: 'Lead-open line', unit: '%', values: [0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5], fmt: (v) => (v * 100).toFixed(0) + ' %', inUse: (p) => p.possible, what: 'the probability below which a lead is closed' },
  maxWindows: { label: 'Listening windows', unit: '', values: [1, 2, 3, 4], fmt: (v) => String(v), inUse: (p) => p.maxWindows, what: 'how many 10-second Wi-Fi windows a stop may take while a lead stays uncertain' },
  csiThreshold: { label: 'Wi-Fi alarm line', unit: '', values: [0.3, 0.4, 0.45, 0.5, 0.5345, 0.6, 0.7, 0.8, 0.9], fmt: (v) => v.toFixed(2), inUse: (p) => p.csiThreshold, what: 'the network output above which a window counts as "person"' },
};

export function mountSweeps(pane, app) {
  const { h, kit } = app, { icon } = kit;
  let mode = 'decisions', dec = null, decGen = 0, par = { key: 'confirmed', K: 16, data: null, gen: 0, running: false, done: 0, total: 0, patched: null };
  const body = h('div.tl-sw-body');
  const modeSeg = h('div.seg', { role: 'group', 'aria-label': 'Kind of sweep' },
    h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => setMode('decisions') }, 'Every decision'),
    h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setMode('params') }, 'One parameter, a range'));
  pane.append(h('div.tl-sw', null, h('div.tl-sw-bar', null, modeSeg, h('div.grow'), h('span.caption', null, 'Each row and each point is a whole mission, run in a worker.')), body));
  function setMode(m) { mode = m; modeSeg.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0) === (m === 'decisions')))); paint(); if (m === 'decisions' && !dec) runDecisions(); }

  // ---------------------------------------------------------------- decisions
  function families(b, T) {
    const run = b.run, a = M.phaseStart(run, 'assess'), s = M.phaseStart(run, 'search'), pl = M.phaseStart(run, 'plan'), out = [];
    const inSearch = s != null && T >= s && (a == null || T < a), tf = inSearch ? T : s;
    if (a != null) {
      const open = M.stateAt(run, a + 0.2).dets.filter((d) => d.status === 'possible');
      out.push({ id: 'second', title: 'The second look', at: a, opts: [{ T: a, dec: { kind: 'skipSecondLook' } }, ...open.map((d) => ({ T: a, dec: { kind: 'onlyCheck', det: d.id } })), ...open.map((d) => ({ T: a + 0.2, dec: { kind: 'dismiss', det: d.id } }))] });
    }
    if (pl != null) {
      const kinds = Object.keys(M.HAZARD_KINDS), all = { slope: true, mud: true, gas: true, collapse: true };
      out.push({ id: 'hazards', title: 'Which hazards the route accepts', at: pl, opts: [...kinds.map((k) => ({ T: pl, dec: { kind: 'route', avoid: { ...all, [k]: false } } })), { T: pl, dec: { kind: 'route', avoid: { slope: false, mud: false, gas: false, collapse: false } } }] });
      const legs = (run.routeLog.filter((r) => r.legs).pop()?.legs || []).map((l) => l.det), perms = [];
      const rec = (rest, acc) => { if (!rest.length) perms.push(acc); else rest.forEach((x, i) => rec(rest.filter((_, j) => j !== i), [...acc, x])); };
      if (legs.length > 1 && legs.length <= 3) rec(legs, []);
      const others = perms.filter((p) => p.join() !== legs.join());
      if (others.length) out.push({ id: 'order', title: 'Who is reached first', at: pl, opts: others.map((p) => ({ T: pl, dec: { kind: 'route', order: p } })) });
    }
    if (tf != null) {
      out.push({ id: 'faults', title: 'A fault at ' + clock(tf), at: tf, opts: Object.keys(M.FAULTS).map((id) => ({ T: tf, dec: { kind: 'fault', id, dur: id === 'linkLoss' ? 120 : null } })) });
      out.push({ id: 'hold', title: 'Hesitating at ' + clock(tf), at: tf, opts: [60, 300].map((d) => ({ T: tf, dec: { kind: 'hold', dur: d } })) });
      out.push({ id: 'slide', title: 'A second slide at ' + clock(tf), at: tf, opts: M.HAZARD_PRESETS.map((p) => ({ T: tf, dec: { kind: 'hazard', ...p } })) });
    }
    return out;
  }
  async function runDecisions() {
    const b = app.byId(app.cursor.id); if (!b || !b.run) return;
    const gen = ++decGen, fams = families(b, app.cursor.t);
    dec = { branch: b.id, name: b.name, hash: b.run.hash, base: b.run, fams, total: fams.reduce((n, f) => n + f.opts.length, 0), done: 0, running: true };
    paint();
    await Promise.all(fams.flatMap((f) => f.opts.map(async (o) => {
      try { const r = await app.probe(b.id, o.T, o.dec); Object.assign(o, r.ok ? { run: r.run, res: r.res } : { why: r.why }); } catch (e) { o.why = String(e.message || e); }
      if (gen !== decGen) return; dec.done++; lazyPaint();
    })));
    if (gen !== decGen) return;
    dec.running = false; app.sweep = dec; app.emit('sweep'); paint();
  }
  let lazy = 0; const lazyPaint = () => { if (lazy) return; lazy = setTimeout(() => { lazy = 0; paint(); }, 180); };

  function paintDecisions() {
    const A = app.byId(app.cursor.id);
    if (!dec) { body.replaceChildren(h('div.empty', null, h('div.spinner'), h('p', null, 'Waiting for the trunk to finish before sweeping its decisions.'))); return; }
    const useTruth = app.truth, base = dec.base, cols = useTruth ? [...COLS, ...TRUTH_COLS] : COLS;
    const fams = dec.fams.map((f) => { const done = f.opts.filter((o) => o.run); let top = null; for (const o of done) { o.imp = M.impact(o.run, base, useTruth); if (!top || M.cmpImpact(o.imp, top.imp) < 0) top = o; } return { ...f, top, any: done.some((o) => o.imp.some((v) => v > 0)) }; });
    const ranked = fams.filter((f) => f.top).sort((x, y) => M.cmpImpact(x.top.imp, y.top.imp));
    const head = h('div.tl-sw-head');
    if (dec.running) head.append(h('div.row', null, h('div.spinner.sm'), h('span', null, 'Forking ' + dec.name + ' ' + dec.total + ' ways: ' + dec.done + ' done')), h('div.bar', null, h('i', { style: { width: (100 * dec.done) / dec.total + '%' } })));
    else if (ranked.length) {
      const first = ranked[0], w = M.deltaWords(first.top.run, base, useTruth), none = ranked.filter((f) => !f.any);
      head.append(h('p.tl-sw-lede', null, 'In ' + dec.name + ', ', h('em', null, first.title.toLowerCase()), ' mattered most.'),
        h('p.tl-sw-why', null, h('b', null, first.top.res.label + ': '), w.length ? w.slice(0, 4).map((x) => x.text).join(', ') + '.' : 'no measurable change.', none.length ? ' ' + none.map((f) => f.title).join('; ') + ': no option changed the outcome at all.' : ''),
        h('p.caption', null, plural(dec.total, 'fork') + ' of ' + dec.name + ', each run to the end. Ranked by, in order: ' + M.RANK_WORDS[useTruth ? 'truth' : 'console'].slice(1).join('; ') + '. A later item only breaks ties.' + (useTruth ? ' Scored against ground truth.' : ' Scored on what the console knows; switch on ground truth to score against what was really there.')));
    }
    const stale = A && A.run && (dec.branch !== A.id || dec.hash !== A.run.hash);
    const again = h('button.btn.btn-sm', { type: 'button', disabled: dec.running, onclick: runDecisions }, icon('rotate'), stale ? 'Sweep ' + A.name + ' at ' + clock(app.cursor.t) : 'Run again');
    const table = h('table.table.dense.tl-sw-table', null, h('thead', null, h('tr', null, h('th', null, 'Decision, and every option tried'), ...cols.map((c) => h('th.num', { title: c.tip, class: c.truth ? 'tl-truthcol' : '' }, c.label)), h('th'))),
      h('tbody', null, h('tr.tl-sw-base', null, h('td', null, h('b', null, dec.name), ' as it is'), ...cols.map((c) => h('td.num', null, c.fmt ? c.fmt(c.get(base), base) : String(c.get(base)))), h('td')),
        ...(ranked.length ? ranked : fams).flatMap((f, fi) => [
          h('tr.tl-sw-fam', null, h('td', { colSpan: cols.length + 2 }, h('span.num.tl-sw-rank', null, ranked.length ? String(fi + 1) : '·'), h('b', null, f.title), h('span.dim', null, ' decided at ' + clock(f.at)), !f.any && f.top ? h('span.tl-sw-none', null, 'changes nothing') : null)),
          ...f.opts.map((o) => h('tr', { class: o.run && !o.imp?.some((v) => v > 0) ? 'tl-sw-same' : '' }, h('td', { title: o.res?.detail || o.why || '' }, o.res ? o.res.label : o.why ? h('span.dim', null, o.why) : h('span.dim', null, 'running…')),
            ...cols.map((c) => { if (!o.run) return h('td.num.dim', null, '·'); const v = c.get(o.run), d = v - c.get(base), show = Math.abs(d) >= (c.min || 0.5); return h('td.num', { class: !show ? 'same' : c.good === 0 ? 'chg' : (d > 0) === (c.good > 0) ? 'up' : 'down' }, c.fmt ? c.fmt(v, o.run) : String(v), show ? h('i', null, (d > 0 ? '+' : '−') + (c.delta ? c.delta(d) : Math.abs(d))) : null); }),
            h('td', null, o.run ? h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Add this fork to the tree', 'aria-label': 'Add to the tree: ' + o.res.label, onclick: () => { const out = app.fork(dec.branch, o.T, o.dec); if (out.error) app.ctx.shell.toast(out.error); else { app.pendingSelect = out.branch.id; app.emit('branches'); app.showTab('worlds'); } } }, icon('plus', 12), 'Tree') : null))),
        ])));
    body.replaceChildren(h('div.tl-sw-dec', null, h('div.tl-sw-top', null, head, again), h('div.tl-sw-scroll', null, table)));
  }

  // ---------------------------------------------------------------- parameters
  async function runParams() {
    const P = PARAMS[par.key], gen = ++par.gen, K = par.K, t = app.trunk; if (!t || !t.run) return;
    const seeds = Array.from({ length: K }, (_, i) => 1000 + i * 7919);
    par.data = { key: par.key, K, inUse: P.inUse(t.run.params), rows: P.values.map((v) => ({ v, runs: [] })) }; par.running = true; par.done = 0; par.total = P.values.length * K; par.patched = null; paint();
    const mk = (v, seed) => { const q = { [par.key]: v }; if (par.key === 'csiThreshold') { const lr = app.csiLR(v); if (lr) q.csiLR = { pos: lr.pos, neg: lr.neg }; } return app.buildSpec(t, { forkT: 0, acts: [{ id: 'sweep', t: 0, params: q }], opts: { windows: 'random', seed } }, { frames: false }); };
    if (par.key === 'maxWindows') app.pool.run({ ...app.trunkSpec(), frames: false, patched: true }).then((r) => { if (gen === par.gen) { par.patched = { ok: r.hash === t.run.hash, a: r.hash, b: t.run.hash }; lazyPaint(); } }).catch(() => {});
    await Promise.all(par.data.rows.flatMap((row) => seeds.map(async (seed) => {
      try { const r = await app.pool.run(mk(row.v, seed)); if (gen !== par.gen) return; row.runs.push(r); } catch (e) { row.err = String(e.message || e); }
      if (gen !== par.gen) return; par.done++; lazyPaint();
    })));
    if (gen !== par.gen) return; par.running = false; paint();
  }
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
  const se = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) / a.length); };
  function chart({ title, xs, fmt, mark, yMax, yFmt, series, w = 300, hgt = 190, xLabel }) {
    const L = 34, R = 96, T = 10, B = 30, iw = w - L - R, ih = hgt - T - B, n = xs.length;
    const X = (i) => L + (n === 1 ? iw / 2 : (i / (n - 1)) * iw), Y = (v) => T + ih - (Math.min(v, yMax) / yMax) * ih;
    let s = '<svg class="chart tl-chart" viewBox="0 0 ' + w + ' ' + hgt + '" width="' + w + '" height="' + hgt + '" role="img" aria-label="' + esc(title) + '">';
    const ticks = yMax <= 4 ? Array.from({ length: Math.round(yMax) + 1 }, (_, i) => i) : [0, yMax / 2, yMax];
    for (const v of ticks) s += '<line class="gridline" x1="' + L + '" x2="' + (L + iw) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/><text x="' + (L - 6) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + esc(yFmt ? yFmt(v) : v) + '</text>';
    xs.forEach((v, i) => { if (n > 6 && i % 2 && i !== n - 1 && v !== mark) return; s += '<text x="' + X(i).toFixed(1) + '" y="' + (hgt - 14) + '" text-anchor="middle">' + esc(fmt(v)) + '</text>'; });
    s += '<text class="axis-title" x="' + (L + iw / 2) + '" y="' + (hgt - 1) + '" text-anchor="middle">' + esc(xLabel) + '</text>';
    const mi = xs.findIndex((v) => Math.abs(v - mark) < 1e-6);
    if (mi >= 0) s += '<line class="tl-inuse" x1="' + X(mi).toFixed(1) + '" x2="' + X(mi).toFixed(1) + '" y1="' + T + '" y2="' + (T + ih) + '"/><text class="tl-inuse-t" x="' + (X(mi) + 4).toFixed(1) + '" y="' + (T + 8) + '">in use</text>';
    const ends = [];
    for (const sr of series) {
      const pts = sr.mean.map((m, i) => (Number.isFinite(m) ? [X(i), Y(m), i] : null)).filter(Boolean); if (!pts.length) continue;
      if (sr.se) { const up = pts.map(([x, , i]) => x.toFixed(1) + ',' + Y(sr.mean[i] + sr.se[i]).toFixed(1)), dn = pts.map(([x, , i]) => x.toFixed(1) + ',' + Y(Math.max(0, sr.mean[i] - sr.se[i])).toFixed(1)).reverse(); s += '<polygon class="tl-band" style="fill:var(' + sr.c + ')" points="' + up.concat(dn).join(' ') + '"/>'; }
      s += '<polyline class="tl-line' + (sr.dash ? ' dash' : '') + '" style="stroke:var(' + sr.c + ')" points="' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '"/>';
      for (const p of pts) s += '<circle class="tl-pt" style="fill:var(' + sr.c + ')" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.2"><title>' + esc(sr.name + ' at ' + fmt(xs[p[2]]) + ': ' + (yFmt ? yFmt(sr.mean[p[2]]) : sr.mean[p[2]].toFixed(2))) + '</title></circle>';
      const last = pts[pts.length - 1]; ends.push({ y: last[1], sr, v: sr.mean[last[2]] });
    }
    ends.sort((a, b) => a.y - b.y); for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 11) ends[i].y = ends[i - 1].y + 11;
    for (const e of ends) s += '<text class="series-label" style="fill:var(' + e.sr.c + ')" x="' + (L + iw + 7) + '" y="' + (e.y + 3.5).toFixed(1) + '">' + esc(e.sr.short || e.sr.name) + '</text>';
    s += '</svg>';
    const el = h('figure.tl-fig', null, h('figcaption', null, title)); el.insertAdjacentHTML('beforeend', s); return el;
  }
  function paintParams() {
    const P = PARAMS[par.key], t = app.trunk, d = par.data && par.data.key === par.key ? par.data : null, useTruth = app.truth;
    const pick = h('div.seg', { role: 'group', 'aria-label': 'Parameter' }, ...Object.entries(PARAMS).map(([k, p]) => h('button', { type: 'button', 'aria-pressed': String(par.key === k), onclick: () => { par.key = k; paint(); } }, p.label)));
    const reps = h('div.seg', { role: 'group', 'aria-label': 'Missions per value' }, ...[8, 16, 32].map((k) => h('button', { type: 'button', 'aria-pressed': String(par.K === k), onclick: () => { par.K = k; paint(); } }, String(k))));
    const go = h('button.btn', { type: 'button', disabled: par.running || !t || !t.run || (par.key === 'csiThreshold' && !app.hasScores()), onclick: runParams }, icon('play'), 'Run ' + P.values.length * par.K + ' missions');
    const controls = h('div.tl-sw-pctl', null, h('div.field', null, h('span.label', null, 'Parameter'), pick), h('div.field', null, h('span.label', null, 'Missions per value'), reps), go,
      par.running ? h('div.tl-sw-prog', null, h('div.bar', null, h('i', { style: { width: (100 * par.done) / par.total + '%' } })), h('span.num.caption', null, par.done + ' / ' + par.total)) : null);
    const note = h('p.caption.tl-sw-note', null, 'Sweeping ' + P.what + '. Every mission is flown by the autopilot with random simulated Wi-Fi windows; the same ' + par.K + ' seeds are used at every value, so the lines differ only because of the parameter.' +
      (par.key === 'csiThreshold' ? ' The Wi-Fi likelihood ratio is recomputed at each line from the 955 simulated test windows, so fusion stays calibrated.' : '') + (par.key === 'maxWindows' ? ' This number is a literal in the simulator; the worker opens it up by rewriting one default in the same source text.' : ''));
    if (!d) { body.replaceChildren(h('div.tl-sw-par', null, controls, note, h('div.empty', null, icon('sliders', 24), h('p', null, 'Pick a parameter and run the sweep. ' + P.values.length + ' values, ' + par.K + ' missions each: about ' + Math.max(5, Math.round((P.values.length * par.K * 0.9) / Math.max(1, app.pool.size))) + ' seconds on this computer.')))); return; }
    const xs = d.rows.map((r) => r.v), col = (f) => ({ mean: d.rows.map((r) => mean(r.runs.map(f))), se: d.rows.map((r) => se(r.runs.map(f))) });
    const people = useTruth
      ? [{ name: 'found by sensors alone', short: 'by sensors', c: '--person', ...col((r) => r.truth.people.filter((p) => p.outcome === 'sensors').length) }, { name: 'left for the team to check', short: 'team checks', c: '--warn', ...col((r) => r.truth.people.filter((p) => p.outcome === 'team').length) }, { name: 'not reached', short: 'not reached', c: '--danger', ...col((r) => r.truth.missed) }]
      : [{ name: 'confirmed by sensors alone', short: 'by sensors', c: '--person', ...col((r) => r.metrics.bySensors) }, { name: 'handed to the team', short: 'team checks', c: '--warn', ...col((r) => r.metrics.byTeam) }, { name: 'left open', short: 'left open', c: '--text-3', ...col((r) => r.metrics.open) }];
    const cost = useTruth
      ? [{ name: 'false leads chased', short: 'false leads', c: '--text', ...col((r) => r.truth.falseChased) }, { name: 'false confirmations', short: 'false confirm', c: '--danger', dash: true, ...col((r) => r.truth.falseConfirmed) }]
      : [{ name: 'second looks driven', short: 'second looks', c: '--text', ...col((r) => r.metrics.secondLooks) }, { name: 'leads closed', short: 'leads closed', c: '--ok', dash: true, ...col((r) => r.metrics.closed) }];
    const time = [{ name: 'mission time', short: 'minutes', c: '--accent', ...col((r) => r.metrics.endT / 60) }];
    const cw = Math.max(250, Math.floor((body.clientWidth - 48) / 3));
    const tmax = Math.max(12, Math.ceil(Math.max(...time[0].mean.filter(Number.isFinite), 0) / 4) * 4);
    const charts = h('div.tl-sw-charts', null,
      chart({ title: useTruth ? 'Of the 3 people really there, mean per mission' : 'Leads the console holds at the end, mean per mission', xs, fmt: P.fmt, mark: d.inUse, yMax: 3, series: people, w: cw, xLabel: P.label }),
      chart({ title: useTruth ? 'Wasted effort and wrong calls, mean per mission' : 'Effort, mean per mission', xs, fmt: P.fmt, mark: d.inUse, yMax: Math.max(2, Math.ceil(Math.max(...cost.flatMap((s) => s.mean.filter(Number.isFinite)), 0))), series: cost, w: cw, xLabel: P.label }),
      chart({ title: 'Mission time, minutes', xs, fmt: P.fmt, mark: d.inUse, yMax: tmax, yFmt: (v) => v.toFixed(0), series: time, w: cw, xLabel: P.label }));
    // one sentence: what moved most across the range
    let find = null;
    if (!par.running) { for (const sr of [...people, ...cost]) { const lo = Math.min(...sr.mean), hi = Math.max(...sr.mean), i0 = sr.mean.indexOf(lo), i1 = sr.mean.indexOf(hi); if (!find || hi - lo > find.d) find = { d: hi - lo, sr, lo, hi, i0, i1 }; } }
    const flat = people.concat(cost).filter((sr) => Math.max(...sr.mean) - Math.min(...sr.mean) < 0.05).map((sr) => sr.name);
    const finding = find ? h('p.tl-sw-find', null, find.d < 0.05 ? 'Across this whole range nothing moves: in this scenario the outcome does not depend on ' + P.what + '.' : ['Across this range, ', h('b', null, find.sr.name), ' moves most: ' + find.lo.toFixed(2) + ' per mission at ' + P.fmt(xs[find.i0]) + ', ' + find.hi.toFixed(2) + ' at ' + P.fmt(xs[find.i1]) + '.', flat.length ? ' Not affected: ' + flat.join(', ') + '.' : '']) : null;
    const proof = par.key === 'maxWindows' && par.patched ? h('p.caption', { class: par.patched.ok ? 'c-ok' : 'c-danger' }, par.patched.ok ? 'Check passed: the opened-up engine at 2 windows reproduces the stock engine exactly (fingerprint ' + par.patched.a + ').' : 'Check failed: the opened-up engine does not reproduce the stock engine (' + par.patched.a + ' against ' + par.patched.b + ').') : null;
    body.replaceChildren(h('div.tl-sw-par', null, controls, h('div.tl-sw-res', null, finding, charts, h('p.caption', null, 'Lines are means over ' + d.K + ' missions; bands are one standard error. ' + (useTruth ? 'Scored against ground truth, known only because this is a simulation.' : 'Counts are what the console believes. Switch on ground truth to see who was really found.') + ' All people, readings and the building are simulated.'), proof, note)));
  }

  function paint() { if (pane.hidden) return; if (mode === 'decisions') paintDecisions(); else paintParams(); }
  app.on('tab', (id) => { if (id === 'sweeps') { paint(); if (!dec && app.trunk.run) runDecisions(); } });
  app.on('trunk', () => { dec = null; par.data = null; if (!pane.hidden) runDecisions(); });
  app.on('truth', paint); app.on('scores', paint);
  app.on('cursor', (e) => { if (e && e.changed && !pane.hidden && mode === 'decisions') paint(); });
  // run once in the background so "Regret" has candidates even if this tab is never opened
  app.on('branches', () => { if (!dec && app.trunk.run && app.trunk.verify === 'ok' && app.cursor.id === 'trunk') runDecisions(); });
}
