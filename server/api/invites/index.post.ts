import { createInvite } from '../../db/invites'

export default defineEventHandler(async event => {
  const admin = await requireAdmin(event)
  const { note } = (await readBody<{ note?: unknown }>(event)) ?? {} // a sent ttl is ignored: invites always last 5 minutes
  const { id, token } = createInvite(useDb(), { createdBy: admin.id, note: typeof note === 'string' ? note.trim().slice(0, 200) : undefined })
  // The link is only ever returned here.
  return { id, url: `${appOrigin()}/signup?invite=${token}` }
})
