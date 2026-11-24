// Counterfactual explanations for a lead: the smallest change in its evidence that would flip its status.
// Everything is recomputed with fuse() and classify() from app/core/fusion.js; no number here is invented.
//
// Idea from Wachter, Mittelstadt and Russell (2017): explain a decision by the closest world in which it would
// have gone the other way. Here the "model" is the console's Bayesian fusion and the "world" is the evidence list.
import { fuse, classify, LR, THRESHOLDS, PRIOR } from '../../core/fusion.js';

export const SAYS = {
  csi: { pos: 'the network says person', neg: 'the network says no one' },
  radar: { pos: 'radar sees a moving target', neg: 'radar sees no movement' },
  micro: { pos: 'radar sees breathing-sized motion', neg: 'radar sees no breathing-sized motion' },
  thermal: { pos: 'thermal sees a body-warm shape', faint: 'thermal sees a faint warm edge', neg: 'thermal sees no warm shape' },
  signature: { machine: 'the motion repeats like a machine' },
  temperature: { tooHot: 'far hotter than skin' },
  aerial: { pos: 'the drone image shows a person shape', neg: 'the drone image shows nothing' },
  acoustic: { pos: 'tapping or a voice is heard', neg: 'nothing is heard' },
  human: { pos: 'the rescue team confirms in person' },
};
const SHORT = { csi: 'Wi-Fi network', radar: 'Radar', micro: 'Breathing radar', thermal: 'Thermal', signature: 'Motion pattern', temperature: 'Temperature', aerial: 'Drone image', acoustic: 'Listening', human: 'Rescue team' };
export const sensorName = (s) => SHORT[s] || s;
// What it would take in the field for a new reading to come out this way. Plain words, no promises.
const TAKES = {
  'csi|pos': 'One more 10-second window in which the network output is above its alarm line. On the simulated test set that happens for 87 % of moving people and 21 % of still people.',
  'csi|neg': 'One more 10-second window in which the network stays below its alarm line (89 % of empty rooms on the simulated test set).',
  'radar|pos': 'The person moves while the LD2450 radar is watching, within about 6 m and one wall (assumed reach).',
  'radar|neg': 'The radar watches from a new spot and sees nothing move.',
  'micro|pos': 'The rover gets within about 4.5 m and the presence radar picks up small rhythmic motion (assumed reach).',
  'micro|neg': 'The presence radar is in reach and sees no small rhythmic motion.',
  'thermal|pos': 'A clear line of sight: thermal cannot see through walls, so the rover has to find an unobstructed view.',
  'thermal|faint': 'A partial view past furniture, enough for a warm edge.',
  'thermal|neg': 'A clear view of the spot, and nothing warm there.',
  'acoustic|pos': 'The person taps or calls out and a microphone hears it. HOUND has no microphone on the rover yet: this is a concept sensor.',
  'acoustic|neg': 'A listening period with no tapping or voice. A silent person is still possible.',
  'aerial|pos': 'The drone gets a second image with a person-shaped object at this spot. The drone is a concept.',
  'aerial|neg': 'A second drone pass shows nothing at this spot.',
  'human|pos': 'Someone goes and looks. This is the one reading that settles it, and the one that puts a person at risk.',
  'signature|machine': 'The motion turns out to repeat steadily, like a fan.',
  'temperature|tooHot': 'The warm spot measures far above skin temperature (28 to 37 °C).',
};
const ADDABLE = [['csi', 'pos'], ['csi', 'neg'], ['radar', 'pos'], ['radar', 'neg'], ['micro', 'pos'], ['micro', 'neg'], ['thermal', 'pos'], ['thermal', 'faint'], ['thermal', 'neg'], ['acoustic', 'pos'], ['acoustic', 'neg'], ['signature', 'machine'], ['temperature', 'tooHot'], ['human', 'pos']];
const COST = { add: 1, same: 1.2, flip: 1.6, remove: 2.2 };
const logit = (p) => Math.log(p / (1 - p));
const clockOf = (t) => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); };

export function judge(evidence, dismissed = false) {
  const f = fuse(evidence);
  return { p: f.p, odds: f.odds, steps: f.steps, cls: dismissed ? 'unlikely' : classify(f.p), fused: classify(f.p) };
}
export const CLS_WORD = { confirmed: 'confirmed', possible: 'possible', unlikely: 'closed' };

function applyOps(evidence, ops) {
  let ev = evidence.map((e) => ({ ...e }));
  const drop = new Set();
  for (const o of ops) {
    if (o.op === 'remove') drop.add(o.i);
    else if (o.op === 'flip') ev[o.i] = { ...ev[o.i], result: o.to, cf: true };
  }
  ev = ev.filter((_, i) => !drop.has(i));
  for (const o of ops) if (o.op === 'add') ev.push({ sensor: o.sensor, result: o.result, vantage: o.vantage, cf: true, t: null });
  return ev;
}
function describe(o, evidence) {
  if (o.op === 'add') {
    const same = o.vantage !== 'another position';
    return { text: 'One more reading' + (same ? ' from the same spot' : ' from a new position') + ': ' + SAYS[o.sensor][o.result] + '.', takes: (TAKES[o.sensor + '|' + o.result] || '') + (same ? ' From the same spot it counts at half weight (square root of its likelihood ratio), because it is not independent of the first.' : ''), lr: same ? Math.sqrt(LR[o.sensor][o.result]) : LR[o.sensor][o.result], assumed: LR[o.sensor].assumed };
  }
  const e = evidence[o.i], when = e.t != null ? clockOf(e.t) : '';
  if (o.op === 'remove') return { text: 'Without the ' + sensorName(e.sensor).toLowerCase() + ' reading at ' + when + ' (' + SAYS[e.sensor]?.[e.result] + ').', takes: 'That reading not being taken: the sensor out of reach, or switched off.', assumed: LR[e.sensor]?.assumed };
  let extra = '';
  if (e.sensor === 'csi' && e.score != null) extra = ' The network output was ' + e.score.toFixed(2) + '; ' + (o.to === 'pos' ? 'above' : 'at or below') + ' the alarm line it would read the other way.';
  return { text: 'If at ' + when + ' ' + SAYS[e.sensor][o.to] + ' instead of "' + SAYS[e.sensor][e.result] + '".', takes: 'The same reading coming out differently.' + extra, assumed: LR[e.sensor]?.assumed };
}

