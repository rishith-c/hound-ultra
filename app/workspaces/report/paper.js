// The paper: turns the report model into A4 sheets. Content is built as blocks, then a small paginator flows the
// blocks into fixed-size sheets by measuring them, splitting long tables and repeating their headers. The same
// sheets are what gets printed, so the page count on screen is the page count on paper.
import { clock, pct } from './model.js';
import { buildingPlan, sitePlan, legendItems } from './plan.js';
import { markingData, markingSVG, markingKey } from './marking.js';

const BRAND = new URL('../../../assets/brand/hound-lockup-ink.svg', import.meta.url).href;
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sel = (s) => (s ? ' data-sel="' + esc(s.type + ':' + s.id) + '" tabindex="0"' : '');
const xy = (p) => (p ? 'x ' + p[0].toFixed(1) + ' m, y ' + p[1].toFixed(1) + ' m' : 'not fixed');
const h2 = (id, n, title, lead) => '<h2 class="report-h2" id="report-' + id + '" data-sec="' + id + '"><span class="report-secno">' + n + '</span>' + esc(title) + '</h2>' + (lead ? '<p class="report-lead">' + lead + '</p>' : '');
const bar = (v, tone) => '<span class="report-bar"><i class="report-bar-' + tone + '" style="width:' + Math.max(0, Math.min(100, v * 100)).toFixed(0) + '%"></i></span>';
const empty = (text) => '<p class="report-empty">' + esc(text) + '</p>';
const time = (t) => (t == null ? '<span class="report-mute">–</span>' : '<span class="report-num">' + clock(t) + '</span>');

function chainHTML(p, R) {
  // running probability as a small step chart, with the two decision thresholds
  const W = 132, H = 46, pts = [R.prior, ...p.chain.map((c) => c.p)], n = pts.length;
  const X = (i) => 3 + (i * (W - 6)) / Math.max(1, n - 1), Y = (v) => 3 + (1 - v) * (H - 6);
  let d = 'M' + X(0).toFixed(1) + ' ' + Y(pts[0]).toFixed(1);
  for (let i = 1; i < n; i++) d += 'H' + X(i).toFixed(1) + 'V' + Y(pts[i]).toFixed(1);
  const chart = '<svg class="report-plan report-spark" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Running probability from ' + pct(pts[0]) + ' to ' + pct(pts[n - 1]) + '"><rect x="0.500" y="0.500" width="' + (W - 1) + '" height="' + (H - 1) + '" class="report-p-thin report-p-paperfill"/><line x1="1" x2="' + (W - 1) + '" y1="' + Y(R.thresholds.confirmed).toFixed(1) + '" y2="' + Y(R.thresholds.confirmed).toFixed(1) + '" class="report-p-thr"/><line x1="1" x2="' + (W - 1) + '" y1="' + Y(R.thresholds.possible).toFixed(1) + '" y2="' + Y(R.thresholds.possible).toFixed(1) + '" class="report-p-thr"/><path d="' + d + '" class="report-p-sparkline"/><circle cx="' + X(n - 1).toFixed(1) + '" cy="' + Y(pts[n - 1]).toFixed(1) + '" r="2.500" class="report-p-inkfill"/></svg>';
  // one row per reading: where and when, then what each sensor said and what it did to the probability
  const groups = [];
  for (const c of p.chain) { const key = c.vantage + '@' + c.t; let g = groups[groups.length - 1]; if (!g || g.key !== key) groups.push((g = { key, from: c.from, t: c.t, items: [] })); g.items.push(c); }
  const stepCell = (c) => '<div class="report-step' + (c.info ? '' : ' report-step-null') + '" title="' + esc(c.note) + '"><span>' + esc(c.label) + ': ' + esc(c.result) + '</span><b>' + (c.info ? '\u00d7' + (c.lr >= 10 ? c.lr.toFixed(0) : c.lr.toFixed(2)) + ' \u2192 ' + pct(c.p) : 'no information') + '</b><em>' + (c.info ? (c.assumed ? 'assumed' : 'measured') + (c.repeat ? ', repeat \u00bd' : '') : '') + '</em></div>';
  let steps = '<li class="report-reading"><div class="report-step-at"><span>Start</span></div><div class="report-step report-step-prior"><span>Prior, any room</span><b>' + pct(R.prior) + '</b><em>assumed</em></div></li>';
  for (const g of groups) steps += '<li class="report-reading"><div class="report-step-at"><span>' + esc(g.from) + '</span><span class="report-num">' + clock(g.t) + '</span></div>' + g.items.map(stepCell).join('') + '</li>';
  return '<div class="report-chain"><div class="report-chain-chart">' + chart + '<span>Running probability. Lines at ' + pct(R.thresholds.possible) + ' (possible) and ' + pct(R.thresholds.confirmed) + ' (confirmed). A repeat reading from the same place counts at half weight (assumed).</span></div><ol class="report-steps">' + steps + '</ol></div>';
}

