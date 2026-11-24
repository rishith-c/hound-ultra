// Simulated lidar. Builds a detailed 3-D description of the exercise site from app/core/world.js (walls with
// windows and lintels, roof, furniture, rubble heaps and slabs, trees, vehicles, terrain), then flies a virtual
// scanner through it and ray-casts every beam. Occlusion shadows, holes, scan-line patterns and density all come
// from the ray-casting, not from decoration. Worker-safe: no DOM in this file.
//
// Units: metres, x east, y north, z up. Everything here is INVENTED scenery for the simulated exercise.
import { mulberry32, pointInPoly, distToSeg } from '../../core/geometry.js';
import { SITE, BUILDING, ROOMS, DOORS, WALLS, OBSTACLES, HAZARDS, SEED } from '../../core/world.js';

// Materials: reflectance drives the intensity channel; 'cls' is the simulator's own label, used only to CHECK the
// classifier afterwards (0 ground, 1 structure, 2 rubble, 3 vegetation, 4 contents such as furniture and vehicles).
export const MAT = { soil: 0, mud: 1, asphalt: 2, pad: 3, floor: 4, rubble: 5, concrete: 6, drywall: 7, roof: 8, wood: 9, metal: 10, trunk: 11, leaf: 12, vehicle: 13 };
const REFL = [0.34, 0.22, 0.11, 0.9, 0.44, 0.38, 0.56, 0.76, 0.6, 0.5, 0.72, 0.26, 0.46, 0.64];
const CLS_OF_MAT = [0, 0, 0, 0, 0, 2, 1, 1, 1, 4, 4, 3, 3, 4];

function hash2(i, j, s) { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ s; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
const sstep = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- scene container
function makeScene(w, h) {
  const hmW = Math.round(w / 0.1) + 1, hmH = Math.round(h / 0.1) + 1;
  return { w, h, hmW, hmH, hm: new Float32Array(hmW * hmH), gm: new Uint8Array(hmW * hmH), prims: [], cs: 2, gw: Math.ceil(w / 2), gh: Math.ceil(h / 2), cells: null, mounds: [] };
}
function fillGround(S, fn) {
  const o = { z: 0, m: 0 };
  for (let j = 0; j < S.hmH; j++) for (let i = 0; i < S.hmW; i++) { fn(i * 0.1, j * 0.1, o); S.hm[j * S.hmW + i] = o.z; S.gm[j * S.hmW + i] = o.m; }
}
function groundAt(S, x, y) {
  const fx = x * 10, fy = y * 10;
  if (!(fx >= 0 && fy >= 0 && fx < S.hmW - 1 && fy < S.hmH - 1)) return NaN;
  const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * S.hmW + i, hm = S.hm;
  return hm[k] * (1 - u) * (1 - v) + hm[k + 1] * u * (1 - v) + hm[k + S.hmW] * (1 - u) * v + hm[k + S.hmW + 1] * u * v;
}
function moundHeight(m, x, y) {
  if (x < m.x0 || x > m.x1 || y < m.y0 || y > m.y1 || !pointInPoly([x, y], m.poly)) return 0;
  let d = Infinity; const p = [x, y], poly = m.poly;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSeg(p, poly[i], poly[(i + 1) % poly.length]));
  const e = sstep(d / m.ramp);
  return m.h * e * (0.7 + 0.3 * vnoise(x * 0.4, y * 0.4, m.seed)) + e * (0.11 * vnoise(x * 2.9, y * 2.9, m.seed + 1) + 0.07 * vnoise(x * 6.7, y * 6.7, m.seed + 2)) * Math.min(1, m.h + 0.3);
}
function addMound(S, poly, h, ramp, seed) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  S.mounds.push({ poly, h, ramp, seed, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
}

// Boxes may be rotated: yaw about z, then pitch about y (positive pitch lowers the +x end), then roll about x.
function addBox(S, cx, cy, cz, hx, hy, hz, mat, yaw = 0, pitch = 0, roll = 0) {
  let r = null, ex = hx, ey = hy;
  if (yaw || pitch || roll) {
    const cw = Math.cos(yaw), sw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    const m00 = cw * cp, m01 = cw * sp * sr - sw * cr, m02 = cw * sp * cr + sw * sr;
    const m10 = sw * cp, m11 = sw * sp * sr + cw * cr, m12 = sw * sp * cr - cw * sr;
    const m20 = -sp, m21 = cp * sr, m22 = cp * cr;
    r = [m00, m10, m20, m01, m11, m21, m02, m12, m22];
    ex = Math.abs(m00) * hx + Math.abs(m01) * hy + Math.abs(m02) * hz; ey = Math.abs(m10) * hx + Math.abs(m11) * hy + Math.abs(m12) * hz;
  }
  S.prims.push({ k: 0, cx, cy, cz, hx, hy, hz, r, mat, x0: cx - ex, x1: cx + ex, y0: cy - ey, y1: cy + ey });
}
function addCyl(S, cx, cy, r, z0, z1, mat) { S.prims.push({ k: 1, cx, cy, r, z0, z1, mat, x0: cx - r, x1: cx + r, y0: cy - r, y1: cy + r }); }
function addBlob(S, cx, cy, cz, rx, ry, rz, dens) { S.prims.push({ k: 2, cx, cy, cz, rx, ry, rz, dens, mat: MAT.leaf, x0: cx - rx, x1: cx + rx, y0: cy - ry, y1: cy + ry }); }
// A wall piece from a to b (any direction), thickness th, from height z0 to z1.
function addWall(S, a, b, th, z0, z1, mat) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  if (len < 0.02 || z1 - z0 < 0.02) return;
  const ax = Math.abs(dy) < 1e-9, ay = Math.abs(dx) < 1e-9;
  if (ax) addBox(S, (a[0] + b[0]) / 2, a[1], (z0 + z1) / 2, len / 2, th / 2, (z1 - z0) / 2, mat);
  else if (ay) addBox(S, a[0], (a[1] + b[1]) / 2, (z0 + z1) / 2, th / 2, len / 2, (z1 - z0) / 2, mat);
  else addBox(S, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (z0 + z1) / 2, len / 2, th / 2, (z1 - z0) / 2, mat, Math.atan2(dy, dx));
}
function finalize(S) {
  const lists = Array.from({ length: S.gw * S.gh }, () => []);
  S.prims.forEach((p, id) => {
    p.id = id;
    const i0 = Math.max(0, Math.floor(p.x0 / S.cs)), i1 = Math.min(S.gw - 1, Math.floor(p.x1 / S.cs)), j0 = Math.max(0, Math.floor(p.y0 / S.cs)), j1 = Math.min(S.gh - 1, Math.floor(p.y1 / S.cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) lists[j * S.gw + i].push(id);
  });
  S.cells = lists.map((l) => Int32Array.from(l));
  S.stamp = new Int32Array(S.prims.length).fill(-1);
}

// ---------------------------------------------------------------- ray casting
let HT = 0, HM = 0, HC = 0, rayN = 0; // hit distance, material, cosine of incidence
let rs = 0x9e3779b9;
const rnd = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296; };
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.732; // close to a unit normal

