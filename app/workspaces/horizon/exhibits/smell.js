// The smell of a person: an electronic nose in the rubble.
// Everything is computed here: a ventilated-void source model with emission rates from the literature, transport
// along a crack, seven cross-sensitive sensors with humidity, drift and noise, and a multinomial logistic
// regression that is trained in this page on simulated sniffs and scored on sniffs it has never seen.
//
// Published numbers used (everything else is assumed and says so on screen):
//  - Sensor set and detection limits: Si-doped WO3 (acetone, 19 ppb), Si-doped MoO3 (ammonia, 21 ppb), Ti-doped ZnO
//    (isoprene, 3 ppb), a commercial CO2 sensor and a humidity sensor. Guntner et al., Anal. Chem. 90 (2018).
//  - CO2 around a trapped volunteer reached 1.6 % on average; CO2, ammonia and acetone were the useful markers.
//    Huo et al., J. Breath Res. 5 (2011).
//  - Whole-body emission per person: acetone about 0.24 to 0.47 mg/h seated, isoprene about 0.12 mg/h, ammonia 0.3 to
//    12 mg/h (chamber studies, e.g. Wang et al., Environ. Sci. Technol. 2022, and reviews). Central values are used.
//  - CO2 15 L/h is a resting adult (textbook value). Animal and decoy mixtures, the response matrix, the void volume
//    and the mixing length along the crack are assumed.
import * as L from '../lib.js';
const { TAU, clamp } = L;

// gases: concentrations are kept in ppb; humidity in % relative humidity
const GAS = [
  { name: 'Carbon dioxide', M: 44.01, bg: [4.1e5, 5.6e5] },
  { name: 'Acetone', M: 58.08, bg: [1, 5], lod: 19 },
  { name: 'Isoprene', M: 68.12, bg: [0.2, 1], lod: 3 },
  { name: 'Ammonia', M: 17.03, bg: [5, 20], lod: 21 },
  { name: 'Carbon monoxide', M: 28.01, bg: [100, 500] },
  { name: 'Sulphides', M: 34.08, bg: [0.1, 1] },
  { name: 'Other vapours', M: 80, bg: [20, 100] },
];
const NG = 7, RH = 7;
const CLASSES = [
  { id: 'empty', name: 'Empty void', word: 'empty', color: 'text3' },
  { id: 'person', name: 'Person', word: 'person', color: 'person' },
  { id: 'animal', name: 'Animal', word: 'animal', color: 'warn' },
  { id: 'smoulder', name: 'Smouldering fire', word: 'smouldering fire', color: 'danger' },
  { id: 'generator', name: 'Generator exhaust', word: 'generator exhaust', color: 'text2' },
  { id: 'rot', name: 'Rot or sewage', word: 'rot', color: 'sim' },
];
const NC = CLASSES.length, PERSON = 1;
const SENSORS = [
  { name: 'CO2, infrared', short: 'CO2' },
  { name: 'Humidity', short: 'RH' },
  { name: 'Si:WO3, acetone', short: 'Si:WO3' },
  { name: 'Si:MoO3, ammonia', short: 'Si:MoO3' },
  { name: 'Ti:ZnO, isoprene', short: 'Ti:ZnO' },
  { name: 'SnO2, broadband', short: 'SnO2' },
  { name: 'CO cell', short: 'CO' },
];
const NS = SENSORS.length;
// Metal-oxide response = humidity x drift x sum_j a_j (c_j / 100 ppb)^beta + noise. Columns: acetone, isoprene, ammonia, CO, sulphides, other vapours.
// Assumed, except that each doped oxide is selective for its own gas (Guntner 2018) and that its noise is set so three sigma equals the published limit.
const MOX = [
  { s: 2, a: [1.0, 0.10, 0.04, 0.0015, 0.10, 0.05], beta: 0.7, lod: [0, 19], hum: 0.25 },
  { s: 3, a: [0.03, 0.03, 1.0, 0.001, 0.25, 0.03], beta: 0.7, lod: [2, 21], hum: 0.30 },
  { s: 4, a: [0.12, 1.0, 0.03, 0.002, 0.08, 0.10], beta: 0.7, lod: [1, 3], hum: 0.20 },
  { s: 5, a: [0.30, 0.30, 0.10, 0.02, 0.50, 0.50], beta: 0.6, sigma: 0.10, hum: 0.50 },
];
for (const m of MOX) if (m.lod) m.sigma = (m.a[m.lod[0]] * (m.lod[1] / 100) ** m.beta) / 3;
const VOID_M3 = 1.5;            // assumed volume of the void
const MIX_M = 1.0;              // assumed: at one air change an hour, void air is diluted e-fold every metre of crack
const SOLUBLE = [0, 8, 0, 2.5, 0, 4, 0];   // assumed extra loss length, m, to wet debris (ammonia most; Huo 2011 flags the effect)
const RANGE = { d: [0.3, 5], ach: [0.2, 8], hours: [0.5, 72] };

const lnN = (R, s) => Math.exp(s * R.n());
const logU = (R, a, b) => a * (b / a) ** R();
// What the source gives off: [CO2 L/h, acetone, isoprene, ammonia, CO, sulphides, other vapours mg/h], and humidity added in the void.
function emit(cls, R, hours) {
  const e = new Float64Array(NG); let rh = 0;
  const person = (k) => { const fast = 1 + Math.min(2, 0.06 * hours);   // breath acetone climbs as a person fasts (assumed slope)
    e[0] += k * 15 * lnN(R, 0.2); e[1] += k * 0.35 * fast * lnN(R, 0.45); e[2] += k * 0.12 * lnN(R, 0.45); e[3] += k * 1.5 * lnN(R, 0.6); e[4] += k * 0.02; e[6] += k * 0.7 * lnN(R, 0.4); rh += 18 * Math.min(1, k * 2); };
  if (cls === 1) person(1);
  else if (cls === 2) { const k = R.range(0.05, 0.45), b = e.slice(); person(k); e[1] = b[1] + (e[1] - b[1]) * 0.8; e[2] = b[2] + (e[2] - b[2]) * 0.3; e[3] = b[3] + (e[3] - b[3]) * 1.6; }   // smaller; less isoprene, more ammonia (assumed)
  else if (cls === 3) { e[0] += logU(R, 5, 60); e[4] += logU(R, 300, 3000); e[6] += logU(R, 20, 300); e[1] += logU(R, 0.2, 3); e[2] += logU(R, 0.02, 0.3); e[3] += logU(R, 0.2, 3); rh -= 5; }
  else if (cls === 4) { e[0] += logU(R, 20, 200); e[4] += logU(R, 100, 2000); e[6] += logU(R, 10, 100); e[1] += logU(R, 0.01, 0.1); }
  else if (cls === 5) { e[0] += logU(R, 1, 10); e[3] += logU(R, 5, 80); e[5] += logU(R, 0.5, 10); e[6] += logU(R, 2, 30); e[1] += logU(R, 0.02, 0.3); rh += 15; }
  else { if (R() < 0.4) { e[3] += R.range(0, 0.15); rh += R.range(5, 25); } else { R(); R(); } }   // wet concrete: a little ammonia, damp air
  return { e, rh };
}
function addSmoke(src, R) { const k = R.range(0.1, 0.6), s = emit(3, R, 0); for (let j = 0; j < NG; j++) src.e[j] += k * s.e[j]; return src; }
function background(R) { const b = new Float64Array(NG + 1); for (let j = 0; j < NG; j++) b[j] = logU(R, GAS[j].bg[0], GAS[j].bg[1]); b[RH] = R.range(30, 92); return b; }
// Steady ventilated box, then dilution along the crack. Returns the air at the sensor head and in the void.
function air(src, bg, d, ach, hours) {
  const Q = ach * VOID_M3, build = 1 - Math.exp(-ach * hours), mix = Math.exp(-d / (MIX_M * ach ** 0.6));
  const c = new Float64Array(NG + 1), v = new Float64Array(NG + 1);
  for (let j = 0; j < NG; j++) { const add = j === 0 ? (src.e[0] / (Q * 1000)) * 1e9 * build : (src.e[j] / Q) * (24450 / GAS[j].M) * build; v[j] = bg[j] + add; c[j] = bg[j] + add * mix * (SOLUBLE[j] ? Math.exp(-d / SOLUBLE[j]) : 1); }
  v[RH] = clamp(bg[RH] + src.rh * build, 5, 100); c[RH] = bg[RH] + (v[RH] - bg[RH]) * mix;
  return { c, v };
}
// The nose: seven readings turned into seven features. g scales noise and drift.
function sense(c, R, g, out) {
  const x = out || new Float64Array(NS), rh = c[RH];
  x[0] = Math.log(Math.max(200, (c[0] / 1000) * (1 + 0.02 * g * R.n()) + 25 * g * R.n()) / 400);
  x[1] = (rh + 2 * g * R.n()) / 100;
  for (const m of MOX) { let s = 0; for (let j = 0; j < 6; j++) s += m.a[j] * (c[j + 1] / 100) ** m.beta; s = s * (1 - (m.hum * (rh - 50)) / 50) * Math.exp(0.08 * g * R.n()) + m.sigma * g * R.n(); x[m.s] = Math.asinh(s / m.sigma); }
  x[6] = Math.asinh((c[4] / 1000 + 0.3 * (c[5] / 1000) + 0.4 * g * R.n()) / 0.4);
  return x;
}

