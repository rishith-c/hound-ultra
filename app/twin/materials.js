// Shared physically based materials for the twin's static world.
import * as THREE from 'three';
import { photoTri } from './photos.js';

// Adds the close-up layer to a ground material: grit that tiles every 3 m over the painted site texture, and
// puddles (wherever the roughness map is near zero) that go flat and mirror the sky.
export function groundify(mat, detail) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tDetail = { value: detail.map };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tDetail;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float twinA = texture2D(tDetail, vNormalMapUv).g, twinB = texture2D(tDetail, vNormalMapUv * 0.137 + 0.31).g, twinC = texture2D(tDetail, vNormalMapUv * 0.023 + 0.7).g, twinD = texture2D(tDetail, vNormalMapUv * 3.7 + 0.13).g;
        diffuseColor.rgb *= (0.3 + 1.4 * twinA) * (0.72 + twinB * 0.56) * (0.86 + twinC * 0.28) * (0.75 + twinD * 0.5);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        float twinWet = smoothstep(0.55, 0.9, 1.0 - roughnessFactor + (twinB - 0.5) * 0.5 + (twinA - 0.5) * 0.12);
        roughnessFactor *= 0.62 + 0.76 * twinD;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.27, 0.3, 0.33), twinWet * 0.9);
        metalnessFactor = mix(metalnessFactor, 0.9, twinWet); roughnessFactor = mix(roughnessFactor, 0.03, twinWet);`)
      .replace('#include <normal_fragment_maps>', `vec3 twinN0 = normal;
        #include <normal_fragment_maps>
        normal = normalize(mix(normal, twinN0, twinWet));`);
  };
  mat.customProgramCacheKey = () => 'twin-ground';
  return mat;
}

export function createMaterials(tex, photos = null) {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const wo = tex.wall('outer'), wi = tex.wall('inner'), co = tex.concrete(), fl = tex.floor(), cg = tex.cgi(), wd = tex.wood(), fb = tex.fabric(), gd = tex.groundDetail();
  const ns = (v) => new THREE.Vector2(v, v);
  const m = {
    plaster: S({ map: wo.map, normalMap: wo.normalMap, normalScale: ns(0.9), roughness: 0.93 }),
    plasterA: S({ map: wo.map, normalMap: wo.normalMap, normalScale: ns(0.9), roughness: 0.93, color: 0xd9d4cc }),
    plasterC: S({ map: wo.map, normalMap: wo.normalMap, normalScale: ns(1.2), roughness: 0.95, color: 0xc2b9ad }),
    inner: S({ map: wi.map, normalMap: wi.normalMap, normalScale: ns(0.7), roughness: 0.9 }),
    cut: S({ color: 0x15181c, roughness: 0.85 }),                                   // the cut top of a wall when the roof is off
    concrete: S({ map: co.map, normalMap: co.normalMap, normalScale: ns(1), roughness: 0.92 }),
    concreteDark: S({ map: co.map, normalMap: co.normalMap, normalScale: ns(1), roughness: 0.95, color: 0x9a948a }),
    floor: S({ map: fl.map, normalMap: fl.normalMap, normalScale: ns(0.8), roughnessMap: fl.roughnessMap, roughness: 1 }),
    cgi: S({ map: cg.map, normalMap: cg.normalMap, normalScale: ns(0.5), roughnessMap: cg.roughnessMap, metalnessMap: cg.roughnessMap, roughness: 1, metalness: 1, envMapIntensity: 0.4, side: THREE.DoubleSide }),
    wood: S({ map: wd.map, normalMap: wd.normalMap, roughness: 0.85 }),
    fabric: S({ map: fb.map, normalMap: fb.normalMap, roughness: 0.82, side: THREE.DoubleSide }),
    steel: S({ color: 0x8d949b, roughness: 0.42, metalness: 0.85 }),
    darkMetal: S({ color: 0x23272c, roughness: 0.5, metalness: 0.7 }),
    rebar: S({ color: 0x6a4634, roughness: 0.75, metalness: 0.5 }),
    glass: S({ color: 0x0d1319, roughness: 0.06, metalness: 0.2, envMapIntensity: 1.6 }),
    rubber: S({ color: 0x16181b, roughness: 0.92 }),
    paint: S({ vertexColors: true, roughness: 0.72 }),                             // many colours, one draw call (see util.tint)
    plastic: S({ vertexColors: true, roughness: 0.42 }),
    metalPaint: S({ vertexColors: true, roughness: 0.5, metalness: 0.55 }),
    mud: S({ color: 0x565049, normalMap: gd.normalMap, normalScale: ns(1.4), roughness: 0.82 }),
    rock: S({ map: co.map, normalMap: co.normalMap, normalScale: ns(1.3), roughness: 0.95, color: 0x8f8a80, flatShading: false, vertexColors: false }),
    screen: S({ color: 0x05080b, emissive: 0x7fb6ff, emissiveIntensity: 0.9, roughness: 0.3 }),
  };
  if (photos) {                                                                  // photographed surfaces over the painted ones
    for (const k of ['plaster', 'plasterA', 'plasterC', 'inner']) photoTri(m[k], photos.plaster, { scale: 2.7, k: 0.78, bump: 0.8, sat: 0.12, key: 'plaster' });
    photoTri(m.concrete, photos.concrete, { scale: 3.1, k: 0.85, bump: 0.7, key: 'conc' });
    // flat roofs hold shallow rainwater: low, noisy patches go smooth and mirror the sky
    photoTri(m.concreteDark, photos.concrete, { scale: 4.3, k: 0.95, bump: 0.8, key: 'concw', extra: ' float rpN = sin(vPW.x * 0.31 + sin(vPW.z * 0.23) * 2.0) * sin(vPW.z * 0.37 + sin(vPW.x * 0.19) * 2.0) + (pC.g - 1.0) * 0.25; float rpW = smoothstep(0.3, 0.42, rpN) * step(0.9, pN.y) * smoothstep(55.0, 25.0, length(vPW - cameraPosition)); diffuseColor.rgb *= mix(1.0, 0.42, rpW);', rough: ' roughnessFactor = mix(roughnessFactor, 0.07, rpW);', wet: 'rpW' });
    photoTri(m.mud, photos.wet, { scale: 2.4, k: 0.9, bump: 1.1, key: 'mud' }); photoTri(m.rock, photos.rubble, { scale: 1.8, k: 0.7, bump: 0.9, key: 'rock' });
  }
  m.dispose = () => { for (const v of Object.values(m)) v?.dispose?.(); };
  return m;
}
