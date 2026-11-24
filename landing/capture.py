#!/usr/bin/env python3
"""Take the real captures the landing page shows in its workspace tour.

    python3 landing/capture.py [--base http://localhost:4415/] [--only mission,sense]

For every workspace in MANIFEST (app/shell.js) it opens the running console, lets the scripted mission play to about
7 minutes of simulated time so there is something to see, and saves assets/img/landing/ws-<id>.jpg. Workspaces that
are not built or fail to start are skipped. landing/captures.json records what exists; the page reads that file.
Run it again whenever the workspaces change. Needs Pillow and tools/shoot.py (headless Chrome).
"""
import argparse, json, os, re, subprocess, sys, tempfile
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:4415/')
ap.add_argument('--only', default='')
ap.add_argument('--settle', type=float, default=15.0, help='seconds to let the mission play at 32x before the shot')
args = ap.parse_args()

src = open(os.path.join(ROOT, 'app/shell.js'), encoding='utf-8').read()
ids = re.findall(r"\{ id: '([\w-]+)', title: '", src)
only = [s for s in args.only.split(',') if s]
out_json = os.path.join(ROOT, 'landing/captures.json')
caps = json.load(open(out_json)) if os.path.exists(out_json) else {}
os.makedirs(os.path.join(ROOT, 'assets/img/landing'), exist_ok=True)

CHECK = ("(() => { const r = document.querySelector('#ws-%s'); if (!r) return 'no root'; const e = r.querySelector(':scope > .empty h2');"
         " if (e) return 'empty: ' + e.textContent; HOUND.sim.pause(); return 'ok ' + HOUND.sim.state.phase + ' ' + Math.round(HOUND.sim.state.t); })()")
for wid in ids:
    if only and wid not in only: continue
    png = os.path.join(tempfile.gettempdir(), 'hound-ws-%s.png' % wid)
    if os.path.exists(png): os.remove(png)
    cmd = [sys.executable, os.path.join(ROOT, 'tools/shoot.py'), args.base + 'app/#/' + wid, '--w', '1680', '--h', '1000', '--wait', '5',
           '--do', "eval:(HOUND.sim.setSpeed(32), 1)", '--do', 'wait:%g' % args.settle, '--do', 'eval:' + (CHECK % wid), '--do', 'wait:1.2', '--do', 'shot:' + png]
    try: res = subprocess.run(cmd, capture_output=True, text=True, timeout=180).stdout
    except subprocess.TimeoutExpired: res = 'TIMEOUT'
    state = re.findall(r'EVAL "([^"]*)"', res)
    errors = re.findall(r'ERRORS (\d+)', res)
    ok = bool(state) and state[-1].startswith('ok') and os.path.exists(png)
    print('%-10s %-34s errors=%s' % (wid, state[-1] if state else res.strip()[-60:], errors[-1] if errors else '?'), flush=True)
    if not ok:
        caps.pop(wid, None); continue
    im = Image.open(png).convert('RGB')
    rel = 'assets/img/landing/ws-%s.jpg' % wid
    im.save(os.path.join(ROOT, rel), quality=84, optimize=True, progressive=True)
    caps[wid] = {'file': rel, 'w': im.size[0], 'h': im.size[1]}
caps = {k: caps[k] for k in ids if k in caps}
json.dump(caps, open(out_json, 'w'), indent=1)
print('captured', len(caps), 'of', len(ids))
