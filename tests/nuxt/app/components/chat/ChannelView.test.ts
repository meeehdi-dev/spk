import type { SocketFrame } from '~/composables/useSocket'
import type { HistoryResult, MessageDto } from '~~/server/db/messages'

import { mockComponent, mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getQuery, getRouterParam, readBody } from 'h3'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import ChannelView from '~/components/chat/ChannelView.vue'
import ChatMessage from '~/components/chat/ChatMessage.vue'
import { createDb } from '~~/server/db/client'
import { createMessage, deleteMessage, listMessages } from '~~/server/db/messages'
import { channels, user } from '~~/server/db/schema'
import { mountInApp, requestError } from '~~/tests/fixtures/app'

const mocks = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    focused: ref(false),
    frames: new Set<(m: SocketFrame) => void>(),
    opens: new Set<() => void>(),
    toast: vi.fn(),
    read: vi.fn(),
  }
})
mockNuxtImport('useSocket', () => () => ({
  on: (h: (m: SocketFrame) => void) => mocks.frames.add(h),
  onOpen: (h: () => void) => mocks.opens.add(h),
  send: () => true,
}))
mockNuxtImport('useToast', () => () => ({ add: mocks.toast, remove: vi.fn() }))
mockNuxtImport('useWindowFocus', () => () => mocks.focused)
mockNuxtImport('markChannelRead', () => mocks.read)
mockComponent('ChatMessageInput', { setup: () => () => null })

interface State {
  load: (around?: string, keep?: boolean) => Promise<void>
  messages: MessageDto[]
  hasMoreBefore: boolean
  hasMoreAfter: boolean
  loading: boolean
  loadingMore: boolean
  recoveryFailed: boolean
  dividerId: string | null
  holdRead: boolean
  loadOlder: () => Promise<void>
  loadNewer: () => Promise<void>
  maybeRead: () => void
}

const history = vi.fn<(channelId: string, query: Record<string, string>) => Promise<HistoryResult> | HistoryResult>()
const reactions = vi.fn<(body: { emoji: string; on: boolean }) => Promise<{ reactions: MessageDto['reactions'] }> | { reactions: MessageDto['reactions'] }>()
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
  for (let i = 0; i < 5; i++) await flushPromises()
}
const receive = (m: SocketFrame) => mocks.frames.forEach(h => h(m))
const reconnect = () => mocks.opens.forEach(h => h())

beforeAll(() => {
  registerEndpoint('/api/profile/me', () => ({ id: 'a', email: 'a@x.dev', role: 'user', displayName: 'a', avatarKey: null }))
  registerEndpoint('/api/users', () => ['a', 'b'].map(id => ({ id, displayName: id, avatarKey: null, role: 'user' })))
  registerEndpoint('/api/channels', () => [
    { id: 't', type: 'text', name: 't' },
    { id: 'other', type: 'text', name: 'other' },
  ])
  for (const id of ['t', 'other']) registerEndpoint(`/api/channels/${id}/messages`, event => history(id, getQuery(event) as Record<string, string>))
  registerEndpoint('/api/messages/m/reactions', { method: 'POST', handler: async event => reactions(await readBody(event)) })
  registerEndpoint('/api/channels/t/unread', { method: 'POST', handler: event => ({ unread: 0, mentions: 0, id: getRouterParam(event, 'id') }) })
})
beforeEach(() => {
  history.mockReset()
  reactions.mockReset()
  mocks.frames.clear()
  mocks.opens.clear()
  mocks.focused.value = false
  vi.clearAllMocks()
  localStorage.clear()
})

async function mountChannel(initial?: HistoryResult | Promise<HistoryResult>, props = reactive<{ channelId: string; messageId?: string }>({ channelId: 't' })) {
  if (initial) history.mockReturnValueOnce(initial)
  const wrapper = await mountInApp(ChannelView, props)
  const component = wrapper.findComponent(ChannelView)
  return { wrapper, component, props, state: component.vm as unknown as State }
}

async function loaded(messages = [message('anchor')]) {
  const mounted = await mountChannel(page(messages))
  await vi.waitFor(() => expect(mounted.state.loading).toBe(false))
  return mounted
}

