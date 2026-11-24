// Timelines: the branch runner. No DOM. Runs in a Web Worker (worker.js) or, as a fallback, on the page.
//
// A branch is described by a plain "spec": the live mission's command log up to the fork, then the changed
// decision ("acts": commands with times, or new parameter values). runSpec() builds a fresh engine from
// app/core/sim.js, replays the log, applies the acts and runs the mission to its end. Same spec, same result:
// digest() turns a mission state into a short fingerprint so that claim can be checked on screen.
import { createEngine, PHASES } from '../../core/sim.js';
import { TRUTH, HAZARDS } from '../../core/world.js';
import { THRESHOLDS, LR } from '../../core/fusion.js';
import { pointInPoly, dist } from '../../core/geometry.js';

export const MODES = ['idle', 'drive', 'listen', 'hold', 'fault', 'swap', 'takeoff', 'scan', 'return', 'landed'];
export const STATUS = ['new', 'possible', 'confirmed', 'rejected'];
const FAULT_IDS = ['linkLoss', 'csiDropout', 'badWindow', 'thermalFail', 'lowBattery'];

// ---------- fingerprint ----------
function fnv(str, h) { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function digest(S) {
  const parts = [S.t.toFixed(1), S.phase];
  for (const e of S.events) parts.push(e.id, e.t.toFixed(1), e.code, e.text);
  for (const d of S.detections) parts.push(d.id, d.status, d.p.toFixed(9), d.evidence.length, d.pos ? d.pos[0].toFixed(6) + ',' + d.pos[1].toFixed(6) : '-');
  for (const u of Object.values(S.units)) parts.push(u.id, u.pos[0].toFixed(6), u.pos[1].toFixed(6), u.mode);
  const s = parts.join('|');
  return fnv(s, 2166136261).toString(16).padStart(8, '0') + fnv(s, 3339675911).toString(16).padStart(8, '0');
}

// ---------- the engine with one constant opened up ----------
// The number of listening windows per stop is a literal in sim.js (maxWindows = 2). To sweep it without editing a
// file this workspace does not own, the worker loads the same source text, rewrites that one default to read a
// variable, and imports the result. Nothing else changes; the sweep panel proves it by comparing fingerprints.
let patched = null;
export function loadPatchedEngine() {
  return (patched ||= (async () => {
    const url = new URL('../../core/sim.js', import.meta.url);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not read the simulator source (' + res.status + ').');
    let src = await res.text();
    const hits = src.split('maxWindows = 2').length - 1;
    if (hits !== 1) throw new Error('The simulator source has changed: expected one "maxWindows = 2", found ' + hits + '.');
    src = src.replace('maxWindows = 2', 'maxWindows = (globalThis.__TL_MAXW ?? 2)');
    src = src.replace(/from\s+'(\.\/[^']+)'/g, (m, rel) => "from '" + new URL(rel, url).href + "'");
    const blob = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    try { return (await import(blob)).createEngine; } finally { URL.revokeObjectURL(blob); }
  })());
}

// ---------- measuring a finished (or stopped) mission ----------
function hazardMetres(S) {
  const r = S.routes.rescue, out = new Map();
  if (!r) return { total: 0, list: [] };
  const all = [...HAZARDS, ...S.hazards];
  for (const leg of r.legs) {
    if (!leg.ok) continue;
    for (let i = 1; i < leg.path.length; i++) {
      const a = leg.path[i - 1], b = leg.path[i], L = dist(a, b), n = Math.max(1, Math.round(L / 0.25));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        for (const hz of all) if (pointInPoly(p, hz.poly)) out.set(hz.id, (out.get(hz.id) || 0) + L / n);
      }
    }
  }
  const list = [...out].map(([id, m]) => ({ id, name: all.find((h) => h.id === id).name, kind: all.find((h) => h.id === id).kind, m }));
  return { total: list.reduce((s, x) => s + x.m, 0), list };
}

