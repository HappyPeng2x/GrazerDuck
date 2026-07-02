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
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE.map((e) => e.url));

    // The precache stores 'index.html', but an installed PWA launches by
    // navigating to the base URL (e.g. http://localhost:8765/ or /GrazerDuck/).
    // Explicitly put the root URL in cache so offline navigation always hits.
    const base     = new URL('./',         self.location.href).href;
    const indexUrl = new URL('index.html', self.location.href).href;
    const indexRes = await cache.match(indexUrl);
    if (indexRes) await cache.put(base, indexRes);

    await self.skipWaiting();
  })());
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

  // Navigation requests land on the root URL (e.g. http://localhost:8765/ or
  // https://host/GrazerDuck/), but the precache stores the file as index.html.
  // Map trailing-slash navigations to index.html so the app opens offline even
  // when '/' was never fetched through the SW (which happens when the server
  // already sends COOP/COEP headers and the COI-reload guard never fires).
  const lookupRequest =
    event.request.mode === 'navigate' && url.pathname.endsWith('/')
      ? new Request(new URL('index.html', event.request.url).href)
      : event.request;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const cached = await cache.match(lookupRequest);
        if (cached) return withCOI(cached);

        const response = await fetch(event.request);
        if (response.ok) {
          await cache.put(event.request, response.clone());
        }
        return withCOI(response);
      } catch {
        const cached = await cache.match(lookupRequest);
        if (cached) return withCOI(cached);
        return new Response('Offline — resource not cached', { status: 503 });
      }
    })
  );
});
