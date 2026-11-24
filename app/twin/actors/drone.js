// The scout drone (a concept unit: it does not exist in hardware), its camera frustum, the scan line and the
// survey swaths it paints on the ground. Everything is driven by state.units['DRONE-01'] and state.map.
//   model: metres, origin on the ground under the skids, nose along local +x, drawn at SCALE.drone
//   layer 'scan': swath paint, frustum and scan line (the airframe itself always shows)
// Display conventions (said in the report): the airframe is drawn 4x life size; the scan line is the camera's
// across-track line directly under the drone, so it coincides with the growing edge of the swath in state.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { palette, SCALE, Y, damp, dampAngle, clamp, smoothstep, stateWatcher, disposeTree, decalMaterial, ringGeometry } from './common.js';

const ID = 'DRONE-01';
const ARM_R = 0.275, ARM_Y = 0.128, PROP_Y = 0.186, PROP_R = 0.125;
const FOOT_ALONG = 8, MAX_SWATHS = 8;
// How hard the drawn position chases the simulated one. Stiffer at high sim speed so the lag stays a few metres.
export const chase = (speed) => 10 + 1.2 * (speed || 1);

const COL = { shell: 0xc3c8d0, shellDark: 0x8d939c, carbon: 0x15171a, dark: 0x24272c, rubber: 0x0c0d0f, battery: 0x1c1f24, label: 0x9aa1ab };

