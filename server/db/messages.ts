import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import type { Db } from './client'
import { attachments, channelMembers, channels, linkPreviews, messageMentions, messagePreviews, messages, reactions, user } from './schema'
import { extractMentionIds, MAX_BODY_BYTES } from '../../shared/utils/markdown'
import { MAX_FILES } from '../../shared/utils/files'
import { extractUrls } from '../../shared/utils/links'

/** A database or a transaction handle. */
type Conn = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>

export interface AttachmentDto { id: string, filename: string, mime: string, size: number, spoiler: boolean }
export interface ReactionDto { emoji: string, userIds: string[] }
/** Preview of the message this one replies to; `deleted` when it's gone. */
interface ReplyRef { id: string, userId: string, preview: string, deleted: boolean }

/** A link card; `image` = a thumbnail exists (served by /api/messages/:id/previews/image). */
export interface PreviewDto { url: string, title: string | null, description: string | null, siteName: string | null, image: boolean }

export interface MessageDto {
  id: string, channelId: string, userId: string, body: string
  createdAt: number, editedAt: number | null
  replyTo: ReplyRef | null, attachments: AttachmentDto[], reactions: ReactionDto[], previews: PreviewDto[]
}

export class ChatError extends Error {
  constructor(public statusCode: number, message: string) { super(message) }
}

/** The channel if this user may read and write its messages (text: anyone, DM: its members), else null. */
export function accessibleChannel(db: Db, userId: string, channelId: string) {
  const ch = db.select().from(channels).where(eq(channels.id, channelId)).get()
  if (!ch) return null
  if (ch.type === 'text') return ch
  if (ch.type === 'dm') {
    const m = db.select().from(channelMembers).where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId))).get()
    return m ? ch : null
  }
  return null
}

/** Users who should receive live events for a channel. */
export function channelMemberIds(db: Db, ch: { id: string, type: string }, onlineIds: string[]) {
  if (ch.type !== 'dm') return onlineIds
  const members = db.select({ id: channelMembers.userId }).from(channelMembers).where(eq(channelMembers.channelId, ch.id)).all().map(r => r.id)
  return onlineIds.filter(id => members.includes(id))
}

const preview = (body: string) => (body.split('\n').find(l => l.trim()) ?? '').trim().slice(0, 120)

/** Rows -> DTOs with their attachments, reactions and reply previews (3-4 queries for the whole page). */
function hydrate(db: Conn, rows: Array<typeof messages.$inferSelect>): MessageDto[] {
  if (!rows.length) return []
  const ids = rows.map(r => r.id)
  const files = db.select().from(attachments).where(inArray(attachments.messageId, ids)).orderBy(sql`rowid`).all()
  const reacts = db.select().from(reactions).where(inArray(reactions.messageId, ids)).orderBy(sql`rowid`).all()
  const cards = db.select({ messageId: messagePreviews.messageId, p: linkPreviews }).from(messagePreviews)
    .innerJoin(linkPreviews, eq(linkPreviews.url, messagePreviews.url))
    .where(inArray(messagePreviews.messageId, ids)).orderBy(messagePreviews.position).all()
  const replyIds = [...new Set(rows.map(r => r.replyToId).filter((x): x is string => !!x))]
  const originals = new Map((replyIds.length ? db.select().from(messages).where(inArray(messages.id, replyIds)).all() : []).map(m => [m.id, m]))
  return rows.map((m) => {
    const grouped = new Map<string, string[]>()
    for (const r of reacts) if (r.messageId === m.id) grouped.set(r.emoji, [...(grouped.get(r.emoji) ?? []), r.userId])
    const o = m.replyToId ? originals.get(m.replyToId) : undefined
    return {
      id: m.id, channelId: m.channelId, userId: m.userId, body: m.body,
      createdAt: m.createdAt.getTime(), editedAt: m.editedAt?.getTime() ?? null,
      replyTo: m.replyToId ? { id: m.replyToId, userId: o?.userId ?? '', preview: o && !o.deletedAt ? preview(o.body) : '', deleted: !o || !!o.deletedAt } : null,
      attachments: files.filter(f => f.messageId === m.id).map(f => ({ id: f.id, filename: f.filename, mime: f.mime, size: f.size, spoiler: f.spoiler })),
      reactions: [...grouped].map(([emoji, userIds]) => ({ emoji, userIds })),
      previews: cards.filter(c => c.messageId === m.id).map(c => ({ url: c.p.url, title: c.p.title, description: c.p.description, siteName: c.p.siteName, image: !!c.p.imageKey }))
    }
  })
}

export const messageDto = (db: Conn, row: typeof messages.$inferSelect) => hydrate(db, [row])[0]!

export interface SendOptions { replyToId?: string | null, attachments?: Array<{ id: string, spoiler?: boolean }> }

