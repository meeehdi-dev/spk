<script setup lang="ts">
import type { PinDto } from '../../../server/db/pins'

const props = defineProps<{ pins: PinDto[]; canPin: boolean }>()
const actions = inject(chatActionsKey)!
const { nameOf } = useUsers()

const root = ref<HTMLElement>()
const latestButton = ref<HTMLButtonElement>()
const open = ref(false)
const all = ref(false) // the +N list instead of the latest pin only
const expandedId = ref<string | null>(null) // in the +N list; the latest-pin view always shows its pin expanded
const latest = computed(() => props.pins[0])
const visible = computed(() => (all.value ? props.pins : props.pins.slice(0, 1)))
const text = (p: PinDto) => previewText(p.body, nameOf) || (p.attachments.length ? `${p.attachments.length} attachment(s)` : '')

function close() {
  open.value = false
  all.value = false
  expandedId.value = null
}
function toggleLatest() {
  if (open.value && !all.value) return close()
  open.value = true
  all.value = false
  expandedId.value = null
}
function toggleAll() {
  if (open.value && all.value) return close()
  open.value = true
  all.value = true
  expandedId.value = null
}
// Esc only belongs to the bar while it is open; otherwise the channel view's Esc (clear the divider) must still run.
function onEsc(e: KeyboardEvent) {
  if (!open.value) return
  e.stopPropagation()
  close()
  latestButton.value?.focus()
}
function goTo(id: string) {
  close()
  actions.jump(id)
}
// A pin that disappears (unpinned, deleted) can't stay expanded; an empty list closes the panel.
watch(
  () => props.pins.map(p => p.id),
  ids => {
    if (!ids.length) close()
    else if (expandedId.value && !ids.includes(expandedId.value)) expandedId.value = null
  },
)
onClickOutside(root, close)
</script>

<template>
  <div v-if="latest" ref="root" class="relative z-20 shrink-0 border-b border-default bg-default" @keydown.esc="onEsc">
    <div class="flex h-9 items-center gap-2 px-4 text-sm">
      <UIcon name="i-lucide-pin" class="size-4 shrink-0 text-primary" />
      <button
        ref="latestButton"
        type="button"
        class="flex min-w-0 flex-1 items-baseline gap-2 text-left hover:text-highlighted"
        :aria-expanded="open && !all"
        title="Show the latest pinned message"
        @click="toggleLatest"
      >
        <b class="shrink-0"><EmojiText :text="nameOf(latest.userId)" /></b>
        <span class="truncate text-muted"><EmojiText :text="text(latest)" /></span>
      </button>
      <UButton
        v-if="pins.length > 1"
        :label="open && all ? 'Close' : `+${pins.length - 1}`"
        color="neutral"
        variant="soft"
        size="xs"
        :aria-label="open && all ? 'Close pinned messages' : `Show all ${pins.length} pinned messages`"
        :aria-expanded="open && all"
        @click="toggleAll"
      />
    </div>
    <div v-if="open" class="absolute inset-x-0 top-full max-h-[60vh] overflow-y-auto border-b border-default bg-default shadow-md">
      <div v-for="p in visible" :key="p.id" class="border-t border-default px-4 py-2 text-sm compact:py-1">
        <button
          v-if="all"
          type="button"
          class="flex w-full min-w-0 items-baseline gap-2 text-left hover:text-highlighted"
          :aria-expanded="expandedId === p.id"
          @click="expandedId = expandedId === p.id ? null : p.id"
        >
          <b class="shrink-0"><EmojiText :text="nameOf(p.userId)" /></b>
          <span v-if="expandedId !== p.id" class="truncate text-muted"><EmojiText :text="text(p)" /></span>
          <span class="ml-auto shrink-0 text-xs text-muted">{{ exactTime(p.createdAt) }}</span>
        </button>
        <template v-if="!all || expandedId === p.id">
          <div class="mt-1 max-h-48 overflow-y-auto break-words whitespace-pre-wrap"><EmojiText :text="text(p)" /></div>
          <div class="mt-2 flex items-center gap-1">
            <UButton label="Go to message" icon="i-lucide-arrow-right" size="xs" variant="soft" @click="goTo(p.id)" />
            <UButton v-if="canPin" label="Unpin" icon="i-lucide-pin-off" size="xs" color="neutral" variant="ghost" @click="actions.pin(p.id, false)" />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
