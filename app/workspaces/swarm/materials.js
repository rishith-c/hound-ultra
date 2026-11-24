// Materials and procedural textures for the swarm scene. Everything is generated here: no image files.
import * as THREE from 'three';

const hash2 = (x, y) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export const hash = (k) => { let x = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

// One tileable texture: R broad cloudy noise, G crack lines, B fine grain, A a second broad noise.
export function noiseTexture(N = 512) {
  const d = new Uint8Array(N * N * 4);
  const vn = (u, v, p, s) => { const x = u * p, y = v * p, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const i1 = (i + 1) % p, j1 = (j + 1) % p, a = hash2(i + s, j + s * 7), b = hash2(i1 + s, j + s * 7), c = hash2(i + s, j1 + s * 7), e = hash2(i1 + s, j1 + s * 7); return (a + (b - a) * sx) * (1 - sy) + (c + (e - c) * sx) * sy; };
  const fbm = (u, v, p, s, o) => { let a = 0.5, t = 0, n = 0; for (let q = 0; q < o; q++) { t += a * vn(u, v, p << q, s + q * 13); n += a; a *= 0.55; } return t / n; };
  const G = 9, px = new Float32Array(G * G), py = new Float32Array(G * G); for (let q = 0; q < G * G; q++) { px[q] = hash2(q, 91); py[q] = hash2(q, 17); }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, k = (y * N + x) * 4;
    const w1 = fbm(u, v, 4, 3, 5), w2 = fbm(u, v, 6, 41, 4), gr = fbm(u, v, 48, 77, 3);
    const cu = u * G + (w1 - 0.5) * 1.3, cv = v * G + (w2 - 0.5) * 1.3, ci = Math.floor(cu), cj = Math.floor(cv); let f1 = 9, f2 = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = (ci + di + G) % G, b = (cj + dj + G) % G, q = b * G + a, dx = ci + di + px[q] - cu, dy = cj + dj + py[q] - cv, r = dx * dx + dy * dy; if (r < f1) { f2 = f1; f1 = r; } else if (r < f2) f2 = r; }
    const crack = 1 - Math.min(1, Math.max(0, (Math.sqrt(f2) - Math.sqrt(f1)) / 0.045));
    d[k] = w1 * 255; d[k + 1] = crack * (0.35 + 0.65 * w2) * 255; d[k + 2] = gr * 255; d[k + 3] = w2 * 255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t;
}

const COMMON = /* glsl */ `
  varying vec3 vW; varying vec3 vWN;
  uniform sampler2D uField, uState, uLight, uNoise; uniform vec2 uSite; uniform float uTime, uBoost;
  uniform vec3 uScan, uHead, uPerson, uTruth, uBeaconC; uniform vec3 uGroundC, uSlabC;
  vec2 sUv(vec3 w) { return vec2(w.x, -w.z) / uSite; }
  float inSite(vec2 uv) { vec2 s = step(vec2(0.0), uv) * step(uv, vec2(1.0)); return s.x * s.y; }
  vec3 fieldLight(vec2 uv, float y) { vec4 L = texture2D(uLight, clamp(uv, 0.0, 1.0)) * inSite(uv); float hf = exp(-pow(max(0.0, y - 0.3) / 0.95, 2.0));
    return uHead * L.r * hf * 1.2 + uScan * L.b * 0.34 * hf + uPerson * L.a * exp(-y * 0.5) * 2.2 + uBeaconC * L.g * 0.5 * hf; }
  vec4 tri(vec3 p, vec3 n, float s) { vec3 w = abs(n); w /= (w.x + w.y + w.z); return texture2D(uNoise, p.zy * s) * w.x + texture2D(uNoise, p.xz * s) * w.y + texture2D(uNoise, p.xy * s) * w.z; }
`;
const VWORLD = /* glsl */ `
  { vec4 wq = vec4(transformed, 1.0); vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
    wq = instanceMatrix * wq; wn = mat3(instanceMatrix) * wn;
  #endif
  vW = (modelMatrix * wq).xyz; vWN = normalize(mat3(modelMatrix) * wn); }
`;

