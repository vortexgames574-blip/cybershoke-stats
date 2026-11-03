const CACHE_NAME = 'cs2-stats-v6'; // Меняем версию кэша

self.addEventListener('install', (e) => {
  self.skipWaiting(); // Принудительно активируем новый SW
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll([
    './',
    './index.html',
    './style.css',
    './app.js',
    './winners.css',
    './winners.js',
    './data/winners.json'
  ])));
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
  // Данные (stats.json, winners.json) всегда берём из сети, кэш — только как фолбэк офлайн.
  // Эти файлы ты правишь руками, поэтому сеть должна иметь приоритет.
  if (e.request.url.includes('stats.json') || e.request.url.includes('winners.json')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  
  // Для остального - сначала кэш, потом сеть
  e.respondWith(caches.match(e.request).then((response) => response || fetch(e.request)));
});