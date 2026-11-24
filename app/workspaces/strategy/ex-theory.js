// Exhibits 1 and 2, and the demo hero. One probability landscape (map3d.js), three things to see on it:
//   the race    one hidden person, the map against the fixed route (hero.js, race.js)
//   theory      this mission's own map: prior, every look so far, what is left (mission-map.js)
//   next        the value of one more 10 s window at every reachable square metre
import { createMap3D } from './map3d.js';
import { createMissionMap } from './mission-map.js';
import { createHero } from './hero.js';
import { exhibitBrief, createChart, demoOverlay, fmtPct, fmtClock, clamp, tok } from './common.js';

export default async function (pane, ctx) {
  const { h, icon, reducedMotion } = ctx.kit, world = ctx.world;
  const M = createMissionMap(ctx);
  let ex = 'theory', visible = false, view = 'mission', truthOn = false, lookK = null, probe = null, mode = 'rate', lambda = 0.5;
  const weights = { place: 0.5, shelter: 0.3, exit: 0.2, outdoors: 0.2 };
  const demo = () => ctx.mode === 'demo';
  const racing = () => ex === 'theory' && (demo() || view === 'race');

  // ---------- layout ----------
  const mapHost = h('div.strategy-map');
  const left = { theory: h('div.strategy-col.left.adv-only'), next: h('div.strategy-col.left.adv-only') }, right = { theory: h('div.strategy-col.right.adv-only'), next: h('div.strategy-col.right.adv-only') };
  const hudTR = h('div.strategy-hud.tr.adv-only'), hudBL = h('div.strategy-hud.bl.adv-only');
  const main = h('div.strategy-main', null, mapHost, hudTR, hudBL);
  const root = h('div.strategy-ex', null, left.theory, left.next, main, right.theory, right.next); pane.append(root);
  const map = createMap3D(mapHost, ctx);

  // ---------- demo overlays ----------
  const clock = (cls, name) => { const b = h('b.num', null, '00:00'), s = h('span', null, name), i = h('i'); return { el: h('div.strategy-clock.' + cls, null, s, b, h('em', null, i)), b, s, i, name, last: '', lastBar: -1, st: '' }; };
  const cMap = clock('map', 'Map'), cFix = clock('fix', 'Fixed route');
  const raceOverlay = demoOverlay(ctx.kit, { title: 'Where to look next', sentence: 'Every empty look lowers the map where the rover listened and raises it everywhere else.', tags: ['sim'], action: { label: 'New search', icon: 'reset', run: () => hero.next() } });
  const clocks = h('div.strategy-clocks', null, cMap.el, cFix.el); raceOverlay.el.classList.add('strategy-race'); raceOverlay.el.append(clocks);
  const nextOverlay = demoOverlay(ctx.kit, { title: 'The worth of ten seconds', sentence: 'Height is what one more listening stop would teach the map, for each second it costs.', tags: ['live-algo'] });
  main.append(raceOverlay.el, nextOverlay.el);
  const setClock = (c, t, p, done) => { const s = fmtClock(t); if (s !== c.last) { c.b.textContent = s; c.last = s; } const w = Math.round(p * 1000) / 1000; if (w !== c.lastBar) { c.i.style.transform = 'scaleX(' + w + ')'; c.lastBar = w; } const st = done === true ? 'found' : done === false ? 'missed' : ''; if (st !== c.st) { c.st = st; c.el.dataset.state = st; c.s.textContent = c.name + (st === 'found' ? ', found' : st === 'missed' ? ', time up' : ''); } };
  let raceFacts = null;
  const hero = createHero(map, M, ctx, {
    caption: (t) => raceOverlay.caption(t), state: (s) => { raceOverlay.el.dataset.state = s; if (s === 'load') raceOverlay.caption('Working out both searches.'); },
    clocks: (a, b, pa, pb, da, db) => { setClock(cMap, a, pa, da); setClock(cFix, b, pb, db); },
    tally: (t) => { tallyEl.textContent = 'Runs watched: ' + t.n + '. Map first ' + t.map + ', fixed route first ' + t.fixed + ', neither ' + t.neither + '.'; },
    exact: (a, b, race) => { if (raceFacts) return; raceFacts = { a, b }; raceChart.set({ padR: 12, x: { min: 0, max: race.cap / 60, label: 'minutes of search', fmt: (v) => String(v) }, y: { min: 0, max: 1, label: 'chance of having found the person', fmt: (v) => fmtPct(v) }, series: [{ pts: [[0, 0], ...race.map.filter((L) => L.t2 <= race.cap).map((L) => [L.t2 / 60, L.success])], color: '--person', step: true, width: 2, label: 'Map' }, { pts: [[0, 0], ...race.fixed.filter((L) => L.t2 <= race.cap).map((L) => [L.t2 / 60, L.success])], color: '--text-2', step: true, label: 'Fixed route' }] });
      raceRead.replaceChildren(...[[fmtClock(a), 'Map, mean search'], [fmtClock(b), 'Fixed route, mean']].map(([v, k]) => h('div', null, h('b', null, v), h('span', null, k)))); },
  });
  map.onFrame = (dt, time) => { if (racing()) hero.frame(dt, time); else if (ex === 'next') { slice(); if (demo()) map.shot(-0.5 + Math.sin(time * 0.06) * 0.3, 0.5 + Math.sin(time * 0.043) * 0.06, 80, 64, 46); } };

  const posPoint = h('p.strategy-point', null, 'No look yet');
  // ---------- exhibit 1, left: brief, prior ----------
  const slider = (key, label, note, max) => { const out = h('output'), inp = h('input.slider', { type: 'range', min: 0, max, step: 0.05, value: weights[key], 'aria-label': label, oninput: () => { weights[key] = +inp.value; show(); rebuildPrior(); } }); const show = () => { out.textContent = (+inp.value).toFixed(2); }; show(); return { el: h('label.strategy-ctl', null, h('span', null, label), out, inp, h('small', null, note)), inp, show }; };
  const sl = { place: slider('place', 'Where they were', 'Anywhere in the classroom', 1), shelter: slider('shelter', 'Where they would shelter', 'Along the walls', 1), exit: slider('exit', 'Where they would try to leave', 'Near doors and in the corridor', 1), outdoors: slider('outdoors', 'People outside', 'Expected number, mostly in the debris field', 1) };
  let priorSec;
  left.theory.append(
    exhibitBrief(ctx.kit, { n: 1, title: 'Search theory', sentences: ['The map holds, for every half metre, the chance that a person is there.', 'Each look that finds nothing lowers that chance by how well the sensors could have seen, so the map always shows where the search is still worth making.'], sources: ['koopman', 'scorpion', 'af447', 'sarops', 'bourgault'], tags: ['live-algo', 'sim'], field: 'The detection rates must be measured on real rooms. The Wi-Fi rates here were measured on simulated windows, the radar and thermal rates are design values.', unknown: 'How far repeated looks from one spot are independent. The map treats them as independent.' }),
    priorSec = h('section.strategy-sec', null, h('h3', null, 'Prior: three stories about where people are', h('span.strategy-assumed', null, 'assumed')), ...Object.values(sl).map((s) => s.el),
      h('div.strategy-actions', null, h('button.btn.btn-sm', { type: 'button', onclick: () => { Object.assign(weights, { place: 0.5, shelter: 0.3, exit: 0.2, outdoors: 0.2 }); for (const k in sl) { sl[k].inp.value = weights[k]; sl[k].show(); } rebuildPrior(); } }, 'Reset prior'))));
  // ---------- exhibit 1, right: this mission ----------
  const lookOut = h('output'), lookInp = h('input.slider', { type: 'range', min: 0, max: 0, step: 1, value: 0, 'aria-label': 'Looks applied to the map', oninput: () => { lookK = +lookInp.value >= looks.length ? null : +lookInp.value; refresh(); } });
  const lookText = h('p', { 'aria-live': 'polite' }), posCv = h('canvas.strategy-chart'), read = h('div.strategy-readouts'), roomBody = h('tbody');
  const raceCv = h('canvas.strategy-chart.tall'), raceRead = h('div.strategy-readouts.two'), tallyEl = h('p.strategy-fine', null, 'No runs watched yet.');
  const posChart = createChart(posCv, ctx.kit), raceChart = createChart(raceCv, ctx.kit);
  const secMission = h('div', null,
    h('section.strategy-sec', null, h('h3', null, 'The map after each look'), h('label.strategy-ctl', null, h('span', null, 'Looks applied'), lookOut, lookInp), lookText, read),
    h('section.strategy-sec', null, posPoint, posCv, h('p.strategy-fine', null, 'Chance that a person inside block B would have made at least one sensor fire by now. Computed from the looks the rover has taken.')),
    h('section.strategy-sec', null, h('h3', null, 'Chance someone is in the room'), h('table.strategy-table', null, h('thead', null, h('tr', null, h('th', null, 'Room'), h('th.num', null, 'Prior'), h('th.num', null, 'Now'))), roomBody), h('p.strategy-fine', null, 'A room no look has reached keeps its prior. Leads from the console are drawn on the map and are not in this table.')));
  const secRace = h('div', { hidden: true },
    h('section.strategy-sec', null, h('h3', null, 'One hidden person, two searches'), h('p', null, 'Both searchers have the same sensors, speed, start and 20 minute limit. The fixed route repeats the mission’s four stops. The map takes the look with the most chance of detection per second.'), raceRead, tallyEl),
    h('section.strategy-sec', null, h('p.strategy-point', null, 'The map finds more, sooner'), raceCv, h('p.strategy-fine', null, 'Computed exactly, not sampled: until something is heard both searchers’ moves are known in advance. A search that runs the full time counts as 20 minutes in the mean. The fixed route never leaves block B, and 20 of 100 people are placed outside it.')),
    h('section.strategy-sec', null, h('h3', null, 'What this race leaves out'), h('p', null, 'Look-alikes, hand-over to the team, and several people at once: exhibit 3 has all three. The 20 minute limit and the prior are design values.'), h('div.strategy-actions', null, h('button.btn.btn-sm', { type: 'button', onclick: () => hero.next() }, icon('reset', 14), 'New search'))));
  right.theory.append(secMission, secRace);

  // ---------- exhibit 2 ----------
  const lamOut = h('output'), lamInp = h('input.slider', { type: 'range', min: 0, max: 2, step: 0.05, value: lambda, 'aria-label': 'Cost of a minute, in bits', oninput: () => { lambda = +lamInp.value; lamShow(); rescore(); } }), lamShow = () => { lamOut.textContent = lambda.toFixed(2) + ' bits'; }; lamShow();
  const modeBtns = [['rate', 'Bits per minute'], ['net', 'Bits minus time']].map(([m, t]) => h('button.btn.btn-sm', { type: 'button', 'aria-pressed': String(m === mode), onclick: () => { mode = m; modeBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['rate', 'net'][i] === m))); lamInp.disabled = m !== 'net'; rescore(); } }, t)); lamInp.disabled = true;
  left.next.append(
    exhibitBrief(ctx.kit, { n: 2, title: 'Where to listen next', sentences: ['For every square metre the rover can reach, the page works out how many bits of uncertainty one more 10 second window would remove.', 'It then charges for the drive, so a good stop nearby can beat a better one far away.'], sources: ['howard', 'bourgault', 'koopman'], tags: ['live-algo', 'sim'], field: 'The map must be honest about walls and about what each sensor misses. A wrong prior sends the rover to the wrong rooms.', unknown: 'Whether one step ahead is enough. Exhibit 3 tests a planner that looks several steps ahead.' }),
    h('section.strategy-sec', null, h('h3', null, 'How a stop is scored'), h('div.btn-group', { role: 'group', 'aria-label': 'Score' }, ...modeBtns), h('label.strategy-ctl', null, h('span', null, 'Cost of a minute'), lamOut, lamInp, h('small', null, 'Used by “bits minus time”. Assumed.')), h('p', null, 'Select the floor to test a stop. Hatching shows what its sensors could detect.'), h('div.strategy-actions', null, h('button.btn.btn-sm', { type: 'button', onclick: () => { probe = null; map.setPod(null); drawNext(); } }, 'Clear test stop'))));
  const rankEl = h('div.strategy-rank'), fixedEl = h('div.strategy-rank'), cmpEl = h('div.strategy-readouts.two'), probeEl = h('p', null, 'No test stop.'), cmpText = h('p');
  right.next.append(
    h('section.strategy-sec', null, h('h3', null, 'Best next stops from here'), rankEl, h('p.strategy-fine', null, 'At least 4 m apart.')),
    h('section.strategy-sec', null, h('h3', null, 'The mission’s fixed stops, scored the same way'), fixedEl),
    h('section.strategy-sec', null, h('h3', null, 'Plan ahead from the entrance, every look quiet'), cmpEl, cmpText),
    h('section.strategy-sec', null, h('h3', null, 'Test stop'), probeEl));

  // ---------- map HUD ----------
  const viewBtns = [['building', 'Block B'], ['site', 'Site'], ['top', 'Top']].map(([v, t]) => h('button.btn.btn-sm', { type: 'button', onclick: () => map.setView(v) }, t));
  const segBtns = [['mission', 'This mission'], ['race', 'The race']].map(([v, t]) => h('button.btn.btn-sm', { type: 'button', 'aria-pressed': String(v === view), onclick: () => { view = v; segBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['mission', 'race'][i] === v))); apply(); } }, t));
  const truthBtn = h('button.btn.btn-sm', { type: 'button', 'aria-pressed': 'false', title: 'Debug view. The planner never reads this.', onclick: async () => { truthOn = !truthOn; truthBtn.setAttribute('aria-pressed', String(truthOn)); await refresh(); } }, 'Reveal ground truth');
  const seg = h('div.btn-group', { role: 'group', 'aria-label': 'Show' }, ...segBtns);
  hudTR.append(seg, h('div.btn-group', { role: 'group', 'aria-label': 'Camera' }, ...viewBtns), truthBtn);
  const legend = h('div.glass.strategy-legend'); hudBL.append(legend);
  const ramp = (a) => 'linear-gradient(90deg,' + a.join(',') + ')';
  function drawLegend() {
    if (ex === 'next') legend.replaceChildren(h('span', null, mode === 'rate' ? 'Bits per minute of drive and listening' : 'Bits minus the cost of time'), h('div.ramp', { style: { background: ramp(['#1d2a3a', tok('--accent')]) } }), h('div.scale', null, h('span', null, '0'), h('span', null, fieldMax ? fieldMax.toFixed(2) : '')));
    else if (racing()) legend.replaceChildren(h('span', null, 'Height and warmth: chance per square metre'), h('div.ramp', { style: { background: ramp(['#2a3038', '#4a3a3a', tok('--person'), '#ffd9a8']) } }), h('div.scale', null, h('span', null, 'bold contour: starting density of a room')));
    else legend.replaceChildren(h('span', null, 'Chance of a person, per quarter square metre'), h('div.ramp', { style: { background: ramp(['#2a3038', '#4a3a3a', tok('--person'), '#ffd9a8']) } }), h('div.scale', null, h('span', null, '0.0025 %'), h('span', null, '25 %')), h('span', null, 'Each bold contour is ten times the chance'));
  }

  // ---------- the mission map ----------
  let prior = M.buildPrior(weights), priorRoom = M.compose(prior, []).roomP, looks = [], seen = new Map(), cur = null, sig = '';
  const hgt = new Float32Array(map.N), heat = new Float32Array(map.N);
  function state() { return ctx.sim.state; }
  function rebuildPrior() { prior = M.buildPrior(weights); priorRoom = M.compose(prior, []).roomP; sig = ''; refresh(); }
  function readLooks() {
    const St = state(), L = M.looksFromState(St, seen); for (const x of L) if (!seen.has(x.id) && x.pos) seen.set(x.id, x.pos.slice());
    looks = L; lookInp.max = L.length; if (lookK != null && lookK > L.length) lookK = null; lookInp.value = lookK ?? L.length;
  }
  async function refresh() {
    if (!visible) return; readLooks();
    const St = state(), k = lookK ?? looks.length, t = lookK == null ? St.t : k > 0 ? looks[k - 1].t : 0, leads = M.leadsAt(St, t);
    const rep = M.replay(prior, looks, k), comp = M.compose(rep.B, leads); cur = { B: rep.B, leads, comp, k };
    if (ex === 'next') { rescore(); return; }
    lookOut.textContent = k + ' of ' + looks.length;
    lookText.textContent = !looks.length ? 'The rover has not listened yet. Run the mission, or watch the race.' : k === 0 ? 'Before any look: the prior.' : looks[k - 1].label + ', ' + fmtClock(looks[k - 1].t) + ': ' + looks[k - 1].says + '.';
    const full = M.replay(prior, looks, looks.length).pos;
    posPoint.textContent = looks.length ? looks.length + (looks.length === 1 ? ' look' : ' looks') + ' would have revealed a person inside ' + fmtPct(full[full.length - 1]) + ' of the time' : 'No look yet';
    posChart.set({ x: { min: 0, max: Math.max(4, looks.length), label: 'looks taken', ticks: looks.length > 10 ? undefined : Array.from({ length: Math.max(4, looks.length) + 1 }, (_, i) => i) }, y: { min: 0, max: 1, label: 'chance of success', fmt: (v) => fmtPct(v) }, series: [{ pts: looks.length ? full.map((p, i) => [i, p]) : [], color: '--person', step: true, width: 2, dots: 2.5 }], marks: looks.length ? [{ x: k, color: '--text-3' }] : [], empty: 'No looks yet' });
    read.replaceChildren(...[[fmtPct(rep.pos[rep.pos.length - 1]), 'chance of success'], [comp.expected.toFixed(2), 'people still expected'], [Math.round(M.entropy(rep.B)) + '', 'bits unknown']].map(([v, s]) => h('div', null, h('b', null, v), h('span', null, s))));
    roomBody.replaceChildren(...M.rooms.map((r, i) => h('tr', null, h('td', null, r.name), h('td.num', null, fmtPct(priorRoom[i], 1)), h('td.num', null, fmtPct(comp.roomP[i], 1)))));
    if (racing()) return;
    const v = comp.v; for (let c = 0; c < map.N; c++) { hgt[c] = 5 * v[c]; heat[c] = clamp(v[c] * 1.15, 0, 1); }
    const last = k > 0 ? looks[k - 1] : null, key = k + '|' + leads.map((l) => l.id + l.p.toFixed(2)).join();
    map.setCut(0.06); map.setContours(0.3125); map.setMode('belief'); map.setField(hgt, heat, { from: last && key !== sig ? last.pos : null }); sig = key;
    const truth = truthOn ? (await import('../../core/world.js')).TRUTH.people.map((p) => ({ pos: p.pos, html: 'Ground truth (debug)' })) : [];
    map.setMarkers({ rooms: M.rooms.filter((r) => !r.corridor).map((r) => ({ pos: [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2], html: r.id + '<b>' + fmtPct(comp.roomP[M.rooms.indexOf(r)], 1) + '</b>' })), looks: looks.slice(0, k).map((l) => ({ pos: l.pos })), trail: state().units['HOUND-01'].trail, leads: leads.filter((l) => l.local).map((l) => ({ pos: l.pos, h: 3, sigma: l.sigma, person: l.person, html: (l.person ? 'Confirmed ' : 'Possible ') + fmtPct(l.p) })), truth });
    map.stage.rover(0, state().units['HOUND-01'].pos, state().units['HOUND-01'].heading); drawLegend(); if (!map.loop.running) map.renderOnce();
  }

  // ---------- where to listen next ----------
  let scored = null, fieldMax = 0, tracing = true, planned = false, C = null;
  function slice() { if (!tracing) return; if (M.traceSome(7)) { tracing = false; rescore(); } else { const p = fmtPct(M.traceProgress()); nextOverlay.caption('Tracing walls for every stop, ' + p + '.'); } }
  const spaced = (list, n, d) => { const out = []; for (const s of list) { if (out.every((o) => Math.hypot(o.pos[0] - s.pos[0], o.pos[1] - s.pos[1]) >= d)) out.push(s); if (out.length === n) break; } return out; };
  const where = (p) => { const r = world.roomAt(p); return r ? r.name : p[0] > 88 && p[1] > 60 ? 'Debris field' : 'Outside block B'; };
  function rescore() {
    if (ex !== 'next' || !cur || tracing) { M.candidates(); return; }
    C = M.coarseBelief(cur.B, cur.leads); const from = state().units['HOUND-01'].pos, r = M.scoreAll(C, from, mode, lambda); scored = r; r.list.sort((a, b) => b.score - a.score);
    const lo = mode === 'net' ? Math.min(0, r.list[r.list.length - 1]?.score ?? 0) : 0; fieldMax = r.list[0]?.score ?? 0;
    hgt.fill(0); heat.fill(0);
    for (const s of r.list) { const x = clamp((s.score - Math.max(lo, -0.2)) / ((fieldMax - Math.max(lo, -0.2)) || 1), 0, 1), ci = s.cell % M.CW, cj = Math.floor(s.cell / M.CW); for (let j = 0; j < s.size * 2; j++) for (let i = 0; i < s.size * 2; i++) { const c = (cj * 2 + j) * map.GW + ci * 2 + i; hgt[c] = 0.12 + 4.2 * x * x; heat[c] = x; } }
    map.setMode('gain'); map.setCut(0.06); map.setContours(0.42); map.setField(hgt, heat); drawNext();
    if (!planned) { planned = true; setTimeout(comparePlans, 60); }
  }
  function drawNext() {
    if (!scored || ex !== 'next') return;
    const best = spaced(scored.list, 5, 4), from = state().units['HOUND-01'].pos, St = world.STOPS.map((s) => ({ s, r: M.scoreAt(C, s.pos, scored.field, mode, lambda) })), top = best[0];
    const pathTo = top ? ctx.sim.plan(from, top.pos, { nearest: true }) : null, unit = mode === 'rate' ? ' bits/min' : ' bits net';
    const row = (k, name, s, cls) => h('button' + (cls || ''), { type: 'button', onclick: () => setProbe(s.pos), 'aria-label': name + ', test this stop' }, h('span.k', null, k), h('span.where', null, name), h('span.val', null, s.score === -Infinity ? 'no route' : s.score.toFixed(2) + unit), h('span.sub', null, s.gain.toFixed(2) + ' bits, ' + (s.secs < Infinity ? Math.round(s.secs) + ' s' : 'no route')), h('span.bar', null, h('i', { style: { width: clamp((s.score / fieldMax) * 100, 0, 100) + '%' } })));
    rankEl.replaceChildren(...best.map((s, i) => row(String(i + 1), where(s.pos), s))); fixedEl.replaceChildren(...St.map(({ s, r }) => row(s.id, s.label, r, '.fixed')));
    const pr = probe ? M.scoreAt(C, probe, scored.field, mode, lambda) : null;
    probeEl.textContent = !pr ? 'No test stop.' : where(probe) + ': ' + pr.gain.toFixed(2) + ' bits, ' + pr.finds.toFixed(3) + ' people expected to be heard, ' + (pr.secs < Infinity ? Math.round(pr.secs) + ' s away including the window.' : 'the rover cannot reach it.');
    map.setMarkers({ stops: St.map(({ s }) => ({ pos: s.pos, html: s.id })), best: best.slice(0, demo() ? 3 : 5).map((s, i) => ({ pos: s.pos, h: 4.6 * (s.score / fieldMax) ** 2 + 1.6, first: i === 0, html: (demo() ? where(s.pos) : String(i + 1)) + '<b>' + s.score.toFixed(2) + '</b>' })), path: pathTo && pathTo.ok ? pathTo.path : null, trail: demo() ? null : state().units['HOUND-01'].trail, probe: probe ? { pos: probe, range: M.S.maxRange, html: 'Test stop' } : null });
    map.stage.rover(0, from, state().units['HOUND-01'].heading);
    if (top) nextOverlay.caption('Best next stop: ' + where(top.pos) + ', ' + top.gain.toFixed(2) + ' bits for ' + Math.round(top.secs) + ' seconds.');
    drawLegend(); if (!map.loop.running) map.renderOnce();
  }
  function setProbe(p) { if (ex !== 'next' || M.cellAt(p) < 0) return; probe = p; map.setPod(M.podField(p, true)); drawNext(); }
  function comparePlans() {
    const start = world.SITE.entrance, fixed = M.planAhead(prior, start, { stops: world.STOPS.map((s) => s.pos) }), T = fixed.length ? fixed[fixed.length - 1].t : 0, free = M.planAhead(prior, start, { seconds: T, mode: 'rate' }), a = free[free.length - 1], b = fixed[fixed.length - 1];
    if (!a || !b) { cmpText.textContent = 'No comparison: a route is blocked.'; return; }
    cmpEl.replaceChildren(h('div', null, h('b', null, fmtPct(b.success)), h('span', null, 'four fixed stops, ' + fmtClock(b.t))), h('div', null, h('b', null, fmtPct(a.success)), h('span', null, free.length + ' stops chosen by bits per minute, ' + fmtClock(a.t))));
    cmpText.textContent = 'Chance that one person inside block B has made a sensor fire, in the same time. Computed on the prior with all sensors working.';
  }
  map.onPick((p) => setProbe(p));

  // ---------- modes ----------
  function apply() {
    const d = demo();
    for (const k of ['theory', 'next']) { left[k].hidden = ex !== k; right[k].hidden = ex !== k; }
    priorSec.hidden = racing(); secMission.hidden = racing(); secRace.hidden = !racing(); seg.hidden = ex !== 'theory'; truthBtn.hidden = ex !== 'theory' || racing();
    raceOverlay.el.hidden = !racing(); nextOverlay.el.hidden = ex !== 'next'; main.classList.toggle('is-racing', racing());
    map.setFramePad(d ? 0.055 : 0); map.setDim(1); map.setPod(null); probe = null;
    if (!visible) return;
    if (racing()) { map.setMarkers({}); hero.start(); }
    else { hero.stop(); map.stage.clear(); sig = ''; map.setView('building', false); refresh(); }
    drawLegend();
    if (!reducedMotion()) { map.start(); return; }
    map.stop();                                     // reduced motion: no loop, every change draws one still frame
    if (ex === 'next' && tracing) { M.candidates(); while (!M.traceSome(60)); tracing = false; rescore(); }
    map.renderOnce();
  }
  const onState = () => { if (!visible || racing()) return; const key = state().detections.length + '|' + Object.values(state().coverage).map((c) => c.t).join(); if (key !== lastKey) { lastKey = key; planned = planned && true; refresh(); } else if (ex === 'theory') map.stage.rover(0, state().units['HOUND-01'].pos, state().units['HOUND-01'].heading); };
  let lastKey = '';
  const offs = [ctx.bus.on('tick', onState), ctx.bus.on('reset', () => { seen = new Map(); lookK = null; lastKey = ''; onState(); }), ctx.bus.on('seek', () => { lastKey = ''; onState(); }), ctx.bus.on('mode', () => apply())];
  map.setView('building', true);
  return {
    setExhibit(id) { ex = id === 'next' ? 'next' : 'theory'; if (visible) apply(); },
    show() { visible = true; apply(); }, hide() { visible = false; hero.stop(); map.stop(); },
    restyle() { map.restyle(); posChart.redraw(); raceChart.redraw(); drawLegend(); },
    _off: offs, _map: map, _hero: hero,
  };
}
