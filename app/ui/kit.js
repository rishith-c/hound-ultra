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
  swarm: 'M5 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM19 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM12 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM7.500 6h9M6.300 8.200l4.400 7.600M17.700 8.200l-4.400 7.600',
  wifi: 'M2 9a15 15 0 0 1 20 0M5.500 12.500a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.500h.01',
  fusion: 'M3 5h3c4 0 4 7 8 7M3 19h3c4 0 4-7 8-7M3 12h18M17.500 8.500 21 12l-3.500 3.500',
  aerial: 'M3 8l9-5 9 5-9 5zM3 8v8l9 5 9-5V8M8 5.500l9 5',
  scan: 'M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M7 12h10M12 7v10',
  signals: 'M3 12h3l2-7 4 14 3-10 2 3h4',
  graph: 'M6 3.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4zM18 5.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4zM8 15.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4zM17 15.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4zM8.200 6.400l7.600 1.200M6.400 8.200l1.200 7.600M10.200 18h4.600M17.700 10.200l-.400 5.600',
  report: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  train: 'M12 4 2 9l10 5 10-5zM6 11.500V16c2 2 10 2 12 0v-4.500M22 9v5',
  copilot: 'M5 5h14v10H9l-4 4zM9 9h.01M12 9h.01M15 9h.01',
  status: 'M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6zM8.500 12l2.500 2.500 4.500-5',
  play: 'M7 4v16l13-8z', pause: 'M7 4h3v16H7zM14 4h3v16h-3z', stop: 'M6 6h12v12H6z',
  reset: 'M4 12a8 8 0 1 0 2.500-5.800M4 4v5h5', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  close: 'M6 6l12 12M18 6 6 18', check: 'M5 12.500l4.500 4.500L19 7.500', alert: 'M12 3 2 20h20zM12 10v4M12 17.500h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.500h.01', person: 'M12 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM5 21c0-4.500 3-7 7-7s7 2.500 7 7',
  rover: 'M4 9.500h12l4 3.500v3H4zM8 9.500V5M6 5h4M7.5 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM16.5 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  drone: 'M9.500 9.500h5v5h-5zM9.500 9.500 7 7M14.500 9.500 17 7M9.500 14.500 7 17M14.500 14.500 17 17M5 2.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM19 2.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM5 16.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM19 16.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z',
  route: 'M5 19a2 2 0 1 0 0-.01M19 5a2 2 0 1 0 0-.01M5 17V9a4 4 0 0 1 4-4h4M19 7v8a4 4 0 0 1-4 4h-4',
  layers: 'M12 3 3 8l9 5 9-5zM3 12l9 5 9-5M3 16l9 5 9-5', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3', bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  chevron: 'M9 6l6 6-6 6', menu: 'M4 7h16M4 12h16M4 17h16', download: 'M12 4v11M7 11l5 5 5-5M5 20h14', upload: 'M12 20V9M7 13l5-5 5 5M5 4h14',
  wall: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v5M15 10v5M9 15v4', heat: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 0-6 1-9z', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  // added by design-director: controls, sensors, objects
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.500v5M9 14.500v5', filter: 'M4 5h16l-6 7.500V19l-4-2v-4.500z',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 11.990v.020',
  crosshair: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 2v6M12 16v6M2 12h6M16 12h6', battery: 'M3 8h15v8H3zM21 11v2M6.500 11v2M9.500 11v2M12.500 11v2',
  signal: 'M5 19v-3M10 19v-7M15 19V8M20 19V4', radar: 'M12 12l6.400-6.400M12 3a9 9 0 1 0 9 9M12 7.500a4.500 4.500 0 1 0 4.500 4.500M7.500 9h.01',
  thermal: 'M10 4.500a2 2 0 0 1 4 0V13a4.200 4.200 0 1 1-4 0zM12 9v7.500M17 5h3M17 8.500h2', camera: 'M3 8h4l2-3h6l2 3h4v11H3zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  pin: 'M12 21s-6.500-6-6.500-11a6.500 6.500 0 0 1 13 0c0 5-6.500 11-6.500 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', flag: 'M5 21V4h12l-2.500 4 2.500 4H5',
  lock: 'M6 11h12v9H6zM8.500 11V7.500a3.500 3.500 0 0 1 7 0V11', expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', collapse: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  fit: 'M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4M8.500 8.500h7v7h-7z', 'arrow-right': 'M4 12h16M14 6l6 6-6 6', 'arrow-left': 'M20 12H4M10 6l-6 6 6 6',
  'arrow-up': 'M12 20V4M6 10l6-6 6 6', 'arrow-down': 'M12 4v16M6 14l6 6 6-6', 'chevron-down': 'M6 9l6 6 6-6', 'chevron-up': 'M6 15l6-6 6 6', 'chevron-left': 'M15 6l-6 6 6 6',
  external: 'M10 5H5v14h14v-5M14 4h6v6M20 4l-9 9', copy: 'M9 9h11v11H9zM5 15H4V4h11v1', print: 'M7 9V4h10v5M7 17H4V9h16v8h-3M7 14h10v6H7z',
  save: 'M5 4h11l3 3v13H5zM8.500 4v5h6V4M8 20v-6h8v6', share: 'M12 15V3M8 7l4-4 4 4M5 12v8h14v-8', folder: 'M3 6h6l2 2h10v11H3z',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 5M15.500 8.500h.01', volume: 'M4 9.500h3l5-4v13l-5-4H4zM16 9a4 4 0 0 1 0 6M18.500 6.500a8 8 0 0 1 0 11',
  mute: 'M4 9.500h3l5-4v13l-5-4H4zM16 9.500l5 5M21 9.500l-5 5', bluetooth: 'M7 7l10 10-5 4V3l5 4L7 17', keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M8 14h8',
  grid: 'M4 4h16v16H4zM4 9.330h16M4 14.670h16M9.330 4v16M14.670 4v16', map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  building: 'M5 21V4h10v17M15 9h4v12M3 21h18M8 8h4M8 12h4M8 16h4', door: 'M6 21V3h12v18M4 21h16M14.500 12v.01', breach: 'M3 5h18v14h-6v-7H9v7H3zM3 10h6M15 10h6M12 5v3',
  beacon: 'M12 13v8M9 21h6M12 9.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM8.500 14.500a5 5 0 0 1 0-7M15.500 7.500a5 5 0 0 1 0 7M6 17a8.500 8.500 0 0 1 0-12M18 5a8.500 8.500 0 0 1 0 12',
  phone: 'M8 3h8v18H8zM11 18h2',
  network: 'M5 5.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM5 15.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM12 3.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM12 17.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM19 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM6.500 6.600l4-1.200M6.400 7.800l4.200 3.300M6.400 16.200l4.200-3.300M6.500 17.400l4 1.200M13.400 5.800l4.400 5.200M13.600 12h3.800M13.400 18.200l4.400-5.200',
  cpu: 'M7 7h10v10H7zM10 10h4v4h-4zM9.500 3v4M14.500 3v4M9.500 17v4M14.500 17v4M3 9.500h4M3 14.500h4M17 9.500h4M17 14.500h4',
  contrast: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18M12 7.500h7.700M12 12h9M12 16.500h7.700', timeline: 'M4 6h10M4 12h16M4 18h7M14 4v4M20 10v4M11 16v4',
  'skip-forward': 'M5 5v14l10-7zM18.500 5v14', 'skip-back': 'M19 5v14L9 12zM5.500 5v14', home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5', edit: 'M4 20h4L19 9l-4-4L4 16zM13.500 6.500l4 4', send: 'M21 3 10 14M21 3l-7 18-4-7-7-4z',
  team: 'M9 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM3 20c0-3.500 2.500-6 6-6s6 2.500 6 6M16 5.300a3 3 0 0 1 0 5.400M17.500 14.400c2.100.800 3.500 2.800 3.500 5.600',
  compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.500 8.500l-2 5-5 2 2-5z', ruler: 'M3 16 16 3l5 5L8 21zM7 12l2 2M10 9l2 2M13 6l2 2',
  waves: 'M4 10v4M8 7v10M12 4v16M16 8v8M20 10.500v3', mesh: 'M12 3l8 4.500v9L12 21l-8-4.500v-9zM12 3v18M4 7.500l16 9M20 7.500l-16 9',
  fog: 'M4 8h10M17 8h3M4 12h3M10 12h10M4 16h12M19 16h1', plume: 'M3 18c3 0 3-3 6-3s3 3 6 3 3-3 6-3M3 12c3 0 3-3 6-3s3 3 6 3 3-3 6-3M8 5h.01M14 4h.01M18 6h.01',
  gauge: 'M4 17a8.500 8.500 0 1 1 16 0M12 14l4-5M12 13a1 1 0 1 0 0 2 1 1 0 0 0 0-2z', more: 'M5 12h.01M12 12h.01M19 12h.01',
  sort: 'M7 4v16M3.500 16.500 7 20l3.500-3.500M17 20V4M13.500 7.500 17 4l3.500 3.500',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.500 9.500a2.500 2.500 0 1 1 3.500 2.300c-.700.400-1 .900-1 1.700M12 17h.01', power: 'M12 3v9M7 6.500a7.500 7.500 0 1 0 10 0',
  flask: 'M9 3h6M10 3v6l-5 10a1.500 1.500 0 0 0 1.500 2h11a1.500 1.500 0 0 0 1.500-2L14 9V3M7.500 15h9', list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  undo: 'M4 9h10a5.500 5.500 0 0 1 0 11H8M8 5 4 9l4 4', redo: 'M20 9H10a5.500 5.500 0 0 0 0 11h6M16 5l4 4-4 4',
  'zoom-in': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6', 'zoom-out': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6',
  rotate: 'M20 12a8 8 0 1 1-2.500-5.800M20 4v5h-5', move: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
  star: 'M12 3.500l2.600 5.400 5.900.800-4.300 4.100 1.100 5.800-5.300-2.800-5.300 2.800 1.100-5.800-4.300-4.100 5.900-.800z', bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  hazard: 'M12 2.500 21.500 12 12 21.500 2.500 12zM12 8v5M12 16h.01',
  'eye-off': 'M3 3l18 18M10.500 6.200A9.500 9.500 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3 3.500M6.500 7.500A17 17 0 0 0 2 12s4 6 10 6a9 9 0 0 0 3.500-.700M9.900 9.900a3 3 0 0 0 4.200 4.200',
  'check-circle': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.500l2.700 2.700L16 9.500', 'x-circle': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9l6 6M15 9l-6 6',
  chain: 'M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1',
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
  'built': { label: 'Built', cls: 'tag-ok', means: 'Real hardware we built, shown from our own CAD and photographs.' },
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
