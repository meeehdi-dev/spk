<script setup lang="ts">
import type { SearchResult, SearchHit } from '../../server/db/search'
import { activeFilter, HAS_VALUES } from '#shared/utils/searchQuery'

/** `external`: the input lives in the top bar (`#search-input`), so the panel shows no input of its own. */
const props = defineProps<{ external?: boolean }>()
const search = useSearch()
const route = useRoute()
const { data: channels } = useChannels()
const label = useChannelLabel()
const { data: users, byId, nameOf } = useUsers()
const toast = useToast()

const inChannel = computed(() => route.path.startsWith('/c/') ? String(route.params.channelId) : '')
const scopes = computed(() => [
  ...(inChannel.value ? [{ label: 'This channel', value: 'channel' }] : []),
  { label: 'All channels', value: 'channels' }, { label: 'DMs', value: 'dms' }, { label: 'Everything', value: 'everything' }
])
const input = ref<{ inputRef?: HTMLInputElement }>()
const results = ref<SearchHit[]>([])
const next = ref<string | null>(null)
const loading = ref(false)
const searched = ref(false)
const active = ref(0)
let seq = 0

async function run(more = false) {
  const my = ++seq
  if (!search.q.trim()) { results.value = []; next.value = null; searched.value = false; loading.value = false; return }
  loading.value = true
  try {
    const scope = search.scope === 'channel' && !inChannel.value ? 'channels' : search.scope
    const r = await $fetch<SearchResult>('/api/search', { query: { q: search.q, scope, channelId: inChannel.value || undefined, cursor: more ? next.value ?? undefined : undefined } })
    if (my !== seq) return
    results.value = more ? [...results.value, ...r.results] : r.results
    next.value = r.nextCursor
    searched.value = true
    if (!more) active.value = 0
  } catch (e: any) {
    if (my === seq) toast.add({ title: errorText(e, 'Search failed'), color: 'error', icon: 'i-lucide-circle-alert' })
  } finally { if (my === seq) loading.value = false }
}
const debounced = useDebounceFn(() => run(), 250)
watch(() => [search.q, search.scope, inChannel.value], debounced)

