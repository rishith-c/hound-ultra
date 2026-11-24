// The twin's image pipeline. One multisampled HDR render of the scene; ambient occlusion from its depth; one
// "air" pass that lays in reflections on wet ground (the ground writes how mirror-wet it is into alpha) and the valley
// mist (analytic height fog, brighter towards the sun); bloom that only reaches signals and lamps; depth of field in
// the cinematic camera; then tone mapping, grade, vignette and grain.
import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const AIR = `
  varying vec2 vUv; uniform sampler2D tScene, tDepth, tAO; uniform mat4 uInvVP, uVP; uniform vec3 uCam, uFogCol, uFogSun, uSunDir; uniform vec4 uFog; uniform float uTime, uAO, uSSR; uniform vec2 uRes;
  float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float nn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  vec3 wpos(vec2 uv, float d) { vec4 p = uInvVP * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
  void main() {
    vec4 s = texture2D(tScene, vUv); float d = texture2D(tDepth, vUv).x; vec3 col = s.rgb; if (any(isnan(col))) col = vec3(0.0);
    if (d < 1.0) {
      vec3 P = wpos(vUv, d), toP = P - uCam; float dist = length(toP); vec3 V = toP / dist;
      float ao = texture2D(tAO, vUv).r; if (isnan(ao)) ao = 1.0; col *= mix(1.0, ao, uAO * smoothstep(320.0, 90.0, dist));
      float wet = clamp(1.0 - s.a, 0.0, 1.0);
      if (uSSR > 0.5 && wet > 0.03 && dist < 220.0) {
        vec2 rp = vec2(nn(P.xz * 3.0 + uTime * 0.35), nn(P.xz * 3.0 - uTime * 0.3 + 8.0)) - 0.5;
        vec3 N = normalize(vec3(rp.x * 0.025, 1.0, rp.y * 0.025)), R = reflect(V, N); float F = 0.05 + 0.95 * pow(1.0 - max(-dot(V, N), 0.0), 4.0);
        float t = 0.12 + ign(gl_FragCoord.xy) * 0.18, stepL = 0.22; vec3 hit = vec3(0.0); float ok = 0.0; float prev = 0.0;
        for (int i = 0; i < 26; i++) {
          vec3 q = P + R * t; vec4 c = uVP * vec4(q, 1.0); if (c.w <= 0.0) break; vec2 uv = c.xy / c.w * 0.5 + 0.5; if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
          float dz = texture2D(tDepth, uv).x; if (dz < 1.0) { float ds = length(wpos(uv, dz) - uCam), dq = length(q - uCam); if (dq > ds + 0.02 && dq - ds < stepL * 2.2 + 0.25) {
            float a = prev, b = t; for (int k = 0; k < 4; k++) { float m = (a + b) * 0.5; vec4 cm = uVP * vec4(P + R * m, 1.0); vec2 um = cm.xy / cm.w * 0.5 + 0.5; float dm = length(wpos(um, texture2D(tDepth, um).x) - uCam); if (length(P + R * m - uCam) > dm) b = m; else a = m; uv = um; }
            vec2 e = smoothstep(vec2(0.0), vec2(0.09), uv) * smoothstep(vec2(0.0), vec2(0.09), 1.0 - uv); hit = min(texture2D(tScene, uv).rgb, vec3(3.0)); ok = e.x * e.y; break; } }
          prev = t; t += stepL; stepL *= 1.16;
        }
        col = mix(col, hit, ok * wet * clamp(F * 1.35 + 0.08, 0.0, 0.92));
      }
      // mist: density falls off with height; integrate it along the ray
      float b = uFog.z, y0 = uCam.y - uFog.w, dy = V.y * dist; float k = abs(dy * b) > 0.001 ? (1.0 - exp(-dy * b)) / (dy * b) : 1.0;
      float patchy = 0.55 + 0.9 * nn(P.xz / 70.0 + uTime * 0.03) * nn(P.xz / 23.0 - uTime * 0.05 + 3.0) * 2.0;
      float od = (uFog.x + uFog.y * exp(-y0 * b) * k * patchy) * max(dist - 30.0, 0.0), f = 1.0 - exp(-od);
      float sd = max(dot(V, uSunDir), 0.0); vec3 fc = uFogCol + uFogSun * (pow(sd, 4.0) * 0.16 + pow(sd, 18.0) * 0.4) ; col = mix(col, fc, clamp(f, 0.0, 0.97));
    }
    if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
    gl_FragColor = vec4(clamp(col, 0.0, 40.0), 1.0);
  }`;
