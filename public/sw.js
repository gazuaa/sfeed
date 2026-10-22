// Like Slap, cache only public install/offline assets. Account data and the app
// HTML always come from the network, so switching accounts cannot expose a
// previous user's feed and a deployment cannot leave an old app shell behind.
const CACHE = 'sfeed-public-v1';
const OFFLINE = '/offline.html';
const PUBLIC_ASSETS = [OFFLINE, '/offline.js', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PUBLIC_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('sfeed-public-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || /^\/(?:api|auth)(?:\/|$)/.test(url.pathname)) return;
  if (PUBLIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then((cache) => cache.match(url.pathname)).then((cached) => cached || fetch(request)));
  } else if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match(OFFLINE).then((cached) => cached || new Response('인터넷에 연결한 뒤 다시 열어 주세요.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))));
  }
});
