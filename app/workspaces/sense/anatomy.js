// Network anatomy: one 10-second window flowing through the real network, drawn from the real activations.
//
// Layout (three.js): nine terraces stepping down towards the viewer. Time runs left to right on every terrace, lined up
// with the spectrogram above, and every cell sits over the centre of the part of the window it can see, so the network
// narrows like a funnel. Bar height and colour are the activation (relative to that layer's own peak).
// Lines after the last convolution are real products of weight and input; the three strongest routes to the person
// answer are drawn as bright tubes and traced back to the seconds of the window they came from.
// Without WebGL (or in "Flat" mode) the same numbers are drawn as stacked heat maps on a 2-D canvas.
import { HEAT, signed, clamp, tok } from './common.js';
import { fieldOf } from './fastnet.js';

export const STAGES = [
  { id: 'x', name: 'The window', short: 'Window', rows: 52, T: 200, stride: 1, c0: 0.5, dims: '52 × 200', say: 'The 10-second window enters: 51 Wi-Fi subcarriers, then the motion row at the front. Blue is below a subcarrier’s average, amber is above.' },
  { id: 'c1', name: 'Convolution 1', short: 'Conv 1', rows: 24, T: 192, stride: 1, c0: 4.5, dims: '24 × 192', say: 'Convolution 1: 24 filters slide along the window. Each cell reads 0.45 s of all 52 rows at once.' },
  { id: 'p1', name: 'Average pool', short: 'Pool', rows: 24, T: 48, stride: 4, c0: 6, dims: '24 × 48', say: 'Average pool: every 4 steps become 1, so the signal is now 5 samples a second.' },
  { id: 'c2', name: 'Convolution 2', short: 'Conv 2', rows: 24, T: 40, stride: 4, c0: 22, dims: '24 × 40', say: 'Convolution 2: each cell now sees 2.2 s of the window, about the length of one breath.' },
  { id: 'p2', name: 'Average pool', short: 'Pool', rows: 24, T: 20, stride: 8, c0: 24, dims: '24 × 20', say: 'Average pool: every 2 steps become 1.' },
  { id: 'c3', name: 'Convolution 3', short: 'Conv 3', rows: 24, T: 12, stride: 8, c0: 56, dims: '24 × 12', say: 'Convolution 3: each cell sees 5.6 s, more than half the window.' },
  { id: 'feat', name: 'Mean and max', short: 'Mean, max', dims: '48', say: 'Time is removed: for each of the 24 filters, its average over the window (left) and its single highest peak (right).' },
  { id: 'hidden', name: 'Dense layer', short: 'Dense', dims: '32', say: 'Dense layer: 32 units, each a weighted sum of the 48 numbers. The lines are the strongest weight × input products.' },
  { id: 'out', name: 'Two answers', short: 'Answer', dims: '', say: 'Two answers: is a person there (alarm above the threshold), and are they still or moving. Amber lines push an answer up, blue lines push it down.' },
];
const U = 0.09, DZ = [0.03, 0.042, 0.042, 0.042, 0.042, 0.042], GAP = 0.52, STEP = 0.26, HMAX = [0.3, 0.62, 0.62, 0.62, 0.62, 0.62];
const NAMES = ['x', 'c1', 'p1', 'c2', 'p2', 'c3'];
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// What the numbers say about routes through the last layers. Pure arithmetic on the trace and the weights.
export function analyse(out, w) {
  const { feat, hidden } = out.layers;
  const cP = hidden.map((v, j) => v * (w[8][j][1] - w[8][j][0])), cM = hidden.map((v, j) => v * (w[10][j][1] - w[10][j][0]));
  const dense = [];
  for (let j = 0; j < 32; j++) if (hidden[j] > 0) for (let i = 0; i < 48; i++) { const v = feat[i] * w[6][i][j]; if (v) dense.push({ i, j, v }); }
  dense.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const order = cP.map((v, j) => ({ v, j })).filter((o) => o.v !== 0).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 3);
  const chains = order.map(({ v, j }) => {
    let i = 0, best = -Infinity; for (let k = 0; k < 48; k++) { const c = feat[k] * w[6][k][j]; if (c > best) { best = c; i = k; } }
    const ch = i % 24, kind = i < 24 ? 'mean' : 'max', t = kind === 'max' ? out.arg[ch] : null;
    const f = kind === 'max' ? fieldOf(5, t) : fieldOf(5, 0, 11);
    return { j, v, i, ch, kind, t, field: f, sec: [f[0][0] / 20, (Math.min(199, f[0][1]) + 1) / 20] };
  });
  return { cP, cM, dense: dense.slice(0, 80), denseMax: dense.length ? Math.abs(dense[0].v) : 1, chains };
}
const layerMax = (rows) => { let m = 1e-9; for (const r of rows) for (let i = 0; i < r.length; i++) if (r[i] > m) m = r[i]; return m; };
export function inputScale(x) { const a = []; for (let r = 0; r < 51; r++) for (let t = 0; t < 200; t += 3) { const v = Math.abs(x[r][t]); if (Number.isFinite(v)) a.push(v); } a.sort((p, q) => p - q); return Math.max(0.5, a[Math.floor(a.length * 0.99)] || 1); }

