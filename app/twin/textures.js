// Procedural textures, painted on canvases at start-up. No image files: the whole site is generated from
// world.SEED, so it is the same every time and works offline.
import * as THREE from 'three';
import { rng, makeNoise } from './util.js';

export const TERRAIN_BASE = '#5e574c';           // the colour the site ground fades to at its edge (the hills start from it)
export const GROUND = { x0: -36, y0: -51, size: 192 };   // the square of ground that carries the painted site texture
export const FLOOD_H = 1.15;                      // height of the flood's tide line on the walls, metres

export function cv(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: false })]; }

// Draw a small canvas stretched over W x H so that it repeats seamlessly (the border wraps around).
export function drawTiled(ctx, src, W, H) {
  const n = src.width, m = src.height, [b, bc] = cv(n + 2, m + 2);
  bc.drawImage(src, 1, 1);
  bc.drawImage(src, 0, 0, n, 1, 1, m + 1, n, 1); bc.drawImage(src, 0, m - 1, n, 1, 1, 0, n, 1);
  bc.drawImage(b, 1, 0, 1, m + 2, n + 1, 0, 1, m + 2); bc.drawImage(b, n, 0, 1, m + 2, 0, 0, 1, m + 2);
  const sx = W / n, sy = H / m;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(b, 0.5, 0.5, n + 1, m + 1, -sx / 2, -sy / 2, W + sx, H + sy);
}
// Layered soft noise: random grey cells of several sizes, blended over what is already there.
export function tileNoise(ctx, W, H, r, { cells = [64, 32, 16, 8], alpha = 0.3, mode = 'soft-light', falloff = 0.75, lo = 0, hi = 255 } = {}) {
  ctx.save(); ctx.globalCompositeOperation = mode;
  let a = alpha;
  for (const cell of cells) {
    const n = Math.max(2, Math.round(W / cell)), m = Math.max(2, Math.round(H / cell)), [c, cc] = cv(n, m), id = cc.createImageData(n, m);
    for (let i = 0; i < n * m; i++) { const v = lo + (hi - lo) * r(); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    cc.putImageData(id, 0, 0); ctx.globalAlpha = a; drawTiled(ctx, c, W, H); a *= falloff;
  }
  ctx.restore();
}
// A height canvas (white = high) to a tangent-space normal map.
export function toNormal(src, strength = 2, wrap = true) {
  const W = src.width, H = src.height, d = src.getContext('2d').getImageData(0, 0, W, H).data, [c, cc] = cv(W, H), out = cc.createImageData(W, H), o = out.data;
  const at = (x, y) => { if (wrap) { x = (x + W) % W; y = (y + H) % H; } else { x = x < 0 ? 0 : x >= W ? W - 1 : x; y = y < 0 ? 0 : y >= H ? H - 1 : y; } return d[(y * W + x) * 4]; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) / 255 * strength, dy = (at(x, y + 1) - at(x, y - 1)) / 255 * strength, l = 1 / Math.hypot(dx, dy, 1), i = (y * W + x) * 4;
    o[i] = (-dx * l * 0.5 + 0.5) * 255; o[i + 1] = (dy * l * 0.5 + 0.5) * 255; o[i + 2] = (l * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  cc.putImageData(out, 0, 0);
  return c;
}
export function tex(canvas, { srgb = true, repeat = true, rx = 1, ry = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.repeat.set(rx, ry); t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
const blob = (ctx, x, y, rad, color, a) => { const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = a; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill(); ctx.globalAlpha = 1; };
const hex2 = (h, a) => { const n = parseInt(h.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };
function crack(ctx, x, y, len, r, { w = 1.2, ang = Math.PI / 2, wander = 0.6, branch = 0.25 } = {}) {
  ctx.beginPath(); ctx.moveTo(x, y); let a = ang;
  for (let s = 0; s < len; s += 6) { a += (r() - 0.5) * wander; x += Math.cos(a) * 6; y += Math.sin(a) * 6; ctx.lineTo(x, y); if (r() < branch * 0.1) { ctx.stroke(); crack(ctx, x, y, len * 0.35, r, { w: w * 0.7, ang: a + (r() - 0.5) * 1.6, wander, branch: 0 }); ctx.beginPath(); ctx.moveTo(x, y); } }
  ctx.lineWidth = w; ctx.stroke();
}

export function createTextures(world, maxAniso = 8) {
  const cache = new Map();
  const memo = (k, fn) => { if (!cache.has(k)) cache.set(k, fn()); return cache.get(k); };
  const T = (c, o = {}) => tex(c, { aniso: maxAniso, ...o });

  // ---- ground: a tiling close-up layer (grit, pebbles) ----
  function groundDetail() {
    return memo('groundDetail', () => {
      const S = 512, r = rng('tex:gd'), [hc, h] = cv(S), [ac, a] = cv(S);
      h.fillStyle = '#808080'; h.fillRect(0, 0, S, S); tileNoise(h, S, S, r, { cells: [128, 64, 32, 16, 8, 4], alpha: 0.5, mode: 'source-over', falloff: 0.72 });
      a.fillStyle = '#808080'; a.fillRect(0, 0, S, S); tileNoise(a, S, S, r, { cells: [128, 48, 16, 6, 3, 2], alpha: 0.5, mode: 'source-over', falloff: 0.82 });
      const wrapDraw = (fn) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy); };
      for (let i = 0; i < 420; i++) {            // pebbles and grit
        const x = r() * S, y = r() * S, rad = 1 + r() * r() * 7, sq = 0.6 + r() * 0.4, rot = r() * 3, lum = 150 + r() * 90, alb = 95 + r() * 80;
        wrapDraw((ox, oy) => {
          const g = h.createRadialGradient(x + ox - rad * 0.2, y + oy - rad * 0.2, 0, x + ox, y + oy, rad); g.addColorStop(0, 'rgba(' + lum + ',' + lum + ',' + lum + ',0.95)'); g.addColorStop(1, 'rgba(128,128,128,0)');
          h.fillStyle = g; h.beginPath(); h.ellipse(x + ox, y + oy, rad, rad * sq, rot, 0, 7); h.fill();
          a.fillStyle = 'rgba(' + alb + ',' + alb + ',' + (alb - 4) + ',0.5)'; a.beginPath(); a.ellipse(x + ox, y + oy, rad * 0.8, rad * sq * 0.8, rot, 0, 7); a.fill();
        });
      }
      h.strokeStyle = 'rgba(60,60,60,0.55)';     // drying cracks in the silt
      for (let i = 0; i < 26; i++) { const x = r() * S, y = r() * S, ang = r() * 6.3; wrapDraw((ox, oy) => { const rr = rng('gdc' + i); crack(h, x + ox, y + oy, 40 + rr() * 90, rr, { w: 1.1, ang, wander: 0.9, branch: 2 }); }); }
      return { map: T(ac, { srgb: false }), normalMap: T(toNormal(hc, 3.2), { srgb: false }) };
    });
  }

  // ---- ground: the one-off painting of the whole site (mud, road, ruts, puddles) ----
  function groundMacro() {
    return memo('groundMacro', () => {
      const S = 2048, k = S / GROUND.size, r = rng('tex:gm'), [ac, a] = cv(S), [rc, ro] = cv(S), [kc, kk] = cv(S / 2);
      const B = world.BUILDING.rect;
      a.fillStyle = '#6b655c'; a.fillRect(0, 0, S, S); ro.fillStyle = '#b8b8b8'; ro.fillRect(0, 0, S, S);
      tileNoise(a, S, S, r, { cells: [512, 256, 128, 64], alpha: 0.26, mode: 'soft-light' });
      tileNoise(ro, S, S, r, { cells: [256, 96, 32], alpha: 0.25, mode: 'multiply', lo: 120 });
      const M = (c) => c.setTransform(k, 0, 0, -k, -GROUND.x0 * k, (GROUND.y0 + GROUND.size) * k);   // draw in metres, north up
      M(a); M(ro);
      kk.fillStyle = '#000'; kk.fillRect(0, 0, S / 2, S / 2); kk.setTransform(k / 2, 0, 0, -k / 2, -GROUND.x0 * k / 2, (GROUND.y0 + GROUND.size) * k / 2); kk.lineCap = 'round'; kk.lineJoin = 'round'; kk.globalCompositeOperation = 'lighter'; kk.filter = 'blur(2px)';
      a.lineCap = ro.lineCap = 'round'; a.lineJoin = ro.lineJoin = 'round';
      const path = (c, pts) => { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; c.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); } c.lineTo(pts.at(-1)[0], pts.at(-1)[1]); };
      // silt laid down by the flood, streaked along the flow (from the slope in the north-east towards the river)
      for (let i = 0; i < 1500; i++) {
        const x = GROUND.x0 + r() * GROUND.size, y = GROUND.y0 + r() * GROUND.size, ang = 3.62 + r.gauss() * 0.35, len = 5 + r() * r() * 34, light = r() < 0.55;
        a.strokeStyle = light ? hex2('#8a8172', 0.05 + r() * 0.07) : hex2('#3a332b', 0.05 + r() * 0.08); a.lineWidth = 0.2 + r() * r() * 2.2;
        a.beginPath(); a.moveTo(x, y); a.quadraticCurveTo(x + Math.cos(ang) * len * 0.5 + r.gauss() * 1.5, y + Math.sin(ang) * len * 0.5 + r.gauss() * 1.5, x + Math.cos(ang) * len, y + Math.sin(ang) * len); a.stroke();
      }
      // the landslide tongue that came down onto the north-east corner
      for (let i = 0; i < 520; i++) { const t = r(), cx = 83 + t * 70 + r.gauss() * (3 + t * 9), cy = 56 + t * 64 + r.gauss() * (3 + t * 11); blob(a, cx, cy, 1.2 + r() * 4.5, r() < 0.5 ? '#54483b' : '#716555', 0.16); }
      // the road along the south edge
      const road = [[-40, 4.6], [-6, 5.4], [26, 6.6], [58, 5.6], [92, 6.2], [126, 8.4], [160, 12.5]];
      a.strokeStyle = '#4a4b4d'; a.lineWidth = 6.6; path(a, road); a.stroke();
      a.strokeStyle = hex2('#3c3d40', 0.6); a.lineWidth = 5.4; path(a, road); a.stroke();
      ro.strokeStyle = '#9c9c9c'; ro.lineWidth = 6.4; path(ro, road); ro.stroke();
      // gravel yard in front of block B, the path to its entrance, the staging hardstand, a lane between A and B
      kk.strokeStyle = '#f00'; kk.lineWidth = 6.4; path(kk, road); kk.stroke();
      const gravel = (pts, w, al = 0.5) => { kk.strokeStyle = 'rgba(0,255,0,' + al * 1.3 + ')'; kk.lineWidth = w * 0.9; path(kk, pts); kk.stroke(); a.strokeStyle = hex2('#7d776c', al); a.lineWidth = w; path(a, pts); a.stroke(); };
      gravel([[42, 25.6], [64, 25.2], [87, 25.8]], 8.5, 0.5); gravel([[63.6, 7], [64.4, 16], [64, 27]], 4.2, 0.5); gravel([[16, 13.2], [24, 13.8], [33, 13]], 11, 0.5);
      gravel([[38.6, 9], [38.2, 30], [39, 52], [38, 76], [40, 100]], 4.2, 0.36); gravel([[30, 9.5], [44, 18], [58, 24]], 3.2, 0.3);
      // mud thrown back over the road and the gravel
      for (let i = 0; i < 900; i++) { const t = r() * 200 - 40, y = 5 + (t > 90 ? (t - 90) * 0.08 : 0) + r.gauss() * 3.4; blob(a, t, y, 0.5 + r() * 2.6, r() < 0.6 ? '#665d50' : '#4a4238', 0.3); }
      for (let i = 0; i < 500; i++) blob(a, 36 + r() * 56, 20 + r() * 12, 0.5 + r() * 2.4, '#625a4e', 0.22);
      // deep mud around building C
      for (let i = 0; i < 420; i++) { const x = 86 + r() * 32, y = 14 + r() * 38; blob(a, x, y, 1.5 + r() * 5, '#453e35', 0.12); blob(ro, x, y, 1.5 + r() * 5, '#4a4a4a', 0.26); }
      // tyre ruts: the road, the turn-in to staging, the track to the entrance
      const ruts = (pts, gauge = 1.7, wob = 0.25, al = 0.5) => {
        for (const side of [-1, 1]) {
          const off = pts.map((p, i) => { const q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)], dx = q[0] - o[0], dy = q[1] - o[1], l = Math.hypot(dx, dy) || 1; return [p[0] - dy / l * side * gauge / 2 + r.gauss() * wob, p[1] + dx / l * side * gauge / 2 + r.gauss() * wob]; });
          a.strokeStyle = hex2('#2c2722', al); a.lineWidth = 0.34; path(a, off); a.stroke();
          a.strokeStyle = hex2('#847b6c', al * 0.5); a.lineWidth = 0.12; path(a, off.map((p) => [p[0] + 0.27, p[1] + 0.2])); a.stroke();
          ro.strokeStyle = 'rgba(40,40,40,' + al * 0.9 + ')'; ro.lineWidth = 0.3; path(ro, off); ro.stroke();
        }
      };
      ruts(road.map((p) => [p[0], p[1] + 1.4]), 1.7, 0.2, 0.5); ruts(road.map((p) => [p[0], p[1] - 1.5]), 1.7, 0.25, 0.42);
      ruts([[2, 6.6], [12, 8.2], [19, 11.6], [27, 13.2], [34, 11.4], [44, 7.2]], 1.7, 0.2, 0.55);
      ruts([[30, 12.6], [42, 17.5], [55, 22.6], [63.4, 26.6]], 1.5, 0.2, 0.34); ruts([[63.9, 6.8], [64.5, 16], [64, 26]], 1.6, 0.2, 0.3);
      ruts([[38.4, 8], [38.2, 30], [39, 52], [38.2, 74]], 1.6, 0.3, 0.3);
      // puddles: standing water where the ground is low
      const inB = (x, y) => x > B[0] - 0.6 && x < B[2] + 0.6 && y > B[1] - 0.6 && y < B[3] + 0.6;
      const puddle = (x, y, s) => {
        const n = 2 + Math.floor(r() * 4);
        for (let j = 0; j < n; j++) {
          const px = x + r.gauss() * s * 0.7, py = y + r.gauss() * s * 0.5, rx = s * (0.5 + r() * 0.7), ry = rx * (0.45 + r() * 0.4), rot = r() * 3;
          if (inB(px, py)) continue;
          for (const [c, col, al, grow] of [[a, '#3d3830', 0.6, 2.1], [a, '#24262a', 0.9, 1.25], [ro, '#4a4a4a', 0.85, 2.0], [ro, '#000000', 1, 1.3]]) { c.save(); c.translate(px, py); c.rotate(rot); c.scale(1, ry / rx); blob(c, 0, 0, rx * grow, col, al); c.restore(); }
        }
      };
      const spots = [[58, 23.5, 1.6], [69, 21, 1.2], [47, 24, 1.3], [80, 26, 1.1], [64.5, 13, 1.0], [31, 16, 1.4], [14, 9.6, 1.5], [22, 22, 1.2], [39, 36, 1.4], [38, 60, 1.6], [40, 20, 1.1], [88, 40, 1.8], [90.5, 30, 1.5], [100, 14, 1.9], [114, 30, 2.2], [88, 58, 1.3], [96, 52, 1.6], [58, 63, 1.8], [72, 66, 1.4], [46, 66, 1.5], [26, 76, 1.8], [6, 30, 1.6], [3, 6.6, 1.3], [50, 7, 1.0], [84, 6.4, 1.2], [110, 9, 1.4], [70, 13, 1.3], [104, 58, 1.7]];
      for (const [x, y, s] of spots) puddle(x, y, s);
      for (let i = 0; i < 46; i++) puddle(GROUND.x0 + 10 + r() * (GROUND.size - 20), GROUND.y0 + 10 + r() * (GROUND.size - 20), 0.6 + r() * 1.6);
      // darker, damp ground hugging the buildings
      for (const o of world.OBSTACLES.filter((q) => q.kind === 'building').concat([{ poly: [[B[0], B[1]], [B[2], B[1]], [B[2], B[3]], [B[0], B[3]]] }])) {
        a.strokeStyle = hex2('#2f2a25', 0.2); for (const w of [5, 3, 1.4]) { a.lineWidth = w; a.beginPath(); o.poly.forEach((p, i) => (i ? a.lineTo(p[0], p[1]) : a.moveTo(p[0], p[1]))); a.closePath(); a.stroke(); }
      }
      a.setTransform(1, 0, 0, 1, 0, 0); ro.setTransform(1, 0, 0, 1, 0, 0);
      tileNoise(a, S, S, r, { cells: [24, 10, 4], alpha: 0.2, mode: 'soft-light' });
      // fade to the plain colour the hills start from
      const edge = 0.085 * S; a.fillStyle = TERRAIN_BASE; ro.fillStyle = '#d0d0d0';
      for (const c of [a, ro]) for (const [x0, y0, x1, y1, rect] of [[0, 0, edge, 0, [0, 0, edge, S]], [S, 0, S - edge, 0, [S - edge, 0, edge, S]], [0, 0, 0, edge, [0, 0, S, edge]], [0, S, 0, S - edge, [0, S - edge, S, edge]]]) {
        const g = c.createLinearGradient(x0, y0, x1, y1), col = c === a ? TERRAIN_BASE : '#d0d0d0'; g.addColorStop(0, col); g.addColorStop(0.25, col); g.addColorStop(1, hex2(col, 0)); c.fillStyle = g; c.fillRect(...rect);
      }
      return { mask: T(kc, { srgb: false, repeat: false }), map: T(ac, { repeat: false, aniso: 16 }), roughnessMap: T(rc, { srgb: false, repeat: false, aniso: 16 }) };
    });
  }

  // ---- walls ----
  // 8 m wide by 4 m tall; the flood's tide line sits at FLOOD_H. variant: 'outer' plaster, 'inner' two-tone classroom paint.
  function wall(variant = 'outer') {
    return memo('wall:' + variant, () => {
      const W = 2048, H = 1024, pm = W / 8, r = rng('tex:wall:' + variant), [ac, a] = cv(W, H), [hc, h] = cv(W, H);
      const Y = (m) => H - m * pm;
      a.fillStyle = variant === 'outer' ? '#b9b2a5' : '#c9c5b8'; a.fillRect(0, 0, W, H); h.fillStyle = '#808080'; h.fillRect(0, 0, W, H);
      if (variant === 'inner') { a.fillStyle = '#6f8087'; a.fillRect(0, Y(1.28), W, H); a.fillStyle = '#4d5a60'; a.fillRect(0, Y(1.3), W, 5); }
      else { a.fillStyle = '#8a7466'; a.fillRect(0, Y(0.75), W, H); a.fillStyle = '#6d5a4f'; a.fillRect(0, Y(0.77), W, 4); }
      tileNoise(a, W, H, r, { cells: [256, 128, 48, 16], alpha: 0.34, mode: 'soft-light' });
      tileNoise(h, W, H, r, { cells: [64, 24, 8, 3], alpha: 0.2, mode: 'source-over', falloff: 0.8 });
      for (let i = 0; i < (variant === 'outer' ? 90 : 36); i++) {     // rain and leak streaks from the top
        const x = r() * W, len = (0.25 + r() * r() * 1.9) * pm, w = 3 + r() * 16, y0 = Y(3.2) + r() * 6, g = a.createLinearGradient(0, y0, 0, y0 + len);
        g.addColorStop(0, 'rgba(52,48,42,' + (0.1 + r() * 0.22) + ')'); g.addColorStop(1, 'rgba(52,48,42,0)'); a.fillStyle = g; a.fillRect(x, y0, w, len);
      }
      if (variant === 'outer') for (let i = 0; i < 5; i++) {         // plaster lost, brick showing
        const cx = r() * W, cy = Y(0.5 + r() * 2.2), rad = 30 + r() * 70; a.save(); a.beginPath();
        for (let j = 0; j <= 14; j++) { const an = j / 14 * 6.283, rr = rad * (0.6 + r() * 0.6); j ? a.lineTo(cx + Math.cos(an) * rr * 1.3, cy + Math.sin(an) * rr) : a.moveTo(cx + Math.cos(an) * rr * 1.3, cy + Math.sin(an) * rr); }
        a.closePath(); a.clip(); a.fillStyle = '#7a5646'; a.fillRect(cx - 200, cy - 200, 400, 400); a.strokeStyle = 'rgba(190,180,165,0.7)'; a.lineWidth = 2;
        for (let y = cy - 200, row = 0; y < cy + 200; y += 19, row++) { a.beginPath(); a.moveTo(cx - 200, y); a.lineTo(cx + 200, y); a.stroke(); for (let x = cx - 200 + (row % 2) * 29; x < cx + 200; x += 58) { a.beginPath(); a.moveTo(x, y); a.lineTo(x, y + 19); a.stroke(); } }
        a.restore(); h.save(); h.globalAlpha = 0.6; h.fillStyle = '#585858'; h.beginPath(); h.ellipse(cx, cy, rad * 1.2, rad * 0.9, 0, 0, 7); h.fill(); h.restore();
      }
      // the flood: silt film below the tide line, older lines beneath it, splashes above
      const fy = Y(FLOOD_H), g = a.createLinearGradient(0, fy, 0, H); g.addColorStop(0, 'rgba(104,90,72,0.5)'); g.addColorStop(0.5, 'rgba(96,83,66,0.68)'); g.addColorStop(1, 'rgba(70,60,48,0.9)');
      a.fillStyle = g; a.beginPath(); a.moveTo(0, H);
      const wave = (x) => Math.sin(x / W * 6.283 * 3) * 5 + Math.sin(x / W * 6.283 * 11 + 1) * 2.5;
      for (let x = 0; x <= W; x += 8) a.lineTo(x, fy + wave(x)); a.lineTo(W, H); a.closePath(); a.fill();
      for (const [m, al, lw] of [[FLOOD_H, 0.62, 5], [FLOOD_H - 0.17, 0.3, 3], [FLOOD_H - 0.42, 0.22, 3], [FLOOD_H - 0.74, 0.18, 2]]) { a.strokeStyle = 'rgba(58,48,38,' + al + ')'; a.lineWidth = lw; a.beginPath(); for (let x = 0; x <= W; x += 8) { const y = Y(m) + wave(x + m * 300) * (m === FLOOD_H ? 1 : 0.6); x ? a.lineTo(x, y) : a.moveTo(x, y); } a.stroke(); }
      for (let i = 0; i < 700; i++) { const x = r() * W, up = r() * r() * 0.7 * pm; a.fillStyle = 'rgba(84,72,58,' + (0.12 + r() * 0.3) + ')'; a.beginPath(); a.ellipse(x, fy - up, 1 + r() * 4, 1 + r() * 6, 0, 0, 7); a.fill(); }
      for (let i = 0; i < 80; i++) { const x = r() * W, len = 20 + r() * 120, gg = a.createLinearGradient(0, fy, 0, fy + len); gg.addColorStop(0, 'rgba(60,50,40,0.4)'); gg.addColorStop(1, 'rgba(60,50,40,0)'); a.fillStyle = gg; a.fillRect(x, fy, 2 + r() * 5, len); }
      const gb = a.createLinearGradient(0, Y(0.22), 0, H); gb.addColorStop(0, 'rgba(40,34,28,0)'); gb.addColorStop(1, 'rgba(40,34,28,0.75)'); a.fillStyle = gb; a.fillRect(0, Y(0.22), W, H);
      a.strokeStyle = 'rgba(40,36,32,0.55)'; h.strokeStyle = 'rgba(20,20,20,0.9)';
      for (let i = 0; i < (variant === 'outer' ? 14 : 9); i++) { const x = r() * W, y = Y(r() * 3.2), len = 80 + r() * 320, ang = Math.PI / 2 + r.gauss() * 0.7, s = Math.floor(r() * 1e6); crack(a, x, y, len, rng('wc' + s), { w: 1.3, ang }); crack(h, x, y, len, rng('wc' + s), { w: 2.4, ang }); }
      return { map: T(ac), normalMap: T(toNormal(hc, 2.2), { srgb: false }) };
    });
  }

  function floor() {
    return memo('floor', () => {
      const S = 1024, r = rng('tex:floor'), n = makeNoise('floor'), [ac, a] = cv(S), [hc, h] = cv(S), [rc, ro] = cv(S), cell = S / 8;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const v = 132 + r() * 22; a.fillStyle = 'rgb(' + v + ',' + (v - 3) + ',' + (v - 9) + ')'; a.fillRect(i * cell, j * cell, cell, cell); }
      tileNoise(a, S, S, r, { cells: [128, 32, 8, 3], alpha: 0.3, mode: 'soft-light' });
      h.fillStyle = '#909090'; h.fillRect(0, 0, S, S); a.strokeStyle = 'rgba(48,44,40,0.8)'; h.strokeStyle = '#303030'; a.lineWidth = 3; h.lineWidth = 4;
      for (let i = 0; i <= 8; i++) for (const c of [a, h]) { c.beginPath(); c.moveTo(i * cell, 0); c.lineTo(i * cell, S); c.moveTo(0, i * cell); c.lineTo(S, i * cell); c.stroke(); }
      // silt left on the floor and the damp patches still drying: one seamless field decides both
      const N = 256, f = new Float32Array(N * N), per = (x, y) => { const u = x / N, v = y / N, F = (p, q) => n.fbm(p / 40, q / 40, 4); return F(x, y) * (1 - u) * (1 - v) + F(x - N, y) * u * (1 - v) + F(x - N, y - N) * u * v + F(x, y - N) * (1 - u) * v; };
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) f[y * N + x] = per(x, y);
      const [mc, m] = cv(N), md = m.createImageData(N, N), [wc, w] = cv(N), wd = w.createImageData(N, N);
      for (let i = 0; i < N * N; i++) {
        const silt = Math.min(1, Math.max(0, (f[i] - 0.42) * 5)), wet = Math.min(1, Math.max(0, (0.44 - f[i]) * 7));
        md.data[i * 4] = 104; md.data[i * 4 + 1] = 92; md.data[i * 4 + 2] = 76; md.data[i * 4 + 3] = silt * 215;
        const rv = 205 - wet * 185 + silt * 30; wd.data[i * 4] = wd.data[i * 4 + 1] = wd.data[i * 4 + 2] = Math.min(255, rv); wd.data[i * 4 + 3] = 255;
      }
      m.putImageData(md, 0, 0); w.putImageData(wd, 0, 0); drawTiled(a, mc, S, S); drawTiled(ro, wc, S, S);
      h.globalAlpha = 0.5; drawTiled(h, mc, S, S); h.globalAlpha = 1; tileNoise(h, S, S, r, { cells: [16, 6, 3], alpha: 0.16, mode: 'source-over' });
      return { map: T(ac), normalMap: T(toNormal(hc, 1.6), { srgb: false }), roughnessMap: T(rc, { srgb: false }) };
    });
  }

  function concrete() {
    return memo('concrete', () => {
      const S = 1024, r = rng('tex:conc'), [ac, a] = cv(S), [hc, h] = cv(S);
      a.fillStyle = '#928f88'; a.fillRect(0, 0, S, S); tileNoise(a, S, S, r, { cells: [256, 96, 32, 12, 4], alpha: 0.4, mode: 'soft-light' });
      h.fillStyle = '#808080'; h.fillRect(0, 0, S, S); tileNoise(h, S, S, r, { cells: [48, 16, 6, 3], alpha: 0.3, mode: 'source-over', falloff: 0.8 });
      for (let i = 0; i < 1400; i++) { const x = r() * S, y = r() * S, rad = 0.6 + r() * r() * 3; a.fillStyle = 'rgba(40,40,40,' + (0.15 + r() * 0.3) + ')'; a.beginPath(); a.arc(x, y, rad, 0, 7); a.fill(); h.fillStyle = 'rgba(40,40,40,0.8)'; h.beginPath(); h.arc(x, y, rad, 0, 7); h.fill(); }
      for (let i = 0; i < 40; i++) blob(a, r() * S, r() * S, 30 + r() * 110, r() < 0.5 ? '#5b564d' : '#a8a59c', 0.2);
      a.strokeStyle = 'rgba(30,30,30,0.5)'; h.strokeStyle = 'rgba(20,20,20,0.9)';
      for (let i = 0; i < 9; i++) { const x = r() * S, y = r() * S, s = Math.floor(r() * 1e6), ang = r() * 6.3; crack(a, x, y, 200 + r() * 300, rng('cc' + s), { w: 1.2, ang, branch: 1.5 }); crack(h, x, y, 200 + r() * 300, rng('cc' + s), { w: 2.2, ang, branch: 1.5 }); }
      return { map: T(ac), normalMap: T(toNormal(hc, 2.4), { srgb: false }) };
    });
  }

  // Corrugated iron: 0.912 m (12 ridges of 76 mm) by 2.4 m, ridges along v. Dull zinc, rust runs from the nail rows and the laps.
  function cgi() {
    return memo('cgi', () => {
      const stain = (q, x, y, s, c, k) => { const g = q.createRadialGradient(x, y, 0, x, y, s); g.addColorStop(0, hex2(c, k)); g.addColorStop(0.6, hex2(c, k * 0.5)); g.addColorStop(1, hex2(c, 0)); q.fillStyle = g; q.fillRect(x - s, y - s, s * 2, s * 2); };
      const W = 512, H = 1024, r = rng('tex:cgi'), [ac, a] = cv(W, H), [hc, h] = cv(W, H), [mc, m] = cv(W, H), id = h.createImageData(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = 128 + 110 * Math.sin(x / W * 6.28319 * 12), i = (y * W + x) * 4; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
      h.putImageData(id, 0, 0);
      a.fillStyle = '#78726a'; a.fillRect(0, 0, W, H); m.fillStyle = 'rgb(0,158,78)'; m.fillRect(0, 0, W, H);      // green: roughness, blue: metalness
      tileNoise(a, W, H, r, { cells: [128, 32, 8, 3], alpha: 0.35, mode: 'soft-light' });
      for (let i = 0; i < 60; i++) stain(a, r() * W, r() * H, 12 + r() * 46, r() < 0.5 ? '#86827b' : '#625d56', 0.3);
      const rust = (x, y, w, len, k) => { const g = a.createLinearGradient(0, y, 0, y + len), q = m.createLinearGradient(0, y, 0, y + len); for (let s = 0; s <= 1; s += 0.25) { g.addColorStop(s, 'rgba(' + (92 + r() * 24 | 0) + ',' + (56 + r() * 12 | 0) + ',36,' + (k * (1 - s)) + ')'); q.addColorStop(s, 'rgba(0,238,0,' + (k * (1 - s)) + ')'); } a.fillStyle = g; a.fillRect(x - w / 2, y, w, len); m.fillStyle = q; m.fillRect(x - w / 2, y, w, len); };
      for (const row of [60, 400, 740]) for (let i = 0; i < 12; i++) { if (r() < 0.6) continue; const x = (i + 0.25) / 12 * W + r.gauss() * 2, y = row + r.gauss() * 4; rust(x, y, 6 + r() * r() * 46, 60 + r() * 300, 0.3 + r() * 0.5); a.fillStyle = '#2c211a'; a.beginPath(); a.arc(x, y, 3, 0, 7); a.fill(); }
      for (let i = 0; i < 70; i++) rust(r() * W, r() * H, 3 + r() * r() * 70, 40 + r() * 300, 0.1 + r() * 0.35);
      for (let i = 0; i < 46; i++) { const x = r() * W, y = r() * H, s = 10 + r() * r() * 80; const c = r() < 0.6 ? '#5f3d2b' : '#744c33'; stain(a, x, y, s, c, 0.5); stain(m, x, y, s, '#00f000', 0.6); }
      for (let i = 0; i < 900; i++) { a.fillStyle = r() < 0.7 ? 'rgba(84,50,32,0.4)' : 'rgba(150,150,146,0.25)'; a.fillRect(r() * W, r() * H, 1 + r() * 2.5, 1 + r() * 4); }
      a.fillStyle = 'rgba(30,24,20,0.7)'; a.fillRect(0, 0, 3, H); for (let i = 0; i < 24; i++) rust(r() * 14, r() * H, 10, 60 + r() * 160, 0.5);
      for (let i = 0; i < 14; i++) { stain(h, r() * W, r() * H, 14 + r() * 40, r() < 0.6 ? '#404040' : '#c0c0c0', 0.3); }
      return { map: T(ac), normalMap: T(toNormal(hc, 3.2), { srgb: false }), roughnessMap: T(mc, { srgb: false }) };
    });
  }

  function wood() {
    return memo('wood', () => {
      const S = 512, r = rng('tex:wood'), [ac, a] = cv(S), [hc, h] = cv(S);
      a.fillStyle = '#75654f'; a.fillRect(0, 0, S, S); h.fillStyle = '#808080'; h.fillRect(0, 0, S, S);
      for (let i = 0; i < 420; i++) { const y = r() * S, v = 60 + r() * 90; a.strokeStyle = 'rgba(' + v + ',' + (v - 14) + ',' + (v - 34) + ',0.35)'; a.lineWidth = 0.6 + r() * 2.4; const p = new Path2D(); p.moveTo(0, y); p.bezierCurveTo(S * 0.3, y + r.gauss() * 5, S * 0.7, y + r.gauss() * 5, S, y); a.stroke(p); const hv = 60 + r() * 130; h.strokeStyle = 'rgba(' + hv + ',' + hv + ',' + hv + ',0.3)'; h.lineWidth = a.lineWidth; h.stroke(p); }
      tileNoise(a, S, S, r, { cells: [128, 32], alpha: 0.3, mode: 'soft-light' }); tileNoise(h, S, S, r, { cells: [64, 4], alpha: 0.3, mode: 'source-over' });
      for (let i = 0; i < 4; i++) { a.fillStyle = 'rgba(30,24,18,0.7)'; a.fillRect(0, i * S / 4, S, 3); h.fillStyle = '#202020'; h.fillRect(0, i * S / 4, S, 4); }
      return { map: T(ac), normalMap: T(toNormal(hc, 2), { srgb: false }) };
    });
  }

  function fabric() {
    return memo('fabric', () => {
      const S = 256, r = rng('tex:fab'), [ac, a] = cv(S), [hc, h] = cv(S);
      a.fillStyle = '#c8c8c4'; a.fillRect(0, 0, S, S); h.fillStyle = '#808080'; h.fillRect(0, 0, S, S);
      for (let i = 0; i < S; i += 4) { h.fillStyle = 'rgba(200,200,200,0.5)'; h.fillRect(i, 0, 2, S); h.fillStyle = 'rgba(60,60,60,0.4)'; h.fillRect(0, i, S, 2); }
      tileNoise(a, S, S, r, { cells: [64, 16, 4], alpha: 0.3, mode: 'soft-light' });
      for (let i = 0; i < 14; i++) blob(a, r() * S, r() * S, 10 + r() * 40, '#6f6455', 0.22);
      return { map: T(ac), normalMap: T(toNormal(hc, 1.2), { srgb: false }) };
    });
  }

  // A classroom board, 2:1, wiped but never clean, with the flood line across its lower edge.
  function board() {
    return memo('board', () => {
      const W = 512, H = 256, r = rng('tex:board'), [ac, a] = cv(W, H);
      a.fillStyle = '#27332f'; a.fillRect(0, 0, W, H); tileNoise(a, W, H, r, { cells: [128, 32, 8], alpha: 0.4, mode: 'soft-light' });
      a.lineCap = 'round';
      for (let i = 0; i < 46; i++) { a.strokeStyle = 'rgba(214,220,214,' + (0.03 + r() * 0.06) + ')'; a.lineWidth = 8 + r() * 26; const x = r() * W, y = r() * H * 0.8; a.beginPath(); a.moveTo(x, y); a.quadraticCurveTo(x + 60 + r() * 60, y + r.gauss() * 26, x + 120 + r() * 120, y + r.gauss() * 18); a.stroke(); }
      for (let row = 0; row < 4; row++) for (let x = 30; x < W - 60; x += 12 + r() * 30) { if (r() < 0.25) { x += 30; continue; } a.strokeStyle = 'rgba(226,230,222,' + (0.1 + r() * 0.16) + ')'; a.lineWidth = 1.6; a.beginPath(); const y = 46 + row * 36; a.moveTo(x, y + r.gauss() * 3); for (let s = 0; s < 3; s++) a.lineTo(x + (s + 1) * 4, y + r.gauss() * 7); a.stroke(); }
      const g = a.createLinearGradient(0, H * 0.72, 0, H); g.addColorStop(0, 'rgba(98,84,66,0)'); g.addColorStop(0.2, 'rgba(98,84,66,0.75)'); g.addColorStop(1, 'rgba(78,66,52,0.92)'); a.fillStyle = g; a.fillRect(0, H * 0.72, W, H);
      return { map: T(ac, { repeat: false }) };
    });
  }

  // Short painted text for a sign. Returns a texture with the canvas's aspect in userData.aspect.
  function sign(text, { fg = '#e8e6df', bg = '#2d3a44', w = 512, h = 128, font = '600 64px -apple-system, "Helvetica Neue", Arial, sans-serif', sub = '' } = {}) {
    return memo('sign:' + text + sub + bg, () => {
      const r = rng('tex:sign' + text), [c, a] = cv(w, h);
      a.fillStyle = bg; a.fillRect(0, 0, w, h); a.strokeStyle = fg; a.globalAlpha = 0.5; a.lineWidth = 3; a.strokeRect(7, 7, w - 14, h - 14); a.globalAlpha = 1;
      a.fillStyle = fg; a.font = font; a.textAlign = 'center'; a.textBaseline = 'middle'; a.fillText(text, w / 2, sub ? h * 0.42 : h / 2 + 2);
      if (sub) { a.font = '500 24px -apple-system, "Helvetica Neue", Arial, sans-serif'; a.globalAlpha = 0.8; a.fillText(sub, w / 2, h * 0.78); a.globalAlpha = 1; }
      tileNoise(a, w, h, r, { cells: [64, 16, 4], alpha: 0.35, mode: 'soft-light' });
      const g = a.createLinearGradient(0, h * 0.5, 0, h); g.addColorStop(0, 'rgba(90,78,62,0)'); g.addColorStop(1, 'rgba(90,78,62,0.55)'); a.fillStyle = g; a.fillRect(0, 0, w, h);
      const t = T(c, { repeat: false }); t.userData.aspect = w / h; return t;
    });
  }

  return { groundDetail, groundMacro, wall, floor, concrete, cgi, wood, fabric, board, sign, dispose() { for (const v of cache.values()) { if (v.isTexture) v.dispose(); else for (const t of Object.values(v)) t?.dispose?.(); } cache.clear(); } };
}
