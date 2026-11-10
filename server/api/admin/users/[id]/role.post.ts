import { setRole } from '../../../../db/admin'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { role } = await readBody<{ role?: unknown }>(event) ?? {}
  await asHttp(() => setRole(useDb(), getRouterParam(event, 'id'), role))
  broadcast({ type: 'users:changed' })
  return { ok: true }
})
