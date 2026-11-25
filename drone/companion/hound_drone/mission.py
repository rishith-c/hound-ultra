"""One flight, start to end, on the drone:  look at the ground -> make the map -> give it to the rover -> for each room, set down on the far side and send Wi-Fi -> home.

The propellers are stopped while it probes: they would be moving metal in the very signal it is sending."""
import math
import numpy as np
from . import ground, mapper, probe, survey, vision

HIGH, LOW, CRUISE, SCAN = 14.0, 1.6, 4.0, 2.5


class Mission:
    def __init__(self, link, box, home=(0.0, 0.0), watts=158.7, wh=72.7):
        self.link, self.box, self.home = link, box, home; self.state, self.t0 = 'ready', 0.0; self.log, self.out = [], []
        self.map = None; self.pts = []; self.ask = None; self.sight = vision.Sightings(); self.views = {}; self.spot = None; self.hgt = None; self.probing = False; self.watts, self.wh = watts, wh; self.rover = self.over = None

    def say(self, t, m): self.log.append((round(t, 1), m))
    def go(self, t, s): self.state, self.t0 = s, t

    # ---- words in, from the operator and the rover
    def start(self, t):
        path = survey.lanes(self.box, HIGH, overlap=.5); s, wh = survey.cost(path, (*self.home, 0.0), SCAN, self.watts)
        if wh > .6 * self.wh: self.say(t, f'not flown: {wh:.0f} Wh is too much of the pack'); return False
        self.say(t, f'{len(path) // 2} lanes, {s:.0f} s, {wh:.1f} Wh, {100 * survey.cover(path, self.box, HIGH):.0f} % of the box in view'); self.link.path(path, SCAN); self.link.arm(); self.go(t, 'survey'); return True

    def hear(self, t, m):
        if m.get('do') == 'probe': self.ask = m
        elif m.get('do') == 'at': self.rover = (float(m['x']), float(m['y']))
        elif m.get('do') == 'probe off': self.ask = None; self.probing = False; self.out.append(dict(kind='probing', on=False))
        elif m.get('do') == 'resend map' and self.map: self.out.append(self.map)
        elif m.get('do') == 'home': self.ask = None; self.probing = False; self.go(t, 'go home')

    # ---- sensors in
    def laser(self, pts): self.pts.append(np.asarray(pts, np.float32))
    def camera(self, boxes, sees):
        self.sight.frame(boxes, sees)
        if self.map:
            for r in self.map['rooms']: x0, y0, x1, y1 = r['box']; self.views[r['id']] = self.views.get(r['id'], 0) + bool(sees((x0 + x1) / 2, (y0 + y1) / 2))

    # ---- ten times a second
    def step(self, t):
        s = self.link.poll(t); d = t - self.t0
        while self.link.said: self.say(t, 'flight board: ' + self.link.said.pop(0))
        if s is None: return
        if s['mode'] in ('returning', 'landing') and s['why'] in ('link lost', 'pack low', 'no position', 'left the fence') and self.state not in ('coming down', 'out of it'): self.say(t, f"{s['mode']}: {s['why']}"); self.probing = False; self.out.append(dict(kind='probing', on=False)); self.go(t, 'out of it')
        if s['mode'] == 'motors cut' and self.state != 'out of it': self.say(t, 'motors cut: ' + s['why']); self.probing = False; self.out.append(dict(kind='probing', on=False)); self.go(t, 'out of it')
        if self.state == 'survey':
            if s['mode'] == 'on the ground' and not s['armed'] and d > 3: self.go(t, 'ready'); self.say(t, 'it would not arm')
            elif s['mode'] == 'holding' and s['why'] == 'finished': self._map(t)
        elif self.state == 'up':
            if self.ask: self._to_spot(t, s)
            elif self.rover and s['mode'] == 'holding' and s['why'] == 'finished' and math.dist(s['pos'][:2], self.rover) > 3: self.link.path([(*self.rover, HIGH)], CRUISE)          # stays over the rover: from there it can see where the rover really is
            elif d > 240: self.link.home(); self.say(t, 'nothing asked for four minutes: home, to save the pack'); self.go(t, 'going home')
        elif self.state == 'down':
            if self.ask and not self.probing: self._to_spot(t, s)
            elif not self.ask and self.rover: self.link.path([(*s['pos'][:2], 8.0), (*self.rover, HIGH)], CRUISE); self.link.arm(); self.go(t, 'up again')
        elif self.state == 'up again':
            if s['mode'] == 'holding' and s['why'] == 'finished': self.go(t, 'up')
            elif d > 4 and not s['armed']: self.say(t, 'it would not take off again'); self.go(t, 'out of it')
        elif self.state == 'done':
            if self.ask: self._to_spot(t, s)
        elif self.state == 'to the spot':
            if not self.ask: self.go(t, 'up')
            elif s['mode'] == 'holding' and s['why'] == 'finished' and math.dist(s['pos'][:2], self.spot) < .8: self.link.land(0.0); self.go(t, 'coming down')
            elif s['mode'] == 'on the ground' and not s['armed'] and d > 3: self.say(t, 'it would not take off again'); self.go(t, 'out of it')
        elif self.state == 'coming down':
            if not s['armed'] and s['mode'] == 'on the ground':
                e = math.dist(s['pos'][:2], self.spot); self.say(t, f'down on the far side, {e:.1f} m from the spot, motors stopped'); self.go(t, 'down')
                if self.ask: self.probing = True; self.out.append(dict(kind='probing', on=True))
        elif self.state == 'go home':
            if s['armed']: self.link.home(); self.go(t, 'going home')
            else: self.link.path([(*s['pos'][:2], HIGH), (*self.home, HIGH)], CRUISE); self.link.arm(); self.go(t, 'lifting off')
        elif self.state == 'lifting off':
            if s['mode'] == 'holding' and s['why'] == 'finished': self.link.home(); self.go(t, 'going home')
            elif d > 4 and not s['armed']: self.say(t, 'it would not take off again'); self.go(t, 'out of it')
        elif self.state == 'going home':
            if not s['armed'] and s['mode'] == 'on the ground': self.say(t, f"home, {s['wh']:.1f} Wh left"); self.go(t, 'done')

    # ---- what it does with it
    def _map(self, t):
        pts = np.concatenate(self.pts) if self.pts else np.zeros((0, 3)); pl = ground.plane(pts[np.random.default_rng(0).choice(len(pts), min(len(pts), 6000), replace=False)]) if len(pts) else None
        if pl is None: self.say(t, 'no ground under these points: no map'); self.go(t, 'go home'); return
        m = mapper.Mapper((self.box[2], self.box[3])); h = ground.heights(pts, pl); m.add(pts, h); self.map = m.build(); self.hgt = np.where(m.n >= 3, np.where(m.blocked(), np.maximum(m.hi, .3), 0.0), np.nan)
        self.map['rooms'] = vision.for_rooms(self.map['rooms'], self.sight, {r['id']: 99 for r in self.map['rooms']} if self.sight.tracks else {}); self.out.append(self.map)
        self.say(t, f"{len(pts)} points, ground found under {100 * pl[4]:.0f} % of them, {len(self.map['rooms'])} rooms, {100 * self.map['unseen']:.1f} % not seen"); self.go(t, 'up')

    def _to_spot(self, t, s):
        a = self.ask; room = next((r for r in self.map['rooms'] if r['id'] == a['room']), None)
        if room is None: self.say(t, f"no room called {a['room']}"); self.ask = None; return
        p = probe.far_side(self.hgt, self.map['res'], a['rover'], room['box'], a['spot'], others=[r['box'] for r in self.map['rooms'] if r is not room])
        if p is None: self.say(t, f"{a['room']}: nowhere flat on the far side"); self.out.append(dict(kind='no spot', room=a['room'])); self.ask = None; return
        self.spot = p; x, y = s['pos'][:2]; path = [] if s['armed'] and s['pos'][2] > 8 else [(x, y, 8.0)]; path += [(*p, 8.0), (*p, LOW)]
        self.link.path(path, CRUISE)
        if not s['armed']: self.link.arm()
        self.say(t, f"{a['room']}: to the far side, {p[0]:.1f}, {p[1]:.1f}"); self.go(t, 'to the spot')
