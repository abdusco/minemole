const CACHE_NAME = "minemole-cache-v1";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./gameLogic.js", "./manifest.json"];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") {
        return;
    }

    const requestURL = new URL(event.request.url);

    if (event.request.mode === "navigate") {
        event.respondWith(fetch(event.request).catch(() => caches.match("./index.html")));
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request)
                .then((networkResponse) => {
                    const copy = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, copy).catch(() => {
                            // Ignore put errors (e.g., opaque responses).
                        });
                    });
                    return networkResponse;
                })
                .catch(() => {
                    if (requestURL.origin === self.location.origin) {
                        if (event.request.destination === "document") {
                            return caches.match("./index.html");
                        }
                    }
                    return cachedResponse;
                });
        })
    );
});
