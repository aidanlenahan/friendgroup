/// <reference lib="webworker" />

import { precacheAndRoute, cleanupOutdatedCaches, getCacheKeyForURL } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>
}

const SW_VERSION = 'gem-sw-v1'
const NAV_CACHE = `${SW_VERSION}-nav`
const OFFLINE_URL = '/offline.html'

// Workbox handles all hashed asset caching via precacheAndRoute.
// The custom static cache is removed — it competed with Workbox's fetch
// handler and caused the second event.respondWith() call to fail.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

self.addEventListener('install', () => {
  // Skip waiting so the new SW takes over immediately on deploy.
  // Paired with the vite:preloadError reload in main.tsx, which recovers
  // any open tabs that have stale chunk URLs after a deploy.
  self.skipWaiting()
})

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          // Delete only gem-sw-v1-* caches from old builds, not Workbox caches.
          // Workbox's cleanupOutdatedCaches() handles its own precache pruning.
          .filter((key) => key.startsWith(SW_VERSION) && key !== NAV_CACHE)
          .map((oldKey) => caches.delete(oldKey))
      )
      await self.clients.claim()
    })
  )
})

self.addEventListener('fetch', (event: FetchEvent) => {
  const request = event.request

  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)

  // Keep API and third-party requests network-first to avoid stale private data.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((cached) =>
          cached ??
          new Response(
            JSON.stringify({ error: 'Offline and no cached API response found.' }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        )
      )
    )
    return
  }

  // Navigation requests: network-first so users always get fresh HTML after deploys.
  // Falls back to offline.html when no cached shell is available.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithOfflineFallback(request, NAV_CACHE))
    return
  }

  // All hashed static assets (JS/CSS/fonts/images) are handled by Workbox's
  // precacheAndRoute above. We do NOT add a second respondWith here — doing so
  // caused InvalidStateError and interfered with Workbox's fallback logic.
})

self.addEventListener('push', (event: PushEvent) => {
  const rawPayload = event.data?.text() ?? '{}'
  let payload: Record<string, unknown>

  try {
    payload = JSON.parse(rawPayload)
  } catch {
    payload = {}
  }

  const title =
    typeof payload.title === 'string' ? payload.title : 'GEM notification'
  const body =
    typeof payload.body === 'string'
      ? payload.body
      : 'You have a new update in GEM.'
  const url = typeof payload.url === 'string' ? payload.url : undefined
  const eventId = typeof payload.eventId === 'string' ? payload.eventId : undefined

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: {
        url: url ?? (eventId ? `/events/${eventId}` : '/'),
      },
    })
  )
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()

  const notificationData = event.notification.data as { url?: string } | undefined
  const targetPath = notificationData?.url ?? '/'
  const targetUrl = new URL(targetPath, self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      if (clients.length > 0) {
        const client = clients[0] as WindowClient
        if ('navigate' in client) await client.navigate(targetUrl)
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
    })
  )
})

async function networkFirstWithOfflineFallback(request: Request, cacheName: string) {
  const cache = await caches.open(cacheName)

  try {
    const response = await fetch(request)
    if (response.ok) {
      await cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached

    const appShell = await cache.match('/')
    if (appShell) return appShell

    // Last resort: serve the dedicated offline page from the Workbox precache.
    const offlineKey = getCacheKeyForURL(OFFLINE_URL)
    const offlinePage = offlineKey
      ? await caches.match(offlineKey)
      : await caches.match(OFFLINE_URL)
    return offlinePage ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
  }
}

export {}
