// Many teams, one plan: the solvers. Pure functions, no DOM, no imports.
//
// THE PROBLEM (the multiple travelling-repairman problem, a small vehicle-routing problem)
//   K teams leave staging. N located people must each be reached by exactly one team; a team reaches its people
//   in an order. Minimise the SUM OF ARRIVAL TIMES over all people (the same as the average wait).
//
//   prob = { N, K, t: Float64Array(N*N), t0: Float64Array(K*N) }
//     t[i*N + j]   walking time, seconds, from person i to person j along the planned path
//     t0[k*N + i]  walking time, seconds, from team k's start to person i
//   A plan is routes[k] = [person, person, ...] in the order team k reaches them.
//
// THE IDENTITY EVERYTHING BELOW USES
//   A leg of a route delays everyone who has not been reached yet, including the person at its end. So
//     sum of arrival times = sum over legs of (leg time) x (people on that route not yet reached, counting the leg's destination).
//   Number a route's stops from the back: q = 1 is the team's LAST stop, q = 2 the one before. The leg INTO the stop
//   at reverse position q is paid q times. A route's cost then depends only on (who is at which reverse position),
//   which is what makes both the dynamic programme and the quadratic binary form possible.

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const factorial = (n) => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
export function binom(n, k) { let b = 1; for (let i = 1; i <= k; i++) b = (b * (n - k + i)) / i; return Math.round(b); }
// How many different plans exist: every ordering of the N people, cut into K consecutive routes (a route may be empty).
export const planCount = (N, K) => factorial(N) * binom(N + K - 1, K - 1);

// The direct definition, used as the reference everywhere: walk each route and add up the clock at every arrival.
export function planCost(prob, routes) {
  const { N, t, t0 } = prob, arrivals = new Float64Array(N);
  let total = 0;
  for (let k = 0; k < routes.length; k++) {
    let clock = 0, prev = -1;
    for (const i of routes[k]) { clock += prev < 0 ? t0[k * N + i] : t[prev * N + i]; arrivals[i] = clock; total += clock; prev = i; }
  }
  return { total, arrivals };
}

// ---------------------------------------------------------------------------------------------------------------
// 1. EXACT: dynamic programming over subsets, then a partition of the people between teams.
//
//   f(S, i) = least cost of the legs BETWEEN the people of S when the route's last |S| stops are exactly S and it
//             enters S at person i. The leg i -> j is paid (|S| - 1) times (the people still waiting after i).
//       f({i}, i) = 0
//       f(S, i)   = min over j in S \ {i} of  f(S \ {i}, j) + (|S| - 1) * t(i, j)
//   g_k(S)  = least cost for team k to serve exactly S = min over i in S of  f(S, i) + |S| * t0(k, i)
//             (the leg from staging is paid by everyone on the route).  g_k(empty) = 0.
//   h_k(S)  = least cost for teams 0..k to serve exactly S = min over T subset of S of  g_k(T) + h_{k-1}(S \ T)
//   optimum = h_{K-1}(everyone).   Work: N^2 2^N for f, K 3^N for the partition. Exact, no approximation.
//
//   cap limits how many people one team may take (the binary form below has P slots per team, so the same limit is
//   applied here when asked). sign = -1 turns every min into a max: the WORST plan, used to scale the landscape.
export function solveExact(prob, { cap = prob.N, sign = 1 } = {}) {
  const t0ms = now();
  const { N, K, t, t0 } = prob, full = 1 << N;
  const f = new Float64Array(full * N).fill(Infinity), nxt = new Int8Array(full * N).fill(-1), size = new Uint8Array(full);
  let states = 0;
  for (let S = 1; S < full; S++) {
    size[S] = size[S >> 1] + (S & 1);
    const m = size[S];
    for (let i = 0; i < N; i++) {
      if (!((S >> i) & 1)) continue;
      const R = S ^ (1 << i);
      if (!R) { f[S * N + i] = 0; states++; continue; }
      let best = Infinity, bj = -1;
      for (let j = 0; j < N; j++) {
        if (!((R >> j) & 1)) continue;
        const c = f[R * N + j] + sign * (m - 1) * t[i * N + j]; states++;
        if (c < best) { best = c; bj = j; }
      }
      f[S * N + i] = best; nxt[S * N + i] = bj;
    }
  }
  const g = [], first = [];
  for (let k = 0; k < K; k++) {
    const gk = new Float64Array(full).fill(Infinity), fk = new Int8Array(full).fill(-1);
    gk[0] = 0;
    for (let S = 1; S < full; S++) {
      if (size[S] > cap) continue;
      for (let i = 0; i < N; i++) {
        if (!((S >> i) & 1)) continue;
        const c = f[S * N + i] + sign * size[S] * t0[k * N + i]; states++;
        if (c < gk[S]) { gk[S] = c; fk[S] = i; }
      }
    }
    g.push(gk); first.push(fk);
  }
  let h = g[0];
  const choice = [null];
  for (let k = 1; k < K; k++) {
    const hk = new Float64Array(full).fill(Infinity), ck = new Int32Array(full);
    for (let S = 0; S < full; S++) {
      for (let T = S; ; T = (T - 1) & S) {
        const c = g[k][T] + h[S ^ T]; states++;
        if (c < hk[S]) { hk[S] = c; ck[S] = T; }
        if (T === 0) break;
      }
    }
    choice.push(ck); h = hk;
  }
  const routes = new Array(K);
  let S = full - 1;
  for (let k = K - 1; k >= 0; k--) {
    let T = k ? choice[k][S] : S;
    S ^= T;
    const r = [];
    let i = T ? first[k][T] : -1;
    while (i >= 0) { r.push(i); const j = nxt[T * N + i]; T ^= 1 << i; i = j; }
    routes[k] = r;
  }
  return { cost: sign * h[full - 1], routes, states, ms: now() - t0ms };
}