function hitPrim(p, ox, oy, oz, dx, dy, dz, tmax) {
  if (p.k === 0) {
    const px = ox - p.cx, py = oy - p.cy, pz = oz - p.cz;
    let lx = px, ly = py, lz = pz, ex = dx, ey = dy, ez = dz;
    const r = p.r;
    if (r) { lx = r[0] * px + r[1] * py + r[2] * pz; ly = r[3] * px + r[4] * py + r[5] * pz; lz = r[6] * px + r[7] * py + r[8] * pz; ex = r[0] * dx + r[1] * dy + r[2] * dz; ey = r[3] * dx + r[4] * dy + r[5] * dz; ez = r[6] * dx + r[7] * dy + r[8] * dz; }
    let t0 = 0, t1 = tmax, c = 1, ta, tb, s;
    if (Math.abs(ex) < 1e-9) { if (Math.abs(lx) > p.hx) return false; } else { ta = (-p.hx - lx) / ex; tb = (p.hx - lx) / ex; if (ta > tb) { s = ta; ta = tb; tb = s; } if (ta > t0) { t0 = ta; c = Math.abs(ex); } if (tb < t1) t1 = tb; if (t0 > t1) return false; }
    if (Math.abs(ey) < 1e-9) { if (Math.abs(ly) > p.hy) return false; } else { ta = (-p.hy - ly) / ey; tb = (p.hy - ly) / ey; if (ta > tb) { s = ta; ta = tb; tb = s; } if (ta > t0) { t0 = ta; c = Math.abs(ey); } if (tb < t1) t1 = tb; if (t0 > t1) return false; }
    if (Math.abs(ez) < 1e-9) { if (Math.abs(lz) > p.hz) return false; } else { ta = (-p.hz - lz) / ez; tb = (p.hz - lz) / ez; if (ta > tb) { s = ta; ta = tb; tb = s; } if (ta > t0) { t0 = ta; c = Math.abs(ez); } if (tb < t1) t1 = tb; if (t0 > t1) return false; }
    if (t0 < 0.02) return false;
    HT = t0; HM = p.mat; HC = c; return true;
  }
  if (p.k === 1) {
    const px = ox - p.cx, py = oy - p.cy, a = dx * dx + dy * dy;
    if (a > 1e-9) {
      const b = px * dx + py * dy, cc = px * px + py * py - p.r * p.r, disc = b * b - a * cc;
      if (disc < 0) return false;
      const t = (-b - Math.sqrt(disc)) / a;
      if (t > 0.02 && t < tmax) { const z = oz + dz * t; if (z >= p.z0 && z <= p.z1) { HT = t; HM = p.mat; HC = 0.75; return true; } }
    }
    if (dz < -1e-6 && oz > p.z1) { const t = (p.z1 - oz) / dz; if (t < tmax) { const x = px + dx * t, y = py + dy * t; if (x * x + y * y <= p.r * p.r) { HT = t; HM = p.mat; HC = -dz; return true; } } }
    return false;
  }
  // foliage: a porous ellipsoid. A beam goes a random distance into the crown, or straight through it.
  const sx = 1 / p.rx, sy = 1 / p.ry, sz = 1 / p.rz;
  const px = (ox - p.cx) * sx, py = (oy - p.cy) * sy, pz = (oz - p.cz) * sz, ex = dx * sx, ey = dy * sy, ez = dz * sz;
  const a = ex * ex + ey * ey + ez * ez, b = px * ex + py * ey + pz * ez, cc = px * px + py * py + pz * pz - 1, disc = b * b - a * cc;
  if (disc <= 0) return false;
  const sq = Math.sqrt(disc), tin = Math.max(0.02, (-b - sq) / a), tout = (-b + sq) / a;
  if (tout <= tin || tin > tmax) return false;
  const L = tout - tin, pHit = 1 - Math.exp(-p.dens * L);
  if (rnd() > pHit) return false;
  const t = tin - Math.log(1 - rnd() * pHit) / p.dens;
  if (t > tmax) return false;
  HT = t; HM = p.mat; HC = 0.35 + 0.5 * rnd(); return true;
}

