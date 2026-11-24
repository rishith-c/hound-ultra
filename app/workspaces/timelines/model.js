// Timelines: what a branch is, how a decision becomes engine commands, how two worlds are compared.
// No DOM here. Everything is computed from results returned by runner.js.
import { PHASES, PHASE_INFO, FAULTS } from '../../core/sim.js';
import { MODES, STATUS } from './runner.js';

export const clock = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60); return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); };
export const span = (s) => { const a = Math.abs(s); return a < 60 ? Math.round(a) + ' s' : Math.floor(a / 60) + ':' + String(Math.round(a % 60)).padStart(2, '0'); };
export const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

// ---------- reading a run at a moment ----------
export function phases(run) {
  const f = run.frames, ev = run.events.filter((e) => e.code === 'PHASE'), out = [];
  let k = 0, cur = f.phase[0], t0 = 0;
  for (let i = 1; i < f.n; i++) if (f.phase[i] !== cur) {
    const t = ev[k] ? ev[k].t : i; k++;
    out.push({ phase: PHASES[cur], t0, t1: t }); cur = f.phase[i]; t0 = t;
  }
  out.push({ phase: PHASES[cur], t0, t1: run.endT });
  return out;
}
export const phaseStart = (run, phase) => phases(run).find((p) => p.phase === phase)?.t0 ?? null;

const lerp = (a, b, u) => a + (b - a) * u;
const lerpAng = (a, b, u) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * u; };
export function stateAt(run, t) {
  const f = run.frames; t = Math.max(0, Math.min(run.endT, t));
  const i = Math.min(f.n - 1, Math.floor(t)), j = Math.min(f.n - 1, i + 1), u = j === i ? 0 : Math.min(1, t - i);
  const k = u > 0.5 ? j : i;
  const P = (arr, w, o) => lerp(arr[i * w + o], arr[j * w + o], u);
  const dets = [];
  f.dets.forEach((d, n) => {
    const a = k - d.i0; if (a < 0 || d.st[a] === 0) return;
    const fin = run.detections[n];
    dets.push({ id: d.id, p: d.p[a], status: STATUS[d.st[a]], pos: [d.x[a], d.y[a]], sigma: d.sig[a], nEv: d.nEv[a], needsTeam: !!d.team[a], room: fin.room, outdoor: fin.outdoor, stop: fin.stop, final: fin });
  });
  let route = null; for (const r of run.routeLog) { if (r.t <= t + 0.5) route = r.status === 'none' ? null : r; else break; }
  const cov = {}; for (const c of run.covLog) { if (c.t <= t + 0.5) cov[c.room] = c; else break; }
  const reached = Object.values(run.survivors).filter((s) => s.reachedAt != null && s.reachedAt <= t).map((s) => s.detId);
  return {
    t, i: k, phase: PHASES[f.phase[k]], hold: !!f.hold[k], faults: Object.keys(FAULTS).filter((id, b) => f.faults[k] & (1 << b)),
    rover: { pos: [P(f.rover, 5, 0), P(f.rover, 5, 1)], heading: lerpAng(f.rover[i * 5 + 2], f.rover[j * 5 + 2], u), battery: f.rover[k * 5 + 3], link: f.rover[k * 5 + 4], mode: MODES[f.mode[k]] },
    drone: { pos: [P(f.drone, 3, 0), P(f.drone, 3, 1)], alt: P(f.drone, 3, 2) }, team: { pos: [P(f.team, 3, 0), P(f.team, 3, 1)], heading: f.team[k * 3 + 2] },
    scan: f.scan[k], listen: f.listen[k], dets, route, cov, reached, hazards: run.hazards.filter((h) => h.t <= t),
  };
}
// People located over time, for the river: [reached, confirmed, possible] per frame.
export function river(run) {
  const f = run.frames, n = f.n, out = new Uint8Array(n * 3), sv = Object.values(run.survivors);
  for (let i = 0; i < n; i++) {
    let c = 0, p = 0; const t = i === n - 1 ? run.endT : i;
    for (const d of f.dets) { const a = i - d.i0; if (a < 0) continue; if (d.st[a] === 2) c++; else if (d.st[a] === 1) p++; }
    const r = sv.filter((s) => s.reachedAt != null && s.reachedAt <= t + 1e-6).length;
    out[i * 3] = r; out[i * 3 + 1] = Math.max(0, c - r); out[i * 3 + 2] = p;
  }
  return out;
}

