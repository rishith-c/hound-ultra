// Leader-lined HTML labels over the 3-D view. A label is pinned to a point in the world; its box sits a short way
// off, joined by a thin line, so text never covers the thing it names. Each frame the labels are laid out in order
// of importance: a label that would overlap a more important one tries another side, and if nothing fits it hides.
import * as THREE from 'three';

const TONES = { person: 'person', confirmed: 'person', warn: 'warn', possible: 'warn', accent: 'accent', route: 'accent', ok: 'ok', clear: 'ok', danger: 'danger', hazard: 'danger', sim: 'sim', concept: 'sim', muted: 'muted', dim: 'muted' };
// Where the box may sit relative to its point: [dx, dy] in pixels, tried in order.
const SLOTS = [[18, -26], [-18, -26], [18, 22], [-18, 22], [34, -52], [-34, -52], [40, -4], [-40, -4], [0, -44], [48, 46], [-48, 46]];
const SVG = 'http://www.w3.org/2000/svg';

export function createLabels(overlay, camera, { select, occluded, safe = { left: 0, top: 0, right: 0, bottom: 0 }, demo = () => false } = {}) {
  const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('class', 'twin-leaders'); svg.setAttribute('aria-hidden', 'true');
  const layer = document.createElement('div'); layer.className = 'twin-overlay';
  overlay.append(svg, layer);
  const labels = new Set(), v = new THREE.Vector3(), placed = [], order = [];
  let enabled = true, W = 1, H = 1;

  function add(text, opts = {}) {
    const tone = TONES[opts.tone || opts.kind || opts.color] || '';
    const el = document.createElement('div'); el.className = 'twin-label' + (tone ? ' t-' + tone : '') + (opts.plain ? ' plain' : '') + (opts.className ? ' ' + opts.className : '');
    const main = document.createElement('span'), sub = document.createElement('span'); sub.className = 'twin-label-sub';
    main.textContent = text ?? ''; sub.textContent = opts.sub ?? ''; el.append(main, sub); layer.append(el);
    const leader = opts.plain || opts.leader === false ? null : document.createElementNS(SVG, 'line');
    const dot = leader ? document.createElementNS(SVG, 'circle') : null;
    if (leader) { dot.setAttribute('r', '2.5'); if (tone) { leader.setAttribute('class', 't-' + tone); dot.setAttribute('class', 't-' + tone); } svg.append(leader, dot); }
    const L = {
      el, pos: new THREE.Vector3(), visible: true, shown: false, w: 0, h: 0, dirty: true, slot: -1, ox: 0, oy: 0, tone,
      through: !!opts.through || tone === 'person' || tone === 'warn', priority: opts.priority ?? 5, maxDist: opts.maxDist ?? Infinity, minDist: opts.minDist ?? 0, always: !!opts.always, plain: !!opts.plain, leader, dot, sel: opts.sel || null,
      setPosition(p) { L.pos.copy(p); return L; },
      setText(s) { s = s ?? ''; if (main.textContent !== s) { main.textContent = s; L.dirty = true; } return L; },
      setSub(s) { s = s ?? ''; if (sub.textContent !== s) { sub.textContent = s; L.dirty = true; } return L; },
      setTone(tn) { const n = TONES[tn] || ''; if (n === L.tone) return L; if (L.tone) el.classList.remove('t-' + L.tone); if (n) el.classList.add('t-' + n); L.tone = n; if (leader) { leader.setAttribute('class', n ? 't-' + n : ''); dot.setAttribute('class', n ? 't-' + n : ''); } return L; },
      setVisible(on) { L.visible = on !== false; return L; },
      setPriority(p) { L.priority = p; return L; },
      setSelected(on) { el.classList.toggle('selected', !!on); return L; },
      remove() { el.remove(); leader?.remove(); dot?.remove(); labels.delete(L); },
    };
    if (opts.position) L.pos.copy(opts.position);
    if (L.sel && select) { el.classList.add('clickable'); el.addEventListener('click', (e) => { e.stopPropagation(); select(L.sel); }); }
    labels.add(L);
    return L;
  }

  const hide = (L) => { if (L.shown) { L.shown = false; L.el.classList.remove('on'); if (L.leader) { L.leader.style.display = 'none'; L.dot.style.display = 'none'; } } };
  const hits = (x0, y0, x1, y1) => { for (let i = 0; i < placed.length; i += 4) if (x0 < placed[i + 2] && x1 > placed[i] && y0 < placed[i + 3] && y1 > placed[i + 1]) return true; return false; };

  function update(dt, w, h) {
    W = w; H = h;
    if (!enabled) { for (const L of labels) hide(L); return; }
    for (const L of labels) if (L.dirty && L.visible) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; L.dirty = false; }   // read sizes first, then write
    order.length = 0; placed.length = 0;
    const cp = camera.position;
    for (const L of labels) {
      if (!L.visible) { hide(L); continue; }
      v.copy(L.pos); const d = v.distanceTo(cp); v.project(camera);
      if (v.z < -1 || v.z > 1 || d > L.maxDist || d < L.minDist) { hide(L); continue; }
      L.sx = (v.x * 0.5 + 0.5) * W; L.sy = (-v.y * 0.5 + 0.5) * H; L.d = d;
      if (L.sx < -20 || L.sx > W + 20 || L.sy < -20 || L.sy > H + 20) { hide(L); continue; }
      if (occluded && !L.through && occluded(L.pos)) { hide(L); continue; }
      order.push(L);
    }
    order.sort((a, b) => b.priority - a.priority || a.d - b.d);
    for (const L of order) if (!L.plain) placed.push(L.sx - 9, L.sy - 9, L.sx + 9, L.sy + 9);       // keep every subject's point clear
    const k = 1 - Math.exp(-14 * dt), few = demo(), sl = safe.left + 6, st = safe.top + 6, sr = W - safe.right - 6, sb = H - safe.bottom - 6; let shown = 0;
    for (const L of order) {
      let found = -1, tx = 0, ty = 0;
      if (few && (L.plain || shown >= 5)) { hide(L); L.slot = -1; continue; }
      if (L.plain) { const x0 = L.sx - L.w / 2 - 3, y0 = L.sy - L.h / 2 - 2; if (L.always || !hits(x0, y0, x0 + L.w + 6, y0 + L.h + 4)) { found = 0; tx = -L.w / 2; ty = -L.h / 2; } }
      else {
        for (let n = -1; n < SLOTS.length && found < 0; n++) {
          const s = n < 0 ? L.slot : n; if (s < 0 || (n >= 0 && s === L.slot)) continue;
          const [dx, dy] = SLOTS[s], bx = dx > 0 ? dx : dx < 0 ? dx - L.w : -L.w / 2, by = dy < 0 ? dy - L.h : dy, x0 = L.sx + bx, y0 = L.sy + by;
          if (x0 < sl || y0 < st || x0 + L.w > sr || y0 + L.h > sb) continue;
          if (hits(x0 - 4, y0 - 3, x0 + L.w + 4, y0 + L.h + 3)) continue;
          found = s; tx = bx; ty = by;
        }
        if (found < 0 && L.always) { found = 0; tx = SLOTS[0][0]; ty = SLOTS[0][1] - L.h; }
      }
      if (found < 0) { hide(L); L.slot = -1; continue; }
      if (!L.shown || L.slot < 0) { L.ox = tx; L.oy = ty; } else { L.ox += (tx - L.ox) * k; L.oy += (ty - L.oy) * k; }
      L.slot = found; shown++;
      const fd = L.through ? 1 : Math.round((1 - 0.6 * Math.min(1, Math.max(0, (L.d - 70) / 160))) * 20) / 20; if (fd !== L.fade) { L.fade = fd; L.el.style.setProperty('--fade', fd); if (L.leader) { L.leader.style.opacity = fd; L.dot.style.opacity = fd; } }
      const x = L.sx + L.ox, y = L.sy + L.oy;
      placed.push(L.sx + tx, L.sy + ty, L.sx + tx + L.w, L.sy + ty + L.h);
      L.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
      if (L.leader) {
        const ex = Math.min(Math.max(L.sx, x), x + L.w), ey = Math.min(Math.max(L.sy, y), y + L.h);
        L.leader.setAttribute('x1', L.sx.toFixed(1)); L.leader.setAttribute('y1', L.sy.toFixed(1)); L.leader.setAttribute('x2', ex.toFixed(1)); L.leader.setAttribute('y2', ey.toFixed(1));
        L.dot.setAttribute('cx', L.sx.toFixed(1)); L.dot.setAttribute('cy', L.sy.toFixed(1));
      }
      if (!L.shown) { L.shown = true; L.el.classList.add('on'); if (L.leader) { L.leader.style.display = ''; L.dot.style.display = ''; } }
    }
  }

  // Corner brackets that frame an object on screen (hover and selection).
  const box = new THREE.Box3(), corner = new THREE.Vector3();
  function bracket(cls = '') {
    const el = document.createElement('div'); el.className = 'twin-bracket ' + cls; el.innerHTML = '<i></i><i></i><i></i><i></i><span></span>'; layer.append(el);
    const tag = el.lastChild; let obj = null;
    return {
      set(o, text = '') { obj = o || null; if (tag.textContent !== text) tag.textContent = text; if (!obj) el.classList.remove('on'); },
      get object() { return obj; },
      update() {
        if (!obj) return;
        if (!obj.parent && !obj.isScene) { obj = null; el.classList.remove('on'); return; }
        box.setFromObject(obj, false);
        if (box.isEmpty()) { el.classList.remove('on'); return; }
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, ok = true;
        for (let i = 0; i < 8; i++) {
          corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
          if (corner.z > 1 || corner.z < -1) { ok = false; break; }
          const x = (corner.x * 0.5 + 0.5) * W, y = (-corner.y * 0.5 + 0.5) * H; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
        if (!ok || x1 < 0 || y1 < 0 || x0 > W || y0 > H) { el.classList.remove('on'); return; }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, bw = Math.max(26, x1 - x0 + 12), bh = Math.max(26, y1 - y0 + 12);
        el.style.transform = 'translate3d(' + (cx - bw / 2).toFixed(1) + 'px,' + (cy - bh / 2).toFixed(1) + 'px,0)'; el.style.width = bw.toFixed(1) + 'px'; el.style.height = bh.toFixed(1) + 'px';
        el.classList.add('on');
      },
      remove() { el.remove(); },
    };
  }

  return { add, update, bracket, setEnabled(on) { enabled = !!on; }, get count() { return labels.size; }, dispose() { svg.remove(); layer.remove(); labels.clear(); } };
}
