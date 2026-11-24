// Sky, light and weather. First light after the flood by default: a blue-hour sky with a warm break over the ridge,
// a low key light with long shadows, cool fill, mist lying in the valley (the mist itself is drawn in post.js).
// setLight('dawn' | 'day' | 'night') eases between three moods. The wet ground reflects a map made from this same sky.
import * as THREE from 'three';
import { buildTerrain } from './terrain.js';
import { rng, clamp } from './util.js';

const C = (r, g, b) => new THREE.Color(r, g, b), V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
export const LIGHTS = {
  dawn: { sunDir: V(0.78, 0.33, -0.56), sun: C(1.0, 0.66, 0.4), sunI: 4.4, sky: C(0.5, 0.6, 0.8), earth: C(0.2, 0.15, 0.11), hemi: 0.85, zen: C(0.05, 0.075, 0.125), hor: C(0.27, 0.31, 0.39), warm: C(1.0, 0.52, 0.25), warmI: 1.25, fog: C(0.2, 0.245, 0.32), fogSun: C(0.95, 0.52, 0.27), fogA: 0.00042, fogH: 0.0075, fogB: 0.034, fogBase: -40, env: 0.85, exp: 1.12, lamps: 1.0, stars: 0, pic: 0.92 },
  day: { sunDir: V(0.5, 0.68, 0.46), sun: C(1.0, 0.93, 0.82), sunI: 3.6, sky: C(0.6, 0.72, 0.88), earth: C(0.3, 0.26, 0.21), hemi: 0.95, zen: C(0.13, 0.2, 0.31), hor: C(0.5, 0.54, 0.58), warm: C(0.9, 0.82, 0.68), warmI: 0.35, fog: C(0.42, 0.46, 0.5), fogSun: C(0.7, 0.66, 0.58), fogA: 0.0005, fogH: 0.005, fogB: 0.032, fogBase: -50, env: 0.95, exp: 0.95, lamps: 0.0, stars: 0, pic: 0 },
  night: { sunDir: V(-0.5, 0.62, -0.35), sun: C(0.55, 0.68, 1.0), sunI: 0.95, sky: C(0.2, 0.3, 0.55), earth: C(0.05, 0.05, 0.06), hemi: 0.28, zen: C(0.006, 0.011, 0.026), hor: C(0.03, 0.042, 0.068), warm: C(0.1, 0.13, 0.2), warmI: 0.25, fog: C(0.022, 0.03, 0.048), fogSun: C(0.05, 0.06, 0.09), fogA: 0.0008, fogH: 0.008, fogB: 0.034, fogBase: -46, env: 0.65, exp: 1.25, lamps: 1.6, stars: 1, pic: 0.9 },
};
const SKY = `
  uniform vec3 uZen, uHor, uWarm, uSunDir, uSun, uFog; uniform float uWarmI, uTime, uStars, uPicK, uSkyRot; uniform sampler2D tSkyA, tSkyB, tRidge; varying vec3 vDir;
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
  float fb(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.07 + vec2(11.3, 4.7); a *= 0.52; } return s; }
  float rdg(float a, float s) { float v = 0.0, w = 0.5; float x = a * 2.2 + s; for (int i = 0; i < 6; i++) { v += w * (1.0 - abs(n2(vec2(x, s)) * 2.0 - 1.0)); x = x * 2.1 + 3.1; w *= 0.5; } return v; }
  void main() {
    vec3 d = normalize(vDir); float y = d.y, sd = max(dot(d, uSunDir), 0.0), az = atan(d.x, -d.z);
    vec2 sh = normalize(uSunDir.xz); float sa = max(dot(normalize(d.xz + 1e-4), sh), 0.0);
    vec3 col = mix(uHor, uZen, pow(clamp(y * 1.25, 0.0, 1.0), 0.6));
    float glow = pow(sa, 3.0) * exp(-max(y - 0.02, 0.0) * 3.6);
    col += uWarm * glow * 0.62 * uWarmI + uSun * (pow(sd, 22.0) * 0.5 + pow(sd, 220.0) * 1.6) * uWarmI;
    // two decks of cloud, lit from below where the sun is
    vec2 cp = d.xz / max(0.1, y + 0.09); float c1 = fb(cp * vec2(0.75, 1.15) + uTime * 0.006), c2 = fb(cp * vec2(1.9, 2.8) - uTime * 0.009 + 4.0);
    float deck = smoothstep(0.42, 0.72, c1 * 0.72 + c2 * 0.34) * smoothstep(0.0, 0.16, y);
    vec3 under = mix(uHor * 0.5 + uZen * 0.35, uWarm * 1.15, clamp(pow(sa, 2.0) * 1.1 * uWarmI * exp(-y * 1.5) * (0.35 + c2), 0.0, 1.0));
    col = mix(col, under * (0.75 + c2 * 0.5), deck * 0.86);
    float st = step(0.9975, h2(floor(d.xy * 240.0 + d.z * 130.0))) * uStars * smoothstep(0.1, 0.4, y) * (1.0 - deck); col += st * 0.5;
    // photographed cloud, turned so that its sunrise sits where the sun is
    float su = fract(az / 6.2832 + uSkyRot), sv = 0.5 + asin(clamp(y, -1.0, 1.0)) / 3.14159; vec2 suv = vec2(su, clamp(sv, 0.505, 0.995));
    vec3 pa = texture2D(tSkyA, suv).rgb, pb = texture2D(tSkyB, suv).rgb; pa = mix(vec3(dot(pa, vec3(0.3, 0.59, 0.11))), pa, 0.6) * vec3(0.62, 0.6, 0.6) + pow(pa, vec3(2.0)) * vec3(1.5, 1.0, 0.6) * pow(sa, 1.4); col = mix(col, mix(pa, pb * 0.55, uStars), uPicK * smoothstep(-0.02, 0.05, y));
    // far snow peaks over the valley's own walls
    vec2 ruv = vec2(fract(az / 6.2832 * 3.0 + 0.13), (y + 0.10) / 0.36); if (ruv.y > 0.0 && ruv.y < 1.0) { vec4 rg = textureGrad(tRidge, ruv, dFdx(ruv) * 0.0, dFdy(ruv)); float lum = dot(rg.rgb, vec3(0.3, 0.59, 0.11)); vec3 rc = mix(vec3(lum), rg.rgb, 0.45) * (uHor * 1.15 + 0.01) + uWarm * uWarmI * smoothstep(0.35, 0.9, lum) * (0.25 + 0.75 * pow(sa, 1.0)) * 0.5; col = mix(col, mix(uFog, rc, smoothstep(0.0, 0.2, y) * 0.75 + 0.1), rg.a); }
    col = mix(col, uFog, smoothstep(0.07, -0.02, y) * 0.9); col = mix(col, vec3(0.03, 0.027, 0.024) * (0.4 + uHor.g * 2.0), smoothstep(-0.03, -0.3, y));
    gl_FragColor = vec4(min(col, vec3(1.9)), 1.0);
  }`;

