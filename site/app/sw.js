const PREFIX = 'plot-it-site-app-';
const CACHE = `${PREFIX}v1`;
const CORE = ['/app/', '/app/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const navigation = event.request.mode === 'navigate';
  if (navigation && !url.pathname.startsWith('/app/')) return;
  if (!navigation && !['/app/', '/assets/', '/fonts/'].some(prefix => url.pathname.startsWith(prefix)) && url.pathname !== '/icon.svg') return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => undefined));
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (navigation ? await caches.match('/app/') : undefined) || Response.error()));
});