export function measure(e, done) {
  const S = e.state, r = S.routes.rescue;
  const byTeam = (d) => d.evidence.some((x) => x.sensor === 'human');
  const svs = Object.values(S.survivors);
  const reachedT = svs.filter((s) => s.reachedAt != null).map((s) => s.reachedAt);
  const hz = hazardMetres(S);
  let expectedMissed = 0, unsearched = 0;
  for (const c of Object.values(S.coverage)) { if (c.status !== 'person') expectedMissed += c.residual; if (c.status === 'blocked' || c.status === 'unsearched') unsearched++; }
  const walked = r && (r.status === 'approved' || r.status === 'done');
  return {
    done, endT: S.t,
    reached: reachedT.length, firstReachedAt: reachedT.length ? Math.min(...reachedT) : null, lastReachedAt: reachedT.length ? Math.max(...reachedT) : null,
    bySensors: S.detections.filter((d) => d.status === 'confirmed' && !byTeam(d)).length,
    byTeam: S.detections.filter((d) => (d.status === 'confirmed' && byTeam(d)) || (d.status === 'possible' && d.needsTeam)).length,
    open: S.detections.filter((d) => d.status === 'possible' && !d.needsTeam).length,
    closed: S.detections.filter((d) => d.status === 'rejected' && !d.dismissed).length,
    dismissed: S.detections.filter((d) => d.dismissed).length,
    secondLooks: S.events.filter((x) => x.code === 'INVESTIGATE').length,
    routeLen: walked ? r.length : 0, routePlanned: r ? r.length : 0, routeStatus: r ? r.status : 'none',
    breakThroughs: r ? r.legs.filter((l) => l.ok && !l.reached).length : 0, unreachable: r ? r.legs.filter((l) => !l.ok).length : 0,
    hazardM: walked ? hz.total : 0, hazardList: walked ? hz.list : [],
    roverM: S.stats.distance, windows: S.stats.windows, replans: S.stats.replans,
    expectedMissed, unsearched, battery: S.units['HOUND-01'].battery,
  };
}

// Ground truth. Returned to the page, which shows it only behind the "ground truth" switch.
export function scoreTruth(e) {
  const S = e.state, src = {};
  for (const d of S.detections) src[d.id] = e.truthOf(d.id);
  const found = (code, id) => S.events.find((x) => x.code === code && x.det === id);
  const people = TRUTH.people.map((p) => {
    const d = S.detections.find((x) => src[x.id] === p.id);
    const byTeam = d && d.evidence.some((x) => x.sensor === 'human');
    const sv = d && d.survivorId ? S.survivors[d.survivorId] : null;
    let outcome = 'missed';
    if (d && d.status === 'confirmed' && !byTeam) outcome = 'sensors';
    else if (d && (d.status === 'confirmed' || (d.status === 'possible' && d.needsTeam))) outcome = 'team';
    return { id: p.id, pos: p.pos, room: p.room, motion: p.motion, posture: p.posture, outdoors: !!p.outdoors, note: p.note, det: d ? d.id : null, detStatus: d ? d.status : null, dismissed: !!(d && d.dismissed), outcome,
      firstSeenAt: d ? d.t : null, confirmedAt: d && d.status === 'confirmed' ? (found('PERSON_FOUND', d.id)?.t ?? null) : null, reachedAt: sv && sv.reachedAt != null ? sv.reachedAt : null };
  });
  const onRoute = new Set((S.routes.rescue?.legs || []).map((l) => l.det));
  const chasedIds = new Set(S.events.filter((x) => x.code === 'INVESTIGATE').map((x) => x.det));
  const notPeople = S.detections.filter((d) => !TRUTH.people.some((p) => p.id === src[d.id]));
  return {
    people, src,
    decoys: TRUTH.decoys.map((x) => { const d = S.detections.find((y) => src[y.id] === x.id); return { id: x.id, kind: x.kind, pos: x.pos, room: x.room, note: x.note, det: d ? d.id : null, status: d ? d.status : null }; }),
    missed: people.filter((p) => p.reachedAt == null).length,
    notDetected: people.filter((p) => p.outcome === 'missed').length,
    falseConfirmed: notPeople.filter((d) => d.status === 'confirmed').length,
    falseChased: notPeople.filter((d) => chasedIds.has(d.id) || onRoute.has(d.id)).length,
    falseOpened: notPeople.length,
  };
}

