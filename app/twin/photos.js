// Photographic ground materials. The three tiling illustrations in assets/img/gen (mud, rubble, concrete) become
// full materials here: colour, plus a normal map and a height field derived from brightness with a Sobel filter.
// Height sits in the alpha channel of the normal texture. If a picture is missing, a plain stand-in is used.
import * as THREE from 'three';

const DIR = new URL('../../assets/img/gen/', import.meta.url);
function image(name) { return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = new URL(name, DIR).href; }); }

function derive(px, N, strength) {
  const h = new Float32Array(N * N), b = new Float32Array(N * N);
  for (let i = 0, p = 0; i < h.length; i++, p += 4) h[i] = (px[p] * 0.3 + px[p + 1] * 0.59 + px[p + 2] * 0.11) / 255;
  // take out the broad light and dark patches so that only relief is left
  const R = 24; for (let pass = 0; pass < 2; pass++) { const s = pass ? b : h; const o = pass ? new Float32Array(N * N) : b; for (let y = 0; y < N; y++) { let sum = 0; const at = (k) => (pass ? s[((k + N) % N) * N + y] : s[y * N + ((k + N) % N)]); for (let k = -R; k <= R; k++) sum += at(k); for (let x = 0; x < N; x++) { if (pass) o[x * N + y] = sum / (2 * R + 1); else o[y * N + x] = sum / (2 * R + 1); sum += at(x + R + 1) - at(x - R); } } if (pass) b.set(o); }
  for (let i = 0; i < h.length; i++) h[i] = Math.min(1, Math.max(0, 0.5 + (h[i] - b[i]) * 2.4));
  const out = new Uint8Array(N * N * 4), at = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength;
    const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength;
    const l = 1 / Math.hypot(gx, gy, 1), i = (y * N + x) * 4;
    out[i] = (-gx * l * 0.5 + 0.5) * 255; out[i + 1] = (-gy * l * 0.5 + 0.5) * 255; out[i + 2] = (l * 0.5 + 0.5) * 255; out[i + 3] = h[y * N + x] * 255;
  }
  return out;
}

