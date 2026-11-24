// How each tool's result is drawn in the conversation. Every renderer reads the tool's FACTS (never the model's
// words), so what you see here is exactly what the answer was built from.
import { floorPlan, siteMap } from './maps.js';
import { sitrepLines, SITREP_CAVEAT, groundCheck, formatCall } from './tools.js';

const STATUS_CLS = { confirmed: 'person', possible: 'warn', rejected: 'off' };
const cap = (x) => String(x).charAt(0).toUpperCase() + String(x).slice(1);
const PHASES = ['Ready', 'Drone survey', 'Rover deploying', 'Searching', 'Checking leads', 'Planning rescue', 'Rescue team moving', 'Mission complete'];

export function makeRenderers(ctx, { run }) {
  const { h, icon } = ctx.kit;
  const pickLead = (id) => () => ctx.select({ type: 'detection', id });
  const meter = (pctv, cls, marks = [15, 85]) => h('span.cop-track', { role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pctv, 'aria-label': 'Confidence ' + pctv + ' percent' }, h('i.' + cls, { style: { width: pctv + '%' } }), marks.map((m) => h('em', { style: { left: m + '%' } })));

  const R = {
    get_mission_status(f) {
      const now = f.phase === 'All stop' ? -1 : PHASES.indexOf(f.phase), rover = f.units.find((u) => u.id === 'HOUND-01');
      return h('div.cop-status', null,
        h('div.cop-phases', { role: 'img', 'aria-label': 'Phase ' + (now + 1) + ' of 8: ' + f.phase }, PHASES.map((p, i) => h('i' + (i < now ? '.done' : i === now ? '.now' : ''), { title: p }))),
        h('div.cop-phase-line', null, h('b', null, f.phase), h('span.num.dim', null, f.clock + ' · ' + f.speed + (f.clock_running ? '' : ' · paused') + (f.autoplay ? ' · autoplay' : ' · manual'))),
        h('div.cop-cells', null,
          cell(f.people_found, 'people found', f.people_found ? 'person' : ''), cell(f.leads_open, 'open leads', f.leads_open ? 'warn' : ''),
          cell(f.rooms_clear + '/' + f.rooms_total, 'rooms clear', ''), cell(rover.battery_pct + '%', 'rover battery', rover.battery_pct <= 15 ? 'danger' : ''), cell(rover.link_pct + '%', 'radio link', rover.link_pct <= 10 ? 'danger' : '')),
        h('ul.cop-units', null, f.units.map((u) => h('li', null, icon(u.id === 'HOUND-01' ? 'rover' : u.id === 'DRONE-01' ? 'drone' : 'team', 14), h('button.cop-link', { onclick: () => ctx.select({ type: 'unit', id: u.id }) }, u.name), h('span.dim', null, u.state + ' · ' + u.at), u.note ? h('span.tag.tag-sim', null, u.note.startsWith('concept') ? 'Concept' : 'Simulated') : null))),
        f.faults_active.length ? h('div.note.danger', null, icon('alert'), h('span', null, 'Fault active: ' + f.faults_active.join(', ') + '.')) : null);
    },
    list_leads(f) {
      if (!f.leads.length) return null;
      return h('ul.cop-leads', null, f.leads.map((l) => h('li', null, h('button', { onclick: pickLead(l.id), title: 'Select ' + l.id + ' in every view' },
        h('span.status.' + STATUS_CLS[l.status], null, l.id), h('span.cop-lead-what', null, h('b', null, l.status === 'rejected' ? 'Closed: ' + l.what : cap(l.what)), h('span.dim', null, l.where + (l.sensors.length ? ' · ' + l.sensors.join(', ') : '') + (l.assigned_to ? ' · team check' : ''))),
        meter(l.confidence_pct, STATUS_CLS[l.status]), h('span.num', null, l.confidence_pct + ' %')))));
    },
    explain_lead(f) {
      const cls = (p) => (p >= f.confirm_at_pct ? 'person' : p >= f.keep_open_above_pct ? 'warn' : 'off');
      const row = (label, said, factor, p, assumed, note) => h('div.cop-wf-row', { title: note || '' },
        h('span.cop-wf-label', null, h('b', null, label), said ? h('span.dim', null, said) : null),
        h('span.num.cop-wf-factor' + (factor == null ? '' : factor > 1.05 ? '.up' : factor < 0.95 ? '.down' : ''), null, factor == null ? '' : '×' + (factor >= 10 ? factor.toFixed(0) : factor.toFixed(2)), factor != null && assumed ? h('sup', { title: 'Design value' }, 'a') : null),
        meter(p, cls(p), [f.keep_open_above_pct, f.confirm_at_pct]), h('span.num', null, p + ' %'));
      return h('div.cop-wf', null,
        h('div.cop-wf-head', null, h('span', null, 'Reading'), h('span', null, 'Factor'), h('span.cop-wf-scale', null, h('em', { style: { left: f.keep_open_above_pct + '%' } }, 'keep open'), h('em', { style: { left: f.confirm_at_pct + '%' } }, 'confirm')), h('span', null, 'Chance')),
        row('Before any reading', 'prior', null, f.start_pct, true, 'A design value: a 10 % chance that a given room holds a person.'),
        f.steps.map((s) => row(s.sensor, s.at + ' · ' + s.said + (s.repeat_reading ? ' · repeat, half weight' : ''), s.factor, s.after_pct, s.source === 'assumed', s.note)),
        h('p.cop-foot', null, h('sup', null, 'a'), ' design value. The Wi-Fi network factor is measured, on simulated test windows.'));
    },
    list_rooms_not_searched(f) {
      return h('div.cop-rooms', null, floorPlan(ctx, { onPick: (sel) => ctx.select(sel) }),
        h('div.legend', null, h('span', null, h('i', { style: '--c: var(--ok)' }), 'Clear, with the chance someone was missed'), h('span', null, h('i', { style: '--c: var(--warn)' }), 'Possible person'), h('span', null, h('i', { style: '--c: var(--person)' }), 'Person'), h('span', null, h('i.hollow', { style: '--c: var(--text-3)' }), 'Not searched (unknown)')));
    },
    plan_route(f) {
      return h('div.cop-route-box', null, siteMap(ctx),
        h('div.cop-route-side', null,
          h('div.cop-cells.two', null, cell(f.length_m + ' m', 'on foot', ''), cell('≈' + f.eta_min + ' min', 'walking time', '')),
          h('ol.cop-stops', null, f.stops.map((s) => h('li', null, s.unreachable ? [h('b', null, s.lead), h('span.c-danger', null, 'cannot be reached: ' + s.unreachable)] : [h('button.cop-link', { onclick: pickLead(s.lead) }, s.lead), h('span', null, s.where), h('span.tag.plain' + (s.access === 'break through' ? '.tag-warn' : ''), null, s.access + (s.wall_gap_m ? ' · ' + s.wall_gap_m + ' m of wall' : ''))]))),
          f.stays_out_of.length ? h('p.cop-foot', null, 'Stays out of: ' + f.stays_out_of.join('; ') + '.') : null,
          f.may_cross.length ? h('div.note.warn', null, icon('alert'), h('span', null, 'Allowed to cross: ' + f.may_cross.join(', ') + '.')) : null));
    },
    approve_route(f) { return R.plan_route(f); },
    write_sitrep(f) { return sitrepBlock(f); },
  };
  function cell(value, label, tone) { return h('div.cop-cell', null, h('b.num' + (tone ? '.c-' + tone : ''), null, String(value)), h('span', null, label)); }

  // The situation report: each line written by code from the facts; every number can be checked against them.
  function sitrepBlock(f, prose) {
    const lines = sitrepLines(f);
    return h('div.cop-sitrep', null,
      h('dl.cop-sit-lines', null, lines.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      h('p.cop-foot', null, SITREP_CAVEAT),
      prose?.text ? h('div.cop-prose' + (prose.rejected ? '.rejected' : ''), null, h('p', null, markNumbers(prose.text, f)), h('p.cop-foot', null, prose.pending ? 'The model is writing…' : prose.rejected ? 'Rejected: the model wrote ' + prose.grounding.unknown.map((u) => '“' + u + '”').join(', ') + ', which is not in the facts. Use the lines above.' : 'Worded by ' + prose.by + ' on this computer. Its ' + prose.grounding.checked + ' numbers and ids appear in the facts, but a small model can still misread them: the lines above are the record.')) : null);
  }
  function markNumbers(text, facts) {
    const bad = new Set(groundCheck(text, facts).unknown), out = []; let last = 0;
    for (const m of String(text).matchAll(/\b(?:[DVS]\d{1,2}|HOUND-01|DRONE-01|TEAM-1|\d{1,3}:\d{2}|\d+(?:\.\d+)?)\b/g)) { out.push(text.slice(last, m.index), h('span.' + (bad.has(m[0]) ? 'cop-num-bad' : 'cop-num-ok'), { title: bad.has(m[0]) ? 'Not in the facts' : 'Matches the facts' }, m[0])); last = m.index + m[0].length; }
    out.push(text.slice(last)); return out;
  }
  // Facts as a small tree, for the "facts" disclosure and the sitrep panel.
  function factTree(v, depth = 0) {
    if (v == null) return h('span.dim', null, 'none');
    if (Array.isArray(v)) return v.length ? (v.every((x) => typeof x !== 'object') ? h('span', null, v.join(', ')) : h('ol.cop-tree', null, v.map((x) => h('li', null, factTree(x, depth + 1))))) : h('span.dim', null, 'none');
    if (typeof v === 'object') return h('dl.cop-tree', null, Object.entries(v).filter(([k]) => k !== 'key' && k !== 'result').map(([k, x]) => [h('dt', null, k.replace(/_/g, ' ')), h('dd', null, factTree(x, depth + 1))]));
    return h('span' + (typeof v === 'number' ? '.num' : ''), null, String(v));
  }
  function result(x) {
    const f = x.result?.facts; if (!f) return null;
    const fn = R[x.call.tool]; let body = null;
    try { body = fn ? fn(f) : null; } catch (e) { console.error('[copilot] renderer failed', e); }
    const facts = h('details.cop-facts', null, h('summary', null, 'Facts this answer is built from'), factTree(f));
    return h('div.cop-result', null, body, facts);
  }
  return { result, sitrepBlock, factTree, formatCall, run };
}
