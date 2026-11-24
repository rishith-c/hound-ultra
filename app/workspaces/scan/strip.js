// The film's instrument: the range of every beam in the last scan lines, as a thin waterfall of light. It reads the points
// of the (simulated) scan as they land. Beams with no return are bridged from their neighbours.
import { poseAt } from './scene.js';
const W = 420, H = 172, ROWS = 46, BINS = 120;
const FAN = { orbit: [0.35, 1.06], close: [0.18, 1.36] }; // the upright fans: first angle below level, and width, in radians

export function createStrip(h, cssVar, tag) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), cv = h('canvas', { width: W * dpr, height: H * dpr, 'aria-hidden': 'true' }), el = h('div.scan-strip.is-off', null, cv, h('div', null, 'Range of each beam, newest line in front', tag)), c = cv.getContext('2d');
  const rows = Array.from({ length: ROWS }, () => new Float32Array(BINS)), ends = new Uint8Array(ROWS * 2), sum = new Float32Array(BINS), cnt = new Uint16Array(BINS), p = [0, 0, 0], q = [0, 0, 0], ink = { hot: cssVar('--text'), cool: cssVar('--accent-2') };
  let made = 0, head = 0, seen = 0, lo = 0, hi = 0, last = 0, pass = '', on = false;
  function reset() { for (const r of rows) r.fill(0); sum.fill(0); cnt.fill(0); head = seen = made = 0; hi = lo = 0; pass = ''; }
  function feed(d, count, t, id, gz) { // returns the scanner's height above the ground
    if (!d.traj) return 0;
    if (id !== pass || count < seen) { if (count < seen) reset(); pass = id; seen = Math.max(0, count - 400); hi = lo = 0; }
    poseAt(d.traj, t, p); poseAt(d.traj, Math.max(0, t - 0.4), q); let ux = p[0] - q[0], uy = p[1] - q[1]; const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l; const flip = ux < 0 ? -1 : 1, alt = p[2] - gz(p[0], p[1]);
    for (let i = Math.max(seen, count - 2600); i < count; i++) {
      poseAt(d.traj, d.time[i], q); const x = d.pos[i * 3] - q[0], y = d.pos[i * 3 + 1] - q[1], z = d.pos[i * 3 + 2] - q[2]; let u;
      if (FAN[id]) u = (Math.atan2(-z, Math.hypot(x, y)) - FAN[id][0]) / FAN[id][1]; else if (id === 'interior') u = Math.atan2(y, x) / 6.2832 + 0.5; else u = (Math.atan2((x * -uy + y * ux) * flip, Math.hypot(x * ux + y * uy, z)) + 0.62) / 1.24;
      const b = (u * BINS) | 0; if (u < 0 || b >= BINS) continue; sum[b] += Math.hypot(x, y, z); cnt[b]++;
    }
    seen = count; return alt;
  }
  function push() {
    const prev = rows[head]; head = (head + 1) % ROWS; const r = rows[head]; let a = Infinity, z = -Infinity, any = 0;
    for (let b = 0; b < BINS; b++) if (cnt[b]) { r[b] = sum[b] / cnt[b]; a = Math.min(a, r[b]); z = Math.max(z, r[b]); any++; } else r[b] = -1;
    sum.fill(0); cnt.fill(0);
    made++; if (any < 6) { r.set(prev); const o = ((head + ROWS - 1) % ROWS) * 2; ends[head * 2] = ends[o]; ends[head * 2 + 1] = ends[o + 1]; return; }
    if (!hi) { lo = a; hi = z; } lo += (a - lo) * 0.2; hi += (z - hi) * 0.2; const k = 1 / Math.max(0.5, hi - lo); let x = -1;
    ends[head * 2] = 0; for (let b = 0; b < BINS; b++) if (r[b] >= 0) { if (x < 0) ends[head * 2] = b; r[b] = Math.min(1, Math.max(0, 1 - (r[b] - lo) * k)); for (let m = x + 1; m < b; m++) r[m] = x < 0 ? r[b] : r[x] + ((r[b] - r[x]) * (m - x)) / (b - x); x = b; }
    for (let m = x + 1; m < BINS; m++) r[m] = r[x]; ends[head * 2 + 1] = x;
    for (let k2 = 0; k2 < 2; k2++) { let was = r[0]; for (let b = 1; b < BINS - 1; b++) { const me = r[b]; r[b] = was * 0.25 + me * 0.5 + r[b + 1] * 0.25; was = me; } }
  }
  function draw(now, live) {
    if (live !== on) { on = live; el.classList.toggle('is-off', !live); }
    if (!live) return;
    if (now - last > 42) { last = now; push(); }
    const f = Math.min(1, (now - last) / 42);
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H); c.lineJoin = 'round';
    for (let a = Math.min(ROWS, made) - 1; a >= 0; a--) { // far to near, each line hiding what is behind it
      const u = (a + f) / ROWS, s = 1 - 0.42 * u, y0 = H - 8 - (H - 62) * (1 - Math.pow(Math.max(0, 1 - u), 1.35)), amp = 54 * s, x0 = (W * (1 - s)) / 2, r = rows[(head - a + ROWS * 2) % ROWS], fade = Math.max(0, 1 - u);
      const ri = (head - a + ROWS * 2) % ROWS, b0 = ends[ri * 2], b1 = ends[ri * 2 + 1], line = () => { c.beginPath(); for (let b = b0; b <= b1; b++) { const x = x0 + (b / (BINS - 1)) * W * s, y = y0 - r[b] * amp; b > b0 ? c.lineTo(x, y) : c.moveTo(x, y); } }; line();
      if (a > 1) { c.save(); c.lineTo(x0 + (b1 / (BINS - 1)) * W * s, y0 + 10); c.lineTo(x0 + (b0 / (BINS - 1)) * W * s, y0 + 10); c.closePath(); c.globalCompositeOperation = 'destination-out'; c.globalAlpha = 0.92; c.fill(); c.restore(); line(); }
      if (a === 0) { c.strokeStyle = ink.cool; c.globalAlpha = 0.2; c.lineWidth = 9; c.stroke(); c.globalAlpha = 0.34; c.lineWidth = 4; c.stroke(); }
      c.strokeStyle = a < 4 ? ink.hot : ink.cool; c.globalAlpha = a === 0 ? 1 : a < 4 ? 0.8 - a * 0.1 : 0.75 * Math.pow(fade, 1.3); c.lineWidth = a === 0 ? 1.5 : 1; c.stroke();
    }
    c.globalAlpha = 1;
  }
  return { el, reset, feed, draw };
}
