"""On the Pi:  HOUND_KEY=... python3 -m hound.main /dev/ttyACM0      Reads the real sensors. A sensor that is not fitted, or that stops, makes its answers BLIND; it never makes them 'no one'."""
import json
import os
import socket
import sys
import termios
import time
from pathlib import Path
import numpy as np
from .net import Net
from .rover import Rover
from .server import Door, serve

class Tty:
    def __init__(self, path, baud):
        self.fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK); a = termios.tcgetattr(self.fd); sp = getattr(termios, f'B{baud}'); a[0] = a[1] = a[3] = 0; a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL; a[4] = a[5] = sp; a[6][termios.VMIN] = a[6][termios.VTIME] = 0; termios.tcsetattr(self.fd, termios.TCSANOW, a)
    def read(self):
        try: return os.read(self.fd, 4096)
        except BlockingIOError: return b''
    def write(self, d):
        try: os.write(self.fd, d)
        except BlockingIOError: pass                                                # full line: this frame is dropped, and the board's own watchdog covers the rest

class Nothing:
    def read(self): return b''
    def write(self, d): pass

def optional(make):
    try: return make()
    except (OSError, ImportError, ValueError, AttributeError) as e: print('not fitted:', e); return None

class Io:
    def __init__(self, drive):
        self.drive = Tty(drive, 115200); self.r1 = optional(lambda: Tty('/dev/serial0', 256000)) or Nothing(); self.r2 = optional(lambda: Tty('/dev/hound-2410', 256000)) or Nothing()
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); self.sock.bind(('0.0.0.0', 5005)); self.sock.setblocking(False); self.air = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); self.air.bind(('0.0.0.0', 5006)); self.air.setblocking(False); self.drone_at = None; self.mlx = optional(self._mlx); self.tof = optional(self._tof); self.heat_t = 0.0; self.r = (None, None, None)
    @staticmethod
    def _mlx(): import adafruit_mlx90640 as m, board; c = m.MLX90640(board.I2C()); c.refresh_rate = m.RefreshRate.REFRESH_4_HZ; return c
    @staticmethod
    def _tof(): import adafruit_vl53l1x as v, board; b = board.I2C(); return [v.VL53L1X(b, a) for a in (0x29, 0x30)]
    def _many(self, s, n=64):
        o = []
        while len(o) < n:
            try: o.append(s.recvfrom(65000))
            except BlockingIOError: break
        return o
    def udp(self): return [d for d, _ in self._many(self.sock)]
    def uart2450(self): return self.r1.read()
    def uart2410(self): return self.r2.read()
    def heat(self):
        if not self.mlx or time.monotonic() - self.heat_t < .25: return None
        self.heat_t = time.monotonic(); f = [0.0] * 768
        try: self.mlx.getFrame(f); return np.array(f).reshape(24, 32)
        except (RuntimeError, ValueError, OSError): return None
    def ranges(self):
        try:
            if self.tof and all(x.data_ready for x in self.tof): self.r = tuple((x.distance or 400) / 100 for x in self.tof) + (time.monotonic(),)
        except OSError: pass
        return self.r
    def tilt(self): return 0.0                                                     # no tilt sensor on the rover today
    def drone_in(self):
        o = []
        for d, at in self._many(self.air):
            try: o.append(json.loads(d)); self.drone_at = at
            except ValueError: pass
        return o
    def drone_out(self, m):
        if self.drone_at: self.air.sendto(json.dumps(m, default=float).encode(), self.drone_at)

def main():
    io = Io(sys.argv[1] if len(sys.argv) > 1 else '/dev/ttyACM0'); r = Rover(io, Net(Path(__file__).resolve().parents[3] / 'data' / 'nn.json')); door = Door(os.environ.get('HOUND_KEY', '')); serve(door); n = 0
    while True:
        t = time.monotonic()
        while not door.inbox.empty(): r.command(door.inbox.get_nowait(), t)
        r.step(t); n += 1
        if n % 10 == 0: door.publish(r.snapshot(t))
        time.sleep(max(0.0, .02 - (time.monotonic() - t)))

if __name__ == '__main__': main()