// A standard material with world-space hooks. Each caller passes a unique key (three caches programs by key).
export function patched(params, U, key, { vDecl = '', vBegin = '', fDecl = '', color = '', rough = '', normal = '', emis = '' } = {}) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vWN; uniform float uTime;\n' + vDecl).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + vBegin).replace('#include <project_vertex>', '#include <project_vertex>\n' + VWORLD);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n' + COMMON + fDecl + '\nvec3 gE;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ngE = vec3(0.0);\n' + color)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + rough)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + normal)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gE;\n' + emis);
  };
  m.customProgramCacheKey = () => 'swarm-' + key;
  return m;
}
export function patchedDepth(U, key, { vDecl = '', vBegin = '', fDecl = '', frag = '' }) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vWN; uniform float uTime;\n' + vDecl).replace('#include <begin_vertex>', '#include <begin_vertex>\nvec3 objectNormal = vec3(0.0, 1.0, 0.0);\n' + vBegin).replace('#include <project_vertex>', '#include <project_vertex>\n' + VWORLD);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n' + COMMON + fDecl).replace('#include <map_fragment>', '#include <map_fragment>\n' + frag);
  };
  m.customProgramCacheKey = () => 'swarm-depth-' + key;
  return m;
}

export const GROUND = {
  fDecl: 'float gPud, gSeen;',
  color: /* glsl */ `
    vec2 uv = sUv(vW), m = vec2(vW.x, -vW.z); float on = inSite(uv);
    vec4 st = texture2D(uState, uv) * on; float cls = floor(st.r * 255.0 / 50.0 + 0.5);
    vec4 nA = texture2D(uNoise, m / 31.0), nB = texture2D(uNoise, m / 7.0), nC = texture2D(uNoise, m / 1.9);
    vec4 fd = texture2D(uField, uv) * on;
    float seen = smoothstep(0.22, 0.72, fd.r + (nB.r - 0.5) * 0.5 * (1.0 - abs(fd.r * 2.0 - 1.0))); gSeen = seen;
    float indoor = step(1.5, cls) * (1.0 - step(2.5, cls));
    // outdoors: worn asphalt, patched, with damp hollows
    float patchy = smoothstep(0.42, 0.6, nA.r), crack = nB.g * 0.8 + nC.g * 0.35;
    vec3 asph = uGroundC * (0.62 + 0.5 * nC.b + 0.35 * nB.r) * mix(0.8, 1.12, patchy) * (1.0 - 0.55 * crack);
    gPud = smoothstep(0.60, 0.74, nA.a + (nB.a - 0.5) * 0.16) * (1.0 - indoor);
    asph *= mix(1.0, 0.55, gPud);
    // indoors: a poured slab with joints, dust and grit
    vec2 jt = abs(fract(m / 3.0 - 0.5) - 0.5) * 3.0; float joint = 1.0 - smoothstep(0.012, 0.05, min(jt.x, jt.y));
    vec3 slab = uSlabC * (0.66 + 0.42 * nB.r + 0.3 * nC.b) * (1.0 - 0.4 * nB.g) * (1.0 - 0.45 * joint); slab *= 1.0 - 0.5 * smoothstep(0.62, 0.8, nC.a);
    vec3 known = mix(asph, slab, indoor); if (cls > 2.5) known = uGroundC * 0.45;
    // survey ticks every 10 m, only on ground that has been measured
    vec2 g10 = abs(fract(m / 10.0 - 0.5) - 0.5) * 10.0; float tick = (1.0 - smoothstep(0.015, 0.04, min(g10.x, g10.y))) * step(max(g10.x, g10.y), 0.32);
    vec3 unk = uGroundC * vec3(0.40, 0.42, 0.45) * (0.5 + 0.55 * nB.r) * (1.0 - 0.3 * crack);
    diffuseColor.rgb = mix(unk, known, seen);
    float rim = seen * (1.0 - seen) * 4.0, freshK = fd.b;
    gE += uScan * (rim * 0.10 + tick * 0.05 * seen);
    gE += uScan * fd.g * (0.16 + 0.16 * sin(uTime * 2.6 - (m.x + m.y) * 0.45)) * uBoost;
    vec2 sc = abs(fract(m * 2.0) - 0.5); float mesh = smoothstep(0.40, 0.5, max(sc.x, sc.y));
    gE += uScan * freshK * (0.06 + 0.34 * mesh) * 0.42;
    gE += uTruth * st.b * (1.0 - seen) * 0.5;
    gE += (diffuseColor.rgb * 1.25 + 0.012) * fieldLight(uv, 0.0) * (1.0 + 1.1 * gPud);
  `,
  rough: 'roughnessFactor = mix(0.93 - 0.14 * nB.b, 0.46, gPud * 0.85);',
  normal: /* glsl */ `
    { vec2 e = vec2(0.012, 0.0); vec2 q = m / 1.9; float hx = texture2D(uNoise, q + e.xy).b - texture2D(uNoise, q - e.xy).b, hy = texture2D(uNoise, q + e.yx).b - texture2D(uNoise, q - e.yx).b;
      normal = normalize(normal + (viewMatrix * vec4(-hx, 0.0, hy, 0.0)).xyz * 0.42 * (1.0 - gPud)); }
  `,
};

