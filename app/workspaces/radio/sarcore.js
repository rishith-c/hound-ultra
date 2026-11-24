// Shared maths for exhibits 04 (synthetic aperture) and 05 (too few measurements). No DOM in this file.
// Local frame, metres: x runs east along the corridor wall of Classroom 111 (world x - 66), y is depth behind the
// wall (world y - 46). The rover drives in the corridor at y = -STANDOFF and looks north through the wall.
export const C0 = 299792458;                                    // m/s
export const ROOM = { name: 'Classroom 111', w: 9, d: 6.75, standoff: 1.4 };
// Wall: a plasterboard slab. Relative permittivity 2.73 is the ITU-R P.2040-4 value; the rest is assumed.
export const WALL = { eps: 2.73, thick: 0.025, lossDb: 3, flashDb: 26 };
WALL.delay = WALL.thick * (Math.sqrt(WALL.eps) - 1);            // extra one-way path through the slab, m
WALL.trans = Math.pow(10, -WALL.lossDb / 20);                   // two-way amplitude factor
export const REF_R = 4;                                         // reference: a unit reflector 4 m from the radar
export const REF_AMP = WALL.trans / (REF_R * REF_R);
WALL.amp = REF_AMP * Math.pow(10, WALL.flashDb / 20);           // flat wall return, same at every position
export const DEFAULT_TARGETS = [{ x: 2.6, y: 2.45, a: 1 }, { x: 5.45, y: 3.9, a: 1 }, { x: 6.7, y: 1.55, a: 0.45 }];

// ---- seeded noise (mulberry32 + Box-Muller) ----
export function rng(seed = 1) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.normal = () => { let u = 0; while (u < 1e-12) u = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * f()); };
  return f;
}
// Noise standard deviation (complex, total) for a given signal-to-noise ratio per sample of the reference reflector.
export const noiseSigma = (snrDb) => REF_AMP * Math.pow(10, -snrDb / 20);

// ---- FFT: in-place radix-2, e^{-j} forward, e^{+j} inverse, no scaling ----
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// ---- forward model: one frequency sweep at rover position xr ----
// s(f) = sum over reflectors of a * T / R^2 * exp(-j 4 pi f (R + delay) / c)  [+ wall flash]. R is the straight
// line; bending at the wall faces is ignored (assumed small for a thin slab).
export function sweep(xr, f0, df, nf, targets, wallOn, re, im) {
  re.fill(0, 0, nf); im.fill(0, 0, nf);
  const add = (amp, path) => {
    const k0 = (-4 * Math.PI * f0 * path) / C0, dk = (-4 * Math.PI * df * path) / C0;
    let cr = Math.cos(k0), ci = Math.sin(k0); const sr = Math.cos(dk), si = Math.sin(dk);
    for (let k = 0; k < nf; k++) { re[k] += amp * cr; im[k] += amp * ci; const t = cr * sr - ci * si; ci = cr * si + ci * sr; cr = t; }
  };
  for (const t of targets) { const R = Math.hypot(t.x - xr, t.y + ROOM.standoff); add((t.a * WALL.trans) / (R * R), R + WALL.delay); }
  if (wallOn) add(WALL.amp, ROOM.standoff);
}
export function addNoise(re, im, n, sigma, rand) { const s = sigma / Math.SQRT2; for (let k = 0; k < n; k++) { re[k] += s * rand.normal(); im[k] += s * rand.normal(); } }

