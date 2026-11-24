// Exhibit 05: event camera view. Concept hardware (HOUND has no event sensor); the event generation is a live algorithm.
// A synthetic night scene is rendered 1 000 times a simulated second. Two sensor models read the same radiance:
//   a frame camera (exposure integration, shot and read noise, a 60 dB well, 8-bit output) and
//   an event pixel array (log intensity, illumination-dependent bandwidth, contrast threshold, refractory period, noise events).
// Everything shown is computed here; sensor constants are assumed and listed in the side column.
const W = 256, H = 160, N = W * H;                 // sensor size, pixels
const WW = 440, WH = 250;                          // the world texture the drone sweeps over
const K_E = 6, FULL_WELL = 6000, READ_NOISE = 6;   // frame sensor: electrons per (lux x albedo x ms), well depth, read noise (assumed)
const FRAME_MS = 1000 / 30;                        // frame camera period
const L_DARK = 0.002, L_SAT = 2000;                // event pixel: dark floor and ceiling in lux x albedo (assumed): 120 dB
const FC_MAX = 3000, L_HALF = 1;                   // event pixel bandwidth: FC_MAX x L / (L + L_HALF) hertz (modelled)
const TAU_REC = 150;                               // leaky integrator memory, ms
const BYTES_EV = 8;                                // bytes per event (assumed address-event format)
const SPAN = 100;                                  // space-time view depth, ms
const CAP = 1 << 20;                               // event ring size
const PX_M = 40;                                   // assumed image scale, pixels per metre
const BALL_V = 400;                                // ball speed across the image, px/s (10 m/s at the assumed scale)

