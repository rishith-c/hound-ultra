"""The map the rover drives on, from the laser: what is blocked, what each square of ground costs, and which spaces are closed in enough to hide someone."""
import math
from collections import deque
import numpy as np

STEP, RES = .18, .25                                                    # the rover climbs less than this; the size of a square


def shift(a, dy, dx, fill=False):
    o = np.full_like(a, fill); h, w = a.shape
    o[max(0, dy):h + min(0, dy), max(0, dx):w + min(0, dx)] = a[max(0, -dy):h + min(0, -dy), max(0, -dx):w + min(0, -dx)]
    return o


def grow(a, metres, res=RES):
    n = int(math.ceil(metres / res)); o = a.copy()
    for dy in range(-n, n + 1):
        for dx in range(-n, n + 1):
            if math.hypot(dy, dx) * res <= metres + 1e-9: o |= shift(a, dy, dx)
    return o


def parts(a):
    """Connected pieces of a mask, as lists of cells."""
    seen = np.zeros_like(a); out = []
    for s in zip(*np.nonzero(a)):
        if seen[s]: continue
        q, piece = deque([s]), []; seen[s] = True
        while q:
            c = q.popleft(); piece.append(c)
            for d in ((c[0] + 1, c[1]), (c[0] - 1, c[1]), (c[0], c[1] + 1), (c[0], c[1] - 1)):
                if 0 <= d[0] < a.shape[0] and 0 <= d[1] < a.shape[1] and a[d] and not seen[d]: seen[d] = True; q.append(d)
        out.append(piece)
    return out


class Mapper:
    """Add laser points in metres above the ground as they come. Nothing is thrown away until build()."""

    def __init__(self, size, res=RES):
        self.res, (self.w, self.h) = res, (int(round(size[0] / res)), int(round(size[1] / res)))
        self.n = np.zeros((self.h, self.w), int); self.hi = np.full((self.h, self.w), -9.0); self.lo = np.full((self.h, self.w), 99.0); self.tall = np.zeros((self.h, self.w), int)

    def add(self, pts, height):
        ix, iy = np.floor(pts[:, 0] / self.res).astype(int), np.floor(pts[:, 1] / self.res).astype(int)
        ok = (ix >= 0) & (ix < self.w) & (iy >= 0) & (iy < self.h) & np.isfinite(height) & (height > -1) & (height < 30); ix, iy, z = ix[ok], iy[ok], height[ok]
        np.add.at(self.n, (iy, ix), 1); np.maximum.at(self.hi, (iy, ix), z); np.minimum.at(self.lo, (iy, ix), z); np.add.at(self.tall, (iy, ix), z > STEP)

    def blocked(self):
        """A square is blocked when at least two points, and one in eight, stand higher than the rover can climb: one stray point is not a wall. A square nobody saw is blocked too."""
        return (self.n < 3) | ((self.tall >= 2) & (self.tall * 8 >= self.n))

    def _walled(self, wall, box):
        """How much of a box's outline has something standing on it. A doorway is open; a gap between two heaps of rubble is much more open."""
        x0, y0, x1, y1 = box; u = np.linspace(0, 1, 60); x = np.concatenate([x0 + u * (x1 - x0)] * 2 + [np.full(60, x0), np.full(60, x1)]); y = np.concatenate([np.full(60, y0), np.full(60, y1)] + [y0 + u * (y1 - y0)] * 2)
        return float(wall[np.clip((y / self.res).astype(int), 0, self.h - 1), np.clip((x / self.res).astype(int), 0, self.w - 1)].mean())

    def build(self, rooms=(5, 45), door=1.5):
        b = self.blocked(); near = grow(b, .6, self.res) & ~b; cost = np.where(near, 1.8, 1.0); rough = np.where(self.n > 0, np.clip(self.hi - self.lo, 0, 1), 1.0); cost = cost + 2.0 * np.where(b, 0, np.minimum(rough / STEP, 1.0)) * (rough > .06)
        unseen = float((self.n < 3).mean())
        # rooms: swell the walls until the doors close, and keep the pieces that are the size of a room and do not touch the edge
        shut = grow(b, door / 2, self.res); wall = grow(b, .3, self.res); found = []
        for piece in parts(~shut):
            ys, xs = np.array(piece).T
            if ys.min() == 0 or xs.min() == 0 or ys.max() == self.h - 1 or xs.max() == self.w - 1: continue
            x0, y0, x1, y1 = xs.min() * self.res - door / 2, ys.min() * self.res - door / 2, (xs.max() + 1) * self.res + door / 2, (ys.max() + 1) * self.res + door / 2; area = (x1 - x0) * (y1 - y0)
            if rooms[0] <= area <= rooms[1] and max(x1 - x0, y1 - y0) < 9 and min(x1 - x0, y1 - y0) > 2.2 and self._walled(wall, (x0, y0, x1, y1)) > .86: found.append((x0, y0, x1, y1))
        found.sort(key=lambda r: (-round(r[3] / 4), r[0])); names = 'ABCDEFGHJKLMNP'
        return dict(kind='map', res=self.res, blocked=b.tolist(), cost=np.round(cost, 2).tolist(), rooms=[dict(id=names[i], box=[round(float(v), 2) for v in r], aerial=[]) for i, r in enumerate(found[:len(names)])], unseen=round(unseen, 3))