// ---- range profile: zero-padded inverse FFT of a sweep, referred to the centre frequency ----
// profiler(nf, M, hann) -> fn(re, im, outRe, outIm). out[m] = sum_k w_k s_k exp(+j 2 pi (k - kc) m / M) / sum(w),
// so a point at range R shows as a peak at bin m = R * M / Ru, Ru = c / (2 df), with the carrier phase removed.
export function profiler(nf, M, hann) {
  const w = new Float64Array(nf); let sw = 0;
  for (let k = 0; k < nf; k++) { w[k] = hann ? 0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 0.5)) / nf) : 1; sw += w[k]; }
  const kc = (nf - 1) / 2, rc = new Float64Array(M), rs = new Float64Array(M);
  for (let m = 0; m < M; m++) { const a = (-2 * Math.PI * kc * m) / M; rc[m] = Math.cos(a); rs[m] = Math.sin(a); }
  const br = new Float64Array(M), bi = new Float64Array(M);
  return (re, im, outRe, outIm) => {
    br.fill(0); bi.fill(0);
    for (let k = 0; k < nf; k++) { br[k] = (re[k] * w[k]) / sw; bi[k] = (im[k] * w[k]) / sw; }
    fft(br, bi, true);
    for (let m = 0; m < M; m++) { outRe[m] = br[m] * rc[m] - bi[m] * rs[m]; outIm[m] = br[m] * rs[m] + bi[m] * rc[m]; }
  };
}

// ---- back-projection of one position's profile onto a list of points ----
const LUTN = 8192, LC = new Float32Array(LUTN + 1), LS = new Float32Array(LUTN + 1);
for (let i = 0; i <= LUTN; i++) { LC[i] = Math.cos((2 * Math.PI * i) / LUTN); LS[i] = Math.sin((2 * Math.PI * i) / LUTN); }
// acc[p] += sign * profile(R_p) * exp(+j 4 pi fc R_p / c), R_p = distance from (xr, -standoff) to point p plus the
// wall delay. px, py are point coordinates; from..to selects a slice of points (for time slicing).
export function bpAdd(accRe, accIm, px, py, from, to, xr, pr, pi, M, Ru, fc, sign = 1) {
  const kb = M / Ru, kp = (2 * fc) / C0, h = ROOM.standoff, dl = WALL.delay, top = M - 2;
  for (let p = from; p < to; p++) {
    const ddx = px[p] - xr, ddy = py[p] + h, R = Math.sqrt(ddx * ddx + ddy * ddy) + dl;
    const m = R * kb; if (m >= top) continue;
    const m0 = m | 0, f = m - m0, vr = pr[m0] + (pr[m0 + 1] - pr[m0]) * f, vi = pi[m0] + (pi[m0 + 1] - pi[m0]) * f;
    let ph = R * kp; ph -= Math.floor(ph); const li = (ph * LUTN + 0.5) | 0, c = LC[li], s = LS[li];
    accRe[p] += sign * (vr * c - vi * s); accIm[p] += sign * (vr * s + vi * c);
  }
}

// The same sum as a matched filter: each sample is weighted by the echo strength T / R^2 it would have from that
// point (the conjugate of the forward operator), and wsum collects cnt * (T / R^2)^2 so the caller can normalise by
// the column norm. The profile is periodic here (a coarse frequency lattice has a short unambiguous range).
export function bpAddMF(accRe, accIm, wsum, px, py, n, xr, pr, pi, M, Ru, fc, cnt) {
  const kb = M / Ru, kp = (2 * fc) / C0, h = ROOM.standoff, dl = WALL.delay, T = WALL.trans, mask = M - 1;
  for (let p = 0; p < n; p++) {
    const ddx = px[p] - xr, ddy = py[p] + h, R2 = ddx * ddx + ddy * ddy, R = Math.sqrt(R2) + dl, w = T / R2;
    const m = R * kb, mf = Math.floor(m), f = m - mf, m0 = mf & mask, m1 = (m0 + 1) & mask;
    const vr = pr[m0] + (pr[m1] - pr[m0]) * f, vi = pi[m0] + (pi[m1] - pi[m0]) * f;
    let ph = R * kp; ph -= Math.floor(ph); const li = (ph * LUTN + 0.5) | 0, c = LC[li], s = LS[li];
    accRe[p] += w * (vr * c - vi * s); accIm[p] += w * (vr * s + vi * c); wsum[p] += cnt * w * w;
  }
}

