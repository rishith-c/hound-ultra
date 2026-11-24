// Swarm scene: the 3-D view of one or two sandbox runs at night. One WebGL canvas; in race mode the two runs are drawn
// side by side with the same camera. Everything that moves here comes from the engine state. The building outlines and
// the dark city around the site are scenery: the robots never read them.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { W, H, RES, T, K, PARAMS } from './engine.js';
import * as MT from './materials.js';
import { parts, siteShells, citySurround } from './models.js';

const { hash } = MT;
const SX = W * RES, SY = H * RES, MAXR = 12, THREADS = 192, SEGS = 9000;
const v3 = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
const clamp = THREE.MathUtils.clamp, TAU = Math.PI * 2;

function tokenColors(kit) {
  const c = (n) => new THREE.Color(kit.cssVar(n) || '#888');
  return { accent: c('--accent'), person: c('--person'), warn: c('--warn'), ok: c('--ok'), danger: c('--danger'), sim: c('--sim'), text: c('--text'), text3: c('--text-3'), bg0: c('--bg-0'), black: new THREE.Color(0, 0, 0),
    scan: new THREE.Color('#9fcdf5'), head: new THREE.Color('#f4f2ec'), thread: new THREE.Color('#a9dbe6'), ground: new THREE.Color('#54534f'), slab: new THREE.Color('#8b8984'), haze: new THREE.Color('#10151b'), zen: new THREE.Color('#040609'), fog: new THREE.Color('#262b31'),
    concrete: new THREE.Color('#9c9a95'), drywall: new THREE.Color('#b8b4ab'), rubble: new THREE.Color('#7d766d'), furn: new THREE.Color('#5d5348') };
}

class View {
  constructor(shared, swarm, tag) {
    this.sh = shared; this.swarm = swarm; this.tag = tag; this.world = swarm.world;
    const C = shared.C, sc = this.scene = new THREE.Scene();
    sc.background = C.haze; sc.fog = new THREE.FogExp2(C.haze.getHex(), 0.0042); sc.environment = shared.env; sc.environmentIntensity = 0.55;
    this.hemi = new THREE.HemisphereLight(0x76818f, 0x121110, 0.62); sc.add(this.hemi);
    const moon = this.moon = new THREE.DirectionalLight(0xc3cedd, 1.55); moon.position.set(SX / 2 + 70, 74, -SY / 2 - 46); moon.target.position.set(SX / 2, 0, -SY / 2);
    moon.castShadow = true; moon.shadow.mapSize.set(3072, 3072); const cam = moon.shadow.camera; cam.left = -84; cam.right = 84; cam.top = 72; cam.bottom = -72; cam.near = 10; cam.far = 240; moon.shadow.bias = -0.0008; moon.shadow.normalBias = 0.06; moon.shadow.radius = 2.4;
    sc.add(moon, moon.target);
    this.time = 0; this.robots = new Map(); this.relays = new Map(); this.leads = new Map(); this.labels = new Map(); this.threads = new Map(); this.threadPool = []; this.selected = null; this.linkRev = -1; this.frontRev = -1; this.bidSeen = new Map();
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._p2 = new THREE.Vector3(); this._c = new THREE.Color(); this._e = new THREE.Euler();
    this.labelHost = document.createElement('div'); this.labelHost.className = 'swarm-labels'; shared.host.append(this.labelHost);
    this.buildFields(); this.buildGround(); this.buildSolids(); this.buildShells(); this.buildBase(); this.buildFog(); this.buildThreads(); this.buildTrails(); this.buildTruth();
    this.syncAll();
  }