// Returns true and sets HT / HM / HC when the beam from o along unit direction d hits something within maxR.
function cast(S, ox, oy, oz, dx, dy, dz, maxR) {
  let best = maxR, bm = -1, bc = 0;
  const cs = S.cs, gw = S.gw, gh = S.gh, stamp = S.stamp, id = rayN++;
  let ix = Math.floor(ox / cs), iy = Math.floor(oy / cs);
  if (ix >= 0 && iy >= 0 && ix < gw && iy < gh) {
    const stx = dx > 0 ? 1 : -1, sty = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? cs / Math.abs(dx) : Infinity, tdy = dy !== 0 ? cs / Math.abs(dy) : Infinity;
    let tmx = dx !== 0 ? ((ix + (dx > 0 ? 1 : 0)) * cs - ox) / dx : Infinity, tmy = dy !== 0 ? ((iy + (dy > 0 ? 1 : 0)) * cs - oy) / dy : Infinity;
    for (;;) {
      const list = S.cells[iy * gw + ix];
      for (let q = 0; q < list.length; q++) {
        const pid = list[q]; if (stamp[pid] === id) continue; stamp[pid] = id;
        if (hitPrim(S.prims[pid], ox, oy, oz, dx, dy, dz, best)) { best = HT; bm = HM; bc = HC; }
      }
      const tex = tmx < tmy ? tmx : tmy;
      if (best <= tex || tex > maxR) break;
      if (tmx < tmy) { ix += stx; tmx += tdx; } else { iy += sty; tmy += tdy; }
      if (ix < 0 || iy < 0 || ix >= gw || iy >= gh) break;
    }
  }
  // ground: march down the height map
  let t = 0, pt = 0, n = 0;
  const down = dz < 0 ? -dz : 0;
  while (t < best && n++ < 160) {
    const g = groundAt(S, ox + dx * t, oy + dy * t);
    if (g !== g) break;
    const hgt = oz + dz * t - g;
    if (hgt < 0.012) {
      if (t === 0) break;
      if (hgt < 0) { let lo = pt, hi = t; for (let q = 0; q < 7; q++) { const m = (lo + hi) / 2; if (oz + dz * m - groundAt(S, ox + dx * m, oy + dy * m) < 0) hi = m; else lo = m; } t = lo; }
      if (t < best) { best = t; const k = Math.round((oy + dy * t) * 10) * S.hmW + Math.round((ox + dx * t) * 10); bm = S.gm[k]; bc = 0.25 + 0.75 * down; }
      break;
    }
    pt = t; let st = hgt / (down + 0.8); if (st < 0.03) st = 0.03; else if (st > 1) st = Math.max(1, hgt / (down + 1.6));
    t += st;
  }
  if (bm < 0) return false;
  HT = best; HM = bm; HC = bc; return true;
}

// ---------------------------------------------------------------- the cloud being captured
function makeCloud(cap) { return { n: 0, cap, pos: new Float32Array(cap * 3), inten: new Uint8Array(cap), truth: new Uint8Array(cap), time: new Float32Array(cap) }; }
function shoot(S, C, ox, oy, oz, dx, dy, dz, time, sigma, maxR, rRef) {
  if (!cast(S, ox, oy, oz, dx, dy, dz, maxR)) return;
  const refl = REFL[HM];
  if (rnd() < 0.015 + (1 - refl) * 0.05 + (HC < 0.12 ? 0.5 : 0)) return; // weak returns are lost
  const t = HT + gauss() * sigma * (HM === MAT.leaf ? 2.5 : 1);
  const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
  if (x < 0 || y < 0 || x > S.w || y > S.h || C.n >= C.cap) return;
  const k = C.n++;
  C.pos[k * 3] = x; C.pos[k * 3 + 1] = y; C.pos[k * 3 + 2] = z;
  let I = refl * (0.52 + 0.48 * HC) * Math.min(1.25, Math.max(0.7, Math.pow(rRef / HT, 0.3))) + gauss() * 0.035;
  C.inten[k] = I < 0.02 ? 5 : I > 1 ? 255 : (I * 255) | 0;
  C.truth[k] = CLS_OF_MAT[HM]; C.time[k] = time;
}

// ---------------------------------------------------------------- site scenery
function local(x, y, yaw, ox, oy) { const c = Math.cos(yaw), s = Math.sin(yaw); return [x + ox * c - oy * s, y + ox * s + oy * c]; }
function desk(S, x, y, yaw, toppled, z0 = 0.03) {
  if (!toppled) {
    addBox(S, x, y, z0 + 0.74, 0.6, 0.3, 0.02, MAT.wood, yaw);
    for (const sx of [-0.56, 0.56]) { const p = local(x, y, yaw, sx, 0); addBox(S, p[0], p[1], z0 + 0.36, 0.02, 0.27, 0.36, MAT.metal, yaw); }
  } else {
    addBox(S, x, y, z0 + 0.3, 0.6, 0.02, 0.3, MAT.wood, yaw);
    for (const sx of [-0.56, 0.56]) { const p = local(x, y, yaw, sx, 0.36); addBox(S, p[0], p[1], z0 + 0.27, 0.02, 0.36, 0.27, MAT.metal, yaw); }
  }
}
function chair(S, x, y, yaw, toppled, z0 = 0.03) {
  if (toppled) { addBox(S, x, y, z0 + 0.21, 0.22, 0.24, 0.21, MAT.wood, yaw, 0, 0.4); return; }
  addBox(S, x, y, z0 + 0.44, 0.21, 0.21, 0.02, MAT.wood, yaw); addBox(S, x, y, z0 + 0.22, 0.03, 0.03, 0.22, MAT.metal, yaw);
  const p = local(x, y, yaw, 0, -0.2); addBox(S, p[0], p[1], z0 + 0.66, 0.2, 0.02, 0.2, MAT.wood, yaw);
}
function chunks(S, R, cx, cy, rad, n, smin, smax, lift = 0) {
  for (let i = 0; i < n; i++) {
    const a = R() * 6.283, d = Math.sqrt(R()) * rad, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, g = groundAt(S, x, y);
    if (g !== g) continue;
    const s = smin + R() * R() * (smax - smin);
    addBox(S, x, y, g + s * 0.3 + lift, s * (0.5 + R() * 0.5), s * (0.3 + R() * 0.5), s * (0.2 + R() * 0.3), MAT.rubble, R() * 3.14, (R() - 0.5) * 1.1, (R() - 0.5) * 1.1);
  }
}
function tree(S, R, x, y, big) {
  const g = groundAt(S, x, y) || 0, hgt = big ? 6.5 + R() * 3 : 4.2 + R() * 2;
  addCyl(S, x, y, 0.14 + R() * 0.14, g - 0.2, g + hgt * 0.62, MAT.trunk);
  const nb = big ? 3 : 2;
  for (let i = 0; i < nb; i++) { const r = (big ? 2.1 : 1.5) + R() * 1.1; addBlob(S, x + (R() - 0.5) * 1.8, y + (R() - 0.5) * 1.8, g + hgt * (0.7 + R() * 0.22), r, r * (0.8 + R() * 0.4), r * (0.6 + R() * 0.3), 0.45 + R() * 0.35); }
}
function bush(S, R, x, y) { const g = groundAt(S, x, y) || 0, r = 0.6 + R() * 0.5; addBlob(S, x, y, g + r * 0.55, r, r * (0.8 + R() * 0.4), r * 0.75, 1.3); }

