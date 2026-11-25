"""The drone over the practice building: its real flight core and companion code, a laser that only sees what is under it, and a camera that can see the rover."""
import math
import sys
from pathlib import Path
import numpy as np
ROOT = Path(__file__).resolve().parents[2]; sys.path[:0] = [str(ROOT / 'drone' / 'sim'), str(ROOT / 'drone' / 'companion')]
import world as W                                                                 # noqa: E402
from sky import Sky                                                               # noqa: E402
from hound_drone.fc import FlightLink                                             # noqa: E402
from hound_drone.mission import Mission                                           # noqa: E402

WALL = 2.4
def _heights(res=.1):
    n, m = int(W.H / res), int(W.W / res); Y, X = np.meshgrid((np.arange(n) + .5) * res, (np.arange(m) + .5) * res, indexing='ij'); h = np.zeros((n, m))
    for (ax, ay), (bx, by) in W.WALLS: L = math.dist((ax, ay), (bx, by)); u = np.clip(((X - ax) * (bx - ax) + (Y - ay) * (by - ay)) / L ** 2, 0, 1); h[np.hypot(X - ax - u * (bx - ax), Y - ay - u * (by - ay)) < .1] = WALL
    for x, y, R in W.RUBBLE: h = np.maximum(h, np.sqrt(np.maximum(R * R - (X - x) ** 2 - (Y - y) ** 2, 0)) * .8)
    return h

class Air:
    HOME = (-3.0, 6.5)
    def __init__(self, seed=0, wind=(2.0, 1.0, .6), key=None):
        self.sky = Sky(seed + 11); self.sky.at(*self.HOME); self.sky.wind(*wind); self.sky.set(Sky.LINK, 0); self.rng = np.random.default_rng(seed + 3); self.h = _heights(); self.m = Mission(FlightLink(self.sky), (0.0, 0.0, W.W, W.H), self.HOME); self.l_t = self.c_t = 0.0; self.near = 99.0; self.link = True; self.down_at = None; self.drift = (0.0, 0.0)
    def step(self, t, dt, rover):
        self.sky.run(dt); s = self.sky.look(); p = s['pos']; self.real = s
        if self.link and round(t / dt) % 5 == 0: self.m.step(t)
        if not s['armed'] and s['mode'] == 'on the ground': self.down_at = p
        if p[2] < WALL + .3 and s['armed']: self.near = min(self.near, min(W.ray(p[:2], a, 4.0) for a in np.arange(0, 6.28, .4)))
        if self.m.state == 'survey' and s['mode'] == 'following' and t - self.l_t >= .1: self.l_t = t; self.m.laser(self._laser(p, s['believed']))
        self.fix = None
        if s['armed'] and p[2] > 5 and t - self.c_t >= .5 and math.dist(p[:2], (rover.x, rover.y)) < p[2] * .58:
            self.c_t = t; e = s['believed'] - p; self.fix = dict(kind='fix', x=rover.x + e[0] + self.rng.normal(0, .07), y=rover.y + e[1] + self.rng.normal(0, .07), h=rover.h + self.rng.normal(0, .02))
    def _laser(self, p, believed, n=2400):
        a, r = self.rng.uniform(0, 2 * math.pi, n), np.sqrt(self.rng.uniform(0, 1, n)) * math.tan(math.radians(38)); d = np.stack([r * np.cos(a), r * np.sin(a), -np.ones(n)], 1); s = np.full(n, np.nan)
        for z in np.arange(2.6, -.01, -.05):                                        # walk down each ray and stop at the first thing in the way
            k = (p[2] - z) * np.ones(n); q = p + d * k[:, None]; ix, iy = (q[:, 0] / .1).astype(int), (q[:, 1] / .1).astype(int); ok = (ix >= 0) & (ix < self.h.shape[1]) & (iy >= 0) & (iy < self.h.shape[0]); g = np.zeros(n); g[ok] = self.h[iy[ok], ix[ok]]; s = np.where(np.isnan(s) & (g >= z - .02), k, s)
        ok = np.isfinite(s); d = d[ok] * (1 + self.rng.normal(0, .02, ok.sum()) / p[2])[:, None]; tilt = self.rng.normal(0, math.radians(.25), 2); q = d * s[ok][:, None]; q[:, 0] += tilt[0] * q[:, 2]; q[:, 1] += tilt[1] * q[:, 2]; return believed + q
