const CACHE_NAME = "auction-radar-shell-v6";
const BASE = new URL(self.registration.scope).pathname;
const APP_SHELL = [
  BASE,
  `${BASE}manifest.webmanifest`,
  `${BASE}strategy.json`,
  `${BASE}icon.svg`,
  `${BASE}icon-192.png`,
  `${BASE}icon-512.png`
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const response = await fetch(BASE);
      const html = await response.text();
      const discovered = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((url) => url.startsWith(BASE));
      const urls = [...new Set([...APP_SHELL, ...discovered])];
      await cache.addAll(urls);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  const isVersionedData =
    url.pathname === `${BASE}strategy.json` ||
    url.pathname === `${BASE}version.json`;
  if (request.mode === "navigate" || isVersionedData) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached =
            (await caches.match(request, { ignoreSearch: true })) ||
            (await caches.match(url.pathname, { ignoreSearch: true }));
          return cached || caches.match(BASE, { ignoreSearch: true });
        })
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached =
        (await caches.match(request, { ignoreSearch: true })) ||
        (await caches.match(url.pathname, { ignoreSearch: true }));
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })()
  );
});