export function buildSite() {
  const S = makeScene(SITE.w, SITE.h), R = mulberry32(SEED ^ 0x5ca9);
  const B = BUILDING.rect, WH = BUILDING.wallHeight;
  const mudPoly = HAZARDS.find((h) => h.kind === 'mud')?.poly;
  // rubble heaps from the world, plus the collapsed corner of building C
  for (const o of OBSTACLES) if (o.kind === 'rubble') addMound(S, o.poly, o.h, o.h > 2 ? 2.4 : 1.5, S.mounds.length * 7 + 3);
  const cCorner = [[91.2, 37.5], [96.4, 37.8], [96.8, 46.6], [91, 47]];
  addMound(S, cCorner, 2.3, 1.9, 91);
  const pad = SITE.dronePad;
  fillGround(S, (x, y, o) => {
    let z = 5.2 * sstep((x + y - 150) / 44) + 0.05 * vnoise(x / 6, y / 6, 11) + 0.018 * vnoise(x / 1.4, y / 1.4, 12), m = MAT.soil;
    const inB = x >= B[0] - 0.12 && x <= B[2] + 0.12 && y >= B[1] - 0.12 && y <= B[3] + 0.12;
    if (inB) { z = 0.03 + 0.006 * vnoise(x * 1.2, y * 1.2, 13); m = MAT.floor; }
    else if (mudPoly && pointInPoly([x, y], mudPoly)) { z += 0.09 * vnoise(x / 2.2, y / 2.2, 14) + 0.03 * vnoise(x * 1.8, y * 1.8, 15); m = MAT.mud; }
    else if ((y >= 2 && y <= 7) || (x >= 62 && x <= 66 && y > 7 && y <= 29.8)) { z -= 0.02; m = MAT.asphalt; }
    if (Math.hypot(x - pad[0], y - pad[1]) < 1.25) m = MAT.pad;
    for (const md of S.mounds) { const mh = moundHeight(md, x, y); if (mh > 0.03) { z += mh; m = MAT.rubble; } else if (mh > 0) z += mh; }
    o.z = z; o.m = m;
  });

  // ---- building B: walls with windows, lintels over doors, the roof
  const isCollapsed = (w) => w.state === 'collapsed';
  for (const w of WALLS) {
    const th = w.mat === 'concrete' ? 0.24 : 0.12, mat = w.mat === 'concrete' ? MAT.concrete : MAT.drywall;
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    const at = (s) => [w.a[0] + ux * s, w.a[1] + uy * s];
    if (isCollapsed(w)) { // stubs left standing
      for (let s = 0; s < len - 0.2; s += 0.6) if (R() < 0.6) addWall(S, at(s), at(Math.min(len, s + 0.6)), th, 0, 0.25 + R() * R() * 1.3, mat);
      continue;
    }
    if (w.state === 'damaged') { // jagged, with a hole. Its southern half still carries the fallen roof slab.
      for (let s = 0; s < len - 1e-6; s += 0.5) {
        const y = w.a[1] + uy * s; let top = WH;
        if (y >= 48.4 && y < 54) top = 2.92 + R() * 0.06; else if (y >= 54 && y < 55.2) top = 0.35 + R() * 0.3; else if (y >= 55.2) top = 1.1 + R() * 1.6;
        addWall(S, at(s), at(Math.min(len, s + 0.5)), th, 0, top, mat);
      }
      continue;
    }
    if (w.mat === 'concrete' && len > 5) { // outer wall: piers, sills and lintels around window openings
      const nWin = Math.floor((len - 1) / 3.1), pitch = len / nWin;
      let s = 0;
      for (let i = 0; i < nWin; i++) {
        const c = (i + 0.5) * pitch, a0 = c - 0.75, a1 = c + 0.75;
        addWall(S, at(s), at(a0), th, 0, w.h, mat);
        addWall(S, at(a0), at(a1), th, 0, 1.0, mat); addWall(S, at(a0), at(a1), th, 2.25, w.h, mat);
        s = a1;
      }
      addWall(S, at(s), at(len), th, 0, w.h, mat);
    } else addWall(S, w.a, w.b, th, 0, w.h, mat);
  }
  for (const d of DOORS) { // lintels
    const hw = d.w / 2, onX = Math.abs(d.pos[1] - Math.round(d.pos[1])) < 1e-6;
    if (onX) addWall(S, [d.pos[0] - hw, d.pos[1]], [d.pos[0] + hw, d.pos[1]], d.id === 'entrance' ? 0.24 : 0.12, 2.15, WH, d.id === 'entrance' ? MAT.concrete : MAT.drywall);
    if (d.blocked) { // a jammed door leaf and debris in the opening
      addBox(S, d.pos[0] + 0.1, d.pos[1], 1.0, 0.62, 0.03, 1.0, MAT.wood, 0.25, 0, 0.12);
      chunks(S, R, d.pos[0], d.pos[1], 0.8, 7, 0.25, 0.6);
    }
  }
  // roof slab: intact everywhere except over the north part of room 112, where it has come down
  addBox(S, (B[0] - 0.25 + 75.06) / 2, (B[1] + B[3]) / 2, WH + 0.09, (75.06 - B[0] + 0.25) / 2, (B[3] - B[1]) / 2 + 0.25, 0.09, MAT.roof);
  addBox(S, (75.06 + B[2] + 0.25) / 2, (B[1] - 0.25 + 47.6) / 2, WH + 0.09, (B[2] + 0.25 - 75.06) / 2, (47.6 - B[1] + 0.25) / 2, 0.09, MAT.roof);
  // the fallen roof panel: still resting on the damaged partition (x = 75), its far edge on the floor: a lean-to
  { const x0 = 75.2, z0 = 2.95, x1 = 81.0, z1 = 0.32, L = Math.hypot(x1 - x0, z0 - z1); addBox(S, (x0 + x1) / 2, 51.3, (z0 + z1) / 2 + 0.09, L / 2, 2.3, 0.09, MAT.rubble, 0, Math.atan2(z0 - z1, x1 - x0), 0.02); }
  // a second panel lying low on blocks at the north-west foot of the heap: a low, flat pocket
  addBox(S, 77.3, 56.4, 1.08, 1.5, 1.25, 0.08, MAT.rubble, 0.2, 0.05, -0.04);
  for (const [x, y, s] of [[76.2, 55.5, 0.5], [78.4, 55.6, 0.48], [76.3, 57.4, 0.5], [78.5, 57.3, 0.47]]) addBox(S, x, y, s, 0.3, 0.3, s - 0.02, MAT.rubble, R());
  // more broken slabs on and around the heap
  addBox(S, 82.6, 54.2, 1.9, 1.4, 1.0, 0.08, MAT.rubble, 0.6, 0.5, 0.2); addBox(S, 81.8, 57.8, 1.5, 1.2, 0.9, 0.08, MAT.rubble, -0.4, -0.35, 0.3);
  addBox(S, 84.9, 56.3, 0.9, 1.3, 0.8, 0.07, MAT.rubble, 1.2, 0.6, 0); addBox(S, 80.4, 59.2, 0.7, 1.1, 0.7, 0.07, MAT.rubble, 0.1, -0.5, 0.2);
  chunks(S, R, 82.3, 55.6, 4.2, 60, 0.25, 1.0); chunks(S, R, 77.2, 53.9, 1.2, 9, 0.2, 0.55); chunks(S, R, 79.5, 48.6, 1.3, 7, 0.2, 0.5);
  // corridor blockage: flood debris, a fallen locker, a door leaf
  chunks(S, R, 77.6, 44, 1.7, 26, 0.2, 0.7);
  addBox(S, 77.2, 43.3, 1.25, 0.9, 0.24, 0.2, MAT.metal, 0.5, 0.3, 0.2); addBox(S, 78.4, 44.9, 1.2, 1.0, 0.45, 0.03, MAT.wood, -0.3, 0.45, 0.1);

  // ---- furniture
  const classroom = (room, opts = {}) => {
    const r = room.rect, south = r[1] < 44, rows = 4, cols = 3, x0 = r[0] + 1.9, y0 = south ? r[1] + 2.0 : r[1] + 3.2;
    const mess = opts.mess ?? 0.45;
    if (!opts.empty) for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const topple = R() < mess * 0.55, push = mess * (0.4 + R());
      const x = Math.min(r[2] - 1.0, Math.max(r[0] + 1.0, x0 + i * 2.5 + push * 1.3 + (R() - 0.5) * mess * 1.2)), y = Math.min(r[3] - 1.0, Math.max(r[1] + 1.0, y0 + j * 2.0 + (R() - 0.5) * mess * 1.6));
      if (opts.skip && opts.skip(x, y)) continue;
      const yaw = (R() - 0.5) * mess * 2.2;
      desk(S, x, y, yaw, topple);
      const c = local(x, y, yaw, 0, south ? -0.62 : 0.62);
      if (R() < 0.85) chair(S, c[0] + (R() - 0.5) * mess, c[1] + (R() - 0.5) * mess, yaw + (south ? 0 : Math.PI) + (R() - 0.5) * mess * 2, R() < mess * 0.6);
    }
    // board on the west wall, a cabinet in the far corner
    addBox(S, r[0] + 0.1, (r[1] + r[3]) / 2, 1.6, 0.025, 1.6, 0.6, MAT.wood);
    addBox(S, r[2] - 0.38, south ? r[1] + 0.9 : r[3] - 0.9, 0.98, 0.24, 0.5, 0.95, MAT.wood);
  };
  const walk = (x, y) => (Math.abs(x - 57.6) < 1.1 || Math.abs(x - 48.6) < 1.1 || Math.abs(x - 70.6) < 1.1) || (x > 71 && y > 52 && y < 55);
  for (const room of ROOMS) {
    if (room.corridor) continue;
    if (room.id === '110') { // the lab: benches, stools, cylinders, a pipe run
      const r = room.rect;
      for (const y of [50.2, 52.6]) { addBox(S, r[0] + 2.6, y, 0.48, 1.9, 0.38, 0.45, MAT.wood); addBox(S, r[0] + 2.6, y, 0.95, 1.95, 0.42, 0.02, MAT.metal); }
      addBox(S, r[2] - 0.45, 55.6, 1.05, 0.38, 1.3, 1.02, MAT.metal);
      for (const [x, y] of [[55.2, 56.9], [55.75, 57.2], [56.4, 57.0]]) addCyl(S, x, y, 0.115, 0.03, 1.45, MAT.metal);
      addBox(S, 57.2, 56.2, 0.15, 0.7, 0.115, 0.115, MAT.metal, 0.5);
      addBox(S, (r[0] + r[2]) / 2, r[3] - 0.22, 2.55, (r[2] - r[0]) / 2 - 0.2, 0.05, 0.05, MAT.metal);
      for (let i = 0; i < 5; i++) chair(S, r[0] + 1.2 + i * 0.8 + R() * 0.3, 51.4 + (R() - 0.5), R() * 6, R() < 0.4);
      continue;
    }
    if (room.id === '103') { // overturned desks in a line (the world's 'desk-103'), a tidier room otherwise
      classroom(room, { mess: 0.3, skip: (x, y) => walk(x, y) || (y > 34.4 && y < 37.6) });
      for (let i = 0; i < 4; i++) desk(S, 69.6 + i * 1.12, 36.05 + (R() - 0.5) * 0.3, (R() - 0.5) * 0.4, true);
      continue;
    }
    if (room.id === '112') { classroom(room, { mess: 0.9, skip: (x, y) => y > 48.2 }); continue; }
    classroom(room, { mess: room.id === '104' ? 0.8 : 0.45, skip: walk });
  }
  for (const x of [46.5, 52.2, 55.4, 60.2, 67.6, 73.2]) addBox(S, x, 45.74, 0.93, 0.45, 0.2, 0.9, MAT.metal); // lockers on the corridor's north wall
  addBox(S, 63.0, 31.2, 0.5, 0.25, 0.8, 0.47, MAT.wood); // a bench in the entrance hall
  for (let i = 0; i < 9; i++) addBox(S, 62.3 + 0.4, 51.5 + i * 0.3, 0.1 + i * 0.17, 0.55, 0.15, 0.1 + i * 0.17, MAT.concrete); // stairs up, north stairwell
  for (let i = 0; i < 9; i++) addBox(S, 65.3 - 0.0, 54.2 - i * 0.3 + 0.0, 1.63 + 0.1 + i * 0.085, 0.55, 0.15, 0.09, MAT.concrete);

  // ---- buildings A and C
  { const a = OBSTACLES.find((o) => o.id === 'bldg-a'), p = a.poly, x0 = p[0][0], y0 = p[0][1], x1 = p[2][0], y1 = p[2][1], cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, eave = 5.8, ridge = 7.6;
    for (const [aa, bb] of [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]]) addWall(S, aa, bb, 0.3, -0.3, eave, MAT.concrete);
    const half = (y1 - y0) / 2 + 0.5, sl = Math.hypot(half, ridge - eave), ang = Math.atan2(ridge - eave, half);
    addBox(S, cx, cy - half / 2, (eave + ridge) / 2, (x1 - x0) / 2 + 0.5, sl / 2, 0.06, MAT.roof, 0, 0, ang);
    addBox(S, cx, cy + half / 2, (eave + ridge) / 2, (x1 - x0) / 2 + 0.5, sl / 2, 0.06, MAT.roof, 0, 0, -ang);
    addCyl(S, x0 + 4, y1 - 5, 0.9, 6, 8.3, MAT.metal); addBox(S, x1 - 5, cy - 7.2, 6.9, 0.5, 0.5, 0.9, MAT.concrete); addBox(S, x1 + 1.6, y0 + 4, 1.3, 1.6, 2.2, 1.3, MAT.concrete); addBox(S, x1 + 1.6, y0 + 4, 2.66, 1.75, 2.35, 0.06, MAT.roof);
  }
  { const z1 = 6; // C: the main block stands; its north-west bay has come down
    const seg = (a, b) => addWall(S, a, b, 0.3, -0.3, z1, MAT.concrete);
    seg([92, 20], [112, 20]); seg([112, 20], [112, 46]); seg([112, 46], [96.6, 46]); seg([96.6, 46], [96.6, 37.6]); seg([96.6, 37.6], [92, 37.6]); seg([92, 37.6], [92, 20]);
    addBox(S, 102, 28.8, z1 + 0.1, 10.2, 9, 0.1, MAT.roof); addBox(S, 104.4, 41.9, z1 + 0.1, 7.8, 4.3, 0.1, MAT.roof);
    addBox(S, 108, 30, z1 + 0.75, 1.2, 1.6, 0.55, MAT.metal); addCyl(S, 98, 24, 0.7, z1, z1 + 1.7, MAT.metal);
    addBox(S, 93.4, 42.6, 1.55, 1.9, 1.5, 0.09, MAT.rubble, 0.15, 0, 0.5); addBox(S, 94.6, 40.0, 1.5, 1.7, 1.1, 0.09, MAT.rubble, -0.2, -0.55, 0.1); addBox(S, 92.6, 45.2, 1.0, 1.4, 1.0, 0.08, MAT.rubble, 0.8, 0.3, -0.3);
    chunks(S, R, 93.8, 42.4, 3.6, 46, 0.25, 1.1);
  }
  // ---- outdoors: debris field with logs and a propped sheet, vehicles and crates at staging, poles, trees
  chunks(S, R, 97.5, 69.5, 6.5, 70, 0.2, 0.9);
  for (let i = 0; i < 9; i++) { const x = 91.5 + R() * 12, y = 64 + R() * 11, g = groundAt(S, x, y), L = 1.6 + R() * 2.4; addBox(S, x, y, g + 0.16, L, 0.13, 0.13, MAT.trunk, R() * 3.14, (R() - 0.5) * 0.3); }
  { const g = groundAt(S, 92.6, 66.6); addBox(S, 92.6, 66.6, g + 0.95, 1.5, 1.05, 0.03, MAT.metal, 0.5, 0.16, 0.05); addBox(S, 91.5, 66.1, g + 0.4, 0.2, 0.9, 0.4, MAT.rubble, 0.5); addBox(S, 93.7, 67.2, g + 0.33, 0.2, 0.9, 0.33, MAT.rubble, 0.5); }
  addBox(S, 31, 9.6, 1.9, 2.4, 1.15, 1.35, MAT.vehicle, 0.04); addBox(S, 34.3, 9.75, 1.45, 0.95, 1.1, 0.95, MAT.vehicle, 0.04); addBox(S, 31.6, 9.62, 0.38, 3.6, 1.0, 0.18, MAT.metal, 0.04);
  addBox(S, 16.6, 11.2, 0.95, 2.2, 0.9, 0.5, MAT.vehicle, -0.2); addBox(S, 16.4, 11.25, 1.6, 1.2, 0.8, 0.28, MAT.vehicle, -0.2);
  for (const [x, y, s] of [[22.6, 14.9, 0.4], [23.5, 15.1, 0.4], [23.0, 14.95, 1.18], [28.6, 15.6, 0.35]]) addBox(S, x, y, s, 0.4, 0.3, s > 1 ? 0.38 : s, MAT.wood, R());
  addBox(S, 23.2, 7.9, 2.3, 2.0, 0.03, 0.03, MAT.metal); addBox(S, 21.3, 9.4, 1.15, 0.03, 1.5, 1.15, MAT.vehicle); addBox(S, 25.1, 9.4, 1.15, 0.03, 1.5, 1.15, MAT.vehicle); addBox(S, 23.2, 9.4, 2.34, 1.95, 1.55, 0.03, MAT.vehicle);
  for (const x of [9, 36, 58, 86, 111]) addCyl(S, x, 7.7, 0.11, -0.3, 7.4, MAT.concrete);
  const blocked = (x, y) => (x > 5 && x < 37 && y > 37 && y < 73) || (x > 41 && x < 89 && y > 27 && y < 62) || (x > 89 && x < 115 && y > 17 && y < 49) || (y < 8.5) || (x > 14 && x < 70 && y < 31) || (x > 88 && x < 108 && y > 60 && y < 79);
  const spots = [];
  for (let i = 0; i < 400 && spots.length < 26; i++) {
    const zone = R(); let x, y;
    if (zone < 0.3) { x = 1.5 + R() * 4.5; y = 9 + R() * 80; } else if (zone < 0.62) { x = 2 + R() * 116; y = 77 + R() * 12; } else if (zone < 0.8) { x = 36.5 + R() * 5; y = 44 + R() * 30; } else { x = 109 + R() * 10; y = 50 + R() * 26; }
    if (blocked(x, y) || spots.some((s) => Math.hypot(s[0] - x, s[1] - y) < 4.2)) continue;
    spots.push([x, y]); tree(S, R, x, y, R() < 0.55);
    if (R() < 0.5) bush(S, R, x + 2 + R() * 1.5, y + (R() - 0.5) * 3);
  }
  for (const [x, y] of [[40.5, 33], [41.2, 36.5], [87.5, 33.5], [86.6, 38], [12, 34.5], [70, 25.2], [56.5, 25.6]]) bush(S, R, x, y);
  finalize(S);
  return S;
}

