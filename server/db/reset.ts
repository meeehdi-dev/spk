import { and, eq, gt, like } from 'drizzle-orm'
import type { Db } from './client'
import { account, session, user, verification } from './schema'
import { ChatError } from './messages'
import { hashToken } from './invites'
import { randomBytes } from 'node:crypto'

export const RESET_TTL_MS = 24 * 3_600_000
const PREFIX = 'spk-reset:'
const ident = (token: string) => PREFIX + hashToken(token)

/** One-time password reset link token for a user. Only its hash is stored; a new link replaces the old one. */
export function createResetToken(db: Db, userId: unknown, now = Date.now()) {
  if (typeof userId !== 'string' || !db.select({ id: user.id }).from(user).where(eq(user.id, userId)).get()) throw new ChatError(404, 'User not found')
  const token = randomBytes(24).toString('base64url')
  db.transaction((tx) => {
    tx.delete(verification).where(and(like(verification.identifier, `${PREFIX}%`), eq(verification.value, userId))).run()
    tx.insert(verification).values({ id: crypto.randomUUID(), identifier: ident(token), value: userId, expiresAt: new Date(now + RESET_TTL_MS) }).run()
  })
  return token
}

export const checkResetToken = (db: Db, token: string, now = Date.now()) =>
  !!db.select({ id: verification.id }).from(verification).where(and(eq(verification.identifier, ident(token)), gt(verification.expiresAt, new Date(now)))).get()

/** Uses the token (once), sets the new password hash and signs the user out everywhere. False if the token is unknown, used or expired. */
export function resetPassword(db: Db, token: string, passwordHash: string, now = Date.now()) {
  return db.transaction((tx) => {
    const row = tx.delete(verification).where(and(eq(verification.identifier, ident(token)), gt(verification.expiresAt, new Date(now)))).returning({ userId: verification.value }).get()
    if (!row) return false
    const r = tx.update(account).set({ password: passwordHash, updatedAt: new Date(now) }).where(and(eq(account.userId, row.userId), eq(account.providerId, 'credential'))).run()
    if (r.changes !== 1) throw new ChatError(409, 'This account has no password to reset') // rolls the token back
    tx.delete(session).where(eq(session.userId, row.userId)).run()
    return true
  })
}