export async function createAnatomy(host, ctx, { onStage = () => {}, onHover = () => {} } = {}) {
  const { h } = ctx.kit;
  const canvasHost = h('div.sense-ana-canvas'), labels = h('div.sense-ana-labels', { 'aria-hidden': 'true' }), tip = h('div.sense-ana-tip.glass', { hidden: true });
  const refused = h('div.sense-ana-refused', { hidden: true });
  host.append(canvasHost, labels, tip, refused);
  let data = null, an = null, stage = 9, playing = false, running = false, raf = 0, mode = '3d', three = null, flat = null, lastT = 0;
  const api = { webgl: true, get stage() { return stage; }, get playing() { return playing; }, get mode() { return mode; } };

  try { three = await build3d(); } catch (e) { console.warn('[sense] 3-D view unavailable, using the flat view:', e.message || e); api.webgl = false; mode = 'flat'; }
  flat = buildFlat();
  applyMode();

  function applyMode() { if (three) { three.dom.hidden = mode !== '3d'; three.dom.style.display = mode === '3d' ? 'block' : 'none'; } flat.canvas.hidden = mode !== 'flat'; labels.hidden = mode !== '3d'; tip.hidden = true; if (mode === 'flat') flat.draw(); else three?.resize(); }
  api.setMode = (m) => { mode = m === '3d' && three ? '3d' : 'flat'; applyMode(); if (running) kick(); return mode; };
  api.setData = (d) => { // { x, out (trace) | null, reason, threshold, weights, scale }
    data = d; an = d.out ? analyse(d.out, d.weights) : null;
    refused.hidden = !!d.out; if (!d.out) refused.replaceChildren(h('b', null, 'Refused. Nothing flows through the network.'), h('span', null, d.reason || ''));
    three?.setData(); flat.draw(); api.analysis = an;
  };
  api.setStage = (s, { silent = false } = {}) => { stage = clamp(s, 0, 9); three?.setStage(); if (mode === 'flat') flat.draw(); if (!silent) onStage(stage); };
  api.play = (from = null) => { if (from != null) api.setStage(from); else if (stage >= 9) api.setStage(1); if (ctx.kit.reducedMotion()) { api.setStage(9); return; } playing = true; onStage(stage); kick(); };
  api.pause = () => { playing = false; onStage(stage); };
  api.start = () => { running = true; kick(); };
  api.stop = () => { running = false; playing = false; cancelAnimationFrame(raf); raf = 0; };
  api.resetView = () => three?.resetView();
  api.dispose = () => { api.stop(); three?.dispose(); ro.disconnect(); };
  function kick() { if (!raf && running) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
  function frame(now) {
    raf = 0; if (!running) return;
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    if (playing) { const s = stage + dt * 2.6; if (s >= 9) { playing = false; api.setStage(9); } else api.setStage(s); }
    if (mode === '3d' && three) { three.render(dt); raf = requestAnimationFrame(frame); } else if (playing) raf = requestAnimationFrame(frame);
  }
  const ro = new ResizeObserver(() => { if (mode === '3d') three?.resize(); else flat.draw(); });
  ro.observe(canvasHost);
  return api;

  // ------------------------------------------------------------------ flat (2-D canvas) ----------------------------
  function buildFlat() {
    const canvas = h('canvas.sense-ana-flat', { role: 'img', 'aria-label': 'The activations of every layer of the network, as stacked heat maps' });
    canvasHost.append(canvas);
    const off = document.createElement('canvas');
    function heat(c, rows, x, y, w, hh, max, sign) {
      const R = rows.length, T = rows[0].length; off.width = T; off.height = R; const o = off.getContext('2d'), img = o.createImageData(T, R);
      for (let r = 0; r < R; r++) for (let t = 0; t < T; t++) { const v = rows[r][t], col = !Number.isFinite(v) ? [255, 77, 94] : sign ? signed(clamp(v / max, -1, 1)) : HEAT(Math.pow(clamp(v / max, 0, 1), 0.5)), k = (r * T + t) * 4; img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255; }
      o.putImageData(img, 0, 0); c.imageSmoothingEnabled = false; c.drawImage(off, x, y, w, hh);
    }
    function draw() {
      if (canvas.hidden) return;
      const r = canvasHost.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); if (!r.width || !r.height) return;
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
      const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, r.width, r.height);
      if (!data) return;
      const L = 150, Rm = 16, Wd = r.width - L - Rm, top = 10, rowH = (r.height - top - 8) / 9, px = (s) => L + (s / 200) * Wd;
      c.font = '600 12px ' + tok('--font'); c.textBaseline = 'middle';
      STAGES.forEach((st, k) => {
        const y = top + k * rowH, hh = rowH - 8, shown = clamp(stage - k, 0, 1), on = data.out || k === 0;
        c.globalAlpha = on && shown > 0 ? 1 : 0.4; c.fillStyle = tok('--text'); c.font = '600 12px ' + tok('--font'); c.textAlign = 'right'; c.fillText(st.name, L - 12, y + hh / 2 - 7);
        c.fillStyle = tok('--text-3'); c.font = '11px ' + tok('--font'); c.fillText(st.dims.replace('×', 'rows ×'), L - 12, y + hh / 2 + 8); c.globalAlpha = 1;
        c.strokeStyle = tok('--line'); c.lineWidth = 1;
        if (k < 6) {
          const x0 = px(st.c0 - st.stride / 2), w = (st.T * st.stride / 200) * Wd; c.strokeRect(x0 - 0.5, y - 0.5, w + 1, hh + 1);
          if (!on || shown <= 0) return;
          const rows = k === 0 ? data.x : data.out.layers[st.id];
          c.save(); c.beginPath(); c.rect(x0, y, w * shown, hh); c.clip(); heat(c, rows, x0, y, w, hh, k === 0 ? data.scale : layerMax(rows), k === 0); c.restore();
        } else if (on && shown > 0 && data.out) {
          const vals = k === 6 ? data.out.layers.feat : k === 7 ? data.out.layers.hidden : [data.out.person, data.out.moving];
          if (k === 8) { // two horizontal meters with their decision lines
            const fires = data.out.person > data.threshold;
            [[data.out.person, data.threshold, `Person ${data.out.person.toFixed(2)}, alarm above ${data.threshold.toFixed(2)}`, fires ? tok('--person') : tok('--text-2'), 1], [data.out.moving, 0.5, fires ? `Moving ${data.out.moving.toFixed(2)}` : `Moving ${data.out.moving.toFixed(2)}, not read without an alarm`, tok('--text-2'), fires ? 1 : 0.45]].forEach(([val, tick, text, col, alpha], i) => {
              const x0 = px(20 + i * 86), w = px(74) - px(0), my = y + hh - 9; c.globalAlpha = alpha; c.fillStyle = tok('--bg-4'); c.fillRect(x0, my, w, 6); c.fillStyle = col; c.fillRect(x0, my, w * val * shown, 6); c.fillStyle = tok('--text'); c.fillRect(x0 + w * tick - 1, my - 3, 2, 12);
              c.textAlign = 'left'; c.font = '12px ' + tok('--font'); c.fillText(text, x0, my - 12); c.globalAlpha = 1; });
            return;
          }
          const max = Math.max(1e-9, ...vals), n = vals.length, x0 = px(20), w = px(180) - x0, bw = w / n, cap = k === 6 ? 14 : 0;
          vals.forEach((v, i) => { const bh = (hh - 2 - cap) * clamp(v / max, 0, 1) * shown, col = HEAT(Math.pow(clamp(v / max, 0, 1), 0.5)); c.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`; c.fillRect(x0 + i * bw + 1, y + hh - bh, Math.max(1, bw - 2), Math.max(1, bh)); });
          c.fillStyle = tok('--line-2'); c.fillRect(x0, y + hh, w, 1);
          if (k === 6) { c.fillStyle = tok('--text-3'); c.textAlign = 'left'; c.font = '11px ' + tok('--font'); c.fillText('average of each filter', x0, y + 5); c.fillText('peak of each filter', x0 + w / 2 + 4, y + 5); }
        }
      });
      if (an && an.chains[0] && stage >= 6) { // the seconds the strongest route came from
        const [a, b] = an.chains[0].sec; c.strokeStyle = tok('--text'); c.lineWidth = 1.5; c.strokeRect(px(a * 20), top - 3, px(b * 20) - px(a * 20), rowH - 2);
      }
    }
    return { canvas, draw };
  }

  // ------------------------------------------------------------------ 3-D ------------------------------------------
  async function build3d() {
    const probe = document.createElement('canvas'); if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('WebGL is not available');
    const THREE = await import('three');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const dom = renderer.domElement; dom.className = 'sense-ana-gl'; dom.tabIndex = 0;
    dom.setAttribute('role', 'img'); dom.setAttribute('aria-label', 'The network in 3-D: the window at the back, then each layer as a terrace of bars, down to the two answers at the front. Drag to orbit, scroll to zoom.');
    canvasHost.append(dom);
    const scene = new THREE.Scene(); const bg = new THREE.Color(tok('--bg-0') || '#07090c'); scene.background = bg; scene.fog = new THREE.Fog(bg, 34, 80);
    const camera = new THREE.PerspectiveCamera(28, 2, 0.1, 200);
    const controls = new OrbitControls(camera, dom); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 6; controls.maxDistance = 60; controls.maxPolarAngle = Math.PI * 0.49; controls.zoomSpeed = 0.7;
    let userAt = -1e9; controls.addEventListener('start', () => { userAt = performance.now(); });
    scene.add(new THREE.HemisphereLight(0xc9dcff, 0x0a0c10, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(-9, 16, 3); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 50 }); key.shadow.bias = -0.0006; key.shadow.radius = 3; scene.add(key);
    const rim = new THREE.DirectionalLight(0x5aa9ff, 0.35); rim.position.set(10, 6, -12); scene.add(rim);

    // ---- layout
    const P = []; let z = 0, y = 0;
    STAGES.forEach((st, k) => { const depth = k === 0 ? 51 * DZ[0] + 0.5 : k < 6 ? st.rows * DZ[k] : k === 8 ? 1.3 : 0.5; P.push({ z0: z, depth, y: 0 }); z += depth + GAP; });
    const zTot = z - GAP; P.forEach((p, k) => { p.z0 -= zTot / 2; p.y = (8 - k) * STEP; });
    const X = (s) => (s - 100) * U;
    const cellX = (k, t) => X(STAGES[k].c0 + t * STAGES[k].stride);
    const rowZ = (k, r) => P[k].z0 + (k === 0 ? (r < 51 ? (r + 0.5) * DZ[0] : 51 * DZ[0] + 0.3) : (r + 0.5) * DZ[k]);
    const VEC = { feat: (i) => (i < 24 ? -8.2 + i * (7.4 / 23) : 0.8 + (i - 24) * (7.4 / 23)), hidden: (j) => -6.4 + j * (12.8 / 31), out: (i) => (i ? 3 : -3) };
    const vz = (k) => P[k].z0 + P[k].depth / 2;

    const SLABW = (k) => (k < 6 ? 200 * U + 0.5 : k === 6 ? 17.2 : k === 7 ? 13.6 : 9);
    // ---- ground and terraces
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x090b0f, roughness: 0.95, metalness: 0 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.12; ground.receiveShadow = true; scene.add(ground);
    const grid = new THREE.GridHelper(80, 80, 0x1a2029, 0x12161c); grid.position.y = -0.115; grid.material.transparent = true; grid.material.opacity = 0.7; scene.add(grid);
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x141920, roughness: 0.55, metalness: 0.35 }), edgeMat = new THREE.LineBasicMaterial({ color: 0x323b47 });
    P.forEach((p, k) => {
      const w = SLABW(k), hgt = p.y + 0.1;
      const g = new THREE.BoxGeometry(w, hgt, p.depth + 0.24), m = new THREE.Mesh(g, slabMat); m.position.set(0, p.y - hgt / 2 - 0.004, p.z0 + p.depth / 2); m.receiveShadow = true; m.castShadow = true; scene.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat); e.position.copy(m.position); scene.add(e);
    });
    // time ticks on the window terrace: one per second
    { const pts = []; for (let s = 0; s <= 10; s++) { const x = X(s * 20), zz = P[0].z0 - 0.12; pts.push(x, P[0].y + 0.001, zz, x, P[0].y + 0.001, zz - (s % 5 ? 0.12 : 0.26)); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x74808e }))); }

    // ---- bars
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    const barMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 });
    barMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance += vColor.rgb * 0.85;\n#endif'); };
    const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color();
    const meshes = STAGES.map((st, k) => {
      const n = k < 6 ? st.rows * st.T : k === 6 ? 48 : k === 7 ? 32 : 0; if (!n) return null;
      const m = new THREE.InstancedMesh(box, barMat, n); m.castShadow = k > 0; m.receiveShadow = true; m.userData.k = k; m.frustumCulled = false;
      for (let i = 0; i < n; i++) {
        let x, zz, sx, sz;
        if (k < 6) { const r = Math.floor(i / st.T), t = i % st.T; x = cellX(k, t); zz = rowZ(k, r); sx = st.stride * U * (st.stride > 1 ? 0.84 : 0.92); sz = k === 0 ? (r === 51 ? 0.2 : DZ[0] * 0.9) : DZ[k] * 0.82; }
        else { x = VEC[st.id](i); zz = vz(k); sx = k === 6 ? 0.22 : 0.28; sz = 0.34; }
        tmpM.makeScale(sx, 0.001, sz).setPosition(x, P[k].y, zz); m.setMatrixAt(i, tmpM); m.setColorAt(i, tmpC.setRGB(0.02, 0.025, 0.035));
      }
      scene.add(m); return m;
    });
    const heights = meshes.map((m) => (m ? new Float32Array(m.count) : null)), shown = new Float32Array(9).fill(-1);
    // answers: two pillars with a threshold plate each
    const pillarMat = [0, 1].map(() => new THREE.MeshStandardMaterial({ color: 0x8a96a5, roughness: 0.35, metalness: 0.1, emissive: 0x000000, transparent: true }));
    const PH = 1.8, pillars = [0, 1].map((i) => { const m = new THREE.Mesh(box, pillarMat[i]); m.position.set(VEC.out(i), P[8].y, vz(8)); m.scale.set(0.8, 0.001, 0.8); m.castShadow = true; scene.add(m); return m; });
    const ghostMat = new THREE.LineBasicMaterial({ color: 0x323b47 }), plateMat = new THREE.MeshBasicMaterial({ color: 0xe9edf2, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }), plateEdge = new THREE.LineBasicMaterial({ color: 0xe9edf2 });
    const plates = [0, 1].map((i) => { const grp = new THREE.Group(); const cage = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.8, PH, 0.8)), ghostMat); cage.position.y = PH / 2; const pg = new THREE.PlaneGeometry(1.25, 1.25); pg.rotateX(-Math.PI / 2); const pl = new THREE.Mesh(pg, plateMat), pe = new THREE.LineSegments(new THREE.EdgesGeometry(pg), plateEdge); grp.add(cage, pl, pe); grp.userData = { pl, pe }; grp.position.set(VEC.out(i), P[8].y, vz(8)); scene.add(grp); return grp; });

    // ---- lines
    const lineMat = () => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const mkLines = (n) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3)); const l = new THREE.LineSegments(g, lineMat()); l.frustumCulled = false; scene.add(l); return l; };
    const lnFeat = mkLines(48), lnDense = mkLines(80), lnOut = mkLines(64);
    const tubeMat = new THREE.MeshBasicMaterial({ color: 0xe6d9a8, toneMapped: false, transparent: true }), tubes = new THREE.Group(); scene.add(tubes);
    const rectMat = new THREE.LineBasicMaterial({ color: 0xfff3c4, transparent: true, toneMapped: false }), hoverMat = new THREE.LineBasicMaterial({ color: 0x5aa9ff, toneMapped: false }), fillMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
    const mkRects = (mat, fill) => NAMES.map(() => { const g = new THREE.Group(); const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3)); g.add(new THREE.Line(lg, mat)); if (fill) { const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2); g.add(new THREE.Mesh(pg, fillMat)); } g.visible = false; scene.add(g); return g; });
    const pathRects = mkRects(rectMat, true), hoverRects = mkRects(hoverMat, false);
    function setRect(g, k, a, b, r0 = 0, r1 = STAGES[k].rows - 1, lift = 0.012) {
      const st = STAGES[k], x0 = cellX(k, a) - st.stride * U / 2, x1 = cellX(k, Math.min(st.T - 1, b)) + st.stride * U / 2, z0 = rowZ(k, r0) - DZ[k] / 2, z1 = rowZ(k, r1) + (k === 0 && r1 === 51 ? 0.12 : DZ[k] / 2), yy = P[k].y + lift;
      const p = g.children[0].geometry.attributes.position; [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].forEach(([xx, zz], i) => p.setXYZ(i, xx, yy, zz)); p.needsUpdate = true;
      if (g.children[1]) { g.children[1].position.set((x0 + x1) / 2, yy, (z0 + z1) / 2); g.children[1].scale.set(x1 - x0, 1, z1 - z0); }
      g.visible = true;
    }
    // the sliding window of the layer being computed
    const kern = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe9edf2, transparent: true, opacity: 0.9, toneMapped: false })); kern.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(20 * 6), 3)); kern.frustumCulled = false; kern.visible = false; scene.add(kern);

    // ---- labels
    const lab = STAGES.map((st, k) => { const el = h('div.sense-ana-label', null, h('b', null, st.name), h('span', null, st.dims)); labels.append(el); return { el, at: new THREE.Vector3(-SLABW(k) / 2 - 0.45, P[k].y, P[k].z0 + P[k].depth * 0.35) }; });
    const outLab = [0, 1].map((i) => { const el = h('div.sense-ana-out'); labels.append(el); return { el, at: new THREE.Vector3(VEC.out(i) + 0.75, P[8].y + 0.5, vz(8)) }; });
    const axLab = [['0 s', 0], ['5 s', 100], ['10 s', 200]].map(([txt, s]) => { const el = h('div.sense-ana-ax', null, txt); labels.append(el); return { el, at: new THREE.Vector3(X(s), P[0].y, P[0].z0 - 0.55) }; });
    const v = new THREE.Vector3();
    function placeLabels(w, hh) {
      const put = (o, alignRight) => { v.copy(o.at).project(camera); const on = v.z < 1 && v.z > -1; o.el.style.display = on ? '' : 'none'; if (!on) return; let px = (v.x + 1) / 2 * w; if (alignRight) { o.w ||= o.el.offsetWidth; px = Math.max(px, o.w + 2); } o.el.style.transform = `translate(${px.toFixed(1)}px, ${((1 - v.y) / 2 * hh).toFixed(1)}px) translate(${alignRight ? '-100%' : '0'}, -50%)`; };
      lab.forEach((o, k) => { put(o, true); o.el.classList.toggle('dim', stage < k || (!data?.out && k > 0)); o.el.classList.toggle('now', Math.min(8, Math.floor(stage - 0.001)) === k && stage < 9); });
      outLab.forEach((o) => put(o, false)); axLab.forEach((o) => put(o, false));
    }

    // ---- post-processing (a restrained bloom on the brightest cells); plain rendering if the add-ons do not load
    let composer = null, bloom = null;
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all(['EffectComposer', 'RenderPass', 'UnrealBloomPass', 'OutputPass'].map((n) => import(`three/addons/postprocessing/${n}.js`)));
      composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera)); bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.5, 0.86); composer.addPass(bloom); composer.addPass(new OutputPass());
    } catch (e) { composer = null; }

    const HOME = { pos: new THREE.Vector3(-5.2, 20.9, 21.6), target: new THREE.Vector3(-0.9, 0.45, 0.4) };
    function resetView() { const k = clamp(868 / (W0 || 868), 0.75, 1.7) - 1, off = HOME.pos.clone().sub(HOME.target).multiplyScalar(1 + 0.1 * Math.max(0, k)); controls.target.copy(HOME.target); controls.target.x -= 1.1 * k; camera.position.copy(controls.target).add(off); controls.update(); userAt = -1e9; }
    let W0 = 0, H0 = 0;
    resetView();
    function resize() { const r = canvasHost.getBoundingClientRect(); if (!r.width || !r.height || dom.hidden) return; W0 = r.width; H0 = r.height; renderer.setSize(W0, H0, false); dom.style.width = W0 + 'px'; dom.style.height = H0 + 'px'; composer?.setSize(W0, H0); camera.aspect = W0 / H0; camera.fov = clamp(27 * (2.1 / camera.aspect) ** 0.8, 22, 46); camera.updateProjectionMatrix(); if (userAt === -1e9) resetView(); render(0); }

    // ---- data -> colours and target heights
    function setData() {
      shown.fill(-1); if (!data) return;
      const col = (m, i, c) => m.setColorAt(i, tmpC.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace));
      { const m = meshes[0], hs = heights[0], sc = data.scale; let ms = 1e-9; for (let t = 0; t < 200; t++) { const q = data.x[51][t]; if (Number.isFinite(q) && Math.abs(q) > ms) ms = Math.abs(q); } ms = Math.max(ms, 1);
        for (let r = 0; r < 52; r++) for (let t = 0; t < 200; t++) { const q = data.x[r][t], i = r * 200 + t; if (!Number.isFinite(q)) { hs[i] = 1.2; col(m, i, [255, 77, 94]); continue; } const n = clamp(q / (r === 51 ? ms : sc), -1, 1); hs[i] = 0.012 + HMAX[0] * Math.abs(n) * (r === 51 ? 1.6 : 1); col(m, i, signed(n)); }
        m.instanceColor.needsUpdate = true; }
      for (let k = 1; k < 8; k++) {
        const m = meshes[k], hs = heights[k]; if (!data.out) { hs.fill(0); for (let i = 0; i < m.count; i++) m.setColorAt(i, tmpC.setRGB(0.02, 0.025, 0.035)); m.instanceColor.needsUpdate = true; continue; }
        const st = STAGES[k], rows = k < 6 ? data.out.layers[st.id] : null, vals = k === 6 ? data.out.layers.feat : k === 7 ? data.out.layers.hidden : null, max = rows ? layerMax(rows) : Math.max(1e-9, ...vals);
        for (let i = 0; i < m.count; i++) { const q = rows ? rows[Math.floor(i / st.T)][i % st.T] : vals[i], n = clamp(q / max, 0, 1); hs[i] = 0.012 + (k < 6 ? HMAX[k] : 1.0) * Math.pow(n, 0.8); col(m, i, HEAT(Math.pow(n, 0.5))); }
        m.instanceColor.needsUpdate = true;
      }
      buildLines(); setStage();
    }
    function top(k, i) { const st = STAGES[k]; if (k < 6) { const r = Math.floor(i / st.T), t = i % st.T; return [cellX(k, t), P[k].y + heights[k][i], rowZ(k, r)]; } return [VEC[st.id](i), P[k].y + heights[k][i], vz(k)]; }
    const pillarTop = (i) => [VEC.out(i), P[8].y + PH * (i ? data.out.moving : data.out.person), vz(8)];
    function buildLines() {
      for (const t of [...tubes.children]) { t.geometry.dispose(); tubes.remove(t); }
      pathRects.forEach((g) => { g.visible = false; }); [lnFeat, lnDense, lnOut].forEach((l) => { l.geometry.setDrawRange(0, 0); });
      if (!data.out || !an) return;
      const seg = (l, i, a, b, c, s) => { const p = l.geometry.attributes.position, cc = l.geometry.attributes.color; p.setXYZ(i * 2, ...a); p.setXYZ(i * 2 + 1, ...b); cc.setXYZ(i * 2, c[0] * s * 0.25, c[1] * s * 0.25, c[2] * s * 0.25); cc.setXYZ(i * 2 + 1, c[0] * s, c[1] * s, c[2] * s); };
      const done = (l, n) => { l.geometry.attributes.position.needsUpdate = true; l.geometry.attributes.color.needsUpdate = true; l.geometry.setDrawRange(0, n * 2); };
      const warm = [1, 0.7, 0.29], cool = [0.35, 0.66, 1], { feat } = data.out.layers, fmax = Math.max(1e-9, ...feat);
      for (let i = 0; i < 48; i++) { const ch = i % 24, from = i < 24 ? [0.9 * X(STAGES[5].c0 + 5.5 * 8), P[5].y + 0.02, rowZ(5, ch)] : top(5, ch * 12 + data.out.arg[ch]); seg(lnFeat, i, from, top(6, i), [0.6, 0.72, 0.9], 0.03 + 0.3 * feat[i] / fmax); }
      done(lnFeat, 48);
      an.dense.forEach((d, n) => seg(lnDense, n, top(6, d.i), top(7, d.j), d.v > 0 ? warm : cool, 0.1 + 0.75 * Math.abs(d.v) / an.denseMax)); done(lnDense, an.dense.length);
      let n = 0; [an.cP, an.cM].forEach((c, o) => { const mx = Math.max(1e-9, ...c.map(Math.abs)); c.forEach((val, j) => { if (Math.abs(val) / mx > 0.04) seg(lnOut, n++, top(7, j), pillarTop(o), val > 0 ? warm : cool, 0.12 + 0.8 * Math.abs(val) / mx); }); }); done(lnOut, n);
      an.chains.forEach((c, rank) => {
        const a = c.kind === 'max' ? top(5, c.ch * 12 + c.t) : [0.9 * X(STAGES[5].c0 + 5.5 * 8), P[5].y + 0.02, rowZ(5, c.ch)], pts = [a, top(6, c.i), top(7, c.j), pillarTop(0)].map((p) => new THREE.Vector3(...p));
        for (let s = 0; s < 3; s++) { const t = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(pts[s], pts[s + 1]), 1, rank ? 0.012 : 0.026, 6), tubeMat); t.userData.s = s; tubes.add(t); }
      });
      const c0 = an.chains[0]; if (c0) c0.field.forEach(([a, b], k) => setRect(pathRects[k], k, a, b, k === 5 ? c0.ch : 0, k === 5 ? c0.ch : STAGES[k].rows - 1));
    }
    // ---- stage -> how much of each terrace is shown
    function setStage() {
      if (!data) return;
      let active = -1;
      for (let k = 0; k < 8; k++) {
        const r = data.out || k === 0 ? clamp(stage - k, 0, 1) : 0; if (r > 0 && r < 1) active = k;
        if (r === shown[k]) continue; shown[k] = r;
        const m = meshes[k], hs = heights[k], a = m.instanceMatrix.array, st = STAGES[k];
        if (k < 6) { const edge = r * (st.T + 4); for (let i = 0; i < m.count; i++) a[i * 16 + 5] = Math.max(0.001, hs[i] * smooth((edge - (i % st.T)) / 4)); }
        else { const s = smooth(r); for (let i = 0; i < m.count; i++) a[i * 16 + 5] = Math.max(0.001, hs[i] * s); }
        m.instanceMatrix.needsUpdate = true;
      }
      const ro = data.out ? smooth(clamp(stage - 8, 0, 1)) : 0;
      pillars.forEach((p, i) => { const val = data.out ? (i ? data.out.moving : data.out.person) : 0; p.scale.y = Math.max(0.001, PH * val * ro); const fires = data.out && data.out.person > data.threshold; pillarMat[i].color.set(i === 0 ? (fires ? tok('--person') || '#ff6a45' : '#8a96a5') : '#8a96a5'); pillarMat[i].emissive.set(i === 0 && fires ? tok('--person') || '#ff6a45' : '#000000'); pillarMat[i].emissiveIntensity = 0.55; pillarMat[i].opacity = i === 1 && !fires ? 0.35 : 1; });
      plates.forEach((g, i) => { const yy = PH * (i ? 0.5 : data.threshold); g.userData.pl.position.y = yy; g.userData.pe.position.y = yy; });
      lnFeat.material.opacity = data.out ? smooth(clamp(stage - 6, 0, 1)) : 0; lnDense.material.opacity = data.out ? smooth(clamp(stage - 7, 0, 1)) : 0; lnOut.material.opacity = ro;
      tubes.children.forEach((t) => { t.visible = !!data.out && stage > 6 + t.userData.s; });
      const pv = !!data.out && stage > 6.5; pathRects.forEach((g, k) => { g.visible = pv && !!an?.chains[0]; });
      // sliding window
      kern.visible = active >= 1 && active <= 5;
      if (kern.visible) {
        const st = STAGES[active], src = STAGES[active - 1], t = clamp(Math.round(shown[active] * (st.T + 4) - 2), 0, st.T - 1), span = active % 2 ? 9 : (active === 2 ? 4 : 2), a = active % 2 ? t : t * span, b = a + span - 1;
        const bx = (k, i0, i1, y0, y1) => { const s = STAGES[k], x0 = cellX(k, i0) - s.stride * U / 2, x1 = cellX(k, Math.min(s.T - 1, i1)) + s.stride * U / 2, z0 = P[k].z0 - 0.02, z1 = P[k].z0 + P[k].depth + 0.02; return [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]; };
        const A = bx(active - 1, a, b, P[active - 1].y, P[active - 1].y + HMAX[active - 1] + 0.1), B = bx(active, t, t, P[active].y, P[active].y + HMAX[active] + 0.1), p = kern.geometry.attributes.position; let q = 0;
        const edge = (u, w) => { p.setXYZ(q++, ...u); p.setXYZ(q++, ...w); };
        for (const c of [A, B]) { for (let i = 0; i < 4; i++) { edge(c[i], c[(i + 1) % 4]); edge(c[i + 4], c[(i + 1) % 4 + 4]); } }
        edge(A[6], B[5]); edge(A[7], B[4]); edge(A[2], B[1]); edge(A[3], B[0]);
        p.needsUpdate = true; kern.geometry.setDrawRange(0, q);
      }
      outLab.forEach((o, i) => { o.el.classList.toggle('dim', ro < 0.5); if (!data.out) { o.el.replaceChildren(); return; } const val = i ? data.out.moving : data.out.person, fires = data.out.person > data.threshold;
        o.el.replaceChildren(h('b.num', { class: i === 0 && fires ? 'sense-word-person' : '' }, val.toFixed(2)), h('span', null, i === 0 ? `Person: ${fires ? 'alarm' : 'no alarm'} (line at ${data.threshold.toFixed(2)})` : fires ? `Moving: ${val > 0.5 ? 'yes' : 'no, still'}` : 'Moving: not read without an alarm')); });
    }

    // ---- hover: what does this cell see?
    const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let hoverPending = null, hovered = null;
    dom.addEventListener('pointermove', (e) => { const r = dom.getBoundingClientRect(); hoverPending = [e.clientX - r.left, e.clientY - r.top, e.buttons]; });
    dom.addEventListener('pointerleave', () => { hoverPending = null; clearHover(); });
    dom.addEventListener('keydown', (e) => { const d = { ArrowLeft: [0.08, 0], ArrowRight: [-0.08, 0], ArrowUp: [0, -0.05], ArrowDown: [0, 0.05] }[e.key]; if (!d) return; e.preventDefault(); const off = camera.position.clone().sub(controls.target), sph = new THREE.Spherical().setFromVector3(off); sph.theta += d[0]; sph.phi = clamp(sph.phi + d[1], 0.15, Math.PI * 0.49); camera.position.copy(controls.target).add(off.setFromSpherical(sph)); userAt = performance.now(); });
    function clearHover() { if (!hovered) return; hovered = null; tip.hidden = true; hoverRects.forEach((g) => { g.visible = false; }); onHover(null); }
    function doHover() {
      const [mx, my, buttons] = hoverPending; hoverPending = null; if (buttons || !data) return clearHover();
      ptr.set(mx / W0 * 2 - 1, -(my / H0) * 2 + 1); ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(meshes.filter((m, k) => m && shown[k] > 0), false)[0]; if (!hit) return clearHover();
      const k = hit.object.userData.k, i = hit.instanceId, st = STAGES[k], id = k + ':' + i;
      if (hovered !== id) {
        hovered = id; hoverRects.forEach((g) => { g.visible = false; }); let info;
        if (k < 6) {
          const r = Math.floor(i / st.T), t = i % st.T, f = fieldOf(k, t), sec = [f[0][0] / 20, (Math.min(199, f[0][1]) + 1) / 20], val = k === 0 ? data.x[r][t] : data.out.layers[st.id][r][t];
          f.forEach(([a, b], kk) => setRect(hoverRects[kk], kk, a, b, kk === k ? r : 0, kk === k ? r : STAGES[kk].rows - 1, 0.02));
          info = k === 0 ? [r === 51 ? 'Motion row' : `Subcarrier ${r + 1} of 51`, `${sec[0].toFixed(2)} s`, r === 51 ? `${val.toFixed(2)} % above the receiver’s own noise` : `${val >= 0 ? '+' : ''}${Number(val).toFixed(2)} % from its average`]
            : [`${st.name}, filter ${r + 1} of 24`, `sees ${sec[0].toFixed(1)} to ${sec[1].toFixed(1)} s of the window`, `activation ${val.toFixed(2)}`];
          onHover({ sec });
        } else { const vals = data.out.layers[st.id], val = vals[i]; info = k === 6 ? [`Filter ${i % 24 + 1}: ${i < 24 ? 'average over the window' : 'highest peak'}`, i < 24 ? 'all 10 s' : `peak at step ${data.out.arg[i - 24] + 1} of 12`, `value ${val.toFixed(2)}`] : [`Dense unit ${i + 1} of 32`, `pushes the person answer ${an.cP[i] >= 0 ? 'up' : 'down'} by ${Math.abs(an.cP[i]).toFixed(2)}`, `activation ${val.toFixed(2)}`]; onHover(null); }
        tip.replaceChildren(h('b', null, info[0]), h('span', null, info[1]), h('span.num', null, info[2]));
      }
      tip.hidden = false; tip.style.transform = `translate(${Math.min(W0 - 230, mx + 14)}px, ${Math.max(4, my - 64)}px)`;
    }

    function render(dt) {
      if (dom.hidden || !W0) return;
      const idle = performance.now() - userAt > 8000 && !ctx.kit.reducedMotion();
      if (idle && dt) { const t = performance.now() / 1000, off = camera.position.clone().sub(controls.target), sph = new THREE.Spherical().setFromVector3(off), home = new THREE.Spherical().setFromVector3(HOME.pos.clone().sub(HOME.target)); sph.theta += ((home.theta + Math.sin(t * 0.18) * 0.07) - sph.theta) * Math.min(1, dt * 0.8); camera.position.copy(controls.target).add(off.setFromSpherical(sph)); }
      controls.update(); if (hoverPending) doHover();
      rectMat.opacity = 0.65 + 0.35 * Math.sin(performance.now() / 420);
      if (composer) composer.render(); else renderer.render(scene, camera);
      placeLabels(W0, H0);
    }
    function dispose() { controls.dispose(); renderer.dispose(); scene.traverse((o) => { o.geometry?.dispose?.(); }); dom.remove(); }
    return { dom, resize, render, setData, setStage, resetView, dispose };
  }
}
