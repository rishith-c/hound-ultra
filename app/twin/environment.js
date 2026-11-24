// The setting: an overcast, wet valley. Sky and its reflection map, the key light and its shadow, the painted
// ground of the site, the valley terrain around it (so the site does not float in a void), the river, the town's
// other houses, hillside trees, drifting mist, and the survey grid.
import * as THREE from 'three';
import { GROUND, TERRAIN_BASE } from './textures.js';
import { groundify } from './materials.js';
import { rng, makeNoise, smooth, clamp, instanced, matrix, merge, box, tint } from './util.js';

export const HORIZON = new THREE.Color(0.165, 0.19, 0.22);      // linear; the fog takes this colour
const SKY_FRAG = `
  uniform vec3 uHorizon; uniform float uTime; varying vec3 vDir;
  float h1(float n) { return fract(sin(n) * 43758.5453); }
  float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
  float ridge(float a, float s) { return n1(a * 3.0 + s) * 0.5 + n1(a * 7.0 + s * 2.0) * 0.28 + n1(a * 19.0 + s * 3.0) * 0.13 + n1(a * 47.0 + s) * 0.06; }
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    vec3 d = normalize(vDir); float y = d.y, az = atan(d.x, d.z);
    vec3 zen = vec3(0.035, 0.047, 0.064);
    vec3 col = mix(uHorizon * 1.5, zen, pow(clamp(y, 0.0, 1.0), 0.42));
    vec2 cp = d.xz / max(0.12, y + 0.12);                           // a heavy, slow cloud deck
    float c = n2(cp * 1.3 + uTime * 0.004) * 0.55 + n2(cp * 3.1 - uTime * 0.006) * 0.3 + n2(cp * 7.3) * 0.15;
    col += (c - 0.5) * vec3(0.085, 0.09, 0.095) * smoothstep(-0.02, 0.35, y);
    col += vec3(0.08, 0.075, 0.065) * pow(max(dot(d, normalize(vec3(0.52, 0.6, 0.6))), 0.0), 6.0);   // the sun, somewhere behind the cloud
    float wall = 0.07 + 0.11 * pow(abs(sin(az)), 1.5);               // the valley runs north-south: higher walls east and west
    float r2 = wall * 1.45 + ridge(az, 11.0) * 0.16, r1 = wall + ridge(az, 3.0) * 0.11;
    col = mix(col, mix(uHorizon * 1.08, vec3(0.085, 0.1, 0.118), 0.42), smoothstep(r2 + 0.004, r2 - 0.004, y) * 0.9);
    col = mix(col, mix(uHorizon, vec3(0.05, 0.062, 0.07), 0.62), smoothstep(r1 + 0.004, r1 - 0.004, y));
    col = mix(col, uHorizon, smoothstep(0.05, -0.02, y));
    col = mix(col, vec3(0.045, 0.042, 0.038), smoothstep(-0.02, -0.25, y));       // below the horizon: dark wet earth (for reflections)
    gl_FragColor = vec4(col, 1.0);
  }`;

