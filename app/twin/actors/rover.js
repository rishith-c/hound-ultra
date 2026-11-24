// HOUND-01, modelled procedurally from the real build (assets/img/rover_white.png and docs/FACTS.md):
// 2020 aluminium extrusion frame, white deck, four NEMA 17 steppers on 80 mm mecanum wheels, a mast carrying the
// Wi-Fi (CSI) receiver and its antennas, a pan-tilt head with the thermal camera and webcam, the 24 GHz radars on
// the front bracket, a Raspberry Pi 4, an Arduino with its stepper drivers, a 3S LiPo, and the cables between them.
// The CAD export (assets/models/rover_cad.glb) was not used: 11 MB of unnamed boxes with no moving parts.
//
// Driven only by state.units['HOUND-01'] (pos, heading, mode, odo) and state.hold / state.faults.
// Drawn at SCALE.rover (1.5x) so it reads from an overview; the proportions are true.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SCALE, Y, FONT, palette, damp, dampAngle, clamp, stateWatcher, disposeTree, decalMaterial, canvasTexture } from './common.js';

const R = 0.04;            // wheel radius, m (80 mm mecanum)
const WX = 0.15, WZ = 0.212; // wheel centres: half wheelbase, half track
const DECK = 0.091;        // top of the deck plate
const ROLLERS = 9;

