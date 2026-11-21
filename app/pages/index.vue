<script setup lang="ts">
const { data: channels } = useChannels()
const first = channels.value.find(c => c.type === 'text')
if (first) await navigateTo(`/c/${first.id}`, { replace: true })
</script>

<template>
  <div class="flex h-full items-center justify-center rounded-tl-lg bg-(--ui-bg-panel) text-muted">No channels yet.</div>
</template>
