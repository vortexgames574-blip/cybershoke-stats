<<<<<<< HEAD
// Service worker — офлайн-кэш основных ресурсов
const CACHE_NAME = 'geimeri-stats-v28';
=======
// sw.js
const CACHE_NAME = 'geimeri-stats-v30'; // <--- ПОДНЯЛИ ВЕРСИЮ
>>>>>>> parent of 9c1f963 (123)
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './winners.css',
  './winners.js',
  './winners-admin.js',
  './data/stats.json',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

<<<<<<< HEAD
=======
  // НЕ КЭШИРУЕМ ЧУЖИЕ САЙТЫ (CDN скрипты, шрифты, аватарки Steam)
  if (!e.request.url.startsWith(self.location.origin)) return;

>>>>>>> parent of 9c1f963 (123)
  // Стата — сначала сеть, потом кэш
  if (e.request.url.includes('/data/stats.json')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
<<<<<<< HEAD
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
=======
          if (!res || !res.ok) return res;
          try {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          } catch (err) {}
>>>>>>> parent of 9c1f963 (123)
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

<<<<<<< HEAD
  // Остальное — cache-first
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      })
    )
=======
  // Остальное (свои файлы) — cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      
      return fetch(e.request).then(res => {
        if (!res || !res.ok) return res;
        try {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        } catch (err) {}
        return res;
      });
    })
>>>>>>> parent of 9c1f963 (123)
  );
});
