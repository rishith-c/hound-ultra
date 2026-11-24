// Circuit boards at their datasheet outline sizes, with drawn solder mask, traces, pads and silkscreen.
// Positions of the big parts follow the real boards; the small passives are placed by a seeded generator.
import * as THREE from 'three';
import { Part, rbox, cyl, canvas, texture, rng, extrude } from './materials.js';
const mm = .001, T = 1.6 * mm;

// draws the copper side: returns { map, pbr } canvases (pbr: green = roughness, blue = metalness)
function face(w, d, { mask, seed, text = [], pads = [], vias = 60, traces = 46, extra }) {
  const s = Math.min(16, 1400 / w), W = Math.round(w * s), H = Math.round(d * s), r = rng(seed);
  const pts = []; for (let i = 0; i < traces; i++) { const x = r() * W, y = r() * H; const pth = [[x, y]]; let a = Math.floor(r() * 8) * Math.PI / 4, cx = x, cy = y; for (let k = 0; k < 3 + r() * 4; k++) { const l = (2 + r() * 9) * s; cx += Math.cos(a) * l; cy += Math.sin(a) * l; pth.push([cx, cy]); a += (r() > .5 ? 1 : -1) * Math.PI / 4; } pts.push([pth, (r() > .8 ? .7 : .28) * s, 1 + Math.floor(r() * 5)]); }
  const vs = Array.from({ length: vias }, () => [r() * W, r() * H]);
  const paint = (c, kind) => {
    const col = kind === 'map';
    c.fillStyle = col ? mask[0] : 'rgb(0,150,0)'; c.fillRect(0, 0, W, H);
    if (col) { c.globalAlpha = .5; c.fillStyle = mask[1]; for (let i = 0; i < 5; i++) c.fillRect((r() * .8) * W, (r() * .8) * H, W * .3, H * .28); c.globalAlpha = 1; }
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const [pth, lw, n] of pts) for (let k = 0; k < n; k++) { c.strokeStyle = col ? mask[1] : 'rgb(0,88,0)'; c.lineWidth = lw; c.beginPath(); pth.forEach(([x, y], i) => c[i ? 'lineTo' : 'moveTo'](x + k * lw * 2.1, y + k * lw * 1.2)); c.stroke(); }
    for (const [x, y] of vs) { c.fillStyle = col ? '#c9a35a' : 'rgb(0,70,255)'; c.beginPath(); c.arc(x, y, .32 * s, 0, 7); c.fill(); c.fillStyle = col ? '#0a0f0c' : 'rgb(0,120,0)'; c.beginPath(); c.arc(x, y, .15 * s, 0, 7); c.fill(); }
    for (const [x, y, pw, ph, round] of pads) { c.fillStyle = col ? '#d4a94e' : 'rgb(0,64,255)'; const X = x * s, Y = (d - y) * s; c.beginPath(); if (round) c.arc(X, Y, pw * s / 2, 0, 7); else c.rect(X - pw * s / 2, Y - ph * s / 2, pw * s, ph * s); c.fill(); }
    if (col) { c.fillStyle = '#e9ece6'; c.strokeStyle = '#e9ece6'; c.lineWidth = .13 * s; for (const [t, x, y, size, rot = 0] of text) { c.save(); c.translate(x * s, (d - y) * s); c.rotate(rot); c.font = '600 ' + size * s + 'px "Geist Mono", monospace'; c.fillText(t, 0, 0); c.restore(); } for (let i = 0; i < 34; i++) c.strokeRect(r() * W, r() * H, (1 + r() * 2.2) * s, (.6 + r()) * s); }
    if (extra) extra(c, s, kind, W, H);
  };
  return { map: texture(canvas(W, H, (c) => paint(c, 'map')), { srgb: true }), pbr: texture(canvas(W, H, (c) => paint(c, 'pbr'))) };
}

