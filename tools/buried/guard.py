"""guard.py 1|2: draws the missing frames, eight at a time, and never lets Blender fill the memory.
Blender is closed and opened again after every batch (all its memory goes back). If one Blender passes CAP, or the Mac's free memory falls
under FLOOR, it is closed at once and tried again only when there is room. Worker 1 goes forwards, worker 2 backwards and gives way first."""
import subprocess, time, os, sys, re
D = os.path.expanduser('~/Developer/.hound-release/film/buried/'); T = os.path.expanduser('~/.Trash/claims/'); W = int(sys.argv[1]); CAP = 16.0; FLOOR, START = (22, 45) if W == 1 else (30, 55); BATCH = 8
A = ('a', 'fall.blend', 18, 108, ['--spp', '32']); C = ('c', 'fall_c.blend', 0, 105, ['--spp', '24', '--gspp', '5']); B = ('b', 'fall.blend', 258, 417, ['--spp', '24', '--gspp', '5']); SHOTS = (A, C, B) if W == 1 else (B, C)
BL = os.path.expanduser('~/Applications/Blender.app/Contents/MacOS/Blender'); os.makedirs(T, exist_ok=True)
def level(): return int(subprocess.run(['sysctl', '-n', 'kern.memorystatus_level'], capture_output=True, text=True).stdout or 0)          # per cent of memory that is free
def foot(pid):
    try: m = re.fullmatch(r'(\d+(?:\.\d+)?)([KMG])[+-]?', subprocess.run(['top', '-l', '1', '-pid', str(pid), '-stats', 'mem'], capture_output=True, text=True).stdout.strip().splitlines()[-1].strip()); return float(m[1]) * dict(K=1e-6, M=1e-3, G=1)[m[2]] if m else 0.
    except Exception: return 0.
def log(*a): print(time.strftime('%H:%M:%S'), 'w%d' % W, *a, flush=True)
png = lambda s, f: f'{D}r{s}/{f:04d}.png'; cl = lambda s, f: f'{D}r{s}/{f:04d}.claim'
live = lambda s, f: os.path.exists(cl(s, f)) and time.time() - os.path.getmtime(cl(s, f)) < 400
def drop(s, fs):
    for f in fs:
        if os.path.exists(cl(s, f)) and not os.path.exists(png(s, f)): os.replace(cl(s, f), T + f'{s}{f:04d}.claim')
for s, blend, a, b, extra in SHOTS:
    os.makedirs(f'{D}r{s}', exist_ok=True); bad = 0
    while True:
        left = [f for f in range(a, b) if not os.path.exists(png(s, f))]; todo = [f for f in left if not live(s, f)]
        if not left: log('shot', s, 'complete'); break
        if not todo:
            if W == 2: break
            time.sleep(10); continue
        while level() < START: log('waiting for memory, free', level(), '%'); time.sleep(30)
        f0, f1 = (todo[0], min(b, todo[0] + BATCH)) if W == 1 else (max(a, todo[-1] + 1 - BATCH), todo[-1] + 1); drop(s, [f for f in todo if f0 <= f < f1]); t0 = time.time(); peak = 0.; why = ''
        p = subprocess.Popen(['nice', '-n', '5', BL, '-b', blend, '-t', '8', '-P', 'buried.py', '--', 'render', f'{D}r{s}', '--shot', s, '--from', str(f0), '--to', str(f1), '--pct', '75', *extra, *(['--rev'] if W == 2 else [])], cwd=D, stdout=open(f'{D}g{W}_{s}.log', 'a'), stderr=subprocess.STDOUT)
        while p.poll() is None:
            time.sleep(3); m = foot(p.pid); peak = max(peak, m); lv = level()
            if m > CAP or lv < FLOOR: why = f'closed early: Blender {m:.1f} GB, free {lv} %'; p.kill(); p.wait(); break
        mine = [f for f in range(f0, f1) if f in todo]; n = sum(os.path.exists(png(s, f)) for f in mine); drop(s, mine); bad = 0 if n else bad + 1
        log(s, f0, 'to', f1 - 1, n, 'frames', round(time.time() - t0), 's, peak', round(peak, 1), 'GB, free', level(), '%', why)
        if bad > 4: log('five empty batches, stopping'); sys.exit(1)
if W == 1: log('ALL DONE'); open(D + 'full.done', 'w').write(time.ctime())