function personBlock(p, R) {
  const a = p.access;
  let reach;
  if (!a) reach = '<p>' + (R.route ? 'Not on the current route.' : 'No route has been planned yet.') + '</p>';
  else if (a.failed) reach = '<p><b>No safe path was found</b> (' + esc(a.reason) + ').</p>';
  else if (a.kind === 'break through') {
    const w = a.wall;
    reach = '<p><b>Leg ' + a.n + ' of the route: ' + a.length.toFixed(1) + ' m, then break through.</b> The path ends ' + a.gap.toFixed(1) + ' m short of the person.</p>' +
      '<p class="report-breach"><b>Where to break through.</b> Stand at ' + xy(a.point) + (a.fromRoom ? ', in ' + esc(a.fromRoom) : '') + '. ' + (w ? 'The wall ' + esc(w.between) + ' (' + esc(w.id) + ', runs ' + w.runs + ' at ' + w.at + ') is ' + w.dist.toFixed(1) + ' m away: <b>' + esc(w.mat) + ', ' + esc(w.state) + '</b>. ' : '') + 'The person is about ' + a.gap.toFixed(1) + ' m beyond the access point' + (p.sigma ? ', give or take ' + p.sigma.toFixed(1) + ' m' : '') + '.' + (a.arrivedAt != null ? ' Team at the wall at ' + clock(a.arrivedAt) + '.' : '') + '</p>';
  } else reach = '<p><b>Leg ' + a.n + ' of the route: ' + a.length.toFixed(1) + ' m, walk in.</b> The path reaches the estimated position' + (a.arrivedAt != null ? '; the team arrived at ' + clock(a.arrivedAt) : '') + '.</p>';
  const times = ['first sensed ' + clock(p.firstAt), p.foundAt != null ? 'confirmed ' + clock(p.foundAt) : null, p.reachedAt != null ? 'reached ' + clock(p.reachedAt) : null].filter(Boolean).join(' · ');
  const motion = p.motion === 'moving' ? 'Moving when sensed' : p.motion === 'still' ? 'Still when sensed' : 'Not known yet';
  return '<section class="report-blk report-person' + (p.confirmed ? '' : ' report-person-poss') + '"' + sel(p.sel) + ' data-alt="detection:' + esc(p.det) + '" aria-label="Person ' + p.n + ', ' + esc(p.where.short) + '">' +
    '<header class="report-person-head"><span class="report-pnum"><i>' + p.n + '</i></span><div class="report-person-id"><h3>' + (p.confirmed ? 'Person ' : 'Possible person ') + p.n + ' · ' + esc(p.where.short.charAt(0).toUpperCase() + p.where.short.slice(1)) + '</h3><span>' + esc(p.stateLabel) + '. Log reference ' + esc(p.ref) + '.</span></div>' +
    '<div class="report-psure"><b>' + pct(p.p) + '</b><span>' + (p.confirmed ? 'sure, all readings fused' : 'not enough to confirm') + '</span></div></header>' +
    '<div class="report-person-grid"><dl class="report-dl">' +
    '<dt>Where</dt><dd>' + esc(p.where.long) + '<br><span class="report-tn">' + xy(p.pos) + (p.sigma ? ', position uncertain by about ' + p.sigma.toFixed(1) + ' m' : '') + '</span>' + '</dd>' +
    '<dt>Movement</dt><dd>' + motion + '. No breathing rate is reported: it is not reliable.</dd>' +
    '<dt>Sensed by</dt><dd>' + (p.said.length ? esc(p.said.join('; ')) : 'No sensor has answered yes yet') + '</dd>' +
    '<dt>From</dt><dd>' + esc(p.vantages.join('; ')) + '</dd>' +
    '<dt>Times</dt><dd class="report-tn">' + times + '</dd></dl>' +
    '<div class="report-reach"><h4>How to reach</h4>' + reach + '</div></div>' + chainHTML(p, R) + '</section>';
}

