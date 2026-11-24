// Exhibit 3. Ground-penetrating radar: drag an antenna over the pile, record the echoes, then focus them.
// Forward model: single scattering off every change of permittivity, straight rays through the true (uneven)
// velocity and loss. Inverse: Kirchhoff migration (diffraction summation) at one assumed velocity.
import { WORLD, MAT, PROPS } from './model.js';
import * as L from './lib.js';

const C0 = 0.2998, DT = 0.25, NT = 480;            // m/ns, ns, samples (120 ns of listening)
const ALPHA = { dry: 0.32, damp: 0.85, wet: 1.7 };  // one-way amplitude loss in rubble, nepers per metre (assumed)
const TAGS = 7;                                     // 0 structure, 1-4 voids A-D, 5 person, 6 small clutter
const SIGMA_N = 0.0022;

export default function create(env) {
  const { h } = env, ui = env.ui;
  const P = { v: 0.1, ap: 0, apMax: 3.2, wet: 'dry', fc: 0.4, focusing: false, auto: true };
  let pile, ant = [], sc = [], tt, ll, geo, acq = 0, D = [], total, noiseTr, mask, maskList, mig, tmp, bscan = null, migCv = null, M = { snr: {}, err: {} }, focus = [], best = 0.13, nIdx, lossW, dirtyImg = true;

  function setPile(p) {
    pile = p; const { nx, nz, res, x0, z0 } = WORLD;
    nIdx = new Float32Array(nx * nz); lossW = new Float32Array(nx * nz);
    for (let q = 0; q < nx * nz; q++) { nIdx[q] = Math.sqrt(PROPS[pile.mat[q]].eps); lossW[q] = PROPS[pile.mat[q]].loss; }
    ant = []; for (let x = pile.extent[0] + 0.5; x <= pile.extent[1] - 0.5; x += 0.2) ant.push({ x, z: pile.surfAt(x) + 0.04 });
    // every place the material changes is a reflector
    sc = []; const r = L.rng(pile.seed * 4127 + 5);
    for (let k = 2; k < nz - 2; k++) for (let i = 2; i < nx - 2; i++) {
      const q = k * nx + i, m = pile.mat[q]; if (m === MAT.SKY) continue; const z = z0 + (k + 0.5) * res; if (z > pile.surf[i] - 0.2) continue;
      const up = nIdx[q + nx], dn = nIdx[q - nx], lf = nIdx[q - 1], rt = nIdx[q + 1], rz = (up - dn) / (up + dn), rx = (rt - lf) / (rt + lf), mag = Math.hypot(rz, rx); if (mag < 0.03) continue;
      let tag = 0; for (const o of [0, 1, -1, nx, -nx]) { const mm = pile.mat[q + o]; if (mm === MAT.PERSON) { tag = 5; break; } if (mm === MAT.VOID) tag = pile.voidId[q + o]; }
      sc.push({ x: x0 + (i + 0.5) * res, z, r: (Math.abs(rz) > Math.abs(rx) ? Math.sign(rz) : Math.sign(rx)) * mag * 0.5, tag });
    }
    for (let n = 0; n < 900; n++) { const x = r.range(pile.extent[0], pile.extent[1]), z = r.range(0, 5); if (z > pile.surfAt(x) - 0.25 || pile.matAt(x, z) !== MAT.RUBBLE) continue; sc.push({ x, z, r: r.gauss() * 0.022, tag: 6 }); }
    tt = new Float32Array(ant.length * sc.length); ll = new Float32Array(ant.length * sc.length); geo = new Float32Array(ant.length * sc.length);
    mask = new Uint8Array(nx * nz); maskList = [];
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const x = x0 + (i + 0.5) * res, z = z0 + (k + 0.5) * res; if (x > ant[0].x - 0.3 && x < ant[ant.length - 1].x + 0.3 && z < pile.surf[i] - 0.05 && z > -2.9) { mask[k * nx + i] = 1; maskList.push(k * nx + i); } }
    mig = new Float32Array(nx * nz); tmp = new Float32Array(nx * nz);
    D = Array.from({ length: TAGS }, () => new Float32Array(ant.length * NT)); total = new Float32Array(ant.length * NT); noiseTr = new Float32Array(ant.length * NT);
    const rn = L.rng(pile.seed * 811 + 3); for (let i = 0; i < noiseTr.length; i++) noiseTr[i] = rn.gauss() * SIGMA_N;
    acq = 0; P.ap = 0; P.focusing = false; P.auto = true; focus = []; dirtyImg = true;
  }
  // two-way time, loss path and spreading from one antenna position to every reflector (straight rays, true materials)
  function shoot(a) {
    const { nx, nz, res, x0, z0 } = WORLD, A = ant[a], o = a * sc.length;
    for (let s = 0; s < sc.length; s++) {
      const p = sc[s], dx = p.x - A.x, dz = p.z - A.z, Lr = Math.hypot(dx, dz), n = Math.max(2, Math.ceil(Lr / 0.07)), ds = Lr / n; let sn = 0, sl = 0;
      for (let i = 0; i < n; i++) { const u = (i + 0.5) / n, ci = Math.floor((A.x + dx * u - x0) / res), ck = Math.floor((A.z + dz * u - z0) / res), q = ck * nx + ci; sn += nIdx[q]; sl += lossW[q]; }
      tt[o + s] = 2 * sn * ds / C0; ll[o + s] = sl * ds; geo[o + s] = Math.max(0, -dz / Lr) / (Lr + 0.3);
    }
  }
  function synth(a0 = 0, a1 = ant.length) {
    const al = ALPHA[P.wet], fc = P.fc, half = Math.ceil(1.3 / fc / DT), pf2 = (Math.PI * fc) ** 2;
    for (let a = a0; a < a1; a++) {
      for (let g = 0; g < TAGS; g++) D[g].fill(0, a * NT, (a + 1) * NT);
      const o = a * sc.length;
      for (let s = 0; s < sc.length; s++) { const amp = sc[s].r * geo[o + s] * Math.exp(-2 * al * ll[o + s]); if (Math.abs(amp) < 2e-5) continue; const t = tt[o + s], c0 = Math.round(t / DT), tr = D[sc[s].tag], base = a * NT;
        for (let k = Math.max(0, c0 - half); k <= Math.min(NT - 1, c0 + half); k++) { const tau = k * DT - t, u = pf2 * tau * tau; tr[base + k] += amp * (1 - 2 * u) * Math.exp(-u); } }
      for (let k = 0; k < NT; k++) { let v = noiseTr[a * NT + k]; for (let g = 0; g < TAGS; g++) v += D[g][a * NT + k]; total[a * NT + k] = v; }
    }
    dirtyImg = true;
  }
  // Kirchhoff migration: every image point collects the samples that lie on its own diffraction hyperbola
  function migrate(data, v, ap, out, nA = ant.length) {
    const { nx, res, x0, z0 } = WORLD, k2 = 2 / (v * DT);
    for (let n = 0; n < maskList.length; n++) {
      const q = maskList[n], i = q % nx, k = (q - i) / nx, x = x0 + (i + 0.5) * res, z = z0 + (k + 0.5) * res;
      const a0 = Math.max(0, Math.ceil((x - ap - ant[0].x) / 0.2)), a1 = Math.min(nA - 1, Math.floor((x + ap - ant[0].x) / 0.2)); let s = 0, cnt = 0;
      if (a1 < a0) { const an = Math.round((x - ant[0].x) / 0.2); if (an >= 0 && an < nA) { const A = ant[an], f = Math.max(0, A.z - z) * k2, j = Math.floor(f); if (j < NT - 1) s = data[an * NT + j] * (1 - f + j) + data[an * NT + j + 1] * (f - j); } out[q] = s; continue; }
      for (let a = a0; a <= a1; a++) { const A = ant[a], dz = A.z - z; if (dz <= 0) continue; const R = Math.hypot(x - A.x, dz), f = R * k2, j = Math.floor(f); if (j >= NT - 1) continue; s += (data[a * NT + j] * (1 - f + j) + data[a * NT + j + 1] * (f - j)) * (dz / R); cnt++; }
      out[q] = cnt ? s / Math.sqrt(cnt) : 0;
    }
  }
  function analyse() { // per-target visibility after focusing, and the focus curve
    const { nx, res, x0, z0 } = WORLD;
    const nz2 = new Float32Array(ant.length * NT); for (let i = 0; i < nz2.length; i++) nz2[i] = noiseTr[i] + D[6][i];
    migrate(nz2, P.v, P.apMax, tmp); let s2 = 0; for (const q of maskList) s2 += tmp[q] * tmp[q]; const sn = Math.sqrt(s2 / maskList.length);
    const one = (g, poly) => { migrate(D[g], P.v, P.apMax, tmp); let pk = 0, pq = 0; for (const q of maskList) if (Math.abs(tmp[q]) > pk) { pk = Math.abs(tmp[q]); pq = q; }
      const i = pq % nx, k = (pq - i) / nx, x = x0 + (i + 0.5) * res, z = z0 + (k + 0.5) * res; let dmin = 1e9;
      for (let e = 0, j = poly.length - 1; e < poly.length; j = e++) { const a = poly[j], b = poly[e], vx = b[0] - a[0], vz = b[1] - a[1], u = L.clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz), 0, 1); dmin = Math.min(dmin, Math.hypot(x - a[0] - vx * u, z - a[1] - vz * u)); }
      return { snr: pk / sn, err: dmin, at: [x, z] }; };
    pile.voids.forEach((v, vi) => { M[v.id] = one(vi + 1, v.poly); });
    const pp = pile.person; M.person = one(5, [[pp.span[0], 0.02], [pp.span[1], 0.02], [pp.span[1], 0.3], [pp.span[0], 0.3]]);
    focus = []; let bestS = 0;
    for (let v = 0.08; v <= 0.2001; v += 0.004) { const sh = slabEcho(v); focus.push([v, sh]); if (sh > bestS) { bestS = sh; best = v; } }
  }
  // The one reflector whose depth is known before digging is the floor slab at street level. Line up every trace on the
  // delay that slab would have at speed v, and measure how well they agree. No buried truth is used.
  function slabEcho(v) {
    const at = (a, t) => { const f = t / DT, j = Math.floor(f); return j < 0 || j >= NT - 1 ? 0 : total[a * NT + j] * (1 - f + j) + total[a * NT + j + 1] * (f - j); }; let top = 0;
    for (let dt = -1.5; dt <= 1.5; dt += 0.25) { let s = 0, e = 0, c = 0; for (let a = 0; a < ant.length; a++) { const d = ant[a].z; if (d < 0.8) continue; const t = 2 * d / v + dt; let nrm = 0; for (let k = -6; k <= 6; k++) nrm += at(a, t + k * 0.5) ** 2; const q = at(a, t) / Math.sqrt(nrm / 13 + 1e-9); s += q; e += q * q; c++; } top = Math.max(top, s * s / (c * e)); }
    return top;
  }
  function paint() {
    dirtyImg = false; const { nx, nz, res, z0 } = WORLD, nA = Math.max(1, acq);
    migrate(total, P.v, P.ap, mig, nA);
    // gain with depth (as every radargram is shown), then colour: white = positive, blue = negative
    if (!migCv) { migCv = document.createElement('canvas'); migCv.width = nx; migCv.height = nz; }
    const c = migCv.getContext('2d'), im = c.createImageData(nx, nz), px = im.data, acc = L.rgbOf('--accent');
    let clip = 0; const gained = tmp; for (const q of maskList) { const i = q % nx, k = (q - i) / nx, d = Math.max(0, pile.surf[i] - (z0 + (k + 0.5) * res)); gained[q] = mig[q] * Math.min(40, Math.exp(0.6 * d)) * (0.4 + d); }
    const samp = []; for (let n = 0; n < maskList.length; n += 7) samp.push(Math.abs(gained[maskList[n]])); samp.sort((a, b) => a - b); clip = samp[Math.floor(samp.length * 0.985)] || 1;
    for (const q of maskList) { const i = q % nx, k = (q - i) / nx, o = ((nz - 1 - k) * nx + i) * 4, v = gained[q] / clip, a = Math.min(1, Math.abs(v)); if (v > 0) { px[o] = 244; px[o + 1] = 248; px[o + 2] = 255; } else { px[o] = acc[0]; px[o + 1] = acc[1]; px[o + 2] = acc[2]; } px[o + 3] = 255 * Math.pow(a, 1.25) * 0.95; }
    c.putImageData(im, 0, 0);
    // the raw B-scan, gained with time
    const gb = new Float32Array(ant.length * NT); let m2 = []; for (let a = 0; a < nA; a++) for (let k = 0; k < NT; k++) { const g = Math.min(40, Math.exp(0.75 * k * DT * 0.065)) * (0.4 + k * DT * 0.065); gb[a * NT + k] = total[a * NT + k] * g; if ((a * NT + k) % 11 === 0) m2.push(Math.abs(gb[a * NT + k])); }
    m2.sort((a, b) => a - b); const cl = m2[Math.floor(m2.length * 0.985)] || 1; const view = new Float32Array(ant.length * NT); for (let a = 0; a < ant.length; a++) for (let k = 0; k < NT; k++) view[k * ant.length + a] = a < nA ? gb[a * NT + k] : 0;
    bscan = L.gridImage(bscan, view, ant.length, NT, 'bipolar', -cl, cl, { flip: false });
  }
  function controls() {
    const vel = ui.slider({ label: 'Assumed radar speed in the pile', min: 0.08, max: 0.2, step: 0.002, value: P.v, fmt: (v) => v.toFixed(3) + ' m/ns', hint: 'Migration needs one speed for the whole pile. Too slow and the curves stay frowns; too fast and they flip into smiles.', oninput: (v) => { P.v = v; P.auto = false; dirtyImg = true; analyse(); env.refresh(); } });
    const go = ui.button({ label: 'Collapse the hyperbolas', ico: 'play', primary: true, title: 'Widen the migration aperture from nothing to 3.2 m and watch each curve fold onto its source', onclick: () => { P.ap = 0; P.focusing = true; } });
    const af = ui.button({ label: 'Find the speed', ico: 'target', title: 'Line up the echo of the floor slab, whose depth below the surface is known', onclick: () => { P.v = best; vel.set(best); dirtyImg = true; analyse(); env.refresh(); } });
    const wet = ui.seg({ label: 'How wet is the rubble', value: P.wet, options: [{ v: 'dry', l: 'Dry' }, { v: 'damp', l: 'Damp' }, { v: 'wet', l: 'Soaked' }], hint: 'Water absorbs radar. After a flood, this is the control that matters.', onchange: (v) => { P.wet = v; synth(); analyse(); env.refresh(); } });
    const fc = ui.seg({ label: 'Antenna frequency', value: P.fc, options: [{ v: 0.2, l: '200 MHz' }, { v: 0.4, l: '400 MHz' }, { v: 0.9, l: '900 MHz' }], hint: 'Higher frequency draws finer detail and dies sooner.', onchange: (v) => { P.fc = v; synth(); analyse(); env.refresh(); } });
    env._gprVel = vel;
    return h('div.ds-controls', null, vel, h('div.ds-row', null, go, af), wet, fc);
  }
  function tick(dt) {
    if (acq < ant.length) { const n = env.reduced() ? ant.length : 5; for (let k = 0; k < n && acq < ant.length; k++) { shoot(acq); synth(acq, acq + 1); acq++; } dirtyImg = true;
      if (acq >= ant.length) { analyse(); if (P.auto) { P.v = best; env._gprVel?.set(best); analyse(); } P.focusing = true; P.ap = 0; env.refresh(); } return true; }
    if (P.focusing) { P.ap = env.reduced() ? P.apMax : Math.min(P.apMax, P.ap + dt * (0.25 + P.ap) * 0.9); if (P.ap >= P.apMax) { P.focusing = false; env.refresh(); } dirtyImg = true; return true; }
    return false;
  }
  function drawStage(S) {
    if (dirtyImg) paint();
    const { c } = S;
    c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.globalAlpha = S.truth ? 0.9 : 1; c.drawImage(migCv, S.X(WORLD.x0), S.Z(WORLD.z1), 24 * S.s, (WORLD.z1 - WORLD.z0) * S.s); c.restore();
    // antenna track and the antenna itself
    c.save(); c.strokeStyle = L.col('--accent', 0.9); c.lineWidth = S.thumb ? 1 : 1.5; c.beginPath(); const nA = Math.max(1, acq); for (let a = 0; a < nA; a++) { const x = S.X(ant[a].x), y = S.Z(ant[a].z) - 2; if (a) c.lineTo(x, y); else c.moveTo(x, y); } c.stroke();
    if (!S.thumb && acq < ant.length) { const A = ant[Math.min(ant.length - 1, acq)], x = S.X(A.x), y = S.Z(A.z); c.fillStyle = L.tok('--accent'); c.fillRect(x - 7, y - 9, 14, 6); for (let k = 1; k < 4; k++) { c.strokeStyle = L.col('--accent', 0.5 - k * 0.11); c.beginPath(); c.arc(x, y, k * 0.45 * S.s, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke(); } }
    c.restore();
  }
  function drawReadout(R) {
    if (dirtyImg) paint();
    const { c, w, h: hh } = R, X = R.SX, t = 12, b = hh - 28, l = X(ant[0].x - 0.1), r = X(ant[ant.length - 1].x + 0.1);
    c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    if (bscan) c.drawImage(bscan, l, t, r - l, b - t);
    c.strokeStyle = L.tok('--line-2'); c.lineWidth = 1; c.strokeRect(Math.round(l) + 0.5, t + 0.5, Math.round(r - l), b - t);
    c.font = L.font(11); c.textBaseline = 'middle'; c.textAlign = 'right';
    for (let ns = 0; ns <= 120; ns += 20) { const y = t + ns / 120 * (b - t); c.fillStyle = L.tok('--text-3'); c.fillText(ns + (ns === 0 ? ' ns' : ''), l - 6, Math.min(b - 5, Math.max(t + 5, y))); c.strokeStyle = L.tok('--line-2'); c.beginPath(); c.moveTo(l - 3, y); c.lineTo(l, y); c.stroke(); }
    c.textAlign = 'center'; c.textBaseline = 'top'; for (let xm = 2; xm <= 22; xm += 2) { const x = X(xm); if (x < l || x > r) continue; c.fillStyle = L.tok('--text-3'); c.fillText(xm + ' m', x, b + 6); }
    c.save(); c.translate(l - 34, (t + b) / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillStyle = L.tok('--text-3'); c.fillText('echo delay (there and back)', 0, 0); c.restore();
    // where theory says each hidden thing should draw its curve, at the assumed speed
    if (R.truth && acq >= ant.length) { c.save(); c.beginPath(); c.rect(l, t, r - l, b - t); c.clip(); c.setLineDash([4, 4]); c.lineWidth = 1;
      const curve = (px, pz, label, colr) => { c.strokeStyle = L.col(colr, 0.85); c.beginPath(); let st = false, ax = 0, ay = 1e9; for (const A of ant) { if (Math.abs(A.x - px) > 4.5) continue; const tw = 2 * Math.hypot(A.x - px, A.z - pz) / P.v, y = t + tw / 120 * (b - t), x = X(A.x); if (st) c.lineTo(x, y); else { c.moveTo(x, y); st = true; } if (y < ay) { ay = y; ax = x; } } c.stroke(); c.setLineDash([]); L.tagLabel(c, ax, ay, label, { dx: 12, dy: -12, color: colr }); c.setLineDash([4, 4]); };
      for (const v of pile.voids) { let top = v.poly[0]; for (const q of v.poly) if (q[1] > top[1]) top = q; curve(v.id === 'D' ? v.c[0] : top[0], top[1], 'roof of void ' + v.id, '--text-2'); }
      curve(pile.person.x, 0.25, 'the person', '--person'); c.restore(); }
    // focus curve inset
    if (focus.length) { const bw = 176, bh = 74, bx = r - bw - 10, by = t + 10; c.fillStyle = L.col('--bg-1', 0.9); c.fillRect(bx, by, bw, bh); c.strokeStyle = L.tok('--line-3'); c.strokeRect(bx + 0.5, by + 0.5, bw, bh);
      let mx = 0, mn = 1e9; for (const f of focus) { mx = Math.max(mx, f[1]); mn = Math.min(mn, f[1]); } const fx = (v) => bx + 10 + (v - 0.08) / 0.12 * (bw - 20), fy = (s) => by + bh - 20 - (s - mn) / (mx - mn || 1) * (bh - 40);
      c.beginPath(); focus.forEach((f, i) => { if (i) c.lineTo(fx(f[0]), fy(f[1])); else c.moveTo(fx(f[0]), fy(f[1])); }); c.strokeStyle = L.tok('--text-2'); c.lineWidth = 1.25; c.stroke();
      c.strokeStyle = L.tok('--accent'); c.beginPath(); c.moveTo(fx(P.v), by + 18); c.lineTo(fx(P.v), by + bh - 16); c.stroke();
      c.font = L.font(11, 600); c.fillStyle = L.tok('--text'); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('Floor-slab echo against speed', bx + 8, by + 5);
      c.font = L.font(10.5); c.fillStyle = L.tok('--text-3'); c.textBaseline = 'bottom'; c.fillText('0.08', bx + 8, by + bh - 3); c.textAlign = 'right'; c.fillText('0.20 m/ns', bx + bw - 8, by + bh - 3); c.textAlign = 'center'; c.fillStyle = L.tok('--accent'); c.fillText('best ' + best.toFixed(3), L.clamp(fx(best), bx + 50, bx + bw - 60), by + bh - 3); }
    if (acq < ant.length) { c.font = L.font(12, 500); c.fillStyle = L.tok('--text-2'); c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('Scanning: trace ' + acq + ' of ' + ant.length, l + 10, t + 8); }
    c.restore();
  }
  function verdicts() {
    const out = {};
    for (const id of ['A', 'B', 'C', 'D', 'person']) { const r = M[id]; if (!r) { out[id] = { state: 'na', text: 'scanning' }; continue; }
      out[id] = { state: r.snr >= 8 ? 'seen' : r.snr >= 4 ? 'hint' : 'missed', text: r.snr >= 4 ? 'echo ' + r.snr.toFixed(0) + '× noise' : 'lost in noise', why: 'Peak of this target’s focused echo against the focused noise and small-debris clutter. Above 8× it stands out; under 4× it cannot be told from speckle.' }; }
    if (out.person.state === 'seen') out.person.text = 'bright, ' + M.person.snr.toFixed(0) + '× noise';
    return out;
  }
  return {
    title: 'Ground radar, focused', hardware: 'Ground-penetrating radar is a commercial tool. A unit that scans a rubble surface on its own is not.',
    lede: 'A radar pulse sent into the pile bounces off every change of material, and a single buried edge draws a curve across the scan, a hyperbola, because the antenna hears it early when overhead and late from the side. Migration runs that geometry backwards: it adds up the samples along each possible curve, and the curves fold onto the things that made them.',
    honest: 'real rubble is full of reinforcing bar and broken edges, so a real scan carries far more clutter than this one, and wet concrete swallows the pulse within a metre or two. This model has single echoes only, straight rays, and an antenna that keeps contact with the surface.',
    assumed: 'Assumed: permittivity 5 for loose rubble, 7 for slab, 50 for a person; loss 0.3 to 1.7 nepers per metre by moisture; a Ricker pulse; receiver noise fixed. The scan is 0.2 m between traces, 120 ns long.',
    sources: [
      { who: 'Schneider, Geophysics 43 (1978).', what: 'Integral formulation for migration in two and three dimensions: the Kirchhoff summation used here.', url: 'https://doi.org/10.1190/1.1440828' },
      { who: 'Stolt, Geophysics 43 (1978).', what: 'Migration by Fourier transform, the fast frequency-domain form of the same idea.', url: 'https://doi.org/10.1190/1.1440826' },
    ],
    _demo: () => ({ P, ant, sc, total, M, mask, maskList, migrate, NT, DT, focus, best, analyse, get migCv() { return migCv; }, runAll() { if (acq >= ant.length) return; while (acq < ant.length) { shoot(acq); synth(acq, acq + 1); acq++; } analyse(); P.v = best; analyse(); P.ap = P.apMax; P.focusing = false; P.auto = true; dirtyImg = true; } }),
    setPile, controls, drawStage, drawReadout, tick, verdicts,
    stageTitle: () => (P.ap < 0.05 ? 'Raw echoes, drawn under the antenna' : 'Echoes focused by migration'), stageNote: () => acq < ant.length ? 'scanning the surface' : 'aperture ' + P.ap.toFixed(1) + ' m · speed ' + P.v.toFixed(3) + ' m/ns',
    readoutTitle: () => ['Every edge in the pile draws a hyperbola in the raw scan', 'B-scan: one column per antenna position, time running down. White and blue are the two polarities.'],
    results: () => { const found = ['A', 'B', 'C', 'D'].filter((id) => M[id]?.snr >= 8), err = found.length ? found.reduce((a, id) => a + M[id].err, 0) / found.length : NaN;
      return [
        { k: 'Assumed speed', v: P.v.toFixed(3) + ' m/ns', sub: 'truth: 0.134 in rubble, 0.113 in slab, 0.300 in a void' },
        { k: 'Floor-slab speed', v: best.toFixed(3) + ' m/ns', sub: 'slab depth known from street level' },
        { k: 'Placement error', v: isNaN(err) ? 'none found' : (err * 100).toFixed(0) + ' cm', sub: 'focused echo to the true edge, found voids', tone: err < 0.25 ? 'ok' : 'warn' },
        { k: 'Scan', v: ant.length + ' traces', sub: (ant.length * 0.2).toFixed(0) + ' m of surface, about ten minutes on foot' },
      ]; },
    row: { sees: 'Edges between materials: roofs of voids, slabs, metal, a water-rich body.', range: '1 to 4 m in dry rubble; under 1 m when soaked', time: 'Minutes', cost: 'Medium', costNote: 'commercial units', ready: 4, readyNote: 'Routine in surveying. On a collapse it needs a flat, dry path.' },
    summary: () => ['A', 'B', 'C', 'D'].filter((id) => M[id]?.snr >= 8).length + ' of 4 voids, ' + (M.person?.snr >= 8 ? 'and the person' : 'not the person') + ', ' + P.wet + ' rubble',
  };
}
