import type { Db } from './client'
import type { MessageDto } from './messages'

import { and, eq, inArray } from 'drizzle-orm'

import { allowedBy, notificationBody, type NotifyPrefs } from '../../shared/utils/notifyText'

import { channelMembers, channels, messageMentions, pushSubscriptions, user } from './schema'

export interface PushJob {
  endpoint: string
  keys: { p256dh: string; auth: string }
  payload: { title: string; body: string; url: string; tag: string }
}

const parse = <T>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s)
  } catch {
    return fallback
  }
}

/** Pushes for a new message: DM partner or mentioned/replied-to users, only those with no open socket and whose settings allow it. */
export function pushJobs(db: Db, m: MessageDto, onlineIds: string[]): PushJob[] {
  const ch = db.select().from(channels).where(eq(channels.id, m.channelId)).get()
  if (!ch) return []
  const isDm = ch.type === 'dm'
  const targets = isDm
    ? db
        .select({ id: channelMembers.userId })
        .from(channelMembers)
        .where(eq(channelMembers.channelId, ch.id))
        .all()
        .map(r => r.id)
    : db
        .select({ id: messageMentions.userId })
        .from(messageMentions)
        .where(eq(messageMentions.messageId, m.id))
        .all()
        .map(r => r.id)
  const ids = targets.filter(id => id !== m.userId && !onlineIds.includes(id))
  if (!ids.length) return []
  const names = new Map(
    db
      .select({ id: user.id, n: user.displayName })
      .from(user)
      .all()
      .map(u => [u.id, u.n ?? 'someone']),
  )
  const body = notificationBody(m.body, id => names.get(id) ?? 'someone') || (m.attachments.length ? 'Sent an attachment' : '')
  const author = names.get(m.userId) ?? 'someone'
  const payload = { title: isDm ? author : `${author} in #${ch.name}`, body, url: `/c/${ch.id}/m/${m.id}`, tag: ch.id }
  return db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, ids))
    .all()
    .filter(s => allowedBy(parse<NotifyPrefs>(s.prefs, {}), ch.id, isDm))
    .map(s => ({ endpoint: s.endpoint, keys: parse(s.keys, { p256dh: '', auth: '' }), payload }))
}

export const savePush = (db: Db, userId: string, endpoint: string, keys: unknown, prefs: unknown) =>
  db
    .insert(pushSubscriptions)
    .values({ userId, endpoint, keys: JSON.stringify(keys), prefs: JSON.stringify(prefs) })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, keys: JSON.stringify(keys), prefs: JSON.stringify(prefs) } })
    .run()

export const setPushPrefs = (db: Db, userId: string, prefs: unknown) =>
  db
    .update(pushSubscriptions)
    .set({ prefs: JSON.stringify(prefs) })
    .where(eq(pushSubscriptions.userId, userId))
    .run()

export const removePush = (db: Db, endpoint: string, userId?: string) =>
  db
    .delete(pushSubscriptions)
    .where(userId ? and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)) : eq(pushSubscriptions.endpoint, endpoint))
    .run()
