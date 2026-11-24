// Shared by the two listening exhibits: how a tap travels through the pile, and how its wavefront is drawn.
import { WORLD, MAT, PROPS, eikonal } from './model.js';
import * as L from './lib.js';

// Slowness (seconds per metre) of every cell. Loose rubble gets faster where it is packed tighter (assumed).
export function slowness(pile) {
  const out = new Float32Array(WORLD.nx * WORLD.nz);
  for (let q = 0; q < out.length; q++) { const m = pile.mat[q]; let v = PROPS[m].vp; if (m === MAT.RUBBLE) v *= Math.pow(pile.rho[q] / 1.7, 1.5); out[q] = 1 / v; }
  return out;
}
export const travel = (slow, x, z) => eikonal(slow, x, z);
// Where the survivor taps: the floor slab beside their hand.
export const tapPoint = (pile) => ({ x: pile.person.span[0] + 0.55, z: -0.08 });
// A knock: a short decaying burst near fc hertz, starting at t = 0.
export const knock = (t, fc = 260) => (t < 0 ? 0 : Math.sin(2 * Math.PI * fc * t) * Math.exp(-t * fc * 0.9));

// The expanding wavefront, from true first-arrival times.
const P = { cv: null, im: null };
export function drawFront(S, T, t, { width = 0.0009, color = '--accent' } = {}) {
  const { nx, nz, x0, z0, z1 } = WORLD;
  if (!P.cv) { P.cv = document.createElement('canvas'); P.cv.width = nx; P.cv.height = nz; P.im = P.cv.getContext('2d').createImageData(nx, nz); }
  const px = P.im.data, [r, g, b] = L.rgbOf(color), mat = S.pile.mat;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const q = k * nx + i, o = ((nz - 1 - k) * nx + i) * 4; if (mat[q] === MAT.SKY) { px[o + 3] = 0; continue; }
    const d = t - T[q], a = d < -2 * width ? 0 : d < 0 ? 1 - d * d / (4 * width * width) : Math.exp(-d / (width * 3)); px[o] = r + (255 - r) * a * 0.6; px[o + 1] = g + (255 - g) * a * 0.6; px[o + 2] = b + (255 - b) * a * 0.6; px[o + 3] = 190 * a;
  }
  P.cv.getContext('2d').putImageData(P.im, 0, 0);
  S.c.save(); S.c.imageSmoothingEnabled = true; S.c.imageSmoothingQuality = 'high'; S.c.drawImage(P.cv, S.X(x0), S.Z(z1), 24 * S.s, (z1 - z0) * S.s); S.c.restore();
}
// Probability of the source position, painted as a soft field. p: Float32Array on a (cr, cnx, cnz) grid, max 1.
export function drawField(S, cv, p, cr, cnx, cnz, alpha = 0.85) {
  const c = S.c; c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.globalAlpha = alpha; c.drawImage(cv, S.X(WORLD.x0), S.Z(WORLD.z0 + cnz * cr), cnx * cr * S.s, cnz * cr * S.s); c.restore();
}
export function cross(S, x, z, color, label, o = {}) {
  const { c } = S, px = S.X(x), py = S.Z(z), r = S.thumb ? 4 : 8; c.save(); c.strokeStyle = L.tok(color); c.lineWidth = S.thumb ? 1 : 1.5; c.beginPath(); c.moveTo(px - r, py); c.lineTo(px - 3, py); c.moveTo(px + 3, py); c.lineTo(px + r, py); c.moveTo(px, py - r); c.lineTo(px, py - 3); c.moveTo(px, py + 3); c.lineTo(px, py + r); c.stroke(); c.restore();
  if (label && !S.thumb) L.tagLabel(c, px, py, label, { color, ...o });
}
// One-sigma ellipse axes from a 2x2 covariance [a b; b c].
export function ellipse(S, x, z, cov, k, color) {
  const [a, b, d] = cov, m = (a + d) / 2, q = Math.sqrt(((a - d) / 2) ** 2 + b * b), l1 = Math.sqrt(Math.max(0, m + q)), l2 = Math.sqrt(Math.max(0, m - q)), th = 0.5 * Math.atan2(2 * b, a - d);
  const { c } = S; c.save(); c.translate(S.X(x), S.Z(z)); c.rotate(-th); c.beginPath(); c.ellipse(0, 0, Math.max(2, k * l1 * S.s), Math.max(2, k * l2 * S.s), 0, 0, 6.2832); c.fillStyle = L.col(color, 0.1); c.fill(); c.strokeStyle = L.col(color, 0.9); c.lineWidth = 1.25; c.stroke(); c.restore();
  return [l1, l2];
}
