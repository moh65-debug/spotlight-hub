// sw.js — Spotlight Trilogy Service Worker
const CACHE = 'spotlight-v6';

// Core shell — these MUST be cached for the app to open offline.
const SHELL_REQUIRED = [
  './index.html',
  './book.html',
  './data.js',
  './js/utils.js',
  './js/render.js',
  './js/download.js',
  './js/audio.js',
  './js/pdf.js',
  './js/main.js',
];

// Optional shell: cached on install, skipped if unavailable.
const SHELL_OPTIONAL = [
  'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.269/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.269/pdf.worker.min.js',
];

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      // Required files — fail install if any of these can't be fetched.
      await c.addAll(SHELL_REQUIRED);

      // Optional — cache individually, skip on error.
      await Promise.allSettled(
        SHELL_OPTIONAL.map(url =>
          fetch(url)
            .then(r => { if (r.ok) c.put(url, r); })
            .catch(() => {})
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // ── archive.org ──
  // NEVER intercept archive.org requests. These are large binary files
  // (PDFs, MP3s) that the app downloads on demand via fetch()+IndexedDB.
  // Intercepting them causes redirect-chain failures and blocks downloads.
  // The app manages its own offline storage for these via IndexedDB (IDB).
  if (url.hostname === 'archive.org' || url.hostname.endsWith('.archive.org')) {
    return; // let the browser handle it natively
  }

  // ── Google Fonts (stylesheet + glyphs) — cache-first ──
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(request));
    return;
  }

  // ── cdnjs (pdf.js) — cache-first ──
  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(cacheFirst(request));
    return;
  }

  // ── Any other cross-origin request — don't intercept ──
  if (url.origin !== self.location.origin) {
    return;
  }

  // ── Same-origin app shell — cache-first with background refresh ──
  // Cache-first means the app opens instantly and fully offline after
  // the first visit. The background refresh keeps content up to date.
  e.respondWith(cacheFirstWithNetworkUpdate(request));
});

// ── STRATEGIES ────────────────────────────────────────────────────────────────

/**
 * Cache-first: serve from cache immediately.
 * If not cached, fetch from network and store it.
 */
function cacheFirst(request) {
  return caches.open(CACHE).then(cache =>
    cache.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(resp => {
        if (resp.ok) cache.put(request, resp.clone());
        return resp;
      }).catch(() => new Response('Offline', { status: 503 }));
    })
  );
}

/**
 * Cache-first with background network update (stale-while-revalidate).
 * Serves the cached version instantly; fetches from the network silently
 * in the background to refresh the cache for next time.
 */
function cacheFirstWithNetworkUpdate(request) {
  return caches.open(CACHE).then(cache =>
    cache.match(request).then(cached => {
      const networkFetch = fetch(request).then(resp => {
        if (request.method === 'GET' && resp.ok) {
          cache.put(request, resp.clone());
        }
        return resp;
      }).catch(() => null);

      // Return cache instantly; if nothing cached yet, wait for network
      return cached || networkFetch.then(resp =>
        resp || new Response('', { status: 503 })
      );
    })
  );
}
