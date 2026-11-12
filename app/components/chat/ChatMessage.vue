<script setup lang="ts">
import type { MessageDto, ReactionDto } from '../../../server/db/messages'
import type { MessageCtx } from '../../composables/messageContext'

const props = defineProps<{ message: MessageDto; grouped: boolean; highlighted?: boolean; editing?: boolean; scroller?: HTMLElement; content?: HTMLElement }>()
const emit = defineEmits<{ quote: [text: string]; markUnread: [id: string]; editStart: [id: string]; editEnd: [] }>()

const { byId, nameOf } = useUsers()
const { data: me } = useMe()
const { quickReactions } = useRecentReactions()
const actions = inject(chatActionsKey)!
const author = computed(() => byId.value.get(props.message.userId))
const own = computed(() => me.value?.id === props.message.userId)
const canDelete = computed(() => own.value || me.value?.role === 'admin')

provide(
  messageCtxKey,
  reactive({
    id: props.message.id,
    channelId: props.message.channelId,
    userId: props.message.userId,
    body: computed(() => props.message.body),
    own,
    quote: (t: string) => emit('quote', t),
    // Changing a code block's language on your own message is a normal edit (shows "(edited)").
    async setLanguage(occurrence: number, lang: string, code: string) {
      const next = setFenceLanguage(props.message.body, occurrence, lang, code)
      return next !== null && (await actions.edit(props.message.id, next))
    },
  }) as unknown as MessageCtx,
)

// Reactions, reply preview, delete confirmation.
const picker = ref(false)
const pickerPoint = shallowRef<{ x: number; y: number }>()
const pickerReference = computed(() => {
  const point = pickerPoint.value
  return point ? { getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) } : undefined
})
function setPickerOpen(open: boolean) {
  picker.value = open
  if (!open) pickerPoint.value = undefined
}
// Keep the hover toolbar shown while the picker or the More menu is open.
const moreOpen = ref(false)
const whoOpen = ref<string | null>(null)
const confirmDelete = ref(false)
const mineOf = (r: ReactionDto) => !!me.value && r.userIds.includes(me.value.id)
const react = (emoji: string) => actions.react(props.message.id, emoji, !props.message.reactions.find(r => r.emoji === emoji && mineOf(r)))
const pick = (emoji: string) => {
  setPickerOpen(false)
  if (emoji) void react(emoji)
}
const whoReaction = computed(() => props.message.reactions.find(r => r.emoji === whoOpen.value))
const replyEl = ref<HTMLElement>()
// Avatar and name: click opens the profile; the context menu is the user menu.
const admin = useAdmin()
const avatarEl = ref<HTMLElement>()
const nameEl = ref<HTMLElement>()
const openProfile = () => {
  admin.dialog.value = { kind: 'profile', userId: props.message.userId }
}
const replyLink = () => `${location.origin}/c/${props.message.channelId}/m/${props.message.replyTo!.id}`
const replyText = computed(() => previewText(props.message.replyTo?.preview ?? '', nameOf))
onMounted(() => {
  for (const el of [avatarEl.value, nameEl.value]) registerCtx(el, { kind: 'user', items: () => admin.userGroups(props.message.userId).flat() })
  registerCtx(replyEl.value, {
    kind: 'reply',
    items: () =>
      props.message.replyTo?.deleted
        ? []
        : [
            { label: 'Jump to original', icon: 'i-lucide-corner-up-left', onSelect: () => actions.jump(props.message.replyTo!.id) },
            { label: 'Copy link to original', icon: 'i-lucide-link', onSelect: () => copyText(replyLink()) },
          ],
  })
})

// Relative time ticks once a minute.
const now = useTick(60_000)
const rel = computed(() => relativeTime(props.message.createdAt, now.value.getTime()))

// Long messages: show 25 lines, then 50 more, then all.
const lineCount = computed(() => props.message.body.split('\n').length)
const visibleLines = ref(25)
const long = computed(() => lineCount.value > 25)
const expandedAll = computed(() => visibleLines.value >= lineCount.value)
const bodyStyle = computed(() => (long.value && !expandedAll.value ? { maxHeight: `${visibleLines.value * 1.5}rem` } : undefined))

const tree = shallowRef<Awaited<ReturnType<typeof parseChatMarkdown>>>()
watchEffect(async () => {
  tree.value = await parseChatMarkdown(props.message.body)
})

