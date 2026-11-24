// Procedural models: rover, drone, beacon, base, vehicles, rubble, the building shells and the dark city around the site.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash } from './materials.js';

const tint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3), k = new THREE.Color(c); for (let i = 0; i < n; i++) { a[i * 3] = k.r; a[i * 3 + 1] = k.g; a[i * 3 + 2] = k.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
const at = (g, x, y, z) => g.translate(x, y, z);
const box = (w, h, d, x, y, z, c) => at(tint(new THREE.BoxGeometry(w, h, d), c), x, y, z);
const cyl = (r, r2, h, x, y, z, c, seg = 14, rx = 0, rz = 0) => { const g = new THREE.CylinderGeometry(r, r2, h, seg); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); return at(tint(g, c), x, y, z); };
const merge = (list) => { const l = list.map((g) => (g.index ? g.toNonIndexed() : g)); const m = mergeGeometries(l, false); list.forEach((g) => g.dispose()); return m; };

let cache = null;
export function parts() {
  if (cache) return cache;
  const M = 0xb9bfc7, M2 = 0x7d858f, D = 0x14171b, D2 = 0x23282e, O = 0xc9ced4;
  // rover: a low six-wheel chassis, deck plates, sensor mast, lidar, beacon rack. x is forward.
  const body = [box(0.62, 0.09, 0.30, 0, 0.17, 0, M), box(0.54, 0.05, 0.24, 0, 0.235, 0, D2), box(0.10, 0.07, 0.26, 0.33, 0.185, 0, M2), box(0.05, 0.10, 0.30, -0.325, 0.18, 0, M2),
    box(0.26, 0.10, 0.20, -0.10, 0.31, 0, M), box(0.22, 0.012, 0.16, -0.10, 0.367, 0, D), box(0.10, 0.06, 0.16, 0.14, 0.29, 0, D2), box(0.018, 0.16, 0.018, 0.17, 0.38, 0.05, M2), box(0.018, 0.16, 0.018, 0.17, 0.38, -0.05, M2),
    box(0.075, 0.07, 0.16, 0.18, 0.49, 0, M), box(0.012, 0.045, 0.13, 0.223, 0.49, 0, D), cyl(0.016, 0.016, 0.02, 0.23, 0.495, 0.04, O, 12, 0, Math.PI / 2), cyl(0.016, 0.016, 0.02, 0.23, 0.495, -0.04, O, 12, 0, Math.PI / 2),
    cyl(0.008, 0.012, 0.42, -0.24, 0.5, 0.09, D, 6), cyl(0.008, 0.012, 0.30, -0.24, 0.44, -0.09, D, 6)];
  for (const z of [0.175, -0.175]) { body.push(box(0.56, 0.035, 0.03, 0, 0.15, z, M2)); for (const x of [-0.22, 0, 0.22]) body.push(cyl(0.02, 0.02, 0.06, x, 0.1, z, M2, 8, Math.PI / 2)); }
  for (let q = 0; q < 3; q++) body.push(cyl(0.035, 0.035, 0.05, -0.28 + q * 0.0, 0.26 + q * 0.0, -0.08 + q * 0.08, 0x4a525c, 12));
  for (let q = 0; q < 4; q++) for (const z of [0.125, -0.125]) body.push(cyl(0.007, 0.007, 0.008, -0.2 + q * 0.133, 0.262, z, O, 6));
  const wheel = []; wheel.push(tint(new THREE.CylinderGeometry(0.095, 0.095, 0.075, 20).rotateX(Math.PI / 2), D)); wheel.push(tint(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 14).rotateX(Math.PI / 2), M2));
  for (let q = 0; q < 14; q++) { const a = (q / 14) * Math.PI * 2, g = tint(new THREE.BoxGeometry(0.022, 0.016, 0.078), D2); g.rotateZ(a + Math.PI / 2); g.translate(Math.cos(a) * 0.098, Math.sin(a) * 0.098, 0); wheel.push(g); }
  const lidar = [cyl(0.048, 0.055, 0.06, 0, 0, 0, D, 20), cyl(0.05, 0.05, 0.014, 0, 0.036, 0, M2, 20), box(0.02, 0.03, 0.012, 0.046, 0, 0, O)];
  // drone
  const dr = [box(0.34, 0.09, 0.16, 0, 0, 0, M2), box(0.22, 0.05, 0.12, 0.02, 0.06, 0, D2), box(0.08, 0.06, 0.1, 0.18, -0.03, 0, D), cyl(0.05, 0.05, 0.07, 0.17, -0.085, 0, D, 16, Math.PI / 2), cyl(0.022, 0.022, 0.02, 0.2, -0.085, 0, O, 12, 0, Math.PI / 2)];
  const hubs = []; for (let q = 0; q < 4; q++) { const a = Math.PI / 4 + (q * Math.PI) / 2, g = tint(new THREE.CylinderGeometry(0.016, 0.02, 0.42, 8).rotateZ(Math.PI / 2), D); g.translate(0.27, 0.02, 0); g.rotateY(-a); dr.push(g); const x = Math.cos(a) * 0.47, z = Math.sin(a) * 0.47; dr.push(cyl(0.032, 0.036, 0.08, x, 0.05, z, M2, 12)); dr.push(cyl(0.008, 0.008, 0.16, Math.cos(a) * 0.16, -0.12, Math.sin(a) * 0.16, D, 6)); hubs.push([x, 0.1, z]); }
  const blade = merge([box(0.46, 0.006, 0.035, 0, 0, 0, 0x2b3138), box(0.035, 0.006, 0.46, 0, 0, 0, 0x2b3138)]);
  // beacon
  const be = [cyl(0.26, 0.32, 0.12, 0, 0.06, 0, D2, 20), cyl(0.2, 0.24, 0.1, 0, 0.17, 0, M2, 20), cyl(0.025, 0.032, 1.7, 0, 1.0, 0, M2, 10), cyl(0.07, 0.07, 0.14, 0, 1.6, 0, D2, 14)]; for (let q = 0; q < 3; q++) { const a = (q / 3) * Math.PI * 2; be.push(box(0.03, 0.03, 0.5, Math.cos(a) * 0.2, 0.03, Math.sin(a) * 0.2, D).rotateY(0)); }
  // car
  const ext = (pts, w, bev, c) => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); const g = new THREE.ExtrudeGeometry(s, { depth: w - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: 0.012, bevelSegments: 2, steps: 1, curveSegments: 4 }); g.translate(0, 0, -(w - bev * 2) / 2); g.deleteAttribute('uv'); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return tint(g, c); };
  const carB = [ext([[-0.49, 0.24], [0.49, 0.24], [0.49, 0.40], [0.45, 0.45], [0.22, 0.50], [-0.40, 0.52], [-0.48, 0.47]], 0.94, 0.05, 0xffffff), ext([[-0.41, 0.50], [0.23, 0.48], [0.06, 0.70], [-0.02, 0.725], [-0.26, 0.725], [-0.33, 0.70]], 0.84, 0.07, 0x0b0d10), ext([[-0.30, 0.715], [0.03, 0.715], [0.0, 0.745], [-0.27, 0.745]], 0.76, 0.03, 0xffffff), box(0.99, 0.07, 0.95, 0, 0.25, 0, 0x15181b)];
  for (const x of [-0.31, 0.31]) for (const z of [-0.44, 0.44]) { const g = tint(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 14).rotateX(Math.PI / 2), 0x0c0d0f); g.scale(0.42, 1, 1); carB.push(at(g, x, 0.17, z)); }
  for (const z of [-0.36, 0.36]) carB.push(box(0.01, 0.07, 0.16, 0.495, 0.42, z, 0xcfd4da), box(0.01, 0.07, 0.16, -0.495, 0.42, z, 0x4a1512));
  const rock = new THREE.IcosahedronGeometry(0.5, 1); { const p = rock.attributes.position; for (let i = 0; i < p.count; i++) { const k = Math.round(p.getX(i) * 91) * 73856093 ^ Math.round(p.getY(i) * 91) * 19349663 ^ Math.round(p.getZ(i) * 91) * 83492791, r = 0.72 + 0.5 * hash(k); p.setXYZ(i, p.getX(i) * r * 1.15, Math.max(-0.3, p.getY(i) * r * 0.72), p.getZ(i) * r); } rock.computeVertexNormals(); }
  // the person marker: a seated figure built from soft volumes (a symbol, not a claim about pose)
  const cap = (r, l, x, y, z, rx, rz) => { const g = new THREE.CapsuleGeometry(r, l, 6, 14); g.rotateX(rx); g.rotateZ(rz); return g.translate(x, y, z); };
  const person = merge([new THREE.SphereGeometry(0.14, 18, 14).translate(0, 1.0, 0), cap(0.17, 0.36, 0, 0.6, 0, 0, 0.06), cap(0.085, 0.42, 0.22, 0.33, 0.12, 0, 1.1), cap(0.085, 0.42, 0.22, 0.33, -0.12, 0, 1.1), cap(0.07, 0.38, 0.45, 0.2, 0.12, 0, -0.3), cap(0.07, 0.38, 0.45, 0.2, -0.12, 0, -0.3), cap(0.055, 0.34, 0.14, 0.62, 0.22, 0.2, 0.7), cap(0.055, 0.34, 0.14, 0.62, -0.22, -0.2, 0.7)]);
  cache = { rover: merge(body), wheel: merge(wheel), lidar: merge(lidar), drone: merge(dr), hubs, blade, beacon: merge(be), car: merge(carB), rock, person };
  return cache;
}

