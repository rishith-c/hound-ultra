// The rover, assembled. Frame, drive and deck hardware come from our CAD (rover_parts.bin); boards are drawn at their real
// outlines; the foam deck, the foam mast and the layout are read off the photograph through the solved camera (PHOTO below).
import * as THREE from 'three';
import { Part, rbox, cyl, extrude, chamfered, boxUV, makeMaterials, rng } from './materials.js';
import { pi4, unoR4, shield, driver, heatsink, esp32, ld2450, mlx, tof } from './boards.js';

// Camera of assets/img/landing/rover-real.jpg (1060 x 596), solved by least squares from four wheel centres and five frame
// corners, all within 3 px. CAD axes, metres. The same solve returned a 0.480 m track (the CAD says 0.480) and a 0.321 m wheelbase.
export const PHOTO = { w: 1060, h: 596, f: 1424.55, pos: [1.40357, -0.07516, 0.88656], yaw: 0.00217, pitch: 0.45409, roll: 0.00131 };
export const TRACK = .24, BASE = .1605, RW = .04, RAIL = .098, DECK = .102;
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
export function photoBasis() {
  const { yaw, pitch, roll } = PHOTO, d = new THREE.Vector3(-Math.cos(yaw) * Math.cos(pitch), -Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch));
  const r0 = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 0, 1)).normalize(), u0 = new THREE.Vector3().crossVectors(r0, d);
  const c = Math.cos(roll), s = Math.sin(roll);
  return { d, r: r0.clone().multiplyScalar(c).addScaledVector(u0, s), u: u0.clone().multiplyScalar(c).addScaledVector(r0, -s) };
}
// the point on a plane (point p0, normal n) behind one pixel of the photograph
export function fromPhoto(px, py, p0, n) {
  const { d, r, u } = photoBasis(), o = v3(PHOTO.pos), dir = d.clone().addScaledVector(r, (px - PHOTO.w / 2) / PHOTO.f).addScaledVector(u, -(py - PHOTO.h / 2) / PHOTO.f);
  const t = p0.clone().sub(o).dot(n) / dir.dot(n); return o.addScaledVector(dir, t);
}

export async function loadCad() {
  const res = await fetch(new URL('../../../assets/models/rover_parts.bin', import.meta.url)); if (!res.ok) throw new Error('rover_parts.bin ' + res.status);
  const buf = await res.arrayBuffer(), n = new DataView(buf).getUint32(0, true), meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))), o = 4 + n;
  const geos = meta.meshes.map((m) => {
    const q = new Uint16Array(buf, o + m.pos, m.verts * 4), nb = new Int8Array(buf, o + m.nor, m.verts * 4), P = new Float32Array(m.verts * 3), N = new Float32Array(m.verts * 3);
    for (let i = 0; i < m.verts; i++) for (let a = 0; a < 3; a++) { P[i * 3 + a] = m.lo[a] + q[i * 4 + a] / 65535 * m.ex[a]; N[i * 3 + a] = nb[i * 4 + a] / 127; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf.slice(o + m.idx, o + m.idx + m.count * 2)), 1)); return boxUV(g);
  });
  return { nodes: meta.nodes.map((x) => ({ ...x, matrix: new THREE.Matrix4().fromArray(x.m) })), geos };
}

// the profile of 2020 V-slot extrusion, millimetres
function vslot() {
  const q = [[-9.3, 10], [-4.6, 10], [-3.1, 8.4], [-3.1, 8.2], [-5.5, 8.2], [-5.5, 6.6], [-2.9, 4.1], [2.9, 4.1], [5.5, 6.6], [5.5, 8.2], [3.1, 8.2], [3.1, 8.4], [4.6, 10], [9.3, 10], [9.8, 9.8]];
  const out = []; for (let k = 0; k < 4; k++) { const c = Math.round(Math.cos(-k * Math.PI / 2)), s = Math.round(Math.sin(-k * Math.PI / 2)); for (const [x, y] of q) out.push([(x * c - y * s) / 1000, (x * s + y * c) / 1000]); }
  return out.reverse();
}
const smooth = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * x * (x * (x * 6 - 15) + 10); };

