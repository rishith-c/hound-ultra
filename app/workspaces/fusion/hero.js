// Fusion in Demo mode: three leads from the real scripted mission, judged one reading at a time.
// Every probability is fuse() from app/core/fusion.js on the evidence the simulator's engine recorded; taking a
// sensor away with the chips fuses the same evidence again without it. Nothing here reads the truth.
import { createEngine } from '../../core/sim.js';
import { fuse, THRESHOLDS } from '../../core/fusion.js';
import { SHAFT_M } from './util.js';

const STORIES = [
  { det: 'D2', name: 'A machine', cam: { az: -0.5, el: 0.6, dist: 25, h: 2.5 }, glass: [[57.4, 41.2], 4.6], turn: 0.4 },
  { det: 'D4', name: 'Lying still', cam: { az: 0.42, el: 0.66, dist: 23.5, h: 2.4 }, glass: [[71.6, 31.4], 4.2], turn: 1.1 },
  { det: 'D5', name: 'Behind a wall', cam: { az: -0.36, el: 0.7, dist: 25, h: 2.5 }, glass: [[77.2, 50.2], 5.6], turn: -0.9 },
];
const GROUP = { csi: 'wifi', radar: 'radar', micro: 'radar', signature: 'radar', thermal: 'thermal', temperature: 'thermal' };
const CHIPS = [['wifi', 'Wi-Fi'], ['radar', 'Radar'], ['thermal', 'Thermal']];
const SAYS = {
  'csi:pos': 'Wi-Fi hears a person', 'csi:neg': 'Wi-Fi hears no one', 'radar:pos': 'Radar sees something move', 'radar:neg': 'Radar sees nothing move',
  'micro:pos': 'Radar feels a small rhythm', 'micro:neg': 'Radar feels no rhythm', 'thermal:pos': 'Thermal sees body warmth', 'thermal:faint': 'Thermal sees a faint edge',
  'thermal:neg': 'Thermal sees no warmth', 'signature:machine': 'But it repeats like a machine', 'temperature:tooHot': 'But it is far too hot',
};
const INTRO = 3.4, HOLD = 5.2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), lerp = (a, b, k) => a + (b - a) * k;
const ease = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); }, span = (t, a, b) => ease((t - a) / (b - a));
const word = (p) => (p >= THRESHOLDS.confirmed ? 'confirmed' : p >= THRESHOLDS.possible ? 'possible' : 'closed');

async function record(nn) { // run the scripted mission once and keep every reading with where the rover stood
  const e = createEngine({ nn, keep: { autoplay: true } }), got = {}, cov = {}; let was = {};
  for (let g = 0; !e.done && g < 40000; g++) {
    e.step(); const S = e.state, r = S.units['HOUND-01'];
    for (const d of S.detections) {
      const L = got[d.id] ||= []; if (L.length === d.evidence.length) continue;
      if (!cov[d.id]) cov[d.id] = was; // what each room stood at just before this lead's first reading
      while (L.length < d.evidence.length) L.push({ ev: { ...d.evidence[L.length] }, pos: d.pos.slice(), rover: r.pos.slice(), t: S.t, room: d.room });
    }
    was = Object.fromEntries(Object.entries(S.coverage).map(([k, c]) => [k, c.residual ?? 0.1]));
    if (g % 1500 === 1499) await new Promise((r2) => setTimeout(r2));
  }
  return { got, cov };
}

