<script setup lang="ts">
import { CAMERA_RESOLUTIONS } from '#shared/utils/voice'

const v = useVoice()
const items = CAMERA_RESOLUTIONS.map(value => ({ label: value === 'auto' ? 'Auto' : value, value }))
</script>

<template>
  <UFormField label="Webcam resolution" description="Auto adapts to your connection. Other options set a maximum; your camera may use a lower resolution.">
    <USelect :model-value="v.settings.value.cameraResolution" :items="items" class="w-full" @update:model-value="v.setCameraResolution($event)" />
  </UFormField>
</template>
