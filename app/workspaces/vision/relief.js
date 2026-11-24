// 03 One photo to 3-D. Depth Anything V2 (small) estimates depth from a single image, in the page; three.js lifts the photo into a relief.
// Depth from one image is relative: nearer or farther, never metres. The truth test renders a scene whose depth is known and measures the error.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const REPO = 'onnx-community/depth-anything-v2-small';

export async function create(el, ctx, lab, def) {
  const { h, icon } = ctx.kit;
  const f = lab.frame(el, { n: def.n, title: def.title, tags: def.tags, lede: ['One ordinary photo goes in; a model that has learned how scenes are built estimates how far away every pixel is, and the photo becomes a surface you can turn.', 'It gives shape, not size: the model cannot know whether it sees a room or a dolls’ house, so the depth has no units.'] });
  const depth = lab.model({ key: 'depth-anything', name: 'Depth Anything V2, small', repo: REPO, role: 'Depth from one image', mb: 49.6,
    what: 'A 24.8-million-parameter vision transformer from the University of Hong Kong and TikTok (2024), taught by a larger model on 62 million unlabelled photos.',
    variants: [{ device: 'webgpu', dtype: 'fp16', mb: 49.6 }, { device: 'webgpu', dtype: 'fp32', mb: 99.1 }, { device: 'wasm', dtype: 'q8', mb: 27.3 }],
    make: async (T, o) => ({ T, model: await T.AutoModelForDepthEstimation.from_pretrained(REPO, o), proc: await T.AutoImageProcessor.from_pretrained(REPO) }) });

  const S = { d: null, mode: 'photo', points: false, strength: 0.42, shown: 0, cut: true, spin: !lab.reduced(), flat: false, ms: null, busy: false, test: null, GW: 0, GH: 0 };

  // ---------- stage ----------
  const go = h('button.btn.btn-primary', { onclick: () => estimate().catch(() => {}) }, icon('layers'), h('span', null, 'Load model and lift this photo · 50 MB'));
  const seg = (items, cur, on, label) => { const s = h('div.seg', { role: 'group', 'aria-label': label }, items.map(([id, text, title]) => h('button', { 'aria-pressed': String(id === cur), title, 'data-id': id, onclick: () => { s.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id))); on(id); } }, text))); return s; };
  const modeSeg = seg([['photo', 'Photo', 'The photo draped over the estimated surface'], ['clay', 'Shape only', 'The surface alone, lit from the side, so the photo cannot flatter the geometry'], ['depth', 'Depth colours', 'Coloured by estimated distance']], S.mode, (id) => { S.mode = id; rebuild(); }, 'Surface appearance');
  const formSeg = seg([['mesh', 'Surface'], ['points', 'Points']], 'mesh', (id) => { S.points = id === 'points'; rebuild(); }, 'Surface or point cloud');
  const reset = h('button.btn.btn-ghost.btn-icon', { 'aria-label': 'Reset the view', title: 'Reset the view', onclick: () => home(true) }, icon('fit'));
  const host = h('div.vision-relief-host'), busy = h('div.vision-busy', { hidden: true }, h('div.spinner'), h('p'));
  const pip = h('canvas.vision-relief-pip', { width: 240, height: 150, role: 'img', 'aria-label': 'The estimated depth map' });
  const pipWrap = h('div.vision-hud.bl', { hidden: true }, h('div.vision-relief-pipbox', null, pip, h('div.vision-relief-legend', null, h('span', null, 'far'), h('i'), h('span', null, 'near'), h('span.dim', null, 'relative, no units'))));
  const flat2d = h('canvas.vision-relief-flat');
  const foot = h('div.vision-stagefoot', null, h('span', null, 'The photo is flat until the model has run. Nothing has been downloaded yet.'));
  f.stage.append(h('div.vision-stagebar', null, go, h('div.grow'), modeSeg, formSeg, reset), host, foot);
  host.append(flat2d, pipWrap, busy, h('div.vision-hud.tr', null, h('span.vision-pill', null, 'Drag to turn · scroll to zoom')));
  lab.dropTarget(f.stage);
  const setBusy = (m) => { busy.hidden = !m; if (m) busy.lastChild.textContent = m; };

  // ---------- three.js ----------
  let renderer = null, scene, camera, controls, group, mesh = null, frame = null, tex = null, glFailed = false;
  function initGL() {
    if (renderer || glFailed) return;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) { glFailed = true; host.append(h('div.note.warn.vision-relief-nogl', null, icon('alert'), h('div', null, '3-D drawing (WebGL) is not available in this browser, so the relief cannot be shown. The depth map still appears.'))); return; }
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'vision-relief-gl'; renderer.domElement.setAttribute('aria-label', 'The photo as a 3-D relief. Drag to turn it.'); renderer.domElement.tabIndex = 0;
    host.prepend(renderer.domElement);
    scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
    controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 0.6; controls.maxDistance = 8; controls.zoomSpeed = 0.7;
    controls.addEventListener('start', () => { S.spin = false; });
    scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x20242b, 0.9)); const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-1.6, 1.8, 2.2); scene.add(sun);
    group = new THREE.Group(); scene.add(group);
    new ResizeObserver(resize).observe(host); resize(); home(false);
  }
  function resize() { if (!renderer) return; const r = host.getBoundingClientRect(); if (!r.width || !r.height) return; renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); drawFlat(); }
  function home(animate) {
    if (!camera) return; S.spin = false;
    const to = S.flat ? new THREE.Vector3(0.0, 1.9, 2.3) : new THREE.Vector3(0.75, 0.3, 2.9);
    if (!animate || lab.reduced()) { camera.position.copy(to); controls.target.set(0, S.flat ? 0.02 : 0, 0); controls.update(); return; }
    const from = camera.position.clone(), t0 = performance.now(), T = 420; const step = () => { const u = Math.min(1, (performance.now() - t0) / T), e = 1 - (1 - u) ** 3; camera.position.lerpVectors(from, to, e); controls.target.lerp(new THREE.Vector3(0, S.flat ? 0.02 : 0, 0), e); if (u < 1 && loop.running) requestAnimationFrame(step); }; step();
  }
  const loop = lab.loop((dt, t) => {
    if (!renderer || !S.d) return;
    if (S.shown !== S.strength) { const k = lab.reduced() ? 1 : Math.min(1, dt * 5); S.shown += (S.strength - S.shown) * k; if (Math.abs(S.shown - S.strength) < 0.002) S.shown = S.strength; applyZ(); }
    if (S.spin && !lab.reduced()) { const a = Math.sin(t * 0.35) * 0.0035; camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), a); }
    controls.update(); renderer.render(scene, camera);
  });

  // The grid of vertices: one per depth sample. x right, y up, z towards the viewer for near things (or up, for a view from above).
  function rebuild() {
    if (!renderer || !S.d) return;
    const im = lab.image, { GW, GH, d } = S, asp = im.canvas.width / im.canvas.height, sx = asp >= 1 ? 2 : 2 * asp, sy = asp >= 1 ? 2 / asp : 2;
    if (mesh) { group.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); } if (frame) { group.remove(frame); frame.geometry.dispose(); }
    const n = GW * GH, pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
    const px = S.px ||= sampleColours(im.canvas, GW, GH);
    for (let j = 0, i = 0; j < GH; j++) for (let k = 0; k < GW; k++, i++) {
      pos[3 * i] = (k / (GW - 1) - 0.5) * sx; pos[3 * i + 1] = (0.5 - j / (GH - 1)) * sy; uv[2 * i] = k / (GW - 1); uv[2 * i + 1] = 1 - j / (GH - 1);
      if (S.mode === 'depth') { const c = lab.DEPTH(d[i]); col[3 * i] = (c[0] / 255) ** 2.2; col[3 * i + 1] = (c[1] / 255) ** 2.2; col[3 * i + 2] = (c[2] / 255) ** 2.2; } else if (S.mode === 'clay') { col[3 * i] = col[3 * i + 1] = col[3 * i + 2] = 0.62; } else { col[3 * i] = (px[4 * i] / 255) ** 2.2; col[3 * i + 1] = (px[4 * i + 1] / 255) ** 2.2; col[3 * i + 2] = (px[4 * i + 2] / 255) ** 2.2; }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (S.points) {
      mesh = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2.2 * Math.min(2, devicePixelRatio || 1), sizeAttenuation: false, vertexColors: true }));
    } else {
      // two triangles per cell; a cell is left out where the depth jumps, so a near object does not drag a rubber sheet to the wall behind it
      const idx = new Uint32Array((GW - 1) * (GH - 1) * 6); let m = 0, cutN = 0; const lim = 0.07;
      for (let j = 0; j < GH - 1; j++) for (let k = 0; k < GW - 1; k++) { const a = j * GW + k, b = a + 1, c = a + GW, e = c + 1; if (S.cut) { const lo = Math.min(d[a], d[b], d[c], d[e]), hi = Math.max(d[a], d[b], d[c], d[e]); if (hi - lo > lim) { cutN++; continue; } } idx[m++] = a; idx[m++] = c; idx[m++] = b; idx[m++] = b; idx[m++] = c; idx[m++] = e; }
      geo.setIndex(new THREE.BufferAttribute(idx.subarray(0, m), 1)); S.cutN = cutN;
      if (S.mode === 'photo') { tex?.dispose(); tex = new THREE.CanvasTexture(im.canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); }
      else if (S.mode === 'clay') mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, flatShading: false }));
      else mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    }
    group.add(mesh);
    // a measured frame around the relief: the footprint of the photo and the depth range
    const zr = 1, fx = sx / 2, fy = sy / 2, L = [];
    for (const [x, y] of [[-fx, -fy], [fx, -fy], [fx, fy], [-fx, fy]]) L.push(x, y, 0, x, y, zr);
    for (const z of [0, zr]) L.push(-fx, -fy, z, fx, -fy, z, fx, -fy, z, fx, fy, z, fx, fy, z, -fx, fy, z, -fx, fy, z, -fx, -fy, z);
    for (let t = 0; t <= 10; t++) { const z = t / 10 * zr, len = t % 5 === 0 ? 0.06 : 0.03; L.push(-fx, -fy, z, -fx - len, -fy, z); }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(L, 3));
    frame = new THREE.LineSegments(fg, new THREE.LineBasicMaterial({ color: new THREE.Color(lab.tok('--line-3')), transparent: true, opacity: 0.8 })); group.add(frame);
    group.rotation.x = S.flat ? -Math.PI / 2 : 0;
    applyZ(); stats();
  }
  function applyZ() {
    if (!mesh) return; const p = mesh.geometry.attributes.position, d = S.d, a = p.array, k = S.shown;
    for (let i = 0; i < d.length; i++) a[3 * i + 2] = d[i] * k;
    p.needsUpdate = true; if (S.mode === 'clay' && !S.points) mesh.geometry.computeVertexNormals();
    if (frame) frame.scale.z = Math.max(0.001, k); mesh.geometry.computeBoundingSphere();
    group.position.set(0, 0, 0); if (S.flat) group.position.y = 0; else group.position.z = -k / 2;
  }
  function sampleColours(canvas, GW, GH) { const c = document.createElement('canvas'); c.width = GW; c.height = GH; const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(canvas, 0, 0, GW, GH); return g.getImageData(0, 0, GW, GH).data; }
  function drawFlat() {       // before the model has run: the plain photo, so the stage is never empty
    const im = lab.image; flat2d.hidden = !!S.d || !im; if (flat2d.hidden) return;
    const r = host.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); if (!r.width) return; flat2d.width = r.width * dpr; flat2d.height = r.height * dpr;
    const g = flat2d.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); const s = Math.min((r.width - 80) / im.canvas.width, (r.height - 60) / im.canvas.height), w = im.canvas.width * s, hh = im.canvas.height * s;
    g.imageSmoothingQuality = 'high'; g.drawImage(im.canvas, (r.width - w) / 2, (r.height - hh) / 2, w, hh); g.strokeStyle = lab.tok('--line-3'); g.strokeRect(Math.round((r.width - w) / 2) - 0.5, Math.round((r.height - hh) / 2) - 0.5, Math.round(w) + 1, Math.round(hh) + 1);
  }

  // ---------- the model ----------
  // Returns { p: Float32Array, w, h }: the raw prediction. Larger means nearer (it is an inverse depth up to an unknown scale and shift).
  async function predict(canvas) {
    const { T, model, proc } = await depth.ensure();
    const inputs = await proc(T.RawImage.fromCanvas(canvas));
    const t0 = performance.now(), { predicted_depth } = await model(inputs), ms = performance.now() - t0;
    const dm = predicted_depth.dims; depth.ran(ms);
    return { p: predicted_depth.data, w: dm[dm.length - 1], h: dm[dm.length - 2], ms };
  }
  const bilinear = (src, w, hh, GW, GH) => { const out = new Float32Array(GW * GH); for (let j = 0, i = 0; j < GH; j++) { const fy = Math.min(hh - 1.001, j / (GH - 1) * (hh - 1)), y0 = fy | 0, wy = fy - y0; for (let k = 0; k < GW; k++, i++) { const fx = Math.min(w - 1.001, k / (GW - 1) * (w - 1)), x0 = fx | 0, wx = fx - x0, a = y0 * w + x0; out[i] = (src[a] * (1 - wx) + src[a + 1] * wx) * (1 - wy) + (src[a + w] * (1 - wx) + src[a + w + 1] * wx) * wy; } } return out; };
  async function estimate() {
    const im = lab.image; if (!im || S.busy) return null; S.busy = true; go.disabled = true;
    try {
      setBusy(depth.status === 'ready' ? 'Estimating depth' : 'Loading Depth Anything V2. It is cached after the first time.');
      await depth.ensure(); setBusy('Estimating depth for every pixel'); await new Promise((r) => setTimeout(r, 30));
      const r = await predict(im.canvas); if (lab.image !== im) return null;
      const long = 384, asp = im.canvas.width / im.canvas.height; S.GW = asp >= 1 ? long : Math.round(long * asp); S.GH = asp >= 1 ? Math.round(long / asp) : long;
      const g = bilinear(r.p, r.w, r.h, S.GW, S.GH), sorted = Float32Array.from(g).sort(), lo = sorted[Math.floor(sorted.length * 0.01)], hi = sorted[Math.floor(sorted.length * 0.99)];
      for (let i = 0; i < g.length; i++) g[i] = lab.clamp((g[i] - lo) / (hi - lo || 1), 0, 1);
      S.d = g; S.raw = r; S.ms = r.ms; S.px = null; S.flat = im.view === 'nadir'; S.shown = 0; S.spin = !lab.reduced();
      initGL(); flat2d.hidden = true; go.hidden = true; pipWrap.hidden = false; drawPip(); rebuild(); home(false); stats(); exportBtn.disabled = false;
      return r;
    } catch (e) { console.warn('[vision] relief failed', e); foot.replaceChildren(h('span.c-danger', null, 'The depth model could not run: ' + String(e.message || e).slice(0, 150))); throw e; }
    finally { S.busy = false; go.disabled = false; setBusy(''); }
  }
  function drawPip() {
    const { GW, GH, d } = S; pip.width = 240; pip.height = Math.round(240 * GH / GW); const c = document.createElement('canvas'); c.width = GW; c.height = GH; const g = c.getContext('2d'), id = g.createImageData(GW, GH);
    for (let i = 0; i < d.length; i++) { const col = lab.DEPTH(d[i]); id.data[4 * i] = col[0]; id.data[4 * i + 1] = col[1]; id.data[4 * i + 2] = col[2]; id.data[4 * i + 3] = 255; }
    g.putImageData(id, 0, 0); const pg = pip.getContext('2d'); pg.imageSmoothingQuality = 'high'; pg.drawImage(c, 0, 0, pip.width, pip.height);
  }
  function stats() {
    if (!S.d) return; const n = S.GW * S.GH;
    ro.ms.set(S.ms < 1000 ? String(Math.round(S.ms)) : (S.ms / 1000).toFixed(2), 'one depth estimate'); ro.ms.unit(S.ms < 1000 ? 'ms' : 's');
    ro.px.set(S.raw.w + '×' + S.raw.h, 'depth samples from the model'); ro.v.set((n / 1000).toFixed(0) + 'k', S.points ? 'points drawn' : 'vertices, ' + (S.cutN || 0).toLocaleString('en') + ' cells cut');
    foot.replaceChildren(h('span', null, 'Depth for ', h('span.num', null, (S.raw.w * S.raw.h).toLocaleString('en')), ' samples in ', h('span.num', null, lab.fmtMs(S.ms)), depth.device === 'webgpu' ? ' on the graphics chip' : ' on the processor'), h('div.grow'), h('span', null, 'Relative depth. Do not read distances from this.'));
  }

  // ---------- export ----------
  function ply() {
    const { GW, GH, d } = S, im = lab.image, px = S.px || sampleColours(im.canvas, GW, GH), n = GW * GH, asp = im.canvas.width / im.canvas.height, sx = asp >= 1 ? 2 : 2 * asp, sy = asp >= 1 ? 2 / asp : 2;
    const head = 'ply\nformat binary_little_endian 1.0\ncomment HOUND Command, Vision lab: one photo lifted by Depth Anything V2 small\ncomment depth from a single image is RELATIVE: z has no units and no true scale\nelement vertex ' + n + '\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n';
    const hb = new TextEncoder().encode(head), buf = new ArrayBuffer(hb.length + n * 15), u8 = new Uint8Array(buf), dv = new DataView(buf); u8.set(hb); let o = hb.length;
    for (let j = 0, i = 0; j < GH; j++) for (let k = 0; k < GW; k++, i++) { dv.setFloat32(o, (k / (GW - 1) - 0.5) * sx, true); dv.setFloat32(o + 4, (0.5 - j / (GH - 1)) * sy, true); dv.setFloat32(o + 8, d[i] * S.strength, true); u8[o + 12] = px[4 * i]; u8[o + 13] = px[4 * i + 1]; u8[o + 14] = px[4 * i + 2]; o += 15; }
    return { buf, n };
  }
  const exportBtn = h('button.btn', { disabled: true, onclick: () => { const { buf, n } = ply(); lab.download('hound-relief.ply', buf); ctx.bus.emit('vision:pointcloud', { name: lab.image.name, count: n, relative: true, ply: buf }); ctx.shell.toast('Saved hound-relief.ply, ' + n.toLocaleString('en') + ' points. Open it in 3-D scan with “Bring your own scan”. Its depth is relative, not metric.', { level: 'ok', ms: 6500 }); } }, icon('download'), 'Send to 3-D scan (.ply)');

  // ---------- side ----------
  const picker = lab.picker(), imgNote = h('p.caption');
  f.section('Photo', picker, imgNote);
  const ro = { ms: lab.readout('one depth estimate', 'ms'), px: lab.readout('depth samples', ''), v: lab.readout('vertices', '') };
  f.section('Relief', h('div.vision-readouts', null, ro.ms.el, ro.px.el, ro.v.el),
    lab.slider({ label: 'Relief strength', min: 0, max: 1, step: 0.01, value: S.strength, assumed: true, fmt: (v) => Math.round(v * 100) + ' %', title: 'How far the nearest point stands out from the farthest. The model gives no true scale, so this is your choice, not a measurement.', onInput: (v) => { S.strength = v; } }),
    h('label.check', { title: 'Leave a gap where the depth jumps, instead of stretching a surface between a near object and what is behind it.' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { S.cut = e.target.checked; rebuild(); } }), 'Cut the surface at depth edges'),
    h('div.note.quiet', null, icon('info'), h('div', null, h('b', null, 'Relative, not metric. '), 'One image fixes the order of things in depth, not their distance. A second view, a known object size, or the rover’s distance sensors would be needed to put metres on it.')),
    h('div.row', null, exportBtn));
  const testBtn = h('button.btn', { onclick: () => runTest().catch((e) => { testBox.replaceChildren(h('div.note.danger', null, icon('alert'), h('div', null, 'The test could not run: ' + String(e.message || e).slice(0, 160)))); }) }, icon('ruler'), 'Test on a scene with known depth');
  const testBox = h('div');
  f.section('Check against a known truth', h('p', null, 'A rubble scene is drawn in 3-D in this page, so the true distance of every pixel is known. The model sees only the picture. Its answer is fitted with the best scale and shift, then compared.'), testBtn, testBox);
  f.section('Model', depth.view());
  f.dossier({
    research: [{ title: 'Depth Anything V2', who: 'Yang, Kang, Huang, Zhao, Xu, Feng, Zhao (HKU and TikTok)', year: 'NeurIPS 2024', url: 'https://arxiv.org/abs/2406.09414', note: 'The small model running here.' }],
    field: 'For a map a rescuer could trust, the relief would need a true scale from a second view, a known object or a range sensor, and frames that are sharp and well lit. Unknown: how the model behaves on dust, smoke, darkness and wet reflective mud, which are rare in its training photos.',
    failure: '',
  });

  // ---------- truth test: a drawn 3-D scene with exact depth ----------
  async function runTest() {
    testBtn.disabled = true;
    try {
      initGL(); if (!renderer) throw new Error('WebGL is not available.');
      setBusy('Drawing a scene with known depth');
      const W = 644, H = 448, sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(58, W / H, 0.3, 40), r = lab.rng(11);
      cam.position.set(0.4, 2.3, 6.2); cam.lookAt(0, 0.5, -1.5); sc.background = new THREE.Color(0x8d99a6);
      const noiseTex = (base, amp, seed) => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), rr = lab.rng(seed), id = g.createImageData(256, 256); for (let i = 0; i < 256 * 256; i++) { const n = (rr() - 0.5) * amp; id.data[4 * i] = base[0] + n; id.data[4 * i + 1] = base[1] + n; id.data[4 * i + 2] = base[2] + n; id.data[4 * i + 3] = 255; } g.putImageData(id, 0, 0); for (let i = 0; i < 60; i++) { g.strokeStyle = 'rgba(30,26,22,' + (0.1 + rr() * 0.25) + ')'; g.lineWidth = 1 + rr() * 2; g.beginPath(); const x = rr() * 256, y = rr() * 256; g.moveTo(x, y); g.lineTo(x + (rr() - 0.5) * 90, y + (rr() - 0.5) * 90); g.stroke(); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; };
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ map: noiseTex([104, 88, 70], 46, 1), roughness: 1 })); ground.material.map.repeat.set(10, 10); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; sc.add(ground);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(14, 4.2, 0.4), new THREE.MeshStandardMaterial({ map: noiseTex([150, 146, 138], 30, 2), roughness: 0.95 })); wall.material.map.repeat.set(4, 1.4); wall.position.set(0, 2.1, -7.5); wall.receiveShadow = true; sc.add(wall);
      const mats = [[168, 164, 156], [132, 128, 122], [120, 92, 70], [96, 104, 110], [150, 120, 96]].map((b, i) => new THREE.MeshStandardMaterial({ map: noiseTex(b, 34, 3 + i), roughness: 0.9 }));
      for (let i = 0; i < 46; i++) { const sx = 0.3 + r() * 1.7, sy = 0.08 + r() * 0.5, sz = 0.3 + r() * 1.4, m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mats[i % mats.length]); m.position.set((r() - 0.5) * 9, sy / 2 + r() * 0.9, 2.2 - r() * 9); m.rotation.set((r() - 0.5) * 0.9, r() * 3.14, (r() - 0.5) * 0.9); m.castShadow = m.receiveShadow = true; sc.add(m); }
      for (let i = 0; i < 7; i++) { const L = 1.5 + r() * 2.5, m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, L, 12), mats[3]); m.position.set((r() - 0.5) * 8, 0.3 + r() * 1.2, 1.5 - r() * 7.5); m.rotation.set(r() * 3, r() * 3, r() * 3); m.castShadow = true; sc.add(m); }
      sc.add(new THREE.HemisphereLight(0xcfd8e3, 0x4a4036, 1.1)); const sun = new THREE.DirectionalLight(0xfff2dd, 2.6); sun.position.set(-5, 8, 4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 }); sun.shadow.bias = -0.0015; sc.add(sun);
      const rtC = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace, samples: 4 }), rtD = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      const prevShadow = renderer.shadowMap.enabled; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setRenderTarget(rtC); renderer.render(sc, cam);
      const rgba = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(rtC, 0, 0, W, H, rgba);
      sc.background = null; sc.overrideMaterial = new THREE.ShaderMaterial({ vertexShader: 'varying float vZ; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }', fragmentShader: 'varying float vZ; void main() { gl_FragColor = vec4(vZ, 0.0, 0.0, 1.0); }' });
      renderer.setClearColor(0x000000, 0); renderer.setRenderTarget(rtD); renderer.clear(); renderer.render(sc, cam);
      const zf = new Float32Array(W * H * 4); renderer.readRenderTargetPixels(rtD, 0, 0, W, H, zf);
      renderer.setRenderTarget(null); renderer.shadowMap.enabled = prevShadow; sc.overrideMaterial.dispose(); sc.overrideMaterial = null; rtC.dispose(); rtD.dispose();
      sc.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; const g = canvas.getContext('2d'), id = g.createImageData(W, H), z = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((H - 1 - y) * W + x) * 4, t = (y * W + x) * 4; id.data[t] = rgba[s]; id.data[t + 1] = rgba[s + 1]; id.data[t + 2] = rgba[s + 2]; id.data[t + 3] = 255; z[y * W + x] = zf[s]; }
      g.putImageData(id, 0, 0);
      if (!(z[W * (H - 10) + (W >> 1)] > 0)) throw new Error('This graphics driver did not return the true depth, so there is nothing to compare with.');
      lab.setImage({ canvas, name: 'Known-depth test scene', kind: 'Rendered in this page', note: 'Rubble, pipes and a wall, with exact depth', gsd: null, view: 'oblique', id: 'truth' });
      const r0 = await estimate(); if (!r0) return;
      // Fit scale and shift: the model's output p is an inverse depth up to s and b. Solve min sum (s p + b - 1/z)^2 over pixels with a true depth.
      const p = bilinear(r0.p, r0.w, r0.h, W, H); let n = 0, sp = 0, spp = 0, sq = 0, spq = 0;
      for (let i = 0; i < z.length; i++) if (z[i] > 0) { const q = 1 / z[i]; n++; sp += p[i]; spp += p[i] * p[i]; sq += q; spq += p[i] * q; }
      const s = (n * spq - sp * sq) / (n * spp - sp * sp), b = (sq - s * sp) / n;
      let abs = 0, d1 = 0, zlo = Infinity, zhi = 0; const zhat = new Float32Array(z.length), err = new Float32Array(z.length);
      for (let i = 0; i < z.length; i++) if (z[i] > 0) { const zh = 1 / Math.max(1e-3, s * p[i] + b); zhat[i] = zh; const e = Math.abs(zh - z[i]) / z[i]; err[i] = e; abs += e; if (Math.max(zh / z[i], z[i] / zh) < 1.25) d1++; if (z[i] < zlo) zlo = z[i]; if (z[i] > zhi) zhi = z[i]; }
      // Spearman rank correlation between the raw prediction and the true inverse depth, on a sample of pixels
      const pick = []; const rr = lab.rng(5); for (let k = 0; k < 6000; k++) { const i = (rr() * z.length) | 0; if (z[i] > 0) pick.push(i); }
      const rank = (vals) => { const o = vals.map((v, i) => [v, i]).sort((a, c) => a[0] - c[0]), rk = new Float64Array(vals.length); o.forEach(([, i], k) => { rk[i] = k; }); return rk; };
      const ra = rank(pick.map((i) => p[i])), rb = rank(pick.map((i) => 1 / z[i])); let ma = 0, mb = 0; ra.forEach((v, i) => { ma += v; mb += rb[i]; }); ma /= ra.length; mb /= rb.length; let cab = 0, caa = 0, cbb = 0; ra.forEach((v, i) => { cab += (v - ma) * (rb[i] - mb); caa += (v - ma) ** 2; cbb += (rb[i] - mb) ** 2; });
      const res = { absRel: abs / n, d1: d1 / n, rho: cab / Math.sqrt(caa * cbb), zlo, zhi, n }; S.test = res;
      const map = (src, fn) => { const c = h('canvas', { width: W, height: H }), cg = c.getContext('2d'), im2 = cg.createImageData(W, H); for (let i = 0; i < z.length; i++) { const col = z[i] > 0 ? fn(src[i]) : [20, 24, 30]; im2.data[4 * i] = col[0]; im2.data[4 * i + 1] = col[1]; im2.data[4 * i + 2] = col[2]; im2.data[4 * i + 3] = 255; } cg.putImageData(im2, 0, 0); return c; };
      const near = (v) => lab.DEPTH(1 - lab.clamp((v - zlo) / (zhi - zlo), 0, 1));
      testBox.replaceChildren(
        h('div.vision-relief-maps', null, h('figure', null, map(z, near), h('figcaption', null, 'True depth, ' + zlo.toFixed(1) + ' to ' + zhi.toFixed(1) + ' m')), h('figure', null, map(zhat, near), h('figcaption', null, 'Model, after the fit')), h('figure', null, map(err, (e) => lab.HEAT(lab.clamp(e / 0.5, 0, 1))), h('figcaption', null, 'Error, dark 0 to bright 50 %'))),
        h('dl.kv.num', null, h('dt', { title: 'Mean of |estimated − true| / true over all pixels, after the fit.' }, 'Mean relative error'), h('dd', { class: res.absRel > 0.15 ? 'c-warn' : '' }, (100 * res.absRel).toFixed(1) + ' %'),
          h('dt', { title: 'Share of pixels whose estimated depth is within a factor 1.25 of the truth.' }, 'Within 25 % of truth'), h('dd', null, (100 * res.d1).toFixed(1) + ' % of pixels'),
          h('dt', { title: 'Spearman rank correlation between the raw output and true nearness: does the model order pixels correctly? 1 is perfect.' }, 'Depth order correct'), h('dd', null, 'ρ = ' + res.rho.toFixed(3)), h('dt', null, 'Pixels compared'), h('dd', null, n.toLocaleString('en'))),
        h('p.caption', null, 'The scale and shift come from the truth itself, which a rover would not have. Without them the model only orders the scene. A drawn scene is not a photograph; this measures the model here, not in the field.'));
    } finally { testBtn.disabled = false; setBusy(''); }
  }

  // ---------- image ----------
  function onImage() {
    const im = lab.image; if (!im) return;
    S.d = null; S.px = null; pipWrap.hidden = true; exportBtn.disabled = true; go.hidden = false;
    if (mesh) { group.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; } if (frame) { group.remove(frame); frame.geometry.dispose(); frame = null; }
    if (renderer) renderer.clear();
    imgNote.textContent = im.name + '. ' + (im.note || '') + '. ' + im.kind + '.' + (im.view === 'nadir' ? ' Seen from straight above, so the relief is laid flat like a terrain model.' : '');
    go.lastChild.textContent = depth.status === 'ready' ? 'Lift this photo' : 'Load model and lift this photo · ' + lab.fmtMB(depth.mb);
    foot.replaceChildren(h('span', null, depth.status === 'ready' ? 'New photo. Estimating its depth.' : 'The photo is flat until the model has run. Nothing has been downloaded yet.'));
    drawFlat(); ro.ms.set('–'); ro.px.set('–'); ro.v.set('–');
    if (depth.status === 'ready' && im.id !== 'truth') estimate().catch(() => {});
  }
  const off = lab.on((t) => { if (t === 'image') onImage(); if (t === 'samples' && !lab.image) { const s = lab.samples.find((x) => x.id === 'scene-corridor') || lab.samples[0]; if (s) lab.useSample(s).catch(() => {}); } });
  if (lab.image) onImage(); else { const s = lab.samples.find((x) => x.id === 'scene-corridor') || lab.samples[0]; if (s) lab.useSample(s).catch(() => {}); }
  new ResizeObserver(drawFlat).observe(host);
  return { onShow() { resize(); drawFlat(); loop.start(); }, onHide() { loop.stop(); }, onPrefs() { if (S.d) rebuild(); }, dispose() { off(); } };
}
