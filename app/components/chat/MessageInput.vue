<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'

import { MAX_FILES } from '../../../shared/utils/files'

const props = defineProps<{ channelId: string; channelName: string; replyTo?: { id: string; name: string; preview: string } | null }>()
const emit = defineEmits<{ send: [markdown: string, draft: OutgoingDraft]; typing: []; cancelReply: []; editLast: [] }>()
const drafts = useDrafts()
const { text: model, gif, uploads } = drafts.get(props.channelId)

const { data: users } = useUsers()

const nameById = (id: string) => users.value.find(u => u.id === id)?.displayName ?? undefined
const mentionItems = computed(() =>
  users.value
    .filter(u => u.displayName)
    .map(u => ({
      id: u.id,
      label: u.displayName!,
      avatar: { src: avatarSrc(u), alt: u.displayName!, icon: 'i-lucide-user' },
    })),
)

const editorRef = ref<{ editor: Editor }>()
const isEmpty = computed(() => !model.value.trim() && !gif.value && !uploads.ready.value.length)

function send() {
  const md = fixSpoilerSeams(model.value).trim()
  if (uploads.busy.value) {
    useToast().add({ title: 'Wait for the uploads to finish', icon: 'i-lucide-loader', color: 'warning' })
    return false
  }
  if (!md && !gif.value && !uploads.ready.value.length) return false
  const body = composeBody(md, gif.value)
  const draft = drafts.take(props.channelId)
  emit('send', body, draft)
  return true
}

const emojiItems = ref<Awaited<ReturnType<typeof loadEmojiItems>>>([])
onMounted(() =>
  loadEmojiItems()
    .then(r => {
      emojiItems.value = r
    })
    .catch(() => {}),
)

const extensions = [
  ...chatMarkExtensions(nameById),
  chatKeys({
    onEnter: send,
    onEscape: () => {
      if (props.replyTo) {
        emit('cancelReply')
        return true
      }
      return false
    },
    onArrowUp: () => {
      emit('editLast')
      return true
    },
  }),
]

// Files: paste, drop, or the paperclip button.
const gifOpen = ref(false)
const fileInput = ref<HTMLInputElement>()
const dragging = ref(false)
const onFiles = (list?: FileList | null) => {
  if (list?.length) uploads.add([...list])
}
function onPaste(e: ClipboardEvent) {
  const files = [...(e.clipboardData?.files ?? [])]
  if (!files.length) return
  e.preventDefault()
  uploads.add(files)
}
function onDrop(e: DragEvent) {
  dragging.value = false
  if (e.dataTransfer?.files.length) {
    e.preventDefault()
    uploads.add([...e.dataTransfer.files])
  }
}

// "Mention" in a user's context menu appends `<@id> ` to the draft.
const { mentionRequest } = useAdmin()
watch(mentionRequest, r => {
  if (!r) return
  model.value = `${model.value.replace(/\s*$/, '')}${model.value.trim() ? ' ' : ''}<@${r.id}> `
  mentionRequest.value = null
  void nextTick(() => editorRef.value?.editor.commands.focus('end'))
})

let lastTyping = 0
function onUpdate(v: string) {
  model.value = v
  if (v && Date.now() - lastTyping > 3000) {
    lastTyping = Date.now()
    emit('typing')
  }
}

const tools = [
  { icon: 'i-lucide-bold', label: 'Bold', keys: ['meta', 'B'], on: (e: Editor) => e.chain().focus().toggleBold().run(), active: 'bold' },
  { icon: 'i-lucide-italic', label: 'Italic', keys: ['meta', 'I'], on: (e: Editor) => e.chain().focus().toggleItalic().run(), active: 'italic' },
  {
    icon: 'i-lucide-strikethrough',
    label: 'Strikethrough',
    keys: ['meta', 'shift', 'X'],
    on: (e: Editor) => e.chain().focus().toggleStrike().run(),
    active: 'strike',
  },
  { icon: 'i-lucide-code', label: 'Inline code', keys: ['meta', 'E'], on: (e: Editor) => e.chain().focus().toggleCode().run(), active: 'code' },
  {
    icon: 'i-lucide-square-code',
    label: 'Code block',
    keys: ['meta', 'alt', 'C'],
    on: (e: Editor) => e.chain().focus().toggleCodeBlock().run(),
    active: 'codeBlock',
  },
  { icon: 'i-lucide-quote', label: 'Quote', keys: ['meta', 'shift', '.'], on: (e: Editor) => e.chain().focus().toggleBlockquote().run(), active: 'blockquote' },
  { icon: 'i-lucide-eye-off', label: 'Spoiler', keys: [], on: (e: Editor) => e.chain().focus().toggleMark('spoiler').run(), active: 'spoiler' },
]

