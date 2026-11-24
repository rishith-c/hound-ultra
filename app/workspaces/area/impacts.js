// What a water level does to what is mapped: buildings in the water, road sections under water, buildings whose
// road or path link south out of the mapped area is cut, and the same counted per search sector.
// Inputs are real (OpenStreetMap buildings and roads, the elevation grid); the water level is the illustrative model.
import { BOUNDS, haversine } from './geo.js';

export const CROSSING_CLEARANCE = 4;   // assumed: a road crossing the channel is lost once the water there is this deep (m)
export const ROAD_DEPTH = 0.3;         // assumed: a road is impassable under this much water (m)
const ROAD_WORDS = { primary: 'Main road', trunk: 'Main road', unclassified: 'Local road', service: 'Service road', track: 'Track', path: 'Footpath', footway: 'Footpath' };
export const SECTOR = { size: 200, cols: 5, rows: 6, col0: 2, row0: 3 };   // the block sits in column C, row 4

export function buildImpacts(dem, model, slope, osm, frame, SITE) {
  const { n } = dem;
  // ---- search sectors: a 200 m grid laid so the exercise block sits in the middle of sector C4 ----
  const sx0 = SITE.w / 2 - SECTOR.size * (SECTOR.col0 + 0.5), syTop = SITE.h / 2 + SECTOR.size * (SECTOR.row0 + 0.5);
  const sectors = [];
  for (let r = 0; r < SECTOR.rows; r++) for (let c = 0; c < SECTOR.cols; c++) {
    const x0 = sx0 + c * SECTOR.size, y1 = syTop - r * SECTOR.size, x1 = x0 + SECTOR.size, y0 = y1 - SECTOR.size;
    sectors.push({ id: 'ABCDE'[c] + (r + 1), c, r, home: c === SECTOR.col0 && r === SECTOR.row0, ring: [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(frame.ll), center: frame.ll([(x0 + x1) / 2, (y0 + y1) / 2]),
      buildings: 0, cells: 0, steep: 0, wetCells: 0, wet: 0, cut: 0 });
  }
  const sectorAt = (ll) => {
    const [x, y] = frame.xy(ll), c = Math.floor((x - sx0) / SECTOR.size), r = Math.floor((syTop - y) / SECTOR.size);
    return c < 0 || r < 0 || c >= SECTOR.cols || r >= SECTOR.rows ? -1 : r * SECTOR.cols + c;
  };
  // steep share per sector, and which model cell belongs to which sector
  const a = dem.cell(...frame.ll([sx0, syTop])), b = dem.cell(...frame.ll([sx0 + SECTOR.size * SECTOR.cols, syTop - SECTOR.size * SECTOR.rows]));
  for (let j = (a / n) | 0; j <= ((b / n) | 0); j++) for (let i = a % n; i <= b % n; i++) {
    const k = j * n + i, sec = sectorAt(dem.cellLonLat(k)); if (sec < 0) continue;
    sectors[sec].cells++; if (slope[k] >= 35) sectors[sec].steep++;
  }
  const cellSector = new Int8Array(model.cells.length);
  for (let i = 0; i < model.cells.length; i++) cellSector[i] = sectorAt(dem.cellLonLat(model.cells[i]));

  // ---- road graph ----
  const nodeIdx = new Map(), nodes = [], adj = [], edges = [], ways = [];
  const node = (ll) => { const key = ll[0] + ',' + ll[1]; let i = nodeIdx.get(key); if (i == null) { i = nodes.length; nodeIdx.set(key, i); nodes.push(ll); adj.push([]); } return i; };
  for (const w of osm.roads) {
    const way = { name: (ROAD_WORDS[w.kind] || 'Road') + (w.ref ? ' ' + w.ref : '') + (w.name ? ' (' + w.name + ')' : ''), kind: w.kind, edges: [] };
    for (let i = 1; i < w.g.length; i++) {
      const p = w.g[i - 1], q = w.g[i], len = haversine(p, q), steps = Math.max(1, Math.ceil(len / (dem.cs * 0.7))), cells = [];
      for (let s = 0; s <= steps; s++) { const k = dem.cell(p[0] + (q[0] - p[0]) * (s / steps), p[1] + (q[1] - p[1]) * (s / steps)); if (k >= 0 && cells[cells.length - 1] !== k) cells.push(k); }
      if (!cells.length) continue;
      const e = { a: node(p), b: node(q), len, cells, p, q, wet: false };
      adj[e.a].push(edges.length); adj[e.b].push(edges.length); way.edges.push(edges.length); edges.push(e);
    }
    if (way.edges.length) ways.push(way);
  }
  // the way out: every mapped road or path node within 250 m of the grid's south edge, down the valley. (The main road
  // itself is a short unconnected piece in this OpenStreetMap extract, so it cannot be used as the exit.)
  const exits = []; for (let i = 0; i < nodes.length; i++) if (nodes[i][1] < BOUNDS.south + 250 / frame.mLat) exits.push(i);
  const reachFrom = (dryOnly) => {
    const seen = new Uint8Array(nodes.length), q = exits.slice(); for (const i of exits) seen[i] = 1;
    while (q.length) { const v = q.pop(); for (const ei of adj[v]) { const e = edges[ei]; if (dryOnly && e.wet) continue; const o = e.a === v ? e.b : e.a; if (!seen[o]) { seen[o] = 1; q.push(o); } } }
    return seen;
  };
  const baseReach = reachFrom(false);

  // ---- buildings ----
  const buildings = osm.buildings.map((bd) => {
    let x = 0, y = 0; const m = bd.g.length - 1 || 1;
    for (let i = 0; i < m; i++) { x += bd.g[i][0]; y += bd.g[i][1]; }
    const c = [x / m, y / m]; let best = -1, bd2 = 120;
    for (let i = 0; i < nodes.length; i++) { if (Math.abs(nodes[i][1] - c[1]) > 0.0012) continue; const dd = haversine(nodes[i], c); if (dd < bd2) { bd2 = dd; best = i; } }
    const sec = sectorAt(c); if (sec >= 0) sectors[sec].buildings++;
    return { id: bd.id, name: bd.name, c, cell: dem.cell(c[0], c[1]), node: best, linked: best >= 0 && !!baseReach[best], sector: sec, st: 'ok' };
  });
  const linked = buildings.filter((x) => x.linked).length;

  const levelAt = (h, k) => (typeof h === 'number' ? h : h(model.s[k]));
  function compute(h) {
    // roads
    let roadWet = 0;
    for (const e of edges) {
      e.wet = false;
      for (const k of e.cells) {
        const hh = levelAt(h, k); if (!(model.need[k] < hh)) continue;
        const depth = hh - model.rel[k];
        if (depth > (model.rel[k] < 1 ? CROSSING_CLEARANCE : ROAD_DEPTH)) { e.wet = true; break; }
      }
      if (e.wet) roadWet += e.len;
    }
    const cuts = [], lines = [];
    for (const w of ways) {
      let run = null;
      const close = () => { if (run) { cuts.push({ name: w.name, kind: w.kind, len: run.len, ll: run.pts[run.pts.length >> 1] }); lines.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: run.pts } }); run = null; } };
      for (const ei of w.edges) { const e = edges[ei]; if (e.wet) { if (!run) run = { len: 0, pts: [e.p] }; run.len += e.len; run.pts.push(e.q); } else close(); }
      close();
    }
    cuts.sort((p, q) => q.len - p.len);
    const reach = reachFrom(true);
    // buildings
    for (const s of sectors) { s.wet = 0; s.cut = 0; s.wetCells = 0; }
    let wet = 0, cut = 0; const changes = [];
    for (const bd of buildings) {
      const isWet = bd.cell >= 0 && model.need[bd.cell] < levelAt(h, bd.cell);
      const st = isWet ? 'wet' : bd.linked && !reach[bd.node] ? 'cut' : 'ok';
      if (st === 'wet') { wet++; if (bd.sector >= 0) sectors[bd.sector].wet++; } else if (st === 'cut') { cut++; if (bd.sector >= 0) sectors[bd.sector].cut++; }
      if (st !== bd.st) { bd.st = st; changes.push([bd.id, st]); }
    }
    for (let i = 0; i < model.cells.length; i++) { const sec = cellSector[i]; if (sec < 0) continue; const k = model.cells[i]; if (model.need[k] < levelAt(h, k)) sectors[sec].wetCells++; }
    return { wet, cut, changes, roadWet, cuts, cutFC: { type: 'FeatureCollection', features: lines } };
  }
  return { sectors, buildings, linked, total: buildings.length, compute, sectorAt, roadCount: ways.length, hasExit: exits.length > 0 };
}
