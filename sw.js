/* Service worker: caches the same-origin app shell only. Cross-origin API calls (temp mail, AI) are never intercepted or cached. */
const CACHE = 'burner-hub-v4.20.2';
const SHELL = ['./', './index.html', './css/app.css', './js/store.js', './js/mail.js', './js/bot.js', './js/app.js',
  './js/vendor/purify.min.js', './js/vendor/marked.min.js', './js/vendor/qrcode.min.js', './fonts/Orbitron.ttf',
  './manifest.webmanifest', './img/logo-256.webp', './img/bizzy-128.webp', './img/bizzy-256.webp',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png', './icons/favicon.ico'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // never touch API traffic
  const networkFirst = req.mode === 'navigate' || /\.(js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (networkFirst) {
    e.respondWith(fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
  } else {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })));
  }
});