// ---------------------------------------------------------------------------------------------------------------
// The honest energy landscape: the cost of EVERY plan. N! orderings (Heap's algorithm) times every way to cut an
// ordering into K routes. Time-sliced: call step(ms) until it returns true. Costs go straight into a histogram
// between lo and hi (the exact best and worst, both from the dynamic programme), so nothing large is stored.
// A second, fine histogram (tail) covers the plans within 50 % of the best, in steps of 0.1 %, for the close-up.
export function createEnumerator(prob, lo, hi, bins = 360, tailBins = 500, tailSpan = 0.5) {
  const { N, K, t, t0 } = prob, W = N + 1;
  const p = Array.from({ length: N }, (_, i) => i), c = new Int32Array(N), inner = new Float64Array(W * W), hist = new Float64Array(bins), tail = new Float64Array(tailBins);
  const total = planCount(N, K), span = hi - lo || 1;
  let i = 0, started = false, done = false, count = 0, min = Infinity, nMin = 0, sum = 0;
  const add = (cost) => {
    count++; sum += cost;
    hist[Math.min(bins - 1, Math.max(0, Math.floor(((cost - lo) / span) * bins)))]++;
    const tb = Math.floor(((cost / lo - 1) / tailSpan) * tailBins);
    if (tb < tailBins) tail[Math.max(0, tb)]++;
    if (cost < min - 1e-7) { min = cost; nMin = 1; } else if (cost <= min + 1e-7) nMin++;
  };
  const seg = (a, b, k) => (a === b ? 0 : inner[a * W + b] + (b - a) * t0[k * N + p[a]]);
  const cut = (k, a, acc) => { if (k === K - 1) { add(acc + seg(a, N, k)); return; } for (let s = a; s <= N; s++) cut(k + 1, s, acc + seg(a, s, k)); };
  function visit() {
    // inner[a][b]: cost of the legs between p[a..b-1] served as one route (reverse-position weights).
    for (let b = 1; b <= N; b++) { inner[(b - 1) * W + b] = 0; for (let a = b - 2; a >= 0; a--) inner[a * W + b] = inner[(a + 1) * W + b] + (b - a - 1) * t[p[a] * N + p[a + 1]]; }
    cut(0, 0, 0);
  }
  return {
    total, hist, tail, lo, hi, bins, tailBins, tailSpan,
    get count() { return count; }, get done() { return done; }, get min() { return min; }, get nMin() { return nMin; }, get mean() { return count ? sum / count : NaN; },
    step(budgetMs = 8) {
      if (done) return true;
      const end = now() + budgetMs;
      if (!started) { started = true; visit(); }
      let guard = 0;
      while (i < N) {
        if (c[i] < i) { const a = i & 1 ? c[i] : 0, tmp = p[a]; p[a] = p[i]; p[i] = tmp; visit(); c[i]++; i = 0; if ((++guard & 127) === 0 && now() > end) return false; }
        else { c[i] = 0; i++; }
      }
      done = true; return true;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. QUBO: the same problem as an energy over binary variables, the only form a quantum annealer accepts.
//
//   x[k][i][q] = 1 when team k reaches person i at reverse position q (q = 1 is the team's last stop), q = 1..P.
//   P = N - K + 1: a team never needs more stops than that unless another team stands idle, and an idle team never
//   helps when distances obey the triangle inequality. Planned paths only nearly obey it, so the page TESTS this
//   (the exact solver is run with and without the limit) instead of assuming it.
//
//   E(x) = objective(x) + A * penalty(x)
//
//   objective (quadratic, in seconds):
//       sum_k sum_{q=1}^{P-1} sum_{i != j}  q * t(i, j) * x[k][i][q+1] * x[k][j][q]         leg i -> j, paid q times
//     + sum_k sum_{q=1}^{P}   sum_i         q * t0(k, i) * x[k][i][q] * (1 - sum_j x[k][j][q+1])
//                                                                    the leg from staging: i is the first stop exactly
//                                                                    when the slot before it (q+1) is empty
//   penalty (a whole number, zero exactly on real plans):
//       sum_i ( sum_{k,q} x[k][i][q] - 1 )^2                          each person exactly once
//     + sum_{k,q} n_kq (n_kq - 1)        where n_kq = sum_i x[k][i][q]  at most one person per slot (2 per pair)
//     + sum_k sum_{q=1}^{P-1} n_{k,q+1} (1 - n_kq)                      no gaps: an earlier slot needs the later one
//
//   Why the slot rule is weighted 2 per pair: the no-gap term goes NEGATIVE when a slot holds two people, and with
//   weight 1 it cancels the slot rule exactly (slot q holding two people under a filled slot q+1 would cost nothing).
//   With n(n-1), for one team write a_q = n_kq and d_q = a_q - a_{q+1}. Then
//       2 * [ sum_q a_q(a_q-1) + sum_q a_{q+1}(1-a_q) ]  =  a_1(a_1-1) + a_P(a_P-1) + sum_q d_q(d_q-1),
//   and every term on the right is >= 0 for whole numbers, zero only when a_1 <= 1 and every d_q is 0 or 1: slots
//   hold at most one person and fill from q = 1 upward with no gap. So penalty >= 0, and = 0 exactly on real plans.
//
//   A (seconds) must outweigh anything the objective can gain by breaking a rule. penaltyBound() is the most the
//   objective can fall when one visit is deleted from, or added to, a real plan; A is set just above it. That makes
//   every real plan stable against any single bit flip. It is not a proof about every state of 2^n, and the page
//   says so. A this large is also what makes the landscape rough for single-bit annealers: moving one person means
//   climbing over a wall of height about A.
export function penaltyBound(prob, P = prob.N - prob.K + 1) {
  const { N, K, t, t0 } = prob;
  let bound = 0;
  for (let k = 0; k < K; k++) for (let i = 0; i < N; i++) {
    let into = t0[k * N + i], out = 0;
    for (let j = 0; j < N; j++) { if (j === i) continue; into = Math.max(into, t[j * N + i]); out = Math.max(out, t[i * N + j] - t0[k * N + j], t0[k * N + j]); }
    bound = Math.max(bound, P * into + (P - 1) * out);
  }
  return bound;
}

export function buildQubo(prob, { P = prob.N - prob.K + 1, A = 1.05 * penaltyBound(prob, P) } = {}) {
  const { N, K, t, t0 } = prob, n = K * P * N;
  const idx = (k, i, q) => (k * P + (q - 1)) * N + i;            // blocks: team, then slot, then person
  const objLin = new Float64Array(n), objW = new Float64Array(n * n), penLin = new Float64Array(n), penW = new Float64Array(n * n);
  const pair = (M, L, u, v, w) => { if (u === v) L[u] += w; else M[Math.min(u, v) * n + Math.max(u, v)] += w; };   // x*x = x
  for (let k = 0; k < K; k++) for (let q = 1; q <= P; q++) for (let i = 0; i < N; i++) {
    const v = idx(k, i, q);
    objLin[v] += q * t0[k * N + i];
    if (q < P) for (let j = 0; j < N; j++) {
      pair(objW, objLin, v, idx(k, j, q + 1), -q * t0[k * N + i]);
      if (j !== i) pair(objW, objLin, idx(k, i, q + 1), idx(k, j, q), q * t[i * N + j]);
    }
  }
  for (let i = 0; i < N; i++) {                                   // each person exactly once: (sum - 1)^2
    const vs = [];
    for (let k = 0; k < K; k++) for (let q = 1; q <= P; q++) vs.push(idx(k, i, q));
    for (let a = 0; a < vs.length; a++) { penLin[vs[a]] -= 1; for (let b = a + 1; b < vs.length; b++) pair(penW, penLin, vs[a], vs[b], 2); }
  }
  for (let k = 0; k < K; k++) for (let q = 1; q <= P; q++) {
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) pair(penW, penLin, idx(k, i, q), idx(k, j, q), 2);     // n(n-1)
    if (q < P) for (let j = 0; j < N; j++) { penLin[idx(k, j, q + 1)] += 1; for (let i = 0; i < N; i++) pair(penW, penLin, idx(k, j, q + 1), idx(k, i, q), -1); }
  }
  const lin = new Float64Array(n), Q = new Float64Array(n * n), Ws = new Float64Array(n * n);
  let couplings = 0;
  for (let u = 0; u < n; u++) {
    lin[u] = objLin[u] + A * penLin[u]; Q[u * n + u] = lin[u];
    for (let v = u + 1; v < n; v++) { const w = objW[u * n + v] + A * penW[u * n + v]; if (w !== 0) { couplings++; Q[u * n + v] = w; Ws[u * n + v] = w; Ws[v * n + u] = w; } }
  }
  // Q is the upper-triangular matrix (diagonal = linear terms): E(x) = offset + sum_{u <= v} Q[u][v] x_u x_v.
  return { N, K, P, n, A, idx, lin, Q, Ws, offset: A * N, couplings, objLin, objW, penLin, penW };
}

export function energy(qubo, x) {
  const { n, Q } = qubo;
  let e = qubo.offset;
  for (let u = 0; u < n; u++) { if (!x[u]) continue; e += Q[u * n + u]; for (let v = u + 1; v < n; v++) if (x[v]) e += Q[u * n + v]; }
  return e;
}

export function encode(qubo, routes) {
  const x = new Uint8Array(qubo.n);
  routes.forEach((r, k) => r.forEach((i, s) => { x[qubo.idx(k, i, r.length - s)] = 1; }));
  return x;
}

// Bits back to routes. feasible is checked on the structure itself, not through the energy.
export function decode(qubo, x) {
  const { N, K, P, idx } = qubo, seen = new Uint8Array(N), routes = [];
  let feasible = true;
  for (let k = 0; k < K; k++) {
    const r = [];
    let started = false;
    for (let q = P; q >= 1; q--) {
      let cnt = 0;
      for (let i = 0; i < N; i++) if (x[idx(k, i, q)]) { cnt++; seen[i]++; r.push(i); }
      if (cnt > 1 || (started && cnt === 0)) feasible = false;
      if (cnt) started = true;
    }
    routes.push(r);
  }
  for (let i = 0; i < N; i++) if (seen[i] !== 1) feasible = false;
  return { routes, feasible };
}

// Greedy repair of an infeasible read-out: keep each person's first appearance, then insert anyone missing where
// it adds the least to the sum of arrival times.
export function repair(prob, routes) {
  const { N } = prob, seen = new Uint8Array(N);
  const out = routes.map((r) => r.filter((i) => (seen[i] ? false : (seen[i] = 1))));
  for (let i = 0; i < N; i++) {
    if (seen[i]) continue;
    let best = Infinity, bk = 0, bs = 0;
    for (let k = 0; k < out.length; k++) for (let s = 0; s <= out[k].length; s++) {
      out[k].splice(s, 0, i);
      const c = planCost(prob, out).total;
      out[k].splice(s, 1);
      if (c < best) { best = c; bk = k; bs = s; }
    }
    out[bk].splice(bs, 0, i);
  }
  return out;
}

export function randomPlan(prob, rng, cap = prob.N) {
  const { N, K } = prob, perm = Array.from({ length: N }, (_, i) => i);
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)), tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp; }
  for (;;) {
    const routes = Array.from({ length: K }, () => []);
    for (const i of perm) routes[Math.floor(rng() * K)].push(i);
    if (routes.every((r) => r.length <= cap)) return routes;
  }
}