/** Mentions = real users in the body, plus the author of the message being replied to (a reply pings). */
function syncMentions(tx: Conn, row: typeof messages.$inferSelect, replyAuthor: string | null) {
  tx.delete(messageMentions).where(eq(messageMentions.messageId, row.id)).run()
  const ids = new Set(extractMentionIds(row.body))
  const real = ids.size ? tx.select({ id: user.id }).from(user).where(inArray(user.id, [...ids])).all().map(r => r.id) : []
  const all = new Set(real)
  if (replyAuthor && replyAuthor !== row.userId) all.add(replyAuthor)
  if (all.size) tx.insert(messageMentions).values([...all].map(userId => ({ messageId: row.id, userId }))).run()
}

export function createMessage(db: Db, userId: string, channelId: string, body: unknown, now = Date.now(), opts: SendOptions = {}): MessageDto {
  const files = opts.attachments ?? []
  if (typeof body !== 'string' || (!body.trim() && !files.length)) throw new ChatError(400, 'Message is empty')
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new ChatError(413, 'Message is over 200 KB')
  if (files.length > MAX_FILES) throw new ChatError(400, `At most ${MAX_FILES} files per message`)
  const ch = accessibleChannel(db, userId, channelId)
  if (!ch) throw new ChatError(403, 'No access to this channel')
  return db.transaction((tx) => {
    let replyAuthor: string | null = null
    if (opts.replyToId) {
      const o = tx.select().from(messages).where(and(eq(messages.id, opts.replyToId), eq(messages.channelId, channelId), isNull(messages.deletedAt))).get()
      if (!o) throw new ChatError(404, 'The message you reply to no longer exists')
      replyAuthor = o.userId
    }
    const row = tx.insert(messages).values({ id: crypto.randomUUID(), channelId, userId, body, replyToId: opts.replyToId ?? null, createdAt: new Date(now) }).returning().get()
    // The attachment rows are linked in the same transaction as the message.
    for (const f of new Set(files.map(x => x.id))) {
      const spoiler = !!files.find(x => x.id === f)?.spoiler
      const r = tx.update(attachments).set({ messageId: row.id, spoiler })
        .where(and(eq(attachments.id, f), eq(attachments.uploaderId, userId), isNull(attachments.messageId))).run()
      if (!r.changes) throw new ChatError(400, 'An attachment is missing or already used')
    }
    syncMentions(tx, row, replyAuthor)
    if (ch.type === 'dm') tx.update(channels).set({ lastActivityAt: new Date(now) }).where(eq(channels.id, channelId)).run()
    return messageDto(tx, row)
  })
}

const liveMessage = (db: Db, id: unknown) =>
  typeof id === 'string' ? db.select().from(messages).where(and(eq(messages.id, id), isNull(messages.deletedAt))).get() : undefined

/** Edit your own message, forever. Admins can't edit other people's words. */
export function editMessage(db: Db, userId: string, messageId: unknown, body: unknown, now = Date.now()): MessageDto {
  const m = liveMessage(db, messageId)
  if (!m || !accessibleChannel(db, userId, m.channelId)) throw new ChatError(404, 'Message not found')
  if (m.userId !== userId) throw new ChatError(403, 'You can only edit your own messages')
  if (typeof body !== 'string') throw new ChatError(400, 'Message is empty')
  const hasFiles = !!db.select({ id: attachments.id }).from(attachments).where(eq(attachments.messageId, m.id)).get()
  if (!body.trim() && !hasFiles) throw new ChatError(400, 'Message is empty')
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new ChatError(413, 'Message is over 200 KB')
  if (body === m.body) return messageDto(db, m)
  return db.transaction((tx) => {
    const row = tx.update(messages).set({ body, editedAt: new Date(now) }).where(eq(messages.id, m.id)).returning().get()!
    const replyAuthor = m.replyToId ? tx.select({ u: messages.userId }).from(messages).where(eq(messages.id, m.replyToId)).get()?.u ?? null : null
    syncMentions(tx, row, replyAuthor)
    // Cards for links that are no longer in the text go away.
    const keep = extractUrls(body)
    tx.delete(messagePreviews).where(keep.length ? and(eq(messagePreviews.messageId, m.id), notInArray(messagePreviews.url, keep)) : eq(messagePreviews.messageId, m.id)).run()
    return messageDto(tx, row)
  })
}

export interface DeletedMessage { id: string, channelId: string, r2Keys: string[] }

