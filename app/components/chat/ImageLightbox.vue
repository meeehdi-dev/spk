<script setup lang="ts">
import type { AttachmentDto } from '../../../server/db/messages'

const props = defineProps<{ file: AttachmentDto | string | null }>()
const emit = defineEmits<{ close: [] }>()
const open = computed({
  get: () => !!props.file,
  set: v => {
    if (!v) emit('close')
  },
})
const src = computed(() => (typeof props.file === 'string' ? (safeHref(props.file) ?? '') : props.file ? `/api/attachments/${props.file.id}` : ''))
const filename = computed(() => (typeof props.file === 'string' ? 'Image' : (props.file?.filename ?? 'Image')))
let trigger: HTMLElement | null = null
watch(open, value => {
  if (value) trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
})
function restoreFocus(event: Event) {
  if (!trigger?.isConnected) return
  event.preventDefault()
  trigger.focus()
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="filename"
    :content="{ onCloseAutoFocus: restoreFocus }"
    :ui="{ content: 'w-auto max-w-[95vw]', body: 'p-2 compact:p-2 compact:sm:p-2' }"
  >
    <template #title><EmojiText :text="filename" /></template>
    <template #body>
      <img v-if="src" :src="src" :alt="filename" referrerpolicy="no-referrer" class="mx-auto max-h-[80vh] max-w-full object-contain" />
    </template>
    <template #footer>
      <UButton label="Open original" icon="i-lucide-external-link" color="neutral" variant="soft" :href="src" target="_blank" rel="noopener noreferrer" />
      <UButton v-if="typeof file === 'string'" label="Download" icon="i-lucide-download" color="neutral" variant="soft" @click="saveImage(src, 'image')" />
      <UButton v-else label="Download" icon="i-lucide-download" color="neutral" variant="soft" :href="`${src}?download=1`" external />
    </template>
  </UModal>
</template>
