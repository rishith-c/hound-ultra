#!/usr/bin/env python3
"""film.py: record shots of the running site frame by frame, so the video is smooth whatever this computer is doing.

    python3 tools/film.py SHOTS.json [--only name,name] [--w 1920] [--h 1080] [--dpr 1] [--fps 60] [--out DIR] [--sheet SECONDS]

The page's clock is replaced: after a shot has settled, time only moves when a frame has been saved. requestAnimationFrame,
timers, performance.now, Date and CSS / Web animations all follow that clock. Each shot becomes one H.264 file.
A shot: {"name", "url", "settle": s, "before": "js", "seconds": s, "do": [[t, "js"], ...], "hide": "css", "cursor": true, "size": [w, h, dpr], "skip": s played but not saved}
Default 1440 x 810 at 1.3333, which saves 1920 x 1080 with the type a third larger.
"""
import argparse, base64, json, os, shutil, subprocess, sys, tempfile, time, urllib.request
import shoot

FFMPEG = "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1"

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


# A drawn pointer for console shots: __cur.go('Find people', 700) travels to a control by its text (or [x, y], or 'css:...') and presses it.
CURSOR = r"""(() => {
  const c = document.createElement('div'); c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:24px;height:24px;filter:drop-shadow(0 2px 5px rgba(0,0,0,.6))';
  c.innerHTML = '<svg width="24" height="24" viewBox="0 0 26 26"><path d="M4 2.5 L4 21.2 L8.8 16.9 L11.9 23.9 L15 22.5 L11.9 15.8 L18.4 15.3 Z" fill="#fff" stroke="#0a0d11" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  document.documentElement.append(c);
  let x = 800, y = 430; const put = (k = 1) => { c.style.transform = `translate(${x - 4}px,${y - 2.5}px) scale(${k})`; }; put();
  const ease = (p) => p * p * p * (p * (p * 6 - 15) + 10), vis = (e) => e.getClientRects().length && e.getBoundingClientRect().width > 4;
  const find = (q) => { if (Array.isArray(q)) return [q[0], q[1], null];
    const el = q.startsWith('css:') ? document.querySelector(q.slice(4)) : [...document.querySelectorAll('button,a,[role=tab],[role=button],label,summary,input')].filter((e) => vis(e) && (e.textContent.trim() || e.getAttribute('aria-label') || '').startsWith(q)).sort((a, b) => a.textContent.length - b.textContent.length)[0];
    if (!el) { console.error('cursor: no ' + q); return null; } const r = el.getBoundingClientRect(); return [r.x + r.width * 0.5, r.y + r.height * 0.55, el]; };
  const press = (el) => { const t0 = performance.now(), ring = document.createElement('div'); ring.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;border:1.5px solid rgba(255,255,255,.85);z-index:2147483646;pointer-events:none;opacity:0`; document.documentElement.append(ring);
    const f = () => { const p = (performance.now() - t0) / 420; put(p < 0.35 ? 1 - 0.2 * Math.sin(Math.PI * p / 0.35) : 1); ring.style.transform = `scale(${0.3 + 0.7 * ease(Math.min(1, p))})`; ring.style.opacity = String(Math.max(0, 0.9 * (1 - p))); if (p < 1) requestAnimationFrame(f); else ring.remove(); }; f();
    if (el) { const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0 }; el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', o)); el.click(); } };
  const to = (q, ms, then) => { const f = find(q); if (!f) return 0; const x0 = x, y0 = y, t0 = performance.now(), arc = Math.min(36, Math.hypot(f[0] - x0, f[1] - y0) * 0.07);
    const g = () => { const p = Math.min(1, (performance.now() - t0) / ms), e = ease(p); x = x0 + (f[0] - x0) * e; y = y0 + (f[1] - y0) * e - Math.sin(Math.PI * e) * arc; put(); if (p < 1) requestAnimationFrame(g); else if (then) then(f[2]); }; g(); return 1; };
  window.__cur = { at(a, b) { x = a; y = b; put(); return 1; }, move: (q, ms = 700) => to(q, ms, null), go: (q, ms = 700) => to(q, ms, press),
    slide: (q, v0, v1, ms, lead = 500) => { const f = find(q); if (!f) return 0; const el = f[2], r = el.getBoundingClientRect(), lo = +el.min || 0, hi = +el.max || 100, px = (v) => r.x + 8 + (r.width - 16) * v;
      return to([px(v0), r.y + r.height / 2], lead, () => { const t0 = performance.now(), g = () => { const p = Math.min(1, (performance.now() - t0) / ms), v = v0 + (v1 - v0) * ease(p); el.value = lo + (hi - lo) * v; el.dispatchEvent(new Event('input', { bubbles: true })); x = px(v); y = r.y + r.height / 2; put(0.9); if (p < 1) requestAnimationFrame(g); else { el.dispatchEvent(new Event('change', { bubbles: true })); put(); } }; g(); }); } };
})()"""


