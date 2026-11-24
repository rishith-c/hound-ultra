// Materials and generated textures for the rover. Everything is drawn in code; nothing is downloaded.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5 | 0), ((s ^ (s >>> 14)) >>> 0) / 4294967296); }
export function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
export function texture(c, { srgb = false, repeat = 0 } = {}) {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return t;
}
function noise(w, h, fn) {
  return canvas(w, h, (c) => { const im = c.createImageData(w, h), r = rng(7); for (let i = 0; i < w * h; i++) { const v = fn(i % w, (i / w) | 0, r); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; } c.putImageData(im, 0, 0); });
}
// streaks along u: what a brush or an extrusion die leaves behind
function brushedCanvas() {
  const rows = 512, r0 = rng(3), base = Array.from({ length: rows }, () => r0()), phase = Array.from({ length: rows }, () => r0() * 6.28);
  return noise(512, rows, (x, y, r) => 128 + 70 * (base[y] - .5) + 26 * Math.sin(x / 512 * 6.283 * 2 + phase[y]) * (base[(y * 7) % rows] - .5) + 18 * (r() - .5));
}
function tapeCanvas() { // creases of tape pulled round a corner
  return canvas(512, 512, (c) => { c.fillStyle = '#808080'; c.fillRect(0, 0, 512, 512); const r = rng(11);
    for (let i = 0; i < 90; i++) { c.strokeStyle = r() > .5 ? 'rgba(255,255,255,.20)' : 'rgba(0,0,0,.22)'; c.lineWidth = .6 + r() * 3; c.beginPath(); let x = r() * 512, y = r() * 512; c.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (r() - .5) * 170; y += (r() - .3) * 70; c.lineTo(x, y); } c.stroke(); } });
}

export function makeMaterials() {
  const brushed = texture(brushedCanvas(), { repeat: 2 }), grain = texture(noise(256, 256, (x, y, r) => 108 + 60 * r()), { repeat: 6 });
  const paper = texture(noise(512, 512, (x, y, r) => 118 + 22 * r() + 10 * Math.sin(x * .07) * Math.sin(y * .053)), { repeat: 3 });
  const tape = texture(tapeCanvas(), { repeat: 1.6 });
  const P = (o) => new THREE.MeshPhysicalMaterial(o);
  return {
    anodised: P({ color: 0x35393f, metalness: .95, roughness: .30, roughnessMap: null, bumpMap: brushed, bumpScale: .35, anisotropy: .72, envMapIntensity: 1.25 }),
    alu: P({ color: 0xc9ccd0, metalness: 1, roughness: .33, bumpMap: brushed, bumpScale: .30, anisotropy: .65 }),
    aluDark: P({ color: 0x4a4e54, metalness: 1, roughness: .36, bumpMap: brushed, bumpScale: .28, anisotropy: .6 }),
    steel: P({ color: 0xb4b6b9, metalness: 1, roughness: .28, bumpMap: grain, bumpScale: .15 }),
    zinc: P({ color: 0x83878b, metalness: 1, roughness: .38, bumpMap: brushed, bumpScale: .22, anisotropy: .4 }),
    lam: P({ color: 0x0f1113, metalness: .55, roughness: .52, bumpMap: brushed, bumpScale: .8 }),
    brass: P({ color: 0xd8a94a, metalness: 1, roughness: .26 }),
    rubber: P({ color: 0x121315, metalness: 0, roughness: .44, bumpMap: grain, bumpScale: .18, specularIntensity: .7 }),
    plastic: P({ color: 0x0d0e10, metalness: 0, roughness: .42, bumpMap: grain, bumpScale: .25 }),
    gloss: P({ color: 0x08090a, metalness: 0, roughness: .16, clearcoat: 1, clearcoatRoughness: .06 }),
    epoxy: P({ color: 0x101214, metalness: 0, roughness: .55, bumpMap: grain, bumpScale: .2 }),
    white: P({ color: 0xb7b4ad, metalness: 0, roughness: .5 }),
    foam: P({ color: 0xc2c0bb, metalness: 0, envMapIntensity: .45, specularIntensity: .25, roughness: .78, bumpMap: paper, bumpScale: .5 }),
    tape: P({ color: 0x7c0b11, metalness: 0, envMapIntensity: .55, roughness: .5, bumpMap: tape, bumpScale: 2.2, specularIntensity: .5 }),
    silicone: P({ color: 0x0a0a0b, metalness: 0, roughness: .5, side: THREE.DoubleSide }),
    siliconeRed: P({ color: 0x7e0b10, metalness: 0, roughness: .45, side: THREE.DoubleSide }),
    pcbEdge: P({ color: 0x2a3c24, metalness: 0, roughness: .6 }),
    terminal: P({ color: 0x1c6a3c, metalness: 0, roughness: .45 }),
    glass: P({ color: 0x05070a, metalness: 0, roughness: .05, clearcoat: 1, clearcoatRoughness: .02, reflectivity: .8 }),
    printed: P({ color: 0x35393f, metalness: 0, roughness: .62, bumpMap: brushed, bumpScale: .7 }),
    tile: P({ color: 0xb6bac0, metalness: 0, roughness: .58, bumpMap: brushed, bumpScale: .5 }),
    cad: P({ color: 0x8f969e, metalness: .2, roughness: .5 }), cadDark: P({ color: 0x1a1c1f, metalness: .2, roughness: .55 }),
    cadGreen: P({ color: 0x1b5a3c, metalness: 0, roughness: .55 }), cadRed: P({ color: 0x8c1d18, metalness: 0, roughness: .5 }), cadBlue: P({ color: 0x1f3f7a, metalness: .3, roughness: .5 }),
  };
}

