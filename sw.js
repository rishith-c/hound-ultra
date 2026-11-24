// HOUND Command service worker. Network first, always: a visitor who is online never gets an old file. Each good answer
// is also kept, and the kept copy is used only when the network fails. Only complete, successful answers are kept.
const VERSION = 'hound-2026-11-23-2';
const CDN = 'cdn.jsdelivr.net';
const HOME = self.registration.scope;
const mine = (url) => url.origin === self.location.origin || url.hostname === CDN;
const good = (r) => r && r.status === 200 && (r.type === 'basic' || r.type === 'cors' || r.type === 'default');
// Same file, same key: the mode switches in the address (?mode=…, ?paused) are not different pages.
const key = (url) => (url.origin === self.location.origin ? url.origin + url.pathname.replace(/\/index\.html$/, '/') : url.href);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => { for (const k of await caches.keys()) if (k.startsWith('hound-') && k !== VERSION) await caches.delete(k); await self.clients.claim(); })()));

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url); if (!mine(url) || /\/sw\.js$|\.mp4$/.test(url.pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req);
      if (good(res) && url.pathname.length) { const copy = res.clone(); e.waitUntil(cache.put(key(url), copy).catch(() => {})); }
      return res;
    } catch (err) {
      const kept = (await cache.match(key(url))) || (req.mode === 'navigate' && (await cache.match(new URL('app/', HOME).href)));
      if (kept) return kept;
      throw err;
    }
  })());
});

async function tell(client) {
  const c = await caches.open(VERSION), has = async (p) => !!(await c.match(new URL(p, HOME).href));
  client?.postMessage({ type: 'count', files: (await c.keys()).length, version: VERSION, ready: (await has('app/')) && (await has('app/shell.js')) && (await has('data/nn.json')) });
}
self.addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.type === 'count') e.waitUntil(tell(e.source));
  if (m.type === 'save') e.waitUntil((async () => {
    const c = await caches.open(VERSION), list = m.urls.slice(); let done = 0, failed = 0;
    const lane = async () => {
      for (let u; (u = list.shift()); ) {
        try { const url = new URL(u), r = mine(url) ? await fetch(u, { credentials: 'same-origin' }) : null; if (good(r)) await c.put(key(url), r); else failed++; } catch { failed++; }
        if (++done % 8 === 0) e.source?.postMessage({ type: 'saved', done, total: m.urls.length, failed });
      }
    };
    await Promise.all([lane(), lane(), lane(), lane()]);
    e.source?.postMessage({ type: 'saved', done, total: m.urls.length, failed }); await tell(e.source);
  })());
});