// ---------------------------------------------------------------- trajectories
function Traj() { const segs = []; let t = 0, p = null;
  return { segs, get t() { return t; }, get p() { return p; },
    jump(q) { p = q.slice(); }, to(q, v, scan = false, pass = -1) { const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), dt = d / v; if (dt > 0) segs.push({ t0: t, t1: t + dt, a: p.slice(), b: q.slice(), scan, pass }); t += dt; p = q.slice(); return dt; } };
}
// Where the scanner was at time t. Used for the replay and for working out which space each beam passed through.
export function poseAt(segs, t, out = [0, 0, 0]) {
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (segs[m].t1 < t) lo = m + 1; else hi = m; }
  const s = segs[lo], u = s.t1 > s.t0 ? Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0))) : 0;
  out[0] = s.a[0] + (s.b[0] - s.a[0]) * u; out[1] = s.a[1] + (s.b[1] - s.a[1]) * u; out[2] = s.a[2] + (s.b[2] - s.a[2]) * u;
  return out;
}

const DEG = Math.PI / 180;
// A downward fan swept across the flight line (the mirror goes back and forth, so points fall in a zig-zag).
function flyLine(S, C, T, a, b, v, pass, { spacing, perLine, halfFov, sigma }) {
  const t0 = T.t, len = Math.hypot(b[0] - a[0], b[1] - a[1]), dur = len / v, nL = Math.floor(len / spacing);
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, px = -uy, py = ux; // p: across-track
  const o = [0, 0, 0];
  for (let L = 0; L < nL; L++) for (let k = 0; k < perLine; k++) {
    const f = (L + k / perLine) / nL, time = t0 + f * dur;
    o[0] = a[0] + (b[0] - a[0]) * f; o[1] = a[1] + (b[1] - a[1]) * f; o[2] = a[2] + (b[2] - a[2]) * f + 0.12 * Math.sin(time * 0.9);
    const kk = L & 1 ? perLine - 1 - k : k;
    const ang = (-halfFov + (2 * halfFov * (kk + rnd())) / perLine) * DEG + 0.011 * Math.sin(time * 1.7) + 0.006 * Math.sin(time * 5.3);
    const fw = (rnd() - 0.5) * 0.004 + 0.008 * Math.sin(time * 1.1), s = Math.sin(ang), c = Math.cos(ang);
    let dx = px * s + ux * fw, dy = py * s + uy * fw, dz = -c; const n = Math.hypot(dx, dy, dz);
    shoot(S, C, o[0], o[1], o[2], dx / n, dy / n, dz / n, time, sigma, 80, a[2]);
  }
  T.to(b, v, true, pass);
}

