#!/usr/bin/env python3
"""film.py: record shots of the running site frame by frame, so the video is smooth whatever this computer is doing.

    python3 tools/film.py SHOTS.json [--only name,name] [--w 1920] [--h 1080] [--dpr 1] [--fps 60] [--out DIR]

The page's clock is replaced: after a shot has settled, time only moves when a frame has been saved. requestAnimationFrame,
timers, performance.now, Date and CSS / Web animations all follow that clock. Each shot becomes one H.264 file.
A shot: {"name", "url", "settle": s, "before": "js", "seconds": s, "do": [[t, "js"], ...], "hide": "css"}
"""
import argparse, base64, json, os, shutil, subprocess, sys, tempfile, time, urllib.request
import shoot

CLOCK = r"""(() => {
  const now0 = performance.now.bind(performance), raf0 = window.requestAnimationFrame.bind(window), st0 = window.setTimeout.bind(window), D = Date;
  const date0 = D.now() - now0(); let vt = null, id = 1, rafs = new Map(), timers = new Map(), seen = new Map();
  const T = () => (vt === null ? now0() : vt);
  performance.now = T;
  window.Date = class extends D { constructor(...a) { if (a.length) super(...a); else super(date0 + T()); } static now() { return Math.floor(date0 + T()); } };
  window.requestAnimationFrame = (f) => { rafs.set(++id, f); return id; };
  window.cancelAnimationFrame = (i) => rafs.delete(i);
  const add = (f, ms, rep, a) => { const g = typeof f === 'function' ? f : () => (0, eval)(f); timers.set(++id, { f: g, at: T() + Math.max(rep ? 4 : 0, +ms || 0), every: rep ? Math.max(4, +ms || 0) : 0, a }); return id; };
  window.setTimeout = (f, ms, ...a) => add(f, ms, false, a); window.setInterval = (f, ms, ...a) => add(f, ms, true, a);
  window.clearTimeout = window.clearInterval = (i) => timers.delete(i);
  window.requestIdleCallback = (f) => window.setTimeout(() => f({ didTimeout: false, timeRemaining: () => 8 }), 1); window.cancelIdleCallback = window.clearTimeout;
  const err = (e) => console.error(e && e.stack || e);
  function due() { for (let n = 0; n < 5000; n++) { let best = null, k = 0; const t = T(); for (const [i, x] of timers) if (x.at <= t && (!best || x.at < best.at)) { best = x; k = i; } if (!best) return; if (best.every) best.at = Math.max(best.at + best.every, t - best.every * 3); else timers.delete(k); try { best.f(...best.a); } catch (e) { err(e); } } }
  function frames() { const q = rafs; rafs = new Map(); const t = T(); for (const f of q.values()) { try { f(t); } catch (e) { err(e); } } }
  (function pumpR() { if (vt === null) { due(); frames(); } raf0(pumpR); })();
  (function pumpT() { if (vt === null) due(); st0(pumpT, 4); })();
  function animations() { for (const a of document.getAnimations()) { let s = seen.get(a); if (s === undefined) { try { const c = a.currentTime || 0; a.pause(); s = { at: vt, c, r: a.playbackRate || 1 }; seen.set(a, s); } catch (e) { continue; } }
      if (a.playState === 'running') { try { a.pause(); } catch (e) { /* finished */ } }
      const want = s.c + (vt - s.at) * s.r, end = a.effect && a.effect.getComputedTiming().endTime; try { if (isFinite(end) && want >= end) { seen.delete(a); a.finish(); } else a.currentTime = want; } catch (e) { /* removed */ } } }
  window.__film = { freeze() { vt = now0(); animations(); return vt; }, step(ms) { vt += ms; due(); frames(); animations(); return vt; } };
})();"""


def chrome(a):
    prof = tempfile.mkdtemp(prefix="hound-film-")
    proc = subprocess.Popen([shoot.CHROME, "--headless=new", "--remote-debugging-port=0", f"--user-data-dir={prof}", f"--window-size={a.w},{a.h}", "--hide-scrollbars", "--no-first-run",
                             "--mute-audio", "--disable-extensions", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
                             "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-angle=metal", "--enable-gpu",
                             "--ignore-gpu-blocklist", "--force-color-profile=srgb", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
    page.call("Page.addScriptToEvaluateOnNewDocument", {"source": CLOCK})
    page.call("Emulation.setDeviceMetricsOverride", {"width": a.w, "height": a.h, "deviceScaleFactor": a.dpr, "mobile": False})
    return proc, prof, page


def record(a, shot, base):
    proc, prof, page = chrome(a)
    out = os.path.join(a.out, shot["name"] + ".mp4")
    n = int(round(shot["seconds"] * a.fps))
    t0 = time.time()
    try:
        page.call("Page.navigate", {"url": base + shot["url"]})
        page.wait_event("Page.loadEventFired", 60)
        page.pump(shot.get("settle", 4))
        if shot.get("hide"):
            page.eval("(() => { const s = document.createElement('style'); s.textContent = " + json.dumps(shot["hide"]) + "; document.head.append(s); return 1; })()")
        if shot.get("before"):
            r = page.eval(shot["before"])
            if isinstance(r, dict) and "__error__" in r:
                print("  before:", r["__error__"][:300])
        page.pump(shot.get("after", 0.2))
        todo = sorted(shot.get("do", []), key=lambda x: x[0])
        enc = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(a.fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "12",
                                "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", out], stdin=subprocess.PIPE)
        page.eval("__film.freeze()")
        for k in range(n):
            t = k / a.fps
            while todo and todo[0][0] <= t + 1e-6:
                r = page.eval(todo.pop(0)[1])
                if isinstance(r, dict) and "__error__" in r:
                    print("  do:", r["__error__"][:300])
            page.call("Runtime.evaluate", {"expression": f"__film.step({1000 / a.fps})"}, timeout=120)
            data = page.call("Page.captureScreenshot", {"format": "jpeg", "quality": 96, "optimizeForSpeed": True}, timeout=120)["data"]
            enc.stdin.write(base64.b64decode(data))
        enc.stdin.close()
        enc.wait()
        print(f"{shot['name']:14s} {n} frames in {time.time() - t0:.0f} s, errors {len(page.errors)}", page.errors[:2], flush=True)
    finally:
        proc.terminate()
        shutil.rmtree(prof, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("shots")
    ap.add_argument("--only")
    ap.add_argument("--w", type=int, default=1920)
    ap.add_argument("--h", type=int, default=1080)
    ap.add_argument("--dpr", type=float, default=1)
    ap.add_argument("--fps", type=int, default=60)
    ap.add_argument("--out", default=os.path.expanduser("~/Developer/.hound-release/film"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    site = os.path.expanduser("~/Developer/.hound-release/site")
    if os.path.isdir(site):
        shoot.ROOT = site
    base = f"http://127.0.0.1:{shoot.serve()}"
    for s in json.load(open(a.shots)):
        if a.only and s["name"] not in a.only.split(","):
            continue
        record(a, s, base)


if __name__ == "__main__":
    main()
