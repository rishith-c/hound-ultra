// Insects that search: a swarm of backpack-carrying cockroaches percolating through the pore space of a rubble pile.
// Everything is computed here: the pile (a seeded cross-section on a 1 cm grid), the clearance map (exact Euclidean
// distance transform), which pores a body of a given width can reach (erosion + flood fill + dilation), the swarm
// (surface-walking agents with a steering bias and a line-of-sight heat sensor), where it believes each person is,
// and a Monte Carlo of the time to find everyone against swarm size.
//
// Published numbers used: Madagascar hissing cockroach, about 6 cm long (RIKEN 2022; HTX 2025); the NTU hybrid robot
// is 5.7 cm long and 1.5 cm tall and carries a low-resolution infrared camera (Tran-Ngoc et al. 2023, abstract).
// Assumed, and marked so on screen: body width 2.5 cm, walking speed 5 cm/s, sensor range, dead-reckoning drift
// (about 20 cm after 10 m of walking), widths of the rat, the snake robot and the rover.
import * as L from '../lib.js';
const { TAU, clamp } = L;
const W = 840, H = 350, GROUND = 334;            // cells of 1 cm: 8.4 m wide, 3.5 m deep
const SPEED = 5, DT = 1 / SPEED, TMAX = 1800;    // cm/s (assumed); seconds per 1 cm move; give up after 30 min
const BAND = 3, VR = 5, DRIFT = 0.4;             // walkers stay within 3 cm of a surface; visit stamp; cm² of drift per cm walked
const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1], OFF = DX.map((dx, i) => DY[i] * W + dx);
const PERSIST = [1, 0.7, 0.1, -0.6, -1.2];
const WIDTHS = [1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60];
const SIZES = [2, 4, 8, 16, 32], RUNS = 12;
const BODIES = [{ w: 2.5, name: 'cockroach' }, { w: 6, name: 'snake robot' }, { w: 9, name: 'rat' }, { w: 40, name: 'HOUND rover' }];
const mmss = (s) => (Number.isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '–');
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Exact Euclidean distance to the nearest marked cell (Felzenszwalb and Huttenlocher's two-pass lower envelope).
function edt(feat) {
  const INF = 1e12, n = Math.max(W, H), f = new Float64Array(n), o = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), d = new Float32Array(W * H);
  const pass = (len) => { let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) { let s; for (;;) { const p = v[k]; s = (f[q] + q * q - f[p] - p * p) / (2 * (q - p)); if (s <= z[k] && k > 0) k--; else break; } k++; v[k] = q; z[k] = s; z[k + 1] = INF; }
    k = 0; for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; o[q] = (q - p) * (q - p) + f[p]; } };
  const tmp = new Float64Array(W * H);
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = feat[y * W + x] ? 0 : INF; pass(H); for (let y = 0; y < H; y++) tmp[y * W + x] = o[y]; }
  for (let y = 0; y < H; y++) { const r = y * W; for (let x = 0; x < W; x++) f[x] = tmp[r + x]; pass(W); for (let x = 0; x < W; x++) d[r + x] = Math.sqrt(o[x]); }
  return d;
}

// ---------- the pile: floor slabs that pancaked and leaned, column and beam fragments, chunks, settled fines ----------
function buildPile(seed, comp) {
  const R = L.rng(seed * 7919 + 13), solid = new Uint8Array(W * H), pid = new Uint8Array(W * H), env = new Int16Array(W), pieces = [];
  const nz = Array.from({ length: 12 }, () => R());
  for (let x = 0; x < W; x++) { const u = (x / W) * 10, a = u | 0, t = L.smooth(u - a); env[x] = Math.round(46 + 84 * Math.abs((2 * x) / W - 1) ** 2.3 + 22 * (L.lerp(nz[a], nz[a + 1], t) - 0.5)); }
  const stamp = (r, val) => { const c = Math.cos(r.a), s = Math.sin(r.a), ex = Math.abs(r.hw * c) + Math.abs(r.hh * s), ey = Math.abs(r.hw * s) + Math.abs(r.hh * c);
    for (let y = Math.max(0, Math.floor(r.cy - ey)); y <= Math.min(H - 1, Math.ceil(r.cy + ey)); y++) for (let x = Math.max(0, Math.floor(r.cx - ex)); x <= Math.min(W - 1, Math.ceil(r.cx + ex)); x++) { const dx = x + 0.5 - r.cx, dy = y + 0.5 - r.cy; if (Math.abs(dx * c + dy * s) <= r.hw && Math.abs(dy * c - dx * s) <= r.hh) solid[y * W + x] = val; } };
  const add = (r) => { r.s = R(); pieces.push(r); stamp(r, 1); };
  // ground, a standing wall stub on the left, the neighbouring heap on the right
  for (let k = GROUND * W; k < W * H; k++) solid[k] = 1;
  add({ kind: 'wall', cx: 7, cy: (30 + GROUND) / 2, hw: 7, hh: (GROUND - 30) / 2, a: 0 }); add({ kind: 'wall', cx: W - 5, cy: (130 + GROUND) / 2, hw: 5, hh: (GROUND - 130) / 2, a: 0 });
  // three floors, each broken into plates that tilt about their break lines
  [118, 196, 272].forEach((y0, f) => { let x = 14 + R.range(-40, 30);
    while (x < W - 30) { const len = R.range(170, 330), steep = R() < 0.3, a = (steep ? R.range(0.36, 0.6) : R.range(0.03, 0.26)) * (R() < 0.5 ? -1 : 1), hw = len / 2 - R.range(2, 9), cx = x + len / 2;
      const cy = Math.max(y0 + R.range(-16, 16), env[clamp(Math.round(cx), 0, W - 1)] + 22 + f * 8); add({ kind: 'slab', cx, cy, hw, hh: R.range(8, 10.5), a }); x += len + R.range(4, 26); } });
  // people first, in voids the slabs left; later debris may not fall on them
  const people = [], zones = [];
  for (let tries = 0; tries < 900 && people.length < 3; tries++) { const x = Math.round(R.range(100, W - 110)), ys = [];
    for (let y = env[x] + 70; y <= GROUND; y++) if (solid[y * W + x] && !solid[(y - 1) * W + x]) ys.push(y);
    if (!ys.length) continue; const y = R.pick(ys); let hit = 0, tot = 0;
    for (let v = y - 38; v < y; v++) for (let u = x - 52; u <= x + 50; u += 2) { tot++; if (solid[v * W + u]) hit++; }
    if (hit / tot > (tries < 600 ? 0.03 : 0.1) || people.some((p) => Math.abs(p.x - x) < 190)) continue;
    people.push({ x, y, f: R() < 0.5 ? -1 : 1, name: 'ABC'[people.length] }); zones.push([x - 58, y - 44, x + 58, y + 1]); }
  people.sort((a, b) => a.x - b.x).forEach((p, i) => { p.name = 'ABC'[i]; p.cx = p.x - 10 * p.f; p.cy = p.y - 11;
    p.caps = [[-40, -11, -40, -11, 9], [-28, -10, 8, -10, 10], [8, -10, 26, -27, 7], [26, -27, 40, -6, 6]].map((c) => [p.x + c[0] * p.f, p.y + c[1], p.x + c[2] * p.f, p.y + c[3], c[4]]);
    for (const c of p.caps) for (let y = Math.floor(Math.min(c[1], c[3]) - c[4]); y <= Math.min(H - 1, Math.max(c[1], c[3]) + c[4]); y++) for (let x = Math.floor(Math.min(c[0], c[2]) - c[4]); x <= Math.max(c[0], c[2]) + c[4]; x++) { const k = y * W + x; if (solid[k]) continue;
      const vx = c[2] - c[0], vy = c[3] - c[1], t = clamp(((x - c[0]) * vx + (y - c[1]) * vy) / (vx * vx + vy * vy || 1)); if (Math.hypot(x - c[0] - t * vx, y - c[1] - t * vy) <= c[4]) { solid[k] = 2; pid[k] = i + 1; } } });
  const inZone = (x0, y0, x1, y1) => zones.some((z) => x1 > z[0] && x0 < z[2] && y1 > z[1] && y0 < z[3]);
  const scatter = (n, kind, hw0, hw1, hh0, hh1) => { for (let i = 0, g = 0; i < n && g < n * 6; g++) { const hw = R.range(hw0, hw1), hh = R.range(hh0, hh1), cx = R.range(16 + hw, W - 12 - hw), a = R.range(-1.5, 1.5), cy = R.range(env[Math.round(cx)] + 10, GROUND - hh * 0.6), m = Math.max(hw, hh);
    if (inZone(cx - m, cy - m, cx + m, cy + m)) continue; add({ kind, cx, cy, hw, hh, a }); i++; } };
  scatter(Math.round(14 + 26 * comp), 'block', 12, 30, 8, 17);
  scatter(Math.round(70 + 190 * comp), 'chunk', 4, 11, 3, 8);
  // fines fall straight down from a random spot in the pore space and settle on whatever is below
  for (let i = 0, n = Math.round(500 + 4200 * comp); i < n; i++) { const x = R.int(16, W - 12), y0 = R.int(env[x] + 4, GROUND - 2); if (solid[y0 * W + x]) continue; let y = y0; while (!solid[(y + 1) * W + x]) y++;
    const hw = R.range(1.4, 4.6), hh = R.range(1, 3); if (inZone(x - hw, y - 2 * hh, x + hw, y + 1)) continue; add({ kind: 'fine', cx: x + 0.5, cy: y + 1 - hh * 0.8, hw, hh, a: R.range(-0.5, 0.5) }); }
  const pore = new Uint8Array(W * H); let nPore = 0; for (let y = 0; y < GROUND; y++) for (let x = 0; x < W; x++) if (!solid[y * W + x] && y > env[x]) { pore[y * W + x] = 1; nPore++; }
  const clear = edt(solid); for (let k = 0; k < W * H; k++) clear[k] -= 0.5;      // centre of a free cell to the face of the nearest solid one
  return { solid, pid, env, pieces, people, pore, nPore, clear };
}

