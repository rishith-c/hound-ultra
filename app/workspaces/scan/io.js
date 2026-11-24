// Reading and writing point-cloud files (.ply ASCII or binary little-endian, .xyz / .txt / .csv) and floor-plan JSON.
// Every failure throws an Error whose message can be shown to the person as it is. Worker-safe: no DOM.

export const MAX_POINTS = 1500000;
const SIZES = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
const READ = { char: 'getInt8', int8: 'getInt8', uchar: 'getUint8', uint8: 'getUint8', short: 'getInt16', int16: 'getInt16', ushort: 'getUint16', uint16: 'getUint16', int: 'getInt32', int32: 'getInt32', uint: 'getUint32', uint32: 'getUint32', float: 'getFloat32', float32: 'getFloat32', double: 'getFloat64', float64: 'getFloat64' };

function out(cap, hasRgb) { return { n: 0, pos: new Float32Array(cap * 3), inten: new Float32Array(cap), rgb: hasRgb ? new Uint8Array(cap * 3) : null, hasI: false }; }
function done(o, total, note) {
  const n = o.n;
  if (n < 50) throw new Error(n === 0 ? 'No usable points were found in this file.' : 'Only ' + n + ' usable points were found. A scan needs at least 50.');
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const v = o.inten[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const inten = new Uint8Array(n);
  if (o.hasI && hi > lo) for (let i = 0; i < n; i++) inten[i] = Math.round(((o.inten[i] - lo) / (hi - lo)) * 255);
  else if (o.rgb) for (let i = 0; i < n; i++) inten[i] = (o.rgb[i * 3] * 0.3 + o.rgb[i * 3 + 1] * 0.59 + o.rgb[i * 3 + 2] * 0.11) | 0;
  else inten.fill(170);
  return { n, pos: o.pos.slice(0, n * 3), inten, rgb: o.rgb ? o.rgb.slice(0, n * 3) : null, total, hasIntensity: o.hasI && hi > lo, note };
}

export function parsePLY(buf) {
  const bytes = new Uint8Array(buf), headMax = Math.min(bytes.length, 65536);
  let end = -1; const mark = [101, 110, 100, 95, 104, 101, 97, 100, 101, 114]; // "end_header"
  for (let i = 0; i + mark.length < headMax && end < 0; i++) { let ok = true; for (let q = 0; q < mark.length; q++) if (bytes[i + q] !== mark[q]) { ok = false; break; } if (ok) end = i; }
  if (end < 0) throw new Error('This .ply file has no header end marker ("end_header"), so it cannot be read. It may be cut short or not a PLY file.');
  let dataStart = end + mark.length; while (dataStart < bytes.length && bytes[dataStart] !== 10) dataStart++; dataStart++;
  const lines = new TextDecoder().decode(bytes.subarray(0, end)).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== 'ply') throw new Error('This file does not start with "ply", so it is not a PLY file.');
  let format = null; const elements = [];
  for (const l of lines.slice(1)) {
    const t = l.split(/\s+/);
    if (t[0] === 'format') format = t[1];
    else if (t[0] === 'element') elements.push({ name: t[1], count: +t[2], props: [] });
    else if (t[0] === 'property' && elements.length) { const e = elements[elements.length - 1]; if (t[1] === 'list') e.props.push({ list: true, name: t[4] }); else e.props.push({ type: t[1], name: t[2].toLowerCase() }); }
  }
  if (format === 'binary_big_endian') throw new Error('This PLY file is binary big-endian. Only ASCII and binary little-endian are supported. Re-export it as "binary little endian" or ASCII.');
  if (format !== 'ascii' && format !== 'binary_little_endian') throw new Error('Unknown PLY format "' + format + '". Supported: ascii and binary_little_endian.');
  const vi = elements.findIndex((e) => e.name === 'vertex');
  if (vi < 0) throw new Error('This PLY file has no "vertex" element, so it holds no points.');
  const ve = elements[vi];
  if (!(ve.count > 0)) throw new Error('This PLY file says it holds 0 points.');
  if (ve.props.some((p) => p.list)) throw new Error('The points in this PLY file have list properties, which are not supported.');
  const pi = (names) => ve.props.findIndex((p) => names.includes(p.name));
  const ix = pi(['x']), iy = pi(['y']), iz = pi(['z']);
  if (ix < 0 || iy < 0 || iz < 0) throw new Error('The points in this PLY file have no x, y, z properties.');
  const ir = pi(['red', 'r', 'diffuse_red']), ig = pi(['green', 'g', 'diffuse_green']), ib = pi(['blue', 'b', 'diffuse_blue']), ii = pi(['intensity', 'scalar_intensity', 'reflectance']);
  const hasRgb = ir >= 0 && ig >= 0 && ib >= 0, cscale = hasRgb && /float|double/.test(ve.props[ir].type) ? 255 : 1;
  for (const p of ve.props) if (!SIZES[p.type]) throw new Error('Unknown property type "' + p.type + '" in the PLY header.');
  const stride = Math.max(1, Math.ceil(ve.count / MAX_POINTS)), o = out(Math.ceil(ve.count / stride), hasRgb);
  o.hasI = ii >= 0;
  const push = (x, y, z, I, r, g, b) => { if (!(isFinite(x) && isFinite(y) && isFinite(z))) return; const k = o.n++; o.pos[k * 3] = x; o.pos[k * 3 + 1] = y; o.pos[k * 3 + 2] = z; o.inten[k] = I; if (hasRgb) { o.rgb[k * 3] = r * cscale; o.rgb[k * 3 + 1] = g * cscale; o.rgb[k * 3 + 2] = b * cscale; } };
  if (format === 'ascii') {
    const text = new TextDecoder().decode(bytes.subarray(dataStart)); let p = 0, skip = 0;
    for (let e = 0; e < vi; e++) skip += elements[e].count;
    const next = () => { if (p >= text.length) return null; let q = text.indexOf('\n', p); if (q < 0) q = text.length; const l = text.slice(p, q); p = q + 1; return l; };
    for (let i = 0; i < skip; i++) next();
    let got = 0;
    for (let i = 0; i < ve.count; i++) { const l = next(); if (l == null) break; got++; if (i % stride) continue; const t = l.trim().split(/\s+/); push(+t[ix], +t[iy], +t[iz], ii >= 0 ? +t[ii] : 0, hasRgb ? +t[ir] : 0, hasRgb ? +t[ig] : 0, hasRgb ? +t[ib] : 0); }
    if (got < ve.count * 0.999) return done(o, ve.count, 'The header promises ' + ve.count.toLocaleString() + ' points but the file ends after ' + got.toLocaleString() + '. The points that were there have been loaded.');
  } else {
    let off = dataStart;
    for (let e = 0; e < vi; e++) { if (elements[e].props.some((p) => p.list)) throw new Error('This PLY file stores a list element ("' + elements[e].name + '") before its points, which is not supported. Export the points first.'); off += elements[e].count * elements[e].props.reduce((s, p) => s + SIZES[p.type], 0); }
    const offs = []; let rec = 0; for (const p of ve.props) { offs.push(rec); rec += SIZES[p.type]; }
    const avail = Math.floor((bytes.length - off) / rec), cnt = Math.min(ve.count, avail);
    if (cnt <= 0) throw new Error('This PLY file ends right after its header: the header promises ' + ve.count.toLocaleString() + ' points but there is no data.');
    const dv = new DataView(buf, off), rd = (i, k) => dv[READ[ve.props[k].type]](i * rec + offs[k], true);
    for (let i = 0; i < cnt; i += stride) push(rd(i, ix), rd(i, iy), rd(i, iz), ii >= 0 ? rd(i, ii) : 0, hasRgb ? rd(i, ir) : 0, hasRgb ? rd(i, ig) : 0, hasRgb ? rd(i, ib) : 0);
    if (cnt < ve.count) return done(o, ve.count, 'The header promises ' + ve.count.toLocaleString() + ' points but the file only holds ' + cnt.toLocaleString() + '. Those have been loaded.');
  }
  return done(o, ve.count, stride > 1 ? 'Every ' + stride + (stride === 2 ? 'nd' : stride === 3 ? 'rd' : 'th') + ' point is kept so the scan stays interactive.' : null);
}

