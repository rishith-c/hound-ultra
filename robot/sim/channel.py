"""A small Wi-Fi channel for the simulator: the direct path, echoes off the room, and a body made of points. Everything the radio adds is in here too: gain jumps, noise, lost packets, rounding to whole numbers.
It is not the simulator the network was trained on, so it is a fair, if easy, second test of the code path from packets to an answer."""
import numpy as np
C = 299792458.0
WALL = .6                                                                        # amplitude through one wall: 4.4 dB, between plasterboard and brick (assumed)
SUB = np.array([i for i in range(2, 27)] + [i for i in range(-26, 0)]) * 312500.0 + 2.437e9      # the 51 subcarriers of channel 6, in csi.USED order

class Body:
    """Trunk, head, arms and legs as 14 reflecting points. Walks a circle, or stands and breathes."""
    def __init__(self, x, y, speed=.7, radius=1.1, rate=15, rng=None):
        self.c, self.v, self.r, self.rate = np.array([x, y, 0.0]), speed, radius, rate; rng = rng or np.random.default_rng(1); self.ph = rng.uniform(0, 6.28); self.z = np.array([1.65, 1.45, 1.3, 1.15, 1.0, .9, 1.3, 1.1, 1.3, 1.1, .7, .4, .7, .4]); self.off = rng.normal(0, .08, (14, 2)); self.w = np.array([.5, 1, 1.2, 1.2, 1, .8, .5, .4, .5, .4, .6, .4, .6, .4])
    def at(self, t):
        a = self.ph + self.v / max(self.r, .2) * t; o = np.zeros((14, 3)); o[:, 2] = self.z; o[:, :2] = self.off
        if self.v > 0:
            o[:, 0] += self.r * np.cos(a); o[:, 1] += self.r * np.sin(a); s = .28 * np.sin(2 * np.pi * 1.6 * t)
            o[6:8, 0] += s; o[8:10, 0] -= s; o[10:12, 0] -= s; o[12:14, 0] += s
        else: o[1:5, 0] += .0035 * np.sin(2 * np.pi * self.rate / 60 * t)
        return self.c + o
    def where(self, t): return self.at(t)[:6].mean(0)[:2]

class Fan:
    """A desk fan: the head swings slowly, the blades flicker. Steady for ever, which is what gives it away."""
    def __init__(self, x, y, swing=9.0, hz=13.0): self.c, self.swing, self.hz = np.array([x, y, 1.0]), swing, hz; self.w = np.array([.35])
    def at(self, t): a = .61 * np.sin(2 * np.pi * t / self.swing); return self.c + np.array([[.18 * np.sin(a), .18 * np.cos(a) + .002 * np.sin(2 * np.pi * self.hz * t), 0.0]])

class Channel:
    """The radio's own faults follow the ESP32's: whole numbers of about 30 counts, a gain that steps about once in 20 s, 2 to 15 % of the probes lost, and bursts of loss."""
    def __init__(self, seed=0):
        r = self.rng = np.random.default_rng(seed); self.seq = 0; self.echo = [(r.uniform(.3, 9), r.uniform(.05, 1), r.uniform(0, 6.28)) for _ in range(r.integers(3, 9))]; self.loss = r.uniform(.02, .12); self.level = 30 * r.uniform(.8, 1.3); self.gain = 1.0; self.norm = None; self.burst = -1.0
    def probe(self, t, tx, rx, movers, walls=0, extra=None):
        """One probe from tx to rx ([x, y, z]): 51 amplitudes, or None when it was lost on the air. walls: how many the straight path crosses. extra: for each mover, how many more walls its detour crosses.
        The gain control keeps the level up, so a wall costs signal against noise; a body behind more walls than the straight path costs its own echo."""
        self.seq += 1; r = self.rng
        if r.random() < .0015: self.burst = t + r.uniform(.1, .5)
        if t < self.burst or r.random() < self.loss: return None
        d0 = np.linalg.norm(np.subtract(tx, rx)); k = 2 * np.pi * SUB / C; H = .8 * np.exp(-1j * k * d0)
        for e, a, ph in self.echo: H = H + .5 * a / (1 + e / 3) * np.exp(-1j * (k * (d0 + e) + ph))
        if self.norm is None: self.norm = abs(H).mean()
        for n, m in enumerate(movers):
            q = WALL ** max(0, extra[n]) if extra is not None else 1.0; p = m.at(t); d1, d2 = np.linalg.norm(p - tx, axis=1), np.linalg.norm(p - rx, axis=1); H = H + q * ((m.w * .03 * d0 / np.maximum(d1 * d2, .5))[:, None] * np.exp(-1j * k * (d1 + d2)[:, None])).sum(0)
        if r.random() < .0005: self.gain = float(np.clip(self.gain * r.uniform(.8, 1.25), .6, 1.6))
        z = H / self.norm * self.level * self.gain; s = min(1.5, .15 / WALL ** max(0, walls - 1)); return abs(z + r.normal(0, s, 51) + 1j * r.normal(0, s, 51))
