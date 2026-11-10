<script setup lang="ts">
import type { PreviewDto } from '../../../server/db/messages'

const props = defineProps<{ messageId: string, preview: PreviewDto, canRemove: boolean }>()
const emit = defineEmits<{ remove: [url: string] }>()
const href = computed(() => safeHref(props.preview.url))
const host = computed(() => { try { return new URL(props.preview.url).hostname } catch { return '' } })
const image = computed(() => `/api/messages/${props.messageId}/preview-image?url=${encodeURIComponent(props.preview.url)}`)
const el = ref<HTMLElement>()
onMounted(() => {
  registerCtx(el.value, {
    kind: 'preview',
    items: () => [
      { label: 'Open link', icon: 'i-lucide-external-link', onSelect: () => window.open(props.preview.url, '_blank', 'noopener,noreferrer') },
      { label: 'Copy link', icon: 'i-lucide-copy', onSelect: () => copyText(props.preview.url) },
      ...(props.preview.title ? [{ label: 'Copy title', icon: 'i-lucide-copy', onSelect: () => copyText(props.preview.title!) }] : []),
      ...(props.canRemove ? [{ label: 'Remove preview', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => emit('remove', props.preview.url) }] : [])
    ]
  })
})
</script>

<template>
  <div v-if="href" ref="el" class="group/card relative mt-1 flex max-w-md flex-col overflow-hidden rounded-md border border-default border-l-4 border-l-primary bg-elevated/50">
    <a :href="href" target="_blank" rel="noopener noreferrer" class="flex flex-col gap-0.5 p-2 text-sm hover:bg-elevated">
      <span class="truncate text-xs text-muted">{{ preview.siteName || host }}</span>
      <span v-if="preview.title" class="line-clamp-2 font-bold text-primary">{{ preview.title }}</span>
      <span v-if="preview.description" class="line-clamp-3 text-xs text-toned">{{ preview.description }}</span>
      <img v-if="preview.image" :src="image" alt="" loading="lazy" class="mt-1 max-h-48 w-fit max-w-full rounded object-cover">
    </a>
    <UTooltip v-if="canRemove" text="Remove preview">
      <UButton
        class="absolute right-1 top-1 hidden group-hover/card:flex group-focus-within/card:flex" icon="i-lucide-x" size="xs" color="neutral" variant="soft"
        aria-label="Remove preview" @click="emit('remove', preview.url)"
      />
    </UTooltip>
  </div>
</template>
