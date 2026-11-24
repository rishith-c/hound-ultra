// The image viewer: one canvas, zoom to the cursor, drag to pan, eased fly-to. The workspace supplies the layers.
// Image space is the frame's own pixels. view = { s, x, y }: screen = image * s + (x, y), in CSS pixels.
export function createViewer(host, { h, onPick, onHover, grab, reduced }) {
  const canvas = h('canvas.aerial-canvas', { tabindex: 0, role: 'img', 'aria-label': 'Aerial frame. Scroll to zoom, drag to move, plus and minus to zoom, 0 to fit.' });
  host.append(canvas);
  const g = canvas.getContext('2d');
  const view = { s: 1, x: 0, y: 0 };
  let W = 0, H = 0, dpr = 1, iw = 0, ih = 0, draw = null, raf = 0, running = false, dirty = true, anim = null, busy = 0, fitted = false;
  const fitView = () => { const pad = 18, s = Math.min((W - pad * 2) / iw, (H - pad * 2) / ih); return { s, x: (W - iw * s) / 2, y: (H - ih * s) / 2 }; };
  const clampView = () => {
    const m = 80; if (!iw) return;
    view.x = Math.min(W - m, Math.max(m - iw * view.s, view.x)); view.y = Math.min(H - m, Math.max(m - ih * view.s, view.y));
  };
  function frame(ts) {
    raf = 0; if (!running) return;
    if (anim) {
      const t = Math.min(1, (ts - anim.t0) / anim.ms), e = 1 - Math.pow(1 - t, 3);
      view.s = anim.a.s * Math.pow(anim.b.s / anim.a.s, e);
      // keep the target point moving on a straight line in screen space
      const cx = anim.a.cx + (anim.b.cx - anim.a.cx) * e, cy = anim.a.cy + (anim.b.cy - anim.a.cy) * e;
      view.x = W / 2 - cx * view.s; view.y = H / 2 - cy * view.s;
      if (t >= 1) anim = null; dirty = true;
    }
    if (dirty || busy) {
      dirty = false;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      if (draw && iw) draw(g, view, W, H, ts);
    }
    if (anim || busy || dirty) raf = requestAnimationFrame(frame);
  }
  const kick = () => { dirty = true; if (running && !raf) raf = requestAnimationFrame(frame); };
  const ro = new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return;
    const was = (iw && fitted) || !W ? null : { cx: (W / 2 - view.x) / view.s, cy: (H / 2 - view.y) / view.s };
    dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (iw) { if (fitted || !was) Object.assign(view, fitView()); else { view.x = W / 2 - was.cx * view.s; view.y = H / 2 - was.cy * view.s; } }
    kick();
  });
  ro.observe(canvas);

  const toImage = (sx, sy) => [(sx - view.x) / view.s, (sy - view.y) / view.s];
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function zoomAt(sx, sy, f) {
    const min = fitView().s * 0.6, s = Math.min(24, Math.max(min, view.s * f)), [ix, iy] = toImage(sx, sy);
    view.s = s; view.x = sx - ix * s; view.y = sy - iy * s; fitted = false; anim = null; clampView(); kick();
  }
  function flyTo(target, ms = 420) {
    const to = target === 'fit' ? fitView() : target;
    const b = to.cx != null ? to : { s: to.s, cx: (W / 2 - to.x) / to.s, cy: (H / 2 - to.y) / to.s };
    fitted = target === 'fit';
    if (reduced() || !W) { view.s = b.s; view.x = W / 2 - b.cx * b.s; view.y = H / 2 - b.cy * b.s; anim = null; kick(); return; }
    anim = { t0: performance.now(), ms, a: { s: view.s, cx: (W / 2 - view.x) / view.s, cy: (H / 2 - view.y) / view.s }, b }; kick();
  }
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = local(e); zoomAt(x, y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0022))); }, { passive: false });
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; const [x, y] = local(e);
    drag = { x, y, vx: view.x, vy: view.y, moved: false, grab: grab?.(x, y, 'down') || null }; canvas.setPointerCapture(e.pointerId); canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    if (drag) {
      if (Math.hypot(x - drag.x, y - drag.y) > 3) drag.moved = true;
      if (drag.grab) drag.grab(x, y);
      else if (drag.moved) { view.x = drag.vx + x - drag.x; view.y = drag.vy + y - drag.y; fitted = false; anim = null; clampView(); canvas.classList.add('is-dragging'); }
      kick();
    } else canvas.style.cursor = grab?.(x, y, 'hover') ? 'ew-resize' : '';
    const [ix, iy] = toImage(x, y); onHover?.(ix >= 0 && iy >= 0 && ix < iw && iy < ih ? [ix, iy] : null, [x, y]);
  });
  const up = (e) => { if (!drag) return; const d = drag; drag = null; canvas.classList.remove('is-dragging'); if (!d.moved && !d.grab) { const [x, y] = local(e); onPick?.(toImage(x, y), [x, y]); } };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', () => { drag = null; canvas.classList.remove('is-dragging'); });
  canvas.addEventListener('pointerleave', () => onHover?.(null));
  canvas.addEventListener('dblclick', (e) => { const [x, y] = local(e); const [ix, iy] = toImage(x, y); flyTo({ s: Math.min(24, view.s * 2.2), cx: ix, cy: iy }, 260); });
  canvas.addEventListener('keydown', (e) => {
    const step = 60;
    if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, 1.4); else if (e.key === '-' || e.key === '_') zoomAt(W / 2, H / 2, 1 / 1.4);
    else if (e.key === '0') flyTo('fit');
    else if (e.key === 'ArrowLeft') { view.x += step; clampView(); kick(); } else if (e.key === 'ArrowRight') { view.x -= step; clampView(); kick(); }
    else if (e.key === 'ArrowUp') { view.y += step; clampView(); kick(); } else if (e.key === 'ArrowDown') { view.y -= step; clampView(); kick(); }
    else return;
    fitted = e.key === '0'; e.preventDefault();
  });

  return {
    canvas, view, toImage, kick, flyTo, zoomAt,
    get size() { return [W, H]; },
    setDraw(fn) { draw = fn; kick(); },
    setImageSize(w, h, { keep = false } = {}) { const same = keep && w === iw && h === ih; iw = w; ih = h; if (!same && W) { Object.assign(view, fitView()); fitted = true; anim = null; } kick(); },
    zoom(f) { zoomAt(W / 2, H / 2, f); },
    focusBox(b, { pad = 3.2, maxS = 9 } = {}) { const bw = Math.max(8, b[2] - b[0]), bh = Math.max(8, b[3] - b[1]); const s = Math.max(fitView().s, Math.min(maxS, Math.min(W / (bw * pad), H / (bh * pad)))); flyTo({ s, cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2 }); },
    setBusy(on) { busy = Math.max(0, busy + (on ? 1 : -1)); kick(); },
    start() { running = true; kick(); }, stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    dispose() { ro.disconnect(); },
  };
}
