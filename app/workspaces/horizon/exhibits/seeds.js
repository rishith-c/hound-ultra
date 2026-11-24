// Sensor seeds: battery-free sensors that drift on the wind like dandelion seeds and answer by radio backscatter.
// Everything is computed here: an Ornstein-Uhlenbeck gust field with shear, the fall of every seed under drag, where
// each one lands and whether it works, which ones a reader can hear, and a kriging (Gaussian-process) rebuild of a
// simulated temperature field from their noisy readings, scored against that simulated truth.
//
// Published numbers (Iyer, Gaensbauer, Daniel, Gollakota 2022, Nature 603: abstract; University of Washington release):
//   mass 30 mg, fall speed 0.87 m/s, lands upright more than 95 % of the time, travels 50 to 100 m in a gentle to
//   moderate breeze, shares data by backscatter up to 60 m, carries temperature, humidity, pressure and light sensors.
// Assumed here (not from the paper): everything in ASSUME below.
import * as L from '../lib.js';
import world from '../../../core/world.js';
const { TAU, clamp } = L;

const PUB = { vt: 0.87, upright: 0.95, range: 60, mass: 30 };
const ASSUME = { cv: 0.12, shear: 0.2, gust: 0.22, gustT: 5, turb: 0.15, turbT: 1.5, droneV: 8, line: 60, shadeFail: 0.8, rubbleFail: 0.4, sunEl: 50, noise: 0.5, foot: 6, blocked: 0.5 };
const SITE = { w: world?.SITE?.w || 120, h: world?.SITE?.h || 90 };
const rectPoly = (r) => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
const BLD = [];
if (world?.BUILDING?.rect) BLD.push({ name: 'B', poly: rectPoly(world.BUILDING.rect), h: world.BUILDING.wallHeight || 3.2 });
for (const o of world?.OBSTACLES || []) if (o.kind === 'building') BLD.push({ name: o.id.slice(-1).toUpperCase(), poly: o.poly, h: o.h });
for (const b of BLD) { b.x0 = Math.min(...b.poly.map((p) => p[0])); b.x1 = Math.max(...b.poly.map((p) => p[0])); b.y0 = Math.min(...b.poly.map((p) => p[1])); b.y1 = Math.max(...b.poly.map((p) => p[1])); }
const RUB = (world?.OBSTACLES || []).filter((o) => o.kind === 'rubble').map((o) => o.poly);
const mud = (world?.HAZARDS || []).find((z) => z.kind === 'mud')?.poly;
const WET = mud ? [Math.min(...mud.map((p) => p[0])), Math.min(...mud.map((p) => p[1])), Math.max(...mud.map((p) => p[0])), Math.max(...mud.map((p) => p[1]))] : [88, 16, 116, 50];
const HMAX = Math.max(0, ...BLD.map((b) => b.h));
const SHADE = 1 / Math.tan((ASSUME.sunEl * Math.PI) / 180);   // shadow length per metre of height; sun due south (assumed)
const VIEW = { x0: -14, x1: SITE.w + 14, y0: -9, y1: SITE.h + 9 };
const CELL = 2, GX = Math.round(SITE.w / CELL), GY = Math.round(SITE.h / CELL), NG = GX * GY;
const TR = [14, 42];   // temperature colour scale, deg C

function inPoly(x, y, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; }
function crosses(ax, ay, bx, by, poly) { for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const cx = poly[j][0], cy = poly[j][1], dx = poly[i][0], dy = poly[i][1], d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (Math.abs(d) < 1e-12) continue; const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d; if (u > 0 && u < 1 && v > 0 && v < 1) return true; } return false; }
const roofAt = (x, y) => { for (const b of BLD) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && inPoly(x, y, b.poly)) return b; return null; };
const inShade = (x, y) => { for (const b of BLD) for (let k = 1; k <= 5; k++) if (inPoly(x, y - (k / 5) * b.h * SHADE, b.poly)) return true; return false; };
const inRubble = (x, y) => RUB.some((p) => inPoly(x, y, p));

// ---- the simulated truth: air temperature at the ground ----
const NZ = (() => { const R = L.rng(77), m = 8, c = Float32Array.from({ length: m * m }, () => R.n()); return (x, y) => { const u = clamp(x / 20, 0, 6.99), v = clamp(y / 20, 0, 6.99), a = u | 0, b = v | 0, fu = L.smooth(u - a), fv = L.smooth(v - b); return L.lerp(L.lerp(c[b * m + a], c[b * m + a + 1], fu), L.lerp(c[b * m + m + a], c[b * m + m + a + 1], fu), fv); }; })();
const wetAt = (x, y) => L.smooth((x - WET[0] + 3) / 6) * L.smooth((WET[2] + 3 - x) / 6) * L.smooth((y - WET[1] + 3) / 6) * L.smooth((WET[3] + 3 - y) / 6);
const HOT = { amp: 17, sig: 5.5 };
const tempAt = (x, y, hot) => 23 + 1.5 * NZ(x, y) - 5 * wetAt(x, y) + HOT.amp * Math.exp(-((x - hot[0]) ** 2 + (y - hot[1]) ** 2) / (2 * HOT.sig * HOT.sig));

// ---- the analytic forecast: drift = wind x height / fall speed, with the shear integrated over the fall ----
function forecast(P) {
  const H = P.height, U = P.wind, T = H / PUB.vt, s = ASSUME.shear;
  const drift = ((U * H ** (1 + s)) / ((1 + s) * 10 ** s) / PUB.vt) * (1 + ASSUME.cv ** 2);
  const ou = (sd, tau) => 2 * sd * sd * tau * (T - tau * (1 - Math.exp(-T / tau)));   // variance of the displacement an OU gust adds
  const g = ou(ASSUME.gust * U, ASSUME.gustT) + ou(ASSUME.turb * U, ASSUME.turbT);
  return { drift, T, sa: Math.sqrt((drift * ASSUME.cv) ** 2 + g), sc: Math.sqrt(ASSUME.line ** 2 / 12 + g) };
}

