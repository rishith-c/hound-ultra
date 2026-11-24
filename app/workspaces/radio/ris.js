// Exhibit 06, "Steering radio through gaps" (concept). A reconfigurable intelligent surface: one row of N passive
// elements, each adding a programmable phase to what it re-radiates. Everything on screen is summed in this page:
// field(p) = sum over elements of (a / (d1 d2)) exp(-jk (d1 + d2) + j phi_n) in the open, and behind the rubble the
// field in the gap re-radiated by a Kirchhoff slit integral (so the gap diffracts), plus the direct wave from the
// transmitter (through the gap the same way, and through the rubble with an assumed loss).
import { LAMBDA, F0 } from './lab.js';

const TAU = Math.PI * 2, K = TAU / LAMBDA;
const PX = LAMBDA / 12;                 // field grid pitch: 12 samples per wavelength, 3 per quarter wavelength
const GW = 820, GH = 293;               // field grid, columns by rows
const EP = 6;                           // grid columns per element: lambda / 2 spacing lands exactly on the grid
const ECX = 410;                        // grid column of the middle of the surface
export const WORLD = { w: GW * PX, h: GH * PX, cx: (ECX + 0.5) * PX };   // metres; the surface is the line y = 0
// Amplitudes are square roots of power ratios between isotropic antennas (so 20 log10 |E| is path gain in dB).
// One element of assumed area (lambda/2)^2 and assumed unit gain re-radiates: Pr/Pt = A lambda^2 / (64 pi^3 d1^2 d2^2).
const A_EL = (LAMBDA * LAMBDA) / (16 * Math.PI ** 1.5);
const A_DIR = LAMBDA / (4 * Math.PI);   // free space: Pr/Pt = (lambda / 4 pi d)^2
const ROVER = { x: 3.9, y: 2.45 };
const DB_RANGE = { all: [-100, -40], surface: [-112, -62] };   // drawn range, dB of path gain
const N_LIST = [8, 12, 16, 24, 32, 48, 64, 96, 128];
const mod = (a, m) => ((a % m) + m) % m;
const db20 = (a) => 20 * Math.log10(Math.max(a, 1e-30));
export const quantLoss = (bits) => -db20(Math.sin(Math.PI / 2 ** bits) / (Math.PI / 2 ** bits));   // 1 bit: 3.92 dB

// The rubble is a thin opaque screen on the line y = YB with one slit [g0, g1] (Kirchhoff physical optics).
// Above it the field is the plain free-space sum. Below it, the field in the slit is re-radiated: for a point source
// at r1 from a slit point and a listener r2 beyond it, integrating along the slit's length by stationary phase gives
//   U = (e^{j pi/4} / sqrt(lambda)) * integral over the slit of cos(chi) e^{-jk (r1 + r2)} / sqrt(r1 r2 (r1 + r2)) dx
// which returns e^{-jkR}/R when the slit is wide open. To keep it fast the slowly varying factor sqrt(r1 / (r1 + r2))
// uses one mean source distance R1 and the distance rho from the slit centre; selfCheck() reports what that costs.
const JB = 136, YB = (JB + 1) * PX, DQ = 2 * PX;          // screen row; slit samples every lambda / 6
const CK = [Math.SQRT1_2 / Math.sqrt(LAMBDA), Math.SQRT1_2 / Math.sqrt(LAMBDA)];
WORLD.yb = YB;
export function clear(sx, sy, x, y, g0, g1) {              // straight line from (sx, sy) above the screen to (x, y)
  if (y <= YB) return true;
  const xa = sx + ((x - sx) * (YB - sy)) / (y - sy);
  return xa >= g0 && xa <= g1;
}

// Per-element complex weight: what the element re-radiates, given the transmitter and the chosen phase profile.
export function weights({ N, tx, fo, mode, g0, g1 }) {
  const ex = new Float64Array(N), wr = new Float64Array(N), wi = new Float64Array(N), phi = new Float64Array(N), vis = new Uint8Array(N);
  const e0 = ECX - ((N - 1) / 2) * EP, bits = mode === 'b1' ? 1 : mode === 'b2' ? 2 : 0;
  let nVis = 0;
  for (let n = 0; n < N; n++) {
    const x = (e0 + n * EP + 0.5) * PX, d1 = Math.hypot(x - tx.x, tx.y), d2 = Math.hypot(x - fo.x, fo.y);
    let p = 0;
    if (mode !== 'mirror' && mode !== 'off') {
      p = mod(K * (d1 + d2), TAU);                                         // conjugate phase: every path arrives in step
      if (bits) { const st = TAU / (1 << bits); p = mod(Math.round(p / st) * st, TAU); }
    }
    const amp = mode === 'off' ? 0 : A_EL / d1, a = p - K * d1;
    ex[n] = x; phi[n] = p; wr[n] = amp * Math.cos(a); wi[n] = amp * Math.sin(a);
    vis[n] = clear(x, 0, fo.x, fo.y, g0, g1) ? 1 : 0; nVis += vis[n];
  }
  return { N, e0, ex, wr, wi, phi, vis, nVis, on: mode !== 'off' };
}
function freeSum(w, x, y) {
  let re = 0, im = 0;
  for (let n = 0; n < w.N; n++) { const d = Math.hypot(x - w.ex[n], y), c = Math.cos(K * d) / d, s = -Math.sin(K * d) / d; re += w.wr[n] * c - w.wi[n] * s; im += w.wr[n] * s + w.wi[n] * c; }
  return [re, im];
}
const freeDirect = (tx, x, y) => { const d = Math.max(PX / 2, Math.hypot(x - tx.x, y - tx.y)); return [(A_DIR / d) * Math.cos(K * d), (-A_DIR / d) * Math.sin(K * d)]; };
// The field in the slit, sampled every lambda / 6 (end samples weighted by how much of their cell is open).
// src is a weights object (the surface) or { point: { x, y } } (the transmitter).
export function aperture(src, g0, g1) {
  const iq = [], ar = [], ai = [], xc = (g0 + g1) / 2;
  for (let i = 0; i < GW; i += 2) {
    const x = (i + 0.5) * PX, open = Math.min(g1, x + PX) - Math.max(g0, x - PX); if (open <= 0) continue;
    const v = src.point ? freeDirect(src.point, x, YB) : freeSum(src, x, YB);
    iq.push(i); ar.push((v[0] * open) / DQ); ai.push((v[1] * open) / DQ);
  }
  let R1 = 0;
  if (src.point) R1 = Math.hypot(src.point.x - xc, YB - src.point.y); else { for (let n = 0; n < src.N; n++) R1 += Math.hypot(src.ex[n] - xc, YB); R1 /= src.N; }
  return { iq, ar, ai, xc, R1 };
}
export function below(ap, x, y) {
  const dy = y - YB; let re = 0, im = 0;
  for (let q = 0; q < ap.iq.length; q++) {
    const r = Math.hypot(x - (ap.iq[q] + 0.5) * PX, dy), f = dy / (r * Math.sqrt(r)), c = f * Math.cos(K * r), s = -f * Math.sin(K * r);
    re += ap.ar[q] * c - ap.ai[q] * s; im += ap.ar[q] * s + ap.ai[q] * c;
  }
  const m = DQ * Math.sqrt(ap.R1 / (ap.R1 + Math.hypot(x - ap.xc, dy)));
  return [m * (re * CK[0] - im * CK[1]), m * (re * CK[1] + im * CK[0])];
}
// The same integral with no shortcut: every element to every slit sample to the point. Only used by selfCheck().
export function belowExact(w, x, y, g0, g1) {
  let re = 0, im = 0; const dy = y - YB;
  for (let i = 0; i < GW; i += 2) {
    const xq = (i + 0.5) * PX, open = Math.min(g1, xq + PX) - Math.max(g0, xq - PX); if (open <= 0) continue;
    const r2 = Math.hypot(x - xq, dy);
    for (let n = 0; n < w.N; n++) {
      const r1 = Math.hypot(xq - w.ex[n], YB), f = (open * (dy / r2)) / Math.sqrt(r1 * r2 * (r1 + r2)), c = f * Math.cos(K * (r1 + r2)), s = -f * Math.sin(K * (r1 + r2));
      re += w.wr[n] * c - w.wi[n] * s; im += w.wr[n] * s + w.wi[n] * c;
    }
  }
  return [re * CK[0] - im * CK[1], re * CK[1] + im * CK[0]];
}
export const surfaceAt = (w, ap, x, y) => (!w.on ? [0, 0] : y <= YB ? freeSum(w, x, y) : below(ap, x, y));
export function directAt(tx, dap, x, y, g0, g1, tau) {     // diffracted through the slit, plus the leak through the rubble
  const f = freeDirect(tx, x, y); if (y <= YB) return f;
  const b = below(dap, x, y), l = clear(tx.x, tx.y, x, y, g0, g1) ? 0 : tau;
  return [b[0] + l * f[0], b[1] + l * f[1]];
}

