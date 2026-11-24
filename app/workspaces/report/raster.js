// Turns a report sheet (the same HTML that prints) into a picture for the 3-D document, and works out in which order
// the ink of the plan drawing goes down. Browsers that refuse to read the picture back make rasterSheet throw.
const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
const cache = new Map();
async function dataUrl(url, type) {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(url)))).then((b) => 'data:' + type + ';base64,' + b64(b)));
  return cache.get(url);
}
export async function inlineFonts(css) {
  const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
  for (const u of urls) css = css.replace(u, await dataUrl(u, 'font/woff2'));
  return css;
}

export async function rasterSheet(sheet, css, scale) {
  const clone = sheet.cloneNode(true); clone.querySelectorAll('[tabindex]').forEach((e) => e.removeAttribute('tabindex'));
  clone.querySelectorAll('.report-selected,.report-flash').forEach((e) => e.classList.remove('report-selected', 'report-flash'));
  for (const im of clone.querySelectorAll('img')) im.setAttribute('src', await dataUrl(im.src, /\.svg/.test(im.src) ? 'image/svg+xml' : 'image/png'));
  const W = 794, H = 1123, box = document.createElement('div'); box.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml'); box.append(clone);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W * scale + '" height="' + H * scale + '" viewBox="0 0 ' + W + ' ' + H + '"><foreignObject width="' + W + '" height="' + H + '"><style xmlns="http://www.w3.org/1999/xhtml"><![CDATA[' + css + ']]></style>' + new XMLSerializer().serializeToString(box) + '</foreignObject></svg>';
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode();
  const c = document.createElement('canvas'); c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const g = c.getContext('2d', { willReadFrequently: false }); g.fillStyle = '#fdfdfb'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  g.getImageData(0, 0, 1, 1);                                          // throws here if the browser will not let WebGL use it
  return c;
}

// A grey map the size of the sheet: black appears first, white last. Lines are walked along their length, so they draw.
export function inkOrder(sheet, press, scale = 0.9) {
  const clone = sheet.cloneNode(true); press.replaceChildren(clone);
  const R0 = clone.getBoundingClientRect(), k = (794 * scale) / R0.width, c = document.createElement('canvas'); c.width = Math.round(794 * scale); c.height = Math.round(1123 * scale);
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  const svg = [...clone.querySelectorAll('svg')].sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
  if (!svg) { press.replaceChildren(); return c; }
  const sr = svg.getBoundingClientRect(), bx = (sr.left - R0.left) * k, by = (sr.top - R0.top) * k, bw = sr.width * k, bh = sr.height * k;
  // Four passes, like a draughtsman: walls line by line (0 to 0.36), one wash of tone and lettering across the sheet
  // (0.36 to 0.6), the route along its length (0.62 to 0.9), then the people.
  const col = (v) => { const n = Math.round(6 + Math.min(1, Math.max(0, v)) * 244); return 'rgb(' + n + ',' + n + ',' + n + ')'; };
  const gr = g.createLinearGradient(bx, by + bh * 0.2, bx + bw, by + bh * 0.8); gr.addColorStop(0, col(0.36)); gr.addColorStop(1, col(0.6)); g.fillStyle = gr; g.fillRect(bx, by, bw, bh);
  const els = [...svg.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse')].filter((e) => !e.closest('defs,marker,pattern,clipPath')).map((e) => { const st = getComputedStyle(e), m = /(\d+)\D+(\d+)\D+(\d+)/.exec(st.stroke || ''), cls = (e.getAttribute('class') || '') + ' ' + (e.parentNode.getAttribute?.('class') || ''); let L = 0; try { L = e.getTotalLength(); } catch { L = 0; } return { e, st, L, cls, dark: !!m && +m[1] + +m[2] + +m[3] < 150, sw: parseFloat(st.strokeWidth) || 0 }; });
  const route = els.filter((o) => /route/.test(o.cls) && o.L > 20 && o.st.stroke !== 'none'), walls = els.filter((o) => o.dark && o.sw >= 1.2 && o.L > 6 && !route.includes(o) && !/trail|stop|arrow/.test(o.cls)), people = els.filter((o) => /circle|ellipse/.test(o.e.tagName) && o.st.fill !== 'none' && o.e.getBoundingClientRect().width * k > 7);
  const pen = (list, v0, v1) => {
    const tot = list.reduce((s, o) => s + Math.sqrt(o.L) + 1, 0) || 1; let acc = 0;
    for (const o of list) {
      const a = v0 + ((v1 - v0) * acc) / tot, w = Math.sqrt(o.L) + 1, d = ((v1 - v0) * w) / tot; acc += w; const m = o.e.getScreenCTM(); if (!m) continue;
      const X = (p) => (m.a * p.x + m.c * p.y + m.e - R0.left) * k, Y = (p) => (m.b * p.x + m.d * p.y + m.f - R0.top) * k, n = Math.max(2, Math.min(90, Math.round(o.L / 4))); g.lineCap = 'butt'; g.lineWidth = Math.max(2.6, o.sw * Math.hypot(m.a, m.b) * k + 2.6); let p = o.e.getPointAtLength(0);
      for (let i = 1; i <= n; i++) { const q = o.e.getPointAtLength((o.L * i) / n); if (Math.hypot(q.x - p.x, q.y - p.y) < (o.L / n) * 1.5) { g.strokeStyle = col(a + (d * i) / n); g.beginPath(); g.moveTo(X(p), Y(p)); g.lineTo(X(q), Y(q)); g.stroke(); } p = q; }
    }
  };
  g.save(); g.beginPath(); g.rect(bx, by, bw, bh); g.clip();
  pen(walls, 0.01, 0.36); pen(route, 0.62, 0.9);
  people.forEach((o, i) => { const r = o.e.getBoundingClientRect(); g.fillStyle = col(0.92 + 0.06 * (i / Math.max(1, people.length))); g.beginPath(); g.ellipse((r.left - R0.left + r.width / 2) * k, (r.top - R0.top + r.height / 2) * k, (r.width * k) / 2 + 1, (r.height * k) / 2 + 1, 0, 0, 7); g.fill(); });
  g.restore();
  c.dataset.ink = walls.length + ' walls, ' + route.length + ' route, ' + people.length + ' people';
  press.replaceChildren();
  return c;
}
