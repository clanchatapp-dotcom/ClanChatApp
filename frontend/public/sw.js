// ClanChat — minimal Progressive Web App service worker.
//
// Two jobs:
//   1. Satisfy the browser install-eligibility check so the "Add to Home
//      Screen" prompt actually fires.
//   2. Provide a network-first cache for the app shell so a brief offline
//      hiccup doesn't blank the UI.
//
// Deliberately tiny: no push handling (that lives in the Firebase
// service worker in a future sprint), no background sync, no fancy
// runtime caching heuristics. Bump SHELL_CACHE when you ship an
// incompatible change so old caches get purged.

const SHELL_CACHE = "clanchat-shell-v1";
const SHELL_URLS = [
  "/",
  "/feed",
  "/manifest.json",
  "/favicon.ico",
  "/brand/icon-192.png",
  "/brand/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Individually — a single failure shouldn't nuke the whole install.
      Promise.all(SHELL_URLS.map((u) => cache.add(u).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for navigations (so we always try to get fresh HTML),
// falling back to the cached shell if the network is unreachable.
// API calls (/api/*) are never cached — we always want live data.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never intercept the backend. This is essential for auth and DMs to
  // stay fresh, and to avoid CORS surprises with cached responses.
  if (url.pathname.startsWith("/api/")) return;

  // For navigations, network-first with cache fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/").then((r) => r || caches.match("/feed")))
    );
    return;
  }

  // Same-origin static assets: cache-first, freshen in background.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetching = fetch(req)
          .then((resp) => {
            if (resp.ok) {
              const clone = resp.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(req, clone));
            }
            return resp;
          })
          .catch(() => cached);
        return cached || fetching;
      })
    );
  }
});
