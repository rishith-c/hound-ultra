// The whole report as clean Markdown, from the same model as the paper.
import { clock, pct } from './model.js';
import { markingData, markingKey } from './marking.js';

const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
const table = (head, rows) => ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |', ...rows.map((r) => '| ' + r.map(cell).join(' | ') + ' |')].join('\n');
const tm = (t) => (t == null ? '-' : clock(t));

export function toMarkdown(S, R) {
  const m = R.meta, o = [];
  o.push('# Hand-over report: search of Block B', '');
  o.push('> **Simulated training exercise. Not a real incident.** Timure and its valley are real, and so was the Bhote Koshi flood of 26 August 2026. This block of buildings, the people in it, the damage and every sensor reading in this report are invented for the exercise.', '');
  o.push(table(['Field', 'Value'], [['Status', '**' + m.statusLine + '**'], ['Exercise', m.exercise], ['Place', m.place], ['Report time (mission clock)', m.clock], ['Phase', m.phaseLabel], ['Operator', m.operator], ['Document no.', m.docNo], ['Site origin (south-west corner)', m.anchor.lat.toFixed(5) + ' N, ' + m.anchor.lon.toFixed(5) + ' E'], ['Written by', 'HOUND Command, from the mission log' + (m.autoplay ? ' (autoplay on)' : '')]]), '');

  o.push('## 1. Summary', '', R.summary.sentences.join(' '), '', table(['Key figure', 'Value', 'Note'], R.summary.figures.map((f) => [f.k, f.v, f.n])), '');

  o.push('## 2. People found', '');
  if (!R.people.length) o.push('No one found yet. The rover has searched ' + R.searched + ' of ' + R.rooms + ' rooms.', '');
  else {
    o.push('People are numbered in the order they were first sensed.' + (R.order.length ? ' Route order: ' + R.order.map((n) => 'person ' + n).join(', then ') + '.' : '') + ' Any order is a planning aid, not a medical assessment.', '');
    for (const p of R.people) {
      o.push('### ' + (p.confirmed ? 'Person ' : 'Possible person ') + p.n + ': ' + p.where.short + ' (' + pct(p.p) + ')', '');
      o.push('- **Status:** ' + p.stateLabel + '. Log reference ' + p.ref + '.');
      o.push('- **Where:** ' + p.where.long + '; ' + (p.pos ? 'x ' + p.pos[0].toFixed(1) + ' m, y ' + p.pos[1].toFixed(1) + ' m' : 'not fixed') + (p.sigma ? ', uncertain by about ' + p.sigma.toFixed(1) + ' m' : '') + '.');
      o.push('- **Movement:** ' + (p.motion ? p.motion + ' when sensed' : 'not known yet') + '. No breathing rate is reported: it is not reliable.');
      o.push('- **Sensed by:** ' + (p.said.join('; ') || 'no sensor has answered yes yet') + '. From: ' + p.vantages.join('; ') + '.');
      o.push('- **Times:** first sensed ' + clock(p.firstAt) + (p.foundAt != null ? ', confirmed ' + clock(p.foundAt) : '') + (p.reachedAt != null ? ', reached ' + clock(p.reachedAt) : '') + '.');
      const a = p.access;
      if (!a) o.push('- **How to reach:** ' + (R.route ? 'not on the current route.' : 'no route has been planned yet.'));
      else if (a.failed) o.push('- **How to reach:** no safe path was found (' + a.reason + ').');
      else if (a.kind === 'break through') o.push('- **How to reach:** leg ' + a.n + ' of the route, ' + a.length.toFixed(1) + ' m, then **break through**. Stand at x ' + a.point[0].toFixed(1) + ' m, y ' + a.point[1].toFixed(1) + ' m' + (a.fromRoom ? ' in ' + a.fromRoom : '') + '.' + (a.wall ? ' Wall ' + a.wall.between + ' (' + a.wall.id + '): ' + a.wall.mat + ', ' + a.wall.state + ', ' + a.wall.dist.toFixed(1) + ' m away.' : '') + ' The person is about ' + a.gap.toFixed(1) + ' m beyond the access point.');
      else o.push('- **How to reach:** leg ' + a.n + ' of the route, ' + a.length.toFixed(1) + ' m, walk in.');
      o.push('', 'How sure, step by step (prior ' + pct(R.prior) + ', assumed):', '');
      o.push(table(['Time', 'From', 'Reading', 'Likelihood ratio', 'Basis', 'Probability after'], p.chain.map((c) => [clock(c.t), c.from, c.label + ': ' + c.result, c.info ? '×' + c.lr.toFixed(2) : 'no information', c.info ? (c.assumed ? 'assumed' : 'measured') + (c.repeat ? ', repeat at half weight' : '') : '-', pct(c.p)])), '');
    }
  }

  o.push('## 3. Leads closed, and why', '');
  o.push(R.closed.length ? table(['Lead', 'Where', 'Closed as', 'Why', 'Deciding readings', 'Final probability', 'Closed at'], R.closed.map((c) => [c.det, c.where.short, c.kind, c.reason, c.deciding.map((d) => d.label + ': ' + d.result + ' (×' + d.lr.toFixed(2) + (d.assumed ? ', assumed' : ', measured') + ')').join('; ') || 'operator decision', pct(c.p, 1), tm(c.closedAt)])) : 'No leads have been closed so far.', '');

  o.push('## 4. What was not searched, and the residual risk', '');
  o.push(R.notSearched.length ? '**Not cleared: ' + R.notSearched.map((c) => c.name).join(', ') + '.** Nothing is known about ' + (R.notSearched.length === 1 ? 'this room' : 'these rooms') + '. Treat as possibly occupied.' : 'Every room was listened to from at least one stop. That is not the same as cleared: the sensors reached only part of most rooms.', '');
  o.push(table(['Room', 'Status', 'Sensor reach', 'Chance someone was missed', 'Note'], R.coverage.map((c) => [c.room + ' ' + c.name.replace(/ \d+$/, ''), c.label, pct(c.reach), c.residual == null ? 'does not apply' : pct(c.residual) + (c.status === 'lead' ? ' (open lead)' : c.rank < 2 ? ' (prior only)' : ''), c.note])), '');
  o.push('The ' + pct(R.prior) + ' prior and the radar and thermal likelihoods are assumed design values. Only the Wi-Fi likelihood is measured, on simulated test windows. Read these percentages as a ranking, not as measured risk.', '');

  o.push('## 5. Hazards and the approved route', '');
  o.push(table(['Key', 'Hazard', 'Source', 'Size', 'Effect on route planning', 'Route'], R.hazards.map((h) => [h.key, h.name, h.src + (h.addedAt != null ? ' at ' + clock(h.addedAt) : ''), h.area.toFixed(0) + ' m²', h.effect, h.avoided ? 'steered around' : 'not in the way'])), '');
  const r = R.route;
  if (!r) o.push('**Rescue route:** none planned yet.', '');
  else {
    o.push('**Rescue route:** ' + r.statusLabel + '. ' + r.length.toFixed(1) + ' m, about ' + clock(r.etaS) + ' on foot at 1.1 m/s (assumed). Planned at ' + tm(r.plannedAt) + '. ' + (r.approvedBy ? 'Approved at ' + tm(r.approvedAt) + ' by ' + (r.auto ? 'autoplay: the demo approved it itself, no person approved this route.' : r.approvedBy + '.') : 'Not approved yet.') + (r.avoided.length ? ' Steers around: ' + r.avoided.join('; ') + '.' : ''), '');
    o.push(table(['Leg', 'To', 'Entry', 'Length', 'Access point (x, y)', 'Short by', 'Arrived'], r.legs.map((l) => (l.ok ? [l.n, l.to, l.kind, l.length.toFixed(1) + ' m', l.access[0].toFixed(1) + ', ' + l.access[1].toFixed(1), l.gap ? l.gap.toFixed(1) + ' m' : '0', tm(l.arrivedAt)] : [l.n, l.to, 'no safe path', '-', '-', '-', '-']))), '');
    o.push('The order of legs is a planning aid, not a medical assessment.', '');
  }

  const M = markingData(S, R);
  o.push('## Drawing B. Search marking for the block, INSARAG style', '', table(['No.', 'Field', 'Shows', 'Where it comes from'], markingKey(M)), '');
  o.push('This is a simplified training rendering of the INSARAG worksite marking convention, generated from simulated data. It is not an official marking. The plan drawing (drawing A) is in the printed report only.', '');

  o.push('## 6. Timeline of key moments', '');
  o.push(R.timeline.length ? table(['Time', 'Moment', 'What happened'], R.timeline.map((e) => [clock(e.t), e.kind, e.text])) : 'Nothing has happened yet.', '');
  if (R.timeline.length) o.push(R.omitted + ' routine events are left out. The full log of ' + R.totalEvents + ' events is in the JSON export.', '');

  o.push('## 7. Faults that occurred and how they were handled', '');
  if (!R.drills.length && !R.safety.length) o.push('No faults occurred in this run. Use System check to run fault drills.', '');
  else {
    if (R.drills.length) o.push(table(['Began', 'Fault', 'Safe behaviour', 'Cleared', 'Lasted'], R.drills.map((d) => [clock(d.at), d.label, d.does, d.active ? 'still active' : tm(d.clearedAt), clock(d.duration) + (d.active ? ' so far' : '')])), '');
    if (R.safety.length) o.push(table(['Time', 'Event', 'What the system did'], R.safety.map((e) => [clock(e.t), e.kind, e.text])), '');
  }

  o.push('## 8. Limits of the sensing', '', '**Read this before acting on anything above. Every number here comes from simulation.**', '');
  o.push(table(['Number', 'What it is', 'Note'], R.limits.figures.map((f) => [f.v, f.k, f.n])), '');
  R.limits.points.forEach((p, i) => o.push((i + 1) + '. **' + p[0] + '** ' + p[1]));
  o.push('');

  o.push('## 9. Who approved what', '');
  o.push(R.decisions.length ? table(['Time', 'Decision', 'By'], R.decisions.map((d) => [clock(d.t), d.what, d.who])) : 'No decisions have been logged yet.', '');
  if (r?.auto) o.push('**The route in this report was approved by autoplay, not by a person.** Before a team moves on a route, a named person must approve it.', '');
  o.push('| Operator, handing over | Rescue team leader, receiving | Safety officer |', '| --- | --- | --- |', '| ' + cell(m.operator) + ', ' + m.clock + ' mission clock | name, signature, time | name, signature, time |', '');
  o.push('---', 'End of report ' + m.docNo + '. ' + m.statusLine + '. Simulated training exercise. Not a real incident.', '');
  return o.join('\n');
}
