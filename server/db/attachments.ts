import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import type { Db } from './client'
import { attachments } from './schema'
import { ChatError } from './messages'
import { cleanMime, MAX_FILE_BYTES } from '../../shared/utils/files'

const MAX_PENDING_PER_USER = 30
const ORPHAN_AGE_MS = 24 * 3600_000

const cleanName = (v: unknown) =>
  (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 200) || 'file'

/** The presign request: validates size and type, inserts the row with message_id = null. */
export function createPendingAttachment(db: Db, userId: string, input: { filename?: unknown, mime?: unknown, size?: unknown }, now = Date.now()) {
  const size = input.size
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) throw new ChatError(400, 'Bad file size')
  if (size > MAX_FILE_BYTES) throw new ChatError(413, 'Files can be 25 MB at most')
  const mime = cleanMime(input.mime)
  if (!mime) throw new ChatError(400, 'Bad file type')
  const pending = db.select({ n: sql<number>`count(*)` }).from(attachments).where(and(eq(attachments.uploaderId, userId), isNull(attachments.messageId))).get()?.n ?? 0
  if (pending >= MAX_PENDING_PER_USER) throw new ChatError(429, 'Too many unsent uploads')
  const id = crypto.randomUUID()
  return db.insert(attachments).values({
    id, uploaderId: userId, r2Key: `attachments/${userId}/${id}`, filename: cleanName(input.filename), mime, size, createdAt: new Date(now)
  }).returning().get()
}

/** Drops one of your own unsent uploads (cancel / removed from the queue). Returns its R2 key. */
export function cancelPending(db: Db, userId: string, id: string) {
  return db.delete(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.uploaderId, userId), isNull(attachments.messageId)))
    .returning({ key: attachments.r2Key }).get()?.key ?? null
}

/** Deletes R2 objects; one failure doesn't stop the rest. Returns the keys that failed. */
export async function purgeObjects(keys: string[], deleteKey: (key: string) => Promise<void>) {
  const failed: string[] = []
  for (const k of keys) { try { await deleteKey(k) } catch { failed.push(k) } }
  return failed
}

/** Scheduled task body: unsent uploads older than 24 h lose their R2 object, then their row. */
export async function sweepOrphans(db: Db, deleteKey: (key: string) => Promise<void>, now = Date.now()) {
  const old = db.select({ id: attachments.id, key: attachments.r2Key }).from(attachments)
    .where(and(isNull(attachments.messageId), lt(attachments.createdAt, new Date(now - ORPHAN_AGE_MS)))).all()
  let removed = 0
  for (const o of old) {
    try { await deleteKey(o.key) } catch { continue } // keep the row, try again next run
    db.delete(attachments).where(and(eq(attachments.id, o.id), isNull(attachments.messageId))).run()
    removed++
  }
  return removed
}
