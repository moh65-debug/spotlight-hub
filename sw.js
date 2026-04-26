// sw.js — Spotlight Trilogy Service Worker
// Bump CACHE version when you deploy new files to invalidate the old cache.
const CACHE = 'spotlight-v9';

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

const SHELL_OPTIONAL = [
  'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      await c.addAll(SHELL_REQUIRED);
      await Promise.allSettled(
        SHELL_OPTIONAL.map(url =>
          fetch(url, { credentials: 'omit' })
            .then(r => { if (r.ok) c.put(url, r); })
            .catch(() => {})
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Never intercept archive.org — app manages those via IndexedDB
  if (url.hostname === 'archive.org' || url.hostname.endsWith('.archive.org') ||
      url.hostname === 's3.us.archive.org') {
    return;
  }

  // Google Fonts — permanent cache-first
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(request));
    return;
  }

  // cdnjs (pdf.js) — permanent cache-first
  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(cacheFirst(request));
    return;
  }

  // Other cross-origin — don't intercept
  if (url.origin !== self.location.origin) {
    return;
  }

  // Same-origin app shell — stale-while-revalidate
  // Serves from cache INSTANTLY (offline forever), updates in background
  e.respondWith(staleWhileRevalidate(request));
});

function cacheFirst(request) {
  return caches.open(CACHE).then(cache =>
    cache.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request, { credentials: 'omit' }).then(resp => {
        if (resp.ok) cache.put(request, resp.clone());
        return resp;
      }).catch(() => new Response('Offline', { status: 503 }));
    })
  );
}

function staleWhileRevalidate(request) {
  if (request.method !== 'GET') return fetch(request);

  return caches.open(CACHE).then(cache =>
    cache.match(request).then(cached => {
      const networkFetch = fetch(request, { credentials: 'omit' })
        .then(resp => {
          if (resp.ok) cache.put(request, resp.clone());
          return resp;
        })
        .catch(() => null);

      // Serve cache immediately; update silently in background
      return cached || networkFetch.then(resp =>
        resp || new Response('', { status: 503 })
      );
    })
  );
}
