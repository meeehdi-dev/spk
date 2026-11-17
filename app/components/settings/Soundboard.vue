<script setup lang="ts">
import type WaveSurfer from 'wavesurfer.js'

import { cropChannels, encodeWav, hasSoundClipping, MAX_SOUND_BYTES, MAX_SOUND_MS, MAX_SOUND_SOURCE_BYTES, SOUND_MIME, SOUND_RATE } from '#shared/utils/sounds'
import { matchDevice } from '#shared/utils/voice'
import { routeMediaOutput } from '~/utils/media-output'

const { data: sounds, refresh } = useSounds()
const toast = useToast()
const fail = (title: string) => (e: unknown) => toast.add({ title, description: errorText(e), color: 'error', icon: 'i-lucide-circle-alert' })

// Lucide icon names for the picker (loaded only on this tab; aliases left out).
const iconItems = ref<Array<{ label: string; value: string; icon: string }>>([])
onMounted(async () => {
  const set = (await import('@iconify-json/lucide/icons.json')).default as { icons: Record<string, unknown> }
  iconItems.value = Object.keys(set.icons).map(n => ({ label: n, value: n, icon: `i-lucide-${n}` }))
})

// --- add: choose a file, crop, name, icon, save ---
const box = ref<HTMLElement>()
const media = shallowRef<HTMLMediaElement | null>(null)
useMediaOutput(media)
const voice = useVoice()
const settings = useVoiceSettings()
const listening = computed(() => settings.value.soundboard)
const form = reactive({ name: '', icon: 'audio-lines' })
const decoded = shallowRef<AudioBuffer>()
const sel = ref({ start: 0, end: 0 })
const volume = ref(100)
const channels = computed(() => {
  const d = decoded.value
  return d
    ? cropChannels(
        Array.from({ length: d.numberOfChannels }, (_, i) => d.getChannelData(i)),
        d.sampleRate,
        sel.value.start,
        sel.value.end,
      )
    : []
})
const clipping = computed(() => hasSoundClipping(channels.value, volume.value / 100))
const clippingWarning = 'This upload gain would clip peaks. Lower it before previewing or saving.'
const playing = ref(false)
const saving = ref(false)
let ws: WaveSurfer | undefined
let previewUrl: string | undefined
let previewVersion = 0
let loadVersion = 0
let previewFrame: number | undefined
function applyPreviewVolume() {
  if (media.value) media.value.volume = Number.isFinite(listening.value.volume) ? Math.max(0, Math.min(1, listening.value.volume)) : 0.7
}

function stopPreview() {
  previewVersion++
  if (previewFrame !== undefined) cancelAnimationFrame(previewFrame)
  previewFrame = undefined
  if (media.value) {
    media.value.onended = null
    media.value.pause()
    media.value.removeAttribute('src')
    media.value.load()
    media.value = null
  }
  if (previewUrl) URL.revokeObjectURL(previewUrl)
  previewUrl = undefined
  playing.value = false
  ws?.setTime(sel.value.start)
}
watch([volume, sel], stopPreview, { flush: 'sync' })
watch(() => listening.value.volume, applyPreviewVolume)

function reset() {
  loadVersion++
  stopPreview()
  media.value = null
  ws?.destroy()
  ws = undefined
  decoded.value = undefined
  volume.value = 100
  form.name = ''
  playing.value = false
}
onBeforeUnmount(reset)

