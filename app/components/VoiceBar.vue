<script setup lang="ts">
// The voice controls as a bottom bar, shown while the sidebar is hidden or the drawer is closed. All state lives in useVoice().
const v = useVoice()
const { data: channels } = useChannels()
const name = computed(() => channels.value.find(c => c.id === v.channelId.value)?.name)
</script>

<template>
  <footer class="flex h-12 shrink-0 items-center gap-2 border-t border-default px-3 text-sm" :class="v.channelId.value ? '' : 'text-muted'">
    <div class="flex min-w-0 items-center gap-2">
      <UIcon name="i-lucide-volume-2" class="size-4" :class="{ ok: 'text-success', unstable: 'text-warning', lost: 'text-error' }[v.health.value]" />
      <NuxtLink v-if="v.channelId.value" :to="`/c/${v.channelId.value}`" class="truncate font-medium hover:underline"
        ><EmojiText :text="name ?? ''"
      /></NuxtLink>
      <span class="truncate text-xs text-muted">{{ v.connectionLabel.value }}</span>
    </div>
    <div class="ml-auto flex items-center gap-1">
      <VoiceControl kind="mic" />
      <VoiceControl kind="deafen" />
      <VoiceControl kind="camera" />
      <RadioPopover />
      <SoundboardPopover />
      <VoiceControl kind="screen" />
      <VoiceControl kind="leave" />
    </div>
  </footer>
</template>
