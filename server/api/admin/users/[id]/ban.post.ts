import { setBanned } from '../../../../db/admin'

// Ban or unban. A ban deletes sessions, closes sockets and ends voice; messages stay.
export default defineEventHandler(async event => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const { banned, reason } = (await readBody<{ banned?: unknown; reason?: unknown }>(event)) ?? {}
  if (typeof banned !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'banned must be true or false' })
  await asHttp(() => setBanned(useDb(), admin.id, id, banned, reason))
  if (banned) endUserConnections(id)
  broadcast({ type: 'users:changed' })
  return { ok: true }
})
