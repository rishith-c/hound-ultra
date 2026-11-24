#!/usr/bin/env python3
"""shoot.py: drive headless Chrome to look at a page. Standard library only (no node, no pip).

    python3 tools/shoot.py URL [--w 1680] [--h 1000] [--wait 4] [--out shot.png] [--do STEP ...] [--gpu]

Steps run in order after the page has loaded and `--wait` seconds have passed:
    --do wait:2                 wait 2 seconds
    --do eval:'JS expression'   run JavaScript (may be async); the JSON result is printed as EVAL <result>
    --do click:'css selector'   click the centre of the first matching element (a real mouse click)
    --do key:'k'                press a key ('Enter', 'Escape', ' ', 'k', ...)
    --do type:'text'            type text into the focused element
    --do shot:path.png          save a screenshot now (viewport)
    --do size:1280x800          change the viewport
    --do hover:'css selector'   move the real mouse over the first matching element
    --do fps:3                  measure smoothness for 3 seconds: prints FPS mean, the slowest 5 %, the worst frame
If --out is given, one final screenshot is saved there.

Always printed at the end:
    ERRORS n                    console errors and uncaught exceptions (each listed above it as ERR ...)
Exit code 1 if the page had errors and --strict was passed.

You do not need a server. Any localhost URL (or a bare path such as /app/#/mission) is served from this repository by
the tool itself, so old addresses like http://localhost:4391/ultra/app/#/sense keep working. --no-serve turns it off.
Only a few browsers run at once across all agents (a lock); a call may wait for its turn. That is normal: do not retry.

WebGL works: Chrome is started with the GPU enabled. Pages are loaded with timers un-throttled, so animations
and requestAnimationFrame run at full speed even though no window is visible.

Review at desktop sizes only (1680x1000 by default). Do not check phone layouts.
"""
import argparse, base64, fcntl, functools, http.server, json, os, socket, struct, subprocess, sys, tempfile, threading, time, shutil
import urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SLOTS = int(os.environ.get("HOUND_SHOOT_SLOTS", "5"))      # browsers allowed at once on this machine


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript",
                      ".glb": "model/gltf-binary", ".wasm": "application/wasm", ".json": "application/json", ".webp": "image/webp"}

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError):
            pass


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass


