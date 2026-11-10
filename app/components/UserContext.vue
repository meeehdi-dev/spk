<script setup lang="ts">
// Wraps anything that stands for a person (avatar, name, tile): the one user context menu of PLAN.md §10.
const props = defineProps<{ userId: string, disabled?: boolean }>()
const admin = useAdmin()
const items = computed(() => admin.userGroups(props.userId))
</script>

<template>
  <UContextMenu :items="items as never" :disabled="disabled || !items.length">
    <slot />
  </UContextMenu>
</template>