const DOF = `
  varying vec2 vUv; uniform sampler2D tColor, tDepth; uniform mat4 uInvVP; uniform vec3 uCam; uniform float uFocus, uRange, uMax; uniform vec2 uTexel;
  float coc(vec2 uv) { float d = texture2D(tDepth, uv).x; if (d >= 1.0) return 1.0; vec4 p = uInvVP * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0); float dist = length(p.xyz / p.w - uCam); float x = (dist - uFocus) / dist; return clamp(abs(x) * uRange - 0.25, 0.0, 1.0); }
  void main() { float c0 = coc(vUv); vec3 s = texture2D(tColor, vUv).rgb; float w = 1.0; float ga = 2.399963; for (int i = 1; i < 23; i++) { float r = sqrt(float(i) / 22.0), a = float(i) * ga; vec2 u = vUv + vec2(cos(a), sin(a)) * r * uMax * uTexel * max(c0, 0.25); float c = coc(u); float k = c * step(r * 0.9, c + c0) + 0.02; s += min(texture2D(tColor, u).rgb, vec3(4.0)) * k; w += k; } gl_FragColor = vec4(s / w, c0); }`;
const FINAL = `
  precision highp float;
  uniform sampler2D tDiffuse, tBlur; uniform float uTime, uGrain, uVignette, uDof; uniform vec2 uRes;
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  varying vec2 vUv;
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb; vec4 bl = texture2D(tBlur, vUv); c = mix(c, bl.rgb, smoothstep(0.04, 0.5, bl.a) * uDof);
    vec2 q = vUv - 0.5; q.x *= mix(1.0, uRes.x / uRes.y, 0.35); c *= mix(1.0, smoothstep(0.98, 0.25, length(q)), uVignette);
    c = ACESFilmicToneMapping(c); float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, 1.1); c += vec3(-0.010, 0.0, 0.016) * (1.0 - smoothstep(0.0, 0.45, l)) + vec3(0.012, 0.004, -0.010) * smoothstep(0.45, 0.95, l); c = (c - 0.5) * 1.04 + 0.5;
    c = sRGBTransferOETF(vec4(max(c, 0.0), 1.0)).rgb; c += (hash(gl_FragCoord.xy + fract(uTime) * vec2(311.7, 173.3)) - 0.5) * uGrain * (1.0 - 0.6 * l);
    gl_FragColor = vec4(c, 1.0);
  }`;

