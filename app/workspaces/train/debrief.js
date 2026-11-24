// The debrief. The drill is over, so ground truth is revealed here (and only here), clearly labelled:
// what was really in the building, what the trainee chose, what the autoplay policy chose on the same scenario.
import { createPlan } from '../triage/plan.js';
import { TRUTH, ROOMS } from '../../core/world.js';
import { FAULTS } from '../../core/sim.js';
import { describeSource, clock, REF_FAULT_S, AVOID_LABELS, LEVELS } from './scenario.js';
import { LESSON_META } from './index.js';

const ACT = { look: 'second look', team: 'handed to the team', dismiss: 'dismissed', left: 'left open' };

export function openDebrief(host, ctx, { run, base, res, level, seed, onExit, onAgain, onNew, onNext, onLesson }) {
  const { h, icon, realityTag } = ctx.kit, o = res.outcome, b = res.base;
  const where = (d) => (d ? (d.outdoor ? 'Outdoors' : d.room ? 'Room ' + d.room : 'Building B') : '–');
  const pctOf = (d) => (d ? (d.p * 100).toFixed(0) + ' %' : '');
  const final = (d) => (!d ? 'no lead raised' : d.status === 'confirmed' ? 'confirmed, ' + pctOf(d) : d.status === 'possible' ? (d.needsTeam ? 'with the team, ' : 'left open, ') + pctOf(d) : d.dismissed ? 'dismissed' : 'closed by fusion, ' + pctOf(d));

  // ---------- comparison rows: one per thing that was really there or was flagged ----------
  const sources = [...new Set([...TRUTH.people.map((p) => p.id), ...run.state.detections.map((d) => run.truthOf(d.id)), ...base.state.detections.map((d) => base.truthOf(d.id))])];
  const rows = sources.map((src) => {
    const mine = run.state.detections.find((d) => run.truthOf(d.id) === src), theirs = base.state.detections.find((d) => base.truthOf(d.id) === src), what = describeSource(src);
    const myActs = mine ? run.rec.leads.filter((l) => l.id === mine.id).map((l) => ACT[l.action] + ' at ' + (l.p * 100).toFixed(0) + ' %') : [];
    const autoActs = theirs ? base.state.events.filter((e) => e.det === theirs.id && ['INVESTIGATE', 'TEAM_CHECK', 'NO_VANTAGE'].includes(e.code)).map((e) => (e.code === 'INVESTIGATE' ? 'second look' : 'handed to the team')) : [];
    const good = what.person ? o.people.find((p) => p.truth.id === src)?.result !== 'missed' : !(o.falseLeads.find((f) => f.src === src)?.fate === 'team' || o.falseLeads.find((f) => f.src === src)?.fate === 'confirmed');
    return { src, what, where: where(mine || theirs) === '–' ? (TRUTH.people.find((p) => p.id === src)?.room ? 'Room ' + TRUTH.people.find((p) => p.id === src).room : 'Outdoors') : where(mine || theirs), you: [...new Set(myActs)].concat(final(mine)), auto: [...new Set(autoActs)].concat(final(theirs)), good };
  });

  // ---------- map with the truth layer ----------
  const canvas = h('canvas.train-canvas', { role: 'img', 'aria-label': 'Plan of the building with ground truth revealed: where each person and decoy really was, the leads the sensors raised, your approved route and the autoplay route' });
  function scene() {
    const markers = [
      ...TRUTH.people.map((p) => ({ pos: p.pos, kind: 'truth', label: '' })),
      ...TRUTH.decoys.map((d) => ({ pos: d.pos, kind: 'decoy', label: d.kind === 'fan' ? 'fan' : 'hot pipe' })),
      ...run.state.detections.map((d) => ({ pos: d.pos, kind: d.status === 'confirmed' ? 'person' : d.status === 'possible' ? 'possible' : 'rejected', sigma: 0, label: (d.room || 'outdoors') + '  ' + pctOf(d) })),
    ];
    const routes = [];
    if (b.route) for (const l of b.route.legs) if (l.ok) routes.push({ path: l.path, tone: 'ghost', width: 1.5, dash: [4, 4], arrows: false });
    if (o.route) for (const l of o.route.legs) if (l.ok) routes.push({ path: l.path, tone: 'main', width: 2.5, end: true, spans: l.exposure.spans });
    return { markers, routes, hazards: run.state.hazards, coverage: run.state.coverage, showResidual: true, units: [] };
  }
  const plan = createPlan(canvas, { scene, view: 'building' });

  // ---------- pieces ----------
  const cats = h('div.train-cats', null, ...res.cats.map((c) => h('div.train-cat', { 'data-full': String(c.got >= c.max - 0.01) },
    h('div.train-cathead', null, h('h3', null, c.label), h('span.train-meta', null, c.note), h('div.grow'), h('b.num', null, (Math.round(c.got * 10) / 10).toString()), h('span.num.train-of', null, '/ ' + c.max)),
    h('div.bar.lg' + (c.got >= c.max - 0.01 ? '.ok' : ''), { role: 'img', 'aria-label': c.label + ': ' + c.got.toFixed(0) + ' of ' + c.max }, h('i', { style: { width: (c.got / c.max) * 100 + '%' } })),
    h('ul', null, ...c.lines.map((l) => h('li', { 'data-ok': String(l.ok) }, icon(l.ok ? 'check' : 'close', 13), h('span', null, l.text)))))));
  const lessons = res.lessons.length
    ? h('ol.train-mistakes', null, ...res.lessons.map((l, i) => { const meta = LESSON_META.find((m) => m.id === l.lesson); return h('li', null, h('span.train-mnum', { 'aria-hidden': 'true' }, String(i + 1)), h('div', null, h('h4', null, l.title), h('p', null, l.text), meta ? h('button.btn.btn-sm', { onclick: () => onLesson(meta.id) }, 'Lesson: ' + meta.title, icon('arrow-right', 13)) : null)); }))
    : h('p.note.ok', null, icon('check'), h('span', null, h('b', null, 'No mistakes to learn from in this run.'), ' ' + (level.id < LEVELS.length ? 'The next level adds random Wi-Fi windows and faults, so the sensors stop being this kind.' : 'Run it again: with random windows every scenario is different.')));
  const table = h('table.table.train-compare', null,
    h('thead', null, h('tr', null, h('th', null, 'What'), h('th', null, 'You'), h('th', null, 'Autoplay policy'), h('th', null, 'Ground truth'))),
    h('tbody', null,
      ...rows.map((r) => h('tr', { 'data-good': String(r.good) }, h('th', null, r.where), h('td', null, ...r.you.map((x) => h('div', null, x))), h('td', null, ...r.auto.map((x) => h('div', null, x))), h('td', null, h('span.train-truth', { 'data-person': String(r.what.person) }, r.what.label)))),
      h('tr', null, h('th', null, 'Route approved'), h('td', null, o.route ? h('div', null, o.route.length.toFixed(0) + ' m, ' + o.route.exposure.toFixed(1) + ' m inside hazards') : 'none', o.route ? h('div.train-sub', null, Object.keys(AVOID_LABELS).filter((k) => o.route.avoid[k] === false).map((k) => AVOID_LABELS[k].toLowerCase() + ' not avoided').join(', ') || 'every hazard avoided') : null),
        h('td', null, b.route ? b.route.length.toFixed(0) + ' m, ' + b.route.exposure.toFixed(1) + ' m inside hazards' : 'none', h('div.train-sub', null, 'every hazard avoided')), h('td', null, h('span.train-sub', null, 'Some metres on the slope cannot be avoided: one person is inside it.'))),
      ...run.rec.faults.map((f) => h('tr', null, h('th', null, 'Fault: ' + FAULTS[f.id].label.toLowerCase()), h('td', null, f.tInject == null ? 'did not occur' : f.tAnswer == null ? 'not handled' : 'handled in ' + (f.tAnswer - f.tInject).toFixed(0) + ' s' + (f.wrong ? ', ' + f.wrong + ' wrong first' : '')), h('td', null, 'reference response, ' + REF_FAULT_S + ' s (assumed)'), h('td', null, h('span.train-sub', null, FAULTS[f.id].does)))),
      h('tr', null, h('th', null, 'Mission time to approval'), h('td.num', null, clock(o.time)), h('td.num', null, clock(b.time)), h('td', null, ''))));
  const cov = h('table.table.dense.train-cov', null,
    h('thead', null, h('tr', null, h('th', null, 'Room'), h('th', null, 'Search'), h('th.num', null, 'Sensors reached'), h('th.num', { title: 'The chance a person is in the room and was not found. The starting value of 10 % a room is assumed.' }, 'Missed-person risk'), h('th', null, 'You reported'))),
    h('tbody', null, ...ROOMS.filter((r) => !r.corridor).map((r) => { const found = run.state.detections.some((d) => d.room === r.id && d.status === 'confirmed'), c = found ? { ...o.coverage[r.id], status: 'person' } : o.coverage[r.id], flagged = (run.rec.handover || []).includes(r.id), need = o.hand.includes(r.id);
      return h('tr', { 'data-good': String(flagged === need) }, h('th', null, r.id), h('td', null, c.status === 'clear' ? (c.noCsi ? 'radar and thermal only' : 'searched') : c.status === 'person' ? 'person found' : c.status === 'lead' ? (run.state.detections.some((d) => d.room === r.id && d.dismissed) ? 'lead dismissed' : 'open lead') : 'not searched'), h('td.num', null, (c.reach * 100).toFixed(0) + ' %'), h('td.num', null, c.status === 'person' ? '–' : (c.residual * 100).toFixed(0) + ' %'), h('td', null, flagged ? 'not searched' : 'searched', flagged !== need ? h('span.train-wrong', null, need ? ' · should be flagged' : ' · was searched') : null)); })));

  const next = level.id < LEVELS.length && res.total >= 75;
  host.classList.add('train-debriefview');
  host.append(
    h('div.train-bar', null, h('button.btn.btn-ghost', { onclick: onExit }, icon('arrow-left', 14), 'Back to training'), h('h2', null, 'Debrief'), h('span.train-meta', null, 'Level ' + level.id + ': ' + level.name), h('span.train-meta.num', null, 'scenario ' + seed), h('div.grow'),
      h('button.btn', { onclick: onAgain, title: 'The same seed: the same building, people and faults' }, icon('reset', 14), 'Same scenario again'),
      level.windows === 'random' ? h('button.btn' + (next ? '' : '.btn-primary'), { onclick: onNew }, 'New scenario') : null,
      level.id < LEVELS.length ? h('button.btn' + (next || level.windows !== 'random' ? '.btn-primary' : ''), { onclick: onNext }, 'Level ' + (level.id + 1), icon('arrow-right', 14)) : null),
    h('div.train-debrief', null,
      h('div.train-dmain', null,
        h('section.train-scorehead', null,
          h('div.train-score', { role: 'img', 'aria-label': 'Score ' + res.total + ' of 100' }, h('b', null, String(res.total)), h('span', null, 'of 100')),
          h('div', null, h('h1', null, res.grade), h('p', null, o.people.filter((p) => p.result === 'sensors').length + ' of ' + o.people.length + ' people found by the sensors, ' + o.people.filter((p) => p.result === 'team').length + ' left to the rescue team, ' + o.people.filter((p) => p.result === 'missed').length + ' missed. Route approved at ' + clock(o.time) + ' of mission time; the autoplay policy took ' + clock(b.time) + '.'),
            h('p.train-fine', null, 'The comparison replays the same scenario and seed with the console making the routine choices. After your first different decision its sensor readings can differ from yours.'))),
        h('section', null, h('div.train-sechead', null, h('h2', null, 'Where the points went')), cats),
        h('section', null, h('div.train-sechead', null, h('h2', null, res.lessons.length === 1 ? 'One thing to take away' : res.lessons.length ? 'One lesson for each mistake' : 'A clean run')), lessons),
        h('section', null, h('div.train-sechead', null, h('h2', null, 'Your choices, the autoplay policy, and what was really there'), realityTag('sim')), table)),
      h('aside.train-dside', null,
        h('div.train-truthmap', null, canvas, h('div.train-stagetop', null, h('span.tag.tag-sim', null, 'Ground truth revealed'), h('div.grow')),
          h('div.legend.train-legend', null, h('span', null, h('i.train-lgtruth'), 'A person was really here'), h('span', null, h('i.train-lgdecoy'), 'Decoy'), h('span', null, h('i.line'), 'Your route'), h('span', null, h('i.dash', { style: '--c:var(--text-2)' }), 'Autoplay route'))),
        h('div.train-covwrap', null, h('div.train-sechead', null, h('h3', null, 'What was searched, and the risk left behind'), realityTag('live-algo')), cov,
          h('p.train-fine', null, 'A room is never “empty”, only “nothing found”. One 10 second window from the corridor reaches about a third of a classroom, so the risk barely drops below the assumed 10 %.')))));
  document.fonts?.ready.then(() => plan.draw());
  return { destroy() { plan.destroy(); } };
}
