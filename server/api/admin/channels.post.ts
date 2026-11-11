import { createChannel } from '../../db/channelsAdmin'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  const { type, name } = (await readBody<{ type?: unknown; name?: unknown }>(event)) ?? {}
  const ch = await asHttp(() => createChannel(useDb(), type, name))
  broadcast({ type: 'channels:changed' })
  return ch
})
