// Synthetic nadir drone photographs for the aerial workspace: a procedural, labelled test set.
//
// buildScene / buildSiteScene make a plain-data scene (display list + exact ground truth for figures and
// distractors); renderScene paints it as a soft, noisy, cheap-drone photograph; mutateScene makes the "later pass"
// of the same ground with a known list of changes. Everything is seeded: same seed, same pixels.
// Runs in a window or in a Worker (OffscreenCanvas only, no DOM). Coordinates are image pixels; x right, y down.

const TAU = Math.PI * 2;
const SHADOW = 'rgba(18,20,34,0.5)';

// ---------------------------------------------------------------- random numbers and small helpers
function mk(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  r.gauss = () => (r() + r() + r() + r() - 2) * 1.732;
  r.shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; };
  return r;
}
const mix = (seed, n) => (Math.imul((seed ^ Math.imul(n + 1, 0x9E3779B1)) >>> 0, 0x85EBCA6B) ^ (seed >>> 13) ^ (n << 7)) >>> 0;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function css(c, f = 1, a) {
  const r = Math.max(0, Math.min(255, Math.round(c[0] * f))), g = Math.max(0, Math.min(255, Math.round(c[1] * f))), b = Math.max(0, Math.min(255, Math.round(c[2] * f)));
  return a === undefined ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}
function rectPts(cx, cy, l, w, rot) {
  const c = Math.cos(rot), s = Math.sin(rot), hl = l / 2, hw = w / 2;
  return [[cx - hl * c + hw * s, cy - hl * s - hw * c], [cx + hl * c + hw * s, cy + hl * s - hw * c], [cx + hl * c - hw * s, cy + hl * s + hw * c], [cx - hl * c - hw * s, cy - hl * s + hw * c]];
}
function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
const castHull = (pts, off) => hull(pts.concat(pts.map((p) => [p[0] + off[0], p[1] + off[1]])));
function inPoly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
const inAny = (polys, x, y) => { for (const p of polys) if (inPoly(p, x, y)) return true; return false; };
function bboxOf(pts, pad = 0) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [Math.floor(x0 - pad), Math.floor(y0 - pad), Math.ceil(x1 + pad), Math.ceil(y1 + pad)];
}
const bbUnion = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const bbClip = (b, w, h) => [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(w, b[2]), Math.min(h, b[3])];
function polyArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return Math.abs(a) / 2; }
function polyPath(c, pts, ox = 0, oy = 0) {
  c.moveTo(pts[0][0] + ox, pts[0][1] + oy);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0] + ox, pts[i][1] + oy);
  c.closePath();
}
function blobPath(c, pts, ox = 0, oy = 0) {
  const n = pts.length;
  c.moveTo((pts[n - 1][0] + pts[0][0]) / 2 + ox, (pts[n - 1][1] + pts[0][1]) / 2 + oy);
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; c.quadraticCurveTo(a[0] + ox, a[1] + oy, (a[0] + b[0]) / 2 + ox, (a[1] + b[1]) / 2 + oy); }
  c.closePath();
}
function curvePath(c, pts) {
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) c.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
  c.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
}
// An irregular closed outline around (cx, cy): an ellipse pushed in and out by a few harmonics.
function blobPts(R, cx, cy, rx, ry, rot, n = 14, rough = 0.2) {
  const p1 = R() * TAU, p2 = R() * TAU, p3 = R() * TAU, c = Math.cos(rot), s = Math.sin(rot), out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, m = 1 + rough * (0.6 * Math.sin(2 * a + p1) + 0.45 * Math.sin(3 * a + p2) + 0.3 * Math.sin(5 * a + p3)) + (R() - 0.5) * rough * 0.5;
    const x = Math.cos(a) * rx * m, y = Math.sin(a) * ry * m;
    out.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return out;
}
// Break the straight edges of a polygon so it reads as a natural outline.
function organic(R, poly, step, jit) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / step));
    for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n + (R() - 0.5) * 2 * jit, a[1] + ((b[1] - a[1]) * j) / n + (R() - 0.5) * 2 * jit]);
  }
  return out;
}

// ---------------------------------------------------------------- noise
function h2(ix, iy, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let tx = x - ix, ty = y - iy;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const a = h2(ix, iy, seed), b = h2(ix + 1, iy, seed), c = h2(ix, iy + 1, seed), d = h2(ix + 1, iy + 1, seed);
  const top = a + (b - a) * tx;
  return (top + (c + (d - c) * tx - top) * ty) * 2 - 1;
}
// out += amp * noise(ground position): one rotated octave over the whole frame, a pure function of ground x, y.
function addNoise(out, w, h, gx0, gy0, freq, ang, seed, amp) {
  const ca = Math.cos(ang) * freq, sa = Math.sin(ang) * freq;
  let i = 0;
  for (let y = 0; y < h; y++) {
    const gy = gy0 + y, uy = -gy * sa, vy = gy * ca;
    let ix = NaN, iy = NaN, a = 0, b = 0, c = 0, d = 0;
    for (let x = 0; x < w; x++, i++) {
      const gx = gx0 + x, u = gx * ca + uy, v = gx * sa + vy, fu = Math.floor(u), fv = Math.floor(v);
      if (fu !== ix || fv !== iy) { ix = fu; iy = fv; a = h2(ix, iy, seed); b = h2(ix + 1, iy, seed); c = h2(ix, iy + 1, seed); d = h2(ix + 1, iy + 1, seed); }
      let tx = u - fu, ty = v - fv;
      tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const top = a + (b - a) * tx;
      out[i] += amp * ((top + (c + (d - c) * tx - top) * ty) * 2 - 1);
    }
  }
}

// ---------------------------------------------------------------- ground (per pixel)
const PAD = 24, MS = 8; // mask padding (px) and mask down-scale
const GROUND = {
  flood: { dark: [86, 80, 72], light: [156, 147, 133], veg: [91, 94, 70], gravel: [147, 142, 132] },
  dry: { dark: [122, 108, 88], light: [182, 167, 141], veg: [98, 104, 72], gravel: [160, 154, 142] },
};

// Material mask: red = wet / fresh debris-flow mud, green = compacted gravel (lanes), blue = vegetated or dry ground.
// Drawn small on a grid locked to ground coordinates, then enlarged, so a shifted frame gets the same edges.
function materialMask(scene, sx, sy) {
  const w = scene.w, h = scene.h, UW = w + 2 * PAD, UH = h + 2 * PAD;
  const g0x = Math.floor((-PAD - sx) / MS) * MS, g0y = Math.floor((-PAD - sy) / MS) * MS;
  const mw = Math.ceil(UW / MS) + 2, mh = Math.ceil(UH / MS) + 2;
  const M = new OffscreenCanvas(mw, mh), m = M.getContext('2d');
  m.fillStyle = '#000'; m.fillRect(0, 0, mw, mh);
  m.setTransform(1 / MS, 0, 0, 1 / MS, -g0x / MS, -g0y / MS);
  m.globalCompositeOperation = 'lighter';
  m.lineJoin = 'round'; m.lineCap = 'round';
  const COL = ['#ff0000', '#00ff00', '#0000ff'];
  for (const o of scene.objects) {
    if (o.t !== 'patch') continue;
    m.fillStyle = m.strokeStyle = COL[o.ch];
    m.beginPath();
    if (o.line) { curvePath(m, o.line); m.lineWidth = o.width; m.stroke(); } else { blobPath(m, o.poly); m.fill(); }
  }
  const U = new OffscreenCanvas(UW, UH), u = U.getContext('2d', { willReadFrequently: true });
  u.imageSmoothingEnabled = true; u.imageSmoothingQuality = 'low';
  u.drawImage(M, g0x + sx + PAD, g0y + sy + PAD, mw * MS, mh * MS);
  return { data: u.getImageData(0, 0, UW, UH).data, UW };
}

function groundLayer(scene, sx, sy) {
  const w = scene.w, h = scene.h, n = w * h, k = scene.pxPerM / 16, seed = (scene.seed | 0) ^ 0x51ed;
  const gx0 = -sx, gy0 = -sy;
  const T = new Float32Array(n), T2 = new Float32Array(n), WX = new Float32Array(n), WY = new Float32Array(n), S = new Float32Array(n), D = new Float32Array(n);
  addNoise(T, w, h, gx0, gy0, 1 / (240 * k), 0.35, seed + 11, 0.55);
  addNoise(T, w, h, gx0, gy0, 1 / (96 * k), 1.2, seed + 12, 0.32);
  addNoise(T, w, h, gx0, gy0, 1 / (37 * k), 2.1, seed + 13, 0.2);
  addNoise(T2, w, h, gx0, gy0, 1 / (130 * k), 0.9, seed + 14, 0.7);
  addNoise(T2, w, h, gx0, gy0, 1 / (30 * k), 2.6, seed + 15, 0.3);
  addNoise(WX, w, h, gx0, gy0, 1 / (70 * k), 0.5, seed + 16, 15 * k);
  addNoise(WX, w, h, gx0, gy0, 1 / (19 * k), 1.9, seed + 17, 4 * k);
  addNoise(WY, w, h, gx0, gy0, 1 / (70 * k), 1.4, seed + 18, 15 * k);
  addNoise(WY, w, h, gx0, gy0, 1 / (19 * k), 2.8, seed + 19, 4 * k);
  addNoise(D, w, h, gx0, gy0, 1 / (11 * k), 0.7, seed + 20, 0.55);
  addNoise(D, w, h, gx0, gy0, 1 / (4.3 * k), 1.6, seed + 21, 0.33);
  addNoise(D, w, h, gx0, gy0, 1 / (1.9 * k), 2.5, seed + 22, 0.2);
  // flow streaks: noise stretched along the flow direction, read at a warped position
  const fa = scene.flow || 0, cf = Math.cos(fa), sf = Math.sin(fa), s1 = seed + 23, s2 = seed + 24;
  const a1 = 1 / (120 * k), b1 = 1 / (13 * k), a2 = 1 / (44 * k), b2 = 1 / (4.2 * k);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const px = gx0 + x + WX[i], py = gy0 + y + WY[i], u = px * cf + py * sf, v = -px * sf + py * cf;
      S[i] = 0.62 * vnoise(u * a1, v * b1, s1) + 0.38 * vnoise(u * a2, v * b2, s2);
    }
  }
  const mask = materialMask(scene, sx, sy), md = mask.data, UW = mask.UW;
  const pal = GROUND[scene.ground] || GROUND.flood, dk = pal.dark, lt = pal.light, vg = pal.veg, gv = pal.gravel;
  const img = new ImageData(w, h), px = img.data, lim = PAD - 1;
  const eoff = Math.round(scene.sun[0] * 2) + Math.round(scene.sun[1] * 2) * w;
  for (let y = 0, i = 0, j = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++, j += 4) {
      const t = T[i], s = S[i], d = D[i], t2 = T2[i];
      let wx = WX[i] * 0.8, wy = WY[i] * 0.8;
      wx = wx > lim ? lim : wx < -lim ? -lim : wx; wy = wy > lim ? lim : wy < -lim ? -lim : wy;
      const mi = ((y + PAD + (wy | 0)) * UW + x + PAD + (wx | 0)) * 4;
      const wet = clamp01((md[mi] / 255 - 0.5) * 3.2 + 0.5 + d * 0.3);
      const grav = clamp01((md[mi + 1] / 255 - 0.5) * 2.6 + 0.5 + d * 0.35);
      const veg = clamp01((md[mi + 2] / 255 - 0.5) * 2.6 + 0.5 + d * 0.4);
      const gr = h2(gx0 + x, gy0 + y, seed) - 0.5;
      let v = clamp01(0.5 + 0.37 * t + 0.1 * s + 0.1 * d);
      let r = dk[0] + (lt[0] - dk[0]) * v + t2 * 5, g = dk[1] + (lt[1] - dk[1]) * v + t2 * 1.5, b = dk[2] + (lt[2] - dk[2]) * v - t2 * 5;
      // strand lines left by the water: thin darker contours of the streak field
      const sl = Math.abs(s - 0.08);
      if (sl < 0.02) { const q = 1 - 0.06 * (1 - sl / 0.02); r *= q; g *= q; b *= q; }
      if (grav > 0) {
        const q = grav * 0.7, e = 1 + gr * 0.2 + d * 0.08 + t * 0.1;
        r += (gv[0] * e - r) * q; g += (gv[1] * e - g) * q; b += (gv[2] * e - b) * q;
      }
      if (veg > 0) {
        const q = veg * clamp01((d * 1.2 + t2 * 0.9 + 0.35) * 2.2) * 0.86, e = 0.86 + d * 0.2 + gr * 0.18;
        r += (vg[0] * e - r) * q; g += (vg[1] * e - g) * q; b += (vg[2] * e - b) * q;
      }
      let ga = 0.11;
      if (wet > 0) {
        const f = 1 - 0.37 * wet;
        r = r * f + 3 * wet; g *= f; b = b * f - 2 * wet;
        const sh = clamp01((s - 0.3) * 2.4) * wet * 0.3;
        r += (150 - r) * sh; g += (157 - g) * sh; b += (162 - b) * sh;
        ga = 0.11 - 0.05 * wet;
      }
      // micro-relief: the fine noise lit from the sun side
      const ei = i + eoff;
      let m = 1 + gr * ga + (ei >= 0 && ei < n ? (d - D[ei]) * 0.3 : 0);
      const pp = gr + 0.5;
      if (pp > 0.992) m += 0.2; else if (pp < 0.007) m -= 0.2;
      px[j] = r * m; px[j + 1] = g * m; px[j + 2] = b * m; px[j + 3] = 255;
    }
  }
  return { img, D };
}

// ---------------------------------------------------------------- palettes (background stays low-saturation)
const PAL = {
  masonry: [[146, 142, 134], [126, 122, 116], [160, 155, 146], [134, 108, 95], [118, 97, 86], [172, 168, 158], [102, 98, 94]],
  stone: [[134, 130, 122], [112, 108, 100], [156, 150, 140], [124, 114, 100], [98, 94, 88]],
};
const TIMBER = [[126, 108, 86], [150, 134, 110], [100, 84, 66], [168, 152, 124], [86, 76, 64]];
const BOULDER = [[136, 131, 122], [118, 112, 102], [158, 152, 142], [128, 118, 104], [146, 142, 138]];
const ROOF_TONES = [[146, 152, 158], [124, 127, 128], [130, 108, 92], [170, 176, 180]];
const WALL_PAL = { stone: [[150, 144, 132], [130, 124, 114], [166, 160, 148]], masonry: [[172, 164, 150], [148, 124, 108], [188, 182, 170]] };

