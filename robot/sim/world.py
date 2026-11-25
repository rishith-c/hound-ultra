"""The practice building: five rooms round a corridor, the roof gone. Walls stop the rover and its distance sensors; Wi-Fi goes through them.
Everything here is made up, and so is every reading that comes out of it. What is real is the code under test: the drive core, the radio packets, the network, the fusion, the planner, the mission."""
import ctypes
import math
import subprocess
import sys
import tempfile
from pathlib import Path
import numpy as np
HERE = Path(__file__).resolve().parent; sys.path[:0] = [str(HERE.parent / 'pi'), str(HERE)]
from channel import Body, Channel, Fan                                            # noqa: E402
from hound import csi, radar                                                      # noqa: E402

def board_library():
    so = Path(tempfile.gettempdir()) / f'hound_drive_{int((HERE.parent / "drive" / "core.h").stat().st_mtime)}_{int((HERE.parent / "drive" / "shim.cpp").stat().st_mtime)}.so'
    if not so.exists(): subprocess.run(['c++', '-std=c++17', '-O2', '-Wall', '-Wextra', '-shared', '-fPIC', '-o', str(so), str(HERE.parent / 'drive' / 'shim.cpp')], check=True)
    L = ctypes.CDLL(str(so)); L.board_new.restype = ctypes.c_void_p
    for n, a in (('board_free', [ctypes.c_void_p]), ('board_bytes', [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]), ('board_read', [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]), ('board_volts', [ctypes.c_void_p, ctypes.c_float]), ('board_ms', [ctypes.c_void_p]), ('board_look', [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]), ('core_wheels', [ctypes.c_float] * 3 + [ctypes.c_void_p]), ('core_body', [ctypes.c_void_p, ctypes.c_void_p])): getattr(L, n).argtypes = a
    return L

class Board:
    """The motor board: the real firmware core behind a wire that can be cut."""
    def __init__(self): self.L = board_library(); self.p = self.L.board_new(); self.cut = False; self.noise = None
    def write(self, d):
        if self.cut: return
        if self.noise is not None: d = bytes(b ^ int(self.noise.integers(1, 255)) if self.noise.random() < .02 else b for b in d)
        self.L.board_bytes(self.p, d, len(d))
    def read(self): b = ctypes.create_string_buffer(8192); n = self.L.board_read(self.p, b, 8192); return b'' if self.cut else b.raw[:n]
    def ms(self, n, volts=11.4):
        self.L.board_volts(self.p, volts)
        for _ in range(n): self.L.board_ms(self.p)
    def look(self): v, s, k = (ctypes.c_float * 3)(), (ctypes.c_int * 4)(), (ctypes.c_int * 4)(); self.L.board_look(self.p, v, s, k); return tuple(v), tuple(s), dict(state=k[0], faults=k[1], on=bool(k[2]), bad=k[3])

W, H, RES = 26.0, 20.0, .25
def rect(x0, y0, x1, y1, doors=()):
    """Walls of a room as segments; doors are (side, from, to) gaps."""
    s = []
    for side, a, b in (('south', (x0, y0), (x1, y0)), ('north', (x0, y1), (x1, y1)), ('west', (x0, y0), (x0, y1)), ('east', (x1, y0), (x1, y1))):
        gaps = sorted((u, v) for sd, u, v in doors if sd == side); k = 0 if side in ('south', 'north') else 1; at = a[k]
        pt = lambda q: (q, a[1]) if k == 0 else (a[0], q)
        for u, v in gaps + [(b[k], b[k])]:
            if u - at > 1e-6: s.append((pt(at), pt(u)))
            at = v
    return s
