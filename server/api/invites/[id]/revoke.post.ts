import { revokeInvite } from '../../../db/invites'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  if (!revokeInvite(useDb(), getRouterParam(event, 'id')!)) throw createError({ statusCode: 409, statusMessage: 'Invite is not active' })
  return { ok: true }
})
