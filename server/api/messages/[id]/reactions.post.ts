import { ChatError, setReaction } from '../../../db/messages'
import { createLimiter } from '../../../utils/limiter'

const allow = createLimiter(20, 10_000)

// Body: { emoji, on } (on = true adds your reaction, false removes it).
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  if (!allow(u.id)) throw createError({ statusCode: 429, statusMessage: 'Slow down' })
  const b = await readBody(event)
  try {
    const r = setReaction(useDb(), u.id, getRouterParam(event, 'id'), b?.emoji, b?.on !== false)
    fanOut(r.channelId, u.id, { type: 'reaction:update', ...r }, true)
    return r
  } catch (e) {
    if (e instanceof ChatError) throw createError({ statusCode: e.statusCode, statusMessage: e.message })
    throw e
  }
})