// -3 dB width of the spot nearest the focus, along the floor line through the focus (metres).
export function spotWidth(at, fo) {
  const p = (x) => { const [a, b] = at({ x, y: fo.y }); return a * a + b * b; };
  let xp = fo.x, pm = p(fo.x);
  for (let x = fo.x - 0.2; x <= fo.x + 0.2; x += 0.002) { const v = p(x); if (v > pm) { pm = v; xp = x; } }
  if (!(pm > 0)) return { width: NaN, peak: xp };
  const edge = (dir) => { let x0 = xp, v0 = pm; for (let i = 1; i < 1500; i++) { const x1 = xp + dir * i * 0.001, v1 = p(x1); if (v1 < pm / 2) return x0 + (x1 - x0) * ((v0 - pm / 2) / (v0 - v1)); x0 = x1; v0 = v1; } return NaN; };
  const xl = edge(-1), xr = edge(1);
  return { width: xr - xl, xl, xr, peak: xp, peakDb: 10 * Math.log10(pm) };
}
// Diffraction estimate for the same cut: 0.886 lambda / (spread of sin(angle) over the part of the surface that
// sees the focus). For a small aperture D seen head-on from distance d this is 0.886 lambda d / D.
export function spotEstimate(w, fo) {
  let a = -1, b = -1; for (let n = 0; n < w.N; n++) if (w.vis[n]) { if (a < 0) a = n; b = n; }
  if (a < 0) return { est: NaN, D: 0, d: NaN };
  const s = (x) => (fo.x - x) / Math.hypot(fo.x - x, fo.y), x0 = w.ex[a] - LAMBDA / 4, x1 = w.ex[b] + LAMBDA / 4;
  return { est: (0.886 * LAMBDA) / Math.abs(s(x0) - s(x1)), D: x1 - x0, d: Math.hypot(fo.x - (x0 + x1) / 2, fo.y), a, b };
}

// Every number the exhibit shows, from the same sums the picture is made of.
export function measure(s) {
  const { tx, fo, g0, g1, N } = s, tau = 10 ** (-s.loss / 20), amp = (v) => Math.hypot(v[0], v[1]);
  const field = (W) => { const ap = W.on ? aperture(W, g0, g1) : null; const at = (p) => surfaceAt(W, ap, p.x, p.y); at.w = W; at.ap = ap; return at; };
  const of = (mode, n = N) => field(weights({ ...s, N: n, mode }));
  const cur = of(s.mode), mir = of('mirror'), w = cur.w, dap = aperture({ point: tx }, g0, g1), dir = (p) => directAt(tx, dap, p.x, p.y, g0, g1, tau);
  const sF = cur(fo), dF = dir(fo);
  const one = (p) => A_EL / (Math.hypot(WORLD.cx - tx.x, tx.y) * Math.hypot(WORLD.cx - p.x, p.y));   // the middle element alone, nothing in the way
  const eC = amp(of('focus')(fo)), e1 = amp(of('b1')(fo)), e2 = amp(of('b2')(fo));
  const focusing = s.mode === 'focus' || s.mode === 'b1' || s.mode === 'b2';
  const sp = focusing ? spotWidth(cur, fo) : { width: NaN }, est = spotEstimate(w, fo);
  const sR = cur(ROVER), dR = dir(ROVER), dRov = Math.hypot(ROVER.x - tx.x, ROVER.y - tx.y);
  const gainN = N_LIST.map((n) => ({ n, cont: db20(amp(of('focus', n)(fo)) / one(fo)), bit1: db20(amp(of('b1', n)(fo)) / one(fo)) }));
  const cut = { x: [], cur: [], mir: [] };
  for (let i = 0; i <= 480; i++) { const dx = -1.2 + i * 0.005, p = { x: fo.x + dx, y: fo.y }; cut.x.push(dx); cut.cur.push(db20(amp(cur(p)))); cut.mir.push(db20(amp(mir(p)))); }
  return {
    w, ap: cur.ap, dap, N, nVis: w.nVis, focusing,
    overMirror: w.on ? db20(amp(sF) / amp(mir(fo))) : NaN,
    overOff: db20(Math.hypot(sF[0] + dF[0], sF[1] + dF[1]) / amp(dF)),
    overOne: w.on ? db20(amp(sF) / one(fo)) : NaN, n2: db20(N), n2vis: w.nVis ? db20(w.nVis) : NaN,
    pen1: db20(eC / e1), pen2: db20(eC / e2), pen1Theory: quantLoss(1), pen2Theory: quantLoss(2),
    spot: sp, est, gainN, cut, focusDb: db20(amp(sF)), directFocusDb: db20(amp(dF)),
    rover: { via: w.on ? db20(amp(sR)) : NaN, total: db20(Math.hypot(sR[0] + dR[0], sR[1] + dR[1])), direct: db20(amp(dR)), directOpen: clear(tx.x, tx.y, ROVER.x, ROVER.y, g0, g1), los: db20(A_DIR / dRov), one: db20(one(ROVER)), dist: dRov,
      d1: Math.hypot(WORLD.cx - tx.x, tx.y), d2: Math.hypot(WORLD.cx - ROVER.x, ROVER.y) },
  };
}

