import type { Db } from './client'

import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'

import { ChatError } from './messages'
import { channelMembers, channels, user } from './schema'

export interface ChannelDto {
  id: string
  type: 'text' | 'voice' | 'dm'
  name: string | null
  /** DMs: the other member. */
  otherUserId?: string
  lastActivityAt?: number | null
}

/** The 1:1 DM between two users (created on first use). Race-free: better-sqlite3 transactions are synchronous. */
export function openDm(db: Db, me: string, otherId: unknown): ChannelDto {
  if (typeof otherId !== 'string' || !otherId) throw new ChatError(400, 'Pick a user')
  if (otherId === me) throw new ChatError(400, 'You can\'t message yourself')
  if (!db.select({ id: user.id }).from(user).where(eq(user.id, otherId)).get()) throw new ChatError(404, 'User not found')
  return db.transaction((tx) => {
    const a = alias(channelMembers, 'a'), b = alias(channelMembers, 'b')
    let ch = tx.select({ id: channels.id, lastActivityAt: channels.lastActivityAt }).from(channels)
      .innerJoin(a, eq(a.channelId, channels.id)).innerJoin(b, eq(b.channelId, channels.id))
      .where(and(eq(channels.type, 'dm'), eq(a.userId, me), eq(b.userId, otherId))).get()
    if (!ch) {
      const id = crypto.randomUUID()
      tx.insert(channels).values({ id, type: 'dm' }).run()
      tx.insert(channelMembers).values([{ channelId: id, userId: me }, { channelId: id, userId: otherId }]).run()
      ch = { id, lastActivityAt: null }
    }
    return { id: ch.id, type: 'dm' as const, name: null, otherUserId: otherId, lastActivityAt: ch.lastActivityAt?.getTime() ?? null }
  })
}

/** Text and voice channels (manual order) then all the user's DMs, newest activity first (empty ones last; the sidebar hides those). */
export function listChannelsFor(db: Db, userId: string): ChannelDto[] {
  const text = db.select({ id: channels.id, type: channels.type, name: channels.name }).from(channels)
    .where(inArray(channels.type, ['text', 'voice'])).orderBy(asc(channels.position), asc(channels.createdAt)).all()
  const me = alias(channelMembers, 'me'), other = alias(channelMembers, 'other')
  const dms = db.select({ id: channels.id, otherUserId: other.userId, lastActivityAt: channels.lastActivityAt }).from(channels)
    .innerJoin(me, and(eq(me.channelId, channels.id), eq(me.userId, userId)))
    .innerJoin(other, and(eq(other.channelId, channels.id), ne(other.userId, userId)))
    .where(eq(channels.type, 'dm')).orderBy(desc(channels.lastActivityAt)).all()
  return [...text, ...dms.map(d => ({ id: d.id, type: 'dm' as const, name: null, otherUserId: d.otherUserId, lastActivityAt: d.lastActivityAt?.getTime() ?? null }))]
}
