/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="WebWorker" />

const CACHE_NAME = 'grazerduck-v1';

// Injected by vite-plugin-pwa at build time
const PRECACHE = self.__WB_MANIFEST || [];

/**
 * Adds COOP/COEP headers to every response so SharedArrayBuffer is available
 * even on GitHub Pages (which can't set these headers server-side).
 * This enables DuckDB's COI bundle (multi-threaded, maximum performance).
 */
function withCOI(response) {
  if (!response || response.status === 0 || response.type === 'opaque') {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        const urls = PRECACHE.map((e) => e.url);
        return cache.addAll(urls);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const cached = await cache.match(event.request);
        if (cached) return withCOI(cached);

        const response = await fetch(event.request);
        if (response.ok) {
          await cache.put(event.request, response.clone());
        }
        return withCOI(response);
      } catch {
        const cached = await cache.match(event.request);
        if (cached) return withCOI(cached);
        return new Response('Offline — resource not cached', { status: 503 });
      }
    })
  );
});