// Which free cells have a line of sight to each person within the sensor range: bit p of vis[k].
function visibility(pile, range) {
  const { solid, pid, people } = pile, vis = new Uint8Array(W * H);
  people.forEach((p, i) => { const pts = [[p.cx - 26 * p.f, p.cy], [p.cx, p.cy], [p.cx + 22 * p.f, p.cy - 4], [p.cx + 40 * p.f, p.cy - 12]];
    for (let y = Math.max(1, Math.floor(p.y - 40 - range)); y <= Math.min(GROUND - 1, p.y + range); y++) for (let x = Math.max(1, Math.floor(p.x - 52 - range)); x <= Math.min(W - 2, p.x + 52 + range); x++) { const k = y * W + x; if (solid[k]) continue;
      for (const q of pts) { const dx = q[0] - x, dy = q[1] - y, d = Math.hypot(dx, dy); if (d > range + 9) continue; let ok = false;
        for (let s = 1; s <= d; s++) { const c = Math.round(y + (dy * s) / d) * W + Math.round(x + (dx * s) / d); if (solid[c] === 1) break; if (pid[c] === i + 1) { ok = s <= range; break; } }
        if (ok) { vis[k] |= 1 << i; break; } } } });
  return vis;
}

// Percolation for one body width: erode the free space by the body's half width, flood from the open air, dilate back.
function reach(pile, width) {
  const { clear, pore } = pile, thr = width / 2, n = W * H, rc = new Uint8Array(n), stack = new Int32Array(n); let sp = 0;
  for (let x = 1; x < W - 1; x++) if (clear[x] >= thr) { rc[x] = 1; stack[sp++] = x; }
  while (sp) { const k = stack[--sp], x = k % W; if (x < 1 || x > W - 2 || k >= n - W) continue;
    for (const q of [k - 1, k + 1, k - W, k + W]) if (q >= 0 && !rc[q] && clear[q] >= thr) { rc[q] = 1; stack[sp++] = q; } }
  const d = edt(rc), mask = new Uint8Array(n); let cnt = 0; for (let k = 0; k < n; k++) if (pore[k] && d[k] <= thr + 0.5) { mask[k] = 1; cnt++; }
  return { thr, rc, mask, cnt, frac: cnt / Math.max(1, pile.nPore) };
}
const bandAt = (pile, G, k) => G.rc[k] && pile.clear[k] <= G.thr + BAND;
function geometry(pile, vis, width, rx) {
  const G = reach(pile, width), n = W * H, walk = new Uint8Array(n);
  // the release point: straight down from the air onto the first surface, then the nearest spot a body can stand
  const x0 = clamp(Math.round(rx * W), 20, W - 16); let y0 = 1; while (y0 < GROUND && !pile.solid[(y0 + 1) * W + x0]) y0++;
  let start = -1, best = 1e9; for (let dy = -40; dy <= 12; dy++) for (let dx = -30; dx <= 30; dx++) { const x = x0 + dx, y = y0 + dy; if (x < 2 || x > W - 3 || y < 2 || y > GROUND - 1) continue; const k = y * W + x; if (bandAt(pile, G, k)) { const d = dx * dx + dy * dy; if (d < best) { best = d; start = k; } } }
  const list = []; if (start >= 0) { walk[start] = 1; list.push(start); for (let i = 0; i < list.length; i++) { const k = list[i], x = k % W, y = (k / W) | 0; if (x < 2 || x > W - 3 || y < 2 || y > GROUND - 1) continue; for (let d = 0; d < 8; d++) { const q = k + OFF[d]; if (!walk[q] && bandAt(pile, G, q)) { walk[q] = 1; list.push(q); } } } }
  const findable = pile.people.map(() => false); for (const k of list) { const v = vis[k]; if (v) for (let p = 0; p < findable.length; p++) if (v & (1 << p)) findable[p] = true; }
  return Object.assign(G, { walk, walkList: Int32Array.from(list), start, sx: x0, sy: y0, findable, nFindable: findable.filter(Boolean).length });
}

