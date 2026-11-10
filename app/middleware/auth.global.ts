const PUBLIC = ['/login', '/signup', '/reset-password']

export default defineNuxtRouteMiddleware(async (to, from) => {
  if (PUBLIC.includes(to.path)) return
  const { data: me, refresh } = await useMe()
  if (import.meta.client && !me.value) await refresh()
  if (!me.value) return navigateTo('/login')
  // Settings is a modal: deep links open it on that tab over the page the user came from.
  const tab = settingsTabFromPath(to.path, me.value.role === 'admin')
  if (tab) {
    useSettingsModal().value = tab
    // On the server a redirect would drop the state: render the (empty) page with the modal open; the client run of this middleware then moves off it.
    if (import.meta.client) return navigateTo(from.path.startsWith('/settings') ? '/' : from.fullPath, { replace: true })
  }
})
