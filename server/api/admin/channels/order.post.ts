import { reorderChannels } from '../../../db/channelsAdmin'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { type, ids } = await readBody<{ type?: unknown, ids?: unknown }>(event) ?? {}
  await asHttp(() => reorderChannels(useDb(), type, ids))
  broadcast({ type: 'channels:changed' })
  return { ok: true }
})