// ---------- multinomial logistic regression, trained by Adam on the full batch ----------
function makeModel(mask) { const n = NC * (NS + 1); return { w: new Float64Array(n), m: new Float64Array(n), v: new Float64Array(n), mask, step: 0, loss: [] }; }
function probs(M, z, out) { let mx = -Infinity; for (let c = 0; c < NC; c++) { let s = M.w[c * (NS + 1) + NS]; for (let j = 0; j < NS; j++) s += M.w[c * (NS + 1) + j] * z[j] * M.mask[j]; out[c] = s; if (s > mx) mx = s; } let sum = 0; for (let c = 0; c < NC; c++) { out[c] = Math.exp(out[c] - mx); sum += out[c]; } for (let c = 0; c < NC; c++) out[c] /= sum; return out; }
function trainStep(M, X, y, n) {
  const g = new Float64Array(M.w.length), p = new Float64Array(NC), z = new Float64Array(NS); let loss = 0;
  for (let i = 0; i < n; i++) { for (let j = 0; j < NS; j++) z[j] = X[i * NS + j]; probs(M, z, p); loss -= Math.log(p[y[i]] + 1e-12);
    for (let c = 0; c < NC; c++) { const e = p[c] - (c === y[i] ? 1 : 0), o = c * (NS + 1); for (let j = 0; j < NS; j++) g[o + j] += e * z[j] * M.mask[j]; g[o + NS] += e; } }
  M.step++; const lr = 0.08, b1 = 0.9, b2 = 0.999;
  for (let k = 0; k < g.length; k++) { const gk = g[k] / n + 1e-4 * M.w[k]; M.m[k] = b1 * M.m[k] + (1 - b1) * gk; M.v[k] = b2 * M.v[k] + (1 - b2) * gk * gk; M.w[k] -= (lr * (M.m[k] / (1 - b1 ** M.step))) / (Math.sqrt(M.v[k] / (1 - b2 ** M.step)) + 1e-8); }
  M.loss.push(loss / n);
}

