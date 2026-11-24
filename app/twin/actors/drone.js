// The scout drone (a concept unit: it does not exist in hardware) and its lidar curtain.
// Everything is driven by state.units['DRONE-01'] and state.map.
//   model: metres, origin on the ground under the skids, nose along local +x, drawn at SCALE.drone
//   layer 'scan': the curtain (the airframe itself always shows)
// Display conventions (said in the report): the airframe is drawn 4x life size; the curtain is the lidar's
// across-track fan directly under the drone, so it meets the growing edge of the swath in state, and it is drawn only
// while the simulator is recording a swath. Its foot follows the measured surface (scan.js, surfaceFor).
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { palette, SCALE, Y, damp, dampAngle, clamp, smoothstep, stateWatcher, disposeTree, ringGeometry } from './common.js';
import { surfaceFor } from './scan.js';

const ID = 'DRONE-01';
const ARM_R = 0.275, ARM_Y = 0.128, PROP_Y = 0.186, PROP_R = 0.127;
// How hard the drawn position chases the simulated one. Stiffer at high sim speed so the lag stays a few metres.
export const chase = (speed) => 10 + 1.2 * (speed || 1);

// [colour, roughness, metalness, carbon weave]
const MAT = {
  shell: [0x44484e, 0.46, 0.1, 0], trim: [0x33363b, 0.58, 0.08, 0], carbon: [0x26282c, 0.38, 0.1, 1], plastic: [0x2f3236, 0.62, 0, 0], rubber: [0x18191b, 0.9, 0, 0],
  seam: [0x0c0d0f, 0.95, 0, 0], battery: [0x2d3034, 0.52, 0, 0], label: [0x5d6269, 0.7, 0, 0], alu: [0x7b8088, 0.4, 0.5, 0], steel: [0x757a82, 0.36, 0.55, 0], bell: [0x3f4349, 0.36, 0.45, 0],
  copper: [0x3b2c22, 0.5, 0.4, 0], wire: [0x1d1f22, 0.5, 0, 0], wire2: [0x4d5157, 0.5, 0, 0], glass: [0x05070b, 0.05, 0.5, 0], window: [0x10161e, 0.09, 0.4, 0],
};

