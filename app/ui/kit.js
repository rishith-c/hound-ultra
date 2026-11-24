// Small DOM helpers shared by every workspace (ctx.kit). No framework.
//
// h('div.panel', { onclick, 'aria-label': '…' }, child, 'text', [more children])
//   first argument is tag.class.class; props starting with "on" are listeners; `html` sets innerHTML;
//   `style` may be an object; null / false children are skipped.
export function h(spec, props, ...kids) {
  const [tag, ...cls] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}

// Stroke icons, 24x24 viewBox. icon('rover') returns an <svg>. Add to this set rather than pasting SVG elsewhere.
const ICONS = {
  mission: 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10',
  triage: 'M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 11c0 5.500-7 10-7 10zM9 12h2l1-2 1.500 4 1-2h1.500',
  swarm: 'M5 6a2 2 0 1 0 0-.01M19 6a2 2 0 1 0 0-.01M12 18a2 2 0 1 0 0-.01M7 7l4 9M17 7l-4 9M7 6h10',
  wifi: 'M2 9a15 15 0 0 1 20 0M5.500 12.500a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.500h.01',
  fusion: 'M4 6h5l3 6-3 6H4M20 6h-5M20 18h-5M12 12h8',
  aerial: 'M3 8l9-5 9 5-9 5zM3 8v8l9 5 9-5V8M8 5.500l9 5',
  scan: 'M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M7 12h10M12 7v10',
  signals: 'M3 12h3l2-7 4 14 3-10 2 3h4',
  graph: 'M6 6a2 2 0 1 0 0-.01M18 8a2 2 0 1 0 0-.01M8 18a2 2 0 1 0 0-.01M17 18a2 2 0 1 0 0-.01M8 7l8 1M7 8l1 8M10 18h5M17 10v6',
  report: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  train: 'M12 4 2 9l10 5 10-5zM6 11.500V16c2 2 10 2 12 0v-4.500M22 9v5',
  copilot: 'M5 5h14v10H9l-4 4zM9 9h.01M12 9h.01M15 9h.01',
  status: 'M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6zM8.500 12l2.500 2.500 4.500-5',
  play: 'M7 4v16l13-8z', pause: 'M7 4h3v16H7zM14 4h3v16h-3z', stop: 'M6 6h12v12H6z',
  reset: 'M4 12a8 8 0 1 0 2.500-5.800M4 4v5h5', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  close: 'M6 6l12 12M18 6 6 18', check: 'M5 12.500l4.500 4.500L19 7.500', alert: 'M12 3 2 20h20zM12 10v4M12 17.500h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.500h.01', person: 'M12 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM5 21c0-4.500 3-7 7-7s7 2.500 7 7',
  rover: 'M4 9h13l3 4v3H4zM7 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM9 9V5h4',
  drone: 'M4 6h4M16 6h4M4 18h4M16 18h4M6 6v3l4 2h4l4-2V6M6 18v-3l4-2M18 18v-3l-4-2',
  route: 'M5 19a2 2 0 1 0 0-.01M19 5a2 2 0 1 0 0-.01M5 17V9a4 4 0 0 1 4-4h4M19 7v8a4 4 0 0 1-4 4h-4',
  layers: 'M12 3 3 8l9 5 9-5zM3 12l9 5 9-5M3 16l9 5 9-5', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3', bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  chevron: 'M9 6l6 6-6 6', menu: 'M4 7h16M4 12h16M4 17h16', download: 'M12 4v11M7 11l5 5 5-5M5 20h14', upload: 'M12 20V9M7 13l5-5 5 5M5 4h14',
  wall: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v5M15 10v5M9 15v4', heat: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 0-6 1-9z', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
};
export function icon(name, size = 16) {
  const d = ICONS[name] || ICONS.info;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); svg.append(p);
  return svg;
}
export const iconNames = () => Object.keys(ICONS);

// How real is this? Every workspace and every feature shows exactly one of these labels.
export const REALITY = {
  'live-ai': { label: 'Live AI', cls: 'tag-accent', means: 'A real trained model is running in your browser right now.' },
  'live-algo': { label: 'Live algorithm', cls: 'tag-ok', means: 'Real computation, running now, on simulated input.' },
  'real-data': { label: 'Real data', cls: 'tag-ok', means: 'Live data from a public source.' },
  'device': { label: 'Your device', cls: 'tag-ok', means: 'Uses this computer’s microphone, Bluetooth or files.' },
  'sim': { label: 'Simulated', cls: 'tag-sim', means: 'A scripted scenario stands in for real sensor data.' },
  'concept': { label: 'Concept', cls: 'tag-sim', means: 'A proposed feature. Drawn to show the idea; not built in hardware.' },
};
export function realityTag(kind, { title = true } = {}) {
  const r = REALITY[kind] || REALITY.sim;
  return h('span.tag.' + r.cls, title ? { title: r.means } : null, r.label);
}

export function panel(title, { actions = [], flush = false, tag = null } = {}, ...body) {
  const bodyEl = h('div.panel-body' + (flush ? '.flush' : ''), null, ...body);
  const el = h('section.panel', { 'aria-label': title }, h('header.panel-head', null, h('h3', null, title), tag, ...actions), bodyEl);
  el.body = bodyEl;
  return el;
}

export const fmt = {
  clock(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; },
  pct(p, digits = 0) { return (p * 100).toFixed(digits) + ' %'; },
  m(x, digits = 1) { return x.toFixed(digits) + ' m'; },
  pos(p) { return p ? `${p[0].toFixed(1)}, ${p[1].toFixed(1)}` : 'unknown'; },
};

// Keeps a canvas sharp and sized to its box. Calls draw(ctx2d, width, height) after every resize.
export function fitCanvas(canvas, draw) {
  const ro = new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!r.width || !r.height) return;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); draw?.(c, r.width, r.height);
  });
  ro.observe(canvas);
  return () => ro.disconnect();
}

export const reducedMotion = () => document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