function buildAirframe(THREE) {
  const paint = [], metal = [], head = [];
  const col = new THREE.Color();
  const prep = (g, hex) => {
    if (g.index) { const n = g.toNonIndexed(); g.dispose(); g = n; }
    g.deleteAttribute('uv');
    if (hex != null) { col.set(hex); const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
    return g;
  };
  const up = new THREE.Vector3(0, 1, 0), va = new THREE.Vector3(), vb = new THREE.Vector3(), q = new THREE.Quaternion();
  const tube = (a, b, r0, r1 = r0, seg = 10) => {
    va.set(a[0], a[1], a[2]); vb.set(b[0], b[1], b[2]).sub(va); const len = vb.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
    g.applyQuaternion(q.setFromUnitVectors(up, vb.normalize())); g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    return g;
  };
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const cyl = (r0, r1, h, x, y, z, seg = 20) => new THREE.CylinderGeometry(r1, r0, h, seg).translate(x, y, z);
  const plan = (s, nose) => { const sh = new THREE.Shape(); const p = [[nose, 0.022 * s], [0.085 * s, 0.054 * s], [-0.085 * s, 0.054 * s], [-0.118 * s, 0.034 * s], [-0.118 * s, -0.034 * s], [-0.085 * s, -0.054 * s], [0.085 * s, -0.054 * s], [nose, -0.022 * s]]; sh.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) sh.lineTo(p[i][0], p[i][1]); sh.closePath(); return sh; };
  const slab = (shape, y0, depth, bevel) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4 }).rotateX(-Math.PI / 2).translate(0, y0, 0);

  // body: a carbon lower plate, a silver upper shell, a darker canopy strip
  paint.push(prep(slab(plan(1, 0.128), 0.1, 0.012, 0.003), COL.carbon));
  paint.push(prep(slab(plan(0.93, 0.118), 0.122, 0.022, 0.009), COL.shell));
  paint.push(prep(box(0.07, 0.006, 0.05, 0.085, 0.153, 0), COL.shellDark));                       // nose vent panel
  // battery with its strap and plug
  paint.push(prep(box(0.118, 0.03, 0.06, -0.012, 0.169, 0), COL.battery));
  paint.push(prep(box(0.03, 0.004, 0.04, -0.012, 0.1855, 0), COL.label));
  metal.push(prep(box(0.02, 0.034, 0.064, 0.012, 0.169, 0)));
  paint.push(prep(box(0.012, 0.014, 0.022, -0.077, 0.165, 0), COL.rubber));
  // GPS puck on a mast, two antennas
  paint.push(prep(tube([-0.098, 0.15, 0], [-0.098, 0.205, 0], 0.0038), COL.carbon));
  paint.push(prep(cyl(0.024, 0.021, 0.011, -0.098, 0.21, 0, 24), COL.shell));
  paint.push(prep(tube([-0.105, 0.148, 0.03], [-0.15, 0.225, 0.052], 0.0026, 0.0018, 6), COL.rubber));
  paint.push(prep(tube([-0.105, 0.148, -0.03], [-0.15, 0.225, -0.052], 0.0026, 0.0018, 6), COL.rubber));
  // arms, clamps, motors
  const tips = [];
  for (const deg of [45, 135, 225, 315]) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), tx = c * ARM_R, tz = s * ARM_R;
    tips.push([tx, tz]);
    paint.push(prep(tube([c * 0.05, ARM_Y, s * 0.05], [tx, ARM_Y, tz], 0.0105, 0.0085, 12), COL.carbon));
    metal.push(prep(tube([c * 0.062, ARM_Y, s * 0.062], [c * 0.084, ARM_Y, s * 0.084], 0.0135, 0.0135, 12)));       // arm clamp
    paint.push(prep(cyl(0.025, 0.025, 0.007, tx, ARM_Y + 0.008, tz, 20), COL.carbon));                               // motor mount
    paint.push(prep(cyl(0.0185, 0.0185, 0.013, tx, ARM_Y + 0.018, tz, 20), COL.dark));                               // stator
    metal.push(prep(cyl(0.0225, 0.0225, 0.015, tx, ARM_Y + 0.032, tz, 24)));                                         // bell
    metal.push(prep(cyl(0.0225, 0.016, 0.006, tx, ARM_Y + 0.0425, tz, 24)));
    metal.push(prep(cyl(0.0032, 0.0032, 0.02, tx, ARM_Y + 0.052, tz, 8)));                                           // shaft
    paint.push(prep(cyl(0.008, 0.006, 0.01, tx, ARM_Y - 0.014, tz, 12), COL.dark));                                  // light housing
  }
  // skids
  for (const sz of [1, -1]) {
    paint.push(prep(tube([-0.105, 0.007, 0.082 * sz], [0.105, 0.007, 0.082 * sz], 0.007, 0.007, 10), COL.carbon));
    paint.push(prep(new THREE.SphereGeometry(0.0085, 10, 8).translate(0.105, 0.007, 0.082 * sz), COL.rubber));
    paint.push(prep(new THREE.SphereGeometry(0.0085, 10, 8).translate(-0.105, 0.007, 0.082 * sz), COL.rubber));
    paint.push(prep(tube([0.062, 0.007, 0.082 * sz], [0.045, 0.104, 0.044 * sz], 0.0055, 0.0055, 8), COL.carbon));
    paint.push(prep(tube([-0.062, 0.007, 0.082 * sz], [-0.045, 0.104, 0.044 * sz], 0.0055, 0.0055, 8), COL.carbon));
  }
  // gimbal: damper plate and yaw arm stay with the body; the head (roll motor, yoke, camera) is levelled each frame
  paint.push(prep(cyl(0.02, 0.02, 0.006, 0.078, 0.097, 0, 16), COL.dark));
  paint.push(prep(box(0.012, 0.016, 0.012, 0.078, 0.087, 0), COL.dark));
  head.push(prep(new THREE.CylinderGeometry(0.012, 0.012, 0.014, 16).rotateZ(Math.PI / 2).translate(-0.027, 0, 0), COL.dark));      // roll motor
  head.push(prep(box(0.006, 0.012, 0.058, -0.019, 0, 0), COL.dark));                                                               // yoke back
  head.push(prep(box(0.03, 0.012, 0.005, -0.004, 0, 0.0265), COL.dark));
  head.push(prep(box(0.03, 0.012, 0.005, -0.004, 0, -0.0265), COL.dark));
  head.push(prep(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 12).rotateX(Math.PI / 2).translate(0.008, 0, 0.032), COL.dark));  // pitch motor
  head.push(prep(box(0.036, 0.034, 0.044, 0.008, -0.004, 0), COL.shellDark));                                                     // camera body
  head.push(prep(cyl(0.0135, 0.0125, 0.014, 0.008, -0.027, 0, 20), COL.rubber));                                                   // lens barrel, looking down
  const lens = prep(new THREE.CylinderGeometry(0.0105, 0.0105, 0.002, 20).translate(0.008, -0.0345, 0));

  return { paint: mergeGeometries(dump(paint)), metal: mergeGeometries(dump(metal)), head: mergeGeometries(dump(head)), lens, tips };
  function dump(list) { return list; }
}

