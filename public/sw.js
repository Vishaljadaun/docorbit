/* DocOrbit's minimal app-shell service worker.
 * Never cache document contents, uploads, media downloads, Cloud AI,
 * requests to any other domain, or non-static API responses.
 */
const CACHE = "docorbit-static-v1";
const BASE = new URL(self.registration.scope).pathname;
const SHELL = [BASE, BASE + "manifest.webmanifest", BASE + "favicon.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys
      .filter(key => key.startsWith("docorbit-static-") && key !== CACHE)
      .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  if (req.mode === "navigate") {
    // Prefer the current website, with the previously opened shell offline.
    event.respondWith(fetch(req).then(async response => {
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(BASE, response.clone());
      }
      return response;
    }).catch(async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(BASE)) || Response.error();
    }));
    return;
  }

  // Only hashed Vite JavaScript and CSS assets are stored. Not user files.
  if (url.pathname.startsWith(BASE + "assets/") &&
      (req.destination === "script" || req.destination === "style")) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const found = await cache.match(req);
      if (found) return found;
      const response = await fetch(req);
      if (response.ok) await cache.put(req, response.clone());
      return response;
    }));
  }
});
