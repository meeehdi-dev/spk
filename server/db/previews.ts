import type { Db } from './client'

import { and, eq, inArray, isNull } from 'drizzle-orm'

import { previewUrls } from '../../shared/utils/links'
import { appOrigin } from '../utils/appOrigin'

import { ChatError, accessibleChannel, messageDto } from './messages'
import { linkPreviews, messagePreviews, messages } from './schema'

const PREVIEW_TTL_MS = 7 * 24 * 3600_000

export interface ParsedPreview {
  title: string | null
  description: string | null
  siteName: string | null
  imageKey: string | null
}

/** A cached preview that is still fresh, or undefined. */
export function cachedPreview(db: Db, url: string, now = Date.now()) {
  const row = db.select().from(linkPreviews).where(eq(linkPreviews.url, url)).get()
  return row && now - row.fetchedAt.getTime() < PREVIEW_TTL_MS ? row : undefined
}

export function savePreview(db: Db, url: string, p: ParsedPreview, now = Date.now()) {
  const values = { ...p, fetchedAt: new Date(now) }
  db.insert(linkPreviews)
    .values({ url, ...values })
    .onConflictDoUpdate({ target: linkPreviews.url, set: values })
    .run()
}

/**
 * Shows completed cached previews only while they remain eligible in the current message body.
 * Returns the message with its cards, or null when nothing changed.
 */
export function attachPreviews(db: Db, messageId: string, urls: string[]) {
  const m = db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)))
    .get()
  if (!m || m.suppressPreviews) return null
  const eligible = previewUrls(m.body, appOrigin())
  const completed = eligible.filter(url => urls.includes(url))
  if (!completed.length) return null
  const have = db
    .select({ url: linkPreviews.url })
    .from(linkPreviews)
    .where(inArray(linkPreviews.url, completed))
    .all()
    .map(r => r.url)
  const rows = completed.filter(u => have.includes(u)).map(url => ({ messageId, url, position: eligible.indexOf(url) }))
  if (!rows.length) return null
  const r = db.insert(messagePreviews).values(rows).onConflictDoNothing().run()
  return r.changes ? messageDto(db, m) : null
}

/** The author or an admin removes a card. The message then gets no more cards, even after edits. */
export function removePreview(db: Db, userId: string, isAdmin: boolean, messageId: unknown, url: unknown) {
  const m =
    typeof messageId === 'string'
      ? db
          .select()
          .from(messages)
          .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)))
          .get()
      : undefined
  if (!m || !accessibleChannel(db, userId, m.channelId)) throw new ChatError(404, 'Message not found')
  if (m.userId !== userId && !isAdmin) throw new ChatError(403, 'Only the author or an admin can remove a preview')
  if (typeof url !== 'string') throw new ChatError(400, 'Missing url')
  db.transaction(tx => {
    tx.delete(messagePreviews)
      .where(and(eq(messagePreviews.messageId, m.id), eq(messagePreviews.url, url)))
      .run()
    tx.update(messages).set({ suppressPreviews: true }).where(eq(messages.id, m.id)).run()
  })
  return messageDto(db, m)
}

/** The thumbnail key of a card on a message the user may read. */
export function previewImageKey(db: Db, userId: string, messageId: unknown, url: unknown) {
  if (typeof messageId !== 'string' || typeof url !== 'string') return null
  const row = db
    .select({ key: linkPreviews.imageKey, channelId: messages.channelId })
    .from(messagePreviews)
    .innerJoin(linkPreviews, eq(linkPreviews.url, messagePreviews.url))
    .innerJoin(messages, eq(messages.id, messagePreviews.messageId))
    .where(and(eq(messagePreviews.messageId, messageId), eq(messagePreviews.url, url), isNull(messages.deletedAt)))
    .get()
  return row?.key && accessibleChannel(db, userId, row.channelId) ? row.key : null
}
