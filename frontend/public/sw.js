/* ConsultUro — minimal PWA service worker.
 *
 * Why minimal?
 *   • Chrome/Edge will only show the "Install app" A2HS prompt when a
 *     SW is registered AND the manifest is valid.
 *   • iOS Safari does NOT require a SW for "Add to Home Screen", but
 *     having one ensures the installed PWA still launches the app
 *     even on a flaky connection.
 *
 * We deliberately DO NOT aggressively cache the Metro bundle here —
 * Metro produces hashed JS chunks that already cache well via standard
 * HTTP cache-control. Doing precache here causes weeks-old bundles to
 * get pinned and breaks live updates.
 *
 * Strategy:
 *   • install:   skipWaiting so a new SW immediately replaces the old.
 *   • activate:  claim() all open tabs and clean any stale caches.
 *   • fetch:     network-first, with a tiny offline fallback for the
 *                root document so the app can at least open offline.
 *   • messages:  honour {type: "SKIP_WAITING"} from the page for the
 *                live "Update available — reload" banner.
 */

const SW_VERSION = 'v2026.06.20.1';
const RUNTIME_CACHE = 'consulturo-runtime-' + SW_VERSION;
const OFFLINE_DOC_CACHE = 'consulturo-offline-' + SW_VERSION;

const OFFLINE_DOC_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(OFFLINE_DOC_CACHE);
        await cache.addAll([OFFLINE_DOC_URL]);
      } catch (_e) {
        // Offline page is optional — service worker still installs
        // even if the file isn't present (e.g. first deploy).
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              (k.startsWith('consulturo-runtime-') && k !== RUNTIME_CACHE) ||
              (k.startsWith('consulturo-offline-') && k !== OFFLINE_DOC_CACHE)
          )
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Fetch handler ─────────────────────────────────────────────────
// Network-first for navigations (so users always see the latest UI),
// with offline.html as the fallback when the network is unreachable.
// Same-origin GETs for JS/CSS/images get a fast stale-while-revalidate
// runtime cache to keep launches snappy on cellular.
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests — POSTs (API calls) should always go to
  // the network and never be cached.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip non-same-origin requests (cross-origin assets, analytics, etc.)
  if (url.origin !== self.location.origin) return;

  // Skip backend API calls (they're proxied through /api/* and should
  // ALWAYS hit the network — caching auth/data would be a security
  // and correctness hazard).
  if (url.pathname.startsWith('/api/')) return;

  // Document navigations → network-first, fallback to offline.html.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          return fresh;
        } catch (_e) {
          const cache = await caches.open(OFFLINE_DOC_CACHE);
          const cached = await cache.match(OFFLINE_DOC_URL);
          if (cached) return cached;
          // Last resort — return a tiny inline document so the user
          // doesn't see the browser's default offline screen.
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
              '<body style="font-family:system-ui;background:#0E7C8B;color:#fff;' +
              'min-height:100vh;display:flex;align-items:center;justify-content:center;' +
              'text-align:center;padding:24px"><div><h1>You are offline</h1>' +
              '<p>Reopen ConsultUro when you are back online.</p></div>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      })()
    );
    return;
  }

  // Static asset → stale-while-revalidate.
  if (
    /\.(js|css|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        const networkPromise = fetch(req)
          .then((res) => {
            // Only cache successful, basic responses (skip opaque
            // cross-origin and error responses).
            if (res && res.ok && res.type === 'basic') {
              cache.put(req, res.clone()).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkPromise;
      })()
    );
  }
});
