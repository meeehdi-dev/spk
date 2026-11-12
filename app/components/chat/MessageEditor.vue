<script setup lang="ts">
// Inline editor for one of your own messages: Enter saves, Esc cancels.
const props = defineProps<{ body: string }>()
const emit = defineEmits<{ save: [markdown: string]; cancel: [] }>()
const { data: users } = useUsers()
const model = ref(props.body)
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
const emojiItems = ref<Awaited<ReturnType<typeof loadEmojiItems>>>([])
onMounted(() =>
  loadEmojiItems()
    .then(r => {
      emojiItems.value = r
    })
    .catch(() => {}),
)

const save = () => emit('save', fixSpoilerSeams(model.value).trim())
const extensions = [
  ...chatMarkExtensions(nameById),
  chatKeys({
    onEnter: save,
    onEscape: () => {
      emit('cancel')
      return true
    },
  }),
]
</script>

<template>
  <div class="rounded-md border border-primary bg-default">
    <UEditor
      v-model="model"
      content-type="markdown"
      autofocus="end"
      :mention="false"
      :image="false"
      :starter-kit="{ heading: false, horizontalRule: false, underline: false, link: { autolink: false, linkOnPaste: false, openOnClick: false } }"
      :extensions="extensions"
      :ui="{ base: 'max-h-64 overflow-y-auto py-2 sm:px-3', content: 'min-h-10' }"
    >
      <template #default="{ editor }">
        <UEditorMentionMenu :editor="editor" :items="mentionItems" />
        <UEditorEmojiMenu v-if="emojiItems.length" :editor="editor" :items="emojiItems" />
      </template>
    </UEditor>
    <div class="flex items-center gap-2 border-t border-default px-2 py-1 text-xs text-muted">
      <span>Esc to cancel · Enter to save</span>
      <UButton class="ml-auto" label="Cancel" color="neutral" variant="ghost" @click="emit('cancel')" />
      <UButton label="Save" icon="i-lucide-check" @click="save" />
    </div>
  </div>
</template>
