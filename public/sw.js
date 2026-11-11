// Push and notification click only. No offline cache.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let d
  try {
    d = event.data.json()
  } catch {
    return
  }
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (open.some(c => c.focused)) return // the user is looking at the app
      await self.registration.showNotification(d.title, {
        body: d.body,
        tag: d.tag,
        data: { url: d.url },
        icon: '/icons/icon-192.png',
        badge: '/icons/badge.png',
      })
    })(),
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const c = open[0]
      if (c) {
        await c.focus()
        c.postMessage({ type: 'navigate', url })
      } else await self.clients.openWindow(url)
    })(),
  )
})
