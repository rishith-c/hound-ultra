// Exhibit 1. Muon tomography: count cosmic-ray muons that make it through the pile, direction by direction.
// Forward model: sea-level muon spectrum (Shukla & Sankrith parametrisation) + continuous energy loss through the
// density model. Inverse: turn counts back into opacity per ray, subtract a solid pile, solve for missing density (SIRT).
import { WORLD, RHO_REF, rayIntegral, pilePath } from './model.js';
import * as L from './lib.js';

const I0 = 70.7, NEXP = 3.01, E0 = 4.29, EC = 0.5;   // vertical intensity m-2 s-1 sr-1, spectral index, GeV, GeV
const A_LOSS = 0.002;                                 // GeV lost per g/cm2 (minimum-ionising, assumed)
const DTH = 2 * Math.PI / 180, DPHI = 0.35;           // one angular bin: 2 degrees in the section, 20 degrees across it (assumed)
const BINS = 87, TH0 = -86;                           // -86 .. +86 degrees
const CR = 0.3, CNX = 80, CNZ = 35;                   // reconstruction cells
const surv = (X) => Math.pow((E0 + EC) / (E0 + EC + A_LOSS * X), NEXP - 1);       // share of muons that get through X g/cm2
const opac = (R) => (E0 + EC) * (Math.pow(R, -1 / (NEXP - 1)) - 1) / A_LOSS;      // the inverse
function pq(lam, u) { if (lam <= 0) return 0; let k = 0, p = Math.exp(-lam), s = p; while (u > s && k < 400) { k++; p *= lam / k; s += p; } return k; } // Poisson quantile

