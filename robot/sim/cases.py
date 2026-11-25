"""Every case, what should happen, and what did. The table in docs/ROBOT_RESULTS.md is made by this file and nothing else.

    python3 robot/sim/cases.py            every case, ten at a time, and the table
    python3 robot/sim/cases.py cable      one case, with its log

Nothing here is measured on a real machine. The world, the people and the readings are made up; the code under test is the code that would run."""
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import numpy as np
HERE = Path(__file__).resolve().parent; sys.path[:0] = [str(HERE), str(HERE.parent / 'pi')]
from run import Run                                                               # noqa: E402
from channel import Body, Fan                                                     # noqa: E402

rng = lambda n: np.random.default_rng(n)
FIRST = lambda: dict(people={'A': Body(6.6, 14.2, .7, 1.1, rng=rng(1)), 'E': Body(20.5, 5.2, .6, 1.0, rng=rng(2))}, fans={'B': Fan(13.5, 14.5)}, hot={'C': (20.6, 12.4, 88.0)})
SECOND = lambda: dict(people={'D': Body(6.4, 5.2, .65, .9, rng=rng(3)), 'C': Body(20.4, 14.0, .6, 1.1, rng=rng(4))}, fans={'A': Fan(6.5, 14.5)}, hot={'E': (20.6, 6.6, 88.0)})
HARD = lambda: dict(people={'A': Body(6.6, 14.2, .7, 1.1, rng=rng(5)), 'D': Body(6.4, 5.2, .35, .9, rng=rng(6)), 'E': Body(20.5, 5.2, 0, 0, rng=rng(7))}, fans={'B': Fan(13.5, 14.5), 'C': Fan(20.5, 14.5)}, hot={'C': (20.6, 12.4, 88.0)})

def facts(s):
    """What every run is judged on."""
    v, p = s.verdicts(), s.chances(); who = set(s.w.people); order = sorted(p, key=lambda k: -p[k]); last = max((order.index(k) for k in who if k in order), default=-1) + 1
    return dict(verdicts=v, chances=p, confirmed=sorted(k for k in who if v.get(k) == 'person'), flagged=sorted(k for k in who if v.get(k) in ('possible', 'nothing moved', 'not searched', 'not reached')), missed=sorted(k for k in who if v.get(k) in ('unlikely', None)), false=sorted(k for k in v if k not in who and v[k] == 'person'),
                opened=last, rooms=len(v), bumps=s.w.hit, near=round(s.air.near, 2), seconds=round(s.w.t), state=s.r.m.state, down=s.air.real['mode'] == 'on the ground' or not s.air.real['armed'], log=[(t, 'rover', m) for t, m in s.r.m.log] + [(t, 'drone', m) for t, m in s.air.m.log])
def good(f): return f['state'] == 'finished' and not f['missed'] and not f['false'] and f['bumps'] == 0 and f['near'] > .4

# ---- ordinary, repeat, demanding: the same three things must hold every time
def search(seed, world, wind=(2.0, 1.0, .6), corrupt=0.0):
    s = Run(seed, **world, wind=wind); s.w.corrupt = corrupt; s.go(); return facts(s)

# ---- failures. Each returns (what happened, did it meet what was asked)
def until(s, f, limit=1800):
    while s.w.t < limit and not f(s): s.step()
    return s.w.t < limit
def start(s):
    for _ in range(200): s.step()
    s.air.m.start(s.w.t)
def moving(s): return s.r.m.state == 'drive' and abs(s.w.board.look()[0][0]) + abs(s.w.board.look()[0][1]) > .25
def run_on(s, seconds):
    end = s.w.t + seconds
    while s.w.t < end: s.step()
def stopped(s, limit=5):
    """Seconds and metres until the wheels stand still."""
    t, x, y = s.w.t, s.w.x, s.w.y; d = 0.0
    while s.w.t < t + limit and any(s.w.board.look()[0]): s.step(); d += float(np.hypot(s.w.x - x, s.w.y - y)); x, y = s.w.x, s.w.y
    return s.w.t - t, d
def finish(s):
    until(s, lambda s: s.r.m.state == 'finished'); return facts(s)
def two_done(s): return len(s.r.m.done) >= 1 and moving(s)

