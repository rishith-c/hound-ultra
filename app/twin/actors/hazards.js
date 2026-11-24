// Hazard zones: hatched ground decals with a low edge curtain, and the arrival of a new hazard (dust, falling debris).
// Driven by world.HAZARDS (static) and state.hazards (added during the mission). Everything here is simulated.
import { palette, Y, damp, clamp, stateWatcher, polyGeometry, polyCentroid, disposeTree, decalMaterial, mulberry32, dist2 } from './common.js';

const MAXP = 10;
const KIND_LABEL = { collapse: ['Collapse risk', 'no entry'], mud: ['Deep mud', ''], slope: ['Unstable slope', ''], gas: ['Possible gas leak', 'concept sensor'] };

const VERT = /* glsl */ `
varying vec2 vW; varying vec2 vUv;
void main() { vW = uv; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const POLY_FN = /* glsl */ `
uniform vec2 uPts[${MAXP}]; uniform int uN;
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h); }
float edgeDist(vec2 p) { float d = 1e5; for (int i = 0; i < ${MAXP}; i++) { if (i >= uN) break; int j = (i + 1 == uN) ? 0 : i + 1; d = min(d, sdSeg(p, uPts[i], uPts[j])); } return d; }
float insidePoly(vec2 p) { bool c = false; for (int i = 0; i < ${MAXP}; i++) { if (i >= uN) break; int j = (i + 1 == uN) ? 0 : i + 1; vec2 a = uPts[i], b = uPts[j];
  if (((a.y > p.y) != (b.y > p.y)) && (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)) c = !c; } return c ? 1.0 : 0.0; }`;

// The zone itself: world-space diagonal hatch, an edge glow that fades toward the middle, and a border.
const FILL_FRAG = /* glsl */ `
${POLY_FN}
uniform vec3 uColor; uniform float uBlock, uWipe, uSel, uOpacity; uniform vec2 uDiag;
varying vec2 vW;
void main() {
  float d = edgeDist(vW), wd = fwidth(d);
  float period = mix(1.7, 0.85, uBlock), duty = mix(0.13, 0.34, uBlock);
  float h = (vW.x + vW.y) * 0.70710678 / period, wh = fwidth(h);
  float stripe = 1.0 - smoothstep(duty * 0.5 - wh, duty * 0.5 + wh, abs(fract(h) - 0.5));
  stripe = mix(stripe, duty, smoothstep(0.3, 0.7, wh));                      // far away: the average, not shimmer
  float inner = exp(-d / mix(3.2, 7.0, uBlock));
  float hatch = stripe * mix(mix(0.05, 0.3, inner), mix(0.3, 0.62, inner), uBlock);
  float glow = exp(-d / 1.3) * mix(0.1, 0.26, uBlock) + mix(0.012, 0.05, uBlock);
  float lw = mix(0.06, 0.085, uBlock);
  float border = (1.0 - smoothstep(lw - wd, lw + wd, d)) * mix(0.7, 1.0, uBlock);
  float second = smoothstep(0.2 - wd, 0.2 + wd, d) * (1.0 - smoothstep(0.26 - wd, 0.26 + wd, d)) * uBlock * 0.9;
  float a = max(max(border, second), hatch + glow);
  float k = (vW.x + vW.y - uDiag.x) / max(uDiag.y - uDiag.x, 1e-3);
  a *= 1.0 - smoothstep(uWipe * 1.15 - 0.15, uWipe * 1.15, k);
  a *= uOpacity * (1.0 + uSel * 0.55);
  gl_FragColor = vec4(uColor * (1.0 + uSel * 0.35 + max(border, second) * 0.15), clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

// The low curtain on the perimeter: fades upward, with small dashes travelling along it.
const CURTAIN_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uT, uBlock, uWipe, uSel;
varying vec2 vUv;
void main() {
  float s = vUv.x, v = vUv.y;
  float base = pow(1.0 - v, 2.4) * mix(0.16, 0.27, uBlock);
  float q = (s - uT * 0.45) / mix(2.4, 1.5, uBlock), wq = fwidth(q);
  float dash = 1.0 - smoothstep(0.14 - wq, 0.14 + wq, abs(fract(q) - 0.5));
  float row = smoothstep(0.3, 0.42, v) * (1.0 - smoothstep(0.5, 0.62, v));
  float a = (base + dash * row * mix(0.34, 0.6, uBlock)) * uWipe * (1.0 + uSel * 0.6);
  gl_FragColor = vec4(uColor * (1.0 + uSel * 0.3), clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

// The gas zone has no hard curtain: a faint haze that drifts slowly.
const HAZE_FRAG = /* glsl */ `
${POLY_FN}
uniform vec3 uColor; uniform float uT, uSel, uSeed;
varying vec2 vW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float d = edgeDist(vW), ins = insidePoly(vW);
  float mask = mix(exp(-d / 0.55), 1.0, ins) * mix(1.0, smoothstep(0.0, 1.4, d) * 0.6 + 0.4, ins);
  vec2 p = vW * 0.55 + uSeed + vec2(uT * 0.05, uT * 0.022);
  float n = noise(p) * 0.55 + noise(p * 2.1 - uT * 0.03) * 0.3 + noise(p * 4.3 + uT * 0.04) * 0.15;
  float a = mask * smoothstep(0.22, 0.85, n) * 0.2 * (1.0 + uSel * 0.5);
  gl_FragColor = vec4(mix(uColor, vec3(0.62, 0.6, 0.6), 0.5), a);
  #include <colorspace_fragment>
}`;

const DUST_VERT = /* glsl */ `
attribute vec3 aVel; attribute vec2 aSeed;
uniform float uAge, uPx;
varying float vA;
void main() {
  float age = uAge - aSeed.x * 0.8, life = 1.6;
  float k = clamp(age / life, 0.0, 1.0);
  vec3 p = position + aVel * (1.0 - exp(-2.4 * max(age, 0.0))) / 2.4;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.7 + 2.3 * k) * (0.6 + aSeed.y * 0.8) * uPx / max(-mv.z, 0.1);
  vA = age < 0.0 ? 0.0 : smoothstep(0.0, 0.12, k) * pow(1.0 - k, 1.6) * 0.34;
}`;
const DUST_FRAG = /* glsl */ `
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = vA * exp(-r * r * 3.2) * (1.0 - smoothstep(0.85, 1.0, r));
  if (a < 0.003) discard;
  gl_FragColor = vec4(vec3(0.33, 0.29, 0.25), a);
  #include <colorspace_fragment>
}`;

function inPoly(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function hashId(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function shortName(name) {
  let s = String(name || 'New hazard').replace(/\s*\(.*?\)/g, '').replace(/\s*:\s*/, ' · ');
  if (s.length > 26) { const cut = s.lastIndexOf(' ', 26); s = s.slice(0, cut > 8 ? cut : 26); }
  return s;
}

export default {
  id: 'hazards', layers: ['hazards'],
  create(t) {
    const { THREE } = t, pal = palette(t), low = t.quality === 'low';
    const root = new THREE.Group(); root.name = 'hazards'; t.scene.add(root);
    const uT = { value: 0 };
    const zones = new Map();          // id -> zone
    const placed = [];                // label anchors already used, so labels of overlapping zones do not stack
    const watch = stateWatcher();
    let layerOn = true, selId = t.ctx.selection?.type === 'hazard' ? t.ctx.selection.id : null, lastCount = -1;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), ax = new THREE.Vector3();

    function labelAnchor(poly) {
      const c = polyCentroid(poly);
      const clash = placed.find((p) => dist2(p, c) < 5);
      if (!clash) { placed.push(c); return c; }
      let best = c, bd = -1;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const p = [c[0] + (m[0] - c[0]) * 0.62, c[1] + (m[1] - c[1]) * 0.62];
        let d = Infinity; for (const o of placed) d = Math.min(d, dist2(o, p));
        if (d > bd) { bd = d; best = p; }
      }
      placed.push(best); return best;
    }

    function curtainGeometry(poly, h) {
      const n = poly.length, pos = [], uv = [], idx = []; let s = 0;
      for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n], l = dist2(a, b), k = i * 4;
        pos.push(a[0], 0, -a[1], b[0], 0, -b[1], a[0], h, -a[1], b[0], h, -b[1]);
        uv.push(s, 0, s + l, 0, s, 1, s + l, 1); s += l;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      return g;
    }

    function makeZone(hz, isNew, burst) {
      const poly = hz.poly.slice(0, MAXP), block = hz.block ? 1 : 0;
      const pts = []; for (let i = 0; i < MAXP; i++) { const p = poly[Math.min(i, poly.length - 1)]; pts.push(new THREE.Vector2(p[0], p[1])); }
      let d0 = Infinity, d1 = -Infinity, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of poly) { d0 = Math.min(d0, p[0] + p[1]); d1 = Math.max(d1, p[0] + p[1]); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      const group = new THREE.Group(); group.name = 'hazard ' + hz.id; root.add(group);
      const shared = { uPts: { value: pts }, uN: { value: poly.length }, uColor: { value: pal.danger }, uBlock: { value: block }, uWipe: { value: burst ? 0 : 1 }, uSel: { value: 0 }, uT };
      const fill = new THREE.Mesh(polyGeometry(THREE, poly), decalMaterial(THREE, { vertexShader: VERT, fragmentShader: FILL_FRAG, uniforms: { ...shared, uOpacity: { value: 1 }, uDiag: { value: new THREE.Vector2(d0, d1) } } }));
      fill.position.y = t.groundY + Y.hazard + (block ? 0.004 : 0) + (isNew ? 0.006 : 0); fill.renderOrder = 3 + block;
      group.add(fill); t.pickable(fill, { type: 'hazard', id: hz.id });
      if (hz.kind === 'gas') {
        const pad = 1.6, n = low ? 1 : 2;
        for (let i = 0; i < n; i++) {
          const g = new THREE.PlaneGeometry(x1 - x0 + pad * 2, y1 - y0 + pad * 2).rotateX(-Math.PI / 2);
          const uvs = g.attributes.uv, ps = g.attributes.position;
          g.translate((x0 + x1) / 2, 0, -(y0 + y1) / 2);
          for (let k = 0; k < uvs.count; k++) uvs.setXY(k, ps.getX(k), -ps.getZ(k));
          const haze = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: HAZE_FRAG, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, uniforms: { ...shared, uSeed: { value: 3.7 + i * 11.3 } } }));
          haze.position.y = t.groundY + 0.3 + i * 0.5; haze.renderOrder = 7; group.add(haze);
        }
      } else {
        const curtain = new THREE.Mesh(curtainGeometry(poly, block ? 0.6 : 0.36), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: CURTAIN_FRAG, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, uniforms: shared }));
        curtain.position.y = t.groundY + Y.hazard; curtain.renderOrder = 7; group.add(curtain); t.glow(curtain);
      }
      const anchor = labelAnchor(poly);
      const words = (!isNew && KIND_LABEL[hz.kind]) || shortName(hz.name).split(' · ');
      const label = t.label(words[0], { tone: 'danger', sub: words[1] || '', priority: 4, sel: { type: 'hazard', id: hz.id } });
      if (!label.setSub && words[1]) label.setText(words[0] + ' · ' + words[1]);
      label.setPosition(t.v3(anchor, t.groundY + (block ? 1.5 : 1.0)));
      const z = { id: hz.id, group, shared, label, anchor, burst: null };
      if (isNew) addDebris(z, hz, poly, [x0, x1, y0, y1], burst);
      setLabelOn(z, layerOn);
      return z;
    }

    // Debris of a new slide. Same seeded resting places every time; with "burst" the chunks fall in and dust rises.
    function addDebris(z, hz, poly, [x0, x1, y0, y1], burst) {
      const rnd = mulberry32(hashId(hz.id)), n = low ? 12 : 36;
      const chunks = [];
      for (let i = 0, guard = 0; i < n && guard < 2000; guard++) {
        const p = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)];
        if (!inPoly(p, poly)) continue;
        const big = rnd() < 0.2, s = big ? 0.34 + rnd() * 0.3 : 0.1 + rnd() * 0.2;
        const c = { x: p[0], z: -p[1], sx: s * (0.8 + rnd() * 0.6), sy: s * (0.45 + rnd() * 0.4), sz: s * (0.7 + rnd() * 0.6),
          rest: new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.5, rnd() * 6.28, (rnd() - 0.5) * 0.5)),
          axis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), spin: 2 + rnd() * 5,
          delay: rnd() * 0.5, h: 3 + rnd() * 2, dx: (rnd() - 0.5) * 0.9, dz: (rnd() - 0.5) * 0.9 };
        c.tf = Math.sqrt((2 * c.h) / 9.81); c.vb = 0.26 * 9.81 * c.tf; c.tb = (2 * c.vb) / 9.81;
        chunks.push(c); i++;
      }
      const geo = new THREE.DodecahedronGeometry(0.5, 0);
      const mat = new THREE.MeshStandardMaterial({ color: 0x6d655c, roughness: 0.96, metalness: 0, flatShading: true });
      const mesh = new THREE.InstancedMesh(geo, mat, chunks.length); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      const col = new THREE.Color();
      chunks.forEach((c, i) => { const g = 0.75 + rnd() * 0.45; mesh.setColorAt(i, col.setRGB(g, g * (0.94 + rnd() * 0.05), g * (0.86 + rnd() * 0.08))); });
      z.group.add(mesh); z.chunks = chunks; z.debris = mesh;
      placeDebris(z, burst ? 0 : 99);
      if (!burst) return;
      const m = low ? 24 : 70, pos = new Float32Array(m * 3), vel = new Float32Array(m * 3), seed = new Float32Array(m * 2), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      for (let i = 0; i < m; i++) {
        const c = chunks[i % chunks.length], a = Math.atan2(-c.z - cy, c.x - cx) + (rnd() - 0.5) * 1.6, sp = 0.6 + rnd() * 1.8;
        pos.set([c.x + (rnd() - 0.5) * 0.6, t.groundY + 0.15 + rnd() * 0.3, c.z + (rnd() - 0.5) * 0.6], i * 3);
        vel.set([Math.cos(a) * sp, 0.5 + rnd() * 1.6, -Math.sin(a) * sp], i * 3);
        seed.set([rnd(), rnd()], i * 2);
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); dg.setAttribute('aVel', new THREE.BufferAttribute(vel, 3)); dg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
      const dust = new THREE.Points(dg, new THREE.ShaderMaterial({ vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, toneMapped: false,
        uniforms: { uAge: { value: 0 }, uPx: { value: t.renderer.domElement.height * t.camera.projectionMatrix.elements[5] * 0.5 } } }));
      dust.frustumCulled = false; dust.renderOrder = 9; z.group.add(dust);
      z.burst = { age: 0, dust };
    }

    function placeDebris(z, age) {
      const mesh = z.debris;
      for (let i = 0; i < z.chunks.length; i++) {
        const c = z.chunks[i], rest = t.groundY + c.sy * 0.36, a = age - c.delay;
        let y = rest, k = 0, s = 1;                                  // k = how far from rest (1 = just released)
        if (a < 0) { s = 0; }
        else if (a < c.tf) { y = rest + c.h - 4.905 * a * a; k = 1 - (a / (c.tf + c.tb)); }
        else if (a < c.tf + c.tb) { const b = a - c.tf; y = rest + c.vb * b - 4.905 * b * b; k = 1 - (a / (c.tf + c.tb)); }
        q.copy(c.rest);
        if (k > 0) { q2.setFromAxisAngle(ax.copy(c.axis), c.spin * k * k * 1.2); q.multiply(q2); }
        v.set(c.x - c.dx * k, y, c.z - c.dz * k); sc.set(c.sx * s, c.sy * s, c.sz * s);
        mesh.setMatrixAt(i, m4.compose(v, q, sc));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    function setLabelOn(z, on) { if (z.label.setVisible) z.label.setVisible(on); else if (z.label.el) z.label.el.style.visibility = on ? '' : 'hidden'; }
    function removeZone(z) { disposeTree(z.group); z.label.remove(); const i = placed.indexOf(z.anchor); if (i >= 0) placed.splice(i, 1); zones.delete(z.id); }

    // Static zones: no-entry zones first so they get the centroid for their label.
    for (const hz of [...t.world.HAZARDS].sort((a, b) => (b.block ? 1 : 0) - (a.block ? 1 : 0))) zones.set(hz.id, makeZone(hz, false, false));
    const staticIds = new Set(t.world.HAZARDS.map((h) => h.id));

    function sync(state, fresh) {
      const list = state.hazards || [];
      for (const z of [...zones.values()]) if (!staticIds.has(z.id) && !list.some((h) => h.id === z.id)) removeZone(z);
      for (const hz of list) {
        if (zones.has(hz.id) || !hz.poly || hz.poly.length < 3) continue;
        const burst = !fresh && !t.reduced && state.t - (hz.t ?? -1e9) < 6;
        zones.set(hz.id, makeZone(hz, true, burst));
      }
      lastCount = list.length;
    }

    return {
      update(state, dt, time) {
        const fresh = watch(state);
        if (fresh) for (const z of [...zones.values()]) if (!staticIds.has(z.id)) removeZone(z);   // rebuild at rest, no burst
        if (fresh || (state.hazards?.length || 0) !== lastCount) sync(state, fresh);
        if (!layerOn) return;
        uT.value = t.reduced ? 0 : time;
        for (const z of zones.values()) {
          const target = z.id === selId ? 1 : 0, u = z.shared.uSel;
          if (u.value !== target) { u.value = damp(u.value, target, 12, dt); if (Math.abs(u.value - target) < 0.004) u.value = target; }
          const b = z.burst; if (!b) continue;
          b.age += dt;
          const w = clamp(b.age / 1.0, 0, 1); z.shared.uWipe.value = w * w * (3 - 2 * w);
          placeDebris(z, b.age);
          b.dust.material.uniforms.uAge.value = b.age;
          if (b.age > 2.6) { z.shared.uWipe.value = 1; placeDebris(z, 99); disposeTree(b.dust); z.burst = null; }
        }
      },
      setLayer(id, on) { if (id !== 'hazards') return; layerOn = on; root.visible = on; for (const z of zones.values()) setLabelOn(z, on); },
      onSelect(sel) { selId = sel && sel.type === 'hazard' ? sel.id : null; for (const z of zones.values()) z.label.setSelected?.(z.id === selId); },
      dispose() { for (const z of [...zones.values()]) z.label.remove(); zones.clear(); disposeTree(root); },
    };
  },
};
