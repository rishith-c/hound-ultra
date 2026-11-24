// The drone's lidar point cloud, the opening shot of the product. A simulated survey: the drone is a concept.
// The points are measured on the real meshes of the scene. Once, at start, the static world is drawn from straight
// above into a height image, and the four sides of each building into depth images; the cloud is read from those
// along across-track lidar lines, so every rock, tank, window bar and rubble slab has its returns.
// Later, when the scene's materials are ready, one more picture from above gives each return its strength.
//   reveal   each point knows how far along the survey flight the curtain crosses it (aS, metres). Drawing only needs
//            the drone's distance flown, so the cloud is right after any seek or reset.
//   settle   when state.map.ready the points sink onto the surfaces and fade over 3 s; nothing is left.
//   instance.show(true) forces the whole cloud visible (for a "show scan" control).
import { palette, damp, clamp, mulberry32, stateWatcher, disposeTree } from './common.js';

// The survey flight, as flown by droneSurvey() in app/core/sim.js: five rows, back and forth, from the pad.
const ROWS = [10, 30, 50, 70, 84], HALF = 11, X0 = 4;
const BAND = [20, 40, 60, 77];                          // where one row's points end and the next row's begin
// The same easing as the drone's drawn position, so the points and the curtain stay together.
const chase = (speed) => 10 + 1.2 * (speed || 1);

// ---------- what the lidar sees: heights of the real scene ----------
const GX0 = 0, GY0 = -3, GW = 120, GH = 100, PX = 10;    // the height image: 10 pixels a metre
const TOP = 26, RANGE = 28, LAYER = 17;
const surfaces = new WeakMap();
// Height of whatever is directly below the drone: { at(x, y) -> metres, texture, box: [x0, y0, w, h] }. For drone.js.
export const surfaceFor = (t) => surfaces.get(t) || null;

