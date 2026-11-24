// Ground markers: listening stops (not visited / listening / done), staging, drone pad and entrance marks, and the
// one shared selection mark that follows whatever ctx.selection points at. Driven by world.STOPS, world.SITE,
// state.sensors.listen, state.coverage and the live position of the selected thing. Everything is simulated.
// Quiet by design: hairlines of 2 to 3 cm, no glow. Demo shows only the arc of the stop being listened at.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { palette, Y, damp, clamp, stateWatcher, ribbonGeometry, outlineGeometry, ringGeometry, groundText, disposeTree, decalMaterial, FONT, SCALE } from './common.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// One quad per stop (2.4 m): a hairline ring, a hair-thin progress arc, a short tick when done.
const STOP_FRAG = /* glsl */ `
uniform vec3 uScan, uOk, uText; uniform float uListen, uDone, uProgress, uTicks, uAdv, uSel;
varying vec2 vUv;
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float hair(float d, float hw, float w) { float g = max(hw, w * 0.7); return (1.0 - smoothstep(g - w * 0.5, g + w * 0.5, d)) * min(1.0, 0.35 + hw / max(w, 1e-4)); }
void main() {
  vec2 p = (vUv - 0.5) * 2.4; float r = length(p), w = fwidth(r);
  float frac = fract(atan(p.x, p.y) / 6.2831853 + 1.0);                       // 0 at north, clockwise
  float R = 0.78;
  float ring = hair(abs(r - R), 0.008, w) * mix(0.2, 0.12, uListen) * uAdv;
  float arc = hair(abs(r - R), 0.012, w) * (1.0 - smoothstep(uProgress - 0.004, uProgress + 0.001, frac)) * uListen * 0.5;
  float lead = exp(-abs(r - R) / 0.02) * exp(-max(uProgress - frac, 0.0) * 18.0) * step(frac, uProgress) * uListen * 0.14;
  float win = 0.0;                                                            // one short notch for each finished window
  for (int i = 0; i < 3; i++) { if (float(i) >= uTicks) break; float an = (float(i) - (uTicks - 1.0) * 0.5) * 0.12; vec2 c = vec2(sin(an), cos(an)); win = max(win, hair(seg(p, c * (R + 0.06), c * (R + 0.12)), 0.01, w)); }
  win *= uListen * 0.45;
  vec2 q = p - vec2(0.0, -R);                                                 // done: a small tick on the ring
  float ck = min(seg(q, vec2(-0.075, 0.0), vec2(-0.02, -0.055)), seg(q, vec2(-0.02, -0.055), vec2(0.085, 0.065)));
  float tick = hair(ck, 0.014, w) * uDone * 0.5 * uAdv;
  vec3 c = mix(uText, uScan, uListen) * 0.8; float a = max(ring, max(arc + lead, win));
  c = mix(c, uOk * 0.75, step(a, tick)); a = max(a, tick) * (1.0 + 0.5 * uSel);
  if (a < 0.004) discard;
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

// Thin lines that never get thinner than about a pixel (uv.y = -1 … 1 across the strip); they fade instead.
const LINE_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity, uLine;
varying vec2 vUv;
void main() {
  float ay = abs(vUv.y), w = fwidth(vUv.y), hw = max(uLine, w * 0.7);
  float a = (1.0 - smoothstep(hw - w * 0.5, hw + w * 0.5, ay)) * min(1.0, 0.4 + uLine / max(w, 1e-4));
  gl_FragColor = vec4(uColor, a * uOpacity);
  #include <colorspace_fragment>
}`;
// Selection: four corner ticks around a point (uR = half size of the square).
const RET_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uR, uIn, uOpacity;
varying vec2 vUv;
void main() {
  vec2 p = abs((vUv - 0.5) * 3.2 * uR), w2 = fwidth(p); float w = max(w2.x, w2.y), hs = uR * (1.1 + 0.18 * (1.0 - uIn)), arm = uR * 0.32;
  float hw = max(0.012, w * 0.6);
  float lx = (1.0 - smoothstep(hw - w * 0.5, hw + w * 0.5, abs(p.x - hs))) * step(hs - arm, p.y) * step(p.y, hs + hw);
  float ly = (1.0 - smoothstep(hw - w * 0.5, hw + w * 0.5, abs(p.y - hs))) * step(hs - arm, p.x) * step(p.x, hs + hw);
  float a = max(lx, ly) * 0.75 * uIn * uOpacity; if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;
// Selection outline for a room: corner ticks only.
const ROOM_FRAG = /* glsl */ `
uniform vec3 uColor; uniform vec2 uSize; uniform float uIn, uOpacity;
varying vec2 vUv;
void main() {
  vec2 p = abs((vUv - 0.5) * (uSize + 0.6)), hs = uSize * 0.5 - 0.25, w2 = fwidth(p); float w = max(w2.x, w2.y), hw = max(0.014, w * 0.6), arm = 0.6;
  float lx = (1.0 - smoothstep(hw - w * 0.5, hw + w * 0.5, abs(p.x - hs.x))) * step(hs.y - arm, p.y) * step(p.y, hs.y + hw);
  float ly = (1.0 - smoothstep(hw - w * 0.5, hw + w * 0.5, abs(p.y - hs.y))) * step(hs.x - arm, p.x) * step(p.x, hs.x + hw);
  float a = max(lx, ly) * 0.7 * uIn * uOpacity; if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

export default {
  id: 'markers', layers: [],
  create(t) {
    const { THREE } = t, pal = palette(t), W = t.world;
    const root = new THREE.Group(); root.name = 'markers'; t.scene.add(root);
    const watch = stateWatcher();
    let sel = t.ctx.selection || null, adv = -1;

    // ---------- stops ----------
    const quad = new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2), advU = { value: 1 };
    function makeStop(id, pos) {
      const U = { uScan: { value: pal.scan }, uOk: { value: pal.ok }, uText: { value: pal.text }, uListen: { value: 0 }, uDone: { value: 0 }, uProgress: { value: 0 }, uTicks: { value: 0 }, uAdv: advU, uSel: { value: 0 } };
      const mesh = new THREE.Mesh(quad, decalMaterial(THREE, { vertexShader: VERT, fragmentShader: STOP_FRAG, uniforms: U }));
      mesh.renderOrder = 6; root.add(mesh);
      const text = groundText(THREE, 0.5, 0.24, 200); text.mesh.renderOrder = 7; text.material.opacity = 0; root.add(text.mesh);
      const S = { id: null, mesh, U, text, sel: { type: 'stop', id }, quiet: 0 };
      t.pickable(mesh, S.sel);
      setStop(S, id, pos);
      return S;
    }
    function setStop(S, id, pos) {
      if (S.id !== id) {
        S.id = id; S.sel.id = id;
        S.text.redraw((c, w, h) => { c.fillStyle = '#eef3f8'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '400 ' + Math.round(h * 0.72) + 'px "Instrument Sans", ' + FONT; c.fillText(id, w / 2, h * 0.54); });
      }
      if (pos) { S.mesh.position.set(pos[0], t.groundY + Y.marker, -pos[1]); S.text.mesh.position.set(pos[0], t.groundY + Y.marker + 0.004, -(pos[1] + 0.98)); }
    }
    const stops = W.STOPS.map((s) => ({ def: s, S: makeStop(s.id, s.pos) }));
    const vantage = makeStop('V1', [0, 0]); vantage.mesh.visible = vantage.text.mesh.visible = false;
    function driveStop(S, listening, done, listen, dt, fresh) {
      const U = S.U, k = fresh ? 1e3 : 6;
      U.uListen.value = damp(U.uListen.value, listening ? 1 : 0, k, dt); U.uDone.value = damp(U.uDone.value, done ? 1 : 0, k, dt);
      if (listening) { U.uProgress.value = clamp(listen.progress, 0, 1); U.uTicks.value = Math.min(3, Math.max(0, (listen.window || 1) - 1)); }
      S.quiet = damp(S.quiet, listening ? 0.5 : 0.3, k, dt); S.text.material.opacity = S.quiet * advU.value;
      U.uSel.value = sel && sel.type === 'stop' && sel.id === S.id ? 1 : 0;
      S.mesh.visible = advU.value > 0.004 || U.uListen.value > 0.004; S.text.mesh.visible = advU.value > 0.004;
    }

    // ---------- staging, drone pad, entrance: one merged set of thin lines ----------
    const parts = [], LW = 0.16;
    const strip = (pts) => parts.push(ribbonGeometry(THREE, pts, LW));
    const ring = (c, r, a0 = 0, len = Math.PI * 2) => { const g = ringGeometry(THREE, r - LW / 2, r + LW / 2, 72, a0, len); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 2 - 1); g.translate(c[0], 0, -c[1]); parts.push(g); };
    { const [sx, sy] = W.SITE.staging, hw = 4.2, hh = 3.2, arm = 0.6;
      for (const [ax, ay] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) strip([[sx + ax * hw, sy + ay * (hh - arm)], [sx + ax * hw, sy + ay * hh], [sx + ax * (hw - arm), sy + ay * hh]]);
      const d = W.SITE.dronePad; ring(d, 1.55);
      for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a); strip([[d[0] + c * 1.85, d[1] + s * 1.85], [d[0] + c * 2.15, d[1] + s * 2.15]]); }
      const e = W.SITE.entrance, door = (W.DOORS.find((x) => x.id === 'entrance') || { pos: [e[0], e[1] + 3], w: 2.4 }), ew = door.w / 2 + 0.25;
      for (const s of [-1, 1]) strip([[e[0] + s * ew, e[1] - 0.2], [e[0] + s * ew, e[1] - 0.6], [e[0] + s * (ew - 0.4), e[1] - 0.6]]);
      strip([[e[0] - 0.3, e[1] + 0.35], [e[0], e[1] + 0.65], [e[0] + 0.3, e[1] + 0.35]]);
    }
    const site = new THREE.Mesh(mergeGeometries(parts.map((g) => { g.deleteAttribute('normal'); return g; })), decalMaterial(THREE, { vertexShader: VERT, fragmentShader: LINE_FRAG, uniforms: { uColor: { value: pal.text }, uOpacity: { value: 0 }, uLine: { value: 0.15 } } }));
    parts.forEach((g) => g.dispose());
    site.position.y = t.groundY + Y.marker - 0.01; site.renderOrder = 4; root.add(site);
    const places = [['Staging', W.SITE.staging, 0.5], ['Drone pad', W.SITE.dronePad, 0.5], ['Entrance', W.SITE.entrance, 0.5]].map(([text, p, h]) => { const l = t.label(text, { tone: 'muted', priority: 3 }); l.setPosition(t.v3(p, t.groundY + h)); return l; });
    let placesOn = true;

    // ---------- selection ----------
    const selG = new THREE.Group(); selG.visible = false; root.add(selG);
    const colU = { value: new THREE.Color() };
    const overlay = (geo, frag, uniforms) => { const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide, uniforms: { uColor: colU, uOpacity: { value: 1 }, ...uniforms } })); m.renderOrder = 40; m.frustumCulled = false; m.visible = false; selG.add(m); return m; };
    const unit = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const ret = overlay(unit, RET_FRAG, { uR: { value: 1 }, uIn: { value: 0 } });
    const room = overlay(unit, ROOM_FRAG, { uSize: { value: new THREE.Vector2(1, 1) }, uIn: { value: 0 } });
    const hz = overlay(new THREE.BufferGeometry(), LINE_FRAG, { uLine: { value: 0.1 } });
    const pole = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false, toneMapped: false }));
    pole.renderOrder = 40; pole.frustumCulled = false; pole.visible = false; selG.add(pole);
    const T = { x: 0, y: 0, r: 1, alt: 0 };                 // where the selected thing is now
    let intro = 1, snap = true, hzFor = null, evIdx = -1, shownKind = '';

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
        if (hzFor !== s.id) { hz.geometry.dispose(); hz.geometry = outlineGeometry(THREE, h.poly, 0.25); hzFor = s.id; }
        return 'hazard';
      }
      if (!p) return '';
      T.x = p[0]; T.y = p[1]; return 'point';
    }

    return {
      update(state, dt) {
        const fresh = watch(state);
        // Demo keeps only the arc of the stop being listened at; the rest fades.
        const goal = t.ctx.mode === 'demo' ? 0 : 1; adv = adv < 0 || t.reduced ? goal : clamp(adv + Math.sign(goal - adv) * dt / 0.4, 0, 1);
        advU.value = adv; site.material.uniforms.uOpacity.value = 0.3 * adv; site.visible = adv > 0.004;
        const showPlaces = adv > 0.5; if (showPlaces !== placesOn) { placesOn = showPlaces; for (const l of places) l.setVisible(placesOn); }
        // stops
        const listen = state.sensors.listen, cov = state.coverage;
        let onStop = false;
        for (const { def, S } of stops) {
          const listening = !!listen && listen.stop === def.id; if (listening) onStop = true;
          let done = false; for (const id of def.covers) if (cov[id] && cov[id].stop === def.id) done = true;
          driveStop(S, listening, done, listen, dt, fresh);
        }
        const vOn = !!listen && !onStop && !!listen.stop;
        if (vOn) { const first = !vantage.mesh.visible; setStop(vantage, String(listen.stop), state.units['HOUND-01'].pos); driveStop(vantage, true, false, listen, dt, first || fresh); }
        else vantage.mesh.visible = vantage.text.mesh.visible = false;

        // selection
        const kind = resolve(state);
        if (!kind) { selG.visible = false; shownKind = ''; return; }
        if (kind !== shownKind || fresh) snap = true;
        shownKind = kind; selG.visible = true;
        colU.value.copy(pal.scan).multiplyScalar(0.85);
        if (intro < 1) intro = Math.min(1, intro + dt / 0.35);
        const e = 1 - (1 - intro) * (1 - intro) * (1 - intro);
        ret.visible = kind === 'point'; room.visible = kind === 'room'; hz.visible = kind === 'hazard'; pole.visible = kind === 'point' && T.alt > 0.5;
        if (kind === 'point') {
          if (snap) ret.position.set(T.x, t.groundY + Y.select, -T.y);
          else { ret.position.x = damp(ret.position.x, T.x, 18, dt); ret.position.z = damp(ret.position.z, -T.y, 18, dt); }
          const U = ret.material.uniforms; U.uR.value = snap ? T.r : damp(U.uR.value, T.r, 10, dt); U.uIn.value = e;
          ret.scale.setScalar(3.2 * U.uR.value);
          if (pole.visible) { pole.position.copy(ret.position); pole.scale.y = T.alt; pole.material.color.copy(pal.scan); }
        } else if (kind === 'room') {
          const sz = room.material.uniforms.uSize.value; room.position.set(T.x, t.groundY + Y.select, -T.y); room.scale.set(sz.x + 0.6, 1, sz.y + 0.6); room.material.uniforms.uIn.value = e;
        } else { hz.position.y = t.groundY + Y.select; hz.material.uniforms.uOpacity.value = 0.5 * e; }
        snap = false;
      },
      setLayer() {},
      onSelect(s) { sel = s || null; snap = true; evIdx = -1; intro = t.reduced ? 1 : 0; },
      dispose() { for (const l of places) l.remove(); for (const { S } of stops) S.text.dispose(); vantage.text.dispose(); disposeTree(root); },
    };
  },
};
