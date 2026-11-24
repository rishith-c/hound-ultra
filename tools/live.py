#!/usr/bin/env python3
"""live.py: the console on the real robot. Serves the site on this computer and passes the robot's own readings through.

    python3 tools/live.py [--rover HOST:PORT] [--key-file FILE]      then open http://localhost:4477/live/

The robot's key stays in this process: it is read from --key-file, never sent to the page and never logged. Every reading that
passes is written to a log next to the key file, so a demo can be checked afterwards. Nothing is simulated here.
"""
import argparse, functools, http.server, json, os, time, urllib.parse, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ALLOWED = {"status", "cam.jpg", "cam", "thermal", "radar", "wifi", "v", "stop"}     # the page may look, drive and stop; nothing else


class H(http.server.SimpleHTTPRequestHandler):
    rover = key = log = None

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if not u.path.startswith("/rover/"):
            return super().do_GET()
        ep = u.path[7:]
        if ep not in ALLOWED:
            return self.send_error(404)
        q = dict(urllib.parse.parse_qsl(u.query), k=self.key)
        try:
            with urllib.request.urlopen(f"http://{self.rover}/api/{ep}?{urllib.parse.urlencode(q)}", timeout=2.5) as r:
                body, kind = r.read(), r.headers.get("Content-Type", "application/json")
        except Exception as e:
            return self.send_error(502, type(e).__name__)
        if ep == "status":
            self.log.write(json.dumps({"t": round(time.time(), 3), **json.loads(body)}) + "\n")
            self.log.flush()
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rover", default="rishithc.local:8080")
    ap.add_argument("--key-file", default=os.path.expanduser("~/Developer/.hound-release/rover.key"))
    ap.add_argument("--port", type=int, default=4477)
    a = ap.parse_args()
    H.rover, H.key = a.rover, open(a.key_file).read().strip()
    H.log = open(os.path.join(os.path.dirname(os.path.abspath(a.key_file)), time.strftime("live-%Y%m%d-%H%M%S.jsonl")), "a")
    print(f"HOUND Live: http://localhost:{a.port}/live/   robot {a.rover}", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", a.port), functools.partial(H, directory=ROOT)).serve_forever()


if __name__ == "__main__":
    main()
