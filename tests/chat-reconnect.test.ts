// @vitest-environment happy-dom
import type { Ref } from 'vue'

import type { SocketFrame } from '../app/composables/useSocket'
import type { HistoryResult, MessageDto } from '../server/db/messages'

import { readFileSync } from 'node:fs'

import { transpile } from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, onScopeDispose, reactive, ref, watch } from 'vue'
import { parse } from 'vue/compiler-sfc'

import { atBottom, keepPosition, needsOlder } from '../app/utils/scroll'
import { createDb } from '../server/db/client'
import { createMessage, deleteMessage, listMessages } from '../server/db/messages'
import { channels, user } from '../server/db/schema'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => scopes.splice(0).forEach(scope => scope.stop()))
const message = (id: string, createdAt = 1): MessageDto => ({
  id,
  createdAt,
  channelId: 't',
  userId: 'b',
  body: id,
  editedAt: null,
  replyTo: null,
  attachments: [],
  reactions: [],
  previews: [],
})
const page = (messages: MessageDto[], hasMoreBefore = false, hasMoreAfter = false): HistoryResult => ({ messages, hasMoreBefore, hasMoreAfter })
const settle = async () => {
  for (let i = 0; i < 8; i++) await nextTick()
}

function setup() {
  const props = reactive<{ channelId: string; messageId?: string }>({ channelId: 't' })
  let receive!: (frame: SocketFrame) => void
  let reconnect!: () => void
  const fetch = vi.fn<(url: string, options: { query: Record<string, string> }) => Promise<HistoryResult>>()
  const toast = vi.fn()
  const read = vi.fn()
  const focused = ref(false)
  const globals = {
    exports: {},
    ref,
    reactive,
    computed,
    watch,
    nextTick,
    onScopeDispose,
    defineProps: () => props,
    useChannels: () => ({ data: ref([]) }),
    useChannelLabel: () => () => '',
    useUnread: () => ({}),
    useWindowFocus: () => focused,
    useMe: () => ({ data: ref({ id: 'a' }) }),
    useRecentReactions: () => ({ record: vi.fn() }),
    useUsers: () => ({ nameOf: (id: string) => id }),
    useSocket: () => ({
      on: (h: typeof receive) => {
        receive = h
      },
      onOpen: (h: typeof reconnect) => {
        reconnect = h
      },
    }),
    useToast: () => ({ add: toast, remove: vi.fn() }),
    useDrafts: () => ({ get: () => ({ reply: ref(null) }) }),
    useEventListener: vi.fn(),
    useResizeObserver: vi.fn(),
    useTick: () => ref(new Date()),
    provide: vi.fn(),
    chatActionsKey: Symbol(),
    onMounted: vi.fn(),
    $fetch: fetch,
    markChannelRead: read,
    atBottom,
    needsOlder,
    keepPosition,
  }
  const { descriptor } = parse(readFileSync('app/components/chat/ChannelView.vue', 'utf8'))
  const code = transpile(
    descriptor.scriptSetup!.content +
      '\nreturn { load, messages, hasMoreBefore, hasMoreAfter, loading, loadingMore, recoveryFailed, loadOlder, loadNewer, dividerId, maybeRead, scroller, setHold: () => { holdRead = true } }',
  )
  const scope = effectScope()
  scopes.push(scope)
  const state = scope.run(() => new Function(...Object.keys(globals), code)(...Object.values(globals))) as {
    load: (around?: string, keep?: boolean) => Promise<void>
    messages: Ref<MessageDto[]>
    hasMoreBefore: Ref<boolean>
    hasMoreAfter: Ref<boolean>
    loading: Ref<boolean>
    loadingMore: Ref<boolean>
    recoveryFailed: Ref<boolean>
    dividerId: Ref<string | null>
    scroller: Ref<HTMLElement | undefined>
    loadOlder: () => Promise<void>
    loadNewer: () => Promise<void>
    maybeRead: () => void
    setHold: () => void
  }
  return { ...state, props, fetch, toast, read, focused, scope, receive: (m: SocketFrame) => receive(m), reconnect: () => reconnect() }
}

async function loaded(messages = [message('anchor')]) {
  const h = setup()
  h.fetch.mockResolvedValueOnce(page(messages))
  await h.load()
  return h
}

