<script setup lang="ts">
import type { RadioStation } from '#shared/utils/radio'

defineProps<{ labeled?: boolean }>()
const v = useVoice()
const radio = useRadio()
const q = ref('')
const stations = ref<RadioStation[]>([])
const loading = ref(false)
const error = ref('')
let search = 0
async function find() {
  const epoch = ++search
  error.value = ''
  stations.value = []
  loading.value = false
  if (q.value.trim().length < 2) {
    error.value = 'Enter at least two characters.'
    return
  }
  loading.value = true
  try {
    const results = await $fetch<RadioStation[]>('/api/radio/stations', { query: { q: q.value.trim() } })
    if (search === epoch) stations.value = results
  } catch {
    if (search === epoch) error.value = 'Radio search is unavailable. Try again later.'
  } finally {
    if (search === epoch) loading.value = false
  }
}
const status = computed(() => {
  if (!radio.enabled.value) return 'Muted for you'
  if (v.mute.value.deafened) return 'Deafened'
  if (radio.playback.value === 'blocked') return 'Press Listen to allow audio.'
  if (radio.playback.value === 'error') return 'This stream could not play in your browser.'
  if (radio.playback.value === 'playing') return 'Playing'
  return 'Connecting…'
})
</script>

<template>
  <UPopover :content="{ align: 'end', side: 'top' }">
    <UTooltip text="Channel radio">
      <UButton
        icon="i-lucide-radio"
        color="neutral"
        variant="ghost"
        :disabled="!v.channelId.value"
        aria-label="Channel radio"
        :label="labeled ? 'Radio' : undefined"
      />
    </UTooltip>
    <template #content>
      <div class="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 p-3 text-sm">
        <p class="font-medium">Channel radio</p>
        <template v-if="radio.station.value">
          <p class="truncate">{{ radio.station.value.name }}</p>
          <p role="status" class="text-muted">{{ status }}</p>
          <div class="flex gap-2">
            <UButton
              v-if="!radio.enabled.value || radio.playback.value === 'blocked' || radio.playback.value === 'error'"
              :label="radio.playback.value === 'error' ? 'Retry' : 'Listen'"
              @click="radio.listen"
            />
            <UButton v-else label="Mute for me" color="neutral" variant="soft" @click="radio.mute" />
            <UButton label="Stop for everyone" color="neutral" variant="soft" @click="radio.stop" />
          </div>
          <USlider v-model="radio.volume.value" :min="0" :max="1" :step="0.05" aria-label="Radio volume (only you)" />
        </template>
        <p v-else class="text-muted">No station selected.</p>
        <p v-if="radio.commandError.value" role="alert" class="text-error">{{ radio.commandError.value }}</p>
        <USeparator />
        <form class="flex gap-2" @submit.prevent="find">
          <UInput v-model="q" :maxlength="100" placeholder="Search stations" aria-label="Search radio stations" class="min-w-0 flex-1" />
          <UButton type="submit" icon="i-lucide-search" :loading="loading" aria-label="Find stations" />
        </form>
        <p v-if="error" role="alert" class="text-error">{{ error }}</p>
        <p v-else-if="search && !loading && !stations.length" class="text-muted">No supported HTTPS MP3/AAC stations found.</p>
        <div class="flex max-h-60 flex-col gap-1 overflow-y-auto">
          <UButton
            v-for="station in stations"
            :key="station.id"
            color="neutral"
            variant="ghost"
            class="justify-start"
            :aria-label="`Play ${station.name} for everyone`"
            @click="radio.select(station.id)"
          >
            <span class="truncate">{{ station.name }}</span>
            <span class="ml-auto shrink-0 text-xs text-muted">{{ station.country }} · {{ station.codec }}</span>
          </UButton>
        </div>
        <p class="text-xs text-muted">One station for this channel. Your browser connects directly to the station; listeners can hear different delays.</p>
        <a href="https://www.radio-browser.info/" target="_blank" rel="noopener noreferrer" class="text-xs text-primary hover:underline"
          >Stations from Radio Browser</a
        >
      </div>
    </template>
  </UPopover>
</template>