function buildAirframe(THREE, low) {
  const body = [], head = [], col = new THREE.Color();
  const prep = (g, m) => {
    if (g.index) { const n = g.toNonIndexed(); g.dispose(); g = n; }
    g.deleteAttribute('uv'); col.set(m[0]);
    const n = g.attributes.position.count, c = new Float32Array(n * 3), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; a[i * 3] = m[1]; a[i * 3 + 1] = m[2]; a[i * 3 + 2] = m[3]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('aM', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const add = (m, g) => body.push(prep(g, m)), hd = (m, g) => head.push(prep(g, m));
  const up = new THREE.Vector3(0, 1, 0), va = new THREE.Vector3(), vb = new THREE.Vector3(), q = new THREE.Quaternion();
  const tube = (a, b, r0, r1 = r0, seg = 14) => {
    va.set(a[0], a[1], a[2]); vb.set(b[0], b[1], b[2]).sub(va); const len = vb.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
    g.applyQuaternion(q.setFromUnitVectors(up, vb.normalize())); g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    return g;
  };
  const cable = (pts, r) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))), 14, r, 5, false);
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const cyl = (r0, r1, h, x, y, z, seg = 28) => new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z);
  const plan = (s, nose) => { const sh = new THREE.Shape(); const p = [[nose, 0.02 * s], [0.106 * s, 0.04 * s], [0.08 * s, 0.056 * s], [-0.08 * s, 0.056 * s], [-0.116 * s, 0.038 * s], [-0.124 * s, 0.02 * s], [-0.124 * s, -0.02 * s], [-0.116 * s, -0.038 * s], [-0.08 * s, -0.056 * s], [0.08 * s, -0.056 * s], [0.106 * s, -0.04 * s], [nose, -0.02 * s]]; sh.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) sh.lineTo(p[i][0], p[i][1]); sh.closePath(); return sh; };
  const slab = (shape, y0, depth, bevel) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 4 }).rotateX(-Math.PI / 2).translate(0, y0, 0);
  const screw = (x, y, z) => { add(MAT.steel, cyl(0.0027, 0.0027, 0.0016, x, y, z, 8)); add(MAT.seam, cyl(0.0013, 0.0013, 0.0018, x, y + 0.0002, z, 6)); };

  // chassis: carbon plate, standoffs, seam line, upper shell with a raised spine
  add(MAT.carbon, slab(plan(1.02, 0.134), 0.099, 0.004, 0.0006));
  add(MAT.plastic, slab(plan(0.95, 0.124), 0.104, 0.013, 0.002));
  add(MAT.seam, slab(plan(0.955, 0.1245), 0.118, 0.0016, 0));
  add(MAT.shell, slab(plan(0.93, 0.118), 0.123, 0.016, 0.008));
  add(MAT.trim, slab(plan(0.66, 0.088), 0.146, 0.003, 0.0015));
  for (const z of [0.0205, -0.0205]) { add(MAT.seam, box(0.2, 0.0012, 0.0011, -0.004, 0.1475, z * 1.62)); add(MAT.seam, box(0.0011, 0.0012, 0.03, 0.066, 0.1475, z)); }      // panel lines
  for (const x of [0.092, 0.03, -0.034, -0.096]) for (const z of [0.041, -0.041]) screw(x, 0.1478 - (Math.abs(x) > 0.09 ? 0.001 : 0), z);
  for (let i = 0; i < 6; i++) for (const z of [1, -1]) add(MAT.seam, box(0.0022, 0.009, 0.004, -0.02 + i * 0.0062, 0.131, z * 0.0593));                                      // side vents
  for (let i = 0; i < 4; i++) add(MAT.seam, box(0.003, 0.0014, 0.026, 0.083 + i * 0.0062, 0.1476, 0));                                                                           // nose louvres
  // battery in its tray, with cooling ribs, strap, label, plug and lead
  add(MAT.battery, box(0.112, 0.028, 0.054, -0.014, 0.164, 0)); add(MAT.trim, box(0.118, 0.006, 0.06, -0.014, 0.152, 0));
  for (let i = 0; i < 7; i++) add(MAT.seam, box(0.0024, 0.016, 0.0555, -0.056 + i * 0.0062, 0.166, 0));
  add(MAT.label, box(0.026, 0.0012, 0.032, 0.018, 0.1785, 0));
  add(MAT.rubber, box(0.013, 0.0305, 0.0575, -0.008, 0.1645, 0)); add(MAT.alu, box(0.0035, 0.0315, 0.02, -0.001, 0.1652, 0));
  add(MAT.plastic, box(0.014, 0.012, 0.02, -0.078, 0.162, 0));
  add(MAT.wire, cable([[-0.084, 0.162, 0.005], [-0.1, 0.163, 0.01], [-0.104, 0.15, 0.014], [-0.098, 0.142, 0.016]], 0.0022)); add(MAT.wire2, cable([[-0.084, 0.162, -0.005], [-0.1, 0.164, -0.009], [-0.105, 0.151, -0.013], [-0.098, 0.142, -0.016]], 0.0022));
  // GPS puck on a mast, telemetry antennas, rear connector bay
  add(MAT.carbon, tube([-0.1, 0.146, 0], [-0.1, 0.206, 0], 0.0034)); add(MAT.alu, cyl(0.007, 0.008, 0.006, -0.1, 0.149, 0, 16));
  add(MAT.trim, cyl(0.023, 0.0215, 0.009, -0.1, 0.2105, 0, 36)); add(MAT.shell, cyl(0.0205, 0.023, 0.0025, -0.1, 0.2162, 0, 36)); add(MAT.seam, cyl(0.0233, 0.0233, 0.0008, -0.1, 0.2146, 0, 36));
  for (const s of [1, -1]) { add(MAT.alu, cyl(0.0042, 0.0042, 0.007, -0.11, 0.146, 0.03 * s, 10)); add(MAT.rubber, tube([-0.11, 0.148, 0.03 * s], [-0.148, 0.222, 0.05 * s], 0.0027, 0.0017, 8)); }
  add(MAT.seam, box(0.0015, 0.008, 0.024, -0.1235, 0.131, 0));
  // forward obstacle cameras
  for (const s of [1, -1]) { add(MAT.trim, new THREE.CylinderGeometry(0.0062, 0.0062, 0.006, 18).rotateZ(Math.PI / 2).translate(0.1235, 0.129, 0.0125 * s)); add(MAT.glass, new THREE.CylinderGeometry(0.0045, 0.0045, 0.0068, 18).rotateZ(Math.PI / 2).translate(0.1238, 0.129, 0.0125 * s)); }

  // arms: carbon tube in a hinged clamp, phase wires along it, motor with windings and a slotted bell
  const tips = [];
  for (const deg of [45, 135, 225, 315]) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), tx = c * ARM_R, tz = s * ARM_R, at = (r, y, side = 0) => [c * r - s * side, y, s * r + c * side];
    tips.push([tx, tz]);
    add(MAT.carbon, tube(at(0.05, ARM_Y), at(ARM_R, ARM_Y), 0.0098, 0.0082, 18));
    add(MAT.trim, tube(at(0.058, ARM_Y), at(0.09, ARM_Y), 0.0142, 0.0128, 18)); add(MAT.alu, tube(at(0.0905, ARM_Y), at(0.0955, ARM_Y), 0.0125, 0.0125, 18)); add(MAT.alu, tube(at(0.0725, ARM_Y - 0.0165), at(0.0725, ARM_Y + 0.0165), 0.0036, 0.0036, 10)); add(MAT.seam, tube(at(0.0725, ARM_Y + 0.0166), at(0.0725, ARM_Y + 0.0172), 0.002, 0.002, 6));
    add(MAT.rubber, tube(at(0.172, ARM_Y), at(0.176, ARM_Y), 0.0108, 0.0108, 14));
    for (const w of [-1, 0, 1]) add(w ? MAT.wire : MAT.wire2, cable([at(0.094, ARM_Y + 0.0085, w * 0.0034), at(0.13, ARM_Y + 0.0112, w * 0.0034), at(0.174, ARM_Y + 0.0118, w * 0.003), at(0.22, ARM_Y + 0.0105, w * 0.0034), at(0.252, ARM_Y + 0.0135, w * 0.0046)], 0.0013));
    add(MAT.carbon, cyl(0.0255, 0.0255, 0.004, tx, ARM_Y + 0.0075, tz, 28)); for (let k = 0; k < 4; k++) { const b = a + Math.PI / 4 + k * Math.PI / 2; screw(tx + Math.cos(b) * 0.0215, ARM_Y + 0.0102, tz + Math.sin(b) * 0.0215); }
    add(MAT.plastic, cyl(0.013, 0.015, 0.012, tx, ARM_Y, tz, 20));
    add(MAT.alu, cyl(0.0195, 0.0195, 0.003, tx, ARM_Y + 0.011, tz, 28));
    for (let k = 0; k < 12; k++) { const b = (k / 12) * Math.PI * 2; add(MAT.copper, new THREE.BoxGeometry(0.0062, 0.0075, 0.0042).translate(0.0158, 0, 0).rotateY(b).translate(tx, ARM_Y + 0.0165, tz)); }
    add(MAT.bell, cyl(0.0222, 0.0222, 0.014, tx, ARM_Y + 0.0285, tz, 36)); add(MAT.alu, cyl(0.0224, 0.0224, 0.0012, tx, ARM_Y + 0.0222, tz, 36));
    add(MAT.bell, cyl(0.013, 0.0222, 0.005, tx, ARM_Y + 0.038, tz, 36));
    for (let k = 0; k < 6; k++) add(MAT.seam, new THREE.BoxGeometry(0.0075, 0.0008, 0.0026).translate(0.0155, 0, 0).rotateY((k / 6) * Math.PI * 2).translate(tx, ARM_Y + 0.0396, tz));
    add(MAT.steel, cyl(0.0026, 0.0026, 0.022, tx, ARM_Y + 0.05, tz, 10));
    add(MAT.trim, cyl(0.0085, 0.0105, 0.0105, tx, PROP_Y, tz, 18)); add(MAT.alu, cyl(0.004, 0.0055, 0.006, tx, PROP_Y + 0.008, tz, 6));                                               // prop hub
    add(MAT.window, cyl(0.0052, 0.0044, 0.006, tx, ARM_Y - 0.009, tz, 14));                                                                                                       // light housing
  }
  // skids
  for (const sz of [1, -1]) {
    add(MAT.carbon, tube([-0.112, 0.007, 0.086 * sz], [0.112, 0.007, 0.086 * sz], 0.0058, 0.0058, 14));
    for (const x of [0.112, -0.112]) add(MAT.rubber, new THREE.SphereGeometry(0.0074, 14, 10).translate(x, 0.007, 0.086 * sz));
    for (const x of [0.07, -0.07]) { add(MAT.rubber, tube([x - 0.012, 0.007, 0.086 * sz], [x + 0.012, 0.007, 0.086 * sz], 0.0078, 0.0078, 12)); add(MAT.carbon, tube([x * 0.95, 0.007, 0.086 * sz], [x * 0.68, 0.102, 0.044 * sz], 0.0048, 0.0048, 12)); add(MAT.alu, tube([x * 0.705, 0.093, 0.048 * sz], [x * 0.68, 0.101, 0.0445 * sz], 0.0066, 0.0066, 12)); }
  }
  // gimbal: damped plate and yaw motor stay with the body; the head is levelled every frame and looks straight down
  add(MAT.trim, box(0.05, 0.003, 0.046, 0.07, 0.0925, 0)); for (const x of [0.052, 0.088]) for (const z of [0.018, -0.018]) add(MAT.rubber, new THREE.SphereGeometry(0.0042, 10, 8).translate(x, 0.0965, z));
  add(MAT.bell, cyl(0.0125, 0.0125, 0.009, 0.07, 0.0865, 0, 28)); add(MAT.seam, cyl(0.0128, 0.0128, 0.001, 0.07, 0.0875, 0, 28));
  hd(MAT.bell, new THREE.CylinderGeometry(0.0105, 0.0105, 0.012, 24).rotateZ(Math.PI / 2).translate(-0.031, 0, 0));
  hd(MAT.alu, box(0.005, 0.011, 0.062, -0.0225, 0, 0)); for (const s of [1, -1]) { hd(MAT.alu, box(0.036, 0.011, 0.004, -0.0055, 0, 0.0295 * s)); hd(MAT.bell, new THREE.CylinderGeometry(0.0088, 0.0088, 0.007, 22).rotateX(Math.PI / 2).translate(0.008, 0, 0.033 * s)); }
  hd(MAT.shell, box(0.042, 0.03, 0.05, 0.008, 0, 0)); hd(MAT.seam, box(0.0426, 0.001, 0.0506, 0.008, 0.005, 0));
  for (let k = 0; k < 5; k++) hd(MAT.seam, box(0.0428, 0.0012, 0.0016, 0.008, -0.004, -0.016 + k * 0.008));
  hd(MAT.trim, cyl(0.0185, 0.0185, 0.007, 0.008, -0.0185, 0, 32)); hd(MAT.window, cyl(0.0178, 0.0165, 0.011, 0.008, -0.0265, 0, 32)); hd(MAT.trim, cyl(0.0165, 0.014, 0.003, 0.008, -0.0335, 0, 32));      // lidar head
  hd(MAT.trim, cyl(0.0068, 0.0062, 0.009, 0.0255, -0.018, 0.014, 20)); hd(MAT.glass, cyl(0.005, 0.005, 0.0012, 0.0255, -0.0227, 0.014, 20));                                                               // camera
  return { body: mergeGeometries(body), head: mergeGeometries(head), tips };
}

