<script setup lang="ts">
const props = defineProps<{ href?: string, plain?: boolean }>()
const href = computed(() => safeHref(props.href))
const el = ref<HTMLElement>()
const text = () => el.value?.textContent ?? ''
const gif = computed(() => !props.plain && !!href.value && isImageUrl(href.value))
const failed = ref(false)
onMounted(() => {
  if (!href.value) return
  if (gif.value) {
    registerCtx(el.value, {
      kind: 'gif',
      items: () => [
        { label: 'Open', icon: 'i-lucide-external-link', onSelect: () => window.open(href.value!, '_blank', 'noopener,noreferrer') },
        { label: 'Copy image', icon: 'i-lucide-image', onSelect: () => copyImage(href.value!) },
        { label: 'Save', icon: 'i-lucide-download', onSelect: () => saveImage(href.value!, 'image.gif') },
        { label: 'Copy image link', icon: 'i-lucide-link', onSelect: () => copyText(href.value!) }
      ]
    })
    return
  }
  registerCtx(el.value, {
    kind: 'link',
    items: () => [
      { label: 'Open in new tab', icon: 'i-lucide-external-link', onSelect: () => window.open(href.value!, '_blank', 'noopener,noreferrer') },
      { label: 'Copy link', icon: 'i-lucide-copy', onSelect: () => copyText(href.value!) },
      { label: 'Copy link text', icon: 'i-lucide-copy', onSelect: () => copyText(text()) }
    ]
  })
})
</script>

<template>
  <ChatInternalLink v-if="href && isInternalLink(href)" :href="href" />
  <a v-else-if="href && gif && !failed" ref="el" :href="href" target="_blank" rel="noopener noreferrer" class="block w-fit">
    <img :src="href" alt="Image" loading="lazy" referrerpolicy="no-referrer" class="max-h-[300px] max-w-[min(100%,400px)] rounded-md border border-default" @error="failed = true">
  </a>
  <a v-else-if="href" ref="el" :href="href" target="_blank" rel="noopener noreferrer" class="text-primary underline underline-offset-2 break-all"><slot /></a>
  <span v-else><slot /></span>
</template>