export function buildEnvironment(env) {
  const { scene, renderer, world, tex, quality } = env;
  const group = new THREE.Group(); group.name = 'environment'; scene.add(group);
  const C0 = new THREE.Vector3(GROUND.x0 + GROUND.size / 2, 0, -(GROUND.y0 + GROUND.size / 2));

  // ---- sky, fog and what the wet ground reflects ----
  const skyMat = new THREE.ShaderMaterial({ uniforms: { uHorizon: { value: HORIZON }, uTime: { value: 0 } }, vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), skyMat); sky.scale.setScalar(4200); sky.renderOrder = -10; sky.frustumCulled = false; sky.name = 'sky'; group.add(sky);
  scene.fog = new THREE.FogExp2(HORIZON.clone(), 0.003); scene.background = null;
  const pm = new THREE.PMREMGenerator(renderer), skyScene = new THREE.Scene(), skyCopy = new THREE.Mesh(sky.geometry, skyMat); skyCopy.scale.setScalar(50); skyScene.add(skyCopy);
  const envRT = pm.fromScene(skyScene, 0.02, 0.1, 200); scene.environment = envRT.texture; scene.environmentIntensity = 1.0; pm.dispose();

  // ---- light: one soft key through the cloud, sky fill from above, wet earth bounce from below ----
  const hemi = new THREE.HemisphereLight(0xb4c6da, 0x4a4238, 0.85); group.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.7); const sunDir = new THREE.Vector3(0.52, 0.6, 0.6).normalize();
  sun.castShadow = true; const SM = quality === 'high' ? 4096 : 2048; sun.shadow.mapSize.set(SM, SM); sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.035; sun.shadow.radius = 2.2; sun.shadow.blurSamples = 12;
  group.add(sun, sun.target);
  const lightRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize(), lightUp = new THREE.Vector3().crossVectors(sunDir, lightRight).normalize(), sc = new THREE.Vector3();
  let shadowR = 0;
  // Fit the shadow map to what the camera is looking at: a wide view shadows the whole site, a close-up of the
  // rover gets every texel. The centre snaps to whole texels so shadows do not crawl as the camera moves.
  function fitShadow(target, dist, pitch) {
    let R = clamp(dist * (1.15 + 1.5 * (1 - Math.sin(pitch))), 12, 96); R = Math.pow(1.3, Math.ceil(Math.log(R) / Math.log(1.3)));
    const texel = (2 * R) / SM; sc.copy(target).setY(0); sc.x = clamp(sc.x, -20, 140); sc.z = clamp(sc.z, -110, 20);
    const a = Math.round(sc.dot(lightRight) / texel) * texel, b = Math.round(sc.dot(lightUp) / texel) * texel, c = sc.dot(sunDir);
    sc.set(0, 0, 0).addScaledVector(lightRight, a).addScaledVector(lightUp, b).addScaledVector(sunDir, c);
    sun.target.position.copy(sc); sun.position.copy(sc).addScaledVector(sunDir, 180); sun.target.updateMatrixWorld();
    if (R !== shadowR) { shadowR = R; const cam = sun.shadow.camera; cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 40; cam.far = 330; cam.updateProjectionMatrix(); }
  }
  fitShadow(new THREE.Vector3(62, 0, -44), 90, 0.6);

  // ---- the site's ground ----
  const gm = tex.groundMacro(), gd = tex.groundDetail();
  const dn = gd.normalMap.clone(); dn.repeat.set(GROUND.size / 3, GROUND.size / 3); dn.needsUpdate = true;
  const groundMat = groundify(new THREE.MeshStandardMaterial({ map: gm.map, roughnessMap: gm.roughnessMap, roughness: 1, normalMap: dn, normalScale: new THREE.Vector2(2.4, 2.4), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }), gd);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND.size, GROUND.size).rotateX(-Math.PI / 2), groundMat);
  ground.position.copy(C0); ground.receiveShadow = true; ground.name = 'ground'; ground.matrixAutoUpdate = false; ground.updateMatrix(); group.add(ground);

  // ---- the valley around it ----
  const n = makeNoise('terrain'), half = GROUND.size / 2 - 0.5;
  const RIVER_X = (z) => -168 + 30 * Math.sin(z / 130) + 14 * Math.sin(z / 47 + 1.3);
  function heightAt(dx, dz) {                                       // dx east, dz south, both from the centre of the ground square
    const d = Math.max(Math.abs(dx) - half, Math.abs(dz) - half, 0); if (d <= 0) return 0;
    const east = Math.max(0, dx - half), west = Math.max(0, -dx - half - 150), ns = Math.max(0, Math.abs(dz) - half);
    let h = Math.pow(east / 300, 1.3) * 210 + Math.pow(west / 280, 1.3) * 230 + ns * 0.02 + Math.pow(ns / 820, 2.2) * 260;
    h += (n.fbm(dx / 170 + 9, dz / 170 + 4, 4) - 0.42) * 70 * smooth(20, 320, d) + (n.fbm(dx / 34, dz / 34, 3) - 0.5) * 5 * smooth(6, 60, d) + (n.fbm(dx / 9, dz / 9, 2) - 0.5) * 0.7 * smooth(2, 20, d);
    if (dx > half - 10 && dz < -half + 60) h += smooth(0, 120, east) * 26 * smooth(-half + 70, -half - 40, dz);     // the slope that failed, north-east
    const rv = (dx - RIVER_X(dz)) / 26; h -= 7.5 * Math.exp(-rv * rv) * smooth(0, 30, d);
    return Math.max(-4.5, h * smooth(0, 46, d));
  }
  const N = quality === 'high' ? 220 : 150, span = 1500, tg = new THREE.PlaneGeometry(2, 2, N, N).rotateX(-Math.PI / 2), tp = tg.attributes.position, tc = new Float32Array(tp.count * 3), tuv = new Float32Array(tp.count * 2);
  const warp = (u) => Math.sign(u) * Math.pow(Math.abs(u), 1.75) * span;
  for (let i = 0; i < tp.count; i++) { const x = warp(tp.getX(i)), z = warp(tp.getZ(i)), d = Math.max(Math.abs(x) - half, Math.abs(z) - half); tp.setXYZ(i, x, d < -8 ? -0.4 : d <= 0 ? -0.03 : heightAt(x, z), z); tuv[i * 2] = x / 3; tuv[i * 2 + 1] = -z / 3; }
  tg.computeVertexNormals(); tg.setAttribute('uv', new THREE.BufferAttribute(tuv, 2));
  const base = new THREE.Color(TERRAIN_BASE), grass = new THREE.Color('#414a39'), scrub = new THREE.Color('#4d4a3a'), rockC = new THREE.Color('#5a5852'), scar = new THREE.Color('#6b5d4c'), wetC = new THREE.Color('#3a352e'), col = new THREE.Color(), tn = tg.attributes.normal;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i), slope = 1 - tn.getY(i), d = Math.max(Math.abs(x) - half, Math.abs(z) - half, 0), k = n.fbm(x / 60 + 3, z / 60, 3);
    col.copy(base).lerp(k > 0.5 ? grass : scrub, smooth(8, 70, d) * 0.9).lerp(rockC, smooth(0.18, 0.42, slope)).lerp(wetC, smooth(-0.3, -3, y));
    if (x > half - 20 && z < -half + 70) col.lerp(scar, smooth(0.4, 0.62, n.fbm(x / 45, z / 90 + 7, 3) + smooth(160, 0, Math.abs(x - 150 + (z + 140) * 0.5)) * 0.25) * 0.85);
    col.multiplyScalar(0.8 + n.fbm(x / 14, z / 14, 2) * 0.4);
    tc[i * 3] = col.r; tc[i * 3 + 1] = col.g; tc[i * 3 + 2] = col.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  const dn2 = gd.normalMap.clone(); dn2.needsUpdate = true;
  const terrainMat = groundify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, normalMap: dn2, normalScale: new THREE.Vector2(1.2, 1.2) }), gd);
  const terrain = new THREE.Mesh(tg, terrainMat); terrain.position.copy(C0); terrain.receiveShadow = false; terrain.name = 'terrain'; terrain.matrixAutoUpdate = false; terrain.updateMatrix(); group.add(terrain);

  // the river, still swollen and brown
  const rp = [], ruv = [], ri = [];
  for (let i = 0; i <= 60; i++) { const z = -1400 + i * (2800 / 60), x = RIVER_X(z), w = 30 + 8 * Math.sin(z / 90); rp.push(x - w, -3.1, z, x + w, -3.1, z); ruv.push(0, z / 24, 2.5, z / 24); if (i < 60) { const a = i * 2; ri.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2)); rg.setIndex(ri); rg.computeVertexNormals();
  const rn = gd.normalMap.clone(); rn.needsUpdate = true;
  const river = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x6a6253, roughness: 0.16, metalness: 0.55, normalMap: rn, normalScale: new THREE.Vector2(0.5, 0.5) })); river.position.copy(C0); river.name = 'river'; group.add(river);

  // hillside trees and the rest of the town, far enough away to be shapes in the mist
  const R = rng('valley'), trees = [], tcol = [], houses = [], hcol = [], roofs = [];
  const treeGeo = merge([tint(new THREE.ConeGeometry(1.5, 4.2, 6).translate(0, 4.4, 0), 0xffffff), tint(new THREE.ConeGeometry(1.1, 3.2, 6).translate(0, 6.6, 0), 0xffffff), tint(new THREE.CylinderGeometry(0.16, 0.22, 2.4, 5).translate(0, 1.2, 0), 0x6b5a48)]);
  for (let i = 0; i < (quality === 'high' ? 5200 : 2400) && trees.length < 2600; i++) {
    const x = (R() - 0.5) * 1700, z = (R() - 0.5) * 1700, d = Math.max(Math.abs(x) - half, Math.abs(z) - half); if (d < 26) continue;
    const y = heightAt(x, z); if (y < 3 || n.fbm(x / 80 + 20, z / 80, 3) < 0.47) continue;
    if (x > half - 10 && z < -half + 70 && n.fbm(x / 45, z / 90 + 7, 3) > 0.5) continue;                 // nothing left standing on the slide
    const s = 0.8 + R() * 1.5; trees.push(matrix(C0.x + x, y - 0.3, C0.z + z, R() * 6.3, (R() - 0.5) * 0.12, (R() - 0.5) * 0.12, [s, s * (0.9 + R() * 0.5), s])); tcol.push(col.setRGB(0.1 + R() * 0.05, 0.15 + R() * 0.06, 0.11 + R() * 0.03).getHex());
  }
  const treeMesh = instanced(treeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), trees, { colors: tcol, cast: false, receive: false, name: 'trees' }); group.add(treeMesh);
  const wallTints = [0x8f897f, 0x7d766b, 0x99948b, 0x6f6b65, 0x777d7f, 0x84735f];
  for (let i = 0; i < 900 && houses.length < 110; i++) {
    const x = -half - 30 + R() * 330, z = (R() - 0.5) * 1300, d = Math.max(Math.abs(x) - half, Math.abs(z) - half); if (d < 14) continue;
    const y = heightAt(x, z), e = 3; if (y < 0.2 || y > 26 || Math.abs(heightAt(x + e, z) - y) > 1 || Math.abs(heightAt(x, z + e) - y) > 1) continue;
    if (Math.abs(x - RIVER_X(z)) < 44) continue;
    const w = 6 + R() * 7, dp = 5 + R() * 5, hh = 3 + Math.floor(R() * 3) * 2.8, ry = (R() - 0.5) * 0.5 + (R() < 0.5 ? 0 : Math.PI / 2), lean = R() < 0.18 ? (R() - 0.5) * 0.16 : 0;
    houses.push(matrix(C0.x + x, y - 0.4, C0.z + z, ry, lean, lean * 0.6, [w, hh, dp])); hcol.push(R.pick(wallTints)); roofs.push(matrix(C0.x + x, y - 0.4 + hh * Math.cos(lean), C0.z + z, ry, lean, lean * 0.6, [w * 1.08, 1, dp * 1.1]));
  }
  const houseMesh = instanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.95 }), houses, { colors: hcol, cast: false, receive: false, name: 'town' });
  const roofGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 1).rotateZ(Math.PI / 2).scale(1, 1.0, 1.16).translate(0, 0.25, 0);
  const roofMesh = instanced(roofGeo, new THREE.MeshStandardMaterial({ color: 0x5d646a, roughness: 0.6, metalness: 0.4 }), roofs, { cast: false, receive: false, name: 'town-roofs' });
  group.add(houseMesh, roofMesh);

  // ---- mist: soft sheets drifting down the valley ----
  const MN = quality === 'high' ? 34 : 16, mg = new THREE.InstancedBufferGeometry(), quad = new THREE.PlaneGeometry(1, 1);
  mg.index = quad.index; mg.setAttribute('position', quad.attributes.position); mg.setAttribute('uv', quad.attributes.uv);
  const mo = new Float32Array(MN * 4), ms = new Float32Array(MN * 3);
  for (let i = 0; i < MN; i++) { const a = R() * 6.283, rad = 190 + R() * 380; mo[i * 4] = C0.x + Math.cos(a) * rad; mo[i * 4 + 1] = 9 + R() * R() * 50; mo[i * 4 + 2] = C0.z + Math.sin(a) * rad; mo[i * 4 + 3] = R() * 100; ms[i * 3] = 90 + R() * 150; ms[i * 3 + 1] = 16 + R() * 26; ms[i * 3 + 2] = 0.35 + R() * 0.65; }
  mg.setAttribute('aOff', new THREE.InstancedBufferAttribute(mo, 4)); mg.setAttribute('aSize', new THREE.InstancedBufferAttribute(ms, 3)); mg.instanceCount = MN;
  const mistMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: HORIZON.clone().multiplyScalar(2.0) }, uOpacity: { value: 0.12 } }, transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute vec4 aOff; attribute vec3 aSize; uniform float uTime; varying vec2 vUv; varying float vA; varying float vSeed;
      void main() { vUv = uv; vSeed = aOff.w; vec3 c = aOff.xyz; c.x += mod(uTime * (1.2 + aSize.z) + aOff.w * 9.0, 900.0) - 450.0 + 60.0; c.z += sin(uTime * 0.05 + aOff.w) * 12.0;
        vec4 mv = viewMatrix * vec4(c, 1.0); float dist = -mv.z; mv.xy += position.xy * aSize.xy;
        vA = aSize.z * smoothstep(70.0, 220.0, dist) * (1.0 - smoothstep(520.0, 900.0, dist)); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uTime; varying vec2 vUv; varying float vA; varying float vSeed;
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      void main() { vec2 q = vUv - 0.5; float e = smoothstep(0.5, 0.05, length(q * vec2(1.0, 1.25)));
        float w = n2(vUv * vec2(5.0, 2.0) + vSeed + uTime * 0.01) * 0.6 + n2(vUv * vec2(11.0, 5.0) - vSeed) * 0.4;
        float a = e * e * smoothstep(0.2, 0.75, w) * vA * uOpacity; if (a < 0.003) discard; gl_FragColor = vec4(uColor, a); }`,
  });
  const mist = new THREE.Mesh(mg, mistMat); mist.frustumCulled = false; mist.renderOrder = 20; mist.name = 'mist'; group.add(mist);

  // ---- survey grid (layer "grid"): 10 m squares over the 120 x 90 m site, 2 m squares up close ----
  const S = world.SITE, gridMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uSize: { value: new THREE.Vector2(S.w, S.h) }, uOpacity: { value: 0 } }, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: 'varying vec2 vP; uniform vec2 uSize; void main() { vP = uv * uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vP; uniform vec2 uSize; uniform float uOpacity;
      float line(vec2 p, float step, float w) { vec2 g = abs(fract(p / step - 0.5) - 0.5) * step; vec2 fw = fwidth(p) * w; vec2 l = 1.0 - smoothstep(vec2(0.0), fw, g); return max(l.x, l.y); }
      void main() { float fine = line(vP, 2.0, 1.0) * (1.0 - smoothstep(0.02, 0.09, max(fwidth(vP.x), fwidth(vP.y)))); float major = line(vP, 10.0, 1.4);
        vec2 e = min(vP, uSize - vP); float border = 1.0 - smoothstep(0.0, max(fwidth(vP.x), fwidth(vP.y)) * 2.2, min(e.x, e.y));
        float a = max(max(fine * 0.14, major * 0.34), border * 0.75) * uOpacity; if (a < 0.004) discard; gl_FragColor = vec4(vec3(0.62, 0.78, 1.0) * 0.8, a); }`,
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(S.w, S.h).rotateX(-Math.PI / 2), gridMat); grid.position.set(S.w / 2, 0.035, -S.h / 2); grid.visible = false; grid.renderOrder = 4; grid.name = 'grid'; group.add(grid);
  let gridOn = false;

  return {
    group, sun, hemi, heightAt: (x, y) => heightAt(x - C0.x, -y - C0.z), fitShadow,
    setGrid(on) { gridOn = !!on; if (on) grid.visible = true; },
    update(dt, time, camera, pose, animate) {
      sky.position.copy(camera.position);
      if (animate) { skyMat.uniforms.uTime.value = time; mistMat.uniforms.uTime.value = time; rn.offset.y = -time * 0.035; rn.offset.x = Math.sin(time * 0.1) * 0.02; }
      const go = gridMat.uniforms.uOpacity; go.value += ((gridOn ? 1 : 0) - go.value) * Math.min(1, dt * 8); if (!gridOn && go.value < 0.01) grid.visible = false;
      if (pose) {
        fitShadow(pose.target, pose.dist, pose.pitch);
        scene.fog.density = clamp(0.3 / Math.max(pose.dist, 1), 0.0011, 0.0034);       // keep the subject clear however far the camera pulls back
        mistMat.uniforms.uOpacity.value = 0.12 * clamp(140 / pose.dist, 0.3, 1);
      }
    },
    dispose() { envRT.dispose(); dn.dispose(); dn2.dispose(); rn.dispose(); scene.environment = null; scene.fog = null; scene.remove(group); },
  };
}
