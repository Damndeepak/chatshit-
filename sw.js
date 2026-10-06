const CACHE_NAME = "chatshit-shell-v9";
const APP_SHELL = [
  "./",
  "./index.html",
  "./privacy.html",
  "./manifest.webmanifest",
  "./assets/chatshit-mark-192.png",
  "./assets/chatshit-mark-512.png",
  "./assets/chatshit-mark.svg",
  "./css/base.css",
  "./css/components.css",
  "./css/responsive.css",
  "./css/privacy.css",
  "./js/identity.js",
  "./js/cloud-config.js?v=chat-v9",
  "./js/cloud.js?v=chat-v9",
  "./js/theme.js",
  "./js/spotify.js",
  "./js/dms.js?v=chat-v9"
];

self.addEventListener("install", event => {
  event.waitUntil(Promise.all([
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)),
    self.skipWaiting()
  ]));
});

self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("chatshit-") && key !== CACHE_NAME).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }

  event.respondWith(caches.match(request).then(cached => {
    const fresh = fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => cached);
    return cached || fresh;
  }));
});
