<script setup lang="ts">
import type { AttachmentDto, HistoryResult, MessageDto } from '../../../server/db/messages'

const props = defineProps<{ channelId: string, messageId?: string }>()
const { data: channels } = useChannels()
const channel = computed(() => channels.value.find(c => c.id === props.channelId))
const label = useChannelLabel()
const unread = useUnread()
const focused = useWindowFocus()
const dividerId = ref<string | null>(null) // the "New messages" divider sits above this message
let holdRead = false // after "Mark as unread": don't auto-read until Esc or a channel switch
const { data: me } = useMe()
const { nameOf } = useUsers()
const socket = useSocket()
const toast = useToast()

const messages = ref<MessageDto[]>([])
const hasMoreBefore = ref(false)
const hasMoreAfter = ref(false)
const loading = ref(true)
const loadingMore = ref(false)
const denied = ref(false)
const highlightId = ref<string>()
const scroller = ref<HTMLElement>()
const content = ref<HTMLElement>()
// Stay glued to the bottom while images, previews, code highlighting and fonts settle; derived from the scroll position.
let pinned = false
let lastTop = 0 // scrollTop at the previous scroll event
let loadingNewer = false
let gen = 0 // bumped per load(), so a late page of the previous channel is dropped
const input = ref<{ focus: () => void, quote: (t: string) => void, restore: (md: string, files?: Upload[]) => void }>()
const pending = new Map<string, { md: string, files: Upload[] }>()
const replyId = ref<string | null>(null)
const editingId = ref<string | null>(null)
const lightbox = ref<AttachmentDto | null>(null)
const byIdMsg = (id: string) => messages.value.find(m => m.id === id)
const replyTarget = computed(() => {
  const m = replyId.value ? byIdMsg(replyId.value) : undefined
  return m ? { id: m.id, name: nameOf(m.userId), preview: previewText(m.body.split('\n').find(l => l.trim()) ?? '', nameOf).slice(0, 80) } : null
})
watch(() => props.channelId, () => { replyId.value = null; editingId.value = null })

const fetchPage = (query: Record<string, string>) =>
  $fetch<HistoryResult>(`/api/channels/${props.channelId}/messages`, { query })

async function load() {
  const mine = ++gen
  pinned = false
  lastTop = 0
  loading.value = true
  denied.value = false
  messages.value = []
  try {
    const r = await fetchPage(props.messageId ? { around: props.messageId } : { unread: '1' })
    if (mine !== gen) return
    dividerId.value = r.firstUnreadId ?? null
    holdRead = false
    messages.value = r.messages
    hasMoreBefore.value = r.hasMoreBefore
    hasMoreAfter.value = r.hasMoreAfter
  } catch (e: any) {
    if (mine !== gen) return
    if (e?.statusCode === 404 && props.messageId) { toast.add({ title: 'That message no longer exists', color: 'warning', icon: 'i-lucide-info' }); return navigateTo(`/c/${props.channelId}`, { replace: true }) }
    denied.value = true
  } finally {
    if (mine === gen) loading.value = false
  }
  if (mine !== gen) return
  await nextTick()
  if (props.messageId) jumpTo(props.messageId)
  else if (dividerId.value) document.getElementById(`msg-${dividerId.value}`)?.scrollIntoView({ block: 'start' })
  else { pinned = true; scrollToEnd() }
  maybeRead()
}

// Read only while the window is focused and the newest message is loaded.
function maybeRead() {
  if (!focused.value || loading.value || denied.value || hasMoreAfter.value || holdRead) return
  markChannelRead(props.channelId)
}
watch(focused, maybeRead)
watch(hasMoreAfter, maybeRead)
const markUnread = async (id: string) => {
  try {
    unread.set(props.channelId, await $fetch<UnreadState>(`/api/channels/${props.channelId}/unread`, { method: 'POST', body: { messageId: id } }))
    dividerId.value = id
    holdRead = true
  } catch { toast.add({ title: 'Could not mark as unread', color: 'error', icon: 'i-lucide-circle-alert' }) }
}
// Not defineShortcuts: it preventDefault()s, which stops modals from closing on Esc. An open dialog owns the key.
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || document.querySelector('[role="dialog"]')) return
  holdRead = false; dividerId.value = null; markChannelRead(props.channelId)
})

