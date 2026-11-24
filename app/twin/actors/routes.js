// Routes on the ground: the rover's planned path, the breadcrumb trails, and the rescue route with its leg numbers
// and the "break through here" marker. Driven by state.units[..].path / .trail and state.routes.rescue. Simulated.
import { palette, Y, damp, clamp, stateWatcher, ribbonGeometry, ringGeometry, groundText, smoothPath, disposeTree, decalMaterial, dist2, FONT } from './common.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Rover path: a thin lit line that never gets thinner than about a pixel, trimmed behind the rover by uDriven.
const PATH_FRAG = /* glsl */ `
uniform vec3 uColor, uHot; uniform float uDriven, uLen, uPulse, uPulseAmt, uOpacity;
varying vec2 vUv;
void main() {
  float s = vUv.x, ay = abs(vUv.y), fw = fwidth(vUv.y);
  float hw = max(0.32, fw * 1.1);
  float line = 1.0 - smoothstep(hw - fw, hw + fw, ay);
  float halo = (1.0 - smoothstep(0.3, 1.0, ay)) * 0.16;
  float a = (line * mix(0.78, 0.5, clamp(hw - 0.32, 0.0, 1.0)) + halo);
  a *= smoothstep(uDriven + 0.35, uDriven + 1.3, s) * (1.0 - smoothstep(uLen - 0.5, uLen - 0.3, s));
  float p = exp(-pow((s - uPulse) / 1.3, 2.0)) * uPulseAmt;
  gl_FragColor = vec4(mix(uColor, uHot, p) * (1.0 + line * 0.6 + p), clamp(a * (1.0 + p * 0.9) * uOpacity, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

const RING_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity;
varying vec2 vUv;
void main() {
  float r = length(vUv) , w = fwidth(r);
  float ring = smoothstep(0.78 - w, 0.78 + w, r) * (1.0 - smoothstep(0.9 - w, 0.9 + w, r));
  float dot_ = 1.0 - smoothstep(0.2 - w, 0.2 + w, r);
  float soft = (1.0 - smoothstep(0.0, 1.0, r)) * 0.14;
  gl_FragColor = vec4(uColor, clamp(max(ring, dot_) * 0.9 + soft, 0.0, 1.0) * uOpacity);
  #include <colorspace_fragment>
}`;

// Breadcrumbs: one small soft capsule per trail point, fading with age (instance index) down to a floor.
const CRUMB_VERT = /* glsl */ `
attribute float aIdx; uniform float uCount, uFloor, uPeak;
varying vec2 vP; varying float vFade;
void main() {
  vP = position.xz;
  vFade = uFloor + (uPeak - uFloor) * exp(-max(uCount - 1.0 - aIdx, 0.0) / 42.0);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const CRUMB_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vP; varying float vFade;
void main() {
  vec2 p = vP; p.x -= clamp(p.x, -0.17, 0.17);
  float d = length(p), w = fwidth(d), hw = max(0.045, w * 0.9);
  float a = (1.0 - smoothstep(hw - w, hw + w, d)) * mix(1.0, 0.55, clamp((hw - 0.045) * 8.0, 0.0, 1.0));
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a * vFade);
  #include <colorspace_fragment>
}`;