def chrome(a, size):
    w, h, dpr = size
    prof = tempfile.mkdtemp(prefix="hound-film-")
    proc = subprocess.Popen([shoot.CHROME, "--headless=new", "--remote-debugging-port=0", f"--user-data-dir={prof}", f"--window-size={w},{h}", "--hide-scrollbars", "--no-first-run",
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
    page.call("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": dpr, "mobile": False})
    return proc, prof, page


def sheet(cells, out, cols=4, w=640):
    from PIL import Image, ImageDraw
    import io
    ims = [(t, Image.open(io.BytesIO(d)).convert("RGB")) for t, d in cells]
    hh = round(ims[0][1].height * w / ims[0][1].width)
    big = Image.new("RGB", (cols * w, -(-len(ims) // cols) * hh))
    d = ImageDraw.Draw(big)
    for i, (t, im) in enumerate(ims):
        x, y = i % cols * w, i // cols * hh
        big.paste(im.resize((w, hh)), (x, y))
        d.rectangle((x, y, x + 60, y + 16), fill=(0, 0, 0))
        d.text((x + 4, y + 2), f"{t:.1f} s", fill=(255, 255, 255))
    big.save(out, quality=85)


def record(a, shot, base):
    proc, prof, page = chrome(a, shot.get("size") or (a.w, a.h, a.dpr))
    out = os.path.join(a.out, shot["name"] + ".mp4")
    n = int(round(shot["seconds"] * a.fps))
    every = int(round(a.sheet * a.fps)) if a.sheet else 1
    t0 = time.time()
    try:
        page.call("Page.navigate", {"url": base + shot["url"]})
        page.wait_event("Page.loadEventFired", 60)
        page.pump(shot.get("settle", 4))
        if shot.get("hide"):
            page.eval("(() => { const s = document.createElement('style'); s.textContent = " + json.dumps(shot["hide"]) + "; document.head.append(s); return 1; })()")
        if shot.get("cursor"):
            page.eval(CURSOR)
        if shot.get("before"):
            r = page.eval(shot["before"])
            if isinstance(r, dict) and "__error__" in r:
                print("  before:", r["__error__"][:300])
        page.pump(shot.get("after", 0.2))
        todo = sorted(shot.get("do", []), key=lambda x: x[0])
        enc = None if a.sheet else subprocess.Popen([FFMPEG, "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(a.fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "12",
                                "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", out], stdin=subprocess.PIPE)
        cells = []
        page.eval("__film.freeze()")
        for k in range(n):
            t = k / a.fps
            while todo and todo[0][0] <= t + 1e-6:
                r = page.eval(todo.pop(0)[1])
                if isinstance(r, dict) and "__error__" in r:
                    print("  do:", r["__error__"][:300])
            page.call("Runtime.evaluate", {"expression": f"__film.step({1000 / a.fps})"}, timeout=120)
            if k % every or t < shot.get("skip", 0):
                continue
            data = page.call("Page.captureScreenshot", {"format": "jpeg", "quality": 96, "optimizeForSpeed": True}, timeout=120)["data"]
            if a.sheet:
                cells.append((t, base64.b64decode(data)))
            else:
                enc.stdin.write(base64.b64decode(data))
        if a.sheet:
            sheet(cells, os.path.join(a.out, shot["name"] + ".jpg"))
        else:
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
    ap.add_argument("--w", type=int, default=1440)
    ap.add_argument("--h", type=int, default=810)
    ap.add_argument("--dpr", type=float, default=4 / 3)
    ap.add_argument("--fps", type=int, default=60)
    ap.add_argument("--sheet", type=float, default=0, help="scout: save one frame every N seconds as a contact sheet instead of a film")
    ap.add_argument("--out", default=os.path.expanduser("~/Developer/.hound-release/film"))
    ap.add_argument("--work", action="store_true", help="film the working tree instead of the release snapshot")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    site = os.path.expanduser("~/Developer/.hound-release/site")
    if os.path.isdir(site) and not a.work:
        shoot.ROOT = site
    base = f"http://127.0.0.1:{shoot.serve()}"
    for s in json.load(open(a.shots)):
        if a.only and s["name"] not in a.only.split(","):
            continue
        record(a, s, base)


if __name__ == "__main__":
    main()
