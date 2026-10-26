/* ফাইল ম্যাজিক — Service Worker (offline support, Day 15 hardening) */
const CACHE = "file-magic-v6";

// core shell precached at install → the app opens offline even on FIRST run
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/logo.svg",
  "/pdf.worker.min.mjs",
];

// OCR engine assets — warmed in the BACKGROUND after activation so a future
// offline OCR session works end-to-end (gate note: tessdata/wasm pre-cache).
// The .wasm variant actually fetched at runtime is cached on first use anyway;
// simd-lstm is what every modern browser loads.
const OCR_WARMUP = [
  "/tesseract/tesseract.min.js",
  "/tesseract/worker.min.js",
  "/tesseract/core/tesseract-core-simd-lstm.wasm.js",
  "/tesseract/core/tesseract-core-simd-lstm.wasm",
  "/tessdata/ben.traineddata.gz",
  "/tessdata/eng.traineddata.gz",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // never fail install because one optional asset 404'd
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const res = await fetch(url);
            if (res && res.ok) await cache.put(url, res);
          } catch {
            /* skip */
          }
        })
      );
      self.skipWaiting();
    })()
  );
});

// background OCR cache warmup — best-effort, never blocks anything
async function warmOcr() {
  try {
    const cache = await caches.open(CACHE);
    await Promise.all(
      OCR_WARMUP.map(async (url) => {
        try {
          if (await cache.match(url)) return;
          const res = await fetch(url);
          if (res && res.ok) await cache.put(url, res);
        } catch {
          /* offline or 404 — runtime caching will catch it later */
        }
      })
    );
  } catch {
    /* ignore */
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
      await warmOcr();
    })()
  );
});

// let the page force-activate a waiting SW / re-warm the OCR cache
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
  if (event.data === "WARM_OCR") event.waitUntil(warmOcr());
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, res.clone());
  }
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // navigation offline fallback → precached shell
    if (request.mode === "navigate") {
      const shell = await caches.match("/");
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // never intercept dev/HMR sockets or docs
  if (url.pathname.startsWith("/_next/webpack-hmr")) return;

  // immutable engine assets + hashed build output → cache first
  if (
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/icon-") ||
    url.pathname.startsWith("/tessdata/") ||
    url.pathname.startsWith("/tesseract/")
  ) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});
