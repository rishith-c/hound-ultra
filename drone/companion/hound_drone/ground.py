"""The ground under a cloud of points: the plane most of the low points agree on. Heights are measured from it."""
import numpy as np


def plane(points, rng=None, tries=200, tol=.12, max_slope=.45):
    """RANSAC, then a least-squares fit of the points that agreed. Returns (a, b, c, d, share of points on it) with c > 0, or None."""
    p = np.asarray(points, float); rng = rng or np.random.default_rng(0)
    if len(p) < 30: return None
    low = p[p[:, 2] < np.percentile(p[:, 2], 60)]; best, score = None, 0
    for _ in range(tries):
        a, b, c = low[rng.choice(len(low), 3, replace=False)]; n = np.cross(b - a, c - a); L = np.linalg.norm(n)
        if L < 1e-6: continue
        n = n / L * np.sign(n[2] or 1)
        if n[2] < np.cos(np.arctan(max_slope)): continue
        s = int((abs(p @ n - n @ a) < tol).sum())
        if s > score: best, score = (n, n @ a), s
    if best is None: return None
    for _ in range(3):
        on = p[abs(p @ best[0] - best[1]) < tol]
        if len(on) < 20: return None
        m = on.mean(0); n = np.linalg.svd(on - m, full_matrices=False)[2][2]; n = n * np.sign(n[2] or 1); best = (n, n @ m)
    return (*best[0], best[1], float((abs(p @ best[0] - best[1]) < tol).mean()))


def heights(points, pl): n = np.array(pl[:3]); return np.asarray(points, float) @ n - pl[3]
