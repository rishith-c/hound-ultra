// The three small charts of the Valley workspace, drawn on canvas with the design tokens.
import { fmtDist, fmtClock } from './geo.js';

function setup(canvas) {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!r.width || !r.height) return null;
  if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
  const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, r.width, r.height);
  return { c, w: r.width, h: r.height };
}
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function tokens() {
  return { text: css('--text'), text2: css('--text-2'), text3: css('--text-3'), line: css('--line-2'), accent: css('--accent'), warn: css('--warn'), bg: css('--bg-4'), danger: css('--danger'), sun: css('--heat-5'),
    font: '11px ' + css('--font'), mono: '11px ' + css('--mono') };
}
function niceStep(span, target) { const raw = span / target, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }

// Elevation along the drawn line, with the water where the line crosses it. hover is a distance in metres or null.
export function drawProfile(canvas, prof, water, hover) {
  const s = setup(canvas); if (!s) return null; const { c, w, h } = s, T = tokens();
  const L = 60, Rr = 12, Tp = 8, B = 22, pw = w - L - Rr, ph = h - Tp - B, S = prof.samples;
  let zmin = Infinity, zmax = -Infinity;
  for (const p of S) if (p.z === p.z) { zmin = Math.min(zmin, p.z); zmax = Math.max(zmax, p.z); }
  if (water) for (const v of water) if (v > zmax) zmax = v;
  const pad = Math.max(8, (zmax - zmin) * 0.12); zmin -= pad * 0.4; zmax += pad;
  const X = (d) => L + (d / (prof.length || 1)) * pw, Y = (z) => Tp + (1 - (z - zmin) / (zmax - zmin)) * ph;
  c.font = T.mono; c.textBaseline = 'middle'; c.lineWidth = 1;
  const zs = niceStep(zmax - zmin, 4);
  for (let z = Math.ceil(zmin / zs) * zs; z <= zmax; z += zs) {
    c.strokeStyle = T.line; c.globalAlpha = 0.5; c.beginPath(); c.moveTo(L, Y(z) + 0.5); c.lineTo(w - Rr, Y(z) + 0.5); c.stroke(); c.globalAlpha = 1;
    c.fillStyle = T.text3; c.textAlign = 'right'; c.fillText(Math.round(z).toLocaleString('en') + ' m', L - 6, Y(z));
  }
  const ds = niceStep(prof.length, Math.max(3, Math.floor(pw / 90)));
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (let d = 0; d <= prof.length + 1; d += ds) { c.fillStyle = T.text3; c.fillText(d === 0 ? '0' : fmtDist(d), X(d), h - B + 6); c.strokeStyle = T.line; c.beginPath(); c.moveTo(X(d) + 0.5, h - B); c.lineTo(X(d) + 0.5, h - B + 4); c.stroke(); }
  // water first, so the ground is drawn over it
  if (water) {
    c.fillStyle = 'rgba(90,169,255,0.55)'; c.beginPath(); let open = -1;
    for (let i = 0; i < S.length; i++) {
      const wz = water[i];
      if (wz > S[i].z) { if (open < 0) { c.moveTo(X(S[i].d), Y(S[i].z)); open = i; } c.lineTo(X(S[i].d), Y(wz)); }
      if (open >= 0 && (!(wz > S[i].z) || i === S.length - 1)) { const end = wz > S[i].z ? i : i - 1; for (let q = end; q >= open; q--) c.lineTo(X(S[q].d), Y(S[q].z)); c.closePath(); open = -1; }
    }
    c.fill();
    // the water surface itself, so a few metres of water still read on a profile that spans hundreds
    c.strokeStyle = T.accent; c.lineWidth = 2; c.beginPath();
    for (let i = 1; i < S.length; i++) if (water[i] > S[i].z && water[i - 1] > S[i - 1].z) { c.moveTo(X(S[i - 1].d), Y(water[i - 1])); c.lineTo(X(S[i].d), Y(water[i])); }
    c.stroke();
  }
  const g = c.createLinearGradient(0, Tp, 0, h - B); g.addColorStop(0, 'rgba(168,178,191,0.34)'); g.addColorStop(1, 'rgba(168,178,191,0.04)');
  c.beginPath(); c.moveTo(X(0), h - B); for (const p of S) c.lineTo(X(p.d), Y(p.z)); c.lineTo(X(prof.length), h - B); c.closePath(); c.fillStyle = g; c.fill();
  c.lineJoin = 'round'; c.lineWidth = 1.6; c.strokeStyle = T.text; c.beginPath(); S.forEach((p, i) => (i ? c.lineTo(X(p.d), Y(p.z)) : c.moveTo(X(p.d), Y(p.z)))); c.stroke();
  // steep stretches, 35 degrees and more
  c.strokeStyle = T.warn; c.lineWidth = 2.4; c.beginPath();
  for (let i = 1; i < S.length; i++) if (S[i].slope >= 35) { c.moveTo(X(S[i - 1].d), Y(S[i - 1].z)); c.lineTo(X(S[i].d), Y(S[i].z)); }
  c.stroke();
  if (hover != null) {
    let i = 0; while (i < S.length - 1 && S[i].d < hover) i++;
    const p = S[i]; c.strokeStyle = T.accent; c.lineWidth = 1; c.beginPath(); c.moveTo(X(p.d) + 0.5, Tp); c.lineTo(X(p.d) + 0.5, h - B); c.stroke();
    c.fillStyle = T.accent; c.beginPath(); c.arc(X(p.d), Y(p.z), 4, 0, 7); c.fill();
    const label = Math.round(p.z).toLocaleString('en') + ' m at ' + fmtDist(p.d) + (p.slope != null ? ', slope ' + Math.round(p.slope) + '°' : '');
    c.font = T.mono; const tw = c.measureText(label).width + 12, tx = Math.min(w - Rr - tw, Math.max(L, X(p.d) - tw / 2));
    c.fillStyle = 'rgba(7,9,12,0.9)'; c.fillRect(tx, Tp, tw, 18); c.fillStyle = T.text; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(label, tx + 6, Tp + 9);
    return p;
  }
  return { toDist: (px) => Math.max(0, Math.min(prof.length, ((px - L) / pw) * prof.length)) };
}
export const profileDist = (canvas, prof, clientX) => { const r = canvas.getBoundingClientRect(); return Math.max(0, Math.min(prof.length, ((clientX - r.left - 60) / (r.width - 72)) * prof.length)); };