function bladeGeometry(THREE) {
  const pos = [], idx = [], n = 14;
  for (let b = 0; b < 2; b++) {
    const s = b ? -1 : 1, base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const k = i / n, r = 0.01 + (PROP_R - 0.01) * k;
      const chord = (0.009 + 0.016 * Math.sin(Math.PI * Math.min(1, 0.1 + k * 1.25))) * (1 - 0.5 * k * k) * (k > 0.96 ? 0.55 : 1);
      const tw = (30 - 22 * k) * Math.PI / 180, cz = Math.cos(tw) * chord / 2, cy = Math.sin(tw) * chord / 2;
      pos.push(s * r, cy, s * cz, s * r, -cy, -s * cz);
      if (i < n) { const j = base + i * 2; idx.push(j, j + 2, j + 1, j + 1, j + 2, j + 3); }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const flat = g.toNonIndexed(); g.dispose(); flat.computeVertexNormals();
  return flat;
}

// One material for the whole airframe: colour, roughness, metalness and carbon weave come from the vertices.
function frameMaterial(THREE) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec3 aM; varying vec3 vM, vO;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vM = aM; vO = position;');
    sh.fragmentShader = 'varying vec3 vM, vO;\nfloat dh(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }\n' + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n vec2 tq = vec2(vO.x + vO.z, vO.x - vO.z) * 170.0; float tk = vM.z * (1.0 - smoothstep(0.25, 0.7, fwidth(tq.x) + fwidth(tq.y))); float tw = step(0.5, fract((floor(tq.x) + floor(tq.y * 0.5)) * 0.25)) - 0.5; diffuseColor.rgb *= 1.0 + 0.55 * tw * tk;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(vM.x * (0.9 + 0.2 * dh(floor(vO * 700.0))) + 0.16 * tw * tk, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vM.y;');
  };
  m.customProgramCacheKey = () => 'drone-frame';
  return m;
}