const PROBE_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  p = instanceMatrix * p;
  #endif
  p = modelMatrix * p; vW = p.xyz; gl_Position = projectionMatrix * viewMatrix * p;
}`;
const PROBE_FRAG = /* glsl */ `
varying vec3 vW;
void main() {
  float n = floor(gl_FragCoord.z * 65535.0 + 0.5);
  vec3 nn = normalize(cross(dFdx(vW), dFdy(vW)));
  gl_FragColor = vec4(floor(n / 256.0) / 255.0, mod(n, 256.0) / 255.0, abs(nn.y), 1.0);
}`;

// The static, opaque meshes of the world (the actors are created after this one and are never included).
function solidMeshes(scene) {
  const out = [], groups = ['environment', 'building-b', 'rubble', 'interior', 'massing', 'site', 'debris', 'terrain'];
  for (const c of scene.children) {
    if (!groups.includes(c.name)) continue;
    c.traverseVisible((o) => { const m = o.material; if (o.isMesh && o.name !== 'sky' && m && !Array.isArray(m) && !m.transparent && m.depthWrite !== false) out.push(o); });
  }
  return out;
}

function survey(t, meshes) {
  const { THREE, renderer, scene } = t;
  const probe = new THREE.ShaderMaterial({ vertexShader: PROBE_VERT, fragmentShader: PROBE_FRAG, side: THREE.DoubleSide, blending: THREE.NoBlending });
  const keep = { rt: renderer.getRenderTarget(), over: scene.overrideMaterial, sm: renderer.shadowMap.autoUpdate, col: renderer.getClearColor(new THREE.Color()).clone(), a: renderer.getClearAlpha() };
  const cam = new THREE.OrthographicCamera(); cam.layers.set(LAYER);
  for (const m of meshes) m.layers.enable(LAYER);
  const shot = (w, h) => {
    const rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
    const px = new Uint8Array(w * h * 4); renderer.readRenderTargetPixels(rt, 0, 0, w, h, px); rt.dispose();
    return px;
  };
  try {
    scene.overrideMaterial = probe; renderer.shadowMap.autoUpdate = false; renderer.setClearColor(0x000000, 0);
    cam.position.set(GX0 + GW / 2, TOP, -(GY0 + GH / 2)); cam.up.set(0, 0, -1); cam.lookAt(cam.position.x, 0, cam.position.z);
    cam.left = -GW / 2; cam.right = GW / 2; cam.top = GH / 2; cam.bottom = -GH / 2; cam.near = 0; cam.far = RANGE;
    const top = shot(GW * PX, GH * PX), sides = [];
    const blds = [{ r: t.world.BUILDING.rect, h: 4.3 }, ...t.world.OBSTACLES.filter((o) => o.kind === 'building').map((o) => ({ r: [Math.min(...o.poly.map((p) => p[0])), Math.min(...o.poly.map((p) => p[1])), Math.max(...o.poly.map((p) => p[0])), Math.max(...o.poly.map((p) => p[1]))], h: o.h + 1 }))];
    cam.up.set(0, 1, 0); cam.near = 0; cam.far = 2.6;
    for (const { r, h } of blds) for (let s = 0; s < 4; s++) {
      const ew = s > 1, len = (ew ? r[3] - r[1] : r[2] - r[0]) + 1, w = Math.round(len * 10), hh = Math.round(h * 20);
      const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, sg = s % 2 ? 1 : -1;                           // south, north, west, east
      const ex = ew ? (sg > 0 ? r[2] : r[0]) + sg * 1.3 : cx, ey = ew ? cy : (sg > 0 ? r[3] : r[1]) + sg * 1.3;
      cam.position.set(ex, h / 2, -ey); cam.lookAt(ew ? cx : ex, h / 2, -(ew ? ey : cy));
      cam.left = -len / 2; cam.right = len / 2; cam.top = h / 2; cam.bottom = -h / 2;
      sides.push({ px: shot(w, hh), w, h: hh, H: h, len, ew, sg, ex, ey });
    }
    return { top, sides };
  } finally {
    for (const m of meshes) m.layers.disable(LAYER);
    scene.overrideMaterial = keep.over; renderer.shadowMap.autoUpdate = keep.sm; renderer.setClearColor(keep.col, keep.a); renderer.setRenderTarget(keep.rt);
    probe.dispose();
  }
}

// A picture of the lit world from above: how strongly each return comes back.
function albedo(t, meshes) {
  const { THREE, renderer, scene } = t, w = GW * 5, h = GH * 5, lights = [];
  scene.traverse((o) => { if (o.isLight) { lights.push(o); o.layers.enable(LAYER); } });
  for (const m of meshes) m.layers.enable(LAYER);
  const cam = new THREE.OrthographicCamera(-GW / 2, GW / 2, GH / 2, -GH / 2, 0, RANGE); cam.layers.set(LAYER);
  cam.position.set(GX0 + GW / 2, TOP, -(GY0 + GH / 2)); cam.up.set(0, 0, -1); cam.lookAt(cam.position.x, 0, cam.position.z); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  const rt = new THREE.WebGLRenderTarget(w, h, { generateMipmaps: false }), prev = renderer.getRenderTarget(), sm = renderer.shadowMap.autoUpdate, px = new Uint8Array(w * h * 4);
  try { renderer.shadowMap.autoUpdate = false; renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam); renderer.readRenderTargetPixels(rt, 0, 0, w, h, px); }
  finally { renderer.shadowMap.autoUpdate = sm; renderer.setRenderTarget(prev); rt.dispose(); for (const o of lights) o.layers.disable(LAYER); for (const m of meshes) m.layers.disable(LAYER); }
  return { px, w, h };
}

// Metres flown when the curtain crosses x on row i.
function flight(pad, W) {
  const xEnd = W - X0, start = []; let s = Math.hypot(X0 - pad[0], ROWS[0] - pad[1]);
  for (let i = 0; i < ROWS.length; i++) { start.push(s); s += xEnd - X0 + (i + 1 < ROWS.length ? ROWS[i + 1] - ROWS[i] : 0); }
  return { xEnd, total: s, at(i, x) { return start[i] + (i % 2 ? xEnd - x : x - X0); } };
}
const rowOf = (y) => { let i = 0; while (i < BAND.length && y > BAND[i]) i++; return i; };

function generate(t, data, path) {
  const high = t.quality !== 'low', world = t.world, B = world.BUILDING.rect, rnd = mulberry32(world.SEED);
  const CAP = high ? 420000 : 90000, pos = new Float32Array(CAP * 3), aS = new Float32Array(CAP), aD = new Uint8Array(CAP * 4), src = new Uint32Array(CAP);
  let n = 0;
  // "shade" marks an even, sparse lattice of points; they come first in the buffer and carry the shade under the cloud
  const put = (x, h, y, s, strength, roof, pixel, shade) => {
    if (n >= CAP || x < X0 || x > path.xEnd || y < ROWS[0] - HALF || y > ROWS[4] + HALF) return;
    pos[n * 3] = x; pos[n * 3 + 1] = h; pos[n * 3 + 2] = -y; aS[n] = s;
    aD[n * 4] = clamp(strength, 0, 1) * 255; aD[n * 4 + 1] = rnd() * 255; aD[n * 4 + 2] = roof ? 255 : 0; aD[n * 4 + 3] = shade ? 255 : 0; src[n] = pixel; n++;
  };
  // Places that get twice the lines: the buildings and the rubble.
  const rich = [[B[0] - 2, B[1] - 3, B[2] + 3, B[3] + 3]];
  for (const o of world.OBSTACLES) if (o.kind !== 'furniture') rich.push([Math.min(...o.poly.map((p) => p[0])) - 1.5, Math.min(...o.poly.map((p) => p[1])) - 1.5, Math.max(...o.poly.map((p) => p[0])) + 1.5, Math.max(...o.poly.map((p) => p[1])) + 1.5]);
  const dense = (x, y) => { for (const r of rich) if (x > r[0] && x < r[2] && y > r[1] && y < r[3]) return true; return false; };

  const dx = high ? 0.15 : 0.36, dy = high ? 0.15 : 0.3, W = GW * PX;
  let line = 0;
  for (let lx = X0 + 0.05; lx < path.xEnd; lx += dx, line++) {
    const odd = line & 1, wob = rnd() * 6.28, tilt = (rnd() - 0.5) * 0.0016;                   // the airframe is never perfectly still
    let nth = 0;
    for (let y = ROWS[0] - HALF; y < ROWS[4] + HALF; y += dy * (0.82 + 0.36 * rnd())) {
      const mark = line % 4 === 0 && nth++ % 4 === 0;
      const d = dense(lx, y); if (odd && !d) continue;
      const i = rowOf(y), yy = y + (rnd() - 0.5) * 0.03, x = lx + (y - ROWS[i]) * tilt * 8 + Math.sin(y * 0.31 + wob) * 0.022 + (rnd() - 0.5) * 0.02;
      const pi = Math.floor((x - GX0) * PX), pj = Math.floor((yy - GY0) * PX); if (pi < 0 || pj < 0 || pi >= W || pj >= GH * PX) continue;
      const k = (pj * W + pi) * 4; if (!data.top[k + 3]) continue;
      if (!d && !mark && rnd() < 0.06) continue;                                                        // a few pulses never come back
      const h = TOP - ((data.top[k] * 256 + data.top[k + 1]) / 65535) * RANGE, up = data.top[k + 2] / 255;
      // rooftop edges: the sides of the stair heads, tanks and parapets
      if (d && h > 3.3) for (let e = 0; e < 2; e++) {
        const k2 = k + (e ? 4 : W * 4), h2 = data.top[k2 + 3] ? TOP - ((data.top[k2] * 256 + data.top[k2 + 1]) / 65535) * RANGE : h;
        if (Math.abs(h2 - h) < 0.35 || Math.min(h, h2) < 3.2) continue;
        for (let z = Math.min(h, h2) + 0.06; z < Math.max(h, h2); z += high ? 0.12 : 0.25) put(x + (e ? 0.06 : 0), z, yy + (e ? 0 : 0.06), path.at(i, x) + (Math.max(h, h2) - z) * 0.8, 0.46 + 0.18 * rnd(), x > B[0] - 0.6 && x < B[2] + 0.6 && yy > B[1] - 0.6 && yy < B[3] + 0.6, 0, false);
      }
      put(x, h + 0.03 + (rnd() - 0.5) * 0.022, yy, path.at(i, x), 0.42 + 0.16 * rnd() - 0.22 * (1 - up), h > 3.3 && x > B[0] - 0.6 && x < B[2] + 0.6 && yy > B[1] - 0.6 && yy < B[3] + 0.6, (Math.floor((yy - GY0) * 5) * GW * 5 + Math.floor((x - GX0) * 5)) + 1, mark);
    }
  }
  // the walls: vertical lines, each following the depth image of its side
  for (const f of data.sides) {
    const step = high ? 0.2 : 0.5, vs = high ? 0.105 : 0.22;
    let col = 0;
    for (let u = 0.03; u < f.len; u += step, col++) { let nth = 0; for (let v = 0.06 + rnd() * 0.05; v < f.H; v += vs * (0.85 + 0.3 * rnd())) {
      const mark = col % 3 === 0 && nth++ % 5 === 0;
      const uu = u + (rnd() - 0.5) * 0.025, pi = Math.min(f.w - 1, Math.max(0, Math.floor((uu / f.len) * f.w))), pj = Math.min(f.h - 1, Math.floor((v / f.H) * f.h)), k = (pj * f.w + pi) * 4;
      if (!f.px[k + 3] || f.px[k + 2] > 170) continue;                                         // ledges and floors already have their points
      const dep = ((f.px[k] * 256 + f.px[k + 1]) / 65535) * 2.6 - 0.03 + (rnd() - 0.5) * 0.02;
      // the picture's right-hand side, seen from outside: east for the south side, west for the north, south for the west, north for the east
      const off = uu - f.len / 2, x = f.ew ? f.ex - f.sg * dep : f.ex - f.sg * off, y = f.ew ? f.ey + f.sg * off : f.ey - f.sg * dep;
      if (y < ROWS[0] - HALF || y > ROWS[4] + HALF) continue;
      const i = rowOf(y);
      put(x, v, y, path.at(i, clamp(x, X0, path.xEnd)) + (f.H - v) * 0.8, 0.5 - 0.16 * clamp(dep - 1.3, 0, 1) + 0.18 * rnd(), false, 0, mark);
    } }
  }
  const P = new Float32Array(n * 3), S = new Float32Array(n), A = new Uint8Array(n * 4), Q = new Uint32Array(n), ord = new Uint32Array(n);
  let shades = 0, w = 0;
  for (let i = 0; i < n; i++) if (aD[i * 4 + 3]) ord[shades++] = i;
  w = shades; for (let i = 0; i < n; i++) if (!aD[i * 4 + 3]) ord[w++] = i;
  for (let i = 0; i < n; i++) { const o = ord[i]; P[i * 3] = pos[o * 3]; P[i * 3 + 1] = pos[o * 3 + 1]; P[i * 3 + 2] = pos[o * 3 + 2]; S[i] = aS[o]; Q[i] = src[o]; A[i * 4] = aD[o * 4]; A[i * 4 + 1] = aD[o * 4 + 1]; A[i * 4 + 2] = aD[o * 4 + 2]; }
  return { n, shades, pos: P, aS: S, aD: A, src: Q };
}

function makeSurface(THREE, top) {
  const f = 2, w = (GW * PX) / f, h = (GH * PX) / f, arr = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = (j * f * GW * PX + i * f) * 4; arr[j * w + i] = top && top[k + 3] ? Math.max(0, TOP - ((top[k] * 256 + top[k + 1]) / 65535) * RANGE) : 0; }
  const texture = new THREE.DataTexture(arr, w, h, THREE.RedFormat, THREE.FloatType); texture.needsUpdate = true;        // nearest filtering: float textures need no extension
  return { texture, box: [GX0, GY0, GW, GH], at(x, y) { const i = clamp(Math.floor(((x - GX0) / GW) * w), 0, w - 1), j = clamp(Math.floor(((y - GY0) / GH) * h), 0, h - 1); return arr[j * w + i]; } };
}

const VERT = /* glsl */ `
attribute float aS; attribute vec4 aD;
uniform float uHead, uFresh, uPx, uScale, uSettle, uShow, uDrop, uPlain, uSize, uOpacity, uShade;
uniform vec3 uScan;
varying vec4 vCol;
void main() {
  float age = uShow > 0.5 ? 1e4 : uHead - aS, r = aD.y;
  if (age < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec4(0.0); return; }
  float k = 1.0 - clamp(age / (uFresh * (0.55 + 0.75 * r)), 0.0, 1.0);          // 1 in the curtain, 0 once settled
  float s = clamp(uSettle * mix(1.5, 2.4, aD.z) - r * 0.5, 0.0, 1.0); s = s * s * (3.0 - 2.0 * s);
  vec3 p = position;
  if (uShade > 0.5) {                                                           // the shade under the cloud: the world steps back so the points can speak
    vec4 m = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = clamp(1.45 * uPx / -m.z, 6.0 * uScale, 64.0 * uScale);
    float ts = 1.0 - smoothstep(0.0, 1.0, uSettle * mix(1.0, 1.6, aD.z));
    vCol = vec4(0.012, 0.018, 0.026, 0.27 * ts * (1.0 - k));
    gl_Position = projectionMatrix * m;
    vec4 sq = projectionMatrix * vec4(m.xy, m.z + 0.25 + 0.002 * -m.z, 1.0); gl_Position.z = sq.z / sq.w * gl_Position.w; return;
  }
  float hh = p.y;
  p.y += uDrop * 0.6 * k * k * k - s * 0.1;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float raw = uSize * uPx / -mv.z, px = clamp(raw, 1.15 * uScale, 2.2 * uScale);
  gl_PointSize = px * mix(1.0, 1.0 - 0.4 * s, 1.0 - uPlain);
  // height: deep steel on the ground, cool at the eaves, pale and warm on top
  vec3 c = mix(vec3(0.13, 0.225, 0.335), vec3(0.20, 0.33, 0.44), smoothstep(0.02, 0.9, hh));
  c = mix(c, vec3(0.42, 0.59, 0.68), smoothstep(0.7, 3.6, hh));
  c = mix(c, vec3(0.84, 0.775, 0.68), smoothstep(3.7, 7.2, hh));
  c *= 0.3 + 1.5 * aD.x;
  c = mix(c, uScan * 1.15, k * k * 0.8);
  vCol = vec4(c, uOpacity * (1.0 - s) * clamp(raw / (1.15 * uScale), 0.35, 1.0));
  gl_Position = projectionMatrix * mv;
  float bias = 0.03 + 0.0012 * -mv.z;                                           // clear of the surface it lies on, at any range
  vec4 q = projectionMatrix * vec4(mv.xy, mv.z + bias, 1.0); gl_Position.z = q.z / q.w * gl_Position.w;
}`;
const FRAG = /* glsl */ `
uniform float uShade; varying vec4 vCol;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0, a = uShade > 0.5 ? (1.0 - d * d) * step(d, 1.0) : 1.0 - smoothstep(0.7, 1.05, d);
  if (a * vCol.a < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb, a * vCol.a);
  #include <colorspace_fragment>
}`;

export default {
  id: 'scan', layers: ['scan'],
  create(t) {
    const { THREE } = t, pal = palette(t), world = t.world, high = t.quality !== 'low';
    const path = flight(world.SITE.dronePad, world.SITE.w), meshes = solidMeshes(t.scene);
    let data = null;
    try { data = survey(t, meshes); } catch (e) { console.warn('[twin] scan: the scene could not be measured', e); }
    const surface = makeSurface(THREE, data && data.top); surfaces.set(t, surface);
    const cloud = data ? generate(t, data, path) : { n: 0, shades: 0, pos: new Float32Array(0), aS: new Float32Array(0), aD: new Uint8Array(0), src: new Uint32Array(0) };
    data = null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(cloud.pos, 3));
    geo.setAttribute('aS', new THREE.BufferAttribute(cloud.aS, 1));
    const dAttr = new THREE.BufferAttribute(cloud.aD, 4, true); geo.setAttribute('aD', dAttr);
    const U = { uHead: { value: -1 }, uFresh: { value: 4 }, uPx: { value: 1000 }, uScale: { value: 1 }, uSettle: { value: 0 }, uShow: { value: 0 }, uDrop: { value: 1 }, uPlain: { value: 0 }, uSize: { value: high ? 0.085 : 0.16 }, uOpacity: { value: 0.92 }, uShade: { value: 0 }, uScan: { value: pal.scan } };
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: U, vertexShader: VERT, fragmentShader: FRAG });
    const points = new THREE.Points(geo, mat); points.name = 'scan-cloud'; points.frustumCulled = false; points.visible = false; points.renderOrder = 3; points.raycast = () => {}; t.scene.add(points);
    const shadeGeo = new THREE.BufferGeometry(); for (const k of ['position', 'aS', 'aD']) shadeGeo.setAttribute(k, geo.attributes[k]); shadeGeo.setDrawRange(0, cloud.shades);
    const shade = new THREE.Points(shadeGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { ...U, uShade: { value: 1 } }, vertexShader: VERT, fragmentShader: FRAG }));
    shade.name = 'scan-shade'; shade.frustumCulled = false; shade.visible = false; shade.renderOrder = 2; shade.raycast = () => {}; t.scene.add(shade);

    // Return strength from the lit scene, once its materials exist. Needed only while there is a cloud to show.
    let frames = 0, src = high && cloud.n ? cloud.src : null;
    function strength() {
      try {
        const { px, w, h } = albedo(t, meshes), lum = new Float32Array(w * h); let m = 0, c = 0;
        for (let i = 0; i < lum.length; i++) { lum[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11; if (lum[i] > 0) { m += lum[i]; c++; } }
        m = m / Math.max(1, c) || 1;
        for (let i = 0; i < cloud.n; i++) { const q = src[i]; if (!q || q > lum.length) continue; aD(i, Math.pow(lum[q - 1] / m, 0.75)); }
        dAttr.needsUpdate = true;
      } catch (e) { console.warn('[twin] scan: return strength left uniform', e); }
      src = null;
    }
    function aD(i, k) { const a = cloud.aD; a[i * 4] = clamp(a[i * 4] * (0.3 + 0.7 * clamp(k, 0, 2.4)), 12, 255); }

    const watch = stateWatcher(); let head = -1, settle = 0, forced = false, layerOn = true;
    return {
      update(state, dt) {
        const fresh = watch(state), u = state.units['DRONE-01'], map = state.map;
        if (src && ++frames > 10 && !map.ready) strength();
        const scanning = u && u.mode === 'scan', goal = map.ready ? path.total + 100 : scanning ? u.odo : -1;
        if (fresh || (goal < 0) !== (head < 0)) head = goal; else head = damp(head, goal, chase(state.speed), dt);
        settle = fresh ? (map.ready ? 1 : 0) : map.ready ? Math.min(1, settle + dt / 3) : 0;
        points.visible = layerOn && (forced || (head > 0 && settle < 1));
        shade.visible = points.visible;
        if (!points.visible) return;
        const reduced = t.reduced;
        U.uHead.value = head; U.uFresh.value = damp(U.uFresh.value, clamp(4 * (state.speed || 1), 4, 34), fresh ? 1e3 : 6, dt);   // half a second of flight, in metres
        U.uSettle.value = forced ? 0 : settle; U.uShow.value = forced ? 1 : 0; U.uDrop.value = reduced ? 0 : 1; U.uPlain.value = reduced ? 1 : 0;
        const H = t.renderer.domElement.height; U.uPx.value = H * 0.5 * t.camera.projectionMatrix.elements[5]; U.uScale.value = H / 1000;
      },
      setLayer(id, on) { if (id === 'scan') { layerOn = !!on; if (!layerOn) points.visible = shade.visible = false; } },
      show(on) { forced = !!on; },
      onSelect() {},
      dispose() { surfaces.delete(t); surface.texture.dispose(); disposeTree(shade); disposeTree(points); },
    };
  },
};