const over = ref(false)
function choose(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void load(file)
}
function drop(e: DragEvent) {
  over.value = false
  const file = e.dataTransfer?.files[0]
  if (file) void load(file)
}
async function load(file: File) {
  if (!file) return
  if (file.size > MAX_SOUND_SOURCE_BYTES) return fail('File too big')({ message: 'Choose a file under 20 MB' })
  reset()
  const version = loadVersion
  try {
    const ctx = new AudioContext({ sampleRate: SOUND_RATE })
    let buffer: AudioBuffer
    try {
      buffer = await ctx.decodeAudioData(await file.arrayBuffer())
    } finally {
      void ctx.close()
    }
    if (version !== loadVersion) return
    if (buffer.numberOfChannels > 2) throw new Error('Choose a mono or stereo file; surround audio is not supported')
    decoded.value = buffer
  } catch (e) {
    if (version === loadVersion) fail('Could not read that file')(e)
    return
  }
  form.name = file.name.replace(/\.[^.]+$/, '').slice(0, 32)
  await nextTick()
  const [{ default: WaveSurfer }, { default: Regions }] = await Promise.all([import('wavesurfer.js'), import('wavesurfer.js/plugins/regions')])
  if (version !== loadVersion) return
  const regions = Regions.create()
  ws = WaveSurfer.create({
    container: box.value!,
    peaks: Array.from({ length: decoded.value!.numberOfChannels }, (_, i) => decoded.value!.getChannelData(i)),
    duration: decoded.value!.duration,
    interact: false,
    height: 96,
    waveColor: '#a1a1aa',
    progressColor: '#f59e0b',
    plugins: [regions],
  })
  ws.on('decode', d => {
    const region = regions.addRegion({
      start: 0,
      end: Math.min(d, MAX_SOUND_MS / 1000),
      color: 'rgba(245, 158, 11, 0.25)',
      minLength: 0.1,
      maxLength: MAX_SOUND_MS / 1000,
    })
    sel.value = { start: region.start, end: region.end }
  })
  regions.on('region-updated', r => {
    sel.value = { start: r.start, end: r.end }
  })
}
async function toggle() {
  if (playing.value) return stopPreview()
  if (!decoded.value || clipping.value || !channels.value[0]?.length) return
  stopPreview()
  const version = previewVersion
  try {
    const wav = encodeWav(channels.value, decoded.value.sampleRate, volume.value / 100)
    const selectionStart = Math.floor(sel.value.start * decoded.value.sampleRate) / decoded.value.sampleRate
    previewUrl = URL.createObjectURL(new Blob([wav as BlobPart], { type: SOUND_MIME }))
    const player = new Audio(previewUrl)
    player.loop = false
    player.onended = () => {
      if (version === previewVersion) stopPreview()
    }
    media.value = player
    applyPreviewVolume()
    await routeMediaOutput(player, matchDevice(voice.settings.value.mediaSpeaker, voice.devices.value.speakers).deviceId ?? '')
    if (version !== previewVersion) return
    await player.play()
    if (version !== previewVersion) return
    playing.value = true
    ws?.setTime(selectionStart)
    const tick = () => {
      if (version !== previewVersion) return
      // Follow the media clock so buffering does not make the waveform drift.
      ws?.setTime(selectionStart + player.currentTime)
      previewFrame = requestAnimationFrame(tick)
    }
    previewFrame = requestAnimationFrame(tick)
  } catch (e) {
    if (version === previewVersion) {
      stopPreview()
      fail('Could not preview the sound')(e)
    }
  }
}

async function save() {
  if (!decoded.value || saving.value || clipping.value) return
  saving.value = true
  try {
    const d = decoded.value
    const samples = channels.value
    const wav = encodeWav(samples, d.sampleRate, volume.value / 100)
    if (wav.length > MAX_SOUND_BYTES) throw new Error('The cropped sound is too big')
    const { id, url, headers } = await $fetch<{ id: string; url: string; headers: Record<string, string> }>('/api/sounds/presign', {
      method: 'POST',
      body: { size: wav.length },
    })
    const put = await fetch(url, { method: 'PUT', headers, body: wav as BodyInit })
    if (!put.ok) throw new Error(`Upload failed (${put.status})`)
    await $fetch('/api/sounds', {
      method: 'POST',
      body: { id, name: form.name, icon: form.icon, durationMs: Math.round((samples[0]!.length / d.sampleRate) * 1000), size: wav.length },
    })
    toast.add({ title: 'Sound added', icon: 'i-lucide-check' })
    reset()
    await refresh()
  } catch (e) {
    fail('Could not save the sound')(e)
  } finally {
    saving.value = false
  }
}

