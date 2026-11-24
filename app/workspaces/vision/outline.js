// 02 Click to outline. Segment Anything (SlimSAM) in the page: the image is encoded once, then every click is a small decoder run.
// The mask is measured: area, perimeter and principal extents, in metres at the stated ground resolution.
const REPO = 'Xenova/slimsam-77-uniform';

export async function create(el, ctx, lab, def) {
  const { h, icon } = ctx.kit;
  const f = lab.frame(el, { n: def.n, title: def.title, tags: def.tags, lede: ['Click a roof, a slab or a patch of water and a segmentation model draws its outline, with no training on this scene.', 'Because a drone frame has a known ground resolution, the outline becomes a measurement: square metres of roof to lift, of water to cross, of slab to shore.'] });
  const sam = lab.model({ key: 'slimsam', name: 'SlimSAM-77', repo: REPO, role: 'Segment Anything, compressed', mb: 39.9,
    what: 'Meta’s Segment Anything model pruned and distilled to about a hundredth of its size by a group at the National University of Singapore. An encoder reads the image once; a small decoder answers each click.',
    variants: [{ device: 'webgpu', dtype: 'fp32', mb: 39.9 }, { device: 'wasm', dtype: 'q8', mb: 13.8 }],
    make: async (T, o) => ({ T, model: await T.SamModel.from_pretrained(REPO, o), proc: await T.AutoProcessor.from_pretrained(REPO) }) });

  const S = { enc: null, encoding: null, points: [], cur: null, pick: 'auto', kept: [], sel: -1, gsd: null, ghost: null, decoding: false, pendingPoint: def.params?.point || null, decMs: null, test: null, truth: null };
  let layer = null;       // canvas at image size holding the painted masks

  // ---------- stage ----------
  const load = h('button.btn.btn-primary', { onclick: () => encode().catch(() => {}) }, icon('download'), h('span', null, 'Load Segment Anything · 40 MB'));
  const pickSeg = h('div.seg', { role: 'group', 'aria-label': 'Which of the three candidate masks to use' }, [['auto', 'Best', 'The candidate the model itself rates highest'], ['0', 'Smallest', 'The smallest of the three candidates: a part'], ['1', 'Middle', 'The middle candidate'], ['2', 'Largest', 'The largest candidate: the whole thing']].map(([id, label, title]) =>
    h('button', { 'aria-pressed': String(id === 'auto'), title, 'data-pick': id, onclick: () => { S.pick = id; pickSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pick === id))); paint(); } }, label)));
  const keep = h('button.btn', { disabled: true, title: 'Add this outline to the list and start another', onclick: () => keepCurrent() }, icon('plus'), 'Keep outline');
  const clear = h('button.btn.btn-ghost', { disabled: true, onclick: () => { S.points = []; S.cur = null; paint(); } }, icon('undo'), 'Clear points');
  const hint = h('span.vision-outline-hint', null, 'Load the model, then click anything in the frame.');
  const busy = h('div.vision-busy', { hidden: true }, h('div.spinner'), h('p'));
  const vpHost = h('div.vision-outline-vp');
  const foot = h('div.vision-stagefoot', null, h('span', null, 'Nothing has been downloaded yet.'));
  f.stage.append(h('div.vision-stagebar', null, load, hint, h('div.grow'), h('span.label', null, 'Candidate'), pickSeg, keep, clear), vpHost, foot);
  vpHost.append(busy); lab.dropTarget(f.stage);
  const setBusy = (m) => { busy.hidden = !m; if (m) busy.lastChild.textContent = m; };

  const vp = lab.viewport(vpHost, {
    onClick: (p, e, right) => { if (!S.enc) { load.focus(); hint.classList.remove('flash'); void hint.offsetWidth; hint.classList.add('flash'); return; } S.points.push({ x: p[0], y: p[1], label: e.shiftKey || right ? 0 : 1 }); S.ghost = null; decode(); },
    onMove: (p) => { if (!S.enc || S.points.length || !p) { if (S.ghost) { S.ghost = null; paint(); } return; } hover(p); },
    onLeave: () => { if (S.ghost) { S.ghost = null; paint(); } },
  });
  vp.over.setAttribute('aria-label', 'The frame. Click to outline an object. Shift-click or right-click marks a point that is not part of it.');
  vp.draw = (g, v) => {
    const { x, y, w, h: hh, s } = v.rect;
    if (layer) { g.imageSmoothingEnabled = true; g.drawImage(layer, x, y, w, hh); }
    S.kept.forEach((k, i) => { const [cx, cy] = v.fromImage(k.m.cx, k.m.cy); tagAt(g, cx, cy, String(i + 1), i === S.sel ? lab.tok('--text') : lab.tok('--text-2')); });
    for (const p of S.points) {
      const [px, py] = v.fromImage(p.x, p.y); g.beginPath(); g.arc(px, py, 5.5, 0, 7); g.fillStyle = lab.tok('--bg-0'); g.fill(); g.lineWidth = 2; g.strokeStyle = p.label ? lab.tok('--accent') : lab.tok('--danger'); g.stroke();
      g.beginPath(); g.moveTo(px - 2.5, py); g.lineTo(px + 2.5, py); if (p.label) { g.moveTo(px, py - 2.5); g.lineTo(px, py + 2.5); } g.stroke();
    }
    const m = current()?.m;
    if (m) { // principal axes: the long and short extent, drawn through the centroid
      g.lineWidth = 1; g.strokeStyle = lab.tok('--text'); g.setLineDash([4, 3]); g.globalAlpha = 0.85;
      for (const [ax, lo, hi] of [[m.u, m.uLo, m.uHi], [m.v, m.vLo, m.vHi]]) { const a = v.fromImage(m.cx + ax[0] * lo, m.cy + ax[1] * lo), b = v.fromImage(m.cx + ax[0] * hi, m.cy + ax[1] * hi); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
      g.setLineDash([]); g.globalAlpha = 1;
      const a = v.fromImage(m.cx + m.u[0] * m.uHi, m.cy + m.u[1] * m.uHi); g.font = '600 11px ' + lab.tok('--mono'); const txt = dims(m); const tw = g.measureText(txt).width + 10;
      const tx = lab.clamp(a[0] + 8, x, x + w - tw), ty = lab.clamp(a[1] - 9, y, y + hh - 18); g.fillStyle = lab.tok('--bg-0'); g.globalAlpha = 0.86; g.fillRect(tx, ty, tw, 18); g.globalAlpha = 1; g.fillStyle = lab.tok('--text'); g.textBaseline = 'middle'; g.fillText(txt, tx + 5, ty + 9.5);
    }
  };
  const tagAt = (g, x, y, t, c) => { g.font = '600 11px ' + lab.tok('--mono'); const tw = g.measureText(t).width + 8; g.fillStyle = c; g.fillRect(x - tw / 2, y - 8, tw, 16); g.fillStyle = lab.tok('--bg-0'); g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(t, x, y + 0.5); g.textAlign = 'left'; };

  // ---------- side ----------
  const picker = lab.picker(), imgNote = h('p.caption');
  f.section('Frame', picker, imgNote);
  const ro = { area: lab.readout('area', 'm²'), per: lab.readout('perimeter', 'm') };
  const kv = h('dl.kv.num');
  const gsdSlider = lab.slider({ label: 'Ground resolution', min: 0.2, max: 12, step: 0.1, value: 2, assumed: true, fmt: (v) => v.toFixed(1) + ' cm a pixel', title: 'How much ground one pixel covers. It follows from the drone’s height and lens; here it is an assumed value.', onInput: (v) => { S.gsd = v / 100 * (S.gsdScale || 1); vp.setGsd(S.gsd); measureAll(); } });
  const gsdNote = h('p.caption');
  f.section('Measurement', h('div.vision-readouts', null, ro.area.el, ro.per.el), kv, gsdSlider, gsdNote);
  const keptBox = h('div');
  f.section('Kept outlines', keptBox);
  const testBtn = h('button.btn', { onclick: () => runTest() }, icon('ruler'), 'Measure three known shapes');
  const testBox = h('div');
  f.section('Check against a known truth', h('p', null, 'A procedural scene with a tin roof, a concrete slab and a pond whose areas are known exactly. The model outlines each from one click at its centre; the table shows the error.'), testBtn, testBox);
  f.section('Model', sam.view());
  f.dossier({
    research: [
      { title: 'Segment Anything', who: 'Kirillov et al. (Meta AI)', year: 'ICCV 2023', url: 'https://arxiv.org/abs/2304.02643', note: 'Trained on 1 billion masks across 11 million images.' },
      { title: 'SlimSAM: 0.1% data makes Segment Anything slim', who: 'Chen, Fang, Ma, Wang (National University of Singapore)', year: 'NeurIPS 2024', url: 'https://arxiv.org/abs/2312.05284', note: 'The compressed model running here.' },
    ],
    field: 'An area is only as good as the ground resolution, and that needs the drone’s height above the surface and a camera pointing straight down. On a slope, or in an oblique view, one scale does not hold across the frame. Unknown: how well the outlines hold on real flood imagery; the frames here are illustrations.',
    failure: 'On the drawn scene with known areas, one click on the tin roof outlined a single sheet: 97.5 % too small. A second click brought it to 6.2 % too large. On frame A, one click on the brown pool made its first choice a 0.3 m² sliver.',
  });
  const failEl = f.side.querySelector('.vision-dos-row.fail p');
  if (failEl) failEl.textContent = 'One click is ambiguous. On drone frame A, a click on a roof sheet returns the single sheet, the whole roof or the roof with its shadow, depending on which of the three candidates you take, and the areas differ several times over. The model’s own quality score does not tell you which one you meant.';

  // ---------- model ----------
  async function encode() {
    const im = lab.image; if (!im) return null;
    if (S.enc?.im === im) return S.enc;
    if (S.encoding?.im === im) return S.encoding.promise;
    const promise = (async () => {
      setBusy(sam.status === 'ready' ? 'Reading the frame' : 'Loading Segment Anything. It is cached after the first time.');
      load.disabled = true;
      try {
        const { T, model, proc } = await sam.ensure();
        setBusy('Reading the frame once. Every click after this is fast.');
        await new Promise((r) => setTimeout(r, 30));
        const t0 = performance.now(), inputs = await proc(T.RawImage.fromCanvas(im.canvas)), emb = await model.get_image_embeddings(inputs), ms = performance.now() - t0;
        if (lab.image !== im) return null;
        S.enc = { im, inputs, emb, ms }; load.hidden = true; hint.textContent = 'Click anything in the frame. Shift-click marks what is not part of it.';
        try { await infer([{ x: im.canvas.width / 2, y: im.canvas.height / 2, label: 1 }]); const w = await infer([{ x: im.canvas.width / 2, y: im.canvas.height / 2, label: 1 }]); S.decMs = w.ms; } catch { /* warm-up only */ }
        status(); return S.enc;
      } catch (e) { console.warn('[vision] outline: encode failed', e); foot.replaceChildren(h('span.c-danger', null, 'The model could not read the frame: ' + String(e.message || e).slice(0, 140))); throw e; }
      finally { setBusy(''); load.disabled = false; }
    })();
    S.encoding = { im, promise };
    try { const r = await promise; if (r && S.pendingPoint) { S.points = [{ x: S.pendingPoint[0], y: S.pendingPoint[1], label: 1 }]; S.pendingPoint = null; decode(); } return r; } finally { if (S.encoding?.im === im) S.encoding = null; }
  }
  async function infer(points) {
    const { T, model, proc } = sam.instance, { inputs, emb, im } = S.enc, rs = inputs.reshaped_input_sizes[0], W = im.canvas.width, H = im.canvas.height;
    const input_points = new T.Tensor('float32', points.flatMap((p) => [p.x / W * rs[1], p.y / H * rs[0]]), [1, 1, points.length, 2]);
    const input_labels = new T.Tensor('int64', points.map((p) => BigInt(p.label)), [1, 1, points.length]);
    const t0 = performance.now(), out = await model({ ...emb, input_points, input_labels });
    // The decoder answers with three 256 x 256 logit maps of the padded 1024-pixel square. Bilinear upsampling to the frame, then the sign, gives the mask.
    const pm = out.pred_masks, G = pm.dims[pm.dims.length - 1], lg = pm.data, iou = Array.from(out.iou_scores.data), n = W * H, sx = (rs[1] / 1024) * G / W, sy = (rs[0] / 1024) * G / H;
    const cands = [0, 1, 2].map((k) => {
      const d = new Uint8Array(n), o = k * G * G; let a = 0;
      for (let y = 0, i = 0; y < H; y++) { const fy = Math.min(G - 1.001, Math.max(0, (y + 0.5) * sy - 0.5)), y0 = fy | 0, wy = fy - y0, r0 = o + y0 * G, r1 = r0 + G;
        for (let x = 0; x < W; x++, i++) { const fx = Math.min(G - 1.001, Math.max(0, (x + 0.5) * sx - 0.5)), x0 = fx | 0, wx = fx - x0; const v = (lg[r0 + x0] * (1 - wx) + lg[r0 + x0 + 1] * wx) * (1 - wy) + (lg[r1 + x0] * (1 - wx) + lg[r1 + x0 + 1] * wx) * wy; if (v > 0) { d[i] = 1; a++; } } }
      return { data: d, area: a, iou: iou[k] };
    }).sort((a, b) => a.area - b.area);
    const ms = performance.now() - t0;
    return { cands, ms, W, H };
  }
  async function decode() {
    if (!S.enc || S.decoding) { S.again = true; return; }
    S.decoding = true;
    try {
      const pts = S.points.slice(); if (!pts.length) { S.cur = null; paint(); return; }
      const r = await infer(pts); S.decMs = r.ms; sam.ran(r.ms); status();
      r.cands.forEach((c) => { c.m = measure(c.data, r.W, r.H); });
      S.cur = r; paint(); status();
    } catch (e) { console.warn('[vision] outline: decode failed', e); ctx.shell.toast('That click could not be outlined. ' + String(e.message || e).slice(0, 100), { level: 'alert' }); }
    finally { S.decoding = false; if (S.again) { S.again = false; decode(); } }
  }
  let hoverBusy = false, hoverNext = null;
  async function hover(p) {
    if (hoverBusy) { hoverNext = p; return; }
    if (S.decMs != null && S.decMs > 140) return;                 // too slow on this computer for a live preview
    hoverBusy = true;
    try { const r = await infer([{ x: p[0], y: p[1], label: 1 }]); S.decMs = r.ms; if (!S.points.length) { S.ghost = best(r.cands); paint(); } }
    catch { /* a preview is optional */ }
    finally { hoverBusy = false; if (hoverNext && !S.points.length) { const q = hoverNext; hoverNext = null; hover(q); } }
  }
  const best = (cands) => (S.pick === 'auto' ? cands.reduce((a, b) => (b.iou > a.iou ? b : a)) : cands[+S.pick]);
  const current = () => (S.cur ? best(S.cur.cands) : null);

  // ---------- measuring a mask ----------
  // Pixel count; boundary length from 4-neighbour edges with the Crofton factor pi/4; principal axes by PCA of the mask's pixels.
  function measure(d, W, H) {
    let a = 0, sx = 0, sy = 0, edges = 0;
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) if (d[i]) { a++; sx += x; sy += y; if (x === 0 || !d[i - 1]) edges++; if (x === W - 1 || !d[i + 1]) edges++; if (y === 0 || !d[i - W]) edges++; if (y === H - 1 || !d[i + W]) edges++; }
    if (!a) return { a: 0, per: 0, cx: 0, cy: 0, u: [1, 0], v: [0, 1], uLo: 0, uHi: 0, vLo: 0, vHi: 0 };
    const cx = sx / a, cy = sy / a; let xx = 0, yy = 0, xy = 0;
    for (let y = 0, i = 0; y < H; y += 2) for (let x = 0, i = y * W; x < W; x += 2, i += 2) if (d[i]) { const dx = x - cx, dy = y - cy; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
    const th = 0.5 * Math.atan2(2 * xy, xx - yy), u = [Math.cos(th), Math.sin(th)], v = [-u[1], u[0]]; let uLo = 0, uHi = 0, vLo = 0, vHi = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0, i = y * W; x < W; x += 2, i += 2) if (d[i]) { const dx = x - cx, dy = y - cy, pu = dx * u[0] + dy * u[1], pv = dx * v[0] + dy * v[1]; if (pu < uLo) uLo = pu; if (pu > uHi) uHi = pu; if (pv < vLo) vLo = pv; if (pv > vHi) vHi = pv; }
    return { a, per: edges * Math.PI / 4, cx, cy, u, v, uLo, uHi, vLo, vHi };
  }
  const unit = () => (S.gsd ? { k: S.gsd, len: 'm', area: 'm²' } : { k: 1, len: 'px', area: 'px²' });
  const dims = (m) => { const q = unit(), L = (m.uHi - m.uLo) * q.k, s = (m.vHi - m.vLo) * q.k, d = S.gsd ? 1 : 0; return L.toFixed(d) + ' × ' + s.toFixed(d) + ' ' + q.len; };
  const fmtArea = (a) => { const q = unit(), v = a * q.k * q.k; return S.gsd ? (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v).toLocaleString('en')) : Math.round(v).toLocaleString('en'); };

  // ---------- painting ----------
  function paint() {
    const im = lab.image; if (!im) return;
    const W = im.canvas.width, H = im.canvas.height;
    if (!layer || layer.width !== W || layer.height !== H) { layer = document.createElement('canvas'); layer.width = W; layer.height = H; }
    const g = layer.getContext('2d'), id = g.createImageData(W, H), px = id.data;
    const put = (d, rgb, fill, edge) => {
      for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) if (d[i]) {
        const e = x === 0 || y === 0 || x === W - 1 || y === H - 1 || !d[i - 1] || !d[i + 1] || !d[i - W] || !d[i + W] || (x > 1 && !d[i - 2]) || (x < W - 2 && !d[i + 2]) || (y > 1 && !d[i - 2 * W]) || (y < H - 2 && !d[i + 2 * W]);
        const o = 4 * i; px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = e ? edge : Math.max(px[o + 3], fill);
      }
    };
    const col = (t) => { const c = lab.tok(t).replace('#', ''); return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]; };
    S.kept.forEach((k, i) => put(k.data, col(i === S.sel ? '--text' : '--text-2'), i === S.sel ? 60 : 34, 235));
    if (S.truth) put(S.truth, col('--ok'), 0, 255);
    const c = current(); if (c) put(c.data, col('--accent'), 76, 255); else if (S.ghost) put(S.ghost.data, col('--text'), 22, 200);
    g.putImageData(id, 0, 0);
    keep.disabled = !c; clear.disabled = !S.points.length;
    readouts(); vp.redraw();
  }
  function readouts() {
    const c = current() || (S.sel >= 0 ? S.kept[S.sel] : null), q = unit();
    ro.area.unit(q.area); ro.per.unit(q.len);
    if (!c) { ro.area.set('–'); ro.per.set('–'); kv.replaceChildren(h('dt', null, 'Outline'), h('dd', null, S.enc ? 'Click the frame' : 'Model not loaded')); return; }
    const m = c.m; ro.area.set(fmtArea(m.a)); ro.per.set((m.per * q.k).toFixed(S.gsd ? 1 : 0));
    const im = lab.image, share = 100 * m.a / (im.canvas.width * im.canvas.height);
    kv.replaceChildren(h('dt', { title: 'The longest extent of the outline and the extent at right angles to it, found from the spread of its pixels.' }, 'Long × short'), h('dd', null, dims(m)), h('dt', null, 'Pixels in the mask'), h('dd', null, m.a.toLocaleString('en')), h('dt', null, 'Share of the frame'), h('dd', null, share.toFixed(share < 1 ? 2 : 1) + ' %'),
      h('dt', { title: 'The model’s own estimate of how well this mask fits. It is a prediction, not a measurement.' }, 'Model’s own score'), h('dd', null, c.iou != null ? c.iou.toFixed(3) : 'kept'),
      ...(S.cur ? [h('dt', null, 'Three candidates'), h('dd', null, S.cur.cands.map((x) => fmtArea(x.m.a)).join(' / ') + ' ' + q.area)] : []));
  }
  function measureAll() { paintKept(); readouts(); vp.redraw(); }
  function keepCurrent() { const c = current(); if (!c) return; S.kept.push({ data: c.data.slice(), m: c.m, iou: c.iou }); S.points = []; S.cur = null; S.sel = S.kept.length - 1; paintKept(); paint(); }
  function paintKept() {
    const q = unit();
    if (!S.kept.length) { keptBox.replaceChildren(h('p.caption', null, 'Nothing kept yet. Outline something and press Keep outline to build a list of measured areas.')); return; }
    let total = 0; S.kept.forEach((k) => { total += k.m.a; });
    keptBox.replaceChildren(h('table.table.vision-outline-table', null, h('thead', null, h('tr', null, h('th', null, 'No.'), h('th', null, 'Area, ' + q.area), h('th', null, 'Extent, ' + q.len), h('th'))),
      h('tbody', null, S.kept.map((k, i) => h('tr', { 'aria-selected': String(i === S.sel), tabindex: 0, onclick: () => { S.sel = S.sel === i ? -1 : i; paintKept(); paint(); }, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } } },
        h('td.num', null, String(i + 1)), h('td.num', null, fmtArea(k.m.a)), h('td.num', null, dims(k.m).replace(/ (m|px)$/, '')),
        h('td', null, h('button.btn.btn-ghost.btn-sm.btn-icon', { 'aria-label': 'Remove outline ' + (i + 1), onclick: (e) => { e.stopPropagation(); S.kept.splice(i, 1); S.sel = -1; paintKept(); paint(); } }, icon('close', 14)))))),
      h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td.num', null, fmtArea(total)), h('td'), h('td')))),
      h('div.row', { style: { marginTop: '8px' } }, h('button.btn.btn-sm', { onclick: exportMask }, icon('download'), 'Masks as PNG')));
  }
  function exportMask() {
    const im = lab.image, c = document.createElement('canvas'); c.width = im.canvas.width; c.height = im.canvas.height; const g = c.getContext('2d'), id = g.createImageData(c.width, c.height);
    S.kept.forEach((k, n) => { for (let i = 0; i < k.data.length; i++) if (k.data[i]) { const v = 255 - n * 20; id.data[4 * i] = id.data[4 * i + 1] = id.data[4 * i + 2] = v; id.data[4 * i + 3] = 255; } });
    g.putImageData(id, 0, 0); c.toBlob((b) => lab.download('hound-outlines.png', b), 'image/png');
  }
  function status() {
    const e = S.enc; if (!e) return;
    foot.replaceChildren(h('span', null, 'Frame read once in ', h('span.num', null, lab.fmtMs(e.ms))), S.decMs != null ? h('span', null, 'Each click ', h('span.num', null, lab.fmtMs(S.decMs))) : null, h('span', null, sam.device === 'webgpu' ? 'on the graphics chip' : 'on the processor'), h('div.grow'), h('span', null, S.decMs != null && S.decMs <= 140 ? 'Move the pointer for a live preview.' : ''));
  }

  // ---------- the truth test ----------
  // A drawn scene, straight down, 2 cm a pixel: a tin roof (rectangle), a concrete slab (polygon) and a pond (ellipse). Areas are exact.
  function testScene() {
    const N = 1200, gsd = 0.02, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), r = lab.rng(7);
    g.fillStyle = '#5b4a3a'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 2600; i++) { const x = r() * N, y = r() * N, s = 6 + r() * 60; g.fillStyle = 'rgba(' + (60 + r() * 60 | 0) + ',' + (48 + r() * 46 | 0) + ',' + (36 + r() * 36 | 0) + ',' + (0.05 + r() * 0.14) + ')'; g.beginPath(); g.ellipse(x, y, s, s * (0.4 + r() * 0.6), r() * 3.14, 0, 7); g.fill(); }
    for (let i = 0; i < 90; i++) { const x = r() * N, y = r() * N, L = 20 + r() * 90; g.save(); g.translate(x, y); g.rotate(r() * 6.28); g.fillStyle = 'rgba(' + (90 + r() * 50 | 0) + ',' + (70 + r() * 40 | 0) + ',' + (48 + r() * 30 | 0) + ',0.9)'; g.fillRect(-L / 2, -2, L, 3 + r() * 3); g.restore(); }
    const shapes = [];
    const truthOf = (path) => { const t = document.createElement('canvas'); t.width = t.height = N; const tg = t.getContext('2d'); tg.fillStyle = '#fff'; path(tg); tg.fill(); const d = tg.getImageData(0, 0, N, N).data, m = new Uint8Array(N * N); let a = 0; for (let i = 0; i < N * N; i++) if (d[4 * i] > 127) { m[i] = 1; a++; } return { m, a }; };
    { // tin roof 6.0 m by 4.0 m
      const w = 6 / gsd, hh = 4 / gsd, cx = 360, cy = 330, rot = 0.31, path = (t) => { t.save(); t.translate(cx, cy); t.rotate(rot); t.beginPath(); t.rect(-w / 2, -hh / 2, w, hh); t.restore(); };
      g.save(); g.translate(cx + 10, cy + 12); g.rotate(rot); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-w / 2, -hh / 2, w, hh); g.restore();
      g.save(); g.translate(cx, cy); g.rotate(rot); g.fillStyle = '#8d979c'; g.fillRect(-w / 2, -hh / 2, w, hh);
      for (let x = -w / 2; x < w / 2; x += 9) { g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x, -hh / 2, 3, hh); g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(x + 5, -hh / 2, 2, hh); }
      for (let i = 0; i < 24; i++) { g.fillStyle = 'rgba(120,70,40,' + (0.08 + r() * 0.2) + ')'; g.beginPath(); g.ellipse((r() - 0.5) * w * 0.9, (r() - 0.5) * hh * 0.9, 8 + r() * 30, 5 + r() * 14, 0, 0, 7); g.fill(); }
      g.restore(); shapes.push({ name: 'Tin roof, 6.0 × 4.0 m', area: 24, click: [cx, cy], click2: [cx - 96, cy - 62], ...truthOf(path) });
    }
    { // concrete slab: an irregular polygon, area by the shoelace formula
      const pts = [[690, 520], [1010, 470], [1090, 640], [980, 830], [760, 800], [640, 660]], path = (t) => { t.beginPath(); pts.forEach((p, i) => (i ? t.lineTo(p[0], p[1]) : t.moveTo(p[0], p[1]))); t.closePath(); };
      let a2 = 0; pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; a2 += p[0] * q[1] - q[0] * p[1]; });
      g.save(); g.translate(9, 11); g.fillStyle = 'rgba(0,0,0,0.35)'; path(g); g.fill(); g.restore();
      g.fillStyle = '#b3b0a8'; path(g); g.fill(); g.save(); path(g); g.clip();
      for (let i = 0; i < 500; i++) { g.fillStyle = 'rgba(' + (r() < 0.5 ? '255,255,255' : '40,40,40') + ',' + (0.03 + r() * 0.07) + ')'; g.fillRect(600 + r() * 520, 440 + r() * 420, 2 + r() * 14, 2 + r() * 10); }
      g.strokeStyle = 'rgba(40,36,30,0.7)'; g.lineWidth = 2; g.beginPath(); g.moveTo(720, 560); g.lineTo(840, 650); g.lineTo(820, 760); g.moveTo(840, 650); g.lineTo(1000, 620); g.stroke(); g.restore();
      shapes.push({ name: 'Concrete slab, six sides', area: Math.abs(a2) / 2 * gsd * gsd, click: [860, 700], click2: [770, 610], ...truthOf(path) });
    }
    { // pond: an ellipse 5.0 m by 3.2 m
      const a = 2.5 / gsd, b = 1.6 / gsd, cx = 330, cy = 880, rot = -0.2, path = (t) => { t.beginPath(); t.ellipse(cx, cy, a, b, rot, 0, 7); };
      const gr = g.createRadialGradient(cx - 30, cy - 20, 10, cx, cy, a); gr.addColorStop(0, '#6f6a5a'); gr.addColorStop(1, '#3f3a30'); g.fillStyle = gr; path(g); g.fill();
      g.save(); path(g); g.clip(); for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(200,205,200,' + (0.04 + r() * 0.08) + ')'; g.lineWidth = 1 + r() * 2; g.beginPath(); const y = cy - b + r() * 2 * b; g.moveTo(cx - a, y); g.bezierCurveTo(cx - a / 3, y + r() * 10 - 5, cx + a / 3, y + r() * 10 - 5, cx + a, y); g.stroke(); } g.restore();
      shapes.push({ name: 'Pond, 5.0 × 3.2 m ellipse', area: Math.PI * 2.5 * 1.6, click: [cx, cy], click2: [cx + 70, cy - 8], ...truthOf(path) });
    }
    const id = g.getImageData(0, 0, N, N), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(id, 0, 0);
    return { canvas: c, gsd, shapes };
  }
  async function runTest() {
    testBtn.disabled = true;
    try {
      const sc = testScene();
      lab.setImage({ canvas: sc.canvas, name: 'Known-shape test scene', kind: 'Procedural drawing', note: 'Three shapes with exact areas', gsd: sc.gsd, view: 'nadir', id: 'calib' });
      await encode(); if (!S.enc) return;
      const rows = [];
      const score = async (sh, pts) => {
        S.points = pts.map((p) => ({ x: p[0], y: p[1], label: 1 })); S.truth = sh.m;
        const r = await infer(S.points); r.cands.forEach((c) => { c.m = measure(c.data, r.W, r.H); }); S.cur = r; S.decMs = r.ms;
        const c = r.cands.reduce((x, y) => (y.iou > x.iou ? y : x)); let inter = 0, uni = 0; for (let i = 0; i < sh.m.length; i++) { const p = c.data[i] ? 1 : 0, q = sh.m[i]; inter += p & q; uni += p | q; }
        paint(); await new Promise((r2) => setTimeout(r2, lab.reduced() ? 0 : 520));
        const meas = c.m.a * sc.gsd * sc.gsd; return { meas, err: 100 * (meas - sh.area) / sh.area, iou: inter / uni };
      };
      for (const sh of sc.shapes) { const one = await score(sh, [sh.click]), two = await score(sh, [sh.click, sh.click2]); rows.push({ name: sh.name, truth: sh.area, one, two }); }
      S.truth = null; S.test = rows; S.points = []; S.cur = null; paint(); status();
      const cell = (x) => h('td.num', { class: Math.abs(x.err) > 10 ? 'c-warn' : 'c-ok', title: 'Measured ' + x.meas.toFixed(2) + ' m². Overlap with the true shape (intersection over union) ' + x.iou.toFixed(3) + '.' }, (x.err > 0 ? '+' : '') + x.err.toFixed(1) + ' %');
      const bad = rows.filter((x) => Math.abs(x.one.err) > 25);
      testBox.replaceChildren(h('table.table.vision-outline-table', null, h('thead', null, h('tr', null, h('th', null, 'Shape'), h('th', null, 'True, m²'), h('th', null, 'One click'), h('th', null, 'Two clicks'), h('th', { title: 'Overlap of the two-click mask with the true shape: intersection over union. 1 is perfect.' }, 'Overlap'))),
        h('tbody', null, rows.map((x) => h('tr', null, h('td', null, x.name), h('td.num', null, x.truth.toFixed(2)), cell(x.one), cell(x.two), h('td.num', null, x.two.iou.toFixed(3)))))),
        bad.length ? h('div.note.warn', { style: { marginTop: '8px' } }, icon('alert'), h('div', null, h('b', null, 'One click was not enough for the ' + bad.map((x) => x.name.split(',')[0].toLowerCase()).join(' and the ') + '. '), 'The candidate the model rated best was only a part of it. A second click inside the shape settles it.')) : null,
        h('p.caption', null, 'Area error against the exact shape, taking the candidate the model rated best each time. Hover a cell for the overlap. A drawn scene is easier than a real one: this checks the arithmetic and the model’s edges, not field accuracy.'));
    } catch (e) { testBox.replaceChildren(h('div.note.danger', null, icon('alert'), h('div', null, 'The test could not run: ' + String(e.message || e).slice(0, 140)))); }
    finally { testBtn.disabled = false; }
  }

  // ---------- image ----------
  function onImage() {
    const im = lab.image; if (!im) return;
    S.enc = null; S.points = []; S.cur = null; S.kept = []; S.sel = -1; S.ghost = null; S.truth = null; layer = null;
    const cm = im.gsd ? im.gsd * 100 : 2; S.gsdScale = 1; S.gsd = im.gsd || null; gsdSlider.set(Math.min(12, Math.max(0.2, cm)));
    gsdSlider.style.opacity = im.view === 'oblique' ? 0.5 : 1;
    gsdNote.textContent = im.gsd ? (im.id === 'calib' ? 'This drawn scene is exactly 2.0 cm a pixel.' : 'Assumed for the sample frames: a drone at 30 m with a 45 degree field of view sees 24.9 m across.') : im.view === 'oblique' ? 'This is a view from the side: no single scale holds across it, so sizes are in pixels. Move the slider only if you know better.' : 'No ground resolution is known for this image, so sizes are in pixels. Set one with the slider if you know it.';
    imgNote.textContent = im.name + '. ' + (im.note || '') + '. ' + im.kind + '.';
    vp.setImage(im.canvas, S.gsd); paintKept(); paint();
    load.hidden = false; foot.replaceChildren(h('span', null, sam.status === 'ready' ? 'Reading the new frame.' : 'Nothing has been downloaded yet.'));
    if (sam.status === 'ready') encode().catch(() => {}); else hint.textContent = 'Load the model, then click anything in the frame.';
  }
  const off = lab.on((t) => { if (t === 'image') onImage(); if (t === 'samples' && !lab.image && lab.samples[0]) lab.useSample(lab.samples[0]).catch(() => {}); });
  if (lab.image) onImage(); else if (lab.samples[0]) lab.useSample(lab.samples[0]).catch(() => {});
  return {
    onShow() { vp.redraw(); }, onHide() {}, onPrefs() { paint(); },
    onParams(p) { if (p?.point) { if (S.enc) { S.points = [{ x: p.point[0], y: p.point[1], label: 1 }]; decode(); } else { S.pendingPoint = p.point; encode().catch(() => {}); } } },
    dispose() { off(); },
  };
}