describe('chat reconnect recovery', () => {
  it.each([false, true])('reaches all 60 offline messages through older paging (deleted anchor: %s)', async deleted => {
    const db = createDb(':memory:')
    db.insert(user).values({ id: 'a', name: 'a', email: 'a@x.dev', displayName: 'a' }).run()
    db.insert(channels).values({ id: 't', type: 'text', name: 't' }).run()
    const anchor = createMessage(db, 'a', 't', 'anchor', 1000)
    const { state } = await loaded([anchor])
    const offline = Array.from({ length: 60 }, (_, i) => createMessage(db, 'a', 't', `offline ${i}`, 1001 + i))
    if (deleted) deleteMessage(db, 'a', false, anchor.id)
    history.mockImplementation((_id, query) => listMessages(db, 't', query))
    reconnect()
    await settle()
    expect(state.messages.map(m => m.id)).toEqual(offline.slice(10).map(m => m.id))
    expect(state.hasMoreBefore).toBe(true)
    expect(state.hasMoreAfter).toBe(false)
    expect(history.mock.lastCall?.[1]).toEqual({})
    await state.loadOlder()
    expect(state.messages.map(m => m.id)).toEqual([...(deleted ? [] : [anchor.id]), ...offline.map(m => m.id)])
    expect(state.hasMoreBefore).toBe(false)
    db.$client.close()
  })

  it.each([{ messages: [] }, { messages: [message('new')] }])('recovers an empty local history', async ({ messages }) => {
    const { state } = await loaded([])
    history.mockResolvedValueOnce(page(messages))
    reconnect()
    await settle()
    expect(state.messages).toEqual(messages)
    expect(state.recoveryFailed).toBe(false)
  })

  it('replays live changes after the snapshot and deduplicates/sorts new messages by timestamp and ID', async () => {
    const { state } = await loaded()
    const response = Promise.withResolvers<HistoryResult>()
    history.mockReturnValueOnce(response.promise)
    reconnect()
    receive({ type: 'message:new', message: message('z', 2) })
    receive({ type: 'message:new', message: message('b', 2) })
    receive({ type: 'message:edit', message: { ...message('b', 2), body: 'edited' } })
    receive({ type: 'reaction:update', channelId: 't', messageId: 'b', reactions: [{ emoji: '👍', userIds: ['a'] }] })
    receive({
      type: 'message:previews',
      channelId: 't',
      messageId: 'b',
      previews: [{ url: 'https://example.com', title: 'card', description: null, siteName: null, image: false }],
    })
    receive({ type: 'message:delete', channelId: 't', id: 'anchor' })
    response.resolve(page([message('anchor'), message('b', 2)]))
    await settle()
    expect(state.messages.map(m => m.id)).toEqual(['b', 'z'])
    expect(state.messages[0]).toMatchObject({ body: 'edited', reactions: [{ emoji: '👍', userIds: ['a'] }], previews: [{ title: 'card' }] })
  })

  it('discards obsolete recovery responses after A → B → A and after disposal', async () => {
    const { wrapper, props, state } = await loaded()
    const old = Promise.withResolvers<HistoryResult>()
    history.mockReturnValueOnce(old.promise)
    reconnect()
    history.mockResolvedValueOnce(page([]))
    props.channelId = 'other'
    await settle()
    history.mockResolvedValueOnce(page([message('current')]))
    props.channelId = 't'
    await settle()
    old.resolve(page([message('stale')]))
    await settle()
    expect(state.messages.map(m => m.id)).toEqual(['current'])
    const disposed = Promise.withResolvers<HistoryResult>()
    history.mockReturnValueOnce(disposed.promise)
    reconnect()
    await settle()
    wrapper.unmount()
    disposed.resolve(page([message('disposed')]))
    await settle()
    expect(state.messages).toEqual([])
  })

  it('coalesces reconnects during loading and preserves the unread hold during recovery', async () => {
    const { state } = await loaded()
    state.dividerId = 'anchor'
    state.holdRead = true
    mocks.focused.value = true
    const response = Promise.withResolvers<HistoryResult>()
    history.mockReturnValueOnce(response.promise).mockResolvedValueOnce(page([message('latest')]))
    reconnect()
    reconnect()
    reconnect()
    state.maybeRead()
    expect(mocks.read).not.toHaveBeenCalled()
    response.resolve(page([message('intermediate')]))
    await settle()
    expect(state.messages.map(m => m.id)).toEqual(['latest'])
    expect(state.dividerId).toBe('anchor')
    expect(mocks.read).not.toHaveBeenCalled()
    expect(history).toHaveBeenCalledTimes(3)
  })

  it('keeps a failed recovery blocked until its retry action succeeds', async () => {
    const { state } = await loaded()
    history.mockRejectedValueOnce(requestError('offline'))
    reconnect()
    await settle()
    expect(state.recoveryFailed).toBe(true)
    receive({ type: 'message:new', message: message('live') })
    expect(state.messages).toEqual([])
    mocks.focused.value = true
    state.maybeRead()
    expect(mocks.read).not.toHaveBeenCalled()
    history.mockResolvedValueOnce(page([message('live')]))
    mocks.toast.mock.lastCall![0].actions[0].onClick()
    await settle()
    expect(state.messages.map(m => m.id)).toEqual(['live'])
    expect(state.recoveryFailed).toBe(false)
    expect(mocks.read).toHaveBeenCalledWith('t')
  })

  it('runs recovery after a reconnect during the initial load and bypasses a message link for latest recovery', async () => {
    const initial = Promise.withResolvers<HistoryResult>()
    history.mockReturnValueOnce(initial.promise).mockResolvedValueOnce(page([message('latest')]))
    const { state } = await mountChannel(undefined, reactive({ channelId: 't', messageId: 'anchor' }))
    reconnect()
    initial.resolve(page([message('anchor')]))
    await settle()
    expect(history.mock.lastCall?.[1]).toEqual({})
    expect(state.messages.map(m => m.id)).toEqual(['latest'])
  })

  it('ignores old recovery errors and prevents old page cleanup from unlocking a new request', async () => {
    const { props, state } = await loaded()
    const old = Promise.withResolvers<HistoryResult>()
    history.mockReturnValueOnce(old.promise)
    reconnect()
    history.mockResolvedValueOnce(page([]))
    props.channelId = 'other'
    await settle()
    old.reject(requestError('old recovery failed'))
    await settle()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(state.recoveryFailed).toBe(false)

    history.mockResolvedValueOnce(page([message('current')], true))
    props.channelId = 't'
    await settle()
    const older = Promise.withResolvers<HistoryResult>()
    const newer = Promise.withResolvers<HistoryResult>()
    history.mockReturnValueOnce(older.promise)
    const stalePage = state.loadOlder()
    history.mockResolvedValueOnce(page([message('replacement')], true))
    reconnect()
    await settle()
    history.mockReturnValueOnce(newer.promise)
    const currentPage = state.loadOlder()
    older.reject(requestError('old page failed'))
    await stalePage
    expect(state.loadingMore).toBe(true)
    expect(mocks.toast).not.toHaveBeenCalled()
    newer.resolve(page([]))
    await currentPage
    expect(state.loadingMore).toBe(false)
    expect(state.messages.map(m => m.id)).toEqual(['replacement'])
  })

  it('retains a detached history window and its forward paging', async () => {
    const { state } = await loaded()
    state.hasMoreAfter = true
    reconnect()
    expect(state.messages.map(m => m.id)).toEqual(['anchor'])
    history.mockResolvedValueOnce(page([message('next', 2)]))
    await state.loadNewer()
    expect(state.messages.map(m => m.id)).toEqual(['anchor', 'next'])
    expect(state.hasMoreAfter).toBe(false)
  })
})

