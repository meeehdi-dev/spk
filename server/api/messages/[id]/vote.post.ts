import { setVote } from '../../../db/messages'

const allow = createLimiter(20, 10_000)

// Body: { choiceId } (a poll option id, or null to remove your vote).
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  if (!allow(u.id)) throw createError({ statusCode: 429, message: 'Slow down' })
  const b = await readBody(event)
  return asHttp(() => {
    const r = setVote(useDb(), u.id, getRouterParam(event, 'id'), b?.choiceId)
    fanOut(r.channelId, u.id, { type: 'poll:update', channelId: r.channelId, messageId: r.messageId, poll: r.poll }, true)
    return r
  })
})
