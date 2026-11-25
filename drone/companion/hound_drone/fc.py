"""The wire to the flight board (drone/fc): the same frames as the rover's drive link, other messages."""
import struct
from hound.link import CLEAR_KEY, frame, unframe

WAYPOINT, ARM, HOME, LAND, HEART, STATE, SAY = 0x11, 0x12, 0x13, 0x14, 0x15, 0x91, 0x92
MODES = ('on the ground', 'climbing', 'following', 'holding', 'returning', 'landing', 'motors cut')
WHYS = ('', 'finished', 'link lost', 'pack low', 'no position', 'left the fence', 'tipped over', 'gyro lost', 'called home')


class FlightLink:
    """port needs read() -> bytes and write(bytes). poll() also keeps the heartbeat going: silence makes the drone hold, then come home."""

    def __init__(self, port):
        self.port, self.buf, self.seq, self.path_id = port, b'', 0, 0
        self.state, self.said, self.beat, self.bad = None, [], -9.0, 0

    def _send(self, kind, body=b''):
        self.seq = (self.seq + 1) & 255
        self.port.write(frame(kind, self.seq, body))

    def path(self, points, speed):
        if not 1 <= len(points) <= 64: raise ValueError('1 to 64 points')
        self.path_id = (self.path_id + 1) & 255
        for i, (x, y, z) in enumerate(points): self._send(WAYPOINT, struct.pack('<BBBffff', self.path_id, i, len(points), x, y, z, speed))

    def arm(self): self._send(ARM, struct.pack('<I', CLEAR_KEY))
    def home(self): self._send(HOME)
    def land(self, z): self._send(LAND, struct.pack('<f', z))

    def poll(self, t):
        if t - self.beat > .2: self.beat = t; self._send(HEART)
        self.buf += self.port.read()
        while b'\0' in self.buf:
            raw, self.buf = self.buf.split(b'\0', 1)
            if not raw: continue
            try: kind, _, b = unframe(raw)
            except ValueError: self.bad += 1; continue
            if kind == SAY: self.said.append(b.decode('ascii', 'replace'))
            elif kind == STATE and len(b) == 34:
                ms, mode, why, at, armed, x, y, z, vx, vy, vz, yaw, wh, w, age = struct.unpack('<IBBBBfffhhhhHhH', b)
                if mode < len(MODES) and why < len(WHYS): self.state = dict(t=t, ms=ms, mode=MODES[mode], why=WHYS[why], at=at, armed=bool(armed), pos=(x, y, z), vel=(vx / 100, vy / 100, vz / 100), yaw=yaw / 1000, wh=wh / 100, watts=w, fix_age=age / 1000)
        return self.state
