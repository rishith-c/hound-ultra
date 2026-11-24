// Exhibit 06: skin, by its spectrum. Concept hardware: HOUND has no short-wave infrared camera. The cube is simulated from
// assumed reflectance curves; the index and the decision are live maths on every pixel, checked against the simulated truth.
const W = 360, H = 203, CX = 300, CY = 430, CW = 720;
const LAM = [450, 550, 650, 800, 950, 1080, 1200, 1300, 1450, 1580, 1700];
const MAT = [['Skin', '--person'], ['Wet mud', '--warn'], ['Concrete', '--text-2'], ['Leaves', '--ok'], ['Cloth', '--accent']];
const REF = [[.22, .28, .48, .60, .56, .56, .40, .41, .07, .14, .17], [.06, .09, .13, .18, .21, .24, .23, .24, .10, .19, .22], [.25, .30, .34, .37, .38, .39, .39, .40, .35, .40, .41], [.04, .09, .05, .46, .46, .45, .36, .37, .12, .24, .22], [.14, .10, .24, .52, .56, .58, .58, .58, .52, .55, .54]];
const SKIN = [[907, 587, 8], [401, 573, 6.5], [384, 541, 5], [940, 664, 4], [937, 624, 3.5]];
const refl = (m, l) => { let i = 0; while (i < LAM.length - 2 && LAM[i + 1] < l) i++; const u = (l - LAM[i]) / (LAM[i + 1] - LAM[i]); return REF[m][i] * (1 - u) + REF[m][i + 1] * u; };