// ---- the field on the grid ----
// Elements sit on grid columns, so the field of every element is one shifted copy of a single table g(|dx|, y).
function makeField() {
  const n = GW * GH, gr = new Float32Array(n), gi = new Float32Array(n), NB = GH - JB - 1;
  for (let j = 0; j < GH; j++) for (let d = 0; d < GW; d++) { const r = PX * Math.hypot(d, j + 1); gr[j * GW + d] = Math.cos(K * r) / r; gi[j * GW + d] = -Math.sin(K * r) / r; }
  // slit sample to pixel: DQ cos(chi) e^{-jkr} / sqrt(r) times e^{j pi/4} / sqrt(lambda), by (|dx|, rows below the screen)
  const kr = new Float32Array(NB * GW), ki = new Float32Array(NB * GW);
  for (let jj = 0; jj < NB; jj++) for (let d = 0; d < GW; d++) {
    const r = PX * Math.hypot(d, jj + 1), f = (DQ * (jj + 1) * PX) / (r * Math.sqrt(r)), c = f * Math.cos(K * r), s = -f * Math.sin(K * r);
    kr[jj * GW + d] = c * CK[0] - s * CK[1]; ki[jj * GW + d] = c * CK[1] + s * CK[0];
  }
  const sr = new Float32Array(n), si = new Float32Array(n), dr = new Float32Array(n), di = new Float32Array(n);
  const lev = new Float32Array(n), ur = new Float32Array(n), ui = new Float32Array(n);
  const accR = new Float64Array(GW), accI = new Float64Array(GW);
  function put(R, I, o, step, two) {
    for (let i = 0; i < GW; i += step) {
      const a = accR[i], b = accI[i]; R[o + i] = a; I[o + i] = b;
      if (step === 2) { if (i + 1 < GW) { R[o + i + 1] = a; I[o + i + 1] = b; } if (two) { R[o + GW + i] = a; I[o + GW + i] = b; if (i + 1 < GW) { R[o + GW + i + 1] = a; I[o + GW + i + 1] = b; } } }
    }
  }
  function slitSum(ap, j, step) {            // re-radiate the slit field into row j
    const o2 = (j - JB - 1) * GW, dy = (j - JB) * PX;
    accR.fill(0); accI.fill(0);
    for (let q = 0; q < ap.iq.length; q++) {
      const ar = ap.ar[q], ai = ap.ai[q], iq = ap.iq[q];
      for (let i = 0; i < GW; i += step) { const d = i < iq ? iq - i : i - iq, a = kr[o2 + d], b = ki[o2 + d]; accR[i] += ar * a - ai * b; accI[i] += ar * b + ai * a; }
    }
    for (let i = 0; i < GW; i += step) { const m = Math.sqrt(ap.R1 / (ap.R1 + Math.hypot((i + 0.5) * PX - ap.xc, dy))); accR[i] *= m; accI[i] *= m; }
  }
  // Sum row j. step 2 is the quick pass (every second column and row, copied into 2 by 2 blocks).
  function row(j, step, S) {
    const y = (j + 1) * PX, o = j * GW, w = S.w, two = step === 2 && j + 1 < GH, under = j > JB;
    if (under && w.on) slitSum(S.ap, j, step);
    else {
      accR.fill(0); accI.fill(0);
      if (w.on) for (let e = 0; e < w.N; e++) {
        const wr = w.wr[e], wi = w.wi[e], ei = w.e0 + e * EP;
        for (let i = 0; i < GW; i += step) { const d = i < ei ? ei - i : i - ei, a = gr[o + d], b = gi[o + d]; accR[i] += wr * a - wi * b; accI[i] += wr * b + wi * a; }
      }
    }
    put(sr, si, o, step, two);
    if (!S.direct) return;
    const tx = S.tx.x, ty = S.tx.y;
    if (under) slitSum(S.dap, j, step); else { accR.fill(0); accI.fill(0); }
    const k = under ? (y - ty) / (YB - ty) : 0, lo = tx + (S.g0 - tx) * k, hi = tx + (S.g1 - tx) * k;
    for (let i = 0; i < GW; i += step) {
      const x = (i + 0.5) * PX, f = under ? (x >= lo && x <= hi ? 0 : S.tau) : 1; if (!f) continue;
      const r = Math.max(PX / 2, Math.hypot(x - tx, y - ty)), g = (f * A_DIR) / r; accR[i] += g * Math.cos(K * r); accI[i] -= g * Math.sin(K * r);
    }
    put(dr, di, o, step, two);
  }
  // Turn the complex sums of row j into what is drawn: a level (0..1 over the dB range) and a unit phasor.
  function derive(j, all) {
    const o = j * GW, [DB_LO, DB_HI] = DB_RANGE[all ? 'all' : 'surface'];
    for (let i = o; i < o + GW; i++) {
      const a = sr[i] + (all ? dr[i] : 0), b = si[i] + (all ? di[i] : 0), p = a * a + b * b;
      if (p > 0) { const m = 1 / Math.sqrt(p), l = (Math.log(p) * 10 / Math.LN10 - DB_LO) / (DB_HI - DB_LO); lev[i] = l < 0 ? 0 : l > 1 ? 1 : l; ur[i] = a * m; ui[i] = b * m; } else { lev[i] = 0; ur[i] = 0; ui[i] = 0; }
    }
  }
  const dbAt = (i, j, all) => { const q = j * GW + i, a = sr[q] + (all ? dr[q] : 0), b = si[q] + (all ? di[q] : 0); return 10 * Math.log10(Math.max(a * a + b * b, 1e-30)); };
  return { row, derive, dbAt, lev, ur, ui, sr, si };
}

// Small numerical self-check, run from the console or the test harness: import('./ris.js').then(m => m.selfCheck()).
export function selfCheck() {
  const tx = { x: 2.2, y: 1.0 }, amp = (v) => Math.hypot(v[0], v[1]), r = (x, d = 2) => +x.toFixed(d);
  // 1. free space above the screen: N squared law and the spot width of a full aperture
  const wA = weights({ N: 64, tx, fo: { x: 4.6, y: 1.5 }, mode: 'focus', g0: 0, g1: 9 }), fa = { x: 4.6, y: 1.5 };
  const oneA = A_EL / (Math.hypot(WORLD.cx - tx.x, tx.y) * Math.hypot(WORLD.cx - fa.x, fa.y));
  const spA = spotWidth((p) => freeSum(wA, p.x, p.y), fa), estA = spotEstimate(wA, fa);
  const free = { gainOverOneElement_dB: r(db20(amp(freeSum(wA, fa.x, fa.y)) / oneA)), n2Law_dB: r(db20(64)), spot_cm: r(spA.width * 100), estimate_cm: r(estA.est * 100) };
  // 2. a wide-open slit must give back the free-space field below the screen
  const fo = { x: 4.3, y: 2.9 }, wB = weights({ N: 64, tx, fo, mode: 'focus', g0: 0, g1: WORLD.w }), apB = aperture(wB, 0, WORLD.w);
  const openSlit_dB = r(db20(amp(below(apB, fo.x, fo.y)) / amp(freeSum(wB, fo.x, fo.y))), 3);
  // 3. the default scene: shortcut integral against the full one, and the grid against the point sum
  const s = { N: 64, tx: { x: 1.3, y: 0.95 }, fo: { ...ROVER }, mode: 'focus', g0: WORLD.cx - 0.4, g1: WORLD.cx + 0.4, loss: 30 }, m = measure(s);
  const shortcut_dB = r(db20(amp(below(m.ap, s.fo.x, s.fo.y)) / amp(belowExact(m.w, s.fo.x, s.fo.y, s.g0, s.g1))), 3);
  const F = makeField(), j = 240, i = 300; F.row(j, 1, { w: m.w, ap: m.ap, direct: false });
  const p = below(m.ap, (i + 0.5) * PX, (j + 1) * PX), gridErr = Math.hypot(F.sr[j * GW + i] - p[0], F.si[j * GW + i] - p[1]) / amp(p);
  // 4. phase quantisation, averaged in power over many focus points (free space, 128 elements)
  let p1 = 0, p2 = 0, c = 0;
  for (let q = 0; q < 60; q++) {
    const f = { x: 2 + (q % 10) * 0.47, y: 0.7 + Math.floor(q / 10) * 0.13 }, e = (mode) => amp(freeSum(weights({ N: 128, tx, fo: f, mode, g0: 0, g1: 9 }), f.x, f.y));
    const e0 = e('focus'); p1 += (e('b1') / e0) ** 2; p2 += (e('b2') / e0) ** 2; c++;
  }
  const pen1 = -10 * Math.log10(p1 / c), pen2 = -10 * Math.log10(p2 / c);
  return {
    freeSpace: free, openSlitVersusFreeSpace_dB: openSlit_dB,
    defaultScene: { sees: m.nVis + ' of ' + m.N, overOneElement_dB: r(m.overOne), n2OfThoseThatSee_dB: r(m.n2vis), overMirror_dB: r(m.overMirror), spot_cm: r(m.spot.width * 100), estimate_cm: r(m.est.est * 100), shortcutVersusFullIntegral_dB: shortcut_dB, gridVersusPointSum_relErr: +gridErr.toExponential(2) },
    oneBitPenalty_dB: { measuredMean: r(pen1), theory: r(quantLoss(1)) }, twoBitPenalty_dB: { measuredMean: r(pen2), theory: r(quantLoss(2)) },
    pass: Math.abs(free.gainOverOneElement_dB - free.n2Law_dB) < 1.5 && Math.abs(spA.width / estA.est - 1) < 0.15 && Math.abs(openSlit_dB) < 0.5 && Math.abs(shortcut_dB) < 1 && gridErr < 1e-4 && Math.abs(pen1 - quantLoss(1)) < 0.4,
  };
}

