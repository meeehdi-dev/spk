import { accessibleChannel, channelMemberIds, ChatError, createMessage } from '../db/messages'
import { markRead, readState } from '../db/reads'

import { createLimiter } from './limiter'
import { onlineUserIds, sendToUser, setPeerIdle, broadcast } from './peers'
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

/** Handles a JSON frame from a signed-in socket. */
export function handleClientFrame(userId: string, raw: string, socket?: unknown) {
  let m: { type?: string, sid?: string, channelId?: string, body?: string, nonce?: string, replyToId?: string | null, attachments?: Array<{ id: string, spoiler?: boolean }> }
  try {
    m = JSON.parse(raw)
  } catch {
    return
  }
  if ((m.type === 'presence:idle' || m.type === 'presence:active') && socket) {
    const status = setPeerIdle(userId, socket as never, m.type === 'presence:idle')
    if (status) broadcast({ type: 'presence:update', userId, status })
    return
  }
  if (m.type?.startsWith('voice:')) return handleVoiceFrame(userId, m, socket)
  if (m.type === 'message:send') {
    try {
      if (!allowSend(userId)) throw new ChatError(429, 'Slow down')
      const files = Array.isArray(m.attachments) ? m.attachments.map(a => ({ id: String(a?.id), spoiler: !!a?.spoiler })) : []
      const message = createMessage(useDb(), userId, String(m.channelId), m.body, Date.now(), {
        replyToId: typeof m.replyToId === 'string' ? m.replyToId : null, attachments: files,
      })
      const db = useDb()
      queuePreviews(message)
      sendPushes(message)
      markRead(db, userId, message.channelId) // sending means you've caught up
      for (const id of fanOut(message.channelId, userId, { type: 'message:new', message, nonce: m.nonce }, true)) {
        sendToUser(id, { type: 'unread:update', channelId: message.channelId, ...readState(db, id, message.channelId) })
      }
    } catch (e) {
      if (!(e instanceof ChatError)) throw e
      sendToUser(userId, { type: 'message:error', nonce: m.nonce, error: e.message })
    }
  } else if (m.type === 'typing' && typeof m.channelId === 'string' && allowTyping(`${userId}:${m.channelId}`)) {
    fanOut(m.channelId, userId, { type: 'typing', channelId: m.channelId, userId }, false)
  }
}
