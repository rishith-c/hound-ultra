// The drone's point cloud. Points are generated once (seeded) on the surfaces a camera sees from above; the GPU
// reveals them swath by swath, exactly as state.map.swaths grows, and the cloud settles away when the map is ready.
//   instance.show(true) forces the whole cloud visible at a steady opacity (for a "show scan" control).
// Display convention: the active swath's front edge follows the drawn (eased) drone, like drone.js.
import { palette, damp, clamp, mulberry32, stateWatcher, disposeTree } from './common.js';

const chase = (speed) => 10 + 1.2 * (speed || 1);      // the same easing as the drone actor, so the two stay together
const FRESH_LEN = 12;                                   // metres behind the scan line over which new points drop in

function inPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function edgeDist(x, y, poly) { let m = Infinity; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[j], b = poly[i], dx = b[0] - a[0], dy = b[1] - a[1], k = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1))); m = Math.min(m, Math.hypot(x - a[0] - dx * k, y - a[1] - dy * k)); } return m; }
function bbox(poly) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return [x0, y0, x1, y1]; }

function generate(world, N) {
  const rnd = mulberry32(world.SEED), S = world.SITE, B = world.BUILDING.rect, BH = world.BUILDING.wallHeight;
  const hs = world.SEED % 9973;
  const hash = (i, j) => { let h = Math.imul(i * 374761393 + j * 668265263 + hs, 1274126177); h ^= h >>> 13; h = Math.imul(h, 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const noise = (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  const blds = world.OBSTACLES.filter((o) => o.kind === 'building').map((o) => ({ o, r: bbox(o.poly) }));
  const rubble = world.OBSTACLES.filter((o) => o.kind === 'rubble').map((o) => ({ o, r: bbox(o.poly), soft: o.passable ? 2.6 : 1.5 }));
  const inRect = (x, y, r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
  // Where building B's roof has gone: the collapsed north-east corner, with a ragged edge.
  const hole = (x, y) => Math.hypot((B[2] - x) / 7.6, (B[3] - y) / 9.4) + 0.22 * (noise(x * 0.55, y * 0.55) - 0.5);
  const mound = (x, y) => { let h = 0; for (const m of rubble) { if (!inRect(x, y, m.r) || !inPoly(x, y, m.o.poly)) continue; const k = Math.min(1, edgeDist(x, y, m.o.poly) / m.soft), e = k * k * (3 - 2 * k); h = Math.max(h, m.o.h * e * (0.5 + 0.5 * noise(x * 0.9 + 7, y * 0.9)) + 0.12 * noise(x * 3.1, y * 3.1) * e); } return h; };
  const ground = (x, y) => 0.03 + 0.08 * noise(x * 0.13, y * 0.13) + 0.035 * noise(x * 1.1, y * 1.1) + mound(x, y);
  const roofBoxes = [[13, 47, 18, 52, 1.3], [25, 60, 30.5, 63.5, 0.9], [98, 30, 102, 34, 1.1]];

  const pos = new Float32Array(N * 3), rand = new Float32Array(N); let n = 0;
  const put = (x, y, h) => { if (n >= N) return; pos[n * 3] = x; pos[n * 3 + 1] = h; pos[n * 3 + 2] = -y; rand[n] = rnd(); n++; };
  const fill = (count, fn) => { const end = Math.min(N, n + Math.round(count)); let guard = count * 40; while (n < end && guard-- > 0) fn(); };

  // roofs and upper walls of the standing buildings
  for (const { o, r } of blds) {
    const area = (r[2] - r[0]) * (r[3] - r[1]), damaged = /damaged/i.test(o.name);
    fill(N * 0.000105 * area, () => {
      const x = r[0] + rnd() * (r[2] - r[0]), y = r[1] + rnd() * (r[3] - r[1]); let h = o.h + 0.02 * rnd();
      for (const b of roofBoxes) if (inRect(x, y, b)) h += b[4];
      if (damaged) h -= Math.max(0, noise(x * 0.11 + 3, y * 0.11) - 0.6) * 5.5;            // a sagging section
      put(x, y, h);
    });
    const per = 2 * (r[2] - r[0] + r[3] - r[1]);
    fill(N * 0.00042 * per, () => {
      let d = rnd() * per, x, y; const w = r[2] - r[0], hgt = r[3] - r[1], off = 0.04;
      if (d < w) { x = r[0] + d; y = r[1] - off; } else if ((d -= w) < hgt) { x = r[2] + off; y = r[1] + d; } else if ((d -= hgt) < w) { x = r[2] - d; y = r[3] + off; } else { x = r[0] - off; y = r[3] - (d - w); }
      const k = rnd(); put(x, y, o.h * (1 - 0.7 * k * k) + (k < 0.12 ? 0.28 : 0));                       // denser near the top, a low parapet
    });
    for (const b of roofBoxes) if (inRect(b[0], b[1], r)) fill(N * 0.0011 * 2 * (b[2] - b[0] + b[3] - b[1]), () => { const side = rnd() < 0.5, k = rnd(); put(side ? b[0] + k * (b[2] - b[0]) : (rnd() < 0.5 ? b[0] : b[2]), side ? (rnd() < 0.5 ? b[1] : b[3]) : b[1] + k * (b[3] - b[1]), o.h + rnd() * b[4]); });
  }
  // building B: the roof (sagging toward the break), the tops and outer faces of the concrete walls
  fill(N * 0.19, () => {
    const x = B[0] + rnd() * (B[2] - B[0]), y = B[1] + rnd() * (B[3] - B[1]), d = hole(x, y); if (d < 1) return;
    const sag = d < 1.4 ? (1.4 - d) / 0.4 : 0; put(x, y, BH + 0.02 * rnd() - sag * sag * 1.1 + 0.05 * noise(x * 2, y * 2) * sag);
  });
  const outer = world.WALLS.filter((w) => w.mat === 'concrete' && w.state !== 'collapsed'); let outerLen = 0; for (const w of outer) outerLen += Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2;
  fill(N * 0.06, () => {
    let d = rnd() * outerLen, w = outer[0]; for (const o of outer) { const l = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]); if (d <= l) { w = o; break; } d -= l; }
    const l = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1, ux = (w.b[0] - w.a[0]) / l, uy = (w.b[1] - w.a[1]) / l; let nx = -uy, ny = ux;
    const px = w.a[0] + ux * d, py = w.a[1] + uy * d; if ((px - cx) * nx + (py - cy) * ny < 0) { nx = -nx; ny = -ny; }                    // outward
    if (rnd() < 0.45) { const s = (rnd() - 0.5) * 0.3; put(px + nx * s, py + ny * s, BH + 0.03); } else { const k = rnd(); put(px + nx * 0.17, py + ny * 0.17, BH * (1 - 0.75 * k * k)); }
  });
  // rubble that the camera can see (not the pile under B's roof), as lumpy mounds
  for (const m of rubble) {
    const r = m.r, area = (r[2] - r[0]) * (r[3] - r[1]);
    fill(N * 0.00034 * area, () => { const x = r[0] + rnd() * (r[2] - r[0]), y = r[1] + rnd() * (r[3] - r[1]); if (!inPoly(x, y, m.o.poly)) return; if (inRect(x, y, B) && hole(x, y) >= 1) return; put(x, y, ground(x, y)); });
  }
  // open ground for whatever is left
  fill(N - n, () => {
    const x = rnd() * S.w, y = rnd() * S.h;
    for (const b of blds) if (inRect(x, y, b.r)) return;
    if (inRect(x, y, B) && hole(x, y) >= 1) return;
    put(x, y, ground(x, y));
  });
  return { pos: n < N ? pos.slice(0, n * 3) : pos, rand: n < N ? rand.slice(0, n) : rand, count: n };
}

export default {
  id: 'scan', layers: ['scan'],
  create(t) {
    const { THREE } = t, pal = palette(t), world = t.world;
    const data = generate(world, t.quality === 'low' ? 35000 : 110000);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.pos, 3)); geo.setAttribute('aRand', new THREE.BufferAttribute(data.rand, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(world.SITE.w / 2, 3, -world.SITE.h / 2), Math.hypot(world.SITE.w, world.SITE.h) / 2 + 6);
    const sw = []; for (let i = 0; i < 5; i++) sw.push(new THREE.Vector4(0, 0, 0, 0));
    const U = {
      uSw: { value: sw }, uLead: { value: new THREE.Vector4(0, 0, 1, 0) }, uAct: { value: -1 }, uLeadHalf: { value: 11 },
      uScan: { value: pal.scan }, uAccent: { value: pal.accent }, uPx: { value: 1000 }, uSize: { value: t.quality === 'low' ? 0.17 : 0.12 },
      uSettle: { value: 0 }, uShow: { value: 0 }, uDrop: { value: t.reduced ? 0 : 1 }, uPlain: { value: t.reduced ? 1 : 0 }, uOpacity: { value: 0.9 }, uFreshLen: { value: FRESH_LEN },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: U,
      vertexShader: [
        'attribute float aRand;',
        'uniform vec4 uSw[5]; uniform vec4 uLead; uniform int uAct; uniform float uLeadHalf, uPx, uSize, uSettle, uShow, uDrop, uPlain, uOpacity, uFreshLen;',
        'uniform vec3 uScan, uAccent; varying vec4 vCol;',
        'void main(){',
        '  vec3 p = position; float wx = p.x, wy = -p.z;',
        '  float mine = 0.0, other = uShow;',                                       // inside the active swath / inside any finished one
        '  for (int i = 0; i < 5; i++) { vec4 s = uSw[i]; if (s.w > 0.0 && abs(wy - s.x) <= s.w && wx >= s.y && wx <= s.z) { if (i == uAct) mine = 1.0; else other = 1.0; } }',
        '  if (mine + other < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec4(0.0); return; }',
        '  float fresh = 0.0;',
        '  if (uLead.w > 0.5 && other < 0.5) { float d = (uLead.x - wx) * uLead.z; fresh = 1.0 - smoothstep(0.0, uFreshLen, d * (0.65 + 0.7 * aRand)); }',
        '  p.y += uDrop * fresh * fresh * (1.6 + 1.6 * aRand);',                     // eases down into place behind the scan line
        '  float s = uShow > 0.5 ? 0.0 : clamp(uSettle * 1.55 - aRand * 0.55, 0.0, 1.0);',
        '  float shrink = mix(1.0 - s * s, 1.0, uPlain), fade = mix(1.0 - s, 1.0 - uSettle, uPlain);',
        '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
        '  float raw = uSize * (1.0 + 1.1 * fresh * uDrop) * shrink * uPx / -mv.z;',
        '  gl_PointSize = clamp(raw, 1.4, 9.0);',
        '  float hk = pow(clamp(p.y / 7.0, 0.0, 1.0), 0.62);',
        '  vec3 lowC = mix(vec3(0.055, 0.075, 0.105), uAccent, 0.16), midC = mix(uAccent, uScan, 0.35) * 0.5;',
        '  vec3 col = mix(lowC, midC, smoothstep(0.0, 0.55, hk)); col = mix(col, uScan * 0.82, smoothstep(0.45, 1.0, hk));',
        '  col *= 0.72 + 0.5 * aRand;',
        '  col = mix(col, uScan * 1.35, fresh * fresh * fresh);',
        '  vCol = vec4(col, uOpacity * fade * clamp(raw / 1.4, 0.25, 1.0));',
        '  gl_Position = projectionMatrix * mv;',
        '  vec4 near = projectionMatrix * vec4(mv.xy, mv.z + 0.12, 1.0); gl_Position.z = near.z / near.w * gl_Position.w;',   // sit just in front of the surface they lie on
        '}'].join('\n'),
      fragmentShader: [
        'varying vec4 vCol;',
        'void main(){',
        '  float d = length(gl_PointCoord - 0.5) * 2.0;',
        '  float a = 1.0 - smoothstep(0.45, 1.0, d);',
        '  if (a * vCol.a < 0.004) discard;',
        '  gl_FragColor = vec4(vCol.rgb, a * vCol.a);',
        '  #include <colorspace_fragment>',
        '}'].join('\n'),
    });
    const points = new THREE.Points(geo, mat); points.name = 'scan-cloud'; points.visible = false; points.renderOrder = 3; t.scene.add(points); t.glow(points);

    const watch = stateWatcher(); let sx = 0, settle = 0, forced = false, layerOn = true;
    return {
      update(state, dt) {
        const fresh = watch(state), u = state.units['DRONE-01'], map = state.map, list = map.swaths, n = Math.min(5, list.length);
        if (fresh) { settle = map.ready ? 1 : 0; if (u) sx = u.pos[0]; }
        else { if (u) sx = damp(sx, u.pos[0], chase(state.speed), dt); settle = map.ready ? Math.min(1, settle + dt / 3) : 0; }
        points.visible = layerOn && (forced || (n > 0 && settle < 1));
        if (!points.visible) return;
        let active = -1; if (u && u.mode === 'scan' && !forced) for (let i = 0; i < n; i++) if (Math.abs(list[i].y - u.pos[1]) < 0.5) active = i;
        for (let i = 0; i < 5; i++) { if (i < n) { const s = list[i]; sw[i].set(s.y, s.x0, s.x1, s.half); } else sw[i].set(0, 0, 0, 0); }
        if (active >= 0) {
          const s = list[active], dir = Math.cos(u.heading || 0) >= 0 ? 1 : -1, x = clamp(sx, s.x0, s.x1);
          if (dir > 0) sw[active].z = x; else sw[active].y = x;
          U.uLead.value.set(x, s.y, dir, 1); U.uLeadHalf.value = s.half;
        } else U.uLead.value.w = 0;
        U.uAct.value = active; U.uSettle.value = forced ? 0 : settle; U.uShow.value = forced ? 1 : 0; U.uOpacity.value = forced ? 0.8 : 0.9;
        U.uPx.value = t.renderer.domElement.height * 0.5 * t.camera.projectionMatrix.elements[5];
      },
      setLayer(id, on) { if (id === 'scan') { layerOn = !!on; if (!layerOn) points.visible = false; } },
      show(on) { forced = !!on; },
      onSelect() {},
      dispose() { disposeTree(points); },
    };
  },
};
