import { eq } from 'drizzle-orm'

import { accessibleChannel } from '../../db/messages'
import { messages } from '../../db/schema'

// Who wrote a message and where it lives, for "message from Alex" link chips. Same access rule as history.
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const db = useDb()
  const m = db
    .select({ channelId: messages.channelId, userId: messages.userId })
    .from(messages)
    .where(eq(messages.id, getRouterParam(event, 'id')!))
    .get()
  if (!m || !accessibleChannel(db, u.id, m.channelId)) throw createError({ statusCode: 403, message: 'No access' })
  return m
})
