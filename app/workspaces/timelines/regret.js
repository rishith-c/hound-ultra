// Timelines: regret, and the proof that the replays are exact.
// Regret compares what was actually done with the best branch found, scored against ground truth. Ground truth is
// what the simulator knows and a real team never would, so this pane stays locked until the switch is on.
import * as M from './model.js';
const { clock, span, plural } = M;

export function mountRegret(pane, app) {
  const { h, kit } = app, { icon } = kit;
  const el = h('div.tl-rg'); pane.append(el);
  const OUT = { sensors: ['found by sensors alone', 'c-person'], team: ['left for the team to check', 'c-warn'], missed: ['never on the route', 'c-danger'] };
  function candidates() {
    const out = app.branches.filter((b) => b.run).map((b) => ({ name: b.name, label: b.label, run: b.run, id: b.id }));
    if (app.sweep && app.sweep.branch === 'trunk') for (const f of app.sweep.fams) for (const o of f.opts) if (o.run && !out.some((c) => c.run.hash === o.run.hash)) out.push({ name: 'Sweep', label: o.res.label, run: o.run, probe: o });
    return out;
  }
  function paint() {
    if (pane.hidden) return;
    const t = app.trunk;
    if (!app.truth) {
      el.replaceChildren(h('div.tl-rg-lock', null, icon('lock', 28), h('h2', null, 'Regret needs the answer sheet'),
        h('p', null, 'Regret is the gap between what was done and the best that could have been done. Measuring it takes ground truth: who was really in the building, and where. A real rescue team never has that. This simulation does.'),
        h('button.btn.btn-lg', { type: 'button', onclick: () => app.setTruth(true) }, icon('eye'), 'Reveal ground truth'),
        h('p.caption', null, 'Everything else in this workspace shows only what the console’s sensors found. Revealing ground truth also marks the true positions on the maps and adds two columns to the tree. You can switch it off again in the header.')));
      return;
    }
    if (!t.run) { el.replaceChildren(h('div.empty', null, h('div.spinner'), h('p', null, 'Waiting for the trunk.'))); return; }
    const cands = candidates(), ranked = cands.map((c) => ({ ...c, r: M.rank(c.run, true) })).sort((a, b) => M.cmpRank(a.r, b.r));
    const best = ranked[0], me = ranked.find((c) => c.id === 'trunk'), none = M.cmpRank(best.r, me.r) >= 0, better = ranked.filter((c) => M.cmpRank(c.r, me.r) < 0).length, worse = ranked.filter((c) => M.cmpRank(c.r, me.r) > 0).length;
    const gap = none ? [] : M.deltaWords(t.run, best.run, true);
    const L = app.live, human = (L?.log || []).filter((c) => !['setOperator', 'setAutoplay'].includes(c.name));
    const choices = t.run.events.filter((e) => ['INVESTIGATE', 'TEAM_CHECK', 'ROUTE_PLANNED', 'ROUTE_APPROVED', 'ALL_STOP', 'LEAD_CLOSED'].includes(e.code) && (e.code !== 'LEAD_CLOSED' || /Dismissed/.test(e.text)));
    const who = (e) => (human.some((c) => Math.abs(c.t - e.t) < 0.35) ? 'operator' : 'autopilot');
    const person = (run, id) => run.truth.people.find((p) => p.id === id);
    const cell = (p) => h('td', null, h('span', { class: OUT[p.outcome][1] }, OUT[p.outcome][0]), h('small', null, p.reachedAt != null ? 'reached at ' + clock(p.reachedAt) : p.det ? 'lead ' + p.det + ' ended ' + (p.dismissed ? 'dismissed' : p.detStatus === 'rejected' ? 'closed' : p.detStatus) + ', not reached' : 'never detected'));
    el.replaceChildren(
      h('div.tl-rg-verdict', null,
        h('span.tag.tag-sim', null, 'Ground truth: known only because this is a simulation'),
        h('h2', null, none ? ['Regret: ', h('em', null, 'none found')] : ['Regret: ', h('em', null, gap.slice(0, 2).map((g) => g.text).join(', '))]),
        h('p', null, none ? 'Of ' + plural(cands.length, 'world') + ' tried, none does better than the mission as flown' + (worse ? '; ' + worse + ' do worse.' : '.') : 'The best of ' + plural(cands.length, 'world') + ' tried is "' + best.label + '". Against it, the mission as flown has: ' + gap.map((g) => g.text).join(', ') + '. ' + better + ' of the worlds tried do better than what was flown.'),
        h('p.caption', null, 'Worlds are ranked by, in order: ' + M.RANK_WORDS.truth.slice(1).join('; ') + '. A later item only breaks ties. "Best" means best among the forks tried here, in this one simulated world. It is hindsight, not a rule: with different luck the order can change, which is what the parameter sweeps measure.'),
        !none && best.probe ? h('button.btn.btn-sm', { type: 'button', onclick: () => { const o = app.fork('trunk', best.probe.T, best.probe.dec); if (o.branch) { app.pendingSelect = o.branch.id; app.emit('branches'); app.showTab('worlds'); } } }, icon('plus', 12), 'Add the best world to the tree') : null,
        !none && best.id ? h('button.btn.btn-sm', { type: 'button', onclick: () => { app.compareId = 'trunk'; app.setCursor(best.id, app.cursor.t); app.setCompare('trunk'); app.showTab('worlds'); } }, 'Open it side by side') : null),
      h('div.tl-rg-people', null, h('h4', null, 'The people who were really there'),
        h('table.table.tl-rg-table', null, h('thead', null, h('tr', null, h('th', null, 'Person (ground truth)'), h('th', null, 'As flown: ' + t.name), h('th', null, none ? 'Best found: the same' : 'Best found: ' + best.label))),
          h('tbody', null, ...t.run.truth.people.map((p) => h('tr', null, h('td', null, h('b', null, p.id), ' ' + (p.room ? 'room ' + p.room : 'outdoors') + ', ' + p.motion + ', ' + p.posture, h('small', null, p.note)), cell(p), cell(person(best.run, p.id)))),
            ...t.run.truth.decoys.map((x) => { const o = best.run.truth.decoys.find((y) => y.id === x.id); const f = (y) => h('td', null, y.det ? h('span', { class: y.status === 'rejected' ? 'c-ok' : 'c-danger' }, y.status === 'rejected' ? 'lead opened, then closed correctly' : 'lead ' + y.status) : h('span.dim', null, 'no lead opened')); return h('tr.tl-rg-decoy', null, h('td', null, h('b', null, x.id), ' not a person: ' + (x.kind === 'fan' ? 'desk fan' : 'hot pipe') + ', room ' + x.room, h('small', null, x.note)), f(x), f(o)); }))),
        h('p.caption', null, 'Three simulated people and two decoys were placed in the exercise. The network is the weakest on a still person (21 % in simulation), which is why the second reading exists.')),
      h('div.tl-rg-choices', null, h('h4', null, 'The choices that were made'),
        h('ol.tl-rg-list', null, ...choices.map((e) => h('li', null, h('span.num', null, clock(e.t)), h('span', null, e.text), h('small', { class: who(e) === 'operator' ? 'c-accent' : 'dim' }, who(e))))),
        h('p.caption', null, human.length ? plural(human.length, 'command') + ' in the live log came from the operator; the rest were made by the autopilot.' : 'The live log has no operator decisions: every choice in the trunk was made by the autopilot. Turn the autopilot off in Mission and decide yourself; this page will replay your choices instead.')));
  }
  app.on('tab', (id) => { if (id === 'regret') paint(); });
  app.on('truth', paint); app.on('branches', paint); app.on('sweep', paint);
}

