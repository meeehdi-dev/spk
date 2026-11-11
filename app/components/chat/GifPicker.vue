<script setup lang="ts">
import type { GifItem } from '../../../server/utils/klipy'

const emit = defineEmits<{ pick: [url: string] }>()
const q = ref('')
const items = ref<GifItem[]>([])
const page = ref(1)
const hasNext = ref(false)
const loading = ref(false)
const error = ref('')

async function load(more = false) {
  loading.value = true
  error.value = ''
  const p = more ? page.value + 1 : 1
  try {
    const r = await $fetch<{ items: GifItem[]; hasNext: boolean }>('/api/gifs', { query: { q: q.value.trim(), page: p } })
    items.value = more ? [...items.value, ...r.items] : r.items
    page.value = p
    hasNext.value = r.hasNext
  } catch (cause) {
    const e = cause as { statusMessage?: string; message?: string; data?: { statusMessage?: string } } | null
    error.value = e?.statusMessage || 'Could not load GIFs'
  } finally {
    loading.value = false
  }
}
onMounted(() => load())
watchDebounced(q, () => load(), { debounce: 350 })
</script>

<template>
  <div class="flex h-96 w-80 flex-col gap-2 p-2">
    <UInput v-model="q" icon="i-lucide-search" placeholder="Search KLIPY" aria-label="Search GIFs" autofocus />
    <div class="min-h-0 flex-1 overflow-y-auto">
      <p v-if="error" class="p-2 text-sm text-error">
        {{ error }}
      </p>
      <p v-else-if="!loading && !items.length" class="p-2 text-sm text-muted">No GIFs found</p>
      <div class="grid grid-cols-2 gap-1">
        <button
          v-for="g in items"
          :key="g.id"
          type="button"
          class="overflow-hidden rounded bg-elevated hover:ring-2 hover:ring-primary"
          :aria-label="g.title || 'GIF'"
          @click="emit('pick', g.url)"
        >
          <img :src="g.preview" :alt="g.title" loading="lazy" class="w-full object-cover" />
        </button>
      </div>
      <UButton v-if="hasNext" label="Load more" size="xs" color="neutral" variant="soft" block class="mt-1" :loading="loading" @click="load(true)" />
    </div>
    <p class="text-center text-[10px] text-dimmed">Powered by KLIPY</p>
  </div>
</template>
