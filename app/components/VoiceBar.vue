<script setup lang="ts">
// The voice controls as a bottom bar, shown while the sidebar is hidden or the drawer is closed. All state lives in useVoice().
const v = useVoice()
const { data: channels } = useChannels()
const name = computed(() => channels.value.find(c => c.id === v.channelId.value)?.name)
</script>

<template>
  <footer
    class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-default px-3 py-1.5 text-sm sm:h-12 sm:py-0"
    :class="v.channelId.value ? '' : 'text-muted'"
  >
    <!-- Phones: name and status on top, the controls spread across their own row. -->
    <div class="flex min-w-0 items-center gap-2 max-sm:w-full">
      <UIcon name="i-lucide-volume-2" class="size-4" :class="{ ok: 'text-success', unstable: 'text-warning', lost: 'text-error' }[v.health.value]" />
      <NuxtLink v-if="v.channelId.value" :to="`/c/${v.channelId.value}`" class="truncate font-medium hover:underline"
        ><EmojiText :text="name ?? ''"
      /></NuxtLink>
      <span class="truncate text-xs text-muted">{{ v.connectionLabel.value }}</span>
    </div>
    <div class="flex items-center gap-1 max-sm:w-full max-sm:justify-between sm:ml-auto">
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
