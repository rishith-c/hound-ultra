// Demo: one continuous move, about 15 s. Light over the closed rover, apart, together, and into the photograph.
import * as THREE from 'three';
import { PHOTO, photoBasis } from './rover.js';

export const T = { open: 3.2, opened: 7.5, labels: 6.1, pulse: 7.5, pulseEnd: 10.2, close: 10.2, closed: 13.1, arrive: 13.5, wipe: 13.7, end: 15.5 };
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x, ss = (a, b, x) => { x = clamp((x - a) / (b - a)); return x * x * x * (x * (x * 6 - 15) + 10); };
export const explodeAt = (t) => t < T.close ? .5 - .5 * Math.cos(Math.PI * clamp((t - T.open) / (T.opened - T.open))) : .5 + .5 * Math.cos(Math.PI * clamp((t - T.close) / (T.closed - T.close)));
const REST = 28; // where the wipe settles, per cent from the left: the headline keeps its dark ground

// final camera = the camera of the photograph, in three.js axes
const pb = photoBasis(), toThree = (v) => new THREE.Vector3(v.x, v.z, -v.y), PP = toThree(new THREE.Vector3(...PHOTO.pos)), PD = toThree(pb.d);
export const photoTarget = PP.clone().addScaledVector(PD, 1.5);
export function photoFov(w, h) { const s = Math.max(w / PHOTO.w, h / PHOTO.h); return 2 * Math.atan(h / 2 / (PHOTO.f * s)) * 180 / Math.PI; }
const K = [
  { t: 0, p: [.50, .052, .70], q: [.135, .060, .20], f: 24 },
  { t: 3.2, p: [.98, .125, .58], q: [.02, .115, .03], f: 26 },
  { t: 7.3, p: [1.86, .86, 1.16], q: [-.10, .395, .0], f: 26 },
  { t: 10.0, p: [2.06, .80, .74], q: [-.10, .395, -.01], f: 26 },
  { t: T.arrive, p: PP.toArray(), q: photoTarget.toArray(), f: 22.3, photo: true },
];
K.forEach((k, i) => { const a = K[i - 1], b = K[i + 1]; k.m = [0, 1, 2, 3, 4, 5].map((j) => { if (!a || !b) return 0; const g = (x) => j < 3 ? x.p[j] : x.q[j - 3]; return (g(b) - g(a)) / (b.t - a.t); }); });
const C = { p: new THREE.Vector3(), q: new THREE.Vector3(), f: 26 };
function camAt(t, fovEnd) {
  let i = 0; while (i < K.length - 2 && t > K[i + 1].t) i++; const a = K[i], b = K[i + 1], d = b.t - a.t, u = clamp((t - a.t) / d), u2 = u * u, u3 = u2 * u, h0 = 2 * u3 - 3 * u2 + 1, h1 = u3 - 2 * u2 + u, h2 = -2 * u3 + 3 * u2, h3 = u3 - u2;
  const g = (j) => { const x = j < 3 ? a.p[j] : a.q[j - 3], y = j < 3 ? b.p[j] : b.q[j - 3]; return h0 * x + h1 * d * a.m[j] + h2 * y + h3 * d * b.m[j]; };
  C.p.set(g(0), g(1), g(2)); C.q.set(g(3), g(4), g(5)); const fa = a.f, fb = b.photo ? fovEnd : b.f; C.f = fa + (fb - fa) * (u2 * (3 - 2 * u)); return C;
}

const LABELS = [
  { id: 'radar', text: 'Radar', x: -.115, y: -.055, d: 0 }, { id: 'radio', text: 'Wi-Fi radio', x: -.135, y: -.075, d: .25 },
  { id: 'thermal', text: 'Thermal camera', x: .12, y: -.05, d: .5 }, { id: 'pi', text: 'The computer that runs the network', x: .155, y: -.030, d: .75 }, { id: 'wheels', text: 'Mecanum wheels', x: .07, y: -.085, d: 1.0 },
];

