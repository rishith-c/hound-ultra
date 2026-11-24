// The inside of block B: classroom furniture, the science lab, the corridor and hall fittings, the north stair, and
// what the flood did to all of it. The water came in from the north-east and drained to the south-west, so light
// things (chairs, bags, buckets, books) were carried until they jammed against a south or west wall or against
// something heavier; heavy things stayed and only shifted. Everything below the tide line (1.15 m) carries silt.
// Loose furniture is "settled": each piece slides along the flow until a wall or another piece stops it, and is
// dropped if it would come to rest in a lane the rover or the team needs. Nothing here reads world.TRUTH.
import * as THREE from 'three';
import { FLOOD_H } from './textures.js';

const FLOOR = 0.014, T_OUT = 0.16, T_IN = 0.07, PI = Math.PI, H2 = PI / 2;

// Flood silt on a material: a tide line at FLOOD_H, more silt near the floor and on faces that look up.
function siltify(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec4 vSilt;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 siltP = vec4(transformed, 1.0); vec3 siltN = objectNormal;
        #ifdef USE_INSTANCING
          siltP = instanceMatrix * siltP; siltN = mat3(instanceMatrix) * siltN;
        #endif
        siltP = modelMatrix * siltP; vSilt = vec4(siltP.xyz, normalize(mat3(modelMatrix) * siltN).y);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vSilt;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float siltW = sin(vSilt.x * 2.7 + sin(vSilt.z * 1.9) * 1.6) * 0.5 + sin(vSilt.z * 3.9 + vSilt.x * 1.1) * 0.5;
        float siltT = 1.0 - smoothstep(${(FLOOD_H - 0.07).toFixed(3)}, ${(FLOOD_H + 0.03).toFixed(3)}, vSilt.y + siltW * 0.03);
        float siltK = siltT * clamp(0.16 + 0.26 * (1.0 - smoothstep(0.0, 0.55, vSilt.y)) + 0.3 * max(vSilt.w, 0.0) + 0.1 * siltW, 0.0, 0.8);
        siltK += 0.2 * siltT * smoothstep(${(FLOOD_H - 0.22).toFixed(3)}, ${(FLOOD_H - 0.05).toFixed(3)}, vSilt.y);
        siltK = min(siltK, 0.88);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.128, 0.092), siltK);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.94, siltK);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor *= 1.0 - siltK;');
  };
  mat.customProgramCacheKey = () => 'twin-silt';
  return mat;
}

