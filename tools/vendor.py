#!/usr/bin/env python3
"""vendor.py: copy the libraries the site needs into vendor/, so the story never depends on another server.

    python3 tools/vendor.py

Exact versions, the same files the site used to load from jsDelivr. Every import inside them is followed and rewritten to a
local path. Not copied: Transformers.js, WebLLM and their models (hundreds of megabytes; only in optional Advanced exhibits).
"""
import os, posixpath, re, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "vendor")
CDN = "https://cdn.jsdelivr.net"
MAPLIBRE = re.search(r"VERSION = '([\d.]+)'", open(os.path.join(ROOT, "app/workspaces/area/map.js")).read()).group(1)
got, total = {}, 0


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "vendor.py"}), timeout=60) as r:
        return r.read()


def save(rel, data):
    global total
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(data)
    total += len(data)


def addon(path):
    """A three.js addon and the addons it imports."""
    if path in got:
        return
    got[path] = 1
    data = get(f"{CDN}/npm/three@0.180.0/examples/jsm/{path}")
    save(f"three/examples/jsm/{path}", data)
    for m in re.findall(r"""from\s*['"](\.[^'"]+)['"]""", data.decode()):
        addon(posixpath.normpath(posixpath.join(posixpath.dirname(path), m)))


def esm(spec, name):
    """A jsDelivr +esm module and everything it imports, flattened into one folder."""
    if spec in got:
        return got[spec]
    fn = re.sub(r"[^a-z0-9.]+", "-", spec.replace("/npm/", "").replace("/+esm", "").lower()).strip("-") + ".js"
    got[spec] = fn
    text = get(CDN + spec).decode()
    for dep in sorted(set(re.findall(r"""['"](/npm/[^'"]+/\+esm)['"]""", text))):
        text = re.sub(r"""(['"])""" + re.escape(dep) + r"""\1""", '"./' + esm(dep, name) + '"', text)
    text = re.sub(r"\n?//# sourceMappingURL=.*", "", text)
    save(f"{name}/{fn}", text.encode())
    return fn


def main():
    for f in ("three.module.js", "three.core.js"):
        save(f"three/build/{f}", get(f"{CDN}/npm/three@0.180.0/build/{f}"))
    save("three/LICENSE", get(f"{CDN}/npm/three@0.180.0/LICENSE"))
    used = set()
    for top in ("app", "landing", "tests"):
        for d, _, fs in os.walk(os.path.join(ROOT, top)):
            for f in fs:
                if f.endswith((".js", ".html")):
                    used |= set(re.findall(r"three/addons/([\w/.-]+\.js)", open(os.path.join(d, f), errors="ignore").read()))
    used |= set(re.findall(r"three/addons/([\w/.-]+\.js)", open(os.path.join(ROOT, "index.html")).read()))
    for u in sorted(used):
        addon(u)
    print("d3:", esm("/npm/d3@7.9.0/+esm", "d3"))
    print("rapier:", esm("/npm/@dimforge/rapier3d-compat@0.17.3/+esm", "rapier"))
    for f in ("maplibre-gl.js", "maplibre-gl.css"):
        save(f"maplibre/{f}", re.sub(rb"\n?//# sourceMappingURL=.*", b"", get(f"{CDN}/npm/maplibre-gl@{MAPLIBRE}/dist/{f}")))
    for pkg, d in (("d3@7.9.0", "d3"), ("@dimforge/rapier3d-compat@0.17.3", "rapier"), (f"maplibre-gl@{MAPLIBRE}", "maplibre")):
        for lic in ("LICENSE", "LICENSE.txt", "LICENSE.md"):
            try:
                save(f"{d}/LICENSE", get(f"{CDN}/npm/{pkg}/{lic}"))
                break
            except Exception:
                continue
    print(f"{len(used)} addons asked for, {len(got)} modules, {total / 1e6:.1f} MB in vendor/")


if __name__ == "__main__":
    main()
