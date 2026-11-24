// Rubble and flood debris: the pile that blocks the corridor, the collapsed north-east corner (broken roof slab,
// reinforcing bars, bricks and the mud that pushed it in), the debris field, and the boulders the slide left on
// its way down. Each pile is a mud mound shaped from its polygon in world.OBSTACLES plus instanced and merged pieces.
import * as THREE from 'three';
import { pointInPoly, distToSeg } from '../core/geometry.js';
import { rng, makeNoise, merge, mesh, instanced, matrix, rock, slab, tube, worldUV, box, cyl, xform, polyBounds, polyCentroid, smooth, tint, ironSheet } from './util.js';

export function build(env) {
  const { world, mats, label } = env, group = new THREE.Group(); group.name = 'rubble';
  const n = makeNoise('rubble');
  const sd = (p, poly) => { let d = Infinity; for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSeg(p, poly[i], poly[(i + 1) % poly.length])); return pointInPoly(p, poly) ? d : -d; };
  const G = { concrete: [], wood: [], rebar: [], cgi: [], inner: [], paint: [] }, rocks = [[], [], []], bricks = [], brickCol = [];
  const rockGeo = [rock(1, 'a'), rock(1, 'b', { flat: 0.7 }), rock(1, 'c', { flat: 0.55, detail: 0 })];
  const mudMat = mats.mud.clone(); mudMat.vertexColors = true;

  // A mound over a polygon. heightFn(p, d) -> metres; d = distance inside the edge.
  function mound(poly, heightFn, res = 0.3, pad = 1.4) {
    const [x0, y0, x1, y1] = polyBounds(poly), nx = Math.ceil((x1 - x0 + pad * 2) / res), ny = Math.ceil((y1 - y0 + pad * 2) / res);
    const g = new THREE.PlaneGeometry((nx) * res, (ny) * res, nx, ny).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0, -(y0 + y1) / 2), p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const pt = [p.getX(i), -p.getZ(i)], d = sd(pt, poly), h = heightFn(pt, d); p.setY(i, h > 0.004 ? h : -0.12);
      const k = 0.72 + n.fbm(pt[0] * 0.9, pt[1] * 0.9, 3) * 0.5; c.setRGB(0.92 * k, 0.9 * k, 0.86 * k).lerp(new THREE.Color(0.55, 0.5, 0.44), smooth(0.5, 0.05, h)); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
    return worldUV(g, 0.45);
  }
  function scatter(poly, count, R, fn, inset = 0.15) { const [x0, y0, x1, y1] = polyBounds(poly); let made = 0; for (let i = 0; i < count * 30 && made < count; i++) { const p = [x0 + R() * (x1 - x0), y0 + R() * (y1 - y0)], d = sd(p, poly); if (d < inset) continue; fn(p, d, made++); } }
  const tilt = (R, a = 0.5) => [(R() - 0.5) * a * 2, (R() - 0.5) * a * 2];
  const obst = (id) => world.OBSTACLES.find((o) => o.id === id);

  // ---- the corridor: silt and everything the water pushed down the hall, jammed 1.4 m high ----
  {
    const o = obst('rubble-corridor'), R = rng('rub-corr'), hf = (p, d) => o.h * 0.72 * Math.pow(smooth(-0.1, 1.3, d), 0.8) * (0.7 + 0.6 * n.fbm(p[0] * 0.8 + 5, p[1] * 0.8, 3));
    group.add(mesh(mound(o.poly, hf, 0.2, 1.0), mudMat, { name: 'corridor-mud' }));
    scatter(o.poly, 26, R, (p, d) => { const h = hf(p, d), s = 0.12 + R() * 0.28, [rx, rz] = tilt(R, 0.6); rocks[Math.floor(R() * 3)].push(matrix(p[0], h - s * 0.2, -p[1], R() * 6.3, rx, rz, [s, s * (0.6 + R() * 0.5), s * (0.7 + R() * 0.6)])); });
    scatter(o.poly, 11, R, (p, d) => { const h = hf(p, d), len = 1.2 + R() * 1.6, [rx, rz] = tilt(R, 0.7); G.wood.push(worldUV(xform(new THREE.BoxGeometry(len, 0.04 + R() * 0.03, 0.12 + R() * 0.14), p[0], h + 0.1 + R() * 0.25, -p[1], R() * 3.1, rx, rz), 0.9)); });
    scatter(o.poly, 5, R, (p, d) => { const h = hf(p, d), [rx, rz] = tilt(R, 0.9); G.inner.push(xform(new THREE.BoxGeometry(0.8 + R() * 0.9, 0.03, 0.6 + R() * 0.8), p[0], h + 0.12, -p[1], R() * 3.1, rx, rz)); });
    // a classroom door and two desk frames caught in it
    G.wood.push(worldUV(xform(new THREE.BoxGeometry(0.85, 2.0, 0.045), 77.4, 0.95, -43.5, 0.5, 0.9, 0.25), 0.8));
    for (const [x, y, ry, rz] of [[78.2, 44.9, 0.4, 1.1], [76.9, 44.2, 2.1, -0.8]]) { G.wood.push(worldUV(xform(new THREE.BoxGeometry(1.1, 0.03, 0.45).translate(0, 0.72, 0), x, 0.35, -y, ry, 0.2, rz), 0.9)); for (const [lx, lz] of [[-0.5, -0.18], [0.5, -0.18], [-0.5, 0.18], [0.5, 0.18]]) G.paint.push(tint(xform(new THREE.BoxGeometry(0.03, 0.72, 0.03).translate(lx, 0.36, lz), x, 0.35, -y, ry, 0.2, rz), 0x3f474c)); }
    for (let i = 0; i < 5; i++) { const a = [76.2 + R() * 2.8, 42.4 + R() * 3.2], len = 1 + R() * 1.4, ang = R() * 6.3, y0 = 0.5 + R() * 0.6; G.wood.push(xform(new THREE.CylinderGeometry(0.03, 0.05, len, 5).rotateZ(Math.PI / 2), a[0], y0, -a[1], ang, 0, (R() - 0.5) * 0.9)); }
    label('Corridor blocked', { sub: 'Flood debris, 1.4 m high', tone: 'muted', priority: 2, maxDist: 70, position: new THREE.Vector3(77.6, 1.9, -44) });
  }

  // ---- the north-east corner: the roof slab came down in pieces when the slide hit the wall ----
  {
    const o = obst('rubble-ne'), R = rng('rub-ne'), hf = (p, d) => o.h * 0.62 * Math.pow(smooth(-0.2, 2.4, d), 0.75) * (0.65 + 0.7 * n.fbm(p[0] * 0.5 + 11, p[1] * 0.5 + 3, 3)) * (0.75 + 0.25 * smooth(78, 86, p[0] + (p[1] - 55) * 0.5));
    group.add(mesh(mound(o.poly, hf, 0.25, 1.8), mudMat, { name: 'ne-mud' }));
    const big = [[81.2, 55.2, 3.4, 2.6, 0.2, 0.3, 0.42, -0.3], [82.9, 52.9, 2.8, 2.2, 0.2, 1.4, -0.55, 0.2], [80.3, 57.6, 2.6, 1.9, 0.2, 2.4, 0.3, 0.5], [83.6, 56.4, 2.2, 2.4, 0.2, 0.9, 0.7, -0.15], [79.6, 54.1, 1.7, 1.5, 0.18, 2.0, -0.35, -0.5], [84.6, 54.3, 1.9, 1.3, 0.2, 0.2, 0.2, 0.75], [82.1, 58.6, 2.3, 1.6, 0.2, 1.1, -0.25, 0.3]];
    for (const [x, y, w, d, th, ry, rx, rz] of big) {
      const h = hf([x, y], sd([x, y], o.poly)); G.concrete.push(xform(slab(w, d, th, R, 0.22), x, h + 0.25 + R() * 0.3, -y, ry, rx, rz));
      for (let k = 0; k < 5; k++) { const a = R() * 6.3, r0 = Math.min(w, d) * 0.42, len = 0.35 + R() * 0.9, bx = x + Math.cos(a) * r0, by = y + Math.sin(a) * r0, by0 = h + 0.35 + R() * 0.3; G.rebar.push(tube([new THREE.Vector3(bx, by0, -by), new THREE.Vector3(bx + Math.cos(a) * len * 0.5, by0 + 0.1 + R() * 0.2, -(by + Math.sin(a) * len * 0.5)), new THREE.Vector3(bx + Math.cos(a + R() - 0.5) * len, by0 + (R() - 0.3) * 0.6, -(by + Math.sin(a + R() - 0.5) * len))], 0.011, { radial: 4, segs: 6 })); }
    }
    for (const [x, y, len, ry, rz] of [[82.6, 55.6, 2.3, 0.7, 1.15], [80.9, 53.2, 1.6, 2.2, 1.35], [83.9, 58.9, 1.9, 1.5, 0.3]]) {               // snapped columns and beams
      const h = hf([x, y], sd([x, y], o.poly)); G.concrete.push(worldUV(xform(new THREE.BoxGeometry(0.42, len, 0.42), x, h + 0.5, -y, ry, 0, rz), 0.5));
      for (const [ox, oz] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) G.rebar.push(xform(new THREE.CylinderGeometry(0.012, 0.012, len + 0.9, 4).translate(ox, 0.2, oz), x, h + 0.5, -y, ry, 0, rz));
    }
    scatter(o.poly, 70, R, (p, d) => { const h = hf(p, d), s = 0.12 + R() * R() * 0.6, [rx, rz] = tilt(R, 0.7); rocks[Math.floor(R() * 3)].push(matrix(p[0], h - s * 0.15, -p[1], R() * 6.3, rx, rz, [s, s * (0.5 + R() * 0.6), s * (0.7 + R() * 0.6)])); });
    scatter(o.poly, 260, R, (p, d) => { const h = hf(p, d), [rx, rz] = tilt(R, 0.8); bricks.push(matrix(p[0], h + 0.03, -p[1], R() * 6.3, rx, rz)); brickCol.push(R() < 0.75 ? 0x7d5847 : 0x9c8f82); }, 0.05);
    scatter(o.poly, 8, R, (p, d) => { const h = hf(p, d), [rx, rz] = tilt(R, 0.5), g = ironSheet(0.912, 2 + R() * 1.2, R, { bend: 0.2, dent: 0.08, tear: 0.12 }); G.cgi.push(xform(g, p[0], h + 0.2, -p[1], R() * 3.1, rx, rz)); });
    for (let i = 0; i < 7; i++) { const p = [79 + R() * 6, 52 + R() * 7], len = 1.5 + R() * 2.2; G.wood.push(worldUV(xform(new THREE.BoxGeometry(len, 0.07, 0.14), p[0], hf(p, sd(p, o.poly)) + 0.3 + R() * 0.4, -p[1], R() * 3.1, ...tilt(R, 0.8)), 0.9)); }
    label('Collapsed corner', { sub: 'Roof slab and mud. Do not enter', tone: 'danger', priority: 3, maxDist: 110, position: new THREE.Vector3(82.4, 2.9, -55.4) });
  }

  // ---- the debris field north-east of the block: what the water dropped as it slowed ----
  {
    const o = obst('rubble-field'), R = rng('rub-field'), hf = (p, d) => Math.max(0, o.h * 1.1 * smooth(-0.3, 2.2, d) * (n.fbm(p[0] * 0.33 + 2, p[1] * 0.33 + 9, 4) - 0.36) * 2.2);
    group.add(mesh(mound(o.poly, hf, 0.35, 2.2), mudMat, { name: 'field-mud' }));
    scatter(o.poly, 120, R, (p, d) => { const h = hf(p, d), s = 0.1 + R() * R() * 0.75, [rx, rz] = tilt(R, 0.6); rocks[Math.floor(R() * 3)].push(matrix(p[0], h - s * 0.25, -p[1], R() * 6.3, rx, rz, [s, s * (0.5 + R() * 0.5), s * (0.7 + R() * 0.6)])); }, -1.2);
    scatter(o.poly, 9, R, (p, d) => { const h = hf(p, d), len = 2.5 + R() * 3.5, r0 = 0.09 + R() * 0.1, ang = 3.6 + R.gauss() * 0.5; G.wood.push(xform(new THREE.CylinderGeometry(r0 * 0.7, r0, len, 7).rotateZ(Math.PI / 2), p[0], h + r0 * 0.7, -p[1], ang, 0, (R() - 0.5) * 0.25)); if (R() < 0.6) G.wood.push(xform(new THREE.CylinderGeometry(r0 * 0.25, r0 * 0.4, len * 0.4, 5).rotateZ(Math.PI / 2 - 0.7), p[0] + Math.cos(ang) * len * 0.2, h + r0 + 0.25, -(p[1] + Math.sin(ang) * len * 0.2) , ang + 0.4, 0, 0)); }, 0.6);
    scatter(o.poly, 16, R, (p, d) => { const h = hf(p, d), len = 1.2 + R() * 2; G.wood.push(worldUV(xform(new THREE.BoxGeometry(len, 0.045, 0.12 + R() * 0.1), p[0], h + 0.06 + R() * 0.2, -p[1], 3.6 + R.gauss() * 0.7, ...tilt(R, 0.35)), 0.9)); }, 0.3);
    scatter(o.poly, 9, R, (p, d) => { const h = hf(p, d), g = ironSheet(0.912, 1.8 + R() * 1.4, R, { bend: 0.24, dent: 0.1, tear: 0.13 }); G.cgi.push(xform(g, p[0], h + 0.14, -p[1], R() * 3.1, ...tilt(R, 0.3))); }, 0.5);
    scatter(o.poly, 6, R, (p, d) => { const h = hf(p, d); G.concrete.push(xform(slab(0.8 + R() * 1.2, 0.7 + R(), 0.14, R, 0.25), p[0], h + 0.05, -p[1], R() * 3.1, ...tilt(R, 0.45))); }, 0.6);
    scatter(o.poly, 60, R, (p, d) => { bricks.push(matrix(p[0], hf(p, d) + 0.03, -p[1], R() * 6.3, ...tilt(R, 0.6))); brickCol.push(R() < 0.6 ? 0x7d5847 : 0x8f8a82); }, 0.2);
    label('Debris field', { sub: 'Loose flood debris. Passable on foot with care', tone: 'muted', priority: 2, maxDist: 130, position: new THREE.Vector3(97, 2.2, -69) });
  }

  // ---- boulders and stones along the slide's path down from the north-east slope ----
  {
    const R = rng('rub-slide');
    for (let i = 0; i < 150; i++) {
      const tt = Math.pow(R(), 0.8), x = 85.5 + tt * 68 + R.gauss() * (2 + tt * 10), y = 57.5 + tt * 62 + R.gauss() * (2 + tt * 12), s = 0.12 + R() * R() * (0.5 + tt * 1.3);
      if (x > 43 && x < 85 && y > 29 && y < 59) continue; if (sd([x, y], obst('rubble-ne').poly) > 0 || sd([x, y], obst('rubble-field').poly) > 0) continue;
      const gy = env.environment ? Math.max(0, env.environment.heightAt(x, y)) : 0; rocks[Math.floor(R() * 3)].push(matrix(x, gy - s * 0.3, -y, R() * 6.3, ...tilt(R, 0.5), [s, s * (0.5 + R() * 0.45), s * (0.75 + R() * 0.5)]));
    }
    for (let i = 0; i < 60; i++) { const x = 10 + R() * 100, y = 12 + R() * 70, s = 0.05 + R() * 0.12; if ((x > 42 && x < 86 && y > 24 && y < 60) || (x > 6 && x < 36 && y > 38 && y < 72) || (x > 90 && x < 114 && y > 18 && y < 48) || (x > 58 && x < 70 && y < 30) || (x > 12 && x < 36 && y < 22)) continue; rocks[Math.floor(R() * 3)].push(matrix(x, -s * 0.2, -y, R() * 6.3, 0, 0, [s, s * 0.6, s])); }
  }

  for (let i = 0; i < 3; i++) if (rocks[i].length) group.add(instanced(rockGeo[i], mats.rock, rocks[i], { name: 'rocks-' + i }));
  if (bricks.length) group.add(instanced(new THREE.BoxGeometry(0.22, 0.07, 0.105), new THREE.MeshStandardMaterial({ roughness: 0.9 }), bricks, { colors: brickCol, name: 'bricks' }));
  for (const [k, mat, uv] of [['concrete', mats.concrete, true], ['wood', mats.wood, true], ['rebar', mats.rebar, false], ['cgi', mats.cgi, true], ['inner', mats.inner, true], ['paint', mats.paint, false]]) if (G[k].length) group.add(mesh(merge(G[k], { keepUV: uv, keepColor: k === 'paint' }), mat, { name: 'rubble-' + k }));
  return { group, dispose() { mudMat.dispose(); } };
}
