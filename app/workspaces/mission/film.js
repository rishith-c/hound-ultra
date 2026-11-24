// Demo mode: the search as a film. The 3-D view fills the stage; over it one headline, one instrument that changes
// with the moment, and a hairline timeline. A find gets a held beat: the film slows, the site dims, and threads join
// the person to each sensor that agreed. Every number is read from ctx.sim.state; nothing here changes the mission
// except the playback speed, the timeline (seek) and Take control.
import { createEngine } from '../../core/sim.js';
import { PRIOR } from '../../core/fusion.js';
import { whereOf } from './inspector.js';
import { crossed } from './alerts.js';

const SVG = 'http://www.w3.org/2000/svg';
const SENSOR = { csi: 'Wi-Fi network', radar: 'Radar', micro: 'Presence radar', thermal: 'Thermal camera', aerial: 'Drone image', acoustic: 'Microphone', human: 'Rescue team' };
const PACE = { standby: 1, aerial: 16, deploy: 16, search: 8, assess: 4, plan: 1, rescue: 16, complete: 1 };
const RATES = [1, 2, 4, 8, 16, 32];                       // the speeds the top bar offers
const LISTEN_PACE = 2, FIND_MS = 5600, CLOSED_MS = 3000, ROUTE_MS = 5200, READ_MS = 1500, LOOP_MS = 15000, STEPS = 25;

