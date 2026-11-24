// Image analysis for the Drone imagery workspace. Runs in a module Web Worker so the page never stalls.
//
//   RX anomaly detector (Reed and Yu, 1990): model the scene's colours as one Gaussian (mean and 3x3 covariance),
//   then score every pixel by its Mahalanobis distance from it. Global variant: one model for the whole frame.
//   Local variant: a model per pixel from a ring of neighbours (outer window minus a guard window), computed in
//   constant time per pixel with nine summed-area tables.
//
//   Change detection: register the two frames (translation, coarse to fine, on gradient images), match their
//   exposure (per-channel linear fit), then score each pixel by max(colour difference, loss of local structure).
//
// Everything here is plain typed-array arithmetic. No library.

import { BENCH, CBENCH, pairSetup } from './shared.js';

const frames = new Map();   // key -> { rgba: Uint8ClampedArray, w, h }
const rxStore = new Map();  // key -> { d: Float32Array, w, h, mode }
let chg = null;             // last change-detection result
let scenesMod = null;
const scenes = async () => (scenesMod ??= await import('./scenes.js'));

const HEAT = [[43, 63, 107], [122, 63, 143], [216, 80, 77], [255, 178, 74], [255, 243, 196]]; // tokens --heat-1..5
function heat(t, out, o, alpha) {
  t = t < 0 ? 0 : t > 1 ? 1 : t; const f = t * 4, i = f >= 4 ? 3 : f | 0, u = f - i, a = HEAT[i], b = HEAT[i + 1];
  out[o] = a[0] + (b[0] - a[0]) * u; out[o + 1] = a[1] + (b[1] - a[1]) * u; out[o + 2] = a[2] + (b[2] - a[2]) * u; out[o + 3] = alpha;
}

// ---------- 3x3 symmetric helpers ----------
// cov = [xx, xy, xz, yy, yz, zz]; returns the inverse in the same layout, with a small ridge so flat areas stay finite.
function inv3(c, ridge) {
  const a = c[0] + ridge, b = c[1], d = c[2], e = c[3] + ridge, f = c[4], g = c[5] + ridge;
  const A = e * g - f * f, B = d * f - b * g, C = b * f - d * e;
  const det = a * A + b * B + d * C;
  if (!(Math.abs(det) > 1e-12)) return null;
  const k = 1 / det;
  return [A * k, B * k, C * k, (a * g - d * d) * k, (b * d - a * f) * k, (a * e - b * b) * k];
}

function validMask(w, h, rects) {
  if (!rects) return null;
  const m = new Uint8Array(w * h);
  for (const r of rects) { const x0 = Math.max(0, r[0] | 0), y0 = Math.max(0, r[1] | 0), x1 = Math.min(w, Math.ceil(r[2])), y1 = Math.min(h, Math.ceil(r[3])); for (let y = y0; y < y1; y++) m.fill(1, y * w + x0, y * w + x1); }
  return m;
}

// ---------- RX, global ----------
function gaussStats(px, n, mask, skip) {
  let s0 = 0, s1 = 0, s2 = 0, c00 = 0, c01 = 0, c02 = 0, c11 = 0, c12 = 0, c22 = 0, N = 0;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    if ((mask && !mask[i]) || (skip && skip[i])) continue;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    s0 += r; s1 += g; s2 += b; c00 += r * r; c01 += r * g; c02 += r * b; c11 += g * g; c12 += g * b; c22 += b * b; N++;
  }
  if (N < 16) return null;
  const m = [s0 / N, s1 / N, s2 / N];
  const cov = [c00 / N - m[0] * m[0], c01 / N - m[0] * m[1], c02 / N - m[0] * m[2], c11 / N - m[1] * m[1], c12 / N - m[1] * m[2], c22 / N - m[2] * m[2]];
  return { mean: m, cov, n: N };
}
function rxGlobal(px, w, h, mask) {
  const n = w * h, d = new Float32Array(n);
  let st = gaussStats(px, n, mask, null);
  if (!st) return { d, stats: null };
  const score = (st) => {
    const iv = inv3(st.cov, 1e-3 * (st.cov[0] + st.cov[3] + st.cov[5]) / 3 + 1e-6); const m = st.mean;
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      if (mask && !mask[i]) { d[i] = 0; continue; }
      const x = px[o] - m[0], y = px[o + 1] - m[1], z = px[o + 2] - m[2];
      d[i] = Math.sqrt(Math.max(0, x * (iv[0] * x + iv[1] * y + iv[2] * z) + y * (iv[1] * x + iv[3] * y + iv[4] * z) + z * (iv[2] * x + iv[4] * y + iv[5] * z)));
    }
  };
  score(st);
  // Second pass: the unusual pixels themselves stretch the covariance and hide each other. Leave out everything
  // beyond 4 sigma, estimate again, and score with the cleaner background model.
  const skip = new Uint8Array(n); let k = 0;
  for (let i = 0; i < n; i++) if (d[i] > 4) { skip[i] = 1; k++; }
  if (k && k < n * 0.25) { const st2 = gaussStats(px, n, mask, skip); if (st2) { st2.excluded = k; st = st2; score(st); } }
  return { d, stats: st };
}

