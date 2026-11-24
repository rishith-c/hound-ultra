// Geography helpers for the Valley workspace: the site's metres on the real map, the elevation grid's frame, the sun.
// The elevation grid is a 4 by 4 block of zoom-14 web-mercator tiles around Timure, so grid cells line up with map
// tiles exactly and an overlay drawn in grid space can be pinned to the map by its four corners.

export const BLOCK = { z: 14, x0: 12075, y0: 6849, n: 4 };
const TILES = 2 ** BLOCK.z;
const tileLon = (x) => (x / TILES) * 360 - 180;
const tileLat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / TILES))) * 180) / Math.PI;
export const BOUNDS = { west: tileLon(BLOCK.x0), east: tileLon(BLOCK.x0 + BLOCK.n), north: tileLat(BLOCK.y0), south: tileLat(BLOCK.y0 + BLOCK.n) };
// Corner order MapLibre wants for an image or canvas source: top-left, top-right, bottom-right, bottom-left.
export const CORNERS = [[BOUNDS.west, BOUNDS.north], [BOUNDS.east, BOUNDS.north], [BOUNDS.east, BOUNDS.south], [BOUNDS.west, BOUNDS.south]];

// lon/lat -> fractional position in the block, 0..1 from the west and from the north.
export function toUnit(lon, lat) {
  const x = ((lon + 180) / 360) * TILES, y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * TILES;
  return [(x - BLOCK.x0) / BLOCK.n, (y - BLOCK.y0) / BLOCK.n];
}
export function fromUnit(u, v) { return [tileLon(BLOCK.x0 + u * BLOCK.n), tileLat(BLOCK.y0 + v * BLOCK.n)]; }

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
export function haversine(a, b) {
  const p1 = rad(a[1]), p2 = rad(b[1]), dp = p2 - p1, dl = rad(b[0] - a[0]);
  const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export function bearing(a, b) {
  const p1 = rad(a[1]), p2 = rad(b[1]), dl = rad(b[0] - a[0]);
  return (deg(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl))) + 360) % 360;
}

// The exercise site: world [x, y] metres (x east, y north) from the anchor at its south-west corner.
export function siteFrame(anchor) {
  const p = rad(anchor.lat);
  const mLat = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p);
  const mLon = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p);
  return {
    ll: (pt) => [anchor.lon + pt[0] / mLon, anchor.lat + pt[1] / mLat],
    xy: (ll) => [(ll[0] - anchor.lon) * mLon, (ll[1] - anchor.lat) * mLat],
    mLat, mLon,
  };
}

// Nepal Standard Time is UTC+5:45 all year.
export const NPT_MIN = 345;
export function nptDate(dayUtcMs, minutes) { return new Date(dayUtcMs + (minutes - NPT_MIN) * 60000); }
export function nptToday(now = new Date()) {
  const shifted = new Date(now.getTime() + NPT_MIN * 60000);
  return { dayUtcMs: Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

// Sun position (low-precision almanac formulas, good to about 0.01 degrees until 2050).
// Returns azimuth in degrees clockwise from north and altitude in degrees above a flat horizon.
export function sunPosition(date, lat, lon) {
  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const L = rad((280.46 + 0.9856474 * d) % 360), g = rad((357.528 + 0.9856003 * d) % 360);
  const lam = L + rad(1.915) * Math.sin(g) + rad(0.02) * Math.sin(2 * g), eps = rad(23.439 - 0.0000004 * d);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = rad(gmst * 15 + lon) - ra, p = rad(lat);
  const alt = Math.asin(Math.sin(p) * Math.sin(dec) + Math.cos(p) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(p) - Math.sin(p) * Math.cos(ha));
  return { az: (deg(az) + 360) % 360, alt: deg(alt) };
}

export const fmtDist = (m) => (m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m');
export const fmtClock = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(Math.round(min) % 60).padStart(2, '0');
export const fmtLat = (v) => Math.abs(v).toFixed(5) + '° ' + (v >= 0 ? 'N' : 'S');
export const fmtLon = (v) => Math.abs(v).toFixed(5) + '° ' + (v >= 0 ? 'E' : 'W');
