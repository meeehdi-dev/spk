<script setup lang="ts">
import type { RadioFavorite, RadioStation } from '#shared/utils/radio'

defineProps<{ labeled?: boolean }>()
const v = useVoice()
const radio = useRadio()
const q = ref('')
const stations = ref<RadioStation[]>([])
const loading = ref(false)
const error = ref('')
const open = ref(false)
const favoritesOnly = ref(false)
const favorites = ref<RadioFavorite[]>([])
const favoritesLoading = ref(false)
const favoritesReady = ref(false)
const favoritesError = ref('')
const saving = ref<string[]>([])
let favoritesRequest = 0
const visibleStations = computed(() =>
  favoritesOnly.value ? favorites.value.filter(station => station.name.toLowerCase().includes(q.value.trim().toLowerCase())) : stations.value,
)
const isFavorite = (id: string) => favorites.value.some(station => station.id === id)
watch(open, async value => {
  if (!value) return
  favoritesOnly.value = false
  if (saving.value.length) return
  const request = ++favoritesRequest
  favoritesLoading.value = true
  favoritesReady.value = false
  favoritesError.value = ''
  try {
    const results = await $fetch<RadioFavorite[]>('/api/radio/favorites')
    if (request === favoritesRequest) {
      favorites.value = results
      favoritesReady.value = true
    }
  } catch {
    if (request === favoritesRequest) favoritesError.value = 'Could not load favorites. Close and reopen Radio to retry.'
  } finally {
    if (request === favoritesRequest) favoritesLoading.value = false
  }
})
async function toggleFavorite(station: Omit<RadioStation, 'url'>) {
  if (!favoritesReady.value || saving.value.includes(station.id)) return
  saving.value.push(station.id)
  favoritesError.value = ''
  try {
    if (isFavorite(station.id)) {
      await $fetch(`/api/radio/favorites/${station.id}`, { method: 'DELETE' })
      favorites.value = favorites.value.filter(favorite => favorite.id !== station.id)
    } else {
      const favorite = await $fetch<RadioFavorite>(`/api/radio/favorites/${station.id}`, { method: 'PUT' })
      favorites.value = [...favorites.value, favorite].sort((a, b) => a.name.localeCompare(b.name))
    }
  } catch {
    favoritesError.value = 'Could not update favorites. Try again. You can save up to 50 stations.'
  } finally {
    saving.value = saving.value.filter(id => id !== station.id)
  }
}
let search = 0
async function find() {
  if (favoritesOnly.value) return
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
  <UPopover v-model:open="open" :content="{ align: 'end', side: 'top' }">
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
          <USlider v-model="radio.volume.value" :min="0" :max="1" :step="0.01" aria-label="Radio volume (only you)" />
        </template>
        <p v-else class="text-muted">No station selected.</p>
        <p v-if="radio.commandError.value" role="alert" class="text-error">{{ radio.commandError.value }}</p>
        <USeparator />
        <div class="flex gap-2" role="group" aria-label="Radio station filter">
          <UButton label="All" color="neutral" :variant="favoritesOnly ? 'ghost' : 'soft'" :aria-pressed="!favoritesOnly" @click="favoritesOnly = false" />
          <UButton label="Favorites" color="neutral" :variant="favoritesOnly ? 'soft' : 'ghost'" :aria-pressed="favoritesOnly" @click="favoritesOnly = true" />
        </div>
        <p v-if="favoritesLoading" role="status" class="text-muted">Loading favorites…</p>
        <p v-if="favoritesError" role="alert" class="text-error">{{ favoritesError }}</p>
        <form class="flex gap-2" @submit.prevent="find">
          <UInput v-model="q" :maxlength="100" placeholder="Search stations" aria-label="Search radio stations" class="min-w-0 flex-1" />
          <UButton v-if="!favoritesOnly" type="submit" icon="i-lucide-search" :loading="loading" aria-label="Find stations" />
        </form>
        <p v-if="!favoritesOnly && error" role="alert" class="text-error">{{ error }}</p>
        <p v-else-if="!favoritesOnly && search && !loading && !stations.length" class="text-muted">No supported HTTPS MP3/AAC stations found.</p>
        <p v-if="favoritesOnly && favoritesReady && !visibleStations.length" class="text-muted">
          {{ favorites.length ? 'No favorites match your search.' : 'No favorites yet. Star a station in All to save it.' }}
        </p>
        <div class="flex max-h-60 flex-col gap-1 overflow-y-auto">
          <div v-for="station in visibleStations" :key="station.id" class="flex items-center gap-1">
            <UButton
              color="neutral"
              variant="ghost"
              class="min-w-0 flex-1 justify-start"
              :disabled="'available' in station && station.available === false"
              :aria-label="`Play ${station.name} for everyone`"
              @click="radio.select(station.id)"
            >
              <span class="truncate">{{ station.name }}</span>
              <span class="ml-auto shrink-0 text-xs text-muted">{{
                'available' in station && station.available === null
                  ? 'Availability unknown'
                  : 'available' in station && station.available === false
                    ? 'Unavailable'
                    : `${station.country} · ${station.codec}`
              }}</span>
            </UButton>
            <UButton
              icon="i-lucide-star"
              :color="isFavorite(station.id) ? 'primary' : 'neutral'"
              variant="ghost"
              :disabled="!favoritesReady || favoritesLoading"
              :loading="saving.includes(station.id)"
              :aria-pressed="isFavorite(station.id)"
              :aria-label="`${isFavorite(station.id) ? 'Remove' : 'Add'} ${station.name} ${isFavorite(station.id) ? 'from' : 'to'} favorites`"
              @click="toggleFavorite(station)"
            />
          </div>
        </div>
        <p class="text-xs text-muted">One station for this channel. Your browser connects directly to the station; listeners can hear different delays.</p>
        <a href="https://www.radio-browser.info/" target="_blank" rel="noopener noreferrer" class="text-xs text-primary hover:underline"
          >Stations from Radio Browser</a
        >
      </div>
    </template>
  </UPopover>
</template>
