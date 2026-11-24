// HOUND-01. The drive base is the real CAD (assets/models/rover_cad.glb): 2020 frame, NEMA 17 motors on their printed
// mounts, four mecanum wheels with eight free rollers each, deck tiles, battery cradle, and the sweep bridge that slides
// the two 24 GHz radars. Baking (positions, normals, material ids, welded) put it in assets/models/hound01.bin
// (11 MB, 241 meshes -> one draw call per moving part). The CAD holds the electronics only as "envelope" boxes, so the
// boards, battery, cables, mast, antennas, thermal camera and headlights are modelled here at the CAD positions.
//
// Driven only by state.units['HOUND-01'] (pos, heading, mode, odo), state.sensors.listen, state.hold and state.faults.
// Drawn at SCALE.rover (1.5x) so it reads from an overview; the proportions are true.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SCALE, Y, FONT, palette, damp, dampAngle, clamp, stateWatcher, disposeTree, decalMaterial, canvasTexture } from './common.js';

const R = 0.05, RR = 0.01;        // wheel and roller radius, m
const DECK = 0.108, FY = 0.085;   // top of the deck tiles, centre of the frame rails
const MODEL = new URL('../../../assets/models/hound01.bin', import.meta.url).href;
// class -> metalness, roughness, brushed
const CLS = { metal: [1, 0.36, 1], matte: [0, 0.6, 0], gloss: [0, 0.3, 0] };

// Collects geometry into one mesh: colour and material live in the vertices, so the whole static body is one draw call.
function builder(THREE) {
  const bin = [], M = new THREE.Matrix4(), Qn = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();
  return {
    add(cls, color, geo, pos = [0, 0, 0], rot = [0, 0, 0], scl = 1) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      M.compose(P.set(pos[0], pos[1], pos[2]), Qn.setFromEuler(E.set(rot[0], rot[1], rot[2])), typeof scl === 'number' ? S.set(scl, scl, scl) : S.set(scl[0], scl[1], scl[2]));
      g.applyMatrix4(M); C.set(color);
      const n = g.attributes.position.count, col = new Float32Array(n * 3), pbr = new Float32Array(n * 4), c = CLS[cls];
      for (let i = 0; i < n; i++) { col[i * 3] = C.r; col[i * 3 + 1] = C.g; col[i * 3 + 2] = C.b; pbr[i * 4] = c[0]; pbr[i * 4 + 1] = c[1]; pbr[i * 4 + 2] = c[2]; pbr[i * 4 + 3] = 0.12; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 4));
      bin.push(g); geo.dispose();
      return this;
    },
    build(parent, mat) { const m = new THREE.Mesh(mergeGeometries(bin, false), mat); m.castShadow = m.receiveShadow = true; parent.add(m); bin.length = 0; return m; },
  };
}

// One physically based material for the whole machine. Metalness, roughness and brushing come from the vertices;
// road mud, dust, wear and droplets come from noise in the part's own space, so they stay put as it moves.
function machineMaterial(THREE) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 1, envMapIntensity: 2.1 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec4 aPbr; varying vec4 vPbr; varying vec3 vObj; varying vec3 vObjN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vPbr = aPbr; vObj = position; vObjN = normal;');
    sh.fragmentShader = `varying vec4 vPbr; varying vec3 vObj; varying vec3 vObjN;
      float rh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float rn(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(rh(i), rh(i + vec3(1, 0, 0)), f.x), mix(rh(i + vec3(0, 1, 0)), rh(i + vec3(1, 1, 0)), f.x), f.y), mix(mix(rh(i + vec3(0, 0, 1)), rh(i + vec3(1, 0, 1)), f.x), mix(rh(i + vec3(0, 1, 1)), rh(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
      float rDirt;\n` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rA = rn(vObj * 46.0), rB = rn(vObj * 170.0 + 9.0), rC = rn(vObj * 620.0);
        float rUp = smoothstep(0.35, 0.9, vObjN.y);
        rDirt = smoothstep(0.78 - vPbr.w * 0.72, 1.12 - vPbr.w * 0.5, rA * 0.42 + rB * 0.33 + rC * 0.25) * clamp(vPbr.w * 1.3, 0.0, 0.85);
        float rDust = rUp * 0.22 * smoothstep(0.4, 0.75, rA);
        diffuseColor.rgb *= 0.9 + 0.2 * rB;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.105, 0.082, 0.06) * (0.7 + 0.7 * rC), max(rDirt, rDust));`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = vPbr.y;
        float rS = rn(vec3(vObj.x * 18.0, vObj.y * 1500.0, vObj.z * 1500.0)) * step(abs(vObjN.x), 0.5) + rn(vec3(vObj.x * 1500.0, vObj.y * 1500.0, vObj.z * 18.0)) * step(0.5, abs(vObjN.x));
        float rF = 1.0 - smoothstep(0.0004, 0.0016, max(length(dFdx(vObj)), length(dFdy(vObj))));
        roughnessFactor += (rS - 0.5) * 0.22 * vPbr.z * rF + (rB - 0.5) * 0.12;
        roughnessFactor = clamp(mix(roughnessFactor, 0.9, max(rDirt, rUp * 0.2)), 0.05, 1.0);`)
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.x * (1.0 - rDirt);');
  };
  mat.customProgramCacheKey = () => 'hound01';
  return mat;
}

