/**
 * Service Worker — Svenska Flashcards
 * Strategy: cache-first pour le shell, network-first pour cards.json (au cas où il évolue).
 * L'audio n'est PAS dans le cache SW — il est stocké en IndexedDB après import manuel.
 */

const VERSION = 'svenska-v17';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './cards.json',
  './travel.json',
  './js/app.js',
  './js/db.js',
  './js/sm2.js',
  './js/session.js',
  './js/audio.js',
  './js/sound.js',
  './js/exercises.js',
  './js/import.js',
  './js/ui.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      // addAll fails atomically; use individual adds to tolerate missing optional files
      Promise.all(
        SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn('SW: skip', url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // cards.json + travel.json: stale-while-revalidate
  // → sert immédiatement la version cache (boot rapide), met à jour
  //   le cache en arrière-plan pour le prochain démarrage.
  if (url.pathname.endsWith('/cards.json') || url.pathname.endsWith('/travel.json')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchAndCache = fetch(request)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(request, copy));
            }
            return res;
          })
          .catch(() => cached); // si le réseau échoue, on retombe sur le cache
        // Si on a du cache, on le renvoie tout de suite ; sinon on attend le réseau.
        return cached || fetchAndCache;
      })
    );
    return;
  }

  // Default: cache-first
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
