<script setup lang="ts">
defineProps<{ labeled?: boolean }>()
const v = useVoice()
const { data: sounds, refresh } = useSounds()
const { cooling, press } = useSoundboard()
const sb = computed(() => v.settings.value.soundboard)
const q = ref('')
const shown = computed(() => sounds.value.filter(s => s.name.toLowerCase().includes(q.value.trim().toLowerCase())))
</script>

<template>
  <UPopover :content="{ align: 'end', side: 'top' }" @update:open="$event && refresh()">
    <UTooltip text="Soundboard">
      <UButton
        icon="i-lucide-megaphone"
        color="neutral"
        variant="ghost"
        :disabled="!v.channelId.value"
        aria-label="Soundboard"
        :label="labeled ? 'Soundboard' : undefined"
      />
    </UTooltip>
    <template #content>
      <div class="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 p-3 text-sm">
        <UInput v-model="q" icon="i-lucide-search" placeholder="Search sounds" aria-label="Search sounds" />
        <div role="region" aria-label="Sounds" class="h-60 overflow-y-auto">
          <p v-if="!sounds.length" class="text-muted">No sounds yet. An admin can add some in Settings → Soundboard.</p>
          <p v-else-if="!shown.length" class="text-muted">No match.</p>
          <div class="grid grid-cols-3 gap-2">
            <UContextMenu
              v-for="s in shown"
              :key="s.id"
              :items="[{ label: 'Preview (only you)', icon: 'i-lucide-headphones', onSelect: () => playSound(s.id, true) }]"
            >
              <UButton
                color="neutral"
                variant="soft"
                class="h-16 flex-col justify-center gap-1"
                :disabled="!sb.on || cooling"
                :aria-label="`Play ${s.name}`"
                @click="press(s.id)"
              >
                <UIcon :name="`i-lucide-${s.icon}`" class="size-5" />
                <span class="w-full truncate text-xs"><EmojiText :text="s.name" /></span>
              </UButton>
            </UContextMenu>
          </div>
        </div>
        <USeparator />
        <USwitch v-model="sb.on" label="Hear soundboard sounds" />
        <USlider v-model="sb.volume" :min="0" :max="2" :step="0.01" :disabled="!sb.on" aria-label="Soundboard volume" />
      </div>
    </template>
  </UPopover>
</template>