export default {
  id: 'rover',
  layers: [],
  create(t) {
    const { THREE } = t, pal = palette(t), low = t.quality === 'low';
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const rbox = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 2, r);
    const cyl = (r, h, seg = 16, r2 = r) => new THREE.CylinderGeometry(r2, r, h, seg);
    const HP = Math.PI / 2;
    const COL = { alu: 0xc4c8cc, aluDark: 0x2b2e34, steel: 0xa2a8af, brass: 0xc09a48, black: 0x14161a, pcbGreen: 0x0e5c3a, pcbTeal: 0x0b5568, pcbRed: 0x7a1a1a, pcbPurple: 0x40266a, pcbBlack: 0x0d0f11, chip: 0x070809, wrap: 0x1b2b50, white: 0xc9c9c2, yellow: 0xb8951c, red: 0x9c211a, grey: 0x6c737b, lens: 0x05070a, blueTerm: 0x1d4690 };

    const root = new THREE.Group(); root.name = 'HOUND-01'; root.scale.setScalar(SCALE.rover);
    const chassis = new THREE.Group(); root.add(chassis);
    const mat = machineMaterial(THREE);
    const b = builder(THREE);
    const slot = new THREE.Shape();
    [[-10, -10], [-3, -10], [-3, -5.5], [3, -5.5], [3, -10], [10, -10], [10, -3], [5.5, -3], [5.5, 3], [10, 3], [10, 10], [3, 10], [3, 5.5], [-3, 5.5], [-3, 10], [-10, 10], [-10, 3], [-5.5, 3], [-5.5, -3], [-10, -3]]
      .forEach(([x, y], i) => (i ? slot.lineTo(x / 1000, y / 1000) : slot.moveTo(x / 1000, y / 1000)));
    const rail = (len) => new THREE.ExtrudeGeometry(slot, { depth: len, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -len / 2);

    // deck fixing screws, and the tape edge of each CAD deck tile
    for (const x of [-0.165, -0.01, 0.01, 0.165]) for (const z of [-0.165, -0.01, 0.01, 0.165]) { b.add('metal', COL.steel, cyl(0.0034, 0.002, 10), [x, DECK + 0.001, z]); b.add('matte', COL.chip, cyl(0.0016, 0.0005, 6), [x, DECK + 0.0021, z]); }

    // ---------- mast: 2040 extrusion, crossbar, the ESP32-S3 CSI receiver and its two antennas ----------
    const MX = -0.158, MZ = 0, MH = 0.3;
    for (const dz of [-0.01, 0.01]) b.add('metal', COL.alu, rail(MH), [MX, DECK + MH / 2, MZ + dz], [HP, 0, 0]);
    b.add('matte', COL.black, box(0.021, 0.003, 0.041), [MX, DECK + MH + 0.0015, MZ]);
    for (const dz of [-0.029, 0.029]) { b.add('metal', COL.steel, box(0.02, 0.02, 0.003), [MX, DECK + 0.01, MZ + dz]); b.add('metal', COL.steel, box(0.02, 0.003, 0.02), [MX, DECK + 0.0015, MZ + dz + Math.sign(dz) * 0.0085]); }
    const BAR = DECK + MH - 0.016;
    b.add('metal', COL.alu, rbox(0.03, 0.012, 0.23, 0.002), [MX + 0.0255, BAR, MZ]);
    b.add('matte', COL.pcbBlack, box(0.0016, 0.052, 0.026), [MX + 0.0125, DECK + 0.2, MZ]);              // ESP32-S3 dev board
    b.add('metal', COL.steel, box(0.003, 0.018, 0.016), [MX + 0.0145, DECK + 0.212, MZ]);                // RF shield can
    b.add('metal', COL.steel, box(0.006, 0.007, 0.009), [MX + 0.0155, DECK + 0.177, MZ]);                // USB-C
    b.add('metal', COL.brass, box(0.0022, 0.05, 0.002), [MX + 0.0135, DECK + 0.2, MZ - 0.0115]);         // pin headers
    b.add('metal', COL.brass, box(0.0022, 0.05, 0.002), [MX + 0.0135, DECK + 0.2, MZ + 0.0115]);
    b.add('matte', COL.black, cyl(0.0065, 0.004, 14), [MX, DECK + MH + 0.005, MZ]);                      // status LED base

    // ---------- Raspberry Pi 4 ----------
    const RX = -0.0915, RZ = -0.093, RY = DECK + 0.011;
    for (const dx of [-0.038, 0.02]) for (const dz of [-0.0245, 0.0245]) b.add('metal', COL.brass, cyl(0.0028, 0.008, 6), [RX + dx, DECK + 0.004, RZ + dz]);
    b.add('matte', COL.pcbGreen, box(0.085, 0.0016, 0.056), [RX, RY, RZ]);
    b.add('metal', COL.steel, box(0.021, 0.0135, 0.016), [RX - 0.034, RY + 0.0075, RZ - 0.0175]);        // Ethernet
    b.add('metal', COL.steel, box(0.0175, 0.0155, 0.0135), [RX - 0.0355, RY + 0.0085, RZ + 0.001]);      // USB 3
    b.add('metal', COL.steel, box(0.0175, 0.0155, 0.0135), [RX - 0.0355, RY + 0.0085, RZ + 0.0185]);     // USB 2
    b.add('matte', 0x1a4fb5, box(0.002, 0.004, 0.011), [RX - 0.0445, RY + 0.0085, RZ + 0.001]);
    b.add('matte', COL.black, box(0.051, 0.0085, 0.005), [RX + 0.0075, RY + 0.005, RZ - 0.0245]);        // GPIO header
    b.add('metal', COL.brass, box(0.049, 0.003, 0.003), [RX + 0.0075, RY + 0.0105, RZ - 0.0245]);
    b.add('metal', COL.alu, box(0.015, 0.0025, 0.015), [RX + 0.011, RY + 0.002, RZ + 0.003]);            // SoC lid
    for (let i = 0; i < 5; i++) b.add('metal', COL.aluDark, box(0.015, 0.006, 0.0012), [RX + 0.011, RY + 0.006, RZ - 0.003 + i * 0.003]);  // heatsink fins
    b.add('matte', COL.chip, box(0.012, 0.0014, 0.009), [RX - 0.009, RY + 0.0015, RZ + 0.004]);          // RAM
    b.add('metal', COL.steel, box(0.009, 0.0032, 0.0075), [RX + 0.03, RY + 0.0025, RZ + 0.025]);         // USB-C power
    for (const dx of [0.008, 0.0215]) b.add('metal', COL.steel, box(0.007, 0.003, 0.0075), [RX + dx, RY + 0.0025, RZ + 0.025]);  // micro-HDMI
    b.add('matte', COL.black, cyl(0.003, 0.012, 10), [RX - 0.006, RY + 0.004, RZ + 0.022], [HP, 0, 0]); // audio jack

    // ---------- Arduino UNO R4 with the stepper driver shield (four DRV8825) ----------
    const AX = 0, AZ = 0.095, AY = DECK + 0.0135;
    for (const dx of [-0.03, 0.03]) for (const dz of [-0.022, 0.022]) b.add('metal', COL.brass, cyl(0.0028, 0.007, 6), [AX + dx, DECK + 0.0035, AZ + dz]);
    b.add('matte', COL.pcbTeal, box(0.069, 0.0016, 0.0535), [AX, AY, AZ]);
    b.add('metal', COL.steel, box(0.016, 0.011, 0.012), [AX - 0.03, AY + 0.0065, AZ - 0.012]);           // USB
    b.add('matte', COL.black, box(0.014, 0.011, 0.009), [AX - 0.03, AY + 0.0065, AZ + 0.016]);           // barrel jack
    b.add('matte', COL.black, box(0.06, 0.011, 0.0025), [AX + 0.003, AY + 0.0063, AZ - 0.0245]);         // stacking headers
    b.add('matte', COL.black, box(0.06, 0.011, 0.0025), [AX + 0.003, AY + 0.0063, AZ + 0.0245]);
    const SY = AY + 0.0125;
    b.add('matte', COL.pcbRed, box(0.069, 0.0016, 0.0535), [AX, SY, AZ]);
    for (let i = 0; i < 4; i++) {
      const dx = AX - 0.021 + i * 0.0165;
      b.add('matte', COL.black, box(0.0155, 0.008, 0.021), [dx, SY + 0.0048, AZ - 0.004]);               // driver socket
      b.add('matte', COL.pcbPurple, box(0.0152, 0.0014, 0.0205), [dx, SY + 0.0095, AZ - 0.004]);
      b.add('metal', COL.alu, box(0.009, 0.002, 0.009), [dx, SY + 0.0112, AZ - 0.006]);                  // heatsink base
      for (let k = 0; k < 4; k++) b.add('metal', COL.alu, box(0.009, 0.005, 0.0009), [dx, SY + 0.0147, AZ - 0.0096 + k * 0.0024]);
      b.add('metal', COL.brass, cyl(0.0016, 0.0012, 8), [dx + 0.004, SY + 0.0108, AZ + 0.003]);          // current trim pot
    }
    b.add('matte', COL.blueTerm, box(0.016, 0.01, 0.008), [AX + 0.024, SY + 0.0058, AZ + 0.02]);         // motor power terminal
    for (const dx of [-0.02, -0.004]) { b.add('matte', COL.black, cyl(0.004, 0.011, 12), [AX + dx, SY + 0.0063, AZ + 0.019]); b.add('metal', COL.alu, cyl(0.0038, 0.0006, 12), [AX + dx, SY + 0.0121, AZ + 0.019]); }  // capacitors

    // ---------- battery (3S 2200 mAh LiPo), strap, XT60, buck converter ----------
    const BX = -0.07, BZ = 0.0, BY = DECK + 0.0195;
    b.add('gloss', COL.wrap, rbox(0.11, 0.03, 0.04, 0.004), [BX, BY, BZ]);
    b.add('matte', COL.white, box(0.05, 0.0006, 0.024), [BX - 0.01, BY + 0.0151, BZ]);
    b.add('matte', COL.yellow, box(0.012, 0.0007, 0.024), [BX + 0.03, BY + 0.0151, BZ]);
    for (const dx of [-0.035, 0.012]) b.add('matte', COL.black, rbox(0.016, 0.0325, 0.0425, 0.003), [BX + dx, BY, BZ]);                     // hook-and-loop straps
    b.add('matte', COL.yellow, rbox(0.016, 0.008, 0.0155, 0.0012), [BX + 0.072, DECK + 0.0055, BZ + 0.004]);                              // XT60
    const KX = -0.135, KZ = 0.062;                                                                                                        // buck converter
    b.add('matte', 0x143c8a, box(0.043, 0.0016, 0.021), [KX, DECK + 0.005, KZ]);
    b.add('matte', COL.black, cyl(0.0058, 0.006, 14), [KX + 0.004, DECK + 0.009, KZ]);
    b.add('metal', COL.brass, new THREE.TorusGeometry(0.0045, 0.0018, 6, 14), [KX + 0.004, DECK + 0.0105, KZ], [HP, 0, 0]);
    for (const dx of [-0.015, 0.017]) { b.add('matte', COL.black, cyl(0.0032, 0.008, 10), [KX + dx, DECK + 0.01, KZ + 0.004]); b.add('metal', COL.alu, cyl(0.003, 0.0005, 10), [KX + dx, DECK + 0.0143, KZ + 0.004]); }
    b.add('matte', COL.red, box(0.008, 0.012, 0.012), [-0.145, DECK + 0.007, -0.142]);                                                       // power switch
    b.add('matte', COL.black, box(0.014, 0.004, 0.018), [-0.145, DECK + 0.002, -0.142]);

    // ---------- ESP32-S3 boards: one sends Wi-Fi packets, one listens to how the room changes them ----------
    for (const z of [-0.145, 0.145]) {
      const ex = -0.0895, ey = DECK + 0.01;
      b.add('matte', COL.pcbBlack, box(0.051, 0.0016, 0.026), [ex, ey, z]);
      b.add('metal', COL.steel, box(0.018, 0.003, 0.016), [ex - 0.012, ey + 0.002, z]);
      b.add('metal', COL.steel, box(0.009, 0.0034, 0.0076), [ex + 0.023, ey + 0.002, z]);
      for (const dz of [-0.0115, 0.0115]) b.add('metal', COL.brass, box(0.048, 0.0022, 0.002), [ex, ey + 0.0012, z + dz]);
      for (const dx of [-0.022, 0.022]) for (const dz of [-0.009, 0.009]) b.add('metal', COL.brass, cyl(0.002, 0.009, 6), [ex + dx, DECK + 0.0045, z + dz]);
    }

    // ---------- cables ----------
    const cable = (color, r, pts, seg = 20) => b.add('matte', color, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal'), seg, r, 7, false));
    const D = DECK;
    cable(COL.red, 0.0016, [[BX + 0.054, D + 0.022, 0.007], [BX + 0.064, D + 0.024, 0.008], [BX + 0.072, D + 0.008, 0.006]], 12);
    cable(COL.black, 0.0016, [[BX + 0.054, D + 0.016, -0.004], [BX + 0.066, D + 0.016, -0.002], [BX + 0.072, D + 0.006, 0.001]], 12);
    cable(COL.red, 0.0014, [[BX + 0.08, D + 0.006, 0.006], [0.03, D + 0.012, 0.02], [-0.04, D + 0.01, 0.036], [-0.1, D + 0.012, 0.045], [KX + 0.021, D + 0.007, KZ - 0.005]], 26);
    cable(COL.black, 0.0014, [[BX + 0.08, D + 0.005, 0.001], [0.026, D + 0.01, 0.026], [-0.04, D + 0.008, 0.041], [-0.1, D + 0.01, 0.05], [KX + 0.021, D + 0.007, KZ + 0.004]], 26);
    cable(COL.red, 0.0015, [[BX + 0.08, D + 0.006, 0.004], [0.04, D + 0.014, 0.0], [0.05, D + 0.016, -0.02], [0.045, D + 0.02, -0.038]], 18);
    cable(COL.black, 0.0019, [[KX - 0.02, D + 0.007, KZ], [-0.166, D + 0.012, 0.045], [-0.14, D + 0.01, -0.02], [-0.135, D + 0.012, -0.05], [RX - 0.03, D + 0.014, RZ + 0.034]], 30);
    cable(COL.grey, 0.0021, [[RX - 0.045, D + 0.02, RZ + 0.018], [-0.152, D + 0.022, -0.05], [-0.135, D + 0.05, 0.004], [-0.1, D + 0.045, 0.03], [-0.06, D + 0.022, 0.06], [AX - 0.038, D + 0.02, AZ - 0.012]], 34);
    for (const s of [-1, 1]) cable(COL.black, 0.0012, [[-0.1, D + 0.013, s * 0.145], [-0.122, D + 0.03, s * 0.12], [MX + 0.016, D + 0.02, s * 0.03], [MX + 0.0135, D + 0.1, s * 0.014], [MX + 0.0135, D + 0.23, s * 0.014], [MX + 0.024, BAR + 0.004, s * 0.05], [MX + 0.0255, BAR + 0.008, s * 0.098]], 44);
    for (const s of [-1, 1]) cable(COL.grey, 0.0016, [[-0.066, D + 0.012, s * 0.145], [-0.045, D + 0.02, s * 0.14], [RX + 0.07, D + 0.012, RZ * (s < 0 ? 1 : -0.35)], [RX - 0.046, D + 0.016, RZ + 0.001]], 26);
    cable(COL.black, 0.0024, [[0.096, D + 0.168, -0.02], [0.05, D + 0.15, -0.03], [0.03, D + 0.06, -0.02], [0.0, D + 0.02, -0.03], [-0.04, D + 0.014, -0.05], [RX + 0.03, D + 0.018, RZ + 0.03]], 40);
    for (const sx of [-1, 1]) for (const s of [-1, 1]) {
      cable(COL.black, 0.0022, [[AX + sx * 0.02, SY + 0.004, AZ + (s > 0 ? 0.028 : -0.028)], [AX + sx * 0.06, D + 0.014, s > 0 ? 0.128 : 0.03], [sx * 0.12, D + 0.01, s * 0.15], [sx * 0.15, D + 0.006, s * 0.172], [sx * 0.152, FY, s * 0.2], [sx * 0.14, 0.07, s * 0.19], [sx * 0.125, 0.052, s * 0.166]], 40);
    }
    for (const s of [-1, 1]) for (const x of [-0.12, 0, 0.12]) b.add('matte', COL.black, box(0.004, 0.005, 0.0225), [x, FY + 0.011, s * 0.185]);   // cable ties on the rails

    // ---------- headlights ----------
    for (const z of [-0.115, 0.115]) { b.add('matte', COL.black, cyl(0.0105, 0.016, 20), [0.181, FY, z], [0, 0, -HP]); b.add('metal', COL.steel, new THREE.TorusGeometry(0.0096, 0.0013, 8, 24), [0.189, FY, z], [0, HP, 0]); b.add('metal', COL.aluDark, box(0.004, 0.02, 0.03), [0.176, FY, z]); }
    b.build(chassis, mat);

    // ---------- the sweep carriage: rides the bridge on its belt while the rover listens ----------
    const carriage = new THREE.Group(); chassis.add(carriage);
    const cb = builder(THREE);
    for (const z of [-0.017, 0.017]) { cb.add('matte', COL.pcbBlack, box(0.0018, 0.024, 0.022), [0.13, 0.258, z]); cb.add('metal', COL.brass, box(0.0006, 0.0115, 0.0155), [0.1314, 0.258, z]); cb.add('matte', COL.chip, box(0.0012, 0.004, 0.004), [0.1316, 0.249, z]); }
    cb.add('metal', COL.aluDark, box(0.03, 0.003, 0.03), [0.098, 0.279, 0]); for (const z of [-0.0165, 0.0165]) cb.add('metal', COL.aluDark, box(0.02, 0.04, 0.002), [0.1, 0.298, z]);
    cb.build(carriage, mat);
    const head = new THREE.Group(); head.position.set(0.1, 0.308, 0); carriage.add(head);
    const hb = builder(THREE);
    hb.add('matte', COL.black, rbox(0.03, 0.03, 0.028, 0.003), [0, 0, 0]);
    hb.add('matte', COL.black, rbox(0.024, 0.026, 0.07, 0.003), [0.004, 0, 0]);
    hb.add('metal', COL.steel, cyl(0.0058, 0.009, 20), [0.019, 0.001, -0.02], [0, 0, -HP]); hb.add('gloss', COL.lens, cyl(0.0042, 0.001, 18), [0.0238, 0.001, -0.02], [0, 0, -HP]);
    hb.add('matte', COL.black, cyl(0.0105, 0.012, 24), [0.02, 0.001, 0.016], [0, 0, -HP]); hb.add('metal', COL.steel, new THREE.TorusGeometry(0.0096, 0.0011, 8, 24), [0.026, 0.001, 0.016], [0, HP, 0]); hb.add('gloss', COL.lens, new THREE.SphereGeometry(0.0085, 18, 10), [0.0225, 0.001, 0.016], [0, 0, 0], [0.5, 1, 1]);
    for (const z of [-0.0345, 0.0345]) hb.add('metal', COL.steel, cyl(0.003, 0.003, 8), [0, 0, z], [HP, 0, 0]);
    hb.build(head, mat);

    // ---------- antennas: spring steel whips in rubber, so they flex ----------
    const antennas = [-0.1, 0.1].map((z) => {
      const g = new THREE.Group(); g.position.set(MX + 0.0255, BAR + 0.006, z); chassis.add(g);
      const ab = builder(THREE);
      ab.add('metal', COL.brass, cyl(0.004, 0.008, 6), [0, 0.004, 0]); ab.add('matte', COL.black, cyl(0.0052, 0.022, 14), [0, 0.019, 0]); ab.add('matte', COL.black, cyl(0.0052, 0.085, 14, 0.0034), [0, 0.0725, 0]); ab.add('matte', COL.black, new THREE.SphereGeometry(0.0034, 12, 8), [0, 0.115, 0]);
      ab.build(g, mat); return { g, a: 0, av: 0, b: 0, bv: 0 };
    });

    // The name, lettered on the deck.
    const nameTex = canvasTexture(THREE, 512, 96);
    nameTex.redraw((c, w, h) => { c.fillStyle = '#20242a'; c.font = '600 58px ' + FONT; c.textBaseline = 'middle'; c.fillText('HOUND-01', 8, h / 2 + 2); c.fillRect(352, h / 2 - 3, 150, 6); });
    const nameMat = new THREE.MeshStandardMaterial({ map: nameTex.texture, roughness: 0.6, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const nameMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.0206).rotateX(-HP), nameMat); nameMesh.position.set(0.112, DECK + 0.0006, 0.15); chassis.add(nameMesh);

    // ---------- the CAD: frame, motors, mounts, deck, bridge, wheels ----------
    const wheels = []; let rollers = null, dead = false;
    const yAxis = new THREE.Vector3(0, 0, 1), vA = new THREE.Vector3(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), p0 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), m4 = new THREE.Matrix4(), zAxis = new THREE.Vector3(0, 0, 1);
    fetch(MODEL).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }).then((buf) => {
      if (dead) return;
      const hl = new DataView(buf).getUint32(0, true), meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl))), o = 4 + hl;
      const geo = (id, dirt) => {
        const e = meta.parts[id], g = new THREE.BufferGeometry(), n = e.verts, pos = new Float32Array(buf, o + e.pos, n * 3), pb = new Uint8Array(buf, o + e.pbr, n * 4), cs = new Uint8Array(buf, o + e.col, n * 4), col = new Float32Array(n * 3), nr = new Int8Array(buf, o + e.nor, n * 4), c = new THREE.Color();
        for (let i = 0; i < n; i++) { c.setRGB(cs[i * 4] / 255, cs[i * 4 + 1] / 255, cs[i * 4 + 2] / 255, THREE.SRGBColorSpace); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; pb[i * 4 + 3] = 255 * clamp(dirt(pos[i * 3 + 1]), 0, 1); if (!nr[i * 4] && !nr[i * 4 + 1] && !nr[i * 4 + 2]) nr[i * 4 + 1] = 127; }
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nr, 4, true)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aPbr', new THREE.BufferAttribute(pb, 4, true));
        g.setIndex(new THREE.BufferAttribute(e.wide ? new Uint32Array(buf, o + e.idx, e.count) : new Uint16Array(buf, o + e.idx, e.count), 1)); return g;
      };
      const add = (g, parent) => { const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
      add(geo('body', (y) => 0.12 + 0.62 * clamp(1 - (y - 0.03) / 0.085, 0, 1)), chassis); add(geo('carriage', () => 0.1), carriage);
      const hubs = { hubA: geo('hubA', () => 0.7), hubB: geo('hubB', () => 0.7) };
      for (const [key, w] of Object.entries(meta.wheels)) {
        const g = new THREE.Group(); g.position.set(w.x, w.z, -w.y); chassis.add(g); add(hubs[w.hub], g);
        wheels.push({ key, x: w.x, y: w.y, group: g, ratio: w.hub === 'hubA' ? -1 : 1, angle: 0, spin: 0, list: meta.rollers[w.hub].map((r) => ({ p: new THREE.Vector3().fromArray(r.p), q: new THREE.Quaternion().setFromUnitVectors(zAxis, vA.fromArray(r.a).normalize()) })) });
      }
      rollers = new THREE.InstancedMesh(geo('roller', () => 0.62), mat, 32); rollers.castShadow = rollers.receiveShadow = true; rollers.frustumCulled = false; chassis.add(rollers);
      placeRollers();
    }).catch((e) => console.warn('[rover] CAD model did not load:', e));
    function placeRollers() {
      if (!rollers) return;
      for (let wi = 0; wi < wheels.length; wi++) {
        const w = wheels[wi]; q1.setFromAxisAngle(zAxis, w.angle); q2.setFromAxisAngle(yAxis, w.spin);
        for (let i = 0; i < w.list.length; i++) { const r = w.list[i]; p0.copy(r.p).applyQuaternion(q1).add(w.group.position); q0.copy(q1).multiply(r.q).multiply(q2); rollers.setMatrixAt(wi * 8 + i, m4.compose(p0, q0, one)); }
      }
      rollers.instanceMatrix.needsUpdate = true;
    }

    // ---------- status LED, headlight lenses and their beams ----------
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff }), led = new THREE.Mesh(new THREE.SphereGeometry(0.0052, 14, 10), ledMat); led.position.set(MX, DECK + MH + 0.009, MZ); chassis.add(led); t.glow(led);
    const lensMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
    const lenses = [-0.115, 0.115].map((z) => { const m = new THREE.Mesh(new THREE.CircleGeometry(0.0088, 20).rotateY(HP), lensMat); m.position.set(0.1895, FY, z); chassis.add(m); return m; });
    lenses.forEach((m) => t.glow(m));
    const BEAM = 3.4 / SCALE.rover, beamHalf = 0.2;
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uK: { value: 0 }, uT: { value: 0 }, uColor: { value: new THREE.Color(0xe6edf7) } },
      vertexShader: 'varying float vL; varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vL = uv.y; vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform float uK, uT; uniform vec3 uColor; varying float vL; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main(){ float body = pow(min(1.0, abs(dot(vN / max(length(vN), 1e-4), normalize(vV)))) + 1e-4, 2.2); float along = pow(clamp(vL, 1e-4, 1.0), 2.4) * smoothstep(0.0, 0.07, 1.0 - vL);
          float mist = 0.55 + 0.75 * n(vec2(vP.x * 3.2 - uT * 0.35, vP.y * 9.0 + vP.z * 5.0 + uT * 0.12)) * n(vec2(vP.x * 1.1 + uT * 0.1, vP.z * 3.0));
          gl_FragColor = vec4(uColor, body * along * mist * 0.085 * uK); }`,
    });
    const beamGeo = new THREE.ConeGeometry(Math.tan(beamHalf) * BEAM, BEAM, low ? 24 : 48, 1, true).translate(0, -BEAM / 2, 0).rotateZ(HP);
    const beams = [-0.115, 0.115].map((z) => { const m = new THREE.Mesh(beamGeo, beamMat); m.position.set(0.19, FY, z); m.rotation.z = -0.08; m.renderOrder = 12; m.frustumCulled = false; chassis.add(m); return m; });
    const spot = new THREE.SpotLight(0xe6edf7, 0, 9, 0.44, 0.9, 1.5); spot.position.set(0.19, FY + 0.05, 0); spot.target.position.set(1.6, -0.1, 0); spot.castShadow = false; chassis.add(spot, spot.target);

    // ---------- wet spray thrown by the wheels, only while it drives on the mud outside ----------
    const NS = low ? 0 : 160; let spray = null, sprayMat = null;
    if (NS) {
      const sp = new Float32Array(NS * 4), zero = new Float32Array(NS * 3); let sd = 11; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < NS; i++) sp.set([rnd(), rnd(), rnd(), i % 4], i * 4);
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(zero, 3)); sg.setAttribute('aS', new THREE.BufferAttribute(sp, 4));
      sprayMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uT: { value: 0 }, uK: { value: 0 }, uPx: { value: 1 } },
        vertexShader: 'uniform float uT, uK, uPx; attribute vec4 aS; varying float vA; void main(){ float life = fract(uT * (1.6 + aS.x) + aS.y); float wx = mod(aS.w, 2.0) < 0.5 ? 0.125 : -0.125, wz = aS.w < 1.5 ? 0.24 : -0.24; float s = 0.24 * life; vec3 p = vec3(wx - 0.045 - s * (0.5 + aS.z), 0.012 + (0.35 + 0.35 * aS.x) * s - 2.2 * s * s * 1.9, wz + (aS.z - 0.5) * 0.06 + (aS.x - 0.5) * s * 0.4); p.y = max(p.y, 0.002); vA = (1.0 - life) * smoothstep(0.0, 0.08, life) * step(aS.y, uK * 1.2); vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = max(1.0, uPx * (0.0022 + 0.003 * aS.z) / -mv.z); }',
        fragmentShader: 'uniform float uK; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(0.16, 0.13, 0.1, smoothstep(0.5, 0.2, d) * vA * 0.8 * uK); }' });
      spray = new THREE.Points(sg, sprayMat); spray.frustumCulled = false; spray.renderOrder = 9; spray.visible = false; chassis.add(spray);
    }

    // ---------- on the ground: a contact shadow, and one hairline that says how the rover is ----------
    const RING = 2.2;
    const ringMat = decalMaterial(THREE, {
      uniforms: { uColor: { value: pal.accent.clone() }, uMode: { value: 0 }, uT: { value: 0 }, uA: { value: 0 }, uSel: { value: 0 }, uStill: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform vec3 uColor; uniform float uMode, uT, uA, uSel, uStill; varying vec2 vP;',
        'float band(float r, float c, float w){ float aa = fwidth(r); return smoothstep(w + aa, max(0.0, w - aa * 0.3), abs(r - c)); }',
        'void main(){',
        '  float r = length(vP), th = atan(-vP.y, vP.x);',
        '  vec2 q = abs(vP) - vec2(0.22, 0.31); float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); float sh = 0.62 * smoothstep(0.14, -0.1, sd);',
        '  float a = band(r, 0.6, 0.0028) * (0.5 + 0.5 * uSel);',
        '  float nose = smoothstep(0.1, 0.0, abs(th)); a += band(r, 0.6, 0.007) * nose * 0.7;',
        '  float fault = step(2.5, uMode), hold = step(1.5, uMode) * step(uMode, 2.5), listen = step(0.5, uMode) * step(uMode, 1.5);',
        '  a *= 1.0 - 0.55 * listen;',
        '  a += hold * band(r, 0.66, 0.004) * 0.9;',
        '  float dash = step(0.38, abs(fract(th / 6.2832 * 24.0) - 0.5) * 2.0); float blink = mix(0.6 + 0.4 * sin(uT * 3.2), 1.0, uStill);',
        '  a += fault * band(r, 0.66, 0.005) * dash * blink;',
        '  a = clamp(a, 0.0, 1.0) * uA; float o = a + sh * (1.0 - a); if (o < 0.004) discard;',
        '  gl_FragColor = vec4(uColor * 0.95 * a / o, o);',
        '}'].join('\n'),
    });
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(RING, RING).rotateX(-HP), ringMat); ring.renderOrder = 7; ring.frustumCulled = false;
    const ringRoot = new THREE.Group(); ringRoot.add(ring); t.scene.add(ringRoot);

    t.scene.add(root);
    t.pickable(root, { type: 'unit', id: 'HOUND-01' });
    const label = t.label('HOUND-01', { priority: 7, sel: { type: 'unit', id: 'HOUND-01' } });
    let labelText = '', labelTone = '';
    const MODE_TONE = { listen: 'accent', hold: 'danger', fault: 'warn', swap: 'warn' };
    const MODE_WORDS = { listen: 'listening', hold: 'all stop', fault: 'link lost, holding', swap: 'battery swap', drive: '', idle: '' };

    // ---------- motion ----------
    const fresh = stateWatcher(), BR = t.world.BUILDING.rect;
    const pose = { x: 0, y: 0, h: Math.PI / 2 }, prev = { x: 0, y: 0, h: 0 };
    let speedS = 0, pitch = 0, pitchV = 0, beamK = 0, sprayK = 0, dist = 0, sweep = 0, sweepT = 0, tilt = -0.1, selected = false, modeNow = 0;
    const ringTarget = new THREE.Color(), ledTarget = new THREE.Color(), tmpV = new THREE.Vector3();
    const WMAX = 15;    // rad/s: above this the eye sees wheels strobe, so the visible spin saturates

    function update(state, dt, time) {
      const u = state.units['HOUND-01']; if (!u) { root.visible = ringRoot.visible = false; return; }
      root.visible = ringRoot.visible = true;
      const snap = fresh(state) || Math.hypot(u.pos[0] - pose.x, u.pos[1] - pose.y) > 3 || dt <= 0, still = t.reduced, demo = t.ctx.mode === 'demo';
      prev.x = pose.x; prev.y = pose.y; prev.h = pose.h;
      if (snap) { pose.x = u.pos[0]; pose.y = u.pos[1]; pose.h = u.heading; speedS = 0; pitch = pitchV = 0; }
      else { pose.x = damp(pose.x, u.pos[0], 12, dt); pose.y = damp(pose.y, u.pos[1], 12, dt); pose.h = dampAngle(pose.h, u.heading, 6, dt); }
      root.position.set(pose.x, t.groundY, -pose.y); root.rotation.y = pose.h;
      ringRoot.position.set(pose.x, t.groundY + Y.ring, -pose.y); ringRoot.rotation.y = pose.h;

      // Body-frame velocity from what is actually drawn, so wheels always agree with the motion on screen.
      let vx = 0, vy = 0, wz = 0;
      if (!snap && dt > 0) {
        const dx = (pose.x - prev.x) / dt, dy = (pose.y - prev.y) / dt, c = Math.cos(pose.h), s = Math.sin(pose.h);
        vx = (dx * c + dy * s) / SCALE.rover; vy = (-dx * s + dy * c) / SCALE.rover;       // the model is drawn larger, so its wheels turn slower
        let dh = pose.h - prev.h; if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI; wz = dh / dt;
      }
      for (let i = 0; i < wheels.length; i++) {
        // Mecanum: the ground cannot slip along the axis of the roller that touches it (45 degrees), and the roller turns for the rest.
        const w = wheels[i], px = vx - wz * w.y, py = vy + wz * w.x, omega = (px + w.ratio * py) / R;
        w.angle -= WMAX * Math.tanh(omega / WMAX) * dt;
        const slip = ((px - omega * R) * -w.ratio + py) * 0.7071 / RR;
        w.spin += 20 * Math.tanh(slip / 20) * dt; w.group.rotation.z = w.angle;
      }
      if (!snap && wheels.length) placeRollers();

      // Weight: pitch on starting and stopping (spring and damper), and a small bob over rough ground.
      const speed = snap ? 0 : Math.hypot(vx, vy) * Math.sign(vx || 1), moving = clamp(Math.abs(speed) / 0.2, 0, 1);
      const accel = snap || dt <= 0 ? 0 : clamp((speed - speedS) / dt, -8, 8); speedS = speed; dist += Math.abs(speed) * dt;
      const inside = pose.x > BR[0] && pose.x < BR[2] && pose.y > BR[1] && pose.y < BR[3], rough = still ? 0 : moving * (inside ? 0.3 : 1);
      if (still) { pitch = 0; pitchV = 0; } else { const step = Math.min(dt, 0.033), target = clamp(accel * 0.006, -0.045, 0.045); pitchV += (-(pitch - target) * 120 - pitchV * 13) * step; pitch = clamp(pitch + pitchV * step, -0.06, 0.06); }
      chassis.rotation.z = pitch + rough * 0.006 * Math.sin(dist * 23 + 1); chassis.rotation.x = rough * 0.007 * Math.sin(dist * 17 + 0.4);
      chassis.position.y = rough * 0.0022 * (Math.sin(dist * 31) + 0.6 * Math.sin(dist * 47 + 2));
      for (let i = 0; i < 2; i++) {
        const an = antennas[i], st = Math.min(dt, 0.033), tx = still ? 0 : clamp(-accel * 0.03 + chassis.rotation.z * 2, -0.16, 0.16) + 0.008 * Math.sin(time * 1.3 + i * 2), tb = still ? 0 : chassis.rotation.x * 4 + 0.008 * Math.sin(time * 1.7 + i);
        an.av += (-(an.a - tx) * 300 - an.av * 6) * st; an.a = clamp(an.a + an.av * st, -0.3, 0.3); an.bv += (-(an.b - tb) * 300 - an.bv * 6) * st; an.b = clamp(an.b + an.bv * st, -0.3, 0.3);
        an.g.rotation.z = an.a; an.g.rotation.x = an.b;
      }

      // The sweep carriage runs along its belt only while a listening window is in progress.
      const L = state.sensors.listen;
      if (L && !still) sweepT += dt;
      const sweepGoal = L && !still ? 0.105 * Math.sin(sweepT * 0.55) : 0; sweep = snap ? sweepGoal : damp(sweep, sweepGoal, 3, dt); carriage.position.z = sweep;
      tilt = damp(tilt, L && !still ? -0.08 + 0.1 * Math.sin(sweepT * 0.31) : -0.1, 2, dt); head.rotation.z = tilt;

      // Mode on the model: LED, hairline, label.
      const mode = state.hold ? 'hold' : u.mode;
      let m = 0; ringTarget.copy(pal.text); ledTarget.copy(pal.ok);
      if (mode === 'listen') { m = 1; ringTarget.copy(pal.scan); ledTarget.copy(pal.scan); }
      else if (mode === 'hold') { m = 2; ringTarget.copy(pal.danger); ledTarget.copy(pal.danger); }
      else if (mode === 'fault' || mode === 'swap') { m = 3; ringTarget.copy(pal.warn); ledTarget.copy(pal.warn); }
      else if (mode === 'drive') ledTarget.copy(pal.scan);
      modeNow = m;
      const ru = ringMat.uniforms; ru.uMode.value = m; ru.uT.value = time; ru.uStill.value = still ? 1 : 0; ru.uSel.value = damp(ru.uSel.value, selected ? 1 : 0, 10, dt);
      if (snap) ru.uColor.value.copy(ringTarget); else ru.uColor.value.lerp(ringTarget, 1 - Math.exp(-10 * dt));
      const wantA = m >= 2 ? 0.9 : selected ? 0.8 : demo ? 0 : 0.34; ru.uA.value = snap ? wantA : damp(ru.uA.value, wantA, 6, dt);
      const pulse = still ? 1 : m === 1 ? 0.7 + 0.3 * Math.sin(time * 2.4) : m === 3 ? 0.55 + 0.45 * Math.sin(time * 3.2) : 1;
      ledMat.color.copy(ledTarget).multiplyScalar(0.9 * pulse);

      const lightsOn = mode === 'drive' ? 1 : u.odo > 0.5 && state.phase !== 'complete' ? 0.35 : 0;
      beamK = snap ? lightsOn : damp(beamK, lightsOn, 4, dt);
      beamMat.uniforms.uK.value = beamK; if (!still) beamMat.uniforms.uT.value = time; spot.intensity = beamK * 5; spot.visible = beamK > 0.01; beams[0].visible = beams[1].visible = beamK > 0.01;
      lensMat.color.setRGB(0.05 + beamK * 0.8, 0.055 + beamK * 0.84, 0.06 + beamK * 0.88);
      if (spray) { sprayK = damp(sprayK, still || inside ? 0 : moving, 6, dt); spray.visible = sprayK > 0.03; if (spray.visible) { sprayMat.uniforms.uT.value = time; sprayMat.uniforms.uK.value = sprayK; sprayMat.uniforms.uPx.value = t.renderer.domElement.height * 1.5; } }

    const words = MODE_WORDS[mode] ?? '';
      if (words !== labelText) { labelText = words; if (label.setSub) label.setSub(words); else label.setText(words ? 'HOUND-01 · ' + words : 'HOUND-01'); }
      const tone = MODE_TONE[mode] || '';
      if (tone !== labelTone) { labelTone = tone; label.setTone?.(tone); }
      label.setPosition(tmpV.set(pose.x, t.groundY + 0.48 * SCALE.rover, -pose.y));
    }

    return {
      update,
      onSelect(sel) { selected = !!sel && sel.type === 'unit' && sel.id === 'HOUND-01'; },
      // The pose actually drawn (smoothed), for anything that needs to attach to the model.
      pose: () => ({ pos: [pose.x, pose.y], heading: pose.h, mode: modeNow }),
      dispose() { dead = true; label.remove(); disposeTree(root); disposeTree(ringRoot); mat.dispose(); },
    };
  },
};
