"""The line to the motor board: the same frames as drive/link.h. COBS, a CRC, a sequence number and a steady heartbeat."""
import struct
DRIVE, STOP, CLEAR, PING, STATUS, NAK = 1, 2, 3, 4, 0x81, 0x82
CLEAR_KEY = 0x444E4F48
STATES = ('parked', 'moving', 'link lost', 'all stop')
FAULTS = ((1, 'no command for 400 ms'), (2, 'all stop is latched'), (4, 'pack voltage is low'), (8, 'speed was limited'), (16, 'bad frames'))
NAKS = {1: 'wrong length', 2: 'unknown message', 3: 'stopped, will not move', 4: 'wrong key', 5: 'not a number'}

def crc16(d):
    c = 0xFFFF
    for b in d:
        c ^= b << 8
        for _ in range(8): c = ((c << 1) ^ 0x1021) & 0xFFFF if c & 0x8000 else (c << 1) & 0xFFFF
    return c

def cobs(d):
    out, run = bytearray([0]), 0; at = 0
    for b in d:
        if b:
            out.append(b); run += 1
            if run == 254: out[at] = 255; at = len(out); out.append(0); run = 0
        else: out[at] = run + 1; at = len(out); out.append(0); run = 0
    out[at] = run + 1; return bytes(out)

def uncobs(d):
    out, i = bytearray(), 0
    while i < len(d):
        n = d[i]
        if n == 0 or i + n > len(d): raise ValueError('torn frame')
        out += d[i + 1:i + n]; i += n
        if n < 255 and i < len(d): out.append(0)
    return bytes(out)

def frame(kind, seq, body=b''):
    d = bytes([kind, seq & 255]) + body
    return cobs(d + struct.pack('<H', crc16(d))) + b'\0'

def unframe(raw):
    d = uncobs(raw)
    if len(d) < 4 or crc16(d[:-2]) != struct.unpack('<H', d[-2:])[0]: raise ValueError('bad check')
    return d[0], d[1], d[2:-2]

class DriveLink:
    """port needs read() -> bytes and write(bytes). Call poll() often. The last wish is repeated every 100 ms; silence is what makes the board stop, so nothing here repeats a wish that has gone stale."""
    def __init__(self, port, stale=.35, every=.1):
        self.port, self.stale, self.every = port, stale, every; self.buf = b''; self.seq = 0; self.status = None; self.status_t = -9.0; self.naks = []; self.bad = 0; self.wish = (0.0, 0.0, 0.0); self.wish_t = -9.0; self.sent_t = -9.0
    def _send(self, kind, body=b''): self.seq = (self.seq + 1) & 255; self.port.write(frame(kind, self.seq, body))
    def drive(self, x, y, w, t): self.wish, self.wish_t = (x, y, w), t; self._push(t)
    def _push(self, t):
        self.sent_t = t; q = [max(-32767, min(32767, round(v * 1000))) for v in self.wish]; self._send(DRIVE, struct.pack('<hhhB', *q, 1))
    def stop(self, why=1): self.wish = (0.0, 0.0, 0.0); self._send(STOP, bytes([why]))
    def clear(self): self._send(CLEAR, struct.pack('<I', CLEAR_KEY))
    def poll(self, t):
        self.buf += self.port.read()
        while b'\0' in self.buf:
            raw, self.buf = self.buf.split(b'\0', 1)
            if not raw: continue
            try: kind, _, body = unframe(raw)
            except ValueError: self.bad += 1; continue
            if kind == STATUS and len(body) == 32:
                st, fl, x, y, w = struct.unpack('<BBhhh', body[:8]); steps = struct.unpack('<4i', body[8:24]); mv, ms, why, bad = struct.unpack('<HIBB', body[24:32])
                self.status = dict(state=STATES[st & 3], faults=[n for b, n in FAULTS if fl & b], v=(x / 1000, y / 1000, w / 1000), steps=steps, volts=mv / 1000, ms=ms, reason=why, bad=bad); self.status_t = t
            elif kind == NAK and len(body) == 2: self.naks.append((body[0], NAKS.get(body[1], '?')))
        if t - self.wish_t <= self.stale and t - self.sent_t >= self.every: self._push(t)
        return self.status
    def alive(self, t): return t - self.status_t < .5
    def still(self): return bool(self.status) and self.status['v'] == (0.0, 0.0, 0.0)
