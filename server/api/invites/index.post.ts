import { createInvite } from '../../db/invites'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { note } = await readBody<{ note?: string }>(event) // a sent ttl is ignored: invites always last 5 minutes
  const { id, token } = createInvite(useDb(), { createdBy: admin.id, note: note?.trim().slice(0, 200) })
  // The link is only ever returned here.
  return { id, url: `${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/signup?invite=${token}` }
})