export function parseXYZ(buf) {
  const bytes = new Uint8Array(buf);
  let bin = 0; for (let i = 0; i < Math.min(bytes.length, 4000); i++) { const c = bytes[i]; if (c === 0 || (c < 9) || (c > 13 && c < 32)) bin++; }
  if (bin > 8) throw new Error('This file is binary, not text. An .xyz file must be plain text with one point per line: x y z.');
  const text = new TextDecoder().decode(bytes);
  let lines = 0; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  const stride = Math.max(1, Math.ceil((lines + 1) / MAX_POINTS));
  let o = null, p = 0, row = 0, bad = 0, good = 0, cols = 0;
  while (p < text.length) {
    let q = text.indexOf('\n', p); if (q < 0) q = text.length;
    const l = text.slice(p, q).trim(); p = q + 1;
    if (!l || l[0] === '#' || l[0] === '/') continue;
    const t = l.split(/[\s,;]+/), x = +t[0], y = +t[1], z = +t[2];
    if (t.length < 3 || !(isFinite(x) && isFinite(y) && isFinite(z)) || t[0] === '' ) { bad++; if (bad > 50 && bad > good * 5) break; continue; }
    if (!o) { cols = t.length; o = out(Math.ceil((lines + 1) / stride) + 4, cols >= 6); o.hasI = cols === 4 || cols >= 7; }
    good++;
    if (row++ % stride) continue;
    const k = o.n++; o.pos[k * 3] = x; o.pos[k * 3 + 1] = y; o.pos[k * 3 + 2] = z;
    if (o.hasI) o.inten[k] = +t[3] || 0;
    if (o.rgb) { const c = cols >= 7 ? 4 : 3; let r = +t[c] || 0, g = +t[c + 1] || 0, b = +t[c + 2] || 0; if (r <= 1 && g <= 1 && b <= 1 && (r % 1 || g % 1 || b % 1)) { r *= 255; g *= 255; b *= 255; } o.rgb[k * 3] = r; o.rgb[k * 3 + 1] = g; o.rgb[k * 3 + 2] = b; }
  }
  if (!o || good < 50) throw new Error(good === 0 ? 'No line of this file reads as three numbers (x y z). Expected plain text, one point per line, separated by spaces or commas.' : 'Only ' + good + ' lines of this file read as points (x y z). A scan needs at least 50.');
  const notes = []; if (bad) notes.push(bad.toLocaleString() + ' lines that were not numbers were skipped.'); if (stride > 1) notes.push('Every ' + stride + 'th point is kept so the scan stays interactive.');
  return done(o, good, notes.join(' ') || null);
}

