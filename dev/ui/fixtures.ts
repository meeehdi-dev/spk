import type { Presence } from '#shared/utils/presence'
import type { Me } from '~/composables/useMe'
import type { SocketFrame } from '~/composables/useSocket'
import type { UnreadState } from '~/composables/useUnread'
import type { ChannelEntry, UserEntry } from '~/composables/useUsers'
import type { MessageDto } from '~~/server/db/messages'

import { readonly, ref } from 'vue'

import { resetVoiceScenario } from './voice'

export const scenarioPresets = ['populated', 'empty', 'connecting', 'reconnecting', 'errors'] as const
export type ScenarioPreset = (typeof scenarioPresets)[number]
const currentScenario = ref<ScenarioPreset>('populated')
export const scenario = readonly(currentScenario)
export const responseDelay = ref(0)
const handlers = new Set<(frame: SocketFrame) => void>()
const resetHandlers = new Set<() => void>()
const epoch = Date.UTC(2026, 0, 15, 12)
const exampleCode = 'export const greeting = "Hello from the UI sandbox"\nconsole.log(greeting)\n'
let sequence = 0
let messages: MessageDto[] = []
let unread: Record<string, UnreadState> = {}
let presence: Record<string, Presence> = {}
let me: Me
let users: UserEntry[] = []
let channels: ChannelEntry[] = []

export function dispatchSocketFrame(frame: SocketFrame) {
  handlers.forEach(h => h(structuredClone(frame)))
}