// comps: [material, x, y, width, depth, height, radius?, z?] with x,y in mm from the board's lower-left corner
function board(id, M, { w, d, spec, comps = [], pins = [], passives = 40, keep = [], seed = 1, holes = [] }) {
  const P = new Part(id), f = face(w, d, { seed, ...spec });
  const top = new THREE.MeshPhysicalMaterial({ map: f.map, roughnessMap: f.pbr, metalnessMap: f.pbr, roughness: 1, metalness: 1, specularIntensity: .4 });
  P.add(M.pcbEdge, rbox(w * mm, d * mm, T, .0002, 1), 0, 0, T / 2);
  const pl = new THREE.PlaneGeometry(w * mm - .0003, d * mm - .0003).toNonIndexed(); P.add(top, pl, 0, 0, T + .00005);
  const at = (x, y) => [(x - w / 2) * mm, (y - d / 2) * mm];
  for (const [mat, x, y, cw, cd, ch, rad = .25, z = 0] of comps) { const [X, Y] = at(x, y); P.add(M[mat] || mat, rbox(cw * mm, cd * mm, ch * mm, rad * mm, 1), X, Y, T + (z + ch / 2) * mm); }
  for (const [x, y, n, rows, pitch, vertical, h = 8.5, base = 2.5] of pins) for (let k = 0; k < n; k++) for (let q = 0; q < rows; q++) { const [X, Y] = at(x + (vertical ? q : k) * pitch, y + (vertical ? k : q) * pitch); if (base) P.add(M.plastic, rbox(2.4 * mm, 2.4 * mm, base * mm, .0003, 1), X, Y, T + base * mm / 2); P.add(M.brass, rbox(.62 * mm, .62 * mm, h * mm, .0001, 1), X, Y, T + h * mm / 2); }
  const r = rng(seed * 31 + 5); let tries = 0;
  for (let k = 0; k < passives && tries < 900; tries++) { const x = 3 + r() * (w - 6), y = 3 + r() * (d - 6); if ([...comps, ...keep].some((c) => { const [cx, cy, cw, cd] = typeof c[0] === 'number' ? c : c.slice(1); return Math.abs(x - cx) < cw / 2 + 1 && Math.abs(y - cy) < cd / 2 + 1; })) continue; const big = r() > .86, [X, Y] = at(x, y), rot = r() > .5 ? Math.PI / 2 : 0, L = big ? 2 : 1, B = big ? 1.25 : .5, H = big ? .9 : .4; P.add(r() > .45 ? M.epoxy : M.zinc, rbox(L * mm, B * mm, H * mm, .00008, 1), X, Y, T + H * mm / 2, 0, 0, rot); k++; }
  for (const [x, y, dia] of holes) { const [X, Y] = at(x, y); P.add(M.brass, new THREE.RingGeometry(dia / 2 * mm, (dia / 2 + 1.5) * mm, 24).toNonIndexed(), X, Y, T + .0002); P.add(M.plastic, new THREE.CircleGeometry(dia / 2 * mm, 24).toNonIndexed(), X, Y, T + .00015); }
  P.w = w * mm; P.d = d * mm; return P;
}
const green = ['#0d4a30', '#12633f'], teal = ['#07565c', '#0b7076'], red = ['#7d1216', '#9c1c20'], purple = ['#3a1656', '#4f2272'], black = ['#0b0d0f', '#171b1f'], blue = ['#0c2d5e', '#123f80'];

