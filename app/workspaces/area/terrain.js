// Terrain for the Valley workspace: the real elevation grid and everything computed from it.
//   loadDem()        reads 16 live elevation tiles (Mapzen terrain tiles on AWS) into one 1024 x 1024 height grid,
//                    or falls back to a 512 x 512 copy of the same tiles saved beside this file.
//   slopeGrid()      slope angle per cell (Horn's method).
//   floodModel()     an illustrative flood on the real terrain. NOT a forecast and NOT a reconstruction.
//   shadowGrid()     which cells the terrain shades for a given sun position.
//   horizonAt()      the terrain horizon seen from one point, used for "when does direct sun reach the block".
import { BLOCK, BOUNDS, toUnit, fromUnit, haversine } from './geo.js';

const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const EARTH = 40075016.686;

function meta(n, source) {
  const midLat = (BOUNDS.north + BOUNDS.south) / 2;
  return { n, source, cs: (EARTH * Math.cos((midLat * Math.PI) / 180)) / 2 ** BLOCK.z / (n / BLOCK.n) };
}
function finish(dem) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < dem.data.length; i++) { const v = dem.data[i]; if (v < min) min = v; if (v > max) max = v; }
  dem.min = min; dem.max = max;
  // Bilinear sample at a lon/lat. Returns NaN outside the grid.
  dem.at = (lon, lat) => {
    const [u, v] = toUnit(lon, lat);
    if (u < 0 || v < 0 || u > 1 || v > 1) return NaN;
    return dem.atGrid(u * dem.n - 0.5, v * dem.n - 0.5);
  };
  dem.atGrid = (gx, gy) => {
    const n = dem.n, x = Math.max(0, Math.min(n - 1.001, gx)), y = Math.max(0, Math.min(n - 1.001, gy));
    const i = x | 0, j = y | 0, fx = x - i, fy = y - j, d = dem.data, k = j * n + i;
    return (d[k] * (1 - fx) + d[k + 1] * fx) * (1 - fy) + (d[k + n] * (1 - fx) + d[k + n + 1] * fx) * fy;
  };
  dem.cell = (lon, lat) => {
    const [u, v] = toUnit(lon, lat);
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return -1;
    return ((v * dem.n) | 0) * dem.n + ((u * dem.n) | 0);
  };
  dem.cellLonLat = (k) => fromUnit(((k % dem.n) + 0.5) / dem.n, (((k / dem.n) | 0) + 0.5) / dem.n);
  return dem;
}

function tileImage(url, ms) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; reject(new Error('timed out')); }, ms);
    img.crossOrigin = 'anonymous';
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('did not load')); };
    img.src = url;
  });
}

export async function loadLiveDem({ timeout = 9000 } = {}) {
  const T = 256, n = BLOCK.n * T, jobs = [];
  for (let j = 0; j < BLOCK.n; j++) for (let i = 0; i < BLOCK.n; i++) {
    jobs.push(tileImage(TERRARIUM.replace('{z}', BLOCK.z).replace('{x}', BLOCK.x0 + i).replace('{y}', BLOCK.y0 + j), timeout).then((img) => ({ img, i, j })));
  }
  const tiles = await Promise.all(jobs);
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  const c = cv.getContext('2d', { willReadFrequently: true });
  for (const t of tiles) c.drawImage(t.img, t.i * T, t.j * T);
  const px = c.getImageData(0, 0, n, n).data, data = new Float32Array(n * n);
  for (let k = 0, p = 0; k < data.length; k++, p += 4) data[k] = px[p] * 256 + px[p + 1] + px[p + 2] / 256 - 32768;
  return finish({ ...meta(n, 'live'), data });
}

export async function loadSavedDem() {
  const res = await fetch(new URL('./data/dem512.bin', import.meta.url));
  if (!res.ok) throw new Error('saved elevation copy missing');
  const raw = new Uint16Array(await res.arrayBuffer()), data = new Float32Array(raw.length);
  for (let k = 0; k < raw.length; k++) data[k] = raw[k] / 10;
  return finish({ ...meta(512, 'saved'), data });
}