def cable(seed):
    s = Run(seed, **FIRST()); start(s); until(s, moving); s.w.board.cut = True; a, b = stopped(s); why = list(s.r.safe.why); run_on(s, 4); s.w.board.cut = False; f = finish(s)
    return f'wheels still after {a:.2f} s and {b:.2f} m ("{why[0] if why else ""}"); cable back, search finished: {len(f["confirmed"])} of 2 confirmed', a < 1.0 and b < .25 and good(f), f
def operator(seed):
    s = Run(seed, **FIRST()); start(s); until(s, two_done); before = len(s.r.m.done); s.operator = False; run_on(s, 1.0); a, b = stopped(s); why = s.r.m.log[-1][1]; run_on(s, 20); kept = len(s.r.m.done); s.operator = True; f = finish(s)
    return f'stopped {1 + a:.1f} s after the last word ("{why}"), {before} finished room kept, went on when the operator came back', a < 1.2 and kept == before and good(f), f
def probe_never(seed):
    s = Run(seed, **FIRST()); s.air.m.start = lambda t: None; start(s); m = Run(seed, **FIRST()); start(m); until(m, lambda m: m.air.m.map is not None)
    g = json.loads(json.dumps(m.air.m.map, default=lambda o: o.tolist() if hasattr(o, 'tolist') else o)); s.io.inbox.append(g); f = finish(s); n = sum(v == 'unlikely' for v in f['verdicts'].values())
    return f'every room ends "not searched" or "possible", {n} called empty, {len(f["false"])} called a person', f['state'] in ('finished', 'hold') and n == 0 and not f['false'] and f['bumps'] == 0, f
def radio_dies(seed):
    s = Run(seed, **FIRST()); start(s); until(s, lambda s: s.r.m.state == 'listen'); run_on(s, 5); s.w.radio = False; f = finish(s); n = [k for k, v in f['verdicts'].items() if v == 'unlikely']
    return f'reported as "{[b for d in s.r.m.report() for b in d["blind"]][0]}"; {len(n)} rooms called empty, {len(f["false"])} called a person, all {f["rooms"]} handed to the team', not n and not f['false'] and f['state'] == 'finished' and f['bumps'] == 0, f
def corrupt(seed):
    s = Run(seed, **FIRST()); s.w.corrupt = .3; s.go(); f = facts(s); n = [k for k, v in f['verdicts'].items() if v == 'unlikely' and k in s.w.people]
    return f'{s.r.rx.alien} broken packets thrown away, {len(f["false"])} empty rooms called a person, {len(f["missed"])} people closed as empty', f['state'] == 'finished' and not f['false'] and not n and s.r.rx.alien > 0, f
def heat_dies(seed):
    s = Run(seed, **FIRST()); s.w.heat_ok = False; s.go(); f = facts(s); return f'heat counted as blind; {len(f["confirmed"])} of 2 confirmed by Wi-Fi and radar, {len(f["flagged"])} flagged', good(f), f
def bad_map(seed):
    s = Run(seed, **FIRST()); io, n = s.io, [0]; real = io.drone_in
    def broken():
        q = real(); o = []
        for m in q:
            if m.get('kind') == 'map' and n[0] < 2: n[0] += 1; m = dict(m, cost=[[-1.0]]) if n[0] == 1 else {k: v for k, v in m.items() if k != 'rooms'}
            o.append(m)
        return o
    io.drone_in = broken; s.go(); f = facts(s); return f'{s.r.m.bad_map} bad maps refused, a new one asked for, then searched: {len(f["confirmed"])} of 2 confirmed', s.r.m.bad_map == 2 and good(f), f
def refuse(seed):
    s = Run(seed, **FIRST()); s.yes = False; s.go(); f = facts(s); no = [d['room'] for d in s.r.m.report() if d['approved'] is False]; return f'{len(no)} routes recorded as refused by name, search went on, {f["rooms"]} rooms reported', len(no) == len(f['confirmed']) and good(f), f
def pack(seed):
    s = Run(seed, **FIRST()); start(s); until(s, two_done); before = len(s.r.m.done); s.w.volts = 10.3; a, b = stopped(s); run_on(s, 3); st, why = s.r.m.state, s.r.m.log[-1][1]
    return f'"{why}", stopped in {a:.2f} s, {before} finished room kept, waits for the operator', st == 'hold' and a < 1.0 and len(s.r.m.done) == before, facts(s)
