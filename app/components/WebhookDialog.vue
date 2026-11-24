<script setup lang="ts">
import type { ChannelEntry } from '~/composables/useUsers'

const admin = useAdmin()
const d = admin.webhookDialog
const open = computed({
  get: () => !!d.value,
  set: o => {
    if (!o) d.value = null
  },
})
const name = ref('')
const icon = ref('webhook')
const isPrivate = ref(true)
const busy = ref(false)
const url = ref('') // shown once, after create or a new secret
const { copy, copied } = useClipboard({ copiedDuring: 1500 })
const mode = computed(() => d.value?.mode)
const channel = computed(() => (d.value && 'channel' in d.value ? d.value.channel : undefined))

watch(d, v => {
  url.value = ''
  const c = v && 'channel' in v ? v.channel : undefined
  name.value = c?.name ?? ''
  icon.value = c?.icon ?? 'webhook'
  isPrivate.value = c?.private ?? true
})

const regenerate = () =>
  run(async () => {
    if (d.value?.mode === 'secret') url.value = (await $fetch<{ url: string }>(`/api/webhooks/${d.value.channel.id}/secret`, { method: 'POST' })).url
  }, true)

async function run(fn: () => Promise<unknown>, keepOpen = false) {
  busy.value = true
  try {
    await fn()
    if (!keepOpen) d.value = null
  } catch (e) {
    admin.fail('Failed')(e)
  } finally {
    busy.value = false
  }
}

const submit = () =>
  run(async () => {
    const body = { name: name.value, icon: icon.value, private: isPrivate.value }
    if (d.value?.mode === 'create') {
      const r = await $fetch<{ channel: ChannelEntry; url: string }>('/api/webhooks', { method: 'POST', body })
      url.value = r.url
      await refreshNuxtData('channels')
      await navigateTo(`/c/${r.channel.id}`)
    } else if (d.value?.mode === 'edit') {
      await $fetch(`/api/webhooks/${d.value.channel.id}`, { method: 'PATCH', body })
      await refreshNuxtData('channels')
    } else if (d.value?.mode === 'delete') {
      await $fetch(`/api/webhooks/${d.value.channel.id}`, { method: 'DELETE' })
      await refreshNuxtData('channels')
    }
  }, d.value?.mode === 'create')

const title = computed(() => ({ create: 'New webhook', edit: 'Edit webhook', secret: 'New secret URL', delete: 'Delete webhook' })[mode.value ?? 'create'])
</script>

<template>
  <UModal v-model:open="open" :title="title" description="Webhook feed">
    <template #body>
      <div v-if="url" class="flex flex-col gap-3">
        <UFormField label="Webhook URL" help="Shown only once. Copy it now; creating a new secret URL stops this one working.">
          <UInput
            :model-value="url"
            readonly
            class="w-full"
            :ui="{ trailing: 'pe-1' }"
            aria-label="Webhook URL"
            @focus="($event.target as HTMLInputElement).select()"
          >
            <template #trailing>
              <UButton :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" color="neutral" variant="link" size="sm" aria-label="Copy URL" @click="copy(url)" />
            </template>
          </UInput>
        </UFormField>
        <div class="flex justify-end"><UButton label="Done" @click="open = false" /></div>
      </div>

      <div v-else-if="mode === 'delete'" class="flex flex-col gap-3">
        <p class="text-sm">
          Delete <b><EmojiText :text="channel?.name ?? ''" /></b>? Its alerts are removed for everyone and its URL stops working. This can't be undone.
        </p>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
          <UButton label="Delete" icon="i-lucide-trash-2" color="error" :loading="busy" @click="submit" />
        </div>
      </div>

      <div v-else-if="mode === 'secret'" class="flex flex-col gap-3">
        <p class="text-sm">
          Generate a new URL for <b><EmojiText :text="channel?.name ?? ''" /></b>? The old URL stops working right away.
        </p>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
          <UButton label="Generate new URL" icon="i-lucide-refresh-cw" :loading="busy" @click="regenerate" />
        </div>
      </div>

      <form v-else class="flex flex-col gap-3" @submit.prevent="submit">
        <UFormField label="Name">
          <UInput v-model="name" maxlength="32" autofocus class="w-full" />
        </UFormField>
        <UFormField label="Icon">
          <IconSelect v-model="icon" class="w-full" aria-label="Icon" />
        </UFormField>
        <USwitch v-model="isPrivate" label="Private" description="Only you see this feed. Turn off to share it with everyone." />
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
          <UButton type="submit" :label="mode === 'create' ? 'Create' : 'Save'" icon="i-lucide-check" :loading="busy" :disabled="!name.trim()" />
        </div>
      </form>
    </template>
  </UModal>
</template>