export function createHero({ ctx, stage, st, R, photo }) {
  const { h, realityTag, reducedMotion } = ctx.kit;
  const title = h('h1.rover-h', null, 'The rover that carries it'), line = h('p.rover-sub', null, 'Our own design, part by part.');
  const again = h('button.btn.btn-primary.rover-again', { type: 'button', onclick: () => replay() }, 'Take it apart again');
  const block = h('div.rover-block.demo-only', null, realityTag('built'), title, line, again);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'rover-leaders demo-only'); svg.setAttribute('aria-hidden', 'true');
  const labels = LABELS.map((l) => { const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'), dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); path.setAttribute('pathLength', '1'); dot.setAttribute('r', '2.6'); svg.append(path, dot); const el = h('div.rover-label.demo-only', { class: l.x < 0 ? 'left' : 'right' }, l.text); return { ...l, path, dot, el, k: -1 }; });
  const pane = h('div.rover-photo.demo-only', null, photo), bar = h('div.rover-wipe.demo-only', { role: 'slider', tabIndex: 0, 'aria-label': 'Drag between our model and the photograph', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span.rover-grip', { html: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M6.500 5 2.500 9l4 4M11.500 5l4 4-4 4"/></svg>' }), h('span.rover-cap.l', null, 'Our model'), h('span.rover-cap.r', null, 'Photograph'));
  stage.append(pane, svg, ...labels.map((l) => l.el), bar, h('div.rover-shade.demo-only'), block);

  // the pulse: radio to computer. The real link is Wi-Fi (UDP), so it crosses the air; the only cable on that radio is its power.
  const N = 44, warm = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--person').trim() || '#ff6a45');
  const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: warm.clone().multiplyScalar(3.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), N); beads.frustumCulled = false; beads.visible = false;
  const rings = [0, 1, 2].map(() => { const m = new THREE.Mesh(new THREE.RingGeometry(.955, 1, 72), new THREE.MeshBasicMaterial({ color: warm.clone().multiplyScalar(2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); m.visible = false; st.scene.add(m); return m; });
  const glow = new THREE.PointLight(warm, 0, .6, 2); st.scene.add(beads, glow);

  const A = new THREE.Vector3(), B = new THREE.Vector3(), Mid = new THREE.Vector3(), V = new THREE.Vector3(), O = new THREE.Vector3(), S = new THREE.Vector3(), Qi = new THREE.Quaternion(), m4 = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0), rightV = new THREE.Vector3();
  let t = 0, goal = 0, playing = true, scrubIdle = 0, wipe = 100, wipeUser = null, wipeGoal = 100, shown = -1, state = '', still = 0;
  let yaw = 0, pit = 0, vy = 0, vp = 0, gy = 0, gp = 0, drag = null;

  const atPhoto = () => t >= T.wipe && state === 'photo';
  function replay() { wipeUser = null; if (reducedMotion()) { still = 0; t = goal = T.opened + .8; return; } t = goal = T.open - 1.4; playing = true; gy = gp = 0; }
  function setState(s) { if (s === state) return; state = s; stage.dataset.stage = s; title.textContent = s === 'photo' ? 'This one is real.' : 'The rover that carries it'; line.textContent = s === 'photo' ? 'Built by students. Driven from a laptop over Wi-Fi.' : 'Our own design, part by part.'; again.tabIndex = s === 'photo' ? 0 : -1; bar.tabIndex = s === 'photo' ? 0 : -1; }
  function setWipe(x) { if (Math.abs(x - shown) < .01) return; shown = x; const W = st.size[0], px = x / 100 * W; pane.style.transform = 'translate3d(' + px.toFixed(2) + 'px,0,0)'; photo.style.transform = 'translate3d(' + (-px).toFixed(2) + 'px,0,0)'; bar.style.transform = 'translate3d(' + px.toFixed(2) + 'px,0,0)'; bar.setAttribute('aria-valuenow', String(Math.round(100 - x))); pane.style.visibility = bar.style.visibility = x < 99.9 ? 'visible' : 'hidden'; }

  // ── input
  const demo = () => ctx.mode === 'demo';
  stage.addEventListener('pointerdown', (e) => { if (!demo() || e.button || e.target.closest('button')) return; stage.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, gy, gp, wipe: atPhoto() }; if (drag.wipe) moveWipe(e); else stage.classList.add('grabbing'); });
  const moveWipe = (e) => { const b = stage.getBoundingClientRect(); wipeUser = clamp((e.clientX - b.left) / b.width * 100, 0, 100); };
  stage.addEventListener('pointermove', (e) => { if (!drag || !demo()) return; if (drag.wipe) return moveWipe(e); gy = drag.gy - (e.clientX - drag.x) * .0052; gp = clamp(drag.gp + (e.clientY - drag.y) * .0036, -.6, .75); });
  const drop = () => { drag = null; stage.classList.remove('grabbing'); }; stage.addEventListener('pointerup', drop); stage.addEventListener('pointercancel', drop);
  stage.addEventListener('wheel', (e) => { if (!demo() || reducedMotion()) return; e.preventDefault(); wipeUser = null; playing = false; scrubIdle = 0; goal = clamp(goal + clamp(e.deltaY, -120, 120) * .0052, 0, T.end); }, { passive: false });
  const onKey = (e) => { if (!demo() || !visible || e.target.closest?.('input,textarea,select')) return; if (!atPhoto()) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); wipeUser = clamp((wipeUser ?? wipeGoal) + (e.key === 'ArrowLeft' ? -4 : 4), 0, 100); } else if (e.key === 'Home') wipeUser = 0; else if (e.key === 'End') wipeUser = 100; };
  addEventListener('keydown', onKey, true);
  let visible = true;

  function drawLabels(show) {
    const [W, H] = st.size; R.root.updateMatrixWorld();
    for (const l of labels) {
      const k = show ? ss(T.labels + l.d, T.labels + l.d + .9, t) * (1 - ss(T.close - .35, T.close + .15, t)) : 0;
      if (k < .001) { if (l.k !== 0) { l.k = 0; l.el.style.opacity = 0; l.path.style.opacity = l.dot.style.opacity = 0; } continue; }
      R.anchor(l.id, V).project(st.camera); const x = (V.x * .5 + .5) * W, y = (-V.y * .5 + .5) * H, lx = x + l.x * W, ly = y + l.y * W * .5, ex = lx + (l.x < 0 ? 10 : -10);
      l.path.setAttribute('d', 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'L' + (ex + (x - ex) * .16).toFixed(1) + ' ' + ly.toFixed(1) + 'L' + ex.toFixed(1) + ' ' + ly.toFixed(1)); l.path.style.strokeDashoffset = (1 - clamp(k * 1.25)).toFixed(3); l.path.style.opacity = 1; l.dot.setAttribute('cx', x.toFixed(1)); l.dot.setAttribute('cy', y.toFixed(1)); l.dot.style.opacity = clamp(k * 3);
      l.el.style.transform = 'translate3d(' + lx.toFixed(1) + 'px,' + ly.toFixed(1) + 'px,0) translate(' + (l.x < 0 ? '-100%' : '0') + ',-50%)'; l.el.style.opacity = clamp((k - .55) / .45).toFixed(3); l.k = k;
    }
  }
  function drawPulse(on, time) {
    const u = on ? clamp((t - T.pulse) / (T.pulseEnd - .5 - T.pulse)) : 0, act = on && u > 0 && u < 1; beads.visible = act; glow.intensity = 0; for (const r of rings) r.visible = act;
    if (!act) { labels[1].el.classList.remove('hot'); labels[3].el.classList.remove('hot'); return; }
    R.anchor('radio', A); R.anchor('pi', B); Mid.copy(A).add(B).multiplyScalar(.5); Mid.y += .085; const head = clamp(u * 1.45), fade = 1 - ss(.86, 1, u);
    for (let i = 0; i < N; i++) { const s = i / (N - 1), d = head - s, k = d < 0 ? 0 : Math.exp(-d * 4.2), a = (1 - s) * (1 - s), b = 2 * s * (1 - s), c = s * s; O.set(A.x * a + Mid.x * b + B.x * c, A.y * a + Mid.y * b + B.y * c, A.z * a + Mid.z * b + B.z * c); const r = (.0004 + .0021 * k) * (d < 0 ? 0 : 1) * fade; S.set(r, r, r); beads.setMatrixAt(i, m4.compose(O, Qi, S)); }
    beads.instanceMatrix.needsUpdate = true; const s = head, a = (1 - s) * (1 - s), b = 2 * s * (1 - s), c = s * s; glow.position.set(A.x * a + Mid.x * b + B.x * c, A.y * a + Mid.y * b + B.y * c + .012, A.z * a + Mid.z * b + B.z * c); glow.intensity = .10 * fade;
    rings.forEach((r, i) => { const p = (u * 3.2 + i / 3) % 1, q = .012 + p * .075; r.position.copy(A); r.quaternion.copy(st.camera.quaternion); r.scale.setScalar(q); r.material.opacity = (1 - p) * .55 * fade * ss(0, .08, u); });
    labels[1].el.classList.toggle('hot', u < .4); labels[3].el.classList.toggle('hot', head >= 1 && u < .98);
  }

  return {
    get t() { return t; }, get state() { return state; }, seek(x, hold = true) { t = goal = x; if (hold) playing = false, scrubIdle = -1e9; }, replay,
    show(v) { visible = v; }, invalidate() { shown = -1; },
    dispose() { removeEventListener('keydown', onKey, true); },
    update(dt, time) {
      const red = reducedMotion();
      if (red) { still += dt; t = goal = still < 5 ? T.opened + .9 : T.end; }
      else if (playing) { if (!drag || drag.wipe) t = Math.min(T.end, t + dt); goal = t; }
      else { scrubIdle += dt; t += (goal - t) * (1 - Math.exp(-dt * 9)); if (scrubIdle > 2.4 && !drag) playing = true; }
      const e = red ? (t >= T.arrive ? 0 : 1) : explodeAt(t); R.explode(e);
      // orbit offset: critically damped, returns on its own once let go
      const back = !drag ? Math.exp(-dt * .55) : 1; gy *= back; gp *= back; const near = 1 - ss(T.closed - .6, T.arrive, t), w = 11; let a = (gy * near - yaw) * w * w - 2 * w * vy; vy += a * dt; yaw += vy * dt; a = (gp * near - pit) * w * w - 2 * w * vp; vp += a * dt; pit += vp * dt;
      if (near <= 0) { yaw = pit = vy = vp = 0; if (!drag) gy = gp = 0; }
      const c = camAt(t, photoFov(st.size[0], st.size[1])), cam = st.camera; V.copy(c.p).sub(c.q); if (yaw) V.applyAxisAngle(up, yaw); if (pit) { rightV.crossVectors(up, V).normalize(); V.applyAxisAngle(rightV, -pit * .8); } cam.position.copy(c.q).add(V); if (cam.position.y < .03) cam.position.y = .03; cam.lookAt(c.q); if (Math.abs(cam.fov - c.f) > 1e-4) { cam.fov = c.f; cam.updateProjectionMatrix(); } cam.updateMatrixWorld();
      // the strip light slides along the frame, then holds over the machine
      const sl = ss(0, 4.4, t); st.stripAt(1.25 - 2.2 * sl + .75 * ss(5, 13, t), 1.02 - .1 * Math.sin(sl * 3.14), .34 - .55 * sl); st.strip.intensity = 21 - 7 * ss(3, 6, t); st.scene.environmentRotation.y = -.5 + .9 * ss(0, 13, t);
      setState(red ? (t >= T.arrive ? 'photo' : 'show') : t >= T.wipe + .5 ? 'photo' : 'show');
      wipeGoal = wipeUser ?? (red ? (t >= T.arrive ? REST : 100) : 100 - (100 - REST) * ss(T.wipe, T.end, t)); wipe = wipeUser == null ? wipeGoal : wipe + (wipeGoal - wipe) * (1 - Math.exp(-dt * 22)); setWipe(wipe);
      if (t < T.wipe - .3) wipeUser = null;
      drawLabels(t > T.labels && t < T.close + .4); drawPulse(!red && t > T.pulse && t < T.pulseEnd, time);
    },
    quiet() { drawLabels(false); drawPulse(false); setWipe(100); },
    beads, rings, glow,
  };
}
