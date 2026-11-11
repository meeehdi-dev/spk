import { createResetToken } from '../../../../db/reset'

// One-time link the admin sends by hand. Shown once; only a hash is stored.
export default defineEventHandler(async event => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  const token = await asHttp(() => createResetToken(useDb(), id))
  console.info(`[auth] reset-link user=${id} by=${admin.id}`)
  return { url: `${appOrigin()}/reset-password?token=${token}` }
})
