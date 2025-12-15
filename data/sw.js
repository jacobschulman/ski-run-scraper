// Service Worker for Ski Conditions PWA
const CACHE_NAME = 'ski-conditions-v2';
const STATIC_CACHE = 'ski-static-v2';
const DATA_CACHE = 'ski-data-v2';

// Static assets to cache immediately
const STATIC_ASSETS = [
  '/ski-run-scraper/data/',
  '/ski-run-scraper/data/index.html',
  '/ski-run-scraper/data/styles.css',
  '/ski-run-scraper/data/resort.js',
  '/ski-run-scraper/data/pwa.js',
  '/ski-run-scraper/data/debug.js',
  '/ski-run-scraper/data/trail.js',
  '/ski-run-scraper/data/lift.js',
  '/ski-run-scraper/data/icons/icon-192.png',
  '/ski-run-scraper/data/icons/icon-512.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS.map(url => {
        return new Request(url, { cache: 'reload' });
      })).catch(err => {
        console.log('[SW] Some static assets failed to cache:', err);
      });
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE && name !== DATA_CACHE)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// Fetch event - serve from cache, update in background
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Strategy based on request type
  if (isStaticAsset(url)) {
    // Cache-first for static assets
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
  } else if (isDataRequest(url)) {
    // Network-first for data, with cache fallback
    event.respondWith(networkFirst(event.request, DATA_CACHE));
  } else if (isHtmlPage(url)) {
    // Network-first for HTML pages
    event.respondWith(networkFirst(event.request, STATIC_CACHE));
  }
});

// Check if request is for static asset
function isStaticAsset(url) {
  return url.pathname.endsWith('.css') ||
         url.pathname.endsWith('.js') ||
         url.pathname.endsWith('.png') ||
         url.pathname.endsWith('.ico') ||
         url.pathname.endsWith('.svg') ||
         url.pathname.endsWith('.woff2');
}

// Check if request is for data (JSON)
function isDataRequest(url) {
  return url.pathname.endsWith('.json') ||
         url.pathname.endsWith('.ndjson');
}

// Check if request is for HTML page
function isHtmlPage(url) {
  return url.pathname.endsWith('.html') ||
         url.pathname.endsWith('/');
}

// Cache-first strategy
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    // Return cached, but update in background
    updateCache(request, cache);
    return cachedResponse;
  }

  // Not in cache, fetch from network
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[SW] Cache-first fetch failed:', error);
    return new Response('Offline', { status: 503 });
  }
}

// Network-first strategy
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Return offline page for HTML requests
    if (request.headers.get('Accept')?.includes('text/html')) {
      return new Response(getOfflineHtml(), {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    return new Response('Offline', { status: 503 });
  }
}

// Update cache in background
async function updateCache(request, cache) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse);
    }
  } catch (error) {
    // Silently fail - we already have cached version
  }
}

// Offline HTML fallback
function getOfflineHtml() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Offline - Ski Conditions</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #121212;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 20px;
    }
    .offline-container {
      max-width: 400px;
    }
    .offline-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }
    p {
      color: #888;
      margin-bottom: 1.5rem;
    }
    button {
      background: #3a7bd5;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover {
      background: #2c5aa0;
    }
  </style>
</head>
<body>
  <div class="offline-container">
    <div class="offline-icon">📡</div>
    <h1>You're Offline</h1>
    <p>Check your internet connection and try again.</p>
    <button onclick="location.reload()">Try Again</button>
  </div>
</body>
</html>
  `;
}

// Listen for messages from main thread
self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((names) => {
      names.forEach((name) => caches.delete(name));
    });
  }
});
