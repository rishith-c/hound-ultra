// The real valley around the site. Heights are the real elevation of Timure, Rasuwa (data/twin_terrain.bin, baked from
// the same elevation tiles as the Valley workspace); the Bhote Koshi's course and some house footprints are from
// OpenStreetMap. Two liberties: the 186 x 108 m pad under the exercise is levelled, and extra houses and trees are invented.
import * as THREE from 'three';
import { GROUND } from './textures.js';
import { photoTri } from './photos.js';
import { rng, makeNoise, smooth, clamp, instanced, matrix, merge, box, tint, tube, mesh, xform } from './util.js';

const PAD = [-34, -6, 152, 102];
export async function loadTerrain() {
  const base = new URL('../../data/', import.meta.url);
  try {
    const [meta, buf] = await Promise.all([fetch(new URL('twin_terrain.json', base)).then((r) => { if (!r.ok) throw new Error('terrain'); return r.json(); }), fetch(new URL('twin_terrain.bin', base)).then((r) => { if (!r.ok) throw new Error('terrain'); return r.arrayBuffer(); })]);
    return { ...meta, h: new Int16Array(buf) };
  } catch (e) { console.warn('[twin] real terrain did not load, using a plain valley:', e); return { n: [0, 0], h: null, town: [], river: [] }; }
}

export function makeHeights(D) {
  const n = makeNoise('terrain'), [nx, ny] = D.n;
  const B = (t) => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6];
  function real(x, y) {
    if (!D.h) { const e = Math.max(0, x - 60), w = Math.max(0, -x - 220); return e * 0.62 + w * 0.7 - 62 * smooth(-30, -140, x); }
    const gx = clamp((x - D.x0) / D.cell, 1, nx - 3), gy = clamp((D.yTop - y) / D.cell, 1, ny - 3), i = Math.floor(gx), j = Math.floor(gy), bx = B(gx - i), by = B(gy - j); let s = 0;
    for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) s += D.h[(j - 1 + b) * nx + i - 1 + a] * bx[a] * by[b];
    return s / 10;
  }
  const river = D.river.length ? D.river : Array.from({ length: 60 }, (_, i) => [-158 + 20 * Math.sin(i / 5), 1400 - i * 48, -62 - i * 0.2]);
  function riverAt(x, y) { let best = 1e9, z = 0; for (let i = 0; i + 1 < river.length; i++) { const a = river[i], b = river[i + 1]; if (Math.abs(a[1] - y) > 260) continue; const dx = b[0] - a[0], dy = b[1] - a[1], t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1), d = Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t); if (d < best) { best = d; z = a[2] + (b[2] - a[2]) * t; } } return [best, z]; }
  const padDist = (x, y) => { const dx = Math.max(PAD[0] - x, x - PAD[2], 0), dy = Math.max(PAD[1] - y, y - PAD[3], 0); return Math.hypot(dx, dy); };
  function slide(x, y) { const t = (x - 88) * 0.75 + (y - 58) * 0.66, s = -(x - 88) * 0.66 + (y - 58) * 0.75, w = 13 + t * 0.13; return smooth(-10, 30, t) * smooth(520, 320, t) * smooth(w * 1.25, w * 0.7, Math.abs(s) + (n(x / 14, y / 14) - 0.5) * 14); }
  function at(x, y) {
    const d = padDist(x, y); if (d <= 0) return 0;
    let h = real(x, y) * smooth(0, 105, d) * (0.35 + 0.65 * smooth(0, 60, d));
    const k = smooth(8, 220, d); h += (n.fbm(x / 46 + 9, y / 46 + 4, 4) - 0.5) * 15 * k + (n.fbm(x / 11, y / 11, 3) - 0.5) * 2.2 * smooth(3, 40, d);
    h -= slide(x, y) * (3 + n(x / 9, y / 9) * 2.4) * smooth(4, 40, d);
    const [rd, rz] = riverAt(x, y); if (rd < 90) { const bed = rz - 2.6 + smooth(17, 30, rd) * 3.4 + smooth(28, 90, rd) * 60 + (n.fbm(x / 7, y / 7, 3) - 0.5) * 3.2 * smooth(16, 26, rd); h = Math.min(h, bed); }
    return h;
  }
  return { at, river, riverAt, padDist, slide, noise: n };
}

