<script setup lang="ts">
// One voice control: the main button plus, where it has options, a narrow chevron of the same height. Used by the sidebar card and user row, and the bottom bar. All state lives in useVoice().
import { matchDevice, SCREEN_FPS, SCREEN_HEIGHTS } from '#shared/utils/voice'

const props = defineProps<{ kind: 'mic' | 'deafen' | 'camera' | 'screen' | 'leave'; labeled?: boolean }>()
const v = useVoice()
const noiseItems = [
  { label: 'Off', value: 'off' },
  { label: 'Standard (browser)', value: 'standard' },
  { label: 'Enhanced (DeepFilterNet)', value: 'enhanced' },
]
const deviceItems = (list: MediaDeviceInfo[]) => list.map(d => ({ label: d.label || 'Device', value: d.deviceId }))
const pick = (kind: 'mic' | 'speaker' | 'mediaSpeaker' | 'camera', list: MediaDeviceInfo[]) => (id: string) => {
  if (id === 'default') return v.pickDevice(kind, { deviceId: 'default', label: 'System default' })
  const d = list.find(x => x.deviceId === id)
  if (d) void v.pickDevice(kind, d)
}
const current = (saved?: { deviceId: string; label: string }, list: MediaDeviceInfo[] = []) => matchDevice(saved, list).deviceId ?? 'default'
const c = computed(() => {
  const { muted, deafened } = v.mute.value
  const sharing = v.screenOn.value || v.screenBusy.value
  const none = !v.channelId.value
  switch (props.kind) {
    case 'mic': {
      const unavailable = !none && v.microphone.value === 'unavailable'
      return {
        icon: muted || unavailable ? 'i-lucide-mic-off' : 'i-lucide-mic',
        on: muted || unavailable,
        color: 'error' as const,
        text: unavailable ? 'Enable microphone' : muted ? 'Unmute' : 'Mute',
        tip: unavailable ? 'Enable microphone' : 'Mute / unmute',
        kbd: 'M',
        options: 'Microphone options',
        disabled: false,
        click: () => (unavailable ? v.enableMicrophone() : v.toggleMic()),
      }
    }
    case 'deafen':
      return {
        icon: deafened ? 'i-lucide-headphone-off' : 'i-lucide-headphones',
        on: deafened,
        color: 'error' as const,
        text: deafened ? 'Undeafen' : 'Deafen',
        tip: 'Deafen / undeafen',
        kbd: 'D',
        options: 'Headphone options',
        disabled: false,
        click: () => v.toggleHeadphones(),
      }
    case 'camera': {
      const text = v.camOn.value ? 'Turn camera off' : 'Turn camera on'
      return {
        icon: v.camOn.value ? 'i-lucide-video' : 'i-lucide-video-off',
        on: v.camOn.value,
        color: 'primary' as const,
        text,
        tip: text,
        kbd: 'E',
        options: 'Camera options',
        disabled: none,
        click: () => v.toggleCamera(),
      }
    }
    case 'screen': {
      const text = sharing ? 'Stop sharing' : 'Share screen'
      return {
        icon: v.screenOn.value ? 'i-lucide-monitor-off' : 'i-lucide-screen-share',
        on: v.screenOn.value,
        color: 'primary' as const,
        text,
        tip: text,
        kbd: 'S',
        options: 'Screen share options',
        disabled: none,
        click: () => v.toggleScreen(),
      }
    }
    default:
      return {
        icon: 'i-lucide-phone-off',
        on: false,
        color: 'error' as const,
        text: 'Leave voice',
        tip: 'Leave voice',
        kbd: '',
        options: '',
        disabled: none,
        click: () => v.leave(),
      }
  }
})
const buttonStyle = computed(
  () =>
    ({
      color: props.kind === 'leave' ? 'error' : c.value.on ? c.value.color : 'neutral',
      variant: c.value.on ? 'soft' : 'ghost',
    }) as const,
)
const chevron = computed(() => ({ ...buttonStyle.value, icon: 'i-lucide-chevron-up', class: 'w-5 px-0' }))
</script>