// ---------------------------------------------------------------- rubble, timber, boulders, scrub, water
function genChunks(R, n, place, smin, smax, npal, out = []) {
  for (let i = 0; i < n; i++) {
    const q = place(), u = R(), s = smin + (smax - smin) * u * u * u;
    const nv = 4 + Math.floor(R() * 3), rot = R() * TAU, asp = 0.55 + R() * 0.45, cr = Math.cos(rot), sr = Math.sin(rot), p = [];
    for (let j = 0; j < nv; j++) {
      const a = ((j + (R() - 0.5) * 0.6) / nv) * TAU, rr = s * (0.75 + R() * 0.45), lx = Math.cos(a) * rr, ly = Math.sin(a) * rr * asp;
      p.push([q[0] + lx * cr - ly * sr, q[1] + lx * sr + ly * cr]);
    }
    out.push({ x: q[0], y: q[1], p, s, c: Math.floor(R() * npal), h: s * (0.5 + R() * 0.8) });
  }
  return out;
}
function drawChunks(c, list, pal, sun, sl) {
  c.fillStyle = SHADOW; c.beginPath();
  for (const q of list) if (q.s >= 1.2) polyPath(c, q.p, sun[0] * q.h * sl, sun[1] * q.h * sl);
  c.fill();
  for (let t = 0; t < pal.length; t++) {
    let any = false;
    c.fillStyle = css(pal[t], 0.68); c.beginPath();
    for (const q of list) {
      if (q.c !== t) continue;
      any = true;
      if (q.s >= 1.2) polyPath(c, q.p); else c.rect(q.x - q.s * 0.7, q.y - q.s * 0.7, q.s * 1.4, q.s * 1.4);
    }
    if (!any) continue;
    c.fill();
    c.fillStyle = css(pal[t], 1.05); c.beginPath();
    for (const q of list) {
      if (q.c !== t || q.s < 1.2) continue;
      const ox = -sun[0] * q.h * 0.22, oy = -sun[1] * q.h * 0.22, p = q.p;
      c.moveTo(q.x + (p[0][0] - q.x) * 0.74 + ox, q.y + (p[0][1] - q.y) * 0.74 + oy);
      for (let i = 1; i < p.length; i++) c.lineTo(q.x + (p[i][0] - q.x) * 0.74 + ox, q.y + (p[i][1] - q.y) * 0.74 + oy);
      c.closePath();
    }
    c.fill();
  }
}
function drawRub(c, o, env) {
  const R = mk(o.seed), k = env.k, pal = PAL[o.pal] || PAL.masonry;
  let place;
  if (o.poly) {
    const bb = bboxOf(o.poly);
    place = () => { for (let i = 0; i < 40; i++) { const x = R.range(bb[0], bb[2]), y = R.range(bb[1], bb[3]); if (inPoly(o.poly, x, y)) return [x, y]; } return [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]; };
    if (o.dust !== 0) { c.fillStyle = 'rgba(176,168,154,0.22)'; c.beginPath(); blobPath(c, o.poly); c.fill(); }
  } else {
    const cr = Math.cos(o.rot || 0), sr = Math.sin(o.rot || 0);
    place = () => { const x = ((R() + R() + R() - 1.5) / 1.5) * o.rx, y = ((R() + R() + R() - 1.5) / 1.5) * o.ry; return [o.cx + x * cr - y * sr, o.cy + x * sr + y * cr]; };
    if (o.dust !== 0) {
      c.save(); c.translate(o.cx, o.cy); c.rotate(o.rot || 0); c.scale(1, o.ry / o.rx);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, o.rx * 1.1);
      g.addColorStop(0, 'rgba(178,170,156,0.42)'); g.addColorStop(0.6, 'rgba(178,170,156,0.2)'); g.addColorStop(1, 'rgba(178,170,156,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, o.rx * 1.1, 0, TAU); c.fill(); c.restore();
    }
  }
  drawChunks(c, genChunks(R, o.n, place, o.smin * k, o.smax * k, pal.length), pal, env.sun, env.sl);
}
function genPlanks(R, o, k) {
  const list = [];
  for (let i = 0; i < o.n; i++) {
    const a = R() * TAU, d = Math.sqrt(R()) * o.r * k;
    list.push({ x: o.cx + Math.cos(a) * d, y: o.cy + Math.sin(a) * d * 0.7, l: R.range(o.lmin, o.lmax) * k, w: R.range(o.wmin || 0.1, o.wmax || 0.22) * k, r: o.rot + R.gauss() * o.spread, c: R.int(0, 4), h: R.range(0.04, 0.3) * k });
  }
  return list;
}
function drawPlanks(c, list, sun, sl, dark = 0.8) {
  c.fillStyle = SHADOW; c.beginPath();
  for (const q of list) polyPath(c, rectPts(q.x + sun[0] * q.h * sl, q.y + sun[1] * q.h * sl, q.l, q.w, q.r));
  c.fill();
  for (let t = 0; t < TIMBER.length; t++) {
    let any = false;
    c.fillStyle = css(TIMBER[t], dark); c.beginPath();
    for (const q of list) if (q.c === t) { any = true; polyPath(c, rectPts(q.x, q.y, q.l, q.w, q.r)); }
    if (!any) continue;
    c.fill();
    c.fillStyle = css(TIMBER[t], dark * 1.38); c.beginPath();
    for (const q of list) if (q.c === t) polyPath(c, rectPts(q.x - sun[0] * q.w * 0.2, q.y - sun[1] * q.w * 0.2, q.l * 0.97, Math.max(0.7, q.w * 0.42), q.r));
    c.fill();
  }
}
function drawBoulders(c, o, env) {
  const R = mk(o.seed), k = env.k, sun = env.sun, sl = env.sl, bl = [];
  const add = (x, y, s) => { const rad = s * k; bl.push({ x, y, rad, col: BOULDER[R.int(0, BOULDER.length - 1)], pts: blobPts(R, x, y, rad, rad * (0.66 + R() * 0.3), R() * TAU, 9, 0.16) }); };
  if (o.items) for (const it of o.items) add(it[0], it[1], it[2]);
  else {
    const cr = Math.cos(o.rot || 0), sr = Math.sin(o.rot || 0);
    for (let i = 0; i < o.n; i++) {
      const x = ((R() + R() - 1)) * o.rx, y = ((R() + R() - 1)) * o.ry, u = R();
      add(o.cx + x * cr - y * sr, o.cy + x * sr + y * cr, o.smin + (o.smax - o.smin) * u * u * u);
    }
  }
  bl.sort((a, b) => a.rad - b.rad);
  c.fillStyle = SHADOW; c.beginPath();
  for (const b of bl) blobPath(c, b.pts, sun[0] * b.rad * 0.75 * sl, sun[1] * b.rad * 0.75 * sl);
  c.fill();
  for (const b of bl) {
    const g = c.createLinearGradient(b.x - sun[0] * b.rad, b.y - sun[1] * b.rad, b.x + sun[0] * b.rad, b.y + sun[1] * b.rad);
    g.addColorStop(0, css(b.col, 1.17)); g.addColorStop(0.55, css(b.col, 0.93)); g.addColorStop(1, css(b.col, 0.56));
    c.fillStyle = g; c.beginPath(); blobPath(c, b.pts); c.fill();
    if (b.rad > 4) {
      c.fillStyle = css(b.col, 1.26, 0.45); c.beginPath();
      c.ellipse(b.x - sun[0] * b.rad * 0.32, b.y - sun[1] * b.rad * 0.32, b.rad * 0.42, b.rad * 0.26, R() * TAU, 0, TAU); c.fill();
      c.fillStyle = css(b.col, 0.6, 0.35); c.beginPath();
      c.ellipse(b.x + (R() - 0.5) * b.rad, b.y + (R() - 0.5) * b.rad, b.rad * 0.22, b.rad * 0.1, R() * TAU, 0, TAU); c.fill();
    }
  }
}
function drawScrub(c, o, env) {
  const R = mk(o.seed), k = env.k, sun = env.sun, sl = env.sl, lv = [];
  for (let i = 0; i < o.n; i++) {
    const bx = o.cx + R.gauss() * o.r * k * 0.45, by = o.cy + R.gauss() * o.r * k * 0.45, br = R.range(0.3, 1.0) * (o.size || 1) * k, m = 7 + Math.floor((br / k) * 14);
    for (let j = 0; j < m; j++) lv.push([bx + R.gauss() * br * 0.45, by + R.gauss() * br * 0.45, br * R.range(0.16, 0.36), R()]);
  }
  const pass = (style, off, rm, pmin) => {
    c.fillStyle = style; c.beginPath();
    for (const l of lv) { if (l[3] < pmin) continue; const x = l[0] + sun[0] * l[2] * off, y = l[1] + sun[1] * l[2] * off, r = l[2] * rm; c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
    c.fill();
  };
  pass(SHADOW, 1.1 * sl, 1, 0);
  pass('rgb(56,61,46)', 0, 1, 0);
  pass('rgb(75,80,57)', -0.3, 0.68, 0);
  pass('rgb(98,101,73)', -0.5, 0.36, 0.4);
}
function drawPuddle(c, o, env) {
  const R = mk(o.seed), pts = blobPts(R, o.cx, o.cy, o.rx, o.ry, o.rot, 16, 0.34);
  for (const f of [1.5, 1.22]) { c.fillStyle = 'rgba(60,52,44,0.24)'; c.beginPath(); blobPath(c, pts.map((p) => [o.cx + (p[0] - o.cx) * f, o.cy + (p[1] - o.cy) * f])); c.fill(); }
  const a = R() * TAU, g = c.createLinearGradient(o.cx - Math.cos(a) * o.rx, o.cy - Math.sin(a) * o.rx, o.cx + Math.cos(a) * o.rx, o.cy + Math.sin(a) * o.rx);
  g.addColorStop(0, 'rgb(126,133,136)'); g.addColorStop(1, 'rgb(94,98,97)');
  c.fillStyle = g; c.beginPath(); blobPath(c, pts); c.fill();
  c.strokeStyle = 'rgba(70,62,52,0.6)'; c.lineWidth = 1.2; c.stroke();
  c.fillStyle = 'rgba(122,112,96,0.5)'; c.beginPath();
  blobPath(c, pts.map((p) => [o.cx + (p[0] - o.cx) * 0.5 + o.rx * 0.2, o.cy + (p[1] - o.cy) * 0.5])); c.fill();
}
function drawRuts(c, o, env) {
  const k = env.k, g = (o.gauge * k) / 2, R = mk(o.seed), a = o.a || 1, pts = o.pts, n = pts.length;
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const side of [-1, 1]) {
    const q = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(n - 1, i + 1)], dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy) || 1;
      q.push([pts[i][0] - (dy / len) * g * side, pts[i][1] + (dx / len) * g * side]);
    }
    c.strokeStyle = 'rgba(50,42,34,' + 0.3 * a + ')'; c.lineWidth = 0.3 * k; c.beginPath(); curvePath(c, q); c.stroke();
    c.strokeStyle = 'rgba(198,188,168,' + 0.2 * a + ')'; c.lineWidth = 0.11 * k; c.beginPath();
    curvePath(c, q.map((p) => [p[0] - env.sun[0] * 0.2 * k, p[1] - env.sun[1] * 0.2 * k])); c.stroke();
    c.strokeStyle = 'rgba(118,126,130,0.7)'; c.lineWidth = 0.2 * k;
    for (let i = 0; i < n - 1; i++) if (R() < (o.water || 0)) { c.beginPath(); c.moveTo(q[i][0], q[i][1]); c.lineTo((q[i][0] + q[i + 1][0]) / 2, (q[i][1] + q[i + 1][1]) / 2); c.stroke(); }
  }
}

// ---------------------------------------------------------------- roofs, walls
function looseSheets(c, list, sunL, sl, k) {
  c.fillStyle = SHADOW; c.beginPath();
  for (const q of list) polyPath(c, rectPts(q.x + sunL[0] * q.h * sl, q.y + sunL[1] * q.h * sl, q.l, q.w, q.r));
  c.fill();
  for (const q of list) {
    c.save(); c.translate(q.x, q.y); c.rotate(q.r);
    c.fillStyle = css(q.col, q.f); c.fillRect(-q.l / 2, -q.w / 2, q.l, q.w);
    if (q.bend) { c.fillStyle = q.bend > 0 ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.2)'; c.fillRect(-q.l / 2 + q.l * Math.abs(q.bend), -q.w / 2, q.l * (1 - Math.abs(q.bend)), q.w); }
    if (q.rust) { c.fillStyle = 'rgba(118,84,62,' + q.rust + ')'; c.fillRect(-q.l / 2, -q.w / 2, q.l * 0.45, q.w); }
    c.strokeStyle = 'rgba(0,0,0,0.13)'; c.lineWidth = 0.6; c.beginPath();
    for (let y = -q.w / 2 + 0.2 * k; y < q.w / 2 - 1; y += 0.2 * k) { c.moveTo(-q.l / 2, y); c.lineTo(q.l / 2, y); }
    c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 0.7; c.strokeRect(-q.l / 2, -q.w / 2, q.l, q.w);
    c.restore();
  }
}
function stubsOf(o, k) {
  const R = mk(mix(o.seed, 77)), L = o.l, W = o.w, out = [];
  const per = [[-L / 2, -W / 2, L / 2, -W / 2], [L / 2, -W / 2, L / 2, W / 2], [L / 2, W / 2, -L / 2, W / 2], [-L / 2, W / 2, -L / 2, -W / 2]];
  for (const [x0, y0, x1, y1] of per) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    let s = R() * 1.5 * k;
    while (s < len) {
      const e = Math.min(len, s + (1 + R() * 3.4) * k), keep = R() < 0.6, hh = 0.5 + R() * 1.3;
      if (keep) out.push({ a: [x0 + ((x1 - x0) * s) / len, y0 + ((y1 - y0) * s) / len], b: [x0 + ((x1 - x0) * e) / len, y0 + ((y1 - y0) * e) / len], h: hh });
      s = e + (0.4 + R() * 2.6) * k;
    }
  }
  return out;
}
const segQuad = (a, b, th) => { const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = (-dy / len) * th / 2, ny = (dx / len) * th / 2; return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]; };

function drawCollapsed(c, o, env) {
  const k = env.k, R = mk(mix(o.seed, 5)), L = o.l, W = o.w, cr = Math.cos(o.rot), sr = Math.sin(o.rot);
  const sunL = [env.sun[0] * cr + env.sun[1] * sr, -env.sun[0] * sr + env.sun[1] * cr], base = ROOF_TONES[o.tone % 4];
  const areaM = (L * W) / (k * k);
  c.save(); c.translate(o.cx, o.cy); c.rotate(o.rot);
  c.save(); c.scale(1, W / L);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, L * 0.78);
  g.addColorStop(0, 'rgba(180,172,158,0.5)'); g.addColorStop(0.65, 'rgba(180,172,158,0.3)'); g.addColorStop(1, 'rgba(180,172,158,0)');
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, L * 0.78, 0, TAU); c.fill(); c.restore();
  const inRect = () => [R.range(-L / 2, L / 2) + R.gauss() * 0.5 * k, R.range(-W / 2, W / 2) + R.gauss() * 0.5 * k];
  drawChunks(c, genChunks(R, Math.round(areaM * 2.6), inRect, 0.07 * k, 0.6 * k, PAL.masonry.length), PAL.masonry, sunL, env.sl);
  // wall stubs still standing
  const stubs = stubsOf(o, k), th = 0.44 * k;
  c.lineCap = 'butt';
  for (const s of stubs) { c.strokeStyle = 'rgb(112,106,96)'; c.lineWidth = th; c.beginPath(); c.moveTo(s.a[0], s.a[1]); c.lineTo(s.b[0], s.b[1]); c.stroke(); }
  for (const s of stubs) {
    c.strokeStyle = css([174, 166, 152], 0.9 + s.h * 0.08); c.lineWidth = th * 0.62; c.beginPath();
    c.moveTo(s.a[0] - sunL[0] * 0.8, s.a[1] - sunL[1] * 0.8); c.lineTo(s.b[0] - sunL[0] * 0.8, s.b[1] - sunL[1] * 0.8); c.stroke();
  }
  // broken rafters under the sheets
  const tim = (n, lmin, lmax) => { const l = []; for (let i = 0; i < n; i++) l.push({ x: R.range(-L / 2, L / 2), y: R.range(-W / 2, W / 2), l: R.range(lmin, lmax) * k, w: R.range(0.09, 0.16) * k, r: Math.PI / 2 + R.gauss() * 0.55, c: R.int(0, 4), h: R.range(0.05, 0.4) * k }); return l; };
  drawPlanks(c, tim(Math.round(areaM * 0.22), 1.4, 4.2), sunL, env.sl);
  // fallen sheets, bent and overlapping
  const sheets = [], ns = Math.round((areaM / 2.1) * R.range(0.42, 0.62));
  for (let i = 0; i < ns; i++) {
    const tone = R() < 0.2 ? ROOF_TONES[R.int(0, 3)] : base;
    sheets.push({ x: R.range(-L / 2, L / 2) * 1.08, y: R.range(-W / 2, W / 2) * 1.12, l: R.range(1.7, 2.9) * k, w: R.range(0.7, 0.85) * k, r: Math.PI / 2 + R.gauss() * 0.5 + (R() < 0.15 ? R() * 3 : 0), col: tone, f: R.range(0.8, 1.1), bend: R() < 0.5 ? R.range(-0.7, 0.7) : 0, rust: R() < 0.35 ? R.range(0.15, 0.5) : 0, h: R.range(0.08, 0.5) * k });
  }
  looseSheets(c, sheets, sunL, env.sl, k);
  drawChunks(c, genChunks(R, Math.round(areaM * 0.5), inRect, 0.07 * k, 0.4 * k, PAL.masonry.length), PAL.masonry, sunL, env.sl);
  drawPlanks(c, tim(Math.round(areaM * 0.08), 1.2, 3.4), sunL, env.sl);
  c.restore();
}

function drawRoof(c, o, env) {
  if (o.state === 'collapsed') return drawCollapsed(c, o, env);
  const k = env.k, R = mk(o.seed), L = o.l, W = o.w, cr = Math.cos(o.rot), sr = Math.sin(o.rot);
  const sunL = [env.sun[0] * cr + env.sun[1] * sr, -env.sun[0] * sr + env.sun[1] * cr], base = ROOF_TONES[o.tone % 4];
  const nc = Math.max(2, Math.round(L / (0.82 * k))), sp = L / nc, nr = Math.max(1, Math.round(W / 2 / (2.7 * k))), rh = W / 2 / nr;
  const miss = o.missing || 0, thr = 0.78 - miss * 1.7, rustP = o.tone % 4 === 2 ? 0.5 : 0.2;
  c.save(); c.translate(o.cx, o.cy); c.rotate(o.rot);
  c.fillStyle = css(base, 0.78); c.fillRect(-L / 2, -W / 2, L, W);
  const holes = [], torn = [], loose = [];
  for (const sg of [-1, 1]) {
    const lit = 1 - 0.12 * sg * sunL[1];
    for (let r = 0; r < nr; r++) {
      for (let i = 0; i < nc; i++) {
        const x = -L / 2 + i * sp, y = sg > 0 ? r * rh : -(r + 1) * rh, u = R(), u2 = R(), u3 = R(), u4 = R();
        const mx = x + sp / 2, my = y + rh / 2, ix = o.cx + mx * cr - my * sr, iy = o.cy + mx * sr + my * cr;
        let st = 0;
        if (o.torn && inAny(o.torn, ix, iy)) st = 2;
        else if (o.near && u < 0.42 && inAny(o.near, ix, iy)) st = 1;
        else if (miss > 0 && vnoise(mx / (2.3 * k), my / (2.6 * k), o.seed) + (u - 0.5) * 0.3 > thr) st = 1;
        if (st) {
          (st === 2 ? torn : holes).push([x, y, sp, rh]);
          if (st === 1 && u2 < 0.55 && (miss > 0.05 || o.near)) loose.push({ x: mx + (u3 - 0.5) * 2.6 * k, y: my + sg * u4 * 2.2 * k, l: rh * (0.75 + u4 * 0.25), w: sp, r: Math.PI / 2 + (u3 - 0.5) * 1.5, col: base, f: lit * (0.85 + u2 * 0.3), bend: u4 < 0.5 ? (u3 - 0.5) * 1.3 : 0, rust: u3 < 0.3 ? 0.35 : 0, h: (0.1 + u4 * 0.3) * k });
          continue;
        }
        let tone = base;
        if (u3 < 0.1) tone = ROOF_TONES[(o.tone + 1 + Math.floor(u3 * 30)) % 4];
        c.fillStyle = css(tone, lit * (0.93 + u2 * 0.14));
        c.fillRect(x + 0.25, y + 0.25, sp - 0.45, rh - 0.5);
        if (u4 < rustP) {
          const fr = 0.25 + u * 0.75;
          c.fillStyle = 'rgba(120,86,62,' + (0.14 + u2 * 0.36) + ')';
          c.fillRect(x + 0.35, sg > 0 ? y + rh * (1 - fr) : y, sp - 0.6, rh * fr);
        }
      }
    }
  }
  // corrugation, stains, ridge cap, edges
  c.strokeStyle = 'rgba(0,0,0,0.13)'; c.lineWidth = 0.7; c.beginPath();
  for (let x = -L / 2 + 0.1 * k; x < L / 2; x += 0.205 * k) { c.moveTo(x, -W / 2); c.lineTo(x, W / 2); }
  c.stroke();
  const nst = 2 + Math.floor((L * W) / (k * k) / 40);
  for (let i = 0; i < nst; i++) {
    c.fillStyle = R() < 0.6 ? 'rgba(40,34,28,' + R.range(0.05, 0.12) + ')' : 'rgba(118,86,64,' + R.range(0.08, 0.22) + ')';
    c.beginPath(); c.ellipse(R.range(-L / 2, L / 2), R.range(-W / 2, W / 2), R.range(0.4, 1.6) * k, R.range(1, 3.2) * k, R.gauss() * 0.12, 0, TAU); c.fill();
  }
  c.fillStyle = css(base, 1.06); c.fillRect(-L / 2, -0.17 * k, L, 0.34 * k);
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(-L / 2, (sunL[1] > 0 ? 0.17 : -0.17) * k - 0.4, L, 0.8);
  c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = 0.6; c.beginPath();
  for (let x = -L / 2 + 1.8 * k; x < L / 2; x += 1.8 * k) { c.moveTo(x, -0.17 * k); c.lineTo(x, 0.17 * k); }
  c.stroke();
  c.strokeStyle = 'rgba(20,18,16,0.4)'; c.lineWidth = 1; c.strokeRect(-L / 2 + 0.5, -W / 2 + 0.5, L - 1, W - 1);
  c.fillStyle = 'rgba(255,255,255,0.2)';
  if (sunL[1] > 0) c.fillRect(-L / 2, -W / 2, L, 1.2); else c.fillRect(-L / 2, W / 2 - 1.2, L, 1.2);
  if (sunL[0] > 0) c.fillRect(-L / 2, -W / 2, 1.2, W); else c.fillRect(L / 2 - 1.2, -W / 2, 1.2, W);
  const rafters = (p) => {
    c.strokeStyle = 'rgb(128,110,88)'; c.lineWidth = Math.max(1, 0.12 * k); c.beginPath();
    for (let x = -L / 2 + 0.6 * k; x < L / 2; x += 1.25 * k) if (R() < p) { const j = (1 - p) * R.gauss() * 0.3 * k; c.moveTo(x, -W / 2); c.lineTo(x + j, W / 2); }
    for (let y = -W / 2 + 0.5 * k; y < W / 2; y += 1.3 * k) if (R() < p) { const j = (1 - p) * R.gauss() * 0.4 * k; c.moveTo(-L / 2, y); c.lineTo(L / 2, y + j); }
    c.stroke();
  };
  if (holes.length) {
    c.save(); c.beginPath();
    for (const q of holes) c.rect(q[0], q[1], q[2], q[3]);
    c.clip();
    c.fillStyle = 'rgb(41,38,35)'; c.fillRect(-L / 2, -W / 2, L, W);
    const d = Math.min(o.h, 3.2) * env.sl * k;
    c.fillStyle = 'rgb(112,103,90)'; c.beginPath();
    for (const q of holes) c.rect(q[0] + sunL[0] * d, q[1] + sunL[1] * d, q[2], q[3]);
    c.fill();
    c.fillStyle = 'rgba(150,142,128,0.5)';
    for (const q of holes) for (let i = 0; i < 3; i++) c.fillRect(q[0] + R() * q[2], q[1] + R() * q[3], 1 + R() * 2.5, 1 + R() * 2);
    rafters(1);
    c.restore();
  }
  if (torn.length) {
    c.save(); c.beginPath();
    for (const q of torn) c.rect(q[0] - 0.3, q[1] - 0.3, q[2] + 0.6, q[3] + 0.6);
    c.clip();
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(env.G, 0, 0); c.restore();
    c.fillStyle = 'rgba(30,26,22,0.18)'; c.fillRect(-L / 2, -W / 2, L, W);
    rafters(0.45);
    c.restore();
  }
  if (loose.length) looseSheets(c, loose, sunL, env.sl, k);
  const nstone = Math.floor(((L * W) / (k * k) / 16) * R());
  if (nstone) drawChunks(c, genChunks(R, nstone, () => [R.range(-L / 2, L / 2) * 0.92, R.range(-W / 2, W / 2) * 0.92], 0.1 * k, 0.24 * k, PAL.stone.length), PAL.stone, sunL, env.sl);
  c.restore();
}