// ---------- RX, local (dual window) ----------
function rxLocal(px, w, h, mask, outer, guard) {
  const n = w * h, W = w + 1, d = new Float32Array(n);
  // Summed-area tables: count, 3 first moments (centred on the global mean to keep the numbers small), 6 second moments.
  const g0 = gaussStats(px, n, mask, null); if (!g0) return { d, stats: null };
  const mu = g0.mean;
  const T = []; for (let k = 0; k < 10; k++) T.push(new Float64Array(W * (h + 1)));
  const [Tn, Tr, Tg, Tb, Trr, Trg, Trb, Tgg, Tgb, Tbb] = T;
  for (let y = 0; y < h; y++) {
    let an = 0, ar = 0, ag = 0, ab = 0, arr = 0, arg = 0, arb = 0, agg = 0, agb = 0, abb = 0;
    const row = (y + 1) * W, up = y * W;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      if (!mask || mask[i]) { const r = px[o] - mu[0], g = px[o + 1] - mu[1], b = px[o + 2] - mu[2]; an++; ar += r; ag += g; ab += b; arr += r * r; arg += r * g; arb += r * b; agg += g * g; agb += g * b; abb += b * b; }
      const j = row + x + 1, u = up + x + 1;
      Tn[j] = Tn[u] + an; Tr[j] = Tr[u] + ar; Tg[j] = Tg[u] + ag; Tb[j] = Tb[u] + ab; Trr[j] = Trr[u] + arr; Trg[j] = Trg[u] + arg; Trb[j] = Trb[u] + arb; Tgg[j] = Tgg[u] + agg; Tgb[j] = Tgb[u] + agb; Tbb[j] = Tbb[u] + abb;
    }
  }
  const ridge0 = 1e-3 * (g0.cov[0] + g0.cov[3] + g0.cov[5]) / 3 + 0.5;
  for (let y = 0; y < h; y++) {
    const oy0 = Math.max(0, y - outer), oy1 = Math.min(h, y + outer + 1), gy0 = Math.max(0, y - guard), gy1 = Math.min(h, y + guard + 1);
    for (let x = 0; x < w; x++) {
      const i = y * w + x; if (mask && !mask[i]) continue;
      const ox0 = Math.max(0, x - outer), ox1 = Math.min(w, x + outer + 1), gx0 = Math.max(0, x - guard), gx1 = Math.min(w, x + guard + 1);
      const a = oy0 * W + ox0, b = oy0 * W + ox1, c = oy1 * W + ox0, e = oy1 * W + ox1, p = gy0 * W + gx0, q = gy0 * W + gx1, r = gy1 * W + gx0, s = gy1 * W + gx1;
      const N = (Tn[e] - Tn[b] - Tn[c] + Tn[a]) - (Tn[s] - Tn[q] - Tn[r] + Tn[p]);
      if (N < 40) continue;
      const k = 1 / N;
      const m0 = ((Tr[e] - Tr[b] - Tr[c] + Tr[a]) - (Tr[s] - Tr[q] - Tr[r] + Tr[p])) * k;
      const m1 = ((Tg[e] - Tg[b] - Tg[c] + Tg[a]) - (Tg[s] - Tg[q] - Tg[r] + Tg[p])) * k;
      const m2 = ((Tb[e] - Tb[b] - Tb[c] + Tb[a]) - (Tb[s] - Tb[q] - Tb[r] + Tb[p])) * k;
      const cov = [
        ((Trr[e] - Trr[b] - Trr[c] + Trr[a]) - (Trr[s] - Trr[q] - Trr[r] + Trr[p])) * k - m0 * m0,
        ((Trg[e] - Trg[b] - Trg[c] + Trg[a]) - (Trg[s] - Trg[q] - Trg[r] + Trg[p])) * k - m0 * m1,
        ((Trb[e] - Trb[b] - Trb[c] + Trb[a]) - (Trb[s] - Trb[q] - Trb[r] + Trb[p])) * k - m0 * m2,
        ((Tgg[e] - Tgg[b] - Tgg[c] + Tgg[a]) - (Tgg[s] - Tgg[q] - Tgg[r] + Tgg[p])) * k - m1 * m1,
        ((Tgb[e] - Tgb[b] - Tgb[c] + Tgb[a]) - (Tgb[s] - Tgb[q] - Tgb[r] + Tgb[p])) * k - m1 * m2,
        ((Tbb[e] - Tbb[b] - Tbb[c] + Tbb[a]) - (Tbb[s] - Tbb[q] - Tbb[r] + Tbb[p])) * k - m2 * m2];
      const iv = inv3(cov, ridge0); if (!iv) continue;
      const o = i * 4, X = px[o] - mu[0] - m0, Y = px[o + 1] - mu[1] - m1, Z = px[o + 2] - mu[2] - m2;
      d[i] = Math.sqrt(Math.max(0, X * (iv[0] * X + iv[1] * Y + iv[2] * Z) + Y * (iv[1] * X + iv[3] * Y + iv[4] * Z) + Z * (iv[2] * X + iv[4] * Y + iv[5] * Z)));
    }
  }
  return { d, stats: g0 };
}