function scrollToEnd() {
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

function jumpTo(id: string) {
  const el = document.getElementById(`msg-${id}`)
  if (!el) return
  el.scrollIntoView({ block: 'center' })
  highlightId.value = id
  setTimeout(() => { if (highlightId.value === id) highlightId.value = undefined }, 2500)
}

async function loadOlder() {
  const el = scroller.value
  if (!el || loading.value || !messages.value.length || !needsOlder(el.scrollTop, hasMoreBefore.value, loadingMore.value)) return
  loadingMore.value = true
  const mine = gen
  const prevHeight = el.scrollHeight
  const prevTop = el.scrollTop
  try {
    const r = await fetchPage({ before: messages.value[0]!.id })
    if (mine !== gen) return
    messages.value = [...r.messages, ...messages.value]
    hasMoreBefore.value = r.hasMoreBefore
    await nextTick()
    el.scrollTop = keepPosition(prevTop, prevHeight, el.scrollHeight) // keep the view where it was
  } catch {
    toast.add({ title: 'Could not load older messages', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    loadingMore.value = false
  }
}

async function loadNewer() {
  if (!hasMoreAfter.value || loadingNewer) return
  loadingNewer = true
  try {
    const r = await fetchPage({ after: messages.value.at(-1)!.id })
    messages.value = [...messages.value, ...r.messages]
    hasMoreAfter.value = r.hasMoreAfter
  }
  finally { loadingNewer = false }
}

async function toPresent() {
  if (props.messageId) await navigateTo(`/c/${props.channelId}`)
  else { await load() }
}

function onScroll() {
  const el = scroller.value
  if (!el) return
  pinned = pinAfterScroll(pinned, lastTop, el) // keyboard, drag and find-in-page going up release it; late content growth doesn't
  lastTop = el.scrollTop
  loadOlder()
  if (hasMoreAfter.value && el.scrollHeight - el.scrollTop - el.clientHeight < 200) loadNewer()
}

// Content or viewport height changed: keep the bottom while pinned, and keep fetching while the page doesn't fill the view
// (no scroll event fires then). Browser scroll anchoring stays on: it holds the view while bodies above it render late.
useResizeObserver([content, scroller], () => {
  if (pinned) scrollToEnd()
  loadOlder()
})

// --- live events ---
const typers = reactive(new Map<string, number>())
const now = useTick(1000)
const typingNames = computed(() => [...typers].filter(([id, until]) => until > now.value.getTime() && id !== me.value?.id).map(([id]) => nameOf(id)))
const typingText = computed(() => {
  const n = typingNames.value
  return n.length === 0 ? '' : n.length === 1 ? `${n[0]} is typing…` : n.length === 2 ? `${n[0]} and ${n[1]} are typing…` : 'Several people are typing…'
})

socket.on((m) => {
  if (m.type === 'message:new' && m.message.channelId === props.channelId) {
    typers.delete(m.message.userId)
    pending.delete(m.nonce)
    if (hasMoreAfter.value || messages.value.some(x => x.id === m.message.id)) return
    if (dividerId.value === null && m.message.userId !== me.value?.id && !focused.value) dividerId.value = m.message.id
    const el = scroller.value
    const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120 || m.message.userId === me.value?.id
    messages.value.push(m.message)
    if (atBottom) nextTick(scrollToEnd)
    if (m.message.userId !== me.value?.id) nextTick(maybeRead)
  } else if (m.type === 'message:error') {
    const sent = pending.get(m.nonce)
    pending.delete(m.nonce)
    toast.add({ title: m.error, color: 'error', icon: 'i-lucide-circle-alert' })
    if (sent) input.value?.restore(sent.md, sent.files)
  } else if (m.type === 'message:edit' && m.message.channelId === props.channelId) {
    const i = messages.value.findIndex(x => x.id === m.message.id)
    if (i >= 0) messages.value[i] = m.message
  } else if (m.type === 'message:previews' && m.channelId === props.channelId) {
    const x = byIdMsg(m.messageId)
    if (x) x.previews = m.previews
  } else if (m.type === 'message:delete' && m.channelId === props.channelId) {
    removeMessage(m.id)
  } else if (m.type === 'reaction:update' && m.channelId === props.channelId) {
    const x = byIdMsg(m.messageId)
    if (x) x.reactions = m.reactions
  } else if (m.type === 'typing' && m.channelId === props.channelId) {
    typers.set(m.userId, Date.now() + 5000)
  }
})

function removeMessage(id: string) {
  messages.value = messages.value.filter(x => x.id !== id)
  if (dividerId.value === id) dividerId.value = null
  if (replyId.value === id) replyId.value = null
  if (editingId.value === id) editingId.value = null
  // Replies to it now say "Original message deleted".
  for (const x of messages.value) if (x.replyTo?.id === id) x.replyTo = { ...x.replyTo, preview: '', deleted: true }
}

function send(md: string, files: Upload[]) {
  const nonce = crypto.randomUUID()
  pending.set(nonce, { md, files })
  const ok = socket.send({
    type: 'message:send', channelId: props.channelId, body: md, nonce, replyToId: replyId.value,
    attachments: files.map(f => ({ id: f.id, spoiler: f.spoiler }))
  })
  if (!ok) {
    pending.delete(nonce)
    toast.add({ title: 'Not connected, try again in a moment', color: 'error', icon: 'i-lucide-wifi-off' })
    input.value?.restore(md, files)
    return
  }
  replyId.value = null
}

// --- edit, delete, react, reply ---
const apiError = (e: any, fallback: string) => toast.add({ title: errorText(e, fallback), color: 'error', icon: 'i-lucide-circle-alert' })

provide(chatActionsKey, {
  async edit(id, body) {
    try {
      const updated = await $fetch<MessageDto>(`/api/messages/${id}`, { method: 'PATCH', body: { body } })
      const i = messages.value.findIndex(x => x.id === id)
      if (i >= 0) messages.value[i] = updated
      return true
    } catch (e) { apiError(e, 'Could not save the edit'); return false }
  },
  async remove(id) {
    try { await $fetch(`/api/messages/${id}`, { method: 'DELETE' }); removeMessage(id) } catch (e) { apiError(e, 'Could not delete the message') }
  },
  async react(id, emoji, on) {
    try {
      const r = await $fetch<{ reactions: MessageDto['reactions'] }>(`/api/messages/${id}/reactions`, { method: 'POST', body: { emoji, on } })
      const x = byIdMsg(id)
      if (x) x.reactions = r.reactions
    } catch (e) { apiError(e, 'Could not react') }
  },
  reply(id) { replyId.value = id; editingId.value = null; nextTick(() => input.value?.focus()) },
  jump(id) {
    if (byIdMsg(id)) jumpTo(id)
    else navigateTo(`/c/${props.channelId}/m/${id}`)
  },
  async removePreview(id, url) {
    try { await $fetch(`/api/messages/${id}/previews`, { method: 'DELETE', body: { url } }) } catch (e) { apiError(e, 'Could not remove the preview') }
  },
  openImage: f => { lightbox.value = f }
})

// `↑` in an empty input edits your last message.
function editLast() {
  const mine = [...messages.value].reverse().find(m => m.userId === me.value?.id)
  if (mine) editingId.value = mine.id
}
const endEdit = () => { editingId.value = null; nextTick(() => input.value?.focus()) }

// --- rendering helpers: grouping and date dividers ---
const rows = computed(() => {
  const out: Array<{ key: string, divider?: string, message?: MessageDto, grouped?: boolean }> = []
  let prev: MessageDto | undefined
  for (const m of messages.value) {
    const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)
    if (newDay) out.push({ key: `d-${m.id}`, divider: dayLabel(m.createdAt) })
    out.push({ key: m.id, message: m, grouped: !newDay && prev!.userId === m.userId && m.createdAt - prev!.createdAt < GROUP_MS })
    prev = m
  }
  return out
})

// Client only: history needs the session cookie, which a server-side $fetch doesn't carry.
onMounted(() => watch(() => [props.channelId, props.messageId], load, { immediate: true }))
// After a reconnect, pull what we missed while offline.
socket.onOpen(() => { if (!loading.value && !hasMoreAfter.value && messages.value.length) fetchPage({ after: messages.value.at(-1)!.id }).then((r) => { const seen = new Set(messages.value.map(x => x.id)); messages.value.push(...r.messages.filter(x => !seen.has(x.id))) }).catch(() => {}) })
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div v-if="denied" class="flex flex-1 items-center justify-center gap-2 text-muted">
      <UIcon name="i-lucide-lock" /> No access
    </div>
    <template v-else>
      <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto pb-9" @scroll.passive="onScroll">
        <div ref="content">
        <div v-if="loading" class="p-6 text-center text-sm text-muted">Loading…</div>
        <template v-else>
          <div v-if="!hasMoreBefore" class="px-4 pt-6 pb-2 text-sm text-muted">
            <UIcon :name="channel?.type === 'dm' ? 'i-lucide-message-circle' : 'i-lucide-hash'" class="size-5" />
            <div class="font-bold text-default">{{ channel?.type === 'dm' ? `This is the start of your conversation with ${label(channel).slice(1)}` : `Welcome to ${label(channel)}` }}</div>
            <div v-if="!messages.length">No messages yet. Say something!</div>
          </div>
          <div v-else class="flex h-9 items-center justify-center gap-2 text-xs text-muted">
            <template v-if="loadingMore"><UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" /> Loading older messages…</template>
          </div>
          <template v-for="r in rows" :key="r.key">
            <div v-if="r.divider" class="my-3 flex items-center gap-3 px-4 text-xs text-muted">
              <USeparator class="flex-1" /><span>{{ r.divider }}</span><USeparator class="flex-1" />
            </div>
            <template v-else>
              <div v-if="dividerId === r.message!.id" class="my-2 flex items-center gap-3 px-4 text-xs font-bold text-error">
                <USeparator color="error" class="flex-1" /><span>New messages</span><USeparator color="error" class="flex-1" />
              </div>
              <ChatMessage
                :message="r.message!" :grouped="r.grouped! && dividerId !== r.message!.id" :highlighted="highlightId === r.message!.id"
                :editing="editingId === r.message!.id" @quote="input?.quote($event)" @mark-unread="markUnread"
                @edit-start="editingId = $event" @edit-end="endEdit"
              />
            </template>
          </template>
        </template>
        </div>
      </div>
      <div v-if="hasMoreAfter" class="flex justify-center py-1">
        <UButton label="Jump to present" icon="i-lucide-chevrons-down" size="xs" @click="toPresent" />
      </div>
      <div class="h-5 px-4 text-xs text-muted" aria-live="polite">{{ typingText }}</div>
      <ClientOnly>
        <ChatMessageInput
          :key="channelId" ref="input" :channel-id="channelId" :channel-name="label(channel)" :reply-to="replyTarget"
          @send="send" @typing="socket.send({ type: 'typing', channelId })" @cancel-reply="replyId = null" @edit-last="editLast"
        />
        <ChatImageLightbox :file="lightbox" @close="lightbox = null" />
      </ClientOnly>
    </template>
  </div>
</template>
