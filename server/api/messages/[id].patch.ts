import { ChatError, editMessage } from '../../db/messages'
import { createLimiter } from '../../utils/limiter'

const allow = createLimiter(10, 10_000)

// Body: { body }. Only the author can edit.
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (!allow(u.id)) throw createError({ statusCode: 429, statusMessage: 'Slow down' })
  try {
    const message = editMessage(useDb(), u.id, getRouterParam(event, 'id'), (await readBody(event))?.body)
    fanOut(message.channelId, u.id, { type: 'message:edit', message }, true)
    queuePreviews(message)
    return message
  } catch (e) {
    if (e instanceof ChatError) throw createError({ statusCode: e.statusCode, statusMessage: e.message })
    throw e
  }
})
