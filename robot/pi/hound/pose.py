"""Where the rover thinks it is: the wheels say how far, the drone's view from above corrects the drift when it has one."""
import math

class Pose:
    K = 200 * 32 / (math.pi * .080); R = .125 + .2155                                  # steps a metre, and half wheelbase + half track
    SLIP, TURN, FLOOR = .10 ** 2, math.radians(1.5) ** 2, .05 ** 2                      # assumed: 10 cm and 1.5 degrees after a metre, 32 cm after ten. It grows with the distance, not with the number of steps. The drone's own error does not average out, so it never claims less than 5 cm
    def __init__(self, x=0.0, y=0.0, h=0.0): self.x, self.y, self.h = x, y, h; self.var = .01 ** 2; self.hvar = math.radians(.5) ** 2; self.last = None; self.refused = 0
    def steps(self, s):
        if self.last is None: self.last = s; return
        d = [(a - b + 2 ** 31) % 2 ** 32 - 2 ** 31 for a, b in zip(s, self.last)]; self.last = s                # the counters may wrap
        fl, fr, rl, rr = d; dx, dy, dw = (fl + fr + rl + rr) / (4 * self.K), (-fl + fr + rl - rr) / (4 * self.K), (-fl + fr - rl + rr) / (4 * self.K * self.R)
        a = self.h + dw / 2; self.x += dx * math.cos(a) - dy * math.sin(a); self.y += dx * math.sin(a) + dy * math.cos(a); self.h = math.atan2(math.sin(self.h + dw), math.cos(self.h + dw))
        run = math.hypot(dx, dy); self.var += self.SLIP * run; self.hvar += self.TURN * run + (.05 * abs(dw)) ** 2
    def fix(self, x, y, h=None, sd=.10, hsd=math.radians(2)):
        """A sighting from the drone. One that is far outside what both could be wrong by is refused."""
        e = math.hypot(x - self.x, y - self.y)
        if e > 3 * math.sqrt(self.var + sd * sd) + .15: self.refused += 1; self.var += .02; return False          # one odd sighting is thrown away; a row of them makes the rover doubt itself, stop, and believe them
        k = self.var / (self.var + sd * sd); self.x += k * (x - self.x); self.y += k * (y - self.y); self.var = max(self.var * (1 - k), self.FLOOR)
        if h is not None: d = math.atan2(math.sin(h - self.h), math.cos(h - self.h)); q = self.hvar / (self.hvar + hsd * hsd); self.h += q * d; self.hvar *= 1 - q
        return True

class Follow:
    """Drives a path with mecanum wheels: it can move any way without turning first, so it only turns to face where it will look."""
    def __init__(self, path, face=None, v=.35, near=.08): self.p, self.face, self.v, self.near, self.i = [tuple(q) for q in path], face, v, near, 1; self.stuck_t = None; self.best = 1e9
    def step(self, pose, t):
        """(vx, vy, w) in the rover's own frame, done?, stuck?"""
        while self.i < len(self.p) - 1 and math.dist((pose.x, pose.y), self.p[self.i]) < .25: self.i += 1
        g = self.p[min(self.i, len(self.p) - 1)]; left = math.dist((pose.x, pose.y), g) + sum(math.dist(a, b) for a, b in zip(self.p[self.i:], self.p[self.i + 1:]))
        if left < self.best - .03: self.best, self.stuck_t = left, t
        stuck = self.stuck_t is not None and t - self.stuck_t > 6
        last = self.i >= len(self.p) - 1; d = math.dist((pose.x, pose.y), g); turn = 0.0
        if self.face is not None and left < 2.0: turn = math.atan2(math.sin(math.atan2(self.face[1] - pose.y, self.face[0] - pose.x) - pose.h), math.cos(math.atan2(self.face[1] - pose.y, self.face[0] - pose.x) - pose.h))
        if last and d < self.near and abs(turn) < .05: return (0.0, 0.0, 0.0), True, False
        sp = min(self.v, max(.04, 1.1 * d) if last else self.v); u = (g[0] - pose.x) / max(d, 1e-6), (g[1] - pose.y) / max(d, 1e-6)
        if last and d < self.near: sp = 0.0
        c, s = math.cos(pose.h), math.sin(pose.h); return (sp * (c * u[0] + s * u[1]), sp * (-s * u[0] + c * u[1]), max(-.6, min(.6, 1.5 * turn))), False, stuck
