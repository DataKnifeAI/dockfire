/* DockFire service worker — cache shell + mock so the hub still opens if the cluster is down. */
const CACHE = "dockfire-v29";
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css?v=29",
  "./app.js?v=29",
  "./manifest.webmanifest",
  "./catalog.json",
  "./providers.json",
  "./wiki.json",
  "./emergency.json",
  "./hazards.json",
  "./home.json",
  "./services.json",
  "./mock/home.json",
  "./mock/status.json",
  "./assets/icons/dockfire-pwa-192.png",
  "./assets/icons/dockfire-pwa-512.png",
  "./assets/icons/dockfire-favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

function mockForApi(url) {
  if (url.pathname === "/api/home") return "./mock/home.json";
  if (url.pathname === "/api/status") return "./mock/status.json";
  return null;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Live health: network first, then cached API response, then mock.
  if (isApi(url)) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(CACHE);
            cache.put(req, fresh.clone());
            return fresh;
          }
        } catch (_) {
          /* offline */
        }
        const cached = await caches.match(req);
        if (cached) return cached;
        const mockPath = mockForApi(url);
        if (mockPath) {
          const mock = await caches.match(mockPath);
          if (mock) return mock;
          try {
            return await fetch(mockPath);
          } catch (_) {
            /* fall through */
          }
        }
        return new Response(JSON.stringify({ error: "offline", mock: true }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      })()
    );
    return;
  }

  // App shell / static: stale-while-revalidate style (cache first, refresh in background).
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const fresh = await network;
      if (fresh) return fresh;
      if (req.mode === "navigate") {
        const shell = await caches.match("./index.html");
        if (shell) return shell;
      }
      return new Response("Offline", { status: 503, statusText: "Offline" });
    })()
  );
});
