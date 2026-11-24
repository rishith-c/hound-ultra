// People: detections drawn as they are KNOWN, not as they are.
//   possible   an amber uncertainty volume the size of posSigma, a dashed ring, a question mark
//   confirmed  a warm figure seen through walls, a ring and an arc whose length is the fused probability
//   rejected   a small grey cross
// Display conventions (posture is not sensed): a person the sensors call "moving" is drawn standing, a "still"
// person is drawn lying, with a fixed yaw taken from the detection id. Everything here is simulated.
// The 'truth' layer (off by default) is the only place ground truth is drawn.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRUTH } from '../../core/world.js';
import { palette, Y, clamp, lerp, damp, stateWatcher, canvasTexture, decalMaterial, disposeTree, mulberry32, FONT } from './common.js';

const FIG_R = 1.05;                 // ring radius around a confirmed person, m
const TAU = Math.PI * 2;

const RING_VERT = /* glsl */ `
uniform float uHalf;
varying vec2 vP;
void main() { vP = vec2(position.x, -position.z) * uHalf; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RING_FRAG = /* glsl */ `
uniform vec3 uWarn, uPerson, uOk;
uniform float uR, uP, uDashes, uConf, uReach, uAlpha, uSel, uPulse, uGain;
varying vec2 vP;
float band(float d, float w) { return 1.0 - smoothstep(w * 0.5, w * 1.5, abs(d)); }
void main() {
  float r = length(vP), aa = fwidth(r), w = max(0.011, aa * 1.1);
  float ang = fract(atan(vP.x, vP.y) / 6.2831853 + 1.0);                    // 0 at north, clockwise
  vec3 col = mix(mix(uWarn, uPerson, uConf), uOk, uReach);
  float dashes = mix(step(0.5, fract(ang * uDashes)), 1.0, uConf);         // dashed while it is only possible
  float track = band(r - uR, w) * dashes * mix(0.5, 0.3, uConf);
  float aaA = fwidth(ang) * 1.2 + 1e-4;
  float inArc = (1.0 - smoothstep(uP - aaA, uP, ang)) * step(0.0005, uP);
  float arc = band(r - uR, w * 2.4) * inArc;
  float pool = (1.0 - smoothstep(0.0, uR, r)) * 0.10 * uConf;              // a little warmth on the floor
  float sel = band(r - uR - max(0.09, aa * 4.0), w * 0.8) * uSel * 0.75;
  float pk = 1.0 - uPulse;
  float pulse = band(r - uR - pk * 1.4, w * 1.6) * uPulse * uPulse * step(0.001, uPulse);
  float a = max(track, arc) + pool + sel + pulse;
  gl_FragColor = vec4(col * (1.0 + (uGain - 1.0) * max(arc, pulse)) * (1.0 + 0.35 * uSel), a * uAlpha);
  #include <colorspace_fragment>
}`;

const DOME_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vH;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz; vH = position.y;
  vN = normalize(mat3(transpose(inverse(modelMatrix))) * normal);
  vV = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const DOME_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha, uTime, uSeed;
varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vH;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float fres = pow(1.0 - ndv, 2.4);
  vec3 q = vW * 1.15 + vec3(uSeed, uTime * 0.11, uTime * 0.05);
  float n = noise(q) * 0.65 + noise(q * 2.3 + 7.0) * 0.35;                  // slow drift: the estimate is not a hard edge
  float a = (0.035 + 0.5 * fres) * (0.55 + 0.9 * n) * mix(1.0, 0.55, vH);
  a *= smoothstep(0.0, 0.06, vH);
  gl_FragColor = vec4(uColor, a * uAlpha);
  #include <colorspace_fragment>
}`;

// Three nested shells of one body: a pale hot core, an orange-red rim, a soft outer glow.
// Core and rim are blended with MAX, so the overlapping parts of the body read as one volume in any draw order.
const HEAT_VERT = /* glsl */ `
attribute vec2 aBody;                 // x: how warm this part reads (trunk 1, hands and feet cooler), y: chest weight
uniform float uInflate, uBreath;
varying vec3 vN; varying vec3 vV; varying float vHeat;
void main() {
  vec3 p = position + normal * (uInflate + aBody.y * uBreath);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz; vHeat = aBody.x;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const HEAT_FRAG = /* glsl */ `
