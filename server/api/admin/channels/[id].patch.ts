import { renameChannel } from '../../../db/channelsAdmin'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  const { name } = (await readBody<{ name?: unknown }>(event)) ?? {}
  const ch = await asHttp(() => renameChannel(useDb(), getRouterParam(event, 'id'), name))
  broadcast({ type: 'channels:changed' })
  return ch
})
