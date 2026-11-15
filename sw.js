// Offline support. Bump VERSION when app files change so phones pick up the update.
const VERSION = "v4";
const SHELL = `shell-${VERSION}`;
const STROKES = "strokes-v1"; // stroke-order data fetched from jsDelivr, kept across versions
const SHELL_FILES = [
  "./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "vendor/hanzi-writer.min.js", "data/characters.json",
  "icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== STROKES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Stroke data: cache-first (it never changes).
  if (url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("hanzi-writer-data")) {
    e.respondWith(
      caches.open(STROKES).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }

  if (url.origin !== location.origin) return;
  // Audio clips: leave to the browser (Safari plays media with Range requests,
  // which cached full responses don't satisfy).
  if (url.pathname.includes("/audio/")) return;

  // Character list: network-first so edits to the JSON show up right away.
  if (url.pathname.endsWith("/data/characters.json")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => { caches.open(SHELL).then((c) => c.put(e.request, res.clone())); return res; })
        .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
    return;
  }

  // App shell: cache-first.
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