// Building shells: the outside of each block is on the site map, the inside is not. A shell dissolves from the roof down
// where the fleet has mapped what is under it.
const SHELL_CUT = /* glsl */ `
  vec2 uvS = sUv(vW - vWN * vec3(0.55, 0.0, 0.55)); vec4 nS = tri(vW, vWN, 0.11);
  float rv = texture2D(uField, clamp(uvS, 0.0, 1.0)).a * vReal;
  float thr = mix(0.30, 0.62, clamp(1.0 - vW.y / max(1.0, vTopY), 0.0, 1.0)) + (nS.r - 0.5) * 0.5;
  float cutK = rv - thr;
  float dmg = vTopY * (1.0 - 0.6 * smoothstep(0.70, 0.80, texture2D(uNoise, vW.xz * 0.028).a + vDmg * 0.7) * step(0.5, vReal));
  if (cutK > 0.0 || vW.y > dmg + 0.4 * (nS.b - 0.5) + 0.3) discard;
`;
export const SHELL_V = { vDecl: 'attribute vec3 aShell; varying float vTopY; varying float vReal; varying float vDmg;', vBegin: 'vTopY = aShell.x; vReal = aShell.y; vDmg = aShell.z;' };
export const SHELL = {
  ...SHELL_V, fDecl: 'varying float vTopY; varying float vReal; varying float vDmg; float gWin; float wLit(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }',
  color: SHELL_CUT + /* glsl */ `
    vec4 nT = tri(vW, vWN, 0.31), nF = tri(vW, vWN, 1.1);
    float roof = step(0.5, vWN.y); float along = abs(vWN.x) > 0.5 ? vW.z : vW.x;
    float streak = texture2D(uNoise, vec2(along * 0.16, vW.y * 0.018)).r;
    vec3 wall = uSlabC * (0.40 + 0.35 * nT.r + 0.22 * nF.b) * (1.0 - 0.6 * nT.g) * mix(0.55, 1.1, streak);
    vec2 bay = vec2(along / 2.7, (vW.y - 0.35) / 3.05); vec2 id = floor(bay), f = fract(bay);
    float storeys = floor((vTopY - 0.6) / 3.05);
    float inWin = step(0.2, f.x) * step(f.x, 0.8) * step(0.26, f.y) * step(f.y, 0.80) * step(id.y, storeys - 0.5) * (1.0 - roof);
    float frame = inWin * (1.0 - step(0.235, f.x) * step(f.x, 0.765) * step(0.30, f.y) * step(f.y, 0.765) * (1.0 - step(abs(f.x - 0.5), 0.016)));
    float band = (1.0 - roof) * smoothstep(0.93, 0.95, f.y); wall *= 1.0 - 0.35 * band;
    float r1 = wLit(id + floor(vTopY * 13.0)), glass = inWin * (1.0 - frame) * step(r1, 0.72); gWin = glass;
    wall *= mix(1.0, 0.16, inWin); wall = mix(wall, uSlabC * 0.28, frame);
    wall = mix(wall, vec3(0.02, 0.026, 0.034), glass);
    vec3 roofC = uGroundC * (0.42 + 0.5 * nT.r) * (1.0 - 0.5 * nT.g); vec2 rj = abs(fract(vW.xz / 4.2) - 0.5); roofC *= 1.0 - 0.3 * smoothstep(0.485, 0.495, max(rj.x, rj.y));
    diffuseColor.rgb = mix(wall, roofC, roof);
    gE += vec3(0.5, 0.6, 0.72) * glass * (0.010 + 0.02 * wLit(id * 1.7 + 3.0)) * (0.3 + 0.7 * f.y);
    float stR = floor(texture2D(uState, clamp(sUv(vW), 0.0, 1.0)).r * 255.0 / 50.0 + 0.5);
    if (vReal > 0.5 && roof > 0.5 && stR > 3.5) { float hl = smoothstep(0.46, 0.5, abs(fract((vW.x - vW.z) / 2.4) - 0.5)); gE += uScan * (0.012 + 0.05 * hl); }
    float fw = max(fwidth(cutK), 1e-4); gE += uScan * (smoothstep(-fw * 3.0, -fw * 0.6, cutK) * 0.75 + smoothstep(-0.12, 0.0, cutK) * 0.05) * smoothstep(0.02, 0.10, rv) * smoothstep(0.10, 0.02, fw);
    vec2 uvO = sUv(vW + vWN * vec3(0.5, 0.0, 0.5)); gE += (diffuseColor.rgb * 1.3 + 0.008) * fieldLight(uvO, vW.y * 0.8) * vReal;
  `,
  rough: 'roughnessFactor = mix(0.9 - 0.15 * nF.b, 0.10, gWin);',
  normal: 'normal = normalize(normal + (viewMatrix * vec4((tri(vW + vec3(0.03), vWN, 0.9).rba - tri(vW - vec3(0.03), vWN, 0.9).rba), 0.0)).xyz * 0.9 * (1.0 - gWin));',
};
export const SHELL_DEPTH = { ...SHELL_V, fDecl: 'varying float vTopY; varying float vReal; varying float vDmg;', frag: SHELL_CUT };

