// The rover as built, in the rover chapter's own studio (app/workspaces/rover: studio.js and rover.js), slowly turning
// and coming apart as the text advances. three.js and the model load once the first screen is done.
import { reduced, clamp, lerp } from './shared.js';

const $ = (s) => document.querySelector(s), rad = Math.PI / 180;
// One pose per step: yaw and elevation in degrees, distance in metres, height looked at, how far apart (0 to 1), parts named.
const STEPS = [
  { yaw: -34, el: 15, dist: 1.95, look: 0.2, open: 0, tags: [['wheels', 'Mecanum wheels, 80 mm'], ['frame', 'Aluminium frame'], ['battery', 'Battery, 3S 2200 mAh']] },
  { yaw: 98, el: 24, dist: 2.5, look: 0.3, open: 0.56, tags: [['radio', 'Wi-Fi radio, ESP32-S3'], ['pi', 'Raspberry Pi 4']] },
  { yaw: 24, el: 15, dist: 2.45, look: 0.31, open: 0.6, tags: [['radar', 'Radar, 24 GHz'], ['thermal', 'Thermal camera'], ['webcam', 'Webcam']] },
  { yaw: -42, el: 24, dist: 2, look: 0.19, open: 0, tags: [['drivers', 'Motor drivers'], ['uno', 'Arduino UNO R4'], ['wheels', 'Four driven wheels']] },
];

