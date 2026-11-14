// sw.js
const CACHE_NAME = 'cs-stats-v2'; // Меняйте версию при каждом обновлении
const urlsToCache = [
  './',
  './index.html',
  // Добавьте сюда пути к вашим CSS и JS файлам, если они есть
  // './style.css',
  // './app.js'
];

// Установка: кэшируем основные файлы и сразу активируем новый SW
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Принудительно активируем новый Service Worker
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

// Активация: удаляем старые кэши и захватываем контроль над страницей
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName); // Чистим старое
          }
        })
      );
    }).then(() => self.clients.claim()) // Захватываем контроль немедленно
  );
});

// Стратегия "Сначала сеть, потом кэш" для HTML и JSON данных
self.addEventListener('fetch', (event) => {
  // Для запросов к данным (JSON) всегда идём в сеть
  if (event.request.url.endsWith('.json') || event.request.url.includes('/data/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Для остальных запросов: пробуем сеть, при неудаче — кэш
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Если ответ успешный, клонируем его в кэш
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});