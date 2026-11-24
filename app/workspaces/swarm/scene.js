// Swarm scene: the 3-D view of one or two sandbox runs. One WebGL canvas; in race mode the two runs are drawn
// side by side with the same camera. Everything drawn here comes from the engine state: nothing is decorative data.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { W, H, RES, T, K, PARAMS } from './engine.js';

const SX = W * RES, SY = H * RES;
const TRAIL_PX = 12;                                   // trail texture: pixels per metre
const hash = (k) => { let x = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
const v3 = (x, y, h = 0) => new THREE.Vector3(x, h, -y);

const GROUND_FRAG = /* glsl */ `
  vec4 st = texture2D(uState, vG);
  float cls = floor(st.r * 255.0 / 50.0 + 0.5);
  float kn = texture2D(uKnown, vG).r;
  vec2 m = vG * uSite;                                  // metres
  float n1 = gNoise(m * 0.35), n2 = gNoise(m * 2.3), n3 = gNoise(m * 9.0);
  float seen = smoothstep(0.30, 0.62, kn + (n2 - 0.5) * 0.12);
  // unknown ground: almost black, a faint survey grid so the size of what is left is readable
  vec2 g10 = abs(fract(m / 10.0 - 0.5) - 0.5) * 10.0;
  float grid10 = 1.0 - smoothstep(0.0, 0.09, min(g10.x, g10.y));
  vec3 unk = uUnknown * (0.75 + 0.5 * n1) + uScan * grid10 * 0.035;
  // known ground: graphite outdoors, a lighter slab indoors with tile joints
  vec2 g1 = abs(fract(m - 0.5) - 0.5);
  float grid1 = 1.0 - smoothstep(0.0, 0.035, min(g1.x, g1.y));
  vec3 outC = uGround * (0.72 + 0.34 * n1 + 0.2 * n2 + 0.12 * n3) + uScan * (grid10 * 0.05 + grid1 * 0.012);
  vec2 gt = abs(fract(m / 1.5 - 0.5) - 0.5) * 1.5;
  float tile = 1.0 - smoothstep(0.0, 0.03, min(gt.x, gt.y));
  vec3 inC = uSlab * (0.9 + 0.16 * n2 + 0.08 * n3) - tile * 0.012;
  float indoorK = step(1.5, cls) * (1.0 - step(2.5, cls));
  vec3 knownC = mix(outC, inC, indoorK);
  if (cls > 2.5 && cls < 3.5) knownC = uGround * 0.5;
  diffuseColor.rgb = mix(unk, knownC, seen);
  // the edge of what is known, frontiers, the wash of a fresh scan, robot trails
  float rim = seen * (1.0 - seen) * 4.0;
  float born = texture2D(uBirth, vG).r;
  float fresh = exp(-max(0.0, uTime - born) * 1.8) * step(0.5, cls);
  float pulse = 0.55 + 0.45 * sin(uTime * 3.2 - (m.x + m.y) * 0.35);
  vec4 tr = texture2D(uTrail, vG);
  gEmis = uScan * (rim * 0.07 + fresh * 0.4 + st.g * (0.3 + 0.85 * pulse) * uPulse) + tr.rgb * tr.a * 1.25 * uTrailOn;
  gEmis += uTruth * st.b * (1.0 - seen) * 0.5;
`;

function tokenColors(kit) {
  const c = (n) => new THREE.Color(kit.cssVar(n) || '#888');
  return { accent: c('--accent'), person: c('--person'), warn: c('--warn'), ok: c('--ok'), danger: c('--danger'), sim: c('--sim'), text: c('--text'), text3: c('--text-3'), bg0: c('--bg-0'), bg2: c('--bg-2'),
    scan: new THREE.Color('#bfe0ff'), ground: new THREE.Color('#3b414a'), slab: new THREE.Color('#5d6570'), unknown: new THREE.Color('#07090c'),
    concrete: new THREE.Color('#8b929c'), drywall: new THREE.Color('#aab0b8'), rubble: new THREE.Color('#5d564e'), furn: new THREE.Color('#6b6258'), vehicle: new THREE.Color('#566170'), silver: new THREE.Color('#c9ced6') };
}

// ---------------------------------------------------------------------------------------------------------
class View {
  constructor(shared, swarm, tag) {
    this.sh = shared; this.swarm = swarm; this.tag = tag; this.world = swarm.world;
    const C = shared.C;
    this.scene = new THREE.Scene(); this.scene.background = C.bg0.clone(); this.scene.fog = new THREE.Fog(C.bg0.getHex(), 170, 420);
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1a1c20, 0.85));
    const sun = new THREE.DirectionalLight(0xfff1dd, 2.4); sun.position.set(SX / 2 - 55, 80, -SY / 2 + 60); sun.target.position.set(SX / 2, 0, -SY / 2);
    sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); const sc = sun.shadow.camera; sc.left = -80; sc.right = 80; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 260; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.05; sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
    this.time = 0; this.robots = new Map(); this.relays = new Map(); this.leads = new Map(); this.labels = new Map(); this.selected = null;
    this.labelHost = document.createElement('div'); this.labelHost.className = 'swarm-labels'; shared.host.append(this.labelHost);
    this.buildGround(); this.buildWalls(); this.buildBase(); this.buildLinks(); this.buildGoals(); this.buildTruth();
    this.syncAll();
  }

  buildGround() {
    const C = this.sh.C, n = W * H;
    this.stateArr = new Uint8Array(n * 4); this.knownArr = new Uint8Array(n); this.birthArr = new Float32Array(n).fill(-100);
    this.stateTex = new THREE.DataTexture(this.stateArr, W, H, THREE.RGBAFormat); this.stateTex.magFilter = this.stateTex.minFilter = THREE.NearestFilter;
    this.knownTex = new THREE.DataTexture(this.knownArr, W, H, THREE.RedFormat); this.knownTex.magFilter = this.knownTex.minFilter = THREE.LinearFilter;
    this.birthTex = new THREE.DataTexture(this.birthArr, W, H, THREE.RedFormat, THREE.FloatType); this.birthTex.magFilter = this.birthTex.minFilter = THREE.NearestFilter;
    this.trailCanvas = document.createElement('canvas'); this.trailCanvas.width = SX * TRAIL_PX; this.trailCanvas.height = SY * TRAIL_PX;
    this.tctx = this.trailCanvas.getContext('2d'); this.tctx.lineCap = 'round'; this.tctx.lineJoin = 'round';
    this.trailTex = new THREE.CanvasTexture(this.trailCanvas); this.trailTex.colorSpace = THREE.SRGBColorSpace; this.trailTex.anisotropy = 4;
    for (const t of [this.stateTex, this.knownTex, this.birthTex]) t.needsUpdate = true;
    const U = this.gu = { uState: { value: this.stateTex }, uKnown: { value: this.knownTex }, uBirth: { value: this.birthTex }, uTrail: { value: this.trailTex }, uTime: { value: 0 }, uSite: { value: new THREE.Vector2(SX, SY) },
      uScan: { value: C.scan }, uGround: { value: C.ground }, uSlab: { value: C.slab }, uUnknown: { value: C.unknown }, uTruth: { value: C.sim }, uPulse: { value: 1 }, uTrailOn: { value: 1 } };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0 });
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, U);
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vG;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvG = uv;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
        varying vec2 vG; uniform sampler2D uState, uKnown, uBirth, uTrail; uniform float uTime, uPulse, uTrailOn; uniform vec2 uSite; uniform vec3 uScan, uGround, uSlab, uUnknown, uTruth;
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y); }
        vec3 gEmis;`)
        .replace('#include <map_fragment>', GROUND_FRAG).replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += gEmis;');
    };
    const g = new THREE.PlaneGeometry(SX, SY); g.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(g, mat); this.ground.position.set(SX / 2, 0, -SY / 2); this.ground.receiveShadow = true; this.scene.add(this.ground);
    // apron beyond the site so the world does not end at a hard edge
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: C.unknown.clone().multiplyScalar(0.8), roughness: 1 })); apron.position.set(SX / 2, -0.05, -SY / 2); this.scene.add(apron);
    const frame = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([v3(0, 0, 0.03), v3(SX, 0, 0.03), v3(SX, SY, 0.03), v3(0, SY, 0.03)]), new THREE.LineBasicMaterial({ color: C.text3, transparent: true, opacity: 0.5 })); this.scene.add(frame);
    // roofs the drone has seen from above: the building is there, its inside is still unknown
    const roofMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uState: U.uState, uSite: U.uSite, uCol: { value: C.concrete }, uTime: U.uTime },
      vertexShader: 'varying vec2 vG; void main(){ vG = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vG; uniform sampler2D uState; uniform vec2 uSite; uniform vec3 uCol; uniform float uTime;
        void main(){ float cls = floor(texture2D(uState, vG).r * 255.0 / 50.0 + 0.5); if (cls < 3.5) discard; vec2 m = vG * uSite; float h = smoothstep(0.42, 0.5, abs(fract((m.x + m.y) / 1.4) - 0.5));
          gl_FragColor = vec4(uCol * (0.16 + 0.10 * h), 0.78); }` });
    this.roof = new THREE.Mesh(g, roofMat); this.roof.position.set(SX / 2, 1.72, -SY / 2); this.roof.renderOrder = 2; this.scene.add(this.roof);
  }

  buildWalls() {
    const C = this.sh.C; let cap = 0; for (let k = 0; k < W * H; k++) if (this.world.solid[k] && this.world.solid[k] !== T.EDGE) cap++;
    const geo = new THREE.BoxGeometry(RES, 1, RES); geo.translate(0, 0.5, 0);
    this.wallBirth = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); geo.setAttribute('aBirth', this.wallBirth);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.02 });
    const U = this.gu;
    const vpatch = (s) => { s.uniforms.uTime = U.uTime;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aBirth; uniform float uTime; varying float vTop; varying float vGrow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat g = clamp((uTime - aBirth) / 0.45, 0.0, 1.0); g = 1.0 - pow(1.0 - g, 3.0); transformed.y *= g; vTop = step(0.5, normal.y); vGrow = g;'); };
    mat.onBeforeCompile = (s) => { vpatch(s); s.uniforms.uScan = U.uScan;
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vTop; varying float vGrow; uniform vec3 uScan;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.55, 1.5, vTop);')
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += uScan * ((1.0 - vGrow) * 1.6 + vTop * 0.035);'); };
    const dmat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); dmat.onBeforeCompile = vpatch;
    this.walls = new THREE.InstancedMesh(geo, mat, Math.max(1, cap)); this.walls.customDepthMaterial = dmat; this.walls.count = 0; this.walls.castShadow = true; this.walls.receiveShadow = true; this.walls.frustumCulled = false;
    this.walls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
    this.scene.add(this.walls); this.wallAt = new Int32Array(W * H).fill(-1);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._c = new THREE.Color(); this._e = new THREE.Euler();
    this.typeCol = { 1: C.concrete, 2: C.drywall, 3: C.rubble, 4: C.furn, 5: C.vehicle };
  }
  addWall(k, instant) {
    if (this.wallAt[k] >= 0) return; const t = this.world.solid[k]; if (!t || t === T.EDGE) return;
    const i = k % W, j = (k / W) | 0, r = hash(k), r2 = hash(k * 7 + 3), idx = this.walls.count++;
    let h = 1.6, sxz = 1, yaw = 0;
    if (t === T.DRYWALL) h = 1.42; else if (t === T.RUBBLE) { h = 0.25 + r * r * 1.25; sxz = 0.95 + r2 * 0.5; yaw = r * 3; } else if (t === T.FURN) h = 0.72 + r * 0.12; else if (t === T.VEHICLE) h = 1.25 + (r > 0.7 ? 0.3 : 0);
    this._e.set(t === T.RUBBLE ? (r2 - 0.5) * 0.5 : 0, yaw, t === T.RUBBLE ? (r - 0.5) * 0.5 : 0); this._q.setFromEuler(this._e);
    this._m.compose(this._p.set((i + 0.5) * RES, 0, -(j + 0.5) * RES), this._q, this._s.set(sxz, h, sxz)); this.walls.setMatrixAt(idx, this._m);
    this._c.copy(this.typeCol[t]).multiplyScalar(0.82 + r * 0.3); this.walls.setColorAt(idx, this._c);
    this.wallBirth.array[idx] = instant ? -10 : this.time + r * 0.12; this.wallAt[k] = idx; this.wallsDirty = true;
  }

  buildBase() {
    const C = this.sh.C, [bx, by] = this.world.base, g = new THREE.Group(); g.position.copy(v3(bx, by));
    const pad = new THREE.Mesh(new THREE.RingGeometry(3.3, 3.5, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C.text, transparent: true, opacity: 0.55 })); pad.position.y = 0.04; g.add(pad);
    const pad2 = new THREE.Mesh(new THREE.CircleGeometry(3.3, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C.text, transparent: true, opacity: 0.045 })); pad2.position.y = 0.035; g.add(pad2);
    const tent = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.5, 1.8), new THREE.MeshStandardMaterial({ color: C.silver.clone().multiplyScalar(0.55), roughness: 0.7 })); tent.position.set(-4.2, 0.75, 0.6); tent.castShadow = true; g.add(tent);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 1.25, 0.6, 4, 1).rotateY(Math.PI / 4), tent.material); roof.scale.set(1.5, 1, 1.05); roof.position.set(-4.2, 1.8, 0.6); g.add(roof);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 5, 8), new THREE.MeshStandardMaterial({ color: C.silver, roughness: 0.4, metalness: 0.6 })); mast.position.set(0, 2.5, 0); mast.castShadow = true; g.add(mast);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshBasicMaterial({ color: C.ok.clone().multiplyScalar(2.2) })); tip.position.y = 5.1; g.add(tip);
    this.scene.add(g); this.baseTop = v3(bx, by, 5.1);
    this.label('BASE', 'Base', 'swarm-l-base');
  }

  buildLinks() {
    const mk = (width) => { const geo = new LineSegmentsGeometry(); const cap = 96; geo.setPositions(new Float32Array(cap * 6)); geo.setColors(new Float32Array(cap * 6)); geo.instanceCount = 0;
      const mat = new LineMaterial({ linewidth: width, vertexColors: true, transparent: true, opacity: 0.9, depthTest: false }); const l = new LineSegments2(geo, mat); l.frustumCulled = false; l.renderOrder = 5; this.scene.add(l); return l; };
    this.backbone = mk(2.0); this.uplinks = mk(1.2);
    this.packets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }), 400); this.packets.count = 0; this.packets.frustumCulled = false; this.packets.renderOrder = 6;
    this.packets.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(400 * 3), 3); this.scene.add(this.packets);
    this.beaconGeo = { foot: new THREE.CylinderGeometry(0.34, 0.42, 0.22, 16), mast: new THREE.CylinderGeometry(0.035, 0.035, 2.4, 6), tip: new THREE.SphereGeometry(0.17, 14, 10), ring: new THREE.RingGeometry(0.9, 1.0, 40).rotateX(-Math.PI / 2), hit: new THREE.SphereGeometry(1.4, 8, 6) };
    this.beaconMat = { body: new THREE.MeshStandardMaterial({ color: this.sh.C.silver.clone().multiplyScalar(0.6), roughness: 0.5, metalness: 0.4 }) };
  }
  buildGoals() {
    const C = this.sh.C; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 6), 3)); g.setDrawRange(0, 0);
    this.goalLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: C.accent, transparent: true, opacity: 0.5, depthTest: false })); this.goalLines.frustumCulled = false; this.goalLines.renderOrder = 4; this.scene.add(this.goalLines);
    const dg = new THREE.RingGeometry(0.55, 0.8, 4).rotateX(-Math.PI / 2);
    this.goalMarks = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({ color: C.accent.clone().multiplyScalar(1.5), transparent: true, opacity: 0.95, depthTest: false }), 16); this.goalMarks.count = 0; this.goalMarks.frustumCulled = false; this.goalMarks.renderOrder = 4; this.scene.add(this.goalMarks);
  }
  buildTruth() { // debug layer: the hidden map, written into the blue channel of the state texture
    const w = this.world; for (let k = 0; k < W * H; k++) this.stateArr[k * 4 + 2] = w.solid[k] && w.solid[k] !== T.EDGE ? 255 : 0;
    this.gu.uTruth = { value: new THREE.Color(0, 0, 0) }; this.truthMarks = new THREE.Group(); this.truthMarks.visible = false; this.scene.add(this.truthMarks);
    for (const tg of w.targets) { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), new THREE.MeshBasicMaterial({ color: this.sh.C.sim, wireframe: true })); m.position.copy(v3(tg.pos[0], tg.pos[1], 1.2)); m.userData.tg = tg; this.truthMarks.add(m); }
  }

  label(id, text, cls) {
    let l = this.labels.get(id);
    if (!l) { l = { el: document.createElement('div'), text: '', cls: '' }; l.el.className = 'swarm-label'; this.labelHost.append(l.el); this.labels.set(id, l); }
    if (l.text !== text) { l.el.textContent = text; l.text = text; }
    if (cls !== undefined && l.cls !== cls) { l.el.className = 'swarm-label ' + cls; l.cls = cls; }
    return l;
  }
  dropLabel(id) { const l = this.labels.get(id); if (l) { l.el.remove(); this.labels.delete(id); } }

  makeRover(r) {
    const C = this.sh.C, g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const silver = new THREE.MeshStandardMaterial({ color: C.silver, roughness: 0.35, metalness: 0.75 }), dark = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.8 });
    const ch = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.44), silver); ch.position.y = 0.2; ch.castShadow = true; body.add(ch);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.1, 0.3), dark); deck.position.y = 0.31; body.add(deck);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.09, 14).rotateX(Math.PI / 2), dark); wh.position.set(sx * 0.21, 0.1, sz * 0.27); wh.castShadow = true; body.add(wh); }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 6), silver); mast.position.set(-0.12, 0.52, 0); body.add(mast);
    const lidar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 16), dark); lidar.position.set(0.1, 0.4, 0); body.add(lidar);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: C.accent })); lamp.position.set(-0.12, 0.72, 0); body.add(lamp);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.74, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0.95, depthTest: false })); ring.position.y = 0.05; ring.renderOrder = 3; g.add(ring);
    const range = this.rangeRing(PARAMS.rover.lidar, C.scan, 0.16);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), new THREE.MeshBasicMaterial({ visible: false })); hit.userData.pick = { type: 'robot', id: r.id }; g.add(hit);
    return { g, body, ring, lamp, range, hit, kind: 'rover', alt: 0 };
  }
  makeDrone(r) {
    const C = this.sh.C, g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const silver = new THREE.MeshStandardMaterial({ color: C.silver, roughness: 0.35, metalness: 0.7 }), dark = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.7 });
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), silver); hub.castShadow = true; body.add(hub);
    const rotors = [];
    for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.06), dark); arm.position.set(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3); arm.rotation.y = -a; body.add(arm);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C.silver, transparent: true, opacity: 0.22, side: THREE.DoubleSide })); disc.position.set(Math.cos(a) * 0.6, 0.07, Math.sin(a) * 0.6); body.add(disc); rotors.push(disc);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.01, 0.04), dark); blade.position.copy(disc.position); body.add(blade); rotors.push(blade);
    }
    const cam = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), dark); cam.position.y = -0.12; body.add(cam);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: C.accent })); lamp.position.set(-0.26, 0.1, 0); body.add(lamp);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C.scan, transparent: true, opacity: 0.8, depthTest: false })); ring.position.y = 0.05; ring.renderOrder = 3; g.add(ring);
    const tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: C.scan, transparent: true, opacity: 0.28 })); g.add(tether);
    const range = this.rangeRing(PARAMS.drone.footprint, C.scan, 0.2);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), new THREE.MeshBasicMaterial({ visible: false })); hit.userData.pick = { type: 'robot', id: r.id }; body.add(hit);
    return { g, body, ring, lamp, range, hit, rotors, tether, kind: 'drone', alt: 0 };
  }
  rangeRing(radius, color, opacity) {
    const grp = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.07, radius, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity * 2.2, depthWrite: false }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity * 0.22, depthWrite: false }));
    grp.add(ring, disc); grp.position.y = 0.06; return grp;
  }
  makeBeacon(b) {
    const C = this.sh.C, g = new THREE.Group(); g.position.copy(v3(b.x, b.y));
    const foot = new THREE.Mesh(this.beaconGeo.foot, this.beaconMat.body); foot.position.y = 0.11; foot.castShadow = true; g.add(foot);
    const mast = new THREE.Mesh(this.beaconGeo.mast, this.beaconMat.body); mast.position.y = 1.3; g.add(mast);
    const tip = new THREE.Mesh(this.beaconGeo.tip, new THREE.MeshBasicMaterial({ color: C.ok.clone().multiplyScalar(2) })); tip.position.y = 2.5; g.add(tip);
    const ring = new THREE.Mesh(this.beaconGeo.ring, new THREE.MeshBasicMaterial({ color: C.ok, transparent: true, opacity: 0.9, depthWrite: false })); ring.position.y = 0.05; g.add(ring);
    const hit = new THREE.Mesh(this.beaconGeo.hit, new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 1.2; hit.userData.pick = { type: 'relay', id: b.id }; g.add(hit);
    this.scene.add(g); return { g, tip, ring, born: this.time, alive: true };
  }
  makeLead(l) {
    const C = this.sh.C, g = new THREE.Group(); g.position.copy(v3(l.pos[0], l.pos[1]));
    const mat = new THREE.MeshBasicMaterial({ color: C.warn, transparent: true, opacity: 0.9, depthTest: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 8), mat); beam.position.y = 2.1; g.add(beam);
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), mat); head.position.y = 4.5; g.add(head);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.42, 48).rotateX(-Math.PI / 2), mat); ring.position.y = 0.07; g.add(ring);
    const pulse = new THREE.Mesh(new THREE.RingGeometry(0.94, 1.0, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C.warn, transparent: true, opacity: 0.6, depthTest: false })); pulse.position.y = 0.08; g.add(pulse);
    for (const o of g.children) o.renderOrder = 4;
    this.scene.add(g); return { g, mat, head, ring, pulse, status: '' };
  }

  // paint from engine state
  syncAll() { const kn = this.swarm.state.known; for (let k = 0; k < W * H; k++) if (kn[k]) this.cell(k, kn[k], true); if (this.swarm.state.changed) this.swarm.state.changed.length = 0; this.texDirty = true; }
  cell(k, v, instant) {
    const w = this.world; this.stateArr[k * 4] = (v === K.FREE ? (w.indoor[k] ? 2 : 1) : v === K.OCC ? 3 : 4) * 50;
    this.knownArr[k] = v === K.ROOF ? 0 : 255;
    if (this.birthArr[k] < -50 || v !== K.ROOF) this.birthArr[k] = instant ? -10 : this.time;
    if (v === K.OCC) this.addWall(k, instant);
  }
  update(dt, speedScale) {
    const S = this.swarm.state, C = this.sh.C, sh = this.sh; this.time += dt; this.gu.uTime.value = this.time;
    if (S.changed && S.changed.length) { for (const k of S.changed) this.cell(k, S.known[k], false); S.changed.length = 0; this.texDirty = true; }
    // frontiers into the green channel
    if (this.clusterRef !== S.clusters) { this.clusterRef = S.clusters; if (this.frontCells) for (const k of this.frontCells) this.stateArr[k * 4 + 1] = 0; this.frontCells = []; for (const c of S.clusters) for (const k of c.cells) { this.stateArr[k * 4 + 1] = 255; this.frontCells.push(k); } this.texDirty = true; }
    if (this.texDirty) { this.stateTex.needsUpdate = this.knownTex.needsUpdate = this.birthTex.needsUpdate = true; this.texDirty = false; }
    if (this.wallsDirty) { this.walls.instanceMatrix.needsUpdate = true; this.walls.instanceColor.needsUpdate = true; this.wallBirth.needsUpdate = true; this.wallsDirty = false; }

    const camDist = sh.camera.position.distanceTo(sh.controls.target), iconScale = THREE.MathUtils.clamp(camDist / 34, 1.6, 4.2);
    const lerp = Math.min(1, dt * (6 + speedScale * 0.6));
    let gi = 0; const gp = this.goalLines.geometry.attributes.position.array;
    for (const r of S.robots) {
      let o = this.robots.get(r.id);
      if (!o) { o = r.kind === 'drone' ? this.makeDrone(r) : this.makeRover(r); o.x = r.x; o.y = r.y; o.h = r.heading; o.lx = r.x; o.ly = r.y; this.scene.add(o.g, o.range); this.robots.set(r.id, o); }
      o.x += (r.x - o.x) * lerp; o.y += (r.y - o.y) * lerp;
      let dh = r.heading - o.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); o.h += dh * Math.min(1, dt * 8);
      const flying = r.kind === 'drone' && !['done', 'swap', 'dead', 'standby'].includes(r.mode);
      o.alt += ((flying ? PARAMS.drone.alt : 0.25) - o.alt) * Math.min(1, dt * 2.5);
      o.g.position.set(o.x, 0, -o.y); o.body.position.y = r.kind === 'drone' ? o.alt : 0; o.body.rotation.y = o.h; o.body.scale.setScalar(iconScale);
      if (o.rotors && flying) for (let q = 1; q < o.rotors.length; q += 2) o.rotors[q].rotation.y += dt * 60;
      if (o.tether) { o.tether.scale.y = Math.max(0.01, o.alt); o.tether.visible = flying; }
      const col = r.mode === 'lead' || r.mode === 'listen' ? C.warn : r.mode === 'regroup' || r.mode === 'dead' ? C.danger : r.mode === 'swap' || r.mode === 'return' ? C.ok : r.mode === 'done' ? C.text3 : C.accent;
      o.ring.material.color.copy(col); o.lamp.material.color.copy(col).multiplyScalar(2.2); o.ring.scale.setScalar(iconScale * (this.selected === r.id ? 1.35 + 0.12 * Math.sin(this.time * 6) : 1));
      o.range.position.set(o.x, 0.06, -o.y); o.range.visible = sh.layers.range && (r.mode === 'explore' || r.mode === 'lead' || r.mode === 'regroup' || r.mode === 'return' || r.mode === 'home');
      if (r.mode === 'listen') { const s = 1 + ((this.time * 0.8) % 1) * 2.2; o.range.visible = true; o.range.scale.setScalar(s * 0.3); } else o.range.scale.setScalar(1);
      // trail painted on the ground
      const moved = Math.hypot(o.x - o.lx, o.y - o.ly);
      if (moved > 0.25) { const t = this.tctx; if (moved < 12) { t.strokeStyle = r.kind === 'drone' ? 'rgba(191,224,255,0.20)' : sh.trailStyle; t.lineWidth = r.kind === 'drone' ? 2.2 : 3.4; t.beginPath(); t.moveTo(o.lx * TRAIL_PX, (SY - o.ly) * TRAIL_PX); t.lineTo(o.x * TRAIL_PX, (SY - o.y) * TRAIL_PX); t.stroke(); this.trailDirty = true; } o.lx = o.x; o.ly = o.y; }
      // where it is heading
      if (sh.layers.goals && r.goal && !r.goal.home && (r.mode === 'explore' || r.mode === 'lead') && gi < 16) { gp.set([o.x, r.kind === 'drone' ? o.alt : 0.5, -o.y, r.goal.x, 0.3, -r.goal.y], gi * 6); this._m.compose(this._p.set(r.goal.x, 0.09, -r.goal.y), this._q.identity(), this._s.setScalar(iconScale * 0.62)); this.goalMarks.setMatrixAt(gi, this._m); gi++; }
      const mode = { explore: '', lead: 'to lead', listen: 'listening', return: 'to base', swap: 'swap', regroup: 'no link', home: 'done', done: '', dead: 'empty' }[r.mode] || '';
      const l = this.label(r.id, r.id + (mode ? ' · ' + mode : ''), 'swarm-l-robot' + (this.selected === r.id ? ' sel' : '') + (r.mode === 'regroup' || r.mode === 'dead' ? ' bad' : r.mode === 'lead' || r.mode === 'listen' ? ' warn' : '') + (r.mode === 'done' ? ' off' : ''));
      l.pos = this._lp(l, o.x, (r.kind === 'drone' ? o.alt : 0) + 0.9 * iconScale, -o.y);
    }
    this.goalLines.geometry.setDrawRange(0, gi * 2); this.goalLines.geometry.attributes.position.needsUpdate = true; this.goalMarks.count = gi; this.goalMarks.instanceMatrix.needsUpdate = true;
    if (this.trailDirty) { this.trailTex.needsUpdate = true; this.trailDirty = false; }

    // beacons
    for (const b of S.relays) {
      let o = this.relays.get(b.id); if (!o) { o = this.makeBeacon(b); this.relays.set(b.id, o); }
      const age = this.time - o.born, col = !b.alive ? C.danger : b.connected === false ? C.warn : C.ok;
      o.tip.material.color.copy(col).multiplyScalar(b.alive ? 2 : 0.7); o.ring.material.color.copy(col);
      o.g.scale.setScalar(THREE.MathUtils.clamp(camDist / 60, 1, 2.2) * Math.min(1, age * 4));
      const p = age < 1.2 ? age / 1.2 : 1; o.ring.scale.setScalar(age < 1.2 ? 1 + p * 5 : 1); o.ring.material.opacity = age < 1.2 ? 0.9 * (1 - p) + 0.25 : b.alive ? 0.5 : 0.9;
      if (!b.alive) o.g.rotation.z = Math.min(1.35, (o.g.rotation.z || 0) + dt * 3);
    }
    // mesh links
    const top = (id) => { if (id === 'BASE') return this.baseTop; const b = this.relays.get(id); if (b) return this._p2.set(b.g.position.x, 2.5 * b.g.scale.x, b.g.position.z); const r = this.robots.get(id); return r ? this._p2.set(r.x, (r.kind === 'drone' ? r.alt : 0) + 0.72 * iconScale, -r.y) : this.baseTop; };
    this._p2 = this._p2 || new THREE.Vector3();
    let nb = 0, nu = 0, np = 0;
    const B = this.backbone.geometry, Ug = this.uplinks.geometry, bp = B.attributes.instanceStart.data.array, bc = B.attributes.instanceColorStart.data.array, up = Ug.attributes.instanceStart.data.array, uc = Ug.attributes.instanceColorStart.data.array;
    if (sh.layers.mesh) for (const L of S.links) {
      const a = top(L.a).clone(), b = top(L.b).clone(); const col = L.rssi > -83 ? C.ok : L.rssi > -86.5 ? C.warn : C.danger, back = L.kind === 'backbone';
      const arr = back ? bp : up, carr = back ? bc : uc, n = back ? nb++ : nu++; if (n >= 96) continue;
      arr.set([a.x, a.y, a.z, b.x, b.y, b.z], n * 6); const k = back ? 0.95 : 0.6; carr.set([col.r * k, col.g * k, col.b * k, col.r * k, col.g * k, col.b * k], n * 6);
      if (!sh.reduced) { const cnt = back ? 2 : 1, len = a.distanceTo(b); for (let q = 0; q < cnt && np < 400; q++) { const f = (this.time * (9 / Math.max(4, len)) + q / cnt + hash(n * 13 + (back ? 7 : 1))) % 1; this._m.compose(this._p.lerpVectors(a, b, f), this._q.identity(), this._s.setScalar(iconScale * (back ? 0.36 : 0.28))); this.packets.setMatrixAt(np, this._m); this._c.copy(col).multiplyScalar(2.0); this.packets.setColorAt(np, this._c); np++; } }
    }
    B.instanceCount = Math.min(96, nb); Ug.instanceCount = Math.min(96, nu); B.attributes.instanceStart.data.needsUpdate = true; B.attributes.instanceColorStart.data.needsUpdate = true; Ug.attributes.instanceStart.data.needsUpdate = true; Ug.attributes.instanceColorStart.data.needsUpdate = true;
    this.packets.count = np; this.packets.instanceMatrix.needsUpdate = true; if (np) this.packets.instanceColor.needsUpdate = true;
    this.backbone.visible = this.uplinks.visible = this.packets.visible = sh.layers.mesh;

    // leads
    for (const l of S.leads) {
      let o = this.leads.get(l.id); if (!o) { o = this.makeLead(l); this.leads.set(l.id, o); }
      const col = l.status === 'confirmed' ? C.person : l.status === 'rejected' ? C.text3 : C.warn;
      o.mat.color.copy(col).multiplyScalar(l.status === 'confirmed' ? 1.9 : l.status === 'rejected' ? 0.7 : 1.5); o.pulse.material.color.copy(col);
      const live = l.status !== 'rejected'; const f = (this.time * (l.status === 'confirmed' ? 0.9 : 0.6)) % 1;
      o.pulse.visible = live && !sh.reduced; o.pulse.scale.setScalar(1 + f * 4); o.pulse.material.opacity = 0.7 * (1 - f);
      o.head.rotation.y += dt * 1.2; o.g.scale.setScalar(THREE.MathUtils.clamp(camDist / 70, 0.8, 1.9) * (l.status === 'rejected' ? 0.6 : 1));
      const txt = l.status === 'confirmed' ? 'Person · ' + Math.round(l.p * 100) + ' %' : l.status === 'rejected' ? 'Ruled out' : l.status === 'open' ? 'Possible · ' + Math.round(l.p * 100) + ' % · needs a person' : 'Lead ' + l.id.slice(1) + ' · ' + Math.round(l.p * 100) + ' %' + (l.winner ? ' · ' + l.winner : '');
      const lb = this.label(l.id, txt, 'swarm-l-lead ' + (l.status === 'confirmed' ? 'person' : l.status === 'rejected' ? 'off' : 'warn'));
      lb.pos = this._lp(lb, l.pos[0], 5.2 * o.g.scale.x, -l.pos[1]);
    }
    const bl = this.labels.get('BASE'); bl.pos = this._lp(bl, this.world.base[0], 5.9, -this.world.base[1]);
    this.truthMarks.visible = sh.layers.truth; this.gu.uTruth.value.copy(sh.layers.truth ? C.sim : this._c.setRGB(0, 0, 0));
    this.gu.uTrailOn.value = sh.layers.trails ? 1 : 0; this.gu.uPulse.value = sh.reduced ? 0.6 : 1;
    this.goalLines.visible = this.goalMarks.visible = sh.layers.goals;
  }
  _lp(l, x, y, z) { l.w = l.w || new THREE.Vector3(); l.w.set(x, y, z); return l.w; }
  placeLabels(rect) { // rect: this view's box in CSS pixels
    const cam = this.sh.camera, v = this._lv || (this._lv = new THREE.Vector3());
    this.labelHost.style.cssText = 'left:' + rect.x + 'px;top:' + rect.y + 'px;width:' + rect.w + 'px;height:' + rect.h + 'px';
    const placed = this._placed || (this._placed = []); placed.length = 0;
    const order = [...this.labels.values()].sort((a, b) => (b.cls.includes('lead') ? 2 : b.cls.includes('base') ? 0 : 1) - (a.cls.includes('lead') ? 2 : a.cls.includes('base') ? 0 : 1));
    for (const l of order) {
      if (!l.w) { l.el.style.display = 'none'; continue; }
      v.copy(l.w).project(cam); const ok = v.z < 1 && v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.05;
      l.el.style.display = ok ? '' : 'none'; if (!ok) continue;
      const x = (v.x * 0.5 + 0.5) * rect.w, y0 = (-v.y * 0.5 + 0.5) * rect.h, wpx = l.text.length * 6.4 + 16, hpx = 20; let y = y0 - 8, lift = 0;
      for (let t = 0; t < 5; t++) { if (!placed.some((p) => Math.abs(p.x - x) < (p.w + wpx) / 2 && Math.abs(p.y - y) < hpx)) break; y -= hpx + 1; lift += hpx + 1; }
      placed.push({ x, y, w: wpx });
      l.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-100%)'; if (l.lift !== lift) { l.lift = lift; l.el.style.setProperty('--lift', lift + 8 + 'px'); }
    }
  }
  fadeTrails() { const t = this.tctx; t.save(); t.globalCompositeOperation = 'destination-out'; t.fillStyle = 'rgba(0,0,0,0.035)'; t.fillRect(0, 0, this.trailCanvas.width, this.trailCanvas.height); t.restore(); this.trailDirty = true; }
  robotPos(id) { const o = this.robots.get(id); return o ? v3(o.x, o.y, o.kind === 'drone' ? o.alt * 0.3 : 0) : null; }
  dispose() {
    this.labelHost.remove();
    this.scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose?.()); });
    for (const t of [this.stateTex, this.knownTex, this.birthTex, this.trailTex]) t.dispose();
  }
}