uniform vec3 uPerson, uHot; uniform float uShell, uAlpha, uGain;
varying vec3 vN; varying vec3 vV; varying float vHeat;
void main() {
  float ndv = max(dot(normalize(vN), normalize(vV)), 0.0);
  vec3 c; float a;
  if (uShell < 0.5) {            // core
    float hot = pow(ndv, 2.2) * vHeat * 0.8;
    c = mix(uPerson, uHot, hot) * (0.3 + 0.62 * ndv) * uGain; a = 1.0;
  } else if (uShell < 1.5) {     // rim
    c = uPerson * (0.25 + 0.6 * pow(1.0 - ndv, 1.6)) * uGain; a = 1.0;
  } else {                       // glow
    c = uPerson * pow(ndv, 2.0) * 0.11; a = 0.0;
  }
  gl_FragColor = vec4(c * uAlpha, a * uAlpha);
  #include <colorspace_fragment>
}`;

const FLAT_VERT = /* glsl */ `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FLAT_FRAG = /* glsl */ `uniform vec3 uColor; uniform float uAlpha; void main() { gl_FragColor = vec4(uColor, uAlpha); 
  #include <colorspace_fragment>
}`;

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const toward = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

// A standing body 1.7 m tall, feet on y = 0, facing +z. detail = radial segments.
function bodyGeometry(THREE, detail) {
  const parts = [], up = new THREE.Vector3(0, 1, 0), a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), q = new THREE.Quaternion(), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  const cap = Math.max(2, detail >> 2);
  const tag = (g, heat, chest) => { const n = g.attributes.position.count, arr = new Float32Array(n * 2); for (let i = 0; i < n; i++) { arr[i * 2] = heat; arr[i * 2 + 1] = chest; } g.setAttribute('aBody', new THREE.BufferAttribute(arr, 2)); g.deleteAttribute('uv'); parts.push(g); };
  const limb = (p0, p1, r, heat) => {
    a.fromArray(p0); b.fromArray(p1); d.subVectors(b, a); const len = d.length();
    const g = new THREE.CapsuleGeometry(r, len, cap, detail);
    q.setFromUnitVectors(up, d.normalize()); a.add(b).multiplyScalar(0.5); g.applyMatrix4(m.compose(a, q, one)); tag(g, heat, 0);
  };
  const blob = (c, r, heat, chest = 0) => { const g = new THREE.SphereGeometry(1, detail, Math.max(4, detail - 2)); g.scale(r[0], r[1], r[2]); g.translate(c[0], c[1], c[2]); tag(g, heat, chest); };
  blob([0, 1.585, 0.005], [0.094, 0.115, 0.104], 0.95);                      // head
  limb([0, 1.42, 0], [0, 1.5, 0], 0.048, 0.9);                               // neck
  blob([0, 1.245, 0], [0.185, 0.215, 0.112], 1, 1);                          // chest
  limb([-0.15, 1.385, 0], [0.15, 1.385, 0], 0.062, 0.95);                    // shoulders
  blob([0, 1.03, 0.005], [0.155, 0.17, 0.104], 1, 0.5);                      // abdomen
  blob([0, 0.895, 0], [0.168, 0.115, 0.11], 0.9);                            // pelvis
  for (const s of [-1, 1]) {
    limb([s * 0.215, 1.37, 0], [s * 0.26, 1.1, -0.01], 0.047, 0.7);          // upper arm
    limb([s * 0.26, 1.1, -0.01], [s * 0.275, 0.86, 0.03], 0.039, 0.55);      // forearm
    blob([s * 0.28, 0.79, 0.04], [0.036, 0.066, 0.028], 0.4);                // hand
    limb([s * 0.092, 0.87, 0], [s * 0.1, 0.5, 0.012], 0.073, 0.75);          // thigh
    limb([s * 0.1, 0.5, 0.012], [s * 0.1, 0.105, 0], 0.052, 0.55);           // shin
    blob([s * 0.1, 0.042, 0.055], [0.046, 0.042, 0.115], 0.35);              // foot
  }
  const g = mergeGeometries(parts); for (const p of parts) p.dispose();
  return g;
}

