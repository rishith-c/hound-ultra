// The inspector: whatever is selected, explained. With nothing selected it shows the rover's live sensor stack.
import { LR, THRESHOLDS, PRIOR } from '../../core/fusion.js';
import { roomCover } from './map2d.js';
import { drawWindow, drawRadar, drawThermal } from './sensors.js';

const RESULT_WORD = { pos: 'detected', neg: 'nothing found', faint: 'faint sign', blind: 'could not see', none: 'nothing, as expected', machine: 'looks like a machine', tooHot: 'too hot for a person' };
const SENSOR_NAME = { csi: 'Wi-Fi network', radar: 'Radar', micro: 'Presence radar', thermal: 'Thermal camera', signature: 'Motion pattern', temperature: 'Temperature check', aerial: 'Drone image', acoustic: 'Tapping or voice', human: 'Rescue team' };
const AGREE = { csi: 'Wi-Fi network', radar: 'radar', micro: 'presence radar', thermal: 'thermal camera', aerial: 'drone image', acoustic: 'microphone', human: 'rescue team' };
const MODE = { idle: 'Waiting', drive: 'Driving', listen: 'Listening', hold: 'Holding', fault: 'Link lost, holding', swap: 'Waiting for a battery', takeoff: 'Taking off', scan: 'Surveying', return: 'Returning', landed: 'Landed' };

// "Wi-Fi network and radar agree." Built only from the sensors that reported a positive sign.
export function agreement(d) {
  const names = [...new Set(d.evidence.filter((e) => ['pos', 'faint'].includes(e.result) && AGREE[e.sensor]).map((e) => AGREE[e.sensor]))];
  if (!names.length) return '';
  if (names.length === 1) return 'Based on the ' + names[0] + ' alone.';
  const s = names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] + ' agree.';
  return s[0].toUpperCase() + s.slice(1);
}
export const whereOf = (d) => (d.room ? 'room ' + d.room : d.outdoor ? 'the debris field outdoors' : 'this stop');

