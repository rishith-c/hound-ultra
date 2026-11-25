"""One search, start to end, on the rover.

  map from the drone -> pick a room -> plan to a spot outside its wall -> drive -> stand still -> the drone takes the far side and probes -> listen ten seconds
  -> one chance out of every reading -> maybe a second look from another wall -> a person decides

Three rules the code keeps:  nothing is believed while the rover moves;  blind is never counted as empty;  no route is final until a person has said yes."""
import math
from . import fusion, plan, pose as P, radar, thermal

WALK_IN, LISTEN, SETTLE, LOOKS, LOST = .35, 11.0, 1.0, 2, .30

class Mission:
    def __init__(self, net, rx, home=(0.0, 0.0), radius=.27):
        self.net, self.rx, self.home, self.radius = net, rx, home, radius
        self.pose = P.Pose(*home); self.state = 'wait for the map'; self.t0 = 0.0; self.grid = self.drive = None; self.rooms, self.done, self.log, self.out = [], [], [], []; self.room = self.follow = self.held = None; self.judge = radar.Judge(); self.heat = []; self.bad_map = 0

    # ---- words in
    def say(self, t, m): self.log.append((round(t, 2), m))
    def send(self, **k): self.out.append(k)
    def map(self, t, m):
        """From the drone: what is blocked, what each square metre of ground costs, the rooms worth a look, and what was seen from above."""
        try:
            g = plan.Grid(m['blocked'], m['cost'], m['res'])
            assert g.cost.shape == g.blocked.shape and (g.cost[~g.blocked] > 0).all() and .05 <= g.res <= 2
            rooms = [dict(id=r['id'], box=tuple(map(float, r['box'])), ev=[('aerial', a, 'above') for a in r.get('aerial', [])], looks=0, used=[], blind=[]) for r in m['rooms']]
        except (KeyError, TypeError, ValueError, AssertionError, IndexError) as e: self.bad_map += 1; self.say(t, f'map refused: {type(e).__name__}'); self.send(to='drone', do='resend map'); return False
        self.grid, self.drive = g, g.grown(self.radius); self.rooms = rooms; self.say(t, f'map: {g.w * g.res:.0f} by {g.h * g.res:.0f} m, {len(rooms)} rooms'); self.go(t, 'choose'); return True
    def approve(self, t, yes, who):
        if self.state != 'ask': return False
        self.room['approved'] = bool(yes); self.room['by'] = who; self.say(t, f"route {'approved' if yes else 'refused'} by {who}"); self.done.append(self.room); self.room = None; self.go(t, 'choose'); return True
    def no_spot(self, t):
        if self.state == 'call the drone': self.say(t, f"{self.room['id']}: nowhere for the drone on the far side, trying another wall"); self.room['blind'].append('nowhere to set the drone down'); self._again(t)
    def hold(self, t, why):
        if self.state != 'hold': self.held = self.state; self.say(t, 'holding: ' + why); self.go(t, 'hold')
    def resume(self, t):
        """Back to what it was doing. A listening stop that was broken off starts again from the beginning."""
        if self.state == 'hold': self.say(t, 'going on'); self.go(t, {'listen': 'settle', 'call the drone': 'settle'}.get(self.held, self.held))
    def go(self, t, s): self.state, self.t0 = s, t

    # ---- one step, ten to fifty times a second
    def step(self, t, s):
        """s: what the sensors say now (drive status, radar targets, thermal frame, probe link). Returns the wish (vx, vy, w)."""
        if s.get('steps') is not None: self.pose.steps(s['steps'])
        if s.get('fix') is not None: self.pose.fix(*s['fix'])
        still = s.get('still', False); zero = (0.0, 0.0, 0.0); d = t - self.t0
        if self.state == 'choose': self._choose(t); return zero
        if self.state == 'drive':
            if self.pose.var ** .5 > LOST: self.say(t, f'unsure of its place by {self.pose.var ** .5:.2f} m: waiting to be seen'); self.go(t, 'where am I'); return zero
            want, there, stuck = self.follow.step(self.pose, t)
            if stuck: self.say(t, 'no progress for 6 s: looking for another way'); self._again(t); return zero
            if there: self.go(t, 'settle')
            return zero if there else want
        if self.state == 'where am I':                                                # wheels slip, and every metre adds to it; only the drone's view from above takes it away
            if self.pose.var ** .5 < LOST / 2: self.say(t, 'seen from above: going on'); self.follow.best = 1e9; self.go(t, 'drive')
            elif d > 120: self.say(t, 'nobody can see it: stopping here for the operator'); self.send(to='operator', check='the rover', p=None, why=['it is not sure where it is']); self.hold(t, 'it is not sure where it is')
            return zero
        if self.state == 'settle':
            if not still: self.t0 = t
            elif d >= SETTLE: self.send(to='drone', do='probe', spot=self.room['probe'], room=self.room['id'], rover=(self.pose.x, self.pose.y)); self.go(t, 'call the drone')
            return zero
        if self.state == 'call the drone':
            if s.get('probing'): self.rx.clear(); self.judge.reset(); self.heat = []; self.go(t, 'listen')
            elif d > 90: self.room['blind'].append('the drone never reached the far side'); self._decide(t, wifi=('blind', 'no probe from the far side'))
            return zero
        if self.state == 'listen':
            if not still: self.say(t, 'moved while listening: starting again'); self.go(t, 'settle'); return zero
            if s.get('targets') is not None: self.judge.add(s['targets'], t, still)
            if s.get('r2410') is not None: self.judge.add2410(s['r2410'], still)
            if s.get('heat') is not None: self.heat.append(s['heat'])
            if d >= LISTEN: self._decide(t)
            return zero
        return zero                                                                  # wait for the map, ask, hold, finished: stand still

    # ---- choices
    def _choose(self, t):
        todo = sorted(self.rooms, key=lambda r: (r['looks'], -fusion.fuse(r['ev'])[0]))
        for r in todo:
            spot = self._spot(r)
            if spot is None: continue
            self.room = r; self.rooms.remove(r); r['spot'], r['side'] = spot[1], spot[3]; r['used'].append(spot[3]); r['probe'] = self._far(r, spot[1]); self.follow = P.Follow([(self.pose.x, self.pose.y)] + spot[2]['path'][1:], face=self._mid(r), v=WALK_IN); self.say(t, f"{r['id']}: driving {spot[2]['length']:.1f} m to its {spot[3]} side"); self.go(t, 'drive'); return
        for r in todo: r['verdict'] = 'not searched' if r['used'] else 'not reached'; r['p'] = fusion.fuse(r['ev'])[0]; self.done.append(r); self.say(t, f"{r['id']}: no other side to listen from" if r['used'] else f"{r['id']}: no way to it"); self.send(to='operator', check=r['id'], p=r['p'], why=r['blind'] or ['no way to it'])
        self.rooms = []; self.say(t, 'finished'); self.send(to='operator', report=self.report()); self.go(t, 'finished')
    @staticmethod
    def _mid(r): x0, y0, x1, y1 = r['box']; return (x0 + x1) / 2, (y0 + y1) / 2
    def _spot(self, r): return plan.listening_spot(self.drive, (self.pose.x, self.pose.y), r['box'], [s for s in ('west', 'east', 'south', 'north') if s not in r['used']], (self.radius + .6, 2.6))
    def _far(self, r, spot):
        """Where the probe should be: through the middle of the room from the rover, and out the other side."""
        m = self._mid(r); d = math.dist(spot, m); reach = max(r['box'][2] - r['box'][0], r['box'][3] - r['box'][1]) / 2 + 3.0; return m[0] + (m[0] - spot[0]) / d * reach, m[1] + (m[1] - spot[1]) / d * reach
    def _again(self, t): r = self.room; self.room = None; self.rooms.append(r); self.go(t, 'choose')          # the side that failed stays in r['used'], so the next try is another wall
    def _decide(self, t, wifi=None):
        r = self.room; here = r['side']; r['looks'] += 1
        if wifi is None:
            x, why = self.rx.look(t)
            if x is None: wifi = ('blind', why)
            else: n = self.net.reads(x); wifi = ('pos' if n['says'] else 'neg', f"network {n['person']:.2f}, {why}")
        rad, at, rwhy = self.judge.says(); th, where, twhy = thermal.look(self.heat)
        new = [('wifi', wifi[0], here), ('radar', rad, here) if rad != 'machine' else ('signature', 'machine', here), ('micro', self.judge.breath(), here), ('temperature', 'tooHot', here) if th == 'tooHot' else ('thermal', th, here)]
        if th == 'neg' and not r.get('open_sight'): new[-1] = ('thermal', 'blind', here)                     # a wall in the way: seeing nothing warm says nothing
        r['ev'] += new; r['blind'] += [w for a, w in ((wifi[0], 'Wi-Fi: ' + wifi[1]), (rad, 'radar: ' + rwhy)) if a == 'blind']; r['p'], r['steps'] = fusion.fuse(r['ev']); v = fusion.verdict(r['p'])
        self.say(t, f"{r['id']}: Wi-Fi {wifi[0]} ({wifi[1]}), radar {rad}, heat {th}: {100 * r['p']:.0f} %, {v}"); self.send(to='drone', do='probe off')
        if v == 'person': r['verdict'] = v; r['route'] = plan.route(self.drive, self.home, self._mid(r), nearest=True); self.send(to='operator', ask=r['id'], p=r['p'], route=r['route']); self.go(t, 'ask'); return
        saw = wifi[0] != 'blind'
        if r['looks'] < LOOKS and (v == 'possible' or not saw): self.say(t, f"{r['id']}: a second look from another side"); self.rooms.insert(0, r); self.room = None; self.go(t, 'choose'); return
        r['verdict'] = v if v != 'unlikely' or any(a != 'blind' for s, a, _ in r['ev'] if s == 'wifi') else 'not searched'          # radar and heat stop at a wall: without the Wi-Fi, nothing has looked inside
        if r['verdict'] in ('possible', 'not searched'): self.send(to='operator', check=r['id'], p=r['p'], why=r['blind'] or ['not sure'])
        self.done.append(r); self.room = None; self.go(t, 'choose')
    def report(self): return [dict(room=r['id'], verdict=r.get('verdict'), p=round(r.get('p', fusion.PRIOR), 3), looks=r['looks'], blind=r['blind'], approved=r.get('approved'), gap=r.get('route', {}).get('gap')) for r in self.done]
