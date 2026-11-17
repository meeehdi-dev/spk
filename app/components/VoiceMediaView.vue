<script setup lang="ts">
import type { VoiceVideoTrack } from '~/utils/voice-types'

const props = defineProps<{ track?: VoiceVideoTrack }>()
const element = ref<HTMLVideoElement>()

watchEffect(onCleanup => {
  const track = props.track
  const video = element.value
  if (!track || !video) return
  track.attach(video)
  onCleanup(() => track.detach(video))
})
</script>

<template>
  <video v-show="track" ref="element" autoplay playsinline muted />
</template>