export function scanSite(S, progress = () => {}) {
  rs = 0x1234abcd ^ SEED; rayN = 0; S.stamp.fill(-1);
  const C = makeCloud(760000), T = Traj(), passes = [];
  const pad = SITE.dronePad;
  // pass 1: the aerial survey, on the same five lines the mission's drone flies, 30 m up
  T.jump([pad[0], pad[1], 0.3]); T.to([pad[0], pad[1], 30], 10);
  const rows = [10, 30, 50, 70, 84];
  let p0 = { t0: T.t, i0: 0 };
  rows.forEach((y, i) => {
    const a = [1, y, 30], b = [SITE.w - 1, y, 30], from = i % 2 ? b : a, to = i % 2 ? a : b;
    T.to(from, 8);
    if (i === 0) p0.t0 = T.t;
    flyLine(S, C, T, from, to, 8, 0, { spacing: 0.21, perLine: 112, halfFov: 36, sigma: 0.02 });
    progress(0.1 + 0.5 * (i + 1) / rows.length, 'Aerial survey, line ' + (i + 1) + ' of ' + rows.length);
  });
  passes.push({ id: 'aerial', name: 'Aerial survey', detail: '30 m above the site, five lines, 72° fan', t0: p0.t0, t1: T.t, i0: 0, i1: C.n });
  // pass 2: a low orbit around the collapsed corner, looking in from the side
  const oc = [82, 55], oR = 17, oAlt = 11, nArc = 96, arc = (2 * Math.PI * oR) / nArc;
  const op = (a) => [oc[0] + oR * Math.cos(a), oc[1] + oR * Math.sin(a), oAlt];
  T.to(op(0.9), 8);
  let i0 = C.n, t0 = T.t;
  for (let s = 0; s < nArc; s++) {
    const a0 = 0.9 + (s / nArc) * 2 * Math.PI, a1 = 0.9 + ((s + 1) / nArc) * 2 * Math.PI, ts = T.t, dt = arc / 3, lines = Math.round(arc / 0.115);
    for (let L = 0; L < lines; L++) for (let k = 0; k < 84; k++) {
      const f = (L + k / 84) / lines, a = a0 + (a1 - a0) * f, ox = oc[0] + oR * Math.cos(a), oy = oc[1] + oR * Math.sin(a);
      const kk = L & 1 ? 83 - k : k, phi = (22 + (56 * (kk + rnd())) / 84) * DEG, az = a + Math.PI + (rnd() - 0.5) * 0.006;
      shoot(S, C, ox, oy, oAlt, Math.cos(az) * Math.cos(phi), Math.sin(az) * Math.cos(phi), -Math.sin(phi), ts + f * dt, 0.015, 60, 22);
    }
    T.to(op(a1), 3, true, 1);
  }
  passes.push({ id: 'orbit', name: 'Collapse orbit', detail: '11 m up, circling the fallen corner and looking in', t0, t1: T.t, i0, i1: C.n });
  progress(0.72, 'Collapse orbit');
  // pass 3: a low flight inside, along the corridor and into every room whose door is open
  const zI = 1.25, way = [[64, 31], [64, 44], [64, 50.6], [64, 44], [57.6, 44], [57.6, 39.2], [56.2, 36.4], [57.6, 41], [57.6, 44], [57.6, 47.4], [57.6, 49], [59.8, 54.4], [57.6, 48], [57.6, 44], [48.6, 44],
    [48.6, 39.2], [47.4, 36.2], [48.6, 41], [48.6, 44], [48.6, 49.4], [47.6, 53.6], [48.6, 48], [48.6, 44], [64, 44], [70.6, 44], [70.6, 39.6], [68.2, 38.4], [70.6, 41], [70.6, 44], [70.6, 49.4], [72.6, 53.4], [70.6, 48], [70.6, 44], [74.7, 44]];
  T.to([64, 22, 8], 8); T.to([64, 26.4, zI], 3);
  i0 = C.n; t0 = T.t; let pose = 0;
  for (const w of way) {
    const a = T.p, b = [w[0], w[1], zI], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / 0.045)), ts = T.t, dt = len / 1.0;
    for (let q = 0; q < n; q++, pose++) {
      const f = q / n, ox = a[0] + (b[0] - a[0]) * f, oy = a[1] + (b[1] - a[1]) * f, oz = zI + 0.03 * Math.sin(pose * 0.21);
      for (let k = 0; k < 60; k++) {
        const az = pose * 2.39996 + k * 0.10472 + rnd() * 0.02, el = (-40 + (94 * (((k * 7 + pose * 3) & 31) + rnd())) / 32) * DEG, ce = Math.cos(el);
        shoot(S, C, ox, oy, oz, Math.cos(az) * ce, Math.sin(az) * ce, Math.sin(el), ts + f * dt, 0.008, 30, 5);
      }
    }
    T.to(b, 1.0, true, 2);
  }
  passes.push({ id: 'interior', name: 'Interior flight', detail: '1.25 m above the floor, corridor and every open room', t0, t1: T.t, i0, i1: C.n });
  progress(1, 'Scan captured');
  return finish(C, T, passes, S);
}
function finish(C, T, passes, S) {
  const n = C.n;
  return { n, pos: C.pos.slice(0, n * 3), inten: C.inten.slice(0, n), truth: C.truth.slice(0, n), time: C.time.slice(0, n), traj: T.segs, passes, duration: T.t, rays: rayN, prims: S.prims.length, site: [S.w, S.h] };
}

