"""The simulated sky: builds sim/fly.cpp (the real flight core inside a rigid body with wind and noisy sensors) and flies it from Python."""
import ctypes as C, hashlib, os, subprocess, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODES = ['on the ground', 'climbing', 'following', 'holding', 'returning', 'landing', 'motors cut']
WHYS = ['', 'finished', 'link lost', 'pack low', 'no position', 'left the fence', 'tipped over', 'gyro lost', 'called home']


def library():
    src = [os.path.join(HERE, 'fly.cpp'), os.path.join(HERE, '..', 'fc', 'flight.h'), os.path.join(HERE, '..', 'fc', 'board.h'), os.path.join(HERE, '..', 'fc', 'link.h')]
    tag = hashlib.sha1(b''.join(open(p, 'rb').read() for p in src)).hexdigest()[:12]
    out = os.path.join(tempfile.gettempdir(), f'hound-fly-{tag}.so')
    if not os.path.exists(out):
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++17', '-O2', '-shared', '-fPIC', '-o', out, src[0]], check=True)
    L = C.CDLL(out); f, i, p = C.c_float, C.c_int, C.c_void_p
    L.sky_new.restype = p; L.sky_new.argtypes = [i]; L.sky_free.argtypes = [p]; L.sky_at.argtypes = [p, f, f, f]; L.sky_wind.argtypes = [p, f, f, f]
    L.sky_set.argtypes = [p, i, f]; L.sky_path.argtypes = [p, C.POINTER(f), C.POINTER(f), i]; L.sky_arm.argtypes = [p]; L.sky_arm.restype = C.c_char_p
    L.sky_bytes.argtypes = [p, C.c_char_p, i]; L.sky_read.argtypes = [p, C.c_char_p, i]; L.sky_home.argtypes = [p]; L.sky_run.argtypes = [p, i]; L.sky_look.argtypes = [p, C.POINTER(f)]
    return L


_L = None


class Sky:
    GPS, LINK, IMU, DEAD, DRAIN, WH, JUMP, RANGE, SAFE, YAW, LAND = range(11)

    def __init__(self, seed=0):
        global _L
        _L = _L or library(); self.p = _L.sky_new(seed)

    def __del__(self):
        if getattr(self, 'p', None): _L.sky_free(self.p)

    def at(self, x, y, z=0): _L.sky_at(self.p, x, y, z)
    def wind(self, x, y, gust=0): _L.sky_wind(self.p, x, y, gust)
    def set(self, what, v): _L.sky_set(self.p, what, float(v))
    def arm(self): return _L.sky_arm(self.p).decode()
    def home(self): _L.sky_home(self.p)
    def run(self, seconds): _L.sky_run(self.p, int(round(seconds * 1000)))

    # the wire, as a port: what a companion computer reads and writes
    def write(self, b): _L.sky_bytes(self.p, bytes(b), len(b))
    def read(self): b = C.create_string_buffer(8192); n = _L.sky_read(self.p, b, 8192); return b.raw[:n]

    def path(self, points, speed=4.0):
        a = np.asarray(points, np.float32).reshape(-1, 3); s = np.broadcast_to(np.asarray(speed, np.float32), (len(a),)).copy()
        _L.sky_path(self.p, a.ctypes.data_as(C.POINTER(C.c_float)), s.ctypes.data_as(C.POINTER(C.c_float)), len(a))

    def look(self):
        o = (C.c_float * 18)(); _L.sky_look(self.p, o); o = list(o)
        return dict(pos=np.array(o[:3]), vel=np.array(o[3:6]), believed=np.array(o[6:9]), mode=MODES[int(o[9])], why=WHYS[int(o[10])], wh=o[11], tilt=o[12], touch=o[13], at=int(o[14]), armed=o[15] > 0, yaw=o[16], t=o[17])

    def until(self, done, limit, every=.1):
        log, t = [], 0.0
        while t < limit:
            self.run(every); t += every; s = self.look(); log.append(s)
            if done(s): break
        return log