const SOURCES = [
  { who: 'Wachter, Mittelstadt and Russell', year: '2017', title: 'Counterfactual explanations without opening the black box', where: 'arXiv 1711.00399; Harvard Journal of Law and Technology 31(2), 2018', url: 'https://arxiv.org/abs/1711.00399', use: 'Explain a decision by the smallest change that would have reversed it. "Why this lead?" does exactly that on the fusion evidence.' },
  { who: 'Pearl', year: '2009', title: 'Causal inference in statistics: an overview, section 3.4', where: 'Statistics Surveys 3, 96 to 146', url: 'https://doi.org/10.1214/09-SS057', use: 'A counterfactual in a structural model keeps the background noise fixed and changes one action. A branch here keeps the seed and changes one command.' },
  { who: 'O’Callahan, Jones, Froyd, Huey, Noll and Partush', year: '2017', title: 'Engineering record and replay for deployability (the rr debugger)', where: 'USENIX Annual Technical Conference', url: 'https://www.usenix.org/conference/atc17/technical-sessions/presentation/ocallahan', use: 'Record the inputs, replay the run exactly. The trunk is rebuilt from the live mission’s command log the same way.' },
  { who: 'DARPA Deep Green (programme led by Col. John Surdu)', year: '2008', title: 'A commander’s aid that keeps a graph of possible futures of an operation', where: 'USC Viterbi news, April 2008', url: 'https://viterbischool.usc.edu/news/2008/04/beyond-chess-deep-green-models-rapid-change-for-combat-commanders/', use: 'A fielded-research precedent for running the alternatives ahead of the decision. This page does it for one small simulated search.' },
  { who: 'Savage', year: '1951', title: 'The theory of statistical decision', where: 'Journal of the American Statistical Association 46(253), 55 to 67', url: 'https://www.jstor.org/stable/2280094', use: 'The origin of judging a choice by its loss against the best choice in hindsight, now called regret.' },
  { who: 'Morris', year: '1991', title: 'Factorial sampling plans for preliminary computational experiments', where: 'Technometrics 33(2), 161 to 174', url: 'https://doi.org/10.2307/1269043', use: 'Change one input at a time and measure the effect. The sweeps are one-at-a-time experiments on the mission.' },
];