// Slope angle in degrees, Horn's 3 x 3 method.
export function slopeGrid(dem) {
  const { n, data: d, cs } = dem, out = new Float32Array(n * n), k8 = 1 / (8 * cs);
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const k = j * n + i;
    const gx = (d[k - n + 1] + 2 * d[k + 1] + d[k + n + 1] - d[k - n - 1] - 2 * d[k - 1] - d[k + n - 1]) * k8;
    const gy = (d[k + n - 1] + 2 * d[k + n] + d[k + n + 1] - d[k - n - 1] - 2 * d[k - n] - d[k - n + 1]) * k8;
    out[k] = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Flood model. Illustrative only.
//   1. The mapped river (OpenStreetMap) is laid on the grid. Its bed height is the lowest cell within about 20 m,
//      forced to fall steadily downstream (30 m elevation data cannot see the channel itself).
//   2. Every cell near the river is tied to its nearest river point and gets "height above the river" there.
//   3. A priority flood from the river gives each cell the lowest water level at which water can reach it without
//      climbing over anything higher (so a hollow behind a ridge stays dry until the ridge is topped).
// A water level h above the river then floods exactly the cells with need < h; depth is h minus height above river.
// ---------------------------------------------------------------------------------------------------------------
export const MAX_STAGE = 45;

export function floodModel(dem, rivers) {
  const { n, data: d, cs } = dem, N = n * n;
  const seedOf = new Int32Array(N).fill(-1);
  const sBed = [], sS = [], sCell = [];
  const rr = Math.max(1, Math.round(20 / cs));
  let riverLen = 0;
  for (const r of rivers) {
    // chainage runs downstream; tributaries end at 0 where they join, the main river starts at 0.
    const pts = r.g, cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
    const total = cum[cum.length - 1], offset = r.main ? 0 : -total;
    let run = Infinity, inside = 0;
    for (let i = 1; i < pts.length; i++) {
      const [u0, v0] = toUnit(pts[i - 1][0], pts[i - 1][1]), [u1, v1] = toUnit(pts[i][0], pts[i][1]);
      const steps = Math.max(1, Math.ceil(Math.hypot((u1 - u0) * n, (v1 - v0) * n) * 2));
      for (let q = 0; q < steps; q++) {
        const f = q / steps, gx = ((u0 + (u1 - u0) * f) * n) | 0, gy = ((v0 + (v1 - v0) * f) * n) | 0;
        if (gx < 1 || gy < 1 || gx >= n - 1 || gy >= n - 1) continue;
        const k = gy * n + gx;
        if (seedOf[k] >= 0) continue;
        let bed = Infinity;
        for (let y = Math.max(0, gy - rr); y <= Math.min(n - 1, gy + rr); y++) for (let x = Math.max(0, gx - rr); x <= Math.min(n - 1, gx + rr); x++) bed = Math.min(bed, d[y * n + x]);
        run = Math.min(run, bed);
        seedOf[k] = sBed.length; sBed.push(run); sS.push(offset + cum[i - 1] + (cum[i] - cum[i - 1]) * f); sCell.push(k); inside++;
      }
    }
    if (inside) riverLen += total;
  }
  // 2. nearest river point (breadth-first, 8 neighbours), out to about 1.4 km from the river.
  const reach = Math.round(1400 / cs), distTo = new Uint16Array(N).fill(65535);
  let frontier = sCell.slice();
  for (const k of frontier) distTo[k] = 0;
  const NB = [-n - 1, -n, -n + 1, -1, 1, n - 1, n, n + 1];
  for (let step = 1; step <= reach && frontier.length; step++) {
    const next = [];
    for (const k of frontier) {
      const x = k % n; if (x < 1 || x >= n - 1 || k < n || k >= N - n) continue;
      for (const o of NB) { const q = k + o; if (distTo[q] !== 65535) continue; distTo[q] = step; seedOf[q] = seedOf[k]; next.push(q); }
    }
    frontier = next;
  }
  // 3. priority flood on height-above-river.
  const need = new Float32Array(N).fill(Infinity), rel = new Float32Array(N), s = new Float32Array(N);
  const heap = [], hk = [];
  const push = (key, k) => { let i = heap.length; heap.push(key); hk.push(k); while (i > 0) { const p = (i - 1) >> 1; if (heap[p] <= key) break; heap[i] = heap[p]; hk[i] = hk[p]; i = p; } heap[i] = key; hk[i] = k; };
  const pop = () => {
    const top = hk[0], key = heap.pop(), k = hk.pop(), len = heap.length;
    if (len) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= len) break; if (c + 1 < len && heap[c + 1] < heap[c]) c++; if (heap[c] >= key) break; heap[i] = heap[c]; hk[i] = hk[c]; i = c; } heap[i] = key; hk[i] = k; }
    return top;
  };
  for (const k of sCell) { need[k] = 0; push(0, k); }
  const done = new Uint8Array(N), cells = [];
  while (heap.length) {
    const key = heap[0], k = pop();
    if (done[k]) continue; done[k] = 1;
    const sd = seedOf[k]; rel[k] = Math.max(0, d[k] - sBed[sd]); s[k] = sS[sd]; cells.push(k);
    const x = k % n; if (x < 1 || x >= n - 1 || k < n || k >= N - n) continue;
    for (const o of NB) {
      const q = k + o; if (done[q] || seedOf[q] < 0) continue;
      const nd = Math.max(key, d[q] - sBed[seedOf[q]]);
      if (nd < need[q] && nd <= MAX_STAGE) { need[q] = nd; push(nd, q); }
    }
  }
  // cells come out of the heap in order of need, so area(h) is a binary search.
  const cellArr = Uint32Array.from(cells), needSorted = Float32Array.from(cells, (k) => need[k]);
  const countBelow = (h) => { let lo = 0, hi = needSorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (needSorted[m] < h) lo = m + 1; else hi = m; } return lo; };
  let sMin = Infinity, sMax = -Infinity; for (const v of sS) { if (v < sMin) sMin = v; if (v > sMax) sMax = v; }
  return { n, cs, need, rel, s, cells: cellArr, countBelow, cellArea: cs * cs, riverLen, seeds: sCell.length, sMin, sMax,
    wet: (k, h) => k >= 0 && need[k] < h, depth: (k, h) => (k >= 0 && need[k] < h ? h - rel[k] : 0) };
}