function drawWall(c, o, env) {
  const R = mk(o.seed), k = env.k, th = o.th * k, pal = WALL_PAL[o.kind] || WALL_PAL.stone, pts = o.pts, sun = env.sun;
  c.lineCap = 'butt'; c.lineJoin = 'miter';
  c.strokeStyle = css(pal[1], 0.62); c.lineWidth = th; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.stroke();
  const st = [[], [], []];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    let s = 0;
    while (s < len) {
      const l = Math.min(len - s, R.range(0.3, 0.62) * k), m = s + l / 2;
      if (R() > 0.05) st[R.int(0, 2)].push(rectPts(a[0] + ((b[0] - a[0]) * m) / len - sun[0] * 0.7, a[1] + ((b[1] - a[1]) * m) / len - sun[1] * 0.7, Math.max(1, l - 0.8), th * R.range(0.6, 0.8), ang + R.gauss() * 0.05));
      s += l;
    }
  }
  for (let t = 0; t < 3; t++) { c.fillStyle = css(pal[t], 1.0); c.beginPath(); for (const q of st[t]) polyPath(c, q); c.fill(); }
}

// ---------------------------------------------------------------- vehicles, tarps and other placed things
function rrect(c, x, y, w, h, r) {
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r); c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r); c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r); c.closePath();
}
const VEH = { l: 4.6, w: 1.8, h: 1.45 };
function drawVehicle(c, o, env) {
  const k = env.k, R = mk(o.seed), L = VEH.l * k, W = VEH.w * k, col = o.rgb, cr = Math.cos(o.rot), sr = Math.sin(o.rot);
  const sunL = [env.sun[0] * cr + env.sun[1] * sr, -env.sun[0] * sr + env.sun[1] * cr];
  c.save(); c.translate(o.cx, o.cy); c.rotate(o.rot);
  c.fillStyle = 'rgb(28,28,30)';
  for (const wx of [L * 0.3, -L * 0.3]) for (const sy of [-1, 1]) c.fillRect(wx - 0.36 * k, sy * (W / 2 + 0.05 * k) - 0.12 * k, 0.72 * k, 0.24 * k);
  c.fillStyle = css(col, 0.9);
  c.fillRect(L / 2 - 1.35 * k, -W / 2 - 0.13 * k, 0.16 * k, W + 0.26 * k);
  c.beginPath(); rrect(c, -L / 2, -W / 2, L, W, 0.26 * k); c.fill();
  c.save(); c.beginPath(); rrect(c, -L / 2, -W / 2, L, W, 0.26 * k); c.clip();
  // hood, glass, cab roof, load bed
  const g = c.createLinearGradient(L / 2 - 1.2 * k, 0, L / 2, 0);
  g.addColorStop(0, css(col, 1.02)); g.addColorStop(1, css(col, 0.86));
  c.fillStyle = g; c.fillRect(L / 2 - 1.2 * k, -W / 2, 1.2 * k, W);
  c.strokeStyle = 'rgba(0,0,0,0.14)'; c.lineWidth = 0.7; c.beginPath();
  c.moveTo(L / 2 - 1.15 * k, -W * 0.3); c.lineTo(L / 2 - 0.1 * k, -W * 0.26); c.moveTo(L / 2 - 1.15 * k, W * 0.3); c.lineTo(L / 2 - 0.1 * k, W * 0.26); c.stroke();
  c.fillStyle = 'rgb(48,57,66)'; c.beginPath();
  c.moveTo(L / 2 - 1.2 * k, -W * 0.4); c.lineTo(L / 2 - 1.78 * k, -W * 0.43); c.lineTo(L / 2 - 1.78 * k, W * 0.43); c.lineTo(L / 2 - 1.2 * k, W * 0.4); c.closePath(); c.fill();
  c.fillStyle = 'rgba(190,200,208,0.25)'; c.beginPath();
  c.moveTo(L / 2 - 1.25 * k, -W * 0.3); c.lineTo(L / 2 - 1.7 * k, -W * 0.36); c.lineTo(L / 2 - 1.7 * k, -W * 0.05); c.lineTo(L / 2 - 1.25 * k, 0); c.closePath(); c.fill();
  c.fillStyle = 'rgb(44,50,58)'; c.fillRect(L / 2 - 3.05 * k, -W / 2 + 0.06 * k, 1.3 * k, W - 0.12 * k);
  c.fillStyle = css(col, 1.05); c.beginPath(); rrect(c, L / 2 - 2.95 * k, -W * 0.42, 1.2 * k, W * 0.84, 0.14 * k); c.fill();
  const bx0 = -L / 2 + 0.12 * k, bx1 = L / 2 - 3.12 * k;
  c.fillStyle = 'rgb(78,78,80)'; c.fillRect(bx0, -W / 2 + 0.12 * k, bx1 - bx0, W - 0.24 * k);
  c.fillStyle = 'rgba(12,12,18,0.45)';
  if (sunL[1] > 0) c.fillRect(bx0, -W / 2 + 0.12 * k, bx1 - bx0, 0.3 * k * Math.abs(sunL[1])); else c.fillRect(bx0, W / 2 - 0.12 * k - 0.3 * k * Math.abs(sunL[1]), bx1 - bx0, 0.3 * k * Math.abs(sunL[1]));
  if (R() < 0.7) { c.fillStyle = css(TIMBER[R.int(0, 3)], 0.95); c.fillRect(bx0 + 0.15 * k, -W * 0.28 + R() * 0.2 * k, 0.6 * k, 0.5 * k); }
  if (R() < 0.6) { c.fillStyle = 'rgb(34,34,36)'; c.beginPath(); c.arc(bx1 - 0.42 * k, W * 0.14, 0.3 * k, 0, TAU); c.fill(); c.fillStyle = 'rgb(96,96,98)'; c.beginPath(); c.arc(bx1 - 0.42 * k, W * 0.14, 0.13 * k, 0, TAU); c.fill(); }
  // side shading, dust and mud splashes
  const sg = c.createLinearGradient(0, -W / 2, 0, W / 2);
  sg.addColorStop(0, sunL[1] > 0 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.16)'); sg.addColorStop(0.5, 'rgba(0,0,0,0)'); sg.addColorStop(1, sunL[1] > 0 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.12)');
  c.fillStyle = sg; c.fillRect(-L / 2, -W / 2, L, W);
  c.fillStyle = 'rgba(128,114,96,0.13)'; c.fillRect(-L / 2, -W / 2, L, W);
  for (let i = 0; i < 26; i++) {
    const near = R() < 0.75, x = near ? R.pick([L * 0.3, -L * 0.3, -L * 0.46]) + R.gauss() * 0.4 * k : R.range(-L / 2, L / 2), y = (R() < 0.5 ? -1 : 1) * W * (near ? R.range(0.36, 0.52) : R.range(0, 0.5));
    c.fillStyle = 'rgba(122,108,90,' + R.range(0.2, 0.6) + ')'; c.beginPath(); c.ellipse(x, y, R.range(0.1, 0.42) * k, R.range(0.05, 0.2) * k, R.gauss() * 0.3, 0, TAU); c.fill();
  }
  c.restore();
  c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 0.8; c.beginPath(); rrect(c, -L / 2, -W / 2, L, W, 0.26 * k); c.stroke();
  c.restore();
}
function tarpOutline(o) {
  const R = mk(mix(o.seed, 3)), L = o.l, W = o.w, j = Math.min(L, W) * 0.07;
  return [[-L / 2, -W / 2], [0, -W / 2], [L / 2, -W / 2], [L / 2, 0], [L / 2, W / 2], [0, W / 2], [-L / 2, W / 2], [-L / 2, 0]].map((p) => [p[0] + (R() - 0.5) * 2 * j, p[1] + (R() - 0.5) * 2 * j]);
}
function drawTarp(c, o, env) {
  const R = mk(o.seed), k = env.k, L = o.l, W = o.w, cr = Math.cos(o.rot), sr = Math.sin(o.rot);
  const sunL = [env.sun[0] * cr + env.sun[1] * sr, -env.sun[0] * sr + env.sun[1] * cr], pts = tarpOutline(o);
  c.save(); c.translate(o.cx, o.cy); c.rotate(o.rot);
  const hh = (o.shelter ? 1.0 : 0.1) * env.sl * k;
  c.fillStyle = SHADOW; c.beginPath(); polyPath(c, castHull(pts, [sunL[0] * hh, sunL[1] * hh])); c.fill();
  if (o.shelter) {
    c.strokeStyle = 'rgba(40,36,30,0.5)'; c.lineWidth = 0.6; c.beginPath();
    for (const p of [pts[0], pts[2], pts[4], pts[6]]) { c.moveTo(p[0], p[1]); c.lineTo(p[0] * 1.3, p[1] * 1.45); }
    c.stroke();
  }
  c.fillStyle = css(o.rgb); c.beginPath(); polyPath(c, pts); c.fill();
  c.save(); c.beginPath(); polyPath(c, pts); c.clip();
  if (o.shelter) {
    c.fillStyle = sunL[1] > 0 ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.24)'; c.fillRect(-L, -W, 2 * L, W);
    c.fillStyle = sunL[1] > 0 ? 'rgba(0,0,0,0.24)' : 'rgba(255,255,255,0.16)'; c.fillRect(-L, 0, 2 * L, W);
  }
  for (let i = 0; i < 4; i++) {
    c.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.13)'; c.beginPath();
    c.moveTo(R.range(-L, L) * 0.6, R.range(-W, W) * 0.6); c.lineTo(R.range(-L, L) * 0.6, R.range(-W, W) * 0.6); c.lineTo(R.range(-L, L) * 0.6, R.range(-W, W) * 0.6); c.closePath(); c.fill();
  }
  const nf = R.int(5, 9);
  for (let i = 0; i < nf; i++) {
    const along = R() < 0.7, x0 = along ? -L / 2 : R.range(-L / 2, L / 2), y0 = along ? R.range(-W / 2, W / 2) : -W / 2, x1 = along ? L / 2 : x0 + R.gauss() * L * 0.2, y1 = along ? y0 + R.gauss() * W * 0.25 : W / 2;
    const mx = (x0 + x1) / 2 + R.gauss() * 2, my = (y0 + y1) / 2 + R.gauss() * 2;
    c.strokeStyle = 'rgba(0,0,0,0.24)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(mx, my, x1, y1); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.26)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(x0 - sunL[0] * 0.9, y0 - sunL[1] * 0.9); c.quadraticCurveTo(mx - sunL[0] * 0.9, my - sunL[1] * 0.9, x1 - sunL[0] * 0.9, y1 - sunL[1] * 0.9); c.stroke();
  }
  const nd = R.int(3, 6);
  for (let i = 0; i < nd; i++) { c.fillStyle = 'rgba(128,114,96,' + R.range(0.25, 0.55) + ')'; c.beginPath(); c.ellipse(R.range(-L / 2, L / 2), R.range(-W / 2, W / 2), R.range(0.08, 0.24) * L, R.range(0.05, 0.14) * W, R() * TAU, 0, TAU); c.fill(); }
  c.restore();
  c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = 0.7; c.beginPath(); polyPath(c, pts); c.stroke();
  if (o.shelter) {
    c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 1; c.beginPath(); c.moveTo(-L / 2, 0); c.lineTo(L / 2, 0); c.stroke();
  } else {
    const cs = [pts[0], pts[2], pts[4], pts[6]].filter(() => R() < 0.75);
    if (cs.length) drawChunks(c, genChunks(R, cs.length, (() => { let i = 0; return () => { const p = cs[i++ % cs.length]; return [p[0] * 0.88, p[1] * 0.88]; }; })(), 0.12 * k, 0.24 * k, PAL.stone.length), PAL.stone, sunL, env.sl);
  }
  c.restore();
}
function capsule(c, x, y, r, off) {
  c.strokeStyle = SHADOW; c.lineCap = 'round'; c.lineWidth = 2 * r; c.beginPath(); c.moveTo(x, y); c.lineTo(x + off[0] + 0.01, y + off[1]); c.stroke();
}
function drawBarrel(c, o, env) {
  const k = env.k, r = (o.r || 0.29) * k, sun = env.sun;
  capsule(c, o.cx, o.cy, r, [sun[0] * 0.88 * env.sl * k, sun[1] * 0.88 * env.sl * k]);
  c.fillStyle = css(o.rgb, 0.74); c.beginPath(); c.arc(o.cx, o.cy, r, 0, TAU); c.fill();
  c.fillStyle = css(o.rgb, 1); c.beginPath(); c.arc(o.cx - sun[0] * 0.5, o.cy - sun[1] * 0.5, r * 0.84, 0, TAU); c.fill();
  c.strokeStyle = css(o.rgb, 0.62); c.lineWidth = 0.8; c.beginPath(); c.arc(o.cx, o.cy, r * 0.58, 0, TAU); c.stroke();
  const a = Math.atan2(-sun[1], -sun[0]);
  c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 1; c.beginPath(); c.arc(o.cx, o.cy, r * 0.86, a - 0.8, a + 0.8); c.stroke();
  c.fillStyle = 'rgba(20,20,24,0.7)'; c.beginPath(); c.arc(o.cx + r * 0.38, o.cy - r * 0.2, Math.max(0.7, r * 0.14), 0, TAU); c.fill();
}
function drawBucket(c, o, env) {
  const k = env.k, r = 0.17 * k;
  capsule(c, o.cx, o.cy, r, [env.sun[0] * 0.3 * env.sl * k, env.sun[1] * 0.3 * env.sl * k]);
  c.fillStyle = css(o.rgb); c.beginPath(); c.arc(o.cx, o.cy, r, 0, TAU); c.fill();
  c.fillStyle = css(o.rgb, 0.4); c.beginPath(); c.arc(o.cx + env.sun[0] * 0.4, o.cy + env.sun[1] * 0.4, r * 0.62, 0, TAU); c.fill();
}
function clothPts(o, k) { const R = mk(mix(o.seed, 9)); return blobPts(R, o.cx, o.cy, o.s * k * 0.62, o.s * k * 0.36, o.rot, 9, 0.3); }
function drawCloth(c, o, env) {
  const R = mk(o.seed), k = env.k, pts = clothPts(o, k), sun = env.sun;
  c.fillStyle = SHADOW; c.beginPath(); polyPath(c, pts, sun[0] * 1.3, sun[1] * 1.3); c.fill();
  c.fillStyle = css(o.rgb); c.beginPath(); polyPath(c, pts); c.fill();
  c.save(); c.beginPath(); polyPath(c, pts); c.clip();
  for (let i = 0; i < 4; i++) {
    const a = o.rot + R.gauss() * 0.5, x = o.cx + R.gauss() * o.s * k * 0.25, y = o.cy + R.gauss() * o.s * k * 0.15, l = o.s * k * 0.5;
    c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.26)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(x - Math.cos(a) * l - sun[0], y - Math.sin(a) * l - sun[1]); c.lineTo(x + Math.cos(a) * l - sun[0], y + Math.sin(a) * l - sun[1]); c.stroke();
  }
  c.fillStyle = 'rgba(128,114,96,0.4)'; c.beginPath(); c.ellipse(o.cx + R.gauss() * 3, o.cy + R.gauss() * 2, o.s * k * 0.2, o.s * k * 0.1, R() * TAU, 0, TAU); c.fill();
  c.restore();
}
function drawTent(c, o, env) {
  const k = env.k, L = o.l, W = o.w, cr = Math.cos(o.rot), sr = Math.sin(o.rot), sunL = [env.sun[0] * cr + env.sun[1] * sr, -env.sun[0] * sr + env.sun[1] * cr];
  c.save(); c.translate(o.cx, o.cy); c.rotate(o.rot);
  const hh = 1.5 * env.sl * k, ridge = [[-L / 2, 0], [L / 2, 0]], foot = [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]];
  c.fillStyle = SHADOW; c.beginPath(); polyPath(c, hull(foot.concat(ridge.map((p) => [p[0] + sunL[0] * hh, p[1] + sunL[1] * hh])))); c.fill();
  c.strokeStyle = 'rgba(40,36,30,0.45)'; c.lineWidth = 0.6; c.beginPath();
  for (const p of foot) { c.moveTo(p[0], p[1]); c.lineTo(p[0] * 1.22, p[1] * 1.5); }
  c.stroke();
  c.fillStyle = css(o.rgb, sunL[1] > 0 ? 1.1 : 0.78); c.fillRect(-L / 2, -W / 2, L, W / 2);
  c.fillStyle = css(o.rgb, sunL[1] > 0 ? 0.78 : 1.1); c.fillRect(-L / 2, 0, L, W / 2);
  c.fillStyle = 'rgba(0,0,0,0.16)'; c.beginPath(); c.moveTo(L / 2, -W * 0.3); c.lineTo(L / 2 - 0.5 * k, 0); c.lineTo(L / 2, W * 0.3); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = 0.7; c.beginPath();
  for (let x = -L / 2 + L / 4; x < L / 2 - 1; x += L / 4) { c.moveTo(x, -W / 2); c.lineTo(x, W / 2); }
  c.stroke();
  c.strokeStyle = css(o.rgb, 1.25); c.lineWidth = 1; c.beginPath(); c.moveTo(-L / 2, 0); c.lineTo(L / 2, 0); c.stroke();
  c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 0.7; c.strokeRect(-L / 2, -W / 2, L, W);
  c.restore();
}
const CRATE = [[150, 130, 100], [98, 100, 78], [112, 114, 118], [132, 116, 92]];
function drawCrates(c, o, env) {
  const k = env.k, sun = env.sun;
  c.fillStyle = SHADOW; c.beginPath();
  for (const q of o.items) polyPath(c, castHull(rectPts(q[0], q[1], q[2], q[3], q[4]), [sun[0] * q[6] * env.sl * k, sun[1] * q[6] * env.sl * k]));
  c.fill();
  for (const q of o.items) {
    const col = CRATE[q[5] % CRATE.length];
    c.save(); c.translate(q[0], q[1]); c.rotate(q[4]);
    c.fillStyle = css(col, 0.72); c.fillRect(-q[2] / 2, -q[3] / 2, q[2], q[3]);
    c.fillStyle = css(col, 1.04); c.fillRect(-q[2] / 2 + 1, -q[3] / 2 + 1, q[2] - 2, q[3] - 2);
    c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(-q[2] / 2, 0); c.lineTo(q[2] / 2, 0); c.moveTo(0, -q[3] / 2); c.lineTo(0, q[3] / 2); c.stroke();
    c.restore();
  }
}
function drawPad(c, o, env) {
  const s = o.s;
  c.save(); c.translate(o.cx, o.cy); c.rotate(o.rot);
  c.fillStyle = SHADOW; c.fillRect(-s / 2 + env.sun[0], -s / 2 + env.sun[1], s, s);
  c.fillStyle = 'rgb(104,105,104)'; c.fillRect(-s / 2, -s / 2, s, s);
  c.fillStyle = 'rgb(121,122,120)'; c.fillRect(-s / 2 + 1.5, -s / 2 + 1.5, s - 3, s - 3);
  c.strokeStyle = 'rgba(176,176,170,0.6)'; c.lineWidth = Math.max(1.2, s * 0.07); c.lineCap = 'butt'; c.beginPath();
  c.moveTo(-s * 0.18, -s * 0.26); c.lineTo(-s * 0.18, s * 0.26); c.moveTo(s * 0.18, -s * 0.26); c.lineTo(s * 0.18, s * 0.26); c.moveTo(-s * 0.18, 0); c.lineTo(s * 0.18, 0); c.stroke();
  c.fillStyle = 'rgba(128,114,96,0.3)'; c.beginPath(); c.ellipse(s * 0.2, s * 0.25, s * 0.3, s * 0.14, 0.5, 0, TAU); c.fill();
  c.fillStyle = 'rgb(92,88,80)';
  for (const p of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.beginPath(); c.arc(p[0] * s * 0.46, p[1] * s * 0.46, Math.max(1.2, s * 0.06), 0, TAU); c.fill(); }
  c.restore();
}
function drawCourt(c, o, env) {
  const k = env.k, L = o.l, W = o.w, cr = Math.cos(o.rot), sr = Math.sin(o.rot), sunL = [env.sun[0] * cr + env.sun[1] * sr, -env.sun[0] * sr + env.sun[1] * cr];
  c.save(); c.translate(o.cx, o.cy); c.rotate(o.rot);
  c.fillStyle = 'rgba(200,186,160,0.3)'; c.fillRect(-L / 2 - k, -W / 2 - k, L + 2 * k, W + 2 * k);
  c.strokeStyle = 'rgba(228,224,210,0.6)'; c.lineWidth = Math.max(1, 0.09 * k); c.setLineDash([11, 2, 23, 3, 7, 1.5, 31, 4]);
  c.strokeRect(-L / 2, -W / 2, L, W);
  c.beginPath(); c.moveTo(-L / 6, -W / 2); c.lineTo(-L / 6, W / 2); c.moveTo(L / 6, -W / 2); c.lineTo(L / 6, W / 2); c.stroke();
  c.setLineDash([]);
  const hh = 2.4 * env.sl * k;
  c.strokeStyle = SHADOW; c.lineWidth = 1.4; c.beginPath();
  for (const y of [-W / 2 - 0.6 * k, W / 2 + 0.6 * k]) { c.moveTo(0, y); c.lineTo(sunL[0] * hh, y + sunL[1] * hh); }
  c.stroke();
  c.strokeStyle = 'rgba(40,40,44,0.5)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(0, -W / 2 - 0.6 * k); c.lineTo(0, W / 2 + 0.6 * k); c.stroke();
  c.fillStyle = 'rgb(70,68,66)';
  for (const y of [-W / 2 - 0.6 * k, W / 2 + 0.6 * k]) { c.beginPath(); c.arc(0, y, Math.max(1.2, 0.1 * k), 0, TAU); c.fill(); }
  c.restore();
}
function drawPlots(c, o, env) {
  const k = env.k, bb = bboxOf(o.poly), cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2, rad = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) / 2;
  const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
  c.save(); c.beginPath(); polyPath(c, o.poly); c.clip();
  c.fillStyle = 'rgba(116,100,78,0.6)'; c.fillRect(bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]);
  c.strokeStyle = o.tone ? 'rgba(96,104,66,0.8)' : 'rgba(84,96,60,0.8)'; c.lineWidth = 0.3 * k; c.setLineDash([0.3 * k, 0.24 * k]); c.beginPath();
  for (let d = -rad; d < rad; d += 0.72 * k) { c.moveTo(cx - sa * d - ca * rad, cy + ca * d - sa * rad); c.lineTo(cx - sa * d + ca * rad, cy + ca * d + sa * rad); }
  c.stroke(); c.setLineDash([]);
  c.restore();
  c.strokeStyle = SHADOW; c.lineWidth = 0.3 * k; c.beginPath(); polyPath(c, o.poly, env.sun[0] * 1.5, env.sun[1] * 1.5); c.stroke();
  c.strokeStyle = 'rgba(160,150,130,0.9)'; c.lineWidth = 0.3 * k; c.beginPath(); polyPath(c, o.poly); c.stroke();
}
function drawScar(c, o, env) {
  const R = mk(o.seed), r = o.r;
  c.save(); c.translate(o.cx, o.cy); c.rotate(o.ang);
  c.fillStyle = 'rgba(158,142,118,0.42)'; c.beginPath(); c.ellipse(r * 0.95, 0, r * 1.25, r * 0.8, 0, 0, TAU); c.fill();
  c.fillStyle = 'rgba(128,112,92,0.35)'; c.beginPath(); c.ellipse(r * 0.6, R.gauss() * r * 0.1, r * 0.7, r * 0.5, 0, 0, TAU); c.fill();
  c.fillStyle = 'rgba(58,50,42,0.78)'; c.beginPath(); c.moveTo(0, -r); c.quadraticCurveTo(-r * 0.75, 0, 0, r); c.quadraticCurveTo(-r * 0.22, 0, 0, -r); c.fill();
  c.strokeStyle = 'rgba(52,44,38,0.4)'; c.lineWidth = 1;
  for (const d of [0.32, 0.55]) { c.beginPath(); c.moveTo(-r * d * 0.4, -r * (1 - d * 0.5)); c.quadraticCurveTo(-r * (0.75 + d), R.gauss() * r * 0.1, -r * d * 0.4, r * (1 - d * 0.6)); c.stroke(); }
  c.restore();
}
function drawTank(c, o, env) {
  const k = env.k, r = o.r * k;
  capsule(c, o.cx, o.cy, r, [env.sun[0] * 1.1 * env.sl * k, env.sun[1] * 1.1 * env.sl * k]);
  c.fillStyle = 'rgb(38,38,41)'; c.beginPath(); c.arc(o.cx, o.cy, r, 0, TAU); c.fill();
  c.fillStyle = 'rgb(60,60,64)'; c.beginPath(); c.arc(o.cx - env.sun[0] * r * 0.15, o.cy - env.sun[1] * r * 0.15, r * 0.8, 0, TAU); c.fill();
  c.strokeStyle = 'rgb(34,34,36)'; c.lineWidth = 0.8; c.beginPath(); c.arc(o.cx, o.cy, r * 0.5, 0, TAU); c.stroke();
  c.fillStyle = 'rgb(30,30,32)'; c.beginPath(); c.arc(o.cx, o.cy, r * 0.2, 0, TAU); c.fill();
}