export async function startRover({ onScene }) {
  const stage = $('#rover-stage'), status = $('#rover-status'), poster = $('#rover-poster'), lines = $('#rover-lines'), tagBox = $('#rover-tags');
  const steps = [...document.querySelectorAll('#rover-steps li')], ticks = [...document.querySelectorAll('#rover-ticks i')];
  const s = { f: 0, i: -1, visible: false, raf: 0, last: 0, drift: 0, pose: { ...STEPS[0] }, ready: false };

  // The words work without the model, so they are wired first.
  onScene('rover', (p, u) => {
    s.f = p * steps.length;
    const i = Math.min(steps.length - 1, Math.floor(s.f));
    if (i !== s.i) { s.i = i; steps.forEach((li, k) => li.classList.toggle('is-on', k === i)); s.tagStep = -1; }
    ticks.forEach((t, k) => t.style.setProperty('--f', clamp(s.f - k).toFixed(3)));
    s.visible = u > -0.75 && u < 1.75;
    kick();
  });

  let THREE, st, R, pivot;
  status.textContent = 'Loading the rover';
  try {
    const [three, studio, rover] = await Promise.all([import('three'), import('../app/workspaces/rover/studio.js'), import('../app/workspaces/rover/rover.js')]);
    THREE = three; st = studio.createStudio(stage, { reduced }); st.resize();
    stage.prepend(st.renderer.domElement);
    R = await rover.buildRover();
  } catch (e) { console.warn('[landing] the rover model is off, showing the photograph:', e.message); st?.dispose(); status.textContent = ''; poster.hidden = false; return; }
  pivot = new THREE.Group(); pivot.add(R.root); st.scene.add(pivot);
  const o = new THREE.Vector3(), svg = 'http://www.w3.org/2000/svg';
  const tags = STEPS.map((x) => x.tags.map(([id, text]) => {
    const under = document.createElementNS(svg, 'path'), path = document.createElementNS(svg, 'path'), dot = document.createElementNS(svg, 'circle'), node = document.createElement('span');
    under.setAttribute('class', 'under'); dot.setAttribute('r', '3.2'); node.textContent = text; lines.append(under, path, dot); tagBox.append(node);
    return { id, under, path, dot, node };
  }));
  const all = tags.flat();

  // Between two steps the pose eases; inside a step it rests, so there is time to read.
  function target() {
    const i = Math.min(STEPS.length - 1, Math.floor(s.f)), a = STEPS[i], b = STEPS[Math.min(STEPS.length - 1, i + 1)], x = clamp((s.f - i - 0.8) / 0.2), k = x * x * (3 - 2 * x), t = {};
    for (const n of ['yaw', 'el', 'dist', 'look', 'open']) t[n] = lerp(a[n], b[n], k);
    return t;
  }
  function pose(p) {
    R.explode(p.open); pivot.rotation.y = (p.yaw + s.drift) * rad;
    const c = st.camera, e = p.el * rad, az = 62 * rad;
    c.position.set(Math.sin(az) * Math.cos(e) * p.dist, p.look + Math.sin(e) * p.dist, Math.cos(az) * Math.cos(e) * p.dist); c.lookAt(0, p.look, 0);
    c.fov = 26; c.updateProjectionMatrix(); c.projectionMatrix.elements[8] = -0.25; c.projectionMatrixInverse.copy(c.projectionMatrix).invert(); c.updateMatrixWorld();   // the rover sits right of centre; the words are on the left
    pivot.updateMatrixWorld(true);
    R.wheels.forEach((w, k) => { w.spin.getWorldPosition(o); st.floorU.uWheel.value[k].set(o.x, o.z, Math.max(0, o.y - 0.04), 0); });
    R.parts.get('deck')[0].getWorldPosition(o); st.floorU.uBody.value.set(o.x, o.z, Math.max(0, o.y - 0.1), 0);
    st.stripAt(0.35 - 0.5 * Math.sin(p.yaw * rad), 1.0, 0.1); st.strip.intensity = 15; st.key.intensity = 13 - 5 * p.open; st.scene.environmentRotation.y = -0.5 + 0.004 * (p.yaw + s.drift);
  }
  // Names sit in a fixed column on the right; only the leader lines move with the machine.
  function label() {
    const [W, H] = st.size, i = s.i;
    if (s.tagStep !== i) {
      s.tagStep = i; all.forEach((t) => { const on = tags[i].includes(t); t.node.classList.toggle('on', on); t.under.classList.toggle('on', on); t.path.classList.toggle('on', on); t.dot.classList.toggle('on', on); });
      tags[i].forEach((t) => { R.anchor(t.id, o).project(st.camera); t.y0 = o.y; });
      [...tags[i]].sort((a, b) => b.y0 - a.y0).forEach((t, k, arr) => { t.ly = H * (0.5 + (k - (arr.length - 1) / 2) * 0.11); t.node.style.transform = 'translate3d(0,' + t.ly.toFixed(1) + 'px,0) translateY(-50%)'; t.lx = tagBox.offsetLeft - 12; });
    }
    for (const t of tags[i]) {
      R.anchor(t.id, o).project(st.camera);
      const x = (o.x * 0.5 + 0.5) * W, y = (-o.y * 0.5 + 0.5) * H;
      const d = 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'L' + (t.lx - 34).toFixed(1) + ' ' + t.ly.toFixed(1) + 'L' + t.lx.toFixed(1) + ' ' + t.ly.toFixed(1); t.path.setAttribute('d', d); t.under.setAttribute('d', d);
      t.dot.setAttribute('cx', x.toFixed(1)); t.dot.setAttribute('cy', y.toFixed(1));
    }
  }
  function frame(now) {
    s.raf = 0; if (!s.visible) return;
    const dt = Math.min(0.05, Math.max(0, (now - s.last) / 1000)); s.last = now;
    if (st.resize()) s.tagStep = -1;
    const t = target(), k = reduced ? 1 : 1 - Math.exp(-dt * 6);
    for (const n in t) s.pose[n] = lerp(s.pose[n], t[n], k);
    if (!reduced) s.drift = 7 * Math.sin(now / 5200);
    pose(s.pose); label(); st.render();
    if (!reduced) { st.adapt(dt); s.raf = requestAnimationFrame(frame); }
  }
  function kick() { if (s.ready && s.visible && !s.raf) { s.last = performance.now(); s.raf = requestAnimationFrame(frame); } }
  // One hidden frame now, so shaders and textures are ready before the section scrolls in.
  pose(s.pose); st.render(); s.ready = true; status.textContent = ''; stage.classList.add('ready');
  if (reduced) new ResizeObserver(kick).observe(stage);
  kick();
  if (window.__landing) window.__landing.rover = { st, R, s, STEPS };
}