export function buildBlocks(S, R, outline = []) {
  const B = [], m = R.meta;
  const push = (html, o = {}) => B.push({ html, ...o });

  // ----- title block -----
  const cell = (k, v, span) => '<div class="report-cell' + (span ? ' report-cell-' + span : '') + '"><dt>' + k + '</dt><dd>' + v + '</dd></div>';
  push('<div class="report-title"><div class="report-title-top"><div class="report-title-main"><div class="report-org"><img class="report-brand" src="' + BRAND + '" alt="HOUND"><span><b>Command</b> · student search-and-rescue project</span></div><h1>Hand-over report</h1><p>Search of Block B, written for the incoming rescue team</p></div>' +
    '<div class="report-status ' + (m.partial ? 'report-status-partial' : 'report-status-final') + '"><b>' + (m.partial ? 'Partial report' : 'Final report') + '</b><span>' + (m.partial ? 'Mission in progress, phase ' + esc(m.phaseLabel) + (m.hold ? '. All stop in force' : '') : 'Mission complete') + '</span></div></div>' +
    '<dl class="report-form">' + cell('Exercise', esc(m.exercise), 2) + cell('Place', esc(m.place)) + cell('Report time, mission clock', '<span class="report-num report-big">' + m.clock + '</span>') +
    cell('Operator', esc(m.operator)) + cell('Phase', esc(m.phaseLabel)) + cell('Document no.', '<span class="report-num">' + esc(m.docNo) + '</span>') + cell('Pages', '<span class="report-num" data-fill="pages">–</span>') +
    cell('Site origin (south-west corner)', '<span class="report-num">' + m.anchor.lat.toFixed(5) + ' N, ' + m.anchor.lon.toFixed(5) + ' E</span>', 2) + cell('Written by', 'HOUND Command, from the mission log', 2) + '</dl>' +
    '<p class="report-notice"><b>Simulated training exercise. Not a real incident.</b> Timure and its valley are real, and so was the Bhote Koshi flood of 26 August 2026. This block of buildings, the people in it, the damage and every sensor reading in this report are invented for the exercise.</p></div>');

  // ----- 1 summary -----
  push(h2('s1', '1', 'Summary', '') + '<p class="report-summary">' + R.summary.sentences.map(esc).join(' ') + '</p>' +
    '<div class="report-figs">' + R.summary.figures.map((f) => '<div class="report-fig' + (f.tone ? ' report-tone-' + f.tone : '') + '"><b class="report-num">' + esc(f.v) + '</b><span>' + esc(f.k) + '</span><em>' + esc(f.n) + '</em></div>').join('') + '</div>');
  push('<div class="report-cover"><figure class="report-figure"><div data-plan="site">' + sitePlan(S, R) + '</div><figcaption>Site plan, 120 m by 90 m. Grid every 20 m.</figcaption></figure>' +
    '<div class="report-toc"><h4>In this report</h4><ol>' + outline.map((o) => '<li><b>' + o.n + '</b><span>' + esc(o.title) + '</span><i>' + esc(o.mark.text) + '</i><u data-toc="' + o.id + '"></u></li>').join('') + '</ol></div></div>');

  // ----- A plan drawing -----
  const leg = legendItems(R);
  push(h2('sA', 'A', 'Plan drawing: Block B search plan', '') +
    '<figure class="report-figure report-drawing"><div data-plan="building">' + buildingPlan(S, R) + '</div></figure>' +
    '<div class="report-drawing-foot"><div class="report-legend"><h4>Legend</h4><ul>' + leg.map((l) => '<li>' + l[0] + '<span>' + esc(l[1]) + '</span></li>').join('') + '</ul></div>' +
    '<div class="report-drawing-side"><h4>Hazard key</h4><ol class="report-hzkey">' + R.hazards.map((h) => '<li' + sel(h.sel) + '><b>' + h.key.slice(1) + '</b><span>' + esc(h.name) + (h.addedAt != null ? ' (added ' + clock(h.addedAt) + ')' : '') + '</span></li>').join('') + '</ol>' +
    '<dl class="report-form report-form-tight report-form-2">' + cell('Drawing', 'A \u00b7 Search plan, Block B') + cell('Drawn at', '<span class="report-num">' + m.clock + '</span> mission clock') + cell('Scale', 'Bar on plan, about 1:300 on A4') + cell('Grid', '5 m, from the site origin') + cell('Status', 'Simulated exercise. Not a survey', 2) + '</dl></div></div>', { brk: true });

  // ----- 2 people -----
  const lead2 = R.people.length ? 'One block per person located and per lead that is still open, numbered in the order they were first sensed. Positions are sensor estimates with their uncertainty. ' + (R.order.length ? 'Route order: ' + R.order.map((n) => 'person ' + n).join(', then ') + '. ' : '') + 'Any order is a planning aid, not a medical assessment.' : '';
  if (!R.people.length) push(h2('s2', '2', 'People found', '') + empty(m.phase === 'standby' ? 'No one found yet. The exercise has not started.' : 'No one found yet. The rover has searched ' + R.searched + ' of ' + R.rooms + ' rooms' + (m.mapReady ? '; the drone survey is complete.' : '; the drone survey is ' + pct(m.scan) + ' done.')), { brk: true });
  else { push(h2('s2', '2', 'People found', lead2), { brk: true, keep: true }); for (const p of R.people) push(personBlock(p, R)); }

  // ----- 3 leads closed -----
  if (!R.closed.length) push(h2('s3', '3', 'Leads closed, and why', '') + empty(m.phase === 'standby' || !R.searched ? 'No leads have been opened yet, so none have been closed.' : 'No leads have been closed so far. Every lead opened is still listed in section 2.'));
  else {
    push(h2('s3', '3', 'Leads closed, and why', 'Readings that first looked like a person and were then ruled out. They stay in the report so the team can judge the decision.'), { keep: true });
    B.push({ table: { cls: 'report-table', head: '<th>Lead</th><th>Where</th><th>Closed as</th><th>Why</th><th>Deciding readings</th><th class="report-r">Final</th><th class="report-r">Closed</th>',
      rows: R.closed.map((c) => '<tr' + sel(c.sel) + '><td class="report-num">' + esc(c.det) + '</td><td>' + esc(c.where.short) + (c.pos ? '<br><span class="report-num report-mute">' + c.pos[0].toFixed(1) + ', ' + c.pos[1].toFixed(1) + '</span>' : '') + '</td><td><b>' + esc(c.kind) + '</b></td><td>' + esc(c.reason) + '</td><td>' + (c.deciding.length ? c.deciding.map((d) => esc(d.label) + ': ' + esc(d.result) + ' <span class="report-num">(×' + d.lr.toFixed(2) + (d.assumed ? ', assumed' : ', measured') + ')</span>').join('<br>') : 'Operator decision') + '</td><td class="report-r report-num">' + pct(c.p, 1) + '</td><td class="report-r">' + time(c.closedAt) + '</td></tr>') } });
  }

  // ----- 4 coverage -----
  const call = R.notSearched.length
    ? '<div class="report-callout report-callout-warn"><b>Not cleared: ' + R.notSearched.map((c) => esc(c.name)).join(', ') + '.</b> ' + (R.notSearched.every((c) => c.status === 'blocked') ? 'The corridor to ' + (R.notSearched.length === 1 ? 'this room' : 'these rooms') + ' is blocked by debris, so the rover could not listen there.' : 'The rover has not listened at ' + (R.notSearched.length === 1 ? 'this room' : 'these rooms') + ' yet.') + ' Nothing is known about ' + (R.notSearched.length === 1 ? 'it' : 'them') + '. Treat as possibly occupied.</div>'
    : '<div class="report-callout report-callout-ok"><b>Every room was listened to from at least one stop.</b> That is not the same as cleared: the sensors reached only part of most rooms, and a still person is easy to miss (section 8).</div>';
  push(h2('s4', '4', 'What was not searched, and the residual risk', 'Worst first. Residual risk is the chance that a room holds a person the search missed.') + call, { keep: true, brk: true });
  push('<p class="report-small report-foot-note"><b>How the residual is worked out.</b> Before any reading, each room is given a ' + pct(R.prior) + ' chance of holding a person (assumed). For the part of a room the sensors reached, that chance is lowered by the negative readings; for the part they did not reach it stays at ' + pct(R.prior) + '. Only the Wi-Fi likelihood is measured (on simulated test windows). The prior and the radar and thermal likelihoods are assumed design values, so read these percentages as a ranking, not as measured risk.</p>', { keep: true });
  B.push({ table: { cls: 'report-table report-table-cov', head: '<th>Room</th><th>Status</th><th>Sensor reach</th><th>Chance someone was missed</th><th>Note</th>',
    rows: R.coverage.map((c) => '<tr class="report-cov-' + c.status + '"' + sel(c.sel) + '><td><b class="report-num">' + esc(c.room) + '</b><br><span class="report-mute">' + esc(c.name.replace(/ \d+$/, '')) + '</span></td><td><span class="report-st report-st-' + c.status + '">' + esc(c.label) + '</span></td>' +
      '<td class="report-barcell">' + bar(c.reach, 'ink') + '<span class="report-num">' + pct(c.reach) + '</span></td>' +
      '<td class="report-barcell">' + (c.residual == null ? '<span class="report-mute">Does not apply</span>' : bar(c.residual, c.status === 'lead' ? 'warn' : 'danger') + '<span class="report-num">' + pct(c.residual) + '</span>' + (c.status === 'lead' ? '<em>open lead</em>' : c.rank < 2 ? '<em>prior only</em>' : '')) + '</td><td>' + esc(c.note) + (c.noCsi ? ' Searched without Wi-Fi.' : '') + '</td></tr>') } });

  // ----- 5 hazards and route -----
  push(h2('s5', '5', 'Hazards and the approved route', ''), { keep: true, brk: true });
  B.push({ table: { cls: 'report-table', head: '<th>Key</th><th>Hazard</th><th>Source</th><th class="report-r">Size</th><th>Effect on route planning</th><th>Route</th>',
    rows: R.hazards.map((h) => '<tr' + sel(h.sel) + '><td><b class="report-num">' + h.key + '</b></td><td>' + esc(h.name) + '</td><td class="report-nw">' + esc(h.src === 'Site survey' ? h.src : 'Mission') + (h.addedAt != null ? ', ' + clock(h.addedAt) : '') + '</td><td class="report-r report-num">' + h.area.toFixed(0) + ' m²</td><td>' + esc(h.effect) + '</td><td class="report-nw">' + (!R.route ? '<span class="report-mute">No route yet</span>' : h.avoided ? '<b>Steered around</b>' : '<span class="report-mute">Not in the way</span>') + '</td></tr>') } });
  const r = R.route;
  if (!r) push('<h3 class="report-h3">Rescue route</h3>' + empty(R.people.length ? 'No route has been planned yet. A route is planned once the leads have been checked, and a person must approve it before the team moves.' : 'No route yet: there is no one to plan a route to.'));
  else {
    push('<h3 class="report-h3">Rescue route</h3><dl class="report-form report-form-tight">' + cell('Status', '<b>' + esc(r.statusLabel) + '</b>', 2) + cell('Length', '<span class="report-num">' + r.length.toFixed(1) + ' m</span>') + cell('Time on foot, estimated', '<span class="report-num">' + clock(r.etaS) + '</span> at 1.1 m/s (assumed)') +
      cell('Planned at', time(r.plannedAt)) + cell('Approved at', time(r.approvedAt)) + cell('Approved by', r.approvedBy ? (r.auto ? 'Autoplay: the demo approved it itself. No person approved this route.' : esc(r.approvedBy)) : 'Not approved yet. The team does not move until a person approves.', 2) +
      cell('Steers around', r.avoided.length ? esc(r.avoided.join('; ')) : 'Nothing lay in the straight line to the people found', 4) + '</dl><p class="report-small" style="margin:0 0 10px">The order of legs is a planning aid, not a medical assessment: a still person is placed before a moving one, and unconfirmed leads last. The route is drawn on plan A.</p>', { keep: true });
    B.push({ table: { cls: 'report-table', head: '<th>Leg</th><th>To</th><th>Entry</th><th class="report-r">Length</th><th>Access point</th><th class="report-r">Short by</th><th class="report-r">Arrived</th>',
      rows: r.legs.map((l) => (l.ok ? '<tr' + sel(l.sel) + '><td class="report-num">' + l.n + '</td><td>' + esc(l.to) + '</td><td>' + (l.kind === 'break through' ? '<b>Break through</b>' : 'Walk in') + '</td><td class="report-r report-num">' + l.length.toFixed(1) + ' m</td><td class="report-num">' + l.access[0].toFixed(1) + ', ' + l.access[1].toFixed(1) + '</td><td class="report-r report-num">' + (l.gap ? l.gap.toFixed(1) + ' m' : '0') + '</td><td class="report-r">' + time(l.arrivedAt) + '</td></tr>'
        : '<tr' + sel(l.sel) + '><td class="report-num">' + l.n + '</td><td>' + esc(l.to) + '</td><td colspan="5"><b>No safe path.</b> ' + esc(l.reason || '') + '</td></tr>')) } });
  }

  // ----- B marking -----
  const M = markingData(S, R);
  push(h2('sB', 'B', 'Search marking for the block, INSARAG style', '') +
    '<div class="report-marking"><figure class="report-figure">' + markingSVG(M) + '</figure><div class="report-marking-note"><p><b>A simplified training rendering of the INSARAG worksite marking convention, generated from simulated data. It is not an official marking.</b></p>' +
    '<p>Search teams paint a marking like this beside the way in, so the next team can read at a glance who worked here, how far they got and what to watch for. Here the fields are filled from the mission log; the numbers point to the key below.</p>' +
    '<p>We follow the layout of the INSARAG Guidelines, Volume II, Manual B, as we understand it: details inside the box, hazards above, triage category below, one line through the marking when work is finished.</p>' +
    '<p>What we are not sure of: the exact box size, and the exact form of the victim marking (V, L, D). Editions before 2015 placed victim counts around the box instead. Check the current manual before any real use.</p></div></div>', { brk: true, keep: true });
  B.push({ table: { cls: 'report-table report-table-key', head: '<th></th><th>Field</th><th>Shows</th><th>Where it comes from</th>', rows: markingKey(M).map((k) => '<tr><td><b class="report-keyno">' + k[0] + '</b></td><td class="report-nw">' + esc(k[1]) + '</td><td><b>' + esc(k[2]) + '</b></td><td>' + esc(k[3]) + '</td></tr>') } });

  // ----- 6 timeline -----
  if (!R.timeline.length) push(h2('s6', '6', 'Timeline of key moments', '') + empty('Nothing has happened yet. The timeline starts when the exercise starts.'));
  else {
    push(h2('s6', '6', 'Timeline of key moments', 'Mission clock, minutes and seconds of simulated time. ' + R.omitted + ' routine ' + (R.omitted === 1 ? 'event is' : 'events are') + ' left out (listening stops, repeated windows, rooms found clear); the full log of ' + R.totalEvents + ' events is in the JSON export.'), { keep: true });
    B.push({ table: { cls: 'report-table report-table-time', head: '<th class="report-r">Time</th><th>Moment</th><th>What happened</th>',
      rows: R.timeline.map((e) => '<tr class="' + (e.code === 'PHASE' ? 'report-tl-phase' : '') + '"><td class="report-r report-num">' + clock(e.t) + '</td><td><span class="report-tl' + (e.tone ? ' report-tl-' + e.tone : '') + '">' + esc(e.kind) + '</span></td><td>' + esc(e.text) + '</td></tr>') } });
  }

  // ----- 7 faults -----
  if (!R.drills.length && !R.safety.length) push(h2('s7', '7', 'Faults that occurred and how they were handled', '') + empty('No faults occurred in this run. Use System check to run fault drills.'));
  else {
    push(h2('s7', '7', 'Faults that occurred and how they were handled', ''), { keep: true });
    if (R.drills.length) B.push({ table: { cls: 'report-table', head: '<th class="report-r">Began</th><th>Fault</th><th>Safe behaviour</th><th class="report-r">Cleared</th><th class="report-r">Lasted</th>',
      rows: R.drills.map((d) => '<tr><td class="report-r report-num">' + clock(d.at) + '</td><td><b>' + esc(d.label) + '</b></td><td>' + esc(d.does) + '</td><td class="report-r">' + (d.active ? '<b class="report-ink-danger">Still active</b>' : time(d.clearedAt)) + '</td><td class="report-r report-num">' + clock(d.duration) + (d.active ? ' so far' : '') + '</td></tr>') } });
    if (R.safety.length) { push('<h3 class="report-h3">Safety events</h3>', { keep: true }); B.push({ table: { cls: 'report-table report-table-time', head: '<th class="report-r">Time</th><th>Event</th><th>What the system did</th>', rows: R.safety.map((e) => '<tr><td class="report-r report-num">' + clock(e.t) + '</td><td>' + esc(e.kind) + '</td><td>' + esc(e.text) + '</td></tr>') } }); }
    push('<p class="report-small">Faults are injected on purpose from System check. They are drills on a simulated rover, not failures of real hardware.</p>');
  }

  // ----- 8 limits -----
  push(h2('s8', '8', 'Limits of the sensing', '') +
    '<div class="report-limits"><p class="report-limits-lead">Read this before acting on anything above. Every number here comes from simulation.</p>' +
    '<div class="report-limit-figs">' + R.limits.figures.map((f) => '<div><b class="report-num">' + esc(f.v) + '</b><span>' + esc(f.k) + '</span><em>' + esc(f.n) + '</em></div>').join('') + '</div></div>', { brk: true, keep: true });
  push('<ol class="report-limit-list">' + R.limits.points.map((p) => '<li><b>' + esc(p[0]) + '</b> ' + esc(p[1]) + '</li>').join('') + '</ol>' +
    '<p class="report-small">Wi-Fi network results are for the network alone, on 955 held-out simulated test windows. In this report the network\'s likelihood ratios are ×' + R.wifiLR.pos.toFixed(2) + ' for an alarm and ×' + R.wifiLR.neg.toFixed(2) + ' for no alarm.</p>');

  // ----- 9 approvals -----
  if (!R.decisions.length) push(h2('s9', '9', 'Who approved what', '') + empty('No decisions have been logged yet.'), { brk: true });
  else {
    push(h2('s9', '9', 'Who approved what', 'Every decision in the log, with who made it. Autoplay means the demo made the routine choice itself.'), { keep: true, brk: true });
    B.push({ table: { cls: 'report-table report-table-time', head: '<th class="report-r">Time</th><th>Decision</th><th>By</th>',
      rows: R.decisions.map((d) => '<tr class="' + (d.key ? 'report-dec-key' : '') + '"><td class="report-r report-num">' + clock(d.t) + '</td><td>' + (d.key ? '<b>' + esc(d.what) + '</b>' : esc(d.what)) + '</td><td>' + (d.auto ? '<span class="report-auto">' + esc(d.who) + '</span>' : '<b>' + esc(d.who) + '</b>') + '</td></tr>') } });
  }
  const sig = (role, name, t) => '<div class="report-sig"><span>' + role + '</span><div class="report-sig-line"><em>' + (name ? esc(name) : '') + '</em></div><small>Name</small><div class="report-sig-line"></div><small>Signature</small><div class="report-sig-line"><em class="report-num">' + (t || '') + '</em></div><small>Time</small></div>';
  push('<div class="report-sigs">' + (R.route?.auto ? '<p class="report-callout report-callout-warn"><b>The route in this report was approved by autoplay, not by a person.</b> In the demo the mission makes routine choices by itself. Before a team moves on a route, a named person must approve it and sign here.</p>' : '') +
    '<div class="report-sig-row">' + sig('Operator, handing over', m.operator, m.clock + ' mission clock') + sig('Rescue team leader, receiving', '', '') + sig('Safety officer', '', '') + '</div>' +
    '<p class="report-small">End of report ' + esc(m.docNo) + '. ' + esc(m.statusLine) + '. Simulated training exercise. Not a real incident.</p></div>');
  return B;
}