// ---------- the swarm ----------
// Each insect walks on surfaces (it stays within 3 cm of one), keeps its heading with some wandering, and with
// probability 'steer' per step obeys the operator, who turns it toward the nearest ground no insect has walked.
// live = true adds what the page shows: the sensor's swept area, trails, and the position estimate of each person.
function makeSwarm(pile, vis, G, n, seed, steer, range, live) {
  const R = L.rng(seed), ax = new Int16Array(n), ay = new Int16Array(n), ad = new Uint8Array(n), at = new Float64Array(n), aL = new Float32Array(n), ex = new Float32Array(n), ey = new Float32Array(n), px = new Float32Array(n), py = new Float32Array(n), hd = new Float32Array(n), cnt = new Uint16Array(n);
  const visit = new Uint8Array(W * H), F = new Uint16Array(W * H).fill(65535), queue = new Int32Array(Math.max(1, G.walkList.length)), np = pile.people.length;
  const S = { n, t: 0, done: G.start < 0, found: pile.people.map(() => false), foundT: pile.people.map(() => NaN), nFound: 0, firstT: NaN, allT: NaN, frontier: true, ax, ay, px, py, hd, at,
    seen: live ? new Uint8Array(W * H) : null, nSeen: 0, cover: [[0, 0]], est: pile.people.map(() => null), segs: [], fresh: [], lastSight: new Float32Array(n * 3).fill(-99) };
  const sx = G.start >= 0 ? G.start % W : 0, sy = G.start >= 0 ? (G.start / W) | 0 : 0;
  for (let i = 0; i < n; i++) { ax[i] = sx; ay[i] = sy; px[i] = sx; py[i] = sy; ad[i] = R.int(0, 7); at[i] = i * 1.5; hd[i] = Math.PI / 2; }
  let tF = -1e9;
  function frontier() { let qh = 0, qt = 0; const wl = G.walkList, walk = G.walk;
    for (let i = 0; i < wl.length; i++) { const k = wl[i]; if (!visit[k]) { F[k] = 0; queue[qt++] = k; } else F[k] = 65535; }
    S.frontier = qt > 0;
    while (qh < qt) { const k = queue[qh++], f = F[k] + 1; for (let d = 0; d < 8; d++) { const q = k + OFF[d]; if (walk[q] && F[q] > f) { F[q] = f; queue[qt++] = q; } } } }
  function look(i) { const x = ax[i], y = ay[i], a0 = R() * TAU, seen = S.seen, solid = pile.solid;
    for (let r = 0; r < 32; r++) { const a = a0 + (r / 32) * TAU, c = Math.cos(a), s = Math.sin(a);
      for (let q = 1; q <= range; q++) { const k = Math.round(y + s * q) * W + Math.round(x + c * q); if (k < 0 || solid[k]) break; if (!seen[k]) { seen[k] = 1; S.fresh.push(k); if (G.mask[k]) S.nSeen++; } } } }
  function sight(i, p) {
    if (!S.found[p]) { S.found[p] = true; S.foundT[p] = S.t; S.nFound++; if (S.nFound === 1) S.firstT = S.t; if (S.nFound === G.nFindable) S.allT = S.t; }
    if (!live || S.t - S.lastSight[i * 3 + p] < 8) return; S.lastSight[i * 3 + p] = S.t;
    // what the insect reports: where it believes it is (dead reckoning, drifting) plus a noisy offset to the warm blob
    const P = pile.people[p], d = Math.hypot(P.cx - ax[i], P.cy - ay[i]), sr = 0.15 * d, v = DRIFT * aL[i] + sr * sr + 4, e = S.est[p] || (S.est[p] = { sx: 0, sy: 0, sw: 0, n: 0 });
    e.sx += (P.cx + ex[i] + sr * R.n()) / v; e.sy += (P.cy + ey[i] + sr * R.n()) / v; e.sw += 1 / v; e.n++; e.x = e.sx / e.sw; e.y = e.sy / e.sw; e.sd = Math.sqrt(1 / e.sw); e.err = Math.hypot(e.x - P.cx, e.y - P.cy);
  }
  function move(i) { const x = ax[i], y = ay[i], k = y * W + x, walk = G.walk, obey = R() < steer, f0 = F[k], d0 = ad[i]; let best = -1e9, bd = -1;
    for (let d = 0; d < 8; d++) { const q = k + OFF[d]; if (!walk[q]) continue; if (d & 1 && !walk[k + DX[d]] && !walk[k + DY[d] * W]) continue;
      let turn = Math.abs(d - d0); if (turn > 4) turn = 8 - turn; let sc = PERSIST[turn] + 0.9 * R(); if (obey && f0 < 65535) sc += 3 * (f0 - F[q]); if (sc > best) { best = sc; bd = d; } }
    if (bd < 0) { ad[i] = R.int(0, 7); at[i] += DT; return; }
    const len = bd & 1 ? 1.4142 : 1; ax[i] = x + DX[bd]; ay[i] = y + DY[bd]; ad[i] = bd; at[i] += len * DT; aL[i] += len;
    const nx = ax[i], ny = ay[i], nk = ny * W + nx;
    for (let v = Math.max(0, ny - VR); v <= Math.min(H - 1, ny + VR); v++) { const r = v * W; for (let u = Math.max(0, nx - VR); u <= Math.min(W - 1, nx + VR); u++) visit[r + u] = 1; }
    const vb = vis[nk]; if (vb) for (let p = 0; p < np; p++) if (vb & (1 << p)) sight(i, p);
    if (live) { const sg = Math.sqrt(DRIFT * len); ex[i] += sg * R.n(); ey[i] += sg * R.n(); S.segs.push(x, y, nx, ny); if (++cnt[i] % 3 === 0) look(i); }
  }
  S.advance = (tEnd) => { let moved = false;
    while (S.t < tEnd && !S.done) { S.t += DT; if (S.t - tF >= 4) { frontier(); tF = S.t; }
      for (let i = 0; i < n; i++) if (at[i] <= S.t) { move(i); moved = true; }
      if (S.t >= TMAX || (S.nFound === G.nFindable && (!live || !S.frontier))) S.done = true;
      if (live && (S.t - S.cover[S.cover.length - 1][0] >= 5 || S.done)) S.cover.push([S.t, S.nSeen / Math.max(1, G.cnt)]); }
    return moved; };
  if (live && G.start >= 0) for (let i = 0; i < Math.min(n, 3); i++) look(i);
  return S;
}

