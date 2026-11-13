<script setup lang="ts">
import type WaveSurfer from 'wavesurfer.js'
import type { Region } from 'wavesurfer.js/plugins/regions'

import { cropMono, encodeWav, MAX_SOUND_BYTES, MAX_SOUND_MS, MAX_SOUND_SOURCE_BYTES, SOUND_RATE } from '#shared/utils/sounds'

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
const form = reactive({ name: '', icon: 'audio-lines' })
const decoded = shallowRef<AudioBuffer>()
const sel = ref({ start: 0, end: 0 })
const playing = ref(false)
const saving = ref(false)
let ws: WaveSurfer | undefined
let region: Region | undefined

function reset() {
  media.value = null
  ws?.destroy()
  ws = region = undefined
  decoded.value = undefined
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
  try {
    // Decoding at 48 kHz resamples, so 10 s of mono stays about 1 MB. The file never leaves the browser.
    const ctx = new AudioContext({ sampleRate: SOUND_RATE })
    decoded.value = await ctx.decodeAudioData(await file.arrayBuffer())
    void ctx.close()
  } catch {
    return fail('Could not read that file')({ message: 'The browser cannot decode it' })
  }
  form.name = file.name.replace(/\.[^.]+$/, '').slice(0, 32)
  await nextTick()
  const [{ default: WaveSurfer }, { default: Regions }] = await Promise.all([import('wavesurfer.js'), import('wavesurfer.js/plugins/regions')])
  const regions = Regions.create()
  ws = WaveSurfer.create({
    container: box.value!,
    url: URL.createObjectURL(file),
    height: 96,
    waveColor: '#a1a1aa',
    progressColor: '#f59e0b',
    plugins: [regions],
  })
  media.value = ws.getMediaElement()
  ws.on('play', () => {
    playing.value = true
  })
  ws.on('pause', () => {
    playing.value = false
  })
  ws.on('decode', d => {
    region = regions.addRegion({
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
const toggle = () => {
  if (playing.value) ws?.pause()
  else region?.play(true)
}

async function save() {
  if (!decoded.value || saving.value) return
  saving.value = true
  try {
    const d = decoded.value
    const mono = cropMono(
      Array.from({ length: d.numberOfChannels }, (_, i) => d.getChannelData(i)),
      d.sampleRate,
      sel.value.start,
      sel.value.end,
    )
    const wav = encodeWav(mono, d.sampleRate)
    if (wav.length > MAX_SOUND_BYTES) throw new Error('The cropped sound is too big')
    const { id, url, headers } = await $fetch<{ id: string; url: string; headers: Record<string, string> }>('/api/sounds/presign', {
      method: 'POST',
      body: { size: wav.length },
    })
    const put = await fetch(url, { method: 'PUT', headers, body: wav as BodyInit })
    if (!put.ok) throw new Error(`Upload failed (${put.status})`)
    await $fetch('/api/sounds', {
      method: 'POST',
      body: { id, name: form.name, icon: form.icon, durationMs: Math.round((mono.length / d.sampleRate) * 1000), size: wav.length },
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
              @click="toggle"
            />
            <span>{{ sel.start.toFixed(2) }} s – {{ sel.end.toFixed(2) }} s ({{ (sel.end - sel.start).toFixed(2) }} s, 10 s at most)</span>
          </div>
          <div class="flex flex-wrap items-end gap-2">
            <UFormField label="Name" class="min-w-48 flex-1">
              <UInput v-model="form.name" maxlength="32" class="w-full" />
            </UFormField>
            <UFormField label="Icon">
              <USelectMenu v-model="form.icon" :items="iconItems" value-key="value" :icon="`i-lucide-${form.icon}`" virtualize class="w-56" aria-label="Icon" />
            </UFormField>
            <UButton label="Save" icon="i-lucide-save" :loading="saving" :disabled="!form.name.trim() || !iconItems.length" @click="save" />
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
            <span class="min-w-0 flex-1 truncate">{{ s.name }} <span class="text-xs text-muted">· {{ secs(s.durationMs) }}</span></span>
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
      <template #footer>
        <UButton label="Cancel" color="neutral" variant="ghost" @click="deleteOpen = false" />
        <UButton label="Delete" icon="i-lucide-trash-2" color="error" @click="remove" />
      </template>
    </UModal>
  </div>
</template>