// ---------- run one branch ----------
// spec: { seed, windows, autoplay0, operator, log:[{t,name,args}], autoT, acts:[{id,t,cmds:[{name,args,after}],params}],
//         until?, frames?, maxT?, expectEnd? }
export async function runSpec(spec, nn, { onProgress } = {}) {
  const t0 = performance.now();
  const P = { confirmed: THRESHOLDS.confirmed, possible: THRESHOLDS.possible, csiPos: LR.csi.pos, csiNeg: LR.csi.neg };
  const usesWindows = spec.acts?.some((a) => a.params && a.params.maxWindows != null);
  const make = usesWindows || spec.patched ? await loadPatchedEngine() : createEngine;
  const nnx = { ...nn };
  const keep = { autoplay: spec.autoplay0 ?? true, speed: 8 };
  if (spec.operator) keep.operator = spec.operator;
  globalThis.__TL_MAXW = undefined;
  try {
    const e = make({ nn: nnx, seed: spec.seed, windows: spec.windows || 'scripted', keep });
    const S = e.state, log = (spec.log || []).slice().sort((a, b) => a.t - b.t);
    const pending = [];
    for (const a of spec.acts || []) {
      if (a.params) pending.push({ act: a.id, t: a.t, params: a.params });
      for (const c of a.cmds || []) pending.push({ act: a.id, t: a.t + (c.after || 0), name: c.name, args: c.args || {} });
    }
    pending.sort((a, b) => a.t - b.t);
    const fired = [];
    const maxT = spec.until ?? spec.maxT ?? 1500, wantFrames = spec.frames !== false && spec.until == null;
    const F = wantFrames ? { rover: [], mode: [], drone: [], team: [], phase: [], scan: [], listen: [], hold: [], faults: [], dets: [] } : null;
    const covLog = [], routeLog = []; let lastCov = {}, lastRoute = null, lastRouteStatus = null, nFrames = 0;
    const snap = () => {
      const r = S.units['HOUND-01'], d = S.units['DRONE-01'], tm = S.units['TEAM-1'];
      F.rover.push(r.pos[0], r.pos[1], r.heading, r.battery, r.link); F.mode.push(MODES.indexOf(r.mode));
      F.drone.push(d.pos[0], d.pos[1], d.alt); F.team.push(tm.pos[0], tm.pos[1], tm.heading);
      F.phase.push(PHASES.indexOf(S.phase)); F.scan.push(S.map.scan); F.listen.push(S.sensors.listen ? S.sensors.listen.progress : -1); F.hold.push(S.hold ? 1 : 0);
      F.faults.push(FAULT_IDS.reduce((m, id, i) => m | (S.faults[id] ? 1 << i : 0), 0));
      S.detections.forEach((det, i) => {
        const rec = (F.dets[i] ||= { id: det.id, i0: nFrames, p: [], st: [], x: [], y: [], sig: [], nEv: [], team: [] });
        rec.p.push(det.p); rec.st.push(STATUS.indexOf(det.status)); rec.x.push(det.pos ? det.pos[0] : NaN); rec.y.push(det.pos ? det.pos[1] : NaN); rec.sig.push(det.posSigma ?? 0); rec.nEv.push(det.evidence.length); rec.team.push(det.needsTeam ? 1 : 0);
      });
      for (const c of Object.values(S.coverage)) { const k = c.status + '|' + c.residual.toFixed(4) + '|' + c.reach.toFixed(3); if (lastCov[c.room] !== k) { lastCov[c.room] = k; covLog.push({ t: S.t, room: c.room, status: c.status, residual: c.residual, reach: c.reach, note: c.note }); } }
      const rr = S.routes.rescue || null;
      if (rr !== lastRoute || (rr && rr.status !== lastRouteStatus)) {
        lastRoute = rr; lastRouteStatus = rr ? rr.status : null;
        routeLog.push(rr ? { t: S.t, status: rr.status, length: rr.length, etaS: rr.etaS, avoided: rr.avoided.slice(), avoid: { ...rr.avoid }, legs: rr.legs.map((l) => ({ det: l.det, ok: l.ok, kind: l.kind, length: l.length, reached: l.reached, gap: l.gap, access: l.access, reason: l.reason, path: l.path ? l.path.map((q) => [q[0], q[1]]) : null })) } : { t: S.t, status: 'none' });
      }
      nFrames++;
    };
    const apply = (pp) => {
      if (pp.params) {
        const q = pp.params;
        if (q.confirmed != null) THRESHOLDS.confirmed = q.confirmed;
        if (q.possible != null) THRESHOLDS.possible = q.possible;
        if (q.csiThreshold != null) nnx.threshold = q.csiThreshold;
        if (q.csiLR) { LR.csi.pos = q.csiLR.pos; LR.csi.neg = q.csiLR.neg; }
        if (q.maxWindows != null) globalThis.__TL_MAXW = q.maxWindows;
        fired.push({ act: pp.act, t: S.t, name: 'setParameters', ok: true });
      } else fired.push({ act: pp.act, t: S.t, name: pp.name, ok: !!e.command(pp.name, pp.args) });
    };
    let i = 0, j = 0, steps = 0, autoDone = spec.autoT == null;
    if (F) snap();
    const expect = spec.expectEnd || 660;
    while ((spec.until != null || !e.done) && S.t < maxT - 1e-9) {   // the live clock keeps running after the mission ends, so a check runs to the same moment
      while (i < log.length && log[i].t <= S.t + 1e-9) { e.command(log[i].name, log[i].args); i++; }
      if (!autoDone && S.t >= spec.autoT - 1e-9) { autoDone = true; if (!S.autoplay) e.command('setAutoplay', { on: true }); if (S.hold && !pending.some((x) => x.name === 'resume')) e.command('resume'); }
      while (j < pending.length && pending[j].t <= S.t + 1e-9) apply(pending[j++]);
      e.step(); steps++;
      if (F && Math.abs(S.t - Math.round(S.t)) < 1e-6) snap();
      if (onProgress && steps % 600 === 0) onProgress(Math.min(0.99, S.t / expect));
    }
    const out = { id: spec.id, hash: digest(S), done: e.done, endT: S.t, steps, ms: performance.now() - t0, fired, rejectedLog: log.length - i };
    if (spec.until != null) return { out, transfer: [] };
    out.metrics = measure(e, e.done);
    out.truth = scoreTruth(e);
    if (!F) return { out, transfer: [] };
    if (Math.abs(S.t - Math.round(S.t)) >= 1e-6) snap();
    const f32 = (a) => Float32Array.from(a), u8 = (a) => Uint8Array.from(a);
    out.frames = { n: nFrames, rover: f32(F.rover), mode: u8(F.mode), drone: f32(F.drone), team: f32(F.team), phase: u8(F.phase), scan: f32(F.scan), listen: f32(F.listen), hold: u8(F.hold), faults: u8(F.faults),
      dets: F.dets.map((d) => ({ id: d.id, i0: d.i0, p: f32(d.p), st: u8(d.st), x: f32(d.x), y: f32(d.y), sig: f32(d.sig), nEv: u8(d.nEv), team: u8(d.team) })) };
    out.events = S.events.map((x) => ({ ...x }));
    out.detections = S.detections.map((d) => ({ id: d.id, t: d.t, updated: d.updated, room: d.room, pos: d.pos, posSigma: d.posSigma, p: d.p, status: d.status, kind: d.kind, reason: d.reason, outdoor: d.outdoor, needsTeam: d.needsTeam, dismissed: d.dismissed, survivorId: d.survivorId, stop: d.stop, by: d.by.slice(),
      evidence: d.evidence.map((x) => ({ t: x.t, vantage: x.vantage, unit: x.unit, sensor: x.sensor, result: x.result, note: x.note, score: x.score, moving: x.moving, sample: x.sample })) }));
    out.survivors = JSON.parse(JSON.stringify(S.survivors));
    out.hazards = S.hazards.map((h) => ({ id: h.id, kind: h.kind, name: h.name, poly: h.poly, block: h.block, t: h.t }));
    out.covLog = covLog; out.routeLog = routeLog;
    out.params = { confirmed: THRESHOLDS.confirmed, possible: THRESHOLDS.possible, csiThreshold: nnx.threshold, csiPos: LR.csi.pos, csiNeg: LR.csi.neg, maxWindows: globalThis.__TL_MAXW ?? 2 };
    const fr = out.frames;
    const transfer = [fr.rover, fr.mode, fr.drone, fr.team, fr.phase, fr.scan, fr.listen, fr.hold, fr.faults, ...fr.dets.flatMap((d) => [d.p, d.st, d.x, d.y, d.sig, d.nEv, d.team])].map((a) => a.buffer);
    return { out, transfer };
  } finally {
    THRESHOLDS.confirmed = P.confirmed; THRESHOLDS.possible = P.possible; LR.csi.pos = P.csiPos; LR.csi.neg = P.csiNeg; globalThis.__TL_MAXW = undefined;
  }
}
