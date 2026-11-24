// The heavy work, kept off the screen's thread when a Worker is available (see worker.js) and run directly when not.
// One cloud is held at a time; 'voids' re-runs only the void search with new limits.
import { buildSite, scanSite, buildPlan, scanPlan, poseAt } from './scene.js';
import { bounds, groundModel, classify, findVoids, occupancy } from './analyze.js';
import { parseCloud } from './io.js';

let cur = null; // { kind, pos, n, time, traj, B, g, cl }
const now = () => performance.now();
const tick = () => new Promise((r) => setTimeout(r, 0));

async function analyse(progress, extra) {
  const c = cur, T = {};
  progress(0.62, 'Fitting the ground surface'); await tick();
  let t = now(); c.B = bounds(c.pos, c.n); c.g = groundModel(c.pos, c.n, c.B); T.ground = now() - t;
  progress(0.72, 'Classifying ' + c.n.toLocaleString() + ' points'); await tick();
  t = now(); c.cl = classify(c.pos, c.n, c.B, c.g, c.truth); T.classify = now() - t;
  progress(0.86, 'Searching for voids'); await tick();
  t = now(); const voids = runVoids({}); T.voids = now() - t;
  progress(0.95, 'Building the map'); await tick();
  t = now(); const occ = occupancy(c.pos, c.n, c.cl.hag, c.g, c.B, c.kind === 'site' ? { w: 240, h: 180 } : null); T.map = now() - t;
  const g = c.g, ext = [c.B.max[0] - c.B.min[0], c.B.max[1] - c.B.min[1], c.B.max[2] - c.B.min[2]];
  return { kind: c.kind, n: c.n, pos: c.pos, inten: c.inten, time: c.time, rgb: c.rgb || null, cls: c.cl.cls, hag: c.cl.hag, sp: c.cl.sp, bounds: c.B, extent: ext,
    ground: { x0: g.x0, y0: g.y0, w: g.w, h: g.h, z: g.z }, classes: { counts: c.cl.counts, confusion: c.cl.confusion, accuracy: c.cl.accuracy, voxel: c.cl.voxel, voxels: c.cl.voxels },
    voids, occ, timings: T, stats: { area: g.area, density: c.n / Math.max(1, g.area) }, ...extra };
}
function runVoids(p) {
  const c = cur;
  return findVoids(c.pos, c.n, c.cl.cls, c.cl.hag, c.g, c.B, { minH: p.minH ?? 0.5, minL: p.minL ?? 1.2, whole: !!p.whole, time: c.traj ? c.time : null, origin: c.traj ? (t, o) => poseAt(c.traj, t, o) : null });
}

export async function handle(op, p = {}, progress = () => {}) {
  if (op === 'site' || op === 'plan') {
    progress(0.02, op === 'site' ? 'Building the site from the scenario' : 'Building your floor plan'); await tick();
    let t = now(); const S = op === 'site' ? buildSite() : buildPlan(p.plan); const tBuild = now() - t;
    progress(0.1, 'Flying the scanner'); await tick();
    t = now(); const scan = op === 'site' ? scanSite(S, (f, m) => progress(0.1 + f * 0.5, m)) : scanPlan(S, (f, m) => progress(0.1 + f * 0.5, m)); const tScan = now() - t;
    cur = { kind: op, pos: scan.pos, n: scan.n, inten: scan.inten, time: scan.time, truth: scan.truth, traj: scan.traj };
    const r = await analyse(progress, { duration: scan.duration, traj: scan.traj, passes: scan.passes, rays: scan.rays, prims: S.prims.length });
    r.timings.build = tBuild; r.timings.scan = tScan;
    return r;
  }
  if (op === 'file') {
    progress(0.1, 'Reading ' + p.name); await tick();
    let t = now(); const f = parseCloud(p.name, p.buffer); const tRead = now() - t;
    progress(0.4, 'Preparing ' + f.n.toLocaleString() + ' points'); await tick();
    const raw = bounds(f.pos, f.n), e = [raw.max[0] - raw.min[0], raw.max[1] - raw.min[1], raw.max[2] - raw.min[2]];
    let up = p.up; if (up !== 'y' && up !== 'z') up = e[1] < 0.6 * Math.min(e[0], e[2]) ? 'y' : 'z';
    const pos = f.pos, n = f.n;
    if (up === 'y') for (let i = 0; i < n; i++) { const y = pos[i * 3 + 1]; pos[i * 3 + 1] = -pos[i * 3 + 2]; pos[i * 3 + 2] = y; }
    const b = bounds(pos, n);
    for (let i = 0; i < n; i++) { pos[i * 3] -= b.min[0]; pos[i * 3 + 1] -= b.min[1]; pos[i * 3 + 2] -= b.min[2]; }
    const span = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]);
    if (!(span > 0)) throw new Error('Every point in this file is at the same place.');
    const warn = [];
    if (f.note) warn.push(f.note);
    if (span < 1.5) warn.push('The scan is only ' + span.toFixed(2) + ' units across. The analysis assumes metres, so it may be in another unit.');
    if (span > 3000) throw new Error('This scan is ' + Math.round(span).toLocaleString() + ' units across. The analysis assumes metres and handles sites up to 3 km. It may be in millimetres.');
    cur = { kind: 'file', pos, n, inten: f.inten, rgb: f.rgb, time: null, truth: null, traj: null };
    const r = await analyse(progress, { name: p.name, up, total: f.total, hasIntensity: f.hasIntensity, warnings: warn, offset: b.min });
    r.timings.read = tRead;
    return r;
  }
  if (op === 'voids') { if (!cur) throw new Error('No scan is loaded.'); const t = now(), v = runVoids(p); v.ms = now() - t; return v; }
  throw new Error('Unknown job: ' + op);
}
