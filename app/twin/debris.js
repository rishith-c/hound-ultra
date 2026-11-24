// What the flood carried in and left: a truck buried to its axles, a bus shelter, silt banked against every wall it met,
// tree trunks, boulders, bent roofing sheets and the small things (branches, bricks, planks, paper). Seeded; invented.
import * as THREE from 'three';
import { box, cyl, merge, mesh, tint, rng, tube, xform, instanced, matrix, worldUV, makeNoise, smooth } from './util.js';

export function build(env) {
  const { world, mats, environment } = env, R = rng('debris'), n = makeNoise('silt'), group = new THREE.Group(); group.name = 'debris';
  const B = world.BUILDING.rect, hall = world.SITE.entrance, st = world.SITE.staging;
  const free = (x, y, m = 0) => !(x > B[0] - m && x < B[2] + m && y > B[1] - m && y < B[3] + m) && !(x > 12 - m && x < 42 + m && y > 4 - m && y < 30) && Math.hypot(x - hall[0], y - hall[1]) > 5 + m && !(x > st[0] - 4 && x < hall[0] + 4 && y > 10 && y < 29 && Math.abs((y - st[1]) - (x - st[0]) * 0.395) < 5 + m);

  // ---- the truck: nose down in the mud, bed lifted, one door open ----
  { const P = [], S = [], G = [], paint = 0x6f5a2e, dk = 0x1b1d1f, mud = 0x4a4036;
    const b = (w, h, d, x, y, z, c, ry = 0, rx = 0, rz = 0) => P.push(tint(box(w, h, d, x, y, z, ry, rx, rz), c));
    b(7.4, 0.22, 0.9, 0, 0.75, 0, dk); b(2.0, 1.5, 2.25, 2.7, 0.95, 0, paint); b(1.7, 0.9, 2.1, 2.62, 2.4, 0, paint); b(1.9, 0.12, 2.25, 2.6, 3.25, 0, 0x7a6740); b(0.9, 0.95, 2.1, 4.05, 0.95, 0, paint); b(0.14, 0.4, 2.3, 4.55, 0.75, 0, 0x2a2d30);
    for (const z of [-1.18, 1.18]) b(4.9, 0.85, 0.1, -1.1, 1.15, z, 0x5b3a2c); b(0.1, 0.85, 2.3, 1.35, 1.15, 0, 0x5b3a2c); b(0.1, 0.85, 2.3, -3.55, 1.0, 0, 0x5b3a2c, 0, 0, 0.5); b(4.9, 0.12, 2.3, -1.1, 1.05, 0, 0x4c4238);
    for (let i = 0; i < 6; i++) for (const z of [-1.24, 1.24]) b(0.08, 0.95, 0.06, -3.2 + i * 0.9, 1.1, z, 0x3c2a22);
    b(1.1, 0.05, 1.0, 3.2, 1.5, 1.55, paint, 0.9); b(0.12, 0.2, 0.34, 4.5, 1.35, 0.8, 0x9a9a92); b(0.12, 0.2, 0.34, 4.5, 1.35, -0.8, 0x9a9a92);
    G.push(new THREE.PlaneGeometry(1.95, 0.7).rotateY(Math.PI / 2).rotateZ(0.18).translate(3.52, 2.8, 0)); for (const z of [-1.07, 1.07]) G.push(new THREE.PlaneGeometry(1.3, 0.6).translate(2.6, 2.8, z));
    for (const [x, z] of [[3.1, 1.05], [3.1, -1.05], [-1.9, 1.05], [-1.9, -1.05], [-2.95, 1.05], [-2.95, -1.05]]) { S.push(new THREE.CylinderGeometry(0.52, 0.52, 0.34, 22).rotateX(Math.PI / 2).translate(x, 0.52, z)); P.push(tint(new THREE.CylinderGeometry(0.24, 0.24, 0.37, 12).rotateX(Math.PI / 2).translate(x, 0.52, z), mud)); }
    const truck = new THREE.Group(); truck.add(mesh(merge(P, { keepUV: false, keepColor: true }), mats.paint), mesh(merge(S, { keepUV: false }), mats.rubber), mesh(merge(G, { keepUV: false }), new THREE.MeshStandardMaterial({ color: 0x0d1319, roughness: 0.1, side: THREE.DoubleSide })));
    truck.position.set(101, -0.85, -20.5); truck.rotation.set(0.12, 0.55, -0.15, 'YXZ'); truck.name = 'buried-truck'; group.add(truck); }

  // ---- the bus shelter ----
  { const C = [], T = [], s = new THREE.Group(); for (const x of [-1.9, 1.9]) for (const z of [-0.8, 0.8]) C.push(tint(cyl(0.05, 0.06, 2.5, x, 0, z, 8), 0x2f4a52)); C.push(tint(box(4, 1.5, 0.05, 0, 0.5, -0.82), 0x6f7a74), tint(box(3.4, 0.07, 0.42, 0, 0.5, -0.5), 0x5b4a38), tint(box(0.9, 1.3, 0.04, 1.2, 1.0, 0.86, 0.1), 0x9c9a90)); for (const x of [-1.5, 0, 1.5]) C.push(tint(box(0.06, 0.5, 0.3, x, 0, -0.5), 0x2a2d30));
    const g = new THREE.PlaneGeometry(4.8, 2.3, 30, 6).rotateX(-Math.PI / 2), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, 2.55 + z * 0.12 + Math.sin(x * 12) * 0.018 - smooth(0.8, 2.4, x) * 0.5 * smooth(-1.2, 1.2, z)); } g.computeVertexNormals(); T.push(g);
    s.add(mesh(merge(C, { keepUV: false, keepColor: true }), mats.paint), mesh(merge(T, {}), mats.cgi)); s.position.set(88, -0.18, -2.5); s.rotation.set(0.03, Math.PI + 0.06, -0.07); s.name = 'bus-shelter'; group.add(s); }

  // ---- silt banked against the walls of block B and the buildings either side: a lip of mud, deeper on the side the water came from ----
  { const pos = [], idx = []; const run = (x0, y0, x1, y1, ox, oy, h0) => { const L = Math.hypot(x1 - x0, y1 - y0), N = Math.ceil(L / 0.5), base = pos.length / 3, K = 5; for (let i = 0; i <= N; i++) { const t = i / N, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, f = n.fbm(x / 4 + 3, y / 4, 3), door = smooth(2.2, 4.2, Math.hypot(x - hall[0], y - 30)), end = smooth(0, 0.04, t) * smooth(1, 0.96, t); const hh = h0 * (0.25 + f * 1.3) * door * (0.3 + 0.7 * end), w = (0.5 + f * 2.4) * (0.4 + 0.6 * door); for (let k = 0; k < K; k++) { const u = k / (K - 1), q = (1 - u) * (1 - u); pos.push(x + ox * u * w, hh * q * (0.9 + 0.2 * n(x * 3 + k, y * 3)) - 0.02 - u * 0.03, -(y + oy * u * w)); } } for (let i = 0; i < N; i++) for (let k = 0; k < K - 1; k++) { const a = base + i * K + k; idx.push(a, a + 1, a + K, a + 1, a + K + 1, a + K); } };
    run(B[0], B[1] - 0.16, B[2], B[1] - 0.16, 0, -1, 0.22); run(B[0] - 0.16, B[1], B[0] - 0.16, B[3], -1, 0, 0.62); run(B[2] + 0.16, B[1], B[2] + 0.16, 49, 1, 0, 0.25); run(B[0], B[3] + 0.16, 77, B[3] + 0.16, 0, 1, 0.5);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); const uv = new Float32Array(pos.length / 3 * 2); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); const m = mats.mud.clone(); m.side = THREE.DoubleSide; m.normalMap = null; m.color.set(0x6a5d4c); group.add(mesh(g, m, { cast: false, name: 'silt' })); }

  // ---- trunks, stripped and stacked by the water ----
  { const T = []; const log = (x, y, len, r, a, tilt) => { T.push(xform(new THREE.CylinderGeometry(r * 0.7, r, len, 9, 4).rotateZ(Math.PI / 2), x, r * 0.75 + Math.abs(Math.sin(tilt)) * len * 0.45, -y, a, 0, tilt)); for (let k = 0; k < 3; k++) { const s = (R() - 0.5) * len * 0.8; T.push(xform(new THREE.CylinderGeometry(0.02, 0.06, 0.7 + R(), 5).translate(0, 0.45, 0), x + Math.cos(a) * s, r, -y + -Math.sin(a) * s * -1 * -1, R() * 6, 0.7, 0.4)); } };
    for (const [x, y] of [[98, 44], [40.6, 57], [108, 24], [38, 40], [92, 63]]) for (let i = 0; i < 4; i++) log(x + R.gauss() * 1.6, y + R.gauss() * 1.6, 4 + R() * 5, 0.14 + R() * 0.2, 0.6 + R.gauss() * 0.5, (R() - 0.5) * 0.24);
    const g = merge(T, { keepUV: false }); const m = new THREE.MeshStandardMaterial({ color: 0x4b3d2f, roughness: 0.95 }); group.add(mesh(g, m, { name: 'trunks' })); }

  // ---- small things, thousands of them, thickest along lines where the water slowed ----
  const high = env.quality === 'high', drift = (x, y) => n.fbm(x / 9 + 20, y / 9 + 4, 3); const scatter = (count, fn, m = 0.4) => { const out = []; for (let i = 0; i < count * 6 && out.length < count; i++) { const x = 6 + R() * 112, y = -2 + R() * 92; if (!free(x, y, m) || drift(x, y) < 0.5 + (R() - 0.5) * 0.2) continue; out.push(fn(x, y)); } return out; };
  const k = high ? 1 : 0.4, sheet = new THREE.PlaneGeometry(1.1, 2.2, 14, 3).rotateX(-Math.PI / 2); { const p = sheet.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(p.getX(i) * 34) * 0.016 + Math.pow(p.getZ(i), 2) * 0.16 + p.getX(i) * p.getZ(i) * 0.1); sheet.computeVertexNormals(); }
  const branch = merge([tube([new THREE.Vector3(-0.8, 0, 0), new THREE.Vector3(-0.2, 0.06, 0.08), new THREE.Vector3(0.4, 0.03, -0.04), new THREE.Vector3(0.9, 0.08, 0.1)], 0.022, { radial: 4, segs: 6 }), tube([new THREE.Vector3(-0.1, 0.05, 0.06), new THREE.Vector3(0.2, 0.16, 0.35), new THREE.Vector3(0.45, 0.1, 0.6)], 0.012, { radial: 3, segs: 3 }), tube([new THREE.Vector3(0.3, 0.03, -0.02), new THREE.Vector3(0.6, 0.18, -0.3)], 0.01, { radial: 3, segs: 2 })], { keepUV: false });
  const add = (geo, mat, list, colors, cast, name) => { if (list.length) group.add(instanced(geo, mat, list, { colors, cast, name })); }, cols = (list, set) => list.map(() => R.pick(set));
  const wood = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), mattePaper = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
  const sh = scatter(46 * k, (x, y) => matrix(x, 0.12 + R() * 0.12, -y, R() * 6, (R() - 0.5) * 0.4, (R() - 0.5) * 0.4)); add(sheet, mats.cgi, sh, null, true, 'sheets');
  const br = scatter(900 * k, (x, y) => matrix(x, 0.02, -y, R() * 6, R.gauss() * 0.1, R.gauss() * 0.1, 0.5 + R() * 1.1)); add(branch, wood, br, cols(br, [0x3a2e23, 0x4a3b2c, 0x2c241c]), high, 'branches');
  const bk = scatter(1500 * k, (x, y) => matrix(x, 0.02, -y, R() * 6, R.gauss() * 0.5, R.gauss() * 0.5, 0.8 + R() * 0.35)); add(new THREE.BoxGeometry(0.22, 0.075, 0.11), wood, bk, cols(bk, [0x6b3f30, 0x7a4a38, 0x5a3a2e, 0x6a6058]), false, 'bricks');
  const pl = scatter(420 * k, (x, y) => matrix(x, 0.035, -y, R() * 6, R.gauss() * 0.06, R.gauss() * 0.08, [0.5 + R() * 1.4, 1, 1])); add(new THREE.BoxGeometry(1.4, 0.03, 0.13), wood, pl, cols(pl, [0x5b4a38, 0x6d5a44, 0x453729]), high, 'planks');
  const st2 = scatter(2600 * k, (x, y) => { const s = 0.04 + R() * R() * R() * 0.3; return matrix(x, s * 0.2, -y, R() * 6, R() * 6, 0, [s, s * 0.7, s]); }); add(new THREE.IcosahedronGeometry(1, 0), mats.rock, st2, null, false, 'pebbles');
  const pp = scatter(220 * k, (x, y) => matrix(x, 0.02, -y, R() * 6, R.gauss() * 0.08, R.gauss() * 0.08)); const paper = new THREE.PlaneGeometry(0.2, 0.28, 3, 3).rotateX(-Math.PI / 2); { const p = paper.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.abs(p.getX(i)) * 0.12); paper.computeVertexNormals(); } add(paper, mattePaper, pp, cols(pp, [0x8f897b, 0x7b7466, 0xa09a8a]), false, 'paper');
  // school desks and chairs the water took out through the collapsed corner
  { const D = [tint(box(1.1, 0.03, 0.45, 0, 0.72, 0), 0x8a6b48), tint(box(1.1, 0.03, 0.28, 0, 0.42, 0.52), 0x8a6b48)]; for (const x of [-0.5, 0.5]) for (const z of [-0.18, 0.18, 0.6]) D.push(tint(box(0.035, z > 0.5 ? 0.42 : 0.72, 0.035, x, 0, z), 0x2c3136)); const g = merge(D, { keepUV: false, keepColor: true }), list = []; for (let i = 0; i < 16; i++) { const a = R() * 1.4 + 0.1, r = 5 + R() * 15; list.push(matrix(85 + Math.cos(a) * r, 0.1 + R() * 0.25, -(56 + Math.sin(a) * r * 0.5), R() * 6, (R() - 0.5) * 2.4, (R() - 0.5) * 2.4)); } group.add(instanced(g, mats.paint, list, { name: 'desks-out' })); }
  return { group };
}
