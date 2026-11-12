<script setup lang="ts">
import type { ReactionDto } from '../../../server/db/messages'

const props = defineProps<{ reaction: ReactionDto; mine: boolean }>()
const emit = defineEmits<{ toggle: []; who: [] }>()
const { nameOf } = useUsers()
const el = ref<HTMLElement>()
const names = computed(() => props.reaction.userIds.map(nameOf).join(', '))
onMounted(() => {
  registerCtx(el.value, {
    kind: 'reaction',
    items: () => [{ label: 'See who reacted', icon: 'i-lucide-users', onSelect: () => emit('who') }],
  })
})
</script>

<template>
  <button
    ref="el"
    type="button"
    :title="names"
    :aria-pressed="mine"
    :aria-label="`${reaction.emoji} ${reaction.userIds.length}, ${mine ? 'remove your reaction' : 'react'}`"
    class="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition hover:bg-elevated"
    :class="mine ? 'border-primary/40 bg-primary/10' : 'border-default/60'"
    @click="emit('toggle')"
  >
    <span class="text-base leading-none">{{ reaction.emoji }}</span><span>{{ reaction.userIds.length }}</span>
  </button>
</template>
