/// <reference lib="webworker" />

import { precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>
}

const SW_VERSION = 'gem-sw-v1'
const STATIC_CACHE = `${SW_VERSION}-static`
const NAV_CACHE = `${SW_VERSION}-nav`

const STATIC_DESTINATIONS = new Set([
  'style',
  'script',
  'font',
  'image',
  'manifest',
])

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(['/']))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter((key) => !key.startsWith(SW_VERSION))
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

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, NAV_CACHE))
    return
  }

  if (STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
  }
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
    typeof payload.title === 'string' ? payload.title : 'Gem notification'
  const body =
    typeof payload.body === 'string'
      ? payload.body
      : 'You have a new update in Gem.'
  const eventId = typeof payload.eventId === 'string' ? payload.eventId : undefined

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: {
        url: eventId ? `/events/${eventId}` : '/',
      },
    })
  )
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()

  const notificationData = event.notification.data as { url?: string } | undefined
  const targetUrl = notificationData?.url ?? '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client && new URL(client.url).pathname === targetUrl) {
          return client.focus()
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }

      return undefined
    })
  )
})

async function cacheFirst(request: Request, cacheName: string) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  if (cached) {
    return cached
  }

  const response = await fetch(request)
  if (response.ok) {
    await cache.put(request, response.clone())
  }
  return response
}

async function networkFirst(request: Request, cacheName: string) {
  const cache = await caches.open(cacheName)

  try {
    const response = await fetch(request)
    if (response.ok) {
      await cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) {
      return cached
    }
    const appShell = await cache.match('/')
    return appShell ?? new Response('Offline', { status: 503 })
  }
}

export {}