const CURTAIN_VERT = /* glsl */ `
attribute vec4 aC;                                                   // across (-1..1), down (0 apex, 1 foot), 1 = the bright line, side (-1..1)
uniform vec3 uApex; uniform float uHalf, uPx; uniform sampler2D uMap; uniform vec4 uBox;
varying vec4 vC;
float surf(vec2 p) { return texture2D(uMap, (p - uBox.xy) / uBox.zw).r; }
void main() {
  vC = aC;
  vec2 a = vec2(uApex.x, -uApex.z);
  float h = surf(a + vec2(0.0, aC.x * uHalf));
  for (int i = 0; i < 3; i++) h = surf(a + vec2(0.0, aC.x * uHalf * (uApex.y - h) / max(uApex.y, 0.1)));
  vec3 foot = vec3(a.x, h + 0.05, -(a.y + aC.x * uHalf * (uApex.y - h) / max(uApex.y, 0.1)));
  vec3 p = mix(uApex, foot, aC.y);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  if (aC.z > 0.5) { p.x += aC.w * max(0.16, 3.6 * -mv.z / uPx); p.y += 0.03; mv = viewMatrix * vec4(p, 1.0); }
  gl_Position = projectionMatrix * mv;
  vec4 q = projectionMatrix * vec4(mv.xy, mv.z + 0.1 + 0.001 * -mv.z, 1.0); if (aC.z > 0.5) gl_Position.z = q.z / q.w * gl_Position.w;
}`;
const CURTAIN_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity, uTick;
varying vec4 vC;
float h1(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  float ends = 1.0 - smoothstep(0.82, 1.0, abs(vC.x)), a;
  if (vC.z > 0.5) {
    float s = vC.w * vC.w;
    a = (exp(-s * 20.0) * 2.0 + exp(-s * 4.0) * 0.07) * ends;
  } else {
    float n = vC.x * 72.0, id = floor(n), f = abs(fract(n) - 0.5) * 2.0, w = max(fwidth(n) * 1.4, 0.16);
    float ray = 1.0 - smoothstep(w * 0.4, w, f), on = smoothstep(0.78, 1.0, h1(vec2(id, uTick)));
    float pulse = 0.5 + 0.5 * smoothstep(0.25, 0.0, abs(fract(vC.y - h1(vec2(id, uTick + 7.0))) - 0.5));
    float down = smoothstep(0.0, 0.35, vC.y);
    a = ends * down * (0.012 + 0.016 * vC.y * vC.y + 0.085 * ray * on * pulse);
  }
  gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
  #include <colorspace_fragment>
}`;

export default {
  id: 'drone', layers: ['scan'],
  create(t) {
    const { THREE } = t, pal = palette(t), low = t.quality === 'low';
    const home = t.world.SITE.dronePad, surface = surfaceFor(t);

    // ---------- airframe ----------
    const root = new THREE.Group(); root.name = 'drone'; root.rotation.order = 'YZX'; root.scale.setScalar(SCALE.drone);
    const parts = buildAirframe(THREE, low), frameMat = frameMaterial(THREE);
    const body = new THREE.Mesh(parts.body, frameMat); body.castShadow = body.receiveShadow = true; root.add(body);
    const gimbal = new THREE.Group(); gimbal.position.set(0.07, 0.07, 0); gimbal.rotation.order = 'ZXY';
    const head = new THREE.Mesh(parts.head, frameMat); head.castShadow = true; gimbal.add(head); root.add(gimbal);

    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x0d0f11, roughness: 0.34, metalness: 0.15, side: THREE.DoubleSide });
    const blades = new THREE.InstancedMesh(bladeGeometry(THREE), bladeMat, 4); blades.frustumCulled = false; blades.castShadow = true;
    const discMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uSpin: { value: 0 }, uPhase: { value: 0 } },
      vertexShader: 'varying vec2 vUv; varying float vI; void main(){ vUv = uv; vI = float(gl_InstanceID); gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform float uSpin, uPhase; varying vec2 vUv; varying float vI;',
        'void main(){',
        '  float r = vUv.y, dir = mod(vI, 2.0) * 2.0 - 1.0;',
        '  float prof = smoothstep(0.04, 0.22, r) * (1.0 - smoothstep(0.86, 1.0, r));',
        '  float g = abs(cos(vUv.x * 6.2831853 + dir * uPhase + vI * 1.3)); g *= g; g *= g; g *= g; g *= g;',   // the two blades, blurred
        '  float a = uSpin * prof * (0.18 + 0.4 * g);',
        '  gl_FragColor = vec4(mix(vec3(0.05, 0.055, 0.06), vec3(0.17, 0.18, 0.2), g * r), a);',
        '  #include <colorspace_fragment>',
        '}'].join('\n'),
    });
    const discs = new THREE.InstancedMesh(ringGeometry(THREE, 0.008, PROP_R, low ? 24 : 56), discMat, 4); discs.frustumCulled = false; discs.renderOrder = 4;
    const m4 = new THREE.Matrix4();
    parts.tips.forEach(([x, z], i) => { discs.setMatrixAt(i, m4.makeTranslation(x, PROP_Y + 0.001, z)); blades.setMatrixAt(i, m4.makeRotationY(i * 0.9).setPosition(x, PROP_Y, z)); });
    root.add(blades, discs);

    // navigation lights: pinpoints, red on the left (port) arms, green on the right, a white strobe under the tail
    const lp = [], lk = [];
    parts.tips.forEach(([x, z]) => { lp.push(x, ARM_Y - 0.0135, z); lk.push(z < 0 ? 0 : 1); });
    lp.push(-0.1, 0.097, 0); lk.push(2);
    const lightGeo = new THREE.BufferGeometry(); lightGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lightGeo.setAttribute('aKind', new THREE.Float32BufferAttribute(lk, 1));
    const lightMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uLeft: { value: pal.danger }, uRight: { value: pal.ok }, uWhite: { value: pal.text }, uStrobe: { value: 0 }, uPx: { value: 1000 }, uScale: { value: 1 } },
      vertexShader: [
        'attribute float aKind; uniform float uPx, uScale, uStrobe; uniform vec3 uLeft, uRight, uWhite; varying vec4 vCol;',
        'void main(){',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  float strobe = step(1.5, aKind), raw = 0.11 * uPx / -mv.z;',
        '  vCol = vec4(strobe > 0.5 ? uWhite : (aKind < 0.5 ? uLeft : uRight), mix(1.0, uStrobe, strobe) * clamp(raw / (2.4 * uScale), 0.45, 1.0));',
        '  gl_PointSize = clamp(raw, 2.4 * uScale, 16.0 * uScale);',
        '  gl_Position = projectionMatrix * mv;',
        '}'].join('\n'),
      fragmentShader: [
        'varying vec4 vCol;',
        'void main(){',
        '  float d = length(gl_PointCoord - 0.5) * 2.0;',
        '  float a = exp(-d * d * 6.0) * (1.0 - smoothstep(0.7, 1.0, d));',
        '  gl_FragColor = vec4(vCol.rgb * 1.1 * a * vCol.a, 1.0);',
        '  #include <colorspace_fragment>',
        '}'].join('\n'),
    });
    const lights = new THREE.Points(lightGeo, lightMat); lights.frustumCulled = false; lights.renderOrder = 5; root.add(lights);

    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    const pick = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), pickMat); pick.position.y = 0.12; root.add(pick);
    t.pickable(root, { type: 'unit', id: ID });
    t.scene.add(root);
    const label = t.label('Scout drone', { tone: 'sim', sub: 'concept', priority: 6, sel: { type: 'unit', id: ID } });

    // the soft dark patch on whatever is below
    const blobMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, uniforms: { uA: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uA; varying vec2 vUv; void main(){ float d = dot(vUv, vUv); gl_FragColor = vec4(0.0, 0.0, 0.0, uA * exp(-d * 3.2) * (1.0 - smoothstep(0.6, 1.0, d))); }',
    });
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), blobMat); blob.renderOrder = 2; blob.name = 'drone-shade'; t.scene.add(blob);

    // ---------- scan layer: the lidar curtain ----------
    const N = low ? 48 : 160, cPos = [], cA = [], cIdx = [];
    const strip = (line) => { const base = cA.length / 4; for (let i = 0; i <= N; i++) { const c = (i / N) * 2 - 1; cA.push(c, line, line, line ? -1 : 0, c, 1, line, line ? 1 : 0); cPos.push(0, 0, 0, 0, 0, 0); if (i < N) { const j = base + i * 2; cIdx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); } } };
    strip(0); strip(1);
    const curtainGeo = new THREE.BufferGeometry(); curtainGeo.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3)); curtainGeo.setAttribute('aC', new THREE.Float32BufferAttribute(cA, 4)); curtainGeo.setIndex(cIdx);
    const flat = surface ? null : new THREE.DataTexture(new Float32Array(1), 1, 1, THREE.RedFormat, THREE.FloatType); if (flat) flat.needsUpdate = true;
    const CU = { uApex: { value: new THREE.Vector3() }, uHalf: { value: 11 }, uPx: { value: 1000 }, uMap: { value: surface ? surface.texture : flat }, uBox: { value: new THREE.Vector4(...(surface ? surface.box : [0, 0, 1, 1])) }, uColor: { value: pal.scan }, uOpacity: { value: 0 }, uTick: { value: 0 } };
    const curtainMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: CU, vertexShader: CURTAIN_VERT, fragmentShader: CURTAIN_FRAG });
    const curtain = new THREE.Mesh(curtainGeo, curtainMat); curtain.name = 'lidar-curtain'; curtain.frustumCulled = false; curtain.renderOrder = 8; curtain.visible = false; t.scene.add(curtain);

    // ---------- state ----------
    const watch = stateWatcher();
    let sx = home[0], sy = home[1], salt = 0, shead = 0, pitch = 0, roll = 0, spin = 0, phase = 0, recOp = 0, layerOn = true, vf = 0;
    const ang = [0, 0.9, 1.8, 2.7], lpos = new THREE.Vector3();

    return {
      update(state, dt, time) {
        const u = state.units[ID]; if (!u) { root.visible = curtain.visible = blob.visible = false; label.setVisible?.(false); return; }
        const fresh = watch(state), pos = u.pos || home, alt = u.alt || 0, mode = u.mode, heading = u.heading || 0, speed = state.speed || 1;
        const airborne = alt > 0.05, powered = mode === 'takeoff' || mode === 'scan' || mode === 'return' || airborne;
        const spinT = airborne ? 1 : mode === 'takeoff' ? 0.22 : 0;
        const list = state.map.swaths;
        let active = -1; if (mode === 'scan') for (let i = 0; i < list.length; i++) if (Math.abs(list[i].y - pos[1]) < 0.5) active = i;

        if (fresh) { sx = pos[0]; sy = pos[1]; salt = alt; shead = heading; pitch = roll = vf = 0; spin = spinT; recOp = active >= 0 ? 1 : 0; }
        else {
          const lam = chase(speed), px = sx, py = sy;
          sx = damp(sx, pos[0], lam, dt); sy = damp(sy, pos[1], lam, dt); salt = damp(salt, alt, lam, dt);
          let err = (heading - shead) % (Math.PI * 2); if (err > Math.PI) err -= Math.PI * 2; else if (err < -Math.PI) err += Math.PI * 2;
          shead = dampAngle(shead, heading, 4.5, dt);
          // nose down while it moves forward, nose up as it slows, banked into the turn: all from the drawn motion
          const inv = dt > 1e-4 ? 1 / (dt * speed) : 0, c = Math.cos(shead), s = Math.sin(shead), f = ((sx - px) * c + (sy - py) * s) * inv, side = (-(sx - px) * s + (sy - py) * c) * inv;
          const was = vf; vf = damp(vf, f, 5, dt);
          const acc = dt > 1e-4 ? (vf - was) / dt : 0;
          pitch = damp(pitch, airborne ? clamp(-0.014 * vf - 0.012 * acc, -0.24, 0.16) : 0, 4, dt);
          roll = damp(roll, airborne ? clamp(-err * 0.38 - side * 0.012, -0.32, 0.32) : 0, 4.5, dt);
          spin = damp(spin, spinT, spinT > spin ? 3.2 : 1.6, dt);
          recOp = damp(recOp, active >= 0 ? 1 : 0, 9, dt);
        }

        // airframe
        const air = t.reduced ? 0 : smoothstep(0.5, 4, salt);
        root.position.set(sx + air * 0.02 * Math.sin(time * 1.1 + 2), t.groundY + salt + air * (Math.sin(time * 1.7) * 0.035 + Math.sin(time * 2.9 + 1.3) * 0.014), -sy);
        root.rotation.set(roll + air * 0.009 * Math.sin(time * 2.1 + 0.7), shead, pitch + air * 0.008 * Math.sin(time * 1.6));
        gimbal.rotation.set(-root.rotation.x, 0, -root.rotation.z);
        const turning = spin > 0.004;
        if (turning && !t.reduced) { const w = spin * dt * 150; for (let i = 0; i < 4; i++) ang[i] += (i % 2 ? -w : w); phase = (phase + dt * 7 * spin) % 6.2831853; }
        blades.visible = spin < 0.5;
        if (blades.visible && turning && !t.reduced) { for (let i = 0; i < 4; i++) blades.setMatrixAt(i, m4.makeRotationY(ang[i]).setPosition(parts.tips[i][0], PROP_Y, parts.tips[i][1])); blades.instanceMatrix.needsUpdate = true; }
        discs.visible = spin > 0.12; discMat.uniforms.uSpin.value = smoothstep(0.12, 0.75, spin); discMat.uniforms.uPhase.value = phase;
        const H = t.renderer.domElement.height, upx = H * 0.5 * t.camera.projectionMatrix.elements[5];
        lights.visible = powered;
        if (powered) {
          const lu = lightMat.uniforms; lu.uPx.value = upx; lu.uScale.value = H / 1000;
          if (t.reduced) lu.uStrobe.value = 0.4; else { const p = time % 1.4; lu.uStrobe.value = 1.1 * Math.max(1 - Math.abs(p - 0.07) / 0.07, 1 - Math.abs(p - 0.26) / 0.07, 0.03); }
        }
        label.setPosition(lpos.set(sx, root.position.y + 0.3 * SCALE.drone, -sy));

        const below = surface ? surface.at(sx, sy) : 0, over = Math.max(0, salt - below);
        blob.visible = true; blob.position.set(sx, t.groundY + below + Y.swath, -sy); blob.scale.setScalar(1.15 + over * 0.035); blobMat.uniforms.uA.value = 0.42 / (1 + over * 0.09);

        // the curtain
        curtain.visible = layerOn && recOp > 0.01;
        if (curtain.visible) {
          CU.uHalf.value = active >= 0 ? list[active].half : CU.uHalf.value; CU.uPx.value = upx;
          CU.uOpacity.value = recOp * smoothstep(1, 8, salt); CU.uTick.value = t.reduced ? 0 : Math.floor(time * 20) % 997;
          CU.uApex.value.set(sx, root.position.y + 0.04 * SCALE.drone, -sy);
        }
      },
      setLayer(id, on) { if (id === 'scan') { layerOn = !!on; if (!layerOn) curtain.visible = false; } },
      onSelect() {},
      dispose() { CU.uMap.value = null; flat?.dispose(); disposeTree(root); disposeTree(blob); disposeTree(curtain); pickMat.dispose(); label.remove(); },
    };
  },
};
