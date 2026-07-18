const SHELL_CACHE = 'cark-shell-v1'
const PAPER_CACHE = 'cark-paper-v1'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith('cark-') && ![SHELL_CACHE, PAPER_CACHE].includes(name)).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  )
})

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch (error) {
    const cached = await cache.match(request)
    if (cached) return cached
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname === '/api/papers' || url.pathname.startsWith('/api/papers/') || url.pathname.startsWith('/api/media/')) {
    event.respondWith(networkFirst(request, PAPER_CACHE))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE).catch(() => caches.match('/index.html')))
    return
  }

  if (url.pathname.startsWith('/assets/') || url.pathname === '/icon.svg' || url.pathname === '/manifest.webmanifest') {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) caches.open(SHELL_CACHE).then((cache) => cache.put(request, response.clone()))
      return response
    })))
  }
})
