import { eq } from 'drizzle-orm'
import { user } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const body = await readBody<{ displayName?: string }>(event)
  const name = body?.displayName?.trim() ?? ''
  if (name.length < 2 || name.length > 32) throw createError({ statusCode: 400, statusMessage: 'Nickname must be 2 to 32 characters' })
  try {
    useDb().update(user).set({ displayName: name, updatedAt: new Date() }).where(eq(user.id, u.id)).run()
  } catch (e) {
    if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw createError({ statusCode: 409, statusMessage: 'That nickname is taken' })
    throw e
  }
  broadcast({ type: 'users:changed' })
  return { displayName: name }
})
