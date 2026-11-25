"""Finding a way: A* on the drone's map, priced by risk, then straightened where a straight line costs no more.
When there is no way in, it returns the way to the nearest point it can reach and how far is left: that is where a team would have to break through."""
import heapq
import math
import numpy as np

class Grid:
    def __init__(self, blocked, cost=None, res=.5): self.blocked = np.asarray(blocked, bool); self.h, self.w = self.blocked.shape; self.cost = np.ones_like(self.blocked, float) if cost is None else np.asarray(cost, float); self.res = res
    def cell(self, p): return int(math.floor(p[1] / self.res)), int(math.floor(p[0] / self.res))
    def point(self, c): return (c[1] + .5) * self.res, (c[0] + .5) * self.res
    def free(self, c): return 0 <= c[0] < self.h and 0 <= c[1] < self.w and not self.blocked[c]
    def nearest(self, c, reach=8):
        for r in range(reach + 1):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) == r and self.free((c[0] + dy, c[1] + dx)): return c[0] + dy, c[1] + dx
        return None
    def grown(self, radius):
        """The same map for a body this wide: every blocked cell swells."""
        n = int(math.ceil(radius / self.res)); g = self.blocked.copy()
        for dy in range(-n, n + 1):
            for dx in range(-n, n + 1):
                if (dx or dy) and math.hypot(max(0, abs(dx) - .5), max(0, abs(dy) - .5)) * self.res < radius:
                    a = np.zeros_like(g); ys, xs = slice(max(0, dy), self.h + min(0, dy)), slice(max(0, dx), self.w + min(0, dx)); yo, xo = slice(max(0, -dy), self.h + min(0, -dy)), slice(max(0, -dx), self.w + min(0, -dx)); a[ys, xs] = self.blocked[yo, xo]; g |= a
        return Grid(g, self.cost, self.res)

def price(g, a, b):
    """Cost of a straight line, or None when it touches something."""
    L = math.dist(a, b); n = max(1, int(math.ceil(L / (g.res * .25)))); s = 0.0
    for k in range(n):
        u = (k + .5) / n; c = g.cell((a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u))
        if not g.free(c): return None
        s += L / n * g.cost[c]
    return s

def route(g, start, goal, nearest=False):
    s, t = g.nearest(g.cell(start)), g.nearest(g.cell(goal))
    if s is None or t is None: return dict(ok=False, why='the start is inside something' if s is None else 'the goal is inside something')
    floor = float(g.cost[~g.blocked].min()); h = lambda c: floor * (lambda a, b: a + b - (2 - math.sqrt(2)) * min(a, b))(abs(c[0] - t[0]), abs(c[1] - t[1]))
    best, came, done, q, n = {s: 0.0}, {}, set(), [(h(s), 0, s)], 0
    while q:
        _, _, c = heapq.heappop(q)
        if c in done: continue
        done.add(c)
        if c == t: break
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            d = c[0] + dy, c[1] + dx
            if d in done or not g.free(d) or (dy and dx and not (g.free((c[0] + dy, c[1])) and g.free((c[0], c[1] + dx)))): continue          # never cut a corner
            v = best[c] + math.hypot(dy, dx) * g.cost[d]
            if v < best.get(d, 1e18): best[d] = v; came[d] = c; n += 1; heapq.heappush(q, (v + h(d), n, d))
    reached = t in done
    if not reached:
        if not nearest: return dict(ok=False, why='every way in is blocked')
        t = min(done, key=lambda c: (math.hypot(c[0] - t[0], c[1] - t[1]), best[c]))
    cells = [t]
    while cells[-1] in came: cells.append(came[cells[-1]])
    p = [g.point(c) for c in cells[::-1]]
    if g.free(g.cell(start)): p[0] = tuple(start)
    if reached and g.free(g.cell(goal)): p[-1] = tuple(goal)
    if len(p) == 1: p = [p[0], p[0]]
    run = [0.0]
    for a, b in zip(p, p[1:]): run.append(run[-1] + (price(g, a, b) if price(g, a, b) is not None else math.dist(a, b) * g.cost.max()))
    out, i = [p[0]], 0
    while i < len(p) - 1:
        j = len(p) - 1
        while j > i + 1:
            v = price(g, p[i], p[j])
            if v is not None and v <= run[j] - run[i] + 1e-6: break
            j -= 1
        out.append(p[j]); i = j
    return dict(ok=True, reached=reached, gap=0.0 if reached else math.dist(g.point(t), goal), path=out, length=sum(math.dist(a, b) for a, b in zip(out, out[1:])), cost=best[t] * g.res)

def listening_spot(g, home, room, sides=('west', 'east', 'south', 'north'), stand=(.9, 2.4)):
    """Where to stop outside a room: just outside one of its walls, reachable, and cheap to reach. room = (x0, y0, x1, y1). Returns (cost, spot, route, side) or None."""
    x0, y0, x1, y1 = room; mid = (x0 + x1) / 2, (y0 + y1) / 2; best = None
    for d in np.arange(stand[0], stand[1] + .01, .5):
        for u in np.linspace(.15, .85, 5):
            for side, o in (('west', (x0 - d, y0 + u * (y1 - y0))), ('east', (x1 + d, y0 + u * (y1 - y0))), ('south', (x0 + u * (x1 - x0), y0 - d)), ('north', (x0 + u * (x1 - x0), y1 + d))):
                if side not in sides or not g.free(g.cell(o)): continue
                r = route(g, home, o)
                if r['ok'] and (best is None or r['cost'] + 2 * math.dist(o, mid) < best[0]): best = r['cost'] + 2 * math.dist(o, mid), o, r, side
    return best
