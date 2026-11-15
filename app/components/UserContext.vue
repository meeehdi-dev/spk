<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'

// Wraps anything that stands for a person (avatar, name, tile): the one user context menu of PLAN.md §10.
const props = defineProps<{ userId: string; disabled?: boolean; extra?: unknown[] }>()
const admin = useAdmin()
const items = computed(() => [...(props.extra?.length ? [props.extra] : []), ...admin.userGroups(props.userId)])
</script>

<template>
  <UContextMenu :items="items as ContextMenuItem[][]" :disabled="disabled || !items.length">
    <template #item-label="{ item }"><EmojiText :text="item.label ?? ''" /></template>
    <slot />
  </UContextMenu>
</template>
