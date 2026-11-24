// Timelines, Demo: one world as a cut block of ground. Built once, instanced once per world.
// Everything is placed from app/core/world.js (walls, rooms, rubble, buildings); surfaces are painted at load.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SITE, WALLS, ROOMS, OBSTACLES, HAZARDS } from '../../core/world.js';

export const K = 0.1;                                  // 1 m of the site = 0.1 scene units
export const lx = (x) => (x - SITE.w / 2) * K, lz = (y) => -(y - SITE.h / 2) * K;
const HK = 0.145;                                      // heights are drawn 1.45 times taller, so the plan reads from above
const rng = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const frame = () => new Promise((r) => setTimeout(r, 0));
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// Layered value noise by stretching small random images: smooth, fast, no per-pixel loop.
function noiseCanvas(w, h, sizes, seed, alpha = 0.5) {
  const c = cv(w, h), g = c.getContext('2d'), R = rng(seed);
  g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); g.imageSmoothingQuality = 'high';
  let a = alpha;
  for (const s of sizes) {
    const sw = Math.max(2, Math.round(w / s)), sh = Math.max(2, Math.round(h / s)), n = cv(sw, sh), q = n.getContext('2d'), im = q.createImageData(sw, sh);
    for (let i = 0; i < im.data.length; i += 4) { const v = R() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    q.putImageData(im, 0, 0); g.globalAlpha = a; g.drawImage(n, 0, 0, sw, sh, 0, 0, w, h); a *= 0.72;
  }
  g.globalAlpha = 1; return c;
}
function normalFrom(height, strength) {
  const w = height.width, h = height.height, src = height.getContext('2d').getImageData(0, 0, w, h).data, out = cv(w, h), g = out.getContext('2d'), im = g.createImageData(w, h), d = im.data;
  const at = (x, y) => src[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4] / 255;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    const dx = (at(x - 1, y) - at(x + 1, y)) * strength, dy = (at(x, y - 1) - at(x, y + 1)) * strength, l = 1 / Math.hypot(dx, dy, 1);
    d[i] = (dx * l * 0.5 + 0.5) * 255; d[i + 1] = (-dy * l * 0.5 + 0.5) * 255; d[i + 2] = (l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(im, 0, 0); return out;
}
const tex = (c, srgb, aniso) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };

