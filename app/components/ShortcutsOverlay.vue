<script setup lang="ts">
const open = useShortcutsOverlay()
</script>

<template>
  <UModal
    v-model:open="open"
    title="Keyboard shortcuts"
    description="Every shortcut in the app"
  >
    <template #body>
      <ShortcutList />
    </template>
  </UModal>
</template>
