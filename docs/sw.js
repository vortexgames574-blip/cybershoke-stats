// sw.js
const CACHE_NAME = 'geimeri-stats-v32'; // <--- ВАЖНО: Меняй версию при каждом обновлении!
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './winners.css',
  './winners.js',
  './winners-admin.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;

  // JSON всегда берем из сети, чтобы данные были свежими
  if (e.request.url.includes('/data/stats.json') || e.request.url.includes('/data/winners.json')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (!res || !res.ok) return res;
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Остальное - cache-first
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (!res || !res.ok) return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        return res;
      });
    })
  );
});