function histogram(d, mask, max = 20, bins = 80) {
  const hist = new Uint32Array(bins); let top = 0;
  for (let i = 0; i < d.length; i++) { if (mask && !mask[i]) continue; const v = d[i]; if (v > top) top = v; const b = Math.min(bins - 1, (v / max * bins) | 0); hist[b]++; }
  return { hist, max, top };
}

// ---------- regions: threshold, join near neighbours, label, measure ----------
// score: Float32Array; a pixel is "on" when score > thr. Regions touching within 'join' pixels are merged by
// dilating the mask before labelling (the measurements still use only the original on-pixels).
function regions(score, w, h, thr, { minArea = 4, join = 1, px = null, maxRegions = 400 } = {}) {
  const n = w * h, on = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (score[i] > thr) on[i] = 1;
  let grown = on;
  for (let it = 0; it < join; it++) {
    const g = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (grown[i] || (x > 0 && grown[i - 1]) || (x < w - 1 && grown[i + 1]) || (y > 0 && grown[i - w]) || (y < h - 1 && grown[i + w])) g[i] = 1;
    }
    grown = g;
  }
  const label = new Int32Array(n), stack = new Int32Array(n), out = [];
  let L = 0;
  for (let s = 0; s < n; s++) {
    if (!grown[s] || label[s]) continue;
    L++; let sp = 0; stack[sp++] = s; label[s] = L;
    let area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, sx = 0, sy = 0, sw = 0, peak = 0, sum = 0, r = 0, g = 0, b = 0, pi = s;
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i / w) | 0;
      if (on[i]) {
        const v = score[i]; area++; sum += v; sx += x * v; sy += y * v; sw += v; if (v > peak) { peak = v; pi = i; }
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (px) { const o = i * 4; r += px[o]; g += px[o + 1]; b += px[o + 2]; }
      }
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const j = yy * w + xx; if (grown[j] && !label[j]) { label[j] = L; stack[sp++] = j; } } }
    }
    if (area < minArea) continue;
    out.push({ area, bbox: [x0, y0, x1 + 1, y1 + 1], cx: sx / sw, cy: sy / sw, peak, mean: sum / area, peakAt: [pi % w, (pi / w) | 0], rgb: px ? [Math.round(r / area), Math.round(g / area), Math.round(b / area)] : null });
  }
  return { list: out, on };
}