/** Soft delete (decision 9): body emptied, mentions/reactions/attachment rows removed; the FTS row goes via trigger. */
export function deleteMessage(db: Db, userId: string, isAdmin: boolean, messageId: unknown, now = Date.now()): DeletedMessage {
  const m = liveMessage(db, messageId)
  if (!m || !accessibleChannel(db, userId, m.channelId)) throw new ChatError(404, 'Message not found')
  if (m.userId !== userId && !isAdmin) throw new ChatError(403, 'You can only delete your own messages')
  return db.transaction((tx) => {
    const files = tx.select({ id: attachments.id, key: attachments.r2Key }).from(attachments).where(eq(attachments.messageId, m.id)).all()
    tx.delete(attachments).where(eq(attachments.messageId, m.id)).run()
    tx.delete(reactions).where(eq(reactions.messageId, m.id)).run()
    tx.delete(messageMentions).where(eq(messageMentions.messageId, m.id)).run()
    tx.delete(messagePreviews).where(eq(messagePreviews.messageId, m.id)).run()
    tx.update(messages).set({ body: '', deletedAt: new Date(now) }).where(eq(messages.id, m.id)).run()
    return { id: m.id, channelId: m.channelId, r2Keys: files.map(f => f.key) }
  })
}

const MAX_REACTION_KINDS = 20

/** One grapheme that is an emoji (pictographic, flag or keycap). */
export function isEmoji(v: unknown): v is string {
  if (typeof v !== 'string' || !v || v.length > 32) return false
  if ([...new Intl.Segmenter().segment(v)].length !== 1) return false
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(v)
}

/** Adds or removes the user's reaction. Returns the message's reactions after the change. */
export function setReaction(db: Db, userId: string, messageId: unknown, emoji: unknown, on: boolean) {
  const m = liveMessage(db, messageId)
  if (!m || !accessibleChannel(db, userId, m.channelId)) throw new ChatError(404, 'Message not found')
  if (!isEmoji(emoji)) throw new ChatError(400, 'Not an emoji')
  const mine = and(eq(reactions.messageId, m.id), eq(reactions.userId, userId), eq(reactions.emoji, emoji))
  if (on) {
    const kinds = db.select({ n: sql<number>`count(distinct ${reactions.emoji})` }).from(reactions).where(eq(reactions.messageId, m.id)).get()?.n ?? 0
    const exists = db.select().from(reactions).where(mine).get()
    if (!exists && kinds >= MAX_REACTION_KINDS) throw new ChatError(400, 'Too many different reactions on this message')
    db.insert(reactions).values({ messageId: m.id, userId, emoji }).onConflictDoNothing().run()
  } else db.delete(reactions).where(mine).run()
  return { channelId: m.channelId, messageId: m.id, reactions: messageDto(db, m).reactions }
}

export interface HistoryResult { messages: MessageDto[], hasMoreBefore: boolean, hasMoreAfter: boolean, firstUnreadId?: string | null }

/** Oldest-first page. `before` / `after` are message ids; `around` returns the message with context on both sides. */
export function listMessages(db: Db, channelId: string, opts: { before?: string, after?: string, around?: string, limit?: number }): HistoryResult {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100)
  const live = and(eq(messages.channelId, channelId), isNull(messages.deletedAt))
  const pos = (id: string) => {
    const a = db.select({ createdAt: messages.createdAt, id: messages.id }).from(messages).where(and(live, eq(messages.id, id))).get()
    if (!a) throw new ChatError(404, 'Message not found')
    return [a.createdAt.getTime(), a.id] as const
  }
  const older = (id: string, inclusive: boolean, n: number) => {
    const [t, i] = pos(id)
    const op = inclusive ? sql`<=` : sql`<`
    return db.select().from(messages).where(and(live, sql`(${messages.createdAt}, ${messages.id}) ${op} (${t}, ${i})`))
      .orderBy(desc(messages.createdAt), desc(messages.id)).limit(n).all().reverse()
  }
  const newer = (id: string, n: number) => {
    const [t, i] = pos(id)
    return db.select().from(messages).where(and(live, sql`(${messages.createdAt}, ${messages.id}) > (${t}, ${i})`))
      .orderBy(asc(messages.createdAt), asc(messages.id)).limit(n).all()
  }

  if (opts.around) {
    const half = Math.floor(limit / 2)
    const before = older(opts.around, true, half + 2) // +1 is the anchor itself, +1 probes for more
    const after = newer(opts.around, half + 1)
    const hasMoreBefore = before.length > half + 1
    const hasMoreAfter = after.length > half
    return { messages: hydrate(db, [...before.slice(hasMoreBefore ? 1 : 0), ...after.slice(0, half)]), hasMoreBefore, hasMoreAfter }
  }
  if (opts.after) {
    const rows = newer(opts.after, limit + 1)
    return { messages: hydrate(db, rows.slice(0, limit)), hasMoreBefore: true, hasMoreAfter: rows.length > limit }
  }
  const rows = opts.before
    ? older(opts.before, false, limit + 1)
    : db.select().from(messages).where(live).orderBy(desc(messages.createdAt), desc(messages.id)).limit(limit + 1).all().reverse()
  return { messages: hydrate(db, rows.slice(rows.length > limit ? 1 : 0)), hasMoreBefore: rows.length > limit, hasMoreAfter: false }
}
