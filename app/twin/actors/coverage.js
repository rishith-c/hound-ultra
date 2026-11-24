// What has and has not been searched, on the floor of block B.
//   fog:   a soft grey haze on floor that has not been searched. Corridors clear where the rover has been
//          (state.map.explored); a room clears where its listening stop could reach (the same range and wall rule the
//          simulator uses for its coverage figure), and a fine front runs out from the stop at that moment.
//   text:  small floor lettering per room, Advanced only. A confirmed detection in the room always wins over the
//          coverage figure. The percentages come from the fusion maths on simulated readings with assumed sensor
//          likelihoods, so every number carries the word "simulated".
import { palette, Y, FONT, clamp, smoothstep, stateWatcher, canvasTexture, disposeTree, decalMaterial } from './common.js';

const RES = 2, TICK = 0.05, WAVES = 3, FRONT = 5.5;              // cells per metre; seconds between fog steps; waves at once; metres a second
const CW = 3.6, CH = 0.8, PXM = 150;                             // one lettering panel, metres and pixels a metre

export default {
  id: 'coverage', layers: ['coverage'],
  create(t) {
    const { THREE } = t, pal = palette(t), world = t.world, SW = world.SITE.w;
    const B = world.BUILDING.rect, bw = B[2] - B[0], bh = B[3] - B[1], rooms = world.ROOMS.filter((r) => !r.corridor), N = rooms.length, range = world.SENSORS.csi.range, maxWalls = world.SENSORS.csi.maxWalls;
    const group = new THREE.Group(); group.name = 'coverage'; t.scene.add(group);

    // ---------- fog ----------
    const gw = bw * RES, gh = bh * RES, NC = gw * gh;
    const roomOf = new Int8Array(NC).fill(-1), want = new Float32Array(NC), delay = new Float32Array(NC), now = new Float32Array(NC), bytes = new Uint8Array(NC), soft = new Float32Array(NC);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const x = B[0] + (i + 0.5) / RES, y = B[1] + (j + 0.5) / RES; roomOf[j * gw + i] = rooms.findIndex((r) => x > r.rect[0] && x < r.rect[2] && y > r.rect[1] && y < r.rect[3]); }
    const tex = new THREE.DataTexture(bytes, gw, gh, THREE.RedFormat, THREE.UnsignedByteType); tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.unpackAlignment = 1; tex.needsUpdate = true;
    const waves = []; for (let i = 0; i < WAVES; i++) waves.push({ u: new THREE.Vector4(0, 0, -1, 0), rect: new THREE.Vector4() });
    const fogGeo = new THREE.InstancedBufferGeometry();
    fogGeo.setAttribute('position', new THREE.Float32BufferAttribute([B[0], 0, -B[1], B[2], 0, -B[1], B[0], 0, -B[3], B[2], 0, -B[3]], 3)); fogGeo.setIndex([0, 1, 2, 1, 3, 2]);
    const layers = t.quality === 'low' ? 1 : 3;                   // three thin sheets read as depth over the furniture
    fogGeo.setAttribute('aSheet', new THREE.InstancedBufferAttribute(new Float32Array([0, 0.5, 0.34, 0.22, 0.85, 0.15].slice(0, layers * 2)), 2)); fogGeo.instanceCount = layers;
    const fogMat = decalMaterial(THREE, {
      uniforms: { uMap: { value: tex }, uB: { value: new THREE.Vector4(B[0], B[1], bw, bh) }, uTime: { value: 0 }, uScan: { value: pal.scan }, uWave: { value: waves.map((w) => w.u) }, uRect: { value: waves.map((w) => w.rect) }, uFade: { value: 1 } },
      vertexShader: 'attribute vec2 aSheet; varying vec2 vW; varying vec2 vS; varying vec3 vP; void main(){ vW = vec2(position.x, -position.z); vS = aSheet; vec4 w = modelMatrix * vec4(position.x, position.y + aSheet.x, position.z, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform vec4 uB; uniform float uTime, uFade; uniform vec3 uScan; uniform vec4 uWave[${WAVES}], uRect[${WAVES}];
        varying vec2 vW; varying vec2 vS; varying vec3 vP;
        float h2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          vec2 drift = vec2(uTime * 0.05, uTime * 0.03) * (1.0 + vS.x);
          float cloud = n2(vW * 0.55 + drift + vS.x * 7.0) * 0.6 + n2(vW * 1.7 - drift * 1.6) * 0.4;
          float e = texture2D(uMap, (vW + (cloud - 0.5) * 0.5 - uB.xy) / uB.zw).r;
          float un = 1.0 - smoothstep(0.12, 0.88, e);
          float gw = fwidth(vW.x) * 16.0, grain = mix(n2(vW * 16.0 + drift * 9.0), 0.5, smoothstep(0.35, 1.0, gw));
          float steep = smoothstep(0.1, 0.5, abs(normalize(cameraPosition - vP).y));
          float a = un * vS.y * (0.78 + 0.22 * cloud + 0.2 * (grain - 0.5)) * (vS.x > 0.0 ? steep : 1.0);
          vec3 col = vec3(0.016, 0.018, 0.0205) * (0.6 + 0.9 * cloud);
          if (vS.x == 0.0) {                                                       // the moment of clearing: one fine front, then nothing
            float w = max(fwidth(vW.x), fwidth(vW.y)), f = 0.0;
            for (int i = 0; i < ${WAVES}; i++) { vec4 v = uWave[i]; if (v.z < 0.0) continue;
              vec4 r = uRect[i]; if (vW.x < r.x || vW.x > r.z || vW.y < r.y || vW.y > r.w) continue;
              float d = v.z - length(vW - v.xy);
              float ln = 1.0 - smoothstep(0.3, 1.0, abs(d) / max(0.022, w)), tail = d > 0.0 ? exp(-d * 2.4) * 0.13 : 0.0;
              f = max(f, (ln * 0.36 + tail) * v.w); }
            col = mix(col, uScan * 0.75, f / max(f + a * (1.0 - f), 1e-4)); a = f + a * (1.0 - f);
          }
          a *= uFade; if (a < 0.003) discard;
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    const fog = new THREE.Mesh(fogGeo, fogMat); fog.position.y = t.groundY + Y.fog; fog.renderOrder = 1; fog.frustumCulled = false; fog.raycast = () => {}; group.add(fog);

    const seen = rooms.map(() => ''), cell = [0, 0];
    let lastCount = -1, settled = false, acc = TICK;
    const searched = (c) => !!c && !!c.stop && (c.status === 'clear' || c.status === 'lead' || c.status === 'person');
    function clearRoom(ri, c, snap) {
      const stop = world.STOPS.find((s) => s.id === c.stop), r = rooms[ri]; if (!stop) return;
      for (let k = 0; k < NC; k++) {
        if (roomOf[k] !== ri || want[k]) continue;
        cell[0] = B[0] + ((k % gw) + 0.5) / RES; cell[1] = B[1] + (Math.floor(k / gw) + 0.5) / RES;
        const d = Math.hypot(cell[0] - stop.pos[0], cell[1] - stop.pos[1]);
        if (d <= range && world.wallsCrossed(stop.pos, cell).length <= maxWalls) { want[k] = 1; delay[k] = snap ? 0 : d / FRONT; }
      }
      if (!snap) { let w = waves[0]; for (const q of waves) if (q.u.z < 0) { w = q; break; } w.u.set(stop.pos[0], stop.pos[1], 0, 1); w.rect.set(r.rect[0] + 0.08, r.rect[1] + 0.08, r.rect[2] - 0.08, r.rect[3] - 0.08); }
      settled = false;
    }
    function fogTick(state, snap, dt) {
      if (snap) { want.fill(0); delay.fill(0); seen.fill(''); lastCount = -1; for (const w of waves) w.u.z = -1; }
      const ex = state.map.explored; let count = 0;
      for (let y = B[1]; y < B[3]; y++) for (let x = B[0]; x < B[2]; x++) count += ex[y * SW + x];
      if (count !== lastCount) { lastCount = count; settled = false; for (let k = 0; k < NC; k++) if (roomOf[k] < 0 && !want[k] && ex[(B[1] + Math.floor(Math.floor(k / gw) / RES)) * SW + B[0] + Math.floor((k % gw) / RES)]) want[k] = 1; }
      for (let i = 0; i < N; i++) { const c = state.coverage[rooms[i].id], key = searched(c) ? c.stop : ''; if (key !== seen[i]) { seen[i] = key; if (key) clearRoom(i, c, snap); } }
      if (settled) return;
      const k = snap ? 1 : 1 - Math.exp(-3.2 * dt); let moving = false;
      for (let i = 0; i < NC; i++) {
        if (delay[i] > 0) { delay[i] -= dt; moving = true; continue; }
        const d = want[i] - now[i]; if (d > 0.004 || d < -0.004) { now[i] += d * k; moving = true; } else now[i] = want[i];
      }
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {                 // a feathered edge that does not leak into the next room
        const q = j * gw + i, me = roomOf[q]; let s = 0, n = 0;
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue; const o = jj * gw + ii; if (roomOf[o] !== me) continue; const w = (a ? 1 : 2) * (b ? 1 : 2); s += now[o] * w; n += w; }
        bytes[q] = (s / n) * 255;
      }
      tex.needsUpdate = true; settled = !moving;
    }

    // ---------- floor lettering: one atlas, one draw ----------
    const cols = 2, rowsN = Math.ceil(N / cols), pw = Math.round(CW * PXM), ph = Math.round(CH * PXM), ct = canvasTexture(THREE, pw * cols, ph * rowsN);
    const tPos = [], tUv = [], tIdx = [], tA = new Float32Array(N * 4);
    rooms.forEach((r, i) => {                                                    // north-west corner, along the north wall, read from the entrance side
      const x0 = r.rect[0] + 0.9, y1 = r.rect[3] - 0.36, c = i % cols, w = Math.floor(i / cols), b = i * 4;
      tPos.push(x0, 0, -(y1 - CH), x0 + CW, 0, -(y1 - CH), x0, 0, -y1, x0 + CW, 0, -y1);
      const u0 = c / cols, u1 = (c + 1) / cols, v1 = 1 - w / rowsN, v0 = 1 - (w + 1) / rowsN;
      tUv.push(u0, v0, u1, v0, u0, v1, u1, v1); tIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    });
    const textGeo = new THREE.BufferGeometry(); textGeo.setAttribute('position', new THREE.Float32BufferAttribute(tPos, 3)); textGeo.setAttribute('uv', new THREE.Float32BufferAttribute(tUv, 2)); textGeo.setIndex(tIdx);
    const aAttr = new THREE.BufferAttribute(tA, 1).setUsage(THREE.DynamicDrawUsage); textGeo.setAttribute('aA', aAttr);
    const textMat = decalMaterial(THREE, {
      uniforms: { uMap: { value: ct.texture }, uA: { value: 0 } },
      vertexShader: 'attribute float aA; varying vec2 vUv; varying float vA; void main(){ vUv = uv; vA = aA; vec4 m = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * m; vec4 q = projectionMatrix * vec4(m.xy, m.z + 0.45, 1.0); gl_Position.z = q.z / q.w * gl_Position.w; }',        // reads over the silt
      fragmentShader: 'uniform sampler2D uMap; uniform float uA; varying vec2 vUv; varying float vA; void main(){ vec4 c = texture2D(uMap, vUv); float a = c.a * vA * uA; if (a < 0.004) discard; gl_FragColor = vec4(c.rgb * 0.8, a); \n#include <colorspace_fragment>\n }',
    });
    const text = new THREE.Mesh(textGeo, textMat); text.position.y = t.groundY + Y.coverage + 0.02; text.renderOrder = 3; text.frustumCulled = false; text.raycast = () => {}; group.add(text);
    const R = rooms.map((r, i) => ({ r, i, kind: '', pct: -1, alpha: 0, pending: false, css: '' }));
    const words = { unsearched: 'Not searched', clear: 'chance missed', lead: 'Possible person', person: 'Person located', blocked: 'Not searched: blocked' };
    function paint(o) {
      const c = ct.ctx, x0 = (o.i % cols) * pw, y0 = Math.floor(o.i / cols) * ph, k = PXM / 0.72;        // a cap height of 1 m is about 1/0.72 em
      const big = Math.round(0.28 * k), small = Math.round(0.12 * k), face = '"Instrument Sans", ' + FONT, pct = o.pct < 1 ? '<1 %' : o.pct + ' %';
      c.clearRect(x0, y0, pw, ph); c.fillStyle = pal.css.text; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      const num = o.kind === 'clear', head = num ? pct : words[o.kind], size = num ? big : Math.round(0.19 * k);
      c.globalAlpha = 1; c.font = '300 ' + size + 'px ' + face; c.fillText(head, x0 + 4, y0 + 0.36 * PXM);
      const w = c.measureText(head).width; c.font = '400 ' + small + 'px ' + face; c.globalAlpha = 0.8;
      if (num) c.fillText(words.clear, x0 + w + 16, y0 + 0.36 * PXM); else if (o.kind === 'lead' || o.kind === 'person') c.fillText(pct, x0 + w + 16, y0 + 0.36 * PXM);
      if (o.kind === 'clear' || o.kind === 'lead' || o.kind === 'person') { c.globalAlpha = 0.6; c.fillText('simulated', x0 + 4, y0 + 0.62 * PXM); }
      c.globalAlpha = 1; ct.texture.needsUpdate = true; o.pending = false;
    }
    let advA = -1, layerOn = true, layerK = 1, stale = false;

    const watch = stateWatcher();
    return {
      update(state, dt, time) {
        const fresh = watch(state);
        layerK = t.reduced ? (layerOn ? 1 : 0) : clamp(layerK + (layerOn ? dt : -dt) / 0.45, 0, 1);
        group.visible = layerK > 0; fogMat.uniforms.uFade.value = layerK * layerK * (3 - 2 * layerK);
        if (!group.visible) { if (fresh) { stale = true; for (const o of R) o.kind = ''; } return; }
        acc += dt;
        if (fresh || stale) { acc = 0; stale = false; fogTick(state, true, 0); } else if (acc >= TICK) { fogTick(state, t.reduced, Math.min(acc, 0.1)); acc = 0; }
        for (const w of waves) if (w.u.z >= 0) { w.u.z += dt * FRONT; w.u.w = 1 - smoothstep(range * 0.6, range * 1.25, w.u.z); if (w.u.z > range * 1.3 || t.reduced) w.u.z = -1; }
        if (!t.reduced) fogMat.uniforms.uTime.value = time;
        // lettering
        const adv = t.ctx.mode !== 'demo' ? 1 : 0; advA = advA < 0 || t.reduced ? adv : clamp(advA + Math.sign(adv - advA) * dt / 0.4, 0, 1);
        text.visible = advA > 0.003; textMat.uniforms.uA.value = advA * 0.6 * layerK;
        let dirty = fresh;
        for (const o of R) {
          const c = state.coverage[o.r.id]; let kind = c && words[c.status] ? c.status : 'unsearched', p = c ? c.residual : 0;
          for (const d of state.detections) if (d.status === 'confirmed' && d.pos && (d.room === o.r.id || (d.pos[0] > o.r.rect[0] && d.pos[0] < o.r.rect[2] && d.pos[1] > o.r.rect[1] && d.pos[1] < o.r.rect[3]))) { if (kind !== 'person' || d.p > p) p = d.p; kind = 'person'; }
          const pct = Math.round(p * 100);
          if (kind !== o.kind || pct !== o.pct || pal.css.text !== o.css) { const first = fresh || !o.kind; o.kind = kind; o.pct = pct; o.css = pal.css.text; o.pending = true; if (first) { o.alpha = 0; paint(o); } }
          const goal = o.pending ? 0 : o.kind === 'unsearched' ? 0.55 : o.kind === 'person' ? 1 : 0.8;
          if (o.alpha !== goal) { o.alpha = o.alpha < goal ? Math.min(goal, o.alpha + dt / 0.35) : Math.max(goal, o.alpha - dt / 0.2); dirty = true; }
          if (o.pending && o.alpha === 0) paint(o);                              // words change by fading out, repainting, fading in
          const k = o.i * 4; tA[k] = tA[k + 1] = tA[k + 2] = tA[k + 3] = o.alpha;
        }
        if (dirty) aAttr.needsUpdate = true;
      },
      setLayer(id, on) { if (id === 'coverage') { layerOn = !!on; if (layerOn) { settled = false; acc = TICK; } } },
      onSelect() {},
      dispose() { fogMat.uniforms.uWave.value = []; tex.dispose(); ct.texture.dispose(); disposeTree(group); },
    };
  },
};
