// The schematic view: the valley drawn on a 2-D canvas from the elevation grid and the OpenStreetMap extract.
// It is the fallback when map tiles are blocked or the browser is offline, and a clean chart-style view by choice.
// It implements the same small interface as map.js, so the controller does not care which one is on screen.
import * as d3 from 'd3';
import { BLOCK, toUnit, fromUnit, haversine } from './geo.js';

const kOf = (zoom) => 2 ** zoom / 8;                 // screen pixels per block width at a MapLibre-style zoom
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export function createSchematic(host, M) {
  const canvas = document.createElement('canvas'); canvas.className = 'area-schematic'; canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Schematic map of the Bhote Koshi valley at Timure, drawn from elevation data and OpenStreetMap');
  const layer = document.createElement('div'); layer.className = 'area-schematic-markers';
  host.append(canvas, layer);
  const listeners = { click: [], move: [], leave: [], view: [] }, emit = (t, ...a) => listeners[t].forEach((f) => f(...a));
  const n = M.dem.n, pad = { left: 0, right: 0, top: 0, bottom: 0 };
  let W = 1, H = 1, dpr = 1, k = kOf(M.home.zoom), cu = 0.5, cv = 0.5, dirty = true, raf = 0, running = false, anim = null;
  const layers = { flood: true, slope: false, shadow: false, sectors: true, buildings: true, exercise: true };
  const data = { cut: null, shore: null, sectors: null, sectorLabels: null, exs: null, ex: null, measure: null };
  let markers = [];
  [cu, cv] = toUnit(...M.home.center);

  // ---- base relief: elevation tint times hillshade ----
  const base = document.createElement('canvas'); base.width = base.height = n;
  function paintBase(az, alt) {
    const c = base.getContext('2d'), img = c.createImageData(n, n), px = img.data, d = M.dem.data, a = (az * Math.PI) / 180, zen = ((90 - Math.max(12, alt)) * Math.PI) / 180;
    const lx = Math.sin(a) * Math.sin(zen), ly = -Math.cos(a) * Math.sin(zen), lz = Math.cos(zen), inv = 1 / (2 * M.dem.cs), span = M.dem.max - M.dem.min, night = alt <= 0 ? 0.55 : 1;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const q = j * n + i, gx = (d[j * n + Math.min(n - 1, i + 1)] - d[j * n + Math.max(0, i - 1)]) * inv, gy = (d[Math.min(n - 1, j + 1) * n + i] - d[Math.max(0, j - 1) * n + i]) * inv;
      const len = Math.hypot(gx, gy, 1), sh = Math.max(0, (-gx * lx - gy * ly + lz) / len), t = (d[q] - M.dem.min) / span, v = (0.34 + sh * 0.95) * night;
      px[q * 4] = (20 + 30 * t) * v; px[q * 4 + 1] = (27 + 32 * t) * v; px[q * 4 + 2] = (36 + 34 * t) * v; px[q * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0); dirty = true;
  }
  paintBase(M.sun.az, M.sun.alt);

  // ---- contours every 100 m (index lines every 500 m), built once from a 256 grid ----
  const cn = 256, f = n / cn, small = new Float32Array(cn * cn);
  for (let j = 0; j < cn; j++) for (let i = 0; i < cn; i++) small[j * cn + i] = M.dem.data[(j * f + (f >> 1)) * n + i * f + (f >> 1)];
  const levels = d3.range(Math.ceil(M.dem.min / 100) * 100, M.dem.max, 100);
  const geo = d3.geoPath(d3.geoTransform({ point(x, y) { this.stream.point(x / cn, y / cn); } }));
  const contours = d3.contours().size([cn, cn]).smooth(true).thresholds(levels)(small).map((cnt) => ({ z: cnt.value, path: new Path2D(geo(cnt)) }));

  // ---- vectors in block units ----
  const linePath = (lines) => { const p = new Path2D(); for (const g of lines) g.forEach((ll, i) => { const [u, v] = toUnit(ll[0], ll[1]); i ? p.lineTo(u, v) : p.moveTo(u, v); }); return p; };
  const V = {
    river: linePath(M.osm.rivers.map((r) => r.g)), stream: linePath(M.osm.streams.map((r) => r.g)),
    main: linePath(M.osm.roads.filter((r) => r.kind === 'primary' || r.kind === 'trunk').map((r) => r.g)),
    road: linePath(M.osm.roads.filter((r) => ['unclassified', 'service', 'track'].includes(r.kind)).map((r) => r.g)),
    path: linePath(M.osm.roads.filter((r) => r.kind === 'path' || r.kind === 'footway').map((r) => r.g)),
  };
  let bPaths = null;
  function buildingPaths() {
    bPaths = { ok: new Path2D(), wet: new Path2D(), cut: new Path2D() };
    M.impacts.buildings.forEach((b, i) => { const p = bPaths[b.st], g = M.osm.buildings[i].g; g.forEach((ll, q) => { const [u, v] = toUnit(ll[0], ll[1]); q ? p.lineTo(u, v) : p.moveTo(u, v); }); p.closePath(); });
  }

  const sx = (u) => (u - cu) * k + (W + pad.left - pad.right) / 2, sy = (v) => (v - cv) * k + (H + pad.top - pad.bottom) / 2;
  const unproject = (x, y) => fromUnit((x - (W + pad.left - pad.right) / 2) / k + cu, (y - (H + pad.top - pad.bottom) / 2) / k + cv);
  const project = (ll) => { const [u, v] = toUnit(ll[0], ll[1]); return [sx(u), sy(v)]; };

  function drawFC(c, fc, T) {
    if (!fc) return;
    for (const ft of fc.features) {
      const g = ft.geometry, p = ft.properties || {}, kind = p.kind;
      const ring = (pts) => { c.beginPath(); pts.forEach((ll, i) => { const [x, y] = project(ll); i ? c.lineTo(x, y) : c.moveTo(x, y); }); };
      if (g.type === 'MultiPolygon') {
        c.beginPath(); for (const pg of g.coordinates) for (const rg of pg) { rg.forEach((ll, i) => { const [x, y] = project(ll); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); }
        c.fillStyle = 'rgba(143,208,240,0.14)'; c.fill('evenodd'); c.strokeStyle = 'rgba(228,246,255,0.9)'; c.lineWidth = 1.3; c.lineJoin = 'round'; c.stroke();
      } else if (g.type === 'Polygon') {
        ring(g.coordinates[0]); c.closePath();
        if (kind === 'site') { c.fillStyle = 'rgba(90,169,255,0.08)'; c.fill(); c.setLineDash([6, 4]); c.strokeStyle = T.accent; c.lineWidth = 1.5; c.stroke(); c.setLineDash([]); }
        else if (kind === 'building') { c.fillStyle = p.target ? 'rgba(157,183,214,0.85)' : 'rgba(139,146,155,0.8)'; c.fill(); c.strokeStyle = T.bg0; c.lineWidth = 1; c.stroke(); }
        else if (kind === 'rubble') { c.fillStyle = 'rgba(116,128,142,0.6)'; c.fill(); }
        else if (kind === 'hazard') { c.fillStyle = 'rgba(255,77,94,0.16)'; c.fill(); c.setLineDash([4, 3]); c.strokeStyle = T.danger; c.lineWidth = 1.2; c.stroke(); c.setLineDash([]); }
        else if (kind === 'swath') { c.fillStyle = 'rgba(215,236,255,0.1)'; c.fill(); }
        else if (kind === 'room') { if (k > kOf(16.5)) { c.strokeStyle = 'rgba(233,237,242,0.5)'; c.lineWidth = 0.8; c.stroke(); } }
        else if (p.st !== undefined) { if (p.st === 'active' || p.st === 'wet') { c.fillStyle = p.st === 'active' ? 'rgba(90,169,255,0.1)' : 'rgba(255,178,36,0.1)'; c.fill(); } c.strokeStyle = p.st === 'active' ? T.accent : 'rgba(233,237,242,0.3)'; c.lineWidth = p.st === 'active' ? 1.8 : 0.8; c.stroke(); }
      } else if (g.type === 'LineString') {
        ring(g.coordinates); c.lineJoin = 'round'; c.lineCap = 'round';
        if (kind === 'route') { c.strokeStyle = 'rgba(6,19,31,0.8)'; c.lineWidth = 7; c.stroke(); c.strokeStyle = T.accent; c.lineWidth = 3.2; c.stroke(); }
        else if (kind === 'plan') { c.setLineDash([5, 5]); c.strokeStyle = T.accent; c.lineWidth = 1.6; c.stroke(); c.setLineDash([]); }
        else if (kind === 'trail') { if (p.unit === 'drone') c.setLineDash([2, 4]); c.strokeStyle = p.unit === 'team' ? T.ok : 'rgba(233,237,242,0.8)'; c.lineWidth = 1.6; c.stroke(); c.setLineDash([]); }
        else if (kind === 'swathline') { c.strokeStyle = 'rgba(215,236,255,0.75)'; c.lineWidth = 1.2; c.stroke(); }
        else if (kind === 'rubber' || kind === 'line') { c.strokeStyle = 'rgba(6,19,31,0.75)'; c.lineWidth = 5.5; c.stroke(); if (kind === 'rubber') c.setLineDash([4, 4]); c.strokeStyle = '#fff'; c.lineWidth = 2.2; c.stroke(); c.setLineDash([]); }
        else { c.strokeStyle = 'rgba(27,2,6,0.75)'; c.lineWidth = 7; c.stroke(); c.strokeStyle = T.danger; c.lineWidth = 3.5; c.stroke(); }
      } else if (g.type === 'Point') {
        const [x, y] = project(g.coordinates);
        if (p.id && p.st !== undefined) { if (k > kOf(14.7)) { c.font = '600 ' + Math.max(10, Math.min(15, k / 900)) + 'px ' + T.font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = p.st === 'active' ? '#bfdcff' : 'rgba(233,237,242,0.6)'; c.fillText(p.id, x, y); } }
        else { c.beginPath(); c.arc(x, y, kind === 'probe' ? 6 : 4, 0, 7); c.fillStyle = kind === 'probe' ? T.accent : '#fff'; c.fill(); c.strokeStyle = '#06131f'; c.lineWidth = 2; c.stroke(); }
      }
    }
  }

  function draw() {
    dirty = false;
    const c = canvas.getContext('2d'), T = { accent: css('--accent'), danger: css('--danger'), warn: css('--warn'), ok: css('--ok'), text: css('--text'), text2: css('--text-2'), text3: css('--text-3'), bg0: css('--bg-0'), font: css('--font'), mono: css('--mono') };
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = T.bg0; c.fillRect(0, 0, W, H);
    const x0 = sx(0), y0 = sy(0);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(base, x0, y0, k, k);
    if (layers.shadow) { c.globalAlpha = 0.6; c.drawImage(M.canvases.shadow, x0, y0, k, k); c.globalAlpha = 1; }
    if (layers.slope) { c.globalAlpha = 0.8; c.drawImage(M.canvases.slope, x0, y0, k, k); c.globalAlpha = 1; }
    c.save(); c.translate(x0, y0); c.scale(k, k);
    for (const cn2 of contours) { const idx = cn2.z % 500 === 0; c.strokeStyle = idx ? 'rgba(168,178,191,0.42)' : 'rgba(168,178,191,0.16)'; c.lineWidth = (idx ? 1 : 0.7) / k; c.stroke(cn2.path); }
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.strokeStyle = 'rgba(140,200,232,0.45)'; c.lineWidth = 1 / k; c.stroke(V.stream);
    c.strokeStyle = 'rgba(140,200,232,0.95)'; c.lineWidth = Math.max(2, k / 2600) / k; c.stroke(V.river);
    c.restore();
    if (layers.flood) { c.globalAlpha = 0.9; c.drawImage(M.canvases.flood, x0, y0, k, k); c.globalAlpha = 1; drawFC(c, data.shore, T); }
    c.save(); c.translate(x0, y0); c.scale(k, k);
    c.setLineDash([3 / k, 3 / k]); c.strokeStyle = 'rgba(207,214,220,0.5)'; c.lineWidth = 0.9 / k; c.stroke(V.path); c.setLineDash([]);
    c.strokeStyle = 'rgba(12,18,22,0.8)'; c.lineWidth = 4 / k; c.stroke(V.road); c.lineWidth = 5.5 / k; c.stroke(V.main);
    c.strokeStyle = '#cfd6dc'; c.lineWidth = 1.6 / k; c.stroke(V.road); c.strokeStyle = '#f0d6a4'; c.lineWidth = 2.6 / k; c.stroke(V.main);
    if (layers.buildings) { if (!bPaths) buildingPaths(); c.fillStyle = 'rgba(214,208,196,0.82)'; c.fill(bPaths.ok); c.fillStyle = T.warn; c.fill(bPaths.cut); c.fillStyle = T.danger; c.fill(bPaths.wet); }
    c.restore();
    drawFC(c, data.cut, T);
    if (layers.sectors) { drawFC(c, data.sectors, T); drawFC(c, data.sectorLabels, T); }
    if (layers.exercise) { drawFC(c, data.exs, T); drawFC(c, data.ex, T); }
    drawFC(c, data.measure, T);
    // contour labels on index lines are skipped; place names instead
    c.font = '12px ' + T.font; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.lineWidth = 3; c.strokeStyle = 'rgba(7,9,12,0.85)';
    for (const p of M.osm.places) { const [x, y] = project(p.p); if (x < -50 || y < -20 || x > W + 50 || y > H + 20) continue; c.strokeText(p.name, x, y - 4); c.fillStyle = T.text; c.fillText(p.name, x, y - 4); c.fillStyle = T.text2; c.beginPath(); c.arc(x, y, 2, 0, 7); c.fill(); }
    // scale bar and north arrow, bottom right inside the padding
    const mPerPx = (M.dem.cs * n) / k, target = 110 * mPerPx, step = [50, 100, 200, 500, 1000, 2000, 5000].reduce((a, b) => (b <= target ? b : a), 50), bw = step / mPerPx, bx = W - pad.right - 24 - bw, by = H - pad.bottom - 22;
    c.strokeStyle = T.text; c.lineWidth = 1.5; c.beginPath(); c.moveTo(bx, by - 5); c.lineTo(bx, by); c.lineTo(bx + bw, by); c.lineTo(bx + bw, by - 5); c.stroke();
    c.font = '11px ' + T.mono; c.fillStyle = T.text; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.strokeStyle = 'rgba(7,9,12,0.85)'; c.lineWidth = 3; const lbl = step >= 1000 ? step / 1000 + ' km' : step + ' m'; c.strokeText(lbl, bx + bw / 2, by - 6); c.fillText(lbl, bx + bw / 2, by - 6);
    c.beginPath(); c.moveTo(bx - 22, by - 22); c.lineTo(bx - 16, by); c.lineTo(bx - 22, by - 5); c.lineTo(bx - 28, by); c.closePath(); c.fillStyle = T.text; c.fill(); c.textBaseline = 'bottom'; c.strokeText('N', bx - 22, by - 24); c.fillText('N', bx - 22, by - 24);
    for (const m of markers) { const [x, y] = project(m.ll); m.el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px) translate(-50%,-50%)'; if (m.heading != null) m.el.style.setProperty('--rot', 90 - (m.heading * 180) / Math.PI + 'deg'); }
  }
  function loop() { raf = running ? requestAnimationFrame(loop) : 0; if (anim) anim(performance.now()); if (dirty) draw(); }
  function resize() { const r = host.getBoundingClientRect(); if (!r.width) return; dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); dirty = true; if (!running) draw(); }

  // ---- pointer and keyboard ----
  let drag = null;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => { anim = null; const [x, y] = local(e); drag = { x, y, cu, cv, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    if (drag) { if (Math.hypot(x - drag.x, y - drag.y) > 3) drag.moved = true; if (drag.moved) { cu = drag.cu - (x - drag.x) / k; cv = drag.cv - (y - drag.y) / k; dirty = true; emit('view'); } }
    else emit('move', unproject(x, y));
  });
  canvas.addEventListener('pointerup', (e) => { const d = drag; drag = null; if (d && !d.moved) emit('click', unproject(...local(e))); });
  canvas.addEventListener('pointerleave', () => emit('leave'));
  const zoomAt = (factor, x, y) => { const ll = unproject(x, y), [u, v] = toUnit(ll[0], ll[1]); k = Math.max(kOf(11.5), Math.min(kOf(18.6), k * factor)); cu = u - (x - (W + pad.left - pad.right) / 2) / k; cv = v - (y - (H + pad.top - pad.bottom) / 2) / k; dirty = true; emit('view'); };
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); anim = null; zoomAt(Math.exp(-e.deltaY * 0.0016), ...local(e)); }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const step = 60 / k, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) { cu += mv[0]; cv += mv[1]; dirty = true; e.preventDefault(); emit('view'); }
    else if (e.key === '+' || e.key === '=') zoomAt(1.3, W / 2, H / 2); else if (e.key === '-') zoomAt(1 / 1.3, W / 2, H / 2);
  });
  const ro = new ResizeObserver(resize); ro.observe(host);

  function animateTo(ll, zoom, ms) {
    const [u1, v1] = toUnit(ll[0], ll[1]), k1 = kOf(zoom), u0 = cu, v0 = cv, k0 = k, t0 = performance.now();
    if (!running || ms <= 0) { cu = u1; cv = v1; k = k1; dirty = true; if (!running) draw(); emit('view'); return Promise.resolve(true); }
    return new Promise((resolve) => { anim = (now) => { const t = Math.min(1, (now - t0) / ms), e = 1 - (1 - t) ** 3; cu = u0 + (u1 - u0) * e; cv = v0 + (v1 - v0) * e; k = Math.exp(Math.log(k0) + (Math.log(k1) - Math.log(k0)) * e); dirty = true; emit('view'); if (t >= 1) { anim = null; resolve(true); } }; });
  }

  return {
    kind: 'schematic',
    on(type, fn) { listeners[type].push(fn); },
    setPadding(p) { Object.assign(pad, p); dirty = true; },
    refreshOverlay() { dirty = true; }, animateFlood() {},
    setLayer(name, on) { layers[name] = on; if (name === 'exercise') layer.style.display = on ? '' : 'none'; dirty = true; },
    setBuildingStates() { bPaths = null; dirty = true; },
    setData(name, fc) { data[name] = fc; dirty = true; },
    setMarkers(list) { for (const m of markers) if (!list.includes(m) && !list.some((x) => x.el === m.el)) m.el.remove(); for (const m of list) if (m.el.parentNode !== layer) layer.append(m.el); markers = list; dirty = true; },
    setSun(az, alt) { paintBase(az, alt); }, setExaggeration() {},
    camera() { return { center: fromUnit(cu, cv), zoom: Math.log2(k * 8), pitch: 0, bearing: 0 }; },
    easeTo(cam, ms = 900) { return animateTo(cam.center, cam.zoom, ms); },
    flyTo(ll, zoom = 16.6) { return animateTo(ll, Math.max(zoom, Math.min(Math.log2(k * 8), 17.5)), 900); },
    zoomBy(d) { zoomAt(2 ** d, W / 2, H / 2); },
    flyIn({ from, to, duration }) { [cu, cv] = toUnit(...from.center); k = kOf(from.zoom + 0.6); return animateTo(to.center, to.zoom, Math.min(duration, 2600)); },
    cancelFlight() { anim = null; },
    resize, start() { if (!running) { running = true; resize(); loop(); } }, stop() { running = false; cancelAnimationFrame(raf); anim = null; },
    destroy() { running = false; cancelAnimationFrame(raf); ro.disconnect(); for (const m of markers) m.el.remove(); canvas.remove(); layer.remove(); },
  };
}
