// sw.js — makes the installed app open (and /help readable) without a network.
// Served no-cache by .htaccess, so an update reaches installed phones.
//
//   * Pages: network first, so a new release is seen at once; the cached copy
//     is the offline fallback only.
//   * /_next/static/: cache first. Those names carry a content hash, so a
//     cached file can never be stale.
//   * Anything cross-origin (Supabase) is not touched: data is always live,
//     and nothing a user can read is stored by this worker.
//
// ponytail: old hashed files pile up in the cache across releases. Bump CACHE
// to clear it if that ever matters.
const CACHE = "itrack-v1";
// A page never opened online has no cached code to run, so serving another
// page's HTML in its place crashes React. Say so plainly instead.
const OFFLINE = () => new Response(
  "<!doctype html><meta name='viewport' content='width=device-width'><title>ITrack: offline</title>" +
  "<p style='font:16px system-ui;margin:2rem'>You are offline. Reconnect and try again.</p>",
  { headers: { "Content-Type": "text/html; charset=utf-8" } });

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || OFFLINE())));
  }
});