// -3 dB width of the main lobe in a sampled magnitude cut (linear interpolation of the two crossings).
// Returns { width, peak (index, fractional), value } with width NaN if a crossing lies outside the cut.
export function width3dB(mag, step, near = -1) {
  const n = mag.length; let ip = 0;
  if (near >= 0) { ip = near; while (ip > 0 && mag[ip - 1] > mag[ip]) ip--; while (ip < n - 1 && mag[ip + 1] > mag[ip]) ip++; }
  else for (let i = 1; i < n; i++) if (mag[i] > mag[ip]) ip = i;
  let pk = mag[ip], off = 0;
  if (ip > 0 && ip < n - 1) { const a = mag[ip - 1], b = mag[ip], c = mag[ip + 1], den = a - 2 * b + c; if (den < 0) { off = (0.5 * (a - c)) / den; pk = b - 0.25 * (a - c) * off; } }
  const lvl = pk / Math.SQRT2; let l = NaN, r = NaN;
  for (let i = ip; i > 0; i--) if (mag[i - 1] < lvl) { l = i - 1 + (lvl - mag[i - 1]) / (mag[i] - mag[i - 1]); break; }
  for (let i = ip; i < n - 1; i++) if (mag[i + 1] < lvl) { r = i + (mag[i] - lvl) / (mag[i] - mag[i + 1]); break; }
  return { width: (r - l) * step, peak: ip + off, value: pk };
}

// ================= exhibit 05: the forward operator as a matrix, and L1 solvers =================
// A[m][i] = T / R^2 * exp(-j 4 pi f_m (R + delay) / c): what measurement m (rover at mx[m], frequency mf[m]) records
// for a unit reflector at grid point i. Row-major Float32, M x N. buildRows fills rows from..to (time-sliced by the caller).
export function allocA(M, N) { return { M, N, re: new Float32Array(M * N), im: new Float32Array(M * N) }; }
export function buildRows(A, mx, mf, gx, gy, from, to) {
  const N = A.N, h = ROOM.standoff;
  for (let m = from; m < to; m++) {
    const k = (-4 * Math.PI * mf[m]) / C0, xr = mx[m], o = m * N;
    for (let i = 0; i < N; i++) {
      const ddx = gx[i] - xr, ddy = gy[i] + h, R2 = ddx * ddx + ddy * ddy, ph = k * (Math.sqrt(R2) + WALL.delay), a = WALL.trans / R2;
      A.re[o + i] = a * Math.cos(ph); A.im[o + i] = a * Math.sin(ph);
    }
  }
}
// The measurements themselves come from the reflectors' true positions (on or off the grid), not from A.
export function measure(mx, mf, rows, targets, yr, yi) {
  for (let q = 0; q < rows.length; q++) {
    const m = rows[q], k = (-4 * Math.PI * mf[m]) / C0; let sr = 0, si = 0;
    for (const t of targets) { const R = Math.hypot(t.x - mx[m], t.y + ROOM.standoff), a = (t.a * WALL.trans) / (R * R), ph = k * (R + WALL.delay); sr += a * Math.cos(ph); si += a * Math.sin(ph); }
    yr[q] = sr; yi[q] = si;
  }
}
// y = A[rows] x. Uses only the non-zero entries of x when x is sparse.
export function mulA(A, rows, xr, xi, yr, yi) {
  const N = A.N, R = rows.length, ar = A.re, ai = A.im; let nnz = 0;
  for (let i = 0; i < N; i++) if (xr[i] !== 0 || xi[i] !== 0) nnz++;
  if (nnz * 3 < N) {
    yr.fill(0, 0, R); yi.fill(0, 0, R);
    for (let i = 0; i < N; i++) {
      const a = xr[i], b = xi[i]; if (a === 0 && b === 0) continue;
      for (let q = 0; q < R; q++) { const o = rows[q] * N + i, c = ar[o], d = ai[o]; yr[q] += c * a - d * b; yi[q] += c * b + d * a; }
    }
    return;
  }
  for (let q = 0; q < R; q++) {
    const o = rows[q] * N; let sr = 0, si = 0;
    for (let i = 0; i < N; i++) { const c = ar[o + i], d = ai[o + i]; sr += c * xr[i] - d * xi[i]; si += c * xi[i] + d * xr[i]; }
    yr[q] = sr; yi[q] = si;
  }
}
// x = A[rows]^H r
export function mulAH(A, rows, rr, ri, xr, xi) {
  const N = A.N, R = rows.length, ar = A.re, ai = A.im; xr.fill(0); xi.fill(0);
  for (let q = 0; q < R; q++) {
    const o = rows[q] * N, a = rr[q], b = ri[q];
    for (let i = 0; i < N; i++) { const c = ar[o + i], d = ai[o + i]; xr[i] += c * a + d * b; xi[i] += c * b - d * a; }
  }
}
export function colNorms(A, rows, out) {
  const N = A.N; out.fill(0);
  for (let q = 0; q < rows.length; q++) { const o = rows[q] * N; for (let i = 0; i < N; i++) out[i] += A.re[o + i] * A.re[o + i] + A.im[o + i] * A.im[o + i]; }
  for (let i = 0; i < N; i++) out[i] = Math.sqrt(out[i]) || 1;
  return out;
}

