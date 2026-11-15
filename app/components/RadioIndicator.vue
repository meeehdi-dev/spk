<script setup lang="ts">
import type { RadioSummary } from '#shared/utils/radio'

const props = defineProps<{ channelId: string; station: RadioSummary['station'] | undefined }>()
const voice = useVoice()
const radio = useRadio()
const current = computed(() => voice.channelId.value === props.channelId && !!radio.station.value)
const needsListen = computed(() => !radio.enabled.value || radio.playback.value === 'blocked' || radio.playback.value === 'error')
const label = computed(() => `${current.value ? (needsListen.value ? 'Resume radio' : 'Pause radio') : 'Radio selected'}: ${props.station?.name ?? ''}`)
const toggle = () => {
  if (needsListen.value) radio.listen()
  else radio.mute()
}
</script>

<template>
  <UTooltip v-if="station" :text="label">
    <template #content="{ ui }"><EmojiText :text="label" :class="ui.text()" /></template>
    <UButton
      v-if="current"
      icon="i-lucide-radio"
      :color="needsListen ? 'neutral' : 'primary'"
      variant="ghost"
      :aria-label="label"
      :aria-pressed="!needsListen"
      @click="toggle"
    />
    <UButton v-else as="span" icon="i-lucide-radio" color="primary" variant="ghost" :aria-label="label" />
  </UTooltip>
</template>
