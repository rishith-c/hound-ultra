// 2-D geometry helpers. Points are [x, y] in metres (x east, y north).
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpPt = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Seeded random numbers, so every run of the simulation is the same.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// True when segment p1-p2 crosses segment p3-p4.
export function segIntersect(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return false;
  const u = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const v = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return u > 1e-9 && u < 1 - 1e-9 && v > 1e-9 && v < 1 - 1e-9;
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const pointInRect = (p, r) => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3];

// Shortest distance from point p to segment a-b.
export function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1);
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function pathLength(path) {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += dist(path[i - 1], path[i]);
  return s;
}

// Point at distance d along a polyline, with the heading (radians, 0 = east, counter-clockwise) of that leg.
export function pointAlong(path, d) {
  for (let i = 1; i < path.length; i++) {
    const l = dist(path[i - 1], path[i]);
    if (d <= l || i === path.length - 1) {
      const t = l === 0 ? 0 : clamp(d / l, 0, 1);
      return { pos: lerpPt(path[i - 1], path[i], t), heading: Math.atan2(path[i][1] - path[i - 1][1], path[i][0] - path[i - 1][0]), leg: i - 1 };
    }
    d -= l;
  }
  return { pos: path[path.length - 1].slice(), heading: 0, leg: path.length - 2 };
}

export const rectCenter = (r) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
export const rectPoly = (r) => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