<template>
  <UFieldGroup>
    <UTooltip :text="c.tip" :kbds="c.kbd ? ['meta', 'alt', 'shift', c.kbd] : undefined">
      <UButton :icon="c.icon" v-bind="buttonStyle" :disabled="c.disabled" :aria-label="c.text" :label="labeled ? c.text : undefined" @click="c.click()" />
    </UTooltip>

    <UPopover v-if="kind === 'mic'" :content="{ align: 'end', side: 'top' }">
      <UButton v-bind="chevron" :aria-label="c.options" />
      <template #content>
        <div class="flex w-72 flex-col gap-3 p-3 text-sm">
          <UFormField label="Input device">
            <USelect
              :model-value="current(v.settings.value.mic, v.devices.value.mics)"
              :items="[{ label: 'System default', value: 'default' }, ...deviceItems(v.devices.value.mics.filter(d => d.deviceId !== 'default'))]"
              class="w-full"
              @update:model-value="pick('mic', v.devices.value.mics)($event as string)"
            />
          </UFormField>
          <UFormField label="Noise suppression">
            <template #hint>
              <span class="flex gap-1"><UKbd v-for="k in ['meta', 'alt', 'shift', 'N']" :key="k" :value="k" /></span>
            </template>
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

    <UPopover v-else-if="kind === 'deafen'" :content="{ align: 'end', side: 'top' }">
      <UButton v-bind="chevron" :aria-label="c.options" />
      <template #content>
        <div class="flex w-72 flex-col gap-3 p-3 text-sm">
          <UFormField
            v-for="output in v.canPickOutput
              ? ([
                  { kind: 'speaker', label: 'Voice output' },
                  { kind: 'mediaSpeaker', label: 'Media output' },
                ] as const)
              : []"
            :key="output.kind"
            :label="output.label"
          >
            <USelect
              :model-value="current(v.settings.value[output.kind], v.devices.value.speakers)"
              :items="[{ label: 'System default', value: 'default' }, ...deviceItems(v.devices.value.speakers.filter(d => d.deviceId !== 'default'))]"
              class="w-full"
              @update:model-value="pick(output.kind, v.devices.value.speakers)($event as string)"
            />
          </UFormField>
          <UFormField label="Output volume">
            <USlider v-model="v.settings.value.outputVolume" :min="0" :max="1" :step="0.01" aria-label="Output volume" @update:model-value="v.applyOutput()" />
          </UFormField>
        </div>
      </template>
    </UPopover>

    <UPopover v-else-if="kind === 'camera'" :content="{ align: 'end', side: 'top' }">
      <UButton v-bind="chevron" :aria-label="c.options" />
      <template #content>
        <div class="flex w-72 flex-col gap-3 p-3 text-sm">
          <UFormField label="Camera">
            <USelect
              :model-value="current(v.settings.value.camera, v.devices.value.cams)"
              :items="[{ label: 'System default', value: 'default' }, ...deviceItems(v.devices.value.cams.filter(d => d.deviceId !== 'default'))]"
              class="w-full"
              @update:model-value="pick('camera', v.devices.value.cams)($event as string)"
            />
          </UFormField>
          <VoiceCameraResolution />
        </div>
      </template>
    </UPopover>

    <UPopover v-else-if="kind === 'screen'" :content="{ align: 'end', side: 'top' }">
      <UButton v-bind="chevron" :disabled="c.disabled" :aria-label="c.options" />
      <template #content>
        <div class="flex w-72 flex-col gap-3 p-3 text-sm">
          <USwitch
            :model-value="v.settings.value.screenAudio"
            label="Share audio"
            :disabled="v.screenBusy.value"
            @update:model-value="v.setScreenAudio($event)"
          />
          <UFormField label="Max resolution">
            <USelect
              :model-value="v.settings.value.screenQuality.height"
              :items="SCREEN_HEIGHTS.map(height => ({ label: `${height}p`, value: height }))"
              :disabled="v.screenBusy.value"
              class="w-full"
              @update:model-value="v.setScreenQuality({ ...v.settings.value.screenQuality, height: $event })"
            />
          </UFormField>
          <UFormField label="Frame rate">
            <USelect
              :model-value="v.settings.value.screenQuality.fps"
              :items="SCREEN_FPS.map(fps => ({ label: `${fps} fps`, value: fps }))"
              :disabled="v.screenBusy.value"
              class="w-full"
              @update:model-value="v.setScreenQuality({ ...v.settings.value.screenQuality, fps: $event })"
            />
          </UFormField>
        </div>
      </template>
    </UPopover>
  </UFieldGroup>
</template>
