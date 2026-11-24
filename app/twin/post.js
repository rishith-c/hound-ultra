// The twin's image pipeline. One HDR scene render (multisampled), ambient occlusion computed from its depth,
// a restrained bloom that only reaches things brighter than the lit world (signals marked with t.glow), then one
// final pass: ACES tone mapping, a light grade, vignette and film grain.
import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const FinalShader = {
  uniforms: { tDiffuse: { value: null }, toneMappingExposure: { value: 1 }, uTime: { value: 0 }, uGrain: { value: 0.035 }, uVignette: { value: 0.32 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: /* glsl */ 'precision highp float; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; attribute vec3 position; attribute vec2 uv; varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette; uniform vec2 uRes;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec2 q = vUv - 0.5; q.x *= mix(1.0, uRes.x / uRes.y, 0.35);
      float vig = smoothstep(0.92, 0.28, length(q));
      c *= mix(1.0, vig, uVignette);
      c = ACESFilmicToneMapping(c);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.06);                                   // a touch of saturation back after ACES
      c += vec3(-0.006, 0.0, 0.012) * (1.0 - smoothstep(0.0, 0.5, l));   // cool shadows
      c = sRGBTransferOETF(vec4(max(c, 0.0), 1.0)).rgb;
      float g = hash(gl_FragCoord.xy + fract(uTime) * vec2(311.7, 173.3)) - 0.5;
      c += g * uGrain * (1.0 - 0.6 * l);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export function createPost(renderer, scene, camera, { quality = 'high' } = {}) {
  const high = quality === 'high';
  const size = new THREE.Vector2(2, 2);
  const depthTexture = new THREE.DepthTexture(2, 2); depthTexture.type = THREE.UnsignedIntType; depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
  const sceneRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: high ? 4 : 2, depthTexture });
  sceneRT.texture.name = 'twin.scene';
  const aoRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });

  let gtao = null;
  if (high) {
    gtao = new GTAOPass(scene, camera, 2, 2);
    // Use the main render's depth and rebuild normals from it, so the scene is not drawn a second time.
    gtao.normalRenderTarget.dispose(); gtao.normalRenderTarget = { depthTexture, texture: null, setSize() {}, dispose() {} };
    gtao.setGBuffer(depthTexture, undefined); gtao.gtaoMaterial.needsUpdate = true; gtao.pdMaterial.needsUpdate = true;
    gtao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.3, thickness: 1.2, distanceFallOff: 1, scale: 1.15, samples: 12, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    gtao.blendIntensity = 0.9;
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.55, 1.0);
  const final = new THREE.RawShaderMaterial({ uniforms: THREE.UniformsUtils.clone(FinalShader.uniforms), vertexShader: FinalShader.vertexShader, fragmentShader: FinalShader.fragmentShader, defines: { ACES_FILMIC_TONE_MAPPING: '' }, depthTest: false, depthWrite: false });
  const quad = new FullScreenQuad(final);
  let aoOn = high, grain = true;

  return {
    sceneRT, bloom, gtao,
    setSize(w, h, pr) {
      const W = Math.max(2, Math.round(w * pr)), H = Math.max(2, Math.round(h * pr));
      size.set(W, H); sceneRT.setSize(W, H); aoRT.setSize(W, H);
      const s = pr > 1.25 ? 0.5 : 1;                               // on dense screens ambient occlusion runs at half size
      gtao?.setSize(Math.round(W * s), Math.round(H * s));
      bloom.setSize(Math.round(W / 2), Math.round(H / 2));
      final.uniforms.uRes.value.set(W, H);
    },
    setAO(on) { aoOn = on && !!gtao; },
    setGrain(on) { grain = on; },
    render(time, target = null) {
      renderer.setRenderTarget(sceneRT); renderer.clear(); renderer.render(scene, camera);
      let src = sceneRT;
      if (aoOn) { gtao.render(renderer, aoRT, sceneRT); src = aoRT; }
      bloom.render(renderer, null, src, 0, false);
      final.uniforms.tDiffuse.value = src.texture; final.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
      final.uniforms.uTime.value = grain ? time : 0;
      renderer.setRenderTarget(target); quad.render(renderer);
    },
    dispose() { sceneRT.dispose(); aoRT.dispose(); depthTexture.dispose(); gtao?.dispose(); bloom.dispose(); final.dispose(); quad.dispose(); },
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
