/*
 * 离线缓存：第一次打开时把整份文件存进手机，之后断网也能用。
 * 只在安全上下文（HTTPS 或 localhost）里生效，这正是托管到 GitHub Pages 的原因。
 */
// 改动 App 文件后把版本号和 core.js 里的 VERSION 一起 +1，旧缓存就会自动清理
const CACHE_NAME = 'monthly-budget-v1.6.2';
const APP_SHELL = [
  './manifest.webmanifest',
  './src/styles.css',
  './src/core.js',
  './src/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          return key === CACHE_NAME ? null : caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 页面本身：优先联网拿最新版，断网时回落到缓存
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put('./index.html', copy); });
          return response;
        })
        .catch(function () {
          return caches.match('./index.html').then(function (cached) {
            return cached || caches.match('./');
          });
        })
    );
    return;
  }

  // 其它静态资源：优先取最新的（文件很小，联网时永远拿到新版本），断网时回落到缓存
  event.respondWith(
    fetch(request)
      .then(function (response) {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      })
      .catch(function () {
        return caches.match(request);
      })
  );
});
