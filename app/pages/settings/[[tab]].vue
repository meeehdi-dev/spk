<script setup lang="ts">
// Settings is a modal: auth.global.ts opens it for these deep links. If the page still renders (first load), show the app behind it.
onMounted(() => navigateTo('/', { replace: true }))
</script>

<template>
  <div />
</template>
