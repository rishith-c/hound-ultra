#!/usr/bin/env python3
"""release.py: copy the site to a clean folder, so what is deployed is exactly what was checked.

    python3 tools/release.py snapshot            copy the site to ~/Developer/.hound-release/site
    python3 tools/release.py deploy              deploy that folder to the hound-command project (production)

Agents edit the working tree at the same time, so the live site is never deployed from it directly.
"""
import os, shutil, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.expanduser("~/Developer/.hound-release/site")
KEEP = ["app", "assets", "data", "landing", "tests", "vendor", "film", "index.html", "login.html", "manifest.webmanifest", "sw.js", "vercel.json", "README.md"]
SKIP = shutil.ignore_patterns(".DS_Store", "__pycache__", "*.pyc", "*.blend", "*.blend1", "*.py", "brick-raw*", ".vercel")
VERCEL = "/Users/rishith/.nvm/versions/node/v22.16.0/bin/vercel"

def snapshot():
    os.makedirs(OUT, exist_ok=True)
    for k in KEEP:
        src, dst = os.path.join(ROOT, k), os.path.join(OUT, k)
        if not os.path.exists(src):
            continue
        if os.path.isdir(src):
            if os.path.exists(dst):
                shutil.rmtree(dst)
            shutil.copytree(src, dst, ignore=SKIP)
        else:
            shutil.copy2(src, dst)
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs if ".vercel" not in d)
    print(f"{OUT}: {size / 1e6:.1f} MB")

def deploy():
    link = subprocess.run([VERCEL, "link", "--yes", "--project", "hound-command"], cwd=OUT, text=True, capture_output=True)
    print(link.stdout[-400:], link.stderr[-400:])
    r = subprocess.run([VERCEL, "deploy", "--prod", "--yes"], cwd=OUT, text=True, capture_output=True)
    print(r.stdout[-800:], r.stderr[-1500:])
    sys.exit(r.returncode)

{"snapshot": snapshot, "deploy": deploy}[sys.argv[1]]()
