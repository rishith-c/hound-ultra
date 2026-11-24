#!/usr/bin/env python3
"""tour.py: visit every workspace in one page, the way a judge would, and report what went wrong.

    python3 tools/tour.py [--mode demo|advanced] [--ids area,mission] [--w 1680] [--h 1000] [--dwell 7] [--out DIR] [--fresh]

For each workspace: errors, frame rate, WebGL contexts alive and lost, memory, words on screen, and a screenshot.
--fresh opens each workspace in a new page instead (finds what only breaks on a cold start).
With PIL installed it also writes contact sheets (sheet0.png ...).
"""
import argparse, json, os, shutil, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shoot

IDS = "area mission sense radio aerial scan swarm structure horizon report triage fusion signals deepscan vision strategy timelines forge graph globe train copilot status".split()
HOOK = """(() => { const st = window.__gl = { made: 0, lost: 0, live: new Set() };
  const g = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...a) { const c = g.call(this, t, ...a);
    if (c && /^webgl|webgpu/.test(t) && !this.__seen) { this.__seen = 1; st.made++; st.live.add(this);
      this.addEventListener('webglcontextlost', () => { st.lost++; st.live.delete(this); }); } return c; }; })();"""
STATE = """(() => { const r = document.querySelector('.ws:not([hidden])'); const vis = (e) => { const b = e.getBoundingClientRect(); const c = getComputedStyle(e); return b.width > 0 && b.height > 0 && c.visibility !== 'hidden' && +c.opacity > 0.05; };
  let words = 0; if (r) { const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const t = w.currentNode.textContent.trim(); if (t && vis(w.currentNode.parentElement)) words += t.split(/\\s+/).length; } }
  const over = r ? [...r.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent.trim() && vis(e) && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== 'visible' && e.clientWidth > 0).length : 0;
  return { id: r && r.dataset.ws, words, clipped: over, gl: window.__gl.made, lost: window.__gl.lost, live: [...window.__gl.live].filter((c) => c.isConnected).length, heap: Math.round((performance.memory || {}).usedJSHeapSize / 1e6) }; })()"""


def browser(a):
    prof = tempfile.mkdtemp(prefix="hound-tour-")
    proc = subprocess.Popen([shoot.CHROME, "--headless=new", "--remote-debugging-port=0", f"--user-data-dir={prof}", f"--window-size={a.w},{a.h}", "--hide-scrollbars",
                             "--no-first-run", "--mute-audio", "--disable-extensions", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
                             "--disable-backgrounding-occluded-windows", "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                             "--enable-precise-memory-info", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    pf = os.path.join(prof, "DevToolsActivePort")
    for _ in range(300):
        if os.path.exists(pf) and open(pf).read().strip():
            break
        time.sleep(0.1)
    port = open(pf).read().split("\n")[0].strip()
    t = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
    page = shoot.Page(shoot.WS(next(x for x in t if x["type"] == "page")["webSocketDebuggerUrl"]))
    for m in ("Page.enable", "Runtime.enable", "Log.enable"):
        page.call(m)
    page.call("Page.addScriptToEvaluateOnNewDocument", {"source": HOOK})
    page.call("Emulation.setDeviceMetricsOverride", {"width": a.w, "height": a.h, "deviceScaleFactor": 1, "mobile": False})
    return proc, prof, page


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="demo")
    ap.add_argument("--ids")
    ap.add_argument("--w", type=int, default=1680)
    ap.add_argument("--h", type=int, default=1000)
    ap.add_argument("--dwell", type=float, default=7)
    ap.add_argument("--out", default="/tmp/hound-tour")
    ap.add_argument("--fresh", action="store_true")
    a = ap.parse_args()
    ids = a.ids.split(",") if a.ids else IDS
    os.makedirs(a.out, exist_ok=True)
    port = shoot.serve()
    base = f"http://127.0.0.1:{port}/app/?mode={a.mode}"
    lock = shoot.slot()
    proc, prof, page = browser(a)
    rows = []
    try:
        for n, i in enumerate(ids):
            before = len(page.errors)
            t0 = time.time()
            if a.fresh or n == 0:
                page.events.clear()
                page.call("Page.navigate", {"url": f"{base}&v={n}#/{i}"})
                page.wait_event("Page.loadEventFired", 30)
            else:
                page.eval(f"HOUND.shell.open('{i}')")
            page.pump(a.dwell)
            try:
                fps = page.eval(f"{shoot.FPS_JS}(2)") or {}
                st = page.eval(STATE) or {}
                f = os.path.join(a.out, f"{i}-{a.mode}.png")
                data = page.call("Page.captureScreenshot", {"format": "png"}, timeout=40)["data"]
                import base64
                open(f, "wb").write(base64.b64decode(data))
            except Exception as e:  # a hung page: note it, start a new browser
                print(f"{i:10s} HUNG {type(e).__name__}")
                proc.kill()
                proc, prof, page = browser(a)
                rows.append((i, "hung"))
                page.call("Page.navigate", {"url": f"{base}&v={n}r#/{i}"}) if False else None
                a.fresh = True
                continue
            errs = page.errors[before:]
            rows.append((i, len(errs)))
            print(f"{i:10s} fps {fps.get('fps')!s:5} slow5% {fps.get('slowest5pct_ms')!s:6} worst {fps.get('worst_ms')!s:6} words {st.get('words')!s:5} clipped {st.get('clipped')!s:3} "
                  f"webgl made {st.get('gl')} live {st.get('live')} lost {st.get('lost')} heap {st.get('heap')} MB  errors {len(errs)}")
            for e in errs[:3]:
                print("      ", e[:200])
            sys.stdout.flush()
    finally:
        proc.terminate()
        shutil.rmtree(prof, ignore_errors=True)
    try:
        from PIL import Image
        W, H = 840, 500
        for k in range(0, len(ids), 6):
            part = ids[k:k + 6]
            im = Image.new("RGB", (W * 2, H * ((len(part) + 1) // 2)))
            for j, i in enumerate(part):
                f = os.path.join(a.out, f"{i}-{a.mode}.png")
                if os.path.exists(f):
                    im.paste(Image.open(f).convert("RGB").resize((W - 6, H - 6), Image.LANCZOS), ((j % 2) * W, (j // 2) * H))
            im.save(os.path.join(a.out, f"sheet{k // 6}-{a.mode}.png"))
    except ImportError:
        pass
    del lock


main()
