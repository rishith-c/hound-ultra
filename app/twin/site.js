// Everything man-made outdoors that is not a building or a rubble pile: the rescue team's staging area (tent,
// table, cases, generator, mast), the drone pad, the pickup, the road's kerbs, culvert and power line, and what the
// flood left on the open ground. The water ran from the north-east to the south-west: things that float are
// stranded along that line and jammed against the upstream sides of buildings, poles and the yard wall.
// Static geometry is merged by material (vertex colours for paint, plastic and metal); stones are instanced.
import * as THREE from 'three';
import { box, cyl, xform, matrix, merge, mesh, instanced, tint, rng, tube, rock, worldUV, smooth, lerp } from './util.js';
import { cv, tex as canvasTex, tileNoise, FLOOD_H } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0), PI = Math.PI;
const MUD = new THREE.Color(0x5c5245), SILT = new THREE.Color(0x776d5d);
const FLOW = Math.atan2(-0.46, -0.89), FX = -0.89, FY = -0.46;                    // the way the water went
const ROAD = [[-40, 4.6], [-6, 5.4], [26, 6.6], [58, 5.6], [92, 6.2], [126, 8.4], [160, 12.5]];
function roadAt(x) { for (let i = 0; i < ROAD.length - 1; i++) { const a = ROAD[i], b = ROAD[i + 1]; if (x <= b[0] || i === ROAD.length - 2) { const k = (x - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * k, Math.atan2(b[1] - a[1], b[0] - a[0])]; } } }

// ---- small geometry helpers ----
function rod(a, b, r, seg = 5, r2 = r, cap = false) {                              // a cylinder from a to b (three.js coordinates)
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length() || 1e-4, g = new THREE.CylinderGeometry(r2, r, len, seg, 1, !cap);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.multiplyScalar(1 / len)));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}
function bev(w, h, d, r = 0.015, x = 0, y = 0, z = 0) {                            // a box with chamfered edges, base at y
  const s = new THREE.Shape(), a = w / 2 - r, b = d / 2 - r; s.moveTo(-a, -b); s.lineTo(a, -b); s.lineTo(a, b); s.lineTo(-a, b); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 1, steps: 1 });
  g.rotateX(-PI / 2); return g.translate(x, y + r, z);
}
const lathe = (pts, seg = 12) => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg);
function uvMul(g, su, sv, swap = false) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, (swap ? v : u) * su, (swap ? u : v) * sv); } return g; }
function quad(a, b, c, d, face) {                                                  // two triangles, turned to face the direction given
  const A = new THREE.Vector3(...a), n = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).cross(new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]));
  const flip = n.dot(new THREE.Vector3(...face)) < 0, v = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d], g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v.flat()), 3)); g.computeVertexNormals(); return g;
}
function dirty(g, top, amt = 0.8, col = MUD) {                                     // mud from the ground up to "top" metres, in the vertex colours
  const c = g.attributes.color, p = g.attributes.position; if (!c) return g;
  for (let i = 0; i < p.count; i++) { const k = amt * smooth(top, top * 0.3, p.getY(i)); c.setXYZ(i, lerp(c.getX(i), col.r, k), lerp(c.getY(i), col.g, k), lerp(c.getZ(i), col.b, k)); }
  return g;
}
const silted = (hex, k) => new THREE.Color(hex).lerp(SILT, k);
const sagLine = (a, b, sag, n = 10) => { const out = []; for (let i = 0; i <= n; i++) { const t = i / n; out.push(new THREE.Vector3(lerp(a.x, b.x, t), lerp(a.y, b.y, t) - sag * 4 * t * (1 - t), lerp(a.z, b.z, t))); } return out; };
const segDist = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t); };
const inPoly = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };

export function build(env) {
  const { world, mats, quality } = env, R = rng('site'), Q = quality === 'low' ? 0.6 : 1;
  const group = new THREE.Group(); group.name = 'site';
  const G = { paint: [], plastic: [], metal: [], fabric: [], wood: [], cgi: [], rubber: [], glass: [], screen: [], concrete: [], decal: [], mud: [] };
  const boulders = [], boulderCol = [], stones = [], stoneCol = [];

  // A part is [bucket, geometry]. Makers return lists of parts in their own frame (x forward, y up, z to the right);
  // place() moves a list to a site position and files it under its material.
  const P = (key, g, col, jit = 0) => { if (col != null) tint(g, col, jit, R); return [key, g]; };
  const move = (parts, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1) => { for (const p of parts) xform(p[1], x, y, z, ry, rx, rz, s); return parts; };
  const place = (parts, x, y, ry = 0, o = {}) => { for (const [key, g] of parts) { xform(g, x, o.h || 0, -y, ry, o.rx || 0, o.rz || 0, o.s || 1); if (o.dirt) dirty(g, o.dirt[0], o.dirt[1]); G[key].push(g); } };

  // ---- where nothing tall may stand: other modules' ground, the rover's lane, the team's ways in ----
  const SOLID = [[43.6, 29.6, 84.4, 58.4], [6, 38, 36, 72], [90, 18, 114, 48]];
  const POLYS = world.OBSTACLES.filter((o) => o.id === 'rubble-ne' || o.id === 'rubble-field').map((o) => { const cx = o.poly.reduce((s, p) => s + p[0], 0) / o.poly.length, cy = o.poly.reduce((s, p) => s + p[1], 0) / o.poly.length; return o.poly.map((p) => [cx + (p[0] - cx) * 1.18, cy + (p[1] - cy) * 1.18]); });
  const S0 = world.SITE.staging, PAD = world.SITE.dronePad, HOME = [22, 9];
  const LANES = [[S0, [64, 27], 1.1], [HOME, [43.3, 58.8], 1.1], [[43.3, 58.8], [87.3, 60.8], 1.0], [[43.3, 58.8], [96, 69], 1.0], [[84.8, 29.3], [86, 40], 1.0], [[86, 40], [87.3, 57.3], 1.0], [[87.3, 57.3], [87.3, 60.8], 1.0], [[42.8, 28], [43.3, 58.8], 0.9]];
  const KEEP = [];                                                                // footprints of what is placed by hand: [x, y, radius]
  function blocked(x, y, r = 0.3, tall = true) {
    for (const q of SOLID) if (x > q[0] - r && x < q[2] + r && y > q[1] - r && y < q[3] + r) return true;
    for (const p of POLYS) if (inPoly(x, y, p)) return true;
    for (const k of KEEP) if (Math.hypot(x - k[0], y - k[1]) < k[2] + r) return true;
    if (Math.hypot(x - PAD[0], y - PAD[1]) < 1.5 + r) return true;
    if (!tall) return false;
    if (x > 42 - r && x < 86 + r && y > 26 - r && y < 30) return true;                                   // the yard strip in front of block B
    if (x > 61.7 - r && x < 66.3 + r && y > 6.5 && y < 30) return true;                                   // the path to the entrance
    if (x > 21 && x < 87 && y < 30 && y > 9 + 0.30 * (x - 22) - 0.9 - r && y < 9 + 0.52 * (x - 22) + 0.9 + r) return true;   // the fan of straight lines from staging to the south face
    if (Math.hypot(x - S0[0], y - S0[1]) < 2.2 + r || Math.hypot(x - HOME[0], y - HOME[1]) < 2.2 + r) return true;
    for (const l of LANES) if (segDist(x, y, l[0], l[1]) < l[2] + r) return true;
    if (Math.abs(y - roadAt(x)[0]) < 2.7 + r) return true;                                                // the carriageway
    return false;
  }

  // ======================================================================== the atlas for flat painted things
  const [ac, a] = cv(1024), AR = rng('site:atlas');
  {
    a.fillStyle = '#2a2c2e'; a.fillRect(0, 0, 1024, 1024);
    // drone landing mat (0..512, 0..512): graphite cloth, pale ring, centre mark, bound edge, mud
    a.save(); a.beginPath(); a.rect(0, 0, 512, 512); a.clip();
    a.fillStyle = '#2b2e31'; a.fillRect(0, 0, 512, 512); tileNoise(a, 512, 512, AR, { cells: [64, 16, 4], alpha: 0.35 });
    a.strokeStyle = '#3d4145'; a.lineWidth = 18; a.strokeRect(9, 9, 494, 494);
    a.strokeStyle = 'rgba(205,201,188,0.9)'; a.lineWidth = 26; a.beginPath(); a.arc(256, 256, 186, 0, 7); a.stroke();
    a.lineWidth = 14; a.beginPath(); a.moveTo(256, 196); a.lineTo(256, 316); a.moveTo(196, 256); a.lineTo(316, 256); a.stroke();
    a.lineWidth = 8; for (let i = 0; i < 4; i++) { const an = i * PI / 2 + PI / 4; a.beginPath(); a.moveTo(256 + Math.cos(an) * 205, 256 + Math.sin(an) * 205); a.lineTo(256 + Math.cos(an) * 232, 256 + Math.sin(an) * 232); a.stroke(); }
    a.fillStyle = '#8f9498'; for (const [x, y] of [[24, 24], [488, 24], [24, 488], [488, 488]]) { a.beginPath(); a.arc(x, y, 9, 0, 7); a.fill(); }
    for (let i = 0; i < 46; i++) { const x = AR() * 512, y = AR() * 512, rad = 8 + AR() * 46, g = a.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, 'rgba(98,88,74,' + (0.2 + AR() * 0.35) + ')'); g.addColorStop(1, 'rgba(98,88,74,0)'); a.fillStyle = g; a.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    a.restore();
    // paper site map (512..1024, 0..366)
    a.save(); a.translate(512, 0); a.beginPath(); a.rect(0, 0, 512, 366); a.clip();
    a.fillStyle = '#c9c3b2'; a.fillRect(0, 0, 512, 366); tileNoise(a, 512, 366, AR, { cells: [128, 32, 8], alpha: 0.25 });
    a.strokeStyle = 'rgba(70,78,84,0.22)'; a.lineWidth = 1; for (let i = 0; i < 512; i += 32) { a.beginPath(); a.moveTo(i, 0); a.lineTo(i, 366); a.stroke(); a.beginPath(); a.moveTo(0, i); a.lineTo(512, i); a.stroke(); }
    const mx = (x) => 40 + x * 3.6, my = (y) => 340 - y * 3.6;
    a.strokeStyle = 'rgba(60,62,64,0.55)'; a.lineWidth = 16; a.beginPath(); a.moveTo(mx(-10), my(5)); a.quadraticCurveTo(mx(40), my(8), mx(130), my(7)); a.stroke();
    a.fillStyle = 'rgba(52,58,64,0.85)'; a.strokeStyle = '#2c3136'; a.lineWidth = 2;
    for (const q of [world.BUILDING.rect, [8, 40, 34, 70], [92, 20, 112, 46]]) { a.globalAlpha = q === world.BUILDING.rect ? 1 : 0.5; a.fillRect(mx(q[0]), my(q[3]), (q[2] - q[0]) * 3.6, (q[3] - q[1]) * 3.6); }
    a.globalAlpha = 1; a.strokeStyle = 'rgba(58,62,66,0.7)'; a.setLineDash([6, 5]); a.beginPath(); a.moveTo(mx(26), my(12)); a.lineTo(mx(64), my(27)); a.stroke(); a.setLineDash([]);
    a.beginPath(); a.arc(mx(26), my(12), 7, 0, 7); a.stroke(); a.beginPath(); a.arc(mx(20), my(17), 5, 0, 7); a.stroke();
    a.strokeStyle = 'rgba(40,40,40,0.12)'; a.lineWidth = 2; a.beginPath(); a.moveTo(256, 0); a.lineTo(256, 366); a.moveTo(0, 183); a.lineTo(512, 183); a.stroke();
    for (let i = 0; i < 9; i++) { const x = AR() * 512, y = AR() * 366, rad = 20 + AR() * 60, g = a.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, 'rgba(112,98,78,0.3)'); g.addColorStop(1, 'rgba(112,98,78,0)'); a.fillStyle = g; a.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    a.restore();
    // four kinds of paper litter (256 px cells along y = 512..768): ruled page, printed sheet, card, exercise-book cover
    for (let i = 0; i < 4; i++) {
      a.save(); a.translate(i * 256, 512); a.beginPath(); a.rect(0, 0, 256, 256); a.clip();
      a.fillStyle = ['#c6c1b3', '#bdb9ad', '#8e7f68', '#6f7a78'][i]; a.fillRect(0, 0, 256, 256); tileNoise(a, 256, 256, AR, { cells: [64, 16, 4], alpha: 0.3 });
      if (i === 0) { a.strokeStyle = 'rgba(84,98,112,0.4)'; a.lineWidth = 1.5; for (let y = 30; y < 256; y += 17) { a.beginPath(); a.moveTo(0, y); a.lineTo(256, y); a.stroke(); } a.strokeStyle = 'rgba(128,84,78,0.4)'; a.beginPath(); a.moveTo(34, 0); a.lineTo(34, 256); a.stroke(); }
      if (i === 1) { a.fillStyle = 'rgba(48,50,54,0.5)'; for (let y = 26; y < 236; y += 13) a.fillRect(22, y, 120 + AR() * 92, 3); }
      if (i === 3) { a.fillStyle = 'rgba(210,205,190,0.6)'; a.fillRect(56, 60, 144, 62); }
      for (let k = 0; k < 7; k++) { const x = AR() * 256, y = AR() * 256, rad = 20 + AR() * 80, g = a.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, 'rgba(96,84,68,' + (0.3 + AR() * 0.4) + ')'); g.addColorStop(1, 'rgba(96,84,68,0)'); a.fillStyle = g; a.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
      a.restore();
    }
  }
  const atlas = canvasTex(ac, { repeat: false, aniso: 8 });
  const decalMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.88, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const fabricMat = mats.fabric.clone(); fabricMat.color.set(0xa9a69a);
  const CELL = { pad: [0.004, 0.504, 0.496, 0.996], map: [0.504, 0.648, 0.996, 0.996], paper: (i) => [i * 0.25 + 0.012, 0.262, i * 0.25 + 0.238, 0.488] };
  function dq(w, l, c, x, y, z, ry = 0, rx = 0, rz = 0) { const g = new THREE.PlaneGeometry(w, l).rotateX(-PI / 2), uv = g.attributes.uv; for (let i = 0; i < 4; i++) uv.setXY(i, lerp(c[0], c[2], uv.getX(i)), lerp(c[1], c[3], uv.getY(i))); return xform(g, x, y, z, ry, rx, rz); }

  // ======================================================================== makers: staging gear
  const STEEL = 0x8d949b, DARK = 0x23272c;
  function caseBox(w, h, d, col, open = false) {                                   // a rugged transit case: ribs, latches, handle
    const hb = h * 0.62, hl = h - hb - 0.006, rib = new THREE.Color(col).multiplyScalar(0.72), out = [P('plastic', bev(w, hb, d, 0.022), col)];
    const lid = [P('plastic', bev(w, hl, d, 0.022), col)], nr = w > 0.9 ? 4 : w > 0.6 ? 3 : 2;
    for (let i = 0; i < nr; i++) { const x = (i + 0.5) / nr * (w - 0.16) - (w - 0.16) / 2; out.push(P('plastic', box(0.04, hb - 0.03, d + 0.018, x, 0.012), rib)); lid.push(P('plastic', box(0.04, hl - 0.02, d + 0.018, x, 0.012), rib)); }
    for (const sx of [-1, 1]) { out.push(P('metal', box(0.045, 0.07, 0.014, sx * w * 0.3, hb - 0.045, d / 2 + 0.004), STEEL)); out.push(P('plastic', box(0.03, 0.12, 0.03, sx * (w / 2 + 0.006), hb * 0.45, 0), DARK)); }
    out.push(P('plastic', box(0.16, 0.028, 0.03, 0, hb * 0.5, d / 2 + 0.006), DARK));
    if (open) { out.push(P('plastic', box(w - 0.07, 0.012, d - 0.07, 0, hb - 0.004), 0x17191b), P('plastic', box(w * 0.34, 0.03, d * 0.4, -w * 0.2, hb, 0.02), 0x3a3f43), P('plastic', box(w * 0.2, 0.045, d * 0.3, w * 0.18, hb, -0.03), 0x565b5f)); move(lid, 0, 0, d / 2); move(lid, 0, 0, 0, 0, -1.85); move(lid, 0, hb + 0.006, -d / 2); }
    else move(lid, 0, hb + 0.006, 0);
    return out.concat(lid);
  }
  function chair() {                                                               // folding chair, facing +x
    const out = [P('paint', box(0.4, 0.022, 0.4, 0.0, 0.44), 0x474c46), P('paint', xform(new THREE.BoxGeometry(0.022, 0.24, 0.4), -0.235, 0.7, 0, 0, 0, 0.16), 0x474c46)];
    for (const z of [-0.2, 0.2]) out.push(P('metal', rod([0.2, 0, z], [-0.26, 0.86, z], 0.011), STEEL), P('metal', rod([-0.24, 0, z], [0.18, 0.44, z], 0.011), STEEL));
    out.push(P('metal', rod([0.2, 0.02, -0.2], [0.2, 0.02, 0.2], 0.01), STEEL), P('metal', rod([-0.24, 0.02, -0.2], [-0.24, 0.02, 0.2], 0.01), STEEL), P('metal', rod([-0.26, 0.86, -0.2], [-0.26, 0.86, 0.2], 0.011), STEEL));
    return out;
  }
  function table() {                                                               // folding table 1.8 x 0.76, top at 0.745; long side along x
    const out = [P('plastic', bev(1.8, 0.045, 0.76, 0.012, 0, 0.7, 0), 0xa9a69c)];
    for (const sx of [-1, 1]) { const x = sx * 0.72; for (const z of [-0.3, 0.3]) out.push(P('metal', rod([x, 0, z], [x, 0.7, z], 0.013), STEEL)); out.push(P('metal', rod([x, 0.03, -0.3], [x, 0.03, 0.3], 0.012), STEEL), P('metal', rod([x, 0.42, 0], [sx * 0.3, 0.69, 0], 0.009), STEEL)); }
    const T = 0.745;
    // ruggedised laptop: screen faces +z (the south side, where the chairs are)
    out.push(P('plastic', bev(0.38, 0.034, 0.28, 0.008, -0.42, T, 0.02), 0x2a2e32), P('plastic', box(0.3, 0.004, 0.13, -0.42, T + 0.034, -0.02), 0x15171a), P('plastic', box(0.1, 0.004, 0.06, -0.42, T + 0.034, 0.105), 0x1b1d20), P('plastic', box(0.12, 0.02, 0.03, -0.42, T + 0.006, 0.17), 0x1b1d20));
    const lid = [P('plastic', bev(0.38, 0.26, 0.02, 0.006, 0, 0, 0), 0x2a2e32), ['screen', new THREE.PlaneGeometry(0.32, 0.2).translate(0, 0.135, 0.0105)]];
    for (const sx of [-1, 1]) for (const y of [0.012, 0.235]) lid.push(P('plastic', box(0.03, 0.03, 0.026, sx * 0.18, y, 0), 0x16181a));
    out.push(...move(move(lid, 0, 0, 0, 0, -0.3), -0.42, T + 0.03, -0.118));
    // radio handset standing up, a base radio, a mug, the map under four stones
    out.push(P('plastic', bev(0.062, 0.14, 0.036, 0.008, 0.02, T, -0.2), 0x202326), P('plastic', rod([0.035, T + 0.14, -0.2], [0.035, T + 0.27, -0.2], 0.006), 0x121416), P('plastic', cyl(0.009, 0.009, 0.016, 0.004, T + 0.14, -0.2, 8), 0x3b3f42));
    out.push(P('plastic', bev(0.26, 0.085, 0.2, 0.008, 0.62, T, -0.2), 0x33383b), P('plastic', box(0.2, 0.05, 0.004, 0.62, T + 0.018, -0.098), 0x15171a), P('plastic', rod([0.72, T + 0.085, -0.26], [0.73, T + 0.5, -0.27], 0.004), 0x121416));
    out.push(P('metal', lathe([[0, 0], [0.038, 0], [0.042, 0.09], [0.036, 0.09], [0.034, 0.008], [0, 0.008]], 10).translate(-0.05, T, 0.24), 0x70777a));
    out.push(['decal', dq(0.88, 0.62, CELL.map, 0.33, T + 0.004, 0.06, 0.1)]);
    for (const [x, z] of [[-0.06, -0.2], [0.72, -0.13], [0.7, 0.3], [-0.04, 0.3]]) out.push(['concrete', rock(0.03 + R() * 0.012, R, { flat: 0.6, detail: 0 }).translate(0.33 + (x - 0.33) * 0.96, T + 0.02, 0.06 + (z - 0.06) * 0.9)]);
    return out;
  }
  function tent() {                                                                // 4 x 6 m frame tent; ridge along z; south end (+z) open, east wall rolled up
    const out = [], EA = 2.0, RI = 2.92, st = (a2, b2, r = 0.021) => out.push(P('metal', rod(a2, b2, r, 6), 0x858c92));
    for (const x of [-2, 2]) { for (const z of [-3, 0, 3]) { st([x, 0, z], [x, EA, z], 0.024); out.push(P('metal', box(0.14, 0.012, 0.14, x, 0, z), 0x6d7378)); st([x, EA - 0.4, z], [x * 0.8, EA + 0.18, z], 0.012); st([x, EA, z], [0, RI, z]); } st([x, EA, -3], [x, EA, 3]); st([x * 0.5, EA + (RI - EA) * 0.5, -3], [x * 0.5, EA + (RI - EA) * 0.5, 3], 0.014); }
    st([0, RI, -3], [0, RI, 3]); st([-2, EA, -3], [2, EA, -3]); st([-2, EA, 3], [2, EA, 3]);
    // roof: two slopes that sag between the rafters, and a valance along the eaves
    const roofH = (x, z) => { const t = 1 - Math.min(1, Math.abs(x) / 2); return EA + (RI - EA) * t + 0.03 - 0.075 * Math.sin(PI * Math.min(1, t * 1.05)) * Math.abs(Math.sin(PI * (z + 3) / 3)) - 0.02 * Math.abs(Math.sin(PI * (z + 3) / 1.5)); };
    const roof = new THREE.PlaneGeometry(4.24, 6.2, 16, 24).rotateX(-PI / 2), rp = roof.attributes.position;
    for (let i = 0; i < rp.count; i++) { const x = rp.getX(i), z = rp.getZ(i), over = Math.max(0, Math.abs(x) - 2); rp.setY(i, roofH(x, Math.max(-3, Math.min(3, z))) - over * 0.5); }
    roof.computeVertexNormals(); out.push(['fabric', uvMul(roof, 3.4, 5)]);
    for (const sx of [-1, 1]) { const v = new THREE.PlaneGeometry(6.2, 0.24, 24, 1).rotateY(sx * PI / 2), vp = v.attributes.position; for (let i = 0; i < vp.count; i++) { const z = vp.getZ(i); vp.setY(i, vp.getY(i) + roofH(2, Math.max(-3, Math.min(3, z))) - 0.18); vp.setX(i, sx * 2.12 + (vp.getY(i) < EA - 0.1 ? Math.sin(z * 7) * 0.012 : 0)); } v.computeVertexNormals(); out.push(['fabric', uvMul(v, 5, 0.2)]); }
    const gable = () => { const s = new THREE.Shape(); s.moveTo(-2.06, EA - 0.2); s.lineTo(2.06, EA - 0.2); s.lineTo(2.06, EA + 0.02); s.lineTo(0, RI + 0.02); s.lineTo(-2.06, EA + 0.02); s.closePath(); return uvMul(new THREE.ShapeGeometry(s), 0.8, 0.8); };
    out.push(['fabric', gable().translate(0, 0, 3.06)]);
    const back = new THREE.Shape(); back.moveTo(-2.04, 0.02); back.lineTo(2.04, 0.02); back.lineTo(2.04, EA + 0.02); back.lineTo(0, RI + 0.02); back.lineTo(-2.04, EA + 0.02); back.closePath();
    out.push(['fabric', uvMul(new THREE.ShapeGeometry(back), 0.8, 0.8).translate(0, 0, -3.05)]);
    const west = new THREE.PlaneGeometry(6.1, EA, 20, 4).rotateY(-PI / 2).translate(-2.05, EA / 2 + 0.01, 0), wp = west.attributes.position;
    for (let i = 0; i < wp.count; i++) { const y = wp.getY(i), z = wp.getZ(i), k = Math.sin(PI * y / EA); wp.setX(i, wp.getX(i) + k * (0.05 * Math.sin(z * 2.2 + 0.6) + 0.025 * Math.sin(z * 5.3))); }
    west.computeVertexNormals(); out.push(['fabric', uvMul(west, 5, 1.7)]);
    out.push(['fabric', uvMul(new THREE.CylinderGeometry(0.085, 0.07, 5.9, 9, 6).rotateX(PI / 2).translate(2.06, EA - 0.12, 0), 1.2, 5)]);          // the east wall, rolled up under the eave
    for (const z of [-2.2, -0.75, 0.75, 2.2]) out.push(P('paint', new THREE.TorusGeometry(0.088, 0.012, 4, 10).rotateY(PI / 2).translate(2.06, EA - 0.12, z), 0x34383b));
    // guy lines and pegs
    for (const [x, z, px, pz] of [[-2, -3, -2.0, -4.2], [2, -3, 2.0, -4.2], [-2, 3, -3.2, 2.8], [2, 3, 3.2, 2.8], [-2, 0, -3.2, 0], [2, 0, 3.2, 0]]) {
      out.push(P('paint', rod([x, EA, z], [px, 0.03, pz], 0.006, 4), 0xbdb9aa)); const dx = px - x, dz = pz - z, l = Math.hypot(dx, dz);
      out.push(P('metal', rod([px + dx / l * 0.06, -0.12, pz + dz / l * 0.06], [px - dx / l * 0.02, 0.05, pz - dz / l * 0.02], 0.008, 5, 0.008, true), 0x6d7378));
    }
    // inside: the table, two chairs, cases along the west wall, a coil of rope
    out.push(...move(table(), -0.35, 0, -1.45));
    out.push(...move(chair(), -0.8, 0, -0.62, PI / 2 + 0.08), ...move(chair(), 0.42, 0, -0.3, PI / 2 - 0.55));
    out.push(...move(caseBox(0.8, 0.38, 0.5, 0x4a4f44), -1.55, 0, 1.2, PI / 2 + 0.05), ...move(caseBox(0.5, 0.3, 0.36, 0x2c3034), -1.58, 0.38, 1.25, PI / 2 - 0.2), ...move(caseBox(0.8, 0.38, 0.5, 0x5d6266, true), -1.5, 0, 0.3, PI / 2 - 0.06));
    out.push(P('paint', new THREE.TorusGeometry(0.2, 0.035, 5, 14).rotateX(PI / 2).translate(1.3, 0.035, -2.3), 0x8f8a78), P('paint', new THREE.TorusGeometry(0.17, 0.035, 5, 14).rotateX(PI / 2).translate(1.31, 0.09, -2.31), 0x8f8a78));
    return out;
  }
  function stretcher() {                                                           // poles along x (0..2.1), bed from z = 0 to 0.52
    const out = [P('paint', box(1.8, 0.012, 0.5, 1.05, 0.02, 0.26), 0x565a4a)];
    for (const z of [0, 0.52]) { out.push(P('metal', rod([0, 0.03, z], [2.1, 0.03, z], 0.017, 6, 0.017, true), STEEL)); for (const x of [0.02, 2.0]) out.push(P('plastic', rod([x, 0.03, z], [x + 0.1, 0.03, z], 0.021, 6, 0.021, true), 0x1c1e20)); }
    for (const x of [0.2, 1.9]) out.push(P('metal', rod([x, 0.03, 0], [x, 0.03, 0.52], 0.01), STEEL));
    for (const x of [0.55, 1.05, 1.55]) out.push(P('paint', box(0.045, 0.004, 0.5, x, 0.033, 0.26), 0x2e3133));
    return out;
  }
  function generator() {                                                           // small open-frame generator, 0.62 x 0.5 x 0.46
    const out = [], f = (a2, b2) => out.push(P('metal', rod(a2, b2, 0.014, 6), 0x3b4044));
    for (const z of [-0.22, 0.22]) { for (const x of [-0.3, 0.3]) f([x, 0.02, z], [x, 0.5, z]); f([-0.3, 0.5, z], [0.3, 0.5, z]); f([-0.3, 0.04, z], [0.3, 0.04, z]); }
    for (const x of [-0.3, 0.3]) { f([x, 0.5, -0.22], [x, 0.5, 0.22]); f([x, 0.04, -0.22], [x, 0.04, 0.22]); }
    out.push(P('plastic', bev(0.5, 0.13, 0.36, 0.03, 0, 0.36, 0), 0x59605a), P('plastic', cyl(0.035, 0.035, 0.02, 0.1, 0.49, 0.05, 10), 0x1b1d1f));
    out.push(P('metal', bev(0.3, 0.26, 0.3, 0.02, -0.08, 0.08, 0), 0x2f3336), P('metal', new THREE.CylinderGeometry(0.11, 0.11, 0.18, 12).rotateZ(PI / 2).translate(0.18, 0.2, 0), 0x565b5e));
    for (let i = 0; i < 5; i++) out.push(P('metal', box(0.26, 0.006, 0.31, -0.08, 0.12 + i * 0.04, 0), 0x45494c));
    out.push(P('metal', new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8).rotateX(PI / 2).translate(-0.24, 0.26, 0), 0x4a3c34), P('plastic', box(0.012, 0.2, 0.26, 0.305, 0.12, 0), 0x25282b), P('plastic', box(0.006, 0.05, 0.05, 0.313, 0.2, -0.06), 0x808588), P('plastic', box(0.006, 0.05, 0.05, 0.313, 0.2, 0.05), 0x808588));
    return out;
  }
  function jerry(col, metalCan = false) {                                          // 20 litre can
    const k = metalCan ? 'metal' : 'plastic';
    return [P(k, bev(0.34, 0.4, 0.17, 0.03), col), P(k, box(0.2, 0.05, 0.1, -0.02, 0.4, 0), col), P(k, box(0.16, 0.022, 0.03, -0.03, 0.455, 0), col), P(k, cyl(0.024, 0.024, 0.06, 0.13, 0.4, 0, 8), 0x1b1d1f)];
  }
  function reel() {                                                                // wooden cable drum standing on its flanges; axis along z
    const out = [];
    for (const z of [-0.17, 0.17]) out.push(['wood', uvMul(new THREE.CylinderGeometry(0.36, 0.36, 0.03, 18).rotateX(PI / 2).translate(0, 0.36, z), 1, 1)]);
    out.push(['wood', new THREE.CylinderGeometry(0.14, 0.14, 0.34, 10).rotateX(PI / 2).translate(0, 0.36, 0)], ['rubber', new THREE.CylinderGeometry(0.25, 0.25, 0.3, 16, 1, true).rotateX(PI / 2).translate(0, 0.36, 0)]);
    for (let i = 0; i < 6; i++) out.push(['rubber', new THREE.TorusGeometry(0.252, 0.012, 4, 16).translate(0, 0.36, -0.125 + i * 0.05)]);
    for (const z of [-0.19, 0.19]) out.push(P('metal', new THREE.CylinderGeometry(0.05, 0.05, 0.012, 8).rotateX(PI / 2).translate(0, 0.36, z), STEEL));
    return out;
  }
  function tripod(hub, spread, r = 0.014) { const out = []; for (let i = 0; i < 3; i++) { const an = i * 2.094 + 0.4; out.push(P('metal', rod([Math.cos(an) * spread, 0, Math.sin(an) * spread], [0, hub, 0], r, 5), 0x3a3f43), P('metal', rod([Math.cos(an) * spread * 0.45, hub * 0.55, Math.sin(an) * spread * 0.45], [0, hub * 0.42, 0], r * 0.6, 4), 0x3a3f43), P('plastic', box(0.05, 0.02, 0.05, Math.cos(an) * spread, 0, Math.sin(an) * spread), 0x17191b)); } return out; }
  function mast() {                                                                // tripod radio mast, whip to 5 m
    const out = tripod(1.5, 0.95, 0.016);
    out.push(P('metal', rod([0, 0.5, 0], [0, 2.2, 0], 0.022, 7), 0x7f868c), P('metal', rod([0, 2.2, 0], [0, 3.3, 0], 0.016, 6), 0x8d949b), P('metal', cyl(0.03, 0.03, 0.06, 0, 2.17, 0, 8), DARK), P('metal', cyl(0.035, 0.035, 0.09, 0, 1.46, 0, 8), DARK));
    out.push(P('plastic', cyl(0.022, 0.026, 0.16, 0, 3.3, 0, 8), 0x17191b), P('plastic', rod([0, 3.46, 0], [0.05, 4.3, 0.02], 0.006, 4, 0.004), 0x1b1d1f), P('plastic', rod([0.05, 4.3, 0.02], [0.16, 5.0, 0.05], 0.004, 4, 0.002), 0x1b1d1f));
    for (let i = 0; i < 4; i++) { const an = i * PI / 2 + 0.3; out.push(P('metal', rod([0, 3.28, 0], [Math.cos(an) * 0.42, 3.12, Math.sin(an) * 0.42], 0.004, 4), 0x8d949b)); }
    out.push(P('plastic', bev(0.2, 0.26, 0.1, 0.012, 0, 1.0, 0.07), 0x33383b), ['rubber', tube([new THREE.Vector3(0.03, 3.3, 0), new THREE.Vector3(0.05, 2.2, 0.03), new THREE.Vector3(0.04, 1.3, 0.06), new THREE.Vector3(0.02, 1.15, 0.1)], 0.007, { radial: 4, segs: 8 })]);
    return out;
  }
  function worklight() {                                                           // tripod flood light, switched off; heads face +x
    const out = tripod(1.0, 0.7);
    out.push(P('metal', rod([0, 0.4, 0], [0, 2.15, 0], 0.016, 6), 0x7f868c), P('metal', rod([0, 2.15, -0.32], [0, 2.15, 0.32], 0.014, 5), 0x3a3f43));
    for (const z of [-0.24, 0.24]) { out.push(P('plastic', xform(bev(0.09, 0.17, 0.24, 0.012), 0.03, 2.17, z, 0, 0, -0.2), 0x2b2f33), P('plastic', xform(box(0.006, 0.13, 0.2), 0.082, 2.2, z, 0, 0, -0.2), 0x767c80)); for (let i = 0; i < 4; i++) out.push(P('plastic', xform(box(0.03, 0.15, 0.008), -0.03, 2.19, z - 0.09 + i * 0.06, 0, 0, -0.2), 0x202326)); }
    out.push(['rubber', tube([new THREE.Vector3(0, 2.1, 0), new THREE.Vector3(0.03, 1.2, 0.02), new THREE.Vector3(0.05, 0.3, 0.1), new THREE.Vector3(0.3, 0.012, 0.3), new THREE.Vector3(0.9, 0.012, 0.2)], 0.008, { radial: 4, segs: 10 })]);
    return out;
  }
  function cone() { return [P('plastic', lathe([[0.135, 0.03], [0.1, 0.19], [0.036, 0.5], [0, 0.5]], 12), 0x8b6248), P('plastic', lathe([[0.104, 0.19], [0.074, 0.33]], 12).scale(1.02, 1, 1.02), 0xb3aea2), P('plastic', bev(0.36, 0.03, 0.36, 0.008), 0x1f2224)]; }
  function waterDrum() { const out = [P('plastic', lathe([[0, 0], [0.27, 0], [0.29, 0.03], [0.29, 0.3], [0.3, 0.31], [0.3, 0.33], [0.29, 0.34], [0.29, 0.6], [0.3, 0.61], [0.3, 0.63], [0.29, 0.64], [0.29, 0.88], [0.27, 0.92], [0, 0.92]], 16), 0x55626a)]; out.push(P('plastic', cyl(0.05, 0.05, 0.03, 0.17, 0.92, 0, 8), 0x1d1f21), P('plastic', cyl(0.03, 0.03, 0.025, -0.17, 0.92, 0.05, 8), 0x1d1f21)); return out; }

  // ======================================================================== makers: the pickup
  function tyre(r, w, seg = 20) { return lathe([[r * 0.62, -w / 2], [r * 0.9, -w / 2], [r, -w * 0.34], [r, w * 0.34], [r * 0.9, w / 2], [r * 0.62, w / 2], [r * 0.62, -w / 2]], seg); }
  function wheel(side) {                                                           // axis along z; "side" is +1 for the wheel whose outer face looks along +z
    const r = 0.4, w = 0.27, out = [['rubber', tyre(r, w).rotateX(PI / 2)]];
    for (let i = 0; i < 18; i++) { const an = i / 18 * PI * 2; for (const s of [-1, 1]) out.push(['rubber', xform(new THREE.BoxGeometry(0.075, 0.022, 0.085), Math.cos(an) * (r + 0.003), Math.sin(an) * (r + 0.003), s * 0.085, 0, 0, an + PI / 2 + s * 0.25)]); }
    out.push(P('metal', new THREE.CylinderGeometry(r * 0.64, r * 0.64, w * 0.72, 16).rotateX(PI / 2), 0x6f7478), P('metal', new THREE.CylinderGeometry(r * 0.3, r * 0.42, 0.05, 12).rotateX(side * PI / 2).translate(0, 0, side * w * 0.38), 0x54595c), P('metal', new THREE.CylinderGeometry(0.05, 0.06, 0.05, 8).rotateX(side * PI / 2).translate(0, 0, side * (w * 0.38 + 0.03)), 0x2b2e31));
    for (let i = 0; i < 6; i++) { const an = i / 6 * PI * 2; out.push(P('metal', box(0.022, 0.022, 0.03, Math.cos(an) * 0.105, Math.sin(an) * 0.105 - 0.011, side * (w * 0.38 + 0.02)), 0x2b2e31)); }
    return out;
  }
  function pickup() {                                                              // double-cab 4x4, 5.3 m long, nose towards +x
    const BODY = 0xb4b6b0, TRIM = 0x1b1e21, out = [];
    const s = new THREE.Shape();
    s.moveTo(-2.6, 0.52); s.lineTo(-2.64, 0.62); s.lineTo(-2.64, 1.1); s.lineTo(1.1, 1.1); s.lineTo(1.26, 1.08); s.lineTo(2.34, 0.99); s.lineTo(2.57, 0.9); s.lineTo(2.62, 0.62); s.lineTo(2.55, 0.47); s.lineTo(2.1, 0.43);
    s.absarc(1.6, 0.42, 0.5, 0, PI, false); s.lineTo(-1.0, 0.43); s.absarc(-1.5, 0.42, 0.5, 0, PI, false); s.closePath();
    out.push(P('plastic', new THREE.ExtrudeGeometry(s, { depth: 1.78, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 9 }).translate(0, 0, -0.89), BODY));
    const c = new THREE.Shape(); c.moveTo(-0.5, 1.1); c.lineTo(-0.46, 1.68); c.lineTo(-0.3, 1.77); c.lineTo(0.55, 1.79); c.lineTo(0.72, 1.76); c.lineTo(1.22, 1.1); c.closePath();
    out.push(P('plastic', new THREE.ExtrudeGeometry(c, { depth: 1.54, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2 }).translate(0, 0, -0.77), BODY));
    // glass: windscreen, back window, two windows a side
    const ws = (t) => [0.72 + 0.5 * t + 0.045, 1.76 - 0.66 * t + 0.034];
    const w0 = ws(0.1), w1 = ws(0.93); out.push(['glass', quad([w0[0], w0[1], -0.71], [w0[0], w0[1], 0.71], [w1[0], w1[1], 0.74], [w1[0], w1[1], -0.74], [1, 1, 0])]);
    out.push(['glass', quad([-0.552, 1.2, -0.64], [-0.552, 1.2, 0.64], [-0.515, 1.64, 0.62], [-0.515, 1.64, -0.62], [-1, 0, 0])]);
    for (const sz of [-1, 1]) { const z = sz * 0.832; out.push(['glass', quad([0.12, 1.15, z], [1.07, 1.15, z], [0.68, 1.69, z], [0.12, 1.69, z], [0, 0, sz])], ['glass', quad([-0.4, 1.15, z], [0.04, 1.15, z], [0.04, 1.69, z], [-0.37, 1.69, z], [0, 0, sz])]); }
    // the dark inside of the wheel arches, axles, exhaust
    out.push(P('paint', box(4.7, 0.52, 1.56, 0, 0.36, 0), 0x101214), P('metal', new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6).rotateX(PI / 2).translate(-1.5, 0.4, 0), 0x2a2d30), P('metal', new THREE.SphereGeometry(0.15, 8, 6).translate(-1.5, 0.4, 0.1), 0x2a2d30), P('metal', rod([-2.7, 0.36, 0.5], [-1.9, 0.38, 0.5], 0.03, 6, 0.03, true), 0x3b3835));
    for (const [x, steer] of [[1.6, 0.22], [-1.5, 0]]) for (const sz of [-1, 1]) { out.push(...move(wheel(sz), x, 0.4, sz * 0.795, steer)); out.push(P('plastic', new THREE.TorusGeometry(0.53, 0.04, 5, 12, PI).translate(x, 0.42, sz * 0.905), TRIM)); out.push(P('plastic', box(0.02, 0.24, 0.26, x - 0.56, 0.22, sz * 0.78), TRIM)); }
    // nose: bumper, grille, lamps, plate; tail: bumper, lamps, tailgate seam, handle
    out.push(P('metal', bev(0.2, 0.2, 1.88, 0.03, 2.68, 0.4, 0), 0x2c3033), P('plastic', box(0.03, 0.22, 1.06, 2.615, 0.64, 0), 0x121416), P('plastic', box(0.1, 0.1, 0.4, 2.7, 0.3, 0), 0x17191b));
    for (let i = 0; i < 4; i++) out.push(P('plastic', box(0.02, 0.016, 1.0, 2.635, 0.665 + i * 0.05, 0), 0x3c4145));
    for (const sz of [-1, 1]) out.push(P('plastic', box(0.035, 0.13, 0.3, 2.6, 0.72, sz * 0.72), 0x9da2a5), P('plastic', box(0.03, 0.06, 0.14, 2.79, 0.47, sz * 0.66), 0x8b8f91), P('plastic', box(0.03, 0.3, 0.09, -2.668, 0.74, sz * 0.86), 0x4f2925), P('metal', rod([2.7, 0.34, sz * 0.5], [2.84, 0.34, sz * 0.5], 0.02, 6, 0.02, true), 0x2b2e31));
    out.push(P('plastic', box(0.012, 0.11, 0.34, 2.785, 0.52, 0), 0xa7a59b), P('metal', bev(0.18, 0.15, 1.86, 0.03, -2.72, 0.42, 0), 0x2c3033), P('plastic', box(0.012, 0.11, 0.34, -2.812, 0.58, 0), 0xa7a59b), P('plastic', box(0.012, 0.035, 0.2, -2.672, 0.98, 0), TRIM));
    for (const sz of [-1, 1]) out.push(P('plastic', box(0.006, 0.5, 0.012, -2.672, 0.6, sz * 0.8), 0x8e908b));
    // doors: seams, handles; mirrors; sill steps; bed rail caps
    for (const sz of [-1, 1]) {
      for (const x of [-0.48, 0.06, 1.1]) out.push(P('plastic', box(0.01, 0.58, 0.008, x, 0.5, sz * 0.921), 0x6c6e6a));
      out.push(P('plastic', box(1.58, 0.008, 0.008, 0.31, 0.5, sz * 0.921), 0x6c6e6a), P('plastic', box(0.13, 0.03, 0.022, -0.36, 0.99, sz * 0.925), TRIM), P('plastic', box(0.13, 0.03, 0.022, 0.18, 0.99, sz * 0.925), TRIM));
      out.push(P('plastic', rod([1.02, 1.16, sz * 0.86], [1.06, 1.24, sz * 1.0], 0.012, 5), TRIM), P('plastic', bev(0.07, 0.15, 0.2, 0.015, 1.07, 1.19, sz * 1.04), TRIM));
      out.push(P('metal', bev(1.7, 0.035, 0.14, 0.012, 0.3, 0.36, sz * 0.96), 0x2c3033), P('plastic', box(2.06, 0.03, 0.07, -1.58, 1.1, sz * 0.9), TRIM));
      for (const x of [-0.25, 0.48]) out.push(P('plastic', box(0.07, 0.07, 0.05, x, 1.83, sz * 0.7), TRIM));
    }
    for (const x of [-0.25, 0.48]) out.push(P('metal', new THREE.BoxGeometry(0.06, 0.03, 1.56).translate(x, 1.915, 0), 0x2b2e31));
    out.push(P('plastic', box(0.07, 0.03, 0.07 * 26, -2.62, 1.1, 0), TRIM), P('plastic', rod([2.0, 1.02, -0.8], [1.86, 1.75, -0.82], 0.005, 4, 0.003), TRIM));
    out.push(P('paint', xform(bev(0.95, 0.14, 0.5, 0.05), 0.1, 1.93, 0.1, 0.05), 0x4a4d45), P('paint', box(0.03, 0.15, 0.52, -0.1, 1.93, 0.1), 0x2a2c2e), P('paint', box(0.03, 0.15, 0.52, 0.3, 1.93, 0.1), 0x2a2c2e));
    // the bed: gear under a tarp tied down with rope
    const lump = (x, z) => { let h = 1.14; for (const [cx, cz, am, sg] of [[-1.0, -0.3, 0.36, 0.38], [-1.7, 0.25, 0.27, 0.42], [-2.25, -0.25, 0.2, 0.33], [-1.35, 0.52, 0.2, 0.3], [-2.2, 0.45, 0.13, 0.25]]) h += am * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * sg * sg)); return h + 0.012 * Math.sin(x * 23) * Math.sin(z * 19); };
    const tarp = new THREE.PlaneGeometry(2.14, 1.96, 16, 14).rotateX(-PI / 2).translate(-1.58, 0, 0), tp = tarp.attributes.position;
    for (let i = 0; i < tp.count; i++) { const x = tp.getX(i), z = tp.getZ(i), edge = Math.abs(z) > 0.9 || x < -2.6 || x > -0.55; tp.setY(i, edge ? 0.93 + 0.03 * Math.sin(x * 9 + z * 7) : lump(x, z)); if (edge) { if (Math.abs(z) > 0.9) tp.setZ(i, Math.sign(z) * 0.945); if (x < -2.6) tp.setX(i, -2.675); } }
    tarp.computeVertexNormals(); out.push(P('paint', tarp, 0x50564a));
    for (const x of [-2.3, -1.6, -0.95]) { const pts = []; for (let i = 0; i <= 10; i++) { const z = -0.95 + i * 0.19; pts.push(new THREE.Vector3(x, Math.abs(z) > 0.9 ? 0.86 : lump(x, z) + 0.008, z)); } out.push(P('paint', tube(pts, 0.008, { radial: 4, segs: 20 }), 0xb0ab99)); }
    return out;
  }

  // ======================================================================== makers: what the flood carried
  function trunk(len, r0, Rn) {                                                    // a tree trunk lying along x from 0 to len, root end at 0
    const g = new THREE.CylinderGeometry(r0 * 0.55, r0, len, 8, 6).rotateZ(-PI / 2).translate(len / 2, 0, 0), p = g.attributes.position, b1 = Rn.gauss() * 0.3, b2 = Rn.gauss() * 0.12;
    for (let i = 0; i < p.count; i++) { const t = p.getX(i) / len; p.setZ(i, p.getZ(i) + b1 * Math.sin(PI * t) * len * 0.12); p.setY(i, p.getY(i) * (1 - 0.12 * Math.sin(t * 9)) + b2 * Math.sin(PI * t) * len * 0.05 + r0 * 0.82 * (1 - t * 0.4)); }
    g.computeVertexNormals(); const out = [['wood', uvMul(g, len / 2, 1.5, true)]];
    for (let i = 0; i < 5; i++) { const an = i * 1.3 + Rn(), l = r0 * (1.6 + Rn() * 1.6); out.push(['wood', uvMul(rod([0.1, r0 * 0.8, 0], [-l * 0.45, r0 * 0.8 + Math.sin(an) * l, Math.cos(an) * l], r0 * 0.3, 5, r0 * 0.08, true), 1, 1)]); }
    const nb = 2 + Math.floor(Rn() * 3);
    for (let i = 0; i < nb; i++) { const t = 0.3 + Rn() * 0.6, an = Rn() * PI - PI / 2 + (Rn() < 0.5 ? 0 : PI) * 0, l = 0.4 + Rn() * 1.4, rr = r0 * (0.2 + Rn() * 0.2), x = t * len, y0 = r0 * 0.8 * (1 - t * 0.4), z0 = b1 * Math.sin(PI * t) * len * 0.12; out.push(['wood', uvMul(rod([x, y0, z0], [x + l * 0.5, y0 + Math.abs(Math.cos(an)) * l * 0.7, z0 + Math.sin(an) * l], rr, 5, rr * 0.4, true), 1, 1)]); }
    return out;
  }
  function branch(len, r, Rn) {                                                    // a broken branch along x, lying on the ground
    const pts = [], n = 4; for (let i = 0; i <= n; i++) pts.push(new THREE.Vector3(i / n * len, r + (i > 0 && i < n ? Rn() * len * 0.04 : 0), Rn.gauss() * len * 0.07));
    const out = [['wood', uvMul(tube(pts, r, { radial: 5, segs: 8 }), len / 1.5, 1)]], k = 1 + Math.floor(Rn() * 2);
    for (let i = 0; i < k; i++) { const at = pts[1 + Math.floor(Rn() * 3)], l = len * (0.25 + Rn() * 0.3), an = Rn.sign() * (0.5 + Rn() * 0.6); out.push(['wood', uvMul(rod([at.x, at.y, at.z], [at.x + Math.cos(an) * l, at.y + l * (0.1 + Rn() * 0.35), at.z + Math.sin(an) * l], r * 0.6, 4, r * 0.25), 1, 1)]); }
    return out;
  }
  const plank = (len, Rn) => [['wood', uvMul(new THREE.BoxGeometry(len, 0.03 + Rn() * 0.02, 0.1 + Rn() * 0.1).translate(len / 2, 0.02, 0), len / 1.6, 0.3)]];
  function sheet(len, Rn, curl = Rn.gauss() * 0.5) {                               // corrugated roofing sheet, bent; lies along x
    const g = new THREE.PlaneGeometry(0.86, len, 1, 7).rotateX(-PI / 2).rotateY(PI / 2).translate(len / 2, 0, 0), p = g.attributes.position, kink = 0.25 + Rn() * 0.5, kb = Rn.gauss() * 0.5;
    for (let i = 0; i < p.count; i++) { const t = p.getX(i) / len, d = t - kink; p.setY(i, 0.03 + curl * len * 0.25 * t * t + (d > 0 ? d * len * kb : 0) + Math.abs(p.getZ(i)) * Rn.gauss() * 0.02); }
    g.computeVertexNormals(); return [['cgi', uvMul(g, 0.86 / 0.912, len / 2.4)]];
  }
  function oilDrum(col) {
    const out = [P('metal', cyl(0.285, 0.285, 0.88, 0, 0, 0, 16), col)];
    for (const y of [0.3, 0.58]) out.push(P('metal', new THREE.TorusGeometry(0.288, 0.012, 4, 16).rotateX(PI / 2).translate(0, y, 0), col));
    for (const y of [0, 0.865]) out.push(P('metal', cyl(0.295, 0.295, 0.015, 0, y, 0, 16), new THREE.Color(col).multiplyScalar(0.8)));
    out.push(P('metal', cyl(0.03, 0.03, 0.02, 0.17, 0.88, 0, 6), 0x2b2e31)); return out;
  }
  const bucket = (col) => [P('plastic', lathe([[0, 0], [0.11, 0], [0.15, 0.27], [0.158, 0.275], [0.14, 0.268], [0.102, 0.014], [0, 0.014]], 12), col)];
  const pot = (s = 1) => [P('metal', lathe([[0, 0], [0.15, 0], [0.17, 0.025], [0.17, 0.16], [0.185, 0.166], [0.16, 0.16], [0.158, 0.03], [0, 0.022]], 14).scale(s, s, s), 0x85888a), P('metal', box(0.05 * s, 0.012 * s, 0.4 * s, 0, 0.14 * s, 0), 0x707375)];
  const looseTyre = (r = 0.31) => [['rubber', tyre(r, r * 0.6, 16).translate(0, r * 0.3, 0)]];
  function plasticChair(col) {
    const out = [P('plastic', bev(0.44, 0.03, 0.42, 0.012, 0, 0.42, 0), col), P('plastic', xform(bev(0.03, 0.4, 0.4, 0.012), -0.22, 0.44, 0, 0, 0, 0.2), col)];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(P('plastic', rod([sx * 0.23, 0, sz * 0.22], [sx * 0.18, 0.42, sz * 0.18], 0.016, 4, 0.024), col));
    for (const sz of [-1, 1]) out.push(P('plastic', box(0.36, 0.022, 0.035, -0.02, 0.62, sz * 0.21), col), P('plastic', rod([0.15, 0.44, sz * 0.21], [0.15, 0.63, sz * 0.21], 0.014, 4), col));
    return out;
  }
  function mattress(col) {
    const g = new THREE.BoxGeometry(1.9, 0.15, 0.9, 10, 1, 3).translate(0, 0.075, 0), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, p.getY(i) + Math.max(0, 0.34 - Math.abs(x - 0.35) * 0.55) + 0.02 * Math.sin(x * 5 + z * 3)); }
    g.computeVertexNormals(); const out = [P('paint', g, col)];
    for (const z of [-0.3, 0, 0.3]) { const pts = []; for (let i = 0; i <= 10; i++) { const x = -0.95 + i * 0.19; pts.push(new THREE.Vector3(x, 0.153 + Math.max(0, 0.34 - Math.abs(x - 0.35) * 0.55) + 0.02 * Math.sin(x * 5 + z * 3), z)); } out.push(P('paint', tube(pts, 0.012, { radial: 3, segs: 10 }), new THREE.Color(col).multiplyScalar(0.7))); }
    return out;
  }
  const sandal = (col) => [P('plastic', bev(0.25, 0.022, 0.095, 0.008), col), P('plastic', new THREE.TorusGeometry(0.042, 0.008, 4, 7, PI).rotateY(PI / 2).translate(0.05, 0.018, 0), col)];
  const shoe = (col) => [P('plastic', bev(0.27, 0.025, 0.1, 0.01), 0x25272a), P('plastic', new THREE.SphereGeometry(1, 8, 5, 0, PI * 2, 0, PI / 2).scale(0.125, 0.085, 0.048).translate(0.005, 0.022, 0), col)];
  function bag(col) { const dk = new THREE.Color(col).multiplyScalar(0.7); return [P('paint', bev(0.42, 0.14, 0.31, 0.045), col), P('paint', bev(0.2, 0.05, 0.22, 0.02, -0.06, 0.13, 0), dk), P('paint', box(0.34, 0.012, 0.04, 0.0, -0.002, 0.09), dk), P('paint', xform(box(0.3, 0.012, 0.04), 0.24, 0, -0.12, 0.5), dk), P('paint', new THREE.TorusGeometry(0.035, 0.008, 4, 7, PI).translate(0.21, 0.07, 0).rotateZ(-0.0), dk)]; }
  function bicycle() {                                                             // upright in the x-y plane, wheel radius 0.33
    const out = [], F = 0x4b5753, f = (a2, b2, r = 0.014) => out.push(P('metal', rod(a2, b2, r, 5), F));
    for (const [x, st] of [[-0.52, 0], [0.54, 0.5]]) { const w = [['rubber', new THREE.TorusGeometry(0.33, 0.02, 5, 20)], P('metal', new THREE.TorusGeometry(0.305, 0.01, 4, 20), 0x7f8589), P('metal', new THREE.CylinderGeometry(0.02, 0.02, 0.08, 6).rotateX(PI / 2), 0x55595c)]; for (let i = 0; i < 7; i++) { const an = i / 7 * PI; w.push(P('metal', rod([Math.cos(an) * 0.3, Math.sin(an) * 0.3, 0], [-Math.cos(an) * 0.3, -Math.sin(an) * 0.3, 0], 0.003, 3), 0x7f8589)); } out.push(...move(w, x, 0.33, 0, st)); }
    f([-0.52, 0.33, 0], [-0.1, 0.3, 0]); f([-0.52, 0.33, 0], [-0.18, 0.82, 0], 0.01); f([-0.1, 0.3, 0], [-0.2, 0.9, 0]); f([-0.1, 0.3, 0], [0.38, 0.8, 0], 0.017); f([-0.18, 0.82, 0], [0.38, 0.84, 0]); f([0.36, 0.9, 0], [0.54, 0.33, 0]); f([0.36, 0.9, 0], [0.34, 1.0, 0]);
    out.push(P('metal', rod([0.3, 1.0, -0.26], [0.38, 1.0, 0.24], 0.011, 5), 0x7f8589), P('paint', bev(0.24, 0.045, 0.13, 0.015, -0.22, 0.9, 0), 0x1c1e20), P('metal', rod([-0.1, 0.3, -0.07], [-0.1, 0.3, 0.07], 0.012, 5), 0x55595c), P('metal', rod([-0.1, 0.3, 0.07], [0.02, 0.17, 0.07], 0.008, 4), 0x55595c), P('metal', rod([-0.1, 0.3, -0.07], [-0.2, 0.44, -0.07], 0.008, 4), 0x55595c), P('paint', box(0.34, 0.012, 0.13, -0.56, 0.7, 0), 0x3a3f42), P('metal', new THREE.CylinderGeometry(0.09, 0.09, 0.006, 12).rotateX(PI / 2).translate(-0.1, 0.3, 0.05), 0x55595c));
    return out;
  }
  const mound = (x, y, sx, sz, h, ry, Rn) => G.mud.push(xform(rock(1, Rn, { flat: 1, detail: 1 }), x, -h * 0.35, -y, ry, 0, 0, [sx, h, sz]));
  const boulder = (x, y, size, Rn, sink = 0.3) => { const s = size / 2; boulders.push(matrix(x, s * (0.62 - sink), -y, Rn() * 6.3, Rn.gauss() * 0.5, Rn.gauss() * 0.5, [s * (0.85 + Rn() * 0.4), s * (0.6 + Rn() * 0.35), s * (0.8 + Rn() * 0.4)])); boulderCol.push(new THREE.Color().setHSL(0.09, 0.05 + Rn() * 0.05, 0.62 + Rn() * 0.3).getHex()); };
  const stone = (x, h, y, sx, sy, sz, ry, Rn, tilt = 0.12) => { stones.push(matrix(x, h, -y, ry, Rn.gauss() * tilt, Rn.gauss() * tilt, [sx, sy, sz])); stoneCol.push(new THREE.Color().setHSL(0.09, 0.04 + Rn() * 0.05, 0.6 + Rn() * 0.32).getHex()); };

  // ======================================================================== 1. staging
  const TX = 31.5, TY = 19.5;
  place(tent(), TX, TY, 0, { dirt: [0.3, 0.55] }); KEEP.push([TX, TY, 4.6]);
  const stack = [[1.2, 0.46, 0.62, 0x2c3034, 27.62, 16.6, 0.0, 0, false], [1.2, 0.46, 0.62, 0x4a4f44, 27.65, 16.6, 0.04, 0.462, false], [0.8, 0.4, 0.5, 0x5d6266, 28.82, 16.25, -0.2, 0, false], [0.5, 0.3, 0.36, 0x2c3034, 28.8, 16.27, 0.3, 0.402, false],
    [0.8, 0.4, 0.5, 0x877f6e, 27.5, 15.4, 0.25, 0, true], [0.5, 0.3, 0.36, 0x4a4f44, 28.55, 15.3, -0.5, 0, false], [1.4, 0.3, 0.4, 0x2c3034, 28.75, 17.35, 1.5, 0, false], [0.5, 0.3, 0.36, 0x5d6266, 27.7, 16.62, 0.5, 0.924, true]];
  for (const [w, h, d, col, x, y, ry, at, open] of stack) place(caseBox(w, h, d, col, open), x, y, ry, { h: at, dirt: at ? null : [0.22, 0.6] });
  KEEP.push([28.1, 16.3, 1.9]);
  place(stretcher(), 26.74, 15.55, PI / 2, { rx: -1.12, h: 0.0 });
  place(waterDrum(), 28.92, 18.7, 0.7, { dirt: [0.3, 0.5] }); KEEP.push([28.92, 18.7, 0.5]);
  place(worklight(), 35.3, 18.0, 0.35, { dirt: [0.2, 0.5] }); place(generator(), 37.2, 22.4, 0.5, { dirt: [0.2, 0.5] }); place(jerry(0x4b5046, true), 37.95, 21.75, 1.1, { dirt: [0.2, 0.5] });
  place(reel(), 35.4, 20.9, 0.9); place(mast(), 34.9, 23.6, 0.2, { dirt: [0.2, 0.5] }); KEEP.push([36.2, 21.4, 3.0], [35.3, 18, 1.0]);
  const gnd = (pts, r = 0.011) => tube(pts.map((p) => new THREE.Vector3(p[0], p[2] ?? r, -p[1])), r, { radial: 4, segs: pts.length * 5 });
  G.rubber.push(gnd([[37.0, 22.1], [36.5, 21.3], [35.9, 21.2], [35.55, 21.0, 0.12]]), gnd([[35.3, 20.8, 0.1], [34.8, 20.5], [34.0, 20.75], [33.1, 20.5], [32.3, 20.9], [31.95, 21.1], [31.87, 21.22, 0.3], [31.87, 21.23, 0.7]]), gnd([[34.9, 23.5, 1.1], [34.7, 23.3, 0.3], [34.3, 22.9], [33.6, 22.6], [32.6, 22.2], [32.0, 21.4], [31.9, 21.27, 0.4], [31.9, 21.25, 0.72]], 0.008));
  const cones = [[28.0, 10.0, 0, 0], [29.5, 10.18, 0, 0], [31.05, 10.08, 0, 0], [32.5, 10.3, 0.4, 1.38]];
  for (const [x, y, ry, rz] of cones) place(cone(), x, y, ry + R() * 3, rz ? { rz, h: 0.13, dirt: [0.5, 0.6] } : { dirt: [0.34, 0.6] });
  KEEP.push([30.2, 10.1, 2.8]);

  // ======================================================================== 2. drone pad
  G.concrete.push(worldUV(box(2.0, 0.012, 2.0, PAD[0], 0, -PAD[1], 0.12), 0.5)); G.decal.push(dq(2.0, 2.0, CELL.pad, PAD[0], 0.0135, -PAD[1], 0.12));
  for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const c0 = Math.cos(0.12), s0 = Math.sin(0.12), lx = dx * 0.94, ly = dy * 0.94, x = PAD[0] + lx * c0 - ly * s0, y = PAD[1] + lx * s0 + ly * c0; G.metal.push(tint(rod([x, -0.1, -y], [x + dx * 0.02, 0.04, -y - dy * 0.02], 0.009, 5, 0.009, true), 0x7d8286), tint(cyl(0.022, 0.022, 0.006, x + dx * 0.02, 0.036, -y - dy * 0.02, 8), 0x7d8286)); }
  { const dc = caseBox(0.95, 0.42, 0.62, 0x33383c, true); dc.push(P('plastic', box(0.5, 0.05, 0.34, 0.1, 0.22, 0), 0x0f1011)); place(dc, 22.5, 18.5, -0.5, { dirt: [0.22, 0.6] }); place(caseBox(0.5, 0.3, 0.36, 0x33383c), 22.2, 19.45, 0.3, { dirt: [0.2, 0.6] }); KEEP.push([22.4, 18.9, 1.1]); }

  // ======================================================================== 3. the pickup
  place(pickup(), 14, 10.3, 0.1, { dirt: [1.12, 0.92] }); KEEP.push([14, 10.3, 3.3]);

  // ======================================================================== 4. the road: kerbs, culvert, power line
  { const Rk = rng('site:kerb');
    for (let x = -34; x < 150; x += 1.02) {
      const [ry0, ang] = roadAt(x);
      for (const side of [1, -1]) {
        if (side === 1 && ((x > -2 && x < 47) || (x > 60 && x < 68))) continue;
        const run = Math.sin(x * 0.11 + side * 1.7) + Math.sin(x * 0.31 + side) * 0.6; if (run < (side === 1 ? -0.1 : 0.45) || Rk() < 0.12) continue;
        const loose = Rk() < 0.22, off = 3.42 + (loose ? Rk() * 0.9 * 1 : Rk() * 0.05), g = box(0.94, 0.17, 0.2, 0, loose ? -0.03 : -0.02, 0);
        G.concrete.push(worldUV(xform(g, x, 0, -(ry0 + side * off), ang + (loose ? Rk.gauss() * 0.6 : Rk.gauss() * 0.02), loose ? Rk.gauss() * 0.3 : 0, loose ? Rk.gauss() * 0.25 : 0), 0.5));
      }
    }
    for (const [cx, side] of [[50, 1], [50, -1], [104, 1]]) {                       // culvert headwalls: wall, coping, wing walls, pipe mouth, silt
      const [ry0, ang] = roadAt(cx), y = ry0 + side * 4.05, ry = ang + (side === 1 ? 0 : PI), kit = [];
      kit.push(['concrete', box(2.5, 0.78, 0.26, 0, -0.04, 0)], ['concrete', box(2.74, 0.1, 0.36, 0, 0.74, 0)], ['concrete', box(1.5, 0.6, 0.22, -1.78, -0.04, -0.42, 0.62)], ['concrete', box(1.5, 0.6, 0.22, 1.78, -0.04, -0.42, -0.62)], ['concrete', new THREE.TorusGeometry(0.33, 0.055, 6, 16).translate(0, 0.36, -0.13)]);
      kit.push(P('paint', new THREE.CircleGeometry(0.33, 16).rotateY(PI).translate(0, 0.36, -0.135), 0x08090a));
      place(kit, cx, y, ry); KEEP.push([cx, y + side * 0.5, 1.9]);
      const j = G.concrete.length; for (let i = j - 5; i < j; i++) G.concrete[i] = worldUV(G.concrete[i], 0.5);
      mound(cx + 0.2, y + side * 0.75, 1.3, 0.7, 0.42, ang, Rk); mound(cx - 0.9, y + side * 0.9, 0.8, 0.5, 0.3, ang + 0.4, Rk);
    }
  }
  const poles = [];
  { const Rp = rng('site:poles'), XS = [-30, 1, 34, 58.5, 90, 120, 150], LEAN = { 4: [0.16, FLOW], 5: [0.3, FLOW + 0.5] };
    XS.forEach((x, i) => {
      const [ry0, ang] = roadAt(x), y = ry0 + (i === 2 ? 4.0 : 4.4), kit = [], lean = LEAN[i] || [Rp.gauss() * 0.012, Rp() * 6];
      const shaft = new THREE.CylinderGeometry(0.1, 0.165, 8.5, 9, 3).translate(0, 3.75, 0); kit.push(['wood', uvMul(shaft, 4, 1, true)]);
      kit.push(['wood', uvMul(new THREE.BoxGeometry(0.1, 0.12, 1.9).translate(0.11, 7.5, 0), 1, 0.3)], P('metal', rod([0.11, 6.85, 0], [0.11, 7.45, 0.6], 0.012, 4), 0x5a5f62), P('metal', rod([0.11, 6.85, 0], [0.11, 7.45, -0.6], 0.012, 4), 0x5a5f62), P('metal', cyl(0.105, 0.105, 0.04, 0, 7.98, 0, 9), 0x5a5f62), P('metal', box(0.14, 0.2, 0.012, 0, 1.6, 0.158), 0x7b7f80));
      const tops = [[0.11, 7.56, -0.82], [0, 8.02, 0], [0.11, 7.56, 0.82]];
      for (const tp of tops) kit.push(P('metal', rod(tp, [tp[0], tp[1] + 0.1, tp[2]], 0.01, 4), 0x5a5f62), P('paint', lathe([[0.022, 0], [0.05, 0.02], [0.055, 0.05], [0.03, 0.06], [0.042, 0.085], [0.045, 0.11], [0.02, 0.13], [0, 0.13]], 8).translate(tp[0], tp[1] + 0.06, tp[2]), 0x6f6b62));
      if (i === 2) {                                                               // the transformer pole: tank, fins, bushings, bracket, fuse cut-outs
        kit.push(P('metal', box(0.5, 0.06, 0.08, 0.0, 5.3, -0.2), 0x5a5f62), P('metal', box(0.5, 0.06, 0.08, 0.0, 5.3, -0.5), 0x5a5f62), P('metal', rod([0, 4.7, -0.1], [0, 5.3, -0.55], 0.015, 4), 0x5a5f62));
        kit.push(P('metal', cyl(0.27, 0.27, 0.78, 0, 5.36, -0.42, 14), 0x676c6f), P('metal', cyl(0.285, 0.285, 0.04, 0, 6.12, -0.42, 14), 0x5a5f62));
        for (let k = 0; k < 9; k++) { const an = PI * 0.25 + k / 8 * PI * 1.5; kit.push(P('metal', xform(new THREE.BoxGeometry(0.07, 0.6, 0.012), Math.sin(an) * 0.3, 5.74, -0.42 - Math.cos(an) * 0.3, an + PI / 2), 0x5d6265)); }
        for (const dx of [-0.13, 0, 0.13]) { kit.push(P('paint', lathe([[0.03, 0], [0.045, 0.03], [0.03, 0.05], [0.045, 0.08], [0.03, 0.1], [0.04, 0.13], [0.015, 0.16], [0, 0.16]], 8).translate(dx, 6.16, -0.42), 0x6f6b62)); kit.push(['rubber', tube([new THREE.Vector3(dx, 6.32, -0.42), new THREE.Vector3(dx * 1.4 + 0.1, 6.9, -0.5 + dx * 2), new THREE.Vector3(0.11, 7.62, dx * 6.3)], 0.006, { radial: 3, segs: 6 })]); }
        kit.push(P('metal', box(0.2, 0.3, 0.12, 0, 3.4, -0.2), 0x4c5154), P('metal', rod([0.02, 3.7, -0.2], [0.02, 5.36, -0.25], 0.012, 4), 0x2b2e31));
      }
      G.mud.push(xform(new THREE.CylinderGeometry(0.153, 0.172, FLOOD_H + 0.3, 9, 1, true).translate(0, FLOOD_H / 2 - 0.15, 0), x, 0, -y, ang, Math.sin(lean[1] - ang) * lean[0] * -1, -Math.cos(lean[1] - ang) * lean[0]));
      // lean: tip the pole towards the compass direction lean[1] by lean[0] radians
      const M = matrix(x, 0, -y, ang, -Math.sin(lean[1] - ang) * lean[0], -Math.cos(lean[1] - ang) * lean[0]);
      for (const [key, g] of kit) G[key].push(g.applyMatrix4(M));
      poles.push({ x, y, M, tops: tops.map((tp) => new THREE.Vector3(tp[0], tp[1] + 0.19, tp[2]).applyMatrix4(M)), at: (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyMatrix4(M) });
      KEEP.push([x, y, 0.45]);
    });
    const W = 0.014;
    for (let i = 0; i < poles.length - 1; i++) for (let k = 0; k < 3; k++) {
      const A = poles[i].tops[k], B = poles[i + 1].tops[k];
      if (i === 4 && k === 2) {                                                    // the snapped conductor: one end trails on the ground, the other hangs at its pole
        const gx = poles[4].x, gy = poles[4].y;
        G.rubber.push(tube([A, new THREE.Vector3(A.x + 0.5, A.y - 1.2, A.z + 0.1), new THREE.Vector3(A.x + 1.3, 3.2, A.z + 0.3), new THREE.Vector3(gx + 1.2, 0.9, -(gy - 1.7)), new THREE.Vector3(gx + 2.0, 0.03, -(gy - 1.5)), new THREE.Vector3(gx + 4.2, 0.02, -(gy - 0.6)), new THREE.Vector3(gx + 6.0, 0.02, -(gy - 1.3)), new THREE.Vector3(gx + 8.4, 0.02, -(gy - 0.5)), new THREE.Vector3(gx + 9.6, 0.02, -(gy + 0.5)), new THREE.Vector3(gx + 9.0, 0.02, -(gy + 1.2)), new THREE.Vector3(gx + 8.3, 0.02, -(gy + 0.7))], W, { radial: 4, segs: 44 }));
        G.rubber.push(tube([B, new THREE.Vector3(B.x - 0.3, B.y - 1.5, B.z), new THREE.Vector3(B.x - 0.45, B.y - 3.6, B.z + 0.1), new THREE.Vector3(B.x - 0.35, B.y - 5.2, B.z + 0.25)], W, { radial: 4, segs: 12 }));
        continue;
      }
      G.rubber.push(tube(sagLine(A, B, 0.75 + Rp() * 0.5 + (i === 4 || i === 5 ? 0.9 : 0), 12), W, { radial: 4, segs: 16 }));
    }
    for (const [i, dir] of [[0, -1], [6, 1]]) { const p = poles[i]; G.metal.push(tint(rod([p.x, 7.2, -p.y], [p.x + dir * 4.2, -0.05, -(p.y + 0.3)], 0.008, 4), 0x6d7378), tint(rod([p.x + dir * 4.0, 0.3, -(p.y + 0.3)], [p.x + dir * 4.25, -0.1, -(p.y + 0.3)], 0.02, 5), 0x6d7378)); }
    // service drops from the transformer pole to building A and to block B's south-west roof corner
    const sp = poles[2], s0 = sp.at(0, 6.6, -0.12);
    G.metal.push(tint(box(0.06, 0.1, 0.16, 0, 0, 0).applyMatrix4(matrix(sp.x, 6.55, -sp.y, 0)), 0x5a5f62), tint(rod([30.4, 6.25, -39.93], [30.4, 6.75, -39.93], 0.016, 5), 0x5a5f62), tint(rod([44.0, 3.9, -30.0], [43.94, 4.5, -29.94], 0.016, 5), 0x5a5f62));
    G.rubber.push(tube(sagLine(s0, new THREE.Vector3(30.4, 6.7, -39.93), 1.0, 14), 0.011, { radial: 4, segs: 18 }), tube(sagLine(s0, new THREE.Vector3(43.94, 4.46, -29.94), 0.8, 12), 0.011, { radial: 4, segs: 16 }));
  }

  // ======================================================================== 5. flood debris
  const STREAMS = [[96, 70, 6, 0.75], [118, 56, 5, 0.4], [124, 30, 6, 0.6], [70, 88, 6, 0.55], [30, 40, 5, 0.3]];
  const dens = (x, y) => { let d = 0.1; for (const [sx, sy, w, am] of STREAMS) { const cr = (x - sx) * FY - (y - sy) * FX; d += am * Math.exp(-cr * cr / (2 * w * w)); } return Math.min(1, d); };
  function scatter(name, n, r, make, { tall = true, area = [-8, 9, 126, 88], density = dens } = {}) {
    const Rn = rng('site:' + name); let done = 0, tries = 0; n = Math.round(n * Q);
    while (done < n && tries++ < n * 60) { const x = lerp(area[0], area[2], Rn()), y = lerp(area[1], area[3], Rn()); if (Rn() > density(x, y) || blocked(x, y, r, tall)) continue; make(x, y, Rn); done++; }
  }
  const WASH = [0.25, 0.5], PLAST = [0x8f8152, 0x5a676e, 0xaaa79b, 0x65705f, 0x7d6a5c], CLOTH = [0x59636c, 0x6a584f, 0x555e4e, 0x494e59, 0x7b7466];
  const col = (list, Rn, k = 0.3) => silted(Rn.pick(list), k * (0.5 + Rn()));
  const along = (Rn, sd = 0.45) => FLOW + Rn.gauss() * sd + (Rn() < 0.5 ? PI : 0);

  // boulders brought down by the slide: thickest on the tongue in the north-east, thinning out along the flow
  { const Rb = rng('site:boulders'); let n = 0, tries = 0;
    while (n < Math.round(150 * Q) && tries++ < 6000) {
      const onTongue = Rb() < 0.55, t = Rb(), x = onTongue ? 86 + t * 44 + Rb.gauss() * (4 + t * 9) : lerp(-10, 128, Rb()), y = onTongue ? 60 + t * 40 + Rb.gauss() * (4 + t * 9) : lerp(10, 92, Rb());
      if (x < -20 || x > 140 || y < 9 || y > 108) continue; if (!onTongue && Rb() > dens(x, y) * 0.9) continue;
      const size = 0.2 + Math.pow(Rb(), 2.6) * (onTongue ? 1.4 : 0.9); if (blocked(x, y, size * 0.6, true)) continue;
      boulder(x, y, size, Rb, 0.15 + Rb() * 0.3); n++;
      if (size > 0.8 && Rb() < 0.8) mound(x + 0.3 * size, y + 0.2 * size, size * 1.0, size * 0.7, size * 0.3, FLOW, Rb);        // silt banked against the upstream face
      if (size > 0.7) for (let k = 0; k < 3; k++) { const a2 = Rb() * 6.3, d = size * (0.5 + Rb() * 0.5), sx = x + Math.cos(a2) * d, sy = y + Math.sin(a2) * d; if (!blocked(sx, sy, 0.2, true)) stone(sx, 0.03, sy, 0.07 + Rb() * 0.08, 0.05 + Rb() * 0.05, 0.07 + Rb() * 0.08, Rb() * 6, Rb, 0.5); }
    }
  }
  // the yard wall along the west side of block B's yard: dry stone, breached where the water went through
  { const Rw = rng('site:wall'), WX = 40, runs = [[22, 23.7, 0.72], [24.1, 25.1, 0.4], [27.5, 29.7, 0.72], [29.7, 30.6, 0.3]];
    for (const [y0, y1, top] of runs) {
      const courses = Math.round(top / 0.17);
      for (let c2 = 0; c2 < courses; c2++) for (const side of [-1, 1]) {
        let y = y0 + (c2 % 2) * 0.14 + Rw() * 0.1; const ragged = c2 / courses * 0.5 * (Rw() < 0.5 ? 1 : 0.3);
        while (y < y1 - ragged) { const l = 0.26 + Rw() * 0.2; stone(WX + side * 0.13 + Rw.gauss() * 0.015, 0.085 + c2 * 0.17, y + l / 2, 0.15 + Rw() * 0.03, 0.105, l * 0.56, Rw.gauss() * 0.08, Rw, 0.05); y += l + 0.012; }
      }
      for (let y = y0 + 0.2; y < y1 - 0.2 && top > 0.6; y += 0.42 + Rw() * 0.2) stone(WX + Rw.gauss() * 0.03, top + 0.05, y, 0.2, 0.07, 0.17, Rw.gauss() * 0.2, Rw, 0.1);   // flat cope stones
    }
    for (let i = 0; i < 46; i++) { const gap = Rw() < 0.7, y = gap ? 25.0 + Rw() * 2.6 : 22 + Rw() * 8.4, x = WX - Math.abs(Rw.gauss()) * (gap ? 1.6 : 0.7) - 0.2 + (gap ? 0.3 : 0); if (blocked(x, y, 0.2, false)) continue; stone(x, 0.05 + Rw() * 0.04, y, 0.12 + Rw() * 0.07, 0.07 + Rw() * 0.04, 0.1 + Rw() * 0.07, Rw() * 6, Rw, 0.45); }
    mound(40.7, 22.9, 0.9, 1.5, 0.4, 0, Rw); mound(40.75, 28.6, 0.8, 1.6, 0.42, 0, Rw); mound(39.4, 26.2, 1.6, 1.3, 0.14, 0.3, Rw);
    KEEP.push([40, 22.8, 0.9], [40, 24.6, 0.6], [40, 28.2, 0.9], [40, 29.6, 0.9]);
  }

  // jams: floating debris stacked against the upstream (north-east) faces
  const rubbish = (x, y, Rn, ry = Rn() * 6.3) => {
    const k = Rn();
    if (k < 0.2) place(jerry(col(PLAST, Rn)), x, y, ry, { rx: Rn() < 0.6 ? PI / 2 : 0, h: Rn() < 0.6 ? 0.08 : 0, dirt: WASH });
    else if (k < 0.36) place(bucket(col(PLAST, Rn)), x, y, ry, { rz: Rn() < 0.7 ? 1.5 : 0, h: 0.1, dirt: WASH });
    else if (k < 0.52) place(Rn() < 0.5 ? sandal(col(PLAST, Rn)) : shoe(col(CLOTH, Rn)), x, y, ry, { rz: Rn.gauss() * 0.3, h: 0.012, dirt: WASH });
    else if (k < 0.64) place(bag(col(CLOTH, Rn)), x, y, ry, { rz: Rn.gauss() * 0.15, dirt: WASH });
    else if (k < 0.76) place(pot(0.8 + Rn() * 0.5), x, y, ry, { rz: Rn() < 0.5 ? 1.9 : Rn.gauss() * 0.2, h: 0.1, dirt: WASH });
    else if (k < 0.88) place(looseTyre(0.27 + Rn() * 0.08), x, y, ry, { rx: PI / 2 + Rn.gauss() * 0.12, h: 0.0 });
    else place(plasticChair(col(PLAST, Rn, 0.2)), x, y, ry, { rz: Rn() < 0.5 ? PI / 2 + 0.2 : 2.6, h: 0.22, dirt: WASH });
  };
  function jam(cx, cy, ang, len, depth, n, name) {                                 // ang: the line of the face; debris piles to its left (the upstream side)
    const Rn = rng('site:jam:' + name), ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
    for (let i = 0; i < Math.round(n * Q); i++) {
      const t = (Rn() - 0.5) * len, off = 0.15 + Rn() * Rn() * depth, x = cx + ux * t + nx * off, y = cy + uy * t + ny * off, k = Rn(), ry = ang + Rn.gauss() * 0.3 + (Rn() < 0.5 ? PI : 0), pitch = Rn() * 0.28 * (1 - off / (depth + 0.2));
      if (blocked(x, y, 0.2, true)) continue;
      if (k < 0.42) place(plank(1.2 + Rn() * 2.4, Rn), x, y, ry, { rz: pitch, h: 0.0 });
      else if (k < 0.72) place(branch(1.2 + Rn() * 2.6, 0.025 + Rn() * 0.04, Rn), x, y, ry, { rz: pitch });
      else if (k < 0.84) place(sheet(1.6 + Rn() * 1.2, Rn), x, y, ry, { rz: pitch + 0.1, rx: Rn.gauss() * 0.3, h: -0.05 });
      else rubbish(x, y, Rn);
    }
    for (let i = 0; i < Math.max(2, len / 2.2); i++) { const t = (i + 0.5) / Math.max(2, len / 2.2) - 0.5, x = cx + ux * t * len + nx * depth * 0.3, y = cy + uy * t * len + ny * depth * 0.3; if (!blocked(x, y, 0.3, true)) mound(x, y, 1.1 + Rn() * 0.8, 0.5 + depth * 0.3, 0.22 + Rn() * 0.2, ang, Rn); }
  }
  jam(102, 48.25, PI, 17, 2.2, 46, 'c-north'); jam(114.25, 35, PI / 2, 22, 1.8, 34, 'c-east'); jam(21, 72.25, PI, 22, 2.0, 40, 'a-north'); jam(36.3, 73, PI * 0.75, 4, 1.6, 12, 'a-ne');
  jam(40.42, 22.9, PI / 2, 1.9, 1.0, 9, 'wall-s'); jam(40.42, 28.6, PI / 2, 2.2, 1.0, 10, 'wall-n');
  for (const i of [0, 1, 3, 4, 5]) { const p = poles[i]; jam(p.x + 0.25, p.y + 0.3, FLOW + PI / 2 + PI, 1.6, 0.8, 6, 'pole' + i); }
  jam(50, 11.2, PI, 3, 1.0, 9, 'culvert');

  // big pieces, placed along the flow
  scatter('trunks', 9, 2.6, (x, y, Rn) => { const len = 4 + Rn() * 5, r = 0.14 + Rn() * 0.14, a2 = along(Rn, 0.5); if (blocked(x + Math.cos(a2) * len, y + Math.sin(a2) * len, 0.5) || blocked(x + Math.cos(a2) * len / 2, y + Math.sin(a2) * len / 2, 0.5)) return; place(trunk(len, r, Rn), x, y, a2, { h: -r * 0.22 }); mound(x + Math.cos(a2) * len * 0.3 + 0.3, y + Math.sin(a2) * len * 0.3 + 0.25, len * 0.3, 0.7, 0.2 + r, a2, Rn); for (let i = 0; i < 4; i++) { const t = Rn() * len, px = x + Math.cos(a2) * t + 0.5 + Rn() * 0.6, py = y + Math.sin(a2) * t + 0.3 + Rn() * 0.5; if (!blocked(px, py, 0.4)) Rn() < 0.6 ? place(branch(1 + Rn() * 2, 0.03 + Rn() * 0.03, Rn), px, py, a2 + Rn.gauss() * 0.4, { rz: Rn() * 0.2 }) : rubbish(px, py, Rn); } });
  scatter('branches', 34, 1.2, (x, y, Rn) => place(branch(1.4 + Rn() * 3, 0.025 + Rn() * 0.05, Rn), x, y, along(Rn, 0.6), { rz: Rn() * 0.1 }));
  scatter('planks', 46, 1.2, (x, y, Rn) => place(plank(1 + Rn() * 2.6, Rn), x, y, along(Rn, 0.7), { rz: Rn() < 0.2 ? Rn() * 0.2 : 0, rx: Rn.gauss() * 0.06 }));
  scatter('sheets', 20, 1.3, (x, y, Rn) => { place(sheet(1.6 + Rn() * 1.4, Rn), x, y, along(Rn, 0.8), { rx: Rn.gauss() * 0.35, rz: Rn.gauss() * 0.12, h: -0.06 - Rn() * 0.1 }); if (Rn() < 0.6) mound(x + 0.3, y + 0.2, 0.9, 0.6, 0.16, Rn() * 3, Rn); });
  scatter('drums', 7, 0.6, (x, y, Rn) => { const c2 = silted(Rn.pick([0x4a5a62, 0x6b4a3a, 0x4d5548, 0x74787a]), 0.2), up = Rn() < 0.3; place(oilDrum(c2), x, y, Rn() * 6.3, up ? { rz: Rn.gauss() * 0.08, h: -0.06, dirt: [FLOOD_H, 0.7] } : { rz: PI / 2 + Rn.gauss() * 0.05, h: 0.2, dirt: [0.5, 0.8] }); if (!up) mound(x + 0.25, y + 0.2, 0.7, 0.5, 0.22, FLOW, Rn); });
  scatter('tyres', 7, 0.5, (x, y, Rn) => place(looseTyre(0.27 + Rn() * 0.1), x, y, Rn() * 6.3, { rx: PI / 2 + Rn.gauss() * 0.1, h: -0.02 }));
  scatter('rubbish', 64, 0.35, (x, y, Rn) => rubbish(x, y, Rn));
  scatter('cobbles', 90, 0.2, (x, y, Rn) => stone(x, 0.03, y, 0.06 + Rn() * 0.1, 0.04 + Rn() * 0.05, 0.06 + Rn() * 0.09, Rn() * 6, Rn, 0.5));
  scatter('mud', 26, 1.0, (x, y, Rn) => mound(x, y, 1 + Rn() * 1.8, 0.6 + Rn() * 0.8, 0.1 + Rn() * 0.14, FLOW + Rn.gauss() * 0.3, Rn), { tall: true });
  // single things with a place of their own
  { const Ro = rng('site:ones');
    place(bicycle(), 38.3, 32.2, 2.4, { rx: PI / 2 - 0.1, h: 0.06, dirt: [0.5, 0.6] }); mound(38.9, 32.5, 0.8, 0.5, 0.14, 0.4, Ro); KEEP.push([38.3, 32.2, 1.0]);
    place(trunk(6.4, 0.24, Ro), 40.9, 35.2, FLOW + 0.25, { h: -0.05 }); place(mattress(silted(0x8a8472, 0.25)), 38.9, 34.25, FLOW + 0.25 + PI / 2, { h: 0.0, dirt: [0.5, 0.6] }); KEEP.push([38.2, 34.2, 3.4]);
    mound(39.3, 35.3, 2.4, 0.8, 0.3, FLOW + 0.25, Ro);
    place([P('plastic', new THREE.SphereGeometry(0.11, 12, 8).translate(0, 0.1, 0), 0xaeaa9d)], 37.1, 24.4, 0.4, { dirt: [0.2, 0.7] });
    place(plasticChair(silted(0xaaa79b, 0.2)), 47.3, 23.3, 0.7, { rz: PI / 2 + 0.25, h: 0.21, dirt: WASH }); place(bag(silted(0x59636c, 0.3)), 56.6, 24.6, 1.2, { dirt: WASH }); place(pot(1.2), 68.6, 22.2, 0.3, { rz: 1.95, h: 0.14, dirt: WASH });
    // the prayer-flag line: one pole still stands, the other is down; the cord sags to the ground
    const A = [50.6, 13.6], B = [56.9, 12.4], top = new THREE.Vector3(A[0] + 0.45, 2.25, -(A[1] - 0.2)), cord = [top];
    G.wood.push(uvMul(rod([A[0], -0.2, -A[1]], [top.x, top.y, top.z], 0.03, 6, 0.022, true), 2, 1, true), uvMul(rod([B[0], 0.03, -B[1]], [B[0] - 2.3, 0.05, -(B[1] - 0.75)], 0.03, 6, 0.022, true), 2, 1, true));
    const FLAGS = [0x66747f, 0xb5b0a2, 0x855c53, 0x66705b, 0x9c8d5c];
    for (let i = 1; i <= 16; i++) { const t = i / 16, x = lerp(top.x, B[0] - 2.3, t) + Math.sin(t * 9) * 0.25 * Math.min(1, t * 3), y = lerp(A[1] - 0.2, B[1] - 0.75, t) + Math.sin(t * 5 + 1) * 0.3 * Math.min(1, t * 3), h = Math.max(0.025, top.y * Math.pow(1 - t / 0.42, 1.6) || 0.025); cord.push(new THREE.Vector3(x, t < 0.42 ? h : 0.025, -y)); }
    G.paint.push(tint(tube(cord, 0.006, { radial: 3, segs: 48 }), 0x8f8a7a));
    for (let i = 0; i < 15; i++) { const p0 = cord[i + 1], p1 = cord[Math.min(16, i + 2)], an = Math.atan2(-(p1.z - p0.z), p1.x - p0.x), c2 = silted(FLAGS[i % 5], p0.y > 0.3 ? 0.15 : 0.45);
      if (p0.y > 0.36) G.paint.push(tint(xform(new THREE.BoxGeometry(0.24, 0.3, 0.004).translate(0, -0.15, 0), (p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2, an, Ro.gauss() * 0.12, Math.atan2(p1.y - p0.y, Math.hypot(p1.x - p0.x, p1.z - p0.z))), c2));
      else G.paint.push(tint(xform(new THREE.BoxGeometry(0.24, 0.004, 0.3).translate(0, 0, 0.15), p0.x, 0.016 + (i % 3) * 0.003, p0.z, an + Ro.gauss() * 0.5, Ro.gauss() * 0.05, Ro.gauss() * 0.05), c2)); }
    for (let i = 0; i < 4; i++) stone(A[0] + Math.cos(i * 1.6) * 0.18, 0.06, A[1] + Math.sin(i * 1.6) * 0.18, 0.12, 0.08, 0.1, i, Ro, 0.3);
    KEEP.push([53.6, 13, 3.6]);
  }
  // paper: exercise-book pages and printed sheets washed out of the classrooms, thickest just downstream of block B
  scatter('paper', 150, 0.2, (x, y, Rn) => { const k = Rn() < 0.55 ? 0 : Rn() < 0.6 ? 1 : Rn() < 0.6 ? 2 : 3, w = k === 2 ? 0.3 + Rn() * 0.3 : 0.21, l = k === 2 ? 0.25 + Rn() * 0.3 : 0.297; G.decal.push(dq(w, l, CELL.paper(k), x, 0.012 + Rn() * 0.004, -y, Rn() * 6.3, Rn.gauss() * 0.02, Rn.gauss() * 0.02)); },
    { tall: false, area: [26, 8, 96, 66], density: (x, y) => 0.12 + 0.88 * Math.exp(-(((x - 52) / 16) ** 2 + ((y - 24) / 9) ** 2)) + 0.5 * Math.exp(-(((x - 40) / 4) ** 2 + ((y - 40) / 12) ** 2)) });

  // ======================================================================== assemble: one mesh per material
  const add = (key, mat, uv, color, cast = true) => { if (!G[key].length) return; group.add(mesh(merge(G[key], { keepUV: uv, keepColor: color }), mat, { name: 'site-' + key, cast })); };
  add('paint', mats.paint, false, true); add('plastic', mats.plastic, false, true); add('metal', mats.metalPaint, false, true);
  add('fabric', fabricMat, true, false); add('wood', mats.wood, true, false); add('cgi', mats.cgi, true, false); add('rubber', mats.rubber, false, false);
  add('glass', mats.glass, false, false); add('screen', mats.screen, false, false, false); add('concrete', mats.concrete, true, false); add('decal', decalMat, true, false, false); add('mud', mats.mud, true, false);
  const rockA = rock(1, 'site-boulder', { detail: 1 }), rockB = rock(1, 'site-stone', { flat: 0.95, detail: 0 });
  if (boulders.length) group.add(instanced(rockA, mats.rock, boulders, { colors: boulderCol, name: 'site-boulders' }));
  if (stones.length) group.add(instanced(rockB, mats.rock, stones, { colors: stoneCol, name: 'site-stones' }));
  group.updateMatrixWorld(true);

  return { group, dispose() { group.traverse((o) => o.geometry && o.geometry.dispose()); atlas.dispose(); decalMat.dispose(); fabricMat.dispose(); } };
}