export const meta = {
  title: 'Steering radio through gaps',
  labels: ['concept', 'live-algo'],
  labelNote: 'The panel is a concept: HOUND has none. The field, the phases and every number are summed live in this page.',
  plain: [
    'A flat panel of small passive patches, each delaying the radio wave it reflects by a set amount, can make the reflections from all patches arrive in step at one spot.',
    'Dropped on a slab facing a gap in the rubble, it could bend some of the transmitter’s signal through the gap to where the rover is listening.',
  ],
  cites: [
    { by: 'V. Arun and H. Balakrishnan', year: 2020, title: 'RFocus: Beamforming using thousands of passive antennas (its abstract reports a 9.5 times median signal-strength gain on one office floor)', venue: 'USENIX NSDI', url: 'https://www.usenix.org/conference/nsdi20/presentation/arun' },
    { by: 'Q. Wu and R. Zhang', year: 2019, title: 'Intelligent reflecting surface enhanced wireless network via joint active and passive beamforming', venue: 'IEEE Trans. Wireless Communications 18(11)', url: 'https://doi.org/10.1109/TWC.2019.2936025' },
    { by: 'W. Tang et al.', year: 2021, title: 'Wireless communications with reconfigurable intelligent surface: path loss modeling and experimental measurement (free-space models checked with fabricated surfaces in an anechoic chamber)', venue: 'IEEE Trans. Wireless Communications 20(1)', url: 'https://doi.org/10.1109/TWC.2020.3024887' },
    { by: 'B. Shang, R. Shafin, L. Liu', year: 2021, title: 'UAV swarm-enabled aerial reconfigurable intelligent surface (a proposal)', venue: 'arXiv preprint', url: 'https://arxiv.org/abs/2103.06361' },
  ],
  honest: 'The panel must see both the transmitter and the rover, and a controller must know where both are to set the phases. A 64-element panel is a weak mirror, as the link budget below shows.',
  unknown: 'how to estimate the channel through rubble well enough to set the phases. Nobody has dropped such a panel from a drone into a collapse.',
};