export async function create(el, ctx, lab, def) {
  const { h, icon } = ctx.kit;
  const F = lab.frame(el, { n: def.n, title: def.title, tags: def.tags, lede: ['Human skin is mostly water, so it goes dark just past 1400 nanometres while cloth and dry rubble do not.', 'This page builds a simulated spectral picture of one frame, computes a skin index for every pixel, and counts what it gets right.'] });
  const P = { view: 'index', lam: 1080, thr: 0.45, snr: 60, mud: 0.2, bin: 1, rule: true, hover: null };
  const im = await lab.loadImage(lab.asset('assets/img/gen/aerial-01.jpg')), src = document.createElement('canvas'); src.width = W; src.height = H; const sg = src.getContext('2d', { willReadFrequently: true }); sg.imageSmoothingQuality = 'high'; sg.drawImage(im, CX, CY, CW, CW * H / W, 0, 0, W, H);
  const px = sg.getImageData(0, 0, W, H).data, N = W * H, mat = new Uint8Array(N), tex = new Float32Array(N); let truthN = 0;
  for (let i = 0; i < N; i++) { const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], l = (r + g + b) / 3, ix = CX + (i % W + 0.5) * CW / W, iy = CY + ((i / W | 0) + 0.5) * CW / W; let m = g > r * 1.06 && g > b * 1.12 ? 3 : b > r * 1.25 || r > g * 1.75 ? 4 : l > 112 ? 2 : 1; for (const [x, y, q] of SKIN) if (Math.hypot(ix - x, iy - y) < q && r > g && l > 90 && r > b * 1.12) m = 0; mat[i] = m; tex[i] = Math.min(1.7, Math.max(0.4, l / [140, 70, 135, 60, 70][m])); if (!m) truthN++; }
  const rnd = lab.rng(8), Z = new Float32Array(N * 4); for (let i = 0; i < Z.length; i++) Z[i] = lab.gauss(rnd);
  const BANDS = [1080, 1580, 540, 660], band = BANDS.map(() => new Float32Array(N)), idx = new Float32Array(N), veg = new Float32Array(N), hit = new Uint8Array(N), T = new Uint8Array(N); let gw = W, gh = H, res = null, ms = 0;
  function compute() {
    const t0 = performance.now(), b = P.bin; gw = Math.floor(W / b); gh = Math.floor(H / b); const n = gw * gh;
    BANDS.forEach((l, k) => { const R = MAT.map((_, m) => (m === 0 ? (1 - P.mud) * refl(0, l) + P.mud * refl(1, l) : refl(m, l))); for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let s = 0; for (let j = 0; j < b; j++) for (let i = 0; i < b; i++) { const q = (y * b + j) * W + x * b + i; s += R[mat[q]] * tex[q]; } const o = y * gw + x; band[k][o] = s / (b * b) + Z[k * N + o] * 0.3 / P.snr; } });
    let tp = 0, fp = 0, fn = 0, tr = 0; for (let o = 0; o < n; o++) { let c = 0; const x = o % gw, y = o / gw | 0; for (let j = 0; j < b; j++) for (let i = 0; i < b; i++) if (!mat[(y * b + j) * W + x * b + i]) c++; T[o] = c * 2 >= b * b ? 1 : 0; const A = band[0][o], B = band[1][o], g = band[2][o], r = band[3][o]; idx[o] = (A - B) / Math.max(1e-4, A + B); veg[o] = (g - r) / Math.max(1e-4, g + r); hit[o] = idx[o] > P.thr && (!P.rule || veg[o] < 0) ? 1 : 0; tr += T[o]; if (hit[o]) (T[o] ? tp++ : fp++); else if (T[o]) fn++; }
    res = { tp, fp, fn, tr, n }; ms = performance.now() - t0;
  }
  // ---------- stage ----------
  const views = [['colour', 'Colour camera'], ['band', 'One band'], ['index', 'Skin index'], ['find', 'Found']];
  const seg = h('div.seg', { role: 'group', 'aria-label': 'What the picture shows' }, views.map(([id, t]) => h('button', { 'aria-pressed': String(P.view === id), onclick: (e) => { P.view = id; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); paint(); } }, t)));
  const cv = h('canvas.vision-x-canvas', { role: 'img', 'aria-label': 'Simulated spectral picture', onpointermove: (e) => { const r = cv.getBoundingClientRect(); P.hover = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; chart(); tip(); }, onpointerleave: () => { P.hover = null; chart(); tip(); } });
  const chartC = h('canvas.vision-x-chart', { role: 'img', 'aria-label': 'Assumed reflectance of five materials against wavelength' }), tipEl = h('span.num'), lamLbl = h('span');
  F.stage.append(h('div.vision-stagebar', null, seg, h('span.grow'), lamLbl), h('div.vision-x-screen', null, cv), h('figure.vision-x-fig', null, h('figcaption', null, 'Skin falls by three quarters between 1080 and 1580 nm. Wet mud falls by a fifth.'), chartC), h('div.vision-stagefoot', null, tipEl));
  const off = document.createElement('canvas');
  function paint() {
    off.width = gw; off.height = gh; const g = off.getContext('2d'), d = g.createImageData(gw, gh), q = d.data; let lo = 0, hi = 0.7;
    const R = MAT.map((_, m) => (m === 0 ? (1 - P.mud) * refl(0, P.lam) + P.mud * refl(1, P.lam) : refl(m, P.lam)));
    for (let o = 0; o < gw * gh; o++) { const x = o % gw, y = o / gw | 0, i = (y * P.bin) * W + x * P.bin, j = o * 4; let c; if (P.view === 'colour') c = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]; else if (P.view === 'band') { const v = Math.min(255, 330 * (R[mat[i]] * tex[i] + Z[o] * 0.3 / P.snr)); c = [v, v, v]; } else if (P.view === 'index') c = lab.HEAT(Math.max(0, Math.min(1, (idx[o] - lo) / (hi - lo)))); else { const l = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3 * 0.35; c = hit[o] ? (T[o] ? [255, 106, 69] : [255, 194, 74]) : T[o] ? [90, 169, 255] : [l, l, l]; } q[j] = c[0]; q[j + 1] = c[1]; q[j + 2] = c[2]; q[j + 3] = 255; }
    g.putImageData(d, 0, 0); const r = cv.parentElement.getBoundingClientRect(); if (!r.width) return; const s = Math.min((r.width - 24) / W, (r.height - 16) / H), dpr = Math.min(2, devicePixelRatio || 1); cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px'; cv.width = W * s * dpr; cv.height = H * s * dpr; const c = cv.getContext('2d'); c.imageSmoothingEnabled = P.view === 'colour'; c.drawImage(P.view === 'colour' && P.bin === 1 ? src : off, 0, 0, cv.width, cv.height);
    lamLbl.textContent = { colour: 'What a person would see', band: P.lam + ' nm, simulated', index: 'Index from 0 (dark) to 0.7 (bright)', find: 'Orange found, blue missed, amber false alarm' }[P.view];
  }
  function chart() {
    const r = chartC.getBoundingClientRect(); if (!r.width) return; const dpr = Math.min(2, devicePixelRatio || 1); chartC.width = r.width * dpr; chartC.height = r.height * dpr; const g = chartC.getContext('2d'); g.scale(dpr, dpr); const L = 40, B = 24, Tt = 8, w = r.width - L - 84, hh = r.height - B - Tt, X = (l) => L + (l - 450) / 1250 * w, Y = (v) => Tt + hh * (1 - v / 0.7);
    g.font = '11px ' + lab.tok('--font'); g.fillStyle = lab.tok('--text-3'); g.strokeStyle = lab.tok('--line'); g.lineWidth = 1; for (const v of [0, 0.2, 0.4, 0.6]) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(L + w, Y(v)); g.stroke(); g.textAlign = 'right'; g.fillText(Math.round(v * 100) + ' %', L - 6, Y(v) + 4); } g.textAlign = 'center'; for (const l of [500, 750, 1000, 1250, 1500]) g.fillText(l + ' nm', X(l), r.height - 6);
    for (const l of [1080, 1580]) { g.fillStyle = lab.tok('--accent-soft'); g.fillRect(X(l) - 5, Tt, 10, hh); } g.strokeStyle = lab.tok('--text-3'); g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(P.lam), Tt); g.lineTo(X(P.lam), Tt + hh); g.stroke(); g.setLineDash([]);
    let hm = -1; if (P.hover) { const x = Math.min(W - 1, P.hover[0] * W | 0), y = Math.min(H - 1, P.hover[1] * H | 0); hm = mat[y * W + x]; }
    const used = []; MAT.map((m, i) => [i, refl(i, 1700)]).sort((a, b) => a[1] - b[1]).forEach(([m, v]) => { g.globalAlpha = hm < 0 || hm === m ? 1 : 0.3; g.strokeStyle = g.fillStyle = lab.tok(MAT[m][1]); g.lineWidth = m === 0 ? 2.2 : 1.4; g.beginPath(); LAM.forEach((l, i) => (i ? g.lineTo(X(l), Y(REF[m][i])) : g.moveTo(X(l), Y(REF[m][i])))); g.stroke(); let y = Y(v) + 4; while (used.some((u) => Math.abs(u - y) < 13)) y -= 1; used.push(y); g.textAlign = 'left'; g.fillText(MAT[m][0], L + w + 8, y); }); g.globalAlpha = 1;
  }
  function tip() { if (!P.hover) { tipEl.textContent = 'Point at the picture to read a pixel.'; return; } const x = Math.min(gw - 1, P.hover[0] * gw | 0), y = Math.min(gh - 1, P.hover[1] * gh | 0), o = y * gw + x; tipEl.textContent = MAT[mat[Math.min(N - 1, y * P.bin * W + x * P.bin)]][0] + ' (simulated)  ·  1080 nm ' + band[0][o].toFixed(2) + '  ·  1580 nm ' + band[1][o].toFixed(2) + '  ·  index ' + idx[o].toFixed(2); }
  const ro = { hit: lab.readout('skin pixels found'), fa: lab.readout('false alarms'), ms: lab.readout('to score the frame', 'ms') };
  const upd = () => { compute(); paint(); chart(); tip(); ro.hit.set(res.tr ? Math.round(100 * res.tp / res.tr) + ' %' : '–', res.tp + ' of ' + res.tr + ' true skin pixels'); ro.fa.set(String(res.fp), 'false alarms in ' + res.n.toLocaleString('en')); ro.ms.set(ms.toFixed(1)); };
  const S = (o) => lab.slider({ assumed: true, ...o });
  F.section('Against the simulated truth', h('div.vision-readouts', null, ro.hit.el, ro.fa.el, ro.ms.el));
  F.section('The decision', lab.slider({ label: 'Skin index above', min: 0, max: 0.7, step: 0.01, value: P.thr, fmt: (v) => v.toFixed(2), onInput: (v) => { P.thr = v; upd(); } }), h('label.check', null, h('input', { type: 'checkbox', checked: true, onchange: (e) => { P.rule = e.target.checked; upd(); } }), 'Reject leaves (greener than red)'));
  F.section('The world', S({ label: 'Mud over the skin', min: 0, max: 1, step: 0.02, value: P.mud, fmt: (v) => Math.round(v * 100) + ' %', onInput: (v) => { P.mud = v; upd(); } }), S({ label: 'Signal to noise', min: 5, max: 120, step: 1, value: P.snr, fmt: (v) => v + ' to 1', onInput: (v) => { P.snr = v; upd(); } }), S({ label: 'Pixel on the ground', min: 1, max: 8, step: 1, value: 1, fmt: (v) => (v * CW / W * 1.982).toFixed(1) + ' cm', onInput: (v) => { P.bin = v; upd(); } }), lab.slider({ label: 'Band shown', min: 450, max: 1700, step: 10, value: P.lam, fmt: (v) => v + ' nm', onInput: (v) => { P.lam = v; P.view === 'band' ? paint() : 0; chart(); } }));
  F.dossier({ research: [
    { title: 'Detection of human skin in near infrared hyperspectral imagery', who: 'Nunez and Mendenhall', year: 'IGARSS 2008', url: 'https://doi.org/10.1109/IGARSS.2008.4779069', note: 'The skin index, proposed for search and rescue.' },
    { title: 'Human skin detection in the visible and near infrared', who: 'Mendenhall, Nunez and Martin', year: 'Applied Optics 2015', url: 'https://www.researchgate.net/publication/286524301_Human_skin_detection_in_the_visible_and_near_infrared', note: 'Uses 1080 and 1580 nm, with a green-red index to reject plants.' }],
    field: 'HOUND would need a short-wave infrared camera with both bands, daylight or its own lamp, and bare skin facing up that fills a good part of a pixel. Unknown: how wet dust, blood and shade move these curves. The curves here are assumed shapes, not measurements.',
    failure: 'Cover the skin with 60 % mud and all 65 skin pixels are missed; at 40 % mud, 12 of 65. Make the pixel 32 cm wide and no pixel is mostly skin any more. Switch off the plant rule and lower the threshold to 0.25, and 59 other pixels are called skin.' });
  const obs = new ResizeObserver(() => { paint(); chart(); }); obs.observe(F.stage); upd();
  el._skin = { P, upd, get res() { return res; } };
  return { onShow() { upd(); }, onHide() {}, onPrefs() { chart(); } };
}
