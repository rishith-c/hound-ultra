// The globe: one WebGL canvas. Earth with a real sun direction, atmosphere, stars, plate boundaries and the
// earthquakes as shader-drawn points. The camera orbits a fixed Earth; north is up.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SITE, subsolar, magRadius } from './data.js';

const RAD = Math.PI / 180;
export function ll2v(lat, lon, r = 1, out = new THREE.Vector3()) {
  const c = Math.cos(lat * RAD);
  return out.set(c * Math.cos(lon * RAD) * r, Math.sin(lat * RAD) * r, -c * Math.sin(lon * RAD) * r);
}

const EARTH_VERT = `
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() {
  vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const EARTH_FRAG = `
uniform sampler2D tDay; uniform sampler2D tNight; uniform sampler2D tWater;
uniform vec3 uSun; uniform vec3 uAtmo;
uniform float uLights; uniform float uSunlit; uniform float uReady;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
  float ndl = dot(N, uSun), ndv = max(dot(N, V), 0.0);
  float dayF = smoothstep(-0.10, 0.22, ndl) * uSunlit;                 // soft terminator

  vec3 day = texture2D(tDay, vUv).rgb;
  float water = texture2D(tWater, vUv).r;
  float lum = dot(day, vec3(0.2126, 0.7152, 0.0722));
  vec3 calm = mix(vec3(lum), day, 0.58);                               // desaturated so the data stays the loudest thing
  calm = mix(calm, calm * vec3(0.62, 0.80, 1.0) + vec3(0.004, 0.010, 0.020), water * 0.55);

  // sunlit side: Lambert, plus a tight glint on open water
  vec3 lit = calm * (0.05 + 2.05 * max(ndl, 0.0)) + vec3(0.010, 0.022, 0.045) * water * max(ndl, 0.0);
  vec3 H = normalize(uSun + V);
  float nh = max(dot(N, H), 0.0);
  float glint = (pow(nh, 1400.0) * 0.55 + pow(nh, 260.0) * 0.05) * smoothstep(0.2, 0.7, ndv) * smoothstep(0.1, 0.7, ndl);   // a small, sharp sun glint
  lit += vec3(1.0, 0.95, 0.86) * glint * water * smoothstep(0.0, 0.2, ndl);

  // night side: a faint moonlit surface so coasts stay readable, and the city lights
  vec3 nt = texture2D(tNight, vUv).rgb;
  float warm = max(nt.r - nt.b * 0.82, 0.0);
  vec3 lights = vec3(1.0, 0.76, 0.46) * pow(warm, 0.72) * 2.4 * uLights;
  vec3 moon = mix(vec3(lum), day, 0.35) * vec3(0.50, 0.66, 1.0) * mix(0.16, 0.10, uSunlit) + vec3(0.002, 0.0035, 0.007);
  moon = mix(moon * 1.7 + vec3(0.0055, 0.008, 0.013), moon * 0.7 + vec3(0.0025, 0.0062, 0.014), water);
  vec3 night = moon + lights;

  vec3 col = mix(night, lit, dayF);
  col *= mix(0.42, 1.0, pow(ndv, 0.55));                               // limb darkening
  float rim = pow(1.0 - ndv, 3.4);
  float sunRim = mix(0.30, smoothstep(-0.25, 0.45, ndl), uSunlit);
  col += uAtmo * rim * (0.05 + 0.75 * sunRim);                          // air seen edge-on
  col = mix(vec3(0.012, 0.016, 0.024) + uAtmo * rim * 0.2, col, uReady);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const ATMO_FRAG = `
uniform vec3 uSun; uniform vec3 uAtmo; uniform float uSunlit;
varying vec3 vN; varying vec3 vW;
void main() {
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
  float x = clamp(-dot(N, V) / 0.365, 0.0, 1.0);                        // 1 at the Earth's limb, 0 at the shell's edge
  float glow = pow(x, 3.6) + 0.55 * pow(x, 11.0);
  float s = mix(0.32, smoothstep(-0.35, 0.40, dot(N, uSun)), uSunlit);
  gl_FragColor = vec4(uAtmo * glow * (0.06 + 0.95 * s), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const QUAKE_VERT = `
