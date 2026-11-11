import type { Db } from './client'

import { and, eq, sql } from 'drizzle-orm'

import { channelReads, messages } from './schema'

export interface UnreadState { unread: number, mentions: number }

// Unread = other people's live messages newer than channel_reads.last_read_at (no row yet: newer than the account),
// in text channels and in DMs the user belongs to. Mentions are the subset that mention the user.
function counts(db: Db, userId: string, channelId?: string): Record<string, UnreadState> {
  const rows = db.all<{ channelId: string, unread: number, mentions: number }>(sql`
    SELECT m.channel_id AS channelId, COUNT(*) AS unread,
      SUM(EXISTS(SELECT 1 FROM message_mentions mm WHERE mm.message_id = m.id AND mm.user_id = ${userId})) AS mentions
    FROM messages m
    JOIN channels c ON c.id = m.channel_id
    LEFT JOIN channel_reads r ON r.channel_id = m.channel_id AND r.user_id = ${userId}
    WHERE m.deleted_at IS NULL AND m.user_id <> ${userId}
      AND m.created_at > COALESCE(r.last_read_at, (SELECT created_at FROM users WHERE id = ${userId}))
      AND (c.type = 'text' OR (c.type = 'dm' AND EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ${userId})))
      ${channelId ? sql`AND m.channel_id = ${channelId}` : sql``}
    GROUP BY m.channel_id`)
  return Object.fromEntries(rows.map(r => [r.channelId, { unread: r.unread, mentions: r.mentions }]))
}

export const allUnread = (db: Db, userId: string) => counts(db, userId)
export const readState = (db: Db, userId: string, channelId: string): UnreadState =>
  counts(db, userId, channelId)[channelId] ?? { unread: 0, mentions: 0 }

function setLastRead(db: Db, userId: string, channelId: string, at: number) {
  db.insert(channelReads).values({ userId, channelId, lastReadAt: new Date(at) })
    .onConflictDoUpdate({ target: [channelReads.userId, channelReads.channelId], set: { lastReadAt: new Date(at) } }).run()
}

export const markRead = (db: Db, userId: string, channelId: string, now = Date.now()) => setLastRead(db, userId, channelId, now)

/** Makes `messageId` and everything after it unread. False if the message isn't in this channel. */
export function markUnreadFrom(db: Db, userId: string, channelId: string, messageId: unknown) {
  if (typeof messageId !== 'string') return false
  const m = db.select({ createdAt: messages.createdAt }).from(messages).where(and(eq(messages.id, messageId), eq(messages.channelId, channelId))).get()
  if (!m) return false
  setLastRead(db, userId, channelId, m.createdAt.getTime() - 1)
  return true
}

/** Oldest unread message of someone else, for the "New messages" divider. */
export function firstUnreadId(db: Db, userId: string, channelId: string): string | null {
  return db.get<{ id: string }>(sql`
    SELECT m.id FROM messages m
    LEFT JOIN channel_reads r ON r.channel_id = m.channel_id AND r.user_id = ${userId}
    WHERE m.channel_id = ${channelId} AND m.deleted_at IS NULL AND m.user_id <> ${userId}
      AND m.created_at > COALESCE(r.last_read_at, (SELECT created_at FROM users WHERE id = ${userId}))
    ORDER BY m.created_at, m.id LIMIT 1`)?.id ?? null
}
