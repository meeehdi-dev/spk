const b64ToBytes = (s: string) => Uint8Array.from(atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

const pushPrefs = () => {
  const s = useNotifySettings().value
  return { dms: s.dms, pings: s.pings, dnd: useMyStatus().value === 'busy', muted: s.muted }
}
const currentSubscription = async () =>
  import.meta.client && 'serviceWorker' in navigator && 'PushManager' in window ? (await navigator.serviceWorker.ready).pushManager.getSubscription() : null

/** Layout only: keeps the server's copy of the settings (incl. Busy) current, so it never pushes what this browser would hide. */
export function usePushSync() {
  watchDebounced(
    () => JSON.stringify(pushPrefs()),
    async () => {
      const sub = await currentSubscription()
      if (sub) await $fetch('/api/push', { method: 'PUT', body: { endpoint: sub.endpoint, prefs: pushPrefs() } }).catch(() => {})
    },
    { debounce: 500 },
  )
}

/** Web Push for this browser: subscribe from a button, keep the server's copy of the settings current. */
export function usePush() {
  const key = useRuntimeConfig().public.vapidPublicKey as string
  const supported = import.meta.client && 'serviceWorker' in navigator && 'PushManager' in window && !!key
  const subscribed = ref(false)
  const prefs = pushPrefs
  const current = currentSubscription

  onMounted(async () => {
    subscribed.value = !!(await current())
  })
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
