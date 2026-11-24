// The whole network as one image: every weight is a pixel. 468 x 84.
//   row A  conv 1: 24 filters (down) x 9 taps of 52 inputs (across)
//   row B  conv 2 and conv 3: 24 filters x 9 taps of 24 channels each
//   row C  dense 32 x 48, then the two heads (2 x 32 each)
import { paint } from './ui.js';
export const MW = 468, MH = 84;
export const TILES = [
  { t: 0, name: 'conv 1', x: 0, y: 0, w: 468, h: 24, cin: 52 }, { t: 2, name: 'conv 2', x: 0, y: 26, w: 216, h: 24, cin: 24 }, { t: 4, name: 'conv 3', x: 222, y: 26, w: 216, h: 24, cin: 24 },
  { t: 6, name: 'dense', x: 0, y: 52, w: 48, h: 32 }, { t: 8, name: 'person head', x: 54, y: 52, w: 32, h: 2 }, { t: 10, name: 'moving head', x: 54, y: 56, w: 32, h: 2 },
];
const BG = [6, 8, 10];
// colorAt(tileIndex 0..5, k) -> [r, g, b], k = index into that tensor in our layout (row * w + col).
export function mosaicPaint(canvas, colorAt) {
  const map = new Int32Array(MW * MH).fill(-1);
  TILES.forEach((tl, ti) => { for (let r = 0; r < tl.h; r++) for (let c = 0; c < tl.w; c++) map[(tl.y + r) * MW + tl.x + c] = ti * 65536 + r * tl.w + c; });
  paint(canvas, MW, MH, (i) => (map[i] < 0 ? BG : colorAt(map[i] >> 16, map[i] & 65535)));
}
// Which weight is under canvas pixel (px, py)? Returns null in the gaps.
export function mosaicHit(px, py) {
  for (let ti = 0; ti < TILES.length; ti++) { const tl = TILES[ti]; if (px >= tl.x && px < tl.x + tl.w && py >= tl.y && py < tl.y + tl.h) { const r = py - tl.y, c = px - tl.x, k = r * tl.w + c;
    let where;
    if (ti < 3) { const j = Math.floor(c / tl.cin), ch = c % tl.cin; where = 'filter ' + (r + 1) + ', tap ' + (j + 1) + ' of 9, ' + (ti === 0 ? (ch === 51 ? 'motion row' : 'subcarrier ' + (ch + 1)) : 'channel ' + (ch + 1)); }
    else if (ti === 3) where = 'hidden unit ' + (r + 1) + ', ' + (c < 24 ? 'mean' : 'peak') + ' of filter ' + (c % 24 + 1);
    else where = (r ? 'yes' : 'no') + ' output, hidden unit ' + (c + 1);
    return { ti, k, name: tl.name, where, motion: ti === 0 && c % 52 === 51 }; } }
  return null;
}
export function mosaicXY(canvas, e) { const r = canvas.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * MW), Math.floor((e.clientY - r.top) / r.height * MH)]; }