// ---------- change detection ----------
function luma(px, n) { const y = new Float32Array(n); for (let i = 0, o = 0; i < n; i++, o += 4) y[i] = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]; return y; }
function down2(a, w, h) { const W = w >> 1, H = h >> 1, o = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = 2 * y * w + 2 * x; o[y * W + x] = (a[i] + a[i + 1] + a[i + w] + a[i + w + 1]) * 0.25; } return { a: o, w: W, h: H }; }
function gradMag(a, w, h) { const g = new Float32Array(w * h); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x, gx = a[i + 1] - a[i - 1], gy = a[i + w] - a[i - w]; g[i] = Math.abs(gx) + Math.abs(gy); } return g; }
// Normalised cross-correlation of B shifted by (dx, dy) against A, over the part where both exist.
function ncc(A, B, w, h, dx, dy, margin) {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
  const x0 = Math.max(margin, margin - dx), x1 = Math.min(w - margin, w - margin - dx), y0 = Math.max(margin, margin - dy), y1 = Math.min(h - margin, h - margin - dy);
  for (let y = y0; y < y1; y++) { const ra = y * w, rb = (y + dy) * w + dx; for (let x = x0; x < x1; x++) { const a = A[ra + x], b = B[rb + x]; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; n++; } }
  if (n < 64) return -1;
  const va = saa - sa * sa / n, vb = sbb - sb * sb / n; if (va <= 0 || vb <= 0) return -1;
  return (sab - sa * sb / n) / Math.sqrt(va * vb);
}
function register(ya, yb, w, h, maxShift = 48) {
  const pyrA = [{ a: ya, w, h }], pyrB = [{ a: yb, w, h }];
  while (pyrA[pyrA.length - 1].w > 180 && pyrA.length < 5) { const p = pyrA[pyrA.length - 1], q = pyrB[pyrB.length - 1]; pyrA.push(down2(p.a, p.w, p.h)); pyrB.push(down2(q.a, q.w, q.h)); }
  let dx = 0, dy = 0, best = -1; const surface = [];
  for (let L = pyrA.length - 1; L >= 0; L--) {
    const A = pyrA[L], B = pyrB[L], ga = gradMag(A.a, A.w, A.h), gb = gradMag(B.a, B.w, B.h);
    const top = L === pyrA.length - 1, R = top ? Math.ceil(maxShift / (1 << L)) : 1;
    if (!top) { dx *= 2; dy *= 2; }
    let bx = dx, by = dy; best = -2;
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const s = ncc(ga, gb, A.w, A.h, dx + i, dy + j, 2);
      if (top) surface.push(s);
      if (s > best) { best = s; bx = dx + i; by = dy + j; }
    }
    dx = bx; dy = by;
    if (top) surface.R = R;
  }
  return { dx, dy, score: best, surface, surfaceR: surface.R, levels: pyrA.length };
}
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) { let acc = 0; const row = y * w; for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { tmp[row + x] = acc * k; acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { out[y * w + x] = acc * k; acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  return out;
}
function channel(px, n, c) { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = px[i * 4 + c]; return o; }

function changeDetect(A, B, w, h, { align = true } = {}) {
  const n = w * h, t0 = performance.now();
  const ya = luma(A, n), yb0 = luma(B, n);
  // 0. What plain subtraction would give (no alignment, no exposure match): kept for the comparison view.
  const naive = new Float32Array(n);
  for (let i = 0; i < n; i++) naive[i] = Math.abs(ya[i] - yb0[i]) / 40;
  // 1. Register: find the shift (dx, dy) that makes B(x + dx, y + dy) line up with A(x, y).
  const reg = align ? register(ya, yb0, w, h) : { dx: 0, dy: 0, score: ncc(gradMag(ya, w, h), gradMag(yb0, w, h), w, h, 0, 0, 2), surface: [], levels: 0 };
  const { dx, dy } = reg, tReg = performance.now();
  const Bs = new Uint8ClampedArray(n * 4), valid = new Uint8Array(n);
  for (let y = 0; y < h; y++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let x = 0; x < w; x++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const i = y * w + x, j = (yy * w + xx) * 4, o = i * 4; Bs[o] = B[j]; Bs[o + 1] = B[j + 1]; Bs[o + 2] = B[j + 2]; Bs[o + 3] = 255; valid[i] = 1; } }
  // 2. Exposure match: per channel, fit A = gain * B + offset by least squares; repeat once without the worst 20 %.
  const gains = [];
  for (let c = 0; c < 3; c++) {
    let gain = 1, off = 0, keep = null;
    for (let pass = 0; pass < 2; pass++) {
      let sa = 0, sb = 0, sbb = 0, sab = 0, N = 0;
      for (let i = 0; i < n; i += 3) { if (!valid[i] || (keep && !keep[i])) continue; const a = A[i * 4 + c], b = Bs[i * 4 + c]; sa += a; sb += b; sbb += b * b; sab += a * b; N++; }
      const vb = sbb - sb * sb / N; if (N < 100 || vb <= 0) break;
      gain = (sab - sa * sb / N) / vb; off = (sa - gain * sb) / N;
      if (pass === 0) { keep = new Uint8Array(n); const res = []; for (let i = 0; i < n; i += 37) if (valid[i]) res.push(Math.abs(A[i * 4 + c] - gain * Bs[i * 4 + c] - off)); res.sort((p, q) => p - q); const cut = res[Math.floor(res.length * 0.8)] || 255; for (let i = 0; i < n; i += 3) if (valid[i] && Math.abs(A[i * 4 + c] - gain * Bs[i * 4 + c] - off) <= cut) keep[i] = 1; }
    }
    gains.push([gain, off]);
    for (let i = 0; i < n; i++) if (valid[i]) Bs[i * 4 + c] = gain * Bs[i * 4 + c] + off;
  }
  // 3a. Colour difference of the smoothed frames (sensor noise averages out, real colour change stays).
  const colour = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    const a = boxBlur(boxBlur(channel(A, n, c), w, h, 2), w, h, 2), b = boxBlur(boxBlur(channel(Bs, n, c), w, h, 2), w, h, 2);
    for (let i = 0; i < n; i++) { const d = a[i] - b[i]; colour[i] += d * d; }
  }
  // 3b. Structure: the contrast-structure term of SSIM (Wang et al., 2004) on luminance in 9x9 windows.
  const yb = luma(Bs, n), r = 4;
  const ma = boxBlur(ya, w, h, r), mb = boxBlur(yb, w, h, r);
  const pa = new Float32Array(n), pb = new Float32Array(n), pab = new Float32Array(n);
  for (let i = 0; i < n; i++) { pa[i] = ya[i] * ya[i]; pb[i] = yb[i] * yb[i]; pab[i] = ya[i] * yb[i]; }
  const saa = boxBlur(pa, w, h, r), sbb = boxBlur(pb, w, h, r), sab = boxBlur(pab, w, h, r);
  const C2 = 160, raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    const va = saa[i] - ma[i] * ma[i], vb = sbb[i] - mb[i] * mb[i], vab = sab[i] - ma[i] * mb[i];
    const cs = (2 * vab + C2) / (va + vb + C2);
    const sC = Math.sqrt(colour[i]) / 42, sS = (1 - cs) * 1.15;
    raw[i] = sC > sS ? sC : sS;
  }
  const score = boxBlur(raw, w, h, 2);
  for (let i = 0; i < n; i++) if (!valid[i]) score[i] = 0;
  return { score, naive, valid, Bs, reg, gains, ms: performance.now() - t0, msReg: tReg - t0 };
}

