// HOUND Live: the real robot's own readings, passed through tools/live.py. Nothing on this page is simulated; with no robot it stays empty.
const $ = (id) => document.getElementById(id), api = (p) => fetch('/rover/' + p).then((r) => { if (!r.ok) throw new Error(r.status); return r; });
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const surf = (id) => { const c = $(id), g = c.getContext('2d'); return () => { const r = c.getBoundingClientRect(), k = devicePixelRatio || 1, w = Math.max(1, Math.round(r.width * k)), h = Math.max(1, Math.round(r.height * k)); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return [g, w, h, k]; }; };
const S = { csi: surf('csi'), rad: surf('rad'), heat: surf('heat'), tr: surf('tr') };
const IRON = [[6, 4, 14], [48, 8, 96], [150, 14, 118], [226, 62, 34], [255, 168, 12], [255, 240, 160], [255, 255, 255]];
const iron = (t) => { const x = Math.max(0, Math.min(1, t)) * (IRON.length - 1), i = Math.min(IRON.length - 2, x | 0), f = x - i; return IRON[i].map((v, k) => v + (IRON[i + 1][k] - v) * f | 0); };
let st = null, okAt = 0, hist = [], rows = [], trail = [], started = 0, heatPx = null;

async function poll() {
  const t0 = performance.now();
  try {
    st = await (await api('status')).json(); okAt = performance.now(); $('ms').textContent = Math.round(okAt - t0) + ' ms'; show();
    if (okAt - started > 4000) { started = okAt; for (const k of ['cam', 'thermal', 'radar', 'wifi']) if (!st[k]?.on) api(k + '?on=1').catch(() => {}); }
  } catch (e) { if (performance.now() - okAt > 2500) { $('link').dataset.on = 'false'; $('link').lastElementChild.textContent = 'Looking for the robot'; } }
  setTimeout(poll, 250);
}
function show() {
  $('link').dataset.on = 'true'; $('link').lastElementChild.textContent = 'HOUND-01 connected'; $('bat').textContent = st.vbat > 5 ? st.vbat.toFixed(1) + ' V' : '–';
  const w = st.wifi, r = w?.read, a = $('answer'); $('pps').textContent = w?.on ? w.pps + '/s' : '–';
  if (w?.err) { a.dataset.state = 'wait'; $('word').textContent = 'No Wi-Fi reading'; $('more').textContent = w.err; }
  else if (w?.paused) { a.dataset.state = 'wait'; $('word').textContent = 'Driving'; $('more').textContent = 'the network listens again when the robot stops'; }
  else if (!r || !r.ready) { a.dataset.state = 'wait'; $('word').textContent = 'Listening'; $('more').textContent = (r ? r.heard_s : 0) + ' of 10 seconds heard'; }
  else { a.dataset.state = r.is_person ? 'person' : 'none'; $('word').textContent = r.is_person ? (r.moving >= 0.5 ? 'Person, moving' : 'Person, still') : 'No one'; $('more').textContent = 'the neural network, on the last ten seconds of Wi-Fi'; }
  const p = r?.ready ? r.person : null; $('fill').style.width = (p || 0) * 100 + '%'; $('pv').textContent = p === null ? '–' : p.toFixed(2); $('thr').style.left = (r?.threshold ?? 0.53) * 100 + '%';
  if (w?.bars) { const s = w.bars.join(); if (s !== rows.last) { rows.last = s; rows.push(w.bars); if (rows.length > 120) rows.shift(); } $('csino').textContent = rows.length / 2 | 0 ? (rows.length / 2 | 0) + ' s' : ''; }
  const tg = st.radar?.on ? st.radar.targets : []; $('rtxt').textContent = st.radar?.err || (tg.length ? tg.map((t) => (Math.hypot(t.x_mm, t.y_mm) / 1000).toFixed(1) + ' m').join('  ') : st.radar?.on ? 'nothing moving' : ''); trail.push(tg); if (trail.length > 24) trail.shift();
  const f = st.thermal?.frame; if (f) { const hi = Math.max(...f) / 10, med = [...f].sort((x, y) => x - y)[384] / 10; $('htxt').textContent = hi.toFixed(1) + ' °C hottest, room ' + med.toFixed(1); } else $('htxt').textContent = st.thermal?.err || '';
  $('camfps').textContent = st.cam?.on ? st.cam.fps + ' fps' : '';
  hist.push({ t: performance.now(), p, n: tg.length, d: w?.paused }); while (hist.length && hist[0].t < performance.now() - 60000) hist.shift();
}
function paint() {
  { const [g, w, h] = S.csi(); g.fillStyle = '#05070a'; g.fillRect(0, 0, w, h); const n = rows.length; if (n) { const flat = rows.flat(), s = [...flat].sort((a, b) => a - b), lo = s[s.length * .03 | 0], hi = s[Math.min(s.length - 1, s.length * .97 | 0)], ch = rows[0].length, cw = w / 120; rows.forEach((r, i) => { for (let k = 0; k < ch; k++) { const c = iron((r[k] - lo) / Math.max(hi - lo, 1) * .86 + .04); g.fillStyle = `rgb(${c})`; g.fillRect(w - (n - i) * cw, k * h / ch, cw + 1, h / ch + 1); } }); } }
  { const [g, w, h, k] = S.rad(); g.clearRect(0, 0, w, h); const cx = w / 2, by = h - 10 * k, sc = Math.max(0, h - 22 * k) / 6000; g.lineWidth = k; g.font = `${11 * k}px Geist Mono, monospace`;
    for (let m = 1; m <= 6; m++) { g.strokeStyle = m % 2 ? '#141b23' : '#283542'; g.beginPath(); g.arc(cx, by, m * 1000 * sc, Math.PI * 1.167, Math.PI * 1.833); g.stroke(); if (!(m % 2)) { g.fillStyle = '#808b99'; g.fillText(m + ' m', cx + 5 * k, by - m * 1000 * sc - 4 * k); } }
    g.strokeStyle = '#283542'; for (const a of [-60, 60]) { const r = a * Math.PI / 180; g.beginPath(); g.moveTo(cx, by); g.lineTo(cx + Math.sin(r) * 6000 * sc, by - Math.cos(r) * 6000 * sc); g.stroke(); }
    trail.forEach((tg, i) => { const q = (i + 1) / trail.length; for (const t of tg) { g.globalAlpha = i === trail.length - 1 ? 1 : q * .28; g.fillStyle = '#ff6a45'; g.beginPath(); g.arc(cx + t.x_mm * sc, by - t.y_mm * sc, (i === trail.length - 1 ? 8 : 4) * k, 0, 7); g.fill(); } }); g.globalAlpha = 1; g.fillStyle = '#5aa9ff'; g.beginPath(); g.arc(cx, by, 5 * k, 0, 7); g.fill(); }
  { const [g, w, h, k] = S.heat(), f = st?.thermal?.frame; g.fillStyle = '#05070a'; g.fillRect(0, 0, w, h); if (f) { heatPx ||= new OffscreenCanvas(24, 32); const q = heatPx.getContext('2d'), im = q.createImageData(24, 32), lo = Math.min(...f), span = Math.max(Math.max(...f) - lo, 60); for (let y = 0; y < 32; y++) for (let x = 0; x < 24; x++) { const c = iron((f[(23 - x) * 32 + y] - lo) / span), o = (y * 24 + x) * 4; im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255; } q.putImageData(im, 0, 0); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; const z = Math.max(w / 24, h / 32), W = 24 * z, H = 32 * z; g.drawImage(heatPx, (w - W) / 2, (h - H) / 2, W, H); } }
  { const [g, w, h, k] = S.tr(), now = performance.now(), X = (t) => w - (now - t) / 60000 * (w - 150 * k) - 16 * k, top = 18 * k, bot = h - 16 * k, Y = (p) => bot - p * (bot - top); g.clearRect(0, 0, w, h); g.font = `${13 * k}px Instrument Sans, sans-serif`; g.fillStyle = '#aab3be'; g.fillText('Person', 18 * k, top + 8 * k); g.fillStyle = '#808b99'; g.fillText('last minute', 18 * k, top + 27 * k); g.fillStyle = '#5aa9ff'; g.fillText('radar', 18 * k, bot + 11 * k); g.strokeStyle = '#1e242b'; g.lineWidth = k; for (const p of [0, 1]) { g.beginPath(); g.moveTo(120 * k, Y(p)); g.lineTo(w - 16 * k, Y(p)); g.stroke(); }
    const th = st?.wifi?.read?.threshold ?? .53; g.strokeStyle = 'rgba(255,178,36,.55)'; g.setLineDash([5 * k, 5 * k]); g.beginPath(); g.moveTo(120 * k, Y(th)); g.lineTo(w - 16 * k, Y(th)); g.stroke(); g.setLineDash([]); g.lineWidth = 2.5 * k; let on = false; g.strokeStyle = '#ff6a45'; g.beginPath(); for (const e of hist) { const x = X(e.t); if (e.p === null || x < 120 * k) { on = false; continue; } on ? g.lineTo(x, Y(e.p)) : g.moveTo(x, Y(e.p)); on = true; } g.stroke(); for (const e of hist) if (e.n && X(e.t) > 120 * k) { g.fillStyle = 'rgba(90,169,255,.75)'; g.fillRect(X(e.t), bot + 4 * k, 3 * k, 6 * k); } }
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }); requestAnimationFrame(paint);
}
// the robot's camera: the next picture is asked for when the last one is in, so a slow link never queues
const cam = $('cam'); const nextCam = () => { cam.src = '/rover/cam.jpg?t=' + Date.now(); }; cam.onload = () => { cam.classList.add('on'); setTimeout(nextCam, 30); }; cam.onerror = () => { cam.classList.remove('on'); setTimeout(nextCam, 700); }; nextCam();
// this side: the laptop's own camera, shown only here, never sent anywhere
async function me(on) { document.querySelector('main').dataset.me = on; $('side').setAttribute('aria-pressed', on); const v = $('vid'); if (!on) { v.srcObject?.getTracks().forEach((t) => t.stop()); v.srcObject = null; return; } try { v.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }); } catch (e) { $('say').textContent = 'The laptop camera was not allowed.'; } }
$('side').onclick = () => me(document.querySelector('main').dataset.me !== 'true'); me(true);
// driving: held keys only, 8 commands a second; letting go stops, and the robot stops itself if the link goes quiet
const K = { w: [1, 0, 0], s: [-1, 0, 0], a: [0, 1, 0], d: [0, -1, 0], q: [0, 0, 1], e: [0, 0, -1] }, SPEED = 260; let held = null, tick = 0;
const go = () => { const c = K[held]; if (c) api(`v?vx=${c[0] * SPEED}&vy=${c[1] * SPEED}&wz=${c[2] * SPEED / 340.5}`).catch(() => {}); }, halt = () => { held = null; clearInterval(tick); api('stop').catch(() => {}); };
addEventListener('keydown', (e) => { const k = e.key.toLowerCase(); if (k === ' ') { e.preventDefault(); return halt(); } if (K[k] && held !== k && !e.metaKey && !e.ctrlKey) { e.preventDefault(); held = k; go(); clearInterval(tick); tick = setInterval(go, 120); } });
addEventListener('keyup', (e) => { if (held === e.key.toLowerCase()) halt(); }); addEventListener('blur', () => held && halt()); $('stop').onclick = halt;
poll(); requestAnimationFrame(paint);
