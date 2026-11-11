import { createAuthClient } from 'better-auth/vue'

export const authClient = createAuthClient()

/** Sign out everywhere on this browser: drop its push subscription, end the session, then a full load so the socket and its reconnects die. */
export async function signOut() {
  useSettingsModal().value = null
  try {
    const sub = await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription()
    if (sub) {
      await $fetch('/api/push', { method: 'DELETE', body: { endpoint: sub.endpoint } })
      await sub.unsubscribe()
    }
  } catch {
    /* best effort: never block sign-out */
  }
  await authClient.signOut()
  window.location.assign('/login')
}