export function createInspector(app) {
  const { ctx } = app, { kit, sim, world, bus } = ctx, { h, icon, fmt, realityTag } = kit;
  const body = h('div.mission-insp-body');
  const title = h('h3', null, 'Sensors');
  const tagSlot = h('span.mission-insp-tag');
  const back = h('button.btn.btn-ghost.btn-sm', { 'aria-label': 'Clear the selection and show the live sensors', title: 'Back to live sensors', hidden: true, onclick: () => ctx.select(null) }, icon('close'));
  let sig = '', live = null, C = {};
  const put = (...nodes) => body.replaceChildren(...nodes.flat(3).filter((n) => n != null && n !== false));
  const colors = () => { const v = (n) => kit.cssVar(n); C = { text: v('--text'), text2: v('--text-2'), text3: v('--text-3'), mono: v('--mono'), font: v('--font') }; };
  colors();
  const pct = (p) => (p * 100).toFixed(p > 0.995 || p < 0.005 ? 1 : 0) + ' %';
  const link = (text, sel) => h('button.mission-link', { onclick: () => app.select(sel, true) }, text);
  const row = (k, v) => [h('dt', null, k), h('dd', null, v)];
  const logit = (p) => Math.log(p / (1 - p)), LO = logit(0.01), HI = logit(0.995), pos = (p) => Math.max(0, Math.min(100, ((logit(Math.max(0.001, Math.min(0.999, p))) - LO) / (HI - LO)) * 100));

  // ---------- live sensor stack ----------
  function sensorsView() {
    const S = sim.state;
    const win = h('canvas.mission-win', { width: 400, height: 104, 'aria-label': 'The Wi-Fi window' });
    const winState = h('div.mission-sub'), bar = h('i'), packets = h('span.num');
    const gaugeMark = h('i.mission-gauge-mark'), gaugeVal = h('b.num', null, '–'), gaugeSay = h('span', null, ''), moving = h('span.mission-sub');
    const thr = ctx.nn.threshold;
    const gauge = h('div.mission-gauge', { role: 'img' }, h('i.mission-gauge-thr', { style: { left: thr * 100 + '%' } }), gaugeMark);
    const radar = h('canvas.mission-radar'), radarCap = h('div.mission-cap'), thermal = h('canvas.mission-thermal'), thermalCap = h('div.mission-cap');
    const tofF = h('i'), tofR = h('i'), tofFv = h('span.num'), tofRv = h('span.num'), micro = h('span');
    const asOf = h('p.mission-sub');
    const openSense = h('button.mission-link', { onclick: () => ctx.shell.open('sense', sim.state.sensors.csi?.sample != null ? { sample: sim.state.sensors.csi.sample } : {}) }, 'Open in Wi-Fi AI');
    put(
      h('section.mission-sec', null,
        h('header', null, h('h4', null, 'Wi-Fi sensing'), realityTag('live-ai')),
        win, h('div.mission-axis', null, h('span', null, '52 subcarrier rows'), h('span', null, '10 s of signal, 100 probes a second')),
        h('div.row', null, h('div.bar.grow', null, bar), packets), winState,
        h('div.mission-out', null, h('div', null, h('span.dim', null, 'Network output'), gaugeVal, gaugeSay), gauge, h('div.mission-axis', null, h('span', null, '0  no one'), h('span', { style: { position: 'absolute', left: thr * 100 + '%', transform: 'translateX(-50%)' } }, 'alarm line ' + thr.toFixed(2)), h('span', null, 'person  1'))),
        h('div.row', null, moving, h('span.grow'), openSense)),
      h('section.mission-sec', null,
        h('header', null, h('h4', null, 'Radar and thermal'), realityTag('sim')),
        h('div.mission-duo', null, h('div', null, radar, radarCap), h('div', null, thermal, thermalCap)),
        h('div.mission-micro', null, icon('signals', 14), micro)),
      h('section.mission-sec', null,
        h('header', null, h('h4', null, 'Distance to obstacles'), realityTag('sim')),
        h('div.mission-tof', null, h('span.dim', null, 'Front'), h('div.bar', null, tofF), tofFv, h('span.dim', null, 'Rear'), h('div.bar', null, tofR), tofRv)),
      asOf);
    let lastKey = '';
    live = () => {
      const S = sim.state, L = S.sensors.listen, c = S.sensors.csi, rover = S.units['HOUND-01'];
      const fresh = S.sensors.at != null;
      const key = [L ? 'L' + L.window + Math.round(L.progress * 100) : 'idle', S.sensors.at, S.t < 1].join('|');
      if (key === lastKey) return; lastKey = key;
      if (L) {
        drawWindow(win, { nn: ctx.nn, progress: L.progress });
        bar.style.width = L.progress * 100 + '%'; packets.textContent = Math.round(L.progress * 1000).toLocaleString('en') + ' / 1,000 packets';
        winState.textContent = 'Collecting window ' + L.window + ' at ' + L.stop + '. The network needs the full 10 seconds, and the rover must stand still.';
      } else if (c?.ok) {
        drawWindow(win, { nn: ctx.nn, sample: c.sample }); bar.style.width = '100%'; packets.textContent = '1,000 packets';
        winState.textContent = 'Last window, read at ' + c.stop + ' at ' + fmt.clock(c.t) + '. It is simulated test window ' + c.sample + ' of 30; the network that read it is the real one.';
      } else {
        drawWindow(win, { nn: ctx.nn }); bar.style.width = '0%'; packets.textContent = '';
        winState.textContent = c && !c.ok ? c.reason + ' The answer waits for a full window.' : 'No window yet. HOUND-01 listens for 10 seconds each time it stops.';
      }
      if (c?.ok && !L) { gaugeMark.hidden = false; gaugeMark.style.left = c.person * 100 + '%'; gaugeMark.dataset.says = c.says ? 'person' : 'none'; gaugeVal.textContent = c.person.toFixed(2); gaugeSay.textContent = c.says ? 'Person' : 'No one'; gaugeSay.className = 'tag ' + (c.says ? 'tag-warn' : ''); moving.textContent = 'Moving ' + c.moving.toFixed(2) + ' · ran in ' + (c.ms < 0.1 ? 'under 0.1' : c.ms.toFixed(1)) + ' ms here'; gauge.setAttribute('aria-label', 'Network output ' + c.person.toFixed(2) + ', alarm line ' + thr.toFixed(2)); }
      else { gaugeMark.hidden = true; gaugeVal.textContent = L ? '…' : '–'; gaugeSay.textContent = ''; gaugeSay.className = ''; moving.textContent = L ? 'Waiting for the window to finish' : ''; }
      // radar and thermal
      for (const cv of [radar]) { const r = cv.getBoundingClientRect(); if (r.width) { const dpr = Math.min(2, devicePixelRatio || 1); cv.width = r.width * dpr; cv.height = r.height * dpr; } }
      const n = drawRadar(radar, { S, world, C, live: fresh });
      radarCap.textContent = !fresh ? 'Radar: no reading yet' : n ? n + ' moving target' + (n > 1 ? 's' : '') : 'No moving target';
      const th = S.sensors.thermal; drawThermal(thermal, { thermal: th, world, live: fresh });
      thermalCap.textContent = !fresh ? 'Thermal: no reading yet' : !th?.ok ? 'Thermal camera offline' : th.blobs.length ? 'Warmest shape ' + Math.max(...th.blobs.map((b) => b.tempC)).toFixed(1) + ' °C' : 'No warm shape, ' + th.ambientC.toFixed(1) + ' °C room';
      thermal.classList.toggle('off', fresh && !th?.ok);
      micro.textContent = !fresh ? 'Presence radar: no reading yet.' : S.sensors.micro?.still ? 'Presence radar: small rhythmic motion close by.' : 'Presence radar: no breathing-sized motion.';
      const tof = S.sensors.tof; tofF.style.width = tof ? Math.min(100, (tof.front / 4) * 100) + '%' : '0%'; tofR.style.width = tof ? Math.min(100, (tof.rear / 4) * 100) + '%' : '0%'; tofFv.textContent = tof ? tof.front.toFixed(2) + ' m' : '–'; tofRv.textContent = tof ? tof.rear.toFixed(2) + ' m' : '–';
      asOf.textContent = fresh ? 'Radar, thermal and distance values are from the last stop (' + S.sensors.stop + ', ' + fmt.clock(S.sensors.at) + ') and are simulated. Their reach is a design value.' : 'Select anything on the map or the timeline to inspect it here.';
    };
    live();
  }

  // ---------- a lead or a person ----------
  function waterfall(d) {
    const rows = [h('div.mission-wf-row.start', null, h('span', null, 'Before any reading'), h('div.mission-wf-track', null, h('i.mission-wf-dot', { style: { left: pos(PRIOR) + '%' } })), h('span.num', null, pct(PRIOR)))];
    let prev = PRIOR;
    for (const s of d.steps) {
      const a = pos(prev), b = pos(s.p), up = s.lr > 1.001, down = s.lr < 0.999;
      rows.push(h('div.mission-wf-row' + (up || down ? '' : '.flat'), { title: (LR[s.sensor]?.label || s.sensor) + ': ' + (s.note || '') + '. Weight ×' + s.lr.toFixed(2) + (s.repeat ? ' (repeat reading from the same place, counted at half weight)' : '') + (s.assumed ? '. Design value.' : '. Measured on the 955 simulated test windows.') },
        h('span', null, SENSOR_NAME[s.sensor] || s.sensor, h('small', null, RESULT_WORD[s.result] || s.result)),
        h('div.mission-wf-track', null, up || down ? h('i.mission-wf-bar' + (up ? '.up' : '.down') + (s.assumed ? '.assumed' : ''), { style: { left: Math.min(a, b) + '%', width: Math.max(0.8, Math.abs(b - a)) + '%' } }) : h('i.mission-wf-dot.none', { style: { left: b + '%' } })),
        h('span.num', null, up || down ? '×' + (s.lr >= 10 ? s.lr.toFixed(0) : s.lr.toFixed(2)) : '×1', h('small', null, pct(s.p)))));
      prev = s.p;
    }
    const cls = d.p >= THRESHOLDS.confirmed ? 'person' : d.p >= THRESHOLDS.possible ? 'warn' : 'closed';
    rows.push(h('div.mission-wf-row.end', null, h('span', null, 'Result'), h('div.mission-wf-track', null, h('i.mission-wf-dot.' + cls, { style: { left: pos(d.p) + '%' } })), h('span.num', null, pct(d.p))));
    const wf = h('div.mission-wf', null,
      h('div.mission-wf-scale', null, h('span'), h('div.mission-wf-track', null, h('em', { style: { left: 'calc(var(--p15) / 2)' } }, 'closed'), h('em', { style: { left: 'calc((var(--p15) + var(--p85)) / 2)' } }, 'possible'), h('em.p', { style: { left: 'calc((var(--p85) + 100%) / 2)' } }, 'person'), h('i', { style: { left: 'var(--p15)' } }, '15 %'), h('i', { style: { left: 'var(--p85)' } }, '85 %')), h('span')),
      ...rows);
    wf.style.setProperty('--p15', pos(THRESHOLDS.possible) + '%'); wf.style.setProperty('--p85', pos(THRESHOLDS.confirmed) + '%');
    return wf;
  }
  function detectionView(d, S) {
    const sv = d.survivorId && S.survivors[d.survivorId], reached = sv?.status === 'reached';
    const state = d.status === 'confirmed' ? { cls: 'tag-person', word: reached ? 'Person reached' : 'Person found', col: 'person' } : d.status === 'possible' ? { cls: 'tag-warn', word: d.needsTeam ? 'Possible, team to check' : 'Possible person', col: 'warn' } : { cls: '', word: 'Lead closed', col: 'closed' };
    title.textContent = d.room ? world.roomById(d.room)?.name || 'Room ' + d.room : d.outdoor ? 'Debris field, outdoors' : 'Lead ' + d.id;
    tagSlot.replaceChildren(h('span.tag.' + (state.cls || 'plain'), null, state.word));
    const groups = []; for (const e of d.evidence) { const k = e.vantage + '|' + e.t; let gp = groups.find((x) => x.k === k); if (!gp) groups.push((gp = { k, t: e.t, vantage: e.vantage, unit: e.unit, items: [] })); gp.items.push(e); }
    const vantageName = (v) => (v === 'aerial' ? 'Drone pass' : v === 'team' ? 'Rescue team on site' : /^S\d/.test(v) ? 'Stop ' + v : /^V\d/.test(v) ? 'Second look ' + v.slice(1) : v);
    const canAct = d.status === 'possible' && S.phase === 'assess' && !d.needsTeam;
    const why = d.status === 'confirmed' ? agreement(d) : d.reason;
    put(
      h('div.mission-hero.' + state.col, null,
        h('b.num', null, pct(d.p)), h('div', null, h('span', null, d.status === 'rejected' ? 'chance a person is here' : 'confidence that a person is here'), h('p', null, why))),
      d.status === 'possible' ? h('p.note.warn', null, d.needsTeam ? 'The rescue team checks this one in person.' : d.reason + ' The lead stays open down to 15 %, so every person gets a second look.') : null,
      h('dl.kv.mission-kv', null,
        ...row('Position', d.pos ? [h('span.num', null, fmt.pos(d.pos) + ' m'), d.posSigma ? h('span.dim', null, '  ± ' + d.posSigma.toFixed(1) + ' m') : null] : 'unknown'),
        ...row('First seen', h('span.num', null, fmt.clock(d.t) + (d.stop ? ' · ' + vantageName(d.stop) : ''))),
        ...(sv ? row('Movement', sv.motion === 'moving' ? 'Moving' : 'Still') : []),
        ...(sv?.reachedAt != null ? row('Team arrived', h('span.num', null, fmt.clock(sv.reachedAt))) : []),
        ...row('Windows', h('span.num', null, String(d.windows)))),
      h('section.mission-sec', null,
        h('header', null, h('h4', null, 'How the number was reached'), realityTag('live-algo')),
        waterfall(d),
        h('p.mission-sub', null, h('i.mission-key.solid'), 'weight measured on the 955 simulated test windows  ', h('i.mission-key.hollow'), 'design value')),
      h('section.mission-sec', null,
        h('header', null, h('h4', null, 'Evidence'), h('span.dim', null, d.evidence.length + ' readings')),
        ...groups.map((gp) => h('div.mission-ev-group', null,
          h('div.mission-ev-head', null, h('span.num', null, fmt.clock(gp.t)), /^S\d/.test(gp.vantage) ? link(vantageName(gp.vantage), { type: 'stop', id: gp.vantage }) : h('span', null, vantageName(gp.vantage)), h('button.mission-link', { title: 'Move the mission clock to this reading', onclick: () => sim.seek(gp.t + 0.1) }, 'Go to')),
          ...gp.items.map((e) => h('div.mission-ev.' + (['pos', 'faint'].includes(e.result) ? 'for' : ['neg', 'machine', 'tooHot'].includes(e.result) ? 'against' : 'blind'), null,
            h('span', null, SENSOR_NAME[e.sensor] || e.sensor), h('p', null, e.note, e.sensor === 'csi' && e.sample != null ? [' ', h('button.mission-link', { onclick: () => ctx.shell.open('sense', { sample: e.sample }) }, 'window ' + e.sample)] : null),
            h('small', { title: LR[e.sensor]?.assumed === false ? 'This weight was measured on the 955 simulated test windows.' : 'This weight is a design value.' }, LR[e.sensor]?.assumed === false ? 'measured' : 'design value')))))),
      h('div.row.wrap', null,
        canAct ? h('button.btn.btn-sm', { onclick: () => app.act('investigate', { id: d.id }) }, 'Send the rover for a second look') : null,
        d.status === 'possible' ? h('button.btn.btn-sm', { onclick: () => app.dismiss(d) }, 'Dismiss lead') : null,
        h('button.btn.btn-sm', { onclick: () => ctx.shell.open('graph', { detection: d.id }) }, 'Evidence graph'),
        h('button.btn.btn-sm', { onclick: () => ctx.shell.open('fusion', { detection: d.id }) }, 'Fusion in depth')));
  }

  function roomView(r, S) {
    const cv = roomCover(S, r.id) || { status: 'unsearched', reach: 0, residual: PRIOR, note: '' }, door = world.DOORS.find((d) => d.room === r.id);
    const st = { unsearched: ['plain', 'Not searched'], clear: ['tag-ok', 'Clear'], lead: ['tag-warn', 'Lead open'], person: ['tag-person', 'Person found'], blocked: ['plain', 'Not reached'] }[cv.status];
    title.textContent = r.name; tagSlot.replaceChildren(h('span.tag.' + st[0], null, st[1]));
    const leads = S.detections.filter((d) => d.room === r.id);
    const words = cv.status === 'clear' ? [h('b.num', null, pct(cv.residual)), h('div', null, h('span', null, 'chance a person is still here'), h('p', null, cv.note))]
      : cv.status === 'person' || cv.status === 'lead' ? [h('b.num', null, pct(cv.residual)), h('div', null, h('span', null, 'chance a person is here'), h('p', null, cv.note))]
      : [h('b.num', null, pct(cv.residual)), h('div', null, h('span', null, 'chance a person is here (start value)'), h('p', null, cv.note))];
    put(
      h('div.mission-hero.' + (cv.status === 'person' ? 'person' : cv.status === 'lead' ? 'warn' : cv.status === 'clear' ? 'ok' : 'closed'), null, ...words),
      h('section.mission-sec', null,
        h('header', null, h('h4', null, 'Coverage'), realityTag('live-algo')),
        h('div.row', null, h('div.bar.grow', null, h('i', { style: { width: cv.reach * 100 + '%' } })), h('span.num', null, pct(cv.reach))),
        h('p.mission-sub', null, cv.status === 'unsearched' || cv.status === 'blocked' ? 'The sensors have not reached this room.' : 'The Wi-Fi reach (6.5 m, through one wall) covered ' + pct(cv.reach) + ' of the floor from where the rover stood. The rest of the floor keeps the starting 10 %, so it stays on the list.'),
        h('dl.kv.mission-kv', null,
          ...(cv.stop ? row('Searched from', /^S\d/.test(cv.stop) ? link('Stop ' + cv.stop, { type: 'stop', id: cv.stop }) : cv.stop) : []),
          ...(cv.t != null ? row('Last reading', h('span.num', null, fmt.clock(cv.t))) : []),
          ...row('Door', door?.blocked ? 'Blocked by debris' : 'Open'),
          ...row('Size', h('span.num', null, (r.rect[2] - r.rect[0]) + ' × ' + (r.rect[3] - r.rect[1]) + ' m')))),
      leads.length ? h('section.mission-sec', null, h('header', null, h('h4', null, 'Leads in this room')), ...leads.map((d) => h('button.mission-item', { onclick: () => app.select({ type: 'detection', id: d.id }, true) }, h('i.mission-dot.' + (d.status === 'confirmed' ? 'person' : d.status === 'possible' ? 'warn' : 'closed')), h('span.grow', null, d.status === 'confirmed' ? 'Person' : d.status === 'possible' ? 'Possible person' : 'Closed: ' + d.kind), h('span.num', null, pct(d.p))))) : null,
      h('p.mission-sub', null, 'The search starts every room at 10 %. Residual risk is computed from the same fusion weights as the leads.'));
  }

  function unitView(u, S) {
    title.textContent = u.name; tagSlot.replaceChildren(u.kind === 'rover' ? realityTag('sim') : realityTag(u.kind === 'drone' ? 'concept' : 'sim'));
    const spark = h('canvas.mission-spark'), left = u.path && u.goal ? Math.hypot(u.goal[0] - u.pos[0], u.goal[1] - u.pos[1]) : null;
    const vals = { mode: h('dd'), bat: h('i'), batv: h('span.num'), link: h('i'), linkv: h('span.num'), pos: h('dd.num'), head: h('dd.num'), odo: h('dd.num'), alt: h('dd.num') };
    put(
      h('p.mission-lede', null, u.kind === 'rover' ? 'The rover exists as hardware: four stepper motors on mecanum wheels, a Raspberry Pi 4 and an Arduino that stops the motors by itself 400 ms after the Pi goes quiet. Its motion here is simulated.' : u.kind === 'drone' ? 'A concept. The scout drone and its survey are simulated to show how a map from above would feed the search.' : 'The rescue team and its movement are simulated. In this exercise the team walks only a route a person has approved.'),
      h('dl.kv.mission-kv', null, h('dt', null, 'Doing now'), vals.mode,
        ...(u.kind === 'rover' ? [h('dt', null, 'Battery'), h('dd.row', null, h('div.bar.grow', null, vals.bat), vals.batv), h('dt', null, 'Radio link'), h('dd.row', null, h('div.bar.grow', null, vals.link), vals.linkv)] : []),
        h('dt', null, 'Position'), vals.pos, h('dt', null, 'Heading'), vals.head, ...(u.kind === 'drone' ? [h('dt', null, 'Height'), vals.alt] : []), h('dt', null, u.kind === 'team' ? 'Walked' : u.kind === 'drone' ? 'Flown' : 'Driven'), vals.odo),
      u.kind === 'rover' ? h('section.mission-sec', null, h('header', null, h('h4', null, 'Battery and link over the mission'), realityTag('sim')), spark, h('p.mission-sub', null, h('i.mission-key.solid'), 'battery  ', h('i.mission-key.line'), 'radio link, modelled from distance and walls.')) : null,
      h('div.row.wrap', null,
        h('button.btn.btn-sm', { onclick: () => app.setCamera('follow') }, 'Follow with the camera'),
        u.kind === 'rover' ? h('button.btn.btn-sm', { onclick: () => ctx.select(null) }, 'Live sensors') : null));
    live = () => {
      const S = sim.state, x = S.units[u.id]; if (!x) return;
      vals.mode.textContent = (S.hold && x.mode !== 'landed' ? 'Holding (all stop)' : x.kind === 'team' && x.mode === 'drive' ? 'Walking the approved route' : MODE[x.mode] || x.mode) + (x.stop && x.mode === 'listen' ? ' at ' + x.stop : '');
      if (x.kind === 'rover') { vals.bat.style.width = x.battery * 100 + '%'; vals.bat.style.background = x.battery <= 0.15 ? 'var(--danger)' : ''; vals.batv.textContent = pct(x.battery); vals.link.style.width = x.link * 100 + '%'; vals.link.style.background = x.link < 0.2 ? 'var(--danger)' : ''; vals.linkv.textContent = pct(x.link); }
      vals.pos.textContent = fmt.pos(x.pos) + ' m'; vals.head.textContent = ((((90 - (x.heading * 180) / Math.PI) % 360) + 360) % 360).toFixed(0) + '° from north'; vals.odo.textContent = x.odo.toFixed(0) + ' m'; vals.alt.textContent = x.alt.toFixed(0) + ' m';
      if (x.kind === 'rover' && spark.isConnected) { const r = spark.getBoundingClientRect(); if (!r.width) return; const dpr = Math.min(2, devicePixelRatio || 1); spark.width = r.width * dpr; spark.height = r.height * dpr; const g = spark.getContext('2d'); g.scale(dpr, dpr); const tele = S.rec?.tele || [], tMax = Math.max(120, S.t), X = (t) => (t / tMax) * r.width, Y = (v) => r.height - 3 - v * (r.height - 8);
        g.strokeStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.moveTo(0, Y(0.15) + 0.5); g.lineTo(r.width, Y(0.15) + 0.5); g.stroke();
        for (const [idx, col, w] of [[1, C.text, 1.8], [2, C.text3, 1.2]]) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); tele.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[idx])) : g.moveTo(X(p[0]), Y(p[idx])))); g.stroke(); } }
    };
    live();
  }

  function hazardView(hz, S) {
    title.textContent = hz.name; tagSlot.replaceChildren(h('span.tag.tag-danger', null, hz.block ? 'No crossing' : 'Avoid'));
    let area = 0; for (let i = 0; i < hz.poly.length; i++) { const a = hz.poly[i], b = hz.poly[(i + 1) % hz.poly.length]; area += a[0] * b[1] - b[0] * a[1]; } area = Math.abs(area) / 2;
    const r = S.routes.rescue, avoided = r?.avoided.includes(hz.name), crossed = r && r.legs.some((l) => l.ok && l.path.some((p) => world.hazardsAt ? [hz].some((z) => inPoly(p, z.poly)) : false));
    put(
      h('p.mission-lede', null, hz.block ? 'The planner treats this area as a wall. No route for the rover or the team may cross it.' : 'Crossing is allowed but costs ' + hz.cost + ' times a normal step, so routes go around whenever a way round exists.'),
      hz.t != null ? h('p.note.danger', null, 'Appeared at ' + fmt.clock(hz.t) + ' as a drill. Every active route was planned again.') : null,
      hz.kind === 'gas' ? h('p.note', null, 'Gas sensing is a concept.') : null,
      h('dl.kv.mission-kv', null, ...row('Kind', { slope: 'Unstable slope', collapse: 'Collapse risk', mud: 'Deep mud', gas: 'Possible gas' }[hz.kind] || hz.kind), ...row('Area', h('span.num', null, area.toFixed(0) + ' m²')), ...row('Planner weight', h('span.num', null, hz.block ? 'blocked' : '×' + hz.cost)),
        ...(r ? row('Rescue route', crossed ? 'Crosses this area' : avoided ? 'Goes around it' : 'Not near it') : [])),
      h('p.mission-sub', null, 'The hazard areas are part of the invented exercise. The planner weights are design choices.'));
  }
  const inPoly = (p, poly) => { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside; } return inside; };

  function stopView(s, S) {
    const reads = (S.rec?.readings || []).filter((r) => r.stop === s.id), listening = S.sensors.listen?.stop === s.id, done = s.covers.some((id) => S.coverage[id]?.stop === s.id);
    title.textContent = 'Stop ' + s.id; tagSlot.replaceChildren(h('span.tag.' + (listening ? 'tag-accent' : done ? 'tag-ok' : 'plain'), null, listening ? 'Listening now' : done ? 'Done' : 'Not reached yet'));
    const leads = S.detections.filter((d) => d.evidence.some((e) => e.vantage === s.id));
    put(
      h('p.mission-lede', null, s.label + '. The rover stops here and listens for 10 seconds per window, standing still for the clearest signal.'),
      h('section.mission-sec', null, h('header', null, h('h4', null, 'Rooms covered from here')), ...s.covers.map((id) => { const cv = roomCover(S, id); return h('button.mission-item', { onclick: () => app.select({ type: 'room', id }, true) }, h('i.mission-dot.' + (cv.status === 'person' ? 'person' : cv.status === 'lead' ? 'warn' : cv.status === 'clear' ? 'ok' : 'closed')), h('span.grow', null, world.roomById(id).name), h('span.dim', null, cv.status === 'clear' ? pct(cv.residual) + ' chance missed' : { unsearched: 'not searched', lead: 'lead open', person: 'person found', blocked: 'not reached' }[cv.status])); })),
      h('section.mission-sec', null, h('header', null, h('h4', null, 'Wi-Fi windows read here'), realityTag('live-ai')),
        reads.length ? reads.map((r) => h('div.mission-read', null, h('span.num', null, fmt.clock(r.t)), r.ok ? [h('div.mission-gauge.small', null, h('i.mission-gauge-thr', { style: { left: ctx.nn.threshold * 100 + '%' } }), h('i.mission-gauge-mark', { 'data-says': r.says ? 'person' : 'none', style: { left: r.person * 100 + '%' } })), h('span.num', null, r.person.toFixed(2)), h('span.tag.' + (r.says ? 'tag-warn' : 'plain'), null, r.says ? 'Person' : 'No one')] : h('span.dim', null, r.reason || 'No Wi-Fi reading'))) : h('p.mission-sub', null, 'No window has been read here yet.')),
      leads.length ? h('section.mission-sec', null, h('header', null, h('h4', null, 'Leads from this stop')), ...leads.map((d) => h('button.mission-item', { onclick: () => app.select({ type: 'detection', id: d.id }, true) }, h('i.mission-dot.' + (d.status === 'confirmed' ? 'person' : d.status === 'possible' ? 'warn' : 'closed')), h('span.grow', null, (d.status === 'confirmed' ? 'Person' : d.status === 'possible' ? 'Possible person' : 'Closed: ' + d.kind) + (d.room ? ', room ' + d.room : '')), h('span.num', null, pct(d.p))))) : null);
  }

  function eventView(e, S) {
    title.textContent = { alert: 'Alert', warn: 'Needs attention', ok: 'Done', info: 'Log entry' }[e.level]; tagSlot.replaceChildren(h('span.tag.' + ({ alert: e.code === 'PERSON_FOUND' ? 'tag-person' : 'tag-danger', warn: 'tag-warn', ok: 'tag-ok', info: 'plain' }[e.level]), null, fmt.clock(e.t)));
    put(
      h('p.mission-lede.big', null, e.text),
      h('div.row.wrap', null,
        h('button.btn.btn-sm', { onclick: () => sim.seek(Math.max(0, e.t - 0.5)) }, 'Go to this moment'),
        e.det ? h('button.btn.btn-sm', { onclick: () => app.select({ type: 'detection', id: e.det }, true) }, 'Open the lead') : null,
        e.room ? h('button.btn.btn-sm', { onclick: () => app.select({ type: 'room', id: e.room }, true) }, 'Open room ' + e.room) : null,
        e.hazard ? h('button.btn.btn-sm', { onclick: () => app.select({ type: 'hazard', id: e.hazard }, true) }, 'Open the hazard') : null,
        e.unit ? h('button.btn.btn-sm', { onclick: () => app.select({ type: 'unit', id: e.unit }, true) }, 'Open ' + S.units[e.unit].name) : null),
      h('section.mission-sec', null, h('header', null, h('h4', null, 'Around this time')),
        ...S.events.filter((x) => Math.abs(x.t - e.t) < 45 && x.code !== 'PHASE').slice(-9).map((x) => h('button.mission-item' + (x.id === e.id ? '.on' : ''), { onclick: () => app.select({ type: 'event', id: x.id }, true) }, h('span.num.dim', null, fmt.clock(x.t)), h('span.grow', null, x.text)))));
  }

  function render() {
    const S = sim.state, sel = ctx.selection; live = null;
    back.hidden = !sel;
    if (sel?.type === 'detection' || sel?.type === 'survivor') { const d = S.detections.find((x) => x.id === (sel.type === 'survivor' ? S.survivors[sel.id]?.detId : sel.id)); if (d) return detectionView(d, S); }
    if (sel?.type === 'room') { const r = world.roomById(sel.id); if (r) return roomView(r, S); }
    if (sel?.type === 'unit' && S.units[sel.id]) return unitView(S.units[sel.id], S);
    if (sel?.type === 'hazard') { const hz = [...world.HAZARDS, ...S.hazards].find((x) => x.id === sel.id); if (hz) return hazardView(hz, S); }
    if (sel?.type === 'stop') { const s = world.STOPS.find((x) => x.id === sel.id); if (s) return stopView(s, S); }
    if (sel?.type === 'event') { const e = S.events.find((x) => x.id === sel.id); if (e) return eventView(e, S); }
    back.hidden = true; title.textContent = 'HOUND-01 live sensors'; tagSlot.replaceChildren();
    if (sel) sensorsViewInto();
    else sensorsView();
  }
  function sensorsViewInto() { sensorsView(); body.prepend(h('p.note', null, 'That item does not exist at this point in the mission. Showing the live sensors instead.')); }
  // What must change before the selected view is rebuilt. Fast-moving numbers are updated in place by live().
  function signature() {
    const S = sim.state, sel = ctx.selection; if (!sel) return 'none';
    let extra = '';
    if (sel.type === 'detection' || sel.type === 'survivor') { const d = S.detections.find((x) => x.id === (sel.type === 'survivor' ? S.survivors[sel.id]?.detId : sel.id)); extra = d ? [d.evidence.length, d.status, d.needsTeam, S.phase, d.survivorId && S.survivors[d.survivorId]?.status].join() : 'gone'; }
    else if (sel.type === 'room') { const cv = S.coverage[sel.id]; extra = [cv?.status, cv?.t, cv?.reach, S.detections.length, S.detections.map((d) => d.status).join('')].join(); }
    else if (sel.type === 'hazard') extra = [S.routes.rescue?.plannedAt, S.routes.rescue?.status].join();
    else if (sel.type === 'stop') extra = [S.rec?.readings.length, S.sensors.listen?.stop, S.detections.map((d) => d.status + d.evidence.length).join('')].join();
    else if (sel.type === 'event') extra = String(S.events.length > 0 && S.events.some((e) => e.id === sel.id)) + Math.floor(S.events.length / 3);
    else if (sel.type === 'unit') extra = '';
    return sel.type + sel.id + '|' + extra;
  }
  return {
    title, tagSlot, back, body,
    update(force) { const s = signature(); if (force || s !== sig) { sig = s; const top = body.scrollTop; render(); if (!force) body.scrollTop = top; else body.scrollTop = 0; } else live?.(); },
    recolor: colors,
  };
}