// ---------------------------------------------------------------- people
const BRIGHT = [['red jacket', [205, 32, 38]], ['orange jacket', [240, 120, 24]], ['yellow raincoat', [240, 205, 30]], ['cyan jacket', [20, 180, 215]], ['royal blue jacket', [36, 72, 200]], ['magenta shawl', [210, 40, 150]], ['hi-vis lime vest', [190, 235, 40]]];
const MUTED = [['khaki shirt', [150, 138, 108]], ['grey sweater', [128, 126, 122]], ['brown jacket', [108, 86, 66]], ['dusty olive jacket', [112, 112, 84]]];
const BOTTOM_DARK = [['dark navy trousers', [38, 44, 62]], ['black trousers', [34, 34, 36]], ['blue jeans', [62, 82, 118]], ['charcoal trousers', [70, 70, 74]]];
const BOTTOM_EARTH = [['brown trousers', [92, 74, 56]], ['grey trousers', [104, 102, 98]], ['khaki trousers', [140, 128, 100]], ['dark olive trousers', [78, 80, 60]]];
const SKIN = [[172, 124, 92], [150, 104, 76], [188, 140, 108]];
const HAIR = [[30, 26, 24], [30, 26, 24], [52, 44, 38], [112, 108, 102]];

// Body parts as capsules [x1, y1, x2, y2, width, colour index] in image pixels.
// Colour index: 0 top, 1 bottom, 2 skin, 3 hair, 4 shoes, 5 helmet.
function figPrims(f, k, sun, sl) {
  const p = f.pose, ca = Math.cos(f.angle), sa = Math.sin(f.angle), body = [], shadow = [];
  const L = (x1, y1, x2, y2, w, ci) => body.push([f.cx + (x1 * ca - y1 * sa) * k, f.cy + (x1 * sa + y1 * ca) * k, f.cx + (x2 * ca - y2 * sa) * k, f.cy + (x2 * sa + y2 * ca) * k, w * k, ci]);
  const cast = (list, d) => { for (const q of list) shadow.push([q[0] + sun[0] * d * sl * k, q[1] + sun[1] * d * sl * k, q[2] + sun[0] * d * sl * k, q[3] + sun[1] * d * sl * k, q[4], q[5]]); };
  if (f.posture === 'lying') {
    const o = -0.07;
    for (const s of [-1, 1]) {
      const lg = p.leg[s < 0 ? 0 : 1], a1 = Math.PI - s * lg[0], a2 = a1 + lg[1], hx = o - 0.02, hy = s * 0.09;
      const kx = hx + 0.4 * Math.cos(a1), ky = hy + 0.4 * Math.sin(a1), ax = kx + 0.4 * Math.cos(a2), ay = ky + 0.4 * Math.sin(a2);
      L(hx, hy, kx, ky, 0.15, 1); L(kx, ky, ax, ay, 0.12, 1); L(ax, ay, ax + 0.1 * Math.cos(a2), ay + 0.1 * Math.sin(a2), 0.1, 4);
    }
    L(o, -0.08, o, 0.08, 0.2, 1);
    L(o + 0.5, 0, o + 0.07, 0, 0.33, 0); L(o + 0.5, -0.13, o + 0.5, 0.13, 0.15, 0);
    for (const s of [-1, 1]) {
      const ar = p.arm[s < 0 ? 0 : 1], a1 = Math.PI - s * ar[0], a2 = a1 - s * ar[1], sx = o + 0.49, sy = s * 0.2;
      const ex = sx + 0.28 * Math.cos(a1), ey = sy + 0.28 * Math.sin(a1), wx = ex + 0.25 * Math.cos(a2), wy = ey + 0.25 * Math.sin(a2);
      L(sx, sy, ex, ey, 0.105, 0); L(ex, ey, wx, wy, 0.09, 0); L(wx, wy, wx + 0.04 * Math.cos(a2), wy + 0.04 * Math.sin(a2), 0.085, 2);
    }
    L(o + 0.7, p.hy, o + 0.7, p.hy, 0.21, p.face ? 2 : 3);
    if (p.face) L(o + 0.745, p.hy, o + 0.745, p.hy, 0.15, 3);
    cast(body, 0.2); cast(body, 0.08);
  } else if (f.posture === 'sitting') {
    for (const s of [-1, 1]) {
      const lg = p.leg[s < 0 ? 0 : 1], hx = -0.02, hy = s * 0.09, kx = -0.4, ky = s * (0.12 + lg[0] * 0.3), bent = Math.abs(lg[1]) > 0.25;
      const ax = bent ? -0.56 : -0.78, ay = bent ? s * (0.24 + lg[0] * 0.3) : s * (0.1 + lg[0] * 0.2);
      L(hx, hy, kx, ky, 0.15, 1); L(kx, ky, ax, ay, 0.12, 1); L(ax, ay, ax - 0.08, ay, 0.1, 4);
    }
    const lower = body.length;
    L(0, 0, 0.15, 0, 0.33, 0); L(0.13, -0.15, 0.13, 0.15, 0.16, 0);
    for (const s of [-1, 1]) {
      const ar = p.arm[s < 0 ? 0 : 1], ex = 0.02 - ar[0] * 0.1, ey = s * (0.26 + ar[0] * 0.08), wx = -0.2 - ar[1] * 0.05, wy = s * 0.16;
      L(0.13, s * 0.2, ex, ey, 0.105, 0); L(ex, ey, wx, wy, 0.09, 0); L(wx, wy, wx - 0.03, wy, 0.085, 2);
    }
    L(0.16, p.hy, 0.16, p.hy, 0.21, 3);
    if (p.face) L(0.1, p.hy, 0.1, p.hy, 0.12, 2);
    cast(body.slice(0, lower), 0.12); cast(body.slice(lower), 0.75); cast(body.slice(lower), 0.4); cast(body.slice(lower), 0.1);
  } else {
    for (const s of [-1, 1]) L(0.12, s * 0.075, 0.14, s * 0.075, 0.1, 4);
    L(0, -0.14, 0, 0.14, 0.27, 0);
    for (const s of [-1, 1]) { L(0.01, s * 0.22, 0.05, s * 0.235, 0.12, 0); L(0.08, s * 0.24, 0.09, s * 0.24, 0.075, 2); }
    if (f.helmet) L(0.03, 0, 0.03, 0, 0.26, 5); else { L(0.03, 0, 0.03, 0, 0.2, 3); if (p.face) L(0.085, 0, 0.085, 0, 0.1, 2); }
    const Ls = 1.7 * sl * k, P = (t) => [f.cx + sun[0] * Ls * t, f.cy + sun[1] * Ls * t];
    const a = P(0), b = P(0.5), c2 = P(0.46), d = P(0.84), e = P(0.93);
    shadow.push([a[0], a[1], b[0], b[1], 0.27 * k, 0], [c2[0], c2[1], d[0], d[1], 0.42 * k, 0], [e[0], e[1], e[0], e[1], 0.22 * k, 0]);
  }
  return { body, shadow };
}
function primBox(prims) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const q of prims) { const r = q[4] / 2; x0 = Math.min(x0, q[0] - r, q[2] - r); y0 = Math.min(y0, q[1] - r, q[3] - r); x1 = Math.max(x1, q[0] + r, q[2] + r); y1 = Math.max(y1, q[1] + r, q[3] + r); }
  return [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)];
}
function strokePrims(s, prims, cols, ox, oy, wm, fm) {
  s.lineCap = 'round';
  for (const q of prims) {
    s.strokeStyle = cols ? css(cols[q[5]], fm) : '#10121e';
    s.lineWidth = Math.max(0.9, q[4] * wm);
    s.beginPath(); s.moveTo(q[0] + ox, q[1] + oy); s.lineTo(q[2] + ox + 0.01, q[3] + oy); s.stroke();
  }
}
let FS = null;
function scratch(S) {
  if (!FS || FS.S !== S) { const cv = new OffscreenCanvas(S, S); FS = { S, cv, ctx: cv.getContext('2d', { willReadFrequently: true }) }; }
  const s = FS.ctx;
  s.setTransform(1, 0, 0, 1, 0, 0); s.globalCompositeOperation = 'source-over'; s.globalAlpha = 1; s.clearRect(0, 0, S, S);
  return FS;
}
function drawFigure(c, f, env) {
  const k = env.k, sun = env.sun, pr = figPrims(f, k, sun, env.sl), S = Math.ceil(5.2 * k);
  const ox = Math.round(f.cx - S / 2), oy = Math.round(f.cy - S / 2);
  const cols = [f.top.rgb, f.bottom.rgb, f.skin, f.hair, [32, 30, 30], [236, 236, 228]];
  let fs = scratch(S), s = fs.ctx;
  s.setTransform(1, 0, 0, 1, -ox, -oy);
  strokePrims(s, pr.shadow, null, 0, 0, 1, 1);
  c.globalAlpha = 0.52; c.drawImage(fs.cv, ox, oy); c.globalAlpha = 1;
  fs = scratch(S); s = fs.ctx; s.setTransform(1, 0, 0, 1, -ox, -oy);
  strokePrims(s, pr.body, cols, 0, 0, 1, 0.68);
  strokePrims(s, pr.body, cols, -sun[0] * 0.05 * k, -sun[1] * 0.05 * k, 0.7, 1.02);
  c.drawImage(fs.cv, ox, oy);
  const cv = f.cover;
  if (cv) {
    c.fillStyle = SHADOW; c.beginPath(); polyPath(c, cv.mud, sun[0] * 1.3, sun[1] * 1.3); c.fill();
    c.save(); c.beginPath(); polyPath(c, cv.mud); c.clip();
    c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(env.G, 0, 0);
    c.restore();
    if (cv.planks.length) drawPlanks(c, cv.planks, sun, env.sl);
    if (cv.chunks.length) drawChunks(c, cv.chunks, PAL.masonry, sun, env.sl);
  }
}
// Fraction of the body silhouette left showing once the cover is drawn over it (counted in pixels).
function measureVisible(f, k, cover) {
  const pr = figPrims(f, k, [0, 0], 0).body, S = Math.ceil(5.2 * k), fs = scratch(S), s = fs.ctx;
  const ox = Math.round(f.cx - S / 2), oy = Math.round(f.cy - S / 2);
  const count = () => { const d = s.getImageData(0, 0, S, S).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++; return n; };
  s.setTransform(1, 0, 0, 1, -ox, -oy);
  strokePrims(s, pr, null, 0, 0, 1, 1);
  const a0 = count();
  s.globalCompositeOperation = 'destination-out'; s.fillStyle = '#000';
  s.beginPath(); polyPath(s, cover.mud); s.fill();
  for (const q of cover.planks) { s.beginPath(); polyPath(s, rectPts(q.x, q.y, q.l, q.w, q.r)); s.fill(); }
  for (const q of cover.chunks) { s.beginPath(); polyPath(s, q.p); s.fill(); }
  s.globalCompositeOperation = 'source-over';
  return count() / Math.max(1, a0);
}
function makeCover(f, k, R, target) {
  const ca = Math.cos(f.angle), sa = Math.sin(f.angle), T = (x, y) => [f.cx + (x * ca - y * sa) * k, f.cy + (x * sa + y * ca) * k];
  const r1 = (v) => Math.round(v * 10) / 10;
  const planks = [], np = R.int(1, 2);
  for (let i = 0; i < np; i++) { const q = T(R.range(-0.3, 0.3), R.range(-0.25, 0.25)); planks.push({ x: r1(q[0]), y: r1(q[1]), l: r1(R.range(1.3, 2.6) * k), w: r1(R.range(0.13, 0.2) * k), r: f.angle + Math.PI / 2 + R.range(-0.7, 0.7), c: R.int(0, 4), h: r1(R.range(0.05, 0.12) * k) }); }
  let chunks = genChunks(R, R.int(3, 6), () => T(R.range(-0.8, 0.35), R.range(-0.22, 0.22)), 0.07 * k, 0.2 * k, PAL.masonry.length);
  for (const q of chunks) { q.x = r1(q.x); q.y = r1(q.y); q.s = r1(q.s); q.h = r1(q.h); q.p = q.p.map((p) => [r1(p[0]), r1(p[1])]); }
  const jit = []; for (let i = 0; i < 12; i++) jit.push(R() - 0.5);
  const mudAt = (t) => {
    const p = [];
    for (let i = 0; i <= 6; i++) { const q = T(t + jit[i] * 0.22, -0.8 + (i * 1.6) / 6); p.push([r1(q[0]), r1(q[1])]); }
    for (const [x, y, j] of [[-1.3, 0.85, 7], [-1.55, 0.3, 8], [-1.5, -0.35, 9], [-1.3, -0.85, 10]]) { const q = T(x + jit[j] * 0.3, y + jit[j + 1] * 0.2); p.push([r1(q[0]), r1(q[1])]); }
    return p;
  };
  let cover = { mud: mudAt(-1.2), planks, chunks };
  if (measureVisible(f, k, cover) < target) { chunks = []; cover = { mud: mudAt(-1.2), planks, chunks }; }
  if (measureVisible(f, k, cover) < target) { planks.length = 1; planks[0].w = r1(0.12 * k); }
  let lo = -1.2, hi = 0.62;
  for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; cover = { mud: mudAt(mid), planks, chunks }; if (measureVisible(f, k, cover) > target) lo = mid; else hi = mid; }
  cover = { mud: mudAt((lo + hi) / 2), planks, chunks };
  return { cover, visible: Math.round(measureVisible(f, k, cover) * 100) / 100 };
}
function mkFigure(R, k, d) {
  const tight = d.difficulty === 'shadow';
  const pose = {
    arm: [0, 1].map(() => [tight ? R.range(0.1, 0.4) : R.chance(0.22) ? R.range(1.7, 2.7) : R.range(0.15, 1.15), R.range(-0.8, 0.8) * (tight ? 0.4 : 1)]),
    leg: [0, 1].map(() => [R.range(0.03, 0.3), R.chance(0.35) ? R.range(0.35, 1.0) * (R.chance(0.5) ? 1 : -1) : R.range(-0.12, 0.12)]),
    face: R.chance(0.55) ? 1 : 0, hy: R.range(-0.03, 0.03),
  };
  const f = { id: d.id, cx: Math.round(d.x * 10) / 10, cy: Math.round(d.y * 10) / 10, angle: d.angle, posture: d.posture, difficulty: d.difficulty, top: { name: d.top[0], rgb: d.top[1] }, bottom: { name: d.bottom[0], rgb: d.bottom[1] }, bbox: null, visible: 1, skin: R.pick(SKIN), hair: R.pick(HAIR), pose };
  if (d.helmet) f.helmet = true;
  if (d.team) f.team = true;
  const pr = figPrims(f, k, d.sun, d.sl);
  f.bbox = primBox(pr.body);
  if (f.posture === 'standing') f.shadowBbox = primBox(pr.shadow);
  if (d.difficulty === 'covered') { const cv = makeCover(f, k, R, d.target || R.range(0.28, 0.42)); f.cover = cv.cover; f.visible = cv.visible; }
  return f;
}

