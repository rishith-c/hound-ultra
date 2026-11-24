// The search-theory map of the live mission: prior, looks, Bayesian update, information gain. No drawing here.
// It reads only what the console knows (ctx.sim.state: where the rover listened and what its sensors said).
import { makeSensors, flatWalls, traceReach, makeBelief, copyBelief, applyLook, infoGain, expectedFinds, entropy, distField, fieldAt, pod, ROVER_SPEED, WINDOW_S } from './model.js';
import { pointInPoly, pointInRect } from '../../core/geometry.js';

export const PRIOR_INDOOR = 0.8;   // expected people inside: 8 rooms x the console's 0.10 prior (core/fusion.js, assumed)
export const LOG_LO = -4.6, LOG_SPAN = 4; // display: 0.01 % to 100 % chance per square metre, on a log scale

export function createMissionMap(ctx) {
  const world = ctx.world, SITE = world.SITE, RES = 0.5, GW = Math.round(SITE.w / RES), GH = Math.round(SITE.h / RES), N = GW * GH;
  const S = makeSensors();
  const walls = flatWalls(world.WALLS.filter((w) => w.state !== 'collapsed'));
  const blocks = world.OBSTACLES.filter((o) => o.h >= 0.8 && o.kind !== 'building').map((o) => ({ poly: o.poly, partial: o.h < 1.2 }));
  const mk = (res, w, hh) => { const n = w * hh, cx = new Float32Array(n), cy = new Float32Array(n); for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) { cx[j * w + i] = (i + 0.5) * res; cy[j * w + i] = (j + 0.5) * res; } return { n, cx, cy, walls, blocks, lattice: { x0: 0, y0: 0, res, w, h: hh } }; };
  const fine = mk(RES, GW, GH), CW = SITE.w, CH = SITE.h, coarse = mk(1, CW, CH);

  // ---- which room each fine cell is in ----
  const rooms = world.ROOMS, roomOf = new Int16Array(N).fill(-1), inB = new Uint8Array(N), open = new Uint8Array(N);
  const bldgs = world.OBSTACLES.filter((o) => o.kind === 'building'), debris = world.OBSTACLES.find((o) => o.id === 'rubble-field');
  const inDebris = new Uint8Array(N);
  for (let c = 0; c < N; c++) {
    const p = [fine.cx[c], fine.cy[c]];
    if (pointInRect(p, world.BUILDING.rect)) { inB[c] = 1; for (let r = 0; r < rooms.length; r++) if (pointInRect(p, rooms[r].rect)) { roomOf[c] = r; break; } }
    else if (!bldgs.some((b) => pointInPoly(p, b.poly))) { open[c] = 1; if (debris && pointInPoly(p, debris.poly)) inDebris[c] = 1; }
  }
  const roomCells = rooms.map((_, r) => { const a = []; for (let c = 0; c < N; c++) if (roomOf[c] === r) a.push(c); return a; });

  // ---- the prior: a mixture of scenarios, as in the Scorpion and AF 447 searches ----
  // weights = { place, shelter, exit, outdoors }: the first three are shares of the people indoors (normalised),
  // outdoors is the expected number of people outside the building.
  function buildPrior(weights) {
    const tot = weights.place + weights.shelter + weights.exit || 1, wa = weights.place / tot, wb = weights.shelter / tot, wc = weights.exit / tot;
    const p = new Float32Array(N), perRoom = PRIOR_INDOOR / rooms.filter((r) => !r.corridor).length;
    const corridorCells = rooms.reduce((s, r, i) => s + (r.corridor ? roomCells[i].length : 0), 0);
    rooms.forEach((r, ri) => {
      const cells = roomCells[ri];
      if (r.corridor) { for (const c of cells) p[c] += (wc * 0.4 * PRIOR_INDOOR) / corridorCells; return; }
      const door = world.DOORS.find((d) => d.room === r.id);
      let sb = 0, sc = 0; const fb = new Float32Array(cells.length), fc = new Float32Array(cells.length);
      cells.forEach((c, k) => {
        const x = fine.cx[c], y = fine.cy[c], dEdge = Math.min(x - r.rect[0], r.rect[2] - x, y - r.rect[1], r.rect[3] - y);
        fb[k] = Math.exp(-dEdge / 1.2); sb += fb[k];
        fc[k] = door ? Math.exp(-Math.hypot(x - door.pos[0], y - door.pos[1]) / 2.5) : 1; sc += fc[k];
      });
      cells.forEach((c, k) => { p[c] += perRoom * (wa / cells.length + (wb * fb[k]) / sb + (wc * 0.6 * fc[k]) / sc); });
    });
    let nDeb = 0, nOpen = 0; for (let c = 0; c < N; c++) { if (inDebris[c]) nDeb++; else if (open[c]) nOpen++; }
    for (let c = 0; c < N; c++) { if (inDebris[c]) p[c] += (weights.outdoors * 0.7) / nDeb; else if (open[c]) p[c] += (weights.outdoors * 0.3) / nOpen; }
    const B = makeBelief(N); for (let c = 0; c < N; c++) { B.pm[c] = p[c] * S.pMove; B.ps[c] = p[c] * (1 - S.pMove); }
    return B;
  }

  // ---- the looks the rover has taken, rebuilt from the mission state ----
  const SENSE = new Set(['csi', 'radar', 'micro', 'thermal', 'signature', 'temperature']);
  function looksFromState(St, seen) {
    const map = new Map();
    const get = (key, t) => { const id = key + '@' + t.toFixed(1); let L = map.get(id); if (!L) { L = { id, key, t, ev: [] }; map.set(id, L); } return L; };
    for (const d of St.detections) for (const e of d.evidence) if (SENSE.has(e.sensor) && e.vantage && e.vantage !== 'team' && e.unit === 'HOUND-01') get(e.vantage, e.t).ev.push({ e, d });
    for (const c of Object.values(St.coverage)) if (c.stop && c.t != null) { const L = get(c.stop, c.t); if (c.noCsi) L.noCsi = true; }
    const looks = [...map.values()].sort((a, b) => a.t - b.t);
    const rover = St.units['HOUND-01'];
    for (const L of looks) {
      const stop = world.STOPS.find((s) => s.id === L.key);
      if (stop) { L.pos = stop.pos; L.label = stop.label; }
      else if (seen.has(L.id)) { L.pos = seen.get(L.id); L.label = 'Second look'; }
      else { // a second look taken before this lab was opened: the rover's track point nearest the lead it was checking
        const d = L.ev[0] && L.ev[0].d, target = d && d.pos; let best = rover.pos, bd = Infinity;
        if (target) for (const p of [...rover.trail, rover.pos]) { const dd = Math.abs(Math.hypot(p[0] - target[0], p[1] - target[1]) - 2.4); if (dd < bd) { bd = dd; best = p; } }
        L.pos = best.slice(); L.label = 'Second look'; L.approx = true;
      }
      const has = (sensor, result) => L.ev.some((x) => x.e.sensor === sensor && x.e.result === result);
      const localised = (sensor) => L.ev.some((x) => x.e.sensor === sensor && x.e.result === 'pos' && x.d.posSigma != null && x.d.posSigma < 3);
      // What each sensor tells the map about everywhere else. A position sensor that fired is carried by its lead.
      const obs = { csi: 0, micro: 0, radar: [], thermal: [] };
      if (L.noCsi || has('csi', 'blind')) obs.csi = null; else if (has('csi', 'pos')) obs.csi = localised('csi') ? null : 1;
      if (has('micro', 'pos')) obs.micro = null;
      if (L.ev.some((x) => x.e.sensor === 'thermal' && x.e.result === 'blind' && /not responding/.test(x.e.note || ''))) obs.thermal = null;
      L.obs = obs; L.alarm = obs.csi === 1; L.windows = 1;
      L.says = has('csi', 'pos') ? 'Wi-Fi alarm' : obs.csi === null ? 'no Wi-Fi reading' : 'Wi-Fi quiet';
    }
    return looks;
  }
  const reachCache = new Map();
  const reachOf = (pos, geom = fine) => { const k = (geom === fine ? 'f' : 'c') + pos[0].toFixed(2) + ',' + pos[1].toFixed(2); let r = reachCache.get(k); if (!r) { r = traceReach(geom, pos, S); if (reachCache.size > 4000) reachCache.clear(); reachCache.set(k, r); } return r; };

  // ---- belief after the first k looks, and the cumulative probability of success ----
  // Returns { B, pos: [probability of success after 0..k looks], miss } where miss is the chance each cell's
  // person would have stayed undetected so far.
  function replay(prior, looks, k) {
    const B = copyBelief(prior), missM = new Float32Array(N).fill(1), missS = new Float32Array(N).fill(1), pos = [0];
    let base = 0; for (let c = 0; c < N; c++) if (inB[c]) base += prior.pm[c] + prior.ps[c];
    for (let i = 0; i < k; i++) {
      const L = looks[i], reach = reachOf(L.pos), o = L.obs;
      applyLook(B, reach, S, o);
      for (let q = 0; q < reach.n; q++) { const c = reach.idx[q], b = q * 4; for (let j = 0; j < 4; j++) { const on = j === 0 ? o.csi !== null || L.alarm : j === 1 ? o.radar !== null : j === 2 ? true : o.thermal !== null; if (!on) continue; missM[c] *= 1 - reach.dm[b + j]; missS[c] *= 1 - reach.ds[b + j]; } }
      let left = 0; for (let c = 0; c < N; c++) if (inB[c]) left += prior.pm[c] * missM[c] + prior.ps[c] * missS[c];
      pos.push(1 - left / base);
    }
    return { B, pos };
  }
  // Leads the console holds at time t, as blobs of probability: { p, pos, sigma, room, person, id, moving }.
  function leadsAt(St, t) {
    const out = [];
    for (const d of St.detections) {
      if (!d.pos || d.t > t + 1e-6) continue;
      let p = null; for (let i = 0; i < d.evidence.length && i < d.steps.length; i++) if (d.evidence[i].t <= t + 1e-6) p = d.steps[i].p;
      if (p == null) continue;
      const live = t >= d.updated - 1e-6, status = live ? d.status : p >= 0.85 ? 'confirmed' : p >= 0.15 ? 'possible' : 'rejected';
      if (status === 'rejected' || (live && d.dismissed)) continue;
      out.push({ id: d.id, p, pos: d.pos, sigma: d.posSigma || 1, room: d.room, outdoor: d.outdoor, person: status === 'confirmed', local: (d.posSigma || 1) < 3, moving: d.evidence.some((e) => e.sensor === 'radar' && e.result === 'pos') });
    }
    return out;
  }
  // The map as shown: what the looks left behind, plus each located lead as a blob. Returns { P, v, roomP, expected }.
  function compose(B, leads) {
    const P = new Float32Array(N); let expected = 0;
    for (let c = 0; c < N; c++) { P[c] = B.pm[c] + B.ps[c]; expected += P[c]; }
    const roomP = rooms.map((_, r) => { let q = 1; for (const c of roomCells[r]) q *= 1 - P[c]; return 1 - q; });
    for (const L of leads) {
      if (!L.local) continue;
      const sg = Math.max(0.35, L.sigma), R = 3 * sg, ri = L.room ? rooms.findIndex((r) => r.id === L.room) : -1;
      const i0 = Math.max(0, Math.floor((L.pos[0] - R) / RES)), i1 = Math.min(GW - 1, Math.ceil((L.pos[0] + R) / RES)), j0 = Math.max(0, Math.floor((L.pos[1] - R) / RES)), j1 = Math.min(GH - 1, Math.ceil((L.pos[1] + R) / RES));
      let sum = 0; const cells = [], ws = [];
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = j * GW + i; if (ri >= 0 && roomOf[c] !== ri) continue; const dx = fine.cx[c] - L.pos[0], dy = fine.cy[c] - L.pos[1], w = Math.exp(-(dx * dx + dy * dy) / (2 * sg * sg)); cells.push(c); ws.push(w); sum += w; }
      cells.forEach((c, k) => { const b = Math.min(0.98, (L.p * ws[k]) / sum); P[c] = 1 - (1 - P[c]) * (1 - b); });
    }
    const v = new Float32Array(N);
    for (let c = 0; c < N; c++) v[c] = P[c] > 0 ? Math.min(1, Math.max(0, (Math.log10(P[c]) - LOG_LO) / LOG_SPAN)) : 0;
    return { P, v, roomP, expected };
  }
  function massNear(P, p, radius) { let s = 1; const i0 = Math.max(0, Math.floor((p[0] - radius) / RES)), i1 = Math.min(GW - 1, Math.ceil((p[0] + radius) / RES)), j0 = Math.max(0, Math.floor((p[1] - radius) / RES)), j1 = Math.min(GH - 1, Math.ceil((p[1] + radius) / RES)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = j * GW + i; if (Math.hypot(fine.cx[c] - p[0], fine.cy[c] - p[1]) <= radius) s *= 1 - P[c]; } return 1 - s; }

  // ---- where to listen next ----
  // Candidate stops: every free square metre in and around building B, and a 2 m lattice over the debris field.
  let cands = null, candReach = null;
  function candidates() {
    if (cands) return cands;
    const g = ctx.sim.grid, free = (x, y) => { const i = Math.floor(x / g.res), j = Math.floor(y / g.res); return !g.blocked[j * g.w + i]; };
    cands = []; const r = world.BUILDING.rect;
    for (let y = r[1] - 3; y < r[3] + 3; y++) for (let x = r[0] - 3; x < r[2] + 3; x++) if (free(x + 0.5, y + 0.5)) cands.push({ pos: [x + 0.5, y + 0.5], cell: y * CW + x, size: 1 });
    if (debris) { const xs = debris.poly.map((p) => p[0]), ys = debris.poly.map((p) => p[1]); for (let y = Math.floor(Math.min(...ys)) - 2; y < Math.max(...ys) + 2; y += 2) for (let x = Math.floor(Math.min(...xs)) - 2; x < Math.max(...xs) + 2; x += 2) if (x + 1 < CW && y + 1 < CH && free(x + 1, y + 1)) cands.push({ pos: [x + 1, y + 1], cell: y * CW + x, size: 2 }); }
    candReach = new Array(cands.length);
    return cands;
  }
  // Trace what every candidate can sense, a slice at a time. Returns true when all are done.
  let traced = 0;
  function traceSome(ms = 8) { const C = candidates(), t0 = performance.now(); while (traced < C.length && performance.now() - t0 < ms) { candReach[traced] = traceReach(coarse, C[traced].pos, S); traced++; } return traced >= C.length; }
  const traceProgress = () => (cands ? traced / cands.length : 0);
  // The belief on the 1 m grid the gain is computed on (four fine cells each; leads included).
  function coarseBelief(B, leads) {
    const C = makeBelief(CW * CH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { const c = j * GW + i, k = (j >> 1) * CW + (i >> 1); C.pm[k] += B.pm[c]; C.ps[k] += B.ps[c]; }
    for (const L of leads) { if (!L.local) continue; const k = Math.floor(L.pos[1]) * CW + Math.floor(L.pos[0]); if (k < 0 || k >= C.n) continue; const room = Math.min(0.97 - C.pm[k] - C.ps[k], L.p); if (room > 0) { if (L.moving) C.pm[k] += room; else C.ps[k] += room; } }
    for (let k = 0; k < C.n; k++) { const s = C.pm[k] + C.ps[k]; if (s > 0.97) { C.pm[k] *= 0.97 / s; C.ps[k] *= 0.97 / s; } }
    return C;
  }
  // Score every candidate: expected information (bits), travel time, and the chosen score.
  //   mode 'rate': bits per minute of drive + listen;   mode 'net': bits minus lambda x minutes.
  function scoreAll(C, from, mode, lambda) {
    const g = ctx.sim.grid, field = distField(g, from), out = [];
    for (let i = 0; i < traced; i++) {
      const c = cands[i], d = fieldAt(g, field, c.pos); if (!(d < Infinity)) continue;
      const gain = infoGain(C, candReach[i], S), secs = d / ROVER_SPEED + WINDOW_S;
      out.push({ i, pos: c.pos, cell: c.cell, size: c.size, gain, secs, dist: d, finds: expectedFinds(C, candReach[i]), score: mode === 'net' ? gain - lambda * (secs / 60) : gain / (secs / 60) });
    }
    return { list: out, field };
  }
  function scoreAt(C, pos, field, mode, lambda) {
    const g = ctx.sim.grid, reach = reachOf(pos, coarse), d = fieldAt(g, field, pos), gain = infoGain(C, reach, S), secs = d / ROVER_SPEED + WINDOW_S;
    return { pos, gain, secs, dist: d, finds: expectedFinds(C, reach), score: !(d < Infinity) ? -Infinity : mode === 'net' ? gain - lambda * (secs / 60) : gain / (secs / 60) };
  }
  // Combined probability that one look from pos fires on a person in each fine cell (for the reach overlay).
  function podField(pos, moving) {
    const reach = reachOf(pos), out = new Float32Array(N), d = moving ? reach.dm : reach.ds;
    for (let q = 0; q < reach.n; q++) { const b = q * 4; out[reach.idx[q]] = 1 - (1 - d[b]) * (1 - d[b + 1]) * (1 - d[b + 2]) * (1 - d[b + 3]); }
    return out;
  }
  // Plan n looks ahead from a start point assuming every look stays quiet (the usual planning assumption), either
  // along given stops or greedily by score. Returns [{ pos, t (s), pos (probability of success) }].
  function planAhead(prior, start, { stops = null, seconds = Infinity, maxLooks = 12, mode = 'rate', lambda = 0.05 } = {}) {
    const B = copyBelief(prior), missM = new Float32Array(N).fill(1), missS = new Float32Array(N).fill(1), out = [];
    let base = 0; for (let c = 0; c < N; c++) if (inB[c]) base += prior.pm[c] + prior.ps[c];
    let at = start, t = 0;
    for (let k = 0; k < (stops ? stops.length : maxLooks); k++) {
      let pos, secs;
      if (stops) { pos = stops[k]; const f = distField(ctx.sim.grid, at); secs = fieldAt(ctx.sim.grid, f, pos) / ROVER_SPEED + WINDOW_S; }
      else { const sc = scoreAll(coarseBelief(B, []), at, mode, lambda).list; let best = null; for (const s of sc) if (!best || s.score > best.score) best = s; if (!best) break; pos = best.pos; secs = best.secs; }
      if (!(secs < Infinity) || t + secs > seconds) break;
      const reach = reachOf(pos); applyLook(B, reach, S, { csi: 0, micro: 0, radar: [], thermal: [] });
      for (let q = 0; q < reach.n; q++) { const c = reach.idx[q], b = q * 4; for (let j = 0; j < 4; j++) { missM[c] *= 1 - reach.dm[b + j]; missS[c] *= 1 - reach.ds[b + j]; } }
      let left = 0; for (let c = 0; c < N; c++) if (inB[c]) left += prior.pm[c] * missM[c] + prior.ps[c] * missS[c];
      t += secs; at = pos; out.push({ pos, t, success: 1 - left / base });
    }
    return out;
  }
  return { S, GW, GH, RES, N, CW, CH, fine, coarse, rooms, roomOf, roomCells, inB, buildPrior, looksFromState, replay, leadsAt, compose, massNear, candidates, traceSome, traceProgress, coarseBelief, scoreAll, scoreAt, podField, planAhead, reachOf, entropy,
    cellAt: (p) => { const i = Math.floor(p[0] / RES), j = Math.floor(p[1] / RES); return i < 0 || j < 0 || i >= GW || j >= GH ? -1 : j * GW + i; } };
}
export { pod };
