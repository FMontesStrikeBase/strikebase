// StrikeBase — Service Worker (Fase 1 PWA)
// Objetivo de esta fase: instalabilidad + caché mínimo del shell de la app.
// Las notificaciones push se conectan en una fase posterior, cuando ya
// tengamos datos reales de instalación y retención.

const CACHE_NAME = 'strikebase-v1';
const APP_SHELL = [
  '/app.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// ── INSTALL: cachear el shell mínimo ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// ── ACTIVATE: limpiar cachés de versiones anteriores ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH: network-first para HTML (para no servir una versión vieja de la app
// mientras sigue en desarrollo activo), cache-first para el resto (íconos, manifest) ──
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // No interferir con llamadas a Firebase/Firestore ni a APIs externas
  if (!req.url.startsWith(self.location.origin)) return;

  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/app.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
