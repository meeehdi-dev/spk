<script setup lang="ts">
import { SCREEN_PRESETS, userVolume, type ScreenPreset } from '#shared/utils/voice'
const v = useVoice()
const { nameOf } = useUsers()
const preset = ref<ScreenPreset>('clarity')
const audio = ref(true)
watch(v.screenDialog, (o) => { if (o) { preset.value = v.settings.value.screenPreset; audio.value = v.settings.value.screenAudio } })
const items = (Object.keys(SCREEN_PRESETS) as ScreenPreset[]).map(k => ({ value: k, label: SCREEN_PRESETS[k].label, description: SCREEN_PRESETS[k].hint }))
const start = () => { v.screenDialog.value = false; void v.startScreen(preset.value, audio.value) }
const open = computed({ get: () => !!v.volumeFor.value, set: (o) => { if (!o) v.volumeFor.value = null } })
const vol = computed(() => userVolume(v.volumes.value, v.volumeFor.value ?? ''))
</script>

<template>
  <UModal v-model:open="v.screenDialog.value" title="Share your screen" description="Pick a preset, then choose what to share in the browser's picker.">
    <template #body>
      <div class="flex flex-col gap-4">
        <URadioGroup v-model="preset" :items="items" />
        <USwitch v-model="audio" label="Share audio" description="Captured as it is: no noise suppression, echo cancellation or gain." />
      </div>
    </template>
    <template #footer>
      <UButton label="Cancel" color="neutral" variant="ghost" @click="v.screenDialog.value = false" />
      <UButton label="Choose what to share" icon="i-lucide-screen-share" @click="start" />
    </template>
  </UModal>

  <UModal v-model:open="open" :title="`Volume: ${nameOf(v.volumeFor.value ?? '')}`" description="Only changes what you hear.">
    <template #body>
      <div v-if="v.volumeFor.value" class="flex flex-col gap-4">
        <UFormField label="Mic volume"><USlider :model-value="vol.mic" :min="0" :max="1" :step="0.05" aria-label="Mic volume" @update:model-value="v.setVolume(v.volumeFor.value!, { mic: $event as number })" /></UFormField>
        <UFormField label="Screen share volume"><USlider :model-value="vol.screen" :min="0" :max="1" :step="0.05" aria-label="Screen share volume" @update:model-value="v.setVolume(v.volumeFor.value!, { screen: $event as number })" /></UFormField>
        <USwitch :model-value="vol.muted" label="Mute for me" @update:model-value="v.setVolume(v.volumeFor.value!, { muted: $event })" />
      </div>
    </template>
  </UModal>
</template>
