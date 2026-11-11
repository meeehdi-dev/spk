<script setup lang="ts">
import type { AttachmentDto } from '../../../server/db/messages'

import { TEXT_PREVIEW_RANGE } from '../../../shared/utils/files'

const props = defineProps<{ file: AttachmentDto }>()
const emit = defineEmits<{ open: [file: AttachmentDto] }>()
const src = computed(() => `/api/attachments/${props.file.id}`)
const kind = computed(() =>
  props.file.mime.startsWith('image/') ? 'image' : props.file.mime.startsWith('video/') ? 'video' : props.file.mime.startsWith('audio/') ? 'audio' : 'file',
)
const revealed = ref(!props.file.spoiler)
const lang = computed(() => previewLanguage(props.file.filename, props.file.size))

// Text/code preview: first 64 KB through a Range request, rendered like a code block.
const text = ref<string>()
const truncated = ref(false)
const fullLoaded = ref(false)
const visible = ref(25)
const html = ref('')
const failed = ref(false)

async function loadText(all = false) {
  try {
    const { url } = await $fetch<{ url: string }>(src.value, { query: { json: 1 } })
    const res = await fetch(url, all ? undefined : { headers: { Range: `bytes=0-${TEXT_PREVIEW_RANGE - 1}` } })
    if (!res.ok) throw new Error(String(res.status))
    let t = await res.text()
    // A server that ignores Range sends the whole file (< 1 MB): fine, but still cut the preview at 64 KB.
    truncated.value = !all && props.file.size > TEXT_PREVIEW_RANGE
    if (!all && t.length > TEXT_PREVIEW_RANGE) t = t.slice(0, TEXT_PREVIEW_RANGE)
    if (truncated.value) t = t.replace(/\n[^\n]*$/, '') // never show a cut-off last line
    text.value = t
    fullLoaded.value = all || !truncated.value
  } catch {
    failed.value = true
  }
}
onMounted(() => {
  if (lang.value) void loadText()
})

const lines = computed(() => (text.value ?? '').split('\n'))
const shown = computed(() => lines.value.slice(0, visible.value).join('\n'))
const more = computed(() => visible.value < lines.value.length || !fullLoaded.value)
watchEffect(async () => {
  const code = shown.value
  html.value = plainHtml(code)
  if (!import.meta.client || !lang.value || lang.value === 'text' || !text.value) return
  const out = await highlightToHtml(code, lang.value)
  if (out && code === shown.value) html.value = out
})
async function showAll() {
  if (!fullLoaded.value) await loadText(true)
  visible.value = Infinity
}
const { copy, copied } = useClipboard({ copiedDuring: 1500 })

const root = ref<HTMLElement>()
onMounted(() => {
  registerCtx(root.value, {
    kind: 'attachment',
    items: () => [
      {
        label: 'Open',
        icon: 'i-lucide-external-link',
        onSelect: () => {
          window.open(src.value, '_blank', 'noopener')
        },
      },
      ...(kind.value === 'image'
        ? [
            {
              label: 'Copy image',
              icon: 'i-lucide-image',
              onSelect: async () => copyImage((await $fetch<{ url: string }>(src.value, { query: { json: 1 } })).url),
            },
          ]
        : []),
      {
        label: kind.value === 'image' ? 'Save' : 'Download',
        icon: 'i-lucide-download',
        onSelect: () => {
          location.href = `${src.value}?download=1`
        },
      },
      { label: 'Copy link', icon: 'i-lucide-link', onSelect: () => copyText(new URL(src.value, location.origin).href) },
    ],
  })
})
</script>

<template>
  <div ref="root" class="my-1 max-w-full">
    <template v-if="kind === 'image'">
      <button
        type="button"
        class="relative block overflow-hidden rounded-md border border-default"
        :aria-label="`Open ${file.filename}`"
        @click="revealed ? emit('open', file) : (revealed = true)"
      >
        <img :src="src" :alt="file.filename" loading="lazy" class="max-h-[350px] max-w-full object-contain transition" :class="revealed ? '' : 'blur-2xl'" />
        <span v-if="!revealed" class="absolute inset-0 flex items-center justify-center bg-default/30 text-xs font-bold">
          <UIcon name="i-lucide-eye-off" class="mr-1 size-4" /> Spoiler: click to reveal
        </span>
      </button>
    </template>
    <video v-else-if="kind === 'video'" :src="src" controls preload="metadata" class="max-h-[350px] max-w-full rounded-md border border-default" />
    <audio v-else-if="kind === 'audio'" :src="src" controls preload="none" class="max-w-full" />
    <div v-else-if="lang && text !== undefined" class="overflow-hidden rounded-md border border-default bg-muted text-sm">
      <div class="flex items-center gap-1 border-b border-default px-2 py-1 text-xs text-muted">
        <UIcon :name="fileIcon(file.mime, file.filename)" class="size-4" />
        <span class="truncate">{{ file.filename }}</span>
        <span>{{ formatBytes(file.size) }}</span>
        <UButton
          class="ml-auto"
          :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="Copy file text"
          @click="copy(shown)"
        />
        <UButton icon="i-lucide-download" size="xs" color="neutral" variant="ghost" aria-label="Download file" :href="`${src}?download=1`" />
      </div>
      <!-- eslint-disable vue/no-v-html -- HTML comes from Shiki or the escaped plainHtml fallback. -->
      <div class="code-body overflow-x-auto" v-html="html" />
      <!-- eslint-enable vue/no-v-html -->
      <div v-if="more" class="flex gap-1 border-t border-default p-1">
        <UButton
          v-if="visible < lines.length"
          label="Show 50 more"
          icon="i-lucide-chevrons-down"
          size="xs"
          color="neutral"
          variant="soft"
          @click="visible += 50"
        />
        <UButton label="Show all" icon="i-lucide-unfold-vertical" size="xs" color="neutral" variant="soft" @click="showAll" />
      </div>
      <div v-else-if="visible > 25" class="border-t border-default p-1">
        <UButton label="Collapse" icon="i-lucide-chevrons-up" size="xs" color="neutral" variant="soft" @click="visible = 25" />
      </div>
    </div>
    <a
      v-else
      :href="`${src}?download=1`"
      class="inline-flex max-w-full items-center gap-2 rounded-md border border-default bg-elevated/50 px-3 py-2 text-sm hover:bg-elevated"
    >
      <UIcon :name="fileIcon(file.mime, file.filename)" class="size-6 shrink-0" />
      <span class="min-w-0">
        <span class="block truncate">{{ file.filename }}</span>
        <span class="block text-xs text-muted">{{ formatBytes(file.size) }}<template v-if="failed"> · preview unavailable</template></span>
      </span>
      <UIcon name="i-lucide-download" class="size-4 shrink-0 text-muted" />
    </a>
  </div>
</template>
