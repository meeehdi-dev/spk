<script setup lang="ts">
const toast = useToast()
const root = useTemplateRef('root')
const commits = shallowRef<{ sha: string; message: string; date: string }[]>([])
const page = ref<number | null>(1)
const head = ref<string>()
const loading = ref(false)
const failed = ref(false)
const sorted = computed(() => commits.value.toSorted((a, b) => b.date.localeCompare(a.date)))
const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' })
const commitUrl = (sha: string) => `https://github.com/meeehdi-dev/spk/commit/${sha}`

async function loadMore() {
  if (loading.value || page.value === null) return
  loading.value = true
  failed.value = false
  try {
    const data = await $fetch('/api/changelog', { query: { page: page.value, head: head.value }, retry: 0 })
    const seen = new Set(commits.value.map(commit => commit.sha))
    commits.value = [...commits.value, ...data.commits.filter(commit => !seen.has(commit.sha))]
    head.value = data.head ?? undefined
    page.value = data.nextPage
  } catch {
    failed.value = true
    toast.add({ title: 'Changelog is unavailable. Try again later.', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    loading.value = false
  }
}

useInfiniteScroll(() => root.value?.parentElement, loadMore, {
  distance: 200,
  canLoadMore: () => page.value !== null && !loading.value && !failed.value,
})
onMounted(loadMore)
</script>

<template>
  <div ref="root" class="space-y-6">
    <h2 class="text-lg font-semibold">Changelog</h2>
    <ul class="space-y-2">
      <li v-for="(entry, index) in sorted" :key="entry.sha">
        <h3 v-if="index === 0 || sorted[index - 1]?.date !== entry.date" class="pt-4 pb-3 text-sm font-semibold text-muted">
          <time :datetime="entry.date">{{ dateFormat.format(new Date(entry.date)) }}</time>
        </h3>
        <div class="flex items-baseline gap-3 text-sm">
          <ULink :to="commitUrl(entry.sha)" target="_blank" rel="noopener noreferrer" class="shrink-0 font-mono text-primary">
            {{ entry.sha.slice(0, 7) }}
          </ULink>
          <span class="min-w-0 wrap-anywhere"><EmojiText :text="entry.message" /></span>
        </div>
      </li>
    </ul>
    <div role="status" class="flex min-h-8 items-center text-sm text-muted">
      <p v-if="page === null">{{ commits.length ? 'End of commit history.' : 'No commits yet.' }}</p>
      <UButton
        v-else
        :label="loading ? 'Loading commits…' : failed ? 'Retry' : 'Load more'"
        :loading="loading"
        color="neutral"
        variant="outline"
        @click="loadMore"
      />
    </div>
  </div>
</template>
