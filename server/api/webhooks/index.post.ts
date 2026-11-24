import { createWebhook } from '../../db/webhooks'

// The URL is only ever returned here and by the secret route.
export default defineEventHandler(async event => {
  const u = await requireUser(event)
  const b = (await readBody<Record<string, unknown>>(event)) ?? {}
  const { channel, secret } = await asHttp(() => createWebhook(useDb(), u.id, b))
  broadcast({ type: 'channels:changed' })
  return { channel, url: webhookUrl(channel.id, secret) }
})
