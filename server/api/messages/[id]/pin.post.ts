import { setPin } from '../../../db/pins'

const allow = createLimiter(20, 10_000)

// Body: { on } (true pins, false unpins). DMs: any member; text channels: admins only.
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  if (!allow(u.id)) throw createError({ statusCode: 429, message: 'Slow down' })
  const b = await readBody(event)
  return asHttp(() => {
    const r = setPin(useDb(), u.id, u.role, getRouterParam(event, 'id'), b?.on !== false)
    fanOut(r.channelId, u.id, { type: 'pin:update', ...r }, true)
    return r
  })
})
