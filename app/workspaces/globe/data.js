// Live quakes: the USGS feed, the sun's position, and the scales shared by the globe, the chart and the list.
// Everything here is real data or plain arithmetic. Nothing is invented when a value is missing.

export const SITE = { lat: 28.2529, lon: 85.3667, label: 'Timure, Nepal: the exercise site (simulated)' };

export const FEEDS = {
  week: {
    id: 'week', label: '7 days, all', title: 'Past 7 days, all magnitudes', spanMs: 7 * 864e5,
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson',
    sentence: 'Every earthquake the USGS located in the last week, where and when it happened.',
  },
  month: {
    id: 'month', label: '30 days, M4.5+', title: 'Past 30 days, M4.5+', spanMs: 30 * 864e5,
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson',
    sentence: 'Every earthquake of magnitude 4.5 or more the USGS located in the last 30 days, where and when it happened.',
  },
};

// The last good result per feed. Lives as long as the page does.
const cache = {};
export const cached = (id) => cache[id] || null;

const failSwitch = () => /quakefail/.test(location.search) || window.__globeFail === true;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parse(json, feed, fetchedAt) {
  const quakes = [];
  let dropped = 0;
  for (const f of json.features || []) {
    const p = f.properties || {}, c = f.geometry?.coordinates || [];
    const lon = num(c[0]), lat = num(c[1]), mag = num(p.mag), time = num(p.time);
    if (lon == null || lat == null || mag == null || time == null) { dropped++; continue; }
    quakes.push({
      id: f.id, mag, magType: p.magType || null, place: p.place || null, time, updated: num(p.updated),
      depth: num(c[2]), lat, lon, felt: num(p.felt), cdi: num(p.cdi), mmi: num(p.mmi), alert: p.alert || null,
      tsunami: p.tsunami === 1 ? true : p.tsunami === 0 ? false : null, status: p.status || null, sig: num(p.sig),
      url: typeof p.url === 'string' && p.url.startsWith('https://earthquake.usgs.gov/') ? p.url : null,
      type: p.type || null, km: haversineKm(lat, lon, SITE.lat, SITE.lon), col: depthColor(num(c[2])),
    });
  }
  quakes.sort((a, b) => a.time - b.time);
  quakes.forEach((q, i) => { q.i = i; });
  const tMax = fetchedAt, tMin = fetchedAt - feed.spanMs;
  return { feed: feed.id, quakes, dropped, fetchedAt, generated: num(json.metadata?.generated), title: json.metadata?.title || feed.title, tMin, tMax };
}

// Resolves with the parsed feed, or throws. A good result replaces the cache; a failure leaves it alone.
export async function loadFeed(id) {
  const feed = FEEDS[id];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    if (failSwitch()) throw new Error('The test switch made this request fail.');
    const res = await fetch(feed.url, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('USGS answered with status ' + res.status + '.');
    const json = await res.json();
    if (!Array.isArray(json.features)) throw new Error('The USGS answer was not a feed.');
    cache[id] = parse(json, feed, Date.now());
    return cache[id];
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'USGS did not answer within 12 seconds.' : (e.message || String(e)));
  } finally { clearTimeout(timer); }
}

// ---------- geometry ----------
const RAD = Math.PI / 180;
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Where the sun is straight overhead at a given moment (low-precision solar position, good to about 0.01 degrees
// for this century): declination gives the latitude, the equation of time corrects the longitude.
export function subsolar(ms) {
  const n = ms / 864e5 + 2440587.5 - 2451545.0;                 // days since J2000
  const L = (280.460 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / RAD;
  let eot = L - ra; eot = ((eot + 540) % 360) - 180;              // equation of time, degrees
  const utcH = (((ms % 864e5) + 864e5) % 864e5) / 36e5;
  let lon = -15 * (utcH - 12) - eot; lon = ((lon + 540) % 360) - 180;
  return { lat: dec / RAD, lon, eotMin: eot * 4 };
}

// ---------- scales ----------
// Depth ramp: shallow is hot and bright, deep is cool. Built from the --heat tokens (heat-5, heat-4, heat-3,
// heat-2), with the deep end lifted towards blue so it still reads on a dark ocean. Position is sqrt(depth / 700).
export const DEPTH_MAX = 700;
export const DEPTH_STOPS = [
  [0, [255, 243, 196]], [10, [255, 205, 120]], [35, [255, 162, 74]], [70, [226, 92, 78]],
  [150, [176, 86, 170]], [300, [122, 108, 214]], [700, [84, 146, 230]],
];
export const depthPos = (km) => Math.sqrt(Math.min(DEPTH_MAX, Math.max(0, km || 0)) / DEPTH_MAX);
export function depthColor(km) {
  const d = Math.min(DEPTH_MAX, Math.max(0, km || 0));
  for (let i = 1; i < DEPTH_STOPS.length; i++) {
    const [d1, c1] = DEPTH_STOPS[i];
    if (d <= d1) {
      const [d0, c0] = DEPTH_STOPS[i - 1];
      const k = (depthPos(d) - depthPos(d0)) / (depthPos(d1) - depthPos(d0));
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k));
    }
  }
  return DEPTH_STOPS[DEPTH_STOPS.length - 1][1];
}
export const rgb = (c, a = 1) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';

// Marker radius in CSS pixels at the default zoom. Grows with magnitude but is clamped: a true energy scale
// (x32 per unit) would make M1 invisible and M7 cover a continent. The same formula is in the point shader.
export const magRadius = (m) => Math.min(22, Math.max(1.8, 1.2 + 0.55 * Math.pow(1.62, m)));

// Radiated seismic energy, joules: log10 E = 1.5 M + 4.8 (Gutenberg and Richter). An estimate from magnitude only.
export const energyJ = (m) => Math.pow(10, 1.5 * m + 4.8);
export const energyToMag = (e) => (Math.log10(e) - 4.8) / 1.5;

export const MAG_TYPES = {
  ml: 'local', md: 'duration', mb: 'body-wave', mb_lg: 'body-wave (Lg)', ms: 'surface-wave', ms_20: 'surface-wave',
  mw: 'moment', mww: 'moment (W-phase)', mwr: 'moment (regional)', mwb: 'moment (body-wave)', mwc: 'moment (centroid)',
  mh: 'hand-determined', mi: 'integrated P-wave', me: 'energy',
};

// ---------- words ----------
const pad = (n) => String(n).padStart(2, '0');
export const clock = (ms, secs = false) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + (secs ? ':' + pad(d.getSeconds()) : ''); };
const utcFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const localFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });
export const utc = (ms) => utcFmt.format(ms).replace(',', '') + ' UTC';
export const local = (ms) => localFmt.format(ms).replace(',', '');
export function ago(ms, now = Date.now(), short = false) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 90) return short ? 'now' : 'just now';
  const [n, u] = s < 5400 ? [Math.round(s / 60), 'min'] : s < 172800 ? [Math.round(s / 3600), 'h'] : [Math.round(s / 86400), 'd'];
  return n + ' ' + u + (short ? '' : ' ago');
}
export const int = (n) => Math.round(n).toLocaleString('en-US');
export const latLon = (lat, lon, d = 3) => Math.abs(lat).toFixed(d) + '° ' + (lat >= 0 ? 'N' : 'S') + ', ' + Math.abs(lon).toFixed(d) + '° ' + (lon >= 0 ? 'E' : 'W');