// ---- one drop: every seed integrated from release to landing ----
function simulate(P, seed, N, rec) {
  const R = L.rng(seed), U = P.wind, th = (P.dir * Math.PI) / 180, wx = -Math.sin(th), wy = -Math.cos(th), lx = -wy, ly = wx;
  const F = forecast(P), cx = P.aim[0] - wx * F.drift, cy = P.aim[1] - wy * F.drift, tFly = ASSUME.line / ASSUME.droneV, dt = 0.1;
  const steps = Math.ceil((tFly + P.height / 0.5 + 2) / dt), gx = new Float32Array(steps + 1), gy = new Float32Array(steps + 1);
  const sg = ASSUME.gust * U, kg = Math.sqrt((2 * dt) / ASSUME.gustT), ss = ASSUME.turb * U, ks = Math.sqrt((2 * dt) / ASSUME.turbT);
  let a = sg * R.n(), b = sg * R.n(); for (let s = 0; s <= steps; s++) { gx[s] = a; gy[s] = b; a += (-a * dt) / ASSUME.gustT + sg * kg * R.n(); b += (-b * dt) / ASSUME.gustT + sg * kg * R.n(); }
  const seeds = [];
  for (let i = 0; i < N; i++) {
    const f = (i + 0.5) / N, t0 = f * tFly, vt = clamp(PUB.vt * (1 + ASSUME.cv * R.n()), 0.5, 1.5), k = 1 - Math.exp(-dt / (vt / 9.81));
    const rx = cx + lx * (f - 0.5) * ASSUME.line, ry = cy + ly * (f - 0.5) * ASSUME.line;
    let x = rx, y = ry, z = P.height, vx = lx * ASSUME.droneV, vy = ly * ASSUME.droneV, vz = 0, ex = ss * R.n(), ey = ss * R.n(), wall = false, roof = null, t = t0;
    const tr = rec ? [x, y, z] : null;
    for (let s = Math.round(t0 / dt), n = 0; s < steps; s++, n++) {
      const uz = U * (Math.max(z, 0.5) / 10) ** ASSUME.shear;
      ex += (-ex * dt) / ASSUME.turbT + ss * ks * R.n(); ey += (-ey * dt) / ASSUME.turbT + ss * ks * R.n();
      if (!wall) { vx += (wx * uz + gx[s] + ex - vx) * k; vy += (wy * uz + gy[s] + ey - vy) * k; }
      vz += (-vt - vz) * k;
      const px = x, py = y, pz = z; x += vx * dt; y += vy * dt; z += vz * dt; t += dt;
      if (z <= HMAX) { const bd = roofAt(x, y); if (bd && z <= bd.h) { if (pz > bd.h || roofAt(px, py) === bd) { roof = bd; z = bd.h; } else { x = px; y = py; vx = vy = 0; wall = true; } } }
      if (z <= 0) z = 0;
      if (tr && (n & 1 || roof || z === 0)) tr.push(x, y, z);
      if (roof || z === 0) break;
    }
    seeds.push({ rx, ry, t0, x, y, z, vt, tLand: t, roof, tr: tr ? Float32Array.from(tr) : null, u1: R(), u2: R(), u3: R(), e: R.n(),
      out: x < 0 || y < 0 || x > SITE.w || y > SITE.h });
  }
  // what became of each seed
  for (const s of seeds) {
    s.state = s.out ? 'out' : s.roof ? 'roof' : s.u1 > PUB.upright ? 'down' : inShade(s.x, s.y) && s.u2 < ASSUME.shadeFail ? 'shade' : inRubble(s.x, s.y) && s.u3 < ASSUME.rubbleFail ? 'rubble' : 'ok';
    s.al = (s.x - s.rx) * wx + (s.y - s.ry) * wy; s.cr = (s.x - cx) * lx + (s.y - cy) * ly;
  }
  return { seeds, F, cx, cy, wx, wy, lx, ly, tFly, tEnd: Math.max(...seeds.map((s) => s.tLand)) };
}
function hear(seeds, P) { let n = 0; for (const s of seeds) { s.heard = false; if (s.state !== 'ok') continue; const d = Math.hypot(s.x - P.reader[0], s.y - P.reader[1]); let lim = P.range; for (const b of BLD) if (crosses(s.x, s.y, P.reader[0], P.reader[1], b.poly)) { lim *= ASSUME.blocked; break; } s.heard = d <= lim; if (s.heard) n++; } return n; }

// ---- kriging: a Gaussian process with a Matern 3/2 covariance, solved by Cholesky ----
const matern = (r, ell) => { const q = (1.7320508 * r) / ell; return (1 + q) * Math.exp(-q); };
function gpFit(X, Y, V, ell, s2, n2) {
  const n = V.length, K = new Float64Array(n * n);
  for (let i = 0; i < n; i++) { for (let j = 0; j < i; j++) K[i * n + j] = s2 * matern(Math.hypot(X[i] - X[j], Y[i] - Y[j]), ell); K[i * n + i] = s2 + n2; }
  for (let j = 0; j < n; j++) { let d = K[j * n + j]; for (let k = 0; k < j; k++) d -= K[j * n + k] ** 2; d = Math.sqrt(Math.max(d, 1e-9)); K[j * n + j] = d; for (let i = j + 1; i < n; i++) { let s = K[i * n + j]; for (let k = 0; k < j; k++) s -= K[i * n + k] * K[j * n + k]; K[i * n + j] = s / d; } }
  const al = Float64Array.from(V); let ld = 0;
  for (let i = 0; i < n; i++) { let s = al[i]; for (let k = 0; k < i; k++) s -= K[i * n + k] * al[k]; al[i] = s / K[i * n + i]; ld += Math.log(K[i * n + i]); }
  let q = 0; for (let i = 0; i < n; i++) q += al[i] * al[i];
  for (let i = n - 1; i >= 0; i--) { let s = al[i]; for (let k = i + 1; k < n; k++) s -= K[k * n + i] * al[k]; al[i] = s / K[i * n + i]; }
  return { al, logml: -0.5 * q - ld - 0.5 * n * Math.log(TAU) };
}
const ROOF = new Uint8Array(NG); let NOPEN = 0;
for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) { ROOF[j * GX + i] = roofAt((i + 0.5) * CELL, (j + 0.5) * CELL) ? 1 : 0; if (!ROOF[j * GX + i]) NOPEN++; }

// Rebuild the field from the seeds that answer, and score it against the truth grid.
function rebuild(list, truth, hot, ellFixed) {
  const n = list.length, X = new Float64Array(n), Y = new Float64Array(n), V = new Float64Array(n); let m = 0;
  list.forEach((s, i) => { X[i] = s.x; Y[i] = s.y; V[i] = tempAt(s.x, s.y, hot) + ASSUME.noise * s.e; m += V[i]; }); m = n ? m / n : NaN;
  let va = 0; for (let i = 0; i < n; i++) { V[i] -= m; va += V[i] * V[i]; } const s2 = Math.max(1, n > 1 ? va / (n - 1) : 1), n2 = ASSUME.noise ** 2;
  let ell = ellFixed || 10, fit = null;
  if (n >= 3) { if (ellFixed) fit = gpFit(X, Y, V, ell, s2, n2); else for (const e of [5, 8, 12, 18]) { const f = gpFit(X, Y, V, e, s2, n2); if (!fit || f.logml > fit.logml) { fit = f; ell = e; } } }
  const rec = new Float32Array(NG), sensed = new Uint8Array(NG); let se = 0, seS = 0, nS = 0, best = -Infinity, bi = 0;
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    const c = j * GX + i, x = (i + 0.5) * CELL, y = (j + 0.5) * CELL; let v = m, near = false;
    for (let q = 0; q < n; q++) { const r = Math.hypot(x - X[q], y - Y[q]); if (r < ASSUME.foot) near = true; if (fit) v += fit.al[q] * s2 * matern(r, ell); }
    rec[c] = v; if (ROOF[c]) continue; const e = v - truth[c]; se += e * e; if (near) { sensed[c] = 1; seS += e * e; nS++; } if (v > best) { best = v; bi = c; }
  }
  const hx = ((bi % GX) + 0.5) * CELL, hy = (((bi / GX) | 0) + 0.5) * CELL;
  return { n, rec, sensed, ell, rms: n ? Math.sqrt(se / NOPEN) : NaN, rmsS: nS ? Math.sqrt(seS / nS) : NaN, area: nS * CELL * CELL, hotEst: [hx, hy], hotSeen: n > 0 && best - m > 5, hotErr: Math.hypot(hx - hot[0], hy - hot[1]) };
}