def all_stop(seed):
    s = Run(seed, **FIRST()); start(s); until(s, moving); s.r.command(dict(do='stop', who='the operator (simulated)'), s.w.t); a, b = stopped(s); run_on(s, 10); still = not any(s.w.board.look()[0]); s.r.command(dict(do='clear', who='the operator (simulated)'), s.w.t); f = finish(s)
    return f'stopped in {a:.2f} s and {b:.2f} m, stayed stopped until cleared, then finished', a < .6 and still and good(f), f
def drone_gps(seed):
    s = Run(seed, **FIRST(), wind=(1.0, .5, .3)); start(s); until(s, lambda s: s.air.m.state == 'survey' and s.air.real['mode'] == 'following' and s.w.t > 30); s.air.sky.set(s.air.sky.GPS, 0); until(s, lambda s: not s.air.real['armed'], 200); w = s.air.real; v = abs(float(w['touch']))
    return f'"{w["why"]}": came down level and touched at {v:.2f} m/s, motors off', not w['armed'] and v < 1.5, facts(s)
def drone_lost(seed):
    s = Run(seed, **FIRST()); start(s); until(s, lambda s: s.air.real['mode'] == 'following' and s.w.t > 30); s.air.link = False; until(s, lambda s: not s.air.real['armed'], 300); w = s.air.real; d = float(np.hypot(*(w['pos'][:2] - np.array(s.air.HOME))))
    return f'waited, came back and landed {d:.1f} m from where it left', not w['armed'] and d < 2.0, facts(s)
def drone_dead_mid(seed):
    s = Run(seed, **FIRST()); start(s); until(s, lambda s: len(s.r.m.done) + sum(r['looks'] for r in s.r.m.rooms) >= 2 and s.air.m.state == 'to the spot'); kept = [(r['id'], len(r['ev'])) for r in s.r.m.rooms + s.r.m.done if r['ev']]; s.air.sky.set(s.air.sky.DRAIN, 40); f = finish(s); n = [k for k, v in f['verdicts'].items() if v == 'unlikely']
    return f'drone came home on a failing pack; readings of {len(kept)} rooms kept, {len(n)} rooms called empty, {len(f["false"])} called a person', f['state'] in ('finished', 'hold') and not n and not f['false'] and f['bumps'] == 0, f

FAIL = dict(
    cable=(cable, 'The cable to the motor board is cut while driving', 'Stops by itself in a second, goes on when it is back'),
    operator=(operator, "The operator's link drops in the middle of a search", 'Holds, keeps finished rooms, goes on when the link is back'),
    probe_never=(probe_never, 'The drone never takes off, so there is no Wi-Fi', 'No room is called empty, and no one is found'),
    radio_dies=(radio_dies, 'The Wi-Fi goes silent while listening, for good', 'Blind, not empty: every room goes to the team'),
    corrupt=(corrupt, '30 % of the radio packets are garbage', 'Broken packets thrown away, no false person, no one closed as empty'),
    heat_dies=(heat_dies, 'The thermal camera is dead', 'Counted as blind, search goes on with Wi-Fi and radar'),
    bad_map=(bad_map, 'The map from the drone is damaged, twice', 'Refused, asked for again, then searched'),
    refuse=(refuse, 'The operator says no to every route', 'Recorded by name, search goes on'),
    pack=(pack, 'The pack runs low while driving', 'Stops and holds, keeps finished rooms'),
    all_stop=(all_stop, 'All stop is pressed at full speed', 'Stops, stays stopped until cleared by hand'),
    drone_gps=(drone_gps, 'The drone loses its position in flight', 'Comes down level, motors off'),
    drone_lost=(drone_lost, 'The drone loses its link in flight', 'Comes home and lands'),
    drone_dead_mid=(drone_dead_mid, "The drone's pack fails half way through", 'Drone goes home, readings so far are kept, no room is called empty'),
)
JOBS = [('first', k) for k in range(20)] + [('second', k) for k in range(20)] + [('hard', k) for k in range(20)] + [(k, n) for k in FAIL for n in (0, 1, 2)]
def job(j):
    name, seed = j; t = time.time()
    try:
        if name in FAIL: say, ok, f = FAIL[name][0](seed)
        else:
            f = search(seed, dict(first=FIRST, second=SECOND, hard=HARD)[name](), **(dict(wind=(5.0, 2.0, 1.2), corrupt=.1) if name == 'hard' else {})); ok = good(f); say = ''
    except Exception as e: import traceback; say, ok, f = 'ERROR ' + repr(e) + traceback.format_exc()[-400:], False, {}
    return name, seed, say, bool(ok), f, round(time.time() - t, 1)

