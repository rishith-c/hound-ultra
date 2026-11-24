// Constants and small helpers used by both the page and the analysis worker.
export function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// The synthetic test set. 12 frames, 8 figures each: 2 in bright clothing, 2 in shadow, 2 partly covered, 2 in earth tones.
export const BENCH = { seeds: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112], themes: ['rubble', 'mudflow', 'roofs', 'mixed'], figures: 8, w: 1280, h: 960, pxPerM: 16,
  thrs: [3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 17, 20], topK: 12, outer: 28, guard: 9, minArea: 6 };
// The change-detection test set: 8 before/after pairs with a known camera shift, exposure change and list of changes.
export const CBENCH = { seeds: [201, 202, 203, 204, 205, 206, 207, 208], thrs: [0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 1.0, 1.2], minAreaM2: 1.0 };
// The second flight of a pair: pointed a little differently and exposed differently, as a real repeat flight would be.
export function pairSetup(seed) { const r = mulberry(seed * 7 + 3); return { shift: [Math.round((r() - 0.5) * 44), Math.round((r() - 0.5) * 36)], light: { gain: 0.82 + r() * 0.36, tint: [0.96 + r() * 0.1, 1, 0.94 + r() * 0.1] } }; }

export const DIFFS = [
  { id: 'bright', label: 'Bright clothing', hint: 'Saturated jacket, in the open, in sunlight.' },
  { id: 'shadow', label: 'In shadow', hint: 'Bright clothing inside a building\'s shadow.' },
  { id: 'covered', label: 'Partly covered', hint: 'More than half the body under mud, planks or rubble.' },
  { id: 'muted', label: 'Earth-tone clothing', hint: 'Khaki, grey or brown: close to the colour of the ground.' },
];

// Greedy non-max suppression. Two boxes are the same person when they overlap by half (IoU), or when the
// smaller one lies mostly inside the larger (a body cut by a tile edge).
export function nms(boxes, iou = 0.5, contain = 0.65) {
  const out = [], s = [...boxes].sort((a, b) => b.score - a.score);
  for (const b of s) {
    const ab = (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]); let keep = true;
    for (const k of out) {
      const iw = Math.min(b.box[2], k.box[2]) - Math.max(b.box[0], k.box[0]), ih = Math.min(b.box[3], k.box[3]) - Math.max(b.box[1], k.box[1]);
      if (iw <= 0 || ih <= 0) continue;
      const inter = iw * ih, ak = (k.box[2] - k.box[0]) * (k.box[3] - k.box[1]);
      if (inter / (ab + ak - inter) > iou || inter / Math.min(ab, ak) > contain) { keep = false; break; }
    }
    if (keep) out.push(b);
  }
  return out;
}
// Tiles of size T that cover w by h evenly with at least the given overlap.
export function tileGrid(w, h, T, overlap = 0.2) {
  const axis = (L) => { const t = Math.min(T, L); if (L <= t) return [0]; const n = Math.ceil((L - t * overlap) / (t * (1 - overlap))), step = (L - t) / (n - 1); return Array.from({ length: n }, (_, i) => Math.round(i * step)); };
  const xs = axis(w), ys = axis(h), out = [];
  for (const y of ys) for (const x of xs) out.push({ x, y, w: Math.min(T, w), h: Math.min(T, h) });
  return out;
}
export const iouOf = (a, b) => { const iw = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), ih = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); if (iw <= 0 || ih <= 0) return 0; const i = iw * ih; return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i); };

export function colourName([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510, c = mx - mn, s = mx ? c / mx : 0;
  if (s < 0.16) return l > 0.82 ? 'white' : l < 0.2 ? 'black' : 'grey';
  let hue = c === 0 ? 0 : mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4; hue = (hue * 60 + 360) % 360;
  if (hue < 14 || hue >= 345) return l < 0.3 ? 'dark red' : 'red';
  if (hue < 40) return s < 0.5 || l < 0.36 ? 'brown' : 'orange';
  if (hue < 68) return s < 0.4 ? 'tan' : 'yellow';
  if (hue < 160) return 'green'; if (hue < 200) return 'cyan'; if (hue < 255) return 'blue'; if (hue < 290) return 'purple'; return 'pink';
}
// Eigen-decomposition of a symmetric 3x3 [xx, xy, xz, yy, yz, zz] by Jacobi rotations. Returns values (descending) and vectors.
export function eig3(c) {
  const A = [[c[0], c[1], c[2]], [c[1], c[3], c[4]], [c[2], c[4], c[5]]], V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 12; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(A[p][q]) < 1e-12) continue;
    const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
    for (let k = 0; k < 3; k++) { const a = A[k][p], b = A[k][q]; A[k][p] = cs * a - sn * b; A[k][q] = sn * a + cs * b; }
    for (let k = 0; k < 3; k++) { const a = A[p][k], b = A[q][k]; A[p][k] = cs * a - sn * b; A[q][k] = sn * a + cs * b; }
    for (let k = 0; k < 3; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = cs * a - sn * b; V[k][q] = sn * a + cs * b; }
  }
  const idx = [0, 1, 2].sort((i, j) => A[j][j] - A[i][i]);
  return { values: idx.map((i) => Math.max(1e-9, A[i][i])), vectors: idx.map((i) => [V[0][i], V[1][i], V[2][i]]) };
}
