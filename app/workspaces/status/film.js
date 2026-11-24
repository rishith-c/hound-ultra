// The drill film (Demo): a private copy of the mission in the 3-D twin, broken on purpose. The live mission is never
// touched. What the system "did" is never written here: it is read from the engine (log, rover mode, link, battery).
import { createSim } from '../../core/sim.js';
import { createBus } from '../../core/bus.js';
import { createTwin } from '../../twin/index.js';

const R1 = 'HOUND-01';
export const MODE_WORDS = { idle: 'Standing by', drive: 'Driving', listen: 'Listening', hold: 'All stop', fault: 'Holding position', swap: 'Battery swap' };
// seek: where the film starts; lead: seconds before it breaks; speed: simulated seconds per real second; hold or until: how long it is watched
export const FILM = [
  { id: 'linkLoss', short: 'Link lost', title: 'The radio link dies', says: 'It must stop where it stands, and keep what it knows.', seek: 124, speed: 3, lead: 2.4, hold: 7, clear: true, after: 4.5, cam: 'cinematic' },
  { id: 'csiDropout', short: 'Wi-Fi blinded', title: 'Wi-Fi goes blind', says: 'It must refuse the bad windows and listen again.', seek: 243, speed: 4, lead: 1.2, until: (n) => n('CSI_UNAVAILABLE'), max: 16, clear: true, after: 4, cam: 'follow' },
  { id: 'lowBattery', short: 'Battery low', title: 'The battery runs out', says: 'It must go home while it still can, then come back.', seek: 246, speed: 12, lead: 1, until: (n) => n('BATTERY_SWAPPED'), max: 26, after: 6, cam: 'cinematic' },
  { id: 'slide', short: 'Second slide', title: 'Debris falls on its route', says: 'It must find another way at once, or say there is none.', seek: 118, speed: 3, lead: 2.2, hold: 9, after: 0, cam: 'follow' },
];

export async function createDrillFilm(host, ctx, { onUpdate }) {
  const bus = createBus(), memo = new WeakMap(), nn = { ...ctx.nn, infer(x, o) { if (o?.trace) return ctx.nn.infer(x, o); let r = memo.get(x); if (!r) memo.set(x, (r = ctx.nn.infer(x))); return r; } }, sim = createSim({ bus, nn }), own = { ...ctx, bus, sim, selection: null, select(sel) { own.selection = sel; bus.emit('select', sel); } };
  const twin = await createTwin(host, own, { interactive: true, quality: 'high', camera: 'follow', caption: false, autostart: false });
  // Each drill starts by replaying the mission to its moment. The network gives the same answer to the same window (the
  // self-tests prove it), so it is asked once per window here, one a frame, before the film starts.
  for (const s of ctx.nn.samples) { nn.infer(s.x); await new Promise((r) => requestAnimationFrame(r)); }
  let k = 0, phase = 'idle', timer = 0, raf = 0, last = 0, from = 0, p0 = null, t0 = 0, on = false, moved = 0, acc = 0;
  const S = () => sim.state, since = () => S().events.slice(from), n = (code) => since().some((e) => e.code === code);
  function load(i) {
    k = (i + FILM.length) % FILM.length; const d = FILM[k]; sim.pause(); sim.reset({ autoplay: true }); sim.pause(); sim.seek(d.seek); sim.setSpeed(d.speed);
    phase = 'lead'; timer = 0; from = S().events.length; p0 = null; moved = 0; twin.setCamera(d.cam); if (on) sim.play(); push();
  }
  function arm() {
    const d = FILM[k], u = S().units[R1]; from = S().events.length; t0 = S().t;
    if (d.id === 'slide') {
      const a = u.pos, g = (u.path || []).find((q) => Math.hypot(q[0] - a[0], q[1] - a[1]) > 5) || u.goal || [64, 27], l = Math.hypot(g[0] - a[0], g[1] - a[1]) || 1, m = [a[0] + ((g[0] - a[0]) / l) * 5, a[1] + ((g[1] - a[1]) / l) * 5];
      sim.command('newHazard', { poly: [[m[0] - 1.8, m[1] - 3.4], [m[0] + 1.6, m[1] - 3], [m[0] + 2, m[1] + 2.8], [m[0] - 1.5, m[1] + 3.2]], name: 'Second slide: debris on the rover’s route' });
    } else sim.command('injectFault', { id: d.id });
    p0 = u.pos.slice(); phase = 'fault'; timer = 0;
  }
  function push() { const u = S().units[R1], d = FILM[k]; onUpdate({ k, d, phase, mode: MODE_WORDS[u.mode] || u.mode, link: u.link, battery: u.battery, moved, t: S().t, sinceT: phase === 'lead' ? 0 : S().t - t0, lines: phase === 'lead' ? [] : since().filter((e) => e.code !== 'PHASE' && e.code !== 'ROOM_CLEAR' && e.code !== 'LEAD_CLOSED') }); }
  function frame(ts) {
    if (!on) return; raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - last) / 1000); last = ts; timer += dt; acc += dt; const d = FILM[k];
    if (p0 && phase === 'fault') { const u = S().units[R1]; moved = Math.max(moved, Math.hypot(u.pos[0] - p0[0], u.pos[1] - p0[1])); }
    if (phase === 'lead' && timer > d.lead) arm();
    else if (phase === 'fault' && (d.until ? (timer > 1 && d.until(n)) || timer > d.max : timer > d.hold)) { if (d.clear) sim.command('clearFault', { id: d.id }); phase = 'after'; timer = 0; }
    else if (phase === 'after' && timer > d.after + 1.5) load(k + 1);
    if (acc > 0.12) { acc = 0; push(); }
  }
  return {
    twin, go: load,
    start() { if (on) return; on = true; last = performance.now(); twin.start(); if (phase === 'idle') load(0); else sim.play(); raf = requestAnimationFrame(frame); },
    stop() { on = false; cancelAnimationFrame(raf); sim.pause(); twin.stop(); },
    dispose() { this.stop(); twin.dispose(); },
  };
}
