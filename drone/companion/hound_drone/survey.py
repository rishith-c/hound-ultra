"""Where to fly to see everything once: back and forth over the box, close enough together that no strip is missed."""
import math


def lanes(box, height, fov=math.radians(62), overlap=.35, margin=1.0):
    """box = (x0, y0, x1, y1) in metres. Lanes run along the long side. Returns [(x, y, z)], start to end."""
    x0, y0, x1, y1 = box
    if not (x1 > x0 and y1 > y0 and height > 2): raise ValueError('an empty box, or too low')
    long_x = x1 - x0 >= y1 - y0
    a0, a1, b0, b1 = (x0, x1, y0, y1) if long_x else (y0, y1, x0, x1)
    swath = 2 * height * math.tan(fov / 2) * (1 - overlap)
    n = max(1, math.ceil((b1 - b0) / swath)); step = (b1 - b0) / n; out = []
    for k in range(n):
        b = b0 + (k + .5) * step; ends = [a0 - margin, a1 + margin] if k % 2 == 0 else [a1 + margin, a0 - margin]
        out += [((a, b, height) if long_x else (b, a, height)) for a in ends]
    return out


def cost(path, start, speed, watts, climb=3.0):
    """Seconds and watt-hours for a path, from start and back, with the turn at each corner."""
    pts = [start] + list(path) + [start]; s = sum(math.dist(a[:2], b[:2]) / speed + abs(a[2] - b[2]) / climb for a, b in zip(pts, pts[1:])) + 2.5 * len(path) + 20
    return s, watts * s / 3600


def cover(path, box, height, fov=math.radians(62), res=.5):
    """The part of the box that some lane looked straight down at, 0 to 1. Used by the tests, and before take-off."""
    half = height * math.tan(fov / 2); x0, y0, x1, y1 = box; hit = total = 0
    for i in range(int((x1 - x0) / res)):
        for j in range(int((y1 - y0) / res)):
            x, y = x0 + (i + .5) * res, y0 + (j + .5) * res; total += 1
            for a, b in zip(path, path[1:]):
                L = math.dist(a[:2], b[:2]); u = 0 if L < 1e-9 else max(0, min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / L ** 2))
                if math.hypot(x - a[0] - u * (b[0] - a[0]), y - a[1] - u * (b[1] - a[1])) <= half: hit += 1; break
    return hit / max(1, total)