// ---------------------------------------------------------------- render
function shadowPolys(o, k, sun, sl) {
  const off = (h) => [sun[0] * h * sl * k, sun[1] * h * sl * k];
  if (o.t === 'roof') {
    if (o.state !== 'collapsed') return [castHull(rectPts(o.cx, o.cy, o.l, o.w, o.rot), off(o.h))];
    const cr = Math.cos(o.rot), sr = Math.sin(o.rot), T = (p) => [o.cx + p[0] * cr - p[1] * sr, o.cy + p[0] * sr + p[1] * cr];
    return stubsOf(o, k).map((s) => castHull(segQuad(T(s.a), T(s.b), 0.44 * k), off(s.h)));
  }
  if (o.t === 'wall') { const out = []; for (let i = 0; i < o.pts.length - 1; i++) out.push(castHull(segQuad(o.pts[i], o.pts[i + 1], o.th * k), off(o.h))); return out; }
  if (o.t === 'vehicle') return [castHull(rectPts(o.cx, o.cy, VEH.l * k, VEH.w * k, o.rot), off(VEH.h * 0.8))];
  return [];
}
const ZOF = { ruts: 0, puddle: 0.5, court: 0.6, plots: 0.6, scar: 0.6, rub: 1, planks: 1.1, boulders: 1.2, scrub: 1.3, pad: 2, tarp: 2, cloth: 2, barrel: 2, bucket: 2, fig: 3, wall: 5, roof: 6, vehicle: 6, tent: 6, crates: 6, tank: 7 };
const zOf = (o) => (o.z !== undefined ? o.z : o.t === 'roof' && o.state === 'collapsed' ? 1 : ZOF[o.t]);
function drawObject(c, o, scene, env) {
  switch (o.t) {
    case 'ruts': return drawRuts(c, o, env);
    case 'puddle': return drawPuddle(c, o, env);
    case 'rub': return drawRub(c, o, env);
    case 'planks': return drawPlanks(c, genPlanks(mk(o.seed), o, env.k), env.sun, env.sl, o.log ? 0.66 : 0.8);
    case 'boulders': return drawBoulders(c, o, env);
    case 'scrub': return drawScrub(c, o, env);
    case 'roof': return drawRoof(c, o, env);
    case 'wall': return drawWall(c, o, env);
    case 'vehicle': return drawVehicle(c, o, env);
    case 'tarp': return drawTarp(c, o, env);
    case 'barrel': return drawBarrel(c, o, env);
    case 'bucket': return drawBucket(c, o, env);
    case 'cloth': return drawCloth(c, o, env);
    case 'tent': return drawTent(c, o, env);
    case 'crates': return drawCrates(c, o, env);
    case 'pad': return drawPad(c, o, env);
    case 'court': return drawCourt(c, o, env);
    case 'plots': return drawPlots(c, o, env);
    case 'scar': return drawScar(c, o, env);
    case 'tank': return drawTank(c, o, env);
    case 'fig': return drawFigure(c, scene.figures[o.i], env);
  }
}
let GT = null;
function gaussTable() {
  if (GT) return GT;
  const R = mk(9001); GT = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) GT[i] = Math.sqrt(-2 * Math.log(1 - R() * 0.999999)) * Math.cos(TAU * R());
  return GT;
}

