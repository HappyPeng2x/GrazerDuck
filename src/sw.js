/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="WebWorker" />

const CACHE_NAME = 'grazerduck-v1';

// Injected by vite-plugin-pwa at build time
const PRECACHE = self.__WB_MANIFEST || [];

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
  // Call skipWaiting() OUTSIDE event.waitUntil so it is not awaited —
  // awaiting it inside waitUntil can deadlock (skipWaiting needs the install
  // event to finish, but the install event would be waiting for skipWaiting).
  self.skipWaiting();

  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Use allSettled so one failed download (e.g. a large WASM file timing out
    // against the sequential PowerShell server) does not abort the whole install.
    await Promise.allSettled(PRECACHE.map((e) => cache.add(e.url)));

    // The precache stores 'index.html' but an installed PWA navigates to the
    // base URL (http://localhost:8765/ or /GrazerDuck/).  Clone index.html and
    // put it under the root URL so cache.match(navigationRequest) always hits.
    const base     = new URL('./',         self.location.href).href;
    const indexUrl = new URL('index.html', self.location.href).href;
    try {
      // Fetch a fresh clone from the cache — do NOT reuse a Response body that
      // was already consumed by cache.add(); each cache.match() returns a new
      // ReadableStream-backed clone that can be safely put into another entry.
      const idx = await cache.match(indexUrl);
      if (idx) {
        // clone() is required: cache.put() drains the body; the clone keeps
        // the original entry intact so cache.match(indexUrl) still works.
        await cache.put(base, idx.clone());
      }
    } catch (_) { /* non-fatal */ }
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

  // Navigation requests land on the base URL (ending in '/') but the
  // precache key is 'index.html'.  Map them so cache.match always finds a hit.
  const isNav    = event.request.mode === 'navigate';
  const lookupUrl =
    isNav && url.pathname.endsWith('/')
      ? new URL('index.html', event.request.url).href
      : event.request.url;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // 1 — Cache-first (ignoreSearch so ?utm_* params don't bust the lookup)
    const cached = await cache.match(lookupUrl, { ignoreSearch: true });
    if (cached) {
      // Proactively store under the actual navigation URL so the next offline
      // open finds it with a direct cache.match(event.request) lookup too.
      if (lookupUrl !== event.request.url) {
        cache.put(event.request.url, cached.clone()).catch(() => {});
      }
      return withCOI(cached);
    }

    // 2 — Network (online path: fetch and cache for later)
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        cache.put(event.request, response.clone()).catch(() => {});
      }
      return withCOI(response);
    } catch {
      // 3 — Offline fallback: try the original URL, then index.html
      const fallback =
        await cache.match(event.request, { ignoreSearch: true }) ||
        (isNav && await cache.match(indexUrl));
      if (fallback) return withCOI(fallback);
      return new Response('Offline — resource not cached', { status: 503 });
    }
  })());
});
