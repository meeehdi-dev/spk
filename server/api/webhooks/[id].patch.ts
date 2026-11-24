import { updateWebhook } from '../../db/webhooks'

export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const b = (await readBody<Record<string, unknown>>(event)) ?? {}
  const channel = await asHttp(() => updateWebhook(useDb(), u, getRouterParam(event, 'id'), b))
  broadcast({ type: 'channels:changed' })
  return channel
})
