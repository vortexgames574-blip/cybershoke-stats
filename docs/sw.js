const CACHE_NAME = 'cs2-stats-v5'; // Меняем версию кэша

self.addEventListener('install', (e) => {
  self.skipWaiting(); // Принудительно активируем новый SW
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(['./', './index.html', './style.css', './app.js'])));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache); // Удаляем старый кэш
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (e) => {
  // Для данных (stats.json) всегда идем в сеть, кэшируем только если офлайн
  if (e.request.url.includes('stats.json')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  
  // Для остального - сначала кэш, потом сеть
  e.respondWith(caches.match(e.request).then((response) => response || fetch(e.request)));
});