const fmtGas = (ppb) => (ppb < 9.95 ? ppb.toFixed(1) + ' ppb' : ppb < 999.5 ? Math.round(ppb) + ' ppb' : ppb < 9950 ? (ppb / 1000).toFixed(1) + ' ppm' : ppb < 9.95e6 ? Math.round(ppb / 1000).toLocaleString('en-US') + ' ppm' : (ppb / 1e7).toFixed(1) + ' %');
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export default {
  id: 'smell', title: 'The smell of a person', short: 'Smell',
  readiness: 0.85, readinessNote: 'Shown with volunteers in a laboratory collapse simulator (2011) and in sealed chambers (2018). An EU project built a portable locator with gas sensors, but its published field work used pig carcasses, not living people. HOUND has no gas sensors.',
  standoff: [0.3, 5],
  labels: ['concept', 'live-algo'],
  labelNote: 'The air, the rubble and the seven sensors are simulated. Emission rates and the three detection limits come from the papers below; the response matrix, the decoys and the transport along the crack are assumed. The classifier is really trained and tested in this page, on simulated sniffs only.',
  sentences: [
    'A trapped person keeps giving off carbon dioxide from breath, and acetone, isoprene and ammonia at parts per billion from breath and skin; a handful of small gas sensors, an electronic nose, can look for that pattern in the air of a void.',
    'A smell does not need a line of sight or a sound: it seeps through gaps that block a camera, and it is there while a person is unconscious, as long as they breathe.',
  ],
  needs: 'Air has to move from the void to the sensor head, so the head must get within a few metres through a gap. The sensors must hold their calibration through dust, damp concrete and smoke, and the pattern must be learned from real collapses, not from a simulation like this one.',
  unknown: 'How the mixture changes in real rubble: wet debris soaks up ammonia and acetone, and no one has published sensor-array data from living people under a real collapse. Telling a person from a large animal by smell alone is not solved here, and this is not a medical reading: it says something is breathing, not how anyone is.',
  sources: [
    { who: 'Güntner, Pineau, Mochalski, Wiesenhofer, Agapiou, Mayhew and Pratsinis, ETH Zurich', year: 2018, title: 'Sniffing entrapped humans with sensor arrays', where: 'Analytical Chemistry 90(8)', url: 'https://doi.org/10.1021/acs.analchem.8b00237' },
    { who: 'Huo et al., Loughborough University', year: 2011, title: 'The trapped human experiment', where: 'Journal of Breath Research 5(4)', url: 'https://doi.org/10.1088/1752-7155/5/4/046006' },
    { who: 'SGL for USaR consortium', year: 2012, title: 'Second generation locator for urban search and rescue operations: final report summary', where: 'European Commission, CORDIS, project 217967', url: 'https://cordis.europa.eu/project/id/217967/reporting' },
  ],
  glyph(g, s, t, c) {
    g.fillStyle = c.person; g.beginPath(); g.arc(0, s * 0.3, 2.6, 0, TAU); g.fill();
    for (let k = -1; k <= 1; k++) { g.globalAlpha = 0.45 + 0.4 * Math.sin(t * 0.9 + k * 1.7) ** 2; g.beginPath(); for (let i = 0; i <= 12; i++) { const y = s * 0.18 - (i / 12) * s * 0.52, x = k * s * 0.17 * (0.5 + i / 16) + Math.sin(i * 0.9 + t * 1.2 + k) * 1.8; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    g.globalAlpha = 1;
  },

  create({ stage, controls, readout }) {
    L.layout(stage, { cols: 'minmax(0, 1.28fr) minmax(0, 1fr)', rows: 'minmax(0, 1.12fr) minmax(0, 1fr)', areas: ['hero map', 'hero det'] });
    const fHero = L.figure({ area: 'hero', title: 'Training the nose on simulated sniffs…' });
    const fMap = L.figure({ area: 'map', title: 'Sensor space, as the classifier learns it' });
    const fDet = L.figure({ area: 'det', title: 'How far through the rubble a person can be smelled' });
    stage.append(fHero.el, fMap.el, fDet.el);
    const T = L.tokens();

    const P = { scene: 'person', d: 1.5, ach: 1, hours: 6, noise: 1, co2: true, who: 4 };
    const NTR = 3600, NTE = 1500, STEPS = 240;
    let D = null, done = false, cur = null, det = null, hold = null;
    const A = makeModel(new Float64Array(NS).fill(1)), B = makeModel(Float64Array.from({ length: NS }, (_, j) => (j === 0 ? 0 : 1)));
    const live = () => (P.co2 ? A : B);

    // ---- the data: labelled sniffs across random conditions ----
    function sample(R, cls, g, fixed) {
      const hours = fixed ? fixed.hours : logU(R, ...RANGE.hours), src = emit(cls, R, hours); if (cls === PERSON && !fixed && R() < 0.25) addSmoke(src, R);
      return air(src, background(R), fixed ? fixed.d : R.range(...RANGE.d), fixed ? fixed.ach : logU(R, ...RANGE.ach), hours).c;
    }
    function makeData() {
      const R = L.rng(20261), n = NTR + NTE, X = new Float64Array(n * NS), y = new Uint8Array(n), x = new Float64Array(NS);
      for (let i = 0; i < n; i++) { y[i] = i % NC; sense(sample(R, y[i], 1), R, 1, x); X.set(x, i * NS); }
      const mu = new Float64Array(NS), sd = new Float64Array(NS);
      for (let i = 0; i < NTR; i++) for (let j = 0; j < NS; j++) mu[j] += X[i * NS + j] / NTR;
      for (let i = 0; i < NTR; i++) for (let j = 0; j < NS; j++) sd[j] += (X[i * NS + j] - mu[j]) ** 2 / NTR;
      for (let j = 0; j < NS; j++) sd[j] = Math.sqrt(sd[j]) || 1;
      for (let i = 0; i < n; i++) for (let j = 0; j < NS; j++) X[i * NS + j] = (X[i * NS + j] - mu[j]) / sd[j];
      // principal components of the training sniffs: power iteration with deflation on the 7 x 7 covariance
      const C = new Float64Array(NS * NS); for (let i = 0; i < NTR; i++) for (let a = 0; a < NS; a++) for (let b = 0; b < NS; b++) C[a * NS + b] += (X[i * NS + a] * X[i * NS + b]) / NTR;
      let tr = 0; for (let a = 0; a < NS; a++) tr += C[a * NS + a];
      const pcs = [], ev = [];
      for (let k = 0; k < 2; k++) { let v = Float64Array.from({ length: NS }, (_, j) => 1 + 0.1 * j), lam = 0;
        for (let it = 0; it < 200; it++) { const u = new Float64Array(NS); for (let a = 0; a < NS; a++) for (let b = 0; b < NS; b++) u[a] += C[a * NS + b] * v[b]; lam = Math.hypot(...u); for (let a = 0; a < NS; a++) v[a] = u[a] / lam; }
        let big = 0; for (let a = 1; a < NS; a++) if (Math.abs(v[a]) > Math.abs(v[big])) big = a; if (v[big] < 0) v = v.map((q) => -q);
        pcs.push(v); ev.push(lam / tr); for (let a = 0; a < NS; a++) for (let b = 0; b < NS; b++) C[a * NS + b] -= lam * v[a] * v[b]; }
      const proj = (z) => { let a = 0, b = 0; for (let j = 0; j < NS; j++) { a += z[j] * pcs[0][j]; b += z[j] * pcs[1][j]; } return [a, b]; };
      const te = new Float32Array(NTE * 2), ext = [Infinity, -Infinity, Infinity, -Infinity], cen = CLASSES.map(() => [0, 0, 0]), mean = CLASSES.map(() => new Float64Array(NS));
      for (let i = 0; i < NTE; i++) { const z = X.subarray((NTR + i) * NS, (NTR + i + 1) * NS), q = proj(z), c = y[NTR + i]; te[2 * i] = q[0]; te[2 * i + 1] = q[1]; cen[c][0] += q[0]; cen[c][1] += q[1]; cen[c][2]++; ext[0] = Math.min(ext[0], q[0]); ext[1] = Math.max(ext[1], q[0]); ext[2] = Math.min(ext[2], q[1]); ext[3] = Math.max(ext[3], q[1]); }
      for (let i = 0; i < NTR; i++) for (let j = 0; j < NS; j++) mean[y[i]][j] += X[i * NS + j] / (NTR / NC);
      const lo = new Float64Array(NS).fill(Infinity), hi = new Float64Array(NS).fill(-Infinity); for (let i = 0; i < NTR; i++) for (let j = 0; j < NS; j++) { const v = X[i * NS + j]; if (v < lo[j]) lo[j] = v; if (v > hi[j]) hi[j] = v; }
      const q1 = Array.from({ length: NTE }, (_, i) => te[2 * i]).sort((a, b) => a - b), q2 = Array.from({ length: NTE }, (_, i) => te[2 * i + 1]).sort((a, b) => a - b), pc = (q, f) => q[Math.floor(f * (NTE - 1))];
      ext[0] = pc(q1, 0.01) - 0.6; ext[1] = pc(q1, 0.99) + 0.6; ext[2] = pc(q2, 0.01) - 0.6; ext[3] = pc(q2, 0.99) + 0.6;
      D = { X, y, mu, sd, pcs, ev, proj, te, ext, cen: cen.map((c) => [c[0] / c[2], c[1] / c[2]]), mean, lo, hi };
    }
    const standard = (x, z) => { for (let j = 0; j < NS; j++) z[j] = (x[j] - D.mu[j]) / D.sd[j]; return z; };

    // ---- scoring on the held-out sniffs ----
    function score() {
      const p = new Float64Array(NC), conf = CLASSES.map(() => new Float64Array(NC)), pos = [], neg = [], pred = new Uint8Array(NTE); let ok = 0;
      for (let i = 0; i < NTE; i++) { const c = D.y[NTR + i]; probs(A, D.X.subarray((NTR + i) * NS, (NTR + i + 1) * NS), p); let b = 0; for (let k = 1; k < NC; k++) if (p[k] > p[b]) b = k; pred[i] = b; conf[c][b]++; if (b === c) ok++; (c === PERSON ? pos : neg).push(p[PERSON]); }
      neg.sort((a, b) => a - b); const thr = neg[Math.floor(neg.length * 0.95)], tpr = pos.filter((s) => s > thr).length / pos.length;
      let worst = { r: 0, a: 0, b: 1 }; for (let a = 0; a < NC; a++) for (let b = 0; b < NC; b++) if (a !== b) { const r = conf[a][b] / (NTE / NC); if (r > worst.r) worst = { r, a, b }; }
      D.score = { acc: ok / NTE, tpr, thr, worst, conf, pred, animalAsPerson: conf[2][PERSON] / (NTE / NC) };
    }

    // ---- the scene the visitor steers ----
    const sceneClass = () => (P.scene === 'both' ? PERSON : CLASSES.findIndex((c) => c.id === P.scene));
    function truth() {
      const R = L.rng(900 + P.who * 7 + sceneClass()), src = emit(sceneClass(), R, P.hours); if (P.scene === 'both') addSmoke(src, L.rng(77 + P.who));
      const bg = new Float64Array(NG + 1); for (let j = 0; j < NG; j++) bg[j] = Math.sqrt(GAS[j].bg[0] * GAS[j].bg[1]); bg[RH] = 55;
      return { ...air(src, bg, P.d, P.ach, P.hours), bg };
    }
    let sniffSeed = 1;
    function sniff() { // one fresh reading of the current air
      const R = L.rng(5000 + sniffSeed++), x = sense(cur.air.c, R, P.noise), z = standard(x, new Float64Array(NS)), p = probs(live(), z, new Float64Array(NC));
      return { z, p, q: D.proj(z) };
    }
    function update() { // recompute everything that follows from the controls
      if (!D) return;
      const a = truth(), R = L.rng(4242), mean = new Float64Array(NC), zbar = new Float64Array(NS), x = new Float64Array(NS), z = new Float64Array(NS), p = new Float64Array(NC), K = 48;
      for (let k = 0; k < K; k++) { sense(a.c, R, P.noise, x); standard(x, z); probs(live(), z, p); for (let c = 0; c < NC; c++) mean[c] += p[c] / K; for (let j = 0; j < NS; j++) zbar[j] += z[j] / K; }
      let top = 0; for (let c = 1; c < NC; c++) if (mean[c] > mean[top]) top = c;
      const prev = cur; cur = { air: a, mean, zbar, top, s: null, trail: prev ? prev.trail : [] }; cur.s = sniff(); cur.from = prev?.s?.q || cur.s.q; cur.at = 0;
      if (done) detect();
      report(); fHero.redraw(); fMap.redraw(); fDet.redraw();
    }
    // Monte Carlo: people at each distance against decoys everywhere, both models, at the current airflow, hours and noise
    const DX = Array.from({ length: 13 }, (_, i) => 0.3 + (i * 4.7) / 12);
    function detect() {
      const x = new Float64Array(NS), z = new Float64Array(NS), p = new Float64Array(NC), R = L.rng(31), nNeg = 1500, nPos = 220, negA = [], negB = [];
      for (let i = 0; i < nNeg; i++) { const c = [0, 2, 3, 4, 5][i % 5]; sense(sample(R, c, P.noise), R, P.noise, x); standard(x, z); negA.push(probs(A, z, p)[PERSON]); negB.push(probs(B, z, p)[PERSON]); }
      negA.sort((a, b) => a - b); negB.sort((a, b) => a - b); const tA = negA[Math.floor(nNeg * 0.95)], tB = negB[Math.floor(nNeg * 0.95)];
      const yA = [], yB = [];
      DX.forEach((d) => { const Rd = L.rng(77); let a = 0, b = 0; for (let i = 0; i < nPos; i++) { sense(sample(Rd, PERSON, P.noise, { d, ach: P.ach, hours: P.hours }), Rd, P.noise, x); standard(x, z); if (probs(A, z, p)[PERSON] > tA) a++; if (probs(B, z, p)[PERSON] > tB) b++; } yA.push(a / nPos); yB.push(b / nPos); });
      const reach = (ys) => { if (ys[0] < 0.5) return 0; for (let i = 1; i < ys.length; i++) if (ys[i] < 0.5) return DX[i - 1] + ((ys[i - 1] - 0.5) / (ys[i - 1] - ys[i])) * (DX[i] - DX[i - 1]); return Infinity; };
      const at = (ys, d) => { const f = clamp(((d - 0.3) / 4.7) * 12, 0, 12), i = Math.min(11, f | 0); return ys[i] + (ys[i + 1] - ys[i]) * (f - i); };
      det = { yA, yB, rA: reach(yA), rB: reach(yB), at };
    }

    // ---- hero: the void, the crack, the sensor head, then air -> nose -> answer ----
    const PATH = [[2.0, 2.45], [2.5, 2.3], [3.0, 2.6], [3.7, 2.2], [4.2, 2.35], [4.9, 1.8], [5.4, 1.95], [6.0, 1.3], [6.4, 0.9], [6.9, 0.55]];
    const SEG = PATH.slice(1).map((p, i) => Math.hypot(p[0] - PATH[i][0], p[1] - PATH[i][1])), PLEN = SEG.reduce((a, b) => a + b, 0);
    const along = (s) => { s = clamp(s, 0, PLEN); for (let i = 0; i < SEG.length; i++) { if (s <= SEG[i] || i === SEG.length - 1) { const f = s / SEG[i]; return [PATH[i][0] + (PATH[i + 1][0] - PATH[i][0]) * f, PATH[i][1] + (PATH[i + 1][1] - PATH[i][1]) * f, i]; } s -= SEG[i]; } };
    const VOIDP = [[0.15, 2.2], [0.6, 2.04], [1.3, 2.1], [1.95, 2.25], [2.08, 2.47], [1.9, 2.82], [1.2, 2.9], [0.4, 2.86], [0.12, 2.6]];
    const slabs = (() => { const R = L.rng(12), out = []; for (let i = 0; i < 150; i++) { const x = R.range(-0.2, 7.4), y = R.range(0.62, 3.1), w = R.range(0.35, 1.5), hh = R.range(0.07, 0.24), a = R.n() * 0.35 + (R() < 0.12 ? 1.2 : 0); out.push({ x, y, w, hh, a, tone: R() }); } return out; })();
    const motes = (() => { const R = L.rng(4); return Array.from({ length: 150 }, () => ({ ph: R(), off: R.n(), sp: 0.7 + 0.6 * R(), w: R() * TAU })); })();
    let geo = null, dragging = false, time = 0;

    function drawSource(g, X, Y, u, t) {
      const sc = P.scene, pulse = L.reduced() ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.5);
      if (sc === 'smoulder' || sc === 'both') { const bx = sc === 'both' ? 0.42 : 1.0; for (let k = 0; k < 7; k++) { const fl = L.reduced() ? 0.7 : 0.55 + 0.45 * Math.sin(t * (2 + k * 0.7) + k); g.fillStyle = L.rgba('danger', 0.35 + 0.5 * fl); g.beginPath(); g.arc(X(bx + ((k * 0.37) % 1) * 0.5 - 0.2), Y(2.3 - ((k * 0.61) % 1) * 0.1 - (sc === 'both' ? 0.02 : -0.5)), u * (0.03 + 0.02 * (k % 3)), 0, TAU); g.fill(); } }
      if (sc === 'person' || sc === 'both') { g.strokeStyle = T.person; g.fillStyle = T.person; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.arc(X(0.5), Y(2.68), u * 0.1, 0, TAU); g.fill();
        g.lineWidth = u * (0.2 + 0.012 * pulse); g.beginPath(); g.moveTo(X(0.72), Y(2.72)); g.lineTo(X(1.16), Y(2.73)); g.stroke();
        g.lineWidth = u * 0.11; g.beginPath(); g.moveTo(X(1.2), Y(2.74)); g.lineTo(X(1.5), Y(2.6)); g.lineTo(X(1.82), Y(2.77)); g.stroke();
        g.lineWidth = u * 0.07; g.beginPath(); g.moveTo(X(0.78), Y(2.66)); g.lineTo(X(1.02), Y(2.55)); g.lineTo(X(1.14), Y(2.63)); g.stroke(); }
      if (sc === 'animal') { g.strokeStyle = T.warn; g.fillStyle = T.warn; g.lineCap = 'round'; g.lineWidth = u * 0.035;
        g.beginPath(); g.ellipse(X(1.0), Y(2.7), u * 0.2, u * (0.085 + 0.006 * pulse), 0, 0, TAU); g.fill(); g.beginPath(); g.arc(X(0.76), Y(2.63), u * 0.07, 0, TAU); g.fill();
        g.beginPath(); g.moveTo(X(0.71), Y(2.58)); g.lineTo(X(0.69), Y(2.52)); g.moveTo(X(1.2), Y(2.68)); g.quadraticCurveTo(X(1.34), Y(2.6), X(1.3), Y(2.52)); g.moveTo(X(0.88), Y(2.76)); g.lineTo(X(0.86), Y(2.86)); g.moveTo(X(1.12), Y(2.76)); g.lineTo(X(1.14), Y(2.86)); g.stroke(); }
      if (sc === 'generator') { g.strokeStyle = T.text2; g.lineWidth = 1.25; g.fillStyle = T.bg3; g.beginPath(); g.rect(X(0.35), Y(0.2), u * 0.55, u * 0.34); g.fill(); g.stroke(); g.beginPath(); g.moveTo(X(0.44), Y(0.2)); g.lineTo(X(0.44), Y(0.12)); g.lineTo(X(0.8), Y(0.12)); g.lineTo(X(0.8), Y(0.2)); g.stroke();
        g.setLineDash([3, 4]); g.strokeStyle = L.rgba('text2', 0.8); g.beginPath(); g.moveTo(X(0.9), Y(0.42)); g.bezierCurveTo(X(1.5), Y(0.6), X(0.7), Y(1.5), X(1.1), Y(2.12)); g.stroke(); g.setLineDash([]); }
      if (sc === 'rot') { g.fillStyle = L.rgba('sim', 0.75); for (let k = 0; k < 6; k++) { g.beginPath(); g.ellipse(X(0.7 + k * 0.15), Y(2.78 - (k % 2) * 0.05), u * (0.07 + 0.02 * (k % 3)), u * 0.05, 0, 0, TAU); g.fill(); } }
    }
    const SCENE_WORD = { person: 'a person', animal: 'an animal (the hard case)', smoulder: 'a smouldering fire', generator: 'generator exhaust, drawn in', rot: 'rotting food and sewage', empty: 'nothing: wet concrete only', both: 'a person, and smoke' };

    function drawScene(g, w, sh, t) {
      const u = Math.min(w / 7.2, sh / 3.15), ox = (w - u * 7.2) / 2, X = (x) => ox + x * u, Y = (y) => y * u; geo = { u, ox, sh: u * 3.15 };
      g.save(); g.beginPath(); g.rect(0, 0, w, u * 3.15); g.clip();
      // rubble: slabs below a rough surface line
      g.fillStyle = T.bg1; g.fillRect(0, Y(0.55), w, u * 2.6);
      for (const s of slabs) { g.save(); g.translate(X(s.x), Y(s.y)); g.rotate(s.a); g.fillStyle = s.tone < 0.5 ? T.bg2 : s.tone < 0.85 ? T.bg3 : T.bg4; g.strokeStyle = T.line2; g.lineWidth = 1; g.beginPath(); g.rect((-s.w * u) / 2, (-s.hh * u) / 2, s.w * u, s.hh * u); g.fill(); g.stroke(); if (s.tone > 0.9) { g.strokeStyle = L.rgba('text3', 0.5); g.beginPath(); g.moveTo((-s.w * u) / 2 - 0.12 * u, 0); g.lineTo((s.w * u) / 2 + 0.16 * u, 0); g.stroke(); } g.restore(); }
      g.fillStyle = T.bg0; g.fillRect(0, 0, w, Y(0.5)); g.strokeStyle = T.line3; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Y(0.5)); for (let x = 0; x <= 7.4; x += 0.2) g.lineTo(X(x), Y(0.5 + 0.05 * Math.sin(x * 5.1) + 0.03 * Math.sin(x * 13))); g.stroke();
      // the void and the crack
      const pathLine = (a, b) => { g.beginPath(); const n = 60; for (let i = 0; i <= n; i++) { const p = along(a + ((b - a) * i) / n); i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])); } };
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = T.line3; g.lineWidth = u * 0.13 + 2; pathLine(0, PLEN); g.stroke(); g.strokeStyle = T.bg0; g.lineWidth = u * 0.13; pathLine(0, PLEN); g.stroke();
      g.fillStyle = T.bg0; g.strokeStyle = T.line3; g.lineWidth = 1; g.beginPath(); VOIDP.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.closePath(); g.fill(); g.stroke();
      // how strong the source is, as seen by the sum of the trace gases (drives the look of the plume only)
      const a = cur.air, strength = clamp(Math.log10(1 + (a.v[1] - a.bg[1]) / 20 + (a.v[3] - a.bg[3]) / 200 + (a.v[4] - a.bg[4]) / 2e4 + (a.v[0] - a.bg[0]) / 2e6) / 1.6), ell = MIX_M * P.ach ** 0.6;
      if (strength > 0.01) { const gr = g.createRadialGradient(X(1.1), Y(2.5), 2, X(1.1), Y(2.5), u * 1.1); gr.addColorStop(0, L.rgba('text', 0.16 * strength)); gr.addColorStop(1, L.rgba('text', 0)); g.fillStyle = gr; g.beginPath(); VOIDP.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.fill(); }
      for (const m of motes) { const s = ((m.ph + (L.reduced() ? 0 : t * 0.045 * m.sp * P.ach ** 0.6)) % 1) * PLEN, p = along(s), al = strength * Math.exp(-s / ell) * 0.9; if (al < 0.02) continue; const q = along(s + 0.05), nx = -(q[1] - p[1]), ny = q[0] - p[0], nl = Math.hypot(nx, ny) || 1, off = 0.04 * m.off + 0.012 * Math.sin(t * 2 + m.w); g.fillStyle = L.rgba('text', Math.min(0.85, al)); g.fillRect(X(p[0] + (nx / nl) * off) - 1, Y(p[1] + (ny / nl) * off) - 1, 2, 2); }
      drawSource(g, X, Y, u, t);
      // the probe: a tube from the surface down the crack to the sensor head
      const hp = along(P.d); g.strokeStyle = T.accent; g.lineWidth = 2; pathLine(P.d, PLEN); g.stroke();
      const top = along(PLEN); g.beginPath(); g.moveTo(X(top[0]), Y(top[1])); g.lineTo(X(top[0] + 0.12), Y(0.22)); g.stroke(); g.fillStyle = T.bg3; g.strokeStyle = T.accent; g.lineWidth = 1.25; g.beginPath(); g.rect(X(top[0] + 0.02), Y(0.06), u * 0.26, u * 0.17); g.fill(); g.stroke();
      g.fillStyle = T.bg0; g.strokeStyle = T.accent; g.lineWidth = 2; g.beginPath(); g.arc(X(hp[0]), Y(hp[1]), dragging ? 8 : 6, 0, TAU); g.fill(); g.stroke();
      g.restore();
      const hx = X(hp[0]), hy = Y(hp[1]);
      L.callout(g, 'sensor head, ' + P.d.toFixed(1) + ' m of rubble from the void', hx, hy - 7, hx - (hx > w * 0.62 ? 60 : -18), Math.max(12, Y(0.26)), { color: 'accent2', dot: false });
      L.text(g, 'drag along the crack', hx + 12, hy + 16, { color: 'accent2', size: 10.5, halo: true });
      const lab = SCENE_WORD[P.scene] + ' · truth (simulated)';
      L.callout(g, lab, X(P.scene === 'generator' ? 0.9 : 1.05), Y(P.scene === 'generator' ? 0.36 : 2.3), X(1.45), Y(P.scene === 'generator' ? 0.3 : 1.5), { color: P.scene === 'person' || P.scene === 'both' ? 'person' : 'text', dot: false });
      L.callout(g, 'void, ' + L.fix(P.hours, P.hours < 10 ? 1 : 0) + ' h, air changed ' + L.fix(P.ach, 1) + ' times an hour', X(0.3), Y(2.82), X(0.5), Y(3.02) + 4, { color: 'text3', dot: false });
      L.scaleBar(g, X(5.9), Y(2.98), u, { metres: 1 });
      return u * 3.15;
    }
    // "In the air at the sensor head": one log bar per gas, the ambient level and the sensor limit marked
    function drawAir(g, r) {
      const a = cur.air, rowH = Math.min(40, (r.h - 96) / 8), lw = 100, vw = 66, x0 = r.x + lw, x1 = r.x + r.w - vw, LO = -1, HI = 8, sx = (ppb) => x0 + ((clamp(Math.log10(Math.max(ppb, 0.1)), LO, HI) - LO) / (HI - LO)) * (x1 - x0);
      L.text(g, 'In the air at the sensor head', r.x, r.y + 11, { color: 'text', size: 12, weight: 600 });
      const y0 = r.y + 24;
      for (const [e, lab] of [[0, '1 ppb'], [3, '1 ppm'], [7, '1 %']]) { const px = Math.round(sx(10 ** e)) + 0.5; g.strokeStyle = T.line; g.lineWidth = 1; g.beginPath(); g.moveTo(px, y0); g.lineTo(px, y0 + rowH * 7); g.stroke(); if (e !== 3 || sx(1e3) - sx(1) > 44) L.text(g, lab, px, y0 + rowH * 7 + 12, { color: 'text3', size: 10.5, align: sx(1e3) - sx(1) > 44 ? 'center' : e ? 'left' : 'right', mono: true, weight: 400 }); }
      for (let j = 0; j < NG; j++) { const y = y0 + j * rowH, mid = y + rowH / 2, c = a.c[j], seen = !GAS[j].lod || c >= GAS[j].lod;
        L.text(g, GAS[j].name, r.x, mid, { color: 'text2', size: 11, base: 'middle' });
        g.fillStyle = T.bg3; g.fillRect(x0, mid - 4, x1 - x0, 8); g.fillStyle = L.rgba('text3', 0.75); g.fillRect(x0, mid - 4, sx(Math.min(c, a.bg[j])) - x0, 8);
        if (c > a.bg[j] * 1.02) { g.fillStyle = L.rgba('text', seen ? 0.92 : 0.45); g.fillRect(sx(a.bg[j]), mid - 4, Math.max(1, sx(c) - sx(a.bg[j])), 8); }
        if (GAS[j].lod) { const px = Math.round(sx(GAS[j].lod)) + 0.5; g.strokeStyle = T.accent; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, mid - 8); g.lineTo(px, mid + 8); g.stroke(); }
        L.text(g, fmtGas(c), r.x + r.w, mid, { color: seen ? 'text' : 'text3', size: 11, align: 'right', base: 'middle', mono: true }); }
      const y = y0 + 7 * rowH + 22, c = a.c[RH];
      L.text(g, 'Humidity', r.x, y + 5, { color: 'text2', size: 11, base: 'middle' }); g.fillStyle = T.bg3; g.fillRect(x0, y + 1, x1 - x0, 8); g.fillStyle = L.rgba('text3', 0.75); g.fillRect(x0, y + 1, ((x1 - x0) * c) / 100, 8); L.text(g, Math.round(c) + ' %', r.x + r.w, y + 5, { color: 'text', size: 11, align: 'right', base: 'middle', mono: true });
      if (y + 34 < r.y + r.h) { g.fillStyle = L.rgba('text3', 0.75); g.fillRect(r.x, y + 24, 9, 7); L.text(g, 'clean air', r.x + 13, y + 31, { color: 'text3', size: 10.5 }); g.fillStyle = T.text; g.fillRect(r.x + 66, y + 24, 9, 7); L.text(g, 'added by the source', r.x + 79, y + 31, { color: 'text3', size: 10.5 }); }
      if (y + 50 < r.y + r.h) { g.strokeStyle = T.accent; g.lineWidth = 1.5; g.beginPath(); g.moveTo(r.x + 4.5, y + 38); g.lineTo(r.x + 4.5, y + 50); g.stroke(); L.text(g, 'limit of such sensors (in Güntner 2018)', r.x + 13, y + 48, { color: 'text3', size: 10.5 }); }
    }
    // The fingerprint: seven sensor responses on seven spokes
    function drawNose(g, r, k) {
      L.text(g, 'What the seven sensors read', r.x, r.y + 11, { color: 'text', size: 12, weight: 600 });
      const cx = r.x + r.w / 2, cy = r.y + 16 + (r.h - 22) / 2, rad = Math.max(30, Math.min(r.w / 2 - 52, (r.h - 22) / 2 - 26));
      const pt = (j, v) => { const an = -Math.PI / 2 + (j / NS) * TAU, q = 0.12 + 0.88 * clamp((v - D.lo[j]) / (D.hi[j] - D.lo[j])); return [cx + Math.cos(an) * rad * q, cy + Math.sin(an) * rad * q]; };
      g.lineWidth = 1; g.strokeStyle = T.line; for (const q of [0.12, 0.56, 1]) { g.beginPath(); for (let j = 0; j <= NS; j++) { const an = -Math.PI / 2 + (j / NS) * TAU; j ? g.lineTo(cx + Math.cos(an) * rad * q, cy + Math.sin(an) * rad * q) : g.moveTo(cx + Math.cos(an) * rad * q, cy + Math.sin(an) * rad * q); } g.stroke(); }
      for (let j = 0; j < NS; j++) { const an = -Math.PI / 2 + (j / NS) * TAU, ex = cx + Math.cos(an) * rad, ey = cy + Math.sin(an) * rad; g.strokeStyle = T.line2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(ex, ey); g.stroke();
        const off = !P.co2 && j === 0; L.text(g, SENSORS[j].short + (off ? ' (off)' : ''), cx + Math.cos(an) * (rad + 8), cy + Math.sin(an) * (rad + 9), { color: off ? 'text3' : 'text2', size: 10.5, align: Math.cos(an) > 0.3 ? 'left' : Math.cos(an) < -0.3 ? 'right' : 'center', base: Math.sin(an) > 0.5 ? 'top' : Math.sin(an) < -0.5 ? 'alphabetic' : 'middle' }); }
      const poly = (vals) => { g.beginPath(); for (let j = 0; j < NS; j++) { const p = pt(j, vals[j]); j ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); } g.closePath(); };
      g.setLineDash([2, 3]); g.strokeStyle = T.text3; g.lineWidth = 1; poly(D.mean[0]); g.stroke();
      g.setLineDash([4, 3]); g.strokeStyle = T.person; g.lineWidth = 1.25; poly(D.mean[PERSON]); g.stroke(); g.setLineDash([]);
      if (cur.s) { const z = cur.s.z.map((v, j) => (cur.prevZ ? cur.prevZ[j] + (v - cur.prevZ[j]) * k : v)); g.fillStyle = L.rgba('accent', 0.16); g.strokeStyle = T.accent; g.lineWidth = 1.75; poly(z); g.fill(); g.stroke(); for (let j = 0; j < NS; j++) { const p = pt(j, z[j]); g.fillStyle = T.accent; g.beginPath(); g.arc(p[0], p[1], 2.2, 0, TAU); g.fill(); } }
      const ly = r.y + r.h - 4; let lx = r.x; const key = (col, dash, lab) => { g.strokeStyle = T[col]; g.lineWidth = 1.5; g.setLineDash(dash); g.beginPath(); g.moveTo(lx, ly - 4); g.lineTo(lx + 14, ly - 4); g.stroke(); g.setLineDash([]); L.text(g, lab, lx + 18, ly, { color: 'text3', size: 10.5 }); lx += 24 + g.measureText(lab).width + 8; };
      key('accent', [], 'this sniff'); key('person', [4, 3], 'typical person'); if (lx + 80 < r.x + r.w) key('text3', [2, 3], 'empty void');
    }
    function drawAnswer(g, r) {
      L.text(g, 'The classifier says', r.x, r.y + 11, { color: 'text', size: 12, weight: 600 });
      if (!done) { L.text(g, 'Learning…', r.x, r.y + 46, { color: 'text2', size: 24, display: true }); L.text(g, 'step ' + A.step + ' of ' + STEPS + ', loss ' + L.fix(A.loss[A.loss.length - 1] ?? NaN, 3), r.x, r.y + 66, { color: 'text3', size: 11, mono: true }); return; }
      const top = cur.top, tc = sceneClass(), right = top === tc;
      L.text(g, CLASSES[top].name, r.x, r.y + 46, { color: top === PERSON ? 'person' : 'text', size: Math.min(26, r.w / 8.5), display: true });
      L.text(g, L.pct(cur.mean[top]) + ' %', r.x + r.w, r.y + 46, { color: top === PERSON ? 'person' : 'text', size: 18, mono: true, align: 'right' });
      L.text(g, right ? 'matches the simulated truth' : 'wrong: the truth is ' + CLASSES[tc].word, r.x, r.y + 64, { color: right ? 'ok' : 'warn', size: 11 });
      const y0 = r.y + 78, rowH = Math.min(26, (r.h - 82) / NC), lw = Math.min(118, r.w * 0.5), bx = r.x + lw, bw = r.x + r.w - 40 - bx;
      for (let c = 0; c < NC; c++) { const y = y0 + c * rowH + rowH / 2, p = cur.s ? cur.mean[c] : 0, one = cur.s ? cur.s.p[c] : 0;
        L.text(g, CLASSES[c].name, r.x, y, { color: c === top ? 'text' : 'text2', size: 11, base: 'middle', weight: c === top ? 600 : 500 });
        g.fillStyle = T.bg3; g.fillRect(bx, y - 4, bw, 8); g.fillStyle = c === PERSON ? T.person : c === top ? T.text : L.rgba('text2', 0.8); g.fillRect(bx, y - 4, Math.max(p > 0.004 ? 1 : 0, bw * p), 8);
        const px = Math.round(bx + bw * one) + 0.5; g.strokeStyle = T.accent; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, y - 7); g.lineTo(px, y + 7); g.stroke();
        if (c === tc) { g.strokeStyle = T.ok; g.lineWidth = 1; g.strokeRect(bx - 3.5, y - 7.5, bw + 7, 15); }
        L.text(g, L.pct(p), r.x + r.w, y, { color: c === top ? 'text' : 'text3', size: 11, align: 'right', base: 'middle', mono: true }); }
      const ly = y0 + NC * rowH + 14; if (ly < r.y + r.h + 2) { g.strokeStyle = T.accent; g.lineWidth = 1.5; g.beginPath(); g.moveTo(r.x + 0.5, ly - 9); g.lineTo(r.x + 0.5, ly + 1); g.stroke(); L.text(g, 'this sniff', r.x + 7, ly, { color: 'text3', size: 10.5 }); g.strokeStyle = T.ok; g.lineWidth = 1; g.strokeRect(r.x + 66.5, ly - 8.5, 10, 9); L.text(g, 'truth (simulated)', r.x + 82, ly, { color: 'text3', size: 10.5 }); }
    }
    fHero.draw = (g, w, hh) => {
      if (!D || !cur) return;
      const sh = drawScene(g, w, hh * 0.42, time), top = sh + 30, bh = hh - top, k = L.reduced() ? 1 : L.smooth(cur.at / 0.25);
      g.strokeStyle = T.line; g.lineWidth = 1; g.beginPath(); g.moveTo(0, sh + 14.5); g.lineTo(w, sh + 14.5); g.stroke();
      { const gap = w > 620 ? 34 : 22, wa = (w - gap) * 0.5, wr = w - gap - wa, ah = Math.min(250, bh * 0.46), nh = bh - ah - 14; g.beginPath(); g.moveTo(wa + gap / 2 + 0.5, top); g.lineTo(wa + gap / 2 + 0.5, hh); g.stroke(); drawAir(g, { x: 0, y: top, w: wa, h: bh }); drawAnswer(g, { x: wa + gap, y: top, w: wr, h: ah }); drawNose(g, { x: wa + gap, y: top + ah + 14, w: wr, h: nh }, k); }
    };
    fHero.onPointer((ev) => {
      if (!geo || !D) return; const mx = (ev.x - geo.ox) / geo.u, my = ev.y / geo.u; let best = 0, bd = Infinity;
      for (let s = 0; s <= PLEN; s += 0.03) { const p = along(s), dd = Math.hypot(p[0] - mx, p[1] - my); if (dd < bd) { bd = dd; best = s; } }
      const hp = along(P.d), near = Math.hypot(hp[0] - mx, hp[1] - my) * geo.u < 18;
      if (ev.type === 'down' && (near || bd * geo.u < 22) && ev.y < geo.sh) dragging = true;
      if (ev.type === 'up' || ev.type === 'leave') { if (dragging) { dragging = false; fHero.redraw(); } }
      if (dragging && (ev.type === 'drag' || ev.type === 'down')) { P.d = Math.round(clamp(best, 0.3, 5) * 20) / 20; sD.set(P.d); refresh(); }
      fHero.canvas.style.cursor = dragging ? 'grabbing' : near ? 'grab' : 'default';
    });

    // ---- the map of sensor space ----
    const RW = 96, RHT = 72, region = L.raster(RW, RHT); let ext = null;
    function paintRegions() {
      const e = D.ext; ext = e;
      const z = new Float64Array(NS), p = new Float64Array(NC), M = live(), bg = T.rgb.bg0;
      region.paint((i) => { const a = ext[0] + (((i % RW) + 0.5) / RW) * (ext[1] - ext[0]), b = ext[3] - ((((i / RW) | 0) + 0.5) / RHT) * (ext[3] - ext[2]); for (let j = 0; j < NS; j++) z[j] = a * D.pcs[0][j] + b * D.pcs[1][j]; probs(M, z, p); let t = 0; for (let c = 1; c < NC; c++) if (p[c] > p[t]) t = c; const col = T.rgb[CLASSES[t].color], k = 0.14 + 0.22 * clamp((p[t] - 0.3) / 0.6); return [bg[0] + (col[0] - bg[0]) * k, bg[1] + (col[1] - bg[1]) * k, bg[2] + (col[2] - bg[2]) * k]; });
    }
    fMap.draw = (g, w, hh) => {
      if (!D || !ext) return; const Bx = L.pad(w, hh, { l: 40, t: 22, b: 32, r: 8 });
      const Pl = L.plot(g, Bx, { xd: [ext[0], ext[1]], yd: [ext[2], ext[3]], xlabel: 'first principal component, ' + L.pct(D.ev[0]) + ' % of the variance', ylabel: 'second, ' + L.pct(D.ev[1]) + ' %', grid: false, frame: true, xfmt: (v) => String(v), yfmt: (v) => String(v) });
      g.save(); g.beginPath(); g.rect(Bx.x, Bx.y, Bx.w, Bx.h); g.clip(); g.imageSmoothingEnabled = true; g.drawImage(region.canvas, Bx.x, Bx.y, Bx.w, Bx.h);
      for (let i = 0; i < NTE; i++) { const c = D.y[NTR + i], wrong = D.score && D.score.pred[i] !== c; g.fillStyle = L.rgba(CLASSES[c].color, c === 0 ? 0.55 : 0.8); const px = Pl.X(D.te[2 * i]), py = Pl.Y(D.te[2 * i + 1]); if (wrong) { g.strokeStyle = L.rgba(CLASSES[c].color, 0.9); g.lineWidth = 1; g.beginPath(); g.arc(px, py, 2.4, 0, TAU); g.stroke(); } else g.fillRect(px - 1.5, py - 1.5, 3, 3); }
      if (cur?.s) { for (let i = 0; i < cur.trail.length; i++) { const q = cur.trail[i]; g.fillStyle = L.rgba('accent', 0.12 + (0.4 * i) / cur.trail.length); g.beginPath(); g.arc(Pl.X(q[0]), Pl.Y(q[1]), 2, 0, TAU); g.fill(); }
        const k = L.reduced() ? 1 : L.smooth(cur.at / 0.25), qx = cur.from[0] + (cur.s.q[0] - cur.from[0]) * k, qy = cur.from[1] + (cur.s.q[1] - cur.from[1]) * k, px = clamp(Pl.X(qx), Bx.x + 4, Bx.x + Bx.w - 4), py = clamp(Pl.Y(qy), Bx.y + 4, Bx.y + Bx.h - 4);
        g.strokeStyle = L.rgba('accent', 0.55); g.lineWidth = 1; g.beginPath(); g.moveTo(px, Bx.y); g.lineTo(px, Bx.y + Bx.h); g.moveTo(Bx.x, py); g.lineTo(Bx.x + Bx.w, py); g.stroke();
        g.fillStyle = T.bg0; g.strokeStyle = T.accent; g.lineWidth = 2; g.beginPath(); g.arc(px, py, 6, 0, TAU); g.fill(); g.stroke(); cur.mark = [px, py]; }
      g.restore();
      const mcx = D.cen.reduce((a, c) => a + Pl.X(c[0]) / NC, 0), mcy = D.cen.reduce((a, c) => a + Pl.Y(c[1]) / NC, 0);
      for (let c = 0; c < NC; c++) { const px = Pl.X(D.cen[c][0]), py = Pl.Y(D.cen[c][1]), dx = px - mcx, dy = py - mcy, dl = Math.hypot(dx, dy) || 1, reach = Math.min(Bx.w, Bx.h) * 0.2; L.callout(g, CLASSES[c].name.toLowerCase(), px, py, clamp(px + (dx / dl) * reach, Bx.x + 70, Bx.x + Bx.w - 110), clamp(py + (dy / dl) * reach, Bx.y + 12, Bx.y + Bx.h - 12), { color: CLASSES[c].color === 'text3' ? 'text2' : CLASSES[c].color, size: 11 }); }
      if (cur?.mark) L.text(g, 'this sniff', cur.mark[0] + (cur.mark[0] > Bx.x + Bx.w - 70 ? -10 : 10), cur.mark[1] + (cur.mark[1] > Bx.y + Bx.h - 20 ? -10 : 14), { color: 'accent2', size: 10.5, halo: true, align: cur.mark[0] > Bx.x + Bx.w - 70 ? 'right' : 'left' });
      // training loss, bottom right
      const lw = Math.min(120, Bx.w * 0.3), lh = 40, lx = Bx.x + 14, ly = Bx.y + Bx.h - lh - 22; g.fillStyle = L.rgba('bg0', 0.82); g.fillRect(lx - 6, ly - 16, lw + 12, lh + 34); g.strokeStyle = T.line2; g.lineWidth = 1; g.strokeRect(lx - 5.5, ly - 15.5, lw + 11, lh + 33);
      L.text(g, 'training loss', lx, ly - 4, { color: 'text3', size: 10.5 }); const n = A.loss.length; if (n > 1) { g.strokeStyle = T.text2; g.lineWidth = 1.25; g.beginPath(); const l0 = Math.log(NC); for (let i = 0; i < n; i++) { const px = lx + (i / (STEPS - 1)) * lw, py = ly + lh - (clamp(A.loss[i] / l0)) * lh; i ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); L.text(g, L.fix(A.loss[n - 1], 2) + ', ' + n + ' steps', lx, ly + lh + 13, { color: 'text2', size: 10.5, mono: true }); }
    };

    // ---- detection against distance ----
    fDet.draw = (g, w, hh) => {
      const Bx = L.pad(w, hh, { l: 44, t: 24, b: 34, r: 14 }), Pl = L.plot(g, Bx, { xd: [0, 5], yd: [0, 1], xlabel: 'distance through the rubble, m', ylabel: 'people found', yfmt: (v) => Math.round(v * 100) + ' %', yticks: [0, 0.25, 0.5, 0.75, 1] });
      if (!det) { L.text(g, 'Waiting for the classifier…', Bx.x + Bx.w / 2, Bx.y + Bx.h / 2, { color: 'text3', align: 'center', size: 12 }); return; }
      L.rule(g, Pl, { y: 0.05, color: 'text3', label: 'guessing: 5 %' });
      L.trace(g, Pl, DX, det.yB, { color: 'text2', width: 1.5, dash: [5, 3] }); L.trace(g, Pl, DX, det.yA, { color: 'accent', width: 2, fill: 0.14 });
      L.dots(g, Pl, DX, det.yA, { color: 'accent', r: 2 });
      const iA = 4, la = det.yA[iA], lb = det.yB[iA], up = la >= lb;
      L.text(g, 'all seven sensors', Pl.X(DX[iA]) + 8, Pl.Y(la) + (up ? -8 : 16), { color: 'accent2', size: 11, halo: true }); L.text(g, 'without the CO2 sensor', Pl.X(DX[iA]) + 8, Pl.Y(lb) + (up ? 16 : -8), { color: 'text2', size: 11, halo: true });
      L.rule(g, Pl, { x: P.d, color: 'accent', label: 'sensor head', side: P.d > 3.6 ? 'left' : 'right' });
      const here = P.co2 ? det.at(det.yA, P.d) : det.at(det.yB, P.d); g.fillStyle = T.bg0; g.strokeStyle = T.accent; g.lineWidth = 2; g.beginPath(); g.arc(Pl.X(P.d), Pl.Y(here), 4.5, 0, TAU); g.fill(); g.stroke();
    };

    // ---- words and numbers ----
    const sSay = L.stat('classifier says'), sAcc = L.stat('held-out accuracy, six classes', { unit: '%' }), sTpr = L.stat('people found at 5 % false alarms, held-out', { unit: '%' }), sHere = L.stat('people found at this distance', { unit: '%' }), sConf = L.stat('weakest confusion', { unit: '%' });
    readout.append(L.h('h4', null, 'Measured against the simulated truth'), sSay.el, sAcc.el, sTpr.el, sHere.el, sConf.el, L.h('p.note.quiet', null, 'Simulated sniffs only. Not a medical reading.'));
    function report() {
      if (!D || !cur) return; const tc = sceneClass(), top = cur.top, p = L.pct(cur.mean[top]), d = P.d.toFixed(1), isP = P.scene === 'person' || P.scene === 'both';
      if (!done) { fHero.setTitle('Training the nose on ' + NTR.toLocaleString('en-US') + ' simulated sniffs: step ' + A.step + ' of ' + STEPS); sSay.set('…'); return; }
      sSay.set(cap(CLASSES[top].word) + ' ' + p + ' %', 'classifier says (truth: ' + CLASSES[tc].word + ')'); sSay.tone(top === PERSON ? 'person' : top === tc ? 'ok' : 'warn');
      const S = D.score; sAcc.set(L.pct(S.acc, 1)); sTpr.set(L.pct(S.tpr, 1)); sTpr.tone(S.tpr > 0.7 ? 'ok' : 'warn'); sConf.set(L.pct(S.worst.r), CLASSES[S.worst.a].word + ' called ' + CLASSES[S.worst.b].word); sConf.tone('warn');
      const here = det ? det.at(P.co2 ? det.yA : det.yB, P.d) : NaN; sHere.set(L.pct(here), 'people found at ' + d + ' m, 5 % false alarms'); sHere.tone(here > 0.8 ? 'ok' : here > 0.4 ? 'warn' : 'danger');
      const smoke = P.scene === 'both' ? ' beside a smouldering fire' : '';
      fHero.setTitle(isP ? (top === PERSON ? 'A person ' + d + ' m away through the rubble' + smoke + ': the nose says person, ' + p + ' % sure' : 'A person is ' + d + ' m away' + smoke + ', but the nose says ' + CLASSES[top].word + ' (' + p + ' %)')
        : P.scene === 'animal' ? (top === PERSON ? 'An animal in the void, and the nose says person (' + p + ' %): the hard case' : 'An animal in the void: the nose says ' + CLASSES[top].word + ' (' + p + ' %), and gives person ' + L.pct(cur.mean[PERSON]) + ' %')
        : top === tc ? cap(SCENE_WORD[P.scene].split(':')[0].split(',')[0]) + ' in the void: the nose says ' + CLASSES[top].word + ', ' + p + ' %, and gives person ' + L.pct(cur.mean[PERSON]) + ' %' : cap(SCENE_WORD[P.scene].split(':')[0].split(',')[0]) + ' in the void, but the nose says ' + CLASSES[top].word + ' (' + p + ' %)');
      fHero.setNote('A simulated void of ' + VOID_M3 + ' m³ (assumed) leaking along a crack. Emission rates follow published ranges; the sensor response matrix and the mixing along the crack are assumed. Bars are the mean of 48 sniffs; the blue tick is one sniff.');
      fMap.setTitle('On ' + NTE.toLocaleString('en-US') + ' sniffs it never saw, the nose is right ' + L.pct(S.acc) + '\u00a0% of the time; it calls ' + L.pct(S.animalAsPerson) + ' % of animals a person');
      fMap.setNote('Each dot is one held-out sniff, placed by the two strongest patterns in the seven readings; rings are the ones to look at again. Shading is the answer on this plane.');
      const r = (v) => (v === Infinity ? 'past 5 m' : v <= 0 ? 'nowhere' : 'out to ' + v.toFixed(1) + ' m');
      if (det) fDet.setTitle(det.rA <= 0 ? 'At this airflow and noise a person is found less than half the time at any distance' : 'A person is found at least half the time ' + r(det.rA) + '; without the CO2 sensor, ' + r(det.rB));
      fDet.setNote('220 simulated people at each distance against 1,500 decoys and empty voids, at this airflow, time and noise. The threshold lets 5 % of the decoys through.');
    }
    const refresh = L.soon(update);
    const sD = L.slider({ label: 'Rubble between the void and the sensor', min: 0.3, max: 5, step: 0.05, value: P.d, unit: 'm', format: (v) => v.toFixed(2), onInput: (v) => { P.d = v; refresh(); } });
    controls.append(
      L.seg({ label: 'What is in the void', value: P.scene, options: [{ value: 'person', label: 'Person' }, { value: 'animal', label: 'Animal' }, { value: 'both', label: 'Person + smoke' }, { value: 'smoulder', label: 'Smouldering' }, { value: 'generator', label: 'Generator' }, { value: 'rot', label: 'Rot' }, { value: 'empty', label: 'Empty' }], onChange: (v) => { P.scene = v; if (cur) cur.trail = []; refresh(); } }).el,
      sD.el,
      L.slider({ label: 'Airflow through the void', min: -0.7, max: 0.9, step: 0.02, value: Math.log10(P.ach), unit: 'air changes an hour', format: (v) => (10 ** v).toFixed(10 ** v < 1 ? 2 : 1), hint: 'More air carries the smell farther but thins it at the source.', onInput: (v) => { P.ach = 10 ** v; refresh(); } }).el,
      L.slider({ label: 'Time trapped', min: -0.3, max: 1.86, step: 0.02, value: Math.log10(P.hours), unit: 'h', format: (v) => (10 ** v).toFixed(10 ** v < 10 ? 1 : 0), hint: 'The void fills over the first hours; breath acetone rises as a person goes without food (assumed slope).', onInput: (v) => { P.hours = 10 ** v; refresh(); } }).el,
      L.slider({ label: 'Sensor noise and drift', min: 0.3, max: 6, step: 0.1, value: P.noise, unit: '× the published limits', format: (v) => v.toFixed(1), onInput: (v) => { P.noise = v; refresh(); } }).el,
      L.toggle({ label: 'Use the CO2 sensor', value: true, hint: 'Carbon dioxide is the strongest signal and the least specific.', onChange: (v) => { P.co2 = v; if (D) paintRegions(); refresh(); } }).el,
      L.row(L.button({ label: 'Another individual', icon: 'reset', hint: 'People differ: draw a new source with different emission rates.', onClick: () => { P.who++; refresh(); } })));

    // ---- training, chunked over frames so the visitor sees it converge ----
    makeData();
    function trainSome(n) { for (let i = 0; i < n && A.step < STEPS; i++) { trainStep(A, D.X, D.y, NTR); trainStep(B, D.X, D.y, NTR); } if (A.step >= STEPS && !done) { done = true; score(); } paintRegions(); }
    if (L.reduced()) trainSome(STEPS); else trainSome(1);
    update();
    const loop = L.loop((dt, t) => {
      time = t;
      if (!done) { trainSome(6); if (done) update(); else { report(); cur.mean = probs(live(), cur.zbar, new Float64Array(NC)); } }
      else if (!L.reduced()) { cur.at += dt; hold = (hold || 0) + dt; if (hold > 0.6) { hold = 0; cur.trail.push(cur.s.q); if (cur.trail.length > 14) cur.trail.shift(); cur.prevZ = cur.s.z; cur.from = cur.s.q; cur.s = sniff(); cur.at = 0; } }
      fHero.redraw(); fMap.redraw();
    });
    return { start() { loop.start(); fDet.redraw(); }, stop() { loop.stop(); } };
  },
};