ROOMS = {'A': (4, 11.5, 9, 16.5), 'B': (11, 11.5, 16, 16.5), 'C': (18, 11.5, 23, 16.5), 'D': (4, 3, 9, 7.5), 'E': (18, 3, 23, 7.5)}
DOORS = {'A': [('south', 6, 7.2)], 'B': [('south', 13, 14.2)], 'C': [('south', 20, 21.2)], 'D': [('north', 6, 7.2)], 'E': [('north', 20, 21.2)]}
WALLS = [s for r in ROOMS for s in rect(*ROOMS[r], DOORS[r])] + rect(1, 1, 25, 19, [('west', 8.6, 10.2)])
RUBBLE = [(13.0, 5.0, 1.6), (16.2, 9.6, .5), (21.0, 9.5, .45)]                        # x, y, radius

def crosses(a, b, c, d):
    o = lambda p, q, r: (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); return o(a, b, c) * o(a, b, d) < 0 and o(c, d, a) * o(c, d, b) < 0
def walls_between(a, b): return sum(crosses(a, b, *w) for w in WALLS)
def ray(p, ang, reach=4.0):
    e = p[0] + reach * math.cos(ang), p[1] + reach * math.sin(ang); best = reach
    for c, d in WALLS:
        if crosses(p, e, c, d): r, s = (e[0] - p[0], e[1] - p[1]), (d[0] - c[0], d[1] - c[1]); u = ((c[0] - p[0]) * s[1] - (c[1] - p[1]) * s[0]) / (r[0] * s[1] - r[1] * s[0]); best = min(best, u * reach)
    for x, y, R in RUBBLE:
        dx, dy = x - p[0], y - p[1]; u = dx * math.cos(ang) + dy * math.sin(ang); q = dx * dx + dy * dy - u * u
        if u > 0 and q < R * R: best = min(best, max(0.0, u - math.sqrt(R * R - q)))
    return best
def truth_grid():
    n, m = int(H / RES), int(W / RES); g = np.zeros((n, m), bool); ys, xs = (np.arange(n) + .5) * RES, (np.arange(m) + .5) * RES; X, Y = np.meshgrid(xs, ys)
    for (ax, ay), (bx, by) in WALLS: L = math.dist((ax, ay), (bx, by)); u = np.clip(((X - ax) * (bx - ax) + (Y - ay) * (by - ay)) / L ** 2, 0, 1); g |= np.hypot(X - ax - u * (bx - ax), Y - ay - u * (by - ay)) < RES * .75
    for x, y, R in RUBBLE: g |= np.hypot(X - x, Y - y) < R
    return g