export function buildEnvironment(env, D) {
  const { scene, renderer, quality, t } = env, group = new THREE.Group(); group.name = 'environment'; scene.add(group);
  const L = LIGHTS.dawn, cur = {}; for (const [k, v] of Object.entries(L)) cur[k] = v.clone ? v.clone() : v;
  const fog = { color: cur.fog, sun: cur.fogSun, dir: cur.sunDir, a: 0, h: 0, b: 0, base: 0 };
  let mode = 'dawn', target = null, tk = 1, envDirty = 0;

  // ---- sky and its reflection map ----
  const skyMat = new THREE.ShaderMaterial({ uniforms: { uZen: { value: cur.zen }, uHor: { value: cur.hor }, uWarm: { value: cur.warm }, uSun: { value: cur.sun }, uFog: { value: cur.fog }, uSunDir: { value: cur.sunDir }, uWarmI: { value: 1 }, uStars: { value: 0 }, uTime: { value: 0 }, uPicK: { value: 0 }, uSkyRot: { value: 0.83 - Math.atan2(0.78, 0.56) / (Math.PI * 2) }, tSkyA: { value: env.photos['sky-dawn']?.map || null }, tSkyB: { value: env.photos['sky-night']?.map || null }, tRidge: { value: env.photos.ridge?.map || null } }, vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: SKY, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), skyMat); sky.scale.setScalar(4000); sky.renderOrder = -10; sky.frustumCulled = false; sky.name = 'sky'; group.add(sky);
  scene.fog = null; scene.background = null;
  const pm = new THREE.PMREMGenerator(renderer), skyScene = new THREE.Scene(), skyCopy = new THREE.Mesh(sky.geometry, skyMat); skyCopy.scale.setScalar(50); skyScene.add(skyCopy); let envRT = null;
  function bakeEnv() { const old = envRT; envRT = pm.fromScene(skyScene, 0.01, 0.1, 200); scene.environment = envRT.texture; old && old.dispose(); }

  // ---- key, fill, shadow ----
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1), sun = new THREE.DirectionalLight(0xffffff, 1); group.add(hemi, sun, sun.target);
  const SM = quality === 'high' ? 4096 : 2048; sun.castShadow = true; sun.shadow.mapSize.set(SM, SM); sun.shadow.bias = -0.00018; sun.shadow.normalBias = 0.04; sun.shadow.radius = 2.4;
  const lr = new THREE.Vector3(), lu = new THREE.Vector3(), sc = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0); let shadowR = 0;
  // Fit the shadow map to what the camera sees; snap its centre to whole texels so shadows do not crawl.
  function fitShadow(tg, dist, pitch) {
    const sd = cur.sunDir; lr.crossVectors(UP, sd).normalize(); lu.crossVectors(sd, lr).normalize();
    let R = clamp(dist * (1.15 + 1.5 * (1 - Math.sin(pitch))), 14, 100); R = Math.pow(1.3, Math.ceil(Math.log(R) / Math.log(1.3)));
    const tx = (2 * R) / SM; sc.copy(tg).setY(0); sc.x = clamp(sc.x, -10, 130); sc.z = clamp(sc.z, -100, 10);
    const a = Math.round(sc.dot(lr) / tx) * tx, b = Math.round(sc.dot(lu) / tx) * tx, c = sc.dot(sd);
    sc.set(0, 0, 0).addScaledVector(lr, a).addScaledVector(lu, b).addScaledVector(sd, c);
    sun.target.position.copy(sc); sun.position.copy(sc).addScaledVector(sd, 190); sun.target.updateMatrixWorld();
    if (R !== shadowR) { shadowR = R; const k = sun.shadow.camera; k.left = -R; k.right = R; k.top = R; k.bottom = -R; k.near = 20; k.far = 360; k.updateProjectionMatrix(); }
  }

  const land = buildTerrain(env, D); group.add(land.group);

  // ---- working lights: a floodlight mast at staging, a bulb in the tent ----
  const lamps = new THREE.Group(); lamps.name = 'lamps'; group.add(lamps);
  const mast = [36.2, 22.4], steel = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.4, metalness: 0.8 }), lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const part = (g, x, y, z, m = steel) => { const q = new THREE.Mesh(g, m); q.position.set(x, y, z); q.castShadow = true; q.receiveShadow = true; lamps.add(q); return q; };
  part(new THREE.CylinderGeometry(0.05, 0.09, 6.4, 10), mast[0], 3.2, -mast[1]); for (let i = 0; i < 3; i++) { const l = part(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6), mast[0] + Math.cos(i * 2.1) * 0.5, 0.75, -mast[1] + Math.sin(i * 2.1) * 0.5); l.rotation.set(Math.sin(i * 2.1) * -0.62, 0, Math.cos(i * 2.1) * 0.62); }
  part(new THREE.BoxGeometry(1.5, 0.07, 0.07), mast[0], 6.35, -mast[1]);
  const aim = new THREE.Vector3(60, 0.5, -33), from = new THREE.Vector3(mast[0], 6.5, -mast[1]), yaw = Math.atan2(aim.x - from.x, aim.z - from.z);
  for (const s of [-0.55, 0, 0.55]) { const hx = from.x + Math.cos(yaw) * s, hz = from.z - Math.sin(yaw) * s, hd = part(new THREE.BoxGeometry(0.4, 0.3, 0.16), hx, 6.5, hz); hd.rotation.set(0.22, yaw, 0, 'YXZ'); const fc = part(new THREE.PlaneGeometry(0.34, 0.24), hx + Math.sin(yaw) * 0.09, 6.48, hz + Math.cos(yaw) * 0.09, lampMat); fc.rotation.set(0.22, yaw, 0, 'YXZ'); fc.castShadow = false; }
  const flood = new THREE.SpotLight(0xffe6c0, 0, 62, 0.52, 0.85, 1.35); flood.position.copy(from); flood.target.position.copy(aim); lamps.add(flood, flood.target);
  const bulb = new THREE.PointLight(0xffc98a, 0, 13, 1.6); bulb.position.set(30, 2.5, -16); lamps.add(bulb);
  const beamMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uK: { value: 0 }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vL; varying vec3 vP; void main() { vL = uv.y; vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; vec4 mv = viewMatrix * w; vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform float uK, uTime; varying vec3 vN; varying vec3 vV; varying float vL; varying vec3 vP; float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float n(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(h(i), h(i + vec3(1, 0, 0)), f.x), mix(h(i + vec3(0, 1, 0)), h(i + vec3(1, 1, 0)), f.x), f.y), mix(mix(h(i + vec3(0, 0, 1)), h(i + vec3(1, 0, 1)), f.x), mix(h(i + vec3(0, 1, 1)), h(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
      void main() { float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.8); float a = f * pow(vL, 2.2) * (0.55 + 0.7 * n(vP * 0.6 + vec3(uTime * 0.25, -uTime * 0.05, 0.0))) * uK; gl_FragColor = vec4(vec3(1.0, 0.86, 0.66) * a, 0.0); }` });
  const bl = 20, beamG = new THREE.CylinderGeometry(0.35, bl * 0.4, bl, 40, 1, true).translate(0, -bl / 2, 0).rotateX(-Math.PI / 2); const beam = new THREE.Mesh(beamG, beamMat); beam.position.copy(from); beam.lookAt(aim); beam.renderOrder = 12; beam.name = 'flood-beam'; lamps.add(beam);

  // ---- survey grid (layer "grid") ----
  const S = env.world.SITE, gridMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uSize: { value: new THREE.Vector2(S.w, S.h) }, uOpacity: { value: 0 } }, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: 'varying vec2 vP; uniform vec2 uSize; void main() { vP = uv * uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vP; uniform vec2 uSize; uniform float uOpacity;
      float line(vec2 p, float step, float w) { vec2 g = abs(fract(p / step - 0.5) - 0.5) * step; vec2 fw = fwidth(p) * w; vec2 l = 1.0 - smoothstep(vec2(0.0), fw, g); return max(l.x, l.y); }
      void main() { float fine = line(vP, 2.0, 1.0) * (1.0 - smoothstep(0.02, 0.09, max(fwidth(vP.x), fwidth(vP.y)))); float major = line(vP, 10.0, 1.4); vec2 e = min(vP, uSize - vP); float border = 1.0 - smoothstep(0.0, max(fwidth(vP.x), fwidth(vP.y)) * 2.2, min(e.x, e.y));
        float a = max(max(fine * 0.14, major * 0.34), border * 0.75) * uOpacity; if (a < 0.004) discard; gl_FragColor = vec4(vec3(0.5, 0.62, 0.8), a); }` });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(S.w, S.h).rotateX(-Math.PI / 2), gridMat); grid.position.set(S.w / 2, 0.035, -S.h / 2); grid.visible = false; grid.renderOrder = 4; grid.name = 'grid'; group.add(grid); let gridOn = false;

  function apply() {
    sun.color.copy(cur.sun); sun.intensity = cur.sunI; hemi.color.copy(cur.sky); hemi.groundColor.copy(cur.earth); hemi.intensity = cur.hemi * 2.2; scene.environmentIntensity = cur.env; renderer.toneMappingExposure = cur.exp;
    skyMat.uniforms.uWarmI.value = cur.warmI; skyMat.uniforms.uStars.value = cur.stars; skyMat.uniforms.uPicK.value = env.photos['sky-dawn'] ? cur.pic : 0; fog.a = cur.fogA; fog.h = cur.fogH; fog.b = cur.fogB; fog.base = cur.fogBase;
    flood.intensity = cur.lamps * 420; bulb.intensity = cur.lamps * 26; lampMat.color.setRGB(5, 4.3, 3.3).multiplyScalar(0.05 + cur.lamps); beamMat.uniforms.uK.value = cur.lamps * 0.2; beam.visible = cur.lamps > 0.01;
  }
  function setLight(m, { instant = false } = {}) { if (!LIGHTS[m]) return false; mode = m; target = LIGHTS[m]; tk = instant ? 1 : 0; if (instant) { step(1); bakeEnv(); } light.mode = m; return true; }
  function step(k) { for (const [key, v] of Object.entries(target)) { if (v.isVector3) cur[key].lerp(v, k).normalize(); else if (v.isColor) cur[key].lerp(v, k); else cur[key] += (v - cur[key]) * k; } apply(); }
  const light = { mode, get sunDir() { return cur.sunDir; }, get sunColor() { return cur.sun; }, get sunIntensity() { return cur.sunI; }, get lamps() { return cur.lamps; }, sun, hemi, flood, bulb }; t.light = light;
  apply(); bakeEnv(); fitShadow(new THREE.Vector3(62, 0, -44), 90, 0.6);

  return {
    group, sun, hemi, light, fog, setLight, get mode() { return mode; }, heightAt: land.H.at, terrain: land, fitShadow,
    setGrid(on) { gridOn = !!on; if (on) grid.visible = true; },
    update(dt, time, camera, pose, animate) {
      sky.position.copy(camera.position);
      if (target) { tk += dt / 2.2; const done = tk >= 1; step(done ? 1 : 1 - Math.exp(-3.2 * dt)); envDirty += dt; if (done) { target = null; bakeEnv(); } else if (envDirty > 0.35) { envDirty = 0; bakeEnv(); } }
      if (animate) { skyMat.uniforms.uTime.value = time; beamMat.uniforms.uTime.value = time; }
      land.update(time, animate);
      const go = gridMat.uniforms.uOpacity; go.value += ((gridOn ? 1 : 0) - go.value) * Math.min(1, dt * 8); if (!gridOn && go.value < 0.01) grid.visible = false;
      if (pose) fitShadow(pose.target, pose.dist, pose.pitch);
    },
    dispose() { envRT && envRT.dispose(); pm.dispose(); scene.environment = null; scene.remove(group); },
  };
}
