import type { Db } from './client'

import { and, desc, eq, isNull } from 'drizzle-orm'

import { canPin } from '../../shared/utils/pins'

import { accessibleChannel, ChatError, hydrate, liveMessage, type MessageDto } from './messages'
import { messagePins, messages } from './schema'

export interface PinDto extends MessageDto {
  pinnedAt: number
  pinnedBy: string
}

/** Pins or unpins a message (idempotent). Returns the message's channel for the live update. */
export function setPin(db: Db, userId: string, role: string | null | undefined, messageId: unknown, on: boolean, now = Date.now()) {
  const m = liveMessage(db, messageId)
  const ch = m && accessibleChannel(db, userId, m.channelId)
  if (!m || !ch) throw new ChatError(404, 'Message not found')
  if (!canPin(ch.type, role)) throw new ChatError(403, 'Only admins can pin messages in channels')
  if (on)
    db.insert(messagePins)
      .values({ messageId: m.id, channelId: m.channelId, pinnedBy: userId, pinnedAt: new Date(now) })
      .onConflictDoNothing()
      .run()
  else db.delete(messagePins).where(eq(messagePins.messageId, m.id)).run()
  return { channelId: m.channelId, messageId: m.id, pinned: on }
}

/** A channel's pinned messages, newest pin first. */
// shortcut: unbounded list, refetched by every viewer on each pin change; add a limit or send deltas if channels collect many pins.
export function listPins(db: Db, userId: string, channelId: string): PinDto[] {
  if (!accessibleChannel(db, userId, channelId)) throw new ChatError(403, 'No access to this channel')
  const rows = db
    .select({ m: messages, pinnedAt: messagePins.pinnedAt, pinnedBy: messagePins.pinnedBy })
    .from(messagePins)
    .innerJoin(messages, eq(messages.id, messagePins.messageId))
    .where(and(eq(messagePins.channelId, channelId), isNull(messages.deletedAt)))
    .orderBy(desc(messagePins.pinnedAt), desc(messagePins.messageId))
    .all()
  const dtos = hydrate(
    db,
    rows.map(r => r.m),
  )
  return dtos.map((d, i) => ({ ...d, pinnedAt: rows[i]!.pinnedAt.getTime(), pinnedBy: rows[i]!.pinnedBy }))
}