// Paint the water into an ImageData the size of the grid. stage(s) gives the water level above the river at river
// distance s, so a surge can travel downstream. Returns { cells, deepest }.
export function paintFlood(model, img, stage, time, prevCount) {
  const { cells, need, rel, s } = model, px = img.data;
  let wetCells = 0, deepest = 0;
  const flat = typeof stage === 'number';
  // dry everything that could have been wet last frame
  const upto = flat ? Math.max(model.countBelow(stage), prevCount || 0) : cells.length;
  for (let i = 0; i < upto; i++) {
    const k = cells[i], sk = s[k], h = flat ? stage : stage(sk), p = k * 4;
    if (need[k] >= h) { px[p + 3] = 0; continue; }
    const depth = h - rel[k], t = depth >= 14 ? 1 : depth / 14;
    // travelling bands along the river, broken up per cell so it reads as moving water rather than stripes
    const band = Math.sin(sk * 0.021 - time * 2.6 + ((k * 2654435761) >>> 24) * 0.012) * 0.5 + 0.5;
    const lift = band * 20 * (1 - t * 0.4);
    px[p] = 138 - 112 * t + lift; px[p + 1] = 198 - 112 * t + lift; px[p + 2] = 226 - 70 * t + lift * 0.7;
    px[p + 3] = 70 + 135 * Math.sqrt(t);
    wetCells++; if (depth > deepest) deepest = depth;
  }
  return { cells: wetCells, deepest, upto };
}

