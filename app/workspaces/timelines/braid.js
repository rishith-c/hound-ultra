// Timelines, Demo: five runs of one rescue, drawn as light. Height is time. Each block of ground is one world at one
// moment; the threads under it are where its rover, team, drone and leads have been, taken from the recorded runs.
import * as THREE from 'three';
import { createIslands, lx, lz, K } from './island.js';
import { hydrate, F } from './forkset.js';

const TS = 0.058;                                                  // scene units per second of mission
const DEST = { flown: [0, 4.5], ignore: [-30.5, -1], dismiss: [-15, 0.5], skip: [14.4, 3], thermal: [28, -4] };
const NF = 26, STEP = 3;                                           // filaments per world, seconds per sample
const smooth = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * u * (u * (6 * u - 15) + 10); };
const lerp = (a, b, u) => a + (b - a) * u;
// Story clock: [real second, mission second]
const STORY = [[0, 22], [3.2, 62], [6.2, 118], [9, 206], [11.4, 258], [15, 360], [18, 412], [21.5, 432], [24.5, 486], [30, 600], [34, 712], [43, 712]];
export const STORY_END = 43, HOLD_AT = 34;
export function missionAt(u) { for (let i = 1; i < STORY.length; i++) if (u <= STORY[i][0]) { const [a, b] = STORY[i - 1], [c, d] = STORY[i]; return lerp(b, d, (u - a) / (c - a)); } return STORY[STORY.length - 1][1]; }
export function storyAt(t) { for (let i = 1; i < STORY.length; i++) if (t <= STORY[i][1]) { const [a, b] = STORY[i - 1], [c, d] = STORY[i]; return d === b ? a : lerp(a, c, (t - b) / (d - b)); } return HOLD_AT; }
// Camera: [mission second, position relative to the trunk's head, look-at relative to it, field of view]
const CAM = [
  [0, [9.6, 5.4, 14.6], [-1.6, -1.2, 0.2], 30], [70, [9.4, 5.6, 16.6], [-2.6, -2.2, 0], 30], [125, [3, 7, 27], [-5.4, -4.4, -1], 31], [205, [-4, 8, 28], [-3.2, -4.8, 0], 31],
  [265, [4, 10.5, 35], [2.8, -6.2, 0], 31], [350, [2.4, 6.4, 21], [-0.8, -3.2, 2], 30], [385, [-1.5, 6.8, 24.5], [-3.2, -3.6, 2.5], 30], [416, [4.2, 6.4, 22], [1.0, -2.8, 4], 30], [445, [8, 9.6, 32], [4.2, -5.6, 2], 30], [500, [8, 14, 46], [1.5, -8.4, 0], 31], [600, [4, 15.5, 60], [0, -10.4, 0], 31], [712, [0.5, 15.5, 72], [-0.6, -12.6, 0], 31],
];

