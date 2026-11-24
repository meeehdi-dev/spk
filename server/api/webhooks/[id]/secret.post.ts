import { regenerateSecret } from '../../../db/webhooks'

export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const id = getRouterParam(event, 'id') as string
  const secret = await asHttp(() => regenerateSecret(useDb(), u, id))
  broadcast({ type: 'channels:changed' })
  return { url: webhookUrl(id, secret) }
})