// A problem: the kept rows, the data, and the column-normalised operator B = A[rows] D^-1 (D = column norms), so the
// L1 penalty treats near and far pixels alike. Unknown z = D x; reflectivity x = z / norm.
export function problem(A, rows, yr, yi) {
  const N = A.N, R = rows.length, nrm = colNorms(A, rows, new Float64Array(N));
  const tr = new Float64Array(N), ti = new Float64Array(N), ur = new Float64Array(R), ui = new Float64Array(R);
  const P = { A, rows, N, R, yr, yi, nrm, L: NaN, powerIts: 0 };
  P.B = (zr, zi, or, oi) => { for (let i = 0; i < N; i++) { tr[i] = zr[i] / nrm[i]; ti[i] = zi[i] / nrm[i]; } mulA(A, rows, tr, ti, or, oi); };
  P.BH = (rr, ri, or, oi) => { mulAH(A, rows, rr, ri, or, oi); for (let i = 0; i < N; i++) { or[i] /= nrm[i]; oi[i] /= nrm[i]; } };
  // matched filter (back-projection) in reflectivity units: x_i = a_i^H y / |a_i|^2
  P.backproject = (or, oi) => { P.BH(yr, yi, or, oi); for (let i = 0; i < N; i++) { or[i] /= nrm[i]; oi[i] /= nrm[i]; } };
  // power iteration on B^H B: call repeatedly; each call is one iteration and returns the current estimate of L.
  const vr = new Float64Array(N), vi = new Float64Array(N), wr = new Float64Array(N), wi = new Float64Array(N);
  const rand = rng(7); for (let i = 0; i < N; i++) { vr[i] = rand.normal(); vi[i] = rand.normal(); }
  P.power = () => {
    let n = 0; for (let i = 0; i < N; i++) n += vr[i] * vr[i] + vi[i] * vi[i]; n = Math.sqrt(n) || 1;
    for (let i = 0; i < N; i++) { vr[i] /= n; vi[i] /= n; }
    P.B(vr, vi, ur, ui); P.BH(ur, ui, wr, wi);
    let l = 0; for (let i = 0; i < N; i++) { l += wr[i] * wr[i] + wi[i] * wi[i]; vr[i] = wr[i]; vi[i] = wi[i]; }
    P.powerIts++; return (P.L = Math.sqrt(l));
  };
  // lambda_max: above this the L1 answer is all zeros
  P.lambdaMax = () => { P.BH(yr, yi, wr, wi); let m = 0; for (let i = 0; i < N; i++) m = Math.max(m, Math.hypot(wr[i], wi[i])); return m; };
  return P;
}

