<script setup lang="ts">
import type { AttachmentDto } from '../../../server/db/messages'

const props = defineProps<{ file: AttachmentDto | null }>()
const emit = defineEmits<{ close: [] }>()
const open = computed({ get: () => !!props.file, set: (v) => {
  if (!v)
    emit('close')
} })
const src = computed(() => props.file ? `/api/attachments/${props.file.id}` : '')
</script>

<template>
  <UModal
    v-model:open="open"
    :title="file?.filename ?? 'Image'"
    :ui="{ content: 'max-w-[95vw] w-auto', body: 'p-2' }"
  >
    <template #body>
      <img
        v-if="file"
        :src="src"
        :alt="file.filename"
        class="mx-auto max-h-[80vh] max-w-full object-contain"
      >
    </template>
    <template #footer>
      <UButton
        label="Open original"
        icon="i-lucide-external-link"
        color="neutral"
        variant="soft"
        :href="src"
        target="_blank"
        rel="noopener"
      />
      <UButton
        label="Download"
        icon="i-lucide-download"
        color="neutral"
        variant="soft"
        :href="`${src}?download=1`"
      />
    </template>
  </UModal>
</template>
