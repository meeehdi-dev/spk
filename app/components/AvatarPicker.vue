<script setup lang="ts">
const { data: me, refresh } = useMe()
const toast = useToast()
const busy = ref(false)
const input = ref<HTMLInputElement>()

async function pick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  busy.value = true
  try {
    const { key, url } = await $fetch<{ key: string, url: string }>('/api/profile/avatar-upload', { method: 'POST', body: { size: file.size, type: file.type } })
    const put = await fetch(url, { method: 'PUT', body: file, headers: { 'content-type': file.type } })
    if (!put.ok) throw new Error('Upload failed')
    await $fetch('/api/profile/avatar', { method: 'POST', body: { key } })
    await refresh()
  } catch (err) {
    toast.add({ title: 'Avatar upload failed', description: (err as { statusMessage?: string }).statusMessage || (err as Error).message, color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    busy.value = false
    if (input.value) input.value.value = ''
  }
}
</script>

<template>
  <div class="flex items-center gap-3">
    <UAvatar :src="me?.avatarKey ? `/api/avatar/${me.id}?v=${me.avatarKey}` : undefined" icon="i-lucide-user" size="xl" />
    <input ref="input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden" @change="pick">
    <UButton label="Choose avatar" icon="i-lucide-image-up" color="neutral" variant="outline" :loading="busy" @click="input?.click()" />
  </div>
</template>
