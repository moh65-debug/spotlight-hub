// sw.js — Spotlight Trilogy Service Worker
const CACHE = 'spotlight-v3';

// Core shell — files that MUST exist for the app to open.
const SHELL_REQUIRED = [
  './index.html',
  './book.html',
];

// Optional shell files: cached during install but a missing one won't abort install.
const SHELL_OPTIONAL = [
  './data.js',
  './file-list.json',
  'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap',
  // Pre-cache PDF.js so the viewer works offline immediately
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
];

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      // Required files — if these fail, install fails (correct behaviour).
      await c.addAll(SHELL_REQUIRED);

      // Optional files — cache each individually; skip on error.
      await Promise.allSettled(
        SHELL_OPTIONAL.map(url =>
          fetch(url)
            .then(r => { if (r.ok) c.put(url, r); })
            .catch(() => {/* ignore — will be cached when first used online */})
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

  // Google Fonts — cache-first
  if (url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com') {
    e.respondWith(cacheFirst(request));
    return;
  }

  // Other Google hosts (Drive, etc.) — never intercept
  if (url.hostname.includes('google') || url.hostname.includes('googleapis.com')) {
    return;
  }

  // archive.org — cache-first (CORS-enabled, perfect for offline file storage)
  if (url.hostname === 'archive.org') {
    e.respondWith(cacheFirst(request));
    return;
  }

  // cdnjs (pdf.js) — cache-first
  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(cacheFirst(request));
    return;
  }

  // Same-origin app shell — network-first, fall back to cache
  e.respondWith(networkFallingBackToCache(request));
});

// ── STRATEGIES ────────────────────────────────────────────────────────────────

function cacheFirst(request) {
  return caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(resp => {
      if (resp.ok) {
        caches.open(CACHE).then(c => c.put(request, resp.clone()));
      }
      return resp;
    }).catch(() => new Response('Offline', { status: 503 }));
  });
}

function networkFallingBackToCache(request) {
  return fetch(request)
    .then(resp => {
      if (request.method === 'GET' && resp.ok) {
        caches.open(CACHE).then(c => c.put(request, resp.clone()));
      }
      return resp;
    })
    .catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      // Navigation fallback: serve shell so the SPA can at least render
      if (request.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      return new Response('', { status: 503 });
    });
}