// Area under water (hectares) against water level (m), with the current level marked.
export function drawStageCurve(canvas, model, stage, max) {
  const s = setup(canvas); if (!s) return; const { c, w, h } = s, T = tokens();
  const L = 34, Rr = 8, Tp = 6, B = 18, pw = w - L - Rr, ph = h - Tp - B, ha = (v) => (model.countBelow(v) * model.cellArea) / 1e4, top = ha(max);
  const X = (v) => L + (v / max) * pw, Y = (a) => Tp + (1 - a / top) * ph;
  c.font = T.mono; c.fillStyle = T.text3; c.textBaseline = 'middle'; c.textAlign = 'right';
  for (const a of [0, top / 2, top]) { c.fillText(Math.round(a), L - 5, Y(a)); c.strokeStyle = T.line; c.globalAlpha = 0.5; c.beginPath(); c.moveTo(L, Y(a) + 0.5); c.lineTo(w - Rr, Y(a) + 0.5); c.stroke(); c.globalAlpha = 1; }
  c.textAlign = 'center'; c.textBaseline = 'top'; for (const v of [0, 15, 30, 45]) c.fillText('+' + v + ' m', Math.min(w - 20, Math.max(L + 10, X(v))), h - B + 5);
  c.beginPath(); c.moveTo(X(0), Y(0)); for (let v = 0; v <= stage; v += 0.5) c.lineTo(X(v), Y(ha(v))); c.lineTo(X(stage), Y(0)); c.closePath(); c.fillStyle = 'rgba(90,169,255,0.3)'; c.fill();
  c.beginPath(); for (let v = 0; v <= max; v += 0.5) (v ? c.lineTo(X(v), Y(ha(v))) : c.moveTo(X(v), Y(ha(v)))); c.strokeStyle = T.text2; c.lineWidth = 1.4; c.stroke();
  c.fillStyle = T.accent; c.beginPath(); c.arc(X(stage), Y(ha(stage)), 3.5, 0, 7); c.fill();
}

