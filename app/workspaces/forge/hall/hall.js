// The hall: the 900 simulated people of the training set, re-judged by the real network at every recorded training step.
// Everything that carries meaning is data (data/forge/hero.bin.gz, figures.bin.gz); this file only lights and films it.
import * as THREE from 'three';
import * as G from './glsl.js';

const N = 900, COLS = 15, DX = 1.92, DZ = 2.34, X0 = 3.7, DAIS = 0.36;
export const LOOP = 27, HOLD = 23.6;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), mix = (a, b, t) => a + (b - a) * t, smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

async function gunzip(url) {
  const r = await fetch(url); if (!r.ok) throw new Error('Could not load ' + url.pathname.split('/').pop() + ' (' + r.status + ')');
  const b = new Uint8Array(await r.arrayBuffer());
  if (b[0] !== 0x1f || b[1] !== 0x8b) return b.buffer;                    // a server that already decoded it
  return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
const unpack = (buf) => { const n = new Uint32Array(buf, 0, 1)[0]; return { doc: JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))), base: 4 + n, buf }; };
export async function loadHall(dir) {
  const [a, f] = await Promise.all([gunzip(new URL('hero.bin.gz', dir)), gunzip(new URL('figures.bin.gz', dir))]);
  const H = unpack(a), T = unpack(f), A = {}, kinds = { u1: Uint8Array, i1: Int8Array };
  for (const k in H.doc.index) { const [o, t, s] = H.doc.index[k]; A[k] = new kinds[t](H.buf, H.base + o, s.reduce((x, y) => x * y, 1)); }
  return { ...H.doc, A, figs: T };
}
export function personFacts(D, i, ck) {
  const b = D.A.body, o = i * 8; return { id: i, height: b[o] / 100, shoulder: b[o + 1] / 400, chest: b[o + 2] / 800, yaw: b[o + 3] / 255 * Math.PI * 2, lying: !!b[o + 4], moving: !!b[o + 5], split: b[o + 6], behind: b[o + 7] / 64, score: D.A.score[ck * N + i] / 255, found: D.A.found[ck * N + i] / 6 };
}

function noiseTexture() {                    // tileable fbm in three channels, one texture for the whole hall
  const S = 256, d = new Uint8Array(S * S * 4); let sd = 7; const rnd = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let c = 0; c < 4; c++) {
    const acc = new Float32Array(S * S); let amp = 1, tot = 0;
    for (let cells = c === 2 ? 32 : 8, o = 0; o < 4; o++, cells *= 2, amp *= 0.55) {
      const L = Float32Array.from({ length: cells * cells }, rnd); tot += amp;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const fx = x / S * cells, fy = y / S * cells, ix = fx | 0, iy = fy | 0; let u = fx - ix, v = fy - iy; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v); const g = (a, b) => L[((b + iy) % cells) * cells + ((a + ix) % cells)]; acc[y * S + x] += amp * ((g(0, 0) * (1 - u) + g(1, 0) * u) * (1 - v) + (g(0, 1) * (1 - u) + g(1, 1) * u) * v); }
    }
    for (let i = 0; i < S * S; i++) d[i * 4 + c] = clamp((acc[i] / tot - 0.5) * 1.9 + 0.5) * 255;
  }
  const t = new THREE.DataTexture(d, S, S); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t;
}