export async function createHero(host, ctx, { openEvidence }) {
  const { h, icon, realityTag } = ctx.kit, reduced = () => ctx.kit.reducedMotion();
  const stage = h('div.fusion-hero-stage'), num = h('div.fusion-hero-num', { 'aria-hidden': 'true' }, h('b', null, '10'), h('span', null, '%'), h('em', null, '')), g85 = h('div.fusion-hero-gate', null, '85 % confirmed'), g15 = h('div.fusion-hero-gate', null, '15 % closed below');
  const priors = [], now = h('div.fusion-hero-now', { role: 'status', 'aria-live': 'polite' }, h('b', null, ''), h('span', null, ''));
  const steps = STORIES.map((s, i) => h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => go(i) }, s.name, h('s')));
  const hold = h('button.hold', { type: 'button', 'aria-label': 'Pause', onclick: () => setHold(!held) }, icon('pause', 14));
  const chips = CHIPS.map(([id, label]) => h('button.fusion-hero-chip', { type: 'button', 'aria-pressed': 'true', 'data-sensor': id, title: 'Take this sensor away, or put it back', onclick: () => toggle(id) }, h('i'), label));
  host.classList.add('fusion-hero');
  host.append(stage, h('div.fusion-hero-veil'), num, g85, g15,
    h('div.fusion-hero-title', null, h('div.tags', null, realityTag('live-algo'), h('span.tag.tag-sim', null, 'Simulated readings')), h('h2', null, 'Three sensors, one answer'), h('p', null, 'Each sensor moves the odds. Height is the chance of a person.')),
    now,
    h('div.fusion-hero-side', null, h('div.fusion-hero-chips', { role: 'group', 'aria-label': 'Sensors in the sum' }, h('span', null, 'Take one away'), chips), h('div.fusion-hero-steps', { role: 'group', 'aria-label': 'Choose a lead' }, steps, hold)));

  for (const r of ctx.world.ROOMS) if (!r.corridor) { const el = h('div.fusion-hero-prior', { 'aria-hidden': 'true' }, '10 %'); el.roomId = r.id; priors.push(el); host.insertBefore(el, num); }
  const rec = await record(ctx.nn);
  const off = new Set();
  const stories = STORIES.filter((s) => rec.got[s.det]).map((s) => {
    const list = rec.got[s.det].filter((x) => fuse([x.ev]).steps[0].lr !== 1 && GROUP[x.ev.sensor]);
    const each = list.length > 6 ? 1.75 : 2.5; let t = INTRO, last = null; const beats = list.map((x) => { const move = last && Math.hypot(x.rover[0] - last[0], x.rover[1] - last[1]) > 0.4; if (move) t += 1.6; last = x.rover; const b = { ...x, t0: t, move }; t += each; return b; });
    return { ...s, beats, each, end: t, len: t + HOLD, room: list[0].room, cov: rec.cov[s.det] };
  });
  const cache = new Map();
  function path(s) { // the running probability with the switched-off sensors left out
    const key = s.det + [...off].sort().join(); let r = cache.get(key); if (r) return r;
    const ps = [], ev = []; for (const b of s.beats) { if (!off.has(GROUP[b.ev.sensor])) ev.push(b.ev); ps.push(fuse(ev).p); }
    cache.set(key, r = ps); return r;
  }
  const finalP = (s) => path(s).at(-1);

  let three = null, si = 0, T = 0, held = false, running = false, raf = 0, last = 0, time = 0, shown = {}, dispP = 0.1, said = '', cut = true;
  // ---- one frame's worth of state, reused ----
  const lead = [0, 0], rov = [0, 0, 0], past = [], cam = { x: 0, y: 0, h: 0, dist: 0, az: 0, el: 0 }, fx = { kind: '', k: 0, u: 0, res: 0, lie: false, faint: false };
  const P = { p: 0.1, pk: 0, lead, rover: rov, moving: false, fx: null, hot: 0, lock: 0, fall: 0, imp: 0, glass: [0, 0], glassR: 0, lie: 0, turn: 0, rooms: 1, cam, dof: 0, past, pastKey: '', levels: null, roomsKey: '' };
  const WIDE = { x: 64.5, y: 43, h: 1.2, dist: 66, az: -0.2, el: 0.72 };
  const levelsOf = (i, own) => { const L = {}; const s = stories[i]; for (const [k, p] of Object.entries(s.cov)) L[k] = { p, hot: false }; for (let k = 0; k < stories.length; k++) { const o = stories[k]; if (k < i) { const p = finalP(o); L[o.room] = { p, hot: p >= THRESHOLDS.confirmed, pos: o.beats.at(-1).pos }; } } L[s.room] = own ? { p: 0 } : { p: 0.1, hot: false, pos: s.beats[0].pos }; return L; };
  const closeCam = (s, k, out) => { const b = s.beats, p = b[Math.min(b.length - 1, 0)].pos; out.x = p[0]; out.y = p[1]; out.h = s.cam.h; out.dist = s.cam.dist; out.az = s.cam.az; out.el = s.cam.el; return out; };
  const c0 = {}, c1 = {}, mix = (a, b, k, o) => { for (const q of ['x', 'y', 'h', 'az', 'el']) o[q] = lerp(a[q], b[q], k); o.dist = Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), k)); return o; };

  function compute(dt) {
    const s = stories[si], ps = path(s), B = s.beats; let n = -1; for (let i = 0; i < B.length; i++) if (T >= B[i].t0) n = i;
    const b = n >= 0 ? B[n] : null, u = b ? (T - b.t0) / s.each : 0, before = n > 0 ? ps[n - 1] : 0.1, after = n >= 0 ? ps[n] : 0.1;
    const want = n >= 0 ? lerp(before, after, span(u, 0.34, 0.78)) : 0.1;
    if (cut || dt === 0) dispP = want; else dispP += (want - dispP) * (1 - Math.exp(-14 * dt));
    const p = dispP, done = T >= s.end, dk = span(T, s.end - 0.2, s.end + 1.4), fp = finalP(s);
    P.p = p; P.pk = span(T, INTRO - 1.5, INTRO - 0.3) * (1 - span(T, s.len - 0.5, s.len));
    P.hot = clamp((p - 0.1) / 0.6); P.lock = fp >= THRESHOLDS.confirmed ? span(T, s.end, s.end + 1.1) : 0; P.fall = fp < THRESHOLDS.possible ? dk : 0;
    P.imp = b && u > 0.3 && u < 1 && !off.has(GROUP[b.ev.sensor]) ? Math.sin(clamp((u - 0.3) / 0.6) * Math.PI) : 0;
    const a = b || B[0], prev = n > 0 ? B[n - 1] : a, mv = span(u, 0, 0.5); lead[0] = lerp(prev.pos[0], a.pos[0], mv); lead[1] = lerp(prev.pos[1], a.pos[1], mv);
    // the rover: stands where the engine had it, and drives round the desks between two readings
    const nx = B[n + 1], drive = nx && nx.move && T > nx.t0 - 1.7 ? span(T, nx.t0 - 1.7, nx.t0 - 0.1) : 0; const at = a.rover; rov[0] = at[0]; rov[1] = at[1]; P.moving = false;
    if (drive > 0 && drive < 1) { const m = s.det === 'D4' ? [67.6, 37.6] : [(at[0] + nx.rover[0]) / 2, (at[1] + nx.rover[1]) / 2], q = 1 - drive; rov[0] = q * q * at[0] + 2 * q * drive * m[0] + drive * drive * nx.rover[0]; rov[1] = q * q * at[1] + 2 * q * drive * m[1] + drive * drive * nx.rover[1]; P.moving = true; }
    rov[2] = Math.atan2(lead[1] - rov[1], lead[0] - rov[0]);
    // the sensor that is speaking
    P.fx = null; if (b && u < 1 && !done && !off.has(GROUP[b.ev.sensor])) { fx.kind = b.ev.sensor; fx.u = u; fx.k = span(u, 0, 0.14) * (1 - span(u, 0.72, 1)); fx.res = b.ev.result === 'pos' || b.ev.result === 'tooHot' ? 1 : b.ev.result === 'faint' ? 0.55 : 0; fx.faint = b.ev.result === 'faint'; fx.lie = s.det === 'D4'; P.fx = fx; }
    P.lie = s.det === 'D4' ? 1 : 0; P.turn = s.turn;
    const gT = B.find((x) => x.ev.sensor === 'csi')?.t0 ?? 0; P.glass = s.glass[0]; P.glassR = T > gT - 0.2 && T < s.len - 0.6 ? s.glass[1] : 0;
    // rings left behind by earlier answers
    let key = si + ':' + n + ':' + [...off]; if (key !== P.pastKey) { P.pastKey = key; past.length = 0; for (let i = 0; i < n; i++) if (Math.abs(ps[i] - (i ? ps[i - 1] : 0.1)) > 0.004) past.push(ps[i]); }
    const own = T > INTRO - 1.2 && T < s.len - 0.55, rk = si + (own ? 'o' : '') + (T >= s.len - 0.55 ? 'e' : '') + [...off];
    if (rk !== P.roomsKey) { P.roomsKey = rk; P.levels = levelsOf(si, own); if (T >= s.len - 0.55) P.levels[s.room] = { p: fp, hot: fp >= THRESHOLDS.confirmed, pos: B.at(-1).pos }; }
    const wideK = 1 - span(T, 1.0, INTRO); P.rooms = lerp(0.42, 1, Math.max(wideK, span(T, s.len - 0.8, s.len)));
    // camera: from the last lead up to the whole floor, then down to this one; a slow push when the answer is in
    closeCam(s, 0, c1); const o = stories[(si + stories.length - 1) % stories.length]; closeCam(o, 0, c0); c0.az += 0.16; c0.dist *= 0.72;
    if (T < INTRO) { if (firstRun) mix(WIDE, c1, span(T, 0.7, INTRO), cam); else if (T < 1.4) mix(c0, WIDE, ease(T / 1.4) , cam); else mix(WIDE, c1, span(T, 1.5, INTRO + 0.2), cam); if (!firstRun && T >= 1.4 && T < 1.5) mix(c0, WIDE, 1, cam); }
    else Object.assign(cam, c1);
    const go2 = span(T, INTRO, s.len), push = span(T, s.end - 1.2, s.end + 2.6); cam.az += T < INTRO ? 0 : 0.16 * clamp((T - INTRO) / (s.len - INTRO)); cam.dist *= 1 - 0.10 * go2 * (T >= INTRO ? 1 : 0) - 0.08 * push; cam.h += 0.15 * push;
    P.dof = 0.85 * (1 - wideK);
  }
  let firstRun = true;

  // ---- words change only at beats ----
  function say(a, b) { const k = a + '|' + b; if (k === said) return; said = k; now.classList.add('swap'); setTimeout(() => { if (said !== k) return; now.firstChild.textContent = a; now.lastChild.textContent = b; now.classList.remove('swap'); }, reduced() ? 0 : 160); }
  const pc = (p) => Math.round(p * 100) + ' %';
  function words() {
    const s = stories[si], ps = path(s), B = s.beats; let n = -1; for (let i = 0; i < B.length; i++) if (T >= B[i].t0) n = i;
    if (n < 0) return say(T >= INTRO - 1 ? 'Is someone here?' : si ? 'Searched rooms fall, the rest wait at 10 %' : 'Before any reading, every room is 10 %', '');
    if (T >= s.end - 0.1) { const p = finalP(s), w = word(p), gone = CHIPS.filter(([id]) => off.has(id) && B.some((x) => GROUP[x.ev.sensor] === id)).map(([, l]) => l);
      if (gone.length) return say('Without ' + gone.join(' and ') + ': ' + pc(p), w === 'confirmed' ? 'still confirmed' : w === 'possible' ? 'possible, so it looks again' : 'closed');
      return s.det === 'D2' ? say('Ruled out at ' + pc(p), 'a machine, recognised') : s.det === 'D4' ? say('Found at ' + pc(p), 'it listened, moved and looked again') : say('Found at ' + pc(p), 'Wi-Fi and radar agree through the wall'); }
    const b = B[n], gone = off.has(GROUP[b.ev.sensor]);
    if (gone) return say(CHIPS.find(([id]) => id === GROUP[b.ev.sensor])[1] + ' is switched off', 'no change');
    say(SAYS[b.ev.sensor + ':' + b.ev.result] || b.ev.note, pc(n ? ps[n - 1] : 0.1) + ' to ' + pc(ps[n]));
  }
  const xy = { x: 0, y: 0 }; let ints = -1, stTxt = '', priorO = '';
  const place = (el, p, hh, dx, oy) => { three.project(p, hh, dx, xy); el.style.transform = 'translate3d(' + xy.x.toFixed(1) + 'px,' + (xy.y + oy).toFixed(1) + 'px,0)'; };
  function labels() {
    if (!three) return; const v = Math.round(P.p * 100); if (v !== ints) { ints = v; num.firstChild.textContent = v; num.classList.toggle('hot', P.p >= THRESHOLDS.confirmed); }
    const s = stories[si], w = T >= s.end ? word(finalP(s)) : ''; if (w !== stTxt) { stTxt = w; num.lastChild.textContent = w; }
    const o = P.pk.toFixed(2); if (num.style.opacity !== o) { num.style.opacity = o; g85.style.opacity = g15.style.opacity = o; }
    const po = clamp(P.rooms * 1.724 - 0.724).toFixed(2), seen = +po > 0.01; if (po !== priorO) { priorO = po; for (const el of priors) el.style.opacity = po; }
    if (seen) priors.forEach((el, i) => { const L = P.levels[el.roomId], p = L ? L.p : 0.1, c = L && L.pos ? L.pos : three.roomC[i]; const tx = p > 0 ? pc(p) : ''; if (el.textContent !== tx) el.textContent = tx; el.classList.toggle('hot', !!(L && L.hot)); place(el, c, Math.max(p, 0.1) * SHAFT_M + 0.5, 0, 0); });
    if (P.pk > 0.01) { place(num, lead, P.p * SHAFT_M, -1.15, 0); place(g85, lead, 0.85 * SHAFT_M, 1.5, 0); place(g15, lead, 0.15 * SHAFT_M, 1.5, 0); }
  }
  function bars() { for (let k = 0; k < stories.length; k++) { const v = 'scaleX(' + (k === si ? clamp(T / stories[k].len).toFixed(3) : 0) + ')'; const st = steps[k].lastChild.style; if (st.transform !== v) st.transform = v; } }
  const press = () => steps.forEach((b, k) => b.setAttribute('aria-pressed', String(k === si)));

  function go(i) { si = i; T = 0; firstRun = false; cut = true; press(); if (held) setHold(false); if (reduced()) still(); }
  function toggle(id) {
    if (!off.has(id) && off.size === CHIPS.length - 1) return; // the last sensor stays: with none there is nothing to fuse
    off.has(id) ? off.delete(id) : off.add(id);
    chips.forEach((c) => { const on = !off.has(c.dataset.sensor), last = on && off.size === CHIPS.length - 1; c.setAttribute('aria-pressed', String(on)); c.setAttribute('aria-disabled', String(last)); c.title = last ? 'One sensor has to stay' : 'Take this sensor away, or put it back'; });
    const s = stories[si]; T = s.end + 0.6; if (reduced() || held) still(); // jump to the answer, so the change is seen at once; the shaft eases there
  }
  function setHold(x) { held = x; hold.setAttribute('aria-label', x ? 'Play' : 'Pause'); hold.replaceChildren(icon(x ? 'play' : 'pause', 14)); }
  function still() { const s = stories[si]; if (reduced()) T = s.end + 2.4; cut = true; compute(0); cut = false; words(); labels(); bars(); if (three && !three.lost) { three.resize(); three.pose(P, 1, 3); three.render(0, 3); labels(); } }
  function frame(tn) {
    raf = 0; if (!running) return; const dt = Math.min(0.05, (tn - last) / 1000); last = tn; raf = requestAnimationFrame(frame);
    if (reduced()) { if (shown.still !== si + ':' + [...off] + stage.clientWidth) { shown.still = si + ':' + [...off] + stage.clientWidth; still(); } return; }
    shown.still = null; time += dt; if (!held) { T += dt; if (T >= stories[si].len) { si = (si + 1) % stories.length; T = 0; firstRun = false; cut = true; press(); } }
    compute(dt); cut = false; words(); bars(); if (three && !three.lost) { three.pose(P, dt, time); three.render(dt, time); labels(); }
  }

  now.firstChild.textContent = 'Raising block B'; await new Promise((r) => setTimeout(r));
  try { const { createStage } = await import('./stage.js'); three = await createStage(stage, ctx, { reduced: reduced() }); await three.prime(); }
  catch (e) { console.warn('[fusion] the 3-D hero is unavailable:', e); for (const el of [num, g85, g15]) el.hidden = true; stage.append(h('div.fusion-hero-flat', null, h('p', null, 'The 3-D view could not start. Every reading is in Advanced.'), h('button.btn', { type: 'button', onclick: openEvidence }, 'Open the evidence'))); }
  if (three) three.onLook = () => { shown.still = null; }; // reduced motion draws only on change
  press(); compute(0); words();
  if (three) { three.pose(P, 0.016, 0); if (stage.clientWidth) three.render(0, 0); }
  ctx.bus.on('prefs', () => { three?.readTokens(); shown.still = null; });
  const api = {
    onShow() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
    onHide() { running = false; cancelAnimationFrame(raf); raf = 0; },
    seek(i, t) { si = i; T = t; firstRun = false; cut = true; press(); compute(0.016); words(); }, hold: setHold, get stories() { return stories; }, get time() { return T; }, get story() { return si; }, get three() { return three; }, path, P,
  };
  host.hero = api; // for the automated checks
  return api;
}
