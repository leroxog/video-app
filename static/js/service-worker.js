const CACHE_NAME = "timeskip-shell-v1";
const APP_SHELL = [
    "/offline",
    "/static/css/style.css",
    "/static/js/photo-text-overlay.js",
    "/static/manifest.json",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Full page loads: network-first (always fresh when online), cache
    // previously-visited pages so they still open when offline, and fall
    // back to a dedicated offline page for anything never visited before.
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(() =>
                    caches.match(request).then((cached) => cached || caches.match("/offline"))
                )
        );
        return;
    }

    // Static assets (css/js/images): network-first with a cache fallback,
    // so games and other already-loaded client-side pages keep working
    // offline once their assets have been fetched at least once.
    if (url.pathname.startsWith("/static/") || url.pathname.startsWith("/posts/")) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(() => caches.match(request))
        );
    }
});
