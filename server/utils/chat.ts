import { eq } from 'drizzle-orm'

import { MANUAL_STATUSES, type ManualStatus } from '../../shared/utils/presence'
import { accessibleChannel, channelMemberIds, ChatError, createMessage, type MessageDto } from '../db/messages'
import { markRead, readState } from '../db/reads'
import { channels } from '../db/schema'

import { maybeReply } from './bot'
import { logConnectionDiag } from './connectionDiag'
import { createLimiter } from './limiter'
import { onlineUserIds, sendToUser, setManualStatus, setPeerIdle, broadcast } from './peers'
import { queuePreviews } from './previews'
import { sendPushes } from './push'
import { handleVoiceFrame } from './voice'

const allowSend = createLimiter(5, 5_000) // 5 messages per 5 s per user
const allowTyping = createLimiter(1, 2_000)

export function fanOut(channelId: string, userId: string, data: unknown, includeSender: boolean) {
  const db = useDb()
  const ch = accessibleChannel(db, userId, channelId)
  if (!ch) return []
  const ids = channelMemberIds(db, ch, onlineUserIds()).filter(id => includeSender || id !== userId)
  for (const id of ids) sendToUser(id, data)
  return ids
}

/** Broadcasts a freshly created message: previews, pushes, live event and unread counts. Without `senderId` nobody is marked read. */
export function publishMessage(message: MessageDto, { senderId, nonce, previews = true }: { senderId?: string; nonce?: unknown; previews?: boolean } = {}) {
  const db = useDb()
  if (previews) queuePreviews(message)
  sendPushes(message)
  if (senderId) markRead(db, senderId, message.channelId) // sending means you've caught up
  const ch = db.select().from(channels).where(eq(channels.id, message.channelId)).get()
  if (!ch) return
  const ids = channelMemberIds(db, ch, onlineUserIds())
  for (const id of ids) sendToUser(id, { type: 'message:new', message, nonce })
  for (const id of ids) {
    sendToUser(id, { type: 'unread:update', channelId: message.channelId, ...readState(db, id, message.channelId) })
  }
}

/** Handles a JSON frame from a signed-in socket. */
export function handleClientFrame(userId: string, raw: string, socket?: unknown) {
  let m: {
    type?: string
    status?: unknown
    sid?: string
    channelId?: string
    body?: string
    nonce?: string
    replyToId?: string | null
    attachments?: Array<{ id: string; spoiler?: boolean }>
    poll?: unknown
    events?: unknown
  }
  try {
    m = JSON.parse(raw)
  } catch {
    return
  }
  if (!m || typeof m !== 'object') return
  if ((m.type === 'presence:idle' || m.type === 'presence:active') && socket) {
    const status = setPeerIdle(userId, socket as never, m.type === 'presence:idle')
    if (status) broadcast({ type: 'presence:update', userId, status })
    return
  }
  if (m.type === 'presence:set' && MANUAL_STATUSES.includes(m.status as ManualStatus)) {
    const status = setManualStatus(userId, m.status as ManualStatus)
    if (status) broadcast({ type: 'presence:update', userId, status })
    return
  }
  if (m.type === 'diag') return logConnectionDiag(userId, m.events)
  if (m.type?.startsWith('voice:')) return handleVoiceFrame(userId, m, socket)
  if (m.type === 'message:send') {
    try {
      if (!allowSend(userId)) throw new ChatError(429, 'Slow down')
      const files = Array.isArray(m.attachments) ? m.attachments.map(a => ({ id: String(a?.id), spoiler: !!a?.spoiler })) : []
      const message = createMessage(useDb(), userId, String(m.channelId), m.body, Date.now(), {
        replyToId: typeof m.replyToId === 'string' ? m.replyToId : null,
        attachments: files,
        poll: m.poll,
      })
      publishMessage(message, { senderId: userId, nonce: m.nonce })
      void maybeReply(message)
    } catch (e) {
      if (!(e instanceof ChatError)) throw e
      sendToUser(userId, { type: 'message:error', nonce: m.nonce, error: e.message })
    }
  } else if (m.type === 'typing' && typeof m.channelId === 'string' && allowTyping(`${userId}:${m.channelId}`)) {
    fanOut(m.channelId, userId, { type: 'typing', channelId: m.channelId, userId }, false)
  }
}
