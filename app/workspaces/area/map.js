// The satellite view: MapLibre GL JS with real terrain, Esri imagery, OpenFreeMap vector tiles, sky and fog.
// It draws what the controller (index.js) hands it and never computes mission or flood results itself.
import { CORNERS, bearing as bearingTo, haversine } from './geo.js';

const VERSION = '5.24.1';
const LIB = 'https://cdn.jsdelivr.net/npm/maplibre-gl@' + VERSION + '/dist/maplibre-gl';
const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false';
const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const VECTOR = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

function loadLib(timeout = 12000) {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The map library did not load in time.')), timeout);
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LIB + '.css'; document.head.append(css);
    const s = document.createElement('script'); s.src = LIB + '.js'; s.async = true;
    s.onload = () => { clearTimeout(timer); window.maplibregl ? resolve(window.maplibregl) : reject(new Error('The map library loaded but did not start.')); };
    s.onerror = () => { clearTimeout(timer); reject(new Error('The map library could not be downloaded.')); };
    document.head.append(s);
  });
}

const FC = (features = []) => ({ type: 'FeatureCollection', features });
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => 'rgb(' + c1.map((v, i) => Math.round(lerp(v, c2[i], t))).join(',') + ')';
const angleLerp = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;

// Sky, haze and imagery grading for a sun altitude in degrees. Day is clear, low sun warms the horizon, night is dark.
export function atmosphere(alt) {
  const day = Math.max(0, Math.min(1, (alt + 4) / 16)), gold = Math.max(0, 1 - Math.abs(alt - 4) / 10);
  const sky = mix([6, 9, 14], [44, 84, 132], day), hzBase = [[16, 22, 31], [176, 196, 212]];
  const hz = hzBase[0].map((v, i) => lerp(v, hzBase[1][i], day));
  const warm = [232, 172, 128];
  const horizon = mix(hz, warm, gold * 0.55), fog = mix(hz.map((v) => v * 0.92), warm, gold * 0.35);
  return { sky, horizon, fog, brightness: lerp(0.3, 1, day), saturation: lerp(-0.55, -0.06, day), light: lerp(0.12, 0.55, day) };
}

