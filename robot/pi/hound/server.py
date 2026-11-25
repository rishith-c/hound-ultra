"""The rover's own web door: state out, commands in. Standard library only.

Every request needs the key (HOUND_KEY in the environment, never in a file here). One person drives at a time: the first to ask holds the wheel until they are silent for two seconds. Anyone with the key can stop it."""
import hmac
import json
import os
import queue
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class Door:
    def __init__(self, key, clock=time.monotonic): 
        if not key or len(key) < 12: raise ValueError('set HOUND_KEY to at least 12 characters')
        self.key, self.clock, self.lock = key, clock, threading.Lock(); self.driver, self.driver_t = None, -9.0; self.inbox = queue.Queue(64); self.state = {}; self.ears = []; self.bucket, self.bucket_t = 60.0, clock()
    def allowed(self, header): return hmac.compare_digest((header or '').encode(), ('Bearer ' + self.key).encode())
    def publish(self, state):
        with self.lock:
            self.state = state; line = ('data: ' + json.dumps(state, separators=(',', ':')) + '\n\n').encode()
            for q in self.ears:
                if not q.full(): q.put_nowait(line)
    def command(self, who, c):
        """(http code, answer). Checks shape, range and whose turn it is; nothing is acted on here."""
        t = self.clock(); kind = c.get('do') if isinstance(c, dict) else None
        with self.lock:
            self.bucket = min(60.0, self.bucket + 60 * (t - self.bucket_t)); self.bucket_t = t
            if kind == 'stop': self._put(dict(do='stop', who=who), force=True); return 200, 'stopping'
            if self.bucket < 1: return 429, 'too many commands'
            self.bucket -= 1
            if kind not in ('drive', 'clear', 'approve', 'refuse', 'hold', 'resume', 'search', 'alive'): return 400, 'unknown command'
            if kind in ('drive', 'clear', 'alive'):
                if self.driver not in (None, who) and t - self.driver_t < 2: return 409, 'someone else is driving'
                self.driver, self.driver_t = who, t
            if kind == 'drive':
                v = [c.get(k, 0) for k in ('x', 'y', 'w')]
                if not all(isinstance(a, (int, float)) and not isinstance(a, bool) and abs(a) <= 2 for a in v): return 400, 'a speed must be a number between -2 and 2'
                return (200, 'ok') if self._put(dict(do='drive', v=tuple(map(float, v)), who=who)) else (503, 'busy')
            return (200, 'ok') if self._put(dict(do=kind, who=who)) else (503, 'busy')
    def _put(self, c, force=False):
        if force and self.inbox.full(): self.inbox.get_nowait()
        if self.inbox.full(): return False
        self.inbox.put_nowait(c); return True

def handler(door):
    class H(BaseHTTPRequestHandler):
        protocol_version, timeout = 'HTTP/1.1', 15
        def log_message(self, *a): pass
        def answer(self, code, body, kind='application/json'):
            b = body if isinstance(body, bytes) else json.dumps(body).encode(); self.send_response(code); self.send_header('Content-Type', kind); self.send_header('Content-Length', str(len(b))); self.send_header('Cache-Control', 'no-store'); self.send_header('X-Content-Type-Options', 'nosniff'); self.end_headers(); self.wfile.write(b)
        def ok(self):
            if door.allowed(self.headers.get('Authorization')): return True
            time.sleep(.2); self.answer(401, {'error': 'key needed'}); return False
        def do_GET(self):
            if not self.ok(): return
            if self.path == '/state': return self.answer(200, door.state)
            if self.path != '/events': return self.answer(404, {'error': 'nothing here'})
            q = queue.Queue(32); door.ears.append(q)
            try:
                self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-store'); self.end_headers()
                while True:
                    try: self.wfile.write(q.get(timeout=5))
                    except queue.Empty: self.wfile.write(b': still here\n\n')
                    self.wfile.flush()
            except OSError: pass
            finally: door.ears.remove(q); self.close_connection = True
        def do_POST(self):
            if not self.ok(): return
            try:
                n = int(self.headers.get('Content-Length', 0))
                if not 0 < n <= 4096: return self.answer(413, {'error': 'too long'})
                c = json.loads(self.rfile.read(n))
            except (ValueError, UnicodeDecodeError): return self.answer(400, {'error': 'not JSON'})
            code, m = door.command(self.headers.get('X-Operator', self.client_address[0])[:40], c); self.answer(code, {'ok': code == 200, 'message': m})
    return H

def serve(door, host=None, port=8443): s = ThreadingHTTPServer((host or os.environ.get('HOUND_HOST', '10.42.0.1'), port), handler(door)); s.daemon_threads = True; threading.Thread(target=s.serve_forever, daemon=True).start(); return s
