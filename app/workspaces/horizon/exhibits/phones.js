// Phones as beacons. Buried phones send short Bluetooth adverts; phones carried by people walking over the pile hear
// some of them. Every advert, its loss through air and rubble, and its fading are simulated; the position of each
// buried phone is then estimated from the heard signal strengths alone and compared with where it really is.
import * as L from '../lib.js';
const { TAU, clamp } = L;
const W = 60, H = 40, GX = 120, GY = 80, TXP = 0, PL1 = 40, SENS = -95;      // metres; 0 dBm, 40 dB at one metre (2.4 GHz free space), receiver limit: assumed
const loss = (dh, depth, att) => { const d = Math.hypot(dh, depth + 1.1), inR = depth * d / (depth + 1.1); return PL1 + 20 * Math.log10(Math.max(0.3, d)) + att * inR; };
const DEPTHS = [0.5, 1, 2, 3, 4];
function walkers(n, secs, R) {                     // each walker strides at 0.6 m/s between random points of the pile
  const out = []; for (let k = 0; k < n; k++) { let p = [R() * W, R() * H], q = [R() * W, R() * H]; const tr = new Float32Array((secs + 1) * 2); for (let t = 0; t <= secs; t++) { tr[2 * t] = p[0]; tr[2 * t + 1] = p[1]; let s = 0.6; for (let g = 0; g < 3 && s > 0; g++) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d > s) { p = [p[0] + (q[0] - p[0]) / d * s, p[1] + (q[1] - p[1]) / d * s]; s = 0; } else { p = q; q = [R() * W, R() * H]; s -= d; } } } out.push(tr); } return out;
}
export default {
  id: 'phones', title: 'Phones as beacons', short: 'Phones',
  readiness: 1.2, readinessNote: 'Crowd-sourced Bluetooth finding runs on ordinary phones for lost items, and researchers have proposed it for trapped people. We verified no rescue made this way. HOUND does not do it.',
  standoff: [1, 20],
  labels: ['concept', 'live-algo'],
  labelNote: 'The pile, the phones, the walkers and every radio message are simulated. The position estimates and the repeated searches are computed in this page. Transmit power, rubble loss, fading and battery behaviour are assumed.',
  sentences: [
    'A phone under rubble can whisper a short Bluetooth message every second, and any other phone that passes overhead can hear it and note where it was.',
    'Enough passing phones turn a crowd of rescuers and neighbours into one large antenna, and the pattern of strong and weak whispers points to where to dig.',
  ],
  needs: 'Phones that keep whispering when their owner cannot touch them, a battery that lasts, consent built in from the start, and rubble dry and open enough to let 2.4 GHz out.',
  unknown: 'How much rubble really absorbs: published loss figures vary widely and wet debris is far worse. A phone is not a person: some will be in empty rooms.',
  sources: [
    { who: 'Heinrich, Stute, Kornhuber and Hollick, TU Darmstadt', year: 2021, title: 'Who can find my devices? Security and privacy of Apple’s crowd-sourced Bluetooth location tracking system', where: 'PoPETs 2021(3), 227–245', url: 'https://doi.org/10.2478/popets-2021-0045' },
    { who: 'Tai and Yu', year: 2022, title: 'Using smartphones to locate trapped victims in disasters', where: 'Sensors 22(19), 7502', url: 'https://doi.org/10.3390/s22197502' },
  ],
  glyph(g, s, t, c) { g.strokeStyle = c.ink; g.strokeRect(-s * 0.09, s * 0.02, s * 0.18, s * 0.3); g.strokeStyle = c.accent; for (let k = 0; k < 3; k++) { const q = (t * 0.5 + k / 3) % 1; g.globalAlpha = 1 - q; g.beginPath(); g.arc(0, s * 0.02, q * s * 0.46, -Math.PI * 0.85, -Math.PI * 0.15); g.stroke(); } g.globalAlpha = 1; },
  create({ stage, controls, readout }) {
    L.layout(stage, { cols: '1fr 1fr', rows: '1.9fr 1fr', areas: ['map map', 'prob rssi'] });
    const fMap = L.figure({ area: 'map', title: 'Listening…' }), fPr = L.figure({ area: 'prob', title: 'More passing phones, more found' }), fRs = L.figure({ area: 'rssi', title: 'What was heard' });
    stage.append(fMap.el, fPr.el, fRs.el);
    const P = { n: 8, att: 12, mins: 10, seed: 5 };
    let D = null, est = [], t = 0, playing = true, curve = null, job = 0, vw = {};
    function build() {
      const R = L.rng(P.seed), secs = P.mins * 60; const ph = DEPTHS.map((z, i) => ({ x: 6 + (i + 0.5) * (48 / 5) + 4 * (R() - 0.5), y: 6 + 28 * R(), z }));
      D = { R, secs, ph, tr: walkers(P.n, secs, R), heard: ph.map(() => []) };
      ph.forEach((p, i) => { const sh = 3 * R.n(); for (let s = 0; s <= secs; s++) D.tr.forEach((w, k) => { const rs = TXP - loss(Math.hypot(w[2 * s] - p.x, w[2 * s + 1] - p.y), p.z, P.att) + sh + 4 * R.n(); if (rs > SENS) D.heard[i].push([s, w[2 * s] + 1.5 * R.n(), w[2 * s + 1] + 1.5 * R.n(), rs, k]); }); });
      if (t > secs) t = 0; estAt = -99;
    }
    let estAt = -99;
    // grid posterior for each phone: position from signal strengths, depth unknown and averaged over
    function estimate(now) {
      estAt = now; est = D.ph.map((p, i) => {
        const obs = D.heard[i].filter((o) => o[0] <= now); if (obs.length < 3) return { n: obs.length };
        const st = Math.max(1, Math.floor(obs.length / 60)), use = obs.filter((_, k) => k % st === 0), lp = new Float32Array(GX * GY).fill(-1e9);
        for (const z of DEPTHS) for (let j = 0; j < GY; j++) for (let q = 0; q < GX; q++) { const x = (q + 0.5) * W / GX, y = (j + 0.5) * H / GY; let m = 0; const e = []; for (const o of use) { const v = o[3] - (TXP - loss(Math.hypot(o[1] - x, o[2] - y), z, P.att)); e.push(v); m += v; } m = clamp(m / e.length, -8, 8); let s = -m * m / 18; for (const v of e) s -= ((v - m) ** 2) / 72; const k = j * GX + q; if (s > lp[k]) lp[k] = s; }
        let mx = -1e9; for (const v of lp) if (v > mx) mx = v; let sx = 0, sy = 0, sw = 0; for (let k = 0; k < lp.length; k++) { const w = Math.exp(lp[k] - mx); lp[k] = w; sw += w; sx += w * ((k % GX) + 0.5) * W / GX; sy += w * (Math.floor(k / GX) + 0.5) * H / GY; }
        const x = sx / sw, y = sy / sw; return { n: obs.length, x, y, err: Math.hypot(x - p.x, y - p.y), lp };
      });
      const post = L.raster(GX, GY), tk = L.tokens().rgb.accent; post.paint((k) => { const j = GY - 1 - Math.floor(k / GX), q = k % GX; let v = 0; for (const e of est) if (e.lp) v = Math.max(v, e.lp[j * GX + q]); return [tk[0], tk[1], tk[2], 150 * v]; }); D.post = post; paint();
    }
    function trials() {                              // repeated searches: chance that a phone at each depth is heard three times
      const id = ++job, ns = [1, 2, 4, 8, 16, 32], zs = [1, 2, 4], T = 24; curve = { ns, zs, p: zs.map(() => []) }; let a = 0;
      const step = () => { if (id !== job) return; const n = ns[a], R = L.rng(700 + a); const c = zs.map(() => 0);
        for (let k = 0; k < T; k++) { const tr = walkers(n, P.mins * 60, R); zs.forEach((z, zi) => { const x = 5 + 50 * R(), y = 5 + 30 * R(), sh = 3 * R.n(); let m = 0; for (let s = 0; s <= P.mins * 60 && m < 3; s++) for (const w of tr) { const d = Math.hypot(w[2 * s] - x, w[2 * s + 1] - y); if (TXP - loss(d, z, P.att) + sh + 4 * R.n() > SENS) m++; } if (m >= 3) c[zi]++; }); }
        zs.forEach((_, zi) => curve.p[zi].push(c[zi] / T)); fPr.redraw(); if (++a < ns.length) setTimeout(step, 30); else paint(); };
      setTimeout(step, 30);
    }
    const rubble = (() => { const R = L.rng(31); return Array.from({ length: 420 }, () => { const x = R() * W, y = R() * H, s = 0.4 + 2.2 * R() ** 2, a = R() * 3; return { p: Array.from({ length: 5 }, (_, k) => [x + Math.cos(a + k * 1.256) * s * (0.6 + 0.5 * R()), y + Math.sin(a + k * 1.256) * s * (0.5 + 0.5 * R())]), l: R() }; }); })();
    fMap.draw = (g, w, h) => {
      const sc = Math.min((w - 8) / W, (h - 8) / H), ox = (w - W * sc) / 2, oy = (h + H * sc) / 2, X = (x) => ox + x * sc, Y = (y) => oy - y * sc, TK = L.tokens(); vw = { sc, ox, oy };
      g.fillStyle = TK.bg1; g.fillRect(X(0), Y(H), W * sc, H * sc); g.save(); g.beginPath(); g.rect(X(0), Y(H), W * sc, H * sc); g.clip();
      for (const r of rubble) { g.beginPath(); r.p.forEach((q, k) => (k ? g.lineTo(X(q[0]), Y(q[1])) : g.moveTo(X(q[0]), Y(q[1])))); g.closePath(); g.fillStyle = L.rgba('bg4', 0.35 + 0.45 * r.l); g.fill(); g.strokeStyle = L.rgba('bg0', 0.8); g.lineWidth = 0.75; g.stroke(); }
      if (D.post) { g.imageSmoothingEnabled = true; g.drawImage(D.post.canvas, X(0), Y(H), W * sc, H * sc); }
      const s = Math.min(D.secs, Math.floor(t));
      D.tr.forEach((tr) => { g.strokeStyle = L.rgba('text', 0.16); g.lineWidth = 1; g.beginPath(); for (let q = Math.max(0, s - 60); q <= s; q++) q === Math.max(0, s - 60) ? g.moveTo(X(tr[2 * q]), Y(tr[2 * q + 1])) : g.lineTo(X(tr[2 * q]), Y(tr[2 * q + 1])); g.stroke(); });
      D.ph.forEach((p, i) => { const last = D.heard[i].filter((o) => o[0] <= s && o[0] > s - 3); for (const o of last) { const tr = D.tr[o[4]]; g.strokeStyle = L.rgba('accent', 0.5); g.beginPath(); g.moveTo(X(p.x), Y(p.y)); g.lineTo(X(tr[2 * s]), Y(tr[2 * s + 1])); g.stroke(); } const q = (t * 0.9 + i * 0.3) % 1; g.strokeStyle = L.rgba('person', 0.5 * (1 - q)); g.beginPath(); g.arc(X(p.x), Y(p.y), 5 + q * 16, 0, TAU); g.stroke(); });
      D.tr.forEach((tr) => { g.fillStyle = TK.text; g.beginPath(); g.arc(X(tr[2 * s]), Y(tr[2 * s + 1]), 3, 0, TAU); g.fill(); }); g.restore();
      D.ph.forEach((p, i) => { const e = est[i] || {}; g.fillStyle = TK.person; g.beginPath(); g.arc(X(p.x), Y(p.y), 4, 0, TAU); g.fill(); L.text(g, p.z + ' m deep', X(p.x) + 8, Y(p.y) - 7, { color: 'person', halo: true });
        if (e.x != null) { g.strokeStyle = TK.accent; g.lineWidth = 1.5; const a = X(e.x), b = Y(e.y); g.beginPath(); g.moveTo(a - 7, b); g.lineTo(a + 7, b); g.moveTo(a, b - 7); g.lineTo(a, b + 7); g.stroke(); L.text(g, e.err.toFixed(1) + ' m off', a + 9, b + 14, { color: 'accent', halo: true }); } });
      L.scaleBar(g, X(W) - 10 * sc - 14, Y(0) - 12, sc, { metres: 10 });
    };
    fMap.legend([{ label: 'buried phone, truth', color: 'person', kind: 'dot' }, { label: 'passing phone', color: 'text', kind: 'dot' }, { label: 'estimate', color: 'accent', kind: 'line' }]);
    const DC = ['accent', 'sim', 'person'];
    fPr.draw = (g, w, h) => { const Pl = L.plot(g, L.pad(w, h, { t: 18, l: 50 }), { xd: [1, 32], yd: [0, 1], xlog: true, xticks: [1, 2, 4, 8, 16, 32], xfmt: String, yfmt: (v) => Math.round(v * 100) + ' %', xlabel: 'phones passing over the pile' }); L.text(g, 'chance of being heard', 50, 11, { color: 'text3', size: 11 }); if (!curve) return; curve.zs.forEach((z, i) => { const ys = curve.p[i]; L.trace(g, Pl, curve.ns, ys, { color: DC[i], n: ys.length }); L.dots(g, Pl, curve.ns.slice(0, ys.length), ys, { color: DC[i] }); }); };
    fPr.legend([{ label: '1 m deep', color: DC[0], kind: 'line' }, { label: '2 m', color: DC[1], kind: 'line' }, { label: '4 m', color: DC[2], kind: 'line' }]);
    fRs.draw = (g, w, h) => { const Pl = L.plot(g, L.pad(w, h, { t: 18 }), { xd: [0, 24], yd: [-100, -40], xlabel: 'distance along the ground, m' }); L.text(g, 'signal strength, dBm', 46, 11, { color: 'text3', size: 11 }); D.heard.forEach((a, i) => { const p = D.ph[i]; g.fillStyle = L.rgba(i < 2 ? 'accent' : 'sim', 0.45); for (let k = 0; k < a.length; k += 2) { const o = a[k], tr = D.tr[o[4]]; if (o[0] > t) break; const d = Math.hypot(tr[2 * o[0]] - p.x, tr[2 * o[0] + 1] - p.y); if (d < 24) g.fillRect(Pl.X(d) - 1, Pl.Y(o[3]) - 1, 2, 2); } }); const xs = Array.from({ length: 50 }, (_, i) => i * 0.48); for (const z of [0.5, 2, 4]) L.trace(g, Pl, xs, xs.map((x) => TXP - loss(x, z, P.att)), { color: 'text2', dash: [4, 3], width: 1 }); L.rule(g, Pl, { y: SENS, label: 'too faint to hear (assumed)', color: 'warn' }); };
    const sN = L.stat('phones located'), sE = L.stat('median position error', { unit: 'm' }), sW = L.stat('worst position error', { unit: 'm' }), sM = L.stat('messages heard');
    function paint() { const ok = est.filter((e) => e.err != null), er = ok.map((e) => e.err).sort((a, b) => a - b); sN.set(ok.length + ' of ' + D.ph.length); sN.tone(ok.length === D.ph.length ? 'ok' : 'warn'); sE.set(L.fix(er.length ? er[er.length >> 1] : NaN)); sW.set(L.fix(er.length ? er[er.length - 1] : NaN)); sM.set(est.reduce((s, e) => s + (e.n || 0), 0).toLocaleString('en-US'));
      fMap.setTitle(ok.length + ' of ' + D.ph.length + ' buried phones located after ' + (t / 60).toFixed(1) + ' minutes' + (er.length ? ', median error ' + er[er.length >> 1].toFixed(1) + ' m' : '')); fMap.setNote('A simulated pile, 60 by 40 m. Each message must beat the rubble (' + P.att + ' dB a metre, assumed). Blue glow: where the estimate puts a phone. The estimate is told the true loss rate, which a real search would not know.');
      fPr.setNote('Chance that a phone is heard three times in ' + P.mins + ' minutes: 24 simulated searches each.'); fRs.setTitle('One metre of rubble costs as much signal as stepping back from 1 to ' + (10 ** (P.att / 20)).toFixed(P.att < 20 ? 1 : 0) + ' m in open air'); fRs.setNote('Dashed: the assumed loss for 0.5, 2 and 4 m of cover.'); fRs.redraw(); }
    const re = L.soon(() => { build(); estimate(t); fMap.redraw(); trials(); });
    readout.append(L.h('h4', null, 'Measured against the simulated truth'), sN.el, sM.el, sE.el, sW.el);
    controls.append(
      L.slider({ label: 'Phones passing over the pile', min: 1, max: 32, step: 1, value: P.n, onInput: (v) => { P.n = v; re(); } }).el,
      L.slider({ label: 'Rubble loss (assumed)', min: 2, max: 40, step: 1, value: P.att, unit: 'dB/m', onInput: (v) => { P.att = v; re(); } }).el,
      L.row(L.button({ label: 'Start over', icon: 'reset', onClick: () => { t = 0; P.seed++; build(); est = []; D.post = null; estimate(0); } })));
    build(); t = 30; estimate(t); trials();
    const loop = L.loop((dt) => { if (t < D.secs) { t = Math.min(D.secs, t + dt * 20); if (t - estAt > 30 || t === D.secs) estimate(t); } fMap.redraw(); });
    return { start() { if (L.reduced()) { t = D.secs; estimate(t); } loop.start(); }, stop() { loop.stop(); } };
  },
};