export const GROW_V = { vDecl: 'attribute float aBirth; varying float vTop; varying float vGrow;', vBegin: 'float gq = clamp((uTime - aBirth) / 0.7, 0.0, 1.0); gq = 1.0 - pow(1.0 - gq, 3.0); transformed.y *= gq; vTop = step(0.5, normal.y); vGrow = gq;' };
export const WALL = {
  ...GROW_V, fDecl: 'varying float vTop; varying float vGrow;',
  color: /* glsl */ `
    vec4 nT = tri(vW, vWN, 0.23), nF = tri(vW, vWN, 0.95);
    diffuseColor.rgb *= (0.52 + 0.45 * nT.r + 0.3 * nF.b) * (1.0 - 0.45 * nT.g);
    diffuseColor.rgb *= mix(0.82, 0.74, vTop);
    vec2 uvO = sUv(vW + vWN * vec3(0.42, 0.0, 0.42));
    gE += (diffuseColor.rgb * 1.5 + 0.006) * fieldLight(uvO, vW.y) * mix(1.0, 0.25, vTop);
    gE += uScan * ((1.0 - vGrow) * 0.38 + vTop * 0.004);
  `,
  rough: 'roughnessFactor = 0.94 - 0.2 * nF.b;',
  normal: 'normal = normalize(normal + (viewMatrix * vec4((tri(vW + vec3(0.02), vWN, 1.3).rba - tri(vW - vec3(0.02), vWN, 1.3).rba), 0.0)).xyz * 0.8);',
};
export const GROW_DEPTH = { ...GROW_V, vDecl: 'attribute float aBirth; varying float vTop; varying float vGrow;', frag: '' };
export const PROP = { color: 'gE += (diffuseColor.rgb * 1.2 + 0.01) * fieldLight(sUv(vW + vWN * vec3(0.4, 0.0, 0.4)), vW.y);' };