// ISTA (Daubechies, Defrise, De Mol 2004) and FISTA (Beck, Teboulle 2009) for min 0.5 |y - B z|^2 + lambda |z|_1.
// solver(P, lambda, fista).step() does one iteration and returns the objective at the new iterate.
export function solver(P, lambda, fista) {
  const { N, R, yr, yi } = P, L = P.L * 1.02;                 // 2 % margin on the power-iteration estimate
  const zr = new Float64Array(N), zi = new Float64Array(N), vr = new Float64Array(N), vi = new Float64Array(N);
  const gr = new Float64Array(N), gi = new Float64Array(N), rr = new Float64Array(R), ri = new Float64Array(R);
  const S = { zr, zi, it: 0, t: 1, obj: NaN, fista, lambda, L };
  S.x = (or, oi) => { for (let i = 0; i < N; i++) { or[i] = zr[i] / P.nrm[i]; if (oi) oi[i] = zi[i] / P.nrm[i]; } };
  S.step = () => {
    P.B(vr, vi, rr, ri); for (let q = 0; q < R; q++) { rr[q] -= yr[q]; ri[q] -= yi[q]; }
    P.BH(rr, ri, gr, gi);
    const th = lambda / L, tn = fista ? (1 + Math.sqrt(1 + 4 * S.t * S.t)) / 2 : 1, mom = fista ? (S.t - 1) / tn : 0; let l1 = 0;
    for (let i = 0; i < N; i++) {
      const ar = vr[i] - gr[i] / L, ai = vi[i] - gi[i] / L, mag = Math.hypot(ar, ai), sh = mag > th ? 1 - th / mag : 0;
      const nr = ar * sh, ni = ai * sh; l1 += mag > th ? mag - th : 0;
      vr[i] = nr + mom * (nr - zr[i]); vi[i] = ni + mom * (ni - zi[i]); zr[i] = nr; zi[i] = ni;
    }
    S.t = tn; S.it++;
    P.B(zr, zi, rr, ri); let f = 0; for (let q = 0; q < R; q++) { const a = rr[q] - yr[q], b = ri[q] - yi[q]; f += a * a + b * b; }
    return (S.obj = 0.5 * f + lambda * l1);
  };
  return S;
}

// Scores against the simulated truth. mag: image magnitudes (W x H, row-major); truth: [{ i, j, a }] pixel indices.
// Relative L2 error of the magnitude image; peaks = local maxima above thr x the brightest pixel; a truth reflector is
// "recovered" if a peak lies within one pixel of it; a peak further than one pixel from every reflector is false.
export function score(mag, W, H, truth, thr = 0.316) {
  let num = 0, den = 0, mx = 0; const tv = new Float64Array(W * H);
  for (const t of truth) tv[t.j * W + t.i] += t.a;
  for (let i = 0; i < W * H; i++) { const d = mag[i] - tv[i]; num += d * d; den += tv[i] * tv[i]; if (mag[i] > mx) mx = mag[i]; }
  const peaks = [];
  if (mx > 0) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const v = mag[j * W + i]; if (v < thr * mx) continue; let top = true;
    for (let b = -1; b <= 1 && top; b++) for (let a = -1; a <= 1; a++) { if (!a && !b) continue; const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue; const u = mag[jj * W + ii]; if (u > v || (u === v && (b < 0 || (b === 0 && a < 0)))) { top = false; break; } }
    if (top) peaks.push({ i, j, v });
  }
  const near = (p, t) => Math.abs(p.i - t.i) <= 1 && Math.abs(p.j - t.j) <= 1;
  let hit = 0; for (const t of truth) if (peaks.some((p) => near(p, t))) hit++;
  let fals = 0; for (const p of peaks) { p.ok = truth.some((t) => near(p, t)); if (!p.ok) fals++; }
  return { rel: Math.sqrt(num / (den || 1)), hit, fals, peaks, max: mx };
}
