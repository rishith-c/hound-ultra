// The studio: lights, wet floor with a real planar reflection, environment, adaptive resolution.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { canvas, texture, rng } from './materials.js';

const HORIZON = new THREE.Color(0x0b0e12), DEEP = new THREE.Color(0x030405);

// hand-made studio for image-based light: one long key strip, a soft side box, a cool rim strip, a dim ceiling
function environment(renderer) {
  const s = new THREE.Scene(), add = (w, h, pos, look, col, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(...pos); m.lookAt(...look); s.add(m); };
  s.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ color: 0x07090b, side: THREE.BackSide })));
  add(9, .55, [0, 5, -1.2], [0, 0, 0], 0xfff3e4, 26); add(2.6, 3.4, [4.5, 2.2, 4.5], [0, .3, 0], 0xfff0e0, 2.6); add(.5, 5, [-5, 2, -3.2], [0, .4, 0], 0xbfd6ff, 11);
  add(5, .35, [1, 1.1, -6], [0, .4, 0], 0xcfe0ff, 5); add(8, 8, [0, 7, 0], [0, 0, 0], 0x9fb0c4, .22); add(.3, 4, [5.5, 2, -2], [0, .4, 0], 0xffffff, 6); add(8, .22, [7, 1.05, 1.5], [0, .1, 0], 0xfff6ea, 9); add(8, .22, [1, 1.05, 7], [0, .1, 0], 0xfff6ea, 9);
  const g = new THREE.PMREMGenerator(renderer), rt = g.fromScene(s, .015); g.dispose(); s.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); return rt.texture;
}
function wetTexture() { // red, green: ripple slope; blue: how wet (puddles)
  const N = 512, r = rng(19), oct = []; for (let o = 0; o < 5; o++) { const n = 4 << o; oct.push([n, Float32Array.from({ length: n * n }, () => r())]); }
  const val = (x, y, from) => { let v = 0, a = .5; for (let o = from; o < 5; o++) { const [n, d] = oct[o], fx = x / N * n, fy = y / N * n, x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0, u = tx * tx * (3 - 2 * tx), w = ty * ty * (3 - 2 * ty), g = (i, j) => d[((j + n) % n) * n + (i + n) % n]; v += a * ((g(x0, y0) * (1 - u) + g(x0 + 1, y0) * u) * (1 - w) + (g(x0, y0 + 1) * (1 - u) + g(x0 + 1, y0 + 1) * u) * w); a *= .5; } return v; };
  const c = canvas(N, N, (q) => { const im = q.createImageData(N, N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = (y * N + x) * 4, h = val(x, y, 2); im.data[i] = 128 + (val((x + 2) % N, y, 2) - h) * 900; im.data[i + 1] = 128 + (val(x, (y + 2) % N, 2) - h) * 900; im.data[i + 2] = val(x, y, 0) * 255; im.data[i + 3] = 255; } q.putImageData(im, 0, 0); });
  return texture(c, { repeat: 1 });
}

