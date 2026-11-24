<script setup lang="ts">
// Lucide icon picker. The model is the icon name without the `i-lucide-` prefix; class and aria-label fall through to the menu.
const model = defineModel<string>({ required: true })

// Loaded on mount so the icon set stays out of the main bundle (aliases left out).
const items = ref<Array<{ label: string; value: string; icon: string }>>([])
onMounted(async () => {
  const set = (await import('@iconify-json/lucide/icons.json')).default as { icons: Record<string, unknown> }
  items.value = Object.keys(set.icons).map(n => ({ label: n, value: n, icon: `i-lucide-${n}` }))
})
</script>

<template>
  <USelectMenu v-model="model" :items="items" value-key="value" :icon="`i-lucide-${model}`" virtualize />
</template>
