import type { Db } from './client'

import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { and, eq, gt, isNull } from 'drizzle-orm'

import { invites } from './schema'

export const INVITE_TTL_MS = 5 * 60_000
export type InviteStatus = 'active' | 'used' | 'expired' | 'revoked'

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export function inviteStatus(i: { usedAt: Date | null, revokedAt: Date | null, expiresAt: Date }, now = Date.now()): InviteStatus {
  if (i.revokedAt) return 'revoked'
  if (i.usedAt) return 'used'
  return i.expiresAt.getTime() <= now ? 'expired' : 'active'
}

/** Returns the plain token once; only its hash is stored. createdBy null = system (first admin). */
export function createInvite(db: Db, o: { createdBy: string | null, note?: string | null }, now = Date.now()) {
  const token = randomBytes(24).toString('base64url')
  const id = randomUUID()
  db.insert(invites).values({
    id, tokenHash: hashToken(token), note: o.note || null, createdBy: o.createdBy,
    createdAt: new Date(now), expiresAt: new Date(now + INVITE_TTL_MS),
  }).run()
  return { id, token }
}

/** 'invalid' = unknown token. */
export function checkInvite(db: Db, token: string, now = Date.now()): InviteStatus | 'invalid' {
  const row = db.select().from(invites).where(eq(invites.tokenHash, hashToken(token))).get()
  return row ? inviteStatus(row, now) : 'invalid'
}

/** Atomically marks an active invite as used (single use). Returns true if this call got it. */
export function claimInvite(db: Db, token: string, now = Date.now()) {
  const r = db.update(invites).set({ usedAt: new Date(now) }).where(and(
    eq(invites.tokenHash, hashToken(token)), isNull(invites.usedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date(now)),
  )).run()
  return r.changes === 1
}

/** Sign-up failed: make the invite usable again (only if no account is linked yet). */
export function releaseInvite(db: Db, token: string) {
  db.update(invites).set({ usedAt: null }).where(and(eq(invites.tokenHash, hashToken(token)), isNull(invites.usedBy))).run()
}

/** Sign-up succeeded: link the account. Returns the invite's creator (null = first-admin invite). */
export function linkInviteUser(db: Db, token: string, userId: string) {
  const h = hashToken(token)
  db.update(invites).set({ usedBy: userId }).where(eq(invites.tokenHash, h)).run()
  return db.select({ createdBy: invites.createdBy }).from(invites).where(eq(invites.tokenHash, h)).get()?.createdBy ?? null
}

export function revokeInvite(db: Db, id: string, now = Date.now()) {
  return db.update(invites).set({ revokedAt: new Date(now) }).where(and(eq(invites.id, id), isNull(invites.usedAt), isNull(invites.revokedAt))).run().changes === 1
}
