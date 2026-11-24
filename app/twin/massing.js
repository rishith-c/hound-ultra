// The two neighbouring blocks. Building A stands: a two-storey concrete-frame school block with an open gallery,
// an outside stair and a working roof. Building C took the flood and the slide: its north-east bays have pancaked.
// Everything is merged by material or instanced: about a dozen draw calls for both buildings.
import * as THREE from 'three';
import { box, cyl, worldUV, merge, mesh, instanced, tint, rng, tube, xform, matrix, rock, slab, makeNoise, smooth, lerp } from './util.js';
import { cv, tileNoise, toNormal, tex as mkTex, FLOOD_H } from './textures.js';

const D = Math.PI / 180, DARK = 0x0d0f11, WT = 0.24;

// ---- textures painted here: clean upper-storey plaster (rain streaks, no flood line), brick, and a decal sheet ----
function paintUpper(S, aniso) {
  const W = S, H = S / 2, pm = W / 8, k = S / 2048, r = rng('tex:massing-upper'), [nc, n] = cv(W, H), [hc, h] = cv(W, H);
  const Y = (m) => (7.2 - m) * pm;                                    // painted with 7.2 m at the top row and 3.2 m at the bottom
  n.fillStyle = '#b9b2a5'; n.fillRect(0, 0, W, H); h.fillStyle = '#808080'; h.fillRect(0, 0, W, H);
  tileNoise(n, W, H, r, { cells: [256 * k, 128 * k, 48 * k, 16 * k], alpha: 0.34, mode: 'soft-light' });
  tileNoise(h, W, H, r, { cells: [64 * k, 24 * k, 8 * k, 3], alpha: 0.2, mode: 'source-over', falloff: 0.8 });
  for (const top of [7.12, 6.2]) { const g = n.createLinearGradient(0, Y(top), 0, Y(top - 0.45)); g.addColorStop(0, 'rgba(52,48,42,0.3)'); g.addColorStop(1, 'rgba(52,48,42,0)'); n.fillStyle = g; n.fillRect(0, Y(top), W, 0.45 * pm); }
  for (let i = 0; i < 130; i++) {                                     // rain streaks from the parapet cap and the roof-slab drip
    const x = r() * W, top = r() < 0.6 ? 7.1 : 6.2, len = (0.3 + r() * r() * 2.6) * pm, w = (3 + r() * 16) * k, y0 = Y(top) + r() * 6, g = n.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, 'rgba(52,48,42,' + (0.1 + r() * 0.24) + ')'); g.addColorStop(1, 'rgba(52,48,42,0)'); n.fillStyle = g; n.fillRect(x, y0, w, len);
  }
  for (let i = 0; i < 9; i++) { const cx = r() * W, cy = Y(3.6 + r() * 2.6), rad = (60 + r() * 120) * k, g = n.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, 'rgba(70,74,66,0.16)'); g.addColorStop(1, 'rgba(70,74,66,0)'); n.fillStyle = g; n.fillRect(cx - rad, cy - rad, rad * 2, rad * 2); }
  const gb = n.createLinearGradient(0, Y(3.75), 0, Y(3.2)); gb.addColorStop(0, 'rgba(60,54,46,0)'); gb.addColorStop(1, 'rgba(60,54,46,0.22)'); n.fillStyle = gb; n.fillRect(0, Y(3.75), W, 0.55 * pm);
  n.strokeStyle = 'rgba(40,36,32,0.5)'; h.strokeStyle = 'rgba(20,20,20,0.9)';
  for (let i = 0; i < 12; i++) {                                      // hairline cracks
    let x = r() * W, y = Y(3.4 + r() * 3.4), a = Math.PI / 2 + r.gauss() * 0.7; const len = (80 + r() * 300) * k, pts = [[x, y]];
    for (let s = 0; s < len; s += 6) { a += (r() - 0.5) * 0.6; x += Math.cos(a) * 6; y += Math.sin(a) * 6; pts.push([x, y]); }
    for (const [c, lw] of [[n, 1.3 * k + 0.3], [h, 2.4 * k + 0.4]]) { c.lineWidth = lw; c.beginPath(); pts.forEach((p, j) => (j ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke(); }
  }
  const wrap = (src) => { const [c, x] = cv(W, H); x.drawImage(src, 0, 0.2 * H); x.drawImage(src, 0, 0.2 * H - H); return c; };   // so that v = height / 4 lands on the right row
  return { map: mkTex(wrap(nc), { aniso }), normalMap: mkTex(toNormal(wrap(hc), 2.2), { srgb: false, aniso }) };
}
function paintBrick(aniso) {
  const W = 512, H = 256, r = rng('tex:massing-brick'), [ac, a] = cv(W, H), [hc, h] = cv(W, H), bw = W / 5, bh = H / 8;
  a.fillStyle = '#958c7f'; a.fillRect(0, 0, W, H); h.fillStyle = '#5a5a5a'; h.fillRect(0, 0, W, H);
  for (let row = 0; row < 8; row++) for (let i = -1; i < 5; i++) {
    const x = i * bw + (row % 2) * bw / 2 + 2, y = row * bh + 2, rr = rng('brick' + row + ':' + ((i + 5) % 5)), v = rr(), cr = 112 + v * 26, cg = 82 + v * 14, cb = 68 + v * 10, hv = 150 + rr() * 60;
    a.fillStyle = 'rgb(' + cr + ',' + cg + ',' + cb + ')'; a.fillRect(x, y, bw - 4, bh - 4); h.fillStyle = 'rgb(' + hv + ',' + hv + ',' + hv + ')'; h.fillRect(x, y, bw - 4, bh - 4);
  }
  tileNoise(a, W, H, r, { cells: [128, 32, 8, 3], alpha: 0.4, mode: 'soft-light' }); tileNoise(h, W, H, r, { cells: [16, 6, 3], alpha: 0.22, mode: 'source-over' });
  a.fillStyle = 'rgba(96,84,68,0.22)'; a.fillRect(0, 0, W, H);
  return { map: mkTex(ac, { aniso }), normalMap: mkTex(toNormal(hc, 2.6), { srgb: false, aniso }) };
}
function paintDecals(aniso) {                                           // four 256 px cells: drip streaks, a damp stain, a diagonal crack, a stepped crack
  const C = 256, [c, a] = cv(C * 4, C), r = rng('tex:massing-decal');
  for (const cell of [0, 1]) for (let i = 0; i < (cell ? 46 : 16); i++) {
    const edge = !cell && i < 8, x = cell * C + (edge ? (i % 2 ? 18 : C - 30) + r.gauss() * 10 : 14 + r() * (C - 40)), len = (cell ? 40 + r() * r() * 190 : 90 + r() * 150), w = cell ? 6 + r() * 26 : 3 + r() * 9, g = a.createLinearGradient(0, 2, 0, len);
    g.addColorStop(0, 'rgba(46,42,36,' + (cell ? 0.1 + r() * 0.16 : 0.2 + r() * 0.3) + ')'); g.addColorStop(1, 'rgba(46,42,36,0)'); a.fillStyle = g; a.fillRect(x, 2, w, len);
  }
  a.lineCap = a.lineJoin = 'round';
  const stroke = (pts) => { for (const [col, lw] of [['rgba(88,78,66,0.3)', 10], ['rgba(40,35,30,0.55)', 4.5], ['rgba(16,14,12,0.95)', 2]]) { a.strokeStyle = col; a.lineWidth = lw; a.beginPath(); pts.forEach((p, j) => (j ? a.lineTo(p[0], p[1]) : a.moveTo(p[0], p[1]))); a.stroke(); } };
  let pts = [], x = C * 2 + 22, y = 18;
  while (y < C - 22) { pts.push([x, y]); const s = 7 + r() * 10; x += s * (0.75 + r.gauss() * 0.5); y += s * (1.05 + r.gauss() * 0.45); if (r() < 0.16) { const b = [[x, y]]; let bx = x, by = y; for (let j = 0; j < 5; j++) { bx += 9 * (r() < 0.5 ? 1.2 : -0.3) + r.gauss() * 4; by += 6 + r() * 6; b.push([Math.min(C * 3 - 8, Math.max(C * 2 + 8, bx)), Math.min(C - 8, by)]); } stroke(b); } x = Math.min(C * 3 - 16, Math.max(C * 2 + 16, x)); }
  stroke(pts);
  pts = []; x = C * 3 + 30; y = 16;
  while (y < C - 20 && x < C * 4 - 20) { pts.push([x, y]); if (r() < 0.75) { y += 17 + (r() < 0.2 ? 17 : 0); pts.push([x + r.gauss() * 1.5, y]); } x += 14 + r() * 16; }
  stroke(pts);
  return mkTex(c, { aniso, repeat: false });
}

export function build(env) {
  const { mats, quality, label, renderer } = env, hi = quality !== 'low', aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const group = new THREE.Group(); group.name = 'massing';
  const N = makeNoise('massing');
  const G = { plA: [], plC: [], up: [], conc: [], paint: [], glass: [], rebar: [], mud: [], cgi: [], brick: [], brickRaw: [], decal: [] }, wins = [], rocks = [];
  const V = (x, y, h) => new THREE.Vector3(x, h, -y);
  const rect = (x0, y0, x1, y1, h0, h1) => new THREE.BoxGeometry(x1 - x0, h1 - h0, y1 - y0).translate((x0 + x1) / 2, (h0 + h1) / 2, -(y0 + y1) / 2);
  // a wall piece running along x (at world y = c) or along y (at world x = c)
  const along = (axis, c, p0, p1, y0, y1, thick) => (axis === 'x' ? new THREE.BoxGeometry(p1 - p0, y1 - y0, thick).translate((p0 + p1) / 2, (y0 + y1) / 2, -c) : new THREE.BoxGeometry(thick, y1 - y0, p1 - p0).translate(c, (y0 + y1) / 2, -(p0 + p1) / 2));
  // things placed on a wall face: built facing +z around the origin, then turned to face out of the wall
  const RY = (axis, o) => (axis === 'x' ? (o < 0 ? 0 : Math.PI) : (o > 0 ? Math.PI / 2 : -Math.PI / 2));
  const WP = (axis, face, o, p, d = 0) => (axis === 'x' ? [p, face + o * d] : [face + o * d, p]);
  const onWall = (g, axis, face, o, p, h, d = 0, rz = 0, rx = 0) => { const [x, y] = WP(axis, face, o, p, d); return xform(g, x, h, -y, RY(axis, o), rx, rz); };
  const wallM = (axis, face, o, p, h, d = 0, rz = 0, rx = 0) => { const [x, y] = WP(axis, face, o, p, d); return matrix(x, h, -y, RY(axis, o), rx, rz); };
  const col = (g, c, j = 0, R = null) => tint(g, c, j, R);

  // one storey of a wall with openings cut out. opens: [{ p, w, s0, s1 }]
  function facade(axis, face, o, p0, p1, y0, y1, list, opens = [], c = null, thick = WT) {
    const cc = face - o * thick / 2; let at = p0;
    const put = (a, b, h0, h1) => { if (b - a > 0.01 && h1 - h0 > 0.01) { const g = along(axis, cc, a, b, h0, h1, thick); if (c !== null) tint(g, c); list.push(g); } };
    for (const w of [...opens].sort((a, b) => a.p - b.p)) { const a = w.p - w.w / 2, b = w.p + w.w / 2; put(at, a, y0, y1); put(a, b, y0, w.s0); put(a, b, w.s1, y1); at = b; }
    put(at, p1, y0, y1);
  }
  const band = (axis, face, o, p0, p1, y0, y1, proud = 0.05) => G.conc.push(along(axis, face + o * (proud - 0.05), p0, p1, y0, y1, 0.1));
  function decal(cell, axis, face, o, p, h, w, hg, { flip = false, rz = 0, d = 0.012 } = {}) {
    const g = new THREE.PlaneGeometry(w, hg), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) { const u = flip ? 1 - uv.getX(i) : uv.getX(i); uv.setX(i, (cell + 0.02 + 0.96 * u) / 4); }
    G.decal.push(onWall(g, axis, face, o, p, h, d, rz));
  }

  // ---- window unit: frame, mullion, transom and a welded grille. One instanced mesh for both buildings. ----
  const WW = 1.8, WH = 1.3;
  const unit = (() => {
    const parts = [], FC = 0xd0d6d4, BC = 0x6c7376, f = 0.055, b = (w, h, d, x, y, z, c) => parts.push(tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c));
    b(f, WH, 0.07, -WW / 2 + f / 2, WH / 2, 0, FC); b(f, WH, 0.07, WW / 2 - f / 2, WH / 2, 0, FC); b(WW, f, 0.07, 0, f / 2, 0, FC); b(WW, f, 0.07, 0, WH - f / 2, 0, FC);
    b(0.045, WH, 0.06, 0, WH / 2, 0, FC); b(WW, 0.04, 0.06, 0, WH * 0.72, 0, FC);
    const nb = 11; for (let i = 1; i < nb; i++) b(0.014, WH - 0.08, 0.014, -WW / 2 + (WW * i) / nb, WH / 2, 0.05, BC);
    for (const y of [0.3, WH - 0.3]) b(WW - 0.06, 0.022, 0.012, 0, y, 0.06, BC);
    return merge(parts, { keepUV: false });
  })();
  // a window: sill, sunshade, the unit (or its absence), surviving glass, a drip stain under the sill
  function addWindow(R, axis, face, o, p, sill, { c = 0x5f7274, state = 'ok', glazed = 0.6, shade = true, streak = 0.7 } = {}) {
    G.conc.push(onWall(new THREE.BoxGeometry(WW + 0.24, 0.07, 0.2).translate(0, -0.035, 0.04), axis, face, o, p, sill));
    if (shade) G.conc.push(onWall(new THREE.BoxGeometry(WW + 0.5, 0.07, 0.5).translate(0, 0.035, 0.19), axis, face, o, p, sill + WH + 0.1));
    const tone = new THREE.Color(c).multiplyScalar(0.85 + R() * 0.3);
    if (state === 'ok') {
      wins.push({ m: wallM(axis, face, o, p, sill, -0.09), c: tone });
      for (const s of [-1, 1]) { if (R() > glazed) continue; const full = R() < 0.6, hh = full ? WH - 0.12 : 0.25 + R() * 0.5; G.glass.push(onWall(new THREE.BoxGeometry(WW / 2 - 0.09, hh, 0.008).translate(s * (WW / 4 - 0.005), 0.06 + hh / 2, 0), axis, face, o, p, sill, -0.1)); }
    } else if (state === 'hang') wins.push({ m: wallM(axis, face, o, p + R.sign() * (0.15 + R() * 0.3), sill - 0.2 - R() * 0.5, 0.1, R.sign() * (0.2 + R() * 0.45), 0.12 + R() * 0.2), c: tone });
    if (R() < streak) decal(R() < 0.5 ? 0 : 1, axis, face, o, p + R.gauss() * 0.05, sill - 0.07 - 0.55, WW + 0.3, 1.1, { flip: R() < 0.5 });
  }
  function railing(axis, c, p0, p1, base, tone = 0x3b4446) {
    const P = G.paint, step = hi ? 0.14 : 0.3, n = Math.max(1, Math.round((p1 - p0) / step));
    P.push(col(along(axis, c, p0, p1, base + 0.98, base + 1.02, 0.05), tone), col(along(axis, c, p0, p1, base + 0.1, base + 0.13, 0.03), tone));
    for (let i = 0; i <= n; i++) { const p = p0 + ((p1 - p0) * i) / n, post = i % 10 === 0 || i === n; P.push(col(along(axis, c, p - (post ? 0.02 : 0.007), p + (post ? 0.02 : 0.007), base, base + 1.0, post ? 0.04 : 0.014), tone)); }
  }
  // a door leaf hinged at the wall: clean above the tide line, silted below it
  function leaf(x, y, base, w, h, ry, c, { rx = 0, rz = 0, flood = true } = {}) {
    const cut = flood ? Math.max(0, Math.min(h, FLOOD_H - base)) : 0, mudc = new THREE.Color(c).lerp(new THREE.Color(0x6a5c4b), 0.72).getHex();
    if (cut > 0.02) G.paint.push(col(xform(new THREE.BoxGeometry(w, cut, 0.042).translate(w / 2, cut / 2, 0), x, base, -y, ry, rx, rz), mudc));
    G.paint.push(col(xform(new THREE.BoxGeometry(w, h - cut, 0.04).translate(w / 2, cut + (h - cut) / 2, 0), x, base, -y, ry, rx, rz), c));
    G.paint.push(col(xform(new THREE.BoxGeometry(w - 0.24, h * 0.34, 0.05).translate(w / 2, h * 0.7, 0), x, base, -y, ry, rx, rz), new THREE.Color(c).multiplyScalar(0.86).getHex()));
  }
  function doorFrame(axis, face, o, p, base, w, h, c = 0x3c4547) {
    for (const s of [-1, 1]) G.paint.push(col(onWall(new THREE.BoxGeometry(0.07, h, WT + 0.03).translate(s * (w / 2 - 0.035), h / 2, -WT / 2), axis, face, o, p, base), c));
    G.paint.push(col(onWall(new THREE.BoxGeometry(w, 0.07, WT + 0.03).translate(0, h - 0.035, -WT / 2), axis, face, o, p, base), c));
  }
  function tank(s, c = 0x1c1f22) {
    const a = [tint(cyl(0.6 * s, 0.62 * s, 1.25 * s, 0, 0, 0, 18), c), tint(cyl(0.2 * s, 0.56 * s, 0.22 * s, 0, 1.25 * s, 0, 18), c), tint(cyl(0.13 * s, 0.13 * s, 0.07, 0, 1.47 * s, 0, 10), 0x26292d)];
    for (const k of [0.35, 0.7, 1.05]) a.push(tint(new THREE.TorusGeometry(0.615 * s, 0.022, 5, 20).rotateX(Math.PI / 2).translate(0, k * s, 0), c));
    return a;
  }
  // reinforcing bars torn out of concrete: they leave along dir (three.js space) and droop
  function bars(R, o, dir, n, spread, len = 1, rad = 0.011) {
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let i = 0; i < n; i++) {
      const s = o.clone().addScaledVector(side, (i / Math.max(1, n - 1) - 0.5) * spread + R.gauss() * 0.04), L = len * (0.5 + R()), j = () => R.gauss() * 0.16 * L;
      const p = (t, drop) => s.clone().addScaledVector(dir, L * t).add(new THREE.Vector3(t > 0.3 ? j() : 0, -drop, t > 0.3 ? j() : 0));
      G.rebar.push(tube([p(-0.15, 0), p(0.4, 0.03 * L), p(0.8, (0.15 + R() * 0.4) * L), p(1, (0.4 + R() * 0.7) * L)], rad, { radial: 4, segs: 6 }));
    }
  }
  // a bank of silt against a wall face, running from p0 to p1
  function bank(axis, face, o, p0, p1, hF, wF, base = 0) {
    const n = Math.max(2, Math.round(Math.abs(p1 - p0) / 0.5)), K = 6, pos = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const p = lerp(p0, p1, i / n), e = smooth(0, 0.1, i / n) * smooth(1, 0.9, i / n), hh = hF(p) * (0.2 + 0.8 * e) * (0.75 + 0.5 * N(p * 0.37 + face, 3.1)), ww = wF(p) * (0.45 + 0.55 * e) * (0.7 + 0.6 * N(p * 0.23 + 9, face));
      for (let k = 0; k < K; k++) { const t = k / (K - 1), d = -0.08 + t * ww + (k ? (N(p * 0.9, k * 3.1 + face) - 0.5) * 0.3 * t : 0), y = k === K - 1 ? -0.04 : hh * Math.pow(1 - t, 1.45) * (0.85 + 0.3 * N(p * 1.3 + k, 5.5)), [X, Yw] = WP(axis, face, o, p, d); pos.push(X, base + y, -Yw); }
    }
    for (let i = 0; i < n; i++) for (let k = 0; k < K - 1; k++) { const a = i * K + k, b = a + K; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    if (g.attributes.normal.getY(K + 2) < 0) { g.setIndex(idx.map((v, i) => idx[i - (i % 3) + [0, 2, 1][i % 3]])); g.computeVertexNormals(); }
    G.mud.push(worldUV(g, 0.35));
  }

  // =====================================================================================================================
  // Building A: standing. Rooms x 8..31.6, an open gallery x 31.6..34 on both floors, stair on the south end.
  // =====================================================================================================================
  {
    const R = rng('massing-a'), X0 = 8, Y0 = 40, X1 = 34, Y1 = 70, XE = 31.6, FL = 0.15, S1 = 3.0, U0 = 3.2, U1 = 6.4, TOP = 6.6, PAR = 7.1, CA = 0xd9d4cc, CA2 = 0xcbc6bd;
    const GS = 1.05, US = U0 + 1.0;                                    // sill heights
    // west, north and south walls
    const westP = [...Array(8)].map((_, i) => Y0 + 3.75 * (i + 0.5)), nsP = [12.4, 19.8, 27.2], southG = [12.4, 18.6], southU = [12.4, 18.6, 24.6];
    const op = (list, s) => list.map((p) => ({ p, w: WW, s0: s, s1: s + WH }));
    facade('y', X0, -1, Y0, Y1, 0, S1, G.plA, op(westP, GS)); facade('y', X0, -1, Y0, Y1, U0, U1, G.up, op(westP, US), CA);
    facade('x', Y1, 1, X0, XE, 0, S1, G.plA, op(nsP, GS)); facade('x', Y1, 1, X0, XE, U0, U1, G.up, op(nsP, US), CA);
    facade('x', Y0, -1, X0, XE, 0, S1, G.plA, op(southG, GS)); facade('x', Y0, -1, X0, XE, U0, U1, G.up, op(southU, US), CA);
    for (const p of westP) { addWindow(R, 'y', X0, -1, p, GS, { glazed: 0.45 }); addWindow(R, 'y', X0, -1, p, US, { glazed: 0.85 }); }
    for (const p of nsP) { addWindow(R, 'x', Y1, 1, p, GS, { glazed: 0.2 }); addWindow(R, 'x', Y1, 1, p, US, { glazed: 0.85 }); }
    for (const p of southG) addWindow(R, 'x', Y0, -1, p, GS, { glazed: 0.5 });
    for (const p of southU) addWindow(R, 'x', Y0, -1, p, US, { glazed: 0.85 });
    // east wall of the rooms, behind the gallery: a door and a window for each of four rooms on each floor
    const eastG = [], eastU = [], DOORC = [0x55676a, 0x5d6a5c, 0x55676a, 0x64605a];
    for (let k = 0; k < 4; k++) {
      const y0 = Y0 + 7.5 * k, dp = y0 + 1.7, wp = y0 + 5.2;
      eastG.push({ p: dp, w: 1.0, s0: FL, s1: FL + 2.1 }, { p: wp, w: WW, s0: GS + 0.1, s1: GS + 0.1 + WH }); eastU.push({ p: dp, w: 1.0, s0: U0, s1: U0 + 2.1 }, { p: wp, w: WW, s0: US, s1: US + WH });
      addWindow(R, 'y', XE, 1, wp, GS + 0.1, { shade: false, glazed: 0.15, streak: 0 }); addWindow(R, 'y', XE, 1, wp, US, { shade: false, glazed: 0.8, streak: 0 });
      doorFrame('y', XE, 1, dp, FL, 1.0, 2.1); doorFrame('y', XE, 1, dp, U0, 1.0, 2.1);
      // ground-floor doors were pushed open by the water and hang where it left them; upstairs they are shut
      if (k === 2) leaf(XE + 1.25, dp + 0.7, FL + 0.05, 0.9, 2.02, 0.5, DOORC[k], { rx: -Math.PI / 2 + 0.05 });                                 // torn off, lying on the gallery floor
      else leaf(XE - 0.03, dp - 0.46, FL + 0.02, 0.92, 2.04, Math.PI / 2 - [1.9, 1.15, 0, 2.6][k], DOORC[k], { rz: k === 1 ? 0.035 : 0 });
      leaf(XE - 0.1, dp - 0.46, U0 + 0.01, 0.92, 2.05, Math.PI / 2 - (k === 3 ? 0.5 : 0), DOORC[(k + 1) % 4], { flood: false });
    }
    facade('y', XE, 1, Y0, Y1, 0, S1, G.plA, eastG); facade('y', XE, 1, Y0, Y1, U0, U1, G.up, eastU, CA2);
    // dark interiors behind the openings; the ground floor is set back so the open doors show a silted floor
    G.paint.push(col(rect(X0 + 0.3, Y0 + 0.3, XE - 1.5, Y1 - 0.3, FL, S1), DARK), col(rect(X0 + 0.3, Y0 + 0.3, XE - 0.3, Y1 - 0.3, U0, U1), DARK));
    for (let k = 1; k < 4; k++) G.paint.push(col(rect(XE - 1.5, Y0 + 7.5 * k - 0.07, XE - 0.2, Y0 + 7.5 * k + 0.07, FL, S1), 0x4a4f50));
    G.mud.push(rect(X0 + 0.25, Y0 + 0.25, XE - 0.2, Y1 - 0.25, FL, FL + 0.035), rect(XE, Y0, X1, Y1, FL, FL + 0.02));
    // floors, plinth, frame lines
    G.conc.push(rect(X0 - 0.06, Y0 - 0.06, X1, Y1 + 0.06, 0, FL), rect(X0 - 0.04, Y0 - 0.04, X1 + 0.04, Y1 + 0.04, S1, U0), rect(X0 - 0.22, Y0 - 0.22, X1 + 0.22, Y1 + 0.22, U1, TOP));
    G.conc.push(rect(X1, Y0 + 3, X1 + 0.32, Y1 - 3, 0, 0.07));
    for (const [axis, face, o, a, b] of [['y', X0, -1, Y0, Y1], ['x', Y1, 1, X0, X1], ['x', Y0, -1, X0, X1]]) { band(axis, face, o, a, b, 0, 0.32, 0.06); band(axis, face, o, a, b, S1 - 0.28, U0 + 0.03, 0.045); band(axis, face, o, a, b, U1 - 0.3, U1, 0.045); }
    const pil = (axis, face, o, p) => { G.plA.push(along(axis, face + o * 0.01, p - 0.18, p + 0.18, 0.32, S1 - 0.28, 0.1)); G.up.push(col(along(axis, face + o * 0.01, p - 0.18, p + 0.18, U0 + 0.03, U1 - 0.3, 0.1), CA2)); };
    for (let i = 0; i <= 8; i++) pil('y', X0, -1, Math.min(Y1 - 0.18, Math.max(Y0 + 0.18, Y0 + 3.75 * i)));
    for (const x of [X0 + 0.18, 15.95, 23.75, XE - 0.18]) { pil('x', Y1, 1, x); pil('x', Y0, -1, x); }
    // gallery: columns, edge beams, railing
    for (let i = 0; i <= 8; i++) {
      const y = Math.min(Y1 - 0.2, Math.max(Y0 + 0.2, Y0 + 3.75 * i));
      G.plA.push(rect(X1 - 0.36, y - 0.15, X1 - 0.06, y + 0.15, FL, S1)); G.up.push(col(rect(X1 - 0.36, y - 0.15, X1 - 0.06, y + 0.15, U0, U1), CA2));
    }
    G.conc.push(rect(X1 - 0.3, Y0, X1 - 0.02, Y1, S1 - 0.3, S1), rect(X1 - 0.3, Y0, X1 - 0.02, Y1, U1 - 0.3, U1));
    G.plA.push(rect(XE, Y1 - 0.2, X1 - 0.3, Y1, FL, S1)); G.up.push(col(rect(XE, Y1 - 0.2, X1 - 0.3, Y1, U0, U0 + 1.0), CA2));          // the gallery is closed at its north end
    railing('y', X1 - 0.04, Y0 + 0.02, Y1 - 0.2, U0);
    // roof: parapet with a cap, column stubs with starter bars left for a storey that was never built
    for (const [axis, c, a, b] of [['x', Y0 - 0.12, X0 - 0.2, X1 + 0.2], ['x', Y1 + 0.12, X0 - 0.2, X1 + 0.2], ['y', X0 - 0.12, Y0 - 0.2, Y1 + 0.2], ['y', X1 + 0.12, Y0 - 0.2, Y1 + 0.2]]) { G.up.push(col(along(axis, c, a, b, TOP, PAR, 0.15), CA)); G.conc.push(along(axis, c, a - 0.03, b + 0.03, PAR, PAR + 0.05, 0.22)); }
    for (const x of [X0 + 0.1, X1 - 0.1]) for (const y of [Y0 + 0.1, 47.5, 55, 62.5, Y1 - 0.1]) {
      const hh = 0.35 + R() * 0.3; G.conc.push(rect(x - 0.16, y - 0.16, x + 0.16, y + 0.16, TOP, PAR + hh));
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const L = 0.5 + R() * 0.5; G.rebar.push(xform(new THREE.CylinderGeometry(0.009, 0.009, L, 4).translate(0, L / 2, 0), x + dx * 0.1, PAR + hh - 0.02, -(y + dy * 0.1), 0, R.gauss() * 0.14, R.gauss() * 0.14)); }
    }
    // two water tanks on a stand, their pipes, a solar water heater
    G.conc.push(rect(10.0, 62.6, 13.9, 64.6, TOP + 0.55, TOP + 0.67)); for (const x of [10.2, 13.7]) for (const y of [62.8, 64.4]) G.conc.push(rect(x - 0.1, y - 0.1, x + 0.1, y + 0.1, TOP, TOP + 0.55));
    for (const [x, s] of [[11.0, 1], [12.85, 0.84]]) for (const g of tank(s)) G.paint.push(xform(g, x, TOP + 0.67, -63.6));
    G.paint.push(col(tube([V(11.6, 63.5, TOP + 0.85), V(13.2, 62.3, TOP + 0.1), V(17, 61.2, TOP + 0.06), V(19.4, 62.6, TOP + 0.06), V(19.9, 63.2, TOP + 0.5)], 0.028), 0x565b5e), col(tube([V(12.9, 64.1, TOP + 0.8), V(12.2, 65.6, TOP + 0.07), V(9.2, 67.5, TOP + 0.07), V(8.3, 69.6, TOP + 0.07)], 0.028), 0x565b5e));
    {
      const sx = 21.4, sy = 63.2, tl = 42 * D, P = G.paint, T = (g) => xform(g, sx, TOP + 0.16, -sy, 0, tl, 0);                           // collector leans to the south
      P.push(col(T(new THREE.BoxGeometry(2.0, 0.07, 1.5).translate(0, 0.035, -0.75)), 0x7d8386));
      for (let i = 0; i < 12; i++) P.push(col(T(new THREE.BoxGeometry(0.05, 0.05, 1.36).translate(-0.86 + i * 0.156, 0.095, -0.75)), 0x14181c));
      const ty = TOP + 0.16 + 1.5 * Math.sin(tl) + 0.12, tyw = sy + 1.5 * Math.cos(tl) + 0.05;
      P.push(col(new THREE.CylinderGeometry(0.21, 0.21, 2.15, 14).rotateZ(Math.PI / 2).translate(sx, ty, -tyw), 0xa3a8aa), col(new THREE.CylinderGeometry(0.215, 0.215, 0.05, 14).rotateZ(Math.PI / 2).translate(sx - 1.06, ty, -tyw), 0x5c6164), col(new THREE.CylinderGeometry(0.215, 0.215, 0.05, 14).rotateZ(Math.PI / 2).translate(sx + 1.06, ty, -tyw), 0x5c6164));
      for (const dx of [-0.9, 0.9]) P.push(col(box(0.04, ty - TOP - 0.2, 0.04, sx + dx, TOP, -tyw), 0x5c6164), col(box(0.04, 0.16, 0.04, sx + dx, TOP, -(sy + 0.03)), 0x5c6164), col(xform(new THREE.BoxGeometry(0.03, 0.03, 1.5).translate(0, 0, -0.75), sx + dx, TOP + 0.1, -sy, 0, tl * 0.42, 0), 0x5c6164));
    }
    // loose roofing sheets, weighted with bricks; one has slid against the parapet
    for (let i = 0; i < 6; i++) {
      const lean = i === 5, x = lean ? 33.3 : 24.2 + i * 0.78 + R.gauss() * 0.1, y = lean ? 50.6 : 46.6 + R.gauss() * 0.25, ry = lean ? Math.PI / 2 : R.gauss() * 0.09, L = 2.3 + R() * 0.5;
      G.cgi.push(xform(new THREE.PlaneGeometry(0.92, L).rotateX(-Math.PI / 2), x, TOP + (lean ? 0.36 : 0.025 + i * 0.012), -y, ry, lean ? -0.3 : R.gauss() * 0.012, lean ? 0 : 0.012));
      if (!lean) for (let b = 0; b < 2; b++) G.paint.push(col(box(0.22, 0.07, 0.105, x + R.gauss() * 0.2, TOP + 0.05 + i * 0.012, -(y + (b ? 0.8 : -0.75) + R.gauss() * 0.15), R() * 3), 0x76594b, 0.12, R));
    }
    for (let i = 0; i < 7; i++) G.paint.push(col(box(0.22, 0.07, 0.105, 29.4 + (i % 3) * 0.24 + R.gauss() * 0.01, TOP + Math.floor(i / 3) * 0.07, -(47.2 + R.gauss() * 0.01), 0.1 + R.gauss() * 0.04), 0x76594b, 0.12, R));   // spare bricks, stacked
    // downpipes with brackets; the south-west one lost its foot to the water
    for (const [axis, face, o, p, cut] of [['y', X0, -1, 47.0, 0], ['y', X0, -1, 62.0, 0], ['x', Y1, 1, 23.2, 0.35], ['x', Y0, -1, 9.1, 1.5]]) {
      const [x, y] = WP(axis, face, o, p, 0.13), lo = cut || 0.12; G.paint.push(col(cyl(0.05, 0.05, TOP - 0.1 - lo, x, lo, -y, 8), 0x595e60));
      for (let h = 0.9; h < 6.2; h += 1.75) if (h > lo) G.paint.push(col(onWall(new THREE.BoxGeometry(0.16, 0.035, 0.2).translate(0, 0, 0.08), axis, face, o, p, h), 0x3b4042));
      if (cut > 1) G.paint.push(col(xform(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 8).rotateZ(Math.PI / 2), 9.6, 0.06, -39.25, 0.5), 0x595e60));
    }
    // sign plate by the stair: slate board, pale border, text reduced to bars
    { const P = G.paint, at = (g, c) => P.push(col(onWall(g, 'x', Y0, -1, 22.6, 1.75), c)); at(new THREE.BoxGeometry(2.3, 0.8, 0.03).translate(0, 0.4, 0.015), 0x9a9c97); at(new THREE.BoxGeometry(2.2, 0.7, 0.012).translate(0, 0.4, 0.034), 0x2f3a41); at(new THREE.BoxGeometry(1.5, 0.11, 0.008).translate(0, 0.52, 0.042), 0xb4b3aa); at(new THREE.BoxGeometry(1.0, 0.055, 0.008).translate(0, 0.3, 0.042), 0x8d8f89); }
    // outside stair on the south wall: 19 treads up to a landing that meets the gallery
    {
      const sx = 26.58, yc = 39.3, wd = 1.3, ang = Math.atan2(0.16, 0.28), L = Math.hypot(5.32, 3.04) + 0.4;
      for (let i = 0; i < 19; i++) G.conc.push(box(0.3, 0.16, wd, sx + 0.28 * i + 0.15, 0.16 * i, -yc));
      G.conc.push(xform(new THREE.BoxGeometry(L, 0.16, wd).translate(0, -0.085, 0), sx + 2.66 + 0.12, 1.52, -yc, 0, 0, ang), rect(31.9, 38.6, X1, Y0, S1, U0), rect(29.3, 38.75, 29.55, 39.85, 0, 1.38));
      for (const x of [32.05, X1 - 0.21]) G.plA.push(rect(x - 0.13, 38.63, x + 0.13, 38.89, 0, S1));
      const tone = 0x3b4446, P = G.paint, ry = yc - wd / 2 + 0.04;
      P.push(col(xform(new THREE.BoxGeometry(L - 0.5, 0.045, 0.045), sx + 2.66, 1.6 + 1.0, -ry, 0, 0, ang), tone), col(xform(new THREE.BoxGeometry(L - 0.5, 0.03, 0.03), sx + 2.66, 1.6 + 0.5, -ry, 0, 0, ang), tone));
      for (let i = 0; i < 19; i += 2) P.push(col(box(0.03, 0.95, 0.03, sx + 0.28 * i + 0.14, 0.16 * (i + 1), -ry), tone));
      railing('x', 38.64, 31.95, X1 - 0.02, U0); railing('y', X1 - 0.04, 38.64, Y0, U0);
    }
    // what the water left: silt against the upstream (north and east) faces, timber caught on the gallery columns, things that floated and settled
    bank('x', Y1, 1, X0 + 0.5, X1 - 0.3, () => 0.5, () => 1.7);
    bank('y', XE, 1, Y0 + 9, Y1 - 0.3, (p) => 0.22 + 0.2 * smooth(50, 68, p), () => 1.0, FL);
    bank('y', X1 + 0.3, 1, Y0 + 14, Y1 + 0.6, (p) => 0.2 + 0.2 * smooth(52, 70, p), () => 1.1);
    const WOODC = [0x62574a, 0x574d42, 0x6b6052];
    for (const [cy, n] of [[62.5, 5], [51.25, 3]]) for (let i = 0; i < n; i++) { const L = 1.8 + R() * 1.8; G.paint.push(col(xform(new THREE.BoxGeometry(0.11 + R() * 0.05, 0.045, L), X1 - 0.3 + R() * 0.9, FL + 0.12 + i * 0.1, -(cy + 0.5 + L * 0.36 + R() * 0.3), 0.12 + R.gauss() * 0.28, 0.1 + R() * 0.2, R.gauss() * 0.2), R.pick(WOODC))); }
    G.paint.push(col(tube([V(33.5, 63.4, 1.25), V(33.95, 64.6, 0.8), V(34.3, 66.2, 0.45), V(34.2, 68.3, 0.24)], 0.045, { radial: 5 }), 0x4b4238), col(tube([V(33.95, 64.6, 0.8), V(34.75, 65.2, 0.7), V(35.2, 66.3, 0.34)], 0.025, { radial: 4 }), 0x4b4238));
    { const P = G.paint, bx = 32.9, by = 57.6, c = 0x5f5548, M = (g) => xform(g, bx, FL + 0.03, -by, 0.35, 0, Math.PI / 2 - 0.08);          // a bench on its side
      P.push(col(M(new THREE.BoxGeometry(0.28, 0.035, 1.5).translate(0, 0.44, 0)), c)); for (const z of [-0.62, 0.62]) for (const x of [-0.1, 0.1]) P.push(col(M(new THREE.BoxGeometry(0.04, 0.44, 0.04).translate(x, 0.22, z)), 0x4d453b)); P.push(col(M(new THREE.BoxGeometry(0.03, 0.05, 1.24).translate(0, 0.14, 0)), 0x4d453b)); }
    G.paint.push(col(xform(new THREE.CylinderGeometry(0.29, 0.29, 0.9, 14).rotateZ(Math.PI / 2), 32.5, FL + 0.3, -43.0, 0.9), 0x565f5a), col(xform(new THREE.TorusGeometry(0.295, 0.016, 4, 14).rotateY(Math.PI / 2), 32.5, FL + 0.3, -43.0, 0.9), 0x474e4a));   // a water drum that floated in and lodged
    label('Building A', { sub: 'Standing. Not searched in this exercise', tone: 'muted', priority: 2, maxDist: 420, minDist: 30, position: new THREE.Vector3(21, PAR + 1.55, -55) });
  }

  // =====================================================================================================================
  // Building C: damaged. The west part stands, cracked; the north-east bays (x 105.4..112, y 28.67..46) have pancaked.
  // =====================================================================================================================
  {
    const R = rng('massing-c'), X0 = 92, Y0 = 20, X1 = 112, Y1 = 46, XB = 105.4, YB = 28.67, S1 = 2.8, U0 = 3.0, U1 = 5.6, TOP = 5.8, PAR = 6.2, CC = 0xc2b9ad, CC2 = 0xb3aa9d, CIN = 0xa9ada6, FRC = 0x74705f;
    const GS = 1.0, US = 4.05, bay = (Y1 - Y0) / 6;
    const state = () => { const v = R(); return v < 0.38 ? 'ok' : v < 0.72 ? 'empty' : 'hang'; };
    const op = (list, s) => list.map((p) => ({ p, w: WW, s0: s, s1: s + WH }));
    const wset = (axis, face, o, list, sill, extra = {}) => { for (const p of list) addWindow(R, axis, face, o, p, sill, { c: FRC, state: state(), glazed: 0.25, streak: 0.85, ...extra }); };
    // west face, with the entrance in the third bay
    const westP = [...Array(6)].map((_, i) => Y0 + bay * (i + 0.5)), doorP = westP[2], westG = westP.filter((_, i) => i !== 2);
    facade('y', X0, -1, Y0, Y1, 0, S1, G.plC, [...op(westG, GS), { p: doorP, w: 1.4, s0: 0.12, s1: 2.22 }]); facade('y', X0, -1, Y0, Y1, U0, U1, G.up, op(westP, US), CC);
    wset('y', X0, -1, westG, GS); wset('y', X0, -1, westP, US);
    doorFrame('y', X0, -1, doorP, 0.12, 1.4, 2.1, 0x4a4d48); leaf(X0 + 0.02, doorP + 0.66, 0.14, 0.68, 2.04, -Math.PI / 2 - 2.2, 0x5b5f58, { rz: -0.05 });
    G.conc.push(onWall(new THREE.BoxGeometry(2.6, 0.12, 1.3).translate(0, 0, 0.65), 'y', X0, -1, doorP, 2.5, 0, 0, 0.13), rect(X0 - 1.0, doorP - 1.1, X0, doorP + 1.1, 0, 0.12));    // canopy, sagging; step
    // south face
    const southP = [...Array(6)].map((_, i) => X0 + 1.667 + 3.333 * i);
    facade('x', Y0, -1, X0, X1, 0, S1, G.plC, op(southP, GS)); facade('x', Y0, -1, X0, X1, U0, U1, G.up, op(southP, US), CC);
    wset('x', Y0, -1, southP, GS); wset('x', Y0, -1, southP, US);
    // north face of the standing part: the mud is banked up to its sills
    const northP = [94.2, 98.7, 103.2];
    facade('x', Y1, 1, X0, XB, 0, S1, G.plC, op(northP, GS)); facade('x', Y1, 1, X0, XB, U0, U1, G.up, op(northP, US), CC2);
    wset('x', Y1, 1, northP, GS, { glazed: 0 }); wset('x', Y1, 1, northP, US);
    // east face of the south-east bays: ground storey cracked, the upper panel has let go of the roof and leans out
    const eastP = [22.2, 26.4];
    facade('y', X1, 1, Y0, YB, 0, S1, G.plC, op(eastP, GS)); wset('y', X1, 1, eastP, GS, { glazed: 0 });
    { const tmp = [], lean = 8.5 * D; facade('y', X1, 1, Y0 + 0.3, YB - 0.1, U0, U1 - 0.15, tmp, op(eastP, US), CC2, 0.2);
      for (const g of tmp) G.up.push(g.translate(-X1, -U0, 0).rotateZ(-lean).translate(X1, U0, 0));
      for (const p of eastP) G.conc.push(onWall(new THREE.BoxGeometry(WW + 0.24, 0.07, 0.2).translate(0, -0.035, 0.04), 'y', X1, 1, p, US).translate(-X1, -U0, 0).rotateZ(-lean).translate(X1, U0, 0));
      wins.push({ m: wallM('y', X1 + 0.42, 1, eastP[0] + 0.3, US - 0.75, 0, 0.5, 0.3), c: new THREE.Color(FRC) }); }
    // the cut: inside walls now open to the weather, with their doorways
    facade('y', XB, 1, YB, Y1, 0, S1, G.plC, [{ p: 32.4, w: 1.0, s0: 0.05, s1: 2.1 }, { p: 41.2, w: 1.0, s0: 0.05, s1: 2.1 }]); facade('y', XB, 1, YB, Y1, U0, U1, G.up, [{ p: 32.4, w: 1.0, s0: U0, s1: U0 + 2.05 }, { p: 41.2, w: 1.0, s0: U0, s1: U0 + 2.05 }], CIN);
    facade('x', YB, 1, XB, X1, 0, S1, G.plC, [{ p: 109.9, w: 1.0, s0: 0.05, s1: 2.1 }]); facade('x', YB, 1, XB, X1 - 0.3, U0, U1, G.up, [{ p: 107.4, w: 1.0, s0: U0, s1: U0 + 2.05 }], CIN);
    G.paint.push(col(rect(X0 + 0.3, Y0 + 0.3, XB - 0.3, Y1 - 0.3, 0.03, U1), DARK), col(rect(XB - 0.3, Y0 + 0.3, X1 - 0.32, YB - 0.3, 0.03, U1), DARK));
    leaf(XB + 0.03, 41.2 - 0.46, U0 + 0.02, 0.9, 2.0, Math.PI / 2 - 1.1, 0x5b5f58, { flood: false, rz: 0.06 });
    // slabs, beam lines, columns
    G.conc.push(rect(X0 - 0.03, Y0 - 0.03, XB, Y1 + 0.03, S1, U0), rect(XB, Y0 - 0.03, X1 + 0.03, YB, S1, U0), rect(X0 - 0.18, Y0 - 0.18, XB + 0.25, Y1 + 0.18, U1, TOP), rect(XB, Y0 - 0.18, X1 + 0.18, YB + 0.2, U1, TOP));
    for (const [axis, face, o, a, b] of [['y', X0, -1, Y0, Y1], ['x', Y0, -1, X0, X1], ['x', Y1, 1, X0, XB], ['y', X1, 1, Y0, YB]]) { band(axis, face, o, a, b, 0, 0.26, 0.05); band(axis, face, o, a, b, S1 - 0.25, U0 + 0.25, 0.035); if (!(axis === 'y' && o > 0)) band(axis, face, o, a, b, U1 - 0.28, U1, 0.035); }
    for (const y of [YB, YB + bay, YB + 2 * bay, YB + 3 * bay, Y1 - 0.17]) G.conc.push(rect(XB - 0.17, y - 0.17, XB + 0.2, y + 0.17, 0, U1));
    G.conc.push(rect(X1 - 0.34, YB - 0.17, X1, YB + 0.17, 0, U1));
    // the torn edges of the roof and floor, ragged, with bars hanging out of them
    for (let y = YB + 0.3; y < Y1; y += 0.5 + R() * 0.9) { const d = 0.15 + R() * 0.45, w = 0.3 + R() * 0.5; G.conc.push(rect(XB + 0.2, y, XB + 0.2 + d, Math.min(Y1, y + w), U1 + 0.03, TOP - 0.02)); }
    for (let x = XB + 0.4; x < X1; x += 0.5 + R() * 0.8) { const d = 0.12 + R() * 0.5, w = 0.3 + R() * 0.45; G.conc.push(rect(x, YB + 0.2, Math.min(X1, x + w), YB + 0.2 + d, U1 + 0.03, TOP - 0.02)); if (R() < 0.6) G.conc.push(rect(x, YB, Math.min(X1, x + w), YB + d * 0.7, S1 + 0.02, U0 - 0.02)); }
    for (let y = YB + 0.6; y < Y1 - 0.3; y += 1.25) bars(R, V(XB + 0.35, y, TOP - 0.08), new THREE.Vector3(1, 0, 0), 2, 0.5, 0.9);
    for (let x = XB + 0.5; x < X1 - 0.2; x += 1.05) { bars(R, V(x, YB + 0.4, TOP - 0.08), new THREE.Vector3(0, 0, -1), 2, 0.45, 1.1); bars(R, V(x, YB + 0.2, U0 - 0.08), new THREE.Vector3(0, 0, -1), 1, 0.3, 0.8); }
    // parapet on the standing roof, broken back from the cut; rooftop stubs; a small tank that stayed put
    for (const [axis, c, a, b] of [['x', Y0 - 0.1, X0 - 0.18, X1 + 0.18], ['y', X0 - 0.1, Y0 - 0.18, Y1 + 0.18], ['x', Y1 + 0.1, X0 - 0.18, 102.6], ['y', X1 + 0.1, Y0 - 0.18, 24.1]]) { G.up.push(col(along(axis, c, a, b, TOP, PAR, 0.15), CC)); G.conc.push(along(axis, c, a, b, PAR, PAR + 0.05, 0.21)); }
    for (const [x, hgt] of [[102.6, 0.28], [103.2, 0.16], [103.9, 0.22]]) G.up.push(col(along('x', Y1 + 0.1, x, x + 0.6, TOP, TOP + hgt, 0.15), CC2));
    for (const [y, hgt] of [[24.1, 0.3], [24.8, 0.14]]) G.up.push(col(along('y', X1 + 0.1, y, y + 0.7, TOP, TOP + hgt, 0.15), CC2));
    for (const [x, y] of [[X0 + 0.1, Y0 + 0.1], [X0 + 0.1, Y0 + 2 * bay], [X0 + 0.1, Y0 + 4 * bay], [X0 + 0.1, Y1 - 0.1], [98.7, Y0 + 0.1], [98.7, Y1 - 0.1]]) {
      const hh = 0.3 + R() * 0.3; G.conc.push(rect(x - 0.15, y - 0.15, x + 0.15, y + 0.15, TOP, PAR + hh));
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const L = 0.4 + R() * 0.5; G.rebar.push(xform(new THREE.CylinderGeometry(0.009, 0.009, L, 4).translate(0, L / 2, 0), x + dx * 0.09, PAR + hh - 0.02, -(y + dy * 0.09), 0, R.gauss() * 0.2, R.gauss() * 0.2)); }
    }
    G.conc.push(rect(95.2, 38.6, 96.8, 40.2, TOP, TOP + 0.3)); for (const g of tank(0.9)) G.paint.push(xform(g, 96, TOP + 0.3, -39.4));
    G.paint.push(col(tube([V(96.5, 39.2, TOP + 0.5), V(98.5, 37.5, TOP + 0.06), V(103.5, 36.4, TOP + 0.06), V(105.5, 36.9, TOP - 0.05), V(106.3, 37.2, TOP - 0.7)], 0.027), 0x565b5e));

    // ---- the pancake: three pieces of floor slab and three of roof, hinged on the column line and dropped to the east ----
    const pieces = [[YB + 0.25, 34.55, 15, 2.62, 21.5, 5.42, 0.022], [34.75, 40.45, 18.5, 2.48, 25.5, 5.3, -0.03], [40.65, Y1, 13, 2.68, 19.5, 5.5, 0.028]];
    pieces.forEach(([ya, yb, fa, fh, ra, rh, tw], i) => {
      const len = yb - ya, ym = (ya + yb) / 2, MF = matrix(XB + 0.15, fh, -ym, 0, tw, -fa * D), MR = matrix(XB + 0.2, rh, -ym, 0, -tw, -ra * D), F = (g) => g.applyMatrix4(MF), Rf = (g) => g.applyMatrix4(MR);
      G.conc.push(F(new THREE.BoxGeometry(6.2, 0.2, len).translate(3.1, -0.1, 0)), Rf(new THREE.BoxGeometry(6.85, 0.2, len).translate(3.425, -0.1, 0)));
      G.paint.push(col(F(new THREE.BoxGeometry(5.9, 3.0, len - 0.3).translate(3.05, -1.7, 0)), DARK), col(Rf(new THREE.BoxGeometry(6.1, 2.3, len - 0.5).translate(3.25, -1.35, 0)), DARK));
      // broken slab edges
      for (let z = -len / 2; z < len / 2 - 0.3; z += 0.5 + R() * 0.7) { const w = 0.3 + R() * 0.4; G.conc.push(F(new THREE.BoxGeometry(0.1 + R() * 0.3, 0.16, w).translate(6.3, -0.1, z + w / 2)), Rf(new THREE.BoxGeometry(0.1 + R() * 0.25, 0.17, w).translate(6.95, -0.1, z + w / 2))); }
      // parapet that rode down with the roof, in broken lengths
      for (let z = -len / 2, k = 0; z < len / 2 - 0.2; k++) { const w = Math.min(len / 2 - z, 0.8 + R() * 1.4), gone = R() < 0.3; if (!gone) G.up.push(col(Rf(new THREE.BoxGeometry(0.15, 0.2 + R() * 0.22, w - 0.04).translate(6.78, 0.16, z + w / 2)), CC2)); z += w; }
      if (i === 2) G.up.push(col(Rf(new THREE.BoxGeometry(4.6, 0.4, 0.15).translate(4.4, 0.2, -len / 2 + 0.08)), CC2));
      // upper-storey east wall, crushed between the slabs and pushed outwards
      let z = -len / 2 + 0.15;
      while (z < len / 2 - 0.5) {
        const w = Math.min(len / 2 - 0.1 - z, 0.9 + R() * 1.3), gap = R() < 0.55, hh = 1.35 + R() * 0.55, lean = (10 + R() * 16) * D;
        G.up.push(col(F(new THREE.BoxGeometry(0.2, hh, w).translate(0, hh / 2, 0).rotateZ(-lean).translate(5.95, 0, z + w / 2)), R() < 0.5 ? CC : CC2));
        G.brick.push(F(new THREE.BoxGeometry(0.19, 0.12, w - 0.06).translate(0, hh + 0.05, 0).rotateZ(-lean).translate(5.95, 0, z + w / 2)));
        z += w + (gap ? 0.5 + R() * 0.9 : 0.03);
      }
      // a column that folded with the storey, and the bars pulled out at the hinge
      G.conc.push(F(new THREE.BoxGeometry(0.32, 1.9, 0.32).translate(0, 0.95, 0).rotateZ(-(24 + R() * 10) * D).translate(5.6, 0, len / 2 - 0.25)));
      bars(R, new THREE.Vector3(6.3, -0.1, 0).applyMatrix4(MF), new THREE.Vector3(1, 0, 0), 4, len * 0.8, 0.7); bars(R, new THREE.Vector3(6.95, -0.1, 0).applyMatrix4(MR), new THREE.Vector3(1, 0, 0), 5, len * 0.85, 0.8);
      if (i === 1) {                                                   // the tank slid down the roof and came to rest against the broken parapet
        const MT = MR.clone().multiply(matrix(5.75, 0, 0.9, 0.6, 0.1, -0.5)); for (const g of tank(0.95)) G.paint.push(g.applyMatrix4(MT));
        G.conc.push(Rf(new THREE.BoxGeometry(1.5, 0.3, 1.5).translate(3.3, 0.15, 1.2)));
      }
      if (i === 0) for (let k = 0; k < 3; k++) G.cgi.push(Rf(xform(new THREE.PlaneGeometry(0.92, 2.4).rotateX(-Math.PI / 2), 5.3 + k * 0.5, 0.05 + k * 0.03, -1 + k * 1.1, 0.5 + k * 0.5, 0.05, 0)));
      // what is left of the ground storey under the slab: brick stumps along the east line, the north end wall crushed to a wedge
      for (let y = ya; y < yb - 0.3;) { const w = 0.5 + R() * 0.7, hh = 0.35 + R() * 0.75; if (R() < 0.8) G.brick.push(xform(new THREE.BoxGeometry(0.23, hh, Math.min(w, yb - y)).translate(0, hh / 2, 0), X1 - 0.13 + R.gauss() * 0.04, 0, -(y + w / 2), R.gauss() * 0.05, 0, -R() * 0.22)); y += w + 0.02; }
      if (i === 2) for (let x = XB + 0.4; x < X1 - 0.3;) { const w = 0.5 + R() * 0.6, top = fh - 0.3 - (x - XB) * Math.tan(fa * D) - R() * 0.3; if (top > 0.3) G.brick.push(along('x', Y1 - 0.12, x, x + w, 0, top, 0.23)); x += w; }
    });
    // snapped ground-storey columns along the east line, bars splayed; one length of column lies in the mud
    for (const [y, hh, lx, lz] of [[YB + bay, 1.25, -0.2, 0.1], [YB + 2 * bay, 0.8, -0.32, -0.12], [YB + 3 * bay, 1.05, -0.12, 0.2], [Y1 - 0.18, 1.5, -0.25, -0.15]]) {
      const M = matrix(X1 - 0.18, 0, -y, 0, lz, lx); G.conc.push(new THREE.BoxGeometry(0.34, hh, 0.34).translate(0, hh / 2, 0).applyMatrix4(M));
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1]]) { const o = new THREE.Vector3(dx * 0.11, hh - 0.05, dz * 0.11).applyMatrix4(M), L = 0.4 + R() * 0.6, a = R() * 6.28, b = 0.3 + R() * 0.8; G.rebar.push(tube([o, o.clone().add(new THREE.Vector3(Math.cos(a) * 0.05, L * 0.5, Math.sin(a) * 0.05)), o.clone().add(new THREE.Vector3(Math.cos(a) * b * L, L * (0.75 + R() * 0.2), Math.sin(a) * b * L))], 0.012, { radial: 4, segs: 5 })); }
    }
    G.conc.push(xform(new THREE.BoxGeometry(0.34, 0.34, 2.3), 113.5, 0.52, -37.6, 0.35, 0.16, 0.1));
    bars(R, V(113.9, 36.55, 0.72), new THREE.Vector3(0.34, 0, 0.94), 4, 0.26, 0.5);

    // ---- mud and rubble: banked a metre up the north and east faces, a wedge at the foot of the collapse ----
    bank('x', Y1, 1, 95.5, X1 + 1.2, (p) => 0.35 + 0.8 * smooth(96, 101, p), (p) => 1.5 + 0.8 * smooth(98, 106, p));
    bank('y', X1, 1, Y1 + 1.2, 21.5, (p) => 0.45 + 0.85 * smooth(27.5, 31, p), (p) => 1.2 + 1.15 * smooth(27, 31, p));
    { let g = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.8 + 0.4 * N(p.getX(i) * 2.1 + 4, p.getZ(i) * 2.1); p.setXYZ(i, p.getX(i) * 2.5 * k, p.getY(i) * 1.15 * k, p.getZ(i) * 2.5 * k); } g.computeVertexNormals(); G.mud.push(worldUV(g.translate(X1 - 0.2, -0.06, -(Y1 - 0.2)), 0.35)); }
    const bh = (x, y) => (y > 27.5 ? 1.15 * Math.pow(Math.max(0, 1 - Math.max(0, x - X1) / 2.3), 1.45) : 0.3);
    const rk = (x, y, s, up = 0) => rocks.push({ m: matrix(x, bh(x, y) + up + s * 0.18, -y, R() * 6.28, R.gauss() * 0.5, R.gauss() * 0.5, [s * (0.7 + R() * 0.7), s * (0.45 + R() * 0.5), s * (0.7 + R() * 0.7)]), c: new THREE.Color().setHSL(0.09, 0.05 + R() * 0.06, 0.6 + R() * 0.3) });
    for (let i = 0, n = hi ? 120 : 60; i < n; i++) { const t = R(), x = X1 - 0.5 + Math.abs(R.gauss()) * 1.5, y = lerp(YB + 0.5, Y1 + 0.9, t); rk(Math.min(x, X1 + 2.4), y, 0.1 + R() * R() * 0.5); }
    for (let i = 0, n = hi ? 34 : 16; i < n; i++) rk(lerp(XB + 0.6, X1 + 1.5, R()), Y1 + 0.25 + Math.abs(R.gauss()) * 0.9, 0.1 + R() * R() * 0.4, 0.5);
    for (let i = 0; i < 14; i++) rk(lerp(X0 - 1.4, X0 - 0.2, R()), lerp(Y0 + 1, Y1 - 1, R()) , 0.07 + R() * 0.16, -0.3);
    for (let i = 0; i < 9; i++) { const x = X1 + 0.3 + R() * 1.7, y = lerp(YB + 1, Y1 + 0.5, R()), g = slab(0.7 + R() * 1.0, 0.5 + R() * 0.8, 0.14 + R() * 0.06, R); G.conc.push(xform(g, x, bh(x, y) + 0.12, -y, R() * 6.28, R.gauss() * 0.35, R.gauss() * 0.35)); }
    for (const [x, y, ry] of [[113.6, 41.6, 0.4], [113.0, 31.4, 2.1]]) wins.push({ m: matrix(x, bh(x, y) + 0.2, -y, ry, -Math.PI / 2 + 0.22, 0.1), c: new THREE.Color(FRC).multiplyScalar(0.8) });   // frames torn out and carried down

    // ---- cracks and lost plaster on the faces that still stand ----
    const CR = { d: 0.042 };
    decal(2, 'y', X0, -1, westP[1] + bay / 2 - 0.1, 3.3, 2.2, 4.3, CR); decal(3, 'y', X0, -1, westP[3] + bay / 2, 2.9, 2.2, 3.6, { ...CR, flip: true }); decal(2, 'y', X0, -1, westP[4] + bay / 2, 4.0, 2.0, 3.0, { ...CR, flip: true });
    decal(2, 'x', Y0, -1, 98.67, 3.0, 2.2, 4.6, CR); decal(2, 'x', Y0, -1, 105.33, 3.1, 2.3, 4.4, { ...CR, flip: true }); decal(3, 'x', Y0, -1, 111.1, 2.9, 1.5, 4.0, CR); decal(3, 'x', Y0, -1, 95.33, 4.1, 2.0, 2.6, { ...CR, flip: true });
    decal(3, 'x', Y1, 1, 96.45, 2.6, 2.2, 3.6, { ...CR, flip: true }); decal(2, 'x', Y1, 1, 100.95, 3.9, 2.2, 3.2, CR); decal(2, 'y', X1, 1, 24.3, 1.6, 2.0, 2.6, CR);
    const patch = (axis, face, o, p, h, rad) => {
      const pts = [], n = 13; for (let i = 0; i < n; i++) { const a = (i / n) * 6.283, k = 0.62 + R() * 0.55; pts.push(new THREE.Vector2(Math.cos(a) * rad * k, Math.sin(a) * rad * 1.35 * k)); }
      const g = new THREE.ShapeGeometry(new THREE.Shape(pts)), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + p) / 1.2, (uv.getY(i) + h) / 0.6);
      G.brickRaw.push(onWall(g, axis, face, o, p, h, 0.007));
    };
    for (const [axis, face, o, p, h, rad] of [['y', X0, -1, westP[0] + bay / 2, 4.75, 0.62], ['y', X0, -1, westP[2] + bay / 2 + 0.1, 1.65, 0.7], ['y', X0, -1, westP[4] + bay / 2, 1.6, 0.6], ['x', Y0, -1, 95.33, 1.75, 0.66], ['x', Y0, -1, 102, 4.7, 0.64], ['x', Y0, -1, 108.67, 1.8, 0.62], ['x', Y1, 1, 96.45, 4.7, 0.6], ['x', Y1, 1, 100.95, 1.9, 0.55]]) patch(axis, face, o, p, h, rad);
    label('Building C', { sub: 'Damaged. Unsafe to enter', tone: 'muted', priority: 2, maxDist: 420, minDist: 30, position: new THREE.Vector3(100, PAR + 1.55, -33) });
  }

  // ---- assemble: one mesh per material ----
  const up = paintUpper(hi ? 2048 : 1024, aniso), bk = paintBrick(aniso), dc = paintDecals(aniso);
  const upMat = new THREE.MeshStandardMaterial({ map: up.map, normalMap: up.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.93, vertexColors: true });
  const brickMat = new THREE.MeshStandardMaterial({ map: bk.map, normalMap: bk.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.95 });
  const decalMat = new THREE.MeshStandardMaterial({ map: dc, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const own = [up.map, up.normalMap, bk.map, bk.normalMap, dc, upMat, brickMat, decalMat];
  const uvd = (list, su, sv = su) => list.map((g) => worldUV(g, su, sv));
  const add = (name, geo, mat, o = {}) => { const m = mesh(geo, mat, { name: 'massing-' + name, ...o }); group.add(m); return m; };
  add('plaster-a', merge(uvd(G.plA, 1 / 8, 1 / 4), { keepColor: false }), mats.plasterA);
  add('plaster-c', merge(uvd(G.plC, 1 / 8, 1 / 4), { keepColor: false }), mats.plasterC);
  add('upper', merge(uvd(G.up, 1 / 8, 1 / 4), { keepColor: true }), upMat);
  add('concrete', merge(uvd(G.conc, 0.3), { keepColor: false }), mats.concrete);
  add('paint', merge(G.paint, { keepUV: false, keepColor: true }), mats.paint);
  add('glass', merge(G.glass, { keepUV: false, keepColor: false }), mats.glass, { cast: false });
  add('rebar', merge(G.rebar, { keepUV: false, keepColor: false }), mats.rebar);
  add('mud', merge(uvd(G.mud, 0.35), { keepColor: false }), mats.mud);
  add('cgi', merge(G.cgi, { keepColor: false }), mats.cgi);
  add('brick', merge([...uvd(G.brick, 1 / 1.2, 1 / 0.6), ...G.brickRaw], { keepColor: false }), brickMat);
  const dm = add('decals', merge(G.decal, { keepColor: false }), decalMat, { cast: false }); dm.renderOrder = 2;
  group.add(instanced(unit, mats.paint, wins.map((w) => w.m), { colors: wins.map((w) => w.c), name: 'massing-windows' }));
  group.add(instanced(rock(1, 'massing'), mats.rock, rocks.map((r) => r.m), { colors: rocks.map((r) => r.c), name: 'massing-rubble' }));

  return { group, dispose() { for (const o of own) o.dispose(); } };
}
