// Exhibit 04: pulse from pixels. Remote photoplethysmography (green channel and POS) and Eulerian video magnification,
// both computed in this page on a synthetic subject with a known pulse, or on the visitor's own camera.
const CSS = new URL('./pulse.css', import.meta.url).href;

const W = 320, H = 240;              // working frame, pixels
const FS = 30;                       // uniform rate the samples are resampled to, Hz
const WIN = 12, MIN_S = 8;           // analysis window and the least data before a number may be shown, seconds
const LO = 0.7, HI = 3.0;            // pulse band, Hz (42 to 180 per minute)
const NFFT = 4096;                   // zero-padded FFT length: bins are 0.44 per minute apart
const PEAK_HALF = 0.15;              // half width around the peak (and its first harmonic) counted as signal, Hz
const SQI_MIN = 3;                   // decibels; below this no number is shown
const POS_L = Math.round(1.6 * FS);  // POS sliding window: 1.6 s, as in the paper (32 frames at 20 per second)
const PBV = [0.33, 0.77, 0.53];      // relative pulse amplitude in R, G, B used for the synthetic skin
const DEPTH = 0.0078;                // times PBV: 0.6 % peak to peak in green
const FLICKER_HZ = 1.45;             // where the synthetic lamp flicker lands after aliasing: 87 per minute
const EW = 20, EH = 15;              // Gaussian pyramid level 4 of the 320 x 240 frame
const HIST_S = 60;
const DEF = { rate: 72, noise: 3, flicker: 0, motion: 0.3, alpha: 60 };

