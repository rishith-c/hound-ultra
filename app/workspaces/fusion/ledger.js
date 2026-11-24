// The evidence ledger: a waterfall from the prior to the final probability, one bar per reading, with what-if.
// The maths is the same as app/core/fusion.js (odds form of Bayes' rule). It is recomputed here so that readings can
// be left out and likelihood ratios changed; with nothing changed it must equal the mission's own number, and the
// panel checks that.
import { LR, PRIOR, THRESHOLDS, lrOf, classify, fuse } from '../../core/fusion.js';
import { logit, sigmoid, clamp, pct, fmtLR, signed, STATUS, whereOf } from './util.js';

const L0 = logit(0.013), L1 = logit(0.9972);
const X = (lo) => clamp((lo - L0) / (L1 - L0), 0, 1) * 100;
const TICKS = [0.05, 0.15, 0.5, 0.85, 0.99];
const LO_TICKS = [-4, -2, 0, 2, 4];
const SHORT = { csi: 'Wi-Fi network', radar: 'Radar, moving target', micro: 'Radar, stillness', thermal: 'Thermal camera', signature: 'Motion pattern', temperature: 'Temperature check', aerial: 'Drone image', acoustic: 'Tapping or voice', human: 'Rescue team on site' };
const ICON = { csi: 'wifi', radar: 'signals', micro: 'signals', thermal: 'heat', temperature: 'heat', signature: 'bolt', aerial: 'drone', acoustic: 'mic', human: 'person' };

const EXAMPLE = [
  { sensor: 'csi', result: 'pos', vantage: 'A', note: 'Network output 0.83 (alarm above 0.53)' },
  { sensor: 'radar', result: 'pos', vantage: 'A', note: 'Moving target 4.2 m away' },
  { sensor: 'thermal', result: 'blind', vantage: 'A', note: 'Thermal cannot see through the wall' },
  { sensor: 'csi', result: 'pos', vantage: 'A', note: 'Second 10-second window: network output 0.97' },
];

const WHY = {
  'csi|pos': 'Measured on the 955 simulated test windows: the network says "person" for 326 of 685 person windows (47.6 %) and for 30 of 270 empty ones (11.1 %). 47.6 ÷ 11.1 = ×4.29.',
  'csi|neg': 'Measured on the 955 simulated test windows: the network stays quiet for 52.4 % of person windows and 88.9 % of empty ones. 52.4 ÷ 88.9 = ×0.59. A quiet network is weak evidence, because it misses most still people.',
  'csi|blind': 'Counts for nothing (×1). The Wi-Fi reading was not usable here, and the network never guesses.',
  'radar|pos': 'Assumed design value ×6: a tracked moving target is taken to be six times more likely when a person is there. The radar has not been characterised yet.',
  'radar|neg': 'Assumed ×0.7: no moving target lowers the chance a little. It cannot do more, because a still person would not show either.',
  'radar|none': 'Counts for nothing (×1): a person lying still gives the tracking radar no moving target, so its silence says nothing here.',
  'micro|pos': 'Assumed ×3: small rhythmic motion in one range gate is what breathing looks like, but other slow movement can do the same.',
  'micro|neg': 'Assumed ×0.8: no breathing-sized motion. Weak, because the presence radar only reaches about 4.5 m (assumed).',
  'thermal|pos': 'Assumed ×8: a warm shape in clear view. The strongest single reading, but it needs a line of sight.',
  'thermal|faint': 'Assumed ×3: a warm edge partly hidden by furniture.',
  'thermal|neg': 'Assumed ×0.5: the camera had a clear view and saw no warm shape.',
  'thermal|blind': 'Counts for nothing (×1): the thermal camera could not see this spot, and fusion says so instead of guessing.',
  'signature|machine': 'Assumed ×0.3: motion that repeats this steadily looks like a machine, not a person.',
  'temperature|tooHot': 'Assumed ×0.1: far hotter than skin (28 to 37 °C), so the heat is not a body.',
  'aerial|pos': 'Assumed ×6: the drone image detector marked a person-shaped object. The drone is a concept and this detection is simulated.',
  'aerial|neg': 'Assumed ×0.9: nothing person-shaped in the drone image. Weak, because rubble hides people from above.',
  'acoustic|pos': 'Assumed ×7: tapping or a voice was heard.',
  'acoustic|neg': 'Assumed ×0.9: nothing heard. Weak, because a hurt person may be silent.',
  'human|pos': 'Assumed ×200: a rescuer on site saw the person. In this exercise the team is simulated.',
};
const whereWord = (v) => (!v ? '' : v === 'aerial' ? 'drone' : v === 'team' ? 'team' : v);

