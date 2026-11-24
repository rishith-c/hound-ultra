// The set for the Demo hero: the partition between classrooms 111 and 112 of building B, its plan and wall positions from
// core/world.js, dressed here. Every surface is procedural, built in slices so that opening the page never stalls.
//   patch()       surface (concrete tiles, wood, steel, rubble, brick, paper) and the radio field as light, on lit materials
//   buildStage()  floor, partition (drawn whole, as the wave solver treats it), desks, chairs, rubble
import * as THREE from 'three';

// brightness follows amplitude by one fixed law everywhere, so a wall that takes energy is seen to take it
export const FIELD_GLSL = `
uniform sampler2D uZ, uAmp, uNoise; uniform vec4 uRect; uniform float uPh, uGain, uWarmG; uniform vec3 uCool, uCore, uWarm, uTxw;
float rfIn(vec2 u){ vec2 e = min(u, 1.0 - u) * uRect.zw; return smoothstep(0.7, 2.0, min(e.x, e.y)); }
float rfTone(float a){ return 1.0 - exp(-pow(max(a, 0.0) / uGain, 1.7)); }
float rfWarm(float a){ return 1.0 - exp(-pow(max(a, 0.0) / uWarmG, 1.5)); }
float n1(vec2 p){ return texture2D(uNoise, p / 256.0).r; }
float fbm(vec2 p){ return (0.5 * n1(p) + 0.25 * n1(p * 2.03 + 17.0) + 0.14 * n1(p * 4.1 + 41.0) + 0.07 * n1(p * 8.3 + 7.0)) / 0.96; }
vec3 bumpN(vec3 N, vec3 P, float h){ vec3 sx = dFdx(P), sy = dFdy(P), r1 = cross(sy, N), r2 = cross(N, sx); float det = dot(sx, r1); float fw = length(vec2(dFdx(h), dFdy(h))) / max(length(sx) + length(sy), 1e-5); h *= 1.0 / (1.0 + fw * 4.0); vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2); return normalize(abs(det) * N - g + N * 1e-7); }
`;
const SURF = {
  plain: '',
  floor: `
    vec2 g = vec2(rw.x, -rw.z); float big = fbm(g * 1.7 + 30.0), mid = fbm(g * 11.0), mic = fbm(g * 70.0);
    vec2 cl = abs(fract(g / 0.6) - 0.5) * 0.6; float eg = 0.3 - max(cl.x, cl.y), grout = 1.0 - smoothstep(0.002, 0.010, eg + (mic - 0.5) * 0.004), tn = n1(floor(g / 0.6) * 53.0 + 9.0);
    float crack = 1.0 - smoothstep(0.0, 0.012, abs(fbm(g * 4.0 + 60.0) - 0.5)); crack *= smoothstep(0.55, 0.62, fbm(g * 0.9));
    float dust = smoothstep(0.46, 0.60, big + 0.35 * (mid - 0.5)); dust = max(dust, 0.75 * (1.0 - smoothstep(0.1, 0.55 + 0.3 * mid, abs(rw.x - 75.0))));
    vec3 c = mix(vec3(0.050, 0.053, 0.058), vec3(0.098, 0.098, 0.098), 0.45 * tn + 0.55 * mid); c = mix(c, vec3(0.150, 0.136, 0.118) * (0.7 + 0.6 * mic), dust * 0.75); c *= 1.0 - 0.65 * grout * (1.0 - 0.5 * dust); c *= 1.0 - 0.7 * crack; c *= 1.0 - 0.85 * max(smoothstep(57.6, 60.0, g.y), smoothstep(83.5, 86.0, g.x));
    kA = c * (0.82 + 0.36 * mic); kR = mix(0.30 + 0.2 * mid, 0.95, dust); kH = mid * 0.004 * (0.3 + 0.7 * dust) ; kWet = (1.0 - dust) * (1.0 - 0.7 * grout) * 0.55;`,
  wood: `
    vec2 w = vec2(vLoc.x * 9.0 + vId * 31.0, (vLoc.z * 1.0 + vLoc.y * 0.6) * 210.0 + vId * 17.0); w.y += 4.0 * n1(vec2(vLoc.x * 14.0 + vId * 5.0, vLoc.z * 18.0));
    float gr = fbm(w), ray = n1(w * vec2(3.0, 4.0)); vec3 c = mix(vec3(0.17, 0.092, 0.046), vec3(0.36, 0.215, 0.112), smoothstep(0.15, 0.85, gr)); c *= 0.8 + 0.35 * ray; c *= 0.75 + 0.5 * n1(vec2(vId * 37.0, 5.0));
    float du = smoothstep(0.35, 0.95, wn.y) * smoothstep(0.36, 0.64, fbm(vec2(rw.x, rw.z) * 16.0)); kA = mix(c, vec3(0.19, 0.17, 0.145), du * 0.6); kR = mix(0.48 + 0.2 * gr, 0.95, du); kH = gr * 0.0012;`,
  metal: `
    float ru1 = fbm(vec2(vLoc.y * 60.0 + vId * 13.0, (vLoc.x + vLoc.z) * 60.0)), rust = smoothstep(0.50, 0.66, ru1 + 0.16 * (1.0 - smoothstep(0.0, 0.5, rw.y)));
    kA = mix(vec3(0.125, 0.145, 0.15) * (0.8 + 0.4 * ru1), vec3(0.115, 0.047, 0.020) * (0.6 + 0.9 * ru1), rust); kR = mix(0.34, 0.9, rust); kH = rust * 0.0008 + ru1 * 0.0004;
    float du = smoothstep(0.5, 1.0, wn.y) * 0.5; kA = mix(kA, vec3(0.17, 0.155, 0.135), du);`,
  rubble: `
    vec3 an = abs(wn); vec2 q = an.y > an.x && an.y > an.z ? rw.xz : an.x > an.z ? rw.zy : rw.xy; float f1 = fbm(q * 22.0 + vId * 9.0), f2 = fbm(q * 130.0), ag = smoothstep(0.62, 0.70, n1(q * 420.0 + 5.0));
    vec3 c = mix(vec3(0.105, 0.102, 0.098), vec3(0.235, 0.228, 0.215), f1) * (0.7 + 0.6 * f2); c = mix(c, vec3(0.30, 0.27, 0.23), ag * 0.4); float du = smoothstep(0.25, 0.9, wn.y) * (0.45 + 0.6 * f1); kA = mix(c, vec3(0.265, 0.245, 0.215), clamp(du, 0.0, 0.85) * 0.75); kR = 0.95; kH = f1 * 0.012;`,
  brick: `
    float f1 = fbm(vLoc.xz * 160.0 + vId * 21.0); vec3 c = mix(vec3(0.115, 0.036, 0.022), vec3(0.235, 0.092, 0.058), f1) * (0.7 + 0.6 * n1(vec2(vId * 41.0, 3.0))); float du = smoothstep(0.2, 0.95, wn.y) * (0.4 + 0.5 * f1); kA = mix(c, vec3(0.235, 0.21, 0.18), clamp(du, 0.0, 0.8)); kR = 0.95; kH = f1 * 0.004;`,
  plaster: `
    vec2 q = abs(wn.x) > 0.5 ? vec2(rw.z, rw.y) : vec2(rw.x, rw.y); float f1 = fbm(q * 5.0), f2 = fbm(q * 60.0), st = fbm(vec2(q.x * 26.0, q.y * 1.4)); vec3 c = mix(vec3(0.13, 0.128, 0.12), vec3(0.205, 0.20, 0.187), f1) * (0.85 + 0.3 * f2); float tide = 1.0 - smoothstep(1.05, 1.2, q.y + 0.16 * (f1 - 0.5)); c *= mix(1.0, 0.55 + 0.25 * st, tide); kA = 2.2 * c * (1.0 - 0.3 * smoothstep(0.55, 0.75, st) * tide); kR = 0.9; kH = f2 * 0.003;`,
  paper: `
    float ln = step(0.45, fract(vLoc.z * 70.0)) * step(abs(vLoc.x), 0.075) * step(abs(vLoc.z), 0.115) * step(0.35, n1(vec2(vLoc.x * 300.0, floor(vLoc.z * 70.0) * 9.0 + vId * 3.0))); kA = vec3(0.34, 0.33, 0.30) * (0.7 + 0.5 * fbm(rw.xz * 30.0)) * (1.0 - 0.28 * ln); kR = 0.9;`,
};
export function patch(mat, shared, kind = 'plain') {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLoc; varying float vId;').replace('#include <begin_vertex>', `#include <begin_vertex>
      vLoc = position; vId = 0.0;
      #ifdef USE_INSTANCING
        vLoc *= vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)); vId = float(gl_InstanceID % 97);
      #endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLoc; varying float vId;\n' + FIELD_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 rw = transpose(mat3(viewMatrix)) * (-vViewPosition) + cameraPosition, wn = normalize(transpose(mat3(viewMatrix)) * normalize(vNormal)); vec3 kA = diffuseColor.rgb; float kR = -1.0, kH = 0.0, kWet = 0.0;
        ${SURF[kind]}
        diffuseColor.rgb = kA;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n if (kR >= 0.0) roughnessFactor = kR;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + (kind === 'plain' || kind === 'paper' ? '' : 'normal = bumpN(normal, -vViewPosition, kH);'))
      .replace('#include <opaque_fragment>', `
        vec2 ru = (vec2(rw.x, -rw.z) - uRect.xy) / uRect.zw; float rin = rfIn(ru); vec2 rA = textureLod(uAmp, ru, 3.5).xy; float rT = rfTone(rA.x) * rin, rD = rfWarm(rA.y) * rin;
        if (!(dot(outgoingLight, vec3(1.0)) >= 0.0)) outgoingLight = vec3(0.0);
        outgoingLight += min(diffuseColor.rgb, vec3(0.4)) * (uCool * rT * 1.5 + uWarm * rD * 0.45) * (0.3 + 0.7 * exp(-max(rw.y, 0.0) * 0.6)) * (0.5 + 0.5 * dot(wn, normalize(uTxw + vec3(0.0, 0.85, 0.0) - rw)) + 0.25);
        ${kind === 'floor' ? `
        vec4 rz = texture2D(uZ, ru); vec2 ra = texture2D(uAmp, ru).xy, rp = vec2(cos(uPh), sin(uPh));
        float cT = dot(rz.xy, rp) / max(length(rz.xy), 1e-5), cD = dot(rz.zw, rp) / max(length(rz.zw), 1e-5), eT = rfTone(ra.x) * rin, eD = rfWarm(ra.y) * rin, up = smoothstep(0.1, 1.0, wn.y);
        float crest = smoothstep(0.0, 1.0, cT), ring = smoothstep(0.35, 0.98, cD); crest *= crest;
        outgoingLight *= 1.0 - 0.5 * eT * smoothstep(0.1, -0.9, cT);
        float wet = 0.75 + 0.5 * (1.0 - roughnessFactor), blue = eT * (1.0 - 0.6 * eD * ring);
        outgoingLight += (mix(uCool, uCore, 0.5 * smoothstep(0.35, 1.0, blue * crest)) * blue * (crest * 0.62 + 0.012) + uWarm * eD * ring * 1.05) * wet * up;` : ''}
        #include <opaque_fragment>
        ${kind === 'floor' ? 'gl_FragColor.a = 1.0 - kWet * smoothstep(0.5, 0.9, wn.y);' : ''}`);
  };
  mat.customProgramCacheKey = () => 'radio|' + kind;
  return mat;
}

