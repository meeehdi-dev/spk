<script setup lang="ts">
import { userVolume } from '#shared/utils/voice'

const v = useVoice()
const { nameOf } = useUsers()
const open = computed({
  get: () => !!v.volumeFor.value,
  set: o => {
    if (!o) v.volumeFor.value = null
  },
})
const vol = computed(() => userVolume(v.volumes.value, v.volumeFor.value ?? ''))
</script>

<template>
  <UModal v-model:open="open" :title="`Volume: ${nameOf(v.volumeFor.value ?? '')}`" description="Only changes what you hear.">
    <template #body>
      <div v-if="v.volumeFor.value" class="flex flex-col gap-4">
        <UFormField label="Mic volume">
          <USlider
            :model-value="vol.mic"
            :min="0"
            :max="1"
            :step="0.05"
            aria-label="Mic volume"
            @update:model-value="v.setVolume(v.volumeFor.value!, { mic: $event as number })"
          />
        </UFormField>
        <UFormField label="Screen share volume">
          <USlider
            :model-value="vol.screen"
            :min="0"
            :max="1"
            :step="0.05"
            aria-label="Screen share volume"
            @update:model-value="v.setVolume(v.volumeFor.value!, { screen: $event as number })"
          />
        </UFormField>
        <USwitch :model-value="vol.muted" label="Mute for me" @update:model-value="v.setVolume(v.volumeFor.value!, { muted: $event })" />
      </div>
    </template>
  </UModal>
</template>
