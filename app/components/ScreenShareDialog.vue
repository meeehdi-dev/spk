<script setup lang="ts">
import { SCREEN_FPS, SCREEN_HEIGHTS, type ScreenQuality } from '#shared/utils/voice'

// One modal for starting a share and for changing it live. Draft values are applied by the footer button only.
const v = useVoice()
const sharing = computed(() => v.screenOn.value || v.screenBusy.value)
const audio = ref(true)
const quality = ref<ScreenQuality>({ ...v.settings.value.screenQuality })
watch(v.screenDialog, open => {
  if (!open) return
  audio.value = v.settings.value.screenAudio
  quality.value = { ...v.settings.value.screenQuality }
})

/** Runs straight from the click: startScreen must open the browser picker without an await before it. */
function submit() {
  v.screenDialog.value = false
  if (!sharing.value) {
    v.settings.value.screenAudio = audio.value
    v.settings.value.screenQuality = { ...quality.value }
    void v.startScreen()
    return
  }
  const { screenAudio, screenQuality } = v.settings.value
  void (async () => {
    // Audio first: enabling it can reopen the picker, which needs the click's user activation.
    if (audio.value !== screenAudio) await v.setScreenAudio(audio.value)
    if (quality.value.height !== screenQuality.height || quality.value.fps !== screenQuality.fps) await v.setScreenQuality({ ...quality.value })
  })()
}
</script>

<template>
  <UModal v-model:open="v.screenDialog.value" title="Share your screen" description="Choose what to send. Your browser then asks which screen or window.">
    <template #body>
      <div class="flex flex-col gap-4">
        <USwitch v-model="audio" label="Share audio" />
        <UFormField label="Max resolution">
          <UFieldGroup>
            <UButton
              v-for="h in SCREEN_HEIGHTS"
              :key="h"
              :label="`${h}p`"
              color="neutral"
              :variant="quality.height === h ? 'solid' : 'outline'"
              :aria-pressed="quality.height === h"
              @click="quality.height = h"
            />
          </UFieldGroup>
        </UFormField>
        <UFormField label="Frame rate">
          <UFieldGroup>
            <UButton
              v-for="f in SCREEN_FPS"
              :key="f"
              :label="`${f} fps`"
              color="neutral"
              :variant="quality.fps === f ? 'solid' : 'outline'"
              :aria-pressed="quality.fps === f"
              @click="quality.fps = f"
            />
          </UFieldGroup>
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="v.screenDialog.value = false" />
        <UButton :label="sharing ? 'Apply' : 'Share'" :disabled="v.screenBusy.value" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
