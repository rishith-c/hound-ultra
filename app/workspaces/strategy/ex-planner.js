// Exhibit 3: the mission as a planning problem under uncertainty. A random world, its belief, and a Monte-Carlo tree
// search (policies.js) growing one decision at a time; then the same three policies on hundreds of fresh worlds.
import { makeSensors } from './model.js';
import { makeWorld, populate } from './worlds.js';
import { TreeSearch, POLICIES, newEpisode, epLook, epHandoff, epResult, lookCost, obsWords, RULES, DEFAULTS } from './policies.js';
import { runPool } from './pool.js';
import { exhibitBrief, demoOverlay, makeLoop, tok, rgba, ci, paired, clamp, fmtClock, fmtPct } from './common.js';

const FIRST = 50001, IDS = ['scripted', 'greedy', 'tree'];

export default async function (pane, ctx) {
  const { h, icon, fitCanvas, reducedMotion } = ctx.kit, S = makeSensors(), demo = () => ctx.mode === 'demo';
  let visible = false, playing = true, sims = 560, N = 600;

  // ---------- one episode, decision by decision ----------
  let seed = 4001, world, truth, ep, ts, phase, hold = 0, decision = 0, chosen = null, log = [];
  function start(s) { seed = s; world = makeWorld(seed, S); truth = populate(world, seed); ep = newEpisode(world, truth, seed); decision = 0; log = []; think(); }
  function think() { decision++; chosen = null; phase = 'grow'; ts = new TreeSearch(world, { B: ep.B, conf: ep.conf, t: ep.t, at: ep.at }, {}, (seed * 131 + 17 * decision) >>> 0); layoutKey = -1; say('Decision ' + decision + '. Trying every next stop against sampled worlds.'); }
  function act() {
    const a = ts.best(); chosen = a; hold = 0;
    if (a.handoff || ep.t + lookCost(world, ep.at, a.stop) > RULES.budget) { phase = 'end'; epHandoff(ep); const r = epResult(ep); say('Hand over to the team after ' + fmtClock(ep.tSearch) + '. ' + (r.people ? 'Found ' + r.found + ' of ' + r.people + (r.people === 1 ? ' person.' : ' people.') : 'No one was there.')); log.unshift('Hand over at ' + fmtClock(ep.tSearch) + ': ' + r.found + ' of ' + r.people + ' found, ' + r.falseChases + ' false alarms chased'); }
    else { phase = 'acted'; const obs = epLook(ep, a.stop); const w = obsWords(world, a.stop, obs); say('Go to ' + world.stops[a.stop].label.replace(/^./, (c) => c.toLowerCase()) + '. Heard: ' + w + '.'); log.unshift(fmtClock(ep.t) + ' ' + world.stops[a.stop].label + ': ' + w); }
    drawLog();
  }
  function stepTime(dt) {
    if (!ts) return;
    if (phase === 'grow') { const t0 = performance.now(); while (ts.sims < sims && performance.now() - t0 < 4) ts.run(1); if (ts.sims >= sims) { phase = 'grown'; hold = 0; } }
    else { hold += dt; if (phase === 'grown' && hold > 0.7) act(); else if (phase === 'acted' && hold > 1.8) think(); else if (phase === 'end' && hold > 5) start(seed + 1); }
  }

  // ---------- layout ----------
  const left = h('div.strategy-col.left.adv-only'), right = h('div.strategy-col.right.adv-only'), cv = h('canvas.strategy-tree', { role: 'img', 'aria-label': 'The search tree for the current decision, and the floor plan it is planning over' });
  const overlay = demoOverlay(ctx.kit, { title: 'Thinking several stops ahead', sentence: 'Before each move the planner imagines hundreds of searches and follows the branch that ends best.', tags: ['live-algo', 'sim'], action: { label: 'Next world', icon: 'reset', run: () => { start(seed + 1); } } });
  overlay.el.classList.add('demo-only');
  const main = h('div.strategy-main', null, h('div.strategy-treewrap', null, cv), overlay.el);
  pane.append(h('div.strategy-ex.wide-side', null, left, main, right));
  const say = (t) => overlay.caption(t);
  const simOut = h('output', null, String(sims)), simInp = h('input.slider', { type: 'range', min: 140, max: 2240, step: 140, value: sims, 'aria-label': 'Imagined searches per decision', oninput: () => { sims = +simInp.value; simOut.textContent = String(sims); } });
  const playBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => { playing = !playing; playBtn.textContent = playing ? 'Pause' : 'Play'; } }, 'Pause'), logEl = h('ol.strategy-log');
  function drawLog() { logEl.replaceChildren(...(log.length ? log.slice(0, 8) : ['No move yet.']).map((t) => h('li', null, t))); }
  left.append(
    exhibitBrief(ctx.kit, { n: 3, title: 'Planning under uncertainty', sentences: ['The rover never knows where people are, only how likely each place is, so every stop, second look and hand-over is a bet.', 'The planner samples who might be there, imagines what the sensors would say, and grows a tree of what to do next.'], sources: ['pomcp', 'howard'], tags: ['live-algo', 'sim'], field: 'The sensor model and the weights on time and false alarms must match the real team’s. Both are design values here.', unknown: 'Whether the result holds in real buildings. The worlds are generated, with the same sensor model the planner uses.' }),
    h('section.strategy-sec', null, h('h3', null, 'This decision'), h('label.strategy-ctl', null, h('span', null, 'Imagined searches'), simOut, simInp), h('div.strategy-actions', null, playBtn, h('button.btn.btn-sm', { type: 'button', onclick: () => start(seed + 1) }, 'Next world')), logEl),
    h('section.strategy-sec', null, h('h3', null, 'The objective', h('span.strategy-assumed', null, 'assumed')), h('p', null, 'Each person found at time t earns exp(−t / 10 min). Each false alarm chased costs 0.25. Each minute until the team finishes costs 0.04.')));

  // ---------- the trial ----------
  let rows = { scripted: [], greedy: [], tree: [] }, pool = null, ran = false, tErr = '';
  const status = h('p', { 'aria-live': 'polite' }), tbl = h('tbody'), diff = h('tbody'), forest = h('canvas.strategy-chart.tall'), runBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => (pool ? stopTrial() : runTrial()) }, 'Run again');
  const point = h('p.strategy-point', null, 'Measuring.');
  right.append(
    h('section.strategy-sec', null, h('h3', null, 'Three policies, the same fresh worlds'), status, h('div.strategy-actions', null, runBtn)),
    h('section.strategy-sec', null, point, forest, h('p.strategy-fine', null, 'Objective per world. Bars are 95 % confidence intervals.')),
    h('section.strategy-sec', null, h('table.strategy-table.stacked', null, h('thead', null, h('tr', null, h('th', null, 'Policy'), h('th.num', null, 'People per min'), h('th.num', null, 'People found'), h('th.num', null, 'First find'), h('th.num', null, 'Checks with no one there'))), tbl), h('p.strategy-fine', null, 'People per min: mean over worlds of people found divided by the whole mission time, with the 95 % interval. First find: mean over the worlds where the policy found someone, so the three means cover different worlds. Policies that stop early score well per minute and find fewer people.')),
    h('section.strategy-sec', null, h('h3', null, 'Paired differences in the objective'), h('table.strategy-table', null, diff), h('p.strategy-fine', null, 'Seeds 50001 onward were never used for tuning. Before this run I tried 8 greedy thresholds, 5 rollout thresholds and 14 tree settings on other seeds, and added the time penalty after the first results. No tree setting beat greedy by more than the noise, and more imagined searches made the tree worse.')));
  const pm = (c, d) => (c.n > 1 ? c.mean.toFixed(d) + ' ± ' + c.half.toFixed(d) : '–'), two = (c, d, u = '') => (c.n > 1 ? [c.mean.toFixed(d) + u, h('small', null, '± ' + c.half.toFixed(d))] : ['–']);
  function stats(id) { const R = rows[id], ff = R.filter((r) => r.first != null); return { R, n: R.length, reward: ci(R.map((r) => r.reward)), perMin: ci(R.map((r) => r.perMin)), found: R.reduce((s, r) => s + r.found, 0), people: R.reduce((s, r) => s + r.people, 0), first: ci(ff.map((r) => r.first)), fc: ci(R.map((r) => r.falseChases)) }; }
  let drawn = 0;
  function drawTrial(force) {
    const now = performance.now(); if (!force && now - drawn < 220) return; drawn = now;
    const st = IDS.map(stats), n = Math.min(...st.map((s) => s.n));
    status.textContent = tErr || (pool ? n + ' of ' + N + ' worlds' : n ? n + ' worlds, seeds ' + FIRST + ' to ' + (FIRST + n - 1) + '.' : 'Not run yet.'); runBtn.textContent = pool ? 'Stop' : 'Run again';
    tbl.replaceChildren(...IDS.map((id, i) => h('tr', null, h('td', null, h('span.strategy-key', { style: { background: tok(POLICIES[id].color) } }), POLICIES[id].label), h('td.num', null, ...two(st[i].perMin, 3)), h('td.num', null, st[i].people ? fmtPct(st[i].found / st[i].people) : '–'), h('td.num', null, ...two(st[i].first, 0, ' s')), h('td.num', null, ...two(st[i].fc, 2)))));
    const sorted = {}; for (const id of IDS) sorted[id] = new Map(rows[id].map((r) => [r.seed, r.reward]));
    const pd = (a, b) => { const A = [], B = []; for (const [s, v] of sorted[a]) if (sorted[b].has(s)) { A.push(v); B.push(sorted[b].get(s)); } return paired(A, B); };
    const D = [['greedy', 'scripted'], ['tree', 'scripted'], ['tree', 'greedy']].map(([a, b]) => ({ a, b, d: pd(a, b) }));
    diff.replaceChildren(...D.map(({ a, b, d }) => h('tr', null, h('td', null, POLICIES[a].label + ' − ' + POLICIES[b].label.toLowerCase()), h('td.num', null, (d.mean >= 0 ? '+' : '') + pm(d, 3)), h('td', { class: d.lo > 0 ? 'up' : d.hi < 0 ? 'down' : 'flat' }, d.n < 2 ? '' : d.lo > 0 ? 'better' : d.hi < 0 ? 'worse' : 'no clear difference'))));
    const t = D[2].d; point.textContent = t.n < 30 ? 'Measuring.' : D[0].d.lo > 0 && D[1].d.lo > 0 ? (t.lo > 0 ? 'Both planners beat the fixed route, and the tree beats greedy' : t.hi < 0 ? 'Both planners beat the fixed route. The tree does not beat greedy' : 'Both planners beat the fixed route. The tree is not clearly different from greedy') : 'No clear winner over the fixed route in these worlds';
    if (fr) fr();
  }
  let fr = null;
  fitCanvas(forest, (c, W, H) => { fr = () => {
    c.clearRect(0, 0, W, H); const st = IDS.map(stats).map((s) => s.reward); const lo = Math.min(-0.05, ...st.map((s) => s.lo || 0)), hi = Math.max(0.22, ...st.map((s) => s.hi || 0)), x = (v) => 14 + ((v - lo) / (hi - lo)) * (W - 28);
    c.font = '400 11px ' + tok('--mono'); c.textAlign = 'center'; c.textBaseline = 'top';
    for (let v = Math.ceil(lo * 20) / 20; v <= hi + 1e-9; v += 0.05) { c.strokeStyle = Math.abs(v) < 1e-9 ? tok('--line-3') : tok('--line'); c.beginPath(); c.moveTo(x(v), 6); c.lineTo(x(v), H - 36); c.stroke(); c.fillStyle = tok('--text-3'); c.fillText(v.toFixed(2), x(v), H - 31); }
    c.fillStyle = tok('--text-2'); c.font = '500 11px ' + tok('--font'); c.textAlign = 'right'; c.fillText('objective per world, more is better', W - 14, H - 14);
    IDS.forEach((id, i) => { const s = st[i], y = 34 + i * ((H - 70) / 3); c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillStyle = tok('--text-2'); c.font = '500 11px ' + tok('--font'); c.fillText(POLICIES[id].label, 14, y - 10); if (!(s.n > 1)) return; c.fillStyle = rgba(POLICIES[id].color, 0.28); c.fillRect(x(s.lo), y - 5, x(s.hi) - x(s.lo), 10); c.fillStyle = tok(POLICIES[id].color); c.fillRect(x(s.mean) - 1.5, y - 9, 3, 18); });
  }; fr(); });
  function runTrial() { rows = { scripted: [], greedy: [], tree: [] }; tErr = ''; const seeds = Array.from({ length: N }, (_, i) => FIRST + i); const p = runPool({ jobs: [{ key: 'all', policies: IDS }], seeds, onRows: (k, rs) => { for (const r of rs) rows[r.policy].push(r); drawTrial(); }, size: 3, chunk: 20 }); pool = p; drawTrial(true); p.done.then(() => { if (pool === p) pool = null; drawTrial(true); }, (e) => { if (pool === p) pool = null; tErr = 'The trial stopped: ' + e.message; drawTrial(true); }); }
  function stopTrial() { pool?.cancel(); pool = null; drawTrial(true); }

  // ---------- drawing: plan above, tree below ----------
  let W = 0, H = 0, c = null, layoutKey = -1, rowsT = [];
  fitCanvas(cv, (c2, w, hh) => { c = c2; W = w; H = hh; layoutKey = -1; paint(1); });
  const short = (a) => (a.handoff ? 'Hand over' : world.stops[a.stop].id);
  function layoutTree(box) { // leaves get rows; the few most-visited observations of each action are drawn
    rowsT = []; let row = 0; const colW = box.w / 4.6, maxLevel = 4;
    const visit = (node, lvl, x) => { const acts = node.actions.filter((a) => a.N > 0).sort((a, b) => b.N - a.N).slice(0, lvl === 0 ? 7 : lvl === 1 ? 3 : 2); const ys = [];
      for (const a of acts) { const ch = a.handoff || lvl >= maxLevel - 1 ? [] : [...a.children.values()].sort((p, q) => q.N - p.N).slice(0, lvl === 0 ? 3 : 2).filter((n) => n.N > 1); let y; const item = { a, node, lvl, kids: [], x: x + colW * (lvl === 0 ? 1 : 0.5) };
        if (!ch.length) { y = row++; } else { const cy = ch.map((n) => { const r = visit(n, lvl + 1, x + colW * (lvl === 0 ? 1.5 : 1)); item.kids.push({ n, y: r, x: x + colW * (lvl === 0 ? 1.5 : 1) }); return r; }); y = cy.reduce((s, v) => s + v, 0) / cy.length; }
        item.y = y; ys.push(y); rowsT.push(item); (node._it = node._it || new Map()).set(a, item); }
      if (!ys.length) return row++; return ys.reduce((s, v) => s + v, 0) / ys.length; };
    const ry = visit(ts.root, 0, box.x); const k = box.h / Math.max(8, row); for (const it of rowsT) { it.y = box.y + (it.y + 0.5) * k; for (const kd of it.kids) kd.y = box.y + (kd.y + 0.5) * k; } rowsT.root = { x: box.x, y: box.y + (ry + 0.5) * k }; rowsT.gap = k;
  }
  function paint(dt) {
    if (!c || !ts || W < 50) return; c.clearRect(0, 0, W, H);
    const d = demo(), plan = d ? { x: 40, y: 76, w: W * 0.44, h: H * 0.40 } : { x: 18, y: 16, w: W - 36, h: H * 0.36 }, box = d ? { x: W * 0.5, y: 90, w: W * 0.46, h: H - 190 } : { x: 34, y: plan.y + plan.h + 34, w: W - 60, h: H - plan.y - plan.h - 90 };
    // the floor plan: belief as warmth, stops, rover, simulated people
    const k = Math.min(plan.w / (world.w + 2), plan.h / world.h), ox = plan.x - 2 * k, oy = plan.y + plan.h, px = (x) => ox + x * k, py = (y) => oy - y * k;
    let top = 0.02; for (let z = 0; z < world.zones.length; z++) top = Math.max(top, ep.B.pm[z] + ep.B.ps[z]);
    c.fillStyle = tok('--bg-2'); for (const r of world.rooms) c.fillRect(px(r.rect[0]), py(r.rect[3]), (r.rect[2] - r.rect[0]) * k, (r.rect[3] - r.rect[1]) * k);
    for (let z = 0; z < world.zones.length; z++) { const p = ep.B.pm[z] + ep.B.ps[z], q = world.zones[z].rect, a = Math.pow(p / Math.max(0.06, top), 0.6); c.fillStyle = rgba('--person', clamp(a * 0.85, 0, 0.9)); c.fillRect(px(q[0]) + 0.5, py(q[3]) + 0.5, (q[2] - q[0]) * k - 1, (q[3] - q[1]) * k - 1); }
    c.strokeStyle = tok('--text-2'); c.lineWidth = 1.6; c.beginPath(); for (const w of world.walls) { c.moveTo(px(w.a[0]), py(w.a[1])); c.lineTo(px(w.b[0]), py(w.b[1])); } c.stroke();
    if (world.rubble) { c.fillStyle = tok('--bg-5'); const r = world.rubble; c.fillRect(px(r.x0), py(world.yc1), 2 * k, (world.yc1 - world.yc0) * k); }
    c.font = '500 11px ' + tok('--mono'); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = tok('--text-3'); world.rooms.forEach((r, i) => { if (!r.corridor) { c.fillText(r.id, px(r.rect[0]) + 5, py(r.rect[3]) + 5); if (k > 11) c.fillText(fmtPct(ep.roomP[i]), px(r.rect[0]) + 5, py(r.rect[3]) + 19); } });
    let prev = world.start; c.strokeStyle = rgba('--text', 0.75); c.lineWidth = 1.4; c.beginPath(); c.moveTo(px(prev[0]), py(prev[1])); for (const l of ep.looks) { const p = world.stops[l.stop].pos; c.lineTo(px(p[0]), py(p[1])); } c.stroke();
    const here = ep.at >= 0 ? world.stops[ep.at].pos : world.start;
    for (const a of ts.root.actions) if (!a.handoff) { const p = world.stops[a.stop].pos, on = a === chosen, r = 3 + 9 * Math.sqrt(a.N / Math.max(1, ts.sims) * 4); c.strokeStyle = on ? tok('--text') : rgba('--accent', 0.9); c.lineWidth = on ? 2 : 1; c.beginPath(); c.arc(px(p[0]), py(p[1]), on ? 9 : Math.min(8, r * 0.6), 0, 7); c.stroke(); if (!d || on) { c.fillStyle = tok('--text'); c.fillText(short(a), px(p[0]) + 10, py(p[1]) - 5); } }
    for (const p of truth.people) { c.setLineDash([2, 2]); c.strokeStyle = tok('--sim'); c.lineWidth = 1.2; c.beginPath(); c.arc(px(p.pos[0]), py(p.pos[1]), 6, 0, 7); c.stroke(); c.setLineDash([]); }
    c.fillStyle = tok('--text'); c.save(); c.translate(px(here[0]), py(here[1])); c.rotate(Math.PI / 4); c.fillRect(-4.5, -4.5, 9, 9); c.restore();
    c.font = '400 11px ' + tok('--font'); c.fillStyle = tok('--text-3'); c.textBaseline = 'top'; c.fillText('Dashed ring: a simulated person the planner cannot see', plan.x + 10, oy + (d ? 4 : 2) - 4 * k * 0);
    // the tree
    if (layoutKey !== ts.nodes + '|' + ts.sims) { layoutKey = ts.nodes + '|' + ts.sims; layoutTree(box); }
    const ease = 1 - Math.exp(-dt * 9), R = rowsT.root, q0 = Math.min(...rowsT.map((i) => i.a.Q), 0), q1 = Math.max(...rowsT.map((i) => i.a.Q), 0.1), tone = (q) => clamp((q - q0) / (q1 - q0 || 1), 0, 1);
    const pos = (o, x, y) => { if (o._x == null) { o._x = x - 14; o._y = y; } o._x += (x - o._x) * ease; o._y += (y - o._y) * ease; };
    for (const it of rowsT) { pos(it.a, it.x, it.y); for (const kd of it.kids) pos(kd.n, kd.x, kd.y); } pos(ts.root, R.x, R.y);
    const link = (x0, y0, x1, y1, w, col) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(x0, y0); const m = (x0 + x1) / 2; c.bezierCurveTo(m, y0, m, y1, x1, y1); c.stroke(); };
    for (const it of rowsT) { const n = it.node, f = Math.sqrt(it.a.N / Math.max(1, ts.sims)), on = chosen && it.a === chosen, t = tone(it.a.Q); link(n._x, n._y, it.a._x, it.a._y, 0.6 + 9 * f, on ? tok('--text') : it.a.handoff ? rgba('--text-3', 0.35 + 0.5 * t) : rgba(t > 0.75 ? '--person' : '--accent', 0.16 + 0.6 * t)); for (const kd of it.kids) link(it.a._x, it.a._y, kd.n._x, kd.n._y, 0.5 + 6 * Math.sqrt(kd.n.N / Math.max(1, ts.sims)), rgba('--text-3', 0.45)); }
    for (const it of rowsT) { const on = it.a === chosen, r = 2 + 7 * Math.sqrt(it.a.N / Math.max(1, ts.sims)); c.fillStyle = on ? tok('--text') : it.a.handoff ? tok('--text-3') : tone(it.a.Q) > 0.75 ? tok('--person') : tok('--accent'); if (it.a.handoff) c.fillRect(it.a._x - 3, it.a._y - 3, 6, 6); else { c.beginPath(); c.arc(it.a._x, it.a._y, r, 0, 7); c.fill(); } for (const kd of it.kids) { c.fillStyle = tok('--text-2'); c.fillRect(kd.n._x - 1.5, kd.n._y - 1.5, 3, 3); } }
    c.textBaseline = 'middle';
    for (const it of rowsT) if (it.lvl === 0) { const on = it.a === chosen; c.font = (on ? '600' : '500') + ' 12px ' + tok('--font'); c.fillStyle = on ? tok('--text') : tok('--text-2'); c.textAlign = 'right'; const lab = short(it.a) + '  ' + it.a.Q.toFixed(2), lw = c.measureText(lab).width; c.save(); c.fillStyle = rgba('--bg-0', 0.75); c.fillRect(it.a._x - 14 - lw - 3, it.a._y - 20, lw + 6, 16); c.restore(); c.fillText(lab, it.a._x - 14, it.a._y - 12); }
    c.fillStyle = tok('--text'); c.beginPath(); c.arc(R.x, R.y, 5, 0, 7); c.fill();
    c.font = '400 11px ' + tok('--font'); c.fillStyle = tok('--text-3'); c.textAlign = 'left'; c.textBaseline = 'top';
    const ty = box.y + box.h + 12; c.fillText('now', R.x - 8, ty); const cw = box.w / 4.6; ['first move', 'heard', 'second', 'heard', 'third', 'heard', 'fourth'].forEach((s, i) => { if (!d || i < 3) c.fillText(s, box.x + cw * (1 + i * 0.5) - 20, ty); });
    c.textAlign = 'right'; c.font = '500 11px ' + tok('--mono'); c.fillStyle = tok('--text-2'); c.fillText(ts.sims + ' imagined searches, ' + ts.nodes + ' nodes', box.x + box.w, d ? ty + 0 : box.y - 22);
  }
  const loop = makeLoop((dt) => { if (playing) stepTime(dt); paint(dt); });
  start(seed); drawLog();
  const offMode = ctx.bus.on('mode', () => { layoutKey = -1; });
  return {
    show() { visible = true; if (reducedMotion()) { ts.run(sims); act(); paint(1); } else loop.start(); if (!ran) { ran = true; setTimeout(() => { if (visible) runTrial(); else ran = false; }, 600); } },
    hide() { visible = false; loop.stop(); if (pool) { stopTrial(); ran = false; } }, restyle() { paint(1); drawTrial(true); }, _off: offMode,
  };
}