// Autocomplete for the filter value being typed at the end of the box.
const filter = computed(() => activeFilter(search.q))
const suggestions = computed(() => {
  const f = filter.value
  if (!f) return []
  const v = f.value.toLowerCase().replace(/^[@#]/, '')
  const pool = f.key === 'in' ? channels.value.filter(c => c.type === 'text').map(c => c.name!)
    : f.key === 'has' ? [...HAS_VALUES] : users.value.map(u => u.displayName).filter((n): n is string => !!n)
  return pool.filter(n => n.toLowerCase().startsWith(v) && n.toLowerCase() !== v).slice(0, 6)
})
function pick(name: string) {
  const f = filter.value!
  search.q = search.q.slice(0, f.start) + (/\s/.test(name) ? `"${name}"` : name) + ' '
  focusInput()
}

const focusInput = () => (props.external ? document.getElementById('search-input') : input.value?.inputRef)?.focus()

function onKey(e: KeyboardEvent) {
  const n = suggestions.value.length || results.value.length
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (n) active.value = (active.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (suggestions.value.length) pick(suggestions.value[active.value] ?? suggestions.value[0]!)
    else if (results.value[active.value]) jump(results.value[active.value]!)
  }
}
watch(suggestions, () => { active.value = 0 })
defineExpose({ onKey })

const jump = (h: SearchHit) => navigateTo(`/c/${h.channelId}/m/${h.messageId}`)
const link = (h: SearchHit) => `${location.origin}/c/${h.channelId}/m/${h.messageId}`
const channelName = (id: string) => label(channels.value.find(c => c.id === id))
const menu = (h: SearchHit) => [
  { label: 'Jump to message', icon: 'i-lucide-corner-down-right', onSelect: () => jump(h) },
  { label: 'Copy link', icon: 'i-lucide-link', onSelect: () => copyText(link(h)) },
  { label: 'Copy text', icon: 'i-lucide-copy', onSelect: () => copyText(previewText(h.text, nameOf)) }
]

// Highlighted snippet -> [{ text, mark }]; mentions as names, spoilers hidden.
function parts(h: SearchHit) {
  return previewText(h.snippet, nameOf).split(/(\u0001[^\u0002]*\u0002)/).filter(Boolean)
    .map(s => s.startsWith('\u0001') ? { text: s.slice(1, -1), mark: true } : { text: s, mark: false })
}

watch(() => search.open, (o) => { if (o) nextTick(focusInput) })
watch(() => search.focusTick, () => nextTick(focusInput))
</script>

<template>
  <aside class="flex h-full w-full flex-col bg-default" aria-label="Search">
    <div class="flex items-center gap-2 border-b border-default p-2" :class="external ? 'justify-between' : ''">
      <span v-if="external" class="text-sm font-medium">Search</span>
      <UInput
        v-if="!external" ref="input" v-model="search.q" icon="i-lucide-search" class="flex-1" placeholder="Search… from: in: has: before:"
        aria-label="Search messages" :loading="loading" @keydown="onKey" @keydown.esc.stop="search.close()"
      />
      <UTooltip text="Close search (Esc)">
        <UButton icon="i-lucide-x" color="neutral" variant="ghost" aria-label="Close search" @click="search.close()" />
      </UTooltip>
    </div>
    <div class="border-b border-default p-2">
      <USelect v-model="search.scope" :items="scopes" size="sm" class="w-full" aria-label="Search scope" />
    </div>
    <ul v-if="suggestions.length" class="border-b border-default p-1" role="listbox" aria-label="Suggestions">
      <li v-for="(s, i) in suggestions" :key="s">
        <UButton :label="s" color="neutral" :variant="i === active ? 'soft' : 'ghost'" block class="justify-start" role="option" @click="pick(s)" />
      </li>
    </ul>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <p v-if="searched && !results.length && !loading" class="p-4 text-center text-sm text-muted">No results</p>
      <p v-else-if="!searched" class="p-4 text-sm text-muted">
        Words match as prefixes. Filters: <code>from:</code> <code>mentions:</code> <code>in:</code> <code>has:file|image|link</code> <code>before:2026-11-01</code> <code>after:2026-10-01</code>
      </p>
      <ul v-if="!suggestions.length" role="listbox" aria-label="Results">
        <li v-for="(h, i) in results" :key="h.messageId">
          <UContextMenu :items="menu(h)">
            <button
              type="button" role="option" :aria-selected="i === active" class="block w-full border-b border-default px-3 py-2 text-left text-sm hover:bg-elevated"
              :class="i === active ? 'bg-elevated' : ''" @click="jump(h)"
            >
              <div class="flex items-center gap-2 text-xs text-muted">
                <UAvatar :src="avatarSrc(byId.get(h.userId))" :alt="nameOf(h.userId)" size="3xs" />
                <span class="font-bold text-default">{{ nameOf(h.userId) }}</span>
                <span class="truncate">{{ channelName(h.channelId) }}</span>
                <span class="ml-auto shrink-0" :title="exactTime(h.createdAt)">{{ relativeTime(h.createdAt) }}</span>
              </div>
              <div class="mt-1 line-clamp-3 break-words">
                <template v-for="(p, j) in parts(h)" :key="j"><mark v-if="p.mark" class="rounded bg-primary/30 text-inherit">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template>
                <span v-if="h.attachments" class="ml-1 inline-flex items-center gap-1 text-muted"><UIcon name="i-lucide-paperclip" class="size-3" />{{ h.attachments }}</span>
              </div>
            </button>
          </UContextMenu>
        </li>
      </ul>
      <div v-if="next && !suggestions.length" class="p-2">
        <UButton label="Load more" color="neutral" variant="soft" block :loading="loading" @click="run(true)" />
      </div>
    </div>
  </aside>
</template>