// ---------- decisions ----------
// A decision is plain data. toActs() turns it into engine commands with times, given the branch it forks from.
export const HAZARD_PRESETS = [
  { id: 'corridor', name: 'Second slide: new debris in the corridor', short: 'the corridor', c: [60, 44], size: 4 },
  { id: 'hall', name: 'Ceiling down in the entrance hall', short: 'the entrance hall', c: [64, 36], size: 4 },
  { id: 'door103', name: 'Debris across the door of room 103', short: 'the door of room 103', c: [70.6, 42.6], size: 3 },
  { id: 'yard', name: 'Mud flow across the yard south of the entrance', short: 'the yard', c: [64, 24], size: 8 },
];
export const squarePoly = (c, s) => [[c[0] - s / 2, c[1] - s / 2], [c[0] + s / 2, c[1] - s / 2], [c[0] + s / 2, c[1] + s / 2], [c[0] - s / 2, c[1] + s / 2]];
export const HAZARD_KINDS = { slope: 'the unstable slope', mud: 'the deep mud', gas: 'the gas leak area', collapse: 'the collapse-risk zone' };
const durWord = (d) => (d == null ? 'for the rest of the mission' : 'for ' + (d < 60 ? d + ' s' : d / 60 + ' min'));

// Returns { ok, why } and, when ok, { forkT, acts, opts, label, detail }.
export function resolve(dec, parentRun, T) {
  const ph = phases(parentRun), at = (name) => ph.find((p) => p.phase === name);
  const now = stateAt(parentRun, T), id = 'a' + Math.random().toString(36).slice(2, 8);
  const no = (why) => ({ ok: false, why });
  const yes = (o) => ({ ok: true, opts: {}, ...o, acts: (o.acts || []).map((a) => ({ id, ...a })) });
  if (T >= parentRun.endT - 0.05 && dec.kind !== 'reroll') return no('This branch has already ended at this moment. Move the cursor earlier.');
  switch (dec.kind) {
    case 'skipSecondLook': {
      const a = at('assess'); if (!a) return no('This branch never reaches the lead-checking step.');
      if (T > a.t1) return no('The second looks are already over at ' + clock(T) + '. Move the cursor to ' + clock(a.t0) + ' or earlier.');
      const t = Math.max(T, a.t0);
      return yes({ forkT: t, label: T > a.t0 ? 'Stop checking leads' : 'Skip the second look', detail: 'At ' + clock(t) + ' the operator stops checking leads and plans the rescue with what is already confirmed. Leads still marked "possible" stay off the route.', acts: [{ t, cmds: [{ name: 'finishAssess' }] }] });
    }
    case 'onlyCheck': {
      const a = at('assess'); if (!a) return no('This branch never reaches the lead-checking step.');
      if (T > a.t0 + 0.05) return no('Choose this before the lead-checking step starts (' + clock(a.t0) + ').');
      const d = stateAt(parentRun, a.t0 + 0.2).dets.find((x) => x.id === dec.det);
      if (!d || d.status !== 'possible') return no('Lead ' + dec.det + ' is not an open lead when the search ends.');
      return yes({ forkT: a.t0, label: 'Second look at ' + dec.det + ' only', detail: 'At ' + clock(a.t0) + ' the rover is sent to check ' + leadName(d) + ' and nothing else; then the rescue is planned.', acts: [{ t: a.t0, cmds: [{ name: 'investigate', args: { id: dec.det } }, { name: 'finishAssess' }] }] });
    }
    case 'dismiss': {
      const d = now.dets.find((x) => x.id === dec.det);
      if (!d || d.status !== 'possible') return no(dec.det ? 'Lead ' + dec.det + ' is not open at ' + clock(T) + '. Only a "possible" lead can be dismissed.' : 'There is no open lead at this moment.');
      return yes({ forkT: T, label: 'Dismiss lead ' + d.id + ' (' + leadWhere(d) + ')', detail: 'At ' + clock(T) + ' the operator dismisses ' + leadName(d) + ' at ' + (d.p * 100).toFixed(0) + ' %. It is closed and will not be checked or visited.', acts: [{ t: T, cmds: [{ name: 'dismiss', args: { id: d.id } }] }] });
    }
    case 'route': {
      const a = at('plan'); if (!a) return no('This branch never reaches route planning.');
      if (T > a.t0 + 0.05) return no('The route is already planned at ' + clock(T) + '. Move the cursor to ' + clock(a.t0) + ' or earlier.');
      const acc = Object.keys(HAZARD_KINDS).filter((k) => dec.avoid && dec.avoid[k] === false);
      const args = {}; if (dec.avoid) args.avoid = dec.avoid; if (dec.order && dec.order.length) args.order = dec.order;
      const what = [acc.length === 4 ? 'accept every hazard' : acc.length ? 'accept ' + acc.map((k) => HAZARD_KINDS[k]).join(' and ') : '', dec.order && dec.order.length ? 'visit ' + dec.order.join(' → ') : ''].filter(Boolean);
      if (!what.length) return no('Change something about the route: accept a hazard or change the visiting order.');
      return yes({ forkT: a.t0, label: 'Route: ' + what.join(', '), detail: 'At ' + clock(a.t0) + ' the operator asks for a different rescue route: ' + what.join('; ') + '. The planner (A* on a 0.5 m grid) plans it; the route is then approved as usual.', acts: [{ t: a.t0, cmds: [{ name: 'planRoute', args }] }] });
    }
    case 'fault': {
      const f = FAULTS[dec.id]; if (!f) return no('Choose a fault.');
      const cmds = [{ name: 'injectFault', args: { id: dec.id } }]; if (dec.dur != null) cmds.push({ name: 'clearFault', args: { id: dec.id }, after: dec.dur });
      return yes({ forkT: T, label: f.label + ' ' + durWord(dec.dur), detail: 'At ' + clock(T) + ': ' + f.label.toLowerCase() + ', ' + durWord(dec.dur) + '. ' + f.does, acts: [{ t: T, cmds }] });
    }
    case 'hazard': {
      const poly = squarePoly(dec.c, dec.size || 4), name = dec.name || 'New debris';
      return yes({ forkT: T, label: 'New hazard: ' + (dec.short || 'placed on the map'), detail: 'At ' + clock(T) + ' a ' + (dec.size || 4) + ' m block of debris comes down at ' + dec.c[0].toFixed(0) + ', ' + dec.c[1].toFixed(0) + ' m. Nothing can cross it; every route in use is planned again.', acts: [{ t: T, cmds: [{ name: 'newHazard', args: { poly, name, block: true } }] }] });
    }
    case 'hold':
      return yes({ forkT: T, label: 'All stop for ' + span(dec.dur), detail: 'At ' + clock(T) + ' the operator stops every unit for ' + span(dec.dur) + ', then resumes.', acts: [{ t: T, cmds: [{ name: 'allStop' }, { name: 'resume', after: dec.dur }] }] });
    case 'params': {
      const q = dec.params, w = [];
      if (q.confirmed != null) w.push('confirm line at ' + (q.confirmed * 100).toFixed(0) + ' %');
      if (q.possible != null) w.push('lead-open line at ' + (q.possible * 100).toFixed(0) + ' %');
      if (q.csiThreshold != null) w.push('Wi-Fi alarm line at ' + q.csiThreshold.toFixed(2));
      if (q.maxWindows != null) w.push(plural(q.maxWindows, 'listening window') + ' per stop');
      if (!w.length) return no('Move at least one setting away from the value in use.');
      const lab = w.join(', ');
      return yes({ forkT: T, label: lab[0].toUpperCase() + lab.slice(1), detail: 'From ' + clock(T) + ' on the console uses: ' + lab + '. Readings taken before that moment keep the judgement they were given.', acts: [{ t: T, params: q }] });
    }
    case 'reroll':
      return yes({ forkT: 0, label: 'Re-roll the Wi-Fi windows (seed ' + dec.seed + ')', detail: 'The same building and people, but each listening stop plays a random simulated Wi-Fi window of the right kind instead of the scripted one, and sensor noise is drawn from seed ' + dec.seed + '. Noise is drawn from the first reading on, so this branch forks at 00:00.', opts: { windows: 'random', seed: dec.seed }, acts: [] });
    default: return no('Unknown decision.');
  }
}
export const leadWhere = (d) => (d.room ? 'room ' + d.room : d.outdoor ? 'outdoors' : 'at stop ' + d.stop);
export const leadName = (d) => 'lead ' + d.id + ' (' + leadWhere(d) + ')';

