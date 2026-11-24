// Instruments: what each sensor reported at the last stop, drawn the way the sensor itself sees the world.
// The radar, thermal and distance readings come from the simulator (state.sensors). The Wi-Fi window is one of the
// 30 held-out simulated test windows, and the verdict under it is the real network's output for that window.
import { tokens, rgba, rampRGB, clamp, mulberry, gaussian, roundRect, STATUS } from './util.js';

const DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createInstruments(host, ctx, api) {
  const { h, fmt, realityTag } = ctx.kit, W = ctx.world;
  let isDirty = true;
  function make(title, tag, sub) {
    const canvas = h('canvas.fusion-inst-canvas'), cap = h('div.fusion-inst-cap', null, h('b.num'), h('span'));
    const p = ctx.kit.panel(title, { tag, flush: true }, h('div.fusion-inst-body', null, h('p.fusion-inst-sub', null, sub), canvas, cap));
    p.classList.add('fusion-instp'); host.append(p);
    const o = { canvas, cap, big: cap.firstChild, small: cap.lastChild, size: { w: 0, h: 0 } };
    ctx.kit.fitCanvas(canvas, (c, w, hh) => { o.size = { w, h: hh }; isDirty = true; });
    return o;
  }
  const radar = make('Radar', realityTag('sim'), '24 GHz, reach 6 m (design value)');
  const thermal = make('Thermal', realityTag('sim'), '32 × 24 = 768 pixels');
  const wifi = make('Wi-Fi window', realityTag('live-ai'), 'Input: 52 rows × 10 s');
  radar.canvas.setAttribute('role', 'img'); thermal.canvas.setAttribute('role', 'img'); wifi.canvas.setAttribute('role', 'img');

  const age = (S, t) => (t == null ? '' : fmt.clock(Math.max(0, S.t - t)) + ' ago');
  const headingAtReading = (S) => S.sensors.thermal?.heading ?? S.units['HOUND-01'].heading;

  // ------------------------------------------------------------------ radar
  let radarHits = [];
  function drawRadar(S) {
    const { w, h: hh } = radar.size; if (!w) return;
    const c = radar.canvas.getContext('2d'), T = tokens(); c.clearRect(0, 0, w, hh);
    const strip = 68, R = Math.max(30, Math.min(w / 2 - 16, (hh - strip - 16) / 2)), cx = w / 2, cy = 9 + R, s = R / 6;
    const has = S.sensors.at != null, key = S.sensors.stop, rover = S.units['HOUND-01'];
    const o = has ? api.originOf(key).pos : rover.pos;
    const PX = (p) => cx + (p[0] - o[0]) * s, PY = (p) => cy - (p[1] - o[1]) * s;
    const font = (wt, px, mono) => (c.font = wt + ' ' + px + 'px ' + (mono ? T.mono : T.font));
    // scope
    c.save(); c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fillStyle = T.bg1; c.fill(); c.clip();
    for (const wl of W.WALLS) { if (wl.state === 'collapsed') continue; c.beginPath(); c.moveTo(PX(wl.a), PY(wl.a)); c.lineTo(PX(wl.b), PY(wl.b)); c.strokeStyle = rgba(T.text2, wl.mat === 'concrete' ? 0.5 : 0.32); c.lineWidth = wl.mat === 'concrete' ? 2 : 1.2; c.stroke(); }
    const targets = has ? S.sensors.radar.targets || [] : [];
    const heading = has ? headingAtReading(S) : rover.heading;
    let aim = heading, turned = false;
    if (targets.length) {
      let sx = 0, sy = 0; for (const t of targets) { const a = Math.atan2(t.pos[1] - o[1], t.pos[0] - o[0]); sx += Math.cos(a); sy += Math.sin(a); }
      const mean = Math.atan2(sy, sx);
      if (targets.some((t) => Math.abs(wrap(Math.atan2(t.pos[1] - o[1], t.pos[0] - o[0]) - heading)) > 60 * DEG)) { aim = mean; turned = true; }
    }
    c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, -(aim + 60 * DEG), -(aim - 60 * DEG)); c.closePath(); c.fillStyle = rgba(T.accent, 0.09); c.fill();
    c.strokeStyle = rgba(T.accent, 0.5); c.lineWidth = 1; c.beginPath(); for (const e of [-60, 60]) { c.moveTo(cx, cy); c.lineTo(cx + Math.cos(aim + e * DEG) * R, cy - Math.sin(aim + e * DEG) * R); } c.stroke();
    // presence radar: range only, so a still target is somewhere on a ring
    let gate = null;
    if (has && S.sensors.micro?.still) for (const d of S.detections) for (const e of d.evidence) if (e.sensor === 'micro' && e.result === 'pos' && e.vantage === key && e.t === S.sensors.micro.t) { const m = /([\d.]+) m range gate/.exec(e.note || ''); if (m) gate = { r: +m[1], det: d }; }
    if (gate) {
      c.beginPath(); c.arc(cx, cy, (gate.r + 0.375) * s, 0, Math.PI * 2); c.arc(cx, cy, Math.max(0, gate.r - 0.375) * s, 0, Math.PI * 2, true); c.fillStyle = rgba(T.warn, 0.2); c.fill();
      c.setLineDash([3, 3]); c.strokeStyle = rgba(T.warn, 0.9); c.beginPath(); c.arc(cx, cy, gate.r * s, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    }
    c.restore();
    for (const r of [2, 4, 6]) { c.beginPath(); c.arc(cx, cy, r * s, 0, Math.PI * 2); c.strokeStyle = r === 6 ? T.line2 : T.line; c.lineWidth = 1; c.stroke(); font(500, 9.5, true); c.fillStyle = T.text3; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(r + ' m', cx + 3, cy + r * s - 6); }
    for (let a = 0; a < 360; a += 30) { const x = Math.cos(a * DEG), y = Math.sin(a * DEG); c.beginPath(); c.moveTo(cx + x * R, cy - y * R); c.lineTo(cx + x * (R + (a % 90 ? 3 : 5)), cy - y * (R + (a % 90 ? 3 : 5))); c.strokeStyle = T.line2; c.stroke(); }
    font(600, 9.5, false); c.fillStyle = T.text3; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('N', cx + 4, cy - R + 3);
    // trails and targets
    radarHits = [];
    for (const d of S.detections) {
      const pts = has ? d.evidence.filter((e) => e.sensor === 'radar' && e.est && e.vantage === key).map((e) => e.est) : [];
      if (!pts.length) continue;
      const col = T[(STATUS[d.status] || STATUS.new).color], last = pts[pts.length - 1], tg = targets.find((t) => t.pos[0] === last[0] && t.pos[1] === last[1]);
      c.strokeStyle = rgba(col === T.text3 ? T.text2 : col, 0.6); c.lineWidth = 1; c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(PX(p), PY(p)) : c.moveTo(PX(p), PY(p)))); c.stroke();
      pts.slice(0, -1).forEach((p) => { c.fillStyle = rgba(T.text, 0.45); c.beginPath(); c.arc(PX(p), PY(p), 1.8, 0, Math.PI * 2); c.fill(); });
      if (!tg) continue;
      const x = PX(last), y = PY(last);
      if (tg.kind === 'periodic') { c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.strokeStyle = T.text; c.lineWidth = 1.6; c.strokeRect(-3.5, -3.5, 7, 7); c.restore(); }
      else { c.fillStyle = T.text; c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill(); c.strokeStyle = rgba(col, 0.9); c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.stroke(); }
      font(600, 10, true); c.fillStyle = T.text; const lab = d.id + (tg.kind === 'periodic' ? ' steady' : ' ' + tg.v.toFixed(2) + ' m/s'), tw = c.measureText(lab).width, left = x + 11 + tw > w - 2;
      c.textAlign = left ? 'right' : 'left'; c.textBaseline = 'middle'; c.fillText(lab, left ? x - 11 : x + 11, y - 9);
      radarHits.push({ x, y, id: d.id });
    }
    if (gate) { font(600, 10, true); c.fillStyle = T.warn; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(gate.det.id + ' still, ' + gate.r.toFixed(2) + ' m', cx, cy - gate.r * s - 3 < 22 ? cy + gate.r * s + 13 : cy - gate.r * s - 3); radarHits.push({ x: cx, y: cy - gate.r * s, id: gate.det.id }); }
    // the rover
    c.save(); c.translate(cx, cy); c.rotate(-heading); c.fillStyle = T.text; roundRect(c, -5, -3.5, 10, 7, 2); c.fill(); c.fillStyle = T.accent; c.beginPath(); c.moveTo(8, 0); c.lineTo(4, -2.6); c.lineTo(4, 2.6); c.closePath(); c.fill(); c.restore();

    // presence gates, 0.75 m each
    const gy = cy + R + 17, gx0 = 12, gw = w - 24, n = 6, cw = gw / n;
    font(500, 9.5, false); c.fillStyle = T.text3; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText('Stillness by range gate (0.75 m each)', gx0, gy - 3);
    for (let i = 0; i < n; i++) {
      const on = gate && Math.round(gate.r / 0.75) - 1 === i;
      c.fillStyle = on ? rgba(T.warn, 0.85) : T.bg3; roundRect(c, gx0 + i * cw + 1, gy, cw - 2, 9, 2); c.fill();
      font(500, 9, true); c.fillStyle = on ? T.warn : T.text3; c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(((i + 1) * 0.75).toFixed(2).replace(/0$/, ''), gx0 + i * cw + cw / 2, gy + 11);
    }
    // distances: front to the right, rear to the left, 4 m full scale
    const dy = gy + 36, mid = w / 2, half = w / 2 - 14, tof = has ? S.sensors.tof : null;
    c.strokeStyle = T.line2; c.lineWidth = 1; c.beginPath(); c.moveTo(mid - half, dy); c.lineTo(mid + half, dy); c.stroke();
    for (let m = -4; m <= 4; m++) { const x = mid + (m / 4) * half; c.beginPath(); c.moveTo(x, dy - 2); c.lineTo(x, dy + 2); c.stroke(); }
    c.fillStyle = T.text; roundRect(c, mid - 6, dy - 4, 12, 8, 2); c.fill();
    if (tof) for (const [d, sgn] of [[tof.front, 1], [tof.rear, -1]]) {
      const x = mid + sgn * (clamp(d, 0, 4) / 4) * half;
      c.strokeStyle = T.accent; c.lineWidth = 2; c.beginPath(); c.moveTo(mid + sgn * 7, dy); c.lineTo(x, dy); c.stroke(); c.fillStyle = T.text2; c.fillRect(x - 1, dy - 6, 2, 12);
    }
    font(500, 9.5, true); c.fillStyle = T.text2; c.textBaseline = 'top';
    c.textAlign = 'left'; c.fillText('rear ' + (tof ? tof.rear.toFixed(2) + ' m' : '–'), mid - half, dy + 8); c.textAlign = 'right'; c.fillText('front ' + (tof ? tof.front.toFixed(2) + ' m' : '–'), mid + half, dy + 8);

    const movers = targets.filter((t) => t.kind === 'moving').length, steady = targets.length - movers;
    radar.big.textContent = !has ? 'No reading yet' : targets.length ? (movers ? movers + ' moving target' + (movers > 1 ? 's' : '') : steady + ' steady target' + (steady > 1 ? 's' : '')) : gate ? 'Stillness at ' + gate.r.toFixed(2) + ' m' : 'No target';
    radar.small.textContent = !has ? 'The radar reports each time the rover stops to listen.'
      : 'At ' + key + ', ' + age(S, S.sensors.radar.t) + '. ' + (gate ? 'The presence radar measures range only: the still target is somewhere on the amber ring. ' : targets.length ? '' : 'Nothing moving inside 6 m. ')
        + (turned ? 'Field drawn toward the target.' : gate ? '' : 'Blue wedge: the tracking radar’s 120° field.');
    radar.canvas.setAttribute('aria-label', 'Radar plot. ' + radar.big.textContent + '. ' + radar.small.textContent);
  }
  radar.canvas.addEventListener('click', (e) => { const r = radar.canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; const t = radarHits.find((q) => Math.hypot(q.x - mx, q.y - my) < 16); if (t) api.pick({ type: 'detection', id: t.id }); });

  // ------------------------------------------------------------------ thermal
  const NX = 32, NY = 24, FOVH = 110 * DEG, FOVV = 75 * DEG, CAM_H = 0.25;
  let thermalKey = '', frame = null;
  function synthFrame(th, aim, seed) {
    const rnd = mulberry(seed), amb = th.ambientC ?? 19.5, data = new Float32Array(NX * NY), ph = (seed % 97) / 15;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const el = (0.5 - (j + 0.5) / NY) * FOVV;
      let t = amb + 0.35 * Math.sin(i * 0.31 + ph) * Math.cos(j * 0.23 + ph * 1.7);
      if (el < -0.03) t -= 0.5 * clamp(-el / 0.5, 0, 1); // the floor is a little cooler than the walls
      data[j * NX + i] = t;
    }
    for (const b of th.blobs || []) {
      const az = wrap(b.bearing - aim); if (Math.abs(az) > FOVH / 2 + 0.2) continue;
      const u0 = (0.5 - az / FOVH) * NX, el0 = Math.atan2(0.2 - CAM_H, b.dist), v0 = (0.5 - el0 / FOVV) * NY;
      const ru = (Math.atan(0.45 / b.dist) / FOVH) * NX, rv = (Math.atan(0.22 / b.dist) / FOVV) * NY;
      const cov = new Float32Array(NX * NY); let peak = 0;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        let n = 0;
        for (let sj = 0; sj < 4; sj++) for (let si = 0; si < 4; si++) {
          const u = i + (si + 0.5) / 4, v = j + (sj + 0.5) / 4, du = (u - u0) / ru, dv = (v - v0) / rv;
          if (du * du + dv * dv <= 1 && (b.strength !== 'faint' || dv < -0.35)) n++; // faint: only the top edge shows above the furniture
        }
        cov[j * NX + i] = n / 16;
      }
      const blur = new Float32Array(NX * NY); // the optics spread a little heat into the neighbouring pixels
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        let sum = 0, wsum = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const x = i + di, y = j + dj; if (x < 0 || y < 0 || x >= NX || y >= NY) continue; const k = (di ? 1 : 2) * (dj ? 1 : 2); sum += cov[y * NX + x] * k; wsum += k; }
        blur[j * NX + i] = sum / wsum; if (blur[j * NX + i] > peak) peak = blur[j * NX + i];
      }
      if (peak > 0) for (let k = 0; k < data.length; k++) data[k] += (b.tempC - amb) * (blur[k] / peak);
    }
    for (let k = 0; k < data.length; k++) data[k] += 0.12 * gaussian(rnd);
    let max = -Infinity, at = 0; for (let k = 0; k < data.length; k++) if (data[k] > max) { max = data[k]; at = k; }
    return { data, amb, max, pi: at % NX, pj: Math.floor(at / NX) };
  }
  function drawThermal(S, now) {
    const { w, h: hh } = thermal.size; if (!w) return;
    const c = thermal.canvas.getContext('2d'), T = tokens(); c.clearRect(0, 0, w, hh);
    const th = S.sensors.thermal, px = Math.max(2, Math.floor(Math.min((w - 16) / NX, (hh - 46) / NY))), fw = px * NX, fh = px * NY, fx = Math.round((w - fw) / 2), fy = 6;
    const font = (wt, p, mono) => (c.font = wt + ' ' + p + 'px ' + (mono ? T.mono : T.font));
    c.fillStyle = T.bg1; c.fillRect(fx - 1, fy - 1, fw + 2, fh + 2);
    if (!th || !th.ok) {
      c.strokeStyle = T.line; c.lineWidth = 1; c.beginPath(); for (let i = 0; i <= NX; i += 4) { c.moveTo(fx + i * px + 0.5, fy); c.lineTo(fx + i * px + 0.5, fy + fh); } for (let j = 0; j <= NY; j += 4) { c.moveTo(fx, fy + j * px + 0.5); c.lineTo(fx + fw, fy + j * px + 0.5); } c.stroke();
      font(500, 11, false); c.fillStyle = th ? T.warn : T.text3; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(th ? 'Camera not responding' : 'No frame yet', w / 2, fy + fh / 2);
      thermal.big.textContent = th ? 'Offline' : 'No frame yet';
      thermal.small.textContent = th ? 'Fusion carries on without thermal and marks every affected reading.' : 'The camera reports each time the rover stops to listen.';
      thermal.canvas.setAttribute('aria-label', 'Thermal camera. ' + thermal.big.textContent); return;
    }
    const rover = S.units['HOUND-01'], heading = th.heading ?? rover.heading;
    let aim = heading, turned = false;
    if (th.blobs.length && th.blobs.some((b) => Math.abs(wrap(b.bearing - heading)) > FOVH / 2 - 0.1)) { let sx = 0, sy = 0; for (const b of th.blobs) { sx += Math.cos(b.bearing); sy += Math.sin(b.bearing); } aim = Math.atan2(sy, sx); turned = true; }
    const tick = ctx.kit.reducedMotion() ? 0 : Math.floor(now / 250);
    const k = th.t + '|' + th.blobs.length + '|' + tick;
    if (k !== thermalKey) { thermalKey = k; frame = synthFrame(th, aim, Math.round(th.t * 10) * 131 + tick * 7 + 1); }
    const lo = frame.amb - 2.5, hi = Math.max(42, Math.ceil(frame.max + 1));
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const [r, g, b] = rampRGB(T.heat, (frame.data[j * NX + i] - lo) / (hi - lo)); c.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')'; c.fillRect(fx + i * px, fy + j * px, px - (px > 3 ? 0.5 : 0), px - (px > 3 ? 0.5 : 0)); }
    // peak pixel
    const qx = fx + frame.pi * px, qy = fy + frame.pj * px; c.strokeStyle = T.text; c.lineWidth = 1; c.strokeRect(qx - 1.5, qy - 1.5, px + 2.5, px + 2.5);
    c.beginPath(); c.moveTo(qx + px / 2, qy - 6); c.lineTo(qx + px / 2, qy - 2); c.moveTo(qx + px / 2, qy + px + 2); c.lineTo(qx + px / 2, qy + px + 6); c.moveTo(qx - 6, qy + px / 2); c.lineTo(qx - 2, qy + px / 2); c.moveTo(qx + px + 2, qy + px / 2); c.lineTo(qx + px + 6, qy + px / 2); c.stroke();
    // size note on the frame
    font(600, 9.5, true); const note = '32 × 24 px'; const nw = c.measureText(note).width + 8; c.fillStyle = rgba(T.bg0, 0.75); c.fillRect(fx, fy, nw, 14); c.fillStyle = T.text; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(note, fx + 4, fy + 7.5);
    // scale
    const sy = fy + fh + 8, sw = fw; for (let x = 0; x < sw; x++) { const [r, g, b] = rampRGB(T.heat, x / (sw - 1)); c.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')'; c.fillRect(fx + x, sy, 1, 6); }
    const sx = (t) => fx + ((t - lo) / (hi - lo)) * sw;
    c.strokeStyle = T.text2; c.lineWidth = 1; c.beginPath(); c.moveTo(sx(28), sy + 9.5); c.lineTo(sx(37), sy + 9.5); c.moveTo(sx(28) + 0.5, sy + 7); c.lineTo(sx(28) + 0.5, sy + 12); c.moveTo(sx(37) - 0.5, sy + 7); c.lineTo(sx(37) - 0.5, sy + 12); c.stroke();
    font(500, 9.5, true); c.fillStyle = T.text3; c.textBaseline = 'top'; c.textAlign = 'left'; c.fillText(lo.toFixed(0) + ' °C', fx, sy + 14); c.textAlign = 'right'; c.fillText(hi.toFixed(0) + ' °C', fx + sw, sy + 14);
    c.textAlign = 'center'; c.fillStyle = T.text2; c.fillText('skin', (sx(28) + sx(37)) / 2, sy + 14);
    c.fillStyle = T.text; c.beginPath(); const mx = clamp(sx(frame.max), fx, fx + sw); c.moveTo(mx, sy - 1); c.lineTo(mx - 3.5, sy - 6); c.lineTo(mx + 3.5, sy - 6); c.closePath(); c.fill();

    const warm = th.blobs.length;
    thermal.big.textContent = 'Peak ' + frame.max.toFixed(1) + ' °C';
    thermal.small.textContent = (warm ? (frame.max > 40 ? 'Far hotter than skin: not a body. ' : frame.max >= 28 ? 'Inside the skin range. ' : 'A faint warm edge. ') : 'No warm shape. ')
      + 'One square = one pixel. Synthesised from the simulator’s heat sources; sizes' + (turned ? ' and aim are design values.' : ' are design values.');
    thermal.canvas.setAttribute('aria-label', 'Thermal frame, 32 by 24 pixels. ' + thermal.big.textContent + '. ' + thermal.small.textContent);
  }

  // ------------------------------------------------------------------ Wi-Fi window
  const imgCache = new Map();
  function windowImage(idx) {
    if (imgCache.has(idx)) return imgCache.get(idx);
    const s = ctx.nn.samples[idx]; if (!s) return null;
    const rows = s.x.length, cols = s.x[0].length, cv = document.createElement('canvas'); cv.width = cols; cv.height = rows;
    const g = cv.getContext('2d'), im = g.createImageData(cols, rows), T = tokens(), stops = [T.bg1, T.heat[1], T.accent, T.text];
    const all = []; for (const r of s.x) for (let i = 0; i < r.length; i += 3) all.push(r[i]); all.sort((a, b) => a - b);
    const lo = all[Math.floor(all.length * 0.02)], hi = all[Math.floor(all.length * 0.98)];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const [r, gg, b] = rampRGB(stops, (s.x[j][i] - lo) / (hi - lo || 1)); const k = (j * cols + i) * 4; im.data[k] = r; im.data[k + 1] = gg; im.data[k + 2] = b; im.data[k + 3] = 255; }
    g.putImageData(im, 0, 0); imgCache.set(idx, cv); return cv;
  }
  let worker = null, pred = { token: '', sample: null };
  function predict(S) {
    const L = S.sensors.listen; if (!L) return;
    const log = ctx.sim.commandLog, token = [S.seed, S.windows, L.stop, L.window, Math.round(S.t - L.progress * L.dur), log.length].join('|');
    if (token === pred.token) return;
    pred = { token, sample: null };
    try {
      if (!worker) {
        worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (e) => { if (e.data.type === 'predicted' && e.data.token === pred.token) { pred.sample = e.data.sample; isDirty = true; } };
        worker.onerror = () => { worker = null; };
      }
      worker.postMessage({ type: 'predict', token, seed: S.seed, windows: S.windows, log, t: S.t, stop: L.stop, window: L.window, pos: S.units['HOUND-01'].pos, autoplay: [S.autoplay, !S.autoplay] });
    } catch { worker = null; }
  }
  function drawWifi(S, now) {
    const { w, h: hh } = wifi.size; if (!w) return;
    const c = wifi.canvas.getContext('2d'), T = tokens(); c.clearRect(0, 0, w, hh);
    const L = S.sensors.listen, csi = S.sensors.csi, gx = 10, gw = w - 20, gy = 6, gh = Math.max(40, hh - 78);
    const font = (wt, p, mono) => (c.font = wt + ' ' + p + 'px ' + (mono ? T.mono : T.font));
    c.fillStyle = T.bg1; c.fillRect(gx, gy, gw, gh); c.imageSmoothingEnabled = false;
    let idx = null, prog = 1, state = 'none';
    if (L) { predict(S); idx = pred.sample; prog = L.progress; state = 'listening'; }
    else if (csi?.ok) { idx = csi.sample; state = 'done'; }
    else if (csi) state = 'failed';
    const img = idx != null ? windowImage(idx) : null;
    if (img) c.drawImage(img, 0, 0, img.width * prog, img.height, gx, gy, gw * prog, gh);
    else if (state === 'listening') { c.fillStyle = rgba(T.accent, 0.12); c.fillRect(gx, gy, gw * prog, gh); }
    if (state === 'listening') {
      const x = gx + gw * prog; c.fillStyle = T.text; c.fillRect(x - 0.5, gy - 2, 1.5, gh + 4);
      const g = c.createLinearGradient(x - 26, 0, x, 0); g.addColorStop(0, rgba(T.accent, 0)); g.addColorStop(1, rgba(T.accent, 0.35)); c.fillStyle = g; c.fillRect(Math.max(gx, x - 26), gy, Math.min(26, x - gx), gh);
      c.strokeStyle = T.line; c.lineWidth = 1; c.beginPath(); for (let s = Math.ceil(prog * 10); s <= 10; s++) { const xx = gx + (s / 10) * gw + 0.5; if (xx > x + 2) { c.moveTo(xx, gy); c.lineTo(xx, gy + gh); } } c.stroke();
    }
    if (state === 'none' || state === 'failed') { font(500, 11, false); c.fillStyle = state === 'failed' ? T.warn : T.text3; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(state === 'failed' ? 'Window rejected' : 'No window yet', w / 2, gy + gh / 2); }
    font(500, 9.5, true); c.fillStyle = T.text3; c.textBaseline = 'top'; c.textAlign = 'left'; c.fillText('0 s', gx, gy + gh + 3); c.textAlign = 'right'; c.fillText('10 s', gx + gw, gy + gh + 3);
    c.textAlign = 'center'; c.fillText('time: 200 steps', gx + gw / 2, gy + gh + 3);
    // the network's answer
    const by = gy + gh + 26, show = state === 'done';
    font(500, 9.5, false); c.fillStyle = T.text3; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText('Network output: person', gx, by - 3);
    c.fillStyle = T.bg3; roundRect(c, gx, by, gw, 8, 3); c.fill();
    const th = ctx.nn.threshold, tx = gx + th * gw;
    if (show) { c.fillStyle = csi.says ? T.person : T.text3; roundRect(c, gx, by, Math.max(3, csi.person * gw), 8, 3); c.fill(); }
    c.fillStyle = T.text; c.fillRect(tx - 0.75, by - 3, 1.5, 14);
    font(500, 9.5, true); c.fillStyle = T.text2; c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText('alarm above ' + th.toFixed(2), clamp(tx, gx + 34, gx + gw - 34), by + 13);
    if (show) { font(600, 10, true); c.fillStyle = T.text; c.textAlign = 'right'; c.textBaseline = 'alphabetic'; c.fillText(csi.person.toFixed(2), gx + gw, by - 3); }

    if (state === 'listening') {
      wifi.big.textContent = 'Listening ' + (L.progress * L.dur).toFixed(1) + ' of ' + L.dur + ' s';
      wifi.small.textContent = 'Stop ' + L.stop + ', window ' + L.window + '. ' + Math.round(L.progress * 1000).toLocaleString('en-US') + ' of 1,000 probes. The rover must stand still. ' + (img ? 'Revealed as it fills: the simulated test window this listen will draw.' : 'The window is drawn when it is complete.');
    } else if (state === 'done') {
      wifi.big.textContent = csi.says ? 'Says person' + (csi.moving > 0.5 ? ', moving' : ', still') : 'Says no one';
      wifi.small.textContent = 'Output ' + csi.person.toFixed(2) + ', alarm line ' + csi.threshold.toFixed(2) + '. At ' + csi.stop + ', ' + age(S, csi.t) + '. Real network, ' + (csi.ms < 0.1 ? 'under 0.1' : csi.ms.toFixed(1)) + ' ms, on simulated test window ' + (csi.sample + 1) + ' of 30.';
    } else if (state === 'failed') { wifi.big.textContent = 'No answer'; wifi.small.textContent = csi.reason + ' The rover listens again.'; }
    else { wifi.big.textContent = 'No window yet'; wifi.small.textContent = 'At each stop the rover collects 10 seconds of Wi-Fi signal, then the network answers.'; }
    wifi.canvas.setAttribute('aria-label', 'Wi-Fi window. ' + wifi.big.textContent + '. ' + wifi.small.textContent);
  }

  let lastTick = -1;
  return {
    dirty() { isDirty = true; },
    reset() { pred = { token: '', sample: null }; thermalKey = ''; },
    hide() {},
    frame(S, now) {
      const reduced = ctx.kit.reducedMotion(), tick = reduced ? 0 : Math.floor(now / 250);
      const liveThermal = S.sensors.thermal?.ok && tick !== lastTick;
      if (!isDirty && !liveThermal) return;
      const full = isDirty; isDirty = false; lastTick = tick;
      if (full) { drawRadar(S); drawWifi(S, now); }
      drawThermal(S, now);
    },
  };
}
