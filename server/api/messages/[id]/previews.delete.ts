import { removePreview } from '../../../db/previews'
import { isAdminRole } from '../../../db/roles'

// Body: { url }. The author or an admin removes a link card.
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  return asHttp(async () => {
    const m = removePreview(useDb(), u.id, isAdminRole(u.role), getRouterParam(event, 'id'), (await readBody(event))?.url)
    fanOut(m.channelId, u.id, { type: 'message:previews', channelId: m.channelId, messageId: m.id, previews: m.previews }, true)
    return { ok: true }
  })
})