export function createFilm(app) {
  const { ctx } = app, { kit, sim, bus, world, nn } = ctx, { h, fmt, realityTag } = kit;

  // ---------- what comes next: the same mission, run once ahead of time in the background ----------
  // It tells the film how long the mission is, where the phases fall, and which simulated Wi-Fi window each stop hears.
  const ahead = { tEnd: 660, ticks: [], windows: {}, ready: false };
  const traces = new Map();                                    // sample index -> the network's real output on growing parts of that window
  function lookAhead() {
    const e = createEngine({ nn, windows: 'scripted', keep: { autoplay: true }, emit: (type, p) => { if (type === 'reading' && p.csi.ok) (ahead.windows[p.key] ||= []).push(p.csi.sample); } });
    let guard = 0;
    const slice = () => {
      const t0 = performance.now();
      while (!e.done && guard < 20000 && performance.now() - t0 < 5) { e.step(); guard++; }
      if (!e.done && guard < 20000) return void setTimeout(slice, 24);
      ahead.tEnd = e.state.t; ahead.ready = true;
      ahead.ticks = e.state.events.filter((ev) => ev.code === 'PHASE').map((ev) => ({ t: ev.t, text: ev.text.split('.')[0] }));
      buildTicks(); traceNext([...new Set(Object.values(ahead.windows).flat())]);
    };
    setTimeout(slice, 600);
  }
  // Run the real network on the part of the window received so far (the rest is zero, the normalised mean).
  function traceNext(todo) {
    const i = todo[0]; if (i == null) return;
    let t = traces.get(i); if (!t) traces.set(i, (t = []));
    if (t.length > STEPS) { todo.shift(); return void setTimeout(() => traceNext(todo), 30); }
    const n = Math.round((t.length / STEPS) * 200), x = nn.samples[i].x;
    t.push(nn.infer(n >= 200 ? x : x.map((row) => { const o = new Array(200).fill(0); for (let k = 0; k < n; k++) o[k] = row[k]; return o; })).person);
    setTimeout(() => traceNext(todo), 40);
  }

  // ---------- elements ----------
  const tagSlot = h('span.film-tags'), head = h('h1.film-head'), line = h('p.film-line');
  const titleBox = h('div.film-title', null, tagSlot, head, line);
  const bigNum = h('b.film-p');
  const strip = h('canvas.film-strip', { 'aria-label': 'The Wi-Fi window being collected, 52 subcarriers, and the network output on the signal so far' });
  const score = h('b.film-score', null, '–'), scoreSay = h('span.film-score-say');
  const stripHead = h('div.film-strip-head', null, h('span', null, 'Wi-Fi, 52 subcarriers, 10 s'), realityTag('live-ai'));
  const instWave = h('div.film-inst-wave', null, stripHead, h('div.film-strip-row', null, strip, h('div.film-score-box', null, score, scoreSay)));
  const figs = [0, 1, 2].map(() => { const v = h('b'), u = h('small'), l = h('span'); return { el: h('div.film-fig', null, h('div', null, v, u), l), v, u, l }; });
  const instFigs = h('div.film-inst-figs', null, ...figs.map((f) => f.el));
  const inst = h('div.film-inst', null, instWave, instFigs);
  const control = h('button.film-control', { onclick: () => takeOver() }, h('span', null, 'Take control'));
  const fill = h('i.film-rail-fill'), knob = h('i.film-rail-knob'), marks = h('div.film-rail-marks'), tip = h('span.film-rail-tip.num');
  const rail = h('div.film-rail', { tabindex: 0, role: 'slider', 'aria-label': 'Mission time. Left and right arrows move 10 seconds.', 'aria-valuemin': 0 }, h('i.film-rail-line'), fill, marks, knob, tip);
  const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('class', 'film-threads'); svg.setAttribute('aria-hidden', 'true');
  const threads = [0, 1, 2, 3].map(() => { const p = document.createElementNS(SVG, 'path'), d = document.createElementNS(SVG, 'circle'); p.setAttribute('pathLength', '1'); d.setAttribute('r', '3'); svg.append(p, d); const name = h('b'), note = h('span'), w = h('small'); return { p, d, el: h('div.film-ev', null, name, note, w), name, note, w, on: false, y: 0 }; });
  const ring = document.createElementNS(SVG, 'circle'); ring.setAttribute('class', 'film-ring'); ring.setAttribute('r', '3'); svg.append(ring);
  const dim = h('div.film-dim'), black = h('div.film-black');
  const el = h('section.mission-film.demo-only', { 'aria-label': 'The search, as a film' }, h('div.film-shade'), dim, svg, ...threads.map((t) => t.el), h('div.film-low', null, h('div.film-left', null, bigNum, titleBox), inst), h('div.film-foot', null, rail, control), black);

  // ---------- state of the film ----------
  let beat = null, lastSet = 0, userSpeed = false, shownKey = '', swap = 0, doneAt = 0, W = 1, H = 1, rect = null, dragging = false, readAt = -1e9, reading = null, cloud = null, vec = null, wasBeat = '';
  const C = {}; const colors = () => { for (const k of ['text', 'text-2', 'text-3', 'warn', 'person', 'accent']) C[k] = kit.cssVar('--' + k); C.mono = kit.cssVar('--mono'); C.font = kit.cssVar('--font'); ridges.clear(); };
  const isOn = () => app.visible && ctx.mode === 'demo';
  const now = () => performance.now();
  const set = (n, txt) => { if (n.textContent !== txt) n.textContent = txt; };

  // ---------- the scene: what is happening, in words ----------
  const detOf = (id) => sim.state.detections.find((d) => d.id === id);
  const short = (n) => n.split(/[:,]/)[0].toLowerCase().replace(/ above.*| by .*/, '');
  let wayFor = null, wayText = '';
  function wayIn(r) { // what the planned path goes around, and what it still crosses
    if (wayFor === r) return wayText; wayFor = r;
    const over = crossed(r, sim.state, world).map(short), av = r.avoided.map(short);
    return (wayText = (av.length ? 'Around the ' + av.slice(0, 2).join(' and the ') + '.' : 'Planned on the surveyed map.') + (over.length ? ' It crosses the edge of the ' + over[0] + '.' : ''));
  }
  function scene(S) {
    const r = S.units['HOUND-01'], L = S.sensors.listen, route = S.routes.rescue;
    if (S.hold) return { key: 'hold', head: 'All stop', line: 'Every unit is holding where it is. Press Resume to continue.', tags: ['sim'], inst: null };
    if (beat?.kind === 'find') { const d = detOf(beat.det), team = d?.evidence.some((e) => e.sensor === 'human'); return { key: 'find' + beat.det, head: 'Person found, ' + (d?.room ? 'room ' + d.room : 'outdoors'), line: team ? 'The drone saw a shape. The rescue team confirmed it on site.' : 'No single sensor decided this. Each one moved the odds.', tags: ['sim'], inst: null }; }
    if (beat?.kind === 'closed') { const d = detOf(beat.det); return { key: 'closed' + beat.det, head: d?.kind === 'machine' ? 'Too steady to be a person' : d?.kind === 'hot object' ? 'Too hot to be a person' : d?.kind === 'dismissed' ? 'Dismissed by the operator' : 'An alarm nothing else supports', line: d ? d.reason : '', tags: ['sim'], inst: 'odds', det: d }; }
    if (route && beat?.kind === 'route') return { key: 'plan', head: 'The way in', line: wayIn(route), tags: ['sim', 'live-algo'], inst: 'route' };
    switch (S.phase) {
      case 'standby': return { key: 'standby', head: 'A building has come down', line: 'A scout drone maps the valley first.', tags: ['sim'], inst: null };
      case 'aerial': return { key: 'aerial', head: 'Mapping the ground from above', line: 'A scout drone finds where the rover can drive.', tags: ['sim', 'concept'], inst: 'scan' };
      case 'deploy': return { key: 'deploy', head: 'The rover goes in first', line: 'HOUND-01 plans its own way past mud and the unstable slope.', tags: ['sim', 'live-algo'], inst: 'drive' };
      case 'search': case 'assess': {
        if (L || now() - readAt < READ_MS) { const key = L ? L.stop : reading?.stop, st = world.STOPS.find((s) => s.id === key); return { key: 'listen' + key, head: 'Listening through the wall', line: st ? 'Ten seconds of Wi-Fi reach ' + (st.covers.length > 1 ? 'rooms ' + st.covers.slice(0, -1).join(', ') + ' and ' + st.covers[st.covers.length - 1] : 'room ' + st.covers[0]) + '.' : 'A second ten seconds, from a better position.', tags: ['sim'], inst: 'wave' }; }
        if (S.phase === 'assess') return { key: 'assess', head: 'Taking a second look', line: 'Before anyone is sent in, the rover moves for a clear view.', tags: ['sim'], inst: 'lead' };
        return { key: 'search', head: 'Moving to the next room', line: 'It stops, stands still, and listens.', tags: ['sim'], inst: 'rooms' };
      }
      case 'plan': return { key: 'plan', head: 'The way in', line: 'The planner looks for a way around the damage.', tags: ['sim', 'live-algo'], inst: null };
      case 'rescue': return { key: 'rescue', head: 'The team follows the route', line: 'The planner chose the path. Each person is a stop on it.', tags: ['sim'], inst: 'rescue' };
      default: return { key: 'done', head: 'Everyone found has been reached', line: 'The whole search is in the log. Drag the line to see any moment again.', tags: ['sim'], inst: 'done' };
    }
  }
  function showScene(sc) {
    if (sc.key === shownKey) { set(line, sc.line); return; }
    shownKey = sc.key; clearTimeout(swap); titleBox.classList.add('swap');
    swap = setTimeout(() => { head.textContent = sc.head; line.textContent = sc.line; tagSlot.replaceChildren(...sc.tags.map((t) => realityTag(t))); titleBox.classList.remove('swap'); }, kit.reducedMotion() || !head.textContent ? 0 : 240);
  }
  function fig(i, v, unit, label) { const f = figs[i]; set(f.v, v); set(f.u, unit || ''); set(f.l, label); f.el.hidden = false; }
  let instNow = '';
  function showInst(S, sc) {
    const k = sc.inst || '', wave = k === 'wave';
    if (k !== instNow) { instNow = k; inst.classList.toggle('on', !!k); instWave.hidden = !wave && !!k; instFigs.hidden = wave; if (k && !wave) for (const f of figs) f.el.hidden = true; }
    const rover = S.units['HOUND-01'];
    if (k === 'scan') { const n = pointCount(S); if (n != null) fig(0, n.toLocaleString('en-US'), '', 'points placed'); fig(1, (S.map.scan * 100).toFixed(0), '%', 'of the site'); }
    else if (k === 'drive') { fig(0, Math.hypot(world.SITE.entrance[0] - rover.pos[0], world.SITE.entrance[1] - rover.pos[1]).toFixed(1), 'm', 'to the entrance'); fig(1, rover.odo.toFixed(0), 'm', 'driven'); }
    else if (k === 'rooms') { const cov = Object.values(S.coverage), n = cov.filter((c) => c.status !== 'unsearched' && c.status !== 'blocked').length; fig(0, n + '/' + cov.length, '', 'rooms searched'); fig(1, String(S.detections.filter((d) => d.status === 'possible').length), '', 'leads open'); }
    else if (k === 'lead') { const d = S.detections.find((q) => q.status === 'possible' && !q.needsTeam); if (d) fig(0, (d.p * 100).toFixed(0), '%', whereOf(d) + ', so far'); else figs[0].el.hidden = true; }
    else if (k === 'odds' && sc.det) fig(0, (sc.det.p * 100).toFixed(0), '%', 'chance of a person');
    else if (k === 'route') { const r = S.routes.rescue, legs = r.legs.filter((l) => l.ok); fig(0, r.length.toFixed(0), 'm', 'on foot'); fig(1, (r.etaS / 60).toFixed(1), 'min', 'at 1.1 m/s, assumed'); fig(2, String(legs.length), '', legs.length === 1 ? 'person to reach' : 'stops'); }
    else if (k === 'rescue') { const legs = S.routes.rescue.legs.filter((l) => l.ok), n = legs.filter((l) => l.arrivedAt != null).length, g = S.units['TEAM-1'].goal, p = S.units['TEAM-1'].pos; fig(0, n + '/' + legs.length, '', 'stops reached'); if (g) fig(1, Math.hypot(g[0] - p[0], g[1] - p[1]).toFixed(0), 'm', 'to the next'); else figs[1].el.hidden = true; }
    else if (k === 'done') { fig(0, String(Object.keys(S.survivors).length), '', 'people found'); fig(1, String(S.detections.filter((d) => d.status === 'rejected').length), '', 'false leads closed'); fig(2, ((S.events.findLast((e) => e.code === 'MISSION_COMPLETE')?.t ?? S.t) / 60).toFixed(1), 'min', 'of mission time'); }
  }
  // How many points of the survey cloud have landed so far (the same test the cloud's shader makes).
  let countAt = 0, countV = null;
  function pointCount(S) {
    if (now() - countAt < 160) return countV; countAt = now();
    if (!cloud) cloud = app.twin?.three?.scene?.getObjectByName('scan-cloud'); const a = cloud?.geometry?.attributes?.position?.array; if (!a) return null;
    const d = S.units['DRONE-01'], sw = S.map.swaths; let n = 0;
    for (let i = 0; i < a.length; i += 3) { const x = a[i], y = -a[i + 2]; for (let k = 0; k < sw.length; k++) { const s = sw[k]; if (Math.abs(y - s.y) > s.half) continue; let lo = s.x0, hi = s.x1; if (d.mode === 'scan' && Math.abs(s.y - d.pos[1]) < 0.5) { if (Math.cos(d.heading || 0) >= 0) hi = Math.min(hi, d.pos[0]); else lo = Math.max(lo, d.pos[0]); } if (x >= lo && x <= hi) { n++; break; } } }
    return (countV = n);
  }

  // ---------- the Wi-Fi strip: 52 subcarriers as ridge lines, and the network's output underneath ----------
  const ridges = new Map(), SW = 600, SH = 96, TH = 72; let g = null;
  function ridge(i) {
    if (ridges.has(i)) return ridges.get(i);
    const c = document.createElement('canvas'); c.width = SW * 2; c.height = SH * 2; const q = c.getContext('2d'); q.scale(2, 2); q.lineJoin = 'round';
    const x = nn.samples[i].x;
    for (let r = 0; r < 52; r++) {
      const base = 12 + (r / 51) * (SH - 16); q.beginPath();
      for (let k = 0; k < 200; k++) { const v = Math.max(-3, Math.min(3, x[r][k])); q[k ? 'lineTo' : 'moveTo']((k / 199) * SW, base - v * 4.2); }
      let s = 0; for (let k = 0; k < 200; k++) s += Math.abs(x[r][k]); s = Math.min(1, s / 200);
      q.strokeStyle = C.text; q.globalAlpha = 0.22 + 0.62 * s * (0.45 + 0.55 * (r / 51)); q.lineWidth = 0.75; q.stroke();
    }
    ridges.set(i, c); return c;
  }
  function drawStrip(S) {
    const L = S.sensors.listen, sample = L ? ahead.windows[L.stop]?.[L.window - 1] : reading?.sample, f = L ? L.progress : 1;
    if (!g) { strip.width = SW * 2; strip.height = (SH + TH) * 2; g = strip.getContext('2d'); g.scale(2, 2); }
    g.clearRect(0, 0, SW, SH + TH);
    const X = f * SW, thr = nn.threshold, y = (p) => SH + TH - 5 - p * (TH - 12);
    g.globalAlpha = 1;
    if (sample != null) { const im = ridge(sample), w = Math.max(1, X * 2); g.drawImage(im, 0, 0, w, SH * 2, 0, 0, w / 2, SH); }
    g.strokeStyle = C['text-3']; g.globalAlpha = 0.5; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y(0) + 0.5); g.lineTo(SW, y(0) + 0.5); g.stroke();
    g.strokeStyle = C.warn; g.globalAlpha = 0.85; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(0, y(thr)); g.lineTo(SW, y(thr)); g.stroke(); g.setLineDash([]);
    g.fillStyle = C.warn; g.font = '500 11px ' + C.font; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.globalAlpha = 0.9; g.fillText('alarm line ' + thr.toFixed(2), SW, y(thr) - 2);
    const tr = sample != null ? traces.get(sample) : null; let val = null;
    if (tr && tr.length > 1) {
      const last = Math.min(tr.length - 1, STEPS), upto = Math.min(last, f * STEPS); g.beginPath();
      for (let k = 0; k <= Math.floor(upto); k++) g[k ? 'lineTo' : 'moveTo']((k / STEPS) * SW, y(tr[k]));
      const a = Math.floor(upto), b = Math.min(last, a + 1); val = tr[a] + (tr[b] - tr[a]) * (upto - a); g.lineTo((upto / STEPS) * SW, y(val));
      g.globalAlpha = 1; g.strokeStyle = val > thr ? C.warn : C.text; g.lineWidth = 1.6; g.stroke();
      g.fillStyle = val > thr ? C.warn : C.text; g.beginPath(); g.arc((upto / STEPS) * SW, y(val), 3, 0, 7); g.fill();
    }
    if (L) { g.globalAlpha = 0.9; g.fillStyle = C.text; g.fillRect(X - 0.5, 4, 1, SH + TH - 8); }
    if (!L && reading) val = reading.person;                    // the reading that counts: the whole window
    g.globalAlpha = 1;
    set(score, val == null ? '–' : val.toFixed(2)); score.classList.toggle('over', val != null && val > thr);
    set(scoreSay, L ? 'so far' : reading?.ok === false ? 'rejected' : reading?.says ? 'person' : 'no one');
  }

  // ---------- the held beat ----------
  function hold(kind, det, ms) { beat = { kind, det, until: now() + ms, t0: now() }; }
  function startFind(det) {
    const d = detOf(det); if (!d) return;
    hold('find', det, FIND_MS);
    const seen = new Set(), list = []; let prev = PRIOR;
    for (const s of d.steps) { if (['pos', 'faint'].includes(s.result) && SENSOR[s.sensor] && !seen.has(s.sensor)) { seen.add(s.sensor); list.push({ s, from: prev }); } prev = s.p; }
    beat.list = list.slice(-4); beat.p = d.p; beat.pos = d.pos; beat.h = sim.state.survivors[d.survivorId]?.motion === 'moving' ? 1.2 : 0.12; // a standing chest, or someone lying down
    threads.forEach((t, i) => { const it = beat.list[i]; t.on = !!it; t.el.classList.remove('in'); t.p.classList.remove('in'); t.d.classList.remove('in'); if (!it) return; set(t.name, SENSOR[it.s.sensor]); set(t.note, it.s.note || ''); set(t.w, it.s.assumed ? 'weight assumed' : 'weight measured in simulation'); });
    placeThreads();
  }
  function placeThreads() { const n = beat?.list?.length || 0; if (!n) return; const x = Math.round(W * 0.665), gap = Math.min(104, (H - 330) / n), y0 = Math.round(H * 0.42 - (gap * (n - 1)) / 2); threads.forEach((t, i) => { if (!t.on) return; t.x = x; t.y = y0 + i * gap; t.el.style.transform = 'translate3d(' + (x + 18) + 'px,' + (t.y - 11) + 'px,0)'; t.d.setAttribute('cx', x); t.d.setAttribute('cy', t.y); }); }
  function frameFind() {
    const on = beat?.kind === 'find';
    if (on !== (wasBeat === 'find')) { wasBeat = on ? 'find' : ''; el.classList.toggle('find', on); app.applySafe(); if (!on) for (const t of threads) { t.p.classList.remove('in'); t.el.classList.remove('in'); t.d.classList.remove('in'); } }
    if (!on) return;
    const cam = app.view === '3d' && app.twin?.three?.camera, age = now() - beat.t0; let x = W * 0.36, y = H * 0.42;
    if (cam && beat.pos) { vec ||= cam.position.clone(); vec.set(beat.pos[0], beat.h, -beat.pos[1]).project(cam); if (vec.z < 1) { x = (vec.x * 0.5 + 0.5) * W; y = (-vec.y * 0.5 + 0.5) * H; } }
    dim.style.transform = 'translate3d(' + (x - 1800).toFixed(1) + 'px,' + (y - 1800).toFixed(1) + 'px,0)';
    ring.setAttribute('cx', x.toFixed(1)); ring.setAttribute('cy', y.toFixed(1));
    let p = PRIOR, n = beat.list.length;
    for (let i = 0; i < n; i++) {
      const t = threads[i], a = age - 700 - i * 480; if (a > 0 && !t.p.classList.contains('in')) { t.p.classList.add('in'); t.d.classList.add('in'); t.el.classList.add('in'); }
      const x0 = x, mx = x0 + (t.x - x0) * 0.55; t.p.setAttribute('d', 'M' + x0.toFixed(1) + ' ' + y.toFixed(1) + ' C' + mx.toFixed(1) + ' ' + y.toFixed(1) + ' ' + mx.toFixed(1) + ' ' + t.y + ' ' + t.x + ' ' + t.y);
      const k = Math.max(0, Math.min(1, (a - 200) / 420)), to = i === n - 1 ? beat.p : beat.list[i].s.p; if (k > 0) { const e = 1 - (1 - k) ** 3; p = p + (to - p) * e; }
    }
    set(bigNum, Math.round(p * 100) + ' %');
  }

  // Ground overlays are kept out of the close shots, where the person is the only warm thing in the frame.
  const worn = {};
  function dress(sc) {
    const k = sc.key, want = { hazards: ['standby', 'aerial', 'deploy', 'plan', 'done'].includes(k), coverage: ['search', 'assess', 'plan', 'done'].includes(k) || sc.inst === 'wave' };
    for (const id in want) if (worn[id] !== want[id] && app.twin) { worn[id] = want[id]; app.demoLayer(id, want[id]); }
  }

  // ---------- pace ----------
  let cur = 0, routeDue = false;
  function pace(S) {
    if (userSpeed || !S.autoplay || !S.running) return;
    let want = PACE[S.phase] ?? 8;
    if (!app.twin && !app.twinFailed) want = 1;                 // wait for the 3-D site before the story starts
    else if (beat) want = 1;
    else if (S.sensors.listen) want = LISTEN_PACE;
    else if (now() - readAt < READ_MS) want = 1;
    if (!cur) cur = S.speed;
    cur = want < cur ? want : Math.min(want, cur * 1.2 + 0.1); // brake at once, pull away gently
    let v = RATES[0]; for (const r of RATES) if (r <= cur + 0.01) v = r;
    if (v !== S.speed) { lastSet = v; sim.setSpeed(v); }
  }
  function release() { if (lastSet && !userSpeed) { sim.setSpeed(8); } lastSet = 0; cur = 0; }

  // ---------- timeline ----------
  const span = () => Math.max(ahead.tEnd, sim.state.t);
  function buildTicks() { marks.replaceChildren(...ahead.ticks.slice(1).map((k) => h('i', { style: { left: (k.t / span()) * 100 + '%' }, title: k.text }))); finds = -1; }
  let finds = -1, findEls = [];
  function frameRail(S) {
    const f = Math.min(1, S.t / span()); fill.style.transform = 'scaleX(' + f.toFixed(5) + ')'; knob.style.transform = 'translate3d(' + (f * railW).toFixed(1) + 'px,0,0)';
    if (S.events.length !== finds) { finds = S.events.length; findEls.forEach((n) => n.remove()); findEls = S.events.filter((e) => e.code === 'PERSON_FOUND').map((e) => h('i.find', { style: { left: (e.t / span()) * 100 + '%' }, title: e.text })); marks.append(...findEls); }
  }
  let railW = 1, seekAt = 0, seekT = null;
  const timeAt = (e) => { const r = rail.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * span(); };
  const seekTo = (t) => { seekT = t; if (now() - seekAt > 140) { seekAt = now(); seekT = null; sim.seek(t); } };
  const showTip = (t) => { const k = ahead.ticks.filter((q) => q.t <= t).pop(); set(tip, fmt.clock(t) + (k ? '  ' + k.text : '')); tip.style.transform = 'translate3d(' + ((t / span()) * railW).toFixed(0) + 'px,0,0) translateX(-50%)'; };
  rail.addEventListener('pointerdown', (e) => { rail.setPointerCapture(e.pointerId); dragging = true; seekTo(timeAt(e)); showTip(timeAt(e)); });
  rail.addEventListener('pointermove', (e) => { showTip(timeAt(e)); if (dragging) seekTo(timeAt(e)); });
  rail.addEventListener('pointerup', (e) => { dragging = false; if (seekT != null) { sim.seek(seekT); seekT = null; } });
  rail.addEventListener('keydown', (e) => { const d = { ArrowLeft: -10, ArrowRight: 10 }[e.key]; if (d) { e.preventDefault(); e.stopPropagation(); sim.seek(Math.max(0, Math.min(span(), sim.state.t + d))); } });

  function takeOver() {
    if (!sim.state.autoplay) { app.setAutoplay(true); return; }
    app.takeControl(); ctx.setMode('advanced');
  }

  // ---------- the loop ----------
  function slow() {
    const S = sim.state; if (!isOn()) return;
    if (beat && now() > beat.until) { const r = S.routes.rescue, next = beat.kind === 'find' && routeDue && r; beat = null; if (next) hold('route', null, ROUTE_MS); routeDue = false; }
    pace(S); const sc = scene(S); showScene(sc); dress(sc); showInst(S, sc);
    rail.setAttribute('aria-valuenow', S.t.toFixed(0)); rail.setAttribute('aria-valuetext', fmt.clock(S.t) + ', ' + sc.head); rail.setAttribute('aria-valuemax', span().toFixed(0));
    set(control.firstChild, S.autoplay ? 'Take control' : 'Let it play');
    if (S.phase === 'complete' && S.autoplay && S.running && !beat) { if (!doneAt) doneAt = now(); if (now() - doneAt > LOOP_MS && !dragging) { black.classList.add('on'); doneAt = now() + 4000; setTimeout(() => { if (isOn() && sim.state.phase === 'complete') app.restart(); setTimeout(() => black.classList.remove('on'), 250); }, 800); } }
    else if (S.phase !== 'complete') doneAt = 0;
  }
  function frame() { if (!isOn()) return; const S = sim.state; frameRail(S); if (instNow === 'wave') drawStrip(S); frameFind(); }
  function resize(w, hgt) { W = w; H = hgt; railW = rail.clientWidth || 1; placeThreads(); svg.setAttribute('width', W); svg.setAttribute('height', H); }

  bus.on('event', (ev) => {
    if (!isOn() || !sim.state.autoplay) return;
    if (ev.code === 'PERSON_FOUND' && ev.det) startFind(ev.det);
    else if (ev.code === 'LEAD_CLOSED' && ev.det && beat?.kind !== 'find') hold('closed', ev.det, CLOSED_MS);
    if (beat) slow();
  });
  bus.on('route', (r) => { if (!isOn() || !sim.state.autoplay || r?.status !== 'planned') return; if (beat?.kind === 'find') routeDue = true; else hold('route', null, ROUTE_MS); slow(); });
  bus.on('reading', (p) => { if (!isOn()) return; reading = { stop: p.key, ok: !!p.csi.ok, person: p.csi.person, says: !!p.csi.says, sample: p.csi.sample }; readAt = now(); if (p.csi.ok && !traces.has(p.csi.sample)) traceNext([p.csi.sample]); slow(); });
  const clear = () => { beat = null; routeDue = false; readAt = -1e9; cur = 0; doneAt = 0; instNow = '-'; finds = -1; slow(); };
  bus.on('seek', clear); bus.on('reset', () => { userSpeed = false; clear(); });
  bus.on('speed', (v) => { if (isOn() && v !== lastSet) userSpeed = true; });
  colors(); bus.on('prefs', () => { colors(); });
  lookAhead();
  return { el, slow, frame, resize, release, get find() { return beat?.kind === 'find'; }, reset() { beat = null; cur = 0; for (const id in worn) delete worn[id]; wasBeat = ''; el.classList.remove('find'); } };
}
