// Offline: the app itself (page, styles, scripts, map library) is kept in a cache and used when the
// network isn't there; online, the newest version always comes from the network. Map tiles, fonts and transit data always come from the network.
const CACHE = "wayfinder-v16";
const SHELL = ["./", "index.html", "css/app.css", "js/app.js", "js/api.js", "js/basemap.js", "js/diagram.js", "js/lines.js", "js/network.js", "js/net-worker.js", "js/tile-worker.js", "js/tiles.js", "js/maritime.js", "js/aviation.js", "js/streets.js", "js/icons.js", "js/fids.js", "js/ski.js", "js/util.js",
  "vendor/maplibre-gl/maplibre-gl.js", "vendor/maplibre-gl/maplibre-gl.css", "vendor/pmtiles/pmtiles.js", "icon.svg", "manifest.webmanifest"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // The ski tiles are read in byte ranges straight from the server.
  if (url.pathname.endsWith(".pmtiles")) return;
  // Always ask the server whether a file changed (no stale copies from the browser's cache).
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
