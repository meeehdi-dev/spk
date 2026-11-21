<script setup lang="ts">
const shown = ref(false)
const el = ref<HTMLElement>()
function reveal(event: Event) {
  if (shown.value) return
  event.preventDefault()
  event.stopPropagation()
  shown.value = true
}
onMounted(() => {
  registerCtx(el.value, {
    kind: 'spoiler',
    items: () => [
      {
        label: shown.value ? 'Hide' : 'Reveal',
        icon: shown.value ? 'i-lucide-eye-off' : 'i-lucide-eye',
        onSelect: () => {
          shown.value = !shown.value
        },
      },
    ],
  })
})
</script>

<template>
  <span
    ref="el"
    class="relative inline-block max-w-full overflow-hidden rounded bg-neutral-50 px-0.5 align-bottom dark:bg-neutral-700"
    :class="shown ? '' : 'min-w-5 cursor-pointer select-none'"
    :role="shown ? undefined : 'button'"
    :tabindex="shown ? undefined : 0"
    :aria-label="shown ? undefined : 'Spoiler: click to reveal'"
    :title="shown ? undefined : 'Spoiler: click to reveal'"
    @click.capture="reveal"
    @keydown.enter.capture="reveal"
    @keydown.space.capture="reveal"
  >
    <span :inert="!shown" :class="shown ? '' : 'pointer-events-none inline-block opacity-30 blur-xl'"><slot /></span>
    <span v-if="!shown" aria-hidden="true" class="pointer-events-none absolute inset-0 flex items-center justify-center bg-default/60">
      <UIcon name="i-lucide-eye" class="size-4 shrink-0" />
    </span>
  </span>
</template>
