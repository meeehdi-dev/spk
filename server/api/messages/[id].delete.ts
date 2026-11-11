import { deleteMessage } from '../../db/messages'
import { purgeObjects } from '../../db/attachments'
import { readState } from '../../db/reads'
import { isAdminRole } from '../../db/roles'

// The author, or any admin. Soft delete in the DB, then the files leave R2.
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const db = useDb()
  return asHttp(async () => {
    const d = deleteMessage(db, u.id, isAdminRole(u.role), getRouterParam(event, 'id'))
    const c = useR2()
    const failed = await purgeObjects(d.r2Keys, key => r2Delete(c, key))
    if (failed.length) console.error(`[r2] could not delete ${failed.length} object(s) of message ${d.id}`, failed)
    for (const id of fanOut(d.channelId, u.id, { type: 'message:delete', id: d.id, channelId: d.channelId }, true)) {
      sendToUser(id, { type: 'unread:update', channelId: d.channelId, ...readState(db, id, d.channelId) })
    }
    return { ok: true }
  })
})
