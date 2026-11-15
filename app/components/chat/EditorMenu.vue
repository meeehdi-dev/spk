<script setup lang="ts">
import type { AvatarProps } from '@nuxt/ui'
import type { Editor } from '@tiptap/vue-3'

import emojiTheme from '#build/ui/editor-emoji-menu'
import mentionTheme from '#build/ui/editor-mention-menu'
import UAvatar from '@nuxt/ui/components/Avatar.vue'
import { useEditorMenu } from '@nuxt/ui/composables/useEditorMenu'
import { tv } from '@nuxt/ui/utils/tv'

import EmojiText from '~/components/EmojiText.vue'
import EmojiGlyph from '~/components/mdc/EmojiGlyph.vue'

type EmojiItem = Awaited<ReturnType<typeof loadEmojiItems>>[number]
type MentionItem = { id: string; label: string; avatar: AvatarProps }
const props = defineProps<{ editor: Editor } & ({ kind: 'emoji'; items: EmojiItem[] } | { kind: 'mention'; items: MentionItem[] })>()
const appConfig = useAppConfig()
const ui = computed(() =>
  props.kind === 'emoji'
    ? tv({ extend: emojiTheme, ...appConfig.ui?.editorEmojiMenu })({})
    : tv({ extend: mentionTheme, ...appConfig.ui?.editorMentionMenu })({}),
)
const pluginKey = `${props.kind}Menu`
let menu: ReturnType<typeof useEditorMenu> | undefined

onMounted(async () => {
  await nextTick()
  if (props.editor.isDestroyed) return
  menu = useEditorMenu<EmojiItem | MentionItem>({
    editor: props.editor,
    char: props.kind === 'emoji' ? ':' : '@',
    pluginKey,
    items: toRef(() => props.items),
    filterFields: props.kind === 'emoji' ? ['name', 'shortcodes', 'tags'] : ['label'],
    ui,
    onSelect: (editor, range, item) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent('emoji' in item ? item.emoji : { type: 'mention', attrs: { ...item, mentionSuggestionChar: '@' } })
        .run()
    },
    renderItem: (item, styles) => [
      'emoji' in item
        ? h(EmojiGlyph, { emoji: item.emoji, class: styles.value.itemLeadingIcon(), 'aria-hidden': 'true' })
        : h(UAvatar, { ...item.avatar, size: styles.value.itemLeadingAvatarSize(), class: styles.value.itemLeadingAvatar() }),
      h('span', { class: styles.value.itemWrapper() }, [h(EmojiText, { text: 'emoji' in item ? item.name : item.label, class: styles.value.itemLabel() })]),
    ],
  })
  props.editor.registerPlugin(menu.plugin)
})

onBeforeUnmount(() => {
  menu?.destroy()
  if (!props.editor.isDestroyed) props.editor.unregisterPlugin(pluginKey)
})
</script>

<template>
  <div />
</template>
