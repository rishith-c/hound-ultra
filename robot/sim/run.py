"""One whole search, with the real code on both machines and only the world made up.

    python3 robot/sim/run.py            one search, with its log
    python3 robot/sim/cases.py          every case, and the table

Every reading is simulated. What runs is the code that would run: the motor board's core and the flight board's core (compiled C++), their wire frames, the radio packets, the neural network, the fusion, the planner, both missions."""
import json
import sys
import time
from pathlib import Path
import numpy as np
HERE = Path(__file__).resolve().parent; sys.path[:0] = [str(HERE), str(HERE.parent / 'pi')]
import world as W                                                                 # noqa: E402
from air import Air                                                               # noqa: E402
from channel import Body, Fan                                                     # noqa: E402
from hound.net import Net                                                         # noqa: E402
from hound.rover import Rover                                                     # noqa: E402

class Io:
    def __init__(self, world, air): self.w, self.a, self.drive, self.inbox, self.mute = world, air, world.board, [], False
    def udp(self): q, self.w.q = self.w.q, []; return q
    def uart2450(self): q, self.w.pending = self.w.pending, b''; return q
    def uart2410(self): q, self.w.pending2 = self.w.pending2, b''; return q
    def heat(self): f, self.w.frame = self.w.frame, None; return f
    def ranges(self): return self.w.ranges()
    def tilt(self): return 0.0
    def drone_in(self): q, self.inbox = self.inbox, []; return q
    def drone_out(self, m): self.a.m.hear(self.w.t, m)

class Run:
    def __init__(self, seed=0, people=None, fans=None, hot=None, wind=(2.0, 1.0, .6), say=False):
        self.w = W.World(seed, people=people, fans=fans, hot=hot); self.air = Air(seed, wind); self.io = Io(self.w, self.air); self.r = Rover(self.io, NET, home=(-1.5, 9.4)); self.operator = True; self.yes = True; self.say = say; self.n = 0; self.on = {}; self.seen = []; self.max_stop = 0.0
    def at(self, name, do): self.on[name] = do; return self
    def step(self, dt=.02):
        w, r = self.w, self.r; w.step(dt); t = w.t; self.air.step(t, dt, w)
        if self.operator: r.safe.operator(t)
        for m in self.air.m.out: self.io.inbox.append(json.loads(json.dumps(m)))
        self.air.m.out.clear()
        if self.air.fix: self.io.inbox.append(self.air.fix)
        w.probe = (*self.air.real['pos'][:2], .25) if self.air.m.probing and not self.air.real['armed'] else None
        before = r.m.state; r.step(t); self.n += 1
        if r.m.state != before: self.seen.append((round(t, 1), r.m.state)); f = self.on.pop(r.m.state, None); f and f(self)
        for _, m in r.told:
            if 'ask' in m and self.operator and self.yes is not None: r.command(dict(do='approve' if self.yes else 'refuse', who='the operator (simulated)'), t)
        r.told.clear()
    def go(self, limit=1800, until=lambda s: s.r.m.state == 'finished'):
        for _ in range(200): self.step()                                          # four seconds on the ground, so the flight board settles
        if self.air.m.state in ('ready',): self.air.m.start(self.w.t)
        while self.w.t < limit and not until(self): self.step()
        if self.say: self.log()
        return self
    def log(self):
        for t, who, m in sorted([(t, 'rover', m) for t, m in self.r.m.log] + [(t, 'drone', m) for t, m in self.air.m.log]): print(f'{t:7.1f}  {who}  {m}')
    def verdicts(self): return {d['room']: d['verdict'] for d in self.r.m.report()}
    def chances(self): return {d['room']: d['p'] for d in self.r.m.report()}

NET = Net(HERE.parents[1] / 'data' / 'nn.json')

if __name__ == '__main__':
    t = time.time(); s = Run(0, say=True).go(); print(s.verdicts(), s.chances(), 'bumps', s.w.hit, 'drone nearest wall', round(s.air.near, 2), 'real time', round(time.time() - t, 1))