describe('chat reconnect recovery', () => {
  it.each([false, true])('reaches all 60 offline messages through older paging (deleted anchor: %s)', async deleted => {
    const db = createDb(':memory:')
    db.insert(user).values({ id: 'a', name: 'a', email: 'a@x.dev', displayName: 'a' }).run()
    db.insert(channels).values({ id: 't', type: 'text', name: 't' }).run()
    const anchor = createMessage(db, 'a', 't', 'anchor', 1000)
    const h = await loaded([anchor])
    const offline = Array.from({ length: 60 }, (_, i) => createMessage(db, 'a', 't', `offline ${i}`, 1001 + i))
    if (deleted) deleteMessage(db, 'a', false, anchor.id)
    h.fetch.mockImplementation(async (_url, { query }) => listMessages(db, 't', query))
    h.reconnect()
    await settle()
    expect(h.messages.value.map(m => m.id)).toEqual(offline.slice(10).map(m => m.id))
    expect(h.hasMoreBefore.value).toBe(true)
    expect(h.hasMoreAfter.value).toBe(false)
    expect(h.fetch.mock.lastCall?.[1].query).toEqual({})
    h.scroller.value = document.createElement('div')
    await h.loadOlder()
    expect(h.messages.value.map(m => m.id)).toEqual([...(deleted ? [] : [anchor.id]), ...offline.map(m => m.id)])
    expect(h.hasMoreBefore.value).toBe(false)
    db.$client.close()
  })

  it.each([{ messages: [] }, { messages: [message('new')] }])('recovers an empty local history', async ({ messages }) => {
    const h = await loaded([])
    h.fetch.mockResolvedValueOnce(page(messages))
    h.reconnect()
    await settle()
    expect(h.messages.value).toEqual(messages)
    expect(h.recoveryFailed.value).toBe(false)
  })

  it('replays live changes after the snapshot and deduplicates/sorts new messages by timestamp and ID', async () => {
    const h = await loaded()
    const response = Promise.withResolvers<HistoryResult>()
    h.fetch.mockReturnValueOnce(response.promise)
    h.reconnect()
    h.receive({ type: 'message:new', message: message('z', 2) })
    h.receive({ type: 'message:new', message: message('b', 2) })
    h.receive({ type: 'message:edit', message: { ...message('b', 2), body: 'edited' } })
    h.receive({ type: 'reaction:update', channelId: 't', messageId: 'b', reactions: [{ emoji: '👍', userIds: ['a'] }] })
    h.receive({
      type: 'message:previews',
      channelId: 't',
      messageId: 'b',
      previews: [{ url: 'https://example.com', title: 'card', description: null, siteName: null, image: false }],
    })
    h.receive({ type: 'message:delete', channelId: 't', id: 'anchor' })
    response.resolve(page([message('anchor'), message('b', 2)]))
    await settle()
    expect(h.messages.value.map(m => m.id)).toEqual(['b', 'z'])
    expect(h.messages.value[0]).toMatchObject({ body: 'edited', reactions: [{ emoji: '👍', userIds: ['a'] }], previews: [{ title: 'card' }] })
  })

  it('discards obsolete recovery responses after A → B → A and after disposal', async () => {
    const h = await loaded()
    const old = Promise.withResolvers<HistoryResult>()
    h.fetch.mockReturnValueOnce(old.promise)
    h.reconnect()
    h.props.channelId = 'other'
    h.fetch.mockResolvedValueOnce(page([]))
    await h.load()
    h.props.channelId = 't'
    h.fetch.mockResolvedValueOnce(page([message('current')]))
    await h.load()
    old.resolve(page([message('stale')]))
    await settle()
    expect(h.messages.value.map(m => m.id)).toEqual(['current'])
    const disposed = Promise.withResolvers<HistoryResult>()
    h.fetch.mockReturnValueOnce(disposed.promise)
    h.reconnect()
    h.scope.stop()
    disposed.resolve(page([message('disposed')]))
    await settle()
    expect(h.messages.value).toEqual([])
  })

  it('coalesces reconnects during loading and preserves the unread hold during recovery', async () => {
    const h = await loaded()
    h.dividerId.value = 'anchor'
    h.setHold()
    h.focused.value = true
    const response = Promise.withResolvers<HistoryResult>()
    h.fetch.mockReturnValueOnce(response.promise).mockResolvedValueOnce(page([message('latest')]))
    h.reconnect()
    h.reconnect()
    h.reconnect()
    h.maybeRead()
    expect(h.read).not.toHaveBeenCalled()
    response.resolve(page([message('intermediate')]))
    await settle()
    expect(h.messages.value.map(m => m.id)).toEqual(['latest'])
    expect(h.dividerId.value).toBe('anchor')
    expect(h.read).not.toHaveBeenCalled()
    expect(h.fetch).toHaveBeenCalledTimes(3)
  })

  it('keeps a failed recovery blocked until its retry action succeeds', async () => {
    const h = await loaded()
    h.fetch.mockRejectedValueOnce(new Error('offline'))
    h.reconnect()
    await settle()
    expect(h.recoveryFailed.value).toBe(true)
    h.receive({ type: 'message:new', message: message('live') })
    expect(h.messages.value).toEqual([])
    h.focused.value = true
    h.maybeRead()
    expect(h.read).not.toHaveBeenCalled()
    h.fetch.mockResolvedValueOnce(page([message('live')]))
    h.toast.mock.lastCall![0].actions[0].onClick()
    await settle()
    expect(h.messages.value.map(m => m.id)).toEqual(['live'])
    expect(h.recoveryFailed.value).toBe(false)
    expect(h.read).toHaveBeenCalledWith('t')
  })

  it('runs recovery after a reconnect during the initial load and bypasses a message link for latest recovery', async () => {
    const h = setup()
    h.props.messageId = 'anchor'
    const initial = Promise.withResolvers<HistoryResult>()
    h.fetch.mockReturnValueOnce(initial.promise).mockResolvedValueOnce(page([message('latest')]))
    const loading = h.load()
    h.reconnect()
    initial.resolve(page([message('anchor')]))
    await loading
    await settle()
    expect(h.fetch.mock.lastCall?.[1].query).toEqual({})
    expect(h.messages.value.map(m => m.id)).toEqual(['latest'])
  })

  it('ignores old recovery errors and prevents old page cleanup from unlocking a new request', async () => {
    const h = await loaded()
    const old = Promise.withResolvers<HistoryResult>()
    h.fetch.mockReturnValueOnce(old.promise)
    h.reconnect()
    h.props.channelId = 'other'
    h.fetch.mockResolvedValueOnce(page([]))
    await h.load()
    old.reject(new Error('old recovery failed'))
    await settle()
    expect(h.toast).not.toHaveBeenCalled()
    expect(h.recoveryFailed.value).toBe(false)

    h.props.channelId = 't'
    h.fetch.mockResolvedValueOnce(page([message('current')], true))
    await h.load()
    h.scroller.value = document.createElement('div')
    const older = Promise.withResolvers<HistoryResult>()
    const newer = Promise.withResolvers<HistoryResult>()
    h.fetch.mockReturnValueOnce(older.promise)
    const stalePage = h.loadOlder()
    h.fetch.mockResolvedValueOnce(page([message('replacement')], true))
    h.reconnect()
    await settle()
    h.fetch.mockReturnValueOnce(newer.promise)
    const currentPage = h.loadOlder()
    older.reject(new Error('old page failed'))
    await stalePage
    expect(h.loadingMore.value).toBe(true)
    expect(h.toast).not.toHaveBeenCalled()
    newer.resolve(page([]))
    await currentPage
    expect(h.loadingMore.value).toBe(false)
    expect(h.messages.value.map(m => m.id)).toEqual(['replacement'])
  })

  it('retains a detached history window and its forward paging', async () => {
    const h = await loaded()
    h.hasMoreAfter.value = true
    h.reconnect()
    expect(h.messages.value.map(m => m.id)).toEqual(['anchor'])
    h.fetch.mockResolvedValueOnce(page([message('next', 2)]))
    await h.loadNewer()
    expect(h.messages.value.map(m => m.id)).toEqual(['anchor', 'next'])
    expect(h.hasMoreAfter.value).toBe(false)
  })
})