const addShell = (list, x0, x1, z0, z1, y0, y1, top, real, dmg) => {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = top; a[i * 3 + 1] = real; a[i * 3 + 2] = dmg; } g.setAttribute('aShell', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); list.push(g);
};
// building outlines are on the site map before anyone goes in; heights are drawn, not measured
export function siteShells(buildings, seed) {
  const list = [];
  for (const b of buildings) {
    const [x0, y0, x1, y1] = b.rect, r = hash(b.id * 31 + seed * 7 + 5), r2 = hash(b.id * 17 + seed + 99), top = (r < 0.35 ? 2 : r < 0.8 ? 3 : 1) * 3.05 + 0.6, dmg = (r2 - 0.5) * 0.16;
    addShell(list, x0 - 0.06, x1 + 0.06, -y1 - 0.06, -y0 + 0.06, 0, top, top, 1, dmg);
    // parapet and plant on the roof
    for (const [a, b2, c, d] of [[x0, x1, -y1, -y1 + 0.25], [x0, x1, -y0 - 0.25, -y0], [x0, x0 + 0.25, -y1, -y0], [x1 - 0.25, x1, -y1, -y0]]) addShell(list, a, b2, c, d, top, top + 0.45, top + 1.2, 1, dmg);
    const n = 2 + Math.floor(r2 * 4); for (let q = 0; q < n; q++) { const w = 1 + hash(q * 7 + b.id * 3 + seed) * 2.4, d = 1 + hash(q * 11 + b.id * 5 + seed) * 1.8, x = x0 + 1.5 + hash(q + b.id * 77 + seed) * Math.max(0.1, x1 - x0 - 6), y = y0 + 1.5 + hash(q * 3 + b.id * 41 + seed) * Math.max(0.1, y1 - y0 - 5); addShell(list, x, x + w, -y - d, -y, top, top + 0.7 + hash(q * 13 + b.id) * 0.9, top + 2, 1, dmg); }
  }
  return list.length ? mergeGeometries(list, false) : null;
}
export function citySurround(SX, SY, seed) {
  const list = []; const pitch = 34;
  for (let gx = -7; gx <= 10; gx++) for (let gy = -6; gy <= 8; gy++) {
    const cx = gx * pitch + 12, cy = gy * pitch + 8, r = hash(gx * 733 + gy * 97 + 11), r2 = hash(gx * 19 + gy * 613 + 5), w = 15 + r * 9, d = 14 + r2 * 10;
    if (cx + w / 2 > -11 && cx - w / 2 < SX + 11 && cy + d / 2 > -11 && cy - d / 2 < SY + 11) continue; if (hash(gx * 5 + gy * 71) < 0.1) continue;
    const dist = Math.max(0, Math.max(-cx, cx - SX, -cy, cy - SY)), top = (2 + Math.floor(hash(gx * 41 + gy * 3) * (dist > 60 ? 8 : 4.2))) * 3.05 + 0.6;
    addShell(list, cx - w / 2, cx + w / 2, -cy - d / 2, -cy + d / 2, 0, top, top, 0, (r - 0.5) * 0.1 - 0.05);
    addShell(list, cx - w / 2, cx + w / 2, -cy - d / 2, -cy - d / 2 + 0.3, top, top + 0.5, top + 2, 0, -0.4); addShell(list, cx - w / 2, cx + w / 2, -cy + d / 2 - 0.3, -cy + d / 2, top, top + 0.5, top + 2, 0, -0.4);
    if (r2 > 0.3) { const px = cx - w / 4, pz = -cy; addShell(list, px, px + 3.5, pz, pz + 2.6, top, top + 1.8, top + 4, 0, -0.4); }
  }
  return mergeGeometries(list, false);
}
