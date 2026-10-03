// public/sw.js — SP-5-09: Spandik app-shell service worker. Hand-written,
// no Workbox. Privacy rules (non-negotiable):
//   * Only SAME-ORIGIN GET requests are ever touched. The API
//     (api.spandik.com) and media (media.spandik.com, /media/serve) are
//     other origins, so authenticated/private responses and private media
//     are never cached or served by this worker — media authorization is
//     exactly as before.
//   * Only the public app shell ('/') and static, content-hashed build
//     assets (/assets/*) plus brand files (/brand/*) are cached. No user
//     data lives in these caches, so logout/account switch cannot leak
//     another user's content from here.
// Update path: a new sw.js installs and WAITS; the page shows "a new
// version is ready" and posts SKIP_WAITING only when the person agrees.
// Bump VERSION whenever this file's caching logic changes.
const VERSION = 'v1'
const SHELL = `spandik-shell-${VERSION}`
const STATIC = `spandik-static-${VERSION}`
const MAX_STATIC_ENTRIES = 80

async function precacheShell() {
  const cache = await caches.open(SHELL)
  const res = await fetch('/', { cache: 'no-store' })
  if (!res.ok) return
  const html = await res.clone().text()
  await cache.put('/', res)
  // The built index.html names its own hashed entry chunks/styles — cache
  // those too so the shell works offline right after the first visit.
  const assets = [...new Set(html.match(/\/assets\/[^"'\s>]+/g) || [])]
  const staticCache = await caches.open(STATIC)
  await Promise.all(assets.map(a => staticCache.add(a).catch(() => {})))
  await staticCache.addAll(['/manifest.json', '/brand/spandik-app-icon-192.png']).catch(() => {})
}

async function trim(cache) {
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - MAX_STATIC_ENTRIES; i++) await cache.delete(keys[i])
}

self.addEventListener('install', event => {
  event.waitUntil(precacheShell().catch(() => {}))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(k => k.startsWith('spandik-') && k !== SHELL && k !== STATIC).map(k => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // never API, media or third parties

  if (req.mode === 'navigate') {
    // Network-first: online users always get the latest deploy. Only the
    // root shell is stored; any route falls back to it offline (SPA).
    event.respondWith((async () => {
      try {
        const res = await fetch(req)
        if (res.ok && url.pathname === '/') {
          const copy = res.clone()
          caches.open(SHELL).then(c => c.put('/', copy))
        }
        return res
      } catch {
        return (await caches.match('/')) || Response.error()
      }
    })())
    return
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/brand/') || url.pathname === '/manifest.json') {
    // Content-hashed / immutable → cache-first.
    event.respondWith((async () => {
      const hit = await caches.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok) {
        const copy = res.clone()
        caches.open(STATIC).then(async c => { await c.put(req, copy); await trim(c) })
      }
      return res
    })())
  }
})
