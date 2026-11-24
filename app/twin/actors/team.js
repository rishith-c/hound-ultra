// Rescue team 1: three figures at true scale (about 1.75 m) that walk in file along the path already walked,
// kneel by a person, and swing a tool at a wall on a "break through" leg. Driven by state.units['TEAM-1'] and
// state.routes.rescue. The team is simulated.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { palette, damp, dampAngle, clamp, lerp, stateWatcher, disposeTree, dist2 } from './common.js';

const LT = 0.43, LS = 0.48;            // hip to knee, knee to sole
const GAP = 1.3;                       // metres between people in file
const FORM = [[0, 0], [-0.95, 0.6], [-1.0, -0.65]];   // standing group at home: [back, left] offsets
const DUST_VERT = /* glsl */ `
attribute vec3 aVel; attribute float aSeed; uniform float uAge, uPx; varying float vA;
void main() {
  float k = clamp(uAge / (0.7 + aSeed * 0.4), 0.0, 1.0);
  vec3 p = position + aVel * (1.0 - exp(-3.0 * uAge)) / 3.0; p.y -= 0.25 * uAge * uAge;
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.18 + 0.7 * k) * (0.6 + aSeed) * uPx / max(-mv.z, 0.1);
  vA = smoothstep(0.0, 0.1, k) * pow(1.0 - k, 1.5) * 0.3;
}`;
const DUST_FRAG = /* glsl */ `
varying float vA;
void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = vA * exp(-r * r * 3.0) * (1.0 - smoothstep(0.85, 1.0, r)); if (a < 0.003) discard;
  gl_FragColor = vec4(vec3(0.42, 0.4, 0.37), a);
  #include <colorspace_fragment>
}`;

function segHit(p, q, a, b) {
  const rx = q[0] - p[0], ry = q[1] - p[1], sx = b[0] - a[0], sy = b[1] - a[1], den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const k = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / den, m = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / den;
  return k >= 0 && k <= 1 && m >= 0 && m <= 1 ? k : -1;
}