export async function createMapView(host, M, { onFail = () => {} } = {}) {
  const maplibregl = await loadLib();
  if (maplibregl.supported && !maplibregl.supported()) throw new Error('This browser cannot draw the 3-D map (no WebGL).');
  const listeners = { click: [], move: [], leave: [], view: [] };
  const atm = atmosphere(M.sun.alt);
  const style = {
    version: 8, glyphs: GLYPHS, transition: { duration: 0, delay: 0 },   // terrain caches its drape, so paint changes must land in one frame
    light: { anchor: 'map', position: [1.5, M.sun.az, Math.max(5, 90 - M.sun.alt)], color: '#fff3e0', intensity: atm.light },
    sky: { 'sky-color': atm.sky, 'horizon-color': atm.horizon, 'fog-color': atm.fog, 'fog-ground-blend': 0.55, 'horizon-fog-blend': 0.55, 'sky-horizon-blend': 0.75, 'atmosphere-blend': 0 },
    sources: {
      imagery: { type: 'raster', tiles: [IMAGERY], tileSize: 256, maxzoom: 18 },
      vec: { type: 'vector', url: VECTOR },
      dem: { type: 'raster-dem', tiles: [TERRAIN], encoding: 'terrarium', tileSize: 256, maxzoom: 14 },
      shade: { type: 'raster-dem', tiles: [TERRAIN], encoding: 'terrarium', tileSize: 256, maxzoom: 14 },
      shadow: { type: 'canvas', canvas: M.canvases.shadow, coordinates: CORNERS, animate: false },
      slope: { type: 'canvas', canvas: M.canvases.slope, coordinates: CORNERS, animate: false },
      flood: { type: 'canvas', canvas: M.canvases.flood, coordinates: CORNERS, animate: false },
      obld: { type: 'geojson', data: M.buildingsFC, promoteId: 'id' },
      cut: { type: 'geojson', data: FC() }, shore: { type: 'geojson', data: FC() }, sectors: { type: 'geojson', data: FC() }, sectorLabels: { type: 'geojson', data: FC() },
      exs: { type: 'geojson', data: FC() }, ex: { type: 'geojson', data: FC() }, measure: { type: 'geojson', data: FC() },
    },
    terrain: { source: 'dem', exaggeration: M.exaggeration },
    layers: [
      { id: 'ground', type: 'background', paint: { 'background-color': '#1a232c' } },
      { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-saturation': atm.saturation, 'raster-contrast': 0.16, 'raster-brightness-max': atm.brightness, 'raster-fade-duration': 250 } },
      { id: 'relief', type: 'hillshade', source: 'shade', paint: { 'hillshade-exaggeration': 0.22, 'hillshade-illumination-direction': M.sun.az, 'hillshade-illumination-anchor': 'map', 'hillshade-shadow-color': '#0b1522', 'hillshade-highlight-color': '#f1e6cf', 'hillshade-accent-color': '#0b1522' } },
      { id: 'shadow', type: 'raster', source: 'shadow', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.62, 'raster-fade-duration': 0 } },
      { id: 'slope', type: 'raster', source: 'slope', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.7, 'raster-fade-duration': 0 } },
      { id: 'river', type: 'line', source: 'vec', 'source-layer': 'waterway', filter: ['==', ['get', 'class'], 'river'], paint: { 'line-color': '#8cc8e8', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 2.4], 'line-opacity': 0.55 } },
      { id: 'flood', type: 'raster', source: 'flood', paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 0 } },
      { id: 'water', type: 'fill', source: 'shore', paint: { 'fill-color': '#8fd0f0', 'fill-opacity': 0.14, 'fill-antialias': true } },
      { id: 'shore', type: 'line', source: 'shore', layout: { 'line-join': 'round' }, paint: { 'line-color': '#e4f6ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 1.6], 'line-opacity': 0.9 } },
      { id: 'road-edge', type: 'line', source: 'vec', 'source-layer': 'transportation', filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track'], true, false], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0c1216', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 17, 5.2], 'line-opacity': 0.7 } },
      { id: 'roads', type: 'line', source: 'vec', 'source-layer': 'transportation', filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track'], true, false], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], '#f0d6a4', '#cfd6dc'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 17, 2.4], 'line-opacity': 0.9 } },
      { id: 'paths', type: 'line', source: 'vec', 'source-layer': 'transportation', minzoom: 13, filter: ['==', ['get', 'class'], 'path'], paint: { 'line-color': '#cfd6dc', 'line-width': 0.9, 'line-opacity': 0.55, 'line-dasharray': [2, 2] } },
      { id: 'cut-edge', type: 'line', source: 'cut', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#1b0206', 'line-width': 7, 'line-opacity': 0.75 } },
      { id: 'cut', type: 'line', source: 'cut', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ff4d5e', 'line-width': 3.5 } },
      { id: 'sector-fill', type: 'fill', source: 'sectors', paint: { 'fill-color': ['match', ['get', 'st'], 'active', '#5aa9ff', 'wet', '#ffb224', 'rgba(0,0,0,0)'], 'fill-opacity': ['match', ['get', 'st'], 'active', 0.1, 'wet', 0.1, 0] } },
      { id: 'sector-line', type: 'line', source: 'sectors', paint: { 'line-color': ['match', ['get', 'st'], 'active', '#5aa9ff', '#e9edf2'], 'line-width': ['match', ['get', 'st'], 'active', 1.8, 0.8], 'line-opacity': ['match', ['get', 'st'], 'active', 0.95, 0.42] } },
      { id: 'site', type: 'fill', source: 'exs', filter: ['==', ['get', 'kind'], 'site'], paint: { 'fill-color': '#5aa9ff', 'fill-opacity': 0.07 } },
      { id: 'site-line', type: 'line', source: 'exs', filter: ['==', ['get', 'kind'], 'site'], paint: { 'line-color': '#5aa9ff', 'line-width': 1.6, 'line-dasharray': [3, 2] } },
      { id: 'rubble', type: 'fill', source: 'exs', filter: ['==', ['get', 'kind'], 'rubble'], paint: { 'fill-color': '#74808e', 'fill-opacity': 0.55 } },
      { id: 'hazard', type: 'fill', source: 'ex', filter: ['==', ['get', 'kind'], 'hazard'], paint: { 'fill-color': '#ff4d5e', 'fill-opacity': 0.16 } },
      { id: 'hazard-line', type: 'line', source: 'ex', filter: ['==', ['get', 'kind'], 'hazard'], paint: { 'line-color': '#ff4d5e', 'line-width': 1.2, 'line-dasharray': [2, 1.5], 'line-opacity': 0.9 } },
      { id: 'swath', type: 'fill', source: 'ex', filter: ['==', ['get', 'kind'], 'swath'], paint: { 'fill-color': '#d7ecff', 'fill-opacity': 0.1 } },
      { id: 'swath-line', type: 'line', source: 'ex', filter: ['==', ['get', 'kind'], 'swathline'], paint: { 'line-color': '#d7ecff', 'line-width': 1.2, 'line-opacity': 0.75 } },
      { id: 'rooms', type: 'line', source: 'exs', filter: ['==', ['get', 'kind'], 'room'], minzoom: 16.5, paint: { 'line-color': '#e9edf2', 'line-width': 0.8, 'line-opacity': 0.5 } },
      { id: 'trail', type: 'line', source: 'ex', filter: ['==', ['get', 'kind'], 'trail'], layout: { 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'unit'], 'drone', '#d7ecff', 'team', '#41d6a0', '#e9edf2'], 'line-width': 1.6, 'line-opacity': 0.75, 'line-dasharray': ['match', ['get', 'unit'], 'drone', ['literal', [1, 2]], ['literal', [1, 0]]] } },
      { id: 'route-edge', type: 'line', source: 'ex', filter: ['==', ['get', 'kind'], 'route'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#06131f', 'line-width': 7, 'line-opacity': 0.8 } },
      { id: 'route', type: 'line', source: 'ex', filter: ['==', ['get', 'kind'], 'route'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#5aa9ff', 'line-width': 3.2 } },
      { id: 'plan', type: 'line', source: 'ex', filter: ['==', ['get', 'kind'], 'plan'], paint: { 'line-color': '#5aa9ff', 'line-width': 1.6, 'line-dasharray': [2, 2] } },
      { id: 'measure-edge', type: 'line', source: 'measure', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#06131f', 'line-width': 5.5, 'line-opacity': 0.75 } },
      { id: 'measure', type: 'line', source: 'measure', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 2.2, 'line-dasharray': ['case', ['==', ['get', 'kind'], 'rubber'], ['literal', [1.5, 1.5]], ['literal', [1, 0]]] } },
      { id: 'buildings', type: 'fill-extrusion', source: 'obld', minzoom: 13, paint: { 'fill-extrusion-color': ['match', ['coalesce', ['feature-state', 'st'], 'ok'], 'wet', '#ff4d5e', 'cut', '#ffb224', '#d6d0c4'], 'fill-extrusion-height': 5, 'fill-extrusion-opacity': 0.9, 'fill-extrusion-vertical-gradient': true } },
      { id: 'ex-buildings', type: 'fill-extrusion', source: 'exs', filter: ['==', ['get', 'kind'], 'building'], paint: { 'fill-extrusion-color': ['case', ['get', 'target'], '#9db7d6', '#8b929b'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.78 } },
      { id: 'measure-pt', type: 'circle', source: 'measure', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': ['case', ['==', ['get', 'kind'], 'probe'], 6, 4], 'circle-color': ['case', ['==', ['get', 'kind'], 'probe'], '#5aa9ff', '#ffffff'], 'circle-stroke-color': '#06131f', 'circle-stroke-width': 2, 'circle-pitch-alignment': 'map' } },
      { id: 'sector-label', type: 'symbol', source: 'sectorLabels', minzoom: 14.7, layout: { 'text-field': ['get', 'id'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 17, 15], 'text-allow-overlap': true }, paint: { 'text-color': ['match', ['get', 'st'], 'active', '#bfdcff', '#e9edf2'], 'text-opacity': ['match', ['get', 'st'], 'active', 1, 0.6], 'text-halo-color': '#07090c', 'text-halo-width': 1.4 } },
      { id: 'water-name', type: 'symbol', source: 'vec', 'source-layer': 'waterway', filter: ['==', ['get', 'class'], 'river'], layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'text-letter-spacing': 0.08, 'symbol-spacing': 420 }, paint: { 'text-color': '#cfeaff', 'text-halo-color': '#0a1a26', 'text-halo-width': 1.4 } },
      { id: 'peaks', type: 'symbol', source: 'vec', 'source-layer': 'mountain_peak', filter: ['has', 'ele'], layout: { 'text-field': ['concat', ['coalesce', ['get', 'name:en'], ['get', 'name'], 'Summit'], '\n', ['to-string', ['get', 'ele']], ' m'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.4] }, paint: { 'text-color': '#e9edf2', 'text-halo-color': '#07090c', 'text-halo-width': 1.3 } },
      { id: 'places', type: 'symbol', source: 'vec', 'source-layer': 'place', layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': ['match', ['get', 'class'], ['city', 'town'], 15, 'village', 13, 12], 'text-anchor': 'bottom', 'text-offset': [0, -0.3], 'text-max-width': 8 }, paint: { 'text-color': '#f4f7fa', 'text-halo-color': '#07090c', 'text-halo-width': 1.5 } },
    ],
  };

  const map = new maplibregl.Map({ container: host, style, center: M.home.center, zoom: M.home.zoom, pitch: M.home.pitch, bearing: M.home.bearing,
    maxPitch: 76, minZoom: 8.5, maxZoom: 18.6, attributionControl: false, maxBounds: [[84.4, 27.6], [86.4, 28.9]], canvasContextAttributes: { antialias: true, preserveDrawingBuffer: false } });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true, showCompass: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

  // Tile failures: a few are normal at the edge of coverage; nothing but failures means the network is blocked.
  const seen = { imagery: { ok: 0, bad: 0 }, dem: { ok: 0, bad: 0 }, vec: { ok: 0, bad: 0 } };
  let failed = false;
  map.on('data', (e) => { if (e.dataType === 'source' && e.tile && seen[e.sourceId]) seen[e.sourceId].ok++; });
  map.on('error', (e) => {
    const id = e.sourceId; if (!seen[id]) return;
    seen[id].bad++;
    if (!failed && id !== 'vec' && seen[id].ok === 0 && seen[id].bad >= 6) { failed = true; onFail(id === 'imagery' ? 'The satellite imagery tiles are not loading.' : 'The elevation tiles are not loading.'); }
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The map did not start within 15 seconds.')), 15000);
    map.once('load', () => { clearTimeout(timer); resolve(); });
  });
  map.getCanvas().setAttribute('aria-label', 'Satellite map of the Bhote Koshi valley at Timure, Nepal, with real terrain');

  const emit = (type, ...a) => listeners[type].forEach((fn) => fn(...a));
  map.on('click', (e) => emit('click', [e.lngLat.lng, e.lngLat.lat]));
  map.on('mousemove', (e) => emit('move', [e.lngLat.lng, e.lngLat.lat]));
  map.on('mouseout', () => emit('leave'));
  map.on('move', () => emit('view'));

  const markers = new Map();
  let flight = null, playing = false;
  const cancelFlight = () => { if (flight) { cancelAnimationFrame(flight.raf); const f = flight; flight = null; f.done(false); } };
  for (const ev of ['mousedown', 'wheel', 'touchstart']) map.on(ev, cancelFlight);

  // Layers draped on the terrain are cached per tile; after a paint change ask for the drape to be drawn again.
  const redrape = () => { try { map.terrain?.sourceCache?.freeRtt?.(); } catch { /* internal, optional */ } map.triggerRepaint(); };
  const view = {
    kind: 'map', map,
    on(type, fn) { listeners[type].push(fn); },
    setPadding(p) { map.setPadding(p); },
    refreshOverlay(name) { const s = map.getSource(name); if (!s) return; if (name === 'flood' && playing) return; s.play(); s.pause(); redrape(); },
    // while water is moving the flood canvas is uploaded every frame
    animateFlood(on) { const s = map.getSource('flood'); if (!s || on === playing) return; playing = on; if (on) s.play(); else s.pause(); },
    setLayer(name, on) {
      const ids = { flood: ['flood', 'water', 'shore'], slope: ['slope'], shadow: ['shadow'], sectors: ['sector-fill', 'sector-line', 'sector-label'], buildings: ['buildings'], imagery: ['imagery'],
        exercise: ['site', 'site-line', 'rubble', 'hazard', 'hazard-line', 'swath', 'swath-line', 'rooms', 'trail', 'route-edge', 'route', 'plan', 'ex-buildings'] }[name] || [];
      for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      redrape();
      if (name === 'exercise') for (const m of markers.values()) m.getElement().style.display = on ? '' : 'none';
    },
    setBuildingStates(changes) { for (const [id, st] of changes) map.setFeatureState({ source: 'obld', id }, { st }); },
    setData(name, fc) { map.getSource(name)?.setData(fc); },
    setMarkers(list) {
      const keep = new Set();
      for (const m of list) {
        keep.add(m.id);
        let mk = markers.get(m.id);
        if (!mk) { mk = new maplibregl.Marker({ element: m.el, anchor: 'center' }).setLngLat(m.ll).addTo(map); markers.set(m.id, mk); }
        else mk.setLngLat(m.ll);
        if (m.heading != null) m.el.style.setProperty('--rot', 90 - (m.heading * 180) / Math.PI - map.getBearing() + 'deg');
      }
      for (const [id, mk] of markers) if (!keep.has(id)) { mk.remove(); markers.delete(id); }
    },
    setSun(az, alt) {
      const a = atmosphere(alt);
      map.setSky({ 'sky-color': a.sky, 'horizon-color': a.horizon, 'fog-color': a.fog, 'fog-ground-blend': 0.55, 'horizon-fog-blend': 0.55, 'sky-horizon-blend': 0.75, 'atmosphere-blend': 0 });
      map.setLight({ anchor: 'map', position: [1.5, az, Math.max(5, Math.min(89, 90 - alt))], color: '#fff3e0', intensity: a.light });
      map.setPaintProperty('imagery', 'raster-brightness-max', a.brightness);
      map.setPaintProperty('imagery', 'raster-saturation', a.saturation);
      map.setPaintProperty('relief', 'hillshade-illumination-direction', az);
      map.setPaintProperty('relief', 'hillshade-exaggeration', alt > 0 ? 0.22 : 0.1);
      redrape();
    },
    setExaggeration(x) { map.setTerrain({ source: 'dem', exaggeration: x }); },
    camera() { const c = map.getCenter(); return { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }; },
    easeTo(cam, ms = 1400) { cancelFlight(); map.easeTo({ ...cam, duration: ms, essential: true }); },
    flyTo(ll, zoom = 16.6) { cancelFlight(); map.flyTo({ center: ll, zoom: Math.max(zoom, Math.min(map.getZoom(), 17.5)), duration: 1600, essential: true }); },
    zoomBy(d) { map.easeTo({ zoom: map.getZoom() + d, duration: 300 }); },
    // Follow the river downstream from high altitude to the block. path is [lon, lat][]; returns a promise of
    // true when it ran to the end, false when the user took control.
    flyIn({ path, from, to, duration = 12000, onProgress = () => {} }) {
      cancelFlight();
      const cum = [0]; for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversine(path[i - 1], path[i]));
      const total = cum[cum.length - 1];
      const at = (d) => { d = Math.max(0, Math.min(total, d)); let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); return [lerp(path[i - 1][0], path[i][0], f), lerp(path[i - 1][1], path[i][1], f)]; };
      return new Promise((resolve) => {
        const t0 = performance.now(); let brg = from.bearing;
        const frame = (now) => {
          const u = Math.min(1, (now - t0) / duration), e = 0.5 - 0.5 * Math.cos(Math.PI * u);
          const c = at(e * total), ahead = at(Math.min(total, e * total + total * 0.08));
          const want = e > 0.9 ? to.bearing : angleLerp(bearingTo(c, ahead), to.bearing, Math.max(0, (e - 0.6) / 0.3) ** 2);
          brg = angleLerp(brg, want, 0.06);
          map.jumpTo({ center: e > 0.985 ? to.center : [lerp(c[0], to.center[0], Math.max(0, (e - 0.8) / 0.2) ** 2), lerp(c[1], to.center[1], Math.max(0, (e - 0.8) / 0.2) ** 2)], zoom: lerp(from.zoom, to.zoom, e ** 1.5), pitch: lerp(from.pitch, to.pitch, e ** 0.8), bearing: brg });
          onProgress(e, c);
          if (u < 1) flight.raf = requestAnimationFrame(frame);
          else { flight = null; map.easeTo({ ...to, duration: 900 }); resolve(true); }
        };
        flight = { raf: requestAnimationFrame(frame), done: resolve };
        map.jumpTo(from);
      });
    },
    cancelFlight,
    resize() { map.resize(); },
    start() {}, stop() { cancelFlight(); },
    destroy() { cancelFlight(); for (const m of markers.values()) m.remove(); markers.clear(); map.remove(); },
  };
  return view;
}
