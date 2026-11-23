<script setup lang="ts">
import type { GifItem } from '#shared/utils/gifs'

const emit = defineEmits<{ pick: [url: string] }>()
const tab = ref('browse')
const q = ref('')
const items = ref<GifItem[]>([])
const favorites = ref<GifItem[]>([])
const favoritesLoading = ref(false)
const favoritesReady = ref(false)
const favoritesError = ref('')
const mutationError = ref('')
const saving = ref<string[]>([])
const page = ref(1)
const hasNext = ref(false)
const loading = ref(false)
const error = ref('')
let request = 0
let favoritesRequest = 0
let active = true
const visibleItems = computed(() =>
  tab.value === 'favorites' ? favorites.value.filter(g => g.title.toLowerCase().includes(q.value.trim().toLowerCase())) : items.value,
)
const isFavorite = (id: string) => favorites.value.some(g => g.id === id)

async function load(more = false) {
  if (!active || tab.value !== 'browse' || (more && (loading.value || !hasNext.value))) return
  const current = ++request
  loading.value = true
  error.value = ''
  const p = more ? page.value + 1 : 1
  try {
    const r = await $fetch<{ items: GifItem[]; hasNext: boolean }>('/api/gifs', { query: { q: q.value.trim(), page: p } })
    if (current !== request) return
    items.value = more ? [...items.value, ...r.items] : r.items
    page.value = p
    hasNext.value = r.hasNext
  } catch (e) {
    if (current === request) error.value = errorText(e, 'Could not load GIFs')
  } finally {
    if (current === request) loading.value = false
  }
}

async function loadFavorites() {
  if (!active || saving.value.length) return
  const current = ++favoritesRequest
  favoritesLoading.value = true
  favoritesReady.value = false
  favoritesError.value = ''
  try {
    const results = await $fetch<GifItem[]>('/api/gifs/favorites')
    if (current !== favoritesRequest) return
    favorites.value = results
    favoritesReady.value = true
  } catch (e) {
    if (current === favoritesRequest) favoritesError.value = errorText(e, 'Could not load favorites')
  } finally {
    if (current === favoritesRequest) favoritesLoading.value = false
  }
}

async function toggleFavorite(gif: GifItem) {
  if (!active || !favoritesReady.value || saving.value.includes(gif.id)) return
  saving.value.push(gif.id)
  mutationError.value = ''
  try {
    if (isFavorite(gif.id)) {
      await $fetch(`/api/gifs/favorites/${encodeURIComponent(gif.id)}`, { method: 'DELETE' })
      if (active) favorites.value = favorites.value.filter(g => g.id !== gif.id)
    } else {
      const saved = await $fetch<GifItem>(`/api/gifs/favorites/${encodeURIComponent(gif.id)}`, { method: 'PUT', body: gif })
      if (active) favorites.value = [...favorites.value, saved].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    }
  } catch (e) {
    if (active) mutationError.value = errorText(e, 'Could not update favorites')
  } finally {
    if (active) saving.value = saving.value.filter(id => id !== gif.id)
  }
}

onMounted(() => {
  void load()
  void loadFavorites()
})
watch(
  [q, tab],
  () => {
    request++
    loading.value = false
    hasNext.value = false
    items.value = []
    error.value = ''
  },
  { flush: 'sync' },
)
watch(tab, () => {
  if (tab.value === 'browse') void load()
})
watchDebounced(
  q,
  () => {
    if (tab.value === 'browse') void load()
  },
  { debounce: 350 },
)
onBeforeUnmount(() => {
  active = false
  request++
  favoritesRequest++
})
</script>

<template>
  <div class="flex h-96 w-80 flex-col gap-2 p-2">
    <UTabs
      v-model="tab"
      :items="[
        { label: 'Browse', value: 'browse' },
        { label: 'Favorites', value: 'favorites' },
      ]"
      class="min-h-0 flex-1"
      :ui="{ content: 'flex min-h-0 flex-1 flex-col gap-2' }"
    >
      <template #content>
        <UInput
          v-model="q"
          icon="i-lucide-search"
          :placeholder="tab === 'favorites' ? 'Search favorites' : 'Search KLIPY'"
          aria-label="Search GIFs"
          autofocus
        />
        <div v-if="favoritesError" role="alert" class="text-sm text-error">
          {{ favoritesError }}
          <UButton label="Retry favorites" color="neutral" variant="link" @click="loadFavorites" />
        </div>
        <p v-if="mutationError" role="alert" class="text-sm text-error">{{ mutationError }}</p>
        <div class="min-h-0 flex-1 overflow-y-auto" :aria-busy="tab === 'favorites' ? favoritesLoading : loading">
          <p v-if="tab === 'browse' && error" role="alert" class="p-2 text-sm text-error">
            {{ error }}
            <UButton label="Retry GIFs" color="neutral" variant="link" @click="load()" />
          </p>
          <p v-if="tab === 'favorites' ? favoritesLoading : loading" role="status" class="p-2 text-sm text-muted">Loading GIFs…</p>
          <p v-else-if="!visibleItems.length && (tab === 'favorites' ? favoritesReady : !error)" class="p-2 text-sm text-muted">
            {{ tab === 'browse' ? 'No GIFs found' : favorites.length ? 'No favorites match your search.' : 'No favorites yet. Star a GIF to save it.' }}
          </p>
          <div class="grid grid-cols-2 gap-1">
            <div v-for="g in visibleItems" :key="g.id" class="relative">
              <button
                type="button"
                class="w-full overflow-hidden rounded bg-(--ui-bg-panel) hover:ring-2 hover:ring-primary"
                :aria-label="g.title || 'GIF'"
                @click="emit('pick', g.url)"
              >
                <img :src="g.preview" :alt="g.title" loading="lazy" class="w-full object-cover" />
              </button>
              <UButton
                type="button"
                icon="i-lucide-star"
                :color="isFavorite(g.id) ? 'warning' : 'neutral'"
                variant="solid"
                size="xs"
                class="absolute top-1 right-1"
                :disabled="!favoritesReady"
                :loading="saving.includes(g.id)"
                :aria-pressed="isFavorite(g.id)"
                :aria-label="`${isFavorite(g.id) ? 'Remove' : 'Add'} ${g.title || 'GIF'} ${isFavorite(g.id) ? 'from' : 'to'} favorites`"
                @click="toggleFavorite(g)"
              />
            </div>
          </div>
          <UButton
            v-if="tab === 'browse' && hasNext"
            label="Load more"
            color="neutral"
            variant="soft"
            block
            class="mt-1"
            :loading="loading"
            @click="load(true)"
          />
        </div>
      </template>
    </UTabs>
    <p class="text-center text-[10px] text-dimmed">Powered by KLIPY</p>
  </div>
</template>