describe('message rows', () => {
  it('gives each row the scroller and content elements so the toolbar can follow layout changes', async () => {
    const { component } = await loaded()
    const row = component.findComponent(ChatMessage)
    const scroller = row.props('scroller')!,
      content = row.props('content')!
    expect(scroller).toBeInstanceOf(HTMLElement)
    expect(content).toBeInstanceOf(HTMLElement)
    expect(scroller).not.toBe(content)
    expect(scroller.contains(content)).toBe(true)
  })

  it('records only successful reactions, for the account that initiated them', async () => {
    const { component, state } = await loaded([{ ...message('m'), userId: 'a' }])
    const quick = () => useRecentReactions().quickReactions.value
    const click = async (emoji: string) => {
      await component.find(`button[aria-label="React with ${emoji}"]`).trigger('click')
      await settle()
    }
    reactions.mockResolvedValueOnce({ reactions: [{ emoji: '😂', userIds: ['a'] }] })
    await click('😂')
    expect(reactions).toHaveBeenLastCalledWith({ emoji: '😂', on: true })
    expect(quick()).toEqual(['😂', '👍', '❤️'])
    expect(state.messages[0]!.reactions).toEqual([{ emoji: '😂', userIds: ['a'] }])
    reactions.mockResolvedValueOnce({ reactions: [] })
    await click('😂')
    expect(reactions).toHaveBeenLastCalledWith({ emoji: '😂', on: false })
    expect(quick()).toEqual(['😂', '👍', '❤️'])
    reactions.mockRejectedValueOnce(requestError('offline'))
    await click('❤️')
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ color: 'error', icon: 'i-lucide-circle-alert' }))
    expect(quick()).toEqual(['😂', '👍', '❤️'])

    const response = Promise.withResolvers<{ reactions: MessageDto['reactions'] }>()
    reactions.mockReturnValueOnce(response.promise)
    const me = useNuxtData<{ id: string }>('me').data
    const pending = click('👍')
    await flushPromises()
    me.value = { ...me.value!, id: 'b' }
    response.resolve({ reactions: [] })
    await pending
    expect(quick()).toEqual(['👍', '❤️', '😂'])
    expect(localStorage.getItem('spk:recent-reactions:b')).toBeNull()
    me.value = { ...me.value!, id: 'a' }
    expect(quick()).toEqual(['👍', '😂', '❤️'])
  })
})