export function pi4(M) {
  return board('pi', M, { w: 85, d: 56, seed: 41, passives: 120, holes: [[3.5, 3.5, 2.7], [61.5, 3.5, 2.7], [3.5, 52.5, 2.7], [61.5, 52.5, 2.7]],
    spec: { mask: green, traces: 120, vias: 260, text: [['Raspberry Pi 4', 9, 42.5, 2.6], ['GPIO', 2.2, 47.4, 1.4], ['HDMI0', 22, 7.2, 1.1], ['HDMI1', 36, 7.2, 1.1], ['CAMERA', 44.2, 24, 1.1, -Math.PI / 2], ['DISPLAY', 6.2, 18, 1.1, -Math.PI / 2]] },
    comps: [['steel', 29.3, 32.5, 15, 15, 2.2, .5], ['epoxy', 46, 32.5, 10.5, 15, .9], ['steel', 12, 39, 12, 9.5, 1.5, .4], ['steel', 77.5, 9, 17.5, 13.2, 16, .5], ['steel', 77.5, 27, 17.5, 13.2, 16, .5], ['zinc', 75.5, 45.8, 21, 16, 13.5, .5], ['steel', 11.2, 2.6, 9, 7.4, 3.2, 1.2], ['steel', 26, 2.6, 7, 7.6, 3.2, .8], ['steel', 39.5, 2.6, 7, 7.6, 3.2, .8], ['plastic', 54, 6, 7, 14, 6, .4], ['white', 46.5, 12.5, 2.6, 22, 5.4], ['white', 3.6, 28, 2.6, 22, 5.4], ['epoxy', 60, 30, 8, 8, .9], ['epoxy', 20, 14, 5, 5, .9], ['epoxy', 33, 18, 4, 4, .9],
      ['plastic', 86.3, 9, .4, 11.6, 5.6, .1, 1.3], ['plastic', 86.3, 9, .4, 11.6, 5.6, .1, 9.2], ['plastic', 86.3, 27, .4, 11.6, 5.6, .1, 1.3], ['plastic', 86.3, 27, .4, 11.6, 5.6, .1, 9.2], ['plastic', 86.1, 45.8, .4, 11.8, 8.5, .1, 2]],
    pins: [[8.4, 51.2, 20, 2, 2.54, false]], keep: [[32.5, 52.5, 53, 7]] });
}
export function unoR4(M) {
  const leds = []; for (let i = 0; i < 12; i++) for (let k = 0; k < 8; k++) leds.push(['white', 39 + i * 1.75, 18 + k * 1.75, .8, .8, .4, .05]);
  return board('uno', M, { w: 68.6, d: 53.3, seed: 17, passives: 70, holes: [[14, 2.5, 3.2], [15.3, 50.7, 3.2], [66, 7.6, 3.2], [66, 35.5, 3.2]],
    spec: { mask: teal, traces: 80, vias: 150, text: [['UNO R4 WiFi', 33, 34, 3], ['DIGITAL', 40, 46.6, 1.6], ['POWER', 29, 5.8, 1.5], ['ANALOG IN', 49, 5.8, 1.5]] },
    comps: [['steel', 4, 38, 9, 9, 3.2, 1.2], ['plastic', 6.5, 8, 14, 9, 11, .5], ['steel', 22, 23, 16, 18, 3, .4], ['epoxy', 33, 24, 7, 7, 1.4], ['plastic', 36, 2.6, 20.4, 2.5, 8.5], ['plastic', 57.6, 2.6, 15.3, 2.5, 8.5], ['plastic', 30, 50.8, 25.4, 2.5, 8.5], ['plastic', 54.6, 50.8, 20.4, 2.5, 8.5], ['epoxy', 13, 22, 5, 5, 1.2], ['steel', 8, 48.5, 4, 4, 1.8], ...leds], keep: [[49, 24, 24, 16]] });
}
export function shield(M) {
  const c = []; for (const x of [13, 30, 47, 64 - 2.5]) for (const s of [-1, 1]) c.push(['plastic', x, 28 + s * 6.4, 2.5, 20.4, 8.4].map((v, i) => i === 1 ? x + s * 6.35 : i === 2 ? 28 : v));
  return board('shield', M, { w: 68.6, d: 53.3, seed: 23, passives: 22, spec: { mask: red, traces: 60, vias: 120, text: [['X', 12, 42, 3], ['Y', 29, 42, 3], ['Z', 46, 42, 3], ['A', 60, 42, 3], ['12-36V', 4, 8, 1.8]] },
    comps: [...c, ['terminal', 5.5, 5.4, 10.2, 8, 10, .4], ['steel', 3, 5.4, 4, 4, 10.3, 1], ['steel', 8, 5.4, 4, 4, 10.3, 1]], pins: [[22, 3.2, 12, 1, 2.54, false, 8, 2.4], [20, 48.5, 14, 2, 2.54, false, 8, 2.4]] });
}
export function driver(M, k) {
  return board('driver' + k, M, { w: 15.3, d: 20.4, seed: 60 + k, passives: 9, spec: { mask: purple, traces: 14, vias: 24, text: [['DRV8825', 3.6, 1.4, 1.7]] }, comps: [['epoxy', 7.6, 11.5, 4.6, 6.6, 1], ['zinc', 12, 4, 2.6, 2.6, 1.3, 1], ['epoxy', 4, 4.4, 2, 3.4, .8]] });
}
export function heatsink(M, k) { const P = new Part('sink' + k); P.add(M.aluDark, rbox(.009, .009, .0016, .0002, 1), 0, 0, .0008); for (let i = 0; i < 5; i++) P.add(M.aluDark, rbox(.0008, .009, .0052, .0001, 1), (i - 2) * .002, 0, .0042); return P; }
export function esp32(M) {
  return board('radio', M, { w: 63, d: 25.4, seed: 71, passives: 30, keep: [[52, 12.7, 26, 18]],
    spec: { mask: black, traces: 34, vias: 60, text: [['ESP32-S3', 23, 12, 2.2], ['RST', 8, 18, 1.2], ['BOOT', 8, 7, 1.2]], extra: (c, s, kind) => { c.strokeStyle = kind === 'map' ? '#d4a94e' : 'rgb(0,60,255)'; c.lineWidth = .6 * s; c.beginPath(); let x = 57.4; c.moveTo(x * s, 5 * s); for (let k = 0; k < 6; k++) { c.lineTo(x * s, (5 + k * 2.6 + 1.3) * s); x = k % 2 ? 57.4 : 61.6; c.lineTo(x * s, (5 + k * 2.6 + 1.3) * s); c.lineTo(x * s, (5 + (k + 1) * 2.6) * s); } c.stroke(); } },
    comps: [['steel', 47, 12.7, 17, 16, 3, .5], ['steel', 3.4, 6.4, 7.4, 9, 3.2, 1.2], ['steel', 3.4, 19, 7.4, 9, 3.2, 1.2], ['epoxy', 22, 18, 5, 5, .9], ['epoxy', 30, 7, 4, 4, .9], ['white', 14, 7.5, 3.4, 3.4, 1.6, .3], ['white', 14, 18, 3.4, 3.4, 1.6, .3], ['white', 34, 18.5, 3.4, 3.4, 1.4, .2]],
    pins: [[6, 1.4, 20, 1, 2.54, false, 6, 2.4], [6, 24, 20, 1, 2.54, false, 6, 2.4]] });
}
export function ld2450(M) { // the antenna side: rows of patches, as on the real module
  const pads = []; for (let c = 0; c < 3; c++) for (let k = 0; k < 4; k++) pads.push([21 + c * 7.2, 2.6 + k * 3.3, 4.4, 2.1]); for (let k = 0; k < 4; k++) pads.push([14, 2.6 + k * 3.3, 3.6, 2.1]);
  return board('radar', M, { w: 43, d: 15, seed: 83, passives: 6, keep: [[27, 7.5, 34, 15]], spec: { mask: green, traces: 8, vias: 46, pads, text: [['LD2450', 1.6, 12.4, 1.8]] }, comps: [['white', 3, 6, 4, 8, 3.2, .2]] });
}
export function mlx(M) { const P = board('thermal', M, { w: 26, d: 18, seed: 97, passives: 9, spec: { mask: blue, traces: 16, vias: 24, text: [['MLX90640', 2, 1.6, 1.6]] }, comps: [['white', 3, 9, 3, 10, 3, .2]] }); P.add(M.steel, cyl(.0046, .0046, .0052, 36), .003, 0, T + .0026); P.add(M.steel, cyl(.0052, .0052, .0008, 36), .003, 0, T + .0004); P.add(M.glass, cyl(.0027, .0027, .0003, 28), .003, 0, T + .0054); return P; }
export function tof(M) { return board('tof', M, { w: 25, d: 11, seed: 101, passives: 8, spec: { mask: blue, traces: 10, vias: 16, text: [['VL53L1X', 2, 1.6, 1.5]] }, comps: [['epoxy', 12.5, 5.5, 4.9, 2.5, 1.5]] }); }