export function build(env) {
  const { world, mats, tex, U, label, t, quality } = env, rng = env.rng;
  const { box, cyl, xform, matrix, merge, mesh, instanced, tint, worldUV, clamp } = U;
  const group = new THREE.Group(); group.name = 'interior';
  const B = world.BUILDING.rect, room = (id) => world.roomById(id), noise = U.makeNoise('interior-silt');
  const G = { paint: [], wood: [], metal: [], plastic: [], mud: [], concrete: [], board: [] };

  // ---- small geometry helpers ----
  const P = (w, h, d, x, y, z, c, ry = 0, rx = 0, rz = 0) => tint(box(w, h, d, x, y, z, ry, rx, rz), c);      // a box whose base is at y, painted
  const C = (rt, rb, h, x, y, z, c, seg = 10, ry = 0, rx = 0, rz = 0) => tint(cyl(rt, rb, h, x, y, z, seg, ry, rx, rz), c);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3();
  function rod3(x1, y1, z1, x2, y2, z2, r, c, seg = 6) {                                                      // a round bar between two points (three.js coordinates)
    _a.set(x1, y1, z1); _b.set(x2, y2, z2); _d.subVectors(_b, _a); const len = _d.length(), g = new THREE.CylinderGeometry(r, r, len, seg);
    _q.setFromUnitVectors(_up, _d.normalize()); g.applyMatrix4(_m.compose(_a.add(_b).multiplyScalar(0.5), _q, _one)); return tint(g, c);
  }
  const rod = (ax, ay, ah, bx, by, bh, r, c, seg = 6) => rod3(ax, ah, -ay, bx, bh, -by, r, c, seg);            // the same in site coordinates (x, y, height)
  const place = (bucket, geos, x, y, ry = 0, h = FLOOR, rx = 0, rz = 0) => { for (const g of geos) G[bucket].push(xform(g, x, h, -y, ry, rx, rz)); };
  const loc = (x, y, ry, lx, lz) => [x + lx * Math.cos(ry) + lz * Math.sin(ry), y + lx * Math.sin(ry) - lz * Math.cos(ry)];   // a local point of a placed object, on the map
  const yawOut = (nx, ny) => Math.atan2(nx, -ny);                                                              // turns local +z to point along (nx, ny)

  // ---- rooms: the faces of their walls ----
  const inner = (r) => { const [x0, y0, x1, y1] = r.rect; return [x0 + (x0 === B[0] ? T_OUT : T_IN), y0 + (y0 === B[1] ? T_OUT : T_IN), x1 - (x1 === B[2] ? T_OUT : T_IN), y1 - (y1 === B[3] ? T_OUT : T_IN)]; };
  const WALL = { N: (I, s) => ({ x: s, y: I[3], nx: 0, ny: -1 }), S: (I, s) => ({ x: s, y: I[1], nx: 0, ny: 1 }), E: (I, s) => ({ x: I[2], y: s, nx: -1, ny: 0 }), W: (I, s) => ({ x: I[0], y: s, nx: 1, ny: 0 }) };
  function onWall(bucket, geos, r, side, s, h, off = 0, rz = 0, dyaw = 0) { const w = WALL[side](inner(r), s); place(bucket, geos, w.x + w.nx * off, w.y + w.ny * off, yawOut(w.nx, w.ny) + dyaw, h, 0, rz); return w; }

  // ---- where nothing taller than litter may rest: the rover's lanes, doorways, listening stops, the rubble piles ----
  const KEEP = [
    [46.4, 43.0, 75.8, 45.0],                       // main corridor
    [62.9, 29, 65.1, 46], [62, 38.2, 66, 39.8],     // entrance hall and its two side openings
    [62.9, 46, 65.1, 50.3], [62, 47.9, 66, 50.2],   // foot of the stairwell and its side openings
    [60.6, 38.2, 62, 39.8], [66, 38.1, 71.6, 39.9], [69.7, 37.5, 71.5, 42],   // into 102; into and through 103
    [60.6, 48.2, 62, 49.8], [66, 48.2, 67.4, 49.8],                           // into 110 and 111 from the stairwell
    [74.4, 49.9, 78.3, 52.7],                       // where the water burst through the partition between 112 and 111
  ];
  for (const s of world.STOPS) KEEP.push([s.pos[0] - 1, s.pos[1] - 1, s.pos[0] + 1, s.pos[1] + 1]);
  for (const d of world.DOORS) {
    if (d.id === 'entrance') continue; const r = room(d.room), into = Math.sign((r.rect[1] + r.rect[3]) / 2 - d.pos[1]), dep = d.blocked ? 0.45 : 1.75;
    KEEP.push([d.pos[0] - 1.35, Math.min(d.pos[1], d.pos[1] + into * dep), d.pos[0] + 0.95, Math.max(d.pos[1], d.pos[1] + into * dep)]);
  }
  const LANE111 = [[69.6, 46], [71.7, 46], [74.7, 49.6], [74.7, 52.1], [72.3, 52.1], [69.6, 47.8]];            // door of 111 to the stop by its east wall
  const RUBBLE = world.OBSTACLES.filter((o) => o.kind === 'rubble' && !o.passable).map((o) => o.poly);
  const pip = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const near = (x, y, r, poly) => { if (pip(x, y, poly)) return true; for (let i = 0; i < 8; i++) if (pip(x + Math.cos(i * PI / 4) * r, y + Math.sin(i * PI / 4) * r, poly)) return true; return false; };
  const inKeep = (x, y, r = 0) => KEEP.some((k) => x > k[0] - r && x < k[2] + r && y > k[1] - r && y < k[3] + r) || near(x, y, r, LANE111);
  const inRubble = (x, y, r = 0.3) => RUBBLE.some((p) => near(x, y, r, p));

  // ---- loose things: a local bounding box, a footprint radius, and where their copies go ----
  const OCC = {}, occOf = (r) => (OCC[r.id] || (OCC[r.id] = []));
  const DEF = {
    desk: { bb: [-0.55, 0, -0.42, 0.55, 0.78, 0.435], r: 0.5, list: [] },
    table: { bb: [-0.6, 0, -0.25, 0.6, 0.74, 0.25], r: 0.42, list: [] },
    chair: { bb: [-0.2, 0, -0.19, 0.2, 0.82, 0.2], r: 0.25, list: [] },
    stool: { bb: [-0.17, 0, -0.17, 0.17, 0.62, 0.17], r: 0.2 },
    bucket: { bb: [-0.15, 0, -0.15, 0.15, 0.27, 0.15], r: 0.17 },
    bag: { bb: [-0.16, 0, -0.085, 0.16, 0.42, 0.1], r: 0.2 },
    cupboard: { bb: [-0.46, 0, -0.235, 0.46, 1.92, 0.245], r: 0.5 },
  };
  // The matrix that puts a thing at (x, y) in a pose with its lowest corner on the floor, and its footprint.
  function rest(def, x, y, ry, rx = 0, rz = 0, floor = FLOOR) {
    const m = matrix(x, 0, -y, ry, rx, rz), b = def.bb, pts = []; let lo = Infinity;
    for (let i = 0; i < 8; i++) { _v.set(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2]).applyMatrix4(m); lo = Math.min(lo, _v.y); pts.push([_v.x, -_v.z]); }
    m.elements[13] = floor - lo; return { m, pts };
  }
  // Slide a thing along dir for up to travel metres, round whatever is in the way, until it jams. null: it was carried off.
  function settle(def, r, x, y, ry, rx, rz, travel, dir, R, loose = 0.86) {
    const I = inner(r), occ = occOf(r);
    const fit = (px, py, solid) => {
      const q = rest(def, px, py, ry, rx, rz);
      for (const p of q.pts) if (p[0] < I[0] + 0.015 || p[0] > I[2] - 0.015 || p[1] < I[1] + 0.015 || p[1] > I[3] - 0.015) return null;
      if (inRubble(px, py, def.r + 0.3)) return null;
      if (solid) for (const o of occ) if (Math.hypot(o.x - px, o.y - py) < (o.r + def.r) * loose) return null;
      return q;
    };
    let q = fit(x, y, travel > 0);
    for (let k = 0; !q && k < 10; k++) { const tx = x + R.gauss() * 0.5, ty = y + R.gauss() * 0.5; q = fit(tx, ty, travel > 0); if (q) { x = tx; y = ty; } }
    if (!q) return null;
    if (travel > 0) {
      const st = 0.08, sx = Math.sign(dir[0]) * st, sy = Math.sign(dir[1]) * st; let left = travel, guard = 0;
      while (guard++ < 700 && (left > 0 || inKeep(x, y, def.r * 0.8))) {
        let n = fit(x + dir[0] * st, y + dir[1] * st, true);
        if (n) { x += dir[0] * st; y += dir[1] * st; } else if (sx && (n = fit(x + sx, y, true))) x += sx; else if (sy && (n = fit(x, y + sy, true))) y += sy; else break;
        q = n; left -= st;
      }
    }
    if (inKeep(x, y, def.r * 0.8)) return null;
    occ.push({ x, y, r: def.r }); return { m: q.m, x, y };
  }
  const TIPS = [[0, H2], [0, -H2], [-H2, 0], [H2, 0], [0, PI], [PI, 0]];
  const tip = (R, lean = 0) => { if (lean && R() < lean) return [R.sign() * R.range(0.5, 1.0), R.gauss() * 0.2]; const p = R.pick(TIPS); return [p[0] + R.gauss() * 0.05, p[1] + R.gauss() * 0.05]; };
  const TONES = [0xffffff, 0xece6dc, 0xddd6c9, 0xf3ebde, 0xd4dad7, 0xe6ddd0, 0xcfc8bc];
  const FLOW = [-0.62, -0.78], turn = (d, a) => [d[0] * Math.cos(a) - d[1] * Math.sin(a), d[0] * Math.sin(a) + d[1] * Math.cos(a)];
  const drop = (def, s, R) => { if (!s) return false; if (def.list) def.list.push({ m: s.m, tone: R.pick(TONES) }); else { const parts = def.make(R); for (const k in parts) for (const g of parts[k]) G[k].push(g.applyMatrix4(s.m)); } return true; };
  // One loose thing with its fate: 0 stays where it was, 1 shifted a little, 2 carried by the water.
  function loose(def, r, x, y, ry, fate, R, { dir = FLOW, d = 0.5, lean = 0, tipped = null } = {}) {
    let rx = 0, rz = 0, travel = 0;
    if (fate === 0) { x += R.gauss() * 0.03; y += R.gauss() * 0.03; ry += R.gauss() * 0.04; }
    else if (fate === 1) { ry += R.gauss() * 0.32; travel = R.range(0.15, 0.9) * (0.5 + d); if (R() < 0.14) [rx, rz] = tip(R); }
    else { ry = R() * PI * 2; travel = 40; if (R() < (tipped ?? 0.6)) [rx, rz] = tip(R, lean); }
    return drop(def, settle(def, r, x, y, ry, rx, rz, travel, turn(dir, R.gauss() * 0.45), R, fate === 2 && lean ? 0.66 : 0.86), R);
  }

  // ---- the pieces of furniture (local: x right, y up, +z towards the sitter's back) ----
  const DESK_TOP = 0x7a6a56, DESK_SEAT = 0x6d5d4b, FRAME = 0x3c4649, LAM = 0x73786d, FRAME2 = 0x32383a, CHAIR = 0x7b6953;
  function deskGeo() {                                                                                         // two-seat school desk with its bench attached
    const g = [P(1.1, 0.025, 0.42, 0, 0.725, -0.21, DESK_TOP), P(1.02, 0.015, 0.3, 0, 0.57, -0.22, 0x5d5348), P(1.02, 0.22, 0.012, 0, 0.4, -0.4, DESK_SEAT), P(1.1, 0.025, 0.25, 0, 0.42, 0.27, DESK_SEAT), P(1.1, 0.11, 0.018, 0, 0.66, 0.425, DESK_TOP)];
    for (const sx of [-0.52, 0.52]) g.push(P(0.025, 0.725, 0.025, sx, 0, -0.39, FRAME), P(0.025, 0.725, 0.025, sx, 0, -0.03, FRAME), P(0.025, 0.78, 0.025, sx, 0, 0.42, FRAME), P(0.025, 0.42, 0.025, sx, 0, 0.16, FRAME), P(0.025, 0.025, 0.84, sx, 0, 0.015, FRAME));
    return merge(g, { keepUV: false });
  }
  function tableGeo() {                                                                                        // two-seat table, used with loose chairs
    const g = [P(1.2, 0.025, 0.5, 0, 0.715, 0, LAM), P(1.1, 0.015, 0.36, 0, 0.56, 0.02, 0x565a52), P(1.1, 0.25, 0.012, 0, 0.4, -0.22, 0x5f645b)];
    for (const sx of [-0.56, 0.56]) g.push(P(0.03, 0.715, 0.03, sx, 0, -0.22, FRAME2), P(0.03, 0.715, 0.03, sx, 0, 0.22, FRAME2), P(0.025, 0.025, 0.44, sx, 0.12, 0, FRAME2));
    return merge(g, { keepUV: false });
  }
  function chairGeo() {
    const g = [P(0.4, 0.02, 0.38, 0, 0.43, 0, CHAIR), P(0.4, 0.16, 0.018, 0, 0.64, 0.19, CHAIR)];
    for (const sx of [-0.18, 0.18]) g.push(P(0.022, 0.43, 0.022, sx, 0, -0.17, FRAME2), P(0.022, 0.82, 0.022, sx, 0, 0.19, FRAME2), P(0.02, 0.02, 0.36, sx, 0.15, 0.01, FRAME2));
    return merge(g, { keepUV: false });
  }
  DEF.stool.make = () => {
    const metal = [tint(xform(new THREE.TorusGeometry(0.115, 0.008, 4, 10).rotateX(H2), 0, 0.2, 0), FRAME2)];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) metal.push(rod3(sx * 0.12, 0, sz * 0.12, sx * 0.08, 0.59, sz * 0.08, 0.011, FRAME2, 4));
    return { metal, paint: [C(0.16, 0.16, 0.03, 0, 0.59, 0, 0x6d5f4e, 10)] };
  };
  const BUCKETS = [0x5d6f72, 0x8a7f66, 0x6a6f6a, 0x77685d, 0x55606a];
  DEF.bucket.make = (R) => ({ plastic: [C(0.15, 0.11, 0.26, 0, 0, 0, R.pick(BUCKETS), 10), C(0.134, 0.134, 0.006, 0, 0.257, 0, 0x2a2d2e, 10)] });
  const BAGS = [0x4a5560, 0x5a5e4c, 0x5c4d55, 0x35393c, 0x7d705c, 0x4f5a57];
  const bagGeo = (R) => { const c = R.pick(BAGS), k = new THREE.Color(c).multiplyScalar(0.7).getHex(); return [P(0.3, 0.4, 0.14, 0, 0, 0, c), P(0.22, 0.18, 0.035, 0, 0.05, 0.08, k), P(0.31, 0.06, 0.15, 0, 0.36, 0, k), P(0.04, 0.34, 0.012, -0.08, 0.04, -0.078, 0x2b2e30), P(0.04, 0.34, 0.012, 0.08, 0.04, -0.078, 0x2b2e30)]; };
  DEF.bag.make = (R) => ({ paint: bagGeo(R) });
  const ALM = [0x56615f, 0x5f6258, 0x4f5a60];
  DEF.cupboard.make = (R) => {                                                                                 // steel cupboard
    const c = R.pick(ALM), l = new THREE.Color(c).multiplyScalar(1.12).getHex();
    return { paint: [P(0.9, 1.85, 0.45, 0, 0.05, 0, c), P(0.86, 0.05, 0.4, 0, 0, 0, 0x2a2e30), P(0.92, 0.02, 0.47, 0, 1.9, 0, c), P(0.435, 1.72, 0.012, -0.222, 0.11, 0.229, l), P(0.435, 1.72, 0.012, 0.222, 0.11, 0.229, l), P(0.015, 0.12, 0.02, -0.04, 1.0, 0.238, 0x2a2e30), P(0.015, 0.12, 0.02, 0.04, 1.0, 0.238, 0x2a2e30)] };
  };
  const BOOKS = [0x5b6a70, 0x6f5a4c, 0x4f5d52, 0x7a6f58, 0x5a5560, 0x70665a, 0x485058, 0x7d7466];
  function shelfGeo(R, w = 1.2, h = 1.5, levels = [0.08, 0.45, 0.82, 1.19]) {                                  // open shelf, back against the wall at z = 0
    const wood = [P(0.025, h, 0.3, -w / 2, 0, 0.15, 0xd8cfc0), P(0.025, h, 0.3, w / 2, 0, 0.15, 0xd8cfc0), P(w, h, 0.012, 0, 0, 0.006, 0xb9b0a2), P(w, 0.022, 0.3, 0, h - 0.022, 0.15, 0xd8cfc0)], paint = [];
    for (const y of levels) {
      wood.push(P(w - 0.02, 0.022, 0.29, 0, y, 0.15, 0xe6ddce));
      const fill = y + 0.1 > FLOOD_H ? 0.85 : y > 0.6 ? 0.3 : 0.08; let x = -w / 2 + 0.04;                     // shelves under the water lost most of their books
      while (x < w / 2 - 0.07) { const bw = R.range(0.022, 0.05); if (R() < fill) { const lean = R() < 0.12 ? R.range(-0.3, 0.3) : 0; paint.push(P(bw, R.range(0.19, 0.27), R.range(0.15, 0.2), x + bw / 2, y + 0.022, 0.13, R.pick(BOOKS), 0, 0, lean)); x += bw + 0.004 + Math.abs(lean) * 0.2; } else x += bw + R.range(0, 0.12); }
    }
    return { wood, paint };
  }
  function teacherTable() {                                                                                    // the sitter is on the +z side
    return [P(1.4, 0.03, 0.7, 0, 0.72, 0, 0xffffff), P(0.42, 0.62, 0.6, -0.45, 0.1, 0, 0xd9d0c2), P(0.42, 0.1, 0.05, -0.45, 0, -0.25, 0x9a9184), P(0.42, 0.1, 0.05, -0.45, 0, 0.25, 0x9a9184), P(0.03, 0.72, 0.6, 0.66, 0, 0, 0xd9d0c2), P(0.9, 0.4, 0.02, 0.2, 0.3, -0.3, 0xc9c0b2), P(0.36, 0.17, 0.012, -0.45, 0.5, 0.305, 0xb3aa9c), P(0.36, 0.17, 0.012, -0.45, 0.3, 0.305, 0xb3aa9c)];
  }
  function board(r, side, s) {                                                                                 // blackboard, clock above it
    onWall('wood', [P(3.12, 1.32, 0.025, 0, -0.06, 0.0125, 0x8f8576), P(3.0, 0.025, 0.07, 0, -0.045, 0.05, 0xa89e8e)], r, side, s, 0.9);
    onWall('board', [new THREE.PlaneGeometry(3, 1.2).translate(0, 0.6, 0.027)], r, side, s, 0.9);
    onWall('paint', [P(0.12, 0.035, 0.05, 0.9, -0.02, 0.05, 0x8a8577), C(0.17, 0.17, 0.035, 0, 1.72, 0, 0x2d3336, 14, 0, H2), C(0.145, 0.145, 0.038, 0, 1.72, 0, 0xb5b1a5, 14, 0, H2), P(0.012, 0.085, 0.004, 0, 1.72, 0.039, 0x23272a, 0, 0, 1.9), P(0.009, 0.12, 0.004, 0, 1.72, 0.039, 0x23272a, 0, 0, -0.75)], r, side, s, 0.9);
  }
  const CHARTS = [0x6e7f86, 0x8c8166, 0x74806c, 0x8b6f66, 0x7a7486, 0x857c6c];
  function chart(r, side, s, R, big = false) {
    const k = big ? 1.5 : 1, c = R.pick(CHARTS), rz = R() < 0.14 ? R.sign() * R.range(0.2, 0.45) : R.gauss() * 0.03;
    onWall('paint', [P(0.62 * k, 0.86 * k, 0.006, 0, 0, 0.003, 0xa7a192), P(0.52 * k, 0.6 * k, 0.004, 0, 0.08 * k, 0.007, c), P(0.52 * k, 0.07 * k, 0.004, 0, 0.73 * k, 0.007, new THREE.Color(c).multiplyScalar(0.7).getHex())], r, side, s, R.range(1.28, 1.5) - (big ? 0.3 : 0), 0, rz);
  }

  // ---- silt: low smooth mounds that never cross a wall ----
  function drift(r, x, y, rx, ry, h, rot = 0) {
    if (inRubble(x, y, 0.1)) return;
    const I = inner(r), g = new THREE.RingGeometry(0.0001, 1, 18, 5).rotateX(-H2), p = g.attributes.position, c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i), lz = p.getZ(i), rr = Math.min(1, Math.hypot(lx, lz)), a = Math.atan2(lz, lx), k = 0.74 + 0.5 * noise(Math.cos(a) * 1.3 + x * 0.7 + 11, Math.sin(a) * 1.3 + y * 0.7 + 5);
      const wx = lx * rx * k, wz = lz * ry * k, X = x + wx * c - wz * s, Z = -y + wx * s + wz * c, f = 1 - rr, hh = h * f * f * (3 - 2 * f) * (0.75 + 0.5 * noise(X * 1.7, Z * 1.7));
      p.setXYZ(i, clamp(X, I[0] + 0.004, I[2] - 0.004), FLOOR - 0.004 + hh, -clamp(-Z, I[1] + 0.004, I[3] - 0.004));
    }
    g.computeVertexNormals(); G.mud.push(worldUV(g, 0.6));
  }
  // The silt a room is left with: deep against its north and east walls, a fan in the corner the water left by.
  function silt(r, R, k = 1) {
    const I = inner(r), w = I[2] - I[0], d = I[3] - I[1];
    drift(r, I[2] - 0.2, I[3] - 0.2, 2.6 * k, 2.0 * k, 0.26 * k, R() * 3);
    for (let i = 0; i < 3; i++) { drift(r, I[0] + w * (0.2 + 0.28 * i + R.gauss() * 0.04), I[3] - 0.1, R.range(0.9, 1.6), R.range(0.6, 1.0), R.range(0.08, 0.17) * k, R.gauss() * 0.3); drift(r, I[2] - 0.1, I[1] + d * (0.22 + 0.26 * i + R.gauss() * 0.04), R.range(0.6, 1.0), R.range(0.9, 1.6), R.range(0.08, 0.17) * k, R.gauss() * 0.3); }
    drift(r, I[0] + 0.3, I[1] + 0.3, 1.9, 1.5, 0.15, R() * 3); drift(r, I[0] + 0.1, I[1] + d * R.range(0.35, 0.6), 0.7, 1.3, 0.09); drift(r, I[0] + w * R.range(0.35, 0.6), I[1] + 0.1, 1.4, 0.7, 0.09);
  }

  // ---- books and paper, flat on the floor ----
  const litter = [], PAPER = [0xb4ae9f, 0xa59f90, 0x979183, 0xbab2a0, 0x8d8779];
  function scatter(r, R, nPaper, nBook, bias = 1.7, area = null) {
    const I = area || inner(r), w = I[2] - I[0], d = I[3] - I[1], n = quality === 'low' ? 0.5 : 1;
    for (let i = 0; i < (nPaper + nBook) * n; i++) {
      const book = i >= nPaper * n, flat = R() < 0.3, x = I[0] + 0.12 + (w - 0.24) * (flat ? R() : Math.pow(R(), bias)), y = I[1] + 0.12 + (d - 0.24) * (flat ? R() : Math.pow(R(), bias));
      if (inRubble(x, y, 0.3) || (book && inKeep(x, y, 0.15))) continue;
      const th = book ? R.range(0.012, 0.028) : 0.003, s = book ? [R.range(0.14, 0.19), th, R.range(0.2, 0.26)] : [0.21, th, 0.297];
      litter.push({ m: matrix(x, FLOOR + th / 2 + 0.001 + (i % 7) * 0.0006, -y, R() * PI * 2, 0, 0, s), tone: book ? R.pick(BOOKS) : R.pick(PAPER) });
    }
  }

  // ---- a classroom ----
  function classroom(id, o) {
    const r = room(id), R = rng('interior:' + id), I = inner(r), occ = occOf(r), wl = WALL[o.wall](I, o.bc), nx = wl.nx, ny = wl.ny, ux = -ny, uy = nx, yaw = yawOut(nx, ny), d = o.d;
    board(r, o.wall, o.bc);
    // heavy things first: they stay, a little askew, and the rest piles against them
    const tt = o.teacher || [wl.x + ux * 1.0 + nx * 1.55 + FLOW[0] * d * 0.5, wl.y + uy * 1.0 + ny * 1.55 + FLOW[1] * d * 0.5, yaw + PI + R.gauss() * 0.12 * (1 + d)];
    place('wood', teacherTable(), tt[0], tt[1], tt[2]); occ.push({ x: tt[0], y: tt[1], r: 0.62 });
    for (const [side, s] of o.cupboards || []) { const a = R.gauss() * 0.05, off = 0.25 + Math.abs(a) * 0.5, w = WALL[side](I, s), parts = DEF.cupboard.make(R); place('paint', parts.paint, w.x + w.nx * off, w.y + w.ny * off, yawOut(w.nx, w.ny) + a); occ.push({ x: w.x + w.nx * 0.3, y: w.y + w.ny * 0.3, r: 0.5 }); }
    for (const [side, s] of o.shelves || []) { const parts = shelfGeo(R), w = onWall('wood', parts.wood, r, side, s, FLOOR); onWall('paint', parts.paint, r, side, s, FLOOR); for (const k of [-0.32, 0.32]) occ.push({ x: w.x + w.nx * 0.2 - w.ny * k, y: w.y + w.ny * 0.2 + w.nx * k, r: 0.36 }); }
    for (const [side, s] of o.charts || []) chart(r, side, s, R);
    for (const p of o.block || []) occ.push({ x: p[0], y: p[1], r: p[2] });
    // the rows
    const horiz = o.wall === 'N' || o.wall === 'S', cc = o.cc ?? (horiz ? (I[0] + I[2]) / 2 : (I[1] + I[3]) / 2), pc = o.pc || 1.6, pv = o.kind === 'table' ? 1.3 : 1.2, items = [];
    for (let k = 0; k < o.rows; k++) for (let j = 0; j < o.cols; j++) {
      const v = (o.v0 || 2.9) + k * pv, s = cc + (j - (o.cols - 1) / 2) * pc, x = horiz ? s : wl.x + nx * v, y = horiz ? wl.y + ny * v : s;
      if (o.only && !o.only(x, y)) continue;
      const q = ((x - I[0]) / (I[2] - I[0]) + (y - I[1]) / (I[3] - I[1])) / 2;                                 // 1 in the north-east corner, where the water came in
      if (o.kind === 'table') { items.push({ def: DEF.table, x, y, q }); for (const e of [-0.3, 0.3]) items.push({ def: DEF.chair, x: x + ux * e + nx * 0.5, y: y + uy * e + ny * 0.5, q, light: 1 }); }
      else items.push({ def: DEF.desk, x, y, q });
    }
    items.push({ def: DEF.chair, x: tt[0] + nx * -0.6, y: tt[1] + ny * -0.6, q: 0.5, light: 1, back: 1 });
    for (const e of o.extra || []) items.push({ def: DEF[e[0]], x: e[1], y: e[2], q: 1, light: 1, fate: 2 });
    for (const it of items) { const p = d * (0.22 + 0.95 * it.q) * (it.light ? 1.6 : 1), u = R(); it.fate = it.fate ?? (u < p ? 2 : u < p + 0.12 + 0.35 * d ? 1 : 0); }
    items.sort((a, b) => a.fate - b.fate || a.q - b.q);
    for (const it of items) loose(it.def, r, it.x, it.y, yaw + (it.back ? PI : 0), it.fate, R, { dir: o.flow || FLOW, d, lean: it.light ? 0.3 : 0, tipped: it.light ? 0.8 : 0.6 });
    // what floated: bags and buckets, wherever the water left them
    for (let i = 0; i < (o.bags ?? 4); i++) loose(DEF.bag, r, R.range(I[0] + 1, I[2] - 1), R.range(I[1] + 1, I[3] - 1), 0, 2, R, { dir: o.flow || FLOW, tipped: 0.9 });
    for (let i = 0; i < (o.buckets ?? 1); i++) loose(DEF.bucket, r, R.range(I[0] + 1, I[2] - 1), R.range(I[1] + 1, I[3] - 1), 0, 2, R, { dir: o.flow || FLOW, tipped: 0.6 });
    silt(r, R, o.silt || 1); scatter(r, R, o.paper ?? 70, o.books ?? 34);
  }

  // ---- room 103: the desks jammed into a heap across the room, the rest against the south wall ----
  {
    const r = room('103'), R = rng('interior:heap'), occ = occOf(r), ob = world.OBSTACLES.find((q) => q.id === 'desk-103'), bx = ob ? ob.poly[0][0] : 69, by = ob ? ob.poly[0][1] : 35.5;
    const heap = [[0.58, 0.16, 0.1, -H2, 0], [1.44, 0.55, 3.3, 0, PI], [2.28, 0.96, -0.08, H2, 0], [3.1, 0.94, 3.22, -H2, 0], [3.93, 0.56, 0.1, 0, PI]];   // x, y in the heap, yaw, pose
    for (const [hx, hy, ry, rx, rz] of heap) { DEF.desk.list.push({ m: rest(DEF.desk, bx + hx, by + hy, ry, rx + R.gauss() * 0.03, rz + R.gauss() * 0.03).m, tone: R.pick(TONES) }); }
    for (const [hx, hy, ry, rx] of [[1.9, 0.28, 0.3, -1.05], [2.75, 0.86, 3.0, -0.95]]) DEF.desk.list.push({ m: rest(DEF.desk, bx + hx, by + hy, ry, rx, R.gauss() * 0.08).m, tone: R.pick(TONES) });
    for (const [hx, hy, fl] of [[1.1, 0.5, 0.86], [2.9, 0.62, 0.8], [3.8, 0.5, 0.8]]) { const [rx, rz] = tip(R); DEF.chair.list.push({ m: rest(DEF.chair, bx + hx, by + hy, R() * 6, rx, rz, fl).m, tone: R.pick(TONES) }); }
    for (let i = 0; i < 6; i++) occ.push({ x: bx + 0.35 + i * 0.76, y: by + 0.55, r: 0.62 });
    occ.push({ x: 66.95, y: 33.4, r: 0.95 });                                                                  // the entrance door leaf that was carried in here
    label('Overturned desks', { sub: 'Room 103', tone: 'muted', priority: 1, maxDist: 32, position: new THREE.Vector3(bx + 2.25, 1.35, -(by + 0.55)) });
  }
  classroom('103', { wall: 'E', bc: 38, kind: 'desk', d: 3, cols: 6, rows: 4, cc: 35.6, flow: [-0.28, -0.96], only: (x, y) => y < 35, teacher: [73.25, 38.5, yawOut(-1, 0) + PI + 0.3], cupboards: [['N', 73.6]], shelves: [['N', 67.9]], charts: [['E', 34.4], ['E', 40.7], ['W', 35.2], ['W', 33.6]],
    extra: [['desk', 68.2, 34.6], ['desk', 73.6, 34.2], ['desk', 72.6, 33], ['chair', 68, 33], ['chair', 72, 34], ['chair', 70, 33.6], ['chair', 73.8, 32.6]], bags: 6, buckets: 2, books: 46 });
  classroom('101', { wall: 'E', bc: 36, kind: 'desk', d: 0.3, cols: 6, rows: 4, cc: 35.6, cupboards: [['N', 51.3]], shelves: [['N', 46.2]], charts: [['E', 32.9], ['E', 39.2], ['W', 34], ['W', 38]] });
  const fanTable = [56.55, 38.62, PI + 0.22];
  classroom('102', { wall: 'N', bc: 55, kind: 'table', d: 0.34, cols: 5, rows: 5, v0: 4.6, teacher: fanTable, cupboards: [['W', 40.4]], shelves: [['E', 40.95]], charts: [['N', 59.5], ['N', 60.7], ['W', 34.6], ['W', 37.2]] });
  classroom('104', { wall: 'W', bc: 36, kind: 'desk', d: 0.68, cols: 6, rows: 4, cc: 35.6, cupboards: [['N', 77.1]], shelves: [['N', 82.4]], charts: [['W', 32.9], ['W', 39.2], ['E', 34], ['E', 38]], silt: 1.25, bags: 5, buckets: 2 });
  classroom('109', { wall: 'E', bc: 52, kind: 'desk', d: 0.42, cols: 6, rows: 5, cc: 52.4, cupboards: [['S', 51.5]], shelves: [['S', 46.1]], charts: [['E', 48.9], ['E', 55.2], ['W', 50], ['W', 54]] });
  classroom('111', { wall: 'W', bc: 52.9, kind: 'table', d: 0.72, cols: 5, rows: 4, cc: 53.2, cupboards: [['S', 68.1]], shelves: [['W', 56.3]], charts: [['W', 50.6], ['S', 72.6], ['S', 73.7]], silt: 1.15, bags: 5 });
  classroom('112', { wall: 'S', bc: 77, kind: 'desk', d: 1.6, cols: 5, rows: 6, cc: 79.3, charts: [['S', 81.6], ['S', 82.7]], silt: 1.6, bags: 6, buckets: 2, paper: 90, books: 50,
    block: [[77.0, 55.1, 0.6], [77.35, 55.9, 0.6]], extra: [['chair', 76, 56.5], ['chair', 77, 57], ['chair', 76.4, 53.6], ['chair', 79, 49.4]] });
  {                                                                                                            // 112's steel cupboard went over on its back
    const R = rng('interior:112b'), parts = DEF.cupboard.make(R), q = rest(DEF.cupboard, 76.75, 54.25, -0.4, -H2 + 0.04, 0.03);
    for (const g of parts.paint) G.paint.push(g.applyMatrix4(q.m));
    drift(room('112'), 79.2, 53.2, 2.2, 1.6, 0.42, 0.6); drift(room('112'), 77.6, 57.3, 1.8, 1.2, 0.36, 0.2); drift(room('112'), 82.6, 48.6, 1.6, 1.9, 0.34, 1);
  }

  // ---- the desk fan on the teacher's table in 102 ----
  const fanAt = loc(fanTable[0], fanTable[1], fanTable[2], -0.45, -0.2), fanYaw = 0.35, fanH = FLOOR + 0.75;
  {
    const c = 0x8d9291, g = [C(0.1, 0.11, 0.02, 0, 0, 0, c, 14), C(0.014, 0.018, 0.2, 0, 0.02, 0, c, 6), C(0.05, 0.045, 0.1, 0, 0.27, -0.07, 0x767b7b, 10, 0, H2)];
    for (const [z, rr] of [[0.035, 0.15], [0.075, 0.15], [0.09, 0.05]]) g.push(tint(new THREE.TorusGeometry(rr, 0.005, 4, 18).translate(0, 0.27, z), 0x5d6263));
    for (let i = 0; i < 10; i++) { const a = (i / 10) * PI * 2; g.push(rod3(Math.cos(a) * 0.05, 0.27 + Math.sin(a) * 0.05, 0.09, Math.cos(a) * 0.15, 0.27 + Math.sin(a) * 0.15, 0.075, 0.003, 0x5d6263, 3)); }
    place('plastic', g, fanAt[0], fanAt[1], fanYaw, fanH);
  }

  // ---- the science lab, 110 ----
  {
    const r = room('110'), R = rng('interior:110'), I = inner(r), occ = occOf(r), CON = [];
    board(r, 'S', 54.9); chart(r, 'E', 52.4, R, true); chart(r, 'E', 54.4, R); chart(r, 'S', 59.3, R);
    const COPPER = 0x6b5646, STEEL = 0x7c8386, sink = (x, y, ry) => {
      place('metal', [P(0.5, 0.014, 0.4, 0, 0.91, 0, STEEL), rod3(0, 0.92, -0.16, 0, 1.16, -0.16, 0.012, STEEL), rod3(0, 1.16, -0.16, 0, 1.16, -0.05, 0.012, STEEL), rod3(0, 1.16, -0.05, 0, 1.12, -0.05, 0.012, STEEL)], x, y, ry, FLOOR);
      place('paint', [P(0.42, 0.016, 0.3, 0, 0.91, 0.01, 0x1c2022)], x, y, ry, FLOOR);
    };
    for (const bx of [55.6, 58.35]) {                                                                          // two fixed island benches, running north
      const y0 = 51.4, y1 = 56.0, len = y1 - y0, ym = (y0 + y1) / 2;
      for (const y of [y0 + 0.4, ym, y1 - 0.4]) CON.push(box(0.6, 0.84, 0.5, bx, FLOOR, -y));
      CON.push(box(0.76, 0.07, len, bx, FLOOR + 0.84, -ym), box(0.56, 0.04, len - 0.5, bx, FLOOR + 0.28, -ym));
      sink(bx, y1 - 0.45, 0); sink(bx, y0 + 0.45, PI);
      for (let i = 0; i < 4; i++) occ.push({ x: bx, y: y0 + 0.4 + i * (len - 0.8) / 3, r: 0.5 });
    }
    // the demonstration bench by the door, with the hot-water run on its upstand and the boiler at its east end
    CON.push(box(3.3, 0.84, 0.6, 57.6, FLOOR, -49.8), box(3.5, 0.07, 0.76, 57.6, FLOOR + 0.84, -49.8), box(3.5, 0.26, 0.08, 57.6, FLOOR + 0.91, -50.14), box(0.52, 0.1, 0.52, 59.9, FLOOR, -49.8));
    for (let i = 0; i < 5; i++) occ.push({ x: 56.0 + i * 0.8, y: 49.8, r: 0.52 }); occ.push({ x: 59.9, y: 49.8, r: 0.4 });
    sink(56.5, 49.75, PI);
    const ph = FLOOR + 1.05, py = 50.075, top = 2.42;
    G.metal.push(rod(55.95, py, ph, 59.45, py, ph, 0.02, COPPER), rod(56.7, py, ph, 57.75, py, ph, 0.036, 0x8a867b, 8), rod(58.6, py, ph, 59.2, py, ph, 0.036, 0x8a867b, 8), rod(59.45, py, ph, 59.9, 49.98, ph, 0.02, COPPER), rod(59.9, 49.98, ph, 59.9, 49.9, FLOOR + 0.98, 0.02, COPPER),
      C(0.035, 0.035, 0.05, 58.2, ph - 0.025, -py, 0x4a4f52, 8), P(0.09, 0.012, 0.02, 58.2, ph + 0.035, -py, 0x4a4f52),
      C(0.2, 0.2, 0.8, 59.9, FLOOR + 0.1, -49.8, 0x8e8f88, 14), C(0.07, 0.2, 0.08, 59.9, FLOOR + 0.9, -49.8, 0x8e8f88, 14), C(0.205, 0.205, 0.03, 59.9, FLOOR + 0.2, -49.8, 0x5d6263, 14), C(0.205, 0.205, 0.03, 59.9, FLOOR + 0.78, -49.8, 0x5d6263, 14), P(0.13, 0.17, 0.05, 59.9, FLOOR + 0.42, -49.59, 0x2c3033),
      rod(60.08, 50.0, FLOOR + 0.16, 61.86, 50.0, FLOOR + 0.16, 0.02, COPPER), rod(61.86, 50.0, FLOOR + 0.16, 61.86, 50.0, top, 0.02, COPPER), rod(61.86, 50.0, top, 61.86, 57.77, top, 0.02, COPPER), rod(61.86, 57.77, top, 57.0, 57.77, top, 0.02, COPPER), rod(57.0, 57.77, top, 57.0, 57.77, 1.2, 0.02, COPPER),
      rod(61.86, 51.2, top, 61.86, 53.4, top, 0.036, 0x8a867b, 8), rod(60.9, 57.77, top, 58.9, 57.77, top, 0.036, 0x8a867b, 8), P(0.09, 0.012, 0.02, 57.0, 1.2, -57.75, 0x4a4f52));
    for (const y of [51, 53.6, 56.2]) G.metal.push(P(0.07, 0.03, 0.05, 61.9, top - 0.04, -y, 0x4a4f52)); for (const x of [58.2, 60, 61.2]) G.metal.push(P(0.05, 0.03, 0.07, x, top - 0.04, -57.8, 0x4a4f52));
    for (const x of [60.6, 61.3]) CON.push(box(0.12, 0.13, 0.12, x, FLOOR, -50.0));
    G.paint.push(P(0.46, 0.16, 0.36, 57.0, 0.78, -57.64, 0xa5a398), P(0.36, 0.165, 0.26, 57.0, 0.78, -57.63, 0x33383a));     // wall sink under the tap
    // two gas cylinders chained to the north wall
    const CYL = [0x59635c, 0x676556];
    for (const [i, x] of [58.28, 58.6].entries()) {
      const y = I[3] - 0.15 - i * 0.015, c = CYL[i];
      G.metal.push(C(0.118, 0.118, 1.12, x, FLOOR, -y, c, 14), C(0.05, 0.118, 0.12, x, FLOOR + 1.12, -y, c, 14), C(0.122, 0.122, 0.035, x, FLOOR, -y, 0x2f3335, 14), C(0.028, 0.028, 0.07, x, FLOOR + 1.24, -y, 0x8a8468, 8), P(0.07, 0.03, 0.03, x + 0.03, FLOOR + 1.3, -y, 0x8a8468),
        tint(xform(new THREE.TorusGeometry(0.075, 0.009, 4, 12).rotateX(H2), x, FLOOR + 1.36, -y), 0x2f3335), rod(x - 0.06, y, FLOOR + 1.22, x - 0.07, y, FLOOR + 1.36, 0.008, 0x2f3335, 4), rod(x + 0.06, y, FLOOR + 1.22, x + 0.07, y, FLOOR + 1.36, 0.008, 0x2f3335, 4));
      occ.push({ x, y, r: 0.3 });
    }
    const cy = I[3] - 0.29, ch = FLOOR + 0.86;
    G.metal.push(U.tube([new THREE.Vector3(58.08, ch + 0.04, -I[3]), new THREE.Vector3(58.13, ch, -cy - 0.02), new THREE.Vector3(58.28, ch - 0.02, -cy + 0.02), new THREE.Vector3(58.44, ch - 0.035, -cy), new THREE.Vector3(58.6, ch - 0.02, -cy + 0.01), new THREE.Vector3(58.75, ch, -cy - 0.02), new THREE.Vector3(58.79, ch + 0.04, -I[3])], 0.009, { radial: 4, segs: 20 }), P(0.05, 0.08, 0.03, 58.08, ch, -I[3] + 0.015, 0x2f3335), P(0.05, 0.08, 0.03, 58.79, ch, -I[3] + 0.015, 0x2f3335));
    label('Gas cylinders', { sub: 'Lab 110, chained to the wall', tone: 'warn', priority: 2, maxDist: 30, position: new THREE.Vector3(58.44, 1.75, -cy) });
    // the shelf of jars on the west wall; the lower rows went with the water
    const JAR = [0x8c8672, 0x6f7d78, 0x7b6c58, 0x9a988c, 0x5e6a6e, 0x857a5a], sw = 3.2, sh = 1.85, sy = 53.2, wood = [P(0.03, sh, 0.32, -sw / 2, 0, 0.16, 0xd8cfc0), P(0.03, sh, 0.32, sw / 2, 0, 0.16, 0xd8cfc0), P(0.03, sh, 0.3, 0, 0, 0.16, 0xd8cfc0), P(sw, sh, 0.012, 0, 0, 0.006, 0xb9b0a2)], jars = [];
    for (const y of [0.1, 0.5, 0.9, 1.3, 1.62]) {
      wood.push(P(sw, 0.024, 0.31, 0, y, 0.16, 0xe6ddce)); if (y > 1.7) continue;
      const fill = y + 0.05 > FLOOD_H ? 0.86 : y > 0.8 ? 0.22 : 0.06;
      for (let x = -sw / 2 + 0.1; x < sw / 2 - 0.08; x += R.range(0.1, 0.15)) for (const z of [0.1, 0.22]) { if (Math.abs(x) < 0.07 || R() > fill) continue; const jr = R.range(0.032, 0.048), jh = R.range(0.09, 0.19), c = R.pick(JAR); jars.push(C(jr, jr, jh, x, y + 0.024, z, c, 7), C(jr * 0.8, jr * 0.8, 0.018, x, y + 0.024 + jh, z, 0x2f3335, 7)); }
    }
    onWall('wood', wood, r, 'W', sy, FLOOR); onWall('plastic', jars, r, 'W', sy, FLOOR); for (let i = 0; i < 5; i++) occ.push({ x: I[0] + 0.2, y: sy - 1.4 + i * 0.7, r: 0.4 });
    for (let i = 0; i < 9; i++) { const jr = R.range(0.035, 0.048), jh = R.range(0.1, 0.18), x = I[0] + 0.3 + Math.pow(R(), 1.6) * 3.4, y = I[1] + 0.3 + Math.pow(R(), 1.4) * 5; if (inKeep(x, y, 0.1)) continue; place('plastic', [C(jr, jr, jh, 0, -jh / 2, 0, R.pick(JAR), 7)], x, y, R() * 6, FLOOR + jr, H2); }   // jars on the floor, rolled to the low side
    { const a = R.gauss() * 0.04, parts = DEF.cupboard.make(R); place('paint', parts.paint, 60.7, I[1] + 0.27, a); occ.push({ x: 60.7, y: I[1] + 0.3, r: 0.5 }); }
    for (const bx of [55.6, 58.35]) for (const e of [-0.64, 0.64]) for (const y of [52.0, 53.15, 54.3, 55.45]) { const u = R(); loose(DEF.stool, r, bx + e, y, R() * 6, u < 0.4 ? 2 : u < 0.7 ? 1 : 0, R, { d: 0.5, tipped: 0.85 }); }
    for (const [x, y] of [[57.2, 49.0], [58.3, 49.1]]) loose(DEF.stool, r, x, y, 0, R() < 0.5 ? 1 : 2, R, { tipped: 0.8 });
    for (let i = 0; i < 3; i++) loose(DEF.bucket, r, R.range(54, 61), R.range(51, 57), 0, 2, R, { tipped: 0.6 });
    for (let i = 0; i < 2; i++) loose(DEF.bag, r, R.range(54, 61), R.range(51, 57), 0, 2, R, { tipped: 0.9 });
    for (const g of CON) G.concrete.push(worldUV(g, 0.3));
    silt(r, R, 1.1); scatter(r, R, 46, 18);
  }

  // ---- corridor and entrance hall: fittings along the walls, the lane left clear ----
  {
    const R = rng('interior:corridor'), cor = room('C-EW'), hall = room('C-S'), IC = inner(cor), IH = inner(hall);
    // a rail of hooks with the bags that were hung high enough, between the doors of 109 and 110
    onWall('wood', [P(3.9, 0.08, 0.022, 0, 0, 0.011, 0xcfc6b8)], cor, 'N', 53, 1.5);
    const hooks = [];
    for (let i = 0; i < 10; i++) { const x = -1.71 + i * 0.38; hooks.push(P(0.012, 0.012, 0.06, x, 0.03, 0.05, 0x3a3f42), P(0.012, 0.04, 0.012, x, 0.03, 0.08, 0x3a3f42)); }
    onWall('metal', hooks, cor, 'N', 53, 1.5);
    for (const i of [0, 2, 3, 6, 9]) onWall('paint', bagGeo(R), cor, 'N', 53 + (-1.71 + i * 0.38), 1.5 - 0.39 + R.gauss() * 0.01, 0.1, R.gauss() * 0.07);
    for (const x of [51.9, 54.2]) drop(DEF.bag, { m: rest(DEF.bag, x, IC[3] - 0.24, R() * 6, H2, R.gauss() * 0.1).m }, R);
    // the bench between the stairwell and 111, knocked askew
    place('wood', [P(1.8, 0.04, 0.34, 0, 0.41, 0, 0xffffff), P(0.04, 0.41, 0.3, -0.75, 0, 0, 0xd9d0c2), P(0.04, 0.41, 0.3, 0.75, 0, 0, 0xd9d0c2), P(1.46, 0.08, 0.03, 0, 0.2, 0, 0xc9c0b2)], 68.1, IC[3] - 0.3, 0.07);
    // the water filter on its stand, by the hall
    const fx = 60.35, fy = IC[1] + 0.3, STD = 0x4a5154, fm = [P(0.44, 0.02, 0.44, 0, 0.75, 0, STD), P(0.4, 0.015, 0.4, 0, 0.3, 0, STD)];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) fm.push(P(0.025, 0.75, 0.025, sx * 0.2, 0, sz * 0.2, STD));
    place('metal', fm, fx, fy, 0.12);
    place('plastic', [C(0.15, 0.15, 0.27, 0, 0.77, 0, 0x8d9795, 14), C(0.155, 0.155, 0.02, 0, 1.04, 0, 0x6a7372, 14), C(0.15, 0.15, 0.26, 0, 1.06, 0, 0xa9a89d, 14), C(0.07, 0.155, 0.05, 0, 1.32, 0, 0x6a7372, 14), C(0.03, 0.03, 0.03, 0, 1.37, 0, 0x6a7372, 8), P(0.03, 0.03, 0.06, 0, 0.82, -0.17, 0x3a3f42)], fx, fy, 0.12 + PI);
    place('metal', [C(0.035, 0.03, 0.08, 0.14, 0.77, -0.14, 0x8d9498, 8)], fx, fy, 0.12);
    // the notice board on the hall's west wall
    const nb = [P(2.4, 1.1, 0.02, 0, 0, 0.01, 0x75664f), P(2.48, 0.04, 0.035, 0, -0.04, 0.0175, 0x4d4a44), P(2.48, 0.04, 0.035, 0, 1.1, 0.0175, 0x4d4a44), P(0.04, 1.1, 0.035, -1.22, 0, 0.0175, 0x4d4a44), P(0.04, 1.1, 0.035, 1.22, 0, 0.0175, 0x4d4a44)];
    for (let i = 0; i < 13; i++) { const w = R.range(0.16, 0.3), h = R.range(0.2, 0.36), x = R.range(-1.02, 1.02), y = R.range(0.22, 1.06 - h); nb.push(P(w, h, 0.003, x, y, 0.021 + i * 0.0006, R.pick(PAPER), 0, 0, R.gauss() * 0.06)); }
    onWall('paint', nb, hall, 'W', 34.2, 1.0);
    // the shoe rack on the east wall, with the pairs that stayed on its top shelves
    const rk = [P(1.5, 0.012, 0.28, 0, 0.12, 0.16, STD), P(1.5, 0.012, 0.28, 0, 0.41, 0.16, STD), P(1.5, 0.012, 0.28, 0, 0.7, 0.16, STD)], sh = [], SHOE = [0x2c2f31, 0x3d3a36, 0x4a4f55, 0x5a5348, 0x35393c];
    for (const [sx, sz] of [[-1, 0.03], [1, 0.03], [1, 0.29], [-1, 0.29]]) rk.push(P(0.02, 0.74, 0.02, sx * 0.74, 0, sz, STD));
    for (const [y, fill] of [[0.712, 0.75], [0.422, 0.3]]) for (let x = -0.62; x < 0.64; x += 0.25) { if (R() > fill) continue; const c = R.pick(SHOE); for (const e of [-0.05, 0.05]) sh.push(P(0.085, 0.06, 0.23, x + e, y, 0.16 + R.gauss() * 0.01, c, R.gauss() * 0.08)); }
    onWall('metal', rk, hall, 'E', 33, FLOOR, 0.06, 0, 0.06); onWall('paint', sh, hall, 'E', 33, FLOOR, 0.06, 0, 0.06);
    for (let i = 0; i < 9; i++) { const x = IH[0] + 0.12 + R() * 0.62, y = IH[1] + 0.15 + Math.pow(R(), 1.5) * 6; place('paint', [P(0.085, 0.06, 0.23, 0, 0, 0, R.pick(SHOE))], x, y, R() * 6); }    // shoes washed to the west side
    place('paint', [P(1.5, 0.014, 0.85, 0, 0, 0, 0x2b2d2e)], 63.5, 31.9, 0.42);                                // the door mat, pushed off square
    // the fire extinguisher on its bracket
    onWall('metal', [C(0.07, 0.07, 0.4, 0, 0, 0.09, 0x7b4038, 12), C(0.03, 0.07, 0.05, 0, 0.4, 0.09, 0x7b4038, 12), C(0.02, 0.02, 0.05, 0, 0.45, 0.09, 0x2a2d2f, 8), P(0.02, 0.02, 0.1, 0, 0.5, 0.11, 0x2a2d2f), rod3(0.02, 0.47, 0.09, 0.09, 0.2, 0.1, 0.008, 0x1f2223, 4), P(0.16, 0.03, 0.04, 0, 0.2, 0.02, 0x3a3f42), P(0.2, 0.28, 0.006, 0, 0.7, 0.003, 0x9c988c)], hall, 'E', 35.7, 1.0);
    // what the water left at the west end of the corridor, and behind the blockage at its east end
    for (let i = 0; i < 7; i++) loose(DEF.chair, cor, R.range(44.6, 46.1), R.range(42.5, 45.5), 0, 2, R, { dir: [-0.97, -0.24], lean: 0.3, tipped: 0.85 });
    for (let i = 0; i < 3; i++) loose(DEF.bag, cor, R.range(44.6, 46.1), R.range(42.5, 45.5), 0, 2, R, { dir: [-0.97, -0.24], tipped: 0.9 });
    for (let i = 0; i < 3; i++) loose(DEF.bucket, cor, R.range(44.6, 46.1), R.range(42.5, 45.5), 0, 2, R, { dir: [-0.97, -0.24], tipped: 0.6 });
    for (let i = 0; i < 2; i++) loose(DEF.desk, cor, R.range(80.6, 83), R.range(43, 45.2), 0, 2, R, { dir: [-0.97, -0.24], tipped: 0.8 });
    for (let i = 0; i < 5; i++) loose(DEF.chair, cor, R.range(80.2, 83.4), R.range(42.5, 45.5), 0, 2, R, { dir: [-0.97, -0.24], lean: 0.3, tipped: 0.85 });
    drift(cor, IC[2] - 0.2, IC[3] - 0.2, 2.4, 1.8, 0.3, 0.4); drift(cor, 81.5, IC[1] + 0.1, 1.5, 1.0, 0.16); drift(cor, IC[0] + 0.3, IC[1] + 0.4, 1.6, 1.2, 0.13); drift(cor, IC[0] + 0.2, IC[3] - 0.2, 1.0, 0.7, 0.08);
    for (const x of [51.5, 59.6, 67.6, 73.4]) drift(cor, x + R.gauss() * 0.5, IC[3] - 0.05, R.range(0.9, 1.5), 0.55, R.range(0.05, 0.09)); for (const x of [53, 61, 68.5]) drift(cor, x + R.gauss() * 0.5, IC[1] + 0.05, R.range(0.9, 1.4), 0.5, R.range(0.04, 0.07));
    drift(hall, IH[0] + 0.15, IH[1] + 0.2, 0.75, 1.3, 0.1); drift(hall, IH[2] - 0.1, 36.8, 0.6, 1.2, 0.08); drift(hall, IH[2] - 0.1, IH[1] + 0.3, 0.7, 0.9, 0.07);
    scatter(cor, R, 70, 12, 1.3, [44.2, 42.1, 76, 45.9]); scatter(cor, R, 30, 10, 1.2, [79.6, 42.1, 83.8, 45.9]); scatter(hall, R, 26, 5, 1.4, [62.1, 30.2, 65.9, 42]);
  }

  // ---- the north stair: a flight up the east side to a half landing, back down the west side to the roof head ----
  {
    const st = room('C-N'), I = inner(st), R = rng('interior:stair'), CON = [], RISE = 0.17, GO = 0.28, N = 10, y0 = 53.3, yL = y0 + N * GO, xe = 65.07, xw = 62.93, wd = 1.6, STEEL = 0x596064;
    for (let i = 0; i < N; i++) CON.push(box(wd, (i + 1) * RISE, GO, xe, FLOOR, -(y0 + (i + 0.5) * GO)));
    const hL = FLOOR + N * RISE; CON.push(box(I[2] - I[0], 0.18, I[3] - yL, (I[0] + I[2]) / 2, hL - 0.18, -(yL + I[3]) / 2));
    for (let j = 0; j < N; j++) CON.push(box(wd, RISE, GO + 0.02, xw, hL + j * RISE, -(yL - (j + 0.5) * GO)));
    CON.push(xform(new THREE.BoxGeometry(wd, 0.14, Math.hypot(N * GO, N * RISE) + 0.1), xw, hL + N * RISE / 2 - 0.085, -(yL - N * GO / 2), 0, -Math.atan2(RISE, GO)));
    for (const g of CON) G.concrete.push(worldUV(g, 0.3));
    const xi = xe - wd / 2 + 0.04, xj = xw + wd / 2 - 0.04, top = hL + N * RISE;
    for (const hh of [0.9, 0.47]) G.metal.push(rod(xi, y0 + 0.14, FLOOR + RISE + hh, xi, yL - 0.1, hL + hh, hh > 0.5 ? 0.022 : 0.012, STEEL), rod(xi, yL - 0.1, hL + hh, xj, yL - 0.1, hL + hh, hh > 0.5 ? 0.022 : 0.012, STEEL), rod(xj, yL - 0.1, hL + hh, xj, y0 + 0.14, top + hh, hh > 0.5 ? 0.022 : 0.012, STEEL));
    for (const i of [0, 3, 6]) { const y = y0 + (i + 0.5) * GO, h = FLOOR + (i + 1) * RISE; G.metal.push(rod(xi, y, h, xi, y, h + 0.9, 0.016, STEEL)); const y2 = yL - (i + 0.5) * GO - (i ? 0 : 0.0), h2 = hL + (i + 1) * RISE; if (i) G.metal.push(rod(xj, y2, h2, xj, y2, h2 + 0.9, 0.016, STEEL)); }
    G.metal.push(rod(xi, yL - 0.1, hL, xi, yL - 0.1, hL + 0.9, 0.016, STEEL), rod(xj, yL - 0.1, hL, xj, yL - 0.1, hL + 0.9, 0.016, STEEL), rod(xj, y0 + 0.14, top, xj, y0 + 0.14, top + 0.9, 0.016, STEEL));
    drift(st, I[2] - 0.2, y0 - 0.3, 1.3, 1.1, 0.16); drift(st, I[0] + 0.3, yL - 0.4, 1.4, 1.6, 0.2, 0.5); drift(st, I[0] + 0.2, 51.2, 0.7, 1.0, 0.08);
    occOf(st).push({ x: xe, y: y0 + 1.4, r: 1.5 });
    for (let i = 0; i < 2; i++) loose(DEF.bucket, st, R.range(62.5, 63.6), R.range(51.5, 55.5), 0, 2, R, { tipped: 0.7 });
    loose(DEF.chair, st, 63, 54.6, 0, 2, R, { tipped: 1 });
    scatter(st, R, 16, 4, 1.4, [62.1, 46.1, 65.9, 53.2]);
  }

  // ---- assemble: one mesh per material, the repeats instanced ----
  const own = { paint: siltify(mats.paint.clone()), wood: siltify(mats.wood.clone()), metal: siltify(mats.metalPaint.clone()), plastic: siltify(mats.plastic.clone()), concrete: siltify(mats.concrete.clone()), board: new THREE.MeshStandardMaterial({ map: tex.board().map, roughness: 0.88 }) };
  own.wood.vertexColors = true;
  const add = (o) => { group.add(o); return o; };
  for (const [k, mat, uv, col] of [['paint', own.paint, false, true], ['wood', own.wood, true, true], ['metal', own.metal, false, true], ['plastic', own.plastic, false, true], ['concrete', own.concrete, true, false], ['board', own.board, true, false], ['mud', mats.mud, true, false]]) {
    if (G[k].length) add(mesh(merge(G[k], { keepUV: uv, keepColor: col }), mat, { name: 'interior-' + k, cast: k !== 'mud' && k !== 'board' }));
  }
  for (const [k, geo] of [['desk', deskGeo()], ['table', tableGeo()], ['chair', chairGeo()]]) { const l = DEF[k].list; if (l.length) add(instanced(geo, own.paint, l.map((e) => e.m), { colors: l.map((e) => e.tone), name: 'interior-' + k + 's' })); else geo.dispose(); }
  if (litter.length) add(instanced(tint(new THREE.BoxGeometry(1, 1, 1), 0xffffff), own.paint, litter.map((e) => e.m), { colors: litter.map((e) => e.tone), cast: false, name: 'interior-litter' }));

  // the fan's blades are the one thing in here that moves
  const bl = [C(0.03, 0.03, 0.04, 0, -0.02, 0, 0x6f7475, 8, 0, H2)];
  for (let i = 0; i < 3; i++) bl.push(tint(new THREE.BoxGeometry(0.06, 0.1, 0.004).rotateY(0.35).translate(0, 0.078, 0).rotateZ((i * PI * 2) / 3), 0x84898a));
  const blades = add(mesh(merge(bl, { keepUV: false }), own.plastic, { name: 'interior-fan' })), hub = loc(fanAt[0], fanAt[1], fanYaw, 0, 0.055);
  blades.position.set(hub[0], fanH + 0.27, -hub[1]); blades.rotation.set(0, fanYaw, 0.4, 'YXZ'); blades.updateMatrix();

  let tris = 0, calls = 0; group.traverse((o) => { if (o.isMesh) { calls++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } });
  group.userData.stats = { calls, triangles: Math.round(tris) };
  console.error('INTERIOR STATS ' + JSON.stringify(group.userData.stats) + ' desks ' + DEF.desk.list.length + ' tables ' + DEF.table.list.length + ' chairs ' + DEF.chair.list.length + ' litter ' + litter.length);

  return {
    group,
    update(dt) { if (t.reduced) return; blades.rotation.z += dt * 16; blades.updateMatrix(); },
    dispose() { for (const m of Object.values(own)) m.dispose(); },
  };
}