export async function createBraid(canvas, set, { onState, onPick, reduced }) {
  const worlds = hydrate(set), n = worlds.length, trunk = worlds[0], tEnd = Math.max(...worlds.map((w) => w.endT));
  const best = worlds.reduce((b, w) => (w.reached > b.reached || (w.reached === b.reached && w.endT < b.endT) ? w : b), worlds[0]), bestI = worlds.indexOf(best);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.22; renderer.info.autoReset = true;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1.8, 0.5, 260), FOG = new THREE.Color(0x0b0f14);
  scene.fog = new THREE.FogExp2(FOG, 0.0078);

  // ---------- light ----------
  { const es = new THREE.Scene(), mk = (c, i, w, h, p) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i), side: THREE.DoubleSide })); m.position.set(...p); m.lookAt(0, 0, 0); es.add(m); };
    es.background = new THREE.Color(0x10151b); mk(0xdfeaf5, 7, 9, 5, [-8, 9, 5]); mk(0x6d8fb5, 2.2, 14, 3, [8, 2.5, -9]); mk(0x0b0d10, 1, 30, 30, [0, -9, 0]); mk(0xffffff, 1.2, 4, 12, [10, 5, 6]);
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(es, 0.05).texture; scene.environmentIntensity = 0.85; pm.dispose(); }
  const key = new THREE.DirectionalLight(0xf3f1ec, 4.4); key.position.set(-8.6, 9.5, 6.2); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fa6d6, 2.1); rim.position.set(9, 3.4, -10); scene.add(rim);

  const isl = await createIslands(renderer, n);
  for (const m of isl.all) scene.add(m);

  // ---------- where a world's column stands at a given second ----------
  const dur = worlds.map((w) => Math.min(104, (w.endT - w.forkT) * 0.8));
  const trunkZ = (t) => DEST.flown[1] * smooth((t - 60) / 180), o2 = [0, 0];
  const off = (i, t, out) => { if (i === 0) { out[0] = 0; out[1] = trunkZ(t); return out; } const d = DEST[worlds[i].id] || [0, 0], u = smooth((t - worlds[i].forkT) / dur[i]); out[0] = d[0] * u; out[1] = lerp(trunkZ(t), d[1], u); return out; };

  // ---------- ribbons ----------
  const pos = [], dir = [], rad = [], meta = [], idx = []; // meta: t, side, world*16+kind, seed
  const KIND = { fil: 0, rover: 1, team: 2, drone: 3, lead: 4, conf: 5, reach: 6, frame: 7, body: 8 };
  function strip(samples, w, kind, seed) { // samples: [x, y, z, t, radx, radz]
    if (samples.length < 2) return; const b = pos.length / 3;
    for (let i = 0; i < samples.length; i++) { const s = samples[i], a = samples[Math.max(0, i - 1)], c = samples[Math.min(samples.length - 1, i + 1)]; let dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2]; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      for (const sd of [-1, 1]) { pos.push(s[0], s[1], s[2]); dir.push(dx, dy, dz); rad.push(s[4] || 0, s[5] || 0); meta.push(s[3], sd, w * 16 + kind, seed); }
      if (i) { const q = b + i * 2; idx.push(q - 2, q - 1, q, q - 1, q + 1, q); } }
  }
  const R = ((s) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; })(9127);
  for (let w = 0; w < n; w++) {
    const wd = worlds[w], e = wd.endT;
    for (let f = 0; f < NF; f++) { // the strand: thin filaments wound round the column; before its fork a world winds round the trunk
      const ph0 = (w / n) * 6.283, fr = f / NF + (R() - 0.5) * 0.06, tw = 0.0215, r0 = 0.72 + R() * 0.62, el = 0.7 + R() * 0.35, S = [];
      const t1 = e; for (let t = 0; ; t += STEP) { const tt = Math.min(t, t1); off(w, tt, o2); const free = smooth((tt - Math.max(wd.forkT, w ? 0 : 200) - 10) / 150), loose = free * 0.45, a = ph0 + fr * lerp(1.25, 6.283, free) + tt * tw + Math.sin(tt * 0.013 + f) * 0.3, rr = r0 * (1 + loose * Math.sin(tt * 0.021 + f * 1.7)); S.push([o2[0], tt * TS, o2[1], tt, Math.cos(a) * rr, Math.sin(a) * rr * el]); if (t >= t1) break; }
      strip(S, w, KIND.fil, R());
    }
    { const S = []; for (let t = wd.forkT; ; t += 4) { const tt = Math.min(t, e); off(w, tt, o2); S.push([o2[0], tt * TS, o2[1], tt]); if (t >= e) break; } strip(S, w, KIND.body, w * 0.17); }
    const from = Math.floor(wd.forkT), FR = wd.frames;
    const line = (ox, oy, h, kind) => { let S = []; for (let k = Math.max(0, from); k < wd.n; k += 1) { const t = Math.min(k, e); off(w, t, o2); S.push([o2[0] + lx(FR[k * F.W + ox]), t * TS + h, o2[1] + lz(FR[k * F.W + oy]), t]); } strip(S, w, kind, w * 0.2); };
    line(F.RX, F.RY, 0.05, KIND.rover); line(F.TX, F.TY, 0.05, KIND.team);
    { const S = []; for (let k = from; k < wd.n && k < 150; k++) { off(w, k, o2); S.push([o2[0] + lx(FR[k * F.W + F.DX]), k * TS + 0.1, o2[1] + lz(FR[k * F.W + F.DY]), k]); } strip(S, w, KIND.drone, 0.5); }
    for (const L of wd.leads) { // a lead is a thin amber thread, a confirmed or reached person is a warm one, a closed lead just stops
      const seg = (t0, t1, kind) => { if (t0 == null) return; t0 = Math.max(t0, wd.forkT); t1 = Math.min(t1, e); if (t1 <= t0 + 1) return; const S = []; for (let t = t0; ; t += 2) { const tt = Math.min(t, t1); off(w, tt, o2); S.push([o2[0] + lx(L.pos[0]), tt * TS + 0.04, o2[1] + lz(L.pos[1]), tt]); if (t >= t1) break; } strip(S, w, kind, 0.3); };
      const c = L.confirmed ?? L.reached, stop = L.closed ?? e;
      if (L.open != null) seg(L.open, Math.min(c ?? stop, stop), KIND.lead);
      if (c != null) seg(c, e, KIND.conf); if (L.reached != null) seg(L.reached, e, KIND.reach);
    }
    for (let t = Math.ceil((wd.forkT + (w ? 24 : 0)) / 60) * 60; t < e - 8; t += 60) { off(w, t, o2); const X = 6, Z = 4.5, y = t * TS, l = 0.7; for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const px = o2[0] + sx * X, pz = o2[1] + sz * Z; strip([[px - sx * l, y, pz, t], [px, y, pz, t]], w, KIND.frame, 0); strip([[px, y, pz, t], [px, y, pz - sz * l, t]], w, KIND.frame, 0); } }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3)); rg.setAttribute('aRad', new THREE.Float32BufferAttribute(rad, 2)); rg.setAttribute('aM', new THREE.Float32BufferAttribute(meta, 4)); rg.setIndex(idx);
  const U = { uHead: { value: new Float32Array(n) }, uLum: { value: new Float32Array(n).fill(1) }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uTS: { value: TS }, uFog: { value: 0.0085 }, uPix: { value: 1 } };
  const rm = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    vertexShader: /* glsl */'\nattribute vec3 aDir; attribute vec2 aRad; attribute vec4 aM; uniform float uHead[' + n + ']; uniform float uLum[' + n + ']; uniform vec2 uRes; uniform float uTS, uPix; varying float vS, vU, vK, vL, vF, vD, vSeed, vA, vT;\n' +
      'void main(){ vT = smoothstep(-6.0, 26.0, aM.x); float wk = aM.z; int w = int(floor(wk / 16.0 + 0.001)); vK = floor(wk - float(w) * 16.0 + 0.5); float head = uHead[w]; vU = head - aM.x; vL = uLum[w]; vSeed = aM.w; vS = aM.y;\n' +
      'vec3 p = position; float under = max(0.0, vU) * uTS; if (vK < 0.5) { float flare = exp(-under / 1.5) * 2.9; p.xz += aRad * vec2(1.0 + flare * 1.25, 1.0 + flare); p.y -= exp(-under / 0.35) * 0.66; } else if (vK < 6.5) p.y -= exp(-under / 0.02) * 0.0;\n' +
      'vec4 c0 = projectionMatrix * modelViewMatrix * vec4(p, 1.0), c1 = projectionMatrix * modelViewMatrix * vec4(p + aDir * 0.05, 1.0); vec2 s0 = c0.xy / c0.w, s1 = c1.xy / c1.w; vec2 d = (s1 - s0) * uRes; float l = length(d); d = l > 1e-6 ? d / l : vec2(0.0, 1.0);\n' +
      'float wd = vK < 0.5 ? 0.11 : vK < 1.5 ? 0.2 : vK < 2.5 ? 0.2 : vK < 3.5 ? 0.09 : vK < 4.5 ? 0.16 : vK < 5.5 ? 0.34 : vK < 6.5 ? 0.62 : vK < 7.5 ? 0.06 : 2.3; float px = wd * projectionMatrix[1][1] * uRes.y * 0.5 / c0.w; float mn = (vK > 3.5 && vK < 6.5 ? 5.5 : vK < 0.5 ? 3.6 : vK > 6.5 ? 2.6 : 4.6) * uPix; vA = min(1.0, px / mn); px = max(px, mn); vA = mix(vA, 1.0, vK > 3.5 && vK < 6.5 ? 0.9 : 0.4);\n' +
      'c0.xy += vec2(-d.y, d.x) * vS * px / uRes * c0.w; vF = exp(-c0.w * 0.0075); vD = c0.w; gl_Position = c0; }',
    fragmentShader: /* glsl */'\nuniform float uTime, uTS; varying float vS, vU, vK, vL, vF, vD, vSeed, vA, vT;\n' +
      'void main(){ if (vU < 0.0) discard; float x = abs(vS); float core = smoothstep(0.34, 0.06, x), halo = pow(max(0.0, 1.0 - x), 2.6); float fresh = exp(-vU / 16.0), old = 0.32 + 0.68 * exp(-vU / 210.0); vec3 c; float a;\n' +
      'if (vK < 0.5) { float p = fract(vU * 0.0105 - uTime * (0.16 + vSeed * 0.1) + vSeed * 7.0); p = pow(1.0 - p, 26.0); c = mix(vec3(0.36, 0.47, 0.6), vec3(0.82, 0.9, 1.0), vSeed); a = (core * 0.75 + halo * 0.34) * (0.2 + 0.6 * vSeed * vSeed) * old + p * (core + halo * 0.7) * 1.15; a *= vL; a *= 1.0 + fresh * 1.1; }\n' +
      'else if (vK < 1.5) { c = vec3(0.93, 0.96, 1.0); a = (core * 0.8 + halo * 0.3) * old * vL; }\n' +
      'else if (vK < 2.5) { c = vec3(0.3, 0.62, 1.0); a = (core * 0.9 + halo * 0.4) * old * vL; }\n' +
      'else if (vK < 3.5) { c = vec3(0.6, 0.72, 0.84); a = (core * 0.5 + halo * 0.15) * 0.5 * old * vL; }\n' +
      'else if (vK < 4.5) { c = vec3(1.0, 0.66, 0.2); a = (core * 0.9 + halo * 0.4) * step(0.42, fract(vU * 0.11)) * 0.6 * mix(0.5, 1.0, vL); }\n' +
      'else if (vK < 5.5) { c = vec3(1.0, 0.36, 0.17); a = (core * 1.15 + halo * 0.45) * mix(0.55, 1.1, vL) * (0.9 + 0.1 * sin(uTime * 2.4 + vU * 0.05)); c = mix(c, vec3(1.0, 0.82, 0.66), core * 0.45); }\n' +
      'else if (vK < 6.5) { c = vec3(1.0, 0.4, 0.2); a = (core * 0.8 + halo * 0.5) * mix(0.5, 1.1, vL); c = mix(c, vec3(1.0, 0.9, 0.78), core * 0.6); }\n' +
      'else if (vK > 7.5) { c = vec3(0.34, 0.5, 0.7); float g = exp(-x * x * 5.5) * (1.0 - x); a = g * 0.4 * vL * (0.4 + 0.6 * exp(-vU / 260.0)) * (1.0 + 0.4 * pow(0.5 + 0.5 * sin(vU * 0.04 - uTime * 0.8 + vSeed * 9.0), 4.0)) * smoothstep(2.0, 24.0, vU); } else { c = vec3(0.6, 0.7, 0.82); a = (core * 0.6 + halo * 0.15) * 0.5 * vL * (0.35 + 0.65 * exp(-vU / 160.0)); }\n' +
      'a *= vF * vA * vT * smoothstep(0.0, 1.5, vU); gl_FragColor = vec4(c * a, 1.0); }' });
  const ribbons = new THREE.Mesh(rg, rm); ribbons.frustumCulled = false; ribbons.renderOrder = 5; scene.add(ribbons);

  // ---------- lamps ----------
  const NP = n * 9, lp = new Float32Array(NP * 3), lc = new Float32Array(NP * 3), ls = new Float32Array(NP), lg = new THREE.BufferGeometry();
  const aP = new THREE.BufferAttribute(lp, 3).setUsage(THREE.DynamicDrawUsage), aC = new THREE.BufferAttribute(lc, 3).setUsage(THREE.DynamicDrawUsage), aS = new THREE.BufferAttribute(ls, 1).setUsage(THREE.DynamicDrawUsage);
  lg.setAttribute('position', aP); lg.setAttribute('aC', aC); lg.setAttribute('aS', aS);
  const lm = new THREE.ShaderMaterial({ uniforms: { uRes: U.uRes }, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: 'attribute vec3 aC; attribute float aS; uniform vec2 uRes; varying vec3 vC; void main(){ vec4 p = modelViewMatrix * vec4(position, 1.0); vC = aC * exp(p.z * 0.006); gl_Position = projectionMatrix * p; gl_Position.z -= 0.004 * gl_Position.w; gl_PointSize = aS * projectionMatrix[1][1] * uRes.y * 0.5 / gl_Position.w; }',
    fragmentShader: 'varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; float g = pow(1.0 - d, 2.6), k = smoothstep(0.16, 0.02, d); gl_FragColor = vec4(vC * (g * 0.75 + k * 1.2), 1.0); }' });
  const lamps = new THREE.Points(lg, lm); lamps.frustumCulled = false; lamps.renderOrder = 6; scene.add(lamps);
  const lamp = (i, x, y, z, r, g, b, s) => { lp[i * 3] = x; lp[i * 3 + 1] = y; lp[i * 3 + 2] = z; lc[i * 3] = r; lc[i * 3 + 1] = g; lc[i * 3 + 2] = b; ls[i] = s; };

  // Pools of warm light on the ground where someone was found; the drone's survey sheet; the listening ring.
  const decalTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), q = g.createRadialGradient(64, 64, 0, 64, 64, 64); q.addColorStop(0, 'rgba(255,255,255,1)'); q.addColorStop(0.25, 'rgba(255,255,255,.5)'); q.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = q; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const dg = new THREE.PlaneGeometry(1, 1); dg.rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 }), n * 5); pools.frustumCulled = false; pools.renderOrder = 4; for (let i = 0; i < n * 5; i++) pools.setColorAt(i, new THREE.Color(0, 0, 0)); scene.add(pools);
  const ringG = new THREE.RingGeometry(0.985, 1, 96); ringG.rotateX(-Math.PI / 2);
  const rings = new THREE.InstancedMesh(ringG, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }), n * 2); rings.frustumCulled = false; rings.renderOrder = 4; scene.add(rings);
  const sheetM = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uA: { value: 0 } }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'varying vec2 vUv; uniform float uA; void main(){ float e = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x); float b = pow(1.0 - vUv.y, 3.0) * 0.5 + smoothstep(0.02, 0.0, vUv.y) * 1.6; gl_FragColor = vec4(vec3(0.62, 0.8, 1.0) * b * e * uA, 1.0); }' });
  const sheetG = new THREE.BufferGeometry(); sheetG.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3).setUsage(THREE.DynamicDrawUsage)); sheetG.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2)); sheetG.setIndex([0, 1, 2, 1, 3, 2]); const sheet = new THREE.Mesh(sheetG, sheetM); sheet.frustumCulled = false; sheet.renderOrder = 5; scene.add(sheet);
  // Where someone was never reached: an unlit ring, shown only in the labelled reveal at the end.
  const lostG = new THREE.RingGeometry(0.2, 0.235, 48); lostG.rotateX(-Math.PI / 2);
  const lost = new THREE.InstancedMesh(lostG, new THREE.MeshBasicMaterial({ color: 0xb79cff, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false }), n * 3); lost.frustumCulled = false; lost.renderOrder = 7; scene.add(lost);

  // ---------- the valley behind: haze and ridges ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { uC: { value: 0 } }, vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'varying vec3 vP; float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); } void main(){ vec3 d = normalize(vP); float y = d.y; vec3 c = mix(vec3(0.052, 0.068, 0.088), vec3(0.011, 0.015, 0.021), smoothstep(-0.1, 0.42, y)); c = mix(c, vec3(0.03, 0.038, 0.047), smoothstep(-0.06, -0.5, y)); float g = exp(-pow((y + 0.02) * 7.0, 2.0)); float s = exp(-pow((atan(d.x, -d.z) + 0.55) * 1.3, 2.0)); c += vec3(0.06, 0.077, 0.095) * g * (0.35 + s); c += (h(gl_FragCoord.xy) - 0.5) / 200.0; gl_FragColor = vec4(pow(max(c, 0.0), vec3(0.4545 * 1.55)), 1.0); }' }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
  const ridges = new THREE.Group(); scene.add(ridges);
  for (let k = 0; k < 4; k++) {
    const N = 720, rad0 = 176 - k * 18, g = new THREE.BufferGeometry(), v = [], ii = [], s = 11 + k * 7.3;
    const nz = (a) => { let y = 0; for (const [f, m, q] of [[3, 0.5, 1], [7, 0.3, 2.1], [13, 0.2, 1.7], [29, 0.1, 3.3], [61, 0.05, 0.4], [127, 0.028, 5], [253, 0.014, 2]]) y += (f < 20 ? 0.75 - Math.abs(Math.sin(a * f * 0.5 + s * q)) * 1.5 : Math.sin(a * f + s * q)) * m; return y; };
    for (let i = 0; i <= N; i++) { const a = (i / N) * 6.28319, y = 3.5 - k * 4.6 + nz(a) * (15 - k * 1.4) + Math.pow(Math.abs(Math.sin(a * 0.5 + 1.571 + 0.08)), 0.8) * 2 + (1 - Math.pow(Math.abs(Math.cos(a * 0.5 + 0.785)), 2)) * 3, x = Math.sin(a) * rad0, z = -Math.cos(a) * rad0; v.push(x, y, z, x, -110, z); if (i) { const q = i * 2; ii.push(q - 2, q - 1, q, q - 1, q + 1, q); } }
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(ii); const sh = 0.115 - k * 0.019;
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ depthWrite: false, side: THREE.DoubleSide, uniforms: { c: { value: new THREE.Color(sh * 0.74, sh * 0.9, sh * 1.08) } }, vertexShader: 'varying float y; void main(){ y = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'varying float y; uniform vec3 c; float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); } void main(){ float f = smoothstep(16.0, -22.0, y), d = smoothstep(-30.0, -84.0, y); gl_FragColor = vec4(mix(c * (0.5 + 1.15 * f), vec3(0.042, 0.052, 0.064), d) + (h(gl_FragCoord.xy) - 0.5) / 190.0, 1.0); }' }));
    m.renderOrder = -9 + k; m.frustumCulled = false; ridges.add(m);
  }
  // dust in the air
  const NM = 420, mp = new Float32Array(NM * 4); for (let i = 0; i < NM; i++) { mp[i * 4] = R(); mp[i * 4 + 1] = R(); mp[i * 4 + 2] = R(); mp[i * 4 + 3] = R(); }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NM * 3), 3)); mg.setAttribute('aR', new THREE.BufferAttribute(mp, 4));
  const mm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: U.uTime, uC: { value: new THREE.Vector3() }, uRes: U.uRes }, vertexShader: 'attribute vec4 aR; uniform float uTime; uniform vec3 uC; uniform vec2 uRes; varying float vA; void main(){ vec3 b = vec3(34.0, 20.0, 30.0); vec3 p = aR.xyz * b + vec3(uTime * 0.16 * (aR.w - 0.3), -uTime * 0.1 * (0.4 + aR.w), uTime * 0.08); p = mod(p - uC, b) - b * 0.5 + uC; vec4 q = projectionMatrix * modelViewMatrix * vec4(p, 1.0); vA = smoothstep(1.5, 5.0, q.w) * smoothstep(24.0, 10.0, q.w) * (0.2 + 0.8 * aR.w); gl_Position = q; gl_PointSize = (0.008 + aR.w * 0.014) * projectionMatrix[1][1] * uRes.y * 0.5 / q.w; }', fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vec3(0.75, 0.85, 0.95) * vA * 0.2 * pow(max(0.0, 1.0 - d), 1.5), 1.0); }' });
  const motes = new THREE.Points(mg, mm); motes.frustumCulled = false; scene.add(motes);

  // ---------- per frame ----------
  const st = { u: 0, t: STORY[0][1], playing: true, focus: -1, dragging: false, yaw: 0, pitch: 0, yawV: 0 };
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), ZERO = new THREE.Vector3(0, 0, 0), col = new THREE.Color(), I4 = new THREE.Quaternion();
  const lumNow = new Float32Array(n).fill(1), heads = new Float32Array(n), cx = new Float32Array(n), cy = new Float32Array(n), cz = new Float32Array(n), shown = new Float32Array(n);
  const camP = new THREE.Vector3(), camL = new THREE.Vector3(), tp = new THREE.Vector3(), tl = new THREE.Vector3(), scr = new THREE.Vector3(); let fov = 30, snapped = false;
  const state = { t: 0, u: 0, hold: 0, worlds: worlds.map((w, i) => ({ id: w.id, name: w.name, i, x: 0, y: 0, depth: 0, on: false, reached: 0, ended: false, endT: w.endT, total: w.people.length, finalReached: w.reached, forkT: w.forkT, best: i === bestI })), focus: -1 };
  const at = (w, t, k) => { const f = w.frames, a = Math.max(0, Math.min(w.n - 1, Math.floor(t))), b = Math.min(w.n - 1, a + 1), u = Math.min(1, Math.max(0, t - a)); return lerp(f[a * F.W + k], f[b * F.W + k], u); };
  function camKeys(t, outP, outL) { let i = 1; while (i < CAM.length - 1 && CAM[i][0] < t) i++; const a = CAM[i - 1], b = CAM[i], u0 = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0]))), u = u0 * u0 * (3 - 2 * u0); for (let k = 0; k < 3; k++) { outP.setComponent(k, lerp(a[1][k], b[1][k], u)); outL.setComponent(k, lerp(a[2][k], b[2][k], u)); } return lerp(a[3], b[3], u); }
  function place(mesh, i, x, y, z, ry, sc) { V.set(x, y, z); Q.setFromAxisAngle(UP, ry); S.setScalar(sc); mesh.setMatrixAt(i, M.compose(V, Q, S)); }
  function update(dt, time) {
    const t = st.t, hold = smooth((st.u - HOLD_AT + 0.4) / 2.2), reveal = hold; state.t = t; state.u = st.u; state.hold = hold; state.focus = st.focus;
    for (let w = 0; w < n; w++) {
      const wd = worlds[w], vis = t >= wd.forkT, h = Math.min(t, wd.endT), ended = t >= wd.endT; heads[w] = Math.min(t, wd.endT); off(w, h, o2);
      const bob = 0; cx[w] = o2[0]; cy[w] = h * TS + bob; cz[w] = o2[1];
      const gone = w === 0 ? 0 : Math.hypot(cx[w], cz[w] - trunkZ(h)), form = w === 0 ? 1 : smooth((gone - 8.6) / 4.4); shown[w] = vis ? form : 0;
      const lostSome = wd.reached < wd.people.length, dark = ended && lostSome ? (wd.reached === 1 ? 0.2 : 0.34) : ended && w !== bestI ? 0.78 : 1, lumTo = (w === bestI && hold > 0 ? 1 + 0.75 * hold : dark) * (st.focus >= 0 && st.focus !== w ? 0.5 : 1) * (st.focus === w ? Math.max(1, 1) / Math.max(0.5, 1) * 1.0 + (dark < 1 ? 0.25 : 0) : 1);
      lumNow[w] += (lumTo - lumNow[w]) * (snapped ? 1 - Math.exp(-dt * 1.5) : 1);
      U.uHead.value[w] = heads[w]; U.uLum.value[w] = lumNow[w]; isl.lum.array[w] = Math.min(1.18, Math.max(0.1, lumNow[w])); isl.dis.array[w] = shown[w];
      const sc = shown[w] > 0.001 ? 1 : 0, y = cy[w] - 0.012 * w * (1 - form);
      place(isl.ground, w, cx[w], y, cz[w], 0, sc); place(isl.sides, w, cx[w], y, cz[w], 0, sc); place(isl.build, w, cx[w], y, cz[w], 0, sc);
      const rx = cx[w] + lx(at(wd, h, F.RX)), rz = cz[w] + lz(at(wd, h, F.RY)), k = Math.min(wd.n - 1, Math.floor(h)), rh = wd.frames[k * F.W + F.RH];
      place(isl.rover, w, rx, y, rz, rh, sc); const dz = at(wd, h, F.DZ), dx = cx[w] + lx(at(wd, h, F.DX)), dzz = cz[w] + lz(at(wd, h, F.DY)), dy = y + 0.06 + dz * 0.062;
      place(isl.drone, w, dx, dy, dzz, time * 0.1, sc * 1.25); const tx = cx[w] + lx(at(wd, h, F.TX)), tz = cz[w] + lz(at(wd, h, F.TY)); place(isl.team, w, tx, y, tz, 0, sc);
      const L = lumNow[w] * Math.max(shown[w], vis ? 0.75 : 0), b = w * 9;
      lamp(b, rx + Math.cos(rh) * 0.2, y + 0.16, rz - Math.sin(rh) * 0.2, 0.75 * L, 0.85 * L, 1 * L, 0.8); lamp(b + 1, tx, y + 0.3, tz, 0.25 * L, 0.55 * L, 1 * L, 1.1); lamp(b + 2, dx, dy, dzz, 0.5 * L, 0.7 * L, 0.9 * L, dz > 0.5 ? 0.9 : 0);
      const ln = wd.frames[k * F.W + F.LISTEN] > 0 && !ended; for (let q = 0; q < 2; q++) { const f = ((time * 0.35 + q * 0.5) % 1), r = ln ? 0.65 * f : 0; V.set(rx, y + 0.08, rz); S.set(Math.max(1e-4, r), 1, Math.max(1e-4, r)); rings.setMatrixAt(w * 2 + q, M.compose(V, I4, S)); col.setRGB(0.6, 0.8, 1).multiplyScalar((1 - f) * L); rings.setColorAt(w * 2 + q, col); }
      let np = 0, rc = 0;
      for (let j = 0; j < 5; j++) { const Ld = wd.leads[j]; let a = 0, warm = 0, px = 0, pz = 0;
        if (Ld && vis) { const c = Ld.confirmed == null ? Ld.reached : Math.min(Ld.confirmed, Ld.reached ?? 1e9); px = cx[w] + lx(Ld.pos[0]); pz = cz[w] + lz(Ld.pos[1]); if (c != null && h >= c) { a = Math.min(1, (h - c) / 5); warm = 1; } else if (Ld.open != null && h >= Ld.open && !(Ld.closed != null && h >= Ld.closed)) a = 0.34 + 0.16 * Math.sin(time * 4); if (Ld.reached != null && h >= Ld.reached) { rc++; a *= 1.25; } }
        const g = a * Math.max(shown[w], vis ? 0.45 : 0) * (warm ? Math.max(0.62, lumNow[w]) : Math.max(0.25, lumNow[w])), pulse = warm ? 1 + 0.06 * Math.sin(time * 2.2 + j) : 1;
        V.set(px, y + 0.03, pz); S.setScalar(g > 0.001 ? (warm ? 2.1 : 1.1) * pulse : 0.0001); pools.setMatrixAt(w * 5 + j, M.compose(V, I4, S)); if (warm) col.setRGB(1, 0.3, 0.12).multiplyScalar(g * 0.85); else col.setRGB(1, 0.6, 0.15).multiplyScalar(g * 0.55); pools.setColorAt(w * 5 + j, col);
        if (np < 3 && Ld && (Ld.confirmed != null || Ld.reached != null)) { const on = warm ? a : 0; place(isl.people, w * 3 + np, px, y + 0.02, pz, j * 1.3, on > 0.01 && shown[w] > 0.4 ? 1.15 : 0); col.setRGB(1, 0.46, 0.24).multiplyScalar(0.4 + 1.2 * g); isl.people.setColorAt(w * 3 + np, col); lamp(b + 3 + np, px, y + 0.16, pz, 0.8 * g, 0.27 * g, 0.11 * g, (st.focus === w ? 1.1 : 1.9) * pulse); np++; } }
      for (; np < 3; np++) { place(isl.people, w * 3 + np, 0, -999, 0, 0, 0); lamp(b + 3 + np, 0, -999, 0, 0, 0, 0, 0); }
      for (let j = 0; j < 3; j++) { const p = wd.people[j], miss = p.reached == null && shown[w] > 0; V.set(cx[w] + lx(p.pos[0]), y + 0.16, cz[w] + lz(p.pos[1])); S.setScalar(miss && reveal > 0.01 ? 1.6 + 0.9 * (1 - reveal) : 0.0001); lost.setMatrixAt(w * 3 + j, M.compose(V, I4, S)); lamp(b + 6 + j, V.x, V.y + 0.1, V.z, 0.5 * reveal, 0.4 * reveal, 0.9 * reveal, miss ? 1.3 : 0); }
      const so = state.worlds[w]; so.reached = rc; so.ended = ended; so.on = shown[w] > 0.55;
    }
    lost.material.opacity = reveal;
    { // the drone's survey sheet
      const a = t < 104 ? smooth((t - 4) / 6) * smooth((102 - t) / 8) : 0; sheetM.uniforms.uA.value = a * 0.55; if (a > 0.001) { const sp = sheetG.attributes.position, x = cx[0] + lx(at(trunk, t, F.DX)), z = cz[0] + lz(at(trunk, t, F.DY)), top = cy[0] + 0.06 + at(trunk, t, F.DZ) * 0.062, w2 = 1.15; sp.setXYZ(0, x, cy[0] + 0.02, z - w2); sp.setXYZ(1, x, cy[0] + 0.02, z + w2); sp.setXYZ(2, x, top, z - 0.04); sp.setXYZ(3, x, top, z + 0.04); sp.needsUpdate = true; } }
    for (const m of isl.all) m.instanceMatrix.needsUpdate = true; isl.lum.needsUpdate = isl.dis.needsUpdate = true; isl.people.instanceColor.needsUpdate = pools.instanceColor.needsUpdate = true; rings.instanceColor.needsUpdate = true; pools.instanceMatrix.needsUpdate = rings.instanceMatrix.needsUpdate = lost.instanceMatrix.needsUpdate = true; aP.needsUpdate = aC.needsUpdate = aS.needsUpdate = true;
    // camera
    let f;
    if (st.focus >= 0) { const w = st.focus, a = 0.02 + Math.sin(time * 0.16) * 0.26 + st.yaw; tp.set(cx[w] + 0.6 + Math.sin(a) * 13.2, cy[w] + 6.6 + st.pitch * 8, cz[w] + Math.cos(a) * 13.2); tl.set(cx[w] - 0.5, cy[w] - 1.5, cz[w]); f = 31; }
    else { f = camKeys(t, tp, tl); const hy = Math.min(t, 690) * TS, a = Math.sin(time * 0.21) * 0.028 + hold * Math.sin((st.u - HOLD_AT) * 0.16) * 0.06 + st.yaw; const wide = cam.aspect < 1.8 ? 1.8 / cam.aspect : 1; tp.sub(tl).multiplyScalar(wide); const c = Math.cos(a), s = Math.sin(a), x = tp.x * c + tp.z * s, z = -tp.x * s + tp.z * c; tp.set(x, tp.y, z).add(tl); tp.y += st.pitch * tp.distanceTo(tl) * 0.5; tp.y += hy; tl.y += hy; }
    const kk = snapped ? 1 - Math.exp(-dt * (st.focus >= 0 || st.recover > 0 ? 2.2 : 5)) : 1; if (st.recover > 0) st.recover -= dt; snapped = true;
    camP.lerp(tp, kk); camL.lerp(tl, kk); fov += (f - fov) * kk; cam.position.copy(camP); cam.lookAt(camL); if (Math.abs(cam.fov - fov) > 0.001) { cam.fov = fov; cam.updateProjectionMatrix(); }
    sky.position.copy(camP); ridges.position.set(camP.x, camP.y - 15 - 24 * smooth((t - 90) / 420), camP.z); mm.uniforms.uC.value.copy(camP).addScaledVector(V.subVectors(camL, camP).normalize(), 14); U.uTime.value = time;
    cam.updateMatrixWorld();
    for (let w = 0; w < n; w++) { scr.set(cx[w], cy[w] + 1.5, cz[w] - 2.4).project(cam); const so = state.worlds[w]; state.vw = vw; so.x = (scr.x * 0.5 + 0.5) * vw; so.y = (-scr.y * 0.5 + 0.5) * vh; so.depth = scr.z; scr.set(cx[w], cy[w] - 0.9, cz[w] + 4.6).project(cam); so.fx = (scr.x * 0.5 + 0.5) * vw; so.fy = (-scr.y * 0.5 + 0.5) * vh; }
  }
  let vw = 1, vh = 1, ratio = 1, maxRatio = 1;
  function resize() { const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return; vw = r.width; vh = r.height; maxRatio = Math.min(1.75, Math.max(1, devicePixelRatio || 1)); if (ratio > maxRatio || ratio === 1) ratio = maxRatio; apply(); }
  function apply() { renderer.setPixelRatio(ratio); renderer.setSize(vw, vh, false); cam.aspect = vw / vh; cam.updateProjectionMatrix(); U.uRes.value.set(vw * ratio, vh * ratio); U.uPix.value = ratio; }
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

  // ---------- loop ----------
  let raf = 0, last = 0, time = 0, fade = 1, slow = 0, quick = 0;
  function draw(dt) { update(dt, time); renderer.render(scene, cam); onState?.(state, st); }
  function loop(now) {
    raf = requestAnimationFrame(loop); const raw = last ? (now - last) / 1000 : 0.016, dt = Math.min(0.05, raw); last = now; time += dt;
    if (st.playing && !st.dragging) { st.u += dt; if (st.u > STORY_END && st.focus < 0) { st.u = 0; st.loops = 1; snapped = false; for (let w = 0; w < n; w++) lumNow[w] = 1; } else if (st.u > STORY_END) st.u = STORY_END; }
    if (st.focus >= 0) { st.u = Math.max(st.u, HOLD_AT); if (st.u > HOLD_AT + 6) st.u = HOLD_AT + 6; }
    st.t = missionAt(st.u); if (!st.dragging) { st.yaw *= Math.exp(-dt * 0.5); st.pitch *= Math.exp(-dt * 0.5); }
    { const f = st.focus >= 0 ? 1 : Math.min(1, (STORY_END - st.u) / 0.7, st.loops ? st.u / 0.7 : 1); const o = Math.max(0, f); if (Math.abs(o - fade) > 0.004) { fade = o; canvas.style.opacity = o >= 0.996 ? '' : o.toFixed(3); canvas.style.transition = 'none'; } }
    draw(dt);
    if (raw > 0.0195 && raw < 0.2) { slow++; quick = 0; } else { quick++; if (slow > 0 && quick % 4 === 0) slow--; }
    if (slow > 14 && ratio > 0.9) { ratio = Math.max(0.85, ratio * 0.86); slow = 0; apply(); }
  }
  // Compile every program before the first frame, so the first second does not stutter.
  update(0, 0); await renderer.compileAsync(scene, cam).catch(() => renderer.compile(scene, cam));
  const hit = (px, py) => { let b = -1, bd = 1e9; for (const s of state.worlds) { if (!s.on) continue; const cxp = s.x, cyp = (s.y + s.fy) / 2, d = Math.hypot((px - cxp), (py - cyp) * 1.4); if (d < bd) { bd = d; b = s.i; } } const s = state.worlds[b]; return b >= 0 && bd < Math.max(70, Math.abs(s.fy - s.y) * 1.5) ? b : -1; };
  const api = {
    state, worlds, bestI, get ratio() { return ratio; }, st,
    start() { if (raf) return; last = 0; if (reduced()) { st.u = HOLD_AT + 4; st.t = missionAt(st.u); time = 1; snapped = false; draw(1); return; } raf = requestAnimationFrame(loop); },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    still() { if (!raf) { snapped = false; draw(1); } },
    play(on) { st.playing = on; }, seek(u) { st.u = u; st.t = missionAt(u); if (!raf) { snapped = false; draw(1); } },
    focus(i) { st.focus = i; st.recover = 1.6; if (i >= 0) st.u = Math.max(st.u, HOLD_AT + 2); st.t = missionAt(st.u); if (!raf) { snapped = false; draw(1); } },
    hit, dispose() { api.stop(); ro.disconnect(); isl.dispose(); rg.dispose(); rm.dispose(); renderer.dispose(); },
  };
  // drag: turn the camera; click: go to a world
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY, st.yaw, st.pitch, false]; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); if (!down) { canvas.style.cursor = hit(e.clientX - r.left, e.clientY - r.top) >= 0 ? 'pointer' : 'grab'; return; } const dx = e.clientX - down[0], dy = e.clientY - down[1]; if (Math.hypot(dx, dy) > 4) down[4] = st.dragging = true; if (down[4]) { st.yaw = Math.max(-0.9, Math.min(0.9, down[2] - dx * 0.004)); st.pitch = Math.max(-0.25, Math.min(0.7, down[3] + dy * 0.004)); canvas.style.cursor = 'grabbing'; } });
  const up = (e) => { if (down && !down[4] && e.type === 'pointerup') { const r = canvas.getBoundingClientRect(); onPick?.(hit(e.clientX - r.left, e.clientY - r.top)); } down = null; st.dragging = false; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  return api;
}
