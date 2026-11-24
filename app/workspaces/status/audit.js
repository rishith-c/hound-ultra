// An automated accessibility check of one document: controls and images without a name, and text below 4.5 : 1 (3 : 1
// when large). It reads computed styles, so it cannot judge text over pictures or canvases; those are counted as "not judged".
const rgb = (s) => { const m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?\)/.exec(s); return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null; };
const over = (a, b) => { const k = a[3]; return [0, 1, 2].map((i) => a[i] * k + b[i] * (1 - k)).concat(1); };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const path = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
const nameOf = (el, doc) => (el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(/\s+/).map((i) => i && doc.getElementById(i)?.textContent).filter(Boolean).join(' ') || el.labels?.[0]?.textContent || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || el.querySelector?.('img[alt]')?.alt || '').trim();

export function audit(root) {
  const doc = root.ownerDocument, win = doc.defaultView, out = { unnamed: [], images: [], contrast: [], checked: 0, unjudged: 0 }, vis = (el) => { if (!el.getClientRects().length) return false; const s = win.getComputedStyle(el); return s.visibility !== 'hidden' && +s.opacity > 0.05; };
  for (const el of root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=slider], [role=switch]')) if (vis(el) && !el.closest('[aria-hidden=true]')) { out.checked++; if (!nameOf(el, doc)) out.unnamed.push(path(el)); }
  for (const el of root.querySelectorAll('img, canvas, svg[role=img], [role=img]')) if (vis(el) && !el.closest('[aria-hidden=true]')) { out.checked++; if (!(el.hasAttribute('alt') || nameOf(el, doc) || el.getAttribute('role') === 'presentation')) out.images.push(path(el)); }
  const walk = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT), seen = new Set();
  for (let n; (n = walk.nextNode()); ) {
    const el = n.parentElement; if (!n.data.trim() || seen.has(el) || !el || /^(SCRIPT|STYLE|NOSCRIPT|OPTION)$/.test(el.tagName) || el.closest('svg, [aria-hidden=true], [disabled], [aria-disabled=true]') || !vis(el)) continue; seen.add(el);
    const st = win.getComputedStyle(el), fg = rgb(st.color); if (!fg) continue;
    let bg = null, stack = [], judged = true; for (let p = el; p; p = p.parentElement) { const s = win.getComputedStyle(p); if (/url\(|gradient/.test(s.backgroundImage) && !/repeating-linear/.test(s.backgroundImage)) { judged = false; break; } const c = rgb(s.backgroundColor); if (c && c[3] > 0) { stack.push(c); if (c[3] >= 0.99) { bg = c; break; } } if (p !== el && s.position === 'absolute' && p.parentElement?.querySelector(':scope > canvas, :scope > div > canvas')) { judged = stack.some((c2) => c2[3] >= 0.85); if (!judged) break; } }
    if (!judged) { out.unjudged++; continue; }
    bg ||= [6, 8, 10, 1]; for (const c of stack.reverse()) bg = over(c, bg); let f = over(fg, bg); for (let p = el; p && p !== root; p = p.parentElement) { const o = +win.getComputedStyle(p).opacity; if (o < 1) f = over([f[0], f[1], f[2], o], bg); }
    out.checked++; const k = ratio(f, bg), px = parseFloat(st.fontSize), big = px >= 24 || (px >= 18.6 && +st.fontWeight >= 700); if (k < (big ? 3 : 4.5) - 0.02) out.contrast.push(path(el) + ' “' + n.data.trim().slice(0, 28) + '” ' + k.toFixed(2));
  }
  return out;
}

// Open each workspace by itself in an off-screen frame, so nothing on screen is disturbed, and check it.
export async function auditAll(manifest, { onResult, stopped = () => false, mode = 'advanced' } = {}) {
  const results = [];
  for (const m of manifest) {
    if (stopped()) break;
    const f = document.createElement('iframe'); f.title = 'Accessibility check'; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1; f.style.cssText = 'position:fixed;left:-3000px;top:0;width:1440px;height:900px;border:0;visibility:visible;pointer-events:none';
    const url = new URL('./', location.href); url.search = '?paused&audit=1&mode=' + mode; url.hash = '#/' + m.id; f.src = url.href; document.body.append(f); let r = { id: m.id, title: m.title, error: null };
    try {
      const t0 = performance.now(); for (;;) { await new Promise((x) => setTimeout(x, 250)); const ws = f.contentDocument?.getElementById('ws-' + m.id); if (ws && !ws.querySelector(':scope > .empty > .spinner') && ws.childElementCount && performance.now() - t0 > 2500) break; if (performance.now() - t0 > 20000) throw new Error('did not open within 20 s'); }
      await new Promise((x) => setTimeout(x, 800)); Object.assign(r, audit(f.contentDocument.getElementById('ws-' + m.id)));
    } catch (e) { r.error = String(e.message || e); }
    f.remove(); results.push(r); onResult?.(r, results);
  }
  return results;
}
