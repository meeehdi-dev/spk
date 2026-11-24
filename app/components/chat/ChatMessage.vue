<script setup lang="ts">
import type { MessageDto, ReactionDto } from '../../../server/db/messages'
import type { MessageCtx } from '../../composables/messageContext'

const props = defineProps<{ message: MessageDto; grouped: boolean; highlighted?: boolean; editing?: boolean; scroller?: HTMLElement; content?: HTMLElement }>()
const emit = defineEmits<{ quote: [text: string]; markUnread: [id: string]; editStart: [id: string]; editEnd: [] }>()

const { byId, nameOf } = useUsers()
const { data: me } = useMe()
const { data: channels } = useChannels()
const { quickReactions } = useRecentReactions()
const actions = inject(chatActionsKey)!
const author = computed(() => byId.value.get(props.message.userId))
const pinged = computed(
  () =>
    !!me.value &&
    !own.value &&
    channels.value.some(c => c.id === props.message.channelId && c.type === 'text') &&
    (props.message.replyTo?.userId === me.value.id || extractMentionIds(props.message.body).includes(me.value.id)),
)
// A webhook feed is read-only: the author is the webhook, and only delete (owner or admin) is left of the actions.
const webhook = computed(() => {
  const c = channels.value.find(c => c.id === props.message.channelId)
  return c?.type === 'webhook' ? c : undefined
})
const own = computed(() => me.value?.id === props.message.userId && !webhook.value) // alerts carry the owner's userId
const canDelete = computed(() => own.value || me.value?.role === 'admin' || (!!webhook.value && webhook.value.ownerId === me.value?.id))
const pinnable = computed(() => canPin(channels.value.find(c => c.id === props.message.channelId)?.type, me.value?.role))

