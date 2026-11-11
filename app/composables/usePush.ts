const b64ToBytes = (s: string) => Uint8Array.from(atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

/** Web Push for this browser: subscribe from a button, keep the server's copy of the settings current. */
export function usePush() {
  const key = useRuntimeConfig().public.vapidPublicKey as string
  const settings = useNotifySettings()
  const supported = import.meta.client && 'serviceWorker' in navigator && 'PushManager' in window && !!key
  const subscribed = ref(false)
  const prefs = () => ({ dms: settings.value.dms, pings: settings.value.pings, dnd: settings.value.dnd, muted: settings.value.muted })
  const current = async () => (supported ? (await navigator.serviceWorker.ready).pushManager.getSubscription() : null)

  onMounted(async () => {
    subscribed.value = !!(await current())
  })
  // Keep the server's copy of the settings current, so it never pushes what this browser would hide.
  watchDebounced(
    () => JSON.stringify(prefs()),
    async () => {
      if (!subscribed.value) return
      const sub = await current()
      if (sub) $fetch('/api/push', { method: 'PUT', body: { endpoint: sub.endpoint, prefs: prefs() } }).catch(() => {})
    },
    { debounce: 500 },
  )

  return {
    supported,
    subscribed,
    async subscribe() {
      const reg = await navigator.serviceWorker.ready
      const sub =
        (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }))
      await $fetch('/api/push', { method: 'POST', body: { subscription: sub.toJSON(), prefs: prefs() } })
      subscribed.value = true
    },
    async unsubscribe() {
      const sub = await current()
      if (sub) {
        await $fetch('/api/push', { method: 'DELETE', body: { endpoint: sub.endpoint } })
        await sub.unsubscribe()
      }
      subscribed.value = false
    },
  }
}