// --- edit (name and icon) and delete ---
const editing = ref<{ id: string; name: string; icon: string } | null>(null)
const editOpen = computed({
  get: () => !!editing.value,
  set: o => {
    if (!o) editing.value = null
  },
})
async function saveEdit() {
  const e = editing.value!
  try {
    await $fetch(`/api/sounds/${e.id}`, { method: 'PATCH', body: { name: e.name, icon: e.icon } })
    editing.value = null
    await refresh()
  } catch (err) {
    fail('Could not save')(err)
  }
}
const confirmDelete = ref<{ id: string; name: string } | null>(null)
const deleteOpen = computed({
  get: () => !!confirmDelete.value,
  set: o => {
    if (!o) confirmDelete.value = null
  },
})
async function remove() {
  const s = confirmDelete.value!
  try {
    await $fetch(`/api/sounds/${s.id}`, { method: 'DELETE' })
    forgetSound(s.id)
    confirmDelete.value = null
    await refresh()
  } catch (err) {
    fail('Could not delete')(err)
  }
}
const menu = (s: { id: string; name: string; icon: string }) => [
  [
    { label: 'Preview', icon: 'i-lucide-play', onSelect: () => playSound(s.id, true) },
    {
      label: 'Edit name and icon',
      icon: 'i-lucide-pencil',
      onSelect: () => {
        editing.value = { id: s.id, name: s.name, icon: s.icon }
      },
    },
    {
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => {
        confirmDelete.value = { id: s.id, name: s.name }
      },
    },
  ],
]
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`
</script>

<template>
  <div class="flex flex-col gap-6">
    <UCard>
      <template #header>
        <h2 class="font-bold">Add a sound</h2>
      </template>
      <div class="flex flex-col gap-4">
        <UFormField
          label="Audio file"
          description="mp3, ogg, wav, m4a… up to 20 MB. It never leaves your browser; only the cropped part (10 s at most) is uploaded."
        >
          <!-- The input is visually hidden, not display:none, so it stays reachable from the keyboard. -->
          <label
            class="flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-accented p-8 text-center text-sm text-muted transition hover:border-primary has-[:focus-visible]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary"
            :class="over ? 'border-primary bg-elevated/50' : ''"
            @dragover.prevent="over = true"
            @dragleave="over = false"
            @drop.prevent="drop"
          >
            <UIcon name="i-lucide-upload" class="size-8" />
            <span>Drop an audio file here, or click to choose</span>
            <input type="file" accept="audio/*" class="sr-only" aria-label="Audio file" @change="choose" />
          </label>
        </UFormField>
        <div v-show="decoded" class="flex flex-col gap-4">
          <div ref="box" class="rounded-md border border-default p-2" />
          <div class="flex items-center gap-3 text-sm text-muted">
            <UButton
              :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
              :label="playing ? 'Pause' : 'Play selection'"
              color="neutral"
              variant="outline"
              :disabled="clipping"
              @click="toggle"
            />
            <span>{{ sel.start.toFixed(2) }} s – {{ sel.end.toFixed(2) }} s ({{ (sel.end - sel.start).toFixed(2) }} s, 10 s at most)</span>
          </div>
          <UFormField label="Upload gain" :hint="`${volume}%`" description="Applied permanently. 100% preserves the source level; no normalization is applied.">
            <USlider v-model="volume" :min="0" :max="200" :step="1" aria-label="Upload volume" />
          </UFormField>
          <p class="text-sm text-muted">
            Preview uses your soundboard listening volume ({{ Math.round(listening.volume * 100) }}%). This does not change the file.
          </p>
          <p role="status" class="grid text-sm text-warning">
            <span aria-hidden="true" class="invisible col-start-1 row-start-1">{{ clippingWarning }}</span>
            <span v-if="clipping" class="col-start-1 row-start-1">{{ clippingWarning }}</span>
          </p>
          <div class="flex flex-wrap items-end gap-2">
            <UFormField label="Name" class="min-w-48 flex-1">
              <UInput v-model="form.name" maxlength="32" class="w-full" />
            </UFormField>
            <UFormField label="Icon">
              <USelectMenu v-model="form.icon" :items="iconItems" value-key="value" :icon="`i-lucide-${form.icon}`" virtualize class="w-56" aria-label="Icon" />
            </UFormField>
            <UButton label="Save" icon="i-lucide-save" :loading="saving" :disabled="!form.name.trim() || !iconItems.length || clipping" @click="save" />
            <UButton label="Discard" icon="i-lucide-x" color="neutral" variant="ghost" @click="reset" />
          </div>
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-bold">Sounds</h2>
      </template>
      <p v-if="!sounds.length" class="text-sm text-muted">No sounds yet.</p>
      <ul class="divide-y divide-default">
        <UContextMenu v-for="s in sounds" :key="s.id" :items="menu(s)">
          <li class="flex items-center gap-3 py-2 text-sm">
            <UIcon :name="`i-lucide-${s.icon}`" class="size-5" />
            <span class="min-w-0 flex-1 truncate"><EmojiText :text="s.name" /> <span class="text-xs text-muted">· {{ secs(s.durationMs) }}</span></span>
            <UDropdownMenu :items="menu(s)">
              <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" :aria-label="`Actions for ${s.name}`" />
            </UDropdownMenu>
          </li>
        </UContextMenu>
      </ul>
    </UCard>

    <UModal v-model:open="editOpen" title="Edit sound" description="Name and icon only. To change the crop, delete the sound and upload it again.">
      <template #body>
        <form v-if="editing" class="flex flex-col gap-4" @submit.prevent="saveEdit">
          <UFormField label="Name">
            <UInput v-model="editing.name" maxlength="32" class="w-full" />
          </UFormField>
          <UFormField label="Icon">
            <USelectMenu
              v-model="editing.icon"
              :items="iconItems"
              value-key="value"
              :icon="`i-lucide-${editing.icon}`"
              virtualize
              class="w-full"
              aria-label="Icon"
            />
          </UFormField>
          <UButton type="submit" label="Save" icon="i-lucide-save" :disabled="!editing.name.trim()" />
        </form>
      </template>
    </UModal>
    <UModal v-model:open="deleteOpen" title="Delete sound" :description="`Delete “${confirmDelete?.name}”? This can't be undone.`">
      <template #description><EmojiText :text="`Delete “${confirmDelete?.name}”? This can't be undone.`" /></template>
      <template #footer>
        <UButton label="Cancel" color="neutral" variant="ghost" @click="deleteOpen = false" />
        <UButton label="Delete" icon="i-lucide-trash-2" color="error" @click="remove" />
      </template>
    </UModal>
  </div>
</template>