// The terrain horizon seen from the block, and the sun's path across it today.
// horizon: 360 values (degrees up, by azimuth). path: [{ min, az, alt }]. now: { az, alt }.
export function drawHorizon(canvas, horizon, path, now) {
  const s = setup(canvas); if (!s) return; const { c, w, h } = s, T = tokens();
  const L = 26, Rr = 6, Tp = 6, B = 18, pw = w - L - Rr, ph = h - Tp - B, A0 = 60, A1 = 300, top = 70;
  const X = (az) => L + ((az - A0) / (A1 - A0)) * pw, Y = (alt) => Tp + (1 - Math.max(0, alt) / top) * ph;
  c.font = T.mono; c.fillStyle = T.text3; c.textBaseline = 'middle'; c.textAlign = 'right';
  for (const a of [0, 30, 60]) { c.fillText(a + '°', L - 4, Y(a)); c.strokeStyle = T.line; c.globalAlpha = 0.45; c.beginPath(); c.moveTo(L, Y(a) + 0.5); c.lineTo(w - Rr, Y(a) + 0.5); c.stroke(); c.globalAlpha = 1; }
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (const [az, name] of [[90, 'East'], [135, 'SE'], [180, 'South'], [225, 'SW'], [270, 'West']]) c.fillText(name, X(az), h - B + 5);
  c.save(); c.beginPath(); c.rect(L, Tp, pw, ph); c.clip();
  // sun path: bright where it clears the terrain, faint where a ridge is in the way
  for (const lit of [false, true]) {
    c.beginPath(); let pen = false;
    for (const p of path) { const ok = p.alt > 0 && p.az >= A0 && p.az <= A1 && (p.alt > horizon[Math.round(p.az) % 360]) === lit; if (ok) { pen ? c.lineTo(X(p.az), Y(p.alt)) : c.moveTo(X(p.az), Y(p.alt)); pen = true; } else pen = false; }
    c.strokeStyle = lit ? T.sun : T.text3; c.lineWidth = lit ? 2 : 1.2; c.setLineDash(lit ? [] : [2, 3]); c.stroke(); c.setLineDash([]);
  }
  c.beginPath(); c.moveTo(X(A0), Y(0));
  for (let az = A0; az <= A1; az++) c.lineTo(X(az), Y(horizon[az % 360]));
  c.lineTo(X(A1), Y(0)); c.closePath();
  const g = c.createLinearGradient(0, Tp, 0, h - B); g.addColorStop(0, 'rgba(116,128,142,0.75)'); g.addColorStop(1, 'rgba(35,42,52,0.9)'); c.fillStyle = g; c.fill();
  c.strokeStyle = T.text2; c.lineWidth = 1; c.beginPath(); for (let az = A0; az <= A1; az++) (az === A0 ? c.moveTo(X(az), Y(horizon[az % 360])) : c.lineTo(X(az), Y(horizon[az % 360]))); c.stroke();
  for (const p of path) if (p.min % 180 === 0 && p.alt > 2 && p.az > A0 + 8 && p.az < A1 - 8) { c.fillStyle = T.text2; c.textBaseline = 'bottom'; c.fillText(fmtClock(p.min), X(p.az), Y(p.alt) - 5); c.fillStyle = T.text3; c.beginPath(); c.arc(X(p.az), Y(p.alt), 1.6, 0, 7); c.fill(); }
  if (now && now.alt > 0 && now.az >= A0 && now.az <= A1) {
    const lit = now.alt > horizon[Math.round(now.az) % 360];
    c.fillStyle = lit ? T.sun : T.text3; c.beginPath(); c.arc(X(now.az), Y(now.alt), 5, 0, 7); c.fill(); c.strokeStyle = 'rgba(7,9,12,0.9)'; c.lineWidth = 1.5; c.stroke();
  }
  c.restore();
}