// ---------- pagination ----------
function sheetEl(R, first) {
  const el = document.createElement('article');
  el.className = 'report-paper report-sheet';
  el.innerHTML = '<header class="report-run"><span><b>HOUND Command</b> · Hand-over report · Block B, Timure exercise</span><span>' + esc(R.meta.partial ? 'Partial, ' + R.meta.phaseLabel.toLowerCase() : 'Final') + ' · <span class="report-num">' + R.meta.clock + '</span></span></header>' +
    '<div class="report-sheet-body"></div><footer class="report-foot"><span>Simulated training exercise. Not a real incident.</span><span class="report-num">' + esc(R.meta.docNo) + '</span><span class="report-num" data-fill="page"></span></footer>';
  if (first) el.classList.add('report-sheet-first');
  return el;
}
const tableHTML = (t, rows, cont) => '<div class="report-blk report-tablewrap"><table class="' + t.cls + '"><thead><tr>' + t.head + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>' + (cont ? '<p class="report-cont">Continued on the next page</p>' : '') + '</div>';
function frag(html) { const t = document.createElement('template'); t.innerHTML = html; return [...t.content.children]; }

// press: an off-screen element at exactly sheet width in which the sheets are measured.
export function paginate(blocks, R, press) {
  press.replaceChildren();
  const sheets = [];
  let sheet, body, held = [];
  const open = () => { sheet = sheetEl(R, !sheets.length); press.append(sheet); body = sheet.querySelector('.report-sheet-body'); sheets.push(sheet); };
  const over = () => body.scrollHeight > body.clientHeight + 1;
  open();
  const queue = blocks.slice();
  while (queue.length) {
    const b = queue.shift();
    if (b.brk && body.children.length) { open(); held = []; }
    if (b.table) {
      let rows = b.table.rows.slice();
      const els = frag(tableHTML(b.table, rows, false)); body.append(...els);
      if (over()) {
        const tb = els[0].querySelector('tbody'); let n = rows.length;
        while (n > 0 && over()) { tb.lastElementChild.remove(); n--; }
        const alone = body.children.length === els.length + held.length;
        if (n >= 2 || (alone && n >= 1)) {
          els[0].insertAdjacentHTML('beforeend', '<p class="report-cont">Continued on the next page</p>');
          while (n > 1 && over()) { tb.lastElementChild.remove(); n--; }
          queue.unshift({ table: { ...b.table, rows: rows.slice(n) }, brk: true });
        } else { // not worth splitting here: move the table, with the heading it belongs to, to a new sheet
          els.forEach((e) => e.remove()); const carry = held; carry.forEach((e) => e.remove());
          if (!body.children.length) { body.append(...carry, ...frag(tableHTML(b.table, rows, false))); }
          else { open(); body.append(...carry); queue.unshift({ ...b, brk: false }); }
        }
      }
      held = [];
      continue;
    }
    const els = frag(b.html); body.append(...els);
    if (over() && body.children.length > els.length + held.length) {
      els.forEach((e) => e.remove()); const carry = held; carry.forEach((e) => e.remove());
      open(); body.append(...carry, ...els);
    }
    held = b.keep ? [...held, ...els] : [];
  }
  // fill in what is only known after pagination: page numbers and the table of contents
  const N = sheets.length;
  sheets.forEach((s, i) => { s.dataset.page = i + 1; s.querySelector('[data-fill="page"]').textContent = 'Page ' + (i + 1) + ' of ' + N; });
  const pageOf = (id) => { const i = sheets.findIndex((s) => s.querySelector('[data-sec="' + id + '"]')); return i < 0 ? '' : i + 1; };
  return { sheets, pages: N, pageOf };
}