export const FOG_VERT = /* glsl */ `varying vec2 vUv; varying float vL; varying vec3 vP; attribute float aL; uniform vec2 uSite; void main() { vUv = uv; vL = aL; vec3 p = position; p.y += aL; vec4 mv = modelViewMatrix * vec4(p, 1.0); vP = (modelMatrix * vec4(p, 1.0)).xyz; gl_Position = projectionMatrix * mv; }`;
export const FOG_FRAG = /* glsl */ `
  varying vec2 vUv; varying float vL; varying vec3 vP; uniform sampler2D uField, uNoise, uLight; uniform float uTime, uDens; uniform vec2 uSite; uniform vec3 uFogC, uHead, uScan;
  void main() {
    vec2 m = vUv * uSite; vec3 fd = texture2D(uField, vUv).rgb;
    float n = texture2D(uNoise, m / 46.0 + vec2(uTime * 0.0021, uTime * 0.0013) + vL * 0.021).r, n2 = texture2D(uNoise, m / 15.0 - vec2(uTime * 0.006, uTime * 0.003) + vL * 0.05).a;
    float body = smoothstep(0.30, 0.74, n * 0.62 + n2 * 0.46 - vL * 0.035);
    float un = 1.0 - smoothstep(0.02, 0.55, fd.r + (n2 - 0.5) * 0.35);
    vec2 e = smoothstep(vec2(0.0), vec2(0.04), vUv) * smoothstep(vec2(0.0), vec2(0.04), 1.0 - vUv);
    float a = body * un * e.x * e.y * uDens;
    vec4 L = texture2D(uLight, vUv); float beam = L.r * exp(-pow((vL - 0.45) / 0.8, 2.0)) * (0.55 + 0.9 * n2);
    vec3 c = uFogC * (0.7 + 0.6 * n2) + uScan * fd.b * 0.5;
    gl_FragColor = vec4(c * a + uHead * beam * 0.022 + uScan * L.b * 0.006, a);
    #include <colorspace_fragment>
  }`;

// Fat glowing lines with sag, used for the radio mesh and the bids.
export const THREAD_VERT = /* glsl */ `
  attribute vec3 iA, iB, iC; attribute vec4 iP; uniform vec2 uRes; uniform float uPx, uTime; varying float vT, vS; varying vec3 vC; varying vec4 vP4; varying float vLen;
  vec3 at(float t) { vec3 p = mix(iA, iB, t); p.y -= iP.x * 4.0 * t * (1.0 - t); p.y = max(p.y, 0.12); return p; }
  void main() {
    float t = position.x * iP.y; vec4 c0 = projectionMatrix * viewMatrix * vec4(at(t), 1.0), c1 = projectionMatrix * viewMatrix * vec4(at(min(1.0, t + 0.02)), 1.0), cm = projectionMatrix * viewMatrix * vec4(at(max(0.0, t - 0.02)), 1.0);
    vec2 d = (c1.xy / c1.w - cm.xy / cm.w) * uRes; d = normalize(d + vec2(1e-5)); vec2 nrm = vec2(-d.y, d.x);
    c0.xy += nrm * position.y * uPx / uRes * 2.0 * c0.w; gl_Position = c0;
    vT = t; vS = position.y; vC = iC; vP4 = iP; vLen = distance(iA, iB);
  }`;
export const THREAD_FRAG = /* glsl */ `
  varying float vT, vS; varying vec3 vC; varying vec4 vP4; varying float vLen; uniform float uTime, uGain;
  void main() {
    float core = exp(-vS * vS * 30.0), halo = exp(-vS * vS * 5.0) * 0.12;
    float ph = fract(vT * vLen / 11.0 - uTime * 0.55 + vP4.w); float pulse = pow(1.0 - ph, 14.0) + 0.0;
    float head = vP4.y < 0.995 ? exp(-pow((vP4.y - vT) * vLen / 1.2, 2.0)) * 3.0 : 0.0;
    float k = (core + halo) * (0.62 + 2.2 * pulse * step(0.0, vP4.w) + head) * vP4.z * uGain;
    gl_FragColor = vec4(vC * k, 1.0);
    #include <colorspace_fragment>
  }`;

export const TRAIL_VERT = /* glsl */ `attribute vec4 iSeg; attribute vec2 iMeta; varying float vS, vAge, vK, vU; uniform float uTime;
  void main() { vec2 a = iSeg.xy, b = iSeg.zw, d = b - a; float l = max(1e-4, length(d)); d /= l; vec2 n = vec2(-d.y, d.x); float wd = iMeta.y > 0.5 ? 0.10 : 0.26;
    vec2 p = mix(a, b, position.x) + n * position.y * wd; vS = position.y; vU = position.x; vAge = uTime - iMeta.x; vK = iMeta.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, 0.07, -p.y, 1.0); }`;