async function groundMaps(aniso) {
  const W = 2048, H = 1536, s = W / SITE.w, X = (x) => x * s, Y = (y) => H - y * s, R = rng(77);
  const col = cv(W, H), g = col.getContext('2d'), hgt = cv(1024, 768), hg = hgt.getContext('2d'), rough = cv(1024, 768), rg = rough.getContext('2d');
  const n1 = noiseCanvas(1024, 768, [300, 130, 60, 26, 11, 5, 2], 5), n2 = noiseCanvas(1024, 768, [90, 34, 14, 6, 3], 9);
  await frame();
  const poly = (q, pts) => { q.beginPath(); pts.forEach((p, i) => (i ? q.lineTo(X(p[0]), Y(p[1])) : q.moveTo(X(p[0]), Y(p[1])))); q.closePath(); };
  // silt and mud
  const gr = g.createLinearGradient(W, 0, 0, H); gr.addColorStop(0, '#4b4439'); gr.addColorStop(0.45, '#423e37'); gr.addColorStop(1, '#4c4b47'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.85; g.drawImage(n1, 0, 0, W, H); g.globalAlpha = 0.45; g.drawImage(n2, 0, 0, W, H); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  // flow lines the water left, north-east to south-west, bending round the building
  g.lineCap = 'round';
  for (let i = 0; i < 520; i++) {
    let x = 60 + R() * 70, y = 45 + R() * 60; if (R() < 0.35) { x = 84 + R() * 36; y = R() * 60; }
    const dark = R() < 0.6; g.strokeStyle = dark ? 'rgba(18,15,11,' + (0.05 + R() * 0.13) + ')' : 'rgba(150,138,116,' + (0.03 + R() * 0.08) + ')'; g.lineWidth = 0.8 + R() * 3.2; g.beginPath(); g.moveTo(X(x), Y(y));
    const L = 9 + R() * 20; for (let k = 0; k < 8; k++) { x -= L / 8 * (0.8 + R() * 0.3); y -= L / 8 * (0.55 + Math.sin(x * 0.16) * 0.35); g.lineTo(X(x), Y(y)); } g.stroke();
  }
  // yard road from the staging area to the entrance: worn asphalt with tyre marks
  const road = (q, c, w) => { q.strokeStyle = c; q.lineWidth = w * s; q.lineJoin = 'round'; q.beginPath(); q.moveTo(X(-2), Y(13)); q.lineTo(X(30), Y(13)); q.quadraticCurveTo(X(60), Y(13), X(64), Y(29)); q.stroke(); };
  road(g, 'rgba(30,31,33,.62)', 7.4); road(g, 'rgba(66,67,69,.6)', 6.4);
  g.globalAlpha = 0.5; for (const o of [-1.2, 1.2, -0.6, 2]) { g.save(); g.translate(0, o * s); road(g, 'rgba(22,20,17,.55)', 0.34); g.restore(); } g.globalAlpha = 1;
  g.setLineDash([2.4 * s, 2.4 * s]); road(g, 'rgba(190,188,178,.16)', 0.16); g.setLineDash([]);
  // deep mud and slope hazards are darker, wetter ground
  for (const z of HAZARDS) { if (z.kind !== 'mud' && z.kind !== 'slope') continue; g.save(); g.filter = 'blur(26px)'; poly(g, z.poly); g.fillStyle = z.kind === 'mud' ? 'rgba(24,18,12,.58)' : 'rgba(46,36,26,.5)'; g.fill(); g.restore(); }
  await frame();
  // concrete floors
  const B = [44, 30, 84, 58];
  g.fillStyle = '#23262a'; g.fillRect(X(B[0] - 1.4), Y(B[3] + 1.4), (B[2] - B[0] + 2.8) * s, (B[3] - B[1] + 2.8) * s);
  for (const r of ROOMS) {
    const [x0, y0, x1, y1] = r.rect; g.fillStyle = r.corridor ? '#5f6266' : ['#6d6b66', '#646669', '#6a6a69', '#615f5c'][r.id.charCodeAt(2) % 4]; g.fillRect(X(x0), Y(y1), (x1 - x0) * s, (y1 - y0) * s);
    g.strokeStyle = 'rgba(20,22,25,.34)'; g.lineWidth = 1; g.beginPath(); const st = r.corridor ? 1 : 1.5;
    for (let x = x0; x <= x1; x += st) { g.moveTo(X(x), Y(y0)); g.lineTo(X(x), Y(y1)); } for (let y = y0; y <= y1; y += st) { g.moveTo(X(x0), Y(y)); g.lineTo(X(x1), Y(y)); } g.stroke();
  }
  g.save(); g.beginPath(); g.rect(X(B[0]), Y(B[3]), (B[2] - B[0]) * s, (B[3] - B[1]) * s); g.clip(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.8; g.drawImage(n2, 0, 0, W, H); g.globalCompositeOperation = 'source-over';
  // silt that came in through the collapsed corner and settled along the corridor
  g.globalAlpha = 1; g.filter = 'blur(18px)'; g.fillStyle = 'rgba(58,46,33,.82)'; poly(g, [[74, 48], [86, 46], [88, 60], [74, 60]]); g.fill(); poly(g, [[72, 41.5], [80, 41.5], [80, 46.5], [70, 46]]); g.fill(); g.fillStyle = 'rgba(52,43,33,.5)'; poly(g, [[44, 43.2], [74, 42.6], [74, 45.6], [44, 45]]); g.fill(); g.filter = 'none'; g.restore();
  for (let i = 0; i < 46; i++) { let x = 44 + R() * 40, y = 30 + R() * 28; g.strokeStyle = 'rgba(12,13,15,.5)'; g.lineWidth = 0.7 + R(); g.beginPath(); g.moveTo(X(x), Y(y)); let a = R() * 7; for (let k = 0; k < 7; k++) { a += (R() - 0.5) * 1.3; x += Math.cos(a) * 0.9; y += Math.sin(a) * 0.9; g.lineTo(X(x), Y(y)); } g.stroke(); }
  // puddles: painted into colour and made smooth in the roughness map
  rg.fillStyle = '#d8d8d8'; rg.fillRect(0, 0, 1024, 768); rg.globalCompositeOperation = 'overlay'; rg.globalAlpha = 0.5; rg.drawImage(n2, 0, 0); rg.globalAlpha = 1; rg.globalCompositeOperation = 'source-over';
  hg.drawImage(n1, 0, 0); hg.globalAlpha = 0.5; hg.drawImage(n2, 0, 0); hg.globalAlpha = 1; hg.fillStyle = 'rgba(128,128,128,.82)'; hg.fillRect(B[0] * s / 2, 768 - B[3] * s / 2, (B[2] - B[0]) * s / 2, (B[3] - B[1]) * s / 2);
  const puddle = (x, y, r) => { const n = 11, pts = []; for (let k = 0; k < n; k++) { const a = k / n * 6.283, rr = r * (0.6 + R() * 0.6); pts.push([x + Math.cos(a) * rr * 1.5, y + Math.sin(a) * rr * 0.8]); }
    g.save(); g.filter = 'blur(3px)'; g.fillStyle = 'rgba(16,18,20,.62)'; poly(g, pts); g.fill(); g.restore();
    for (const [q, c] of [[rg, '#1c1c1c'], [hg, '#707070']]) { q.save(); q.scale(0.5, 0.5); q.filter = 'blur(2px)'; q.fillStyle = c; poly(q, pts); q.fill(); q.restore(); } };
  for (let i = 0; i < 74; i++) { const inMud = R() < 0.5; puddle(inMud ? 86 + R() * 32 : R() * 120, inMud ? 14 + R() * 60 : R() * 28, 0.5 + R() * 2.1); }
  for (let i = 0; i < 12; i++) puddle(46 + R() * 32, 43 + R() * 2, 0.4 + R() * 0.7);
  // pebbles and broken masonry speckle
  for (let i = 0; i < 5200; i++) { const deb = R() < 0.55, x = deb ? 86 + R() * 26 : R() * 120, y = deb ? 58 + R() * 24 : R() * 90, r = 0.5 + R() * 1.7; if (x > 44 && x < 78 && y > 30 && y < 58) continue; const v = 60 + R() * 95; g.fillStyle = 'rgba(' + v + ',' + v * 0.95 + ',' + v * 0.87 + ',.75)'; g.fillRect(X(x), Y(y), r * 2, r * 1.4); g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(X(x), Y(y) + r * 1.4, r * 2, r * 0.8); hg.fillStyle = '#c8c8c8'; hg.fillRect(X(x) / 2, Y(y) / 2, r, r); }
  await frame();
  // contact shadows: every solid thing, pushed away from the light and blurred, then a tight dark line at its foot
  const solids = [...WALLS.filter((w) => w.state !== 'collapsed').map((w) => { const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], l = Math.hypot(dx, dy), nx = -dy / l * 0.2, ny = dx / l * 0.2; return { p: [[w.a[0] + nx, w.a[1] + ny], [w.b[0] + nx, w.b[1] + ny], [w.b[0] - nx, w.b[1] - ny], [w.a[0] - nx, w.a[1] - ny]], h: 3.2 }; }), ...OBSTACLES.filter((o) => o.kind !== 'rubble').map((o) => ({ p: o.poly, h: o.h }))];
  const sh = cv(W / 2, H / 2), sg = sh.getContext('2d'); sg.scale(0.5, 0.5); sg.fillStyle = '#000';
  for (const o of solids) for (let k = 0; k <= 10; k++) { const u = (k / 10) * o.h * 0.62; poly(sg, o.p.map((p) => [p[0] + u * 0.86, p[1] - u * 0.62])); sg.fill(); }
  g.save(); g.filter = 'blur(5px)'; g.globalAlpha = 0.62; g.drawImage(sh, 0, 0, W, H); g.restore();
  const ao = cv(W / 2, H / 2), ag = ao.getContext('2d'); ag.scale(0.5, 0.5); ag.lineWidth = 10; ag.lineJoin = 'round'; for (const o of solids) { poly(ag, o.p); ag.stroke(); }
  g.save(); g.filter = 'blur(9px)'; g.globalAlpha = 0.5; g.drawImage(ao, 0, 0, W, H); g.restore();
  await frame();
  const nrm = normalFrom(hgt, 2.6);
  return { map: tex(col, true, aniso), normalMap: tex(nrm, false, aniso), roughnessMap: tex(rough, false, aniso) };
}
function concreteMaps(aniso) {
  const c = noiseCanvas(512, 512, [128, 60, 22, 8, 3, 1], 31, 0.42), g = c.getContext('2d'), R = rng(8), h = cv(512, 512), hg = h.getContext('2d');
  g.globalCompositeOperation = 'screen'; g.fillStyle = 'rgba(140,140,140,.5)'; g.fillRect(0, 0, 512, 512); g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 26; i++) { const x = R() * 512, w = 2 + R() * 12, gr = g.createLinearGradient(0, 0, 0, 360 * R() + 90); gr.addColorStop(0, 'rgba(26,24,22,.32)'); gr.addColorStop(1, 'rgba(26,24,22,0)'); g.fillStyle = gr; g.fillRect(x, 0, w, 512); }
  hg.drawImage(c, 0, 0);
  for (let i = 0; i < 150; i++) { const x = R() * 512, y = R() * 512, r = 0.8 + R() * 2.4; g.fillStyle = 'rgba(30,30,31,.5)'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); hg.fillStyle = '#222'; hg.beginPath(); hg.arc(x, y, r, 0, 7); hg.fill(); }
  g.strokeStyle = 'rgba(18,18,20,.55)'; hg.strokeStyle = '#111'; for (let i = 0; i < 7; i++) { let x = R() * 512, y = R() * 512, a = R() * 7; g.lineWidth = hg.lineWidth = 0.8 + R() * 1.2; g.beginPath(); hg.beginPath(); g.moveTo(x, y); hg.moveTo(x, y); for (let k = 0; k < 14; k++) { a += (R() - 0.5) * 1.2; x += Math.cos(a) * 12; y += Math.sin(a) * 12; g.lineTo(x, y); hg.lineTo(x, y); } g.stroke(); hg.stroke(); }
  const m = tex(c, true, aniso), n = tex(normalFrom(h, 1.8), false, aniso); for (const t of [m, n]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } return { map: m, normalMap: n };
}
function strataMap(aniso) { // the cut side of the block: silt over gravel over rock
  const W = 2048, H = 256, c = cv(W, H), g = c.getContext('2d'), R = rng(19);
  const bands = [[0, '#4a4238'], [0.14, '#3a332b'], [0.2, '#54493c'], [0.34, '#33302c'], [0.42, '#454340'], [0.66, '#2d2e30'], [1, '#1b1d20']];
  const gr = g.createLinearGradient(0, 0, 0, H); for (const [t, k] of bands) gr.addColorStop(t, k); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.7; g.drawImage(noiseCanvas(W, H, [160, 60, 20, 7, 3], 3), 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 1500; i++) { const x = R() * W, d = R(), y = 22 + d * H * 0.75, r = 1 + R() * (2 + d * 7), v = 40 + R() * 70; g.fillStyle = 'rgba(' + v + ',' + v * 0.97 + ',' + v * 0.92 + ',.7)'; g.beginPath(); g.ellipse(x, y, r * 1.5, r, R(), 0, 7); g.fill(); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1; g.stroke(); }
  for (let k = 0; k < 9; k++) { g.strokeStyle = 'rgba(0,0,0,' + (0.15 + R() * 0.3) + ')'; g.lineWidth = 1 + R() * 2; let y = 20 + R() * 190; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= W; x += 24) { y += (R() - 0.5) * 5; g.lineTo(x, y); } g.stroke(); }
  const t = tex(c, true, aniso); t.wrapS = THREE.RepeatWrapping; return { map: t };
}