  // ---------- data textures ----------
  buildFields() {
    const C = this.sh.C, n = W * H;
    this.stateArr = new Uint8Array(n * 4); this.fieldArr = new Uint8Array(n * 4); this.reveal = new Float32Array(n); this.frontV = new Float32Array(n); this.isFront = new Uint8Array(n); this.active = new Int32Array(n); this.inActive = new Uint8Array(n); this.nActive = 0; this.open = new Uint8Array(n); this.openV = new Float32Array(n); this.bOf = new Int16Array(n).fill(-1); this.bGot = []; this.bN = [];
    this.world.buildings.forEach((b, i) => { const [x0, y0, x1, y1] = b.cells; let c = 0; for (let j = Math.max(0, Math.floor(y0)); j <= y1; j++) for (let x = Math.max(0, Math.floor(x0)); x <= x1; x++) { this.bOf[j * W + x] = i; c++; } this.bN[i] = c; this.bGot[i] = 0; });
    this.stateTex = new THREE.DataTexture(this.stateArr, W, H, THREE.RGBAFormat); this.stateTex.magFilter = this.stateTex.minFilter = THREE.NearestFilter;
    this.fieldTex = new THREE.DataTexture(this.fieldArr, W, H, THREE.RGBAFormat); this.fieldTex.magFilter = this.fieldTex.minFilter = THREE.LinearFilter;
    this.lightRT = new THREE.WebGLRenderTarget(960, 720, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.U = { uField: { value: this.fieldTex }, uState: { value: this.stateTex }, uLight: { value: this.lightRT.texture }, uNoise: { value: this.sh.noise }, uSite: { value: new THREE.Vector2(SX, SY) }, uTime: { value: 0 }, uBoost: { value: 1 },
      uScan: { value: C.scan }, uHead: { value: C.head }, uPerson: { value: C.person }, uTruth: { value: new THREE.Color(0, 0, 0) }, uBeaconC: { value: C.thread }, uGroundC: { value: C.ground }, uSlabC: { value: C.slab } };
    // light fans
    const cap = 60000; this.lp = new Float32Array(cap * 2); this.la = new Float32Array(cap * 4); this.lm = new Float32Array(cap * 2); this.ln = 0; this.lcap = cap;
    const g = this.lgeo = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.lp, 2).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aL', new THREE.BufferAttribute(this.la, 4).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aM', new THREE.BufferAttribute(this.lm, 2).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4); this.lscene = new THREE.Scene(); const lm = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: MT.LIGHT_VERT, fragmentShader: MT.LIGHT_FRAG, uniforms: { uTime: this.U.uTime }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation, side: THREE.DoubleSide })); lm.frustumCulled = false; this.lscene.add(lm);
    this.lcam = new THREE.OrthographicCamera(0, SX, SY, 0, -1, 1);
  }
  touch(k) { if (!this.inActive[k]) { this.inActive[k] = 1; this.active[this.nActive++] = k; } }
  stepFields(dt) {
    if (!this.nActive) return; const R = this.reveal, F = this.frontV, A = this.fieldArr, kn = this.swarm.state.known, up = dt / 0.85, upF = dt * 4; let w = 0;
    for (let q = 0; q < this.nActive; q++) {
      const k = this.active[q], tgt = kn[k] && kn[k] !== K.ROOF ? 1 : 0, ft = this.isFront[k]; let r = R[k], f = F[k];
      r = r < tgt ? Math.min(tgt, r + up) : tgt; f = f < ft ? Math.min(ft, f + upF) : Math.max(ft, f - upF); R[k] = r; F[k] = f;
      let o = this.openV[k]; const ot = this.open[k]; if (o < ot) { o = Math.min(1, o + dt / 1.5); this.openV[k] = o; } const j = k * 4; A[j + 3] = o * 255; A[j] = r * 255; A[j + 1] = f * 255; A[j + 2] = r > 0 && r < 1 ? 1020 * r * (1 - r) : 0;
      if (r !== tgt || f !== ft || o !== ot) this.active[w++] = k; else this.inActive[k] = 0;
    }
    this.nActive = w; this.fieldTex.needsUpdate = true;
  }

  // what is known opens the building above it, about a metre beyond the edge of the map; once most of a block is mapped the rest of its shell goes
  openAround(k) {
    const i = k % W, j = (k / W) | 0, O = this.open; for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) { if (a * a + b * b > 10) continue; const x = i + a, y = j + b; if (x < 0 || y < 0 || x >= W || y >= H) continue; const e = y * W + x; if (!O[e]) { O[e] = 1; this.touch(e); } }
    const q = this.bOf[k]; if (q >= 0 && ++this.bGot[q] > this.bN[q] * 0.62 && this.bGot[q] < 1e8) { this.bGot[q] = 1e9; const [x0, y0, x1, y1] = this.world.buildings[q].cells; for (let y = Math.max(0, Math.floor(y0) - 2); y <= Math.min(H - 1, y1 + 2); y++) for (let x = Math.max(0, Math.floor(x0) - 2); x <= Math.min(W - 1, x1 + 2); x++) { const e = y * W + x; if (!O[e]) { O[e] = 1; this.touch(e); } } }
  }

  // ---------- static world ----------
  buildGround() {
    const C = this.sh.C;
    const mat = MT.patched({ roughness: 0.95, metalness: 0, color: 0xffffff, envMapIntensity: 1 }, this.U, 'ground', MT.GROUND);
    const g = new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(g, mat); this.ground.position.set(SX / 2, 0, -SY / 2); this.ground.receiveShadow = true; this.scene.add(this.ground);
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x6a6f76, roughness: 0.8 }), 160); let n = 0;
    const put = (x, y) => { this._m.makeTranslation(x, 0, -y); post.setMatrixAt(n++, this._m); };
    for (let x = 0; x <= SX; x += 3) { put(x, 0); put(x, SY); } for (let y = 3; y < SY; y += 3) { put(0, y); put(SX, y); } post.count = n; this.scene.add(post);
    const tape = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([v3(0, 0, 0.92), v3(SX, 0, 0.92), v3(SX, SY, 0.92), v3(0, SY, 0.92)]), new THREE.LineBasicMaterial({ color: C.text3, transparent: true, opacity: 0.4 })); this.scene.add(tape);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(620, 32, 16), this.sh.skyMat); sky.position.set(SX / 2, -6, -SY / 2); this.scene.add(sky);
  }
  buildSolids() {
    const C = this.sh.C, w = this.world; let walls = 0, rub = 0, furn = 0; const comp = this.carAt = new Map();
    for (let k = 0; k < W * H; k++) { const t = w.solid[k]; if (t === T.CONCRETE || t === T.DRYWALL) walls++; else if (t === T.RUBBLE) rub++; else if (t === T.FURN) furn++; }
    this.cars = []; const seen = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) if (w.solid[k] === T.VEHICLE && !seen[k]) { const st = [k], cells = []; seen[k] = 1; while (st.length) { const c = st.pop(); cells.push(c); for (const d of [1, -1, W, -W]) { const e = c + d; if (w.solid[e] === T.VEHICLE && !seen[e]) { seen[e] = 1; st.push(e); } } } const car = { cells, got: 0, on: false }; this.cars.push(car); for (const c of cells) comp.set(c, car); }
    const inst = (geo, mat, cap, depthKey) => { cap = Math.max(1, cap); const birth = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aBirth', birth);
      const m = new THREE.InstancedMesh(geo, mat, cap); m.customDepthMaterial = MT.patchedDepth(this.U, 'grow', MT.GROW_DEPTH); m.count = 0; m.castShadow = m.receiveShadow = true; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); m.birth = birth; this.scene.add(m); return m; };
    const P = parts();
    this.walls = inst(new THREE.BoxGeometry(RES, 1, RES).translate(0, 0.5, 0), MT.patched({ roughness: 0.9 }, this.U, 'wall', MT.WALL), walls);
    this.rocks = inst(P.rock.clone(), MT.patched({ roughness: 0.95, flatShading: true }, this.U, 'rock', MT.WALL), rub * 5);
    this.bars = inst(new THREE.CylinderGeometry(0.018, 0.018, 1, 5).translate(0, 0.35, 0), MT.patched({ roughness: 0.6, metalness: 0.5, color: 0x8a6f5c }, this.U, 'bar', MT.WALL), Math.ceil(rub / 3));
    this.furn = inst(new THREE.BoxGeometry(RES * 0.96, 1, RES * 0.96).translate(0, 0.5, 0), MT.patched({ roughness: 0.7 }, this.U, 'furn', MT.WALL), furn);
    this.carM = inst(P.car.clone(), MT.patched({ roughness: 0.38, metalness: 0.35, vertexColors: true }, this.U, 'car', { ...MT.GROW_V, fDecl: 'varying float vTop; varying float vGrow;', color: MT.PROP.color }), this.cars.length);
    this.solidAt = new Uint8Array(W * H); this.dirty = new Set();
  }
  put(mesh, x, y, z, e, sx, sy, sz, col, k, instant, dly = 0) {
    const i = mesh.count++; this._q.setFromEuler(e); this._m.compose(this._p.set(x, y, z), this._q, this._s.set(sx, sy, sz)); mesh.setMatrixAt(i, this._m); this._c.copy(col).multiplyScalar(0.78 + hash(k * 3 + 1) * 0.4); mesh.setColorAt(i, this._c);
    mesh.birth.array[i] = instant ? -10 : this.time + dly; this.dirty.add(mesh);
  }
  addSolid(k, instant) {
    const t = this.world.solid[k]; if (this.solidAt[k] || !t || t === T.EDGE) return; this.solidAt[k] = 1;
    const i = k % W, j = (k / W) | 0, x = (i + 0.5) * RES, z = -(j + 0.5) * RES, r = hash(k), r2 = hash(k * 7 + 3), e = this._e, C = this.sh.C, dly = r * 0.15;
    if (t === T.CONCRETE || t === T.DRYWALL) { e.set(0, 0, 0); const broken = hash(((i >> 3) * 91) ^ ((j >> 3) * 17)) > 0.86 ? r * 0.8 : r * 0.06; this.put(this.walls, x, 0, z, e, 1, (t === T.CONCRETE ? 1.75 : 1.6) - broken, 1, t === T.CONCRETE ? C.concrete : C.drywall, (i >> 2) * 7 + (j >> 2) * 131, instant, dly); }
    else if (t === T.RUBBLE) { for (let q = 0; q < 5; q++) { const a = hash(k * 5 + q * 101), b = hash(k * 11 + q * 37), c = hash(k * 17 + q * 59), s = 0.14 + c * c * c * 0.72; e.set((a - 0.5) * 1.2, b * TAU, (c - 0.5) * 1.2); this.put(this.rocks, x + (a - 0.5) * 0.55, 0.03 + s * 0.12 + (q > 2 ? r * 0.3 * a : 0), z + (b - 0.5) * 0.55, e, s * (1 + b * 0.8), s * (0.5 + a * 0.6), s, q % 2 ? C.rubble : C.concrete, k + q, instant, dly + q * 0.05); }
      if (r2 > 0.72 && this.bars.count < this.bars.instanceMatrix.count) { e.set((r - 0.5) * 2, 0, (r2 - 0.85) * 5); this.put(this.bars, x, 0.15, z, e, 1, 0.5 + r * 0.9, 1, C.rubble, k, instant, dly); } }
    else if (t === T.FURN) { e.set(0, 0, 0); this.put(this.furn, x, 0, z, e, 1, 0.5 + hash((i >> 1) + (j >> 1) * 99) * 0.5, 1, C.furn, (i >> 2) + (j >> 2) * 57, instant, dly); }
    else if (t === T.VEHICLE) { const car = this.carAt.get(k); if (car && ++car.got >= Math.min(4, car.cells.length) && !car.on) { car.on = true; let x0 = 1e9, x1 = 0, y0 = 1e9, y1 = 0; for (const c of car.cells) { const ci = c % W, cj = (c / W) | 0; x0 = Math.min(x0, ci); x1 = Math.max(x1, ci); y0 = Math.min(y0, cj); y1 = Math.max(y1, cj); } const lx = (x1 - x0 + 1) * RES, ly = (y1 - y0 + 1) * RES, along = lx >= ly;
      e.set(0, along ? 0 : Math.PI / 2, 0); this._c.setHSL(hash(k) < 0.5 ? 0.58 : 0.07, 0.03 + 0.05 * hash(k * 3), 0.16 + 0.3 * hash(k * 5)); this.put(this.carM, ((x0 + x1 + 1) / 2) * RES, 0, -((y0 + y1 + 1) / 2) * RES, e, along ? lx : ly, 1.75, along ? ly : lx, this._c.clone(), k, instant); } }
  }
  buildShells() {
    const geo = siteShells(this.world.buildings, this.world.seed); const mk = (g, shadow) => { const m = new THREE.Mesh(g, MT.patched({ roughness: 0.9, side: THREE.DoubleSide }, this.U, 'shell', MT.SHELL)); m.castShadow = shadow; m.receiveShadow = true; if (shadow) m.customDepthMaterial = MT.patchedDepth(this.U, 'shell', MT.SHELL_DEPTH); this.scene.add(m); return m; };
    if (geo) this.shell = mk(geo, true);
    this.city = mk(citySurround(SX, SY, 3), false);
  }
  buildBase() {
    const C = this.sh.C, [bx, by] = this.world.base, g = new THREE.Group(); g.position.copy(v3(bx, by));
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.34, 3.4, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C.text, transparent: true, opacity: 0.22 })); ring.position.y = 0.05; g.add(ring); this.baseRing = ring;
    const steel = new THREE.MeshStandardMaterial({ color: 0x8b9199, roughness: 0.45, metalness: 0.6 }), canvasM = new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.95, side: THREE.DoubleSide }), dark = new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.7 });
    const add = (geo, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    const roof = new THREE.BufferGeometry(); roof.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1.8, 1.6, 1.4, 1.8, 1.6, 1.4, 1.8, 2.5, 0, -1.8, 1.6, 1.4, 1.8, 2.5, 0, -1.8, 2.5, 0, -1.8, 1.6, -1.4, 1.8, 2.5, 0, 1.8, 1.6, -1.4, -1.8, 1.6, -1.4, -1.8, 2.5, 0, 1.8, 2.5, 0]), 3)); roof.computeVertexNormals();
    add(roof, canvasM, -5.3, 0, 1.0); for (const x of [-1.75, 1.75]) for (const z of [-1.35, 1.35]) add(new THREE.CylinderGeometry(0.035, 0.035, 1.65, 8), steel, -5.3 + x, 0.82, 1 + z);
    add(new THREE.BoxGeometry(2.2, 0.06, 0.8), steel, -5.3, 0.8, 1.2); add(new THREE.BoxGeometry(0.5, 0.36, 0.05), dark, -5.0, 1.02, 1.1); add(new THREE.BoxGeometry(0.9, 0.5, 0.6), dark, -3.2, 0.25, -2.6, 0.2); add(new THREE.BoxGeometry(0.9, 0.5, 0.6), dark, -4.3, 0.25, -2.7, -0.1);
    const scr = add(new THREE.PlaneGeometry(0.44, 0.3), new THREE.MeshBasicMaterial({ color: C.scan.clone().multiplyScalar(0.8) }), -5.0, 1.02, 1.13); scr.castShadow = false;
    add(new THREE.CylinderGeometry(0.05, 0.08, 6, 10), steel, 0, 3, 0); for (const y of [2, 4]) for (let q = 0; q < 3; q++) { const a = (q / 3) * TAU, o = add(new THREE.CylinderGeometry(0.006, 0.006, Math.hypot(y, 1.8), 4), steel, Math.cos(a) * 0.9, y / 2, Math.sin(a) * 0.9); o.rotation.set(Math.sin(a) * -Math.atan2(1.8, y), 0, Math.cos(a) * Math.atan2(1.8, y)); o.castShadow = false; }
    add(new THREE.BoxGeometry(0.1, 0.8, 0.3), dark, 0.1, 5.4, 0); const tip = add(new THREE.SphereGeometry(0.1, 14, 10), new THREE.MeshBasicMaterial({ color: C.thread.clone().multiplyScalar(2.5) }), 0, 6.1, 0); tip.castShadow = false;
    this.scene.add(g); this.baseTop = v3(bx, by, 5.9); this.label('BASE', 'Base', 'swarm-l-base');
  }
  buildFog() {
    const L = 10, base = new THREE.PlaneGeometry(SX, SY).rotateX(-Math.PI / 2), g = new THREE.InstancedBufferGeometry(); g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv; g.instanceCount = L; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    g.setAttribute('aL', new THREE.InstancedBufferAttribute(Float32Array.from({ length: L }, (_, i) => 0.15 + i * 0.27), 1));
    this.fogU = { ...this.U, uDens: { value: 0.17 }, uFogC: { value: this.sh.C.fog } };
    this.fog = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: MT.FOG_VERT, fragmentShader: MT.FOG_FRAG, uniforms: this.fogU, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor })); this.fog.position.set(SX / 2, 0, -SY / 2); this.fog.frustumCulled = false; this.fog.renderOrder = 3; this.scene.add(this.fog);
  }
  buildThreads() {
    const N = 26, pos = new Float32Array((N + 1) * 2 * 3), idx = []; for (let i = 0; i <= N; i++) { pos.set([i / N, 1, 0, i / N, -1, 0], i * 6); if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3); }
    const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
    const mk = (n) => new THREE.InstancedBufferAttribute(new Float32Array(THREADS * n), n).setUsage(THREE.DynamicDrawUsage);
    this.tA = mk(3); this.tB = mk(3); this.tC = mk(3); this.tP = mk(4); g.setAttribute('iA', this.tA); g.setAttribute('iB', this.tB); g.setAttribute('iC', this.tC); g.setAttribute('iP', this.tP); g.instanceCount = 0; this.tGeo = g; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.tU = { uRes: { value: new THREE.Vector2(1, 1) }, uPx: { value: 5 }, uTime: this.U.uTime };
    const mat = (depthFunc, gain) => new THREE.ShaderMaterial({ vertexShader: MT.THREAD_VERT, fragmentShader: MT.THREAD_FRAG, uniforms: { ...this.tU, uGain: { value: gain } }, transparent: true, depthWrite: false, depthFunc, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    for (const [f, k] of [[THREE.LessEqualDepth, 1], [THREE.GreaterDepth, 0.3]]) { const m = new THREE.Mesh(g, mat(f, k)); m.frustumCulled = false; m.renderOrder = 6; this.scene.add(m); (this.threadMeshes ||= []).push(m); }
  }
  thread(key) { let t = this.threads.get(key); if (!t) { t = this.threadPool.pop() || { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Color() }; Object.assign(t, { key, age: 0, sag: 0, sagV: 0, grow: 0, alpha: 0, want: 1, dying: 0, fall: 0, kind: 'link', dly: 0, hold: 0, aId: '', bId: '', rest: 1, q: 1, rev: 0, len: 0, snap: false }); this.threads.set(key, t); } return t; }
  buildTrails() {
    const C = this.sh.C, g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, -1, 0, 1, 1, 0, 1, -1, 0]), 3)); g.setIndex([0, 1, 2, 2, 1, 3]);
    this.sg = new THREE.InstancedBufferAttribute(new Float32Array(SEGS * 4), 4).setUsage(THREE.DynamicDrawUsage); this.sm = new THREE.InstancedBufferAttribute(new Float32Array(SEGS * 2), 2).setUsage(THREE.DynamicDrawUsage); g.setAttribute('iSeg', this.sg); g.setAttribute('iMeta', this.sm); g.instanceCount = 0; this.trailGeo = g; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4); this.segN = 0;
    this.trU = { uTime: this.U.uTime, uCol: { value: C.accent }, uCol2: { value: C.scan }, uOn: { value: 1 } };
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: MT.TRAIL_VERT, fragmentShader: MT.TRAIL_FRAG, uniforms: this.trU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); m.frustumCulled = false; m.renderOrder = 2; this.scene.add(m);
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXR * 6), 3)); gg.setDrawRange(0, 0); this.goalLines = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: C.accent, transparent: true, opacity: 0.38, depthTest: false })); this.goalLines.frustumCulled = false; this.goalLines.renderOrder = 5; this.scene.add(this.goalLines);
    this.goalMarks = new THREE.InstancedMesh(new THREE.RingGeometry(0.55, 0.75, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0.85, depthTest: false }), MAXR); this.goalMarks.count = 0; this.goalMarks.frustumCulled = false; this.goalMarks.renderOrder = 5; this.scene.add(this.goalMarks);
  }
  addSeg(ax, ay, bx, by, kind) { const i = this.segN++ % SEGS; this.sg.setXYZW(i, ax, ay, bx, by); this.sm.setXY(i, this.time, kind); this.sg.addUpdateRange(i * 4, 4); this.sm.addUpdateRange(i * 2, 2); this.sg.needsUpdate = this.sm.needsUpdate = true; this.trailGeo.instanceCount = Math.min(SEGS, this.segN); }
  buildTruth() { // debug layer: the hidden map, written into the blue channel of the state texture
    const w = this.world; for (let k = 0; k < W * H; k++) this.stateArr[k * 4 + 2] = w.solid[k] && w.solid[k] !== T.EDGE ? 255 : 0;
    this.truthMarks = new THREE.Group(); this.truthMarks.visible = false; this.scene.add(this.truthMarks);
    for (const tg of w.targets) { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), new THREE.MeshBasicMaterial({ color: this.sh.C.sim, wireframe: true, depthTest: false })); m.position.copy(v3(tg.pos[0], tg.pos[1], 1.2)); this.truthMarks.add(m); }
  }

  // ---------- labels ----------
  label(id, text, cls) {
    let l = this.labels.get(id);
    if (!l) { l = { el: document.createElement('div'), text: '', cls: '', w: null, lift: -1, vis: null, pr: 1 }; l.el.className = 'swarm-label'; this.labelHost.append(l.el); this.labels.set(id, l); this.order = [...this.labels.values()]; }
    if (l.text !== text) { l.el.textContent = text; l.text = text; }
    if (cls !== undefined && l.cls !== cls) { l.el.className = 'swarm-label ' + cls; l.cls = cls; l.pr = cls.includes('lead') ? 2 : cls.includes('base') ? 0 : 1; this.order.sort((a, b) => b.pr - a.pr); }
    return l;
  }
  at(l, x, y, z) { (l.w ||= new THREE.Vector3()).set(x, y, z); }
  placeLabels(rect) {
    const cam = this.sh.camera, v = this._p, pl = (this._pl ||= []); if (this._rk !== rect.x + ',' + rect.w + ',' + rect.h) { this._rk = rect.x + ',' + rect.w + ',' + rect.h; this.labelHost.style.cssText = 'left:' + rect.x + 'px;top:0;width:' + rect.w + 'px;height:' + rect.h + 'px'; }
    let np = 0;
    for (const l of this.order) {
      let ok = !!l.w && !l.off; if (ok) { v.copy(l.w).project(cam); ok = v.z < 1 && Math.abs(v.x) < 1.02 && Math.abs(v.y) < 1.02; }
      if (l.vis !== ok) { l.vis = ok; l.el.style.display = ok ? '' : 'none'; } if (!ok) continue;
      const x = (v.x * 0.5 + 0.5) * rect.w, y0 = (-v.y * 0.5 + 0.5) * rect.h, wpx = l.text.length * 6.4 + 16, hpx = 20; let y = y0 - 8, lift = 0, hit = false;
      for (let t = 0; t < 4; t++) { hit = false; for (let q = 0; q < np; q++) if (Math.abs(pl[q].x - x) < (pl[q].w + wpx) / 2 && Math.abs(pl[q].y - y) < hpx) { hit = true; break; } if (!hit) break; y -= hpx + 1; lift += hpx + 1; }
      if (hit) { l.vis = false; l.el.style.display = 'none'; continue; }
      const p = (pl[np++] ||= { x: 0, y: 0, w: 0 }); p.x = x; p.y = y; p.w = wpx;
      l.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) translate(-50%,-100%)'; if (l.lift !== lift) { l.lift = lift; l.el.style.setProperty('--lift', lift + 8 + 'px'); }
    }
  }

  // ---------- machines ----------
  makeRover(r) {
    const C = this.sh.C, P = parts(), g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const pm = (this.paint ||= MT.patched({ vertexColors: true, roughness: 0.42, metalness: 0.45 }, this.U, 'paint', { color: 'gE += diffuseColor.rgb * fieldLight(sUv(vW), vW.y) * 0.22;' }));
    const sh = new THREE.Mesh(P.rover, pm); sh.castShadow = sh.receiveShadow = true; body.add(sh);
    const wheels = []; for (const z of [0.215, -0.215]) for (const x of [-0.22, 0, 0.22]) { const w = new THREE.Mesh(P.wheel, pm); w.position.set(x, 0.1, z); w.castShadow = true; body.add(w); wheels.push(w); }
    const lidar = new THREE.Mesh(P.lidar, pm); lidar.position.set(-0.1, 0.41, 0); body.add(lidar);
    const hm = (this.headMat ||= new THREE.MeshBasicMaterial({ color: C.head.clone().multiplyScalar(4.5) })), tm = (this.tailMat ||= new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.06, 0.05) }));
    for (const z of [0.09, -0.09]) { const l = new THREE.Mesh(this._hl ||= new THREE.CylinderGeometry(0.032, 0.032, 0.02, 14).rotateZ(Math.PI / 2), hm); l.position.set(0.385, 0.2, z); body.add(l); const t = new THREE.Mesh(this._tl ||= new THREE.BoxGeometry(0.012, 0.025, 0.06), tm); t.position.set(-0.352, 0.2, z); body.add(t); }
    const lamp = new THREE.Mesh(this._lampG ||= new THREE.SphereGeometry(0.026, 10, 8), new THREE.MeshBasicMaterial({ color: C.accent })); lamp.position.set(-0.24, 0.72, 0.09); body.add(lamp);
    const ring = new THREE.Mesh(this._ringG ||= new THREE.RingGeometry(0.58, 0.64, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0.75, depthWrite: false })); ring.position.y = 0.09; ring.renderOrder = 4; g.add(ring);
    const hit = new THREE.Mesh(this._hitG ||= new THREE.SphereGeometry(1.5, 8, 6), this._hitM ||= new THREE.MeshBasicMaterial({ visible: false })); hit.userData.pick = { type: 'robot', id: r.id }; g.add(hit);
    return { g, body, ring, lamp, wheels, lidar, hit, kind: 'rover', alt: 0 };
  }
  makeDrone(r) {
    const C = this.sh.C, P = parts(), g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const pm = (this.paint ||= MT.patched({ vertexColors: true, roughness: 0.42, metalness: 0.45 }, this.U, 'paint', { color: 'gE += diffuseColor.rgb * fieldLight(sUv(vW), vW.y) * 0.22;' }));
    const sh = new THREE.Mesh(P.drone, pm); sh.castShadow = true; body.add(sh); const rotors = [];
    for (const [x, y, z] of P.hubs) { const b = new THREE.Mesh(P.blade, pm); b.position.set(x, y, z); body.add(b); rotors.push(b); const d = new THREE.Mesh(this._discG ||= new THREE.CircleGeometry(0.25, 28).rotateX(-Math.PI / 2), this._discM ||= new THREE.MeshBasicMaterial({ color: 0xb8c4d2, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })); d.position.set(x, y + 0.01, z); body.add(d); }
    const mk = (c, x, y, z, s = 0.03) => { const m = new THREE.Mesh(this._lampG ||= new THREE.SphereGeometry(0.026, 10, 8), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); m.scale.setScalar(s / 0.026); body.add(m); return m; };
    mk(new THREE.Color(2.2, 0.12, 0.1), 0.33, 0.0, -0.33); mk(new THREE.Color(0.1, 2.0, 0.6), 0.33, 0.0, 0.33); const lamp = mk(C.accent, -0.18, 0.04, 0); const flood = mk(C.head.clone().multiplyScalar(3.2), 0.17, -0.14, 0, 0.04);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 1, 1, 40, 1, true).translate(0, -0.5, 0), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uC: { value: C.scan } }, vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = -position.y; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }', fragmentShader: 'varying float vY; varying vec3 vN; varying vec3 vV; uniform vec3 uC; void main(){ float f = pow(abs(dot(vN, vV)), 1.6); gl_FragColor = vec4(uC * f * (1.0 - vY) * 0.13, 1.0); }' })); cone.renderOrder = 6; g.add(cone);
    const ring = new THREE.Mesh(this._ringG2 ||= new THREE.RingGeometry(0.5, 0.56, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C.scan, transparent: true, opacity: 0.6, depthWrite: false })); ring.position.y = 0.09; ring.renderOrder = 4; g.add(ring);
    const hit = new THREE.Mesh(this._hitG ||= new THREE.SphereGeometry(1.5, 8, 6), this._hitM ||= new THREE.MeshBasicMaterial({ visible: false })); hit.userData.pick = { type: 'robot', id: r.id }; body.add(hit);
    return { g, body, ring, lamp, rotors, cone, flood, hit, kind: 'drone', alt: 0, sx: r.x, sy: r.y };
  }
  makeBeacon(b) {
    const C = this.sh.C, g = new THREE.Group(); g.position.copy(v3(b.x, b.y, 0)); let base = 0; if (b.high && this.world.indoor[b.cell]) base = 1.9; g.position.y = base;
    const m = new THREE.Mesh(parts().beacon, this.paint); m.castShadow = true; g.add(m);
    const tip = new THREE.Mesh(this._tipG ||= new THREE.SphereGeometry(0.09, 14, 10), new THREE.MeshBasicMaterial({ color: C.thread })); tip.position.y = 1.9; g.add(tip);
    const ring = new THREE.Mesh(this._bring ||= new THREE.RingGeometry(0.9, 0.98, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C.thread, transparent: true, opacity: 0.9, depthWrite: false })); ring.position.y = 0.09; ring.renderOrder = 4; g.add(ring);
    const hit = new THREE.Mesh(this._hitB ||= new THREE.SphereGeometry(1.1, 8, 6), this._hitM ||= new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 1.2; hit.userData.pick = { type: 'relay', id: b.id }; g.add(hit);
    this.scene.add(g); return { g, tip, ring, body: m, born: this.time, deadAt: 0, base };
  }
  makeLead(l) {
    const C = this.sh.C, g = new THREE.Group(); g.position.copy(v3(l.pos[0], l.pos[1]));
    const fres = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uC: { value: new THREE.Color() }, uK: { value: 0 } }, vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }', fragmentShader: 'varying vec3 vN; varying vec3 vV; uniform vec3 uC; uniform float uK; void main(){ float f = 1.0 - abs(dot(vN, vV)); gl_FragColor = vec4(uC * uK * (0.35 + 1.5 * f * f), 1.0); }' });
    const fig = new THREE.Mesh(parts().person, fres); fig.renderOrder = 7; fig.visible = false; g.add(fig);
    const mat = new THREE.MeshBasicMaterial({ color: C.warn, transparent: true, opacity: 0.8, depthWrite: false });
    const beam = new THREE.Mesh(this._beamG ||= new THREE.CylinderGeometry(0.022, 0.022, 1, 8).translate(0, 0.5, 0), mat); g.add(beam);
    const ring = new THREE.Mesh(this._lr ||= new THREE.RingGeometry(1.22, 1.32, 64).rotateX(-Math.PI / 2), mat); ring.position.y = 0.1; g.add(ring);
    const pulse = new THREE.Mesh(this._lp2 ||= new THREE.RingGeometry(0.97, 1.0, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C.warn, transparent: true, opacity: 0.6, depthWrite: false })); pulse.position.y = 0.1; g.add(pulse);
    for (const o of g.children) o.renderOrder = 7; this.scene.add(g);
    return { g, mat, beam, ring, pulse, fig, fres, born: this.time, conf: 0, glow: 0, h: 0 };
  }

  // ---------- engine state to scene ----------
  syncAll() { const S = this.swarm.state, kn = S.known; for (let k = 0; k < W * H; k++) if (kn[k]) this.cell(k, kn[k], true); if (S.changed) S.changed.length = 0; this.stateDirty = true; }
  cell(k, v, instant) {
    this.stateArr[k * 4] = (v === K.FREE ? (this.world.indoor[k] ? 2 : 1) : v === K.OCC ? 3 : 4) * 50;
    if (v !== K.ROOF) { if (instant) this.reveal[k] = 1; this.openAround(k); } this.touch(k);
    if (v === K.OCC) this.addSolid(k, instant); this.stateDirty = true;
  }
  // a visibility fan against what is known: light stops at known walls and at the edge of the unknown
  fan(x, y, h0, spread, rays, R, type, amp, aux) {
    const kn = this.swarm.state.known, lp = this.lp, la = this.la, lm = this.lm; if (this.ln + rays * 3 > this.lcap) return;
    let px = 0, py = 0;
    for (let q = 0; q <= rays; q++) {
      const a = h0 - spread + (2 * spread * q) / rays, dx = Math.cos(a), dy = Math.sin(a); let d = 0.2;
      for (; d < R; d += 0.28) { const i = ((x + dx * d) / RES) | 0, j = ((y + dy * d) / RES) | 0; if (i < 0 || j < 0 || i >= W || j >= H) break; const v = kn[j * W + i]; if (v === K.OCC || v === K.ROOF) { d += 0.35; break; } if (v === K.UNKNOWN) { d += 0.8; break; } }
      if (d > R) d = R; const ex = x + dx * d, ey = y + dy * d;
      if (q) { const n = this.ln; lp[n * 2] = x; lp[n * 2 + 1] = y; lp[n * 2 + 2] = px; lp[n * 2 + 3] = py; lp[n * 2 + 4] = ex; lp[n * 2 + 5] = ey;
        const ch = Math.cos(-h0), sh = Math.sin(-h0); for (let w = 0; w < 3; w++) { const gx = lp[(n + w) * 2] - x, gy = lp[(n + w) * 2 + 1] - y, j = (n + w) * 4; la[j] = gx * ch - gy * sh; la[j + 1] = gx * sh + gy * ch; la[j + 2] = R; la[j + 3] = amp; lm[(n + w) * 2] = type; lm[(n + w) * 2 + 1] = aux; } this.ln += 3; }
      px = ex; py = ey;
    }
  }
  disc(x, y, R, type, amp) { const lp = this.lp, la = this.la, lm = this.lm, n = this.ln; if (n + 6 > this.lcap) return; const q = View.Q; for (let w = 0; w < 6; w++) { const gx = q[w * 2] * R, gy = q[w * 2 + 1] * R; lp[(n + w) * 2] = x + gx; lp[(n + w) * 2 + 1] = y + gy; const j = (n + w) * 4; la[j] = gx; la[j + 1] = gy; la[j + 2] = R; la[j + 3] = amp; lm[(n + w) * 2] = type; lm[(n + w) * 2 + 1] = 0; } this.ln += 6; }
  flushLight(renderer) { const g = this.lgeo, n = this.ln; for (const k of ['position', 'aL', 'aM']) { const a = g.attributes[k]; a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; } g.setDrawRange(0, n); renderer.setRenderTarget(this.lightRT); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(this.lscene, this.lcam); renderer.setRenderTarget(null); }

  nodeTop(id, out, scale) { if (id === 'BASE') return out.copy(this.baseTop); const b = this.relays.get(id); if (b) return out.set(b.g.position.x, b.base + 1.9 * b.g.scale.x, b.g.position.z); const r = this.robots.get(id); if (!r) return out.copy(this.baseTop); if (r.kind === 'drone') return out.set(r.x, r.body.position.y, -r.y); const c = Math.cos(r.h) * scale, s = Math.sin(r.h) * scale; return out.set(r.x - 0.24 * c + 0.09 * s, 0.72 * scale, -r.y + 0.24 * s + 0.09 * c); }

  update(dt, speed) {
    const S = this.swarm.state, C = this.sh.C, sh = this.sh; this.time += dt; const time = this.time; this.U.uTime.value = time; this.ln = 0;
    if (S.changed && S.changed.length) { for (let q = 0; q < S.changed.length; q++) this.cell(S.changed[q], S.known[S.changed[q]], false); S.changed.length = 0; }
    if (this.frontRev !== S.frontRev) { this.frontRev = S.frontRev; if (this.frontCells) for (const k of this.frontCells) { this.isFront[k] = 0; this.touch(k); } this.frontCells = S.front; if (S.front) for (const k of S.front) { this.isFront[k] = 1; this.touch(k); } }
    this.stepFields(dt);
    if (this.stateDirty) { this.stateTex.needsUpdate = true; this.stateDirty = false; }
    if (this.dirty.size) { for (const m of this.dirty) { m.instanceMatrix.needsUpdate = m.instanceColor.needsUpdate = m.birth.needsUpdate = true; } this.dirty.clear(); }

    const camDist = sh.camera.position.distanceTo(sh.controls.target), scale = clamp(camDist / 30, 1.5, 4.2);
    let gi = 0; const gp = this.goalLines.geometry.attributes.position.array;
    for (let q = 0; q < S.robots.length; q++) {
      const r = S.robots[q]; let o = this.robots.get(r.id);
      if (!o) { o = r.kind === 'drone' ? this.makeDrone(r) : this.makeRover(r); o.x = o.lx = r.x; o.y = o.ly = r.y; o.h = r.heading; this.scene.add(o.g); this.robots.set(r.id, o); }
      const kPos = r.kind === 'drone' ? 1 - Math.exp(-dt * 4.5) : 1 - Math.exp(-dt * 16), ox = o.x, oy = o.y; o.x += (r.x - o.x) * kPos; o.y += (r.y - o.y) * kPos;
      const vx = o.x - ox, vy = o.y - oy, sp = Math.hypot(vx, vy); let want = o.h; if (sp > dt * 0.25) want = Math.atan2(vy, vx); let dh = want - o.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); o.h += dh * (1 - Math.exp(-dt * 6.5));
      const flying = r.kind === 'drone' && r.mode !== 'done' && r.mode !== 'swap' && r.mode !== 'dead' && r.mode !== 'standby', off = r.mode === 'done' || r.mode === 'dead';
      o.alt += ((flying ? PARAMS.drone.alt : 0.25) - o.alt) * (1 - Math.exp(-dt * 1.8));
      o.g.position.set(o.x, 0, -o.y); o.body.position.y = r.kind === 'drone' ? o.alt + (flying ? Math.sin(time * 1.7 + q) * 0.12 : 0) : 0; o.body.rotation.y = o.h; o.body.scale.setScalar(scale);
      if (o.rotors) { if (flying) { for (let w = 0; w < 4; w++) o.rotors[w].rotation.y += dt * (w % 2 ? 38 : -38); o.body.rotation.z = -clamp(sp / Math.max(dt, 1e-3) * 0.008, 0, 0.3); } else o.body.rotation.z = 0; const R = PARAMS.drone.footprint; o.cone.visible = flying && sh.layers.range; o.cone.position.y = o.body.position.y - 0.1; o.cone.scale.set(R, o.body.position.y, R); }
      if (o.wheels) { const roll = -sp / (0.095 * scale); for (let w = 0; w < 6; w++) o.wheels[w].rotation.z += roll; o.lidar.rotation.y += dt * 11; }
      const col = r.mode === 'lead' || r.mode === 'listen' ? C.warn : r.mode === 'regroup' || r.mode === 'dead' ? C.danger : r.mode === 'swap' || r.mode === 'return' ? C.ok : off ? C.text3 : C.accent;
      o.ring.material.color.copy(col); o.lamp.material.color.copy(col).multiplyScalar(2.6); const ringOn = !sh.cinema || this.selected === r.id; o.ring.visible = ringOn; if (ringOn) o.ring.scale.setScalar(scale * (this.selected === r.id ? 1.35 + 0.1 * Math.sin(time * 4) : 1));
      // light
      if (r.kind === 'rover') { if (!off && r.mode !== 'swap') this.fan(o.x + Math.cos(o.h) * 0.3, o.y + Math.sin(o.h) * 0.3, o.h, 0.86, 44, 15, 0, 1, 0); if (!off && sh.layers.range) this.fan(o.x, o.y, 0, Math.PI, 84, PARAMS.rover.lidar, 1, r.mode === 'listen' ? 1.8 : 1, hash(q)); }
      else if (flying) { if (sh.layers.range) this.disc(o.x, o.y, PARAMS.drone.footprint, 4, 0.9); this.disc(o.x, o.y, 5, 0.1, 0); }
      const moved = Math.hypot(o.x - o.lx, o.y - o.ly); if (moved > 0.35) { if (moved < 14) this.addSeg(o.lx, o.ly, o.x, o.y, r.kind === 'drone' ? 1 : 0); o.lx = o.x; o.ly = o.y; }
      if (sh.layers.goals && !sh.cinema && r.goal && !r.goal.home && (r.mode === 'explore' || r.mode === 'lead') && gi < MAXR) { const j = gi * 6; gp[j] = o.x; gp[j + 1] = r.kind === 'drone' ? o.alt : 0.5; gp[j + 2] = -o.y; gp[j + 3] = r.goal.x; gp[j + 4] = 0.3; gp[j + 5] = -r.goal.y; this._m.compose(this._p.set(r.goal.x, 0.1, -r.goal.y), this._q.identity(), this._s.setScalar(scale * 0.5)); this.goalMarks.setMatrixAt(gi, this._m); gi++; }
      if (o.mode !== r.mode || o.sel !== (this.selected === r.id) || o.lead !== r.lead) { o.mode = r.mode; o.sel = this.selected === r.id; o.lead = r.lead; const mt = MODE[r.mode] || ''; this.label(r.id, r.id + (mt ? ' · ' + mt : ''), 'swarm-l-robot' + (o.sel ? ' sel' : '') + (r.mode === 'regroup' || r.mode === 'dead' ? ' bad' : r.mode === 'lead' || r.mode === 'listen' ? ' warn' : '') + (r.mode === 'done' ? ' off' : '')); }
      const l = this.labels.get(r.id); l.off = (sh.cinema || off || r.mode === 'swap') && this.selected !== r.id; this.at(l, o.x, (r.kind === 'drone' ? o.alt : 0) + 0.8 * scale, -o.y);
    }
    this.goalLines.geometry.setDrawRange(0, gi * 2); this.goalLines.geometry.attributes.position.needsUpdate = true; this.goalMarks.count = gi; this.goalMarks.instanceMatrix.needsUpdate = true; this.goalLines.visible = this.goalMarks.visible = sh.layers.goals && !sh.cinema;

    // beacons
    for (let q = 0; q < S.relays.length; q++) {
      const b = S.relays[q]; let o = this.relays.get(b.id); if (!o) { o = this.makeBeacon(b); this.relays.set(b.id, o); }
      const age = time - o.born, s = clamp(camDist / 48, 1, 2.3), drop = 1 - Math.pow(1 - clamp(age / 0.5, 0, 1), 3); if (!b.alive && !o.deadAt) o.deadAt = time;
      const flick = b.dying && b.alive ? (Math.sin(time * 34) > 0 ? 1.6 : 0.15) : 1, col = !b.alive ? C.danger : b.connected === false ? C.warn : C.thread;
      o.tip.material.color.copy(col).multiplyScalar((b.alive ? 2.6 : Math.max(0.05, 3 - (time - o.deadAt) * 2)) * flick); o.ring.material.color.copy(col); o.g.scale.setScalar(s * (0.25 + 0.75 * drop)); o.g.position.y = o.base + (1 - drop) * 1.2;
      const p = age < 1.4 ? age / 1.4 : 1, dp = o.deadAt ? clamp((time - o.deadAt) / 1.6, 0, 1) : 0; o.ring.scale.setScalar(o.deadAt ? 1 + dp * 3.2 : 1 + (age < 1.4 ? p * 5 : 0)); o.ring.material.opacity = o.deadAt ? 0.9 * (1 - dp) : age < 1.4 ? 0.8 * (1 - p) + 0.08 : sh.cinema ? 0.08 : 0.3;
      if (o.deadAt) o.body.rotation.z = Math.min(1.32, o.body.rotation.z + dt * (0.3 + o.body.rotation.z * 4));
      if (b.alive) this.disc(b.x, b.y, 2.4, 3, 0.5 * flick);
    }
    // mesh links: each link keeps its own thread so it can stretch, sag, fall and be replaced
    if (this.linkRev !== S.linkRev) { this.linkRev = S.linkRev; const rev = (this.rev = (this.rev || 0) + 1);
      for (const L of S.links) { const t = this.thread(L.a + '|' + L.b); t.rev = rev; t.aId = L.a; t.bId = L.b; t.kind = L.kind === 'backbone' ? 'back' : 'up'; t.q = L.q; t.want = L.kind === 'backbone' ? 0.95 : 0.6; t.c.copy(this.sh.cinema || L.rssi > -83 ? C.thread : L.rssi > -86.5 ? C.warn : C.danger); if (this.sh.cinema) t.want *= 0.35 + 0.65 * Math.min(1, L.q * 2.2); if (t.dying) { t.dying = 0; t.fall = 0; } }
      for (const t of this.threads.values()) if (t.kind !== 'bid' && t.rev !== rev && !t.dying) { t.dying = 1e-4; const b = S.relays.find((x) => x.id === t.bId); t.snap = !!(b && !b.alive) || !!S.relays.find((x) => x.id === t.aId && !x.alive); if (t.snap) t.c.copy(C.danger); } }
    let n = 0; const TA = this.tA.array, TB = this.tB.array, TC = this.tC.array, TP = this.tP.array;
    for (const t of this.threads.values()) {
      t.age += dt; const live = t.age - t.dly; if (live < 0) continue;
      if (!t.dying || !t.snap) { this.nodeTop(t.aId, t.a, scale); if (t.bId !== '@') this.nodeTop(t.bId, t.b, scale); }
      if (t.kind === 'bid') { const g = clamp(live / 0.5, 0, 1); t.grow = g * g * (3 - 2 * g); t.sag = t.rest; const end = live > t.hold; t.alpha += ((end ? 0 : t.want) - t.alpha) * (1 - Math.exp(-dt * (end ? 3.2 : 9))); if (end && t.alpha < 0.01) { this.threads.delete(t.key); this.threadPool.push(t); continue; } }
      else if (t.dying) { t.dying += dt; if (t.snap) { t.sagV += dt * 7; t.sag += t.sagV * dt; t.fall = Math.min(1, t.fall + dt * 1.1); t.alpha = (1 - clamp(t.dying / 1.5, 0, 1)) * 1.5; } else { t.alpha *= Math.exp(-dt * 5); t.sag += dt * 1.5; } if (t.dying > 1.5 || t.alpha < 0.02) { this.threads.delete(t.key); this.threadPool.push(t); continue; } }
      else { const g = clamp(live / 0.6, 0, 1); t.grow = 1 - Math.pow(1 - g, 3); const len = t.a.distanceTo(t.b); t.rest = 0.25 + len * (0.012 + 0.05 * (1 - t.q)); const acc = -46 * (t.sag - t.rest) - 8.5 * t.sagV - (t.len ? (len - t.len) * 30 : 0); t.len = len; t.sagV += acc * dt; t.sag = clamp(t.sag + t.sagV * dt, 0, 5); t.alpha += (t.want - t.alpha) * (1 - Math.exp(-dt * 6)); }
      if (n >= THREADS) continue; const i3 = n * 3, i4 = n * 4, fy = t.fall * t.fall;
      TA[i3] = t.a.x; TA[i3 + 1] = t.a.y; TA[i3 + 2] = t.a.z; TB[i3] = t.b.x; TB[i3 + 1] = t.b.y * (1 - fy) + 0.1 * fy; TB[i3 + 2] = t.b.z; TC[i3] = t.c.r; TC[i3 + 1] = t.c.g; TC[i3 + 2] = t.c.b; TP[i4] = t.sag; TP[i4 + 1] = t.grow; TP[i4 + 2] = t.alpha * (t.kind === 'bid' ? 1.5 : 1) * (sh.layers.mesh || t.kind === 'bid' ? 1 : 0); TP[i4 + 3] = t.dying || sh.reduced ? -1 : hash(n * 7 + 1); n++;
    }
    this.tGeo.instanceCount = n; this.tA.needsUpdate = this.tB.needsUpdate = this.tC.needsUpdate = this.tP.needsUpdate = true;

    // leads, the bids for them, and people
    for (let q = 0; q < S.leads.length; q++) {
      const l = S.leads[q]; let o = this.leads.get(l.id); if (!o) { o = this.makeLead(l); this.leads.set(l.id, o); }
      const conf = l.status === 'confirmed', rej = l.status === 'rejected', col = conf ? C.person : rej ? C.text3 : C.warn;
      if (l.bids && l.winner && this.bidSeen.get(l.id) !== l.awardedAt) { const first = !this.bidSeen.has(l.id); this.bidSeen.set(l.id, l.awardedAt); if (first || true) { let d = 0; for (const b of l.bids) { if (!b.eligible) continue; const t = this.thread('bid' + l.id + b.robot); const won = b.robot === l.winner; t.kind = 'bid'; t.aId = b.robot; t.bId = '@'; t.b.copy(v3(l.pos[0], l.pos[1], 2.4)); t.c.copy(won ? C.warn : C.accent); t.rest = -4 - 2 * hash(d + 3); t.want = won ? 1 : 0.75; t.dly = won ? 0.75 : d * 0.09; t.hold = won ? 4.5 : 1.15; d++; } } }
      if (o.st !== l.status) { o.st = l.status; if (conf) o.confAt = time; const txt = conf ? 'Person · ' + Math.round(l.p * 100) + ' %' : rej ? 'Ruled out' : l.status === 'open' ? 'Possible · ' + Math.round(l.p * 100) + ' % · needs a person' : 'Possible · ' + Math.round(l.p * 100) + ' %' + (l.winner ? ' · ' + l.winner : ''); this.label(l.id, txt, 'swarm-l-lead ' + (conf ? 'person' : rej ? 'off' : 'warn')); }
      o.conf += ((conf ? 1 : 0) - o.conf) * (1 - Math.exp(-dt * 1.4)); o.h += ((conf ? 3.4 : rej ? 0.6 : 3.0) - o.h) * (1 - Math.exp(-dt * 3)); o.beam.scale.y = Math.max(0.01, o.h);
      o.mat.color.copy(col).multiplyScalar(conf ? 1.7 : rej ? 0.5 : 1.2); o.mat.opacity = rej ? 0.25 : 0.75; o.pulse.material.color.copy(col);
      const f = ((time - o.born) * 0.32) % 1; o.pulse.visible = !rej && !sh.reduced; o.pulse.scale.setScalar(1.3 + f * (conf ? 5 : 3)); o.pulse.material.opacity = 0.55 * (1 - f) * (1 - f);
      const s = clamp(camDist / 60, 0.9, 1.9); o.ring.scale.setScalar(s * (rej ? 0.5 : 1)); const breath = sh.reduced ? 0.7 : 0.7 + 0.3 * Math.sin(time * 1.7);
      o.fig.visible = o.conf > 0.02; o.fig.scale.setScalar(clamp(camDist / 42, 1.05, 2.4)); o.fres.uniforms.uC.value.copy(C.person); o.fres.uniforms.uK.value = o.conf * (1.15 + 0.4 * breath);
      if (!rej) this.fan(l.pos[0], l.pos[1], 0, Math.PI, 60, 3 + o.conf * 4.5, 2, conf ? 0.12 + o.conf * (0.36 + 0.14 * breath) : 0.0, 0);
      const lb = this.labels.get(l.id); lb.off = sh.cinema && !conf && l.status !== 'assigned' && l.status !== 'listening'; this.at(lb, l.pos[0], o.h + 0.15, -l.pos[1]);
    }
    const bl = this.labels.get('BASE'); bl.off = sh.cinema; this.baseRing.visible = !sh.cinema; this.at(bl, this.world.base[0], 6.5, -this.world.base[1]);
    this.truthMarks.visible = sh.layers.truth; this.U.uTruth.value.copy(sh.layers.truth ? C.sim : C.black);
    this.trU.uOn.value = sh.layers.trails ? 1 : 0; this.U.uBoost.value = sh.cinema ? 0.8 : 1.5; this.hemi.intensity = sh.cinema ? 0.95 : 1.9; this.moon.intensity = sh.cinema ? 1.7 : 2.4; this.fogU.uDens.value = sh.cinema ? 0.17 : 0.06;
  }
  robotPos(id, out) { const o = this.robots.get(id); return o ? out.set(o.x, o.kind === 'drone' ? o.alt * 0.3 : 0.3, -o.y) : null; }
  dispose() {
    this.labelHost.remove(); const shared = new Set(Object.values(parts()));
    this.scene.traverse((o) => { if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose(); const m = o.material; if (m && m !== this.sh.skyMat) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose?.()); o.customDepthMaterial?.dispose?.(); if (o.isInstancedMesh) o.dispose(); });
    this.moon.shadow.map?.dispose(); this.lgeo.dispose(); this.lightRT.dispose(); this.stateTex.dispose(); this.fieldTex.dispose();
  }
}
View.Q = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
const MODE = { explore: '', lead: 'to lead', listen: 'listening', return: 'to base', swap: 'swap', regroup: 'no link', home: 'done', done: '', dead: 'empty' };

