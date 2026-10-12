// Offline support: app files + photos are cached on install; map tiles and fonts are cached as they load.
const VERSION = 'v2';
const APP_CACHE = 'app-' + VERSION;
const TILE_CACHE = 'tiles';
const FONT_CACHE = 'fonts';

self.window = self;
importScripts('data/data.js');

const CORE = [
  './', 'index.html', 'style.css', 'app.js', 'data/data.js', 'data/basemap.json',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const PHOTOS = self.APP_DATA.places.flatMap((p) => p.photos.map((ph) => ph.src));

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll([...CORE, ...PHOTOS])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function staleWhileRevalidate(cacheName, req) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

async function cacheFirst(cacheName, req) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req.url);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req.url, res.clone());
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      e.respondWith(staleWhileRevalidate(APP_CACHE, new Request('./')).then((r) => r || fetch(req)));
    } else {
      e.respondWith(staleWhileRevalidate(APP_CACHE, req));
    }
  } else if (url.hostname === 'server.arcgisonline.com') {
    e.respondWith(cacheFirst(TILE_CACHE, req));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(FONT_CACHE, req));
  }
});