export function renderScene(scene, { canvas, light, shift, noiseSeed = 1, noise = 3 } = {}) {
  const w = scene.w, h = scene.h, k = scene.pxPerM;
  const sx = Math.round((shift && shift[0]) || 0), sy = Math.round((shift && shift[1]) || 0);
  const gain = light && light.gain !== undefined ? light.gain : 1, tint = (light && light.tint) || [1, 1, 1];
  if (!canvas) canvas = new OffscreenCanvas(w, h);
  canvas.width = w; canvas.height = h;
  const RF = { willReadFrequently: true };
  const _t0 = performance.now(); const gl = groundLayer(scene, sx, sy); if (globalThis.__prof) globalThis.__prof.ground = performance.now() - _t0;
  const G = new OffscreenCanvas(w, h); G.getContext('2d', RF).putImageData(gl.img, 0, 0);
  const A = new OffscreenCanvas(w, h), a = A.getContext('2d', RF);
  a.drawImage(G, 0, 0);
  const env = { k, sun: scene.sun, sl: scene.sunLen || 0.85, G, w, h };
  const list = scene.objects.filter((o) => o.t !== 'patch').map((o, i) => [zOf(o), i, o]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const draw = (lo, hi) => {
    for (const [z, , o] of list) {
      if (z < lo || z >= hi) continue;
      a.save(); a.setTransform(1, 0, 0, 1, sx, sy); a.globalAlpha = 1; a.setLineDash([]);
      const _t = performance.now(); drawObject(a, o, scene, env); const _k = o.t + (o.state === 'collapsed' ? 'C' : ''); if (globalThis.__prof) { globalThis.__prof[_k] = (globalThis.__prof[_k] || 0) + performance.now() - _t; a.getImageData(0,0,1,1); globalThis.__prof[_k+'_flush'] = (globalThis.__prof[_k+'_flush'] || 0) + performance.now() - _t; }
      a.restore();
    }
  };
  draw(-1, 5);
  // cast shadows of everything tall, laid over the ground and whatever lies on it
  const B = new OffscreenCanvas(w, h), b = B.getContext('2d', RF);
  // drawn at half size on a grid locked to the ground, then enlarged: a soft penumbra that does not move with the frame
  const hx = 2 * Math.floor(-sx / 2) - 2, hy = 2 * Math.floor(-sy / 2) - 2, hw = (w >> 1) + 3, hh = (h >> 1) + 3;
  const Hc = new OffscreenCanvas(hw, hh), hc = Hc.getContext('2d', RF);
  hc.setTransform(0.5, 0, 0, 0.5, -hx / 2, -hy / 2); hc.fillStyle = 'rgb(122,133,163)'; hc.beginPath();
  let anyShadow = false;
  for (const [, , o] of list) for (const p of shadowPolys(o, k, env.sun, env.sl)) { polyPath(hc, p); anyShadow = true; }
  if (anyShadow) {
    hc.fill();
    a.save(); a.setTransform(1, 0, 0, 1, 0, 0); a.globalCompositeOperation = 'multiply'; a.imageSmoothingEnabled = true;
    a.drawImage(Hc, hx + sx, hy + sy, hw * 2, hh * 2);
    a.restore();
  }
  draw(5, 99);
  // lens softness: two half-pixel resamples, there and back (a 1-2-1 blur)
  b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = 'source-over'; b.imageSmoothingEnabled = true;
  b.drawImage(A, 0, 0); b.drawImage(A, 0.5, 0.5);
  a.setTransform(1, 0, 0, 1, 0, 0); a.globalAlpha = 1; a.globalCompositeOperation = 'source-over'; a.imageSmoothingEnabled = true;
  a.drawImage(B, 0, 0); a.drawImage(B, -0.5, -0.5);
  // exposure, colour cast, surface grime, slight vignette, sensor noise
  const _t1 = performance.now(); const im = a.getImageData(0, 0, w, h), d = im.data, D = gl.D, gt = gaussTable();
  const tr = gain * tint[0], tg = gain * tint[1], tb = gain * tint[2], cx = w / 2, cy = h / 2, rr = 0.045 / (cx * cx + cy * cy);
  let st = (mix(noiseSeed | 0, 4242) | 1) >>> 0;
  for (let y = 0, i = 0, j = 0; y < h; y++) {
    const dy2 = (y - cy) * (y - cy);
    for (let x = 0; x < w; x++, i++, j += 4) {
      st ^= st << 13; st ^= st >>> 17; st ^= st << 5;
      const m = (1 + 0.04 * D[i]) * (1 - rr * ((x - cx) * (x - cx) + dy2));
      d[j] = d[j] * m * tr + gt[st & 1023] * noise;
      d[j + 1] = d[j + 1] * m * tg + gt[(st >>> 10) & 1023] * noise;
      d[j + 2] = d[j + 2] * m * tb + gt[(st >>> 20) & 1023] * noise;
      d[j + 3] = 255;
    }
  }
  canvas.getContext('2d').putImageData(im, 0, 0); if (globalThis.__prof) globalThis.__prof.post = performance.now() - _t1;
  return canvas;
}

// ---------------------------------------------------------------- layout helpers
function footprints(sc, skip) {
  const k = sc.pxPerM, out = [];
  for (const o of sc.objects) {
    if (o === skip) continue;
    if (o.t === 'roof') out.push({ cx: o.cx, cy: o.cy, hl: o.l / 2, hw: o.w / 2, rot: o.rot, kind: o.state === 'collapsed' ? 'collapsed' : 'roof' });
    else if (o.t === 'vehicle') out.push({ cx: o.cx, cy: o.cy, hl: (VEH.l * k) / 2, hw: (VEH.w * k) / 2, rot: o.rot, kind: 'vehicle' });
    else if (o.t === 'tent') out.push({ cx: o.cx, cy: o.cy, hl: o.l / 2, hw: o.w / 2, rot: o.rot, kind: 'tent' });
    else if (o.t === 'wall') for (let i = 0; i < o.pts.length - 1; i++) { const a = o.pts[i], b = o.pts[i + 1]; out.push({ cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, hl: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, hw: (o.th * k) / 2, rot: Math.atan2(b[1] - a[1], b[0] - a[0]), kind: 'wall' }); }
  }
  return out;
}
function distRect(fp, x, y) {
  const c = Math.cos(fp.rot), s = Math.sin(fp.rot), dx = x - fp.cx, dy = y - fp.cy;
  return Math.hypot(Math.max(Math.abs(dx * c + dy * s) - fp.hl, 0), Math.max(Math.abs(-dx * s + dy * c) - fp.hw, 0));
}
function rectHit(a, b, m) {
  const s = (f) => rectPts(f.cx, f.cy, f.hl * 2, f.hw * 2, f.rot);
  const pa = s(a), pb = s(b);
  for (let i = 0; i < 4; i++) { pa.push([(pa[i][0] + pa[(i + 1) % 4][0]) / 2, (pa[i][1] + pa[(i + 1) % 4][1]) / 2]); pb.push([(pb[i][0] + pb[(i + 1) % 4][0]) / 2, (pb[i][1] + pb[(i + 1) % 4][1]) / 2]); }
  pa.push([a.cx, a.cy]); pb.push([b.cx, b.cy]);
  return pa.some((p) => distRect(b, p[0], p[1]) < m) || pb.some((p) => distRect(a, p[0], p[1]) < m);
}
function isFree(sc, fps, x, y, r, { fig = 0, dis = 0, collapsedOk = false } = {}) {
  for (const fp of fps) { if (collapsedOk && fp.kind === 'collapsed') continue; if (distRect(fp, x, y) < r) return false; }
  if (fig) for (const f of sc.figures) if (f && Math.hypot(f.cx - x, f.cy - y) < fig) return false;
  if (dis) for (const d of sc.distractors) { const b = d.bbox; if (Math.hypot((b[0] + b[2]) / 2 - x, (b[1] + b[3]) / 2 - y) < dis + Math.hypot(b[2] - b[0], b[3] - b[1]) / 2) return false; }
  return true;
}
function bodyPts(x, y, ang, half, side, k) {
  const c = Math.cos(ang), s = Math.sin(ang), out = [];
  for (const t of [-1, -0.5, 0, 0.5, 1]) for (const u of [-1, 1]) out.push([x + (c * t * half - s * u * side) * k, y + (s * t * half + c * u * side) * k]);
  return out;
}
function allShadows(sc) {
  const out = [];
  for (const o of sc.objects) for (const p of shadowPolys(o, sc.pxPerM, sc.sun, sc.sunLen)) out.push(p);
  return out;
}
// A fresh debris-flow lobe: wet mud outline with boulders along its edge and logs lying with the flow.
function lobeObjects(R, ns, cx, cy, len, wid, flow, k, big) {
  const poly = blobPts(R, cx, cy, len / 2, wid / 2, flow, 18, 0.22).map((p) => [Math.round(p[0]), Math.round(p[1])]);
  const cf = Math.cos(flow), sf = Math.sin(flow), items = [], nb = Math.round(R.range(10, 22) * (len / (20 * k)));
  for (let i = 0; i < nb; i++) {
    const a = R.chance(0.55) ? R.gauss() * 0.8 : R() * TAU, rr = R.range(0.72, 1.04), x = Math.cos(a) * (len / 2) * rr, y = Math.sin(a) * (wid / 2) * rr, u = R();
    items.push([Math.round(cx + x * cf - y * sf), Math.round(cy + x * sf + y * cf), Math.round((0.18 + (big - 0.18) * u * u * u) * 100) / 100]);
  }
  return [
    { t: 'patch', ch: 0, poly },
    { t: 'boulders', seed: ns(), items },
    { t: 'planks', seed: ns(), cx, cy, r: (wid * 0.36) / k, n: R.int(3, 8), rot: flow, spread: 0.35, lmin: 2.4, lmax: 6.5, wmin: 0.2, wmax: 0.38, log: 1 },
    { t: 'puddle', seed: ns(), cx: cx - cf * len * 0.18 + R.gauss() * k, cy: cy - sf * len * 0.18 + R.gauss() * k, rx: R.range(0.8, 2) * k, ry: R.range(0.4, 0.9) * k, rot: flow + R.gauss() * 0.3 },
  ];
}
const NAMES = {
  rubble: ['Collapsed masonry, east lane', 'Collapsed masonry, bazaar row', 'Rubble field below the school', 'Collapsed terrace houses, north end'],
  mudflow: ['Debris-flow lobe, river terrace', 'Mudflow fan, lower fields', 'Boulder lobe across the track', 'Slide runout, west gully'],
  roofs: ['Village block, tin roofs', 'Roof block above the bazaar', 'Tin-roof cluster, upper lane', 'Village block, south lane'],
  mixed: ['Mixed damage, market lane', 'Block edge, mud and roofs', 'Lane with slide debris', 'Mixed damage, school approach'],
};
const TARPS = [['blue tarp', [30, 92, 190]], ['orange tarp', [228, 118, 30]]];
const BARRELS = [['red barrel', [196, 36, 34]], ['blue barrel', [28, 84, 170]]];
const CLOTHS = [['magenta cloth', [205, 45, 140]], ['yellow cloth', [235, 200, 40]], ['red cloth', [200, 36, 40]], ['turquoise cloth', [30, 170, 170]]];
const BUCKETS = [['green bucket', [40, 160, 80]], ['blue bucket', [30, 100, 200]]];
const PICKUPS = [['white pickup', [226, 226, 220]], ['silver pickup', [170, 174, 178]]];
const vehicleBox = (o, k) => bboxOf(rectPts(o.cx, o.cy, (VEH.l + 0.1) * k, (VEH.w + 0.3) * k, o.rot), 1);

// ---------------------------------------------------------------- buildScene
export function buildScene({ seed = 1, w = 1280, h = 960, pxPerM = 16, theme = 'mixed', figures = 8 } = {}) {
  const TH = ['rubble', 'mudflow', 'roofs', 'mixed'];
  if (TH.indexOf(theme) < 0) theme = 'mixed';
  const R = mk(mix(seed | 0, 100 + TH.indexOf(theme))), k = pxPerM, r3 = (v) => Math.round(v * 1000) / 1000, r1 = (v) => Math.round(v * 10) / 10;
  const sa = (R.int(0, 3) * 0.5 + R.range(0.12, 0.38)) * Math.PI, sun = [r3(Math.cos(sa)), r3(Math.sin(sa))];
  const ga = R.range(-0.4, 0.4), gx = [Math.cos(ga), Math.sin(ga)], gn = [-gx[1], gx[0]];
  const flow = r3(theme === 'mudflow' ? R.range(0, Math.PI) : ga + Math.PI / 2 + R.range(-0.4, 0.4));
  const sc = { seed, w, h, pxPerM, theme, name: R.pick(NAMES[theme]), sun, sunLen: r3(R.range(0.55, 0.85)), flow, ground: 'flood', objects: [], figures: [], distractors: [] };
  const O = sc.objects;
  let sid = 0;
  const ns = () => mix(seed | 0, 1000 + sid++);
  const rnd = (m) => [R.range(m, w - m), R.range(m, h - m)];

  // lane with wheel ruts
  const lc = [w / 2 + R.range(-0.12, 0.12) * w, h / 2 + R.range(-0.18, 0.18) * h], diag = Math.hypot(w, h), laneW = R.range(3.6, 5) * k;
  const amp = R.range(0.8, 2.2) * k, wl = R.range(28, 50) * k, ph = R() * TAU;
  const laneP = (s) => { const off = amp * Math.sin((s / wl) * TAU + ph); return [lc[0] + gx[0] * s + gn[0] * off, lc[1] + gx[1] * s + gn[1] * off]; };
  const lanePts = [];
  for (let s = -diag * 0.7; s <= diag * 0.7; s += 3 * k) { const p = laneP(s); lanePts.push([r1(p[0]), r1(p[1])]); }
  const laneDist = (x, y) => { let m = 1e9; for (const p of lanePts) { const d = Math.hypot(p[0] - x, p[1] - y); if (d < m) m = d; } return m; };
  O.push({ t: 'patch', ch: 1, line: lanePts, width: r1(laneW) });
  sc.lane = { pts: lanePts, width: r1(laneW) };
  for (let i = 0, n = R.int(1, 2); i < n; i++) { const o1 = R.range(-0.6, 0.6) * k; O.push({ t: 'ruts', seed: ns(), gauge: 1.5, water: 0.14, a: 1, pts: lanePts.map((p, j) => [r1(p[0] + gn[0] * (o1 + Math.sin(j * 0.31 + i) * 0.3 * k)), r1(p[1] + gn[1] * (o1 + Math.sin(j * 0.31 + i) * 0.3 * k))]) }); }

  // buildings in rows along the lane
  const cfg = { rubble: { p: 0.8, col: 0.62, dam: 0.16, min: 3, max: 9, row2: 0.3, stand: 1 }, mudflow: { p: 0.2, col: 0.2, dam: 0.5, min: 2, max: 3, row2: 0, stand: 1 }, roofs: { p: 0.92, col: 0.18, dam: 0.25, min: 5, max: 14, row2: 0.7, stand: 2 }, mixed: { p: 0.6, col: 0.3, dam: 0.25, min: 3, max: 7, row2: 0.25, stand: 2 } }[theme];
  const B = [];
  const tryB = (cx, cy, l, wd, rot) => {
    if (cx < 0.04 * w || cx > 0.96 * w || cy < 0.04 * h || cy > 0.96 * h) return false;
    const fp = { cx, cy, hl: l / 2, hw: wd / 2, rot };
    for (const b of B) if (rectHit(fp, b, 1.6 * k)) return false;
    B.push(fp); return true;
  };
  for (let pass = 0; pass < 2; pass++) {
    if (pass && B.length >= cfg.min) break;
    for (const side of [-1, 1]) {
      let s = -diag * 0.55 + R() * 4 * k;
      while (s < diag * 0.55 && B.length < cfg.max) {
        const l = R.range(7, 14) * k, wd = R.range(5, 8.5) * k, perp = R.chance(0.25), along = perp ? wd : l, depth = perp ? l : wd;
        if (R.chance(pass ? 1 : cfg.p)) {
          const p = laneP(s + along / 2), p2 = laneP(s + along / 2 + k), ta = Math.atan2(p2[1] - p[1], p2[0] - p[0]), nx = -Math.sin(ta) * side, ny = Math.cos(ta) * side;
          const dd = laneW / 2 + R.range(1, 4) * k + depth / 2, rot = ta + R.gauss() * 0.03 + (perp ? Math.PI / 2 : 0);
          if (tryB(p[0] + nx * dd, p[1] + ny * dd, l, wd, rot) && R.chance(cfg.row2)) {
            const l2 = R.range(6, 12) * k, w2 = R.range(5, 8) * k, d2 = dd + depth / 2 + R.range(4, 8) * k + w2 / 2;
            tryB(p[0] + nx * d2 + R.gauss() * k, p[1] + ny * d2, l2, w2, ta + R.gauss() * 0.04);
          }
        }
        s += along + R.range(1.5, 6) * k;
      }
    }
  }
  const order = R.shuffle(B.map((_, i) => i));
  let nCol = Math.round(B.length * cfg.col), nDam = Math.round(B.length * cfg.dam);
  if (theme !== 'mudflow' && B.length >= 2) nCol = Math.max(1, nCol);
  nCol = Math.max(0, Math.min(nCol, B.length - cfg.stand));
  B.forEach((b, i) => {
    const rank = order.indexOf(i), state = rank < nCol ? 'collapsed' : rank < nCol + nDam ? 'damaged' : 'intact';
    O.push({ t: 'roof', id: 'B' + (i + 1), cx: r1(b.cx), cy: r1(b.cy), l: r1(b.hl * 2), w: r1(b.hw * 2), rot: r3(b.rot), h: r1(R.chance(0.15) ? R.range(4.8, 5.6) : R.range(2.6, 3.5)), state, seed: ns(), tone: R.int(0, 3), missing: state === 'damaged' ? r3(R.range(0.1, 0.3)) : R.chance(0.3) ? 0.03 : 0 });
    if (state === 'collapsed') {
      const sd = R.chance(0.5) ? 1 : -1, c = Math.cos(b.rot), s = Math.sin(b.rot), d = b.hw + 1.1 * k;
      O.push({ t: 'rub', seed: ns(), cx: r1(b.cx - s * d * sd), cy: r1(b.cy + c * d * sd), rx: r1(b.hl * R.range(0.5, 0.9)), ry: r1(R.range(1.2, 2.4) * k), rot: r3(b.rot), n: R.int(90, 200), pal: 'masonry', smin: 0.07, smax: 0.5 });
    }
  });

  // walls: low stone compound walls, or what is left of masonry walls
  const nWall = { rubble: 3, mudflow: 1, roofs: 3, mixed: 2 }[theme];
  for (let i = 0, tries = 0; i < nWall && tries < 60; tries++) {
    const fps = footprints(sc), remnant = theme === 'rubble' || (theme === 'mixed' && i === 0), a = rnd(4 * k), dir = ga + (R.chance(0.5) ? 0 : Math.PI / 2) + R.gauss() * 0.04;
    const len = (remnant ? R.range(3, 6.5) : R.range(6, 16)) * k, pts = [a, [a[0] + Math.cos(dir) * len, a[1] + Math.sin(dir) * len]];
    if (!remnant && R.chance(0.35)) { const l2 = R.range(3, 8) * k; pts.push([pts[1][0] - Math.sin(dir) * l2, pts[1][1] + Math.cos(dir) * l2]); }
    let ok = true;
    for (let j = 0; j < pts.length - 1 && ok; j++) for (let t = 0; t <= 1; t += 0.1) { const x = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, y = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t; if (!isFree(sc, fps, x, y, 1.4 * k) || laneDist(x, y) < laneW / 2 + 1.6 * k) { ok = false; break; } }
    if (!ok) continue;
    O.push({ t: 'wall', pts: pts.map((p) => [r1(p[0]), r1(p[1])]), th: remnant ? 0.42 : 0.5, h: r1(remnant ? R.range(2.4, 3.2) : R.range(1, 1.5)), kind: remnant ? 'masonry' : 'stone', seed: ns() });
    if (remnant) O.push({ t: 'rub', seed: ns(), cx: r1((pts[0][0] + pts[1][0]) / 2 + R.gauss() * k), cy: r1((pts[0][1] + pts[1][1]) / 2 + R.gauss() * k), rx: r1(len * 0.6), ry: r1(R.range(1.2, 2.2) * k), rot: r3(dir), n: R.int(80, 160), pal: 'masonry', smin: 0.07, smax: 0.5 });
    i++;
  }

  // debris-flow channel and lobes
  if (theme === 'mudflow') {
    const c0 = rnd(0.3 * Math.min(w, h)), cf = Math.cos(flow), sf = Math.sin(flow), line = [], a2 = R.range(2, 5) * k, p2 = R() * TAU;
    for (let s = -diag * 0.7; s <= diag * 0.7; s += 4 * k) { const off = a2 * Math.sin(s / (40 * k) * TAU + p2); line.push([r1(c0[0] + cf * s - sf * off), r1(c0[1] + sf * s + cf * off)]); }
    O.push({ t: 'patch', ch: 0, line, width: r1(R.range(7, 11) * k) });
    const items = [];
    for (let i = 0; i < 46; i++) { const p = R.pick(line), u = R(); items.push([r1(p[0] + R.gauss() * 3.2 * k), r1(p[1] + R.gauss() * 3.2 * k), r3(0.2 + 1.2 * u * u * u)]); }
    O.push({ t: 'boulders', seed: ns(), items });
  }
  const nLobe = theme === 'mudflow' ? R.int(2, 3) : theme === 'mixed' ? 1 : R.chance(0.4) ? 1 : 0;
  for (let i = 0, tries = 0; i < nLobe && tries < 80; tries++) {
    const big = theme === 'mudflow', len = (big ? R.range(16, 32) : R.range(10, 18)) * k, wid = (big ? R.range(8, 15) : R.range(6, 10)) * k, c = rnd(0.12 * Math.min(w, h));
    if (!isFree(sc, footprints(sc), c[0], c[1], wid * 0.45, { collapsedOk: true })) continue;
    const objs = lobeObjects(R, ns, r1(c[0]), r1(c[1]), len, wid, flow, k, big ? 1.3 : 0.8);
    for (const o of objs) O.push(o);
    i++;
  }
  // rubble fields: piles made of several overlapping heaps
  const nField = { rubble: 5, mudflow: 1, roofs: 1, mixed: 2 }[theme];
  for (let i = 0, tries = 0; i < nField && tries < 60; tries++) {
    const c = rnd(2 * k);
    if (!isFree(sc, footprints(sc), c[0], c[1], 3 * k, { collapsedOk: true })) continue;
    for (let j = 0, m = R.int(3, 5); j < m; j++) O.push({ t: 'rub', seed: ns(), cx: r1(c[0] + R.gauss() * 3.4 * k), cy: r1(c[1] + R.gauss() * 3.4 * k), rx: r1(R.range(2, 5) * k), ry: r1(R.range(1.3, 3) * k), rot: r3(R() * TAU), n: R.int(110, 300), pal: 'masonry', smin: 0.07, smax: 0.55 });
    i++;
  }

  // a pickup on the lane
  const wantVeh = theme === 'roofs' || theme === 'mixed' || R.chance(theme === 'rubble' ? 0.5 : 0.3);
  if (wantVeh) {
    const fps = footprints(sc);
    for (let t = 0; t < 300; t++) {
      const s = R.range(-diag * 0.5, diag * 0.5), p = laneP(s), p2 = laneP(s + k), ta = Math.atan2(p2[1] - p[1], p2[0] - p[0]), off = t < 200 ? R.range(-0.8, 0.8) * k : R.range(-8, 8) * k;
      const x = p[0] - Math.sin(ta) * off, y = p[1] + Math.cos(ta) * off, rot = ta + (R.chance(0.5) ? Math.PI : 0) + R.gauss() * 0.08;
      if (x < 5 * k || y < 5 * k || x > w - 5 * k || y > h - 5 * k) continue;
      if (![-1.6, 0, 1.6].every((d) => isFree(sc, fps, x + Math.cos(rot) * d * k, y + Math.sin(rot) * d * k, 1.7 * k))) continue;
      const pk = R.pick(PICKUPS), v = { t: 'vehicle', cx: r1(x), cy: r1(y), rot: r3(rot), rgb: pk[1], seed: ns() };
      O.push(v);
      sc.distractors.push({ id: 'X1', kind: 'vehicle', name: pk[0], rgb: pk[1], bbox: bbClip(vehicleBox(v, k), w, h) });
      break;
    }
  }

  // people
  const classes = ['bright', 'muted', 'covered', 'shadow'], nF = Math.max(0, figures | 0), placed = new Array(nF).fill(null);
  const brightOrder = R.shuffle(BRIGHT.slice()), mutedOrder = R.shuffle(MUTED.slice()), POST = { bright: ['lying', 'standing', 'sitting'], muted: ['lying', 'sitting', 'standing'] };
  const pc = { bright: R.int(0, 2), muted: R.int(0, 2) };
  let bi = 0, mi = 0;
  sc.figures = placed;
  const edgeOK = (x, y, m) => x > m && y > m && x < w - m && y < h - m;
  const farFigs = (x, y) => placed.every((f) => !f || Math.hypot(f.cx - x, f.cy - y) >= 6.3 * k);
  const placeShadow = () => {
    const fps = footprints(sc), hosts = R.shuffle(O.filter((o) => (o.t === 'roof' && o.state !== 'collapsed') || (o.t === 'wall' && o.h >= 2.2)));
    for (const ho of hosts) {
      const polys = shadowPolys(ho, k, sun, sc.sunLen), base = ho.t === 'roof' ? ho.rot : Math.atan2(ho.pts[1][1] - ho.pts[0][1], ho.pts[1][0] - ho.pts[0][0]);
      for (let t = 0; t < 90; t++) {
        const sp = R.pick(polys), bb = bboxOf(sp), x = R.range(bb[0], bb[2]), y = R.range(bb[1], bb[3]);
        if (!edgeOK(x, y, 3.9 * k) || !farFigs(x, y)) continue;
        const ang = base + (R.int(0, 3) * Math.PI) / 2 + R.range(-0.1, 0.1), pts = bodyPts(x, y, ang, 0.95, 0.38, k);
        if (!pts.every((p) => inPoly(sp, p[0], p[1])) || !pts.every((p) => fps.every((fp) => distRect(fp, p[0], p[1]) > 0.3 * k))) continue;
        ho.host = true;
        return { x, y, ang };
      }
    }
    for (let t = 0; t < 500; t++) {
      const c = rnd(7 * k);
      if (!farFigs(c[0], c[1]) || !isFree(sc, fps, c[0], c[1], (t < 300 ? 4.4 : 3.4) * k, { collapsedOk: true, dis: 3 * k })) continue;
      const hgt = R.range(3.0, 3.4), len = R.range(5, 6.5) * k, dx = -sun[1], dy = sun[0], depth = hgt * sc.sunLen * k;
      O.push({ t: 'wall', pts: [[r1(c[0] - (dx * len) / 2), r1(c[1] - (dy * len) / 2)], [r1(c[0] + (dx * len) / 2), r1(c[1] + (dy * len) / 2)]], th: 0.42, h: r1(hgt), kind: 'masonry', seed: ns(), host: true });
      O.push({ t: 'rub', seed: ns(), cx: r1(c[0] - sun[0] * 1.2 * k), cy: r1(c[1] - sun[1] * 1.2 * k), rx: r1(len * 0.55), ry: r1(1.5 * k), rot: r3(Math.atan2(dy, dx)), n: R.int(80, 150), pal: 'masonry', smin: 0.07, smax: 0.5 });
      return { x: c[0] + sun[0] * (0.32 * k + depth * 0.42), y: c[1] + sun[1] * (0.32 * k + depth * 0.42), ang: Math.atan2(dy, dx) + (R.chance(0.5) ? Math.PI : 0) };
    }
    return null;
  };
  const placeOpen = (posture, cls) => {
    const fps = footprints(sc), sh = allShadows(sc), lying = posture === 'lying';
    for (let t = 0; t < 800; t++) {
      const c = rnd(3.9 * k);
      if (!farFigs(c[0], c[1]) || !isFree(sc, fps, c[0], c[1], (lying ? 1.6 : 1.2) * k, { collapsedOk: lying && cls !== 'bright', dis: 3.5 * k })) continue;
      const ang = R() * TAU, pts = bodyPts(c[0], c[1], ang, lying ? 1.0 : 0.6, lying ? 0.5 : 0.6, k);
      if (pts.some((p) => inAny(sh, p[0], p[1]))) continue;
      return { x: c[0], y: c[1], ang };
    }
    return null;
  };
  const idx = []; for (let i = 0; i < nF; i++) if (classes[i % 4] === 'shadow') idx.push(i);
  for (let i = 0; i < nF; i++) if (classes[i % 4] !== 'shadow') idx.push(i);
  for (const i of idx) {
    const cls = classes[i % 4], posture = cls === 'covered' || cls === 'shadow' ? 'lying' : POST[cls][(pc[cls]++) % 3];
    const pos = cls === 'shadow' ? placeShadow() : placeOpen(posture, cls);
    if (!pos) continue;
    const top = cls === 'muted' ? mutedOrder[mi++ % mutedOrder.length] : brightOrder[bi++ % brightOrder.length];
    const bottom = cls === 'muted' ? R.pick(BOTTOM_EARTH) : R.pick(BOTTOM_DARK);
    placed[i] = mkFigure(R, k, { id: 'F' + (i + 1), x: pos.x, y: pos.y, angle: r3(pos.ang), posture, difficulty: cls, top, bottom, sun, sl: sc.sunLen });
  }
  sc.figures = placed.filter(Boolean);

  // distractors: the realistic false alarms
  const nDis = R.int(2, 4);
  const spot = (r) => { const fps = footprints(sc); for (let t = 0; t < 500; t++) { const c = rnd(3 * k); if (isFree(sc, fps, c[0], c[1], r + 0.8 * k, { fig: r + 4 * k, dis: r + 3 * k })) return c; } return null; };
  const addDis = (kind, name, rgb, bbox, obj) => { sc.distractors.push({ id: 'X' + (sc.distractors.length + 1), kind, name, rgb, bbox: bbClip(bbox, w, h) }); O.push(obj); };
  const makers = {
    tarp: () => { const l = R.range(2, 4) * k, wd = R.range(1.8, 3) * k, c = spot(Math.max(l, wd) / 2); if (!c) return; const tp = R.pick(TARPS), o = { t: 'tarp', cx: r1(c[0]), cy: r1(c[1]), l: r1(l), w: r1(wd), rot: r3(R() * TAU), rgb: tp[1], seed: ns() }; addDis('tarp', tp[0], tp[1], bboxOf(rectPts(o.cx, o.cy, o.l * 1.14, o.w * 1.14, o.rot), 1), o); },
    barrel: () => { const c = spot(0.5 * k); if (!c) return; const b = R.pick(BARRELS), r = 0.29 * k; addDis('barrel', b[0], b[1], [Math.floor(c[0] - r - 1), Math.floor(c[1] - r - 1), Math.ceil(c[0] + r + 1), Math.ceil(c[1] + r + 1)], { t: 'barrel', cx: r1(c[0]), cy: r1(c[1]), rgb: b[1] }); },
    cloth: () => { const c = spot(0.8 * k); if (!c) return; const cl = R.pick(CLOTHS), o = { t: 'cloth', cx: r1(c[0]), cy: r1(c[1]), s: r3(R.range(0.9, 1.6)), rot: r3(R() * TAU), rgb: cl[1], seed: ns() }; addDis('cloth', cl[0], cl[1], bboxOf(clothPts(o, k), 1), o); },
    bucket: () => { const c = spot(0.4 * k); if (!c) return; const b = R.pick(BUCKETS), r = 0.17 * k; addDis('bucket', b[0], b[1], [Math.floor(c[0] - r - 1), Math.floor(c[1] - r - 1), Math.ceil(c[0] + r + 1), Math.ceil(c[1] + r + 1)], { t: 'bucket', cx: r1(c[0]), cy: r1(c[1]), rgb: b[1] }); },
  };
  for (const kind of ['tarp'].concat(R.shuffle(['barrel', 'cloth', 'bucket', 'barrel']))) if (sc.distractors.length < nDis) makers[kind]();

  // clutter that people must not end up under: scrub, boulders, puddles keep clear of them
  const clear = (x, y, r) => isFree(sc, footprints(sc), x, y, r, { fig: r + 1.8 * k, dis: r + 0.6 * k });
  const roofs = O.filter((o) => o.t === 'roof');
  for (let i = 0, n = { rubble: 10, mudflow: 5, roofs: 9, mixed: 8 }[theme]; i < n; i++) {
    let c = rnd(k), rot = R() * TAU;
    if (roofs.length && R.chance(0.6)) { const b = R.pick(roofs), sd = R.chance(0.5) ? 1 : -1, t = R.range(-0.4, 0.4) * b.l, d = b.w / 2 + R.range(0.5, 1.4) * k, cr = Math.cos(b.rot), sr = Math.sin(b.rot); c = [b.cx + cr * t - sr * d * sd, b.cy + sr * t + cr * d * sd]; rot = b.rot; }
    const stacked = R.chance(0.5), r = R.range(0.7, 1.8), lmax = R.range(2.2, 3.8);
    O.push({ t: 'planks', seed: ns(), cx: r1(c[0]), cy: r1(c[1]), r: r3(r), n: R.int(4, 14), rot: r3(rot), spread: stacked ? 0.22 : 1.3, lmin: 1, lmax: r3(lmax), wash: 1, bb: [Math.floor(c[0] - (r + lmax / 2) * k), Math.floor(c[1] - (r + lmax / 2) * k), Math.ceil(c[0] + (r + lmax / 2) * k), Math.ceil(c[1] + (r + lmax / 2) * k)] });
  }
  for (let i = 0; i < 2; i++) { const c = rnd(8 * k); O.push({ t: 'planks', seed: ns(), cx: r1(c[0]), cy: r1(c[1]), r: 9, n: R.int(5, 9), rot: flow, spread: 0.9, lmin: 1, lmax: 4 }); }
  for (let i = 0, n = theme === 'mudflow' ? 9 : 3, tries = 0; i < n && tries < 200; tries++) {
    const c = rnd(k), rx = R.range(1.6, 4.5) * k, ry = R.range(1.2, 3) * k, smax = theme === 'mudflow' ? R.range(0.6, 1.4) : R.range(0.4, 0.9);
    if (!clear(c[0], c[1], Math.max(rx, ry))) continue;
    O.push({ t: 'boulders', seed: ns(), cx: r1(c[0]), cy: r1(c[1]), rx: r1(rx), ry: r1(ry), rot: flow, n: R.int(5, 16), smin: 0.15, smax: r3(smax), wash: 1, bb: [Math.floor(c[0] - rx * 1.2 - smax * k), Math.floor(c[1] - rx * 1.2 - smax * k), Math.ceil(c[0] + rx * 1.2 + smax * 2 * k), Math.ceil(c[1] + rx * 1.2 + smax * 2 * k)] });
    i++;
  }
  for (let i = 0, n = R.int(1, 2); i < n; i++) { const e = R.int(0, 3), c = e === 0 ? [R.range(0, w), 0] : e === 1 ? [w, R.range(0, h)] : e === 2 ? [R.range(0, w), h] : [0, R.range(0, h)]; O.push({ t: 'patch', ch: 2, poly: blobPts(R, c[0], c[1], R.range(9, 16) * k, R.range(6, 11) * k, R() * TAU, 14, 0.25).map((p) => [Math.round(p[0]), Math.round(p[1])]) }); }
  for (let i = 0, n = R.int(6, 10), tries = 0; i < n && tries < 300; tries++) {
    const c = rnd(0), r = R.range(1.4, 3.8);
    if (laneDist(c[0], c[1]) < laneW / 2 + r * k * 0.6 || !clear(c[0], c[1], r * k)) continue;
    if (R.chance(0.6)) O.push({ t: 'patch', ch: 2, poly: blobPts(R, c[0], c[1], r * 1.5 * k, r * 1.2 * k, R() * TAU, 10, 0.25).map((p) => [Math.round(p[0]), Math.round(p[1])]) });
    O.push({ t: 'scrub', seed: ns(), cx: r1(c[0]), cy: r1(c[1]), r: r3(r), n: R.int(3, 9), wash: 1, bb: [Math.floor(c[0] - (r + 1.6) * k), Math.floor(c[1] - (r + 1.6) * k), Math.ceil(c[0] + (r + 1.6) * k), Math.ceil(c[1] + (r + 1.6) * k)] });
    i++;
  }
  for (let i = 0, n = R.int(5, 9), tries = 0; i < n && tries < 200; tries++) {
    let c = rnd(k);
    if (R.chance(0.5)) { const p = R.pick(lanePts); c = [p[0] + R.gauss() * 0.6 * k, p[1] + R.gauss() * 0.6 * k]; }
    const rx = R.range(0.5, 1.9) * k;
    if (!edgeOK(c[0], c[1], 0) || !clear(c[0], c[1], rx)) continue;
    O.push({ t: 'puddle', seed: ns(), cx: r1(c[0]), cy: r1(c[1]), rx: r1(rx), ry: r1(rx * R.range(0.4, 0.7)), rot: r3(R.chance(0.5) ? ga : flow) });
    i++;
  }
  for (let i = 0, n = R.int(8, 14); i < n; i++) { const c = rnd(0); O.push({ t: 'rub', seed: ns(), cx: r1(c[0]), cy: r1(c[1]), rx: r1(R.range(1, 2.6) * k), ry: r1(R.range(0.7, 1.6) * k), rot: r3(R() * TAU), n: R.int(20, 70), pal: R.chance(0.3) ? 'stone' : 'masonry', smin: 0.06, smax: 0.4, dust: 0 }); }
  sc.figures.forEach((f, i) => O.push({ t: 'fig', i }));
  return sc;
}

// ---------------------------------------------------------------- mutateScene
export function mutateScene(scene, seed = 1) {
  const sc = JSON.parse(JSON.stringify(scene)), base = mix((scene.seed | 0) ^ 0x5bd1e995, seed | 0), R = mk(base), k = sc.pxPerM, w = sc.w, h = sc.h, O = sc.objects;
  const r1 = (v) => Math.round(v * 10) / 10, r3 = (v) => Math.round(v * 1000) / 1000;
  let sid = 0;
  const ns = () => mix(base, 5000 + sid++);
  const changes = [], taken = [];
  const add = (kind, label, bbox, areaM2, extra) => changes.push(Object.assign({ id: '', kind, label, bbox: bbClip(bbox.map(Math.round), w, h), areaM2: Math.round(areaM2 * 10) / 10 }, extra || {}));
  const spot = (r, edge, tries = 500) => {
    const fps = footprints(sc);
    for (let t = 0; t < tries; t++) {
      const x = R.range(edge, w - edge), y = R.range(edge, h - edge);
      if (!isFree(sc, fps, x, y, r, { fig: r + 2 * k, dis: r + 1.5 * k, collapsedOk: true }) || taken.some((c) => Math.hypot(c.x - x, c.y - y) < c.r + r + 2 * k)) continue;
      return [x, y];
    }
    return null;
  };
  const roofC = O.filter((o) => o.t === 'roof' && o.state !== 'collapsed' && !o.host && !o.torn);
  const veh = O.find((o) => o.t === 'vehicle');
  const washC = O.filter((o) => o.wash && o.bb && o.bb[0] > 0 && o.bb[1] > 0 && o.bb[2] < w && o.bb[3] < h && sc.figures.every((f) => f.cx < o.bb[0] - k || f.cx > o.bb[2] + k || f.cy < o.bb[1] - k || f.cy > o.bb[3] + k));
  const plan = ['debris flow', 'new shelter', 'new rubble'];
  if (roofC.length) plan.unshift('collapse');
  if (veh) plan.push('vehicle moved');
  if (washC.length) plan.push('washed away');
  const count = () => plan.length + (plan.indexOf('vehicle moved') >= 0 ? 1 : 0);
  const optional = R.shuffle(['new rubble', 'washed away', 'new shelter']);
  while (count() > 6 || (count() > 4 && optional.length > 1 && R.chance(0.3))) { const d = optional.pop(), i = plan.indexOf(d); if (i >= 0) plan.splice(i, 1); if (!optional.length) break; }
  while (count() < 4) plan.push('new rubble');

  const doRubble = (r) => {
    const p = spot(r * k, 2 * k); if (!p) return false;
    const rx = R.range(0.7, 1) * r * k, ry = R.range(0.5, 0.75) * r * k, rot = R() * TAU;
    O.push({ t: 'rub', seed: ns(), cx: r1(p[0]), cy: r1(p[1]), rx: r1(rx), ry: r1(ry), rot: r3(rot), n: Math.round(R.range(26, 40) * (rx * ry) / (k * k)), pal: 'masonry', smin: 0.07, smax: 0.55 });
    taken.push({ x: p[0], y: p[1], r: rx });
    add('new rubble', 'Fresh rubble spread', bboxOf(rectPts(p[0], p[1], rx * 2.35, ry * 2.35, rot), 0.6 * k), (Math.PI * rx * ry * 0.6) / (k * k));
    return true;
  };
  for (const kind of plan) {
    if (kind === 'collapse') {
      const inside = roofC.filter((o) => o.cx > 0.1 * w && o.cx < 0.9 * w && o.cy > 0.1 * h && o.cy < 0.9 * h), o = R.pick(inside.length ? inside : roofC);
      const sh = shadowPolys(o, k, sc.sun, sc.sunLen)[0];
      o.state = 'collapsed';
      taken.push({ x: o.cx, y: o.cy, r: Math.max(o.l, o.w) / 2 + 2 * k });
      add('collapse', 'Roof collapsed', bbUnion(bboxOf(rectPts(o.cx, o.cy, o.l + 4.6 * k, o.w + 4.6 * k, o.rot)), bboxOf(sh, 3)), (o.l * o.w) / (k * k), { object: o.id });
    } else if (kind === 'debris flow') {
      for (const r of [7.5, 6.5, 5.5, 4.5, 3.6]) {
        const p = spot(r * k, r * 0.5 * k, 250); if (!p) continue;
        const len = r * 2.3 * k, wid = r * 1.55 * k, objs = lobeObjects(R, ns, r1(p[0]), r1(p[1]), len, wid, sc.flow, k, 0.9);
        for (const q of objs) O.push(q);
        taken.push({ x: p[0], y: p[1], r: r * k });
        add('debris flow', 'New debris-flow lobe', bboxOf(objs[0].poly, 1.5 * k), polyArea(objs[0].poly) / (k * k));
        break;
      }
    } else if (kind === 'vehicle moved') {
      const fps = footprints(sc, veh), old = bbUnion(vehicleBox(veh, k), bboxOf(shadowPolys(veh, k, sc.sun, sc.sunLen)[0], 2)), lane = (sc.lane && sc.lane.pts) || [];
      for (let t = 0; t < 600; t++) {
        let x, y, rot;
        if (lane.length > 2 && t < 400) { const i = R.int(1, lane.length - 2), ta = Math.atan2(lane[i + 1][1] - lane[i - 1][1], lane[i + 1][0] - lane[i - 1][0]), off = R.range(-0.9, 0.9) * k; x = lane[i][0] - Math.sin(ta) * off; y = lane[i][1] + Math.cos(ta) * off; rot = ta + (R.chance(0.5) ? Math.PI : 0) + R.gauss() * 0.1; } else { x = R.range(0, w); y = R.range(0, h); rot = R() * TAU; }
        if (x < 5 * k || y < 5 * k || x > w - 5 * k || y > h - 5 * k || Math.hypot(x - veh.cx, y - veh.cy) < 9 * k) continue;
        if (![-1.6, 0, 1.6].every((d) => isFree(sc, fps, x + Math.cos(rot) * d * k, y + Math.sin(rot) * d * k, 1.7 * k, { fig: 3.4 * k, dis: 2.4 * k })) || taken.some((c) => Math.hypot(c.x - x, c.y - y) < c.r + 4 * k)) continue;
        veh.cx = r1(x); veh.cy = r1(y); veh.rot = r3(rot);
        const nb = bbUnion(vehicleBox(veh, k), bboxOf(shadowPolys(veh, k, sc.sun, sc.sunLen)[0], 2)), dz = sc.distractors.find((d) => d.kind === 'vehicle');
        if (dz) dz.bbox = bbClip(vehicleBox(veh, k), w, h);
        taken.push({ x, y, r: 3 * k });
        add('vehicle moved', 'Pickup gone from here', old, VEH.l * VEH.w, { part: 'from' });
        add('vehicle moved', 'Pickup now parked here', nb, VEH.l * VEH.w, { part: 'to' });
        break;
      }
    } else if (kind === 'new shelter') {
      const p = spot(2.6 * k, 4 * k); if (!p) continue;
      const tp = R.pick(TARPS), o = { t: 'tarp', shelter: 1, cx: r1(p[0]), cy: r1(p[1]), l: r1(R.range(2, 3) * k), w: r1(R.range(2, 2.6) * k), rot: r3(R() * TAU), rgb: tp[1], seed: ns() };
      O.push(o); taken.push({ x: p[0], y: p[1], r: 2.4 * k });
      const bb = bboxOf(rectPts(o.cx, o.cy, o.l * 1.14, o.w * 1.14, o.rot), 1);
      sc.distractors.push({ id: 'X' + (sc.distractors.length + 1), kind: 'tarp', name: tp[0] + ' shelter', rgb: tp[1], bbox: bbClip(bb, w, h) });
      add('new shelter', 'Tarp shelter put up', bboxOf(rectPts(o.cx, o.cy, o.l * 1.5, o.w * 1.6, o.rot), sc.sunLen * k), (o.l * o.w) / (k * k));
    } else if (kind === 'new rubble') {
      doRubble(R.range(2.6, 3.6)) || doRubble(2);
    } else if (kind === 'washed away') {
      const cands = washC.filter((o) => !taken.some((c) => Math.hypot(c.x - (o.bb[0] + o.bb[2]) / 2, c.y - (o.bb[1] + o.bb[3]) / 2) < c.r + (o.bb[2] - o.bb[0]) / 2 + 2 * k));
      if (!cands.length) continue;
      const o = R.pick(cands), bb = o.bb, cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2, rx = (bb[2] - bb[0]) / 2, ry = (bb[3] - bb[1]) / 2;
      O.splice(O.indexOf(o), 1);
      O.push({ t: 'patch', ch: 0, poly: blobPts(R, cx, cy, rx * 0.7, ry * 0.5, sc.flow, 12, 0.2).map((p) => [Math.round(p[0]), Math.round(p[1])]) });
      taken.push({ x: cx, y: cy, r: Math.max(rx, ry) });
      add('washed away', o.t === 'planks' ? 'Timber pile washed away' : o.t === 'boulders' ? 'Boulders carried off' : 'Scrub stripped away', [bb[0] - k, bb[1] - k, bb[2] + k, bb[3] + k], (4 * rx * ry * 0.6) / (k * k));
    }
  }
  for (let t = 0; t < 6 && changes.length < 4; t++) doRubble(R.range(1.8, 3));
  changes.forEach((c, i) => { c.id = 'C' + (i + 1); });
  sc.after = true;
  return { scene: sc, changes };
}

// ---------------------------------------------------------------- buildSiteScene
// The exercise block as one mosaic. World metres (x east, y north) map to image x = X * pxPerM, y = (90 - Y) * pxPerM.
export function buildSiteScene(world, { leads = [], team = [], pxPerM = 12, before = false } = {}) {
  const k = pxPerM, W = Math.round(120 * k), H = Math.round(90 * k), seed = 20261121, wd = world || {};
  const r1 = (v) => Math.round(v * 10) / 10;
  const P = (X, Y) => [r1(X * k), r1((90 - Y) * k)], PP = (pts) => pts.map((p) => P(p[0], p[1]));
  const sv = [-0.857, -0.515], flow = Math.atan2(0.6, -0.8);
  const sc = { seed, w: W, h: H, pxPerM: k, theme: 'site', name: before ? 'Block B before the flood' : 'Block B after the flood', sun: sv, sunLen: 0.8, flow, ground: before ? 'dry' : 'flood', site: true, before: !!before, objects: [], figures: [], distractors: [] };
  const O = sc.objects;
  const S = mk(mix(seed, 1)), R = mk(mix(seed, before ? 2 : 3)); // S: things both frames share, R: the rest
  let sid = 0;
  const ns = () => mix(seed, 9000 + sid++);
  const polyOf = (arr, id, def) => { const o = (arr || []).find((q) => q.id === id); return (o && o.poly) || def; };
  const rectOf = (poly) => { const b = [1e9, 1e9, -1e9, -1e9]; for (const p of poly) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); } return b; };
  const scale = (poly, f) => { let cx = 0, cy = 0; for (const p of poly) { cx += p[0] / poly.length; cy += p[1] / poly.length; } return poly.map((p) => [cx + (p[0] - cx) * f, cy + (p[1] - cy) * f]); };
  const site = wd.SITE || {}, stg = site.staging || [26, 12], dpad = site.dronePad || [20, 17], ent = site.entrance || [64, 27];
  const bB = (wd.BUILDING && wd.BUILDING.rect) || [44, 30, 84, 58];
  const bA = rectOf(polyOf(wd.OBSTACLES, 'bldg-a', [[8, 40], [34, 40], [34, 70], [8, 70]])), bC = rectOf(polyOf(wd.OBSTACLES, 'bldg-c', [[92, 20], [112, 20], [112, 46], [92, 46]]));
  const pNE = polyOf(wd.OBSTACLES, 'rubble-ne', [[80, 52], [84, 50], [86, 55], [84, 60], [78, 60], [78.5, 55]]);
  const pField = polyOf(wd.OBSTACLES, 'rubble-field', [[90, 64], [102, 62], [106, 70], [100, 77], [90, 75]]);
  const pMud = polyOf(wd.HAZARDS, 'hz-mud-c', [[88, 16], [116, 16], [116, 50], [88, 50]]);
  const pSlope = polyOf(wd.HAZARDS, 'hz-slope-ne', [[72, 48], [90, 46], [92, 62], [74, 62]]);
  const fc = rectOf(pField), fcx = (fc[0] + fc[2]) / 2, fcy = (fc[1] + fc[3]) / 2;
  const blob = (X, Y, rx, ry, rot, RR) => blobPts(RR, X * k, (90 - Y) * k, rx * k, ry * k, rot, 14, 0.2).map((p) => [Math.round(p[0]), Math.round(p[1])]);

  // ---- shared by both frames: lanes, standing ground, walls, Building A
  const gapX = (bA[2] + bB[0]) / 2;
  const lanes = [
    { w: 3.8, pts: [[stg[0] - 9, -2], [stg[0] - 4, stg[1] - 5], [stg[0] + 3, stg[1] + 1], [(stg[0] + ent[0]) / 2, (stg[1] + ent[1]) / 2 - 1.5], [ent[0], ent[1] - 2.4]] },
    { w: 3.4, pts: [[ent[0], ent[1] - 2.4], [bB[2] + 3, bB[1] - 5], [bC[0] - 3.5, bC[1] - 7.5], [108, 10], [123, 8]] },
    { w: 2.6, pts: [[gapX - 4, 16.5], [gapX, 26], [gapX, 46], [gapX + 0.5, 63], [bB[0] + 8, bB[3] + 7.5], [bB[2] - 6, bB[3] + 8.5], [fcx - 3, fcy]] },
    { w: 2.2, pts: [[gapX + 0.5, 63], [gapX - 2, 78], [gapX - 4, 93]] },
  ];
  for (const l of lanes) {
    const pts = PP(l.pts);
    O.push({ t: 'patch', ch: 1, line: pts, width: r1(l.w * k) });
    if (l.w > 3) O.push({ t: 'ruts', seed: ns(), gauge: 1.5, water: before ? 0 : 0.12, a: before ? 0.6 : 1, pts });
  }
  sc.lane = { pts: PP(lanes[0].pts), width: r1(3.8 * k) };
  O.push({ t: 'patch', ch: 1, poly: blob((stg[0] + dpad[0]) / 2, (stg[1] + dpad[1]) / 2, 10, 6.5, Math.atan2(-(dpad[1] - stg[1]), dpad[0] - stg[0]), S) });
  O.push({ t: 'patch', ch: 1, poly: blob(ent[0], ent[1] - 1.5, 6.5, 2.8, 0, S) });
  for (const v of [[3, 56, 5, 24, 0], [22, 84, 17, 6, 0.1], [72, 87, 22, 4.5, -0.05], [112, 86, 11, 6, 0.2], [58, 9, 9, 3.5, 0.1]]) O.push({ t: 'patch', ch: 2, poly: blob(v[0], v[1], v[2], v[3], v[4], S) });
  for (const v of [[3.5, 62, 3.5, 7], [2.5, 46, 2.5, 5], [16, 85, 4, 8], [30, 83, 3, 5], [64, 87, 3.5, 6], [82, 88, 3, 5], [112, 86, 4, 7], [56, 9.5, 2.5, 4], [118, 60, 2.5, 4], [40, 2.5, 2.5, 4]]) {
    const c = P(v[0], v[1]);
    O.push({ t: 'scrub', seed: ns(), cx: c[0], cy: c[1], r: v[2], n: v[3] });
  }
  O.push({ t: 'wall', pts: PP([[40, 5], [70, 4.2], [86, 5.6]]), th: 0.5, h: 1.1, kind: 'stone', seed: ns() });
  O.push({ t: 'wall', pts: PP([[5.2, 37], [5.2, 73.5], [19, 75.6]]), th: 0.5, h: 1.2, kind: 'stone', seed: ns() });
  O.push({ t: 'wall', pts: PP([[46, 78.5], [75, 80.5]]), th: 0.5, h: 1.0, kind: 'stone', seed: ns() });
  const roof = (id, r, ridge, extra) => {
    const c = P((r[0] + r[2]) / 2, (r[1] + r[3]) / 2), ew = (r[2] - r[0]) * k, nsz = (r[3] - r[1]) * k;
    return Object.assign({ t: 'roof', id, cx: c[0], cy: c[1], l: r1(ridge === 'ew' ? ew : nsz), w: r1(ridge === 'ew' ? nsz : ew), rot: ridge === 'ew' ? 0 : Math.PI / 2, h: 4, state: 'intact', seed: ns(), tone: 0, missing: 0 }, extra);
  };
  const aw = Math.min(16, (bA[2] - bA[0]) * 0.62);
  O.push(roof('A-wing', [bA[0] + aw, bA[1] + 7, bA[2], bA[3] - 7], 'ew', { h: 5, tone: 1 }));
  O.push(roof('A', [bA[0], bA[1], bA[0] + aw, bA[3]], 'ns', { h: 7, tone: 3 }));
  { const c = P(bA[2] - 3, bA[3] - 10.5); O.push({ t: 'tank', cx: c[0], cy: c[1], r: 0.75 }); }
  // seeds for B and C are taken in both frames so that A, the lanes and the walls stay identical
  const sBs = ns(), sBn = ns(), sC = ns();
  const midY = (bB[1] + bB[3]) / 2;

  if (before) {
    O.push(roof('B-south', [bB[0], bB[1], bB[2], midY], 'ew', { h: 4.4, seed: sBs }));
    O.push(roof('B-north', [bB[0], midY, bB[2], bB[3]], 'ew', { h: 4.4, seed: sBn }));
    O.push(roof('C', bC, 'ns', { h: 6, tone: 1, seed: sC }));
    // schoolyard with a volleyball court where the debris field will be
    O.push({ t: 'patch', ch: 1, poly: blob(fcx, fcy, 13, 8.5, 0.1, R) });
    { const c = P(fcx, fcy); O.push({ t: 'court', cx: c[0], cy: c[1], l: r1(18 * k), w: r1(9 * k), rot: -0.12 }); }
    for (const v of [[fc[0] - 2, fc[3] + 2, 2.5, 5], [fc[2] + 3, fc[1] - 1, 3, 6], [fc[2] + 4, fc[3] + 1, 2.5, 4]]) { const c = P(v[0], v[1]); O.push({ t: 'scrub', seed: ns(), cx: c[0], cy: c[1], r: v[2], n: v[3] }); }
    // green slope above the block
    O.push({ t: 'patch', ch: 2, poly: organic(R, PP([[bB[2] + 0.5, 47], [90, 46], [92, 62], [74, 62], [74, bB[3] + 0.8], [bB[2] + 0.5, bB[3] + 0.8]]), 4 * k, 1.2 * k) });
    for (const v of [[87.5, 50, 2.6, 7], [88.5, 57, 2.8, 8], [80, 60.6, 2.4, 6], [86.5, 61, 2, 5]]) { const c = P(v[0], v[1]); O.push({ t: 'scrub', seed: ns(), cx: c[0], cy: c[1], r: v[2], n: v[3] }); }
    // dry yard and terraced garden plots around Building C
    const plots = [[[89, 5.2], [98, 5.6], [98, 14.8], [89, 14.4]], [[98.8, 5.6], [108, 6], [108, 15], [98.8, 14.9]], [[108.8, 6.1], [118.4, 6.6], [118.4, 15.2], [108.8, 15]], [[113.4, 17.2], [119, 17.2], [119, 31], [113.4, 31]], [[113.4, 32], [119, 32], [119, 49], [113.4, 49]], [[88.6, 47.4], [91, 47.4], [91, 56], [88.6, 56]]];
    plots.forEach((q, i) => O.push({ t: 'plots', poly: PP(q), ang: i % 2 ? 0.04 : Math.PI / 2 + 0.03, tone: i % 2, seed: ns() }));
    O.push({ t: 'patch', ch: 2, poly: blob(102, 10, 16, 6, 0, R) });
    O.push({ t: 'patch', ch: 2, poly: blob(116.5, 33, 4, 18, 0, R) });
    for (const v of [[90, 18, 1.6, 3], [114, 47.5, 1.4, 3], [90.5, 44, 1.5, 3]]) { const c = P(v[0], v[1]); O.push({ t: 'scrub', seed: ns(), cx: c[0], cy: c[1], r: v[2], n: v[3] }); }
    return sc;
  }

  // ---- after the flood
  const neI = PP(pNE);
  O.push(roof('B-south', [bB[0], bB[1], bB[2], midY], 'ew', { h: 4.4, seed: sBs, missing: 0.03 }));
  O.push(roof('B-north', [bB[0], midY, bB[2], bB[3]], 'ew', { h: 4.4, seed: sBn, missing: 0.02, torn: [scale(neI, 1.18)], near: [scale(neI, 2.0)] }));
  O.push(roof('C', bC, 'ns', { h: 6, tone: 1, seed: sC, state: 'damaged', missing: 0.24 }));
  // deep mud around C, debris field, collapsed corner
  O.push({ t: 'patch', ch: 0, poly: organic(R, PP(pMud), 4 * k, 1.5 * k) });
  O.push({ t: 'patch', ch: 0, poly: organic(R, PP(scale(pField, 1.12)), 3 * k, 1.2 * k) });
  O.push({ t: 'patch', ch: 0, poly: PP(scale(pNE, 1.3)) });
  O.push({ t: 'patch', ch: 0, line: PP([[fcx + 6, fcy + 12], [fcx, fcy], [bB[2] + 6, bB[3] - 2], [bB[2] + 7, 40], [(pMud[0][0] + pMud[1][0]) / 2, 34]]), width: r1(5 * k) });
  O.push({ t: 'rub', seed: ns(), poly: neI, n: 300, pal: 'masonry', smin: 0.08, smax: 0.62, z: 7 });
  { const c = P(82.2, 55.4); O.push({ t: 'planks', seed: ns(), cx: c[0], cy: c[1], r: 2.6, n: 11, rot: 0.6, spread: 0.9, lmin: 1.4, lmax: 4.2, z: 7 }); }
  const fI = PP(pField);
  O.push({ t: 'rub', seed: ns(), poly: fI, n: 520, pal: 'masonry', smin: 0.07, smax: 0.6 });
  O.push({ t: 'rub', seed: ns(), poly: PP(scale(pField, 1.15)), n: 170, pal: 'stone', smin: 0.07, smax: 0.5, dust: 0 });
  { const c = P(fcx, fcy); O.push({ t: 'boulders', seed: ns(), cx: c[0], cy: c[1], rx: r1(7 * k), ry: r1(6 * k), rot: 0, n: 16, smin: 0.2, smax: 1.1 }); O.push({ t: 'planks', seed: ns(), cx: c[0], cy: c[1], r: 6, n: 18, rot: flow, spread: 1.1, lmin: 1.2, lmax: 4 }); O.push({ t: 'planks', seed: ns(), cx: c[0] + 2 * k, cy: c[1] - k, r: 5, n: 5, rot: flow, spread: 0.3, lmin: 3, lmax: 6.5, wmin: 0.22, wmax: 0.36, log: 1 }); }
  // unstable slope: scree and slump scars
  const slopeOut = [[bB[2] + 0.6, 47], [90, 46], [92, 62], [74, 62], [74, bB[3] + 0.9], [bB[2] + 0.6, bB[3] + 0.9]];
  O.push({ t: 'patch', ch: 1, poly: organic(R, PP(slopeOut), 3 * k, k) });
  for (const v of [[88.2, 57.5, 2.6], [88.8, 50.2, 2.1], [79.5, 60.8, 1.7]]) { const c = P(v[0], v[1]); O.push({ t: 'scar', seed: ns(), cx: c[0], cy: c[1], r: r1(v[2] * k), ang: Math.atan2(0.5, -0.85) + R.gauss() * 0.15 }); }
  O.push({ t: 'rub', seed: ns(), poly: PP(slopeOut), n: 420, pal: 'stone', smin: 0.06, smax: 0.42, dust: 0 });
  { const c = P(88, 54); O.push({ t: 'boulders', seed: ns(), cx: c[0], cy: c[1], rx: r1(3 * k), ry: r1(6 * k), rot: 0, n: 9, smin: 0.2, smax: 0.9 }); }
  // the mud belt: puddles, stranded timber, a few boulders
  const mb = rectOf(pMud);
  for (let i = 0, tries = 0; i < 9 && tries < 300; tries++) {
    const X = R.range(mb[0] + 1, mb[2] - 1), Y = R.range(mb[1] + 1, mb[3] - 1);
    if (X > bC[0] - 1.2 && X < bC[2] + 1.2 && Y > bC[1] - 1.2 && Y < bC[3] + 1.2) continue;
    const c = P(X, Y), rx = R.range(0.6, 2.2) * k;
    O.push({ t: 'puddle', seed: ns(), cx: c[0], cy: c[1], rx: r1(rx), ry: r1(rx * R.range(0.4, 0.7)), rot: R.chance(0.5) ? flow : R() * TAU });
    if (i % 3 === 0) O.push({ t: 'planks', seed: ns(), cx: c[0] + 2 * k, cy: c[1] + k, r: 1.6, n: R.int(4, 9), rot: flow, spread: 0.5, lmin: 1.2, lmax: 4.5, wmin: 0.1, wmax: 0.3 });
    if (i % 4 === 1) O.push({ t: 'boulders', seed: ns(), cx: c[0] - 2 * k, cy: c[1], rx: r1(2 * k), ry: r1(1.4 * k), rot: flow, n: R.int(4, 8), smin: 0.15, smax: 0.7 });
    i++;
  }
  // scattered flood litter everywhere else
  for (let i = 0; i < 16; i++) { const c = P(R.range(2, 118), R.range(2, 88)); O.push({ t: 'rub', seed: ns(), cx: c[0], cy: c[1], rx: r1(R.range(1, 2.6) * k), ry: r1(R.range(0.7, 1.6) * k), rot: R() * TAU, n: R.int(20, 60), pal: R.chance(0.5) ? 'stone' : 'masonry', smin: 0.06, smax: 0.4, dust: 0 }); }
  const keepOff = (X, Y, d) => team.every((t) => Math.hypot(t[0] - X, t[1] - Y) > d) && leads.every((l) => Math.hypot(l.pos[0] - X, l.pos[1] - Y) > d) && Math.hypot(stg[0] - X, stg[1] - Y) > 9 && Math.hypot(dpad[0] - X, dpad[1] - Y) > 4;
  for (let i = 0, tries = 0; i < 9 && tries < 200; tries++) { const X = R.range(3, 117), Y = R.range(3, 87); if (!keepOff(X, Y, 3)) continue; const c = P(X, Y); O.push({ t: 'planks', seed: ns(), cx: c[0], cy: c[1], r: R.range(1, 3), n: R.int(3, 9), rot: flow + R.gauss() * 0.3, spread: 0.7, lmin: 1, lmax: 3.6 }); i++; }
  for (let i = 0, tries = 0; i < 5 && tries < 200; tries++) { const X = R.range(4, 116), Y = R.range(4, 86); if (!keepOff(X, Y, 4) || (X > bA[0] - 3 && X < bA[2] + 3 && Y > bA[1] - 3 && Y < bA[3] + 3) || (X > bB[0] - 3 && X < bB[2] + 3 && Y > bB[1] - 3 && Y < bB[3] + 3)) continue; const c = P(X, Y); O.push({ t: 'boulders', seed: ns(), cx: c[0], cy: c[1], rx: r1(R.range(1.5, 3.5) * k), ry: r1(R.range(1, 2.4) * k), rot: flow, n: R.int(4, 10), smin: 0.15, smax: 0.8 }); i++; }
  for (const l of [lanes[0], lanes[2]]) for (let i = 1; i < l.pts.length - 1; i++) { const c = P(l.pts[i][0] + R.gauss() * 1.5, l.pts[i][1] + R.gauss() * 1.5), rx = R.range(0.6, 1.5) * k; if (keepOff(c[0] / k, 90 - c[1] / k, 2.5)) O.push({ t: 'puddle', seed: ns(), cx: c[0], cy: c[1], rx: r1(rx), ry: r1(rx * 0.5), rot: R() * TAU }); }
  // staging area: pickup, crates, ridge tent, drone pad
  {
    const la = Math.atan2(-6, 7), vc = P(stg[0] + 5.2, stg[1] - 2.6), pk = PICKUPS[0];
    const v = { t: 'vehicle', cx: vc[0], cy: vc[1], rot: r1(la + 0.12), rgb: pk[1], seed: ns() };
    O.push(v);
    sc.distractors.push({ id: 'X1', kind: 'vehicle', name: pk[0], rgb: pk[1], bbox: bbClip(vehicleBox(v, k), W, H) });
    const items = [];
    for (const q of [[-1.6, 2.4, 1.2, 0.8, 0.2, 0, 0.6], [-0.3, 2.9, 1.0, 0.7, -0.3, 1, 0.5], [-1.1, 3.6, 0.8, 0.6, 0.5, 2, 0.45], [0.9, 2.2, 1.2, 0.8, 0.1, 1, 0.7], [-2.6, 1.5, 0.7, 0.5, 0.9, 3, 0.4]]) {
      if (!team.every((t) => Math.hypot(t[0] - stg[0] - q[0], t[1] - stg[1] - q[1]) > 1.3)) continue;
      const c = P(stg[0] + q[0], stg[1] + q[1]); items.push([c[0], c[1], r1(q[2] * k), r1(q[3] * k), q[4], q[5], q[6]]);
    }
    O.push({ t: 'crates', items });
    const tc = P(stg[0] + 5.8, stg[1] + 4.8);
    O.push({ t: 'tent', cx: tc[0], cy: tc[1], l: r1(3.4 * k), w: r1(2.6 * k), rot: -0.42, rgb: [146, 138, 110] });
    const pc = P(dpad[0], dpad[1]);
    O.push({ t: 'pad', cx: pc[0], cy: pc[1], s: r1(2 * k), rot: 0.08 });
  }
  // distractors in the debris field
  const inField = (r, far) => {
    const shr = scale(pField, 0.78);
    for (let t = 0; t < 400; t++) {
      const X = R.range(fc[0], fc[2]), Y = R.range(fc[1], fc[3]);
      if (!inPoly(shr, X, Y) || !leads.every((l) => Math.hypot(l.pos[0] - X, l.pos[1] - Y) > 3.4 + r)) continue;
      const c = P(X, Y);
      if (sc.distractors.some((d) => Math.hypot((d.bbox[0] + d.bbox[2]) / 2 - c[0], (d.bbox[1] + d.bbox[3]) / 2 - c[1]) < far * k)) continue;
      return c;
    }
    return P(fcx, fcy);
  };
  { const c = inField(1.6, 4), o = { t: 'tarp', cx: c[0], cy: c[1], l: r1(3 * k), w: r1(2.3 * k), rot: r1(R() * TAU), rgb: TARPS[0][1], seed: ns() }; O.push(o); sc.distractors.push({ id: 'X2', kind: 'tarp', name: 'blue tarp', rgb: o.rgb, bbox: bbClip(bboxOf(rectPts(o.cx, o.cy, o.l * 1.14, o.w * 1.14, o.rot), 1), W, H) }); }
  { const c = inField(0.4, 3.5), rgb = [232, 112, 28], r = 0.29 * k; O.push({ t: 'barrel', cx: c[0], cy: c[1], rgb }); sc.distractors.push({ id: 'X3', kind: 'barrel', name: 'orange barrel', rgb, bbox: [Math.floor(c[0] - r - 1), Math.floor(c[1] - r - 1), Math.ceil(c[0] + r + 1), Math.ceil(c[1] + r + 1)] }); }
  { const c = inField(0.8, 3.5), o = { t: 'cloth', cx: c[0], cy: c[1], s: 1.3, rot: r1(R() * TAU), rgb: CLOTHS[1][1], seed: ns() }; O.push(o); sc.distractors.push({ id: 'X4', kind: 'cloth', name: CLOTHS[1][0], rgb: o.rgb, bbox: bbClip(bboxOf(clothPts(o, k), 1), W, H) }); }
  // people: one per lead (red jacket, mostly buried), then the rescue team
  leads.forEach((l, i) => {
    const c = P(l.pos[0], l.pos[1]), FR = mk(mix(seed, 400 + i));
    sc.figures.push(mkFigure(FR, k, { id: l.id, x: c[0], y: c[1], angle: Math.round(FR.range(0, TAU) * 1000) / 1000, posture: 'lying', difficulty: 'covered', top: BRIGHT[0], bottom: ['dark trousers', [38, 40, 50]], sun: sv, sl: 0.8, target: 0.4 }));
  });
  team.forEach((t, i) => {
    const c = P(t[0], t[1]), FR = mk(mix(seed, 600 + i));
    sc.figures.push(mkFigure(FR, k, { id: 'T' + (i + 1), x: c[0], y: c[1], angle: Math.round(FR.range(0, TAU) * 1000) / 1000, posture: 'standing', difficulty: 'bright', top: ['hi-vis lime jacket', BRIGHT[6][1]], bottom: BOTTOM_DARK[0], sun: sv, sl: 0.8, helmet: true, team: true }));
  });
  sc.figures.forEach((f, i) => O.push({ t: 'fig', i }));
  return sc;
}