export function noiseTexture() {
  const N = 256, d = new Uint8Array(N * N); let a = 20261124; for (let i = 0; i < d.length; i++) { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); d[i] = (t ^ (t >>> 14)) & 255; }
  const t = new THREE.DataTexture(d, N, N, THREE.RedFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t;
}

// the partition between 111 and 112: plasterboard on steel studs, half see-through, lit by the wave that crosses it
function partition(shared, h) {
  const mat = new THREE.ShaderMaterial({ uniforms: { ...shared, uK: { value: 0 }, uTxh: { value: 0.8 }, uH: { value: h } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    vertexShader: 'varying vec3 vW, vN; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: FIELD_GLSL + `varying vec3 vW, vN; uniform float uK, uTxh, uH;
      void main(){ if (vN.y < -0.5) discard; vec3 n = normalize(vN), V = normalize(cameraPosition - vW); float side = step(0.5, abs(n.x)), s = -vW.z, y = vW.y;
        vec2 u = (vec2(vW.x, s) - uRect.xy) / uRect.zw; float rin = rfIn(u);
        float f1 = fbm(vec2(s, y) * 6.0), f2 = fbm(vec2(s, y) * 70.0), st = fbm(vec2(s * 30.0, y * 1.5)), tide = 1.0 - smoothstep(0.95, 1.15, y + 0.2 * (f1 - 0.5));
        vec3 alb = mix(vec3(0.16, 0.165, 0.17), vec3(0.27, 0.27, 0.265), f1) * (0.8 + 0.4 * f2); alb *= mix(1.0, 0.45 + 0.4 * st, tide);
        float sd = abs(fract(s / 0.6 + 0.5) - 0.5) * 0.6, stud = 1.0 - smoothstep(0.022, 0.028, sd), seam = 1.0 - smoothstep(0.003, 0.007, abs(fract(s / 1.2 + 0.25) - 0.5) * 1.2);
        float fres = pow(1.0 - abs(dot(n, V)), 2.0), key = exp(-dot(vec2(s - 50.0, y - 0.8), vec2(s - 50.0, y - 0.8)) * 0.10);
        float al = mix(0.22, 0.58, 1.0 - smoothstep(0.0, 0.95, y)) + 0.10 * stud + 0.12 * fres - 0.10 * seam;
        vec3 c = alb * (vec3(0.13, 0.16, 0.21) + vec3(1.0, 0.72, 0.46) * key * step(0.5, -n.x) * 0.42) * (1.0 - 0.35 * stud);
        vec2 un = (vec2(uTxw.x > 75.0 ? 75.06 : 74.94, s) - uRect.xy) / uRect.zw; vec4 z = texture2D(uZ, un); vec2 a = textureLod(uAmp, un, 1.0).xy;
        float r = length(vec2(vW.x, s) - vec2(uTxw.x, -uTxw.z)), dz = y - uTxh, ex = uK * (sqrt(r * r + dz * dz) - r); vec2 p = vec2(cos(uPh - ex), sin(uPh - ex));
        float cT = dot(z.xy, p) / max(length(z.xy), 1e-5), eT = rfTone(a.x * sqrt((r + 0.12) / (sqrt(r * r + dz * dz) + 0.12))) * rin, cD = dot(z.zw, vec2(cos(uPh), sin(uPh))) / max(length(z.zw), 1e-5), eD = rfWarm(a.y) * rin * exp(-y * 0.5);
        float crest = smoothstep(0.1, 1.0, cT);
        vec3 glow = uCool * eT * (0.07 + 0.42 * crest * crest) + uWarm * eD * smoothstep(0.4, 1.0, cD) * 0.16;
        c = c * al + glow * side;
        if (side < 0.5) { float top = step(0.5, abs(n.y)); c = mix(vec3(0.20, 0.205, 0.21) * (0.7 + 0.5 * f2), vec3(0.50, 0.54, 0.58), top * 0.6) + uCool * eT * 0.5; al = 1.0; float core = smoothstep(0.034, 0.038, abs(vW.x - 75.0)); c *= mix(0.32, 1.0, core); }
        gl_FragColor = vec4(c, al); }` });
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, h, 11.9), mat); m.position.set(75, h / 2, -52.0); m.renderOrder = 3; return m;
}

export async function buildStage({ scene, shared, slice, K }) {
  const group = new THREE.Group(); scene.add(group); let sd = 77; const R = () => { sd = (sd + 0x6d2b79f5) >>> 0; let t = Math.imul(sd ^ (sd >>> 15), sd | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }, rr = (a, b) => a + (b - a) * R();
  const std = (kind, o = {}) => patch(new THREE.MeshStandardMaterial({ roughness: 0.9, ...o }), shared, kind);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), std('floor')); floor.position.set(75, 0, -51); floor.receiveShadow = true; group.add(floor);
  const wall = partition(shared, 2.2); wall.material.uniforms.uK.value = K; group.add(wall);
  const solid = std('plaster'); const bx = (w, hh, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), solid); m.position.set(x, y + hh / 2, -z); m.receiveShadow = true; group.add(m); return m; };
  bx(12, 3.2, 0.2, 72, 0, 58); bx(0.1, 3.2, 12, 66, 0, 52); bx(0.2, 3.2, 4, 84, 0, 48);
  for (const [a, b] of [[66.1, 69.9], [71.3, 78.9], [80.3, 84]]) bx(b - a, 0.09, 0.1, (a + b) / 2, 0, 46);                  // the corridor wall, cut low so the room can be seen
  await slice();
  // ---- everything small is instanced: one draw per material ----
  const lists = { wood: [], metal: [], rubble: [], brick: [], paper: [], rod: [] }, M = new THREE.Matrix4(), E = new THREE.Euler(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const mtx = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz, 'YXZ')), S.set(w, h, d));
  const base = (x, y, hh, ry, rx, rz) => new THREE.Matrix4().compose(new THREE.Vector3(x, hh, -y), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
  const add = (k, B, ...a) => lists[k].push(B.clone().multiply(mtx(...a)));
  const desk = (x, y, ry, rx = 0, rz = 0, hh = 0) => { const B = base(x, y, hh, ry, rx, rz); add('wood', B, 1.1, 0.026, 0.42, 0, 0.735, -0.2); add('wood', B, 1.04, 0.016, 0.32, 0, 0.58, -0.22); add('wood', B, 1.04, 0.2, 0.014, 0, 0.47, -0.39); add('wood', B, 1.1, 0.026, 0.25, 0, 0.43, 0.27); add('wood', B, 1.1, 0.11, 0.018, 0, 0.71, 0.415);
    for (const s of [-0.52, 0.52]) { for (const [z, t] of [[-0.39, 0.73], [-0.03, 0.73], [0.42, 0.78], [0.17, 0.42]]) add('metal', B, 0.028, t, 0.028, s, t / 2, z); add('metal', B, 0.026, 0.026, 0.84, s, 0.05, 0.015); add('metal', B, 0.022, 0.022, 0.4, s, 0.56, -0.21); } add('metal', B, 1.04, 0.024, 0.024, 0, 0.12, -0.39); };
  const chair = (x, y, ry, rx = 0, rz = 0, hh = 0) => { const B = base(x, y, hh, ry, rx, rz); add('wood', B, 0.4, 0.02, 0.38, 0, 0.44, 0); add('wood', B, 0.4, 0.17, 0.016, 0, 0.72, 0.19); for (const s of [-0.18, 0.18]) { add('metal', B, 0.022, 0.43, 0.022, s, 0.215, -0.17); add('metal', B, 0.022, 0.82, 0.022, s, 0.41, 0.19); add('metal', B, 0.02, 0.02, 0.36, s, 0.15, 0.01); } };
  desk(72.35, 51.3, 1.45); desk(72.05, 52.85, 1.62); desk(73.15, 54.35, 1.9); desk(71.2, 50.0, 1.2); desk(70.6, 53.4, 1.4); chair(73.05, 52.45, 0.4, 0, Math.PI / 2, 0.2); chair(71.25, 51.5, -0.5); chair(72.6, 49.35, 2.4, -Math.PI / 2, 0, 0.2);
  desk(78.5, 48.25, 0.35); desk(80.1, 47.6, -0.3); desk(76.2, 54.6, 2.2, 0, 0.55, 0.1); chair(79.4, 49.0, 2.1); chair(77.35, 53.9, 0.9, Math.PI / 2, 0, 0.2); desk(78.4, 55.6, 0.5, Math.PI * 0.5, 0, 0.42);
  await slice();
  const keep = (x, y, r) => (x > 75.6 - r && x < 78.6 + r && y > 49.4 - r && y < 53.2 + r) || Math.hypot(x - 74.7, y - 50.25) < 1.25 + r;
  const rock = (x, y, h, s, flat = 0.75) => lists.rubble.push(mtx(s * rr(0.8, 1.5), s * rr(0.5, 1) * flat, s * rr(0.7, 1.3), x, h, -y, rr(-0.6, 0.6), rr(0, 6.3), rr(-0.6, 0.6)));
  const pile = (cx, cy, rad, hh, n) => { for (let i = 0; i < n; i++) { const a = rr(0, 6.283), q = Math.sqrt(R()) * rad, x = cx + Math.cos(a) * q, y = cy + Math.sin(a) * q; if (keep(x, y, 0.1)) continue; const t = 1 - q / rad, s = rr(0.12, 0.42) * (0.55 + 0.6 * t); rock(x, y, t * hh * rr(0.45, 1) + s * 0.2, s); } };
  pile(79.9, 53.6, 1.7, 1.25, 90); pile(78.9, 55.6, 1.6, 0.9, 60); pile(80.4, 51.2, 1.0, 0.5, 34); pile(75.9, 56.3, 1.1, 0.5, 26);
  for (let i = 0; i < 170; i++) { const x = rr(75.3, 81), y = rr(46.4, 56.5), s = rr(0.02, 0.085); if (s > 0.045 && keep(x, y, 0)) continue; rock(x, y, s * 0.3, s); }
  for (let i = 0; i < 46; i++) { const x = rr(70, 74.9), y = rr(46.4, 55.5), s = rr(0.015, 0.05); if (keep(x, y, -0.4)) continue; rock(x, y, s * 0.3, s); }
  for (let i = 0; i < 46; i++) { const x = rr(76, 81), y = rr(47, 56), pl = R() < 0.6; const px = pl ? 79.6 + rr(-1.6, 1.2) : x, py = pl ? 53.4 + rr(-1.9, 1.8) : y; if (keep(px, py, 0.1)) continue; lists.brick.push(mtx(0.22, 0.07, 0.105, px, pl ? rr(0.05, 0.6) : 0.04, -py, pl ? rr(-0.8, 0.8) : 0, rr(0, 6.3), pl ? rr(-0.8, 0.8) : 0)); }
  lists.rubble.push(mtx(2.3, 0.16, 1.5, 79.9, 0.62, -52.9, 0.16, 0.5, 0.4)); lists.rubble.push(mtx(1.5, 0.15, 1.1, 78.95, 0.42, -54.5, -0.45, 1.2, 0.2));
  for (let i = 0; i < 9; i++) lists.rod.push(mtx(0.014, rr(0.5, 1.2), 0.014, 78.75 + rr(-0.25, 0.3), 0.75 + rr(-0.1, 0.25), -(53.1 + i * 0.16 - 0.6), rr(-0.5, 0.5), rr(0, 6), 1.1 + rr(-0.45, 0.45)));
  for (let i = 0; i < 30; i++) { const lft = R() < 0.55, x = lft ? rr(71.5, 74.7) : rr(75.4, 79), y = rr(47, 55); lists.paper.push(mtx(0.21, 0.002, 0.297, x, 0.006 + R() * 0.004, -y, rr(-0.03, 0.03), rr(0, 6.3), rr(-0.03, 0.03))); }
  await slice();
  const cube = new THREE.BoxGeometry(1, 1, 1); let chunk; { const g = new THREE.BoxGeometry(1, 1, 1, 3, 3, 3), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = (a, b, c) => { const s = Math.sin(a * 12.9 + b * 78.2 + c * 37.7) * 43758.5; return s - Math.floor(s) - 0.5; }, r = 1 - 0.26 * (Math.abs(x) + Math.abs(y) + Math.abs(z) - 0.5); p.setXYZ(i, x * r + 0.17 * k(x, y, z), y * r + 0.17 * k(z, x, y), z * r + 0.17 * k(y, z, x)); } chunk = g.toNonIndexed(); chunk.computeVertexNormals(); }
  for (const [k, geo, kind, o] of [['wood', cube, 'wood'], ['metal', cube, 'metal', { metalness: 0.3 }], ['rod', new THREE.CylinderGeometry(0.5, 0.5, 1, 7), 'metal', { metalness: 0.3 }], ['rubble', chunk, 'rubble'], ['brick', cube, 'brick'], ['paper', cube, 'paper']]) {
    const im = new THREE.InstancedMesh(geo, std(kind, o), lists[k].length); for (let i = 0; i < lists[k].length; i++) im.setMatrixAt(i, lists[k][i]); im.castShadow = k !== 'paper'; im.receiveShadow = true; im.frustumCulled = false; group.add(im); await slice();
  }
  return { group, wall };
}
