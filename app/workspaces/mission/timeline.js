// The mission timeline: phases, what the rover was doing, every reading, every lead, every alert. Drag to scrub.
// Past the play head it shows, dimmed, what happened the last time this part of the mission played.
export function createTimeline(app) {
  const { ctx } = app, { kit, sim, bus } = ctx, { h, fmt } = kit;
  const canvas = h('canvas.mission-tl-canvas', { tabindex: 0, role: 'slider', 'aria-label': 'Mission time. Left and right arrows move 5 seconds, Shift for 30.', 'aria-valuemin': 0 });
  const tip = h('div.mission-tl-tip.glass', { hidden: true });
  const scale = h('span.mission-tl-scale.dim');
  const el = h('div.mission-tl-body', null, canvas, tip);
  const g = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, C = {}, view = { t0: 0, t1: 720, auto: true }, ghost = null, lastState = sim.state, hits = [], hoverX = null, dirty = true;
  const GUT = 104, AX = 20;
  const colors = () => { const v = (n) => kit.cssVar(n); C = { bg1: v('--bg-1'), bg3: v('--bg-3'), bg4: v('--bg-4'), line: v('--line'), line2: v('--line-2'), text: v('--text'), text2: v('--text-2'), text3: v('--text-3'), accent: v('--accent'), person: v('--person'), warn: v('--warn'), ok: v('--ok'), danger: v('--danger'), font: v('--font'), mono: v('--mono') }; dirty = true; };
  const rgba = (c, a) => { const n = parseInt(c.trim().slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };
  const X = (t) => GUT + ((t - view.t0) / (view.t1 - view.t0)) * (W - GUT - 10), T = (x) => view.t0 + ((x - GUT) / (W - GUT - 10)) * (view.t1 - view.t0);
  const snapshot = (S) => ({ tEnd: S.t, events: S.events.slice(), rec: S.rec ? { act: Object.fromEntries(Object.entries(S.rec.act).map(([k, v]) => [k, v.map((s) => ({ ...s }))])), readings: S.rec.readings.slice() } : null, detections: S.detections.map((d) => ({ id: d.id, t: d.t, room: d.room, outdoor: d.outdoor, status: d.status, steps: d.steps.map((s) => ({ t: s.t, p: s.p })) })) });
  const knownEnd = () => Math.max(sim.state.t, ghost?.tEnd || 0);
  function autoFit() { if (view.auto) { view.t0 = 0; view.t1 = Math.max(240, Math.ceil((knownEnd() * 1.06 + 20) / 60) * 60); } }

  function phases(events, tEnd) { const out = [{ id: 'standby', t0: 0 }]; for (const e of events) if (e.code === 'PHASE') { const id = Object.keys(ctx.PHASE_INFO).find((k) => e.text.startsWith(ctx.PHASE_INFO[k].label + '.')); out[out.length - 1].t1 = e.t; out.push({ id, t0: e.t }); } out[out.length - 1].t1 = tEnd; return out; }

  function drawData(D, tFrom, tTo, alpha, S, rows) {
    // D = { events, rec, detections }; draws only the part between tFrom and tTo
    g.save(); g.beginPath(); g.rect(Math.max(GUT, X(tFrom)), 0, Math.max(0, Math.min(W, X(tTo)) - Math.max(GUT, X(tFrom))), H); g.clip(); g.globalAlpha = alpha;
    const live = alpha === 1;
    // phases
    const ph = phases(D.events, D.tEnd);
    ph.forEach((p, i) => { const x0 = X(p.t0), x1 = X(p.t1); g.fillStyle = i % 2 ? C.bg4 : C.bg3; g.beginPath(); g.roundRect(x0 + 0.5, rows.phase, Math.max(1, x1 - x0 - 1), 18, 3); g.fill();
      if (live && p.id === S.phase) { g.fillStyle = C.accent; g.fillRect(x0 + 0.5, rows.phase + 16, Math.max(1, x1 - x0 - 1), 2); }
      const txt = ctx.PHASE_INFO[p.id]?.label || p.id; g.font = '500 11px ' + C.font; if (x1 - x0 > g.measureText(txt).width + 12) { g.fillStyle = live && p.id === S.phase ? C.text : C.text2; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(txt, Math.max(x0, GUT) + 6, rows.phase + 9); }
      if (live) hits.push({ x0, x1, y0: rows.phase, y1: rows.phase + 18, tip: txt + ', ' + fmt.clock(p.t0) + ' to ' + fmt.clock(p.t1) + '. ' + ctx.PHASE_INFO[p.id].hint, t: p.t0, kind: 'phase' }); });
    // rover activity
    const act = D.rec?.act?.['HOUND-01'] || [], yR = rows.rover;
    for (const s of act) { const x0 = X(s.t0), x1 = X(s.t1), w = Math.max(1, x1 - x0);
      if (s.mode === 'drive') { g.fillStyle = rgba(C.text2, 0.75); g.fillRect(x0, yR + 5, w, 4); }
      else if (s.mode === 'listen') { g.fillStyle = C.accent; g.beginPath(); g.roundRect(x0, yR + 1, w, 12, 2); g.fill(); }
      else if (s.mode === 'hold' || s.mode === 'fault') { g.fillStyle = C.danger; g.fillRect(x0, yR + 3, w, 8); }
      else if (s.mode === 'swap') { g.fillStyle = C.warn; g.fillRect(x0, yR + 3, w, 8); }
      if (s.mode !== 'idle' && live) hits.push({ x0, x1: x0 + w, y0: yR, y1: yR + 14, t: s.t0, kind: 'act', tip: 'HOUND-01 ' + ({ drive: 'driving', listen: 'stopped and listening', hold: 'holding (all stop)', fault: 'holding (radio link lost)', swap: 'waiting for a battery swap' }[s.mode] || s.mode) + ', ' + fmt.clock(s.t0) + ' to ' + fmt.clock(s.t1) }); }
    const team = D.rec?.act?.['TEAM-1'] || [];
    for (const s of team) if (s.mode === 'drive') { const x0 = X(s.t0); g.fillStyle = rgba(C.ok, 0.8); g.fillRect(x0, yR + 5, Math.max(1, X(s.t1) - x0), 4); if (live) hits.push({ x0, x1: X(s.t1), y0: yR, y1: yR + 14, t: s.t0, kind: 'act', tip: 'Rescue team walking the approved route, ' + fmt.clock(s.t0) + ' to ' + fmt.clock(s.t1) + ' (simulated)' }); }
    // readings: the network output of every 10 second window
    const yB = rows.read + 28, thr = ctx.nn.threshold;
    for (const r of D.rec?.readings || []) { const x = X(r.t);
      if (!r.ok) { g.strokeStyle = C.danger; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - 3, yB - 6); g.lineTo(x + 3, yB); g.moveTo(x + 3, yB - 6); g.lineTo(x - 3, yB); g.stroke(); if (live) hits.push({ x0: x - 5, x1: x + 5, y0: rows.read, y1: yB, t: r.t, kind: 'reading', tip: fmt.clock(r.t) + '  Wi-Fi reading at ' + r.stop + ' failed. ' + (r.reason || '') }); continue; }
      const y = yB - r.person * 25, col = r.says ? C.warn : C.text2; g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(x, yB); g.lineTo(x, y); g.stroke(); g.fillStyle = col; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
      if (live) hits.push({ x0: x - 6, x1: x + 6, y0: rows.read, y1: yB + 2, t: r.t, kind: 'reading', stop: r.stop, tip: fmt.clock(r.t) + '  Reading at ' + r.stop + ': network output ' + r.person.toFixed(2) + (r.says ? ', above' : ', below') + ' the alarm line (' + thr.toFixed(2) + '). Radar targets: ' + r.radar + '. Warm shapes: ' + (r.thermal < 0 ? 'camera offline' : r.thermal) + '.' }); }
    // leads: probability of each lead over time
    D.detections.forEach((d, i) => { if (i >= rows.lanes) return; const y0 = rows.leads + i * 14, yb = y0 + 12; let px = X(d.t), pp = 0.1; g.lineWidth = 2; g.lineJoin = 'round';
      const pts = d.steps.filter((s) => s.t != null);
      const colOf = (p) => (p >= 0.85 ? C.person : p >= 0.15 ? C.warn : C.text3);
      for (let j = 0; j <= pts.length; j++) { const tx = j < pts.length ? X(pts[j].t) : X(D.tEnd); g.strokeStyle = colOf(pp); g.beginPath(); g.moveTo(px, yb - pp * 10); g.lineTo(tx, yb - pp * 10); if (j < pts.length) g.lineTo(tx, yb - pts[j].p * 10); g.stroke(); px = tx; if (j < pts.length) pp = pts[j].p; }
      g.fillStyle = colOf(pp); g.beginPath(); g.arc(X(d.t), yb - 0.1 * 10, 2.5, 0, 7); g.fill();
      if (live) hits.push({ x0: X(d.t) - 4, x1: X(D.tEnd), y0, y1: yb + 2, kind: 'det', id: d.id, t: d.t, tip: (d.status === 'confirmed' ? 'Person' : d.status === 'possible' ? 'Possible person' : 'Closed lead') + (d.room ? ' in room ' + d.room : d.outdoor ? ' outdoors' : '') + '. Now ' + (pp * 100).toFixed(0) + ' %. The line is its probability after each piece of evidence.' }); });
    // alerts and decisions
    const yA = rows.alerts + 7;
    for (const e of D.events) { if (e.level === 'info' || e.code === 'PHASE') continue; const x = X(e.t);
      const col = e.code === 'PERSON_FOUND' ? C.person : e.level === 'alert' ? C.danger : e.level === 'warn' ? C.warn : C.ok;
      g.fillStyle = col; g.beginPath();
      if (e.level === 'alert') { g.moveTo(x, yA - 6); g.lineTo(x + 5.5, yA + 5); g.lineTo(x - 5.5, yA + 5); g.closePath(); } else if (e.level === 'warn') { g.moveTo(x, yA - 5); g.lineTo(x + 4.5, yA); g.lineTo(x, yA + 5); g.lineTo(x - 4.5, yA); g.closePath(); } else g.arc(x, yA, 3, 0, 7);
      g.fill();
      if (ctx.selection?.type === 'event' && ctx.selection.id === e.id && live) { g.strokeStyle = C.text; g.lineWidth = 1.5; g.beginPath(); g.arc(x, yA, 9, 0, 7); g.stroke(); }
      hits.push({ x0: x - 6, x1: x + 6, y0: rows.alerts, y1: rows.alerts + 15, kind: 'event', id: e.id, t: e.t, ghost: !live, tip: fmt.clock(e.t) + '  ' + e.text }); }
    g.restore();
  }

  function draw() {
    if (!W) return; dirty = false;
    const S = sim.state; autoFit(); hits = [];
    const lanes = Math.max(3, Math.min(5, Math.max(S.detections.length, ghost?.detections.length || 0)));
    const rows = { phase: AX + 2, rover: AX + 25, read: AX + 40, leads: AX + 76, lanes, alerts: AX + 78 + lanes * 14 };
    const need = rows.alerts + 18; if (Math.abs(need - H) > 1) { canvas.style.height = need + 'px'; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    // gutter labels
    g.font = '500 11px ' + C.font; g.fillStyle = C.text3; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('Phase', 10, rows.phase + 9); g.fillText('Rover', 10, rows.rover + 7); g.fillText('Wi-Fi readings', 10, rows.read + 15);
    for (let i = 0; i < lanes; i++) { const d = S.detections[i] || ghost?.detections[i]; const sel = d && ((ctx.selection?.type === 'detection' && ctx.selection.id === d.id) || (ctx.selection?.type === 'survivor' && S.survivors[ctx.selection.id]?.detId === d.id)); g.fillStyle = sel ? C.accent : d ? C.text2 : rgba(C.text3, 0.5); g.fillText(d ? (S.detections[i] ? '' : '') + 'Lead ' + d.id.slice(1) + (d.room ? ' · ' + d.room : d.outdoor ? ' · outside' : '') : i === 0 ? 'Leads' : '', 10, rows.leads + i * 14 + 7); }
    g.fillStyle = C.text3; g.fillText('Alerts', 10, rows.alerts + 7);
    // axis
    const span = view.t1 - view.t0, step = [5, 10, 15, 30, 60, 120, 300].find((s) => (s / span) * (W - GUT) >= 62) || 300;
    g.font = '500 10.5px ' + C.mono; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let t = Math.ceil(view.t0 / step) * step; t <= view.t1; t += step) { const x = Math.round(X(t)) + 0.5; g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, AX); g.lineTo(x, need - 4); g.stroke(); g.fillStyle = C.text3; g.fillText(fmt.clock(t), x, 10); }
    // track baselines
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.beginPath(); for (const y of [rows.rover + 7.5, rows.read + 28.5]) { g.moveTo(GUT, y); g.lineTo(W - 10, y); } g.stroke();
    const yThr = rows.read + 28 - ctx.nn.threshold * 25; g.setLineDash([3, 3]); g.strokeStyle = rgba(C.warn, 0.55); g.beginPath(); g.moveTo(GUT, Math.round(yThr) + 0.5); g.lineTo(W - 10, Math.round(yThr) + 0.5); g.stroke(); g.setLineDash([]);
    g.font = '500 10px ' + C.mono; g.fillStyle = rgba(C.warn, 0.9); g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText('alarm line ' + ctx.nn.threshold.toFixed(2), W - 12, yThr - 2); g.textBaseline = 'middle';
    if (ghost && ghost.tEnd > S.t + 0.5) drawData(ghost, S.t, ghost.tEnd, 0.3, S, rows);
    drawData({ tEnd: S.t, events: S.events, rec: S.rec, detections: S.detections }, view.t0, S.t, 1, S, rows);
    // play head
    const x = Math.round(X(S.t)) + 0.5;
    if (x >= GUT - 1 && x <= W) { g.strokeStyle = C.text; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, AX - 2); g.lineTo(x, need - 2); g.stroke();
      const txt = fmt.clock(S.t); g.font = '600 11px ' + C.mono; const w = g.measureText(txt).width + 12; const bx = Math.min(W - w - 2, Math.max(GUT, x - w / 2)); g.fillStyle = C.text; g.beginPath(); g.roundRect(bx, 1, w, 17, 4); g.fill(); g.fillStyle = C.bg1; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, bx + w / 2, 10); }
    if (hoverX != null && hoverX > GUT && !drag) { g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(hoverX) + 0.5, AX); g.lineTo(Math.round(hoverX) + 0.5, need - 2); g.stroke(); }
    canvas.setAttribute('aria-valuemax', Math.round(knownEnd())); canvas.setAttribute('aria-valuenow', Math.round(S.t)); canvas.setAttribute('aria-valuetext', fmt.clock(S.t) + ', ' + ctx.PHASE_INFO[S.phase].label);
    const secPerPx = span / (W - GUT - 10);
    scale.textContent = 'Simulated time at ' + S.speed + '×: one second here is ' + S.speed + ' s of mission. 1 cm of timeline ≈ ' + (secPerPx * 38 < 90 ? Math.round(secPerPx * 38) + ' s' : (secPerPx * 38 / 60).toFixed(1) + ' min') + '.';
  }

  // ---- interaction ----
  let drag = null, pendingSeek = null, seekRaf = 0;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const hitAt = (x, y) => { let best = null; for (const k of hits) if (x >= k.x0 && x <= k.x1 && y >= k.y0 && y <= k.y1 && (!best || rank(k) > rank(best))) best = k; return best; };
  const rank = (k) => ({ event: 5, reading: 4, det: 3, act: 2, phase: 1 }[k.kind]);
  function seekSoon(t) { pendingSeek = Math.max(0, Math.min(t, Math.max(knownEnd(), view.t1))); if (!seekRaf) seekRaf = requestAnimationFrame(() => { seekRaf = 0; if (pendingSeek == null) return; const t2 = pendingSeek; pendingSeek = null; sim.seek(Math.round(t2 * 10) / 10); }); }
  canvas.addEventListener('pointerdown', (e) => { const [x, y] = local(e); if (x < GUT - 4) return; const hit = hitAt(x, y); drag = { x, moved: false, hit: hit && hit.kind !== 'phase' && hit.kind !== 'act' ? hit : null, was: sim.state.running }; try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ } if (!drag.hit) { sim.pause(); seekSoon(T(x)); } });
  canvas.addEventListener('pointermove', (e) => { const [x, y] = local(e); hoverX = x; dirty = true;
    if (drag) { if (Math.abs(x - drag.x) > 4) { if (!drag.moved && drag.hit) sim.pause(); drag.moved = true; } if (drag.moved || !drag.hit) seekSoon(T(x)); tip.hidden = true; return; }
    const hit = hitAt(x, y); canvas.style.cursor = x < GUT ? 'default' : hit && hit.kind !== 'phase' && hit.kind !== 'act' ? 'pointer' : 'ew-resize';
    if (hit) { tip.textContent = hit.tip + (hit.ghost ? ' (from the last time this part played)' : ''); tip.hidden = false; const tw = Math.min(380, W - 20); tip.style.maxWidth = tw + 'px'; tip.style.left = Math.max(8, Math.min(W - tip.offsetWidth - 8, x - tip.offsetWidth / 2)) + 'px'; tip.style.bottom = (H - hit.y0 + 8) + 'px'; } else tip.hidden = true; });
  const end = () => { if (!drag) return; const d = drag; drag = null;
    if (d.hit && !d.moved) { const k = d.hit;
      if (k.kind === 'det') { app.select({ type: 'detection', id: k.id }, true); }
      else if (k.kind === 'event') { if (k.ghost) sim.seek(Math.min(k.t + 0.2, knownEnd())); if (sim.state.events.some((ev) => ev.id === k.id)) app.select({ type: 'event', id: k.id }, true); }
      else if (k.kind === 'reading') { if (/^S\d/.test(k.stop || '')) app.select({ type: 'stop', id: k.stop }, true); else app.select({ type: 'unit', id: 'HOUND-01' }, true); }
    } else if (d.was) sim.play(); };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { hoverX = null; tip.hidden = true; dirty = true; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const [x] = local(e); const span = view.t1 - view.t0;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { const d = (e.deltaX / (W - GUT)) * span; const lim = Math.max(knownEnd() + 60, 240); const t0 = Math.max(0, Math.min(lim - span, view.t0 + d)); view.t0 = t0; view.t1 = t0 + span; }
    else zoomAt(T(Math.max(GUT, x)), Math.exp(e.deltaY * 0.002));
    view.auto = false; dirty = true; }, { passive: false });
  canvas.addEventListener('keydown', (e) => { const s = e.shiftKey ? 30 : 5; if (e.key === 'ArrowLeft') { e.preventDefault(); sim.seek(Math.max(0, sim.state.t - s)); } else if (e.key === 'ArrowRight') { e.preventDefault(); sim.seek(Math.min(knownEnd(), sim.state.t + s)); } else if (e.key === 'Home') { e.preventDefault(); sim.seek(0); } else if (e.key === 'End') { e.preventDefault(); sim.seek(knownEnd()); } });
  function zoomAt(tc, f) { const lim = Math.max(knownEnd() + 60, 240); let span = Math.max(30, Math.min(lim, (view.t1 - view.t0) * f)); let t0 = tc - ((tc - view.t0) / (view.t1 - view.t0)) * span; t0 = Math.max(0, Math.min(lim - span, t0)); view.t0 = t0; view.t1 = t0 + span; view.auto = false; dirty = true; }

  function resize() { const r = canvas.getBoundingClientRect(); if (!r.width) return; dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); draw(); }
  const ro = new ResizeObserver(resize); ro.observe(canvas);
  colors();
  const offs = [
    bus.on('prefs', () => setTimeout(colors, 0)),
    bus.on('tick', (S) => { lastState = S; dirty = true; }),
    bus.on('seek', (S) => { if (lastState && lastState !== S && lastState.t > S.t && lastState.t >= (ghost?.tEnd || 0) - 0.01) ghost = snapshot(lastState); lastState = S; dirty = true; }),
    bus.on('reset', (S) => { ghost = null; lastState = S; view.auto = true; dirty = true; }),
    bus.on('select', () => { dirty = true; }), bus.on('speed', () => { dirty = true; }),
  ];
  return {
    el, scale,
    frame() { if (dirty) draw(); },
    zoom(f) { zoomAt(sim.state.t, f); }, fit() { view.auto = true; dirty = true; },
    get hasGhost() { return !!ghost && ghost.tEnd > sim.state.t + 0.5; },
    dispose() { ro.disconnect(); offs.forEach((f) => f()); },
  };
}