// The checks the page shows. Each returns { id, pass, detail }.
export function selfTest(prob, qubo, exact, unconstrained, seed = 1) {
  const rng = mulberry32(seed), out = [];
  const xs = encode(qubo, exact.routes), eStar = energy(qubo, xs);
  out.push({ id: 'optimum', pass: Math.abs(eStar - exact.cost) < 1e-6, diff: Math.abs(eStar - exact.cost) });
  let worst = 0;
  for (let r = 0; r < 200; r++) { const routes = randomPlan(prob, rng, qubo.P); worst = Math.max(worst, Math.abs(energy(qubo, encode(qubo, routes)) - planCost(prob, routes).total)); }
  out.push({ id: 'random', pass: worst < 1e-6, diff: worst, n: 200 });
  out.push({ id: 'cap', pass: Math.abs(unconstrained.cost - exact.cost) < 1e-6, diff: exact.cost - unconstrained.cost, P: qubo.P });
  // Is x* a strict local minimum under every 1-bit and 2-bit change?
  const { n, lin, Ws } = qubo, d = new Float64Array(n);
  for (let u = 0; u < n; u++) { let fu = lin[u]; for (let v = 0; v < n; v++) if (xs[v]) fu += Ws[u * n + v]; d[u] = (1 - 2 * xs[u]) * fu; }
  let least = Infinity, checked = 0;
  for (let u = 0; u < n; u++) {
    checked++; if (d[u] < least) least = d[u];
    for (let v = u + 1; v < n; v++) { checked++; const dd = d[u] + d[v] + Ws[u * n + v] * (1 - 2 * xs[u]) * (1 - 2 * xs[v]); if (dd < least) least = dd; }
  }
  out.push({ id: 'local', pass: least > -1e-9, least, checked });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 3. SIMULATED ANNEALING on the QUBO. Metropolis with single-bit flips and a geometric temperature schedule.
//
//   Flipping bit u changes the energy by  dE = (1 - 2 x_u) * F_u,  with the local field  F_u = Q_uu + sum_v W_uv x_v.
//   The fields are kept up to date (F_v += W_uv * (+1 or -1) after an accepted flip), so a proposal costs O(1) and an
//   accepted flip O(n). Accept when dE <= 0, otherwise with probability exp(-dE / T). T falls from T0 to T1 by a
//   constant factor each sweep; one sweep is n proposals at random bits. Call step(count) until it returns true.
export function createSA(qubo, { sweeps = 1500, T0, T1, seed = 1, traceEvery = Math.max(1, Math.round(sweeps / 300)) } = {}) {
  const { n, lin, Ws } = qubo, rng = mulberry32(seed);
  const x = new Uint8Array(n), F = Float64Array.from(lin), bestX = new Uint8Array(n);
  for (let u = 0; u < n; u++) if (rng() < 0.5) { x[u] = 1; for (let v = 0; v < n; v++) F[v] += Ws[u * n + v]; }
  let E = energy(qubo, x), bestE = E, sweep = 0, T = T0, ms = 0;
  bestX.set(x);
  const ratio = sweeps > 1 ? Math.pow(T1 / T0, 1 / (sweeps - 1)) : 1;
  const trace = { s: [0], cur: [E], best: [E] };
  return {
    kind: 'sa', n, sweeps, x, bestX, trace,
    get E() { return E; }, get bestE() { return bestE; }, get sweep() { return sweep; }, get T() { return T; }, get ms() { return ms; }, get done() { return sweep >= sweeps; },
    step(count = 1) {
      const t0ms = now();
      for (let c = 0; c < count && sweep < sweeps; c++) {
        for (let a = 0; a < n; a++) {
          const u = Math.floor(rng() * n), dE = (1 - 2 * x[u]) * F[u];
          if (dE <= 0 || rng() < Math.exp(-dE / T)) {
            const s = 1 - 2 * x[u], row = u * n;
            x[u] ^= 1; E += dE;
            for (let v = 0; v < n; v++) F[v] += s * Ws[row + v];
            if (E < bestE - 1e-9) { bestE = E; bestX.set(x); }
          }
        }
        sweep++; T *= ratio;
        if (sweep % traceEvery === 0 || sweep === sweeps) { trace.s.push(sweep); trace.cur.push(E); trace.best.push(bestE); }
      }
      ms += now() - t0ms;
      return sweep >= sweeps;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 4. SIMULATED QUANTUM ANNEALING. A CLASSICAL simulation: path-integral Monte Carlo of the transverse-field Ising
//    model. No quantum hardware is used or claimed.
//
//   Quantum annealing adds a transverse field Gamma to the problem, H = E(x) - Gamma * sum_u sigma^x_u, and lowers
//   Gamma to zero (Kadowaki and Nishimori 1998). The Suzuki-Trotter formula turns that quantum system at temperature
//   T into a classical one with an extra dimension: M copies (replicas, Trotter slices) of the bits in a ring,
//       H_eff = (1/M) sum_m E(x^m)  -  J_perp sum_m sum_u s^m_u s^{m+1}_u,      s = 2x - 1,
//       J_perp = -(T/2) ln tanh( Gamma / (M T) )  > 0,
//   sampled by Metropolis at temperature T (Martonak, Santoro and Tosatti 2002, 2004). A large Gamma means a weak
//   J_perp: the replicas wander apart, which is the classical picture of tunnelling. As Gamma falls J_perp grows
//   and the replicas are pulled into agreement.
//   Moves: a local flip of one bit in one replica, dH = dE/M + 2 J_perp s (s_above + s_below); and a global flip of
//   one bit in every replica, dH = sum_m dE_m / M (the coupling does not change). The answer is the lowest-energy
//   replica seen during the run.
export function createSQA(qubo, { sweeps = 1500, M = 24, T, G0, G1, seed = 1, traceEvery = Math.max(1, Math.round(sweeps / 300)) } = {}) {
  const { n, lin, Ws } = qubo, rng = mulberry32(seed);
  const X = new Uint8Array(M * n), F = new Float64Array(M * n), Em = new Float64Array(M), bestX = new Uint8Array(n);
  for (let m = 0; m < M; m++) {
    const o = m * n;
    F.set(lin, o);
    for (let u = 0; u < n; u++) if (rng() < 0.5) { X[o + u] = 1; for (let v = 0; v < n; v++) F[o + v] += Ws[u * n + v]; }
    Em[m] = energy(qubo, X.subarray(o, o + n));
  }
  let bestE = Infinity, sweep = 0, gamma = G0, jperp = 0, ms = 0;
  const note = (m) => { if (Em[m] < bestE - 1e-9) { bestE = Em[m]; bestX.set(X.subarray(m * n, m * n + n)); } };
  for (let m = 0; m < M; m++) note(m);
  const flip = (m, u) => { const o = m * n, s = 1 - 2 * X[o + u], row = u * n; Em[m] += s * F[o + u]; X[o + u] ^= 1; for (let v = 0; v < n; v++) F[o + v] += s * Ws[row + v]; };
  const stats = () => { let lo = Infinity, sum = 0; for (let m = 0; m < M; m++) { sum += Em[m]; if (Em[m] < lo) lo = Em[m]; } return [lo, sum / M]; };
  const st0 = stats(), trace = { s: [0], best: [st0[0]], mean: [st0[1]] };
  const jOf = (g) => -(T / 2) * Math.log(Math.tanh(g / (M * T)));
  jperp = jOf(gamma);
  return {
    kind: 'sqa', n, M, sweeps, X, Em, bestX, trace, T,
    get bestE() { return bestE; }, get sweep() { return sweep; }, get gamma() { return gamma; }, get jperp() { return jperp; }, get ms() { return ms; }, get done() { return sweep >= sweeps; },
    // Share of (bit, neighbouring replica) pairs that agree. 100 % means every replica holds the same answer.
    agreement() { let same = 0; for (let m = 0; m < M; m++) { const o = m * n, p = ((m + 1) % M) * n; for (let u = 0; u < n; u++) if (X[o + u] === X[p + u]) same++; } return same / (M * n); },
    step(count = 1) {
      const t0ms = now();
      for (let c = 0; c < count && sweep < sweeps; c++) {
        gamma = sweeps > 1 ? G0 + ((G1 - G0) * sweep) / (sweeps - 1) : G1;
        jperp = jOf(gamma);
        for (let m = 0; m < M; m++) {
          const o = m * n, up = ((m + 1) % M) * n, dn = ((m + M - 1) % M) * n;
          for (let a = 0; a < n; a++) {
            const u = Math.floor(rng() * n), xu = X[o + u], s = 2 * xu - 1;
            const dH = ((1 - 2 * xu) * F[o + u]) / M + 2 * jperp * s * (2 * X[up + u] + 2 * X[dn + u] - 2);
            if (dH <= 0 || rng() < Math.exp(-dH / T)) { flip(m, u); note(m); }
          }
        }
        for (let a = 0; a < n; a++) {                                // global moves
          const u = Math.floor(rng() * n);
          let dH = 0;
          for (let m = 0; m < M; m++) dH += (1 - 2 * X[m * n + u]) * F[m * n + u];
          dH /= M;
          if (dH <= 0 || rng() < Math.exp(-dH / T)) for (let m = 0; m < M; m++) { flip(m, u); note(m); }
        }
        sweep++;
        if (sweep % traceEvery === 0 || sweep === sweeps) { const st = stats(); trace.s.push(sweep); trace.best.push(st[0]); trace.mean.push(st[1]); }
      }
      ms += now() - t0ms;
      return sweep >= sweeps;
    },
  };
}

// Schedules, as multiples of the penalty weight A (the height of the walls between plans) so that they follow the
// problem's own scale. Tuned by measurement on drills with 6 and 7 people and 2 teams; the exhibit's table reports
// what they achieve on the problem in front of you. Both get the same number of proposed bit flips: one SQA sweep
// touches M replicas, so SA runs M times as many sweeps on its single copy.
export function schedules(qubo, sweeps, M = 24) {
  const A = qubo.A;
  return {
    sa: { sweeps: sweeps * M, T0: 0.6 * A, T1: 0.003 * A },
    sqa: { sweeps, M, T: 0.012 * A, G0: 1.5 * A, G1: 0.001 * A },
  };
}

// Read an annealer's answer: decode the best state, repair it if it broke a rule, and cost it directly.
export function readOut(prob, qubo, bestX) {
  const d = decode(qubo, bestX), routes = d.feasible ? d.routes : repair(prob, d.routes);
  return { routes, feasible: d.feasible, repaired: !d.feasible, cost: planCost(prob, routes).total };
}

export const median = (a) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