// The water's edge as smooth polygons (lon/lat), found between cells from how far each is above or below the level.
// box is [x0, y0, x1, y1] in cells, the part of the grid the model can touch. contours is d3.contours.
export function shoreline(model, box, stage, contours) {
  const { n, need, s } = model, x0 = box[0] - 1, y0 = box[1] - 1, w = box[2] - box[0] + 3, hgt = box[3] - box[1] + 3, f = new Float32Array(w * hgt).fill(-1.5), flat = typeof stage === 'number';
  let any = false;
  for (let i = 0; i < model.cells.length; i++) {
    const k = model.cells[i], v = (flat ? stage : stage(s[k])) - need[k]; if (v > 0) any = true;
    f[(((k / n) | 0) - y0) * w + (k % n) - x0] = v > 1.5 ? 1.5 : v < -1.5 ? -1.5 : v;
  }
  if (!any) return { type: 'FeatureCollection', features: [] };
  const mp = contours().size([w, hgt]).smooth(true).thresholds([0])(f)[0];
  const coords = mp.coordinates.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => fromUnit((x0 + x) / n, (y0 + y) / n))));
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind: 'water' }, geometry: { type: 'MultiPolygon', coordinates: coords } }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Sun and shade.
// ---------------------------------------------------------------------------------------------------------------
// The elevation grid at a working size of at most 512, for the heavier per-cell marches.
export function coarse(dem) {
  if (dem.n <= 512) return dem;
  const f = dem.n / 512, n = 512, data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let sum = 0; for (let y = 0; y < f; y++) for (let x = 0; x < f; x++) sum += dem.data[(j * f + y) * dem.n + i * f + x];
    data[j * n + i] = sum / (f * f);
  }
  return { n, data, cs: dem.cs * f, min: dem.min, max: dem.max };
}

// 1 where the terrain blocks the sun, for a sun at azimuth az (degrees from north) and altitude alt (degrees).
export function shadowGrid(c, az, alt, out = new Uint8Array(c.n * c.n)) {
  const { n, data: d, cs, max } = c;
  if (alt <= 0) { out.fill(1); return out; }
  const a = (az * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a), rise = Math.tan((alt * Math.PI) / 180) * cs;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, z0 = d[k]; let x = i, y = j, z = z0 + 2, hit = 0;
    for (;;) {
      x += dx; y += dy; z += rise;
      if (z > max || x < 0 || y < 0 || x > n - 1 || y > n - 1) break;
      if (d[(y + 0.5 | 0) * n + (x + 0.5 | 0)] > z) { hit = 1; break; }
    }
    out[k] = hit;
  }
  return out;
}

// Terrain horizon (degrees above level) for each whole degree of azimuth, seen from a point 2 m above the ground.
// Only terrain inside the grid counts, so far-off ridges beyond about 4 km are not included.
export function horizonAt(c, lon, lat) {
  const [u, v] = toUnit(lon, lat), n = c.n, x0 = u * n - 0.5, y0 = v * n - 0.5;
  const z0 = c.data[Math.max(0, Math.min(n - 1, Math.round(y0))) * n + Math.max(0, Math.min(n - 1, Math.round(x0)))] + 2;
  const out = new Float32Array(360);
  for (let az = 0; az < 360; az++) {
    const a = (az * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a); let best = 0;
    for (let r = 2; ; r++) {
      const x = Math.round(x0 + dx * r), y = Math.round(y0 + dy * r);
      if (x < 0 || y < 0 || x >= n || y >= n) break;
      const ang = Math.atan2(c.data[y * n + x] - z0, r * c.cs); if (ang > best) best = ang;
    }
    out[az] = (best * 180) / Math.PI;
  }
  return out;
}

// Elevation samples along a drawn line (lon/lat points), about one per grid cell.
export function profile(dem, pts) {
  const out = []; let dist = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = haversine(pts[i - 1], pts[i]), steps = Math.max(1, Math.ceil(seg / dem.cs));
    for (let q = i === 1 ? 0 : 1; q <= steps; q++) {
      const f = q / steps, ll = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
      out.push({ d: dist + seg * f, z: dem.at(ll[0], ll[1]), ll });
    }
    dist += seg;
  }
  let up = 0, down = 0, surface = 0, steep = 0;
  for (let i = 1; i < out.length; i++) {
    const dz = out[i].z - out[i - 1].z, dd = out[i].d - out[i - 1].d;
    if (!(dz === dz)) continue;
    if (dz > 0) up += dz; else down -= dz;
    surface += Math.hypot(dz, dd);
    out[i].slope = (Math.atan2(Math.abs(dz), dd) * 180) / Math.PI; if (out[i].slope > steep) steep = out[i].slope;
  }
  return { samples: out, length: dist, surface, up, down, steep };
}