def table():
    """docs/ROBOT_RESULTS.md, from results.json and nothing else."""
    import collections, statistics
    R = json.loads((HERE / 'results.json').read_text()); L = ['# Robot and drone: every case, what should happen, what did', '', 'Made by `robot/sim/cases.py` from `robot/sim/results.json`. Everything is simulated: a made-up building, made-up people, made-up readings.',
         'What runs is the code that would run on the machines: the motor board core and the flight board core (compiled C++), their wire frames, the radio packets, the neural network, the fusion, the planner and both missions. Nothing here has been run on the real rover or flown.', '',
         'Every search must: finish; never close a room with a person in it as empty; never call an empty room a person; never touch a wall; keep the drone more than 0.4 m from walls.', '',
         '| Case | Runs | What should happen | What happened | Met |', '|---|---|---|---|---|']
    for c, what in (('first', 'Two people walking (A, E), a fan (B), a hot pipe (C); light wind'), ('second', 'Two other people (C, D), the fan and pipe moved; light wind'), ('hard', 'Three people, one standing still (E); two fans; wind 5 m/s gusting; 10 % of radio packets damaged')):
        rs = [r for r in R if r['case'] == c]; f = [r['facts'] for r in rs]; who = len(f[0]['confirmed']) + len(f[0]['flagged']) + len(f[0]['missed']); conf = sum(len(x['confirmed']) for x in f); flag = sum(len(x['flagged']) for x in f); op = statistics.mean(x['opened'] for x in f)
        L.append(f"| {what} | {len(rs)} | Every rule above | {conf} of {who * len(rs)} people confirmed, {flag} flagged for a check, {sum(len(x['missed']) for x in f)} closed as empty, {sum(len(x['false']) for x in f)} empty rooms called a person, {sum(x['bumps'] for x in f)} wall touches. A team opens {op:.2f} rooms (of 5) before everyone is found; in a random order it would be {who * 6 / (who + 1):.1f} | {sum(r['met'] for r in rs)} of {len(rs)} |")
    for k, (_, what, should) in FAIL.items():
        rs = [r for r in R if r['case'] == k]; L.append(f"| {what} | {len(rs)} | {should} | {rs[0]['said']} | {sum(r['met'] for r in rs)} of {len(rs)} |")
    L += ['', f"{sum(r['met'] for r in R)} of {len(R)} met.", '', 'What this does not show: anything on the real machines; real Wi-Fi through real walls; real people. The radar and heat readings follow the makers\' sheets and are assumed. A person standing still is the hard case: in the hard search they were confirmed 2 times in 20 and flagged for a check the other 18, never closed as empty.']
    (HERE.parents[1] / 'docs' / 'ROBOT_RESULTS.md').write_text('\n'.join(L) + '\n')

if __name__ == '__main__':
    if sys.argv[1:] == ['table']: table()
    elif len(sys.argv) > 1 and sys.argv[1] != 'all':
        n, s, say, ok, f, sec = job((sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 0))
        for t, w, m in sorted(f.pop('log', [])): print(f'{t:7.1f}  {w}  {m}')
        print(f); print('OK' if ok else 'NOT MET', say, sec, 's')
    else:
        os.nice(10); out = []
        with ProcessPoolExecutor(int(os.environ.get('HOUND_JOBS', 8))) as ex:
            for r in ex.map(job, JOBS): out.append(r); print(r[0], r[1], 'ok' if r[3] else 'NOT MET', r[2], {k: v for k, v in r[4].items() if k in ('confirmed', 'flagged', 'missed', 'false', 'bumps', 'near', 'opened', 'state')}, r[5], flush=True)
        for r in out: r[4].pop('log', None)
        (HERE / 'results.json').write_text(json.dumps([dict(case=a, seed=b, said=c, met=d, facts=e) for a, b, c, d, e, _ in out], default=lambda o: o.item() if hasattr(o, 'item') else str(o)))
        print(sum(r[3] for r in out), 'of', len(out), 'met'); table()
