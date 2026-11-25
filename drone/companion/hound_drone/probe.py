"""The far side: where the drone sets itself down so that its Wi-Fi crosses the whole room on its way to the rover."""
import math
import numpy as np


def clear(hgt, res, p, radius, high=.12):
    """Flat and free within `radius`: every square was seen and none stands up."""
    x, y = p; n = int(math.ceil(radius / res)); cy, cx = int(y / res), int(x / res); h, w = hgt.shape
    for dy in range(-n, n + 1):
        for dx in range(-n, n + 1):
            if math.hypot(dy, dx) * res > radius: continue
            i, j = cy + dy, cx + dx
            if not (0 <= i < h and 0 <= j < w) or not np.isfinite(hgt[i, j]) or hgt[i, j] > high: return False
    return True


def far_side(hgt, res, rover, box, wanted, radius=.9, reach=3.0, others=()):
    """The flat spot nearest to where the rover asked for, still outside every room and with the room between the two. Returns (x, y) or None: then it stays in the air, or the rover picks another wall."""
    x0, y0, x1, y1 = box; mid = ((x0 + x1) / 2, (y0 + y1) / 2); best = None; n = int(reach / res)
    for i in range(-n, n + 1):
        for j in range(-n, n + 1):
            p = wanted[0] + i * res, wanted[1] + j * res; d = math.hypot(i, j) * res
            if d > reach or any(a - .4 < p[0] < c + .4 and b - .4 < p[1] < e + .4 for a, b, c, e in (box, *others)): continue
            a, b = math.atan2(p[1] - mid[1], p[0] - mid[0]), math.atan2(rover[1] - mid[1], rover[0] - mid[0]); across = abs(math.atan2(math.sin(a - b), math.cos(a - b)))
            if across < math.radians(120): continue                     # the line between the two must go through the room
            c = d + .8 * (math.pi - across)
            if (best is None or c < best[0]) and clear(hgt, res, p, radius): best = c, p
    return None if best is None else best[1]