// [key, file, relief strength (0 = colour only), size]
const SET = [['mud', 'tex-mud', 1.1, 1], ['wet', 'twin/wet-mud', 1.3, 1], ['rubble', 'tex-rubble', 1.3, 1], ['concrete', 'twin/concrete-cracked', 0.7, 0.5], ['plaster', 'twin/plaster-wall', 0.8, 0.5], ['stone', 'twin/stone-wall', 1.1, 0.5], ['tin', 'twin/tin-roof', 0.8, 0.5], ['cliff', 'twin/rock-cliff', 0, 1], ['forest', 'twin/forest-slope', 0, 1]];
export async function loadPhotos(quality, aniso = 8) {
  const full = quality === 'high' ? 1024 : 512, out = {};
  const wrap = (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
  await Promise.all(SET.map(async ([k, file, strength, size]) => {
    const N = full * size, img = await image(file + '.jpg'), c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d', { willReadFrequently: true });
    if (img) x.drawImage(img, 0, 0, N, N); else { x.fillStyle = '#5a5148'; x.fillRect(0, 0, N, N); }
    const px = x.getImageData(0, 0, N, N).data; let r = 0, g = 0, b = 0; for (let i = 0; i < px.length; i += 64) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
    const m = px.length / 64, avg = new THREE.Color(r / m / 255, g / m / 255, b / m / 255).convertSRGBToLinear();
    const map = new THREE.CanvasTexture(c); map.flipY = false; map.colorSpace = THREE.SRGBColorSpace; wrap(map);
    out[k] = { map, avg, normalMap: strength ? wrap(new THREE.DataTexture(derive(px, N, strength * 2.2), N, N, THREE.RGBAFormat)) : null };
  }));
  // the two sky pictures, and the far ridge cut out of its own sky
  await Promise.all(['sky-dawn', 'sky-night'].map(async (k) => { const img = await image('twin/' + k + '.jpg'); if (!img) { out[k] = null; return; } const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; out[k] = { map: t }; }));
  out.ridge = await (async () => {
    const img = await image('twin/ridge-strip.jpg'); if (!img) return null;
    const W = 2048, Hh = 682, c = document.createElement('canvas'); c.width = W; c.height = Hh; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, W, Hh); const d = x.getImageData(0, 0, W, Hh), p = d.data, top = new Float32Array(W);
    let s0 = 0; for (let i = 0; i < W; i++) s0 += p[i * 4 + 4 * W * 4] + p[i * 4 + 4 * W * 4 + 2] * 0; s0 /= W;
    for (let i = 0; i < W; i++) { let y = 6, run = 0; for (; y < Hh - 1; y++) { const a = (y * W + i) * 4, bb = ((y - 3) * W + i) * 4, dl = Math.abs(p[a] - p[bb]) + Math.abs(p[a] - s0) * 0.55; run = dl > 16 ? run + 1 : 0; if (run > 2) break; } top[i] = y - 3; }
    for (let i = 0; i < W; i++) { const win = []; for (let k = -2; k <= 2; k++) win.push(top[(i + k + W) % W]); win.sort((a, b2) => a - b2); const tp = win[2]; for (let y = 0; y < Hh; y++) p[(y * W + i) * 4 + 3] = Math.max(0, Math.min(1, (y - tp) / 2)) * 255; }
    x.putImageData(d, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; t.premultiplyAlpha = false; return { map: t };
  })();
  out.dispose = () => { for (const v of Object.values(out)) { if (!v || typeof v === 'function') continue; v.map?.dispose(); v.normalMap?.dispose(); } };
  return out;
}

// Lay a photograph over a material from the three world axes: colour as a multiple of its own average (so the
// material keeps its tint) and relief as a normal. Survives clone(); o.extra is spliced in after the colour.
export function photoTri(mat, P, o = {}) {
  const { scale = 2.5, k = 0.85, bump = 0.8, key = 'p' } = o;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tPh = { value: P.map }; sh.uniforms.tPhN = { value: P.normalMap }; sh.uniforms.uPhA = { value: P.avg };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPW; varying vec3 vPN;').replace('#include <project_vertex>', '#include <project_vertex>\n { vec4 q = vec4(transformed, 1.0); vec3 nq = objectNormal;\n#ifdef USE_INSTANCING\n q = instanceMatrix * q; nq = mat3(instanceMatrix) * nq;\n#endif\n vPW = (modelMatrix * q).xyz; vPN = mat3(modelMatrix) * nq; }');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPW; varying vec3 vPN; uniform sampler2D tPh, tPhN; uniform vec3 uPhA;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n vec3 pN = normalize(vPN), pA = abs(pN); vec2 pUV = pA.y > max(pA.x, pA.z) ? vPW.xz : pA.x > pA.z ? vec2(vPW.z, -vPW.y) : vec2(vPW.x, -vPW.y); pUV /= ' + scale.toFixed(3) + '; vec3 pC = texture2D(tPh, pUV).rgb / uPhA * mix(0.85, 1.15, texture2D(tPh, pUV * 0.137 + 0.3).g / uPhA.g * 0.5); pC = mix(vec3(dot(pC, vec3(0.3, 0.59, 0.11))), pC, ' + (o.sat ?? 1).toFixed(2) + '); diffuseColor.rgb *= mix(vec3(1.0), pC, ' + k.toFixed(3) + ');' + (o.extra || ''))
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n { vec2 pb = (texture2D(tPhN, pUV).rg * 2.0 - 1.0) * ' + bump.toFixed(3) + ' * smoothstep(70.0, 12.0, length(vPW - cameraPosition)); vec3 pw = pA.y > max(pA.x, pA.z) ? vec3(pb.x, 0.0, pb.y) : pA.x > pA.z ? vec3(0.0, -pb.y, pb.x) : vec3(pb.x, -pb.y, 0.0); normal = normalize(normal + (viewMatrix * vec4(pw, 0.0)).xyz * faceDirection); }');
  };
  if (o.rough || o.wet) { const base = mat.onBeforeCompile; mat.onBeforeCompile = (sh) => { base(sh); if (o.rough) sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + o.rough); if (o.wet) sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n gl_FragColor.a = 1.0 - ' + o.wet + ';'); }; }
  mat.customProgramCacheKey = () => 'ph-' + key;
  mat.clone = function () { const c = new this.constructor().copy(this); return photoTri(c, P, o); };
  return mat;
}