def serve():
    srv = Server(("127.0.0.1", 0), functools.partial(Handler, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


def local_url(url):
    """Serve localhost URLs and bare paths from this repository; leave everything else alone."""
    if url.startswith("http"):
        u = urllib.parse.urlsplit(url)
        if u.hostname not in ("localhost", "127.0.0.1"):
            return url
        path = u.path[len("/ultra"):] if u.path.startswith("/ultra/") else u.path
        rest = (path or "/") + (("?" + u.query) if u.query else "") + (("#" + u.fragment) if u.fragment else "")
    else:
        rest = "/" + url.lstrip("/")
    return f"http://127.0.0.1:{serve()}{rest}"


def slot():
    """Wait for one of SLOTS lock files, so many agents cannot start dozens of browsers at once."""
    folder = os.path.join(tempfile.gettempdir(), "hound-shoot-slots")
    os.makedirs(folder, exist_ok=True)
    while True:
        for i in range(SLOTS):
            f = open(os.path.join(folder, f"{i}.lock"), "w")
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return f
            except OSError:
                f.close()
        time.sleep(0.4)


FPS_JS = """(async (sec) => { const t = []; let last = performance.now(); const end = last + sec * 1000;
  await new Promise((done) => { const f = (now) => { t.push(now - last); last = now; now < end ? requestAnimationFrame(f) : done(); };
  requestAnimationFrame((n) => { last = n; requestAnimationFrame(f); }); });
  t.sort((a, b) => a - b); const mean = t.reduce((a, b) => a + b, 0) / t.length;
  return { fps: +(1000 / mean).toFixed(1), slowest5pct_ms: +t[Math.floor(t.length * 0.95)].toFixed(1), worst_ms: +t[t.length - 1].toFixed(1), frames: t.length }; })"""

CHROME = next((p for p in [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
] if os.path.exists(p)), None)


class WS:
    """Minimal RFC 6455 client: enough for the Chrome DevTools Protocol."""

    def __init__(self, url):
        assert url.startswith("ws://")
        host, path = url[5:].split("/", 1)
        h, p = host.split(":")
        self.s = socket.create_connection((h, int(p)))
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET /{path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(4096)
        self.buf = buf.split(b"\r\n\r\n", 1)[1]

    def send(self, text):
        data = text.encode()
        mask = os.urandom(4)
        n = len(data)
        head = b"\x81" + (bytes([0x80 | n]) if n < 126 else b"\xfe" + struct.pack(">H", n) if n < 65536 else b"\xff" + struct.pack(">Q", n))
        self.s.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(1 << 20)
            if not chunk:
                raise ConnectionError("Chrome closed the connection")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self, timeout=None):
        self.s.settimeout(timeout)
        msg = b""
        while True:
            b0, b1 = self._read(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(n)
            op = b0 & 0x0F
            if op == 8:
                raise ConnectionError("closed")
            if op in (9, 10):
                continue
            msg += payload
            if b0 & 0x80:
                return msg.decode("utf-8", "replace")


class Page:
    def __init__(self, ws):
        self.ws, self.id, self.errors, self.events = ws, 0, [], []

    def call(self, method, params=None, timeout=60):
        self.id += 1
        mid = self.id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + timeout
        while time.time() < end:
            m = json.loads(self.ws.recv(timeout=max(0.1, end - time.time())))
            if m.get("id") == mid:
                if "error" in m:
                    raise RuntimeError(f"{method}: {m['error'].get('message')}")
                return m.get("result", {})
            self._event(m)
        raise TimeoutError(method)

    def _event(self, m):
        meth, p = m.get("method"), m.get("params", {})
        if meth == "Runtime.exceptionThrown":
            d = p.get("exceptionDetails", {})
            self.errors.append("EXCEPTION " + (d.get("exception", {}).get("description") or d.get("text", ""))[:600])
        elif meth == "Runtime.consoleAPICalled" and p.get("type") in ("error", "assert"):
            self.errors.append("CONSOLE " + " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", []))[:600])
        elif meth == "Log.entryAdded" and p.get("entry", {}).get("level") == "error":
            e = p["entry"]
            self.errors.append(f"LOG {e.get('text', '')} {e.get('url', '')}"[:600])
        elif meth:
            self.events.append(meth)

    def pump(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            try:
                self._event(json.loads(self.ws.recv(timeout=max(0.05, end - time.time()))))
            except (socket.timeout, TimeoutError):
                pass

    def wait_event(self, name, timeout):
        end = time.time() + timeout
        while time.time() < end:
            if name in self.events:
                return True
            self.pump(0.1)
        return False

    def eval(self, js):
        r = self.call("Runtime.evaluate", {"expression": js, "awaitPromise": True, "returnByValue": True, "userGesture": True}, timeout=120)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            return {"__error__": d.get("exception", {}).get("description") or d.get("text")}
        return r.get("result", {}).get("value")

    def shot(self, path):
        data = self.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})["data"]
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))
        print("SHOT", os.path.abspath(path))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url")
    ap.add_argument("--w", type=int, default=1680)
    ap.add_argument("--h", type=int, default=1000)
    ap.add_argument("--dpr", type=float, default=1)
    ap.add_argument("--wait", type=float, default=4)
    ap.add_argument("--out")
    ap.add_argument("--do", action="append", default=[])
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--no-serve", action="store_true", help="load localhost URLs from whatever server is already running there")
    ap.add_argument("--no-gpu", action="store_true", help="software rendering (slower, but works without a GPU)")
    a = ap.parse_args()
    if not CHROME:
        sys.exit("No Chrome-family browser found in /Applications.")
    url = a.url if a.no_serve else local_url(a.url)
    lock = slot()  # held until this process exits
    prof = tempfile.mkdtemp(prefix="hound-shoot-")
    gpu = ["--enable-unsafe-swiftshader"] if a.no_gpu else ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
    proc = subprocess.Popen([CHROME, "--headless=new", "--remote-debugging-port=0", f"--user-data-dir={prof}", f"--window-size={a.w},{a.h}",
                             "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--mute-audio", "--disable-extensions",
                             "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
                             "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                             *gpu, "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    code = 0
    try:
        port_file = os.path.join(prof, "DevToolsActivePort")
        for _ in range(400):
            if os.path.exists(port_file) and open(port_file).read().strip():
                break
            time.sleep(0.1)
        port = open(port_file).read().split("\n")[0].strip()
        targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
        page = Page(WS(next(t for t in targets if t["type"] == "page")["webSocketDebuggerUrl"]))
        for m in ("Page.enable", "Runtime.enable", "Log.enable"):
            page.call(m)
        page.call("Emulation.setDeviceMetricsOverride", {"width": a.w, "height": a.h, "deviceScaleFactor": a.dpr, "mobile": False})
        page.call("Page.navigate", {"url": url})
        page.wait_event("Page.loadEventFired", 30)
        page.pump(a.wait)
        for step in a.do:
            kind, _, arg = step.partition(":")
            if kind == "wait":
                page.pump(float(arg))
            elif kind == "eval":
                print("EVAL", json.dumps(page.eval(arg), default=str)[:6000])
            elif kind == "click":
                r = page.eval(f"(()=>{{const e=document.querySelector({json.dumps(arg)});if(!e)return null;e.scrollIntoView({{block:'center'}});const b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]}})()")
                if not r:
                    print("CLICK-MISS", arg)
                    code = 1
                else:
                    for t in ("mousePressed", "mouseReleased"):
                        page.call("Input.dispatchMouseEvent", {"type": t, "x": r[0], "y": r[1], "button": "left", "clickCount": 1})
                    page.pump(0.3)
            elif kind == "hover":
                r = page.eval(f"(()=>{{const e=document.querySelector({json.dumps(arg)});if(!e)return null;e.scrollIntoView({{block:'center'}});const b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]}})()")
                if not r:
                    print("HOVER-MISS", arg)
                else:
                    page.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": r[0], "y": r[1]})
                page.pump(0.4)
            elif kind == "fps":
                print("FPS", json.dumps(page.eval(f"{FPS_JS}({float(arg)})")))
            elif kind == "key":
                for t in ("keyDown", "keyUp"):
                    page.call("Input.dispatchKeyEvent", {"type": t, "key": arg, "text": arg if len(arg) == 1 and t == "keyDown" else ""})
                page.pump(0.2)
            elif kind == "type":
                page.call("Input.insertText", {"text": arg})
                page.pump(0.2)
            elif kind == "shot":
                page.shot(arg)
            elif kind == "size":
                w, h = (int(x) for x in arg.lower().split("x"))
                page.call("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": a.dpr, "mobile": False})
                page.pump(0.4)
            else:
                print("UNKNOWN-STEP", step)
        if a.out:
            page.shot(a.out)
        for e in page.errors:
            print("ERR", e)
        print("ERRORS", len(page.errors))
        del lock
        if a.strict and page.errors:
            code = 1
    finally:
        proc.terminate()
        try:
            proc.wait(5)
        except Exception:
            proc.kill()
        shutil.rmtree(prof, ignore_errors=True)
    sys.exit(code)


if __name__ == "__main__":
    main()