export function subscribeSocket(handler: (frame: SocketFrame) => void) {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

export function onScenarioReset(handler: () => void) {
  resetHandlers.add(handler)
  return () => {
    resetHandlers.delete(handler)
  }
}

function message(channelId: string, userId: string, body: string): MessageDto {
  return {
    id: `ui-message-${++sequence}`,
    channelId,
    userId,
    body,
    createdAt: epoch + sequence * 60_000,
    editedAt: null,
    replyTo: null,
    attachments: [],
    reactions: [],
    previews: [],
    pinned: false,
  }
}

export function resetScenario(preset: ScenarioPreset = 'populated') {
  currentScenario.value = preset
  responseDelay.value = 0
  sequence = 0
  me = { id: 'ui-me', email: 'you@example.test', role: 'admin', displayName: 'You', avatarKey: null }
  users = ['You', 'Alex', 'Sam', 'Jordan', 'Riley', 'Casey', 'Morgan'].map((displayName, i) => ({
    id: ['ui-me', 'ui-alex', 'ui-sam', 'ui-jordan', 'ui-riley', 'ui-casey', 'ui-morgan'][i]!,
    displayName,
    avatarKey: null,
    role: i ? 'user' : 'admin',
    banned: false,
  }))
  channels = [
    { id: 'ui-general', type: 'text', name: 'general' },
    { id: 'ui-unread', type: 'text', name: 'design-notes' },
    { id: 'ui-showcase', type: 'text', name: 'ui-showcase' },
    { id: 'ui-voice', type: 'voice', name: 'Lounge' },
    { id: 'ui-voice-games', type: 'voice', name: 'Games' },
    { id: 'ui-voice-music', type: 'voice', name: 'Music' },
    { id: 'ui-voice-empty', type: 'voice', name: 'Quiet room' },
    { id: 'ui-dm', type: 'dm', name: null, otherUserId: 'ui-alex', lastActivityAt: preset === 'empty' ? null : epoch },
  ]
  messages =
    preset === 'empty'
      ? []
      : [
          message('ui-general', 'ui-alex', 'Welcome to the UI sandbox! Everything here stays in this browser.'),
          message('ui-general', 'ui-me', 'A quiet place to try the chat, voice tiles, and settings.'),
          message(
            'ui-general',
            'ui-sam',
            '## A few things to try\n\n- Reply to a message\n- Add a reaction\n- Explore the voice room\n\n```ts\nconst hello = "world"\n```',
          ),
          message('ui-general', 'ui-jordan', 'Looks good on my screen ✨'),
          message('ui-unread', 'ui-alex', 'The new layout is ready for a look.'),
          message('ui-unread', 'ui-sam', 'Hey <@ui-me>, what do you think?'),
          message('ui-unread', 'ui-jordan', 'I like the extra breathing room.'),
          message('ui-dm', 'ui-me', 'Want to catch up in the Lounge?'),
          message('ui-dm', 'ui-alex', 'Sure, see you there!'),
        ]
  if (messages[3]) messages[3].reactions = [{ emoji: '✨', userIds: ['ui-me', 'ui-alex'] }]
  if (preset !== 'empty') {
    const token = message('ui-showcase', 'ui-alex', `Unbroken token: ${'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(12)}`)
    const paragraphs = message(
      'ui-showcase',
      'ui-sam',
      Array.from(
        { length: 3 },
        (_, i) => `Paragraph ${i + 1}. ${'This longer message exercises wrapping, spacing, and scrolling at narrow widths. '.repeat(8)}`,
      ).join('\n\n'),
    )
    const edited = message('ui-showcase', 'ui-me', 'An edited message — the final wording is a little clearer.')
    edited.editedAt = edited.createdAt + 30_000
    const reply = message('ui-showcase', 'ui-jordan', 'A reply to the edited message above.')
    reply.replyTo = { id: edited.id, userId: edited.userId, preview: edited.body, deleted: false }
    const deletedReply = message('ui-showcase', 'ui-alex', 'This reply survives even though its original message was deleted.')
    deletedReply.replyTo = { id: 'ui-deleted-message', userId: 'ui-sam', preview: '', deleted: true }
    const spoiler = message('ui-showcase', 'ui-sam', 'Spoiler ahead: ||the sandbox never contacts the backend||. Hey <@ui-me>, try revealing it!')
    const reactions = message('ui-showcase', 'ui-jordan', 'A full row of reactions should wrap without pushing the chat wider.')
    reactions.reactions = ['👍', '❤️', '😂', '🎉', '✨', '👀', '🚀', '✅', '🔥', '🤔', '🙌', '💯'].map(emoji => ({
      emoji,
      userIds: ['ui-me', 'ui-alex', 'ui-sam', 'ui-jordan'],
    }))
    const link = message('ui-showcase', 'ui-alex', 'A text-only link preview: https://example.test/ui-sandbox')
    link.previews = [
      {
        url: 'https://example.test/ui-sandbox',
        title: 'UI sandbox guide',
        description: 'A local preview card with no remote thumbnail.',
        siteName: 'Sandbox',
        image: false,
      },
    ]
    const code = message('ui-showcase', 'ui-me', 'A small code attachment, previewed entirely in the browser.')
    code.attachments = [
      { id: 'ui-example-code', filename: 'sandbox.ts', mime: 'text/plain', size: new TextEncoder().encode(exampleCode).length, spoiler: false },
    ]
    messages.push(token, paragraphs, edited, reply, deletedReply, spoiler, reactions, link, code)
  }
  unread = {
    'ui-general': { unread: 0, mentions: 0 },
    'ui-unread': { unread: preset === 'empty' ? 0 : 3, mentions: preset === 'empty' ? 0 : 1 },
    'ui-dm': { unread: preset === 'empty' ? 0 : 1, mentions: 0 },
    'ui-showcase': { unread: 0, mentions: 0 },
  }
  presence = { 'ui-me': 'online', 'ui-alex': 'online', 'ui-sam': 'idle', 'ui-jordan': 'busy', 'ui-riley': 'online', 'ui-casey': 'online', 'ui-morgan': 'idle' }
  resetVoiceScenario(preset)
  dispatchSocketFrame({ type: 'channels:changed' })
  dispatchSocketFrame({ type: 'users:changed' })
  for (const [channelId, counts] of Object.entries(unread)) dispatchSocketFrame({ type: 'unread:update', channelId, ...counts })
  for (const [userId, status] of Object.entries(presence)) dispatchSocketFrame({ type: 'presence:update', userId, status })
  resetHandlers.forEach(h => h())
}

export class SandboxError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message)
  }
}

function fail(status: number, message: string): never {
  throw new SandboxError(status, message)
}
function channelMessages(id: string) {
  if (!channels.some(c => c.id === id && c.type !== 'voice')) fail(404, 'Sandbox channel not found')
  return messages.filter(m => m.channelId === id)
}
function updateUnread(channelId: string, counts: UnreadState) {
  unread[channelId] = counts
  dispatchSocketFrame({ type: 'unread:update', channelId, ...counts })
  return counts
}
/** The panel chooses the target; active-channel consumers can mark it read after message:new. */
export function receiveMessage(channelId: string) {
  channelMessages(channelId)
  const channel = channels.find(c => c.id === channelId)!
  const m = message(channelId, channel.otherUserId ?? 'ui-alex', 'A new incoming message from the UI sandbox.')
  messages.push(m)
  channel.lastActivityAt = m.createdAt
  const counts = unread[channelId] ?? { unread: 0, mentions: 0 }
  updateUnread(channelId, { unread: counts.unread + 1, mentions: counts.mentions })
  dispatchSocketFrame({ type: 'message:new', message: m })
  return structuredClone(m)
}

function validBody(body: unknown): string {
  if (typeof body !== 'string' || !body.trim() || body.length > 10_000) fail(400, 'Enter a message of 1–10000 characters')
  return body
}