function bladeGeometry(THREE) {
  const pos = [], idx = [], n = 10;
  for (let b = 0; b < 2; b++) {
    const s = b ? -1 : 1, base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const k = i / n, r = 0.01 + (PROP_R - 0.01) * k;
      const chord = (0.012 + 0.02 * Math.sin(Math.PI * Math.min(1, 0.1 + k * 1.25))) * (1 - 0.5 * k * k) * (k > 0.96 ? 0.6 : 1);
      const tw = (30 - 22 * k) * Math.PI / 180, cz = Math.cos(tw) * chord / 2, cy = Math.sin(tw) * chord / 2;
      pos.push(s * r, cy, s * cz, s * r, -cy, -s * cz);
      if (i < n) { const j = base + i * 2; idx.push(j, j + 2, j + 1, j + 1, j + 2, j + 3); }
    }
  }
  let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const flat = g.toNonIndexed(); g.dispose(); flat.computeVertexNormals();
  const hub = new THREE.CylinderGeometry(0.0085, 0.011, 0.011, 12).toNonIndexed(); hub.deleteAttribute('uv');
  const nut = new THREE.CylinderGeometry(0.004, 0.006, 0.006, 8).translate(0, 0.008, 0).toNonIndexed(); nut.deleteAttribute('uv');
  const out = mergeGeometries([flat, hub, nut]); flat.dispose(); hub.dispose(); nut.dispose();
  return out;
}

