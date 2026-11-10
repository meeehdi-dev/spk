// Registers the service worker (needed for install and push) and follows its "open this message" clicks.
export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch(() => {})
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate') navigateTo(e.data.url)
  })
})
