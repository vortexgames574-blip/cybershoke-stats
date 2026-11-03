const CACHE_NAME = 'cs2-stats-v11'; // Поднял версию, чтобы сбросился старый кэш

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
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (e) => {
  // Для JSON файлов делаем сеть приоритетнее кэша (чтобы обновления прилетали сразу)
  if (e.request.url.includes('stats.json') || e.request.url.includes('winners.json')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  // Для остального (HTML, CSS, JS) сначала берем из кэша
  e.respondWith(caches.match(e.request).then((response) => response || fetch(e.request)));
});