export default {
  id: 'drone', layers: ['scan'],
  create(t) {
    const { THREE } = t, pal = palette(t), low = t.quality === 'low';
    const home = t.world.SITE.dronePad, siteH = t.world.SITE.h;

    // ---------- airframe ----------
    const root = new THREE.Group(); root.name = 'drone'; root.rotation.order = 'YZX'; root.scale.setScalar(SCALE.drone);
    const parts = buildAirframe(THREE);
    const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.46, metalness: 0.18 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x9299a3, roughness: 0.28, metalness: 0.9 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.06, metalness: 0.7 });
    const body = new THREE.Mesh(parts.paint, paintMat), bells = new THREE.Mesh(parts.metal, metalMat);
    body.castShadow = bells.castShadow = true; root.add(body, bells);
    const gimbal = new THREE.Group(); gimbal.position.set(0.078, 0.066, 0); gimbal.rotation.order = 'ZXY';
    const head = new THREE.Mesh(parts.head, paintMat), lens = new THREE.Mesh(parts.lens, glassMat); head.castShadow = true;
    gimbal.add(head, lens); root.add(gimbal);

    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x0f1113, roughness: 0.38, metalness: 0.2, side: THREE.DoubleSide });
    const blades = new THREE.InstancedMesh(bladeGeometry(THREE), bladeMat, 4); blades.frustumCulled = false; blades.castShadow = true;
    const discMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uSpin: { value: 0 }, uPhase: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform float uSpin, uPhase; varying vec2 vUv;',
        'void main(){',
        '  float r = vUv.y;',
        '  float prof = smoothstep(0.0, 0.3, r) * (1.0 - smoothstep(0.9, 1.0, r));',
        '  float ghost = 0.7 + 0.3 * sin(vUv.x * 12.5664 + uPhase);',                 // the two blades, blurred
        '  float rings = 0.88 + 0.12 * sin(r * 70.0);',
        '  float tip = smoothstep(0.84, 0.94, r) * (1.0 - smoothstep(0.95, 1.0, r));',
        '  float a = uSpin * (0.13 * prof * ghost * rings * (0.35 + 0.65 * r) + 0.1 * tip);',
        '  gl_FragColor = vec4(mix(vec3(0.42, 0.46, 0.52), vec3(0.8, 0.86, 0.93), tip), a);',
        '  #include <colorspace_fragment>',
        '}'].join('\n'),
    });
    const discs = new THREE.InstancedMesh(ringGeometry(THREE, 0.008, PROP_R + 0.003, low ? 24 : 48), discMat, 4); discs.frustumCulled = false; discs.renderOrder = 4;
    const m4 = new THREE.Matrix4();
    parts.tips.forEach(([x, z], i) => { discs.setMatrixAt(i, m4.makeTranslation(x, PROP_Y + 0.001, z)); blades.setMatrixAt(i, m4.makeRotationY(i * 0.9).setPosition(x, PROP_Y, z)); });
    root.add(blades, discs);

    // navigation lights: soft points, red on the left (port) arms, green on the right, a white strobe under the tail
    const lp = [], lk = [];
    parts.tips.forEach(([x, z]) => { lp.push(x, ARM_Y - 0.021, z); lk.push(z < 0 ? 0 : 1); });
    lp.push(-0.1, 0.096, 0); lk.push(2);
    const lightGeo = new THREE.BufferGeometry(); lightGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lightGeo.setAttribute('aKind', new THREE.Float32BufferAttribute(lk, 1));
    const lightMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uLeft: { value: pal.danger }, uRight: { value: pal.ok }, uWhite: { value: pal.text }, uOn: { value: 0 }, uStrobe: { value: 0 }, uPx: { value: 1000 } },
      vertexShader: [
        'attribute float aKind; uniform float uPx, uOn, uStrobe; uniform vec3 uLeft, uRight, uWhite; varying vec4 vCol;',
        'void main(){',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  float strobe = step(1.5, aKind);',
        '  vCol = vec4(strobe > 0.5 ? uWhite : (aKind < 0.5 ? uLeft : uRight), uOn * mix(1.0, uStrobe, strobe));',
        '  gl_PointSize = clamp(mix(0.55, 0.85, strobe) * uPx / -mv.z, 4.0, 90.0);',
        '  gl_Position = projectionMatrix * mv;',
        '}'].join('\n'),
      fragmentShader: [
        'varying vec4 vCol;',
        'void main(){',
        '  float d = length(gl_PointCoord - 0.5) * 2.0;',
        '  float a = (exp(-d * d * 7.0) * 0.5 + (1.0 - smoothstep(0.0, 0.2, d)) * 0.9) * (1.0 - smoothstep(0.75, 1.0, d));',
        '  gl_FragColor = vec4(vCol.rgb * 1.5 * a * vCol.a, 1.0);',
        '  #include <colorspace_fragment>',
        '}'].join('\n'),
    });
    const lights = new THREE.Points(lightGeo, lightMat); lights.frustumCulled = false; lights.renderOrder = 5; root.add(lights); t.glow(lights);

    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    const pick = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), pickMat); pick.position.y = 0.12; root.add(pick);
    t.pickable(root, { type: 'unit', id: ID });
    t.scene.add(root);
    const label = t.label('Scout drone', { tone: 'sim', sub: 'concept', priority: 6, sel: { type: 'unit', id: ID } });

    // ---------- scan layer: swath paint, frustum, scan line ----------
    const scan = new THREE.Group(); scan.name = 'drone-scan'; t.scene.add(scan);
    const sPos = new Float32Array(MAX_SWATHS * 4 * 3), sY = new Float32Array(MAX_SWATHS * 4 * 2), sLead = new Float32Array(MAX_SWATHS * 4 * 2), sIdx = [];
    for (let i = 0; i < MAX_SWATHS; i++) sIdx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
    const swathGeo = new THREE.BufferGeometry();
    swathGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
    swathGeo.setAttribute('aY', new THREE.BufferAttribute(sY, 2).setUsage(THREE.DynamicDrawUsage));
    swathGeo.setAttribute('aLead', new THREE.BufferAttribute(sLead, 2).setUsage(THREE.DynamicDrawUsage));
    swathGeo.setIndex(sIdx); swathGeo.setDrawRange(0, 0);
    const swathMat = decalMaterial(THREE, {
      uniforms: { uColor: { value: pal.scan }, uFade: { value: 1 } },
      vertexShader: [
        'attribute vec2 aY, aLead; varying vec2 vW, vY, vLead;',
        'void main(){ vW = vec2(position.x, -position.z); vY = aY; vLead = aLead; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor; uniform float uFade; varying vec2 vW, vY, vLead;',
        'void main(){',
        '  float aa = fwidth(vW.x);',
        '  float f = abs(fract(vW.x * 0.5) - 0.5) * 2.0;',                                          // a fine line every two metres
        '  float ln = (1.0 - smoothstep(0.03, 0.03 + aa, f)) * (1.0 - smoothstep(0.25, 0.9, aa));',
        '  float e = min(vW.y - vY.x, vY.y - vW.y), ea = fwidth(vW.y);',
        '  float edge = 1.0 - smoothstep(0.05, 0.05 + ea * 1.2, e);',                   // hairline between passes
        '  float d = (vLead.x - vW.x) * vLead.y;',
        '  float lead = abs(vLead.y) * exp(-max(d, 0.0) / 4.5);',                       // freshly captured ground behind the line
        '  float a = 0.016 + 0.022 * ln + 0.04 * edge + lead * (0.11 + 0.06 * ln);',
        '  gl_FragColor = vec4(uColor, a * uFade);',
        '  #include <colorspace_fragment>',
        '}'].join('\n'),
    });
    const swaths = new THREE.Mesh(swathGeo, swathMat); swaths.frustumCulled = false; swaths.position.y = t.groundY + Y.swath; swaths.renderOrder = 2; swaths.visible = false; scan.add(swaths);

    // frustum: local frame at the ground under the drone, x along track. Vertex y of 1 = the camera (scaled by uAlt).
    const hx = FOOT_ALONG / 2, fr = new THREE.Group(); fr.visible = false; scan.add(fr);
    const corner = [[hx, 1], [hx, -1], [-hx, -1], [-hx, 1]];                             // z = sign * half width (uHalf)
    const lineV = [], lineA = [], faceV = [], faceA = [];
    corner.forEach(([x, s], i) => { const [x2, s2] = corner[(i + 1) % 4];
      lineV.push(0, 1, 0, x, 0, s); lineA.push(1, 0); lineV.push(x, 0, s, x2, 0, s2); lineA.push(0, 0);
      faceV.push(0, 1, 0, x, 0, s, x2, 0, s2); faceA.push(1, 0, 0); });
    const frUniforms = { uColor: { value: pal.scan }, uAlt: { value: 30 }, uHalf: { value: 11 }, uApex: { value: new THREE.Vector3() }, uOpacity: { value: 0 } };
    const frVert = [
      'attribute float aH; uniform float uAlt, uHalf; uniform vec3 uApex; varying float vH;',
      'void main(){ vH = aH; vec3 p = aH > 0.5 ? uApex : vec3(position.x, 0.0, position.z * uHalf); gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }'].join('\n');
    const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineV, 3)); lineGeo.setAttribute('aH', new THREE.Float32BufferAttribute(lineA, 1));
    const frLines = new THREE.LineSegments(lineGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: frUniforms, vertexShader: frVert,
      fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying float vH; void main(){ gl_FragColor = vec4(uColor, uOpacity * mix(0.6, 0.16, smoothstep(0.0, 0.9, vH))); \n#include <colorspace_fragment>\n }' }));
    const faceGeo = new THREE.BufferGeometry(); faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(faceV, 3)); faceGeo.setAttribute('aH', new THREE.Float32BufferAttribute(faceA, 1));
    const frFaces = new THREE.Mesh(faceGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: frUniforms, vertexShader: frVert,
      fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying float vH; void main(){ float k = 1.0 - vH; gl_FragColor = vec4(uColor, uOpacity * (0.008 + 0.028 * k * k * k)); \n#include <colorspace_fragment>\n }' }));
    frLines.frustumCulled = frFaces.frustumCulled = false; frLines.renderOrder = 7; frFaces.renderOrder = 6; fr.add(frFaces, frLines);

    const beamGeo = new THREE.PlaneGeometry(1.8, 2).rotateX(-Math.PI / 2);               // x: thickness along track, z: -1..1 across
    const beamMat = decalMaterial(THREE, {
      blending: THREE.AdditiveBlending, uniforms: { uColor: { value: pal.scan }, uOpacity: { value: 0 }, uHalf: { value: 11 } },
      vertexShader: 'uniform float uHalf; varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, 0.0, position.z * uHalf, 1.0); }',
      fragmentShader: [
        'uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;',
        'void main(){',
        '  float v = vUv.x, core = exp(-v * v * 260.0), halo = exp(-v * v * 9.0);',
        '  float ends = 1.0 - smoothstep(0.93, 1.0, abs(vUv.y));',
        '  gl_FragColor = vec4(uColor * (core * 1.5 + halo * 0.22) * ends * uOpacity, 1.0);',
        '  #include <colorspace_fragment>',
        '}'].join('\n'),
    });
    const beam = new THREE.Mesh(beamGeo, beamMat); beam.frustumCulled = false; beam.renderOrder = 8; beam.visible = false; beam.position.y = t.groundY + Y.swath + 0.012; scan.add(beam); t.glow(beam);

    // ---------- state ----------
    const watch = stateWatcher();
    let sx = home[0], sy = home[1], salt = 0, shead = 0, pitch = 0, roll = 0, spin = 0, phase = 0, frOp = 0, recOp = 0, swFade = 1, swKey = NaN, layerOn = true;
    let lastSub = 'concept';
    const ang = [0, 0.9, 1.8, 2.7], lpos = new THREE.Vector3();

    function writeSwaths(list, activeIdx, dir) {
      const n = Math.min(list.length, MAX_SWATHS);
      for (let i = 0; i < n; i++) {
        const s = list[i]; let x0 = s.x0, x1 = s.x1, lead = 0, ld = 0;
        let lo = Math.max(0, s.y - s.half); const hi = Math.min(siteH, s.y + s.half);
        for (let j = 0; j < i; j++) { const o = list[j]; if (o.y < s.y) lo = Math.max(lo, Math.min(hi, o.y + o.half)); }   // later passes do not repaint the overlap
        if (i === activeIdx) { if (dir > 0) { x1 = clamp(sx, x0, x1); lead = x1; ld = 1; } else { x0 = clamp(sx, x0, x1); lead = x0; ld = -1; } }
        const k = i * 12; sPos[k] = x0; sPos[k + 2] = -lo; sPos[k + 3] = x1; sPos[k + 5] = -lo; sPos[k + 6] = x0; sPos[k + 8] = -hi; sPos[k + 9] = x1; sPos[k + 11] = -hi;
        for (let v = 0; v < 4; v++) { sY[i * 8 + v * 2] = lo; sY[i * 8 + v * 2 + 1] = hi; sLead[i * 8 + v * 2] = lead; sLead[i * 8 + v * 2 + 1] = ld; }
      }
      swathGeo.attributes.position.needsUpdate = swathGeo.attributes.aY.needsUpdate = swathGeo.attributes.aLead.needsUpdate = true;
      swathGeo.setDrawRange(0, n * 6);
    }

    return {
      update(state, dt, time) {
        const u = state.units[ID]; if (!u) { root.visible = false; scan.visible = false; label.setVisible?.(false); return; }
        const fresh = watch(state), pos = u.pos || home, alt = u.alt || 0, mode = u.mode, heading = u.heading || 0;
        const airborne = alt > 0.05, powered = mode === 'takeoff' || mode === 'scan' || mode === 'return' || airborne;
        const spinT = airborne ? 1 : mode === 'takeoff' ? 0.22 : 0;
        const list = state.map.swaths;
        let active = -1; if (mode === 'scan') for (let i = 0; i < list.length; i++) if (Math.abs(list[i].y - pos[1]) < 0.5) active = i;
        const pitchT = airborne ? -0.13 * clamp((u.v || 0) / 8, 0, 1) : 0;

        if (fresh) {
          sx = pos[0]; sy = pos[1]; salt = alt; shead = heading; pitch = pitchT; roll = 0; spin = spinT;
          frOp = mode === 'scan' ? 1 : 0; recOp = active >= 0 ? 1 : 0; swFade = state.map.ready ? 0 : 1; swKey = NaN;
        } else {
          const lam = chase(state.speed);
          sx = damp(sx, pos[0], lam, dt); sy = damp(sy, pos[1], lam, dt); salt = damp(salt, alt, lam, dt);
          let err = (heading - shead) % (Math.PI * 2); if (err > Math.PI) err -= Math.PI * 2; else if (err < -Math.PI) err += Math.PI * 2;
          roll = damp(roll, airborne ? -clamp(err * 0.55, -0.38, 0.38) : 0, 6, dt);
          shead = dampAngle(shead, heading, 5, dt);
          pitch = damp(pitch, pitchT, 3, dt);
          spin = damp(spin, spinT, spinT > spin ? 3.2 : 1.6, dt);
          frOp = damp(frOp, mode === 'scan' ? 1 : 0, 7, dt); recOp = damp(recOp, active >= 0 ? 1 : 0, 12, dt);
          swFade = state.map.ready ? Math.max(0, swFade - dt / 2) : 1;
        }

        // airframe
        const air = t.reduced ? 0 : smoothstep(0.5, 4, salt);
        root.position.set(sx, t.groundY + salt + air * (Math.sin(time * 1.9) * 0.07 + Math.sin(time * 3.1 + 1.3) * 0.03), -sy);
        root.rotation.set(roll + air * 0.012 * Math.sin(time * 2.3 + 0.7), shead, pitch + air * 0.01 * Math.sin(time * 1.7));
        gimbal.rotation.set(-root.rotation.x, 0, -root.rotation.z);
        const turning = spin > 0.004;
        if (turning && !t.reduced) { const w = spin * dt * 150; for (let i = 0; i < 4; i++) ang[i] += (i % 2 ? -w : w); phase += dt * 9 * spin; }
        blades.visible = spin < 0.5;
        if (blades.visible && turning && !t.reduced) { for (let i = 0; i < 4; i++) blades.setMatrixAt(i, m4.makeRotationY(ang[i]).setPosition(parts.tips[i][0], PROP_Y, parts.tips[i][1])); blades.instanceMatrix.needsUpdate = true; }
        discs.visible = spin > 0.12; discMat.uniforms.uSpin.value = smoothstep(0.12, 0.75, spin); discMat.uniforms.uPhase.value = phase;
        lights.visible = powered;
        if (powered) {
          const lu = lightMat.uniforms; lu.uOn.value = 1; lu.uPx.value = t.renderer.domElement.height * 0.5 * t.camera.projectionMatrix.elements[5];
          if (t.reduced) lu.uStrobe.value = 0.55; else { const p = time % 1.2; lu.uStrobe.value = (p < 0.06 || (p > 0.16 && p < 0.22)) ? 1 : 0.04; }
        }
        label.setPosition(lpos.set(sx, root.position.y + 0.3 * SCALE.drone, -sy));
        const sub = mode === 'scan' ? 'concept · surveying' : mode === 'return' ? 'concept · returning' : mode === 'takeoff' ? 'concept · taking off' : 'concept';
        if (sub !== lastSub) { lastSub = sub; label.setSub?.(sub); }

        // scan layer
        if (!layerOn) return;
        const n = list.length;
        swaths.visible = n > 0 && swFade > 0.001;
        if (swaths.visible) {
          swathMat.uniforms.uFade.value = swFade * swFade * (3 - 2 * swFade);
          const dir = Math.cos(heading) >= 0 ? 1 : -1;
          let key = n * 7 + active * 131 + (active >= 0 ? sx * dir : 0);
          for (let i = 0; i < n; i++) key += list[i].x0 * (1.37 + i) + list[i].x1 * (2.11 + i);
          if (key !== swKey) { swKey = key; writeSwaths(list, active, dir); }
        }
        fr.visible = frOp > 0.01; beam.visible = recOp > 0.01 && frOp > 0.01;
        if (fr.visible) {
          const half = active >= 0 ? list[active].half : n ? list[n - 1].half : 11;
          fr.position.set(sx, t.groundY + Y.swath + 0.012, -sy); fr.rotation.y = shead;
          frUniforms.uAlt.value = salt; frUniforms.uHalf.value = half; frUniforms.uOpacity.value = frOp * smoothstep(1, 8, salt);
          frUniforms.uApex.value.set(0.086 * SCALE.drone, Math.max(0.05, salt + 0.03 * SCALE.drone - fr.position.y), 0);
          if (beam.visible) { beam.position.x = sx; beam.position.z = -sy; beam.rotation.y = shead; beamMat.uniforms.uOpacity.value = recOp * frUniforms.uOpacity.value; beamMat.uniforms.uHalf.value = half; }
        }
      },
      setLayer(id, on) { if (id !== 'scan') return; layerOn = !!on; scan.visible = layerOn; swKey = NaN; },
      onSelect() {},
      dispose() { disposeTree(root); disposeTree(scan); pickMat.dispose(); label.remove(); },
    };
  },
};