class ViewsPass extends Pass {
  constructor(draw) { super(); this.draw = draw; this.needsSwap = false; this.clear = true; }
  render(renderer, writeBuffer, readBuffer) { this.draw(this.renderToScreen ? null : readBuffer); }
}

// ---------------------------------------------------------------------------------------------------------
export function createScene(host, { kit, onPick }) {
  const C = tokenColors(kit);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.autoClear = false;
  const canvas = renderer.domElement; canvas.className = 'swarm-canvas'; canvas.setAttribute('aria-label', '3-D view of the sandbox site. Drag to orbit, scroll to zoom, click a robot to follow it or a beacon to fail it.'); canvas.tabIndex = 0; host.append(canvas);
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 900);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 10; controls.maxDistance = 330; controls.zoomSpeed = 0.8;
  const sh = { C, host, camera, controls, layers: { mesh: true, trails: true, range: true, goals: true, truth: false }, reduced: kit.reducedMotion(), trailStyle: 'rgba(90,169,255,0.55)' };
  { const a = C.accent.clone().convertLinearToSRGB(); sh.trailStyle = 'rgba(' + Math.round(a.r * 255) + ',' + Math.round(a.g * 255) + ',' + Math.round(a.b * 255) + ',0.5)'; }
  let views = [], size = { w: 1, h: 1 }, mode = 'overview', follow = null, lastTouch = -1e9, clock = 0, fadeAcc = 0, composer = null, bloom = null, disposed = false;
  const goal = { pos: new THREE.Vector3(), target: new THREE.Vector3(), active: false };
  const centre = new THREE.Vector3(SX / 2, 0, -SY / 2);

  const rects = () => { const n = views.length || 1, gap = n > 1 ? 2 : 0, w = (size.w - gap * (n - 1)) / n; return Array.from({ length: n }, (_, i) => ({ x: i * (w + gap), y: 0, w, h: size.h })); };
  // Frame the whole site: push the camera back along a fixed direction until every corner is inside the view,
  // leaving room for the overlays, then centre it. Works for any viewport shape (the race view is narrow).
  const probe = new THREE.PerspectiveCamera(30, 1, 1, 900), corners = [];
  for (const hgt of [0, 2.2]) for (const [x, y] of [[0, 0], [SX, 0], [SX, SY], [0, SY]]) corners.push(v3(x, y, hgt));
  function frameSite(kind) {
    const r = rects()[0], aspect = r.w / r.h; camera.aspect = aspect; camera.updateProjectionMatrix();
    const el = THREE.MathUtils.degToRad(kind === 'plan' ? 89.5 : aspect < 1.15 ? 58 : 47), az = kind === 'plan' ? 0 : -0.2;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    const pad = { l: 0.05, r: 0.05, t: Math.min(0.2, 34 / r.h), b: Math.min(0.2, 46 / r.h) };   // share of the view kept clear on each side
    const tgt = centre.clone(), p = new THREE.Vector3(), right = new THREE.Vector3(), fwd = new THREE.Vector3(); let d = 160;
    probe.fov = camera.fov; probe.aspect = aspect; probe.updateProjectionMatrix();
    const vf = THREE.MathUtils.degToRad(camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    for (let it = 0; it < 28; it++) {
      probe.position.copy(tgt).addScaledVector(dir, d); probe.lookAt(tgt); probe.updateMatrixWorld();
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (const c of corners) { p.copy(c).project(probe); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      const aw = 2 - 2 * (pad.l + pad.r), ah = 2 - 2 * (pad.t + pad.b), scale = Math.max((x1 - x0) / aw, (y1 - y0) / ah);
      const ex = (x0 + x1) / 2 - (pad.l - pad.r), ey = (y0 + y1) / 2 - (pad.b - pad.t);
      right.setFromMatrixColumn(probe.matrixWorld, 0); right.y = 0; right.normalize(); fwd.setFromMatrixColumn(probe.matrixWorld, 1); fwd.y = 0; fwd.normalize();
      tgt.addScaledVector(right, ex * d * Math.tan(hf / 2) * 0.9).addScaledVector(fwd, (ey * d * Math.tan(vf / 2) * 0.9) / Math.max(0.35, Math.sin(el)));
      d *= 1 + (scale - 1) * 0.85;
    }
    goal.target.copy(tgt); goal.pos.copy(tgt).addScaledVector(dir, d); goal.active = true;
  }
  function setCamera(m, id) { mode = m; follow = m === 'follow' ? id : null; if (m !== 'follow') frameSite(m); else goal.active = false; for (const v of views) v.selected = follow; }
  controls.addEventListener('start', () => { lastTouch = clock; goal.active = false; });

  function drawViews(target) {
    const pr = renderer.getPixelRatio(), rs = rects();
    renderer.setRenderTarget(target); if (target) { target.scissorTest = false; target.viewport.set(0, 0, target.width, target.height); renderer.setRenderTarget(target); } else { renderer.setScissorTest(false); renderer.setViewport(0, 0, size.w, size.h); }
    renderer.setClearColor(C.bg2, 1); renderer.clear();
    views.forEach((v, i) => {
      const r = rs[i]; camera.aspect = r.w / r.h; camera.updateProjectionMatrix();
      for (const l of [v.backbone, v.uplinks]) l.material.resolution.set(r.w, r.h);
      if (target) { target.viewport.set(r.x * pr, 0, r.w * pr, r.h * pr); target.scissor.set(r.x * pr, 0, r.w * pr, r.h * pr); target.scissorTest = true; renderer.setRenderTarget(target); }
      else { renderer.setViewport(r.x, 0, r.w, r.h); renderer.setScissor(r.x, 0, r.w, r.h); renderer.setScissorTest(true); }
      renderer.render(v.scene, camera);
    });
    if (target) { target.scissorTest = false; target.viewport.set(0, 0, target.width, target.height); } else renderer.setScissorTest(false);
  }
  function buildComposer() {
    try {
      const pr = renderer.getPixelRatio();
      const rt = new THREE.WebGLRenderTarget(size.w * pr, size.h * pr, { type: THREE.HalfFloatType, samples: 4 });
      composer = new EffectComposer(renderer, rt); composer.setPixelRatio(pr); composer.setSize(size.w, size.h);
      composer.addPass(new ViewsPass(drawViews));
      bloom = new UnrealBloomPass(new THREE.Vector2(size.w, size.h), 0.42, 0.55, 0.92); composer.addPass(bloom);
      composer.addPass(new OutputPass());
    } catch (e) { console.warn('[swarm] bloom unavailable, drawing without it', e); composer = null; }
  }
  function resize() {
    const r = host.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    size = { w: Math.round(r.width), h: Math.round(r.height) }; renderer.setSize(size.w, size.h, false); canvas.style.width = size.w + 'px'; canvas.style.height = size.h + 'px';
    if (composer) composer.setSize(size.w, size.h); else buildComposer();
    if (mode !== 'follow' && clock - lastTouch > 1) { frameSite(mode); camera.position.copy(goal.pos); controls.target.copy(goal.target); goal.active = false; }
  }
  const ro = new ResizeObserver(resize); ro.observe(host);

  function setSwarms(swarms, tags = []) {
    for (const v of views) v.dispose(); views = swarms.map((s, i) => new View(sh, s, tags[i] || ''));
    for (const v of views) v.selected = follow;
    if (mode !== 'follow') { frameSite(mode); if (clock < 0.5) { camera.position.copy(goal.pos); controls.target.copy(goal.target); goal.active = false; } }
  }
  function frame(dt, speedScale = 1) {
    if (disposed || !views.length) return; clock += dt; sh.reduced = kit.reducedMotion();
    for (const v of views) v.update(dt, speedScale);
    fadeAcc += dt * Math.min(40, speedScale); if (fadeAcc > 30) { fadeAcc = 0; for (const v of views) v.fadeTrails(); }
    if (mode === 'follow' && follow) { const p = views[0].robotPos(follow); if (p) { const d = p.clone().sub(controls.target); controls.target.addScaledVector(d, Math.min(1, dt * 3)); camera.position.addScaledVector(d, Math.min(1, dt * 3)); const dist = camera.position.distanceTo(controls.target); if (dist > 62) camera.position.lerp(controls.target.clone().add(camera.position.clone().sub(controls.target).setLength(46)), Math.min(1, dt * 2)); } }
    else if (goal.active) { const k = 1 - Math.exp(-dt * 3.2); camera.position.lerp(goal.pos, k); controls.target.lerp(goal.target, k); if (camera.position.distanceTo(goal.pos) < 0.05) goal.active = false; }
    else if (mode === 'overview' && !sh.reduced && clock - lastTouch > 8) { const a = Math.sin(clock * 0.07) * 0.0009; const off = camera.position.clone().sub(controls.target); off.applyAxisAngle(THREE.Object3D.DEFAULT_UP, a); camera.position.copy(controls.target).add(off); }
    controls.update();
    if (composer) composer.render(dt); else drawViews(null);
    const rs = rects(); views.forEach((v, i) => { camera.aspect = rs[i].w / rs[i].h; camera.updateProjectionMatrix(); camera.updateMatrixWorld(); v.placeLabels(rs[i]); });
  }
  // picking
  const ray = new THREE.Raycaster(), down = { x: 0, y: 0 };
  canvas.addEventListener('pointerdown', (e) => { down.x = e.clientX; down.y = e.clientY; });
  canvas.addEventListener('pointerup', (e) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, rs = rects(), i = rs.findIndex((r) => x >= r.x && x <= r.x + r.w); if (i < 0) return;
    const r = rs[i]; camera.aspect = r.w / r.h; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    ray.setFromCamera(new THREE.Vector2(((x - r.x) / r.w) * 2 - 1, -(y / r.h) * 2 + 1), camera);
    const hits = ray.intersectObjects(views[i].scene.children, true).filter((h) => h.object.userData.pick);
    if (hits.length) onPick?.({ ...hits[0].object.userData.pick, view: i });
  });
  return {
    canvas, setSwarms, frame, resize, setCamera, cameraMode: () => mode, rects,
    setLayer(name, on) { sh.layers[name] = on; }, layers: () => ({ ...sh.layers }),
    select(id) { for (const v of views) v.selected = id; },
    hasBloom: () => !!composer,
    dispose() { disposed = true; ro.disconnect(); for (const v of views) v.dispose(); views = []; controls.dispose(); composer?.dispose?.(); renderer.dispose(); canvas.remove(); },
  };
}
