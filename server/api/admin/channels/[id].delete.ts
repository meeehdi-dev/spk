import { deleteChannel } from '../../../db/channelsAdmin'
import { retryObjectDeletions } from '../../../db/objectDeletions'

// Deleting a voice channel kicks whoever is in it; deleting any channel removes its messages and their files.
export default defineEventHandler(async event => {
  await requireAdmin(event)
  const d = await asHttp(() => deleteChannel(useDb(), getRouterParam(event, 'id')))
  if (d.type === 'voice') disconnectChannel(d.id)
  const { failed } = await retryObjectDeletions(useDb(), key => r2Delete(useR2(), key), Date.now(), d.r2Keys)
  if (failed.length) console.error(`[r2] could not delete ${failed.length} object(s) of channel ${d.id}`, failed)
  broadcast({ type: 'channels:changed' })
  return { ok: true }
})
