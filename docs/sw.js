const CACHE_NAME = 'geimeri-stats-v23'; // ВАЖНО: ПОДНИМАЙ ВЕРСИЮ ПРИ КАЖДОМ ОБНОВЛЕНИИ!

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll([
    './',
    './index.html',
    './style.css',
    './app.js',
    './winners.css',
    './winners.js',
    './winners-admin.js',
    './data/winners.json'
  ])));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.map(k => { if (k !== CACHE_NAME) return caches.delete(k); }))));
});

self.addEventListener('fetch', (e) => {
  // JSON — Network First (всегда свежие данные)
  if (e.request.url.includes('stats.json') || e.request.url.includes('winners.json')) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  
  // Остальное — Stale-While-Revalidate (отдаем из кэша, но качаем новое в фоне)
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request).then((networkResponse) => {
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkResponse.clone()));
        return networkResponse;
      }).catch(() => {});
      return cached || fetchPromise;
    })
  );
});