const hexRgb = (c) => { c = (c || '').trim(); if (c[0] === '#') { const s = c.length === 4 ? c.slice(1).replace(/./g, '$&$&') : c.slice(1, 7), n = parseInt(s, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; } const m = c.match(/[\d.]+/g) || [128, 128, 128]; return [+m[0], +m[1], +m[2]]; };
const sp = (n) => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
const fmtRate = (r) => (r >= 1e6 ? (r / 1e6).toFixed(2) + ' M' : r >= 1e4 ? Math.round(r / 1e3) + ' k' : r >= 1e3 ? (r / 1e3).toFixed(1) + ' k' : String(Math.round(r)));
const fmtBytes = (b) => (b >= 1e6 ? (b / 1e6).toFixed(2) + ' MB/s' : b >= 1e3 ? (b / 1e3).toFixed(b >= 1e4 ? 0 : 1) + ' kB/s' : Math.round(b) + ' B/s');
const fmtLux = (v) => (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v >= 0.1 ? v.toFixed(2) : v.toFixed(3)) + ' lux';
const luxWord = (v) => (v < 0.05 ? 'starlight' : v < 1.5 ? 'moonlight' : v < 60 ? 'dusk' : v < 600 ? 'indoor light' : 'overcast day');

export async function create(el, ctx, lab, def) {
  const { h, icon } = ctx.kit;
  const href = new URL('./events.css', import.meta.url).href;
  if (!document.querySelector('link[href="' + href + '"]')) document.head.append(h('link', { rel: 'stylesheet', href }));
  const F = lab.frame(el, { n: def.n, title: def.title, tags: def.tags, lede: [
    'An event camera has no frames: each pixel reports, within microseconds, only that it became brighter or darker.',
    'This page turns a synthetic night scene into that stream, beside the blurred, clipped frames an ordinary camera would record of the same moment.'] });

  // ---------- parameters ----------
  const P = { C: 0.2, expo: 20, lux: 0.3, speed: 1, noise: 0.5, win: 10, refr: 0.5, rate: 1 / 16, drone: true, wave: true, swing: true, src: 'synth', view: 'recon' };
  const rnd = lab.rng(4391), g1 = () => lab.gauss(rnd);

  // ---------- the world: rubble seen from above, drawn once as an albedo map ----------
  const PERSON = [WW / 2 - 40, WH / 2 - 22], LAMP = [WW / 2 + 62, WH / 2 - 30];
  const albedo = (() => {
    const c = document.createElement('canvas'); c.width = WW; c.height = WH;
    const g = c.getContext('2d', { willReadFrequently: true }), r = lab.rng(20261123), R = (a, b) => a + (b - a) * r();
    const grey = (a) => { const v = Math.round(255 * Math.min(1, Math.max(0, a))); return 'rgb(' + v + ',' + v + ',' + v + ')'; };
    g.fillStyle = grey(0.15); g.fillRect(0, 0, WW, WH);
    for (let k = 0; k < 46; k++) { const x = R(0, WW), y = R(0, WH), rr = R(18, 70), a = R(0.09, 0.22), gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, grey(a)); gr.addColorStop(1, 'rgba(38,38,38,0)'); g.globalAlpha = 0.55; g.fillStyle = gr; g.fillRect(x - rr, y - rr, 2 * rr, 2 * rr); }
    g.globalAlpha = 1;
    const slab = (x, y, w, hh, rot, al) => {
      g.save(); g.translate(x, y); g.rotate(rot);
      const q = [[-w / 2 + R(0, 5), -hh / 2 + R(0, 4)], [w / 2 - R(0, 6), -hh / 2 + R(0, 5)], [w / 2 - R(0, 4), hh / 2 - R(0, 5)], [-w / 2 + R(0, 6), hh / 2 - R(0, 4)]];
      const path = (dx, dy) => { g.beginPath(); q.forEach(([px, py], i) => (i ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy))); g.closePath(); };
      g.fillStyle = grey(0.045); path(2.2, 2.8); g.fill();                 // the gap under a tilted slab
      g.fillStyle = grey(al); path(0, 0); g.fill();
      g.strokeStyle = grey(al * 1.3); g.lineWidth = 0.9; g.beginPath(); g.moveTo(q[0][0], q[0][1]); g.lineTo(q[1][0], q[1][1]); g.stroke();   // lit edge
      g.strokeStyle = grey(al * 0.4); g.lineWidth = 0.7;
      for (let n = 0; n < 2; n++) { g.beginPath(); let px = R(-w / 2 + 4, w / 2 - 4), py = -hh / 2 + 2; g.moveTo(px, py); while (py < hh / 2 - 3) { px += R(-5, 5); py += R(3, 9); g.lineTo(px, py); if (r() < 0.25) { g.lineTo(px + R(-9, 9), py + R(2, 7)); g.moveTo(px, py); } } g.stroke(); }   // cracks
      for (let n = 0; n < w * hh / 60; n++) { g.fillStyle = grey(al * R(0.7, 1.25)); g.fillRect(R(-w / 2 + 3, w / 2 - 3), R(-hh / 2 + 3, hh / 2 - 3), R(0.6, 1.8), R(0.6, 1.8)); }   // aggregate
      g.restore();
    };
    for (let k = 0; k < 40; k++) slab(R(0, WW), R(0, WH), R(26, 92), R(18, 62), R(-0.7, 0.7), R(0.2, 0.44));
    slab(PERSON[0] + 4, PERSON[1] + 14, 104, 128, -0.33, 0.3);             // the slab the person lies on
    // a sheet of corrugated roofing: strong regular texture
    g.save(); g.translate(WW / 2 + 96, WH / 2 + 62); g.rotate(0.42); g.fillStyle = grey(0.05); g.fillRect(-36, -25, 76, 54);
    for (let x = -38; x < 38; x += 4) { g.fillStyle = grey(0.5); g.fillRect(x, -27, 2, 54); g.fillStyle = grey(0.27); g.fillRect(x + 2, -27, 2, 54); } g.restore();
    // timber
    for (let k = 0; k < 6; k++) { const x = R(20, WW - 20), y = R(20, WH - 20), len = R(60, 130), a = R(-1.4, 1.4), al = R(0.24, 0.36); g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = grey(0.05); g.fillRect(-len / 2 + 1.5, -1, len, 6); g.fillStyle = grey(al); g.fillRect(-len / 2, -3, len, 6); g.strokeStyle = grey(al * 0.7); g.lineWidth = 0.5; for (let n = -2; n <= 2; n += 2) { g.beginPath(); g.moveTo(-len / 2, n); g.lineTo(len / 2, n + R(-0.6, 0.6)); g.stroke(); } g.restore(); }
    // bricks, whole and broken
    for (let k = 0; k < 190; k++) { const x = R(0, WW), y = R(0, WH), a = R(0, Math.PI), al = R(0.1, 0.24), bw = r() < 0.6 ? 8.4 : R(3, 6); g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = grey(0.04); g.fillRect(-bw / 2 + 0.8, -2 + 1, bw, 4); g.fillStyle = grey(al); g.fillRect(-bw / 2, -2, bw, 4); g.restore(); }
    // reinforcing bar
    g.strokeStyle = grey(0.035); g.lineWidth = 1.1;
    for (let k = 0; k < 14; k++) { const x = R(0, WW), y = R(0, WH), a = R(0, 6.28), len = R(30, 90); g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + Math.cos(a) * len * 0.3 + R(-10, 10), y + Math.sin(a) * len * 0.3 + R(-10, 10), x + Math.cos(a) * len * 0.7 + R(-14, 14), y + Math.sin(a) * len * 0.7 + R(-14, 14), x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke(); }
    for (let k = 0; k < 1500; k++) { g.fillStyle = grey(R(0.06, 0.4)); const s = R(0.5, 1.6); g.fillRect(R(0, WW), R(0, WH), s, s); }   // pebbles and grit
    // the lamp's tripod
    g.strokeStyle = grey(0.06); g.lineWidth = 1.6; for (let k = 0; k < 3; k++) { const a = 0.5 + k * 2.094; g.beginPath(); g.moveTo(LAMP[0], LAMP[1]); g.lineTo(LAMP[0] + Math.cos(a) * 15, LAMP[1] + Math.sin(a) * 15); g.stroke(); }
    const d = g.getImageData(0, 0, WW, WH).data, A = new Float32Array(WW * WH);
    for (let i = 0; i < WW * WH; i++) A[i] = Math.max(0.02, (d[i * 4] / 255) * (0.9 + 0.2 * r()));
    return A;
  })();

  // ---------- buffers ----------
  const Lum = new Float32Array(N), alb = new Float32Array(N);                          // true radiance (lux x albedo), working albedo
  const filt = new Float32Array(N), ref = new Float32Array(N), last = new Float64Array(N), mism = new Float32Array(N);
  for (let i = 0; i < N; i++) mism[i] = 1 + 0.03 * g1();                               // fixed threshold mismatch, 3 % (assumed)
  const acc = new Float32Array(N), rec = new Float32Array(N), recT = new Float64Array(N), truthLog = new Float32Array(N);
  const eI = new Uint16Array(CAP), eT = new Float64Array(CAP), eP = new Int8Array(CAP); let eHead = 0, eCount = 0;
  const camFrame = new Uint8ClampedArray(N);                                           // what the frame camera last delivered (display values)
  const cnt = new Int16Array(N);
  const S = { now: 0, simAcc: 0, phase: 0, clock: 0, lampPh: 0, frameStart: 0, frameDone: false, frames: 0, gain: 1, crushed: 0, clipped: 0, started: false,
    evTotal: 0, noiseTotal: 0, dropped: 0, dropped0: 0, lost: 0, bucket: 0, bucketNoise: 0, bucketT: 0, rate: 0, noiseRate: 0, hist: new Float32Array(200), histN: 0,
    speedPx: 0, psnr: null, mae: null, sceneDb: 0, evOut: 0, quietMs: 0, inWin: 0, inWinNoise: 0, ox: 0, oy: 0 };
  const ball = { on: false, t0: 0, x: 0, y: 0, r: 4.5, onset: null, evT: null, frameT: null, wait: false, n: 0 };
  let COL = null;
  const readColours = () => { COL = { on: hexRgb(lab.tok('--accent')), off: hexRgb(lab.tok('--warn')), bg: hexRgb(lab.tok('--bg-0')), line: lab.tok('--line'), line2: lab.tok('--line-2'), line3: lab.tok('--line-3'), text: lab.tok('--text'), text2: lab.tok('--text-2'), text3: lab.tok('--text-3'), accent: lab.tok('--accent'), warn: lab.tok('--warn'), mono: lab.tok('--mono'), font: lab.tok('--font') }; };
  readColours();

  // ---------- scene renderer: one call = the true radiance at one instant ----------
  function capsule(ox, oy, ax, ay, bx, by, rad, a) {
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rad - 1 - ox)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + rad + 1 - ox));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rad - 1 - oy)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + rad + 1 - oy));
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-6;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 + ox - ax, py = y + 0.5 + oy - ay; let u = (px * dx + py * dy) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
      const ex = px - u * dx, ey = py - u * dy, d = Math.sqrt(ex * ex + ey * ey) - rad;
      if (d < 0.5) { const i = y * W + x; alb[i] += (a - alb[i]) * (d < -0.5 ? 1 : 0.5 - d); }
    }
  }
  const ROT = -0.33, cR = Math.cos(ROT), sR = Math.sin(ROT);
  const pp = (x, y) => [PERSON[0] + x * cR - y * sR, PERSON[1] + x * sR + y * cR];
  function drawPerson(ox, oy) {
    const seg = (a, b, r, al) => { const p = pp(a[0], a[1]), q = pp(b[0], b[1]); capsule(ox, oy, p[0], p[1], q[0], q[1], r, al); };
    seg([-5, 20], [-8, 46], 4.4, 0.1); seg([-8, 46], [-7, 70], 3.8, 0.1); seg([-7, 70], [-9, 76], 3.2, 0.06);       // legs and boots
    seg([6, 20], [10, 47], 4.4, 0.1); seg([10, 47], [13, 70], 3.8, 0.1); seg([13, 70], [16, 76], 3.2, 0.06);
    seg([0, -10], [1, 18], 10, 0.24);                                                                            // jacket
    seg([-9, -1], [10, -2], 1.1, 0.82);                                                                          // reflective band
    seg([-11, -12], [-22, 2], 3.3, 0.24); seg([-22, 2], [-25, 17], 2.9, 0.24); seg([-25, 19], [-25, 20], 3.1, 0.46);   // resting arm and hand
    seg([-1, -27], [-1, -27], 6.6, 0.46); seg([-2, -30], [1, -31], 4.6, 0.07);                                   // face, hair
    const w = S.clock * 2 * Math.PI * 1.4, a1 = -0.95 + 0.8 * Math.sin(w), a2 = a1 + 0.25 + 0.6 * Math.sin(w - 0.9);   // the waving arm
    const sh = [11, -12], elb = [sh[0] + 15 * Math.cos(a1), sh[1] + 15 * Math.sin(a1)], hand = [elb[0] + 14 * Math.cos(a2), elb[1] + 14 * Math.sin(a2)];
    seg(sh, elb, 3.4, 0.24); seg(elb, hand, 3, 0.24); seg(hand, [hand[0] + 2 * Math.cos(a2), hand[1] + 2 * Math.sin(a2)], 3.3, 0.46);
  }
  function renderScene() {
    const sx = 44 * Math.sin(S.phase), sy = 12 * Math.sin(2 * S.phase + 0.6);
    const vib = P.drone ? 0.05 : 0, vx = vib * Math.sin(S.now * 0.001 * 2 * Math.PI * 71), vy = vib * Math.cos(S.now * 0.001 * 2 * Math.PI * 83);
    const ox = (WW - W) / 2 + sx + vx, oy = (WH - H) / 2 + sy + vy; S.ox = ox; S.oy = oy;
    const ix = Math.floor(ox), iy = Math.floor(oy), fx = ox - ix, fy = oy - iy, w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    for (let y = 0; y < H; y++) { let j = (iy + y) * WW + ix, i = y * W; for (let x = 0; x < W; x++, i++, j++) alb[i] = w00 * albedo[j] + w10 * albedo[j + 1] + w01 * albedo[j + WW] + w11 * albedo[j + WW + 1]; }
    drawPerson(ox, oy);
    if (ball.on) capsule(0, 0, ball.x, ball.y, ball.x, ball.y, ball.r, 0.75);
    const lx = LAMP[0] + 18 * Math.sin(S.lampPh) - ox, ly = LAMP[1] + 5 * Math.sin(2 * S.lampPh + 1) - oy, hgt = 26, h2 = hgt * hgt, E0 = 160 * hgt * h2, amb = P.lux;
    for (let y = 0, i = 0; y < H; y++) { const dy = y + 0.5 - ly, dy2 = dy * dy; for (let x = 0; x < W; x++, i++) { const dx = x + 0.5 - lx, d2 = dx * dx + dy2, q = d2 + h2; let L = alb[i] * (amb + E0 * h2 / (q * q * Math.sqrt(q))); if (d2 < 64) { const d = Math.sqrt(d2); L += d < 2.2 ? 2400 : 2400 * Math.exp(-(d - 2.2) * 1.9); } Lum[i] = L; } }
  }

  // ---------- event pixels ----------
  function emit(i, t, pol, noise) {
    eI[eHead] = i; eT[eHead] = t; eP[eHead] = noise ? pol * 2 : pol; eHead = (eHead + 1) & (CAP - 1); if (eCount < CAP) eCount++;
    const dtr = t - recT[i]; rec[i] = (dtr > 0 ? rec[i] * Math.exp(-dtr / TAU_REC) : rec[i]) + pol * P.C; recT[i] = t;
    S.evTotal++; S.bucket++; if (noise) { S.noiseTotal++; S.bucketNoise++; }
    else if (ball.wait) { const x = i % W - ball.x + 0.5, y = (i / W | 0) - ball.y + 0.5; if (x * x + y * y <= (ball.r + 1.5) * (ball.r + 1.5)) { ball.evT = Math.max(0.001, t - ball.onset); ball.wait = false; } }
  }
  function resetSensor() {
    for (let i = 0; i < N; i++) { const l = Math.log(Math.min(Lum[i], L_SAT) + L_DARK); filt[i] = l; ref[i] = l; last[i] = -1e9; rec[i] = 0; recT[i] = S.now; }
    acc.fill(0); eCount = 0; eHead = 0; S.frameStart = S.now; S.frameDone = false; S.bucket = 0; S.bucketNoise = 0; S.bucketT = S.now; S.hist.fill(0); S.histN = 0; S.rate = 0; S.noiseRate = 0; S.psnr = null; S.mae = null;
  }
  function sensorStep(dt) {
    const t0 = S.now, C = P.C, refr = P.refr, k2 = dt * 0.001 * 2 * Math.PI * FC_MAX; let out = 0, sig = 0;
    for (let i = 0; i < N; i++) {
      const L = Lum[i], Lc = L > L_SAT ? L_SAT : L; if (L > L_SAT || L < L_DARK) out++;
      const l = Math.log(Lc + L_DARK), fp = filt[i], gg = k2 * Lc / (Lc + L_HALF), f = fp + (l - fp) * (gg / (1 + gg)); filt[i] = f;
      const Ci = C * mism[i], d = f - ref[i];
      if (d >= Ci || d <= -Ci) {
        const s = d > 0 ? 1 : -1, nFull = Math.floor(Math.abs(d) / Ci), n = nFull > 12 ? 12 : nFull, span = f - fp, r0 = ref[i];
        for (let k = 1; k <= n; k++) { let u = span !== 0 ? (r0 + s * k * Ci - fp) / span : 1; u = u < 0 ? 0 : u > 1 ? 1 : u; const t = t0 + u * dt; if (t - last[i] < refr) { S.dropped++; continue; } last[i] = t; emit(i, t, s, false); sig++; }
        ref[i] = r0 + s * nFull * Ci;
      }
    }
    S.evOut = out / N;
    // background activity: noise events, more likely on dark pixels (modelled)
    const want = P.noise * N * dt * 0.001; let nn = Math.floor(want); if (rnd() < want - nn) nn++;
    for (let k = 0; k < nn; k++) { const i = (rnd() * N) | 0; if (rnd() < 0.15 + 0.85 / (1 + Lum[i])) emit(i, t0 + rnd() * dt, rnd() < 0.5 ? 1 : -1, true); }
    S.quietMs = sig ? 0 : S.quietMs + dt;
    S.now = t0 + dt;
    if (S.now - S.bucketT >= 10) { const span = (S.now - S.bucketT) / 1000; S.hist[S.histN % 200] = S.bucket / span; S.histN++; S.noiseRate = S.noiseRate * 0.8 + 0.2 * (S.bucketNoise / span); S.lost = S.lost * 0.8 + 0.2 * ((S.dropped - S.dropped0) / Math.max(1, S.dropped - S.dropped0 + S.bucket)); S.dropped0 = S.dropped; S.bucket = 0; S.bucketNoise = 0; S.bucketT = S.now;
      let a = 0, c = 0; for (let k = 1; k <= Math.min(10, S.histN); k++) { a += S.hist[(S.histN - k) % 200]; c++; } S.rate = a / c; }
  }

  // ---------- frame camera ----------
  function deliverFrame(src) {
    let mean = 0, crushed = 0, clipped = 0;
    for (let i = 0; i < N; i++) { const e = src[i]; mean += e > FULL_WELL ? FULL_WELL : e; if (e < READ_NOISE) crushed++; else if (e >= FULL_WELL) clipped++; }
    mean /= N; const gain = Math.min(16, Math.max(1, 0.16 * FULL_WELL / (mean + 1))); S.gain = gain; S.crushed = crushed / N; S.clipped = clipped / N; S.frames++;
    for (let i = 0; i < N; i++) { let e = src[i]; e += Math.sqrt(e) * g1() + READ_NOISE * g1(); e = e > FULL_WELL ? FULL_WELL : e < 0 ? 0 : e; const dn = Math.min(255, Math.round(gain * e / FULL_WELL * 255)); camFrame[i] = 255 * Math.pow(dn / 255, 1 / 2.2); }
  }
  function frameStep(dt) {
    const tA = S.now, tB = tA + dt, eA = S.frameStart, eB = eA + P.expo, ov = Math.min(tB, eB) - Math.max(tA, eA);
    if (ov > 0) { const k = K_E * ov; for (let i = 0; i < N; i++) acc[i] += k * Lum[i]; }
    if (tB >= eB && !S.frameDone) { deliverFrame(acc); S.frameDone = true; if (ball.onset != null && ball.frameT == null && eB > ball.onset) ball.frameT = eB - ball.onset; }
    if (tB >= eA + FRAME_MS) { S.frameStart = eA + FRAME_MS; acc.fill(0); S.frameDone = false; }
  }

  // ---------- one millisecond of the synthetic scene ----------
  function advance(dt) {
    const ds = dt * 0.001 * P.speed, ph0 = S.phase;
    if (P.drone) S.phase += ds * 2 * Math.PI / 1.6;
    if (P.wave) S.clock += ds;
    if (P.swing) S.lampPh += ds * 2 * Math.PI * 0.9;
    S.speedPx = P.drone ? Math.hypot(44 * (Math.sin(S.phase) - Math.sin(ph0)), 12 * (Math.sin(2 * S.phase + 0.6) - Math.sin(2 * ph0 + 0.6))) / (dt * 0.001) : 0;
    if (ball.on) { const tau = (S.now + dt - ball.t0) * 0.001; ball.x = -ball.r - 1 + BALL_V * tau; ball.y = 46 + 110 * tau; if (ball.onset == null && ball.x + ball.r >= 0.5) { ball.onset = S.now; ball.wait = true; } if (ball.x - ball.r > W + 2) ball.on = false; }
    renderScene();
    if (!S.started) { resetSensor(); S.started = true; }
    frameStep(dt); sensorStep(dt);
  }
  function throwBall() { if (P.src !== 'synth') return; ball.on = true; ball.t0 = S.now; ball.onset = null; ball.evT = null; ball.frameT = null; ball.wait = false; ball.x = -10; ball.y = 46; ball.n++; paintText(true); }

  // ---------- webcam source ----------
  let stream = null, video = null, lastVT = -1, camT0 = 0; const camCanvas = document.createElement('canvas'); camCanvas.width = W; camCanvas.height = H; const camG = camCanvas.getContext('2d', { willReadFrequently: true });
  function cameraStep() {
    if (!video || video.readyState < 2 || video.currentTime === lastVT) return;
    const first = lastVT < 0; lastVT = video.currentTime;
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw) return;
    const s = Math.max(W / vw, H / vh), dw = vw * s, dh = vh * s; camG.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const d = camG.getImageData(0, 0, W, H).data;
    for (let i = 0, j = 0; i < N; i++, j += 4) { const y = (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) / 255; Lum[i] = 100 * Math.pow(y, 2.2) + 0.01; camFrame[i] = 255 * y; }
    const t = performance.now() - camT0;
    if (first || !S.started) { S.now = t; resetSensor(); S.started = true; return; }
    const dt = Math.min(100, Math.max(1, t - S.now)); S.speedPx = 0; S.frames++; sensorStep(dt);
  }
  async function useCamera() {
    setStatus('Asking for your camera…', 'accent live');
    try {
      stream = await lab.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } }, audio: false });
      video = h('video', { muted: true, playsInline: true, autoplay: true }); video.srcObject = stream; await video.play();
      stream.getVideoTracks()[0].addEventListener('ended', () => { if (P.src === 'camera') useSynth('The camera stopped. Back on the synthetic scene.'); });
      P.src = 'camera'; lastVT = -1; camT0 = performance.now(); S.started = false; ball.on = false; S.psnr = null;
      const st = stream.getVideoTracks()[0].getSettings();
      setStatus('Your camera, ' + (st.width || '?') + ' × ' + (st.height || '?') + (st.frameRate ? ' at ' + Math.round(st.frameRate) + ' frames/s' : '') + '. Nothing leaves this computer.', 'person live');
    } catch (e) {
      if (stream) { lab.release(stream); stream = null; }
      useSynth(lab.mediaError(e), true);
    }
    syncSource();
  }
  function useSynth(msg, isError) {
    if (stream) { lab.release(stream); stream = null; } if (video) { video.srcObject = null; video = null; }
    P.src = 'synth'; S.started = false; S.now = 0; S.simAcc = 0;
    setStatus(msg || 'Synthetic night scene, 1 000 renders per simulated second', isError ? 'warn' : 'ok');
    if (isError) ctx.shell.toast(msg, { level: 'warn' });
    syncSource();
  }

  // ---------- stage ----------
  const status = h('span.status.ok', null, 'Synthetic night scene, 1 000 renders per simulated second');
  const setStatus = (text, cls) => { status.className = 'status ' + cls; status.textContent = text; };
  const srcSeg = h('div.seg', { role: 'group', 'aria-label': 'Source' },
    h('button', { 'aria-pressed': 'true', onclick: () => { if (P.src !== 'synth') useSynth(); } }, icon('drone', 14), 'Synthetic scene'),
    h('button', { 'aria-pressed': 'false', onclick: () => { if (P.src !== 'camera') useCamera(); } }, icon('camera', 14), 'Use my camera'));
  const RATES = [[1 / 64, '1/64'], [1 / 16, '1/16'], [1 / 4, '1/4']];
  const rateSeg = h('div.seg', { role: 'group', 'aria-label': 'Playback speed', title: 'How fast simulated time runs against your clock. Slow motion is the only way to watch a millisecond.' }, RATES.map(([v, t]) => h('button', { 'aria-pressed': String(v === P.rate), onclick: (e) => { P.rate = v; [...rateSeg.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, t)));
  const freezeBtn = h('button.btn', { 'aria-pressed': 'false', title: 'Stop the drone, the arm and the lamp. Nothing changes, so no pixel has anything to report.', onclick: () => setFrozen(freezeBtn.getAttribute('aria-pressed') !== 'true') }, icon('pause', 14), 'Freeze the scene');
  const throwBtn = h('button.btn.btn-primary', { title: 'A ball crosses the view at 10 m/s (assumed scale). The page times the first event and the first frame that shows it.', onclick: throwBall }, icon('target', 14), 'Throw a ball past the lens');
  const clock = h('span.num.vision-events-clock', null, 't 0.0 ms');
  F.stage.append(h('div.vision-stagebar', null, srcSeg, status, h('span.grow'), h('span.vision-events-lbl', null, 'Slow motion'), rateSeg, freezeBtn, throwBtn));

  const mkPane = (id, title, sub, extra) => {
    const canvas = h('canvas', { role: 'img', 'aria-label': title + '. ' + sub }), foot = h('div.vision-events-foot.num'), note = h('div.vision-events-note', { hidden: true });
    const pane = h('section.vision-events-pane', { 'data-pane': id, 'aria-label': title }, h('header', null, h('div', null, h('b', null, title), h('span', null, sub)), extra || null), h('div.vision-events-view', null, canvas, note), foot);
    return { pane, canvas, foot, note, g: canvas.getContext('2d') };
  };
  const winOut = h('output.num', null, '10 ms');
  const winIn = h('input.slider', { type: 'range', min: 1, max: 50, step: 1, value: P.win, 'aria-label': 'Accumulation window, milliseconds', title: 'How much time the picture below gathers. The events themselves are not blurred: each keeps its own time.', oninput: () => { P.win = +winIn.value; winOut.textContent = P.win + ' ms'; winIn.style.setProperty('--p', (100 * (P.win - 1) / 49) + '%'); } });
  winIn.style.setProperty('--p', (100 * (P.win - 1) / 49) + '%');
  const viewSeg = h('div.seg', { role: 'group', 'aria-label': 'What the fourth view shows' }, [['recon', 'From events'], ['truth', 'True scene'], ['err', 'Error']].map(([v, t]) => h('button', { 'aria-pressed': String(v === P.view), onclick: (e) => { P.view = v; [...viewSeg.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, t)));
  const pa = mkPane('frame', 'Frame camera', 'One exposure, 30 times a second, 60 dB');
  const pb = mkPane('events', 'Event stream', 'Each dot is one pixel reporting a change', h('label.vision-events-win', null, h('span', null, 'Window'), winIn, winOut));
  const pc = mkPane('space', 'Events in space and time', 'Motion is a surface, not a smear');
  const pd = mkPane('recon', 'Rebuilt from events alone', 'Leaky integrator, ' + TAU_REC + ' ms memory', viewSeg);
  pb.pane.querySelector('header > div').append(h('span.vision-events-key', null, h('i.on'), 'brighter (ON)', h('i.off'), 'darker (OFF)'));
  F.stage.append(h('div.vision-events-grid', null, pa.pane, pb.pane, pc.pane, pd.pane));
  F.stage.append(h('div.vision-stagefoot', null, icon('info', 14), h('span', null, 'Synthetic scene, assumed sensor constants. HOUND carries no event camera.'), h('span.grow'), clock));

  const panes = [pa, pb, pc, pd];
  const ros = panes.map((p) => { const ro = new ResizeObserver(() => { const r = p.canvas.getBoundingClientRect(); if (!r.width || !r.height) return; const dpr = Math.min(2, devicePixelRatio || 1); p.canvas.width = Math.round(r.width * dpr); p.canvas.height = Math.round(r.height * dpr); p.w = r.width; p.h = r.height; p.dpr = dpr; p.buf = null; draw(); }); ro.observe(p.canvas); return ro; });
  const off = document.createElement('canvas'); off.width = W; off.height = H; const offG = off.getContext('2d'), img = offG.createImageData(W, H), px = img.data;
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  function blit(p) {
    if (!p.w) return null; offG.putImageData(img, 0, 0);
    const g = p.g; g.setTransform(p.dpr, 0, 0, p.dpr, 0, 0); g.clearRect(0, 0, p.w, p.h);
    const s = Math.min((p.w - 16) / W, (p.h - 16) / H), dw = Math.round(W * s), dh = Math.round(H * s), dx = Math.round((p.w - dw) / 2), dy = Math.round((p.h - dh) / 2);
    g.imageSmoothingEnabled = false; g.drawImage(off, dx, dy, dw, dh);
    g.strokeStyle = COL.line2; g.lineWidth = 1; g.strokeRect(dx - 0.5, dy - 0.5, dw + 1, dh + 1);
    // corner ticks every 60 px of sensor: a quiet scale
    g.strokeStyle = COL.line3; g.beginPath(); for (let x = 0; x <= W; x += 64) { const X = Math.round(dx + x * s) + 0.5; g.moveTo(X, dy + dh + 1); g.lineTo(X, dy + dh + 5); } for (let y = 0; y <= H; y += 40) { const Y = Math.round(dy + y * s) + 0.5; g.moveTo(dx - 5, Y); g.lineTo(dx - 1, Y); } g.stroke();
    return { dx, dy, dw, dh, s };
  }
  const grey = (i, v) => { const j = i * 4; px[j] = v; px[j + 1] = v; px[j + 2] = v; };

  function drawFrame() {
    for (let i = 0; i < N; i++) grey(i, camFrame[i]);
    const r = blit(pa); if (!r) return;
    if (ball.on && P.src === 'synth' && ball.frameT == null && ball.onset != null) { const g = pa.g; g.fillStyle = COL.text3; g.font = '500 11px ' + COL.mono; g.textAlign = 'left'; g.fillText('the ball is in the scene; this frame predates it', r.dx + 8, r.dy + 16); }
  }
  function drawEvents() {
    cnt.fill(0); const tMin = S.now - P.win; let n = 0, nz = 0;
    for (let k = 1; k <= eCount; k++) { const j = (eHead - k) & (CAP - 1), t = eT[j]; if (t < tMin - 34) break; if (t < tMin) continue; const p = eP[j]; cnt[eI[j]] += p > 0 ? 1 : -1; n++; if (p === 2 || p === -2) nz++; }
    S.inWin = n; S.inWinNoise = nz;
    const on = COL.on, of = COL.off, bg = COL.bg;
    for (let i = 0, j = 0; i < N; i++, j += 4) { const c = cnt[i]; if (!c) { px[j] = bg[0] + 6; px[j + 1] = bg[1] + 7; px[j + 2] = bg[2] + 9; continue; } const a = 1 - Math.exp(-Math.abs(c) * 0.9), col = c > 0 ? on : of; px[j] = bg[0] + (col[0] - bg[0]) * a; px[j + 1] = bg[1] + (col[1] - bg[1]) * a; px[j + 2] = bg[2] + (col[2] - bg[2]) * a; }
    blit(pb);
  }
  // space-time: every event of the last 100 ms as a point (x, y, t). Drag to turn.
  let yaw = 1.02; const PITCH = 0.5;
  function drawSpace() {
    const p = pc; if (!p.w) return; const g = p.g, Wd = p.canvas.width, Hd = p.canvas.height;
    if (!p.buf || p.buf.width !== Wd) p.buf = g.createImageData(Wd, Hd);
    const d = p.buf.data, bg = COL.bg; for (let i = 0; i < d.length; i += 4) { d[i] = bg[0]; d[i + 1] = bg[1]; d[i + 2] = bg[2]; d[i + 3] = 255; }
    const D = 520, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(PITCH), spt = Math.sin(PITCH);
    const proj = (x, y, z) => { const X = x - W / 2, Y = y - H / 2, Z = z - D / 2, a = X * cy + Z * sy, b = -X * sy + Z * cy; return [a, Y * cp + b * spt]; };
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const cx of [0, W]) for (const cyy of [0, H]) for (const cz of [0, D]) { const q = proj(cx, cyy, cz); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    const sc = Math.min((p.w - 70) / (x1 - x0), (p.h - 58) / (y1 - y0)), ox = p.w / 2 - sc * (x0 + x1) / 2, oy = p.h / 2 - sc * (y0 + y1) / 2 - 10, dpr = p.dpr;
    const P2 = (x, y, z) => { const q = proj(x, y, z); return [ox + sc * q[0], oy + sc * q[1]]; };
    // points
    const tMin = S.now - SPAN, tWin = S.now - P.win, on = COL.on, of = COL.off; let total = 0;
    for (let k = 1; k <= eCount; k++) { const t = eT[(eHead - k) & (CAP - 1)]; if (t < tMin - 34) break; total++; }
    const stride = Math.max(1, Math.ceil(total / 140000)), kx = sc * dpr, big = dpr > 1 ? 1 : 0;
    for (let k = 1; k <= total; k += stride) {
      const j = (eHead - k) & (CAP - 1), t = eT[j]; if (t < tMin) continue; const i = eI[j], x = i % W - W / 2, y = (i / W | 0) - H / 2, z = (S.now - t) / SPAN * D - D / 2;
      const X = Math.round((ox + sc * (x * cy + z * sy)) * dpr), Y = Math.round((oy + sc * (y * cp + (-x * sy + z * cy) * spt)) * dpr); if (X < 0 || Y < 0 || X >= Wd - 1 || Y >= Hd - 1) continue;
      const col = eP[j] > 0 ? on : of, a = t >= tWin ? 0.8 : 0.3, m = (Y * Wd + X) * 4;
      d[m] += (col[0] - d[m]) * a; d[m + 1] += (col[1] - d[m + 1]) * a; d[m + 2] += (col[2] - d[m + 2]) * a;
      if (big) { const m2 = m + 4; d[m2] += (col[0] - d[m2]) * a * 0.6; d[m2 + 1] += (col[1] - d[m2 + 1]) * a * 0.6; d[m2 + 2] += (col[2] - d[m2 + 2]) * a * 0.6; }
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.putImageData(p.buf, 0, 0); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the box, the "now" plane, the window slab and the time axis
    const line = (a, b, st, w = 1, dash) => { g.strokeStyle = st; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); };
    const c = (z) => [P2(0, 0, z), P2(W, 0, z), P2(W, H, z), P2(0, H, z)];
    const far = c(D), near = c(0), zw = P.win / SPAN * D, slab = c(zw);
    for (let k = 0; k < 4; k++) { line(far[k], far[(k + 1) % 4], COL.line2); line(near[k], far[k], COL.line2); }
    for (let k = 0; k < 4; k++) line(slab[k], slab[(k + 1) % 4], COL.line3, 1, [3, 3]);
    for (let k = 0; k < 4; k++) line(near[k], near[(k + 1) % 4], COL.text2, 1.2);
    g.setLineDash([]); g.font = '500 10px ' + COL.mono; g.fillStyle = COL.text3; g.textAlign = 'center';
    for (let ms = 0; ms <= SPAN; ms += 20) { const a = P2(0, H, ms / SPAN * D), b = [a[0], a[1] + 5]; line(a, b, COL.line3); g.fillText(ms ? '−' + ms : 'now', a[0], a[1] + 15); }
    g.fillStyle = COL.text2; g.font = '500 11px ' + COL.font; g.textAlign = 'left'; g.fillText('depth: time before now, ms', 10, p.h - 9);
    g.textAlign = sy > 0 ? 'right' : 'left'; g.fillStyle = COL.text3; g.font = '500 10px ' + COL.mono;
    const tx = P2(W / 2, 0, 0); g.textAlign = 'center'; g.fillText('x, ' + W + ' px', tx[0], tx[1] - 6);
    const ty = P2(W, H / 2, 0); g.textAlign = 'left'; g.fillText('y, ' + H + ' px', ty[0] + 6, ty[1] + 3);
    if (stride > 1) { g.textAlign = 'right'; g.fillText('1 in ' + stride + ' events drawn', p.w - 8, p.h - 8); }
  }
  // reconstruction from events alone, and its error against the true log intensity
  let fitA = 1, fitB = 0, fitN = 0, tLo = 0, tHi = 1;
  function drawRecon() {
    const t = S.now; let sr = 0, st = 0, srr = 0, srt = 0, lo = 1e9, hi = -1e9;
    for (let i = 0; i < N; i++) { const v = rec[i] * Math.exp(-(t - recT[i]) / TAU_REC); cnt[i] = 0; acc2[i] = v; const tl = Math.log(Math.min(Lum[i], L_SAT) + L_DARK); truthLog[i] = tl; sr += v; st += tl; srr += v * v; srt += v * tl; if (tl < lo) lo = tl; if (tl > hi) hi = tl; }
    const mr = sr / N, mt = st / N, vr = srr / N - mr * mr, cov = srt / N - mr * mt;
    fitA = vr > 1e-9 ? cov / vr : 0; fitB = mt - fitA * mr; tLo = lo; tHi = hi;
    let se = 0, ae = 0; const range = Math.max(1e-6, hi - lo), mode = P.view;
    for (let i = 0; i < N; i++) { const est = fitA * acc2[i] + fitB, e = est - truthLog[i]; se += e * e; ae += Math.abs(e);
      if (mode === 'recon') grey(i, 255 * Math.min(1, Math.max(0, 0.5 + acc2[i] * 0.42)));
      else if (mode === 'truth') grey(i, 255 * Math.pow((truthLog[i] - lo) / range, 1.15));
      else { const a = Math.min(1, Math.abs(e) / 2.2), col = e > 0 ? COL.on : COL.off, bg = COL.bg, j = i * 4; px[j] = bg[0] + (col[0] - bg[0]) * a; px[j + 1] = bg[1] + (col[1] - bg[1]) * a; px[j + 2] = bg[2] + (col[2] - bg[2]) * a; } }
    const rmse = Math.sqrt(se / N); S.psnr = 20 * Math.log10(range / Math.max(1e-9, rmse)); S.mae = ae / N / Math.LN2;
    blit(pd);
  }
  const acc2 = new Float32Array(N);

  // ---------- side column ----------
  const rEv = lab.readout('Events each second', 'ev/s'), rData = lab.readout('Event data against the frame camera', ''), rLat = lab.readout('First event, then first frame', 'ms'), rDr = lab.readout('Scene contrast right now', 'dB');
  const chart = h('canvas.vision-chart.vision-events-chart', { role: 'img', 'aria-label': 'Data rate of the event stream and of the frame camera over the last two simulated seconds' });
  const kv = h('dl.kv');
  F.section('Live readouts', h('div.vision-readouts.vision-events-readouts', null, rEv.el, rData.el, rLat.el, rDr.el),
    h('div.vision-chart-title', null, 'Event data follows motion. Frame data never changes.'), chart, kv);
  const sliders = {
    C: lab.slider({ label: 'Contrast threshold', min: 0.05, max: 0.6, step: 0.01, value: P.C, fmt: (v) => Math.round((Math.exp(v) - 1) * 100) + ' % change', title: 'How much brighter or darker a pixel must get before it fires. Lower sees more and makes more noise.', onInput: (v) => { P.C = v; } }),
    expo: lab.slider({ label: 'Frame camera exposure', min: 1, max: 33, step: 1, value: P.expo, fmt: (v) => v + ' ms', title: 'How long the frame camera gathers light for each picture. Long exposures see in the dark and smear whatever moves.', onInput: (v) => { P.expo = v; } }),
    lux: lab.slider({ label: 'Scene brightness', assumed: true, min: -2, max: 3, step: 0.1, value: Math.log10(P.lux), fmt: (v) => fmtLux(Math.pow(10, v)) + ' · ' + luxWord(Math.pow(10, v)), title: 'Ambient light on the rubble. The work lamp keeps its own brightness.', onInput: (v) => { P.lux = Math.pow(10, v); } }),
    speed: lab.slider({ label: 'Scene speed', min: 0.25, max: 4, step: 0.25, value: P.speed, fmt: (v) => '× ' + v.toFixed(2), title: 'Scales the drone sweep, the waving arm and the lamp swing together.', onInput: (v) => { P.speed = v; } }),
    noise: lab.slider({ label: 'Noise events', assumed: true, min: 0, max: 5, step: 0.1, value: P.noise, fmt: (v) => v.toFixed(1) + ' per pixel per s', title: 'Background activity: events with no cause in the scene. Dark pixels make more of them (modelled).', onInput: (v) => { P.noise = v; } }),
    refr: lab.slider({ label: 'Refractory period', assumed: true, min: 0, max: 5, step: 0.1, value: P.refr, fmt: (v) => v.toFixed(1) + ' ms', title: 'After firing, a pixel is deaf for this long. Events that fall inside it are lost.', onInput: (v) => { P.refr = v; } }),
  };
  F.section('Sensor and scene', sliders.C, sliders.expo, sliders.lux, sliders.speed, sliders.noise, sliders.refr);
  const mkCheck = (key, label) => { const input = h('input', { type: 'checkbox', checked: P[key], onchange: () => { P[key] = input.checked; syncFreeze(); } }); return { input, el: h('label.check', null, input, h('span', null, label)) }; };
  const checks = { drone: mkCheck('drone', 'The drone sweeps over the site'), wave: mkCheck('wave', 'The person waves an arm'), swing: mkCheck('swing', 'The work lamp swings') };
  const stillNote = h('div.note.warn', { hidden: true }, icon('alert'), h('div', null, h('b', null, 'Nothing moves, so nothing fires. '), 'A still survivor under a hovering drone is invisible to this sensor. What you see now is noise.'));
  F.section('What moves', h('div.vision-events-checks', null, checks.drone.el, checks.wave.el, checks.swing.el), h('p', null, 'Switch the drone off and only the arm and the lamp write events. Switch everything off and the stream goes quiet.'), stillNote);
  F.section('Assumed sensor constants', h('dl.kv.num', null,
    h('dt', null, 'Both sensors'), h('dd', null, W + ' × ' + H + ' px, ' + (100 / PX_M) + ' cm per px'),
    h('dt', null, 'Frame sensor well'), h('dd', null, sp(FULL_WELL) + ' e⁻, read noise ' + READ_NOISE + ' e⁻'),
    h('dt', null, 'Frame sensor range'), h('dd', null, (20 * Math.log10(FULL_WELL / READ_NOISE)).toFixed(0) + ' dB, 8-bit output'),
    h('dt', null, 'Event pixel range'), h('dd', null, (20 * Math.log10(L_SAT / L_DARK)).toFixed(0) + ' dB, log response'),
    h('dt', null, 'Event pixel bandwidth'), h('dd', null, 'up to ' + sp(FC_MAX) + ' Hz, falls in the dark'),
    h('dt', null, 'Threshold mismatch'), h('dd', null, '3 % between pixels'),
    h('dt', null, 'One event'), h('dd', null, BYTES_EV + ' bytes')),
    h('p', null, 'These are plausible design values, not measurements of any product. Event times are interpolated inside each 1 ms render.'));
  F.dossier({
    research: [
      { title: 'Event-based vision: a survey', who: 'Gallego, Delbruck, Orchard, Bartolozzi, Taba, Censi, Leutenegger, Davison, Conradt, Daniilidis, Scaramuzza, IEEE TPAMI', year: 2020, url: 'https://arxiv.org/abs/1904.08405', note: 'Timing in the order of microseconds, and a dynamic range above 120 dB where a good frame camera has about 60 dB.' },
      { title: 'Dynamic obstacle avoidance for quadrotors with event cameras', who: 'Falanga, Kleber, Scaramuzza, Science Robotics 5(40)', year: 2020, url: 'https://doi.org/10.1126/scirobotics.aaz9712', note: 'A quadrotor dodges thrown objects with an overall latency of 3.5 ms. The ball button here borrows that test.' },
      { title: 'Ultimate SLAM? Combining events, images and IMU for robust visual SLAM in HDR and high-speed scenarios', who: 'Rosinol Vidal, Rebecq, Horstschaefer, Scaramuzza, IEEE RA-L 3(2)', year: 2018, url: 'https://arxiv.org/abs/1709.06310', note: 'Events, frames and inertial data fused on board a quadrotor, for fast motion and hard lighting.' },
      { title: 'A 128 × 128 120 dB 15 μs latency asynchronous temporal contrast vision sensor', who: 'Lichtsteiner, Posch, Delbruck, IEEE Journal of Solid-State Circuits 43(2)', year: 2008, url: 'https://www.zora.uzh.ch/id/eprint/17629/', note: 'The sensor this page imitates. Its 15 μs latency is a minimum, reached above 1 klux.' }],
    field: FIELD, failure: FAILURE });

  // ---------- painting text and the strip chart ----------
  let lastText = 0;
  function paintText(force) {
    const tNow = performance.now(); if (!force && tNow - lastText < 140) return; lastText = tNow;
    const synth = P.src === 'synth', frameBytes = N * (synth ? 30 : 30), evBytes = S.rate * BYTES_EV;
    rEv.set(fmtRate(S.rate), 'Events each second, of which ' + fmtRate(S.noiseRate) + ' are noise');
    rData.set(fmtBytes(evBytes).replace('/s', ''), (evBytes / frameBytes >= 0.1 ? (evBytes / frameBytes).toFixed(evBytes / frameBytes >= 10 ? 0 : 1) + ' ×' : (100 * evBytes / frameBytes).toFixed(1) + ' % of') + ' the frame camera’s ' + fmtBytes(frameBytes)); rData.unit('per s');
    if (!synth) rLat.set('–', 'Latency is timed on the synthetic scene only');
    else if (ball.evT != null) rLat.set(ball.evT.toFixed(ball.evT < 10 ? 2 : 1) + (ball.frameT != null ? ' · ' + ball.frameT.toFixed(1) : ' · …'), 'First event, then first frame, after the ball entered');
    else rLat.set(ball.onset != null ? '…' : '–', ball.n ? 'Waiting for the first event from the ball' : 'Throw a ball to time both sensors');
    // scene contrast from a log histogram of the true radiance
    let lo = 1e9, hi = 0; const hist = new Uint32Array(128); for (let i = 0; i < N; i += 3) { const b = Math.min(127, Math.max(0, Math.floor((Math.log10(Lum[i] + 1e-6) + 6) * 12.8))); hist[b]++; }
    let c = 0; const tot = Math.ceil(N / 3); for (let b = 0; b < 128; b++) { c += hist[b]; if (c >= tot * 0.005) { lo = b; break; } } c = 0; for (let b = 127; b >= 0; b--) { c += hist[b]; if (c >= tot * 0.005) { hi = b; break; } }
    S.sceneDb = 20 * (hi - lo + 1) / 12.8;
    rDr.set(S.started ? S.sceneDb.toFixed(0) : '–', synth ? 'Scene contrast now. The frame sensor holds 60 dB of it' : 'Contrast inside your camera’s own picture');
    const blur = S.speedPx * P.expo / 1000;
    pa.foot.textContent = synth ? P.expo + ' ms exposure · gain × ' + S.gain.toFixed(1) + ' · blur ' + blur.toFixed(1) + ' px · ' + (100 * S.crushed).toFixed(0) + ' % in noise · ' + (100 * S.clipped).toFixed(1) + ' % clipped' : 'your camera’s own frames, as delivered · exposure not known to the page';
    pb.foot.textContent = 'window ' + P.win + ' ms · ' + sp(S.inWin) + ' events · ' + sp(S.inWinNoise) + ' noise · ' + (100 * S.lost).toFixed(0) + ' % lost, refractory';
    pc.foot.textContent = 'last ' + SPAN + ' ms · dashed frame: the ' + P.win + ' ms window · drag to turn';
    pd.foot.textContent = S.psnr == null ? 'waiting for events' : 'PSNR ' + S.psnr.toFixed(1) + ' dB · mean error ' + S.mae.toFixed(2) + ' stops · against ' + (synth ? 'the true scene' : 'your camera’s frame');
    clock.textContent = synth ? 't ' + (S.now / 1000).toFixed(3) + ' s · image motion ' + Math.round(S.speedPx) + ' px/s (' + (S.speedPx / PX_M).toFixed(1) + ' m/s) · frame ' + S.frames : 't ' + (S.now / 1000).toFixed(1) + ' s · camera frames ' + S.frames;
    const quiet = S.started && S.quietMs >= 40; stillNote.hidden = !quiet;
    pb.note.hidden = !quiet; if (quiet) pb.note.textContent = 'No pixel has changed for ' + Math.round(S.quietMs) + ' ms. Only noise is left.';
    kv.replaceChildren(
      h('dt', null, 'Outside the frame sensor’s range'), h('dd.num', null, synth ? (100 * (S.crushed + S.clipped)).toFixed(0) + ' % of px' : 'not known'),
      h('dt', null, 'Outside the event pixel’s range'), h('dd.num', null, (100 * S.evOut).toFixed(1) + ' % of px'),
      h('dt', null, 'Longest wait for a frame'), h('dd.num', null, synth ? FRAME_MS.toFixed(1) + ' ms' : 'one camera frame'),
      h('dt', null, 'Smear in one exposure'), h('dd.num', null, synth ? blur.toFixed(1) + ' px' : 'not known'));
    drawChart();
  }
  let chW = 0, chH = 0, chDpr = 1; const chG = chart.getContext('2d');
  const chRo = new ResizeObserver(() => { const r = chart.getBoundingClientRect(); if (!r.width) return; chDpr = Math.min(2, devicePixelRatio || 1); chart.width = Math.round(r.width * chDpr); chart.height = Math.round(r.height * chDpr); chW = r.width; chH = r.height; drawChart(); }); chRo.observe(chart);
  function drawChart() {
    if (!chW) return; const g = chG; g.setTransform(chDpr, 0, 0, chDpr, 0, 0); g.clearRect(0, 0, chW, chH);
    const L = 60, Rr = 12, T = 8, B = 24, w = chW - L - Rr, hh = chH - T - B, yMin = 2, yMax = 9;        // log10 bytes per second: 100 B/s to 100 MB/s
    const Y = (b) => T + hh * (1 - (Math.log10(Math.max(b, 100)) - yMin) / (yMax - yMin));
    g.font = '500 10px ' + COL.mono; g.textBaseline = 'middle'; g.lineWidth = 1;
    [[1e3, '1 kB/s'], [1e5, '100 kB/s'], [1e7, '10 MB/s'], [1e9, '1 GB/s']].forEach(([v, t]) => { const y = Math.round(Y(v)) + 0.5; g.strokeStyle = COL.line; g.beginPath(); g.moveTo(L, y); g.lineTo(L + w, y); g.stroke(); g.fillStyle = COL.text3; g.textAlign = 'right'; g.fillText(t, L - 6, y); });
    g.textBaseline = 'alphabetic'; g.textAlign = 'center'; for (let s = 0; s <= 2; s += 0.5) { const x = Math.round(L + w * (1 - s / 2)) + 0.5; g.strokeStyle = COL.line2; g.beginPath(); g.moveTo(x, T + hh); g.lineTo(x, T + hh + 4); g.stroke(); g.fillStyle = COL.text3; g.fillText(s ? '−' + s.toFixed(1) : 'now', x, T + hh + 15); }
    g.textAlign = 'left'; g.fillText('s', L + w + 2, T + hh + 15);
    g.strokeStyle = COL.line2; g.strokeRect(L + 0.5, T + 0.5, w - 1, hh - 1);
    const fb = N * 30, yf = Math.round(Y(fb)) + 0.5; g.strokeStyle = COL.text2; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(L, yf); g.lineTo(L + w, yf); g.stroke(); g.setLineDash([]);
    g.fillStyle = COL.text2; g.font = '500 10px ' + COL.font; g.textAlign = 'left'; g.fillText('frame camera, ' + fmtBytes(fb), L + 6, yf - 5);
    const n = Math.min(200, S.histN); if (n > 1) { g.strokeStyle = COL.accent; g.lineWidth = 1.5; g.beginPath(); for (let k = 0; k < n; k++) { const v = S.hist[(S.histN - 1 - k) % 200] * BYTES_EV, x = L + w * (1 - k / 199), y = Y(v); k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
      const v0 = S.hist[(S.histN - 1) % 200] * BYTES_EV, y0 = Y(v0); g.fillStyle = COL.accent; g.fillRect(L + w - 3, y0 - 3, 6, 6); g.textAlign = 'right'; g.fillText('events', L + w - 8, y0 + (y0 < yf ? -7 : 13)); }
  }

  // ---------- controls that depend on each other ----------
  let before = null;
  function syncFreeze() { const frozen = !P.drone && !P.wave && !P.swing; freezeBtn.setAttribute('aria-pressed', String(frozen)); freezeBtn.lastChild.textContent = frozen ? 'Scene frozen: release' : 'Freeze the scene'; for (const k in checks) checks[k].input.checked = P[k]; }
  function setFrozen(on) { if (on) { before = { drone: P.drone, wave: P.wave, swing: P.swing }; P.drone = P.wave = P.swing = false; } else { const b = before && (before.drone || before.wave || before.swing) ? before : { drone: true, wave: true, swing: true }; P.drone = b.drone; P.wave = b.wave; P.swing = b.swing; } syncFreeze(); }
  function syncSource() {
    const cam = P.src === 'camera'; srcSeg.children[0].setAttribute('aria-pressed', String(!cam)); srcSeg.children[1].setAttribute('aria-pressed', String(cam));
    for (const k of ['expo', 'lux', 'speed']) { sliders[k].querySelector('input').disabled = cam; sliders[k].classList.toggle('vision-events-off', cam); }
    for (const k in checks) checks[k].input.disabled = cam; throwBtn.disabled = cam; freezeBtn.disabled = cam; [...rateSeg.children].forEach((b) => { b.disabled = cam; });
    pa.pane.querySelector('header span').textContent = cam ? 'Your camera, as it delivers frames' : 'One exposure, 30 times a second, 60 dB';
  }
  let drag = null;
  pc.canvas.style.cursor = 'grab'; pc.canvas.tabIndex = 0;
  pc.canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, yaw }; pc.canvas.setPointerCapture(e.pointerId); pc.canvas.style.cursor = 'grabbing'; });
  pc.canvas.addEventListener('pointermove', (e) => { if (!drag) return; yaw = Math.min(1.5, Math.max(0.12, drag.yaw + (e.clientX - drag.x) * 0.008)); if (!loop.running) draw(); });
  const endDrag = () => { drag = null; pc.canvas.style.cursor = 'grab'; }; pc.canvas.addEventListener('pointerup', endDrag); pc.canvas.addEventListener('pointercancel', endDrag);
  pc.canvas.addEventListener('keydown', (e) => { const d = e.key === 'ArrowLeft' ? -0.08 : e.key === 'ArrowRight' ? 0.08 : 0; if (!d) return; e.preventDefault(); yaw = Math.min(1.5, Math.max(0.12, yaw + d)); if (!loop.running) draw(); });

  // ---------- the loop ----------
  function draw() { if (!S.started) return; drawFrame(); drawEvents(); drawSpace(); drawRecon(); }
  let thrown = false;
  const loop = lab.loop((dt) => {
    if (P.src === 'synth') {
      S.simAcc += dt * 1000 * P.rate; let n = Math.floor(S.simAcc); S.simAcc -= n; if (n > 20) n = 20;
      for (let k = 0; k < n; k++) advance(1);
      if (!thrown && S.now > 120) { thrown = true; throwBall(); }
    } else cameraStep();
    draw(); paintText(false);
  });
  for (let k = 0; k < 40; k++) advance(1);                      // a first 40 ms so the page never opens on blank panes
  paintText(true);
  const api = {
    onShow() { loop.start(); },
    onHide() { loop.stop(); if (P.src === 'camera' || stream) useSynth(); },
    onPrefs() { readColours(); draw(); paintText(true); },
    _debug: { S, P, ball, sliders, advance, throwBall, setFrozen, draw, paintText },
  };
  el._events = api._debug;
  return api;
}

const FIELD = 'An event sensor would have to be on the drone, and HOUND has none: this is a concept. Airframe vibration makes every edge fire, the sensor is specialist hardware rather than a webcam part, and finding a person from events alone is still research. A survivor who lies still under a hovering drone makes no events at all; freeze the scene to see that. Whether the dark-scene advantage shown here survives real dust, rain and a real sensor’s noise is unknown.';
const FAILURE = '__FAILURE__';