export function mountMethod(pane, app) {
  const { h, kit } = app, { icon } = kit;
  const proofEl = h('div.tl-pf');
  pane.append(h('div.tl-method', null,
    h('div.tl-m-col', null, h('h4', null, 'What this is'),
      h('p', null, 'The mission simulator is deterministic: the same commands and the same random seed give the same mission, to the last decimal. So a mission can be copied at any moment and continued with one thing changed. Each branch on this page is that: a second full run of the same engine, in a worker, not an estimate.'),
      h('ol.tl-m-steps', null,
        h('li', null, h('b', null, 'Copy.'), ' Take the live mission’s command log up to the fork and the seed it was built with.'),
        h('li', null, h('b', null, 'Replay.'), ' Build a new engine and step it to the fork, applying the same commands at the same times.'),
        h('li', null, h('b', null, 'Diverge.'), ' Issue the changed command, or change a threshold, at that instant. From there the autopilot makes the routine choices.'),
        h('li', null, h('b', null, 'Measure.'), ' Run to the end; record the world every simulated second; compare it with the world it left.')),
      h('p.note', null, icon('info'), h('span', null, h('b', null, 'What would have to be true in the field. '), 'A real mission can only be forked if every sensor reading is logged and a simulator can say what the sensors would have seen on the path not taken. Here that is possible because the people are invented. For a real collapse nobody can simulate the building, the people and the radio well enough to trust a branch; what carries over today is the cheap part: replaying the log, and asking of a lead what evidence would change the call.')),
      h('p.caption', null, 'Reality: live algorithm (the engine, the planner, the fusion maths and the Wi-Fi network all run for real in each branch) on a simulated scenario. Radar, thermal and drone likelihoods are assumed design values. No branch is a prediction about a real building.')),
    h('div.tl-m-col', null, h('h4', null, 'Replay proof'), proofEl),
    h('div.tl-m-col', null, h('h4', null, 'Sources, checked'), h('ul.tl-src', null, ...SOURCES.map((s) => h('li', null, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.who + ', ' + s.year, icon('external', 11)), h('span.tl-src-t', null, s.title + '. ' + s.where + '.'), h('span.tl-src-u', null, s.use)))),
      h('p.caption', null, 'Each reference was looked up and its authors, year and venue confirmed before it was listed. None of them is about HOUND; they are where the ideas come from.'))));
  function paint() {
    if (pane.hidden) return;
    const L = app.proof.live, rows = app.branches;
    const live = !L ? null : L.state === 'checking' ? h('p.tl-pf-live', null, h('span.status.live.accent', null, 'Checking the replay against the live mission…')) :
      L.state === 'ok' ? h('p.tl-pf-live', null, h('span.status.ok', null, 'Trunk matches the live mission at ' + clock(L.t)), h('small', null, 'A fresh engine replayed ' + plural(L.commands, 'logged command') + ' to ' + clock(L.t) + ' and reached the same state as the mission on screen: every event, every lead, every unit position. Fingerprint ', h('code.num', null, L.replay), ' on both.')) :
      L.state === 'differs' ? h('p.tl-pf-live', null, h('span.status.danger', null, 'Trunk differs from the live mission at ' + clock(L.t)), h('small', null, 'Live ', h('code.num', null, L.live), ', replay ', h('code.num', null, L.replay), '. The usual cause is a console extension that changes the live mission outside the command log. The branches are still exact replays of each other; the trunk is the replayable part of the live mission.')) :
      h('p.tl-pf-live', null, h('span.status.danger', null, 'The live check could not run'), h('small', null, L.error));
    proofEl.replaceChildren(live || '',
      h('table.table.dense.tl-pf-table', null, h('thead', null, h('tr', null, h('th', null, 'Branch'), h('th', null, 'First run'), h('th', null, 'Second run'), h('th', null, ''))),
        h('tbody', null, ...rows.map((b) => h('tr', null, h('td', null, h('b', null, b.name), ' ', h('span.dim', null, b.label)), h('td.num', null, b.run ? b.run.hash : '·'), h('td.num', null, b.hash2 || (b.run ? 'running' : '·')),
          h('td', null, b.verify === 'ok' ? h('span.status.ok', null, 'identical') : b.verify === 'fail' ? h('span.status.danger', null, 'differs') : h('span.status', null, b.run ? 'verifying' : b.status)))))),
      h('p.caption', null, 'Every branch is run twice, the second time as a separate job with no shared state. The fingerprint is a 64-bit hash of every event (time, code and text), every lead (status, probability to nine decimals, position) and every unit position at the end. Equal fingerprints mean the two runs were the same mission.'),
      h('div.row', null, h('button.btn.btn-sm', { type: 'button', onclick: () => app.recheck?.() }, icon('rotate'), 'Check against the live mission now'), h('span.caption', null, app.pool.mode === 'worker' ? plural(app.pool.size, 'worker') + ' in the pool' : 'Workers unavailable: running on this page')));
  }
  app.on('tab', (id) => { if (id === 'method') paint(); });
  app.on('proof', paint); app.on('branches', paint);
}
