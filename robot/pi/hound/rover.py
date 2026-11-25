"""The rover as one object: every sensor in, one safe wish out, fifty times a second. The same loop runs on the Pi (main.py) and in the simulator (sim/)."""
from . import radar
from .csi import Receiver
from .link import DriveLink
from .mission import Mission
from .safety import Safety

class Rover:
    """io gives: drive (read/write), udp() -> packets, uart2450() -> bytes, uart2410() -> bytes, heat() -> 24x32 or None, ranges() -> (front, rear, when), tilt() -> radians, and the drone link: drone_in() -> dicts, drone_out(dict)."""
    def __init__(self, io, net, home=(0.0, 0.0)):
        self.io = io; self.rx = Receiver(); self.link = DriveLink(io.drive); self.safe = Safety(); self.m = Mission(net, self.rx, home); self.r2450, self.r2410 = radar.Tracker2450(), radar.Range2410(); self.mode, self.stick, self.stick_t = 'search', (0.0, 0.0, 0.0), -9.0; self.probing = False; self.drone_t = -9.0; self.told = []; self.low = False; self.told_t = -9.0
    def command(self, c, t):
        self.safe.operator(t); k = c['do']
        if k == 'stop': self.safe.all_stop('by ' + c['who']); self.link.stop()
        elif k == 'clear': self.safe.release(); self.link.clear()
        elif k == 'drive': self.mode, self.stick, self.stick_t = 'drive', c['v'], t
        elif k == 'search': self.mode = 'search'
        elif k in ('approve', 'refuse'): return self.m.approve(t, k == 'approve', c['who'])
        elif k == 'hold': self.m.hold(t, 'asked by ' + c['who'])
        elif k == 'resume': self.m.resume(t)
        return True
    def step(self, t):
        st = self.link.poll(t); alive = self.link.alive(t); still = alive and self.link.still()
        for p in self.io.udp(): self.rx.feed(p, t)
        targets = self.r2450.feed(self.io.uart2450(), t); r2410 = self.r2410.feed(self.io.uart2410(), t); fix = None
        for d in self.io.drone_in():
            self.drone_t = t
            if d.get('kind') == 'map': self.m.map(t, d)
            elif d.get('kind') == 'probing': self.probing = bool(d['on'])
            elif d.get('kind') == 'no spot': self.m.no_spot(t)
            elif d.get('kind') == 'fix': fix = (d['x'], d['y'], d.get('h'))
        want = self.m.step(t, dict(steps=st['steps'] if st else None, fix=fix, still=still, probing=self.probing, targets=targets if t - self.r2450.t < .3 else None, r2410=r2410 if t - self.r2410.t < .5 else None, heat=self.io.heat()))
        if self.mode == 'drive': want = self.stick if t - self.stick_t < .5 else (0.0, 0.0, 0.0)
        lost = t - self.safe.operator_t > 1.0
        if lost and self.m.state not in ('hold', 'finished', 'ask', 'wait for the map'): self.m.hold(t, 'no operator for a second')
        elif not lost and self.m.state == 'hold' and self.m.log[-1][1] == 'holding: no operator for a second': self.m.resume(t)
        volts = st['volts'] if st else 0.0
        if 1 < volts < 10.5 and not self.low: self.low = True; self.m.hold(t, f'pack at {volts:.1f} V')
        if t - self.told_t > 1: self.told_t = t; self.io.drone_out(dict(do='at', x=self.m.pose.x, y=self.m.pose.y))
        f, b, when = self.io.ranges(); go = self.safe.allow(want, t, f, b, when, volts, self.io.tilt(), alive); self.link.drive(*go, t)
        for m in self.m.out:
            if m.get('to') == 'drone': self.io.drone_out(m)
            else: self.told.append((t, m))
        self.m.out.clear(); return go
    def snapshot(self, t):
        p = self.m.pose; st = self.link.status or {}; r = self.m.room or {}
        return dict(t=round(t, 2), state=self.m.state, pose=[round(p.x, 3), round(p.y, 3), round(p.h, 3)], spread=round(p.var ** .5, 3), drive=st.get('state'), faults=st.get('faults', []), volts=st.get('volts'), why=self.safe.why, room=r.get('id'), chance=round(r['p'], 3) if 'p' in r else None, log=self.m.log[-8:], report=self.m.report())