attribute vec3 aCol; attribute float aMag; attribute float aTime; attribute float aRnd; attribute float aId;
uniform float uT; uniform float uWin; uniform float uTau; uniform float uScale; uniform float uPx; uniform float uMinMag;
uniform float uSel; uniform float uHover; uniform float uWide; uniform float uClock; uniform float uPlaying; uniform float uStill;
varying vec3 vCol; varying float vAlpha; varying float vLimb; varying float vPhase; varying float vK; varying float vR;
varying float vSel; varying float vHov; varying float vFlash;
void main() {
  float age = uT - aTime;                                              // hours before the playhead
  float camD = length(cameraPosition);
  float facing = dot(normalize(position), cameraPosition / camD) - 1.0 / camD;   // > 0: this side of the horizon
  vLimb = smoothstep(0.0, 0.07, facing);
  float show = step(0.0, age) * step(uMinMag, aMag) * step(0.001, vLimb);
  float r = clamp(1.2 + 0.55 * pow(1.62, aMag), 1.8, 22.0) * uScale * uPx;       // same as magRadius() in data.js
  float aa = 1.2 / r;
  vSel = 1.0 - step(0.5, abs(aId - uSel));
  vHov = 1.0 - step(0.5, abs(aId - uHover));
  float recent = step(age, uWin);
  float K = mix(1.5 + aa, 4.2 + uWide * smoothstep(3.5, 6.0, aMag) * 7.0, recent);
  K = max(K, (1.0 + 7.0 * aa) * max(vSel, vHov));
  K = min(K, mix(250.0, 500.0, uWide) / r);
  vPhase = -1.0;
  if (recent > 0.5) vPhase = uStill > 0.5 ? 0.42 : (uPlaying > 0.5 ? clamp(age / uWin, 0.0, 1.0) : fract(uClock * 0.4 + aRnd));
  vFlash = recent * uPlaying * 1.1 * exp(-age / (uWin * 0.22));
  vAlpha = mix(0.46 + 0.50 * exp(-age / uTau), 1.0, recent);
  vCol = aCol; vK = K; vR = r;
  gl_PointSize = 2.0 * r * K;
  gl_Position = show > 0.5 ? projectionMatrix * modelViewMatrix * vec4(position, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;

const QUAKE_FRAG = `
varying vec3 vCol; varying float vAlpha; varying float vLimb; varying float vPhase; varying float vK; varying float vR;
varying float vSel; varying float vHov; varying float vFlash;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0 * vK;                    // 1.0 is the marker's edge
  float aa = 1.2 / vR;                                                 // about one pixel, in marker radii
  float core = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
  float rimW = max(2.2 * aa, 0.14);                                    // the rim is about 2 px wide
  float rim = smoothstep(1.0 - rimW - aa, 1.0 - rimW + aa, d);
  float fill = mix(0.34, 1.0, clamp(3.2 / vR, 0.0, 1.0));              // small markers are solid, large ones a ring with a wash
  vec3 col = vCol * (1.0 + vFlash);
  float a = core * mix(fill * vAlpha, min(1.0, vAlpha + 0.22), rim);
  float key = (1.0 - smoothstep(1.0 + aa, 1.0 + aa * 3.2, d)) * (1.0 - core) * 0.6 * vAlpha;   // dark keyline
  vec3 rgb = col * (a / (a + key + 1e-4));
  float alpha = a + key;
  if (vPhase >= 0.0) {                                                 // expanding ring for a recent event
    float rr = 1.0 + (vK - 1.35) * vPhase;
    float w = max(aa * 1.6, 0.09);
    float ring = (1.0 - smoothstep(0.0, w, abs(d - rr))) * pow(1.0 - vPhase, 1.5) * 0.85;
    rgb = mix(rgb, vCol * 1.1, ring / (alpha + ring + 1e-4));
    alpha = max(alpha, ring);
  }
  float mark = max(vSel, vHov * 0.75);
  if (mark > 0.0) {                                                    // white ring: selected or under the pointer
    float ring = (1.0 - smoothstep(aa * 0.9, aa * 1.9, abs(d - (1.0 + aa * 4.0)))) * mark;
    rgb = mix(rgb, vec3(1.0), ring);
    alpha = max(alpha, ring);
  }
  alpha *= vLimb;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(rgb, alpha);
  #include <colorspace_fragment>
}`;

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function createScene(host, { accent, backdrop, reduced, onFrame, onAfter, onInteract }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(new THREE.Color(backdrop), 1);
  const canvas = renderer.domElement; canvas.className = 'globe-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The Earth with this feed’s earthquakes. Drag to turn, scroll to zoom. The list beside it gives the same events as text.');
  host.append(canvas);

  const scene = new THREE.Scene();
  const FOV = 28;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enablePan: false, enableDamping: true, dampingFactor: 0.08, zoomSpeed: 0.7, autoRotateSpeed: 0.28, minPolarAngle: 0.12, maxPolarAngle: Math.PI - 0.12 });

  const atmo = new THREE.Color(accent).lerp(new THREE.Color('#ffffff'), 0.18);   // cool blue from --accent
  const U = { uSun: { value: new THREE.Vector3(1, 0, 0) }, uAtmo: { value: atmo }, uSunlit: { value: 1 } };

  // Earth
  const earthMat = new THREE.ShaderMaterial({ vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG,
    uniforms: { ...U, tDay: { value: null }, tNight: { value: null }, tWater: { value: null }, uLights: { value: 1 }, uReady: { value: 0 } } });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), earthMat));

  // Atmosphere: a thin back-side shell, brighter on the sunlit limb
  const atmoMesh = new THREE.Mesh(new THREE.SphereGeometry(1.075, 128, 64), new THREE.ShaderMaterial({ vertexShader: EARTH_VERT, fragmentShader: ATMO_FRAG,
    uniforms: U, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  scene.add(atmoMesh);

  // Stars: fixed pseudo-random field, the same every time
  {
    const rnd = mulberry(20261123), n = 2600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z), b = 0.10 + 0.55 * Math.pow(rnd(), 3.2), tint = rnd();
      pos.set([Math.cos(a) * s * 90, z * 90, Math.sin(a) * s * 90], i * 3);
      col.set([b * (0.86 + 0.14 * tint), b * 0.93, b * (1.0 - 0.10 * tint)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 1.6 * renderer.getPixelRatio(), sizeAttenuation: false, vertexColors: true, depthWrite: false, toneMapped: false, transparent: true });
    m.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));'); };          // round, with a soft edge
    const stars = new THREE.Points(g, m); stars.renderOrder = -1; scene.add(stars);
  }

  // Plate boundaries (filled in by setPlates)
  const plates = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: new THREE.Color('#dfe7f2'), transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }));
  plates.visible = false; scene.add(plates);

  // Great-circle arc from the selected earthquake to the exercise site
  const ARC_N = 96;
  const arc = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array((ARC_N + 1) * 3), 3)),
    new THREE.LineBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }));
  arc.visible = false; arc.frustumCulled = false; scene.add(arc);

  // Earthquakes
  const QU = { uT: { value: 0 }, uWin: { value: 3 }, uTau: { value: 17 }, uScale: { value: 1 }, uPx: { value: renderer.getPixelRatio() }, uMinMag: { value: -10 },
    uSel: { value: -1 }, uHover: { value: -1 }, uClock: { value: 0 }, uPlaying: { value: 0 }, uStill: { value: 0 }, uWide: { value: 0 } };
  const quakeMat = new THREE.ShaderMaterial({ vertexShader: QUAKE_VERT, fragmentShader: QUAKE_FRAG, uniforms: QU, transparent: true, depthTest: false, depthWrite: false });
  let points = null, quakes = [], tMin = 0;

  const site = ll2v(SITE.lat, SITE.lon);
  const frame = { cx: 0, cy: 0, size: 0 };
  let drift = null;
  let W = 0, H = 0, dFit = 6, zoom = 1, fly = null, running = false, raf = 0, last = 0, lastInteract = -1e9, hold = false, readyAt = 0;
  const tanHalf = Math.tan(FOV * RAD / 2);
  const tanA = (d) => 1 / Math.sqrt(Math.max(1e-6, d * d - 1));

  function applyView() {
    if (!W || !H) return;
    camera.aspect = W / H;
    if (frame.size > 0) {
      camera.setViewOffset(W, H, W / 2 - frame.cx, H / 2 - frame.cy, W, H);
      const t = (frame.size * 0.47) * tanHalf / (H / 2);                 // tangent of the globe's angular radius
      const fit = 1 / Math.sin(Math.atan(t));
      zoom = Math.min(1.35, Math.max(0.3, camera.position.length() / dFit));   // keep the user's zoom through a resize
      dFit = fit;
      camera.position.setLength(dFit * zoom);
      controls.minDistance = Math.min(1.5, dFit * 0.6); controls.maxDistance = dFit * 1.35;
    }
    camera.updateProjectionMatrix();
  }

  const ro = new ResizeObserver(() => {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width; H = r.height; renderer.setSize(W, H, false); applyView();
    if (!running) render(performance.now());
  });
  ro.observe(host);

  const touch = () => { lastInteract = performance.now(); fly = null; onInteract?.(); };
  controls.addEventListener('start', touch);
  controls.addEventListener('end', () => { lastInteract = performance.now(); });
  canvas.addEventListener('wheel', () => { lastInteract = performance.now(); }, { passive: true });

  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), tmp = new THREE.Vector3();
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

  function render(now) {
    const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
    onFrame?.(dt, now);
    if (fly) {
      const k = Math.min(1, (now - fly.t0) / fly.ms);
      qB.identity().slerp(qA.setFromUnitVectors(fly.from, fly.to), ease(k));
      camera.position.copy(tmp.copy(fly.from).applyQuaternion(qB).setLength(fly.dist));
      if (k >= 1) { fly = null; lastInteract = now; }
    }
    const d = camera.position.length();
    controls.rotateSpeed = 0.55 * Math.min(1, (d - 1) / Math.max(0.01, dFit - 1));
    if (drift && !fly && now - lastInteract > 5000) { // Demo: glide toward where the story is, a little each frame
      const k = reduced() ? 1 : 1 - Math.exp(-dt * 0.55);
      tmp.copy(camera.position).normalize().lerp(drift.dir, k).normalize(); const len = camera.position.length(); camera.position.copy(tmp).setLength(len + (dFit * drift.zoom - len) * k);
    }
    controls.autoRotate = !reduced() && !hold && !fly && !drift && now - lastInteract > 6000;
    controls.update();
    QU.uScale.value = Math.pow(tanA(camera.position.length()) / tanA(dFit), 0.6);
    QU.uClock.value = (now / 1000) % 3600;
    QU.uStill.value = reduced() ? 1 : 0;
    if (readyAt) earthMat.uniforms.uReady.value = reduced() ? 1 : Math.min(1, (now - readyAt) / 700);
    renderer.render(scene, camera);
    onAfter?.();
  }
  function loop(now) { if (!running) return; render(now); raf = requestAnimationFrame(loop); }

  const proj = new THREE.Vector3();
  const api = {
    canvas, three: { scene, camera, renderer },
    start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(raf); },
    renderOnce() { if (!running) render(performance.now()); },
    // Where the globe's centre should sit (CSS pixels inside the host) and the size of the box it must fit.
    setFrame(cx, cy, size) { frame.cx = cx; frame.cy = cy; frame.size = size; applyView(); },
    setHold(v) { hold = v; },
    // Demo: where the camera should drift to (null gives the globe back its slow turn).
    setDrift(lat, lon, z = 1) { if (lat == null) { drift = null; return; } drift ||= { dir: new THREE.Vector3(), zoom: 1 }; ll2v(lat, lon, 1, drift.dir); drift.zoom = z; },
    setWide(on) { QU.uWide.value = on ? 1 : 0; plates.material.opacity = on ? 0.22 : 0.35; },
    face(lat, lon) { camera.position.copy(ll2v(lat, lon)).setLength(dFit); fly = null; controls.update(); },
    async loadTextures(urls) {
      const L = new THREE.TextureLoader();
      const [day, night, water] = await Promise.all([L.loadAsync(urls.day), L.loadAsync(urls.night), L.loadAsync(urls.water)]);
      const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      for (const t of [day, night]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; }
      water.anisotropy = aniso;
      Object.assign(earthMat.uniforms, { tDay: { value: day }, tNight: { value: night }, tWater: { value: water } });
      readyAt = performance.now(); api.renderOnce();
    },
    setPlates(lines) {
      let n = 0; for (const l of lines) n += l.length / 2 - 1;
      const pos = new Float32Array(n * 6), a = new THREE.Vector3(), b = new THREE.Vector3(); let k = 0;
      for (const l of lines) for (let i = 0; i + 3 < l.length; i += 2) {
        ll2v(l[i + 1], l[i], 1.0025, a); ll2v(l[i + 3], l[i + 2], 1.0025, b);
        pos.set([a.x, a.y, a.z, b.x, b.y, b.z], k); k += 6;
      }
      plates.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3)); plates.geometry.computeBoundingSphere();
      plates.userData.loaded = true; plates.visible = plates.userData.on !== false;
    },
    setLayer(name, on) {
      if (name === 'plates') { plates.userData.on = on; plates.visible = on && !!plates.userData.loaded; }
      if (name === 'lights') earthMat.uniforms.uLights.value = on ? 1 : 0;
      if (name === 'sun') U.uSunlit.value = on ? 1 : 0;
      api.renderOnce();
    },
    setSun(ms) { const s = subsolar(ms); ll2v(s.lat, s.lon, 1, U.uSun.value); return s; },
    setQuakes(list, t0) {
      quakes = list; tMin = t0;
      if (points) { scene.remove(points); points.geometry.dispose(); points = null; }
      const order = list.slice().sort((a, b) => b.mag - a.mag);            // big first, so small ones stay visible on top
      const n = order.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), mag = new Float32Array(n), time = new Float32Array(n), rnd = new Float32Array(n), id = new Float32Array(n);
      const c = new THREE.Color(), r = mulberry(11);
      order.forEach((q, k) => {
        q.v = q.v || ll2v(q.lat, q.lon, 1);
        pos.set([q.v.x * 1.003, q.v.y * 1.003, q.v.z * 1.003], k * 3);
        c.setRGB(q.col[0] / 255, q.col[1] / 255, q.col[2] / 255, THREE.SRGBColorSpace); col.set([c.r, c.g, c.b], k * 3);
        mag[k] = q.mag; time[k] = (q.time - tMin) / 36e5; rnd[k] = r(); id[k] = q.i;
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1)); g.setAttribute('aTime', new THREE.BufferAttribute(time, 1));
      g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1)); g.setAttribute('aId', new THREE.BufferAttribute(id, 1));
      points = new THREE.Points(g, quakeMat); points.frustumCulled = false; points.renderOrder = 5; scene.add(points);
    },
    // t: playhead (ms). winH: how many hours count as "just happened". tauH: fade time constant, hours.
    setTime(t, { winH = 3, tauH = 17, playing = false } = {}) {
      QU.uT.value = (t - tMin) / 36e5; QU.uWin.value = winH; QU.uTau.value = tauH; QU.uPlaying.value = playing ? 1 : 0;
    },
    setMinMag(m) { QU.uMinMag.value = Number.isFinite(m) ? m : -10; },
    setMarks(sel, hover) {
      QU.uSel.value = sel ? sel.i : -1; QU.uHover.value = hover ? hover.i : -1;
      arc.visible = !!sel;
      if (sel) {
        const p = arc.geometry.attributes.position, ang = sel.v.angleTo(site), q = new THREE.Quaternion().setFromUnitVectors(sel.v, site), s = new THREE.Quaternion(), v = new THREE.Vector3();
        for (let i = 0; i <= ARC_N; i++) { const k = i / ARC_N; v.copy(sel.v).applyQuaternion(s.identity().slerp(q, k)).setLength(1.004 + 0.012 * ang * Math.sin(Math.PI * k)); p.setXYZ(i, v.x, v.y, v.z); }
        p.needsUpdate = true;
      }
    },
    // Screen position of a point on the unit sphere. front is false when the Earth is in the way.
    project(v, out = {}) {
      proj.copy(v).project(camera);
      out.x = (proj.x * 0.5 + 0.5) * W; out.y = (-proj.y * 0.5 + 0.5) * H;
      const d = camera.position.length(); out.front = v.dot(camera.position) / d - 1 / d > 0.03;
      return out;
    },
    // The earthquake under the pointer, if any: only those drawn right now (before the playhead, above the filter, this side).
    pick(x, y, t, minMag) {
      let best = null, bestScore = 1; const p = {}, s = QU.uScale.value;
      for (const q of quakes) {
        if (q.time > t || q.mag < minMag || !q.v) continue;
        api.project(q.v, p); if (!p.front) continue;
        const r = Math.max(6, magRadius(q.mag) * s + 3), score = Math.hypot(p.x - x, p.y - y) / r;
        if (score < bestScore) { bestScore = score; best = q; }
      }
      return best;
    },
    // Turn the camera so a place faces the viewer. Any drag cancels it.
    flyTo(lat, lon, ms = 900) {
      const to = ll2v(Math.max(-80, Math.min(80, lat)), lon), from = camera.position.clone().normalize(), dist = camera.position.length();
      if (reduced() || ms <= 0) { camera.position.copy(to).setLength(dist); fly = null; lastInteract = performance.now(); controls.update(); api.renderOnce(); return; }
      fly = { from, to, dist, t0: performance.now(), ms };
    },
    site,
    dispose() { api.stop(); ro.disconnect(); controls.dispose(); renderer.dispose(); canvas.remove(); },
  };
  camera.position.copy(ll2v(18, 96)).setLength(dFit);
  controls.update();
  canvas.globe = api;                                                    // the film turns the globe through this
  return api;
}