/** All supported requests are local; unknown routes and methods must never fall through to the backend. */
export function sandboxApi(url: URL, method = 'GET', body: Record<string, unknown> = {}): unknown {
  const path = url.pathname.replace(/\/$/, '')
  const query = url.searchParams
  if (method === 'GET') {
    if (path === '/api/profile/me') return structuredClone(me)
    if (path === '/api/auth/get-session')
      return {
        user: { ...me, name: me.displayName, emailVerified: true, image: null },
        session: { id: 'ui-session', userId: me.id, expiresAt: '2099-01-01T00:00:00.000Z', token: 'ui-local-only' },
      }
    if (path === '/api/channels') return structuredClone(channels)
    if (path === '/api/users') return structuredClone(users)
    if (path === '/api/users/presence') return { ...presence }
    if (path === '/api/unread') return structuredClone(unread)
    if (path === '/api/changelog') return { commits: [], head: null, nextPage: null }
    if (path === '/api/attachments/ui-example-code' && query.get('json') === '1')
      return { url: `data:text/plain;charset=utf-8,${encodeURIComponent(exampleCode)}` }
    if (['/api/sounds', '/api/radio/favorites', '/api/radio/stations', '/api/gifs/favorites', '/api/invites'].includes(path)) return []
    if (path === '/api/voice') return []
    if (path === '/api/gifs') return { items: [], hasNext: false }
    if (path === '/api/admin/users') return { users: users.map(u => ({ ...u, email: `${u.id}@example.test`, createdAt: epoch, bytes: 0 })), totalBytes: 0 }
    if (path === '/api/search') {
      // shortcut: plain text and scope only; add structured filters when the sandbox needs search-filter demos.
      const q = (query.get('q') ?? '').trim().toLowerCase()
      const scope = query.get('scope')
      return {
        results: messages
          .filter(
            m =>
              q &&
              m.body.toLowerCase().includes(q) &&
              (scope === 'channel'
                ? m.channelId === query.get('channelId')
                : scope === 'dms'
                  ? channels.some(c => c.id === m.channelId && c.type === 'dm')
                  : scope === 'channels'
                    ? channels.some(c => c.id === m.channelId && c.type === 'text')
                    : true),
          )
          .map(m => ({
            messageId: m.id,
            channelId: m.channelId,
            userId: m.userId,
            createdAt: m.createdAt,
            snippet: m.body,
            text: m.body,
            attachments: m.attachments.length,
          })),
        nextCursor: null,
      }
    }
    const pins = path.match(/^\/api\/channels\/([^/]+)\/pins$/)
    if (pins)
      return structuredClone(
        channelMessages(pins[1]!)
          .filter(m => m.pinned)
          .reverse()
          .map(m => ({ ...m, pinnedAt: m.createdAt, pinnedBy: me.id })),
      )
    const history = path.match(/^\/api\/channels\/([^/]+)\/messages$/)
    if (history) {
      if (scenario.value === 'errors') fail(503, 'Simulated sandbox history failure')
      const all = channelMessages(history[1]!)
      const anchor = query.get('before') ?? query.get('after')
      const index = anchor ? all.findIndex(m => m.id === anchor) : -1
      const page = index < 0 ? all : query.has('before') ? all.slice(0, index) : all.slice(index + 1)
      const count = unread[history[1]!]?.unread ?? 0
      return structuredClone({
        messages: page,
        hasMoreBefore: false,
        hasMoreAfter: false,
        firstUnreadId: count ? all[Math.max(0, all.length - count)]?.id : null,
      })
    }
  }
  const read = path.match(/^\/api\/channels\/([^/]+)\/(read|unread)$/)
  if (method === 'POST' && read) {
    const all = channelMessages(read[1]!)
    const index = all.findIndex(m => m.id === body.messageId)
    if (read[2] === 'unread' && index < 0) fail(404, 'Sandbox message not found')
    const remaining = read[2] === 'read' ? [] : all.slice(index)
    return updateUnread(read[1]!, { unread: remaining.length, mentions: remaining.filter(m => m.body.includes('<@ui-me>')).length })
  }
  if (method === 'POST' && path === '/api/dms') {
    if (!users.some(u => u.id === body.userId && u.id !== me.id)) fail(400, 'Unknown sandbox user')
    let dm = channels.find(c => c.type === 'dm' && c.otherUserId === body.userId)
    if (!dm) {
      dm = { id: `ui-dm-${String(body.userId)}`, type: 'dm', name: null, otherUserId: String(body.userId), lastActivityAt: epoch }
      channels.push(dm)
    }
    dispatchSocketFrame({ type: 'channels:changed' })
    return { id: dm.id }
  }
  if (method === 'POST' && path === '/api/profile/nickname') {
    if (typeof body.displayName !== 'string' || !body.displayName.trim()) fail(400, 'Enter a nickname')
    me.displayName = body.displayName.trim()
    users[0]!.displayName = me.displayName
    dispatchSocketFrame({ type: 'users:changed' })
    return { ok: true }
  }
  const target = path.match(/^\/api\/messages\/([^/]+)(?:\/(reactions|previews|pin))?$/)
  if (target) {
    const m = messages.find(m => m.id === target[1]) ?? fail(404, 'Sandbox message not found')
    if (method === 'GET' && !target[2]) return structuredClone(m)
    if (scenario.value === 'errors') fail(503, 'Simulated sandbox mutation failure')
    if (method === 'PATCH' && !target[2]) {
      if (m.userId !== me.id) fail(403, 'You can only edit your own messages')
      m.body = validBody(body.body)
      m.editedAt = epoch + ++sequence * 60_000
      dispatchSocketFrame({ type: 'message:edit', message: m })
      return structuredClone(m)
    }
    if (method === 'DELETE' && !target[2]) {
      messages = messages.filter(x => x.id !== m.id)
      messages.forEach(x => {
        if (x.replyTo?.id === m.id) x.replyTo.deleted = true
      })
      dispatchSocketFrame({ type: 'message:delete', channelId: m.channelId, id: m.id })
      return { ok: true }
    }
    if (method === 'POST' && target[2] === 'reactions') {
      if (typeof body.emoji !== 'string' || !body.emoji || body.emoji.length > 32 || typeof body.on !== 'boolean') fail(400, 'Invalid reaction')
      let reaction = m.reactions.find(r => r.emoji === body.emoji)
      if (!reaction) {
        reaction = { emoji: body.emoji, userIds: [] }
        m.reactions.push(reaction)
      }
      reaction.userIds = reaction.userIds.filter(id => id !== me.id)
      if (body.on) reaction.userIds.push(me.id)
      m.reactions = m.reactions.filter(r => r.userIds.length)
      dispatchSocketFrame({ type: 'reaction:update', channelId: m.channelId, messageId: m.id, reactions: m.reactions })
      return structuredClone({ reactions: m.reactions })
    }
    if (method === 'POST' && target[2] === 'pin') {
      m.pinned = body.on !== false
      dispatchSocketFrame({ type: 'pin:update', channelId: m.channelId, messageId: m.id, pinned: m.pinned })
      return { channelId: m.channelId, messageId: m.id, pinned: m.pinned }
    }
    if (method === 'DELETE' && target[2] === 'previews') {
      m.previews = m.previews.filter(p => p.url !== body.url)
      dispatchSocketFrame({ type: 'message:previews', channelId: m.channelId, messageId: m.id, previews: m.previews })
      return { ok: true }
    }
  }
  fail(501, `Not available in UI sandbox: ${method} ${path}`)
}

