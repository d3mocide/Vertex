import { clientsClaim } from 'workbox-core'
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

declare let self: ServiceWorkerGlobalScope

clientsClaim()
self.skipWaiting()

// Precache all build assets (injected by vite-plugin-pwa at build time)
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Cache map tiles — CacheFirst with 7-day expiry
registerRoute(
  ({ url }) => url.pathname.startsWith('/tiles') || url.hostname.includes('tile'),
  new CacheFirst({
    cacheName: 'map-tiles',
    plugins: [new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 7 * 24 * 60 * 60 })],
  })
)

// API responses — NetworkFirst (fresh data when online, cached when offline)
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-responses',
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 })],
  })
)

// Static assets — StaleWhileRevalidate
registerRoute(
  ({ request }) => request.destination === 'style' || request.destination === 'script' || request.destination === 'font',
  new StaleWhileRevalidate({ cacheName: 'static-assets' })
)

// Notification click — focus or open app window
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) return client.focus()
        }
        return self.clients.openWindow('/')
      })
  )
})
