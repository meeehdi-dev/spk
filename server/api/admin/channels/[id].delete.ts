import { purgeObjects } from '../../../db/attachments'
import { deleteChannel } from '../../../db/channelsAdmin'

// Deleting a voice channel kicks whoever is in it; deleting any channel removes its messages and their files.
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const d = await asHttp(() => deleteChannel(useDb(), getRouterParam(event, 'id')))
  if (d.type === 'voice') disconnectChannel(d.id)
  const failed = await purgeObjects(d.r2Keys, key => r2Delete(useR2(), key))
  if (failed.length) console.error(`[r2] could not delete ${failed.length} object(s) of channel ${d.id}`, failed)
  broadcast({ type: 'channels:changed' })
  return { ok: true }
})
