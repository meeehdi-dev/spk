import { setBanned } from '../../../../db/admin'

// Ban or unban. A ban deletes sessions, closes sockets and ends voice; messages stay.
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const { banned, reason } = await readBody<{ banned?: unknown, reason?: unknown }>(event) ?? {}
  if (typeof banned !== 'boolean') throw createError({ statusCode: 400, message: 'banned must be true or false' })
  await asHttp(() => setBanned(useDb(), admin.id, id, banned, reason))
  console.info(`[auth] ${banned ? 'ban' : 'unban'} user=${id} by=${admin.id}`)
  if (banned) endUserConnections(id, 'banned')
  broadcast({ type: 'users:changed' })
  return { ok: true }
})
