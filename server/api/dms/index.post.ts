import { openDm } from '../../db/dms'
import { ChatError } from '../../db/messages'

// Opens (or creates) the 1:1 DM with another user.
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const body = await readBody(event)
  try {
    return openDm(useDb(), u.id, body?.userId)
  } catch (e) {
    if (e instanceof ChatError) throw createError({ statusCode: e.statusCode, statusMessage: e.message })
    throw e
  }
})