function paintPile(pile) {
  const SC = 2, cv = document.createElement('canvas'); cv.width = W * SC; cv.height = H * SC; const g = cv.getContext('2d'), T = L.tokens().rgb, { env, pieces } = pile, R = L.rng(77);
  const base = L.raster(W, H); base.paint((k) => { const x = k % W, d = ((k / W) | 0) - env[x]; return d < 0 ? mix(T.bg2, T.bg3, 0.9 * Math.exp(d / 34)) : mix(T.bg2, T.bg0, L.smooth(d / 90)); });
  g.imageSmoothingEnabled = true; g.drawImage(base.canvas, 0, 0, W * SC, H * SC); g.scale(SC, SC); g.lineJoin = 'round';
  const conc = (t, cy, cx) => { const lit = L.lerp(1, 0.5, clamp((cy - env[clamp(Math.round(cx), 0, W - 1)]) / 250)); return mix(T.bg1, mix(T.bg5, T.text3, t), lit); };
  const rust = L.rgba(mix(T.warn, T.bg3, 0.55), 0.7);
  // ground
  g.fillStyle = L.rgba(T.bg2); g.fillRect(0, GROUND, W, H - GROUND); g.save(); g.beginPath(); g.rect(0, GROUND, W, H - GROUND); g.clip(); g.strokeStyle = L.rgba('text3', 0.22); g.lineWidth = 0.5; g.beginPath(); for (let x = -20; x < W; x += 7) { g.moveTo(x, H); g.lineTo(x + 16, GROUND); } g.stroke(); g.restore();
  for (const p of pieces) { g.save(); g.translate(p.cx, p.cy); g.rotate(p.a); const { hw, hh } = p;
    if (p.kind === 'slab' || p.kind === 'wall') {
      const gr = g.createLinearGradient(0, -hh, 0, hh); if (p.kind === 'wall') { const gw = g.createLinearGradient(-hw, 0, hw, 0); gw.addColorStop(0, L.rgba(conc(0.5, 150, p.cx))); gw.addColorStop(1, L.rgba(conc(0.8, 150, p.cx))); g.fillStyle = gw; }
      else { gr.addColorStop(0, L.rgba(conc(0.95, p.cy, p.cx))); gr.addColorStop(0.2, L.rgba(conc(0.72, p.cy, p.cx))); gr.addColorStop(1, L.rgba(conc(0.42, p.cy, p.cx))); g.fillStyle = gr; }
      g.fillRect(-hw, -hh, 2 * hw, 2 * hh);
      if (p.kind === 'wall') { g.strokeStyle = L.rgba('bg0', 0.45); g.lineWidth = 0.5; g.beginPath(); for (let y = -hh + 9; y < hh; y += 9) { g.moveTo(-hw, y); g.lineTo(hw, y); } g.stroke(); g.restore(); continue; }
      // aggregate, cracks, two layers of reinforcing bar with ties, bars pulled out at the broken ends
      for (let i = 0, n = Math.round(hw * 0.9); i < n; i++) { g.fillStyle = R() < 0.5 ? L.rgba('text', 0.1) : L.rgba('bg0', 0.22); g.fillRect(R.range(-hw, hw), R.range(-hh, hh), R.range(0.6, 1.6), R.range(0.5, 1.2)); }
      g.strokeStyle = L.rgba('bg0', 0.6); g.lineWidth = 0.55; for (let i = 0, n = 1 + ((p.s * 3) | 0); i < n; i++) { let u = R.range(-hw * 0.9, hw * 0.9); g.beginPath(); g.moveTo(u, -hh); for (let v = -hh + 3; v < hh; v += 3) { u += R.range(-2.2, 2.2); g.lineTo(u, v); } g.lineTo(u + R.range(-2, 2), hh); g.stroke(); }
      g.strokeStyle = rust; g.lineWidth = 0.8; g.beginPath(); for (const v of [-hh * 0.48, hh * 0.52]) for (const e of [-1, 1]) { g.moveTo(0, v); g.lineTo(e * hw, v); const o = R.range(4, 10); g.quadraticCurveTo(e * (hw + o * 0.6), v, e * (hw + o), v + R.range(-6, 7)); } g.stroke();
      g.fillStyle = rust; for (let u = -hw + 8; u < hw - 4; u += 16) { g.fillRect(u, -hh * 0.48 - 0.9, 1.6, 1.8); g.fillRect(u + 8, hh * 0.52 - 0.9, 1.6, 1.8); }
      g.strokeStyle = L.rgba('text', 0.3); g.lineWidth = 0.6; g.beginPath(); g.moveTo(-hw, -hh + 0.3); g.lineTo(hw, -hh + 0.3); g.stroke();
      g.strokeStyle = L.rgba('bg0', 0.7); g.beginPath(); g.moveTo(-hw, hh - 0.3); g.lineTo(hw, hh - 0.3); g.stroke();
    } else if (p.kind === 'fine') { g.fillStyle = L.rgba(conc(0.2 + 0.7 * p.s, p.cy, p.cx)); g.fillRect(-hw, -hh, 2 * hw, 2 * hh); }
    else { const j = p.kind === 'block' ? 1 : 0.7, pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map((q) => [q[0] + R.range(-j, j), q[1] + R.range(-j, j)]);
      g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath();
      const gr = g.createLinearGradient(0, -hh, 0, hh); gr.addColorStop(0, L.rgba(conc(0.45 + 0.45 * p.s, p.cy, p.cx))); gr.addColorStop(1, L.rgba(conc(0.2 + 0.4 * p.s, p.cy, p.cx))); g.fillStyle = gr; g.fill();
      g.strokeStyle = L.rgba('bg0', 0.55); g.lineWidth = 0.5; g.stroke();
      if (p.kind === 'block') { g.strokeStyle = L.rgba('text', 0.22); g.lineWidth = 0.5; g.beginPath(); g.moveTo(pts[3][0], pts[3][1]); g.lineTo(pts[0][0], pts[0][1]); g.lineTo(pts[1][0], pts[1][1]); g.stroke();
        for (let i = 0, n = Math.round(hw * hh * 0.05); i < n; i++) { g.fillStyle = L.rgba('bg0', 0.2); g.fillRect(R.range(-hw + 1, hw - 1), R.range(-hh + 1, hh - 1), 1, 0.8); }
        if (p.s > 0.6) { g.strokeStyle = rust; g.lineWidth = 0.7; g.beginPath(); g.moveTo(hw - 1, 0); g.quadraticCurveTo(hw + 4, -1, hw + 7, R.range(-5, 5)); g.stroke(); } } }
    g.restore(); }
  g.setTransform(SC, 0, 0, SC, 0, 0); g.strokeStyle = L.rgba('text3', 0.7); g.lineWidth = 0.6; g.beginPath(); g.moveTo(0, GROUND); g.lineTo(W, GROUND); g.stroke();
  const ao = g.createLinearGradient(0, 70, 0, H); ao.addColorStop(0, L.rgba('bg0', 0)); ao.addColorStop(1, L.rgba('bg0', 0.38)); g.fillStyle = ao; g.fillRect(0, 0, W, H);
  return cv;
}

