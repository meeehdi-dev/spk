import type { Db } from './client'

import { and, eq, ne, sql } from 'drizzle-orm'

import { user } from './schema'

/** True if changing `targetId` to `newRole` would leave the app without an admin ("last admin can't demote"). Banned admins don't count. */
export function wouldRemoveLastAdmin(db: Db, targetId: string, newRole: string) {
  if (newRole === 'admin') return false
  const target = db.select({ role: user.role }).from(user).where(eq(user.id, targetId)).get()
  if (target?.role !== 'admin') return false
  const others = db.select({ n: sql<number>`count(*)` }).from(user).where(and(eq(user.role, 'admin'), eq(user.banned, false), ne(user.id, targetId))).get()
  return (others?.n ?? 0) === 0
}

export const isAdminRole = (role: string | null | undefined) => role === 'admin'
