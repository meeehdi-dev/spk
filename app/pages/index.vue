<script setup lang="ts">
const { data: channels } = useChannels()
const first = channels.value.find(c => c.type === 'text')
if (first) await navigateTo(`/c/${first.id}`, { replace: true })
</script>

<template>
  <div class="flex h-full items-center justify-center text-muted">No channels yet.</div>
</template>