function overlayFrom(score, on, w, h, thr, top, faint = true) {
  const o = new Uint8ClampedArray(w * h * 4), span = Math.max(1e-6, top - thr);
  for (let i = 0; i < w * h; i++) {
    const v = score[i];
    if (v > thr) heat(0.35 + 0.65 * (v - thr) / span, o, i * 4, 215);
    else if (faint && v > thr * 0.62) heat(0.12, o, i * 4, 70 * (v - thr * 0.62) / (thr * 0.38));
  }
  return o;
}

// ---------- scoring against ground truth ----------
const inside = (x, y, b, pad = 0) => x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad;
const overlap = (a, b, pad = 0) => a[0] < b[2] + pad && a[2] > b[0] - pad && a[1] < b[3] + pad && a[3] > b[1] - pad;
// A figure counts as found when one of the top-K candidates overlaps its box. Everything else in the top K is a
// false candidate, except known bright objects (tarps, barrels), which are counted on their own.
function matchRx(list, sc, topK) {
  const cand = [...list].sort((a, b) => b.peak - a.peak).slice(0, topK);
  const hit = sc.figures.map((f) => cand.findIndex((c) => overlap(c.bbox, f.bbox, 2)));
  let objects = 0, falseC = 0;
  cand.forEach((c, i) => { if (hit.includes(i) || sc.figures.some((f) => overlap(c.bbox, f.bbox, 2))) return; if (sc.distractors.some((x) => overlap(c.bbox, x.bbox, 2))) objects++; else falseC++; });
  return { hit, objects, falseC, n: cand.length };
}

async function crop(canvas, bbox, pad, size) {
  const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2, half = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]) / 2 + pad;
  const c = new OffscreenCanvas(size, size), g = c.getContext('2d'); g.fillStyle = '#07090c'; g.fillRect(0, 0, size, size);
  g.imageSmoothingEnabled = half * 2 > size; g.drawImage(canvas, cx - half, cy - half, half * 2, half * 2, 0, 0, size, size);
  return c.transferToImageBitmap();
}

