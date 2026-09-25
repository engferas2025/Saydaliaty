// service-worker.js — يخزّن هيكل التطبيق محلياً حتى يفتح ويشتغل بدون انترنت
const CACHE_NAME = 'saydaliaty-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/db.js',
  './js/sync.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first لملفات التطبيق نفسه، Network-first (مع سقوط للكاش) لأي شيء آخر (خطوط، مكتبة الرسوم)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // لا نتدخل بطلبات المزامنة (POST) — تتعامل معها sync.js مباشرة

  const isAppShell = APP_SHELL.some((p) => req.url.endsWith(p.replace('./', '/')));
  if (isAppShell) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  } else {
    event.respondWith(
      fetch(req).then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      }).catch(() => caches.match(req))
    );
  }
});