// ---- the ground and hillside material ----
function groundMaterial(env, macro) {
  const P = env.photos, mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true });
  const U = { tMud: { value: P.mud.map }, tMudN: { value: P.mud.normalMap }, tRub: { value: P.rubble.map }, tRubN: { value: P.rubble.normalMap }, tWet: { value: P.wet.map }, tWetN: { value: P.wet.normalMap }, tCliff: { value: P.cliff.map }, tForest: { value: P.forest.map }, uWetAvg: { value: P.wet.avg }, uCliffAvg: { value: P.cliff.avg }, uForAvg: { value: P.forest.avg }, tMacro: { value: macro.map }, tMacroR: { value: macro.roughnessMap }, tMask: { value: macro.mask },
    uMudAvg: { value: P.mud.avg }, uRubAvg: { value: P.rubble.avg }, uBox: { value: new THREE.Vector3(GROUND.x0, GROUND.y0, GROUND.size) }, uTime: { value: 0 }, uWet: { value: 1 } };
  { const a = new Uint8Array(256 * 256), r = rng('gnoise'); for (let i = 0; i < a.length; i++) a[i] = r() * 255; const nt = new THREE.DataTexture(a, 256, 256, THREE.RedFormat); nt.wrapS = nt.wrapT = THREE.RepeatWrapping; nt.magFilter = nt.minFilter = THREE.LinearFilter; nt.unpackAlignment = 1; nt.needsUpdate = true; U.tNoise = { value: nt }; }
  mat.userData.u = U;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vWP = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP; varying vec3 vWN; uniform sampler2D tMud, tMudN, tRub, tRubN, tWet, tWetN, tCliff, tForest, tMacro, tMacroR, tMask; uniform vec3 uMudAvg, uRubAvg, uWetAvg, uCliffAvg, uForAvg, uBox; uniform float uTime, uWet;
        vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
        float gH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        uniform sampler2D tNoise; float gN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return textureLod(tNoise, (i + f + 0.5) / 256.0, 0.0).r; }
        float gF(vec2 p) { return gN(p) * 0.55 + gN(p * 2.13 + 7.1) * 0.29 + gN(p * 4.31 + 3.7) * 0.16; }
        vec3 gNrm = vec3(0.0); float gWater = 0.0, gRough = 0.9;`)
      .replace('#include <color_fragment>', '')
      .replace('#include <map_fragment>', `
        vec2 gp = vWP.xz; vec3 wn = normalize(vWN); float slope = 1.0 - wn.y;
        vec2 muv = vec2((gp.x - uBox.x) / uBox.z, (-gp.y - uBox.y) / uBox.z); vec2 me = min(muv, 1.0 - muv); float inside = smoothstep(0.015, 0.13, min(me.x, me.y) + (gF(gp / 13.0) - 0.5) * 0.05);
        vec3 macro = texture2D(tMacro, muv).rgb; float wetM = 1.0 - texture2D(tMacroR, muv).r; vec3 mask = texture2D(tMask, muv).rgb * inside;
        float camD = length(vWP - cameraPosition);
        // mud: two scales, rotated against each other, chosen by noise and by which of the two stands higher
        vec2 u1 = gp / 4.3, u2 = rot2(gp, 0.9) / 9.7; u1 = rot2(gp, 0.5) / 5.6; vec4 n1 = texture2D(tWetN, u1), n2 = texture2D(tMudN, u2);
        float pick = smoothstep(0.38, 0.62, gF(gp / 8.0) + (n2.a - n1.a) * 0.35);
        vec3 mud = mix(texture2D(tWet, u1).rgb * uMudAvg / uWetAvg, texture2D(tMud, u2).rgb, pick); float hgt = mix(n1.a, n2.a, pick);
        vec2 nx = mix(rot2(n1.rg * 2.0 - 1.0, -0.5), rot2(n2.rg * 2.0 - 1.0, -0.9), pick);
        // stones and broken stuff come through in patches; gravel and road have their own surfaces
        vec2 u3 = rot2(gp, 2.1) / 3.1; vec4 n3 = texture2D(tRubN, u3); float rub = smoothstep(0.56, 0.74, gF(gp / 5.5 + 31.0) + (n3.a - hgt) * 0.4) * (1.0 - mask.r) * 0.85; rub = max(rub, mask.g * 0.75);
        vec2 u4 = rot2(gp, 0.35) / 3.6; vec4 n4 = texture2D(tRubN, u4 * 2.6); float road = smoothstep(0.35, 0.75, mask.r + (n4.a - hgt) * 0.3 - smoothstep(0.5, 0.75, gF(gp / 6.0 + 9.0)) * 0.55);
        vec3 tone = mix(vColor.rgb, macro, inside);
        vec3 c = tone * mix(mud / uMudAvg, texture2D(tRub, u3).rgb / uRubAvg, rub); c = mix(c, mud * vec3(1.15, 1.08, 1.0), 0.45 * inside);
        c = mix(c, vec3(0.052, 0.054, 0.058) * (texture2D(tRub, u4 * 2.6).rgb / uRubAvg), road);
        nx = mix(mix(nx, rot2(n3.rg * 2.0 - 1.0, -2.1), rub), rot2(n4.rg * 2.0 - 1.0, -0.35) * 0.35, road); float hh = mix(mix(hgt, n3.a, rub), n4.a, road);
        // steep ground: rock sampled from the side so it does not smear
        float steep = smoothstep(0.24, 0.5, slope + (gF(gp / 21.0) - 0.5) * 0.16) * (1.0 - inside);
        vec2 sv = abs(wn.x) > abs(wn.z) ? vec2(vWP.z, vWP.y) : vec2(vWP.x, vWP.y); float fw = (1.0 - inside) * smoothstep(0.02, 0.07, slope); vec3 fo = mix(texture2D(tForest, sv / 34.0).rgb, texture2D(tForest, rot2(sv, 0.6) / 83.0).rgb, 0.45); fo.r = min(fo.r, fo.g * 0.95); fo.b = min(fo.b, fo.g * 0.8);
        c = mix(c, fo * vec3(0.6, 0.62, 0.62), fw * smoothstep(0.43, 0.53, gF(gp / 70.0 + 1.3) * 0.6 + gF(gp / 260.0) * 0.4) * smoothstep(1500.0, 1150.0, vWP.y) * (1.0 - smoothstep(0.4, 0.62, slope)));
        vec3 rk = texture2D(tCliff, sv / 17.0).rgb * 0.5 + texture2D(tCliff, sv / 61.0).rgb * 0.5; c = mix(c, rk * vec3(0.95, 0.9, 0.85), steep * 0.85);
        // terraces: level strips with dark stone risers on the gentler slopes
        float terr = (1.0 - inside) * smoothstep(0.02, 0.07, slope) * smoothstep(0.3, 0.16, slope) * smoothstep(0.46, 0.56, gF(gp / 120.0 + 5.0)) * smoothstep(1500.0, 500.0, camD);
        float band = fract(vWP.y / 2.4 + (gF(gp / 30.0) - 0.5) * 0.4); c = mix(c, mix(vec3(0.045, 0.043, 0.04), c * vec3(1.05, 1.25, 0.85), smoothstep(0.12, 0.3, band)), terr * 0.75);
        c *= 0.82 + 0.36 * gF(gp / 37.0 + 2.0);
        // water: fills the low parts of the relief, only where the ground is level
        float lw = gF(gp / 11.0 + 17.0) * 0.6 + gF(gp / 3.7 + 5.0) * 0.4, flat_ = smoothstep(0.03, 0.006, slope);
        float lvl = wetM * 1.05 + (lw - 0.5) * 0.85 - (hh - 0.5) * 0.28 - 0.46 - rub * 0.1 - road * 0.02;
        gWater = smoothstep(0.0, 0.11, lvl) * flat_ * inside * uWet; float damp = smoothstep(-0.34, 0.02, lvl) * uWet * mix(0.4, 1.0, inside);
        c *= mix(1.0, 0.5, damp); gRough = mix(mix(0.93, 0.8, rub), 0.75, road) - hh * 0.06; gRough = mix(gRough, 0.46 + (1.0 - hh) * 0.16 + 0.22 * smoothstep(15.0, 110.0, camD), damp * 0.85);
        c = mix(c, c * 0.35 + vec3(0.012, 0.0105, 0.0085), gWater); gRough = mix(gRough, 0.04, gWater);
        vec2 rip = vec2(gN(gp * 5.0 + uTime * 0.6) - 0.5, gN(gp * 5.0 - uTime * 0.5 + 9.0) - 0.5) * 0.02;
        nx = mix(nx * (1.0 + 0.4 * inside), rip, gWater) * (0.12 + 0.75 * smoothstep(95.0, 9.0, camD)); gNrm = normalize(vec3(wn.x + nx.x * wn.y, wn.y, wn.z + nx.y * wn.y));
        // snow on the high ground
        float snow = smoothstep(1250.0, 1700.0, vWP.y + (gF(gp / 90.0) - 0.5) * 500.0) * smoothstep(0.55, 0.2, slope); c = mix(c, vec3(0.72, 0.76, 0.82), snow);
        diffuseColor.rgb = c;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gNrm, 0.0)).xyz);')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n gl_FragColor.a = 1.0 - gWater;');       // alpha carries "mirror-wet" to the reflection pass
  };
  mat.customProgramCacheKey = () => 'twin-ground-3';
  return mat;
}

