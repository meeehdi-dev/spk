import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from './client'
import { attachments, channels, messages } from './schema'
import { ChatError } from './messages'

type Kind = 'text' | 'voice'
const kind = (v: unknown): Kind => { if (v === 'text' || v === 'voice') return v; throw new ChatError(400, 'Type must be text or voice') }

export function cleanChannelName(v: unknown) {
  const name = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : ''
  if (name.length < 1 || name.length > 32) throw new ChatError(400, 'Name must be 1–32 characters')
  return name
}

/** New channels go at the end of their section. */
export function createChannel(db: Db, type: unknown, name: unknown) {
  const t = kind(type), n = cleanChannelName(name)
  const max = db.select({ m: sql<number | null>`max(${channels.position})` }).from(channels).where(eq(channels.type, t)).get()?.m
  const id = crypto.randomUUID()
  db.insert(channels).values({ id, type: t, name: n, position: (max ?? -1) + 1 }).run()
  return { id, type: t, name: n }
}

const manageable = (db: Db, id: unknown) => {
  const c = typeof id === 'string' ? db.select().from(channels).where(eq(channels.id, id)).get() : undefined
  if (!c || c.type === 'dm') throw new ChatError(404, 'Channel not found') // DMs aren't managed
  return c
}

export function renameChannel(db: Db, id: unknown, name: unknown) {
  const c = manageable(db, id), n = cleanChannelName(name)
  db.update(channels).set({ name: n }).where(eq(channels.id, c.id)).run()
  return { id: c.id, type: c.type as Kind, name: n }
}

/** Deletes the channel and (by cascade) its messages. Returns the R2 keys of their files for the caller to remove. */
export function deleteChannel(db: Db, id: unknown) {
  const c = manageable(db, id)
  return db.transaction((tx) => {
    const keys = tx.select({ key: attachments.r2Key }).from(attachments).innerJoin(messages, eq(messages.id, attachments.messageId)).where(eq(messages.channelId, c.id)).all().map(r => r.key)
    tx.delete(channels).where(eq(channels.id, c.id)).run()
    // The delete trigger also fires for already soft-deleted messages (no longer indexed): rebuild so the index can't drift.
    tx.run(sql`INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')`)
    return { id: c.id, type: c.type as Kind, r2Keys: keys }
  })
}

/** Saves a section's manual order. `ids` must be exactly that section's channels. */
export function reorderChannels(db: Db, type: unknown, ids: unknown) {
  const t = kind(type)
  if (!Array.isArray(ids) || ids.some(i => typeof i !== 'string')) throw new ChatError(400, 'Bad order')
  const current = db.select({ id: channels.id }).from(channels).where(eq(channels.type, t)).orderBy(asc(channels.position)).all().map(c => c.id)
  if (new Set(ids).size !== ids.length || ids.length !== current.length || !ids.every(i => current.includes(i))) throw new ChatError(409, 'The channel list changed, try again')
  db.transaction((tx) => {
    ids.forEach((id, position) => tx.update(channels).set({ position }).where(and(eq(channels.id, id), eq(channels.type, t))).run())
  })
}
