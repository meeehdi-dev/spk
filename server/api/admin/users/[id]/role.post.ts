import { setRole } from '../../../../db/admin'

export default defineEventHandler(async event => {
  const admin = await requireAdmin(event)
  const { role } = (await readBody<{ role?: unknown }>(event)) ?? {}
  await asHttp(() => setRole(useDb(), getRouterParam(event, 'id'), role))
  console.info(`[auth] role user=${getRouterParam(event, 'id')} role=${String(role)} by=${admin.id}`)
  broadcast({ type: 'users:changed' })
  return { ok: true }
})
