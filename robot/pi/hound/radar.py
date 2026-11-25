"""The two radars. An HLK-LD2450 says where a moving person is. Two HLK-LD2410C say how far away something moves or breathes, never in which direction.
Both are believed only while the rover stands still: a radar on a moving rover sees the whole room move."""
import math
import struct

class Frames:
    """Cuts a byte stream into frames between a head and a tail, and throws away anything else."""
    def __init__(self, head, tail, size=None, limit=256): self.head, self.tail, self.size, self.limit, self.buf, self.dropped = head, tail, size, limit, b'', 0
    def feed(self, d):
        self.buf += d; out = []
        while True:
            i = self.buf.find(self.head)
            if i < 0: self.dropped += max(0, len(self.buf) - len(self.head) + 1); self.buf = self.buf[-(len(self.head) - 1):]; return out
            if i: self.dropped += i; self.buf = self.buf[i:]
            j = self.size - len(self.tail) if self.size else self.buf.find(self.tail, len(self.head))
            if j < 0 or len(self.buf) < j + len(self.tail):
                if len(self.buf) > self.limit: self.buf = self.buf[len(self.head):]; continue
                return out
            if self.buf[j:j + len(self.tail)] != self.tail: self.buf = self.buf[1:]; self.dropped += 1; continue
            out.append(self.buf[:j + len(self.tail)]); self.buf = self.buf[j + len(self.tail):]

def sign15(v): return v & 0x7FFF if v & 0x8000 else -(v & 0x7FFF)              # this radar's own way of writing a signed number

class Tracker2450:
    """Three targets at most: metres to the right, metres ahead, metres a second away."""
    def __init__(self): self.f = Frames(b'\xaa\xff\x03\x00', b'\x55\xcc', size=30); self.targets = []; self.t = -9.0
    def feed(self, d, t):
        for m in self.f.feed(d):
            o = []
            for i in range(3):
                x, y, v, res = struct.unpack_from('<4H', m, 4 + 8 * i)
                if x or y: o.append(dict(x=sign15(x) / 1000, y=sign15(y) / 1000, v=sign15(v) / 100, res=res / 1000))
            self.targets, self.t = o, t
        return self.targets

def report2450(targets):
    """What the radar would send, for the simulator."""
    q = lambda v, s: (lambda n: (n | 0x8000) if n >= 0 and v >= 0 else (abs(n) & 0x7FFF))(int(round(v * s)))
    b = b''.join(struct.pack('<4H', q(x, 1000), q(y, 1000), q(v, 100), 360) for x, y, v in targets[:3]); return b'\xaa\xff\x03\x00' + b.ljust(24, b'\0') + b'\x55\xcc'

class Range2410:
    def __init__(self): self.f = Frames(b'\xf4\xf3\xf2\xf1', b'\xf8\xf7\xf6\xf5'); self.last = None; self.t = -9.0
    def feed(self, d, t):
        for m in self.f.feed(d):
            n = struct.unpack_from('<H', m, 4)[0]
            if len(m) != 10 + n or n < 13 or m[6] != 2 or m[7] != 0xAA: continue      # only the basic report
            st, md, me, sd, se, dd = struct.unpack_from('<BHBHBH', m, 8)
            self.last = dict(moving=bool(st & 1), still=bool(st & 2), moving_m=md / 100, moving_e=me, still_m=sd / 100, still_e=se, dist=dd / 100); self.t = t
        return self.last

def report2410(moving=None, still=None):
    b = struct.pack('<BB', 2, 0xAA) + struct.pack('<BHBHBH', (1 if moving else 0) | (2 if still else 0), int((moving or 0) * 100), 60 if moving else 0, int((still or 0) * 100), 50 if still else 0, int((moving or still or 0) * 100)) + b'\x55\0'
    return b'\xf4\xf3\xf2\xf1' + struct.pack('<H', len(b)) + b + b'\xf8\xf7\xf6\xf5'

class Judge:
    """Says what the radars saw over one listening stop. A target must hold for half a second and stay in one place, or a single flicker would count as a person."""
    def __init__(self, hold=.5, gate=.6): self.hold, self.gate = hold, gate; self.reset()
    def reset(self): self.tracks = []; self.frames = 0; self.micro = 0; self.n2410 = 0
    def add(self, targets, t, still):
        if not still: return
        self.frames += 1
        for g in targets:
            if abs(g['v']) < .04: continue
            near = min(self.tracks, key=lambda k: math.hypot(k['x'] - g['x'], k['y'] - g['y']), default=None)
            if near and math.hypot(near['x'] - g['x'], near['y'] - g['y']) < self.gate and t - near['t1'] < .7: near.update(x=g['x'], y=g['y'], t1=t, n=near['n'] + 1); near['v'].append(g['v'])
            else: self.tracks.append(dict(x=g['x'], y=g['y'], t0=t, t1=t, n=1, v=[g['v']]))
    def add2410(self, r, still):
        if still and r: self.n2410 += 1; self.micro += bool(r['still'])
    def says(self):
        if self.frames < 10: return 'blind', None, 'too few radar frames'
        real = [k for k in self.tracks if k['t1'] - k['t0'] >= self.hold and k['n'] >= 4]
        if real:
            k = max(real, key=lambda k: k['t1'] - k['t0']); v = k['v']; mean = sum(v) / len(v); sd = (sum((a - mean) ** 2 for a in v) / len(v)) ** .5
            if len(v) > 12 and abs(mean) > .1 and sd < .02: return 'machine', k, 'a perfectly steady motion, like a machine'
            return 'pos', k, f"a moving target {math.hypot(k['x'], k['y']):.1f} m away"
        return 'neg', None, 'nothing moved'
    def breath(self): return ('pos' if self.micro / self.n2410 > .6 else 'neg') if self.n2410 >= 20 else 'blind'