// ---------------------------------------------------------------- a custom floor plan
export const PLAN_MARGIN = 6;
export function buildPlan(plan) {
  const M = PLAN_MARGIN, S = makeScene(plan.size[0] + 2 * M, plan.size[1] + 2 * M), R = mulberry32(77);
  const wh = plan.wallHeight || 3;
  for (const r of plan.rubble || []) { const poly = []; for (let i = 0; i < 14; i++) { const a = (i / 14) * 6.283, rr = r.r * (0.85 + 0.3 * hash2(i, Math.round(r.pos[0] * 10), 5)); poly.push([r.pos[0] + M + Math.cos(a) * rr, r.pos[1] + M + Math.sin(a) * rr]); } addMound(S, poly, r.h || 1.2, Math.max(0.8, r.r * 0.7), S.mounds.length * 5 + 9); }
  fillGround(S, (x, y, o) => {
    const inside = x > M && y > M && x < S.w - M && y < S.h - M;
    let z = inside ? 0.02 + 0.005 * vnoise(x, y, 3) : 0.04 * vnoise(x / 5, y / 5, 1) + 0.015 * vnoise(x / 1.2, y / 1.2, 2), m = inside ? MAT.floor : MAT.soil;
    for (const md of S.mounds) { const mh = moundHeight(md, x, y); if (mh > 0.03) { z += mh; m = MAT.rubble; } else if (mh > 0) z += mh; }
    o.z = z; o.m = m;
  });
  for (const w of plan.walls || []) addWall(S, [w.a[0] + M, w.a[1] + M], [w.b[0] + M, w.b[1] + M], w.mat === 'concrete' ? 0.24 : 0.12, 0, w.h || wh, w.mat === 'concrete' ? MAT.concrete : MAT.drywall);
  for (const r of plan.rubble || []) { chunks(S, R, r.pos[0] + M, r.pos[1] + M, r.r * 0.9, Math.round(10 * r.r * r.r), 0.2, 0.7); const g = groundAt(S, r.pos[0] + M - r.r * 0.8, r.pos[1] + M) || 0; addBox(S, r.pos[0] + M - r.r * 0.75, r.pos[1] + M, g + 0.75, 1.3, 1.0, 0.07, MAT.rubble, R() * 3, 0.42, 0.05); }
  finalize(S);
  return S;
}
// With no roof on a drawn plan, two crossing sets of aerial lines see both faces of every wall.
export function scanPlan(S, progress = () => {}) {
  rs = 0x2468ace1; rayN = 0; S.stamp.fill(-1);
  const C = makeCloud(700000), T = Traj(), passes = [], alt = 16, opt = { spacing: 0.16, perLine: 120, halfFov: 40, sigma: 0.015 };
  const budget = 520000, area = S.w * S.h; opt.spacing = Math.max(0.1, Math.min(0.3, (area * 2.3 * opt.perLine) / (budget * 2 * alt * Math.tan(40 * DEG) * 0.9)));
  T.jump([2, 2, 0.3]); T.to([2, 2, alt], 8);
  const lines = (alongX) => { const span = alongX ? S.h : S.w, n = Math.max(1, Math.ceil(span / 18)), out = []; for (let i = 0; i < n; i++) { const c = ((i + 0.5) * span) / n; out.push(alongX ? [[1.5, c, alt], [S.w - 1.5, c, alt]] : [[c, 1.5, alt], [c, S.h - 1.5, alt]]); } return out; };
  [true, false].forEach((ax, pi) => {
    const i0 = C.n; let t0 = null;
    lines(ax).forEach(([a, b], i) => { const from = i % 2 ? b : a, to = i % 2 ? a : b; T.to(from, 8); if (t0 == null) t0 = T.t; flyLine(S, C, T, from, to, 6, pi, opt); });
    passes.push({ id: ax ? 'ew' : 'ns', name: ax ? 'East–west lines' : 'North–south lines', detail: alt + ' m above the plan, 80° fan', t0, t1: T.t, i0, i1: C.n });
    progress(0.5 + pi * 0.5, 'Scanning the plan');
  });
  return finish(C, T, passes, S);
}