export function createHall(canvas, D, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
  renderer.autoClear = false; renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene(), addScene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(34, 1.9, 0.12, 190), mcam = new THREE.PerspectiveCamera();
  mcam.matrixAutoUpdate = false; mcam.matrixWorldAutoUpdate = true; const FLIP = new THREE.Matrix4().makeScale(1, -1, 1);
  const trash = [], keep = (o) => (trash.push(o), o);
  const warm = new THREE.Color(opts.warm || '#ff6a45');

  // ---------- people: where each of the 900 stands
  const rows = THREE.DataUtils, body = D.A.body, ck0 = 0, last = D.steps.length - 1, rnd = (() => { let s = 99; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const P = new Float32Array(N * 4 * 4), heat = new Float32Array(N * 4), pos = [];
  const hero = D.hero;
  for (const sd of [1, 0]) {
    let ids = []; for (let i = 0; i < N; i++) if (body[i * 8 + 5] === sd) ids.push(i);
    const te = ids.filter((i) => body[i * 8 + 6] === 2 && i !== hero), tr = ids.filter((i) => body[i * 8 + 6] !== 2);
    if (sd === 1) te.splice(0, 0, hero);
    const place = (list, startRow) => list.forEach((id, k) => {
      const r = startRow + Math.floor(k / COLS), c = k % COLS; const lie = body[id * 8 + 4];
      const jx = (rnd() - 0.5) * 0.5, jz = (rnd() - 0.5) * (lie ? 0.35 : 0.8), st = id === hero ? 0 : (r % 2) * 0.55;
      const x = X0 + st + c * DX + jx * (id === hero ? 0 : 1), z = -r * DZ - (startRow ? 1.6 : 0) + jz * (id === hero ? 0 : 1);
      const o = id * 4; P[o] = (sd ? 1 : -1) * x; P[o + 1] = startRow ? 0 : DAIS; P[o + 2] = z;
    });
    // the held-out people fill the raised floor at the front; the hero stands nearest the aisle
    place(te, 0); place(tr, Math.ceil(te.length / COLS));
  }
  const daisRows = 5, daisBack = -(daisRows - 1) * DZ - 1.5;
  const HY = body[hero * 8 + 3] / 255 * 6.2832, yawOff = -0.62 - HY + Math.PI;
  for (let i = 0; i < N; i++) {
    const b = i * 8, h = body[b] / 100, sy = h / 1.75, o = i * 4, lie = body[b + 4]; const sh = body[b + 1] / 400, cd = body[b + 2] / 800;
    P[o + 3] = body[b + 3] / 255 * 6.2832 + yawOff;
    const q = (900 + i) * 4; P[q] = mix(sy, sh / 0.425, 0.55); P[q + 1] = sy; P[q + 2] = mix(sy, cd / 0.235, 0.5); P[q + 3] = rnd();
    const w = (1800 + i) * 4; P[w] = lie; P[w + 1] = lie ? 0.3 : 1.26 * sy; P[w + 2] = 0; P[w + 3] = hero;
    const e = (2700 + i) * 4; P[e] = rnd(); P[e + 1] = rnd(); P[e + 2] = rnd(); P[e + 3] = rnd();
    pos.push(new THREE.Vector3(P[o], P[o + 1], P[o + 2]));
  }
  P[(900 + hero) * 4 + 3] = 0.36; P.set([0.30, 0.42, 0.45, 0], (2700 + hero) * 4);
  const tex = (d, w, h, f, t) => { const x = keep(new THREE.DataTexture(d, w, h, f, t)); x.magFilter = x.minFilter = THREE.NearestFilter; x.needsUpdate = true; return x; };
  const tPeople = tex(P, N, 4, THREE.RGBAFormat, THREE.FloatType), tHeat = tex(heat, N, 1, THREE.RGBAFormat, THREE.FloatType);
  const pat = new Uint8Array(52 * N); for (let i = 0; i < pat.length; i++) pat[i] = D.A.ribbon[i] + 128;
  const tPat = tex(pat, 52, N, THREE.RedFormat, THREE.UnsignedByteType); tPat.unpackAlignment = 1; const tNoise = keep(noiseTexture());

  const U = { uTime: { value: 0 }, uKey: { value: 0 }, uWave: { value: -90 }, uNet: { value: 0.3 }, uAmb: { value: 0.012 }, uWarmNet: { value: 0 }, uPool: { value: new THREE.Vector4() }, uRip: { value: new THREE.Vector4() }, uWarmCol: { value: new THREE.Vector3(warm.r, warm.g, warm.b) }, uNoise: { value: tNoise }, uEye: { value: new THREE.Vector3() },
    uPeople: { value: tPeople }, uHeat: { value: tHeat }, uPat: { value: tPat }, uPx: { value: new THREE.Vector2(1, 1) }, uHover: { value: -1 }, uBeat: { value: 0 } };
  const mat = (vs, fs, u = {}, o = {}) => keep(new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: { ...U, ...u }, ...o }));
  const ADD = { transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation, depthWrite: false };
  const add = (m, s = scene) => { m.frustumCulled = false; s.add(m); return m; };

  // ---------- the room
  const box = keep(new THREE.BoxGeometry(1, 1, 1)), roomM = mat(G.ROOM_V, G.ROOM_F);
  const room = []; const b3 = (x, y, z, w, h, d) => room.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d)));
  const HX = 35.5, HH = 34, ZB = -78, ZF = 62;
  b3(-HX - 1, HH / 2, (ZB + ZF) / 2, 2, HH, ZF - ZB); b3(HX + 1, HH / 2, (ZB + ZF) / 2, 2, HH, ZF - ZB); b3(0, HH / 2, ZB - 1, HX * 2 + 4, HH, 2); b3(0, HH + 1.9, (ZB + ZF) / 2, 8.4, 1, ZF - ZB);
  for (let z = ZB + 5; z < ZF; z += 8.7) { for (const s of [-1, 1]) { b3(s * (HX - 0.7), HH / 2, z, 1.6, HH, 1.1); b3(s * (HX / 2 + 2.2), HH - 1.6, z, HX - 4.2, 3.4, 0.8); } }
  for (const s of [-1, 1]) { b3(s * (HX / 2 + 2.2), HH + 0.6, (ZB + ZF) / 2, HX - 4.2, 1, ZF - ZB); b3(s * 4.6, HH - 1.9, (ZB + ZF) / 2, 0.9, 4.4, ZF - ZB); b3(s * (X0 + COLS * DX / 2 - 0.9), DAIS / 2, (1.6 + daisBack) / 2, COLS * DX + 1.4, DAIS, 1.6 - daisBack); }
  const roomMesh = add(new THREE.InstancedMesh(box, roomM, room.length)); room.forEach((m, i) => roomMesh.setMatrixAt(i, m)); keep(roomMesh);
  const reflRT = keep(new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter }));
  const uRes = { value: new THREE.Vector2(1, 1) };
  const floor = add(new THREE.Mesh(keep(new THREE.PlaneGeometry(HX * 2, ZF - ZB)), mat(G.ROOM_V, G.FLOOR_F, { uRefl: { value: reflRT.texture }, uRes })));
  floor.geometry.rotateX(-Math.PI / 2); floor.position.z = (ZB + ZF) / 2; floor.updateMatrixWorld();

  // ---------- figures
  const F = D.figs, lods = {}, variantOf = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const b = i * 8, lie = body[b + 4], mv = body[b + 5], r = P[(900 + i) * 4 + 3]; variantOf[i] = i === hero ? 0 : (lie ? (mv ? 5 : 4) : (mv ? 0 : 2) + (r > 0.5 ? 1 : 0)) * 2 + (P[(2700 + i) * 4] > 0.5 ? 1 : 0); }
  const geo = {};
  function baseGeo(f, l) {
    const L = F.doc.figs[f].lod[l]; if (!L) return null; const key = f + ':' + l; if (geo[key]) return geo[key];
    const g = { L, p: new THREE.BufferAttribute(new Uint16Array(F.buf, F.base + L.p, L.nv * 3), 3, true), ix: new THREE.BufferAttribute(new Uint16Array(F.buf, F.base + L.i, L.nt * 3), 1), ib: new THREE.InterleavedBuffer(new Int8Array(F.buf, F.base + L.a, L.nv * 8), 8) };
    g.aD = new THREE.InterleavedBufferAttribute(g.ib, 4, 0, true); g.aB = new THREE.InterleavedBufferAttribute(g.ib, 4, 4, true); return (geo[key] = g);
  }
  function figMesh(v, l, sc, cap) {
    const f = v >> 1, g = baseGeo(f, l); if (!g) return null; const ig = keep(new THREE.InstancedBufferGeometry());
    ig.setIndex(g.ix); ig.setAttribute('position', g.p); ig.setAttribute('aD', g.aD); ig.setAttribute('aB', g.aB);
    const at = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); at.setUsage(THREE.DynamicDrawUsage); ig.setAttribute('iId', at); ig.instanceCount = 0;
    const m = mat(G.FIG_V, G.FIG_F, { uLo: { value: new THREE.Vector3(...g.L.lo) }, uSpan: { value: new THREE.Vector3(...g.L.hi).sub(new THREE.Vector3(...g.L.lo)) }, uMirror: { value: v & 1 ? -1 : 1 }, uLying: { value: f >= 4 ? 1 : 0 }, uDetail: { value: l < 2 ? 1 : 0 } }, { side: THREE.DoubleSide });
    const o = add(new THREE.Mesh(ig, m), sc); o.userData = { at, ig, n: 0 }; return o;
  }
  const counts = new Array(12).fill(0); for (let i = 0; i < N; i++) counts[variantOf[i]]++;
  const M2 = [], M1 = [], R2 = []; for (let v = 0; v < 12; v++) { M2.push(figMesh(v, 2, scene, counts[v])); M1.push(figMesh(v, 1, scene, counts[v])); R2.push(figMesh(v, 2, scene, counts[v])); }
  const M0 = [figMesh(0, 0, scene, 1)];
  for (let v = 0; v < 12; v++) { const a = R2[v].userData; for (let i = 0; i < N; i++) if (variantOf[i] === v) a.at.array[a.n++] = i; a.ig.instanceCount = a.n; a.at.needsUpdate = true; }
  const fwd = new THREE.Vector3(), tv = new THREE.Vector3();
  function sortLods() {
    cam.getWorldDirection(fwd); for (const A of [M2, M1, M0]) for (const m of A) m.userData.n = 0;
    for (let i = 0; i < N; i++) { tv.copy(pos[i]).sub(cam.position); const d = tv.length(); if (d > 4 && tv.dot(fwd) / d < 0.55) continue; const v = variantOf[i]; const m = (d < 5.5 && i === hero) ? M0[0] : d < 19 ? M1[v] : M2[v]; const u = m.userData; u.at.array[u.n++] = i; }
    for (const A of [M2, M1, M0]) for (const m of A) { const u = m.userData; u.ig.instanceCount = u.n; m.visible = u.n > 0; u.at.needsUpdate = true; }
  }
  const quad = keep(new THREE.PlaneGeometry(1, 1)); const bg = keep(new THREE.InstancedBufferGeometry()); bg.setIndex(quad.index); bg.setAttribute('position', quad.attributes.position); bg.setAttribute('iId', new THREE.InstancedBufferAttribute(Float32Array.from({ length: N }, (_, i) => i), 1)); bg.instanceCount = N;
  const blobs = add(new THREE.Mesh(bg, mat(G.BLOB_V, G.BLOB_F, {}, { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))); blobs.renderOrder = 2;

  // ---------- ribbons
  const SEG = 52, rp = new Float32Array(SEG * 2 * 2), ri = []; for (let i = 0; i < SEG; i++) { rp.set([i / (SEG - 1), -1, i / (SEG - 1), 1], i * 4); if (i) ri.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2, i * 2 - 1, i * 2 + 1); }
  const rg = keep(new THREE.InstancedBufferGeometry()); rg.setAttribute('aU', new THREE.BufferAttribute(rp, 2)); rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEG * 2 * 3), 3)); rg.setIndex(ri); rg.setAttribute('iId', bg.attributes.iId); rg.instanceCount = N;
  const ribU = { uFlow: { value: 0 }, uDur: { value: 6.5 }, uGain: { value: 0 }, uSolo: { value: -1 } }; const ribs = add(new THREE.Mesh(rg, mat(G.RIB_V, G.RIB_F, ribU, { ...ADD, side: THREE.DoubleSide }))); ribs.renderOrder = 5;

  // ---------- the network: true rows, true weights
  const rowsY = [3.0, 7.3, 11.6, 15.9, 18.4, 23.0, 27.4], rowsN = [52, 24, 24, 24, 48, 32, 2], rowsW = [15.5, 14, 13, 12.2, 12.8, 9.4, 4.6], nodeOff = [0]; rowsN.forEach((n) => nodeOff.push(nodeOff[nodeOff.length - 1] + n));
  const nodeXY = []; rowsN.forEach((n, r) => { for (let i = 0; i < n; i++) nodeXY.push([(i / (n - 1) - 0.5) * rowsW[r], rowsY[r]]); });
  const E = [], W = D.A, C = D.steps.length; const link = (ra, rb, w) => { for (let a = 0; a < rowsN[ra]; a++) for (let b = 0; b < rowsN[rb]; b++) E.push([nodeOff[ra] + a, nodeOff[rb] + b, ra, w, a * rowsN[rb] + b]); };
  link(0, 1, 'e0'); link(1, 2, 'e1'); link(2, 3, 'e2'); link(4, 5, 'e3'); link(5, 6, 'e4');
  for (let k = 0; k < 24; k++) { E.push([nodeOff[3] + k, nodeOff[4] + k, 3, null, 0]); E.push([nodeOff[3] + k, nodeOff[4] + 24 + k, 3, null, 0]); }
  const nE = E.length, rowsT = C + 1, wt = new Uint8Array(nE * rowsT), len = { e0: 1248, e1: 576, e2: 576, e3: 1536, e4: 64 };
  for (let c = 0; c < C; c++) E.forEach((e, i) => { wt[c * nE + i] = e[3] ? W[e[3]][c * len[e[3]] + e[4]] + 128 : 128 + 42; });
  const tW = tex(wt, nE, rowsT, THREE.RedFormat, THREE.UnsignedByteType); tW.unpackAlignment = 1; tW.needsUpdate = true;
  const tg = keep(new THREE.InstancedBufferGeometry()), TS = 9, tq = [], ti = []; for (let i = 0; i < TS; i++) { tq.push(i / (TS - 1), -1.6, i / (TS - 1), 1.6); if (i) ti.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2, i * 2 - 1, i * 2 + 1); }
  tg.setAttribute('aQ', new THREE.Float32BufferAttribute(tq, 2)); tg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(TS * 6), 3)); tg.setIndex(ti);
  const ab = new Float32Array(nE * 4), ie = new Float32Array(nE); E.forEach((e, i) => { const a = nodeXY[e[0]], b = nodeXY[e[1]]; ab.set([a[0], a[1], b[0], b[1]], i * 4); ie[i] = i; });
  tg.setAttribute('iAB', new THREE.InstancedBufferAttribute(ab, 4)); tg.setAttribute('iE', new THREE.InstancedBufferAttribute(ie, 1)); tg.instanceCount = nE;
  const thrU = { uW: { value: tW }, uCk: { value: 0 }, uRows: { value: C }, uThr: { value: 0.5 } }; const thr = add(new THREE.Mesh(tg, mat(G.THR_V, G.THR_F, thrU, { ...ADD, side: THREE.DoubleSide }))); thr.renderOrder = 6;
  const nN = nodeXY.length, ng = keep(new THREE.InstancedBufferGeometry()); ng.setIndex(quad.index); ng.setAttribute('position', quad.attributes.position); ng.setAttribute('aQ', new THREE.Float32BufferAttribute([-1, 1, 1, 1, -1, -1, 1, -1], 2));
  const iN = new Float32Array(nN * 4), iV = new THREE.InstancedBufferAttribute(new Float32Array(nN), 1); iV.setUsage(THREE.DynamicDrawUsage); const rr = [0.075, 0.17, 0.17, 0.17, 0.09, 0.12, 0.34];
  nodeXY.forEach((p, i) => { const r = nodeOff.findIndex((o, k) => i >= o && i < nodeOff[k + 1]); iN.set([p[0], p[1], rr[r], r === 6 ? (i === nodeOff[6] + 1 ? 2 : 1) : 0], i * 4); });
  ng.setAttribute('iN', new THREE.InstancedBufferAttribute(iN, 4)); ng.setAttribute('iV', iV); ng.instanceCount = nN; const nodes = add(new THREE.Mesh(ng, mat(G.NODE_V, G.NODE_F, {}, ADD))); nodes.renderOrder = 7;
  const NP = 760, pg = keep(new THREE.InstancedBufferGeometry()); pg.setIndex(quad.index); pg.setAttribute('position', quad.attributes.position); pg.setAttribute('aQ', ng.attributes.aQ);
  const pAB = new THREE.InstancedBufferAttribute(new Float32Array(NP * 4), 4), pC = new THREE.InstancedBufferAttribute(new Float32Array(NP * 4), 4); pAB.setUsage(THREE.DynamicDrawUsage); pC.setUsage(THREE.DynamicDrawUsage); pg.setAttribute('iAB', pAB); pg.setAttribute('iC', pC); pg.instanceCount = NP;
  const parts = add(new THREE.Mesh(pg, mat(G.PART_V, G.PART_F, {}, ADD))); parts.renderOrder = 8;

  // activations of the cast, per checkpoint: row r -> array; a0 inputs, a1..a3 conv, a4 mean+max, a5 dense, a6 answer
  const actName = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'], act = new Float32Array(nN), prod = new Float32Array(nE), cum = new Float32Array(nE);
  let curBeat = -1, curCast = 0, curCk = 0, beatPhase = 0;
  function loadBeat(castI, c) {
    curCast = castI; curCk = c;
    for (let r = 0; r < 7; r++) { const n = rowsN[r], src = D.A[actName[r]], o = (c * 24 + castI) * n; let mx = 1; for (let i = 0; i < n; i++) mx = Math.max(mx, src[o + i]); for (let i = 0; i < n; i++) act[nodeOff[r] + i] = r === 6 ? src[o + i] / 255 : Math.pow(src[o + i] / mx, 0.8); }
    let t = 0; for (let i = 0; i < nE; i++) { prod[i] = act[E[i][0]] * Math.abs(wt[c * nE + i] - 128) / 127; t += prod[i] * prod[i] * (E[i][2] === 0 ? 0.6 : E[i][2] >= 4 ? 1.6 : 1); cum[i] = t; }
    let mx = 0; for (let i = 0; i < nE; i++) mx = Math.max(mx, prod[i]);
    for (let k = 0; k < NP; k++) { const u = (k + Math.random()) / NP * t; let a = 0, b = nE - 1; while (a < b) { const m = (a + b) >> 1; if (cum[m] < u) a = m + 1; else b = m; } const e = E[a]; pAB.array[k * 4] = ab[a * 4]; pAB.array[k * 4 + 1] = ab[a * 4 + 1]; pAB.array[k * 4 + 2] = ab[a * 4 + 2]; pAB.array[k * 4 + 3] = ab[a * 4 + 3]; pC.array[k * 4] = e[2]; pC.array[k * 4 + 1] = Math.pow(prod[a] / (mx || 1), 0.6); pC.array[k * 4 + 2] = Math.random(); pC.array[k * 4 + 3] = 0.4 + Math.random() * 0.9; }
    pAB.needsUpdate = pC.needsUpdate = true;
  }

  // ---------- post
  const HF = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const rt = keep(new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })); rt.depthTexture = keep(new THREE.DepthTexture(8, 8, THREE.UnsignedIntType));
  const chain = Array.from({ length: 6 }, () => keep(new THREE.WebGLRenderTarget(8, 8, HF))), ups = Array.from({ length: 5 }, () => keep(new THREE.WebGLRenderTarget(8, 8, HF)));
  const tri = keep(new THREE.BufferGeometry()); tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)); const fsCam = new THREE.Camera(), fsScene = new THREE.Scene(), fsq = new THREE.Mesh(tri); fsq.frustumCulled = false; fsScene.add(fsq);
  const raw = (fs, u, o = {}) => keep(new THREE.ShaderMaterial({ vertexShader: G.FS_V, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false, ...o }));
  const dU = { tS: { value: null }, uT: { value: new THREE.Vector2() }, uFirst: { value: 0 } }, down = raw(G.DOWN_F, dU), uU = { tS: { value: null }, uT: { value: new THREE.Vector2() } }, up = raw(G.UP_F, uU, { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true });
  const fU = { tS: { value: rt.texture }, tB: { value: chain[0].texture }, tH: { value: ups[0].texture }, tD: { value: rt.depthTexture }, uT: { value: new THREE.Vector2() }, uNF: { value: new THREE.Vector2(cam.near, cam.far) }, uTime: U.uTime, uFade: { value: 0 }, uFocus: { value: 3 }, uDof: { value: 1 }, uBloom: { value: 0.042 } }, fin = raw(G.FIN_F, fU);
  const pass = (m, target) => { fsq.material = m; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); };

  let w = 0, h = 0, pr = Math.min(1.5, window.devicePixelRatio || 1), prMax = Math.min(2, Math.max(1.25, window.devicePixelRatio || 1)), vw = 0, vh = 0;
  function resize(cw, ch, force) {
    if (!cw || !ch) return; if (!force && cw === vw && ch === vh) return; vw = cw; vh = ch; w = Math.round(cw * pr); h = Math.round(ch * pr);
    renderer.setPixelRatio(1); renderer.setSize(w, h, false); rt.setSize(w, h); reflRT.setSize(Math.max(8, w >> 1), Math.max(8, h >> 1)); let a = w, b = h; chain.forEach((c) => { a = Math.max(2, a >> 1); b = Math.max(2, b >> 1); c.setSize(a, b); }); ups[0].setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
    U.uPx.value.set(w, h); uRes.value.set(w, h); fU.uT.value.set(1 / w, 1 / h); cam.aspect = cw / ch; cam.updateProjectionMatrix();
  }

  // ---------- the film: one continuous move
  const hp = pos[hero], K = [
    { t: 0.0, p: [hp.x - 0.72, 1.74, hp.z + 2.15], l: [hp.x - 0.40, 1.60, hp.z - 0.4], f: 34 },
    { t: 3.4, p: [hp.x - 0.84, 1.70, hp.z + 2.7], l: [hp.x - 0.54, 1.66, hp.z - 0.8], f: 34 },
    { t: 5.6, p: [hp.x - 0.80, 1.62, hp.z + 4.0], l: [hp.x - 0.80, 2.45, hp.z - 6], f: 34 },
    { t: 6.9, p: [hp.x - 1.05, 1.95, hp.z + 5.2], l: [hp.x - 1.15, 2.9, hp.z - 7], f: 34.4 },
    { t: 9.4, p: [hp.x - 2.4, 4.4, hp.z + 10.5], l: [hp.x - 2.5, 4.4, hp.z - 18], f: 35 },
    { t: 13.0, p: [0.6, 7.6, 17], l: [0.2, 6.2, -30], f: 36 },
    { t: 18.6, p: [0.0, 10.6, 29.0], l: [0, 6.4, -30], f: 35 },
    { t: 23.0, p: [0.0, 12.2, 34.5], l: [0, 6.6, -30], f: 34 },
    { t: LOOP, p: [0.0, 12.4, 35.4], l: [0, 6.7, -30], f: 34 }];
  const cr = (a, b, c, d, ta, tb, tc, td, t) => { const m1 = (c - a) / (tc - ta) * (tc - tb), m2 = (d - b) / (td - tb) * (tc - tb), u = (t - tb) / (tc - tb), u2 = u * u, u3 = u2 * u; return (2 * u3 - 3 * u2 + 1) * b + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * c + (u3 - u2) * m2; };
  const camP = new THREE.Vector3(), camL = new THREE.Vector3(), up3 = new THREE.Vector3(0, 1, 0); let yawO = 0, pitO = 0;
  function film(t) {
    let i = 0; while (i < K.length - 2 && t > K[i + 1].t) i++; const b = K[i], c = K[i + 1], a = K[Math.max(0, i - 1)], d = K[Math.min(K.length - 1, i + 2)], ta = i === 0 ? b.t - 3 : a.t, td = i + 2 > K.length - 1 ? c.t + 3 : d.t;
    for (let k = 0; k < 3; k++) { camP.setComponent(k, cr(a.p[k], b.p[k], c.p[k], d.p[k], ta, b.t, c.t, td, t)); camL.setComponent(k, cr(a.l[k], b.l[k], c.l[k], d.l[k], ta, b.t, c.t, td, t)); }
    const f = cr(a.f, b.f, c.f, d.f, ta, b.t, c.t, td, t); camP.x += Math.sin(t * 0.45) * 0.02; camP.y += Math.sin(t * 0.62) * 0.012;
    tv.copy(camL).sub(camP); const r = tv.length(); let yaw = Math.atan2(tv.x, -tv.z) + yawO, pit = clamp(Math.asin(tv.y / r) + pitO, -0.75, 0.6); camL.set(camP.x + Math.sin(yaw) * Math.cos(pit) * r, camP.y + Math.sin(pit) * r, camP.z - Math.cos(yaw) * Math.cos(pit) * r);
    cam.position.copy(camP); cam.up.copy(up3); cam.lookAt(camL); if (Math.abs(cam.fov - f) > 0.001) { cam.fov = f; cam.updateProjectionMatrix(); } cam.updateMatrixWorld();
  }
  const ckAt = (t) => t < 7.2 ? 0 : last * Math.pow(clamp((t - 7.2) / (20.4 - 7.2)), 1.12);
  const api = { t: 0, ck: 0, playing: true, hover: -1, D, cam, pos, live: null, stats: null, get pr() { return pr; } };
  let lodN = 0, heroBeat = -1;
  function state(dt) {
    const t = api.t, live = api.live; U.uTime.value += dt; const ck = live ? live.ck : ckAt(t); api.ck = ck; const c = Math.min(last, Math.round(ck));
    thrU.uCk.value = live ? last : ck; U.uKey.value = smooth(6.4, 9.6, t) * mix(0.66, 0.52, smooth(12, 21, t)); U.uWave.value = mix(-70, 66, smooth(6.2, 11.2, t));
    U.uNet.value = mix(0.30, 0.46, smooth(5.0, 11, t)) * (t < 5.4 ? 1 - 0.3 * smooth(4.6, 5.4, t) : 1); U.uAmb.value = mix(0.020, 0.016, smooth(6, 10, t));
    const pool = U.uPool.value; pool.set(hp.x, hp.z, mix(1.55, 2.2, smooth(0, 5, t)), smooth(0.0, 1.5, t) * 1.2 * (1 - smooth(6.4, 8.8, t)));
    const rt_ = t - 1.15; U.uRip.value.set(hp.x - 2.6, 1.25, hp.z + 0.5, rt_ > 0 && rt_ < 5 ? rt_ * 2.6 : 0);
    ribU.uSolo.value = t < 6.6 ? clamp((t - 2.35) / 3.1, 0, 1) : -1; ribU.uGain.value = t < 6.6 ? (t > 2.35 && t < 5.5 ? 1 : 0) : smooth(6.6, 8.2, t) * (1 - smooth(20.8, 23.4, t)); ribU.uFlow.value = Math.max(0, t - 6.6); ribU.uDur.value = 6.5;
    thrU.uThr.value = mix(0.24, 0.29, smooth(4.8, 10, t));
    // the beat: one person's true activations climb the network, then the answer
    let beat, castI, bc; if (t < 6.6) { beat = clamp((t - 5.1) / 1.4); castI = 0; bc = 0; heroBeat = 1; if (curBeat !== -2) { loadBeat(0, 0); curBeat = -2; } if (t < 5.1) beat = -0.2; }
    else { const k = Math.floor((t - 6.6) / 0.9); beat = ((t - 6.6) / 0.9) - k; if (curBeat !== k) { curBeat = k; loadBeat(1 + (k % 23), c); } }
    U.uBeat.value = beat; const A = iV.array, thrV = D.stats[curCk].thr;
    let per = 0; for (let r = 0; r < 7; r++) { const at = r * 0.105, e = beat < 0 ? 0 : smooth(at, at + 0.10, beat) * (r === 6 ? 1 - smooth(0.93, 1.0, beat) * (t < 6.6 ? 0 : 1) : 1 - 0.75 * smooth(at + 0.25, at + 0.5, beat)); for (let i = nodeOff[r]; i < nodeOff[r + 1]; i++) { let v = act[i] * e; if (r === 6) { const yes = act[nodeOff[6] + 1] > thrV; const me = i === nodeOff[6] + 1 ? yes : !yes; v = e * (me ? 0.85 : 0.04); if (i === nodeOff[6] + 1 && me) per = v; } A[i] = v; } }
    iV.needsUpdate = true; U.uWarmNet.value += (per * 0.30 - U.uWarmNet.value) * Math.min(1, dt * 8);
    // the crowd, re-judged
    const fo = D.A.found, k0 = Math.floor(ck), on = t > 6.9 ? 1 : 0; let sum = 0;
    for (let i = 0; i < N; i++) { const f = live ? live.found[i] : fo[Math.min(last, k0) * N + i] / 6; const tgt = on * Math.pow(f, 2.1); const o = i * 4, rate = (tgt > heat[o] ? 2.2 : 3.4) * (0.6 + P[(900 + i) * 4 + 3]); heat[o] += (tgt - heat[o]) * (1 - Math.exp(-dt * rate)); const fl = t < 7 ? (i === hero ? smooth(2.2, 2.6, t) * (1 - smooth(2.6, 4.0, t)) * 0.8 : 0) : 0; heat[o + 1] = fl; }
    tHeat.needsUpdate = true; U.uHover.value = api.hover;
    fU.uDof.value = 1 - smooth(6.4, 8.6, t); { const hd = Math.max(1.2, cam.position.distanceTo(tv.set(hp.x, 1.5, hp.z))), k = smooth(2.7, 4.1, t); fU.uFocus.value = 1 / mix(1 / hd, 1 / 76, k); } ribs.material.depthWrite = t < 6.6; ribs.visible = ribU.uGain.value > 0.001; fU.uFade.value = smooth(0, 0.9, t) * (1 - smooth(LOOP - 0.9, LOOP, t));
  }
  function render() {
    U.uEye.value.copy(cam.position); U.uPx.value.set(w, h);
    if (lodN++ % 6 === 0) sortLods();
    // mirrored view for the wet floor
    mcam.matrix.multiplyMatrices(FLIP, cam.matrixWorld); mcam.matrixWorld.copy(mcam.matrix); mcam.projectionMatrix.copy(cam.projectionMatrix); mcam.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
    U.uEye.value.y = -U.uEye.value.y; floor.visible = blobs.visible = false; for (const A of [M2, M1, M0]) for (const m of A) { m.userData.v = m.visible; m.visible = false; } for (const m of R2) m.visible = true;
    renderer.setRenderTarget(reflRT); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, mcam);
    U.uEye.value.y = -U.uEye.value.y; floor.visible = blobs.visible = true; for (const A of [M2, M1, M0]) for (const m of A) m.visible = m.userData.v; for (const m of R2) m.visible = false;
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
    let src = rt; chain.forEach((c, i) => { dU.tS.value = src.texture; dU.uT.value.set(1 / src.width, 1 / src.height); dU.uFirst.value = i === 0 ? 1 : 0; pass(down, c); src = c; if (i === 0 && fU.uDof.value > 0.01) { dU.tS.value = chain[0].texture; dU.uT.value.set(1 / chain[0].width, 1 / chain[0].height); dU.uFirst.value = 0; pass(down, ups[0]); } });
    for (let i = chain.length - 1; i > 0; i--) { uU.tS.value = chain[i].texture; uU.uT.value.set(1 / chain[i].width, 1 / chain[i].height); pass(up, chain[i - 1]); }
    pass(fin, null);
  }
  let slow = 0, fast = 0, cool = 0;
  api.frame = (dt) => {
    if (api.playing && !api.live) api.t += dt; if (api.t >= LOOP) { api.t = 0; heat.fill(0); curBeat = -1; U.uWarmNet.value = 0; api.onloop?.(); }
    if (!api.dragging) { const k = Math.exp(-dt * 1.4); yawO *= k; pitO *= k; }
    film(api.t); state(dt); render();
    if (++cool > 45) { if (dt > 0.0185) slow++; else if (dt < 0.0125) fast++; if (slow > 14) { slow = fast = 0; cool = 0; if (pr > 0.72) { pr = Math.max(0.7, pr * 0.88); resize(vw, vh, true); } } else if (cool > 160) { slow = fast = 0; cool = 46; } }
  };
  api.seek = (t) => { api.t = t; curBeat = -1; for (let i = 0; i < 90; i++) { film(api.t); state(1 / 30); } render(); };
  api.resize = resize; api.look = (dx, dy) => { yawO = clamp(yawO + dx, -0.9, 0.9); pitO = clamp(pitO + dy, -0.3, 0.3); };
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2();
  api.pick = (x, y) => { v2.set(x * 2 - 1, 1 - y * 2); ray.setFromCamera(v2, cam); const o = ray.ray.origin, d = ray.ray.direction; let best = -1, bd = 1e9; for (let i = 0; i < N; i++) { const p = pos[i], lie = body[i * 8 + 4], hh = lie ? 0.35 : body[i * 8] / 100; const a = d.x * d.x + d.z * d.z, tt = ((p.x - o.x) * d.x + (p.z - o.z) * d.z) / a; if (tt < 0.5 || tt > bd) continue; const x1 = o.x + d.x * tt - p.x, z1 = o.z + d.z * tt - p.z, y1 = o.y + d.y * tt - p.y; if (Math.hypot(x1, z1) < (lie ? 0.75 : 0.34) && y1 > -0.1 && y1 < hh + 0.1) { best = i; bd = tt; } } return best; };
  api.project = (x, y, z, out) => { tv.set(x, y, z).project(cam); out.x = (tv.x * 0.5 + 0.5) * vw; out.y = (0.5 - tv.y * 0.5) * vh; out.ok = tv.z < 1; return out; };
  api.compile = () => { renderer.compile(scene, cam); };
  api.dispose = () => { trash.forEach((o) => o.dispose?.()); renderer.dispose(); };
  api.gpu = renderer; loadBeat(0, 0); return api;
}
