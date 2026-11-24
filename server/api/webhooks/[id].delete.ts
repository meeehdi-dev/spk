import { deleteWebhook } from '../../db/webhooks'

export default defineEventHandler(async event => {
  const u = await requireUser(event)
  await asHttp(() => deleteWebhook(useDb(), u, getRouterParam(event, 'id')))
  broadcast({ type: 'channels:changed' })
  return { ok: true }
})
