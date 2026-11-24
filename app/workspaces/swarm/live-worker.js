// Runs one search off the main thread and streams it as small frames, so the view never waits for the planner.
import { genWorld, createSwarm } from './engine.js';

let failAt = 0, sw = null, upTo = 0, lastEv = 0, sentSeries = 0, lastClusters = null, lastRelays = '', lastLeads = '', forceSlow = true, steps = 0, busy = false;

const lite = (r) => ({ mode: r.mode, goal: r.goal ? { x: r.goal.x, y: r.goal.y, home: !!r.goal.home } : null, lead: r.lead, timer: r.timer, why: r.why, energy: r.energy, relaysLeft: r.relaysLeft, odo: r.odo, used: r.used, link: r.link });
const liteLead = ({ target, ...l }) => l;                       // the hidden target never leaves the worker

function frame() {
  const S = sw.state, n = S.robots.length, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const r = S.robots[i]; pos[i * 3] = r.x; pos[i * 3 + 1] = r.y; pos[i * 3 + 2] = r.heading; }
  const ch = Int32Array.from(S.changed), cv = new Uint8Array(ch.length); for (let i = 0; i < ch.length; i++) cv[i] = S.known[ch[i]]; S.changed.length = 0;
  const f = { t: S.t, pos, ch, cv, slow: null };
  const ev = []; for (const e of S.events) if (e.id > lastEv) ev.push(e);
  if (forceSlow || ev.length || S.done || steps % 2 === 0) {
    const slow = f.slow = { robots: S.robots.map(lite), links: S.links, m: { ...S.m }, ev, series: S.series.slice(sentSeries), done: S.done, summary: sw.summary() };
    sentSeries = S.series.length; if (ev.length) lastEv = ev[ev.length - 1].id;
    const rs = S.relays.map((b) => b.id + (b.alive ? 1 : 0) + (b.connected ? 1 : 0) + b.load + b.parent).join(); if (rs !== lastRelays) { lastRelays = rs; slow.relays = S.relays.map((b) => ({ ...b })); }
    const ls = S.leads.map((l) => l.id + l.status + l.tries + l.winner + l.p).join(); if (ls !== lastLeads) { lastLeads = ls; slow.leads = S.leads.map(liteLead); }
    if (S.clusters !== lastClusters) { lastClusters = S.clusters; let c = 0; for (const k of S.clusters) c += k.cells.length; const a = new Int32Array(c); let q = 0; for (const k of S.clusters) for (const x of k.cells) a[q++] = x; slow.front = a; }
    forceSlow = false;
  }
  return f;
}
function pump() {
  if (busy || !sw) return; busy = true;
  const frames = [], t0 = performance.now();
  while (sw.state.t < upTo && !sw.state.done && performance.now() - t0 < 24) { sw.step(); steps++; if (failAt && sw.state.t >= failAt) { if (sw.failRelay(sw.state.t > failAt + 60 ? 'busiest' : 'critical')) failAt = 0; } frames.push(frame()); }
  if (frames.length) self.postMessage({ frames }, frames.flatMap((f) => [f.pos.buffer, f.ch.buffer, f.cv.buffer]));
  busy = false;
  if (sw.state.t < upTo && !sw.state.done) setTimeout(pump, 0);
}
self.onmessage = (e) => {
  const d = e.data;
  try {
    if (d.init) { const o = d.init; failAt = o.failAt || 0; sw = createSwarm(genWorld({ layout: o.layout, seed: o.seed, blockB: o.blockB }), { n: o.n, strategy: o.strategy, startCharge: o.startCharge, pair: o.pair, track: true }); }
    else if (d.fail) { const r = sw.failRelay(d.fail); forceSlow = true; self.postMessage({ failed: r ? { ...r } : null, at: sw.state.t }); }
    else if (d.upTo > upTo) { upTo = d.upTo; pump(); }
  } catch (err) { self.postMessage({ error: String((err && err.message) || err) }); }
};