export function parseCloud(name, buf) {
  if (!buf || buf.byteLength === 0) throw new Error('This file is empty.');
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'ply') return parsePLY(buf);
  if (['xyz', 'txt', 'csv', 'pts', 'asc'].includes(ext)) return parseXYZ(buf);
  const b = new Uint8Array(buf, 0, Math.min(3, buf.byteLength));
  if (b[0] === 112 && b[1] === 108 && b[2] === 121) return parsePLY(buf);
  if (['las', 'laz', 'e57', 'pcd', 'obj', 'glb', 'gltf', 'stl'].includes(ext)) throw new Error('.' + ext + ' files are not supported yet. Export the scan as .ply (ASCII or binary little-endian) or .xyz and drop it again.');
  throw new Error('"' + name + '" is not a .ply or .xyz file. Drop a point cloud saved as .ply (ASCII or binary little-endian) or .xyz.');
}

// A binary little-endian PLY of the current cloud, with intensity and the class the algorithm gave each point.
export function writePLY(pos, n, inten, cls) {
  const head = 'ply\nformat binary_little_endian 1.0\ncomment HOUND Command 3-D scan export. x east, y north, z up, metres.\ncomment class: 0 ground, 1 structure, 2 rubble, 3 vegetation (live algorithm)\nelement vertex ' + n + '\nproperty float x\nproperty float y\nproperty float z\nproperty uchar intensity\nproperty uchar class\nend_header\n';
  const hb = new TextEncoder().encode(head), buf = new ArrayBuffer(hb.length + n * 14), dv = new DataView(buf);
  new Uint8Array(buf).set(hb);
  for (let i = 0, o = hb.length; i < n; i++, o += 14) { dv.setFloat32(o, pos[i * 3], true); dv.setFloat32(o + 4, pos[i * 3 + 1], true); dv.setFloat32(o + 8, pos[i * 3 + 2], true); dv.setUint8(o + 12, inten[i]); dv.setUint8(o + 13, cls ? cls[i] : 0); }
  return buf;
}

// ---- floor plans
export function planToJSON(plan) {
  return JSON.stringify({ format: 'hound-floorplan', version: 1, units: 'm', note: 'x east, y north. Walls run from a to b. Made in HOUND Command.', size: plan.size, wallHeight: plan.wallHeight,
    walls: plan.walls.map((w) => ({ a: w.a, b: w.b, mat: w.mat, h: plan.wallHeight })), rubble: plan.rubble }, null, 1);
}
export function planFromJSON(text) {
  let j; try { j = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  if (!j || j.format !== 'hound-floorplan' || !Array.isArray(j.walls)) throw new Error('This JSON is not a HOUND floor plan (it needs "format": "hound-floorplan" and a list of walls).');
  const num = (v) => typeof v === 'number' && isFinite(v);
  const size = Array.isArray(j.size) && num(j.size[0]) && num(j.size[1]) ? [Math.min(60, Math.max(6, j.size[0])), Math.min(60, Math.max(6, j.size[1]))] : [30, 20];
  const walls = j.walls.filter((w) => w && Array.isArray(w.a) && Array.isArray(w.b) && [w.a[0], w.a[1], w.b[0], w.b[1]].every(num)).slice(0, 400).map((w) => ({ a: [w.a[0], w.a[1]], b: [w.b[0], w.b[1]], mat: w.mat === 'drywall' ? 'drywall' : 'concrete' }));
  if (!walls.length) throw new Error('This floor plan has no walls that can be read.');
  const rubble = (Array.isArray(j.rubble) ? j.rubble : []).filter((r) => r && Array.isArray(r.pos) && num(r.pos[0]) && num(r.pos[1])).slice(0, 40).map((r) => ({ pos: [r.pos[0], r.pos[1]], r: num(r.r) ? r.r : 1.6, h: num(r.h) ? r.h : 1.2 }));
  return { size, wallHeight: num(j.wallHeight) ? Math.min(6, Math.max(2, j.wallHeight)) : 3, walls, rubble };
}