const pollEditOpen = ref(false)
const startEdit = () => (props.message.poll ? (pollEditOpen.value = true) : emit('editStart', props.message.id))

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
  ...(webhook.value
    ? []
    : [
        {
          label: 'Reply',
          icon: 'i-lucide-reply',
          onSelect: () => {
            skipRefocus = true
            replyAfterClose = true
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
      ]),
  ...(own.value && !webhook.value
    ? [
        {
          label: 'Edit',
          icon: 'i-lucide-pencil',
          onSelect: () => {
            skipRefocus = true
            startEdit()
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
  ...(pinnable.value
    ? [
        {
          label: props.message.pinned ? 'Unpin message' : 'Pin message',
          icon: props.message.pinned ? 'i-lucide-pin-off' : 'i-lucide-pin',
          onSelect: () => actions.pin(props.message.id, !props.message.pinned),
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
// Wait for the closing menu to release its focus trap before focusing the reply editor.
let replyAfterClose = false
// Opening the picker while the menu is still closing makes the popover dismiss itself, so wait for the close.
let openPickerAfterClose = false
const menuContent = {
  onCloseAutoFocus: (e: Event) => {
    if (skipRefocus) e.preventDefault()
    skipRefocus = false
    if (replyAfterClose) {
      replyAfterClose = false
      setTimeout(() => actions.reply(props.message.id))
    }
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
  if (
    !webhook.value &&
    e.target === root.value &&
    root.value?.matches(':focus-visible') &&
    e.key.toLowerCase() === 'r' &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey
  ) {
    e.preventDefault()
    actions.reply(props.message.id)
  }
}
</script>

<template>
  <UContextMenu :items="items" :content="menuContent">
    <template #item-label="{ item }"><EmojiText :text="String(item.label ?? '')" /></template>
    <div
      :id="`msg-${message.id}`"
      ref="root"
      tabindex="0"
      class="group relative flex gap-3 px-4 py-0.5 transition-colors duration-700 outline-none compact:py-0"
      :class="[
        // Jump target (search, reply, pin): neutral so it doesn't read as an amber mention; fades when ChannelView clears it.
        highlighted
          ? 'bg-inverted/10'
          : pinged
            ? 'bg-primary/10 hover:bg-primary/15 focus-visible:bg-primary/15'
            : 'hover:bg-elevated/50 focus-visible:bg-elevated/70',
        grouped ? (message.body || editing ? 'items-baseline' : '') : 'mt-3 compact:mt-1',
      ]"
      @contextmenu="onContext"
      @keydown="onKey"
    >
      <div class="relative flex w-9 shrink-0 justify-end">
        <span
          v-if="!grouped && webhook"
          role="img"
          class="flex size-10 items-center justify-center self-start rounded-full bg-elevated"
          :aria-label="webhook.name ?? ''"
        >
          <UIcon :name="`i-lucide-${webhook.icon ?? 'webhook'}`" class="size-5" aria-hidden="true" data-webhook-icon />
        </span>
        <button
          v-else-if="!grouped"
          ref="avatarEl"
          type="button"
          class="self-start rounded-full"
          :aria-label="`Profile of ${nameOf(message.userId)}`"
          @click="openProfile"
        >
          <UAvatar :src="avatarSrc(author)" :alt="nameOf(message.userId)" icon="i-lucide-user" :chip="presenceChip(message.userId)" />
        </button>
        <UTooltip v-else :text="exactTime(message.createdAt)">
          <span class="invisible relative left-2 text-xs whitespace-nowrap text-muted group-hover:visible">{{ clockTime(message.createdAt) }}</span>
        </UTooltip>
      </div>
      <div class="min-w-0 flex-1">
        <div v-if="!grouped" class="flex items-baseline gap-2 text-sm">
          <span v-if="webhook" class="font-bold" data-webhook-name><EmojiText :text="webhook.name ?? ''" /></span>
          <button v-else ref="nameEl" type="button" class="font-bold hover:underline" @click="openProfile">
            <EmojiText :text="nameOf(message.userId)" />
          </button>
          <UTooltip :text="exactTime(message.createdAt)">
            <span class="text-xs text-muted">{{ rel }}</span>
          </UTooltip>
          <UTooltip v-if="message.editedAt && !editing" :text="exactTime(message.editedAt)">
            <span class="text-[10px] text-muted">(edited)</span>
          </UTooltip>
          <UIcon v-if="message.pinned" name="i-lucide-pin" class="size-3 self-center text-muted" aria-label="Pinned" />
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
          <template v-else>
            <b class="shrink-0"><EmojiText :text="nameOf(message.replyTo.userId)" /></b><span class="truncate"><EmojiText :text="replyText" /></span>
          </template>
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
              <div v-if="!tree" class="whitespace-pre-wrap"><EmojiText :text="message.body" /></div>
            </div>
            <div v-if="long && !expandedAll" class="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-default to-transparent" />
          </div>
          <UTooltip v-if="grouped && message.editedAt" :text="exactTime(message.editedAt)">
            <span class="shrink-0 text-[10px] text-muted">(edited)</span>
          </UTooltip>
        </div>
        <div v-if="long && !editing" class="mt-1 flex gap-1 [--ui-bg-field:var(--ui-bg-base)]">
          <template v-if="!expandedAll">
            <UButton label="Show 50 more" icon="i-lucide-chevrons-down" color="neutral" variant="soft" @click="visibleLines += 50" />
            <UButton label="Show all" icon="i-lucide-unfold-vertical" color="neutral" variant="soft" @click="visibleLines = Infinity" />
          </template>
          <UButton v-else label="Collapse" icon="i-lucide-chevrons-up" color="neutral" variant="soft" @click="visibleLines = 25" />
        </div>
        <div v-if="message.attachments.length" class="mt-1 flex flex-col items-start">
          <ChatAttachmentView v-for="f in message.attachments" :key="f.id" :file="f" @open="actions.openImage" />
        </div>
        <ChatWebhookEmbed v-if="message.embed" :embed="message.embed" />
        <ChatPreviewCard
          v-for="p in message.previews"
          :key="p.url"
          :message-id="message.id"
          :preview="p"
          :can-remove="canDelete"
          @remove="(url: string) => actions.removePreview(message.id, url)"
        />
        <ChatPollView v-if="message.poll" :message-id="message.id" :poll="message.poll" />
        <div v-if="message.reactions.length" class="mt-1 flex flex-wrap gap-1">
          <ChatReactionChip v-for="r in message.reactions" :key="r.emoji" :reaction="r" :mine="mineOf(r)" @toggle="react(r.emoji)" @who="whoOpen = r.emoji" />
        </div>
      </div>
      <div
        v-if="!editing"
        ref="toolbar"
        :style="toolbarStyle"
        class="fixed z-10 hidden w-max -translate-x-full -translate-y-1/2 gap-0.5 overflow-x-auto rounded-md bg-(--ui-bg-base) p-0.5 shadow-sm group-hover:flex group-focus-visible:flex group-has-[:focus-visible]:flex"
        :class="picker || moreOpen ? '!flex' : ''"
      >
        <UTooltip v-for="e in webhook ? [] : quickReactions" :key="e" :text="`React ${e}`">
          <template #content="{ ui }"><EmojiText :text="`React ${e}`" :class="ui.text()" /></template>
          <UButton
            color="neutral"
            variant="ghost"
            :aria-label="`React with ${e}`"
            :class="message.reactions.some(r => r.emoji === e && mineOf(r)) ? 'bg-primary/10 hover:bg-primary/20' : ''"
            @click="react(e)"
          >
            <EmojiGlyph :emoji="e" aria-hidden="true" class="text-base" />
          </UButton>
        </UTooltip>
        <UPopover
          v-if="!webhook"
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
        <UTooltip v-if="!webhook" text="Reply" :kbds="['R']">
          <UButton icon="i-lucide-reply" color="neutral" variant="ghost" aria-label="Reply" @click="actions.reply(message.id)" />
        </UTooltip>
        <UTooltip v-if="own && !webhook" text="Edit" :kbds="['arrowup']">
          <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" aria-label="Edit message" @click="startEdit" />
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
        <template #title><EmojiText :text="`${whoOpen} reactions`" /></template>
        <template #body>
          <ul class="flex flex-col gap-2">
            <li v-for="id in whoReaction?.userIds" :key="id" class="flex items-center gap-2 text-sm">
              <UAvatar :src="avatarSrc(byId.get(id))" :alt="nameOf(id)" icon="i-lucide-user" size="xs" /> <EmojiText :text="nameOf(id)" />
            </li>
          </ul>
        </template>
      </UModal>
      <ChatPollComposer v-if="message.poll" v-model:open="pollEditOpen" :channel-id="message.channelId" :message="message" />
    </div>
  </UContextMenu>
</template>

<style>
.chat-body .emoji {
  font-size: 1.2em;
}
.chat-emoji-only .emoji {
  font-size: 2.25rem;
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
