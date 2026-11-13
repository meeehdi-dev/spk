<script setup lang="ts">
import { cameraConstraints, matchDevice } from '#shared/utils/voice'

const v = useVoice()
const s = v.settings
const noiseItems = [
  { label: 'Off', value: 'off' },
  { label: 'Standard (browser)', value: 'standard' },
  { label: 'Enhanced (DeepFilterNet)', value: 'enhanced' },
]
const items = (list: MediaDeviceInfo[]) => [
  { label: 'System default', value: 'default' },
  ...list.filter(d => d.deviceId !== 'default').map(d => ({ label: d.label || 'Device', value: d.deviceId })),
]
const current = (saved: { deviceId: string; label: string } | undefined, list: MediaDeviceInfo[]) => matchDevice(saved, list).deviceId ?? 'default'
const pick = (kind: 'mic' | 'speaker' | 'mediaSpeaker' | 'camera', list: MediaDeviceInfo[]) => (id: string) => {
  if (id === 'default') return v.pickDevice(kind, { deviceId: 'default', label: 'System default' })
  const d = list.find(x => x.deviceId === id)
  if (d) void v.pickDevice(kind, d)
}
// Labels are blank until the browser grants a device permission; this button asks once.
const labelsHidden = computed(() => [...v.devices.value.mics, ...v.devices.value.speakers].some(d => !d.label))
async function allow() {
  try {
    await v.allowMicrophone()
  } catch {
    useToast().add({ title: 'Microphone access was denied', color: 'error', icon: 'i-lucide-mic-off' })
  }
  await v.refreshDevices()
}
onMounted(v.refreshDevices)

// Level meter on the chosen mic (only while this page is open and you are not in a call).
const level = ref(0)
const testing = ref(false)
watch(
  testing,
  async (on, _, onCleanup) => {
    level.value = 0
    if (!on) return
    let cancelled = false
    let stream: MediaStream | undefined
    let ctx: AudioContext | undefined
    let raf = 0
    const stop = () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach(t => t.stop())
      stream = undefined
      if (ctx) void ctx.close()
      ctx = undefined
    }
    onCleanup(stop)
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: matchDevice(s.value.mic, v.devices.value.mics).deviceId } })
      if (cancelled) {
        stream.getTracks().forEach(t => t.stop())
        return
      }
      ctx = new AudioContext()
      const an = ctx.createAnalyser(),
        buf = new Float32Array(1024)
      an.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(an)
      const tick = () => {
        an.getFloatTimeDomainData(buf)
        level.value = Math.min(1, Math.sqrt(buf.reduce((a, x) => a + x * x, 0) / buf.length) * 4)
        raf = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      if (cancelled) return
      stop()
      useToast().add({ title: 'Could not open the microphone', color: 'error', icon: 'i-lucide-mic-off' })
      testing.value = false
    }
  },
  { flush: 'sync' },
)
watch(
  () => v.connecting.value || !!v.channelId.value,
  active => {
    if (active) testing.value = false
  },
  { flush: 'sync' },
)

// Camera preview: only while this page is open and you're not already using the camera in a call.
const camPreview = ref(false)
const videoEl = ref<HTMLVideoElement>()
watch([camPreview, () => s.value.cameraResolution, () => s.value.camera?.deviceId, () => v.camOn.value], async ([on, resolution, , inCall], _, onCleanup) => {
  let cancelled = false
  let stream: MediaStream | undefined
  const stop = () => {
    cancelled = true
    stream?.getTracks().forEach(t => t.stop())
    if (videoEl.value && videoEl.value.srcObject === stream) videoEl.value.srcObject = null
  }
  onCleanup(stop)
  if (!on || inCall) return
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { ...cameraConstraints(resolution), deviceId: matchDevice(s.value.camera, v.devices.value.cams).deviceId },
    })
    if (cancelled) return stop()
    await nextTick()
    if (!cancelled && videoEl.value) videoEl.value.srcObject = stream
  } catch {
    if (cancelled) return
    stop()
    useToast().add({ title: 'Could not open the camera', color: 'error', icon: 'i-lucide-video-off' })
    camPreview.value = false
  }
})

// Each test entry plays one tune: up = rising (unmute, on, start), otherwise falling.
const soundRows = [
  { kind: 'join', label: 'Join', tests: [{ name: 'Join', up: true }] },
  { kind: 'leave', label: 'Leave', tests: [{ name: 'Leave', up: true }] },
  {
    kind: 'mute',
    label: 'Mute / Unmute',
    tests: [
      { name: 'Unmute', up: true },
      { name: 'Mute', up: false },
    ],
  },
  {
    kind: 'deafen',
    label: 'Deafen / Undeafen',
    tests: [
      { name: 'Undeafen', up: true },
      { name: 'Deafen', up: false },
    ],
  },
  {
    kind: 'camera',
    label: 'Camera on / off',
    tests: [
      { name: 'Camera on', up: true },
      { name: 'Camera off', up: false },
    ],
  },
  {
    kind: 'screen',
    label: 'Screen share start / stop',
    tests: [
      { name: 'Screen share start', up: true },
      { name: 'Screen share stop', up: false },
    ],
  },
  {
    kind: 'watch',
    label: 'Someone watches your screen',
    tests: [
      { name: 'Watch start', up: true },
      { name: 'Watch stop', up: false },
    ],
  },
] as const
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
              :disabled="v.connecting.value || !!v.channelId.value"
              @click="testing = !testing"
            />
            <UProgress :model-value="level * 100" class="max-w-xs" aria-label="Microphone level" />
          </div>
        </UFormField>
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
            :model-value="current(s[output.kind], v.devices.value.speakers)"
            :items="items(v.devices.value.speakers.filter(d => d.deviceId !== 'default'))"
            class="w-full"
            @update:model-value="pick(output.kind, v.devices.value.speakers)($event as string)"
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
        <VoiceCameraResolution />
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
        <UFormField label="Noise suppression" description="Enhanced is stronger: one-time download of about 11–22 MB, and it uses more CPU.">
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
              :step="0.01"
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
        <div v-for="row in soundRows" :key="row.kind" class="flex flex-wrap items-center gap-x-4 gap-y-2 sm:flex-nowrap">
          <USwitch v-model="s.sounds[row.kind].on" :label="row.label" class="w-full shrink-0 sm:w-60 sm:whitespace-nowrap" />
          <USlider
            v-model="s.sounds[row.kind].volume"
            :min="0"
            :max="1"
            :step="0.01"
            :disabled="!s.sounds[row.kind].on"
            class="max-w-xs flex-1"
            :aria-label="`${row.label} volume`"
          />
          <div class="flex w-20 shrink-0">
            <UButton
              v-for="t in row.tests"
              :key="t.name"
              icon="i-lucide-play"
              color="neutral"
              variant="ghost"
              :aria-label="`Test ${t.name} sound`"
              @click="playVoiceSound(row.kind, t.up, true)"
            />
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 sm:flex-nowrap">
          <USwitch v-model="s.soundboard.on" label="Soundboard" class="w-full shrink-0 sm:w-60" />
          <USlider
            v-model="s.soundboard.volume"
            :min="0"
            :max="1"
            :step="0.01"
            :disabled="!s.soundboard.on"
            class="max-w-xs flex-1"
            aria-label="Soundboard volume"
          />
          <div class="w-20 shrink-0" />
        </div>
      </div>
    </UCard>
  </div>
</template>
