<script setup lang="ts">
import { matchDevice } from '#shared/utils/voice'

const v = useVoice()
const s = v.settings
const noiseItems = [
  { label: 'Off', value: 'off' },
  { label: 'Standard (browser)', value: 'standard' },
  { label: 'Enhanced (RNNoise)', value: 'enhanced' },
]
const items = (list: MediaDeviceInfo[]) => [
  { label: 'System default', value: 'default' },
  ...list.map(d => ({ label: d.label || 'Device', value: d.deviceId })),
]
const current = (saved: { deviceId: string; label: string } | undefined, list: MediaDeviceInfo[]) => matchDevice(saved, list).deviceId ?? 'default'
const pick = (kind: 'mic' | 'speaker' | 'camera', list: MediaDeviceInfo[]) => (id: string) => {
  const d = list.find(x => x.deviceId === id)
  if (d) void v.pickDevice(kind, d)
  else s.value = { ...s.value, [kind]: undefined }
}
// Labels are blank until the browser grants a device permission; this button asks once.
const labelsHidden = computed(() => [...v.devices.value.mics, ...v.devices.value.speakers].some(d => !d.label))
async function allow() {
  try {
    ;(await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop())
  } catch {
    useToast().add({ title: 'Microphone access was denied', color: 'error', icon: 'i-lucide-mic-off' })
  }
  await v.refreshDevices()
}
onMounted(v.refreshDevices)

// Level meter on the chosen mic (only while this page is open and you are not in a call).
const level = ref(0)
let stopMeter: (() => void) | undefined
async function meter(on: boolean) {
  stopMeter?.()
  stopMeter = undefined
  level.value = 0
  if (!on) return
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: matchDevice(s.value.mic, v.devices.value.mics).deviceId } })
    const ctx = new AudioContext(),
      an = ctx.createAnalyser(),
      buf = new Float32Array(1024)
    an.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(an)
    let raf = 0
    const tick = () => {
      an.getFloatTimeDomainData(buf)
      level.value = Math.min(1, Math.sqrt(buf.reduce((a, x) => a + x * x, 0) / buf.length) * 4)
      raf = requestAnimationFrame(tick)
    }
    tick()
    stopMeter = () => {
      cancelAnimationFrame(raf)
      stream.getTracks().forEach(t => t.stop())
      void ctx.close()
    }
  } catch {
    useToast().add({ title: 'Could not open the microphone', color: 'error', icon: 'i-lucide-mic-off' })
    testing.value = false
  }
}
const testing = ref(false)
watch(testing, meter)
onBeforeUnmount(() => stopMeter?.())

// Camera preview: only while this page is open and you're not already using the camera in a call.
const camPreview = ref(false)
const videoEl = ref<HTMLVideoElement>()
let camStream: MediaStream | undefined
const stopCam = () => {
  camStream?.getTracks().forEach(t => t.stop())
  camStream = undefined
  if (videoEl.value) videoEl.value.srcObject = null
}
watch(camPreview, async on => {
  stopCam()
  if (!on) return
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: matchDevice(s.value.camera, v.devices.value.cams).deviceId } })
    if (!camPreview.value) return stopCam()
    await nextTick()
    if (videoEl.value) videoEl.value.srcObject = camStream
  } catch {
    useToast().add({ title: 'Could not open the camera', color: 'error', icon: 'i-lucide-video-off' })
    camPreview.value = false
  }
})
onBeforeUnmount(stopCam)

const soundLabels = { join: 'Join', leave: 'Leave', mute: 'Mute', deafen: 'Deafen', camera: 'Camera', screen: 'Screen share' } as const
</script>