// ── geometry helpers. All in CAD axes (x forward, y left, z up), metres. ──
export function boxUV(g) { // planar map by the face normal, 1 unit = 0.1 m, so brushed grain keeps its true size
  if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    let ax = 0, ay = 0, az = 0; for (let k = 0; k < 3; k++) { ax += Math.abs(n.getX(i + k)); ay += Math.abs(n.getY(i + k)); az += Math.abs(n.getZ(i + k)); }
    for (let k = 0; k < 3; k++) { const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k); uv[(i + k) * 2] = (ax > ay && ax > az ? y : x) * 10; uv[(i + k) * 2 + 1] = (az >= ax && az >= ay ? y : z) * 10; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  g.morphAttributes = {}; return g;
}
export const rbox = (w, d, h, r = .0006, seg = 2) => boxUV(new RoundedBoxGeometry(w, d, h, seg, Math.min(r, w / 2.01, d / 2.01, h / 2.01)));
export const cyl = (r0, r1, len, seg = 28) => boxUV(new THREE.CylinderGeometry(r0, r1, len, seg).rotateX(Math.PI / 2)); // axis z
export function extrude(points, depth, { bevel = .0004, holes = [], curve = 10 } = {}) { // axis z, centred
  const s = new THREE.Shape(points.map((p) => new THREE.Vector2(p[0], p[1])));
  for (const [x, y, r, len = 0] of holes) { const q = new THREE.Path(); if (len) { q.moveTo(x - len / 2, y - r); q.lineTo(x + len / 2, y - r); q.absarc(x + len / 2, y, r, -Math.PI / 2, Math.PI / 2, false); q.lineTo(x - len / 2, y + r); q.absarc(x - len / 2, y, r, Math.PI / 2, Math.PI * 1.5, false); } else q.absarc(x, y, r, 0, Math.PI * 2, true); s.holes.push(q); }
  const g = new THREE.ExtrudeGeometry(s, { depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments: curve });
  g.translate(0, 0, -(depth - bevel * 2) / 2); return boxUV(g);
}
export const chamfered = (w, h, c) => { const x = w / 2, y = h / 2; return [[-x + c, -y], [x - c, -y], [x, -y + c], [x, y - c], [x - c, y], [-x + c, y], [-x, y - c], [-x, -y + c]]; };

// A part collects geometry per material and becomes one group with one mesh per material.
export class Part {
  constructor(id) { this.id = id; this.buckets = new Map(); }
  add(mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ')).setPosition(x, y, z);
    return this.addM(mat, geo, m);
  }
  addM(mat, geo, m) { const g = geo.clone(); g.applyMatrix4(m); if (!this.buckets.has(mat)) this.buckets.set(mat, []); this.buckets.get(mat).push(g); return this; }
  build(shadow = true) {
    const grp = new THREE.Group(); grp.name = this.id;
    for (const [mat, list] of this.buckets) { const g = list.length === 1 ? list[0] : mergeGeometries(list, false); if (!g) throw new Error('rover: merge failed in ' + this.id); if (list.length > 1) for (const l of list) l.dispose(); const me = new THREE.Mesh(g, mat); me.castShadow = me.receiveShadow = shadow; me.userData.part = this.id; me.userData.mat = mat; grp.add(me); }
    return grp;
  }
}
