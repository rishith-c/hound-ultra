// Foundation models for the Earth. Prithvi (NASA and IBM) is far too large to run in a page, and this exhibit says so.
// What runs here is the task it is used for, flood mapping from six colour bands, on the real terrain of the valley:
// real hydrology on the elevation grid makes an illustrative flood, a simulated six-band image is rendered with sun,
// terrain shadow, haze and cloud, and two small mappers (a classic water index and a tiny network trained in this page)
// are scored against the simulated truth, with every error sorted by its cause.
import * as L from '../lib.js';
const { clamp, TAU } = L;
const N = 512, CS = (40075016.686 * Math.cos((28.25 * Math.PI) / 180)) / 2 ** 14 * 4 / N;
//                 blue   green  red    NIR    SWIR1  SWIR2     (the six bands Prithvi reads from Harmonized Landsat Sentinel-2)
const REF = { water: [0.085, 0.115, 0.12, 0.07, 0.03, 0.02], veg: [0.03, 0.06, 0.04, 0.4, 0.2, 0.1], bare: [0.13, 0.16, 0.19, 0.26, 0.31, 0.27], cloud: [0.72, 0.72, 0.72, 0.7, 0.55, 0.45] };
const HAZE = [0.05, 0.035, 0.025, 0.01, 0.003, 0.001];
const PUBLISHED = 0.83;   // Jakubik et al. 2023: water-class IoU 82.99 on Sen1Floods11 after 500 epochs of fine-tuning

async function loadDem() {
  try { const res = await fetch(new URL('../../area/data/dem512.bin', import.meta.url)); if (!res.ok) throw 0; const raw = new Uint16Array(await res.arrayBuffer()); if (raw.length !== 512 * 512) throw 0;
    const z = new Float32Array(N * N); for (let k = 0; k < N * N; k++) z[k] = raw[k] / 10; return { z, real: true };
  } catch { const R = L.rng(5), z = new Float32Array(N * N), c = Array.from({ length: 81 }, () => R());
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const u = (i / N) * 8, v = (j / N) * 8, a = u | 0, b = v | 0, fu = L.smooth(u - a), fv = L.smooth(v - b); z[j * N + i] = 1600 + 3800 * Math.abs(i / N - 0.5 - 0.15 * Math.sin(j / 40)) + 500 * L.lerp(L.lerp(c[b * 9 + a], c[b * 9 + a + 1], fu), L.lerp(c[b * 9 + 9 + a], c[b * 9 + 10 + a], fu), fv); } return { z, real: false }; }
}
function noise(R, cells) { const m = cells + 2, c = Float32Array.from({ length: m * m }, () => R()), out = new Float32Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const u = (i / N) * cells, v = (j / N) * cells, a = u | 0, b = v | 0, fu = L.smooth(u - a), fv = L.smooth(v - b); out[j * N + i] = L.lerp(L.lerp(c[b * m + a], c[b * m + a + 1], fu), L.lerp(c[b * m + m + a], c[b * m + m + a + 1], fu), fv); } return out; }

// Drainage from the elevation grid: priority-flood (Barnes et al. 2014) gives every cell a way downhill, then flow
// accumulation finds the river and each cell's height above the river it drains to (HAND).
function hydrology(z) {
  const n2 = N * N, seen = new Uint8Array(n2), down = new Int32Array(n2).fill(-1), fill = Float32Array.from(z), order = new Int32Array(n2), heap = [];
  const push = (k) => { heap.push(k); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (fill[heap[p]] <= fill[heap[c]]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let p = 0; for (;;) { let m = p; const l = 2 * p + 1, r = l + 1; if (l < heap.length && fill[heap[l]] < fill[heap[m]]) m = l; if (r < heap.length && fill[heap[r]] < fill[heap[m]]) m = r; if (m === p) break; [heap[p], heap[m]] = [heap[m], heap[p]]; p = m; } } return top; };
  for (let i = 0; i < N; i++) for (const k of [i, (N - 1) * N + i, i * N, i * N + N - 1]) if (!seen[k]) { seen[k] = 1; push(k); }
  let o = 0;
  while (heap.length) { const k = pop(), i = k % N, j = (k / N) | 0; order[o++] = k;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= N || b >= N) continue; const q = b * N + a; if (seen[q]) continue; seen[q] = 1; fill[q] = Math.max(z[q], fill[k]); down[q] = k; push(q); } }
  const acc = new Float32Array(n2).fill(1); for (let q = n2 - 1; q >= 0; q--) { const k = order[q]; if (down[k] >= 0) acc[down[k]] += acc[k]; }
  let amax = 0; for (let k = 0; k < n2; k++) if (acc[k] > amax) amax = acc[k];
  const base = new Float32Array(n2), bacc = new Float32Array(n2), RIV = 2400;
  for (let q = 0; q < n2; q++) { const k = order[q]; if (acc[k] >= RIV || down[k] < 0) { base[k] = z[k]; bacc[k] = acc[k] >= RIV ? acc[k] : 0; } else { base[k] = base[down[k]]; bacc[k] = bacc[down[k]]; } }
  const hand = new Float32Array(n2), size = new Float32Array(n2); for (let k = 0; k < n2; k++) { hand[k] = Math.max(0, z[k] - base[k]); size[k] = bacc[k] > 0 ? (bacc[k] / amax) ** 0.45 : 0; }
  return { hand, size, acc, RIV };
}

