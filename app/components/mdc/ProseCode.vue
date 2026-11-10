<script setup lang="ts">
const el = ref<HTMLElement>()
onMounted(() => {
  if (el.value?.parentElement?.tagName === 'PRE') return
  registerCtx(el.value, { kind: 'inline-code', items: () => [{ label: 'Copy', icon: 'i-lucide-copy', onSelect: () => copyText(el.value?.textContent ?? '') }] })
})
</script>

<template>
  <code ref="el" class="rounded bg-elevated px-1 py-0.5 text-[0.9em]"><slot /></code>
</template>
