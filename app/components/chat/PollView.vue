<script setup lang="ts">
import type { PollDto } from '../../../server/db/messages'

const props = defineProps<{ messageId: string; poll: PollDto }>()
const actions = inject(chatActionsKey)!
const { data: me } = useMe()
const total = computed(() => props.poll.options.reduce((n, o) => n + o.userIds.length, 0))
const pct = (n: number) => (total.value ? Math.round((n / total.value) * 100) : 0)
const plural = (n: number) => `${n} ${n === 1 ? 'vote' : 'votes'}`
const mine = (o: PollDto['options'][number]) => !!me.value && o.userIds.includes(me.value.id)
</script>

<template>
  <div class="mt-1 flex max-w-md flex-col gap-1">
    <button
      v-for="o in poll.options"
      :key="o.id"
      type="button"
      :aria-pressed="mine(o)"
      :aria-label="`${o.label}, ${plural(o.userIds.length)}, ${pct(o.userIds.length)}%`"
      class="relative flex items-center justify-between gap-3 overflow-hidden rounded-md border px-3 py-1.5 text-left text-sm text-default"
      :class="mine(o) ? 'border-primary/40 bg-primary/5' : 'border-default bg-elevated hover:bg-accented'"
      @click="actions.vote(messageId, mine(o) ? null : o.id)"
    >
      <span
        aria-hidden="true"
        class="absolute inset-y-0 left-0 transition-[width] motion-reduce:transition-none"
        :class="mine(o) ? 'bg-primary/20' : 'bg-accented'"
        :style="{ width: `${pct(o.userIds.length)}%` }"
      />
      <span class="relative flex min-w-0 items-center gap-1.5">
        <UIcon v-if="mine(o)" name="i-lucide-check" aria-hidden="true" class="size-4 shrink-0 text-primary" />
        <span class="truncate">{{ o.label }}</span>
      </span>
      <span class="relative shrink-0 text-xs text-muted" aria-hidden="true">{{ o.userIds.length }} · {{ pct(o.userIds.length) }}%</span>
    </button>
    <span class="text-xs text-muted">{{ plural(total) }}</span>
  </div>
</template>