export const TRAIL_FRAG = /* glsl */ `varying float vS, vAge, vK, vU; uniform vec3 uCol, uCol2; uniform float uOn;
  void main() { float e = exp(-vS * vS * 5.0), hot = exp(-max(0.0, vAge) / 1.5), tread = vK > 0.5 ? 1.0 : smoothstep(0.30, 0.62, abs(vS)) * 2.2;
    vec3 c = mix(uCol, uCol2, vK); float a = (hot * (vK > 0.5 ? 0.28 : 0.85 * tread) + (vK > 0.5 ? 0.02 : 0.10 * tread)) * e * uOn; gl_FragColor = vec4(c * a, 1.0);
    #include <colorspace_fragment>
  }`;

// Top-down light map: real line-of-sight fans for headlights, sensor sweeps and lead glows, drawn additively.
export const LIGHT_VERT = /* glsl */ `attribute vec4 aL; attribute vec2 aM; varying vec4 vL; varying vec2 vM; void main() { vL = aL; vM = aM; gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, position.y, 0.0, 1.0); }`;
export const LIGHT_FRAG = /* glsl */ `varying vec4 vL; varying vec2 vM; uniform float uTime;
  void main() { float d = length(vL.xy), ty = vM.x; vec4 c = vec4(0.0);
    if (ty < 0.5) { float a = abs(atan(vL.y, vL.x)); float cone = smoothstep(0.78, 0.25, a) * 0.75 + smoothstep(0.34, 0.08, a) * 0.8; c.r = min(1.1, cone) * vL.w * smoothstep(vL.z, vL.z * 0.35, d) / (1.0 + d * d * 0.014) * smoothstep(0.2, 2.2, d); }
    else if (ty < 1.5) { float R = vL.z, ring = smoothstep(R - 0.5, R - 0.12, d) * smoothstep(R + 0.02, R - 0.1, d); float a = atan(vL.y, vL.x) + 3.14159; float sw = fract((a / 6.28318) - uTime * 0.42 + vM.y); c.b = (pow(sw, 5.0) * 0.85 + 0.06) * smoothstep(R, R * 0.2, d) * vL.w + ring * 0.2 * vL.w; }
    else if (ty < 2.5) { c.a = vL.w * smoothstep(vL.z, 0.0, d) / (1.0 + d * d * 0.05); }
    else if (ty < 3.5) { c.g = vL.w * smoothstep(vL.z, 0.0, d) * 0.7; }
    else { float R = vL.z; c.b = vL.w * (smoothstep(R, R * 0.75, d) * 0.22 + smoothstep(R - 0.6, R - 0.1, d) * smoothstep(R, R - 0.1, d) * 0.6); }
    gl_FragColor = c; }`;

export const FINAL = {
  uniforms: { tDiffuse: { value: null }, uExp: { value: 1.2 }, uTime: { value: 0 }, uFade: { value: 1 }, uVig: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */ `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uExp, uTime, uFade, uVig;
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    void main() { vec3 c = texture2D(tDiffuse, vUv).rgb * uExp; vec2 q = vUv - 0.5; c *= 1.0 - uVig * 0.62 * smoothstep(0.32, 0.86, length(q * vec2(1.0, 0.86)));
      c = aces(c); float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, 1.02); c = mix(c, c * vec3(0.97, 1.0, 1.03), (1.0 - smoothstep(0.0, 0.45, l)) * 0.8);
      c = mix(c * 12.92, 1.055 * pow(max(c, 1e-5), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
      c += (fract(sin(dot(vUv * 917.0 + fract(uTime), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.018;
      gl_FragColor = vec4(c * uFade, 1.0); }`,
};
export const SKY_FRAG = /* glsl */ `varying vec3 vD; uniform vec3 uHor, uZen; void main() { float h = clamp(vD.y, -0.2, 1.0); vec3 c = mix(uHor, uZen, smoothstep(0.0, 0.42, h)); c += vec3(0.10, 0.075, 0.05) * exp(-max(0.0, h) * 18.0) * (0.5 + 0.5 * sin(atan(vD.z, vD.x) * 2.0 + 1.0)) * 0.55; gl_FragColor = vec4(c, 1.0); }`;
