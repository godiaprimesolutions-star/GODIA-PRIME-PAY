
const CACHE_NAME = "godia-prime-pay-v1";

const APP_FILES = [
  "/",
  "/manifest.webmanifest",
  "/icons/godia-prime-pay.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      for (const file of APP_FILES) {
        try {
          const response = await fetch(file, {
            cache: "no-store"
          });

          if (response.ok) {
            await cache.put(file, response);
          }
        } catch (error) {
          // Continue if an optional file is unavailable.
        }
      }

      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();

      await Promise.all(
        names
          .filter(name =>
            name.startsWith("godia-prime-pay-") &&
            name !== CACHE_NAME
          )
          .map(name => caches.delete(name))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);

          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put("/", response.clone());
          }

          return response;
        } catch (error) {
          return (
            await caches.match(request) ||
            await caches.match("/")
          );
        }
      })()
    );

    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);

      if (cached) return cached;

      try {
        return await fetch(request);
      } catch (error) {
        return new Response("You are offline.", {
          status: 503,
          headers: {
            "Content-Type": "text/plain"
          }
        });
      }
    })()
  );
});
