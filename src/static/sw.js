// Service worker: strona działa offline i ładuje się od razu przy kolejnych wizytach.
// __VERSION__ podmienia build (skrót index.html), więc nowa wersja strony to nowy cache.
// Strona: najpierw sieć (świeży rozkład), przy braku sieci kopia. Pliki obok i czcionki: z cache, odświeżane w tle.
// Dane na żywo i pogoda nigdy nie idą z cache.
const VERSION = '__VERSION__';
const CACHE = 'rwp-' + VERSION;
const CORE = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const NEVER = /\/vehicles\.json|\/alerts\.json|\/trips\.json|\/aircraft\.json|open-meteo\.com/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('rwp-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const r = await fetch(req);
    if (r.ok) c.put('./', r.clone());
    return r;
  } catch (err) {
    return (await c.match('./')) || Response.error();
  }
}
async function staleWhileRevalidate(req) {
  const c = await caches.open(CACHE), hit = await c.match(req);
  const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || NEVER.test(req.url)) return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === location.origin) { e.respondWith(networkFirst(req)); return; }
  if (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) e.respondWith(staleWhileRevalidate(req));
});
