#!/usr/bin/env python3
"""Take the real captures the landing page shows in its workspace tour.

    python3 landing/capture.py [--only mission,sense] [--mode demo] [--batch 6] [--settle 9]

Opens the running console in its Demo view, lets the scripted mission play (simulated), walks through every workspace
in MANIFEST (app/shell.js) and saves assets/img/landing/ws-<id>.jpg. A few workspaces share one browser, one browser
at a time. A workspace that is missing or fails to start is skipped; landing/captures.json records what exists and the
page lists only those. Run it again whenever the workspaces change. Needs Pillow and tools/shoot.py.
"""
import argparse, json, os, re, subprocess, sys, tempfile
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument('--only', default='')
ap.add_argument('--mode', default='demo')
ap.add_argument('--batch', type=int, default=6)
ap.add_argument('--settle', type=float, default=9.0)
args = ap.parse_args()

src = open(os.path.join(ROOT, 'app/shell.js'), encoding='utf-8').read()
ids = re.findall(r"\{ id: '([\w-]+)', title: '[^']+', group: '", src)
todo = [s for s in args.only.split(',') if s] or ids
out_json = os.path.join(ROOT, 'landing/captures.json')
caps = json.load(open(out_json)) if os.path.exists(out_json) else {}
png = lambda w: os.path.join(tempfile.gettempdir(), 'hound-ws-%s.png' % w)
CHECK = ("(() => { const r = document.querySelector('#ws-%s'); if (!r || r.hidden) return '%s|no root'; const e = r.querySelector(':scope > .empty h2');"
         " return '%s|' + (e ? 'empty: ' + e.textContent : 'ok ' + HOUND.sim.state.phase + ' ' + Math.round(HOUND.sim.state.t)); })()")
for k in range(0, len(todo), args.batch):
    part = todo[k:k + args.batch]
    cmd = [sys.executable, os.path.join(ROOT, 'tools/shoot.py'), '/app/?mode=%s#/%s' % (args.mode, part[0]), '--w', '1680', '--h', '1000', '--wait', '6',
           '--do', 'eval:(HOUND.sim.setSpeed(32), HOUND.sim.state.running || HOUND.sim.play(), 1)', '--do', 'wait:9', '--do', 'eval:(HOUND.sim.setSpeed(4), 1)']
    for w in part:
        if os.path.exists(png(w)): os.remove(png(w))
        cmd += ['--do', "eval:(location.hash = '#/%s', 1)" % w, '--do', 'wait:%g' % args.settle, '--do', 'eval:' + CHECK % (w, w, w), '--do', 'shot:' + png(w)]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=900).stdout
    errors = re.findall(r'ERRORS (\d+)', res)
    print('batch', ','.join(part), 'errors=%s' % (errors[-1] if errors else '?'), flush=True)
    for e in re.findall(r'^ERR .*', res, re.M)[:6]: print('   ', e[:200])
    for w in part:
        m = re.search(r'EVAL "%s\|([^"]*)"' % w, res); state = m.group(1) if m else 'no answer'
        print('  %-10s %s' % (w, state), flush=True)
        if not state.startswith('ok') or not os.path.exists(png(w)):
            caps.pop(w, None); continue
        im = Image.open(png(w)).convert('RGB'); rel = 'assets/img/landing/ws-%s.jpg' % w
        im.save(os.path.join(ROOT, rel), quality=84, optimize=True, progressive=True)
        caps[w] = {'file': rel, 'w': im.size[0], 'h': im.size[1]}
    json.dump({i: caps[i] for i in ids if i in caps}, open(out_json, 'w'), indent=1)
print('captured', len(caps), 'of', len(ids))
