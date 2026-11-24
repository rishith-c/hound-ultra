// Ground markers: listening stops (not visited / listening / done), staging, drone pad and entrance marks, and the
// one shared selection reticle that follows whatever ctx.selection points at. Driven by world.STOPS, world.SITE,
// state.sensors.listen, state.coverage and the live position of the selected thing. Everything is simulated.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { palette, Y, damp, clamp, stateWatcher, ribbonGeometry, outlineGeometry, ringGeometry, groundText, disposeTree, decalMaterial, FONT, SCALE } from './common.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// One quad per stop (2.4 m): ring, progress arc, ticks for finished windows, and a small check when done.
const STOP_FRAG = /* glsl */ `
uniform vec3 uScan, uOk, uText; uniform float uListen, uDone, uProgress, uTicks, uSel;
varying vec2 vUv;
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
void main() {
  vec2 p = (vUv - 0.5) * 2.4; float r = length(p), w = fwidth(r);
  float frac = fract(atan(p.x, p.y) / 6.2831853 + 1.0);                       // 0 at north, clockwise
  float lw = max(mix(0.014, 0.02, max(uListen, uDone)), w * 0.75);
  float ring = 1.0 - smoothstep(lw - w, lw + w, abs(r - 0.7));
  float disc = (1.0 - smoothstep(0.7 - w, 0.7 + w, r)) * mix(0.26, 0.42, uListen);
  vec3 col = mix(mix(uText, uScan, uListen), uOk, uDone * (1.0 - uListen));
  float a = max(disc * 0.0, ring * mix(mix(0.42, 0.5, uListen), 0.62, uDone));
  vec3 outc = col;
  // progress arc, with a soft inner glow behind the leading part
  float aw = max(0.045, w), arc = (1.0 - smoothstep(aw - w, aw + w, abs(r - 0.7))) * step(frac, uProgress) * uListen;
  float glow = exp(-abs(r - 0.7) / 0.06) * step(frac, uProgress) * uListen * 0.3;
  outc = mix(outc, uScan * 1.7, arc); a = max(a, max(arc, glow));
  // ticks: one per finished window, above the ring
  for (int i = 0; i < 3; i++) { if (float(i) >= uTicks) break;
    float ang = (float(i) - (uTicks - 1.0) * 0.5) * 0.3; vec2 c = vec2(sin(ang), cos(ang)) * 0.93;
    float d = length(p - c); float tk = (1.0 - smoothstep(0.05 - w, 0.05 + w, d)) * uListen; outc = mix(outc, uScan * 1.4, tk); a = max(a, tk); }
  // done: a small check badge at the lower right
  vec2 q = p - vec2(0.56, -0.56); float dq = length(q);
  float badge = (1.0 - smoothstep(0.2 - w, 0.2 + w, dq)) * uDone;
  float ck = min(seg(q, vec2(-0.085, 0.0), vec2(-0.02, -0.065)), seg(q, vec2(-0.02, -0.065), vec2(0.095, 0.07)));
  float check = (1.0 - smoothstep(0.022 - w, 0.022 + w, ck)) * uDone;
  float bring = (1.0 - smoothstep(0.016 - w, 0.016 + w, abs(dq - 0.2))) * uDone;
  vec3 dark = vec3(0.02, 0.035, 0.05);
  outc = mix(outc, dark, max(step(a, 0.01), badge)); a = max(a, max(disc, badge * 0.9));
  outc = mix(outc, uOk, max(check, bring)); a = max(a, max(check, bring));
  gl_FragColor = vec4(outc * (1.0 + uSel * 0.25), clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

// Thin lines that never get thinner than about a pixel (uv.y = -1 … 1 across a strip uWidth metres wide).
const LINE_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity, uLine;
varying vec2 vUv;
void main() {
  float ay = abs(vUv.y), w = fwidth(vUv.y), hw = max(uLine, w * 0.9);
  float a = (1.0 - smoothstep(hw - w, hw + w, ay)) * mix(1.0, 0.6, clamp((hw - uLine) * 2.0, 0.0, 1.0));
  gl_FragColor = vec4(uColor, a * uOpacity);
  #include <colorspace_fragment>
}`;