class ViewsPass extends Pass {
  constructor(draw) { super(); this.draw = draw; this.needsSwap = false; this.clear = true; }
  render(renderer, writeBuffer, readBuffer) { this.draw(this.renderToScreen ? null : readBuffer); }
}
const damp = (o, k, to, st, dt) => { const w = 2 / Math.max(1e-3, st), x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x), c = o[k] - to, tmp = (o.v[k] + w * c) * dt; o.v[k] = (o.v[k] - w * tmp) * e; o[k] = to + (c + tmp) * e; };

// ---------------------------------------------------------------------------------------------------------
export function createScene(host, { kit, onPick }) {
  const C = tokenColors(kit);
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  const maxPR = Math.min(1.5, window.devicePixelRatio || 1); let pr = maxPR;
  renderer.setPixelRatio(pr); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false; renderer.toneMapping = THREE.NoToneMapping; renderer.autoClear = false;
  const canvas = renderer.domElement; canvas.className = 'swarm-canvas'; canvas.setAttribute('aria-label', '3-D view of the sandbox site. Drag to orbit, scroll to zoom, click a robot to follow it or a beacon to fail it.'); canvas.tabIndex = 0; host.append(canvas);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 1200);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = 0.07; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 6; controls.maxDistance = 260; controls.zoomSpeed = 0.8;
  const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { uHor: { value: C.haze }, uZen: { value: C.zen } }, vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: MT.SKY_FRAG });
  // reflections come from a small generated night sky
  let env = null; { const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'varying vec3 vD; void main(){ float h = vD.y; vec3 c = mix(vec3(0.115,0.13,0.15), vec3(0.025,0.03,0.04), smoothstep(-0.05, 0.5, h)); c += vec3(0.58,0.62,0.7) * exp(-pow(distance(vD, normalize(vec3(0.62,0.5,-0.5))) / 0.22, 2.0)) * 0.9; c *= step(-0.08, h) * 0.92 + 0.08; gl_FragColor = vec4(c, 1.0); }' }))); const pm = new THREE.PMREMGenerator(renderer); env = pm.fromScene(s, 0.02).texture; pm.dispose(); }
  const sh = { C, host, camera, controls, env, skyMat, noise: MT.noiseTexture(), layers: { mesh: true, trails: true, range: true, goals: true, truth: false }, reduced: kit.reducedMotion(), cinema: false };
  let views = [], size = { w: 1, h: 1 }, mode = 'overview', follow = null, lastTouch = -1e9, clock = 0, composer = null, bloom = null, final = null, disposed = false, fade = 1, fadeTo = 1, frameNo = 0, slow = 0, fast = 0, rs = [{ x: 0, y: 0, w: 1, h: 1 }];
  const goal = { pos: new THREE.Vector3(), target: new THREE.Vector3(), active: false }, centre = new THREE.Vector3(SX / 2, 0, -SY / 2), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), off = new THREE.Vector3();
  const cam = { x: SX / 2, y: 1, z: -SY / 2, d: 120, az: 0, el: 0.7, v: { x: 0, y: 0, z: 0, d: 0, az: 0, el: 0 } }, shot = { x: SX / 2, y: 1, z: -SY / 2, d: 120, az: 0, el: 0.7, st: 3, drift: 0, id: null, shift: 0 };

  const rects = () => rs;
  const calcRects = () => { const n = views.length || 1, gap = n > 1 ? 2 : 0, w = (size.w - gap * (n - 1)) / n; rs = Array.from({ length: n }, (_, i) => ({ x: i * (w + gap), y: 0, w, h: size.h })); };
  const probe = new THREE.PerspectiveCamera(32, 1, 1, 900), corners = [];
  for (const hgt of [0, 4]) for (const [x, y] of [[0, 0], [SX, 0], [SX, SY], [0, SY]]) corners.push(v3(x, y, hgt));
  // Frame the site: push the camera back along a fixed direction until it fits, for any viewport shape.
  function frameSite(kind) {
    const r = rs[0], aspect = r.w / r.h; camera.aspect = aspect; camera.updateProjectionMatrix();
    const el = THREE.MathUtils.degToRad(kind === 'plan' ? 89.5 : aspect < 1.15 ? 60 : 50), az = kind === 'plan' ? 0 : -0.22, dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    const pad = kind === 'plan' ? { l: 0.02, r: 0.02, t: 0.02, b: 0.02 } : { l: -0.01, r: -0.01, t: 0.0, b: 0.0 };
    const tgt = centre.clone(), p = new THREE.Vector3(), right = new THREE.Vector3(), fwd = new THREE.Vector3(); let d = 160; probe.fov = camera.fov; probe.aspect = aspect; probe.updateProjectionMatrix();
    const vf = THREE.MathUtils.degToRad(camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    for (let it = 0; it < 28; it++) {
      probe.position.copy(tgt).addScaledVector(dir, d); probe.lookAt(tgt); probe.updateMatrixWorld(); let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (const c of corners) { p.copy(c).project(probe); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      const aw = 2 - 2 * (pad.l + pad.r), ah = 2 - 2 * (pad.t + pad.b), sc = Math.max((x1 - x0) / aw, (y1 - y0) / ah), ex = (x0 + x1) / 2 - (pad.l - pad.r), ey = (y0 + y1) / 2 - (pad.b - pad.t);
      right.setFromMatrixColumn(probe.matrixWorld, 0); right.y = 0; right.normalize(); fwd.setFromMatrixColumn(probe.matrixWorld, 1); fwd.y = 0; fwd.normalize();
      tgt.addScaledVector(right, ex * d * Math.tan(hf / 2) * 0.9).addScaledVector(fwd, (ey * d * Math.tan(vf / 2) * 0.9) / Math.max(0.35, Math.sin(el))); d *= 1 + (sc - 1) * 0.85;
    }
    goal.target.copy(tgt); goal.pos.copy(tgt).addScaledVector(dir, d); goal.active = true;
  }
  const snap = () => { camera.position.copy(goal.pos); controls.target.copy(goal.target); goal.active = false; };
  function setCamera(m, id) { mode = m; follow = m === 'follow' ? id : null; if (m === 'film') { readCam(); } else if (m !== 'follow') frameSite(m); else { goal.active = false; } for (const v of views) v.selected = follow; }
  function readCam() { off.copy(camera.position).sub(controls.target); cam.d = off.length(); cam.el = Math.asin(clamp(off.y / cam.d, -1, 1)); const az = Math.atan2(off.x, off.z); cam.az = az + Math.round((shot.az - az) / TAU) * TAU; cam.x = controls.target.x; cam.y = controls.target.y; cam.z = controls.target.z; for (const k in cam.v) cam.v[k] = 0; }
  controls.addEventListener('start', () => { lastTouch = clock; goal.active = false; });

  // Film camera: the director sets shots; the camera glides between them with critically damped motion.
  function film(s, cut) { Object.assign(shot, { id: null, drift: 0 }, s); if (s.p) { shot.x = s.p[0]; shot.z = -s.p[1]; } if (cut) { for (const k of ['x', 'y', 'z', 'd', 'az', 'el']) { cam[k] = shot[k]; cam.v[k] = 0; } cam.cut = true; } else { while (shot.az - cam.az > Math.PI) shot.az -= TAU; while (shot.az - cam.az < -Math.PI) shot.az += TAU; } }
  function stepFilm(dt) {
    if (clock - lastTouch < 6 && !cam.cut) { controls.update(); readCam(); return; } cam.cut = false;
    if (!sh.reduced) shot.az += shot.drift * dt;
    if (shot.id && views[0]?.robotPos(shot.id, tmp)) { shot.x = tmp.x; shot.y = tmp.y + 0.4; shot.z = tmp.z; }
    for (const k of ['x', 'y', 'z']) damp(cam, k, shot[k], shot.id ? shot.st * 0.6 : shot.st, dt); for (const k of ['d', 'az', 'el']) damp(cam, k, shot[k], shot.st, dt);
    const ce = Math.cos(cam.el); controls.target.set(cam.x, cam.y, cam.z); camera.position.set(cam.x + Math.sin(cam.az) * ce * cam.d, cam.y + Math.sin(cam.el) * cam.d, cam.z + Math.cos(cam.az) * ce * cam.d);
    camera.position.y = Math.max(1.1, camera.position.y); camera.lookAt(controls.target);
  }

  function drawViews(target) {
    renderer.setRenderTarget(target); if (target) { target.scissorTest = false; target.viewport.set(0, 0, target.width, target.height); renderer.setRenderTarget(target); } else { renderer.setScissorTest(false); renderer.setViewport(0, 0, size.w, size.h); }
    renderer.setClearColor(C.bg0, 1); renderer.clear();
    for (let i = 0; i < views.length; i++) {
      const v = views[i], r = rs[i]; camera.aspect = r.w / r.h; camera.updateProjectionMatrix(); v.tU.uRes.value.set(r.w, r.h); v.tU.uPx.value = sh.cinema ? 4.2 : 3.2;
      if (target) { target.viewport.set(r.x * pr, 0, r.w * pr, r.h * pr); target.scissor.set(r.x * pr, 0, r.w * pr, r.h * pr); target.scissorTest = views.length > 1; renderer.setRenderTarget(target); } else { renderer.setViewport(r.x, 0, r.w, r.h); renderer.setScissor(r.x, 0, r.w, r.h); renderer.setScissorTest(true); }
      renderer.shadowMap.needsUpdate = (frameNo + i) % 3 === 0 || v.moon.shadow.map === null; renderer.render(v.scene, camera);
    }
    if (target) { target.scissorTest = false; target.viewport.set(0, 0, target.width, target.height); } else renderer.setScissorTest(false);
  }
  function buildComposer() {
    try {
      const rt = new THREE.WebGLRenderTarget(size.w * pr, size.h * pr, { type: THREE.HalfFloatType, samples: 4 });
      composer = new EffectComposer(renderer, rt); composer.setPixelRatio(pr); composer.setSize(size.w, size.h); composer.addPass(new ViewsPass(drawViews)); composer.addPass(new ShaderPass(MT.CLEAN));
      bloom = new UnrealBloomPass(new THREE.Vector2(size.w, size.h), 0.5, 0.62, 0.85); composer.addPass(bloom); final = new ShaderPass(MT.FINAL); composer.addPass(final);
    } catch (e) { console.warn('[swarm] post-processing unavailable, drawing without it', e); composer = null; renderer.toneMapping = THREE.ACESFilmicToneMapping; }
  }
  function applySize() { renderer.setPixelRatio(pr); renderer.setSize(size.w, size.h, false); if (composer) { composer.setPixelRatio(pr); composer.setSize(size.w, size.h); } }
  function resize() {
    const r = host.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return; size = { w: Math.round(r.width), h: Math.round(r.height) }; canvas.style.width = size.w + 'px'; canvas.style.height = size.h + 'px'; calcRects(); if (!composer) buildComposer(); applySize();
    if (mode !== 'follow' && mode !== 'film') { frameSite(mode); if (clock - lastTouch > 1) snap(); }
  }
  const ro = new ResizeObserver(resize); ro.observe(host);
  function setSwarms(swarms, tags = []) {
    for (const v of views) v.dispose(); views = swarms.map((s, i) => new View(sh, s, tags[i] || '')); calcRects(); for (const v of views) v.selected = follow;
    if (mode !== 'follow' && mode !== 'film') { frameSite(mode); if (clock < 0.5) snap(); }
  }
  // adaptive resolution: drop it when frames run long, raise it again when there is room
  function adapt(dt) { if (dt > 0.0195) { slow += dt; fast = 0; } else { slow = Math.max(0, slow - dt * 0.5); fast += dt; } if (slow > 0.9 && pr > 0.72) { pr = Math.max(0.7, pr * 0.86); slow = 0; applySize(); } else if (fast > 12 && pr < maxPR) { pr = Math.min(maxPR, pr * 1.1); fast = 0; applySize(); } }
  function frame(dt, speed = 1) {
    if (disposed || !views.length || !composer && size.w < 2) return; clock += dt; frameNo++; sh.reduced = kit.reducedMotion(); adapt(dt);
    if (mode === 'film') stepFilm(dt);
    else if (mode === 'follow' && follow) { if (views[0].robotPos(follow, tmp)) { off.copy(camera.position).sub(controls.target); tmp2.copy(tmp).sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 3)); controls.target.add(tmp2); camera.position.add(tmp2); const dist = off.length(); if (dist > 46 && clock - lastTouch > 2) { off.setLength(dist + (34 - dist) * (1 - Math.exp(-dt * 1.8))); camera.position.copy(controls.target).add(off); } } controls.update(); }
    else { if (goal.active) { const k = 1 - Math.exp(-dt * 2.6); camera.position.lerp(goal.pos, k); controls.target.lerp(goal.target, k); if (camera.position.distanceTo(goal.pos) < 0.05) goal.active = false; } else if (mode === 'overview' && !sh.reduced && clock - lastTouch > 8) { off.copy(camera.position).sub(controls.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, Math.sin(clock * 0.07) * 0.00045); camera.position.copy(controls.target).add(off); } controls.update(); }
    camera.updateMatrixWorld();
    for (const v of views) { v.update(dt, speed); v.flushLight(renderer); }
    fade += (fadeTo - fade) * (1 - Math.exp(-dt * 4)); if (final) { final.uniforms.uTime.value = clock % 10; final.uniforms.uFade.value = fade; final.uniforms.uExp.value = sh.cinema ? 1.3 : 1.65; final.uniforms.uVig.value = sh.cinema ? 1 : 0.45; bloom.strength = sh.cinema ? 0.5 : 0.36; }
    if (composer) composer.render(dt); else drawViews(null);
    for (let i = 0; i < views.length; i++) { camera.aspect = rs[i].w / rs[i].h; camera.updateProjectionMatrix(); views[i].placeLabels(rs[i]); }
  }
  // picking
  const ray = new THREE.Raycaster(), down = { x: 0, y: 0 }, ndc = new THREE.Vector2(); let hoverAt = 0;
  const pickAt = (e) => { const b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, i = rs.findIndex((r) => x >= r.x && x <= r.x + r.w); if (i < 0 || !views[i]) return null; const r = rs[i]; camera.aspect = r.w / r.h; camera.updateProjectionMatrix(); ray.setFromCamera(ndc.set(((x - r.x) / r.w) * 2 - 1, -(y / r.h) * 2 + 1), camera);
    const hs = []; for (const o of views[i].robots.values()) hs.push(o.hit); for (const o of views[i].relays.values()) hs.push(o.g.children[3]); const h = ray.intersectObjects(hs, false)[0]; return h ? { ...h.object.userData.pick, view: i } : null; };
  canvas.addEventListener('pointerdown', (e) => { down.x = e.clientX; down.y = e.clientY; });
  canvas.addEventListener('pointermove', (e) => { const n = performance.now(); if (n - hoverAt < 90 || e.buttons) return; hoverAt = n; canvas.style.cursor = pickAt(e) ? 'pointer' : ''; });
  canvas.addEventListener('pointerup', (e) => { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; const p = pickAt(e); if (p) { lastTouch = -1e9; onPick?.(p); } });
  return {
    canvas, setSwarms, frame, resize, setCamera, film, cameraMode: () => mode, rects, snap, pixelRatio: () => pr,
    setCinema(on) { sh.cinema = on; }, setFade(v, now) { fadeTo = v; if (now) fade = v; }, touched: () => clock - lastTouch < 6,
    setLayer(name, on) { sh.layers[name] = on; }, layers: () => ({ ...sh.layers }), select(id) { for (const v of views) v.selected = id; }, hasBloom: () => !!composer, parts: () => ({ renderer, composer, bloom, views, final }),
    dispose() { disposed = true; ro.disconnect(); for (const v of views) v.dispose(); views = []; controls.dispose(); composer?.dispose?.(); renderer.dispose(); canvas.remove(); },
  };
}