// Rescue route: wide ribbon, dark core, bright edges, chevrons that point (and flow) toward the person.
const RESCUE_FRAG = /* glsl */ `
uniform vec3 uColor, uOk; uniform float uLen, uReveal, uFlow, uPlanned, uCalm, uFadeIn, uOpacity;
varying vec2 vUv;
void main() {
  float s = vUv.x, y = vUv.y, ay = abs(y), wy = fwidth(y), ws = fwidth(s);
  if (s > uReveal) discard;
  float edge = smoothstep(0.82 - wy, 0.82 + wy, ay) * (1.0 - smoothstep(1.0 - wy * 1.5, 1.0, ay));
  float dq = s / 1.0, wq = fwidth(dq);
  float dashed = 1.0 - smoothstep(0.3 - wq, 0.3 + wq, abs(fract(dq) - 0.5));
  edge *= mix(1.0, dashed, uPlanned);
  float inner = smoothstep(0.2, 0.82, ay) * 0.22;                               // soft lift toward the edges
  float u = (s + ay * 0.55 - uFlow) / 2.4, wu = fwidth(u);
  float chev = 1.0 - smoothstep(0.075 - wu, 0.075 + wu, abs(fract(u) - 0.5));
  chev *= 1.0 - smoothstep(0.52, 0.66, ay);
  chev = mix(chev, 0.15, smoothstep(0.25, 0.6, wu));
  float chevA = chev * mix(mix(0.9, 0.5, uPlanned), 0.28, uCalm);
  vec3 edgeCol = mix(uColor, uOk, uCalm * 0.55);
  vec3 col = uColor * 0.2 + uColor * inner;
  float a = 0.56 * (1.0 - smoothstep(1.0 - wy * 1.5, 1.0, ay));
  float hot = 1.0 - 0.45 * max(uPlanned, uCalm);
  col = mix(col, mix(uColor, vec3(1.0), 0.45) * (1.0 + 0.5 * hot), chevA); a = max(a, chevA);
  col = mix(col, edgeCol * (1.0 + 0.8 * hot), edge); a = max(a, edge);
  float head = exp(-max(uReveal - s, 0.0) / 1.2) * step(uReveal, uLen - 0.01);
  col += uColor * head * 0.9;
  a *= mix(1.0, smoothstep(0.0, 0.7, s), uFadeIn) * (1.0 - smoothstep(uLen - 0.25, uLen, s));
  a *= uOpacity * mix(mix(1.0, 0.62, uPlanned), 0.5, uCalm);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

// The door-sized outline standing on the wall: dashed sides, solid corner brackets.
const DOOR_FRAG = /* glsl */ `
uniform vec3 uColor; uniform vec2 uSize; uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * (uSize + 0.16), hs = uSize * 0.5, q = abs(p) - hs;
  float d = abs(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0)), w = fwidth(d);
  vec2 c = hs - abs(p);
  float corner = step(max(c.x, c.y), 0.26);
  float along = (c.x < c.y) ? p.y : p.x;
  float dash = step(abs(fract(along / 0.2) - 0.5), 0.27);
  float lw = mix(0.016, 0.03, corner);
  float line = (1.0 - smoothstep(lw - w, lw + w, d)) * mix(dash * 0.85, 1.0, corner);
  float fill = step(max(q.x, q.y), 0.0) * (0.05 + 0.07 * smoothstep(0.5, 0.0, min(c.x, c.y)));
  gl_FragColor = vec4(uColor * (1.0 + line * 0.7), clamp(max(line, fill), 0.0, 1.0) * uOpacity);
  #include <colorspace_fragment>
}`;
// Floor chevrons in front of the wall (uv.x = metres toward the wall) and the dotted line through it.
const FLOOR_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity, uLen, uDots;
varying vec2 vUv;
void main() {
  float s = vUv.x, ay = abs(vUv.y), a;
  if (uDots > 0.5) {
    vec2 p = vec2((fract(s / 0.34) - 0.5) * 0.34, vUv.y * 0.07);
    float d = length(p), w = fwidth(d), hw = max(0.04, w);
    a = (1.0 - smoothstep(hw - w, hw + w, d)) * 0.85;
  } else {
    float u = (s + ay * 0.26) / 0.36, wu = fwidth(u);
    a = (1.0 - smoothstep(0.17 - wu, 0.17 + wu, abs(fract(u) - 0.5))) * (1.0 - smoothstep(0.8, 0.95, ay));
    a *= smoothstep(0.0, 0.25, s) * (0.35 + 0.65 * s / uLen) * step(s, uLen - 0.02);
  }
  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0) * uOpacity);
  #include <colorspace_fragment>
}`;

// Where the segment p->q crosses the segment a->b: fraction along p->q, or -1.
function segHit(p, q, a, b) {
  const rx = q[0] - p[0], ry = q[1] - p[1], sx = b[0] - a[0], sy = b[1] - a[1], den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const k = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / den, m = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / den;
  return k >= 0 && k <= 1 && m >= 0 && m <= 1 ? k : -1;
}