export default function create(env) {
  const { h } = env, ui = env.ui;
  const P = { hours: 2, area: 1, place: 'tunnel', npos: 5, spacing: 3.5, playing: false, playT: 0 };
  let pile, dets = [], recon = new Float32Array(CNX * CNZ), shown = new Float32Array(CNX * CNZ), truthC, active, refField, M = {}, img = null, parts = [], needSolve = true;

  function layout() {
    const zt = pile.tunnelZ + 0.12;
    dets = P.place === 'tunnel' ? Array.from({ length: P.npos }, (_, k) => ({ x: L.clamp(12 + (k - (P.npos - 1) / 2) * P.spacing, 0.8, 23.2), z: zt, tilt: 0 })) : [{ x: 0.55, z: 0.75, tilt: 1 }, { x: 23.45, z: 0.75, tilt: -1 }];
  }
  function trace() { // everything about the geometry that does not depend on exposure
    const { nx, nz, res, x0, z0, x1, z1 } = WORLD, w = Math.sqrt(P.area);
    for (const d of dets) {
      d.bins = [];
      for (let b = 0; b < BINS; b++) {
        const th = (TH0 + b * 2) * Math.PI / 180, sx = Math.sin(th), cz = Math.cos(th);
        const end = (ox, oz, a) => { const s2 = Math.sin(a), c2 = Math.cos(a); let t = (z1 - oz) / c2; if (s2 > 1e-6) t = Math.min(t, (x1 - ox) / s2); else if (s2 < -1e-6) t = Math.min(t, (x0 - ox) / s2); return [ox + s2 * t, oz + c2 * t, t]; };
        // what really happens: average over the detector face and the width of the bin
        let f = 0, n = 0;
        for (const da of [-0.6, 0, 0.6]) for (const dp of [-0.33, 0, 0.33]) { const ox = d.x + (d.tilt ? 0 : dp * w), oz = d.z + (d.tilt ? dp * w : 0), e = end(ox, oz, th + da * DTH / 2); f += surv(rayIntegral(pile.rho, ox, oz, e[0], e[1]) * 100); n++; }
        const e = end(d.x, d.z, th), Xref = rayIntegral(refField, d.x, d.z, e[0], e[1]) * 100;
        const proj = d.tilt ? Math.max(0, d.tilt * sx) : cz;
        const open = I0 * Math.pow(cz, NEXP - 1) * proj * DTH * DPHI;       // muons per second per m2 of detector, no pile
        // the row of the tomography matrix, and how much of each void this ray crosses
        const row = new Map(), inVoid = [0, 0, 0, 0, 0], voidId = pile.voidId;
        const steps = Math.ceil(e[2] / 0.05), ds = e[2] / steps;
        for (let s = 0; s < steps; s++) { const u = (s + 0.5) * ds, x = d.x + sx * u, z = d.z + cz * u, ci = Math.floor((x - x0) / CR), ck = Math.floor((z - z0) / CR); if (ci < 0 || ck < 0 || ci >= CNX || ck >= CNZ) continue; const q = ck * CNX + ci; if (active[q]) row.set(q, (row.get(q) || 0) + ds);
          const fi = Math.floor((x - x0) / res), fk = Math.floor((z - z0) / res); if (fi >= 0 && fk >= 0 && fi < nx && fk < nz) inVoid[voidId[fk * nx + fi]] += ds; }
        const Xtrue = opac(f / n);
        d.bins.push({ th, deg: TH0 + b * 2, f: f / n, Xref, Xtrue, open, idx: Int32Array.from(row.keys()), len: Float32Array.from(row.values()), sum: [...row.values()].reduce((a, v) => a + v, 0), inVoid, e, u: d.rnd(), zn: d.rnd.gauss() });
      }
    }
    // how long until each void can be told from solid rubble at 3 sigma, using every bin that crosses it (the best any analysis can do)
    M.rate = {}; pile.voids.forEach((v, vi) => { let s = 0; for (const d of dets) for (const b of d.bins) { const Lv = b.inVoid[vi + 1]; if (Lv < 0.05) continue; const filled = surv(b.Xtrue + Lv * 170), c = b.f / filled - 1; s += b.open * filled * P.area * c * c; } M.rate[v.id] = s; });
  }
  function expose() {
    const T = P.hours * 3600; let total = 0;
    for (const d of dets) { d.count = 0; d.perHour = 0;
      for (const b of d.bins) {
        const lam = b.open * b.f * P.area * T; b.N = lam > 30 ? Math.max(0, Math.round(lam + Math.sqrt(lam) * b.zn)) : pq(lam, b.u);
        const expd = b.open * surv(b.Xref) * P.area * T; b.exp = expd; b.ratio = expd > 0 ? b.N / expd : 0; b.err = expd > 0 ? Math.sqrt(Math.max(b.N, 1)) / expd : 0; b.z = expd > 0 ? (b.N - expd) / Math.sqrt(Math.max(expd, 1)) : 0;
        d.count += b.N; d.perHour += b.open * b.f * P.area * 3600;
        const R = b.N / (b.open * P.area * T || 1);
        if (b.N > 0 && b.sum > 0.2) { const X = opac(Math.min(R, 1)); b.d = (b.Xref - X) / 100; const sig = (E0 + EC) / (A_LOSS * (NEXP - 1)) * Math.pow(Math.min(R, 1), -1 / (NEXP - 1)) / Math.sqrt(b.N) / 100; b.w = 1 / (1 + (sig / 0.45) ** 2); } else { b.d = 0; b.w = 0; }
      }
      total += d.count;
    }
    M.total = total; solve();
  }
  function solve() {
    needSolve = false; recon.fill(0);
    const upd = new Float32Array(CNX * CNZ), cw = new Float32Array(CNX * CNZ);
    for (let it = 0; it < 60; it++) {
      upd.fill(0); cw.fill(0);
      for (const d of dets) for (const b of d.bins) { if (!b.w) continue; let p = 0; for (let k = 0; k < b.idx.length; k++) p += b.len[k] * recon[b.idx[k]]; const r = (b.d - p) / b.sum * b.w; for (let k = 0; k < b.idx.length; k++) { upd[b.idx[k]] += b.len[k] * r; cw[b.idx[k]] += b.len[k] * b.w; } }
      for (let q = 0; q < recon.length; q++) if (cw[q] > 1e-4) recon[q] = L.clamp(recon[q] + 0.9 * upd[q] / cw[q], -0.7, RHO_REF);
    }
    // a cell that only one detector looks through cannot be placed along that line: fade it
    const cov = new Uint8Array(CNX * CNZ), seen = new Int8Array(CNX * CNZ).fill(-1); dets.forEach((d, di) => { for (const b of d.bins) if (b.w > 0.05) for (let k = 0; k < b.idx.length; k++) { const q = b.idx[k]; if (seen[q] !== di) { seen[q] = di; cov[q]++; } } });
    for (let q = 0; q < recon.length; q++) shown[q] = recon[q] * (cov[q] >= 3 ? 1 : cov[q] === 2 ? 0.6 : cov[q] ? 0.25 : 0);
    // score against truth
    let se = 0, n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let q = 0; q < recon.length; q++) if (active[q]) { const a = recon[q], b = truthC[q]; se += (a - b) ** 2; n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; }
    M.rms = Math.sqrt(se / n); M.corr = (sab - sa * sb / n) / Math.sqrt(Math.max(1e-9, (saa - sa * sa / n) * (sbb - sb * sb / n)));
    img = L.gridImage(img, shown, CNX, CNZ, 'scan', 0.1, 1.5, { mask: active });
  }
  function setPile(p) {
    pile = p; const { nx, nz, res, x0, z0 } = WORLD;
    refField = new Float32Array(nx * nz);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const x = x0 + (i + 0.5) * res, z = z0 + (k + 0.5) * res, q = k * nx + i; refField[q] = z < 0 ? 1.8 : z < pile.surf[i] ? RHO_REF : 0; }
    active = new Uint8Array(CNX * CNZ); truthC = new Float32Array(CNX * CNZ);
    for (let k = 0; k < CNZ; k++) for (let i = 0; i < CNX; i++) { const x = x0 + (i + 0.5) * CR, z = z0 + (k + 0.5) * CR, q = k * CNX + i; active[q] = (z > pile.tunnelZ + 0.3 && z < pile.surfAt(x) + 0.1 && x > pile.extent[0] - 1 && x < pile.extent[1] + 1) ? 1 : 0; let s = 0; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { const c = pile.cellAt(x + (a - 1) * 0.1, z + (b - 1) * 0.1); s += refField[c] - pile.rho[c]; } truthC[q] = s / 9; }
    rebuild();
  }
  function rebuild() { layout(); dets.forEach((d, i) => { d.rnd = L.rng(pile.seed * 131 + i * 17 + (P.place === 'tunnel' ? 0 : 99)); }); trace(); expose(); parts = []; }

  // ---- controls ----
  const LOG0 = Math.log(1 / 60), LOG1 = Math.log(96);
  const toH = (v) => Math.exp(LOG0 + (LOG1 - LOG0) * v / 1000), toV = (hh) => (Math.log(hh) - LOG0) / (LOG1 - LOG0) * 1000;
  let els = null;
  function controls() {
    const time = ui.slider({ label: 'Exposure time', min: 0, max: 1000, value: toV(P.hours), fmt: (v) => L.fmtDur(toH(v)), hint: 'Counting is the whole method. Slide from one minute to four days.', oninput: (v) => { P.hours = toH(v); P.playing = false; expose(); env.refresh(); } });
    const play = ui.button({ label: 'Run the exposure', ico: 'play', primary: true, title: 'Start counting from zero and watch the image form', onclick: () => { P.playing = true; P.playT = 0; P.hours = 1 / 60; } });
    const area = ui.seg({ label: 'Detector size', value: P.area, options: [{ v: 0.25, l: '0.25 m²' }, { v: 1, l: '1 m²' }, { v: 4, l: '4 m²' }], hint: 'Counts scale with area. A 1 m² tracking detector is a two-person lift.', onchange: (v) => { P.area = v; rebuild(); env.refresh(); } });
    const place = ui.seg({ label: 'Where the detectors sit', value: P.place, options: [{ v: 'tunnel', l: 'In a tunnel below' }, { v: 'side', l: 'Beside it, at street level' }], hint: 'Muons come from above. A detector has to be under what it images, or settle for the few that arrive nearly sideways.', onchange: (v) => { P.place = v; spacing.hidden = v !== 'tunnel'; rebuild(); env.refresh(); } });
    const spacing = h('div.ds-controls', null, ui.seg({ label: 'Detector positions in the tunnel', value: P.npos, options: [3, 5, 7].map((v) => ({ v, l: String(v) })), hint: 'More viewpoints, fewer streaks. One detector can be moved from place to place; the exposure is per position.', onchange: (v) => { P.npos = v; rebuild(); env.refresh(); } }),
      ui.slider({ label: 'Spacing', min: 1.5, max: 6, step: 0.5, value: P.spacing, fmt: (v) => v.toFixed(1) + ' m', oninput: (v) => { P.spacing = v; rebuild(); env.refresh(); } }));
    els = { time };
    return h('div.ds-controls', null, time, h('div.ds-row', null, play), area, place, spacing);
  }

  // ---- drawing ----
  function spawn() {
    const { x0, x1, z1 } = WORLD, r = Math.random;
    let th; do { th = (r() - 0.5) * 2.6; } while (r() > Math.cos(th) ** 2);
    const x = x0 + r() * (x1 - x0), sx = Math.sin(th), cz = -Math.cos(th);
    const E = (E0 + EC) * Math.pow(Math.max(1e-6, r()), -1 / (NEXP - 1)) - E0, range = (E - 0) / A_LOSS; // g/cm2 it can cross
    let X = 0, t = 0, stop = false; const { nx, nz, res, z0 } = WORLD;
    for (; t < 14; t += 0.1) { const px = x + sx * t, pz = z1 + cz * t; if (pz < z0 || px < x0 || px > x1) break; X += pile.rho[pile.cellAt(px, pz)] * 10; if (X > range) { stop = true; break; } }
    parts.push({ x, sx, cz, len: t, stop, u: 0 });
  }
  function drawStage(S) {
    if (needSolve) solve();
    const { c } = S;
    if (img) { c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.globalAlpha = S.truth ? 0.8 : 0.95; c.drawImage(img, S.X(WORLD.x0), S.Z(WORLD.z0 + CNZ * CR), CNX * CR * S.s, CNZ * CR * S.s); c.restore(); }
    // service tunnel
    if (P.place === 'tunnel') { const y0 = S.Z(pile.tunnelZ + 0.42), y1 = S.Z(pile.tunnelZ - 0.2); c.fillStyle = L.col('--bg-0', 0.85); c.fillRect(S.X(WORLD.x0), y0, 24 * S.s, y1 - y0); c.setLineDash([5, 4]); c.strokeStyle = L.col('--sim', 0.6); c.lineWidth = 1; c.strokeRect(S.X(WORLD.x0) + 0.5, y0 + 0.5, 24 * S.s, y1 - y0); c.setLineDash([]);
      if (!S.thumb) { c.font = L.font(11); c.fillStyle = L.tok('--sim'); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('service tunnel under the site (assumed)', S.X(WORLD.x0) + 8, (y0 + y1) / 2); } }
    // rays that carry a significant excess
    c.save(); c.lineWidth = 1;
    for (const d of dets) for (const b of d.bins) { if (!(b.z > 4) || b.Xref < 60) continue; c.strokeStyle = L.col('--accent', L.clamp((b.z - 3) / 60, 0.04, 0.22)); c.beginPath(); c.moveTo(S.X(d.x), S.Z(d.z)); c.lineTo(S.X(b.e[0]), S.Z(b.e[1])); c.stroke(); }
    c.restore();
    // muons in flight (a sample)
    if (!S.thumb) { c.save(); c.lineCap = 'round';
      for (const p of parts) { const t1 = p.u * p.len, t0 = Math.max(0, t1 - 1.3), a = p.stop && p.u > 0.85 ? (1 - p.u) / 0.15 : 1;
        const g = c.createLinearGradient(S.X(p.x + p.sx * t0), S.Z(WORLD.z1 + p.cz * t0), S.X(p.x + p.sx * t1), S.Z(WORLD.z1 + p.cz * t1)); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(235,244,255,' + (0.55 * a) + ')');
        c.strokeStyle = g; c.lineWidth = 1; c.beginPath(); c.moveTo(S.X(p.x + p.sx * t0), S.Z(WORLD.z1 + p.cz * t0)); c.lineTo(S.X(p.x + p.sx * t1), S.Z(WORLD.z1 + p.cz * t1)); c.stroke();
        if (p.stop && p.u > 0.9) { c.fillStyle = L.col('--text-3', (1 - p.u) * 8); c.fillRect(S.X(p.x + p.sx * p.len) - 1, S.Z(WORLD.z1 + p.cz * p.len) - 1, 2, 2); } }
      c.restore(); }
    // detectors
    const w = Math.sqrt(P.area);
    dets.forEach((d, i) => { const x = S.X(d.x), y = S.Z(d.z); c.save(); c.translate(x, y); if (d.tilt) c.rotate(Math.PI / 2);
      for (let k = 0; k < 3; k++) { c.fillStyle = L.col('--accent', 0.9 - k * 0.22); c.fillRect(-w * S.s / 2, k * 3, w * S.s, 1.5); }
      c.restore();
      if (!S.thumb) L.tagLabel(c, x, y + (d.tilt ? 0 : 6), 'D' + (i + 1) + '  ' + L.fmtInt(d.count), d.tilt ? { dx: d.tilt > 0 ? 10 : -10, dy: -40, align: d.tilt > 0 ? 'left' : 'right', color: '--accent' } : { dx: 12, dy: 24, color: '--accent' }); });
  }
  function drawReadout(R) {
    const show = dets.length > 3 ? [0, (dets.length - 1) / 2, dets.length - 1] : dets.map((_, i) => i);
    const { c, w, h: hh } = R, n = show.length, gap = 30, padL = 44, padR = 14, top = 22, ph = (hh - top - 36 - gap * (n - 1)) / n;
    show.forEach((di, i) => { const d = dets[di];
      const box = { l: padL, t: top + i * (ph + gap), w: w - padL - padR, h: ph };
      const use = d.bins.filter((b) => b.Xref > 60 && b.exp > 0); let lo = 0.7, hi = 1.5; for (const b of use) { if (b.exp > 8) { hi = Math.max(hi, Math.min(3, b.ratio + b.err)); lo = Math.min(lo, Math.max(0, b.ratio - b.err)); } }
      const ax = L.plot(c, box, { x: [-88, 88], y: [lo, hi], xl: i === n - 1 ? 'direction the muon came from (degrees from straight up; negative = from the left)' : '', yt: 3, xt: 9, xfmt: (v) => v + '°' });
      // truth bands: directions that cross a void
      if (R.truth) pile.voids.forEach((v, vi) => { let a = null, bb = null; for (const b of d.bins) if (b.inVoid[vi + 1] > 0.25) { if (a == null) a = b.deg; bb = b.deg; } if (a == null) return; c.fillStyle = L.col('--text', 0.05); c.fillRect(ax.X(a - 1), box.t + 1, ax.X(bb + 1) - ax.X(a - 1), box.h - 2); c.fillStyle = L.tok('--text-3'); c.font = L.font(11, 600); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(v.id, (ax.X(a) + ax.X(bb)) / 2, box.t + box.h - 3); });
      c.strokeStyle = L.col('--text-3', 0.9); c.setLineDash([3, 3]); c.beginPath(); c.moveTo(box.l, ax.Y(1)); c.lineTo(box.l + box.w, ax.Y(1)); c.stroke(); c.setLineDash([]);
      c.save(); c.beginPath(); c.rect(box.l, box.t, box.w, box.h); c.clip();
      c.beginPath(); c.moveTo(ax.X(use[0]?.deg ?? 0), ax.Y(1)); for (const b of use) c.lineTo(ax.X(b.deg), ax.Y(Math.max(1, b.ratio))); c.lineTo(ax.X(use[use.length - 1]?.deg ?? 0), ax.Y(1)); c.closePath();
      const gr = c.createLinearGradient(0, ax.Y(hi), 0, ax.Y(1)); gr.addColorStop(0, L.col('--accent', 0.5)); gr.addColorStop(1, L.col('--accent', 0.04)); c.fillStyle = gr; c.fill();
      for (const b of use) { const x = ax.X(b.deg), y = ax.Y(b.ratio), sig = b.z > 3, colr = sig ? '--accent' : '--text-3';
        c.strokeStyle = L.col(colr, sig ? 0.9 : 0.55); c.lineWidth = 1; c.beginPath(); c.moveTo(x, ax.Y(b.ratio - b.err)); c.lineTo(x, ax.Y(b.ratio + b.err)); c.stroke();
        c.fillStyle = L.tok(sig ? '--accent' : '--text-2'); c.fillRect(x - 1.5, y - 1.5, 3, 3); }
      c.restore();
      c.font = L.font(11, 600); c.fillStyle = L.tok('--text'); c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText('Detector D' + (di + 1), box.l, box.t - 5);
      c.font = L.font(11); c.fillStyle = L.tok('--text-3'); c.fillText('counts ÷ counts expected for a solid pile', box.l + 78, box.t - 5); c.font = L.mono(11); c.textAlign = 'right'; c.fillText(L.fmtInt(d.perHour) + ' muons an hour', box.l + box.w, box.t - 5);
    });
  }
  function tick(dt) {
    if (P.playing) { P.playT += dt; P.hours = toH(Math.min(1000, P.playT / 9 * 1000)); if (env.reduced()) { P.hours = 96; P.playT = 9; } if (P.playT >= 9) P.playing = false; els?.time.set(toV(P.hours)); expose(); env.refresh(); }
    if (env.reduced()) { parts = []; return P.playing; }
    for (let k = 0; k < 2; k++) if (parts.length < 70) spawn();
    for (const p of parts) p.u += dt * 9 / Math.max(2, p.len);
    parts = parts.filter((p) => p.u < 1);
    return true;
  }
  function verdicts() {
    const T = P.hours * 3600, out = {};
    for (const v of pile.voids) { const snr = Math.sqrt(M.rate[v.id] * T), t3 = M.rate[v.id] > 0 ? 9 / M.rate[v.id] / 3600 : Infinity;
      out[v.id] = { state: snr >= 3 ? 'seen' : snr >= 1.5 ? 'hint' : 'missed', snr, t3, text: isFinite(t3) && t3 < 5000 ? '3σ after ' + L.fmtDur(t3) : 'no muon path', why: 'Expected signal-to-noise now: ' + snr.toFixed(1) + 'σ, using every direction that crosses this void (the best any analysis could do).' }; }
    out.person = { state: 'na', text: 'too little mass', why: 'A body is about 20 cm of water on a path through metres of rubble: a change of under 1 % in the count.' };
    return out;
  }
  return {
    title: 'Muon tomography', hardware: 'Portable muon tracking detectors exist in research labs; none is built for rescue.',
    lede: 'Cosmic rays make muons high in the air, and about one passes through every square centimetre of ground each minute. They cross metres of concrete, but dense material stops more of them, so counting how many arrive from each direction weighs whatever lies along that line.',
    honest: 'a detector has to sit lower than what it images, so someone must find a cellar, sewer or borehole first. This section treats the pile as the same all the way back; a real 3-D image spreads the same muons over about ten times more bins, so multiply every time by ten. Scattering in the rubble and detector background are not modelled.',
    assumed: 'Assumed: 2° angular bins, 20° acceptance across the section, 0.5 GeV detector threshold, 2 MeV lost per g/cm², the pile uniform along the unseen axis. The solid-pile reference uses the outer surface, as a drone scan would give it, at 1.8 g/cm³.',
    sources: [
      { who: 'Morishima et al., Nature 552 (2017).', what: 'ScanPyramids: muons reveal a 30 m void above the Grand Gallery of Khufu’s pyramid.', url: 'https://doi.org/10.1038/nature24647' },
      { who: 'Shukla and Sankrith (2018).', what: 'The sea-level muon energy and angle formula used for the flux here.', url: 'https://arxiv.org/abs/1606.06907' },
    ],
    setPile, controls, drawStage, drawReadout, tick, verdicts,
    stageTitle: () => 'Missing density, rebuilt from muon counts', stageNote: () => L.fmtDur(P.hours) + ' of counting · ' + L.fmtInt(M.total) + ' muons',
    readoutTitle: () => ['More muons arrive from the directions that cross a void', 'Each dot is one 2° bin with its counting error. Blue: more than 3σ above a solid pile.'],
    results: () => [
      { k: 'Muons counted', v: L.fmtInt(M.total), sub: L.fmtDur(P.hours) + ' at each of ' + dets.length + ' positions, ' + P.area + ' m²' },
      { k: 'Count rate', v: L.fmtInt(dets.reduce((a, d) => a + d.perHour, 0)) + ' / h', sub: 'all positions, through the pile' },
      { k: 'Image error', v: M.rms.toFixed(2) + ' g/cm³', sub: 'RMS against the true density deficit' },
      { k: 'Match to truth', v: 'r = ' + M.corr.toFixed(2), sub: 'correlation, 1 would be perfect', tone: M.corr > 0.5 ? 'ok' : M.corr > 0.25 ? 'warn' : 'bad' },
    ],
    row: { sees: 'Density. Any void with enough missing matter, and anything heavy.', range: 'Metres to hundreds of metres of rock', time: 'Hours here; months for a pyramid', cost: 'High', costNote: 'research instrument', ready: 2, readyNote: 'Fielded in archaeology, volcanoes and reactors. Never in a rescue.' },
    summary: () => { const V = verdicts(); return pile.voids.filter((v) => V[v.id].state === 'seen').length + ' of 4 voids clear after ' + L.fmtDur(P.hours); },
  };
}
