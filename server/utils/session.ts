import type { H3Event } from 'h3'

import { isAdminRole } from '../db/roles'

/** The signed-in user or a 401. */
export async function requireUser(event: H3Event) {
  const s = await useAuth().api.getSession({ headers: event.headers })
  if (!s) throw createError({ statusCode: 401, statusMessage: 'Not signed in' })
  event.context.userId = s.user.id // for the error log
  return s.user as typeof s.user & { role?: string | null; displayName?: string | null; avatarKey?: string | null }
}

/** Every admin route calls this: the role is checked on the server, never trusted from the client. */
export async function requireAdmin(event: H3Event) {
  const u = await requireUser(event)
  if (!isAdminRole(u.role)) throw createError({ statusCode: 403, statusMessage: 'Admin only' })
  return u
}