// ---------- geometry ----------
function kit() {
  const parts = [];
  const col = new THREE.Color();
  const paint = (geo, hex, ao = 0.5) => { // vertex colour with darkening toward the ground, and box-projected texture coordinates
    const p = geo.attributes.position, n = geo.attributes.normal, c = new Float32Array(p.count * 3), uv = new Float32Array(p.count * 2); col.set(hex);
    geo.computeBoundingBox(); const y0 = geo.boundingBox.min.y, y1 = Math.max(y0 + 0.02, geo.boundingBox.max.y);
    for (let i = 0; i < p.count; i++) { const k = 1 - ao + ao * Math.min(1, (p.getY(i) - y0) / (y1 - y0) * 1.3 + 0.08); c[i * 3] = col.r * k; c[i * 3 + 1] = col.g * k; c[i * 3 + 2] = col.b * k; const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)); const u = ax > ay && ax > az ? p.getZ(i) : p.getX(i), v = ay > ax && ay > az ? p.getZ(i) : p.getY(i); uv[i * 2] = u * 0.9; uv[i * 2 + 1] = v * 0.9; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); parts.push(geo.index ? geo.toNonIndexed() : geo); return geo;
  };
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
  const put = (geo, x, y, z, ry = 0, rx = 0, rz = 0) => geo.applyMatrix4(M.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S));
  const box = (x, y, z, w, h, d, hex, ry = 0, ao = 0.5, rx = 0, rz = 0) => paint(put(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, ry, rx, rz), hex, ao);
  const cyl = (x, y, z, r, h, hex, seg = 8, rx = 0, rz = 0) => paint(put(new THREE.CylinderGeometry(r, r, h, seg), x, y + h / 2, z, 0, rx, rz), hex, 0.3);
  const rock = (x, y, z, r, hex, R) => { const g = new THREE.IcosahedronGeometry(r, 0), p = g.attributes.position; const key = new Map(); for (let i = 0; i < p.count; i++) { const k = p.getX(i).toFixed(4) + p.getY(i).toFixed(4) + p.getZ(i).toFixed(4); if (!key.has(k)) key.set(k, 0.62 + R() * 0.6); const m = key.get(k); p.setXYZ(i, p.getX(i) * m, p.getY(i) * m * 0.72, p.getZ(i) * m); } g.computeVertexNormals(); paint(put(g, x, y, z, R() * 6, R() * 2, R() * 2), hex, 0.35); };
  return { box, cyl, rock, paint, put, parts };
}
function structures() {
  const { box, cyl, rock, parts } = kit(), R = rng(42), inPoly = (p, q) => { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) if ((q[i][1] > p[1]) !== (q[j][1] > p[1]) && p[0] < (q[j][0] - q[i][0]) * (p[1] - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0]) c = !c; return c; };
  const CON = '#b4b2ad', DRY = '#d3cfc6', STEEL = '#5a6066';
  for (const w of WALLS) {
    if (w.state === 'collapsed') continue;
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), a = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]), con = w.mat === 'concrete', th = (con ? 0.46 : 0.24) * K, H = w.h * HK * (con ? 1.06 : 0.96);
    const seg = (s0, s1, y0, y1, hex = con ? CON : DRY, t = th) => { const m = (s0 + s1) / 2; box(lx(w.a[0] + Math.cos(a) * m), y0, lz(w.a[1] + Math.sin(a) * m), (s1 - s0) * K, y1 - y0, t, hex, a, y0 > 0.01 ? 0.12 : 0.5); };
    if (con && L > 5) { // window bays
      const n = Math.max(1, Math.round(L / 3)), b = L / n;
      for (let i = 0; i < n; i++) { const s = i * b, o0 = s + b * 0.26, o1 = s + b * 0.74; seg(s, o0, 0, H); seg(o1, s + b, 0, H); seg(o0, o1, 0, H * 0.34); seg(o0, o1, H * 0.82, H); seg(o0, o1, H * 0.34, H * 0.365, '#8d8b87', th * 1.5); if (R() < 0.62) { seg((o0 + o1) / 2 - 0.05, (o0 + o1) / 2 + 0.05, H * 0.36, H * 0.82, STEEL, th * 0.3); seg(o0, o1, H * 0.58, H * 0.6, STEEL, th * 0.3); } }
      seg(0, L, H, H * 1.045, '#8f8d88', th * 1.25);
    } else if (w.state === 'damaged') { // the leaning, holed partition
      const n = 9; for (let i = 0; i < n; i++) { const s = (i / n) * L, e = ((i + 1) / n) * L, hh = H * (0.35 + 0.62 * Math.abs(Math.sin(i * 1.9 + 0.4))); seg(s, e, 0, hh); }
      for (let i = 0; i < 14; i++) rock(lx(w.a[0] + (R() - 0.5) * 1.8), 0.01, lz(w.a[1] + R() * L), 0.02 + R() * 0.045, DRY, R);
    } else seg(0, L, 0, H);
  }
  // corner columns, desks, boards, door leaves
  for (const x of [44, 53, 62, 66, 75, 84]) for (const y of [30, 42, 46, 58]) { if (x > 77 && y > 49) continue; box(lx(x), 0, lz(y), 0.062, 3.2 * HK * 1.08, 0.062, '#9c9a95'); }
  for (const r of ROOMS) {
    if (r.corridor) continue; const [x0, y0, x1, y1] = r.rect, north = y0 > 44, blocked = r.id === '112';
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { if (blocked && (i > 0 || j > 0)) continue; if (R() < 0.16) continue; const x = x0 + 2 + i * 2.5 + (R() - 0.5) * 0.7, y = y0 + 2.6 + j * 2.6 + (R() - 0.5) * 0.7, ry = (R() - 0.5) * (R() < 0.3 ? 2.4 : 0.35), tip = R() < 0.16 ? 1.35 : 0;
      box(lx(x), tip ? 0.02 : 0.085, lz(y), 0.13, 0.012, 0.062, '#8a6f4e', ry, 0.1, tip); if (!tip) { box(lx(x) - 0.05, 0, lz(y), 0.008, 0.088, 0.05, STEEL, ry); box(lx(x) + 0.05, 0, lz(y), 0.008, 0.088, 0.05, STEEL, ry); } box(lx(x), 0.045, lz(y) + 0.085, 0.048, 0.008, 0.048, '#56606a', ry); box(lx(x), 0.05, lz(y) + 0.108, 0.048, 0.055, 0.007, '#56606a', ry); }
    const by = north ? y1 - 0.4 : y0 + 0.4; box(lx((x0 + x1) / 2), 0.15, lz(by), 0.34, 0.16, 0.012, '#1d2a25', 0, 0.1); box(lx((x0 + x1) / 2), 0.145, lz(by), 0.36, 0.012, 0.02, '#b7a98c', 0, 0.1);
  }
  for (const [x, y, sd] of [[48.6, 42, 1], [57.6, 42, 1], [70.6, 42, 1], [48.6, 46, -1], [57.6, 46, -1], [70.6, 46, -1]]) box(lx(x - 0.7) , 0, lz(y - sd * 0.55), 0.016, 2.1 * HK, 0.12, '#6b4a33', 0.35 * sd);
  box(lx(71.2), 0, lz(36.05), 0.42, 0.09, 0.05, '#7c6446', 0.1, 0.3, 0.5); box(lx(72.4), 0.02, lz(35.7), 0.24, 0.1, 0.04, '#8a6f4e', -0.3, 0.3, 0.9);
  // stairs in the north stairwell
  for (let i = 0; i < 9; i++) box(lx(64.8), 0, lz(50 + i * 0.6), 0.19, 0.03 + i * 0.032, 0.062, '#8c8b88');
  // fallen roof slabs and bent bars over the collapsed corner; rubble everywhere the world says rubble
  for (const [x, y, w, d, ry, rx, rz] of [[80.6, 55, 0.62, 0.42, 0.3, 0.32, 0.18], [82.6, 52.6, 0.5, 0.34, -0.5, -0.22, 0.4], [78.6, 57.4, 0.4, 0.5, 0.9, 0.4, -0.2], [84.4, 57.2, 0.46, 0.3, 0.1, 0.1, -0.5], [81.2, 59, 0.36, 0.28, 1.3, 0.5, 0.2]]) box(lx(x), 0.09, lz(y), w, 0.042, d, '#97948e', ry, 0.25, rx, rz);
  for (let i = 0; i < 26; i++) cyl(lx(78 + R() * 8), 0.08, lz(50 + R() * 9), 0.0035, 0.18 + R() * 0.2, '#6a4632', 4, (R() - 0.5) * 2.2, (R() - 0.5) * 2.2);
  for (const o of OBSTACLES) { if (o.kind !== 'rubble') continue; const bb = o.poly.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [99, 99, 0, 0]), n = o.id === 'rubble-field' ? 150 : o.id === 'rubble-ne' ? 110 : 46;
    for (let i = 0, t = 0; i < n && t < 2000; t++) { const p = [bb[0] + R() * (bb[2] - bb[0]), bb[1] + R() * (bb[3] - bb[1])]; if (!inPoly(p, o.poly)) continue; i++; const big = R() < 0.13; const c = ['#7d7a74', '#8f8a80', '#6b5f50', '#58544e', '#7b5544'][Math.floor(R() * 5)]; if (R() < 0.3) box(lx(p[0]), 0.005, lz(p[1]), 0.05 + R() * 0.12, 0.02 + R() * 0.03, 0.03 + R() * 0.07, c, R() * 6, 0.3, (R() - 0.5) * 0.9, (R() - 0.5) * 0.9); else rock(lx(p[0]), 0.01 + R() * o.h * 0.03, lz(p[1]), big ? 0.09 + R() * 0.06 : 0.02 + R() * 0.05, c, R); } }
  for (let i = 0; i < 110; i++) { const x = 86 + R() * 32, y = R() * 88; if (x > 90 && x < 114 && y > 18 && y < 48) continue; rock(lx(x), 0.0, lz(y), 0.014 + R() * 0.05, ['#6f6a62', '#5b574f', '#80786a'][i % 3], R); }
  for (let i = 0; i < 12; i++) cyl(lx(88 + R() * 26), 0.03, lz(54 + R() * 30), 0.014, 0.5 + R() * 0.5, '#4d3d2e', 6, Math.PI / 2 + (R() - 0.5) * 0.3, R() * 3);
  // buildings A and C: storeys of windows, a parapet, tanks and roof clutter
  const block = (x0, y0, x1, y1, floors, hex, hurt) => {
    const w = (x1 - x0) * K, d = (y1 - y0) * K, fh = 0.36, cx = lx((x0 + x1) / 2), cz = lz((y0 + y1) / 2); box(cx, 0, cz, w * 0.97, floors * fh, d * 0.97, '#2b2d30', 0, 0.35);
    for (let f = 0; f <= floors; f++) box(cx, f * fh - 0.018, cz, w, 0.036, d, '#8b8984', 0, 0.1);
    for (const [along, n, side] of [['x', Math.round((x1 - x0) / 2.6), 1], ['x', Math.round((x1 - x0) / 2.6), -1], ['z', Math.round((y1 - y0) / 2.6), 1], ['z', Math.round((y1 - y0) / 2.6), -1]]) for (let i = 0; i <= n; i++) for (let f = 0; f < floors; f++) { if (hurt && side < 0 && along === 'x' && i < 4 && f > 0) continue; const u = -0.5 + i / n, px = along === 'x' ? cx + u * w : cx + side * w / 2, pz = along === 'x' ? cz + side * d / 2 : cz + u * d; box(px, f * fh, pz, 0.055, fh, 0.055, hex, 0, 0.2); if (i < n) { const mx = along === 'x' ? w / n / 2 : 0, mz = along === 'x' ? 0 : d / n / 2; box(px + mx, f * fh, pz + mz, along === 'x' ? w / n : 0.03, fh * 0.34, along === 'x' ? 0.03 : d / n, hex, 0, 0.25); } }
    for (const [px, pz, bw, bd] of [[0, -d / 2, w, 0.04], [0, d / 2, w, 0.04], [-w / 2, 0, 0.04, d], [w / 2, 0, 0.04, d]]) box(cx + px, floors * fh, cz + pz, bw, 0.09, bd, hex, 0, 0.1);
    cyl(cx - w * 0.28, floors * fh + 0.05, cz - d * 0.3, 0.12, 0.2, '#24282c', 18); cyl(cx - w * 0.1, floors * fh + 0.05, cz - d * 0.34, 0.12, 0.2, '#24282c', 18); box(cx + w * 0.22, floors * fh, cz + d * 0.2, w * 0.28, 0.24, d * 0.18, '#83817c'); for (let i = 0; i < 5; i++) box(cx + (R() - 0.5) * w * 0.7, floors * fh, cz + (R() - 0.5) * d * 0.7, 0.12 + R() * 0.1, 0.05 + R() * 0.07, 0.1, '#5e6266', R()); for (let i = 0; i < 4; i++) box(cx + w * 0.1, floors * fh + 0.02, cz - d * 0.05 + i * 0.17, 0.34, 0.012, 0.13, '#141c28', 0, 0.05, 0.4);
  };
  block(8, 40, 34, 70, 3, '#a7a49d', false); block(92, 20, 112, 46, 2, '#97897a', true);
  for (let i = 0; i < 40; i++) rock(lx(90 + R() * 8), 0.02, lz(46 + R() * 4), 0.03 + R() * 0.07, '#7d7165', R);
  // staging: tent, two trucks, crates, light masts
  const truck = (x, y, ry, hex) => { const c = Math.cos(ry), s = Math.sin(ry), P = (u, v) => [lx(x) + u * c + v * s, lz(y) - u * s + v * c]; for (const [u, y0, w, h, d, hx] of [[-0.12, 0.06, 0.46, 0.22, 0.22, hex], [0.22, 0.06, 0.17, 0.18, 0.21, '#d8d6d0'], [0.265, 0.14, 0.09, 0.07, 0.2, '#12171c'], [0, 0.04, 0.66, 0.03, 0.2, '#1b1d1f']]) { const [a, b] = P(u, 0); box(a, y0, b, w, h, d, hx, ry, 0.2); } for (const u of [-0.24, -0.1, 0.22]) for (const v of [-0.11, 0.11]) { const [a, b] = P(u, v); cyl(a, 0.0, b, 0.045, 0.035, '#0d0f11', 12, Math.PI / 2); } };
  truck(14, 9, 0.1, '#7a8288'); truck(30, 18, 2.8, '#6a7066');
  for (const x of [18, 22.4]) { box(lx(x), 0, lz(22), 0.36, 0.19, 0.44, '#8e8f88', 0, 0.3); box(lx(x) - 0.1, 0.15, lz(22), 0.26, 0.016, 0.48, '#a4a59d', 0, 0, 0, 0.62); box(lx(x) + 0.1, 0.15, lz(22), 0.26, 0.016, 0.48, '#a4a59d', 0, 0, 0, -0.62); }
  for (let i = 0; i < 14; i++) box(lx(10 + R() * 20), 0, lz(14 + R() * 9), 0.06, 0.05, 0.05, ['#5d5a4f', '#42474b', '#3c4a44'][i % 3], R() * 3);
  for (const [x, y] of [[26, 8], [36, 20], [58, 20], [10, 30]]) { cyl(lx(x), 0, lz(y), 0.008, 0.85, '#70767b', 6); box(lx(x), 0.82, lz(y), 0.12, 0.05, 0.02, '#c9d2d8', 0.5, 0); }
  // utility poles with a broken line, a flood-tilted one
  for (const [x, y, t] of [[4, 34, 0], [40, 26, 0.04], [88, 14, 0.3]]) { cyl(lx(x), 0, lz(y), 0.014, 1.1, '#5b4a3a', 6, t, t * 0.6); box(lx(x), 0.96, lz(y), 0.3, 0.016, 0.016, '#5b4a3a', 0.3, 0); }
  const g = mergeGeometries(parts); g.computeBoundingSphere(); return g;
}
function roverGeo() {
  const { box, cyl, parts } = kit();
  for (const x of [-0.15, 0, 0.15]) for (const z of [-0.13, 0.13]) cyl(x, 0.02, z, 0.06, 0.05, '#17191c', 14, Math.PI / 2);
  box(0, 0.07, 0, 0.42, 0.09, 0.2, '#c3c8cc', 0, 0.2); box(0.02, 0.16, 0, 0.3, 0.05, 0.16, '#3a4046', 0, 0.1); box(0.17, 0.12, 0, 0.1, 0.05, 0.19, '#22262a', 0, 0.1);
  cyl(-0.12, 0.2, 0.06, 0.006, 0.3, '#9aa2a8', 6); cyl(-0.12, 0.2, -0.06, 0.006, 0.3, '#9aa2a8', 6); cyl(0.08, 0.2, 0, 0.012, 0.12, '#9aa2a8', 8); box(0.08, 0.31, 0, 0.06, 0.05, 0.1, '#15181b', 0, 0);
  return mergeGeometries(parts);
}
function droneGeo() {
  const { box, cyl, parts } = kit(); box(0, 0, 0, 0.12, 0.035, 0.09, '#2a2e33', 0, 0); box(0, -0.03, 0, 0.04, 0.03, 0.04, '#0e1012', 0, 0);
  for (const [x, z] of [[0.14, 0.12], [-0.14, 0.12], [0.14, -0.12], [-0.14, -0.12]]) { box(x / 2, 0.012, z / 2, 0.2, 0.012, 0.016, '#3c4249', -Math.atan2(z, x), 0); cyl(x, 0.02, z, 0.085, 0.004, '#4a5159', 20); cyl(x, 0, z, 0.016, 0.03, '#14171a', 8); }
  return mergeGeometries(parts);
}
function teamGeo() {
  const parts = [], { paint, put } = (() => { const k = kit(); k.parts.length = 0; return { paint: (g, c) => { k.paint(g, c, 0.25); }, put: k.put, k, parts: k.parts }; })(), K2 = kit();
  for (const [x, z] of [[0, 0], [0.14, 0.1], [-0.13, 0.11]]) { K2.paint(K2.put(new THREE.CapsuleGeometry(0.036, 0.12, 3, 8), x, 0.14, z), '#39506b', 0.3); K2.paint(K2.put(new THREE.SphereGeometry(0.032, 10, 8), x, 0.27, z), '#e7eaec', 0); }
  return mergeGeometries(K2.parts);
}
function personGeo() { // a figure on the ground
  const K2 = kit(), P = (g, x, y, z, ry = 0, rx = 0, rz = 0) => K2.paint(K2.put(g, x, y, z, ry, rx, rz), '#ffffff', 0);
  P(new THREE.SphereGeometry(0.048, 12, 10), -0.2, 0.06, 0); P(new THREE.CapsuleGeometry(0.056, 0.16, 4, 10), -0.06, 0.055, 0, 0, 0, Math.PI / 2); P(new THREE.CapsuleGeometry(0.03, 0.16, 3, 8), 0.12, 0.05, 0.045, 0.2, 0, Math.PI / 2); P(new THREE.CapsuleGeometry(0.03, 0.14, 3, 8), 0.11, 0.06, -0.05, -0.5, 0, Math.PI / 2); P(new THREE.CapsuleGeometry(0.02, 0.13, 3, 8), -0.06, 0.05, 0.1, 0.8, 0, Math.PI / 2);
  return mergeGeometries(K2.parts);
}

