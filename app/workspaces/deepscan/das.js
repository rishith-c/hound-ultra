// Exhibit 4. Distributed acoustic sensing: one optical fibre, read by laser pulses, becomes hundreds of microphones.
// Forward model: first arrivals bent through the true pile (eikonal), turned into strain along the fibre over one gauge
// length, plus channel noise and coda. Inverse: pick the onset on every channel, then search for the point whose
// arrival curve fits the picks (robust misfit), using the fibre's known path and the floor slab on the drawings.
import { WORLD, eikonal, sampleGrid } from './model.js';
import * as L from './lib.js';
import * as W from './waves.js';

const FS = 8000, N = 640, PRE = 0.012, DX = 0.25;  // samples a second, samples (80 ms), quiet lead, channel spacing m
const FC = 450;                                     // hertz, middle of the knock's band (assumed)
const CR = 0.25, CNX = 96, CNZ = 32;
const COUPLE = { glued: 0.5, laid: 1.6, loose: 6 }; // channel noise against the strain of a tap 1 m away, x 1e-2 (assumed)
const STEP = 7;                                     // the solver uses every 7th channel, 1.75 m apart

export default function create(env) {
  const { h } = env, ui = env.ui;
  const P = { gauge: 1, couple: 'laid', taps: 8, route: 'loop', t: 1, playing: false };
  let pile, slow, T, tap, path = [], ch = [], D = null, picks = [], field = new Float32Array(CNX * CNZ), cv = null, wf = null, M = {}, drag = false, tab = [];

  function route() {
    const x0 = pile.extent[0], x1 = pile.extent[1], s = (x) => pile.surfAt(x) - 0.15;
    // a fibre already in the building (bonded to the floor slab), or one laid over the heap, or both joined in a loop
    const low = [[4.7, 0.05], [8, -0.28], [12, -0.28], [16, -0.28], [20.2, 0.05]], top = []; for (let x = x1 - 1.4; x >= x0 + 1.2; x -= 0.5) top.push([x, s(x)]);
    path = P.route === 'floor' ? low : P.route === 'top' ? top : [...low, [21.4, 0.5], ...top];
    ch = []; let acc = 0, next = 0; for (let i = 1; i < path.length; i++) { const [ax, az] = path[i - 1], [bx, bz] = path[i], l = Math.hypot(bx - ax, bz - az); while (next <= acc + l) { const u = (next - acc) / l; ch.push({ s: next, x: ax + (bx - ax) * u, z: az + (bz - az) * u, dx: (bx - ax) / l, dz: (bz - az) / l }); next += DX; } acc += l; }
    M.len = acc;
    const f = W.planField(pile); tab = []; for (let j = 0; j < ch.length; j += STEP) tab.push(eikonal(f, ch[j].x, ch[j].z));
  }
  const at = (s) => { const i = L.clamp(s / DX, 0, ch.length - 1.001), k = Math.floor(i), u = i - k, a = ch[k], b = ch[k + 1]; return [a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u]; };
  function setPile(p) { pile = p; slow = W.slowness(p); tap = W.tapPoint(p); T = W.travel(slow, tap.x, tap.z); P.t = 1; P.playing = false; route(); measure(); }
  function measure() {
    const r = L.rng(pile.seed * 733 + 11), nc = ch.length, lev = COUPLE[P.couple] * 0.01 / Math.sqrt(P.taps); D = new Float32Array(nc * N);
    const disp = (x, z) => { const d = Math.hypot(x - tap.x, z - tap.z) + 0.3; return { t: PRE + sampleGrid(T, x, z), a: Math.exp(-d / 9) / Math.sqrt(1 + d), ux: (x - tap.x) / d, uz: (z - tap.z) / d }; };
    const rc = L.rng(pile.seed * 41 + 3), coda = Array.from({ length: 14 }, () => [0.002 + 0.025 * rc() * rc(), rc.gauss() * 0.14, rc.range(-0.004, 0.004)]);
    ch.forEach((c, j) => {
      const a = at(c.s - P.gauge / 2), b = at(c.s + P.gauge / 2), A = disp(a[0], a[1]), B = disp(b[0], b[1]), pa = A.a * (A.ux * c.dx + A.uz * c.dz), pb = B.a * (B.ux * c.dx + B.uz * c.dz); // stretch between the two ends of the gauge
      for (let k = 0; k < N; k++) { const t = k / FS; let v = (pb * W.knock(t - B.t, FC) - pa * W.knock(t - A.t, FC)) / P.gauge; for (const q of coda) v += (pb * W.knock(t - B.t - q[0] - q[2] * Math.sin(c.s * 1.7), FC) - pa * W.knock(t - A.t - q[0] - q[2] * Math.sin(c.s * 1.7), FC)) / P.gauge * q[1] * 3 * Math.exp(-q[0] * 60); D[j * N + k] = v + lev * r.gauss() / P.gauge; }
      c.t0 = PRE + sampleGrid(T, c.x, c.z);
    });
    // common laser noise, then removed with the per-sample median, as every DAS chain does
    solve();
  }
  function solve() {
    const nc = ch.length; picks = [];
    for (let j = 0; j < nc; j++) { // onset picker: short-term over long-term energy, then back to the first rise
      const o = j * N; let ns = 0; const n0 = Math.floor(PRE * FS * 0.9); for (let k = 0; k < n0; k++) ns += D[o + k] ** 2; ns = Math.sqrt(ns / n0) + 1e-9;
      let pk = 0; for (let k = 0; k < N; k++) pk = Math.max(pk, Math.abs(D[o + k])); const snr = pk / ns; let hit = -1; const thr = Math.max(4.2 * ns, pk * 0.18); for (let k = n0; k < N; k++) if (Math.abs(D[o + k]) > thr) { hit = k; break; }
      if (hit > 0 && snr > 6) picks.push({ j, t: (hit - 1) / FS, w: Math.min(1, snr / 20) });
    }
    // only channels with a precomputed table vote; each is the median pick of its neighbours
    const votes = []; for (let n = 0; n < tab.length; n++) { const near = picks.filter((p) => Math.abs(p.j - n * STEP) <= 1); if (near.length) votes.push({ n, t: med(near.map((p) => p.t)), w: Math.max(...near.map((p) => p.w)) }); }
    let bs = -1, b = { x: 12, z: 1, t0: PRE }; const best = new Float32Array(CNX * CNZ), tr = new Float64Array(votes.length);
    const S2 = 0.0005; if (votes.length > 5) for (let k = 0; k < CNZ; k++) for (let i = 0; i < CNX; i++) {
      const x = (i + 0.5) * CR, z = -3 + (k + 0.5) * CR; if (z > pile.surfAt(x) - 0.1 || z < -0.3 || x < pile.extent[0] || x > pile.extent[1]) continue;
      const cell = pile.cellAt(x, z); for (let n = 0; n < votes.length; n++) tr[n] = votes[n].t - tab[votes[n].n][cell];
      const t0 = med(tr); let s = 0, sw = 0; for (let n = 0; n < votes.length; n++) { const e = (tr[n] - t0) / S2; s += votes[n].w / (1 + e * e); sw += votes[n].w; } s /= sw; best[k * CNX + i] = s; if (s > bs) { bs = s; b = { x, z, t0 }; }
    }
    let mx = 0, mn = 1; for (const q of best) if (q > 0) { mx = Math.max(mx, q); mn = Math.min(mn, q); } for (let q = 0; q < field.length; q++) field[q] = best[q] > 0 ? Math.pow((best[q] - mn) / (mx - mn || 1), 3) : 0;
    let sx = 0, sz = 0, sw = 0; for (let q = 0; q < field.length; q++) if (field[q] > 0.8) { const i = q % CNX, k = (q - i) / CNX; sw += 1; sx += (i + 0.5) * CR; sz += -3 + (k + 0.5) * CR; }
    cv = L.gridImage(cv, field, CNX, CNZ, 'scan', 0.15, 1);
    let near = 0; ch.forEach((c, j) => { if (Math.hypot(c.x - tap.x, c.z - tap.z) < Math.hypot(ch[near].x - tap.x, ch[near].z - tap.z)) near = j; });
    M = { len: M.len, x: b.x, z: b.z, t0: b.t0, err: votes.length > 5 ? Math.hypot(b.x - tap.x, b.z - tap.z) : NaN, n: picks.length, fit: bs, spread: sw * CR * CR, near };
    M.ok = M.err < 1.5; wf = null;
  }
  const med = (a) => { const b = Array.from(a).sort((x, y) => x - y); return b[b.length >> 1]; };
  function controls() {
    const go = ui.button({ label: 'Tap', ico: 'play', primary: true, title: 'Send one knock and watch it run along the fibre', onclick: () => { P.t = 0; P.playing = true; } });
    const rt = ui.seg({ label: 'Where the fibre runs', value: P.route, options: [{ v: 'floor', l: 'Floor slab' }, { v: 'top', l: 'Over the heap' }, { v: 'loop', l: 'Both' }], hint: 'A straight fibre cannot tell which side of it a tap came from. A loop can.', onchange: (v) => { P.route = v; route(); measure(); env.refresh(); } });
    const g = ui.seg({ label: 'Gauge length', value: P.gauge, options: [1, 2, 5, 10].map((v) => ({ v, l: v + ' m' })), hint: 'Each channel reports the stretch averaged over this length. Long gauges are quieter and blur where.', onchange: (v) => { P.gauge = v; measure(); env.refresh(); } });
    const cp = ui.seg({ label: 'How well the fibre touches the rubble', value: P.couple, options: [{ v: 'glued', l: 'Bonded' }, { v: 'laid', l: 'Laid' }, { v: 'loose', l: 'Dangling' }], onchange: (v) => { P.couple = v; measure(); env.refresh(); } });
    const tp = ui.slider({ label: 'Knocks added together', min: 1, max: 30, value: P.taps, fmt: String, oninput: (v) => { P.taps = v; measure(); env.refresh(); } });
    return h('div.ds-controls', null, h('div.ds-row', null, go), rt, g, cp, tp, h('p.ds-hint', null, 'Drag the tap to another place in the pile.'));
  }
  const TMAX = 0.03;
  function tick(dt) { if (!P.playing) return false; if (env.reduced()) { P.t = 1; P.playing = false; env.refresh(); return false; } P.t = Math.min(1, P.t + dt / 4.2); if (P.t >= 1) { P.playing = false; env.refresh(); } return true; }
  function drawStage(S) {
    const { c } = S, now = P.t * TMAX, done = P.t >= 1;
    if (done) W.drawField(S, cv, field, CR, CNX, CNZ, S.truth ? 0.6 : 0.9); else W.drawFront(S, T, now);
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); ch.forEach((q, j) => { if (j) c.lineTo(S.X(q.x), S.Z(q.z)); else c.moveTo(S.X(q.x), S.Z(q.z)); }); c.strokeStyle = L.col('--bg-0', 0.9); c.lineWidth = S.thumb ? 3 : 5; c.stroke(); c.strokeStyle = L.col('--accent', 0.75); c.lineWidth = S.thumb ? 1 : 1.75; c.stroke();
    if (!done) for (const q of ch) { const d = PRE + now - q.t0, a = d < 0 ? 0 : Math.exp(-d / 0.0035); if (a < 0.03) continue; c.fillStyle = 'rgba(255,255,255,' + a + ')'; c.beginPath(); c.arc(S.X(q.x), S.Z(q.z), 2 + 2 * a, 0, 6.283); c.fill(); }
    c.restore();
    if (!S.thumb && ch.length) { const a = ch[0], b = ch[ch.length - 1]; L.tagLabel(c, S.X(a.x), S.Z(a.z), 'fibre, 0 m', { dx: -16, dy: 30, align: 'right', color: '--accent' }); L.tagLabel(c, S.X(b.x), S.Z(b.z), M.len.toFixed(0) + ' m', { dx: P.route === 'floor' ? 14 : -14, dy: -22, align: P.route === 'floor' ? 'left' : 'right', color: '--accent' }); }
    if (S.truth) W.cross(S, tap.x, tap.z, '--person', done ? null : 'tap', { dx: 12, dy: 24 });
    if (done && !isNaN(M.err)) W.cross(S, M.x, M.z, '--accent', 'solved: ' + M.err.toFixed(1) + ' m from the tap', { dx: 20, dy: -30 });
  }
  function waterfall() { let mx = []; for (let i = 0; i < D.length; i += 13) mx.push(Math.abs(D[i])); mx.sort((a, b) => a - b); const k = mx[Math.floor(mx.length * 0.985)] || 1, nc = ch.length, img = new Float32Array(nc * N); for (let j = 0; j < nc; j++) for (let t = 0; t < N; t++) img[t * nc + j] = D[j * N + t]; wf = L.gridImage(wf, img, nc, N, 'bipolar', -k, k, { flip: false }); }
  function drawReadout(R) {
    if (!wf) waterfall();
    const { c, w, h: hh } = R, l = 52, r = w - 18, t = 12, b = hh - 36, nc = ch.length, show = 0.045, rows = Math.round(show * FS), X = (s) => l + s / M.len * (r - l), Y = (ms) => t + (ms / 1000 + 0.004) / show * (b - t), k0 = Math.round((PRE - 0.004) * FS), now = P.t * TMAX;
    c.save(); c.beginPath(); c.rect(l, t, r - l, b - t); c.clip(); c.imageSmoothingEnabled = true; const part = P.t >= 1 ? 1 : L.clamp((now + 0.004) / show, 0, 1); c.drawImage(wf, 0, k0, nc, Math.max(1, rows * part), l, t, r - l, (b - t) * part);
    if (P.t >= 1 && !isNaN(M.err)) { c.strokeStyle = L.tok('--accent'); c.lineWidth = 1.5; c.beginPath(); tab.forEach((tb, n) => { const q = ch[n * STEP], x = X(q.s), y = Y((M.t0 + sampleGrid(tb, M.x, M.z) - PRE) * 1000); if (n) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke(); c.fillStyle = L.col('--text', 0.85); for (const p of picks) c.fillRect(X(ch[p.j].s) - 1, Y((p.t - PRE) * 1000) - 1, 2, 2); }
    if (R.truth) { c.strokeStyle = L.col('--person', 0.9); c.setLineDash([3, 4]); c.lineWidth = 1; c.beginPath(); ch.forEach((q, j) => { const x = X(q.s), y = Y((q.t0 - PRE) * 1000); if (j) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke(); c.setLineDash([]); }
    c.restore(); c.save(); c.strokeStyle = L.tok('--line-2'); c.strokeRect(l + 0.5, t + 0.5, r - l, b - t); c.font = L.font(11); c.fillStyle = L.tok('--text-3'); c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let ms = 0; ms <= 40; ms += 10) c.fillText(ms + (ms ? '' : ' ms'), l - 6, Y(ms)); c.textAlign = 'center'; c.textBaseline = 'top'; for (const s of L.ticks(0, M.len, 8)) c.fillText(s + ' m', X(s), b + 5); c.fillText('distance along the fibre', (l + r) / 2, b + 19);
    c.textAlign = 'left'; let lx = l + 10; for (const [n, k, on] of [['picked onset', '--text', P.t >= 1], ['best-fit arrival', '--accent', P.t >= 1], ['true arrival', '--person', R.truth]]) { if (!on) continue; const tw = c.measureText(n).width; c.fillStyle = L.col('--bg-1', 0.85); c.fillRect(lx - 4, t + 6, tw + 24, 17); c.fillStyle = L.tok(k); c.fillRect(lx, t + 13, 10, 2); c.fillText(n, lx + 15, t + 9); lx += tw + 34; }
    c.restore();
  }
  function pointer(kind, p) { if (kind === 'down' || kind === 'hover') { const on = Math.hypot(tap.x - p.x, tap.z - p.z) * p.S.s < 14; if (kind === 'down') drag = on; return on; } if (kind === 'move' && drag && p.x !== undefined) { const x = L.clamp(p.x, pile.extent[0] + 1, pile.extent[1] - 1); tap = { x, z: L.clamp(p.z, -0.15, pile.surfAt(x) - 0.4) }; T = W.travel(slow, tap.x, tap.z); P.t = 1; measure(); } if (kind === 'up') drag = false; return true; }
  function verdicts() {
    const out = {}; for (const v of pile.voids) out[v.id] = { state: 'na', text: 'silent', why: 'A fibre hears people, not spaces.' };
    out.person = isNaN(M.err) ? { state: 'missed', text: 'too quiet', why: 'Too few channels heard the knock.' } : M.err < 1.5 ? { state: 'seen', text: M.err.toFixed(1) + ' m off', why: 'Distance from the solved point to the true tap.' } : { state: M.err < 3 ? 'hint' : 'missed', text: M.err.toFixed(1) + ' m off', why: 'The fitted point is too far from the true tap.' };
    return out;
  }
  return {
    title: 'A fibre as a microphone', hardware: 'DAS interrogators are sold for pipelines and seismology. One wired into rubble is a concept.',
    lede: 'Laser pulses sent down a glass fibre scatter back from every metre of it, and a vibration shifts the light that returns. Reading those shifts turns one cable into a microphone every few centimetres, and the moment each stretch hears a knock draws a curve that points to the person.',
    honest: 'the fibre has to be in the rubble already or be pushed in, it has to touch what it listens to, and the person has to make a sound. How well a loose cable couples to broken concrete is the big unknown; switch to dangling to see why it matters.',
    assumed: 'Assumed: channels every 0.25 m, gauge length 1 to 10 m, a 450 Hz knock, coupling noise levels, coda of about 25 ms. Wave speeds as in the pile model; the solver knows the floor slab from drawings and one speed for the rubble, and searches above the floor only.',
    sources: [
      { who: 'Lindsey et al., Geophys. Res. Lett. 44 (2017).', what: 'Fiber-optic network observations of earthquake wavefields: existing cable used as a dense seismic array.', url: 'https://doi.org/10.1002/2017GL075722' },
      { who: 'Zhan, Seismol. Res. Lett. 91 (2020).', what: 'Distributed acoustic sensing turns fiber-optic cables into sensitive seismic antennas.', url: 'https://doi.org/10.1785/0220190112' },
    ],
    setPile, controls, drawStage, drawReadout, tick, verdicts, pointer,
    _demo: () => ({ T, tap, path, ch, picks, field, M, P, CR, CNX, CNZ, PRE, D, N, FS, measure, route }),
    stageTitle: () => (P.t < 1 ? 'A knock running along the fibre' : 'Where the arrivals fit'), stageNote: () => (P.t < 1 ? (P.t * TMAX * 1000).toFixed(0) + ' ms after the tap, slowed 140 times' : M.n + ' of ' + ch.length + ' channels heard it'),
    readoutTitle: () => ['The knock draws a curve, and its turning point is nearest the person', 'Waterfall: one column per channel, time running down. White and blue are stretch and squeeze.'],
    results: () => [
      { k: 'Position error', v: isNaN(M.err) ? 'not heard' : M.err.toFixed(2) + ' m', sub: 'solved point to true tap', tone: M.err < 1 ? 'ok' : M.err < 2 ? 'warn' : 'bad' },
      { k: 'Channels that heard it', v: M.n + ' / ' + ch.length, sub: 'onset above the noise' },
      { k: 'Along the floor', v: isNaN(M.err) ? 'not heard' : Math.abs(M.x - tap.x).toFixed(2) + ' m', sub: 'sideways error; height is the weak part', tone: Math.abs(M.x - tap.x) < 0.5 ? 'ok' : 'warn' },
      { k: 'Fibre', v: M.len.toFixed(0) + ' m', sub: 'one channel every 0.25 m (assumed)' },
    ],
    row: { sees: 'Anyone who knocks or shouts near the cable.', range: 'A few metres either side of a fibre that can run kilometres', time: 'Seconds once it is in place', cost: 'High', costNote: 'the interrogator; the fibre is cheap', ready: 3, readyNote: 'Fielded on pipelines and for earthquakes. Not in a collapse.' },
    summary: () => (isNaN(M.err) ? 'too quiet to place' : 'the tap, ' + M.err.toFixed(1) + ' m off, ' + M.n + ' channels'),
  };
}