class World:
    def __init__(self, seed=0, start=(-1.5, 9.4), people=None, fans=None, hot=None):
        self.rng = np.random.default_rng(seed); self.t = 0.0; self.x, self.y, self.h = start[0], start[1], 0.0; self.board = Board(); self.last = (0, 0, 0, 0); self.volts = 11.6; self.hit = 0; self.hits = []; self.drain = 0.0
        self.people = {k: Body(*v, rng=self.rng) if not isinstance(v, Body) else v for k, v in (people if people is not None else {'A': Body(6.6, 14.2, .7, 1.1, rng=self.rng), 'E': Body(20.5, 5.2, .6, 1.0, rng=self.rng)}).items()}; self.fans = fans if fans is not None else {'B': Fan(13.5, 14.5)}; self.hot = hot if hot is not None else {'C': (20.6, 12.4, 88.0)}
        self.ch = Channel(seed + 5); self.probe = None; self.radio = True; self.corrupt = 0.0; self.heat_ok = True; self.tof_ok = True; self.q = []; self.r_t = self.p_t = self.h_t = self.f_t = 0.0; self.pending = b''; self.pending2 = b''; self.frame = None
    def step(self, dt=.02):
        self.board.ms(round(dt * 1000), self.volts); self.t += dt; _, s, _ = self.board.look(); d = [a - b for a, b in zip(s, self.last)]; self.last = s; K, R = 200 * 32 / (math.pi * .08), .3405
        fl, fr, rl, rr = d; dx, dy, dw = (fl + fr + rl + rr) / (4 * K), (-fl + fr + rl - rr) / (4 * K), (-fl + fr - rl + rr) / (4 * K * R); run = math.hypot(dx, dy)
        dx *= .985 + self.rng.normal(0, .01); dy *= .955 + self.rng.normal(0, .015); dw = dw * .98 + self.rng.normal(0, .0015) * (run > 0)                       # rollers slip, sideways more than forward
        a = self.h + dw / 2; nx, ny = self.x + dx * math.cos(a) - dy * math.sin(a), self.y + dx * math.sin(a) + dy * math.cos(a)
        if run and min(ray((nx, ny), math.atan2(ny - self.y, nx - self.x) + o, .5) for o in (-.7, 0, .7)) < .19: self.hit += 1; self.hits.append((round(self.x, 2), round(self.y, 2)))
        else: self.x, self.y = nx, ny
        self.h += dw; self.volts -= self.drain * dt; still = run == 0; here = (self.x, self.y)
        if self.probe is not None and self.radio:
            while self.p_t <= self.t:
                self.p_t += .01; mv = list(self.people.values()) + list(self.fans.values()); w, ex = self._walls(mv, here); a51 = self.ch.probe(self.p_t, np.array(self.probe), np.array([self.x, self.y, .35]), mv, w, ex)
                if a51 is not None:
                    p = csi.packet(a51 if self.corrupt == 0 or self.rng.random() > self.corrupt else self.rng.uniform(0, 100, 51), self.ch.seq, self.p_t * 1e6, unit=2, rng=self.rng); self.q.append(p if self.corrupt == 0 or self.rng.random() > self.corrupt else p[:int(self.rng.integers(1, len(p)))])
        else: self.p_t = self.t
        if self.t - self.r_t >= .1:
            self.r_t = self.t; o = []
            for b in self.people.values():
                p, p2 = b.where(self.t), b.where(self.t - .1); rel = (p[0] - self.x, p[1] - self.y); r = math.hypot(*rel); az = math.atan2(rel[1], rel[0]) - self.h; az = math.atan2(math.sin(az), math.cos(az)); v = (r - math.hypot(p2[0] - self.x, p2[1] - self.y)) / .1
                if still and r < 6 and abs(az) < 1.05 and walls_between(here, p) <= 1 and abs(v) > .05 and self.rng.random() < .92: o.append((-r * math.sin(az) + self.rng.normal(0, .05), r * math.cos(az) + self.rng.normal(0, .05), v + self.rng.normal(0, .04)))
            self.pending += radar.report2450(o); near = [math.dist(here, b.where(self.t)) for b in self.people.values() if walls_between(here, b.where(self.t)) <= 1]; self.pending2 += radar.report2410(still=min(near) if near and min(near) < 4.5 and self.rng.random() < .8 else None)
        if self.t - self.h_t >= .25:
            self.h_t = self.t; f = 18.5 + self.rng.normal(0, .12, (24, 32))
            for x, y, T in self.hot.values():
                if walls_between(here, (x, y)) == 0 and math.dist(here, (x, y)) < 8:
                    az = math.degrees(math.atan2(y - self.y, x - self.x) - self.h); az = (az + 180) % 360 - 180
                    if abs(az) < 26: c = int(15.5 + az / 55 * 32); f[10:14, max(0, c - 1):c + 2] = T
            self.frame = f if self.heat_ok else None
    def _walls(self, mv, here):
        k = (round(self.t * 4), here, tuple(self.probe[:2]))                        # people do not change rooms, so four times a second is plenty
        if getattr(self, '_wk', None) != k: p = self.probe[:2]; w = walls_between(here, p); self._wk, self._wv = k, (w, [walls_between(p, c) + walls_between(c, here) - w for c in (m.at(self.t)[:, :2].mean(0) for m in mv)])
        return self._wv
    # ---- what the rover's io asks for
    def ranges(self): return (ray((self.x, self.y), self.h) - .16 + self.rng.normal(0, .006), ray((self.x, self.y), self.h + math.pi) - .16 + self.rng.normal(0, .006), self.t) if self.tof_ok else (None, None, None)