// All instanced meshes for n worlds. Each instance carries: lum (how bright the world is) and dis (0..1, how far it has formed).
export async function createIslands(renderer, n) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const gm = await groundMaps(aniso), cm = concreteMaps(aniso), sm = strataMap(aniso); await frame();
  const lum = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1), dis = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  lum.setUsage(THREE.DynamicDrawUsage); dis.setUsage(THREE.DynamicDrawUsage);
  const patch = (mat) => { mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLum; attribute float aDis; varying float vLum; varying float vDis; varying vec3 vLp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLum = aLum; vDis = aDis; vLp = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLum; varying float vDis; varying vec3 vLp;\nfloat h31(vec3 p){ p = fract(p * vec3(127.1, 311.7, 74.7)); p += dot(p, p.yzx + 33.3); return fract((p.x + p.y) * p.z); }')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nfloat dEdge = 0.0; if (vDis < 0.999) { float f = 0.55 * h31(floor(vLp * 9.0)) + 0.25 * h31(floor(vLp * 31.0)) + 0.2 * clamp((vLp.x + 6.0) / 12.0, 0.0, 1.0); if (f > vDis) discard; dEdge = smoothstep(0.1, 0.0, vDis - f); }')
      .replace('#include <opaque_fragment>', 'outgoingLight = outgoingLight * vLum + vec3(0.5, 0.75, 1.0) * dEdge * 0.9;\n#include <opaque_fragment>');
  }; return mat; };
  const mk = (geo, mat) => { geo.setAttribute('aLum', lum); geo.setAttribute('aDis', dis); const m = new THREE.InstancedMesh(geo, patch(mat), n); m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); return m; };
  const W = SITE.w * K, D = SITE.h * K, T = 0.62;
  const top = new THREE.PlaneGeometry(W, D, 1, 1); top.rotateX(-Math.PI / 2);
  const side = new THREE.BoxGeometry(W, T, D, 1, 1, 1); side.translate(0, -T / 2 - 0.004, 0);
  { const uv = side.attributes.uv, nn = side.attributes.normal, p = side.attributes.position; for (let i = 0; i < uv.count; i++) { const u = Math.abs(nn.getX(i)) > 0.5 ? p.getZ(i) : p.getX(i); if (Math.abs(nn.getY(i)) > 0.5) uv.setXY(i, 0.5, 0.02); else uv.setXY(i, u / 12 + 0.5, (p.getY(i) + T) / T); } }
  const mats = [
    new THREE.MeshStandardMaterial({ ...gm, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1.15, 1.15), envMapIntensity: 0.9 }),
    new THREE.MeshStandardMaterial({ ...sm, roughness: 0.96, metalness: 0 }),
    new THREE.MeshStandardMaterial({ map: cm.map, normalMap: cm.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), vertexColors: true, roughness: 0.88, metalness: 0 }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35 }),
  ];
  const ground = mk(top, mats[0]), sides = mk(side, mats[1]), build = mk(structures(), mats[2]), rover = mk(roverGeo(), mats[3]), drone = mk(droneGeo(), mats[3].clone()), team = mk(teamGeo(), mats[3].clone());
  const pm = new THREE.MeshBasicMaterial({ toneMapped: false }), people = new THREE.InstancedMesh(personGeo(), pm, n * 3); people.frustumCulled = false; people.instanceMatrix.setUsage(THREE.DynamicDrawUsage); for (let i = 0; i < n * 3; i++) people.setColorAt(i, new THREE.Color(0, 0, 0));
  return { ground, sides, build, rover, drone, team, people, lum, dis, all: [ground, sides, build, rover, drone, team, people], dispose() { for (const t of [gm, cm, sm]) Object.values(t).forEach((x) => x.dispose()); for (const m of [ground, sides, build, rover, drone, team, people]) { m.geometry.dispose(); m.material.dispose(); m.dispose(); } } };
}
