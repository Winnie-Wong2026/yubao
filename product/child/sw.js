const CACHE = "yubao-child-v15";
const SHELL = [
  "/product/child/", "/product/child/index.html", "/product/child/child.css?v=1.2.6-taskscope1", "/product/child/child.js?v=1.2.6-taskscope1",
  "/product/child/manifest.webmanifest?v=1.2.4-pwa2", "/product/shared.css?v=1.2.6", "/product/shared.js", "/product/task-scope.js", "/vendor/lucide.min.js",
  "/assets/01_品牌与入口/brand_child_apple_touch_icon_180_v02.png",
  "/assets/01_品牌与入口/brand_child_pwa_icon_192_v02.png",
  "/assets/01_品牌与入口/brand_child_pwa_icon_512_v02.png",
  "/assets/05_星币与反馈元素/currency_starcoin_v01.png"
];

self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (url.pathname.startsWith("/product/uploads/") || event.request.destination === "video") {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
