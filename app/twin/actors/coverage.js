// What has and has not been searched, on the floor of building B.
//   fog:    state.map.explored (1 m cells the rover has been within 5 m of). Unexplored floor carries a quiet dotted veil.
//   rooms:  state.coverage[id] { status, reach, residual }. One instanced decal for the eight classrooms.
//   labels: a floor label per room, redrawn only when its words change.
// The percentages come from the fusion maths on simulated readings with assumed sensor likelihoods, so every
// number carries the word "simulated".
import { palette, Y, FONT, MONO, damp, clamp, stateWatcher, groundText, disposeTree, decalMaterial } from './common.js';

const STATUS = { unsearched: 0, clear: 1, lead: 2, person: 3, blocked: 4 };
const MARGIN = 3, INSET = 0.25, LW = 6.4, LH = 3, PXM = 100, TICK = 0.08;

export default {
  id: 'coverage', layers: ['coverage'],
  create(t) {
    const { THREE } = t, pal = palette(t), world = t.world, SW = world.SITE.w, SH = world.SITE.h;
    const B = world.BUILDING.rect, rooms = world.ROOMS.filter((r) => !r.corridor), N = rooms.length;
    const group = new THREE.Group(); group.name = 'coverage'; t.scene.add(group);

    // ---------- fog of war ----------
    const rx0 = Math.max(0, Math.floor(B[0] - MARGIN) - 1), ry0 = Math.max(0, Math.floor(B[1] - MARGIN) - 1);
    const rw = Math.ceil((Math.min(SW, B[2] + MARGIN + 1) - rx0) / 4) * 4, rh = Math.min(SH, Math.ceil(B[3] + MARGIN) + 1) - ry0;
    const target = new Float32Array(rw * rh), smooth = new Float32Array(rw * rh), bytes = new Uint8Array(rw * rh);
    const tex = new THREE.DataTexture(bytes, rw, rh, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
    const fx0 = B[0] - MARGIN, fy0 = B[1] - MARGIN, fx1 = B[2] + MARGIN, fy1 = B[3] + MARGIN;
    const fogGeo = new THREE.BufferGeometry();
    fogGeo.setAttribute('position', new THREE.Float32BufferAttribute([fx0, 0, -fy0, fx1, 0, -fy0, fx0, 0, -fy1, fx1, 0, -fy1], 3)); fogGeo.setIndex([0, 1, 2, 1, 3, 2]);
    const fogMat = decalMaterial(THREE, {
      uniforms: { uMap: { value: tex }, uRegion: { value: new THREE.Vector4(rx0, ry0, rw, rh) }, uB: { value: new THREE.Vector4(B[0], B[1], B[2], B[3]) }, uScan: { value: pal.scan }, uMargin: { value: MARGIN } },
      vertexShader: 'varying vec2 vW; void main(){ vW = vec2(position.x, -position.z); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform sampler2D uMap; uniform vec4 uRegion, uB; uniform vec3 uScan; uniform float uMargin; varying vec2 vW;',
        'void main(){',
        '  float e = texture2D(uMap, (vW - uRegion.xy) / uRegion.zw).r;',
        '  float un = 1.0 - smoothstep(0.3, 0.62, e);',                                  // 1 where the rover has not been
        '  float outside = length(max(max(uB.xy - vW, vW - uB.zw), 0.0));',
        '  float m = 1.0 - smoothstep(0.0, uMargin, outside);',
        '  vec2 g = fract(vW / 0.6) - 0.5; float aa = fwidth(vW.x) / 0.6;',
        '  float dots = (1.0 - smoothstep(0.1, 0.1 + aa * 1.5, length(g))) * (1.0 - smoothstep(0.12, 0.4, aa));',
        '  float far = smoothstep(0.12, 0.4, aa) * 0.035;',                              // from far away the dots average to a tone
        '  float rim = smoothstep(0.36, 0.46, e) * (1.0 - smoothstep(0.46, 0.56, e));',   // the edge of what has been seen
        '  float veil = un * 0.46;',
        '  float light = un * (dots * 0.14 + far) + rim * 0.045;',
        '  float a = m * (veil + light * (1.0 - veil));',
        '  vec3 col = mix(vec3(0.012, 0.016, 0.024), uScan * 0.8, light * (1.0 - veil) / max(veil + light * (1.0 - veil), 1e-4));',
        '  gl_FragColor = vec4(col, a);',
        '  #include <colorspace_fragment>',
        '}'].join('\n'),
    });
    const fog = new THREE.Mesh(fogGeo, fogMat); fog.position.y = t.groundY + Y.fog; fog.renderOrder = 1; group.add(fog);

    let lastCount = -1, settled = false, acc = TICK;
    function fogTick(explored, snap) {
      let count = 0;
      for (let j = 0; j < rh; j++) { const row = (ry0 + j) * SW + rx0; for (let i = 0; i < rw; i++) count += explored[row + i]; }
      if (count !== lastCount || snap) {
        lastCount = count; settled = false;
        for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {                       // a 3 x 3 blur, so the edge is round, not stepped
          let s = 0;
          for (let dj = -1; dj <= 1; dj++) { const y = clamp(ry0 + j + dj, 0, SH - 1) * SW; for (let di = -1; di <= 1; di++) s += explored[y + clamp(rx0 + i + di, 0, SW - 1)]; }
          target[j * rw + i] = s / 9;
        }
      }
      if (settled) return;
      const k = snap ? 1 : 1 - Math.exp(-5 * TICK); let moving = false;
      for (let i = 0; i < target.length; i++) { const d = target[i] - smooth[i]; if (d > 0.004 || d < -0.004) { smooth[i] += d * k; moving = true; } else smooth[i] = target[i]; bytes[i] = smooth[i] * 255; }
      settled = !moving || snap; tex.needsUpdate = true;
    }

    // ---------- room decals (one instanced draw) ----------
    const aRect = new Float32Array(N * 4), aState = new Float32Array(N * 4);
    rooms.forEach((r, i) => aRect.set([r.rect[0] + INSET, r.rect[1] + INSET, r.rect[2] - INSET, r.rect[3] - INSET], i * 4));
    const roomGeo = new THREE.InstancedBufferGeometry();
    roomGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1], 3)); roomGeo.setIndex([0, 1, 2, 1, 3, 2]);
    roomGeo.setAttribute('aRect', new THREE.InstancedBufferAttribute(aRect, 4));
    const stateAttr = new THREE.InstancedBufferAttribute(aState, 4).setUsage(THREE.DynamicDrawUsage); roomGeo.setAttribute('aState', stateAttr);
    roomGeo.instanceCount = N;
    const roomMat = decalMaterial(THREE, {
      uniforms: { uOk: { value: pal.ok }, uWarn: { value: pal.warn }, uPerson: { value: pal.person }, uDanger: { value: pal.danger }, uDim: { value: pal.dim } },
      vertexShader: [
        'attribute vec4 aRect, aState; varying vec2 vW; varying vec4 vRect, vState;',
        'void main(){ vRect = aRect; vState = aState; vW = mix(aRect.xy, aRect.zw, position.xz); gl_Position = projectionMatrix * modelViewMatrix * vec4(vW.x, 0.0, -vW.y, 1.0); }'].join('\n'),
      fragmentShader: [
        'uniform vec3 uOk, uWarn, uPerson, uDanger, uDim; varying vec2 vW; varying vec4 vRect, vState;',
        'vec4 look(float s, float d, float sel){',
        '  if (s < 0.5) return vec4(0.0);',
        '  float aa = fwidth(d), bw = 0.05 + 0.05 * sel;',
        '  float border = 1.0 - smoothstep(bw, bw + aa * 1.3, d);',
        '  float hug = exp(-d / 0.75);',                                                 // a soft band of colour along the walls
        '  if (s > 3.5) {',                                                              // blocked: hatching, not searched
        '    float h = abs(fract((vW.x + vW.y) / 1.1) - 0.5) * 2.0, ha = fwidth((vW.x + vW.y) / 1.1) * 2.0;',
        '    float stripe = smoothstep(0.7 - ha, 0.7 + ha, h) * (1.0 - smoothstep(0.25, 0.8, ha)) + 0.3 * smoothstep(0.25, 0.8, ha);',
        '    float a = max(stripe * (0.1 + 0.06 * sel) + 0.012, border * (0.55 + 0.45 * sel));',
        '    return vec4(mix(uDim, uDanger, max(stripe * 0.6, border)), a);',
        '  }',
        '  vec3 c = s < 1.5 ? uOk : s < 2.5 ? uWarn : uPerson;',
        '  float wash = s < 1.5 ? 0.018 : s < 2.5 ? 0.03 : 0.04;',
        '  float a = max(wash * (1.0 + 0.6 * sel) + hug * wash * 1.6, border * (0.62 + 0.38 * sel));',
        '  return vec4(c * (1.0 + 0.35 * sel * border), a);',
        '}',
        'void main(){',
        '  float d = min(min(vW.x - vRect.x, vRect.z - vW.x), min(vW.y - vRect.y, vRect.w - vW.y));',
        '  vec4 A = look(vState.x, d, vState.w), Bc = look(vState.y, d, vState.w); float m = vState.z;',
        '  float a = mix(A.a, Bc.a, m); if (a < 0.002) discard;',
        '  gl_FragColor = vec4((A.rgb * A.a * (1.0 - m) + Bc.rgb * Bc.a * m) / a, a);',
        '  #include <colorspace_fragment>',
        '}'].join('\n'),
    });
    const roomMesh = new THREE.Mesh(roomGeo, roomMat); roomMesh.frustumCulled = false; roomMesh.position.y = t.groundY + Y.coverage; roomMesh.renderOrder = 2; group.add(roomMesh);

    // ---------- pick quads and floor labels ----------
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    const R = rooms.map((r, i) => {
      const w = r.rect[2] - r.rect[0], h = r.rect[3] - r.rect[1], cx = (r.rect[0] + r.rect[2]) / 2, cy = (r.rect[1] + r.rect[3]) / 2;
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.3, h - 0.3).rotateX(-Math.PI / 2), pickMat); quad.position.set(cx, t.groundY + 0.02, -cy); group.add(quad);
      t.pickable(quad, { type: 'room', id: r.id });
      const gt = groundText(THREE, LW, LH, PXM); gt.mesh.position.y = t.groundY + Y.coverage + 0.006; gt.material.opacity = 0; group.add(gt.mesh);
      const ny = r.rect[3] - 2.0, northOk = !world.OBSTACLES.some((ob) => { if (ob.h < 0.8) return false; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of ob.poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return x0 < cx + LW / 2 && x1 > cx - LW / 2 && y0 < ny + LH / 2 && y1 > ny - LH / 2; });
      return { r, i, cx, gt, northOk, from: 0, to: 0, mix: 1, sel: 0, status: null, pct: -1, reach: -1, north: null, css: '', alpha: 0, pending: true, shown: 0 };
    });
    let selId = null, layerOn = true;

    function paint(o, snap) {
      const st = o.status, css = pal.css, col = st === 'clear' ? css.ok : st === 'lead' ? css.warn : st === 'person' ? css.person : st === 'blocked' ? css.danger : css.dim;
      const pct = o.pct < 1 ? '<1' : String(o.pct);
      o.gt.redraw((c, W, H) => {
        const mid = W / 2; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
        const small = (s, y, fill, a = 1, px = 30, wt = 500) => { c.globalAlpha = a; c.fillStyle = fill; c.font = wt + ' ' + px + 'px ' + FONT; c.fillText(s, mid, y); c.globalAlpha = 1; };
        // a number in the monospace face followed by words in the text face, centred as one line
        const pair = (num, words, y, px, fill) => { const f1 = '600 ' + px + 'px ' + MONO, f2 = '500 ' + Math.round(px * 0.62) + 'px ' + FONT; c.font = f1; const w1 = c.measureText(num).width; c.font = f2; const w2 = c.measureText(words).width, gap = px * 0.22; let x = mid - (w1 + gap + w2) / 2; c.textAlign = 'left'; c.font = f1; c.fillStyle = fill; c.fillText(num, x, y); c.font = f2; c.globalAlpha = 0.85; c.fillText(words, x + w1 + gap, y); c.globalAlpha = 1; c.textAlign = 'center'; };
        small('Room ' + o.r.id, 44, css.text, 0.62, 30, 600);
        if (st === 'clear') {
          pair(pct, '%', 150, 112, col);
          small('chance someone was missed', 196, css.text, 0.85, 31);
          small('simulated', 233, css.sim, 0.95, 26);
          small('sensors reached ' + o.reach + ' % of the room', 284, css.text, 0.55, 26, 400);
        } else if (st === 'lead' || st === 'person') {
          small(st === 'lead' ? 'Possible person' : 'Person found', 122, col, 1, 66, 600);
          pair(pct, '% likely', 196, 58, col);
          small('simulated', 240, css.sim, 0.95, 26);
        } else if (st === 'blocked') {
          small('Not searched', 128, col, 1, 66, 600);
          small('blocked by debris', 178, css.text, 0.8, 34);
        } else small('Not searched yet', 128, css.dim, 1, 50, 500);
      });
      const y = o.north ? o.r.rect[3] - 2.0 : o.r.rect[1] + 2.0;
      o.gt.mesh.position.x = o.cx; o.gt.mesh.position.z = -y;
      o.shown = st === 'unsearched' ? 0.7 : 1; o.pending = false; if (snap) o.alpha = o.shown;
    }

    const watch = stateWatcher();
    return {
      update(state, dt) {
        const fresh = watch(state);
        if (!layerOn) { if (fresh) { lastCount = -1; for (const o of R) o.status = null; } return; }
        // fog: a few times a second, and only while something is changing
        acc += dt;
        if (fresh || acc >= TICK) { acc = 0; fogTick(state.map.explored, fresh || t.reduced); }
        // rooms
        let dirty = fresh;
        for (const o of R) {
          const c = state.coverage[o.r.id], st = c && STATUS[c.status] != null ? c.status : 'unsearched', code = STATUS[st];
          const pct = Math.round((c ? c.residual : 0) * 100), reach = Math.round((c ? c.reach : 0) * 100);
          // keep the label clear of a marker: move to the north half when a lead sits in the south half
          let north = false;
          if (st === 'lead' || st === 'person') for (const d of state.detections) if (d.room === o.r.id && d.status !== 'rejected' && Math.abs(d.pos[0] - o.cx) < LW / 2 + 1.2 && Math.abs(d.pos[1] - (o.r.rect[1] + 2.0)) < LH / 2 + 1.6) north = o.northOk;
          if (fresh || o.status === null) { o.from = o.to = code; o.mix = 1; dirty = true; }
          else if (code !== o.to) { o.from = o.to; o.to = code; o.mix = 0; }
          if (o.mix < 1) { o.mix = Math.min(1, o.mix + dt / 0.5); dirty = true; }
          const sT = selId === o.r.id ? 1 : 0;
          if (o.sel !== sT) { o.sel = Math.abs(sT - o.sel) < 0.01 ? sT : damp(o.sel, sT, 14, dt); dirty = true; }
          if (st !== o.status || pct !== o.pct || reach !== o.reach || north !== o.north || pal.css.ok !== o.css) {
            const first = fresh || o.status === null;
            o.status = st; o.pct = pct; o.reach = reach; o.north = north; o.css = pal.css.ok; o.pending = true;
            if (first) paint(o, true);
          }
          // words change by fading out, repainting, fading in
          if (o.pending) { o.alpha = Math.max(0, o.alpha - dt / 0.15); if (o.alpha === 0) paint(o, false); }
          else if (o.alpha !== o.shown) o.alpha = o.alpha < o.shown ? Math.min(o.shown, o.alpha + dt / 0.25) : o.shown;
          o.gt.material.opacity = o.alpha; o.gt.mesh.visible = o.alpha > 0.003;
          const k = o.i * 4, e = o.mix * o.mix * (3 - 2 * o.mix); aState[k] = o.from; aState[k + 1] = o.to; aState[k + 2] = e; aState[k + 3] = o.sel;
        }
        if (dirty) stateAttr.needsUpdate = true;
      },
      setLayer(id, on) { if (id === 'coverage') { layerOn = !!on; group.visible = layerOn; if (layerOn) { lastCount = -1; settled = false; for (const o of R) o.status = null; } } },
      onSelect(sel) { selId = sel && sel.type === 'room' ? sel.id : null; },
      dispose() { for (const o of R) o.gt.dispose(); disposeTree(group); pickMat.dispose(); },
    };
  },
};
