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
  const gr = g.createLinearGradient(bx, by, bx + bw, by + bh); gr.addColorStop(0, '#080808'); gr.addColorStop(1, '#d0d0d0'); g.fillStyle = gr; g.fillRect(bx, by, bw, bh);
  const els = [...svg.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse,text')].filter((e) => !e.closest('defs,marker,pattern,clipPath'));
  const info = els.map((e) => { let L = 0; try { L = e.tagName === 'text' ? e.getBBox().width * 1.5 : e.getTotalLength(); } catch { L = 30; } return { e, L: Math.max(8, Math.min(900, L || 8)) }; });
  let tot = 0; for (const o of info) { o.w = Math.sqrt(o.L) + 2; tot += o.w; }
  let acc = 0; const col = (v) => { const n = Math.round(8 + Math.min(1, Math.max(0, v)) * 244); return 'rgb(' + n + ',' + n + ',' + n + ')'; };
  for (const o of info) {
    const a = acc / tot, d = Math.max(0.035, (o.w / tot) * 3); acc += o.w; const m = o.e.getScreenCTM(); if (!m) continue;
    const X = (p) => (m.a * p.x + m.c * p.y + m.e - R0.left) * k, Y = (p) => (m.b * p.x + m.d * p.y + m.f - R0.top) * k, r = o.e.getBoundingClientRect();
    const st = getComputedStyle(o.e), filled = o.e.tagName === 'text' || (st.fill && st.fill !== 'none');
    if (r.width * r.height * k * k < bw * bh * 0.5 && filled) { const x = (r.left - R0.left) * k, y = (r.top - R0.top) * k; const fg = g.createLinearGradient(x, 0, x + r.width * k, 0); fg.addColorStop(0, col(a * 0.94)); fg.addColorStop(1, col((a + d) * 0.94)); g.fillStyle = fg; g.fillRect(x - 2, y - 2, r.width * k + 4, r.height * k + 4); }
    if (o.e.tagName === 'text') continue;
    let L = 0; try { L = o.e.getTotalLength(); } catch { continue; } const n = Math.max(2, Math.min(60, Math.round(L / 5))), w = Math.max(3.5, (parseFloat(st.strokeWidth) || 1) * Math.hypot(m.a, m.b) * k + 2.5);
    g.lineCap = 'round'; g.lineWidth = w; let p = o.e.getPointAtLength(0);
    for (let i = 1; i <= n; i++) { const q = o.e.getPointAtLength((L * i) / n); if (Math.hypot(q.x - p.x, q.y - p.y) < (L / n) * 1.5) { g.strokeStyle = col((a + d * (i / n)) * 0.94); g.beginPath(); g.moveTo(X(p), Y(p)); g.lineTo(X(q), Y(q)); g.stroke(); } p = q; }
  }
  press.replaceChildren();
  return c;
}