export function createStudio(host, { reduced = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.setClearColor(DEEP, 1);
  host.append(renderer.domElement); renderer.domElement.className = 'rover-canvas'; renderer.domElement.setAttribute('aria-hidden', 'true');
  RectAreaLightUniformsLib.init();
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(26, 1.8, .02, 40);
  scene.environment = environment(renderer); scene.environmentIntensity = .78;

  // backdrop: a dark cyclorama with one breath of light behind the machine
  const dome = new THREE.Mesh(new THREE.SphereGeometry(18, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { h: { value: HORIZON }, d: { value: DEEP } }, vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }', fragmentShader: 'varying vec3 vP; uniform vec3 h, d; float n(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); } void main(){ float e = max(vP.y, 0.); vec3 c = mix(h * .8, d, smoothstep(0., .5, e)); float g = smoothstep(0., .16, vP.y) * exp(-pow((vP.y - .10) * 4.2, 2.)) * exp(-pow(length(vP.xz - normalize(vec2(-1., -.35))) * 1.35, 2.)); c += vec3(.0105, .0125, .0155) * g; gl_FragColor = vec4(c + (n(gl_FragCoord.xy) - .5) / 340., 1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}' }));
  dome.renderOrder = -10; scene.add(dome);

  // the key strip, as a light and as a thing the floor can see
  const strip = new THREE.RectAreaLight(0xfff1e0, 17, 1.7, .10), stripMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, .06), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff1e0).multiplyScalar(7), side: THREE.DoubleSide })); stripMesh.layers.set(1); scene.add(strip, stripMesh);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.4), new THREE.MeshBasicMaterial({ map: texture(canvas(128, 128, (c) => { const g = c.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, '#fff'); g.addColorStop(.35, '#777'); g.addColorStop(1, '#000'); c.fillStyle = g; c.fillRect(0, 0, 128, 128); })), color: new THREE.Color(0xb8c8de).multiplyScalar(.24), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide })); back.position.set(-4.6, 1.2, -.4); back.rotation.y = Math.PI / 2 + .12; back.layers.set(1); scene.add(back);
  const key = new THREE.SpotLight(0xffeedd, 13, 8, .42, .9, 2); key.position.set(1.0, 2.3, 1.5); key.target.position.set(0, .1, 0); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -.00012; key.shadow.normalBias = .0016; key.shadow.radius = 5; key.shadow.camera.near = .8; key.shadow.camera.far = 5; scene.add(key, key.target);
  const rim = new THREE.SpotLight(0xbcd4ff, 30, 8, .5, 1, 2); rim.position.set(-1.9, 1.35, -1.5); rim.target.position.set(0, .18, 0); scene.add(rim, rim.target);
  const kick = new THREE.SpotLight(0xd8e4ff, 5, 6, .6, 1, 2); kick.position.set(-.4, .5, 2.2); kick.target.position.set(0, .15, 0); scene.add(kick, kick.target);

  // floor
  const reflCam = new THREE.PerspectiveCamera(), texMat = new THREE.Matrix4(); reflCam.layers.enable(1);
  const rt = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, samples: 2, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const floorU = { tR: { value: rt.texture }, tW: { value: wetTexture() }, uM: { value: texMat }, uH: { value: HORIZON }, uWheel: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) }, uBody: { value: new THREE.Vector4(0, 0, 0, 0) }, uOff: { value: new THREE.Vector2() }, uPool: { value: new THREE.Vector3(0, 0, 1) }, uRefl: { value: 1 } };
  const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 96).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: floorU,
    vertexShader: 'varying vec3 vW; varying vec4 vR; uniform mat4 uM; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vR = uM * w; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec3 vW; varying vec4 vR; uniform sampler2D tR, tW; uniform vec3 uH, uPool; uniform vec4 uWheel[4], uBody; uniform vec2 uOff; uniform float uRefl;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 p = vW.xz + uOff; vec3 V = normalize(cameraPosition - vW); float dist = length(cameraPosition - vW);
      vec3 w1 = texture2D(tW, p * .55).xyz, w2 = texture2D(tW, p * 2.3 + .37).xyz, w3 = texture2D(tW, p * 9.1).xyz;
      float wet = smoothstep(.36, .60, w1.z * .7 + w2.z * .3);
      vec2 slope = ((w1.xy + w2.xy) - 1.) * .5 * mix(1., .25, wet) + (w3.xy - .5) * mix(.55, .05, wet);
      float rough = mix(.34, .07, wet);
      vec2 uv = vR.xy / vR.w; float near = smoothstep(0., .9, abs(dist) * .3);
      vec2 off = slope * .050 * vec2(1., 1.6);
      float lod = rough * 7.2; vec3 R = vec3(0.); float a0 = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715)))) * 6.2831, sp = rough * .030;
      for (int i = 0; i < 6; i++) { float a = a0 + float(i) * 2.3999, r = sqrt((float(i) + .5) / 6.); vec3 s = 1.35 * textureLod(tR, uv + off + vec2(cos(a), sin(a) * 1.7) * r * sp, lod * .62 + .6).rgb; R += s / (1. + max(s.r, max(s.g, s.b))); }
      R /= 6.; R /= 1. - min(max(R.r, max(R.g, R.b)), .62);
      float F = .035 + .965 * pow(1. - max(V.y, 0.), 5.); F = F * mix(.62, 1., wet) + mix(.03, .10, wet);
      float ao = 1.; for (int i = 0; i < 4; i++) { vec2 d = (vW.xz - uWheel[i].xy) / vec2(.048, .030); ao *= 1. - .93 * exp(-dot(d, d)) * exp(-uWheel[i].z * 26.); }
      vec2 q = abs(vW.xz - uBody.xy) - vec2(.15, .16); float sd = length(max(q, 0.)) + min(max(q.x, q.y), 0.); ao *= 1. - .62 * exp(-max(sd + .06, 0.) * 11.) * exp(-uBody.z * 7.);
      float pool = exp(-dot(vW.xz - uPool.xy, vW.xz - uPool.xy) * .9) * uPool.z;
      vec3 base = vec3(.0085, .0092, .0102) * (.45 + .9 * w2.z) * mix(1., .55, wet) * (.35 + 2.2 * pool);
      vec3 c = base * ao + R * F * uRefl * mix(.55, 1., ao);
      c = mix(c, uH * .8, smoothstep(2.2, 8.5, length(vW.xz)));
      gl_FragColor = vec4(c + (hash(gl_FragCoord.xy + 3.) - .5) / 420., 1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` }));
  scene.add(floor);

  const up = new THREE.Vector3(0, 1, 0), clip = new THREE.Vector4(), plane = new THREE.Plane(), q4 = new THREE.Vector4(), pos = new THREE.Vector3(), dir = new THREE.Vector3();
  function reflect() {
    camera.updateMatrixWorld(); pos.setFromMatrixPosition(camera.matrixWorld); camera.getWorldDirection(dir);
    reflCam.position.set(pos.x, -pos.y, pos.z); reflCam.up.set(0, -1, 0); reflCam.up.copy(up).applyQuaternion(camera.quaternion); reflCam.up.y *= -1; dir.y *= -1; reflCam.lookAt(reflCam.position.x + dir.x, reflCam.position.y + dir.y, reflCam.position.z + dir.z);
    reflCam.projectionMatrix.copy(camera.projectionMatrix); reflCam.projectionMatrix.elements[8] *= -1; reflCam.updateMatrixWorld(); // the mirrored view is flipped left to right, so is its lens shift
    texMat.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1).multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
    plane.set(up, 0).applyMatrix4(reflCam.matrixWorldInverse); clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const P = reflCam.projectionMatrix, e = P.elements; q4.x = (Math.sign(clip.x) + e[8]) / e[0]; q4.y = (Math.sign(clip.y) + e[9]) / e[5]; q4.z = -1; q4.w = (1 + e[10]) / e[14]; clip.multiplyScalar(2 / clip.dot(q4)); e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1; e[14] = clip.w;
    floor.visible = false; const au = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false; renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, reflCam); renderer.setRenderTarget(null); renderer.shadowMap.autoUpdate = au; floor.visible = true;
  }
  // the photograph as a studio plate: drawn over the finished frame, standing in an empty copy of the same studio
  const emptyRT = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType }), plateU = { tE: { value: emptyRT.texture }, tP: { value: null }, uSize: { value: new THREE.Vector2(1, 1) }, uRect: { value: new THREE.Vector4() }, uFront: { value: 0 }, uSoft: { value: 1 }, uSide: { value: 1 }, uLight: { value: 0 } };
  const plateScene = new THREE.Scene(), plateCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), plateMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false, uniforms: plateU,
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `varying vec2 vU; uniform sampler2D tE, tP; uniform vec2 uSize; uniform vec4 uRect; uniform float uFront, uSoft, uSide, uLight;
    void main(){
      vec2 px = vec2(vU.x, 1. - vU.y) * uSize, q = (px - uRect.xy) / uRect.zw;
      gl_FragColor = vec4(texture2D(tE, vU).rgb, 1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      vec4 P = texture2D(tP, vec2(q.x, 1. - q.y)) * step(0., q.x) * step(q.x, 1.) * step(0., q.y) * step(q.y, 1.); // the plate is already in display colour
      vec3 c = mix(gl_FragColor.rgb, P.rgb, P.a);
      float d = px.x - uFront + (px.y - uSize.y * .5) * .10 * uLight, g = exp(-d * d / 9000.) * uLight;
      c += c * vec3(1.05, .96, .84) * g * .75;
      gl_FragColor = vec4(c, smoothstep(-uSoft, uSoft, -uSide * d));
    }` })); plateScene.add(plateMesh); plateMesh.frustumCulled = false;
  const plate = { on: false, dirty: true, u: plateU, hide: null };
  function emptyStudio() { // once per size: the same camera and light, nobody on the floor
    plate.dirty = false; const s = [...floorU.uWheel.value.map((v) => v.z), floorU.uBody.value.z]; floorU.uWheel.value.forEach((v) => { v.z = 9; }); floorU.uBody.value.z = 9; plate.hide.visible = false;
    reflect(); renderer.setRenderTarget(emptyRT); renderer.clear(); renderer.render(scene, camera); renderer.setRenderTarget(null); plate.hide.visible = true; floorU.uWheel.value.forEach((v, i) => { v.z = s[i]; }); floorU.uBody.value.z = s[4];
  }
  // resolution follows the frame rate
  const maxR = Math.min(2, Math.max(1.25, window.devicePixelRatio || 1)); let ratio = Math.min(maxR, 1.5), w = 1, h = 1, acc = 0, n = 0, hold = 0;
  function size() { renderer.setPixelRatio(ratio); renderer.setSize(w, h, false); rt.setSize(Math.max(8, w * ratio * .5 | 0), Math.max(8, h * ratio * .5 | 0)); emptyRT.setSize(Math.max(8, w * ratio | 0), Math.max(8, h * ratio | 0)); plate.dirty = true; plateU.uSize.value.set(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  function resize() { const b = host.getBoundingClientRect(); if (b.width < 2 || b.height < 2) return false; if (w === Math.round(b.width) && h === Math.round(b.height)) return false; w = Math.round(b.width); h = Math.round(b.height); size(); return true; }
  function adapt(dt) { acc += dt; n++; if (n < 45) return; const ms = acc / n * 1000; acc = 0; n = 0; if (hold-- > 0) return; if (ms > 19 && ratio > .75) { ratio = Math.max(.75, ratio * .86); size(); hold = 1; } else if (ms < 16.9 && ratio < maxR && hold < -6) { ratio = Math.min(maxR, ratio * 1.08); size(); hold = 2; } }
  const stripAt = (x, y, z) => { strip.position.set(x, y, z); strip.lookAt(x * .35, 0, 0); stripMesh.position.copy(strip.position); stripMesh.lookAt(x * .35, 0, 0); };
  stripAt(0, 1.1, -.5);
  return { renderer, scene, camera, floorU, floor, strip, stripMesh, stripAt, key, rim, kick, plate, resize, adapt, get size() { return [w, h]; }, get ratio() { return ratio; },
    render() { if (plate.warm) { plate.warm = false; const f = plateU.uFront.value; plateU.uFront.value = -1e5; emptyStudio(); renderer.autoClear = false; renderer.render(plateScene, plateCam); renderer.autoClear = true; plateU.uFront.value = f; plate.dirty = true; } const p = plate.on && plateU.tP.value; if (p && plate.dirty) emptyStudio(); reflect(); renderer.render(scene, camera); if (p) { renderer.autoClear = false; renderer.render(plateScene, plateCam); renderer.autoClear = true; } },
    dispose() { rt.dispose(); emptyRT.dispose(); renderer.dispose(); renderer.domElement.remove(); } };
}
