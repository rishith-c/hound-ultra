// A legged carrier. The same height map, sensed with noise, is planned over twice: once as a small wheeled rover that
// must roll over every edge, once as legs that choose where to step. The plans are then driven over the true ground,
// and every place where the truth breaks the plan is counted.
import * as L from '../lib.js';
const { TAU, clamp } = L;
const NX = 150, NY = 90, CS = 0.08;                       // 12 m by 7.2 m at 8 cm
function terrain(P) {
  const R = L.rng(P.seed), z = new Float32Array(NX * NY), put = (fn) => { for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) z[j * NX + i] = fn(i * CS, j * CS, z[j * NX + i]); };
  const w = Array.from({ length: 6 }, () => [R.range(0.4, 1.6), R.range(0.4, 1.6), R() * TAU]);
  put((x, y) => 0.035 * w.reduce((s, q) => s + Math.sin(x * q[0] + y * q[1] + q[2]), 0) / 2);
  const n = Math.round(150 * P.rough);
  for (let k = 0; k < n; k++) { const cx = R.range(2.4, 8), cy = R.range(-0.2, 7.4), a = R.range(0.12, 0.6), b = R.range(0.1, 0.45), th = R() * 3.14, top = R.range(0.04, 0.34) * (0.4 + P.rough), tx = R.n() * 0.12, ty = R.n() * 0.12, c = Math.cos(th), s = Math.sin(th);
    const i0 = Math.max(0, Math.floor((cx - 0.8) / CS)), i1 = Math.min(NX - 1, Math.ceil((cx + 0.8) / CS)), j0 = Math.max(0, Math.floor((cy - 0.8) / CS)), j1 = Math.min(NY - 1, Math.ceil((cy + 0.8) / CS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const dx = i * CS - cx, dy = j * CS - cy, u = dx * c + dy * s, v = -dx * s + dy * c; if (Math.abs(u) < a && Math.abs(v) < b) { const q = j * NX + i; z[q] = Math.max(z[q], top + tx * u + ty * v + (z[q] > 0.12 ? 0.35 * z[q] : 0)); } } }
  put((x, y, v) => (x <= 8.6 ? v : y <= 2.2 ? 1.1 : y < 5 ? Math.min(6, Math.floor((x - 8.6) / 0.3)) * P.rise : 0));
  for (let j = 0; j < NY; j++) for (let i = 0; i < 20; i++) z[j * NX + i] *= 0.3;
  return z;
}
// What each body can do. All limits assumed, except that the rover wheel is 80 mm across.
const WHEEL = { step: 0.03, half: 2 }, LEG = { half: 2 };
function costs(z, P) {                                     // traversal cost per cell for both, Infinity where impossible
  const cw = new Float32Array(NX * NY).fill(Infinity), cl = new Float32Array(NX * NY).fill(Infinity);
  for (let j = 2; j < NY - 2; j++) for (let i = 2; i < NX - 2; i++) { const k = j * NX + i;
    let step = 0, lo = 9, hi = -9; for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const q = k + a * NX + b, v = z[q]; if (v < lo) lo = v; if (v > hi) hi = v; if (b < 2) step = Math.max(step, Math.abs(z[q + 1] - v)); if (a < 2) step = Math.max(step, Math.abs(z[q + NX] - v)); }
    if (step <= WHEEL.step) cw[k] = 1 + 20 * step;
    // legs: a foothold is a cell that is level with its neighbours; the search below steps from foothold to foothold
    const r = Math.max(Math.abs(z[k + 1] - z[k]), Math.abs(z[k - 1] - z[k]), Math.abs(z[k + NX] - z[k]), Math.abs(z[k - NX] - z[k])); if (r < 0.05) cl[k] = 1 + 6 * r; }
  return { cw, cl };
}
const START = 45 * NX + 8, GOAL = 45 * NX + 144;
// reach = cells a single move may span; climb = the highest change of height in one move. Wheels: next cell. Legs: 40 cm, one step.
// The search queue is a pair of flat arrays so a sweep of plans does not stall the page; distances are 64-bit so a repeat visit is never "shorter" by rounding.
const HK = new Float64Array(400000), HV = new Int32Array(400000);
function dijkstra(cost, z, reach = 1, climb = Infinity) {
  const D = new Float64Array(NX * NY).fill(Infinity), prev = new Int32Array(NX * NY).fill(-1); D[START] = 0; HK[0] = 0; HV[0] = START; let n = 1;
  const off = []; for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) { const ds = Math.hypot(a, b); if ((a || b) && ds <= reach + 0.5) off.push([a, b, ds]); }
  while (n) {
    const d = HK[0], k = HV[0], lk = HK[--n], lv = HV[n]; let h = 0;
    for (;;) { let c = 2 * h + 1; if (c >= n) break; if (c + 1 < n && HK[c + 1] < HK[c]) c++; if (lk <= HK[c]) break; HK[h] = HK[c]; HV[h] = HV[c]; h = c; } HK[h] = lk; HV[h] = lv;
    if (d > D[k]) continue; const i = k % NX, j = (k - i) / NX, zk = z[k];
    for (let m = 0; m < off.length; m++) { const o = off[m], jj = j + o[0], ii = i + o[1]; if (jj < 0 || jj >= NY || ii < 0 || ii >= NX) continue; const q = jj * NX + ii, c = cost[q]; if (!(c < 1e6)) continue; const dz = z[q] - zk; if (dz > climb || -dz > climb) continue;
      const e = d + c * o[2]; if (e >= D[q] || n >= HK.length) continue; D[q] = e; prev[q] = k; let u = n++; while (u) { const p = (u - 1) >> 1; if (HK[p] <= e) break; HK[u] = HK[p]; HV[u] = HV[p]; u = p; } HK[u] = e; HV[u] = q; }
  }
  return { D, prev };
}
const gap = (k, z) => Math.hypot((k % NX - GOAL % NX) * CS, (Math.floor(k / NX) - 45) * CS, z[k] - z[GOAL]);   // straight-line distance left to the person, m
function pathTo(S, z) { let end = GOAL; if (!(S.D[GOAL] < 1e6)) { let best = Infinity; for (let k = 0; k < S.D.length; k++) if (S.D[k] < 1e6) { const q = gap(k, z); if (q < best) { best = q; end = k; } } } const p = []; for (let k = end; k >= 0; k = S.prev[k]) p.push(k); return { p: p.reverse(), done: end === GOAL, far: 1 - gap(end, z) / gap(START, z) }; }
export default {
  id: 'legged', title: 'Legs for the sensors', short: 'Legs',
  readiness: 1.95, readinessNote: 'Legged robots have hiked an alpine route and won a DARPA underground search contest. The HOUND team is separately building a quadruped; HOUND’s sensors are not on one.',
  standoff: [0.4, 4],
  labels: ['concept', 'live-algo'],
  labelNote: 'The ground is simulated. The noisy sensing, both cost maps, both plans and the comparison with the true ground are computed in this page. Step limits are assumed, and legs may place a foot only on level cells, up to 40 cm away; only the 80 mm wheel is a HOUND figure. No robot’s walking is simulated.',
  sentences: [
    'A wheel must roll over every edge on its path; a leg only needs a few good places to put a foot.',
    'On stairs and rubble that difference decides whether the sensors reach the person at all, so a legged platform is a natural carrier for them.',
  ],
  needs: 'A leg that keeps its footing on loose, wet debris, enough battery to carry the sensors up and back, and a height map good to a couple of centimetres while the robot moves.',
  unknown: 'Loose blocks shift underfoot and nothing here moves. Falls, slips, payload and endurance are not modelled, so this says where a foot could go, not that a robot would make it.',
  sources: [
    { who: 'Miki et al., ETH Zurich', year: 2022, title: 'Learning robust perceptive locomotion for quadrupedal robots in the wild', where: 'Science Robotics 7(62), eabk2822', url: 'https://doi.org/10.1126/scirobotics.abk2822' },
    { who: 'Tranzatto et al., team CERBERUS', year: 2022, title: 'CERBERUS in the DARPA Subterranean Challenge', where: 'Science Robotics 7(66), eabp9742', url: 'https://doi.org/10.1126/scirobotics.abp9742' },
  ],
  glyph(g, s, t, c) { g.strokeStyle = c.ink; g.strokeRect(-s * 0.26, -s * 0.16, s * 0.5, s * 0.14); for (const [x, p] of [[-0.2, 0], [-0.08, 3.1], [0.08, 3.1], [0.2, 0]]) { const a = 0.35 * Math.sin(t * 4 + p); g.beginPath(); g.moveTo(x * s, -s * 0.02); g.lineTo(x * s + a * 4 - 2, s * 0.12); g.lineTo(x * s + a * 6, s * 0.26); g.stroke(); } g.strokeStyle = c.dim; g.beginPath(); g.moveTo(-s * 0.45, s * 0.28); g.lineTo(s * 0.45, s * 0.28); g.stroke(); },
  create({ stage, controls, readout }) {
    L.layout(stage, { cols: '1fr 1fr', rows: '1.75fr 1fr', areas: ['iso iso', 'prof sweep'] });
    const fIso = L.figure({ area: 'iso', title: 'Planning…' }), fPr = L.figure({ area: 'prof', title: 'The ground under each path' }), fSw = L.figure({ area: 'sweep', title: 'Reach against rubble' });
    stage.append(fIso.el, fPr.el, fSw.el);
    const P = { rough: 0.6, leg: 0.2, noise: 0.008, rise: 0.17, seed: 4, view: 'legs' };
    let S = null, sweep = null, clock = 0, cv = null, key = '';
    const M9 = new Float32Array(9);
    function solve(p) {
      const z = terrain(p), R = L.rng(p.seed + 77), m = Float32Array.from(z, (v) => v + p.noise * R.n()), sm = new Float32Array(m);
      for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) { let c = 0; for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) { const v = m[(j + y) * NX + i + x]; let q = c++; while (q && M9[q - 1] > v) { M9[q] = M9[q - 1]; q--; } M9[q] = v; } sm[j * NX + i] = M9[4]; }
      const plan = costs(sm, p), tru = costs(z, p), reach = (c, n, up) => { const s = dijkstra(c, sm, n, up); let hit = 0; for (const v of s.D) if (v < 1e6) hit++; return { s, f: hit / ((NX - 4) * (NY - 4)) }; };
      const w = reach(plan.cw, 1, Infinity), l = reach(plan.cl, 5, p.leg), bad = (path, c, up) => path.p.filter((k, n) => !(c[k] < 1e6) || (n && Math.abs(z[k] - z[path.p[n - 1]]) > up)).length;
      const pw = pathTo(w.s, z), pl = pathTo(l.s, z); let wrongW = 0, wrongL = 0; for (let k = 0; k < NX * NY; k++) { if ((plan.cw[k] < 1e6) !== (tru.cw[k] < 1e6)) wrongW++; if ((plan.cl[k] < 1e6) !== (tru.cl[k] < 1e6)) wrongL++; }
      return { z, plan, tru, w, l, pw, pl, bw: bad(pw, tru.cw, Infinity), bl: bad(pl, tru.cl, p.leg), wrongW: wrongW / (NX * NY), wrongL: wrongL / (NX * NY) };
    }
    function compute() { S = solve(P); key = ''; paint(); doSweep(); }
    let job = 0; function doSweep() { const id = ++job, xs = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9]; sweep = { xs, w: [], l: [] }; let a = 0, t = 0, w = 0, l = 0; const step = () => { if (id !== job) return; { const q = solve({ ...P, rough: xs[a], seed: 50 + t }); w += q.pw.far / 4; l += q.pl.far / 4; } if (++t < 4) { setTimeout(step, 40); return; } sweep.w.push(w); sweep.l.push(l); t = w = l = 0; fSw.redraw(); if (++a < xs.length) setTimeout(step, 30); else paint(); }; setTimeout(step, 120); }
    const C = L.soon(compute);
    let proj = null;
    function scene(w, h, dpr) {                            // the height map drawn once as shaded columns, back to front
      const c = document.createElement('canvas'); c.width = w * dpr; c.height = h * dpr; const g = c.getContext('2d'); g.scale(dpr, dpr);
      const u = Math.min(w / (NX * 0.95 + NY * 0.4 + 6), h / (NX * 0.1 + NY * 0.46 + 24)), ox = (w - u * (NX * 0.95 - NY * 0.4)) / 2, oy = (h - u * (NX * 0.1 + NY * 0.46)) / 2 + u * 8; proj = (i, j, z) => [ox + u * (i * 0.95 - j * 0.4), oy + u * (i * 0.1 + j * 0.46) - (z / CS) * u * 0.92];
      const T = L.tokens().rgb, tru = P.view === 'legs' ? S.l.s.D : S.w.s.D;
      for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) { const k = j * NX + i, a = S.z[k], b = S.z[k + 1], d = S.z[k + NX], e = S.z[k + NX + 1]; const nx = (a - b) / CS, ny = (a - d) / CS, nl = Math.hypot(nx, ny, 1); let s = clamp((nx * 0.62 - ny * 0.3 + 0.72) / nl, 0.06, 1.15); s *= 0.8 + 0.28 * Math.sin(i * 12.9898 + j * 78.233) * 0.35 + clamp(a * 0.25, 0, 0.25);
        const ok = tru[k] < 1e6, base = ok ? (P.view === 'legs' ? [T.accent[0] * 0.5 + 52, T.accent[1] * 0.42 + 46, T.accent[2] * 0.36 + 42] : [T.ok[0] * 0.4 + 46, T.ok[1] * 0.42 + 46, T.ok[2] * 0.4 + 46]) : [116, 113, 108]; g.fillStyle = 'rgb(' + base.map((v) => Math.min(255, v * s) | 0).join(',') + ')';
        const p0 = proj(i, j, a), p1 = proj(i + 1, j, b), p2 = proj(i + 1, j + 1, e), p3 = proj(i, j + 1, d); g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.closePath(); g.fill(); g.strokeStyle = g.fillStyle; g.lineWidth = 0.8; g.stroke(); }
      return c;
    }
    fIso.draw = (g, w, h) => {
      if (!S) return; const k = w + 'x' + h + P.view; if (k !== key) { cv = scene(w, h, Math.min(2, devicePixelRatio || 1)); key = k; } g.drawImage(cv, 0, 0, w, h); const T = L.tokens();
      const line = (path, col, off) => { g.strokeStyle = col; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath(); path.p.forEach((q, n) => { const p = proj(q % NX, Math.floor(q / NX), S.z[q] + off); n ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.stroke(); };
      line(S.pw, T.ok, 0.03); line(S.pl, T.accent, 0.05);
      const go = proj(144, 45, S.z[GOAL] + 0.05), st = proj(8, 45, S.z[START] + 0.05); g.fillStyle = T.person; g.beginPath(); g.arc(go[0], go[1], 5, 0, TAU); g.fill(); L.text(g, 'person, up the stairs (simulated)', go[0] - 8, go[1] - 14, { color: 'person', halo: true, align: 'right' }); L.text(g, 'start', st[0] - 8, st[1] + 18, { color: 'text2', halo: true, align: 'right' });
      const mark = (path, lab, col) => { const q = path.p[Math.min(path.p.length - 1, Math.floor((clock * 22) % (path.p.length + 40)))], p = proj(q % NX, Math.floor(q / NX), S.z[q] + 0.1); g.fillStyle = T.bg0; g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(p[0], p[1], 5, 0, TAU); g.fill(); g.stroke(); if (path.done === false && q === path.p[path.p.length - 1]) L.callout(g, lab + ' stop here', p[0], p[1], p[0] + 26, p[1] + 34, { color: 'text' }); };
      mark(S.pw, 'the wheels', T.ok); mark(S.pl, 'the legs', T.accent);
    };
    fIso.legend([{ label: 'wheels, 80 mm', color: 'ok', kind: 'line' }, { label: 'legs', color: 'accent', kind: 'line' }]);
    fPr.draw = (g, w, h) => { if (!S) return; const Pl = L.plot(g, L.pad(w, h, { t: 18 }), { xd: [0, 12], yd: [-0.1, 1.2], xlabel: 'distance from the start wall, m' }); L.text(g, 'height, m', 46, 11, { color: 'text3', size: 11 }); for (const [p, c] of [[S.pl, 'accent'], [S.pw, 'ok']]) L.trace(g, Pl, p.p.map((k) => (k % NX) * CS), p.p.map((k) => S.z[k]), { color: c, fill: 0.08 }); };
    fSw.draw = (g, w, h) => { const Pl = L.plot(g, L.pad(w, h, { t: 18, l: 50 }), { xd: [0, 0.9], yd: [0, 1], xlabel: 'rubble density', xfmt: (v) => Math.round(v * 100) + ' %', yfmt: (v) => Math.round(v * 100) + ' %' }); L.text(g, 'share of the way reached', 50, 11, { color: 'text3', size: 11 }); if (!sweep) return; for (const [y, c] of [[sweep.l, 'accent'], [sweep.w, 'ok']]) { L.trace(g, Pl, sweep.xs, y, { color: c, n: y.length }); L.dots(g, Pl, sweep.xs.slice(0, y.length), y, { color: c }); } L.rule(g, Pl, { x: P.rough, color: 'text2' }); };
    const sW = L.stat('of the way on wheels', { unit: '%' }), sL = L.stat('of the way on legs', { unit: '%' }), sA = L.stat('ground wheels can reach', { unit: '%' }), sB = L.stat('ground legs can reach', { unit: '%' }), sC = L.stat('map cells misjudged for wheels', { unit: '%' }), sD = L.stat('map cells misjudged for legs', { unit: '%' }), sE = L.stat('steps on the leg plan that the true ground breaks');
    function paint() { const far = (p) => p.far; sW.set(L.pct(far(S.pw))); sL.set(L.pct(far(S.pl))); sL.tone(S.pl.done ? 'ok' : 'warn'); sW.tone(S.pw.done ? 'ok' : 'warn'); sA.set(L.pct(S.w.f)); sB.set(L.pct(S.l.f)); sC.set(L.pct(S.wrongW, 1)); sD.set(L.pct(S.wrongL, 1)); sE.set(S.bl + ' of ' + S.pl.p.length); sE.tone(S.bl ? 'warn' : 'ok');
      fIso.setTitle(S.pl.done && !S.pw.done ? 'Planned on the sensed map: legs reach the person, 80 mm wheels get ' + L.pct(far(S.pw)) + ' % of the way' : S.pl.done ? 'Both reach the person on this ground' : 'Neither reaches the person on this ground'); fIso.setNote('Simulated ground, 12 by 7 m, with a stair. Tinted: everywhere ' + (P.view === 'legs' ? 'legs' : 'wheels') + ' can reach on the sensed map. Wheel step limit 3 cm and leg limits are design values.'); fPr.setNote('The true ground under each planned path.'); const gap = sweep && sweep.w.length > 4 ? sweep.l.reduce((s, v, i) => s + v - sweep.w[i], 0) / sweep.w.length : 0; fSw.setTitle(gap > 0.08 ? 'Legs get farther than wheels, by ' + L.pct(gap) + ' % of the way on average' : 'How far each gets as rubble thickens'); fSw.setNote('Straight-line distance to the person closed by the plan; four new grounds per point, stairs included.'); fIso.redraw(); fPr.redraw(); fSw.redraw(); }
    readout.append(L.h('h4', null, 'Measured against the simulated truth'), sW.el, sL.el, sA.el, sB.el, sC.el, sD.el, sE.el);
    controls.append(
      L.seg({ label: 'Tint the ground for', value: 'legs', options: [{ value: 'legs', label: 'Legs' }, { value: 'wheels', label: 'Wheels' }], onChange: (v) => { P.view = v; paint(); } }).el,
      L.slider({ label: 'Rubble density', min: 0, max: 0.9, step: 0.05, value: P.rough, format: (v) => Math.round(v * 100) + ' %', onInput: (v) => { P.rough = v; C(); } }).el,
      L.slider({ label: 'Highest step a leg takes (assumed)', min: 0.06, max: 0.35, step: 0.01, value: P.leg, format: (v) => Math.round(v * 100) + ' cm', onInput: (v) => { P.leg = v; C(); } }).el,
      L.slider({ label: 'Stair height', min: 0.05, max: 0.25, step: 0.01, value: P.rise, format: (v) => Math.round(v * 100) + ' cm', onInput: (v) => { P.rise = v; C(); } }).el,
      L.slider({ label: 'Noise in the sensed heights', min: 0, max: 0.04, step: 0.002, value: P.noise, format: (v) => (v * 100).toFixed(1) + ' cm', onInput: (v) => { P.noise = v; C(); } }).el,
      L.row(L.button({ label: 'New ground', icon: 'reset', onClick: () => { P.seed++; compute(); } })));
    compute();
    const loop = L.loop((dt) => { clock += dt; fIso.redraw(); });
    return { start() { paint(); loop.start(); }, stop() { loop.stop(); } };
  },
};