// Selection reticle for a point: ring, four ticks that turn slowly, one expanding pulse when the selection changes.
const RET_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uR, uRot, uPulse, uOpacity;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 3.2 * uR; float r = length(p), w = fwidth(r);
  float lw = max(0.018, w * 0.8);
  float ring = (1.0 - smoothstep(lw - w, lw + w, abs(r - uR))) * 0.8;
  float ang = atan(p.y, p.x) + uRot, sector = abs(fract(ang / 1.5707963 + 0.5) - 0.5) * 1.5707963 * r;   // arc distance to the nearest tick axis
  float tw = max(0.028, w);
  float tick = (1.0 - smoothstep(tw - w, tw + w, sector)) * smoothstep(uR * 1.1 - w, uR * 1.1 + w, r) * (1.0 - smoothstep(uR * 1.1 + 0.34 - w, uR * 1.1 + 0.34 + w, r));
  float pr = uR * (1.0 + uPulse * 0.55), pulse = (1.0 - smoothstep(0.03, 0.09 + w, abs(r - pr))) * (1.0 - uPulse) * (1.0 - uPulse) * 0.9;
  float soft = (1.0 - smoothstep(0.0, uR, r)) * 0.05;
  float a = max(max(ring, tick), pulse) + soft;
  gl_FragColor = vec4(uColor * (1.0 + 0.5 * max(tick, pulse)), clamp(a, 0.0, 1.0) * uOpacity);
  #include <colorspace_fragment>
}`;
// Selection outline for a room: a faint rectangle with bright corner brackets.
const ROOM_FRAG = /* glsl */ `
uniform vec3 uColor; uniform vec2 uSize; uniform float uPulse, uOpacity;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * (uSize + 0.6), hs = uSize * 0.5 - 0.18 + uPulse * 0.0, q = abs(p) - hs;
  float d = abs(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0)), w = fwidth(d);
  vec2 c = hs - abs(p); float arm = min(1.3, min(uSize.x, uSize.y) * 0.22);
  float corner = step(max(c.x, c.y), arm);
  float lw = max(mix(0.014, 0.04, corner), w * 0.8);
  float line = (1.0 - smoothstep(lw - w, lw + w, d)) * mix(0.32, 1.0, corner);
  float fill = step(max(q.x, q.y), 0.0) * 0.018 * (1.0 + (1.0 - uPulse) * 3.0);
  gl_FragColor = vec4(uColor * (1.0 + 0.4 * corner * line), clamp(line + fill, 0.0, 1.0) * uOpacity);
  #include <colorspace_fragment>
}`;

export default {
  id: 'markers', layers: [],
  create(t) {
    const { THREE } = t, pal = palette(t), W = t.world;
    const root = new THREE.Group(); root.name = 'markers'; t.scene.add(root);
    const watch = stateWatcher();
    const v = new THREE.Vector3();
    let sel = t.ctx.selection || null;

    // ---------- stops ----------
    const quad = new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2);
    function makeStop(id, pos) {
      const U = { uScan: { value: pal.scan }, uOk: { value: pal.ok }, uText: { value: pal.text }, uListen: { value: 0 }, uDone: { value: 0 }, uProgress: { value: 0 }, uTicks: { value: 0 }, uSel: { value: 0 } };
      const mesh = new THREE.Mesh(quad, decalMaterial(THREE, { vertexShader: VERT, fragmentShader: STOP_FRAG, uniforms: U }));
      mesh.renderOrder = 6; root.add(mesh); t.glow(mesh);
      const text = groundText(THREE, 0.9, 0.5, 160); text.mesh.renderOrder = 7; root.add(text.mesh);
      const S = { id: null, mesh, U, text, sel: { type: 'stop', id } };
      t.pickable(mesh, S.sel);
      setStop(S, id, pos);
      return S;
    }
    function setStop(S, id, pos) {
      if (S.id !== id) {
        S.id = id; S.sel.id = id;
        S.text.redraw((c, w, h) => { c.fillStyle = '#eef3f8'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '600 ' + Math.round(h * 0.7) + 'px ' + FONT; c.fillText(id, w / 2, h * 0.54); });
      }
      if (pos) { S.mesh.position.set(pos[0], t.groundY + Y.marker, -pos[1]); S.text.mesh.position.set(pos[0], t.groundY + Y.marker + 0.004, -pos[1]); }
    }
    const stops = W.STOPS.map((s) => ({ def: s, S: makeStop(s.id, s.pos) }));
    const vantage = makeStop('V1', [0, 0]); vantage.mesh.visible = vantage.text.mesh.visible = false;
    function driveStop(S, listening, done, listen, dt, fresh) {
      const U = S.U, k = fresh ? 1e3 : 10;
      U.uListen.value = damp(U.uListen.value, listening ? 1 : 0, k, dt); U.uDone.value = damp(U.uDone.value, done ? 1 : 0, k, dt);
      if (listening) { U.uProgress.value = clamp(listen.progress, 0, 1); U.uTicks.value = Math.min(3, Math.max(0, (listen.window || 1) - 1)); }
      S.text.material.opacity = damp(S.text.material.opacity, listening ? 1 : done ? 0.62 : 0.5, k, dt);
      U.uSel.value = sel && sel.type === 'stop' && sel.id === S.id ? 1 : 0;
    }

    // ---------- staging, drone pad, entrance: one merged set of thin lines ----------
    const parts = [], LW = 0.24;
    const strip = (pts) => parts.push(ribbonGeometry(THREE, pts, LW));
    const ring = (c, r, a0 = 0, len = Math.PI * 2) => { const g = ringGeometry(THREE, r - LW / 2, r + LW / 2, 72, a0, len); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 2 - 1); g.translate(c[0], 0, -c[1]); parts.push(g); };
    { const [sx, sy] = W.SITE.staging, hw = 4.2, hh = 3.2, arm = 1.3;
      for (const [ax, ay] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) strip([[sx + ax * hw, sy + ay * (hh - arm)], [sx + ax * hw, sy + ay * hh], [sx + ax * (hw - arm), sy + ay * hh]]);
      const d = W.SITE.dronePad; ring(d, 1.55); ring(d, 0.3);
      for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a); strip([[d[0] + c * 1.85, d[1] + s * 1.85], [d[0] + c * 2.35, d[1] + s * 2.35]]); }
      const e = W.SITE.entrance, door = (W.DOORS.find((x) => x.id === 'entrance') || { pos: [e[0], e[1] + 3], w: 2.4 }), ew = door.w / 2 + 0.25;
      for (const s of [-1, 1]) strip([[e[0] + s * (ew - 0.55), e[1] - 0.6], [e[0] + s * ew, e[1] - 0.6], [e[0] + s * ew, e[1] + 1.9], [e[0] + s * (ew - 0.55), e[1] + 1.9]]);
      strip([[e[0] - 0.42, e[1] + 0.35], [e[0], e[1] + 0.85], [e[0] + 0.42, e[1] + 0.35]]);
    }
    const site = new THREE.Mesh(mergeGeometries(parts.map((g) => { g.deleteAttribute('normal'); return g; })), decalMaterial(THREE, { vertexShader: VERT, fragmentShader: LINE_FRAG, uniforms: { uColor: { value: pal.text }, uOpacity: { value: 0.4 }, uLine: { value: 0.2 } } }));
    parts.forEach((g) => g.dispose());
    site.position.y = t.groundY + Y.marker - 0.01; site.renderOrder = 4; root.add(site);
    const places = [['Staging', W.SITE.staging, 0.5], ['Drone pad', W.SITE.dronePad, 0.5], ['Entrance', W.SITE.entrance, 0.5]].map(([text, p, h]) => { const l = t.label(text, { tone: 'muted', priority: 3 }); l.setPosition(t.v3(p, t.groundY + h)); return l; });

    // ---------- selection ----------
    const selG = new THREE.Group(); selG.visible = false; root.add(selG);
    const colU = { value: new THREE.Color() };
    const overlay = (geo, frag, uniforms) => { const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide, uniforms: { uColor: colU, uOpacity: { value: 1 }, ...uniforms } })); m.renderOrder = 40; m.frustumCulled = false; m.visible = false; selG.add(m); t.glow(m); return m; };
    const unit = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const ret = overlay(unit, RET_FRAG, { uR: { value: 1 }, uRot: { value: 0 }, uPulse: { value: 1 } });
    const room = overlay(unit, ROOM_FRAG, { uSize: { value: new THREE.Vector2(1, 1) }, uPulse: { value: 1 } });
    const hz = overlay(new THREE.BufferGeometry(), LINE_FRAG, { uLine: { value: 0.22 } });
    const pole = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, toneMapped: false }));
    pole.renderOrder = 40; pole.frustumCulled = false; pole.visible = false; selG.add(pole);
    const T = { x: 0, y: 0, r: 1, alt: 0 };                 // where the selected thing is now
    let pulse = 1, rot = 0, snap = true, hzFor = null, evIdx = -1, shownKind = '';

    function resolve(state) {
      const s = sel; T.alt = 0;
      if (!s || !s.type) return '';
      let p = null;
      if (s.type === 'detection') { const d = state.detections.find((x) => x.id === s.id); if (d && d.pos) { p = d.pos; T.r = Math.max(0.9, d.posSigma || 0); } }
      else if (s.type === 'survivor') { const d = state.survivors && state.survivors[s.id]; if (d && d.pos) { p = d.pos; T.r = Math.max(0.9, d.posSigma || 0); } }
      else if (s.type === 'unit') { const u = state.units[s.id]; if (u && u.pos) { p = u.pos; T.r = u.kind === 'drone' ? 0.45 * SCALE.drone : u.kind === 'team' ? 1.5 : 0.75 * SCALE.rover; if (u.kind === 'drone') T.alt = u.alt || 0; } }
      else if (s.type === 'stop') { const d = W.STOPS.find((x) => x.id === s.id), l = state.sensors.listen; if (d) p = d.pos; else if (l && l.stop === s.id) p = state.units['HOUND-01'].pos; T.r = 1.0; }
      else if (s.type === 'event') {
        const ev = state.events; let e = ev[evIdx];
        if (!e || e.id !== s.id) { evIdx = ev.findIndex((x) => x.id === s.id); e = ev[evIdx]; }
        if (e && e.pos) { p = e.pos; T.r = 0.9; }
      }
      else if (s.type === 'room') { const r = W.roomById(s.id); if (!r) return ''; const q = r.rect; T.x = (q[0] + q[2]) / 2; T.y = (q[1] + q[3]) / 2; room.material.uniforms.uSize.value.set(q[2] - q[0], q[3] - q[1]); return 'room'; }
      else if (s.type === 'hazard') {
        const h = W.HAZARDS.find((x) => x.id === s.id) || (state.hazards || []).find((x) => x.id === s.id); if (!h) return '';
        if (hzFor !== s.id) { hz.geometry.dispose(); hz.geometry = outlineGeometry(THREE, h.poly, 0.3); hzFor = s.id; }
        return 'hazard';
      }
      if (!p) return '';
      T.x = p[0]; T.y = p[1]; return 'point';
    }

    return {
      update(state, dt, time) {
        const fresh = watch(state);
        // stops
        const listen = state.sensors.listen, cov = state.coverage;
        let onStop = false;
        for (const { def, S } of stops) {
          const listening = !!listen && listen.stop === def.id; if (listening) onStop = true;
          let done = false; for (const id of def.covers) if (cov[id] && cov[id].stop === def.id) done = true;
          driveStop(S, listening, done, listen, dt, fresh);
        }
        const vOn = !!listen && !onStop && !!listen.stop;
        if (vOn) { setStop(vantage, String(listen.stop), state.units['HOUND-01'].pos); driveStop(vantage, true, false, listen, dt, !vantage.mesh.visible || fresh); }
        vantage.mesh.visible = vantage.text.mesh.visible = vOn;

        // selection
        const kind = resolve(state);
        if (!kind) { selG.visible = false; shownKind = ''; return; }
        if (kind !== shownKind || fresh) snap = true;
        shownKind = kind; selG.visible = true;
        colU.value.copy(pal.scan).multiplyScalar(1.25);
        if (pulse < 1) pulse = Math.min(1, pulse + dt / 0.65);
        if (!t.reduced) rot += dt * 0.22;
        ret.visible = kind === 'point'; room.visible = kind === 'room'; hz.visible = kind === 'hazard'; pole.visible = kind === 'point' && T.alt > 0.5;
        if (kind === 'point') {
          if (snap) ret.position.set(T.x, t.groundY + Y.select, -T.y);
          else { ret.position.x = damp(ret.position.x, T.x, 18, dt); ret.position.z = damp(ret.position.z, -T.y, 18, dt); }
          const U = ret.material.uniforms; U.uR.value = snap ? T.r : damp(U.uR.value, T.r, 10, dt); U.uRot.value = rot; U.uPulse.value = pulse;
          ret.scale.setScalar(3.2 * U.uR.value);
          if (pole.visible) { pole.position.copy(ret.position); pole.scale.y = T.alt; pole.material.color.copy(pal.scan); }
        } else if (kind === 'room') {
          const sz = room.material.uniforms.uSize.value; room.position.set(T.x, t.groundY + Y.select, -T.y); room.scale.set(sz.x + 0.6, 1, sz.y + 0.6); room.material.uniforms.uPulse.value = pulse;
        } else { hz.position.y = t.groundY + Y.select; hz.material.uniforms.uOpacity.value = 0.9 + (1 - pulse) * 0.1; }
        snap = false;
      },
      setLayer() {},
      onSelect(s) { sel = s || null; snap = true; evIdx = -1; pulse = t.reduced ? 1 : 0; },
      dispose() { for (const l of places) l.remove(); for (const { S } of stops) S.text.dispose(); vantage.text.dispose(); disposeTree(root); },
    };
  },
};
