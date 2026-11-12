// Offline: the app itself (page, styles, scripts, map library) is kept in a cache and used when the
// network isn't there; online, the newest version always comes from the network. Map tiles, fonts and transit data always come from the network.
const CACHE = "wayfinder-v3";
const SHELL = ["./", "index.html", "css/app.css", "js/app.js", "js/api.js", "js/basemap.js", "js/diagram.js", "js/lines.js", "js/network.js", "js/net-worker.js", "js/util.js",
  "vendor/maplibre-gl/maplibre-gl.js", "vendor/maplibre-gl/maplibre-gl.css", "icon.svg", "manifest.webmanifest"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