async function benchRx(post) {
  const S = await scenes(), B = BENCH, diffs = ['bright', 'shadow', 'covered', 'muted'];
  const mk = () => B.thrs.map(() => ({ hit: { bright: 0, shadow: 0, covered: 0, muted: 0 }, objects: 0, falseC: 0 }));
  const res = { global: mk(), local: mk() }, total = { bright: 0, shadow: 0, covered: 0, muted: 0 }, perFigure = [], ms = { render: 0, global: 0, local: 0 };
  const canvas = new OffscreenCanvas(B.w, B.h);
  for (let k = 0; k < B.seeds.length; k++) {
    const sc = S.buildScene({ seed: B.seeds[k], w: B.w, h: B.h, pxPerM: B.pxPerM, theme: B.themes[k % B.themes.length], figures: B.figures });
    let t = performance.now(); S.renderScene(sc, { canvas, noiseSeed: B.seeds[k] });
    const px = canvas.getContext('2d').getImageData(0, 0, B.w, B.h).data; ms.render += performance.now() - t;
    for (const f of sc.figures) total[f.difficulty]++;
    const figs = sc.figures.map((f) => ({ frame: k, seed: B.seeds[k], id: f.id, difficulty: f.difficulty, top: f.top, visible: f.visible, bbox: f.bbox, at: { global: 0, local: 0 } }));
    for (const mode of ['global', 'local']) {
      t = performance.now();
      const { d } = mode === 'global' ? rxGlobal(px, B.w, B.h, null) : rxLocal(px, B.w, B.h, null, B.outer, B.guard);
      ms[mode] += performance.now() - t;
      B.thrs.forEach((thr, ti) => {
        const { list } = regions(d, B.w, B.h, thr, { minArea: B.minArea, join: 1 });
        const m = matchRx(list, sc, B.topK);
        m.hit.forEach((h, fi) => { if (h >= 0) { res[mode][ti].hit[sc.figures[fi].difficulty]++; figs[fi].at[mode] = Math.max(figs[fi].at[mode], thr); } });
        res[mode][ti].objects += m.objects; res[mode][ti].falseC += m.falseC;
      });
      // the strongest score inside each figure's box: how far it stands out, whatever the threshold
      figs.forEach((f) => { let p = 0; const b = f.bbox; for (let y = Math.max(0, b[1] | 0); y < Math.min(B.h, b[3]); y++) for (let x = Math.max(0, b[0] | 0); x < Math.min(B.w, b[2]); x++) { const v = d[y * B.w + x]; if (v > p) p = v; } f[mode + 'Peak'] = p; });
    }
    for (const f of figs) f.thumb = await crop(canvas, f.bbox, 10, 72);
    perFigure.push(...figs);
    post({ type: 'progress', done: k + 1, of: B.seeds.length });
  }
  return { kind: 'rx', frames: B.seeds.length, total, thrs: B.thrs, topK: B.topK, res, perFigure, ms: { render: ms.render / B.seeds.length, global: ms.global / B.seeds.length, local: ms.local / B.seeds.length }, size: [B.w, B.h], pxPerM: B.pxPerM, diffs };
}

