<script setup lang="ts">
const ctx = inject(messageCtxKey, null)
const el = ref<HTMLElement>()
const { copy, copied } = useClipboard({ copiedDuring: 1500 })
const text = () => (el.value?.innerText ?? '').trim()
onMounted(() => {
  registerCtx(el.value, {
    kind: 'quote',
    items: () => [
      { label: 'Copy quote', icon: 'i-lucide-copy', onSelect: () => copyText(text()) },
      { label: 'Quote this', icon: 'i-lucide-quote', onSelect: () => ctx?.quote(text()) }
    ]
  })
})
</script>

<template>
  <blockquote ref="el" class="group/q relative my-1 border-s-4 border-accented ps-3 pe-8 text-muted">
    <slot />
    <UButton
      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" color="neutral" variant="ghost" size="xs" aria-label="Copy quote"
      class="absolute end-0 top-0 opacity-0 group-hover/q:opacity-100 focus-visible:opacity-100"
      @click="copy(text())"
    />
  </blockquote>
</template>
