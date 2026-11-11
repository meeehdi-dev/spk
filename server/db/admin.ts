import type { Db } from './client'

import { eq, sql } from 'drizzle-orm'

import { ChatError } from './messages'
import { wouldRemoveLastAdmin } from './roles'
import { attachments, session, sounds, user } from './schema'

const exists = (db: Db, id: unknown) => typeof id === 'string' && !!db.select({ id: user.id }).from(user).where(eq(user.id, id)).get()

/** Changes a role. The last admin can't be demoted (also when they are the one asking). */
export function setRole(db: Db, targetId: unknown, role: unknown) {
  if (role !== 'admin' && role !== 'user') throw new ChatError(400, 'Role must be admin or user')
  if (!exists(db, targetId)) throw new ChatError(404, 'User not found')
  if (wouldRemoveLastAdmin(db, targetId as string, role)) throw new ChatError(400, 'The last admin cannot be demoted')
  db.update(user)
    .set({ role })
    .where(eq(user.id, targetId as string))
    .run()
}

/** Ban or unban. A ban also deletes the user's sessions (the caller closes sockets and voice). Messages are kept. */
export function setBanned(db: Db, actorId: string, targetId: unknown, banned: boolean, reason?: unknown) {
  if (!exists(db, targetId)) throw new ChatError(404, 'User not found')
  if (banned && targetId === actorId) throw new ChatError(400, "You can't ban yourself")
  const id = targetId as string
  db.transaction(tx => {
    tx.update(user)
      .set({ banned, banReason: banned && typeof reason === 'string' ? reason.trim().slice(0, 200) || null : null, banExpires: null })
      .where(eq(user.id, id))
      .run()
    if (banned) tx.delete(session).where(eq(session.userId, id)).run()
  })
}

/** Everyone with their stored bytes in R2 (attachments and sounds are tracked in the database; avatars and link thumbnails are not counted). */
export function listUsersWithStorage(db: Db) {
  const bytes = new Map<string, number>()
  const add = (rows: Array<{ id: string; n: number | null }>) => rows.forEach(r => bytes.set(r.id, (bytes.get(r.id) ?? 0) + (r.n ?? 0)))
  add(
    db
      .select({ id: attachments.uploaderId, n: sql<number>`sum(${attachments.size})` })
      .from(attachments)
      .groupBy(attachments.uploaderId)
      .all(),
  )
  add(
    db
      .select({ id: sounds.createdBy, n: sql<number>`sum(${sounds.size})` })
      .from(sounds)
      .groupBy(sounds.createdBy)
      .all(),
  )
  const users = db
    .select({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarKey: user.avatarKey,
      role: user.role,
      banned: user.banned,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(user.createdAt)
    .all()
    .map(u => ({ ...u, createdAt: u.createdAt.getTime(), bytes: bytes.get(u.id) ?? 0 }))
  return { users, totalBytes: [...bytes.values()].reduce((a, b) => a + b, 0) }
}