export async function create(el, ctx, lab, def) {
  const { h, icon } = ctx.kit;
  if (!document.querySelector('link[href="' + CSS + '"]')) document.head.append(h('link', { rel: 'stylesheet', href: CSS }));
  const { clamp, tok, dsp } = lab;
  const F = lab.frame(el, { n: def.n, title: def.title, tags: def.tags, lede: [
    'Each heartbeat pushes blood into the skin and changes its colour by less than one per cent. A camera can measure that, and this page amplifies it until you can see it.',
    'A demonstration, not a medical measurement.'] });

  // ------------------------------------------------------------------ state
  const P = { ...DEF };
  let source = 'synth', method = 'pos', stream = null, vfc = 0, camNew = false, camT = 0, lastCT = -1, camInfo = null;
  let roi = { x: 128, y: 71, w: 64, h: 24 };
  let buf = [], hist = [], A = null, lastFrameT = 0, lastAnalT = 0, lastUiT = 0, lastHistT = 0, phase = 0, synT = 0, frameMs = 0, skinFrac = 0, skinN = 0, lastMean = [0, 0, 0], dirty = true;

  // ------------------------------------------------------------------ synthetic subject
  const r0 = lab.rng(20261123);
  const NOISE = new Float32Array(1 << 18); for (let i = 0; i < NOISE.length; i++) NOISE[i] = lab.gauss(r0);
  const PULSE = (() => {                       // one beat: systolic peak, dicrotic notch, diastolic wave. Zero mean, 1 peak to peak.
    const n = 1024, p = new Float32Array(n), d = (a, b) => { let x = a - b; x -= Math.round(x); return x; }; let mn = 1e9, mx = -1e9, mean = 0;
    for (let i = 0; i < n; i++) { const f = i / n; p[i] = Math.exp(-0.5 * (d(f, 0.18) / 0.07) ** 2) + 0.42 * Math.exp(-0.5 * (d(f, 0.47) / 0.1) ** 2); mn = Math.min(mn, p[i]); mx = Math.max(mx, p[i]); mean += p[i] / n; }
    for (let i = 0; i < n; i++) p[i] = (p[i] - mean) / (mx - mn);
    return p;
  })();
  const pulseAt = (ph) => { const f = (ph - Math.floor(ph)) * 1024, i = f | 0, u = f - i; return PULSE[i] * (1 - u) + PULSE[(i + 1) & 1023] * u; };

  function drawSubject(g, mask) {
    const skin = (c) => (mask ? '#fff' : c), off = (c) => (mask ? '#000' : c);
    const head = () => { g.beginPath(); g.moveTo(160, 48); g.bezierCurveTo(197, 48, 209, 82, 206, 112); g.bezierCurveTo(204, 142, 186, 174, 160, 175); g.bezierCurveTo(134, 174, 116, 142, 114, 112); g.bezierCurveTo(111, 82, 123, 48, 160, 48); g.closePath(); };
    if (!mask) {
      // jacket and shirt
      const jg = g.createLinearGradient(40, 180, 280, 240); jg.addColorStop(0, '#465263'); jg.addColorStop(0.55, '#2d3540'); jg.addColorStop(1, '#1b2028');
      g.fillStyle = jg; g.beginPath(); g.moveTo(22, 240); g.bezierCurveTo(30, 204, 84, 196, 134, 186); g.lineTo(186, 186); g.bezierCurveTo(236, 196, 290, 204, 298, 240); g.closePath(); g.fill();
      g.fillStyle = '#8f9aa3'; g.beginPath(); g.moveTo(132, 187); g.quadraticCurveTo(160, 226, 188, 187); g.quadraticCurveTo(160, 199, 132, 187); g.fill();
      g.strokeStyle = 'rgba(10,12,16,0.5)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(134, 187); g.quadraticCurveTo(150, 214, 158, 240); g.moveTo(186, 187); g.quadraticCurveTo(170, 214, 162, 240); g.stroke();
    }
    // neck
    const ng = g.createLinearGradient(136, 0, 186, 0); ng.addColorStop(0, '#c08d70'); ng.addColorStop(0.45, '#b07d63'); ng.addColorStop(1, '#7c5341');
    g.fillStyle = skin(ng); g.beginPath(); g.moveTo(138, 150); g.lineTo(136, 190); g.quadraticCurveTo(160, 204, 184, 190); g.lineTo(182, 150); g.closePath(); g.fill();
    if (!mask) { g.save(); g.filter = 'blur(5px)'; g.fillStyle = 'rgba(48,24,18,0.62)'; g.beginPath(); g.ellipse(162, 172, 27, 11, 0, 0, 7); g.fill(); g.restore(); }
    // ears
    g.fillStyle = skin('#b58468'); g.beginPath(); g.ellipse(113, 116, 6, 12, -0.1, 0, 7); g.fill(); g.fillStyle = skin('#8a5d49'); g.beginPath(); g.ellipse(207, 116, 5.5, 12, 0.1, 0, 7); g.fill();
    // head, lit from the upper left
    const hg = g.createRadialGradient(140, 88, 6, 150, 104, 96); hg.addColorStop(0, '#edc2a3'); hg.addColorStop(0.42, '#d6a384'); hg.addColorStop(0.78, '#b07a60'); hg.addColorStop(1, '#8a5b47');
    g.fillStyle = skin(hg); head(); g.fill();
    if (!mask) {
      g.save(); head(); g.clip(); g.filter = 'blur(7px)';
      g.fillStyle = 'rgba(70,34,26,0.42)'; g.beginPath(); g.ellipse(203, 128, 16, 44, 0.08, 0, 7); g.fill();                 // far cheek falls into shadow
      g.fillStyle = 'rgba(70,34,26,0.30)'; g.beginPath(); g.ellipse(160, 178, 34, 9, 0, 0, 7); g.fill();                     // under the jaw
      g.fillStyle = 'rgba(206,104,92,0.20)'; g.beginPath(); g.ellipse(130, 132, 10, 8, 0, 0, 7); g.ellipse(189, 132, 9, 8, 0, 0, 7); g.fill();   // cheeks
      g.fillStyle = 'rgba(255,238,220,0.20)'; g.beginPath(); g.ellipse(146, 80, 18, 9, -0.2, 0, 7); g.fill();                 // forehead highlight
      g.fillStyle = 'rgba(64,32,26,0.34)'; g.beginPath(); g.ellipse(141, 107, 12, 6, 0, 0, 7); g.ellipse(180, 107, 12, 6, 0, 0, 7); g.fill();   // eye sockets
      g.restore();
    }
    // hair
    const hair = () => { g.beginPath(); g.moveTo(111, 112); g.bezierCurveTo(100, 62, 128, 30, 162, 32); g.bezierCurveTo(198, 32, 220, 64, 209, 112); g.bezierCurveTo(207, 92, 200, 74, 188, 64); g.bezierCurveTo(170, 70, 142, 69, 130, 62); g.bezierCurveTo(120, 74, 114, 92, 111, 112); g.closePath(); };
    if (mask) { g.fillStyle = '#000'; hair(); g.fill(); g.lineWidth = 3; g.strokeStyle = '#000'; g.stroke(); }
    else { const xg = g.createLinearGradient(110, 30, 210, 100); xg.addColorStop(0, '#4a372c'); xg.addColorStop(0.5, '#2a1f19'); xg.addColorStop(1, '#17110e'); g.fillStyle = xg; hair(); g.fill(); }
    // brows, eyes, nose, mouth
    g.strokeStyle = off('#2b1f19'); g.lineCap = 'round'; g.lineWidth = mask ? 6 : 2.8;
    g.beginPath(); g.moveTo(130, 99); g.quadraticCurveTo(141, 94.5, 152, 98.5); g.moveTo(169, 98.5); g.quadraticCurveTo(180, 94.5, 191, 99); g.stroke();
    for (const ex of [141, 180]) {
      g.fillStyle = off('#e6ddd4'); g.beginPath(); g.ellipse(ex, 108, mask ? 10 : 7.6, mask ? 6 : 3.3, 0, 0, 7); g.fill();
      if (!mask) {
        g.fillStyle = '#35251e'; g.beginPath(); g.arc(ex + 0.5, 108, 3.2, 0, 7); g.fill(); g.fillStyle = '#0b0807'; g.beginPath(); g.arc(ex + 0.5, 108, 1.4, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(ex - 1, 106.4, 1.2, 1.2);
        g.strokeStyle = 'rgba(40,22,18,0.85)'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(ex - 8, 108.4); g.quadraticCurveTo(ex, 103.2, ex + 8, 108.4); g.stroke();
      }
    }
    if (!mask) {
      g.save(); g.filter = 'blur(1.6px)'; g.strokeStyle = 'rgba(84,44,34,0.5)'; g.lineWidth = 3; g.beginPath(); g.moveTo(166, 106); g.quadraticCurveTo(170, 124, 171, 135); g.stroke();
      g.fillStyle = 'rgba(255,236,220,0.28)'; g.beginPath(); g.ellipse(158, 130, 4, 5, 0, 0, 7); g.fill(); g.restore();
      g.strokeStyle = 'rgba(92,48,38,0.55)'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(150.5, 136.5); g.quadraticCurveTo(152, 141.5, 157, 140.5); g.quadraticCurveTo(160.5, 143, 164, 140.5); g.quadraticCurveTo(169, 141.5, 170.5, 136.5); g.stroke();
    }
    g.fillStyle = off('rgba(52,24,20,0.72)'); g.beginPath(); g.ellipse(154, 138.5, mask ? 4 : 2.6, mask ? 3 : 1.5, 0.2, 0, 7); g.ellipse(167, 138.5, mask ? 4 : 2.6, mask ? 3 : 1.5, -0.2, 0, 7); g.fill();
    g.fillStyle = off('#a9675c'); g.beginPath(); g.moveTo(146, 153); g.quadraticCurveTo(160, 148.5, 174, 153); g.quadraticCurveTo(160, mask ? 164 : 160.5, 146, 153); g.fill();
    if (!mask) { g.strokeStyle = 'rgba(88,40,36,0.9)'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(146, 153); g.quadraticCurveTo(160, 154.6, 174, 153); g.stroke(); }
  }
  const SUB = (() => {
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return [c, c.getContext('2d', { willReadFrequently: true })]; };
    const [, gb] = mk(), [, gf] = mk(), [, gm] = mk();
    // the room: a wall lit from a window on the left, a door frame, a shelf line
    const bgG = gb.createLinearGradient(0, 0, W, H); bgG.addColorStop(0, '#59616a'); bgG.addColorStop(0.5, '#3b424b'); bgG.addColorStop(1, '#20252c'); gb.fillStyle = bgG; gb.fillRect(0, 0, W, H);
    gb.save(); gb.filter = 'blur(22px)'; gb.fillStyle = 'rgba(214,222,226,0.34)'; gb.beginPath(); gb.ellipse(34, 52, 70, 90, 0.3, 0, 7); gb.fill(); gb.fillStyle = 'rgba(8,10,14,0.5)'; gb.beginPath(); gb.ellipse(300, 210, 90, 80, 0, 0, 7); gb.fill(); gb.restore();
    gb.fillStyle = 'rgba(14,17,22,0.55)'; gb.fillRect(246, 0, 5, H); gb.fillStyle = 'rgba(255,255,255,0.05)'; gb.fillRect(251, 0, 1.5, H); gb.fillStyle = 'rgba(14,17,22,0.4)'; gb.fillRect(0, 150, 246, 2); gb.fillStyle = 'rgba(255,255,255,0.045)'; gb.fillRect(0, 152, 246, 1);
    gb.save(); gb.filter = 'blur(14px)'; gb.fillStyle = 'rgba(8,10,14,0.42)'; gb.beginPath(); gb.ellipse(196, 150, 60, 86, 0, 0, 7); gb.fill(); gb.restore();   // the subject's shadow on the wall
    drawSubject(gf, false); gm.fillStyle = '#000'; gm.fillRect(0, 0, W, H); gm.filter = 'blur(0.7px)'; drawSubject(gm, true);
    const n = W * H, b = gb.getImageData(0, 0, W, H).data, f = gf.getImageData(0, 0, W, H).data, m = gm.getImageData(0, 0, W, H).data;
    const S = { bg: new Float32Array(n * 3), fr: new Float32Array(n), fgn: new Float32Array(n), fb: new Float32Array(n), fa: new Float32Array(n), mk: new Float32Array(n) };
    for (let i = 0; i < n; i++) { const a = f[i * 4 + 3] / 255; S.bg[i * 3] = b[i * 4]; S.bg[i * 3 + 1] = b[i * 4 + 1]; S.bg[i * 3 + 2] = b[i * 4 + 2]; S.fr[i] = f[i * 4] * a; S.fgn[i] = f[i * 4 + 1] * a; S.fb[i] = f[i * 4 + 2] * a; S.fa[i] = a; S.mk[i] = (m[i * 4] / 255) * a; }
    return S;
  })();
  const r1 = lab.rng(77); let jx = 0, jy = 0;
  const XI0 = new Int32Array(W), XI1 = new Int32Array(W);
  function renderSynth(out, t, dt) {
    const hr = P.rate * (1 + 0.025 * Math.sin(2 * Math.PI * 0.25 * t));                      // a little breathing-linked variation
    phase += hr / 60 * dt; const pv = pulseAt(phase);
    const L = 1 + 0.015 * Math.sin(2 * Math.PI * 0.07 * t) + 0.008 * Math.sin(2 * Math.PI * 0.031 * t + 1) + P.flicker / 100 * Math.sin(2 * Math.PI * FLICKER_HZ * t);
    const th = 6 * dt, sg = Math.sqrt(2 * th); jx += -jx * th + sg * lab.gauss(r1); jy += -jy * th + sg * lab.gauss(r1);
    const dx = P.motion * (0.7 * Math.sin(2 * Math.PI * 0.23 * t) + 0.35 * Math.sin(2 * Math.PI * 0.61 * t + 1.3) + 0.45 * jx), dy = P.motion * (0.5 * Math.sin(2 * Math.PI * 0.17 * t + 0.6) + 0.3 * Math.sin(2 * Math.PI * 0.53 * t) + 0.45 * jy);
    const sx = -dx, sy = -dy, ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy, w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    for (let x = 0; x < W; x++) { XI0[x] = clamp(x + ix, 0, W - 1); XI1[x] = clamp(x + ix + 1, 0, W - 1); }
    const kr = DEPTH * PBV[0] * pv, kg = DEPTH * PBV[1] * pv, kb = DEPTH * PBV[2] * pv, sig = P.noise, { bg, fr, fgn, fb, fa, mk } = SUB;
    let ni = (r1() * NOISE.length) | 0, o = 0, bi = 0; const NM = NOISE.length - 1;
    for (let y = 0; y < H; y++) {
      const ya = clamp(y + iy, 0, H - 1) * W, yb = clamp(y + iy + 1, 0, H - 1) * W;
      for (let x = 0; x < W; x++, o += 4, bi += 3) {
        const a = ya + XI0[x], b = ya + XI1[x], c = yb + XI0[x], d = yb + XI1[x];
        const al = w00 * fa[a] + w10 * fa[b] + w01 * fa[c] + w11 * fa[d], m = w00 * mk[a] + w10 * mk[b] + w01 * mk[c] + w11 * mk[d], ia = 1 - al;
        out[o] = (bg[bi] * ia + w00 * fr[a] + w10 * fr[b] + w01 * fr[c] + w11 * fr[d]) * L * (1 - m * kr) + sig * NOISE[ni++ & NM] + 0.5;
        out[o + 1] = (bg[bi + 1] * ia + w00 * fgn[a] + w10 * fgn[b] + w01 * fgn[c] + w11 * fgn[d]) * L * (1 - m * kg) + sig * NOISE[ni++ & NM] + 0.5;
        out[o + 2] = (bg[bi + 2] * ia + w00 * fb[a] + w10 * fb[b] + w01 * fb[c] + w11 * fb[d]) * L * (1 - m * kb) + sig * NOISE[ni++ & NM] + 0.5;
        out[o + 3] = 255;
      }
    }
    return pv;
  }

  // ------------------------------------------------------------------ frame, region, Eulerian magnification
  const mkC = (w, hh) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; return c; };
  const srcC = mkC(W, H), srcG = srcC.getContext('2d', { willReadFrequently: true }), magC = mkC(W, H), magG = magC.getContext('2d');
  let img = srcG.createImageData(W, H); const magImg = magG.createImageData(W, H);
  let maskC = mkC(roi.w, roi.h), maskImg = null;
  const video = h('video', { muted: true, playsInline: true, hidden: true }); video.setAttribute('playsinline', '');

  // Skin test in YCbCr (ITU-R BT.601): Cb 77 to 127, Cr 133 to 173, and not nearly black. Returns the mean R, G, B of the skin pixels in the box.
  function regionMean(d) {
    const { x, y, w, h: rh } = roi; if (maskC.width !== w || maskC.height !== rh || !maskImg) { maskC.width = w; maskC.height = rh; maskImg = maskC.getContext('2d').createImageData(w, rh); }
    const md = maskImg.data; let sr = 0, sgn = 0, sb = 0, n = 0, k = 0;
    for (let j = 0; j < rh; j++) for (let i = 0, o = ((y + j) * W + x) * 4; i < w; i++, o += 4, k += 4) {
      const r = d[o], g = d[o + 1], b = d[o + 2], Y = 0.299 * r + 0.587 * g + 0.114 * b, cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && Y > 40) { sr += r; sgn += g; sb += b; n++; md[k + 3] = 0; } else { md[k] = 8; md[k + 1] = 12; md[k + 2] = 18; md[k + 3] = 178; }
    }
    maskC.getContext('2d').putImageData(maskImg, 0, 0);
    skinN = n; skinFrac = n / (w * rh);
    return n ? [sr / n, sgn / n, sb / n] : null;
  }

  // Gaussian pyramid: blur with the 5-tap binomial kernel [1 4 6 4 1] / 16 and keep every second pixel, four times: 320 x 240 to 20 x 15.
  const LV = [[160, 120], [80, 60], [40, 30], [20, 15]].map(([w, hh], i) => ({ w, h: hh, tmp: new Float32Array(w * (i ? hh * 2 : H) * 3), out: new Float32Array(w * hh * 3) }));
  function reduce(src, sw, sh, stride, L) {
    const { w, h: hh, tmp, out } = L, K = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
    for (let y = 0; y < sh; y++) for (let x = 0; x < w; x++) { let a = 0, b = 0, c = 0; for (let k = -2; k <= 2; k++) { const o = (y * sw + clamp(2 * x + k, 0, sw - 1)) * stride, wk = K[k + 2]; a += wk * src[o]; b += wk * src[o + 1]; c += wk * src[o + 2]; } const t = (y * w + x) * 3; tmp[t] = a; tmp[t + 1] = b; tmp[t + 2] = c; }
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { let a = 0, b = 0, c = 0; for (let k = -2; k <= 2; k++) { const o = (clamp(2 * y + k, 0, sh - 1) * w + x) * 3, wk = K[k + 2]; a += wk * tmp[o]; b += wk * tmp[o + 1]; c += wk * tmp[o + 2]; } const t = (y * w + x) * 3; out[t] = a; out[t + 1] = b; out[t + 2] = c; }
    return out;
  }
  const EN = EW * EH * 3, lp1 = new Float32Array(EN), lp2 = new Float32Array(EN), band = new Float32Array(EN); let evmInit = false;
  const UX = new Int32Array(W), UF = new Float32Array(W), UY = new Int32Array(H), VF = new Float32Array(H);
  for (let x = 0; x < W; x++) { const s = clamp((x + 0.5) / 16 - 0.5, 0, EW - 1), i = Math.min(EW - 2, Math.floor(s)); UX[x] = i; UF[x] = s - i; }
  for (let y = 0; y < H; y++) { const s = clamp((y + 0.5) / 16 - 0.5, 0, EH - 1), i = Math.min(EH - 2, Math.floor(s)); UY[y] = i; VF[y] = s - i; }
  // Eulerian magnification (Wu et al. 2012, real-time variant): per pixel of the pyramid level, two first-order low-pass filters
  // with cut-offs HI and LO; their difference is the pass band. It is multiplied by alpha, upsampled and added back.
  function magnify(d, dt) {
    let lv = reduce(d, W, H, 4, LV[0]); for (let i = 1; i < 4; i++) lv = reduce(lv, LV[i - 1].w, LV[i - 1].h, 3, LV[i]);
    if (!evmInit) { lp1.set(lv); lp2.set(lv); evmInit = true; }
    const a1 = 1 - Math.exp(-2 * Math.PI * HI * dt), a2 = 1 - Math.exp(-2 * Math.PI * LO * dt), al = P.alpha;
    for (let i = 0; i < EN; i++) { lp1[i] += a1 * (lv[i] - lp1[i]); lp2[i] += a2 * (lv[i] - lp2[i]); band[i] = al * (lp1[i] - lp2[i]); }
    const o = magImg.data;
    for (let y = 0, p = 0; y < H; y++) {
      const r0w = UY[y] * EW, r1w = r0w + EW, v = VF[y], v0 = 1 - v;
      for (let x = 0; x < W; x++, p += 4) {
        const u = UF[x], u0 = 1 - u, a = (r0w + UX[x]) * 3, b = a + 3, c = (r1w + UX[x]) * 3, e = c + 3, wa = u0 * v0, wb = u * v0, wc = u0 * v, we = u * v;
        o[p] = d[p] + wa * band[a] + wb * band[b] + wc * band[c] + we * band[e] + 0.5;
        o[p + 1] = d[p + 1] + wa * band[a + 1] + wb * band[b + 1] + wc * band[c + 1] + we * band[e + 1] + 0.5;
        o[p + 2] = d[p + 2] + wa * band[a + 2] + wb * band[b + 2] + wc * band[c + 2] + we * band[e + 2] + 0.5;
        o[p + 3] = 255;
      }
    }
    magG.putImageData(magImg, 0, 0);
  }

  // ------------------------------------------------------------------ the signal chain
  function resetSignal() { buf = []; A = null; dirty = true; }
  const mean = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s / (x.length || 1); };
  const std = (x) => { const m = mean(x); let s = 0; for (let i = 0; i < x.length; i++) s += (x[i] - m) ** 2; return Math.sqrt(s / (x.length || 1)); };
  // Zero-phase band-pass: the second-order Butterworth pair run forwards then backwards, on a signal padded by reflection so the ends do not ring.
  function zeroPhase(x) {
    const n = x.length, pad = Math.min(n - 1, 2 * FS), m = n + 2 * pad, e = new Float64Array(m), f = dsp.bandpass(FS, LO, HI);
    for (let i = 0; i < pad; i++) { e[i] = 2 * x[0] - x[pad - i]; e[pad + n + i] = 2 * x[n - 1] - x[n - 2 - i]; }
    for (let i = 0; i < n; i++) e[pad + i] = x[i];
    for (let i = 0; i < m; i++) e[i] = f(e[i]); f.reset(); for (let i = m - 1; i >= 0; i--) e[i] = f(e[i]);
    return e.subarray(pad, pad + n);
  }
  // POS, algorithm 1 of Wang, den Brinker, Stuijk and de Haan (2017): temporal normalisation in a sliding window, projection onto the
  // plane orthogonal to the skin tone, alpha tuning, overlap-add.
  function pos(R, G, B) {
    const n = R.length, Hh = new Float64Array(n), l = POS_L, s1 = new Float64Array(l), s2 = new Float64Array(l);
    for (let e = l - 1; e < n; e++) {
      const m = e - l + 1; let mr = 0, mg = 0, mb = 0;
      for (let i = m; i <= e; i++) { mr += R[i]; mg += G[i]; mb += B[i]; } mr /= l; mg /= l; mb /= l;
      for (let i = 0; i < l; i++) { const r = R[m + i] / mr, g = G[m + i] / mg, b = B[m + i] / mb; s1[i] = g - b; s2[i] = -2 * r + g + b; }
      const sd2 = std(s2), al = sd2 > 1e-12 ? std(s1) / sd2 : 0; let hm = 0;
      for (let i = 0; i < l; i++) { s1[i] += al * s2[i]; hm += s1[i]; } hm /= l;
      for (let i = 0; i < l; i++) Hh[m + i] += s1[i] - hm;
    }
    return Hh;
  }
  function estimate(x) {
    const y = zeroPhase(dsp.detrend(x, 2 * FS)), { power, df } = dsp.spectrum(y, FS, NFFT);
    const k0 = Math.ceil(LO / df), k1 = Math.floor(HI / df); let kp = k0, band = 0;
    for (let k = k0; k <= k1; k++) { band += power[k]; if (power[k] > power[kp]) kp = k; }
    let f = kp * df;
    if (kp > k0 && kp < k1) { const a = power[kp - 1], b = power[kp], c = power[kp + 1], den = a - 2 * b + c; if (den < 0) f = (kp + 0.5 * (a - c) / den) * df; }   // parabola through the three bins around the peak
    let sig = 0; for (let k = k0; k <= k1; k++) { const fk = k * df; if (Math.abs(fk - f) <= PEAK_HALF || Math.abs(fk - 2 * f) <= PEAK_HALF) sig += power[k]; }
    const rest = band - sig, sqi = band > 0 ? 10 * Math.log10(sig / Math.max(rest, band * 1e-6)) : -99, sd = std(y) || 1;
    return { y, sd, power, df, peak: power[kp] || 1, bpm: f * 60, sqi };
  }
  function analyse() {
    const n0 = buf.length; if (n0 < 8) return null;
    const t1 = buf[n0 - 1].t, span = Math.min(WIN, t1 - buf[0].t), n = Math.floor(span * FS); if (n < 2 * FS) return { span, short: true };
    const R = new Float64Array(n), G = new Float64Array(n), B = new Float64Array(n), T = new Float64Array(n); let j = 0, ph0 = 0;
    for (let i = 0; i < n; i++) {                                     // linear interpolation of the true timestamps onto a uniform 30 Hz grid
      const t = t1 - (n - 1 - i) / FS; while (j < n0 - 2 && buf[j + 1].t < t) j++;
      const a = buf[j], b = buf[j + 1], u = clamp((t - a.t) / ((b.t - a.t) || 1), 0, 1);
      R[i] = a.r + (b.r - a.r) * u; G[i] = a.g + (b.g - a.g) * u; B[i] = a.b + (b.b - a.b) * u; T[i] = a.p + (b.p - a.p) * u; if (!i) ph0 = a.ph + (b.ph - a.ph) * u;
    }
    const mr = mean(R), mg = mean(G), mb = mean(B), gx = new Float64Array(n), hp = pos(R, G, B), px = new Float64Array(n);
    for (let i = 0; i < n; i++) { gx[i] = -(G[i] / mg - 1); px[i] = -hp[i]; R[i] = (R[i] / mr - 1) * 100; G[i] = (G[i] / mg - 1) * 100; B[i] = (B[i] / mb - 1) * 100; }   // minus: more blood, less light back
    const out = { span, n, t1, R, G, B, T, green: estimate(gx), pos: estimate(px), fps: (n0 - 1) / (t1 - buf[0].t) };
    out.truth = source === 'synth' ? (buf[n0 - 1].ph - ph0) / ((n - 1) / FS) * 60 : null;
    for (const k of ['green', 'pos']) out[k].ok = span >= MIN_S && out[k].sqi >= SQI_MIN;
    return out;
  }

  // ------------------------------------------------------------------ stage
  const stage = F.stage; stage.classList.add('vision-pulse-stage');
  const srcState = h('span.vision-pulse-src'), useBtn = h('button.btn.btn-primary', { onclick: startCamera }, icon('camera'), 'Use my camera'), stopBtn = h('button.btn', { hidden: true, onclick: () => stopCamera('Camera stopped. Back on the synthetic subject.') }, icon('stop'), 'Stop camera');
  const mBtn = (id, text, tip) => h('button', { 'aria-pressed': String(method === id), 'data-m': id, title: tip, onclick: () => setMethod(id) }, text);
  const methodSeg = h('div.seg', { role: 'group', 'aria-label': 'Method' }, mBtn('green', 'Green channel', 'Verkruysse and others, 2008: the green channel alone'), mBtn('pos', 'POS chrominance', 'Wang and others, 2017: plane orthogonal to skin'));
  const bar = h('div.vision-stagebar', null, srcState, h('span.vision-pulse-grow'), h('span.vision-pulse-lbl', null, 'Method'), methodSeg, h('span.vision-pulse-sep'), stopBtn, useBtn);
  const cvA = h('canvas', { tabindex: 0, role: 'img', 'aria-label': 'Camera view with the skin region box. Drag the box, or use the arrow keys; hold Shift to resize.' }), cvB = h('canvas', { role: 'img', 'aria-label': 'The same view with the colour change amplified' });
  const bigN = h('b.num', null, '–'), bigU = h('span', null, 'per minute'), bigS = h('small', null, ''), big = h('div.vision-pulse-big', { 'data-state': 'collect', 'aria-live': 'polite' }, h('div', null, bigN, bigU), bigS);
  const pillB = h('span.vision-pill');
  const capA = h('span'), capB = h('span');
  const view = (title, cap, cv, ...hud) => h('figure.vision-pulse-view', null, h('figcaption', null, h('b', null, title), cap), h('div.vision-pulse-screen', null, cv, ...hud));
  const views = h('div.vision-pulse-views', null,
    view('What the camera sees', capA, cvA, h('div.vision-hud.tl', null, big)),
    view('Colour change amplified', capB, cvB, h('div.vision-hud.tl', null, pillB)));
  const NODES = [['Skin region', 'YCbCr mask in the box'], ['Mean R, G, B', 'one number per channel, per frame'], ['Resample', 'true timestamps to a uniform rate'], ['Method', 'three channels to one pulse signal'], ['Filter', 'detrend, then band-pass: keep 42 to 180 per minute'], ['Spectral peak', 'zero-padded FFT, parabolic fit'], ['Quality', 'peak power over the rest of the band']];
  const nodeV = NODES.map(() => h('span.num', null, '–'));
  const chain = h('ol.vision-pulse-chain', { 'aria-label': 'Signal chain, left to right' }, NODES.map(([a, tip], i) => h('li', { title: tip }, h('i.num', null, String(i + 1)), h('span', null, a), nodeV[i])));
  const mkChart = (key) => { const t = h('figcaption.vision-chart-title'), c = h('canvas', { role: 'img' }); return { key, t, c, el: h('figure.vision-pulse-chart', null, t, h('div.vision-pulse-plot', null, c)) }; };
  const CH = { raw: mkChart('raw'), wave: mkChart('wave'), spec: mkChart('spec'), hist: mkChart('hist') };
  const charts = h('div.vision-pulse-charts', null, CH.raw.el, CH.wave.el, CH.spec.el, CH.hist.el);
  const footL = h('span.num'), saveBtn = h('button.btn.btn-ghost.btn-sm', { title: 'Save the samples in memory as a CSV file: time, mean R, G, B of the skin region', onclick: saveCsv }, icon('save', 14), 'Save trace');
  stage.append(bar, views, chain, charts, h('div.vision-stagefoot', null, footL, h('span.vision-pulse-grow'), saveBtn), video);

  // ------------------------------------------------------------------ side column
  const rdEst = lab.readout('Estimated'), rdTrue = lab.readout('True, simulated'), rdErr = lab.readout('Error');
  const stateEl = h('span.status.off', null, 'Starting');
  const meter = h('div.meter', { role: 'meter', 'aria-label': 'Signal quality', 'aria-valuemin': -6, 'aria-valuemax': 18 }), meterWrap = h('span.meter-wrap', null, meter), meterV = h('span', null, '–');
  const qLo = -6, qHi = 18; meterWrap.style.setProperty('--mark', String((SQI_MIN - qLo) / (qHi - qLo)));
  const cmp = {}; const cmpRow = (id, name) => { const c = { rate: h('td.num', null, '–'), err: h('td.num', null, '–'), q: h('td.num', null, '–') }; cmp[id] = c; c.tr = h('tr', { 'data-m': id, onclick: () => setMethod(id) }, h('th', { scope: 'row' }, h('i'), name), c.rate, c.err, c.q); return c.tr; };
  const cmpTable = h('table.vision-pulse-cmp', null, h('thead', null, h('tr', null, h('th', null, 'Both methods, same frames'), h('th.num', null, 'per min'), h('th.num', null, 'error'), h('th.num', null, 'quality'))), h('tbody', null, cmpRow('green', 'Green channel'), cmpRow('pos', 'POS chrominance')));
  F.section('Reading, beats per minute', h('div.vision-readouts', null, rdEst.el, rdTrue.el, rdErr.el), stateEl,
    h('div.meter-row', null, h('span', null, 'Signal quality'), meterWrap, meterV), cmpTable,
    h('p.vision-pulse-fine', null, 'Signal quality is the spectral power within ' + PEAK_HALF + ' Hz of the peak and of its first harmonic, divided by the rest of the 0.7 to 3 Hz band, in decibels. Below ' + SQI_MIN + ' dB, or with less than ' + MIN_S + ' s of data, no number is shown.'));

  const sl = {
    rate: lab.slider({ label: 'True pulse rate', min: 45, max: 170, step: 1, value: P.rate, fmt: (v) => v + ' per min', onInput: (v) => { P.rate = v; } }),
    noise: lab.slider({ label: 'Sensor noise, per pixel', min: 0, max: 40, step: 1, value: P.noise, fmt: (v) => v + ' of 255', title: 'Standard deviation of the noise added to every pixel, in 8-bit levels.', onInput: (v) => { P.noise = v; } }),
    flicker: lab.slider({ label: 'Light flicker at 87 per min', min: 0, max: 3, step: 0.1, value: P.flicker, fmt: (v) => v.toFixed(1) + ' %', title: 'A lamp whose flicker aliases to ' + FLICKER_HZ + ' Hz at this frame rate. It changes brightness, not colour.', onInput: (v) => { P.flicker = v; } }),
    motion: lab.slider({ label: 'Head motion', min: 0, max: 6, step: 0.1, value: P.motion, fmt: (v) => v.toFixed(1) + ' px', title: 'Sway and tremor of the subject, in pixels of the 320 pixel wide frame.', onInput: (v) => { P.motion = v; } }),
  };
  const resetBtn = h('button.btn.btn-sm', { onclick: () => { for (const k of ['rate', 'noise', 'flicker', 'motion']) { P[k] = DEF[k]; sl[k].set(DEF[k]); } } }, icon('reset', 14), 'Reset the subject');
  const synSec = F.section('Synthetic subject', h('p', null, 'A drawn face whose skin changes colour by 0.6 % in green with each beat. Its rate is known, so the error is exact. Make the conditions worse and watch the estimate fail.'), sl.rate, sl.noise, sl.flicker, sl.motion, h('div', null, resetBtn));
  synSec.firstChild.append(h('span.tag.tag-sim', { title: 'Drawn and animated in this page. Not a recording of a person.' }, 'Synthetic'));
  const camKv = h('dl.kv.num');
  const camSec = F.section('Your camera', h('p', null, 'Sit still, face a window or a lamp, and drag the box onto your forehead or a cheek. Frames are processed in this page and never leave this computer. There is no true rate to compare with, so no error is shown.'), camKv);
  camSec.firstChild.append(h('span.status.person.live', null, 'Camera on')); camSec.hidden = true; synSec.classList.add('vision-pulse-sec'); camSec.classList.add('vision-pulse-sec');

  const slA = lab.slider({ label: 'Amplification', min: 0, max: 150, step: 1, value: P.alpha, fmt: (v) => '× ' + v, onInput: (v) => { P.alpha = v; paintLabels(); } });
  F.section('Magnification', slA, h('dl.kv.num', null,
    h('dt', null, 'Pass band'), h('dd', null, LO.toFixed(1) + ' to ' + HI.toFixed(1) + ' Hz'),
    h('dt', null, 'Temporal filter'), h('dd', null, 'two IIR low-passes, subtracted'),
    h('dt', null, 'Spatial level'), h('dd', null, 'Gaussian pyramid 4 · ' + EW + ' × ' + EH)),
    h('p.vision-pulse-fine', null, 'Every pixel of a blurred, 16 times smaller copy of the video is filtered in time, multiplied and added back. Whatever changes at pulse rates is amplified, including noise, flicker and motion.'));

  F.section('What this is not',
    h('div.note.warn', null, icon('alert'), h('div', null, h('b', null, 'Not a medical measurement. '), 'This is a demonstration, not a diagnostic device. Do not use the number for any decision about health.')),
    h('p', null, 'HOUND does not do this. Its webcam has not been evaluated for it, and none of this has been tested on the rover. HOUND’s own tests found breathing-rate estimates unreliable, so vital signs are not presented as a HOUND capability. From a rover camera in dust it would take:'),
    h('ul.vision-pulse-needs', null, ['enough light on bare skin', 'a steady camera, or motion compensation', 'tens of pixels of skin across the region', 'a global-shutter camera at a known frame rate', 'skin not covered in dust or mud'].map((t) => h('li', null, t))));

  F.dossier({
    research: [
      { title: 'For heart rate assessments from drone footage in disaster scenarios', who: 'Bioengineering', year: '2023', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10045207/', note: 'Pulse from a drone camera, with its limits.' },
      { title: 'Remote plethysmographic imaging using ambient light', who: 'Verkruysse, Svaasand, Nelson, Optics Express 16(26)', year: 2008, url: 'https://doi.org/10.1364/OE.16.021434', note: 'The pulse read from an ordinary colour camera in daylight, strongest in green. The green method here.' },
      { title: 'Robust pulse rate from chrominance-based rPPG', who: 'de Haan, Jeanne, IEEE Transactions on Biomedical Engineering 60(10)', year: 2013, url: 'https://doi.org/10.1109/TBME.2013.2266196', note: 'Colour-difference signals that cancel brightness changes. The quality measure here follows its signal-to-noise ratio.' },
      { title: 'Algorithmic principles of remote PPG', who: 'Wang, den Brinker, Stuijk, de Haan, IEEE Transactions on Biomedical Engineering 64(7)', year: 2017, url: 'https://doi.org/10.1109/TBME.2016.2609282', note: 'The plane-orthogonal-to-skin (POS) method, implemented here from its algorithm 1.' },
      { title: 'Eulerian video magnification for revealing subtle changes in the world', who: 'Wu, Rubinstein, Shih, Guttag, Durand, Freeman, MIT CSAIL, ACM Transactions on Graphics 31(4)', year: 2012, url: 'https://people.csail.mit.edu/mrub/evm/', note: 'The magnified view, using the paper’s two low-pass filter variant for live video.' },
    ],
    field: FIELD, failure: FAILURE,
  });

  // ------------------------------------------------------------------ drawing
  const fit = (c) => { const r = c.parentElement.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1), w = Math.max(1, Math.round(r.width)), hh = Math.max(1, Math.round(r.height)); if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); } const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh); return { g, w, h: hh }; };
  const mono = (px = 10) => '500 ' + px + 'px ' + tok('--mono'), sans = (px = 11, wt = 500) => wt + ' ' + px + 'px ' + tok('--font');
  const mColor = (m) => tok(m === 'pos' ? '--accent' : '--ok'), mName = (m) => (m === 'pos' ? 'POS' : 'Green');
  let rectA = { x: 0, y: 0, s: 1 };
  function contain(w, hh) { const s = Math.min(w / W, hh / H); return { x: Math.round((w - W * s) / 2), y: Math.round((hh - H * s) / 2), s }; }
  function drawViews() {
    { // original, with the region box and the live trace
      const { g, w, h: hh } = fit(cvA), r = contain(w, hh); rectA = r; g.imageSmoothingQuality = 'high'; g.drawImage(srcC, r.x, r.y, W * r.s, H * r.s);
      const bx = r.x + roi.x * r.s, by = r.y + roi.y * r.s, bw = roi.w * r.s, bh = roi.h * r.s;
      g.imageSmoothingEnabled = false; g.drawImage(maskC, bx, by, bw, bh); g.imageSmoothingEnabled = true;
      g.lineWidth = 1; g.strokeStyle = 'rgba(6,8,10,0.7)'; g.strokeRect(Math.round(bx) - 0.5, Math.round(by) - 0.5, Math.round(bw) + 2, Math.round(bh) + 2);
      g.strokeStyle = tok('--text'); g.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.round(bw), Math.round(bh));
      g.lineWidth = 2; g.beginPath(); const L = 7; for (const [cx, cy, sx, sy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]) { g.moveTo(cx + sx * L, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + sy * L); } g.stroke();
      g.fillStyle = tok('--text'); g.fillRect(bx + bw - 3, by + bh - 3, 6, 6);
      const lab1 = 'skin region  ' + roi.w + ' × ' + roi.h + ' px  ' + Math.round(skinFrac * 100) + ' % skin'; g.font = mono(10); const tw = g.measureText(lab1).width, ly = by > r.y + 24 ? by - 8 : by + bh + 16, lx = clamp(bx, r.x + 4, r.x + W * r.s - tw - 12);
      g.fillStyle = 'rgba(6,8,10,0.72)'; g.fillRect(lx - 1, ly - 11, tw + 10, 15); g.fillStyle = tok('--text'); g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(lab1, lx + 4, ly);
      // thin live trace along the bottom: the last 6 s of the filtered pulse wave
      const th = Math.max(34, Math.round(hh * 0.15)), ty = r.y + H * r.s - th, fw = W * r.s;
      const sh = g.createLinearGradient(0, ty - 10, 0, ty + th); sh.addColorStop(0, 'rgba(6,8,10,0)'); sh.addColorStop(0.35, 'rgba(6,8,10,0.66)'); sh.addColorStop(1, 'rgba(6,8,10,0.86)'); g.fillStyle = sh; g.fillRect(r.x, ty - 10, fw, th + 10);
      const m = A && !A.short ? A[method] : null; g.font = mono(10); g.fillStyle = tok('--text-2'); g.fillText('filtered pulse wave, last 6 s', r.x + 8, ty + 8);
      if (m) {
        const n = Math.min(m.y.length, 6 * FS), o = m.y.length - n, x0 = r.x + fw - (6 * FS - 1) / (6 * FS - 1) * fw; g.beginPath();
        for (let i = 0; i < n; i++) { const x = r.x + fw - (n - 1 - i) / (6 * FS - 1) * (fw - 2) - 1, y = ty + th * 0.56 - clamp(m.y[o + i] / m.sd, -2.6, 2.6) * th * 0.15; i ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.lineWidth = 1.5; g.lineJoin = 'round'; g.strokeStyle = tok(m.ok ? '--person' : '--text-3'); g.stroke(); void x0;
      }
    }
    { const { g, w, h: hh } = fit(cvB), r = contain(w, hh); g.imageSmoothingQuality = 'high'; g.drawImage(magC, r.x, r.y, W * r.s, H * r.s); }
  }
  // axes: box in CSS pixels, linear scales, gridlines from --line, numbers in the mono font
  function axes(g, w, hh, o) {
    const b = { l: 40, r: w - 10, t: 22, b: hh - 20 }; b.w = b.r - b.l; b.h = b.b - b.t;
    const X = (v) => b.l + (v - o.x0) / (o.x1 - o.x0) * b.w, Y = (v) => b.b - (v - o.y0) / (o.y1 - o.y0) * b.h;
    g.lineWidth = 1; g.font = mono(10); g.textBaseline = 'middle';
    g.strokeStyle = tok('--line'); g.fillStyle = tok('--text-3'); g.beginPath();
    for (const v of o.yt) { const y = Math.round(Y(v)) + 0.5; g.moveTo(b.l, y); g.lineTo(b.r, y); } for (const v of o.xt) { const x = Math.round(X(v)) + 0.5; g.moveTo(x, b.t); g.lineTo(x, b.b + 3); } g.stroke();
    g.textAlign = 'right'; for (const v of o.yt) g.fillText(o.yf(v), b.l - 5, Y(v));
    g.textAlign = 'center'; g.textBaseline = 'top'; for (const v of o.xt) g.fillText(o.xf(v), X(v), b.b + 6);
    g.strokeStyle = tok('--line-3'); g.beginPath(); g.moveTo(b.l + 0.5, b.t); g.lineTo(b.l + 0.5, b.b + 0.5); g.lineTo(b.r, b.b + 0.5); g.stroke();
    g.font = sans(10, 500); g.fillStyle = tok('--text-3'); g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText(o.xu, b.r, b.b + 6 + (o.xuDy || 0));
    g.save(); g.translate(9, b.t + b.h / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(o.yu, 0, 0); g.restore();
    return { b, X, Y };
  }
  const line = (g, n, fx, fy, color, wd = 1.25, dash = null) => { g.beginPath(); for (let i = 0; i < n; i++) { const x = fx(i), y = fy(i); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.strokeStyle = color; g.lineWidth = wd; g.lineJoin = 'round'; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); };
  const waiting = (g, b, text) => { g.font = sans(11, 400); g.fillStyle = tok('--text-3'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, b.l + b.w / 2, b.t + b.h / 2); };
  const tRange = (xt) => xt.filter((v, i, a) => i < a.length - 1);
  const collectMsg = () => (!buf.length ? 'No skin in the box. Drag it onto the forehead or a cheek.' : 'Collecting frames');
  function drawRaw() {
    const { g, w, h: hh } = fit(CH.raw.c), ok = A && !A.short; let m = 0.4;
    if (ok) for (const S of [A.R, A.G, A.B]) for (let i = 0; i < A.n; i++) m = Math.max(m, Math.abs(S[i]));
    const step = [0.2, 0.5, 1, 2, 5, 10, 20, 50].find((s) => m / s <= 1.6) || 100, top = Math.ceil(m / step) * step, yt = []; for (let v = -top; v <= top + 1e-9; v += step) yt.push(v);
    const { b, X, Y } = axes(g, w, hh, { x0: -WIN, x1: 0, y0: -top, y1: top, xt: tRange([-12, -10, -8, -6, -4, -2, 0]), yt, xf: (v) => String(v), yf: (v) => (v > 0 ? '+' : '') + (step < 1 ? v.toFixed(1) : v), xu: 's ago', yu: '% of mean' });
    if (!ok) return waiting(g, b, collectMsg());
    const fx = (i) => X(-(A.n - 1 - i) / FS); g.save(); g.beginPath(); g.rect(b.l, b.t, b.w, b.h); g.clip();
    for (const [S, c] of [[A.B, '--accent'], [A.R, '--danger'], [A.G, '--ok']]) line(g, A.n, fx, (i) => Y(S[i]), tok(c), 1.1);
    g.restore(); g.font = mono(10); g.textAlign = 'left'; g.textBaseline = 'middle'; let lx = b.l + 8;
    for (const [t, c] of [['R', '--danger'], ['G', '--ok'], ['B', '--accent']]) { g.fillStyle = tok(c); g.fillRect(lx, b.t - 12, 8, 2); g.fillText(t, lx + 11, b.t - 11); lx += 30; }
  }
  function drawWave() {
    const { g, w, h: hh } = fit(CH.wave.c), ok = A && !A.short;
    const { b, X, Y } = axes(g, w, hh, { x0: -WIN, x1: 0, y0: -3, y1: 3, xt: tRange([-12, -10, -8, -6, -4, -2, 0]), yt: [-2, 0, 2], xf: (v) => String(v), yf: (v) => (v > 0 ? '+' : '') + v, xu: 's ago', yu: 'std. dev.' });
    if (!ok) return waiting(g, b, collectMsg());
    const m = A[method], fx = (i) => X(-(A.n - 1 - i) / FS); g.save(); g.beginPath(); g.rect(b.l, b.t, b.w, b.h); g.clip();
    if (source === 'synth') line(g, A.n, fx, (i) => Y(A.T[i] / 0.27), tok('--sim'), 1, [3, 3]);
    line(g, A.n, fx, (i) => Y(m.y[i] / m.sd), m.ok ? mColor(method) : tok('--text-3'), 1.4); g.restore();
    g.font = mono(10); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = mColor(method); g.fillRect(b.l + 8, b.t - 12, 8, 2); g.fillText(mName(method), b.l + 19, b.t - 11);
    if (source === 'synth') { const x = b.l + 34 + g.measureText(mName(method)).width; g.fillStyle = tok('--sim'); g.fillRect(x, b.t - 12, 3, 2); g.fillRect(x + 5, b.t - 12, 3, 2); g.fillText('true wave, simulated', x + 11, b.t - 11); }
  }
  function drawSpec() {
    const { g, w, h: hh } = fit(CH.spec.c), ok = A && !A.short;
    const { b, X, Y } = axes(g, w, hh, { x0: 30, x1: 210, y0: 0, y1: 1.12, xt: [42, 60, 90, 120, 150, 180], yt: [0, 0.5, 1], xf: (v) => String(v), yf: (v) => v.toFixed(1), xu: 'per min', xuDy: 0, yu: 'power' });
    g.fillStyle = tok('--bg-0'); g.globalAlpha = 0.72; g.fillRect(b.l + 1, b.t, X(42) - b.l - 1, b.h); g.fillRect(X(180), b.t, b.r - X(180), b.h); g.globalAlpha = 1;
    if (!ok) return waiting(g, b, collectMsg());
    const other = method === 'pos' ? 'green' : 'pos', m = A[method], q = A[other];
    const curve = (e) => { const k0 = Math.ceil(0.5 / e.df), k1 = Math.floor(3.5 / e.df); g.beginPath(); for (let k = k0; k <= k1; k++) { const x = X(k * e.df * 60), y = Y(Math.min(1.1, e.power[k] / e.peak)); k === k0 ? g.moveTo(x, y) : g.lineTo(x, y); } return [X(k0 * e.df * 60), X(k1 * e.df * 60)]; };
    g.save(); g.beginPath(); g.rect(b.l, b.t, b.w, b.h); g.clip();
    curve(q); g.strokeStyle = mColor(other); g.globalAlpha = 0.75; g.lineWidth = 1.1; g.setLineDash([4, 2]); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    const [xa, xb] = curve(m); g.strokeStyle = mColor(method); g.lineWidth = 1.4; g.stroke(); g.lineTo(xb, Y(0)); g.lineTo(xa, Y(0)); g.closePath(); g.fillStyle = mColor(method); g.globalAlpha = 0.13; g.fill(); g.globalAlpha = 1;
    if (A.truth != null) { const x = Math.round(X(A.truth)) + 0.5; g.strokeStyle = tok('--sim'); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, b.t); g.lineTo(x, b.b); g.stroke(); g.setLineDash([]); }
    g.restore();
    const px = X(m.bpm), py = Y(1); g.fillStyle = m.ok ? tok('--text') : tok('--text-3'); g.beginPath(); g.moveTo(px, py - 2); g.lineTo(px - 4, py - 8); g.lineTo(px + 4, py - 8); g.closePath(); g.fill();
    g.font = mono(11); g.textBaseline = 'middle'; const right = px < b.l + b.w * 0.62; g.textAlign = right ? 'left' : 'right'; g.fillText(m.ok ? m.bpm.toFixed(1) + ' per min' : 'peak not reliable', px + (right ? 8 : -8), py - 4 + 12);
    if (A.truth != null) { g.font = mono(10); g.fillStyle = tok('--sim'); g.textAlign = right ? 'left' : 'right'; g.fillText('true ' + A.truth.toFixed(1), px + (right ? 8 : -8), py + 22); }
    g.font = mono(10); g.textAlign = 'right'; g.fillStyle = mColor(other); g.globalAlpha = 0.8; g.fillText(mName(other) + ', for comparison', b.r - 4, b.t - 11); g.globalAlpha = 1;
  }
  function drawHist() {
    const { g, w, h: hh } = fit(CH.hist.c), now = hist.length ? hist[hist.length - 1].t : 0; let lo = 1e9, hi = -1e9;
    for (const e of hist) { if (e.truth != null) { lo = Math.min(lo, e.truth); hi = Math.max(hi, e.truth); } for (const k of ['green', 'pos']) if (e[k] != null) { lo = Math.min(lo, e[k]); hi = Math.max(hi, e[k]); } }
    if (lo > hi) { lo = 60; hi = 80; } const step = hi - lo > 80 ? 40 : hi - lo > 34 ? 20 : hi - lo > 14 ? 10 : 5; lo = Math.floor((lo - step * 0.4) / step) * step; hi = Math.ceil((hi + step * 0.4) / step) * step; const yt = []; for (let v = lo; v <= hi; v += step) yt.push(v);
    const { b, X, Y } = axes(g, w, hh, { x0: -HIST_S, x1: 0, y0: lo, y1: hi, xt: [-60, -50, -40, -30, -20, -10], yt, xf: (v) => String(v), yf: (v) => String(v), xu: 's ago', yu: 'per min' });
    if (!hist.length) return waiting(g, b, 'Collecting frames');
    g.save(); g.beginPath(); g.rect(b.l, b.t, b.w, b.h + 1); g.clip();
    const seg = (key, color, wd, dash) => { g.beginPath(); let pen = false; for (const e of hist) { if (e[key] == null) { pen = false; continue; } const x = X(e.t - now), y = Y(e[key]); pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; } g.strokeStyle = color; g.lineWidth = wd; g.setLineDash(dash || []); g.lineJoin = 'round'; g.stroke(); g.setLineDash([]); };
    seg('truth', tok('--sim'), 1, [3, 3]); const other = method === 'pos' ? 'green' : 'pos'; g.globalAlpha = 0.5; seg(other, mColor(other), 1); g.globalAlpha = 1; seg(method, mColor(method), 1.6);
    g.fillStyle = tok('--warn'); for (const e of hist) if (e[method] == null) g.fillRect(Math.round(X(e.t - now)) - 1, b.b - 4, 2, 4);     // moments with no reliable pulse
    g.restore(); g.font = mono(10); g.textAlign = 'left'; g.textBaseline = 'middle'; let lx = b.l + 8;
    const key = (t, c, dash) => { g.fillStyle = c; if (dash) { g.fillRect(lx, b.t - 12, 3, 2); g.fillRect(lx + 5, b.t - 12, 3, 2); } else g.fillRect(lx, b.t - 12, 8, 2); g.fillText(t, lx + 11, b.t - 11); lx += 20 + g.measureText(t).width; };
    key(mName(method), mColor(method)); key(mName(other), mColor(other)); if (source === 'synth') key('true', tok('--sim'), true); g.fillStyle = tok('--warn'); g.fillRect(lx, b.t - 14, 2, 5); g.fillText('no reliable pulse', lx + 6, b.t - 11);
  }
  function drawCharts() { drawRaw(); drawWave(); drawSpec(); drawHist(); }

  // ------------------------------------------------------------------ text
  const sgn = (v, d = 1) => { const a = Math.abs(v).toFixed(d); return (+a === 0 ? '' : v > 0 ? '+' : '−') + a; };
  function paintLabels() {
    const syn = source === 'synth';
    srcState.replaceChildren(syn ? h('span.tag.tag-sim', { title: 'Drawn and animated in this page. Not a recording of a person.' }, 'Synthetic subject') : h('span.status.person.live', null, 'Camera on'),
      h('span', null, syn ? 'Known pulse. No camera in use.' : (camInfo ? camInfo.w + ' × ' + camInfo.h + ' · processed in this page, nothing is sent' : 'Starting the camera')));
    capA.textContent = syn ? 'synthetic subject · 320 × 240 · drag the box' : 'your camera, mirrored · 320 × 240 · drag the box';
    capB.textContent = 'Eulerian magnification, × ' + P.alpha;
    pillB.replaceChildren(h('span.num', null, '× ' + P.alpha), ' · pass band ', h('span.num', null, LO.toFixed(1) + ' to ' + HI.toFixed(1) + ' Hz'), ' · pyramid level 4');
    useBtn.hidden = !syn; stopBtn.hidden = syn; synSec.hidden = !syn; camSec.hidden = syn;
    methodSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === method)));
    cmpTable.querySelectorAll('tbody tr').forEach((r) => r.setAttribute('aria-selected', String(r.dataset.m === method)));
    const mn = method === 'pos' ? 'POS' : 'the green channel';
    CH.raw.t.textContent = 'Mean colour of the skin region: the pulse is a fraction of 1 % of it';
    CH.wave.t.textContent = 'After ' + mn + ' and the 0.7 to 3 Hz filter: one wave per beat';
    CH.spec.t.textContent = 'Spectrum: the tallest peak between 42 and 180 per minute is the pulse';
    CH.hist.t.textContent = syn ? 'Estimate against the true rate, last 60 s' : 'Estimate over the last 60 s (no true rate for a real face)';
    rdTrue.set('–', syn ? 'True, simulated' : 'True: not known'); if (!syn) rdErr.set('–', 'Error: not known');
    nodeV[3].textContent = method === 'pos' ? 'POS' : 'Green'; nodeV[4].textContent = LO + '–' + HI.toFixed(0) + ' Hz';
  }
  function paintReading() {
    const a = A, m = a && !a.short ? a[method] : null, span = a ? a.span : 0, noSkin = skinFrac < 0.15;
    let state = 'ok';
    if (noSkin) state = 'noskin'; else if (!m || span < MIN_S) state = 'collect'; else if (!m.ok) state = 'weak';
    big.dataset.state = state;
    if (state === 'ok') { bigN.textContent = m.bpm.toFixed(0); bigU.textContent = 'per minute'; bigS.textContent = mName(method) + ' · quality ' + m.sqi.toFixed(1) + ' dB'; }
    else { bigN.textContent = ''; bigU.textContent = state === 'weak' ? 'No reliable pulse' : state === 'noskin' ? 'No skin in the box' : 'Not enough signal yet'; bigS.textContent = state === 'weak' ? 'quality ' + m.sqi.toFixed(1) + ' dB, below ' + SQI_MIN + ' dB' : state === 'noskin' ? 'drag the box onto the forehead or a cheek' : span.toFixed(1) + ' of ' + MIN_S + ' s collected'; }
    stateEl.className = 'status ' + (state === 'ok' ? 'ok' : state === 'collect' ? 'accent live' : 'warn');
    stateEl.textContent = state === 'ok' ? 'Pulse found in a ' + span.toFixed(0) + ' s window' : state === 'weak' ? 'No reliable pulse' : state === 'noskin' ? 'No skin in the box' : 'Not enough signal yet: ' + span.toFixed(1) + ' of ' + MIN_S + ' s';
    rdEst.set(state === 'ok' ? m.bpm.toFixed(1) : '–', state === 'weak' ? 'No reliable pulse' : 'Estimated');
    if (source === 'synth') { rdTrue.set(a && a.truth != null ? a.truth.toFixed(1) : P.rate.toFixed(1)); rdErr.set(state === 'ok' ? sgn(m.bpm - a.truth) : '–', 'Error'); }
    const q = m ? m.sqi : null; meter.style.setProperty('--v', q == null ? 0 : clamp((q - qLo) / (qHi - qLo), 0, 1)); meter.className = 'meter ' + (q != null && q >= SQI_MIN ? 'ok' : 'warn'); meter.setAttribute('aria-valuenow', q == null ? qLo : q.toFixed(1)); meterV.textContent = q == null ? '–' : q.toFixed(1) + ' dB';
    for (const k of ['green', 'pos']) { const e = a && !a.short ? a[k] : null, c = cmp[k], show = e && e.ok; c.rate.textContent = show ? e.bpm.toFixed(1) : e && span >= MIN_S ? 'none' : '–'; c.err.textContent = show && a.truth != null ? sgn(e.bpm - a.truth) : '–'; c.q.textContent = e ? e.sqi.toFixed(1) + ' dB' : '–'; c.tr.dataset.ok = String(!!show); }
    nodeV[0].textContent = skinN.toLocaleString('en-US').replace(/,/g, ' ') + ' px'; nodeV[1].textContent = lastMean.map((v) => v.toFixed(0)).join(' ');
    nodeV[2].textContent = a && a.fps ? a.fps.toFixed(1) + ' → ' + FS + ' Hz' : '–'; nodeV[5].textContent = state === 'ok' ? m.bpm.toFixed(1) + ' /min' : '–'; nodeV[6].textContent = m ? m.sqi.toFixed(1) + ' dB' : '–';
    chain.dataset.state = state;
    footL.textContent = 'window ' + (a ? Math.min(WIN, span).toFixed(1) : '0.0') + ' of ' + WIN + ' s · ' + (a && a.n ? a.n : 0) + ' samples at ' + FS + ' Hz · FFT ' + NFFT + ' points, ' + (FS / NFFT * 60).toFixed(2) + ' per min per bin · ' + frameMs.toFixed(1) + ' ms per frame';
    if (source === 'camera' && camInfo) camKv.replaceChildren(h('dt', null, 'Camera'), h('dd', null, camInfo.label), h('dt', null, 'Delivers'), h('dd', null, camInfo.w + ' × ' + camInfo.h + (camInfo.fps ? ' at ' + Math.round(camInfo.fps) + ' per s' : '')), h('dt', null, 'Measured'), h('dd', null, a && a.fps ? a.fps.toFixed(1) + ' frames per s' : '–'), h('dt', null, 'Skin in the box'), h('dd', null, Math.round(skinFrac * 100) + ' %'));
  }
  function setMethod(id) { method = id; paintLabels(); paintReading(); drawCharts(); }

  // ------------------------------------------------------------------ camera
  async function startCamera() {
    if (stream) return; useBtn.disabled = true;
    try {
      stream = await lab.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 }, audio: false });
      const track = stream.getVideoTracks()[0]; track.addEventListener('ended', () => { if (stream) stopCamera('The camera stopped sending frames. Back on the synthetic subject.'); });
      video.srcObject = stream; await video.play();
      const st = track.getSettings?.() || {}; camInfo = { w: st.width || video.videoWidth, h: st.height || video.videoHeight, fps: st.frameRate, label: (track.label || 'Camera').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '') };
      source = 'camera'; roi = { x: 128, y: 44, w: 64, h: 28 }; hist = []; evmInit = false; resetSignal(); lastCT = -1; camNew = false;
      if (video.requestVideoFrameCallback) { const onF = (now, meta) => { camT = (meta.captureTime || meta.expectedDisplayTime || now) / 1000; camNew = true; vfc = video.requestVideoFrameCallback(onF); }; vfc = video.requestVideoFrameCallback(onF); }
      paintLabels(); paintReading();
    } catch (e) {
      if (stream) { lab.release(stream); stream = null; } video.srcObject = null;
      ctx.shell.toast('Camera not available. ' + lab.mediaError(e), { level: 'alert' });
      note('The camera could not be used: ' + lab.mediaError(e));
    } finally { useBtn.disabled = false; }
  }
  function stopCamera(msg) {
    if (vfc && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(vfc); vfc = 0;
    if (stream) { lab.release(stream); stream = null; } try { video.pause(); } catch { /* not playing */ } video.srcObject = null;
    if (source === 'camera') { source = 'synth'; camInfo = null; roi = { x: 128, y: 71, w: 64, h: 24 }; hist = []; evmInit = false; resetSignal(); paintLabels(); paintReading(); if (msg) note(msg); }
  }
  let noteT = 0;
  function note(text) { paintLabels(); srcState.lastChild.textContent = text; srcState.lastChild.classList.add('warn'); clearTimeout(noteT); noteT = setTimeout(() => paintLabels(), 9000); }
  function saveCsv() {
    if (!buf.length) return ctx.shell.toast('There are no samples to save yet.', { level: 'info' });
    const t0 = buf[0].t, rows = ['time_s,mean_r,mean_g,mean_b' + (source === 'synth' ? ',true_pulse_wave' : '')];
    for (const s of buf) rows.push([(s.t - t0).toFixed(4), s.r.toFixed(4), s.g.toFixed(4), s.b.toFixed(4)].concat(source === 'synth' ? [s.p.toFixed(5)] : []).join(','));
    lab.download('pulse-trace-' + (source === 'synth' ? 'synthetic' : 'camera') + '.csv', rows.join('\n'), 'text/csv');
  }

  // ------------------------------------------------------------------ the region box: drag to move, corner to resize, arrow keys
  const toFrame = (e) => { const r = cvA.getBoundingClientRect(); return [(e.clientX - r.left - rectA.x) / rectA.s, (e.clientY - r.top - rectA.y) / rectA.s]; };
  const setRoi = (x, y, w, hh) => { w = Math.round(clamp(w, 12, 160)); hh = Math.round(clamp(hh, 10, 120)); roi = { x: Math.round(clamp(x, 0, W - w)), y: Math.round(clamp(y, 0, H - hh)), w, h: hh }; resetSignal(); };
  let drag = null;
  const hit = (fx, fy) => (Math.abs(fx - roi.x - roi.w) < 7 && Math.abs(fy - roi.y - roi.h) < 7 ? 'size' : fx >= roi.x - 3 && fx <= roi.x + roi.w + 3 && fy >= roi.y - 3 && fy <= roi.y + roi.h + 3 ? 'move' : null);
  cvA.addEventListener('pointerdown', (e) => { const [fx, fy] = toFrame(e), k = hit(fx, fy); if (!k) { if (fx >= 0 && fy >= 0 && fx < W && fy < H) { setRoi(fx - roi.w / 2, fy - roi.h / 2, roi.w, roi.h); drag = { k: 'move', ox: roi.w / 2, oy: roi.h / 2 }; } else return; } else drag = { k, ox: fx - roi.x, oy: fy - roi.y }; try { cvA.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ } e.preventDefault(); });
  cvA.addEventListener('pointermove', (e) => { const [fx, fy] = toFrame(e); if (!drag) { const k = hit(fx, fy); cvA.style.cursor = k === 'size' ? 'nwse-resize' : k === 'move' ? 'move' : 'crosshair'; return; } if (drag.k === 'move') setRoi(fx - drag.ox, fy - drag.oy, roi.w, roi.h); else setRoi(roi.x, roi.y, fx - roi.x, fy - roi.y); });
  const endDrag = () => { drag = null; }; cvA.addEventListener('pointerup', endDrag); cvA.addEventListener('pointercancel', endDrag);
  cvA.addEventListener('keydown', (e) => { const d = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] }[e.key]; if (!d) return; e.preventDefault(); if (e.shiftKey) setRoi(roi.x, roi.y, roi.w + d[0], roi.h + d[1]); else setRoi(roi.x + d[0], roi.y + d[1], roi.w, roi.h); });

  // ------------------------------------------------------------------ the loop
  function tick(dtLoop, t) {
    let got = false, ts = t, pv = 0;
    if (source === 'synth') {
      if (t - lastFrameT >= 1 / FS - 0.004) { const dt = lastFrameT ? Math.min(0.6, t - lastFrameT) : 1 / FS; synT += dt; const t0 = performance.now(); pv = renderSynth(img.data, synT, dt); srcG.putImageData(img, 0, 0); got = true; ts = t; frameMs += ((performance.now() - t0) - frameMs) * 0.1; }
    } else if (video.readyState >= 2 && video.videoWidth) {
      const fresh = video.requestVideoFrameCallback ? camNew : video.currentTime !== lastCT;
      if (fresh) {
        camNew = false; lastCT = video.currentTime; ts = video.requestVideoFrameCallback && camT ? camT : t;
        const vw = video.videoWidth, vh = video.videoHeight, sw = Math.min(vw, vh * W / H), sh = sw * H / W;
        srcG.save(); srcG.translate(W, 0); srcG.scale(-1, 1); srcG.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, W, H); srcG.restore();
        img = srcG.getImageData(0, 0, W, H); got = true;
      }
    }
    if (got) {
      const t0 = performance.now(), dt = lastFrameT ? clamp(ts - lastFrameT, 0.004, 0.25) : 1 / FS; lastFrameT = ts;
      const m = regionMean(img.data);
      if (m && skinFrac >= 0.15) { if (buf.length && ts - buf[buf.length - 1].t > 0.6) buf = []; lastMean = m; buf.push({ t: ts, r: m[0], g: m[1], b: m[2], p: pv, ph: phase }); while (buf.length > 2 && ts - buf[0].t > WIN + 1.5) buf.shift(); }
      else if (buf.length && ts - buf[buf.length - 1].t > 0.6) { buf = []; A = null; }
      magnify(img.data, dt);
      if (source !== 'synth') frameMs += ((performance.now() - t0) - frameMs) * 0.1;
      drawViews();
    }
    if (t - lastAnalT >= 0.1) {
      lastAnalT = t; A = analyse();
      if (t - lastHistT >= 0.5) { lastHistT = t; const ok = A && !A.short; hist.push({ t, truth: ok ? A.truth : null, green: ok && A.green.ok ? A.green.bpm : null, pos: ok && A.pos.ok ? A.pos.bpm : null }); while (hist.length && t - hist[0].t > HIST_S) hist.shift(); }
      drawCharts();
      if (t - lastUiT >= 0.5 || dirty) { lastUiT = t; dirty = false; paintReading(); }
    }
  }
  const loop = lab.loop(tick);
  const ro = new ResizeObserver(() => { layout(); if (!loop.running) return; drawViews(); drawCharts(); });
  function layout() { const r = stage.getBoundingClientRect(); if (!r.width) return; const colW = (r.width - 34) / 2; views.style.height = Math.round(Math.min(r.height * 0.43, colW * 0.75 + 27)) + 'px'; }
  ro.observe(stage);
  paintLabels(); paintReading();

  return {
    onShow() { lastFrameT = 0; lastAnalT = 0; if (buf.length) resetSignal(); hist = []; layout(); loop.start(); },
    onHide() { loop.stop(); stopCamera(); },
    onPrefs() { paintLabels(); drawViews(); drawCharts(); },
  };
}

const FIELD = 'The rover would have to see bare skin, well lit and still, with many pixels on it and no video compression. Dust, mud, blood, shade and a shaking camera each take that away: a 2023 drone trial with 18 people of clean skin, standing still, had an error of 14.3 beats a minute and says real disasters need more research. Unknown: whether any of this survives a collapsed building.';
const FAILURE = 'A lamp flickering at 87 per minute (2 % of the light) makes the green-channel method report 87.0 with a quality of 20.3 dB: confidently wrong by 15 beats, because the lamp looks like a stronger pulse. POS, on the same frames, read 72.1. With 4 pixels of head motion the green channel gave no reading at all.';