export default {
  id: 'routes', layers: ['route', 'trail'],
  create(t) {
    const { THREE } = t, pal = palette(t), low = t.quality === 'low';
    const root = new THREE.Group(); root.name = 'routes'; t.scene.add(root);
    const routeG = new THREE.Group(), trailG = new THREE.Group(); root.add(routeG, trailG);
    const watch = stateWatcher();
    const on = { route: true, trail: true };
    const white = new THREE.Color(1, 1, 1), m4 = new THREE.Matrix4();

    // ---------- rover path ----------
    const pathU = { uColor: { value: new THREE.Color() }, uHot: { value: white }, uDriven: { value: 0 }, uLen: { value: 1 }, uPulse: { value: 0 }, uPulseAmt: { value: 0 }, uOpacity: { value: 1 } };
    const pathMesh = new THREE.Mesh(new THREE.BufferGeometry(), decalMaterial(THREE, { vertexShader: VERT, fragmentShader: PATH_FRAG, uniforms: pathU }));
    pathMesh.position.y = t.groundY + Y.path; pathMesh.renderOrder = 5; pathMesh.visible = false; pathMesh.frustumCulled = false; routeG.add(pathMesh); t.glow(pathMesh);
    const goalG = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); { const uv = goalG.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 - 1, uv.getY(i) * 2 - 1); }
    const goal = new THREE.Mesh(goalG, decalMaterial(THREE, { vertexShader: VERT, fragmentShader: RING_FRAG, uniforms: { uColor: pathU.uColor, uOpacity: { value: 1 } } }));
    goal.scale.setScalar(0.95); goal.renderOrder = 5; goal.visible = false; routeG.add(goal); t.glow(goal);
    const P = { n: -1, x0: 0, y0: 0, x1: 0, y1: 0, cum: null, seg: 1, pulse: 0 };
    function syncPath(state, dt, fresh) {
      const u = state.units['HOUND-01'], p = u && u.path;
      if (!p || p.length < 2) { if (pathMesh.visible) { pathMesh.visible = goal.visible = false; P.n = -1; } return; }
      const a = p[0], b = p[p.length - 1];
      if (P.n !== p.length || P.x0 !== a[0] || P.y0 !== a[1] || P.x1 !== b[0] || P.y1 !== b[1]) {
        pathMesh.geometry.dispose(); pathMesh.geometry = ribbonGeometry(THREE, p, 0.5);
        P.n = p.length; P.x0 = a[0]; P.y0 = a[1]; P.x1 = b[0]; P.y1 = b[1];
        P.cum = new Float32Array(p.length); for (let i = 1; i < p.length; i++) P.cum[i] = P.cum[i - 1] + dist2(p[i - 1], p[i]);
        P.seg = 0; pathU.uLen.value = P.cum[p.length - 1]; P.pulse = 0;
        goal.position.copy(t.v3(b, t.groundY + Y.path)); pathMesh.visible = goal.visible = true;
      }
      // distance already driven: closest point, searched near where the rover was last frame
      const lo = P.seg ? Math.max(1, P.seg - 1) : 1, hi = P.seg ? Math.min(p.length - 1, P.seg + 8) : p.length - 1;
      let bd = Infinity, bs = 0, bi = lo;
      for (let i = lo; i <= hi; i++) {
        const q0 = p[i - 1], q1 = p[i], dx = q1[0] - q0[0], dy = q1[1] - q0[1], l2 = dx * dx + dy * dy;
        const k = l2 ? clamp(((u.pos[0] - q0[0]) * dx + (u.pos[1] - q0[1]) * dy) / l2, 0, 1) : 0;
        const d = Math.hypot(u.pos[0] - q0[0] - dx * k, u.pos[1] - q0[1] - dy * k);
        if (d < bd) { bd = d; bi = i; bs = P.cum[i - 1] + Math.sqrt(l2) * k; }
      }
      P.seg = bi; pathU.uDriven.value = bs;
      const moving = !t.reduced && u.v > 0 && state.running;
      pathU.uPulseAmt.value = damp(pathU.uPulseAmt.value, moving ? 1 : 0, 5, dt);
      const left = pathU.uLen.value - bs;
      if (pathU.uPulseAmt.value > 0.01) { P.pulse += dt * Math.max(7, left / 2.4); if (P.pulse > left + 6) P.pulse = 0; }
      pathU.uPulse.value = bs + P.pulse;
    }

    // ---------- breadcrumbs ----------
    function makeTrail(cap, floor, peak, color) {
      const g = new THREE.PlaneGeometry(0.6, 0.3).rotateX(-Math.PI / 2);
      const idx = new Float32Array(cap); for (let i = 0; i < cap; i++) idx[i] = i;
      g.setAttribute('aIdx', new THREE.InstancedBufferAttribute(idx, 1));
      const mat = new THREE.ShaderMaterial({ vertexShader: CRUMB_VERT, fragmentShader: CRUMB_FRAG, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        uniforms: { uColor: { value: color }, uCount: { value: 0 }, uFloor: { value: floor }, uPeak: { value: peak } } });
      const mesh = new THREE.InstancedMesh(g, mat, cap); mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 4; trailG.add(mesh);
      return { mesh, cap, n: 0, src: 0 };
    }
    const stride = low ? 3 : 1;
    const trails = { 'HOUND-01': makeTrail(low ? 300 : 900, 0.16, 0.8, pal.scan), 'TEAM-1': makeTrail(low ? 120 : 360, 0.07, 0.3, pal.text) };
    function syncTrail(id, state, fresh) {
      const T = trails[id], tr = state.units[id]?.trail; if (!tr) return;
      if (!fresh && tr.length === T.src) return;
      if (fresh || tr.length < T.src) T.n = 0;
      const want = Math.min(T.cap, Math.floor((tr.length - 1) / stride));
      const y = t.groundY + Y.trail;
      for (let k = T.n; k < want; k++) {
        const i = (k + 1) * stride, a = tr[i - stride], b = tr[i];
        m4.makeRotationY(Math.atan2(b[1] - a[1], b[0] - a[0])); m4.setPosition((a[0] + b[0]) / 2, y, -(a[1] + b[1]) / 2);
        T.mesh.setMatrixAt(k, m4);
      }
      if (want !== T.mesh.count || want !== T.n) { T.mesh.instanceMatrix.needsUpdate = true; T.mesh.count = want; T.mesh.material.uniforms.uCount.value = want; T.n = want; }
      T.src = tr.length;
    }

    // ---------- rescue route ----------
    let rescue = null;       // { key, legs: [...], extras: Group, total, reveal }
    function routeKey(r) {
      if (!r || !r.legs) return 0;
      let k = 1 + (r.plannedAt || 0) * 13 + r.legs.length * 1009;
      for (const l of r.legs) k += l.ok ? l.path.length * 7 + l.length * 3.1 + l.path[l.path.length - 1][0] : 0.5;
      return k;
    }
    function clearRescue() {
      if (!rescue) return;
      for (const L of rescue.legs) { L.label?.remove(); L.num.dispose(); }
      disposeTree(rescue.group); rescue = null;
    }
    function paintNumber(c, w, h, n, metres) {
      const u = w / 1.5;
      c.beginPath(); c.arc(w / 2, 0.62 * u, 0.5 * u, 0, Math.PI * 2); c.fillStyle = 'rgba(7,12,20,0.82)'; c.fill();
      c.lineWidth = 0.055 * u; c.strokeStyle = pal.css.accent; c.stroke();
      c.fillStyle = '#f2f6fb'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '600 ' + Math.round(0.62 * u) + 'px ' + FONT; c.fillText(String(n), w / 2, 0.65 * u);
      c.font = '500 ' + Math.round(0.3 * u) + 'px ' + FONT;
      c.lineWidth = 0.07 * u; c.strokeStyle = 'rgba(7,12,20,0.85)'; c.lineJoin = 'round'; c.strokeText(metres, w / 2, 1.42 * u);
      c.fillStyle = '#dfe7f0'; c.fillText(metres, w / 2, 1.42 * u);
    }
    function buildRescue(r, state, animate) {
      clearRescue();
      const group = new THREE.Group(); group.name = 'rescue route'; routeG.add(group);
      rescue = { key: routeKey(r), group, legs: [], total: 0, reveal: animate ? 0 : 1e6, palKey: pal.css.accent };
      let n = 0, first = true;
      for (const leg of r.legs) {
        if (!leg.ok || !leg.path || leg.path.length < 2) continue;
        n++;
        const pts = smoothPath(leg.path, { iterations: 3, radius: 1.0 });
        const geo = ribbonGeometry(THREE, pts, 1.1), len = geo.userData.length;
        const U = { uColor: { value: pal.accent }, uOk: { value: pal.ok }, uLen: { value: len }, uReveal: { value: 1e6 }, uFlow: { value: 0 }, uPlanned: { value: r.status === 'planned' ? 1 : 0 }, uCalm: { value: leg.arrivedAt != null || r.status === 'done' ? 1 : 0 }, uFadeIn: { value: first ? 1 : 0 }, uOpacity: { value: 1 } };
        const mesh = new THREE.Mesh(geo, decalMaterial(THREE, { vertexShader: VERT, fragmentShader: RESCUE_FRAG, uniforms: U, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
        mesh.position.y = t.groundY + Y.route + n * 0.0015; mesh.renderOrder = 5; mesh.frustumCulled = false; group.add(mesh); t.glow(mesh);
        // number and length, beside the end of the leg (not on top of the person)
        const end = pts[pts.length - 1], prev = pts[Math.max(0, pts.length - 4)];
        let dx = end[0] - prev[0], dy = end[1] - prev[1]; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        let at = [end[0] + dy * 1.7 - dx * 0.9, end[1] - dx * 1.7 - dy * 0.9];
        if (t.world.wallsCrossed(end, at).length) at = [end[0] - dy * 1.7 - dx * 0.9, end[1] + dx * 1.7 - dy * 0.9];
        if (t.world.wallsCrossed(end, at).length) at = [end[0] - dx * 1.5, end[1] - dy * 1.5];
        const num = groundText(THREE, 1.5, 1.9, 128); const metres = Math.round(leg.length) + ' m', nn = n;
        num.redraw((c, w, h) => paintNumber(c, w, h, nn, metres));
        num.mesh.position.copy(t.v3(at, t.groundY + Y.marker)); num.mesh.renderOrder = 6; num.material.opacity = animate ? 0 : 1; group.add(num.mesh);
        const L = { mesh, U, len, offset: rescue.total, num, n: nn, metres, label: null, extras: null, det: leg.det };
        if (leg.kind === 'break through') buildBreak(L, leg, state, group);
        rescue.legs.push(L); rescue.total += len; first = false;
      }
      applyLayer();
    }
    function buildBreak(L, leg, state, group) {
      const det = state.detections.find((d) => d.id === leg.det), a = leg.access;
      if (!det || !det.pos || !a) return;
      const b = det.pos, dl = dist2(a, b) || 1, ux = (b[0] - a[0]) / dl, uy = (b[1] - a[1]) / dl;
      let hit = null, hk = 2;
      for (const w of t.world.wallsCrossed(a, b)) { const k = segHit(a, b, w.a, w.b); if (k >= 0 && k < hk) { hk = k; hit = w; } }
      let x, nx, ny, thick = 0.2;                         // x = point on the wall, n = wall normal toward the access point
      if (hit) {
        x = [a[0] + (b[0] - a[0]) * hk, a[1] + (b[1] - a[1]) * hk];
        const wl = dist2(hit.a, hit.b) || 1, wx = (hit.b[0] - hit.a[0]) / wl, wy = (hit.b[1] - hit.a[1]) / wl;
        nx = -wy; ny = wx; if (nx * (a[0] - x[0]) + ny * (a[1] - x[1]) < 0) { nx = -nx; ny = -ny; }
        // keep the outline on the wall: at least 0.7 m from either end where the wall is long enough
        const along = (x[0] - hit.a[0]) * wx + (x[1] - hit.a[1]) * wy, c = wl > 1.5 ? clamp(along, 0.7, wl - 0.7) : wl / 2;
        x = [hit.a[0] + wx * c, hit.a[1] + wy * c]; thick = hit.mat === 'concrete' ? 0.19 : 0.11;
      } else { x = [a[0] + ux * 0.6, a[1] + uy * 0.6]; nx = -ux; ny = -uy; thick = 0.02; }
      const g = new THREE.Group(); group.add(g);
      const U = { uColor: { value: pal.accent }, uOpacity: { value: 1 } };
      const mk = (geo, frag, uniforms) => { const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide, uniforms: { ...U, ...uniforms } })); m.renderOrder = 30; m.frustumCulled = false; g.add(m); t.glow(m); return m; };
      const door = mk(new THREE.PlaneGeometry(1.1 + 0.16, 1.9 + 0.16), DOOR_FRAG, { uSize: { value: new THREE.Vector2(1.1, 1.9) } });
      door.position.copy(t.v3([x[0] + nx * (thick + 0.02), x[1] + ny * (thick + 0.02)], t.groundY + 0.95 + 0.03)); door.rotation.y = Math.atan2(nx, -ny);
      const cLen = 1.5, c0 = [x[0] + nx * (thick + cLen), x[1] + ny * (thick + cLen)], c1 = [x[0] + nx * thick, x[1] + ny * thick];
      const chev = mk(ribbonGeometry(THREE, [c0, c1], 1.0), FLOOR_FRAG, { uLen: { value: cLen }, uDots: { value: 0 } }); chev.position.y = t.groundY + Y.marker;
      const dots = mk(ribbonGeometry(THREE, [a, b], 0.14), FLOOR_FRAG, { uLen: { value: dl }, uDots: { value: 1 } }); dots.position.y = t.groundY + Y.marker + 0.004;
      L.extras = g; L.breakU = U;
      { const sub = (leg.gap ?? dl).toFixed(1) + ' m to the person', probe = t.label('Break through here', { tone: 'accent', sub, priority: 6, sel: { type: 'detection', id: leg.det } });
        if (!probe.setSub) probe.setText('Break through here · ' + sub); L.label = probe; }
      L.label.setPosition(t.v3([x[0] + nx * thick, x[1] + ny * thick], t.groundY + 2.15));
    }
    function syncRescue(state, dt, fresh) {
      const r = state.routes && state.routes.rescue, key = routeKey(r);
      if (!r) { if (rescue) clearRescue(); return; }
      if (!rescue || rescue.key !== key || rescue.palKey !== pal.css.accent) buildRescue(r, state, !fresh && !t.reduced && (!rescue || rescue.key !== key));
      if (!on.route) return;
      const R = rescue, done = r.status === 'done';
      if (R.reveal < R.total + 2) R.reveal += dt * Math.max(R.total, 1) / 1.2;
      const flowing = r.status === 'approved' && !t.reduced && state.running && !state.hold;
      let i = 0;
      for (const leg of r.legs) {
        if (!leg.ok || !leg.path || leg.path.length < 2) continue;
        const L = R.legs[i++]; if (!L) break;
        const U = L.U, calm = done || leg.arrivedAt != null ? 1 : 0, planned = r.status === 'planned' ? 1 : 0, k = fresh ? 1e3 : 7;
        U.uPlanned.value = damp(U.uPlanned.value, planned, k, dt); U.uCalm.value = damp(U.uCalm.value, calm, k, dt);
        if (flowing && !calm) U.uFlow.value = (U.uFlow.value + dt * 1.5) % 2.4;
        const rv = R.reveal - L.offset; U.uReveal.value = rv >= L.len ? 1e6 : rv;
        const shown = rv >= L.len ? 1 : 0, mo = L.num.material;
        mo.opacity = damp(mo.opacity, shown * (calm ? 0.55 : 1), fresh ? 1e3 : 9, dt);
        if (L.breakU) { L.breakU.uOpacity.value = damp(L.breakU.uOpacity.value, shown * (done ? 0.4 : planned ? 0.7 : 1), fresh ? 1e3 : 9, dt); }
      }
    }

    function showLabel(l, v) { if (!l) return; if (l.setVisible) l.setVisible(v); else if (l.el) l.el.style.visibility = v ? '' : 'hidden'; }
    function applyLayer() { routeG.visible = on.route; trailG.visible = on.trail; if (rescue) for (const L of rescue.legs) showLabel(L.label, on.route); }

    return {
      update(state, dt, time) {
        const fresh = watch(state);
        pathU.uColor.value.copy(pal.scan).lerp(pal.accent, 0.3);
        syncPath(state, dt, fresh);
        syncTrail('HOUND-01', state, fresh); syncTrail('TEAM-1', state, fresh);
        syncRescue(state, dt, fresh);
      },
      setLayer(id, v) { if (id in on) { on[id] = v; applyLayer(); } },
      onSelect() {},
      dispose() { clearRescue(); disposeTree(root); },
    };
  },
};
