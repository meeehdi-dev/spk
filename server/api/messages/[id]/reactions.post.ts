import { setReaction } from '../../../db/messages'

const allow = createLimiter(20, 10_000)

// Body: { emoji, on } (on = true adds your reaction, false removes it).
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (!allow(u.id)) throw createError({ statusCode: 429, message: 'Slow down' })
  const b = await readBody(event)
  return asHttp(() => {
    const r = setReaction(useDb(), u.id, getRouterParam(event, 'id'), b?.emoji, b?.on !== false)
    fanOut(r.channelId, u.id, { type: 'reaction:update', ...r }, true)
    return r
  })
})
