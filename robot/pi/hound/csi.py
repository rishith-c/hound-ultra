"""From probe packets to the network's picture.

A window is 52 rows by 200 columns: 10 seconds in bins of 50 ms, 51 Wi-Fi subcarriers and one row for how much the packets inside a bin disagree (movement).
The receiver says BLIND when the window is not good enough. Blind is not the same as empty, and is never used as one."""
import struct
from collections import deque
import numpy as np

HEAD = struct.Struct('<2sBBIIbbBB')
PAIRS = 64
USED = np.array([i for i in range(2, 27)] + [i for i in range(38, 64)])      # the LLTF data subcarriers +2..+26 and -26..-1, in the radio's own order; +1 is left out because the radio may mark it invalid
SECONDS, BINS = 10.0, 200
MIN_RATE, MAX_HOLES, MIN_LEVEL, AGC_JUMP = 40.0, .35, 2.0, .04

def parse(d):
    """One UDP packet -> dict, or None when it is not one of ours."""
    if len(d) < HEAD.size: return None
    tag, ver, unit, seq, us, rssi, noise, flags, n = HEAD.unpack_from(d)
    if tag != b'HC' or ver != 2 or n != PAIRS or len(d) != HEAD.size + 2 * n: return None
    iq = np.frombuffer(d, np.int8, 2 * n, HEAD.size).reshape(n, 2).astype(np.float32)
    return dict(unit=unit, seq=seq, us=us, rssi=rssi, noise=noise, amp=np.hypot(iq[:, 0], iq[:, 1])[USED])

def packet(amp51, seq, us, unit=1, rssi=-50, noise=-95, rng=None):
    """The other way round, for the simulator: amplitudes -> the bytes the listener would send."""
    iq = np.zeros((PAIRS, 2), np.int8); ph = np.zeros(51) if rng is None else rng.uniform(0, 2 * np.pi) + np.linspace(0, 1.5, 51)
    iq[USED, 0] = np.clip(np.round(amp51 * np.sin(ph)), -127, 127); iq[USED, 1] = np.clip(np.round(amp51 * np.cos(ph)), -127, 127)
    return HEAD.pack(b'HC', 2, unit, seq & 0xFFFFFFFF, int(us) & 0xFFFFFFFF, rssi, noise, 0, PAIRS) + iq.tobytes()

def level(t, a):
    """Take out the receiver's own gain jumps. A body changes the shared level smoothly; the automatic gain jumps between one packet and the next. Only jumps are removed, or the person would go with them."""
    o = np.argsort(t, kind='stable'); t, a = t[o], a[o]; g = np.log(np.maximum(a.mean(1), 1e-6)); d = np.diff(g, prepend=g[0])
    return t, a / np.exp(np.cumsum(np.where(np.abs(d) > AGC_JUMP, d, 0)))[:, None]

def window(t, a, end, seconds=SECONDS, bins=BINS):
    """(52, bins) and the share of bins with no packet in them."""
    t, a = level(np.asarray(t, float), np.asarray(a, float)); k = np.floor((t - end + seconds) * bins / seconds).astype(int); ok = (k >= 0) & (k < bins); k, a = k[ok], a[ok]
    if not len(k): return None, 1.0
    n = np.bincount(k, minlength=bins); have = n > 0; holes = 1 - have.mean()
    if holes > MAX_HOLES: return None, holes
    add = lambda v: np.stack([np.bincount(k, v[:, j], bins) for j in range(v.shape[1])], 1)
    c = np.maximum(n, 1)[:, None]; rel = a / np.maximum(a.mean(0), 1e-6); mean = add(a) / c; m1 = add(rel) / c; m2 = add(rel * rel) / c
    move = 100 * np.sqrt(np.maximum(m2 - m1 * m1, 0) * c / np.maximum(c - 1, 1)).mean(1) * (n > 1)
    last = np.maximum.accumulate(np.where(have, np.arange(bins), -1)); last[last < 0] = np.argmax(have)      # an empty bin holds the value before it
    return np.vstack([mean[last].T, move[last][None]]).astype(np.float32), holes

def normalise(w):
    """Each subcarrier as a percent change from its own mean, and the movement row less the receiver's own 1 %."""
    a = w[:51]; a = 100 * (a / np.maximum(a.mean(1, keepdims=True), 1e-6) - 1)
    return np.vstack([np.clip(a, -50, 50), np.clip(w[51:] - 1, -5, 50)]).astype(np.float32)

class Receiver:
    def __init__(self, keep=12.0): self.keep = keep; self.q = deque(); self.lost = self.alien = 0; self.last = None; self.unit = None
    def clear(self): self.q.clear(); self.last = None
    def feed(self, d, t):
        p = parse(d)
        if p is None: self.alien += 1; return False
        if self.unit is not None and p['unit'] != self.unit: self.clear()      # another probe is another path through the room: start again
        self.unit = p['unit']
        if self.last is not None and 0 < p['seq'] - self.last < 1000: self.lost += p['seq'] - self.last - 1
        self.last = p['seq']; self.q.append((t, p['amp'], p['rssi']))
        while self.q and self.q[0][0] < t - self.keep: self.q.popleft()
        return True
    def look(self, end):
        """(picture or None, why). why is in plain words, for the operator."""
        q = [x for x in self.q if end - SECONDS <= x[0] <= end]
        if not q: return None, 'no probe heard'
        if end - q[-1][0] > .5: return None, 'the probe went silent'
        if q[-1][0] - q[0][0] < SECONDS * .9: return None, 'still filling the ten seconds'
        rate = len(q) / SECONDS
        if rate < MIN_RATE: return None, f'only {rate:.0f} probes a second'
        a = np.array([x[1] for x in q])
        if not np.isfinite(a).all() or a.mean() < MIN_LEVEL: return None, 'the signal is too weak'
        w, holes = window([x[0] for x in q], a, end)
        if w is None: return None, f'{100 * holes:.0f} % of the window is missing'
        return normalise(w), f'{rate:.0f} probes a second'
