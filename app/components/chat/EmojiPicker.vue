<script setup lang="ts">
const emit = defineEmits<{ pick: [emoji: string] }>()
const items = shallowRef<Awaited<ReturnType<typeof loadEmojiItems>>>([])
const loading = ref(true)
const failed = ref(false)
const input = { name: 'emoji-search', 'aria-label': 'Search emoji' }
const groups = computed(() => [
  {
    id: 'emoji',
    items: items.value.map(item => ({ ...item, label: item.name, onSelect: () => emit('pick', item.emoji) })),
  },
])

onMounted(async () => {
  try {
    items.value = await loadEmojiItems()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <UCommandPalette
    :groups="groups"
    :loading="loading"
    :fuse="{ fuseOptions: { keys: ['name', 'shortcodes', 'tags'] }, resultLimit: 100 }"
    :input="input"
    :autofocus="true"
    placeholder="Search emoji…"
    class="max-h-[min(24rem,var(--reka-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)]"
  >
    <template #item-leading="{ item }">
      <span aria-hidden="true" class="size-5 shrink-0 text-center text-lg/5">{{ item.emoji }}</span>
    </template>
    <template #empty>
      <p role="status">{{ loading ? 'Loading emoji…' : failed ? 'Could not load emoji.' : 'No emoji found.' }}</p>
    </template>
  </UCommandPalette>
</template>