<template>
  <div class="flex flex-col gap-6">
    <UCard>
      <template #header>
        <h2 class="font-bold">Devices</h2>
      </template>
      <div class="flex flex-col gap-4">
        <UAlert
          v-if="labelsHidden"
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          title="Device names are hidden until you allow the microphone"
          :actions="[{ label: 'Allow microphone', icon: 'i-lucide-mic', onClick: allow }]"
        />
        <UFormField label="Microphone">
          <USelect
            :model-value="current(s.mic, v.devices.value.mics)"
            :items="items(v.devices.value.mics)"
            class="w-full"
            @update:model-value="pick('mic', v.devices.value.mics)($event as string)"
          />
        </UFormField>
        <UFormField label="Level">
          <div class="flex items-center gap-3">
            <UButton
              :icon="testing ? 'i-lucide-square' : 'i-lucide-play'"
              :label="testing ? 'Stop' : 'Test microphone'"
              color="neutral"
              variant="outline"
              :disabled="!!v.channelId.value"
              @click="testing = !testing"
            />
            <UProgress :model-value="level * 100" class="max-w-xs" aria-label="Microphone level" />
          </div>
        </UFormField>
        <UFormField v-if="v.canPickOutput" label="Speakers">
          <USelect
            :model-value="current(s.speaker, v.devices.value.speakers)"
            :items="items(v.devices.value.speakers)"
            class="w-full"
            @update:model-value="pick('speaker', v.devices.value.speakers)($event as string)"
          />
        </UFormField>
        <UFormField label="Camera">
          <USelect
            :model-value="current(s.camera, v.devices.value.cams)"
            :items="items(v.devices.value.cams)"
            class="w-full"
            @update:model-value="pick('camera', v.devices.value.cams)($event as string)"
          />
        </UFormField>
        <div class="flex flex-col gap-2">
          <UButton
            :icon="camPreview ? 'i-lucide-video-off' : 'i-lucide-video'"
            :label="camPreview ? 'Stop preview' : 'Preview camera'"
            color="neutral"
            variant="outline"
            class="w-fit"
            :disabled="v.camOn.value"
            @click="camPreview = !camPreview"
          />
          <video
            v-show="camPreview"
            ref="videoEl"
            autoplay
            muted
            playsinline
            class="aspect-video w-full max-w-xs -scale-x-100 rounded-md border border-default bg-black"
          />
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-bold">Voice processing</h2>
      </template>
      <div class="flex flex-col gap-4">
        <UFormField label="Noise suppression" description="Enhanced uses RNNoise and costs a little CPU.">
          <USelect v-model="s.noise" :items="noiseItems" class="w-full max-w-xs" @update:model-value="v.applySettings()" />
        </UFormField>
        <USwitch v-model="s.echo" label="Echo cancellation" icon="i-lucide-audio-waveform" @update:model-value="v.applySettings()" />
        <USwitch v-model="s.agc" label="Auto gain" icon="i-lucide-sliders-horizontal" @update:model-value="v.applySettings()" />
        <UFormField label="Sensitivity" description="Voice activation only. Higher picks up quieter speech.">
          <USlider v-model="s.sensitivity" :min="0" :max="100" :step="1" class="max-w-xs" aria-label="Sensitivity" @update:model-value="v.applySettings()" />
        </UFormField>
        <UFormField label="Output volume">
          <div class="flex items-center gap-3">
            <USlider
              v-model="s.outputVolume"
              :min="0"
              :max="1"
              :step="0.05"
              class="max-w-xs"
              aria-label="Output volume"
              @update:model-value="v.applyOutput()"
            />
            <UButton icon="i-lucide-volume-2" label="Test sound" color="neutral" variant="outline" @click="playVoiceSound('join', true, true)" />
          </div>
        </UFormField>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-bold">Sounds</h2>
      </template>
      <div class="flex flex-col gap-4">
        <div v-for="(label, k) in soundLabels" :key="k" class="flex items-center gap-4">
          <USwitch v-model="s.sounds[k].on" :label="label" class="w-32" />
          <USlider v-model="s.sounds[k].volume" :min="0" :max="1" :step="0.05" :disabled="!s.sounds[k].on" class="max-w-xs" :aria-label="`${label} volume`" />
          <UButton icon="i-lucide-play" color="neutral" variant="ghost" :aria-label="`Test ${label} sound`" @click="playVoiceSound(k, true, true)" />
        </div>
        <div class="flex items-center gap-4">
          <USwitch v-model="s.soundboard.on" label="Soundboard" class="w-32" />
          <USlider v-model="s.soundboard.volume" :min="0" :max="1" :step="0.05" :disabled="!s.soundboard.on" class="max-w-xs" aria-label="Soundboard volume" />
        </div>
      </div>
    </UCard>
  </div>
</template>
