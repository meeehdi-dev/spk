<script setup lang="ts">
const shown = ref(false)
const el = ref<HTMLElement>()
onMounted(() => {
  registerCtx(el.value, {
    kind: 'spoiler',
    items: () => [{ label: shown.value ? 'Hide' : 'Reveal', icon: shown.value ? 'i-lucide-eye-off' : 'i-lucide-eye', onSelect: () => { shown.value = !shown.value } }],
  })
})
</script>

<template>
  <span
    ref="el"
    class="cursor-pointer rounded bg-elevated px-0.5 transition"
    :class="shown ? '' : 'blur-sm select-none'"
    :title="shown ? undefined : 'Spoiler: click to reveal'"
    @click="shown = !shown"
  ><slot /></span>
</template>