// ---------- comparing outcomes ----------
// Order of importance, most important first. No weights: a later item only breaks ties in the earlier ones.
export function rank(run, useTruth) {
  const m = run.metrics, tr = run.truth;
  const time = Math.round(m.lastReachedAt ?? m.endT);
  return useTruth
    ? [m.done ? 0 : 1, tr.missed, tr.falseConfirmed, tr.falseChased, Math.round(m.hazardM), time]
    : [m.done ? 0 : 1, -m.reached, m.open, -m.bySensors, Math.round(m.hazardM), time];
}
export const RANK_WORDS = {
  truth: ['finishes', 'people not reached', 'false confirmations', 'false leads chased', 'metres walked inside hazards', 'time until the last person is reached'],
  console: ['finishes', 'people reached', 'leads left unchecked', 'people confirmed by sensors before the team moves', 'metres walked inside hazards', 'time until the last person is reached'],
};
export function cmpRank(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }
export function impact(run, base, useTruth) { const a = rank(run, useTruth), b = rank(base, useTruth); return a.map((v, i) => Math.abs(v - b[i])); }
export function cmpImpact(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i]; return 0; }

// What changed against a baseline, in plain words. Most important first.
export function deltaWords(run, base, useTruth) {
  const m = run.metrics, b = base.metrics, out = [], add = (text, good) => out.push({ text, good });
  if (!m.done && b.done) add('the mission does not finish', false);
  const dr = m.reached - b.reached; if (dr) add((dr > 0 ? plural(dr, 'more person', 'more people') : plural(-dr, 'fewer person', 'fewer people')) + ' reached', dr > 0);
  if (useTruth) {
    const df = run.truth.falseConfirmed - base.truth.falseConfirmed; if (df) add(plural(Math.abs(df), 'false confirmation') + (df > 0 ? ' more' : ' fewer'), df < 0);
    const dc = run.truth.falseChased - base.truth.falseChased; if (dc) add(plural(Math.abs(dc), 'false lead') + ' chased ' + (dc > 0 ? 'more' : 'less'), dc < 0);
  }
  const dopen = m.open - b.open; if (dopen) add(plural(Math.abs(dopen), 'lead') + (dopen > 0 ? ' more left unchecked' : ' fewer left unchecked'), dopen < 0);
  const ds = m.bySensors - b.bySensors; if (ds) add(plural(Math.abs(ds), 'person', 'people') + (ds > 0 ? ' more' : ' fewer') + ' confirmed by sensors alone', ds > 0);
  const dh = m.hazardM - b.hazardM; if (Math.abs(dh) >= 1) add(Math.abs(dh).toFixed(0) + ' m ' + (dh > 0 ? 'more' : 'less') + ' inside hazards', dh < 0);
  const ta = m.lastReachedAt, tb = b.lastReachedAt;
  if (ta != null && tb != null && m.reached === b.reached && Math.abs(ta - tb) >= 1) add('last person reached ' + span(ta - tb) + (ta > tb ? ' later' : ' sooner'), ta < tb);
  const dl = m.routeLen - b.routeLen; if (Math.abs(dl) >= 1) add('rescue route ' + Math.abs(dl).toFixed(0) + ' m ' + (dl > 0 ? 'longer' : 'shorter'), null);
  const dt = m.endT - b.endT; if (Math.abs(dt) >= 1) add('mission ' + span(dt) + (dt > 0 ? ' longer' : ' shorter'), null);
  return out;
}

