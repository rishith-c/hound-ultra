// Monte-Carlo missions: the whole mission, run N times with random Wi-Fi windows (monteCarlo from app/core/sim.js),
// to measure how often each person is confirmed by sensors, handed to a team to check, or missed.
// This is a test, so it is scored against the simulation's ground truth. That is the one place truth may be read.
import { TRUTH } from '../../core/world.js';
import { tokens, rgba, wilson } from './util.js';

const OUT = [['confirmed', 'Confirmed by sensors', 'person'], ['flagged', 'Flagged for a team check', 'warn'], ['missed', 'Missed', 'danger']];
const SIZES = [50, 100, 200, 500];
function describe(p) {
  const who = (p.motion === 'moving' ? 'Moving person' : 'Still person') + (p.posture === 'lying' ? ', lying' : ', standing');
  const where = p.outdoors ? 'outdoors, in the debris field' : 'room ' + p.room + (p.wall && p.wall !== 'none' ? ', behind a wall' : ', behind furniture');
  const short = (p.motion === 'moving' ? 'the moving person' : 'the still person') + (p.outdoors ? ' outdoors' : ' in room ' + p.room);
  return { who, where, short };
}

export function createMonteCarlo(host, ctx) {
  const { h, icon, fmt, realityTag } = ctx.kit;
  let runs = 100, state = 'idle', result = null, progress = 0, elapsed = 0, worker = null, cancelled = false, isDirty = true, error = '', perRun = null;
  const strips = new Map();

  const sizeSeg = h('div.seg', { role: 'group', 'aria-label': 'Number of missions' }, ...SIZES.map((n) => h('button', { type: 'button', 'aria-pressed': String(n === runs), onclick: (e) => { if (state === 'running') return; runs = n; [...e.target.parentElement.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.target))); isDirty = true; } }, String(n))));
  const runBtn = h('button.btn.btn-primary', { type: 'button', onclick: () => (state === 'running' ? cancel() : start()) });
  const estLine = h('span.dim.fusion-mc-est');
  const controls = h('div.fusion-mc-controls', null, h('span.dim', null, 'Missions'), sizeSeg, runBtn, estLine);
  const stage = h('div.fusion-mc-stage', { 'aria-live': 'polite' });
  const panel = ctx.kit.panel('Monte-Carlo missions: the same search, run again and again', { tag: realityTag('live-algo'), flush: true }, h('div.fusion-mc', null, controls, stage));
  panel.classList.add('fusion-mcp'); host.append(panel);

  function cancel() { cancelled = true; worker?.terminate(); worker = null; state = result ? 'done' : 'idle'; isDirty = true; }
  function finish(res, ms) { result = { ...res, ms }; perRun = ms / res.runs; state = 'done'; worker = null; isDirty = true; }
  async function start() {
    state = 'running'; progress = 0; elapsed = 0; cancelled = false; error = ''; isDirty = true;
    const t0 = performance.now(), n = runs;
    try {
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') { progress = m.f; elapsed = m.ms; isDirty = true; }
        else if (m.type === 'done') finish(m.res, m.ms);
        else if (m.type === 'error') { error = m.message; state = 'idle'; worker = null; isDirty = true; }
      };
      worker.onerror = () => { worker?.terminate(); worker = null; inline(n, t0); };
      worker.postMessage({ type: 'mc', runs: n });
    } catch { inline(n, t0); }
  }
  // If a worker cannot start, run on the page instead (slower to respond, same result).
  async function inline(n, t0) {
    try {
      const { monteCarlo } = await import('../../core/sim.js');
      const res = await monteCarlo({ nn: ctx.nn, runs: n, onProgress: (f) => { if (cancelled) throw new Error('cancelled'); progress = f; elapsed = performance.now() - t0; isDirty = true; } });
      finish(res, performance.now() - t0);
    } catch (e) { if (!cancelled) { error = String(e.message || e); state = 'idle'; isDirty = true; } }
  }

  function conclusion(res) {
    const n = res.runs, pc = (k) => ((k / n) * 100).toFixed(0) + ' %';
    const ppl = TRUTH.people.map((p) => ({ d: describe(p), r: res.people[p.id] }));
    const sum = (k) => ppl.reduce((s, x) => s + x.r[k], 0), fc = res.outcomes.filter((o) => o.falseConfirmed > 0).length, w = res.wastedVisits || 0, m = sum('missed'), of = n * ppl.length;
    return 'In ' + n + ' simulated missions ' + (m ? m + ' of ' + of + ' people were missed' : 'nobody was missed') + (fc ? ', a place with no one in it was confirmed in ' + fc + ' of them' : ', no empty place was ever confirmed as a person') + ', and the sensors alone confirmed ' + sum('confirmed') + ' of ' + of + ' people while the rescue team’s eyes settled ' + sum('flagged') + ' more' + (w ? ', at the cost of ' + w + ' visits that found no one.' : '.');
  }

  const emptyRows = () => h('div.fusion-mc-rows.is-empty', { 'aria-hidden': 'true' }, ...TRUTH.people.map((p) => { const d = describe(p); return h('div.fusion-mc-row', null, h('div.fusion-mc-who', null, h('b', null, d.who), h('span.dim', null, d.where)), h('div.fusion-mc-barwrap', null, h('div.fusion-mc-bar.is-empty')), h('div.fusion-mc-sum', null, h('span.dim', null, state === 'running' ? 'counting' : 'not run yet'))); }));

  function render() {
    runBtn.replaceChildren(icon(state === 'running' ? 'stop' : 'play'), state === 'running' ? 'Cancel' : result ? 'Run ' + runs + ' again' : 'Run ' + runs + ' missions');
    runBtn.classList.toggle('btn-primary', state !== 'running');
    sizeSeg.querySelectorAll('button').forEach((b) => (b.disabled = state === 'running'));
    estLine.textContent = state === 'running' ? '' : perRun ? 'about ' + Math.max(1, Math.round((perRun * runs) / 1000)) + ' s here' : 'runs in the background';
    strips.clear();
    if (state === 'running') {
      const done = Math.round(progress * runs), left = progress > 0 ? (elapsed / progress) * (1 - progress) / 1000 : null;
      stage.replaceChildren(h('div.fusion-mc-running', null,
        h('b.num', null, done + ' of ' + runs + ' missions'), h('div.bar', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': runs, 'aria-valuenow': done, 'aria-label': 'Missions simulated' }, h('i', { style: { width: progress * 100 + '%' } })),
        h('p.dim', null, left == null ? 'Starting: loading the network into a background thread.' : 'About ' + Math.max(1, Math.round(left)) + ' s left. Every mission is the full search, start to finish, with a different random Wi-Fi window at each stop.')), emptyRows());
      return;
    }
    if (!result) {
      stage.replaceChildren(h('div.fusion-mc-idle', null,
        error ? h('div.note.danger', null, 'The run stopped: ' + error + '. Try again.') : null,
        h('p', null, 'One mission is one story. Each run meets different Wi-Fi signals. This runs the whole mission again and again, each time drawing a random held-out test window at every stop, and counts what happened to each of the three people.'),
        h('ul.fusion-mc-list', null,
          h('li', null, h('i', { 'data-c': 'person' }), h('span', null, h('b', null, 'Confirmed by sensors: '), 'reached 85 % from the rover or the drone alone.')),
          h('li', null, h('i', { 'data-c': 'warn' }), h('span', null, h('b', null, 'Flagged for a team check: '), 'stayed between 15 % and 85 %, so people were sent to look.')),
          h('li', null, h('i', { 'data-c': 'danger' }), h('span', null, h('b', null, 'Missed: '), 'never raised, or closed with a person there. The number to keep at zero.'))),
        h('p.dim', null, 'People and decoys stay where they are in every run; radar and thermal likelihoods are design values. This measures the fusion logic, in this simulated scenario.'),
        emptyRows()));
      return;
    }
    const res = result, n = res.runs, times = res.outcomes.map((o) => o.time), tmin = Math.min(...times), tmax = Math.max(...times);
    const rows = TRUTH.people.map((p) => {
      const d = describe(p), r = res.people[p.id], found = r.confirmed + r.flagged, ci = wilson(r.missed, n);
      const strip = h('canvas.fusion-mc-strip', { 'aria-hidden': 'true' }); strips.set(p.id, strip);
      return h('div.fusion-mc-row', null,
        h('div.fusion-mc-who', { title: p.note }, h('b', null, d.who), h('span.dim', null, d.where)),
        h('div.fusion-mc-barwrap', null,
          h('div.fusion-mc-bar', { role: 'img', 'aria-label': d.who + ': ' + OUT.map(([k, label]) => label + ' ' + r[k] + ' of ' + n).join(', ') },
            ...OUT.map(([k, label, col]) => (r[k] ? h('i', { 'data-c': col, style: { flex: r[k] + ' 0 0' }, title: label + ': ' + r[k] + ' of ' + n }, h('span.num', null, ((r[k] / n) * 100).toFixed(0) + ' %')) : null))),
          strip),
        h('div.fusion-mc-sum.num', null, h('b', null, found + ' of ' + n + ' found'), h('span.dim', { title: 'Wilson 95 % interval for the true rate of missing this person, given ' + r.missed + ' misses in ' + n + ' runs.' }, 'missed: ' + (ci[0] * 100).toFixed(1).replace('.0', '') + ' to ' + (ci[1] * 100).toFixed(1) + ' %, 95 % interval')));
    });
    const fcRuns = res.outcomes.filter((o) => o.falseConfirmed > 0).length, fcCi = wilson(fcRuns, n), fcStrip = h('canvas.fusion-mc-strip', { 'aria-hidden': 'true' }); strips.set('fc', fcStrip);
    rows.push(h('div.fusion-mc-row.is-fc', null,
      h('div.fusion-mc-who', null, h('b', null, 'No one there'), h('span.dim', null, 'the fan, the hot pipe, or an empty room')),
      h('div.fusion-mc-barwrap', null,
        h('div.fusion-mc-bar', { role: 'img', 'aria-label': 'Missions that confirmed an empty place: ' + fcRuns + ' of ' + n },
          fcRuns ? h('i', { 'data-c': 'danger', style: { flex: fcRuns + ' 0 0' }, title: 'A lead with no person behind it reached 85 %: ' + fcRuns + ' of ' + n + ' missions' }, h('span.num', null, ((fcRuns / n) * 100).toFixed(0) + ' %')) : null,
          n - fcRuns ? h('i', { 'data-c': 'quiet', style: { flex: n - fcRuns + ' 0 0' }, title: 'Never confirmed: ' + (n - fcRuns) + ' of ' + n + ' missions' }, h('span.num', null, (((n - fcRuns) / n) * 100).toFixed(0) + ' % never confirmed')) : null),
        fcStrip),
      h('div.fusion-mc-sum.num', null, h('b', null, fcRuns + ' of ' + n + ' confirmed'), h('span.dim', null, 'confirmed with no one there: ' + (fcCi[0] * 100).toFixed(1).replace('.0', '') + ' to ' + (fcCi[1] * 100).toFixed(1) + ' %, 95 % interval'))));
    const hist = h('canvas.fusion-mc-hist', { role: 'img', 'aria-label': 'Histogram of simulated mission time, from ' + fmt.clock(tmin) + ' to ' + fmt.clock(tmax) });
    strips.set('hist', hist);
    stage.replaceChildren(
      h('p.fusion-mc-conclusion', null, conclusion(res)),
      h('div.fusion-mc-legend', null, ...OUT.map(([, label, col]) => h('span', null, h('i', { 'data-c': col }), label)), h('span.grow'), h('span.dim', null, 'thin strip: every mission, in the order it ran')),
      h('div.fusion-mc-rows', null, ...rows),
      h('div.fusion-mc-stats', null,
        h('div.stat', null, h('b', null, fmt.clock(res.meanTime)), h('span', null, 'mean mission time, in simulated minutes and seconds')),
        h('div.stat', null, h('b', null, String(res.wastedVisits || 0)), h('span', null, 'team visits that found no one, across ' + n + ' missions')),
        h('figure.fusion-mc-histfig', null, h('figcaption', null, h('b', null, 'How long a mission takes: '), 'a second look or a longer walk adds minutes'), hist)),
      h('p.dim.fusion-mc-foot', null, n + ' missions simulated in ' + (res.ms / 1000).toFixed(1) + ' s in a background thread. Random held-out Wi-Fi windows; the same building, people and decoys each time; radar and thermal likelihoods are design values. Scored against the simulation’s ground truth, which the console itself never sees. A result about this simulated scenario.'));
    requestAnimationFrame(paintCanvases);
  }
  function fit(cv) { const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); if (!r.width) return null; cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); return { c, w: r.width, h: r.height }; }
  function paintCanvases() {
    if (!result || state !== 'done') return;
    const T = tokens(), n = result.runs, col = { confirmed: T.person, flagged: T.warn, missed: T.danger };
    for (const p of TRUTH.people) {
      const cv = strips.get(p.id); if (!cv) continue; const f = fit(cv); if (!f) continue;
      const cw = f.w / n;
      result.outcomes.forEach((o, i) => { f.c.fillStyle = rgba(col[o.people[p.id]], o.people[p.id] === 'missed' ? 1 : 0.8); f.c.fillRect(i * cw, 0, Math.max(1, cw - (cw > 3 ? 1 : 0)), f.h); });
    }
    const fcv = strips.get('fc'), ff = fcv && fit(fcv);
    if (ff) { const cw = ff.w / n; result.outcomes.forEach((o, i) => { ff.c.fillStyle = o.falseConfirmed ? T.danger : rgba(T.text3, 0.35); ff.c.fillRect(i * cw, 0, Math.max(1, cw - (cw > 3 ? 1 : 0)), ff.h); }); }
    const hc = strips.get('hist'), f = hc && fit(hc);
    if (f) {
      const times = result.outcomes.map((o) => o.time), lo = Math.floor(Math.min(...times) / 60) * 60, hi = Math.ceil(Math.max(...times) / 60) * 60 || lo + 60, bins = Math.max(8, Math.round((hi - lo) / 15)), cnt = new Array(bins).fill(0);
      for (const t of times) cnt[Math.min(bins - 1, Math.floor(((t - lo) / (hi - lo)) * bins))]++;
      const m = Math.max(...cnt), l = 4, b = 18, top = 14, pw = f.w - l * 2, ph = f.h - b - top, bw = pw / bins, c = f.c;
      c.fillStyle = T.line2; c.fillRect(l, top + ph, pw, 1);
      cnt.forEach((k, i) => { if (!k) return; const bh = Math.max(2, (k / m) * ph); c.fillStyle = rgba(T.text2, 0.85); c.fillRect(l + i * bw + 1, top + ph - bh, Math.max(1, bw - 2), bh); });
      c.font = '500 10px ' + T.mono; c.fillStyle = T.text3; c.textBaseline = 'top';
      const every = Math.max(1, Math.ceil(((hi - lo) / 60) * 44 / pw)) * 60; for (let t = lo; t <= hi; t += 60) { const x = l + ((t - lo) / (hi - lo)) * pw; c.fillStyle = T.line2; c.fillRect(Math.round(x), top + ph, 1, 4); c.fillStyle = T.text3; c.textAlign = t === lo ? 'left' : t === hi ? 'right' : 'center'; if ((t - lo) % every === 0 && (t === lo || hi - t >= every || t === hi)) c.fillText(fmt.clock(t), x, top + ph + 6); }
      const mx = l + ((result.meanTime - lo) / (hi - lo)) * pw; c.fillStyle = T.accent; c.fillRect(mx - 0.75, top - 2, 1.5, ph + 2);
      c.font = '600 10px ' + T.font; c.textBaseline = 'bottom'; c.textAlign = mx > f.w - 70 ? 'right' : 'left'; c.fillText('mean ' + fmt.clock(result.meanTime), mx + (mx > f.w - 70 ? -5 : 5), top - 1);
    }
  }
  let ro = null;
  try { ro = new ResizeObserver(() => paintCanvases()); ro.observe(stage); } catch { /* no ResizeObserver: the strips are painted once */ }

  return { dirty() { isDirty = true; }, frame() { if (!isDirty) return; isDirty = false; render(); } };
}