const link = () => `${location.origin}/c/${props.message.channelId}/m/${props.message.id}`
const root = ref<HTMLElement>()
const toolbar = ref<HTMLElement>()
const toolbarStyle = ref<{ top: string; left: string; maxWidth: string }>()
const toolbarVisible = ref(false)
function positionToolbar() {
  if (!root.value || !toolbar.value || !props.scroller) return
  const height = toolbar.value.offsetHeight
  toolbarVisible.value = height > 0
  if (!height) return
  const row = root.value.getBoundingClientRect()
  const viewportTop = props.scroller.getBoundingClientRect().top + props.scroller.clientTop
  // Fixed positioning escapes scrollport clipping; keep the toolbar above the following row, even in compact mode.
  toolbarStyle.value = {
    top: `${Math.min(Math.max(row.top, viewportTop), row.bottom - height / 2)}px`,
    left: `${row.right - 16}px`,
    maxWidth: `${Math.max(0, row.width - 32)}px`,
  }
}
// Earlier messages can grow and move this row without resizing it or scrolling.
useResizeObserver([root, toolbar, () => props.scroller, () => (toolbarVisible.value ? props.content : undefined)], positionToolbar)
useEventListener(() => (toolbarVisible.value ? props.scroller : undefined), 'scroll', positionToolbar, { passive: true })
const plain = () => root.value?.querySelector<HTMLElement>('[data-body]')?.innerText ?? props.message.body

const messageItems = (point?: { x: number; y: number }) => [
  {
    label: 'Reply',
    icon: 'i-lucide-reply',
    onSelect: () => {
      skipRefocus = true
      actions.reply(props.message.id)
    },
  },
  {
    label: 'React',
    icon: 'i-lucide-smile-plus',
    onSelect: () => {
      skipRefocus = true
      pickerPoint.value = point
      openPickerAfterClose = true
    },
  },
  { label: 'Quote', icon: 'i-lucide-quote', onSelect: () => emit('quote', selectionText() || props.message.body) },
  ...(own.value
    ? [
        {
          label: 'Edit',
          icon: 'i-lucide-pencil',
          onSelect: () => {
            skipRefocus = true
            emit('editStart', props.message.id)
          },
        },
      ]
    : []),
  ...(canDelete.value
    ? [
        {
          label: 'Delete',
          icon: 'i-lucide-trash-2',
          color: 'error' as const,
          onSelect: () => {
            confirmDelete.value = true
          },
        },
      ]
    : []),
  { label: 'Copy text', icon: 'i-lucide-copy', onSelect: () => copyText(plain()) },
  { label: 'Copy Markdown', icon: 'i-lucide-file-code', onSelect: () => copyText(props.message.body) },
  { label: 'Copy link', icon: 'i-lucide-link', onSelect: () => copyText(link()) },
  { label: 'Mark as unread', icon: 'i-lucide-mail', onSelect: () => emit('markUnread', props.message.id) },
]
// The closing menu would hand focus back to the message and steal it from the editor.
let skipRefocus = false
// Opening the picker while the menu is still closing makes the popover dismiss itself, so wait for the close.
let openPickerAfterClose = false
const menuContent = {
  onCloseAutoFocus: (e: Event) => {
    if (skipRefocus) e.preventDefault()
    skipRefocus = false
    if (openPickerAfterClose) {
      openPickerAfterClose = false
      setTimeout(() => (picker.value = true))
    }
  },
}
const selectionText = () => window.getSelection()?.toString().trim() ?? ''

// Innermost target's items first, the message's own items in a submenu.
const items = ref<Array<Record<string, unknown>>>(messageItems())
function onContext(e: MouseEvent) {
  if (selectionText()) {
    e.stopPropagation()
    return
  } // selected text keeps the browser's menu
  const point = { x: e.clientX, y: e.clientY }
  const target = root.value ? findCtx(e.target, root.value) : null
  items.value = target
    ? ([target.items(), [{ label: 'Message', icon: 'i-lucide-message-square', children: messageItems(point) }]] as never)
    : messageItems(point)
}

const { copy, copied } = useClipboard({ copiedDuring: 1500 })
// Only keyboard focus arms `R`; blurring mouse focus would interrupt text selection.
function onKey(e: KeyboardEvent) {
  if (e.target === root.value && root.value?.matches(':focus-visible') && e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    actions.reply(props.message.id)
  }
}
</script>