defineExpose({
  focus: () => editorRef.value?.editor.commands.focus('end'),
  /** Appends `> text` as a quote and moves on to a fresh line. */
  quote(text: string) {
    const quoted = text
      .split('\n')
      .map(l => `> ${l}`)
      .join('\n')
    model.value = model.value.trim() ? `${model.value}\n\n${quoted}\n\n` : `${quoted}\n\n`
    void nextTick(() => editorRef.value?.editor.commands.focus('end'))
  },
})
</script>

<template>
  <div class="p-3" @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop="onDrop">
    <div v-if="replyTo" class="mb-1 flex items-center gap-2 rounded-md bg-elevated px-2 py-1 text-xs">
      <UIcon name="i-lucide-reply" class="size-4 shrink-0" />
      <span class="truncate">Replying to <b>{{ replyTo.name }}</b> <span class="text-muted">{{ replyTo.preview }}</span></span>
      <UTooltip text="Cancel reply" :kbds="['escape']">
        <UButton class="ml-auto" icon="i-lucide-x" color="neutral" variant="ghost" aria-label="Cancel reply" @click="emit('cancelReply')" />
      </UTooltip>
    </div>
    <div
      class="rounded-md border border-accented bg-default focus-within:border-primary/40"
      :class="dragging ? 'border-primary bg-primary/5' : ''"
      @paste.capture="onPaste"
    >
      <ChatUploadQueue v-if="uploads.items.value.length || gif" :uploads="uploads.items.value" :gif="gif" @cancel="uploads.cancel" @remove-gif="gif = null" />
      <UEditor
        ref="editorRef"
        :model-value="model"
        content-type="markdown"
        autofocus="end"
        :placeholder="{ placeholder: `Message ${channelName}`, mode: 'firstLine' }"
        :mention="false"
        :image="false"
        :starter-kit="{ heading: false, horizontalRule: false, underline: false, link: { autolink: false, linkOnPaste: false, openOnClick: false } }"
        :extensions="extensions"
        :ui="{ base: 'max-h-64 overflow-y-auto py-2 sm:px-3', content: 'min-h-10' }"
        @update:model-value="onUpdate"
      >
        <template #default="{ editor }">
          <UEditorMentionMenu :editor="editor" :items="mentionItems" />
          <UEditorEmojiMenu v-if="emojiItems.length" :editor="editor" :items="emojiItems" />
        </template>
      </UEditor>
      <div class="flex items-center gap-0.5 border-t border-default px-1.5 py-1">
        <UTooltip v-for="t in tools" :key="t.label" :text="t.label" :kbds="t.keys as never">
          <UButton
            :icon="t.icon"
            color="neutral"
            :variant="editorRef?.editor?.isActive(t.active) ? 'soft' : 'ghost'"
            :aria-label="t.label"
            @click="editorRef && t.on(editorRef.editor)"
          />
        </UTooltip>
        <input
          ref="fileInput"
          type="file"
          multiple
          class="hidden"
          @change="
            onFiles(($event.target as HTMLInputElement).files);
            ($event.target as HTMLInputElement).value = ''
          "
        />
        <UTooltip :text="`Attach files (up to ${MAX_FILES}, 25 MB each)`">
          <UButton icon="i-lucide-paperclip" color="neutral" variant="ghost" aria-label="Attach files" @click="fileInput?.click()" />
        </UTooltip>
        <UPopover v-model:open="gifOpen" :content="{ side: 'top', align: 'start' }">
          <UTooltip text="GIFs">
            <UButton icon="i-lucide-image-play" color="neutral" variant="ghost" aria-label="Open GIF menu" />
          </UTooltip>
          <template #content>
            <ChatGifPicker
              @pick="
                (url: string) => {
                  gifOpen = false
                  gif = url
                }
              "
            />
          </template>
        </UPopover>
        <UTooltip text="Send" :kbds="['enter']">
          <UButton class="ml-auto" icon="i-lucide-send-horizontal" size="md" label="Send" :disabled="isEmpty" aria-label="Send message" @click="send" />
        </UTooltip>
      </div>
    </div>
  </div>
</template>

<style>
.mention {
  color: var(--ui-primary);
  font-weight: 500;
}
span[data-spoiler] {
  background: var(--ui-bg-elevated);
  border-radius: 0.25rem;
}
</style>
