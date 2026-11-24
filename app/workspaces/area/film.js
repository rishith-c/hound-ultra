// The valley film (Demo mode): a flight down the real Bhote Koshi valley at first light, with the illustrative surge
// from the same flood model the Advanced view uses running ahead of the camera. It ends, and holds, on the broken block.
//   Real data       elevation (Mapzen terrain tiles on AWS), imagery (Esri World Imagery), rivers and buildings (OpenStreetMap).
//   Live algorithm  the flood reach (terrain.js), the sun's position, the terrain's shadow.
//   Simulated       the search block, its damage, the dust and the light under the rubble (the exercise is invented).
//   Drawn           tree sprites where the image is green, building heights (assumed), river bed cut 1 m so water shows, mist.
import * as THREE from 'three';
import { BLOCK, toUnit } from './geo.js';
import { createStreamer, farDem } from './film-tiles.js';
import { detailTexture, heightTextures, boxBlur, treeAtlas, extrude, ruin, rng } from './film-assets.js';
import * as G from './film-glsl.js';

const EARTH = 40075016.686, lerp = (a, b, t) => a + (b - a) * t, clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export const FILM = { open: 1.2, surge: 15, base: 1.7, settle: 3.2, flight: 15, pushAt: 9, arrive: 18, still: 18.9, dayStart: 452, dayEnd: 500 };