// ---------- the difference between two worlds ----------
function keyed(events) {
  const seen = new Map(), out = [];
  for (const e of events) {
    const base = e.code === 'PHASE' ? 'PHASE|' + e.text.split('.')[0] : [e.code, e.det || '', e.room || '', e.stop || '', e.fault || '', e.hazard || ''].join('|');
    const n = (seen.get(base) || 0) + 1; seen.set(base, n); out.push({ key: base + '#' + n, e });
  }
  return out;
}
export function diffRuns(a, b) {
  const ka = keyed(a.events), kb = new Map(keyed(b.events).map((x) => [x.key, x.e])), rows = [], used = new Set();
  for (const { key, e } of ka) {
    const o = kb.get(key);
    if (!o) { rows.push({ kind: 'onlyA', t: e.t, a: e }); continue; }
    used.add(key);
    const dt = e.t - o.t;
    if (e.text !== o.text) rows.push({ kind: 'changed', t: Math.min(e.t, o.t), a: e, b: o, dt });
    else if (Math.abs(dt) > 0.05) rows.push({ kind: 'shifted', t: Math.min(e.t, o.t), a: e, b: o, dt });
  }
  for (const [key, e] of kb) if (!used.has(key)) rows.push({ kind: 'onlyB', t: e.t, b: e });
  rows.sort((x, y) => x.t - y.t);
  // Leads whose final judgement differs.
  const leads = [];
  const ids = new Set([...a.detections.map((d) => d.id), ...b.detections.map((d) => d.id)]);
  for (const id of ids) {
    const da = a.detections.find((d) => d.id === id), db = b.detections.find((d) => d.id === id);
    if (!da || !db || da.status !== db.status || Math.abs(da.p - db.p) > 0.005 || da.room !== db.room) leads.push({ id, a: da || null, b: db || null });
  }
  // The first moment the two worlds are not the same, from the per-second record (positions and beliefs).
  let first = rows.length ? rows[0].t : null;
  const fa = a.frames, fb = b.frames, n = Math.min(fa.n, fb.n);
  for (let i = 0; i < n; i++) {
    let diff = fa.phase[i] !== fb.phase[i] || fa.hold[i] !== fb.hold[i] || fa.faults[i] !== fb.faults[i];
    for (let k = 0; k < 2 && !diff; k++) diff = Math.abs(fa.rover[i * 5 + k] - fb.rover[i * 5 + k]) > 1e-4 || Math.abs(fa.team[i * 3 + k] - fb.team[i * 3 + k]) > 1e-4;
    if (diff) { if (first == null || i < first) first = i; break; }
  }
  if (first == null && fa.n !== fb.n) first = Math.min(a.endT, b.endT);
  return { rows, leads, first, identical: !rows.length && !leads.length && first == null };
}
export { PHASE_INFO, PHASES, FAULTS };
