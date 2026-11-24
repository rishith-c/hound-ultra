#!/usr/bin/env python3
"""proof.py: run the scripted mission once and keep its readings for the Proof chapter (app/workspaces/fusion/proof.json)."""
import argparse, json, os
import film, shoot

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "workspaces", "fusion", "proof.json")
base = f"http://127.0.0.1:{shoot.serve()}"
proc, prof, page = film.chrome(argparse.Namespace(), (1440, 810, 1))
try:
    page.call("Page.navigate", {"url": base + "/app/?mode=demo&intro=0&paused#/sense"})
    page.wait_event("Page.loadEventFired", 60)
    page.pump(4)
    page.eval("window.__r = null; import('/app/workspaces/fusion/hero.js').then((m) => { const t = performance.now(); return m.record(HOUND.nn).then((r) => { window.__r = JSON.stringify(r); window.__ms = Math.round(performance.now() - t); }); }).catch((e) => { window.__r = 'ERR ' + e; }); 1")
    for _ in range(120):
        page.pump(0.5)
        r = page.eval("window.__r")
        if r:
            break
    assert r and not r.startswith("ERR"), r
    open(OUT, "w").write(r)
    print(len(r), "bytes; the live run took", page.eval("window.__ms"), "ms")
finally:
    proc.terminate()
