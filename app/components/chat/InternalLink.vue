<script setup lang="ts">
const props = defineProps<{ href: string }>()
const link = computed(() => parseInternalLink(props.href, location.origin)!)
const { data: channels } = useChannels()
const { nameOf } = useUsers()
const chLabel = useChannelLabel()
const channel = computed(() => channels.value.find(c => c.id === link.value.channelId))
const info = ref<{ userId: string } | 'none' | null>(null)
onMounted(async () => {
  if (!link.value.messageId) return
  info.value = await $fetch<{ userId: string }>(`/api/messages/${link.value.messageId}`).catch(() => 'none' as const)
})
const noAccess = computed(() => info.value === 'none')
const label = computed(() => {
  if (noAccess.value) return 'No access'
  const ch = chLabel(channel.value) || '#channel'
  return info.value && info.value !== 'none' ? `${ch} › message from ${nameOf(info.value.userId)}` : ch
})
const el = ref<HTMLElement>()
onMounted(() => registerCtx(el.value, {
  kind: 'link',
  items: () => [{ label: 'Copy link', icon: 'i-lucide-copy', onSelect: () => copyText(props.href) }],
}))
</script>

<template>
  <span
    v-if="noAccess"
    class="rounded bg-elevated px-1 text-muted"
  >No access</span>
  <NuxtLink
    v-else
    ref="el"
    :to="`/c/${link.channelId}${link.messageId ? `/m/${link.messageId}` : ''}`"
    class="inline-flex items-center gap-1 rounded bg-elevated px-1 text-primary"
  >
    <UIcon
      :name="channel?.type === 'dm' ? 'i-lucide-message-circle' : 'i-lucide-hash'"
      class="size-3"
    />{{ label.replace(/^#/, '') }}
  </NuxtLink>
</template>
