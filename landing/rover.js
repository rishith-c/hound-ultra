// The rover's CAD model on a dark stage, turning as you scroll. three.js is loaded only when this scene is near.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { reduced, clamp, lerp } from './shared.js';

const $ = (s) => document.querySelector(s);
const MODEL = 'assets/models/rover_cad.glb';
// One camera pose per step of the story: [elevation in degrees, distance, look-at height]
const POSES = [[19, 4.4, 0.3], [12, 3.7, 0.36], [17, 3.6, 0.34], [33, 3.9, 0.3], [50, 4.5, 0.24]];

export async function startRover({ onScene }) {
  const canvas = $('#rover-gl'), stage = $('#rover-stage'), status = $('#rover-status'), poster = $('#rover-poster');
  const steps = [...document.querySelectorAll('#rover-steps li')], ticks = [...document.querySelectorAll('#rover-ticks i')], angleEl = $('#rover-angle');
  const st = { p: 0, yaw: 0.6, el: POSES[0][0], dist: POSES[0][1], look: POSES[0][2], tyaw: 0.6, visible: false, ready: false, raf: 0, last: 0, dirty: true };

  // The words work without the model, so wire them first.
  const setStep = (p) => {
    const f = p * steps.length, i = Math.min(steps.length - 1, Math.floor(f));
    steps.forEach((li, k) => li.classList.toggle('is-on', k === i));
    ticks.forEach((t, k) => t.style.setProperty('--f', clamp(f - k).toFixed(3)));
    return i;
  };
  onScene('rover', (p, u) => {
    st.p = p; const i = setStep(p);
    st.tyaw = 0.6 + p * Math.PI * 2.15;
    [st.tel, st.tdist, st.tlook] = POSES[i];
    st.visible = u > -0.35 && u < 1.25; st.dirty = true; kick();
  });

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { return fail('3-D is not available in this browser.'); }
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture; scene.environmentIntensity = 0.16;
  const camera = new THREE.PerspectiveCamera(27, 1, 0.05, 50);

  // Light: one soft key from above-front, a cool rim from behind. A pool of light on the floor, as in the project film.
  const key = new THREE.SpotLight(0xfff1e0, 84, 14, 0.42, 0.9, 1.7); key.position.set(1.5, 4.4, 2.2); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.radius = 5; key.shadow.camera.near = 1; key.shadow.camera.far = 9;
  key.target.position.set(0, 0.2, 0);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 0.9); rim.position.set(-2.5, 1.6, -3);
  const fill = new THREE.HemisphereLight(0xcfd8e6, 0x0a0c10, 0.1);
  scene.add(key, key.target, rim, fill);
  // The floor is only what the light touches: it fades to nothing, so the stage has no edge.
  const fc = document.createElement('canvas'); fc.width = fc.height = 256;
  const fg = fc.getContext('2d'), grad = fg.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, '#fff'); grad.addColorStop(0.3, '#b4b4b4'); grad.addColorStop(0.6, '#2e2e2e'); grad.addColorStop(0.92, '#000');   // alphaMap reads the green channel
  fg.fillStyle = '#000'; fg.fillRect(0, 0, 256, 256); fg.fillStyle = grad; fg.fillRect(0, 0, 256, 256);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.4, 96), new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 0.7, metalness: 0.0, alphaMap: new THREE.CanvasTexture(fc), transparent: true, envMapIntensity: 0 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  // Graduation ring on the floor: a tick every 10 degrees, so the turn reads as a measurement.
  const ring = new THREE.Group();
  const tickMat = new THREE.MeshBasicMaterial({ color: 0xe9edf2, transparent: true, opacity: 0.22, depthWrite: false });
  for (let d = 0; d < 360; d += 5) { const major = d % 30 === 0; const m = new THREE.Mesh(new THREE.PlaneGeometry(major ? 0.07 : 0.03, 0.004), tickMat); const a = THREE.MathUtils.degToRad(d), r = 0.98 + (major ? 0.035 : 0.015); m.position.set(Math.cos(a) * r, 0.002, Math.sin(a) * r); m.rotation.set(-Math.PI / 2, 0, -a); ring.add(m); }
  const circle = new THREE.Mesh(new THREE.RingGeometry(0.958, 0.96, 180), tickMat); circle.rotation.x = -Math.PI / 2; circle.position.y = 0.002; ring.add(circle);
  scene.add(ring);
  const pivot = new THREE.Group(); scene.add(pivot);

  function resize() {
    const r = stage.getBoundingClientRect(); if (!r.width || !r.height) return;
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.setViewOffset(r.width, r.height, -r.width * 0.17, 0, r.width, r.height);     // the rover sits right of centre; the words are on the left
    camera.updateProjectionMatrix(); st.dirty = true; kick();
  }
  new ResizeObserver(resize).observe(stage); resize();

  function frame(now) {
    st.raf = 0;
    if (!st.visible || !st.ready) return;
    const dt = Math.min(0.05, (now - st.last) / 1000 || 0.016); st.last = now;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 7);
    const before = st.yaw + st.el + st.dist;
    st.yaw = lerp(st.yaw, st.tyaw, k); st.el = lerp(st.el, st.tel, k * 0.6); st.dist = lerp(st.dist, st.tdist, k * 0.6); st.look = lerp(st.look, st.tlook, k * 0.6);
    const moving = Math.abs(st.yaw + st.el + st.dist - before) > 1e-4;
    if (moving || st.dirty) {
      st.dirty = false;
      pivot.rotation.y = st.yaw; ring.rotation.y = st.yaw;
      const e = THREE.MathUtils.degToRad(st.el);
      camera.position.set(0, st.look + Math.sin(e) * st.dist, Math.cos(e) * st.dist); camera.lookAt(0, st.look, 0);
      renderer.render(scene, camera);
      angleEl.textContent = String(Math.round(THREE.MathUtils.radToDeg(st.yaw) % 360)).padStart(3, '0') + '\u00b0';
    }
    if (moving) st.raf = requestAnimationFrame(frame);
  }
  function kick() { if (!st.raf && st.visible && st.ready) { st.last = performance.now(); st.raf = requestAnimationFrame(frame); } }
  function fail(msg) { console.warn('[landing] rover model:', msg); status.textContent = ''; canvas.hidden = true; poster.hidden = false; }

  status.textContent = 'Loading the CAD model';
  try {
    const gltf = await new GLTFLoader().loadAsync(MODEL, (ev) => { if (ev.total) status.textContent = `Loading the CAD model, ${(ev.loaded / 1e6).toFixed(1)} of ${(ev.total / 1e6).toFixed(1)} MB`; });
    const model = gltf.scene;
    model.rotation.x = -Math.PI / 2;                    // the CAD export is Z-up
    model.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model); const size = box.getSize(new THREE.Vector3());
    const s = 1.05 / Math.max(size.x, size.z);          // the deck spans about one unit
    model.scale.setScalar(s); model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model); const c = box.getCenter(new THREE.Vector3());
    model.position.set(-c.x, -box.min.y, -c.z);
    const seen = new Map();
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      o.geometry = toCreasedNormals(o.geometry, THREE.MathUtils.degToRad(38));   // CAD faces: hard edges stay hard, curves stay smooth
      if (!seen.has(o.material)) {
        const m = o.material.clone(), hsl = {}; m.color.getHSL(hsl);
        m.side = THREE.FrontSide; m.flatShading = false;
        if (hsl.l > 0.3) { m.color.setHSL(hsl.h, hsl.s * 0.2, Math.min(0.8, hsl.l * 1.12)); m.metalness = 0.3; m.roughness = 0.5; }      // extrusion and deck
        else if (hsl.s > 0.5 && hsl.l > 0.08) { m.metalness = 0.1; m.roughness = 0.55; }                                                  // boards, cells
        else { m.color.setHSL(hsl.h, hsl.s * 0.4, Math.max(0.02, hsl.l)); m.metalness = 0.2; m.roughness = 0.58; }                         // motors, wheels, housings
        seen.set(o.material, m);
      }
      o.material = seen.get(o.material);
    });
    pivot.add(model);
    renderer.compile(scene, camera);
    st.ready = true; st.dirty = true; status.textContent = '';
    [st.tel, st.tdist, st.tlook] = POSES[Math.min(POSES.length - 1, Math.floor(st.p * POSES.length))]; st.el = st.tel; st.dist = st.tdist; st.look = st.tlook; st.yaw = st.tyaw;
    kick();
    window.__landing && (window.__landing.rover = { scene, camera, renderer, st, size: size.toArray() });
  } catch (e) { fail(e.message || String(e)); }
}
