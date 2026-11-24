// 01 Search by words. Open-vocabulary search of one frame with MobileCLIP-S0, running in this page.
// The frame is cut into overlapping tiles at three scales; every tile is embedded once; each query is one text embedding
// and a few hundred dot products, which is why the heat map can follow the typing.
const REPO = 'Xenova/mobileclip_s0';
const BACKGROUND = ['rubble', 'mud', 'bare ground', 'broken concrete', 'debris', 'a roof', 'water', 'vegetation'];
const TEMPLATES = ['a photo of {}', 'an aerial photo of {}'];
const SUGGEST = ['a red jacket', 'a person lying down', 'a person waving', 'a yellow raincoat', 'a backpack', 'a blue barrel', 'a hand', 'a tin roof', 'standing water', 'a door'];
const SCALES = [{ k: 3, label: 'Coarse', hint: 'a third of the frame' }, { k: 5, label: 'Medium', hint: 'a fifth' }, { k: 8, label: 'Fine', hint: 'an eighth' }];

export async function create(el, ctx, lab, def) {
  const { h, icon } = ctx.kit;
  const f = lab.frame(el, { n: def.n, title: def.title, tags: def.tags, lede: ['Type what you are looking for and a vision-language model scores every part of the frame against your words.', 'It was never trained on “red jacket” or “blue barrel” as classes: it learned pictures and sentences together, so one model can look for anything you can describe.'] });

  const vision = lab.model({ key: 'mobileclip-vision', name: 'MobileCLIP-S0, image encoder', repo: REPO, role: 'Turns an image tile into 512 numbers', mb: 45.5,
    what: 'A small contrastive image-text model from Apple (2024). The image half runs once per tile.',
    variants: [{ device: 'webgpu', dtype: 'fp32', mb: 45.5 }, { device: 'wasm', dtype: 'q8', mb: 11.8 }],
    make: async (T, o) => ({ T, model: await T.CLIPVisionModelWithProjection.from_pretrained(REPO, o), proc: await T.AutoProcessor.from_pretrained(REPO) }) });
  const text = lab.model({ key: 'mobileclip-text', name: 'MobileCLIP-S0, text encoder', repo: REPO, role: 'Turns your words into 512 numbers', mb: 42.8,
    what: 'The text half. One short run per query; its output is compared with every tile by a dot product.',
    variants: [{ device: 'wasm', dtype: 'q8', mb: 42.8 }],
    make: async (T, o) => ({ T, model: await T.CLIPTextModelWithProjection.from_pretrained(REPO, o), tok: await T.AutoTokenizer.from_pretrained(REPO) }) });

  // ---------- state ----------
  const S = { index: null, indexing: null, q: '', result: null, scales: new Set([3, 5, 8]), mode: 'contrast', alpha: 0.72, sel: -1, hover: null, bg: null, timings: {} };
  const textCache = new Map();

  // ---------- stage ----------
  const input = h('input.input.vision-words-input', { type: 'search', placeholder: 'Describe what you are looking for, for example “a red jacket”', 'aria-label': 'What to look for', spellcheck: 'false', autocomplete: 'off',
    oninput: () => { S.q = input.value.trim(); if (ready()) schedule(); }, onkeydown: (e) => { if (e.key === 'Enter') { S.q = input.value.trim(); run(); } } });
  const go = h('button.btn.btn-primary', { onclick: () => { S.q = input.value.trim() || SUGGEST[0]; if (!input.value.trim()) input.value = S.q; run(); } }, icon('search'), h('span', null, 'Load models and search · 88 MB'));
  const chips = h('div.vision-words-chips', { role: 'group', 'aria-label': 'Example searches' }, SUGGEST.map((s) => h('button.chip', { onclick: () => { input.value = s; S.q = s; run(); } }, s)));
  const busy = h('div.vision-busy', { hidden: true }, h('div.spinner'), h('p'));
  const foot = h('div.vision-stagefoot', null, h('span', null, 'Load the two models, then type. Nothing has been downloaded yet.'));
  const strip = h('div.vision-words-strip', { 'aria-label': 'Best matching crops, ranked' });
  const vpHost = h('div.vision-words-vp');
  f.stage.append(h('div.vision-stagebar.vision-words-bar', null, h('div.vision-words-q', null, icon('search', 16), input), go), chips, vpHost, strip, foot);
  vpHost.append(busy);
  lab.dropTarget(f.stage);
  const tip = h('div.vision-pill.vision-words-tip', { hidden: true });
  vpHost.append(tip);

  const vp = lab.viewport(vpHost, {
    onMove: (p, e) => {
      if (!p || !S.result) { tip.hidden = true; return; }
      const R = S.result, gx = Math.min(R.gw - 1, Math.floor(p[0] / S.index.w * R.gw)), gy = Math.min(R.gh - 1, Math.floor(p[1] / S.index.h * R.gh)), v = R.grid[gy * R.gw + gx], raw = R.rawGrid[gy * R.gw + gx];
      const r = vpHost.getBoundingClientRect(); tip.hidden = false; tip.style.left = Math.min(r.width - 190, e.clientX - r.left + 14) + 'px'; tip.style.top = (e.clientY - r.top + 14) + 'px';
      tip.replaceChildren(h('span', null, 'match '), h('span.num', null, v.toFixed(2)), h('span', null, ' · cosine '), h('span.num', null, raw.toFixed(3)));
    },
    onLeave: () => { tip.hidden = true; },
    onClick: (p) => { if (!S.result) return; const i = S.result.top.findIndex((t) => p[0] >= t.x && p[0] <= t.x + t.s && p[1] >= t.y && p[1] <= t.y + t.s); select(i); },
  });
  const heatCanvas = document.createElement('canvas');
  vp.draw = (g, v) => {
    const R = S.result, { x, y, w, h: hh, s } = v.rect; if (!R) return;
    g.save(); g.globalAlpha = S.alpha; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(heatCanvas, x, y, w, hh); g.restore();
    R.top.forEach((t, i) => {
      const bx = x + t.x * s, by = y + t.y * s, bs = t.s * s, on = i === S.sel, c = on ? lab.tok('--text') : lab.tok('--accent');
      g.strokeStyle = c; g.lineWidth = on ? 2 : 1.25; g.globalAlpha = on || S.sel < 0 ? 1 : 0.55;
      const L = Math.min(14, bs / 3);
      for (const [cx, cy, dx, dy] of [[bx, by, 1, 1], [bx + bs, by, -1, 1], [bx, by + bs, 1, -1], [bx + bs, by + bs, -1, -1]]) { g.beginPath(); g.moveTo(cx + dx * L, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + dy * L); g.stroke(); }
      if (on) { g.globalAlpha = 0.5; g.strokeRect(bx + 0.5, by + 0.5, bs - 1, bs - 1); g.globalAlpha = 1; }
      g.font = '600 11px ' + lab.tok('--mono'); const lbl = String(i + 1), tw = g.measureText(lbl).width + 8;
      g.fillStyle = c; g.fillRect(bx, by - 15 < y ? by : by - 15, tw, 15); g.fillStyle = lab.tok('--bg-0'); g.textBaseline = 'middle'; g.fillText(lbl, bx + 4, (by - 15 < y ? by : by - 15) + 8);
    });
    g.globalAlpha = 1;
  };

  // ---------- side ----------
  const picker = lab.picker();
  const imgNote = h('p.caption');
  f.section('Frame', picker, imgNote);
  const scaleBox = h('div.vision-words-scales', null, SCALES.map((sc) => h('label.check', { title: 'Tiles ' + sc.hint + ' wide, half overlapping' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { e.target.checked ? S.scales.add(sc.k) : S.scales.delete(sc.k); if (!S.scales.size) { S.scales.add(sc.k); e.target.checked = true; } S.index = null; if (ready()) run(); } }), sc.label)));
  const modeSeg = h('div.seg', { role: 'group', 'aria-label': 'How tiles are scored' },
    h('button', { 'aria-pressed': 'true', title: 'Softmax of your words against eight plain descriptions of debris. High means: looks more like your words than like background.', onclick: (e) => setMode('contrast', e.target) }, 'Against background'),
    h('button', { 'aria-pressed': 'false', title: 'The raw cosine similarity between tile and words, stretched to the range found in this frame.', onclick: (e) => setMode('raw', e.target) }, 'Raw similarity'));
  const setMode = (m, b) => { S.mode = m; modeSeg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); if (S.index && S.q) query(); };
  const ro = { tiles: lab.readout('tiles indexed', ''), per: lab.readout('per tile', 'ms'), q: lab.readout('per query', 'ms') };
  f.section('Search', h('div.vision-readouts', null, ro.tiles.el, ro.per.el, ro.q.el),
    h('div.vision-field', null, h('span', null, 'Tile sizes'), h('span'), scaleBox),
    h('div.row.between', null, h('span.label', null, 'Score'), modeSeg),
    lab.slider({ label: 'Heat map strength', min: 0, max: 1, step: 0.02, value: S.alpha, fmt: (v) => Math.round(v * 100) + ' %', onInput: (v) => { S.alpha = v; vp.redraw(); } }),
    h('div.legend', null, h('span', null, 'no match'), h('span.ramp'), h('span', null, 'strong match')));
  f.section('Why this matters', h('p', null, 'A detector finds only the classes it was trained on. A team that learns the missing person wore a yellow raincoat cannot retrain a detector on site, but it can type three words. The same index answers every later question about this frame without running the image model again.'));
  f.section('Models', vision.view(), text.view());
  f.dossier({
    research: [
      { title: 'MobileCLIP: fast image-text models through multi-modal reinforced training', who: 'Vasu, Pouransari, Faghri, Vemulapalli, Tuzel (Apple)', year: 'CVPR 2024', url: 'https://arxiv.org/abs/2311.17049', note: 'The model running here.' },
      { title: 'Learning transferable visual models from natural language supervision (CLIP)', who: 'Radford et al. (OpenAI)', year: '2021', url: 'https://arxiv.org/abs/2103.00020', note: 'The idea: train on image and caption pairs, then search by text.' },
    ],
    field: 'The drone would have to send frames sharp enough that the thing you describe covers tens of pixels, and someone has to choose good words. Unknown: how it behaves on real flood imagery at night or in rain. These sample frames are AI-generated illustrations, so nothing here measures field accuracy.',
    failure: 'It scores resemblance, not presence. On frame E, which has no people, “a person lying down” still returns ranked crops, and a red cloth outranks everything for “a red jacket”. A top crop is a place to look, never a finding.',
  });

  // ---------- indexing ----------
  const ready = () => vision.status === 'ready' && text.status === 'ready';
  const setBusy = (msg) => { busy.hidden = !msg; if (msg) busy.lastChild.textContent = msg; };
  function tilesFor(w, hh) {
    const out = [];
    for (const k of [...S.scales].sort()) {
      const s = Math.round(Math.max(w, hh) / k), stride = s / 2, nx = Math.max(1, Math.ceil((w - s) / stride) + 1), ny = Math.max(1, Math.ceil((hh - s) / stride) + 1);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push({ x: Math.round(nx === 1 ? (w - s) / 2 : i * (w - s) / (nx - 1)), y: Math.round(ny === 1 ? (hh - s) / 2 : j * (hh - s) / (ny - 1)), s: Math.min(s, w, hh), k });
    }
    return out;
  }
  async function buildIndex() {
    const im = lab.image; if (!im) return null;
    const key = im.id + ':' + im.canvas.width + ':' + [...S.scales].sort().join(',');
    if (S.index?.key === key) return S.index;
    if (S.indexing?.key === key) return S.indexing.promise;
    const promise = (async () => {
      const { T, model, proc } = await vision.ensure();
      const ip = proc.image_processor || proc.feature_extractor || proc, cfg = ip.config || ip;
      const side = (cfg.crop_size?.height || cfg.crop_size || cfg.size?.height || cfg.size?.shortest_edge || 256) | 0, mean = cfg.do_normalize === false ? [0, 0, 0] : (cfg.image_mean || [0, 0, 0]), std = cfg.do_normalize === false ? [1, 1, 1] : (cfg.image_std || [1, 1, 1]);
      const tiles = tilesFor(im.canvas.width, im.canvas.height), n = tiles.length, D = 512, emb = new Float32Array(n * D);
      const c = document.createElement('canvas'); c.width = c.height = side; const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high';
      const B = vision.device === 'webgpu' ? 16 : 4, plane = side * side; const t0 = performance.now(); let inferMs = 0;
      for (let b = 0; b < n; b += B) {
        const m = Math.min(B, n - b), data = new Float32Array(m * 3 * plane);
        for (let i = 0; i < m; i++) {
          const t = tiles[b + i]; g.drawImage(im.canvas, t.x, t.y, t.s, t.s, 0, 0, side, side);
          const px = g.getImageData(0, 0, side, side).data, o = i * 3 * plane;
          for (let p = 0, q = 0; p < plane; p++, q += 4) { data[o + p] = (px[q] / 255 - mean[0]) / std[0]; data[o + plane + p] = (px[q + 1] / 255 - mean[1]) / std[1]; data[o + 2 * plane + p] = (px[q + 2] / 255 - mean[2]) / std[2]; }
        }
        const ti = performance.now();
        const { image_embeds } = await model({ pixel_values: new T.Tensor('float32', data, [m, 3, side, side]) });
        inferMs += performance.now() - ti;
        const e = image_embeds.data;
        for (let i = 0; i < m; i++) { let s2 = 0; for (let d = 0; d < D; d++) s2 += e[i * D + d] ** 2; const inv = 1 / Math.sqrt(s2 || 1); for (let d = 0; d < D; d++) emb[(b + i) * D + d] = e[i * D + d] * inv; }
        setBusy('Indexing the frame: tile ' + Math.min(n, b + m) + ' of ' + n);
        if (lab.image !== im) return null;                       // the visitor picked another image meanwhile
        await new Promise((r) => setTimeout(r));
      }
      const ms = performance.now() - t0;
      vision.ran(inferMs / Math.ceil(n / B));
      return { key, tiles, emb, n, D, w: im.canvas.width, h: im.canvas.height, ms, inferMs, per: ms / n, device: vision.device };
    })();
    S.indexing = { key, promise };
    try { const idx = await promise; if (idx) S.index = idx; return idx; } finally { if (S.indexing?.key === key) S.indexing = null; }
  }
  async function embedText(list) {
    const { T, model, tok } = await text.ensure();
    const todo = list.filter((s) => !textCache.has(s));
    if (todo.length) {
      const t0 = performance.now();
      const { text_embeds } = await model(tok(todo, { padding: 'max_length', truncation: true }));
      text.ran((performance.now() - t0) / todo.length);
      const e = text_embeds.data, D = 512;
      todo.forEach((s, i) => { const v = new Float32Array(D); let s2 = 0; for (let d = 0; d < D; d++) { v[d] = e[i * D + d]; s2 += v[d] * v[d]; } const inv = 1 / Math.sqrt(s2 || 1); for (let d = 0; d < D; d++) v[d] *= inv; textCache.set(s, v); });
    }
    return list.map((s) => textCache.get(s));
  }
  // The embedding of a phrase: the mean of its two prompt templates, renormalised.
  async function phrase(q) {
    const vs = await embedText(TEMPLATES.map((t) => t.replace('{}', q))), D = 512, v = new Float32Array(D);
    for (const a of vs) for (let d = 0; d < D; d++) v[d] += a[d];
    let s2 = 0; for (let d = 0; d < D; d++) s2 += v[d] * v[d]; const inv = 1 / Math.sqrt(s2 || 1); for (let d = 0; d < D; d++) v[d] *= inv; return v;
  }

  let timer = 0, token = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 220); };
  async function run() {
    if (!lab.image) return;
    const my = ++token;
    try {
      go.disabled = true;
      if (!ready()) setBusy('Loading the two models. They are cached after the first time.');
      await Promise.all([vision.ensure(), text.ensure()]);
      go.lastChild.textContent = 'Search';
      if (!S.index || S.index.key.split(':')[0] !== lab.image.id) setBusy('Indexing the frame');
      const idx = await buildIndex(); if (!idx || my !== token) return;
      ro.tiles.set(String(idx.n), 'tiles indexed in ' + lab.fmtMs(idx.ms)); ro.per.set(idx.per.toFixed(1), 'per tile, with cropping');
      if (S.q) await query();
      else foot.replaceChildren(h('span', null, 'The frame is indexed. Type a description.'));
    } catch (e) {
      console.warn('[vision] word search failed', e);
      foot.replaceChildren(h('span.c-danger', null, 'The search could not run: ' + String(e.message || e).slice(0, 160)));
    } finally { if (my === token) { setBusy(''); go.disabled = false; } }
  }
  async function query() {
    const idx = S.index, q = S.q; if (!idx || !q) return;
    const t0 = performance.now();
    const qv = await phrase(q);
    S.bg ||= await Promise.all(BACKGROUND.map(phrase));
    const tText = performance.now() - t0, t1 = performance.now();
    const { n, D, emb, tiles } = idx, raw = new Float32Array(n), score = new Float32Array(n);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      let s = 0; const o = i * D; for (let d = 0; d < D; d++) s += emb[o + d] * qv[d]; raw[i] = s; if (s < lo) lo = s; if (s > hi) hi = s;
    }
    if (S.mode === 'contrast') {
      for (let i = 0; i < n; i++) { const o = i * D; let den = Math.exp(100 * (raw[i] - hi)); const num = den; for (const b of S.bg) { let s = 0; for (let d = 0; d < D; d++) s += emb[o + d] * b[d]; den += Math.exp(100 * (s - hi)); } score[i] = num / den; }
    } else for (let i = 0; i < n; i++) score[i] = (raw[i] - lo) / (hi - lo || 1);
    // heat map: every tile spreads its score over the pixels it covers with a tent weight; fine tiles localise, coarse tiles give context
    const gw = 96, gh = Math.max(8, Math.round(96 * idx.h / idx.w)), acc = new Float32Array(gw * gh), wsum = new Float32Array(gw * gh), racc = new Float32Array(gw * gh);
    for (let i = 0; i < n; i++) {
      const t = tiles[i], x0 = Math.floor(t.x / idx.w * gw), x1 = Math.min(gw - 1, Math.ceil((t.x + t.s) / idx.w * gw)), y0 = Math.floor(t.y / idx.h * gh), y1 = Math.min(gh - 1, Math.ceil((t.y + t.s) / idx.h * gh)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + 0.5, ry = (y1 - y0) / 2 + 0.5;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const wgt = (1 - Math.abs(x - cx) / rx) * (1 - Math.abs(y - cy) / ry) * (t.k / 3); if (wgt <= 0) continue; const p = y * gw + x; acc[p] += wgt * score[i]; racc[p] += wgt * raw[i]; wsum[p] += wgt; }
    }
    let glo = Infinity, ghi = -Infinity; for (let p = 0; p < acc.length; p++) { acc[p] /= wsum[p] || 1; racc[p] /= wsum[p] || 1; if (acc[p] < glo) glo = acc[p]; if (acc[p] > ghi) ghi = acc[p]; }
    heatCanvas.width = gw; heatCanvas.height = gh; const hg = heatCanvas.getContext('2d'), id = hg.createImageData(gw, gh);
    for (let p = 0; p < acc.length; p++) { const u = (acc[p] - glo) / (ghi - glo || 1), c = lab.HEAT(u); id.data[4 * p] = c[0]; id.data[4 * p + 1] = c[1]; id.data[4 * p + 2] = c[2]; id.data[4 * p + 3] = 255 * Math.min(1, 0.25 + 0.9 * u * u); }
    hg.putImageData(id, 0, 0);
    // ranked crops: best tiles, skipping ones that overlap a better tile by more than a third
    const order = [...score.keys()].sort((a, b) => score[b] - score[a]), top = [];
    for (const i of order) { const t = tiles[i]; if (top.every((u) => iou(t, u) < 0.3)) top.push({ ...t, i, score: score[i], raw: raw[i] }); if (top.length === 6) break; }
    const tRank = performance.now() - t1;
    S.result = { q, grid: acc, rawGrid: racc, gw, gh, top, lo, hi }; S.sel = -1;
    ro.q.set((tText + tRank).toFixed(tText + tRank < 10 ? 1 : 0), 'per query: words ' + lab.fmtMs(tText) + ', ranking ' + lab.fmtMs(tRank));
    foot.replaceChildren(h('span', null, 'Searched ', h('b.num', null, String(n)), ' tiles for “' + q + '”.'), h('span', null, 'Cosine in this frame ', h('span.num', null, lo.toFixed(3) + ' to ' + hi.toFixed(3))), h('div.grow'), h('span', null, 'A high score means “looks like the words”, not “is there”.'));
    paintStrip(); vp.redraw();
  }
  const iou = (a, b) => { const x = Math.max(0, Math.min(a.x + a.s, b.x + b.s) - Math.max(a.x, b.x)), y = Math.max(0, Math.min(a.y + a.s, b.y + b.s) - Math.max(a.y, b.y)), I = x * y; return I / (a.s * a.s + b.s * b.s - I); };

  function select(i) { S.sel = i; strip.querySelectorAll('.vision-words-crop').forEach((b, k) => b.setAttribute('aria-pressed', String(k === i))); vp.redraw(); }
  function paintStrip() {
    const R = S.result, im = lab.image; if (!R || !im) { strip.replaceChildren(h('p.caption', null, 'The six best crops appear here, ranked.')); return; }
    const best = R.top[0]?.score || 1;
    strip.replaceChildren(h('div.vision-words-striphead', null, h('b', null, 'Best crops for “' + R.q + '”'), h('span', null, 'ranked by ' + (S.mode === 'contrast' ? 'match against background' : 'raw similarity'))), h('div.vision-words-crops', null, R.top.map((t, i) => {
      const c = h('canvas', { width: 208, height: 130 }); c.getContext('2d').drawImage(im.canvas, t.x, t.y + t.s * 0.1875, t.s, t.s * 0.625, 0, 0, 208, 130);
      const size = im.gsd ? (t.s * im.gsd).toFixed(1) + ' m' : Math.round(t.s) + ' px';
      return h('button.vision-words-crop', { 'aria-pressed': 'false', title: 'Rank ' + (i + 1) + '. Tile ' + size + ' wide. Click to mark it on the frame.', onclick: () => select(S.sel === i ? -1 : i), ondblclick: () => lab.open('outline', { point: [t.x + t.s / 2, t.y + t.s / 2] }) },
        c, h('span.vision-words-rank.num', null, String(i + 1)), h('span.vision-words-meta', null, h('span.num', null, t.score.toFixed(2)), h('i', { style: { width: Math.max(4, 100 * t.score / best) + '%' } }), h('span.num.dim', null, 'cos ' + t.raw.toFixed(3) + ' · ' + size)));
    })));
  }

  function onImage() {
    const im = lab.image; S.index = null; S.result = null; S.sel = -1; tip.hidden = true;
    if (!im) return;
    vp.setImage(im.canvas, im.gsd);
    imgNote.textContent = im.name + '. ' + (im.note || '') + '. ' + im.kind + '.' + (im.gsd ? ' Rulers in metres at ' + (im.gsd * 100).toFixed(1) + ' cm a pixel (assumed).' : ' No ground scale: rulers in pixels.');
    paintStrip(); ro.tiles.set('–', 'tiles indexed'); ro.per.set('–', 'per tile');
    if (ready()) run();
  }
  const off = lab.on((t) => { if (t === 'image') onImage(); if (t === 'samples' && !lab.image && lab.samples[0]) lab.useSample(lab.samples[0]).catch(() => {}); });
  if (lab.image) onImage(); else if (lab.samples[0]) lab.useSample(lab.samples[0]).catch(() => {});
  paintStrip();
  if (ready()) go.lastChild.textContent = 'Search';
  return { onShow() { vp.redraw(); }, onHide() { clearTimeout(timer); }, onPrefs() { vp.redraw(); }, dispose() { off(); } };
}
