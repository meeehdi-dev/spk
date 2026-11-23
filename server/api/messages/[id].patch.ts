import { editMessage } from '../../db/messages'

const allow = createLimiter(10, 10_000)

// Body: { body, poll?, resetVotes? }. Only the author can edit.
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  if (!allow(u.id)) throw createError({ statusCode: 429, message: 'Slow down' })
  return asHttp(async () => {
    const b = await readBody(event)
    const opts = { ...(b?.poll !== undefined && { poll: b.poll }), resetVotes: b?.resetVotes === true }
    const message = editMessage(useDb(), u.id, getRouterParam(event, 'id'), b?.body, Date.now(), opts)
    fanOut(message.channelId, u.id, { type: 'message:edit', message }, true)
    queuePreviews(message)
    return message
  })
})
