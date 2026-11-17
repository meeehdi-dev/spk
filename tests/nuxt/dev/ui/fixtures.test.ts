import type { SocketFrame } from '~/composables/useSocket'
import type { MessageDto } from '~~/server/db/messages'

import { assert, beforeEach, expect, it } from 'vitest'

import { receiveMessage, resetScenario, sandboxApi, sandboxSocketSend, scenario, subscribeSocket } from '~~/dev/ui/fixtures'
import { useVoice } from '~~/dev/ui/voice'

const api = (path: string, method = 'GET', body = {}) => sandboxApi(new URL(path, 'http://localhost'), method, body)

beforeEach(() => resetScenario())

it('provides a fake authenticated user, populated channels, presence, and independent unread marks', () => {
  expect(api('/api/profile/me')).toMatchObject({ id: 'ui-me', role: 'admin' })
  expect(api('/api/channels')).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'ui-voice' }), expect.objectContaining({ id: 'ui-dm' })]))
  expect(api('/api/users/presence')).toMatchObject({ 'ui-sam': 'idle' })
  expect(api('/api/unread')).toMatchObject({ 'ui-unread': { unread: 3, mentions: 1 }, 'ui-dm': { unread: 1, mentions: 0 } })
  expect(api('/api/channels/ui-dm/messages')).toMatchObject({
    firstUnreadId: 'ui-message-9',
    messages: [
      { id: 'ui-message-8', userId: 'ui-me' },
      { id: 'ui-message-9', userId: 'ui-alex' },
    ],
  })
  expect(api('/api/channels/ui-unread/messages?unread=1')).toMatchObject({ firstUnreadId: 'ui-message-5' })
  expect(api('/api/channels/ui-unread/read', 'POST')).toEqual({ unread: 0, mentions: 0 })
  expect(api('/api/channels/ui-unread/unread', 'POST', { messageId: 'ui-message-6' })).toEqual({ unread: 2, mentions: 1 })
  expect(api('/api/unread')).toMatchObject({ 'ui-general': { unread: 0, mentions: 0 }, 'ui-unread': { unread: 2, mentions: 1 } })
})

it('sends, replies, edits, reacts, searches, and deletes only in memory', () => {
  const existingIds = ['ui-general', 'ui-unread', 'ui-dm', 'ui-showcase'].flatMap(channel =>
    (api(`/api/channels/${channel}/messages`) as { messages: MessageDto[] }).messages.map(m => m.id),
  )
  const frames: SocketFrame[] = []
  const off = subscribeSocket(frame => frames.push(frame))
  try {
    expect(sandboxSocketSend({ type: 'message:send', channelId: 'ui-general', body: 'A sandbox reply', replyToId: 'ui-message-1', nonce: 'test' })).toBe(true)
    const sent = frames.at(-1)
    assert(sent?.type === 'message:new')
    const id = sent.message.id
    expect(id).toMatch(/^ui-message-\d+$/)
    expect(existingIds).not.toContain(id)
    expect(sent).toMatchObject({ nonce: 'test', message: { userId: 'ui-me', body: 'A sandbox reply', replyTo: { id: 'ui-message-1' } } })
    expect(api('/api/channels/ui-general/messages')).toMatchObject({ messages: expect.arrayContaining([sent.message]) })
    expect(api(`/api/messages/${id}`, 'PATCH', { body: 'Updated sandbox reply' })).toMatchObject({
      body: 'Updated sandbox reply',
      editedAt: expect.any(Number),
    })
    expect(api(`/api/messages/${id}/reactions`, 'POST', { emoji: '✨', on: true })).toEqual({ reactions: [{ emoji: '✨', userIds: ['ui-me'] }] })
    expect(api(`/api/messages/${id}/reactions`, 'POST', { emoji: '✨', on: true })).toEqual({ reactions: [{ emoji: '✨', userIds: ['ui-me'] }] })
    expect(api('/api/search?q=updated&scope=channel&channelId=ui-general')).toMatchObject({ results: [{ messageId: id }], nextCursor: null })
    api(`/api/messages/${id}`, 'DELETE')
    expect(frames.at(-1)).toMatchObject({ type: 'message:delete', id })
    expect(api('/api/search?q=updated')).toEqual({ results: [], nextCursor: null })
    expect(() => api('/api/messages/ui-message-1', 'PATCH', { body: 'not mine' })).toThrow('own messages')
    sandboxSocketSend({ type: 'message:send', channelId: 'missing', body: 'bad', nonce: 'bad' })
    expect(frames.at(-1)).toMatchObject({ type: 'message:error', nonce: 'bad' })
  } finally {
    off()
  }
})