// Collects geometry into three merged meshes (metal, matte, gloss) with per-vertex colour: the whole static body
// is three draw calls however many parts it has.
function builder(THREE) {
  const bins = { metal: [], matte: [], gloss: [] };
  const M = new THREE.Matrix4(), Qn = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();
  return {
    add(cls, color, geo, pos = [0, 0, 0], rot = [0, 0, 0], scl = 1) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      M.compose(P.set(pos[0], pos[1], pos[2]), Qn.setFromEuler(E.set(rot[0], rot[1], rot[2])), typeof scl === 'number' ? S.set(scl, scl, scl) : S.set(scl[0], scl[1], scl[2]));
      g.applyMatrix4(M);
      C.set(color);
      const n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = C.r; col[i * 3 + 1] = C.g; col[i * 3 + 2] = C.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      bins[cls].push(g);
      geo.dispose();
      return this;
    },
    build(parent, mats) {
      const out = [];
      for (const cls of Object.keys(bins)) {
        if (!bins[cls].length) continue;
        const mesh = new THREE.Mesh(mergeGeometries(bins[cls], false), mats[cls]);
        mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); out.push(mesh);
        bins[cls].length = 0;
      }
      return out;
    },
  };
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

    const mats = {
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 0.34 }),
      matte: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.62 }),
      gloss: new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
    };
    const COL = { alu: 0xd3d7dc, aluDark: 0x2b2e34, steel: 0xaab0b8, brass: 0xc8a24a, black: 0x16181b, rubber: 0x0e0f11, deck: 0xe6e9ec, pcbGreen: 0x0e5c3a, pcbTeal: 0x0b5568, pcbRed: 0x8c1d1d, pcbPurple: 0x4a2a78, pcbBlack: 0x0d0f11, chip: 0x070809, wrap: 0x1c2f5e, white: 0xe8e8e2, yellow: 0xd9b11c, red: 0xb5261d, grey: 0x7c838c, lens: 0x05070a, blueTerm: 0x1d4fa3 };

    const root = new THREE.Group(); root.name = 'HOUND-01'; root.scale.setScalar(SCALE.rover);
    const chassis = new THREE.Group(); root.add(chassis);
    const b = builder(THREE);

    // ---------- frame: 2020 T-slot extrusion ----------
    const slot = new THREE.Shape();
    [[-10, -10], [-3, -10], [-3, -5.5], [3, -5.5], [3, -10], [10, -10], [10, -3], [5.5, -3], [5.5, 3], [10, 3], [10, 10], [3, 10], [3, 5.5], [-3, 5.5], [-3, 10], [-10, 10], [-10, 3], [-5.5, 3], [-5.5, -3], [-10, -3]]
      .forEach(([x, y], i) => (i ? slot.lineTo(x / 1000, y / 1000) : slot.moveTo(x / 1000, y / 1000)));
    const rail = (len) => new THREE.ExtrudeGeometry(slot, { depth: len, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -len / 2);
    const FY = 0.078;
    for (const z of [-0.16, 0.16]) b.add('metal', COL.alu, rail(0.4), [0, FY, z], [0, HP, 0]);
    for (const x of [-0.19, 0, 0.19]) b.add('metal', COL.alu, rail(0.3), [x, FY, 0]);
    for (const x of [-0.2, 0.2]) for (const z of [-0.16, 0.16]) b.add('matte', COL.black, box(0.004, 0.021, 0.021), [x + Math.sign(x) * 0.002, FY, z]);   // end caps
    for (const x of [-0.17, 0.17]) for (const z of [-0.14, 0.14]) {                                                   // corner brackets
      b.add('metal', COL.steel, box(0.02, 0.018, 0.003), [x, FY, z + Math.sign(z) * 0.0085]);
      b.add('metal', COL.steel, box(0.003, 0.018, 0.02), [x + Math.sign(x) * 0.0085, FY, z]);
    }
    // ---------- deck plate, with its fixing screws ----------
    b.add('gloss', COL.deck, rbox(0.404, 0.004, 0.344, 0.0015), [0, DECK - 0.002, 0]);
    for (const x of [-0.19, -0.065, 0.065, 0.19]) for (const z of [-0.16, 0.16]) b.add('metal', COL.steel, cyl(0.0035, 0.0022, 10), [x, DECK + 0.001, z]);
    for (const x of [-0.19, 0.19]) for (const z of [-0.06, 0.06]) b.add('metal', COL.steel, cyl(0.0035, 0.0022, 10), [x, DECK + 0.001, z]);

    // ---------- motors: NEMA 17, hung under the frame on brackets ----------
    const wheelDefs = [
      { key: 'fl', x: WX, z: -WZ }, { key: 'fr', x: WX, z: WZ }, { key: 'rl', x: -WX, z: -WZ }, { key: 'rr', x: -WX, z: WZ },
    ];
    for (const w of wheelDefs) {
      const s = Math.sign(w.z), mz = s * 0.158;
      b.add('matte', COL.black, box(0.0415, 0.0415, 0.026), [w.x, R + 0.002, mz]);                     // laminations
      b.add('metal', COL.alu, box(0.0422, 0.0422, 0.008), [w.x, R + 0.002, mz + s * 0.016]);           // front end cap
      b.add('metal', COL.alu, box(0.0422, 0.0422, 0.007), [w.x, R + 0.002, mz - s * 0.0165]);          // rear end cap
      b.add('metal', COL.steel, cyl(0.011, 0.002, 20), [w.x, R + 0.002, mz + s * 0.021], [HP, 0, 0]);  // pilot boss
      b.add('metal', COL.steel, cyl(0.0025, 0.03, 10), [w.x, R, s * 0.19], [HP, 0, 0]);                // shaft
      b.add('metal', COL.aluDark, cyl(0.0075, 0.012, 14), [w.x, R, s * 0.186], [HP, 0, 0]);            // hub coupler
      b.add('matte', COL.white, box(0.016, 0.006, 0.01), [w.x - 0.012, R + 0.026, mz - s * 0.012]);    // JST connector
      b.add('metal', COL.aluDark, box(0.05, 0.004, 0.046), [w.x, FY - 0.012, mz]);                     // bracket: top plate
      b.add('metal', COL.aluDark, box(0.05, 0.05, 0.003), [w.x, R + 0.006, mz + s * 0.0215]);          // bracket: face plate
    }

    // ---------- mast: 2040 extrusion, crossbar, the ESP32-S3 CSI receiver and its two antennas ----------
    const MX = -0.118, MZ = -0.092, MH = 0.3;
    for (const dz of [-0.01, 0.01]) b.add('metal', COL.alu, rail(MH), [MX, DECK + MH / 2, MZ + dz], [HP, 0, 0]);
    b.add('matte', COL.black, box(0.021, 0.003, 0.041), [MX, DECK + MH + 0.0015, MZ]);
    for (const dz of [-0.029, 0.029]) { b.add('metal', COL.steel, box(0.02, 0.02, 0.003), [MX, DECK + 0.01, MZ + dz]); b.add('metal', COL.steel, box(0.02, 0.003, 0.02), [MX, DECK + 0.0015, MZ + dz + Math.sign(dz) * 0.0085]); }
    const BAR = DECK + MH - 0.016;
    b.add('metal', COL.alu, rbox(0.03, 0.012, 0.23, 0.002), [MX - 0.0255, BAR, MZ + 0.06]);
    for (const dz of [-0.04, 0.16]) {                                                                   // 2.4 GHz antennas
      const az = MZ + dz, ax = MX - 0.0255;
      b.add('metal', COL.brass, cyl(0.004, 0.008, 6), [ax, BAR + 0.01, az]);
      b.add('matte', COL.black, cyl(0.0052, 0.022, 12), [ax, BAR + 0.025, az]);
      b.add('matte', COL.black, cyl(0.0052, 0.085, 12, 0.0036), [ax, BAR + 0.0785, az]);
      b.add('matte', COL.black, new THREE.SphereGeometry(0.0036, 10, 6), [ax, BAR + 0.121, az]);
    }
    b.add('matte', COL.pcbBlack, box(0.0016, 0.052, 0.026), [MX + 0.0125, DECK + 0.2, MZ]);              // ESP32-S3 dev board
    b.add('metal', COL.steel, box(0.003, 0.018, 0.016), [MX + 0.0145, DECK + 0.212, MZ]);                // RF shield can
    b.add('metal', COL.steel, box(0.006, 0.007, 0.009), [MX + 0.0155, DECK + 0.177, MZ]);                // USB-C
    b.add('metal', COL.brass, box(0.0022, 0.05, 0.002), [MX + 0.0135, DECK + 0.2, MZ - 0.0115]);         // pin headers
    b.add('metal', COL.brass, box(0.0022, 0.05, 0.002), [MX + 0.0135, DECK + 0.2, MZ + 0.0115]);
    b.add('matte', COL.black, cyl(0.0065, 0.004, 14), [MX, DECK + MH + 0.005, MZ]);                      // status LED base

    // ---------- pan-tilt head: two servos, a post, the sensor bar with the thermal camera and webcam ----------
    const PX = 0.118, PZ = 0.082;
    b.add('matte', COL.black, rbox(0.041, 0.037, 0.021, 0.002), [PX, DECK + 0.0185, PZ]);
    b.add('matte', COL.black, box(0.054, 0.0025, 0.021), [PX, DECK + 0.028, PZ]);                        // mounting ears
    b.add('metal', COL.brass, cyl(0.003, 0.004, 10), [PX + 0.01, DECK + 0.039, PZ]);
    b.add('matte', COL.white, cyl(0.011, 0.003, 18), [PX + 0.01, DECK + 0.0425, PZ]);                    // servo horn
    b.add('metal', COL.aluDark, box(0.046, 0.003, 0.03), [PX + 0.006, DECK + 0.0455, PZ]);               // pan bracket
    b.add('metal', COL.aluDark, box(0.003, 0.046, 0.03), [PX - 0.0155, DECK + 0.067, PZ]);
    b.add('matte', COL.black, rbox(0.021, 0.037, 0.041, 0.002), [PX + 0.004, DECK + 0.0665, PZ]);        // tilt servo
    b.add('matte', COL.white, cyl(0.011, 0.003, 18), [PX + 0.004, DECK + 0.076, PZ + 0.0225], [HP, 0, 0]);
    b.add('matte', COL.black, box(0.014, 0.075, 0.014), [PX + 0.004, DECK + 0.122, PZ]);                 // post
    const HY = DECK + 0.172, tilt = -0.14;                                                               // head, tilted slightly down
    b.add('matte', COL.black, rbox(0.034, 0.03, 0.16, 0.003), [PX + 0.006, HY, PZ - 0.005], [0, 0, tilt]);
    const fx = PX + 0.024, lensDir = [0, 0, -HP + tilt];
    b.add('matte', COL.black, cyl(0.0125, 0.012, 20), [fx + 0.004, HY - 0.001, PZ + 0.04], lensDir);     // webcam barrel
    b.add('metal', COL.steel, new THREE.TorusGeometry(0.0115, 0.0012, 6, 20), [fx + 0.0105, HY - 0.002, PZ + 0.04], [0, HP, 0]);
    b.add('gloss', COL.lens, cyl(0.0095, 0.002, 20), [fx + 0.0108, HY - 0.002, PZ + 0.04], lensDir);
    b.add('matte', COL.pcbRed, box(0.002, 0.02, 0.018), [fx - 0.0055, HY, PZ - 0.035], [0, 0, tilt]);    // MLX90640 breakout
    b.add('metal', COL.steel, cyl(0.0046, 0.009, 14), [fx + 0.001, HY - 0.001, PZ - 0.035], lensDir);    // thermal sensor can
    b.add('gloss', COL.lens, cyl(0.0032, 0.001, 12), [fx + 0.0058, HY - 0.0016, PZ - 0.035], lensDir);
    b.add('matte', COL.black, box(0.002, 0.036, 0.022), [PX - 0.008, HY + 0.03, PZ - 0.07]);             // rear fin (cable guide)

    // ---------- front sensor bracket: LD2450 tracking radar, two LD2410C presence radars, a distance sensor ----------
    b.add('matte', COL.black, rbox(0.01, 0.034, 0.2, 0.002), [0.196, DECK + 0.017, -0.01]);
    b.add('matte', COL.pcbGreen, box(0.0016, 0.016, 0.045), [0.2025, DECK + 0.022, -0.01]);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) b.add('metal', COL.brass, box(0.0004, 0.004, 0.006), [0.2036, DECK + 0.0185 + j * 0.007, -0.0235 + i * 0.009]);  // patch antennas
    for (const z of [-0.075, 0.055]) { b.add('matte', COL.pcbBlack, box(0.0016, 0.017, 0.022), [0.2025, DECK + 0.022, z]); b.add('metal', COL.brass, box(0.0004, 0.006, 0.012), [0.2036, DECK + 0.024, z]); }
    for (const x of [0.2025, -0.2025]) { b.add('matte', COL.pcbPurple, box(0.0016, 0.012, 0.018), [x, FY, 0.03]); b.add('gloss', COL.lens, box(0.0012, 0.003, 0.006), [x + Math.sign(x) * 0.001, FY, 0.03]); }  // VL53L1X front and rear

    // ---------- Raspberry Pi 4 ----------
    const RX = 0.045, RZ = -0.09, RY = DECK + 0.009;
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
    const AX = -0.03, AZ = 0.085, AY = DECK + 0.008;
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
    const BX = 0.03, BZ = 0.0, BY = DECK + 0.014;
    b.add('gloss', COL.wrap, rbox(0.106, 0.026, 0.035, 0.004), [BX, BY, BZ]);
    b.add('matte', COL.white, box(0.05, 0.0006, 0.024), [BX - 0.01, BY + 0.0131, BZ]);
    b.add('matte', COL.yellow, box(0.012, 0.0007, 0.024), [BX + 0.03, BY + 0.0131, BZ]);
    for (const dx of [-0.035, 0.012]) b.add('matte', COL.black, rbox(0.016, 0.0285, 0.0375, 0.003), [BX + dx, BY, BZ]);                     // hook-and-loop straps
    b.add('matte', COL.yellow, rbox(0.016, 0.008, 0.0155, 0.0012), [BX - 0.085, DECK + 0.0055, BZ + 0.004]);                              // XT60
    const KX = -0.115, KZ = 0.02;                                                                                                        // buck converter
    b.add('matte', 0x143c8a, box(0.043, 0.0016, 0.021), [KX, DECK + 0.005, KZ]);
    b.add('matte', COL.black, cyl(0.0058, 0.006, 14), [KX + 0.004, DECK + 0.009, KZ]);
    b.add('metal', COL.brass, new THREE.TorusGeometry(0.0045, 0.0018, 6, 14), [KX + 0.004, DECK + 0.0105, KZ], [HP, 0, 0]);
    for (const dx of [-0.015, 0.017]) { b.add('matte', COL.black, cyl(0.0032, 0.008, 10), [KX + dx, DECK + 0.01, KZ + 0.004]); b.add('metal', COL.alu, cyl(0.003, 0.0005, 10), [KX + dx, DECK + 0.0143, KZ + 0.004]); }
    b.add('matte', COL.red, box(0.008, 0.012, 0.012), [-0.16, DECK + 0.007, 0.06]);                                                       // power switch
    b.add('matte', COL.black, box(0.014, 0.004, 0.018), [-0.16, DECK + 0.002, 0.06]);

    // ---------- cables ----------
    const cable = (cls, color, r, pts, seg = 20) => b.add(cls, color, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal'), seg, r, 6, false));
    const D = DECK;
    cable('matte', COL.red, 0.0016, [[BX - 0.053, D + 0.018, BZ + 0.007], [BX - 0.066, D + 0.02, BZ + 0.008], [BX - 0.078, D + 0.008, BZ + 0.006]], 10);
    cable('matte', COL.black, 0.0016, [[BX - 0.053, D + 0.012, BZ - 0.002], [BX - 0.068, D + 0.014, BZ], [BX - 0.078, D + 0.006, BZ + 0.002]], 10);
    cable('matte', COL.red, 0.0014, [[BX - 0.093, D + 0.006, BZ + 0.006], [-0.085, D + 0.012, 0.02], [KX + 0.021, D + 0.007, KZ + 0.005]], 10);
    cable('matte', COL.black, 0.0014, [[BX - 0.093, D + 0.005, BZ + 0.001], [-0.08, D + 0.01, 0.006], [KX + 0.021, D + 0.007, KZ - 0.005]], 10);
    cable('matte', COL.black, 0.0019, [[KX - 0.021, D + 0.007, KZ], [-0.15, D + 0.012, 0.0], [-0.15, D + 0.01, -0.05], [-0.07, D + 0.012, -0.045], [0.04, D + 0.012, -0.05], [RX + 0.03, D + 0.012, RZ + 0.03]], 30);  // 5 V to the Pi
    cable('matte', COL.grey, 0.0021, [[RX - 0.045, D + 0.018, RZ + 0.018], [RX - 0.07, D + 0.016, RZ + 0.03], [-0.07, D + 0.02, 0.02], [AX - 0.05, D + 0.018, AZ - 0.02], [AX - 0.038, D + 0.015, AZ - 0.012]], 28);   // USB to the Arduino
    cable('matte', COL.black, 0.0017, [[RX - 0.045, D + 0.018, RZ + 0.001], [RX - 0.075, D + 0.02, RZ - 0.002], [MX + 0.04, D + 0.03, MZ + 0.004], [MX + 0.024, D + 0.1, MZ], [MX + 0.02, D + 0.172, MZ]], 28);         // USB to the ESP32
    cable('matte', COL.black, 0.0012, [[MX + 0.014, D + 0.22, MZ + 0.006], [MX + 0.012, D + 0.262, MZ + 0.03], [MX - 0.012, BAR + 0.008, MZ + 0.1], [MX - 0.0255, BAR + 0.01, MZ + 0.152]], 20);                          // antenna coax
    cable('matte', COL.black, 0.0012, [[MX + 0.014, D + 0.22, MZ - 0.006], [MX + 0.004, D + 0.268, MZ - 0.02], [MX - 0.02, BAR + 0.008, MZ - 0.034], [MX - 0.0255, BAR + 0.01, MZ - 0.04]], 16);
    cable('matte', COL.black, 0.002, [[PX - 0.008, HY + 0.016, PZ - 0.07], [PX - 0.03, HY - 0.03, PZ - 0.07], [PX - 0.03, D + 0.06, PZ - 0.06], [0.09, D + 0.018, 0.0], [RX + 0.02, D + 0.016, RZ + 0.034]], 30);          // sensor head loom
    cable('matte', COL.grey, 0.0016, [[0.19, D + 0.02, -0.01], [0.16, D + 0.024, -0.02], [0.12, D + 0.016, -0.05], [RX + 0.03, D + 0.016, RZ - 0.02]], 20);                                                             // radar
    for (const w of wheelDefs) {                                                                                                                                                                                  // stepper leads
      const s = Math.sign(w.z), ex = Math.sign(w.x) * 0.214;
      cable('matte', COL.black, 0.0022, [[AX + (w.x > 0 ? 0.02 : -0.02), SY + 0.004, AZ + 0.028 * (s > 0 ? 1 : -1)], [AX + (w.x > 0 ? 0.06 : -0.07), D + 0.014, s > 0 ? 0.13 : -0.02], [w.x * 0.92, D + 0.012, s * 0.15], [ex * 0.96, D + 0.006, s * 0.176], [ex, FY - 0.004, s * 0.17], [w.x + Math.sign(w.x) * 0.02, R + 0.03, s * 0.15], [w.x - 0.012, R + 0.03, s * 0.146]], 40);
    }

    // ---------- headlights ----------
    for (const z of [-0.115, 0.115]) { b.add('matte', COL.black, cyl(0.0095, 0.014, 16), [0.205, FY, z], [0, 0, -HP]); b.add('metal', COL.steel, new THREE.TorusGeometry(0.0088, 0.0012, 6, 18), [0.2125, FY, z], [0, HP, 0]); }

    b.build(chassis, mats);

    // The name, lettered on the deck.
    const nameTex = canvasTexture(THREE, 512, 96);
    nameTex.redraw((c, w, h) => { c.fillStyle = '#20242a'; c.font = '600 58px ' + FONT; c.textBaseline = 'middle'; c.fillText('HOUND-01', 8, h / 2 + 2); c.fillRect(352, h / 2 - 3, 150, 6); });
    const nameMat = new THREE.MeshBasicMaterial({ map: nameTex.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const nameMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.0206).rotateX(-HP), nameMat); nameMesh.position.set(0.1, DECK + 0.0004, 0.142); chassis.add(nameMesh);

    // ---------- wheels: hubs spin about the axle; every roller is its own instance ----------
    const hubMat = mats.metal;
    const wheels = wheelDefs.map((w) => {
      const hb = builder(THREE), s = Math.sign(w.z);
      for (const dz of [-0.0165, 0.0165]) hb.add('metal', COL.aluDark, cyl(0.0305, 0.0026, 28), [0, 0, dz], [HP, 0, 0]);
      hb.add('metal', 0x1c1e22, cyl(0.019, 0.031, 20), [0, 0, 0], [HP, 0, 0]);
      hb.add('metal', COL.steel, cyl(0.0085, 0.006, 16), [0, 0, s * 0.0205], [HP, 0, 0]);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; hb.add('metal', COL.steel, cyl(0.0022, 0.002, 8), [Math.cos(a) * 0.0145, Math.sin(a) * 0.0145, s * 0.0185], [HP, 0, 0]); }
      for (let i = 0; i < ROLLERS; i++) { const a = ((i + 0.5) / ROLLERS) * Math.PI * 2; hb.add('metal', 0x3a3e45, box(0.0045, 0.008, 0.0345), [Math.cos(a) * 0.0265, Math.sin(a) * 0.0265, 0], [0, 0, a]); }  // roller forks
      hb.add('metal', COL.brass, box(0.004, 0.0035, 0.0035), [0.0085, 0, s * 0.0205]);                                // set screw: makes the spin readable
      const g = new THREE.Group(); g.position.set(w.x, R, w.z);
      const mesh = hb.build(g, { metal: hubMat })[0];
      chassis.add(g);
      return { ...w, group: g, mesh, angle: 0, spin: 0, chir: -Math.sign(w.x * w.z) };
    });
    // Roller: a barrel whose envelope makes the wheel round. Its axis sits at 45 degrees to the axle.
    const prof = []; for (let i = 0; i <= 8; i++) { const k = i / 8 * 2 - 1; prof.push(new THREE.Vector2(0.0108 * (1 - 0.42 * k * k) * (Math.abs(k) > 0.99 ? 0.6 : 1), k * 0.019)); }
    const rollerGeo = new THREE.LatheGeometry(prof, low ? 8 : 12);
    const rollerMat = new THREE.MeshStandardMaterial({ color: COL.rubber, roughness: 0.82, metalness: 0 });
    const rollers = new THREE.InstancedMesh(rollerGeo, rollerMat, ROLLERS * 4); rollers.castShadow = true; rollers.frustumCulled = false; chassis.add(rollers);
    const RR = R - 0.0108, rollerBase = [];
    const yAxis = new THREE.Vector3(0, 1, 0), vA = new THREE.Vector3(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), p0 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), m4 = new THREE.Matrix4(), zAxis = new THREE.Vector3(0, 0, 1);
    for (const w of wheels) for (let i = 0; i < ROLLERS; i++) {
      const a = (i / ROLLERS) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      vA.set(-s * w.chir, c * w.chir, 1).normalize();
      rollerBase.push({ w, pos: new THREE.Vector3(c * RR, s * RR, 0), q: new THREE.Quaternion().setFromUnitVectors(yAxis, vA) });
    }
    function placeRollers() {
      let k = 0;
      for (const rb of rollerBase) {
        q0.setFromAxisAngle(zAxis, rb.w.angle);
        p0.copy(rb.pos).applyQuaternion(q0); p0.x += rb.w.x; p0.y += R; p0.z += rb.w.z;
        q1.copy(q0).multiply(rb.q).multiply(q2.setFromAxisAngle(yAxis, rb.w.spin));
        rollers.setMatrixAt(k++, m4.compose(p0, q1, one));
      }
      rollers.instanceMatrix.needsUpdate = true;
    }
    placeRollers();

    // ---------- lights: status LED, headlight lenses, beam ----------
    const ledMat = new THREE.MeshBasicMaterial({ color: pal.ok.clone(), toneMapped: false });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 14, 10, 0, Math.PI * 2, 0, HP), ledMat); led.position.set(MX, DECK + MH + 0.007, MZ); chassis.add(led); t.glow(led);
    const lensMat = new THREE.MeshBasicMaterial({ color: 0x20242a, toneMapped: false });
    const lensGeo = new THREE.CircleGeometry(0.0078, 18).rotateY(HP);
    const lenses = [-0.115, 0.115].map((z) => { const m = new THREE.Mesh(lensGeo, lensMat); m.position.set(0.2128, FY, z); chassis.add(m); return m; });
    lenses.forEach((m) => t.glow(m));
    const BEAM = 3.6 / SCALE.rover, beamHalf = 0.21;
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      uniforms: { uK: { value: 0 }, uColor: { value: new THREE.Color(0xdcebff) } },
      vertexShader: 'varying float vL; varying vec3 vN; varying vec3 vV; void main(){ vL = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uK; uniform vec3 uColor; varying float vL; varying vec3 vN; varying vec3 vV; void main(){ float body = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); float along = pow(vL, 3.0) * smoothstep(0.0, 0.05, 1.0 - vL) + 0.06 * vL * vL; gl_FragColor = vec4(uColor, body * along * 0.1 * uK); }',
    });
    const beamGeo = new THREE.ConeGeometry(Math.tan(beamHalf) * BEAM, BEAM, low ? 24 : 48, 1, true).translate(0, -BEAM / 2, 0).rotateZ(HP);
    const beams = [-0.115, 0.115].map((z) => { const m = new THREE.Mesh(beamGeo, beamMat); m.position.set(0.214, FY, z); m.rotation.z = -0.1; m.renderOrder = 12; m.frustumCulled = false; chassis.add(m); return m; });
    const spot = new THREE.SpotLight(0xdcebff, 0, 11, 0.42, 0.75, 1.6); spot.position.set(0.21, FY + 0.02, 0); spot.target.position.set(2, -0.12, 0); spot.castShadow = false; chassis.add(spot, spot.target);
    // Dust in the beam: a handful of motes drifting through the cone, lit only where the beam is.
    const NM = low || t.reduced ? 0 : 70;
    let motes = null, moteMat = null;
    if (NM) {
      const mp = new Float32Array(NM * 3), ms = new Float32Array(NM);
      let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < NM; i++) { mp.set([rnd(), rnd() * 2 - 1, rnd() * 2 - 1], i * 3); ms[i] = rnd(); }
      const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3)); mg.setAttribute('aSeed', new THREE.BufferAttribute(ms, 1));
      moteMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
        uniforms: { uT: { value: 0 }, uK: { value: 0 }, uLen: { value: BEAM * 0.8 }, uTan: { value: Math.tan(beamHalf) * 0.85 }, uPx: { value: 1 } },
        vertexShader: 'uniform float uT, uLen, uTan, uPx; attribute float aSeed; varying float vA; void main(){ float x = fract(position.x + uT * (0.012 + aSeed * 0.02)); float sway = sin(uT * (0.4 + aSeed) + aSeed * 40.0) * 0.12; vec3 p = vec3(0.05 + x * uLen, (position.y + sway) * x * uLen * uTan, (position.z + sway * 0.7) * x * uLen * uTan + (aSeed > 0.5 ? 0.115 : -0.115) * (1.0 - x)); float r = length(vec2(position.y + sway, position.z + sway * 0.7)); vA = smoothstep(1.0, 0.5, r) * smoothstep(0.0, 0.08, x) * (1.0 - x) * (0.4 + 0.6 * fract(aSeed * 7.3)); vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPx * (0.012 + 0.012 * aSeed) / -mv.z; }',
        fragmentShader: 'uniform float uK; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(0.86, 0.92, 1.0, smoothstep(0.5, 0.1, d) * vA * 0.7 * uK); }' });
      motes = new THREE.Points(mg, moteMat); motes.position.set(0.214, FY, 0); motes.frustumCulled = false; motes.renderOrder = 13; chassis.add(motes);
    }

    // ---------- mode ring on the ground: who and how the rover is, readable from far away ----------
    const RING = 3.4;   // metres across (world)
    const ringMat = decalMaterial(THREE, {
      uniforms: { uColor: { value: pal.accent.clone() }, uMode: { value: 0 }, uT: { value: 0 }, uA: { value: 1 }, uSel: { value: 0 }, uStill: { value: t.reduced ? 1 : 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform vec3 uColor; uniform float uMode, uT, uA, uSel, uStill; varying vec2 vP;',
        'float band(float r, float c, float w){ float aa = fwidth(r) * 1.2; return smoothstep(w + aa, w, abs(r - c)); }',
        'void main(){',
        '  float r = length(vP), th = atan(-vP.y, vP.x);',
        '  float base = band(r, 0.62, 0.007 + 0.008 * uSel) * (0.55 + 0.45 * uSel);',
        '  float tw = (0.76 - vP.x) * 0.55; float aw = fwidth(vP.x) * 1.5;',
        '  float tick = smoothstep(0.66 - aw, 0.66 + aw, vP.x) * smoothstep(tw + aw, tw - aw, abs(vP.y)) * step(vP.x, 0.76) * 0.75;',                         // heading notch (front)
        '  float a = base + tick;',
        '  float listen = step(0.5, uMode) * step(uMode, 1.5), hold = step(1.5, uMode) * step(uMode, 2.5), fault = step(2.5, uMode);',
        '  float ph = mix(fract(uT / 2.6), 0.45, uStill);',
        '  float pr = mix(0.62, 1.55, ph);',
        '  a += listen * (band(r, pr, 0.014) * (1.0 - ph) * 0.9 + band(r, 0.62, 0.02) * 0.5 + smoothstep(0.62, 0.0, r) * 0.05);',
        '  a += hold * (band(r, 0.62, 0.022) * 0.9 + band(r, 0.8, 0.006) * 0.55 + smoothstep(0.62, 0.2, r) * 0.07);',
        '  float dash = smoothstep(0.5, 0.42, abs(fract(th / 6.2832 * 14.0) - 0.5) * 2.0 * 0.62);',
        '  float blink = mix(0.55 + 0.45 * sin(uT * 3.2), 1.0, uStill);',
        '  a += fault * (band(r, 0.78, 0.022) * dash * blink * 0.95 + band(r, 0.62, 0.014) * 0.4);',
        '  if (a < 0.004) discard;',
        '  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0) * uA);',
        '}'].join('\n'),
    });
    ringMat.extensions = { derivatives: true };
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(RING, RING).rotateX(-HP), ringMat); ring.renderOrder = 7; ring.frustumCulled = false;
    const ringRoot = new THREE.Group(); ringRoot.add(ring); t.scene.add(ringRoot);

    t.scene.add(root);
    t.pickable(root, { type: 'unit', id: 'HOUND-01' });
    const label = t.label('HOUND-01', { priority: 7, sel: { type: 'unit', id: 'HOUND-01' } });
    let labelText = '', labelTone = '';
    const MODE_TONE = { listen: 'accent', hold: 'danger', fault: 'warn', swap: 'warn' };

    // ---------- motion state ----------
    const fresh = stateWatcher();
    const pose = { x: 0, y: 0, h: Math.PI / 2 }, prev = { x: 0, y: 0, h: 0 };
    let speedS = 0, pitch = 0, pitchV = 0, beamK = 0, selected = false, modeNow = 0;
    const ringTarget = new THREE.Color(), ledTarget = new THREE.Color(), tmpV = new THREE.Vector3();
    const WMAX = 15;    // rad/s: above this the eye sees wheels strobe, so the visible spin saturates
    const MODE_WORDS = { listen: 'listening', hold: 'all stop', fault: 'link lost, holding', swap: 'battery swap', drive: '', idle: '' };

    function update(state, dt, time) {
      const u = state.units['HOUND-01']; if (!u) { root.visible = ringRoot.visible = false; return; }
      root.visible = ringRoot.visible = true;
      const snap = fresh(state) || Math.hypot(u.pos[0] - pose.x, u.pos[1] - pose.y) > 3 || dt <= 0;
      prev.x = pose.x; prev.y = pose.y; prev.h = pose.h;
      if (snap) { pose.x = u.pos[0]; pose.y = u.pos[1]; pose.h = u.heading; speedS = 0; pitch = pitchV = 0; }
      else { pose.x = damp(pose.x, u.pos[0], 16, dt); pose.y = damp(pose.y, u.pos[1], 16, dt); pose.h = dampAngle(pose.h, u.heading, 7, dt); }
      root.position.set(pose.x, t.groundY, -pose.y); root.rotation.y = pose.h;
      ringRoot.position.set(pose.x, t.groundY + Y.ring, -pose.y); ringRoot.rotation.y = pose.h;

      // Body-frame velocity from what is actually drawn, so wheels always agree with the motion on screen.
      let vx = 0, vyL = 0, wz = 0;
      if (!snap && dt > 0) {
        const dx = (pose.x - prev.x) / dt, dy = (pose.y - prev.y) / dt, c = Math.cos(pose.h), s = Math.sin(pose.h);
        vx = dx * c + dy * s; vyL = -dx * s + dy * c;
        let dh = pose.h - prev.h; if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI; wz = dh / dt;
        vx /= SCALE.rover; vyL /= SCALE.rover;       // the model is drawn larger, so its wheels turn slower for the same ground speed
      }
      const k = WX + WZ;
      for (const w of wheels) {
        const left = w.z < 0 ? 1 : -1, front = w.x > 0 ? 1 : -1;
        // Mecanum inverse kinematics: fl = vx - vy - k w, fr = vx + vy + k w, rl = vx + vy - k w, rr = vx - vy + k w
        const omega = (vx - front * left * vyL - left * k * wz) / R;
        const vis = WMAX * Math.tanh(omega / WMAX);
        w.angle -= vis * dt;
        // The roller under the wheel turns only when the wheel slips sideways along its free direction (turning, strafing).
        const px = vx - wz * (-w.z), py = vyL + wz * w.x, sx = px - omega * R, sy = py;
        const slip = (sx + w.chir * sy) * 0.7071 / 0.0108;
        w.spin += 20 * Math.tanh(slip / 20) * dt;
        w.group.rotation.z = w.angle;
      }
      if (!snap) placeRollers();

      // Weight: a tiny pitch when it sets off and when it stops (spring and damper; no suspension travel).
      const speed = snap ? 0 : Math.hypot(vx, vyL) * Math.sign(vx || 1);
      const accel = snap || dt <= 0 ? 0 : (speed - speedS) / dt; speedS = speed;
      if (t.reduced) { pitch = 0; } else {
        const target = clamp(accel * 0.006, -0.045, 0.045);
        pitchV += (-(pitch - target) * 120 - pitchV * 13) * dt; pitch = clamp(pitch + pitchV * dt, -0.06, 0.06);
      }
      chassis.rotation.z = pitch;

      // Mode on the model: ring, LED, label.
      const mode = state.hold ? 'hold' : u.mode;
      let m = 0; ringTarget.copy(pal.accent); ledTarget.copy(pal.ok);
      if (mode === 'listen') { m = 1; ringTarget.copy(pal.scan); ledTarget.copy(pal.scan); }
      else if (mode === 'hold') { m = 2; ringTarget.copy(pal.danger); ledTarget.copy(pal.danger); }
      else if (mode === 'fault' || mode === 'swap') { m = 3; ringTarget.copy(pal.warn); ledTarget.copy(pal.warn); }
      else if (mode === 'drive') ledTarget.copy(pal.scan);
      modeNow = m;
      const ru = ringMat.uniforms; ru.uMode.value = m; ru.uT.value = time; ru.uStill.value = t.reduced ? 1 : 0; ru.uSel.value = damp(ru.uSel.value, selected ? 1 : 0, 10, dt);
      if (snap) ru.uColor.value.copy(ringTarget); else ru.uColor.value.lerp(ringTarget, 1 - Math.exp(-10 * dt));
      ru.uA.value = m === 0 ? 0.55 : 1;
      const pulse = t.reduced ? 1 : m === 1 ? 0.7 + 0.3 * Math.sin(time * 2.4) : m === 3 ? 0.55 + 0.45 * Math.sin(time * 3.2) : 1;
      ledMat.color.copy(ledTarget).multiplyScalar(0.9 * pulse);

      const lightsOn = mode === 'drive' ? 1 : u.odo > 0.5 && state.phase !== 'complete' ? 0.5 : 0;
      beamK = snap ? lightsOn : damp(beamK, lightsOn, 5, dt);
      beamMat.uniforms.uK.value = beamK; spot.intensity = beamK * 13; spot.visible = beamK > 0.01; beams[0].visible = beams[1].visible = beamK > 0.01;
      lensMat.color.setRGB(0.05 + beamK * 0.8, 0.055 + beamK * 0.86, 0.06 + beamK * 0.92);
      if (motes) { motes.visible = beamK > 0.05; moteMat.uniforms.uT.value = time; moteMat.uniforms.uK.value = beamK; moteMat.uniforms.uPx.value = t.renderer.domElement.height * 0.9; }

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
      dispose() { label.remove(); disposeTree(root); disposeTree(ringRoot); rollerMat.dispose(); },
    };
  },
};
