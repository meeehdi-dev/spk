// Push and notification click only. No offline cache.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

self.addEventListener('push', ev => {
  let d
  try {
    d = ev.data.json()
  } catch {
    return
  }
  ev.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (windows.some(c => c.focused)) return // the user is looking at the app
      await self.registration.showNotification(d.title, {
        body: d.body,
        tag: d.tag,
        data: { url: d.url },
        icon: '/pwa-192x192.png',
        badge: '/badge.png',
      })
    })(),
  )
})

self.addEventListener('notificationclick', ev => {
  ev.notification.close()
  const url = ev.notification.data?.url || '/'
  ev.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const c = windows[0]
      if (c) {
        await c.focus()
        c.postMessage({ type: 'navigate', url })
      } else await self.clients.openWindow(url)
    })(),
  )
})