export function createLedger(host, ctx, api) {
  const { h, icon, fmt, realityTag } = ctx.kit;
  const wi = { off: new Map(), lr: new Map(), prior: null }; // what-if: readings left out (per lead), changed ratios, changed prior
  let model = null, builtKey = '', lastSig = '', leadSig = '', active = null, sticky = false, drag = null, isDirty = true;

  // ---- DOM ----
  const leads = h('div.fusion-leads', { role: 'group', 'aria-label': 'Leads' });
  const subjectEl = h('div.fusion-subject');
  const axis = h('div.fusion-row.fusion-axis', { 'aria-hidden': 'true' }, h('span'), h('span.dim', null, 'Reading'), h('span.dim.fusion-r', null, 'Weight'),
    h('div.fusion-chart.fusion-axis-chart', null,
      ...TICKS.map((p) => h('span.fusion-tick' + (p === THRESHOLDS.possible || p === THRESHOLDS.confirmed ? '.is-th' : ''), { style: { left: X(logit(p)) + '%' } }, (p * 100) + ' %')),
      h('span.fusion-zone', { style: { left: '0', width: X(logit(THRESHOLDS.possible)) + '%' } }, 'closed'),
      h('span.fusion-zone.z-possible', { style: { left: X(logit(THRESHOLDS.possible)) + '%', width: X(logit(THRESHOLDS.confirmed)) - X(logit(THRESHOLDS.possible)) + '%' } }, 'possible, stays open'),
      h('span.fusion-zone.z-confirmed', { style: { left: X(logit(THRESHOLDS.confirmed)) + '%', right: '0' } }, 'confirmed')),
    h('span.dim.fusion-r', null, 'Chance'));
  const rowsEl = h('div.fusion-rows');
  const loAxis = h('div.fusion-row.fusion-loaxis', { 'aria-hidden': 'true' }, h('span'), h('span.dim', null, 'The same scale in log-odds'), h('span'),
    h('div.fusion-chart.fusion-axis-chart', null, ...LO_TICKS.map((v) => h('span.fusion-tick', { style: { left: X(v) + '%' } }, (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v)))), h('span'));
  const RESULT_WORD = { pos: 'positive', neg: 'nothing', faint: 'faint', machine: 'machine-like', tooHot: 'too hot' };
  const WORDS = { 'csi|pos': 'says person', 'csi|neg': 'stays quiet', 'radar|pos': 'target', 'radar|neg': 'no target', 'micro|pos': 'rhythmic motion', 'micro|neg': 'none', 'thermal|pos': 'warm shape', 'thermal|faint': 'faint edge', 'thermal|neg': 'clear view, nothing', 'aerial|pos': 'person shape', 'aerial|neg': 'nothing', 'acoustic|pos': 'heard', 'acoustic|neg': 'silence', 'human|pos': 'seen in person', 'signature|machine': 'machine-like', 'temperature|tooHot': 'too hot for skin' };
  const weightsEl = h('div.fusion-weights');
  function paintWeights() {
    weightsEl.replaceChildren(h('div.fusion-weights-head', null, h('b', null, 'Every weight fusion can use'), h('span.dim', null, 'How much more likely a reading is with a person than without. Only the Wi-Fi network’s are measured.')),
      h('div.fusion-weights-grid', null, ...Object.entries(LR).map(([s, t]) => h('div.fusion-weight' + (t.assumed ? '' : '.is-measured'), null,
        h('span.fusion-weight-name', null, icon(ICON[s] || 'info', 13), SHORT[s] || t.label, h('em', null, t.assumed ? 'assumed' : 'measured')),
        h('span.fusion-weight-vals.num', null, ...Object.entries(t).filter(([, v]) => typeof v === 'number').map(([r, v]) => { const o = wi.lr.get(s + '|' + r); return h('span' + (o != null ? '.is-mod' : ''), { title: WHY[s + '|' + r] || '' }, h('i', null, WORDS[s + '|' + r] || RESULT_WORD[r] || r), ' ', fmtLR(o ?? v)); }))))));
  }
  const scroll = h('div.fusion-ledger-scroll', null, axis, rowsEl, loAxis, weightsEl);
  scroll.style.setProperty('--x15', X(logit(THRESHOLDS.possible)) + '%');
  scroll.style.setProperty('--x85', X(logit(THRESHOLDS.confirmed)) + '%');
  const bigP = h('b.num.fusion-big'), bigTag = h('span.tag'), bigSub = h('span.fusion-big-sub.num');
  const verdictLine = h('p.fusion-verdict-line'), whatIfLine = h('p.fusion-whatif');
  const resetBtn = h('button.btn.btn-sm', { type: 'button', title: 'Back to the mission values', onclick: () => { wi.lr.clear(); wi.prior = null; if (model) wi.off.delete(model.key); isDirty = true; } }, icon('reset'), 'Reset');
  const banner = h('div.fusion-banner', { hidden: true, role: 'status' }, h('span.tag.tag-accent', null, 'What-if'), whatIfLine, resetBtn);
  const explainTitle = h('b'), explainBody = h('p'), explainMove = h('p.fusion-explain-move.num');
  const verdict = h('footer.fusion-verdict', null,
    h('div.fusion-verdict-main', null, h('div.fusion-big-row', null, bigP, h('div.col', { style: { gap: '4px' } }, bigTag, bigSub)), verdictLine),
    h('div.fusion-explain', { 'aria-live': 'polite' }, explainTitle, explainBody, explainMove),
    h('div.fusion-why15', null, h('b', null, 'Why a lead stays open down to 15 %'),
      h('p', null, 'Closing a lead at 15 % would still leave a real person behind about one time in seven. A second look costs minutes; a missed person costs far more. So closing needs less than 15 %, confirming needs 85 %, and everything between gets a second look or a team check.')));
  const hint = h('span.dim.fusion-hint', null, 'Untick a reading to leave it out. Drag the end of a bar to change its weight.');
  const panel = ctx.kit.panel('Evidence ledger', { flush: true, actions: [hint] }, leads, subjectEl, scroll, banner, verdict);
  panel.classList.add('fusion-ledger');
  host.append(panel);

  // ---- the model ----
  function roomEvidence(cov) {
    if (!cov || !cov.reach || cov.status === 'blocked' || cov.status === 'unsearched') return [];
    const pNeg = (cov.residual - (1 - cov.reach) * PRIOR) / cov.reach, v = cov.stop, t = cov.t;
    const base = [{ sensor: 'radar', result: 'neg', vantage: v, t, note: 'No moving target in this room' }, { sensor: 'micro', result: 'neg', vantage: v, t, note: 'No breathing-sized motion' }];
    const options = [
      [{ sensor: 'csi', result: 'neg', vantage: v, t, note: 'The network heard no one from this stop' }, ...base],
      [{ sensor: 'csi', result: 'pos', vantage: v, t, note: 'The network raised an alarm that nothing else supported' }, ...base],
      [{ sensor: 'csi', result: 'blind', vantage: v, t, note: cov.noCsi ? 'No usable Wi-Fi window at this stop' : 'The Wi-Fi alarm at this stop is explained by a lead in another room, so it is not counted here' }, ...base],
    ];
    let best = options[0], err = Infinity;
    for (const o of options) { const e = Math.abs(fuse(o).p - pNeg); if (e < err) { err = e; best = o; } }
    return best;
  }
  const lrKey = (ev) => ev.sensor + '|' + ev.result;
  function compute(ev, { off, lr, prior }) {
    let lo = logit(prior ?? PRIOR);
    const lo0 = lo, seen = new Map(), rows = [];
    ev.forEach((e, i) => {
      const base = lrOf(e), raw = lr?.get(lrKey(e)) ?? base, on = !off?.has(i), fixed = typeof LR[e.sensor]?.[e.result] !== 'number';
      let repeat = 0, eff = 1;
      if (on) { const k = e.sensor + '|' + (e.vantage || ''); repeat = seen.get(k) || 0; seen.set(k, repeat + 1); eff = repeat ? Math.sqrt(raw) : raw; }
      const from = lo; lo += Math.log(eff);
      rows.push({ ev: e, i, on, base, raw, eff, repeat, fixed, from, to: lo, p: sigmoid(lo), assumed: LR[e.sensor]?.assumed ?? true });
    });
    return { rows, lo0, lo, p: sigmoid(lo), prior: prior ?? PRIOR };
  }
  function build(sub) {
    const ev = sub.type === 'detection' ? sub.det.evidence : sub.type === 'room' ? roomEvidence(sub.cov) : EXAMPLE;
    const off = wi.off.get(sub.key);
    const base = compute(ev, {}), cur = compute(ev, { off, lr: wi.lr, prior: wi.prior });
    const blend = (m) => (sub.type === 'room' ? (sub.cov.reach || 0) * m.p + (1 - (sub.cov.reach || 0)) * m.prior : m.p);
    const changed = !!(off?.size || wi.lr.size || wi.prior != null);
    const truthP = sub.type === 'detection' ? sub.det.p : sub.type === 'room' ? sub.cov.residual : base.p;
    return { key: sub.key, sub, ev, base, cur, finalBase: blend(base), final: blend(cur), changed, matches: Math.abs(blend(base) - truthP) < 1e-6 };
  }

  // ---- rows ----
  function rowEl(kind, i) {
    const tog = kind === 'ev' ? h('label.fusion-tog.check', null, h('input', { type: 'checkbox', checked: true, 'data-i': i })) : h('span');
    const bar = h('i.fusion-bar'), conn = h('i.fusion-conn'), ghost = h('i.fusion-ghost'), delta = h('span.fusion-delta.num');
    const handle = kind === 'result' || kind === 'blend' ? null : h('button.fusion-handle', { type: 'button', role: 'slider', 'data-i': i, 'data-kind': kind });
    const mark = kind === 'result' ? h('i.fusion-mark') : null, markBase = kind === 'result' ? h('i.fusion-mark.is-base') : null;
    const el = h('div.fusion-row.fusion-' + kind, { 'data-i': i, 'data-kind': kind },
      tog, h('div.fusion-what', null, h('div.fusion-ev-top'), h('div.fusion-ev-note')), h('div.fusion-lr.num'),
      h('div.fusion-chart', null, ghost, conn, bar, delta, handle, markBase, mark), h('div.fusion-after.num'));
    el._ = { tog: tog.querySelector?.('input'), top: el.querySelector('.fusion-ev-top'), note: el.querySelector('.fusion-ev-note'), lr: el.querySelector('.fusion-lr'), bar, conn, ghost, delta, handle, mark, markBase, after: el.querySelector('.fusion-after') };
    return el;
  }
  function rebuild() {
    const m = model, kids = [rowEl('prior', -1)];
    m.ev.forEach((e, i) => kids.push(rowEl('ev', i)));
    if (m.sub.type === 'room') kids.push(rowEl('blend', -2));
    kids.push(rowEl('result', -3));
    rowsEl.replaceChildren(...kids);
    // static text
    const pr = kids[0]._;
    pr.top.replaceChildren(h('b', null, 'Before any reading'), h('span.tag.tag-sim.plain', { title: 'A design assumption: one room in ten holds a person.' }, 'assumed'));
    pr.note.textContent = 'The prior: the chance a room holds a person before the rover listens.';
    m.ev.forEach((e, i) => {
      const r = kids[i + 1]._, assumed = LR[e.sensor]?.assumed ?? true;
      r.top.replaceChildren(icon(ICON[e.sensor] || 'info', 14), h('b', null, SHORT[e.sensor] || LR[e.sensor]?.label || e.sensor),
        assumed ? h('span.tag.tag-sim.plain', { title: 'A design value, not a measurement. This sensor has not been characterised yet.' }, 'assumed')
          : h('span.tag.tag-ok.plain', { title: 'From the network’s test on 955 held-out simulated windows.' }, 'measured'));
      r.note.replaceChildren(h('span.fusion-ev-where.num', null, [whereWord(e.vantage), e.t != null ? fmt.clock(e.t) : ''].filter(Boolean).join(' ')), e.note || '');
      r.tog.setAttribute('aria-label', 'Count this reading: ' + (SHORT[e.sensor] || LR[e.sensor]?.label || e.sensor) + ', ' + (e.note || ''));
    });
    if (m.sub.type === 'room') {
      const b = kids[kids.length - 2]._;
      b.top.replaceChildren(icon('layers', 14), h('b', null, 'Sensor reach'), h('span.tag.tag-ok.plain', { title: 'Computed from the floor plan: the share of the room within Wi-Fi range through at most one wall.' }, 'computed'));
    }
    kids[kids.length - 1]._.top.replaceChildren(h('b', null, m.sub.type === 'room' ? 'Chance someone was missed' : 'Result'));
    builtKey = m.key + '#' + m.ev.length;
    if (!sticky || active == null || active >= m.ev.length) { sticky = false; active = biggest(m.cur); }
  }
  function biggest(c) { let best = null, mag = 0; for (const r of c.rows) { const d = Math.abs(r.to - r.from); if (r.on && d > mag) { mag = d; best = r.i; } } return best; }

  function place(r, from, to, on) {
    const a = X(from), b = X(to), moved = Math.abs(to - from) > 1e-9;
    r.bar.style.left = Math.min(a, b) + '%'; r.bar.style.width = Math.abs(b - a) + '%';
    r.bar.className = 'fusion-bar ' + (!on ? 'is-off' : !moved ? 'is-zero' : to > from ? 'is-up' : 'is-down');
    r.conn.style.left = b + '%';
    r.delta.textContent = !on ? 'left out' : moved ? signed(to - from) : 'no change';
    const right = to >= from, edge = right ? b : Math.min(a, b);
    const flip = right ? b > 80 : edge < 16;
    r.delta.style.left = (right !== flip ? Math.max(a, b) : Math.min(a, b)) + '%';
    r.delta.className = 'fusion-delta num ' + (right !== flip ? 'at-right' : 'at-left') + (on && moved ? '' : ' is-quiet');
    if (r.handle) r.handle.style.left = b + '%';
  }
  function patch() {
    const m = model, kids = rowsEl.children, c = m.cur, b0 = m.base;
    // prior
    const pr = kids[0]._;
    place(pr, L0, c.lo0, true); pr.delta.textContent = ''; pr.bar.className = 'fusion-bar is-prior';
    pr.lr.textContent = ''; pr.after.textContent = pct(c.prior);
    pr.ghost.hidden = wi.prior == null; pr.ghost.style.left = X(b0.lo0) + '%';
    kids[0].classList.toggle('is-mod', wi.prior != null);
    slider(pr.handle, 'The prior chance, in percent', Math.round(c.prior * 100), 1, 60, pct(c.prior));
    c.rows.forEach((r, i) => {
      const el = kids[i + 1], d = el._, base = b0.rows[i], mod = wi.lr.has(lrKey(r.ev));
      d.tog.checked = r.on;
      el.classList.toggle('is-off', !r.on); el.classList.toggle('is-mod', mod && r.on); el.classList.toggle('is-active', active === i); el.classList.toggle('is-fixed', r.fixed);
      d.lr.replaceChildren(...[h('span', null, r.on ? fmtLR(r.eff) : '·'), r.on && r.repeat ? h('small', { title: 'A repeat reading from the same place counts at half weight: the square root of ' + fmtLR(r.raw) + '. Assumed.' }, '½ weight') : mod && r.on ? h('small.is-mod', null, 'what-if') : null].filter(Boolean));
      place(d, r.from, r.to, r.on);
      d.ghost.hidden = !(r.on && Math.abs(base.to - r.to) > 1e-6); d.ghost.style.left = X(base.to) + '%';
      d.after.textContent = pct(r.p);
      if (d.handle) { d.handle.hidden = !r.on || r.fixed; slider(d.handle, 'Weight of this reading, as a likelihood ratio', +r.raw.toFixed(2), 0.02, 500, fmtLR(r.raw)); }
    });
    let n = c.rows.length + 1;
    if (m.sub.type === 'room') {
      const el = kids[n++], d = el._, reach = m.sub.cov.reach || 0;
      d.note.textContent = 'The sensors reached ' + (reach * 100).toFixed(0) + ' % of the room. The rest stays at the prior, ' + pct(c.prior) + '.';
      d.lr.textContent = (reach * 100).toFixed(0) + ' %';
      place(d, c.lo, logit(m.final), true); d.bar.className = 'fusion-bar is-blend'; d.after.textContent = pct(m.final);
      d.ghost.hidden = true;
    }
    const res = kids[n]._;
    res.bar.hidden = true; res.conn.hidden = true; res.delta.hidden = true; res.ghost.hidden = true;
    res.mark.style.left = X(logit(m.final)) + '%'; res.markBase.style.left = X(logit(m.finalBase)) + '%'; res.markBase.hidden = !m.changed || Math.abs(m.final - m.finalBase) < 1e-6;
    res.after.textContent = pct(m.final);
    const cls = classify(m.final);
    kids[n].dataset.cls = m.sub.type === 'room' ? 'room' : cls;
    res.note.textContent = m.sub.type === 'room' ? 'After the search, with what the sensors could and could not reach.' : 'log-odds ' + signed(logit(m.final)) + ', from ' + signed(c.lo0) + ' at the start';
    paintVerdict();
  }
  function slider(el, label, now, min, max, text) { el.setAttribute('aria-label', label); el.setAttribute('aria-valuenow', now); el.setAttribute('aria-valuemin', min); el.setAttribute('aria-valuemax', max); el.setAttribute('aria-valuetext', text); }

  function paintVerdict() {
    const m = model, sub = m.sub, cls = classify(m.final), baseCls = classify(m.finalBase);
    { const s = pct(m.final); bigP.replaceChildren(s.replace(' %', ''), h('small', null, '%')); }
    const room = sub.type === 'room';
    const st = STATUS[cls];
    bigTag.className = 'tag ' + (room ? (sub.cov.status === 'clear' ? 'tag-ok' : '') : st.tag); bigTag.textContent = room ? (sub.cov.status === 'clear' ? 'No lead' : sub.cov.status === 'blocked' ? 'Not searched' : 'Not searched yet') : st.label;
    bigP.dataset.cls = room ? 'room' : cls;
    bigSub.textContent = room ? 'chance missed' : 'log-odds ' + signed(logit(m.final));
    verdictLine.textContent = room
      ? (sub.cov.note || '') + (m.ev.length ? '' : ' Nothing was measured here, so the number is the prior (assumed).')
      : cls === 'confirmed' ? 'At or above 85 %: confirmed. Independent readings agree, and a team can be sent.'
        : cls === 'possible' ? 'Between 15 % and 85 %: possible. The lead stays open for a second look or a team check.'
          : 'Below 15 %: closed. The readings point away from a person.';
    if (sub.type === 'detection' && sub.det.dismissed) verdictLine.textContent += ' This lead was dismissed by the operator.';
    banner.hidden = !m.changed;
    if (m.changed) {
      whatIfLine.replaceChildren(h('span', null, (sub.type === 'example' ? 'Example value ' : 'Mission value ') + pct(m.finalBase) + (room ? '' : ' (' + STATUS[baseCls].label.toLowerCase() + ')')), ' becomes ', h('b', null, pct(m.final) + (room ? '' : ' (' + st.label.toLowerCase() + ')')),
        !room && cls !== baseCls ? ' The decision changes.' : !room ? ' The decision holds.' : '');
    }
    // the reading in focus
    const r = active != null ? m.cur.rows[active] : null;
    if (!r) {
      explainTitle.textContent = m.ev.length ? 'Point at a reading to see why it counts as it does' : 'No readings yet';
      explainBody.textContent = m.ev.length ? '' : 'This number is only the prior.'; explainMove.textContent = '';
    } else {
      explainTitle.textContent = (SHORT[r.ev.sensor] || r.ev.sensor) + (active === biggest(m.cur) ? ': the reading that moved the answer the most' : '');
      let why = WHY[lrKey(r.ev)] || (r.base === 1 ? 'Counts for nothing (×1).' : 'Assumed design value ' + fmtLR(r.base) + '.');
      if (r.repeat) why += ' This is a repeat from the same place, so it counts at half weight (√' + fmtLR(r.raw).slice(1) + ' = ' + fmtLR(r.eff) + '): two looks from one spot are not independent. Assumed.';
      if (wi.lr.has(lrKey(r.ev))) why += ' What-if: the weight is set to ' + fmtLR(r.raw) + ' instead of ' + fmtLR(r.base) + '.';
      explainBody.textContent = why;
      explainMove.textContent = r.on ? (Math.abs(r.to - r.from) < 1e-9 ? 'It left the answer where it was, at ' + pct(r.p) + '.' : 'It moved the answer from ' + pct(sigmoid(r.from)) + ' to ' + pct(r.p) + ' (' + signed(r.to - r.from) + ' log-odds).') : 'Left out of the sum.';
    }
  }

  function paintSubject() {
    const m = model, sub = m.sub;
    if (sub.type === 'detection') {
      const d = sub.det, st = STATUS[d.status] || STATUS.new;
      subjectEl.replaceChildren(h('b', null, 'Lead ' + d.id), h('span', null, whereOf(d) + (d.room ? ', ' + (ctx.world.roomById(d.room)?.name || '') : '')),
        h('span.tag ' + st.tag, null, st.label + (d.kind && d.status === 'rejected' ? ': ' + d.kind : '')), h('span.dim', null, 'first seen ' + fmt.clock(d.t) + ', ' + d.evidence.length + ' readings'),
        h('span.grow'), m.matches ? h('span.fusion-check', { title: 'Recomputed here from the readings; equal to the number the mission is using.' }, icon('check', 13), 'matches the mission') : h('span.fusion-check.is-bad', null, icon('alert', 13), 'differs from the mission value'));
    } else if (sub.type === 'room') {
      subjectEl.replaceChildren(h('b', null, sub.room.name), h('span.tag' + (sub.cov.status === 'clear' ? '.tag-ok' : ''), null, sub.cov.status === 'clear' ? 'Searched, no lead' : sub.cov.status === 'blocked' ? 'Blocked' : 'Not searched'),
        h('span.dim', null, sub.cov.stop ? 'searched from stop ' + sub.cov.stop + ' at ' + fmt.clock(sub.cov.t) : 'no reading'), h('span.grow'),
        m.matches ? h('span.fusion-check', { title: 'Rebuilt from the coverage record; equal to the number the mission is using.' }, icon('check', 13), 'matches the mission') : '');
    } else {
      subjectEl.replaceChildren(h('b', null, 'Worked example'), h('span.tag.tag-sim', null, 'Not a mission reading'), h('span.dim', null, 'No lead yet. Try the what-if on this example; the ledger follows the first real lead.'));
    }
  }
  function paintLeads(S) {
    const sig = S.detections.map((d) => d.id + d.status + d.p.toFixed(3)).join(',') + '|' + model.key + '|' + api.following;
    if (sig === leadSig) return; leadSig = sig;
    const btns = S.detections.map((d) => {
      const st = STATUS[d.status] || STATUS.new, on = model.sub.type === 'detection' && model.sub.det.id === d.id;
      return h('button.fusion-lead', { type: 'button', 'aria-pressed': String(on), 'data-st': d.status, title: st.label + ', ' + whereOf(d) + (d.reason ? '. ' + d.reason : ''), onclick: () => api.pick({ type: 'detection', id: d.id }) },
        h('i'), h('b', null, d.id), h('span', null, d.room ? d.room : d.outdoor ? 'outdoors' : 'stop'), h('span.num', null, pct(d.p)), h('span.sr-only', null, st.label));
    });
    leads.replaceChildren(h('div.fusion-leads-list', null, h('span.dim', null, S.detections.length ? 'Leads' : 'No leads yet'), ...btns),
      h('button.btn.btn-sm' + (api.following ? '.is-on' : ''), { type: 'button', 'aria-pressed': String(api.following), title: 'Always show the lead that changed most recently', onclick: () => { api.follow(); isDirty = true; } }, icon('eye'), 'Follow latest'));
  }

  // ---- what-if interaction ----
  rowsEl.addEventListener('change', (e) => {
    const i = e.target.dataset?.i; if (i == null || !model) return;
    let off = wi.off.get(model.key); if (!off) wi.off.set(model.key, (off = new Set()));
    if (e.target.checked) off.delete(+i); else off.add(+i);
    if (!off.size) wi.off.delete(model.key);
    isDirty = true;
  });
  function setFromLo(kind, i, lo) {
    if (kind === 'prior') { const p = clamp(sigmoid(lo), 0.01, 0.6); wi.prior = Math.abs(p - PRIOR) < 0.004 ? null : p; }
    else {
      const r = model.cur.rows[i]; if (!r || r.fixed) return;
      let raw = Math.exp(lo - r.from); if (r.repeat) raw *= raw;
      raw = clamp(raw, 0.02, 500);
      if (Math.abs(Math.log(raw / r.base)) < 0.04) wi.lr.delete(lrKey(r.ev)); else wi.lr.set(lrKey(r.ev), raw);
    }
    isDirty = true;
  }
  rowsEl.addEventListener('pointerdown', (e) => {
    const hd = e.target.closest('.fusion-handle'); if (!hd) return;
    e.preventDefault(); hd.setPointerCapture(e.pointerId); hd.focus();
    drag = { hd, kind: hd.dataset.kind, i: +hd.dataset.i, rect: hd.parentElement.getBoundingClientRect() };
    sticky = true; if (drag.kind === 'ev') active = drag.i;
    rowsEl.classList.add('is-dragging');
  });
  rowsEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const f = clamp((e.clientX - drag.rect.left) / drag.rect.width, 0, 1);
    setFromLo(drag.kind, drag.i, L0 + f * (L1 - L0));
  });
  const endDrag = () => { drag = null; rowsEl.classList.remove('is-dragging'); };
  rowsEl.addEventListener('pointerup', endDrag); rowsEl.addEventListener('pointercancel', endDrag);
  rowsEl.addEventListener('dblclick', (e) => {
    const hd = e.target.closest('.fusion-handle'); if (!hd || !model) return;
    if (hd.dataset.kind === 'prior') wi.prior = null; else { const r = model.cur.rows[+hd.dataset.i]; if (r) wi.lr.delete(lrKey(r.ev)); }
    isDirty = true;
  });
  rowsEl.addEventListener('keydown', (e) => {
    const hd = e.target.closest?.('.fusion-handle'); if (!hd || !model) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    const kind = hd.dataset.kind, i = +hd.dataset.i;
    if (e.key === 'Home' || e.key === 'Delete' || e.key === 'Backspace') { if (kind === 'prior') wi.prior = null; else wi.lr.delete(lrKey(model.cur.rows[i].ev)); isDirty = true; e.preventDefault(); return; }
    if (!step) return;
    e.preventDefault();
    const d = step * (e.shiftKey ? 0.5 : 0.1);
    if (kind === 'prior') setFromLo('prior', -1, model.cur.lo0 + d);
    else { const r = model.cur.rows[i]; setFromLo('ev', i, r.to + (r.repeat ? d / 2 : d)); sticky = true; active = i; }
  });
  const focusRow = (e) => {
    const el = e.target.closest?.('.fusion-row');
    if (!el || el.dataset.kind !== 'ev' || drag) return;
    if (e.type === 'click') { sticky = true; active = +el.dataset.i; isDirty = true; }
    else if (!sticky || e.type === 'focusin') { active = +el.dataset.i; isDirty = true; }
  };
  rowsEl.addEventListener('mouseover', focusRow); rowsEl.addEventListener('focusin', focusRow); rowsEl.addEventListener('click', focusRow);
  rowsEl.addEventListener('mouseleave', () => { if (!sticky && model) { active = biggest(model.cur); isDirty = true; } });

  return {
    dirty() { isDirty = true; },
    reset() { wi.off.clear(); sticky = false; active = null; },
    frame(S) {
      if (!isDirty) return; isDirty = false;
      const sub = api.subject();
      const prevKey = model?.key;
      model = build(sub);
      if (prevKey !== model.key) { sticky = false; active = null; }
      if (builtKey !== model.key + '#' + model.ev.length) rebuild();
      const sig = [model.key, model.ev.length, model.final, model.finalBase, active, sub.det?.status, sub.cov?.status, wi.lr.size, wi.prior, [...(wi.off.get(model.key) || [])].join('.'), [...wi.lr.values()].join('.')].join('|');
      paintLeads(S);
      if (sig === lastSig) return; lastSig = sig;
      paintSubject(); patch(); paintWeights();
    },
  };
}