// evidence: the lead's evidence list (in order). Returns the present judgement and, for every other status, the
// smallest sets of changes that reach it.
export function counterfactuals(evidence, { dismissed = false, outdoor = false } = {}) {
  const now = judge(evidence, dismissed), singles = [];
  evidence.forEach((e, i) => {
    const table = LR[e.sensor]; if (!table || typeof table[e.result] !== 'number') return; // a blind reading carries no weight
    singles.push({ op: 'remove', i, cost: COST.remove });
    for (const k of Object.keys(table)) if (typeof table[k] === 'number' && k !== e.result && SAYS[e.sensor]?.[k]) singles.push({ op: 'flip', i, to: k, cost: COST.flip });
  });
  const lastVantage = [...evidence].reverse().find((e) => e.vantage && e.vantage !== 'team' && e.vantage !== 'aerial')?.vantage;
  for (const [sensor, result] of ADDABLE) {
    singles.push({ op: 'add', sensor, result, vantage: 'another position', cost: sensor === 'human' ? 3 : COST.add });
    if (lastVantage && ['csi', 'radar', 'micro', 'thermal'].includes(sensor) && evidence.some((e) => e.sensor === sensor && e.vantage === lastVantage)) singles.push({ op: 'add', sensor, result, vantage: lastVantage, cost: COST.same });
  }
  if (outdoor) for (const r of ['pos', 'neg']) singles.push({ op: 'add', sensor: 'aerial', result: r, vantage: 'another position', cost: COST.add });
  const tryOps = (ops) => { const j = judge(applyOps(evidence, ops), false); return { ops, p: j.p, cls: j.cls, steps: j.steps, cost: ops.reduce((s, o) => s + o.cost, 0), move: Math.abs(logit(Math.min(1 - 1e-9, Math.max(1e-9, j.p))) - logit(Math.min(1 - 1e-9, Math.max(1e-9, now.p)))) }; };
  const one = singles.map((o) => tryOps([o]));
  const targets = [];
  for (const cls of ['confirmed', 'possible', 'unlikely']) {
    if (cls === now.cls) continue;
    let found = one.filter((r) => r.cls === cls), size = 1;
    if (!found.length) {
      size = 2; found = [];
      for (let a = 0; a < singles.length; a++) for (let b = a + 1; b < singles.length; b++) {
        const A = singles[a], B = singles[b];
        if (A.i != null && A.i === B.i) continue;
        if (A.op === 'add' && B.op === 'add' && A.sensor === B.sensor && A.vantage === B.vantage) continue;
        const r = tryOps([A, B]); if (r.cls === cls) found.push(r);
      }
    }
    found.sort((x, y) => x.cost - y.cost || x.move - y.move);
    // keep the cheapest of each distinct kind so the list is not five versions of the same idea
    const seen = new Set(), list = [];
    for (const r of found) {
      const sig = r.ops.map((o) => o.op + (o.sensor || evidence[o.i].sensor)).sort().join('+');
      if (seen.has(sig)) continue; seen.add(sig);
      list.push({ ...r, parts: r.ops.map((o) => describe(o, evidence)) });
      if (list.length >= 4) break;
    }
    // Other ways to get there without touching the evidence: move the line, or start from a different prior.
    const line = cls === 'confirmed' ? { name: 'confirm line', from: THRESHOLDS.confirmed, to: now.p, dir: 'down to' } : cls === 'unlikely' ? { name: 'lead-open line', from: THRESHOLDS.possible, to: now.p, dir: 'up above' } : now.cls === 'confirmed' ? { name: 'confirm line', from: THRESHOLDS.confirmed, to: now.p, dir: 'up above' } : { name: 'lead-open line', from: THRESHOLDS.possible, to: now.p, dir: 'down to' };
    const need = cls === 'confirmed' ? THRESHOLDS.confirmed : cls === 'unlikely' ? THRESHOLDS.possible : now.cls === 'confirmed' ? THRESHOLDS.confirmed : THRESHOLDS.possible;
    const factor = (need / (1 - need)) / now.odds; // the evidence needed, as one likelihood ratio
    const pr = (PRIOR / (1 - PRIOR)) * factor, prior = pr / (1 + pr);
    targets.push({ cls, size, list, none: !list.length, line, factor, prior, dismissedOnly: dismissed && now.fused === cls });
  }
  return { now, targets, prior: PRIOR, thresholds: { ...THRESHOLDS } };
}
export { LR, THRESHOLDS, PRIOR };
