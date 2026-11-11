export default defineNuxtPlugin((nuxtApp) => {
  const toast = useToast()
  nuxtApp.hook('app:chunkError', () => {
    toast.add({
      id: 'chunk-error',
      title: 'Could not load this page',
      description: 'Refresh manually to try again. Unsent GIFs, attachments and replies will be lost; draft text is saved.',
      color: 'error'
    })
  })
})
