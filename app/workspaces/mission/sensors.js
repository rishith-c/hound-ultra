// Drawings for the live sensor stack in the inspector: the Wi-Fi window, the radar plot and the thermal frame.
const RAMP = [[16, 21, 28], [43, 63, 107], [122, 63, 143], [216, 80, 77], [255, 178, 74], [255, 243, 196]]; // the --heat-* tokens
function ramp(v) { v = Math.max(0, Math.min(0.9999, v)) * (RAMP.length - 1); const i = Math.floor(v), f = v - i, a = RAMP[i], b = RAMP[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }

const winCache = new Map();
// The 52 by 200 Wi-Fi window the network just read, as an image (rows: subcarriers, columns: time).
export function windowImage(nn, index) {
  if (winCache.has(index)) return winCache.get(index);
  const x = nn.samples[index].x, c = document.createElement('canvas'); c.width = 200; c.height = 52;
  const g = c.getContext('2d'), img = g.createImageData(200, 52);
  let lo = Infinity, hi = -Infinity; for (const row of x) for (const v of row) { if (v < lo) lo = v; if (v > hi) hi = v; }
  lo = Math.max(lo, -3); hi = Math.min(hi, 3);
  for (let r = 0; r < 52; r++) for (let t = 0; t < 200; t++) { const [R, G, B] = ramp((x[r][t] - lo) / (hi - lo || 1)); const k = (r * 200 + t) * 4; img.data[k] = R; img.data[k + 1] = G; img.data[k + 2] = B; img.data[k + 3] = 255; }
  g.putImageData(img, 0, 0); winCache.set(index, c); return c;
}

export function drawWindow(canvas, { nn, sample, progress, C }) {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  g.fillStyle = 'rgb(16,21,28)'; g.fillRect(0, 0, W, H);
  if (progress != null) { // collecting: packets arriving, nothing to show the network yet
    const n = Math.floor(progress * 100); g.fillStyle = 'rgba(120,175,235,0.5)';
    for (let i = 0; i < n; i++) { const x = (i / 100) * W; const hgt = H * (0.25 + 0.5 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1)); g.fillRect(x, (H - hgt) / 2, Math.max(1, W / 100 - 1), hgt); }
    g.fillStyle = 'rgba(205,228,255,0.9)'; g.fillRect(progress * W, 0, 1.5, H);
  } else if (sample != null) { g.imageSmoothingEnabled = false; g.drawImage(windowImage(nn, sample), 0, 0, W, H); }
  else { g.strokeStyle = 'rgba(255,255,255,0.06)'; for (let x = 0; x < W; x += 12) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); } }
}

// Radar plot: the rover at the bottom centre looking up, 120 degree field of view, rings every 2 m.
export function drawRadar(canvas, { S, world, C, live }) {
  const dpr = canvas.width / canvas.clientWidth || 1, g = canvas.getContext('2d'), W = canvas.clientWidth, H = canvas.clientHeight;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H - 14, R = Math.min(H - 26, W / 2 / Math.sin(Math.PI / 3) - 4), range = world.SENSORS.radar.range, fov = Math.PI / 3;
  g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, -Math.PI / 2 - fov, -Math.PI / 2 + fov); g.closePath(); g.fillStyle = 'rgba(255,255,255,0.03)'; g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
  for (let m = 2; m <= range; m += 2) { g.beginPath(); g.arc(cx, cy, (m / range) * R, -Math.PI / 2 - fov, -Math.PI / 2 + fov); g.stroke(); g.font = '500 9.5px ' + C.mono; g.fillStyle = C.text3; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(m + ' m', cx + Math.sin(fov) * (m / range) * R + 4, cy - Math.cos(fov) * (m / range) * R); }
  for (const a of [-fov, 0, fov]) { g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R); g.stroke(); }
  g.fillStyle = C.text2; g.beginPath(); g.moveTo(cx, cy - 6); g.lineTo(cx - 5, cy + 4); g.lineTo(cx + 5, cy + 4); g.closePath(); g.fill();
  const rover = S.units['HOUND-01'], targets = live ? S.sensors.radar.targets : [];
  let n = 0;
  for (const tg of targets) {
    const dx = tg.pos[0] - rover.pos[0], dy = tg.pos[1] - rover.pos[1], d = Math.hypot(dx, dy);
    // the radar module sees all round in this simulation; targets behind the 120 degree cone are drawn at its edge
    let a = Math.atan2(dy, dx) - rover.heading; a = Math.atan2(Math.sin(a), Math.cos(a)); const b = Math.max(-fov, Math.min(fov, -a));
    const x = cx + Math.sin(b) * (d / range) * R, y = cy - Math.cos(b) * (d / range) * R; n++;
    g.strokeStyle = tg.kind === 'periodic' ? C.text2 : C.text; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 5, 0, 7); g.stroke(); g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x - 5, y); g.moveTo(x + 5, y); g.lineTo(x + 9, y); g.moveTo(x, y - 9); g.lineTo(x, y - 5); g.moveTo(x, y + 5); g.lineTo(x, y + 9); g.stroke();
    g.font = '500 10px ' + C.mono; g.fillStyle = C.text; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(d.toFixed(1) + ' m', x, y - 11);
  }
  return n;
}

// Thermal frame: 32 by 24 pixels, built from the warm shapes the simulator reported (bearing, distance, temperature).
export function drawThermal(canvas, { thermal, world, live }) {
  const g = canvas.getContext('2d'); canvas.width = 32; canvas.height = 24;
  const img = g.createImageData(32, 24), amb = thermal?.ambientC ?? 19.5, fov = (world.SENSORS.thermal.fovDeg * Math.PI) / 180;
  let peak = amb;
  for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
    let T = amb + (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1) * 0.5 + (y / 24) * 0.6;
    if (live && thermal?.ok) for (const b of thermal.blobs) {
      let a = b.bearing - thermal.heading; a = Math.atan2(Math.sin(a), Math.cos(a)); if (Math.abs(a) > fov / 2 + 0.2) continue;
      const bx = 16 - (a / (fov / 2)) * 16, by = 14, s = Math.max(1.6, 7 / Math.max(1, b.dist)), sy = b.tempC > 45 ? s * 0.6 : s * 1.5;
      T += (b.tempC - amb) * Math.exp(-(((x - bx) / s) ** 2 + ((y - by) / sy) ** 2)) * (b.strength === 'faint' ? 0.7 : 1);
    }
    if (T > peak) peak = T;
    const v = (T - (amb - 1)) / 22, [R, G, B] = ramp(v), k = (y * 32 + x) * 4; img.data[k] = R; img.data[k + 1] = G; img.data[k + 2] = B; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return peak;
}
