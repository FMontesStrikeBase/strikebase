// StrikeBase — Service Worker
// Fase 1: instalabilidad + caché mínimo del shell de la app.
// Fase 2: notificaciones push en segundo plano (Firebase Cloud Messaging).

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

// ── FASE 2 PWA: FIREBASE CLOUD MESSAGING (notificaciones en segundo plano) ──
// Necesita su propia inicialización de Firebase — un service worker no puede
// importar el módulo de la app principal, así que repetimos el mismo config.
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyA_Io6E_Q5-dOrtSSZPlb8DWbHgsWgaGPw",
  authDomain: "strikebase-67c2b.firebaseapp.com",
  projectId: "strikebase-67c2b",
  storageBucket: "strikebase-67c2b.firebasestorage.app",
  messagingSenderId: "356447443955",
  appId: "1:356447443955:web:e504c6acd8b1e2ea609086"
});

const messaging = firebase.messaging();

// Se dispara cuando llega una notificación y la app NO está en primer plano
// (cerrada o en otra pestaña) — el caso real que justifica todo esto.
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'StrikeBase';
  const body = payload.notification?.body || '';
  self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.data?.habitId || 'strikebase-reminder'
  });
});

// Al tocar la notificación, llevar directo a la app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes('/app.html'));
      if (existing) return existing.focus();
      return clients.openWindow('/app.html');
    })
  );
});