export function create(stage, side, ctx, lab) {
  const { h, tok, rgba, fx, sgn, clamp } = lab;
  const NUM = () => '500 10.5px ' + tok('--mono'), TXT = () => '500 11px ' + tok('--font');
  const mn = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d).replace('-', '−') : '–');
  const S = { N: 64, gw: 0.8, loss: 30, mode: 'focus', view: 'wave', paths: 'surface', tx: { x: 1.3, y: 0.95 }, fo: { ...ROVER } };
  const scene = () => ({ N: S.N, tx: S.tx, fo: S.fo, mode: S.mode, loss: S.loss, g0: WORLD.cx - S.gw / 2, g1: WORLD.cx + S.gw / 2 });
  const F = makeField();
  const off = document.createElement('canvas'); off.width = GW; off.height = GH;
  const ictx = off.getContext('2d'), img = ictx.createImageData(GW, GH), buf = new Uint32Array(img.data.buffer), lut32 = new Uint32Array(256);
  let M = null, job = null, jobS = null, needDirect = true, dirty = true, chartsDirty = true, phase = 0, hover = null, glide = null, L = null;
  const PERIOD = 1.4;                     // seconds on screen for one radio cycle

  // ---- figures ----
  const figScene = lab.figure('', { tag: ctx.kit.realityTag('concept'), cls: 'radio-ris-scene',
    caption: 'Plan view, one row of elements half a wavelength apart. The rubble is a thin opaque screen with one slit (Kirchhoff physical optics), so the gap diffracts; reflections off rubble and floor are left out. The direct wave also leaks through the rubble at the assumed loss. HOUND has no such panel.' });
  const figGain = lab.figure('', { cls: 'radio-ris-gain' });
  const figCut = lab.figure('', { cls: 'radio-ris-cut' });
  stage.append(h('div.radio-grid.radio-ris-grid', null, figScene, figGain, figCut));
  figScene.body.classList.add('radio-ris-body');
  figGain.body.classList.add('radio-ris-body'); figCut.body.classList.add('radio-ris-body');

  const hTx = h('button.radio-ris-handle', { type: 'button', 'aria-label': 'Transmitter. Drag, or use the arrow keys, to move it.', title: 'Transmitter: drag, or arrow keys' });
  const hFo = h('button.radio-ris-handle', { type: 'button', 'aria-label': 'Focus point. Drag, or use the arrow keys, to move it.', title: 'Focus point: drag, or arrow keys' });
  const cvScene = lab.canvas(figScene.body, drawScene, { label: 'Plan of the transmitter, the surface, the rubble with one gap, and the computed radio field behind it' });
  figScene.body.append(hFo, hTx);
  const cvGain = lab.canvas(figGain.body, drawGain, { label: 'Gain at the focus against the number of elements, measured points against the N squared law' });
  const cvCut = lab.canvas(figCut.body, drawCut, { label: 'Signal level along the floor through the focus' });

  // ---- side: controls and readouts ----
  const MODE_NAMES = { off: 'Surface off', mirror: 'Plain mirror', focus: 'Focused', b1: 'Focused, 1 bit', b2: 'Focused, 2 bits' };
  const segMode = lab.seg([['off', 'Off', 'Every element absorbs: no reflection'], ['mirror', 'Mirror', 'Every element adds the same phase, like a metal sheet'], ['focus', 'Focused', 'Each element adds exactly the phase that lines its path up at the focus'], ['b1', '1 bit', 'Only two phases, 0 or 180 degrees, like cheap hardware'], ['b2', '2 bits', 'Four phases, 90 degrees apart']],
    S.mode, (v) => { S.mode = v; change(true); }, { label: 'Phase profile' });
  const segView = lab.seg([['wave', 'Wavefronts', 'The wave itself at one instant, slowed down'], ['level', 'Level, dB', 'Signal strength, averaged over a cycle']], S.view, (v) => { S.view = v; rederive(); }, { label: 'Picture' });
  const segPaths = lab.seg([['all', 'All paths', 'Direct wave from the transmitter plus the surface'], ['surface', 'Surface only', 'Only what the surface re-radiates']], S.paths, (v) => { S.paths = v; rederive(); }, { label: 'Paths drawn' });
  const btn = h('button.btn.btn-primary.radio-ris-btn', { type: 'button', onclick: focusRover }, 'Focus on the rover');
  const slN = lab.slider({ label: 'Elements', min: 8, max: 128, step: 1, value: S.N, format: (v) => v + ' · ' + (v * LAMBDA / 2).toFixed(2) + ' m', oninput: (v) => { S.N = v; change(true); } });
  const slGap = lab.slider({ label: 'Gap width', min: 0.1, max: 2.4, step: 0.05, value: S.gw, format: (v) => v.toFixed(2) + ' m', oninput: (v) => { S.gw = v; change(true, true); } });
  const slLoss = lab.slider({ label: 'Rubble loss', min: 10, max: 60, step: 1, value: S.loss, format: (v) => v + ' dB', title: 'Assumed loss of the direct path where it crosses the rubble', oninput: (v) => { S.loss = v; change(true, true); } });
  const st = {
    mirror: lab.stat('Over plain mirror', 'dB', { title: 'Field at the focus with this profile, against every element adding the same phase' }),
    off: lab.stat('Over surface off', 'dB', { title: 'Total field at the focus (direct plus surface) against the direct path alone' }),
    one: lab.stat('Over one element', 'dB', { title: 'Against the middle element alone with nothing in the way' }),
    n2: lab.stat('N² law, 20·log N', 'dB', { title: 'Ideal coherent gain of N equal elements over one' }),
    spot: lab.stat('Spot width, −3 dB', 'cm', { title: 'Measured on the field along the floor line through the focus' }),
    est: lab.stat('Diffraction estimate', 'cm', { title: '0.886 λ / (spread of sin θ over the part of the surface the focus can see). For a small aperture D seen head-on from distance d this is 0.886 λ·d / D.' }),
    sees: lab.stat('Sees the focus', '', { title: 'Elements with a straight line to the focus through the gap. The rest reach it only by diffraction.' }),
    pen: lab.stat('1-bit penalty', 'dB', { title: 'Continuous phases against 0 or 180 degrees only, measured at the focus. Theory for many elements: 20·log(π/2).' }),
    via: lab.stat('Via the surface', 'dB'), dir: lab.stat('Direct path', 'dB', { title: 'What reaches the rover without the surface: the leak through the rubble at the assumed loss, plus what diffracts through the gap' }),
    los: lab.stat('Clear line of sight', 'dB', { title: 'Free space over the same straight distance, if nothing were in the way' }), el: lab.stat('One element alone', 'dB'),
  };
  const budgetNote = h('p');
  side.append(
    lab.group('Surface', h('div.radio-row', null, segMode), slN, slGap, slLoss, h('div.radio-row', null, segView, segPaths), btn,
      h('p.radio-ris-hint', null, 'Drag the focus ring or the transmitter on the figure. With either selected, the arrow keys move it a quarter wavelength.')),
    lab.group('At the focus, measured from the field', h('div.radio-stats', null, st.mirror, st.off, st.one, st.n2, st.spot, st.est, st.sees, st.pen)),
    lab.group('Link budget at the rover', h('div.radio-stats', null, st.via, st.dir, st.los, st.el), budgetNote,
      h('p.radio-ris-hint', null, 'Path gain between antennas of unit gain. Assumed: element size λ/2 by λ/2, unit element gain. λ = ' + (LAMBDA * 100).toFixed(1) + ' cm at ' + (F0 / 1e6).toFixed(0) + ' MHz.')));

  // ---- state changes ----
  function change(restart, directToo) {
    M = measure(scene());
    if (restart) { job = { pass: 0, j: 0 }; jobS = { w: M.w, ap: M.ap, dap: M.dap, tx: { ...S.tx }, g0: scene().g0, g1: scene().g1, tau: 10 ** (-S.loss / 20), direct: (needDirect = needDirect || !!directToo) }; }
    readouts(); dirty = chartsDirty = true; run.once();
  }
  function rederive() { for (let j = 0; j < GH; j++) F.derive(j, S.paths === 'all'); dirty = true; run.once(); }
  function readouts() {
    const m = M, r = m.rover;
    st.mirror.set(m.w.on ? sgn(m.overMirror) : '–', m.overMirror > 3 ? 'ok' : '');
    st.off.set(sgn(m.overOff), m.overOff > 3 ? 'ok' : '');
    st.one.set(mn(m.overOne)); st.n2.set(mn(m.n2));
    st.spot.set(mn(m.spot.width * 100)); st.est.set(m.focusing ? mn(m.est.est * 100) : '–');
    st.sees.set(m.nVis + ' of ' + m.N, m.nVis === 0 ? 'warn' : '');
    st.pen.set(mn(m.pen1) + ' · theory ' + mn(m.pen1Theory));
    st.via.set(mn(r.via), 'accent'); st.dir.set(mn(r.direct)); st.los.set(mn(r.los)); st.el.set(mn(r.one));
    const short = r.los - r.via;
    budgetNote.textContent = !m.w.on ? 'With the surface off the rover hears only the direct path' + (r.directOpen ? ', which here is open.' : ': a leak through the rubble and a little diffracted by the gap.')
      : (r.directOpen ? 'Here the transmitter sees the rover through the gap, so the surface is not needed. ' : '') + 'Via the surface the rover gets ' + mn(Math.abs(short)) + ' dB ' + (short >= 0 ? 'less' : 'more') + ' than a clear line of sight over the same ' + r.dist.toFixed(1) + ' m would give'
        + (r.directOpen ? '.' : ', and ' + mn(Math.abs(r.via - r.direct)) + ' dB ' + (r.via >= r.direct ? 'more' : 'less') + ' than the direct path (' + S.loss + ' dB of rubble assumed).') + ' A reflection falls off as 1/(d₁·d₂)², here (' + r.d1.toFixed(1) + ' m × ' + r.d2.toFixed(1) + ' m)², not as 1/d².';
    const onRover = Math.hypot(S.fo.x - ROVER.x, S.fo.y - ROVER.y) < 0.02 && m.focusing;
    btn.disabled = onRover && !glide; btn.textContent = onRover ? 'Focused on the rover' : 'Focus on the rover';
    const frac = m.nVis + ' of ' + m.N + ' elements';
    figScene.setTitle(S.mode === 'off' ? 'Surface off: only the direct path reaches behind the rubble'
      : S.mode === 'mirror' ? 'Plain mirror: the reflection goes where the angles send it, ' + mn(m.focusDb) + ' dB at the focus'
        : m.nVis === 0 ? 'No element can see the focus through the gap: nothing to focus with'
          : MODE_NAMES[S.mode] + ': ' + frac + ' reach the focus through the gap, ' + sgn(m.overMirror) + ' dB over a plain mirror');
    const capped = m.nVis < m.N;
    figGain.setTitle(!m.w.on ? 'Gain at the focus against the N² law' : (capped ? 'The gap caps the gain: ' + frac + ' see the focus, ' : 'Gain follows the N² law: ') + mn(m.overOne) + ' dB over one element (ideal ' + mn(m.n2) + ')');
    figCut.setTitle(m.focusing && Number.isFinite(m.spot.width) ? 'Focal spot ' + (m.spot.width * 100).toFixed(1) + ' cm wide at −3 dB; diffraction estimate ' + (m.est.est * 100).toFixed(1) + ' cm' : 'Signal along the floor through the focus point');
  }
  function focusRover() {
    if (S.mode === 'off' || S.mode === 'mirror') { S.mode = 'focus'; segMode.set('focus'); }
    if (lab.reducedMotion()) { S.fo = { ...ROVER }; change(true); return; }
    glide = { from: { ...S.fo }, t: 0 }; change(true);
  }

  // ---- dragging and keys ----
  const lim = { tx: { x0: 0.15, x1: WORLD.w - 0.15, y0: 0.25, y1: YB - 0.3 }, fo: { x0: 0.15, x1: WORLD.w - 0.15, y0: YB + 0.3, y1: WORLD.h - 0.12 } };
  const place = (key, x, y) => { const b = lim[key]; S[key] = { x: clamp(x, b.x0, b.x1), y: clamp(y, b.y0, b.y1) }; glide = null; change(true, key === 'tx'); };
  for (const [el, key] of [[hTx, 'tx'], [hFo, 'fo']]) {
    let grab = null;
    el.addEventListener('pointerdown', (e) => { if (!L) return; el.setPointerCapture(e.pointerId); const r = cvScene.el.getBoundingClientRect(); grab = { dx: (e.clientX - r.left - L.ox) / L.sc - S[key].x, dy: (e.clientY - r.top - L.T) / L.sc - S[key].y }; el.classList.add('is-drag'); });
    el.addEventListener('pointermove', (e) => { if (!grab) return; const r = cvScene.el.getBoundingClientRect(); place(key, (e.clientX - r.left - L.ox) / L.sc - grab.dx, (e.clientY - r.top - L.T) / L.sc - grab.dy); });
    const end = () => { grab = null; el.classList.remove('is-drag'); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!d) return;
      e.preventDefault(); const q = (LAMBDA / 4) * (e.shiftKey ? 4 : 1); place(key, S[key].x + d[0] * q, S[key].y + d[1] * q);
    });
  }
  cvScene.el.addEventListener('pointermove', (e) => {
    if (!L) return; const r = cvScene.el.getBoundingClientRect(), x = (e.clientX - r.left - L.ox) / L.sc, y = (e.clientY - r.top - L.T) / L.sc;
    hover = x >= 0 && x < WORLD.w && y > PX && y < WORLD.h ? { x, y } : null; dirty = true; run.once();
  });
  cvScene.el.addEventListener('pointerleave', () => { hover = null; dirty = true; run.once(); });

  // ---- the frame ----
  function work(budget) {
    const t0 = performance.now(), all = S.paths === 'all';
    while (job && performance.now() - t0 < budget) {
      if (job.pass === 0) { F.row(job.j, 2, jobS); F.derive(job.j, all); if (job.j + 1 < GH) F.derive(job.j + 1, all); job.j += 2; if (job.j >= GH) { job.pass = 1; job.j = 0; } }
      else { F.row(job.j, 1, jobS); F.derive(job.j, all); job.j++; if (job.j >= GH) { job = null; needDirect = false; } }
    }
  }
  function paint() {
    const n = GW * GH, lev = F.lev;
    if (S.view === 'wave') { const c = Math.cos(phase), s = Math.sin(phase), ur = F.ur, ui = F.ui; for (let i = 0; i < n; i++) buf[i] = lut32[(lev[i] * (0.3 + 0.35 * (1 + ur[i] * c - ui[i] * s)) * 255) | 0]; }
    else for (let i = 0; i < n; i++) buf[i] = lut32[(lev[i] * 255) | 0];
    ictx.putImageData(img, 0, 0);
  }
  const run = lab.loop((t, dt) => {
    if (glide) {
      glide.t = dt === 0 ? 1 : Math.min(1, glide.t + dt / 0.45); const e = 1 - (1 - glide.t) ** 3, f = glide.from;
      S.fo = { x: f.x + (ROVER.x - f.x) * e, y: f.y + (ROVER.y - f.y) * e }; if (glide.t >= 1) { S.fo = { ...ROVER }; glide = null; }
      M = measure(scene()); job = { pass: 0, j: 0 }; jobS = { ...jobS, w: M.w, ap: M.ap }; readouts(); chartsDirty = true;
    }
    if (job) { work(dt === 0 ? Infinity : job.pass === 0 ? 14 : 8); dirty = true; }
    if (S.view === 'wave' && dt > 0) { phase = (phase + (dt * TAU) / PERIOD) % TAU; dirty = true; }
    if (dirty) { dirty = false; paint(); cvScene.redraw(); }
    if (chartsDirty) { chartsDirty = false; cvGain.redraw(); cvCut.redraw(); }
  });

  // ---- drawing ----
  function drawScene(c, w, hh) {
    if (!M) return;
    const T = 66, B = 6, sc = Math.min(w / WORLD.w, (hh - T - B) / WORLD.h), ox = Math.round((w - sc * WORLD.w) / 2), fw = sc * WORLD.w, fh = sc * WORLD.h;
    L = { sc, ox, T };
    const X = (x) => ox + x * sc, Y = (y) => T + y * sc, s = scene(), m = M, wt = m.w;
    c.save(); c.beginPath(); c.rect(ox, T, fw, fh); c.clip();
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(off, ox, T + 0.5 * PX * sc, fw, fh);
    // rubble
    const by0 = Math.round(Y(YB - 0.07)) + 0.5, by1 = Math.round(Y(YB + 0.07)) + 0.5;
    for (const [a, b] of [[ox, X(s.g0)], [X(s.g1), ox + fw]]) {
      c.fillStyle = tok('--bg-2'); c.fillRect(a, by0, b - a, by1 - by0);
      c.save(); c.beginPath(); c.rect(a, by0, b - a, by1 - by0); c.clip(); c.strokeStyle = tok('--line-3'); c.lineWidth = 1; c.beginPath();
      for (let q = a - (by1 - by0); q < b; q += 7) { c.moveTo(q, by1); c.lineTo(q + (by1 - by0), by0); } c.stroke(); c.restore();
      c.strokeStyle = tok('--text-3'); c.strokeRect(Math.round(a) + 0.5, by0, Math.round(b - a) - 1, by1 - by0);
    }
    // what the focus can see of the surface, and what the transmitter lights
    if (wt.on) {
      c.strokeStyle = rgba('--text', 0.3); c.lineWidth = 1; c.beginPath(); c.moveTo(X(S.tx.x), Y(S.tx.y)); c.lineTo(X(wt.ex[0]), T); c.moveTo(X(S.tx.x), Y(S.tx.y)); c.lineTo(X(wt.ex[wt.N - 1]), T); c.stroke();
      if (m.focusing && m.est.D > 0) {
        const xa = X(wt.ex[m.est.a]), xb = X(wt.ex[m.est.b]);
        c.fillStyle = rgba('--accent', 0.05); c.beginPath(); c.moveTo(xa, T); c.lineTo(xb, T); c.lineTo(X(S.fo.x), Y(S.fo.y)); c.closePath(); c.fill();
        c.strokeStyle = rgba('--accent', 0.5); c.beginPath(); c.moveTo(xa, T); c.lineTo(X(S.fo.x), Y(S.fo.y)); c.lineTo(xb, T); c.stroke();
      }
    }
    // progress of the full-resolution sum
    if (job && job.pass === 1) { const py = Math.round(Y((job.j + 1) * PX)) + 0.5; c.strokeStyle = rgba('--accent', 0.55); c.beginPath(); c.moveTo(ox, py); c.lineTo(ox + fw, py); c.stroke(); }
    c.restore();
    c.strokeStyle = tok('--line-2'); c.lineWidth = 1; c.strokeRect(ox + 0.5, T + 0.5, Math.round(fw) - 1, Math.round(fh) - 1);

    // phase profile, aligned with the elements
    const pitch = (LAMBDA / 2) * sc, bw = Math.max(1, Math.floor(pitch - 1.5)), s0 = 20, s1 = T - 13;
    lab.label(c, 'Phase each element adds', ox, 8, { color: tok('--text-2') });
    lab.label(c, wt.on ? m.nVis + ' of ' + m.N + ' elements have a straight line to the focus through the gap' : 'Every element absorbs', ox + fw, 8, { align: 'right', color: tok('--text-3') });
    c.strokeStyle = tok('--line'); c.beginPath(); for (const q of [s0, (s0 + s1) / 2, s1]) { c.moveTo(X(wt.ex[0]) - pitch / 2, Math.round(q) + 0.5); c.lineTo(X(wt.ex[wt.N - 1]) + pitch / 2, Math.round(q) + 0.5); } c.stroke();
    const lx = X(wt.ex[0]) - pitch / 2 - 5;
    if (lx - ox > 26) { lab.label(c, '360°', lx, s0 + 1, { align: 'right', font: NUM(), color: tok('--text-3') }); lab.label(c, '0°', lx, s1, { align: 'right', font: NUM(), color: tok('--text-3') }); }
    for (let n = 0; n < wt.N; n++) {
      const px = X(wt.ex[n]), see = wt.vis[n] && m.focusing;
      if (wt.on) { const bh = Math.max(1.5, (wt.phi[n] / TAU) * (s1 - s0)); c.fillStyle = see ? tok('--accent') : rgba('--text-3', 0.55); c.fillRect(Math.round(px - bw / 2), s1 - bh, bw, bh); }
      c.fillStyle = !wt.on ? tok('--line-3') : see ? tok('--accent') : tok('--text-3'); c.fillRect(Math.round(px - bw / 2), T - 8, bw, 5);
    }
    c.fillStyle = tok('--line-3'); c.fillRect(ox, T - 2, fw, 2);

    // labels on the scene
    lab.label(c, 'Rubble', ox + 8, (by0 + by1) / 2, { color: tok('--text-2'), bg: true });
    const gx0 = X(s.g0), gx1 = X(s.g1), gy = by0 - 7;
    c.strokeStyle = tok('--text-2'); c.beginPath(); c.moveTo(gx0, gy); c.lineTo(gx1, gy); c.moveTo(gx0 + 0.5, gy - 3); c.lineTo(gx0 + 0.5, gy + 3); c.moveTo(gx1 - 0.5, gy - 3); c.lineTo(gx1 - 0.5, gy + 3); c.stroke();
    lab.label(c, 'gap ' + S.gw.toFixed(2) + ' m', (gx0 + gx1) / 2, gy - 10, { align: 'center', font: NUM(), color: tok('--text'), bg: true });
    // rover
    const rx = X(ROVER.x), ry = Y(ROVER.y);
    c.strokeStyle = tok('--accent'); c.lineWidth = 1.5; c.strokeRect(Math.round(rx - 9) + 0.5, Math.round(ry - 6) + 0.5, 18, 12);
    c.fillStyle = tok('--accent'); for (const [a, b] of [[-11, -8], [8, -8], [-11, 5], [8, 5]]) c.fillRect(Math.round(rx + a), Math.round(ry + b), 4, 3);
    c.fillRect(Math.round(rx) - 1, Math.round(ry) - 1, 3, 3);
    lab.label(c, 'Rover hears ' + mn(m.rover.total) + ' dB', rx + 24, ry + 1, { color: tok('--text'), bg: true });
    // focus ring
    const fxp = X(S.fo.x), fyp = Y(S.fo.y);
    c.strokeStyle = tok('--text'); c.lineWidth = 1.25; c.beginPath(); c.arc(fxp, fyp, 13, 0, TAU); c.stroke();
    c.beginPath(); for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(fxp + a * 13, fyp + b * 13); c.lineTo(fxp + a * 19, fyp + b * 19); } c.stroke();
    if (Math.hypot(S.fo.x - ROVER.x, S.fo.y - ROVER.y) > 0.25) lab.label(c, 'Focus', fxp + 22, fyp - 14, { color: tok('--text'), bg: true });
    // transmitter
    const txp = X(S.tx.x), typ = Y(S.tx.y);
    c.fillStyle = tok('--accent'); c.fillRect(Math.round(txp) - 4, Math.round(typ) - 4, 9, 9);
    c.strokeStyle = tok('--text'); c.lineWidth = 1; c.strokeRect(Math.round(txp) - 7.5, Math.round(typ) - 7.5, 16, 16);
    lab.label(c, 'Transmitter', txp + 14, typ - 14, { color: tok('--text'), bg: true });
    for (const [el, p] of [[hTx, [txp, typ]], [hFo, [fxp, fyp]]]) { el.style.left = p[0] + 'px'; el.style.top = p[1] + 'px'; }

    // scale bars, colour key
    const sy = T + fh - 14, sx = ox + 12;
    c.strokeStyle = tok('--text'); c.lineWidth = 1; c.beginPath();
    c.moveTo(sx, sy + 0.5); c.lineTo(sx + sc, sy + 0.5); c.moveTo(sx + 0.5, sy - 3); c.lineTo(sx + 0.5, sy + 4); c.moveTo(sx + sc - 0.5, sy - 3); c.lineTo(sx + sc - 0.5, sy + 4);
    const wx = sx + sc + 54; c.moveTo(wx, sy + 0.5); c.lineTo(wx + LAMBDA * sc, sy + 0.5); c.moveTo(wx + 0.5, sy - 3); c.lineTo(wx + 0.5, sy + 4); c.moveTo(wx + LAMBDA * sc - 0.5, sy - 3); c.lineTo(wx + LAMBDA * sc - 0.5, sy + 4); c.stroke();
    lab.label(c, '1 m', sx + sc + 6, sy, { font: NUM(), color: tok('--text'), bg: true });
    lab.label(c, 'λ ' + (LAMBDA * 100).toFixed(1) + ' cm', wx + LAMBDA * sc + 6, sy, { font: NUM(), color: tok('--text'), bg: true });
    if (S.view === 'wave') lab.label(c, 'crests slowed ' + (F0 * PERIOD / 1e9).toFixed(1) + ' billion times', wx + LAMBDA * sc + 92, sy, { color: tok('--text-2'), bg: true });
    const kw = 110, kx = ox + fw - kw - 14, g = c.createLinearGradient(kx, 0, kx + kw, 0);
    for (let i = 0; i <= 5; i++) g.addColorStop(i / 5, tok('--heat-' + i));
    const keyText = (S.paths === 'all' ? 'All paths' : 'Surface only') + ', path gain';
    c.font = TXT(); const ktw = Math.max(kw, c.measureText(keyText).width);
    c.fillStyle = rgba('--bg-0', 0.82); c.fillRect(ox + fw - ktw - 22, sy - 31, ktw + 16, 42);
    c.fillStyle = g; c.fillRect(kx, sy - 8, kw, 6); c.strokeStyle = tok('--line-3'); c.strokeRect(kx + 0.5, sy - 8.5, kw - 1, 7);
    const [DB_LO, DB_HI] = DB_RANGE[S.paths];
    lab.label(c, String(DB_LO).replace('-', '−'), kx, sy + 5, { font: NUM(), color: tok('--text-2'), base: 'middle' });
    lab.label(c, String(DB_HI).replace('-', '−') + ' dB', kx + kw, sy + 5, { font: NUM(), color: tok('--text-2'), align: 'right' });
    lab.label(c, keyText, kx + kw, sy - 20, { color: tok('--text-2'), align: 'right' });

    if (hover) {
      const i = clamp(Math.floor(hover.x / PX), 0, GW - 1), j = clamp(Math.round(hover.y / PX) - 1, 0, GH - 1), px = Math.round(X(hover.x)) + 0.5, py = Math.round(Y(hover.y)) + 0.5;
      const inRubble = Math.abs(hover.y - YB) < 0.07 && (hover.x < s.g0 || hover.x > s.g1);
      c.strokeStyle = rgba('--text', 0.5); c.beginPath(); c.moveTo(px - 8, py); c.lineTo(px + 8, py); c.moveTo(px, py - 8); c.lineTo(px, py + 8); c.stroke();
      const txt = (inRubble ? 'rubble' : mn(F.dbAt(i, j, S.paths === 'all')) + ' dB') + '   x ' + hover.x.toFixed(2) + ' m  y ' + hover.y.toFixed(2) + ' m';
      const right = px > ox + fw - 190;
      lab.label(c, txt, px + (right ? -12 : 12), py + (py > T + fh - 30 ? -14 : 14), { font: NUM(), color: tok('--text'), bg: true, align: right ? 'right' : 'left' });
    }
  }

  function drawGain(c, w, hh) {
    if (!M) return;
    const mg = { l: 40, r: 16, t: 24, b: 36 }, lg = Math.log2, m = M;
    const P = lab.plot(c, { x: mg.l, y: mg.t, w: w - mg.l - mg.r, h: hh - mg.t - mg.b, xd: [lg(7), lg(146)], yd: [0, 60], xt: [8, 16, 32, 64, 128].map(lg), yt: [0, 20, 40], xf: (v) => String(Math.round(2 ** v)), xl: 'elements N, log scale', yl: 'gain over one element, dB' });
    const Yc = (v) => P.Y(clamp(v, 0, 60));
    lab.line(c, [[P.X(lg(7)), Yc(db20(7))], [P.X(lg(146)), Yc(db20(146))]], tok('--text-2'), 1);
    lab.line(c, [[P.X(lg(7)), Yc(db20(7) - m.pen1Theory)], [P.X(lg(146)), Yc(db20(146) - m.pen1Theory)]], tok('--text-3'), 1, [3, 3]);
    lab.label(c, 'N² law', P.X(lg(146)) - 4, Yc(db20(146)) - 4, { color: tok('--text-2'), align: 'right', base: 'bottom' });
    const cx = Math.round(P.X(lg(S.N))) + 0.5; c.strokeStyle = rgba('--accent', 0.45); c.lineWidth = 1; c.beginPath(); c.moveTo(cx, mg.t); c.lineTo(cx, hh - mg.b); c.stroke();
    lab.line(c, m.gainN.map((g) => [P.X(lg(g.n)), Yc(g.cont)]), rgba('--accent', 0.6), 1);
    const dot = (x, y, solid) => { c.beginPath(); c.arc(x, y, solid ? 3 : 2.6, 0, TAU); if (solid) { c.fillStyle = tok('--accent'); c.fill(); } else { c.fillStyle = tok('--bg-1'); c.fill(); c.strokeStyle = tok('--text-2'); c.lineWidth = 1.25; c.stroke(); } };
    for (const g of m.gainN) { const x = P.X(lg(g.n)); dot(x, Yc(g.bit1), false); dot(x, Yc(g.cont), true); }
    dot(mg.l + 12, mg.t + 10, true); lab.label(c, 'measured at the focus, continuous phase', mg.l + 21, mg.t + 10, { color: tok('--accent') });
    dot(mg.l + 12, mg.t + 24, false); lab.label(c, 'measured, 1 bit: ' + mn(-m.pen1) + ' dB here; theory −' + m.pen1Theory.toFixed(1) + ' dB, dashed', mg.l + 21, mg.t + 24, { color: tok('--text-2') });
  }

  function drawCut(c, w, hh) {
    if (!M) return;
    const mg = { l: 44, r: 16, t: 24, b: 36 }, m = M;
    const P = lab.plot(c, { x: mg.l, y: mg.t, w: w - mg.l - mg.r, h: hh - mg.t - mg.b, xd: [-1.2, 1.2], yd: [-125, -45], xt: [-1.2, -0.8, -0.4, 0, 0.4, 0.8, 1.2], yt: [-120, -100, -80, -60], xf: (v) => v.toFixed(1).replace('-', '−'), yf: (v) => String(v).replace('-', '−'), xl: 'metres along the floor from the focus', yl: 'path gain via the surface, dB', ylx: 34 });
    const Yc = (v) => P.Y(clamp(v, -125, -45));
    c.save(); c.beginPath(); c.rect(mg.l, mg.t, w - mg.l - mg.r, hh - mg.t - mg.b); c.clip();
    const yd = Yc(m.directFocusDb);
    lab.line(c, [[mg.l, yd], [w - mg.r, yd]], tok('--text-3'), 1, [2, 3]);
    lab.line(c, m.cut.x.map((x, i) => [P.X(x), Yc(m.cut.mir[i])]), tok('--text-3'), 1);
    if (m.w.on && S.mode !== 'mirror') lab.line(c, m.cut.x.map((x, i) => [P.X(x), Yc(m.cut.cur[i])]), tok('--accent'), 1.5);
    c.restore();
    lab.label(c, 'direct path at the focus', mg.l + 6, yd - 9, { color: tok('--text-3'), bg: true });
    lab.label(c, 'plain mirror', w - mg.r - 6, clamp(Yc(m.cut.mir[468]) - 10, mg.t + 9, hh - mg.b - 9), { color: tok('--text-2'), align: 'right', bg: true });
    if (m.focusing && Number.isFinite(m.spot.width)) {
      const y3 = Yc(m.spot.peakDb - 3), xa = P.X(m.spot.xl - S.fo.x), xb = P.X(m.spot.xr - S.fo.x);
      c.strokeStyle = tok('--text'); c.lineWidth = 1; c.beginPath(); c.moveTo(xa, y3 + 0.5); c.lineTo(xb, y3 + 0.5); c.moveTo(xa, y3 - 4); c.lineTo(xa, y3 + 5); c.moveTo(xb, y3 - 4); c.lineTo(xb, y3 + 5); c.stroke();
      lab.label(c, (m.spot.width * 100).toFixed(1) + ' cm', xb + 8, y3, { font: NUM(), color: tok('--text'), bg: true });
      lab.label(c, MODE_NAMES[S.mode].toLowerCase() + ', peak ' + mn(m.spot.peakDb) + ' dB', P.X(m.spot.peak - S.fo.x), Math.max(mg.t + 9, Yc(m.spot.peakDb) - 11), { color: tok('--accent'), align: 'center', bg: true });
    }
  }

  return {
    onShow() {
      const lut = lab.rampLut(); for (let i = 0; i < 256; i++) lut32[i] = (255 << 24) | (lut[i * 3 + 2] << 16) | (lut[i * 3 + 1] << 8) | lut[i * 3];
      if (!M) change(true, true); else { dirty = chartsDirty = true; }
      run.start();
    },
    onHide() { run.stop(); },
  };
}