export function createPost(renderer, scene, camera, { quality = 'high' } = {}) {
  const high = quality === 'high', RT = (o) => new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false, ...o });
  const depthTexture = new THREE.DepthTexture(2, 2); depthTexture.type = THREE.UnsignedIntType; depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
  const sceneRT = RT({ samples: high ? 4 : 2, depthBuffer: true, depthTexture }), airRT = RT(), dofRT = RT();
  let gtao = null;
  if (high) {
    gtao = new GTAOPass(scene, camera, 2, 2);
    // Use the main render's depth and rebuild normals from it, so the scene is not drawn a second time.
    gtao.normalRenderTarget.dispose(); gtao.normalRenderTarget = { depthTexture, texture: null, setSize() {}, dispose() {} };
    gtao.setGBuffer(depthTexture, undefined); gtao.gtaoMaterial.needsUpdate = true; gtao.pdMaterial.needsUpdate = true; gtao.output = GTAOPass.OUTPUT.Off;
    gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.2, thickness: 1.4, distanceFallOff: 1, scale: 1.25, samples: 8, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
  }
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
  const M = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
  const vp = new THREE.Matrix4(), ivp = new THREE.Matrix4(), cam = new THREE.Vector3();
  const air = M(AIR, { tScene: { value: null }, tDepth: { value: depthTexture }, tAO: { value: white }, uInvVP: { value: ivp }, uVP: { value: vp }, uCam: { value: cam }, uFogCol: { value: new THREE.Color() }, uFogSun: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uFog: { value: new THREE.Vector4(0, 0, 0.03, 0) }, uTime: { value: 0 }, uAO: { value: 0.95 }, uSSR: { value: high ? 1 : 0 }, uRes: { value: new THREE.Vector2(1, 1) } });
  const dof = M(DOF, { tColor: { value: null }, tDepth: { value: depthTexture }, uInvVP: { value: ivp }, uCam: { value: cam }, uFocus: { value: 20 }, uRange: { value: 1.6 }, uMax: { value: 7 }, uTexel: { value: new THREE.Vector2(1, 1) } });
  const final = new THREE.RawShaderMaterial({ uniforms: { tDiffuse: { value: null }, tBlur: { value: null }, uDof: { value: 0 }, toneMappingExposure: { value: 1 }, uTime: { value: 0 }, uGrain: { value: 0.032 }, uVignette: { value: 0.42 }, uRes: { value: new THREE.Vector2(1, 1) } }, vertexShader: 'precision highp float; attribute vec3 position; attribute vec2 uv; varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: FINAL, depthTest: false, depthWrite: false });
  const quad = new FullScreenQuad(air), bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.6, 1.25); let aoOn = high, dofK = 0;
  return {
    sceneRT, bloom, gtao,
    setSize(w, h, pr) {
      const W = Math.max(2, Math.round(w * pr)), H = Math.max(2, Math.round(h * pr)), s = 0.5;
      sceneRT.setSize(W, H); airRT.setSize(W, H); dofRT.setSize(W >> 1, H >> 1); gtao && gtao.setSize(Math.round(W * s), Math.round(H * s)); bloom.setSize(W >> 1, H >> 1); final.uniforms.uRes.value.set(W, H); air.uniforms.uRes.value.set(W, H); dof.uniforms.uTexel.value.set(2 / W, 2 / H);
    },
    setAO(on) { aoOn = on && !!gtao; },
    setFog(f) { air.uniforms.uFogCol.value.copy(f.color); air.uniforms.uFogSun.value.copy(f.sun); air.uniforms.uSunDir.value.copy(f.dir); air.uniforms.uFog.value.set(f.a, f.h, f.b, f.base); },
    setFocus(dist, amount, dt = 0.016) { const k = 1 - Math.exp(-4 * dt); dof.uniforms.uFocus.value += (dist - dof.uniforms.uFocus.value) * k; dofK += (amount - dofK) * k; },
    render(time, target = null) {
      camera.updateMatrixWorld(); cam.copy(camera.position); vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); ivp.copy(vp).invert();
      renderer.setRenderTarget(sceneRT); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, camera);
      if (aoOn) gtao.render(renderer, airRT, sceneRT);
      air.uniforms.tScene.value = sceneRT.texture; air.uniforms.tAO.value = aoOn ? gtao.pdRenderTarget.texture : white; air.uniforms.uTime.value = time;
      quad.material = air; renderer.setRenderTarget(airRT); quad.render(renderer);
      const useDof = high && dofK > 0.02; if (useDof) { dof.uniforms.tColor.value = airRT.texture; quad.material = dof; renderer.setRenderTarget(dofRT); quad.render(renderer); }
      bloom.render(renderer, null, airRT, 0, false);
      const u = final.uniforms; u.tDiffuse.value = airRT.texture; u.tBlur.value = dofRT.texture; u.uDof.value = useDof ? dofK : 0; u.toneMappingExposure.value = renderer.toneMappingExposure; u.uTime.value = time;
      quad.material = final; renderer.setRenderTarget(target); quad.render(renderer);
    },
    dispose() { for (const r of [sceneRT, airRT, dofRT]) r.dispose(); depthTexture.dispose(); white.dispose(); gtao && gtao.dispose(); bloom.dispose(); air.dispose(); dof.dispose(); final.dispose(); quad.dispose(); },
  };
}

// Mark an object as a signal: its light goes above the lit world, so the bloom pass picks it up and nothing else.
// Works by scaling the material's output, so colours the owner animates later keep working.
export function makeGlow(object, strength = 1) {
  const k = 1 + 1.6 * strength;
  object.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) {
      if (m.userData.twinGlow) { m.userData.twinGlow.value = k; continue; }
      const u = { value: k }; m.userData.twinGlow = u;
      if (m.isShaderMaterial) { if (m.uniforms && m.uniforms.uGlow) m.uniforms.uGlow.value = k; continue; }   // custom shaders output their own HDR
      const basic = m.isSpriteMaterial || m.isPointsMaterial || m.isLineBasicMaterial || m.isLineDashedMaterial || m.isMeshBasicMaterial;
      if (!basic && !m.emissive) continue;
      const prev = m.onBeforeCompile, key = m.customProgramCacheKey;
      m.onBeforeCompile = (sh, r) => {
        prev?.call(m, sh, r); sh.uniforms.uTwinGlow = u;
        sh.fragmentShader = 'uniform float uTwinGlow;\n' + (basic
          ? sh.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n gl_FragColor.rgb *= uTwinGlow;')
          : sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= uTwinGlow;'));
      };
      m.customProgramCacheKey = () => (key ? key.call(m) : '') + '|glow' + (basic ? 'b' : 'e');
      m.needsUpdate = true;
    }
  });
  return object;
}