<template>
  <UContextMenu :items="items" :content="menuContent">
    <div
      :id="`msg-${message.id}`"
      ref="root"
      tabindex="0"
      class="group relative flex gap-3 px-4 py-0.5 outline-none hover:bg-elevated/50 focus-visible:bg-elevated/70 compact:py-0"
      :class="[highlighted ? 'bg-primary/10' : '', grouped ? '' : 'mt-3 compact:mt-1']"
      @contextmenu="onContext"
      @keydown="onKey"
    >
      <div class="relative w-9 shrink-0 text-right">
        <button v-if="!grouped" ref="avatarEl" type="button" class="rounded-full" :aria-label="`Profile of ${nameOf(message.userId)}`" @click="openProfile">
          <UAvatar :src="avatarSrc(author)" :alt="nameOf(message.userId)" icon="i-lucide-user" :chip="presenceChip(message.userId)" />
        </button>
        <UTooltip v-else :text="exactTime(message.createdAt)">
          <span class="absolute -right-2 hidden text-xs leading-6 whitespace-nowrap text-muted group-hover:inline">{{ clockTime(message.createdAt) }}</span>
        </UTooltip>
      </div>
      <div class="min-w-0 flex-1">
        <div v-if="!grouped" class="flex items-baseline gap-2 text-sm">
          <button ref="nameEl" type="button" class="font-bold hover:underline" @click="openProfile">
            {{ nameOf(message.userId) }}
          </button>
          <UTooltip :text="exactTime(message.createdAt)">
            <span class="text-xs text-muted">{{ rel }}</span>
          </UTooltip>
          <UTooltip v-if="message.editedAt && !editing" :text="exactTime(message.editedAt)">
            <span class="text-[10px] text-muted">(edited)</span>
          </UTooltip>
        </div>
        <button
          v-if="message.replyTo"
          ref="replyEl"
          type="button"
          class="mb-0.5 flex max-w-full items-center gap-1 rounded text-left text-xs text-muted hover:text-default"
          :class="message.replyTo.deleted ? 'cursor-default italic' : ''"
          :aria-label="message.replyTo.deleted ? 'Original message deleted' : 'Jump to the original message'"
          @click="!message.replyTo.deleted && actions.jump(message.replyTo.id)"
        >
          <UIcon name="i-lucide-corner-up-right" class="size-3.5 shrink-0" />
          <template v-if="message.replyTo.deleted"> Original message deleted </template>
          <template v-else> <b class="shrink-0">{{ nameOf(message.replyTo.userId) }}</b><span class="truncate">{{ replyText }}</span> </template>
        </button>
        <ChatMessageEditor
          v-if="editing"
          :body="message.body"
          @save="
            async (md: string) => {
              if (md === message.body || (await actions.edit(message.id, md))) emit('editEnd')
            }
          "
          @cancel="emit('editEnd')"
        />
        <div v-else-if="message.body || (grouped && message.editedAt)" :class="grouped && message.editedAt ? 'flex items-baseline-last gap-1' : ''">
          <div v-if="message.body" class="relative min-w-0">
            <div
              data-body
              class="chat-body break-words"
              :class="[long && !expandedAll ? 'overflow-hidden' : '', isEmojiOnly(message.body) ? 'chat-emoji-only' : '']"
              :style="bodyStyle"
            >
              <Suspense>
                <MDCRenderer v-if="tree" :body="tree" :data="{}" tag="div" />
              </Suspense>
              <!-- Raw text until the markdown is parsed, so the message takes about its final height. -->
              <div v-if="!tree" class="whitespace-pre-wrap">{{ message.body }}</div>
            </div>
            <div v-if="long && !expandedAll" class="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-default to-transparent" />
          </div>
          <UTooltip v-if="grouped && message.editedAt" :text="exactTime(message.editedAt)">
            <span class="shrink-0 text-[10px] text-muted">(edited)</span>
          </UTooltip>
        </div>
        <div v-if="long && !editing" class="mt-1 flex gap-1">
          <template v-if="!expandedAll">
            <UButton label="Show 50 more" icon="i-lucide-chevrons-down" color="neutral" variant="soft" @click="visibleLines += 50" />
            <UButton label="Show all" icon="i-lucide-unfold-vertical" color="neutral" variant="soft" @click="visibleLines = Infinity" />
          </template>
          <UButton v-else label="Collapse" icon="i-lucide-chevrons-up" color="neutral" variant="soft" @click="visibleLines = 25" />
        </div>
        <div v-if="message.attachments.length" class="mt-1 flex flex-col items-start">
          <ChatAttachmentView v-for="f in message.attachments" :key="f.id" :file="f" @open="actions.openImage" />
        </div>
        <ChatPreviewCard
          v-for="p in message.previews"
          :key="p.url"
          :message-id="message.id"
          :preview="p"
          :can-remove="canDelete"
          @remove="(url: string) => actions.removePreview(message.id, url)"
        />
        <div v-if="message.reactions.length" class="mt-1 flex flex-wrap gap-1">
          <ChatReactionChip v-for="r in message.reactions" :key="r.emoji" :reaction="r" :mine="mineOf(r)" @toggle="react(r.emoji)" @who="whoOpen = r.emoji" />
        </div>
      </div>
      <div
        v-if="!editing"
        ref="toolbar"
        :style="toolbarStyle"
        class="fixed z-10 hidden w-max -translate-x-full -translate-y-1/2 gap-0.5 overflow-x-auto rounded-md border border-default bg-default p-0.5 shadow-sm group-hover:flex group-focus-visible:flex group-has-[:focus-visible]:flex"
        :class="picker || moreOpen ? '!flex' : ''"
      >
        <UTooltip v-for="e in quickReactions" :key="e" :text="`React ${e}`">
          <UButton
            color="neutral"
            variant="ghost"
            :aria-label="`React with ${e}`"
            :class="message.reactions.some(r => r.emoji === e && mineOf(r)) ? 'bg-primary/10' : ''"
            @click="react(e)"
          >
            {{ e }}
          </UButton>
        </UTooltip>
        <UPopover
          :open="picker"
          :reference="pickerReference"
          :content="pickerPoint ? { side: 'bottom', align: 'start', sideOffset: 0 } : { side: 'top', align: 'end' }"
          @update:open="setPickerOpen"
        >
          <UTooltip text="Add reaction">
            <UButton icon="i-lucide-smile-plus" color="neutral" variant="ghost" aria-label="Add reaction" @click="pickerPoint = undefined" />
          </UTooltip>
          <template #content>
            <ChatEmojiPicker @pick="pick" />
          </template>
        </UPopover>
        <UTooltip text="Reply" :kbds="['R']">
          <UButton icon="i-lucide-reply" color="neutral" variant="ghost" aria-label="Reply" @click="actions.reply(message.id)" />
        </UTooltip>
        <UTooltip v-if="own" text="Edit" :kbds="['arrowup']">
          <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" aria-label="Edit message" @click="emit('editStart', message.id)" />
        </UTooltip>
        <UTooltip :text="copied ? 'Copied' : 'Copy Markdown'">
          <UButton :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" color="neutral" variant="ghost" aria-label="Copy message" @click="copy(message.body)" />
        </UTooltip>
        <UDropdownMenu v-model:open="moreOpen" :items="messageItems()" :content="{ align: 'end', ...menuContent }">
          <UTooltip text="More">
            <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" aria-label="More actions" />
          </UTooltip>
        </UDropdownMenu>
      </div>
      <UModal v-model:open="confirmDelete" title="Delete message?" description="This removes the message and its files for everyone. It can't be undone.">
        <template #footer>
          <UButton label="Cancel" color="neutral" variant="ghost" @click="confirmDelete = false" />
          <UButton
            label="Delete"
            icon="i-lucide-trash-2"
            color="error"
            @click="
              confirmDelete = false;
              actions.remove(message.id)
            "
          />
        </template>
      </UModal>
      <UModal :open="!!whoReaction" :title="`${whoOpen} reactions`" @update:open="whoOpen = null">
        <template #body>
          <ul class="flex flex-col gap-2">
            <li v-for="id in whoReaction?.userIds" :key="id" class="flex items-center gap-2 text-sm">
              <UAvatar :src="avatarSrc(byId.get(id))" :alt="nameOf(id)" icon="i-lucide-user" size="xs" /> {{ nameOf(id) }}
            </li>
          </ul>
        </template>
      </UModal>
    </div>
  </UContextMenu>
</template>

<style>
.chat-body .emoji {
  font-size: 1.2em;
  line-height: 1;
  vertical-align: middle;
}
.chat-emoji-only .emoji {
  font-size: 2.25rem;
  line-height: 1.2;
}
.chat-body p {
  margin: 0;
  white-space: pre-wrap;
}
.chat-body p + p {
  margin-top: 0.5rem;
}
.chat-body ul {
  list-style: disc;
  padding-left: 1.5rem;
}
.chat-body ol {
  list-style: decimal;
  padding-left: 1.5rem;
}
</style>
