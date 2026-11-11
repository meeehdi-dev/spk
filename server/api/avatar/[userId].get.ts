import { eq } from 'drizzle-orm'

import { user } from '../../db/schema'

// Short-lived redirect to the private R2 object; the bucket stays private.
export default defineEventHandler(async event => {
  await requireUser(event)
  const row = useDb()
    .select({ k: user.avatarKey })
    .from(user)
    .where(eq(user.id, getRouterParam(event, 'userId')!))
    .get()
  if (!row?.k) throw createError({ statusCode: 404 })
  setResponseHeader(event, 'cache-control', 'private, max-age=300')
  return sendRedirect(event, await presignGet(useR2(), row.k, 600))
})
