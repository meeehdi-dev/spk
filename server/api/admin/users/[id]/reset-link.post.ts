import { createResetToken } from '../../../../db/reset'

// One-time link the admin sends by hand. Shown once; only a hash is stored.
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const token = await asHttp(() => createResetToken(useDb(), getRouterParam(event, 'id')))
  return { url: `${getRequestURL(event).origin}/reset-password?token=${token}` }
})
