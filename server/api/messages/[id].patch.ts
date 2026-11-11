import { editMessage } from '../../db/messages'

const allow = createLimiter(10, 10_000)

// Body: { body }. Only the author can edit.
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  if (!allow(u.id)) throw createError({ statusCode: 429, message: 'Slow down' })
  return asHttp(async () => {
    const message = editMessage(useDb(), u.id, getRouterParam(event, 'id'), (await readBody(event))?.body)
    fanOut(message.channelId, u.id, { type: 'message:edit', message }, true)
    queuePreviews(message)
    return message
  })
})
