// Tap detector: your device (microphone) + a live algorithm (dsp.js). Works without a microphone on a built-in
// synthetic recording. The fusion preview calls core/fusion.js and never writes to the mission.
import { TapDetector, buildScene, FS, N, BAND, REPORT_AT, NOISE_KINDS, TEST, runTest } from './dsp.js';
import { fuse, LR, THRESHOLDS, classify } from '../../core/fusion.js';
import { C, surface, seg, intro, text, rgba, clamp } from './util.js';

let savedTest = null; // the last completed test, kept while the page is open

export function create(root, ctx) {
  const { h, icon, realityTag, fmt, reducedMotion } = ctx.kit;
  const T = 10; // seconds on screen
  root.classList.add('signals-tap');
  let det = null, scene = null, source = 'demo', raf = 0, lastTs = 0, fed = 0, shown = false, lastDraw = 0;
  let spec = null, specCtx = null, colImg = null, tmpDb = null, specHi = -60, wavePk = 0.02;
  let mic = null, micAsk = 0, sound = null, selected = null, leadSel = 'new', leadSig = '', lastSlow = 0, shownConf = 0;
  let worker = null, testRun = 0, test = savedTest ? { res: savedTest, frac: 1, running: false } : { res: null, frac: 0, running: false }, testSeed = savedTest?.seed || 3; // the detector was tuned while looking at seeds 1 and 2, so the test shown starts at 3

  // ---------- left rail: what it is, the source, the log ----------
  const srcSeg = seg([{ id: 'demo', label: 'Built-in recording' }, { id: 'mic', label: 'Microphone' }], 'demo', (v) => (v === 'mic' ? askMic() : useDemo()), 'Sound source');
  const srcBox = h('div.col');
  const logEl = h('ul.signals-log', { 'aria-label': 'Knock patterns heard', 'aria-live': 'polite' });
  const rail = h('section.panel.signals-rail', { 'aria-label': 'Tap detector', style: { flex: '1' } }, h('div.panel-body', null,
    intro(realityTag('device'), 'Rescuers call “knock three times” and listen. This listens with them: it finds sharp knocks in the sound, then looks for the even rhythm of a hand, and ignores steady noise, voices and machines.', realityTag('live-algo')),
    h('div.signals-group', null, h('h4', null, 'Sound source'), srcSeg.el, srcBox),
    h('div.signals-group', { style: { flex: '1', minHeight: '0' } }, h('h4', null, 'Knock patterns heard'), logEl)));

  // ---------- centre: the scope ----------
  const scope = surface('signals-canvas', () => drawScope());
  scope.canvas.setAttribute('role', 'img'); scope.canvas.setAttribute('aria-label', 'Live waveform, spectrogram and onset strength of the sound, with detected knocks marked');
  const scopePanel = h('section.panel.signals-tap-scope', { 'aria-label': 'Live sound' }, h('header.panel-head', null, h('h3', null, 'The last 10 seconds of sound, and what the detector made of it'), realityTag('live-algo')), h('div.signals-fill', null, scope.canvas));

  // ---------- right: confidence and rhythm ----------
  const mNum = h('div.signals-meter-num', null, '0'), mState = h('div.signals-meter-state', null, 'Listening.'), mFill = h('i');
  const meter = h('div.signals-meter', { 'data-state': 'quiet', role: 'meter', 'aria-label': 'Knock pattern confidence', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, mNum, mState,
    h('div.signals-meter-bar', null, mFill, h('u', { style: { left: REPORT_AT * 100 + '%' } })),
    h('div.signals-meter-scale', null, h('span', { style: { left: REPORT_AT * 100 + '%' } }, 'reported from ' + REPORT_AT * 100)));
  const cKnock = h('b', null, '0'), cVoice = h('b', null, '0'), cMach = h('b', null, '0');
  const meterPanel = h('section.panel', { 'aria-label': 'Confidence' }, h('header.panel-head', null, h('h3', null, 'Is someone knocking?'), h('span.dim', { style: { fontSize: '11px' }, title: 'A score from 0 to 100 built from the number of knocks, how even they are, how alike they sound and how clean the gap around them is. It is a score, not a probability.' }, 'a score, not a probability')),
    h('div.panel-body', { style: { flex: 'none' } }, meter,
      h('div.signals-counts', null, h('div', null, cKnock, 'knock-like sounds'), h('div', null, cVoice, 'voice-like, ignored'), h('div', null, cMach, 'steady ticking, ignored'))));
  const rhythm = surface('signals-canvas', () => drawRhythm());
  rhythm.canvas.setAttribute('role', 'img'); rhythm.canvas.setAttribute('aria-label', 'Histogram of gaps between knocks and autocorrelation of the knock train');
  const rhythmPanel = h('section.panel', { 'aria-label': 'Rhythm', style: { flex: '1' } }, h('header.panel-head', null, h('h3', null, 'A hand keeps time: even knocks pile up at one gap')), h('div.signals-fill', null, rhythm.canvas));
  const side = h('div.signals-col.signals-tap-side', null, meterPanel, rhythmPanel);

  // ---------- bottom centre: the measured test ----------
  const testBody = h('tbody'), testBar = h('i'), testMsg = h('p');
  const testBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => startTest(testSeed + 1) }, 'Run again, new clips');
  const testPanel = h('section.panel.signals-tap-test', { 'aria-label': 'Measured detection' },
    h('header.panel-head', null, h('h3', null, 'Measured here: three knocks found in synthetic recordings'), testBtn, realityTag('live-algo')),
    h('div.panel-body.flush', null, h('table.table.signals-test', null,
      h('thead', null, h('tr', null, h('th', null, 'Background'), ...TEST.snrs.map((s) => h('th', { title: 'Knock level over background level, in decibels' }, (s > 0 ? '+' : s < 0 ? '−' : '') + Math.abs(s) + ' dB')), h('th', null, 'False alarms'))), testBody)),
    h('div.signals-test-foot', null, h('div.bar', null, testBar), testMsg));

  // ---------- bottom right: what it would do to a lead ----------
  const leadSelEl = h('select.select', { 'aria-label': 'Lead to preview', onchange: () => { leadSel = leadSelEl.value; renderFuse(); } });
  const trFill = h('div.signals-track-fill'), trB = h('div.signals-track-mark.before'), trA = h('div.signals-track-mark'), trBl = h('div.signals-track-lab.top'), trAl = h('div.signals-track-lab.top');
  const track = h('div.signals-track', { 'aria-hidden': 'true' }, h('div.signals-track-bg'), trFill, trB, trA, trBl, trAl,
    h('div.signals-track-lab.bot', { style: { left: THRESHOLDS.possible * 100 + '%' } }, 'possible ' + THRESHOLDS.possible * 100 + ' %'), h('div.signals-track-lab.bot', { style: { left: THRESHOLDS.confirmed * 100 + '%' } }, 'confirmed ' + THRESHOLDS.confirmed * 100 + ' %'));
  const verdict = h('p.signals-verdict'), stepsEl = h('div.signals-steps');
  const fusePanel = h('section.panel', { style: { flex: 'none' }, 'aria-label': 'Effect on a lead' },
    h('header.panel-head', null, h('h3', null, 'If sent to the mission'), h('span.tag.tag-sim', { title: 'This shows the calculation only. Nothing is written to the mission.' }, 'Preview')),
    h('div.panel-body', null, leadSelEl, track, verdict, stepsEl));

  root.append(h('div.signals-col.signals-tap-left', null, rail, fusePanel), scopePanel, side, testPanel);

  // ---------- detector and sources ----------
  function newDetector(fs) {
    det = new TapDetector(fs);
    const bins = Math.min(N / 2, Math.floor(4000 / (fs / N)) + 1);
    spec = document.createElement('canvas'); spec.width = Math.round(T / det.dt); spec.height = bins;
    specCtx = spec.getContext('2d'); specCtx.fillStyle = C.heat0; specCtx.fillRect(0, 0, spec.width, bins);
    colImg = specCtx.createImageData(1, bins); tmpDb = new Float32Array(bins); specHi = -60; wavePk = 0.02;
    det.onColumn = (mag) => {
      let mx = -200;
      for (let b = 0; b < bins; b++) { const d = 20 * Math.log10(mag[b] + 1e-7); tmpDb[b] = d; if (d > mx) mx = d; }
      specHi = Math.max(specHi - 0.004, mx);
      const lo = specHi - 62, lut = C.lut, px = colImg.data;
      for (let b = 0; b < bins; b++) { const v = clamp((tmpDb[b] - lo) / 62, 0, 1), i = Math.round(Math.pow(v, 1.3) * 255) * 4, o = (bins - 1 - b) * 4; px[o] = lut[i]; px[o + 1] = lut[i + 1]; px[o + 2] = lut[i + 2]; px[o + 3] = 255; }
      specCtx.globalCompositeOperation = 'copy'; specCtx.drawImage(spec, -1, 0); specCtx.globalCompositeOperation = 'source-over';
      specCtx.putImageData(colImg, spec.width - 1, 0);
    };
    det.onPattern = (p) => addLog(p);
    selected = null; logEl.replaceChildren(); emptyLog();
  }
  function emptyLog() {
    if (logEl.children.length) return;
    logEl.append(h('li.signals-empty', { style: { display: 'block', background: 'none', color: 'var(--text-3)' } }, source === 'mic' ? 'Nothing yet. Knock three times on the desk, evenly, about twice a second.' : 'Nothing yet. The first knocks come 10 seconds into the recording.'));
  }
  function addLog(p) {
    logEl.querySelector('.signals-empty')?.remove();
    const li = h('li', { 'data-id': p.id },
      h('span.num', null, fmt.clock(p.t0)), h('b', null, p.count + ' knocks, ' + p.period.toFixed(2) + ' s apart'),
      h('small', null, 'even to ' + Math.round((1 - p.cv) * 100) + ' %  ·  score ' + Math.round(p.conf * 100) + (p.repeatOf ? '  ·  repeat' : '')),
      h('button.btn.btn-sm', { type: 'button', title: 'Show what this would do to a lead. Nothing is written to the mission.', 'aria-label': 'Preview on a lead', onclick: () => pick(p) }, 'Preview'));
    logEl.prepend(li);
    while (logEl.children.length > 30) logEl.lastChild.remove();
    if (!selected) pick(p, true);
  }
  function pick(p, quiet) {
    selected = p;
    for (const li of logEl.children) li.setAttribute('aria-current', String(li.dataset.id === String(p.id)));
    renderFuse();
    if (!quiet && !reducedMotion()) fusePanel.animate?.([{ boxShadow: '0 0 0 2px ' + C.person }, { boxShadow: '0 0 0 2px transparent' }], { duration: 700 });
  }

  function srcLine(...kids) { srcBox.replaceChildren(...kids); }
  function showDemoLine(note) {
    const btn = h('button.btn.btn-sm', { type: 'button', 'aria-pressed': String(!!sound), onclick: () => (sound ? stopSound() : startSound()), title: 'Play the recording through the speakers' }, sound ? 'Mute' : 'Play it aloud');
    srcLine(h('div.signals-srcline', null, h('span.signals-live'), h('span.grow', null, 'Synthetic, 48 s, looping'), btn),
      h('p.signals-hint', null, note || 'Made by a sound generator. The script above the waveform shows what is really there.'));
  }
  function useDemo(note) {
    micAsk++; stopMic(); source = 'demo'; srcSeg.set('demo');
    if (!scene) scene = buildScene(7);
    newDetector(FS); fed = 0; showDemoLine(note);
  }
  function askMic() {
    srcSeg.set('mic');
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) { useDemo('This browser cannot open a microphone here (it needs a secure page and audio support). The built-in recording is playing instead.'); ctx.shell.toast('No microphone access in this browser. Using the built-in recording.', { level: 'warn' }); return; }
    srcLine(h('div.signals-consent', null, h('b', null, 'May HOUND use this computer’s microphone?'),
      h('span', null, 'It is used for one thing: finding knocks. The sound is analysed inside this page. It is not recorded, saved or sent anywhere, and the microphone is released when you leave this view.'),
      h('div.signals-btnrow', null, h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: startMic }, icon('mic'), 'Allow microphone'), h('button.btn.btn-sm', { type: 'button', onclick: () => useDemo() }, 'Not now'))));
    srcBox.querySelector('.btn-primary')?.focus();
  }
  async function startMic() {
    const my = ++micAsk;
    srcLine(h('div.signals-srcline', null, h('div.spinner'), 'Waiting for the browser’s permission…'));
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } }); }
    catch (e) {
      if (my !== micAsk) return;
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
      useDemo(denied ? 'The microphone was not allowed, so the built-in recording is playing. To try again, allow the microphone for this site in the address bar.' : 'No microphone was found (' + (e?.name || 'error') + '). The built-in recording is playing instead.');
      return;
    }
    if (my !== micAsk || !shown) { stream.getTracks().forEach((t) => t.stop()); if (my === micAsk) useDemo(); return; } // they left, or changed their mind, while the browser was asking
    try {
      stopSound();
      const actx = new AudioContext();
      await actx.audioWorklet.addModule(new URL('./tap-worklet.js', import.meta.url));
      const src = actx.createMediaStreamSource(stream), node = new AudioWorkletNode(actx, 'signals-tap-capture'), mute = actx.createGain();
      mute.gain.value = 0; src.connect(node); node.connect(mute); mute.connect(actx.destination);
      const D = Math.max(1, Math.round(actx.sampleRate / FS)), fs = actx.sampleRate / D;
      source = 'mic'; newDetector(fs);
      let carry = 0, cn = 0;
      node.port.onmessage = (e) => { // average D samples into one: a simple low-pass and resample to about 16 kHz
        const x = e.data, out = new Float32Array(Math.ceil((x.length + cn) / D)); let o = 0;
        for (let i = 0; i < x.length; i++) { carry += x[i]; if (++cn === D) { out[o++] = carry / D; carry = 0; cn = 0; } }
        det.push(o === out.length ? out : out.subarray(0, o));
      };
      mic = { stream, actx, node, src };
      if (!shown) { useDemo(); return; }
      srcLine(h('div.signals-srcline', null, h('span.signals-live.mic'), h('span.grow', null, 'Microphone is on, ' + (fs / 1000).toFixed(1) + ' kHz'), h('button.btn.btn-sm', { type: 'button', onclick: () => useDemo() }, 'Stop')),
        h('p.signals-hint', null, 'Knock three times on the desk, evenly. Then try talking, or one single bang: neither should count. Nothing is recorded.'));
    } catch (e) { stream.getTracks().forEach((t) => t.stop()); console.warn('[signals] microphone path failed', e); useDemo('The microphone opened but its audio could not be read (' + (e?.message || e) + '). The built-in recording is playing instead.'); }
  }
  function stopMic() {
    if (!mic) return;
    try { mic.node.port.onmessage = null; mic.src.disconnect(); mic.node.disconnect(); } catch { /* already gone */ }
    mic.stream.getTracks().forEach((t) => t.stop()); mic.actx.close().catch(() => {}); mic = null;
  }
  function startSound() {
    try {
      const actx = new AudioContext(), buf = actx.createBuffer(1, scene.x.length, FS); buf.copyToChannel(scene.x, 0);
      const src = actx.createBufferSource(), g = actx.createGain(); g.gain.value = 1.6; src.buffer = buf; src.loop = true; src.connect(g); g.connect(actx.destination);
      src.start(0, (fed % scene.x.length) / FS);
      sound = { actx, src, t0: actx.currentTime, base: fed };
    } catch (e) { ctx.shell.toast('This browser would not play the recording aloud.', { level: 'warn' }); sound = null; }
    showDemoLine();
  }
  function stopSound() { if (!sound) return; try { sound.src.stop(); } catch { /* not started */ } sound.actx.close().catch(() => {}); sound = null; if (source === 'demo' && shown) showDemoLine(); }

  function feedDemo(dt) {
    const target = sound ? sound.base + (sound.actx.currentTime - sound.t0) * FS : fed + dt * FS;
    let k = Math.round(target - fed); if (k <= 0) return;
    if (k > FS * 0.3) { if (sound) sound.base -= k - FS * 0.3; k = Math.round(FS * 0.3); }
    const n = scene.x.length, chunk = new Float32Array(k); let p = fed % n;
    for (let i = 0; i < k; i++) { chunk[i] = scene.x[p]; if (++p === n) p = 0; }
    det.push(chunk); fed += k;
  }

  // ---------- drawing ----------
  function drawScope() {
    const { c, w, h: H } = scope; if (!w || !det) return;
    c.clearRect(0, 0, w, H);
    const padL = 54, padR = 12, pw = w - padL - padR, now = det.now, dt = det.dt, Hn = det.H;
    const hasScript = source === 'demo', yScript = 8, hScript = hasScript ? 22 : 0, yWave = yScript + hScript + (hasScript ? 6 : 0), hWave = 50, hFlux = Math.max(58, Math.min(84, H * 0.18)), hAxis = 20;
    const ySpec = yWave + hWave + 6, hSpec = H - ySpec - hFlux - hAxis - 10, yFlux = ySpec + hSpec + 6;
    const X = (t) => padL + (1 - (now - t) / T) * pw;
    const fr0 = Math.max(0, det.frame - Math.round(T / dt));
    c.save(); c.beginPath(); c.rect(padL, 0, pw, H); c.clip();
    // the script of the built-in recording, and whether each scripted knock group was found
    if (hasScript) {
      c.fillStyle = rgba(C.sim, 0.07); c.fillRect(padL, yScript, pw, hScript);
      const loop = Math.floor(now / scene.dur);
      for (let L = Math.max(0, loop - 1); L <= loop; L++) for (const s of scene.script) {
        const a = s.t0 + L * scene.dur, b = s.t1 + L * scene.dur; if (b < now - T || a > now) continue;
        const x0 = X(a), x1 = Math.min(X(b), padL + pw);
        c.fillStyle = rgba(C.sim, s.kind === 'knock' ? 0.34 : 0.16); c.beginPath(); c.roundRect(x0, yScript + 3, Math.max(2, x1 - x0), hScript - 6, 3); c.fill();
        let lab = s.label;
        if (s.kind === 'knock' && now > b + 1.7) lab += det.patterns.some((p) => p.t1 > a - 0.15 && p.t0 < b + 0.15) ? ' · found' : ' · missed';
        text(c, lab, x0 + 5, yScript + hScript / 2 + 0.5, { color: C.text, size: 11, base: 'middle' });
      }
    }
    // waveform
    c.fillStyle = C.bg1; c.fillRect(padL, yWave, pw, hWave);
    let pk = 0; c.fillStyle = rgba(C.text2, 0.85); const mid = yWave + hWave / 2;
    for (let f = fr0; f < det.frame; f++) { const i = f % Hn, a = det.wmin[i], b = det.wmax[i]; pk = Math.max(pk, -a, b); const x = X(f * dt), g = (hWave / 2 - 2) / wavePk; c.fillRect(x, mid - b * g, Math.max(1, pw / (T / dt)), Math.max(1, (b - a) * g)); }
    wavePk += (Math.max(0.004, pk * 1.05) - wavePk) * 0.08;
    // spectrogram
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(spec, padL, ySpec, pw, hSpec);
    // onset strength and its threshold
    c.fillStyle = C.bg1; c.fillRect(padL, yFlux, pw, hFlux);
    let fmax = 0.4; for (let f = fr0; f < det.frame; f++) fmax = Math.max(fmax, det.flux[f % Hn]);
    const FY = (v) => yFlux + hFlux - 3 - (v / (fmax * 1.1)) * (hFlux - 24); // the top strip is the key
    c.beginPath(); c.moveTo(X(fr0 * dt), yFlux + hFlux);
    for (let f = fr0; f < det.frame; f++) c.lineTo(X(f * dt), FY(det.flux[f % Hn]));
    c.lineTo(X((det.frame - 1) * dt), yFlux + hFlux); c.closePath(); c.fillStyle = rgba(C.accent, 0.28); c.fill();
    c.beginPath(); for (let f = fr0; f < det.frame; f++) { const x = X(f * dt), y = FY(det.flux[f % Hn]); f === fr0 ? c.moveTo(x, y) : c.lineTo(x, y); } c.strokeStyle = C.accent; c.lineWidth = 1.2; c.stroke();
    c.beginPath(); for (let f = fr0; f < det.frame; f += 2) { const x = X(f * dt), y = FY(det.thr[f % Hn]); f === fr0 ? c.moveTo(x, y) : c.lineTo(x, y); } c.strokeStyle = C.text2; c.setLineDash([3, 3]); c.lineWidth = 1; c.stroke(); c.setLineDash([]);
    // onsets: a knock-like sound gets a line through the spectrogram; the others only a mark on the strength lane
    for (const o of det.onsets) {
      if (o.t < now - T) continue; const x = X(o.t), y = FY(det.flux[o.frame % Hn]);
      if (o.kind === 'impulse') { c.fillStyle = rgba(C.text, 0.8); c.fillRect(Math.round(x), ySpec + hSpec - 7, 1, 7); c.beginPath(); c.arc(x, y, 3, 0, 6.3); c.fillStyle = C.text; c.fill(); }
      else if (o.kind === 'sustained') { c.beginPath(); c.arc(x, y, 3, 0, 6.3); c.strokeStyle = C.text2; c.lineWidth = 1.2; c.stroke(); }
      else { c.beginPath(); c.arc(x, y, 1.5, 0, 6.3); c.fillStyle = C.text3; c.fill(); }
    }
    // groups: reported, ignored, and the one still forming
    const rowEnd = [-1e9, -1e9, -1e9];
    const bracket = (t0, t1, color, label, dashed) => {
      const x0 = X(t0) - 5, x1 = X(t1) + 5, y = ySpec + 9;
      c.strokeStyle = color; c.lineWidth = 2; if (dashed) c.setLineDash([4, 3]);
      c.beginPath(); c.moveTo(x0, y + 7); c.lineTo(x0, y); c.lineTo(x1, y); c.lineTo(x1, y + 7); c.stroke(); c.setLineDash([]);
      c.font = '600 11px ' + C.font; const tw = c.measureText(label).width;
      const lx = clamp(x0, padL + 4, padL + pw - tw - 12);
      let row = rowEnd.findIndex((e) => e < lx - 6); if (row < 0) row = 0; rowEnd[row] = lx + tw + 10; const ty = y + 11 + row * 21;
      c.fillStyle = rgba(C.bg0, 0.82); c.beginPath(); c.roundRect(lx, ty, tw + 10, 18, 4); c.fill();
      text(c, label, lx + 5, ty + 9.5, { color, size: 11, weight: 600, base: 'middle' });
    };
    for (const p of det.rejected) if (p.t1 > now - T) bracket(p.t0, p.t1, C.text2, p.kind === 'machine' ? 'steady ticking, ' + p.count + ' beats: ignored' : p.count + ' sounds, too uneven: ignored');
    for (const p of det.patterns) if (p.t1 > now - T) { bracket(p.t0, p.t1, C.person, p.count + ' knocks · ' + p.period.toFixed(2) + ' s apart · score ' + Math.round(p.conf * 100)); for (const t of p.times) { c.fillStyle = C.person; c.fillRect(Math.round(X(t)) - 1, ySpec + 9, 2, 9); c.fillRect(Math.round(X(t)) - 1, ySpec + hSpec - 9, 2, 9); } }
    const ch = det.chain;
    if (ch && ch.count >= 2 && now - ch.t1 < 3) {
      bracket(ch.t0, ch.t1, ch.machine ? C.text2 : C.warn, ch.machine ? 'steady ticking, ' + ch.count + ' beats so far' : ch.count === 2 ? 'two knocks: waiting for a third' : ch.count + ' knocks so far', true);
      const nx = X(ch.t1 + ch.period); if (nx < padL + pw && !ch.machine) { c.strokeStyle = rgba(C.warn, 0.8); c.setLineDash([2, 4]); c.beginPath(); c.moveTo(nx, ySpec + 40); c.lineTo(nx, ySpec + hSpec); c.stroke(); c.setLineDash([]); }
    }
    c.restore();
    // frames and axes
    c.strokeStyle = C.line2; c.lineWidth = 1; for (const [y, hh] of [[yWave, hWave], [ySpec, hSpec], [yFlux, hFlux]]) c.strokeRect(padL + 0.5, y + 0.5, pw - 1, hh - 1);
    if (hasScript) text(c, 'script', padL - 8, yScript + hScript / 2, { align: 'right', base: 'middle', color: C.sim });
    text(c, 'sound', padL - 8, mid, { align: 'right', base: 'middle', color: C.text3 });
    const top = (spec.height - 1) * (det.fs / N);
    for (const f of [1000, 2000, 3000, 4000]) { if (f > top) continue; const y = ySpec + hSpec * (1 - f / top); text(c, f / 1000 + ' kHz', padL - 8, clamp(y, ySpec + 6, ySpec + hSpec), { align: 'right', base: 'middle', color: C.text3 }); c.fillStyle = C.line2; c.fillRect(padL - 4, Math.round(y), 4, 1); }
    const yb = ySpec + hSpec * (1 - BAND[0] / top); c.fillStyle = C.accent; c.fillRect(padL + pw + 3, ySpec + 1, 2, yb - ySpec - 1);
    text(c, 'onset', padL - 8, yFlux + hFlux / 2 - 6, { align: 'right', base: 'middle', color: C.accent }); text(c, 'strength', padL - 8, yFlux + hFlux / 2 + 7, { align: 'right', base: 'middle', color: C.accent });
    { const lab = 'listening band 150 Hz to 4 kHz'; c.font = '400 11px ' + C.font; const tw = c.measureText(lab).width; c.fillStyle = rgba(C.bg0, 0.82); c.beginPath(); c.roundRect(padL + pw - tw - 18, ySpec + hSpec - 24, tw + 12, 18, 4); c.fill(); text(c, lab, padL + pw - 12, ySpec + hSpec - 11, { color: C.text, align: 'right' }); }
    for (let s = 0; s <= T; s += 2) { const x = padL + pw * (1 - s / T); c.fillStyle = C.line2; c.fillRect(Math.round(x), yFlux + hFlux, 1, 4); text(c, s === 0 ? 'now' : '−' + s + ' s', x, yFlux + hFlux + 15, { align: s === 0 ? 'right' : 'center', color: C.text3, mono: s !== 0 }); }
    // what the marks mean
    let lx = padL + 8; const ly = yFlux + 13;
    c.strokeStyle = C.text2; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(lx, ly - 3.5); c.lineTo(lx + 14, ly - 3.5); c.stroke(); c.setLineDash([]);
    text(c, 'threshold, follows the noise', lx + 19, ly, { color: C.text3 }); lx += c.measureText('threshold, follows the noise').width + 36;
    for (const [kind, lab] of [['i', 'knock-like'], ['s', 'voice-like'], ['w', 'too weak']]) {
      c.beginPath(); c.arc(lx, ly - 3.5, kind === 'w' ? 1.5 : 3, 0, 6.3); if (kind === 's') { c.strokeStyle = C.text2; c.lineWidth = 1.2; c.stroke(); } else { c.fillStyle = kind === 'i' ? C.text : C.text3; c.fill(); }
      text(c, lab, lx + 7, ly, { color: C.text3 }); lx += c.measureText(lab).width + 24;
    }
  }

  function drawRhythm() {
    const { c, w, h: H } = rhythm; if (!w || !det) return;
    c.clearRect(0, 0, w, H);
    const v = det.view(), padL = 14, padR = 14, pw = w - padL - padR, hA = (H - 62) / 2, y1 = 24, y2 = y1 + hA + 22, X = (s) => padL + (s / 1.25) * pw;
    const st = det.status(), P = st.period || 0, hot = st.state === 'knocking' ? C.person : st.state === 'candidate' ? C.warn : C.text2;
    text(c, 'Gaps between neighbouring knocks, last 9 s', padL, 15, { color: C.text2 });
    let mx = 2; for (let i = 0; i < 50; i++) mx = Math.max(mx, v.ioi[i]);
    c.fillStyle = C.bg1; c.fillRect(padL, y1, pw, hA); c.fillRect(padL, y2, pw, hA);
    for (let k = 1; k <= mx; k++) { const y = y1 + hA - (k / mx) * (hA - 6); c.fillStyle = rgba(C.text, 0.06); c.fillRect(padL, Math.round(y), pw, 1); }
    for (let i = 0; i < 50; i++) { if (!v.ioi[i]) continue; const x = X(i * 0.025), bw = pw / 50, hh = (v.ioi[i] / mx) * (hA - 6); const near = P && Math.abs((i + 0.5) * 0.025 - P) < 0.2 * P; c.fillStyle = near ? hot : C.text3; c.fillRect(x + 1, y1 + hA - hh, bw - 2, hh); }
    text(c, 'Autocorrelation of the knock train', padL, y2 - 7, { color: C.text2 });
    let am = 0.7; for (let q = 0; q < 126; q++) am = Math.max(am, v.acf[q]);
    c.beginPath(); c.moveTo(X(0), y2 + hA);
    for (let q = 0; q < 126; q++) c.lineTo(X(q * 0.01), y2 + hA - (v.acf[q] / am) * (hA - 6));
    c.lineTo(X(1.25), y2 + hA); c.closePath(); c.fillStyle = rgba(C.accent, 0.2); c.fill();
    c.beginPath(); for (let q = 0; q < 126; q++) { const x = X(q * 0.01), y = y2 + hA - (v.acf[q] / am) * (hA - 6); q ? c.lineTo(x, y) : c.moveTo(x, y); } c.strokeStyle = C.accent; c.lineWidth = 1.3; c.stroke();
    c.fillStyle = rgba(C.text3, 0.14); c.fillRect(padL, y1, X(0.18) - padL, hA); c.fillRect(padL, y2, X(0.18) - padL, hA); // gaps shorter than 0.18 s are not counted
    if (P) {
      c.strokeStyle = hot; c.lineWidth = 1; c.setLineDash([3, 3]);
      for (const m of [1, 2]) { const x = X(P * m); if (x < padL + pw) { c.globalAlpha = m === 1 ? 1 : 0.45; c.beginPath(); c.moveTo(x, m === 1 ? y1 : y2); c.lineTo(x, y2 + hA); c.stroke(); } }
      c.globalAlpha = 1; c.setLineDash([]);
      const lab = P.toFixed(2) + ' s apart'; c.font = '600 11px ' + C.mono; const tw = c.measureText(lab).width, lx = clamp(X(P) + 6, padL, padL + pw - tw - 4);
      c.fillStyle = rgba(C.bg0, 0.85); c.beginPath(); c.roundRect(lx - 3, y1 + 2, tw + 8, 16, 3); c.fill();
      text(c, lab, lx, y1 + 14, { color: hot, weight: 600, mono: true });
      if (X(P * 2) < padL + pw - 80) text(c, 'and twice that', X(P * 2) + 6, y2 + 13, { color: C.text3 });
    } else if (!v.n) text(c, 'No knock-like sounds in the last 9 seconds.', padL + pw / 2, y1 + hA / 2 + 4, { align: 'center', color: C.text3 });
    c.strokeStyle = C.line2; c.lineWidth = 1; c.strokeRect(padL + 0.5, y1 + 0.5, pw - 1, hA - 1); c.strokeRect(padL + 0.5, y2 + 0.5, pw - 1, hA - 1);
    for (const s of [0, 0.25, 0.5, 0.75, 1, 1.25]) { const x = X(s); c.fillStyle = C.line2; c.fillRect(Math.round(x), y2 + hA, 1, 3); text(c, s === 1.25 ? '1.25 s' : String(s), x, y2 + hA + 14, { align: s === 0 ? 'left' : s === 1.25 ? 'right' : 'center', color: C.text3, mono: true }); }
  }

  const WORDS = {
    quiet: () => 'Listening. Only background so far.',
    impulse: () => 'A sharp sound. One knock is not a pattern.',
    voice: () => 'Voice-like sound. It does not die away fast enough to be a knock.',
    machine: (s) => 'Steady ticking, ' + s.count + ' beats without a pause. Too even to be a hand: ignored.',
    candidate: (s) => (s.count === 2 ? 'Two knocks ' + s.period.toFixed(2) + ' s apart. Waiting for a third.' : s.count + ' sounds in a row, but uneven. Not reported yet.'),
    knocking: (s) => 'Deliberate knocking: ' + s.count + ' knocks, ' + s.period.toFixed(2) + ' s apart' + (s.repeat ? ', the same rhythm as the group before.' : '.'),
  };
  function drawMeter() {
    const st = det.status(); shownConf += (st.conf - shownConf) * 0.25; if (Math.abs(st.conf - shownConf) < 0.004) shownConf = st.conf;
    const v = Math.round(shownConf * 100);
    if (mNum.textContent !== String(v)) { mNum.textContent = v; meter.setAttribute('aria-valuenow', v); mFill.style.width = v + '%'; }
    if (meter.dataset.state !== st.state) meter.dataset.state = st.state;
    const words = WORDS[st.state](st); if (mState.textContent !== words) { mState.textContent = words; meter.setAttribute('aria-valuetext', words); }
    const k = String(det.counts.impulse), s = String(det.counts.sustained), m = String(det.counts.machine);
    if (cKnock.textContent !== k) cKnock.textContent = k; if (cVoice.textContent !== s) cVoice.textContent = s; if (cMach.textContent !== m) cMach.textContent = m;
  }

  // ---------- the fusion preview ----------
  function leads() { return ctx.sim.state.detections.filter((d) => !d.dismissed && d.status !== 'rejected'); }
  function syncLeads() {
    const L = leads(), sig = L.map((d) => d.id + ':' + Math.round(d.p * 100)).join(',');
    if (sig === leadSig && leadSelEl.options.length) return false; leadSig = sig;
    if (leadSel !== 'new' && !L.some((d) => d.id === leadSel)) leadSel = 'new';
    leadSelEl.replaceChildren(h('option', { value: 'new' }, 'A new lead: nothing else known yet'), ...L.map((d) => h('option', { value: d.id }, d.id + ' · ' + (d.room ? 'room ' + d.room : 'outdoors') + ' · ' + d.status + ' ' + Math.round(d.p * 100) + ' %')));
    leadSelEl.value = leadSel; return true;
  }
  function renderFuse() {
    const d = leadSel === 'new' ? null : ctx.sim.state.detections.find((x) => x.id === leadSel);
    const ev = d ? d.evidence : [];
    const before = fuse(ev), after = fuse([...ev, { sensor: 'acoustic', result: 'pos', vantage: 'signals-tap', note: selected ? selected.count + ' knocks, ' + selected.period.toFixed(2) + ' s apart' : 'knock pattern' }]);
    const b = before.p * 100, a = after.p * 100, push = a - b < 16 ? 8 - (a - b) / 2 : 0;
    trB.style.left = 'calc(' + b + '% - 1px)'; trA.style.left = 'calc(' + a + '% - 1px)'; trFill.style.left = b + '%'; trFill.style.width = Math.max(0, a - b) + '%';
    trBl.textContent = b.toFixed(b < 10 ? 1 : 0) + ' %'; trAl.textContent = a.toFixed(a > 99 ? 1 : 0) + ' %';
    trBl.style.left = clamp(b - push, 5, 95) + '%'; trAl.style.left = clamp(a + push, 5, 95) + '%'; trBl.style.color = 'var(--text-3)';
    const cb = classify(before.p), ca = classify(after.p), who = d ? 'Lead ' + d.id + (d.room ? ' in room ' + d.room : '') : 'A new lead';
    const tail = ca === 'confirmed' ? (cb === 'confirmed' ? 'It was already confirmed; the knocking adds weight.' : 'That is enough to confirm it.') : 'Still “possible”: it needs a second sensor or a second look to pass 85 %.';
    verdict.replaceChildren(h('b', null, who), ' would go from ' + fmt.pct(before.p, b < 10 ? 1 : 0) + ' to ', h('b', null, fmt.pct(after.p, a > 99 ? 1 : 0)), '. ' + tail);
    const chips = [h('span', null, 'start ' + fmt.pct(after.prior))];
    const st = after.steps, skip = Math.max(0, st.length - 4);
    if (skip) chips.push(h('span', null, '→ ' + skip + ' earlier reading' + (skip > 1 ? 's' : '')));
    st.slice(skip).forEach((s) => chips.push(h('span' + (s.sensor === 'acoustic' ? '.now' : ''), { title: (LR[s.sensor]?.label || s.sensor) + (s.assumed ? ' (assumed value)' : ' (measured on the test set)') + (s.repeat ? ', repeat reading at half weight' : '') }, '→ ' + (s.sensor === 'acoustic' ? 'tapping' : s.sensor === 'csi' ? 'Wi-Fi' : s.sensor) + ' ×' + s.lr.toFixed(s.lr < 10 ? 2 : 0))));
    chips.push(h('span', { style: { flexBasis: '100%', marginTop: '4px', whiteSpace: 'normal' } }, 'Tapping counts ×' + LR.acoustic.pos + ' towards a person: a design value. Preview only; nothing is written to the mission.'));
    stepsEl.replaceChildren(...chips);
  }

  // ---------- the test ----------
  function renderTest() {
    const r = test.res, rows = [];
    for (const k of [...TEST.kinds, 'tick']) {
      const tds = [h('td', null, NOISE_KINDS[k].label, ' ', h('small', null, NOISE_KINDS[k].sub))];
      for (const s of TEST.snrs) {
        const cell = r?.cells[k]?.[s];
        if (k === 'tick') { if (s === TEST.snrs[0]) tds.push(h('td.wait', { colSpan: TEST.snrs.length, style: { textAlign: 'center' } }, 'no knocks in these clips: the detector should stay silent')); continue; }
        if (!cell || !cell.n) tds.push(h('td.wait', null, '·', h('i.signals-cellbar')));
        else { const f = cell.hit / cell.n, bar = h('i.signals-cellbar'); bar.style.setProperty('--v', f); tds.push(h('td' + (f < 0.7 ? '.low' : ''), { title: cell.hit + ' of ' + cell.n + ' clips' }, h('span.num', null, cell.n < TEST.trials ? cell.hit + '/' + cell.n : Math.round(f * 100) + ' %'), bar)); }
      }
      const fa = r?.fa[k];
      tds.push(h('td.fa' + (fa && fa.minutes ? '' : '.wait'), null, !fa || !fa.minutes ? '·' : [h('span.num', null, fa.count ? (fa.count / fa.minutes).toFixed(2) + ' / min' : 'none'), ' ', h('small', null, fa.count + ' in ' + fa.minutes.toFixed(0) + ' min')]));
      rows.push(h('tr', null, tds));
    }
    testBody.replaceChildren(...rows);
    testBar.style.width = test.frac * 100 + '%'; testBtn.disabled = test.running;
    testMsg.textContent = test.running ? 'Testing now: ' + (r?.clips || 0) + ' clips, ' + ((r?.seconds || 0) / 60).toFixed(0) + ' min of sound so far…'
      : r?.done ? r.clips + ' fresh synthetic clips, ' + (r.seconds / 60).toFixed(0) + ' min of sound, seed ' + r.seed + '. ' + TEST.trials + ' clips per cell, each with one group of three knocks; dB is knock level over background level. Synthetic sound only: no real recordings yet.'
      : 'The test runs by itself when this view opens.';
  }
  function startTest(seed) {
    stopTest(); testSeed = seed; const my = ++testRun; test = { res: null, frac: 0, running: true }; renderTest();
    const onMsg = (res, frac) => { if (my !== testRun) return; test = { res, frac, running: !res.done }; if (res.done) savedTest = res; renderTest(); };
    const local = () => runTest({ seed, onProgress: onMsg, pause: () => new Promise((r) => setTimeout(r, 0)), alive: () => my === testRun });
    try {
      worker = new Worker(new URL('./test-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => { onMsg(e.data.res, e.data.frac); if (e.data.res.done) { worker?.terminate(); worker = null; } };
      worker.onerror = (e) => { e.preventDefault?.(); worker?.terminate(); worker = null; if (my === testRun) local(); };
      worker.postMessage({ seed });
    } catch { worker = null; local(); }
  }
  function stopTest() { testRun++; worker?.terminate(); worker = null; if (test.running) test = { res: null, frac: 0, running: false }; }

  // ---------- life cycle ----------
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.2, (ts - lastTs) / 1000 || 0); lastTs = ts;
    if (source === 'demo') feedDemo(dt);
    if (!reducedMotion() || ts - lastDraw > 500) { lastDraw = ts; drawScope(); drawRhythm(); }
    drawMeter();
    if (ts - lastSlow > 1000) { lastSlow = ts; if (syncLeads() || leadSel !== 'new') renderFuse(); }
  }
  useDemo(); renderTest(); syncLeads(); renderFuse();
  return {
    show() {
      if (shown) return; shown = true; lastTs = performance.now(); raf = requestAnimationFrame(frame);
      if (!test.res?.done && !test.running) setTimeout(() => { if (shown && !test.running && !test.res?.done) startTest(testSeed); }, 900);
    },
    hide() {
      if (!shown) return; shown = false; cancelAnimationFrame(raf);
      stopSound(); stopTest(); renderTest();
      if (mic || source === 'mic') useDemo('The microphone was released when you left this view. Choose Microphone to listen again.');
    },
    repaint() { drawScope(); drawRhythm(); },
    debug: () => ({ det, source, test, mic: !!mic }),
  };
}