export async function buildRover() {
  const M = makeMaterials(), { nodes, geos } = await loadCad();
  const root = new THREE.Group(); root.name = 'rover'; root.rotation.x = -Math.PI / 2;      // CAD z-up to three y-up
  const built = new THREE.Group(); root.add(built);
  const parts = new Map(), moving = [];
  const put = (id, P, pos, off, win = [0, 1], { group = id, parent = built, quat } = {}) => {
    const g = P instanceof Part ? P.build() : P; g.position.set(...pos); if (quat) g.quaternion.copy(quat); parent.add(g); g.traverse((m) => { if (m.isMesh) m.userData.group = group; });
    if (!parts.has(group)) parts.set(group, []); parts.get(group).push(g); moving.push({ g, base: g.position.clone(), off: v3(off), a: win[0], b: win[1] }); return g;
  };
  const cadNode = (name) => nodes.find((x) => x.name === name);

  // ── frame
  const railGeo = extrude(vslot(), .35, { bevel: 0, holes: [[0, 0, .0021]] }); // axis z
  const railX = railGeo.clone().rotateY(Math.PI / 2); const rail = () => new Part('rail').addM(M.anodised, boxUV(railX.clone()), new THREE.Matrix4());
  const LIFT = .13, zr = RAIL - .01;
  put('rail', rail(), [0, .185, zr], [0, .035, LIFT], [.1, .75], { group: 'frame' }); put('rail', rail(), [0, -.185, zr], [0, -.035, LIFT], [.1, .75], { group: 'frame' });
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  put('rail', rail(), [.165, 0, zr], [.045, 0, LIFT], [.1, .75], { group: 'frame', quat: qz }); put('rail', rail(), [-.165, 0, zr], [-.045, 0, LIFT], [.1, .75], { group: 'frame', quat: qz });
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    const P = new Part('corner'); P.add(M.plastic, extrude([[0, 0], [.017, 0], [.017, .002], [.002, .017], [0, .017]], .018, { bevel: .0005 }), 0, 0, 0, 0, 0, sx > 0 ? (sy > 0 ? Math.PI : Math.PI / 2) : (sy > 0 ? -Math.PI / 2 : 0));
    P.add(M.steel, cyl(.0035, .0035, .003), -sx * .009, -sy * .0015, 0, Math.PI / 2, 0, 0); P.add(M.steel, cyl(.0035, .0035, .003), -sx * .0015, -sy * .009, 0, 0, Math.PI / 2, 0);
    put('corner', P, [sx * .1548, sy * .1748, zr], [sx * .022, sy * .018, LIFT], [.1, .75], { group: 'frame' });
  }
  // ── motors, brackets, hubs, wheels
  const motorShape = chamfered(.0423, .0423, .0046), capHoles = [[.0155, .0155, .0016], [-.0155, .0155, .0016], [.0155, -.0155, .0016], [-.0155, -.0155, .0016]];
  const legShape = [[-.025, -.021], [-.021, -.025], [.021, -.025], [.025, -.021], [.025, .037], [-.025, .037]];
  const leg = extrude(legShape, .003, { bevel: .0004, holes: [[0, 0, .0115], ...capHoles.map(([x, y, r]) => [x, y, r, .004])], curve: 20 });
  const foot = extrude(chamfered(.05, .05, .002), .003, { bevel: .0004, holes: [[-.012, 0, .0022, .016], [.012, 0, .0022, .016]] });
  const wheels = [];
  const CADW = { FL: ['front_left', 1, 1], FR: ['front_right', 1, -1], RL: ['rear_left', -1, 1], RR: ['rear_right', -1, -1] };
  // roller: the CAD barrel, cut with the tread ribs a real one has
  const rollerGeo = (() => {
    const g = geos[cadNode('free_roller_1').mesh].attributes.position, ring = new Map(); for (let i = 0; i < g.count; i++) { const z = +g.getZ(i).toFixed(4), r = Math.hypot(g.getX(i), g.getY(i)); ring.set(z, Math.max(ring.get(z) || 0, r)); }
    const prof = [...ring].sort((a, b) => a[0] - b[0]), R = (z) => { let k = prof.findIndex((p) => p[0] >= z); if (k <= 0) k = 1; const [a, b] = [prof[k - 1], prof[k]], t = (z - a[0]) / (b[0] - a[0] || 1); return a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, t)); };
    const z0 = prof[0][0], z1 = prof[prof.length - 1][0], pts = [new THREE.Vector2(.0022, z0)]; for (let i = 0; i <= 24; i++) { const z = z0 + (z1 - z0) * i / 24; pts.push(new THREE.Vector2(R(z), z)); } pts.push(new THREE.Vector2(.0022, z1));
    const l = new THREE.LatheGeometry(pts, 60), p = l.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, z); if (r < .004) continue; const a = Math.atan2(z, x), e = Math.abs(y) / z1; const cut = e < .93 ? .085 * Math.pow(Math.max(0, Math.cos(a * 10)), 6) : 0; p.setX(i, x * (1 - cut)); p.setZ(i, z * (1 - cut)); }
    l.computeVertexNormals(); l.rotateX(Math.PI / 2); return boxUV(l);
  })();
  const S8 = new THREE.Matrix4().makeScale(.8, .8, .8); // the CAD wheel is 100 mm; the rover has 80 mm wheels
  for (const [key, [nm, sx, sy]] of Object.entries(CADW)) {
    const cx = sx * BASE, cy = sy * TRACK, win = [.05, .7];
    const Mo = new Part('motor'); const rx = -sy * Math.PI / 2; // extrusions have axis z; turn it to +/- y
    Mo.add(M.lam, extrude(motorShape, .0255, { bevel: .0003 }), 0, 0, 0, rx); Mo.add(M.zinc, extrude(motorShape, .007, { bevel: .0006, holes: capHoles }), 0, sy * .0162, 0, rx); Mo.add(M.zinc, extrude(motorShape, .007, { bevel: .0006, holes: capHoles }), 0, -sy * .0162, 0, rx);
    Mo.add(M.alu, cyl(.011, .011, .002, 40), 0, sy * .0207, 0, rx); Mo.add(M.steel, cyl(.0025, .0025, .024, 24), 0, sy * .032, 0, rx);
    for (const [x, z] of capHoles) { Mo.add(M.steel, cyl(.0026, .0026, .0016, 18), x, -sy * .0202, z, rx); Mo.add(M.epoxy, cyl(.0012, .0012, .0018, 6), x, -sy * .0202, z, rx); }
    Mo.add(M.white, rbox(.0006, .024, .030, .0001, 1), sx * .0213, 0, 0); Mo.add(M.epoxy, rbox(.0003, .016, .0016, .0001, 1), sx * .0217, 0, .008); Mo.add(M.epoxy, rbox(.0003, .012, .0012, .0001, 1), sx * .0217, 0, .004); Mo.add(M.epoxy, rbox(.0003, .018, .0012, .0001, 1), sx * .0217, 0, 0);
    Mo.add(M.white, rbox(.016, .006, .006, .0003, 1), -sx * 0, -sy * .0168, .0235);
    put('motor', Mo, [cx, sy * .1722, RW], [0, -sy * .030, LIFT - .075], [.16, .85], { group: 'motors' });
    const Br = new Part('bracket'); Br.add(M.zinc, leg, 0, 0, 0, Math.PI / 2, 0, 0); Br.add(M.zinc, foot, 0, -sy * .0265, .0365 - .0000, 0, 0, 0); for (const [x, z] of capHoles) Br.add(M.steel, cyl(.0027, .0027, .0025, 18), x, sy * .0026, z, Math.PI / 2); for (const x of [-.012, .012]) Br.add(M.steel, cyl(.0042, .0042, .003, 6), x, -sy * .0265, .0335);
    put('bracket', Br, [cx, sy * .1935, RW], [0, sy * .030, LIFT - .040], [.12, .8], { group: 'motors' });
    const hubN = nodes.find((x) => x.name === nm + '_hub_interface_TBD'), hub = new Part('hub'); hub.addM(M.alu, geos[hubN.mesh], new THREE.Matrix4().makeTranslation(-sx * .125, -sy * .2165, -.05).multiply(hubN.matrix));
    put('hub', hub, [cx, sy * .2135, RW], [0, sy * .075, .0], [.06, .75], { group: 'wheels' });
    const wg = new THREE.Group(), spin = new THREE.Group(); wg.add(spin); const C = new THREE.Matrix4().makeTranslation(-sx * .125, -sy * .24, -.05), rel = (x) => S8.clone().multiply(C).multiply(x.matrix);
    const list = nodes.filter((x) => x.group === nm + '_mecanum'), core = new Part('wheel'), out = new Part('wheel'), inn = new Part('wheel');
    const rol = list.filter((x) => x.name.startsWith('free_roller')), axl = list.filter((x) => x.name.startsWith('roller_axle'));
    for (const x of list) {
      if (x.name === 'wheel_core') core.addM(M.aluDark, geos[x.mesh], rel(x));
      else if (x.name === 'wheel_side_plate') { const m = rel(x), bb = geos[x.mesh]; bb.computeBoundingBox(); const cy0 = bb.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(m).y; (cy0 * sy > 0 ? out : inn).addM(M.aluDark, geos[x.mesh], m); }
      else if (x.name.startsWith('roller_support')) { const m = rel(x), p = new THREE.Vector3().setFromMatrixPosition(m); geos[x.mesh].computeBoundingBox(); geos[x.mesh].boundingBox.getCenter(p).applyMatrix4(m); (p.y * sy > 0 ? out : inn).addM(M.aluDark, geos[x.mesh], m); }
    }
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + .3; out.add(M.steel, cyl(.0016, .0016, .0016, 12), Math.cos(a) * .0125, sy * .0122, Math.sin(a) * .0125, Math.PI / 2); }
    out.add(M.steel, cyl(.0055, .0055, .003, 6), 0, sy * .0128, 0, Math.PI / 2); out.add(M.brass, cyl(.0025, .0025, .0055, 20), 0, sy * .0128, 0, Math.PI / 2);
    const gOut = out.build(), gIn = inn.build(), gCore = core.build(); spin.add(gOut, gIn, gCore);
    const ri = new THREE.InstancedMesh(rollerGeo, M.rubber, 8), ai = new THREE.InstancedMesh(geos[axl[0].mesh], M.steel, 8); ri.castShadow = ri.receiveShadow = ai.castShadow = true; ri.userData.mat = M.rubber; ai.userData.mat = M.steel;
    const rest = rol.map(rel).map((m) => { const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s); return { p, q, s, spin: 0, dir: p.clone().setY(0).normalize() }; }), arest = axl.map(rel);
    rest.forEach((r, i) => ri.setMatrixAt(i, new THREE.Matrix4().compose(r.p, r.q, r.s))); arest.forEach((m, i) => ai.setMatrixAt(i, m)); ri.frustumCulled = ai.frustumCulled = false; spin.add(ri, ai);
    put('wheel', wg, [cx, cy, RW], [0, sy * .155, .0], [0, .62], { group: 'wheels' });
    wheels.push({ key, sx, sy, spin, gOut, gIn, ri, ai, rest, arest, angle: 0, open: 0 });
  }
  // ── deck: foam board on the frame, as built
  const deck = new Part('deck'), oct = [[.178, -.098], [.178, .088], [.112, .172], [-.112, .178], [-.168, .118], [-.168, -.118], [-.118, -.172], [.104, -.193]];
  deck.add(M.foam, extrude(oct, .005, { bevel: .0006 }), 0, 0, 0);
  deck.add(M.tape, rbox(.085, .042, .0007, .0003, 1), .064, -.118, .0028, 0, 0, .5); deck.add(M.tape, rbox(.06, .03, .0006, .0003, 1), .128, -.112, .0029, 0, 0, -.35); deck.add(M.tape, rbox(.05, .026, .0006, .0003, 1), -.06, -.15, .0028, 0, 0, .2);
  put('deck', deck, [0, 0, DECK - .0015], [0, 0, LIFT + .075], [.18, .85]);
  // ── mast: a folded foam-board box that leans back, red tape at the foot
  const A = v3([.15, -.0035, DECK]), U = new THREE.Vector3(0, 1, 0), Vv = new THREE.Vector3(-.154, -.0305, .354), N = new THREE.Vector3().crossVectors(U, Vv).normalize();
  const shear = (g) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - .0305 * (p.getZ(i) / .354)); return g; };
  const prism = (t0, t1, n0, n1, w, bev = .0012) => { // a slab of the leaning box between heights t0..t1 and depths n0..n1 along the face normal
    const lean = (t, n) => [-.154 * t + N.x * n, .354 * t + N.z * n], base = (n) => [n / N.x, 0];
    const pts = [t0 === 0 ? base(n1) : lean(t0, n1), lean(t1, n1), lean(t1, n0), t0 === 0 ? base(n0) : lean(t0, n0)];
    return boxUV(shear(extrude(pts, w, { bevel: bev }).rotateX(Math.PI / 2)));
  };
  const MZ = [-.34, 0, LIFT + .13], mw = [.22, .95];
  const mast = new Part('mast'); const at0 = [A.x, A.y, A.z];
  mast.add(M.foam, prism(0, 1, -.045, 0, .181)); mast.add(M.foam, prism(.79, 1.012, -.002, .0042, .184)); mast.add(M.foam, prism(.50, .985, -.049, -.044, .165));
  mast.add(M.tape, prism(0, .135, -.0462, .0011, .1835, .0006)); mast.add(M.tape, rbox(.05, .19, .0008, .0003, 1), .020, 0, .0026); mast.add(M.tape, rbox(.03, .06, .0008, .0003, 1), -.02, -.118, .0024, 0, 0, .3);
  put('mast', mast, at0, MZ, mw);
  // sensors live in the mast's own frame
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), N.clone().cross(new THREE.Vector3(0, 1, 0)).normalize(), N));
  const onMast = (px, py, lift = 0) => fromPhoto(px, py, A.clone().addScaledVector(N, lift), N);
  const onto = (P, px, py, lift, off, id, win) => { const p = onMast(px, py, lift); return put(id, P, [p.x, p.y, p.z], [N.x * off + MZ[0], 0, N.z * off * .6 + MZ[2]], win, { quat: q }); };
  const tp = new Part('mast'); tp.add(M.tape, rbox(.074, .034, .0007, .0003, 1), 0, 0, .0006); { const p = onMast(580, 118, .0044); put('mast', tp, [p.x, p.y, p.z], MZ, mw, { quat: q }); }
  const tp2 = new Part('mast'); tp2.add(M.tape, rbox(.036, .016, .0007, .0003, 1), 0, 0, .0004, 0, 0, -.5); { const p = onMast(591, 183, 0); put('mast', tp2, [p.x, p.y, p.z], MZ, mw, { quat: q }); }
  const cam = new Part('webcam'); // C920-class: long rounded bar, glass lens, clip
  cam.add(M.plastic, rbox(.098, .030, .022, .0105, 6), 0, 0, .020); cam.add(M.gloss, rbox(.090, .0235, .004, .0019, 4), 0, 0, .0305); cam.add(M.aluDark, cyl(.0115, .0115, .004, 44), 0, 0, .0318); cam.add(M.glass, cyl(.0088, .0092, .002, 44), 0, 0, .0338); cam.add(M.plastic, cyl(.0048, .0052, .0008, 32), 0, 0, .0347); cam.add(M.gloss, cyl(.0032, .0034, .0006, 24), 0, 0, .0352); cam.add(M.plastic, rbox(.034, .018, .012, .003, 3), 0, .012, .007); for (const s of [-1, 1]) for (let k = 0; k < 7; k++) for (let j = 0; j < 4; j++) cam.add(M.epoxy, cyl(.0007, .0007, .0006, 8), s * (.025 + k * .0022), (j - 1.5) * .0026, .0327); cam.add(M.white, cyl(.0009, .0009, .0008, 10), .0165, 0, .0327);
  onto(cam, 582, 138, .001, .085, 'webcam', [.34, 1]);
  onto(ld2450(M), 570, 90, .005, .125, 'radar', [.38, 1]);
  const th = mlx(M); th.add(M.printed, rbox(.024, .014, .012, .001, 2), 0, 0, -.006); onto(th, 583, 112, .019, .165, 'thermal', [.36, 1]);
  const tf = tof(M); const qx = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
  put('tof', tf, [.1752, -.004, zr + .001], [.115, 0, LIFT], [.2, .9], { quat: qx });
  // ── electronics on the deck
  const DZ = DECK + .0011, EZ = LIFT + .075, ew = [.26, .92];
  const lipo = new Part('battery'); lipo.add(M.gloss, rbox(.086, .050, .034, .003, 4), 0, 0, .017); lipo.add(M.tape, rbox(.046, .0512, .0352, .003, 3), -.012, 0, .0172); lipo.add(M.tape, rbox(.018, .0514, .0354, .003, 3), .022, 0, .0172); lipo.add(M.white, rbox(.0008, .028, .014, .003, 2), .0432, .004, .014); lipo.add(M.epoxy, rbox(.0004, .005, .006, .0003, 1), .0437, .004, .014); lipo.add(M.epoxy, rbox(.0004, .003, .003, .0003, 1), .0437, -.004, .015); lipo.add(M.tape, rbox(.10, .062, .0007, .0003, 1), -.004, .004, .0006, 0, 0, .12);
  put('battery', lipo, [.010, -.164, DZ], [0, -.075, EZ + .07], ew);
  const bank = new Part('bank'); bank.add(M.plastic, rbox(.104, .070, .026, .006, 4), 0, 0, .013); bank.add(M.gloss, rbox(.096, .062, .0006, .0003, 1), 0, 0, .0262); bank.add(M.steel, rbox(.0012, .012, .0045, .0004, 2), .0519, .010, .012); bank.add(M.steel, rbox(.0012, .009, .0032, .0012, 2), .0519, -.010, .012); for (let k = 0; k < 4; k++) bank.add(M.white, cyl(.0008, .0008, .0006, 10), .0522, -.024 + k * .003, .018, 0, Math.PI / 2);
  put('bank', bank, [.000, .143, DZ], [0, .075, EZ + .02], ew);
  const uno = unoR4(M); for (const [x, y] of [[-.02, -.024], [.032, -.019], [-.019, .024], [.032, .009]]) uno.add(M.brass, cyl(.0025, .0025, .008, 6), x, y, -.004);
  const zU = DZ + .0345; put('uno', uno, [.0, .141, zU], [0, .075, EZ + .085], ew, { group: 'uno' });
  const sh = shield(M); sh.add(M.epoxy, cyl(.0052, .0052, .016, 28), -.018, -.021, .010); sh.add(M.alu, cyl(.005, .005, .0005, 28), -.018, -.021, .0182); put('shield', sh, [0, .141, zU + .0118], [0, .075, EZ + .125], [.24, .94], { group: 'drivers' });
  [13, 30, 47, 61.5].forEach((x, k) => { const X = (x - 34.3) * .001, Y = .141 + (28 - 26.65) * .001; put('driver', driver(M, k), [X, Y, zU + .0218], [(k - 1.5) * .006, .075, EZ + .160], [.22, .96], { group: 'drivers' }); put('sink', heatsink(M, k), [X, Y - .001, zU + .0246], [(k - 1.5) * .006, .075, EZ + .188], [.20, 1], { group: 'drivers' }); });
  const pi = pi4(M); for (const [x, y] of [[-.039, -.0245], [.019, -.0245], [-.039, .0245], [.019, .0245]]) pi.add(M.brass, cyl(.0025, .0025, .010, 6), x, y, -.005);
  put('pi', pi, [-.112, .040, DZ + .010], [.02, -.005, EZ + .10], ew, { quat: qz });
  const es = esp32(M); for (const x of [-.02, .02]) es.add(M.printed, rbox(.008, .025, .006, .0006, 1), x, 0, -.003);
  put('radio', es, [-.085, -.062, DZ + .007], [.02, -.085, EZ + .19], [.24, .96]);
  const b2 = new Part('bank2'); b2.add(M.plastic, rbox(.090, .026, .026, .011, 6), 0, 0, .013); b2.add(M.steel, rbox(.0012, .012, .0045, .0004, 1), .0452, 0, .013); put('bank2', b2, [-.085, -.103, DZ], [.0, -.10, EZ + .07], ew);

  // ── wiring, drawn in when the rover is closed, pulled back when it opens
  const tubes = { silicone: [], siliconeRed: [], white: [] };
  const wire = (mat, pts, r = .0010, seg = 46) => { const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => p.isVector3 ? p : v3(p)), false, 'centripetal'), seg, r, 6); tubes[mat].push(g.toNonIndexed()); };
  const m_ = (px, py, l = .004) => onMast(px, py, l), rr = rng(5), jit = (a) => (rr() - .5) * a;
  wire('silicone', [m_(590, 78, .010), m_(612, 69, .014), m_(650, 72, .018), m_(664, 95, .02), m_(668, 140, .016), m_(676, 190, .012), m_(694, 238, .006), [.03, .118, .22], [.02, .128, .175], [.01, .135, .160]], .0011, 80);
  wire('silicone', [m_(598, 92, .010), m_(640, 78, .012), m_(660, 110, .018), m_(672, 170, .014), m_(682, 215, .008), [.05, .115, .23], [.025, .130, .18], [-.005, .132, .158]], .0010, 80);
  wire('silicone', [m_(606, 150, .020), m_(612, 180, .012), m_(640, 220, .007), m_(690, 250, .006), m_(735, 275, .006), [.04, .155, .185], [.02, .15, .165]], .0017, 80);
  wire('siliconeRed', [m_(600, 130, .012), m_(598, 170, .01), m_(604, 205, .005), m_(612, 235, .004), m_(604, 265, .004), m_(612, 310, .004), m_(640, 348, .005), m_(680, 345, .007), [.07, .118, .152], [.03, .133, .16]], .0009, 110);
  wire('silicone', [m_(575, 165, .006), m_(572, 195, .005), m_(588, 214, .004), m_(606, 222, .004), m_(618, 250, .004)], .0009, 50);
  wire('silicone', [m_(540, 165, .004), m_(556, 178, .006), m_(578, 180, .004)], .0012, 30);
  for (let k = 0; k < 10; k++) wire(k % 3 === 1 ? 'siliconeRed' : 'silicone', [[-.035 + k * .007, .141 + jit(.02), .158], [.0 + jit(.05), .15 + jit(.03), .185 + jit(.03)], [.05 + jit(.05), .165 + jit(.03), .172 + jit(.03)], [.06 + jit(.04), .172 + jit(.03), .135 + jit(.02)], [.05 + jit(.06), .184 + jit(.01), .106]], .0009, 60);
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (let k = 0; k < 4; k++) wire(k % 2 ? 'siliconeRed' : 'silicone', [[sx * BASE + (k - 1.5) * .002, sy * .156, .068], [sx * (BASE - .02), sy * (.15 - k * .002), .088], [sx * (.10 - k * .002), sy * .13, .0945], [sx * .05, (sy * .13 + .14) / 2, .0950], [.0, .12, .096 + k * .0006], [-.030 + k * .002, .112, .112], [-.02 + k * .003, .122, .150]], .0008, 70);
  wire('siliconeRed', [[-.034, -.158, .118], [-.07, -.15, .128], [-.09, -.12, .118], [-.06, -.02, .108], [-.02, .06, .108], [.02, .10, .12], [.028, .118, .156]], .0017, 80);
  wire('silicone', [[-.034, -.166, .118], [-.075, -.158, .126], [-.095, -.125, .116], [-.06, -.025, .108], [-.02, .055, .108], [.024, .096, .12], [.032, .118, .156]], .0017, 80);
  wire('white', [[.05, -.18, .13], [.03, -.205, .15], [.00, -.215, .165]], .0013, 24);
  wire('silicone', [[-.053, .130, .116], [-.075, .10, .13], [-.10, .075, .13], [-.118, .062, .118]], .0018, 50);      // bank to Pi
  wire('silicone', [[-.038, .15, .15], [-.07, .14, .165], [-.105, .11, .15], [-.112, .088, .125]], .0017, 50);       // Pi to UNO
  wire('white', [[-.039, -.103, .116], [-.02, -.10, .13], [-.03, -.08, .13], [-.053, -.064, .118]], .0016, 50);      // bank 2 to ESP32
  const cut = { value: 1 }, cables = new THREE.Group(); built.add(cables);
  for (const [k, list] of Object.entries(tubes)) { const P = new Part('wiring'); for (const g of list) P.addM(M[k], g, new THREE.Matrix4()); const g = P.build(); const me = g.children[0], mat = M[k].clone(); mat.onBeforeCompile = (sh2) => { sh2.uniforms.uCut = cut; sh2.vertexShader = sh2.vertexShader.replace('#include <common>', '#include <common>\nvarying float vAlong;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvAlong = uv.x;'); sh2.fragmentShader = sh2.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlong; uniform float uCut;').replace('#include <clipping_planes_fragment>', 'if (vAlong > uCut) discard;\n#include <clipping_planes_fragment>'); }; me.material = mat; me.userData.mat = mat; me.userData.group = 'wiring'; cables.add(me); }
  parts.set('wiring', [cables]);

  // ── the CAD exactly as drawn (Advanced: the older design with the sweep mast that was not fitted)
  const cad = new THREE.Group(); cad.visible = false; root.add(cad);
  { const MM = [M.alu, M.cadDark, M.printed, M.cadBlue, M.rubber, M.tile, M.cadGreen, M.cadRed, M.brass], P = new Part('cad'); for (const x of nodes) P.addM(MM[x.mat], geos[x.mesh], x.matrix); cad.add(P.build()); }

  // ── motion
  const tmpM = new THREE.Matrix4(), tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1);
  function poseWheel(w) { for (let i = 0; i < 8; i++) { const r = w.rest[i]; tmpP.copy(r.p).addScaledVector(r.dir, w.open * .012); tmpQ.setFromAxisAngle(Z, r.spin); tmpQ.premultiply(r.q); w.ri.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, r.s)); } w.ri.instanceMatrix.needsUpdate = true; w.spin.rotation.y = w.angle; w.gOut.position.y = w.sy * w.open * .030; w.gIn.position.y = -w.sy * w.open * .014; }
  let last = -1;
  function explode(e) {
    if (Math.abs(e - last) < 1e-5) return; last = e;
    for (const m of moving) { const k = smooth((e - m.a) / (m.b - m.a)); m.g.position.set(m.base.x + m.off.x * k, m.base.y + m.off.y * k, m.base.z + m.off.z * k); }
    const o = smooth((e - .45) / .55); for (const w of wheels) { w.open = o; poseWheel(w); }
    cut.value = 1 - smooth(e / .16); for (const c of cables.children) { c.visible = cut.value > .01; c.castShadow = cut.value > .9; }
  }
  explode(0);
  // where a part's leader line starts: a point in its own frame, in world space
  const first = (g) => parts.get(g)[0];
  const ANCH = { radio: [first('radio'), [.018, 0, .006]], radar: [first('radar'), [.006, 0, .003]], thermal: [first('thermal'), [.003, 0, .008]], pi: [first('pi'), [.0, .005, .004]], wheels: [wheels.find((w) => w.key === 'FL').spin.parent, [0, .016, .03]], uno: [first('uno'), [0, 0, .004]], battery: [first('battery'), [0, 0, .035]], bank: [first('bank'), [0, 0, .027]], bank2: [first('bank2'), [0, 0, .026]], drivers: [first('drivers'), [0, 0, .01]], webcam: [first('webcam'), [0, 0, .035]], tof: [first('tof'), [0, 0, .003]], motors: [first('motors'), [0, 0, .02]], frame: [first('frame'), [.1, 0, .01]], deck: [first('deck'), [.1, -.02, .003]], mast: [first('mast'), [-.07, 0, .18]] };
  const anchor = (id, out) => { const [g, l] = ANCH[id] || ANCH.frame; return out.set(l[0], l[1], l[2]).applyMatrix4(g.matrixWorld); };
  return { root, built, cad, parts, wheels, poseWheel, explode, anchor, M, cables };
}
