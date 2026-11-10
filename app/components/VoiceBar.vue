<script setup lang="ts">
// One set of voice controls, shown as the sidebar panel (`panel`) or the bottom bar (sidebar hidden / drawer closed). All state lives in useVoice().
import { matchDevice } from '#shared/utils/voice'
defineProps<{ panel?: boolean }>()
const v = useVoice()
const { data: channels } = useChannels()
const name = computed(() => channels.value.find(c => c.id === v.channelId.value)?.name)
const noiseItems = [{ label: 'Off', value: 'off' }, { label: 'Standard (browser)', value: 'standard' }, { label: 'Enhanced (RNNoise)', value: 'enhanced' }]
const deviceItems = (list: MediaDeviceInfo[]) => list.map(d => ({ label: d.label || 'Device', value: d.deviceId }))
const pick = (kind: 'mic' | 'speaker' | 'camera', list: MediaDeviceInfo[]) => (id: string) => { const d = list.find(x => x.deviceId === id); if (d) v.pickDevice(kind, d) }
const current = (saved?: { deviceId: string, label: string }, list: MediaDeviceInfo[] = []) => matchDevice(saved, list).deviceId ?? 'default'
</script>

<template>
  <footer class="flex shrink-0 border-t border-default text-sm" :class="[panel ? 'flex-col gap-1 p-2' : 'h-12 items-center gap-2 px-3', v.channelId.value ? '' : 'text-muted']">
    <div class="flex min-w-0 items-center gap-2">
    <UIcon :name="v.channelId.value ? 'i-lucide-radio' : 'i-lucide-volume-2'" class="size-4" :class="v.channelId.value ? 'text-success' : ''" />
    <NuxtLink v-if="v.channelId.value" :to="`/c/${v.channelId.value}`" class="truncate font-medium hover:underline">{{ name }}</NuxtLink>
    <span v-else class="truncate">{{ v.connecting.value ? 'Connecting…' : 'Not connected to voice' }}</span>
    </div>

    <!-- Panel: two centered rows (mic, deafen, camera / soundboard, share, leave). Bar: one line. -->
    <div class="flex items-center gap-1" :class="panel ? 'flex-col' : 'ml-auto'">
     <div :class="panel ? 'flex items-center justify-center gap-1' : 'contents'">
      <!-- Mic -->
      <UFieldGroup>
        <UTooltip text="Mute / unmute" :kbds="['meta', 'alt', 'shift', 'M']">
          <UButton :icon="v.mute.value.muted ? 'i-lucide-mic-off' : 'i-lucide-mic'" :color="v.mute.value.muted ? 'error' : 'neutral'" :variant="v.mute.value.muted ? 'soft' : 'ghost'"
            :disabled="!v.channelId.value" :aria-label="v.mute.value.muted ? 'Unmute' : 'Mute'" @click="v.toggleMic()" />
        </UTooltip>
        <UPopover :content="{ align: 'end', side: 'top' }">
          <UButton icon="i-lucide-chevron-up" color="neutral" variant="ghost" size="sm" aria-label="Microphone options" />
          <template #content>
            <div class="flex w-72 flex-col gap-3 p-3 text-sm">
              <UFormField label="Input device">
                <USelect :model-value="current(v.settings.value.mic, v.devices.value.mics)" :items="[{ label: 'System default', value: 'default' }, ...deviceItems(v.devices.value.mics)]" class="w-full" @update:model-value="pick('mic', v.devices.value.mics)($event as string)" />
              </UFormField>
              <UFormField label="Noise suppression">
                <template #hint><span class="flex gap-1"><UKbd v-for="k in ['meta', 'alt', 'shift', 'N']" :key="k" :value="k" /></span></template>
                <USelect v-model="v.settings.value.noise" :items="noiseItems" class="w-full" @update:model-value="v.applySettings()" />
              </UFormField>
              <div class="flex items-center justify-between gap-2">
                <USwitch v-model="v.settings.value.echo" label="Echo cancellation" @update:model-value="v.applySettings()" />
                <span class="flex gap-1"><UKbd v-for="k in ['meta', 'alt', 'shift', 'O']" :key="k" :value="k" /></span>
              </div>
              <div class="flex items-center justify-between gap-2">
                <USwitch v-model="v.settings.value.agc" label="Auto gain" @update:model-value="v.applySettings()" />
                <span class="flex gap-1"><UKbd v-for="k in ['meta', 'alt', 'shift', 'G']" :key="k" :value="k" /></span>
              </div>
              <UFormField label="Sensitivity" description="Higher picks up quieter speech.">
                <USlider v-model="v.settings.value.sensitivity" :min="0" :max="100" :step="1" aria-label="Sensitivity" @update:model-value="v.applySettings()" />
              </UFormField>
            </div>
          </template>
        </UPopover>
      </UFieldGroup>

      <!-- Headphones -->
      <UFieldGroup>
        <UTooltip text="Deafen / undeafen" :kbds="['meta', 'alt', 'shift', 'D']">
          <UButton :icon="v.mute.value.deafened ? 'i-lucide-headphone-off' : 'i-lucide-headphones'" :color="v.mute.value.deafened ? 'error' : 'neutral'" :variant="v.mute.value.deafened ? 'soft' : 'ghost'"
            :disabled="!v.channelId.value" :aria-label="v.mute.value.deafened ? 'Undeafen' : 'Deafen'" @click="v.toggleHeadphones()" />
        </UTooltip>
        <UPopover :content="{ align: 'end', side: 'top' }">
          <UButton icon="i-lucide-chevron-up" color="neutral" variant="ghost" size="sm" aria-label="Headphone options" />
          <template #content>
            <div class="flex w-72 flex-col gap-3 p-3 text-sm">
              <UFormField v-if="v.canPickOutput" label="Output device">
                <USelect :model-value="current(v.settings.value.speaker, v.devices.value.speakers)" :items="[{ label: 'System default', value: 'default' }, ...deviceItems(v.devices.value.speakers)]" class="w-full" @update:model-value="pick('speaker', v.devices.value.speakers)($event as string)" />
              </UFormField>
              <UFormField label="Output volume">
                <USlider v-model="v.settings.value.outputVolume" :min="0" :max="1" :step="0.05" aria-label="Output volume" @update:model-value="v.applyOutput()" />
              </UFormField>
            </div>
          </template>
        </UPopover>
      </UFieldGroup>

      <UFieldGroup>
        <UTooltip :text="v.camOn.value ? 'Turn camera off' : 'Turn camera on'" :kbds="['meta', 'alt', 'shift', 'E']">
          <UButton :icon="v.camOn.value ? 'i-lucide-video' : 'i-lucide-video-off'" :color="v.camOn.value ? 'primary' : 'neutral'" :variant="v.camOn.value ? 'soft' : 'ghost'"
            :disabled="!v.channelId.value" :aria-label="v.camOn.value ? 'Turn camera off' : 'Turn camera on'" @click="v.toggleCamera()" />
        </UTooltip>
        <UPopover :content="{ align: 'end', side: 'top' }">
          <UButton icon="i-lucide-chevron-up" color="neutral" variant="ghost" size="sm" aria-label="Camera options" />
          <template #content>
            <div class="w-72 p-3 text-sm">
              <UFormField label="Camera">
                <USelect :model-value="current(v.settings.value.camera, v.devices.value.cams)" :items="[{ label: 'System default', value: 'default' }, ...deviceItems(v.devices.value.cams)]" class="w-full" @update:model-value="pick('camera', v.devices.value.cams)($event as string)" />
              </UFormField>
            </div>
          </template>
        </UPopover>
      </UFieldGroup>
     </div>
     <div :class="panel ? 'flex items-center justify-center gap-1' : 'contents'">
      <SoundboardPopover />
      <UTooltip :text="v.screenOn.value ? 'Stop sharing' : 'Share screen'" :kbds="['meta', 'alt', 'shift', 'S']">
        <UButton :icon="v.screenOn.value ? 'i-lucide-monitor-off' : 'i-lucide-screen-share'" :color="v.screenOn.value ? 'primary' : 'neutral'" :variant="v.screenOn.value ? 'soft' : 'ghost'"
          :disabled="!v.channelId.value" :aria-label="v.screenOn.value ? 'Stop sharing' : 'Share screen'" @click="v.toggleScreen()" />
      </UTooltip>

      <UTooltip text="Leave voice">
        <UButton icon="i-lucide-phone-off" color="error" variant="ghost" :disabled="!v.channelId.value" aria-label="Leave voice" @click="v.leave()" />
      </UTooltip>
     </div>
    </div>
  </footer>
</template>