async function benchChange(post) {
  const S = await scenes(), B = BENCH, C = CBENCH;
  const rows = C.thrs.map(() => ({ hit: 0, falseR: 0 })), naiveRows = C.thrs.map(() => ({ hit: 0, falseR: 0 }));
  let total = 0, shiftErr = 0, shiftMax = 0, ms = 0; const misses = [], pairs = [];
  const ca = new OffscreenCanvas(B.w, B.h), cb = new OffscreenCanvas(B.w, B.h), minArea = Math.round(C.minAreaM2 * B.pxPerM * B.pxPerM);
  for (let k = 0; k < C.seeds.length; k++) {
    const seed = C.seeds[k], sc = S.buildScene({ seed, w: B.w, h: B.h, pxPerM: B.pxPerM, theme: ['roofs', 'mixed'][k % 2], figures: 4 });
    const mut = S.mutateScene(sc, seed + 1), set = pairSetup(seed);
    S.renderScene(sc, { canvas: ca, noiseSeed: seed }); S.renderScene(mut.scene, { canvas: cb, noiseSeed: seed + 9, light: set.light, shift: set.shift });
    const A = ca.getContext('2d').getImageData(0, 0, B.w, B.h).data, Bp = cb.getContext('2d').getImageData(0, 0, B.w, B.h).data;
    const r = changeDetect(A, Bp, B.w, B.h); ms += r.ms;
    const err = Math.hypot(r.reg.dx - set.shift[0], r.reg.dy - set.shift[1]); shiftErr += err; shiftMax = Math.max(shiftMax, err);
    total += mut.changes.length;
    const score1 = (map, rowsOut, track) => C.thrs.forEach((thr, ti) => {
      const { list } = regions(map, B.w, B.h, thr, { minArea, join: 2 });
      const used = new Set();
      mut.changes.forEach((c, ci) => { const j = list.findIndex((g) => overlap(g.bbox, c.bbox, 0)); if (j >= 0) { rowsOut[ti].hit++; list.forEach((g, gi) => { if (overlap(g.bbox, c.bbox, 0)) used.add(gi); }); if (track) track[ci] = Math.max(track[ci], thr); } });
      rowsOut[ti].falseR += list.length - used.size;
    });
    const track = mut.changes.map(() => 0);
    score1(r.score, rows, track); score1(r.naive, naiveRows, null);
    pairs.push({ seed, shift: set.shift, found: [r.reg.dx, r.reg.dy], gain: set.light.gain, changes: mut.changes.map((c, i) => ({ kind: c.kind, label: c.label, areaM2: c.areaM2, lastThr: track[i] })) });
    post({ type: 'progress', done: k + 1, of: C.seeds.length });
  }
  return { kind: 'change', pairs, total, thrs: C.thrs, rows, naiveRows, shiftErr: shiftErr / C.seeds.length, shiftMax, ms: ms / C.seeds.length, frames: C.seeds.length, minAreaM2: C.minAreaM2 };
}

// ---------- messages ----------
const sceneCache = new Map();
async function getScene(spec) {
  const S = await scenes(), key = JSON.stringify(spec);
  if (sceneCache.has(key)) return sceneCache.get(key);
  let sc, changes = null;
  if (spec.site) sc = S.buildSiteScene(spec.world, { leads: spec.leads || [], team: spec.team || [], pxPerM: spec.pxPerM || 12, before: !!spec.before });
  else { sc = S.buildScene({ seed: spec.seed, w: spec.w, h: spec.h, pxPerM: spec.pxPerM, theme: spec.theme, figures: spec.figures }); if (spec.mutate != null) { const m = S.mutateScene(sc, spec.mutate); sc = m.scene; changes = m.changes; } }
  const v = { sc, changes }; sceneCache.set(key, v); if (sceneCache.size > 40) sceneCache.delete(sceneCache.keys().next().value);
  return v;
}