export default {
  id: 'team', layers: [],
  create(t) {
    const { THREE } = t, pal = palette(t), low = t.quality === 'low';
    const root = new THREE.Group(); root.name = 'team'; t.scene.add(root);
    const seg = low ? 6 : 12, cap = low ? 3 : 5;

    // ---------- body parts: each rigid segment is one merged, vertex-coloured geometry ----------
    const C = { suit: new THREE.Color(0x353a42), pack: new THREE.Color(0x4b5560), band: new THREE.Color(0xb9c0b2), helmet: new THREE.Color(0xc4c8cc), skin: new THREE.Color(0xb48c72), boot: new THREE.Color(0x17191c), glove: new THREE.Color(0x202328), steel: new THREE.Color(0x9aa1a9) };
    function part(g, color, x = 0, y = 0, z = 0, rz = 0, rx = 0) {
      if (g.index) { const n = g.toNonIndexed(); g.dispose(); g = n; }
      g.deleteAttribute('uv'); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); g.translate(x, y, z);
      const n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([color.r, color.g, color.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    }
    const merge = (list) => { const g = mergeGeometries(list); list.forEach((x) => x.dispose()); return g; };
    const caps = (r, len) => new THREE.CapsuleGeometry(r, len, cap, seg);
    const rbox = (x, y, z, r) => new RoundedBoxGeometry(x, y, z, low ? 2 : 3, r);
    const G = {
      torso: merge([
        part(rbox(0.21, 0.22, 0.31, 0.08), C.suit, 0, 0.05, 0),                                // hips
        part(rbox(0.24, 0.42, 0.37, 0.1), C.suit, 0, 0.34, 0),                                 // jacket
        part(rbox(0.25, 0.045, 0.38, 0.02), C.band, 0, 0.3, 0),                                // reflective bands
        part(rbox(0.225, 0.04, 0.325, 0.018), C.band, 0, 0.1, 0),
        part(rbox(0.17, 0.4, 0.29, 0.07), C.pack, -0.185, 0.35, 0),                            // backpack
        part(caps(0.05, 0.2), C.pack, -0.185, 0.585, 0, 0, Math.PI / 2),                       // bed roll on top
        part(rbox(0.02, 0.3, 0.05, 0.008), C.pack, 0.118, 0.38, 0.11), part(rbox(0.02, 0.3, 0.05, 0.008), C.pack, 0.118, 0.38, -0.11),   // straps
        part(new THREE.CylinderGeometry(0.05, 0.056, 0.09, seg), C.skin, 0, 0.585, 0),
        part(new THREE.SphereGeometry(0.103, seg + 4, seg), C.skin, 0.005, 0.69, 0),
        part(new THREE.SphereGeometry(0.128, seg + 4, seg, 0, Math.PI * 2, 0, Math.PI * 0.56), C.helmet, 0, 0.708, 0),
        part(new THREE.CylinderGeometry(0.139, 0.142, 0.016, seg + 4), C.helmet, 0.014, 0.69, 0),   // brim
        part(rbox(0.03, 0.03, 0.045, 0.008), C.boot, 0.122, 0.745, 0),                         // torch housing
      ]),
      upper: merge([part(caps(0.052, 0.19), C.suit, 0, -0.135, 0), part(new THREE.CylinderGeometry(0.056, 0.056, 0.036, seg), C.band, 0, -0.2, 0)]),
      fore: merge([part(caps(0.044, 0.17), C.suit, 0, -0.12, 0), part(new THREE.SphereGeometry(0.047, seg, seg - 2), C.glove, 0, -0.265, 0)]),
      thigh: merge([part(caps(0.078, 0.28), C.suit, 0, -0.2, 0)]),
      shin: merge([part(caps(0.062, 0.26), C.suit, 0, -0.2, 0), part(new THREE.CylinderGeometry(0.066, 0.066, 0.04, seg), C.band, 0, -0.29, 0), part(rbox(0.27, 0.11, 0.11, 0.045), C.boot, 0.055, -0.425, 0)]),
    };
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 });
    const N = 3;
    const IM = {};
    for (const [k, n] of [['torso', 1], ['upper', 2], ['fore', 2], ['thigh', 2], ['shin', 2]]) {
      const m = new THREE.InstancedMesh(G[k], bodyMat, N * n); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; root.add(m); IM[k] = m;
    }
    const torchMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().copy(pal.scan).multiplyScalar(2.2), toneMapped: false });
    const torch = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 8, 6), torchMat, N); torch.frustumCulled = false; root.add(torch); t.glow(torch);
    const tool = new THREE.Mesh(merge([part(new THREE.CylinderGeometry(0.016, 0.016, 0.78, 8), C.boot, 0.3, -0.265, 0, Math.PI / 2), part(rbox(0.1, 0.17, 0.1, 0.02), C.steel, 0.68, -0.265, 0)]), bodyMat);
    tool.matrixAutoUpdate = false; tool.castShadow = true; tool.visible = false; tool.frustumCulled = false; root.add(tool);

    // ---------- rigs (not in the scene: only their matrices are used) ----------
    function makeRig(i) {
      const R = { root: new THREE.Group(), pelvis: new THREE.Group(), torso: new THREE.Group(), arm: [], fore: [], thigh: [], shin: [], torch: new THREE.Group() };
      R.root.add(R.pelvis); R.pelvis.add(R.torso); R.torso.add(R.torch); R.torch.position.set(0.14, 0.745, 0);
      for (const s of [-1, 1]) {
        const a = new THREE.Group(), f = new THREE.Group(), th = new THREE.Group(), sh = new THREE.Group();
        a.position.set(0, 0.5, s * 0.228); f.position.set(0, -0.3, 0); a.add(f); R.torso.add(a);
        th.position.set(0, 0, s * 0.095); sh.position.set(0, -LT, 0); th.add(sh); R.pelvis.add(th);
        R.arm.push(a); R.fore.push(f); R.thigh.push(th); R.shin.push(sh);
      }
      const proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.8, 8), new THREE.MeshBasicMaterial({ visible: false })); proxy.position.y = 0.9;
      const hit = new THREE.Group(); hit.add(proxy); root.add(hit); t.pickable(hit, { type: 'unit', id: 'TEAM-1' });
      return { i, R, hit, x: 0, y: 0, h: 0, phase: i * 2.1, w: 0, sp: 0, pose: new Float32Array(11), scale: 1 - i * 0.025 };
    }
    const figs = [0, 1, 2].map(makeRig);
    const home = (t.world.UNITS.find((u) => u.id === 'TEAM-1') || {}).home || [22, 9];
    const B = t.world.BUILDING.rect, homeHeading = Math.atan2((B[1] + B[3]) / 2 - home[1], (B[0] + B[2]) / 2 - home[0]);

    // impact dust for the tool
    const DN = low ? 4 : 12, dpos = new Float32Array(DN * 3), dvel = new Float32Array(DN * 3), dseed = new Float32Array(DN);
    for (let i = 0; i < DN; i++) dseed[i] = (i * 0.618) % 1;
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3)); dg.setAttribute('aVel', new THREE.BufferAttribute(dvel, 3)); dg.setAttribute('aSeed', new THREE.BufferAttribute(dseed, 1));
    const dust = new THREE.Points(dg, new THREE.ShaderMaterial({ vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, toneMapped: false, uniforms: { uAge: { value: 9 }, uPx: { value: 500 } } }));
    dust.frustumCulled = false; dust.visible = false; dust.renderOrder = 9; root.add(dust);
    function puff(x, y, nx, ny) {
      for (let i = 0; i < DN; i++) {
        const s = dseed[i], a = s * 6.283 * 3.0, sp = 0.5 + s * 1.1;
        dpos.set([x, t.groundY + 1.05 + Math.sin(a) * 0.12, -y], i * 3);
        dvel.set([nx * sp + Math.cos(a * 1.7) * 0.5, 0.3 + Math.sin(a) * 0.6, -(ny * sp + Math.sin(a * 2.3) * 0.5)], i * 3);
      }
      dg.attributes.position.needsUpdate = dg.attributes.aVel.needsUpdate = true;
      dust.material.uniforms.uAge.value = 0; dust.material.uniforms.uPx.value = t.renderer.domElement.height * t.camera.projectionMatrix.elements[5] * 0.5; dust.visible = true;
    }

    const label = t.label('Rescue team 1', { priority: 6, sub: '', sel: { type: 'unit', id: 'TEAM-1' } });
    let labelSub = null;
    function setSub(s) { if (s === labelSub) return; labelSub = s; if (label.setSub) label.setSub(s); else label.setText(s ? 'Rescue team 1 · ' + s : 'Rescue team 1'); }

    // The point d metres back along [trail..., pos]. Returns how much of d the history could not cover.
    const bk = { x: 0, y: 0, h: 0 };
    function back(trail, pos, d) {
      let px = pos[0], py = pos[1], left = d; bk.h = NaN;
      for (let i = trail.length - 1; i >= 0; i--) {
        const q = trail[i], l = Math.hypot(px - q[0], py - q[1]);
        if (l < 1e-4) continue;
        if (bk.h !== bk.h || l > 0.2) bk.h = Math.atan2(py - q[1], px - q[0]);
        if (l >= left) { const k = left / l; bk.x = px + (q[0] - px) * k; bk.y = py + (q[1] - py) * k; return 0; }
        left -= l; px = q[0]; py = q[1];
      }
      bk.x = px; bk.y = py; return left;
    }

    const watch = stateWatcher(), m4 = new THREE.Matrix4(), v = new THREE.Vector3();
    const P = new Float32Array(11);   // target pose: thL knL thR knR shL elL shR elR lean abduct crouchTwist
    let swing = 0, swingW = 0, lastStrike = 0, wall = null, wallKey = '', selected = false;

    function findWall(leg, det) {
      const a = leg.access, b = det.pos; let hk = 2, hit = null;
      for (const w of t.world.wallsCrossed(a, b)) { const k = segHit(a, b, w.a, w.b); if (k >= 0 && k < hk) { hk = k; hit = w; } }
      const dl = dist2(a, b) || 1, ux = (b[0] - a[0]) / dl, uy = (b[1] - a[1]) / dl;
      return hit ? { x: a[0] + (b[0] - a[0]) * hk - ux * 0.15, y: a[1] + (b[1] - a[1]) * hk - uy * 0.15, nx: -ux, ny: -uy } : { x: a[0] + ux * 0.6, y: a[1] + uy * 0.6, nx: -ux, ny: -uy };
    }

    function setPose(f, i, mode, dt, fresh, strike) {
      const w = f.w, ph = f.phase, A = 0.5 * w, sL = Math.sin(ph), cL = Math.cos(ph);
      // walking / standing
      P[0] = A * sL - 0.04 * w; P[1] = w * (0.1 + 0.85 * Math.pow(Math.max(0, cL), 1.4));
      P[2] = -A * sL - 0.04 * w; P[3] = w * (0.1 + 0.85 * Math.pow(Math.max(0, -cL), 1.4));
      P[4] = 0.03 - 0.68 * A * sL; P[5] = 0.14 + w * (0.3 + 0.22 * Math.max(0, -sL));
      P[6] = 0.03 + 0.68 * A * sL; P[7] = 0.14 + w * (0.3 + 0.22 * Math.max(0, sL));
      P[8] = 0.075 * w; P[9] = 0.012;
      if (mode === 'kneel' && i === 0) { P[0] = 1.45; P[1] = 1.5; P[2] = -0.12; P[3] = 1.78; P[4] = 0.95; P[5] = 0.45; P[6] = 0.7; P[7] = 0.75; P[8] = 0.3; }
      else if (mode === 'kneel' && i === 1) { P[6] = 2.75; P[7] = 0.22; }
      else if (mode === 'break' && i === 0) { const up = strike; P[0] = 0.42; P[1] = 0.3; P[2] = -0.34; P[3] = 0.22; P[4] = P[6] = lerp(0.85, 2.35, up); P[5] = P[7] = lerp(0.25, 0.7, up); P[8] = lerp(0.3, -0.05, up); }
      else if (mode === 'ease') { P[4] = P[6] = -0.24; P[5] = P[7] = 0.42; P[9] = 0.075; }
      const k = fresh ? 1 : 1 - Math.exp(-(mode === 'break' && i === 0 ? 26 : 9) * dt), q = f.pose;
      for (let j = 0; j < 10; j++) q[j] += (P[j] - q[j]) * k;
      const R = f.R;
      R.thigh[0].rotation.set(-q[9], 0, q[0]); R.shin[0].rotation.z = -q[1];
      R.thigh[1].rotation.set(q[9], 0, q[2]); R.shin[1].rotation.z = -q[3];
      R.arm[0].rotation.set(mode === 'break' && i === 0 ? 0.32 : -0.05, 0, q[4]); R.fore[0].rotation.z = q[5];
      R.arm[1].rotation.set(mode === 'break' && i === 0 ? -0.32 : 0.05, 0, q[6]); R.fore[1].rotation.z = q[7];
      R.torso.rotation.z = -q[8];
      // ground contact: the lower foot touches the floor
      const eL = LT * Math.cos(q[0]) + LS * Math.cos(q[0] - q[1]), eR = LT * Math.cos(q[2]) + LS * Math.cos(q[2] - q[3]);
      R.pelvis.position.y = Math.max(eL, eR, 0.2);
    }

    return {
      update(state, dt, time) {
        const fresh = watch(state), u = state.units['TEAM-1'];
        if (!u) { root.visible = false; return; }
        root.visible = true;
        const r = state.routes && state.routes.rescue, trail = u.trail || [];
        // what the team is doing, from state
        let act = null, mode = 'walk';
        if (state.phase === 'complete') mode = 'ease';
        else if (r && u.v === 0) for (const leg of r.legs) if (leg.ok && leg.arrivedAt != null && state.t - leg.arrivedAt < 4.3) act = leg;
        const det = act && state.detections.find((d) => d.id === act.det);
        if (act && det && det.pos) mode = act.kind === 'break through' ? 'break' : 'kneel';
        setSub(mode === 'break' ? 'breaking through' : mode === 'kneel' ? 'with the person' : u.v > 0 && r && r.status === 'approved' ? 'walking in' : '');

        // the tool swing runs in real time, only while the mission clock runs
        let strike = 0.25;
        if (mode === 'break') {
          if (wallKey !== act.det) { wall = findWall(act, det); wallKey = act.det; }
          if (!t.reduced && state.running && !state.hold) {
            swing += dt * 1.05; const p = swing % 1;
            strike = p < 0.62 ? (1 - Math.cos((p / 0.62) * Math.PI)) / 2 : 1 - Math.pow((p - 0.62) / 0.38, 2.2);
            if (Math.floor(swing) > lastStrike) { lastStrike = Math.floor(swing); puff(wall.x, wall.y, wall.nx, wall.ny); }
          }
        } else { wallKey = ''; swing = 0; lastStrike = 0; }
        swingW = fresh ? (mode === 'break' ? 1 : 0) : damp(swingW, mode === 'break' ? 1 : 0, 10, dt);
        if (dust.visible) { const ua = dust.material.uniforms.uAge; ua.value += dt; if (ua.value > 1.3 || fresh) dust.visible = false; }

        const atHome = u.odo < 0.05 && trail.length <= 1;
        for (let i = 0; i < N; i++) {
          const f = figs[i];
          let tx, ty, th;
          if (i === 0) { tx = u.pos[0]; ty = u.pos[1]; th = atHome ? homeHeading : u.heading; }
          else {
            const d = GAP * i, left = back(trail, u.pos, d), fr = left / d;
            const c = Math.cos(homeHeading), s = Math.sin(homeHeading), ob = FORM[i][0] * fr, ol = FORM[i][1] * fr;
            tx = bk.x + c * ob - s * ol; ty = bk.y + s * ob + c * ol;
            th = fr > 0.5 || bk.h !== bk.h ? homeHeading : bk.h;
          }
          if (det && det.pos && (mode === 'kneel' || mode === 'break') && i < 2) th = Math.atan2(det.pos[1] - f.y, det.pos[0] - f.x);
          let moved = 0;
          if (fresh) { f.x = tx; f.y = ty; f.h = th; f.w = 0; f.sp = 0; }
          else {
            const nx = damp(f.x, tx, 12, dt), ny = damp(f.y, ty, 12, dt);
            moved = Math.hypot(nx - f.x, ny - f.y); f.x = nx; f.y = ny; f.h = dampAngle(f.h, th, 9, dt);
          }
          const speed = dt > 0 ? moved / dt : 0;
          f.sp = damp(f.sp, speed, 10, dt);
          const walking = !t.reduced && f.sp > 0.12 && mode === 'walk';
          f.w = fresh ? 0 : damp(f.w, walking ? 1 : 0, 7, dt);
          if (walking) f.phase += Math.PI * 2 * 2.0 * Math.tanh(f.sp / 1.4 / 2.0) * dt;      // capped so legs never strobe at 8x
          setPose(f, i, mode, dt, fresh, strike);
          const R = f.R;
          R.root.position.set(f.x, t.groundY, -f.y); R.root.rotation.y = f.h; R.root.scale.setScalar(f.scale);
          R.root.updateMatrixWorld(true);
          IM.torso.setMatrixAt(i, R.torso.matrixWorld); torch.setMatrixAt(i, R.torch.matrixWorld);
          for (let s = 0; s < 2; s++) { const k = i * 2 + s; IM.upper.setMatrixAt(k, R.arm[s].matrixWorld); IM.fore.setMatrixAt(k, R.fore[s].matrixWorld); IM.thigh.setMatrixAt(k, R.thigh[s].matrixWorld); IM.shin.setMatrixAt(k, R.shin[s].matrixWorld); }
          f.hit.position.set(f.x, t.groundY, -f.y);
        }
        for (const k in IM) IM[k].instanceMatrix.needsUpdate = true;
        torch.instanceMatrix.needsUpdate = true;
        tool.visible = swingW > 0.5;
        if (tool.visible) { tool.matrix.copy(figs[0].R.fore[1].matrixWorld).multiply(m4.makeTranslation(0, 0, -0.16)); tool.matrixWorldNeedsUpdate = true; }
        torchMat.color.copy(pal.scan).multiplyScalar(2.2);
        label.setPosition(v.set(figs[0].x, t.groundY + 2.0, -figs[0].y));
      },
      setLayer() {},
      onSelect(sel) { selected = !!sel && sel.type === 'unit' && sel.id === 'TEAM-1'; label.setSelected?.(selected); },
      dispose() { label.remove(); disposeTree(root); },
    };
  },
};