export default {
  id: 'earthfm', title: 'Foundation models for the Earth', short: 'Earth AI',
  readiness: 1.3, readinessNote: 'Prithvi is published, open and fine-tuned for flood mapping on a public benchmark. Routine use inside a disaster response is still being trialled.',
  standoff: [5e5, 8e5],
  labels: ['concept', 'live-ai'],
  labelNote: 'Prithvi is not running here: it has hundreds of millions of parameters. The live AI is a network of about a hundred parameters trained in this page, beside a classic water index. The image is simulated on the real elevation of the valley, and the flood is illustrative: not a forecast, and not a reconstruction of the real flood.',
  sentences: [
    'A foundation model for the Earth is one large network trained on years of satellite images with no labels, then taught a new job, such as mapping flood water, from a few hundred labelled examples.',
    'NASA and IBM published one, Prithvi, in 2023; here a tiny stand-in does the same job on this valley, so you can see what the input is, what comes out, and exactly where it goes wrong.',
  ],
  needs: 'A cloud-free look at the right moment, or a radar pass instead. Floods come with cloud, and an optical image cannot see through it; deep valleys add shadow that reads like water.',
  unknown: 'How well a model fine-tuned on a few hundred labelled floods holds up in a place and season it has never seen. The published score drops on a held-out country, and nobody has scored it on a Himalayan valley like this one.',
  sources: [
    { who: 'Jakubik et al., IBM Research and NASA', year: 2023, title: 'Foundation models for generalist geospatial artificial intelligence', where: 'arXiv:2310.18660', url: 'https://arxiv.org/abs/2310.18660', note: 'Reports a water-class IoU of 82.99 on the Sen1Floods11 benchmark.' },
    { who: 'IBM and NASA', year: 2023, title: 'Prithvi-EO-1.0-100M fine-tuned on Sen1Floods11, model card', where: 'Hugging Face', url: 'https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-1.0-100M-sen1floods11', note: 'Water IoU 80.46 on the test split, 77.95 on a held-out flood in Bolivia.' },
    { who: 'Bonafilia, Tellman, Anderson and Issenberg', year: 2020, title: 'Sen1Floods11: a georeferenced dataset to train and test deep learning flood algorithms for Sentinel-1', where: 'CVPR Workshops', url: 'https://openaccess.thecvf.com/content_CVPRW_2020/html/w11/Bonafilia_Sen1Floods11_A_Georeferenced_Dataset_to_Train_and_Test_Deep_Learning_CVPRW_2020_paper.html' },
  ],
  glyph(g, s, t, c) { const r = s * 0.36; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const on = (Math.sin(t * 0.9 + i * 1.7 + j * 2.3) > 0.2); g.globalAlpha = on ? 1 : 0.35; g.fillStyle = on && (i + j) % 2 === 0 ? c.accent : c.ink; g.fillRect(i * r * 0.72 - r * 0.28, j * r * 0.72 - r * 0.28, r * 0.56, r * 0.56); } g.globalAlpha = 1; },

  create({ stage, controls, readout }) {
    L.layout(stage, { cols: 'minmax(0, 1fr) minmax(0, 1fr)', rows: 'minmax(0, 1fr) 216px', areas: ['in out', 'score cause'] });
    const fIn = L.figure({ area: 'in', title: 'Input: what the satellite sees' }), fOut = L.figure({ area: 'out', title: 'Output: the flood map, checked against the truth' });
    const fSc = L.figure({ area: 'score', title: 'Agreement with the truth' }), fCa = L.figure({ area: 'cause', title: 'What is still weak' });
    stage.append(fIn.el, fOut.el, fSc.el, fCa.el);
    fOut.legend([{ label: 'water, found', color: 'accent' }, { label: 'water, missed', color: 'warn' }, { label: 'false water', color: 'danger' }]);
    const P = { stage: 12, cloud: 18, sun: 38, slope: false, method: 'net', view: 'natural', seed: 4 };
    let dem = null, H = null, slope = null, gE = null, gN = null, S = null, net = null, netS = null; const sunCache = new Map();
    const imgIn = L.raster(N, N), imgOut = L.raster(N, N);

    // ---- one simulated acquisition: truth water, six bands, and the nuisance masks ----
    function scene(p) {
      const n2 = N * N, R = L.rng(p.seed * 977 + 13), z = dem.z;
      const frac = new Float32Array(n2); let nw = 0;
      for (let k = 0; k < n2; k++) { const st = p.stage * H.size[k]; frac[k] = st > 0 ? clamp((st - H.hand[k]) / 2.5 + 0.5) : 0; if (frac[k] > 0.5) nw++; }
      // sun: direct light on each facet, and cast shadows by marching toward the sun
      const azS = (135 * Math.PI) / 180, el = (p.sun * Math.PI) / 180, sx = Math.sin(azS), sy = Math.cos(azS), tanEl = Math.tan(el);
      let sun = sunCache.get(p.sun);
      if (!sun) { const lit = new Float32Array(n2), shadow = new Uint8Array(n2), ce = Math.cos(el), se = Math.sin(el);
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i, nl = Math.hypot(gE[k], gN[k], 1); lit[k] = clamp((-gE[k] * sx * ce - gN[k] * sy * ce + se) / nl, 0, 1) / se;
          for (let s = 3; s < 150; s += 3) { const a = Math.round(i + sx * s), b = Math.round(j - sy * s); if (a < 0 || b < 0 || a >= N || b >= N) break; if (z[b * N + a] > z[k] + s * CS * tanEl + 8) { shadow[k] = 1; break; } } }
        sun = { lit, shadow }; if (sunCache.size > 12) sunCache.clear(); sunCache.set(p.sun, sun); }
      const { lit, shadow } = sun;
      // cloud and its shadow, displaced away from the sun
      const c1 = noise(R, 5), c2 = noise(R, 13), cov = p.cloud / 100, cloud = new Float32Array(n2), cshadow = new Uint8Array(n2), samp = [];
      for (let k = 0; k < n2; k++) { c1[k] = 0.68 * c1[k] + 0.32 * c2[k]; if (k % 23 === 0) samp.push(c1[k]); }
      samp.sort((a, b) => a - b); const thr = samp[Math.min(samp.length - 1, Math.floor((1 - cov) * samp.length))];   // the level that covers exactly this share of the scene
      if (cov > 0) for (let k = 0; k < n2; k++) cloud[k] = clamp((c1[k] - thr) * 16 + 0.5);
      const sh = Math.round(Math.min(52, 900 / tanEl / CS));
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = Math.round(i + sx * sh), b = Math.round(j - sy * sh); if (a >= 0 && b >= 0 && a < N && b < N && cloud[b * N + a] > 0.5) cshadow[j * N + i] = 1; }
      const tex = noise(R, 40), bands = new Float32Array(n2 * 6);
      for (let k = 0; k < n2; k++) { const v = clamp(0.9 - L.smooth((z[k] - 3000) / 900) * 0.6 - 0.5 * L.smooth((slope[k] - 0.75) / 0.3) + 0.3 * (tex[k] - 0.5)), f = frac[k];
        const light = (shadow[k] ? 0 : Math.min(1.5, lit[k])) * (cshadow[k] ? 0.25 : 1) + 0.2, c = cloud[k];
        for (let b = 0; b < 6; b++) { const land = REF.veg[b] * v + REF.bare[b] * (1 - v), ground = (REF.water[b] * f + land * (1 - f)) * light + HAZE[b]; bands[k * 6 + b] = Math.max(0, ground * (1 - c) + REF.cloud[b] * c + 0.007 * R.n()); } }
      return { frac, bands, shadow, cshadow, cloud, nw };
    }
    const feat = (sc, k, useSlope, out) => { for (let b = 0; b < 6; b++) out[b] = sc.bands[k * 6 + b] * 4 - 0.6; out[6] = useSlope ? slope[k] * 2 - 0.6 : 0; return out; };

    // ---- a tiny network, trained here on two other acquisitions of the same valley (other clouds, other water level) ----
    function train(useSlope) {
      const t0 = performance.now(), R = L.rng(77), sets = [scene({ ...P, stage: 6, cloud: 22, sun: 30, seed: 101 }), scene({ ...P, stage: 12, cloud: 10, sun: 50, seed: 202 })];
      const X = [], Y = [], x = new Float32Array(7);
      for (const sc of sets) for (let q = 0; q < 12000; q++) { let k = R.int(0, N * N - 1); if (R() < 0.45) { for (let tries = 0; tries < 30 && sc.frac[k] <= 0.5; tries++) k = R.int(0, N * N - 1); } X.push(Float32Array.from(feat(sc, k, useSlope, x))); Y.push(sc.frac[k] > 0.5 && sc.cloud[k] < 0.5 ? 1 : 0); }   // under cloud the label is "cannot see water"
      const I = 7, Hn = 10, W1 = Float32Array.from({ length: I * Hn }, () => R.n() * 0.5), b1 = new Float32Array(Hn), W2 = Float32Array.from({ length: Hn }, () => R.n() * 0.5); let b2 = 0;
      const m = { W1: new Float32Array(I * Hn), b1: new Float32Array(Hn), W2: new Float32Array(Hn), b2: 0 }, v = { W1: new Float32Array(I * Hn), b1: new Float32Array(Hn), W2: new Float32Array(Hn), b2: 0 };
      const hbuf = new Float32Array(Hn), g1 = new Float32Array(I * Hn), gb1 = new Float32Array(Hn), g2 = new Float32Array(Hn), lr = 0.02, B = 128, steps = 700; let loss = 0;
      for (let s = 1; s <= steps; s++) { g1.fill(0); gb1.fill(0); g2.fill(0); let gb2 = 0; loss = 0;
        for (let q = 0; q < B; q++) { const n = R.int(0, X.length - 1), xi = X[n]; let o = b2; for (let hI = 0; hI < Hn; hI++) { let a = b1[hI]; for (let i = 0; i < I; i++) a += W1[hI * I + i] * xi[i]; hbuf[hI] = Math.tanh(a); o += W2[hI] * hbuf[hI]; }
          const pr = 1 / (1 + Math.exp(-o)), d = (pr - Y[n]) / B; loss -= (Y[n] ? Math.log(pr + 1e-7) : Math.log(1 - pr + 1e-7)) / B; gb2 += d;
          for (let hI = 0; hI < Hn; hI++) { g2[hI] += d * hbuf[hI]; const dh = d * W2[hI] * (1 - hbuf[hI] * hbuf[hI]); gb1[hI] += dh; for (let i = 0; i < I; i++) g1[hI * I + i] += dh * xi[i]; } }
        const adam = (w, g, mm, vv) => { for (let i = 0; i < w.length; i++) { mm[i] = 0.9 * mm[i] + 0.1 * g[i]; vv[i] = 0.999 * vv[i] + 0.001 * g[i] * g[i]; w[i] -= (lr * (mm[i] / (1 - 0.9 ** s))) / (Math.sqrt(vv[i] / (1 - 0.999 ** s)) + 1e-8); } };
        adam(W1, g1, m.W1, v.W1); adam(b1, gb1, m.b1, v.b1); adam(W2, g2, m.W2, v.W2); m.b2 = 0.9 * m.b2 + 0.1 * gb2; v.b2 = 0.999 * v.b2 + 0.001 * gb2 * gb2; b2 -= (lr * (m.b2 / (1 - 0.9 ** s))) / (Math.sqrt(v.b2 / (1 - 0.999 ** s)) + 1e-8); }
      const params = (useSlope ? I : I - 1) * Hn + Hn + Hn + 1;
      return { params, ms: performance.now() - t0, samples: X.length, loss, predict(xi) { let o = b2; for (let hI = 0; hI < Hn; hI++) { let a = b1[hI]; for (let i = 0; i < I; i++) a += W1[hI * I + i] * xi[i]; o += W2[hI] * Math.tanh(a); } return o > 0; } };
    }

    // ---- map, score, and sort every error by its cause ----
    const CAUSES = ['under cloud', 'cloud shadow', 'terrain shadow', 'water edge', 'other'];
    function judge(sc, predict) {
      const n2 = N * N, out = new Uint8Array(n2), cause = [0, 0, 0, 0, 0]; let tp = 0, fp = 0, fn = 0;
      for (let k = 0; k < n2; k++) { const t = sc.frac[k] > 0.5, p = predict(k); if (t && p) { tp++; out[k] = 1; } else if (t || p) { if (t) { fn++; out[k] = 2; } else { fp++; out[k] = 3; }
          cause[sc.cloud[k] > 0.4 ? 0 : sc.cshadow[k] ? 1 : sc.shadow[k] ? 2 : sc.frac[k] > 0.08 && sc.frac[k] < 0.92 ? 3 : 4]++; } }
      return { out, tp, fp, fn, iou: tp / Math.max(1, tp + fp + fn), cause };
    }
    function compute() {
      S = scene(P); const x = new Float32Array(7), b = S.bands;
      // modified NDWI: green against short-wave infrared, after the usual brightness test that throws out cloud
      S.idx = judge(S, (k) => b[k * 6] < 0.3 && (b[k * 6 + 1] - b[k * 6 + 4]) / (b[k * 6 + 1] + b[k * 6 + 4] + 1e-6) > 0.12);
      S.net = judge(S, (k) => net.predict(feat(S, k, P.slope, x)));
      paint(); report();
    }
    function paint() {
      const b = S.bands, T = L.tokens().rgb, J = S[P.method === 'net' ? 'net' : 'idx'], gm = (v) => 255 * clamp(v * 3.4) ** 0.72;
      imgIn.paint((k) => (P.view === 'natural' ? [gm(b[k * 6 + 2]), gm(b[k * 6 + 1]), gm(b[k * 6])] : [gm(b[k * 6 + 4] * 0.9), gm(b[k * 6 + 3] * 0.62), gm(b[k * 6 + 2])]));
      imgOut.paint((k) => { const o = J.out[k], lum = 0.3 * gm(b[k * 6 + 2]) + 0.4 * gm(b[k * 6 + 1]) + 0.3 * gm(b[k * 6]), base = 10 + lum * 0.22; if (!o) return [base, base * 1.04, base * 1.1]; const c = o === 1 ? T.accent : o === 2 ? T.warn : T.danger; return [c[0] * 0.92, c[1] * 0.92, c[2] * 0.92]; });
      fIn.redraw(); fOut.redraw(); fSc.redraw(); fCa.redraw();
    }
    const mapDraw = (img, extra) => (g, w, hh) => {
      if (!S) { L.text(g, 'Working out where the water would go…', w / 2, hh / 2, { align: 'center', color: 'text3', size: 12 }); return; }
      const side = Math.floor(Math.min(w, hh)), x0 = Math.floor((w - side) / 2), y0 = Math.floor((hh - side) / 2);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(img.canvas, x0, y0, side, side); g.strokeStyle = L.tokens().line2; g.strokeRect(x0 + 0.5, y0 + 0.5, side - 1, side - 1);
      L.scaleBar(g, x0 + 12, y0 + side - 12, side / N / CS, { metres: 1000 }); extra?.(g, x0, y0, side);
    };
    fIn.draw = mapDraw(imgIn, (g, x0, y0, side) => { // sun direction
      const cx = x0 + side - 30, cy = y0 + 30, a = (135 * Math.PI) / 180; g.strokeStyle = L.tokens().warn; g.fillStyle = L.tokens().warn; g.lineWidth = 1.25; g.beginPath(); g.arc(cx, cy, 5, 0, TAU); g.fill();
      for (let q = 0; q < 8; q++) { const t = (q / 8) * TAU; g.beginPath(); g.moveTo(cx + Math.cos(t) * 8, cy + Math.sin(t) * 8); g.lineTo(cx + Math.cos(t) * 11.5, cy + Math.sin(t) * 11.5); g.stroke(); }
      L.text(g, 'sun ' + P.sun + '° up, from the south-east', cx - 18, cy + 4, { align: 'right', size: 11, color: 'text', halo: true }); void a; });
    fOut.draw = mapDraw(imgOut);
    fSc.draw = (g, w, hh) => {
      if (!S) return; const rows = [['Water index (green against short-wave infrared)', S.idx.iou, 'text2', P.method === 'idx'], ['Tiny network trained in this page, ' + net.params + ' parameters', S.net.iou, 'accent', P.method === 'net']];
      const x0 = 8, bw = w - 78, rh = Math.min(46, (hh - 58) / 2.2); let y = 8;
      for (const [name, v, col, on] of rows) { L.text(g, name, x0, y + 11, { color: on ? 'text' : 'text2', size: 11.5, weight: on ? 600 : 500 }); g.fillStyle = L.tokens().bg3; g.fillRect(x0, y + 18, bw, 9); g.fillStyle = L.rgba(col, on ? 1 : 0.7); g.fillRect(x0, y + 18, bw * v, 9); L.text(g, v.toFixed(2), x0 + bw + 8, y + 27, { mono: true, size: 12, color: 'text' }); y += rh; }
      const px = Math.round(x0 + bw * PUBLISHED) + 0.5; g.strokeStyle = L.tokens().sim; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(px, 4); g.lineTo(px, y + 2); g.stroke(); g.setLineDash([]);
      L.text(g, 'Prithvi, published: 0.83', px - 6, y + 16, { color: 'sim', size: 11, align: 'right' }); L.text(g, 'on real images of other floods (Sen1Floods11). Not measured here; shown for scale only.', x0, y + 32, { color: 'text3', size: 10.5 });
      L.text(g, '0', x0, hh - 4, { color: 'text3', size: 10.5, mono: true }); L.text(g, 'intersection over union with the truth', x0 + bw / 2, hh - 4, { color: 'text3', size: 10.5, align: 'center' }); L.text(g, '1', x0 + bw, hh - 4, { color: 'text3', size: 10.5, mono: true, align: 'right' });
    };
    fCa.draw = (g, w, hh) => {
      if (!S) return; const J = S[P.method === 'net' ? 'net' : 'idx'], O = S[P.method === 'net' ? 'idx' : 'net'], tot = Math.max(1, S.nw), mx = Math.max(0.02, ...J.cause.map((c) => c / tot), ...O.cause.map((c) => c / tot));
      const lx = 96, bw = w - lx - 60, rh = Math.min(30, (hh - 22) / 5); let y = 4;
      CAUSES.forEach((name, i) => { const a = J.cause[i] / tot, b = O.cause[i] / tot; L.text(g, name, lx - 10, y + rh / 2 + 1, { align: 'right', base: 'middle', size: 11.5, color: 'text2' });
        g.fillStyle = L.rgba('text3', 0.35); g.fillRect(lx, y + rh / 2 + 3, (bw * b) / mx, 3); g.fillStyle = L.tokens()[i < 3 ? 'warn' : 'text2']; g.fillRect(lx, y + rh / 2 - 6, Math.max(1, (bw * a) / mx), 8);
        L.text(g, (a * 100).toFixed(1) + ' %', lx + (bw * Math.max(a, b)) / mx + 6, y + rh / 2 + 1, { base: 'middle', mono: true, size: 11, color: 'text' }); y += rh; });
      L.text(g, 'wrong pixels, as a share of the true flooded area. Thin grey bar: the other method.', lx, hh - 4, { color: 'text3', size: 10.5 });
    };

    const sIoU = L.stat('agreement with truth (IoU)'), sMiss = L.stat('of the flood missed', { unit: '%' }), sFalse = L.stat('false water, vs. true area', { unit: '%' }), sArea = L.stat('flooded in the truth', { unit: 'km²' });
    readout.append(L.h('h4', null, 'Measured against the simulated truth'), sIoU.el, sMiss.el, sFalse.el, sArea.el);
    function report() {
      const J = S[P.method === 'net' ? 'net' : 'idx'], nm = P.method === 'net' ? 'The tiny network' : 'The water index', worst = J.cause.indexOf(Math.max(...J.cause));
      sIoU.set(J.iou.toFixed(2)); sIoU.tone(J.iou > 0.75 ? 'ok' : J.iou > 0.5 ? 'warn' : 'danger'); sMiss.set(L.pct(J.fn / Math.max(1, S.nw))); sFalse.set(L.pct(J.fp / Math.max(1, S.nw))); sArea.set(((S.nw * CS * CS) / 1e6).toFixed(2));
      fIn.setTitle('Input: six colour bands from orbit, ' + (P.view === 'natural' ? 'shown as the eye would see them' : 'shown in infrared, where water goes dark'));
      fIn.setNote((dem.real ? 'Simulated image on the real elevation around Timure, Nepal (8.6 km across). ' : 'The elevation file did not load: an invented valley. ') + 'The flood is illustrative: not a forecast, not a reconstruction.');
      fOut.setTitle(nm + ' finds ' + L.pct(J.tp / Math.max(1, S.nw)) + ' % of the flooded area, and adds ' + L.pct(J.fp / Math.max(1, S.nw)) + ' % that is not water');
      fOut.setNote('Truth: where the water is in the simulation, from the height of each cell above the river it drains to.');
      fSc.setTitle(S.net.iou > S.idx.iou + 0.02 ? 'The trained network beats the hand-made index, ' + S.net.iou.toFixed(2) + ' to ' + S.idx.iou.toFixed(2) : S.idx.iou > S.net.iou + 0.02 ? 'Here the hand-made index beats the tiny network, ' + S.idx.iou.toFixed(2) + ' to ' + S.net.iou.toFixed(2) : 'The index and the tiny network score about the same here');
      fCa.setTitle(J.fp + J.fn ? 'What is still weak: most wrong pixels are ' + (worst === 4 ? 'scattered noise' : worst === 3 ? 'at the water edge' : CAUSES[worst]) : 'No wrong pixels in this draw');
      fCa.setNote('');
    }
    const redo = L.soon(compute);
    controls.append(
      L.seg({ label: 'Mapper', value: P.method, options: [{ value: 'idx', label: 'Water index' }, { value: 'net', label: 'Tiny network' }], onChange: (v) => { P.method = v; paint(); report(); } }).el,
      L.slider({ label: 'Flood stage above the river', min: 2, max: 24, step: 1, value: P.stage, unit: 'm', onInput: (v) => { P.stage = v; redo(); } }).el,
      L.slider({ label: 'Cloud cover', min: 0, max: 70, step: 1, value: P.cloud, unit: '%', onInput: (v) => { P.cloud = v; redo(); } }).el,
      L.slider({ label: 'Sun height', min: 15, max: 75, step: 1, value: P.sun, unit: '°', hint: 'A low sun fills the valley with shadow.', onInput: (v) => { P.sun = v; redo(); } }).el,
      L.toggle({ label: 'Also give the network the terrain slope', value: P.slope, hint: 'Water lies flat. Retrains the network with slope as a seventh input.', onChange: (v) => { P.slope = v; net = train(v); compute(); } }).el,
      L.row(L.seg({ label: 'Show the input as', value: P.view, options: [{ value: 'natural', label: 'Natural colour' }, { value: 'ir', label: 'Infrared' }], onChange: (v) => { P.view = v; paint(); report(); } }).el),
      L.row(L.button({ label: 'New clouds', icon: 'reset', onClick: () => { P.seed++; redo(); } })));

    loadDem().then((d) => {
      dem = d; const z = d.z; H = hydrology(z); slope = new Float32Array(N * N); gE = new Float32Array(N * N); gN = new Float32Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i; gE[k] = (z[j * N + Math.min(N - 1, i + 1)] - z[j * N + Math.max(0, i - 1)]) / (2 * CS); gN[k] = (z[Math.max(0, j - 1) * N + i] - z[Math.min(N - 1, j + 1) * N + i]) / (2 * CS); slope[k] = Math.atan(Math.hypot(gE[k], gN[k])); }
      net = train(P.slope); netS = net; compute(); void netS;
    });
    return { start() { if (S) paint(); }, stop() {} };
  },
};