export default {
  id: 'people',
  layers: ['heat', 'truth'],
  create(t) {
    const { THREE } = t, pal = palette(t);
    const low = t.quality === 'low', reduced = !!t.reduced;
    const root = new THREE.Group(); root.name = 'people'; t.scene.add(root);
    const hot = new THREE.Color(pal.heat[pal.heat.length - 1]);

    // shared geometry
    const quad = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const domeGeo = new THREE.SphereGeometry(1, low ? 40 : 64, low ? 10 : 24, 0, TAU, 0, Math.PI / 2);
    const bodyGeo = bodyGeometry(THREE, low ? 8 : 18);
    const bar = new THREE.PlaneGeometry(0.52, 0.045).rotateX(-Math.PI / 2);
    const crossGeo = mergeGeometries([bar.clone().rotateY(Math.PI / 4), bar.clone().rotateY(-Math.PI / 4)]); bar.dispose();
    const pickGeo = new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0);
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    const glyph = canvasTexture(THREE, 128, 128);
    glyph.redraw((c, w, h) => {
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '500 92px ' + FONT;
      c.shadowColor = 'rgba(255,255,255,0.55)'; c.shadowBlur = 14; c.fillStyle = 'rgba(255,255,255,0.96)'; c.fillText('?', w / 2, h / 2 + 5);
    });
    const none = () => {};

    const visuals = new Map();
    let heatOn = true, truthOn = false, selType = null, selId = null, frame = 0;
    try { const s = t.ctx.selection; if (s) { selType = s.type; selId = s.id; } } catch { /* no selection yet */ }

    function build(id) {
      const group = new THREE.Group(); group.name = 'detection-' + id; root.add(group);
      const ringMat = decalMaterial(THREE, { depthTest: false, vertexShader: RING_VERT, fragmentShader: RING_FRAG,
        uniforms: { uWarn: { value: pal.warn }, uPerson: { value: pal.person }, uOk: { value: pal.ok }, uHalf: { value: 1 }, uR: { value: 1 }, uP: { value: 0 }, uDashes: { value: 24 }, uConf: { value: 0 }, uReach: { value: 0 }, uAlpha: { value: 0 }, uSel: { value: 0 }, uPulse: { value: 0 }, uGain: { value: 1.7 } } });
      const ring = new THREE.Mesh(quad, ringMat); ring.position.y = t.groundY + Y.ring; ring.renderOrder = 8; ring.raycast = none; group.add(ring); t.glow(ring);

      const domeMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG,
        uniforms: { uColor: { value: pal.warn }, uAlpha: { value: 0 }, uTime: { value: 0 }, uSeed: { value: (hashStr(id) % 97) * 0.37 } } });
      const dome = new THREE.Mesh(domeGeo, domeMat); dome.position.y = t.groundY + 0.02; dome.renderOrder = 11; dome.raycast = none; group.add(dome);

      const qMat = new THREE.SpriteMaterial({ map: glyph.texture, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, opacity: 0 }); qMat.color = pal.warn;
      const q = new THREE.Sprite(qMat); q.renderOrder = 21; q.raycast = none; group.add(q);

      const fig = new THREE.Group(), pose = new THREE.Group(); fig.add(pose); group.add(fig);
      const shells = [];
      for (let i = 0; i < 3; i++) {
        const mat = new THREE.ShaderMaterial({ transparent: true, premultipliedAlpha: true, depthWrite: false, depthTest: false, toneMapped: false, ...(i < 2 ? { blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor } : {}), vertexShader: HEAT_VERT, fragmentShader: HEAT_FRAG,
          uniforms: { uPerson: { value: pal.person }, uHot: { value: hot }, uShell: { value: i }, uInflate: { value: [0, 0.022, 0.085][i] }, uBreath: { value: 0 }, uAlpha: { value: 0 }, uGain: { value: 1.5 } } });
        const m = new THREE.Mesh(bodyGeo, mat); m.renderOrder = 24 + i; m.raycast = none; m.frustumCulled = false; pose.add(m); shells.push(mat);
        if (i < 2) t.glow(m);
      }
      const crossMat = decalMaterial(THREE, { vertexShader: FLAT_VERT, fragmentShader: FLAT_FRAG, uniforms: { uColor: { value: pal.dim }, uAlpha: { value: 0 } } });
      const cross = new THREE.Mesh(crossGeo, crossMat); cross.position.y = t.groundY + Y.marker; cross.renderOrder = 7; cross.raycast = none; group.add(cross);
      const pick = new THREE.Mesh(pickGeo, pickMat); group.add(pick);
      t.pickable(group, { type: 'detection', id });
      const label = t.label('', { tone: 'warn', priority: 5, sel: { type: 'detection', id } }); label.setVisible?.(false);
      const rng = mulberry32(hashStr('yaw' + id));
      return { id, group, ring, ringMat, dome, domeMat, q, qMat, fig, pose, shells, cross, crossMat, pick, label, labelOn: false,
        x: 0, y: 0, sigma: 1, kVol: 0, kFig: 0, kCross: 0, appear: 0, pulse: 0, reach: 0, lying: -1, status: '', text: '', sub: '', tone: '', yaw: rng() * TAU, bph: rng() * TAU, seen: 0, lp: new THREE.Vector3() };
    }

    function setPose(v, lying) {
      if (v.lying === lying) return; v.lying = lying;
      if (lying) { v.pose.rotation.set(-Math.PI / 2, 0, 0); v.pose.position.set(0, 0.115, 0.85); v.fig.rotation.y = v.yaw; }
      else { v.pose.rotation.set(0, 0, 0); v.pose.position.set(0, 0, 0); v.fig.rotation.y = v.yaw; }
    }

    // ---------- ground truth (debug layer, off by default) ----------
    const truth = new THREE.Group(); truth.name = 'ground-truth'; truth.visible = false; root.add(truth);
    const truthLabels = [], truthDefs = [];
    {
      const white = new THREE.Color('#ffffff');
      const lineMat = new THREE.LineBasicMaterial({ color: white, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false, toneMapped: false });
      const faintMat = new THREE.LineBasicMaterial({ color: white, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false, toneMapped: false });
      const lowBody = bodyGeometry(THREE, 6), bodyEdges = new THREE.EdgesGeometry(lowBody, 32); lowBody.dispose();
      const circle = (r, n = 40) => { const p = []; for (let i = 0; i < n; i++) { const a0 = i / n * TAU, a1 = (i + 1) / n * TAU; p.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); return g; };
      const segs = (arr) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); return g; };
      const add = (parent, geo, mat) => { const l = new THREE.LineSegments(geo, mat); l.renderOrder = 40; l.raycast = none; parent.add(l); return l; };
      for (const p of TRUTH.people) {
        const g = new THREE.Group(); g.position.copy(t.v3(p.pos, t.groundY)); truth.add(g);
        const lying = p.posture === 'lying', body = add(g, bodyEdges, lineMat);
        if (lying) { const r = mulberry32(hashStr('truth' + p.id)); body.rotation.set(-Math.PI / 2, 0, 0); body.position.set(0, 0.115, 0.85); g.rotation.y = r() * TAU; }
        add(g, circle(lying ? 1.0 : 0.45), faintMat).position.y = Y.select + 0.02;
        truthDefs.push({ text: 'Ground truth: person, ' + (lying ? 'lying' : 'standing') + (p.motion === 'still' ? ' still' : ', moving'), pos: t.v3(p.pos, t.groundY + (lying ? 0.75 : 1.95)) });
      }
      for (const x of TRUTH.decoys) {
        const g = new THREE.Group(); g.position.copy(t.v3(x.pos, t.groundY)); truth.add(g);
        if (x.kind === 'fan') {
          const a = []; const r = 0.2, cy = 0.62;
          a.push(0, 0, 0, 0, cy - r, 0, -0.14, 0, 0, 0.14, 0, 0);
          for (let i = 0; i < 4; i++) { const an = i / 4 * TAU + 0.4; a.push(0, cy, 0, Math.cos(an) * r * 0.9, cy + Math.sin(an) * r * 0.9, 0); }
          add(g, segs(a), lineMat);
          const c = add(g, circle(r, 28), lineMat); c.rotation.x = Math.PI / 2; c.position.y = cy;
        } else {
          const a = [], y0 = 0.45, r = 0.06, L = 0.55;
          for (let i = 0; i < 6; i++) { const an = i / 6 * TAU, c = Math.cos(an) * r, s = Math.sin(an) * r; a.push(-L, y0 + c, s, L, y0 + c, s); }
          for (const xx of [-L, L]) for (let i = 0; i < 6; i++) { const a0 = i / 6 * TAU, a1 = (i + 1) / 6 * TAU; a.push(xx, y0 + Math.cos(a0) * r, Math.sin(a0) * r, xx, y0 + Math.cos(a1) * r, Math.sin(a1) * r); }
          add(g, segs(a), lineMat);
        }
        add(g, circle(0.45), faintMat).position.y = Y.select + 0.02;
        truthDefs.push({ text: 'Ground truth: ' + (x.kind === 'fan' ? 'desk fan' : 'hot water pipe'), pos: t.v3(x.pos, t.groundY + 1.0) });
      }
    }
    function setTruth(on) {
      truthOn = !!on; truth.visible = truthOn;
      if (truthOn && !truthLabels.length) for (const d of truthDefs) { const l = t.label(d.text, { tone: 'muted', priority: 2 }); l.setPosition(d.pos); truthLabels.push(l); }
      else if (!truthOn) { for (const l of truthLabels) l.remove(); truthLabels.length = 0; }
    }

    function isSelected(d) { return (selType === 'detection' && selId === d.id) || (selType === 'survivor' && selId != null && selId === d.survivorId); }

    function update(state, dt, time) {
      const fresh = watch(state); frame++;
      const dets = state.detections;
      for (let i = 0; i < dets.length; i++) {
        const d = dets[i]; if (!d.pos) continue;
        let v = visuals.get(d.id), born = false;
        if (!v) { v = build(d.id); visuals.set(d.id, v); born = true; }
        if (v.seen !== frame - 1) born = true;                         // back after a reset or seek
        v.seen = frame;
        const st = d.status, conf = st === 'confirmed', rej = st === 'rejected';
        const sv = d.survivorId ? state.survivors[d.survivorId] : null;
        const snap = fresh || (born && rej);
        const sigma = clamp(d.posSigma || 1, 0.3, 8);
        if (born || fresh) { v.x = d.pos[0]; v.y = d.pos[1]; v.sigma = sigma; v.appear = fresh ? 1 : 0; v.pulse = 0; }
        else { v.x = damp(v.x, d.pos[0], 7, dt); v.y = damp(v.y, d.pos[1], 7, dt); v.sigma = damp(v.sigma, sigma, 6, dt); v.appear = Math.min(1, v.appear + dt / 0.4); }
        if (!fresh && !born && !reduced && v.status === 'possible' && conf) v.pulse = 1;   // possible -> confirmed
        v.status = st;
        const tv = conf || rej ? 0 : 1, tf = conf ? 1 : 0, tc = rej ? 1 : 0, tr = sv && sv.status === 'reached' ? 1 : 0;
        if (snap) { v.kVol = tv; v.kFig = tf; v.kCross = tc; v.reach = tr; if (snap && !fresh) v.appear = 1; }
        else { v.kVol = toward(v.kVol, tv, dt / (rej ? 0.6 : 0.45)); v.kFig = toward(v.kFig, tf, dt / (rej ? 0.6 : 0.5)); v.kCross = toward(v.kCross, tc, dt / 0.6); v.reach = toward(v.reach, tr, dt / 0.8); }
        if (v.pulse > 0) v.pulse = Math.max(0, v.pulse - dt / 0.7);
        const ap = v.appear * v.appear * (3 - 2 * v.appear), sel = isSelected(d);
        v.group.visible = true; v.group.position.set(v.x, 0, -v.y);

        // ring and confidence arc
        const R = lerp(v.sigma, FIG_R, v.kFig), u = v.ringMat.uniforms, halfQ = R + 1.7;
        v.ring.scale.set(halfQ, 1, halfQ); u.uHalf.value = halfQ; u.uR.value = R * (0.8 + 0.2 * ap);
        u.uP.value = d.p; u.uDashes.value = Math.max(8, Math.round(TAU * R / 0.36)); u.uConf.value = v.kFig; u.uReach.value = v.reach;
        u.uAlpha.value = ap * (1 - v.kCross) * (sel ? 1 : 0.86); u.uSel.value = sel ? 1 : 0; u.uPulse.value = v.pulse;
        v.ring.visible = u.uAlpha.value > 0.004;

        // uncertainty volume and question mark
        const showVol = heatOn && v.kVol > 0.004;
        v.dome.visible = showVol; v.q.visible = showVol;
        const domeH = v.sigma < 1.2 ? v.sigma : 1.2 + (v.sigma - 1.2) * 0.25;
        if (showVol) {
          const sc = (conf ? 0.2 + 0.8 * v.kVol : 1) * (0.85 + 0.15 * ap);
          v.dome.scale.set(v.sigma * sc, domeH * sc, v.sigma * sc);
          v.domeMat.uniforms.uAlpha.value = v.kVol * ap / (1 + 0.32 * v.sigma); v.domeMat.uniforms.uTime.value = reduced ? 0 : time;
          const qs = clamp(0.42 + 0.12 * v.sigma, 0.45, 0.95);
          v.q.scale.set(qs, qs, 1); v.q.position.y = t.groundY + clamp(domeH * 0.55, 0.8, 1.35); v.qMat.opacity = v.kVol * ap * 0.92;
        }

        // heat figure
        const showFig = heatOn && v.kFig > 0.004;
        v.fig.visible = showFig;
        if (showFig) {
          const lying = !(sv && sv.motion === 'moving'); setPose(v, lying);
          const calm = v.reach, live = reduced ? 0 : 1;
          const br = live * Math.sin(time * 1.55 + v.bph) * 0.0045 * (1 - 0.4 * calm);         // chest moves 1 to 2 %
          const k = 0.9 + 0.1 * v.kFig; v.fig.scale.set(k, k, k);
          if (!lying) { const sw = live * (1 - calm) * Math.sin(time * 0.62 + v.bph); v.pose.rotation.z = sw * 0.022; v.pose.position.x = sw * 0.012; }
          for (let s = 0; s < 3; s++) { const us = v.shells[s].uniforms; us.uAlpha.value = v.kFig * (1 - 0.22 * calm * (s > 0 ? 1 : 0)); us.uBreath.value = 0.004 + br; }
        }

        // rejected: a small grey cross
        v.cross.visible = v.kCross > 0.004; v.crossMat.uniforms.uAlpha.value = v.kCross * 0.5;
        v.cross.rotation.y = 0;

        // pick volume
        const pr = conf ? (v.lying === true ? 0.95 : 0.5) : rej ? 0.4 : clamp(v.sigma, 0.5, 1.3);
        v.pick.scale.set(pr, conf ? (v.lying === true ? 0.5 : 1.8) : rej ? 0.2 : Math.min(domeH, 1.6), pr);

        // label
        const want = !rej;
        if (want !== v.labelOn) { v.labelOn = want; v.label.setVisible?.(want); if (!v.label.setVisible) v.label.el.style.visibility = want ? '' : 'hidden'; }
        if (want) {
          const sub = Math.round(d.p * 100) + ' %', text = conf ? (tr ? 'Person reached' : 'Person') : 'Possible person', tone = conf ? (tr ? 'ok' : 'person') : 'warn';
          if (text !== v.text || sub !== v.sub) {
            v.text = text; v.sub = sub;
            if (v.label.setSub) { v.label.setText(text); v.label.setSub(sub); } else v.label.setText(text + ' · ' + sub);
          }
          if (tone !== v.tone) { v.tone = tone; v.label.setTone?.(tone); v.label.setPriority?.(conf ? 8 : 5); }
          const ly = conf ? lerp(1.6, v.lying === true ? 0.75 : 1.95, v.kFig) : clamp(domeH * 0.55, 0.8, 1.35) + 0.5;
          v.lp.set(v.x, t.groundY + ly, -v.y); v.label.setPosition(v.lp);
          v.label.setSelected?.(sel);
        }
      }
      // anything not in this state (after a reset or seek) disappears at once
      if (visuals.size !== dets.length || fresh) for (const v of visuals.values()) if (v.seen !== frame && v.group.visible) { v.group.visible = false; v.labelOn = false; v.label.setVisible?.(false); if (!v.label.setVisible) v.label.el.style.visibility = 'hidden'; v.status = ''; }
    }
    const watch = stateWatcher();

    return {
      update,
      setLayer(id, on) { if (id === 'heat') heatOn = !!on; else if (id === 'truth') setTruth(on); },
      onSelect(sel) { selType = sel ? sel.type : null; selId = sel ? sel.id : null; },
      dispose() {
        for (const v of visuals.values()) v.label.remove();
        visuals.clear(); for (const l of truthLabels) l.remove(); truthLabels.length = 0;
        disposeTree(root); quad.dispose(); domeGeo.dispose(); bodyGeo.dispose(); crossGeo.dispose(); pickGeo.dispose(); pickMat.dispose(); glyph.texture.dispose();
      },
    };
  },
};