// One small picture: a conifer branch (left) and a spray of leaves (right), drawn white-green and tinted per tree.
function foliageTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const x = c.getContext('2d'), R = rng('foliage');
  x.lineCap = 'round';
  const needle = (px, py, a, l, w) => { const g = 60 + R() * 60; x.strokeStyle = 'rgb(' + (g * 0.5 | 0) + ',' + (g | 0) + ',' + (g * 0.5 | 0) + ')'; x.lineWidth = w; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); };
  const twig = (px, py, a, l, n) => { x.strokeStyle = '#33291f'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); for (let i = 0; i < n; i++) { const t = i / n, qx = px + Math.cos(a) * l * t, qy = py + Math.sin(a) * l * t; for (const s of [-1, 1]) needle(qx, qy, a + s * (0.5 + R() * 0.5), 11 + R() * 9, 2.2 + R() * 1.6); } };
  twig(2, 128, 0, 240, 60); for (let i = 0; i < 15; i++) { const t = 0.04 + i / 16, l = 112 * Math.pow(1 - t, 0.6) * (0.75 + R() * 0.35); for (const s of [-1, 1]) twig(2 + 235 * t, 128, s * (0.75 + R() * 0.35), Math.min(l, 118), Math.max(6, l / 4.2 | 0)); }
  for (let i = 0; i < 420; i++) { const a = R() * 6.283, r = Math.pow(R(), 0.6) * 112, g = 70 + R() * 70; x.fillStyle = 'rgb(' + (g * 0.72 | 0) + ',' + (g | 0) + ',' + (g * 0.42 | 0) + ')'; x.save(); x.translate(384 + Math.cos(a) * r, 128 + Math.sin(a) * r); x.rotate(a + R.gauss() * 0.8); x.beginPath(); x.ellipse(0, 0, 9 + R() * 6, 4 + R() * 3, 0, 0, 6.3); x.fill(); x.restore(); }
  // bleed colour under the transparent parts so mip levels do not go dark at the edges
  const d = x.getImageData(0, 0, 512, 256), p = d.data; for (let i = 0; i < p.length; i += 4) if (p[i + 3] < 40) { p[i] = 34; p[i + 1] = 52; p[i + 2] = 32; } x.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function buildTerrain(env, D) {
  const { quality, tex } = env, H = makeHeights(D), group = new THREE.Group(); group.name = 'terrain'; const high = quality === 'high';
  // one sheet from the site out to the far ridges: 2 m squares under the site, growing steadily outward
  const axis = (a, b, step, far) => { const v = []; for (let p = a; p <= b + 0.01; p += step) v.push(p); let s = step, p = b; while (p < far) { s *= high ? 1.075 : 1.12; p += s; v.push(p); } s = step; p = a; const w = []; while (p > -far) { s *= high ? 1.075 : 1.12; p -= s; w.push(p); } return [...w.reverse(), ...v]; };
  const xs = axis(-40, 160, high ? 2.2 : 4, 3250), ys = axis(-52, 142, high ? 2.2 : 4, 3250), nx = xs.length, ny = ys.length, pos = new Float32Array(nx * ny * 3), idx = [];
  for (let j = 0, k = 0; j < ny; j++) for (let i = 0; i < nx; i++, k += 3) { pos[k] = xs[i]; pos[k + 1] = H.at(xs[i], ys[j]); pos[k + 2] = -ys[j]; }
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i; idx.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const col = new Float32Array(nx * ny * 3), c = new THREE.Color(), soil = new THREE.Color('#5f574c'), forest = new THREE.Color('#232c22'), grass = new THREE.Color('#464a35'), scar = new THREE.Color('#665646'), silt = new THREE.Color('#6b6255'), nn = g.attributes.normal, N = H.noise;
  for (let i = 0; i < nx * ny; i++) {
    const x = pos[i * 3], y = -pos[i * 3 + 2], h = pos[i * 3 + 1], d = H.padDist(x, y), k = N.fbm(x / 70 + 3, y / 70, 4), [rd] = H.riverAt(x, y);
    c.copy(soil).lerp(grass, smooth(6, 60, d)).lerp(forest, smooth(0.42, 0.56, k + (1 - nn.getY(i)) * 0.25) * smooth(30, 130, d)).lerp(silt, smooth(60, 24, rd)).lerp(scar, H.slide(x, y) * 0.9 * smooth(0, 10, d + 5)).lerp(grass, smooth(1300, 1700, h) * 0.5);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = groundMaterial(env, tex.groundMacro()), land = mesh(g, mat, { cast: false, name: 'ground' }); land.frustumCulled = false; group.add(land);

  // ---- the Bhote Koshi: brown, fast, foaming over boulders ----
  const R = H.river, rp = [], ru = [], ri = []; let run = 0;
  for (let i = 0; i < R.length; i++) {
    const a = R[Math.max(0, i - 1)], b = R[Math.min(R.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, px = -(b[1] - a[1]) / l, py = (b[0] - a[0]) / l, w = 25; if (i) run += Math.hypot(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1]);
    for (let s = -4; s <= 4; s++) { rp.push(R[i][0] + px * w * s / 4, R[i][2] - 0.6, -(R[i][1] + py * w * s / 4)); ru.push(s / 4, run); }
    if (i) for (let s = 0; s < 8; s++) { const q = i * 9 + s, p = q - 9; ri.push(p, q, p + 1, p + 1, q, q + 1); }
  }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2)); rg.setIndex(ri); rg.computeVertexNormals();
  const riverMat = new THREE.MeshStandardMaterial({ color: 0x57493a, roughness: 0.22, metalness: 0, side: THREE.DoubleSide }); const ru_ = { uTime: { value: 0 } };
  riverMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = ru_.uTime; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vR;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vR = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vR; uniform float uTime; float rH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float rN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(rH(i), rH(i + vec2(1, 0)), f.x), mix(rH(i + vec2(0, 1)), rH(i + vec2(1, 1)), f.x), f.y); }
      float rW(vec2 p) { vec2 q = vec2(p.x * 25.0, p.y - uTime * 5.2); q.x += sin(q.y * 0.07) * 3.0; return rN(q * vec2(0.22, 0.09)) * 0.5 + rN(q * vec2(0.6, 0.23) + 4.0) * 0.3 + rN(q * vec2(1.6, 0.7) - uTime * 0.4) * 0.2; }`)
      .replace('#include <map_fragment>', `float w0 = rW(vR); float foam = smoothstep(0.56, 0.72, w0 + (rN(vec2(vR.x * 60.0, vR.y * 1.6 - uTime * 6.0)) - 0.5) * 0.2) * 0.75 + smoothstep(0.8, 1.0, abs(vR.x)) * 0.45 * rN(vec2(vR.x * 40.0, vR.y * 0.6 - uTime * 3.0)); diffuseColor.rgb = mix(diffuseColor.rgb * (0.7 + w0 * 0.6), vec3(0.5, 0.46, 0.4), clamp(foam, 0.0, 1.0));`)
      .replace('#include <normal_fragment_maps>', `float e = 0.02; float wx = rW(vR + vec2(e, 0.0)) - w0, wy = rW(vR + vec2(0.0, e * 25.0)) - w0; normal = normalize(normal + (viewMatrix * vec4(-wx * 5.0, 0.0, wy * 5.0, 0.0)).xyz);`);
  };
  const river = new THREE.Mesh(rg, riverMat); river.receiveShadow = false; river.name = 'river'; river.frustumCulled = false; group.add(river);

  // ---- pines and broadleaf scrub on the slopes ----
  const Q = rng('valley'), trees = [[], [], []], tcol = [[], [], []], clear = (x, y, m) => H.padDist(x, y) < m || H.riverAt(x, y)[0] < 34;
  const fol = foliageTexture();
  const card = (x, y, z, len, wid, yaw, droop, roll, u0, u1) => { const gg = new THREE.PlaneGeometry(len, wid).translate(len / 2, 0, 0), p = gg.attributes.position, uv = gg.attributes.uv; for (let i = 0; i < p.count; i++) { const k = p.getX(i) / len; p.setZ(i, 0); uv.setX(i, u0 + (u1 - u0) * uv.getX(i)); p.setY(i, p.getY(i) * (1 - 0.0 * k)); } gg.rotateX(-Math.PI / 2 + roll); for (let i = 0; i < p.count; i++) { const k = p.getX(i) / len; p.setY(i, p.getY(i) - k * k * len * 0.22); } gg.rotateZ(-droop).rotateY(yaw).translate(x, y, z); return gg; };
  const soften = (gg, cy) => { const p = gg.attributes.position, nrm = gg.attributes.normal; for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3(p.getX(i), (p.getY(i) - cy) * 0.35 + 0.6, p.getZ(i)).normalize(); nrm.setXYZ(i, v.x, v.y, v.z); } return gg; };
  const pine = (s) => { const parts = [], tiers = 8; for (let i = 0; i < tiers; i++) { const k = 1 - i / tiers, nb = i > 5 ? 3 : 5; for (let b = 0; b < nb; b++) { const len = (0.6 + 2.3 * Math.pow(k, 0.85) * s) * (0.7 + Q() * 0.5); parts.push(card(0, 1.6 + i * 1.2 + Q() * 0.9, 0, len, len * 0.62 + 0.3, b / nb * 6.283 + i * 1.3 + Q() * 0.4, 0.06 + 0.22 * k, (Q() - 0.5) * 0.7, 0, 0.5)); } } for (const a of [0, 1.57]) parts.push(card(0, 10.6, 0, 1.9, 1.0, a, -1.57, 0, 0, 0.5)); return soften(merge(parts, { keepUV: true, keepColor: false }), 5); };
  const bushG = () => { const parts = []; for (let i = 0; i < 20; i++) { const a = Q() * 6.283, y = 1.1 + Q() * 2.6, l = 1.5 + Q() * 0.9; parts.push(card(0, y, 0, l, l, a, (Q() - 0.6) * 0.9, (Q() - 0.5) * 2.2, 0.5, 1)); } return soften(merge(parts, { keepUV: true, keepColor: false }), 2); };
  const trunk = new THREE.CylinderGeometry(0.07, 0.24, 10.5, 5).translate(0, 5, 0), bush = bushG();
  const want = high ? 6200 : 1800; let made = 0;
  for (let i = 0; i < want * 12 && made < want; i++) {
    const a = Q() * 6.283, rad = 70 + Math.pow(Q(), 1.25) * 1150, x = 60 + Math.cos(a) * rad, y = 45 + Math.sin(a) * rad; if (clear(x, y, 9) || H.slide(x, y) > 0.1 || (y < 0 && x > -45 && x < 190 && H.padDist(x, y) < 95)) continue;
    const k = N.fbm(x / 70 + 3, y / 70, 4); if (k < 0.4 + (Q() - 0.5) * 0.12) continue; const h = H.at(x, y); if (Math.abs(H.at(x + 4, y) - h) > 6) continue;
    const t = Q() < 0.7 ? (Q() < 0.5 ? 0 : 1) : 2, s = (0.5 + Q() * Q() * 0.85 + Q() * 0.25) * (t === 2 ? 0.9 : 1.1); trees[t].push(matrix(x, h - 0.4, -y, Q() * 6.3, (Q() - 0.5) * 0.08, (Q() - 0.5) * 0.08, [s, s * (0.85 + Q() * 0.4), s])); made++;
    const v = 0.75 + Q() * 0.5; tcol[t].push(t === 2 ? c.setRGB(0.3 * v, 0.3 * v, 0.22 * v).getHex() : c.setRGB(0.3 * v, 0.31 * v, 0.33 * v).getHex());
  }
  const tm = new THREE.MeshStandardMaterial({ map: fol, alphaTest: 0.5, roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.6 });
  tm.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;'); };
  const pines = trees[0].concat(trees[1]);
  [pine(1), pine(0.7), bush].forEach((gg, i) => { if (trees[i].length) group.add(instanced(gg, tm, trees[i], { colors: tcol[i], cast: false, receive: false, name: 'trees-' + i })); });
  if (pines.length) group.add(instanced(trunk, new THREE.MeshStandardMaterial({ color: 0x2e261f, roughness: 1 }), pines, { cast: false, receive: false, name: 'trunks' }));

  // ---- the town: stone and plaster houses under tin roofs held down with stones ----
  const houses = [], hc = [], roofs = [], rc = [], stones = [], tints = [0x8d8678, 0xa39c8e, 0xb9b3a6, 0x7a7367, 0x9a8f7c, 0x6f6a62], tin = [0x6d747a, 0x596066, 0x7d4f3f, 0x4f6a66, 0x83888c];
  const put = (x, y, w, d, a) => { if (y < 0 && x > -45 && x < 190 && H.padDist(x, y) < 95) return false; let lo = 1e9, hi = -1e9; for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const h = H.at(x + (Math.cos(a) * u * w - Math.sin(a) * v * d) / 2, y + (Math.sin(a) * u * w + Math.cos(a) * v * d) / 2); lo = Math.min(lo, h); hi = Math.max(hi, h); } if (hi - lo > 5.5) return false; const hh = (Q() < 0.6 ? 5.4 : 2.9) + Q() * 0.5, top = hi + hh; houses.push(matrix(x, lo - 0.6, -y, a, 0, 0, [w, top - lo + 0.6, d])); hc.push(c.set(Q.pick(tints)).multiplyScalar(0.5).getHex()); roofs.push(matrix(x, top - 0.05, -y, a, 0, 0, [w * 1.14, 1.0 + d * 0.16, d * 1.2])); rc.push(c.set(Q.pick(tin)).multiplyScalar(0.75).getHex()); for (let k = 0; k < 4; k++) { const u = (Q() - 0.5) * w, v = (Q() < 0.5 ? -1 : 1) * d * 0.42; stones.push(matrix(x + Math.cos(a) * u - Math.sin(a) * v, top + (1 + d * 0.16) * 0.32, -(y + Math.sin(a) * u + Math.cos(a) * v), Q() * 6, 0, 0, 0.16 + Q() * 0.14)); } return true; };
  for (const [x, y, w, d, a] of D.town) if (!clear(x, y, 9)) put(x, y, w, d, a);
  for (let i = 0; i < 2600 && houses.length < 150; i++) { const a = Q() * 6.283, rad = 95 + Q() * 560, x = 50 + Math.cos(a) * rad * 0.75, y = 45 + Math.sin(a) * rad; if (clear(x, y, 12) || H.slide(x, y) > 0.02) continue; const s = Math.abs(H.at(x + 5, y) - H.at(x - 5, y)) + Math.abs(H.at(x, y + 5) - H.at(x, y - 5)); if (s > 7) continue; put(x, y, 7 + Q() * 5, 5.5 + Q() * 2.5, Math.atan2(H.at(x + 4, y) - H.at(x - 4, y), H.at(x, y + 4) - H.at(x, y - 4)) * -1 + Q.gauss() * 0.3); }
  const hp = [tint(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), 0xffffff)];
  for (const z of [-0.5, 0.5]) for (const x of [-0.3, 0, 0.3]) for (const y of [0.35, 0.74]) hp.push(tint(new THREE.BoxGeometry(0.11, 0.14, 0.03).translate(x, y, z), 0x14181b), tint(new THREE.BoxGeometry(0.14, 0.02, 0.05).translate(x, y - 0.085, z), 0x6a6f72));
  for (const x of [-0.5, 0.5]) for (const z of [-0.22, 0.22]) hp.push(tint(new THREE.BoxGeometry(0.03, 0.14, 0.13).translate(x, 0.72, z), 0x14181b));
  hp.push(tint(new THREE.BoxGeometry(1.015, 0.2, 1.02).translate(0, 0.1, 0), 0x9a8a78));
  const rShape = new THREE.Shape([[-0.5, 0], [0, 0.5], [0.5, 0], [0.5, 0.04], [0, 0.56], [-0.5, 0.04]].map((p) => new THREE.Vector2(p[0], p[1]))), roofG = new THREE.ExtrudeGeometry(rShape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5).rotateY(Math.PI / 2);
  const gable = new THREE.BufferGeometry(); gable.setAttribute('position', new THREE.Float32BufferAttribute([-0.43, 0, -0.42, -0.43, 0.44, 0, -0.43, 0, 0.42, 0.43, 0, 0.42, 0.43, 0.44, 0, 0.43, 0, -0.42], 3)); gable.computeVertexNormals();
  const hm = photoTri(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), env.photos.stone, { scale: 2.2, k: 0.9, bump: 0.9, key: 'stone' });
  const rm = photoTri(new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.45, side: THREE.DoubleSide }), env.photos.tin, { scale: 2.6, k: 0.95, bump: 0.8, key: 'tin' });
  group.add(instanced(merge(hp, { keepUV: false }), hm, houses, { colors: hc, cast: false, receive: false, name: 'town' }), instanced(roofG, rm, roofs, { colors: rc, cast: false, receive: false, name: 'town-roofs' }), instanced(gable, new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide }), roofs, { colors: hc, cast: false, receive: false, name: 'town-gables' }), instanced(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x6f6b64, roughness: 1 }), stones, { cast: false, receive: false, name: 'roof-stones' }));

  // ---- boulders along the river and at the foot of the slide ----
  const bl = []; for (let i = 0; i < 900 && bl.length < 420; i++) { const r0 = Q.pick(R); if (Math.abs(r0[1] - 45) > 700) continue; const x = r0[0] + Q.sign() * (15 + Q() * 22), y = r0[1] + (Q() - 0.5) * 25, s = 0.6 + Q() * Q() * 3.4; bl.push(matrix(x, H.at(x, y) + s * 0.1, -y, Q() * 6, Q() * 6, 0, [s, s * 0.7, s * 0.85])); }
  group.add(instanced(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x5b5750, roughness: 0.9, flatShading: true }), bl, { cast: false, receive: false, name: 'river-boulders' }));

  // ---- a suspension footbridge over the gorge ----
  { let bi = 0, bd = 1e9; R.forEach((p, i) => { const d = Math.abs(p[1] - 130); if (d < bd && Math.abs(p[0]) < 420) { bd = d; bi = i; } }); const p = R[bi], q = R[Math.min(R.length - 1, bi + 1)], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, px = -(q[1] - p[1]) / l, py = (q[0] - p[0]) / l, L = 52;
    const y0 = Math.max(H.at(p[0] - px * L, p[1] - py * L), H.at(p[0] + px * L, p[1] + py * L), p[2] + 9) + 0.5, at = (s, up, off = 0) => new THREE.Vector3(p[0] + px * L * s - py * off, y0 - 5 * (1 - s * s) + up, -(p[1] + py * L * s + px * off)), G = [];
    for (const off of [-0.8, 0.8]) { G.push(tube(Array.from({ length: 15 }, (_, i) => at(i / 7 - 1, 1.1, off)), 0.05, { segs: 40 }), tube(Array.from({ length: 15 }, (_, i) => at(i / 7 - 1, 0, off)), 0.04, { segs: 40 })); for (let i = -20; i <= 20; i++) G.push(tube([at(i / 20, 0, off), at(i / 20, 1.1, off)], 0.015, { segs: 1, radial: 3 })); for (const s of [-1, 1]) { const b = at(s, -3, off); G.push(box(0.5, 6.5, 0.5, b.x, b.y, b.z)); } }
    const planks = []; for (let i = -100; i <= 100; i++) { const v = at(i / 100, 0.02); planks.push(matrix(v.x, v.y, v.z, Math.atan2(py, px))); }
    group.add(mesh(merge(G, { keepUV: false }), new THREE.MeshStandardMaterial({ color: 0x4a4e50, roughness: 0.7, metalness: 0.4 }), { cast: false, receive: false, name: 'footbridge' }), instanced(new THREE.BoxGeometry(0.42, 0.04, 1.6), new THREE.MeshStandardMaterial({ color: 0x57493a, roughness: 0.9 }), planks, { cast: false, receive: false, name: 'footbridge-deck' })); }

  // ---- prayer flags on cords, moving in the wind ----
  const flags = [], fc = [], cords = [], cloth = [0x3f5a7a, 0x9c9a92, 0x7a463c, 0x4c6650, 0x9a8a52], poles = [];
  for (const [a, b, sag] of [[[33.8, 69.5, 7.8], [49, 88, 6.4], 1.6], [[33.8, 69.5, 7.8], [12, 86, 6.8], 1.8], [[63, 57, 6.0], [58, 78, 6.6], 1.5], [[112, 46, 6.4], [124, 66, 7.4], 1.5], [[-4, 24, 6.6], [8, 40, 7.2], 1.2]]) {
    const A = new THREE.Vector3(a[0], a[2], -a[1]), Bv = new THREE.Vector3(b[0], b[2], -b[1]), pts = [], len = A.distanceTo(Bv); for (let i = 0; i <= 16; i++) { const t = i / 16, v = A.clone().lerp(Bv, t); v.y -= sag * 4 * t * (1 - t); pts.push(v); } cords.push(tube(pts, 0.012, { segs: 32, radial: 3 }));
    const curve = new THREE.CatmullRomCurve3(pts), nf = Math.floor(len / 0.48), ang = Math.atan2(-(Bv.z - A.z), Bv.x - A.x); for (let i = 1; i < nf; i++) { if (Q() < 0.06) continue; const v = curve.getPointAt(i / nf); flags.push(matrix(v.x, v.y, v.z, ang, 0, 0, 0.9 + Q() * 0.2)); fc.push(cloth[i % 5]); }
    for (const e of [a, b]) if (H.padDist(e[0], e[1]) <= 0 && (e[0] !== 33.8 && e[0] !== 63 && e[0] !== 112)) poles.push(xform(new THREE.CylinderGeometry(0.06, 0.09, e[2] + 0.6, 6).translate(0, (e[2] + 0.6) / 2 - 0.3, 0), e[0], 0, -e[1], 0, 0.02, 0.03));
  }
  const fm = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), fu = { value: 0 };
  fm.onBeforeCompile = (sh) => { sh.uniforms.uTime = fu; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', '#include <begin_vertex>\n { float k = -position.y / 0.42; float ph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3; float w = sin(uTime * 3.1 + ph + position.x * 6.0) * 0.5 + sin(uTime * 5.3 + ph * 1.9) * 0.3 + 0.55 + 0.35 * sin(uTime * 0.6 + instanceMatrix[3].x * 0.2); transformed.z += k * w * 0.16; transformed.y += k * k * w * 0.05; }'); };
  group.add(instanced(new THREE.PlaneGeometry(0.34, 0.4, 3, 4).translate(0, -0.21, 0), fm, flags, { colors: fc, cast: false, receive: false, name: 'prayer-flags' }), mesh(merge(cords.concat(poles), { keepUV: false }), new THREE.MeshStandardMaterial({ color: 0x4b4438, roughness: 0.9 }), { name: 'flag-cords' }));

  return { group, H, update(time, animate) { if (!animate) return; mat.userData.u.uTime.value = time; ru_.uTime.value = time; fu.value = time; }, setWet(k) { mat.userData.u.uWet.value = k; } };
}