it('keeps the original nine IDs stable and adds useful showcase messages after them', async () => {
  const history = (channel: string) => (api(`/api/channels/${channel}/messages`) as { messages: MessageDto[] }).messages
  const original = ['ui-general', 'ui-unread', 'ui-dm'].flatMap(history)
  expect(original.map(m => m.id)).toEqual(Array.from({ length: 9 }, (_, i) => `ui-message-${i + 1}`))
  expect(api('/api/channels')).toContainEqual({ id: 'ui-showcase', type: 'text', name: 'ui-showcase' })
  const showcase = history('ui-showcase')
  expect(showcase.length).toBeGreaterThanOrEqual(9)
  expect(showcase.every(m => Number(m.id.replace('ui-message-', '')) > 9)).toBe(true)
  expect(new Set([...original, ...showcase].map(m => m.id)).size).toBe(original.length + showcase.length)
  expect(showcase.some(m => /\S{400}/.test(m.body))).toBe(true)
  expect(showcase.some(m => m.body.split('\n\n').filter(p => p.length > 500).length >= 3)).toBe(true)
  const edited = showcase.find(m => m.editedAt !== null)
  assert(edited)
  expect(edited.editedAt).toBeGreaterThan(edited.createdAt)
  expect(showcase).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ replyTo: { id: edited.id, userId: edited.userId, preview: edited.body, deleted: false } }),
      expect.objectContaining({ replyTo: expect.objectContaining({ deleted: true, preview: '' }) }),
      expect.objectContaining({ body: expect.stringContaining('||') }),
      expect.objectContaining({ body: expect.stringContaining('<@ui-me>') }),
    ]),
  )
  const deleted = showcase.find(m => m.replyTo?.deleted)
  expect([...original, ...showcase].some(m => m.id === deleted?.replyTo?.id)).toBe(false)
  expect(showcase.some(m => m.reactions.length >= 10 && m.reactions.every(r => r.userIds.length > 1))).toBe(true)
  const previews = showcase.flatMap(m => m.previews)
  expect(previews).toEqual([
    { url: 'https://example.test/ui-sandbox', title: 'UI sandbox guide', description: expect.any(String), siteName: 'Sandbox', image: false },
  ])
  const attachments = showcase.flatMap(m => m.attachments)
  expect(attachments).toHaveLength(1)
  const file = attachments[0]!
  expect(file.filename).toBe('sandbox.ts')
  expect(file.mime).toBe('text/plain')
  const { url } = api(`/api/attachments/${file.id}?json=1`) as { url: string }
  expect(url).toMatch(/^data:text\/plain/)
  const response = await fetch(url, { headers: { Range: 'bytes=0-65535' } })
  expect(response.ok).toBe(true)
  const code = await response.text()
  expect(code).toContain('export const greeting')
  expect(new TextEncoder().encode(code).length).toBe(file.size)
  expect(api('/api/changelog')).toEqual({ commits: [], head: null, nextPage: null })
})