export default {
  id: 'insects', title: 'Insects that search', short: 'Insects',
  readiness: 1.5, readinessNote: 'Ten cyborg cockroaches went to Myanmar with a Singapore rescue team in 2025, their first field use. They were still in development, and no report says they found anyone. HOUND has none.',
  standoff: [0.02, 2],
  labels: ['concept', 'live-algo'],
  labelNote: 'The pile, the people and the insects are simulated. The clearance map, the reachable pores, the swarm, its position estimates and the repeated trials are computed in this page.',
  sentences: [
    'A live Madagascar hissing cockroach, about 6 cm long, carries a small backpack: electrodes steer it, and a tiny infrared camera looks for body heat.',
    'It walks through gaps in a rubble pile that no rover, dog or rescuer fits through, so the sensor gets within arm’s length of a trapped person.',
  ],
  needs: 'A radio link that survives a metre of concrete, a way to know where each insect is with no satellite fix, steering that still works on an animal that is tired or frightened, and a heat sensor that can tell a person from a warm pipe at half a metre.',
  unknown: 'How well any of this works in a real collapse. The published tests are in laboratory arenas; the 2025 field use found no one. Here the walking speed, the sensor range and the position drift are assumed, and the pile is a flat cross-section: a real one has a third dimension to get lost in.',
  sources: [
    { who: 'Tran-Ngoc et al., Nanyang Technological University', year: 2023, title: 'Intelligent insect–computer hybrid robot: installing innate obstacle negotiation and onboard human detection onto cyborg insect', where: 'Advanced Intelligent Systems 5(5)', url: 'https://doi.org/10.1002/aisy.202200319' },
    { who: 'Kakei et al., RIKEN', year: 2022, title: 'Integration of body-mounted ultrasoft organic solar cell on cyborg insects with intact mobility', where: 'npj Flexible Electronics 6, 78', url: 'https://doi.org/10.1038/s41528-022-00207-2' },
    { who: 'Home Team Science and Technology Agency, Singapore', year: 2025, title: 'Operation Lionheart: a hero’s welcome home', where: 'HTX news, 9 April 2025', url: 'https://www.htx.gov.sg/whats-happening/all-news---events/all-news/2025/operation-lionheart-a-heros-welcome-home', note: 'The agency’s own account of the Myanmar deployment.' },
  ],
  glyph(g, s, t, c) { const a = t * 0.5, r = s * 0.2, x = Math.cos(a) * r, y = Math.sin(a) * r * 0.7;
    g.save(); g.translate(x, y); g.rotate(Math.atan2(Math.cos(a) * 0.7, -Math.sin(a))); const w = Math.sin(t * 9) * 0.25;
    g.beginPath(); g.ellipse(0, 0, s * 0.2, s * 0.1, 0, 0, TAU); g.fill();
    g.beginPath(); for (const e of [-1, 1]) { g.moveTo(s * 0.17, e * 1.5); g.lineTo(s * 0.34, e * (s * 0.1 + w * 3)); for (const u of [-0.08, 0.02, 0.1]) { g.moveTo(s * u, e * s * 0.08); g.lineTo(s * (u + 0.03 * e * w * 4), e * s * 0.19); } } g.stroke();
    g.fillStyle = c.accent; g.fillRect(-s * 0.07, -s * 0.05, s * 0.1, s * 0.1); g.restore(); },

  create({ stage, controls, readout }) {
    L.layout(stage, { cols: 'minmax(0, 1fr) minmax(0, 1.25fr)', rows: 'minmax(0, 1.62fr) minmax(0, 1fr)', areas: ['pile pile', 'perc search'] });
    const fPile = L.figure({ area: 'pile', title: 'Building the pile…' });
    const fPerc = L.figure({ area: 'perc', title: 'How much of the pore space a body can reach' });
    const fSrch = L.figure({ area: 'search', title: 'Coverage, and the time to find everyone' });
    stage.append(fPile.el, fPerc.el, fSrch.el);
    fPile.legend([{ label: 'seen by a heat sensor', color: 'accent', kind: 'box' }, { label: 'person, truth (simulated)', color: 'person', kind: 'dot' }, { label: 'where the swarm places them', color: 'accent', kind: 'hollow' }]);

    const P = { n: 12, width: 2.5, comp: 0.45, steer: 0.6, range: 30, seed: 4, rx: 0.4, run: 0 };
    let pile = null, vis = null, G = null, S = null, pileCv = null, tokKey = '', dragging = false, hero = null, pulse = [];
    const ov = L.raster(W, H), trailCv = document.createElement('canvas'); trailCv.width = W * 2; trailCv.height = H * 2; const tg = trailCv.getContext('2d');
    let sweep = [], sweepAt = 0, mc = null, mcJob = null, chartsDirty = true, timer = 0;

    function newPile() { pile = buildPile(P.seed, P.comp); pileCv = paintPile(pile); tokKey = L.tokens().bg0 + L.tokens().accent; vis = visibility(pile, P.range); sweep = []; sweepAt = 0; retune(); }
    function retune() { G = geometry(pile, vis, P.width, P.rx); release(); }
    function release() {
      P.run++; S = makeSwarm(pile, vis, G, P.n, P.seed * 1000 + P.run, P.steer, P.range, true); pulse = [];
      const T = L.tokens().rgb, d = ov.data, hc = T.text3; d.fill(0);
      for (let k = 0; k < W * H; k++) if (pile.pore[k] && !G.mask[k] && ((k % W) + ((k / W) | 0)) % 5 === 0) { d[4 * k] = hc[0]; d[4 * k + 1] = hc[1]; d[4 * k + 2] = hc[2]; d[4 * k + 3] = 120; }
      tg.setTransform(1, 0, 0, 1, 0, 0); tg.clearRect(0, 0, W * 2, H * 2);
      mc = { runs: SIZES.map(() => []), first: SIZES.map(() => []), total: 0 }; mcJob = null;
      S.advance(L.reduced() ? TMAX : 75); flush(); chartsDirty = true; report();
    }
    function flush() { // newly seen cells into the overlay, new steps into the trail layer
      if (S.fresh.length) { const c = L.tokens().rgb.accent, d = ov.data; for (const k of S.fresh) { d[4 * k] = c[0]; d[4 * k + 1] = c[1]; d[4 * k + 2] = c[2]; d[4 * k + 3] = 78; } S.fresh.length = 0; }
      ov.commit();
      if (S.segs.length) { tg.setTransform(2, 0, 0, 2, 1, 1); tg.strokeStyle = L.rgba('accent2', 0.3); tg.lineWidth = 0.7; tg.lineCap = 'round'; tg.beginPath(); const s = S.segs; for (let i = 0; i < s.length; i += 4) { tg.moveTo(s[i], s[i + 1]); tg.lineTo(s[i + 2], s[i + 3]); } tg.stroke(); S.segs.length = 0; }
    }
    // background work, a few milliseconds at a time: the percolation sweep, then the repeated trials
    function work(budget) {
      const t0 = performance.now(); let did = false;
      if (sweepAt < WIDTHS.length) { const w = WIDTHS[sweepAt], r = reach(pile, w), ok = pile.people.map(() => false);
        for (let k = 0; k < W * H; k++) { const v = vis[k]; if (v && bandAt(pile, r, k)) for (let p = 0; p < ok.length; p++) if (v & (1 << p)) ok[p] = true; }
        sweep.push({ w, frac: r.frac, ok }); sweepAt++; chartsDirty = true; return true; }
      while (mc.total < SIZES.length * RUNS && performance.now() - t0 < budget) { did = true;
        if (!mcJob) { const si = mc.total % SIZES.length; mcJob = { si, sw: makeSwarm(pile, vis, G, SIZES[si], 9001 + P.seed * 131 + mc.total * 17, P.steer, P.range, false) }; }
        mcJob.sw.advance(mcJob.sw.t + 40);
        if (mcJob.sw.done) { mc.runs[mcJob.si].push(Number.isFinite(mcJob.sw.allT) ? mcJob.sw.allT : Infinity); mc.first[mcJob.si].push(mcJob.sw.firstT); mc.total++; mcJob = null; chartsDirty = true; } }
      return did;
    }
    const pending = () => sweepAt < WIDTHS.length || (mc && mc.total < SIZES.length * RUNS);
    const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 0.001)))] : NaN; };

    // ---- hero ----
    fPile.draw = (g, w, hh) => {
      if (!pile) return; const T = L.tokens(), sc = Math.min(w / W, hh / H), x0 = Math.floor((w - W * sc) / 2), y0 = Math.floor((hh - H * sc) / 2); hero = { sc, x0, y0 };
      const X = (x) => x0 + x * sc, Y = (y) => y0 + y * sc;
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(pileCv, x0, y0, W * sc, H * sc); g.drawImage(ov.canvas, x0, y0, W * sc, H * sc); g.drawImage(trailCv, x0, y0, W * sc, H * sc);
      g.strokeStyle = T.line2; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y0 + 0.5, W * sc - 1, H * sc - 1);
      // depth ticks on the left edge, metres below the top of the frame
      for (let m = 1; m <= 3; m++) { const y = Math.round(Y(m * 100)) + 0.5; g.strokeStyle = L.rgba('text3', 0.7); g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + 6, y); g.stroke(); L.text(g, m + ' m', x0 + 9, y, { color: 'text3', size: 10.5, base: 'middle', mono: true, halo: true }); }
      L.scaleBar(g, x0 + W * sc - sc * 100 - 14, y0 + H * sc - 26, sc * 100, { metres: 1 });
      // people: the simulated truth, dim until an insect has a line of sight
      const now = performance.now() / 1000;
      pile.people.forEach((p, i) => { const f = S.found[i];
        g.save(); g.lineCap = 'round'; g.strokeStyle = L.rgba('person', f ? 0.95 : 0.42); for (const c of p.caps) { g.lineWidth = 2 * c[4] * sc * 0.86; g.beginPath(); g.moveTo(X(c[0]), Y(c[1])); g.lineTo(X(c[2]) + 0.01, Y(c[3])); g.stroke(); } g.restore();
        if (f) { const gl = g.createRadialGradient(X(p.cx), Y(p.cy), 2, X(p.cx), Y(p.cy), 62 * sc); gl.addColorStop(0, L.rgba('person', 0.2)); gl.addColorStop(1, L.rgba('person', 0)); g.fillStyle = gl; g.fillRect(X(p.cx - 64), Y(p.cy - 64), 128 * sc, 128 * sc); }
        const e = S.est[i]; if (e) { const ex = X(e.x), ey = Y(e.y); g.strokeStyle = T.accent2; g.lineWidth = 1.5; g.beginPath(); g.moveTo(ex - 6, ey); g.lineTo(ex + 6, ey); g.moveTo(ex, ey - 6); g.lineTo(ex, ey + 6); g.stroke(); g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.arc(ex, ey, Math.max(7, e.sd * sc), 0, TAU); g.stroke(); g.setLineDash([]); }
        const up = p.y - 60 > pile.env[p.x] + 10, lx = X(p.cx + 34 * p.f), ly = Y(p.cy + (up ? -44 : 30));
        const msg = f ? p.name + ': sensed at ' + mmss(S.foundT[i]) + (e ? ', placed ' + Math.round(e.err) + ' cm off' : '') : G.findable[i] ? p.name + ': not reached yet' : p.name + ': sealed off from a ' + P.width + ' cm body';
        L.callout(g, msg, X(p.cx + 6 * p.f), Y(p.cy - 9), lx, ly, { color: f ? 'person' : G.findable[i] ? 'text2' : 'warn', dot: false, size: 11.5 }); });
      for (const q of pulse) { const a = (now - q.t) / 1.6; if (a < 1) { g.strokeStyle = L.rgba('person', 0.8 * (1 - a)); g.lineWidth = 1.5; g.beginPath(); g.arc(X(q.x), Y(q.y), (14 + 70 * a) * sc, 0, TAU); g.stroke(); } }
      // insects: a body 6 cm long and as wide as the slider says, antennae forward, backpack on the thorax
      const bl = Math.max(4.5, 3 * sc), bw = Math.max(2, (P.width / 2) * sc);
      for (let i = 0; i < S.n; i++) { if (S.at[i] > S.t + 1.5 && S.t < i * 1.5) continue; const ix = X(S.px[i] + 0.5), iy = Y(S.py[i] + 0.5);
        g.save(); g.translate(ix, iy); g.rotate(S.hd[i]); g.strokeStyle = L.rgba('text', 0.75); g.lineWidth = 0.8; g.beginPath(); g.moveTo(bl * 0.8, -1); g.lineTo(bl * 1.9, -bw * 1.3); g.moveTo(bl * 0.8, 1); g.lineTo(bl * 1.9, bw * 1.3); g.stroke();
        g.fillStyle = L.rgba('bg0', 0.9); g.beginPath(); g.ellipse(0, 0, bl + 1.2, bw + 1.2, 0, 0, TAU); g.fill(); g.fillStyle = T.text; g.beginPath(); g.ellipse(0, 0, bl, bw, 0, 0, TAU); g.fill();
        g.fillStyle = T.accent; g.fillRect(-bl * 0.1, -bw * 0.75, bl * 0.75, bw * 1.5); g.restore(); }
      // the release point
      const rx = X(G.sx + 0.5), ry = Y(G.sy);
      g.strokeStyle = T.accent; g.lineWidth = 1.5; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(rx, y0 + 16); g.lineTo(rx, ry - 4); g.stroke(); g.setLineDash([]);
      g.fillStyle = T.bg0; g.lineWidth = 2; g.beginPath(); g.arc(rx, y0 + 14, dragging ? 8 : 6, 0, TAU); g.fill(); g.stroke();
      L.text(g, 'release point: drag along the pile', rx + 13, y0 + 18, { color: 'accent2', size: 11.5, halo: true });
      if (G.start < 0) L.text(g, 'No gap here is wide enough for a ' + P.width + ' cm body.', x0 + (W * sc) / 2, y0 + 40, { color: 'warn', size: 12, align: 'center', halo: true });
      // what the pile is made of, pointed out once
      const slab = hero.slab || (hero.slab = pile.pieces.filter((q) => q.kind === 'slab').sort((a, b) => Math.abs(a.cx - W * 0.78) - Math.abs(b.cx - W * 0.78))[0]);
      if (slab) L.callout(g, 'floor slab, reinforcing bar showing', X(slab.cx + slab.hw * 0.5 * Math.cos(slab.a)), Y(slab.cy + slab.hw * 0.5 * Math.sin(slab.a)), X(Math.min(W - 250, slab.cx + 20)), y0 + 24, { color: 'text2', size: 11 });
      if (G.cnt < pile.nPore * 0.97) L.text(g, 'hatched: pores too tight for this body', x0 + 14, y0 + H * sc - 26, { color: 'text3', size: 11, halo: true });
    };
    fPile.onPointer((ev) => { if (!hero || !G) return; const near = Math.abs(ev.x - (hero.x0 + (G.sx + 0.5) * hero.sc)) < 16 && ev.y < hero.y0 + G.sy * hero.sc + 14;
      if (ev.type === 'down') dragging = true; if (ev.type === 'up' || ev.type === 'leave') dragging = false;
      if (dragging && (ev.type === 'down' || ev.type === 'drag')) { P.rx = clamp((ev.x - hero.x0) / hero.sc / W, 0.04, 0.96); retuneSoon(); }
      fPile.canvas.style.cursor = dragging ? 'grabbing' : near ? 'grab' : 'crosshair'; });

    // ---- percolation ----
    fPerc.draw = (g, w, hh) => {
      if (!pile) return; const B = L.pad(w, hh, { l: 44, t: 30, b: 34, r: 14 }), Pl = L.plot(g, B, { xd: [1.2, 70], yd: [0, 100], xlog: true, xticks: [2, 5, 10, 20, 50], xlabel: 'body width, cm', ylabel: 'pore space reached, %' });
      const T = L.tokens();
      BODIES.forEach((b, i) => { const x = Math.round(Pl.X(b.w)) + 0.5; g.strokeStyle = L.rgba('text3', 0.55); g.lineWidth = 1; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x, B.y - 6); g.lineTo(x, B.y + B.h); g.stroke(); g.setLineDash([]);
        L.text(g, b.name, i === 3 ? x - 5 : x + 4, B.y - (i % 2 ? 18 : 6) + (i === 3 ? 0 : 0), { color: 'text2', size: 10.5, align: i === 3 ? 'right' : 'left', halo: true }); });
      if (sweep.length > 1) { const xs = sweep.map((s) => s.w), ys = sweep.map((s) => s.frac * 100); L.trace(g, Pl, xs, ys, { color: 'accent', width: 2, fill: 0.2 }); L.dots(g, Pl, xs, ys, { color: 'accent', r: 1.8 }); }
      // widest body that still gets a line of sight to each person
      pile.people.forEach((p, i) => { let wmax = 0; for (const s of sweep) if (s.ok[i]) wmax = Math.max(wmax, s.w); const y = B.y + B.h - 9 - i * 9; if (!wmax) return;
        g.strokeStyle = L.rgba('person', 0.85); g.lineWidth = 2; g.beginPath(); g.moveTo(B.x + 1, y); g.lineTo(Pl.X(wmax), y); g.stroke(); L.text(g, p.name, Pl.X(wmax) + 4, y + 3.5, { color: 'person', size: 10.5, weight: 600, halo: true }); });
      const x = Pl.X(P.width); g.strokeStyle = T.accent2; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, B.y); g.lineTo(x, B.y + B.h); g.stroke();
      g.fillStyle = T.bg0; g.beginPath(); g.arc(x, Pl.Y(G.frac * 100), 4.5, 0, TAU); g.fill(); g.stroke();
      L.text(g, L.pct(G.frac) + ' %', x + 8, Pl.Y(G.frac * 100) - 7, { color: 'accent2', size: 11, mono: true, halo: true });
      if (sweepAt < WIDTHS.length) L.text(g, 'measuring ' + sweepAt + ' of ' + WIDTHS.length + ' widths', B.x + B.w, B.y + 12, { color: 'text3', size: 10.5, align: 'right' });
    };

    // ---- coverage over time, and the repeated trials ----
    fSrch.draw = (g, w, hh) => {
      if (!S) return; const T = L.tokens(), split = Math.round(w * 0.5), B1 = { x: 44, y: 16, w: split - 44 - 22, h: hh - 16 - 34 }, B2 = { x: split + 40, y: 16, w: w - split - 40 - 12, h: hh - 16 - 34 };
      const tmax = Math.max(6, Math.ceil(S.t / 60 / 3) * 3), P1 = L.plot(g, B1, { xd: [0, tmax], yd: [0, 100], xlabel: 'time since release, min', ylabel: 'reachable pores seen, %' });
      L.trace(g, P1, S.cover.map((c) => c[0] / 60), S.cover.map((c) => c[1] * 100), { color: 'accent', width: 2, fill: 0.16 });
      const last = S.cover[S.cover.length - 1]; g.fillStyle = T.accent; g.beginPath(); g.arc(P1.X(last[0] / 60), P1.Y(last[1] * 100), 3, 0, TAU); g.fill();
      pile.people.forEach((p, i) => { if (!S.found[i]) return; const t = S.foundT[i] / 60; let c = 0; for (const q of S.cover) if (q[0] / 60 <= t) c = q[1]; const x = P1.X(t), y = P1.Y(c * 100);
        g.strokeStyle = L.rgba('person', 0.6); g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x, B1.y + B1.h); g.stroke(); g.fillStyle = T.person; g.beginPath(); g.arc(x, y, 3.5, 0, TAU); g.fill(); L.text(g, p.name, x + 5, B1.y + B1.h - 5, { color: 'person', size: 10.5, weight: 600, halo: true }); });
      L.text(g, 'this swarm of ' + P.n, B1.x + B1.w, B1.y + 10, { color: 'text3', size: 10.5, align: 'right' });
      // trials: median and middle half of the time to sense everyone who can be reached
      const P2 = L.plot(g, B2, { xd: [1.5, 44], yd: [0, 30], xlog: true, xticks: SIZES, yticks: [0, 10, 20, 30], xlabel: 'insects released', ylabel: 'time to find everyone, min' });
      L.rule(g, P2, { y: 30, color: 'text3', dash: [2, 3] }); L.text(g, 'gave up at 30 min', B2.x + B2.w, B2.y + 11, { color: 'text3', size: 10.5, align: 'right', halo: true });
      const med = []; SIZES.forEach((n, i) => { const r = mc.runs[i]; if (!r.length) return; const cap = (v) => Math.min(30, v / 60), q1 = cap(quant(r, 0.25)), m = cap(quant(r, 0.5)), q3 = cap(quant(r, 0.75)), x = P2.X(n);
        g.strokeStyle = L.rgba('accent', 0.55); g.lineWidth = 5; g.lineCap = 'butt'; g.beginPath(); g.moveTo(x, P2.Y(q1) + 0.5); g.lineTo(x, P2.Y(q3) - 0.5); g.stroke();
        for (const v of r) { g.fillStyle = L.rgba('text2', 0.5); g.fillRect(x + 6, P2.Y(cap(v)) - 0.5, 4, 1); } med.push([n, m]); });
      if (med.length > 1) L.trace(g, P2, med.map((m) => m[0]), med.map((m) => m[1]), { color: 'accent', width: 1.25, dash: [3, 3] });
      for (const m of med) { g.fillStyle = T.bg0; g.strokeStyle = T.accent2; g.lineWidth = 1.75; g.beginPath(); g.arc(P2.X(m[0]), P2.Y(m[1]), 4, 0, TAU); g.fill(); g.stroke(); }
      if (Number.isFinite(S.allT)) { const x = P2.X(clamp(P.n, 1.6, 42)), y = P2.Y(Math.min(30, S.allT / 60)); g.strokeStyle = T.text; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5); g.moveTo(x - 5, y + 5); g.lineTo(x + 5, y - 5); g.stroke(); L.text(g, 'the run above', x + 8, y - 6, { color: 'text', size: 10.5, halo: true }); }
      if (mc.total < SIZES.length * RUNS) L.text(g, mc.total + ' of ' + SIZES.length * RUNS + ' trials', B2.x + B2.w, B2.y + B2.h - 6, { color: 'text3', size: 10.5, align: 'right', mono: true });
    };

    // ---- readouts and words ----
    const sReach = L.stat('of the pore space this body can reach', { unit: '%' }), sCov = L.stat('of that seen by a sensor', { unit: '%' }), sFound = L.stat('people sensed'), sFirst = L.stat('time to the first find', { unit: 'min:s' }), sErr = L.stat('median error of their placed positions', { unit: 'cm' });
    readout.append(L.h('h4', null, 'Measured against the simulated truth'), sFound.el, sFirst.el, sErr.el, sCov.el, sReach.el);
    const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
    function report() {
      if (!S) return; const np = pile.people.length, cov = S.cover[S.cover.length - 1][1], errs = S.est.filter(Boolean).map((e) => e.err), me = quant(errs, 0.5);
      sReach.set(L.pct(G.frac)); sReach.tone(G.frac > 0.6 ? 'ok' : G.frac > 0.25 ? 'warn' : 'danger');
      sCov.set(L.pct(cov)); sFound.set(S.nFound + ' of ' + np, G.nFindable < np ? 'people sensed; ' + (np - G.nFindable) + ' sealed off from this body' : 'people sensed'); sFound.tone(S.nFound === np ? 'person' : G.nFindable < np ? 'warn' : null);
      sFirst.set(mmss(S.firstT)); sErr.set(errs.length ? L.fix(me, 0) : '–'); sErr.tone(errs.length ? (me < 15 ? 'ok' : me < 40 ? 'warn' : 'danger') : null);
      const who = (P.n <= 12 ? words[P.n] : String(P.n)) + ' insect' + (P.n === 1 ? '' : 's');
      fPile.setTitle(G.start < 0 ? 'A ' + P.width + ' cm body cannot get into this pile at all' : who + ', ' + P.width + ' cm wide, have seen ' + L.pct(cov) + ' % of the pores they can reach and sensed ' + S.nFound + ' of ' + np + ' people after ' + mmss(S.t) + (S.done ? (S.t >= TMAX ? ', when the run was stopped' : ', and there is nowhere new to go') : ''));
      fPile.setNote('A simulated cross-section through a collapsed three-storey building, 8.4 m by 3.5 m on a 1 cm grid. Each insect stays on a surface and walks at 5 cm/s (assumed), shown 40 times faster than life.');
      const at9 = sweep.find((s) => s.w === 10);
      fPerc.setTitle('A ' + P.width + ' cm body reaches ' + L.pct(G.frac) + ' % of the pore space' + (at9 ? '; at 10 cm it is ' + L.pct(at9.frac) + ' %' : ''));
      fPerc.setNote('Measured on this pile by shrinking the free space by half the body width and flooding in from the open air. Cockroach width 2.5 cm, snake robot 6 cm, rat 9 cm and rover 40 cm are assumed round figures; the rover is far too wide, so HOUND works from outside. Bars: the widest body that still gets a line of sight to each person.');
      const best = SIZES.map((n, i) => [n, quant(mc.runs[i], 0.5)]).filter((m) => Number.isFinite(m[1])), a = best[0], b = best[best.length - 1], all = mc.runs.flat().length;
      fSrch.setTitle(G.nFindable === 0 ? 'No person can be reached by a body this wide, so there is nothing to time' : best.length > 1 && a[0] !== b[0] ? b[0] + ' insects find everyone in a median of ' + L.fix(b[1] / 60, 1) + ' min; ' + a[0] + ' take ' + L.fix(a[1] / 60, 1) + (all < SIZES.length * RUNS ? ' (' + all + ' trials so far)' : '')
        : all ? 'Most trials do not find everyone within 30 minutes' + (all < SIZES.length * RUNS ? ' (' + all + ' trials so far)' : '') : 'Running repeated trials on this pile…');
      fSrch.setNote('Left: the run shown above. Right: ' + RUNS + ' fresh trials per swarm size on the same pile; ring is the median, bar the middle half, ticks the single trials. "Everyone" means every person this body can reach' + (G.nFindable < np ? ': ' + G.nFindable + ' of ' + np + ' here.' : '.'));
    }

    const retuneSoon = L.soon(retune), releaseSoon = L.soon(release);
    controls.append(
      L.slider({ label: 'Insects released', min: 1, max: 40, step: 1, value: P.n, onInput: (v) => { P.n = v; releaseSoon(); } }).el,
      L.slider({ label: 'Body width', min: 1.5, max: 12, step: 0.5, value: P.width, unit: 'cm', format: (v) => v.toFixed(1), hint: 'The narrowest gap the animal and its backpack need. 2.5 cm is an assumed figure for a hissing cockroach.', onInput: (v) => { P.width = v; retuneSoon(); } }).el,
      L.slider({ label: 'Rubble compaction', min: 0, max: 100, step: 5, value: P.comp * 100, unit: '%', hint: 'More broken pieces and fines in the gaps: a new pile with smaller pores.', onInput: (v) => { P.comp = v / 100; pileSoon(); } }).el,
      L.slider({ label: 'Steering toward unexplored ground', min: 0, max: 100, step: 5, value: P.steer * 100, unit: '%', hint: 'How often an insect obeys the electrodes. At 0 % it roams freely.', onInput: (v) => { P.steer = v / 100; releaseSoon(); } }).el,
      L.slider({ label: 'Heat sensor range (assumed)', min: 10, max: 80, step: 5, value: P.range, unit: 'cm', hint: 'Line of sight only. The range of the real camera inside rubble is not published.', onInput: (v) => { P.range = v; rangeSoon(); } }).el,
      L.row(L.button({ label: 'New pile', icon: 'reset', onClick: () => { P.seed++; hero = null; newPile(); kick(); } }), L.button({ label: 'Release again', onClick: () => { release(); kick(); } })));
    const pileSoon = L.soon(() => { hero = null; newPile(); kick(); }), rangeSoon = L.soon(() => { vis = visibility(pile, P.range); sweep = []; sweepAt = 0; retune(); kick(); });

    // ---- running ----
    let acc = 0, lastRep = 0, wasFound = 0;
    const loop = L.loop((dt, t) => {
      if (!S) return;
      if (!S.done) { S.advance(S.t + dt * 40); flush(); }
      for (let i = 0; i < S.n; i++) { const dx = S.ax[i] - S.px[i], dy = S.ay[i] - S.py[i]; if (dx * dx + dy * dy > 0.02) { let d = Math.atan2(dy, dx) - S.hd[i]; d -= TAU * Math.round(d / TAU); S.hd[i] += d * 0.2; } S.px[i] += dx * 0.3; S.py[i] += dy * 0.3; }
      if (S.nFound !== wasFound) { if (S.nFound > wasFound) pile.people.forEach((p, i) => { if (S.found[i] && !pulse.some((q) => q.i === i)) pulse.push({ i, x: p.cx, y: p.cy, t: performance.now() / 1000 }); }); wasFound = S.nFound; }
      work(S.done ? 9 : 5);
      fPile.redraw(); acc += dt;
      if (chartsDirty || t - lastRep > 0.25) { lastRep = t; chartsDirty = false; report(); fPerc.redraw(); fSrch.redraw(); }
    });
    // reduced motion: nothing animates. The run is already at its end state; finish the background work in slices and draw.
    function still() { clearTimeout(timer); if (!S) return; for (let i = 0; i < S.n; i++) { S.px[i] = S.ax[i]; S.py[i] = S.ay[i]; }
      const t0 = performance.now(); while (pending() && performance.now() - t0 < 30) work(30);
      report(); fPile.redraw(); fPerc.redraw(); fSrch.redraw(); if (pending()) timer = setTimeout(still, 0); }
    function kick() { wasFound = S ? S.nFound : 0; if (L.reduced()) still(); }
    const retuneAndKick = () => kick(); void retuneAndKick; void acc;
    newPile();
    return {
      start() { if (pile && tokKey !== L.tokens().bg0 + L.tokens().accent) { pileCv = paintPile(pile); tokKey = L.tokens().bg0 + L.tokens().accent; release(); }
        if (L.reduced()) { if (!S.done) release(); still(); } else loop.start(); },
      stop() { loop.stop(); clearTimeout(timer); },
    };
  },
};
