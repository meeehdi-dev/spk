import type { Db } from './client'

import { and, eq, inArray, lte, sql } from 'drizzle-orm'

import { objectDeletions, user } from './schema'

// shortcut: 24 h is a conservative grace period, not a bound on active PUT duration; use upload lifecycle tracking if that guarantee is required.
export const UPLOAD_DELETE_GRACE_MS = 24 * 3600_000
type Conn = Pick<Db, 'insert' | 'select' | 'update' | 'delete'>

export function enqueueObjectDeletion(db: Conn, key: string, notBefore = Date.now()) {
  db.insert(objectDeletions)
    .values({ key, notBefore: new Date(notBefore) })
    .onConflictDoUpdate({ target: objectDeletions.key, set: { notBefore: sql`max(${objectDeletions.notBefore}, excluded.not_before)` } })
    .run()
}

/** Read the current avatar in the update transaction, never from a stale session. */
export function replaceAvatar(db: Db, userId: string, key: string, now = Date.now()) {
  return db.transaction(tx => {
    const current = tx.select({ key: user.avatarKey }).from(user).where(eq(user.id, userId)).get()
    if (!current) throw new Error('User not found')
    tx.update(user)
      .set({ avatarKey: key, updatedAt: new Date(now) })
      .where(eq(user.id, userId))
      .run()
    if (current.key && current.key !== key) enqueueObjectDeletion(tx, current.key, now)
    return current.key === key ? null : current.key
  })
}

/** Immediate attempts must retain work until the final cleanup deadline. */
export async function retryObjectDeletions(db: Db, deleteKey: (key: string) => Promise<void>, now = Date.now(), keys?: string[]) {
  const rows = keys
    ? keys.length
      ? db.select().from(objectDeletions).where(inArray(objectDeletions.key, keys)).all()
      : []
    : db
        .select()
        .from(objectDeletions)
        .where(lte(objectDeletions.notBefore, new Date(now)))
        .all()
  let completed = 0
  const failed: string[] = []
  for (const row of rows) {
    try {
      await deleteKey(row.key)
    } catch {
      failed.push(row.key)
      continue
    }
    // Recheck after await: another enqueue may have extended the deadline.
    completed += db
      .delete(objectDeletions)
      .where(and(eq(objectDeletions.key, row.key), lte(objectDeletions.notBefore, new Date(now))))
      .run().changes
  }
  return { attempted: rows.length, completed, failed }
}