it('receives remote messages with independent unread updates and lets active consumers mark them read', () => {
  const frames: SocketFrame[] = []
  const off = subscribeSocket(frame => {
    frames.push(frame)
    if (frame.type === 'message:new' && frame.message.channelId === 'ui-general') api('/api/channels/ui-general/read', 'POST')
  })
  try {
    const incoming = receiveMessage('ui-unread')
    expect(incoming).toMatchObject({ channelId: 'ui-unread', userId: 'ui-alex' })
    expect(frames).toEqual([
      { type: 'unread:update', channelId: 'ui-unread', unread: 4, mentions: 1 },
      { type: 'message:new', message: incoming },
    ])
    expect(api('/api/channels/ui-unread/messages')).toMatchObject({
      firstUnreadId: 'ui-message-5',
      messages: expect.arrayContaining([incoming]),
    })
    incoming.body = 'external mutation'
    expect(api(`/api/messages/${incoming.id}`)).toMatchObject({ body: 'A new incoming message from the UI sandbox.' })
    const active = receiveMessage('ui-general')
    expect(active.userId).toBe('ui-alex')
    expect(api('/api/unread')).toMatchObject({ 'ui-general': { unread: 0, mentions: 0 }, 'ui-unread': { unread: 4, mentions: 1 } })
    const dm = receiveMessage('ui-dm')
    expect(dm.userId).toBe('ui-alex')
    expect(api('/api/unread')).toMatchObject({ 'ui-dm': { unread: 2, mentions: 0 } })
    expect(api('/api/channels')).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'ui-dm', lastActivityAt: dm.createdAt })]))
    api('/api/dms', 'POST', { userId: 'ui-sam' })
    expect(receiveMessage('ui-dm-ui-sam').userId).toBe('ui-sam')
    expect(api('/api/unread')).toMatchObject({ 'ui-dm-ui-sam': { unread: 1, mentions: 0 } })
    const before = api('/api/unread')
    const frameCount = frames.length
    expect(() => receiveMessage('missing')).toThrow('Sandbox channel not found')
    expect(() => receiveMessage('ui-voice')).toThrow('Sandbox channel not found')
    expect(api('/api/unread')).toEqual(before)
    expect(frames).toHaveLength(frameCount)
  } finally {
    off()
  }
})

it('opens local DMs, searches their messages by scope, and updates nickname and presence', () => {
  expect(api('/api/dms', 'POST', { userId: 'ui-alex' })).toEqual({ id: 'ui-dm' })
  expect(api('/api/dms', 'POST', { userId: 'ui-sam' })).toEqual({ id: 'ui-dm-ui-sam' })
  sandboxSocketSend({ type: 'message:send', channelId: 'ui-dm-ui-sam', body: 'Private sandbox note' })
  expect(api('/api/search?q=private&scope=dms')).toMatchObject({ results: [{ channelId: 'ui-dm-ui-sam' }] })
  expect(api('/api/search?q=private&scope=channels')).toMatchObject({ results: [] })
  api('/api/profile/nickname', 'POST', { displayName: 'Sandbox You' })
  expect(api('/api/profile/me')).toMatchObject({ displayName: 'Sandbox You' })
  expect(sandboxSocketSend({ type: 'presence:set', status: 'busy' })).toBe(true)
  expect(api('/api/users/presence')).toMatchObject({ 'ui-me': 'busy' })
})

it('resets data deterministically along with voice and supports empty and error scenarios', () => {
  const initial = api('/api/channels/ui-general/messages')
  sandboxSocketSend({ type: 'message:send', channelId: 'ui-general', body: 'temporary' })
  resetScenario('empty')
  expect(scenario.value).toBe('empty')
  expect(api('/api/channels/ui-general/messages')).toMatchObject({ messages: [] })
  expect(api('/api/unread')).toMatchObject({ 'ui-unread': { unread: 0, mentions: 0 }, 'ui-dm': { unread: 0, mentions: 0 } })
  expect(api('/api/channels/ui-showcase/messages')).toMatchObject({ messages: [] })
  expect(useVoice().channelId.value).toBeNull()
  resetScenario('errors')
  expect(() => api('/api/channels/ui-general/messages')).toThrow('Simulated sandbox history failure')
  expect(useVoice().audioBlocked.value).toBe(true)
  resetScenario('populated')
  expect(api('/api/channels/ui-general/messages')).toEqual(initial)
  expect(useVoice().channelId.value).toBe('ui-voice')
  // API consumers cannot mutate fixture state by retaining a returned object.
  const profile = api('/api/profile/me') as { displayName: string }
  profile.displayName = 'Changed externally'
  expect(api('/api/profile/me')).toMatchObject({ displayName: 'You' })
})
