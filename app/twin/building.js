// Block B, the building being searched, built from world.WALLS at real scale: double-skin outer walls with barred
// window openings, plasterboard partitions, door frames and leaves, the concrete frame, room floors you can click,
// a roof slab that lifts away, and the see-through "x-ray" version of the walls.
import * as THREE from 'three';
import { box, cyl, worldUV, merge, mesh, tint, rng, tube, xform, clamp, smooth } from './util.js';

const H = 3.2, T_OUT = 0.32, T_IN = 0.14, DOOR_H = 2.1, SILL = 0.95, HEAD = 2.25;

export function build(env) {
  const { world, mats, tex, label, pickable, t } = env, R = rng('building');
  const group = new THREE.Group(); group.name = 'building-b';
  const B = world.BUILDING.rect, cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2;
  const G = { plaster: [], inner: [], cut: [], concrete: [], paint: [], wood: [], glass: [], steel: [] }, X = [];   // X: plain boxes for the x-ray version

  // ---- read the walls: axis, line, extent; find the door openings between collinear pieces ----
  const walls = world.WALLS.map((w) => { const hor = Math.abs(w.b[0] - w.a[0]) > Math.abs(w.b[1] - w.a[1]), i = hor ? 0 : 1; return { ...w, axis: hor ? 'x' : 'y', c: hor ? w.a[1] : w.a[0], p0: Math.min(w.a[i], w.b[i]), p1: Math.max(w.a[i], w.b[i]) }; });
  const lines = new Map();
  for (const w of walls) { const k = w.axis + w.c.toFixed(2); if (!lines.has(k)) lines.set(k, []); lines.get(k).push(w); }
  const openings = [], gapEnd = new Set(), ek = (w, p) => w.axis + w.c.toFixed(2) + ':' + p.toFixed(2);
  for (const list of lines.values()) {
    list.sort((a, b) => a.p0 - b.p0);
    for (let i = 0; i + 1 < list.length; i++) { const a = list[i], b = list[i + 1], gap = b.p0 - a.p1; if (gap > 0.5 && gap < 3) { openings.push({ axis: a.axis, c: a.c, p0: a.p1, p1: b.p0, mat: a.mat }); gapEnd.add(ek(a, a.p1)); gapEnd.add(ek(b, b.p0)); } }
  }
  const place = (g, axis, c, p, y) => (axis === 'x' ? g.translate(p, y, -c) : g.translate(c, y, -p));
  const along = (axis, c, p0, p1, y0, y1, thick, off = 0) => { const len = p1 - p0, g = axis === 'x' ? new THREE.BoxGeometry(len, y1 - y0, thick) : new THREE.BoxGeometry(thick, y1 - y0, len); return place(g, axis, c + off, (p0 + p1) / 2, (y0 + y1) / 2); };
  const inward = (axis, c) => (axis === 'x' ? Math.sign(cy - c) : Math.sign(cx - c));

  // ---- windows: every classroom gets barred openings in its outside wall ----
  const windows = [];
  function windowsFor(w) {
    const out = [];
    for (const r of world.ROOMS) {
      const [x0, y0, x1, y1] = r.rect, touches = w.axis === 'x' ? (Math.abs(y0 - w.c) < 0.01 || Math.abs(y1 - w.c) < 0.01) : (Math.abs(x0 - w.c) < 0.01 || Math.abs(x1 - w.c) < 0.01); if (!touches) continue;
      const a = Math.max(w.p0, w.axis === 'x' ? x0 : y0), b = Math.min(w.p1, w.axis === 'x' ? x1 : y1), len = b - a; if (len < 3.4) continue;
      if (r.corridor && len < 3.9) continue;
      const n = len >= 10 ? 3 : len >= 6.5 ? 2 : 1, ww = n === 1 && len < 5 ? 1.5 : 1.9;
      for (let i = 0; i < n; i++) { const c = a + (len * (i + 0.5)) / n; out.push({ p0: c - ww / 2, p1: c + ww / 2, glazed: R() < 0.45, cracked: R() < 0.5 }); }
    }
    return out.sort((p, q) => p.p0 - q.p0);
  }

  // ---- walls ----
  for (const w of walls) {
    if (w.state === 'collapsed') continue;
    const outer = w.mat === 'concrete', thick = outer ? T_OUT : T_IN, e0 = outer && !gapEnd.has(ek(w, w.p0)) ? thick / 2 : 0, e1 = outer && !gapEnd.has(ek(w, w.p1)) && !(w.axis === 'x' && w.p1 === 78) && !(w.axis === 'y' && w.p1 === 50) ? thick / 2 : 0;
    const p0 = w.p0 - e0, p1 = w.p1 + e1;
    if (w.state === 'damaged') { damagedWall(w); X.push(along(w.axis, w.c, p0, p1, 0, H, thick)); continue; }
    X.push(along(w.axis, w.c, p0, p1, 0, H, thick));
    G.cut.push(along(w.axis, w.c, p0, p1, H, H + 0.012, thick));
    if (!outer) { G.inner.push(along(w.axis, w.c, p0, p1, 0, H, thick)); continue; }
    const s = inward(w.axis, w.c), layers = [[G.plaster, 0.2, -s * 0.06], [G.inner, 0.12, s * 0.1]], wins = windowsFor(w);
    let at = p0;
    for (const win of wins) {
      for (const [list, th, off] of layers) { if (win.p0 > at) list.push(along(w.axis, w.c, at, win.p0, 0, H, th, off)); list.push(along(w.axis, w.c, win.p0, win.p1, 0, SILL, th, off), along(w.axis, w.c, win.p0, win.p1, HEAD, H, th, off)); }
      at = win.p1; windows.push({ ...win, axis: w.axis, c: w.c, s });
    }
    for (const [list, th, off] of layers) if (p1 > at) list.push(along(w.axis, w.c, at, p1, 0, H, th, off));
    G.concrete.push(along(w.axis, w.c, p0, p1, 0, 0.3, 0.07, -s * 0.185), along(w.axis, w.c, p0, p1, H - 0.26, H, 0.05, -s * 0.18));     // plinth and ring beam
  }
  // window units: frame, bars, a sill, and in some a pane of glass that survived
  const FRAME = 0x46545a, BAR = 0x2a2f33;
  for (const win of windows) {
    const { axis, c, s, p0, p1 } = win, mid = c - s * 0.03, wd = p1 - p0;
    for (const [a, b, y0, y1] of [[p0, p0 + 0.06, SILL, HEAD], [p1 - 0.06, p1, SILL, HEAD], [p0, p1, SILL, SILL + 0.06], [p0, p1, HEAD - 0.06, HEAD], [(p0 + p1) / 2 - 0.025, (p0 + p1) / 2 + 0.025, SILL, HEAD]]) G.paint.push(tint(along(axis, mid, a, b, y0, y1, 0.07), FRAME));
    const nb = Math.round(wd / 0.16);
    for (let i = 1; i < nb; i++) { const p = p0 + (wd * i) / nb; G.paint.push(tint(along(axis, c - s * 0.1, p - 0.008, p + 0.008, SILL + 0.04, HEAD - 0.04, 0.016), BAR)); }
    for (const y of [SILL + 0.42, HEAD - 0.42]) G.paint.push(tint(along(axis, c - s * 0.1, p0, p1, y - 0.012, y + 0.012, 0.022), BAR));
    G.concrete.push(along(axis, c - s * 0.2, p0 - 0.1, p1 + 0.1, SILL - 0.07, SILL, 0.14));
    if (win.glazed) { const half = (p0 + p1) / 2; G.glass.push(along(axis, mid, p0 + 0.06, half - 0.025, SILL + 0.06, win.cracked ? SILL + 0.5 + R() * 0.5 : HEAD - 0.06, 0.012)); if (!win.cracked || R() < 0.5) G.glass.push(along(axis, mid, half + 0.025, p1 - 0.06, SILL + 0.06, HEAD - 0.06, 0.012)); }
  }
  // the partition between 111 and 112 took the slide: panels snapped at different heights, studs showing
  function damagedWall(w) {
    const n = Math.round((w.p1 - w.p0) / 0.6), step = (w.p1 - w.p0) / n;
    for (let i = 0; i < n; i++) {
      const a = w.p0 + i * step, m = a + step / 2, hole = smooth(2.6, 0.4, Math.abs(m - 51.2)), hgt = clamp(H * (1 - hole * (0.55 + R() * 0.4)) - (R() < 0.3 ? R() * 0.5 : 0), 0.25, H), lean = (R() - 0.5) * 0.09 * (hgt < H ? 2.2 : 1);
      const g = new THREE.BoxGeometry(T_IN * 0.8, hgt, step - 0.012).translate(0, hgt / 2, 0); xform(g, w.c, 0, -m, 0, 0, lean); G.inner.push(g);
      if (hgt >= H - 0.01 && Math.abs(lean) < 0.03) G.cut.push(along('y', w.c, a, a + step, H, H + 0.012, T_IN));
      if (i % 2 === 0) G.steel.push(along('y', w.c, a - 0.02, a + 0.02, 0, H - (hole > 0.5 ? R() * 0.8 : 0), 0.05));
    }
    G.steel.push(along('y', w.c, w.p0, w.p1, H - 0.05, H, 0.06));
    for (let i = 0; i < 9; i++) { const g = new THREE.BoxGeometry(0.5 + R() * 0.6, 0.025, 0.4 + R() * 0.7); xform(g, w.c + (R() - 0.3) * 1.8, 0.03 + R() * 0.12, -(50 + R() * 2.6), R() * 3, (R() - 0.5) * 0.4, (R() - 0.5) * 0.5); G.inner.push(g); }
  }

  // ---- door openings: lintel, frame, leaf ----
  const doors = world.DOORS, JAMB = 0x57666c;
  for (const o of openings) {
    const outer = o.mat === 'concrete', thick = outer ? T_OUT : T_IN, top = outer ? 2.5 : DOOR_H, s = inward(o.axis, o.c);
    if (outer) { G.plaster.push(along(o.axis, o.c, o.p0, o.p1, top, H, 0.2, -s * 0.06)); G.inner.push(along(o.axis, o.c, o.p0, o.p1, top, H, 0.12, s * 0.1)); G.concrete.push(along(o.axis, o.c, o.p0, o.p1, H - 0.26, H, 0.05, -s * 0.18)); }
    else G.inner.push(along(o.axis, o.c, o.p0, o.p1, top, H, thick));
    G.cut.push(along(o.axis, o.c, o.p0, o.p1, H, H + 0.012, thick)); X.push(along(o.axis, o.c, o.p0, o.p1, top, H, thick));
    const fc = outer ? 0x2f3438 : JAMB, fd = thick + 0.05;
    G.paint.push(tint(along(o.axis, o.c, o.p0, o.p0 + 0.07, 0, top, fd), fc), tint(along(o.axis, o.c, o.p1 - 0.07, o.p1, 0, top, fd), fc), tint(along(o.axis, o.c, o.p0, o.p1, top - 0.07, top, fd), fc));
    const mid = (o.p0 + o.p1) / 2, door = doors.find((d) => Math.abs((o.axis === 'x' ? d.pos[0] : d.pos[1]) - mid) < 0.3 && Math.abs((o.axis === 'x' ? d.pos[1] : d.pos[0]) - o.c) < 0.3);
    if (!door) continue;
    const wd = o.p1 - o.p0 - 0.14;
    if (door.id === 'entrance') {                                   // double steel doors: one stands open, one is off its hinges
      const lw = wd / 2, g = new THREE.BoxGeometry(lw, 2.38, 0.05).translate(lw / 2, 1.2, 0); xform(g, o.p0 + 0.07, 0.01, -o.c, 1.9); G.paint.push(tint(g, 0x3a4349));
      const g2 = new THREE.BoxGeometry(lw, 2.38, 0.05); xform(g2, o.p1 + 1.5, 0.07, -(o.c + 3.4), 0.5, Math.PI / 2 - 0.05, 0); G.paint.push(tint(g2, 0x3a4349));
      continue;
    }
    const room = world.roomById(door.room), into = room ? Math.sign((room.rect[1] + room.rect[3]) / 2 - o.c) : 1;    // +1: the room is north of the wall
    const swing = door.blocked ? 0.14 : 1.45 + R() * 0.5, g = new THREE.BoxGeometry(wd, 2.03, 0.045).translate(wd / 2, 1.025, 0);
    xform(g, o.p0 + 0.07, 0.012, -o.c, into * swing, 0, door.blocked ? 0.03 : 0); G.wood.push(worldUV(g, 0.8));
  }

  // ---- the concrete frame ----
  const cols = [[44, 30], [84, 30], [44, 58], [53, 30], [62, 30], [66, 30], [75, 30], [53, 58], [62, 58], [66, 58], [75, 58], [44, 42], [44, 46], [84, 42], [84, 46]];
  for (const [x, y] of cols) { G.concrete.push(box(0.46, H, 0.46, x, 0, -y)); G.cut.push(box(0.46, 0.014, 0.46, x, H, -y)); X.push(box(0.46, H, 0.46, x, 0, -y)); }
  // broken ends of the outer walls where the north-east corner came down, and what is left of the corner column
  for (const [axis, c, from, dir] of [['x', 58, 78, 1], ['y', 84, 50, 1]]) { let p = from; for (const hh of [2.7, 2.1, 1.25, 0.6]) { const wdt = 0.35 + R() * 0.4; G.concrete.push(along(axis, c, p, p + wdt * dir, 0, hh + R() * 0.25, T_OUT * (0.85 + R() * 0.2))); p += wdt * dir; } }
  G.concrete.push(xform(new THREE.BoxGeometry(0.46, 1.3, 0.46).translate(0, 0.65, 0), 84.1, 0, -58.05, 0.3, 0.16, -0.22));

  // entrance canopy and sign
  G.concrete.push(box(4.2, 0.14, 2.2, 64, 2.62, -28.95), box(4.2, 0.3, 0.12, 64, 2.62, -27.9));
  for (const x of [62.15, 65.85]) G.steel.push(cyl(0.045, 0.045, 2.62, x, 0, -28.05, 8));
  G.concrete.push(box(3.4, 0.05, 1.5, 64, 0, -29.1));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshStandardMaterial({ map: tex.sign('BLOCK B'), roughness: 0.7 })); sign.position.set(64, 2.98, -27.83); group.add(sign);

  // a tin awning beside the entrance that has let go of one post
  { const pg = new THREE.PlaneGeometry(5.2, 2.0, 26, 8).rotateX(-Math.PI / 2), p = pg.attributes.position; for (let i = 0; i < p.count; i++) { const u = p.getX(i) / 5.2 + 0.5, v = p.getZ(i) / 2 + 0.5; p.setY(i, 2.75 - v * 0.35 - u * u * v * 1.5 - Math.sin(u * 9) * 0.03 * v); } pg.computeVertexNormals(); const aw = mesh(pg, mats.cgi, { name: 'awning' }); aw.position.set(70.2, 0, -28.75); group.add(aw); G.steel.push(cyl(0.04, 0.04, 2.4, 67.8, 0, -27.8, 8), xform(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 8), 72.6, 0.42, -27.5, 0.4, 0, 1.25)); }
  { const c = document.createElement('canvas'); c.width = 512; c.height = 300; const g2 = c.getContext('2d'); g2.fillStyle = '#3d3327'; g2.fillRect(0, 0, 512, 300); g2.fillStyle = '#6d5a44'; g2.fillRect(14, 14, 484, 272); const RP = rng('notices'); for (let i = 0; i < 15; i++) { const px = 24 + RP() * 400, py = 22 + RP() * 190, w2 = 40 + RP() * 46, h2 = 54 + RP() * 40; g2.save(); g2.translate(px, py); g2.rotate(RP.gauss() * 0.08); g2.fillStyle = ['#d8d2c2', '#c9c3b0', '#b9c0b8', '#d5c7a2'][i % 4]; g2.fillRect(0, 0, w2, h2); g2.fillStyle = 'rgba(40,40,44,.55)'; for (let l = 0; l < 7; l++) g2.fillRect(5, 7 + l * 7, w2 * (0.4 + RP() * 0.45), 2); g2.restore(); } const gr = g2.createLinearGradient(0, 120, 0, 300); gr.addColorStop(0, 'rgba(60,45,30,0)'); gr.addColorStop(1, 'rgba(60,45,30,.9)'); g2.fillStyle = gr; g2.fillRect(0, 0, 512, 300); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; const nb = mesh(new THREE.BoxGeometry(2.1, 1.25, 0.06), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.9 }), { name: 'notice-board' }); nb.position.set(60.4, 1.55, -29.8); group.add(nb); }
  // ---- assemble the solid walls. Own material copies, so they can fade for the x-ray without touching the rest of the site. ----
  const solid = new THREE.Group(); solid.name = 'walls'; group.add(solid);
  const own = {}, RV = { uC: { value: new THREE.Vector2(64, -44) }, uR: { value: 0 }, uS: { value: 1.3 }, uRimK: { value: 1 } };
  // Walls inside a circle turn to glass; the roof dissolves along a moving edge. Both edges carry a thin line of light.
  const NOISE = 'float bh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } float bn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(bh(i), bh(i + vec2(1, 0)), f.x), mix(bh(i + vec2(0, 1)), bh(i + vec2(1, 1)), f.x), f.y); }';
  function reveal(m, kind) {
    const prev = m.onBeforeCompile, pk = m.customProgramCacheKey;
    m.onBeforeCompile = (sh, r) => { prev && prev.call(m, sh, r); Object.assign(sh.uniforms, RV);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRW;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vRW = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRW; uniform vec2 uC; uniform float uR, uS, uRimK; ' + NOISE)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + (kind === 'roof'
          ? 'float rvD = uS - ((vRW.x - 44.0) / 40.0 * 0.8 + (-vRW.z - 30.0) / 28.0 * 0.2) - (bn(vRW.xz * 0.9) - 0.5) * 0.10 - (bn(vRW.xz * 5.0) - 0.5) * 0.025; if (rvD < 0.0) discard; rvD *= 40.0;'
          : 'float rvD = length(vRW.xz - uC) - uR + (bn(vec2(vRW.x + vRW.z, vRW.y) * 2.2) - 0.5) * 0.22 - vRW.y * 0.12; if (uR > 0.01 && rvD < 0.0) discard; if (uR < 0.01) rvD = 9.0;'))
        .replace('#include <opaque_fragment>', 'float rvG = fwidth(rvD) / max(length(fwidth(vRW)), 1e-4); rvD /= clamp(rvG, 0.12, 1.5); outgoingLight += vec3(0.55, 0.8, 1.0) * (exp(-rvD * 34.0) * 1.1 + exp(-rvD * 6.0) * 0.07) * uRimK;\n#include <opaque_fragment>'); };
    m.customProgramCacheKey = () => 'rv-' + kind + (pk ? pk.call(m) : ''); m.side = THREE.DoubleSide; return m;
  }
  const depthRoof = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depthRoof.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, RV); sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRW;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vRW = (modelMatrix * vec4(position, 1.0)).xyz;'); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRW; uniform float uS;').replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (uS < (vRW.x - 44.0) / 40.0 * 0.8 + (-vRW.z - 30.0) / 28.0 * 0.2) discard;'); };
  for (const [k, src, uv] of [['plaster', mats.plaster, [1 / 8, 1 / 4]], ['inner', mats.inner, [1 / 8, 1 / 4]], ['cut', mats.cut, null], ['concrete', mats.concrete, [0.3, 0.3]], ['paint', mats.paint, null], ['wood', mats.wood, 'keep'], ['glass', mats.glass, null], ['steel', mats.steel, null]]) {
    if (!G[k].length) continue;
    const list = uv && uv !== 'keep' ? G[k].map((g) => worldUV(g, uv[0], uv[1])) : G[k];
    own[k] = reveal(src.clone(), 'wall'); const m = mesh(merge(list, { keepUV: !!uv, keepColor: k === 'paint' }), own[k], { name: 'walls-' + k, cast: k !== 'cut' && k !== 'glass' }); solid.add(m);
  }

  // ---- x-ray: the same walls as a translucent, edge-lit blueprint ----
  const xgeo = merge(X, { keepUV: false, keepColor: false });
  const XV = 'varying vec3 vN; varying vec3 vV; varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }';
  const xmat = new THREE.ShaderMaterial({
    uniforms: { ...RV, uTime: { value: 0 }, uSun: { value: new THREE.Color(1, 0.7, 0.45) }, uSky: { value: new THREE.Color(0.3, 0.42, 0.6) }, uSunDir: { value: new THREE.Vector3(1, 0.4, 0) } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, vertexShader: XV.replace('vN = normalMatrix * normal;', 'vN = normalMatrix * normal; vWN = normal;').replace('varying vec3 vN;', 'varying vec3 vN; varying vec3 vWN;'),
    // glass, not a ghost: it thickens at grazing angles, picks up the sky, and carries a highlight from the sun
    fragmentShader: `uniform vec2 uC; uniform float uR, uTime; uniform vec3 uSun, uSky, uSunDir; varying vec3 vN; varying vec3 vWN; varying vec3 vV; varying vec3 vW; `+NOISE+`
      void main() { float edge = uR - length(vW.xz - uC) + vW.y * 0.12; if (edge < -0.25) discard; float in_ = smoothstep(-0.2, 0.5, edge);
        vec3 V = normalize(vW - cameraPosition), N = normalize(vWN); float f = pow(1.0 - abs(dot(N, V)), 3.0); vec3 R = reflect(V, N);
        float sp = pow(max(dot(R, uSunDir), 0.0), 60.0); float sky = smoothstep(-0.2, 0.6, R.y + (bn(vW.xy * 0.4 + vW.z * 0.4) - 0.5) * 0.4);
        float top = smoothstep(3.16, 3.2, vW.y), smear = 0.75 + 0.5 * bn(vec2((vW.x + vW.z) * 0.9, vW.y * 2.5));
        vec3 c = mix(vec3(0.012, 0.022, 0.034), uSky * 0.9, f * 0.8 + sky * 0.12) * smear + uSun * sp * 2.0 + vec3(0.5, 0.75, 1.0) * top * 0.4;
        float wave = exp(-pow((fract(uTime * 0.22) * (uR + 2.0) - length(vW.xz - uC)) * 2.2, 2.0)) * step(uR, 40.0); c += vec3(0.25, 0.5, 0.8) * wave * 0.35;
        float a = (0.10 + 0.5 * f + 0.3 * top + sp * 0.6 + wave * 0.12) * in_; gl_FragColor = vec4(c, clamp(a, 0.0, 0.85)); }`,
  });
  const xray = new THREE.Mesh(xgeo, xmat); xray.visible = false; xray.renderOrder = 6; xray.name = 'walls-xray';
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(xgeo, 30), new THREE.ShaderMaterial({ uniforms: RV, transparent: true, depthWrite: false, vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }', fragmentShader: 'uniform vec2 uC; uniform float uR; varying vec3 vW; void main() { float e = smoothstep(-0.2, 0.5, uR - length(vW.xz - uC) + vW.y * 0.12); if (e < 0.01) discard; gl_FragColor = vec4(vec3(0.5, 0.7, 0.92) * 0.8, e * (0.16 + 0.34 * smoothstep(3.0, 3.2, vW.y))); }' })); edges.visible = false; edges.renderOrder = 7;
  group.add(xray, edges);

  // ---- floors: one per room, clickable ----
  const floorMat = mats.floor.clone(), hallMat = mats.floor.clone(); hallMat.color.set(0xc9c4ba);
  for (const m of [floorMat, hallMat]) {
    m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1;
    m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRW;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vRW = (modelMatrix * vec4(position, 1.0)).xyz;'); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRW; ' + NOISE).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n float fw = smoothstep(0.46, 0.6, bn(vRW.xz * 0.42) * 0.65 + bn(vRW.xz * 1.6) * 0.35); roughnessFactor = mix(roughnessFactor, 0.06, fw); diffuseColor.rgb *= mix(1.0, 0.5, fw);').replace('#include <opaque_fragment>', '#include <opaque_fragment>\n gl_FragColor.a = 1.0 - fw;'); };
    m.customProgramCacheKey = () => 'bld-floor';
  }
  const floors = new Map(), roomLabels = [];
  for (const r of world.ROOMS) {
    const [x0, y0, x1, y1] = r.rect, g = worldUV(new THREE.PlaneGeometry(x1 - x0, y1 - y0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0.014, -(y0 + y1) / 2), 0.25);
    const m = mesh(g, r.corridor ? hallMat : floorMat, { cast: false, name: 'floor-' + r.id });
    pickable(m, { type: 'room', id: r.id }); group.add(m); floors.set(r.id, m);
    roomLabels.push(label(r.corridor ? r.name : r.id, { plain: true, priority: r.corridor ? 0 : 1, maxDist: r.corridor ? 60 : 140, position: new THREE.Vector3((x0 + x1) / 2, 0.05, -(y0 + y1) / 2 - (r.corridor ? 0 : (y1 - y0) * 0.32 * Math.sign(cy - (y0 + y1) / 2))) }));
  }
  label('Block B', { sub: 'Search target. School, one storey', priority: 4, maxDist: 420, minDist: 40, position: new THREE.Vector3(64, 4.6, -29) });
  const ring = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3)), new THREE.LineBasicMaterial({ color: new THREE.Color(0.35, 0.66, 1.0).multiplyScalar(1.8), fog: false })); ring.visible = false; ring.frustumCulled = false; group.add(ring);

  // ---- the roof: a flat concrete slab with a parapet, water tanks and the stair head; the north-east corner is gone ----
  const roof = new THREE.Group(); roof.name = 'roof'; group.add(roof);
  const o = 0.45, jag = [[84.45, 49.2], [83.2, 50.1], [83.6, 51.2], [82.1, 51.9], [82.4, 53.3], [80.9, 54.0], [81.0, 55.6], [79.6, 56.2], [79.2, 57.4], [78.0, 57.8], [77.6, 58.45]];
  const outline = [[B[0] - o, B[1] - o], [B[2] + o, B[1] - o], ...jag, [B[0] - o, B[3] + o]];
  const slabG = new THREE.ExtrudeGeometry(new THREE.Shape(outline.map((p) => new THREE.Vector2(p[0], p[1]))), { depth: 0.2, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, H + 0.014, 0);
  const RG = { concrete: [worldUV(slabG, 0.25)], plaster: [], paint: [], steel: [], rebar: [], cgi: [] }, top = H + 0.214;
  for (const [axis, c, p0, p1] of [['x', B[1] - o + 0.08, B[0] - o, B[2] + o], ['y', B[0] - o + 0.08, B[1] - o, B[3] + o], ['x', B[3] + o - 0.08, B[0] - o, 77.6], ['y', B[2] + o - 0.08, B[1] - o, 49.2]]) RG.plaster.push(worldUV(along(axis, c, p0, p1, top, top + 0.55, 0.16), 1 / 8, 1 / 4), worldUV(along(axis, c, p0, p1, top + 0.55, top + 0.6, 0.22), 1 / 8, 1 / 4));
  RG.plaster.push(worldUV(box(3.7, 2.5, 4.9, 64, top, -55.3), 1 / 8, 1 / 4)); RG.concrete.push(worldUV(box(4.1, 0.14, 5.3, 64, top + 2.5, -55.3), 0.25)); RG.paint.push(tint(box(0.95, 2.0, 0.06, 64, top, -52.83), 0x3a4349));
  for (const [x, y, s] of [[49.5, 53.5, 1], [51.4, 53.3, 0.82], [71, 33.2, 1]]) {                               // black water tanks on low stands
    RG.concrete.push(worldUV(box(1.5 * s, 0.35, 1.5 * s, x, top, -y), 0.3));
    RG.paint.push(tint(cyl(0.6 * s, 0.62 * s, 1.25 * s, x, top + 0.35, -y, 20), 0x1c1f22), tint(cyl(0.2 * s, 0.56 * s, 0.22 * s, x, top + 0.35 + 1.25 * s, -y, 20), 0x1c1f22), tint(cyl(0.13 * s, 0.13 * s, 0.07, x, top + 0.35 + 1.47 * s, -y, 12), 0x24282c));
    for (const k of [0.35, 0.7, 1.05]) RG.paint.push(tint(xform(new THREE.TorusGeometry(0.615 * s, 0.022, 5, 22).rotateX(Math.PI / 2), x, top + 0.35 + k * s, -y), 0x1c1f22));
  }
  RG.steel.push(tube([new THREE.Vector3(50.1, top + 0.5, -53.4), new THREE.Vector3(53, top + 0.08, -52), new THREE.Vector3(60, top + 0.06, -51.2), new THREE.Vector3(62.2, top + 0.06, -53)], 0.03), tube([new THREE.Vector3(71.5, top + 0.5, -33.4), new THREE.Vector3(74, top + 0.06, -35), new THREE.Vector3(74.4, top + 0.06, -41)], 0.03));
  for (let i = 0; i < 5; i++) { const sx = 56 + R() * 20, sy = 36 + R() * 14, ry = R() * 3, g = new THREE.PlaneGeometry(0.9, 2.2 + R() * 0.8, 1, 1).rotateX(-Math.PI / 2); xform(g, sx, top + 0.03 + i * 0.012, -sy, ry, (R() - 0.5) * 0.06, 0); RG.cgi.push(g); RG.concrete.push(worldUV(box(0.22, 0.1, 0.11, sx + 0.2, top + 0.04, -sy, ry + 0.4), 0.3)); }
  for (let i = 0; i < jag.length - 1; i++) for (let k = 0; k < 2; k++) {                                         // reinforcing bars torn out of the broken edge
    const a = jag[i], b = jag[i + 1], u = 0.2 + R() * 0.6, x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u, len = 0.5 + R() * 1.3, dx = 0.6 + R() * 0.5, dy = 0.5 + R() * 0.6, yy = H + 0.06 + R() * 0.1;
    RG.rebar.push(tube([new THREE.Vector3(x - dx * 0.2, yy, -(y - dy * 0.2)), new THREE.Vector3(x + dx * len * 0.4, yy - 0.05, -(y + dy * len * 0.4)), new THREE.Vector3(x + dx * len * 0.8 + R.gauss() * 0.2, yy - 0.3 - R() * 0.5, -(y + dy * len * 0.8)), new THREE.Vector3(x + dx * len + R.gauss() * 0.3, yy - 0.7 - R() * 0.9, -(y + dy * len + R.gauss() * 0.3))], 0.011, { radial: 4 }));
  }
  RG.concrete.push(worldUV(xform(new THREE.BoxGeometry(3.4, 0.2, 2.5).translate(1.7, -0.1, 0), 80.6, H + 0.2, -54.9, -0.75, 0, -0.82), 0.25));  // a hinged piece of slab hanging into the rubble
  const roofMats = [];
  for (const [k, src] of [['concrete', mats.concreteDark], ['plaster', mats.plaster], ['paint', mats.paint], ['steel', mats.steel], ['rebar', mats.rebar], ['cgi', mats.cgi]]) { if (!RG[k].length) continue; const m = reveal(src.clone(), 'roof'); roofMats.push(m); const rm = mesh(merge(RG[k], { keepUV: k !== 'paint' && k !== 'steel' && k !== 'rebar', keepColor: k === 'paint' }), m, { name: 'roof-' + k }); rm.customDepthMaterial = depthRoof; roof.add(rm); }

  // ---- layers and animation ----
  let wantX = false, wantRoof = true, rk = 0, first = true, cMoving = false; const RALL = 60, cGoal = new THREE.Vector2(64, -44);
  const solidMats = Object.values(own), spring = { r: 0, v: 0 };
  function apply() {
    const x = spring.r > 0.02; RV.uR.value = x ? spring.r : 0; xray.visible = edges.visible = x; solid.visible = spring.r < RALL - 1;
    const cast = spring.r < 25; for (const q of solid.children) q.castShadow = cast && q.name !== 'walls-cut' && q.name !== 'walls-glass';
    const e = rk * rk * (3 - 2 * rk); RV.uS.value = 1.3 - e * 1.6; roof.visible = rk < 0.995;
    for (const l of roomLabels) l.setVisible(rk > 0.5);
  }
  apply();
  return {
    group, floors,
    setLayer(id, on) { if (id === 'walls-xray') wantX = !!on; else if (id === 'roof') wantRoof = !!on; },
    onSelect(sel) {
      const r = sel && sel.type === 'room' && world.roomById(sel.id); ring.visible = !!r; if (!r) return;
      const [x0, y0, x1, y1] = r.rect, i = 0.12, a = ring.geometry.attributes.position; a.setXYZ(0, x0 + i, 0.06, -(y0 + i)); a.setXYZ(1, x1 - i, 0.06, -(y0 + i)); a.setXYZ(2, x1 - i, 0.06, -(y1 - i)); a.setXYZ(3, x0 + i, 0.06, -(y1 - i)); a.needsUpdate = true;
    },
    update(dt, time, S, cams) {
      // the whole building, or just the few metres the rover is listening through
      const gl = cams && cams.glass; let goal = 0;
      if (wantX) { goal = RALL; if (spring.r < 0.05 && gl) RV.uC.value.set(gl.x, gl.z); } else if (gl && gl.r > 0) { goal = gl.r; cGoal.set(gl.x, gl.z); if (spring.r < 0.3) RV.uC.value.copy(cGoal); else RV.uC.value.lerp(cGoal, 1 - Math.exp(-2.2 * dt)); }
      const tr = wantRoof && !wantX ? 0 : 1; xmat.uniforms.uTime.value = t.reduced ? 0 : time;
      if (t.light) { xmat.uniforms.uSunDir.value.copy(t.light.sunDir); xmat.uniforms.uSun.value.copy(t.light.sunColor); xmat.uniforms.uSky.value.copy(t.light.hemi.color).multiplyScalar(0.8); }
      if (t.reduced || first) { spring.r = goal; spring.v = 0; rk = tr; first = false; apply(); return; }
      if (Math.abs(spring.r - goal) < 0.004 && Math.abs(spring.v) < 0.01 && rk === tr) { if (spring.r !== goal) { spring.r = goal; apply(); } return; }
      const w = goal > spring.r ? 2.6 : 3.4, k = Math.exp(-w * dt), d = spring.r - goal, q = (spring.v + w * d) * dt; spring.v = (spring.v - w * q) * k; spring.r = goal + (d + q) * k;
      rk = clamp(rk + Math.sign(tr - rk) * dt / 2.4, 0, 1); if (Math.abs(rk - tr) < 0.005) rk = tr;
      apply();
    },
    dispose() { for (const m of [...solidMats, ...roofMats, depthRoof, floorMat, hallMat, xmat, edges.material, ring.material, sign.material]) m.dispose(); },
  };
}
