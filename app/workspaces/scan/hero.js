// The Demo film: the scan falls into place, the building is opened, the spaces someone could survive in fill with light
// one by one, and the camera goes into the largest. Every number shown is read from the live result; nothing is staged
// except the order. Runs on whatever scan is loaded.
import * as THREE from 'three';

export const ACTS = [['scan', 'Scan'], ['open', 'Open'], ['voids', 'Voids'], ['inside', 'Look in']];
const clamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x), ease = (u) => { u = clamp(u); return u * u * u * (u * (u * 6 - 15) + 10); }, span = (t, a, b) => ease((t - a) / (b - a));

export function createHero(view, d, { reduced = false, html }) {
  const list = d.voids.list.map((v, i) => ({ v, i })).sort((a, b) => b.v.volume - a.v.volume).slice(0, 4), big = list[0];
  const b = d.bounds, sx = d.extent[0], sy = d.extent[1], k = Math.max(0.12, Math.min(1, Math.max(sx, sy * 1.25) / 118)), gz = view.gz;
  const site = d.kind === 'site', F = site ? [70, 46] : [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2], z0 = gz(F[0], F[1]);
  const EACH = 3.1, tScan = d.traj ? 12.4 : 2.5, tOpen = tScan + 6.6, tVoid = tOpen + 1 + list.length * EACH + (list.length ? 1.6 : 2), tDive = tVoid + (big ? 13.5 : 0);
  const starts = { scan: 0, open: tScan, voids: tOpen, inside: tVoid }, total = tDive;

  // which second of the capture is on screen at story time t: each pass gets its share, transits are skipped
  const seg = [];
  if (d.passes) { const w = { aerial: 5.4, orbit: 2.4, close: 1.9, interior: 2.1 }; let t = 0.1; const tot = d.passes.reduce((s, p) => s + (w[p.id] || 3), 0); for (const p of d.passes) { const len = ((w[p.id] || 3) / tot) * (tScan - 0.7); seg.push({ a: t, b: t + len, t0: p.t0, t1: p.t1, p }); t += len; } }
  const capAt = (t) => { for (const s of seg) if (t < s.b) return s.t0 + (s.t1 - s.t0) * clamp((t - s.a) / (s.b - s.a)); return null; };
  const passAt = (t) => seg.find((s) => t < s.b);

  // ---- the camera: positions and targets through time, joined by a smooth curve
  const K = [];
  const key = (t, tgt, dist, az, el) => { const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180, D = dist * k; K.push([t, tgt[0] + D * Math.sin(a) * Math.cos(e), tgt[1] + D * Math.cos(a) * Math.cos(e), tgt[2] + D * Math.sin(e), tgt[0], tgt[1], tgt[2]]); };
  const at = (x, y, z) => K.push([x[0], ...y, ...z]);
  key(0, [F[0] - 4 * k, F[1] - 2 * k, z0 + 14], 90, 316, 10); key(5.5, [F[0] + 2 * k, F[1], z0 + 5], 72, 334, 24);
  if (d.traj) { key(8.6, [F[0] + 10 * k, F[1] + 6 * k, z0 + 1], 42, 356, 27); key(tScan - 0.5, [F[0] + 8 * k, F[1] + 4 * k, z0 + 1], 46, 366, 30); }
  key(tOpen - 2.6, [F[0] + 4 * k, F[1] + 2 * k, z0 + 0.6], 46, 382, 38); key(tOpen, [F[0] + 6 * k, F[1] + 2 * k, z0 + 0.4], 45, 390, 42);
  list.forEach(({ v }, q) => { const t = tOpen + 0.9 + q * EACH, az = v.access && v.access.from !== 'above' ? (Math.atan2(v.access.pos[0] - v.centre[0], v.access.pos[1] - v.centre[1]) * 180) / Math.PI : 160; const A = site ? (v.centre[0] > 88 ? 342 : 396) : az; const size = Math.max(v.length, v.width, 2) / k; key(t + 0.5, v.centre, 17 + size * 1.9 * Math.min(1, k * 2), A + 6, 35); key(t + EACH - 0.6, v.centre, 15 + size * 1.8 * Math.min(1, k * 2), A - 4, 32); });
  if (big) {
    const v = big.v, c = v.centre, path = v.access && v.access.path.length > 1 ? v.access.path : [c, [c[0], c[1] - 3, c[2]]], out = path[path.length - 1]; // path runs from the middle of the pocket to open air
    let dx = out[0] - c[0], dy = out[1] - c[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const eye = (x, y, h) => Math.max(gz(x, y) + 0.55, Math.min(c[2] + h, v.topZ || c[2] + h)), P = (s, h) => { const x = c[0] + dx * s, y = c[1] + dy * s; return [x, y, h]; };
    key(tVoid - 0.4, [c[0], c[1], c[2]], 21, site ? 385 : 180, 37);
    const p1 = P(l + 9, c[2] + 4.6), p2 = P(l + 3.2, c[2] + 1.2);
    const inn = (s, h) => [c[0] - dx * s, c[1] - dy * s, c[2] + h], px = -dy, py = dx;
    const hold = (s, h, side) => { const x = c[0] + dx * s + px * side, y = c[1] + dy * s + py * side; return [x, y, Math.max(gz(x, y) + 0.5, c[2] + h)]; };
    at([tVoid + 2.6], p1, [c[0], c[1], c[2] + 0.1]); at([tVoid + 4.8], p2, inn(0.2, 0.05)); at([tVoid + 7.6], hold(l + 3.6, 0.8, -0.3), inn(0.4, 0)); at([tDive - 1.5], hold(l + 2.9, 0.6, 0.7), inn(0.7, 0)); at([tDive], hold(l + 2.8, 0.6, 0.85), inn(0.7, 0));
  } else key(total, [F[0], F[1], z0], 60, 150, 40);
  const C6 = new Float64Array(6);
  function sample(t) { // non-uniform Catmull-Rom, so the camera never stops or jerks at a key
    const n = K.length; let i = 0; while (i < n - 2 && K[i + 1][0] <= t) i++;
    const A = K[i], B = K[i + 1], h = B[0] - A[0], u = clamp((t - A[0]) / h), u2 = u * u, u3 = u2 * u, Z = K[Math.max(0, i - 1)], Y = K[Math.min(n - 1, i + 2)];
    for (let q = 1; q < 7; q++) { const ma = (B[q] - Z[q]) / Math.max(1e-6, B[0] - Z[0]) * h, mb = (Y[q] - A[q]) / Math.max(1e-6, Y[0] - A[0]) * h; C6[q - 1] = (2 * u3 - 3 * u2 + 1) * A[q] + (u3 - 2 * u2 + u) * ma + (-2 * u3 + 3 * u2) * B[q] + (u3 - u2) * mb; }
  }

  const S = { t: 0, act: '', speed: 1, paused: false, pausedAt: 0, done: false, caption: '', found: 0, volume: 0, points: 0, total, camera(cam, target) { cam.position.set(C6[0], C6[2], -C6[1]); target.set(C6[3], C6[5], -C6[4]); } };
  const tags = list.map(({ v, i }) => { const t = view.tag('film' + i, 'film', 'scan-tag-film', view.V3(v.centre[0], v.centre[1], Math.max(v.topZ || 0, v.centre[2]) + 0.25), html(v)); t.film = true; return t; });
  const U = view.U, E = view.E, top = Math.min(b.max[2], z0 + 11), low = d.cut.z;

  function apply(t) {
    U.uBand.value = 1.9 - 1.62 * span(t, tOpen - 2.4, tOpen - 0.4) + (big ? 1.6 * span(t, tVoid + 1.6, tVoid + 3) : 0);
    const cap = t < tScan - 0.6 ? capAt(t) : null, s = passAt(t);
    U.uAgeK.value = s ? (s.b - s.a) / (s.t1 - s.t0) : 1; // the dust settles in screen seconds, whatever the replay speed
    if (cap != null) view.setReplay(cap); else if (S.live) view.setReplay(null);
    S.live = cap != null; S.points = view.frameCount;
    const open = span(t, tScan + 0.2, tOpen - 1.0), close = big ? span(t, tVoid + 1.6, tVoid + 6.0) : 0, y = top + (low - top) * open + (top - low) * close * 1.0;
    U.uCutOn.value = t > tScan && t < tVoid + 6.1 ? 1 : 0; U.uCutY.value = y;
    U.uOpen.value = span(t, tScan + 2.0, tOpen - 0.8) * (1 - span(t, tVoid + 2.4, tVoid + 5.2)); U.uLit.value = 1;
    let found = 0, vol = 0;
    for (const m of view.voidMeshes) m.solid.material.uniforms.uFill.value = m.ghost.material.uniforms.uFill.value = -1e6;
    list.forEach(({ v, i }, q) => {
      const t0 = tOpen + 0.9 + q * EACH, f = span(t, t0, t0 + 1.8), m = view.voidMeshes[i]; if (!m) return;
      const inside = q === 0 ? span(t, tVoid + 4.2, tVoid + 6.4) : span(t, tVoid + 1.0, tVoid + 3.0), fill = m.y0 - 0.1 + (m.y1 - m.y0 + 0.2) * f;
      m.solid.material.uniforms.uFill.value = m.ghost.material.uniforms.uFill.value = f > 0.001 ? fill : -1e6;
      m.solid.material.uniforms.uAlpha.value = 0.24 * (1 - inside * (q === 0 ? 0.3 : 0.8)); m.ghost.material.uniforms.uAlpha.value = 0.085 * (1 - inside * (q === 0 ? 0.5 : 1));
      m.halo.material.opacity = 0.10 * f * (1 - inside);
      if (i < 4) U.uVoidI.value[i] = f * (q === 0 ? 1 + 1.1 * inside : 1 - 0.8 * inside) * (0.92 + 0.08 * Math.sin(t * 1.3 + q));
      if (f > 0.55) { found++; vol += v.volume; }
      const tg = tags[q], show = f > 0.35 && t < tVoid + (q === 0 ? 3.4 : 1.4), here = t < t0 + EACH || t > tVoid - 1.4; tg.hidden = !show; const cls = 'scan-tag-film' + (here && show ? ' on' : ''); if (tg.cls !== cls) { tg.cls = cls; tg.el.className = 'scan-tag ' + cls; }
    });
    S.found = found; S.volume = vol;
    E.uFade.value = reduced ? 1 : clamp(t / 0.8) * (1 - span(t, total - 0.8, total));
    const act = t < tScan ? 'scan' : t < tOpen ? 'open' : t < tVoid ? 'voids' : 'inside';
    let cpt = act;
    if (act === 'scan') cpt = s ? s.p.id : 'all'; else if (act === 'voids') cpt = 'void' + Math.max(0, Math.min(list.length - 1, Math.floor((t - tOpen - 0.9) / EACH)));
    S.act = act; S.cpt = cpt; S.cur = act === 'voids' ? list[Math.max(0, Math.min(list.length - 1, Math.floor((t - tOpen - 0.9) / EACH)))] : big;
    sample(t); view.moteCentre(tmp.set(C6[0] * 0.4 + C6[3] * 0.6, C6[2] * 0.4 + C6[5] * 0.6, -(C6[1] * 0.4 + C6[4] * 0.6)));
  }
  const tmp = new THREE.Vector3();
  return {
    S, list, big,
    begin() { view.setStory(S); view.setMode('natural'); view.setVoidsVisible(true); S.t = reduced ? tOpen + 0.9 + list.length * EACH + 1 : 0; apply(S.t); },
    end() { view.setStory(null); view.setReplay(null); view.dropTags('film'); },
    go(id) { S.t = starts[id] ?? 0; S.paused = false; if (reduced) S.t = id === 'scan' ? tScan - 0.3 : id === 'open' ? tOpen : id === 'voids' ? tVoid - 1 : tVoid + 9; apply(S.t); },
    seek(t) { S.t = t; apply(t); },
    update(dt) {
      if (S.paused) { if (performance.now() - S.pausedAt > 7000) S.paused = false; return; }
      if (!reduced) { S.t += dt; if (S.t >= total) S.t = 0; }
      apply(S.t);
    },
    starts, total,
  };
}
