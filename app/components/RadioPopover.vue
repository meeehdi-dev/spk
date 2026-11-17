<script setup lang="ts">
import type { RadioFavorite, RadioStation } from '#shared/utils/radio'

defineProps<{ labeled?: boolean }>()
const v = useVoice()
const radio = useRadio()
const toast = useToast()
const q = ref('')
const stations = ref<RadioStation[]>([])
const loading = ref(false)
const error = ref('')
const searched = ref(false)
const open = ref(false)
const favoritesOnly = ref(false)
const favorites = ref<RadioFavorite[]>([])
const favoritesLoading = ref(false)
const favoritesReady = ref(false)
const saving = ref<string[]>([])
let favoritesRequest = 0
const visibleStations = computed(() =>
  favoritesOnly.value ? favorites.value.filter(station => station.name.toLowerCase().includes(q.value.trim().toLowerCase())) : stations.value,
)
const isFavorite = (id: string) => favorites.value.some(station => station.id === id)
watch(
  radio.commandError,
  message => {
    if (message && open.value) toast.add({ id: 'radio-command-error', title: message, color: 'error', icon: 'i-lucide-circle-alert' })
  },
  { flush: 'sync' },
)
watch(open, async value => {
  if (!value) return
  favoritesOnly.value = false
  if (saving.value.length) return
  const request = ++favoritesRequest
  favoritesLoading.value = true
  favoritesReady.value = false
  try {
    const results = await $fetch<RadioFavorite[]>('/api/radio/favorites')
    if (request === favoritesRequest) {
      favorites.value = results
      favoritesReady.value = true
    }
  } catch {
    if (request === favoritesRequest)
      toast.add({ title: 'Could not load favorites. Close and reopen Radio to retry.', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    if (request === favoritesRequest) favoritesLoading.value = false
  }
})
async function toggleFavorite(station: Omit<RadioStation, 'url'>) {
  if (!favoritesReady.value || saving.value.includes(station.id)) return
  saving.value.push(station.id)
  try {
    if (isFavorite(station.id)) {
      await $fetch(`/api/radio/favorites/${station.id}`, { method: 'DELETE' })
      favorites.value = favorites.value.filter(favorite => favorite.id !== station.id)
    } else {
      const favorite = await $fetch<RadioFavorite>(`/api/radio/favorites/${station.id}`, { method: 'PUT' })
      favorites.value = [...favorites.value, favorite].sort((a, b) => a.name.localeCompare(b.name))
    }
  } catch {
    toast.add({ title: 'Could not update favorites. Try again. You can save up to 50 stations.', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    saving.value = saving.value.filter(id => id !== station.id)
  }
}
let search = 0
async function find() {
  if (favoritesOnly.value) return
  const epoch = ++search
  error.value = ''
  searched.value = false
  stations.value = []
  loading.value = false
  if (q.value.trim().length < 2) {
    error.value = 'Enter at least two characters.'
    return
  }
  loading.value = true
  try {
    const results = await $fetch<RadioStation[]>('/api/radio/stations', { query: { q: q.value.trim() } })
    if (search === epoch) {
      stations.value = results
      searched.value = true
    }
  } catch {
    if (search === epoch) toast.add({ title: 'Radio search is unavailable. Try again later.', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    if (search === epoch) loading.value = false
  }
}
const needsListen = computed(() => !radio.enabled.value || radio.playback.value === 'blocked' || radio.playback.value === 'error')
const active = computed(() => !!radio.station.value && !needsListen.value)
const buttonStyle = computed(() => ({ color: active.value ? 'primary' : 'neutral', variant: active.value ? 'soft' : 'ghost' }) as const)
const actionLabel = computed(() => (!radio.station.value ? 'Radio settings' : needsListen.value ? 'Resume radio' : 'Pause radio'))
function togglePlayback() {
  if (!radio.station.value) open.value = true
  else if (needsListen.value) radio.listen()
  else radio.mute()
}
const status = computed(() => {
  if (!radio.enabled.value) return 'Paused for you'
  if (v.mute.value.deafened) return 'Deafened'
  if (radio.playback.value === 'blocked') return 'Resume to allow audio.'
  if (radio.playback.value === 'error') return 'This stream could not play in your browser.'
  if (radio.playback.value === 'playing') return 'Playing'
  return 'Connecting…'
})
</script>

<template>
  <UFieldGroup>
    <UTooltip :text="actionLabel">
      <UButton
        icon="i-lucide-radio"
        v-bind="buttonStyle"
        :disabled="!v.channelId.value"
        :aria-label="actionLabel"
        :aria-pressed="radio.station.value ? active : undefined"
        :label="labeled ? 'Radio' : undefined"
        @click="togglePlayback"
      />
    </UTooltip>
    <UPopover v-model:open="open" :content="{ align: 'end', side: 'top' }">
      <UButton v-bind="buttonStyle" icon="i-lucide-chevron-up" class="w-5 px-0" :disabled="!v.channelId.value" aria-label="Radio options" />
      <template #content>
        <div class="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 p-3 text-sm">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-radio" class="size-4 shrink-0 text-primary" />
            <h2 class="font-medium">Channel radio</h2>
          </div>
          <template v-if="radio.station.value">
            <div class="min-w-0">
              <p class="truncate font-medium text-highlighted"><EmojiText :text="radio.station.value.name" /></p>
              <p role="status" class="text-xs text-muted">{{ status }}</p>
            </div>
            <div class="flex items-center justify-between gap-2">
              <UButton
                :icon="needsListen ? (radio.playback.value === 'error' ? 'i-lucide-rotate-cw' : 'i-lucide-play') : 'i-lucide-pause'"
                :label="needsListen ? (radio.playback.value === 'error' ? 'Retry' : 'Resume') : 'Pause'"
                color="primary"
                variant="soft"
                @click="togglePlayback"
              />
              <UButton icon="i-lucide-square" label="Stop for everyone" color="neutral" variant="ghost" @click="radio.stop" />
            </div>
            <UFormField label="Volume (only you)" :hint="`${Math.round(radio.volume.value * 100)}%`">
              <USlider v-model="radio.volume.value" :min="0" :max="2" :step="0.01" aria-label="Radio volume (only you)" />
            </UFormField>
            <p v-if="radio.boostAvailable.value === false" role="status" class="text-xs text-muted">
              Boost unavailable for this station or browser. Playback is capped at 100%.
            </p>
          </template>
          <p v-else class="text-muted">Find a station to play in this channel.</p>
          <USeparator />
          <div class="flex gap-2" role="group" aria-label="Radio station filter">
            <UButton
              icon="i-lucide-list-music"
              label="All stations"
              :color="favoritesOnly ? 'neutral' : 'primary'"
              :variant="favoritesOnly ? 'ghost' : 'soft'"
              :aria-pressed="!favoritesOnly"
              @click="favoritesOnly = false"
            />
            <UButton
              icon="i-lucide-star"
              label="Favorites"
              :color="favoritesOnly ? 'primary' : 'neutral'"
              :variant="favoritesOnly ? 'soft' : 'ghost'"
              :aria-pressed="favoritesOnly"
              @click="favoritesOnly = true"
            />
          </div>
          <form class="flex gap-2" @submit.prevent="find">
            <UInput v-model="q" :maxlength="100" placeholder="Search stations" aria-label="Search radio stations" class="min-w-0 flex-1" />
            <UButton v-if="!favoritesOnly" type="submit" icon="i-lucide-search" :loading="loading" aria-label="Find stations" />
          </form>
          <div
            role="region"
            aria-label="Radio stations"
            :aria-busy="favoritesOnly ? favoritesLoading : loading"
            class="flex h-60 flex-col gap-1 overflow-y-auto"
          >
            <p v-if="!favoritesOnly && error" role="alert" class="text-error">{{ error }}</p>
            <p v-else-if="!favoritesOnly && searched && !stations.length" class="text-muted">No stations found. Try another search.</p>
            <p v-if="favoritesOnly && favoritesReady && !visibleStations.length" class="text-muted">
              {{ favorites.length ? 'No favorites match your search.' : 'No favorites yet. Star a station to save it.' }}
            </p>
            <div v-for="station in visibleStations" :key="station.id" class="flex shrink-0 items-center gap-1">
              <UButton
                color="neutral"
                variant="ghost"
                :icon="radio.station.value?.id === station.id ? 'i-lucide-radio' : 'i-lucide-play'"
                class="min-w-0 flex-1 justify-start"
                :disabled="'available' in station && station.available === false"
                :aria-label="`Play ${station.name} for everyone`"
                @click="radio.select(station.id)"
              >
                <span class="flex min-w-0 flex-col items-start">
                  <span class="w-full truncate text-left"><EmojiText :text="station.name" /></span>
                  <span class="text-xs font-normal text-muted"
                    ><EmojiText
                      :text="
                        'available' in station && station.available === null
                          ? 'Availability unknown'
                          : 'available' in station && station.available === false
                            ? 'Unavailable'
                            : `${station.country} · ${station.codec}`
                      "
                  /></span>
                </span>
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
          <a href="https://www.radio-browser.info/" target="_blank" rel="noopener noreferrer" class="text-xs text-primary hover:underline"
            >Stations from Radio Browser</a
          >
        </div>
      </template>
    </UPopover>
  </UFieldGroup>
</template>