export function sandboxSocketSend(data: unknown) {
  if (!data || typeof data !== 'object' || !('type' in data)) return false
  const frame = data as Record<string, unknown>
  if (frame.type === 'message:send') {
    const nonce = typeof frame.nonce === 'string' ? frame.nonce : undefined
    try {
      if (scenario.value === 'errors') fail(503, 'Simulated sandbox send failure')
      const channelId = String(frame.channelId)
      channelMessages(channelId)
      const m = message(channelId, me.id, validBody(frame.body))
      const reply = messages.find(m => m.id === frame.replyToId && m.channelId === channelId)
      if (reply) m.replyTo = { id: reply.id, userId: reply.userId, preview: reply.body.slice(0, 160), deleted: false }
      messages.push(m)
      const channel = channels.find(c => c.id === channelId)!
      channel.lastActivityAt = m.createdAt
      dispatchSocketFrame({ type: 'message:new', message: m, nonce })
    } catch (e) {
      dispatchSocketFrame({ type: 'message:error', nonce, error: e instanceof Error ? e.message : 'Sandbox send failed' })
    }
    return true
  }
  if (frame.type === 'typing' && typeof frame.channelId === 'string') {
    dispatchSocketFrame({ type: 'typing', channelId: frame.channelId, userId: me.id })
    return true
  }
  if (['presence:set', 'presence:idle', 'presence:active'].includes(String(frame.type))) {
    const status = frame.type === 'presence:idle' ? 'idle' : frame.type === 'presence:active' ? 'online' : frame.status
    if (!['online', 'idle', 'busy', 'offline'].includes(String(status))) return false
    presence[me.id] = status as Presence
    dispatchSocketFrame({ type: 'presence:update', userId: me.id, status: status as Presence })
    return true
  }
  return false
}

resetScenario()