const ops = {
  async scene(m) {   // build + render a synthetic frame, keep its pixels under m.key, return a bitmap and the ground truth
    const S = await scenes(), { sc, changes } = await getScene(m.spec), t0 = performance.now();
    const canvas = new OffscreenCanvas(sc.w, sc.h);
    S.renderScene(sc, { canvas, light: m.light, shift: m.shift, noiseSeed: m.noiseSeed ?? 1 });
    const ms = performance.now() - t0, id = canvas.getContext('2d').getImageData(0, 0, sc.w, sc.h);
    frames.set(m.key, { rgba: id.data, w: sc.w, h: sc.h });
    const bitmap = canvas.transferToImageBitmap();
    return [{ bitmap, w: sc.w, h: sc.h, ms, truth: { figures: sc.figures, distractors: sc.distractors, changes, name: sc.name, theme: sc.theme, pxPerM: sc.pxPerM, sun: sc.sun } }, [bitmap]];
  },
  put(m) { frames.set(m.key, { rgba: new Uint8ClampedArray(m.rgba), w: m.w, h: m.h }); return [{ ok: true }]; },
  drop(m) { frames.delete(m.key); rxStore.delete(m.key + '|global'); rxStore.delete(m.key + '|local'); return [{ ok: true }]; },
  rx(m) {
    const f = frames.get(m.key); if (!f) throw new Error('That frame is not loaded in the worker.');
    const t0 = performance.now(), mask = validMask(f.w, f.h, m.rects);
    const r = m.mode === 'local' ? rxLocal(f.rgba, f.w, f.h, mask, m.outer, m.guard) : rxGlobal(f.rgba, f.w, f.h, mask);
    if (!r.stats) throw new Error('There are too few pixels to model the background.');
    rxStore.set(m.key + '|' + m.mode, { d: r.d, w: f.w, h: f.h, mask }); while (rxStore.size > 6) rxStore.delete(rxStore.keys().next().value);
    const hg = histogram(r.d, mask);
    return [{ ms: performance.now() - t0, stats: r.stats, hist: hg.hist, histMax: hg.max, top: hg.top, pixels: mask ? mask.reduce((a, b) => a + b, 0) : f.w * f.h }];
  },
  rxRegions(m) {
    const s = rxStore.get(m.key + '|' + m.mode), f = frames.get(m.key); if (!s || !f) throw new Error('Run the detector on this frame first.');
    const t0 = performance.now(), { list } = regions(s.d, s.w, s.h, m.thr, { minArea: m.minArea, join: 1, px: f.rgba });
    list.sort((a, b) => b.peak - a.peak);
    const top = Math.max(m.thr * 1.8, list.length ? list[0].peak : m.thr * 1.8);
    const overlay = overlayFrom(s.d, null, s.w, s.h, m.thr, Math.min(top, m.thr * 3));
    return [{ regions: list.slice(0, 200), count: list.length, overlay: overlay.buffer, w: s.w, h: s.h, ms: performance.now() - t0 }, [overlay.buffer]];
  },
  change(m) {
    const a = frames.get(m.before), b = frames.get(m.after); if (!a || !b) throw new Error('Both frames are needed.');
    if (a.w !== b.w || a.h !== b.h) throw new Error('The two frames must be the same size.');
    const r = changeDetect(a.rgba, b.rgba, a.w, a.h, { align: m.align !== false });
    chg = { ...r, w: a.w, h: a.h, mask: validMask(a.w, a.h, m.rects) };
    if (chg.mask) for (let i = 0; i < chg.score.length; i++) if (!chg.mask[i]) { chg.score[i] = 0; chg.naive[i] = 0; }
    const aligned = new Uint8ClampedArray(r.Bs); // the "after" frame, registered and exposure-matched, for the swipe view
    for (let i = 0; i < r.valid.length; i++) if (!r.valid[i]) aligned[i * 4 + 3] = 0;
    return [{ ms: r.ms, msReg: r.msReg, shift: [r.reg.dx, r.reg.dy], score: r.reg.score, surface: r.reg.surface, surfaceR: r.reg.surfaceR, levels: r.reg.levels, gains: r.gains, aligned: aligned.buffer, w: a.w, h: a.h }, [aligned.buffer]];
  },
  changeRegions(m) {
    if (!chg) throw new Error('Compare two frames first.');
    const t0 = performance.now(), map = m.method === 'naive' ? chg.naive : chg.score;
    const { list } = regions(map, chg.w, chg.h, m.thr, { minArea: m.minArea, join: 2 });
    list.sort((a, b) => b.area - a.area);
    const overlay = overlayFrom(map, null, chg.w, chg.h, m.thr, m.thr * 2.4, false);
    let changed = 0; for (const r of list) changed += r.area;
    return [{ regions: list.slice(0, 120), count: list.length, changed, overlay: overlay.buffer, w: chg.w, h: chg.h, ms: performance.now() - t0 }, [overlay.buffer]];
  },
  async bench(m, post) { return [m.what === 'change' ? await benchChange(post) : await benchRx(post)]; },
  async benchFrame(m) {   // one benchmark frame for the detector benchmark (the detector runs in its own worker)
    const S = await scenes(), B = BENCH, k = m.index;
    const sc = S.buildScene({ seed: B.seeds[k], w: B.w, h: B.h, pxPerM: B.pxPerM, theme: B.themes[k % B.themes.length], figures: B.figures });
    const canvas = new OffscreenCanvas(B.w, B.h); S.renderScene(sc, { canvas, noiseSeed: B.seeds[k] });
    const bitmap = canvas.transferToImageBitmap();
    return [{ bitmap, figures: sc.figures, w: B.w, h: B.h }, [bitmap]];
  },
  config() { return [{ BENCH, CBENCH }]; },
};

self.onmessage = async (e) => {
  const m = e.data;
  try {
    const fn = ops[m.op]; if (!fn) throw new Error('Unknown operation ' + m.op);
    const [result, transfer] = await fn(m, (p) => self.postMessage({ id: m.id, ...p }));
    self.postMessage({ id: m.id, type: 'done', result }, transfer || []);
  } catch (err) { self.postMessage({ id: m.id, type: 'error', message: String(err?.message || err) }); }
};