export default {
  id: 'seeds', title: 'Sensor seeds', short: 'Seeds',
  readiness: 0.7, readinessNote: 'Shown outdoors on a university campus in 2022, dropped by hand and from a drone. Not a product. HOUND has none.',
  standoff: [2, 100],
  labels: ['concept', 'live-algo'],
  labelNote: 'No seed exists here. The wind, the fall of every seed, the temperature field and the readings are simulated; the forecast, the kriging and every error figure are computed in this page. Fall speed, upright landing and radio range are the published values; the rest is marked assumed.',
  sentences: [
    'A sensor that weighs 30 milligrams, has no battery, and falls slowly enough to ride the wind like a dandelion seed: a drone lets go of hundreds, and each one that lands in sunlight answers a radio reader with a temperature.',
    'Scattered over a site nobody can walk yet, they would draw a map of heat and damp in minutes, which tells a team where something is smouldering and where the flood water still stands before anyone goes in.',
  ],
  needs: 'Daylight (they run on sunlight and stop at dusk), a breeze you can forecast, a reader within about 60 m with a clear path, and seeds that land face up on open ground. It also means leaving electronics scattered on the site.',
  unknown: 'How they fall between buildings: the published tests were over open ground, and this simulation has no building wakes. How many survive rubble, mud and shade is assumed here, not measured. Nobody has shown that a temperature map of this kind helps find a person.',
  sources: [
    { who: 'Iyer, Gaensbauer, Daniel and Gollakota, University of Washington', year: 2022, title: 'Wind dispersal of battery-free wireless devices', where: 'Nature 603, 427 to 433', url: 'https://doi.org/10.1038/s41586-021-04363-9' },
    { who: 'Johnson et al., University of Washington', year: 2023, title: 'Solar-powered shape-changing origami microfliers', where: 'Science Robotics 8(82), eadg4276', url: 'https://doi.org/10.1126/scirobotics.adg4276' },
  ],
  glyph(g, s, t) {
    const sway = Math.sin(t * 0.9) * 0.22, y = ((t * 0.12) % 1) * 5 - 2.5, r = s * 0.3;
    g.save(); g.translate(Math.sin(t * 0.9) * 2, y); g.rotate(sway);
    g.beginPath(); g.moveTo(0, -s * 0.08); g.lineTo(0, s * 0.3); g.stroke();
    for (let k = 0; k < 7; k++) { const a = Math.PI + (k / 6) * Math.PI; g.beginPath(); g.moveTo(0, -s * 0.08); g.lineTo(Math.cos(a) * r, -s * 0.08 + Math.sin(a) * r * 0.85); g.stroke(); }
    g.beginPath(); g.arc(0, s * 0.32, 1.6, 0, TAU); g.fill(); g.restore();
  },

  create({ stage, controls, readout }) {
    L.layout(stage, { cols: 'minmax(0, 1.5fr) minmax(0, 1fr)', rows: '1fr 1fr', areas: ['map foot', 'map conv'] });
    const fMap = L.figure({ area: 'map', title: 'Dropping the seeds…' }), fFoot = L.figure({ area: 'foot', title: 'Where the forecast said they would land, and where they did' }), fConv = L.figure({ area: 'conv', title: 'More seeds, smaller error' });
    stage.append(fMap.el, fFoot.el, fConv.el);

    const P = { wind: 2.5, dir: 250, height: 15, n: 160, range: PUB.range, view: 'rebuilt', seed: 31, aim: [58, 44], reader: [39, 21], hot: [69, 71] };
    let D = null, A = null, truth = new Float32Array(NG), flat = 0, tp = Infinity, playing = false, sinceA = 0, clock = 0, drag = null, geom = null;
    const img = L.raster(GX, GY);
    const MCN = [10, 20, 40, 80, 160, 320], MCT = 10; let mc = null, mcRaf = 0, mcTimer = 0, live = false;
    const streaks = Array.from({ length: 70 }, (_, i) => ({ x: 0, y: 0, a: -1, k: i })), SR = L.rng(5); let gust = [0, 0];

    function makeTruth() { let m = 0; for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) { const c = j * GX + i; truth[c] = tempAt((i + 0.5) * CELL, (j + 0.5) * CELL, P.hot); if (!ROOF[c]) m += truth[c]; } m /= NOPEN; let se = 0; for (let c = 0; c < NG; c++) if (!ROOF[c]) se += (truth[c] - m) ** 2; flat = Math.sqrt(se / NOPEN); }
    const landed = () => (tp === Infinity ? D.seeds : D.seeds.filter((s) => s.tLand <= tp));
    function analyse() { hear(D.seeds, P); A = rebuild(landed().filter((s) => s.heard), truth, P.hot); A.land = landed(); paint(); report(); }
    function drop(animate) {
      D = simulate(P, P.seed, P.n, true); makeTruth();
      if (animate && !L.reduced()) { tp = 0; playing = true; sinceA = 0; } else { tp = Infinity; playing = false; }
      analyse(); queueMc();
    }
    function paint() {
      const T = L.tokens().rgb, v = P.view;
      img.paint((c) => { const i = c % GX, j = GY - 1 - ((c / GX) | 0), k = j * GX + i; let col, dim = 1;
        if (v === 'truth') col = L.heat((truth[k] - TR[0]) / (TR[1] - TR[0]));
        else if (!A.n) { col = T.bg2; }
        else if (v === 'error') { col = L.heat(Math.abs(A.rec[k] - truth[k]) / 8); dim = A.sensed[k] ? 1 : 0.55; }
        else { col = L.heat((A.rec[k] - TR[0]) / (TR[1] - TR[0])); dim = A.sensed[k] ? 1 : 0.42; }
        return [col[0] * dim + T.bg0[0] * (1 - dim), col[1] * dim + T.bg0[1] * (1 - dim), col[2] * dim + T.bg0[2] * (1 - dim)]; });
    }

    // ---- hero: the site from above, and the fall seen from the side ----
    const COL = { ok: 'ok', far: 'warn', dead: 'text3' };
    function seedMark(g, x, y, s, r) {
      if (s.heard) { g.fillStyle = L.tokens().ok; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
      else if (s.state === 'ok') { g.strokeStyle = L.tokens().warn; g.lineWidth = 1.25; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); }
      else { g.strokeStyle = L.rgba('text2', 0.8); g.lineWidth = 1; g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke(); }
    }
    function posAt(s, t) { const q = clamp((t - s.t0) / 0.2, 0, s.tr.length / 3 - 1), a = Math.floor(q), b = Math.min(s.tr.length / 3 - 1, a + 1), f = q - a; return [L.lerp(s.tr[a * 3], s.tr[b * 3], f), L.lerp(s.tr[a * 3 + 1], s.tr[b * 3 + 1], f), L.lerp(s.tr[a * 3 + 2], s.tr[b * 3 + 2], f)]; }
    fMap.draw = (g, w, hh) => {
      if (!D || !A) return; const T = L.tokens(), keyH = 46, vw = VIEW.x1 - VIEW.x0, vh = VIEW.y1 - VIEW.y0;
      const sc = Math.min(w / vw, (hh - keyH - 150) / vh), mw = vw * sc, mh = vh * sc, mx = Math.floor((w - mw) / 2), my = 0;
      const X = (x) => mx + (x - VIEW.x0) * sc, Y = (y) => my + (VIEW.y1 - y) * sc; geom = { X, Y, sc, mx, my, mw, mh, ix: (px) => VIEW.x0 + (px - mx) / sc, iy: (py) => VIEW.y1 - (py - my) / sc };
      g.save(); g.beginPath(); g.rect(mx, my, mw, mh); g.clip();
      g.fillStyle = T.bg1; g.fillRect(mx, my, mw, mh);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(img.canvas, X(0), Y(SITE.h), SITE.w * sc, SITE.h * sc);
      // ground grid every 10 m, the site edge
      g.strokeStyle = L.rgba('text', 0.045); g.lineWidth = 1; g.beginPath(); for (let x = 0; x <= SITE.w; x += 10) { g.moveTo(Math.round(X(x)) + 0.5, Y(0)); g.lineTo(Math.round(X(x)) + 0.5, Y(SITE.h)); } for (let y = 0; y <= SITE.h; y += 10) { g.moveTo(X(0), Math.round(Y(y)) + 0.5); g.lineTo(X(SITE.w), Math.round(Y(y)) + 0.5); } g.stroke();
      g.strokeStyle = T.line3; g.strokeRect(Math.round(X(0)) + 0.5, Math.round(Y(SITE.h)) + 0.5, Math.round(SITE.w * sc), Math.round(SITE.h * sc));
      // wind streaks
      g.lineWidth = 1; for (const p of streaks) { if (p.a < 0) continue; const al = Math.sin(Math.PI * clamp(p.a / p.life)) * 0.3, len = 2.2 + P.wind * 2.2; g.strokeStyle = L.rgba('text', al); g.beginPath(); g.moveTo(X(p.x), Y(p.y)); g.lineTo(X(p.x - (D.wx + gust[0] / Math.max(0.5, P.wind)) * len), Y(p.y - (D.wy + gust[1] / Math.max(0.5, P.wind)) * len)); g.stroke(); }
      // shade, rubble, buildings (quiet)
      const poly = (pts, dx = 0, dy = 0) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0] + dx), Y(p[1] + dy)) : g.moveTo(X(p[0] + dx), Y(p[1] + dy)))); g.closePath(); };
      g.fillStyle = L.rgba('bg0', 0.5); for (const b of BLD) { poly(b.poly, 0, b.h * SHADE); g.fill(); }
      g.setLineDash([2, 3]); g.strokeStyle = L.rgba('text', 0.4); for (const r of RUB) { poly(r); g.stroke(); } g.setLineDash([]);
      for (const b of BLD) { poly(b.poly); g.fillStyle = L.rgba('bg2', 0.94); g.fill(); g.strokeStyle = L.rgba('text', 0.5); g.lineWidth = 1; g.stroke();
        g.save(); poly(b.poly); g.clip(); g.strokeStyle = L.rgba('text', 0.05); g.beginPath(); for (let q = X(b.x0) - (Y(b.y0) - Y(b.y1)); q < X(b.x1); q += 7) { g.moveTo(q, Y(b.y0)); g.lineTo(q + (Y(b.y0) - Y(b.y1)), Y(b.y1)); } g.stroke(); g.restore();
        L.text(g, 'Building ' + b.name + ' roof, ' + b.h + ' m', X(b.x0) + 6, Y(b.y1) + 14, { color: 'text3', size: 10.5 }); }
      // forecast footprint (2 sigma) and the release line
      const F = D.F, ang = Math.atan2(-D.wy, D.wx);
      g.strokeStyle = L.rgba('text', 0.75); g.setLineDash([5, 4]); g.lineWidth = 1; g.beginPath(); g.ellipse(X(P.aim[0]), Y(P.aim[1]), 2 * F.sa * sc, 2 * F.sc * sc, ang, 0, TAU); g.stroke(); g.setLineDash([]);
      const la = [D.cx - D.lx * ASSUME.line / 2, D.cy - D.ly * ASSUME.line / 2], lb = [D.cx + D.lx * ASSUME.line / 2, D.cy + D.ly * ASSUME.line / 2];
      g.strokeStyle = L.rgba('accent', 0.9); g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(la[0]), Y(la[1])); g.lineTo(X(lb[0]), Y(lb[1])); g.stroke();
      g.strokeStyle = L.rgba('accent', 0.35); g.lineWidth = 1; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(X(D.cx), Y(D.cy)); g.lineTo(X(P.aim[0]), Y(P.aim[1])); g.stroke(); g.setLineDash([]);
      // reader and its reach
      const rx = X(P.reader[0]), ry = Y(P.reader[1]);
      g.strokeStyle = L.rgba('accent', 0.5); g.setLineDash([3, 4]); g.beginPath(); g.arc(rx, ry, P.range * sc, 0, TAU); g.stroke(); g.setLineDash([]);
      const pulse = (((clock * 0.3) % 1) + 1) % 1; if (live && !L.reduced()) { g.strokeStyle = L.rgba('accent', 0.35 * (1 - pulse)); g.beginPath(); g.arc(rx, ry, pulse * P.range * sc, 0, TAU); g.stroke(); }
      // seeds: landed, then falling (shadow on the ground, seed drawn larger the higher it is)
      const r0 = clamp(sc * 0.42, 1.6, 2.6);
      for (const s of D.seeds) {
        if (s.tLand <= tp) { const px = X(s.x), py = Y(s.y); let r = r0; if (s.heard && live && !L.reduced()) { const d = Math.hypot(s.x - P.reader[0], s.y - P.reader[1]) / P.range; if (Math.abs(d - pulse) < 0.05) r = r0 + 1.4; } seedMark(g, px, py, s, r); }
        else if (tp >= s.t0) { const p = posAt(s, tp), px = X(p[0]), py = Y(p[1]), lift = p[2] * sc * 0.28, r = 1.4 + p[2] * 0.09;
          g.fillStyle = L.rgba('bg0', 0.55); g.beginPath(); g.ellipse(px, py, r * 1.1, r * 0.7, 0, 0, TAU); g.fill();
          g.strokeStyle = L.rgba('text', 0.9); g.lineWidth = 0.9; g.beginPath(); for (let q = 0; q < 3; q++) { const a = (q / 3) * Math.PI + s.u1 * 3; g.moveTo(px + lift * 0.5 - Math.cos(a) * r, py - lift - Math.sin(a) * r); g.lineTo(px + lift * 0.5 + Math.cos(a) * r, py - lift + Math.sin(a) * r); } g.stroke(); }
      }
      // the drone on its line
      const fd = clamp(tp / D.tFly), dx = X(L.lerp(la[0], lb[0], fd)), dy = Y(L.lerp(la[1], lb[1], fd));
      g.strokeStyle = T.text; g.fillStyle = T.bg0; g.lineWidth = 1.25; for (const [ox, oy] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) { g.beginPath(); g.moveTo(dx, dy); g.lineTo(dx + ox, dy + oy); g.stroke(); g.beginPath(); g.arc(dx + ox, dy + oy, 3, 0, TAU); g.fill(); g.stroke(); }
      // hot spot: truth ring and the hottest point of the rebuilt map
      const hx = X(P.hot[0]), hy = Y(P.hot[1]);
      g.strokeStyle = T.danger; g.lineWidth = 1.5; g.beginPath(); g.arc(hx, hy, HOT.sig * sc, 0, TAU); g.stroke(); g.fillStyle = T.bg0; g.beginPath(); g.arc(hx, hy, drag === 'hot' ? 6 : 4.5, 0, TAU); g.fill(); g.stroke();
      if (A.hotSeen && P.view !== 'truth') { const ex = X(A.hotEst[0]), ey = Y(A.hotEst[1]); g.strokeStyle = T.accent; g.lineWidth = 1.75; g.beginPath(); g.moveTo(ex - 6, ey); g.lineTo(ex + 6, ey); g.moveTo(ex, ey - 6); g.lineTo(ex, ey + 6); g.stroke(); }
      // handles: aim and reader
      const ax = X(P.aim[0]), ay = Y(P.aim[1]); g.strokeStyle = T.accent; g.fillStyle = T.bg0; g.lineWidth = 2; g.beginPath(); g.arc(ax, ay, drag === 'aim' ? 8 : 6, 0, TAU); g.fill(); g.stroke(); g.beginPath(); g.arc(ax, ay, 1.5, 0, TAU); g.fillStyle = T.accent; g.fill();
      g.fillStyle = T.bg0; g.beginPath(); g.rect(rx - 6, ry - 6, 12, 12); g.fill(); g.stroke(); g.lineWidth = 1.25; g.beginPath(); g.arc(rx, ry, 2.5, -2.3, -0.8); g.stroke(); g.beginPath(); g.arc(rx, ry + 2, 1.2, 0, TAU); g.fillStyle = T.accent; g.fill();
      // labels, leader-lined, placed away from the cloud
      const side = (px) => (px > mx + mw * 0.55 ? -1 : 1), up = (py) => (py > my + mh * 0.5 ? -1 : 1);
      L.callout(g, 'hot spot, truth (simulated): drag', hx + HOT.sig * sc * 0.72 * side(hx), hy - HOT.sig * sc * 0.72, hx + 34 * side(hx), hy - HOT.sig * sc - 14, { color: 'danger', dot: false });
      if (A.hotSeen && P.view !== 'truth') L.callout(g, 'hottest point of the rebuilt map', X(A.hotEst[0]), Y(A.hotEst[1]) + 7, X(A.hotEst[0]) + 22 * side(hx), Y(A.hotEst[1]) + 30, { color: 'accent2', dot: false });
      L.callout(g, 'reader: drag', rx + 7 * side(rx), ry + 6, rx + 26 * side(rx), ry + 22, { color: 'accent2', dot: false });
      L.callout(g, 'aim point: drag', ax + 5 * side(ax), ay + 5 * -up(ay), ax + 30 * side(ax), ay - 26 * up(ay), { color: 'accent2', dot: false });
      const lmx = X(lb[0]), lmy = Y(lb[1]); if (lmx > mx + 40 && lmx < mx + mw - 40 && lmy > my + 20 && lmy < my + mh - 20) L.callout(g, 'release line, ' + L.fix(F.drift, 0) + ' m upwind of the aim', lmx, lmy, lmx + 18 * side(lmx), lmy + 20 * (lmy > my + mh / 2 ? 1 : -1), { color: 'accent2', dot: false });
      else L.text(g, 'the release line is ' + L.fix(F.drift, 0) + ' m upwind, off this map', mx + mw / 2, my + 16, { color: 'accent2', size: 11, align: 'center', halo: true });
      g.restore();
      // wind dial (drag to turn the wind), north, scale, clock
      const cxp = mx + 40, cyp = my + 42, cr = 26; geom.dial = [cxp, cyp, cr];
      g.fillStyle = L.rgba('bg0', 0.72); g.beginPath(); g.arc(cxp, cyp, cr + 5, 0, TAU); g.fill(); g.strokeStyle = T.line3; g.lineWidth = 1; g.beginPath(); g.arc(cxp, cyp, cr, 0, TAU); g.stroke();
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; g.beginPath(); g.moveTo(cxp + Math.sin(a) * cr, cyp - Math.cos(a) * cr); g.lineTo(cxp + Math.sin(a) * (cr - (k % 2 ? 3 : 5)), cyp - Math.cos(a) * (cr - (k % 2 ? 3 : 5))); g.stroke(); }
      L.text(g, 'N', cxp, cyp - cr - 8, { color: 'text3', size: 10.5, align: 'center', halo: true });
      const al = 8 + P.wind * 3.2, ux = D.wx, uy = -D.wy; g.strokeStyle = T.accent; g.fillStyle = T.accent; g.lineWidth = 2; g.beginPath(); g.moveTo(cxp - ux * al, cyp - uy * al); g.lineTo(cxp + ux * (al - 4), cyp + uy * (al - 4)); g.stroke(); g.beginPath(); g.moveTo(cxp + ux * (al + 3), cyp + uy * (al + 3)); g.lineTo(cxp + ux * (al - 5) - uy * 4.5, cyp + uy * (al - 5) + ux * 4.5); g.lineTo(cxp + ux * (al - 5) + uy * 4.5, cyp + uy * (al - 5) - ux * 4.5); g.fill();
      L.text(g, 'wind ' + L.fix(P.wind, 1) + ' m/s', cxp + cr + 12, cyp - 3, { color: 'text', size: 11, halo: true }); L.text(g, 'from ' + P.dir + '°: drag the dial', cxp + cr + 12, cyp + 12, { color: 'accent2', size: 11, halo: true });
      L.scaleBar(g, mx + mw - 20 - 20 * sc, my + mh - 10, sc, { metres: 20 });
      if (playing) L.text(g, 't = ' + L.fix(tp, 1) + ' s', mx + mw - 12, my + 18, { color: 'text', size: 11, mono: true, align: 'right', halo: true });
      // key row
      const ky = my + mh + 20; let kx = mx + 2; const cw = Math.min(130, mw * 0.2);
      if (P.view === 'error') L.colorbar(g, kx, ky, cw, L.heat, '0', '8 °C', 'absolute error'); else L.colorbar(g, kx, ky, cw, L.heat, TR[0] + '', TR[1] + ' °C', 'air temperature at the ground');
      kx += cw + 34; const items = [[{ heard: true }, 'answers the reader'], [{ state: 'ok' }, 'working, out of reach'], [{ state: 'x' }, 'failed or on a roof']], compact = mw < 560;
      items.forEach(([s, lab], i) => { const yy = compact ? ky - 4 + i * 13 : ky + 4, xx = compact ? kx : kx + i * 148; seedMark(g, xx + 4, yy, s, 3); L.text(g, lab, xx + 13, yy + 4, { color: 'text2', size: 10.5 }); });
      if (!compact || mw > 430) { const xx = compact ? kx + 150 : kx + 3 * 148; g.strokeStyle = L.rgba('text', 0.75); g.setLineDash([5, 4]); g.beginPath(); g.ellipse(xx + 8, ky + 3, 8, 5, 0, 0, TAU); g.stroke(); g.setLineDash([]); if (xx + 150 < mx + mw) L.text(g, 'forecast footprint (2σ)', xx + 22, ky + 7, { color: 'text2', size: 10.5 }); }
      // ---- side view: height against distance downwind ----
      const sy0 = my + mh + keyH + 14, B = { x: mx + 40, y: sy0 + 4, w: mw - 52, h: Math.max(40, hh - sy0 - 38) };
      let far = 20; for (const s of D.seeds) if (s.al > far) far = s.al; far = Math.max(far, F.drift + 2 * F.sa) * 1.34; const top = P.height * 1.12;
      const Pl = L.plot(g, B, { xd: [0, far], yd: [0, top], xlabel: 'side view: distance downwind of the release line, m', ylabel: 'height, m' });
      g.save(); g.beginPath(); g.rect(B.x, B.y, B.w, B.h + 1); g.clip();
      const step = Math.max(1, Math.floor(D.seeds.length / 46)); g.lineWidth = 1;
      for (let i = 0; i < D.seeds.length; i += step) { const s = D.seeds[i], n = s.tr.length / 3; g.strokeStyle = L.rgba(s.heard ? 'ok' : 'text', s.heard ? 0.3 : 0.16); g.beginPath(); for (let q = 0; q < n; q += 2) { const t = s.t0 + q * 0.2; if (t > tp) break; const a = (s.tr[q * 3] - s.rx) * D.wx + (s.tr[q * 3 + 1] - s.ry) * D.wy; q ? g.lineTo(Pl.X(a), Pl.Y(s.tr[q * 3 + 2])) : g.moveTo(Pl.X(a), Pl.Y(s.tr[q * 3 + 2])); } g.stroke(); }
      // forecast path of an average seed: x(z) = U (H^1.2 - z^1.2) / (1.2 * 10^0.2 * fall speed)
      const zs = [], xs = []; for (let q = 0; q <= 40; q++) { const z = P.height * (1 - q / 40); zs.push(z); xs.push((P.wind * (P.height ** (1 + ASSUME.shear) - z ** (1 + ASSUME.shear))) / ((1 + ASSUME.shear) * 10 ** ASSUME.shear * PUB.vt)); }
      L.trace(g, Pl, xs, zs, { color: 'text', dash: [5, 4], width: 1.25, alpha: 0.85 });
      for (const s of D.seeds) { if (s.tLand <= tp) { if (!s.roof) seedMark(g, Pl.X(s.al), Pl.Y(0) - 2.5, s, 1.6); } else if (tp >= s.t0) { const p = posAt(s, tp); g.fillStyle = T.text; g.beginPath(); g.arc(Pl.X((p[0] - s.rx) * D.wx + (p[1] - s.ry) * D.wy), Pl.Y(p[2]), 1.5, 0, TAU); g.fill(); } }
      g.restore();
      L.callout(g, 'forecast: ' + L.fix(F.drift, 0) + ' m', Pl.X(F.drift), Pl.Y(0), Pl.X(F.drift) + 16, Pl.Y(top * 0.30), { color: 'text', dot: true });
      // wind profile at the right, where no seed flies
      const px0 = B.x + B.w - 86, umax = P.wind * (top / 10) ** ASSUME.shear; g.strokeStyle = L.rgba('accent', 0.8); g.fillStyle = T.accent; g.lineWidth = 1;
      for (let q = 1; q <= 4; q++) { const z = (top * 0.96 * q) / 4.4 + top * 0.1, u = P.wind * (z / 10) ** ASSUME.shear, len = (u / umax) * 54, yy = Math.round(Pl.Y(z)) + 0.5; if (yy > B.y + B.h * 0.62) continue; g.beginPath(); g.moveTo(px0, yy); g.lineTo(px0 + len, yy); g.stroke(); g.beginPath(); g.moveTo(px0 + len + 4, yy); g.lineTo(px0 + len - 2, yy - 3); g.lineTo(px0 + len - 2, yy + 3); g.fill(); L.text(g, L.fix(u, 1), px0 - 5, yy + 3.5, { color: 'text3', size: 10.5, mono: true, align: 'right', weight: 400 }); }
      L.text(g, 'wind by height, m/s', px0 - 26, B.y + 9, { color: 'accent2', size: 10.5 });
    };
    const HANDLES = () => [['hot', P.hot], ['aim', P.aim], ['reader', P.reader]];
    fMap.onPointer((ev) => {
      if (!geom) return; const G = geom, inDial = Math.hypot(ev.x - G.dial[0], ev.y - G.dial[1]) < G.dial[2] + 8;
      let near = null; for (const [k, p] of HANDLES()) if (Math.hypot(G.X(p[0]) - ev.x, G.Y(p[1]) - ev.y) < 15) { near = k; break; }
      if (ev.type === 'down') drag = inDial ? 'dial' : near;
      if (ev.type === 'up' || ev.type === 'leave') { if (drag) { drag = null; fMap.redraw(); } }
      if (drag && (ev.type === 'drag' || ev.type === 'down')) {
        if (drag === 'dial') { const a = (Math.atan2(ev.x - G.dial[0], -(ev.y - G.dial[1])) * 180) / Math.PI; const from = (Math.round((a + 180) / 5) * 5 + 360) % 360; if (from !== P.dir) { P.dir = from; cDir.set(from); redo(); } }
        else { const x = clamp(G.ix(ev.x), 2, SITE.w - 2), y = clamp(G.iy(ev.y), 2, SITE.h - 2); P[drag] = [x, y]; if (drag === 'aim') redo(); else if (drag === 'hot') retruth(); else rehear(); }
      }
      fMap.canvas.style.cursor = drag ? 'grabbing' : near || inDial ? 'grab' : 'default';
    });

    // ---- forecast against the landing cloud ----
    fFoot.draw = (g, w, hh) => {
      if (!D || !A) return; const F = D.F, ls = A.land, B = L.pad(w, hh, { l: 46, t: 14, b: 34, r: 14 });
      let x1 = F.drift + 3 * F.sa, yb = Math.max(3 * F.sc, 36); for (const s of ls) { if (s.al > x1) x1 = s.al; if (Math.abs(s.cr) > yb) yb = Math.abs(s.cr); }
      const Pl = L.plot(g, B, { xd: [0, x1 * 1.06], yd: [-yb * 1.08, yb * 1.08], xlabel: 'distance downwind of the release point, m', ylabel: 'across the wind, m' });
      g.save(); g.beginPath(); g.rect(B.x, B.y, B.w, B.h); g.clip();
      g.strokeStyle = L.rgba('accent', 0.9); g.lineWidth = 2; g.beginPath(); g.moveTo(Pl.X(0) + 1, Pl.Y(-ASSUME.line / 2)); g.lineTo(Pl.X(0) + 1, Pl.Y(ASSUME.line / 2)); g.stroke();
      const ell = (cx, cy, sx, sy, rot, style) => { g.beginPath(); for (let q = 0; q <= 64; q++) { const a = (q / 64) * TAU, ex = Math.cos(a) * sx, ey = Math.sin(a) * sy, px = Pl.X(cx + ex * Math.cos(rot) - ey * Math.sin(rot)), py = Pl.Y(cy + ex * Math.sin(rot) + ey * Math.cos(rot)); q ? g.lineTo(px, py) : g.moveTo(px, py); } style(); };
      for (const s of ls) seedMark(g, Pl.X(s.al), Pl.Y(s.cr), s, 2);
      ell(F.drift, 0, 2 * F.sa, 2 * F.sc, 0, () => { g.strokeStyle = L.rgba('text', 0.85); g.lineWidth = 1.25; g.setLineDash([5, 4]); g.stroke(); g.setLineDash([]); });
      if (A.cloud) { const c = A.cloud; ell(c.ma, c.mc, 2 * c.s1, 2 * c.s2, c.rot, () => { g.strokeStyle = L.tokens().accent; g.lineWidth = 1.5; g.stroke(); });
        g.strokeStyle = L.tokens().text; g.lineWidth = 1; g.beginPath(); g.moveTo(Pl.X(F.drift) - 5, Pl.Y(0)); g.lineTo(Pl.X(F.drift) + 5, Pl.Y(0)); g.moveTo(Pl.X(F.drift), Pl.Y(0) - 5); g.lineTo(Pl.X(F.drift), Pl.Y(0) + 5); g.stroke();
        g.fillStyle = L.tokens().accent; g.beginPath(); g.arc(Pl.X(c.ma), Pl.Y(c.mc), 3.5, 0, TAU); g.fill(); }
      g.restore();
      L.text(g, 'release line', Pl.X(0) + 7, B.y + 11, { color: 'accent2', size: 10.5, halo: true });
      L.callout(g, 'forecast, 2σ', Pl.X(F.drift - 2 * F.sa * 0.707), Pl.Y(2 * F.sc * 0.707), Pl.X(F.drift - 2 * F.sa * 0.707) - 14, Pl.Y(2 * F.sc * 0.707) - 16, { color: 'text', dot: false });
      if (A.cloud) L.callout(g, 'landed, 2σ', Pl.X(A.cloud.ma + 2 * A.cloud.s1 * Math.cos(A.cloud.rot) * 0.707), Pl.Y(A.cloud.mc - 2 * A.cloud.s2 * 0.707), Math.min(B.x + B.w - 70, Pl.X(A.cloud.ma + 2 * A.cloud.s1 * 0.707) + 10), Pl.Y(A.cloud.mc - 2 * A.cloud.s2 * 0.707) + 18, { color: 'accent2', dot: false });
    };

    // ---- error against seed count: repeated drops, a few per frame ----
    function queueMc() { cancelAnimationFrame(mcRaf); clearTimeout(mcTimer); mc = null; if (!live) return; mcTimer = setTimeout(startMc, playing ? 600 : 260); }
    function startMc() { if (!D || !A) return; mc = { ell: A.ell, k: 0, rms: MCN.map(() => []), hits: MCN.map(() => 0), hot: [...P.hot] }; mcRaf = requestAnimationFrame(stepMc); }
    function stepMc() {
      if (!mc || !live) return; const t0 = performance.now();
      while (mc.k < MCN.length * MCT && performance.now() - t0 < 14) { const tr = (mc.k / MCN.length) | 0, ni = mc.k % MCN.length, d = simulate(P, 9000 + tr * 37 + ni * 7919 + P.seed, MCN[ni], false); hear(d.seeds, P); const r = rebuild(d.seeds.filter((s) => s.heard), truth, P.hot, mc.ell); mc.rms[ni].push(Number.isFinite(r.rms) ? r.rms : flat); if (r.hotSeen && r.hotErr < 8) mc.hits[ni]++; mc.k++; }
      const done = mc.k >= MCN.length * MCT; if (!L.reduced() || done) { fConv.redraw(); titleConv(); }
      if (!done) mcRaf = requestAnimationFrame(stepMc);
    }
    const qtl = (a, q) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), p = (s.length - 1) * q, i = Math.floor(p); return L.lerp(s[i], s[Math.min(s.length - 1, i + 1)], p - i); };
    fConv.draw = (g, w, hh) => {
      if (!A) return; const B = L.pad(w, hh, { l: 46, t: 14, b: 34, r: 16 }), ymax = Math.max(flat * 1.25, Number.isFinite(A.rms) ? A.rms * 1.15 : 0, 2);
      const Pl = L.plot(g, B, { xd: [7, 450], yd: [0, ymax], xlog: true, xticks: MCN, xlabel: 'seeds dropped', ylabel: 'RMS error of the rebuilt map, °C', yfmt: (v) => L.fix(v, v < 10 && ymax < 6 ? 1 : 0) });
      L.rule(g, Pl, { y: flat, label: 'no seeds: one flat guess, ' + L.fix(flat, 1) + ' °C', color: 'text3' });
      L.rule(g, Pl, { y: ASSUME.noise, label: 'noise of one sensor, ' + ASSUME.noise + ' °C (assumed)', color: 'ok' });
      if (mc) { const xs = [], lo = [], md = [], hi = []; MCN.forEach((n, i) => { if (mc.rms[i].length) { xs.push(n); lo.push(qtl(mc.rms[i], 0.1)); md.push(qtl(mc.rms[i], 0.5)); hi.push(qtl(mc.rms[i], 0.9)); } });
        if (xs.length > 1) { g.fillStyle = L.rgba('accent', 0.13); g.beginPath(); xs.forEach((x, i) => (i ? g.lineTo(Pl.X(x), Pl.Y(hi[i])) : g.moveTo(Pl.X(x), Pl.Y(hi[i])))); for (let i = xs.length - 1; i >= 0; i--) g.lineTo(Pl.X(xs[i]), Pl.Y(lo[i])); g.closePath(); g.fill(); }
        MCN.forEach((n, i) => { g.fillStyle = L.rgba('accent', 0.4); for (const v of mc.rms[i]) { g.beginPath(); g.arc(Pl.X(n), Pl.Y(v), 1.6, 0, TAU); g.fill(); } });
        L.trace(g, Pl, xs, md, { color: 'accent', width: 2 }); L.dots(g, Pl, xs, md, { color: 'accent', r: 3 });
        if (xs.length) L.text(g, 'median of ' + mc.rms[0].length + ' drops', Pl.X(xs[xs.length - 1]) + 2, Pl.Y(md[md.length - 1]) - 9, { color: 'accent2', size: 10.5, align: 'right', halo: true });
        if (mc.k < MCN.length * MCT) L.text(g, 'running drop ' + mc.k + ' of ' + MCN.length * MCT, B.x + B.w - 4, B.y + B.h - 8, { color: 'text3', size: 10.5, align: 'right', mono: true }); }
      if (Number.isFinite(A.rms)) { const px = Pl.X(clamp(P.n, 7, 450)), py = Pl.Y(A.rms); g.strokeStyle = L.tokens().text; g.fillStyle = L.tokens().bg0; g.lineWidth = 1.5; g.beginPath(); g.arc(px, py, 4.5, 0, TAU); g.fill(); g.stroke(); L.callout(g, 'this drop', px, py, px + (P.n > 100 ? -22 : 22), py - 22, { color: 'text', dot: false }); }
    };
    function titleConv() {
      if (!mc || mc.rms[0].length < 2) { fConv.setTitle('Repeating the drop to see how the error falls with the number of seeds…'); return; }
      const a = qtl(mc.rms[1], 0.5), b = qtl(mc.rms[5].length ? mc.rms[5] : mc.rms[4], 0.5), nb = mc.rms[5].length ? 320 : 160, tries = mc.rms[4].length || 1;
      fConv.setTitle(b < a * 0.9 ? 'Twenty seeds leave the map ' + L.fix(a, 1) + ' °C wrong; ' + nb + ' bring it to ' + L.fix(b, 1) + ' °C' : 'More seeds do not help here: the error stays near ' + L.fix(b, 1) + ' °C because too few answer');
      fConv.setNote('Each dot is one whole drop with new gusts, in today’s wind and with the reader where it is (' + MCT + ' drops per size; band: middle 80 %). At 160 seeds the hot spot is placed within 8 m in ' + mc.hits[4] + ' of ' + tries + ' drops.');
    }

    // ---- readouts ----
    const sWork = L.stat('seeds answer the reader'), sArea = L.stat('of open ground sensed', { unit: '%' }), sRms = L.stat('map error against truth (RMS)', { unit: '°C' }), sDrift = L.stat('mean drift (forecast –)', { unit: 'm' }), sHot = L.stat('hot spot placed', { unit: 'm off' });
    const pub = L.h('table.table.dense.wide', null, L.h('thead', null, L.h('tr', null, L.h('th', null, 'Published for the real devices'), L.h('th.num', null, 'Value'))),
      L.h('tbody', null, [['Mass', '30 mg'], ['Fall speed', '0.87 m/s'], ['Lands face up', 'over 95 %'], ['Travel in a gentle to moderate breeze', '50 to 100 m'], ['Backscatter range', 'up to 60 m'], ['Senses', 'temperature, humidity, pressure, light']].map(([a, b]) => L.h('tr', null, L.h('td', null, a), L.h('td.num', null, b)))));
    const assumed = L.h('p.caption.wide', null, 'Assumed in this simulation: fall speeds spread by 12 %; gusts of 22 % and turbulence of 15 % of the wind; wind rising with height to the power 0.2; 80 % of seeds in shade and 40 % in rubble fail; a wall in the way halves the radio range; sensor noise 0.5 °C; one reading speaks for the ground within 6 m.');
    readout.append(L.h('h4', null, 'Measured against the simulated truth'), sWork.el, sArea.el, sRms.el, sHot.el, sDrift.el, pub, assumed);
    function report() {
      const ls = A.land, n = ls.length, ok = ls.filter((s) => s.state === 'ok').length, heard = A.n, cnt = (k) => ls.filter((s) => s.state === k).length;
      let ma = 0, mcr = 0; for (const s of ls) { ma += s.al; mcr += s.cr; } ma /= n || 1; mcr /= n || 1; let caa = 0, cac = 0, ccc = 0; for (const s of ls) { caa += (s.al - ma) ** 2; cac += (s.al - ma) * (s.cr - mcr); ccc += (s.cr - mcr) ** 2; }
      if (n > 3) { caa /= n - 1; cac /= n - 1; ccc /= n - 1; const tr = caa + ccc, det = caa * ccc - cac * cac, dq = Math.sqrt(Math.max(0, tr * tr / 4 - det)), l1 = tr / 2 + dq, l2 = Math.max(0, tr / 2 - dq); let rot = 0.5 * Math.atan2(2 * cac, caa - ccc); A.cloud = { ma, mc: mcr, s1: Math.sqrt(l1), s2: Math.sqrt(l2), rot }; } else A.cloud = null;
      const F = D.F, off = Math.hypot(ma - F.drift, mcr);
      sWork.set(heard + ' of ' + D.seeds.length, playing ? 'seeds answer the reader (' + n + ' down so far)' : 'seeds answer the reader'); sWork.tone(heard >= 0.5 * D.seeds.length ? 'ok' : heard >= 0.2 * D.seeds.length ? 'warn' : 'danger');
      sArea.set(L.pct(A.area / (NOPEN * CELL * CELL)), 'of open ground sensed (' + Math.round(A.area).toLocaleString('en-US') + ' m²)');
      sRms.set(L.fix(A.rms, 1), 'map error, RMS (' + L.fix(A.rmsS, 1) + ' °C where sensed)'); sRms.tone(!Number.isFinite(A.rms) ? 'danger' : A.rms < 0.45 * flat ? 'ok' : A.rms < 0.8 * flat ? 'warn' : 'danger');
      sDrift.set(n ? L.fix(ma, 0) : '–', 'mean drift; the forecast said ' + L.fix(F.drift, 0) + ' m'); sDrift.tone(n && off > 2 * F.sa ? 'warn' : null);
      if (A.hotSeen) { sHot.set(L.fix(A.hotErr, 0), 'hot spot placed'); sHot.tone(A.hotErr < 6 ? 'ok' : A.hotErr < 15 ? 'warn' : 'danger'); } else { sHot.set('missed', 'hot spot: no seed near it answers'); sHot.tone('danger'); }
      const lost = cnt('out'), roof = cnt('roof'), dead = cnt('down') + cnt('shade') + cnt('rubble');
      fMap.setTitle(P.view === 'truth' ? 'The simulated truth: a smouldering hot spot, and ground cooled by standing flood water'
        : !heard ? 'No seed answers the reader, so there is no map: move the reader or the aim point'
        : P.view === 'error' ? 'Where the rebuilt map is wrong: ' + L.fix(A.rms, 1) + ' °C RMS over the site, ' + L.fix(A.rmsS, 1) + ' °C where seeds reach'
        : heard + ' of ' + D.seeds.length + ' seeds answer the reader, and their readings rebuild the temperature map to within ' + L.fix(A.rms, 1) + ' °C');
      fMap.setNote((BLD.length ? 'The invented exercise site, 120 by 90 m, north up. ' : 'Plain ground, 120 by 90 m. ') + 'Of the ' + n + ' seeds down: ' + roof + ' on roofs, ' + lost + ' off the site, ' + dead + ' face down, shaded or lost in rubble, ' + (ok - heard) + ' working but out of the reader’s reach. Dim ground has no seed within ' + ASSUME.foot + ' m. Kriging length scale chosen by the readings: ' + A.ell + ' m.');
      fFoot.setTitle(n < 4 ? 'The seeds are still in the air' : 'The seeds drifted ' + L.fix(ma, 0) + ' m on a ' + L.fix(P.wind, 1) + ' m/s wind; wind × height ÷ fall speed forecast ' + L.fix(F.drift, 0) + ' m');
      fFoot.setNote('Each mark is one seed. The cloud’s centre landed ' + L.fix(off, 1) + ' m from the forecast centre: gusts move the whole cloud, and roofs catch seeds early. Fall time ' + L.fix(F.T, 0) + ' s from ' + P.height + ' m.');
      fMap.redraw(); fFoot.redraw(); fConv.redraw(); if (!mc) titleConv();
    }

    // ---- controls ----
    const redo = L.soon(() => drop(false)), rehear = L.soon(() => { analyse(); queueMc(); }), retruth = L.soon(() => { makeTruth(); analyse(); queueMc(); });
    const cDir = L.slider({ label: 'Wind from', min: 0, max: 355, step: 5, value: P.dir, unit: '°', hint: 'Compass bearing the wind blows from. You can also drag the dial on the map.', onInput: (v) => { P.dir = v; redo(); } });
    controls.append(
      L.seg({ label: 'Show', value: P.view, options: [{ value: 'rebuilt', label: 'Rebuilt map' }, { value: 'truth', label: 'Truth' }, { value: 'error', label: 'Error' }], onChange: (v) => { P.view = v; paint(); report(); } }).el,
      L.slider({ label: 'Wind at 10 m', min: 0.5, max: 5, step: 0.1, value: P.wind, unit: 'm/s', format: (v) => v.toFixed(1), hint: 'A gentle breeze is 3.4 to 5.4 m/s.', onInput: (v) => { P.wind = v; redo(); } }).el,
      cDir.el,
      L.slider({ label: 'Release height', min: 5, max: 30, step: 1, value: P.height, unit: 'm', onInput: (v) => { P.height = v; redo(); } }).el,
      L.slider({ label: 'Seeds dropped', min: 10, max: 320, step: 10, value: P.n, onInput: (v) => { P.n = v; redo(); } }).el,
      L.slider({ label: 'Reader range', min: 10, max: 100, step: 5, value: P.range, unit: 'm', hint: 'Published backscatter range: up to 60 m.', onInput: (v) => { P.range = v; rehear(); } }).el,
      L.row(L.button({ label: 'Drop again', icon: 'play', primary: true, hint: 'A new draw of gusts and seeds, played at six times real speed.', onClick: () => { P.seed++; drop(true); } })));

    // ---- time ----
    const anim = L.loop((dt) => {
      clock += dt;
      if (playing) { tp += dt * 6; sinceA += dt; if (tp >= D.tEnd) { tp = Infinity; playing = false; analyse(); queueMc(); } else if (sinceA > 0.22) { sinceA = 0; analyse(); } }
      const kg = Math.sqrt((2 * dt) / ASSUME.gustT), sg = ASSUME.gust * P.wind; gust[0] += (-gust[0] * dt) / ASSUME.gustT + sg * kg * SR.n(); gust[1] += (-gust[1] * dt) / ASSUME.gustT + sg * kg * SR.n();
      for (const p of streaks) { if (p.a < 0 || p.a > p.life) { p.x = SR.range(VIEW.x0, VIEW.x1); p.y = SR.range(VIEW.y0, VIEW.y1); p.a = 0; p.life = SR.range(2.5, 6); } p.a += dt; p.x += (D.wx * P.wind + gust[0]) * dt * 3; p.y += (D.wy * P.wind + gust[1]) * dt * 3; }
      fMap.redraw();
    });
    drop(false);
    return {
      start() { live = true; if (L.reduced()) { for (const p of streaks) { p.x = SR.range(VIEW.x0, VIEW.x1); p.y = SR.range(VIEW.y0, VIEW.y1); p.a = 1; p.life = 2; } if (playing) { tp = Infinity; playing = false; analyse(); } }
        paint(); report(); anim.start(); if (!mc || mc.k < MCN.length * MCT) queueMc(); },
      stop() { live = false; anim.stop(); cancelAnimationFrame(mcRaf); clearTimeout(mcTimer); },
    };
  },
};