export function createFilm(host, { dem, model, osm, frame, SITE, BUILDING, OBSTACLES, siteCenter, path, joinAt, sunAt, onInfo = () => {}, onFail = () => {}, reduced = () => false }) {
  const bornAt = performance.now();
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.autoClear = false; renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.info.autoReset = false;
  host.append(renderer.domElement); renderer.domElement.className = 'area-film-canvas'; renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute('aria-label', 'Film flight over the real Bhote Koshi valley. Drag to look around, scroll to move closer.');

  // ------------------------------------------------------------------ frame of reference: metres east and south of the block
  const [u0, v0] = toUnit(siteCenter[0], siteCenter[1]), cosL = Math.cos((siteCenter[1] * Math.PI) / 180), T14 = (EARTH * cosL) / 2 ** 14, size = BLOCK.n * T14;
  const NX = -u0 * size, NZ = -v0 * size, E0 = dem.at(siteCenter[0], siteCenter[1]), n = dem.n, cs = size / n;
  const xz = (ll) => { const [u, v] = toUnit(ll[0], ll[1]); return [NX + u * size, NZ + v * size]; };
  const fz = 12, FN = 6, sx = BLOCK.x0 + u0 * 4, sy = BLOCK.y0 + v0 * 4, fx0 = Math.round(sx / 4 - FN / 2), fy0 = Math.round(sy / 4 - FN / 2);
  const tileBox = (z, x, y, count) => { const s = 2 ** (14 - z); return new THREE.Vector3((x * s - sx) * T14, (y * s - sy) * T14, count * s * T14); };

  // ------------------------------------------------------------------ fields: carved heights, smooth river bed, flow, valley floor
  const N2 = n * n, heights = new Float32Array(N2);
  { const sh = boxBlur(boxBlur(dem.data, n, Math.max(1, Math.round(16 / cs))), n, 1); for (let k = 0; k < N2; k++) heights[k] = sh[k] - E0; } // the 30 m source is stepped when magnified; smooth it
  const { seedOf, sBed, sS, sCell, need } = model;
  const R = Math.max(2, Math.round(26 / cs));
  for (let q = 0; q < sCell.length; q++) {
    const k = sCell[q], cx = k % n, cy = (k / n) | 0, bed = sBed[q] - E0;
    for (let y = Math.max(0, cy - R); y <= Math.min(n - 1, cy + R); y++) for (let x = Math.max(0, cx - R); x <= Math.min(n - 1, cx + R); x++) {
      const d = Math.hypot(x - cx, y - cy) * cs; if (d > 26) continue;
      const cut = bed - 1.1 + Math.max(0, d - 8) ** 2 * 0.022 + Math.max(0, d - 16) * 0.5, i = y * n + x; if (cut < heights[i]) heights[i] = cut;
    }
  }
  { // soften the cut's cell steps without touching the slopes above it
    const soft = boxBlur(boxBlur(heights, n, 1), n, 1), m = new Float32Array(N2); for (const k of sCell) m[k] = 1;
    const w = boxBlur(boxBlur(m, n, 3), n, 3); for (let k = 0; k < N2; k++) if (w[k] > 0.004) { const t = Math.min(1, w[k] * 14); heights[k] += (soft[k] - heights[k]) * t; }
  }
  { // the drawn school stands on a level pad, as a real one on a slope would: the ground under it is cut and filled (drawn, not data)
    const a = xz(frame.ll([BUILDING.rect[0], BUILDING.rect[3]])), b = xz(frame.ll([BUILDING.rect[2], BUILDING.rect[1]])), at = (x, z) => heights[(((z - NZ) / cs) | 0) * n + (((x - NX) / cs) | 0)];
    let s = 0; for (const x of [a[0], (a[0] + b[0]) / 2, b[0]]) for (const z of [a[1], (a[1] + b[1]) / 2, b[1]]) s += at(x, z); const pad = s / 9, i0 = ((a[0] - NX) / cs) | 0, j0 = ((a[1] - NZ) / cs) | 0;
    for (let j = j0 - 8; j < j0 + 14; j++) for (let i = i0 - 8; i < i0 + 14; i++) { const x = NX + (i + 0.5) * cs, z = NZ + (j + 0.5) * cs, d = Math.hypot(Math.max(a[0] - x, 0, x - b[0]), Math.max(a[1] - z, 0, z - b[1])), k = j * n + i; heights[k] += (pad - heights[k]) * (1 - sm(12, 36, d)); }
  }
  const bedRaw = new Float32Array(N2), mask = new Float32Array(N2), flX = new Float32Array(N2), flZ = new Float32Array(N2);
  const sdX = new Float32Array(sCell.length), sdZ = new Float32Array(sCell.length);
  for (let q = 0; q < sCell.length; q++) { let a = q, b = q; for (let g = 0; g < 8; g++) { if (a > 0 && sS[a - 1] < sS[a]) a--; if (b < sCell.length - 1 && sS[b + 1] > sS[b]) b++; } const dx = (sCell[b] % n) - (sCell[a] % n), dz = ((sCell[b] / n) | 0) - ((sCell[a] / n) | 0), l = Math.hypot(dx, dz) || 1; sdX[q] = dx / l; sdZ[q] = dz / l; }
  for (let k = 0; k < N2; k++) { const s = seedOf[k]; if (s < 0 || need[k] > 60) continue; mask[k] = 1; bedRaw[k] = sBed[s] - E0; flX[k] = sdX[s]; flZ[k] = sdZ[s]; }
  const m1 = boxBlur(mask, n, 4), m2 = boxBlur(m1, n, 4), nb = (f) => { const a = boxBlur(boxBlur(f, n, 4), n, 4); for (let k = 0; k < N2; k++) a[k] = m2[k] > 1e-4 ? a[k] / m2[k] : 0; return a; };
  const bed = nb(bedRaw), fX = nb(flX), fZ = nb(flZ);
  const fn = 128, fs = n / fn, floor = new Float32Array(fn * fn);
  for (let j = 0; j < fn; j++) for (let i = 0; i < fn; i++) { let m = 1e9; for (let y = -9; y <= 9; y += 1) for (let x = -9; x <= 9; x += 1) { const gx = clamp(((i + x + 0.5) * fs) | 0, 0, n - 1), gy = clamp(((j + y + 0.5) * fs) | 0, 0, n - 1), v = heights[gy * n + gx]; if (v < m) m = v; } floor[j * fn + i] = m; }
  const floorS = boxBlur(floor, fn, 4), floorTex = new THREE.DataTexture(floorS, fn, fn, THREE.RedFormat, THREE.FloatType); floorTex.minFilter = floorTex.magFilter = THREE.LinearFilter; floorTex.needsUpdate = true;
  const hAt = (x, z) => { const gx = clamp(((x - NX) / size) * n - 0.5, 0, n - 1.001), gy = clamp(((z - NZ) / size) * n - 0.5, 0, n - 1.001), i = gx | 0, j = gy | 0, a = gx - i, b = gy - j, k = j * n + i; return (heights[k] * (1 - a) + heights[k + 1] * a) * (1 - b) + (heights[k + n] * (1 - a) + heights[k + n + 1] * a) * b; };
  const inside = (x, z) => x > NX + 20 && z > NZ + 20 && x < NX + size - 20 && z < NZ + size - 20;
  let farH = null; const farB = tileBox(fz, fx0, fy0, FN), farN = FN * 256;
  const hFar = (x, z) => { if (!farH) return 900; const i = clamp((((x - farB.x) / farB.z) * farN) | 0, 0, farN - 1), j = clamp((((z - farB.y) / farB.z) * farN) | 0, 0, farN - 1); return farH[j * farN + i]; };
  const ground = (x, z) => (inside(x, z) ? hAt(x, z) : hFar(x, z));

  // ------------------------------------------------------------------ shared uniforms
  const det = detailTexture(renderer), near = heightTextures(heights, n, cs);
  const black = new THREE.DataTexture(new Uint8Array(4), 1, 1); black.needsUpdate = true;
  const zeroH = new THREE.DataTexture(new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType); zeroH.needsUpdate = true;
  const U = {
    uH: { value: near.h }, uFH: { value: zeroH }, uShadow: { value: null }, uDet: { value: det }, uFloor: { value: floorTex },
    uNB: { value: new THREE.Vector3(NX, NZ, size) }, uFB: { value: farB }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Vector3() }, uSkyCol: { value: new THREE.Vector3() }, uHzCol: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() },
    uTime: { value: 0 }, uHasFar: { value: 0 }, uFront: { value: -9999 }, uSettle: { value: FILM.settle }, uBase: { value: FILM.base }, uSurgeH: { value: FILM.surge },
    uInvVP: { value: new THREE.Matrix4() }, uRight: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3() }, uFrame: { value: 0 }, uGlow: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  const mat = (v, f, extra = {}, opt = {}) => new THREE.ShaderMaterial({ vertexShader: v, fragmentShader: f, uniforms: { ...U, ...extra }, ...opt });
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(46, 1, 4, 60000); scene.matrixAutoUpdate = false;
  const add = (g, m, order) => { const o = new THREE.Mesh(g, m); o.frustumCulled = false; o.renderOrder = order; scene.add(o); return o; };

  // ------------------------------------------------------------------ imagery
  const stream = createStreamer(renderer, { onFail });
  const z16x = BLOCK.x0 * 4, z16y = BLOCK.y0 * 4, z17n = 12, z18n = 8, z17x = Math.round(sx * 8 - z17n / 2 + 0.6), z17y = Math.round(sy * 8 - z17n / 2 - 1.6), z18x = Math.round(sx * 16 - z18n / 2), z18y = Math.round(sy * 16 - z18n / 2);
  const pathXZ = path.map(xz);
  const nearPath = (x, z) => { let b = 1e9; for (let i = 0; i < pathXZ.length; i += 4) { const d = Math.hypot(pathXZ[i][0] - x, pathXZ[i][1] - z); if (d < b) b = d; } return b; };
  const T16 = T14 / 4, T17 = T14 / 8, T18 = T14 / 16;
  const A = stream.mosaic(14, BLOCK.x0, BLOCK.y0, 4, () => 0);
  const F = stream.mosaic(12, fx0, fy0, 6, (i, j) => 1 + Math.hypot(i - 2.5, j - 2.5) * 0.01);
  const B = stream.mosaic(16, z16x, z16y, 16, (i, j) => 2 + nearPath(NX + (i + 0.5) * T16, NZ + (j + 0.5) * T16) / 4000);
  const C = stream.mosaic(17, z17x, z17y, z17n, (i, j) => 2.6 + Math.hypot(i - z17n / 2, j - z17n / 2) * 0.05);
  const D = stream.mosaic(18, z18x, z18y, z18n, (i, j) => 2.7 + Math.hypot(i - z18n / 2, j - z18n / 2) * 0.06);
  const F2 = stream.mosaic(13, fx0 * 2 + 1, fy0 * 2 + 1, 10, (i, j) => 3.2 + Math.hypot(i - 4.5, j - 4.5) * 0.1, (i, j) => Math.hypot(i - 4.5, j - 4.5) > 1.6);
  void T17; void T18;
  const imgCv = document.createElement('canvas'); imgCv.width = imgCv.height = 1024; const imgCx = imgCv.getContext('2d', { willReadFrequently: true });
  A.onTile = (job) => { imgCx.drawImage(job.bmp, job.i * 256, job.j * 256); if (A.left === 1) setTimeout(plantTrees, 60); };

  // ------------------------------------------------------------------ ground: 16 x 16 pieces, four levels of detail
  const chunkGeo = (seg) => {
    const pos = [], skirt = [], idx = [], w = seg + 1;
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) { pos.push(i / seg, 0, j / seg); skirt.push(0); }
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * w + i; idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1); }
    const edge = []; for (let i = 0; i <= seg; i++) edge.push(i); const rows = [edge, edge.map((i) => seg * w + i), edge.map((i) => i * w), edge.map((i) => i * w + seg)];
    for (const r of rows) { const base = pos.length / 3; for (const v of r) { pos.push(pos[v * 3], 0, pos[v * 3 + 2]); skirt.push(1); } for (let i = 0; i < seg; i++) idx.push(r[i], r[i + 1], base + i, base + i, r[i + 1], base + i + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aSkirt', new THREE.Float32BufferAttribute(skirt, 1)); g.setIndex(idx); return g;
  };
  const LODS = [64, 32, 16, 8].map(chunkGeo), K = 16, cSize = size / K;
  const nearMat = mat(G.NEAR_VERT, G.NEAR_FRAG, { uNrm: { value: near.nrm }, uA: { value: A.tex }, uB: { value: B.tex }, uC: { value: C.tex }, uD: { value: D.tex }, uRC: { value: new THREE.Vector4(...tileBox(17, z17x, z17y, z17n).toArray(), 0) }, uRD: { value: new THREE.Vector4(...tileBox(18, z18x, z18y, z18n).toArray(), 0) }, uWetTop: { value: 0 } }, { side: THREE.DoubleSide });
  const chunks = [];
  for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
    let lo = 1e9, hi = -1e9; const st = n / K; for (let y = j * st; y < (j + 1) * st; y += 2) for (let x = i * st; x < (i + 1) * st; x += 2) { const v = heights[(y | 0) * n + (x | 0)]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const o = add(LODS[3], nearMat, 1); o.position.set(NX + i * cSize, 0, NZ + j * cSize); o.scale.set(cSize, 1, cSize); o.updateMatrix(); o.matrixAutoUpdate = false;
    chunks.push({ o, box: new THREE.Box3(new THREE.Vector3(o.position.x, lo - 70, o.position.z), new THREE.Vector3(o.position.x + cSize, hi + 30, o.position.z + cSize)), trees: null });
  }
  const farChunks = [];
  (async () => {
    let data; try { data = await farDem(fx0, fy0, FN); } catch { return; }
    if (dead) return;
    for (let k = 0; k < data.length; k++) data[k] -= E0;
    farH = data; const t = heightTextures(data, farN, farB.z / farN); U.uFH.value = t.h; U.uHasFar.value = 1; shadowRow = -1;
    // bring the edge of the fine grid onto the coarse one, so the two meet without a step
    const E = Math.round(320 / cs); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const e = Math.min(i, j, n - 1 - i, n - 1 - j); if (e >= E) { if (j >= E && j < n - E) i = n - E - 1; continue; } const fx = ((NX + (i + 0.5) * cs - farB.x) / farB.z) * farN - 0.5, fy = ((NZ + (j + 0.5) * cs - farB.y) / farB.z) * farN - 0.5, a = fx | 0, b = fy | 0, u = fx - a, v = fy - b, o = b * farN + a, hf = (data[o] * (1 - u) + data[o + 1] * u) * (1 - v) + (data[o + farN] * (1 - u) + data[o + farN + 1] * u) * v; heights[j * n + i] += (hf - 4 - heights[j * n + i]) * (1 - sm(0, E, e)); }
    near.h.needsUpdate = true;
    const m = mat(G.FAR_VERT, G.FAR_FRAG, { uFN: { value: t.nrm }, uF: { value: F.tex }, uF2: { value: F2.tex }, uF2B: { value: tileBox(13, fx0 * 2 + 1, fy0 * 2 + 1, 10) } }, { side: THREE.DoubleSide }), FK = 10, fc = farB.z / FK, geo = LODS[0];
    for (let j = 0; j < FK; j++) for (let i = 0; i < FK; i++) { const o = add(geo, m, 2); o.position.set(farB.x + i * fc, 0, farB.y + j * fc); o.scale.set(fc, 1, fc); o.updateMatrix(); o.matrixAutoUpdate = false; farChunks.push({ o, box: new THREE.Box3(new THREE.Vector3(o.position.x, -1500, o.position.z), new THREE.Vector3(o.position.x + fc, 6000, o.position.z + fc)) }); }
    buildPath();
  })();
  const sky = add(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)), mat(G.SKY_VERT, G.SKY_FRAG, {}, { depthWrite: false, depthTest: true, depthFunc: THREE.LessEqualDepth }), 3);
  void sky;

  // ------------------------------------------------------------------ water
  (() => {
    const TOP = FILM.surge + 4, use = new Uint8Array(N2);
    for (const k of model.cells) if (need[k] < TOP) { const x = k % n, y = (k / n) | 0; for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) { const X = x + a, Y = y + b; if (X >= 0 && Y >= 0 && X < n && Y < n) use[Y * n + X] = 1; } }
    const vi = new Int32Array(N2).fill(-1), pos = [], wat = [], flow = [], idx = [];
    const needMin = (k) => { let m = 60; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const q = k + b * n + a; if (q >= 0 && q < N2 && need[q] < m) m = need[q]; } return m; };
    const vert = (k) => { if (vi[k] >= 0) return vi[k]; const x = k % n, y = (k / n) | 0, s = seedOf[k]; vi[k] = pos.length / 3; pos.push(NX + (x + 0.5) * cs, 0, NZ + (y + 0.5) * cs); wat.push(bed[k], s >= 0 ? sS[s] : 9999, needMin(k), 0); flow.push(fX[k], fZ[k]); return vi[k]; };
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const k = y * n + x; if (x < 44 || y < 44 || x > n - 45 || y > n - 45 || !use[k] || !use[k + 1] || !use[k + n] || !use[k + n + 1]) continue; if (mask[k] + mask[k + 1] + mask[k + n] + mask[k + n + 1] < 4 && m2[k] < 0.02) continue; const a = vert(k), b = vert(k + 1), c = vert(k + n), d = vert(k + n + 1); idx.push(a, c, b, b, c, d); }
    // the distance along the river jumps where two reaches meet; smooth it a little over the mesh
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aWat', new THREE.Float32BufferAttribute(wat, 4)); g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2)); g.setIndex(idx);
    add(g, mat(G.WATER_VERT, G.WATER_FRAG, {}, { transparent: true, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }), 6);
  })();
  const fp = Array.from({ length: 8 }, () => new THREE.Vector4());
  const sprayMat = mat(G.SPRAY_VERT, G.SPRAY_FRAG, { uFP: { value: fp }, uScale: { value: 800 }, uSprayOn: { value: 0 } }, { transparent: true, depthWrite: false });
  { const r = rng(3), P = 620, a = new Float32Array(P * 4); for (let i = 0; i < a.length; i++) a[i] = r(); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P * 3), 3)); g.setAttribute('aR', new THREE.BufferAttribute(a, 4)); const o = new THREE.Points(g, sprayMat); o.frustumCulled = false; o.renderOrder = 8; scene.add(o); }

  const dustMat = mat(G.DUST_VERT, G.SPRAY_FRAG, { uScale: sprayMat.uniforms.uScale, uDustOn: { value: 0 } }, { transparent: true, depthWrite: false });
  { const r = rng(9), P = 130, a = new Float32Array(P * 4); for (let i = 0; i < a.length; i++) a[i] = r(); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P * 3), 3)); g.setAttribute('aR', new THREE.BufferAttribute(a, 4)); const o = new THREE.Points(g, dustMat); o.frustumCulled = false; o.renderOrder = 9; scene.add(o); }
  for (const [size, gain, test] of [[0.9, 7, true], [5.5, 0.10, false]]) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)); const o = new THREE.Points(g, mat(G.GLOW_VERT, G.GLOW_FRAG, { uScale: sprayMat.uniforms.uScale, uGlowSize: { value: size }, uGlowGain: { value: gain } }, { transparent: true, depthWrite: false, depthTest: test, blending: THREE.AdditiveBlending })); o.frustumCulled = false; o.renderOrder = 10; scene.add(o); }

  // main-river seeds in order, for the front's position and the figures
  const seeds = []; for (let q = 0; q < sCell.length; q++) seeds.push(q); seeds.sort((a, b) => sS[a] - sS[b]);
  const joinLL = xz(osm.rivers.find((r) => r.main).g[0]);
  // the course the front is seen on: Lende Khola into Bhote Koshi (other arms carry the same model, off to the side)
  const course = seeds.filter((q) => { if (sS[q] >= 0) return true; const x = NX + (sCell[q] % n) * cs, z = NZ + ((sCell[q] / n) | 0) * cs; return x > joinLL[0] - 40 && z < joinLL[1] + 60; });
  const atS = (s) => { let lo = 0, hi = course.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (sS[course[m]] < s) lo = m + 1; else hi = m; } return course[lo]; };
  let siteS = 0; { const k = dem.cell(siteCenter[0], siteCenter[1]); siteS = seedOf[k] >= 0 ? sS[seedOf[k]] : 3200; }

  // ------------------------------------------------------------------ buildings, the block, its boundary
  const bl = osm.buildings.filter((b) => { const [x, z] = xz(b.g[0]); return Math.hypot(x, z) > 78; }).map((b) => { const ring = b.g.map(xz); let base = 1e9, X = 0, Z = 0, hi = -1e9; for (const p of ring) { const y = ground(p[0], p[1]); base = Math.min(base, y); hi = Math.max(hi, y); X += p[0]; Z += p[1]; } let ar = 0; for (let i = 0; i < ring.length - 1; i++) ar += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; ar = Math.abs(ar / 2); const st = ar > 160 ? 3 : ar > 60 ? 2 : 1; return { ring, base: (base + hi) / 2, h: st * 3 + 0.6, id: b.id % 1e6, kind: 0 }; });
  const sPt = (p) => xz(frame.ll(p)), rc = (r) => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
  const block = [{ ring: rc(BUILDING.rect).map(sPt), h: BUILDING.wallHeight * 1.0, id: 11, kind: 1 }, ...OBSTACLES.filter((o) => o.kind === 'building' && o.id !== 'bldg-c').map((o, i) => ({ ring: o.poly.map(sPt), h: o.h, id: 31 + i, kind: 1 }))];
  for (const b of block) { let s = 0, lo = 1e9; for (const p of b.ring) { const y = ground(p[0], p[1]); s += y; lo = Math.min(lo, y); } b.base = b.id === 11 ? s / b.ring.length : lo + 0.5; }   // on the slope, the other two are dug into the hill
  const CAV = [80.6, 56.2], cavP = sPt(CAV); U.uGlow.value.set(cavP[0], block[0].base + 0.75, cavP[1], 0);
  const broken = ruin({ rect: BUILDING.rect, h: BUILDING.wallHeight, base: block[0].base, to: sPt, hit: [79.5, 54], reach: 22, cavity: CAV, cuts: [53, 62, 66, 75].flatMap((x) => [[x, 30, x, 42], [x, 46, x, 58]]).concat([[44, 42, 84, 42], [44, 46, 84, 46]]) });
  const bGeo = extrude([...bl, ...block.slice(1)], broken);
  add(bGeo, mat(G.BLD_VERT, G.BLD_FRAG, {}, { side: THREE.DoubleSide }), 0);
  const castMat = mat(G.CAST_VERT, G.CAST_FRAG, { uCast: { value: 0.5 } }, { transparent: true, depthWrite: false, side: THREE.DoubleSide, stencilWrite: true, stencilFunc: THREE.EqualStencilFunc, stencilRef: 0, stencilZPass: THREE.IncrementStencilOp });
  add(bGeo, castMat, 5);
  const lineMat = mat(G.LINE_VERT, G.LINE_FRAG, { uLine: { value: 0 } }, { transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  { const pos = [], dd = [], idx = []; let run = 0; const c = rc([0, 0, SITE.w, SITE.h]).map(sPt); for (let e = 0; e < 4; e++) { const p = c[e], q = c[(e + 1) % 4], L = Math.hypot(q[0] - p[0], q[1] - p[1]), dx = (q[0] - p[0]) / L, dz = (q[1] - p[1]) / L, st = Math.ceil(L / 3); for (let i = 0; i <= st; i++) { const d = (i / st) * L, x = p[0] + dx * d, z = p[1] + dz * d, y = ground(x, z) + 1.3, b = pos.length / 3; pos.push(x - dz * 0.32, y, z + dx * 0.32, x + dz * 0.32, y, z - dx * 0.32); dd.push(run + d, run + d); if (i < st) idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); } run += L; } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aD', new THREE.Float32BufferAttribute(dd, 1)); g.setIndex(idx); add(g, lineMat, 7); }

  // ------------------------------------------------------------------ trees: a sprite wherever the image is green and the ground allows it
  let treeMat = null, treeCount = 0;
  function plantTrees() {
    if (dead) return;
    const px = imgCx.getImageData(0, 0, 1024, 1024).data, r = rng(23), f = n / 1024, at = treeAtlas(renderer), lin = (v) => (v / 255) ** 2.2;
    treeMat = mat(G.TREE_VERT, G.TREE_FRAG, { uTc: { value: at.col }, uTn: { value: at.nor } }, { alphaToCoverage: true, side: THREE.DoubleSide });
    const near2 = new Float32Array(64 * 64); for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) near2[j * 64 + i] = nearPath(NX + ((i + 0.5) / 64) * size, NZ + ((j + 0.5) / 64) * size);
    const quad = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], st = 1024 / K, keep = new Set(); for (const b of bl) for (const p of b.ring) { const i = ((p[0] - NX) / size) * 1024 | 0, j = ((p[1] - NZ) / size) * 1024 | 0; for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) keep.add((j + y) * 1024 + i + x); }
    for (let cj = 0; cj < K; cj++) for (let ci = 0; ci < K; ci++) {
      const pos = [], col = [];
      for (let j = cj * st; j < (cj + 1) * st; j++) for (let i = ci * st; i < (ci + 1) * st; i++) {
        const path2 = near2[(j >> 4) * 64 + (i >> 4)]; if (path2 > 2300) continue;
        const p = (j * 1024 + i) * 4, R8 = px[p], G8 = px[p + 1], B8 = px[p + 2], L = (R8 + G8 + B8) / 3; if (!px[p + 3] || L > 128 || G8 < R8 * 0.99 || G8 < B8 * 1.03) continue;
        const dark = clamp((118 - L) / 70, 0, 1), k = ((j * f) | 0) * n + ((i * f) | 0); if (keep.has(j * 1024 + i)) continue;
        const prob = (0.03 + 0.95 * dark * dark) * (path2 < 900 ? 1 : 0.7); if (r() > prob) continue;
        const x = NX + ((i + r()) / 1024) * size, z = NZ + ((j + r()) / 1024) * size, y = hAt(x, z), sl = Math.hypot(hAt(x + 8, z) - hAt(x - 8, z), hAt(x, z + 8) - hAt(x, z - 8)) / 16; if (sl > 1.25 || y > 1950) continue;
        if (need[k] < FILM.base + 2.5 || (Math.abs(x) < 70 && Math.abs(z) < 56)) continue;
        const kind = y > 700 ? 1 : r() < 0.3 + clamp(y / 1400, 0, 0.5) ? 1 : r() < 0.6 ? 0 : 2, hgt = (kind === 1 ? 9 + r() * 10 : 5 + r() * 7.5) * (0.65 + 0.5 * dark), v = 0.85 + r() * 0.5, w = r() * 0.25;
        pos.push(x, y - 0.4, z, hgt * 0.5 * 1.6); const g2 = (lin(R8) + lin(G8) * 2 + lin(B8)) / 4; col.push((lin(R8) * 0.6 + g2 * 0.4) * v * (1.0 + w), (lin(G8) * 0.6 + g2 * 0.4) * v * 1.12, (lin(B8) * 0.6 + g2 * 0.4) * v * 0.72, kind);
      }
      if (!pos.length) continue;
      const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(quad, 3)); g.setIndex([0, 1, 2, 0, 2, 3]); g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(pos), 4)); g.setAttribute('iCol', new THREE.InstancedBufferAttribute(new Float32Array(col), 4)); g.instanceCount = pos.length / 4; treeCount += g.instanceCount;
      const o = add(g, treeMat, 0); o.visible = false; chunks[cj * K + ci].trees = o;
    }
  }

  // ------------------------------------------------------------------ targets and passes
  const quadScene = new THREE.Scene(), quadCam = new THREE.Camera(), quad = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)), null); quad.frustumCulled = false; quadScene.add(quad);
  const pass = (m, target) => { quad.material = m; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); };
  const SR = 1024, shadowRT = new THREE.WebGLRenderTarget(SR, SR, { format: THREE.RedFormat, type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: false }); U.uShadow.value = shadowRT.texture;
  const pm = (f, extra) => mat(G.QUAD_VERT, f, extra, { depthTest: false, depthWrite: false });
  const shadowMat = new THREE.ShaderMaterial({ vertexShader: G.QUAD_VERT, fragmentShader: G.SHADOW_FRAG, uniforms: { ...U, uShadow: { value: black } }, depthTest: false, depthWrite: false });
  let shadowRow = -1;
  function shadows() {
    const strips = 16, full = shadowRow < 0; shadowRT.scissorTest = !full;
    if (!full) shadowRT.scissor.set(0, shadowRow * (SR / strips), SR, SR / strips);
    pass(shadowMat, shadowRT); shadowRow = full ? 0 : (shadowRow + 1) % strips;
  }
  let W = 2, H = 2, ratio = 1, main = null, air = null, b1 = null, b2 = null;
  const airMat = pm(G.AIR_FRAG, { uDepth: { value: null }, uMist: { value: 1 } }), brightMat = new THREE.ShaderMaterial({ vertexShader: G.QUAD_VERT, fragmentShader: G.BRIGHT_FRAG, uniforms: { uTex: { value: null }, uPx: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false });
  const blurMat = new THREE.ShaderMaterial({ vertexShader: G.QUAD_VERT, fragmentShader: G.BLUR_FRAG, uniforms: { uTex: { value: null }, uDir: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false });
  const finalMat = pm(G.FINAL_FRAG, { uScene: { value: null }, uDepth: { value: null }, uAir: { value: null }, uBloom: { value: null }, uAirPx: { value: new THREE.Vector2() }, uExposure: { value: 1 }, uFade: { value: 0 } });
  let quality = Math.min(1.25, window.devicePixelRatio || 1);
  function resize() {
    const r = host.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return;
    ratio = quality; W = Math.round(r.width * ratio); H = Math.round(r.height * ratio);
    renderer.setPixelRatio(1); renderer.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix();
    for (const t of [main, air, b1, b2]) t?.dispose(); main?.depthTexture?.dispose();
    main = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true, generateMipmaps: false }); main.depthTexture = new THREE.DepthTexture(W, H, THREE.UnsignedInt248Type); main.depthTexture.format = THREE.DepthStencilFormat;
    const o = { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false }, aw = Math.ceil(W / 2), ah = Math.ceil(H / 2);
    air = new THREE.WebGLRenderTarget(aw, ah, o); b1 = new THREE.WebGLRenderTarget(Math.ceil(W / 4), Math.ceil(H / 4), o); b2 = new THREE.WebGLRenderTarget(b1.width, b1.height, o);
    airMat.uniforms.uDepth.value = finalMat.uniforms.uDepth.value = main.depthTexture; finalMat.uniforms.uScene.value = main.texture; finalMat.uniforms.uAir.value = air.texture; finalMat.uniforms.uBloom.value = b1.texture; finalMat.uniforms.uAirPx.value.set(1 / aw, 1 / ah);
    brightMat.uniforms.uTex.value = main.texture; brightMat.uniforms.uPx.value.set(1 / W, 1 / H); sprayMat.uniforms.uScale.value = H / (2 * Math.tan((cam.fov * Math.PI) / 360));
    if (!running) frameOnce();
  }

  // ------------------------------------------------------------------ the camera's course
  const PN = 320; let pX = new Float32Array(PN), pY = new Float32Array(PN), pZ = new Float32Array(PN), tX = new Float32Array(PN), tY = new Float32Array(PN), tZ = new Float32Array(PN), chain = new Float32Array(PN);
  function buildPath() {
    const cum = [0]; for (let i = 1; i < pathXZ.length; i++) cum.push(cum[i - 1] + Math.hypot(pathXZ[i][0] - pathXZ[i - 1][0], pathXZ[i][1] - pathXZ[i - 1][1]));
    const total = cum[cum.length - 1], d0 = Math.max(0, joinAt - 2100), d1 = total - 520;
    const at = (d, out) => { d = clamp(d, 0, total); let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); out[0] = lerp(pathXZ[i - 1][0], pathXZ[i][0], f); out[1] = lerp(pathXZ[i - 1][1], pathXZ[i][1], f); };
    const q = [0, 0], a = [0, 0], raw = new Float32Array(PN), riv = new Float32Array(PN);
    const low = (x, z) => { let m = 1e9; for (let y = -60; y <= 60; y += 30) for (let w = -60; w <= 60; w += 30) m = Math.min(m, ground(x + w, z + y)); return m; };
    for (let i = 0; i < PN; i++) {
      const u = i / (PN - 1), d = lerp(d0, d1, u); const ah = lerp(3400, 560, sm(0.0, 0.40, u)); at(d, q); at(d + ah, a); chain[i] = d - joinAt;
      const alt = lerp(lerp(1380, 250, sm(0.02, 0.44, u)), 230, sm(0.80, 1, u));
      riv[i] = low(q[0], q[1]); pX[i] = q[0]; pZ[i] = q[1]; tX[i] = a[0]; tZ[i] = a[1]; tY[i] = low(a[0], a[1]) + lerp(420, 18, sm(0.0, 0.40, u));
      let top = -1e9; for (let y = -150; y <= 150; y += 30) for (let w = -150; w <= 150; w += 30) if (w * w + y * y < 150 * 150) top = Math.max(top, ground(q[0] + w, q[1] + y) + 42 - Math.hypot(w, y) * 0.62);
      raw[i] = Math.max(riv[i] + alt, top);
    }
    const blur = (src, w) => { const o = new Float32Array(PN); for (let i = 0; i < PN; i++) { let s = 0, c = 0; for (let k = -w; k <= w; k++) { const j = clamp(i + k, 0, PN - 1), g = 1 - Math.abs(k) / (w + 1); s += src[j] * g; c += g; } o[i] = s / c; } return o; };
    pY = blur(raw, 22); pX = blur(pX, 12); pZ = blur(pZ, 12); tX = blur(tX, 16); tY = blur(tY, 22); tZ = blur(tZ, 16);
    for (let i = 0; i < PN; i++) pY[i] = Math.max(pY[i], ground(pX[i], pZ[i]) + 120);
  }
  const samp = (arr, f) => { const i = clamp(f | 0, 0, PN - 2), t = f - i, a = arr[Math.max(0, i - 1)], b = arr[i], c = arr[i + 1], d = arr[Math.min(PN - 1, i + 2)]; return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t); };

  const P = new THREE.Vector3(), L = new THREE.Vector3(), O = new THREE.Vector3(), OT = new THREE.Vector3(16, 5, 2), UPV = new THREE.Vector3(), dir = new THREE.Vector3(), off = new THREE.Vector3(), frustum = new THREE.Frustum(), vp = new THREE.Matrix4(), tmp = new THREE.Vector3();
  const ctl = { yaw: 0, pitch: 0, zoom: 1, vy: 0, vp: 0, tYaw: 0, tPitch: 0, tZoom: 1, last: -1e9, roll: 0, cRoll: 0 };
  let t = FILM.open, running = false, raf = 0, last = 0, dead = false, startedAt = 0, frameNo = 0, lastInfo = 0, slow = 0, fast = 0, minutes = FILM.dayStart, wetHa = 0, lastSun = -1;
  const END = { az: 2.78, r: 56, y: 21 };
  let rate = 1, want = 1, dip = 1, dipTo = -1, firstAt = 0;
  const progress = (tt) => { const u = clamp(tt / FILM.flight, 0, 1); return u < 1 ? 0.5 * u + 0.5 * (u * u * (3 - 2 * u)) : 1; };
  function pose(tt) {
    const f = progress(tt) * (PN - 1.001);
    P.set(samp(pX, f), samp(pY, f), samp(pZ, f)); L.set(samp(tX, f), samp(tY, f), samp(tZ, f));
    const sway = Math.sin(tt * 0.33) * 26; P.x += sway * 0.8; P.z += sway * 0.25;
    // the push-in: from the river course round to the uphill side of the block, then a hold with a slow sway
    const k = smoother(clamp((tt - FILM.pushAt) / (FILM.arrive - 2 - FILM.pushAt), 0, 1)), e = smoother(clamp((tt - FILM.pushAt) / (FILM.arrive - FILM.pushAt), 0, 1)), hold = Math.max(0, tt - FILM.arrive);
    const a = END.az - 0.5 * (1 - e) + 0.045 * Math.sin(hold * 0.11), r = lerp(330, END.r, e), hy = lerp(150, END.y, e);
    O.set(OT.x + Math.sin(a) * r, 0, OT.z + Math.cos(a) * r); O.y = Math.max(hy, ground(O.x, O.z) + lerp(60, 7, e));
    P.lerp(O, k); L.lerp(OT, k);
    // the hand on the camera
    const idle = performance.now() - ctl.last > 5000; if (idle) { ctl.tYaw *= 0.985; ctl.tPitch *= 0.985; ctl.tZoom += (1 - ctl.tZoom) * 0.015; }
    ctl.yaw += (ctl.tYaw - ctl.yaw) * 0.12; ctl.pitch += (ctl.tPitch - ctl.pitch) * 0.12; ctl.zoom += (ctl.tZoom - ctl.zoom) * 0.1;
    if (Math.abs(ctl.yaw) + Math.abs(ctl.pitch) + Math.abs(ctl.zoom - 1) > 1e-4) {
      off.subVectors(P, L); const len = off.length(), flat = Math.hypot(off.x, off.z), az = Math.atan2(off.x, off.z) + ctl.yaw, el = clamp(Math.atan2(off.y, flat) + ctl.pitch, 0.06, 1.35), l2 = len * ctl.zoom;
      if (k > 0.5) P.set(L.x + Math.sin(az) * Math.cos(el) * l2, L.y + Math.sin(el) * l2, L.z + Math.cos(az) * Math.cos(el) * l2);
      else { const e2 = Math.atan2(off.y, flat) + ctl.pitch; L.set(P.x - Math.sin(az) * Math.cos(e2) * len, P.y - Math.sin(e2) * len, P.z - Math.cos(az) * Math.cos(e2) * len); }
    }
    const g = ground(P.x, P.z) + lerp(22, 8, k); if (P.y < g) P.y = g;
    // a gentle bank into the bends
    const f2 = Math.min(PN - 1.001, f + 6), h1 = Math.atan2(samp(tX, f) - samp(pX, f), samp(tZ, f) - samp(pZ, f)), h2 = Math.atan2(samp(tX, f2) - samp(pX, f2), samp(tZ, f2) - samp(pZ, f2));
    let bend = h2 - h1; if (bend > Math.PI) bend -= 2 * Math.PI; if (bend < -Math.PI) bend += 2 * Math.PI;
    ctl.roll = clamp(bend * 1.3, -0.16, 0.16) * (1 - k); ctl.cRoll += (ctl.roll - ctl.cRoll) * 0.03;
    dir.subVectors(L, P).normalize(); UPV.set(0, 1, 0).applyAxisAngle(dir, -ctl.cRoll); cam.position.copy(P); cam.up.copy(UPV); cam.lookAt(L); cam.updateMatrixWorld();
    return k;
  }
  function light(m) {
    if (Math.abs(m - lastSun) < 0.02) return; lastSun = m;
    const s = sunAt(m), az = (s.az * Math.PI) / 180, al = (Math.max(1.5, s.alt) * Math.PI) / 180; U.uSun.value.set(Math.sin(az) * Math.cos(al), Math.sin(al), -Math.cos(az) * Math.cos(al));
    const d = sm(4, 34, s.alt), lo = 1 - sm(3, 24, s.alt); U.uSunCol.value.set(lerp(3.5, 4.0, d), lerp(2.05, 3.55, d), lerp(1.02, 2.9, d));
    U.uSkyCol.value.set(lerp(0.17, 0.30, d), lerp(0.235, 0.42, d), lerp(0.38, 0.66, d)); U.uHzCol.value.set(lerp(0.62, 0.66, d), lerp(0.50, 0.70, d), lerp(0.46, 0.78, d)); void lo;
  }
  function drive(tt) {
    U.uTime.value += 0; const k = pose(tt);
    minutes = lerp(FILM.dayStart, FILM.dayEnd, smoother(clamp(tt / FILM.arrive, 0, 1))); light(minutes);
    // the front runs ahead of the camera, then on down the valley past the block
    const f = progress(tt) * (PN - 1.001), camS = samp(chain, f), lead = lerp(lerp(900, 620, sm(2, 6, tt)), 1250, sm(6, 10, tt)), T1 = FILM.flight - 5;
    // after T1 the front leaves the camera and passes the block a little before the camera arrives
    const F1 = samp(chain, progress(T1) * (PN - 1.001)) + 1250, v = Math.max(118, (siteS - F1) / (FILM.arrive - 2.5 - T1)), front = tt < T1 ? camS + lead : F1 + (tt - T1) * v; U.uFront.value = front - 2 + sm(0, 5, tt) * 2;
    U.uSurgeH.value = lerp(FILM.surge, FILM.settle + 1, sm(FILM.arrive + 6, 60, tt)); U.uSettle.value = FILM.settle;
    const c = atS(front), alive = front > -800 && front < model.sMax - 40 ? 1 : 0; sprayMat.uniforms.uSprayOn.value += (alive - sprayMat.uniforms.uSprayOn.value) * 0.1;
    for (let i = 0; i < 8; i++) { const q = atS(front - 8 - i * 11), k2 = sCell[q]; fp[i].set(NX + ((k2 % n) + 0.5) * cs, NZ + (((k2 / n) | 0) + 0.5) * cs, bed[k2] + Math.min(11, 3 + i * 3), Math.atan2(sdZ[q], sdX[q])); }
    void c;
    lineMat.uniforms.uLine.value = sm(10.5, 14, tt) * (1 - sm(13.6, 15.2, tt));
    dustMat.uniforms.uDustOn.value = sm(12, 16, tt);
    { const p = (c) => Math.exp(-(((tt - c) / 0.42) ** 2)); U.uGlow.value.w = 0.14 * sm(16.5, 18.2, tt) + 0.6 * (p(18.9) + p(20.7)); } // two pulses, then it stays faint
    const fin = reduced() ? 1 : dip; finalMat.uniforms.uFade.value = fin;
    finalMat.uniforms.uExposure.value = lerp(1.15, 1.5, sm(10, 17, tt)); airMat.uniforms.uMist.value = lerp(lerp(0.95, 0.17, sm(2.5, 7, tt)), 0.07, sm(9, 16, tt)); castMat.uniforms.uCast.value = 0.55 * sm(0.08, 0.3, U.uSun.value.y);
    return { k, front };
  }
  function cull() {
    vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(vp); U.uInvVP.value.copy(vp).invert(); U.uCam.value.copy(cam.position);
    const e = cam.matrixWorld.elements; U.uRight.value.set(e[0], e[1], e[2]); U.uUp.value.set(e[4], e[5], e[6]); U.uFwd.value.set(-e[8], -e[9], -e[10]);
    for (let i = 0; i < chunks.length; i++) { const c = chunks[i], v = frustum.intersectsBox(c.box); c.o.visible = v; let d = 0; if (v || c.trees) d = c.box.distanceToPoint(cam.position); if (v) c.o.geometry = LODS[d < 900 ? 0 : d < 2200 ? 1 : d < 4200 ? 2 : 3]; if (c.trees) c.trees.visible = v && d < 2300; }
    for (let i = 0; i < farChunks.length; i++) { const c = farChunks[i]; c.o.visible = frustum.intersectsBox(c.box); }
  }
  function draw() {
    cull(); shadows();
    renderer.setRenderTarget(main); renderer.clear(true, true, true); renderer.render(scene, cam);
    pass(airMat, air); pass(brightMat, b1);
    blurMat.uniforms.uTex.value = b1.texture; blurMat.uniforms.uDir.value.set(1.6 / b1.width, 0); pass(blurMat, b2); blurMat.uniforms.uTex.value = b2.texture; blurMat.uniforms.uDir.value.set(0, 1.6 / b1.height); pass(blurMat, b1);
    blurMat.uniforms.uTex.value = b1.texture; blurMat.uniforms.uDir.value.set(3.4 / b1.width, 0); pass(blurMat, b2); blurMat.uniforms.uTex.value = b2.texture; blurMat.uniforms.uDir.value.set(0, 3.4 / b1.height); pass(blurMat, b1);
    pass(finalMat, null);
  }
  const baseCount = model.countBelow(FILM.base);
  const info = { t: 0, k: 0, front: 0, toBlock: 0, minutes: 0, ha: 0, siteX: 0, siteY: 0, siteOn: false, sunOnBlock: false, trees: 0, fade: 0 };
  function report(now, r) {
    tmp.set(0, 16, 0).project(cam); info.siteX = (tmp.x * 0.5 + 0.5) * (W / ratio); info.siteY = (0.5 - tmp.y * 0.5) * (H / ratio); info.siteOn = tmp.z < 1 && r.k > 0.55;
    info.t = t; info.k = r.k; info.front = r.front; info.toBlock = siteS - r.front; info.minutes = minutes; info.trees = treeCount; info.fade = finalMat.uniforms.uFade.value;
    if (now - lastInfo > 240) { lastInfo = now; let c = 0; const { cells, rel, s } = model; void rel; const H1 = U.uSurgeH.value, S1 = FILM.settle, B0 = FILM.base, fr = r.front; for (let i = 0; i < cells.length; i++) { const k = cells[i], nd = need[k]; if (nd > FILM.surge) break; const x = fr - s[k]; const h = x < -14 ? B0 : B0 + sm(-14, 70, x) * (S1 - B0 + (H1 - S1) * Math.exp(-Math.max(x, 0) / 1500)); if (nd < h) c++; } wetHa = (Math.max(0, c - baseCount) * model.cellArea) / 1e4; info.ha = wetHa; }
    onInfo(info);
  }
  function frameOnce() { if (dead || !main) return; if (reduced()) t = FILM.still; const r = drive(t); draw(); firstAt ||= performance.now(); report(performance.now(), r); }
  function tick(now) {
    if (reduced()) { running = false; api.start(); return; }
    raf = requestAnimationFrame(tick);
    const dt = clamp((now - last) / 1000, 0, 0.05); last = now; frameNo++; U.uFrame.value = frameNo % 64;
    stream.upload(now, 3);
    // under the opening title the film only drifts; "Fly to the block" runs it fast to the end, or plays the push-in again
    const calm = document.documentElement.dataset.intro ? (t < 3.5 ? 0.3 : 0.02) : want; rate += (calm - rate) * Math.min(1, dt * 3); if (t > FILM.arrive - 2.5) want = 1;
    if (dipTo >= 0) { dip -= dt * 3.2; if (dip <= 0) { dip = 0; t = dipTo; dipTo = -1; } } else if (dip < 1) dip = Math.min(1, dip + dt * 2.4);
    t += dt * rate; U.uTime.value += dt;
    const r = drive(t); draw(); report(now, r); firstAt ||= performance.now();
    // adaptive sharpness: drop when frames run long, come back when there is room
    if (frameNo > 90) { if (dt > 0.0205) { slow++; fast = 0; } else { fast++; slow = Math.max(0, slow - 0.35); } if (slow > 26 && quality > 0.72) { quality *= 0.86; slow = 0; resize(); } }
  }
  // ------------------------------------------------------------------ hand control
  const cv = renderer.domElement; let drag = null;
  cv.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; cv.setPointerCapture?.(e.pointerId); ctl.last = performance.now() + 1e7; });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; ctl.tYaw -= (e.clientX - drag[0]) * 0.0042; ctl.tPitch = clamp(ctl.tPitch + (e.clientY - drag[1]) * 0.003, -0.6, 0.9); drag = [e.clientX, e.clientY]; });
  const up = () => { drag = null; ctl.last = performance.now(); }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); ctl.tZoom = clamp(ctl.tZoom * Math.exp(e.deltaY * 0.001), 0.45, 1.8); ctl.last = performance.now(); }, { passive: false });
  cv.addEventListener('keydown', (e) => { const s = { ArrowLeft: [0.12, 0], ArrowRight: [-0.12, 0], ArrowUp: [0, 0.08], ArrowDown: [0, -0.08] }[e.key]; if (s) { e.preventDefault(); ctl.tYaw += s[0]; ctl.tPitch = clamp(ctl.tPitch + s[1], -0.6, 0.9); ctl.last = performance.now(); } else if (e.key === '+' || e.key === '-') { ctl.tZoom = clamp(ctl.tZoom * (e.key === '+' ? 0.88 : 1.14), 0.45, 1.8); ctl.last = performance.now(); } });

  buildPath(); resize(); stream.start();
  const ro = new ResizeObserver(() => resize()); ro.observe(host);
  let still = 0;
  const api = {
    canvas: cv, renderer, END, OT, seek(v) { t = v; }, get time() { return t; }, get firstAt() { return firstAt; }, bornAt, get quality() { return quality; }, stream, info,
    start() { if (running || dead) return; resize();
      clearInterval(still); if (reduced()) { still = setInterval(() => { stream.upload(performance.now(), 16); shadowRow = -1; frameOnce(); if (stream.idle) clearInterval(still); }, 350); return; }
      running = true; last = performance.now(); raf = requestAnimationFrame(tick); },
    stop() { running = false; cancelAnimationFrame(raf); clearInterval(still); },
    restart() { want = 1; dipTo = FILM.open; ctl.tYaw = ctl.tPitch = 0; ctl.tZoom = 1; },
    fly() { ctl.tYaw = ctl.tPitch = 0; ctl.tZoom = 1; if (t > FILM.arrive - 2.5) { want = 1; dipTo = FILM.pushAt + 0.6; } else want = t < FILM.pushAt ? 3 : 1; },
    resize, destroy() { dead = true; this.stop(); ro.disconnect(); stream.destroy(); renderer.dispose(); renderer.forceContextLoss(); cv.remove(); },
  };
  return api;
}
