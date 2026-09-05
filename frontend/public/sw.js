// Service Worker — Wise Owl Entertainment
// Caches the app shell for offline access + fast repeat loads.
// Video streams are NOT cached here (handled by disk-cache on server).

const CACHE_NAME = 'woe-v1';
const APP_SHELL = [
  '/',
  '/index.html',
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET, API calls, streaming, and HLS segments
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/stream') ||
    url.pathname.startsWith('/live-hls/') ||
    url.pathname.startsWith('/transcode/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/follow/') ||
    url.pathname.startsWith('/watch/') ||
    url.pathname.startsWith('/favorites')
  ) {
    return; // let these go to network normally
  }

  // Static assets: cache-first (JS, CSS, images)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache successful responses for static assets
        if (response.ok && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.woff2'))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => caches.match('/index.html'))
  );
});
