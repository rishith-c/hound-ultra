// Runs the same six instruments as Advanced mode, off the main thread, and posts what each one recovers as it goes.
// Nothing here is drawn by hand: every field the film shows comes from these solvers on the simulated pile.
import { buildPile, WORLD } from './model.js';
import * as L from './lib.js';

const el = () => ({ set() {}, hidden: false });
const env = { h: el, L, ui: { slider: el, seg: el, button: el, toggle: el }, redraw() {}, refresh() {}, reduced: () => true };
const { nx, nz, res } = WORLD, inst = new Map();
async function get(id, pile) { if (!inst.has(id)) { const ex = (await import('./' + id + '.js')).default(env); ex.setPile(pile); inst.set(id, ex); } return inst.get(id); }
// bring any coarse grid on to the shared 240 x 105 section, softly, as bytes
function grid(src, cr, cnx, cnz, lo, hi) {
  const out = new Uint8Array(nx * nz), at = (i, k) => src[L.clamp(k, 0, cnz - 1) * cnx + L.clamp(i, 0, cnx - 1)];
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const fx = (i + 0.5) * res / cr - 0.5, fz = (k + 0.5) * res / cr - 0.5, a = Math.floor(fx), b = Math.floor(fz), u = L.ss(fx - a), v = L.ss(fz - b); if (b >= cnz) continue;
    const s = (at(a, b) * (1 - u) + at(a + 1, b) * u) * (1 - v) + (at(a, b + 1) * (1 - u) + at(a + 1, b + 1) * u) * v; out[k * nx + i] = 255 * L.clamp((s - lo) / (hi - lo), 0, 1); }
  return out;
}
const rest = () => new Promise((r) => setTimeout(r, 0));
const JOBS = {
  async muon(pile, post) {
    const ex = await get('muon', pile), d = ex._demo(), keys = [0, 0.02, 0.05, 0.1, 0.18, 0.3, 0.45, 0.65, 0.9, 1.2, 1.6, 2];
    const A = d.active, sec = []; for (let q = 0; q < A.length; q++) if (A[q]) { const i = q % 80, k = (q - i) / 80; sec.push([q, pile.voidId[pile.cellAt((i + 0.5) * 0.3, -3 + (k + 0.5) * 0.3)]]); }
    for (let n = 0; n < keys.length; n++) {
      if (!keys[n]) { post({ n, of: keys.length, hours: 0, total: 0, seen: [], field: new Uint8Array(nx * nz) }); continue; }
      d.P.hours = keys[n]; d.expose();
      const g = [[], [], [], [], []]; for (const [q, id] of sec) g[id].push(d.recon[q]); const mean = g.map((a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length)), sd = Math.sqrt(g[0].reduce((s, v) => s + (v - mean[0]) ** 2, 0) / g[0].length);
      post({ n, of: keys.length, hours: keys[n], total: d.M.total, rms: d.M.rms, corr: d.M.corr, contrast: ['A', 'B', 'C', 'D'].map((_, i) => (mean[i + 1] - mean[0]) / sd), seen: ['A', 'B', 'C', 'D'].filter((_, i) => (mean[i + 1] - mean[0]) / sd > 1.5), dets: d.dets.map((q) => [q.x, q.z, q.perHour]), field: grid(d.shown, 0.3, 80, 35, 0.1, 1.35) }); await rest();
    }
  },
  async gravity(pile, post) {
    const ex = await get('gravity', pile), d0 = ex._demo(), K = 9;
    for (let n = 0; n <= K; n++) { d0.P.sweep = Math.max(0.04, n / K); d0.invert(); const d = ex._demo(); post({ n, of: K + 1, hours: d.surveyHours(), field: n ? grid(d.m, d.CR, d.CNX, d.CNZ, 0.06, 1.0) : new Uint8Array(nx * nz), stations: n === K ? d.st.map((s, i) => [s.x, s.z, d.data[i]]) : null, sigma: d.P.sigma, verdicts: ex.verdicts() }); await rest(); }
  },
  async gpr(pile, post) {
    const ex = await get('gpr', pile); ex._demo().runAll(); const d = ex._demo(), out = new Float32Array(nx * nz), K = 8; let clip = 0;
    for (let n = 0; n <= K; n++) { const ap = d.P.apMax * Math.pow(n / K, 1.6); d.migrate(d.total, d.P.v, ap, out); const g = new Float32Array(nx * nz), s = [];
      for (const q of d.maskList) { const i = q % nx, k = (q - i) / nx, dep = Math.max(0, pile.surf[i] - (WORLD.z0 + (k + 0.5) * res)); g[q] = Math.abs(out[q]) * Math.min(40, Math.exp(0.28 * dep)) * (0.4 + dep); }
      const sm = new Float32Array(nx * nz); // the envelope of the echoes, so the film shows energy and not single cycles
      for (const q of d.maskList) { let a = 0, w = 0; for (let k = -2; k <= 2; k++) for (let i = -2; i <= 2; i++) { const c = Math.exp(-(i * i + k * k) / 2.6), v = g[q + k * nx + i]; if (v >= 0) { a += c * v; w += c; } } sm[q] = a / w; s.push(sm[q]); } g.set(sm);
      s.sort((a, b) => a - b); clip = s[Math.floor(s.length * 0.993)] || 1; post({ n, of: K + 1, ap, v: d.P.v, traces: d.ant.length, verdicts: ex.verdicts(), field: grid(g, res, nx, nz, clip * 0.22, clip) }); await rest(); }
  },
  async das(pile, post) { const ex = await get('das', pile), d = ex._demo(); post({ n: 0, of: 1, T: d.T, tap: d.tap, M: { ...d.M }, sideways: Math.abs(d.M.x - d.tap.x), path: d.ch.map((c) => [c.x, c.z, c.t0 - d.PRE]), field: grid(d.field, d.CR, d.CNX, d.CNZ, 0.12, 1) }); },
  async seismic(pile, post) { const ex = await get('seismic', pile), d = ex._demo(); post({ n: 0, of: 1, T: d.T, tap: d.tap, M: { ...d.M }, geo: d.geo.map((g, i) => [g.x, g.z, d.sig[i].t0 - d.PRE]), field: grid(d.field, d.CR, d.CNX, d.CNZ, 0.12, 1) }); },
  async echo(pile, post) { const ex = await get('echo', pile), d = ex._demo(); post({ n: 0, of: 1, src: d.src, mics: d.mics, imgs: d.imgs, outline: d.outline, M: { hit: d.M.hit, n: d.M.walls.length, err: d.M.err, iou: d.M.iou, extra: d.M.extra, area: d.M.area, true: d.M.true }, found: d.found.map((f) => [f.nx, f.nz, f.dist]), field: new Uint8Array(nx * nz) }); },
};
const todo = []; let busy = false, want = null, pile = null;
async function run() { if (busy) return; busy = true; while (todo.length) { const i = Math.max(0, todo.indexOf(want)), id = todo.splice(i, 1)[0]; try { await JOBS[id](pile, (m) => postMessage({ id, ...m })); } catch (e) { postMessage({ id, error: String(e && e.message || e) }); } await rest(); } busy = false; }
onmessage = (e) => { const m = e.data; if (m.seed) { pile = buildPile(m.seed); inst.clear(); todo.splice(0, todo.length, 'muon', 'gravity', 'gpr', 'das', 'seismic', 'echo'); } if (m.want) want = m.want; run(); };
