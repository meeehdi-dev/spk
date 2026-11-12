// Push workers can stay identical across deployments; Nuxt's build manifest detects app updates.
export default defineNuxtPlugin(nuxtApp => {
  if (import.meta.env.DEV) return
  const toast = useToast()
  const notifiedBuilds = new Set<string>()
  nuxtApp.hook('app:manifest:update', meta => {
    if (!meta || notifiedBuilds.has(meta.id)) return
    notifiedBuilds.add(meta.id)
    toast.add({
      id: 'app-update',
      title: 'Update available',
      description: 'Refreshing disconnects voice and loses unsent GIFs, attachments and replies. Draft text is saved.',
      duration: 0,
      actions: [{ label: 'Refresh', onClick: () => window.location.reload() }],
    })
  })

  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch(() => {})
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'navigate') void navigateTo(e.data.url)
  })
})
